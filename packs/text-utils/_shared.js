// Shared kit for the text-utils pack: one scoped stylesheet (.tu) plus small building blocks
// (pills with a sliding thumb, toggle chips, glass panes, an animated change ribbon, a copy button
// with a success burst) and studio(), the "text in -> text out" scaffold most tools use.
// Files starting with "_" are never tool modules. Everything here is scoped under .tu.
import { h, icon, button, copyText, download, toast, debounce, onCleanup, clear } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { pickFiles } from '../../lib/files.js'

const CSS = `
@property --tu-angle { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
.tu { position: relative; isolation: isolate; display: flex; flex-direction: column; gap: 14px; }
.tu::before {
  content: ""; position: absolute; z-index: -1; pointer-events: none; inset: -70px 0 auto; height: 380px;
  background:
    radial-gradient(440px 230px at 12% 25%, color-mix(in srgb, var(--c, var(--accent)) 24%, transparent), transparent 70%),
    radial-gradient(420px 220px at 88% 8%, color-mix(in srgb, var(--accent-2) 17%, transparent), transparent 70%),
    radial-gradient(360px 200px at 55% 70%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 70%);
  filter: blur(18px); animation: tu-drift 16s ease-in-out infinite alternate;
  -webkit-mask-image: linear-gradient(#000 55%, transparent); mask-image: linear-gradient(#000 55%, transparent);
}
@keyframes tu-drift { from { transform: translate3d(0, -8px, 0); opacity: .85; } to { transform: translate3d(0, 14px, 0); opacity: 1; } }
@keyframes tu-rise { from { opacity: 0; transform: translateY(14px); } }
@keyframes tu-pop { 0% { transform: scale(.82); } 60% { transform: scale(1.07); } 100% { transform: scale(1); } }
@keyframes tu-sweep { from { transform: translateX(-110%); } to { transform: translateX(110%); } }
@keyframes tu-float { 0%, 100% { transform: translateY(0) rotate(-3deg); } 50% { transform: translateY(-7px) rotate(3deg); } }
@keyframes tu-spin-angle { to { --tu-angle: 360deg; } }
@keyframes tu-spark { from { opacity: 1; transform: translate(0, 0) scale(1); } to { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(.2); } }
@keyframes tu-bar { from { transform: scaleX(0); } }
@keyframes tu-blink { 50% { opacity: .25; } }
.tu > * { animation: tu-rise .55s var(--ease) both; animation-delay: calc(var(--i, 0) * 55ms); }
.tu [hidden] { display: none !important; }

/* Dock: the glass bar that holds the options */
.tu-dock {
  display: flex; flex-wrap: wrap; gap: 12px 18px; align-items: flex-start; padding: 14px 16px; border-radius: 22px;
  background: var(--glass); border: 1px solid var(--border); box-shadow: var(--shadow-sm);
  -webkit-backdrop-filter: blur(16px) saturate(1.5); backdrop-filter: blur(16px) saturate(1.5);
}
.tu-group { display: flex; flex-direction: column; gap: 7px; min-width: 0; max-width: 100%; }
.tu-group.grow { flex: 1 1 220px; }
.tu-lab { font-size: 11px; font-weight: 650; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); }
.tu-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.tu-dock .input, .tu-dock .select { height: 38px; border-radius: 12px; }
.tu-dock .input.narrow { width: 92px; }
.tu-dock .input.mid { width: 160px; max-width: 100%; }
.tu-dock .input.wide { width: 100%; }
.tu-dock .select { width: auto; max-width: 100%; }
.tu-hint { font-size: 12.5px; color: var(--muted); }
.tu-err { color: var(--danger); font-size: 13px; display: flex; gap: 6px; align-items: flex-start; overflow-wrap: anywhere; }
.tu-err .icon { width: 15px; height: 15px; margin-top: 2px; }

/* Pills: segmented control with a thumb that springs between options */
.tu-pills { position: relative; display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 3px; max-width: 100%; border-radius: 18px; background: var(--surface-2); border: 1px solid var(--border); }
.tu-pills > button {
  position: relative; z-index: 1; border: 0; background: transparent; min-height: 34px; padding: 0 14px; border-radius: 15px; cursor: pointer;
  font-size: 13.5px; font-weight: 560; color: var(--muted); transition: color .25s; white-space: nowrap;
}
.tu-pills > button:hover { color: var(--text); }
.tu-pills > button[aria-pressed="true"] { color: var(--accent-text); }
.tu-pills > button:focus-visible { outline-offset: 0; }
.tu-thumb {
  position: absolute; z-index: 0; left: 0; top: 0; width: 0; height: 0; border-radius: 15px; opacity: 0; pointer-events: none;
  background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, var(--accent-2)));
  box-shadow: 0 6px 16px -8px var(--accent), 0 1px 0 rgba(255, 255, 255, .22) inset;
}
.tu-pills.ready .tu-thumb { transition: transform .42s var(--spring), width .42s var(--spring), height .3s var(--ease), opacity .2s; }

/* Chips: toggle pills */
.tu-chip {
  position: relative; display: inline-flex; align-items: center; gap: 8px; min-height: 34px; padding: 0 14px 0 9px; border-radius: 999px;
  border: 1px solid var(--border); background: var(--surface); cursor: pointer; font-size: 13.5px; user-select: none; color: var(--text-2);
  transition: border-color .2s, background .25s, color .2s, transform .2s var(--spring);
}
.tu-chip:hover { border-color: var(--border-strong); }
.tu-chip:active { transform: scale(.96); }
.tu-chip > input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.tu-tick { position: relative; flex: none; width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid var(--border-strong); transition: background .25s, border-color .25s, transform .35s var(--spring); }
.tu-tick::after { content: ""; position: absolute; left: 5px; top: 2px; width: 4px; height: 8px; border: solid var(--accent-text); border-width: 0 2px 2px 0; transform: rotate(45deg) scale(0); transition: transform .3s var(--spring); }
.tu-chip:has(input:checked) { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); background: var(--accent-soft); color: var(--text); }
.tu-chip:has(input:checked) .tu-tick { background: var(--accent); border-color: var(--accent); transform: scale(1.05); }
.tu-chip:has(input:checked) .tu-tick::after { transform: rotate(45deg) scale(1); }
.tu-chip:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.tu-chip .tu-n { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--accent); color: var(--accent-text); font-size: 11.5px; font-weight: 650; display: none; place-items: center; font-variant-numeric: tabular-nums; }
.tu-chip .tu-n.on { display: grid; animation: tu-pop .35s var(--spring); }
.tu-chip.is-button { padding-left: 14px; }
.tu-chip.is-button .tu-tick { display: none; }
.tu-quick { display: flex; flex-wrap: wrap; gap: 6px; }
.tu-quick button { border: 1px solid var(--border); background: var(--surface); border-radius: 999px; min-height: 30px; padding: 0 11px; cursor: pointer; font: 500 12.5px var(--mono); color: var(--text-2); transition: border-color .2s, background .2s, transform .2s var(--spring); white-space: pre; }
.tu-quick button:hover { border-color: var(--accent); background: var(--accent-soft); color: var(--text); transform: translateY(-1px); }

/* Ribbon: animated change counters */
.tu-ribbon { display: flex; flex-wrap: wrap; gap: 8px; min-height: 38px; align-items: center; margin-inline: -6px; padding-inline: 6px; overflow-x: clip; }
.tu-badge {
  display: inline-flex; align-items: baseline; gap: 7px; padding: 7px 14px; border-radius: 999px; background: var(--surface); border: 1px solid var(--border);
  font-size: 13px; color: var(--muted); box-shadow: var(--shadow-sm); animation: tu-pop .4s var(--spring) both; max-width: 100%;
}
.tu-badge b { font-size: 17px; font-weight: 650; letter-spacing: -.02em; color: var(--text); font-variant-numeric: tabular-nums; }
.tu-badge.good { background: var(--success-soft); border-color: color-mix(in srgb, var(--success) 28%, var(--border)); }
.tu-badge.good b { color: var(--success); }
.tu-badge.warn { background: var(--warning-soft); border-color: color-mix(in srgb, var(--warning) 30%, var(--border)); }
.tu-badge.warn b { color: var(--warning); }
.tu-badge.bad { background: var(--danger-soft); border-color: color-mix(in srgb, var(--danger) 30%, var(--border)); }
.tu-badge.bad b { color: var(--danger); }
.tu-badge.accent { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); }
.tu-badge.accent b { color: var(--accent); }
.tu-ribbon .tu-note { font-size: 13px; color: var(--muted); }

/* Panes: the glass editor cards */
.tu-panes { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: stretch; }
.tu-panes.thirds { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.tu-pane {
  position: relative; display: flex; flex-direction: column; min-width: 0; border-radius: 22px; border: 1px solid transparent; overflow: hidden;
  background: linear-gradient(var(--surface), var(--surface)) padding-box, linear-gradient(var(--border), var(--border)) border-box; box-shadow: var(--shadow-sm);
  transition: box-shadow .35s var(--ease);
}
.tu-pane:focus-within, .tu-pane.drag {
  background: linear-gradient(var(--surface), var(--surface)) padding-box,
    conic-gradient(from var(--tu-angle), var(--accent), var(--accent-2), #f97316, var(--accent)) border-box;
  animation: tu-spin-angle 6s linear infinite; box-shadow: 0 22px 50px -26px var(--accent);
}
.tu-pane.out { background: linear-gradient(var(--surface), var(--surface)) padding-box, linear-gradient(135deg, color-mix(in srgb, var(--accent) 55%, var(--border)), var(--border) 40%, color-mix(in srgb, var(--accent-2) 45%, var(--border))) border-box; }
.tu-pane.out::after { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0; background: linear-gradient(100deg, transparent 30%, color-mix(in srgb, var(--accent) 22%, transparent) 50%, transparent 70%); }
.tu-pane.flash::after { animation: tu-sweep .75s var(--ease); }
.tu-head { display: flex; align-items: center; gap: 8px; padding: 10px 10px 4px 16px; min-height: 48px; }
.tu-title { flex: 1; min-width: 0; display: flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 600; color: var(--text-2); }
.tu-title i { width: 8px; height: 8px; border-radius: 50%; background: var(--c, var(--accent)); box-shadow: 0 0 0 4px color-mix(in srgb, var(--c, var(--accent)) 18%, transparent); flex: none; }
.tu-pane.out .tu-title i { background: var(--success); box-shadow: 0 0 0 4px color-mix(in srgb, var(--success) 18%, transparent); }
.tu-acts { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; justify-content: flex-end; }
.tu-acts .btn { color: var(--text-2); }
.tu-area {
  display: block; width: 100%; flex: 1; min-height: 280px; border: 0; outline: none; background: transparent; resize: vertical;
  padding: 6px 16px 10px; font: 15px/1.6 var(--font); color: var(--text); border-radius: 0;
}
.tu-area.mono { font: 13.5px/1.65 var(--mono); }
.tu-area.short { min-height: 150px; }
.tu-area::placeholder { color: var(--muted); opacity: .75; }
.tu-area[readonly] { background: transparent; cursor: text; }
.tu-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 16px 10px; font-size: 12.5px; color: var(--muted); border-top: 1px solid var(--border); font-variant-numeric: tabular-nums; flex-wrap: wrap; }
.tu-foot b { color: var(--text-2); font-weight: 600; }
.tu-empty {
  position: absolute; inset: 48px 0 40px; display: grid; place-content: center; justify-items: center; gap: 10px; text-align: center; padding: 16px; pointer-events: none;
  color: var(--muted); font-size: 14px; transition: opacity .3s;
}
.tu-empty.gone { opacity: 0; visibility: hidden; }
.tu-empty .tu-orb { width: 54px; height: 54px; border-radius: 18px; display: grid; place-items: center; color: #fff; background: var(--brand); background-size: 200% 200%; animation: tu-float 5s ease-in-out infinite, brandShift 8s ease-in-out infinite; box-shadow: 0 16px 30px -14px var(--accent); }
.tu-empty .tu-orb .icon { width: 26px; height: 26px; }
.tu-empty .btn { pointer-events: auto; }

/* Copy button */
.tu-copy { position: relative; overflow: visible; }
.tu-copy.done { background: var(--success-soft); color: var(--success); border-color: color-mix(in srgb, var(--success) 35%, transparent); }
.tu-spark { position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px; border-radius: 50%; pointer-events: none; background: var(--c1); animation: tu-spark .65s var(--ease) forwards; z-index: 5; }

/* Cards, grids, lists */
.tu-card { background: var(--surface); border: 1px solid var(--border); border-radius: 20px; padding: 16px; min-width: 0; box-shadow: var(--shadow-sm); }
.tu-card h3 { font-size: 14px; letter-spacing: -.01em; display: flex; align-items: center; gap: 8px; justify-content: space-between; margin-bottom: 10px; }
.tu-bar { position: relative; height: 8px; border-radius: 99px; background: var(--surface-3); overflow: hidden; }
.tu-bar > i { position: absolute; inset: 0; transform-origin: left; border-radius: inherit; background: linear-gradient(90deg, var(--accent), var(--accent-2)); animation: tu-bar .8s var(--ease) both; }
.tu-mark { background: color-mix(in srgb, var(--accent) 26%, transparent); color: inherit; border-radius: 4px; padding: 0 1px; box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent); }
.tu-doc { white-space: pre-wrap; overflow-wrap: anywhere; font: 13.5px/1.7 var(--mono); padding: 6px 16px 14px; max-height: 420px; overflow: auto; min-height: 150px; }
.tu-doc del { background: var(--danger-soft); color: var(--danger); text-decoration: line-through; border-radius: 4px; padding: 0 2px; }
.tu-doc ins { background: var(--success-soft); color: var(--success); text-decoration: none; border-radius: 4px; padding: 0 2px; font-weight: 600; }
.tu-tabs { display: inline-flex; gap: 2px; padding: 3px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--border); }
.tu-tabs button { border: 0; background: transparent; padding: 0 12px; min-height: 30px; border-radius: 9px; cursor: pointer; font-size: 13px; font-weight: 560; color: var(--muted); }
.tu-tabs button[aria-pressed="true"] { background: var(--surface); color: var(--text); box-shadow: var(--shadow-sm); }
:root[data-theme="dark"] .tu-tabs button[aria-pressed="true"] { background: var(--surface-3); }
.tu-token { display: inline-flex; align-items: center; gap: 6px; padding: 4px 11px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--border); font: 12.5px var(--mono); cursor: pointer; transition: transform .2s var(--spring), border-color .2s; }
.tu-token:hover { border-color: var(--accent); transform: translateY(-1px); }
.tu-token small { color: var(--muted); font: 600 11px var(--font); }
.tu-tokens { display: flex; flex-wrap: wrap; gap: 6px; }

.tu .stats { grid-template-columns: repeat(auto-fill, minmax(min(100%, 185px), 1fr)); }
.tu .stat .value { font-size: 22px; }
@media (max-width: 900px) {
  .tu-panes, .tu-panes.thirds { grid-template-columns: minmax(0, 1fr); }
  .tu-area { min-height: 190px; }
}
@media (max-width: 720px) {
  .tu-dock { padding: 12px; border-radius: 18px; gap: 12px; }
  .tu-pane { border-radius: 18px; }
  .tu-group { width: 100%; }
  .tu-pills { width: 100%; }
  .tu-pills > button { flex: 1 1 auto; padding: 0 10px; }
  .tu-dock .input.narrow, .tu-dock .input.mid { width: 100%; }
  .tu-badge { padding: 6px 12px; }
}
@media (prefers-reduced-motion: reduce) {
  .tu::before, .tu-empty .tu-orb, .tu-pane:focus-within { animation: none !important; }
}
`

