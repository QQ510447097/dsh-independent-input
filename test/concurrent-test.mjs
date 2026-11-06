import { spawn } from 'node:child_process'
import { readFileSync, existsSync, unlinkSync } from 'node:fs'
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
const near = (a, b) => Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2

for (const f of [LOG, META]) { try { unlinkSync(f) } catch {} }
const app = spawn('powershell.exe', ['-NoLogo','-NoProfile','-STA','-ExecutionPolicy','Bypass','-File', join(HERE, 'testapp.ps1')], { windowsHide: false, env: { ...process.env, DSH_TESTAPP_BACKGROUND: '1' } })
try {
  const t0 = Date.now()
  while (!existsSync(META)) { if (Date.now() - t0 > 15000) throw new Error('app start timeout'); await sleep(100) }
  await sleep(500)
  const meta = JSON.parse(readFileSync(META, 'utf8'))
  const target = { x: meta.button.x, y: meta.button.y }
  const sc = new Sidecar(); await sc.start()
  const baseline = lines().length
  const fgBefore = (await sc.request('status')).foreground.hwnd
  let landed = 0
  let jumps = 0
  const samples = []
  for (let i = 0; i < 6; i++) {
    const before = (await sc.request('status')).cursor
    const r = await sc.request('click', { x: target.x, y: target.y, hwnd: meta.hwnd, mode: 'auto' })
    await sleep(180)
    const after = (await sc.request('status')).cursor
    samples.push({ before, after, via: r.via })
    if (r.ok) landed++
    if (!near(before, target) && near(after, target)) jumps++
    await sleep(120)
  }
  const physBefore = (await sc.request('status')).cursor
  const fgAfter = (await sc.request('status')).foreground.hwnd
  const phys = await sc.request('click', { x: target.x, y: target.y, mode: 'physical' })
  await sleep(250)
  const physAfter = (await sc.request('status')).cursor
  const log = lines()
  console.log(JSON.stringify({
    target,
    autoClicks: 6,
    landed,
    jumps,
    focusChanged: fgBefore !== fgAfter,
    foreground: { before: fgBefore, after: fgAfter },
    samples,
    logButtonLines: log.filter((l) => l === 'button').length,
    baseline,
    physicalRefused: phys.ok === false && phys.reason === 'physical-mouse-forbidden',
    physicalMovedCursor: !near(physBefore, physAfter),
    phys,
  }, null, 2))
  await sc.stop()
} finally {
  try { app.kill() } catch {}
}
