// Reusable controls for the develop panels: sliders, collapsible sections, tone curve editor, color wheel,
// star rating, histogram and icon buttons with tooltips. Styles live in _css.js.
import { h, svg, icon, onCleanup } from '../../lib/ui.js'
import { curveTable } from './_model.js'

const decimals = (step) => (String(step).split('.')[1] || '').length

/** Toolbar-style icon button. tip shows as a tooltip (and the accessible name); put the shortcut in it like 'Undo (Ctrl+Z)'. */
export function iconBtn({ icon: ic, tip, onClick, pressed, text, cls = '', disabled, attrs = {} }) {
  const b = h('button', { type: 'button', class: ['pd-ib', text && 'with-text', cls], 'aria-label': tip.replace(/ \([^)]*\)$/, ''), 'data-tip': tip, onclick: onClick, disabled, ...attrs },
    ic && icon(ic), text && h('span', text))
  if (pressed !== undefined) b.setAttribute('aria-pressed', String(!!pressed))
  b.setPressed = (v) => b.setAttribute('aria-pressed', String(!!v))
  return b
}

/**
 * slider({label, min, max, step, value, def, format, onInput, track})
 * Drag, type a value, use arrow keys, or double-click the label to reset. el.set(v) updates without firing onInput.
 */
export function slider({ label, aria = label, min = -100, max = 100, step = 1, value = 0, def = 0, format, onInput, track, unit = '' }) {
  const dec = decimals(step)
  const fmt = format || ((v) => (dec ? v.toFixed(dec) : String(Math.round(v))))
  const range = h('input', { type: 'range', class: 'pd-range', min, max, step, value, 'aria-label': aria })
  const num = h('input', { type: 'number', class: 'pd-num', min, max, step, value: fmt(value), 'aria-label': `${aria} value`, inputmode: 'decimal' })
  const el = h('div', { class: 'pd-sl' },
    h('div', { class: 'pd-sl-head' }, h('span', { class: 'pd-sl-label', title: 'Double-click to reset', ondblclick: () => reset() }, label), h('span', { class: 'pd-sl-val' }, num, unit && h('i', unit))),
    range)
  if (track) range.style.setProperty('--track', track)
  const paint = () => {
    const v = range.valueAsNumber
    const pct = (x) => ((x - min) / (max - min)) * 100
    range.style.setProperty('--a', `${Math.min(pct(v), pct(def))}%`)
    range.style.setProperty('--b', `${Math.max(pct(v), pct(def))}%`)
    el.classList.toggle('changed', Math.abs(v - def) > 1e-9)
  }
  const apply = (v, fire) => {
    v = Math.min(max, Math.max(min, Number.isFinite(v) ? v : def))
    range.value = v
    num.value = fmt(range.valueAsNumber)
    paint()
    if (fire) onInput?.(range.valueAsNumber)
  }
  const reset = () => apply(def, true)
  range.addEventListener('input', () => apply(range.valueAsNumber, true))
  range.addEventListener('dblclick', reset)
  num.addEventListener('change', () => apply(num.valueAsNumber, true))
  num.addEventListener('keydown', (e) => { if (e.key === 'Enter') num.blur() })
  el.set = (v) => apply(v, false)
  el.value = () => range.valueAsNumber
  el.range = range
  paint()
  return el
}

/** Collapsible panel section. onReset (optional) shows a reset button when markChanged(true). */
export function section({ title, icon: ic, open = true, onReset, body, actions, key }) {
  const head = h('button', { type: 'button', class: 'pd-sec-head', 'aria-expanded': String(open), onclick: () => setOpen(el.dataset.open !== '1') },
    icon('chevron-right', 'pd-chev'), ic && icon(ic, 'pd-sec-ic'), h('span', { class: 'pd-sec-title' }, title))
  const reset = onReset && h('button', { type: 'button', class: 'pd-sec-reset', 'aria-label': `Reset ${title}`, 'data-tip': `Reset ${title}`, hidden: true, onclick: (e) => { e.stopPropagation(); onReset() } }, icon('rotate-ccw'))
  const content = h('div', { class: 'pd-sec-body' }, body)
  const el = h('section', { class: 'pd-sec', dataset: { open: open ? '1' : '0', key: key || title } }, h('div', { class: 'pd-sec-bar' }, head, actions, reset), content)
  function setOpen(v) {
    el.dataset.open = v ? '1' : '0'
    head.setAttribute('aria-expanded', String(v))
    el.dispatchEvent(new CustomEvent('pd-toggle', { bubbles: true, detail: v }))
  }
  el.setOpen = setOpen
  el.markChanged = (v) => { if (reset) reset.hidden = !v; el.classList.toggle('changed', !!v) }
  return el
}