let injected = false
/** Inject the pack stylesheet once. Called by every tool through root(). */
export function injectStyle() {
  if (injected && document.getElementById('tu-style')) return
  injected = true
  document.head.append(h('style', { id: 'tu-style' }, CSS))
}

/** Wrap children in the .tu root with staggered entrance (each child gets --i). */
export function root(...kids) {
  injectStyle()
  const el = h('div', { class: 'tu' })
  const add = (list) => {
    for (const k of list.flat(Infinity)) if (k) { k.style?.setProperty('--i', el.children.length); el.append(k) }
  }
  add(kids)
  el.add = (...more) => add(more)
  return el
}

export const plural = (n, word, many) => `${n.toLocaleString()} ${n === 1 ? word : many || word + 's'}`

// ---------- Controls ----------

/** pills([['a','A'],['b','B','tooltip']], 'a', onChange) -> element with .value and .set(v). A spring thumb slides to the active option. */
export function pills(options, value, onChange, ariaLabel) {
  const el = h('div', { class: 'tu-pills', role: 'group', 'aria-label': ariaLabel || null })
  const thumb = h('i', { class: 'tu-thumb', 'aria-hidden': 'true' })
  const btns = options.map((o) => {
    const [v, l, tip] = Array.isArray(o) ? o : [o, o]
    const b = h('button', { type: 'button', title: tip || null, 'aria-pressed': String(v === value), onclick: () => { if (el.value !== v) { el.set(v); onChange?.(v) } } }, l)
    b._v = v
    return b
  })
  el.append(thumb, ...btns)
  el.value = value
  const place = () => {
    const b = btns.find((x) => x._v === el.value)
    if (!b || !b.offsetWidth) { thumb.style.opacity = '0'; return }
    thumb.style.opacity = '1'
    thumb.style.width = `${b.offsetWidth}px`
    thumb.style.height = `${b.offsetHeight}px`
    thumb.style.transform = `translate(${b.offsetLeft}px, ${b.offsetTop}px)`
    if (!el.classList.contains('ready')) setTimeout(() => el.classList.add('ready'), 60)
  }
  el.set = (v) => {
    el.value = v
    for (const b of btns) b.setAttribute('aria-pressed', String(b._v === v))
    place()
  }
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(place)
    ro.observe(el)
    onCleanup(() => ro.disconnect())
  } else setTimeout(place, 50)
  return el
}

