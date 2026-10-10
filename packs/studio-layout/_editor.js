// The canvas editor: pasteboard of pages, viewport, tools, selection, snapping, threading and in-place text editing.
import { h } from '../../lib/ui.js'
import { clamp, round, center, rotateAround, aabb, unionBox, hit, findItem, getMaster, paintOrder, isLayerVisible, isLocked, guideLines, cloneMany, expandGroups, para, addText, addShape, containers } from './_model.js'
import { drawPage, pageTokens } from './_render.js'
import { drawPageOverlay, selectionGeometry, drawSelection, portPositions, drawPort, drawThreadLine, drawRuler, cursorFor, HANDLE, PORT, ACCENT } from './_overlay.js'
import * as cmd from './_commands.js'
import { storyToDom, domToParas, selectedParas, applyCharStyle, parseTextFile } from './_richtext.js'
import { importImage } from './_assets.js'
import { styleOf, paraProp } from './_text.js'

const GAP = 48
let CLIP = null

function caretOf(el) {
  const sel = getSelection()
  if (!sel.rangeCount || !el.contains(sel.anchorNode)) return null
  const off = (node, o) => {
    let div = node
    while (div && div.parentNode !== el) div = div.parentNode
    if (!div) return { p: 0, o: 0 }
    const r = document.createRange()
    r.selectNodeContents(div)
    r.setEnd(node, o)
    return { p: [...el.children].indexOf(div), o: r.toString().length }
  }
  return { a: off(sel.anchorNode, sel.anchorOffset), f: off(sel.focusNode, sel.focusOffset) }
}
function setCaret(el, c) {
  if (!c || !el.children.length) return
  const place = (pos) => {
    const div = el.children[Math.min(pos.p, el.children.length - 1)]
    const tw = document.createTreeWalker(div, NodeFilter.SHOW_TEXT)
    let n, left = pos.o
    while ((n = tw.nextNode())) { if (left <= n.length) return [n, left]; left -= n.length }
    return [div, div.childNodes.length]
  }
  const [an, ao] = place(c.a), [fn, fo] = place(c.f)
  try { getSelection().setBaseAndExtent(an, ao, fn, fo) } catch { /* detached */ }
}

export class Editor {
  constructor({ store, scene, toast }) {
    this.store = store
    this.scene = scene
    this.toast = toast || (() => {})
    this.tool = 'select'
    this.sel = []
    this.mode = { kind: 'pages' }
    this.zoom = 0.8; this.px = 0; this.py = 0; this.vw = 800; this.vh = 600
    this.threading = null
    this.crop = false
    this.textEdit = null
    this.snapLines = []
    this.hover = null
    this.activeLayer = null
    this.listeners = new Set()
    this.ptrs = new Map()
    this.drag = null
    this.space = false
    this.lastClick = null
    this.pasteN = 0
    this.needFit = true
    this.colors = {}
    this.ports = []
    this.geo = null
    this.build()
    this.unsub = store.on((kind) => this.onStore(kind))
  }
  get doc() { return this.store.doc }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  emit(type, data) { for (const fn of [...this.listeners]) fn(type, data) }

