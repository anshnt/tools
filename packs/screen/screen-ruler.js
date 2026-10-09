// On-screen ruler (cm / inch), calibrated to your display by matching a real card, coin, note or any known length.
import { h, svg, button, copyText, segmented, select, number, field, rangeField, clear, toast, stats } from '../../lib/ui.js'
import { persisted } from '../../lib/store.js'
import { baseCss, injectCss, listen, clamp } from './_shared.js'

const MM_PER_IN = 25.4
export const OBJECTS = [
  { id: 'card', label: 'Bank, ID or Aadhaar card - long edge (85.60 mm)', w: 85.6, h: 53.98, r: 3.18 },
  { id: 'card-s', label: 'Bank, ID or Aadhaar card - short edge (53.98 mm)', w: 53.98, h: 85.6, r: 3.18 },
  { id: 'quarter', label: 'US quarter coin (24.26 mm)', w: 24.26, h: 24.26, round: true },
  { id: 'euro2', label: '2 euro coin (25.75 mm)', w: 25.75, h: 25.75, round: true },
  { id: 'euro1', label: '1 euro coin (23.25 mm)', w: 23.25, h: 23.25, round: true },
  { id: 'inr500', label: 'Indian 500 rupee note - long edge (150 mm)', w: 150, h: 66, r: 1 },
  { id: 'usd', label: 'US dollar bill - long edge (156 mm)', w: 156, h: 66.3, r: 1 },
  { id: 'a4', label: 'A4 sheet - short edge (210 mm)', w: 210, h: 60, r: 0 },
  { id: 'letter', label: 'US Letter sheet - short edge (215.9 mm)', w: 215.9, h: 60, r: 0 },
  { id: 'custom', label: 'Something else (type its length)', w: 100, h: 30, r: 2 },
]
export const LENGTHS = [['15', '15 cm / 6 in'], ['30', '30 cm / 12 in'], ['60', '60 cm / 24 in'], ['100', '100 cm / 40 in']]

/** Tick marks for a ruler: [{mm, level, label}] where level 1 is the finest. unit 'cm' (mm steps) or 'in' (1/16 steps). */
export function rulerTicks(unit, lengthMm) {
  const out = []
  if (unit === 'cm') {
    for (let i = 0; i <= Math.floor(lengthMm + 1e-9); i++) out.push({ mm: i, level: i % 10 === 0 ? 3 : i % 5 === 0 ? 2 : 1, label: i % 10 === 0 ? String(i / 10) : '' })
  } else {
    const step = MM_PER_IN / 16
    for (let n = 0; n * step <= lengthMm + 1e-9; n++) out.push({ mm: n * step, level: n % 16 === 0 ? 5 : n % 8 === 0 ? 4 : n % 4 === 0 ? 3 : n % 2 === 0 ? 2 : 1, label: n % 16 === 0 ? String(n / 16) : '' })
  }
  return out
}
/** Physical pixels per mm from a diagonal in inches and the screen size in CSS pixels. */
export const pxPerMmFromDiagonal = (wCss, hCss, dpr, diagIn) => (Math.hypot(wCss, hCss) * dpr) / (diagIn * MM_PER_IN)
export const fmtIn = (mm) => {
  const inch = mm / MM_PER_IN
  const sixteenths = Math.round(inch * 16)
  const whole = Math.floor(sixteenths / 16), rem = sixteenths % 16
  if (!rem) return `${whole} in`
  let a = rem, b = 16
  while (a % 2 === 0) { a /= 2; b /= 2 }
  return `${whole ? whole + ' ' : ''}${a}/${b} in`
}