/** chip('Ignore case', true, (checked) => ...) -> label element; .input is the checkbox; .set(bool); .badge(n) shows a count bubble. */
export function chip(label, checked, onChange, title) {
  const inp = h('input', { type: 'checkbox', checked: !!checked, onchange: (e) => onChange?.(e.target.checked, e) })
  const n = h('span', { class: 'tu-n', 'aria-hidden': 'true' })
  const el = h('label', { class: 'tu-chip', title: title || null }, inp, h('span', { class: 'tu-tick' }), h('span', label), n)
  el.input = inp
  el.set = (b) => { inp.checked = !!b }
  el.badge = (count) => {
    const on = count > 0
    if (on && n.textContent !== String(count)) { n.classList.remove('on'); void n.offsetWidth }
    n.textContent = on ? String(count) : ''
    n.classList.toggle('on', on)
  }
  return el
}

/** A one-shot action styled like a chip (presets etc). */
export function chipButton(label, onClick, iconName, title) {
  return h('button', { type: 'button', class: 'tu-chip is-button', title: title || null, onclick: onClick }, iconName && icon(iconName), h('span', label))
}

/** quick([['- ', 'Dash'], ...], (value) => ...) - row of tiny preset buttons that insert literal text. */
export function quick(items, onPick) {
  return h('div', { class: 'tu-quick' }, items.map((it) => {
    const [v, l] = Array.isArray(it) ? it : [it, it]
    return h('button', { type: 'button', title: `Insert ${JSON.stringify(v)}`, onclick: () => onPick(v) }, l)
  }))
}

