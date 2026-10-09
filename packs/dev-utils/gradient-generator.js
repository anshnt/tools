// CSS gradient generator: linear, radial and conic gradients with draggable stops, presets, OKLCH mixing, CSS / Tailwind output and PNG export.
import { h, button, input, number, segmented, select, toggle, alert, clear, download } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { useKit, css, chips, eyebrow, outBox } from './_kit.js'
import * as C from './_color.js'

const hex = (c) => C.toHex(c)
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
let uid = 0

export const PRESETS = [
  { name: 'Aurora', type: 'linear', angle: 135, stops: ['#5b4cf0', '#c026d3', '#f97316'] },
  { name: 'Ocean', type: 'linear', angle: 160, stops: ['#0ea5e9', '#2563eb', '#1e1b4b'] },
  { name: 'Sunset', type: 'linear', angle: 120, stops: ['#fb7185', '#f97316', '#facc15'] },
  { name: 'Mint', type: 'linear', angle: 90, stops: ['#10b981', '#a7f3d0'] },
  { name: 'Peach', type: 'linear', angle: 45, stops: ['#ffecd2', '#fcb69f'] },
  { name: 'Cosmic', type: 'linear', angle: 200, stops: ['#0f0c29', '#302b63', '#24243e'] },
  { name: 'Berry', type: 'linear', angle: 135, stops: ['#ec4899', '#8b5cf6'] },
  { name: 'Lime', type: 'linear', angle: 100, stops: ['#a3e635', '#22c55e', '#0d9488'] },
  { name: 'Candy', type: 'linear', angle: 135, stops: ['#ff9a9e', '#fad0c4', '#fbc2eb', '#a6c1ee'] },
  { name: 'Steel', type: 'linear', angle: 180, stops: ['#e2e8f0', '#94a3b8', '#475569'] },
  { name: 'Glow', type: 'radial', shape: 'circle', cx: 50, cy: 40, stops: ['#fef08a', '#f97316', '#7c2d12'] },
  { name: 'Spotlight', type: 'radial', shape: 'ellipse', cx: 50, cy: 0, stops: ['#ffffff', '#6366f1', '#0f172a'] },
  { name: 'Orb', type: 'radial', shape: 'circle', cx: 30, cy: 30, stops: ['#ffffff', '#38bdf8', '#1d4ed8'] },
  { name: 'Rainbow wheel', type: 'conic', from: 0, cx: 50, cy: 50, stops: ['#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#8b5cf6', '#ef4444'] },
  { name: 'Metal', type: 'conic', from: 45, cx: 50, cy: 50, stops: ['#e5e7eb', '#9ca3af', '#f3f4f6', '#6b7280', '#e5e7eb'] },
  { name: 'Pie', type: 'conic', from: 0, cx: 50, cy: 50, stops: ['#6366f1', '#6366f1', '#ec4899', '#ec4899'], hard: true },
]

const evenStops = (list) => list.map((c, i) => ({ id: ++uid, color: C.parseColor(c), pos: Math.round((i / Math.max(1, list.length - 1)) * 100) }))

/** The state -> CSS gradient value, e.g. "linear-gradient(135deg, #5b4cf0 0%, #c026d3 100%)". */
export function gradientValue(s, { forceSrgb = false } = {}) {
  const stops = [...s.stops].sort((a, b) => a.pos - b.pos).map((x) => `${hex(x.color)} ${Math.round(x.pos * 100) / 100}%`).join(', ')
  const space = s.oklch && !forceSrgb ? 'in oklch ' : ''
  const rep = s.repeating ? 'repeating-' : ''
  const at = `at ${Math.round(s.cx)}% ${Math.round(s.cy)}%`
  if (s.type === 'linear') return `${rep}linear-gradient(${space}${Math.round(s.angle)}deg, ${stops})`
  if (s.type === 'radial') return `${rep}radial-gradient(${space}${s.shape}${s.size === 'farthest-corner' ? '' : ' ' + s.size} ${at}, ${stops})`
  return `${rep}conic-gradient(${space}from ${Math.round(s.from)}deg ${at}, ${stops})`
}

