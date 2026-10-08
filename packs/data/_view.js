// Shared UI for the data pack: step flow, data source (drop / paste / sample), virtual preview table, export bar,
// column chips, animated stat tiles. Styles are injected once and scoped under `dt-` class names.
import { h, icon, clear, button, busy, toast, alert, field, select, toggle, formatBytes, debounce, dropzone, download, copyText, errorMessage, onCleanup } from '../../lib/ui.js'
import {
  TABLE_ACCEPT, entryFromFile, entryFromText, reparse, DELIMITERS, ENCODINGS, delimiterLabel, encodingLabel, inferTypes, isNumericType, toCsv, toTsv,
  tableToJson, jsonText, pathLabel, plural,
} from './_table.js'
import { sampleFile } from './_samples.js'

// ---------- Styles ----------
const CSS = `
@property --dt-a { syntax: "<angle>"; initial-value: 0deg; inherits: false; }
.dt-flow { display: flex; flex-direction: column; --dt-g: linear-gradient(135deg, var(--accent), var(--accent-2)); }
.dt-step { position: relative; display: grid; grid-template-columns: 44px minmax(0, 1fr); column-gap: 16px; padding-bottom: 28px; }
.dt-step:last-child { padding-bottom: 0; }
.dt-step::before { content: ""; position: absolute; left: 21px; top: 52px; bottom: 8px; width: 2px; border-radius: 2px; background: linear-gradient(var(--border-strong), var(--border) 55%, transparent); transition: opacity .3s; }
.dt-step:last-child::before { display: none; }
.dt-step[data-state="locked"]::before { opacity: .45; }
.dt-num { width: 44px; height: 44px; border-radius: 14px; display: grid; place-items: center; font-weight: 700; font-size: 16px; font-variant-numeric: tabular-nums; color: var(--muted); background: var(--surface); border: 1px solid var(--border); transition: background .4s var(--ease), color .3s, box-shadow .4s, border-color .4s; }
.dt-step[data-state="ready"] .dt-num { color: #fff; border-color: transparent; background: var(--dt-g); box-shadow: 0 12px 26px -12px var(--accent), inset 0 1px 0 rgba(255,255,255,.3); }
.dt-step.dt-unlock .dt-num { animation: dtPop .65s var(--spring); }
.dt-step.dt-unlock .dt-body { animation: dtIn .55s var(--ease) both; }
.dt-head { display: flex; align-items: center; gap: 4px 12px; min-height: 44px; flex-wrap: wrap; min-width: 0; }
.dt-head h2 { font-size: 17px; letter-spacing: -.02em; transition: color .3s; }
.dt-sub { font-size: 13px; color: var(--muted); }
.dt-lock { display: none; align-items: center; gap: 6px; font-size: 12.5px; color: var(--muted); padding: 3px 10px 3px 8px; border-radius: 999px; border: 1px dashed var(--border-strong); }
.dt-lock .icon { width: 13px; height: 13px; }
.dt-step[data-state="locked"] .dt-lock { display: inline-flex; }
.dt-step[data-state="locked"] .dt-head h2 { color: var(--muted); }
.dt-step[data-state="locked"] .dt-body { display: none; }
.dt-body { grid-column: 2; margin-top: 8px; min-width: 0; display: flex; flex-direction: column; gap: 14px; }
@keyframes dtIn { from { opacity: 0; transform: translateY(14px); filter: blur(5px); } }
@keyframes dtPop { 0% { transform: scale(.7) rotate(-14deg); } 60% { transform: scale(1.12) rotate(4deg); } 100% { transform: none; } }
@keyframes dtShim { to { background-position: -200% 0; } }
@keyframes dtSpin { to { --dt-a: 360deg; } }
@keyframes dtGrid { to { background-position: 28px 28px; } }
@keyframes dtTick { to { stroke-dashoffset: 0; } }
.dt-in { animation: dtIn .5s var(--ease) both; }

.dt-drop { position: relative; border-radius: var(--radius-xl); isolation: isolate; }
.dt-drop::before { content: ""; position: absolute; inset: -2px; z-index: -1; border-radius: calc(var(--radius-xl) + 2px); opacity: 0; transition: opacity .35s; background: conic-gradient(from var(--dt-a), #6366f1, #a855f7, #ec4899, #f97316, #6366f1); animation: dtSpin 4s linear infinite; }
.dt-drop:hover::before, .dt-drop:has(.dropzone.drag)::before, .dt-drop:has(.dropzone:focus-visible)::before { opacity: 1; }
.dt-drop .dropzone { border-style: solid; border-color: var(--border); box-shadow: var(--shadow-sm); }
.dt-drop .dropzone:hover, .dt-drop .dropzone.drag { border-color: transparent; }
.dt-drop .dropzone::after { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; opacity: .5; background-image: linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px); background-size: 28px 28px; mask-image: radial-gradient(70% 85% at 50% 35%, #000, transparent); -webkit-mask-image: radial-gradient(70% 85% at 50% 35%, #000, transparent); animation: dtGrid 16s linear infinite; }
.dt-drop .dropzone.compact::after { display: none; }
.dt-src-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.dt-priv { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--muted); margin-left: auto; }
.dt-priv .icon { width: 14px; height: 14px; color: var(--success); }
.dt-paste { animation: dtIn .4s var(--ease) both; }
.dt-paste textarea { font-family: var(--mono); font-size: 13px; min-height: 150px; white-space: pre; overflow: auto; }

.dt-cards { display: flex; flex-direction: column; gap: 12px; }
.dt-cards:empty { display: none; }
.dt-fullcard { display: flex; flex-direction: column; gap: 0; border-radius: var(--radius-lg); border: 1px solid var(--border); background: var(--surface); box-shadow: var(--shadow-sm); overflow: hidden; animation: dtIn .5s var(--ease) both; }
.dt-file { position: relative; display: flex; gap: 14px; align-items: center; padding: 14px; background: linear-gradient(120deg, color-mix(in srgb, var(--k, var(--accent)) 9%, var(--surface)), var(--surface) 70%); overflow: hidden; }
.dt-file::after { content: ""; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(110deg, transparent 35%, color-mix(in srgb, var(--k, var(--accent)) 16%, transparent) 50%, transparent 65%); transform: translateX(-120%); animation: dtSweep 1.4s .25s var(--ease) 1 forwards; }
@keyframes dtSweep { to { transform: translateX(120%); } }
.dt-file-tile { width: 48px; height: 48px; flex: none; border-radius: 15px; display: grid; place-items: center; color: var(--k, var(--accent)); background: color-mix(in srgb, var(--k, var(--accent)) 14%, transparent); border: 1px solid color-mix(in srgb, var(--k, var(--accent)) 30%, transparent); }
.dt-file-tile .icon { width: 22px; height: 22px; }
.dt-file-main { flex: 1; min-width: 0; }
.dt-file-name { font-weight: 600; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dt-file-acts { display: flex; gap: 2px; flex: none; position: relative; z-index: 1; }
.dt-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
.dt-pill { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px; border-radius: 999px; font-size: 12px; font-weight: 500; background: var(--surface-2); border: 1px solid var(--border); color: var(--text-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
.dt-pill b { color: var(--text); font-weight: 650; }
.dt-pill .icon { width: 12px; height: 12px; }
.dt-pill.accent { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 30%, var(--border)); color: var(--accent); }
.dt-opts { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: flex-end; padding: 12px 14px 14px; border-top: 1px solid var(--border); background: color-mix(in srgb, var(--surface-2) 55%, transparent); }
.dt-opts:empty { display: none; }
.dt-opts .field { min-width: 130px; }
.dt-opts .field-label { font-size: 12px; }
.dt-opts .select { height: 36px; font-size: 13.5px; }
.dt-opts .switch { min-height: 36px; font-size: 13.5px; }
.dt-skel { height: 76px; border-radius: var(--radius-lg); background: linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 50%, var(--surface-2) 75%); background-size: 200% 100%; animation: dtShim 1.1s linear infinite; }

.dt-vt { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.dt-scroll { position: relative; overflow: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); max-width: 100%; overscroll-behavior: contain; box-shadow: var(--shadow-sm); }
.dt-t { border-collapse: separate; border-spacing: 0; table-layout: fixed; font-size: 13.5px; min-width: 100%; }
.dt-t th { position: sticky; top: 0; z-index: 2; height: 44px; padding: 0 12px; text-align: left; font-weight: 600; background: color-mix(in srgb, var(--surface-2) 92%, var(--surface)); border-bottom: 1px solid var(--border-strong); overflow: hidden; user-select: none; }
.dt-t th.dt-click { cursor: pointer; transition: background .2s; }
.dt-t th.dt-click:hover { background: var(--accent-soft); }
.dt-t th.dt-sorted { box-shadow: inset 0 -2px 0 var(--accent); }
.dt-th-in { display: flex; flex-direction: column; justify-content: center; height: 100%; min-width: 0; gap: 1px; }
.dt-th-name { font-size: 12.5px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 5px; }
.dt-th-name .arr { color: var(--accent); font-size: 11px; flex: none; }
.dt-ty { display: inline-flex; align-items: center; gap: 3px; font-size: 10.5px; font-weight: 500; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
.dt-ty .icon { width: 10px; height: 10px; }
.dt-ty[data-t="integer"], .dt-ty[data-t="number"], .dt-ty[data-t="percent"], .dt-ty[data-t="currency"] { color: #0e8a63; }
.dt-ty[data-t="date"], .dt-ty[data-t="datetime"] { color: #b45309; }
.dt-ty[data-t="boolean"] { color: #7c3aed; }
:root[data-theme="dark"] .dt-ty[data-t="integer"], :root[data-theme="dark"] .dt-ty[data-t="number"], :root[data-theme="dark"] .dt-ty[data-t="percent"], :root[data-theme="dark"] .dt-ty[data-t="currency"] { color: #4ade80; }
:root[data-theme="dark"] .dt-ty[data-t="date"], :root[data-theme="dark"] .dt-ty[data-t="datetime"] { color: #fbbf24; }
:root[data-theme="dark"] .dt-ty[data-t="boolean"] { color: #c4b5fd; }
.dt-t td { height: 34px; padding: 0 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-bottom: 1px solid color-mix(in srgb, var(--border) 65%, transparent); background: var(--surface); }
.dt-t tr.odd td { background: color-mix(in srgb, var(--surface-2) 55%, var(--surface)); }
.dt-t tbody tr:hover td { background: var(--accent-soft); }
.dt-t td.num { text-align: right; font-variant-numeric: tabular-nums; }
.dt-t td.dt-e::after { content: ""; display: inline-block; width: 12px; height: 2px; border-radius: 2px; background: var(--border-strong); vertical-align: middle; opacity: .8; }
.dt-t td.dt-hot { background: color-mix(in srgb, var(--warning) 18%, var(--surface)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--warning) 45%, transparent); }
.dt-t td.dt-chg { background: color-mix(in srgb, var(--accent) 16%, var(--surface)); box-shadow: inset 0 -2px 0 var(--accent); }
.dt-t td.dt-bad { background: color-mix(in srgb, var(--danger) 14%, var(--surface)); }
.dt-t td.dt-good { background: color-mix(in srgb, var(--success) 14%, var(--surface)); }
.dt-t td.dt-rn, .dt-t th.dt-rn { position: sticky; left: 0; z-index: 1; width: 56px; padding: 0 8px; text-align: right; color: var(--muted); font-size: 11.5px; font-variant-numeric: tabular-nums; background: var(--surface-2); border-right: 1px solid var(--border); }
.dt-t th.dt-rn { z-index: 3; top: 0; }
.dt-t tr.dt-rowx td { opacity: .55; text-decoration: line-through; }
.dt-t mark { background: color-mix(in srgb, #facc15 55%, transparent); color: inherit; border-radius: 3px; padding: 0 1px; }
.dt-t tr.dt-sp td { padding: 0; border: 0; background: transparent; }
.dt-t.dt-enter tbody { animation: dtIn .45s var(--ease) both; }
.dt-foot { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 4px 12px; font-size: 12.5px; color: var(--muted); padding: 0 4px; }

.dt-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 12px; border-radius: var(--radius-lg); border: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 82%, transparent); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); box-shadow: var(--shadow); }
.dt-actions .dt-note { font-size: 12.5px; color: var(--muted); margin-left: auto; }
.dt-actions .btn.dt-saved { background: var(--success); border-color: transparent; color: #fff; }
.dt-actions .btn.dt-saved::after { display: none; }
@media (max-width: 640px) { .dt-actions.sticky { position: sticky; bottom: calc(10px + var(--safe-b)); z-index: 20; } .dt-actions .dt-note { display: none; } }

.dt-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.dt-chip { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--text-2); font-size: 13.5px; cursor: pointer; transition: background .2s, border-color .2s, color .2s, transform .25s var(--spring), box-shadow .2s; max-width: 100%; }
.dt-chip > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dt-chip:hover { border-color: var(--border-strong); transform: translateY(-1px); }
.dt-chip:active { transform: scale(.96); }
.dt-chip .icon { width: 14px; height: 14px; opacity: .65; flex: none; }
.dt-chip .tick { width: 0; opacity: 0; overflow: hidden; transition: width .25s var(--spring), opacity .2s; display: inline-flex; flex: none; }
.dt-chip[aria-pressed="true"] { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); color: var(--accent); font-weight: 550; box-shadow: 0 8px 18px -12px var(--accent); }
.dt-chip[aria-pressed="true"] .tick { width: 14px; opacity: 1; }
.dt-chip[aria-pressed="true"] .tick .icon { opacity: 1; }
.dt-chips-bar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }

.dt-feat { display: flex; flex-wrap: wrap; gap: 8px; }
.dt-feat .dt-pill { height: 28px; padding: 0 12px; }
.dt-ok { display: flex; gap: 14px; align-items: center; padding: 14px 16px; border-radius: var(--radius-lg); border: 1px solid color-mix(in srgb, var(--success) 30%, var(--border)); background: var(--success-soft); animation: dtIn .5s var(--ease) both; }
.dt-ok svg.tick { width: 40px; height: 40px; flex: none; }
.dt-ok svg.tick circle { fill: none; stroke: var(--success); stroke-width: 2; opacity: .35; }
.dt-ok svg.tick path { fill: none; stroke: var(--success); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 30; stroke-dashoffset: 30; animation: dtTick .6s .15s var(--ease) forwards; }
.dt-ok .t { font-weight: 600; }
.dt-ok .s { font-size: 13px; color: var(--text-2); }
.dt-glow { position: relative; overflow: hidden; }
.dt-glow::before { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .3s; background: radial-gradient(220px circle at var(--mx, 50%) var(--my, 50%), color-mix(in srgb, var(--accent) 15%, transparent), transparent 60%); }
.dt-glow:hover::before { opacity: 1; }
.dt-flow .stat { position: relative; overflow: hidden; }
.dt-flow .stat::before { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .3s; background: radial-gradient(200px circle at var(--mx, 50%) var(--my, 50%), color-mix(in srgb, var(--accent) 13%, transparent), transparent 60%); }
.dt-flow .stat:hover::before { opacity: 1; }
.dt-flow .stat > * { position: relative; }
.dt-det { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); }
.dt-det > summary { cursor: pointer; padding: 11px 14px; font-weight: 550; font-size: 14px; list-style: none; display: flex; align-items: center; gap: 8px; border-radius: var(--radius); }
.dt-det > summary::-webkit-details-marker { display: none; }
.dt-det > summary::after { content: ""; margin-left: auto; width: 8px; height: 8px; border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted); transform: rotate(45deg); transition: transform .25s var(--ease); }
.dt-det[open] > summary::after { transform: rotate(-135deg) translate(-2px, -2px); }
.dt-det > .dt-det-body { padding: 4px 14px 14px; }
.dt-sec { display: flex; flex-direction: column; gap: 10px; }
.dt-sec > h3 { font-size: 13px; font-weight: 600; color: var(--text-2); text-transform: uppercase; letter-spacing: .07em; display: flex; align-items: center; gap: 8px; }
.dt-sec > h3 .icon { width: 15px; height: 15px; color: var(--accent); }
.dt-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 210px), 1fr)); gap: 12px; align-items: start; }
.dt-code { margin: 0; padding: 14px; border-radius: var(--radius); background: var(--surface-2); border: 1px solid var(--border); font-family: var(--mono); font-size: 12.5px; line-height: 1.6; white-space: pre; overflow: auto; max-height: 460px; tab-size: 2; }
.dt-split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; }
@media (max-width: 900px) { .dt-split { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 640px) {
  .dt-step { grid-template-columns: 34px minmax(0, 1fr); column-gap: 12px; padding-bottom: 22px; }
  .dt-num { width: 34px; height: 34px; border-radius: 11px; font-size: 14px; }
  .dt-step::before { left: 16px; top: 40px; }
  .dt-head { min-height: 34px; }
  .dt-head h2 { font-size: 16px; }
  .dt-priv { margin-left: 0; }
  .dt-file { padding: 12px; gap: 11px; }
  .dt-file-tile { width: 42px; height: 42px; border-radius: 13px; }
}
`
let styled = false
export function injectStyles() {
  if (styled || typeof document === 'undefined') return
  styled = true
  document.head.append(h('style', { id: 'dt-styles' }, CSS))
  if (matchMedia?.('(hover: hover)').matches) {
    document.addEventListener('pointermove', (e) => {
      const el = e.target.closest?.('.dt-flow .stat, .dt-glow')
      if (!el) return
      const r = el.getBoundingClientRect()
      el.style.setProperty('--mx', `${e.clientX - r.left}px`)
      el.style.setProperty('--my', `${e.clientY - r.top}px`)
    }, { passive: true })
  }
}

