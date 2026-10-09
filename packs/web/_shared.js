// Shared helpers for the web pack: styles, the glow "omnibar", API fetch helpers, small widgets.
// Files starting with "_" are never tool modules. Promote to lib/ later if other packs want them.
import { h, icon, button, busy, clear, copyText, toast } from '../../lib/ui.js'
import { persisted } from '../../lib/store.js'

// ---------- Styles (one <style>, every class is prefixed wt-) ----------
const CSS = `
@property --wt-a { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
@keyframes wt-spin { to { --wt-a: 360deg; } }
@keyframes wt-shimmer { to { background-position: -200% 0; } }
@keyframes wt-pop { 0% { transform: scale(.96); opacity: .4; } 60% { transform: scale(1.012); } 100% { transform: none; opacity: 1; } }
@keyframes wt-pulse { 0% { box-shadow: 0 0 0 0 var(--wt-pulse, rgba(34,197,94,.55)); } 70% { box-shadow: 0 0 0 10px rgba(34,197,94,0); } 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); } }
@keyframes wt-drift { to { transform: translate(-8%, 6%) scale(1.15); } }
@keyframes wt-draw { from { stroke-dashoffset: var(--len, 400); } to { stroke-dashoffset: 0; } }
@keyframes wt-fade { from { opacity: 0; } }

.wt-omni { --wt-grad: conic-gradient(from var(--wt-a), #6366f1, #a855f7, #ec4899, #f97316, #6366f1);
  position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px;
  padding: 6px 6px 6px 18px; border-radius: 999px; background: var(--surface); border: 1px solid var(--border);
  box-shadow: var(--shadow); isolation: isolate; transition: box-shadow .3s var(--ease), border-color .3s; }
.wt-omni::before { content: ""; position: absolute; inset: -2px; border-radius: inherit; background: var(--wt-grad); z-index: -2; opacity: 0; transition: opacity .35s; animation: wt-spin 5s linear infinite; }
.wt-omni::after { content: ""; position: absolute; inset: 0; border-radius: inherit; background: var(--surface); z-index: -1; }
.wt-omni:focus-within { border-color: transparent; box-shadow: 0 18px 44px -20px color-mix(in srgb, var(--accent) 70%, transparent); }
.wt-omni:focus-within::before { opacity: 1; }
.wt-omni > .icon { color: var(--muted); transition: color .2s, transform .3s var(--spring); }
.wt-omni:focus-within > .icon { color: var(--accent); transform: scale(1.12); }
.wt-omni input { border: 0; outline: 0; background: transparent; height: 46px; min-width: 0; width: 100%; font-size: 16px; color: var(--text); }
.wt-omni .btn { border-radius: 999px; height: 46px; padding: 0 22px; }
@media (max-width: 560px) {
  .wt-omni { grid-template-columns: auto minmax(0, 1fr); border-radius: 24px; padding: 6px 6px 6px 16px; row-gap: 4px; }
  .wt-omni .btn { grid-column: 1 / -1; width: 100%; border-radius: 18px; }
}

.wt-note { font-size: 12.5px; color: var(--muted); display: flex; gap: 6px; align-items: flex-start; overflow-wrap: anywhere; }
.wt-note > span { min-width: 0; flex: 1; }
.wt-note .icon { width: 14px; height: 14px; flex: none; margin-top: 2px; }
.wt-kicker { font-size: 11.5px; letter-spacing: .09em; text-transform: uppercase; font-weight: 650; color: var(--muted); }
.wt-rise { animation: rise .55s var(--ease) both; animation-delay: calc(var(--i, 0) * 55ms); }
.wt-skel { border-radius: 12px; min-height: 18px; background: linear-gradient(100deg, var(--surface-2) 30%, var(--surface-3) 50%, var(--surface-2) 70%); background-size: 200% 100%; animation: wt-shimmer 1.3s linear infinite; }

.wt-pill { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-2); white-space: nowrap; line-height: 1.4; }
.wt-pill .icon { width: 13px; height: 13px; }
.wt-pill.ok { color: var(--success); background: var(--success-soft); border-color: color-mix(in srgb, var(--success) 28%, transparent); }
.wt-pill.bad { color: var(--danger); background: var(--danger-soft); border-color: color-mix(in srgb, var(--danger) 28%, transparent); }
.wt-pill.warn { color: var(--warning); background: var(--warning-soft); border-color: color-mix(in srgb, var(--warning) 30%, transparent); }
.wt-pill.info { color: var(--info); background: var(--info-soft); border-color: color-mix(in srgb, var(--info) 28%, transparent); }
.wt-pill.accent { color: var(--accent); background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 28%, transparent); }

.wt-chips { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.wt-chip-t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.wt-chip { max-width: 100%; display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 0 13px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--text-2); font-size: 13.5px; cursor: pointer; transition: transform .25s var(--spring), border-color .2s, background .2s, color .2s; }
.wt-chip:hover { border-color: var(--border-strong); transform: translateY(-1px); }
.wt-chip:active { transform: scale(.96); }
.wt-chip .icon { width: 15px; height: 15px; }
.wt-chip[aria-pressed="true"] { background: var(--text); color: var(--bg); border-color: var(--text); }
.wt-chip.soft[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, transparent); }

.wt-kv { border: 1px solid var(--border); border-radius: 16px; overflow: hidden; background: var(--surface); }
.wt-kv-row { display: grid; grid-template-columns: minmax(96px, 170px) minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 8px 8px 8px 14px; border-bottom: 1px solid var(--border); min-height: 46px; }
.wt-kv-row:last-child { border-bottom: 0; }
.wt-kv-row .k { color: var(--muted); font-size: 13px; }
.wt-kv-row .v { min-width: 0; overflow-wrap: anywhere; font-size: 14px; }
.wt-kv-row .v.mono { font-family: var(--mono); font-size: 13px; }
.wt-kv-row .btn { opacity: .55; }
.wt-kv-row:hover .btn { opacity: 1; }
@media (max-width: 520px) { .wt-kv-row { grid-template-columns: minmax(0, 1fr) auto; row-gap: 0; } .wt-kv-row .k { grid-column: 1 / -1; font-size: 12px; } .wt-kv-row .btn { opacity: 1; } }

.wt-mesh { position: relative; overflow: hidden; isolation: isolate; border-radius: var(--radius-xl); border: 1px solid var(--border); background: var(--surface); }
.wt-mesh::before, .wt-mesh::after { content: ""; position: absolute; z-index: -1; width: 60%; aspect-ratio: 1; border-radius: 50%; filter: blur(46px); opacity: .5; pointer-events: none; animation: wt-drift 14s ease-in-out infinite alternate; }
.wt-mesh::before { top: -30%; right: -10%; background: color-mix(in srgb, var(--wt-c1, var(--accent)) 38%, transparent); }
.wt-mesh::after { bottom: -40%; left: -12%; background: color-mix(in srgb, var(--wt-c2, var(--accent-2)) 30%, transparent); animation-duration: 18s; animation-direction: alternate-reverse; }

.wt-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); }
.wt-tile { padding: 14px 16px; border-radius: 18px; background: var(--surface); border: 1px solid var(--border); min-width: 0; transition: transform .3s var(--ease), box-shadow .3s, border-color .3s; }
.wt-tile:hover { transform: translateY(-2px); box-shadow: var(--shadow); border-color: var(--border-strong); }
.wt-tile .t-top { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12.5px; font-weight: 550; }
.wt-tile .t-top .icon { width: 15px; height: 15px; color: var(--accent); }
.wt-tile .t-val { font-size: 17px; font-weight: 600; letter-spacing: -.02em; margin-top: 6px; overflow-wrap: anywhere; }
.wt-tile .t-sub { font-size: 12.5px; color: var(--muted); margin-top: 2px; overflow-wrap: anywhere; }

.wt-code { margin: 0; padding: 14px 16px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--border); font-family: var(--mono); font-size: 13px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 420px; overflow: auto; }
.wt-link { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; overflow-wrap: anywhere; }
.wt-empty-hero { text-align: center; padding: 34px 16px; color: var(--muted); }
.wt-spark { display: block; width: 100%; height: 44px; overflow: visible; }
.wt-spark path { stroke-linecap: round; stroke-linejoin: round; }
.wt-spark .line { stroke-dasharray: var(--len, 600); animation: wt-draw 1s var(--ease) both; }
@media (prefers-reduced-motion: reduce) { .wt-omni::before, .wt-mesh::before, .wt-mesh::after { animation: none; } }
`

