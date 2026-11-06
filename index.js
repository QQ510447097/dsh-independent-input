/**
 * dsh-independent-input · 独立鼠标键盘
 *
 * 只做“输入”这一层：鼠标、键盘、滚轮、拖拽、截图定位。
 * 默认走 UIA / 窗口消息，不移动主人的真实光标、不抢键盘焦点；
 * 物理输入是显式回退；physical 允许和主人同时操作，只有显式暂停才停手。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { InputEngine } from './lib/engine.js'

export const name = 'independent-input'
export const inject = ['tools', 'attachments', 'webServer']

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
const PREVIEW_DIR = join(PLUGIN_DIR, 'assets', 'previews')
const SETTINGS_FILE = join(homedir(), '.dsh', 'independent-input', 'settings.json')
const STYLE_IDS = [
  'pointer', 'work', 'unavailiable', 'link', 'text',
  'cross', 'busy', 'move', 'vert', 'horz',
  'help', 'handwriting', 'dgn1', 'dgn2', 'alternate',
]

function toLosslessJson(value) {
  if (value === undefined || value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return Number(value)
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(toLosslessJson)
  const out = {}
  for (const [key, item] of Object.entries(value)) out[key] = toLosslessJson(item)
  return out
}

async function loadDefineTool() {
  try {
    const mod = await import('@deepseek-ai/dsh-tools')
    if (mod?.defineTool) return mod.defineTool
  } catch { /* 本地测试时走环境变量 */ }
  const override = process.env.DSH_TOOLS_PATH
  if (override) {
    const { pathToFileURL } = await import('node:url')
    const mod = await import(pathToFileURL(override).href)
    if (mod?.defineTool) return mod.defineTool
  }
  // 最小兜底：只在没有 DSH 的单元测试里用；真实宿主一定有 dsh-tools。
  return (definition) => definition
}

function statusText(s) {
  const paused = s?.paused ? `已暂停（${s.pauseReason || '主人接管'}）` : '运行中'
  const age = Number.isFinite(s?.lastUserInputAgeMs) && s.lastUserInputAgeMs >= 0
    ? `${Math.round(s.lastUserInputAgeMs)}ms 前`
    : '还没记录'
  const fg = s?.foreground?.title || s?.foreground?.className || '未知'
  const cursor = s?.cursor ? `(${s.cursor.x}, ${s.cursor.y})` : '未知'
  const mode = s?.cursorMode === 'clean'
    ? `整洁模式（动作后约 ${s?.cursorHoldMs || 2600}ms 收起，${s?.cursorSize || 64}px · ${s?.cursorState || 'pointer'}）`
    : `陪伴模式（一直显示，${s?.cursorSize || 64}px · ${s?.cursorState || 'pointer'}）`
  const lines = [
    `独立输入：${paused}`,
    `主人最近一次真实输入：${age}`,
    `真实光标：${cursor} · AI 光标：${s?.overlay ? '显示' : '隐藏'} · ${mode}`,
    `前台窗口：${fg}`,
  ]
  if (s?.paused) {
    lines.push('⚠ 主人已经暂停/接管输入。不要继续操作；等主人说“继续”，再调用 action:"resume"。')
  } else {
    lines.push(`主人随时可按 ${s?.hotkey || 'Ctrl+Alt+Q'} 暂停。`)
  }
  return lines.join('\n')
}

function windowsText(r) {
  const list = Array.isArray(r?.windows) ? r.windows : []
  if (!list.length) return '没读到可用窗口。'
  const lines = list.slice(0, 24).map((w) => {
    const rect = w.rect ? `${w.rect.x},${w.rect.y} ${w.rect.w}x${w.rect.h}` : '?'
    const mark = w.foreground ? ' ★前台' : ''
    return `hwnd ${w.hwnd} · ${w.title} · ${rect} · ${w.process || ''}${mark}`.trim()
  })
  if (list.length > 24) lines.push(`……还有 ${list.length - 24} 个窗口未列出`)
  return lines.join('\n')
}