// ---------- Small pieces ----------
export const TYPE_ICON = { text: 'type', integer: 'hash', number: 'hash', percent: 'percent', currency: 'badge-dollar-sign', boolean: 'toggle-right', date: 'calendar', datetime: 'calendar-clock', empty: 'circle-dashed' }
export const TYPE_SHORT = { text: 'Text', integer: 'Whole', number: 'Number', percent: 'Percent', currency: 'Currency', boolean: 'Yes/No', date: 'Date', datetime: 'Date+time', empty: 'Empty' }
export const typeBadge = (t) => h('span', { class: 'dt-ty', 'data-t': t }, icon(TYPE_ICON[t] || 'type'), TYPE_SHORT[t] || t)
const KINDS = {
  csv: { icon: 'file-text', color: '#16a34a', label: 'CSV' },
  excel: { icon: 'file-spreadsheet', color: '#0f9d58', label: 'Excel' },
  json: { icon: 'file-json', color: '#d97706', label: 'JSON' },
  paste: { icon: 'clipboard-paste', color: '#8b5cf6', label: 'Pasted' },
}
export const pill = (...kids) => h('span', { class: 'dt-pill' }, kids)
export const privacyNote = () => h('span', { class: 'dt-priv' }, icon('shield-check'), 'Runs in your browser. Files never leave your device.')
export const section = (title, ic, ...kids) => h('div', { class: 'dt-sec' }, title && h('h3', ic && icon(ic), title), kids)