const CSS = `
.t-sr .cal{position:relative;border-radius:var(--radius-lg);border:1px dashed var(--border-strong);background:var(--surface-2);padding:18px 40px 18px 18px;overflow-x:auto;display:flex;align-items:center;min-height:120px}
.t-sr .obj{position:relative;flex:none;border-radius:var(--r);background:linear-gradient(135deg,#6366f1,#a855f7 50%,#ec4899);box-shadow:0 20px 40px -22px rgba(99,102,241,.8),inset 0 0 0 1px rgba(255,255,255,.35);display:grid;place-items:center;color:#fff;font-weight:600;transition:box-shadow .2s}
.t-sr .obj .chip-mark{width:11%;aspect-ratio:1.25;border-radius:12%;background:linear-gradient(135deg,#fde68a,#f59e0b);position:absolute;left:12%;top:26%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.2)}
.t-sr .obj .dims{font-family:var(--mono);font-size:12.5px;text-align:center;padding:4px 8px;border-radius:8px;background:rgba(0,0,0,.28)}
.t-sr .handle{position:absolute;top:0;bottom:0;right:-14px;width:28px;cursor:ew-resize;touch-action:none;display:grid;place-items:center}
.t-sr .handle i{display:block;width:6px;height:46px;max-height:60%;border-radius:4px;background:var(--text);opacity:.8;box-shadow:0 0 0 3px var(--surface)}
.t-sr .handle:hover i,.t-sr .handle:focus-visible i{background:var(--accent);opacity:1}
.t-sr .handle:focus-visible{outline:none}
.t-sr .calrow{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:14px;align-items:end}
.t-sr .fine{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.t-sr .state{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:550}
.t-sr .state .dot{width:9px;height:9px;border-radius:50%;background:var(--success);box-shadow:0 0 0 4px color-mix(in srgb,var(--success) 22%,transparent)}
.t-sr .state.guess .dot{background:var(--warning);box-shadow:0 0 0 4px color-mix(in srgb,var(--warning) 22%,transparent)}
.t-sr .rl{position:relative;border-radius:var(--radius);border:1px solid var(--border-strong);overflow:auto;background:color-mix(in srgb,#f5c542 20%,var(--surface-2));box-shadow:inset 0 1px 0 rgba(255,255,255,.5),var(--shadow)}
.t-sr .rl.v{max-height:min(72vh,760px);width:fit-content;max-width:100%}
.t-sr .rl-in{position:relative;cursor:crosshair;touch-action:pan-x pan-y}
.t-sr .rl svg{display:block;color:var(--text)}
.t-sr .rl text{fill:var(--text);font-family:var(--mono);font-size:12px;font-weight:600}
.t-sr .mk{position:absolute;pointer-events:none;background:var(--accent);z-index:2}
.t-sr .mk.h{top:0;bottom:0;width:2px;margin-left:-1px}
.t-sr .mk.vv{left:0;right:0;height:2px;margin-top:-1px}
.t-sr .mk b{position:absolute;white-space:nowrap;font:600 11.5px var(--mono);background:var(--accent);color:var(--accent-text);padding:2px 7px;border-radius:6px}
.t-sr .mk.h b{top:44%;left:6px}.t-sr .mk.vv b{left:50%;top:6px}
.t-sr .mk.ghost{opacity:.65;background:var(--text)}.t-sr .mk.ghost b{background:var(--text);color:var(--bg)}
.t-sr .span-band{position:absolute;pointer-events:none;background:color-mix(in srgb,var(--accent) 16%,transparent);z-index:1}
.t-sr details summary{cursor:pointer;font-weight:550;font-size:14px;color:var(--text-2)}
@media (max-width:640px){.t-sr .calrow{grid-template-columns:minmax(0,1fr)}}
`

