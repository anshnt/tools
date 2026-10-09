// Shared helpers for the personal pack (not a tool). One design layer (pz-*), storage bar, drag-to-reorder,
// WebAudio alarm, confetti, charts, dates and money. Every tool in this pack builds on these.
import { h, svg, icon, button, modal, toast, copyText, download, onCleanup, input, field, clear } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { chartjs } from '../../lib/libs.js'

// ---------------------------------------------------------------- styles
const BASE_CSS = `
.pz{--tc:var(--accent);display:flex;flex-direction:column;gap:16px;min-width:0}
.pz-card{position:relative;background:var(--surface);border:1px solid var(--border);border-radius:22px;padding:18px;box-shadow:var(--shadow-sm);min-width:0}
.pz-card.tint{background:radial-gradient(130% 120% at 0% 0%,color-mix(in srgb,var(--tc) 15%,var(--surface)),var(--surface) 62%);border-color:color-mix(in srgb,var(--tc) 24%,var(--border))}
.pz-card.flush{padding:0;overflow:hidden}
.pz-card.lift{transition:transform .3s var(--ease),box-shadow .3s var(--ease),border-color .3s}
.pz-card.lift:hover{transform:translateY(-3px);box-shadow:var(--shadow);border-color:color-mix(in srgb,var(--tc) 35%,var(--border))}
.pz-title{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:650;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin:0 0 12px}
.pz-title .icon{width:15px;height:15px;color:var(--tc)}
.pz-title .grow{flex:1;min-width:0}
.pz-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.pz-row.nowrap{flex-wrap:nowrap}
.pz-grow{flex:1;min-width:0}
.pz-cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start}
.pz-cols.wide-l{grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)}
.pz-cols.wide-r{grid-template-columns:minmax(0,1fr) minmax(0,1.5fr)}
@media (max-width:900px){.pz-cols,.pz-cols.wide-l,.pz-cols.wide-r{grid-template-columns:minmax(0,1fr)}}
.pz-bento{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:12px}
.pz-stat{position:relative;overflow:hidden;padding:15px 16px;border-radius:20px;background:var(--surface);border:1px solid var(--border);isolation:isolate;transition:transform .3s var(--ease),box-shadow .3s;min-width:0}
.pz-stat::before{content:"";position:absolute;right:-26px;top:-26px;width:96px;height:96px;border-radius:50%;background:color-mix(in srgb,var(--tone,var(--tc)) 16%,transparent);z-index:-1;transition:transform .6s var(--ease)}
.pz-stat:hover{transform:translateY(-2px);box-shadow:var(--shadow)}
.pz-stat:hover::before{transform:scale(1.5)}
.pz-stat .l{font-size:12.5px;color:var(--muted);display:flex;align-items:center;gap:6px}
.pz-stat .l .icon{width:14px;height:14px;color:var(--tone,var(--tc))}
.pz-stat .v{font-size:26px;font-weight:680;letter-spacing:-.035em;margin-top:4px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;line-height:1.1}
.pz-stat .s{font-size:12px;color:var(--muted);margin-top:3px}
.pz-stat .s:empty{display:none}
.pz-stat.ok{--tone:var(--success)}.pz-stat.warn{--tone:var(--warning)}.pz-stat.bad{--tone:var(--danger)}.pz-stat.info{--tone:var(--info)}
.pz-stat.lead{background:linear-gradient(140deg,color-mix(in srgb,var(--tone,var(--tc)) 18%,var(--surface)),var(--surface));border-color:color-mix(in srgb,var(--tone,var(--tc)) 30%,var(--border))}
.pz-stat.lead .v{color:var(--tone,var(--tc))}
.pz-chips{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.pz-chips.scroll{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;padding:2px 2px 4px;margin:-2px;-webkit-overflow-scrolling:touch}
.pz-chips.scroll::-webkit-scrollbar{display:none}
.pz-chip{flex:none;display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:0 14px;border-radius:999px;border:1px solid var(--border);background:var(--surface);color:var(--text-2);font-size:13.5px;font-weight:550;cursor:pointer;transition:all .2s var(--ease);white-space:nowrap}
.pz-chip:hover{border-color:color-mix(in srgb,var(--tc) 45%,var(--border));transform:translateY(-1px)}
.pz-chip[aria-pressed="true"]{background:var(--text);color:var(--bg);border-color:var(--text)}
.pz-chip .icon{width:15px;height:15px}
.pz-chip.add{border-style:dashed;color:var(--muted)}
.pz-chip .dot{width:9px;height:9px;border-radius:50%;background:var(--dot,var(--tc));flex:none}
.pz-ib{width:34px;height:34px;display:inline-grid;place-items:center;border-radius:11px;border:1px solid transparent;background:transparent;color:var(--muted);cursor:pointer;flex:none;transition:all .2s var(--ease);padding:0}
.pz-ib:hover{background:var(--surface-2);color:var(--text)}
.pz-ib:active{transform:scale(.9)}
.pz-ib.danger:hover{background:var(--danger-soft);color:var(--danger)}
.pz-ib:disabled{opacity:.4;cursor:not-allowed}
.pz-ib .icon{width:16px;height:16px}
.pz-addbar{display:flex;align-items:center;gap:8px;padding:6px 6px 6px 18px;border-radius:999px;background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow);transition:box-shadow .25s,border-color .25s}
.pz-addbar:focus-within{border-color:var(--tc);box-shadow:0 0 0 4px color-mix(in srgb,var(--tc) 22%,transparent),var(--shadow)}
.pz-addbar input:focus-visible{outline:none}
.pz-addbar input{flex:1;min-width:0;border:0;background:transparent;outline:none;height:40px;font-size:15px}
.pz-addbar .btn{border-radius:999px;flex:none}
.pz-check{position:relative;flex:none;width:26px;height:26px;border-radius:50%;border:2px solid var(--border-strong);background:var(--surface);display:grid;place-items:center;cursor:pointer;padding:0;transition:background .25s,border-color .25s,transform .35s var(--spring)}
.pz-check::after{content:"";position:absolute;inset:-7px}
.pz-check:hover{border-color:var(--ck,var(--tc))}
.pz-check svg{width:15px;height:15px;fill:none;stroke:#fff;stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round}
.pz-check path{stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset .35s .06s var(--ease)}
.pz-check[aria-checked="true"]{background:var(--ck,var(--tc));border-color:var(--ck,var(--tc))}
.pz-check[aria-checked="true"] path{stroke-dashoffset:0}
.pz-check.pop{animation:pz-pop .45s var(--spring)}
@keyframes pz-pop{0%{transform:scale(.7)}60%{transform:scale(1.2)}100%{transform:scale(1)}}
.pz-empty{display:grid;place-items:center;gap:8px;text-align:center;padding:34px 16px;color:var(--muted);font-size:14px}
.pz-empty .orb{width:64px;height:64px;border-radius:22px;display:grid;place-items:center;color:var(--tc);background:color-mix(in srgb,var(--tc) 13%,var(--surface));border:1px solid color-mix(in srgb,var(--tc) 25%,var(--border));animation:pz-float 4s ease-in-out infinite}
.pz-empty .orb .icon{width:28px;height:28px}
.pz-empty b{color:var(--text);font-size:15.5px;font-weight:600}
@keyframes pz-float{50%{transform:translateY(-6px) rotate(-4deg)}}
.pz-rise{animation:pz-rise .45s var(--ease) both;animation-delay:calc(var(--i,0)*28ms)}
@keyframes pz-rise{from{opacity:0;transform:translateY(10px) scale(.98)}}
.pz-pop{animation:pz-pop .5s var(--spring) both}
.pz-grip{display:inline-grid;place-items:center;width:24px;height:32px;color:var(--muted);cursor:grab;touch-action:none;border-radius:8px;flex:none;user-select:none;-webkit-user-select:none}
.pz-grip:hover{color:var(--text);background:var(--surface-2)}
.pz-grip .icon{width:16px;height:16px}
.pz-dragging{opacity:.3}
.pz-ghost{box-shadow:var(--shadow-lg)!important;transform:rotate(1.2deg) scale(1.02);opacity:.96;background:var(--surface);cursor:grabbing}
.pz-ring{display:block;max-width:100%;height:auto}
.pz-ring circle{transition:stroke-dashoffset .5s var(--ease),stroke .3s}
.pz-databar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:12px 14px;border-radius:16px;border:1px dashed var(--border-strong);color:var(--muted);font-size:13px}
.pz-databar>span{display:inline-flex;align-items:center;gap:6px;flex:1;min-width:160px}
.pz-databar .icon{width:15px;height:15px}
.pz-tag{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border-radius:999px;font-size:11.5px;font-weight:550;background:color-mix(in srgb,var(--tg,var(--muted)) 13%,transparent);color:var(--tg,var(--text-2));white-space:nowrap}
.pz-tag .icon{width:12px;height:12px}
.pz-sw{display:inline-flex;gap:8px;flex-wrap:wrap}
.pz-sw button{width:30px;height:30px;border-radius:50%;border:2px solid transparent;background:var(--sw);cursor:pointer;padding:0;transition:transform .25s var(--spring),box-shadow .2s;box-shadow:0 0 0 2px var(--surface) inset}
.pz-sw button:hover{transform:scale(1.12)}
.pz-sw button[aria-pressed="true"]{border-color:var(--text);transform:scale(1.1)}
.pz-bar{height:8px;border-radius:999px;background:var(--surface-3);overflow:hidden}
.pz-bar>i{display:block;height:100%;width:0;border-radius:inherit;background:var(--bc,var(--tc));transition:width .6s var(--ease),background .3s}
.pz-note{font-size:12.5px;color:var(--muted)}
.pz-title .pz-note{text-transform:none;letter-spacing:0;font-weight:500}
.pz-printonly{display:none}
.pz-pop-in{animation:pz-rise .35s var(--ease) both}
@media print{
 .pz-noprint{display:none!important}
 .pz-printonly{display:block!important;font-size:22px;margin:0 0 10px}
 .pz{--surface:#fff;--surface-2:#f5f5f5;--surface-3:#e6e6e6;--text:#000;--text-2:#222;--muted:#555;--border:#ccc;--border-strong:#aaa;--bg:#fff;--shadow-sm:none;--shadow:none}
 .pz-card{box-shadow:none!important;break-inside:avoid}
 .page-head,.page-hero-bg,.tile{display:none!important}
}
`

