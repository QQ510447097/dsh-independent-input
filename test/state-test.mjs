import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SIDECAR = join(HERE, '..', 'sidecar.ps1')
const TESTAPP = join(HERE, 'testapp.ps1')
const META = join(HERE, 'testapp.json')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Sidecar {
  constructor() { this.seq = 0; this.pending = new Map(); this.ready = false; this.buf = '' }
  async start() {
    this.proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', SIDECAR], { windowsHide: true })
    this.proc.stdout.setEncoding('utf8')
    this.proc.stdout.on('data', (chunk) => {
      this.buf += chunk
      let i
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1)
        if (!line) continue
        let msg; try { msg = JSON.parse(line) } catch { continue }
        if (msg.event === 'ready') { this.ready = true; continue }
        const p = this.pending.get(msg.id); if (!p) continue
        this.pending.delete(msg.id); clearTimeout(p.timer)
        if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error || 'sidecar error'))
      }
    })
    this.proc.stderr.setEncoding('utf8')
    this.proc.stderr.on('data', (c) => { this.err = (this.err || '') + c })
    const t0 = Date.now()
    while (!this.ready) {
      if (Date.now() - t0 > 30000) throw new Error('sidecar ready timeout: ' + (this.err || '').slice(-800))
      await sleep(100)
    }
  }
  request(cmd, args = {}, timeoutMs = 20000) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout ${cmd}`)) }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.proc.stdin.write(JSON.stringify({ id, cmd, ...args }) + '\n')
    })
  }
  async stop() {
    try { await this.request('shutdown', {}, 3000) } catch {}
    try { this.proc.stdin.end() } catch {}
    await sleep(250)
    try { this.proc.kill() } catch {}
  }
}

let pass = 0, fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS', name) }
  else { fail++; console.log('FAIL', name, detail) }
}

const app = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', TESTAPP], { windowsHide: false })
await sleep(2500)
const meta = JSON.parse(readFileSync(META, 'utf8'))
const sc = new Sidecar()
await sc.start()
try {
  const dbg = async () => (await sc.request('debug', {}, 8000)).cursorState

  await sc.request('move', { x: meta.button.x, y: meta.button.y }, 10000)
  check('move state=pointer', (await dbg()) === 'pointer', await dbg())

  const click = await sc.request('click', { x: meta.button.x, y: meta.button.y, mode: 'auto' }, 20000)
  const afterClick = await dbg()
  check('click succeeds', click.ok === true, JSON.stringify(click))
  check('click state=link', afterClick === 'link', afterClick)

  const typed = await sc.request('type', { x: meta.textbox.x, y: meta.textbox.y, text: 'state', replace: true, mode: 'auto' }, 30000)
  const afterType = await dbg()
  check('type succeeds', typed.ok === true, JSON.stringify(typed))
  check('type state=text', afterType === 'text', afterType)

  const scroll = await sc.request('scroll', { x: meta.button.x, y: meta.button.y, delta: -120, mode: 'auto' }, 20000)
  const afterScroll = await dbg()
  check('scroll succeeds', scroll.ok === true, JSON.stringify(scroll))
  check('scroll state=vert', afterScroll === 'vert', afterScroll)

  const drag = await sc.request('drag', { x: meta.button.x, y: meta.button.y, toX: meta.button.x + 60, toY: meta.button.y + 60, durationMs: 300, mode: 'auto' }, 30000)
  const afterDrag = await dbg()
  check('drag succeeds', drag.ok === true, JSON.stringify(drag))
  check('drag state=dgn1', afterDrag === 'dgn1', afterDrag)

  await sc.request('pause', {}, 10000)
  check('pause state=unavailiable', (await dbg()) === 'unavailiable', await dbg())
  await sc.request('resume', {}, 10000)
  check('resume state=pointer', (await dbg()) === 'pointer', await dbg())
} finally {
  await sc.stop()
  try { app.kill() } catch {}
}
console.log(`RESULT pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
