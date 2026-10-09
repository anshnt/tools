// Paint editor for fill and stroke: none, solid colour, linear or radial gradient with draggable stops.
import { h, button } from '../../lib/ui.js'
import { solid } from './_model.js'
import { clamp, DEG } from './_geom.js'

export const SWATCHES = ['#000000', '#ffffff', '#6c5ce7', '#0ea5e9', '#22c55e', '#eab308', '#ef4444', '#ec4899']
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i
export function normHex(v) {
  const m = String(v).trim().match(HEX)
  if (!m) return null
  let x = m[1].toLowerCase()
  if (x.length === 3) x = [...x].map((c) => c + c).join('')
  return '#' + x
}
const hexToRgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
const rgbToHex = (r) => '#' + r.map((x) => Math.round(clamp(x, 0, 255)).toString(16).padStart(2, '0')).join('')
const rgba = (c, a) => { const [r, g, b] = hexToRgb(c); return `rgba(${r},${g},${b},${a})` }
export const cssGradient = (p, dir = 'to right') => `linear-gradient(${dir}, ${[...p.stops].sort((a, b) => a.o - b.o).map((s) => `${rgba(s.c, s.a)} ${Math.round(s.o * 100)}%`).join(', ')})`

/** CSS background for a small swatch of any paint (checkerboard shows through transparency). */
export function swatchCss(p) {
  if (!p) return 'linear-gradient(135deg, transparent 46%, #e5484d 46% 54%, transparent 54%), var(--surface)'
  if (p.t === 'solid') return `linear-gradient(${rgba(p.c, p.a)}, ${rgba(p.c, p.a)}), var(--checker)`
  if (p.t === 'linear') return cssGradient(p, '90deg')
  return `radial-gradient(circle, ${[...p.stops].sort((a, b) => a.o - b.o).map((s) => `${rgba(s.c, s.a)} ${Math.round(s.o * 100)}%`).join(', ')})`
}

function sample(p, o) {
  const st = [...p.stops].sort((a, b) => a.o - b.o)
  if (o <= st[0].o) return { c: st[0].c, a: st[0].a }
  for (let i = 1; i < st.length; i++) {
    if (o <= st[i].o) {
      const A = st[i - 1], B = st[i], t = (o - A.o) / (B.o - A.o || 1), ra = hexToRgb(A.c), rb = hexToRgb(B.c)
      return { c: rgbToHex(ra.map((x, k) => x + (rb[k] - x) * t)), a: A.a + (B.a - A.a) * t }
    }
  }
  return { c: st.at(-1).c, a: st.at(-1).a }
}

