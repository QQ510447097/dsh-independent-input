import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SIDECAR = join(HERE, '..', 'sidecar.ps1')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const p = spawn('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File', SIDECAR], {
  windowsHide: true,
  env: { ...process.env, DSH_INPUT_CURSOR_MODE: 'clean', DSH_INPUT_CURSOR_HOLD_MS: '800', DSH_INPUT_CURSOR_SIZE: '64' },
})
let buf = ''
p.stdout.setEncoding('utf8')
p.stdout.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) console.log(line) } })
p.stderr.setEncoding('utf8')
p.stderr.on('data', (c) => console.error('ERR', c))

await sleep(8000)
const send = (o) => p.stdin.write(JSON.stringify(o) + '\n')
send({ id: 1, cmd: 'status' })
await sleep(500)
send({ id: 2, cmd: 'move', x: 600, y: 400 })
await sleep(300)
send({ id: 3, cmd: 'debug' })
await sleep(1200)
send({ id: 4, cmd: 'debug' })
await sleep(400)
send({ id: 5, cmd: 'setCursorMode', mode: 'companion' })
await sleep(300)
send({ id: 6, cmd: 'move', x: 600, y: 400 })
await sleep(1200)
send({ id: 7, cmd: 'debug' })
await sleep(300)
send({ id: 8, cmd: 'setCursorSize', size: 128 })
await sleep(500)
send({ id: 9, cmd: 'debug' })
await sleep(500)
send({ id: 10, cmd: 'shutdown' })
await sleep(800)
p.kill()