function resultText(action, r) {
  if (!r || typeof r !== 'object') return `已执行 ${action}。`
  if (r.paused) {
    return `⚠ 主人已经暂停/接管输入，动作没有执行。\n${r.note || '等主人说继续，再 action:"resume"。'}`
  }
  if (r.ok === false) {
    const bits = [`未完成（${r.reason || '未知原因'}）`]
    if (r.name) bits.push(`目标：${r.name}`)
    if (r.type) bits.push(`类型：${r.type}`)
    if (r.note) bits.push(r.note)
    if (r.needsPhysical) bits.push('如果必须物理点击，明确传 mode:"physical"。')
    return bits.join('\n')
  }
  if (action === 'capture') {
    return `截图已保存：${r.path}\n${r.attached ? '图已附在本条结果里。' : '用 read_image 看它。'}`
  }
  if (action === 'overlay') {
    if (r.visible === false) return 'AI 光标已隐藏；主人的真实光标没有移动。'
    const mode = r.cursorMode === 'clean' ? '整洁模式（一会儿自动收起）' : '陪伴模式（一直显示）'
    return `AI 光标已到 (${r.x ?? '?'}, ${r.y ?? '?'}) · ${mode} · ${r.cursorSize || 64}px · ${r.cursorState || 'pointer'}；主人的真实光标没有移动。`
  }
  if (action === 'move') {
    const mode = r.cursorMode === 'clean' ? '整洁模式（一会儿自动收起）' : '陪伴模式（一直显示）'
    return `AI 光标已到 (${r.x ?? '?'}, ${r.y ?? '?'}) · ${mode} · ${r.cursorSize || 64}px · ${r.cursorState || 'pointer'}；主人的真实光标没有移动。`
  }
  const via = r.via || 'unknown'
  if (via === 'uia') {
    return `UIA 已执行（${r.pattern || 'pattern'}）${r.name ? `：${r.name}` : ''}${r.type ? ` · ${r.type}` : ''}`
  }
  if (via === 'wm_settext') {
    return `已直接写入控件${r.verified ? '（已回读确认）' : ''}；没有移动光标，也没有抢焦点。`
  }
  if (via === 'uia-focus+physical') {
    return `UIA 聚焦“${r.name || '目标'}”后用独立键盘输入；鼠标没有移动。`
  }
  if (via === 'uia+message') {
    return `UIA 没有可用模式，已改用窗口消息聚焦并输入${r.verified ? '（已确认）' : '（需截图确认）'}。`
  }
  if (via === 'message') {
    const target = r.title ? `“${r.title}”` : (r.hwnd ? `hwnd ${r.hwnd}` : '目标')
    return `窗口消息已投递给 ${target}${r.verified ? '（已确认）' : '（不一定被处理，请截图确认）'}。`
  }
  if (via === 'physical') {
    return `物理输入完成；主人光标已还原。${r.note || ''}`
  }
  return `已执行 ${action}：${JSON.stringify(r).slice(0, 600)}`
}