/** group('Sort by', control, hint?) -> labelled dock group. */
export function group(label, ...kids) {
  return h('div', { class: ['tu-group', kids.some((k) => k?.classList?.contains('wide')) && 'grow'] }, label && h('span', { class: 'tu-lab' }, label), kids)
}
export const dock = (...groups) => h('div', { class: 'tu-dock' }, groups.flat(Infinity).filter(Boolean))
export const chips = (...kids) => h('div', { class: 'tu-chips' }, kids)

/**
 * Persisted option state with ready-made controls.
 *   const o = createOptions('sort-lines', { mode: 'az', ignoreCase: true }); o.onChange = refresh
 *   o.v.mode, o.pills('mode', [...]), o.bool('ignoreCase', 'Ignore case'), o.text('prefix', {...}), o.num('start', {...}), o.select('x', [...])
 *   o.show(el, () => o.v.mode === 'x') hides el unless the predicate holds.
 */
export function createOptions(id, defaults, storeId) {
  const key = `tu:${storeId || id}`
  const saved = load(key, {})
  const v = {}
  for (const k of Object.keys(defaults)) v[k] = k in saved && typeof saved[k] === typeof defaults[k] ? saved[k] : defaults[k]
  const syncs = []
  const shows = []
  const api = { v, onChange: null }
  const evalShows = () => { for (const [el, pred] of shows) el.hidden = !pred() }
  const commit = () => { save(key, v); evalShows(); api.onChange?.() }
  api.commit = commit
  api.set = (patch) => { Object.assign(v, patch); for (const f of syncs) f(); commit() }
  api.show = (el, pred) => { shows.push([el, pred]); el.hidden = !pred(); return el }
  api.bool = (k, label, title) => {
    const c = chip(label, v[k], (b) => { v[k] = b; commit() }, title)
    syncs.push(() => c.set(v[k]))
    return c
  }
  api.pills = (k, options, ariaLabel) => {
    const p = pills(options, v[k], (val) => { v[k] = val; commit() }, ariaLabel)
    syncs.push(() => p.set(v[k]))
    return p
  }
  api.select = (k, options, ariaLabel) => {
    const el = h('select', { class: 'select', 'aria-label': ariaLabel || null, onchange: (e) => { v[k] = e.target.value; commit() } },
      options.map((o) => { const [val, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: val, selected: String(val) === String(v[k]) }, l) }))
    syncs.push(() => { el.value = v[k] })
    return el
  }
  api.text = (k, { placeholder, cls = 'mid', mono = true, ariaLabel, maxlength } = {}) => {
    const el = h('input', { class: ['input', cls, mono && 'mono'], type: 'text', value: v[k], placeholder, maxlength, spellcheck: false, autocomplete: 'off', 'aria-label': ariaLabel || placeholder || k, oninput: (e) => { v[k] = e.target.value; commit() } })
    syncs.push(() => { el.value = v[k] })
    return el
  }
  api.num = (k, { min, max, step = 1, cls = 'narrow', ariaLabel } = {}) => {
    const el = h('input', {
      class: ['input', cls], type: 'number', inputmode: 'numeric', value: v[k], min, max, step, 'aria-label': ariaLabel || k,
      oninput: (e) => { const n = e.target.valueAsNumber; if (Number.isFinite(n)) { v[k] = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)); commit() } },
      onblur: (e) => { e.target.value = v[k] },
    })
    syncs.push(() => { el.value = v[k] })
    return el
  }
  return api
}

