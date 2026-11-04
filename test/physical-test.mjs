import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SIDECAR = join(HERE, '..', 'sidecar.ps1')
const LOG = join(HERE, 'testapp.log')
const META = join(HERE, 'testapp.json')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Sidecar {
  constructor() { this.seq = 0; this.pending = new Map(); this.ready = false; this.buf = '' }
  async start() {
    this.proc = spawn('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File', SIDECAR], { windowsHide: true })
    this.proc.stdout.setEncoding('utf8')
    this.proc.stdout.on('data', (c) => {
      this.buf += c
      let i
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1)
        if (!line) continue
        let m; try { m = JSON.parse(line) } catch { continue }
        if (m.event === 'ready') { this.ready = true; continue }
        const p = this.pending.get(m.id); if (!p) continue
        this.pending.delete(m.id); clearTimeout(p.timer)
        m.ok ? p.resolve(m.result) : p.reject(new Error(m.error))
      }
    })
    const t0 = Date.now()
    while (!this.ready) { if (Date.now() - t0 > 30000) throw new Error('ready timeout'); await sleep(100) }
  }
  request(cmd, args = {}, timeoutMs = 30000) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('timeout ' + cmd)) }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.proc.stdin.write(JSON.stringify({ id, cmd, ...args }) + '\n')
    })
  }
  async stop() { try { await this.request('shutdown', {}, 3000) } catch {}; try { this.proc.kill() } catch {} }
}
const lines = () => { try { return readFileSync(LOG, 'utf8').split(/\r?\n/).filter(Boolean) } catch { return [] } }
let pass = 0, fail = 0
const check = (n, c, d = '') => { c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n, d)) }

const app = spawn('powershell.exe', ['-NoLogo','-NoProfile','-STA','-ExecutionPolicy','Bypass','-File', join(HERE, 'testapp.ps1')], { windowsHide: false })
try {
  const t0 = Date.now()
  while (!existsSync(META)) { if (Date.now() - t0 > 15000) throw new Error('app start timeout'); await sleep(100) }
  await sleep(600)
  const meta = JSON.parse(readFileSync(META, 'utf8'))
  const sc = new Sidecar(); await sc.start()
  await sc.request('setUserActiveMs', { ms: 0 })

  const before = await sc.request('status')
  const phys = await sc.request('click', { x: meta.button.x, y: meta.button.y, mode: 'physical' })
  await sleep(500)
  const after = await sc.request('status')
  check('physical click ok', phys.ok === true, JSON.stringify(phys))
  check('physical click landed', lines().includes('button'), JSON.stringify(lines()))
  const dx = Math.abs(before.cursor.x - after.cursor.x)
  const dy = Math.abs(before.cursor.y - after.cursor.y)
  check('cursor restored', dx <= 8 && dy <= 8, `${JSON.stringify(before.cursor)} -> ${JSON.stringify(after.cursor)}`)

  await sc.request('setUserActiveMs', { ms: 5000 })
  await sc.request('simulateUserInput')
  let refused = false
  try { await sc.request('click', { x: meta.button.x, y: meta.button.y, mode: 'physical' }) }
  catch (e) { refused = String(e.message).includes('user-active') }
  check('user-active refusal', refused)
  await sc.request('setUserActiveMs', { ms: 0 })

  // 用消息点击把焦点放进文本框（不移动光标），再用物理键盘输入。
  await sc.request('click', { x: meta.textbox.x, y: meta.textbox.y, mode: 'message' })
  await sleep(250)
  const ty = await sc.request('type', { text: 'hello-physical', mode: 'physical', hwnd: meta.textboxHwnd })
  await sleep(400)
  check('physical type ok', ty.ok === true, JSON.stringify(ty))
  await sc.request('click', { x: meta.read.x, y: meta.read.y, mode: 'uia' })
  await sleep(400)
  check('physical text landed', lines().some((l) => l.startsWith('text=hello-physical')), JSON.stringify(lines()))

  await sc.request('pause')
  const paused = await sc.request('click', { x: meta.button.x, y: meta.button.y, mode: 'message' })
  check('paused gate', paused.paused === true && paused.ok === false, JSON.stringify(paused))
  await sc.request('resume')

  await sc.stop()
} catch (e) {
  console.error('TEST ERROR', e); fail++
} finally {
  try { app.kill() } catch {}
}
console.log(`RESULT pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