function toolSpec() {
  return {
    name: 'independent_input',
    description:
      '独立鼠标键盘：默认用 UIA / 窗口消息操作屏幕，**不移动主人的真实光标、不抢键盘焦点**，所以主人随时可以继续用鼠标键盘、暂停或提意见。\n\n'
      + '用法顺序：\n'
      + '1. 先 `status` 看是否 paused、前台窗口、真实光标位置；paused 就停手，等主人说继续。\n'
      + '2. 用 `windows` 或 `capture` 拿目标坐标（屏幕绝对像素；`capture` 的图会直接附在结果里）。\n'
      + '3. 用 `click` / `type` / `key` / `scroll` / `drag`，默认 `mode:"auto"`：UIA → 窗口消息；只有明确 `mode:"physical"` 才动用真实光标/键盘。\n'
      + '4. 每个动作后截图确认，不要假设点中了。\n\n'
      + 'AI 光标：开始操作时用 `move` 让它出现。两种模式 —— `companion`（陪伴，默认，一直显示到收工）'
      + '和 `clean`（整洁，动作后约 2.6 秒自动收起）。插件 config 里改 `cursorMode` / `cursorSize`（24–192，默认 64）；'
      + '光标外观按操作**自动切换**（默认 pointer、输入 text、可点元素 link、滚动 vert、拖拽 move/dgn1/dgn2、精确点击 cross、暂停 unavailiable、失败 help），不用手选。'
      + '运行中也可以 `overlay({cursorMode:"clean", cursorSize:96})` 切换；收工用 `overlay({show:false})` 收起。\n\n'
      + '安全规则：\n'
      + '- 物理模式会短暂使用真实光标；**主人在用键鼠不会自动暂停**，只有显式暂停才停手。\n'
      + '- 主人按 **Ctrl+Alt+Q** 随时暂停；下一次动作会返回 paused，必须停下。\n'
      + '- 不要用这个工具做破坏性操作（删文件、关窗口、支付），除非主人明确要求。\n\n'
      + 'actions: status / windows / capture / click / type / key / scroll / drag / move / pause / resume / overlay。',
    parameters: {
      action: {
        type: 'string',
        required: true,
        description: 'status | windows | capture | click | type | key | scroll | drag | move | pause | resume | overlay',
      },
      x: { type: 'number', description: '屏幕绝对 x（click/type/scroll/drag 的起点/move/overlay）' },
      y: { type: 'number', description: '屏幕绝对 y' },
      toX: { type: 'number', description: 'drag 终点 x' },
      toY: { type: 'number', description: 'drag 终点 y' },
      button: { type: 'string', description: 'left（默认）或 right' },
      count: { type: 'integer', description: '点击次数，默认 1；2 = 双击' },
      text: { type: 'string', description: 'type 要输入的文字' },
      replace: { type: 'boolean', description: 'type：true 覆盖原内容，false（默认）追加' },
      keys: { type: 'string', description: 'key：组合键，如 "ctrl+c"、"alt+tab"、"enter"' },
      mode: {
        type: 'string',
        description: 'auto（默认）| uia | message | physical。auto 先 UIA 再窗口消息，不用真实光标；physical 才动用真实光标/键盘',
      },
      delta: { type: 'number', description: 'scroll 滚轮量：正数向上、负数向下，默认 -120' },
      durationMs: { type: 'number', description: 'drag 持续时间，默认 400ms' },
      hwnd: { type: 'number', description: '可选：type/key 的 physical 模式先聚焦这个窗口' },
      path: { type: 'string', description: 'capture 保存 PNG 的绝对路径；省略则自动放 ~/.dsh/independent-input/shots/' },
      rect: { type: 'string', description: 'capture 区域："x,y,w,h" 或 "full"；省略则截当前前台窗口' },
      show: { type: 'boolean', description: 'overlay：false 隐藏 AI 光标，true/省略 显示' },
      cursorMode: {
        type: 'string',
        description: 'overlay：companion（陪伴，一直显示，默认）| clean（整洁，动作后自动收起）',
      },
      cursorSize: {
        type: 'number',
        description: 'overlay：AI 光标大小（像素，24–192，默认 64）',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          images: { type: 'array', items: { type: 'object', additionalProperties: true } },
          meta: { type: 'object', additionalProperties: true },
        },
      },
      render(_args, value) {
        const blocks = []
        for (const image of value.images || []) blocks.push({ type: 'image', attachment: image })
        blocks.push({ type: 'text', text: value.text })
        return blocks
      },
    },
    timeoutMs: 120000,
    isConcurrencySafe() {
      return false
    },
  }
}

function normalizeSettings(input, fallback = {}) {
  const merged = { ...(fallback || {}), ...(input || {}) }
  const mode = merged.cursorMode === 'clean' ? 'clean' : 'companion'
  const hold = Number(merged.cursorHoldMs)
  const size = Number(merged.cursorSize)
  return {
    cursorMode: mode,
    cursorHoldMs: Number.isFinite(hold) ? Math.max(300, Math.min(10000, Math.round(hold))) : 2600,
    cursorSize: Number.isFinite(size) ? Math.max(24, Math.min(192, Math.round(size))) : 64,
  }
}