/** Animate a number up to its value (falls back to the final text right away for reduced motion or background tabs). */
export function countUp(el, to, { ms = 650, format = (n) => n.toLocaleString() } = {}) {
  const final = () => { el.textContent = format(to) }
  if (!Number.isFinite(to) || typeof document === 'undefined' || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(to) < 3) return final()
  const t0 = performance.now()
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / ms)
    el.textContent = format(Math.round(to * (1 - (1 - k) ** 3)))
    if (k < 1 && el.isConnected) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  setTimeout(final, ms + 60)
}

/** Stat tiles like ui.stats(), with numbers that count up. items: [{ label, value: number | string, hint, accent, danger, format }] */
export function statTiles(items) {
  injectStyles()
  return h('div', { class: 'stats', 'aria-live': 'polite' }, items.map((s) => {
    const val = h('div', { class: 'value' }, typeof s.value === 'number' ? '0' : s.value)
    if (typeof s.value === 'number') countUp(val, s.value, { format: s.format })
    return h('div', { class: ['stat', s.accent && 'accent', s.danger && 'danger'] }, h('div', { class: 'label' }, s.label), val, s.hint && h('div', { class: 'hint' }, s.hint))
  }))
}

/** Animated "all done" banner. */
export function successBanner(title, sub, ...actions) {
  injectStyles()
  const svgNs = 'http://www.w3.org/2000/svg'
  const tick = document.createElementNS(svgNs, 'svg')
  tick.setAttribute('viewBox', '0 0 40 40'); tick.setAttribute('class', 'tick'); tick.setAttribute('aria-hidden', 'true')
  tick.innerHTML = '<circle cx="20" cy="20" r="18"/><path d="M12 21l6 6 11-13"/>'
  return h('div', { class: 'dt-ok', role: 'status' }, tick, h('div', { style: 'flex:1;min-width:0' }, h('div', { class: 't' }, title), sub && h('div', { class: 's' }, sub)), actions.length ? h('div', { class: 'row' }, actions) : null)
}