/** Five stars. onChange(n) with 0 when the current star is clicked again. */
export function stars(value, onChange, size = 'md') {
  const el = h('div', { class: ['pd-stars', size], role: 'radiogroup', 'aria-label': 'Rating' })
  const btns = [1, 2, 3, 4, 5].map((n) => h('button', {
    type: 'button', role: 'radio', 'aria-label': `${n} star${n > 1 ? 's' : ''}`, 'data-tip': `${n} star${n > 1 ? 's' : ''} (${n})`,
    onclick: (e) => { e.stopPropagation(); onChange(el.value === n ? 0 : n) },
  }, icon('star')))
  el.append(...btns)
  el.set = (v) => { el.value = v; btns.forEach((b, i) => { b.setAttribute('aria-checked', String(i + 1 === v)); b.classList.toggle('on', i < v) }) }
  el.set(value)
  return el
}

// ---------- Histogram ----------
export function histogramView() {
  const canvas = h('canvas', { class: 'pd-hist', width: 256, height: 96, 'aria-label': 'Histogram', role: 'img' })
  const ctx = canvas.getContext('2d')
  const draw = (bins) => {
    const w = canvas.width, hh = canvas.height
    ctx.clearRect(0, 0, w, hh)
    if (!bins) return
    let peak = 1
    for (let i = 2; i < 254; i++) peak = Math.max(peak, bins.r[i], bins.g[i], bins.b[i])
    ctx.globalCompositeOperation = 'lighter'
    const paint = (arr, color) => {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(0, hh)
      for (let i = 0; i < 256; i++) ctx.lineTo(i, hh - Math.min(1, arr[i] / peak) * (hh - 4))
      ctx.lineTo(255, hh)
      ctx.closePath()
      ctx.fill()
    }
    paint(bins.r, 'rgba(255,70,60,.62)'); paint(bins.g, 'rgba(60,220,90,.62)'); paint(bins.b, 'rgba(70,120,255,.7)')
    ctx.globalCompositeOperation = 'source-over'
  }
  return { el: canvas, draw }
}

/** Compute 256-bin R, G, B and luma histograms from a canvas, drawn small for speed. */
const probe = document.createElement('canvas')
export function histogramOf(source) {
  const w = 200, hgt = Math.max(1, Math.round((w * source.height) / source.width))
  probe.width = w; probe.height = hgt
  const ctx = probe.getContext('2d', { willReadFrequently: true })
  ctx.clearRect(0, 0, w, hgt)
  ctx.drawImage(source, 0, 0, w, hgt)
  const d = ctx.getImageData(0, 0, w, hgt).data
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256)
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] <= 8) continue
    r[d[i]]++; g[d[i + 1]]++; b[d[i + 2]]++
    l[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++
  }
  return { r, g, b, l }
}

// ---------- Tone curve ----------
const CHANNEL_COLORS = { rgb: 'var(--text)', r: '#ef4444', g: '#22c55e', b: '#3b82f6' }

