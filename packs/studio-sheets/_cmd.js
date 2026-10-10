// Editing commands for the app. Mixed into SheetsApp.prototype, so `this` is the app.
import { MAXR, MAXC, ckR, ckC, rangeText, colName } from './_a1.js'
import { adjustDecimals } from './_fmt.js'
import { shift, print, ParseError } from './_parse.js'
import * as ops from './_ops.js'
import { colorPicker, menu } from './_menu.js'
import { dvAt, dvItems, dvCheck } from './_valid.js'
import { fontPx } from './_axis.js'
import { DEFAULT_COL_W, DEFAULT_ROW_H, makeCell, Model } from './_model.js'

export const cmd = {
  // ---------- transactions with undo of the selection ----------
  selSnap() { return { sid: this.sh.id, sel: { ...this.grid.sel }, act: { ...this.grid.act }, anchor: { ...this.grid.anchor }, head: { ...this.grid.head } } },
  run(label, fn) {
    const m = this.model
    m.begin(label, { sel: this.selSnap() })
    try { fn() } catch (e) { m.depth = 0; m._rollback(); throw e }
    m.commit({ sel: this.selSnap() })
  },
  guard(label, fn) {
    try { this.run(label, fn); return true } catch (e) {
      if (!(e instanceof ParseError)) console.error(e)
      this.toast(e instanceof ParseError ? `That formula has a problem: ${e.message}. Check brackets, commas and quotes.` : e?.message || 'Something went wrong', 'error')
      return false
    }
  },
  restoreSel(snap) {
    if (!snap) return
    const sh = this.model.sheet(snap.sid)
    if (!sh) return
    if (sh !== this.sh) this.switchSheet(sh)
    this.grid.anchor = { ...snap.anchor }; this.grid.head = { ...snap.head }
    this.grid.setSelection(snap.sel, snap.act)
  },
  undo() {
    if (this.grid.editing) { this.grid.editor.cancel(); return }
    const j = this.model.undo()
    if (!j) return this.toast('Nothing to undo')
    this.restoreSel(j.meta?.sel)
    this.announce(`Undid ${j.label}`)
  },
  redo() {
    if (this.grid.editing) return
    const j = this.model.redo()
    if (!j) return this.toast('Nothing to redo')
    this.restoreSel(j.metaAfter?.sel || j.meta?.sel)
    this.announce(`Redid ${j.label}`)
  },
  announce(t) { this.grid.announce(t) },
  selectionRect() { const s = this.grid.sel; return { r1: s.r1, c1: s.c1, r2: s.r2, c2: s.c2 } },
  axes() { return this.grid.axes() },

  // ---------- cell input ----------
  rawText(r, c) { return this.model.getCellText(this.sh, r, c) },
  commitInput(r, c, text, sid, fill) {
    const sh = this.model.sheet(sid)
    if (!sh) return true
    const before = this.model.getCellText(sh, r, c)
    if (!fill && before === text) return true
    const rule = dvAt(sh, r, c)
    if (rule) {
      const msg = dvCheck(this.model, sh, rule, text, this.model.wb.opts.dateOrder)
      if (msg) { this.toast(msg, 'error'); return false }
    }
    return this.guard('Edit cell', () => {
      if (fill && sh === this.sh) {
        const g = this.grid.sel
        for (let rr = g.r1; rr <= g.r2; rr++) for (let cc = g.c1; cc <= g.c2; cc++) this.model.setInput(sh, rr, cc, text[0] === '=' ? '=' + shiftText(text.slice(1), rr - r, cc - c) : text)
      } else this.model.setInput(sh, r, c, text)
    })
  },
  clear(what = 'contents') {
    const g = this.grid.sel
    this.guard(what === 'contents' ? 'Clear contents' : 'Clear formats', () => ops.clearRange(this.model, this.sh, g, what))
  },

  // ---------- formatting ----------
  activeStyle() { return this.model.style(this.model.styleAt(this.sh, this.grid.act.r, this.grid.act.c)) },
  applyStyle(patch, label = 'Format') {
    const g = this.grid.sel
    if (this.guard(label, () => ops.applyStyle(this.model, this.sh, g, patch))) {
      if (patch.wr !== undefined) this.autofitWrapped(g)
      if (patch.fs !== undefined) this.growRowsForFont(g)
      this.grid.focus()
    }
  },
  toggleStyle(key) {
    const on = !this.activeStyle()[key]
    this.applyStyle({ [key]: on ? true : null }, 'Format')
  },
  setWrap(on) { this.applyStyle({ wr: on ? true : null }, 'Wrap text'); if (on) this.autofitRows(this.grid.sel, true) },
  indent(d) { const cur = this.activeStyle().ind || 0; this.applyStyle({ ind: Math.max(0, Math.min(10, cur + d)) || null }, 'Indent') },
  setNumberFormat(code) { this.applyStyle({ nf: code === 'General' ? null : code }, 'Number format') },
  decimals(d) {
    const st = this.activeStyle()
    const v = this.model.valueAt(this.sh.id, this.grid.act.r, this.grid.act.c)
    this.applyStyle({ nf: adjustDecimals(st.nf, d, v) }, 'Decimals')
  },
  setBorders(mode) {
    const spec = { s: this.borderStyle || 'thin', c: this.borderColor || '#000000' }
    this.guard('Borders', () => ops.applyBorders(this.model, this.sh, this.grid.sel, mode, mode === 'none' ? null : spec))
    this.grid.focus()
  },
  mergeSelection() { const g = this.grid.sel; if (g.r1 === g.r2 && g.c1 === g.c2) return this.toast('Select two or more cells to merge'); this.guard('Merge cells', () => ops.mergeCells(this.model, this.sh, g)); this.grid.setSelection(g, { r: g.r1, c: g.c1 }) },
  unmergeSelection() { this.guard('Unmerge cells', () => ops.unmergeCells(this.model, this.sh, this.grid.sel)) },
  toggleMerge() { const g = this.grid.sel; if (ops.mergeAt(this.sh, g.r1, g.c1) && g.r1 === g.r2 && g.c1 === g.c2 || this.sh.merges.some((m) => m.r1 <= g.r2 && g.r1 <= m.r2 && m.c1 <= g.c2 && g.c1 <= m.c2 && g.r1 === m.r1 && g.c1 === m.c1 && g.r2 === m.r2 && g.c2 === m.c2)) this.unmergeSelection(); else this.mergeSelection() },
  recentColors() { return this.store?.recent || [] },
  pickColor(anchor, kind) {
    const st = this.activeStyle()
    const cur = kind === 'fc' ? st.fc : kind === 'bg' ? st.bg : kind === 'border' ? this.borderColor : this.sh.color
    colorPicker(this.root, anchor, {
      current: cur, recent: this.recent(), noneLabel: kind === 'fc' ? 'Automatic' : kind === 'border' ? 'Black' : kind === 'tab' ? 'Default' : 'No fill',
      onPick: (c) => {
        if (c) this.pushRecent(c)
        if (kind === 'fc' || kind === 'bg') { this.applyStyle({ [kind]: c || null }, kind === 'fc' ? 'Text color' : 'Fill color'); this.lastColors[kind] = c; this.updateColorBars() }
        else if (kind === 'border') { this.borderColor = c || '#000000'; this.setBorders(this.lastBorderMode || 'all') }
        else if (kind === 'tab') { this.guard('Tab color', () => this.model.setProp(this.sh, 'color', c || null, true)); this.renderTabs() }
        this.refreshPanels()
      },
    })
  },
  recent() { try { return JSON.parse(localStorage.getItem('tools:sheets-recent') || '[]') } catch { return [] } },
  pushRecent(c) { try { const r = [c, ...this.recent().filter((x) => x !== c)].slice(0, 10); localStorage.setItem('tools:sheets-recent', JSON.stringify(r)) } catch { /* storage blocked */ } },
  updateColorBars() {
    this.tb.fcBar?.style.setProperty('--c', this.lastColors.fc || '#d92d20')
    this.tb.bgBar?.style.setProperty('--c', this.lastColors.bg || '#fde047')
  },

  // ---------- sizes ----------
  setRowHeight(px) { const g = this.grid.sel; this.guard('Row height', () => { for (let r = g.r1; r <= Math.min(g.r2, g.r1 + 5000); r++) this.model.setProp(this.sh.rowH, r, Math.round(px), true) }) },
  setColWidth(px) { const g = this.grid.sel; this.guard('Column width', () => { for (let c = g.c1; c <= Math.min(g.c2, g.c1 + 2000); c++) this.model.setProp(this.sh.colW, c, Math.round(px), true) }) },
  resizeAxis(kind, idx, size) {
    const g = this.grid.sel
    const whole = kind === 'col' ? g.r1 === 0 && g.r2 >= MAXR - 1 : g.c1 === 0 && g.c2 >= MAXC - 1
    const [a, b] = kind === 'col' ? [g.c1, g.c2] : [g.r1, g.r2]
    const list = whole && idx >= a && idx <= b ? Array.from({ length: Math.min(b - a + 1, 2000) }, (_, i) => a + i) : [idx]
    this.guard(kind === 'col' ? 'Column width' : 'Row height', () => { for (const i of list) this.model.setProp(kind === 'col' ? this.sh.colW : this.sh.rowH, i, size, true) })
  },
  autofit(kind, idx) {
    const g = this.grid.sel
    if (kind === 'col') this.autofitCols(idx !== undefined && !(idx >= g.c1 && idx <= g.c2) ? { c1: idx, c2: idx } : g)
    else this.autofitRows(idx !== undefined && !(idx >= g.r1 && idx <= g.r2) ? { r1: idx, r2: idx } : g, false)
  },
  autofitCols(g) {
    const sh = this.sh, m = this.model
    const ex = m.extent(sh.id)
    const widths = {}
    for (const [k, cell] of ops.existingIn(sh, { r1: 0, c1: g.c1, r2: Math.min(MAXR - 1, ex.r), c2: Math.min(g.c2, MAXC - 1) })) {
      const r = ckR(k), c = ckC(k)
      if (cell.f == null && cell.v === null) continue
      const v = m.valueAt(sh.id, r, c)
      if (v === null || v === '') continue
      const st = m.style(m.styleAt(sh, r, c))
      const text = ops.displayOf(m, sh, r, c).text
      const w = Math.max(...String(text).split('\n').map((t) => this.grid.measure(t, st))) / this.grid.zoom + 16 + (st.ind || 0) * 10
      if (!widths[c] || w > widths[c]) widths[c] = w
    }
    this.guard('Autofit columns', () => { for (let c = g.c1; c <= Math.min(g.c2, g.c1 + 2000); c++) this.model.setProp(sh.colW, c, Math.round(Math.min(480, Math.max(40, widths[c] || DEFAULT_COL_W))), true) })
  },
  autofitRows(g, onlyWrapped) {
    const sh = this.sh, m = this.model
    const heights = {}
    const ex = m.extent(sh.id)
    for (const [k, cell] of ops.existingIn(sh, { r1: g.r1, c1: 0, r2: Math.min(g.r2, ex.r), c2: Math.min(MAXC - 1, ex.c) })) {
      const r = ckR(k), c = ckC(k)
      if (cell.f == null && cell.v === null) continue
      const st = m.style(m.styleAt(sh, r, c))
      const fs = fontPx(st)
      let lines = 1
      if (st.wr) {
        const text = ops.displayOf(m, sh, r, c).text
        const w = this.axes().col.size(c) - 12
        this.grid.mctx.font = `${st.b ? '600 ' : ''}${fs}px ${this.grid.fontFamily}`
        lines = 0
        for (const para of String(text).split('\n')) {
          let line = ''
          for (const word of para.split(/(\s+)/)) { const t = line + word; if (line && this.grid.mctx.measureText(t.trimEnd()).width > w) { lines++; line = word.trimStart() } else line = t }
          lines++
        }
      } else if (onlyWrapped) continue
      const h = Math.max(DEFAULT_ROW_H, Math.ceil(lines * fs * 1.25 + 8))
      if (!heights[r] || h > heights[r]) heights[r] = h
    }
    this.guard('Autofit rows', () => {
      for (let r = g.r1; r <= Math.min(g.r2, g.r1 + 3000); r++) {
        const h = heights[r] || DEFAULT_ROW_H
        if (onlyWrapped && h <= DEFAULT_ROW_H && sh.rowH[r] === undefined) continue
        this.model.setProp(sh.rowH, r, Math.round(h), true)
      }
    })
  },
  growRowsForFont(g) {
    const sh = this.sh, m = this.model
    const need = {}
    for (const [k, cell] of ops.existingIn(sh, { r1: g.r1, c1: 0, r2: Math.min(g.r2, g.r1 + 3000), c2: MAXC - 1 })) {
      const st = m.style(cell.s || 0)
      if (!st.fs) continue
      const r = ckR(k), h = Math.ceil(fontPx(st) * 1.25 + 8)
      if (h > DEFAULT_ROW_H && (!need[r] || h > need[r])) need[r] = h
    }
    const rows = Object.entries(need).filter(([r, h]) => (sh.rowH[r] ?? DEFAULT_ROW_H) < h)
    if (rows.length) this.guard('Row height', () => { for (const [r, h] of rows) m.setProp(sh.rowH, +r, h, true) })
  },
  autofitWrapped(g) {
    const hasWrap = ops.existingIn(this.sh, g).some(([, cell]) => this.model.style(cell.s || 0).wr)
    if (hasWrap) this.autofitRows(g, true)
  },
  hideSel(kind, hide) {
    const g = this.grid.sel
    this.guard(hide ? `Hide ${kind}s` : `Unhide ${kind}s`, () => {
      const obj = kind === 'row' ? this.sh.hideR : this.sh.hideC
      const [a, b] = kind === 'row' ? [g.r1, g.r2] : [g.c1, g.c2]
      const lo = hide ? a : Math.max(0, a - 1), hi = hide ? b : b + 1
      for (let i = lo; i <= Math.min(hi, lo + 5000); i++) this.model.setProp(obj, i, hide ? 1 : undefined, true)
    })
  },
  setFreeze(r, c) { this.guard('Freeze panes', () => this.model.setProp(this.sh, 'freeze', { r, c }, true)); this.refreshPanels() },
  setGrid(on) { this.guard('Gridlines', () => this.model.setProp(this.sh, 'grid', on, true)) },
  setDateOrder(v) { this.model.wb.opts.dateOrder = v; this.scheduleSave() },
  setZoom(z) { this.grid.setZoom(z); this.charts.reposition(); this.updateStatus() },
  setTouchSelect(on) { this.grid.touchSelect = on; this.grid.sc.classList.toggle('select-mode', on); this.tb.touch?.setAttribute('aria-pressed', String(on)) },

  defineName(name, g) {
    if (!Model.validName(name)) return this.toast('A name starts with a letter or underscore and has no spaces. It cannot look like a cell such as A1.', 'error')
    this.guard('Define name', () => this.model.setName(name, ops.absRefText(this.sh, g)))
    this.refreshPanels()
  },
  deleteName(name) { this.guard('Delete name', () => this.model.setName(name, null)); this.refreshPanels() },

  // ---------- structure ----------
  insertRC(axis, after = false) {
    const g = this.grid.sel
    const count = axis === 'row' ? g.r2 - g.r1 + 1 : g.c2 - g.c1 + 1
    const idx = axis === 'row' ? (after ? g.r2 + 1 : g.r1) : (after ? g.c2 + 1 : g.c1)
    this.guard(`Insert ${axis}${count > 1 ? 's' : ''}`, () => ops.structural(this.model, this.sh, axis, idx, count, false))
  },
  deleteRC(axis) {
    const g = this.grid.sel
    const count = axis === 'row' ? g.r2 - g.r1 + 1 : g.c2 - g.c1 + 1
    const idx = axis === 'row' ? g.r1 : g.c1
    this.guard(`Delete ${axis}${count > 1 ? 's' : ''}`, () => ops.structural(this.model, this.sh, axis, idx, count, true))
    this.grid.selectCell(Math.min(this.grid.act.r, MAXR - 1), this.grid.act.c)
  },

  // ---------- clipboard ----------
  copySel(cut = false) {
    this.grid.focus()
    try { document.execCommand(cut ? 'cut' : 'copy') } catch { /* handled by the event below when available */ }
  },
  clipboardTarget() {
    const ae = document.activeElement
    return ae === this.grid.sc || (!!ae && this.root.contains(ae) && !ae.matches('input, textarea, select') && !ae.closest('.sx-ed'))
  },
  onClipboardEvent(e, cut) {
    if (!this.clipboardTarget()) return
    e.preventDefault()
    const g = { ...this.grid.sel }
    const big = (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1)
    if (big > 400000) { this.toast('That selection is too large to copy. Select fewer cells.', 'error'); return }
    const payload = ops.copyPayload(this.model, this.sh, g)
    const text = ops.toTSV(this.model, this.sh, g)
    e.clipboardData.setData('text/plain', text)
    e.clipboardData.setData('text/html', ops.toHTML(this.model, this.sh, g))
    this.clip = { payload, text, cut, sid: this.sh.id, rect: g }
    this.grid.setMarquee({ ...g, sid: this.sh.id })
    this.toast(cut ? 'Cut. Select a cell and paste.' : 'Copied')
  },
  onPasteEvent(e) {
    if (!this.clipboardTarget()) return
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    this.pasteFromText(text, e.shiftKey || this._valuesOnly ? 'values' : 'all')
  },
  pasteFromText(text, mode = 'all') {
    const norm = (s) => s.replace(/\r\n/g, '\n').replace(/\n$/, '')
    const g = this.grid.sel
    const sh = this.sh
    if (this.clip && norm(text) === norm(this.clip.text)) {
      const p = this.clip.payload
      const tile = p.rows === 1 && p.cols === 1 && (g.r2 > g.r1 || g.c2 > g.c1)
      const target = tile ? g : { r1: g.r1, c1: g.c1, r2: g.r1 + p.rows - 1, c2: g.c1 + p.cols - 1 }
      if (target.r2 >= MAXR || target.c2 >= MAXC) return this.toast('That will not fit on the sheet', 'error')
      if (this.guard(this.clip.cut ? 'Move cells' : 'Paste', () => {
        if (tile) for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) ops.pasteCells(this.model, sh, r, c, p, mode)
        else ops.pasteCells(this.model, sh, g.r1, g.c1, p, mode)
        if (this.clip.cut) {
          const src = this.model.sheet(this.clip.sid)
          const sr = this.clip.rect
          const moveDr = g.r1 - sr.r1, moveDc = g.c1 - sr.c1
          if (src) {
            const overlap = src === sh && !(sr.r2 < target.r1 || sr.r1 > target.r2 || sr.c2 < target.c1 || sr.c1 > target.c2)
            if (!overlap) ops.clearRange(this.model, src, sr, 'all')
            else for (const [k] of ops.existingIn(src, sr)) { const r = ckR(k), c = ckC(k); if (!(r >= target.r1 && r <= target.r2 && c >= target.c1 && c <= target.c2)) this.model.putCell(src, k, undefined) }
            ops.moveRefs(this.model, src, sr, sh, moveDr, moveDc)
          }
        }
      })) {
        if (this.clip.cut) { this.clip = null; this.grid.setMarquee(null) }
        this.grid.selectRect(target, { r: target.r1, c: target.c1 })
      }
      return
    }
    if (!text) return
    const rows = parseTSVText(text)
    const w = Math.max(...rows.map((r) => r.length))
    const target = { r1: g.r1, c1: g.c1, r2: g.r1 + rows.length - 1, c2: g.c1 + w - 1 }
    if (target.r2 >= MAXR || target.c2 >= MAXC) return this.toast('That will not fit on the sheet', 'error')
    if (rows.length * w > 600000) return this.toast('That is too much data to paste at once', 'error')
    if (this.guard('Paste', () => ops.pasteText(this.model, sh, g.r1, g.c1, rows))) { this.grid.selectRect(target, { r: target.r1, c: target.c1 }); this.clip = null; this.grid.setMarquee(null) }
  },
  async pasteButton(mode = 'all') {
    this.grid.focus()
    try {
      const text = await navigator.clipboard.readText()
      this.pasteFromText(text, mode)
    } catch {
      if (this.clip) this.pasteFromText(this.clip.text, mode)
      else this.toast('Your browser blocked clipboard access. Press Ctrl+V to paste.', 'error')
    }
  },

  // ---------- fill ----------
  fill(src, end) { this.guard('Fill', () => ops.fillExtend(this.model, this.sh, src, end)) },
  /** Double-click on the fill handle: fill down as far as the neighbouring column has data. */
  fillToEnd(src) {
    const m = this.model, sid = this.sh.id
    const has = (r, c) => c >= 0 && m.valueAt(sid, r, c) !== null
    const side = [src.c1 - 1, src.c2 + 1].find((c) => has(src.r2 + 1, c) && c >= 0)
    if (side === undefined) return this.toast('Fill down needs data next to the selection')
    let r = src.r2 + 1
    while (has(r + 1, side) && r < MAXR - 2) r++
    this.fill(src, { ...src, r2: r })
    this.grid.selectRect({ ...src, r2: r }, { r: src.r1, c: src.c1 })
  },
  fillDirection(right) {
    const g = this.grid.sel
    if (g.r1 === g.r2 && !right) { const a = this.grid.act; this.fill({ r1: a.r - 1, c1: g.c1, r2: a.r - 1, c2: g.c2 }, { r1: a.r - 1, c1: g.c1, r2: a.r, c2: g.c2 }); return }
    this.guard(right ? 'Fill right' : 'Fill down', () => ops.fillDown(this.model, this.sh, g, right))
  },
  autoSum() {
    const { r, c } = this.grid.act
    const g = this.grid.sel
    if (g.r2 > g.r1 || g.c2 > g.c1) {
      // sum each column of the selection into the row below
      this.guard('AutoSum', () => { for (let cc = g.c1; cc <= g.c2; cc++) this.model.setInput(this.sh, g.r2 + 1, cc, `=SUM(${colName(cc)}${g.r1 + 1}:${colName(cc)}${g.r2 + 1})`) })
      this.grid.selectCell(g.r2 + 1, g.c1)
      return
    }
    const s = ops.autoSumRange(this.model, this.sh, r, c)
    if (!s) { this.grid.startEdit({ text: '=SUM(', mode: 'edit' }); return }
    this.guard('AutoSum', () => this.model.setInput(this.sh, r, c, `=SUM(${rangeText(s)})`))
  },

  // ---------- sort and filter ----------
  currentRegion(r, c) {
    const m = this.model, sid = this.sh.id
    const ex = m.extent(sid)
    const has = (rr, cc) => rr >= 0 && cc >= 0 && rr <= ex.r && cc <= ex.c && m.valueAt(sid, rr, cc) !== null
    let g = { r1: r, c1: c, r2: r, c2: c }
    if (!has(r, c) && !has(r - 1, c) && !has(r + 1, c) && !has(r, c - 1) && !has(r, c + 1)) return g
    for (let guard = 0; guard < 2000; guard++) {
      let grew = false
      const any = (r1, c1, r2, c2) => { for (let rr = r1; rr <= r2; rr++) for (let cc = c1; cc <= c2; cc++) if (has(rr, cc)) return true; return false }
      if (g.r1 > 0 && any(g.r1 - 1, Math.max(0, g.c1 - 1), g.r1 - 1, g.c2 + 1)) { g.r1--; grew = true }
      if (g.r2 < ex.r && any(g.r2 + 1, Math.max(0, g.c1 - 1), g.r2 + 1, g.c2 + 1)) { g.r2++; grew = true }
      if (g.c1 > 0 && any(g.r1, g.c1 - 1, g.r2, g.c1 - 1)) { g.c1--; grew = true }
      if (g.c2 < ex.c && any(g.r1, g.c2 + 1, g.r2, g.c2 + 1)) { g.c2++; grew = true }
      if (!grew) break
    }
    return g
  },
  dataRegion() {
    const s = this.grid.sel
    if (s.r1 !== s.r2 || s.c1 !== s.c2) return { ...s, r2: Math.min(s.r2, Math.max(s.r1, this.model.extent(this.sh.id).r)), c2: Math.min(s.c2, Math.max(s.c1, this.model.extent(this.sh.id).c)) }
    return this.currentRegion(this.grid.act.r, this.grid.act.c)
  },
  detectHeader(g) {
    const m = this.model, sid = this.sh.id
    if (g.r2 <= g.r1) return false
    let texts = 0, cells = 0
    for (let c = g.c1; c <= g.c2; c++) { const v = m.valueAt(sid, g.r1, c); if (v !== null) { cells++; if (typeof v === 'string') texts++ } }
    if (!cells || texts !== cells) return false
    for (let c = g.c1; c <= g.c2; c++) { const v = m.valueAt(sid, g.r1 + 1, c); if (typeof v === 'number' || typeof v === 'boolean') return true }
    return this.model.style(this.model.styleAt(this.sh, g.r1, g.c1)).b === true || texts > 1
  },
  sortSelection(levels, hasHeader) {
    const g = this.dataRegion()
    if (g.r1 === g.r2) return this.toast('Select the data you want to sort')
    this.guard('Sort', () => ops.sortRect(this.model, this.sh, g, levels, hasHeader))
  },
  quickSort(desc) {
    const g = this.dataRegion()
    const col = Math.min(Math.max(this.grid.act.c, g.c1), g.c2)
    this.sortSelection([{ col, desc }], this.detectHeader(g))
  },
  toggleFilter() {
    if (this.sh.filter) {
      this.guard('Remove filter', () => { this.model.setProp(this.sh, 'filter', null, true); this.model.setProp(this.sh, 'fHide', {}, true) })
    } else {
      const g = this.dataRegion()
      if (g.r1 === g.r2 && g.c1 === g.c2 && this.model.valueAt(this.sh.id, g.r1, g.c1) === null) return this.toast('Click inside your data first, then turn on the filter')
      this.guard('Filter', () => this.model.setProp(this.sh, 'filter', { ...g, cols: {} }, true))
    }
    this.refreshPanels()
  },
  clearFilters() {
    if (!this.sh.filter) return
    this.guard('Clear filters', () => { this.model.setProp(this.sh, 'filter', { ...this.sh.filter, cols: {} }, true); ops.applyFilter(this.model, this.sh) })
  },
  reapplyFilter() { if (this.sh.filter) this.guard('Reapply filter', () => ops.applyFilter(this.model, this.sh)) },
  removeDuplicates(cols, hasHeader) {
    const g = this.dataRegion()
    if (!cols.length) return this.toast('Choose at least one column to compare')
    let removed = 0
    this.guard('Remove duplicates', () => { removed = ops.removeDuplicates(this.model, this.sh, g, cols, hasHeader) })
    this.toast(removed ? `Removed ${removed} duplicate row${removed === 1 ? '' : 's'}` : 'No duplicates found', removed ? 'success' : 'info')
  },

  // ---------- charts ----------
  insertChart(type) {
    let g = this.selectionRect()
    if (g.r1 === g.r2 && g.c1 === g.c2) g = this.currentRegion(g.r1, g.c1)
    if (this.model.valueAt(this.sh.id, g.r1, g.c1) === null && g.r1 === g.r2 && g.c1 === g.c2) return this.toast('Select the cells you want to chart first')
    const ex = this.model.extent(this.sh.id)
    g = { r1: g.r1, c1: g.c1, r2: Math.min(g.r2, ex.r), c2: Math.min(g.c2, ex.c) }
    const ax = this.axes()
    const sc = this.grid.sc, Z = this.grid.zoom, f = this.grid.frozen()
    const x = Math.round(ax.col.offset(f.c) + sc.scrollLeft / Z + 40), y = Math.round(ax.row.offset(f.r) + sc.scrollTop / Z + 40)
    const body = []
    for (let r = g.r1; r <= Math.min(g.r2, g.r1 + 1); r++) for (let c = g.c1; c <= g.c2; c++) body.push(this.model.valueAt(this.sh.id, r, c))
    const headers = body.slice(0, g.c2 - g.c1 + 1).some((v) => typeof v === 'string') && g.r2 > g.r1
    const firstColText = g.c2 > g.c1 && [...Array(Math.min(3, g.r2 - g.r1 + 1))].some((_, i) => typeof this.model.valueAt(this.sh.id, g.r1 + i + (headers ? 1 : 0), g.c1) !== 'number')
    const ch = { id: 'ch' + Math.random().toString(36).slice(2, 9), type, title: '', src: { sid: this.sh.id, ...g }, by: 'cols', headers, labels: g.c2 > g.c1 && (firstColText || type === 'pie' || type === 'doughnut'), legend: true, x, y, w: 480, h: 300 }
    if (type === 'scatter') ch.labels = true
    this.guard('Insert chart', () => this.model.setProp(this.sh, 'charts', [...this.sh.charts, ch]))
    this.charts.select(ch.id)
    this.openPanel('charts')
    this.charts.sync(true)
  },
  updateChart(id, patch, label = 'Edit chart') {
    const list = this.sh.charts.map((c) => (c.id === id ? { ...c, ...patch } : c))
    this.guard(label, () => this.model.setProp(this.sh, 'charts', list))
  },
  deleteChart(id) {
    this.guard('Delete chart', () => this.model.setProp(this.sh, 'charts', this.sh.charts.filter((c) => c.id !== id)))
    if (this.charts.selected === id) this.charts.select(null)
    this.grid.focus()
  },
  addRule(r) { this.guard('Add rule', () => this.model.setProp(this.sh, 'cf', [...this.sh.cf, r])); this.toast('Rule added', 'success') },
  deleteRule(id) { this.guard('Delete rule', () => this.model.setProp(this.sh, 'cf', this.sh.cf.filter((r) => r.id !== id))) },

  // ---------- data validation ----------
  openDropdown(r, c, rect) {
    const rule = dvAt(this.sh, r, c)
    if (!rule) return
    const items = dvItems(this.model, this.sh, rule)
    const box = this.grid.sc.getBoundingClientRect()
    const cur = this.model.getCellText(this.sh, r, c)
    menu(this.root, { x: box.left + rect.x, y: box.top + rect.y + rect.h }, items.length ? items.slice(0, 200).map((t) => ({ label: t, checked: String(t) === cur ? true : undefined, onClick: () => { this.guard('Pick value', () => this.model.setInput(this.sh, r, c, t)); this.grid.focus() } })) : [{ label: 'No choices yet', disabled: true }])
  },
  addValidation(rule) { this.guard('Data validation', () => this.model.setProp(this.sh, 'dv', [...this.sh.dv.filter((d) => !(d.range.r1 === rule.range.r1 && d.range.c1 === rule.range.c1 && d.range.r2 === rule.range.r2 && d.range.c2 === rule.range.c2)), rule])); this.toast('Validation added', 'success') },
  deleteValidation(id) { this.guard('Remove validation', () => this.model.setProp(this.sh, 'dv', this.sh.dv.filter((d) => d.id !== id))) },

  // ---------- functions and find ----------
  insertFunction(name) {
    const ed = this.grid.editor
    if (ed.active) {
      const t = ed.text, p = ed.caret()
      const pre = t[0] === '=' ? '' : '='
      const text = pre ? `=${name}(` : t.slice(0, p) + name + '(' + t.slice(p)
      ed.setText(text, pre ? text.length : p + name.length + 1)
      if (ed.from === 'bar') this.fbar.focus(); else ed.ta.focus()
    } else {
      this.grid.startEdit({ text: `=${name}(`, mode: 'edit' })
    }
  },
  goTo(hit) {
    const sh = this.model.sheet(hit.sid)
    if (sh && sh !== this.sh) this.switchSheet(sh)
    this.grid.selectCell(hit.r, hit.c)
  },
  replaceHit(hit, opts, replace) {
    this.guard('Replace', () => ops.replaceIn(this.model, hit, { ...opts, replace }))
  },
  replaceAll(opts, replace) {
    const hits = ops.findAll(this.model, opts)
    let n = 0
    this.guard('Replace all', () => { for (const h of hits) if (ops.replaceIn(this.model, h, { ...opts, replace })) n++ })
    this.toast(n ? `Replaced in ${n} cell${n === 1 ? '' : 's'}` : 'Nothing to replace', n ? 'success' : 'info')
  },
}

function parseTSVText(text) {
  const t = text.replace(/\r\n/g, '\n').replace(/\n$/, '')
  const rows = []
  let row = [], cur = '', q = false
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += ch } else if (ch === '"' && cur === '') q = true
    else if (ch === '\t') { row.push(cur); cur = '' } else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = '' } else cur += ch
  }
  row.push(cur); rows.push(row)
  return rows
}
function shiftText(f, dr, dc) {
  const c = makeCell(f)
  return c.ast ? print(shift(c.ast, dr, dc)) : f
}