export function ensureStyle() {
  if (document.getElementById('wt-style')) return
  document.head.append(h('style', { id: 'wt-style' }, CSS))
}

// ---------- Small widgets ----------
/** pill('Valid', 'ok'|'bad'|'warn'|'info'|'accent'|'', 'circle-check') */
export const pill = (text, tone = '', ic) => h('span', { class: ['wt-pill', tone] }, ic && icon(ic), text)

/** note('Service name and caveat', 'info') - small muted line with an icon. */
export const note = (...kids) => h('div', { class: 'wt-note' }, icon('info'), h('span', kids))

/** Row of buttons that behave like pressed/unpressed chips. chips([['a','A',icon?]], 'a', onPick) -> el with .set(v) .value */
export function chipGroup(options, value, onPick, { multi = false, soft = true, label } = {}) {
  const el = h('div', { class: 'wt-chips', role: 'group', 'aria-label': label || null })
  const sel = new Set(multi ? value : [value])
  const btns = options.map(([v, l, ic, title]) => {
    const b = h('button', { type: 'button', class: ['wt-chip', soft && 'soft'], 'aria-pressed': String(sel.has(v)), title: title || null, onclick: () => {
      if (multi) { sel.has(v) ? sel.delete(v) : sel.add(v) } else { sel.clear(); sel.add(v) }
      sync()
      onPick?.(multi ? [...sel] : v)
    } }, ic && icon(ic), l)
    b._v = v
    return b
  })
  const sync = () => { for (const b of btns) b.setAttribute('aria-pressed', String(sel.has(b._v))); el.value = multi ? [...sel] : [...sel][0] }
  el.append(...btns)
  el.set = (v) => { sel.clear(); for (const x of [].concat(v)) sel.add(x); sync() }
  el.value = multi ? [...sel] : value
  return el
}