/** Interactive tone curve. Click to add a point, drag to move, double-click or Delete to remove, arrows to nudge. */
export function curveEditor({ get, onChange }) {
  const N = 256, PAD = 6, SIZE = 256 + PAD * 2
  let channel = 'rgb', bins = null, drag = null
  const root = svg('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, class: 'pd-curve', role: 'application', 'aria-label': 'Tone curve editor', tabindex: -1 })
  const bg = svg('g', { class: 'pd-curve-bg' })
  const histPath = svg('path', { class: 'pd-curve-hist' })
  const line = svg('path', { class: 'pd-curve-line', fill: 'none' })
  const pts = svg('g')
  root.append(bg, histPath, line, pts)
  for (let i = 1; i < 4; i++) {
    bg.append(svg('line', { x1: PAD + (i * N) / 4, y1: PAD, x2: PAD + (i * N) / 4, y2: PAD + N }), svg('line', { x1: PAD, y1: PAD + (i * N) / 4, x2: PAD + N, y2: PAD + (i * N) / 4 }))
  }
  bg.append(svg('line', { x1: PAD, y1: PAD + N, x2: PAD + N, y2: PAD, class: 'diag' }))

  const points = () => get()[channel]
  const toXY = (x, y) => [PAD + x, PAD + N - y]
  const fromEvent = (e) => {
    const r = root.getBoundingClientRect()
    const k = SIZE / r.width
    return [Math.round(Math.min(255, Math.max(0, (e.clientX - r.left) * k - PAD))), Math.round(Math.min(255, Math.max(0, N - ((e.clientY - r.top) * k - PAD))))]
  }
  function render() {
    const p = points()
    const t = curveTable(p)
    const color = CHANNEL_COLORS[channel]
    line.setAttribute('stroke', color)
    line.setAttribute('d', Array.from({ length: N }, (_, i) => `${i ? 'L' : 'M'}${PAD + i},${PAD + N - t[i]}`).join(''))
    pts.replaceChildren(...p.map(([x, y], i) => {
      const [cx, cy] = toXY(x, y)
      const c = svg('circle', { cx, cy, r: 5.5, class: 'pd-curve-pt', tabindex: 0, role: 'slider', 'aria-label': `Curve point ${i + 1}`, 'aria-valuetext': `input ${x}, output ${y}`, stroke: color })
      c.dataset.i = i
      return c
    }))
    if (bins) {
      const arr = channel === 'r' ? bins.r : channel === 'g' ? bins.g : channel === 'b' ? bins.b : bins.l
      let peak = 1
      for (let i = 2; i < 254; i++) peak = Math.max(peak, arr[i])
      histPath.setAttribute('d', `M${PAD},${PAD + N}` + Array.from({ length: N }, (_, i) => `L${PAD + i},${PAD + N - Math.min(1, arr[i] / peak) * N * 0.8}`).join('') + `L${PAD + N},${PAD + N}Z`)
    } else histPath.setAttribute('d', '')
  }
  const commit = (list, live = true) => { onChange(channel, list, live) }
  root.addEventListener('pointerdown', (e) => {
    if (e.button === 2) return
    const p = points().map((q) => [...q])
    let i = e.target.dataset?.i !== undefined ? Number(e.target.dataset.i) : -1
    if (i < 0) {
      const [x, y] = fromEvent(e)
      if (p.some((q) => Math.abs(q[0] - x) < 4)) i = p.findIndex((q) => Math.abs(q[0] - x) < 4)
      else { p.push([x, y]); p.sort((a, b) => a[0] - b[0]); i = p.findIndex((q) => q[0] === x && q[1] === y); commit(p) }
    }
    drag = { i, pts: p }
    root.setPointerCapture(e.pointerId)
    e.preventDefault()
  })
  root.addEventListener('pointermove', (e) => {
    if (!drag) return
    const p = drag.pts, i = drag.i
    let [x, y] = fromEvent(e)
    if (i === 0) x = 0
    else if (i === p.length - 1) x = 255
    else x = Math.min(p[i + 1][0] - 1, Math.max(p[i - 1][0] + 1, x))
    p[i] = [x, y]
    commit(p.map((q) => [...q]))
  })
  const end = () => { drag = null }
  root.addEventListener('pointerup', end); root.addEventListener('pointercancel', end)
  const remove = (i) => {
    const p = points().map((q) => [...q])
    if (i <= 0 || i >= p.length - 1) return
    p.splice(i, 1)
    commit(p, false)
  }
  let lastHit = -1
  root.addEventListener('pointerdown', (e) => { lastHit = e.target.dataset?.i !== undefined ? Number(e.target.dataset.i) : -1 }, true)
  // pointer capture retargets the click events to the svg, so remember which point was pressed
  root.addEventListener('dblclick', () => { if (lastHit >= 0) remove(lastHit) })
  root.addEventListener('contextmenu', (e) => { if (e.target.dataset?.i !== undefined) { e.preventDefault(); remove(Number(e.target.dataset.i)) } })
  root.addEventListener('keydown', (e) => {
    const i = e.target.dataset?.i !== undefined ? Number(e.target.dataset.i) : -1
    if (i < 0) return
    const p = points().map((q) => [...q])
    const step = e.shiftKey ? 10 : 1
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(i); return }
    const d = { ArrowUp: [0, step], ArrowDown: [0, -step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] }[e.key]
    if (!d) return
    e.preventDefault()
    if (i === 0 || i === p.length - 1) d[0] = 0
    const x = Math.min(i < p.length - 1 ? p[i + 1][0] - 1 : 255, Math.max(i > 0 ? p[i - 1][0] + 1 : 0, p[i][0] + d[0]))
    p[i] = [x, Math.min(255, Math.max(0, p[i][1] + d[1]))]
    commit(p)
    root.querySelector(`[data-i="${i}"]`)?.focus()
  })
  return {
    el: root,
    refresh: render,
    setChannel(c) { channel = c; render() },
    get channel() { return channel },
    setHistogram(b) { bins = b; render() },
  }
}

