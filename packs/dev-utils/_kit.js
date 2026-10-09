// Shared look and helpers for the dev-utils pack (files starting with "_" are never tool modules).
// Everything is scoped under .dv-* classes so it never leaks into the site shell.
import { h, icon, copyText, button, toast, download } from '../../lib/ui.js'

const CSS = `
@property --dv-a { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
.dv { --dv-r: 16px; }
.dv-eyebrow { font-size: 11.5px; font-weight: 650; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); display: flex; align-items: center; gap: 7px; }
.dv-eyebrow .icon { width: 14px; height: 14px; color: var(--accent); }
.dv-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }

/* Hero result card: animated gradient hairline */
.dv-hero { position: relative; isolation: isolate; border-radius: var(--radius-xl); padding: 22px; background:
  radial-gradient(520px 200px at 0% 0%, color-mix(in srgb, var(--accent) 11%, transparent), transparent 70%),
  radial-gradient(420px 200px at 100% 100%, color-mix(in srgb, var(--accent-2) 9%, transparent), transparent 70%), var(--surface); }
.dv-hero::before { content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1.5px; z-index: -1; pointer-events: none;
  background: conic-gradient(from var(--dv-a), #6366f1, #a855f7, #ec4899, #f97316, #6366f1);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude;
  animation: dv-spin 9s linear infinite; opacity: .8; }
@keyframes dv-spin { to { --dv-a: 360deg; } }
@keyframes dv-pop { 0% { transform: scale(.96); opacity: .4; } 60% { transform: scale(1.015); } 100% { transform: none; opacity: 1; } }
@keyframes dv-sweep { from { background-position: 150% 0; } to { background-position: -50% 0; } }
@keyframes dv-rise { from { opacity: 0; transform: translateY(10px); } }
@keyframes dv-fade { from { opacity: 0; } }
.dv-pop { animation: dv-pop .35s var(--spring); }
.dv-stagger > * { animation: dv-rise .45s var(--ease) both; animation-delay: calc(var(--i, 0) * 35ms); }

/* Output box with a header bar */
.dv-out { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); overflow: hidden; min-width: 0; position: relative; }
.dv-out-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 8px 7px 14px; background: var(--surface-2); border-bottom: 1px solid var(--border); font-size: 12.5px; font-weight: 600; color: var(--text-2); min-height: 44px; flex-wrap: wrap; }
.dv-out-head .acts { display: flex; gap: 6px; flex-wrap: wrap; }
.dv-out-body { margin: 0; padding: 14px; font-family: var(--mono); font-size: 13px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 460px; overflow: auto; min-height: 56px; position: relative; }
.dv-out.flash .dv-out-body::after { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 2px; background: linear-gradient(90deg, transparent, var(--accent), var(--accent-2), transparent); background-size: 60% 100%; background-repeat: no-repeat; animation: dv-sweep .7s var(--ease); }
.dv-out textarea.dv-out-body { display: block; width: 100%; border: 0; outline: none; background: transparent; resize: vertical; color: inherit; min-height: 140px; }
.dv-ph { color: var(--muted); }

/* Click to copy rows */
.dv-copy { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; padding: 10px 12px; min-height: 44px; border: 1px solid var(--border); border-radius: 13px; background: var(--surface); cursor: pointer; color: inherit;
  transition: border-color .2s, transform .2s var(--spring), box-shadow .2s, background .2s; }
.dv-copy:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); transform: translateY(-1px); box-shadow: var(--shadow); }
.dv-copy:active { transform: scale(.985); }
.dv-copy .k { font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); min-width: 52px; flex: none; }
.dv-copy .v { font-family: var(--mono); font-size: 13px; flex: 1; min-width: 0; overflow-wrap: anywhere; }
.dv-copy .ic { color: var(--muted); flex: none; transition: transform .3s var(--spring), color .2s; }
.dv-copy:hover .ic { color: var(--accent); }
.dv-copy.done { border-color: color-mix(in srgb, var(--success) 50%, var(--border)); background: var(--success-soft); }
.dv-copy.done .ic { color: var(--success); transform: scale(1.25) rotate(-8deg); }

/* Chips */
.dv-chips { display: flex; flex-wrap: wrap; gap: 7px; }
.dv-chip { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--text-2); font-size: 13px; font-weight: 520; cursor: pointer;
  transition: transform .2s var(--spring), border-color .2s, background .2s, color .2s, box-shadow .2s; }
.dv-chip:hover { border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); transform: translateY(-1px); color: var(--text); }
.dv-chip:active { transform: scale(.96); }
.dv-chip[aria-pressed="true"], .dv-chip.on { background: var(--text); color: var(--bg); border-color: var(--text); }
.dv-chip .icon { width: 14px; height: 14px; }
.dv-chip.mono { font-family: var(--mono); font-size: 12.5px; }

/* Key/value grid */
.dv-kv { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 7px 16px; font-size: 13.5px; align-items: baseline; }
.dv-kv dt { color: var(--muted); font-size: 12.5px; }
.dv-kv dd { margin: 0; font-family: var(--mono); font-size: 13px; overflow-wrap: anywhere; }

/* JSON syntax colours */
.dv-json .k { color: var(--accent); }
.dv-json .s { color: var(--success); }
.dv-json .n { color: var(--warning); }
.dv-json .b { color: var(--accent-2); }
.dv-json .z { color: var(--muted); }

/* Little status pill */
.dv-pill { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; border-radius: 999px; font-size: 12px; font-weight: 600; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-2); white-space: nowrap; }
.dv-pill .icon { width: 13px; height: 13px; }
.dv-pill.ok { color: var(--success); background: var(--success-soft); border-color: color-mix(in srgb, var(--success) 30%, transparent); }
.dv-pill.bad { color: var(--danger); background: var(--danger-soft); border-color: color-mix(in srgb, var(--danger) 30%, transparent); }
.dv-pill.warn { color: var(--warning); background: var(--warning-soft); border-color: color-mix(in srgb, var(--warning) 30%, transparent); }
.dv-pill.info { color: var(--info); background: var(--info-soft); border-color: color-mix(in srgb, var(--info) 30%, transparent); }
.dv-live { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 0 rgba(34, 197, 94, .6); animation: pulse 2s infinite; display: inline-block; }

.dv-textarea { font-family: var(--mono); font-size: 13px; }
.dv-grow { flex: 1; min-width: 0; }
.dv-sticky-bar { position: sticky; top: calc(var(--header-h) + 8px); z-index: 5; }
.dv-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.dv-table-actions { display: flex; gap: 4px; justify-content: flex-end; }
.dv-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); gap: 12px; }
@media (max-width: 520px) { .dv .tabs button { padding: 11px 9px; font-size: 13.5px; } }
@media (prefers-reduced-motion: reduce) { .dv-hero::before { animation: none; } }
`

