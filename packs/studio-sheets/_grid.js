// Virtualized canvas grid: drawing, scrolling, selection, headers, fill handle, resizing and keyboard navigation.
import { h } from '../../lib/ui.js'
import { MAXR, MAXC, ck, colName, rangeContains } from './_a1.js'
import { Axis, fontPx } from './_axis.js'
import { formatValue } from './_fmt.js'
import { cfAt, rulesOf, textOn } from './_cf.js'
import { DEFAULT_COL_W, DEFAULT_ROW_H } from './_model.js'
import { Editor } from './_edit.js'
import { mergeAt, expandToMerges } from './_ops.js'

export const HW = 50 // row header width
export const HH = 26 // column header height
const PAD = 5
const HANDLE = 7
const FIT_ROWS = 100

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const box = (g, x, y, w, h, r) => (g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h))
const sameRect = (a, b) => a.r1 === b.r1 && a.c1 === b.c1 && a.r2 === b.r2 && a.c2 === b.c2

export class GridView {
  constructor(host, model, cb, fbar) {
    this.model = model
    this.cb = cb
    this.zoom = 1
    this.sh = null
    this.act = { r: 0, c: 0 }
    this.anchor = { r: 0, c: 0 }
    this.head = { r: 0, c: 0 }
    this.sel = { r1: 0, c1: 0, r2: 0, c2: 0 }
    this.refBoxes = []
    this.marquee = null
    this.fillPreview = null
    this.states = new Map()
    this.drag = null
    this.touchSelect = false
    this.showHeaders = true
    this._raf = 0
    this.colors = null

    this.root = host
    this.sc = h('div', { class: 'sx-sc', tabindex: 0, role: 'grid', 'aria-label': 'Spreadsheet grid', 'aria-multiselectable': 'true' })
    this.cv = h('canvas', { class: 'sx-cv' })
    this.ct = h('div', { class: 'sx-ct' }, h('div', { class: 'sx-st' }, this.cv))
    this.sc.append(this.ct)
    this.ov = h('div', { class: 'sx-ov' })
    this.live = h('div', { class: 'sr-only', 'aria-live': 'polite' })
    host.append(this.sc, this.ov, this.live)
    this.editor = new Editor(this, fbar)
    this.mctx = document.createElement('canvas').getContext('2d')

    this.sc.addEventListener('scroll', () => { this.growIfNeeded(); this.invalidate(); this.editor.position(); this.cb.onScroll?.() }, { passive: true })
    this.sc.addEventListener('pointerdown', (e) => this.pointerDown(e))
    this.sc.addEventListener('pointermove', (e) => this.pointerMove(e))
    this.sc.addEventListener('pointerup', (e) => this.pointerUp(e))
    this.sc.addEventListener('pointercancel', (e) => this.pointerUp(e, true))
    this.sc.addEventListener('dblclick', (e) => this.dblClick(e))
    this.sc.addEventListener('contextmenu', (e) => this.contextMenu(e))
    this.sc.addEventListener('keydown', (e) => this.keyDown(e))
    this.sc.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); this.cb.onZoom?.(e.deltaY < 0 ? 0.1 : -0.1) } }, { passive: false })
    this.ro = new ResizeObserver(() => { this.invalidate(); this.editor.position() })
    this.ro.observe(this.sc)
    this.mo = new MutationObserver(() => { this.colors = null; this.invalidate() })
    this.mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
    this.cssFont = null
  }
  destroy() { this.ro.disconnect(); this.mo.disconnect(); cancelAnimationFrame(this._raf); clearInterval(this._dragTimer) }
  focus() { this.sc.focus({ preventScroll: true }) }
  get fontFamily() { return this.cssFont ??= (getComputedStyle(this.root).getPropertyValue('--font').trim() || 'system-ui, sans-serif') }

  // ---------- sheet and view state ----------
  setSheet(sh, restore = true) {
    if (this.sh) this.saveState()
    this.sh = sh
    const st = this.states.get(sh.id)
    this._ax = null
    if (st && restore) {
      this.act = { ...st.act }; this.anchor = { ...st.anchor }; this.head = { ...st.head }; this.sel = { ...st.sel }
      this.rows = st.rows; this.cols = st.cols
    } else {
      this.act = { r: 0, c: 0 }; this.anchor = { r: 0, c: 0 }; this.head = { r: 0, c: 0 }; this.sel = { r1: 0, c1: 0, r2: 0, c2: 0 }
      const ex = this.model.extent(sh.id)
      this.rows = Math.max(FIT_ROWS, ex.r + 40); this.cols = Math.max(30, ex.c + 8)
    }
    this.sizeContent()
    this.sc.scrollLeft = st?.sx || 0
    this.sc.scrollTop = st?.sy || 0
    this.invalidate()
  }
  saveState() {
    if (!this.sh) return
    this.states.set(this.sh.id, { act: { ...this.act }, anchor: { ...this.anchor }, head: { ...this.head }, sel: { ...this.sel }, rows: this.rows, cols: this.cols, sx: this.sc.scrollLeft, sy: this.sc.scrollTop })
  }
  axes() {
    const sh = this.sh
    if (this._ax && this._axVer === this.model.layoutVer && this._axSheet === sh) return this._ax
    const col = new Axis(DEFAULT_COL_W), row = new Axis(DEFAULT_ROW_H)
    for (const [k, v] of Object.entries(sh.colW)) col.set(+k, v)
    for (const k of Object.keys(sh.hideC)) col.set(+k, 0)
    for (const [k, v] of Object.entries(sh.rowH)) row.set(+k, v)
    for (const k of Object.keys(sh.hideR)) row.set(+k, 0)
    for (const k of Object.keys(sh.fHide)) row.set(+k, 0)
    col.build(); row.build()
    this._ax = { col, row }; this._axVer = this.model.layoutVer; this._axSheet = sh
    return this._ax
  }
  sizeContent() {
    const ax = this.axes(), Z = this.zoom
    const w = HW + ax.col.offset(this.cols) * Z, hh = HH + ax.row.offset(this.rows) * Z
    this.ct.style.width = w + 'px'
    this.ct.style.height = hh + 'px'
  }
  growIfNeeded() {
    const sc = this.sc
    let grew = false
    if (sc.scrollTop + sc.clientHeight > sc.scrollHeight - 160 && this.rows < MAXR) { this.rows = Math.min(MAXR, this.rows + 100); grew = true }
    if (sc.scrollLeft + sc.clientWidth > sc.scrollWidth - 160 && this.cols < MAXC) { this.cols = Math.min(MAXC, this.cols + 10); grew = true }
    if (grew) this.sizeContent()
  }
  ensureExtent(r, c) {
    let grew = false
    if (r + 2 > this.rows) { this.rows = Math.min(MAXR, r + 40); grew = true }
    if (c + 2 > this.cols) { this.cols = Math.min(MAXC, c + 8); grew = true }
    if (grew) this.sizeContent()
  }
  relayout() { this._ax = null; this.sizeContent(); this.invalidate(); this.editor.position() }
  setZoom(z) {
    const old = this.zoom
    const sx = this.sc.scrollLeft / old, sy = this.sc.scrollTop / old
    this.zoom = clamp(Math.round(z * 100) / 100, 0.4, 3)
    this.sizeContent()
    this.sc.scrollLeft = sx * this.zoom; this.sc.scrollTop = sy * this.zoom
    this.invalidate(); this.editor.position()
  }

  // ---------- geometry ----------
  frozen() { const f = this.sh.freeze; return { r: f.r | 0, c: f.c | 0 } }
  xOf(c) {
    const ax = this.axes(), Z = this.zoom, fc = this.frozen().c
    return c < fc ? HW + ax.col.offset(c) * Z : HW + (ax.col.offset(fc) * Z) + (ax.col.offset(c) - ax.col.offset(fc)) * Z - this.sc.scrollLeft
  }
  yOf(r) {
    const ax = this.axes(), Z = this.zoom, fr = this.frozen().r
    return r < fr ? HH + ax.row.offset(r) * Z : HH + (ax.row.offset(fr) * Z) + (ax.row.offset(r) - ax.row.offset(fr)) * Z - this.sc.scrollTop
  }
  wOf(c) { return this.axes().col.size(c) * this.zoom }
  hOf(r) { return this.axes().row.size(r) * this.zoom }
  /** Rect of a cell in grid-viewport coordinates (merged cells cover their whole area). */
  cellRect(r, c, merged = false) {
    const m = merged ? mergeAt(this.sh, r, c) : null
    const r1 = m ? m.r1 : r, c1 = m ? m.c1 : c, r2 = m ? m.r2 : r, c2 = m ? m.c2 : c
    const x = this.xOf(c1), y = this.yOf(r1)
    const w = this.xOf(c2 + 1) - x, hh = this.yOf(r2 + 1) - y
    if (x + w < HW || y + hh < HH || x > this.sc.clientWidth || y > this.sc.clientHeight) return null
    return { x, y, w, h: hh }
  }
  hit(px, py) {
    const ax = this.axes(), Z = this.zoom, f = this.frozen(), sc = this.sc
    const fx = ax.col.offset(f.c) * Z, fy = ax.row.offset(f.r) * Z
    const c = px < HW + fx ? ax.col.at(Math.max(0, px - HW) / Z, MAXC - 1) : ax.col.at(ax.col.offset(f.c) + (px - HW - fx + sc.scrollLeft) / Z, MAXC - 1)
    const r = py < HH + fy ? ax.row.at(Math.max(0, py - HH) / Z, MAXR - 1) : ax.row.at(ax.row.offset(f.r) + (py - HH - fy + sc.scrollTop) / Z, MAXR - 1)
    return { r: clamp(r, 0, MAXR - 1), c: clamp(c, 0, MAXC - 1) }
  }
  headerEdge(px, py) {
    if (py < HH && px >= HW) {
      const { c } = this.hit(px, py)
      if (Math.abs(px - this.xOf(c + 1)) <= 4) return { kind: 'col', idx: c }
      if (c > 0 && Math.abs(px - this.xOf(c)) <= 4) { let k = c - 1; while (k > 0 && this.axes().col.size(k) === 0) k--; return { kind: 'col', idx: k } }
    }
    if (px < HW && py >= HH) {
      const { r } = this.hit(px, py)
      if (Math.abs(py - this.yOf(r + 1)) <= 4) return { kind: 'row', idx: r }
      if (r > 0 && Math.abs(py - this.yOf(r)) <= 4) { let k = r - 1; while (k > 0 && this.axes().row.size(k) === 0) k--; return { kind: 'row', idx: k } }
    }
    return null
  }
  measure(text, st = {}) {
    const g = this.mctx
    g.font = `${st.i ? 'italic ' : ''}${st.b ? '600 ' : ''}${fontPx(st) * this.zoom}px ${this.fontFamily}`
    return g.measureText(text).width
  }
  scrollIntoView(r, c) {
    const sc = this.sc, ax = this.axes(), Z = this.zoom, f = this.frozen()
    this.ensureExtent(r, c)
    const vw = sc.clientWidth - HW, vh = sc.clientHeight - HH
    if (c >= f.c) {
      const fx = ax.col.offset(f.c) * Z, left = (ax.col.offset(c) - ax.col.offset(f.c)) * Z, right = (ax.col.offset(c + 1) - ax.col.offset(f.c)) * Z
      if (left < sc.scrollLeft) sc.scrollLeft = left
      else if (right > sc.scrollLeft + vw - fx) sc.scrollLeft = right - (vw - fx)
    }
    if (r >= f.r) {
      const fy = ax.row.offset(f.r) * Z, top = (ax.row.offset(r) - ax.row.offset(f.r)) * Z, bottom = (ax.row.offset(r + 1) - ax.row.offset(f.r)) * Z
      if (top < sc.scrollTop) sc.scrollTop = top
      else if (bottom > sc.scrollTop + vh - fy) sc.scrollTop = bottom - (vh - fy)
    }
  }

  // ---------- selection ----------
  setSelection(sel, act, { quiet = false, scroll = true } = {}) {
    let g = { r1: Math.min(sel.r1, sel.r2), c1: Math.min(sel.c1, sel.c2), r2: Math.max(sel.r1, sel.r2), c2: Math.max(sel.c1, sel.c2) }
    g = expandToMerges(this.sh, g)
    this.sel = g
    if (act) {
      const m = mergeAt(this.sh, act.r, act.c)
      this.act = m ? { r: m.r1, c: m.c1 } : { r: act.r, c: act.c }
    }
    if (scroll) {
      // whole rows and columns scroll to the active cell, not to the far end of the sheet
      const hr = g.r1 === 0 && g.r2 >= MAXR - 1 ? this.act.r : this.head.r
      const hc = g.c1 === 0 && g.c2 >= MAXC - 1 ? this.act.c : this.head.c
      this.scrollIntoView(hr, hc)
    }
    this.invalidate()
    if (!quiet) this.cb.onSelect?.()
  }
  selectCell(r, c, extend = false) {
    r = clamp(r, 0, MAXR - 1); c = clamp(c, 0, MAXC - 1)
    if (extend) {
      this.head = { r, c }
      this.setSelection({ r1: this.anchor.r, c1: this.anchor.c, r2: r, c2: c }, this.act)
    } else {
      this.anchor = { r, c }; this.head = { r, c }
      this.setSelection({ r1: r, c1: c, r2: r, c2: c }, { r, c })
    }
  }
  selectRect(g, act) {
    this.anchor = { r: g.r1, c: g.c1 }; this.head = { r: g.r2, c: g.c2 }
    this.setSelection(g, act || { r: g.r1, c: g.c1 })
  }
  setRefBoxes(boxes) { this.refBoxes = boxes; this.invalidate() }
  setMarquee(g) { this.marquee = g; this.invalidate() }
  announce(text) { this.live.textContent = text }

  // ---------- pointer ----------
  local(e) { const b = this.sc.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top } }
  overScrollbar(e, x, y) { return e.target === this.sc && (x > this.sc.clientWidth || y > this.sc.clientHeight) }
  /** Screen rect of the dropdown arrow when the active cell has a list rule (viewport coordinates). */
  dropdownRect() {
    if (!this.cb.hasDropdown || !this.cb.hasDropdown(this.act.r, this.act.c) || this.editor.active) return null
    const rc = this.cellRect(this.act.r, this.act.c, true)
    return rc ? { x: rc.x + rc.w - 19, y: rc.y + 3, w: 17, h: Math.max(10, rc.h - 6), cell: rc } : null
  }
  handleRect() {
    const g = this.sel
    const x = this.xOf(g.c2 + 1), y = this.yOf(g.r2 + 1)
    return { x: x - HANDLE / 2 - 1, y: y - HANDLE / 2 - 1, w: HANDLE + 4, h: HANDLE + 4 }
  }
  filterButtonAt(px, py) {
    const f = this.sh.filter
    if (!f) return null
    const { r, c } = this.hit(px, py)
    if (r !== f.r1 || c < f.c1 || c > f.c2) return null
    const rect = this.cellRect(r, c)
    if (!rect) return null
    return px >= rect.x + rect.w - 20 && px <= rect.x + rect.w - 2 ? { c, rect } : null
  }
  pointerDown(e) {
    const { x, y } = this.local(e)
    if (this.overScrollbar(e, x, y) || e.button === 2) return
    if (!this.editor.active) this.focus()
    const touch = e.pointerType === 'touch'
    this.px = { x, y, id: e.pointerId, touch, moved: false }
    const ed = this.editor
    // pointing at cells while editing a formula
    if (x >= HW && y >= HH && ed.active && ed.canPoint()) {
      e.preventDefault()
      const { r, c } = this.hit(x, y)
      const anchor = e.shiftKey && ed.pt && ed.pp ? ed.pp.anchor : { r, c }
      ed.pointCells(anchor, { r, c })
      ed.refocus()
      this.drag = { type: 'point' }
      this.sc.setPointerCapture(e.pointerId)
      return
    }
    if (ed.active) { if (ed.commit() === false) { e.preventDefault(); return } }
    if (touch && !this.touchSelect) { this.drag = { type: 'tap' }; return }
    this.sc.setPointerCapture(e.pointerId)
    const edge = this.headerEdge(x, y)
    if (edge) { this.drag = { type: 'resize', ...edge, start: edge.kind === 'col' ? x : y, size0: edge.kind === 'col' ? this.axes().col.size(edge.idx) : this.axes().row.size(edge.idx) }; return }
    if (x < HW && y < HH) { this.selectRect({ r1: 0, c1: 0, r2: MAXR - 1, c2: MAXC - 1 }, { r: 0, c: 0 }); this.drag = null; return }
    if (y < HH) {
      const { c } = this.hit(x, y)
      if (e.shiftKey) this.setSelection({ r1: 0, c1: this.anchor.c, r2: MAXR - 1, c2: c }, this.act)
      else { this.anchor = { r: 0, c }; this.head = { r: MAXR - 1, c }; this.setSelection({ r1: 0, c1: c, r2: MAXR - 1, c2: c }, { r: 0, c }) }
      this.drag = { type: 'cols' }
      return
    }
    if (x < HW) {
      const { r } = this.hit(x, y)
      if (e.shiftKey) this.setSelection({ r1: this.anchor.r, c1: 0, r2: r, c2: MAXC - 1 }, this.act)
      else { this.anchor = { r, c: 0 }; this.head = { r, c: MAXC - 1 }; this.setSelection({ r1: r, c1: 0, r2: r, c2: MAXC - 1 }, { r, c: 0 }) }
      this.drag = { type: 'rows' }
      return
    }
    const fb = this.filterButtonAt(x, y)
    if (fb) { e.preventDefault(); this.drag = null; this.cb.onFilterClick?.(fb.c, fb.rect); return }
    const dd = this.dropdownRect()
    if (dd && this.sel.r1 === this.sel.r2 && this.sel.c1 === this.sel.c2 && x >= dd.x && x <= dd.x + dd.w && y >= dd.y && y <= dd.y + dd.h) { e.preventDefault(); this.drag = null; this.cb.onDropdown?.(this.act.r, this.act.c, dd.cell); return }
    const hr = this.handleRect()
    if (x >= hr.x && x <= hr.x + hr.w && y >= hr.y && y <= hr.y + hr.h && !touch) { this.drag = { type: 'fill', src: { ...this.sel } }; return }
    const { r, c } = this.hit(x, y)
    const url = (e.ctrlKey || e.metaKey) && this.model.valueAt(this.sh.id, r, c)
    if (typeof url === 'string' && /^https?:\/\/\S+$/i.test(url)) { window.open(url, '_blank', 'noopener'); return }
    this.selectCell(r, c, e.shiftKey)
    this.drag = { type: 'cells' }
    this.startAutoScroll()
  }
  startAutoScroll() {
    clearInterval(this._dragTimer)
    this._dragTimer = setInterval(() => {
      if (!this.drag || !this.last) return
      const { x, y } = this.last, sc = this.sc
      const dx = x > sc.clientWidth - 24 ? 24 : x < HW + 24 ? -24 : 0, dy = y > sc.clientHeight - 24 ? 24 : y < HH + 24 ? -24 : 0
      if (dx || dy) { sc.scrollLeft += dx; sc.scrollTop += dy; this.dragTo(x, y, false) }
    }, 40)
  }
  pointerMove(e) {
    const { x, y } = this.local(e)
    this.last = { x, y }
    if (this.px && Math.hypot(x - this.px.x, y - this.px.y) > 6) this.px.moved = true
    if (!this.drag) { this.updateCursor(x, y, e); return }
    if (this.drag.type === 'tap') return
    this.dragTo(x, y, true)
  }
  dragTo(x, y) {
    const d = this.drag
    if (!d) return
    if (d.type === 'cells') {
      const cx = clamp(x, HW + 1, this.sc.clientWidth - 1), cy = clamp(y, HH + 1, this.sc.clientHeight - 1)
      const { r, c } = this.hit(cx, cy)
      if (r !== this.head.r || c !== this.head.c) this.selectCell(r, c, true)
    } else if (d.type === 'cols') {
      const { c } = this.hit(clamp(x, HW + 1, this.sc.clientWidth - 1), HH + 1)
      this.head = { r: MAXR - 1, c }
      this.setSelection({ r1: 0, c1: this.anchor.c, r2: MAXR - 1, c2: c }, this.act)
    } else if (d.type === 'rows') {
      const { r } = this.hit(HW + 1, clamp(y, HH + 1, this.sc.clientHeight - 1))
      this.head = { r, c: MAXC - 1 }
      this.setSelection({ r1: this.anchor.r, c1: 0, r2: r, c2: MAXC - 1 }, this.act)
    } else if (d.type === 'resize') {
      const delta = ((d.kind === 'col' ? x : y) - d.start) / this.zoom
      const size = Math.max(d.kind === 'col' ? 20 : 12, Math.round(d.size0 + delta))
      d.size = size
      const axis = this.axes()[d.kind]
      axis.set(d.idx, size); axis.build()
      this.sizeContent(); this.invalidate()
      this.sc.style.cursor = d.kind === 'col' ? 'col-resize' : 'row-resize'
    } else if (d.type === 'fill') {
      const { r, c } = this.hit(clamp(x, HW + 1, this.sc.clientWidth - 1), clamp(y, HH + 1, this.sc.clientHeight - 1))
      const s = d.src
      let end = { ...s }
      const dr = r > s.r2 ? r - s.r2 : r < s.r1 ? s.r1 - r : 0, dc = c > s.c2 ? c - s.c2 : c < s.c1 ? s.c1 - c : 0
      if (dr >= dc && dr > 0) { if (r > s.r2) end.r2 = r; else end.r1 = r } else if (dc > 0) { if (c > s.c2) end.c2 = c; else end.c1 = c }
      d.end = end
      this.fillPreview = end
      this.invalidate()
    } else if (d.type === 'point') {
      const ed = this.editor
      const { r, c } = this.hit(clamp(x, HW + 1, this.sc.clientWidth - 1), clamp(y, HH + 1, this.sc.clientHeight - 1))
      if (ed.pp && (r !== ed.pp.head.r || c !== ed.pp.head.c)) ed.pointCells(ed.pp.anchor, { r, c })
    }
  }
  pointerUp(e, cancelled = false) {
    clearInterval(this._dragTimer)
    const d = this.drag
    this.drag = null
    try { this.sc.releasePointerCapture(e.pointerId) } catch { /* not captured */ }
    const px = this.px
    this.px = null
    if (!d) return
    if (d.type === 'tap' && !cancelled && px && !px.moved) {
      const { x, y } = this.local(e)
      if (x >= HW && y >= HH) {
        const fb = this.filterButtonAt(x, y)
        if (fb) { this.cb.onFilterClick?.(fb.c, fb.rect); return }
        const { r, c } = this.hit(x, y)
        const again = r === this.act.r && c === this.act.c && this.sel.r1 === this.sel.r2 && this.sel.c1 === this.sel.c2
        this.selectCell(r, c)
        if (again) this.startEdit({ mode: 'edit' })
      } else if (y < HH && x >= HW) { const { c } = this.hit(x, y); this.selectRect({ r1: 0, c1: c, r2: MAXR - 1, c2: c }, { r: 0, c }) } else if (x < HW && y >= HH) { const { r } = this.hit(x, y); this.selectRect({ r1: r, c1: 0, r2: r, c2: MAXC - 1 }, { r, c: 0 }) }
      return
    }
    if (d.type === 'resize') {
      if (!cancelled && d.size !== undefined) this.cb.onResize?.(d.kind, d.idx, d.size)
      else { this._ax = null; this.relayout() }
      this.updateCursor(this.last?.x ?? 0, this.last?.y ?? 0)
    } else if (d.type === 'fill') {
      this.fillPreview = null
      if (!cancelled && d.end && !sameRect(d.end, d.src)) { this.cb.onFill?.(d.src, d.end); this.selectRect(d.end, { r: d.src.r1, c: d.src.c1 }) }
      this.invalidate()
    } else if (d.type === 'point') this.editor.refocus()
  }
  updateCursor(x, y) {
    let cur = ''
    const edge = x >= 0 && y >= 0 && this.headerEdge(x, y)
    if (edge) cur = edge.kind === 'col' ? 'col-resize' : 'row-resize'
    else if (x >= HW && y >= HH) {
      const hr = this.handleRect()
      if (x >= hr.x && x <= hr.x + hr.w && y >= hr.y && y <= hr.y + hr.h) cur = 'crosshair'
      else if (this.filterButtonAt(x, y)) cur = 'pointer'
      else cur = 'cell'
    } else if (x < HW || y < HH) cur = 'default'
    if (this.sc.style.cursor !== cur) this.sc.style.cursor = cur
  }
  dblClick(e) {
    const { x, y } = this.local(e)
    if (this.overScrollbar(e, x, y)) return
    const edge = this.headerEdge(x, y)
    if (edge) { this.cb.onAutofit?.(edge.kind, edge.idx); return }
    if (x >= HW && y >= HH) {
      const fb = this.filterButtonAt(x, y)
      if (fb) return
      const hr = this.handleRect()
      if (x >= hr.x && x <= hr.x + hr.w && y >= hr.y && y <= hr.y + hr.h) { this.cb.onFillDouble?.({ ...this.sel }); return }
      const { r, c } = this.hit(x, y)
      this.selectCell(r, c)
      this.startEdit({ mode: 'edit' })
    }
  }
  contextMenu(e) {
    const { x, y } = this.local(e)
    if (this.overScrollbar(e, x, y)) return
    e.preventDefault()
    this.focus()
    const { r, c } = this.hit(x, y)
    if (x < HW && y >= HH) { if (r < this.sel.r1 || r > this.sel.r2 || this.sel.c1 !== 0) this.selectRect({ r1: r, c1: 0, r2: r, c2: MAXC - 1 }, { r, c: 0 }) } else if (y < HH && x >= HW) { if (c < this.sel.c1 || c > this.sel.c2 || this.sel.r1 !== 0) this.selectRect({ r1: 0, c1: c, r2: MAXR - 1, c2: c }, { r: 0, c }) } else if (!rangeContains(this.sel, r, c)) this.selectCell(r, c)
    this.cb.onContext?.(e, { r, c, header: x < HW ? 'row' : y < HH ? 'col' : null })
  }

  // ---------- editing ----------
  startEdit(opts = {}) {
    const { r, c } = this.act
    if (this.cb.canEdit && !this.cb.canEdit(r, c)) return
    this.scrollIntoView(r, c)
    this.editor.start(r, c, opts)
  }
  get editing() { return this.editor.active }

  // ---------- keyboard ----------
  moveBy(dr, dc, extend, jump) {
    const ax = this.axes()
    const from = extend ? this.head : this.act
    let r = from.r, c = from.c
    const sh = this.sh
    if (!extend) { const m = mergeAt(sh, r, c); if (m) { if (dr > 0) r = m.r2; if (dc > 0) c = m.c2 } }
    if (jump) {
      const filled = (rr, cc) => this.model.valueAt(sh.id, rr, cc) !== null
      const ex = this.model.extent(sh.id)
      const lim = { r: Math.max(ex.r, this.rows - 1), c: Math.max(ex.c, this.cols - 1) }
      let nr = r + dr, nc = c + dc
      if (nr < 0 || nc < 0 || nr > lim.r || nc > lim.c) { r = clamp(nr, 0, lim.r); c = clamp(nc, 0, lim.c) } else if (filled(r, c) && filled(nr, nc)) {
        while (nr + dr >= 0 && nc + dc >= 0 && nr + dr <= lim.r && nc + dc <= lim.c && filled(nr + dr, nc + dc)) { nr += dr; nc += dc }
        r = nr; c = nc
      } else {
        while (nr >= 0 && nc >= 0 && nr <= lim.r && nc <= lim.c && !filled(nr, nc)) { nr += dr; nc += dc }
        r = clamp(nr, 0, lim.r); c = clamp(nc, 0, lim.c)
      }
    } else {
      if (dr) r = ax.row.step(r, dr, MAXR); if (dc) c = ax.col.step(c, dc, MAXC)
    }
    this.selectCell(r, c, extend)
  }
  /** Move within a multi-cell selection (Enter/Tab); returns false when the selection is a single cell. */
  moveInSel(dr, dc) {
    const g = this.sel
    if (g.r1 === g.r2 && g.c1 === g.c2) return false
    let { r, c } = this.act
    if (dr) { r += dr; if (r > g.r2) { r = g.r1; c = c + 1 > g.c2 ? g.c1 : c + 1 } else if (r < g.r1) { r = g.r2; c = c - 1 < g.c1 ? g.c2 : c - 1 } } else if (dc) { c += dc; if (c > g.c2) { c = g.c1; r = r + 1 > g.r2 ? g.r1 : r + 1 } else if (c < g.c1) { c = g.c2; r = r - 1 < g.r1 ? g.r2 : r - 1 } }
    this.act = { r, c }; this.scrollIntoView(r, c); this.invalidate(); this.cb.onSelect?.()
    return true
  }
  keyDown(e) {
    if (this.editor.active) return
    if (this.cb.onKey?.(e)) { e.preventDefault(); return }
    const ctrl = e.ctrlKey || e.metaKey
    const k = e.key
    const page = Math.max(1, Math.floor((this.sc.clientHeight - HH) / (DEFAULT_ROW_H * this.zoom)) - 1)
    if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault()
      const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k]
      this.moveBy(d[0], d[1], e.shiftKey, ctrl)
    } else if (k === 'Tab') {
      e.preventDefault()
      if (!this.moveInSel(0, e.shiftKey ? -1 : 1)) this.moveBy(0, e.shiftKey ? -1 : 1, false, false)
    } else if (k === 'Enter') {
      e.preventDefault()
      if (e.altKey) return
      if (!this.moveInSel(e.shiftKey ? -1 : 1, 0)) this.moveBy(e.shiftKey ? -1 : 1, 0, false, false)
    } else if (k === 'PageDown' || k === 'PageUp') {
      e.preventDefault()
      const d = (k === 'PageDown' ? 1 : -1) * page
      if (e.altKey) this.moveBy(0, d, e.shiftKey, false)
      else this.selectCell((e.shiftKey ? this.head.r : this.act.r) + d, e.shiftKey ? this.head.c : this.act.c, e.shiftKey)
    } else if (k === 'Home') {
      e.preventDefault()
      if (ctrl) this.selectCell(0, 0, e.shiftKey); else this.selectCell(this.act.r, 0, e.shiftKey)
    } else if (k === 'End' && ctrl) {
      e.preventDefault()
      const u = this.model.usedRange(this.sh)
      this.selectCell(u ? u.r2 : 0, u ? u.c2 : 0, e.shiftKey)
    } else if (k === 'F2') {
      e.preventDefault(); this.startEdit({ mode: 'edit' })
    } else if (k === 'Process' || k === 'Unidentified' || e.isComposing || e.keyCode === 229) {
      this.startEdit({ text: '', mode: 'enter' }) // IME and soft keyboards: the first characters arrive in the editor
    } else if (k.length === 1 && !ctrl && !e.altKey) {
      e.preventDefault()
      this.startEdit({ text: k, mode: 'enter' })
    } else if (k === 'Backspace' && !ctrl) {
      e.preventDefault(); this.cb.onClear?.()
    } else if (k === 'Delete') {
      e.preventDefault(); this.cb.onClear?.()
    } else if (k === 'Escape') this.cb.onEscape?.()
  }

  // ---------- drawing ----------
  invalidate() {
    if (this._raf) return
    this._raf = requestAnimationFrame(() => { this._raf = 0; try { this.draw() } catch (err) { console.error(err) } })
  }
  palette() {
    if (this.colors) return this.colors
    const cs = getComputedStyle(this.root)
    const v = (n, d) => cs.getPropertyValue(n).trim() || d
    const dark = document.documentElement.dataset.theme === 'dark'
    this.colors = {
      bg: v('--surface', '#fff'), head: v('--surface-2', '#f4f4f7'), headSel: v('--accent-soft', '#efedff'), line: dark ? 'rgba(255,255,255,.09)' : '#e4e4ec',
      lineStrong: v('--border-strong', '#cfcfd8'), text: v('--text', '#0b0b10'), muted: v('--muted', '#676774'), accent: v('--accent', '#5b4cf0'), dark,
      tint: dark ? 'rgba(139,125,255,.16)' : 'rgba(91,76,240,.10)', surface: v('--surface', '#fff'),
    }
    return this.colors
  }
  spans(axis, start, limit, originPx, Z, scrollOffset, lastIdx) {
    const out = []
    let i = start, pos = originPx + (axis.offset(start) - scrollOffset) * Z
    while (pos < limit && i <= lastIdx) {
      const s = axis.size(i) * Z
      if (s > 0) out.push({ i, p: pos, s })
      pos += s
      i++
    }
    return out
  }
  draw() {
    const sh = this.sh
    if (!sh) return
    const sc = this.sc, W = sc.clientWidth, H = sc.clientHeight
    if (!W || !H) return
    const dpr = window.devicePixelRatio || 1
    const cv = this.cv
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr)
      cv.style.width = W + 'px'; cv.style.height = H + 'px'
    }
    const g = cv.getContext('2d')
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const col = this.palette()
    g.fillStyle = col.bg
    g.fillRect(0, 0, W, H)
    const ax = this.axes(), Z = this.zoom, f = this.frozen()
    const sx = sc.scrollLeft, sy = sc.scrollTop
    const fx = ax.col.offset(f.c) * Z, fy = ax.row.offset(f.r) * Z
    const c0 = ax.col.at(ax.col.offset(f.c) + sx / Z, this.cols), r0 = ax.row.at(ax.row.offset(f.r) + sy / Z, this.rows)
    const scrollCols = this.spans(ax.col, c0, W, HW + fx, Z, ax.col.offset(f.c) + sx / Z, this.cols)
    const scrollRows = this.spans(ax.row, r0, H, HH + fy, Z, ax.row.offset(f.r) + sy / Z, this.rows)
    const frozenCols = f.c ? this.spans(ax.col, 0, HW + fx, HW, Z, 0, f.c - 1) : []
    const frozenRows = f.r ? this.spans(ax.row, 0, HH + fy, HH, Z, 0, f.r - 1) : []
    this.vis = { rows: [...frozenRows, ...scrollRows], cols: [...frozenCols, ...scrollCols], r0, c0 }
    const rules = rulesOf(sh)
    const quads = [
      { rows: scrollRows, cols: scrollCols, clip: [HW + fx, HH + fy, W - HW - fx, H - HH - fy], mx: (c) => HW + fx + (ax.col.offset(c) - ax.col.offset(f.c)) * Z - sx, my: (r) => HH + fy + (ax.row.offset(r) - ax.row.offset(f.r)) * Z - sy },
    ]
    if (f.c) quads.push({ rows: scrollRows, cols: frozenCols, clip: [HW, HH + fy, fx, H - HH - fy], mx: (c) => HW + ax.col.offset(c) * Z, my: quads[0].my })
    if (f.r) quads.push({ rows: frozenRows, cols: scrollCols, clip: [HW + fx, HH, W - HW - fx, fy], mx: quads[0].mx, my: (r) => HH + ax.row.offset(r) * Z })
    if (f.r && f.c) quads.push({ rows: frozenRows, cols: frozenCols, clip: [HW, HH, fx, fy], mx: (c) => HW + ax.col.offset(c) * Z, my: (r) => HH + ax.row.offset(r) * Z })
    for (const q of quads) this.drawQuad(g, q, rules, col, Z)
    this.drawHeaders(g, W, H, col, f, fx, fy, Z)
    if (f.c || f.r) {
      g.strokeStyle = col.lineStrong; g.lineWidth = 1.5; g.beginPath()
      if (f.c) { g.moveTo(HW + fx, 0); g.lineTo(HW + fx, H) }
      if (f.r) { g.moveTo(0, HH + fy); g.lineTo(W, HH + fy) }
      g.stroke()
    }
    this.cb.onDraw?.()
  }
  drawQuad(g, q, rules, col, Z) {
    const sh = this.sh, model = this.model
    const [cx, cy, cw, ch] = q.clip
    if (cw <= 0 || ch <= 0 || !q.rows.length || !q.cols.length) return
    g.save()
    g.beginPath(); g.rect(cx, cy, cw, ch); g.clip()
    const rows = q.rows, cols = q.cols
    const x0 = cols[0].p, x1 = cols[cols.length - 1].p + cols[cols.length - 1].s, y0 = rows[0].p, y1 = rows[rows.length - 1].p + rows[rows.length - 1].s
    if (sh.grid) {
      g.strokeStyle = col.line; g.lineWidth = 1; g.beginPath()
      for (const c of cols) { const x = Math.round(c.p + c.s) - 0.5; g.moveTo(x, y0); g.lineTo(x, y1) }
      for (const r of rows) { const y = Math.round(r.p + r.s) - 0.5; g.moveTo(x0, y); g.lineTo(x1, y) }
      g.stroke()
    }
    // merged areas
    const inner = new Set()
    const mInfo = []
    for (const m of sh.merges) {
      if (m.r2 < rows[0].i || m.r1 > rows[rows.length - 1].i || m.c2 < cols[0].i || m.c1 > cols[cols.length - 1].i) continue
      const x = q.mx(m.c1), y = q.my(m.r1)
      mInfo.push({ m, x, y, w: q.mx(m.c2 + 1) - x, h: q.my(m.r2 + 1) - y })
      for (const r of rows) if (r.i >= m.r1 && r.i <= m.r2) for (const c of cols) if (c.i >= m.c1 && c.i <= m.c2) inner.add(ck(r.i, c.i))
    }
    const infos = []
    const push = (r, c, x, y, w, hh, merged) => {
      const key = ck(r, c)
      const cell = sh.cells.get(key)
      const v = model.valueAt(sh.id, r, c)
      const sId = cell && cell.s !== undefined ? cell.s : sh.rowS[r] ?? sh.colS[c] ?? 0
      const cf = rules ? cfAt(model, sh, rules, r, c, v) : null
      if (v === null && !sId && !cf && !merged) return
      const st = cf ? { ...model.style(sId), ...cf } : model.style(sId)
      infos.push({ r, c, x, y, w, h: hh, v, st, cf, merged })
    }
    for (const r of rows) for (const c of cols) { if (inner.has(ck(r.i, c.i))) continue; push(r.i, c.i, c.p, r.p, c.s, r.s, false) }
    for (const mi of mInfo) push(mi.m.r1, mi.m.c1, mi.x, mi.y, mi.w, mi.h, true)
    // fills
    for (const n of infos) {
      if (n.st.bg || n.merged) { g.fillStyle = n.st.bg || col.bg; g.fillRect(n.x - 0.5, n.y - 0.5, n.w + 0.5, n.h + 0.5) }
      if (n.cf?.bar) {
        const b = n.cf.bar
        const bx = n.x + 2, bw = n.w - 4
        const from = Math.min(b.z, b.p), to = Math.max(b.z, b.p)
        g.fillStyle = b.color; g.globalAlpha = 0.55
        g.fillRect(bx + from * bw, n.y + 3, Math.max(1, (to - from) * bw), n.h - 6)
        g.globalAlpha = 1
      }
    }
    // selection tint (everything except the active cell)
    this.drawSelectionTint(g, q, col)
    // borders
    for (const n of infos) {
      const s = n.st
      if (s.bt) this.edge(g, n.x, n.y, n.x + n.w, n.y, s.bt, col)
      if (s.bb) this.edge(g, n.x, n.y + n.h, n.x + n.w, n.y + n.h, s.bb, col)
      if (s.bl) this.edge(g, n.x, n.y, n.x, n.y + n.h, s.bl, col)
      if (s.br) this.edge(g, n.x + n.w, n.y, n.x + n.w, n.y + n.h, s.br, col)
    }
    // text
    const filt = sh.filter
    for (const n of infos) this.drawText(g, n, col, Z, q)
    if (filt) for (const c of cols) if (c.i >= filt.c1 && c.i <= filt.c2) { const r = rows.find((x) => x.i === filt.r1); if (r) this.drawFilterButton(g, c.p, r.p, c.s, r.s, col, !!(filt.cols && filt.cols[c.i])) }
    this.drawOverlays(g, q, col)
    g.restore()
  }
  edge(g, x1, y1, x2, y2, b, col) {
    const w = b.s === 'thick' ? 3 : b.s === 'medium' ? 2 : 1
    g.strokeStyle = b.c || col.text
    g.lineWidth = w
    g.setLineDash(b.s === 'dashed' ? [5, 3] : b.s === 'dotted' ? [1.5, 2] : [])
    const px = (v) => (w === 2 ? Math.round(v) : Math.round(v) - 0.5)
    const vertical = x1 === x2
    const line = (d) => {
      g.beginPath()
      if (vertical) { g.moveTo(px(x1) + d, y1); g.lineTo(px(x2) + d, y2) } else { g.moveTo(x1, px(y1) + d); g.lineTo(x2, px(y2) + d) }
      g.stroke()
    }
    line(0)
    if (b.s === 'double') line(-3)
    g.setLineDash([])
  }
  drawText(g, n, col, Z, q) {
    let { v } = n
    const st = n.st
    if (v === null || v === '') return
    const f = formatValue(v, st.nf, { chars: Math.max(2, Math.floor(n.w / (6.5 * Z))) })
    let text = f.text
    if (text === '') return
    const num = typeof v === 'number'
    const isErr = typeof v === 'object'
    const ha = st.ha || (num ? 'right' : typeof v === 'boolean' || isErr ? 'center' : 'left')
    const va = st.va || 'middle'
    const fs = fontPx(st) * Z
    g.font = `${st.i ? 'italic ' : ''}${st.b ? '600 ' : ''}${fs}px ${this.fontFamily}`
    const link = typeof v === 'string' && !st.fc && /^https?:\/\/\S+$/i.test(v)
    g.fillStyle = f.color || st.fc || (st.bg && !isErr ? textOn(st.bg) : link ? col.accent : isErr ? col.dark ? '#ff9b8f' : '#c4301f' : col.text)
    g.textBaseline = 'alphabetic'
    const pad = PAD * Z + (st.ind ? st.ind * 10 * Z : 0)
    const innerW = n.w - PAD * 2 * Z
    let lines = [text]
    if (st.wr && !num) lines = this.wrap(g, text, innerW - (st.ind ? st.ind * 10 * Z : 0))
    else if (num && g.measureText(text).width > innerW) text = lines[0] = '#'.repeat(Math.max(1, Math.floor(innerW / g.measureText('#').width)))
    const lh = fs * 1.25
    const blockH = lines.length * lh
    let y = va === 'top' ? n.y + 3 + lh * 0.82 : va === 'bottom' ? n.y + n.h - 3 - blockH + lh * 0.82 : n.y + (n.h - blockH) / 2 + lh * 0.82
    // clip region: the cell, widened over empty neighbours for overflowing text
    let cx = n.x, cw = n.w
    const single = lines.length === 1 && !st.wr
    if (single && !num && !isErr) {
      const tw = g.measureText(text).width + pad * 2
      if (tw > n.w && ha === 'left') {
        const ex = this.overflowRight(n, tw)
        cw = ex
      } else if (tw > n.w && ha === 'right') {
        const ex = this.overflowLeft(n, tw)
        cx = n.x + n.w - ex; cw = ex
      }
    }
    g.save()
    g.beginPath(); g.rect(cx, n.y, cw, n.h); g.clip()
    for (const line of lines) {
      const tw = g.measureText(line).width
      const x = ha === 'right' ? n.x + n.w - pad - tw : ha === 'center' ? n.x + (n.w - tw) / 2 : n.x + pad
      g.fillText(line, x, y)
      if (st.u || st.st || link) {
        g.strokeStyle = g.fillStyle; g.lineWidth = Math.max(1, fs / 14)
        g.beginPath()
        if (st.u || link) { g.moveTo(x, y + fs * 0.12); g.lineTo(x + tw, y + fs * 0.12) }
        if (st.st) { g.moveTo(x, y - fs * 0.3); g.lineTo(x + tw, y - fs * 0.3) }
        g.stroke()
      }
      y += lh
    }
    g.restore()
  }
  overflowRight(n, need) {
    const sh = this.sh, ax = this.axes(), Z = this.zoom
    let w = n.w, c = n.c + 1
    const sid = sh.id
    const last = mergeAt(sh, n.r, n.c) ? mergeAt(sh, n.r, n.c).c2 : n.c
    c = last + 1
    for (let k = 0; k < 40 && w < need; k++, c++) {
      if (this.model.valueAt(sid, n.r, c) !== null || mergeAt(sh, n.r, c)) break
      w += ax.col.size(c) * Z
    }
    return w
  }
  overflowLeft(n, need) {
    const sh = this.sh, ax = this.axes(), Z = this.zoom
    let w = n.w, c = n.c - 1
    for (let k = 0; k < 40 && w < need && c >= 0; k++, c--) {
      if (this.model.valueAt(sh.id, n.r, c) !== null || mergeAt(sh, n.r, c)) break
      w += ax.col.size(c) * Z
    }
    return w
  }
  wrap(g, text, maxW) {
    const out = []
    for (const para of text.split('\n')) {
      let line = ''
      for (const word of para.split(/(\s+)/)) {
        const t = line + word
        if (line && g.measureText(t.trimEnd()).width > maxW) { out.push(line.trimEnd()); line = word.trimStart() } else line = t
        while (g.measureText(line).width > maxW && line.length > 1) {
          let k = line.length - 1
          while (k > 1 && g.measureText(line.slice(0, k)).width > maxW) k--
          out.push(line.slice(0, k)); line = line.slice(k)
        }
      }
      out.push(line.trimEnd())
    }
    return out.length ? out : ['']
  }
  drawFilterButton(g, x, y, w, hh, col, active) {
    const s = 16, bx = x + w - s - 2, by = y + (hh - s) / 2
    g.fillStyle = active ? col.accent : col.head
    g.strokeStyle = active ? col.accent : col.lineStrong
    g.lineWidth = 1
    g.beginPath(); box(g, bx + 0.5, by + 0.5, s - 1, s - 1, 4); g.fill(); g.stroke()
    g.fillStyle = active ? '#fff' : col.muted
    g.beginPath()
    if (active) { g.moveTo(bx + 4, by + 4.5); g.lineTo(bx + s - 4, by + 4.5); g.lineTo(bx + s / 2 + 1.2, by + 9); g.lineTo(bx + s / 2 + 1.2, by + 12.5); g.lineTo(bx + s / 2 - 1.2, by + 11); g.lineTo(bx + s / 2 - 1.2, by + 9) } else { g.moveTo(bx + 4, by + 6); g.lineTo(bx + s - 4, by + 6); g.lineTo(bx + s / 2, by + 11) }
    g.closePath(); g.fill()
  }
  rectIn(q, g) {
    const x1 = q.mx(g.c1), y1 = q.my(g.r1), x2 = q.mx(g.c2 + 1), y2 = q.my(g.r2 + 1)
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
  }
  drawSelectionTint(g, q, col) {
    const s = this.sel
    const R = this.rectIn(q, s)
    if (R.w < 0 || R.h < 0) return
    const single = s.r1 === s.r2 && s.c1 === s.c2
    const m = mergeAt(this.sh, this.act.r, this.act.c)
    if (single || (m && sameRect(m, s))) return
    const A = this.rectIn(q, m ? { r1: m.r1, c1: m.c1, r2: m.r2, c2: m.c2 } : { r1: this.act.r, c1: this.act.c, r2: this.act.r, c2: this.act.c })
    g.fillStyle = col.tint
    g.fillRect(R.x, R.y, R.w, A.y - R.y)
    g.fillRect(R.x, A.y + A.h, R.w, R.y + R.h - A.y - A.h)
    g.fillRect(R.x, A.y, A.x - R.x, A.h)
    g.fillRect(A.x + A.w, A.y, R.x + R.w - A.x - A.w, A.h)
  }
  drawOverlays(g, q, col) {
    const s = this.sel
    // reference highlights while editing a formula
    for (const b of this.refBoxes) {
      if (b.sheet && b.sheet.toLowerCase() !== this.sh.name.toLowerCase()) continue
      if (!b.sheet && this.editor.active && this.editor.sid !== this.sh.id) continue
      const R = this.rectIn(q, b.g)
      g.strokeStyle = b.color; g.lineWidth = 2; g.fillStyle = b.color; g.globalAlpha = 0.08
      g.fillRect(R.x, R.y, R.w, R.h); g.globalAlpha = 1
      g.strokeRect(R.x + 1, R.y + 1, R.w - 2, R.h - 2)
    }
    if (this.marquee && this.marquee.sid === this.sh.id) {
      const R = this.rectIn(q, this.marquee)
      g.strokeStyle = col.accent; g.lineWidth = 1.5; g.setLineDash([5, 4]); g.strokeRect(R.x + 0.5, R.y + 0.5, R.w - 1, R.h - 1); g.setLineDash([])
    }
    if (this.editor.active && this.editor.sid === this.sh.id) return
    const R = this.rectIn(q, s)
    g.strokeStyle = col.accent; g.lineWidth = 2
    g.strokeRect(R.x + 1, R.y + 1, R.w - 2, R.h - 2)
    const m = mergeAt(this.sh, this.act.r, this.act.c)
    const A = this.rectIn(q, m || { r1: this.act.r, c1: this.act.c, r2: this.act.r, c2: this.act.c })
    if (!(s.r1 === s.r2 && s.c1 === s.c2)) { g.lineWidth = 2; g.strokeStyle = col.accent; g.strokeRect(A.x + 1, A.y + 1, A.w - 2, A.h - 2); g.lineWidth = 1; g.strokeStyle = col.bg; g.strokeRect(A.x + 2.5, A.y + 2.5, A.w - 5, A.h - 5) }
    if (this.fillPreview) {
      const P = this.rectIn(q, this.fillPreview)
      g.setLineDash([4, 3]); g.lineWidth = 1.5; g.strokeStyle = col.text; g.strokeRect(P.x + 0.5, P.y + 0.5, P.w - 1, P.h - 1); g.setLineDash([])
    }
    // dropdown arrow of a list validation on the active cell
    const dd = this.dropdownRect()
    if (dd && s.r1 === s.r2 && s.c1 === s.c2) {
      const A2 = this.rectIn(q, { r1: this.act.r, c1: this.act.c, r2: this.act.r, c2: this.act.c })
      const bx = A2.x + A2.w - 19, by = A2.y + 3, bh = Math.max(10, A2.h - 6)
      g.fillStyle = col.head; g.strokeStyle = col.lineStrong; g.lineWidth = 1
      g.beginPath(); box(g, bx + 0.5, by + 0.5, 16, bh - 1, 4); g.fill(); g.stroke()
      g.fillStyle = col.muted; g.beginPath(); g.moveTo(bx + 4.5, by + bh / 2 - 2); g.lineTo(bx + 11.5, by + bh / 2 - 2); g.lineTo(bx + 8, by + bh / 2 + 2.5); g.closePath(); g.fill()
    }
    // fill handle
    g.fillStyle = col.accent; g.strokeStyle = col.bg; g.lineWidth = 1.5
    g.fillRect(R.x + R.w - HANDLE / 2 - 1, R.y + R.h - HANDLE / 2 - 1, HANDLE, HANDLE)
    g.strokeRect(R.x + R.w - HANDLE / 2 - 1, R.y + R.h - HANDLE / 2 - 1, HANDLE, HANDLE)
  }
  drawHeaders(g, W, H, col, f, fx, fy, Z) {
    const s = this.sel
    const { rows, cols } = this.vis
    g.font = `500 ${Math.round(11.5 * Math.min(1.15, Math.max(0.85, Z)))}px ${this.fontFamily}`
    g.textBaseline = 'middle'
    // column header
    g.save(); g.beginPath(); g.rect(HW, 0, W - HW, HH); g.clip()
    g.fillStyle = col.head; g.fillRect(HW, 0, W - HW, HH)
    const wholeRows = s.c1 === 0 && s.c2 >= MAXC - 1, wholeCols = s.r1 === 0 && s.r2 >= MAXR - 1
    const drawCol = (c, clipX) => {
      const inSel = c.i >= s.c1 && c.i <= s.c2
      g.save(); g.beginPath(); g.rect(clipX, 0, W - clipX, HH); g.clip()
      if (inSel) { g.fillStyle = wholeCols ? col.accent : col.headSel; g.fillRect(c.p, 0, c.s, HH) }
      g.strokeStyle = col.line; g.beginPath(); g.moveTo(Math.round(c.p + c.s) - 0.5, 0); g.lineTo(Math.round(c.p + c.s) - 0.5, HH); g.stroke()
      g.fillStyle = inSel ? (wholeCols ? '#fff' : col.accent) : col.muted
      g.textAlign = 'center'
      g.fillText(colName(c.i), c.p + c.s / 2, HH / 2 + 0.5)
      if (inSel && !wholeCols) { g.fillStyle = col.accent; g.fillRect(c.p, HH - 2, c.s, 2) }
      g.restore()
    }
    for (const c of cols.filter((x) => x.i >= f.c)) drawCol(c, HW + fx)
    for (const c of cols.filter((x) => x.i < f.c)) drawCol(c, HW)
    g.restore()
    // row header
    g.save(); g.beginPath(); g.rect(0, HH, HW, H - HH); g.clip()
    g.fillStyle = col.head; g.fillRect(0, HH, HW, H - HH)
    const drawRow = (r, clipY) => {
      const inSel = r.i >= s.r1 && r.i <= s.r2
      g.save(); g.beginPath(); g.rect(0, clipY, HW, H - clipY); g.clip()
      if (inSel) { g.fillStyle = wholeRows ? col.accent : col.headSel; g.fillRect(0, r.p, HW, r.s) }
      g.strokeStyle = col.line; g.beginPath(); g.moveTo(0, Math.round(r.p + r.s) - 0.5); g.lineTo(HW, Math.round(r.p + r.s) - 0.5); g.stroke()
      g.fillStyle = inSel ? (wholeRows ? '#fff' : col.accent) : col.muted
      g.textAlign = 'center'
      if (r.s >= 9) g.fillText(String(r.i + 1), HW / 2, r.p + r.s / 2 + 0.5)
      if (inSel && !wholeRows) { g.fillStyle = col.accent; g.fillRect(HW - 2, r.p, 2, r.s) }
      g.restore()
    }
    for (const r of rows.filter((x) => x.i >= f.r)) drawRow(r, HH + fy)
    for (const r of rows.filter((x) => x.i < f.r)) drawRow(r, HH)
    g.restore()
    // corner and separators
    g.fillStyle = col.head; g.fillRect(0, 0, HW, HH)
    g.fillStyle = col.lineStrong
    g.beginPath(); g.moveTo(HW - 4, HH - 12); g.lineTo(HW - 4, HH - 4); g.lineTo(HW - 12, HH - 4); g.closePath(); g.fill()
    g.strokeStyle = col.line; g.lineWidth = 1
    g.beginPath(); g.moveTo(0, HH - 0.5); g.lineTo(W, HH - 0.5); g.moveTo(HW - 0.5, 0); g.lineTo(HW - 0.5, H); g.stroke()
  }
}