// ---------- Step flow ----------
/** step(1, 'Add your data', { state: 'ready' | 'locked', sub }) -> element with .body and .setState(). */
export function step(n, title, { state = 'ready', sub, lockText = 'Add data first' } = {}) {
  injectStyles()
  const body = h('div', { class: 'dt-body' })
  const titleEl = h('h2', title)
  const el = h('section', { class: 'dt-step', 'data-state': state },
    h('div', { class: 'dt-num', 'aria-hidden': 'true' }, String(n)),
    h('div', { class: 'dt-head' }, titleEl, sub && h('span', { class: 'dt-sub' }, sub), h('span', { class: 'dt-lock' }, icon('lock'), lockText)),
    body)
  el.body = body
  el.setTitle = (t) => { titleEl.textContent = t }
  el.setState = (s) => {
    const was = el.dataset.state
    el.dataset.state = s
    if (was === 'locked' && s !== 'locked') { el.classList.remove('dt-unlock'); void el.offsetWidth; el.classList.add('dt-unlock') }
  }
  return el
}
export const flow = (...steps) => { injectStyles(); return h('div', { class: 'dt-flow' }, steps) }

// ---------- Data source ----------
const SAMPLE_LABEL = { workbook: 'a two-sheet workbook', sales: 'sales orders', customers: 'customers', missing: 'data with gaps', messy: 'messy contacts', duplicates: 'contacts with duplicates', students: 'student scores', products: 'products (JSON)' }

/**
 * tableSource({ multiple, sample: 'sales' | ['sales','customers'], accept, onChange, formatted, jsonOptions, excelOptions, pasteOpen })
 * Drop, pick or paste CSV / TSV / Excel / JSON / HTML / Markdown tables. onChange gets the entry (or null), or an array in multiple mode.
 * An entry is { name, kind, table: {headers, rows}, hasHeader, delimiter, encoding, sheets, sheet, ... } (see _table.entryFromFile).
 */
