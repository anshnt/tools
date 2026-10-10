// The drawing surface: SVG artwork, screen-space overlay (selection, handles, guides, grid), view navigation, snapping and inline text editing.
import { h } from '../../lib/ui.js'
import { artSvg } from './_svg.js'
import { bboxOf, measureText, get } from './_model.js'
import { clamp } from './_geom.js'
import { createTools } from './_tools.js'

const NS = 'http://www.w3.org/2000/svg'
const el = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e }
const f = (v) => Math.round(v * 100) / 100

export class Canvas {
  constructor(ed) {
    this.ed = ed
    this.guides = { x: [], y: [] }
    this.space = false
    this.pointer = null
    this.hover = null
    this.skip = null
    this.touches = new Map()
    this.state = null // active gesture: 'tool' | 'pan' | 'pinch'

    this.art = el('g', { class: 'vs-art' })
    this.board = el('rect', { class: 'vs-board' })
    this.shadow = el('rect', { class: 'vs-shadow' })
    this.world = el('g', { class: 'vs-world' })
    this.world.append(this.shadow, this.board, this.art)
    const defs = el('defs')
    defs.innerHTML = '<pattern id="vs-checker" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#ffffff"/><rect width="8" height="8" fill="#e4e4ea"/><rect x="8" y="8" width="8" height="8" fill="#e4e4ea"/></pattern>'
    this.svg = el('svg', { class: 'vs-svg', 'aria-label': 'Drawing canvas', role: 'img' })
    this.svg.append(defs, this.world)
    this.ov = el('svg', { class: 'vs-ov', 'aria-hidden': 'true' })
    this.hint = h('div', { class: 'vs-empty' })
    this.root = h('div', { class: 'vs-stage', tabindex: 0 }, this.svg, this.ov, this.hint)
    this.tools = createTools(this)
    this._renderPending = false
    this._ovPending = false
    this._wire()
    this.offs = [
      ed.on('doc', () => this.schedule()),
      ed.on('sel', () => this.scheduleOv()),
      ed.on('view', () => { this.applyView(); this.scheduleOv() }),
      ed.on('tool', () => this.setTool()),
    ]
    const ro = new ResizeObserver(() => this.resize())
    ro.observe(this.root)
    this.offs.push(() => ro.disconnect())
  }

  destroy() { this.offs.forEach((o) => o()); this.endEdit(true) }

  // ----- rendering -----
  schedule() {
    if (this._renderPending) return
    this._renderPending = true
    const run = () => { if (!this._renderPending) return; this._renderPending = false; this.render() }
    requestAnimationFrame(run)
    setTimeout(run, 80)
  }
  scheduleOv() {
    if (this._ovPending) return
    this._ovPending = true
    const run = () => { if (!this._ovPending) return; this._ovPending = false; this.drawOverlay() }
    requestAnimationFrame(run)
    setTimeout(run, 80)
  }
  render() {
    const { doc } = this.ed
    const { defs, body } = artSvg(doc, { canvas: true, skip: this.skip })
    this.art.innerHTML = (defs ? `<defs>${defs}</defs>` : '') + body
    const { w, h: ht, bg, transparent } = doc.ab
    for (const r of [this.board, this.shadow]) { r.setAttribute('width', w); r.setAttribute('height', ht) }
    this.board.setAttribute('fill', transparent ? 'url(#vs-checker)' : bg)
    this.updateHint()
    this.drawOverlay()
  }
  applyView() {
    const { x, y, z } = this.ed.view
    this.world.setAttribute('transform', `translate(${f(x)} ${f(y)}) scale(${z})`)
  }
  resize() {
    const r = this.root.getBoundingClientRect()
    if (r.width < 4) return
    const first = !this._sized
    this._sized = true
    this.ed.stage = { w: r.width, h: r.height }
    if (first && !this.ed.viewRestored) this.ed.fit()
    this.scheduleOv()
  }
  setTool() {
    this.tool?.deactivate?.()
    this.tool = this.tools[this.ed.tool] || this.tools.select
    this.guides = { x: [], y: [] }
    this.tool.activate?.()
    this.updateHint()
    this.updateCursor()
    this.scheduleOv()
  }
  updateHint() { this.hint.hidden = this.ed.doc.nodes.length > 0 || !!this.hintOff || !['select', 'direct', 'hand'].includes(this.ed.tool) }
  updateCursor(c) { this.root.style.cursor = this.space || this.ed.tool === 'hand' ? (this.state === 'pan' ? 'grabbing' : 'grab') : c || this.tool?.cursor || 'default' }