export function css(id, text) {
  if (document.getElementById(id)) return
  const s = document.createElement('style')
  s.id = id
  s.textContent = text
  document.head.append(s)
}

/** Create the tool wrapper (.pz) with the pack's design layer and a tint color. */
export function app(root, name, tone) {
  css('pz-base', BASE_CSS)
  const el = h('div', { class: ['pz', `t-${name}`], style: tone ? { '--tc': tone } : null })
  root.append(el)
  return el
}

export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// ---------------------------------------------------------------- ids, randomness, math
export const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4)
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n))
export const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + f(x), 0)

/** Unbiased random integer in [0, n). */
export function rand(n) {
  const a = new Uint32Array(1)
  const lim = Math.floor(2 ** 32 / n) * n
  do crypto.getRandomValues(a); while (a[0] >= lim)
  return a[0] % n
}
export const randFloat = () => {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return a[0] / 2 ** 32
}
export function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

// ---------------------------------------------------------------- dates
export const pad = (n) => String(n).padStart(2, '0')
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parseYmd = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1) }
export const today = () => ymd(new Date())
export const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d) }
export const daysBetween = (a, b) => { const x = parseYmd(a), y = parseYmd(b); return Math.round((Date.UTC(y.getFullYear(), y.getMonth(), y.getDate()) - Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())) / 864e5) }
export const fmtDate = (s, o = { weekday: 'short', day: 'numeric', month: 'short' }) => (s ? parseYmd(s).toLocaleDateString(undefined, o) : '')
export const monthKey = (s) => s.slice(0, 7)
export const startOfWeek = (s, mondayFirst = true) => { const d = parseYmd(s); const k = (d.getDay() + (mondayFirst ? 6 : 0)) % 7; d.setDate(d.getDate() - k); return ymd(d) }
export const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
export const fmtTime = (t) => { if (!t) return ''; const [hh, mm] = t.split(':').map(Number); return new Date(2000, 0, 1, hh, mm).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) }

