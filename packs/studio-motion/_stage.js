// The canvas viewport: live preview, selection outline and handles, move / scale / rotate / anchor dragging, drawing tools, pan and zoom.
import { h, icon, select } from '../../lib/ui.js'
import { valueAt, setValue, clamp } from './_anim.js'
import { makeLayer, pathTo } from './_model.js'
import { renderFrame, localBounds, localMatrix, chainMatrix, mul, invert, apply, visibleAt } from './_render.js'
import { addLayer } from './_ops.js'
import { tip } from './_ui.js'

const PALETTE = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#22c55e', '#38bdf8', '#f43f5e']
const SHAPE_TOOLS = { rect: 'rect', ellipse: 'ellipse', polygon: 'polygon', star: 'star', line: 'line' }
const HANDLE_R = 6

export function createStage({ store, getTool, setTool, onEditText, onFiles }) {
  const cv = h('canvas', { class: 'ms-cv', 'aria-label': 'Composition preview', role: 'img' })
  const ov = h('canvas', { class: 'ms-ov', 'aria-hidden': 'true' })
  const ctx = cv.getContext('2d'), octx = ov.getContext('2d')
  const view = { zoom: 1, x: 0, y: 0, fit: true, quality: 'auto' }
  let drag = null, hoverId = null, hoverHandle = null, raf = 0

  const zoomLabel = h('button', { type: 'button', class: 'ms-zoom-label', onclick: () => setZoom(1) }, '100%')
  const bar = h('div', { class: 'ms-zoombar' },
    tip(h('button', { type: 'button', class: 'ms-btn sm', onclick: () => setZoom(view.zoom / 1.25, null, true) }, icon('zoom-out')), 'Zoom out', 'Ctrl -'),
    zoomLabel,
    tip(h('button', { type: 'button', class: 'ms-btn sm', onclick: () => setZoom(view.zoom * 1.25, null, true) }, icon('zoom-in')), 'Zoom in', 'Ctrl +'),
    tip(h('button', { type: 'button', class: 'ms-btn sm', onclick: () => fit() }, icon('scan')), 'Fit to window', 'Ctrl 0'),
    tip(select([['auto', 'Auto'], ['full', 'Full'], ['half', 'Half']], 'auto', (v) => { view.quality = v; queue() }), 'Preview resolution'))
  const el = h('div', { class: 'ms-stage', tabindex: 0, 'aria-label': 'Canvas' }, cv, ov, bar)
  const ro = new ResizeObserver(() => queue())
  ro.observe(el)

  // ---------- coordinates ----------
  const toScreen = ([x, y]) => [view.x + x * view.zoom, view.y + y * view.zoom]
  function toComp(e) {
    const r = el.getBoundingClientRect()
    return [(e.clientX - r.left - view.x) / view.zoom, (e.clientY - r.top - view.y) / view.zoom]
  }
  const toLocalScreen = (e) => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }

  function fit() { view.fit = true; queue() }
  function setZoom(z, anchor, manual) {
    const [ax, ay] = anchor || [el.clientWidth / 2, el.clientHeight / 2]
    const nz = clamp(z, 0.05, 16)
    const cx = (ax - view.x) / view.zoom, cy = (ay - view.y) / view.zoom
    view.fit = false
    view.zoom = nz
    view.x = ax - cx * nz
    view.y = ay - cy * nz
    queue()
  }

  // ---------- drawing ----------
  function queue() { if (!raf) raf = requestAnimationFrame(draw) }
  function layout() {
    const { width: W, height: H } = store.comp
    const sw = el.clientWidth, sh = el.clientHeight
    if (view.fit) {
      view.zoom = clamp(Math.min((sw - 36) / W, (sh - 64) / H), 0.02, 8)
      view.x = (sw - W * view.zoom) / 2
      view.y = (sh - H * view.zoom) / 2 - 8
    }
    cv.style.left = `${view.x}px`; cv.style.top = `${view.y}px`
    cv.style.width = `${W * view.zoom}px`; cv.style.height = `${H * view.zoom}px`
    cv.classList.toggle('transparent', !!store.comp.transparent)
    zoomLabel.textContent = `${Math.round(view.zoom * 100)}%`
  }
  function draw() {
    raf = 0
    const { width: W, height: H } = store.comp
    layout()
    const dpr = window.devicePixelRatio || 1
    let pw = view.quality === 'full' ? W : view.quality === 'half' ? W / 2 : Math.min(W, Math.max(160, Math.round(W * view.zoom * dpr)))
    pw = Math.round(clamp(pw, 16, 4096))
    const ph = Math.max(1, Math.round(pw * H / W))
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph }
    renderFrame(ctx, store.doc, store.time, { assets: store.assets })
    const ow = Math.round(el.clientWidth * dpr), oh = Math.round(el.clientHeight * dpr)
    if (ov.width !== ow || ov.height !== oh) { ov.width = ow; ov.height = oh }
    octx.setTransform(1, 0, 0, 1, 0, 0)
    octx.clearRect(0, 0, ov.width, ov.height)
    octx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawOverlay()
  }

  /** Screen-space geometry of a layer: outline corners, handle points, anchor. */
  function geom(L) {
    const t = store.time, chain = pathTo(store.doc, L.id)
    if (!chain.length) return null
    const pm = chainMatrix(chain.slice(0, -1), t), M = mul(pm, localMatrix(L, t)), b = localBounds(L, t)
    const c = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([x, y]) => toScreen(apply(M, x, y)))
    const mid = (i, j) => [(c[i][0] + c[j][0]) / 2, (c[i][1] + c[j][1]) / 2]
    const handles = { tl: c[0], tr: c[1], br: c[2], bl: c[3], t: mid(0, 1), r: mid(1, 2), b: mid(2, 3), l: mid(3, 0) }
    const ctr = [(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2]
    let vx = handles.t[0] - ctr[0], vy = handles.t[1] - ctr[1]
    const vl = Math.hypot(vx, vy) || 1
    vx /= vl; vy /= vl
    handles.rot = [handles.t[0] + vx * 26, handles.t[1] + vy * 26]
    const a = valueAt(L.props.anchor, t)
    return { M, pm, corners: c, handles, anchor: toScreen(apply(M, a[0], a[1])) }
  }

  function drawOverlay() {
    const t = store.time
    const accent = getComputedStyle(el).getPropertyValue('--accent').trim() || '#6366f1'
    const sel = store.selected.filter((l) => visibleAt(l, t))
    octx.lineJoin = 'round'
    const outline = (g, color, w) => {
      octx.beginPath()
      g.corners.forEach(([x, y], i) => (i ? octx.lineTo(x, y) : octx.moveTo(x, y)))
      octx.closePath()
      octx.strokeStyle = color; octx.lineWidth = w; octx.stroke()
    }
    if (hoverId && !store.sel.includes(hoverId)) {
      const hl = pathTo(store.doc, hoverId).at(-1)
      const g = hl && geom(hl)
      if (g) outline(g, accent + 'aa', 1)
    }
    for (const L of sel) { const g = geom(L); if (g) outline(g, accent, 1.5) }
    if (sel.length === 1 && !sel[0].locked) {
      const L = sel[0], g = geom(L)
      if (!g) return
      octx.strokeStyle = accent; octx.lineWidth = 1
      octx.beginPath(); octx.moveTo(g.handles.t[0], g.handles.t[1]); octx.lineTo(g.handles.rot[0], g.handles.rot[1]); octx.stroke()
      const dot = (p, round) => {
        octx.beginPath()
        if (round) octx.arc(p[0], p[1], HANDLE_R - 1, 0, Math.PI * 2); else octx.rect(p[0] - 4.5, p[1] - 4.5, 9, 9)
        octx.fillStyle = '#fff'; octx.fill(); octx.strokeStyle = accent; octx.lineWidth = 1.5; octx.stroke()
      }
      for (const k of ['tl', 'tr', 'br', 'bl', 't', 'r', 'b', 'l']) dot(g.handles[k], false)
      dot(g.handles.rot, true)
      const [ax, ay] = g.anchor
      octx.strokeStyle = '#f43f5e'; octx.lineWidth = 1.5
      octx.beginPath(); octx.arc(ax, ay, 5, 0, Math.PI * 2); octx.moveTo(ax - 9, ay); octx.lineTo(ax + 9, ay); octx.moveTo(ax, ay - 9); octx.lineTo(ax, ay + 9); octx.stroke()
    }
    }

  // ---------- hit testing ----------
  function hitList(list, pm, x, y) {
    const t = store.time
    for (const L of list) {
      if (!visibleAt(L, t) || L.locked) continue
      const m = mul(pm, localMatrix(L, t))
      if (L.type === 'group') { const r = hitList(L.children, m, x, y); if (r) return r; continue }
      const inv = invert(m)
      if (!inv) continue
      const [lx, ly] = apply(inv, x, y), b = localBounds(L, t)
      const pad = 5 / view.zoom / (Math.hypot(m[0], m[1]) || 1)
      if (lx >= b.x - pad && lx <= b.x + b.w + pad && ly >= b.y - pad && ly <= b.y + b.h + pad) return L.id
    }
    return null
  }
  const hit = (pt) => hitList(store.doc.layers, [1, 0, 0, 1, 0, 0], pt[0], pt[1])
  function handleAt(sp) {
    const sel = store.selected.filter((l) => !l.locked && visibleAt(l, store.time))
    if (sel.length !== 1) return null
    const g = geom(sel[0])
    if (!g) return null
    for (const k of ['rot', 'tl', 'tr', 'br', 'bl', 't', 'r', 'b', 'l']) {
      if (Math.hypot(sp[0] - g.handles[k][0], sp[1] - g.handles[k][1]) < 9) return k
    }
    return null
  }

  // ---------- interaction ----------
  const prop = (doc, id, key) => pathTo(doc, id).at(-1).props[key]
  function startDrag(e, kind, extra = {}) {
    el.setPointerCapture(e.pointerId)
    drag = { kind, moved: false, start: toComp(e), startScreen: toLocalScreen(e), ...extra }
  }
  function beginTransform(e, kind, L, hnd) {
    const t = store.time, g = geom(L)
    store.begin(kind === 'rotate' ? 'Rotate layer' : kind === 'anchor' ? 'Move anchor point' : 'Scale layer')
    startDrag(e, kind, {
      id: L.id, handle: hnd, pm: g.pm, inv0: invert(mul(g.pm, localMatrix(L, t))), lm: localMatrix(L, t), scale0: [...valueAt(L.props.scale, t)], rot0: valueAt(L.props.rotation, t), pos0: [...valueAt(L.props.position, t)], anchor0: [...valueAt(L.props.anchor, t)],
    })
  }
  el.addEventListener('pointerdown', (e) => {
    if (e.button === 1) { e.preventDefault(); return startDrag(e, 'pan', { vx: view.x, vy: view.y }) }
    if (e.button !== 0) return
    el.focus({ preventScroll: true })
    const tool = getTool(), pt = toComp(e), sp = toLocalScreen(e)
    if (tool === 'hand' || e.altKey) return startDrag(e, 'pan', { vx: view.x, vy: view.y })
    if (tool === 'text') {
      const L = addLayer(store, 'text', { position: pt.map(Math.round) })
      setTool('select')
      onEditText?.(L.id)
      return
    }
    if (SHAPE_TOOLS[tool]) return startDrag(e, 'draw', { tool })
    if (tool === 'anchor') {
      let id = store.sel.length === 1 ? store.sel[0] : null
      const under = hit(pt)
      if (under && (!id || !store.selected[0] || under !== id)) { store.select([under]); id = under }
      const L = id && pathTo(store.doc, id).at(-1)
      if (!L || L.locked) return
      return beginTransform(e, 'anchor', L, null)
    }
    // select tool
    const hnd = handleAt(sp)
    if (hnd) return beginTransform(e, hnd === 'rot' ? 'rotate' : 'scale', store.selected[0], hnd)
    const id = hit(pt)
    if (id) {
      if (e.shiftKey) store.toggle(id)
      else if (!store.sel.includes(id)) store.select([id])
      const layers = store.selected.filter((l) => !l.locked)
      if (!layers.length) return
      store.begin('Move layers')
      const t = store.time
      return startDrag(e, 'move', { items: layers.map((L) => { const pm = chainMatrix(pathTo(store.doc, L.id).slice(0, -1), t); return { id: L.id, pos0: [...valueAt(L.props.position, t)], inv: invert(pm) } }) })
    }
    if (!e.shiftKey) store.select([])
    startDrag(e, 'none')
  })

  el.addEventListener('pointermove', (e) => {
    const sp = toLocalScreen(e)
    if (!drag) {
      if (getTool() !== 'select') { el.dataset.cursor = getTool() === 'hand' ? 'grab' : 'crosshair'; return }
      const hnd = handleAt(sp), id = hnd ? null : hit(toComp(e))
      if (hnd !== hoverHandle || id !== hoverId) { hoverHandle = hnd; hoverId = id; el.dataset.cursor = hnd ? (hnd === 'rot' ? 'rotate' : hnd === 'anchor' ? 'move' : 'resize') : id ? 'move' : ''; queue() }
      return
    }
    const pt = toComp(e), t = store.time
    if (Math.hypot(sp[0] - drag.startScreen[0], sp[1] - drag.startScreen[1]) > 2) drag.moved = true
    if (!drag.moved) return
    if (drag.kind === 'pan') { view.fit = false; view.x = drag.vx + sp[0] - drag.startScreen[0]; view.y = drag.vy + sp[1] - drag.startScreen[1]; queue(); return }
    if (drag.kind === 'move') {
      let dx = pt[0] - drag.start[0], dy = pt[1] - drag.start[1]
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 }
      store.mutate((doc) => {
        for (const it of drag.items) {
          if (!it.inv) continue
          const ldx = it.inv[0] * dx + it.inv[2] * dy, ldy = it.inv[1] * dx + it.inv[3] * dy
          setValue(prop(doc, it.id, 'position'), t, [Math.round((it.pos0[0] + ldx) * 10) / 10, Math.round((it.pos0[1] + ldy) * 10) / 10])
        }
      })
    } else if (drag.kind === 'rotate') {
      const doc = store.doc, L = pathTo(doc, drag.id).at(-1)
      const a = apply(mul(drag.pm, localMatrix(L, t)), ...valueAt(L.props.anchor, t))
      const ang = (p) => Math.atan2(p[1] - a[1], p[0] - a[0]) * 180 / Math.PI
      let r = drag.rot0 + ang(pt) - ang(drag.start)
      if (e.shiftKey) r = Math.round(r / 15) * 15
      store.mutate((d) => setValue(prop(d, drag.id, 'rotation'), t, Math.round(r * 10) / 10))
    } else if (drag.kind === 'scale') {
      const rot = drag.rot0 * Math.PI / 180, c = Math.cos(rot), s = Math.sin(rot)
      const Wn = mul(drag.pm, [c, s, -s, c, drag.pos0[0], drag.pos0[1]]), inv = invert(Wn)
      if (!inv) return
      const q0 = apply(inv, ...drag.start), q = apply(inv, ...pt), hd = drag.handle
      let [sx, sy] = drag.scale0
      const rx = Math.abs(q0[0]) > 1e-3 ? q[0] / q0[0] : 1, ry = Math.abs(q0[1]) > 1e-3 ? q[1] / q0[1] : 1
      if (hd === 'l' || hd === 'r') sx = drag.scale0[0] * rx
      else if (hd === 't' || hd === 'b') sy = drag.scale0[1] * ry
      else if (e.shiftKey) { sx = drag.scale0[0] * rx; sy = drag.scale0[1] * ry }
      else { const k = Math.hypot(q[0], q[1]) / (Math.hypot(q0[0], q0[1]) || 1) * Math.sign(rx * ry || 1); sx = drag.scale0[0] * k; sy = drag.scale0[1] * k }
      store.mutate((d) => setValue(prop(d, drag.id, 'scale'), t, [Math.round(sx * 10) / 10, Math.round(sy * 10) / 10]))
    } else if (drag.kind === 'anchor') {
      const inv = drag.inv0
      if (!inv) return
      const s0 = apply(inv, ...drag.start), p = apply(inv, ...pt)
      const nx = drag.anchor0[0] + p[0] - s0[0], ny = drag.anchor0[1] + p[1] - s0[1]
      const lm = drag.lm // rotation * scale at drag start: moving the anchor shifts the position by the same amount so the layer stays put
      const da = [nx - drag.anchor0[0], ny - drag.anchor0[1]]
      const np = [drag.pos0[0] + lm[0] * da[0] + lm[2] * da[1], drag.pos0[1] + lm[1] * da[0] + lm[3] * da[1]]
      store.mutate((d) => {
        setValue(prop(d, drag.id, 'anchor'), t, [Math.round(nx * 10) / 10, Math.round(ny * 10) / 10])
        setValue(prop(d, drag.id, 'position'), t, [Math.round(np[0] * 10) / 10, Math.round(np[1] * 10) / 10])
      })
    } else if (drag.kind === 'draw') drawShape(pt, e.shiftKey)
    queue()
  })

  function drawShape(pt, square) {
    const tool = drag.tool
    let [x0, y0] = drag.start, [x1, y1] = pt
    let w = Math.abs(x1 - x0), hgt = Math.abs(y1 - y0)
    if (square && tool !== 'line') { w = hgt = Math.max(w, hgt); x1 = x0 + Math.sign(x1 - x0 || 1) * w; y1 = y0 + Math.sign(y1 - y0 || 1) * hgt }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
    const mk = (doc) => {
      const color = PALETTE[doc.layers.length % PALETTE.length]
      const L = makeLayer(doc, 'shape', { data: { kind: tool, fill: color, w: 10, h: 10 }, position: [0, 0] })
      doc.layers.unshift(L)
      drag.id = L.id
      return L
    }
    if (!drag.id) {
      store.begin(`Draw ${tool}`)
      store.mutate((doc) => { mk(doc) })
      store.sel = [drag.id]
      store.emit('select')
    }
    store.mutate((doc) => {
      const L = pathTo(doc, drag.id).at(-1)
      L.props.position.v = [Math.round(cx), Math.round(cy)]
      if (tool === 'line') {
        L.data.w = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0))); L.data.h = 0
        L.props.rotation.v = Math.round(Math.atan2(y1 - y0, x1 - x0) * 1800 / Math.PI) / 10
        L.props.position.v = [Math.round(cx), Math.round(cy)]
      } else { L.data.w = Math.max(2, Math.round(w)); L.data.h = Math.max(2, Math.round(hgt)) }
    })
  }

  function finish(e) {
    if (!drag) return
    const d = drag
    drag = null
    try { el.releasePointerCapture(e.pointerId) } catch { /* not captured */ }
    if (d.kind === 'draw') {
      if (d.id) { store.end(); setTool('select') }
      else {
        const pt = d.start, dflt = d.tool === 'line' ? 400 : 300
        addLayer(store, 'shape', { data: { kind: d.tool, w: dflt, h: d.tool === 'line' ? 0 : dflt, fill: PALETTE[store.doc.layers.length % PALETTE.length] }, position: pt.map(Math.round) })
        setTool('select')
      }
    } else if (store.txn) store.end()
    queue()
  }
  el.addEventListener('pointerup', finish)
  el.addEventListener('pointercancel', finish)
  el.addEventListener('pointerleave', () => { if (!drag && (hoverId || hoverHandle)) { hoverId = hoverHandle = null; queue() } })
  el.addEventListener('dblclick', (e) => {
    if (getTool() !== 'select') return
    const id = hit(toComp(e))
    if (id && pathTo(store.doc, id).at(-1).type === 'text') { store.select([id]); onEditText?.(id) }
  })
  el.addEventListener('wheel', (e) => {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) setZoom(view.zoom * Math.exp(-e.deltaY * 0.0015), toLocalScreen(e), true)
    else { view.fit = false; view.x -= e.deltaX; view.y -= e.deltaY; queue() }
  }, { passive: false })
  el.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); el.classList.add('drop') } })
  el.addEventListener('dragleave', () => el.classList.remove('drop'))
  el.addEventListener('drop', (e) => {
    el.classList.remove('drop')
    const files = [...(e.dataTransfer?.files || [])]
    if (!files.length) return
    e.preventDefault()
    onFiles?.(files)
  })

  const off = store.on((type) => { if (type === 'doc' || type === 'time' || type === 'select' || type === 'assets') queue() })
  const onFonts = () => queue()
  document.fonts?.addEventListener?.('loadingdone', onFonts)
  queue()

  return {
    el, queue, fit, setZoom: (z) => setZoom(z, null, true), get zoom() { return view.zoom },
    destroy() { off(); ro.disconnect(); cancelAnimationFrame(raf); document.fonts?.removeEventListener?.('loadingdone', onFonts) },
  }
}
