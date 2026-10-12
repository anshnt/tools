// Draw Studio drawing tools: Rectangle (F6), Ellipse (F7), Polygon (Y), Star (Shift+Y), Freehand (F5) and Bezier (Shift+P).
// Every tool previews in the screen-space overlay without touching the store and commits ONE store.tx on release (Esc cancels for free).
// Rectangle, ellipse, polygon and star make paths that carry a parametric `shape` and `sm` (local frame to page), so the corner radius, sides
// and points stay editable after rotating or skewing. Freehand and Bezier make plain curves.
import { collectTargets, pickables, snapPoint } from './_ds-hit.js'
import { dToSubs, shapeD, simplifyFreehand, subsToD } from './_ds-path.js'
import { addLayer, replaceLeaves } from './_ds-ops.js'
import { insertAt } from './_ds-doc.js'
import { P, reverseSub } from '../studio-vector/_geom.js'
import { selectionBox } from './_ds-sel.js'
import { fmt } from './_ds-units.js'
import { translate } from './_model.js'

const DRAG = 4 // px before a press becomes a drag
export const SHAPE_DEFAULTS = { rx: 0, n: 6, sn: 5, sharp: 53, ellipse: 'ellipse', a1: 0, a2: 270, smooth: 3 }
/** The remembered shape settings (corner radius in points, polygon sides, star points and sharpness, ellipse mode and angles, freehand smoothing in px). */
export const shapePrefs = (store) => ({ ...SHAPE_DEFAULTS, ...store.prefs.shape })
export const NEW_STYLE = { fill: '#b9c7ff', stroke: '#1f2a44', strokeWidth: 0.75 }
const OPEN_STYLE = { fill: null, stroke: '#1f2a44', strokeWidth: 0.75 }

/** A new path node with the default look. extra overrides any field. */
export function newPath(store, d, extra = {}, open = false) {
  const st = open ? OPEN_STYLE : NEW_STYLE
  return { id: store.newId(), t: 'path', d, fill: st.fill, fillOpacity: 1, rule: 'nonzero', stroke: st.stroke, strokeWidth: st.strokeWidth, strokeOpacity: 1, cap: 0, join: 0, miter: 4, dash: null, dashOffset: 0, ...extra }
}
/** Put nodes on top of the active layer (a layer is added when none is usable) and select them: ONE undo step. Returns false when the page is still being read. */
export function placeNodes(store, nodes, label, sel = nodes.map((n) => n.id)) {
  const page = store.page()
  if (!page || page.pending) { store.setStatus('This page is still being read. Try again in a moment.'); return false }
  const lid = store.activeLayerOf(page)?.id
  return store.tx(label, (r) => {
    let root = r, id = lid
    if (id == null) { const out = {}; root = addLayer(root, page.id, store.newId, { out }); id = out.id }
    return insertAt(root, id, null, nodes)
  }, { sel })
}

/** Commands of a path as an SVG path string in screen pixels. */
export function screenD(d, toScreen) {
  let s = ''
  for (const c of d) {
    if (c[0] === 'Z') { s += 'Z'; continue }
    s += c[0]
    for (let i = 1; i < c.length; i += 2) { const p = toScreen(c[i], c[i + 1]); s += `${i > 1 ? ' ' : ''}${p.x.toFixed(1)} ${p.y.toFixed(1)}` }
  }
  return s
}
const sgn = (v) => (v < 0 ? -1 : 1)