  // ----- coordinates and hit testing -----
  local(e) { const r = this.root.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
  evt(e) {
    const [sx, sy] = this.local(e)
    const p = this.ed.toWorld(sx, sy)
    return { e, sx, sy, p, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, target: e.target, touch: e.pointerType === 'touch', id: this.hitId(e.target) }
  }
  hitId(t) {
    const n = t?.closest?.('[data-id]')
    return n && this.art.contains(n) ? n.getAttribute('data-id') : null
  }
  /** Screen position of a document point. */
  S(x, y) { return this.ed.toScreen(x, y) }
  get z() { return this.ed.view.z }

  // ----- snapping -----
  targets(exclude = []) {
    const { doc } = this.ed, ex = new Set(exclude)
    const xs = [0, doc.ab.w / 2, doc.ab.w], ys = [0, doc.ab.h / 2, doc.ab.h]
    const list = (this.ed.ctx && get(doc, this.ed.ctx)?.kids) || doc.nodes
    for (const n of list) {
      if (ex.has(n.id) || !n.vis) continue
      const b = bboxOf(n)
      if (b) { xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h) }
    }
    return { xs, ys }
  }
  /** Snap a moving box's edges and centre to targets and the grid. Returns the offset to add. */
  snapBox(box, T, off = false) {
    this.guides = { x: [], y: [] }
    if (off) return { dx: 0, dy: 0 }
    const thr = 7 / this.z, { grid, smart } = this.ed
    const axis = (vals, tg, gridOn) => {
      let best = null
      for (const v of vals) {
        if (smart) for (const t of tg) { const d = t - v; if (Math.abs(d) < thr && (!best || Math.abs(d) < Math.abs(best.d) - 1e-9)) best = { d, at: t } }
        if (gridOn && !best) { const g = Math.round(v / grid.size) * grid.size, d = g - v; if (Math.abs(d) < thr) best = { d, at: null } }
      }
      return best
    }
    const bx = axis([box.x, box.x + box.w / 2, box.x + box.w], T.xs, grid.snap), by = axis([box.y, box.y + box.h / 2, box.y + box.h], T.ys, grid.snap)
    if (bx?.at != null) this.guides.x.push(bx.at)
    if (by?.at != null) this.guides.y.push(by.at)
    return { dx: bx?.d || 0, dy: by?.d || 0 }
  }
  snapPoint(p, T, off = false) {
    this.guides = { x: [], y: [] }
    if (off) return p
    const thr = 7 / this.z, { grid, smart } = this.ed
    let { x, y } = p
    if (grid.snap) { x = Math.round(x / grid.size) * grid.size; y = Math.round(y / grid.size) * grid.size; return { x, y } }
    if (smart && T) {
      let bx = null, by = null
      for (const t of T.xs) if (Math.abs(t - p.x) < thr && (bx === null || Math.abs(t - p.x) < Math.abs(bx - p.x))) bx = t
      for (const t of T.ys) if (Math.abs(t - p.y) < thr && (by === null || Math.abs(t - p.y) < Math.abs(by - p.y))) by = t
      if (bx !== null) { x = bx; this.guides.x.push(bx) }
      if (by !== null) { y = by; this.guides.y.push(by) }
    }
    return { x, y }
  }