/** paintEditor({apply(paint, merge)}) -> {el, set(paint)}. The editor keeps its own copy and calls apply() on every change. */
export function paintEditor({ apply }) {
  let paint = null, idx = 0
  const el = h('div', { class: 'vs-paint' })
  const seg = h('div', { class: 'vs-seg', role: 'group', 'aria-label': 'Paint type' })
  const body = h('div', { class: 'vs-paint-body' })
  const TYPES = [['none', 'None'], ['solid', 'Solid'], ['linear', 'Linear'], ['radial', 'Radial']]
  const btns = TYPES.map(([v, l]) => h('button', { type: 'button', 'data-t': v, onclick: () => setType(v) }, l))
  seg.append(...btns)
  el.append(seg, body)

  const firstColor = () => (paint?.t === 'solid' ? paint.c : paint?.stops?.[0]?.c) || '#6c5ce7'
  const type = () => (paint ? paint.t : 'none')
  function setType(t) {
    if (t === type()) return
    if (t === 'none') return emit(null, true)
    if (t === 'solid') return emit(solid(firstColor(), paint?.t === 'solid' ? paint.a : paint?.stops?.[0]?.a ?? 1), true)
    const stops = paint?.stops ? paint.stops : [{ o: 0, c: firstColor(), a: 1 }, { o: 1, c: '#ec4899', a: 1 }]
    idx = 0
    emit(t === 'linear' ? { t, stops, x1: 0, y1: 0.5, x2: 1, y2: 0.5 } : { t, stops, cx: 0.5, cy: 0.5, r: 0.5, fx: 0.5, fy: 0.5 }, true)
  }
  function emit(p, rebuild = false, merge = 'paint') {
    paint = p
    apply(p, merge)
    if (rebuild) build(); else refresh()
  }
  const colorInput = (get, set) => {
    const c = h('input', { type: 'color', class: 'vs-color', value: get(), 'aria-label': 'Colour', oninput: () => { set(c.value); hex.value = c.value } })
    const hex = h('input', { class: 'vs-hex', value: get(), maxlength: 7, spellcheck: false, 'aria-label': 'Hex colour', onchange: () => { const v = normHex(hex.value); if (v) { set(v); c.value = v; hex.value = v } else hex.value = c.value } })
    return { c, hex, el: h('div', { class: 'vs-colorrow' }, c, hex), sync() { const v = get(); if (document.activeElement !== hex) hex.value = v; c.value = v } }
  }
  const numField = (label, get, set, { min = 0, max = 100, step = 1, suffix = '' } = {}) => {
    const i = h('input', { type: 'number', class: 'vs-num', min, max, step, value: get(), 'aria-label': label, onchange: () => { const v = i.valueAsNumber; if (Number.isFinite(v)) set(clamp(v, min, max)); else i.value = get() } })
    return { el: h('label', { class: 'vs-mini' }, h('span', label), i, suffix && h('em', suffix)), sync() { if (document.activeElement !== i) i.value = get() } }
  }
  let syncers = []
  let gbar, markers = []

  function build() {
    btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.t === type())))
    syncers = []; markers = []; gbar = null
    body.replaceChildren()
    if (!paint) { body.append(swatchRow()); return }
    if (paint.t === 'solid') {
      const ci = colorInput(() => paint.c, (v) => emit({ ...paint, c: v }))
      const al = numField('Opacity', () => Math.round(paint.a * 100), (v) => emit({ ...paint, a: v / 100 }), { suffix: '%' })
      syncers.push(ci, al)
      body.append(ci.el, al.el)
    } else {
      gbar = h('div', { class: 'vs-gbar', onpointerdown: (e) => { if (e.target === gbar) addStop(e) } })
      body.append(h('div', { class: 'vs-gwrap' }, gbar))
      const sel = () => paint.stops[Math.min(idx, paint.stops.length - 1)]
      const ci = colorInput(() => sel().c, (v) => { sel().c = v; emit({ ...paint }) })
      const off = numField('Position', () => Math.round(sel().o * 100), (v) => { sel().o = v / 100; emit({ ...paint }, true) }, { suffix: '%' })
      const op = numField('Opacity', () => Math.round(sel().a * 100), (v) => { sel().a = v / 100; emit({ ...paint }) }, { suffix: '%' })
      const del = button('', { icon: 'trash-2', variant: 'ghost', size: 'sm', ariaLabel: 'Remove stop', title: 'Remove stop', onClick: () => { if (paint.stops.length > 2) { paint.stops.splice(idx, 1); idx = 0; emit({ ...paint }, true) } } })
      const rev = button('Reverse', { variant: 'secondary', size: 'sm', onClick: () => { paint.stops = paint.stops.map((s) => ({ ...s, o: 1 - s.o })); emit({ ...paint }, true) } })
      syncers.push(ci, off, op)
      body.append(h('div', { class: 'vs-hint' }, 'Click the bar to add a stop, drag stops to move them.'), ci.el, h('div', { class: 'vs-row2' }, off.el, op.el, del))
      if (paint.t === 'linear') {
        const ang = () => { const a = Math.atan2(paint.y2 - paint.y1, paint.x2 - paint.x1) / DEG; return Math.round((a + 360) % 360) }
        const an = numField('Angle', ang, (v) => { const r = v * DEG; emit({ ...paint, x1: 0.5 - Math.cos(r) / 2, y1: 0.5 - Math.sin(r) / 2, x2: 0.5 + Math.cos(r) / 2, y2: 0.5 + Math.sin(r) / 2 }) }, { min: 0, max: 360, suffix: 'deg' })
        syncers.push(an)
        body.append(h('div', { class: 'vs-row2' }, an.el, rev))
      } else {
        const r = numField('Radius', () => Math.round(paint.r * 100), (v) => emit({ ...paint, r: Math.max(0.01, v / 100) }), { min: 1, max: 300, suffix: '%' })
        const cx = numField('Center X', () => Math.round(paint.cx * 100), (v) => emit({ ...paint, cx: v / 100, fx: v / 100 }), { min: -100, max: 200, suffix: '%' })
        const cy = numField('Center Y', () => Math.round(paint.cy * 100), (v) => emit({ ...paint, cy: v / 100, fy: v / 100 }), { min: -100, max: 200, suffix: '%' })
        syncers.push(r, cx, cy)
        body.append(h('div', { class: 'vs-row2' }, r.el, rev), h('div', { class: 'vs-row2' }, cx.el, cy.el))
      }
      drawStops()
    }
    body.append(swatchRow())
  }
  const swatchRow = () => h('div', { class: 'vs-swatches' }, SWATCHES.map((c) => h('button', {
    type: 'button', class: 'vs-sw', style: { background: c }, title: c, 'aria-label': `Colour ${c}`,
    onclick: () => { if (!paint || paint.t === 'solid') emit(solid(c, paint?.a ?? 1), true); else { paint.stops[Math.min(idx, paint.stops.length - 1)].c = c; emit({ ...paint }, true) } },
  })))
  function drawStops() {
    if (!gbar) return
    gbar.style.background = `${cssGradient(paint)}, var(--checker)`
    gbar.replaceChildren(...paint.stops.map((s, i) => {
      const m = h('button', {
        type: 'button', class: ['vs-gstop', i === idx && 'on'], style: { left: s.o * 100 + '%', background: s.c }, 'aria-label': `Stop ${i + 1}`,
        onpointerdown: (e) => {
          e.preventDefault(); e.stopPropagation()
          idx = i
          m.setPointerCapture(e.pointerId)
          gbar.querySelectorAll('.vs-gstop').forEach((x, k) => x.classList.toggle('on', k === idx))
          syncers.forEach((x) => x.sync())
          const rect = gbar.getBoundingClientRect()
          const mv = (ev) => { s.o = clamp((ev.clientX - rect.left) / rect.width, 0, 1); m.style.left = s.o * 100 + '%'; emit({ ...paint }) }
          const up = () => { m.removeEventListener('pointermove', mv); m.removeEventListener('pointerup', up); build() }
          m.addEventListener('pointermove', mv); m.addEventListener('pointerup', up)
        },
        onkeydown: (e) => { if (e.key === 'Delete' && paint.stops.length > 2) { paint.stops.splice(i, 1); idx = 0; emit({ ...paint }, true) } },
      })
      return m
    }))
  }
  function addStop(e) {
    const rect = gbar.getBoundingClientRect()
    const o = clamp((e.clientX - rect.left) / rect.width, 0, 1), s = sample(paint, o)
    paint.stops.push({ o, ...s })
    idx = paint.stops.length - 1
    emit({ ...paint }, true)
  }
  function refresh() { syncers.forEach((s) => s.sync()); if (gbar) { gbar.style.background = `${cssGradient(paint)}, var(--checker)` } }

  return {
    el,
    set(p) {
      if (JSON.stringify(p) === JSON.stringify(paint) && body.childElementCount) { refresh(); return }
      const sameKind = (p?.t || 'none') === type() && p?.stops?.length === paint?.stops?.length
      paint = p ? structuredClone(p) : null
      if (!p || idx >= (p.stops?.length || 0)) idx = 0
      if (sameKind && body.childElementCount) { drawStops(); refresh() } else build()
    },
  }
}
