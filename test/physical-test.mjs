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
  await sleep(350)
  const after = await sc.request('status')
  check('physical mouse refused', phys.ok === false && phys.reason === 'physical-mouse-forbidden', JSON.stringify(phys))
  check('physical mouse did not click', !lines().includes('button'), JSON.stringify(lines()))

  const fgBefore = (await sc.request('status')).foreground.hwnd
  const ty = await sc.request('type', { text: 'hello-physical', mode: 'physical', hwnd: meta.textboxHwnd })
  check('physical keyboard refused', ty.ok === false && ty.reason === 'physical-keyboard-forbidden', JSON.stringify(ty))
  const autoTy = await sc.request('type', { x: meta.textbox.x, y: meta.textbox.y, hwnd: meta.textboxHwnd, text: 'hello-auto', mode: 'auto', replace: true })
  await sleep(350)
  const fgAfter = (await sc.request('status')).foreground.hwnd
  check('auto type ok', autoTy.ok === true, JSON.stringify(autoTy))
  check('type did not steal focus', fgBefore === fgAfter, `${fgBefore} -> ${fgAfter}`)
  await sc.request('click', { x: meta.read.x, y: meta.read.y, hwnd: meta.hwnd, mode: 'uia' })
  await sleep(350)
  check('auto type landed', lines().some((l) => l.startsWith('text=hello-auto')), JSON.stringify(lines()))

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
