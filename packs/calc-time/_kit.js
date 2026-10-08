// Shared look for the calc-time pack: one scoped stylesheet (every class starts with ct-) and small building blocks
// (hero result card, bento tiles, count-up numbers, confetti, ring, date field, chips). Files starting with _ are not tools.
import { h, svg, icon, button, field } from '../../lib/ui.js'
import { isoDate, parseISO, today, ymd, toDayNum, weekday, daysInMonth, MONTHS } from './_dates.js'

const CSS = `
.ct { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.ct * { min-width: 0; }
.ct-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 170px), 1fr)); gap: 12px; align-items: start; }
.ct-fields.f3 { grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr); }
@media (max-width: 720px) { .ct-fields.f3 { grid-template-columns: repeat(2, minmax(0, 1fr)); } .ct-fields.f3 > :first-child { grid-column: 1 / -1; } }
.ct-h { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--text-2); }
.ct-h .icon { width: 16px; height: 16px; color: var(--c, var(--accent)); }
.ct-sub { font-size: 13px; color: var(--muted); }

.ct-hero {
  position: relative; isolation: isolate; overflow: hidden; border-radius: var(--radius-xl); padding: clamp(20px, 4.5vw, 34px);
  border: 1px solid color-mix(in srgb, var(--c, var(--accent)) 26%, var(--border));
  background: linear-gradient(155deg, color-mix(in srgb, var(--c, var(--accent)) 12%, var(--surface)) 0%, var(--surface) 64%);
  box-shadow: var(--shadow); animation: ctRise .6s var(--ease) both;
}
.ct-hero::before, .ct-hero::after { content: ""; position: absolute; z-index: -1; border-radius: 50%; pointer-events: none; filter: blur(6px); }
.ct-hero::before { width: 360px; height: 360px; right: -120px; top: -170px; background: radial-gradient(circle at 35% 35%, color-mix(in srgb, var(--c, var(--accent)) 40%, transparent), transparent 66%); animation: ctDrift 16s ease-in-out infinite alternate; }
.ct-hero::after { width: 300px; height: 300px; left: -110px; bottom: -190px; background: radial-gradient(circle, color-mix(in srgb, var(--accent-2) 28%, transparent), transparent 66%); animation: ctDrift 21s ease-in-out infinite alternate-reverse; }
.ct-dots { position: absolute; inset: 0; z-index: -1; pointer-events: none; opacity: .55;
  background-image: radial-gradient(color-mix(in srgb, var(--text) 16%, transparent) 1px, transparent 1.4px); background-size: 16px 16px;
  mask-image: linear-gradient(120deg, transparent 35%, #000 100%); -webkit-mask-image: linear-gradient(120deg, transparent 35%, #000 100%); }
.ct-hero-row { display: flex; gap: 22px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.ct-hero-main { flex: 1 1 280px; }
.ct-kicker { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .12em; color: var(--muted); }
.ct-big { margin-top: 8px; font-size: clamp(34px, 8vw, 66px); font-weight: 700; letter-spacing: -.05em; line-height: 1.04; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.ct-big .u { font-size: .4em; font-weight: 550; letter-spacing: -.01em; color: var(--muted); margin: 0 .55em 0 .14em; display: inline-block; }
.ct-big.sm { font-size: clamp(28px, 6vw, 46px); }
.ct-grad { background: var(--brand); background-size: 200% auto; -webkit-background-clip: text; background-clip: text; color: transparent; animation: shimmer 7s linear infinite; padding-bottom: .05em; }
:root[data-theme="dark"] .ct-grad { background-image: linear-gradient(120deg, #a5b4fc, #d8b4fe 38%, #f9a8d4 70%, #fdba74); }
.ct-lede { margin-top: 10px; color: var(--text-2); font-size: 15px; overflow-wrap: anywhere; }
.ct-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
.ct-actions:empty { display: none; }

.ct-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 142px), 1fr)); gap: 10px; }
.ct-tiles.c4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.ct-tiles.c3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
@media (max-width: 720px) { .ct-tiles.c4, .ct-tiles.c3 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.ct-tile {
  position: relative; overflow: hidden; border-radius: 18px; padding: 14px 14px 13px; background: var(--surface); border: 1px solid var(--border);
  box-shadow: var(--shadow-sm); transition: transform .3s var(--ease), box-shadow .3s var(--ease), border-color .3s;
  animation: ctPop .5s var(--spring) both; animation-delay: calc(var(--i, 0) * 45ms);
}
.ct-tile:hover { transform: translateY(-3px); box-shadow: var(--shadow); border-color: color-mix(in srgb, var(--tc, var(--c, var(--accent))) 40%, var(--border)); }
.ct-tile .ic { width: 30px; height: 30px; border-radius: 10px; display: grid; place-items: center; color: var(--tc, var(--c, var(--accent))); background: color-mix(in srgb, var(--tc, var(--c, var(--accent))) 14%, transparent); }
.ct-tile .ic .icon { width: 16px; height: 16px; }
.ct-tile .l { font-size: 12.5px; color: var(--muted); margin-top: 10px; }
.ct-tile .v { font-size: 22px; font-weight: 650; letter-spacing: -.03em; font-variant-numeric: tabular-nums; line-height: 1.15; overflow-wrap: anywhere; }
.ct-tile .t { font-size: 12px; color: var(--muted); margin-top: 3px; overflow-wrap: anywhere; }
.ct-tile.wide { grid-column: span 2; }
.ct-tile.accent { background: linear-gradient(140deg, color-mix(in srgb, var(--c, var(--accent)) 14%, var(--surface)), var(--surface)); border-color: color-mix(in srgb, var(--c, var(--accent)) 34%, var(--border)); }
.ct-tile.accent .v { color: var(--c, var(--accent)); }
.ct-tile.danger { background: var(--danger-soft); border-color: color-mix(in srgb, var(--danger) 30%, var(--border)); }
.ct-tile.danger .v { color: var(--danger); }

.ct-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.ct-chip {
  min-height: 32px; padding: 0 13px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--text-2);
  font-size: 13px; font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; max-width: 100%;
  transition: border-color .2s, background .2s, color .2s, transform .25s var(--spring), box-shadow .2s;
}
.ct-chip .icon { width: 14px; height: 14px; }
.ct-chip:hover { border-color: color-mix(in srgb, var(--c, var(--accent)) 55%, var(--border)); transform: translateY(-1px); box-shadow: var(--shadow-sm); }
.ct-chip:active { transform: scale(.96); }
.ct-chip[aria-pressed="true"] { background: var(--text); color: var(--bg); border-color: var(--text); }
.ct-chip.x { padding-right: 8px; }
.ct-daychips { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
.ct-daychips .ct-chip { justify-content: center; padding: 0; }

.ct-date { display: flex; gap: 6px; align-items: center; }
.ct-date .input { flex: 1; min-width: 0; }

.ct-ring { position: relative; flex: none; display: grid; place-items: center; }
.ct-ring svg { display: block; transform: rotate(-90deg); }
.ct-ring .track { stroke: color-mix(in srgb, var(--text) 10%, transparent); }
.ct-ring .bar { transition: stroke-dashoffset 1.1s var(--ease); }
.ct-ring .mid { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; line-height: 1.1; }
.ct-ring .mid b { font-size: 30px; font-weight: 700; letter-spacing: -.04em; font-variant-numeric: tabular-nums; }
.ct-ring .mid span { font-size: 11.5px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; margin-top: 3px; }

.ct-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.ct-li { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface); animation: ctRise .45s var(--ease) both; animation-delay: calc(var(--i, 0) * 40ms); }
.ct-li .dot { width: 34px; height: 34px; border-radius: 11px; flex: none; display: grid; place-items: center; color: var(--c, var(--accent)); background: color-mix(in srgb, var(--c, var(--accent)) 13%, transparent); }
.ct-li .dot .icon { width: 17px; height: 17px; }
.ct-li .tx { flex: 1; min-width: 0; }
.ct-li .tx b { display: block; font-weight: 600; font-size: 14.5px; overflow-wrap: anywhere; }
.ct-li .tx span { display: block; font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }
.ct-li .when { font-size: 12.5px; font-weight: 600; color: var(--c, var(--accent)); white-space: nowrap; }
.ct-li.past { opacity: .6; }
.ct-li.past .when { color: var(--muted); }

.ct-burst { position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 5; }
.ct-burst i { position: absolute; left: 50%; top: 40%; width: 8px; height: 12px; border-radius: 2px; }


.ct-cals { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr)); gap: 12px; }
.ct-cal { border: 1px solid var(--border); border-radius: 16px; padding: 12px; background: var(--surface); animation: ctPop .5s var(--spring) both; animation-delay: calc(var(--i, 0) * 50ms); }
.ct-cal h4 { font-size: 13px; margin: 0 0 8px; font-weight: 600; letter-spacing: -.01em; }
.ct-cal-g { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; text-align: center; }
.ct-cal-g b { font-size: 10.5px; font-weight: 500; color: var(--muted); padding-bottom: 2px; }
.ct-cal-g i { font-style: normal; height: 25px; display: grid; place-items: center; border-radius: 8px; font-size: 11.5px; font-variant-numeric: tabular-nums; color: var(--muted); transition: transform .2s var(--spring); }
.ct-cal-g i.in { background: color-mix(in srgb, var(--c, var(--accent)) 15%, transparent); color: var(--text); }
.ct-cal-g i.in.off { background: var(--surface-2); color: var(--muted); }
.ct-cal-g i.hol { background: var(--warning-soft); color: var(--warning); font-weight: 700; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--warning) 40%, transparent); }
.ct-cal-g i.a, .ct-cal-g i.b { background: linear-gradient(140deg, var(--c, var(--accent)), color-mix(in srgb, var(--c, var(--accent)) 60%, var(--accent-2))); color: #fff; font-weight: 700; transform: scale(1.08); box-shadow: 0 6px 14px -6px var(--c, var(--accent)); }
.ct-cal-g i.today:not(.a):not(.b) { box-shadow: inset 0 0 0 1.5px var(--c, var(--accent)); color: var(--text); font-weight: 700; }
.ct-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--muted); }
.ct-legend span { display: inline-flex; align-items: center; gap: 6px; }
.ct-legend i { width: 12px; height: 12px; border-radius: 4px; background: color-mix(in srgb, var(--c, var(--accent)) 25%, transparent); }
.ct-legend i.k-off { background: var(--surface-3); }
.ct-legend i.k-hol { background: var(--warning-soft); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--warning) 50%, transparent); }
.ct-legend i.k-ab { background: var(--c, var(--accent)); }


.ct-bars { display: flex; flex-direction: column; gap: 8px; }
.ct-bar { display: grid; grid-template-columns: 74px minmax(0, 1fr) 38px; gap: 10px; align-items: center; font-size: 13px; animation: ctRise .45s var(--ease) both; animation-delay: calc(var(--i, 0) * 35ms); }
.ct-bar .n { color: var(--text-2); white-space: nowrap; }
.ct-bar .bar { height: 12px; border-radius: 999px; background: var(--surface-2); overflow: hidden; border: 1px solid var(--border); }
.ct-bar .bar i { display: block; height: 100%; width: var(--w); border-radius: inherit; background: var(--brand); transform-origin: 0 50%; animation: ctGrow .8s var(--ease) both; animation-delay: calc(var(--i, 0) * 35ms); }
.ct-bar b { text-align: right; font-variant-numeric: tabular-nums; }
.ct-settled .ct-tile, .ct-settled .ct-li, .ct-settled .ct-cal, .ct-settled .ct-bar, .ct-settled .ct-bar .bar i, .ct-settled .ct-hero { animation: none !important; }

@keyframes ctGrow { from { transform: scaleX(0); } }
@keyframes ctRise { from { opacity: 0; transform: translateY(14px); } }
@keyframes ctPop { from { opacity: 0; transform: translateY(10px) scale(.94); } }
@keyframes ctDrift { 0% { transform: translate(0, 0) scale(1); } 100% { transform: translate(-36px, 26px) scale(1.12); } }
@media (max-width: 720px) { .ct-tile { padding: 12px; } .ct-tile .v { font-size: 19px; } }
`

