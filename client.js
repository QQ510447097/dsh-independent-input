// 设置 → 独立输入：AI 光标样式 / 大小 / 陪伴或整洁。
// 纯手写客户端 chunk，格式与官方客户端插件一致；不需要构建。
window.__ModuleLoader__.load({
  id: 'dsh-independent-input',
  factory(require) {
    const React = require('react')
    const { useEffect, useState } = React
    const h = React.createElement

    const API = '/dsh-independent-input/api'
    const ASSET = '/dsh-independent-input/assets'

    const C = {
      text: 'var(--dsw-alias-label-primary, #e8e8ee)',
      sub: 'var(--dsw-alias-label-secondary, #b8b8c4)',
      faint: 'var(--dsw-alias-label-tertiary, #8d8d9c)',
      border: 'var(--dsw-alias-border-l2, rgba(255,255,255,.12))',
      bg: 'var(--dsw-alias-bg-layer-1, #191920)',
      input: 'var(--dsw-alias-bg-base, #101016)',
      accent: 'var(--dsw-alias-state-business-primary, #4d6bfe)',
      accentText: 'var(--dsw-alias-label-primary-inverted, #ffffff)',
      danger: 'var(--dsw-alias-state-error-primary, #ff6b6b)',
      ok: 'var(--dsw-alias-state-success-primary, #59d18b)',
    }

    const S = {
      page: { maxWidth: '780px', color: C.text },
      lead: { fontSize: '12px', color: C.sub, lineHeight: 1.8, marginBottom: '14px' },
      card: { border: `1px solid ${C.border}`, borderRadius: '12px', padding: '14px', background: C.bg, marginBottom: '12px' },
      title: { fontSize: '13px', fontWeight: 700, color: C.text, marginBottom: '4px' },
      hint: { fontSize: '11px', color: C.faint, lineHeight: 1.7, marginBottom: '10px' },
      row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
      modeBtn: (on) => ({
        border: `1px solid ${on ? C.accent : C.border}`,
        background: on ? C.accent : 'transparent',
        color: on ? C.accentText : C.text,
        borderRadius: '8px',
        padding: '7px 12px',
        fontSize: '12px',
        cursor: 'pointer',
        fontWeight: on ? 700 : 400,
      }),
      grid: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '8px' },
      stateGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '4px 16px' },
      stateItem: { display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 0', minWidth: 0 },
      stateThumb: {
        width: '30px',
        height: '30px',
        imageRendering: 'pixelated',
        background: '#ffffff',
        borderRadius: '6px',
        display: 'block',
        flex: '0 0 30px',
      },
      stateName: { fontSize: '12px', color: C.text, lineHeight: 1.35 },
      stateWhy: { fontSize: '10.5px', color: C.faint, lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      range: { width: '100%', accentColor: C.accent, cursor: 'pointer' },
      num: { width: '76px', background: C.input, color: C.text, border: `1px solid ${C.border}`, borderRadius: '7px', padding: '6px 8px', fontSize: '12px' },
      btn: { border: `1px solid ${C.border}`, background: 'transparent', color: C.text, borderRadius: '8px', padding: '7px 12px', fontSize: '12px', cursor: 'pointer' },
      primary: { border: `1px solid ${C.accent}`, background: C.accent, color: C.accentText, borderRadius: '8px', padding: '7px 14px', fontSize: '12px', cursor: 'pointer', fontWeight: 700 },
      note: { fontSize: '12px', color: C.ok, minHeight: '18px', lineHeight: 1.6 },
      error: { fontSize: '12px', color: C.danger, minHeight: '18px', lineHeight: 1.6 },
    }

    const STATE_ROWS = [
      ['pointer', '指针', '默认 / 移动 / 普通点击'],
      ['link', '链接', '点到可点的按钮或链接'],
      ['text', '文本', '输入文字 / 按键'],
      ['vert', '上下', '上下滚动 / 竖向拖拽'],
      ['horz', '左右', '左右滚动 / 横向拖拽'],
      ['move', '移动', '拖动'],
      ['dgn1', '斜向1', '斜向拖拽（正斜率）'],
      ['dgn2', '斜向2', '斜向拖拽（负斜率）'],
      ['cross', '十字', '精确物理点击'],
      ['unavailiable', '禁止', '暂停 / 主人接管'],
      ['help', '帮助', '没点中 / 需要处理'],
      ['work', '工作', '执行中（预留）'],
      ['busy', '忙碌', '等待中（预留）'],
      ['handwriting', '手写', '手写（预留）'],
      ['alternate', '备用', '兜底状态'],
    ]

    async function api(path, options = {}) {
      const init = {
        method: options.method || 'GET',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
      }
      if (options.body !== undefined) init.body = JSON.stringify(options.body)
      let response
      try {
        response = await fetch(`${API}${path}`, init)
      } catch {
        throw new Error('连不上独立输入插件（sidecar 可能还没起来）')
      }
      const raw = await response.text().catch(() => '')
      let data = null
      try { data = raw ? JSON.parse(raw) : null } catch { throw new Error('后端返回的不是 JSON') }
      if (!data?.ok) throw new Error(data?.error || `请求失败 ${response.status}`)
      return data
    }

    function Page() {
      const [settings, setSettings] = useState(null)
      const [note, setNote] = useState('')
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [previewOn, setPreviewOn] = useState(false)

      const applyResult = (data) => {
        if (data?.settings) setSettings(data.settings)
      }

      const load = async () => {
        const data = await api('/settings')
        applyResult(data)
      }

      useEffect(() => {
        load().catch((e) => setError(e.message))
      }, [])

      const update = (patch) => setSettings((current) => current ? { ...current, ...patch } : current)

      const save = async () => {
        if (!settings) return
        setBusy(true); setError(''); setNote('')
        try {
          const data = await api('/settings', { method: 'POST', body: settings })
          applyResult(data)
          setNote('已保存并立即生效，不需要重启。')
        } catch (e) {
          setError(e.message)
        } finally {
          setBusy(false)
        }
      }

      const toggleEnabled = async () => {
        if (!settings) return
        const next = { ...settings, enabled: !settings.enabled }
        setSettings(next)
        setBusy(true); setError(''); setNote('')
        try {
          const data = await api('/settings', { method: 'POST', body: next })
          applyResult(data)
          setNote(next.enabled ? '已启用：之后所有点击只用 AI 光标，不碰真实鼠标。' : '已关闭：插件动作全部停用。')
        } catch (e) {
          setError(e.message)
        } finally {
          setBusy(false)
        }
      }

      const reset = async () => {
        const defaults = { cursorMode: 'companion', cursorHoldMs: 2600, cursorSize: 64 }
        setSettings((current) => current ? { ...current, ...defaults } : defaults)
        setBusy(true); setError(''); setNote('')
        try {
          const data = await api('/settings', { method: 'POST', body: defaults })
          applyResult(data)
          setNote('已恢复默认：陪伴 · 64px。')
        } catch (e) {
          setError(e.message)
        } finally {
          setBusy(false)
        }
      }

      const hideCursor = async () => {
        setError('')
        try {
          await api('/hide', { method: 'POST', body: {} })
          setPreviewOn(false)
          setNote('AI 光标已收起；再点“在屏幕上试一下”可以叫出来。')
        } catch (e) {
          setError(e.message)
        }
      }

      const showCursor = async () => {
        setError('')
        try {
          await api('/show', { method: 'POST', body: {} })
          setPreviewOn(true)
          setNote('已把 AI 光标放到屏幕上；真实鼠标没有移动。')
        } catch (e) {
          setError(e.message)
        }
      }

      if (!settings) {
        return h('div', { style: S.page },
          h('div', { style: S.lead }, error ? `加载失败：${error}` : '正在读取独立输入设置……'),
          h('button', {
            type: 'button',
            style: S.btn,
            onClick: () => { setError(''); load().catch((e) => setError(e.message)) },
          }, '重试'),
        )
      }

      const isClean = settings.cursorMode === 'clean'

      return h('div', { style: S.page },
        h('div', { style: S.title }, '独立输入 · AI 光标'),
        h('div', { style: S.lead },
          '这里调 AI 光标的显示方式和大小；外观会像正常鼠标一样，按当前操作自动切换。默认不移动你的真实光标、不抢键盘焦点，保存后立即生效。'),

        h('div', { style: S.card },
          h('div', { style: S.title }, '总开关'),
          h('div', { style: S.hint },
            settings.enabled
              ? '已启用：所有点击只用 AI 光标（UIA / 窗口消息），严格禁止动用真实鼠标。'
              : '已关闭：插件不执行任何动作，也不会显示 AI 光标。'),
          h('div', { style: S.row },
            h('button', {
              type: 'button',
              style: S.modeBtn(settings.enabled),
              disabled: busy,
              onClick: toggleEnabled,
            }, settings.enabled ? '已启用（点此关闭）' : '已关闭（点此启用）'),
          ),
        ),

        h('div', { style: S.card },
          h('div', { style: S.title }, '显示方式'),
          h('div', { style: S.hint }, '陪伴 = 一直显示到收工；整洁 = 每次动作后约 ' + (settings.cursorHoldMs || 2600) + 'ms 自动收起。'),
          h('div', { style: S.row },
            h('button', { type: 'button', style: S.modeBtn(!isClean), onClick: () => update({ cursorMode: 'companion' }) }, '陪伴（一直显示）'),
            h('button', { type: 'button', style: S.modeBtn(isClean), onClick: () => update({ cursorMode: 'clean' }) }, '整洁（动作后收起）'),
          ),
          isClean ? h('div', { style: { ...S.row, marginTop: '10px' } },
            h('span', { style: S.hint }, '收起前停留'),
            h('input', {
              type: 'number', min: 300, max: 10000, step: 100,
              style: S.num,
              value: settings.cursorHoldMs,
              onChange: (e) => update({ cursorHoldMs: Math.max(300, Math.min(10000, Number(e.target.value) || 2600)) }),
            }),
            h('span', { style: S.hint }, 'ms'),
          ) : null,
        ),

        h('div', { style: S.card },
          h('div', { style: S.title }, '光标状态（自动切换）'),
          h('div', { style: S.hint }, '这些是同一只光标的 15 个状态，不是样式；不用手选，插件按操作自动切。'),
          h('div', { style: S.stateGrid },
            STATE_ROWS.map(([id, label, why]) => h('div', { key: id, style: S.stateItem },
              h('img', { src: `${ASSET}/${id}.png`, alt: id, style: S.stateThumb }),
              h('div', { style: { minWidth: 0 } },
                h('div', { style: S.stateName }, label),
                h('div', { style: S.stateWhy }, why),
              ),
            )),
          ),
        ),

        h('div', { style: S.card },
          h('div', { style: S.title }, '光标大小'),
          h('div', { style: S.hint }, `当前 ${settings.cursorSize}px；暂停时会自动变成红色“禁止”。`),
          h('div', { style: S.row },
            h('input', {
              type: 'range', min: 24, max: 192, step: 4,
              style: S.range,
              value: settings.cursorSize,
              onChange: (e) => update({ cursorSize: Number(e.target.value) || 64 }),
            }),
            h('input', {
              type: 'number', min: 24, max: 192, step: 4,
              style: S.num,
              value: settings.cursorSize,
              onChange: (e) => update({ cursorSize: Math.max(24, Math.min(192, Number(e.target.value) || 64)) }),
            }),
            h('span', { style: S.hint }, 'px'),
          ),
          h('div', { style: { ...S.row, marginTop: '8px' } },
            [48, 64, 96, 128].map((n) => h('button', {
              key: n, type: 'button', style: S.btn,
              onClick: () => update({ cursorSize: n }),
            }, `${n}px`)),
          ),
        ),

        h('div', { style: S.row },
          h('button', { type: 'button', style: S.primary, disabled: busy, onClick: save }, busy ? '保存中…' : '保存并生效'),
          h('button', { type: 'button', style: S.btn, disabled: busy, onClick: reset }, '恢复默认'),
          h('button', { type: 'button', style: S.btn, onClick: previewOn ? hideCursor : showCursor }, previewOn ? '收起光标' : '在屏幕上试一下'),
        ),
        h('div', { style: S.note }, note),
        h('div', { style: S.error }, error),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'independent-input',
          order: 70,
          label: () => '独立输入',
        }, Page))
      },
    }
  },
})