/** Inject a stylesheet once (id keeps it unique). */
export function css(id, text) {
  if (document.getElementById(id)) return
  const el = document.createElement('style')
  el.id = id
  el.textContent = text
  document.head.append(el)
}
export const useKit = () => css('dv-kit', CSS)

export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** Query parameters of the current tool link: #/tool-id?x=1 */
export const hashParams = () => new URLSearchParams((location.hash.split('?')[1]) || '')

/** Click-to-copy row: label, mono value, copy icon that turns into a check. */
export function copyRow(label, getValue, opts = {}) {
  const v = h('span', { class: 'v' })
  const ic = h('span', { class: 'ic' }, icon('copy'))
  const el = h('button', { type: 'button', class: ['dv-copy', opts.class], title: `Copy ${label}`, 'aria-label': `Copy ${label}`, style: opts.style }, label && h('span', { class: 'k' }, label), v, ic)
  const read = () => (typeof getValue === 'function' ? getValue() : getValue)
  el.set = (value) => { v.textContent = value ?? ''; el.disabled = !value }
  el.set(opts.initial ?? read())
  el.addEventListener('click', async () => {
    const text = read() ?? v.textContent
    if (!text) return
    if (await copyText(String(text))) {
      el.classList.add('done')
      ic.replaceChildren(icon('check'))
      setTimeout(() => { el.classList.remove('done'); ic.replaceChildren(icon('copy')) }, 1300)
    }
  })
  return el
}

/**
 * outBox('Result', {actions: [buttons], mono: true, editable: false})
 * -> {el, set(text), get(), body}. A framed output with a header bar, copy button and a short "updated" sweep.
 */