/** key/value list with copy buttons. rows: [[key, value, {mono, copy}]] */
export function kvList(rows) {
  return h('div', { class: 'wt-kv' }, rows.filter((r) => r && r[1] != null && r[1] !== '').map(([k, v, o = {}]) => h('div', { class: 'wt-kv-row' },
    h('div', { class: 'k' }, k),
    h('div', { class: ['v', o.mono && 'mono'] }, v),
    o.copy === false ? h('span') : button('', { icon: 'copy', variant: 'ghost', size: 'sm', ariaLabel: `Copy ${k}`, onClick: () => copyText(o.copyValue ?? (v instanceof Node ? v.textContent : String(v))) }))))
}

/** Label + value tile used in bento grids. */
export const tile = (label, value, sub, ic, i = 0) => h('div', { class: 'wt-tile wt-rise', style: { '--i': i } },
  h('div', { class: 't-top' }, ic && icon(ic), label), h('div', { class: 't-val' }, value), sub && h('div', { class: 't-sub' }, sub))

/** SVG sparkline. points: numbers or null (null = failure, drawn as a red tick). */
export function sparkline(values, { width = 240, height = 44, color = 'var(--accent)', bad = 'var(--danger)' } = {}) {
  const nums = values.filter((v) => v != null)
  const max = Math.max(1, ...nums), min = Math.min(0, ...nums)
  const n = Math.max(2, values.length)
  const x = (i) => (i / (n - 1)) * width
  const y = (v) => height - 4 - ((v - min) / (max - min || 1)) * (height - 10)
  let d = ''
  let pen = false
  values.forEach((v, i) => { if (v == null) { pen = false; return } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`; pen = true })
  const el = h('svg', { class: 'wt-spark', viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Response time chart' })
  if (d) el.append(h('path', { class: 'line', d, fill: 'none', stroke: color, 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', style: { '--len': 1200 } }))
  values.forEach((v, i) => { if (v == null) el.append(h('rect', { x: x(i) - 1.5, y: 4, width: 3, height: height - 8, rx: 1.5, fill: bad, opacity: 0.85 })) })
  return el
}

/** Count a number up inside an element (respects reduced motion). */
export function countUp(el, to, { ms = 700, format = (n) => Math.round(n).toLocaleString() } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !Number.isFinite(to)) { el.textContent = format(to); return }
  const t0 = performance.now()
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ms)
    el.textContent = format(to * (1 - (1 - p) ** 3))
    if (p < 1 && el.isConnected) setTimeout(() => step(performance.now()), 16)
  }
  step(t0)
}

/**
 * The glow input bar. omnibar({icon, placeholder, label, value, inputmode, mono, onSubmit(value), errorTo, busyLabel, signal})
 * -> {el, input, btn, run(fn)}. onSubmit runs inside busy(); errors go to errorTo as an alert.
 */
export function omnibar(o = {}) {
  const inp = h('input', {
    type: o.type || 'text', value: o.value || '', placeholder: o.placeholder || '', 'aria-label': o.ariaLabel || o.placeholder || 'Input',
    inputmode: o.inputmode || null, autocomplete: 'off', autocapitalize: 'off', spellcheck: false, enterkeyhint: 'go', class: o.mono ? 'mono' : null,
  })
  const btn = button(o.label || 'Go', { icon: o.buttonIcon || 'arrow-right', variant: 'primary', size: 'lg' })
  const run = () => busy(btn, () => o.onSubmit(inp.value.trim()), { label: o.busyLabel || 'Working', errorTo: o.errorTo })
  btn.addEventListener('click', run)
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run() } })
  const el = h('div', { class: 'wt-omni' }, icon(o.icon || 'search'), inp, btn)
  return { el, input: inp, btn, run, set(v) { inp.value = v } }
}

// ---------- Network ----------
export class ApiError extends Error {
  constructor(message, extra = {}) { super(message); this.name = 'ApiError'; Object.assign(this, extra) }
}

/** fetch with a timeout that also covers reading the body, abortable by the page signal, with friendly errors. */
export async function request(url, { signal, timeout = 20000, read = 'json', allow = [], service = 'the service', ...init } = {}) {
  const ctl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ctl.abort() }, timeout)
  const onAbort = () => ctl.abort()
  if (signal?.aborted) ctl.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal })
    if (!res.ok && !allow.includes(res.status)) {
      let hint = ''
      try { hint = (await res.clone().text()).slice(0, 200) } catch { /* ignore */ }
      throw new ApiError(res.status === 429 ? `${service} says the free rate limit was reached. Wait a minute and try again.`
        : res.status >= 500 ? `${service} is having trouble right now (HTTP ${res.status}). Try again shortly.`
          : `${service} answered with HTTP ${res.status}.${hint && !hint.startsWith('<') ? ' ' + hint : ''}`, { status: res.status, headers: res.headers })
    }
    const body = read === 'json' ? await res.json() : read === 'text' ? await res.text() : read === 'blob' ? await res.blob() : read === 'none' ? null : res
    return read === 'response' ? res : { body, status: res.status, headers: res.headers, ok: res.ok }
  } catch (e) {
    if (e instanceof ApiError) throw e
    if (timedOut) throw new ApiError(`${service} took too long to answer (${Math.round(timeout / 1000)}s). Try again.`, { timeout: true })
    if (signal?.aborted || e?.name === 'AbortError') throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
    if (e instanceof SyntaxError) throw new ApiError(`${service} sent a reply this tool could not read.`)
    throw new ApiError(`Could not reach ${service}. Check your connection (an ad blocker can also block it) and try again.`, { network: true })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
export const getJSON = (url, o) => request(url, { ...o, read: 'json' }).then((r) => r.body)
export const getText = (url, o) => request(url, { ...o, read: 'text' }).then((r) => r.body)

// ---------- URLs ----------
/** Parse what a person typed into a web address. Throws a friendly Error. */
export function parseWebUrl(raw, { protocols = ['http:', 'https:'] } = {}) {
  let s = String(raw || '').trim()
  if (!s) throw new Error('Enter a web address first.')
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s.replace(/^\/\//, '')}`
  let u
  try { u = new URL(s) } catch { throw new Error('That does not look like a valid web address.') }
  if (!protocols.includes(u.protocol)) throw new Error(`Only ${protocols.map((p) => p.replace(':', '')).join(' and ')} addresses are supported.`)
  if (!u.hostname || (!u.hostname.includes('.') && !/^localhost$|^\[/.test(u.hostname))) throw new Error('That does not look like a valid web address. Try something like example.com.')
  return u
}

/** Extract a bare hostname from input like "https://www.Example.com/path?x". Returns ASCII (punycode) lowercase. */
export function parseDomain(raw) {
  const s = String(raw || '').trim()
  if (!s) throw new Error('Enter a domain first, for example example.com.')
  let u
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`) } catch { throw new Error('That does not look like a domain name.') }
  const host = u.hostname.replace(/\.$/, '').toLowerCase()
  if (!host.includes('.') || /[^a-z0-9.-]/.test(host)) throw new Error('That does not look like a domain name. Try something like example.com.')
  return host
}

export const isIPv4 = (s) => /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(s)
export const isIPv6 = (s) => /^[0-9a-f:]+(%\w+)?$/i.test(s) && s.includes(':') && (s.match(/::/g) || []).length <= 1 && s.split(':').length <= 8
export const isIP = (s) => isIPv4(s) || isIPv6(s)

// ---------- Dates ----------
export const fmtDate = (d, opts = { year: 'numeric', month: 'short', day: 'numeric' }) => (d ? new Date(d).toLocaleDateString(undefined, opts) : '-')
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-')
export const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000)
export function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// ---------- Recents ----------
/** Recent inputs saved on this device. rec.add(v), rec.get(), rec.clear() */
export function recents(key, max = 8) {
  const p = persisted(`web:${key}`, [])
  return {
    get: () => p.get(),
    add: (v) => p.update((l) => [v, ...l.filter((x) => JSON.stringify(x) !== JSON.stringify(v))].slice(0, max)),
    remove: (v) => p.update((l) => l.filter((x) => JSON.stringify(x) !== JSON.stringify(v))),
    clear: () => p.set([]),
  }
}

/** A row of recent-value chips that re-renders on demand. */
export function recentChips(rec, onPick, { label = 'Recent', fmt = (v) => v } = {}) {
  const el = h('div', { class: 'wt-chips', style: 'min-height:0' })
  const render = () => {
    const list = rec.get()
    clear(el)
    el.hidden = !list.length
    if (!list.length) return
    el.append(h('span', { class: 'wt-kicker' }, label), ...list.map((v) => h('button', { type: 'button', class: 'wt-chip', onclick: () => onPick(v), title: String(fmt(v)) }, h('span', { class: 'wt-chip-t' }, fmt(v)))),
      button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: `Clear ${label.toLowerCase()}`, title: 'Clear', onClick: () => { rec.clear(); render() } }))
  }
  render()
  el.refresh = render
  return el
}

// ---------- Misc ----------
export const slug = (s, max = 40) => String(s).toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, max) || 'file'
export const wait = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('Cancelled'), { code: 'ABORT' })) }, { once: true })
})

/** Copy an image blob to the clipboard (PNG). */
export async function copyImage(blob) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
    toast('Image copied to clipboard', 'success')
  } catch {
    toast('Could not copy the image here. Use Download instead.', 'error')
  }
}

/** Run an async job and swap a skeleton in meanwhile. */
export const skeleton = (lines = 3) => h('div', { class: 'stack', 'aria-hidden': 'true' }, Array.from({ length: lines }, (_, i) => h('div', { class: 'wt-skel', style: { height: i === 0 ? '28px' : '18px', width: i === 0 ? '55%' : `${92 - i * 14}%` } })))

// ---------- Shareable links (#/tool?q=value) ----------
/** Read a value from the tool's hash query, e.g. #/dns-lookup?q=example.com */
export const hashParam = (name) => { try { return new URLSearchParams(location.hash.split('?')[1] || '').get(name) || '' } catch { return '' } }
/** Update the hash query without triggering the router (replaceState does not fire hashchange). */
export function setHashParams(obj) {
  try {
    const base = location.hash.split('?')[0] || '#/'
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(obj)) if (v != null && v !== '') p.set(k, v)
    history.replaceState(history.state, '', `${location.pathname}${location.search}${base}${[...p].length ? `?${p}` : ''}`)
  } catch { /* ignore */ }
}

// ---------- Text repair ----------
const CP1252 = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f }
/** Some scrapers return UTF-8 text decoded as Windows-1252 ("Â·", "â€™"). Undo that when the text clearly shows it; otherwise return it unchanged. */
export function fixMojibake(s) {
  if (typeof s !== 'string' || !/[\u00c2\u00c3\u00e2][\u0080-\u00bf\u20ac\u201a-\u203a\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2122]/.test(s)) return s
  const bytes = []
  for (const ch of s) {
    const c = ch.codePointAt(0)
    if (c < 256) bytes.push(c)
    else if (CP1252[c]) bytes.push(CP1252[c])
    else return s
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)) } catch { return s }
}

/** Measure text width in px (canvas), used for SERP truncation. */
let measureCtx
export function textWidth(text, font = '20px Arial, sans-serif') {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  measureCtx.font = font
  return measureCtx.measureText(text).width
}