/** Colour at a position (0-100) along the stops. */
export function colorAt(stops, pos, oklch = false) {
  const st = [...stops].sort((a, b) => a.pos - b.pos)
  if (pos <= st[0].pos) return st[0].color
  if (pos >= st[st.length - 1].pos) return st[st.length - 1].color
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[i], b = st[i + 1]
    if (pos >= a.pos && pos <= b.pos) {
      const t = b.pos === a.pos ? 0 : (pos - a.pos) / (b.pos - a.pos)
      if (!oklch) return C.mix(a.color, b.color, t)
      const x = C.toOklab(a.color), y = C.toOklab(b.color)
      return C.clampRgb(C.fromOklab({ l: x.l + (y.l - x.l) * t, a: x.a + (y.a - x.a) * t, b: x.b + (y.b - x.b) * t }, a.color.a + (b.color.a - a.color.a) * t))
    }
  }
  return st[0].color
}

/** Stops for canvas export: with OKLCH mixing every segment is sampled so the result matches the CSS look. */
export function exportStops(s, perSegment = 12) {
  const st = [...s.stops].sort((a, b) => a.pos - b.pos)
  const base = []
  for (let i = 0; i < st.length; i++) {
    base.push({ pos: st[i].pos, color: st[i].color })
    if (s.oklch && i < st.length - 1) for (let k = 1; k < perSegment; k++) { const p = st[i].pos + ((st[i + 1].pos - st[i].pos) * k) / perSegment; base.push({ pos: p, color: colorAt(st, p, true) }) }
  }
  const period = st[st.length - 1].pos - st[0].pos
  if (!s.repeating || period <= 0.5) return base.map((x) => ({ pos: x.pos / 100, color: x.color }))
  const out = []
  for (let k = 0; k * period < 100 && k < 400; k++) for (const x of base) out.push({ pos: (x.pos + k * period) / 100, color: x.color })
  return out
}

export function drawGradient(canvas, s) {
  const ctx = canvas.getContext('2d')
  const { width: w, height: hgt } = canvas
  const stops = exportStops(s)
  const cx = (s.cx / 100) * w, cy = (s.cy / 100) * hgt
  let g
  if (s.type === 'linear') {
    const a = ((s.angle % 360) * Math.PI) / 180
    const len = Math.abs(w * Math.sin(a)) + Math.abs(hgt * Math.cos(a))
    const dx = (Math.sin(a) * len) / 2, dy = (-Math.cos(a) * len) / 2
    g = ctx.createLinearGradient(w / 2 - dx, hgt / 2 - dy, w / 2 + dx, hgt / 2 + dy)
  } else if (s.type === 'radial') {
    const corners = [[0, 0], [w, 0], [0, hgt], [w, hgt]].map(([x, y]) => Math.hypot(x - cx, y - cy))
    const far = Math.max(...corners)
    const near = Math.min(cx, w - cx, cy, hgt - cy)
    const r = s.size === 'closest-side' ? near : s.size === 'farthest-side' ? Math.max(cx, w - cx, cy, hgt - cy) : s.size === 'closest-corner' ? Math.min(...corners) : far
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, r))
  } else if (ctx.createConicGradient) g = ctx.createConicGradient(((s.from - 90) * Math.PI) / 180, cx, cy)
  else throw new Error('This browser cannot draw conic gradients to an image.')
  for (const x of stops) g.addColorStop(clamp(x.pos, 0, 1), `rgb(${Math.round(x.color.r * 255)} ${Math.round(x.color.g * 255)} ${Math.round(x.color.b * 255)} / ${x.color.a})`)
  ctx.fillStyle = g
  ctx.clearRect(0, 0, w, hgt)
  ctx.fillRect(0, 0, w, hgt)
}