  // ---------- DOM ----------
  build() {
    this.canvas = h('canvas', { class: 'ls-canvas' })
    this.ctx = this.canvas.getContext('2d')
    this.view = h('div', { class: 'ls-view', tabindex: 0, 'aria-label': 'Page canvas. Arrow keys nudge the selection, plus and minus zoom.' }, this.canvas)
    this.rh = h('canvas', { class: 'ls-ruler ls-ruler-h', 'aria-hidden': 'true' })
    this.rv = h('canvas', { class: 'ls-ruler ls-ruler-v', 'aria-hidden': 'true' })
    this.rc = h('div', { class: 'ls-ruler-corner', 'aria-hidden': 'true' })
    this.el = h('div', { class: 'ls-stage' }, this.view, this.rh, this.rv, this.rc)
    const v = this.view
    v.addEventListener('pointerdown', (e) => this.onDown(e))
    v.addEventListener('pointermove', (e) => this.onMove(e))
    v.addEventListener('pointerup', (e) => this.onUp(e))
    v.addEventListener('pointercancel', (e) => this.onUp(e, true))
    v.addEventListener('wheel', (e) => this.onWheel(e), { passive: false })
    v.addEventListener('contextmenu', (e) => e.preventDefault())
    v.addEventListener('blur', () => { if (this.space) { this.space = false; this.updateCursor() } })
    v.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault() })
    v.addEventListener('drop', (e) => this.onDrop(e))
    for (const [rul, axis] of [[this.rh, 'h'], [this.rv, 'v']]) {
      rul.addEventListener('pointerdown', (e) => this.onRulerDown(e, axis))
      rul.addEventListener('pointermove', (e) => this.onMove(e))
      rul.addEventListener('pointerup', (e) => this.onUp(e))
    }
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(this.view)
    this.selChange = () => { const te = this.textEdit; if (te && te.el.contains(getSelection().anchorNode)) { te.range = caretOf(te.el); this.emit('format') } }
    document.addEventListener('selectionchange', this.selChange)
    this.themeObs = new MutationObserver(() => { this.refreshColors(); this.requestRender() })
    this.themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
  }
  mounted() { this.refreshColors(); this.resize() }
  refreshColors() {
    const cs = getComputedStyle(this.el)
    const g = (n, d) => cs.getPropertyValue(n).trim() || d
    this.colors = { board: g('--ls-board', '#e7e7ee'), rulerBg: g('--ls-ruler-bg', '#f4f4f7'), tick: g('--ls-ruler-tick', '#9a9aa8'), text: g('--ls-ruler-text', '#5a5a68'), label: g('--ls-label', '#676774') }
  }
  resize() {
    const r = this.view.getBoundingClientRect()
    if (!r.width || !r.height) return
    this.vw = Math.round(r.width); this.vh = Math.round(r.height)
    if (this.needFit) { this.needFit = false; this.fitPage() } else this.requestRender()
  }
  destroy() {
    this.endTextEdit(true)
    this.unsub?.()
    this.ro.disconnect()
    this.themeObs.disconnect()
    document.removeEventListener('selectionchange', this.selChange)
    cancelAnimationFrame(this._raf)
  }

  // ---------- Store sync ----------
  onStore(kind) {
    const doc = this.doc
    if (kind === 'undo' || kind === 'load') this.endTextEdit(false)
    if (this.mode.kind === 'master' && !getMaster(doc, this.mode.id)) { this.mode = { kind: 'pages' }; this.emit('mode') }
    const keep = this.sel.filter((id) => findItem(doc, id))
    if (keep.length !== this.sel.length) { this.sel = keep; this.crop = false; this.emit('select') }
    if (this.textEdit && !doc.stories[this.textEdit.story]) this.endTextEdit(false)
    if (kind === 'load') { this.mode = { kind: 'pages' }; this.sel = []; this.threading = null; this.needFit = true; this.fitPage(); this.emit('mode'); this.emit('select') }
    this.requestRender()
  }

  // ---------- Geometry of the pasteboard ----------
  rects() {
    const d = this.doc
    if (this.mode.kind === 'master') {
      const m = getMaster(d, this.mode.id)
      return m ? [{ kind: 'master', id: m.id, c: m, x: 0, y: 0, w: d.w, h: d.h, i: 0 }] : []
    }
    return d.pages.map((p, i) => ({ kind: 'page', id: p.id, c: p, x: 0, y: i * (d.h + GAP), w: d.w, h: d.h, i }))
  }
  rectOf(container) { return this.rects().find((r) => r.c === container) }
  world(sx, sy) { return { x: (sx - this.px) / this.zoom, y: (sy - this.py) / this.zoom } }
  scr(wx, wy) { return { x: wx * this.zoom + this.px, y: wy * this.zoom + this.py } }
  rel(e) { const r = this.view.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }

  setView(z, px, py) {
    this.zoom = clamp(z, 0.05, 8); this.px = px; this.py = py
    this.requestRender()
    this.emit('view')
  }
  zoomAt(factor, sx = this.vw / 2, sy = this.vh / 2) {
    const z0 = this.zoom, z1 = clamp(z0 * factor, 0.05, 8)
    const wx = (sx - this.px) / z0, wy = (sy - this.py) / z0
    this.setView(z1, sx - wx * z1, sy - wy * z1)
  }
  setZoom(z) { this.zoomAt(z / this.zoom) }
  fitPage(id) {
    const rs = this.rects()
    const r = rs.find((x) => x.id === (id || this.currentPageId())) || rs[0]
    if (!r) return
    const z = clamp(Math.min((this.vw - 56) / r.w, (this.vh - 56) / r.h), 0.05, 8)
    this.setView(z, (this.vw - r.w * z) / 2 - r.x * z, (this.vh - r.h * z) / 2 - r.y * z)
  }
  fitWidth() {
    const r = this.rects()[0]
    if (!r) return
    const z = clamp((this.vw - 56) / r.w, 0.05, 8)
    const cur = this.rects().find((x) => x.id === this.currentPageId()) || r
    this.setView(z, (this.vw - r.w * z) / 2, 28 - cur.y * z)
  }
  gotoPage(id) {
    const r = this.rects().find((x) => x.id === id)
    if (!r) return
    const z = this.zoom
    const py = r.h * z > this.vh - 40 ? 24 - r.y * z : this.vh / 2 - (r.y + r.h / 2) * z
    this.setView(z, (this.vw - r.w * z) / 2 - r.x * z, py)
  }
  currentPageId() {
    const doc = this.doc
    if (this.mode.kind === 'master') return this.mode.id
    const f = this.sel[0] && findItem(doc, this.sel[0])
    if (f?.kind === 'page') return f.container.id
    const cy = (this.vh / 2 - this.py) / this.zoom
    let best = null
    for (const r of this.rects()) { const d = Math.abs(r.y + r.h / 2 - cy); if (!best || d < best.d) best = { d, id: r.id } }
    return best?.id
  }
  currentIndex() { return Math.max(0, this.doc.pages.findIndex((p) => p.id === this.currentPageId())) }
  editMaster(id) { this.endTextEdit(); this.mode = { kind: 'master', id }; this.sel = []; this.needFit = false; this.fitPage(id); this.emit('mode'); this.emit('select') }
  exitMaster() { this.endTextEdit(); this.mode = { kind: 'pages' }; this.sel = []; this.fitPage(this.doc.pages[0]?.id); this.emit('mode'); this.emit('select') }

  setTool(t) {
    if (this.tool === t) return
    this.endTextEdit()
    this.tool = t
    this.threading = null
    this.crop = false
    this.updateCursor()
    this.emit('tool')
  }

  // ---------- Selection ----------
  select(ids, { keepEdit = false } = {}) {
    ids = [...new Set(ids)].filter((id) => findItem(this.doc, id))
    if (ids.join() === this.sel.join()) return
    if (!keepEdit) this.endTextEdit()
    this.sel = ids
    this.crop = false
    this.requestRender()
    this.emit('select')
  }
  selected() { return this.sel.map((id) => findItem(this.doc, id)).filter(Boolean) }
  selItems() { return this.selected().map((f) => f.item) }
  unlockedIds() { return this.selected().filter((f) => !isLocked(this.doc, f.item)).map((f) => f.item.id) }
  selectAll() {
    const rs = this.rects()
    const r = rs.find((x) => x.id === this.currentPageId()) || rs[0]
    if (!r) return
    this.select(r.c.items.filter((it) => isLayerVisible(this.doc, it) && !isLocked(this.doc, it)).map((i) => i.id))
  }

  pickAt(wx, wy, { locked = false } = {}) {
    const doc = this.doc, tol = 3 / this.zoom
    const cands = this.rects().filter((r) => wx >= r.x - 60 && wx <= r.x + r.w + 60 && wy >= r.y - 60 && wy <= r.y + r.h + 60)
    const inside = (r) => wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h
    cands.sort((a, b) => inside(b) - inside(a))
    for (const r of cands) {
      const p = { x: wx - r.x, y: wy - r.y }
      const order = paintOrder(doc, r.c).reverse()
      for (const it of order) {
        if (!isLayerVisible(doc, it) || (!locked && isLocked(doc, it))) continue
        if (hit(it, p, tol)) return { item: it, rect: r }
      }
    }
    return null
  }
  pageAt(wx, wy) {
    const rs = this.rects()
    return rs.find((r) => wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) || rs.reduce((b, r) => (!b || Math.abs(r.y + r.h / 2 - wy) < Math.abs(b.y + b.h / 2 - wy) ? r : b), null)
  }

  // ---------- Rendering ----------
  requestRender() {
    if (this._raf) return
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.render() })
  }
  render() {
    const { ctx, canvas } = this
    const dpr = window.devicePixelRatio || 1
    const W = this.vw, H = this.vh
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr) }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = this.colors.board || '#e7e7ee'
    ctx.fillRect(0, 0, W, H)
    const doc = this.doc, z = this.zoom
    const rs = this.rects()
    const te = this.textEdit
    for (const r of rs) {
      const sx = this.px + r.x * z, sy = this.py + r.y * z
      if (sx > W + 20 || sy > H + 20 || sx + r.w * z < -20 || sy + r.h * z < -20) continue
      ctx.save()
      ctx.translate(sx, sy)
      ctx.scale(z, z)
      ctx.shadowColor = 'rgba(10,10,30,.28)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 3
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, r.w, r.h)
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0
      drawPage(ctx, this.scene, r.c, { tokens: pageTokens(doc, r.i, r.kind === 'master'), isMaster: r.kind === 'master', skipStory: te?.story })
      drawPageOverlay(ctx, doc, r.c, z, doc.view, r.kind)
      ctx.restore()
      ctx.fillStyle = this.colors.label || '#666'
      ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif'
      ctx.fillText(r.kind === 'master' ? `Master ${r.c.name}` : `Page ${r.i + 1}${r.c.master ? '' : ' (no master)'}`, sx, sy - 8)
    }
    this.drawPorts(ctx, rs)
    const sel = this.selected()
    this.geo = null
    if (sel.length) {
      const r = this.rectOf(sel[0].container)
      if (r) {
        const geo = selectionGeometry(sel.map((s) => s.item), (p) => this.scr(r.x + p.x, r.y + p.y))
        const locked = sel.every((s) => isLocked(doc, s.item))
        this.geo = { ...geo, locked, rect: r }
        if (!te) drawSelection(ctx, geo, locked)
        else drawSelection(ctx, { ...geo, handles: [], rot: null }, false)
      }
    }
    if (this.hover && !this.sel.includes(this.hover) && !this.drag) {
      const f = findItem(doc, this.hover)
      const r = f && this.rectOf(f.container)
      if (r) {
        const geo = selectionGeometry([f.item], (p) => this.scr(r.x + p.x, r.y + p.y))
        ctx.save(); ctx.strokeStyle = ACCENT; ctx.globalAlpha = 0.65; ctx.lineWidth = 1.5
        ctx.beginPath(); geo.outline.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke(); ctx.restore()
      }
    }
    // snap lines
    if (this.snapLines.length) {
      ctx.save(); ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 1; ctx.beginPath()
      for (const l of this.snapLines) {
        if (l.axis === 'x') { const x = Math.round(this.px + (l.r.x + l.pos) * z) + 0.5; ctx.moveTo(x, this.py + l.r.y * z - 14); ctx.lineTo(x, this.py + (l.r.y + l.r.h) * z + 14) } else { const y = Math.round(this.py + (l.r.y + l.pos) * z) + 0.5; ctx.moveTo(this.px + l.r.x * z - 14, y); ctx.lineTo(this.px + (l.r.x + l.r.w) * z + 14, y) }
      }
      ctx.stroke(); ctx.restore()
    }
    const d = this.drag
    if (d?.type === 'marquee' || d?.type === 'create') {
      const a = this.scr(d.a.x, d.a.y), b = this.scr(d.b.x, d.b.y)
      ctx.save()
      ctx.strokeStyle = ACCENT; ctx.fillStyle = 'rgba(91,76,240,.1)'; ctx.lineWidth = 1; ctx.setLineDash([5, 3])
      if (d.tool === 'line') { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke() } else if (d.tool === 'ellipse') {
        ctx.beginPath(); ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      } else { ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); ctx.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y)) }
      ctx.restore()
    }
    if (d?.type === 'guide-new' && d.cur) {
      ctx.save(); ctx.strokeStyle = 'rgba(6,182,212,.95)'; ctx.beginPath()
      if (d.axis === 'v') { ctx.moveTo(d.cur.x + 0.5, 0); ctx.lineTo(d.cur.x + 0.5, H) } else { ctx.moveTo(0, d.cur.y + 0.5); ctx.lineTo(W, d.cur.y + 0.5) }
      ctx.stroke(); ctx.restore()
    }
    this.positionEdit()
    this.drawRulers(rs)
  }

  drawPorts(ctx, rs) {
    const doc = this.doc
    this.ports = []
    const show = new Set([...this.sel, this.hover].filter(Boolean))
    const hasPrev = new Set()
    const byId = new Map()
    for (const r of rs) for (const it of r.c.items) { if (it.type === 'text') { byId.set(it.id, { it, r }); if (it.next) hasPrev.add(it.next) } }
    const pos = new Map()
    const posOf = (id) => {
      if (pos.has(id)) return pos.get(id)
      const e = byId.get(id)
      const p = e && portPositions(e.it, (q) => this.scr(e.r.x + q.x, e.r.y + q.y))
      pos.set(id, p)
      return p
    }
    for (const { it, r } of byId.values()) {
      if (!isLayerVisible(doc, it)) continue
      const sx = this.px + r.x * this.zoom, sy = this.py + r.y * this.zoom
      if (sx > this.vw || sy > this.vh || sx + r.w * this.zoom < 0 || sy + r.h * this.zoom < 0) continue
      const over = this.scene.layout(it, pageTokens(doc, r.i, r.kind === 'master')).overflow
      const shown = show.has(it.id) || !!this.threading
      if (!shown && !over && !it.next && !hasPrev.has(it.id)) continue
      const pp = posOf(it.id)
      if (!shown && !over) { // linked frames: only the thread line when one end is selected
        continue
      }
      if (shown || hasPrev.has(it.id)) { drawPort(ctx, pp.in, hasPrev.has(it.id) ? 'linked' : 'free'); this.ports.push({ id: it.id, kind: 'in', ...pp.in }) }
      drawPort(ctx, pp.out, over ? 'overflow' : it.next ? 'linked' : 'free')
      this.ports.push({ id: it.id, kind: 'out', over, ...pp.out })
      if (it.next && show.has(it.id) && byId.has(it.next)) drawThreadLine(ctx, pp.out, posOf(it.next).in)
    }
    for (const id of show) {
      const e = byId.get(id)
      if (!e) continue
      const prev = [...byId.values()].find((x) => x.it.next === id)
      if (prev && !show.has(prev.it.id)) drawThreadLine(ctx, posOf(prev.it.id).out, posOf(id).in)
    }
  }

  drawRulers(rs) {
    const doc = this.doc
    const on = doc.view.rulers
    this.el.classList.toggle('no-rulers', !on)
    if (!on) return
    const cur = rs.find((r) => r.id === this.currentPageId()) || rs[0]
    if (!cur) return
    const opt = { zoom: this.zoom, unit: doc.unit, colors: { bg: this.colors.rulerBg || '#f4f4f7', tick: this.colors.tick || '#999', text: this.colors.text || '#555' } }
    drawRuler(this.rh, 'h', { ...opt, origin: this.px + cur.x * this.zoom, length: this.vw })
    drawRuler(this.rv, 'v', { ...opt, origin: this.py + cur.y * this.zoom, length: this.vh })
  }

  // ---------- Snapping ----------
  snapBox(box, r, ignore, edges) {
    const doc = this.doc
    if (!doc.view.snap) return { dx: 0, dy: 0, lines: [] }
    const tol = 6 / this.zoom
    const { xs, ys } = guideLines(doc, r.kind === 'page' ? r.c : null)
    xs.push(doc.w / 2); ys.push(doc.h / 2)
    for (const it of r.c.items) {
      if (ignore.includes(it.id) || !isLayerVisible(doc, it)) continue
      const b = aabb(it)
      xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h)
    }
    const grid = doc.view.snapGrid ? doc.grid.size : 0
    const find = (vals, cands) => {
      let best = null
      for (const v of vals) {
        for (const c of cands) { const d = c - v; if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, pos: c } }
        if (grid) { const g = Math.round(v / grid) * grid, d = g - v; if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, pos: g } }
      }
      return best
    }
    const e = edges || { x: [0, 0.5, 1], y: [0, 0.5, 1] }
    const bx = find(e.x.map((f) => box.x + box.w * f), xs)
    const by = find(e.y.map((f) => box.y + box.h * f), ys)
    const lines = []
    if (bx) lines.push({ axis: 'x', pos: bx.pos, r })
    if (by) lines.push({ axis: 'y', pos: by.pos, r })
    return { dx: bx?.d || 0, dy: by?.d || 0, lines }
  }

  // ---------- Pointer handling ----------
  handleAt(p) {
    const g = this.geo
    if (!g || g.locked || this.textEdit) return null
    if (g.rot && Math.hypot(p.x - g.rot.x, p.y - g.rot.y) <= 9) return { rot: true }
    for (const hd of g.handles) if (Math.abs(p.x - hd.x) <= HANDLE && Math.abs(p.y - hd.y) <= HANDLE) return hd
    return null
  }
  portAt(p) {
    for (const pt of this.ports) if (Math.abs(p.x - pt.x) <= PORT / 2 + 3 && Math.abs(p.y - pt.y) <= PORT / 2 + 3) return pt
    return null
  }
  guideAt(p) {
    const doc = this.doc
    if (!doc.view.guides || this.mode.kind !== 'page' && this.mode.kind !== 'pages') return null
    const w = this.world(p.x, p.y), tol = 4 / this.zoom
    for (const r of this.rects()) {
      if (r.kind !== 'page') continue
      for (const axis of ['v', 'h']) {
        const arr = r.c.guides[axis]
        for (let i = 0; i < arr.length; i++) {
          const along = axis === 'v' ? w.y >= r.y - 40 && w.y <= r.y + r.h + 40 : w.x >= r.x - 40 && w.x <= r.x + r.w + 40
          const d = axis === 'v' ? Math.abs(w.x - (r.x + arr[i])) : Math.abs(w.y - (r.y + arr[i]))
          if (along && d <= tol) return { r, axis, i }
        }
      }
    }
    return null
  }
  updateCursor(p, e) {
    let c = 'default'
    if (this.drag?.type === 'pan' || this.tool === 'hand' || this.space) c = this.drag?.type === 'pan' ? 'grabbing' : 'grab'
    else if (this.threading) c = 'copy'
    else if (this.tool !== 'select') c = this.tool === 'text' ? 'text' : 'crosshair'
    else if (p) {
      const hd = this.handleAt(p)
      if (hd?.rot) c = 'grab'
      else if (hd) c = cursorFor(hd.hx, hd.hy, this.selItems().length === 1 ? this.selItems()[0].rot : 0)
      else if (this.portAt(p)) c = 'pointer'
      else {
        const g = this.guideAt(p)
        if (g) c = g.axis === 'v' ? 'ew-resize' : 'ns-resize'
        else if (this.hover) c = this.sel.includes(this.hover) ? (this.crop ? 'move' : 'move') : 'default'
      }
    }
    this.view.style.cursor = c
  }
  onWheel(e) {
    e.preventDefault()
    const p = this.rel(e)
    if (e.ctrlKey || e.metaKey) this.zoomAt(Math.exp(-e.deltaY * 0.01), p.x, p.y)
    else this.setView(this.zoom, this.px - (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX), this.py - (e.shiftKey && !e.deltaX ? 0 : e.deltaY))
  }

  startPinch() {
    if (this.drag) { if (this.store.pending != null) this.store.cancel(); this.drag = null }
    const [a, b] = [...this.ptrs.values()]
    this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: this.zoom, c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, px: this.px, py: this.py }
  }

  onDown(e) {
    if (e.target.closest?.('.ls-edit')) return
    this.view.focus({ preventScroll: true })
    const p = this.rel(e)
    this.ptrs.set(e.pointerId, p)
    try { this.view.setPointerCapture(e.pointerId) } catch { /* synthetic */ }
    if (this.ptrs.size === 2) { this.startPinch(); return }
    if (this.ptrs.size > 2) return
    if (this.textEdit) this.endTextEdit()
    const w = this.world(p.x, p.y)
    if (e.button === 1 || this.tool === 'hand' || this.space) { this.drag = { type: 'pan', p0: p, px: this.px, py: this.py }; this.updateCursor(); return }
    if (e.button === 2) {
      const picked = this.pickAt(w.x, w.y, { locked: true })
      if (picked && !this.sel.includes(picked.item.id)) this.select(expandGroups(this.doc, [picked.item.id]))
      else if (!picked) this.select([])
      this.emit('menu', { x: e.clientX, y: e.clientY, onItem: !!picked })
      return
    }
    if (this.threading) { this.threadDown(e, p, w); return }
    if (this.tool !== 'select') { this.startCreate(this.tool, w); return }
    const doc = this.doc
    const hd = this.handleAt(p)
    if (hd) { this.startHandleDrag(hd, w); return }
    const port = this.portAt(p)
    if (port) { this.portClick(port, e); return }
    const g = this.guideAt(p)
    if (g) { this.store.begin(); this.drag = { type: 'guide-move', ...g }; return }
    const picked = this.pickAt(w.x, w.y)
    const now = performance.now()
    const dbl = this.lastClick && now - this.lastClick.t < 380 && Math.hypot(p.x - this.lastClick.x, p.y - this.lastClick.y) < 8
    this.lastClick = { t: now, x: p.x, y: p.y }
    if (picked) {
      const id = picked.item.id
      if (dbl && this.sel.includes(id)) { this.lastClick = null; this.doubleClick(picked.item, e); return }
      const grp = expandGroups(doc, [id])
      if (e.shiftKey) { this.select(this.sel.includes(id) ? this.sel.filter((x) => !grp.includes(x)) : [...this.sel, ...grp]); return }
      if (!this.sel.includes(id)) this.select(grp)
      const ids = this.unlockedIds()
      if (!ids.length) return
      const items = ids.map((i) => findItem(doc, i).item)
      const f = this.crop && items.length === 1 && items[0].type === 'image'
      this.store.begin()
      if (f) this.drag = { type: 'crop', id, start: w, ox: items[0].ox || 0, oy: items[0].oy || 0, moved: false }
      else this.drag = { type: 'move', ids, rect: picked.rect, start: w, orig: new Map(items.map((it) => [it.id, { x: it.x, y: it.y }])), box: unionBox(items), moved: false, dup: false }
      return
    }
    // empty space
    if (!e.shiftKey) this.select([])
    if (e.pointerType === 'touch') { this.drag = { type: 'pan', p0: p, px: this.px, py: this.py }; return }
    const r = this.pageAt(w.x, w.y)
    this.drag = { type: 'marquee', a: w, b: w, rect: r, additive: e.shiftKey, base: [...this.sel] }
  }

  doubleClick(it, e) {
    if (it.type === 'text') this.startTextEdit(it.id, { point: e && { x: e.clientX, y: e.clientY } })
    else if (it.type === 'image') { this.crop = !this.crop; this.emit('crop'); this.requestRender(); if (!it.asset) this.emit('placeImage', it.id) }
  }

  portClick(port, e) {
    const doc = this.doc
    const f = findItem(doc, port.id)
    if (!f) return
    if (port.kind === 'out') {
      if (e.shiftKey && port.over) { const n = cmd.flowStory(this.store, port.id, this.scene); this.toast(n ? `Added ${n} page${n > 1 ? 's' : ''} to fit the story` : 'The story already fits', 'info'); return }
      if (f.item.next) { this.select([f.item.next]); const nf = findItem(doc, f.item.next); if (nf?.kind === 'page') this.gotoPage(nf.container.id); return }
      this.select([port.id])
      this.armThread(port.id)
    } else {
      const prev = containers(doc).flatMap(({ c }) => c.items).find((i) => i.next === port.id)
      if (prev) { this.select([prev.id]); const pf = findItem(doc, prev.id); if (pf?.kind === 'page') this.gotoPage(pf.container.id) }
    }
  }
  armThread(id) {
    this.threading = id
    this.toast('Click a text frame to continue the story there, or drag a new frame. Esc cancels.', 'info')
    this.updateCursor()
    this.emit('thread')
  }
  threadDown(e, p, w) {
    const from = this.threading
    const picked = this.pickAt(w.x, w.y, { locked: true })
    if (picked && picked.item.type === 'text') {
      const err = cmd.linkFrames(this.store, from, picked.item.id)
      if (err) this.toast(err, 'error')
      else { this.threading = null; this.select([picked.item.id]); this.emit('thread') }
      return
    }
    this.startCreate('text', w, { thread: from })
  }

  startHandleDrag(hd, w) {
    const items = this.selItems()
    const r = this.geo.rect
    const local = { x: w.x - r.x, y: w.y - r.y }
    this.store.begin()
    if (hd.rot) {
      const it = items[0], c = center(it)
      this.drag = { type: 'rotate', id: it.id, c, r, off: Math.atan2(local.y - c.y, local.x - c.x) * 180 / Math.PI - it.rot }
      return
    }
    if (items.length === 1) {
      const it = items[0]
      this.drag = { type: 'resize', id: it.id, r, hx: hd.hx, hy: hd.hy, o: { x: it.x, y: it.y, w: it.w, h: it.h, rot: it.rot } }
    } else {
      this.drag = { type: 'group', r, hx: hd.hx, hy: hd.hy, box: unionBox(items), orig: new Map(items.map((it) => [it.id, { x: it.x, y: it.y, w: it.w, h: it.h }])) }
    }
  }

  startCreate(tool, w, extra = {}) {
    const r = this.pageAt(w.x, w.y)
    if (!r) return
    const a = this.snapPoint(w, r)
    this.drag = { type: 'create', tool, a, b: a, rect: r, ...extra }
  }
  snapPoint(w, r) {
    const doc = this.doc
    if (!doc.view.snap) return w
    const tol = 6 / this.zoom
    const { xs, ys } = guideLines(doc, r.kind === 'page' ? r.c : null)
    const lx = w.x - r.x, ly = w.y - r.y
    const nx = xs.reduce((b, c) => (Math.abs(c - lx) < Math.abs(b - lx) ? c : b), Infinity)
    const ny = ys.reduce((b, c) => (Math.abs(c - ly) < Math.abs(b - ly) ? c : b), Infinity)
    return { x: r.x + (Math.abs(nx - lx) <= tol ? nx : lx), y: r.y + (Math.abs(ny - ly) <= tol ? ny : ly) }
  }

  onRulerDown(e, axis) {
    e.preventDefault()
    e.stopPropagation()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic */ }
    this.drag = { type: 'guide-new', axis, cur: null } // the top ruler makes horizontal guides, the left ruler vertical ones
    this.onMove(e)
  }

  onMove(e) {
    const p = this.rel(e)
    if (this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, p)
    if (this.pinch && this.ptrs.size >= 2) {
      const [a, b] = [...this.ptrs.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const z = clamp(this.pinch.z * (d / this.pinch.d), 0.05, 8)
      const wx = (this.pinch.c.x - this.pinch.px) / this.pinch.z, wy = (this.pinch.c.y - this.pinch.py) / this.pinch.z
      this.setView(z, c.x - wx * z, c.y - wy * z)
      return
    }
    const d = this.drag
    if (!d) {
      if (e.pointerType === 'touch') return
      const w = this.world(p.x, p.y)
      const hv = this.tool === 'select' && !this.threading ? this.pickAt(w.x, w.y)?.item.id || null : null
      if (hv !== this.hover) { this.hover = hv; this.requestRender() }
      this.updateCursor(p, e)
      return
    }
    const w = this.world(p.x, p.y)
    const z = this.zoom
    const doc = this.doc
    switch (d.type) {
      case 'pan': this.setView(z, d.px + (p.x - d.p0.x), d.py + (p.y - d.p0.y)); break
      case 'move': {
        let dx = w.x - d.start.x, dy = w.y - d.start.y
        if (!d.moved && Math.hypot(dx, dy) * z < 3) return
        d.moved = true
        if (e.altKey && !d.dup) {
          d.dup = true
          const found = d.ids.map((id) => findItem(doc, id)).filter(Boolean)
          const clones = cloneMany(doc, found.map((f) => f.item))
          clones.forEach((c, i) => found[i].container.items.push(c))
          d.ids = clones.map((c) => c.id)
          d.orig = new Map(clones.map((c) => [c.id, { x: c.x, y: c.y }]))
          this.sel = [...d.ids]
          this.emit('select')
        }
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 }
        const box = { x: d.box.x + dx, y: d.box.y + dy, w: d.box.w, h: d.box.h }
        const sn = this.snapBox(box, d.rect, d.ids)
        dx += sn.dx; dy += sn.dy
        this.snapLines = sn.lines
        for (const id of d.ids) { const it = findItem(doc, id)?.item; const o = d.orig.get(id); if (it && o) { it.x = round(o.x + dx, 2); it.y = round(o.y + dy, 2) } }
        this.store.touch()
        break
      }
      case 'crop': {
        const it = findItem(doc, d.id)?.item
        if (!it) break
        it.ox = round(d.ox + (w.x - d.start.x), 1)
        it.oy = round(d.oy + (w.y - d.start.y), 1)
        this.store.touch()
        break
      }
      case 'rotate': {
        const it = findItem(doc, d.id)?.item
        if (!it) break
        const local = { x: w.x - d.r.x, y: w.y - d.r.y }
        let a = (Math.atan2(local.y - d.c.y, local.x - d.c.x) * 180) / Math.PI - d.off
        if (e.shiftKey) a = Math.round(a / 15) * 15
        a = ((a + 180) % 360 + 360) % 360 - 180
        it.rot = round(a, 1)
        this.store.touch()
        break
      }
      case 'resize': this.resizeMove(d, w, e); break
      case 'group': this.groupMove(d, w); break
      case 'marquee': {
        d.b = w
        const x0 = Math.min(d.a.x, d.b.x), y0 = Math.min(d.a.y, d.b.y), x1 = Math.max(d.a.x, d.b.x), y1 = Math.max(d.a.y, d.b.y)
        const r = d.rect
        if (r) {
          const ids = r.c.items.filter((it) => isLayerVisible(doc, it) && !isLocked(doc, it)).filter((it) => { const b = aabb(it); return b.x + r.x < x1 && b.x + b.w + r.x > x0 && b.y + r.y < y1 && b.y + b.h + r.y > y0 }).map((i) => i.id)
          this.sel = expandGroups(doc, [...new Set([...(d.additive ? d.base : []), ...ids])])
          this.emit('select')
        }
        this.requestRender()
        break
      }
      case 'create': {
        let b = this.snapPoint(w, d.rect)
        if (e.shiftKey && d.tool !== 'text') { const dx = b.x - d.a.x, dy = b.y - d.a.y; const m = d.tool === 'line' ? null : Math.max(Math.abs(dx), Math.abs(dy)); b = d.tool === 'line' ? (Math.abs(dx) > Math.abs(dy) ? { x: b.x, y: d.a.y } : { x: d.a.x, y: b.y }) : { x: d.a.x + Math.sign(dx || 1) * m, y: d.a.y + Math.sign(dy || 1) * m } }
        d.b = b
        this.requestRender()
        break
      }
      case 'guide-new': {
        const vr = this.view.getBoundingClientRect()
        d.cur = { x: e.clientX - vr.left, y: e.clientY - vr.top }
        this.requestRender()
        break
      }
      case 'guide-move': {
        const r = d.r
        const pos = d.axis === 'v' ? w.x - r.x : w.y - r.y
        r.c.guides[d.axis][d.i] = round(pos, 2)
        d.cur = p
        this.store.touch()
        break
      }
      default: break
    }
  }

  resizeMove(d, w, e) {
    const it = findItem(this.doc, d.id)?.item
    if (!it) return
    const { o, hx, hy } = d
    const p = { x: w.x - d.r.x, y: w.y - d.r.y }
    const c = { x: o.x + o.w / 2, y: o.y + o.h / 2 }
    const anchor = rotateAround({ x: c.x - (hx * o.w) / 2, y: c.y - (hy * o.h) / 2 }, c, o.rot)
    const q = rotateAround(p, anchor, -o.rot)
    let nw = hx ? Math.max(4, hx * (q.x - anchor.x)) : o.w
    let nh = hy ? Math.max(4, hy * (q.y - anchor.y)) : o.h
    if (it.type === 'line') nh = 0
    if (e.shiftKey && hx && hy && o.w && o.h) { const s = Math.max(nw / o.w, nh / o.h); nw = o.w * s; nh = o.h * s }
    let nx, ny
    if (!o.rot && this.doc.view.snap && !e.altKey) {
      // snap the moving edges
      const box = { x: hx ? (hx < 0 ? anchor.x - nw : anchor.x) : o.x, y: hy ? (hy < 0 ? anchor.y - nh : anchor.y) : o.y, w: nw, h: nh }
      const edges = { x: hx < 0 ? [0] : hx > 0 ? [1] : [], y: hy < 0 ? [0] : hy > 0 ? [1] : [] }
      const sn = this.snapBox(box, d.r, [d.id], edges)
      if (hx) nw = Math.max(4, nw + hx * sn.dx)
      if (hy && it.type !== 'line') nh = Math.max(4, nh + hy * sn.dy)
      this.snapLines = sn.lines
    }
    const nc = rotateAround({ x: anchor.x + (hx * nw) / 2, y: anchor.y + (hy * nh) / 2 }, anchor, o.rot)
    nx = nc.x - nw / 2; ny = nc.y - nh / 2
    it.x = round(nx, 2); it.y = round(ny, 2); it.w = round(nw, 2); it.h = round(nh, 2)
    this.store.touch()
  }
  groupMove(d, w) {
    const doc = this.doc
    const p = { x: w.x - d.r.x, y: w.y - d.r.y }
    const B = d.box
    const ax = d.hx > 0 ? B.x : d.hx < 0 ? B.x + B.w : B.x, ay = d.hy > 0 ? B.y : d.hy < 0 ? B.y + B.h : B.y
    const sx = d.hx ? Math.max(0.05, Math.abs(p.x - ax) / B.w) : 1, sy = d.hy ? Math.max(0.05, Math.abs(p.y - ay) / B.h) : 1
    for (const [id, o] of d.orig) {
      const it = findItem(doc, id)?.item
      if (!it) continue
      it.x = round(ax + (o.x - ax) * sx, 2); it.y = round(ay + (o.y - ay) * sy, 2); it.w = round(o.w * sx, 2); it.h = round(o.h * sy, 2)
    }
    this.store.touch()
  }

  onUp(e, cancelled = false) {
    this.ptrs.delete(e.pointerId)
    if (this.pinch) { if (this.ptrs.size < 2) this.pinch = null; return }
    const d = this.drag
    if (!d) return
    this.drag = null
    this.snapLines = []
    const p = this.rel(e)
    const w = this.world(p.x, p.y)
    switch (d.type) {
      case 'move': {
        if (d.moved && !cancelled) this.dropAcrossPages(d)
        this.store.commit()
        break
      }
      case 'crop': case 'rotate': case 'resize': case 'group': this.store.commit(); break
      case 'guide-move': {
        const vr = this.view.getBoundingClientRect()
        const outside = e.clientX < vr.left || e.clientY < vr.top || e.clientX > vr.right || e.clientY > vr.bottom
        if (outside || cancelled) d.r.c.guides[d.axis].splice(d.i, 1)
        this.store.commit()
        break
      }
      case 'guide-new': {
        const vr = this.view.getBoundingClientRect()
        const inside = e.clientX >= vr.left && e.clientY >= vr.top && e.clientX <= vr.right && e.clientY <= vr.bottom
        if (inside && !cancelled) {
          const ww = this.world(e.clientX - vr.left, e.clientY - vr.top)
          const r = this.pageAt(ww.x, ww.y)
          if (r && r.kind === 'page') cmd.addGuide(this.store, r.id, d.axis, d.axis === 'v' ? ww.x - r.x : ww.y - r.y)
        }
        this.requestRender()
        break
      }
      case 'marquee': this.requestRender(); break
      case 'create': if (!cancelled) this.finishCreate(d, w); break
      case 'pan': this.updateCursor(); break
      default: break
    }
  }

  dropAcrossPages(d) {
    const doc = this.doc
    const items = d.ids.map((id) => findItem(doc, id)).filter(Boolean)
    if (!items.length || d.rect.kind !== 'page') return
    const box = unionBox(items.map((f) => f.item))
    const cx = d.rect.x + box.x + box.w / 2, cy = d.rect.y + box.y + box.h / 2
    const target = this.rects().find((r) => r.kind === 'page' && cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h)
    if (!target || target.c === d.rect.c) return
    for (const f of items) {
      f.container.items.splice(f.container.items.indexOf(f.item), 1)
      f.item.x = round(f.item.x + d.rect.x - target.x, 2)
      f.item.y = round(f.item.y + d.rect.y - target.y, 2)
      target.c.items.push(f.item)
    }
  }

  finishCreate(d, w) {
    const r = d.rect
    const x0 = Math.min(d.a.x, d.b.x) - r.x, y0 = Math.min(d.a.y, d.b.y) - r.y
    let wd = Math.abs(d.b.x - d.a.x), ht = Math.abs(d.b.y - d.a.y)
    const tiny = Math.hypot(wd, ht) * this.zoom < 6
    const tool = d.tool
    let geo
    if (tool === 'line') {
      const a = { x: d.a.x - r.x, y: d.a.y - r.y }, b = tiny ? { x: a.x + 160, y: a.y } : { x: d.b.x - r.x, y: d.b.y - r.y }
      const len = Math.hypot(b.x - a.x, b.y - a.y), ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
      geo = { x: round((a.x + b.x) / 2 - len / 2, 2), y: round((a.y + b.y) / 2, 2), w: round(len, 2), h: 0, rot: round(ang, 1) }
    } else {
      if (tiny) { wd = tool === 'text' ? 220 : tool === 'image' ? 240 : 160; ht = tool === 'text' ? 120 : tool === 'image' ? 170 : 110 }
      geo = { x: round(tiny ? d.a.x - r.x : x0, 2), y: round(tiny ? d.a.y - r.y : y0, 2), w: round(wd, 2), h: round(ht, 2) }
    }
    const layer = this.activeLayer && this.doc.layers.some((l) => l.id === this.activeLayer) ? this.activeLayer : undefined
    let id
    this.store.exec('Add frame', (doc) => {
      const c = r.c
      let it
      if (tool === 'text') it = addText(doc, c, geo, [para('', 'body')], { layer: layer || doc.layers[doc.layers.length - 1].id })
      else if (tool === 'image') it = addShape(doc, c, 'image', geo, { layer: layer || doc.layers[doc.layers.length - 1].id })
      else it = addShape(doc, c, tool, geo, { layer: layer || doc.layers[doc.layers.length - 1].id })
      id = it.id
      if (tool === 'text' && d.thread) { const err = cmd.canLink(doc, d.thread, it.id); if (!err) { const from = findItem(doc, d.thread).item; const old = it.story; it.story = from.story; delete doc.stories[old]; from.next = it.id } }
    })
    this.threading = null
    this.setTool('select')
    this.select([id])
    if (tool === 'text') this.startTextEdit(id)
    if (tool === 'image') this.emit('placeImage', id)
    this.emit('thread')
  }

  // ---------- Files ----------
  async onDrop(e) {
    const files = [...(e.dataTransfer?.files || [])]
    if (!files.length) return
    e.preventDefault()
    e.stopPropagation()
    const p = this.rel(e)
    const w = this.world(p.x, p.y)
    await this.addImages(files, w)
  }
  /** Import image files: fill the image frame under the drop point (or the selected empty one), else create new frames. */
  async addImages(files, at) {
    const imgs = files.filter((f) => f.type.startsWith('image/') || /\.(heic|heif|avif|svg|png|jpe?g|webp|gif|bmp)$/i.test(f.name))
    if (!imgs.length) { this.toast('Drop image files (JPG, PNG, WebP, SVG, HEIC) onto the page.', 'error'); return [] }
    const out = []
    let i = 0
    for (const file of imgs) {
      let a
      try { a = await importImage(file) } catch (err) { this.toast(err.message, 'error'); continue }
      this.store.addAsset(a)
      const w = at || this.world(this.vw / 2, this.vh / 2)
      const target = i === 0 && at ? this.pickAt(w.x, w.y, { locked: true }) : null
      const sel = this.selItems()[0]
      const frame = target?.item.type === 'image' ? target.item : i === 0 && !at && sel?.type === 'image' && !sel.asset ? sel : null
      if (frame) cmd.updateItems(this.store, [frame.id], { asset: a.id, zoom: 1, ox: 0, oy: 0 })
      else {
        const r = (target?.rect) || this.pageAt(w.x, w.y)
        if (!r) continue
        const doc = this.doc
        const maxW = doc.w * 0.6
        const fw = Math.min(maxW, Math.max(80, a.w * 0.75)), fh = fw * (a.h / a.w)
        const k = Math.min(1, (doc.h * 0.7) / fh)
        const gw = fw * k, gh = fh * k
        let nid
        this.store.exec('Place image', (d) => {
          const it = addShape(d, r.c, 'image', { x: round(clamp(w.x - r.x - gw / 2 + i * 14, 0, Math.max(0, d.w - gw)), 2), y: round(clamp(w.y - r.y - gh / 2 + i * 14, 0, Math.max(0, d.h - gh)), 2), w: round(gw, 2), h: round(gh, 2) }, { asset: a.id, fit: 'fill', layer: this.activeLayer || d.layers[d.layers.length - 1].id })
          nid = it.id
        })
        out.push(nid)
        this.select([nid])
      }
      i++
    }
    return out
  }
  /** Import a .txt or .md file: fills the selected text frame, or makes a frame over the margins and adds pages if the text needs them. */
  async placeText(file) {
    const text = await file.text()
    const paras = parseTextFile(text, /\.md$|\.markdown$/i.test(file.name), this.doc)
    const target = this.selItems().find((x) => x.type === 'text')
    if (target) { cmd.setStoryText(this.store, target.story, paras); this.select([target.id]); return target.id }
    const rs = this.rects()
    const r = rs.find((x) => x.id === this.currentPageId() && x.kind === 'page') || rs.find((x) => x.kind === 'page')
    if (!r) return null
    let id
    this.store.exec('Place text', (doc) => {
      const m = doc.margins
      const it = addText(doc, r.c, { x: m.l, y: m.t, w: doc.w - m.l - m.r, h: doc.h - m.t - m.b }, paras, { cols: doc.cols, gap: doc.gutter, layer: this.activeLayer || doc.layers[doc.layers.length - 1].id })
      id = it.id
    })
    const n = cmd.flowStory(this.store, id, this.scene)
    this.select([id])
    this.toast(n ? `Placed ${file.name} and added ${n} page${n > 1 ? 's' : ''} so the text fits.` : `Placed ${file.name}.`, 'success')
    return id
  }
  async placeInto(frameId, file) {
    try {
      const a = await importImage(file)
      this.store.addAsset(a)
      cmd.updateItems(this.store, [frameId], { asset: a.id, zoom: 1, ox: 0, oy: 0 })
      return a
    } catch (err) { this.toast(err.message, 'error'); return null }
  }

  // ---------- Clipboard and editing commands ----------
  copy() {
    const items = this.selItems()
    if (!items.length) return false
    CLIP = { items: JSON.parse(JSON.stringify(items)), stories: Object.fromEntries(items.filter((i) => i.type === 'text').map((i) => [i.story, JSON.parse(JSON.stringify(this.doc.stories[i.story] || { paras: [para('')] }))])) }
    this.pasteN = 0
    return true
  }
  cut() { if (this.copy()) cmd.deleteItems(this.store, this.unlockedIds()) }
  paste() {
    if (!CLIP) return
    const rs = this.rects()
    const r = rs.find((x) => x.id === this.currentPageId()) || rs[0]
    if (!r) return
    this.pasteN++
    const ids = []
    this.store.exec('Paste', (doc) => {
      for (const c of cloneMany(doc, CLIP.items, 12 * this.pasteN, 12 * this.pasteN, CLIP.stories)) {
        c.layer = doc.layers.some((l) => l.id === c.layer) ? c.layer : doc.layers[0].id
        r.c.items.push(c)
        ids.push(c.id)
      }
    })
    this.select(ids)
  }
  duplicate() { const ids = this.unlockedIds(); if (ids.length) this.select(cmd.duplicateItems(this.store, ids)) }
  remove() { const ids = this.unlockedIds(); if (ids.length) { cmd.deleteItems(this.store, ids); this.select([]) } }
  nudge(dx, dy) {
    const ids = this.unlockedIds()
    if (ids.length) cmd.updateItems(this.store, ids, (it) => ({ x: round(it.x + dx, 2), y: round(it.y + dy, 2) }), 'nudge')
  }

  // ---------- Text editing ----------
  startTextEdit(id, { point, selectAll = false } = {}) {
    const doc = this.doc
    const f = findItem(doc, id)
    if (!f || f.item.type !== 'text' || isLocked(doc, f.item)) return
    this.endTextEdit()
    if (this.mode.kind === 'pages' && f.kind === 'master') return
    const story = doc.stories[f.item.story]
    if (!story) return
    const el = h('div', { class: 'ls-edit', contenteditable: 'true', spellcheck: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Edit text frame' })
    storyToDom(doc, story, el)
    this.textEdit = { id, story: f.item.story, el, range: null, timer: 0 }
    this.view.append(el)
    el.addEventListener('pointerdown', (e) => e.stopPropagation())
    el.addEventListener('input', () => this.scheduleSync())
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.endTextEdit(); this.view.focus() }
      else if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) { e.preventDefault(); this.applyText({ b: 'bold', i: 'italic', u: 'underline' }[e.key.toLowerCase()]) }
      e.stopPropagation()
    })
    el.addEventListener('paste', (e) => {
      const files = [...(e.clipboardData?.files || [])]
      if (files.length) return
      e.preventDefault()
      const text = e.clipboardData.getData('text/plain').replace(/\r/g, '')
      text.split('\n').forEach((line, i) => { if (i) document.execCommand('insertParagraph'); if (line) document.execCommand('insertText', false, line) })
    })
    try { document.execCommand('styleWithCSS', false, true); document.execCommand('defaultParagraphSeparator', false, 'div') } catch { /* old browsers */ }
    this.sel = [id]
    this.positionEdit()
    el.focus({ preventScroll: true })
    const sel = getSelection()
    if (selectAll) { sel.selectAllChildren(el) } else {
      let placed = false
      if (point && document.caretRangeFromPoint) {
        const r = document.caretRangeFromPoint(point.x, point.y)
        if (r && el.contains(r.startContainer)) { sel.removeAllRanges(); sel.addRange(r); placed = true }
      }
      if (!placed) { const r = document.createRange(); r.selectNodeContents(el.lastElementChild || el); r.collapse(false); sel.removeAllRanges(); sel.addRange(r) }
    }
    this.requestRender()
    this.emit('edit')
    this.emit('select')
  }
  positionEdit() {
    const te = this.textEdit
    if (!te) return
    const f = findItem(this.doc, te.id)
    const r = f && this.rectOf(f.container)
    if (!r) { te.el.style.display = 'none'; return }
    const it = f.item, z = this.zoom
    const c = this.scr(r.x + it.x + it.w / 2, r.y + it.y + it.h / 2)
    const el = te.el
    el.style.display = ''
    el.style.width = `${it.w}px`; el.style.height = `${it.h}px`
    el.style.padding = `${it.inset || 0}px`
    el.style.columnCount = String(Math.max(1, it.cols || 1))
    el.style.columnGap = `${it.gap ?? 12}px`
    el.style.transform = `translate(${c.x - it.w / 2}px, ${c.y - it.h / 2}px) scale(${z}) rotate(${it.rot || 0}deg)`
    el.style.setProperty('--ls-z', String(z))
    el.style.background = it.fill || ''
  }
  scheduleSync() {
    const te = this.textEdit
    if (!te) return
    clearTimeout(te.timer)
    te.timer = setTimeout(() => this.syncEdit(), 220)
  }
  syncEdit() {
    const te = this.textEdit
    if (!te) return
    clearTimeout(te.timer)
    cmd.setStoryText(this.store, te.story, domToParas(this.doc, te.el))
  }
  endTextEdit(commit = true) {
    const te = this.textEdit
    if (!te) return
    if (commit) this.syncEdit()
    clearTimeout(te.timer)
    this.textEdit = null
    te.el.remove()
    this.requestRender()
    this.emit('edit')
  }
  /** Current text formatting for the toolbar: from the caret paragraph while editing, else the first paragraph of the selected frame's story. */
  textState() {
    const doc = this.doc
    const te = this.textEdit
    let p, cs = '', b = false, i = false, u = false
    if (te) {
      const divs = selectedParas(te.el)
      const d = divs[0] || te.el.children[0]
      let o = {}
      try { o = JSON.parse(d?.dataset.o || '{}') } catch { /* ignore */ }
      p = { ps: d?.dataset.ps || doc.styles.para[0].id, o, runs: [] }
      const sel = getSelection()
      const span = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)?.closest?.('[data-cs]')
      cs = span?.dataset.cs || ''
      try { b = document.queryCommandState('bold'); i = document.queryCommandState('italic'); u = document.queryCommandState('underline') } catch { /* ignore */ }
    } else {
      const it = this.selItems().find((x) => x.type === 'text')
      const first = it && doc.stories[it.story]?.paras[0]
      if (!first) return null
      p = first
      const runs = doc.stories[it.story].paras.flatMap((x) => x.runs)
      b = runs.length > 0 && runs.every((r) => r.b); i = runs.length > 0 && runs.every((r) => r.i); u = runs.length > 0 && runs.every((r) => r.u)
      cs = runs.every((r) => r.cs === runs[0].cs) ? runs[0].cs || '' : ''
    }
    const st = styleOf(doc, p, { t: '' })
    return { ps: p.ps, o: p.o || {}, cs, b, i, u, size: st.size, font: st.f.fam.id, weight: st.f.weight, color: st.color, lh: st.lh, tracking: st.tracking, align: paraProp(doc, p, 'align') || 'left', editing: !!te }
  }
  focusEdit() {
    const te = this.textEdit
    if (!te) return
    te.el.focus({ preventScroll: true })
    if (te.range) setCaret(te.el, te.range)
  }
  /** Run a rebuild-style paragraph edit on the selected paragraphs of the open editor. */
  editParas(fn) {
    const te = this.textEdit
    if (!te) return
    this.focusEdit()
    const divs = selectedParas(te.el)
    const caret = caretOf(te.el) || te.range
    let paras = domToParas(this.doc, te.el)
    if (paras.length !== te.el.children.length) { this.syncEdit(); storyToDom(this.doc, this.doc.stories[te.story], te.el); paras = domToParas(this.doc, te.el) }
    const idx = divs.map((d) => [...te.el.children].indexOf(d)).filter((i) => i >= 0)
    for (const i of idx.length ? idx : [0]) if (paras[i]) fn(paras[i])
    cmd.setStoryText(this.store, te.story, paras)
    storyToDom(this.doc, this.doc.stories[te.story], te.el)
    setCaret(te.el, caret)
    te.range = caret
    this.emit('format')
  }
  /** Apply a text command from the toolbar. ops: bold, italic, underline, color, charStyle, paraStyle, prop, clear. */
  applyText(op, value, extra) {
    const te = this.textEdit
    if (te) {
      this.focusEdit()
      if (op === 'bold' || op === 'italic' || op === 'underline') { document.execCommand(op); this.scheduleSync(); this.emit('format'); return }
      if (op === 'color') {
        const sel = getSelection()
        if (sel.rangeCount && !sel.isCollapsed) { document.execCommand('foreColor', false, value); this.scheduleSync(); this.emit('format') } else this.editParas((p) => { p.o = { ...p.o, color: value } })
        return
      }
      if (op === 'charStyle') { applyCharStyle(te.el, value || ''); this.scheduleSync(); this.emit('format'); return }
      if (op === 'paraStyle') { this.editParas((p) => { p.ps = value; p.o = {} }); return }
      if (op === 'prop') { this.editParas((p) => { p.o = { ...p.o, [value]: extra } }); return }
      if (op === 'clear') { this.editParas((p) => { p.o = {} }); return }
      return
    }
    const frames = this.selItems().filter((x) => x.type === 'text')
    const sids = [...new Set(frames.map((f) => f.story))]
    for (const sid of sids) {
      if (op === 'bold') cmd.toggleStoryFlag(this.store, sid, 'b')
      else if (op === 'italic') cmd.toggleStoryFlag(this.store, sid, 'i')
      else if (op === 'underline') cmd.toggleStoryFlag(this.store, sid, 'u')
      else if (op === 'color') cmd.setStoryParas(this.store, sid, (p) => { p.o = { ...p.o, color: value }; for (const r of p.runs) delete r.c }, 'color')
      else if (op === 'charStyle') this.store.exec('Character style', (d) => { for (const p of d.stories[sid].paras) for (const r of p.runs) { if (value) r.cs = value; else delete r.cs } })
      else if (op === 'paraStyle') cmd.setStoryParas(this.store, sid, (p) => { p.ps = value; p.o = {} })
      else if (op === 'prop') cmd.setStoryParas(this.store, sid, (p) => { p.o = { ...p.o, [value]: extra } }, `prop:${value}`)
      else if (op === 'clear') cmd.setStoryParas(this.store, sid, (p) => { p.o = {} })
    }
    this.emit('format')
  }

  // ---------- Keyboard ----------
  handleKey(e) {
    if (this.textEdit) return false
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    const step = e.shiftKey ? 10 : 1
    if (mod) {
      if (k === 'z') { e.shiftKey ? this.store.redo() : this.store.undo(); return true }
      if (k === 'y') { this.store.redo(); return true }
      if (k === 'd') { this.duplicate(); return true }
      if (k === 'g') { const ids = this.unlockedIds(); if (e.shiftKey) cmd.ungroupItems(this.store, ids); else cmd.groupItems(this.store, ids); return true }
      if (k === 'a') { this.selectAll(); return true }
      if (k === '0') { this.fitPage(); return true }
      if (k === '1') { this.setView(1, this.px, this.py); this.gotoPage(this.currentPageId()); return true }
      if (k === '=' || k === '+') { this.zoomAt(1.25); return true }
      if (k === '-') { this.zoomAt(0.8); return true }
      if (k === ']') { cmd.reorder(this.store, this.unlockedIds(), e.shiftKey ? 'front' : 'forward'); return true }
      if (k === '[') { cmd.reorder(this.store, this.unlockedIds(), e.shiftKey ? 'back' : 'backward'); return true }
      return false
    }
    if (k === 'delete' || k === 'backspace') { this.remove(); return true }
    if (k.startsWith('arrow')) {
      if (!this.sel.length) return false
      this.nudge(k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0)
      return true
    }
    if (k === 'escape') {
      if (this.threading) { this.threading = null; this.updateCursor(); this.emit('thread') } else if (this.drag) { this.store.cancel(); this.drag = null } else if (this.crop) { this.crop = false; this.emit('crop'); this.requestRender() } else if (this.tool !== 'select') this.setTool('select')
      else this.select([])
      return true
    }
    if (k === 'enter' || k === 'f2') {
      const it = this.selItems()[0]
      if (it?.type === 'text') { this.startTextEdit(it.id, { selectAll: e.key === 'F2' }); return true }
      if (it?.type === 'image') { this.emit('placeImage', it.id); return true }
      return false
    }
    if (k === 'pageup' || k === 'pagedown') {
      const i = clamp(this.currentIndex() + (k === 'pagedown' ? 1 : -1), 0, this.doc.pages.length - 1)
      if (this.mode.kind === 'pages') this.gotoPage(this.doc.pages[i].id)
      return true
    }
    if (k === ' ') { if (!this.space) { this.space = true; this.updateCursor() } return true }
    const tools = { v: 'select', t: 'text', i: 'image', r: 'rect', o: 'ellipse', e: 'ellipse', l: 'line', h: 'hand' }
    if (tools[k] && !e.altKey) { this.setTool(tools[k]); return true }
    if (k === '+' || k === '=') { this.zoomAt(1.25); return true }
    if (k === '-') { this.zoomAt(0.8); return true }
    return false
  }
  handleKeyUp(e) { if (e.key === ' ' && this.space) { this.space = false; this.updateCursor() } }
}