export function outBox(label, opts = {}) {
  const { actions = [], copy = true, editable = false, placeholder = '', download: dl } = opts
  const body = editable ? h('textarea', { class: 'dv-out-body', spellcheck: false, 'aria-label': label, placeholder }) : h('pre', { class: 'dv-out-body', tabindex: 0, 'aria-label': label })
  const head = h('div', { class: 'dv-out-head' }, h('span', label), h('div', { class: 'acts' }, actions))
  const api = { el: h('div', { class: 'dv-out' }, head, body), body, head }
  let text = ''
  api.get = () => (editable ? body.value : text)
  api.set = (t, o = {}) => {
    text = t ?? ''
    if (editable) body.value = text
    else {
      body.textContent = text
      body.classList.toggle('dv-ph', !text)
      if (!text && placeholder) body.textContent = placeholder
    }
    if (!o.quiet && text && !reduceMotion()) {
      api.el.classList.remove('flash')
      void api.el.offsetWidth
      api.el.classList.add('flash')
    }
    for (const b of head.querySelectorAll('[data-needs-text]')) b.disabled = !text
  }
  const acts = head.querySelector('.acts')
  if (copy) {
    const b = button('Copy', { icon: 'copy', size: 'sm', onClick: () => api.get() && copyText(api.get()) })
    b.dataset.needsText = '1'
    acts.append(b)
  }
  if (dl) {
    const b = button('', { icon: 'download', size: 'sm', variant: 'ghost', ariaLabel: `Download ${label}`, onClick: () => api.get() && download(api.get(), dl.name || 'output.txt', dl.type || 'text/plain') })
    b.dataset.needsText = '1'
    acts.append(b)
  }
  api.set('', { quiet: true })
  return api
}

/** A row of toggle chips. chips([['a','A'],['b','B']], {multi, value, onChange}) -> el with .value (string | Set) and .set(v) */
export function chips(options, opts = {}) {
  const { multi = false, onChange, ariaLabel, mono = false } = opts
  const el = h('div', { class: 'dv-chips', role: 'group', 'aria-label': ariaLabel || null })
  el.value = multi ? new Set(opts.value || []) : opts.value
  const btns = options.map((o) => {
    const [v, l, title] = Array.isArray(o) ? o : [o, o]
    const b = h('button', { type: 'button', class: ['dv-chip', mono && 'mono'], title: title || null, 'aria-pressed': 'false' }, l)
    b._v = v
    b.addEventListener('click', () => {
      if (multi) { el.value.has(v) ? el.value.delete(v) : el.value.add(v) } else el.value = v
      paint()
      onChange?.(el.value, v)
    })
    return b
  })
  const paint = () => { for (const b of btns) b.setAttribute('aria-pressed', String(multi ? el.value.has(b._v) : el.value === b._v)) }
  el.set = (v) => { el.value = multi ? new Set(v) : v; paint() }
  el.append(...btns)
  paint()
  return el
}

const JSON_TOKEN = /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g
/** Pretty JSON text -> <pre class="dv-json"> with syntax colours (built with text nodes, safe for any input). */
export function jsonView(text, cls = '') {
  const pre = h('pre', { class: ['dv-out-body', 'dv-json', cls], tabindex: 0 })
  let last = 0
  for (const m of text.matchAll(JSON_TOKEN)) {
    if (m.index > last) pre.append(text.slice(last, m.index))
    const t = m[0]
    const cl = m[2] ? 'k' : t[0] === '"' ? 's' : t === 'null' ? 'z' : t === 'true' || t === 'false' ? 'b' : 'n'
    pre.append(h('span', { class: cl }, m[2] ? t.slice(0, t.length - m[2].length) : t), m[2] || '')
    last = m.index + t.length
  }
  if (last < text.length) pre.append(text.slice(last))
  return pre
}

/** Letters shuffle for a moment, then settle on the final text. */
export function scramble(el, finalText, ms = 380) {
  if (reduceMotion() || !finalText || finalText.length > 120) { el.textContent = finalText; return }
  const chars = '0123456789abcdef'
  const start = performance.now()
  const id = (el._scr = (el._scr || 0) + 1)
  const tick = (now) => {
    if (el._scr !== id) return
    const p = Math.min(1, (now - start) / ms)
    const fixed = Math.floor(p * finalText.length)
    let s = finalText.slice(0, fixed)
    for (let i = fixed; i < finalText.length; i++) s += /[a-z0-9]/i.test(finalText[i]) ? chars[(Math.random() * 16) | 0] : finalText[i]
    el.textContent = s
    if (p < 1) requestAnimationFrame(tick)
    else el.textContent = finalText
  }
  requestAnimationFrame(tick)
}

/** Section heading with an icon. */
export const eyebrow = (ic, text) => h('div', { class: 'dv-eyebrow' }, icon(ic), text)

/** Status pill. pill('ok', 'check', 'Valid') */
export const pill = (kind, ic, text, title) => h('span', { class: ['dv-pill', kind], title: title || null }, ic && icon(ic), text)

/** Small text helper used by several tools. */
export const utf8 = new TextEncoder()
export const utf8d = new TextDecoder('utf-8', { fatal: true })
export const hex = (bytes, sep = '') => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(sep)
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
export const pad = (n, w = 2) => String(n).padStart(w, '0')
export const toastOk = (msg) => toast(msg, 'success')

/** Download text as a file. */
export const saveText = (text, name, type = 'text/plain') => download(text, name, type)