const STYLE = `
.t-gg .gg-prev { height: clamp(200px, 36vw, 320px); border-radius: 22px; border: 1px solid var(--border); background-color: var(--surface-2); position: relative; overflow: hidden; }
.t-gg .gg-prev::before { content: ""; position: absolute; inset: 0; background: var(--checker); z-index: 0; }
.t-gg .gg-prev > i { position: absolute; inset: 0; z-index: 1; transition: opacity .2s; }
.t-gg .gg-bar { position: relative; height: 42px; border-radius: 12px; border: 1px solid var(--border-strong); background: var(--checker); cursor: copy; touch-action: none; margin: 14px 10px 18px; }
.t-gg .gg-bar > i { position: absolute; inset: 0; border-radius: 11px; }
.t-gg .gg-h { position: absolute; top: 100%; width: 24px; height: 24px; margin: 6px 0 0 -12px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 0 0 1.5px rgba(0, 0, 0, .45), 0 4px 10px rgba(0, 0, 0, .25); cursor: grab; padding: 0; touch-action: none; transition: transform .15s var(--spring); }
.t-gg .gg-h::before { content: ""; position: absolute; left: 50%; bottom: 100%; width: 2px; height: 8px; margin-left: -1px; background: rgba(0, 0, 0, .35); }
.t-gg .gg-h:hover, .t-gg .gg-h.sel { transform: scale(1.18); }
.t-gg .gg-h.sel { box-shadow: 0 0 0 2.5px var(--accent), 0 4px 10px rgba(0, 0, 0, .3); z-index: 2; }
.t-gg .gg-h:active { cursor: grabbing; }
.t-gg .gg-row { display: grid; grid-template-columns: 44px minmax(0, 1fr) 96px 40px; gap: 8px; align-items: center; padding: 8px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface); }
.t-gg .gg-row.sel { border-color: var(--accent); box-shadow: 0 0 0 3px var(--ring); }
.t-gg .gg-row input[type=color] { width: 44px; height: 38px; padding: 2px; border-radius: 10px; border: 1px solid var(--border-strong); background: var(--surface); cursor: pointer; }
.t-gg .gg-dial { width: 64px; height: 64px; border-radius: 50%; border: 1.5px solid var(--border-strong); background: var(--surface-2); position: relative; cursor: grab; touch-action: none; flex: none; }
.t-gg .gg-dial::after { content: ""; position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px; border-radius: 50%; background: var(--muted); }
.t-gg .gg-dial i { position: absolute; left: 50%; top: 50%; width: 2px; height: 26px; margin-left: -1px; transform-origin: 50% 0; background: var(--accent); border-radius: 2px; }
.t-gg .gg-dial i::after { content: ""; position: absolute; left: -4px; bottom: -4px; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); }
.t-gg .gg-pos { display: grid; grid-template-columns: repeat(3, 30px); gap: 4px; }
.t-gg .gg-pos button { width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; padding: 0; }
.t-gg .gg-pos button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); }
.t-gg .gg-presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 108px), 1fr)); gap: 10px; }
.t-gg .gg-preset { border: 1px solid var(--border); border-radius: 14px; background: var(--surface); padding: 6px; cursor: pointer; display: grid; gap: 6px; text-align: left; font-size: 12.5px; font-weight: 550; color: var(--text); transition: transform .2s var(--spring), box-shadow .2s, border-color .2s; }
.t-gg .gg-preset:hover { transform: translateY(-2px); box-shadow: var(--shadow); border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.t-gg .gg-preset i { display: block; height: 48px; border-radius: 9px; }
.t-gg .gg-use { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; align-items: center; }
.t-gg .gg-text { font-size: clamp(30px, 6vw, 48px); font-weight: 800; letter-spacing: -.04em; line-height: 1.05; background-clip: text; -webkit-background-clip: text; color: transparent; -webkit-text-fill-color: transparent; }
.t-gg .gg-btn { border: 0; border-radius: 999px; padding: 12px 22px; color: #fff; font-weight: 650; font-size: 15px; text-shadow: 0 1px 2px rgba(0, 0, 0, .3); cursor: default; justify-self: start; }
.t-gg .gg-ring { border-radius: 18px; padding: 3px; }
.t-gg .gg-ring > div { background: var(--surface); border-radius: 15px; padding: 14px; font-size: 13px; color: var(--text-2); }
@media (max-width: 520px) { .t-gg .gg-row { grid-template-columns: 44px minmax(0, 1fr) 40px; } .t-gg .gg-row .posbox { grid-column: 1 / -1; } }
`