// ---------- Animation helpers ----------

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** Tween an integer shown in el to a new value (falls back to an instant set when hidden or reduced motion). */
export function countTo(el, to, format = (n) => n.toLocaleString(), ms = 420) {
  const from = el._v ?? 0
  el._v = to
  cancelAnimationFrame(el._raf)
  clearTimeout(el._t)
  if (!Number.isInteger(to) || !Number.isInteger(from) || from === to || reduced() || document.hidden) { el.textContent = format(to); return }
  const t0 = performance.now()
  const step = (t) => {
    const p = Math.min(1, (t - t0) / ms)
    el.textContent = format(Math.round(from + (to - from) * (1 - (1 - p) ** 3)))
    if (p < 1) el._raf = requestAnimationFrame(step)
  }
  el._raf = requestAnimationFrame(step)
  el._t = setTimeout(() => { cancelAnimationFrame(el._raf); el.textContent = format(to) }, ms + 120)
}

/** ribbon() -> {el, set([{label, value, tone}], note?)} - badges are reused between updates so numbers tween. */
export function ribbon() {
  const el = h('div', { class: 'tu-ribbon', 'aria-live': 'polite' })
  const set = (items, note) => {
    const list = (items || []).filter(Boolean)
    while (el.children.length > list.length + (note ? 1 : 0)) el.lastChild.remove()
    list.forEach((it, i) => {
      let b = el.children[i]
      const sig = it.label + '|' + (it.tone || '')
      if (!b || b.dataset.sig !== sig || b.classList.contains('tu-note')) {
        const nb = h('span', { class: ['tu-badge', it.tone], dataset: { sig } }, h('b'), h('span', it.label))
        b ? b.replaceWith(nb) : el.append(nb)
        b = nb
      }
      const num = b.firstChild
      if (typeof it.value === 'number') countTo(num, it.value)
      else { num.textContent = it.value; num._v = undefined }
    })
    const last = el.children[list.length]
    if (note) {
      if (last && last.classList.contains('tu-note')) last.textContent = note
      else (last ? last.replaceWith(h('span', { class: 'tu-note' }, note)) : el.append(h('span', { class: 'tu-note' }, note)))
    } else if (last) last.remove()
  }
  return { el, set }
}