export function tableSource(opts = {}) {
  injectStyles()
  const { multiple = false, accept = TABLE_ACCEPT, sample = null, onChange, formatted = false, jsonOptions = true, excelOptions = false, headerToggle = true, label, hint } = opts
  const pasteOn = opts.paste ?? !multiple
  const sampleKeys = sample ? [].concat(sample) : []
  let entries = []
  const cards = h('div', { class: 'dt-cards' })
  const msg = h('div')
  const defaults = () => ({ header: opts.header ?? 'auto', formatted })

  const zone = dropzone({
    accept, multiple, label: label || (multiple ? 'Drop your files here, or click to choose' : 'Drop a file here, or click to choose'),
    hint: hint || 'CSV, TSV, Excel (.xlsx, .xls, .ods) or JSON. You can also paste with Ctrl+V.',
    onFiles: (files) => addFiles(files),
  })
  const drop = h('div', { class: 'dt-drop' }, zone)

  const ta = h('textarea', { class: 'textarea mono', rows: 7, spellcheck: false, placeholder: 'Paste CSV, a table copied from Excel or Google Sheets, JSON, or an HTML / Markdown table here...', 'aria-label': 'Pasted data' })
  const pasteBox = h('div', { class: 'dt-paste', hidden: true }, field('Paste your data', ta))
  const sampleBtn = sampleKeys.length ? button('Try sample data', { icon: 'sparkles', variant: 'secondary', size: 'sm', title: `Loads ${sampleKeys.map((k) => SAMPLE_LABEL[k] || k).join(' and ')}`, onClick: () => loadSample() }) : null
  const pasteBtn = pasteOn ? button('Paste data', { icon: 'clipboard-paste', variant: 'secondary', size: 'sm', onClick: () => { pasteBox.hidden = !pasteBox.hidden; if (!pasteBox.hidden) ta.focus() } }) : null
  const actions = h('div', { class: 'dt-src-actions' }, pasteBtn, sampleBtn, privacyNote())

  const wrap = h('div', { class: 'stack' }, drop, actions, msg, pasteBox, cards)

  async function loadSample() { addFiles(await Promise.all(sampleKeys.map(sampleFile)), { replace: true }) }
  const notify = () => onChange?.(multiple ? [...entries] : entries[0] || null)

  function showError(err) {
    console.error(err)
    clear(msg, alert('error', errorMessage(err)))
  }

  async function addFiles(files, { replace = false } = {}) {
    clear(msg)
    const skel = h('div', { class: 'dt-skel', 'aria-label': 'Reading file' })
    cards.append(skel)
    const fresh = []
    for (const f of files) {
      try { fresh.push(await entryFromFile(f, defaults())) } catch (err) { showError(err) }
    }
    skel.remove()
    if (!fresh.length) return
    if (replace || !multiple) entries = []
    entries.push(...fresh)
    ta.value = ''
    pasteBox.hidden = true
    renderAll()
    notify()
  }

  async function fromPaste() {
    const text = ta.value
    if (!text.trim()) { entries = []; renderAll(); notify(); return }
    try {
      clear(msg)
      const e = await entryFromText(text, 'Pasted data', { header: opts.header ?? 'auto' })
      if (entries[0]?.kind === 'paste') { e.opts = { ...entries[0].opts }; await reparse(e) }
      entries = [e]
      renderAll()
      notify()
    } catch (err) { showError(err) }
  }
  ta.addEventListener('input', debounce(fromPaste, 300))
  // Pasting from a web page: prefer the HTML table when the plain text has no tabs.
  ta.addEventListener('paste', (ev) => {
    const html = ev.clipboardData?.getData('text/html')
    const plain = ev.clipboardData?.getData('text/plain') || ''
    if (html && /<table/i.test(html) && !plain.includes('\t')) { ev.preventDefault(); ta.value = html; ta.dispatchEvent(new Event('input')) }
  })

  function renderAll() {
    clear(cards)
    for (const e of entries) cards.append(card(e))
    const has = entries.length > 0
    drop.hidden = has && !multiple
    zone.classList.toggle('compact', has && multiple)
    if (sampleBtn) sampleBtn.hidden = has
    if (pasteBtn) pasteBtn.hidden = has && entries[0]?.kind !== 'paste'
  }

  function card(entry) {
    const k = KINDS[entry.kind] || KINDS.csv
    const rowsB = h('b', '0'), colsB = h('b', '0')
    const meta = h('div', { class: 'dt-meta' })
    const optsEl = h('div', { class: 'dt-opts' })
    const acts = h('div', { class: 'dt-file-acts' })
    const warn = h('div')
    const el = h('div', { class: 'dt-fullcard' }, h('div', { class: 'dt-file', style: { '--k': k.color } },
      h('div', { class: 'dt-file-tile' }, icon(k.icon)),
      h('div', { class: 'dt-file-main' }, h('div', { class: 'dt-file-name', title: entry.name }, entry.name), meta), acts), warn, optsEl)

    const change = async (patch) => {
      Object.assign(entry.opts, patch)
      try { clear(msg); await reparse(entry); paint(false); notify() } catch (err) { showError(err) }
    }
    function paint(animate = true) {
      const t = entry.table
      countUp(rowsB, t.rows.length, { ms: animate ? 650 : 1 })
      countUp(colsB, t.headers.length, { ms: animate ? 650 : 1 })
      clear(meta, pill(icon('rows-3'), rowsB, t.rows.length === 1 ? 'row' : 'rows'), pill(icon('columns-3'), colsB, t.headers.length === 1 ? 'column' : 'columns'))
      if (entry.file) meta.append(pill(icon('hard-drive'), formatBytes(entry.size)))
      if (entry.kind === 'csv' || (entry.kind === 'paste' && entry.pasteKind === 'csv')) meta.append(pill(delimiterLabel(entry.delimiter) + '-separated'))
      if (entry.kind === 'csv') meta.append(pill(encodingLabel(entry.encoding).replace(/ \(.*\)/, '')))
      if (entry.kind === 'excel') meta.append(pill(icon('layers'), `${entry.sheet}${entry.sheets.length > 1 ? ` (${entry.sheets.indexOf(entry.sheet) + 1} of ${entry.sheets.length})` : ''}`))
      if (entry.kind === 'json' && entry.path) meta.append(pill(icon('braces'), pathLabel(entry.path)))
      if (entry.kind === 'paste' && entry.pasteKind && entry.pasteKind !== 'csv') meta.append(pill({ json: 'JSON', html: 'HTML table', markdown: 'Markdown table' }[entry.pasteKind]))
      clear(warn)
      if (!t.headers.length || (!t.rows.length && !entry.hasHeader)) warn.append(h('div', { style: 'padding:0 14px 12px' }, alert('warn', 'No rows were found. Check the delimiter, or that this is the right sheet.')))
      for (const w of entry.warnings || []) warn.append(h('div', { style: 'padding:0 14px 12px' }, alert('warn', w)))
      // actions
      clear(acts)
      if (!multiple && entry.kind !== 'paste') acts.append(button('', { icon: 'refresh-cw', variant: 'ghost', size: 'sm', ariaLabel: 'Choose a different file', title: 'Choose a different file', onClick: () => zone.open() }))
      acts.append(button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: `Remove ${entry.name}`, title: 'Remove', onClick: () => { entries = entries.filter((x) => x !== entry); if (entry.kind === 'paste') ta.value = ''; renderAll(); notify() } }))
      // options
      const o = []
      const isCsv = entry.kind === 'csv' || (entry.kind === 'paste' && entry.pasteKind === 'csv')
      const isJson = entry.kind === 'json' || (entry.kind === 'paste' && entry.pasteKind === 'json')
      if (isCsv) o.push(field('Delimiter', select(DELIMITERS, entry.opts.delimiter, (v) => change({ delimiter: v }))))
      if (entry.kind === 'csv') o.push(field('Encoding', select(ENCODINGS, entry.opts.encoding, (v) => change({ encoding: v }))))
      if (entry.kind === 'excel' && entry.sheets.length > 1) o.push(field('Sheet', select(entry.sheets, entry.sheet, (v) => change({ sheet: v }))))
      if (isJson && jsonOptions) {
        const cands = entry.candidates || []
        if (cands.length > 1) {
          o.push(field('Records', select(cands.map((c, i) => [String(i), `${pathLabel(c.path)} (${c.count})`]), String(Math.max(0, cands.findIndex((c) => c.path.join('\u0000') === (entry.path || []).join('\u0000')))), (v) => change({ path: cands[+v].path }))))
        }
        o.push(field('Nested lists', select([['join', 'Join into one cell'], ['index', 'Separate columns'], ['explode', 'One row per item'], ['json', 'Keep as JSON text']], entry.opts.arrays || 'join', (v) => change({ arrays: v }))))
        o.push(toggle('Flatten nested objects', entry.opts.flatten !== false, (v) => change({ flatten: v })))
        if (entry.opts.flatten !== false) o.push(field('Key joiner', select([['.', 'a.b (dot)'], ['_', 'a_b (underscore)'], ['/', 'a/b (slash)']], entry.opts.sep || '.', (v) => change({ sep: v }))))
      }
      if (!isJson && headerToggle) {
        const hdr = toggle('First row is a header', entry.hasHeader, (v) => change({ header: v }))
        o.push(hdr)
      }
      if (entry.kind === 'excel' && (excelOptions || formatted)) {
        o.push(toggle('Use displayed text', !!entry.opts.formatted, (v) => change({ formatted: v })))
        o.push(toggle('Repeat merged cells', !!entry.opts.fillMerged, (v) => change({ fillMerged: v })))
      }
      clear(optsEl, o)
    }
    paint(true)
    el.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault() })
    el.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); zone._take([...e.dataTransfer.files]) } })
    return el
  }

  if (opts.pasteOpen && pasteOn) pasteBox.hidden = false
  return {
    el: wrap,
    zone,
    get entry() { return entries[0] || null },
    get entries() { return [...entries] },
    addFiles,
    loadSample,
    focusPaste() { pasteBox.hidden = false; ta.focus() },
    setText(text) { ta.value = text; pasteBox.hidden = false; return fromPaste() },
    async setOpts(patch) {
      for (const e of entries) { Object.assign(e.opts, patch); try { await reparse(e) } catch (err) { showError(err) } }
      renderAll(); notify()
    },
    clear() { entries = []; ta.value = ''; renderAll(); notify() },
  }
}

