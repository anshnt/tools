// A small interactive map drawn as SVG (pan, zoom, pinch, click a feature for its attributes). It needs no network: the background
// is plain. An optional OpenStreetMap tile layer can be switched on, which then loads map images from tile.openstreetmap.org.
import { h, svg, button, onCleanup } from '../../lib/ui.js'
import { flatGeoms } from './_util.js'

const R = 6378137
const MAX = 20037508.342789244
const merc = (lon, lat) => [R * (lon * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 360))]
const MPP0 = (2 * MAX) / 256 // metres per pixel at zoom 0

const CSS = `
.geo-map { position: relative; border: 1px solid var(--border); border-radius: 14px; overflow: hidden; background: var(--surface-2); touch-action: none; user-select: none; }
.geo-map:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.geo-map svg.gm { display: block; width: 100%; height: 100%; cursor: grab; }
.geo-map.drag svg.gm { cursor: grabbing; }
.geo-map .gm-pt { fill: none; stroke: var(--accent); stroke-width: 9; stroke-linecap: round; }
.geo-map .gm-ln { fill: none; stroke: var(--accent); stroke-width: 3; stroke-linejoin: round; stroke-linecap: round; }
.geo-map .gm-pg { fill: var(--accent); fill-opacity: .22; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; }
.geo-map .sel { stroke: #f76b15 !important; stroke-opacity: 1 !important; }
.geo-map .gm-pg.sel { fill: #f76b15 !important; fill-opacity: .35 !important; }
.geo-map .gm-pt.sel, .geo-map .gm-ln.sel { stroke-width: 12; }
.geo-map .gm-ln.sel { stroke-width: 5; }
.geo-map .gm-ctl { position: absolute; top: 10px; right: 10px; display: flex; flex-direction: column; gap: 6px; }
.geo-map .gm-ctl .btn { background: var(--surface); box-shadow: 0 1px 4px rgba(0,0,0,.18); }
.geo-map .gm-foot { position: absolute; left: 8px; bottom: 6px; right: 8px; display: flex; justify-content: space-between; align-items: flex-end; gap: 8px; pointer-events: none; font-size: 11px; color: var(--text-2); }
.geo-map .gm-foot > * { background: color-mix(in srgb, var(--surface) 82%, transparent); padding: 2px 6px; border-radius: 6px; }
.geo-map .gm-scale { border-bottom: 2px solid var(--text-2); border-left: 2px solid var(--text-2); border-right: 2px solid var(--text-2); height: 6px; padding: 0 !important; background: none !important; border-radius: 0 !important; }
.geo-map .gm-pop { position: absolute; left: 10px; top: 10px; max-width: min(320px, calc(100% - 70px)); max-height: calc(100% - 50px); overflow: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; font-size: 13px; box-shadow: 0 6px 20px rgba(0,0,0,.2); }
.geo-map .gm-pop dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
.geo-map .gm-pop dt { color: var(--muted); }
.geo-map .gm-pop dd { margin: 0; overflow-wrap: anywhere; }
.geo-map .gm-pop .x { position: absolute; top: 4px; right: 4px; }
.geo-map .gm-empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); font-size: 14px; pointer-events: none; }
@media (prefers-reduced-motion: reduce) { .geo-map * { transition: none !important; } }
`
let styled = false

const prop = (p, k) => (p && p[k] !== undefined && p[k] !== null ? p[k] : undefined)

/**
 * createMap({ height, basemap, onSelect(index) }) -> { el, setFeatures(features, {fit}), select(i, {zoom}), fit(), setBasemap(bool), resize() }
 */