let styled = false
/** Inject the pack stylesheet once. Call from every mount(). */
export function useStyles() {
  if (styled && document.getElementById('ct-style')) return
  styled = true
  document.head.append(h('style', { id: 'ct-style' }, CSS))
}

/** After the first results have popped in, stop replaying entrance animations on every live update. */
export function settleOnce(el) {
  if (el._settle) return
  el._settle = setTimeout(() => el.classList.add('ct-settled'), 1300)
}

/** Inject extra CSS for one tool once (give it a unique id). */
export function addStyles(id, css) {
  if (!document.getElementById(id)) document.head.append(h('style', { id }, css))
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Count-up numbers that glide from the last value shown for the same key.
 * const count = counter(); count(el, 'years', 34, fmt?)   (el.dataset.v always holds the exact target)
 */
export function counter() {
  const last = new Map()
  return function count(el, key, to, fmt = (v) => Math.round(v).toLocaleString()) {
    el.dataset.v = String(to)
    const from = last.get(key) ?? 0
    last.set(key, to)
    const final = fmt(to)
    if (reducedMotion() || document.hidden || from === to || !Number.isFinite(to) || !Number.isFinite(from)) { el.textContent = final; return }
    const t0 = performance.now(), dur = 560
    const token = (el._tw = (el._tw || 0) + 1)
    const step = (now) => {
      if (el._tw !== token) return
      const p = Math.min(1, (now - t0) / dur)
      el.textContent = p >= 1 ? final : fmt(from + (to - from) * (1 - Math.pow(1 - p, 3)))
      if (p < 1 && el.isConnected) requestAnimationFrame(step)
    }
    el.textContent = fmt(from)
    requestAnimationFrame(step)
    setTimeout(() => { if (el._tw === token) el.textContent = final }, dur + 80)
  }
}

const CONFETTI = ['#6366f1', '#a855f7', '#ec4899', '#f97316', '#eab308', '#22c55e', '#06b6d4']
/** Quick confetti burst inside `host` (made position: relative if needed). Skipped for reduced motion. */
export function burst(host, n = 44) {
  if (reducedMotion() || !host.animate) return
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative'
  const layer = h('div', { class: 'ct-burst', 'aria-hidden': 'true' })
  host.append(layer)
  const w = host.clientWidth || 300
  for (let i = 0; i < n; i++) {
    const p = h('i', { style: { background: CONFETTI[i % CONFETTI.length] } })
    layer.append(p)
    const dx = (Math.random() - 0.5) * w * 0.9, dy = 120 + Math.random() * 220, rot = (Math.random() - 0.5) * 900
    p.animate([
      { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
      { transform: `translate(${dx * 0.7}px, ${-70 - Math.random() * 90}px) rotate(${rot * 0.4}deg)`, opacity: 1, offset: 0.35 },
      { transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`, opacity: 0 },
    ], { duration: 1300 + Math.random() * 900, easing: 'cubic-bezier(.2,.7,.3,1)', delay: Math.random() * 120 })
  }
  setTimeout(() => layer.remove(), 2600)
}

/** Hero result card. Returns {el, kicker, big, lede, side, actions}: fill the parts in place. */
export function hero({ side, actions } = {}) {
  const kicker = h('div', { class: 'ct-kicker' })
  const big = h('div', { class: 'ct-big', 'aria-live': 'polite' })
  const lede = h('div', { class: 'ct-lede' })
  const acts = h('div', { class: 'ct-actions' }, actions)
  const el = h('section', { class: 'ct-hero' }, h('i', { class: 'ct-dots' }),
    h('div', { class: 'ct-hero-row' }, h('div', { class: 'ct-hero-main' }, kicker, big, lede, acts), side || null))
  return { el, kicker, big, lede, side, actions: acts }
}

/** Static tile. tile({icon, label, value, hint, accent, danger, wide, color}) - value may be a Node. */
export function tile(o, i = 0) {
  return h('div', { class: ['ct-tile', o.accent && 'accent', o.danger && 'danger', o.wide && 'wide'], style: { '--i': i, ...(o.color ? { '--tc': o.color } : {}) } },
    o.icon ? h('div', { class: 'ic' }, icon(o.icon)) : null,
    h('div', { class: 'l' }, o.label),
    h('div', { class: 'v' }, o.value),
    o.hint ? h('div', { class: 't' }, o.hint) : null)
}

/**
 * Tiles that are built once and updated in place (no flicker while typing, numbers glide to the new value).
 * const T = liveTiles([{key, icon, label, color, accent, wide}]); T.set('days', 12345, 'hint', {danger, fmt, hide})
 */
export function liveTiles(defs, cols) {
  const count = counter()
  const refs = {}
  const el = h('div', { class: ['ct-tiles', cols && `c${cols}`] }, defs.map((d, i) => {
    const v = h('div', { class: 'v' }), t = h('div', { class: 't' })
    const node = h('div', { class: ['ct-tile', d.accent && 'accent', d.wide && 'wide'], style: { '--i': i, ...(d.color ? { '--tc': d.color } : {}) } },
      d.icon ? h('div', { class: 'ic' }, icon(d.icon)) : null, h('div', { class: 'l' }, d.label), v, t)
    refs[d.key] = { node, v, t, label: node.querySelector('.l') }
    return node
  }))
  return {
    el, refs,
    set(key, value, hint, o = {}) {
      const r = refs[key]
      if (typeof value === 'number') count(r.v, key, value, o.fmt)
      else { r.v.textContent = value; r.v.dataset.v = value }
      if (hint !== undefined) r.t.textContent = hint
      if (o.label) r.label.textContent = o.label
      r.node.classList.toggle('danger', !!o.danger)
      r.node.hidden = !!o.hide
    },
  }
}
export const tiles = (list, cols) => h('div', { class: ['ct-tiles', cols && `c${cols}`] }, list.filter(Boolean).map((o, i) => tile(o, i)))

/** Pill button row. chips([{label, icon, onClick, pressed}]) */
export function chips(list, cls = '') {
  return h('div', { class: ['ct-chips', cls] }, list.map((c) => h('button', {
    type: 'button', class: 'ct-chip', 'aria-pressed': c.pressed == null ? null : String(!!c.pressed), onclick: c.onClick, title: c.title || null,
  }, c.icon && icon(c.icon), c.label)))
}

/** Date input with a "Today" shortcut. Returns {el, input, get(): dayNumber|NaN, set(dayNumber)}. */
export function dateField(label, initial, onChange, { quick = true, hint } = {}) {
  const input = h('input', { class: 'input', type: 'date', value: Number.isFinite(initial) ? isoDate(initial) : '', 'aria-label': label, oninput: () => onChange?.(parseISO(input.value)) })
  const row = h('div', { class: 'ct-date' }, input,
    quick ? button('Today', { variant: 'ghost', size: 'sm', title: 'Use today\'s date', onClick: () => { input.value = isoDate(today()); onChange?.(parseISO(input.value)) } }) : null)
  const el = field(label, row, hint)
  return { el, input, get: () => parseISO(input.value), set: (n) => { input.value = Number.isFinite(n) ? isoDate(n) : '' } }
}

let ringId = 0
/** Progress ring. ring({size, stroke}) -> {el, set(fraction, big, small)}. */
export function ring({ size = 140, stroke = 11 } = {}) {
  const id = `ctg${++ringId}`
  const r = (size - stroke) / 2, c = 2 * Math.PI * r
  const bar = svg('circle', { class: 'bar', cx: size / 2, cy: size / 2, r, fill: 'none', stroke: `url(#${id})`, 'stroke-width': stroke, 'stroke-linecap': 'round', 'stroke-dasharray': c, 'stroke-dashoffset': c })
  const big = h('b'), small = h('span')
  const el = h('div', { class: 'ct-ring', style: { width: `${size}px`, height: `${size}px` }, role: 'img' },
    svg('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' },
      svg('defs', svg('linearGradient', { id, x1: 0, y1: 0, x2: 1, y2: 1 }, svg('stop', { offset: '0%', 'stop-color': '#6366f1' }), svg('stop', { offset: '55%', 'stop-color': '#ec4899' }), svg('stop', { offset: '100%', 'stop-color': '#f97316' }))),
      svg('circle', { class: 'track', cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke }), bar),
    h('div', { class: 'mid' }, big, small))
  return {
    el, big, small,
    set(fraction, b, s, label) {
      const f = Math.max(0, Math.min(1, fraction))
      bar.style.strokeDashoffset = String(c * (1 - f))
      if (b != null) big.textContent = b
      if (s != null) small.textContent = s
      if (label) el.setAttribute('aria-label', label)
    },
  }
}

/** Query string after the route in the hash: #/tool-id?x=1 */
export const hashParams = () => new URLSearchParams(location.hash.split('?')[1] || '')
/** Update the query part of the hash without re-mounting the tool. */
export function setHashParams(obj) {
  const base = location.hash.split('?')[0] || '#/'
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(obj)) if (v != null && v !== '') q.set(k, v)
  const s = q.toString()
  try { history.replaceState(null, '', base + (s ? `?${s}` : '')) } catch { /* sandboxed */ }
}

export const fmtInt = (n) => Math.round(n).toLocaleString()
export const fmtNum = (n, max = 2) => (Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: max }) : '-')

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
/**
 * Month grids (Monday first) from the month of `from` to the month of `to`; null when more than `max` months.
 * classify(dayNumber) -> {cls: 'in off hol a b today', title}
 */
export function miniCalendars(from, to, classify, { max = 24 } = {}) {
  const A = ymd(from), B = ymd(to)
  const months = (B.y - A.y) * 12 + B.m - A.m + 1
  if (months > max || months < 1) return null
  const wrap = h('div', { class: 'ct-cals', 'aria-hidden': 'true' })
  for (let k = 0; k < months; k++) {
    const idx = A.y * 12 + A.m - 1 + k
    const y = Math.floor(idx / 12), m = (idx % 12) + 1
    const first = toDayNum(y, m, 1)
    wrap.append(h('div', { class: 'ct-cal', style: { '--i': Math.min(k, 8) } }, h('h4', `${MONTHS[m - 1]} ${y}`),
      h('div', { class: 'ct-cal-g' }, DOW.map((d) => h('b', d)), Array.from({ length: weekday(first) }, () => h('i')),
        Array.from({ length: daysInMonth(y, m) }, (_, i) => { const c = classify(first + i) || {}; return h('i', { class: c.cls, title: c.title }, i + 1) }))))
  }
  return wrap
}
export const legend = (items) => h('div', { class: 'ct-legend', 'aria-hidden': 'true' }, items.map(([k, label]) => h('span', h('i', { class: k }), label)))