export function mount(root) {
  baseCss()
  injectCss('sr', CSS)
  const coarse = matchMedia('(pointer: coarse)').matches
  const guessPpm = coarse ? 160 / MM_PER_IN : 96 / MM_PER_IN // CSS px per mm: 96 px/in on desktop, ~160 on phones
  const saved = persisted('screen-ruler:cal', null)
  const prefs = persisted('screen-ruler:prefs', { obj: null, custom: 100, units: 'both', vertical: false, length: '30' })
  const dpr = () => window.devicePixelRatio || 1
  let cal = saved.get() // {P: physical px per mm}
  let guess = !cal
  const P0 = () => cal?.P ?? guessPpm * dpr()
  const ppm = () => P0() / dpr() // CSS px per mm at the current zoom
  const P = prefs.get()
  const room = (root.clientWidth || 1000) - 110
  let objId = P.obj && OBJECTS.some((o) => o.id === P.obj) ? P.obj : (['card', 'card-s', 'quarter'].find((id) => OBJECTS.find((o) => o.id === id).w * ppm() <= room) || 'quarter')
  let customMm = P.custom, units = P.units, vertical = P.vertical, length = P.length
  let marks = [], hover = null
  const obj = () => OBJECTS.find((o) => o.id === objId)
  const objMm = () => (objId === 'custom' ? clamp(customMm || 100, 5, 1000) : obj().w)

  // ----- calibration -----
  const chipMark = h('span', { class: 'chip-mark' })
  const dimsEl = h('span', { class: 'dims' })
  const handle = h('div', { class: 'handle', tabindex: 0, role: 'slider', 'aria-label': 'Resize until the shape is exactly as wide as your real object', title: 'Drag to resize' }, h('i'))
  const objEl = h('div', { class: 'obj' }, chipMark, dimsEl, handle)
  const cal$ = h('div', { class: 'cal' }, objEl)
  const wideNote = h('p', { class: 'small muted', hidden: true }, 'This shape is wider than your screen. Scroll sideways to reach its edge, pick a smaller object, or use the screen-size estimate below.')
  const stateEl = h('div', { class: 'state' })
  const ppiEl = h('span', { class: 'small muted sc-mono' })
  const slider = rangeField('Fine tune the size', { min: 1.5, max: 14, step: 0.005, value: ppm(), format: (v) => `${(v * MM_PER_IN).toFixed(1)} px/in`, onInput: (v) => setPpm(v) })
  const objSel = select(OBJECTS.map((o) => [o.id, o.label]), objId, (v) => { objId = v; prefs.update((p) => ({ ...p, obj: v })); customField.hidden = v !== 'custom'; drawCal() })
  const customIn = number(customMm, { min: 5, max: 1000, step: 0.1, onInput: (v) => { if (v > 0) { customMm = v; prefs.update((p) => ({ ...p, custom: v })); drawCal() } } })
  const customField = field('Length of your object (mm)', customIn, 'Measure it with any ruler or use its printed size.')
  customField.hidden = objId !== 'custom'

  function setPpm(v, persist = true) {
    v = clamp(v, 1.5, 14)
    cal = { P: v * dpr() }
    guess = false
    if (persist) saved.set(cal)
    drawCal(); drawRuler()
  }
  function drawCal() {
    const o = obj(), pp = ppm()
    const w = objMm() * pp, hgt = (objId === 'custom' ? 20 : o.h) * pp
    objEl.style.cssText = `width:${w}px;height:${o.round ? w : hgt}px;--r:${o.round ? '50%' : (o.r ?? 1) * pp + 'px'}`
    wideNote.hidden = w <= cal$.clientWidth - 58 || !cal$.clientWidth
    chipMark.hidden = o.round || !objId.startsWith('card')
    dimsEl.textContent = `${objMm()} mm`
    stateEl.className = `state${guess ? ' guess' : ''}`
    clear(stateEl, h('span', { class: 'dot' }), guess ? 'Not calibrated yet: this is a rough guess' : 'Calibrated and saved on this device')
    ppiEl.textContent = `${(pp * MM_PER_IN).toFixed(1)} CSS px per inch · ${pp.toFixed(3)} px per mm`
    slider.set(clamp(pp, 1.5, 14))
  }
  // drag the right edge of the shape
  let dragging = false
  handle.addEventListener('pointerdown', (e) => { dragging = true; handle.setPointerCapture(e.pointerId); e.preventDefault() })
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const left = objEl.getBoundingClientRect().left
    setPpm((e.clientX - left) / objMm(), false)
  })
  const endDrag = () => { if (dragging) { dragging = false; saved.set(cal) } }
  handle.addEventListener('pointerup', endDrag)
  handle.addEventListener('pointercancel', endDrag)
  handle.addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key]
    if (!d) return
    e.preventDefault()
    setPpm(ppm() + (d * (e.shiftKey ? 5 : 1)) / objMm())
  })

  const fineBtns = h('div', { class: 'fine' },
    button('', { icon: 'minus', size: 'sm', ariaLabel: 'Smaller by one pixel', onClick: () => setPpm(ppm() - 1 / objMm()) }),
    button('', { icon: 'plus', size: 'sm', ariaLabel: 'Larger by one pixel', onClick: () => setPpm(ppm() + 1 / objMm()) }),
    button('Reset', { icon: 'rotate-ccw', size: 'sm', variant: 'ghost', onClick: () => { saved.set(null); cal = null; guess = true; drawCal(); drawRuler(); toast('Calibration cleared') } }),
    ppiEl)

  // quick estimate from the monitor size
  const diagIn = number('', { min: 5, max: 120, step: 0.1, placeholder: 'e.g. 15.6' })
  const estimate = h('details', { class: 'stack tight' }, h('summary', 'No card handy? Estimate from your screen size'),
    h('div', { class: 'row', style: 'margin-top:10px' },
      field('Screen diagonal (inches)', diagIn),
      button('Use this', { icon: 'check', onClick: () => {
        if (!(diagIn.valueAsNumber > 0)) return toast('Type the diagonal of your screen in inches first', 'error')
        const p = pxPerMmFromDiagonal(screen.width, screen.height, dpr(), diagIn.valueAsNumber) / dpr()
        setPpm(p)
        toast(`Set from a ${diagIn.valueAsNumber} inch screen`, 'success')
      } })),
    h('p', { class: 'small muted' }, 'Less exact than matching a real card, because the stated size is rounded and the screen may not be full resolution.'))

  // ----- ruler -----
  const lengthSel = select(LENGTHS, length, (v) => { length = v; prefs.update((p) => ({ ...p, length: v })); marks = []; drawRuler() })
  const unitSeg = segmented([['both', 'cm and inch'], ['cm', 'cm'], ['in', 'inch']], units, (v) => { units = v; prefs.update((p) => ({ ...p, units: v })); drawRuler() }, 'Units')
  const orientSeg = segmented([['h', 'Horizontal'], ['v', 'Vertical']], vertical ? 'v' : 'h', (v) => { vertical = v === 'v'; prefs.update((p) => ({ ...p, vertical })); marks = []; drawRuler() }, 'Orientation')
  const rl = h('div', { class: 'rl' })
  const readHost = h('div')

  function drawRuler() {
    const pp = ppm(), mm = Number(length) * 10
    const L = mm * pp, thick = units === 'both' ? 96 : 64
    const both = units === 'both'
    const edge = (unit, side) => {
      const ticks = rulerTicks(unit, mm)
      const lens = unit === 'cm' ? { 1: 9, 2: 15, 3: 24 } : { 1: 8, 2: 12, 3: 17, 4: 22, 5: 28 }
      const d = ticks.map((t) => {
        const p = (t.mm * pp + 0.5).toFixed(2), l = lens[t.level]
        const a = side === 'top' ? 0 : thick, b = side === 'top' ? l : thick - l
        return vertical ? `M${a} ${p}L${b} ${p}` : `M${p} ${a}L${p} ${b}`
      }).join('')
      const maxLen = Math.max(...Object.values(lens))
      const labels = ticks.filter((t) => t.label).map((t) => {
        const p = t.mm * pp + 0.5, text = t.mm === 0 ? `${t.label} ${unit}` : t.label
        if (!vertical) return svg('text', { x: p + 4, y: side === 'top' ? maxLen + 14 : thick - maxLen - 6 }, text)
        return svg('text', { x: side === 'top' ? maxLen + 6 : thick - maxLen - 6, y: Math.max(p + 4, 14), 'text-anchor': side === 'top' ? 'start' : 'end' }, text)
      })
      return [svg('path', { d, stroke: 'currentColor', 'stroke-width': 1, fill: 'none' }), labels]
    }
    const first = units === 'in' ? 'in' : 'cm'
    const parts = [edge(first, 'top'), both ? edge('in', 'bottom') : null]
    const s = svg('svg', { width: vertical ? thick : L, height: vertical ? L : thick, viewBox: vertical ? `0 0 ${thick} ${L}` : `0 0 ${L} ${thick}`, role: 'img', 'aria-label': `Ruler, ${length} centimetres long` }, parts)
    const inn = h('div', { class: 'rl-in', style: vertical ? { height: `${L}px`, width: `${thick}px` } : { width: `${L}px`, height: `${thick}px` } }, s)
    rl.classList.toggle('v', vertical)
    clear(rl, inn)
    rl._inner = inn
    paintMarks()
    const posOf = (e) => { const r = inn.getBoundingClientRect(); return clamp((vertical ? e.clientY - r.top : e.clientX - r.left) / pp, 0, mm) }
    inn.onpointermove = (e) => { hover = posOf(e); paintMarks() }
    inn.onpointerleave = () => { hover = null; paintMarks() }
    inn.onclick = (e) => { const v = posOf(e); marks = marks.length >= 2 ? [v] : [...marks, v]; paintMarks() }
  }

  const fmtMm = (v) => `${(v / 10).toFixed(2)} cm`
  function paintMarks() {
    const inn = rl._inner
    if (!inn) return
    const pp = ppm()
    inn.querySelectorAll('.mk,.span-band').forEach((n) => n.remove())
    const mark = (v, cls, label) => {
      const p = v * pp
      const m = h('div', { class: ['mk', vertical ? 'vv' : 'h', cls], style: vertical ? { top: `${p}px` } : { left: `${p}px` } }, h('b', label))
      inn.append(m)
    }
    marks.forEach((v, i) => mark(v, '', `${i ? 'B' : 'A'} ${fmtMm(v)}`))
    if (marks.length === 2) {
      const [a, b] = [...marks].sort((x, y) => x - y)
      inn.append(h('div', { class: 'span-band', style: vertical ? { top: `${a * pp}px`, height: `${(b - a) * pp}px`, left: 0, right: 0 } : { left: `${a * pp}px`, width: `${(b - a) * pp}px`, top: 0, bottom: 0 } }))
    }
    if (hover != null) mark(hover, 'ghost', fmtMm(hover))
    const dist = marks.length === 2 ? Math.abs(marks[1] - marks[0]) : null
    const at = hover ?? marks.at(-1) ?? null
    clear(readHost, stats([
      { label: dist != null ? 'Distance A to B' : 'Position', value: dist != null ? `${(dist / 10).toFixed(2)} cm` : at != null ? `${(at / 10).toFixed(2)} cm` : '-', hint: (dist ?? at) != null ? `${(dist ?? at).toFixed(1)} mm` : 'Hover or tap the ruler', accent: true },
      { label: 'In inches', value: (dist ?? at) != null ? fmtIn(dist ?? at) : '-', hint: (dist ?? at) != null ? `${((dist ?? at) / MM_PER_IN).toFixed(3)} in` : '' },
    ]), h('div', { class: 'row', style: 'margin-top:10px' },
      button('Copy', { icon: 'copy', size: 'sm', disabled: (dist ?? at) == null, onClick: () => { const v = dist ?? at; copyText(`${(v / 10).toFixed(2)} cm (${(v / MM_PER_IN).toFixed(3)} in)`) } }),
      button('Clear marks', { icon: 'eraser', size: 'sm', variant: 'ghost', disabled: !marks.length, onClick: () => { marks = []; paintMarks() } }),
      h('span', { class: 'small muted' }, 'Tap or click the ruler to place point A, then B, to measure between them.')))
  }

  // ----- layout -----
  root.append(h('div', { class: 't-sr stack' },
    h('section', { class: 'panel stack' },
      h('div', { class: 'row between' }, h('h2', { style: 'margin:0' }, '1. Calibrate'), stateEl),
      h('p', { class: 'muted small' }, 'Hold a real card (or the object you pick) against your screen and drag the right edge until the shape is exactly as wide as the real thing. Do this once; it is remembered.'),
      cal$, wideNote,
      h('div', { class: 'calrow' }, field('Match it to', objSel), slider),
      customField, fineBtns, estimate),
    h('section', { class: 'panel stack' },
      h('h2', { style: 'margin:0' }, '2. Measure'),
      h('div', { class: 'row' }, orientSeg, unitSeg, field('', lengthSel)),
      rl, readHost,
      h('p', { class: 'small muted' }, 'Zooming the browser keeps the ruler true. If you move this window to a different monitor, calibrate again.'))))
  drawCal()
  drawRuler()
  let lastDpr = dpr()
  listen(window, 'resize', () => { if (dpr() !== lastDpr) { lastDpr = dpr(); drawCal(); drawRuler() } })
}
