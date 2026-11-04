import { apply } from '../index.js'

const registered = []
const ctx = {
  logger: {
    info: (...args) => console.error('[info]', ...args),
    warn: (...args) => console.error('[warn]', ...args),
  },
  tools: {
    register(tool) {
      registered.push(tool)
      return () => {}
    },
  },
}

const dispose = await apply(ctx)
if (!registered.length) throw new Error('no tool registered')
const tool = registered[0]
console.log('tool', tool.name, 'timeout', tool.timeoutMs)

const status = await tool.execute({ action: 'status' })
console.log('status.text', status.text)
console.log('status.meta.paused', status.meta?.paused, 'uia', status.meta?.uia)

const windows = await tool.execute({ action: 'windows' })
console.log('windows.text.head', String(windows.text).split('\n').slice(0, 3).join(' | '))

const cap = await tool.execute({ action: 'capture', rect: '0,0,400,300' })
console.log('capture.text', cap.text)
console.log('capture.images', Array.isArray(cap.images) ? cap.images.length : 'n/a')

dispose()
console.log('PLUGIN TEST OK')