// ---------------------------------------------------------------- money
export const CURRENCIES = [['INR', '₹ INR - Indian rupee'], ['USD', '$ USD - US dollar'], ['EUR', '€ EUR - Euro'], ['GBP', '£ GBP - Pound'], ['AED', 'AED - Dirham'], ['AUD', 'A$ AUD'], ['CAD', 'C$ CAD'], ['SGD', 'S$ SGD'], ['JPY', '¥ JPY - Yen']]
const fmtCache = new Map()
export function money(n, cur = 'INR') {
  if (!Number.isFinite(n)) return '-'
  const k = cur + (Number.isInteger(n) ? 'i' : 'f')
  if (!fmtCache.has(k)) {
    try { fmtCache.set(k, new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : undefined, { style: 'currency', currency: cur, minimumFractionDigits: Number.isInteger(n) || cur === 'JPY' ? 0 : 2, maximumFractionDigits: cur === 'JPY' ? 0 : 2 })) } catch { fmtCache.set(k, { format: (x) => `${cur} ${x.toFixed(2)}` }) }
  }
  return fmtCache.get(k).format(n)
}
export const moneyShort = (n, cur = 'INR') => {
  const a = Math.abs(n)
  const sym = money(0, cur).replace(/[\d.,\s]/g, '')
  if (cur === 'INR') return a >= 1e7 ? `${sym}${(n / 1e7).toFixed(1)}Cr` : a >= 1e5 ? `${sym}${(n / 1e5).toFixed(1)}L` : a >= 1e3 ? `${sym}${(n / 1e3).toFixed(1)}k` : money(n, cur)
  return a >= 1e6 ? `${sym}${(n / 1e6).toFixed(1)}M` : a >= 1e3 ? `${sym}${(n / 1e3).toFixed(1)}k` : money(n, cur)
}
export const num = (n, d = 1) => (Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: d }) : '-')

