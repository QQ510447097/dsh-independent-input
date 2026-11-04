import { spawn } from 'node:child_process'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SIDECAR = join(HERE, '..', 'sidecar.ps1')
const LOG = join(HERE, 'testapp.log')
const META = join(HERE, 'testapp.json')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Sidecar {
  constructor() {
    this.seq = 0
    this.pending = new Map()
    this.ready = false
    this.buf = ''
  }
  async start() {
    this.proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', SIDECAR], { windowsHide: true })
    this.proc.stdout.setEncoding('utf8')
    this.proc.stdout.on('data', (chunk) => {
      this.buf += chunk
      let i
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim()
        this.buf = this.buf.slice(i + 1)
        if (!line) continue
        let msg
        try { msg = JSON.parse(line) } catch { console.error('BAD JSON', line); continue }
        if (msg.event === 'ready') { this.ready = true; continue }
        const p = this.pending.get(msg.id)
        if (!p) continue
        this.pending.delete(msg.id)
        clearTimeout(p.timer)
        if (msg.ok) p.resolve(msg.result)
        else p.reject(new Error(msg.error || 'sidecar error'))
      }
    })
    this.proc.stderr.setEncoding('utf8')
    this.proc.stderr.on('data', (c) => { this.err = (this.err || '') + c })
    this.proc.on('exit', (code) => {
      for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('sidecar exited ' + code)) }
      this.pending.clear()
    })
    const t0 = Date.now()
    while (!this.ready) {
      if (Date.now() - t0 > 30000) throw new Error('sidecar ready timeout: ' + (this.err || '').slice(-800))
      await sleep(100)
    }
  }
  request(cmd, args = {}, timeoutMs = 20000) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`timeout ${cmd}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.proc.stdin.write(JSON.stringify({ id, cmd, ...args }) + '\n')
    })
  }
  async stop() {
    try { await this.request('shutdown', {}, 3000) } catch {}
    try { this.proc.stdin.end() } catch {}
    await sleep(300)
    try { this.proc.kill() } catch {}
  }
}

function logLines() {
  try { return readFileSync(LOG, 'utf8').split(/\r?\n/).filter(Boolean) } catch { return [] }
}

function clearLog() { writeFileSync(LOG, '') }

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS', name) }
  else { fail++; console.log('FAIL', name, detail) }
}

const app = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', join(HERE, 'testapp.ps1')], { windowsHide: false })
app.stderr.setEncoding('utf8')
app.stderr.on('data', (c) => console.error('APP ERR', c))

try {
  const t0 = Date.now()
  while (!existsSync(META)) {
    if (Date.now() - t0 > 15000) throw new Error('test app did not start')
    await sleep(100)
  }
  await sleep(500)
  const meta = JSON.parse(readFileSync(META, 'utf8'))
  console.log('meta', meta)

  const sc = new Sidecar()
  await sc.start()

  const st = await sc.request('status')
  check('status returns uia', st.uia === true, JSON.stringify(st))
  check('status has cursor', Number.isFinite(st.cursor?.x), JSON.stringify(st.cursor))

  const wi = await sc.request('winInfo', { hwnd: meta.hwnd })
  console.log('winInfo', wi)
  check('test app visible', wi.visible === true, JSON.stringify(wi))
  const wins = await sc.request('windows')
  console.log('windows has app', (wins.windows || []).filter((w) => w.hwnd === meta.hwnd))

  clearLog()
  const wa1 = await sc.request('windowAt', { x: meta.button.x, y: meta.button.y })
  console.log('windowAt before message', wa1)
  const m = await sc.request('click', { x: meta.button.x, y: meta.button.y, button: 'left', count: 1, mode: 'message' })
  await sleep(400)
  check('message click routed', m.ok === true, JSON.stringify(m))
  check('message click landed', logLines().includes('button'), JSON.stringify(logLines()))
  const wa2 = await sc.request('windowAt', { x: meta.button.x, y: meta.button.y })
  console.log('windowAt after message', wa2)
  await sc.request('overlay', { show: false })
  const dbgHide = await sc.request('debug')
  console.log('debug after explicit hide', dbgHide)
  const wa3 = await sc.request('windowAt', { x: meta.button.x, y: meta.button.y })
  console.log('windowAt after explicit hide', wa3)

  clearLog()
  const u = await sc.request('click', { x: meta.button.x, y: meta.button.y, button: 'left', count: 1, mode: 'uia' })
  await sleep(400)
  check('uia click ok', u.ok === true, JSON.stringify(u))
  check('uia click landed', logLines().includes('button'), JSON.stringify(logLines()))

  const ty = await sc.request('type', { x: meta.textbox.x, y: meta.textbox.y, text: 'hello bigfish', mode: 'uia', replace: true })
  await sleep(400)
  check('uia type ok', ty.ok === true, JSON.stringify(ty))

  clearLog()
  const rb = await sc.request('click', { x: meta.read.x, y: meta.read.y, button: 'left', count: 1, mode: 'uia' })
  await sleep(400)
  check('read text button ok', rb.ok === true, JSON.stringify(rb))
  check('typed text landed', logLines().some((l) => l.startsWith('text=hello')), JSON.stringify(logLines()))

  const mv = await sc.request('move', { x: meta.button.x, y: meta.button.y })
  await sleep(300)
  check('virtual cursor moved', mv.ok === true, JSON.stringify(mv))

  const dbg = await sc.request('debug')
  check('overlay topmost', dbg.topmost === true, JSON.stringify(dbg))
  check('overlay visible', dbg.visible === true, JSON.stringify(dbg))

  await sc.stop()
} catch (e) {
  console.error('TEST ERROR', e)
  fail++
} finally {
  try { app.kill() } catch {}
}

console.log(`RESULT pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)