/** copyBtn(() => text, 'Copy') - copies, then flips to a green "Copied" state with a small spark burst. */
export function copyBtn(getText, label = 'Copy', opts = {}) {
  const btn = button(label, { icon: 'copy', variant: 'secondary', size: 'sm', ...opts })
  btn.classList.add('tu-copy')
  const original = [...btn.childNodes]
  let timer
  btn.addEventListener('click', async () => {
    const text = typeof getText === 'function' ? getText() : getText
    if (!text) { toast('Nothing to copy yet'); return }
    if (!(await copyText(text))) return
    clearTimeout(timer)
    btn.classList.add('done')
    btn.replaceChildren(icon('check'), ...(label ? [h('span', 'Copied')] : []))
    burst(btn)
    timer = setTimeout(() => { btn.classList.remove('done'); btn.replaceChildren(...original) }, 1500)
  })
  onCleanup(() => clearTimeout(timer))
  return btn
}

const SPARK = ['#6366f1', '#a855f7', '#ec4899', '#f97316', '#22c55e', '#0ea5e9']
/** A few particles flying out of an element (respects reduced motion). */
export function burst(el, n = 8) {
  if (reduced()) return
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.5
    const d = 22 + Math.random() * 16
    const s = h('i', { class: 'tu-spark', style: { '--dx': `${Math.cos(a) * d}px`, '--dy': `${Math.sin(a) * d}px`, '--c1': SPARK[i % SPARK.length] } })
    el.append(s)
    setTimeout(() => s.remove(), 700)
  }
}

/** Retrigger the output sweep animation. */
export function flash(el) {
  if (reduced()) return
  el.classList.remove('flash')
  void el.offsetWidth
  el.classList.add('flash')
}

// ---------- Panes ----------

export function area(props = {}) {
  const { mono, short, ...rest } = props
  return h('textarea', { spellcheck: false, ...rest, class: ['tu-area', mono && 'mono', short && 'short', rest.class] })
}

/** pane({title, out, actions: [Node], body: Node[], foot: Node}) -> section.tu-pane (a glass card with a header row). */
export function pane({ title, out = false, actions = [], body = [], foot }) {
  return h('section', { class: ['tu-pane', out && 'out'] },
    h('div', { class: 'tu-head' }, h('div', { class: 'tu-title' }, h('i'), h('span', title)), h('div', { class: 'tu-acts' }, actions)),
    body, foot)
}

/** Read dropped or picked text files into a textarea. */
export async function readTextFiles(files) {
  const texts = []
  for (const f of files) {
    if (f.size > 8 * 1024 * 1024) { toast(`${f.name} is larger than 8 MB`, 'error'); continue }
    texts.push(await f.text())
  }
  return texts.join('\n')
}

/** Wire drag and drop of text files onto a pane. */
export function acceptFiles(paneEl, onText) {
  const stop = (e) => { e.preventDefault(); e.stopPropagation() }
  paneEl.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { stop(e); paneEl.classList.add('drag') } })
  paneEl.addEventListener('dragleave', () => paneEl.classList.remove('drag'))
  paneEl.addEventListener('drop', async (e) => {
    paneEl.classList.remove('drag')
    if (!e.dataTransfer?.files?.length) return
    stop(e)
    const t = await readTextFiles([...e.dataTransfer.files])
    if (t) onText(t)
  })
}