async function loadSavedSettings(log = () => {}) {
  try {
    const raw = await readFile(SETTINGS_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function persistSettings(settings) {
  await mkdir(dirname(SETTINGS_FILE), { recursive: true })
  await writeFile(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}

function json(res, status, value) {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', Buffer.byteLength(body))
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('请求体太大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) } catch { reject(new Error('请求不是合法 JSON')) }
    })
    req.on('error', reject)
  })
}

export async function apply(ctx, rawConfig = {}) {
  const defineTool = await loadDefineTool()
  const log = (message) => { try { ctx?.logger?.info?.(`[independent-input] ${message}`) } catch { /* ignore */ } }
  const saved = await loadSavedSettings(log)
  let current = normalizeSettings(saved, normalizeSettings(rawConfig))
  const engine = new InputEngine({ log, ...current })
  const toolConfig = toolSpec()

  const tool = {
    ...toolConfig,
    async execute(args = {}) {
      const action = String(args.action || 'status').toLowerCase()
      try {
        if (action === 'status') {
          const s = await engine.request('status', {}, 10000)
          return toLosslessJson({ text: statusText(s), meta: s })
        }
        if (action === 'windows') {
          const r = await engine.request('windows', {}, 15000)
          return toLosslessJson({ text: windowsText(r), meta: r })
        }
        if (action === 'pause') {
          const s = await engine.request('pause', {}, 10000)
          return toLosslessJson({ text: `已暂停。\n${statusText(s)}`, meta: s })
        }
        if (action === 'resume') {
          const s = await engine.request('resume', {}, 10000)
          return toLosslessJson({ text: `已恢复。\n${statusText(s)}`, meta: s })
        }
        if (action === 'move') {
          const r = await engine.request('move', { x: args.x, y: args.y }, 10000)
          const meta = { ...r, cursorMode: engine.cursorMode, cursorSize: engine.cursorSize, cursorState: engine.cursorState }
          return toLosslessJson({ text: resultText('move', meta), meta })
        }
        if (action === 'overlay') {
          let modeResult = null
          let sizeResult = null
          if (args.cursorMode) {
            if (args.cursorMode !== 'clean' && args.cursorMode !== 'companion') {
              throw new Error('cursorMode 只能是 clean 或 companion')
            }
            modeResult = await engine.setCursorMode(args.cursorMode)
          }
          if (args.cursorSize !== undefined) {
            sizeResult = await engine.setCursorSize(args.cursorSize)
          }
          const mode = modeResult?.cursorMode || engine.cursorMode
          const size = sizeResult?.cursorSize || engine.cursorSize
          if (args.show === false) {
            const r = await engine.request('overlay', { show: false }, 10000)
            return toLosslessJson({ text: resultText('overlay', { ...r, cursorMode: mode, cursorSize: size, cursorState: engine.cursorState }), meta: { ...r, ...modeResult, ...sizeResult } })
          }
          if (Number.isFinite(args.x) && Number.isFinite(args.y)) {
            const r = await engine.request('overlay', { show: true, x: args.x, y: args.y }, 10000)
            return toLosslessJson({ text: resultText('overlay', { ...r, cursorMode: mode, cursorSize: size, cursorState: engine.cursorState }), meta: { ...r, ...modeResult, ...sizeResult } })
          }
          if (modeResult || sizeResult) {
            const modeZh = mode === 'clean'
              ? `整洁模式：动作后约 ${modeResult?.cursorHoldMs || engine.cursorHoldMs}ms 自动收起`
              : '陪伴模式：一直显示到收工'
            return toLosslessJson({
              text: `AI 光标已切换：${modeZh} · ${size}px。`,
              meta: { ...(modeResult || {}), ...(sizeResult || {}), cursorMode: mode, cursorSize: size, cursorState: engine.cursorState, ok: true },
            })
          }
          const r = await engine.request('overlay', { show: true }, 10000)
          return toLosslessJson({ text: resultText('overlay', { ...r, cursorMode: mode, cursorSize: size, cursorState: engine.cursorState }), meta: { ...r, cursorMode: mode, cursorSize: size, cursorState: engine.cursorState } })
        }
        if (action === 'click') {
          const r = await engine.request('click', {
            x: args.x, y: args.y, button: args.button, count: args.count, mode: args.mode,
          }, 30000)
          return toLosslessJson({ text: resultText('click', r), meta: r })
        }
        if (action === 'type') {
          const r = await engine.request('type', {
            x: args.x, y: args.y, text: args.text, replace: args.replace,
            mode: args.mode, hwnd: args.hwnd,
          }, 60000)
          return toLosslessJson({ text: resultText('type', r), meta: r })
        }
        if (action === 'key') {
          const r = await engine.request('key', {
            keys: args.keys, mode: args.mode, hwnd: args.hwnd,
          }, 30000)
          return toLosslessJson({ text: resultText('key', r), meta: r })
        }
        if (action === 'scroll') {
          const r = await engine.request('scroll', {
            x: args.x, y: args.y, delta: args.delta, mode: args.mode,
          }, 30000)
          return toLosslessJson({ text: resultText('scroll', r), meta: r })
        }
        if (action === 'drag') {
          const r = await engine.request('drag', {
            x: args.x, y: args.y, toX: args.toX, toY: args.toY,
            durationMs: args.durationMs, mode: args.mode,
          }, 90000)
          return toLosslessJson({ text: resultText('drag', r), meta: r })
        }
        if (action === 'capture') {
          return await capture(ctx, engine, args)
        }
        return {
          text: '未知 action。可用：status / windows / capture / click / type / key / scroll / drag / move / pause / resume / overlay。',
          meta: { ok: false, action },
        }
      } catch (error) {
        return toLosslessJson({
          text: `独立输入没完成：${error?.message || error}`,
          meta: { ok: false, action },
        })
      }
    },
  }

  const dispose = ctx.tools.register(defineTool(tool))

  const applySettings = async (next) => {
    await engine.setCursorSize(next.cursorSize)
    await engine.setCursorMode(next.cursorMode, next.cursorHoldMs)
  }

  const API_PREFIX = '/dsh-independent-input/api'
  const ASSET_PREFIX = '/dsh-independent-input/assets'

  const apiHandler = async (req, res, next) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (!url.pathname.startsWith(API_PREFIX)) {
      if (typeof next === 'function') return next()
      return json(res, 404, { ok: false, error: 'not found' })
    }
    const route = url.pathname.slice(API_PREFIX.length) || '/'
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      return res.end()
    }
    try {
      if (req.method === 'GET' && route === '/settings') {
        return json(res, 200, { ok: true, settings: current })
      }
      if (req.method === 'POST' && route === '/settings') {
        const body = await readBody(req)
        const nextSettings = normalizeSettings(body, current)
        await applySettings(nextSettings)
        await persistSettings(nextSettings)
        current = nextSettings
        return json(res, 200, { ok: true, settings: current })
      }
      if (req.method === 'POST' && route === '/hide') {
        await engine.request('overlay', { show: false }, 15000)
        return json(res, 200, { ok: true })
      }
      if (req.method === 'POST' && route === '/show') {
        await engine.request('overlay', { show: true }, 30000)
        return json(res, 200, { ok: true })
      }
      return json(res, 404, { ok: false, error: 'not found' })
    } catch (error) {
      log(`http ${req.method} ${route}: ${error?.message || error}`)
      return json(res, 500, { ok: false, error: String(error?.message || error) })
    }
  }

  const assetHandler = async (req, res, next) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (!url.pathname.startsWith(ASSET_PREFIX)) {
      if (typeof next === 'function') return next()
      return json(res, 404, { ok: false, error: 'not found' })
    }
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      return res.end()
    }
    try {
      const name = url.pathname.slice(ASSET_PREFIX.length).replace(/^\//, '').replace(/\.png$/i, '').toLowerCase()
      if (!STYLE_IDS.includes(name)) return json(res, 404, { ok: false, error: 'unknown style' })
      const buffer = await readFile(join(PREVIEW_DIR, `${name}.png`))
      res.statusCode = 200
      res.setHeader('content-type', 'image/png')
      res.setHeader('cache-control', 'public, max-age=3600')
      res.setHeader('content-length', buffer.length)
      return res.end(buffer)
    } catch (error) {
      log(`asset ${url.pathname}: ${error?.message || error}`)
      return json(res, 404, { ok: false, error: 'not found' })
    }
  }

  try {
    if (ctx?.webServer && typeof ctx.effect === 'function') {
      ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler: apiHandler }), 'independent-input: api')
      ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ASSET_PREFIX, handler: assetHandler }), 'independent-input: assets')
    } else {
      log('webServer 不可用：设置页 API 没挂上')
    }
  } catch (error) {
    log(`设置页 API 挂载失败：${error?.message || error}`)
  }

  return () => {
    try { dispose?.() } catch { /* ignore */ }
    engine.stop()
  }
}