export function mount(root) {
  useKit()
  css('t-gg-css', STYLE)
  const saved = load('gradient', null)
  const s = {
    type: 'linear', angle: 135, shape: 'circle', size: 'farthest-corner', cx: 50, cy: 50, from: 0, repeating: false, oklch: false,
    stops: evenStops(PRESETS[0].stops),
  }
  if (saved?.stops?.length >= 2) {
    Object.assign(s, { type: saved.type, angle: saved.angle, shape: saved.shape, size: saved.size, cx: saved.cx, cy: saved.cy, from: saved.from, repeating: !!saved.repeating, oklch: !!saved.oklch })
    s.stops = saved.stops.map((x) => ({ id: ++uid, color: C.parseColor(x.color) || C.rgb(0, 0, 0), pos: x.pos }))
  }
  let sel = s.stops[0].id
  const supportsOklch = typeof CSS !== 'undefined' && CSS.supports?.('background', 'linear-gradient(in oklch, red, blue)')

  const prevFill = h('i')
  const preview = h('div', { class: 'gg-prev', role: 'img', 'aria-label': 'Gradient preview' }, prevFill)
  const barFill = h('i')
  const bar = h('div', { class: 'gg-bar', title: 'Click to add a colour stop', role: 'group', 'aria-label': 'Colour stops. Click the bar to add one, drag a handle to move it.' }, barFill)
  const rowsEl = h('div', { class: 'stack tight' })
  const out = outBox('CSS', { placeholder: '' })
  const tw = outBox('Tailwind CSS', { placeholder: '' })
  const useEl = h('div', { class: 'gg-use' })
  const note = h('div')

  // ----- type controls -----
  const typeSeg = segmented([['linear', 'Linear'], ['radial', 'Radial'], ['conic', 'Conic']], s.type, (v) => { s.type = v; controls(); update() }, 'Gradient type')
  const angle = number(s.angle, { min: 0, max: 360, step: 1, ariaLabel: 'Angle in degrees', onInput: (v) => { if (Number.isFinite(v)) { s.angle = ((v % 360) + 360) % 360; paintDial(); update() } } })
  const from = number(s.from, { min: 0, max: 360, step: 1, ariaLabel: 'Start angle in degrees', onInput: (v) => { if (Number.isFinite(v)) { s.from = ((v % 360) + 360) % 360; paintDial(); update() } } })
  const dialHand = h('i')
  const dial = h('div', { class: 'gg-dial', role: 'slider', tabindex: 0, 'aria-label': 'Angle dial', 'aria-valuemin': 0, 'aria-valuemax': 360 }, dialHand)
  const dialValue = () => (s.type === 'linear' ? s.angle : s.from)
  function paintDial() { dialHand.style.transform = `rotate(${dialValue() + 180}deg)`; dial.setAttribute('aria-valuenow', Math.round(dialValue())) }
  function setAngle(v) { v = ((Math.round(v) % 360) + 360) % 360; if (s.type === 'linear') { s.angle = v; angle.value = v } else { s.from = v; from.value = v } paintDial(); update() }
  dial.addEventListener('pointerdown', (e) => {
    dial.setPointerCapture(e.pointerId)
    const move = (ev) => { const r = dial.getBoundingClientRect(); let a = (Math.atan2(ev.clientX - (r.left + r.width / 2), -(ev.clientY - (r.top + r.height / 2))) * 180) / Math.PI; if (ev.shiftKey) a = Math.round(a / 15) * 15; setAngle(a) }
    move(e)
    dial.addEventListener('pointermove', move)
    dial.addEventListener('pointerup', () => dial.removeEventListener('pointermove', move), { once: true })
  })
  dial.addEventListener('keydown', (e) => { const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key]; if (d) { e.preventDefault(); setAngle(dialValue() + d * (e.shiftKey ? 15 : 1)) } })
  const angleQuick = chips([[0, '0°'], [45, '45°'], [90, '90°'], [135, '135°'], [180, '180°'], [270, '270°']], { ariaLabel: 'Common angles', onChange: (v) => setAngle(v) })
  const shape = segmented([['circle', 'Circle'], ['ellipse', 'Ellipse']], s.shape, (v) => { s.shape = v; update() }, 'Radial shape')
  const sizeSel = select([['farthest-corner', 'Farthest corner'], ['closest-corner', 'Closest corner'], ['farthest-side', 'Farthest side'], ['closest-side', 'Closest side']], s.size, (v) => { s.size = v; update() })
  sizeSel.setAttribute('aria-label', 'Radial size')
  const cxIn = number(s.cx, { min: -50, max: 150, step: 1, ariaLabel: 'Centre X percent', onInput: (v) => { if (Number.isFinite(v)) { s.cx = v; update() } } })
  const cyIn = number(s.cy, { min: -50, max: 150, step: 1, ariaLabel: 'Centre Y percent', onInput: (v) => { if (Number.isFinite(v)) { s.cy = v; update() } } })
  const posGrid = h('div', { class: 'gg-pos', role: 'group', 'aria-label': 'Centre position' }, [0, 50, 100].flatMap((y) => [0, 50, 100].map((x) => h('button', { type: 'button', 'aria-label': `Centre at ${x}% ${y}%`, 'aria-pressed': String(s.cx === x && s.cy === y), dataset: { x, y }, onclick: () => { s.cx = x; s.cy = y; cxIn.value = x; cyIn.value = y; update() } }))))
  const rep = toggle('Repeating', s.repeating, (v) => { s.repeating = v; update() })
  const ok = toggle('Smooth mixing (OKLCH)', s.oklch, (v) => { s.oklch = v; update() })
  const linearBox = h('div', { class: 'row', style: 'gap:16px' }, dial, h('div', { class: 'stack tight', style: 'flex:1;min-width:200px' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Angle (degrees)'), angle), angleQuick))
  const radialBox = h('div', { class: 'stack tight' }, h('div', { class: 'row' }, shape, h('label', { class: 'field', style: 'flex:1;min-width:170px' }, h('span', { class: 'field-label' }, 'Size'), sizeSel)))
  const centerBox = h('div', { class: 'row', style: 'gap:16px' }, posGrid, h('div', { class: 'grid-2', style: 'flex:1;min-width:200px' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Centre X (%)'), cxIn), h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Centre Y (%)'), cyIn)))
  const typeBox = h('div')
  function controls() {
    clear(typeBox, s.type === 'linear' ? linearBox : s.type === 'radial' ? radialBox : h('div', { class: 'row', style: 'gap:16px' }, dial, h('label', { class: 'field', style: 'min-width:160px' }, h('span', { class: 'field-label' }, 'Start angle (degrees)'), from)), s.type !== 'linear' ? centerBox : null)
    paintDial()
  }

  // ----- stops -----
  const stopById = (id) => s.stops.find((x) => x.id === id)
  function renderBar() {
    const sorted = [...s.stops].sort((a, b) => a.pos - b.pos)
    barFill.style.background = `linear-gradient(90deg, ${sorted.map((x) => `${hex(x.color)} ${x.pos}%`).join(', ')})`
    bar.querySelectorAll('.gg-h').forEach((n) => n.remove())
    for (const st of s.stops) {
      const hd = h('button', { type: 'button', class: ['gg-h', st.id === sel && 'sel'], style: { left: `${clamp(st.pos, 0, 100)}%`, background: hex(C.rgb(st.color.r, st.color.g, st.color.b)) }, 'aria-label': `Colour stop at ${Math.round(st.pos)}%. Arrow keys move it.`, dataset: { id: st.id } })
      hd.addEventListener('pointerdown', (e) => {
        e.stopPropagation()
        sel = st.id
        hd.setPointerCapture(e.pointerId)
        const move = (ev) => { const r = bar.getBoundingClientRect(); st.pos = Math.round(clamp(((ev.clientX - r.left) / r.width) * 100, 0, 100) * 10) / 10; hd.style.left = `${st.pos}%`; syncRow(st); update(true) }
        hd.addEventListener('pointermove', move)
        hd.addEventListener('pointerup', () => { hd.removeEventListener('pointermove', move); renderStops(); update() }, { once: true })
        renderRowsSel()
      })
      hd.addEventListener('keydown', (e) => {
        const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
        if (d) { e.preventDefault(); st.pos = clamp(st.pos + d * (e.shiftKey ? 10 : 1), 0, 100); renderStops(); bar.querySelector(`[data-id="${st.id}"]`)?.focus(); update() }
        else if ((e.key === 'Delete' || e.key === 'Backspace') && s.stops.length > 2) { e.preventDefault(); removeStop(st.id) }
      })
      hd.addEventListener('focus', () => { if (sel !== st.id) { sel = st.id; renderRowsSel() } })
      bar.append(hd)
    }
  }
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.gg-h')) return
    const r = bar.getBoundingClientRect()
    const pos = Math.round(clamp(((e.clientX - r.left) / r.width) * 100, 0, 100))
    const st = { id: ++uid, color: colorAt(s.stops, pos, s.oklch), pos }
    s.stops.push(st)
    sel = st.id
    renderStops(); update()
  })
  function removeStop(id) {
    if (s.stops.length <= 2) return
    s.stops = s.stops.filter((x) => x.id !== id)
    if (sel === id) sel = s.stops[0].id
    renderStops(); update()
  }
  const rowRefs = new Map()
  function syncRow(st) { const r = rowRefs.get(st.id); if (r) r.pos.value = st.pos }
  function renderRowsSel() { for (const [id, r] of rowRefs) r.el.classList.toggle('sel', id === sel); bar.querySelectorAll('.gg-h').forEach((n) => n.classList.toggle('sel', +n.dataset.id === sel)) }
  function renderStops() {
    renderBar()
    rowRefs.clear()
    clear(rowsEl, ...[...s.stops].sort((a, b) => a.pos - b.pos).map((st) => {
      const pick = h('input', { type: 'color', value: hex(C.rgb(st.color.r, st.color.g, st.color.b)), 'aria-label': 'Stop colour', oninput: (e) => { const p = C.parseColor(e.target.value); st.color = { ...p, a: st.color.a }; txt.value = hex(st.color); update(true); renderBarOnly() } })
      const txt = input({ mono: true, value: hex(st.color), 'aria-label': 'Stop colour value', spellcheck: false, oninput: (e) => { const p = C.parseColor(e.target.value); if (p) { st.color = p; pick.value = hex(C.rgb(p.r, p.g, p.b)); e.target.classList.remove('invalid'); update(true); renderBarOnly() } else e.target.classList.add('invalid') } })
      const pos = number(st.pos, { min: 0, max: 100, step: 1, ariaLabel: 'Stop position percent', onInput: (v) => { if (Number.isFinite(v)) { st.pos = clamp(v, 0, 100); renderBarOnly(); update(true) } } })
      pos.addEventListener('change', () => renderStops())
      const del = button('', { icon: 'trash-2', variant: 'ghost', size: 'sm', ariaLabel: 'Remove stop', disabled: s.stops.length <= 2, onClick: () => removeStop(st.id) })
      const el = h('div', { class: ['gg-row', st.id === sel && 'sel'], onfocusin: () => { sel = st.id; renderRowsSel() }, onclick: () => { sel = st.id; renderRowsSel() } }, pick, txt, h('div', { class: 'posbox' }, h('div', { style: 'display:flex;align-items:center;gap:4px' }, pos, h('span', { class: 'small muted' }, '%'))), del)
      rowRefs.set(st.id, { el, pos })
      return el
    }))
  }
  function renderBarOnly() {
    const sorted = [...s.stops].sort((a, b) => a.pos - b.pos)
    barFill.style.background = `linear-gradient(90deg, ${sorted.map((x) => `${hex(x.color)} ${x.pos}%`).join(', ')})`
    for (const st of s.stops) { const n = bar.querySelector(`[data-id="${st.id}"]`); if (n) { n.style.left = `${clamp(st.pos, 0, 100)}%`; n.style.background = hex(C.rgb(st.color.r, st.color.g, st.color.b)) } }
  }

  // ----- output -----
  function update(light) {
    const value = gradientValue(s)
    const fallback = gradientValue(s, { forceSrgb: true })
    const first = hex([...s.stops].sort((a, b) => a.pos - b.pos)[0].color)
    prevFill.style.background = s.oklch && !supportsOklch ? fallback : value
    clear(note, s.oklch && !supportsOklch ? alert('warn', 'This browser cannot preview OKLCH mixing, so the preview uses normal sRGB mixing. The CSS below is still correct for browsers that support it.') : h('span'))
    const lines = [`background: ${first};`, ...(s.oklch ? [`background: ${fallback};`] : []), `background: ${value};`]
    out.set(lines.join('\n'), { quiet: true })
    tw.set(`bg-[${value.replace(/\s+/g, '_')}]`, { quiet: true })
    for (const b of posGrid.children) b.setAttribute('aria-pressed', String(s.cx === +b.dataset.x && s.cy === +b.dataset.y))
    if (!light) {
      const bg = s.oklch && !supportsOklch ? fallback : value
      clear(useEl,
        h('div', { class: 'gg-text', style: { backgroundImage: bg } }, 'Gradient text'),
        h('button', { type: 'button', class: 'gg-btn', style: { backgroundImage: bg }, tabindex: -1 }, 'Gradient button'),
        h('div', { class: 'gg-ring', style: { backgroundImage: bg } }, h('div', 'Gradient border')))
    }
    save('gradient', { ...s, stops: s.stops.map((x) => ({ color: hex(x.color), pos: x.pos })) })
  }

  function apply(p) {
    s.type = p.type
    if (p.angle != null) s.angle = p.angle
    if (p.from != null) s.from = p.from
    if (p.shape) s.shape = p.shape
    if (p.cx != null) { s.cx = p.cx; s.cy = p.cy ?? 50 } else if (p.type !== 'linear') { s.cx = 50; s.cy = 50 }
    s.size = 'farthest-corner'
    s.stops = p.hard ? p.stops.map((c, i) => ({ id: ++uid, color: C.parseColor(c), pos: [0, 50, 50, 100][i] ?? 100 })) : evenStops(p.stops)
    sel = s.stops[0].id
    typeSeg.set(s.type); angle.value = s.angle; from.value = s.from; cxIn.value = s.cx; cyIn.value = s.cy; shape.set(s.shape); sizeSel.value = s.size
    controls(); renderStops(); update()
  }
  const random = () => {
    const h0 = Math.random() * 360
    const n = 2 + Math.floor(Math.random() * 2)
    const cols = Array.from({ length: n }, (_, i) => C.oklchInGamut({ l: 0.62 + Math.random() * 0.22, c: 0.1 + Math.random() * 0.14, h: (h0 + i * (40 + Math.random() * 70)) % 360 }))
    apply({ type: s.type, angle: Math.round(Math.random() * 36) * 10, from: 0, shape: s.shape, stops: cols.map(hex) })
  }

  // PNG export
  const wIn = number(1920, { min: 16, max: 8000, step: 1, ariaLabel: 'Export width' })
  const hIn = number(1080, { min: 16, max: 8000, step: 1, ariaLabel: 'Export height' })
  const png = button('Download PNG', { icon: 'download', variant: 'primary', onClick: () => {
    const w = clamp(Math.round(wIn.valueAsNumber) || 1920, 16, 8000), hh = clamp(Math.round(hIn.valueAsNumber) || 1080, 16, 8000)
    const cv = document.createElement('canvas')
    cv.width = w; cv.height = hh
    try { drawGradient(cv, s) } catch (e) { clear(note, alert('error', e.message)); return }
    cv.toBlob((b) => b && download(b, 'gradient.png'), 'image/png')
  } })

  const presetsEl = h('div', { class: 'gg-presets' }, PRESETS.map((p) => {
    const tmp = { ...s, type: p.type, angle: p.angle ?? 135, shape: p.shape || 'circle', size: 'farthest-corner', cx: p.cx ?? 50, cy: p.cy ?? 50, from: p.from ?? 0, repeating: false, oklch: false, stops: p.hard ? p.stops.map((c, i) => ({ color: C.parseColor(c), pos: [0, 50, 50, 100][i] ?? 100 })) : evenStops(p.stops) }
    return h('button', { type: 'button', class: 'gg-preset', onclick: () => apply(p), title: `Use ${p.name}` }, h('i', { style: { background: gradientValue(tmp) } }), p.name)
  }))

  root.append(h('div', { class: 'dv t-gg stack' },
    h('div', { class: 'stack tight' }, preview, note),
    h('div', { class: 'tool-split wide-left' },
      h('div', { class: 'stack' },
        h('div', { class: 'panel stack' },
          h('div', { class: 'row between' }, eyebrow('palette', 'Colour stops'), h('div', { class: 'row', style: 'gap:6px' }, button('Random', { icon: 'dices', size: 'sm', onClick: random }), button('Reverse', { icon: 'arrow-left-right', size: 'sm', variant: 'ghost', onClick: () => { for (const x of s.stops) x.pos = 100 - x.pos; renderStops(); update() } }))),
          bar, rowsEl, h('div', { class: 'small muted' }, 'Click the bar to add a stop, drag a handle to move it, press Delete to remove the selected one.')),
        h('div', { class: 'panel stack' }, eyebrow('sliders-horizontal', 'Shape'), typeSeg, typeBox, h('div', { class: 'row' }, rep, ok), s.repeating ? h('div', { class: 'small muted' }, 'A repeating gradient tiles the pattern between its first and last stop, so move the last stop below 100%.') : null)),
      h('div', { class: 'stack' }, out.el, tw.el,
        h('div', { class: 'panel stack tight' }, eyebrow('image', 'Export an image'), h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Width (px)'), wIn), h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Height (px)'), hIn)), h('div', { class: 'row' }, png)))),
    h('div', { class: 'panel stack' }, eyebrow('eye', 'See it in use'), useEl),
    h('div', { class: 'panel stack' }, eyebrow('layout-grid', 'Presets'), presetsEl),
    h('p', { class: 'small muted' }, 'OKLCH mixing (CSS Color 4) avoids the muddy grey middle of blends such as blue to yellow. Browsers without support ignore that line and use the sRGB fallback listed above it.')))
  controls(); renderStops(); update()
}