// ---------------------------------------------------------------- storage
/** makeStore('key', fallback) -> {get(), set(v), save()}: mutate get() then call save(). */
export function makeStore(key, fallback, migrate) {
  let v = load(key, null)
  if (v == null || typeof v !== 'object') v = structuredClone(fallback)
  migrate?.(v)
  return { get: () => v, set(nv) { v = nv; save(key, v) }, save: () => save(key, v) }
}

export function confirmBox({ title, text, confirm = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    let ok = false
    const m = modal({
      title, icon: danger ? 'triangle-alert' : 'circle-help', body: h('p', { class: 'prose' }, text),
      actions: [button('Cancel', { onClick: () => m.close() }), button(confirm, { variant: danger ? 'danger' : 'primary', onClick: () => { ok = true; m.close() } })],
      onClose: () => resolve(ok),
    })
  })
}

export function promptBox({ title, label, value = '', placeholder = '', confirm = 'Save', type = 'text' }) {
  return new Promise((resolve) => {
    let out = null
    const inp = input({ value, placeholder, type, 'aria-label': label })
    const done = () => { out = inp.value.trim(); if (out) m.close() }
    const m = modal({
      title, body: field(label, inp),
      actions: [button('Cancel', { onClick: () => m.close() }), button(confirm, { variant: 'primary', onClick: done })],
      onClose: () => resolve(out || null),
    })
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done() })
    setTimeout(() => { inp.focus(); inp.select() }, 60)
  })
}

/** Export / import / clear row for a tool's local data. */
export function dataBar({ kind, get, set, reset, note = 'Saved on this device only.' }) {
  const fileIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]
    e.target.value = ''
    if (!f) return
    try {
      const j = JSON.parse(await f.text())
      if (!j || j.kind !== kind || !j.data) throw new Error(`This file is not a backup from this tool (expected "${kind}").`)
      set(j.data)
      toast('Backup imported', 'success')
    } catch (err) { toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message, 'error') }
  } })
  return h('div', { class: 'pz-databar pz-noprint' },
    h('span', icon('hard-drive'), note),
    button('Export', { icon: 'download', size: 'sm', title: 'Download a JSON backup', onClick: () => download(JSON.stringify({ app: 'tools-personal', kind, version: 1, exportedAt: new Date().toISOString(), data: get() }, null, 2), `${kind}-backup-${today()}.json`, 'application/json') }),
    button('Import', { icon: 'upload', size: 'sm', title: 'Restore from a JSON backup', onClick: () => fileIn.click() }),
    button('Clear all', { icon: 'trash-2', size: 'sm', variant: 'ghost', onClick: async () => { if (await confirmBox({ title: 'Clear all data?', text: 'This removes everything this tool saved on this device. Export a backup first if you might need it.', confirm: 'Clear everything' })) { reset(); toast('All data cleared') } } }),
    fileIn)
}

// ---------------------------------------------------------------- small components
/** Icon button (34px). */
export const ib = (ic, label, onClick, cls = '') => h('button', { type: 'button', class: ['pz-ib', cls], title: label, 'aria-label': label, onclick: onClick }, icon(ic))

export const chip = (label, { pressed, onClick, ic, dot, add, title } = {}) => h('button', { type: 'button', class: ['pz-chip', add && 'add'], 'aria-pressed': pressed == null ? null : String(!!pressed), title, onclick: onClick, style: dot ? { '--dot': dot } : null }, dot && h('i', { class: 'dot' }), ic && icon(ic), label)