/**
 * toolFlow({ titles: ['Add your data', 'Choose options', 'Preview and download'], source: {...tableSource opts}, onData(entry | entries | null) })
 * The standard three-step page: s1 holds the source, s2 and s3 stay locked until data arrives. Returns { el, src, s2, s3 }.
 */
export function toolFlow({ titles = [], source = {}, onData, lockText }) {
  const s1 = step(1, titles[0] || 'Add your data')
  const s2 = step(2, titles[1] || 'Choose options', { state: 'locked', lockText })
  const s3 = step(3, titles[2] || 'Preview and download', { state: 'locked', lockText })
  const src = tableSource({
    ...source,
    onChange: (e) => {
      const has = Array.isArray(e) ? e.length > 0 : !!e
      s2.setState(has ? 'ready' : 'locked'); s3.setState(has ? 'ready' : 'locked')
      onData?.(e)
    },
  })
  s1.body.append(src.el)
  return { el: flow(s1, s2, s3), src, s1, s2, s3 }
}

// ---------- Virtual table ----------
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const esc = (s) => s.replace(/[&<>"]/g, (c) => ESC[c])
function markHtml(txt, re) {
  let out = '', last = 0
  re.lastIndex = 0
  for (let m; (m = re.exec(txt));) {
    if (!m[0]) { re.lastIndex++; continue }
    out += esc(txt.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>'
    last = m.index + m[0].length
  }
  return out + esc(txt.slice(last))
}

/**
 * virtualTable({ table, height, onHeader(col, event), cellClass(row, col, value), rowClass(row), types, foot })
 * Renders only the visible rows, so a million rows scroll smoothly. Returns { el, setTable, setOrder, setHighlight, setSort, refresh, setFoot }.
 */
export function virtualTable(opts = {}) {
  injectStyles()
  const RH = opts.rowHeight || 34
  const maxH = opts.height || 440
  let table = { headers: [], rows: [] }
  let types = []
  let numCols = []
  let order = null
  let re = null
  let sort = null
  let raf = 0
  let footText = ''
  const scroller = h('div', { class: 'dt-scroll', tabindex: 0, role: 'region', 'aria-label': opts.label || 'Table preview' })
  scroller.style.maxHeight = `${maxH}px`
  const tbl = h('table', { class: 'dt-t' })
  const colgroup = h('colgroup')
  const thead = h('thead')
  const tbody = h('tbody')
  tbl.append(colgroup, thead, tbody)
  scroller.append(tbl)
  const foot = h('div', { class: 'dt-foot' })
  const el = h('div', { class: 'dt-vt' }, scroller, opts.foot === false ? null : foot)

  const count = () => (order ? order.length : table.rows.length)
  const sizes = () => {
    const sample = Math.min(table.rows.length, 120)
    return table.headers.map((hd, c) => {
      let m = Math.min(String(hd).length * 1.1 + 4, 36)
      for (let i = 0; i < sample; i++) {
        const v = table.rows[i][c]
        const l = v == null ? 0 : typeof v === 'string' ? v.length : String(v).length
        if (l > m) m = l
      }
      return Math.max(90, Math.min(300, Math.round(m * 7.3 + 26)))
    })
  }
  function buildHead() {
    colgroup.replaceChildren(h('col', { style: 'width:56px' }), ...table.headers.map((_, c) => h('col', { style: `width:${widths[c]}px` })))
    tbl.style.width = `${56 + widths.reduce((a, b) => a + b, 0)}px`
    const clickable = !!opts.onHeader
    thead.replaceChildren(h('tr', h('th', { class: 'dt-rn', scope: 'col' }, '#'), ...table.headers.map((name, c) => {
      const sorted = sort && sort.col === c
      return h('th', {
        scope: 'col', class: [clickable && 'dt-click', sorted && 'dt-sorted'], title: name,
        tabindex: clickable ? 0 : null, role: clickable ? 'button' : null,
        'aria-sort': sorted ? (sort.dir === 'desc' ? 'descending' : 'ascending') : null,
        onclick: clickable ? (e) => opts.onHeader(c, e) : null,
        onkeydown: clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onHeader(c, e) } } : null,
      }, h('div', { class: 'dt-th-in' }, h('div', { class: 'dt-th-name' }, h('span', { style: 'overflow:hidden;text-overflow:ellipsis' }, name), sorted && h('span', { class: 'arr' }, sort.dir === 'desc' ? '▼' : '▲')), opts.types === false ? null : typeBadge(types[c] || 'text')))
    })))
  }
  let widths = []
  function render() {
    raf = 0
    const n = count()
    const nc = table.headers.length
    const viewH = scroller.clientHeight || maxH
    const first = Math.max(0, Math.floor(scroller.scrollTop / RH) - 6)
    const last = Math.min(n, Math.ceil((scroller.scrollTop + viewH) / RH) + 6)
    const parts = []
    if (first > 0) parts.push(`<tr class="dt-sp" aria-hidden="true"><td colspan="${nc + 1}" style="height:${first * RH}px"></td></tr>`)
    for (let pos = first; pos < last; pos++) {
      const ri = order ? order[pos] : pos
      const r = table.rows[ri]
      const rc = opts.rowClass?.(ri)
      let s = `<tr class="${pos & 1 ? 'odd' : ''}${rc ? ' ' + rc : ''}"><td class="dt-rn">${ri + 1}</td>`
      for (let c = 0; c < nc; c++) {
        const v = r[c]
        const empty = v == null || v === ''
        let cls = numCols[c] ? 'num' : ''
        if (empty) cls += ' dt-e'
        const x = opts.cellClass?.(ri, c, v)
        if (x) cls += ' ' + x
        let txt = empty ? '' : typeof v === 'string' ? v : String(v)
        const long = txt.length > 400
        if (long) txt = txt.slice(0, 400) + '...'
        s += `<td class="${cls}" data-c="${c}"${txt.length > 28 ? ` title="${esc(txt.slice(0, 300))}"` : ''}>${re && txt ? markHtml(txt, re) : esc(txt)}</td>`
      }
      parts.push(s + '</tr>')
    }
    if (last < n) parts.push(`<tr class="dt-sp" aria-hidden="true"><td colspan="${nc + 1}" style="height:${(n - last) * RH}px"></td></tr>`)
    tbody.innerHTML = parts.join('')
    if (!n) tbody.innerHTML = `<tr class="dt-sp"><td colspan="${nc + 1}" style="height:${RH * 2}px;text-align:center;color:var(--muted);padding:0">${esc(opts.emptyText || 'No rows to show')}</td></tr>`
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(render) }
  scroller.addEventListener('scroll', schedule, { passive: true })
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
  ro?.observe(scroller)
  onCleanup(() => { ro?.disconnect(); cancelAnimationFrame(raf) })
  tbody.addEventListener('dblclick', (e) => {
    const td = e.target.closest('td[data-c]')
    if (td) copyText(td.textContent)
  })

  function setFoot() {
    const n = count()
    clear(foot, h('span', `${plural(n, 'row')}${order && order.length !== table.rows.length ? ` of ${table.rows.length.toLocaleString()}` : ''} · ${plural(table.headers.length, 'column')}${footText ? ` · ${footText}` : ''}`), h('span', 'Double-click a cell to copy it'))
  }
  const api = {
    el,
    get rowCount() { return count() },
    setTable(t, o = {}) {
      table = t
      order = o.order || null
      types = opts.types === false ? [] : o.types || inferTypes(t)
      numCols = types.map(isNumericType)
      widths = sizes()
      sort = o.sort || null
      scroller.scrollTop = 0
      buildHead()
      tbl.classList.remove('dt-enter'); void tbl.offsetWidth; tbl.classList.add('dt-enter')
      render(); setFoot()
    },
    setOrder(o) { order = o; scroller.scrollTop = 0; render(); setFoot() },
    setHighlight(r) { re = r; render() },
    setSort(s) { sort = s; buildHead() },
    refresh() { render(); setFoot() },
    setFoot(t) { footText = t || ''; setFoot() },
    get types() { return types },
  }
  if (opts.table) api.setTable(opts.table)
  return api
}

// ---------- Export bar ----------
const safeFile = (n) => String(n || 'data').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || 'data'
const FMT = {
  csv: { label: 'Download CSV', icon: 'file-text', ext: 'csv' },
  xlsx: { label: 'Download Excel', icon: 'file-spreadsheet', ext: 'xlsx' },
  json: { label: 'Download JSON', icon: 'braces', ext: 'json' },
  tsv: { label: 'Download TSV', icon: 'file-text', ext: 'tsv' },
}
const BOM = String.fromCharCode(0xFEFF)

/** Make a Blob for a table in one of the standard formats. */
export async function tableBlob(table, format, o = {}) {
  if (format === 'csv') return new Blob([o.bom ? BOM : '', toCsv(table, o)], { type: 'text/csv;charset=utf-8' })
  if (format === 'tsv') return new Blob([toCsv(table, { ...o, delimiter: '\t' })], { type: 'text/tab-separated-values;charset=utf-8' })
  if (format === 'json') return new Blob([jsonText(tableToJson(table, o), o)], { type: 'application/json' })
  const { tableToXlsx } = await import('./_xlsx.js')
  return tableToXlsx(table, o)
}

/**
 * exportBar({ getTable, name, formats: ['csv','xlsx','json'], csv: () => ({delimiter, bom, ...}), xlsx: () => ({name, types}), json: () => ({...}),
 *   items: [{ label, icon, primary, make: async () => ({ blob, name }) }], copy: true, extra: [buttons], note })
 * One row of download buttons plus Copy (tab-separated, pastes into Excel and Sheets). Sticks to the bottom on phones.
 * Use `items` for custom outputs (ZIPs, text files); `formats` for the standard table formats.
 */
export function exportBar(o) {
  injectStyles()
  const formats = o.formats || (o.items ? [] : ['csv', 'xlsx', 'json'])
  const nameOf = () => safeFile(typeof o.name === 'function' ? o.name() : o.name)
  const items = [
    ...formats.map((f, i) => ({
      label: FMT[f].label, icon: FMT[f].icon, primary: o.primary ? o.primary === f : i === 0,
      make: async () => {
        const t = await o.getTable()
        if (!t) throw new Error('There is nothing to download yet.')
        return { blob: await tableBlob(t, f, o[f]?.() || {}), name: `${nameOf()}.${FMT[f].ext}` }
      },
    })),
    ...(o.items || []),
  ]
  if (!items.some((i) => i.primary)) items[0].primary = true
  const btns = items.map((it) => {
    const btn = button(it.label, { icon: it.icon, variant: it.primary ? 'primary' : 'secondary', size: it.primary ? 'lg' : undefined })
    btn.addEventListener('click', async () => {
      const ok = await busy(btn, async () => {
        const out = await it.make()
        if (!out) return false
        download(out.blob, out.name)
        toast(`Saved ${out.name} (${formatBytes(out.blob.size)})`, 'success')
        return true
      }, { label: 'Preparing' })
      if (ok) {
        const orig = [...btn.childNodes]
        btn.classList.add('dt-saved')
        btn.replaceChildren(icon('check'), h('span', 'Saved'))
        setTimeout(() => { btn.classList.remove('dt-saved'); btn.replaceChildren(...orig) }, 1400)
      }
    })
    return btn
  })
  const copy = o.copy === false || !o.getTable ? null : button('Copy', { icon: 'copy', variant: 'ghost', title: 'Copy as tab-separated text (pastes into Excel and Google Sheets)', onClick: async () => { const t = await o.getTable(); if (t) copyText(toTsv(t)) } })
  const el = h('div', { class: ['dt-actions', o.sticky !== false && 'sticky'] }, btns, copy, o.extra, o.note && h('span', { class: 'dt-note' }, o.note))
  el.setDisabled = (b) => { for (const x of [...btns, copy]) if (x) x.disabled = !!b }
  return el
}

// ---------- Chips and column selects ----------
/**
 * chipSelect({ items: [{ value, label, type }], value: [], multi: true, onChange(values), bulk: true })
 * Pill-shaped toggles with a check that springs in. el.value is the selected values array; el.set(values), el.setItems(items).
 */
export function chipSelect(o) {
  injectStyles()
  const multi = o.multi !== false
  let items = o.items || []
  let value = [...(o.value || [])]
  const wrap = h('div')
  const row = h('div', { class: 'dt-chips', role: 'group', 'aria-label': o.label || 'Choose columns' })
  const bar = h('div', { class: 'dt-chips-bar' })
  const paint = () => {
    clear(row, items.map((it) => {
      const on = value.includes(it.value)
      return h('button', {
        type: 'button', class: 'dt-chip', 'aria-pressed': String(on), title: it.label,
        onclick: () => {
          value = multi ? (on ? value.filter((v) => v !== it.value) : [...value, it.value]) : [it.value]
          wrap.value = value; paint(); o.onChange?.(value)
        },
      }, h('span', { class: 'tick' }, icon('check')), it.type && icon(TYPE_ICON[it.type] || 'type'), h('span', it.label))
    }))
  }
  if (multi && o.bulk !== false) {
    bar.append(button('All', { variant: 'ghost', size: 'sm', onClick: () => { value = items.map((i) => i.value); wrap.value = value; paint(); o.onChange?.(value) } }),
      button('None', { variant: 'ghost', size: 'sm', onClick: () => { value = []; wrap.value = value; paint(); o.onChange?.(value) } }))
  }
  wrap.append(bar, row)
  wrap.value = value
  wrap.set = (v) => { value = [...v]; wrap.value = value; paint() }
  wrap.setItems = (it, keep = false) => { items = it; value = keep ? value.filter((v) => items.some((i) => i.value === v)) : value; wrap.value = value; paint() }
  paint()
  return wrap
}

/** Column dropdown. colSelect({ headers, value: 0, onChange(index), none: 'No column' }) -> <select> with .setHeaders(headers, keepValue). */
export function colSelect({ headers = [], value = 0, onChange, none = null } = {}) {
  const build = (hs) => [...(none ? [h('option', { value: '-1' }, none)] : []), ...hs.map((n, i) => h('option', { value: String(i) }, n))]
  const el = h('select', { class: 'select', onchange: () => onChange?.(+el.value), 'aria-label': 'Column' }, build(headers))
  el.value = String(none && value < 0 ? -1 : Math.min(value, Math.max(0, headers.length - 1)))
  el.setHeaders = (hs, keep = true) => {
    const cur = el.value
    el.replaceChildren(...build(hs))
    el.value = keep && Number(cur) < hs.length ? cur : none ? '-1' : '0'
  }
  return el
}

/** Read a CSS variable of the page (theme colors for canvas charts). */
export const cssVar = (name, fallback = '') => (typeof document === 'undefined' ? fallback : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback)
/** Run cb whenever the visitor flips light and dark. Cleans up when the tool page is left. */
export function watchTheme(cb) {
  const mo = new MutationObserver(cb)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  onCleanup(() => mo.disconnect())
}

/** Rough title for downloads: "sales.csv" -> "sales". */
export const nameBase = (entry, fallback = 'data') => (entry?.name || fallback).replace(/\.[^.\/\\]+$/, '').replace(/^Pasted data$/, fallback) || fallback