/** Actions for an input pane: paste, open a text file, try an example, clear. */
export function inputActions({ ta, sample, onChange, onClear }) {
  const set = (t) => { ta.value = t; onChange(); ta.focus({ preventScroll: true }) }
  const acts = [
    button('', { icon: 'clipboard-paste', variant: 'ghost', size: 'sm', ariaLabel: 'Paste from clipboard', onClick: async () => {
      try { set(await navigator.clipboard.readText()) } catch { toast('Your browser blocked clipboard access. Click the box and press Ctrl+V.'); ta.focus() }
    } }),
    button('', { icon: 'file-up', variant: 'ghost', size: 'sm', ariaLabel: 'Open a text file', onClick: async () => {
      const files = await pickFiles({ accept: '.txt,.csv,.tsv,.md,.json,.log,.html,.xml,.srt,.vtt,text/*', multiple: false })
      if (files.length) { const t = await readTextFiles(files); if (t) set(t) }
    } }),
  ]
  if (sample != null) acts.push(button('', { icon: 'wand-sparkles', variant: 'ghost', size: 'sm', ariaLabel: 'Try an example', onClick: () => set(typeof sample === 'function' ? sample() : sample) }))
  acts.push(button('', { icon: 'eraser', variant: 'ghost', size: 'sm', ariaLabel: 'Clear', onClick: () => { ta.value = ''; onClear?.(); onChange(); ta.focus({ preventScroll: true }) } }))
  return acts
}

export function splitLines(text) {
  if (!text) return { lines: [], final: false }
  const lines = text.split(/\r\n|\r|\n/)
  const final = lines.length > 1 && lines[lines.length - 1] === ''
  if (final) lines.pop()
  return { lines, final }
}
export const joinLines = (lines, final = false) => lines.join('\n') + (final && lines.length ? '\n' : '')

/** Plain text download helper with a UTF-8 BOM-free blob. */
export const saveText = (text, name, type = 'text/plain;charset=utf-8') => download(new Blob([text], { type }), name)

function footMeta(text) {
  const chars = [...text].length
  const lines = text ? text.split(/\r\n|\r|\n/).length : 0
  return `${chars.toLocaleString()} chars \u{b7} ${lines.toLocaleString()} ${lines === 1 ? 'line' : 'lines'}`
}

/**
 * studio({id, inputTitle, outputTitle, placeholder, sample, controls, run, filename, mono, extra})
 *   run(text) -> {text, badges: [{label, value, tone}], note, error, extra: Node|null}
 * Builds: dock (controls), ribbon, input + output panes side by side, optional extra block, and returns
 * {el, input, output, refresh, setInput, ribbon}. Call refresh() whenever an option changes.
 */
export function studio(cfg) {
  const {
    inputTitle = 'Your text', outputTitle = 'Result', placeholder = 'Type or paste your text here...', outPlaceholder = '', sample, controls = [], run,
    filename = 'result.txt', mono = false, emptyText = 'Your result shows up here as you type', actions = [], extraTop, after, short = false,
  } = cfg
  injectStyle()
  const input = area({ placeholder, mono, short, 'aria-label': inputTitle })
  const output = area({ readonly: true, placeholder: outPlaceholder, mono, short, 'aria-label': outputTitle })
  const inFoot = h('div', { class: 'tu-foot' }, h('span'), h('span'))
  const outFoot = h('div', { class: 'tu-foot' }, h('span'), h('span'))
  const rib = ribbon()
  const extra = h('div', { class: 'stack', hidden: true })
  let latest = ''
  const empty = h('div', { class: 'tu-empty' }, h('div', { class: 'tu-orb' }, icon('sparkles')),
    h('div', emptyText), sample != null ? button('Try an example', { icon: 'wand-sparkles', variant: 'secondary', size: 'sm', onClick: () => api.setInput(typeof sample === 'function' ? sample() : sample) }) : null)

  const inPane = pane({
    title: inputTitle,
    actions: inputActions({ ta: input, sample, onChange: () => api.refresh(), onClear: () => {} }),
    body: input, foot: inFoot,
  })
  const outPane = pane({
    title: outputTitle, out: true,
    actions: [
      button('', { icon: 'corner-up-left', variant: 'ghost', size: 'sm', ariaLabel: 'Use the result as input', onClick: () => { if (latest) api.setInput(latest) } }),
      saveBtn(() => latest, filename), copyBtn(() => latest, 'Copy'), ...actions,
    ],
    body: [output, empty], foot: outFoot,
  })
  acceptFiles(inPane, (t) => api.setInput(t))

  const dockEl = controls.length ? dock(controls) : null
  const el = root(dockEl, extraTop || null, rib.el, h('div', { class: 'tu-panes' }, inPane, outPane), extra, after || null)

  let seq = 0
  const doRun = () => {
    const text = input.value
    let r
    try { r = tooBig(text) ? { error: tooBig(text) } : run(text) || {} } catch (err) { console.warn(err); r = { error: err.message || String(err) } }
    latest = r.error ? '' : (r.text ?? '')
    output.value = r.display ?? latest
    const had = outPane.dataset.had
    if (latest && latest !== had) flash(outPane)
    outPane.dataset.had = latest
    empty.classList.toggle('gone', !!text)
    rib.set(r.error ? [{ label: r.error, value: '!', tone: 'bad' }] : (text ? r.badges : []), text && !r.error ? r.note : '')
    inFoot.firstChild.textContent = text ? footMeta(text) : 'Nothing yet'
    outFoot.firstChild.textContent = latest ? footMeta(latest) : ''
    clear(outFoot.lastChild, r.foot || '')
    if (r.extra) { clear(extra, r.extra); extra.hidden = false } else { extra.hidden = true; clear(extra) }
    seq++
  }
  const slow = debounce(doRun, 160)
  const api = {
    el, input, output, ribbon: rib, extra,
    refresh: () => (input.value.length > 60_000 ? slow() : doRun()),
    setInput: (t) => { input.value = t; doRun(); input.focus({ preventScroll: true }) },
    get latest() { return latest },
  }
  input.addEventListener('input', api.refresh)
  doRun()
  return api
}