/** Animated round checkbox. */
export function checkBtn(checked, onToggle, label, color) {
  const b = h('button', { type: 'button', class: 'pz-check', role: 'checkbox', 'aria-checked': String(!!checked), 'aria-label': label, style: color ? { '--ck': color } : null,
    onclick: () => {
      const v = b.getAttribute('aria-checked') !== 'true'
      b.setAttribute('aria-checked', String(v))
      b.classList.remove('pop')
      void b.offsetWidth
      if (v) b.classList.add('pop')
      onToggle(v, b)
    } }, svg('svg', { viewBox: '0 0 24 24' }, svg('path', { d: 'M5 12.5l4.5 4.5L19 7.5', pathLength: 1 })))
  return b
}

/** stat({label, value, hint, icon, tone: ok|warn|bad|info, hero}) -> element with .set(value, hint, tone). */
export function stat({ label, value, hint = '', icon: ic, tone, hero } = {}) {
  const v = h('div', { class: 'v' }, value)
  const s = h('div', { class: 's' }, hint)
  const el = h('div', { class: ['pz-stat', tone, hero && 'lead'] }, h('div', { class: 'l' }, ic && icon(ic), h('span', label)), v, s)
  el.set = (nv, nh, nt) => {
    v.textContent = nv
    if (nh != null) s.textContent = nh
    if (nt !== undefined) el.className = ['pz-stat', nt, hero && 'lead'].filter(Boolean).join(' ')
  }
  el.tween = (to, fmt = (x) => String(Math.round(x)), nh, nt) => { tween(v, to, fmt); if (nh != null) s.textContent = nh; if (nt !== undefined) el.className = ['pz-stat', nt, hero && 'lead'].filter(Boolean).join(' ') }
  return el
}