// ---------- Color wheel ----------
/** Hue and saturation picker. set({h: 0..360, s: 0..100}); onInput({h, s}). */
export function colorWheel({ onInput, label = 'Color wheel' }) {
  const puck = h('div', { class: 'pd-puck' })
  const el = h('div', { class: 'pd-wheel', tabindex: 0, role: 'application', 'aria-label': `${label}. Arrow keys change hue and saturation.` }, puck)
  let hs = { h: 0, s: 0 }
  const place = () => {
    const r = 50 * (hs.s / 100), a = (hs.h * Math.PI) / 180
    puck.style.left = `${50 + r * Math.sin(a)}%`
    puck.style.top = `${50 - r * Math.cos(a)}%`
    puck.style.setProperty('--ph', hs.h)
    puck.style.setProperty('--ps', `${Math.max(25, hs.s)}%`)
    puck.classList.toggle('active', hs.s > 0)
  }
  const fromPointer = (e) => {
    const r = el.getBoundingClientRect()
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2)
    const rad = Math.min(1, Math.hypot(dx, dy) / (r.width / 2))
    let ang = (Math.atan2(dx, -dy) * 180) / Math.PI
    if (ang < 0) ang += 360
    hs = { h: Math.round(ang) % 360, s: Math.round(rad * 100) }
    place()
    onInput({ ...hs })
  }
  let down = false
  el.addEventListener('pointerdown', (e) => { down = true; el.setPointerCapture(e.pointerId); fromPointer(e); e.preventDefault() })
  el.addEventListener('pointermove', (e) => { if (down) fromPointer(e) })
  el.addEventListener('pointerup', () => { down = false })
  el.addEventListener('pointercancel', () => { down = false })
  el.addEventListener('dblclick', () => { hs = { h: hs.h, s: 0 }; place(); onInput({ ...hs }) })
  el.addEventListener('keydown', (e) => {
    const k = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] }[e.key]
    if (!k) return
    e.preventDefault()
    hs = { h: (hs.h + k[0] + 360) % 360, s: Math.min(100, Math.max(0, hs.s + k[1])) }
    place(); onInput({ ...hs })
  })
  el.set = (v) => { hs = { h: v.h, s: v.s }; place() }
  place()
  return el
}

/** Run fn when the element's size changes (cleaned up with the page). */
export function observeSize(el, fn) {
  const ro = new ResizeObserver(() => fn())
  ro.observe(el)
  onCleanup(() => ro.disconnect())
  return ro
}