export function createMap({ height = 360, basemap = false, onSelect } = {}) {
  if (!styled) { document.head.append(h('style', { 'data-geo-map': '' }, CSS)); styled = true }
  let feats = [], items = [], sel = -1
  let w = 600, hh = height
  const view = { cx: 0, cy: 0, mpp: 80000 }
  let showTiles = basemap
  const tileEls = new Map()
  const gTiles = svg('g'), gFeats = svg('g'), gAll = svg('g', gTiles, gFeats)
  const root = svg('svg', { class: 'gm', role: 'img', 'aria-label': 'Map of the features' }, gAll)
  const scaleEl = h('div', { class: 'gm-scale' })
  const scaleLbl = h('div')
  const attr = h('span', { hidden: true }, '© OpenStreetMap contributors')
  const empty = h('div', { class: 'gm-empty' }, 'Nothing to show yet')
  const pop = h('div', { class: 'gm-pop', hidden: true })
  const ctl = h('div', { class: 'gm-ctl' },
    button('', { icon: 'plus', variant: 'secondary', size: 'sm', ariaLabel: 'Zoom in', onClick: () => zoomAt(w / 2, hh / 2, 0.5) }),
    button('', { icon: 'minus', variant: 'secondary', size: 'sm', ariaLabel: 'Zoom out', onClick: () => zoomAt(w / 2, hh / 2, 2) }),
    button('', { icon: 'maximize', variant: 'secondary', size: 'sm', ariaLabel: 'Fit to data', onClick: () => api.fit() }))
  const el = h('div', { class: 'geo-map', style: { height: `${height}px` }, tabindex: 0, role: 'group', 'aria-label': 'Map. Drag to pan, scroll or use plus and minus to zoom.' },
    root, empty, ctl, h('div', { class: 'gm-foot' }, h('div', scaleLbl, scaleEl), attr), pop)

  const sx = (x) => (x - view.cx) / view.mpp + w / 2
  const sy = (y) => hh / 2 - (y - view.cy) / view.mpp

  function prepare(f) {
    const parts = { pt: [], ln: [], pg: [] }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    const mp = (c) => { const m = merc(c[0], c[1]); if (m[0] < x0) x0 = m[0]; if (m[0] > x1) x1 = m[0]; if (m[1] < y0) y0 = m[1]; if (m[1] > y1) y1 = m[1]; return m }
    for (const g of flatGeoms(f.geometry)) {
      if (g.type === 'Point') parts.pt.push([mp(g.coordinates)])
      else if (g.type === 'MultiPoint') for (const c of g.coordinates) parts.pt.push([mp(c)])
      else if (g.type === 'LineString') parts.ln.push(g.coordinates.map(mp))
      else if (g.type === 'MultiLineString') for (const l of g.coordinates) parts.ln.push(l.map(mp))
      else if (g.type === 'Polygon') for (const r of g.coordinates) parts.pg.push(r.map(mp))
      else if (g.type === 'MultiPolygon') for (const p of g.coordinates) for (const r of p) parts.pg.push(r.map(mp))
    }
    return { parts, bbox: [x0, y0, x1, y1] }
  }

  const MAX_ELEMENTS = 4000
  function build() {
    gFeats.replaceChildren()
    items = feats.map((f, i) => ({ ...prepare(f), i, els: {} }))
    const individual = feats.length <= MAX_ELEMENTS
    const p = (i) => feats[i].properties || {}
    const mk = (kind, extra) => svg('path', { class: `gm-${kind}`, ...extra })
    if (individual) {
      for (const it of items) {
        if (!isFinite(it.bbox[0])) continue
        const props = p(it.i)
        for (const kind of ['pg', 'ln', 'pt']) {
          if (!it.parts[kind].length) continue
          const style = {}
          const stroke = prop(props, 'stroke') ?? (kind === 'pt' ? prop(props, 'marker-color') : undefined)
          if (stroke) style.stroke = stroke
          if (kind === 'pg') { const fill = prop(props, 'fill'); if (fill) style.fill = fill; const fo = prop(props, 'fill-opacity'); if (fo !== undefined) style['fill-opacity'] = fo }
          const sw = prop(props, 'stroke-width'); if (sw && kind !== 'pt') style['stroke-width'] = Math.min(8, Math.max(1, Number(sw)))
          const e = mk(kind, { dataset: { i: it.i }, style })
          it.els[kind] = e
          gFeats.append(e)
        }
      }
    } else {
      for (const kind of ['pg', 'ln', 'pt']) { const e = mk(kind, {}); items.merged ||= {}; items.merged[kind] = e; gFeats.append(e) }
    }
    items.individual = individual
    applySel()
  }

  function pathOf(parts, close) {
    let d = ''
    for (const part of parts) {
      let px = 0, py = 0, started = false, lastSkipped = null
      for (const [x, y] of part) {
        const a = sx(x), b = sy(y)
        if (started && Math.abs(a - px) < 0.6 && Math.abs(b - py) < 0.6) { lastSkipped = [a, b]; continue }
        d += `${started ? 'L' : 'M'}${a.toFixed(1)} ${b.toFixed(1)}`
        started = true; px = a; py = b; lastSkipped = null
      }
      if (lastSkipped) d += `L${lastSkipped[0].toFixed(1)} ${lastSkipped[1].toFixed(1)}`
      if (close && started) d += 'Z'
    }
    return d
  }
  const ptPath = (parts) => parts.map(([[x, y]]) => `M${sx(x).toFixed(1)} ${sy(y).toFixed(1)}h0`).join('')

  let raf = 0
  function draw() {
    cancelAnimationFrame(raf)
    raf = 0
    gAll.removeAttribute('transform')
    const x0 = view.cx - (w / 2) * view.mpp - 50 * view.mpp, x1 = view.cx + (w / 2) * view.mpp + 50 * view.mpp
    const y0 = view.cy - (hh / 2) * view.mpp - 50 * view.mpp, y1 = view.cy + (hh / 2) * view.mpp + 50 * view.mpp
    const inView = (b) => isFinite(b[0]) && b[2] >= x0 && b[0] <= x1 && b[3] >= y0 && b[1] <= y1
    if (items.individual) {
      for (const it of items) {
        const vis = inView(it.bbox)
        for (const [kind, e] of Object.entries(it.els)) {
          if (!vis) { if (e._d) { e.setAttribute('d', ''); e._d = false } continue }
          e.setAttribute('d', kind === 'pt' ? ptPath(it.parts.pt) : pathOf(it.parts[kind], kind === 'pg'))
          e._d = true
        }
      }
    } else if (items.merged) {
      const vis = items.filter((it) => inView(it.bbox))
      items.merged.pg.setAttribute('d', vis.map((it) => pathOf(it.parts.pg, true)).join(''))
      items.merged.ln.setAttribute('d', vis.map((it) => pathOf(it.parts.ln, false)).join(''))
      items.merged.pt.setAttribute('d', vis.map((it) => ptPath(it.parts.pt)).join(''))
    }
    drawTiles()
    drawScale()
    empty.hidden = feats.length > 0
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(draw) }

  function drawScale() {
    const target = 90 * view.mpp
    const pow = 10 ** Math.floor(Math.log10(target))
    const m = [1, 2, 5, 10].map((k) => k * pow).find((v) => v >= target / 2) || pow
    const len = m / view.mpp
    scaleEl.style.width = `${len}px`
    scaleLbl.textContent = m >= 1000 ? `${m / 1000} km` : `${m} m`
  }

  function drawTiles() {
    attr.hidden = !showTiles
    if (!showTiles) { if (tileEls.size) { gTiles.replaceChildren(); tileEls.clear() } return }
    const z = Math.max(0, Math.min(19, Math.round(Math.log2(MPP0 / view.mpp))))
    const n = 2 ** z, size = (2 * MAX) / n
    const tx0 = Math.floor((view.cx - (w / 2) * view.mpp + MAX) / size), tx1 = Math.floor((view.cx + (w / 2) * view.mpp + MAX) / size)
    const ty0 = Math.floor((MAX - (view.cy + (hh / 2) * view.mpp)) / size), ty1 = Math.floor((MAX - (view.cy - (hh / 2) * view.mpp)) / size)
    const keep = new Set()
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 60) return
    for (let tx = tx0; tx <= tx1; tx++) for (let ty = Math.max(0, ty0); ty <= Math.min(n - 1, ty1); ty++) {
      const wx = ((tx % n) + n) % n
      const key = `${z}/${wx}/${ty}/${tx}`
      keep.add(key)
      let im = tileEls.get(key)
      if (!im) {
        im = svg('image', { href: `https://tile.openstreetmap.org/${z}/${wx}/${ty}.png` })
        tileEls.set(key, im); gTiles.append(im)
      }
      const px = sx(-MAX + tx * size), py = sy(MAX - ty * size)
      im.setAttribute('x', px.toFixed(1)); im.setAttribute('y', py.toFixed(1))
      const s = (size / view.mpp) + 0.5
      im.setAttribute('width', s.toFixed(1)); im.setAttribute('height', s.toFixed(1))
    }
    for (const [k, im] of tileEls) if (!keep.has(k)) { im.remove(); tileEls.delete(k) }
  }

  function zoomAt(px, py, factor) {
    const wx = view.cx + (px - w / 2) * view.mpp, wy = view.cy - (py - hh / 2) * view.mpp
    view.mpp = Math.max(0.02, Math.min(160000, view.mpp * factor))
    view.cx = wx - (px - w / 2) * view.mpp
    view.cy = wy + (py - hh / 2) * view.mpp
    draw()
  }

  // ----- interaction: drag to pan, wheel and pinch to zoom, click to pick
  const pointers = new Map()
  let dragged = false, startDist = 0, startMpp = 0, last = null
  root.addEventListener('pointerdown', (e) => {
    root.setPointerCapture(e.pointerId)
    pointers.set(e.pointerId, [e.clientX, e.clientY])
    dragged = false
    last = [e.clientX, e.clientY]
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; startDist = Math.hypot(a[0] - b[0], a[1] - b[1]); startMpp = view.mpp }
  })
  root.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return
    pointers.set(e.pointerId, [e.clientX, e.clientY])
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      const d = Math.hypot(a[0] - b[0], a[1] - b[1])
      if (startDist) { const r = root.getBoundingClientRect(); zoomAt((a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top, (startMpp * startDist / d) / view.mpp) }
      dragged = true
      return
    }
    const dx = e.clientX - last[0], dy = e.clientY - last[1]
    if (!dragged && Math.hypot(dx, dy) < 3) return
    dragged = true
    el.classList.add('drag')
    last = [e.clientX, e.clientY]
    view.cx -= dx * view.mpp; view.cy += dy * view.mpp
    schedule()
  })
  const up = (e) => {
    pointers.delete(e.pointerId)
    el.classList.remove('drag')
    if (!dragged && pointers.size === 0 && e.type === 'pointerup') {
      const t = e.target.closest?.('[data-i]')
      if (t) api.select(Number(t.dataset.i), {}); else if (sel >= 0) api.select(-1)
    }
    if (pointers.size < 2) startDist = 0
  }
  root.addEventListener('pointerup', up)
  root.addEventListener('pointercancel', up)
  root.addEventListener('wheel', (e) => {
    e.preventDefault()
    const r = root.getBoundingClientRect()
    zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY > 0 ? 1.3 : 1 / 1.3)
  }, { passive: false })
  el.addEventListener('keydown', (e) => {
    const step = 60 * view.mpp
    const k = e.key
    if (k === 'ArrowLeft') view.cx -= step; else if (k === 'ArrowRight') view.cx += step; else if (k === 'ArrowUp') view.cy += step; else if (k === 'ArrowDown') view.cy -= step
    else if (k === '+' || k === '=') return zoomAt(w / 2, hh / 2, 0.6)
    else if (k === '-' || k === '_') return zoomAt(w / 2, hh / 2, 1 / 0.6)
    else return
    e.preventDefault(); draw()
  })

  function applySel() {
    for (const it of items) for (const e of Object.values(it.els)) e.classList.toggle('sel', it.i === sel)
  }
  function showPop() {
    if (sel < 0 || !feats[sel]) { pop.hidden = true; return }
    const p = feats[sel].properties || {}
    const rows = Object.entries(p).filter(([k]) => k !== 'coordinateProperties' && !['stroke', 'stroke-opacity', 'stroke-width', 'fill', 'fill-opacity', 'marker-color'].includes(k)).slice(0, 14)
    const close = button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: 'Close', onClick: () => api.select(-1) })
    close.classList.add('x')
    pop.replaceChildren(close,
      h('strong', `${feats[sel].geometry?.type || 'No geometry'} (row ${sel + 1})`),
      rows.length ? h('dl', rows.map(([k, v]) => [h('dt', k), h('dd', v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))])) : h('div', { class: 'muted' }, 'No attributes'))
    pop.hidden = false
  }

  function resize() {
    const r = el.getBoundingClientRect()
    if (r.width < 10) return
    w = r.width; hh = r.height
    root.setAttribute('viewBox', `0 0 ${w} ${hh}`)
    draw()
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null
  ro?.observe(el)
  onCleanup(() => { ro?.disconnect(); cancelAnimationFrame(raf) })

  const api = {
    el,
    setFeatures(list, { fit = true } = {}) {
      feats = list
      sel = -1
      build()
      showPop()
      if (fit) api.fit(); else draw()
    },
    fit() {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const it of items) { const b = it.bbox; if (isFinite(b[0])) { x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]) } }
      if (!isFinite(x0)) { draw(); return }
      view.cx = (x0 + x1) / 2; view.cy = (y0 + y1) / 2
      const dx = x1 - x0, dy = y1 - y0
      view.mpp = dx < 1 && dy < 1 ? 2 : Math.max(dx / Math.max(80, w - 90), dy / Math.max(80, hh - 90)) || 2
      draw()
    },
    select(i, { zoom = false } = {}) {
      sel = i
      applySel(); showPop()
      if (zoom && i >= 0 && items[i] && isFinite(items[i].bbox[0])) {
        const b = items[i].bbox
        view.cx = (b[0] + b[2]) / 2; view.cy = (b[1] + b[3]) / 2
        const dx = b[2] - b[0], dy = b[3] - b[1]
        if (dx > 1 || dy > 1) view.mpp = Math.max(dx / Math.max(80, w - 140), dy / Math.max(80, hh - 140))
        else view.mpp = Math.min(view.mpp, 2)
        draw()
      }
      if (i >= 0 || zoom === false) onSelect?.(i)
    },
    setBasemap(on) { showTiles = !!on; draw() },
    get basemap() { return showTiles },
    resize,
  }
  queueMicrotask(resize)
  return api
}