/** Animate a number inside el. */
export function tween(el, to, fmt = (x) => String(Math.round(x)), ms = 500) {
  const from = Number.isFinite(el._v) ? el._v : 0
  el._v = to
  if (reduceMotion() || from === to || !Number.isFinite(to)) { el.textContent = fmt(to); return }
  const t0 = performance.now()
  const id = (el._tw = (el._tw || 0) + 1)
  const step = (t) => {
    if (el._tw !== id) return
    const p = clamp((t - t0) / ms, 0, 1)
    const e = 1 - (1 - p) ** 3
    el.textContent = fmt(from + (to - from) * e)
    if (p < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
  setTimeout(() => { if (el._tw === id) el.textContent = fmt(to) }, ms + 80)
}

export function emptyState(title, text, ic = 'sparkles') {
  return h('div', { class: 'pz-empty' }, h('div', { class: 'orb' }, icon(ic)), h('b', title), text && h('div', text))
}

/** Circular progress ring (SVG). el.set(fraction), el.arc is the moving circle. */
export function ring({ size = 120, stroke = 10, color = 'var(--tc)', track = 'var(--surface-3)' } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, m = size / 2
  const arc = svg('circle', { cx: m, cy: m, r, fill: 'none', stroke: color, 'stroke-width': stroke, 'stroke-linecap': 'round', 'stroke-dasharray': c, 'stroke-dashoffset': c, transform: `rotate(-90 ${m} ${m})` })
  const el = svg('svg', { viewBox: `0 0 ${size} ${size}`, class: 'pz-ring', width: size, height: size, 'aria-hidden': 'true' }, svg('circle', { cx: m, cy: m, r, fill: 'none', stroke: track, 'stroke-width': stroke }), arc)
  el.set = (f) => { arc.style.strokeDashoffset = String(c * (1 - clamp(f, 0, 1))) }
  el.arc = arc
  return el
}

export function bar(frac, color) {
  const i = h('i')
  const el = h('div', { class: 'pz-bar', style: color ? { '--bc': color } : null }, i)
  el.set = (f, c) => { i.style.width = `${clamp(f, 0, 1) * 100}%`; if (c) el.style.setProperty('--bc', c) }
  el.set(frac)
  return el
}

/** Swatch picker. */
export function swatches(colors, value, onPick) {
  const wrap = h('div', { class: 'pz-sw', role: 'group', 'aria-label': 'Color' })
  const bs = colors.map((c) => h('button', { type: 'button', style: { '--sw': c }, 'aria-label': c, 'aria-pressed': String(c === value), onclick: () => { wrap.value = c; bs.forEach((b, i) => b.setAttribute('aria-pressed', String(colors[i] === c))); onPick?.(c) } }))
  wrap.append(...bs)
  wrap.value = value
  return wrap
}
export const PALETTE = ['#6366f1', '#ec4899', '#f97316', '#10b981', '#0ea5e9', '#eab308', '#a855f7', '#ef4444', '#14b8a6', '#84cc16', '#f43f5e', '#64748b']

/** Chips for several documents (lists, trips, groups) with add / rename / delete. */
export function docTabs({ docs, activeId, noun = 'list', onSelect, onAdd, onRename, onDelete }) {
  const active = docs.find((d) => d.id === activeId)
  return h('div', { class: 'pz-chips scroll pz-noprint', role: 'group', 'aria-label': `Your ${noun}s` },
    docs.map((d) => chip(d.name, { pressed: d.id === activeId, onClick: () => onSelect(d.id) })),
    chip(`New ${noun}`, { ic: 'plus', add: true, onClick: onAdd }),
    active && ib('pencil', `Rename ${noun}`, onRename),
    active && docs.length > 1 && ib('trash-2', `Delete ${noun}`, onDelete, 'danger'))
}

// ---------------------------------------------------------------- drag to reorder
/**
 * sortable({root, containers: () => [els], item: '.row', handle: '.pz-grip', onDrop({id, from, to, ids})})
 * Pointer-based (mouse, touch, pen) reorder inside and between containers; items need data-id. The handle also
 * reacts to ArrowUp/ArrowDown. The DOM is moved live, onDrop reports the final order of the destination container.
 */
export function sortable({ root, containers, item, handle, onDrop }) {
  let drag = null
  const itemsOf = (c) => [...c.children].filter((el) => el.matches(item))
  const place = (c, y) => {
    const its = itemsOf(c).filter((x) => x !== drag.el)
    const before = its.find((x) => { const r = x.getBoundingClientRect(); return y < r.top + r.height / 2 })
    if (before) c.insertBefore(drag.el, before)
    else c.append(drag.el)
  }
  function down(e) {
    const hd = e.target.closest(handle)
    if (!hd || !root.contains(hd) || (e.pointerType === 'mouse' && e.button !== 0)) return
    const el = hd.closest(item)
    if (!el) return
    e.preventDefault()
    const r = el.getBoundingClientRect()
    const ghost = el.cloneNode(true)
    ghost.classList.add('pz-ghost')
    ghost.removeAttribute('data-id')
    ghost.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;z-index:700;pointer-events:none;margin:0`
    document.body.append(ghost)
    el.classList.add('pz-dragging')
    drag = { el, ghost, dx: e.clientX - r.left, dy: e.clientY - r.top, from: el.parentElement, before: el.nextElementSibling, scroll: 0 }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', up)
  }
  function move(e) {
    if (!drag) return
    drag.ghost.style.left = `${e.clientX - drag.dx}px`
    drag.ghost.style.top = `${e.clientY - drag.dy}px`
    drag.scroll = e.clientY < 70 ? -14 : e.clientY > innerHeight - 70 ? 14 : 0
    if (drag.scroll && !drag.raf) { const loop = () => { if (!drag || !drag.scroll) { if (drag) drag.raf = 0; return } scrollBy(0, drag.scroll); drag.raf = requestAnimationFrame(loop) }; drag.raf = requestAnimationFrame(loop) }
    const under = document.elementFromPoint(e.clientX, e.clientY)
    if (!under) return
    const cs = containers()
    const target = under.closest(item)
    if (target && target !== drag.el && cs.includes(target.parentElement)) {
      const r = target.getBoundingClientRect()
      target.parentElement.insertBefore(drag.el, e.clientY > r.top + r.height / 2 ? target.nextSibling : target)
    } else if (!target) {
      const c = cs.find((x) => x === under || x.contains(under))
      if (c) place(c, e.clientY)
    }
  }
  function up() {
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', up)
    document.removeEventListener('pointercancel', up)
    if (!drag) return
    const { el, ghost, from, before } = drag
    cancelAnimationFrame(drag.raf)
    ghost.remove()
    el.classList.remove('pz-dragging')
    const to = el.parentElement
    const moved = to !== from || el.nextElementSibling !== before
    drag = null
    if (moved) onDrop({ id: el.dataset.id, from, to, ids: itemsOf(to).map((x) => x.dataset.id) })
  }
  function key(e) {
    const hd = e.target.closest(handle)
    if (!hd || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    const el = hd.closest(item)
    const c = el.parentElement
    const sib = e.key === 'ArrowUp' ? el.previousElementSibling : el.nextElementSibling
    if (!sib || !sib.matches(item)) return
    e.preventDefault()
    if (e.key === 'ArrowUp') c.insertBefore(el, sib)
    else c.insertBefore(el, sib.nextSibling)
    const id = el.dataset.id
    onDrop({ id, from: c, to: c, ids: itemsOf(c).map((x) => x.dataset.id) })
    setTimeout(() => root.querySelector(`[data-id="${id}"] ${handle}`)?.focus(), 30)
  }
  root.addEventListener('pointerdown', down)
  root.addEventListener('keydown', key)
  const destroy = () => { root.removeEventListener('pointerdown', down); root.removeEventListener('keydown', key); document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up) }
  onCleanup(destroy)
  return destroy
}
export const grip = () => h('span', { class: 'pz-grip', tabindex: 0, role: 'button', title: 'Drag to reorder (or focus and press the arrow keys)', 'aria-label': 'Reorder' }, icon('grip-vertical'))

// ---------------------------------------------------------------- audio, notifications, timers
let ac
export function audio() {
  try {
    ac ||= new (window.AudioContext || window.webkitAudioContext)()
    if (ac.state === 'suspended') ac.resume().catch(() => {})
    return ac
  } catch { return null }
}
export function tone(freq, { at = 0, dur = 0.18, type = 'sine', gain = 0.22 } = {}) {
  const a = audio()
  if (!a) return
  const t = a.currentTime + at
  const o = a.createOscillator()
  const g = a.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(a.destination)
  o.start(t)
  o.stop(t + dur + 0.03)
}
export const chime = () => [660, 880, 1320].forEach((f, i) => tone(f, { at: i * 0.14, dur: 0.4 }))
/** Repeating alarm until stop() is called (or maxMs). */
export function alarm({ maxMs = 45000, freq = 988 } = {}) {
  let stopped = false
  const burst = () => { if (!stopped) [0, 0.22, 0.44].forEach((at) => tone(freq, { at, dur: 0.14, type: 'square', gain: 0.1 })) }
  burst()
  const iv = setInterval(burst, 1400)
  const to = setTimeout(stop, maxMs)
  function stop() { if (stopped) return; stopped = true; clearInterval(iv); clearTimeout(to) }
  onCleanup(stop)
  return stop
}
export async function askNotify() {
  if (!('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'default') { try { return await Notification.requestPermission() } catch { return 'denied' } }
  return Notification.permission
}
export function notify(title, body) {
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, tag: title }) } catch { /* some browsers need a service worker */ }
}
/** setInterval that is not throttled in background tabs (runs from a tiny Worker, falls back to setInterval). */
export function ticker(fn, ms = 250) {
  let w, iv
  const fallback = () => { if (!iv) iv = setInterval(fn, ms) }
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(()=>postMessage(0),${ms})`], { type: 'text/javascript' }))
    w = new Worker(url)
    w.onmessage = () => fn()
    w.onerror = () => { w.terminate(); w = null; fallback() }
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  } catch { fallback() }
  const stop = () => { w?.terminate(); w = null; clearInterval(iv); iv = 0 }
  onCleanup(stop)
  return stop
}
/** setTitle('12:30 Focus') shows it in the tab title; restored when you leave the tool. */
export function pageTitle() {
  const orig = document.title
  onCleanup(() => { document.title = orig })
  return (t) => { document.title = t ? `${t} | ${orig}` : orig }
}