/** env: {store, view, boxOf, host, tools: TOOL_INFO list} -> {rect, ellipse, polygon, star, free, pen} */
export function createDrawTools({ store, view, boxOf, host, info }) {
  const I = (id) => info.find((t) => t.id === id)
  const viewportRect = () => { const s = view.size(), a = view.toPage(0, 0), b = view.toPage(s.w, s.h); return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y } }
  const snapOn = () => store.prefs.snap !== false
  let T = null
  const snap = (p, ev) => {
    if (!T) T = collectTargets(store, boxOf, new Set(), viewportRect())
    const r = snapPoint(p, T, 6 / store.view.z, ev.mods.alt || !snapOn())
    return { x: r.x, y: r.y, lines: r.lines }
  }
  const status = (t) => store.setStatus(t)
  const units = () => store.root.units
  const selFrame = (g, { toScreen, el }) => {
    const b = store.sel.ids.length && selectionBox(store, boxOf)
    if (!b) return
    const a = toScreen(b.x, b.y), c = toScreen(b.x + b.w, b.y + b.h)
    g.append(el('rect', { class: 'ds-selbox', x: a.x - 3, y: a.y - 3, width: Math.max(0, c.x - a.x) + 6, height: Math.max(0, c.y - a.y) + 6, fill: 'none' }))
  }
  const snapLines = (g, { toScreen, el }, lines) => {
    if (!lines) return
    const s = view.size()
    for (const x of lines.x) { const p = toScreen(x, 0); g.append(el('line', { class: 'ds-snap', x1: p.x, y1: 0, x2: p.x, y2: s.h })) }
    for (const y of lines.y) { const p = toScreen(0, y); g.append(el('line', { class: 'ds-snap', x1: 0, y1: p.y, x2: s.w, y2: p.y })) }
  }

  // ---------- shapes by dragging ----------
  /**
   * kind: 'rect' | 'ellipse' (drag a box: Ctrl makes it square, Shift draws from the centre) or 'poly' | 'star' (drag from the centre out).
   * build(geo) -> {shape, sm, d}: the parametric description for the dragged geometry.
   */
  function dragShape(kind, label) {
    let g = null // {a, sa, p, moved, geo, lines}
    const geoOf = (a, p, mods) => {
      if (kind === 'poly' || kind === 'star') return { cx: a.x, cy: a.y, r: Math.hypot(p.x - a.x, p.y - a.y) }
      let dx = p.x - a.x, dy = p.y - a.y
      if (mods.ctrl) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = sgn(dx) * m; dy = sgn(dy) * m }
      if (mods.shift) return { x: a.x - Math.abs(dx), y: a.y - Math.abs(dy), w: 2 * Math.abs(dx), h: 2 * Math.abs(dy) }
      return { x: Math.min(a.x, a.x + dx), y: Math.min(a.y, a.y + dy), w: Math.abs(dx), h: Math.abs(dy) }
    }
    const build = (geo) => {
      const sp = shapePrefs(store)
      let shape, sm
      if (kind === 'rect') { shape = { k: 'rect', w: geo.w, h: geo.h, rx: sp.rx, ry: sp.rx }; sm = translate(geo.x, geo.y) }
      else if (kind === 'ellipse') {
        shape = { k: 'ellipse', rx: geo.w / 2, ry: geo.h / 2 }
        if (sp.ellipse !== 'ellipse') { shape.a1 = sp.a1; shape.a2 = sp.a2; if (sp.ellipse === 'pie') shape.pie = true }
        sm = translate(geo.x + geo.w / 2, geo.y + geo.h / 2)
      } else if (kind === 'poly') { shape = { k: 'poly', n: sp.n, r: geo.r, rot: -Math.PI / 2 }; sm = translate(geo.cx, geo.cy) }
      else { shape = { k: 'star', n: sp.sn, r1: geo.r, r2: Math.max(0.01, geo.r * (1 - sp.sharp / 100)), rot: -Math.PI / 2 }; sm = translate(geo.cx, geo.cy) }
      return { shape, sm, d: shapeD(shape, sm) }
    }
    const big = (geo) => (kind === 'poly' || kind === 'star' ? geo.r >= 0.5 : geo.w >= 0.5 && geo.h >= 0.5)
    const arc = () => kind === 'ellipse' && shapePrefs(store).ellipse === 'arc'
    return {
      ...I({ rect: 'rect', ellipse: 'ellipse', poly: 'polygon', star: 'star' }[kind]),
      get busy() { return !!g?.moved },
      activate() { T = null },
      pointerdown(ev) {
        if (ev.button !== 0) return
        T = null
        const a = snap(ev.p, ev)
        g = { a: { x: a.x, y: a.y }, sa: ev.s, p: ev.p, moved: false, geo: null, lines: null }
      },
      pointermove(ev) {
        if (!g) return
        if (!g.moved && Math.hypot(ev.s.x - g.sa.x, ev.s.y - g.sa.y) > DRAG) g.moved = true
        if (!g.moved) return
        const s = snap(ev.p, ev)
        g.geo = geoOf(g.a, { x: s.x, y: s.y }, ev.mods)
        g.lines = s.lines
        const u = units()
        status(kind === 'poly' || kind === 'star' ? `${label}  R ${fmt(g.geo.r, u)} ${u}` : `${label}  W ${fmt(g.geo.w, u)}  H ${fmt(g.geo.h, u)} ${u}`)
        view.requestOverlay()
      },
      pointerup() {
        const c = g
        g = null
        status('')
        view.requestOverlay()
        if (!c?.moved || !c.geo || !big(c.geo)) return
        const { shape, sm, d } = build(c.geo)
        const node = newPath(store, d, { shape, sm }, arc())
        placeNodes(store, [node], `Draw ${label.toLowerCase()}`)
      },
      cancel() { if (g) { g = null; status('') } view.requestOverlay() },
      overlay(gEl, h) {
        selFrame(gEl, h)
        if (!g?.moved || !g.geo || !big(g.geo)) return
        gEl.append(h.el('path', { class: 'ds-draftp', d: screenD(build(g.geo).d, h.toScreen) }))
        snapLines(gEl, h, g.lines)
      },
    }
  }

  // ---------- freehand ----------
  function freehandTool() {
    let stroke = null // {pts, sa, moved}
    let poly = null // clicked polyline points (page)
    let hover = null
    const finish = () => {
      const pts = poly
      poly = null; hover = null
      view.requestOverlay()
      if (!pts || pts.length < 2) return
      status('')
      placeNodes(store, [newPath(store, subsToD([{ closed: false, pts: pts.map((p) => P(p.x, p.y)) }]), {}, true)], 'Draw polyline')
    }
    return {
      ...I('free'),
      get busy() { return !!stroke?.moved || !!poly },
      activate() { T = null },
      deactivate() { finish() },
      pointerdown(ev) {
        if (ev.button !== 0) return
        T = null
        const p = snap(ev.p, ev)
        stroke = { pts: [{ x: ev.p.x, y: ev.p.y }], sa: ev.s, moved: false, click: { x: p.x, y: p.y } }
      },
      pointermove(ev) {
        if (!stroke) { if (poly) { const p = snap(ev.p, ev); hover = { x: p.x, y: p.y }; view.requestOverlay() } return }
        if (!stroke.moved && Math.hypot(ev.s.x - stroke.sa.x, ev.s.y - stroke.sa.y) > DRAG) stroke.moved = true
        if (!stroke.moved) return
        const last = stroke.pts[stroke.pts.length - 1]
        if (Math.hypot(ev.p.x - last.x, ev.p.y - last.y) * store.view.z >= 2) stroke.pts.push({ x: ev.p.x, y: ev.p.y })
        view.requestOverlay()
      },
      pointerup(ev) {
        const s = stroke
        stroke = null
        if (!s) return
        if (!s.moved) { // a click starts or extends a polyline
          poly = poly || []
          const last = poly[poly.length - 1]
          if (last && Math.hypot(last.x - s.click.x, last.y - s.click.y) * store.view.z < 3) return // a double-click lands twice on the same spot
          poly.push(s.click)
          status('Polyline: click for more points, double-click or press Enter to finish.')
          view.requestOverlay()
          return
        }
        s.pts.push({ x: ev.p.x, y: ev.p.y })
        if (poly) { poly.push({ x: ev.p.x, y: ev.p.y }); view.requestOverlay(); return }
        const eps = shapePrefs(store).smooth / store.view.z
        const d = simplifyFreehand(s.pts, eps)
        view.requestOverlay()
        if (d.length > 1) placeNodes(store, [newPath(store, d, {}, true)], 'Draw freehand')
      },
      dblclick() { if (poly && poly.length > 1) { const a = poly[poly.length - 1], b = poly[poly.length - 2]; if (Math.hypot(a.x - b.x, a.y - b.y) * store.view.z < 3) poly.pop() } finish() },
      key(k) { if (k === 'Enter' && poly) { finish(); return true } if (k === 'Backspace' && poly) { poly.pop(); if (!poly.length) { poly = null; status('') } view.requestOverlay(); return true } return false },
      interrupt() { stroke = null; view.requestOverlay() },
      cancel() { if (stroke) stroke = null; if (poly) finish(); view.requestOverlay() },
      overlay(gEl, h) {
        selFrame(gEl, h)
        const pts = stroke?.moved ? stroke.pts : poly ? [...poly, ...(hover ? [hover] : [])] : null
        if (!pts || pts.length < 2) return
        gEl.append(h.el('path', { class: 'ds-draftl', d: screenD(subsToD([{ closed: false, pts: pts.map((p) => P(p.x, p.y)) }]), h.toScreen) }))
      },
    }
  }

  // ---------- Bezier (pen) ----------
  function penTool() {
    let pts = [] // page points {x,y,ix,iy,ox,oy}
    let cont = null // {id} when continuing an existing curve
    let down = null // {i, sa, moved}
    let hover = null
    const tol = (ev) => (ev?.pointerType === 'touch' ? 16 : 8) / store.view.z
    const reset = () => { pts = []; cont = null; down = null; hover = null; status(''); view.requestOverlay() }
    const draftD = (closed) => subsToD([{ closed, pts }])
    function commit(closed) {
      if (pts.length < 2) { reset(); return }
      const closedNow = closed && pts.length > 2
      const d = draftD(closedNow)
      const id = cont?.id
      reset()
      if (id != null) {
        const n = store.find(id)?.node
        if (!n) return
        const { shape: _s, sm: _m, nt: _nt, ...rest } = n
        store.tx('Edit curve', (r) => replaceLeaves(r, new Map([[id, { ...rest, d }]])), { sel: [id] })
      } else placeNodes(store, [newPath(store, d, {}, !closedNow)], closedNow ? 'Draw closed curve' : 'Draw curve')
    }
    /** An open end of a pickable single curve under the pointer: {node, atStart}. */
    function endAt(p, ev) {
      const r = tol(ev)
      for (const n of pickables(store).reverse()) {
        if (n.t !== 'path') continue
        const subs = dToSubs(n.d)
        if (subs.length !== 1 || subs[0].closed || subs[0].pts.length < 2) continue
        const a = subs[0].pts[0], b = subs[0].pts[subs[0].pts.length - 1]
        if (Math.hypot(a.x - p.x, a.y - p.y) <= r) return { node: n, atStart: true, subs }
        if (Math.hypot(b.x - p.x, b.y - p.y) <= r) return { node: n, atStart: false, subs }
      }
      return null
    }
    return {
      ...I('pen'),
      get busy() { return pts.length > 0 },
      activate() { T = null },
      deactivate() { commit(false) },
      pointerdown(ev) {
        if (ev.button !== 0) return
        if (!pts.length) {
          T = null
          const e = endAt(ev.p, ev)
          if (e) { // continue an existing open curve from the end that was clicked
            const sub = e.subs[0]
            if (e.atStart) reverseSub(sub)
            pts = sub.pts
            cont = { id: e.node.id }
            status('Continuing the curve. Click to add points, Enter to finish.')
            view.requestOverlay()
            return
          }
        }
        const s = snap(ev.p, ev)
        const first = pts[0], lastPt = pts[pts.length - 1]
        if (pts.length > 2 && !cont && first && Math.hypot(first.x - s.x, first.y - s.y) <= tol(ev)) { commit(true); return }
        if (lastPt && Math.hypot(lastPt.x - s.x, lastPt.y - s.y) * store.view.z < 3) return // a second click on the same spot (a double-click) adds nothing
        pts.push(P(s.x, s.y))
        down = { i: pts.length - 1, sa: ev.s, moved: false }
        status('Bezier: click for corner points, drag for smooth ones, click the first point to close. Enter finishes.')
        view.requestOverlay()
      },
      pointermove(ev) {
        const s = snap(ev.p, ev)
        if (down) {
          if (!down.moved && Math.hypot(ev.s.x - down.sa.x, ev.s.y - down.sa.y) > DRAG) down.moved = true
          if (down.moved) { const p = pts[down.i]; p.ox = s.x - p.x; p.oy = s.y - p.y; p.ix = -p.ox; p.iy = -p.oy }
        }
        hover = { x: s.x, y: s.y }
        view.requestOverlay()
      },
      pointerup() { down = null; view.requestOverlay() },
      dblclick() {
        if (pts.length > 1) { const a = pts[pts.length - 1], b = pts[pts.length - 2]; if (Math.hypot(a.x - b.x, a.y - b.y) * store.view.z < 3) pts.pop() }
        commit(false)
      },
      key(k) {
        if (!pts.length) return false
        if (k === 'Enter') { commit(false); return true }
        if (k === 'Backspace') { pts.pop(); if (pts.length < (cont ? 2 : 1)) reset(); view.requestOverlay(); return true }
        return false
      },
      interrupt() { if (down && !down.moved && pts.length > (cont ? 2 : 0)) pts.pop(); down = null; view.requestOverlay() }, // the press that began a pinch is not a point
      cancel() { if (pts.length) commit(false); else reset() },
      overlay(gEl, h) {
        selFrame(gEl, h)
        if (!pts.length) return
        const path = [...pts.slice(0, -1).map((p) => ({ ...p })), { ...pts[pts.length - 1] }]
        const live = hover && !down?.moved ? [...path, P(hover.x, hover.y)] : path
        gEl.append(h.el('path', { class: 'ds-draftl', d: screenD(subsToD([{ closed: false, pts: live }]), h.toScreen) }))
        pts.forEach((p, i) => {
          const s = h.toScreen(p.x, p.y)
          if (p.ox || p.oy) {
            const o = h.toScreen(p.x + p.ox, p.y + p.oy), n = h.toScreen(p.x + p.ix, p.y + p.iy)
            gEl.append(h.el('path', { class: 'ds-hline', d: `M${n.x.toFixed(1)} ${n.y.toFixed(1)}L${o.x.toFixed(1)} ${o.y.toFixed(1)}` }), h.el('circle', { class: 'ds-hdl', cx: o.x, cy: o.y, r: 3.5 }), h.el('circle', { class: 'ds-hdl', cx: n.x, cy: n.y, r: 3.5 }))
          }
          gEl.append(h.el('rect', { class: i === 0 && !cont ? 'ds-node ds-first' : 'ds-node', x: s.x - 4, y: s.y - 4, width: 8, height: 8 }))
        })
      },
    }
  }

  return {
    rect: dragShape('rect', 'Rectangle'), ellipse: dragShape('ellipse', 'Ellipse'), polygon: dragShape('poly', 'Polygon'), star: dragShape('star', 'Star'),
    free: freehandTool(), pen: penTool(),
  }
}