/** Download button for text output (icon button in a pane header). */
export function saveBtn(getText, filename, label = '') {
  return button(label, {
    icon: 'download', variant: 'ghost', size: 'sm', ariaLabel: 'Download as a text file', onClick: () => {
      const t = typeof getText === 'function' ? getText() : getText
      if (!t) { toast('Nothing to download yet'); return }
      saveText(t, typeof filename === 'function' ? filename() : filename)
    },
  })
}

// ---------- Result helpers shared by several tools ----------

export const OUT_FORMATS = [['lines', 'One per line'], ['comma', 'Comma separated'], ['space', 'Space separated'], ['semi', 'Semicolon separated'], ['json', 'JSON array'], ['csv', 'Quoted CSV']]

/** Join a list of strings into the chosen output format. */
export function formatList(list, fmt = 'lines') {
  if (fmt === 'comma') return list.join(', ')
  if (fmt === 'space') return list.join(' ')
  if (fmt === 'semi') return list.join('; ')
  if (fmt === 'json') return list.length ? JSON.stringify(list, null, 2) : ''
  if (fmt === 'csv') return list.map((s) => `"${String(s).replace(/"/g, '""')}"`).join(',')
  return list.join('\n')
}

/** A card with clickable tokens (click copies the token). items: [[label, count?]] */
export function tokenCard(title, items, { max = 24, hint } = {}) {
  if (!items.length) return null
  return h('section', { class: 'tu-card' }, h('h3', title, hint ? h('span', { class: 'tu-hint' }, hint) : null),
    h('div', { class: 'tu-tokens' }, items.slice(0, max).map(([label, n]) => h('button', {
      type: 'button', class: 'tu-token', title: 'Click to copy', onclick: () => copyText(label),
    }, label, n > 1 ? h('small', `\u00d7${n}`) : null))))
}

/** The original text with matched ranges marked. ranges: [{start, end}] sorted and non-overlapping. */
export function highlightCard(text, ranges, title = 'Where they were found') {
  if (!ranges.length) return null
  const LIMIT = 40000
  const kids = []
  let pos = 0
  for (const r of ranges) {
    if (r.start >= LIMIT) break
    if (r.start > pos) kids.push(text.slice(pos, r.start))
    kids.push(h('mark', { class: 'tu-mark' }, text.slice(r.start, Math.min(r.end, LIMIT))))
    pos = r.end
  }
  if (pos < Math.min(text.length, LIMIT)) kids.push(text.slice(pos, LIMIT))
  return h('section', { class: 'tu-card' }, h('h3', title, text.length > LIMIT ? h('span', { class: 'tu-hint' }, 'Showing the first 40,000 characters') : null), h('div', { class: 'tu-doc', style: 'padding:0;min-height:0' }, kids))
}

/**
 * Remove zero-width and other invisible characters. Zero-width joiners and non-joiners are kept when they sit next to
 * emoji or non-Latin letters (Hindi, Persian...), where they change how the text is drawn.
 * Returns [cleanText, removedCount].
 */
export function stripInvisible(text) {
  let n = 0
  const count = () => { n++; return '' }
  text = text.replace(/[\u{200b}\u{200e}\u{200f}\u{202a}-\u{202e}\u{2060}-\u{2064}\u{feff}\u{ad}\u{180e}\u{61c}]/gu, count)
  text = text.replace(/(?<![^\p{Script=Latin}\p{Script=Common}]|\p{Extended_Pictographic}|\u{fe0f})[\u{200c}\u{200d}](?![^\p{Script=Latin}\p{Script=Common}])/gu, count)
  return [text, n]
}

/** Inputs above this many characters are refused with a clear message instead of freezing the tab. */
export const MAX_INPUT = 3_000_000
export const tooBig = (text) => (text.length > MAX_INPUT ? `That is ${(text.length / 1e6).toFixed(1)} million characters. This tool handles up to 3 million at a time, so split the text into parts.` : '')