// ---------------------------------------------------------------- confetti
export function confetti({ x = innerWidth / 2, y = innerHeight / 3, count = 90, power = 1, colors = PALETTE } = {}) {
  if (reduceMotion()) return
  const cv = document.createElement('canvas')
  const dpr = Math.min(devicePixelRatio || 1, 2)
  cv.width = innerWidth * dpr
  cv.height = innerHeight * dpr
  cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:800;pointer-events:none'
  document.body.append(cv)
  const ctx = cv.getContext('2d')
  ctx.scale(dpr, dpr)
  const ps = Array.from({ length: count }, () => {
    const a = randFloat() * Math.PI * 2, v = (3 + randFloat() * 9) * power
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 5 * power, w: 5 + randFloat() * 6, h: 3 + randFloat() * 5, r: randFloat() * 6, vr: (randFloat() - 0.5) * 0.4, c: colors[rand(colors.length)], life: 0, max: 70 + randFloat() * 50 }
  })
  let raf
  const tickf = () => {
    ctx.clearRect(0, 0, innerWidth, innerHeight)
    let alive = 0
    for (const p of ps) {
      p.life++
      if (p.life > p.max) continue
      alive++
      p.vy += 0.34
      p.vx *= 0.985
      p.x += p.vx
      p.y += p.vy
      p.r += p.vr
      ctx.save()
      ctx.globalAlpha = Math.min(1, (p.max - p.life) / 25)
      ctx.translate(p.x, p.y)
      ctx.rotate(p.r)
      ctx.fillStyle = p.c
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
      ctx.restore()
    }
    if (alive) raf = requestAnimationFrame(tickf)
    else cv.remove()
  }
  raf = requestAnimationFrame(tickf)
  setTimeout(() => { cancelAnimationFrame(raf); cv.remove() }, 4500)
}