async function capture(ctx, engine, args) {
  let rect = typeof args.rect === 'string' ? args.rect.trim() : ''
  if (rect.toLowerCase() === 'full' || rect === '0,0,0,0') rect = '0,0,0,0'
  if (!rect) {
    const status = await engine.request('status', {}, 10000)
    const hwnd = status?.foreground?.hwnd
    if (hwnd) {
      const info = await engine.request('winInfo', { hwnd }, 10000)
      const r = info?.rect
      if (r && r.w > 0 && r.h > 0) rect = `${r.x},${r.y},${r.w},${r.h}`
    }
    if (!rect) rect = '0,0,0,0'
  }

  const path = args.path || join(homedir(), '.dsh', 'independent-input', 'shots', `shot-${Date.now()}.png`)
  await mkdir(dirname(path), { recursive: true })
  const saved = await engine.request('capture', { path, rect }, 30000)

  let images = []
  try {
    const data = await readFile(path)
    const svc = ctx?.attachments
    if (svc?.saveImage) {
      const ref = await svc.saveImage.call(svc, {
        data,
        mediaType: 'image/png',
        name: `independent-input-${Date.now()}.png`,
      })
      images = [ref]
    }
  } catch (error) {
    ctx?.logger?.warn?.(`[independent-input] 截图读不回来：${error?.message || error}`)
  }

  return toLosslessJson({
    text: resultText('capture', { ok: true, path: saved.path, attached: images.length > 0 }),
    images,
    meta: { ok: true, path: saved.path, rect, attached: images.length > 0 },
  })
}