  // ----- events -----
  _wire() {
    const r = this.root
    r.addEventListener('pointerdown', (e) => this.down(e))
    r.addEventListener('pointermove', (e) => this.move(e))
    r.addEventListener('pointerup', (e) => this.up(e))
    r.addEventListener('pointercancel', (e) => this.up(e, true))
    r.addEventListener('pointerleave', () => { this.hover = null; this.pointer = null; this.ed.emit('pointer', null); this.scheduleOv() })
    r.addEventListener('dblclick', (e) => {
      if (this.space || e.target.closest?.('.vs-empty-card button, .vs-textedit')) return
      const ev = this.evt(e)
      ev.id = this.hitId(document.elementFromPoint(e.clientX, e.clientY)) // pointer capture retargets the event itself to the stage
      this.tool?.dblclick?.(ev)
    })
    r.addEventListener('contextmenu', (e) => e.preventDefault())
    r.addEventListener('wheel', (e) => this.wheel(e), { passive: false })
    r.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); r.classList.add('drop') } })
    r.addEventListener('dragleave', () => r.classList.remove('drop'))
    r.addEventListener('drop', (e) => {
      r.classList.remove('drop')
      if (!e.dataTransfer?.files?.length) return
      e.preventDefault(); e.stopPropagation()
      this.onFiles?.([...e.dataTransfer.files], this.ed.toWorld(...this.local(e)))
    })
  }
  down(e) {
    if (e.target.closest?.('.vs-empty-card button, .vs-textedit')) return
    if (e.pointerType === 'mouse' && e.button > 1) return
    this.root.focus({ preventScroll: true })
    try { this.root.setPointerCapture?.(e.pointerId) } catch { /* synthetic or already-released pointer */ }
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, this.local(e))
      if (this.touches.size === 2) { this.startPinch(); return }
      if (this.touches.size > 2) return
    }
    if (e.button === 1 || this.space || this.ed.tool === 'hand') { this.startPan(e); return }
    const ev = this.evt(e)
    this.state = this.tool.down?.(ev) === false ? null : 'tool'
  }
  move(e) {
    const [sx, sy] = this.local(e)
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) this.touches.set(e.pointerId, [sx, sy])
    if (this.state === 'pinch') return this.pinch()
    if (this.state === 'pan') return this.pan(e)
    const ev = this.evt(e)
    this.pointer = ev.p
    this.ed.emit('pointer', ev.p)
    if (this.state === 'tool') this.tool.move?.(ev)
    else {
      const id = e.pointerType === 'mouse' ? ev.id : null
      if (id !== this.hover) { this.hover = id; this.scheduleOv() }
      this.tool.hover?.(ev)
    }
  }
  up(e, cancel = false) {
    this.touches.delete(e.pointerId)
    try { this.root.releasePointerCapture?.(e.pointerId) } catch { /* not captured */ }
    if (this.state === 'pinch') { if (this.touches.size < 2) this.state = null; return }
    if (this.state === 'pan') { this.state = null; this.updateCursor(); return }
    if (this.state === 'tool') { this.state = null; const ev = this.evt(e); cancel ? this.tool.cancel?.(ev) : this.tool.up?.(ev); this.guides = { x: [], y: [] }; this.scheduleOv() }
  }
  startPan(e) { this.state = 'pan'; this.panFrom = { x: e.clientX, y: e.clientY, vx: this.ed.view.x, vy: this.ed.view.y }; this.updateCursor() }
  pan(e) { this.ed.setView({ x: this.panFrom.vx + e.clientX - this.panFrom.x, y: this.panFrom.vy + e.clientY - this.panFrom.y }) }
  startPinch() {
    if (this.state === 'tool') this.tool.cancel?.()
    this.state = 'pinch'
    const [a, b] = [...this.touches.values()]
    this.pinchFrom = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, ...this.ed.view }
  }
  pinch() {
    if (this.touches.size < 2) return
    const [a, b] = [...this.touches.values()], P = this.pinchFrom
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2
    const z = clamp(P.z * d / P.d, 0.02, 64), k = z / P.z
    this.ed.setView({ z, x: cx - (P.cx - P.x) * k, y: cy - (P.cy - P.y) * k })
  }
  wheel(e) {
    e.preventDefault()
    const [sx, sy] = this.local(e)
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY, dx = e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX
    if (e.ctrlKey || e.metaKey) this.ed.zoomAt(Math.exp(-dy * (e.ctrlKey && !e.deltaMode && Math.abs(dy) < 40 ? 0.01 : 0.0018)), sx, sy)
    else this.ed.setView({ x: this.ed.view.x - (e.shiftKey && !dx ? dy : dx), y: this.ed.view.y - (e.shiftKey && !dx ? 0 : dy) })
  }

  // ----- overlay -----
  drawOverlay() {
    const { ed } = this, { w, h: ht } = ed.stage
    let s = `<g class="ov">`
    if (ed.grid.on) s += this.gridSvg(w, ht)
    for (const x of this.guides.x) { const [sx] = this.S(x, 0); s += `<line class="ov-guide" x1="${f(sx)}" y1="0" x2="${f(sx)}" y2="${ht}"/>` }
    for (const y of this.guides.y) { const [, sy] = this.S(0, y); s += `<line class="ov-guide" x1="0" y1="${f(sy)}" x2="${w}" y2="${f(sy)}"/>` }
    if (this.hover && this.state !== 'tool' && ['select', 'direct', 'eyedrop'].includes(ed.tool)) {
      const n = ed.tool === 'direct' || ed.tool === 'eyedrop' ? get(ed.doc, this.hover) : ed.pick(this.hover)
      const b = n && n.vis && bboxOf(n)
      if (b && !ed.sel.includes(n.id)) { const [x0, y0] = this.S(b.x, b.y); s += `<rect class="ov-hover" x="${f(x0)}" y="${f(y0)}" width="${f(b.w * this.z)}" height="${f(b.h * this.z)}"/>` }
    }
    if (ed.ctx) {
      const g = get(ed.doc, ed.ctx), b = g && bboxOf(g)
      if (b) { const [x0, y0] = this.S(b.x, b.y); s += `<rect class="ov-ctx" x="${f(x0 - 3)}" y="${f(y0 - 3)}" width="${f(b.w * this.z + 6)}" height="${f(b.h * this.z + 6)}"/>` }
    }
    s += this.tool?.overlay?.() || ''
    this.ov.innerHTML = s + '</g>'
    this.ed.emit('overlay')
  }
  gridSvg(w, ht) {
    const { size } = this.ed.grid, z = this.z
    let step = size
    while (step * z < 7) step *= 2
    const a = this.ed.toWorld(0, 0), b = this.ed.toWorld(w, ht)
    const x0 = a.x, y0 = a.y, x1 = b.x, y1 = b.y
    let d = ''
    const n = ((x1 - x0) / step) + ((y1 - y0) / step)
    if (n > 600) return ''
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { const [sx] = this.S(x, 0); d += `M${f(sx)} 0V${ht}` }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) { const [, sy] = this.S(0, y); d += `M0 ${f(sy)}H${w}` }
    return `<path class="ov-grid" d="${d}"/>`
  }

  // ----- inline text editing -----
  /** Edit a text node in place. tx: an open history transaction to commit when done (e.g. the one that created the node). */
  editText(node, tx, selectAll = true) {
    this.endEdit(true)
    const ed = this.ed
    const t = tx || ed.begin('Edit text')
    this.skip = node.id
    this.schedule()
    const ta = h('textarea', { class: 'vs-textedit', spellcheck: false, 'aria-label': 'Edit text', rows: 1, value: node.text })
    const place = () => {
      const b = measureText(node), m = node.t || [1, 0, 0, 1, 0, 0], z = this.z
      const [ox, oy] = ed.toScreen(m[0] * b.x + m[2] * b.y + m[4], m[1] * b.x + m[3] * b.y + m[5])
      const lines = node.text.split('\n')
      Object.assign(ta.style, {
        fontFamily: node.ff, fontSize: node.fs + 'px', fontWeight: node.fw, fontStyle: node.fi ? 'italic' : 'normal', lineHeight: node.lh, letterSpacing: (node.ls || 0) + 'px',
        textAlign: { start: 'left', middle: 'center', end: 'right' }[node.ta], width: Math.max(b.w + node.fs * 0.6, node.fs * 2) + 'px', height: Math.max(lines.length * node.fs * node.lh, node.fs) + 'px',
        transform: `matrix(${m[0] * z}, ${m[1] * z}, ${m[2] * z}, ${m[3] * z}, ${ox}, ${oy})`,
        color: node.fill?.t === 'solid' ? node.fill.c : 'inherit',
      })
    }
    ta.addEventListener('input', () => { node.text = ta.value; place(); ed.touch() })
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); this.endEdit() }
    })
    ta.addEventListener('blur', () => { if (this._edit?.ta === ta) this.endEdit() })
    this.root.append(ta)
    this._edit = { ta, node, tx: t, place }
    place()
    requestAnimationFrame(() => { ta.focus({ preventScroll: true }); if (selectAll) ta.select() })
    const off = ed.on('view', place)
    this._edit.off = off
  }
  endEdit(silent = false) {
    const e = this._edit
    if (!e) return
    this._edit = null
    e.off?.()
    e.ta.remove()
    this.skip = null
    const { ed } = this
    if (!e.node.text.trim()) ed.remove([e.node.id])
    ed.commit(e.tx)
    ed.touch()
    if (!silent) this.root.focus({ preventScroll: true })
    ed.emit('sel')
  }
  get editing() { return !!this._edit }
}