// ---------------------------------------------------------------- sharing
export async function shareText(title, text) {
  if (navigator.share) {
    try { await navigator.share({ title, text }); return true } catch (e) { if (e?.name === 'AbortError') return false }
  }
  return copyText(text)
}

// ---------------------------------------------------------------- charts
export function chartColors() {
  const cs = getComputedStyle(document.documentElement)
  const g = (v) => cs.getPropertyValue(v).trim()
  return { text: g('--text-2') || '#444', muted: g('--muted') || '#777', grid: g('--border') || '#ddd', surface: g('--surface') || '#fff', accent: g('--accent') || '#5b4cf0', success: g('--success') || '#12804a', danger: g('--danger') || '#d92d20', font: g('--font') || 'sans-serif' }
}
/** Chart.js chart that follows the theme. build(colors) -> Chart config. api.refresh(newBuild?) re-renders. */
export async function makeChart(canvas, build) {
  const Chart = await chartjs()
  let chart
  const create = () => {
    chart?.destroy()
    const c = chartColors()
    Chart.defaults.font.family = c.font
    Chart.defaults.color = c.text
    chart = new Chart(canvas, build(c))
  }
  create()
  const mo = new MutationObserver(create)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  onCleanup(() => { mo.disconnect(); chart?.destroy(); chart = null })
  return {
    refresh(nb) {
      if (nb) build = nb
      if (!chart) return
      const cfg = build(chartColors())
      chart.data = cfg.data
      chart.options = cfg.options
      chart.update()
    },
    get chart() { return chart },
  }
}

// ---------------------------------------------------------------- misc
export const el = h
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const plural = (n, w, p = w + 's') => `${n} ${n === 1 ? w : p}`
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
export { clear }

// ---------------------------------------------------------------- clock formatting
/** 3725000 -> "1:02:05" (ceil to seconds). tenths adds one decimal ("12:05.3", floor). */
export function fmtClock(ms, { tenths = false, hours = 'auto' } = {}) {
  ms = Math.max(0, ms)
  const t = tenths ? Math.floor(ms / 100) / 10 : Math.ceil(ms / 1000)
  const s = Math.floor(t)
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60
  const frac = tenths ? `.${Math.floor((ms % 1000) / 100)}` : ''
  const body = `${pad(mm)}:${pad(ss)}${frac}`
  return hours === true || (hours === 'auto' && hh > 0) ? `${hh}:${body}` : body
}
/** "10m", "1h 30m", "90s", "1:30", "1:02:03", "25" (minutes) -> seconds, or NaN. */
export function parseDuration(str) {
  const s = String(str).trim().toLowerCase()
  if (!s) return NaN
  if (/^\d+(:\d{1,2}){1,2}$/.test(s)) { const p = s.split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1] }
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 60)
  const hm = s.match(/^(\d+)\s*h\s*(\d+)$/)
  if (hm) return +hm[1] * 3600 + +hm[2] * 60
  const re = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)\b/g
  let total = 0, found = false, m, used = ''
  while ((m = re.exec(s))) { found = true; used += m[0]; const n = parseFloat(m[1]); const u = m[2][0]; total += u === 'h' ? n * 3600 : u === 'm' ? n * 60 : n }
  return found && used.replace(/\s/g, '').length === s.replace(/[\s,]|and/g, '').length ? Math.round(total) : NaN
}
