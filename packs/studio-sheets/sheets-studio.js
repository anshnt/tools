// Sheets: a spreadsheet editor in your browser. Virtualized canvas grid, formulas (190+ functions, own engine), formatting,
// multiple sheets, fill handle, sort, filter, find, conditional formats, charts, undo, autosave, and Excel/CSV/ODS/PDF in and out.
// A clean-room take on the same category as the open-source GridCraft by ArtCraft.
import { h, icon, toast, dropzone } from '../../lib/ui.js'
import * as idb from '../../lib/idb.js'
import { Model } from './_model.js'
import { GridView } from './_grid.js'
import { ChartLayer } from './_charts.js'
import { PANELS } from './_panels.js'
import { cmd } from './_cmd.js'
import { files } from './_files.js'
import { injectStyle } from './_style.js'
import { menu } from './_menu.js'
import * as ops from './_ops.js'
import { dvAt } from './_valid.js'
import { CHART_TYPES } from './_charts.js'
import { rangeText, MAXR, MAXC, colName } from './_a1.js'
import { FMT, nfLabel, generalText } from './_fmt.js'
import { Ref } from './_val.js'
import { modelFromDesc, OPEN_ACCEPT } from './_io.js'
import { TEMPLATES } from './_templates.js'

const SAVE_DELAY = 700
const MOD = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl+'
const NF_OPTIONS = [['General', 'General'], [FMT.dec2, 'Number'], [FMT.inr, 'Currency (₹)'], [FMT.pct0, 'Percent'], [FMT.dmy, 'Date'], [FMT.hm, 'Time'], ['@', 'Text'], ['custom', 'Custom...']]

class SheetsApp {
  constructor(host, ctx) {
    this.host = host
    this.params = ctx.params || {}
    this.signal = ctx.signal
    this.key = `sheets-studio:${this.params.key || 'main'}`
    this.tb = {}
    this.lastColors = {}
    this.borderStyle = 'thin'
    this.borderColor = '#000000'
    this.panels = {}
    this.panelName = null
    this.clip = null
    this.store = {}
    this.timers = {}
  }

  // ---------- start ----------
  async start() {
    let model = null
    const saved = await idb.get(this.key)
    if (saved?.json) { try { model = Model.fromJSON(saved.json) } catch (e) { console.error('restore failed', e) } }
    if (!model) {
      const t = TEMPLATES[this.params.template]
      model = t ? modelFromDesc(t.build()) : new Model()
    }
    this.model = model
    this.sh = model.sheets[Math.min(model.wb.active || 0, model.sheets.length - 1)]
    this.build()
    this.grid.setSheet(this.sh, false)
    this.unsub = model.on((info) => this.onModelChange(info))
    this.renderTabs()
    this.charts.sync(true)
    this.onSelectionChange()
    this.updateColorBars()
    this.setSaveStatus()
    if (window.matchMedia('(pointer: coarse)').matches) this.tb.touch?.classList.remove('hidden')
    this.root.__sheets = this
  }

  // ---------- UI ----------
  btn(ic, tip, onClick, o = {}) {
    const b = h('button', { type: 'button', class: ['sx-b', o.caret && 'caret', o.cls], 'data-tip': tip, 'aria-label': tip, 'aria-pressed': o.toggle ? 'false' : null, onclick: onClick, disabled: o.disabled }, icon(ic), o.label && h('span', o.label), o.bar ? h('i', { class: 'sx-cbar' }) : null)
    if (o.pos) b.dataset.tipPos = o.pos
    return b
  }
  group(...kids) { return h('div', { class: 'sx-grp', role: 'group' }, ...kids) }
  build() {
    injectStyle()
    const T = this.tb
    const sel = (opts, cls, fn, label) => { const s = h('select', { class: ['sx-sel', cls], 'aria-label': label, onchange: (e) => fn(e.target.value, e) }, opts.map(([v, l]) => h('option', { value: v }, l))); return s }
    // top row
    this.titleIn = h('input', { class: 'sx-title', value: this.model.wb.name, 'aria-label': 'Workbook name', maxlength: 80, spellcheck: false, onchange: (e) => { this.model.wb.name = e.target.value.trim() || 'Untitled'; e.target.value = this.model.wb.name; this.scheduleSave() } })
    this.saveEl = h('span', { class: 'sx-save', role: 'status' })
    this.dz = dropzone({ accept: OPEN_ACCEPT, paste: false, onFiles: (f) => this.openFiles(f) })
    this.dz.hidden = true
    const top = h('div', { class: 'sx-top' }, this.titleIn, this.saveEl, h('span', { class: 'sx-spacer' }, this.dz),
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: (e) => this.newMenu(e.currentTarget) }, icon('file-plus'), h('span', 'New')),
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => this.dz.open() }, icon('folder-open'), h('span', 'Open')),
      h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: (e) => this.saveMenu(e.currentTarget) }, icon('download'), h('span', 'Save')))
    // toolbar
    T.undo = this.btn('undo-2', `Undo (${MOD}Z)`, () => this.undo())
    T.redo = this.btn('redo-2', `Redo (${MOD}Y)`, () => this.redo())
    T.size = sel([8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72].map((n) => [String(n), String(n)]), 'sm', (v) => this.applyStyle({ fs: +v === 11 ? null : +v }), 'Font size')
    T.b = this.btn('bold', `Bold (${MOD}B)`, () => this.toggleStyle('b'), { toggle: true })
    T.i = this.btn('italic', `Italic (${MOD}I)`, () => this.toggleStyle('i'), { toggle: true })
    T.u = this.btn('underline', `Underline (${MOD}U)`, () => this.toggleStyle('u'), { toggle: true })
    T.st = this.btn('strikethrough', 'Strikethrough', () => this.toggleStyle('st'), { toggle: true })
    T.fc = this.btn('baseline', 'Text color', (e) => this.colorQuick(e.currentTarget, 'fc', e), { bar: true, caret: true })
    T.bg = this.btn('paint-bucket', 'Fill color', (e) => this.colorQuick(e.currentTarget, 'bg', e), { bar: true, caret: true })
    T.fcBar = T.fc.querySelector('.sx-cbar'); T.bgBar = T.bg.querySelector('.sx-cbar')
    T.borders = this.btn('grid-3x3', 'Borders', (e) => this.bordersMenu(e.currentTarget), { caret: true })
    T.ha = ['left', 'center', 'right'].map((a) => this.btn(`align-${a}`, `Align ${a}`, () => this.applyStyle({ ha: this.activeStyle().ha === a ? null : a }, 'Align'), { toggle: true }))
    T.va = ['top', 'center', 'bottom'].map((a) => this.btn(`align-vertical-justify-${a === 'top' ? 'start' : a === 'bottom' ? 'end' : 'center'}`, `Align ${a === 'center' ? 'middle' : a}`, () => this.applyStyle({ va: a === 'center' ? null : a }, 'Align'), { toggle: true }))
    T.wrap = this.btn('wrap-text', 'Wrap text', () => this.setWrap(!this.activeStyle().wr), { toggle: true })
    T.merge = this.btn('merge', 'Merge cells', () => this.toggleMerge())
    T.nf = sel(NF_OPTIONS, 'nf', (v) => { if (v === 'custom') { this.openPanel('format'); this.renderNf() } else this.setNumberFormat(v) }, 'Number format')
    T.rupee = this.btn('indian-rupee', 'Rupee format', () => this.setNumberFormat(FMT.inr))
    T.pct = this.btn('percent', `Percent (${MOD}Shift+5)`, () => this.setNumberFormat(FMT.pct0))
    T.comma = this.btn('hash', 'Thousands separator', () => this.setNumberFormat(FMT.thousands2))
    T.decUp = this.btn('decimals-arrow-right', 'More decimals', () => this.decimals(1))
    T.decDown = this.btn('decimals-arrow-left', 'Fewer decimals', () => this.decimals(-1))
    T.ins = this.btn('between-horizontal-start', 'Insert', (e) => this.insertMenu(e.currentTarget), { caret: true })
    T.del = this.btn('trash-2', 'Delete cells, rows or columns', (e) => this.deleteMenu(e.currentTarget), { caret: true })
    T.sum = this.btn('sigma', 'AutoSum (Alt+=)', () => this.autoSum())
    T.fill = this.btn('arrow-down-to-line', 'Fill', (e) => menu(this.root, e.currentTarget, [{ label: 'Fill down', icon: 'arrow-down-to-line', kbd: `${MOD}D`, onClick: () => this.fillDirection(false) }, { label: 'Fill right', icon: 'arrow-right-to-line', kbd: `${MOD}R`, onClick: () => this.fillDirection(true) }]), { caret: true })
    T.clear = this.btn('eraser', 'Clear', (e) => menu(this.root, e.currentTarget, [{ label: 'Clear contents', onClick: () => this.clear('contents'), kbd: 'Del' }, { label: 'Clear formats', onClick: () => this.clear('formats') }, { label: 'Clear all', onClick: () => this.clear('all') }]), { caret: true })
    T.sortA = this.btn('arrow-down-a-z', 'Sort A to Z', () => this.quickSort(false))
    T.sortZ = this.btn('arrow-up-z-a', 'Sort Z to A', () => this.quickSort(true))
    T.filter = this.btn('funnel', `Filter (${MOD}Shift+L)`, () => this.toggleFilter(), { toggle: true })
    T.freeze = this.btn('panel-top', 'Freeze panes', (e) => menu(this.root, e.currentTarget, [{ label: 'Freeze top row', onClick: () => this.setFreeze(1, 0) }, { label: 'Freeze first column', onClick: () => this.setFreeze(0, 1) }, { label: 'Freeze at selection', onClick: () => this.setFreeze(this.grid.act.r, this.grid.act.c) }, '-', { label: 'Unfreeze panes', onClick: () => this.setFreeze(0, 0) }]), { caret: true })
    T.chart = this.btn('chart-column', 'Insert chart', (e) => menu(this.root, e.currentTarget, CHART_TYPES.map(([t, l, ic]) => ({ label: l, icon: ic, onClick: () => this.insertChart(t) }))), { caret: true })
    T.rules = this.btn('wand-sparkles', 'Conditional formatting', () => this.openPanel('rules'))
    T.find = this.btn('search', `Find and replace (${MOD}F)`, () => this.openPanel('find'))
    T.touch = this.btn('mouse-pointer-click', 'Select by dragging (touch)', () => this.setTouchSelect(!this.grid.touchSelect), { toggle: true, cls: 'hidden' })
    T.copy = this.btn('copy', `Copy (${MOD}C)`, () => this.copySel(false))
    T.cut = this.btn('scissors', `Cut (${MOD}X)`, () => this.copySel(true))
    T.paste = this.btn('clipboard-paste', `Paste (${MOD}V)`, (e) => menu(this.root, e.currentTarget, [{ label: 'Paste', kbd: `${MOD}V`, onClick: () => this.pasteButton('all') }, { label: 'Paste values only', onClick: () => this.pasteButton('values') }, { label: 'Paste formulas only', onClick: () => this.pasteButton('formulas') }, { label: 'Paste formats only', onClick: () => this.pasteButton('formats') }]), { caret: true })
    const bar = h('div', { class: 'sx-bar', role: 'toolbar', 'aria-label': 'Formatting' },
      this.group(T.undo, T.redo), this.group(T.cut, T.copy, T.paste),
      this.group(T.size, T.b, T.i, T.u, T.st, T.fc, T.bg, T.borders), this.group(...T.ha, ...T.va, T.wrap, T.merge),
      this.group(T.nf, T.rupee, T.pct, T.comma, T.decDown, T.decUp), this.group(T.ins, T.del, T.clear),
      this.group(T.sum, T.fill, T.sortA, T.sortZ, T.filter, T.freeze), this.group(T.chart, T.rules, T.find, T.touch))
    // formula bar
    this.nameBox = h('input', { class: 'sx-name', 'aria-label': 'Name box', spellcheck: false, value: 'A1', onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.goToName(this.nameBox.value) } else if (e.key === 'Escape') { this.updateNameBox(); this.grid.focus() } }, onfocus: (e) => e.target.select() })
    this.fbar = h('input', { class: 'sx-fbar', 'aria-label': 'Formula bar', spellcheck: false, autocomplete: 'off', placeholder: 'Type a value or a formula starting with =' })
    const fx = h('div', { class: 'sx-fx' }, this.nameBox, h('button', { type: 'button', class: 'sx-fxb', 'aria-label': 'Insert function', title: 'Insert function', onclick: () => this.openPanel('functions') }, 'fx'), this.fbar)
    // main
    this.railEl = h('nav', { class: 'sx-rail', 'aria-label': 'Tools' })
    for (const [name, p] of Object.entries(PANELS)) {
      const b = this.btn(p.icon, p.label, () => this.togglePanel(name), { toggle: true, pos: 'right' })
      b.dataset.panel = name
      this.railEl.append(b)
    }
    this.gv = h('div', { class: 'sx-gv' })
    this.welcome = h('div', { class: 'sx-welcome' }, icon('table-2'), h('b', 'A blank sheet, ready for data'),
      h('p', 'Click a cell and start typing, paste a table from another app, or drop an Excel, CSV or ODS file here.'),
      h('div', { class: 'sx-row' }, h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => this.dz.open() }, icon('folder-open'), h('span', 'Open a file')),
        h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => this.templatesDialog() }, icon('layout-template'), h('span', 'Templates'))))
    this.inspEl = h('aside', { class: 'sx-insp', 'aria-label': 'Panel' })
    this.main = h('div', { class: 'sx-main' }, this.railEl, this.gv, this.inspEl)
    this.tabsEl = h('div', { class: 'sx-tabs', role: 'tablist', 'aria-label': 'Sheets' })
    this.tabsEl.append(h('button', { type: 'button', class: 'sx-tabadd', 'aria-label': 'Add sheet', title: 'Add sheet', onclick: () => this.addSheet() }, icon('plus')))
    this.statsEl = h('span', { class: 'sx-stats' })
    this.zoomEl = h('input', { type: 'range', min: 40, max: 200, step: 10, value: 100, 'aria-label': 'Zoom', oninput: (e) => this.setZoom(+e.target.value / 100) })
    this.zoomLabel = h('span', '100%')
    const status = h('div', { class: 'sx-status' }, this.statsEl,
      h('div', { class: 'sx-zoom' }, this.btn('minus', 'Zoom out', () => this.setZoom(this.grid.zoom - 0.1)), this.zoomEl, this.btn('plus', 'Zoom in', () => this.setZoom(this.grid.zoom + 0.1)), this.zoomLabel))
    this.root = h('div', { class: 'sx', 'data-sx': '' }, top, bar, fx, this.main, this.tabsEl, status)
    const credit = h('p', { class: 'sx-credit' }, 'Prefer a native app? ', h('a', { href: 'https://github.com/storytold/gridcraft', target: '_blank', rel: 'noopener' }, 'GridCraft by ArtCraft'), ' is free and open source.')
    this.host.append(this.root, credit)
    this.creditEl = credit
    // grid
    this.grid = new GridView(this.gv, this.model, this.callbacks(), this.fbar)
    this.gv.append(this.welcome)
    this.charts = new ChartLayer(this.grid, this)
    this.charts.app = this
    const ro = new ResizeObserver(() => { this.measureScrollbars(); this.charts.reposition() })
    ro.observe(this.gv)
    this.ro = ro
    this.root.addEventListener('mousedown', (e) => { if (this.grid.editing && e.target.closest('button') && !e.target.closest('.sx-gv')) e.preventDefault() })
    this.onCopy = (e) => this.onClipboardEvent(e, false)
    this.onCut = (e) => this.onClipboardEvent(e, true)
    this.onPaste = (e) => this.onPasteEvent(e)
    document.addEventListener('copy', this.onCopy); document.addEventListener('cut', this.onCut); document.addEventListener('paste', this.onPaste)
    this.onUnload = () => this.flushSave()
    window.addEventListener('beforeunload', this.onUnload)
    this.themeMo = new MutationObserver(() => this.charts.sync(true))
    this.themeMo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    // shortcuts keep working while a toolbar button or panel has focus
    this.root.addEventListener('keydown', (e) => {
      const t = e.target
      if (t === this.grid.sc || t.closest?.('.sx-ed') || t.closest?.('.sx-chart')) return
      const typing = t.matches?.('input, textarea, select, [contenteditable]')
      const ctrl = e.ctrlKey || e.metaKey
      if (typing && !(ctrl && ['s', 'f', 'h', 'p', 'o'].includes(e.key.toLowerCase()))) return
      if (!ctrl && !e.altKey) return
      if (this.onKey(e)) e.preventDefault()
    })
    this.sc = this.grid.sc
  }
  measureScrollbars() {
    const sc = this.grid.sc
    this.gv.style.setProperty('--sbw', sc.offsetWidth - sc.clientWidth + 'px')
    this.gv.style.setProperty('--sbh', sc.offsetHeight - sc.clientHeight + 'px')
  }
  callbacks() {
    return {
      rawText: (r, c) => this.rawText(r, c),
      onCommit: (r, c, text, sid, fill) => this.commitInput(r, c, text, sid, fill),
      afterCommit: (dir) => {
        const g = this.grid
        if (dir === 'down') { if (!g.moveInSel(1, 0)) g.moveBy(1, 0, false, false) } else if (dir === 'up') { if (!g.moveInSel(-1, 0)) g.moveBy(-1, 0, false, false) } else if (dir === 'right') { if (!g.moveInSel(0, 1)) g.moveBy(0, 1, false, false) } else if (dir === 'left') { if (!g.moveInSel(0, -1)) g.moveBy(0, -1, false, false) } else this.onSelectionChange()
      },
      onEditStart: () => { this.root.classList.add('editing') },
      onEditEnd: () => { this.root.classList.remove('editing'); this.onSelectionChange() },
      onEditCancel: () => {},
      onSelect: () => this.onSelectionChange(),
      onScroll: () => { this.charts.reposition(); },
      onContext: (e, info) => this.contextMenu(e, info),
      onFilterClick: (c, rect) => this.openFilterMenu(c, rect),
      onFill: (src, end) => this.fill(src, end),
      onFillDouble: (src) => this.fillToEnd(src),
      hasDropdown: (r, c) => { const d = dvAt(this.sh, r, c); return !!d && d.type === 'list' },
      onDropdown: (r, c, rect) => this.openDropdown(r, c, rect),
      onResize: (kind, idx, size) => this.resizeAxis(kind, idx, size),
      onAutofit: (kind, idx) => this.autofit(kind, idx),
      onKey: (e) => this.onKey(e),
      onClear: () => { if (this.charts.selected) return; this.clear('contents') },
      onEscape: () => { if (this.clip) { this.clip = null; this.grid.setMarquee(null) } },
      onZoom: (d) => this.setZoom(this.grid.zoom + d),
    }
  }

  // ---------- keyboard ----------
  onKey(e) {
    const ctrl = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    const code = e.code
    if (ctrl && !e.altKey) {
      if (k === 'c' || k === 'x') return false
      if (k === 'v') { this._valuesOnly = e.shiftKey; setTimeout(() => { this._valuesOnly = false }, 300); return false }
      if (k === 'z') { e.shiftKey ? this.redo() : this.undo(); return true }
      if (k === 'y') { this.redo(); return true }
      if (k === 'b') { this.toggleStyle('b'); return true }
      if (k === 'i') { this.toggleStyle('i'); return true }
      if (k === 'u') { this.toggleStyle('u'); return true }
      if (code === 'Digit5' && !e.shiftKey) { this.toggleStyle('st'); return true }
      if (code === 'Digit5' && e.shiftKey) { this.setNumberFormat(FMT.pct0); return true }
      if (code === 'Digit4' && e.shiftKey) { this.setNumberFormat(FMT.inr); return true }
      if (code === 'Digit1' && e.shiftKey) { this.setNumberFormat(FMT.thousands2); return true }
      if (code === 'Digit1') { this.openPanel('format'); return true }
      if (k === 'a') { this.selectAll(); return true }
      if (k === 'f' || k === 'h') { this.openPanel('find'); this.panels.find?.focus(); return true }
      if (k === 's') { this.exportXlsx(); return true }
      if (k === 'p') { this.exportPdfDialog(); return true }
      if (k === 'o') { this.dz.open(); return true }
      if (k === 'd') { this.fillDirection(false); return true }
      if (k === 'r') { this.fillDirection(true); return true }
      if (k === 'l' && e.shiftKey) { this.toggleFilter(); return true }
      if (k === ';' && !e.shiftKey) { this.insertToday(); return true }
      if (code === 'Space') { const c = this.grid.act.c; this.grid.selectRect({ r1: 0, c1: c, r2: MAXR - 1, c2: c }, { r: this.grid.act.r, c }); return true }
      if (code === 'Equal') { this.setZoom(this.grid.zoom + 0.1); return true }
      if (code === 'Minus') { this.setZoom(this.grid.zoom - 0.1); return true }
      if (code === 'Digit0') { this.setZoom(1); return true }
      if (code === 'Slash') { this.showShortcuts(); return true }
      if (e.shiftKey && code === 'Equal') { this.insertRC('row'); return true }
      return false
    }
    if (e.altKey && e.key === 'ArrowDown') { const dd = this.grid.dropdownRect(); if (dd) { this.openDropdown(this.grid.act.r, this.grid.act.c, dd.cell); return true } }
    if (e.shiftKey && code === 'Space' && !ctrl) { const r = this.grid.act.r; this.grid.selectRect({ r1: r, c1: 0, r2: r, c2: MAXC - 1 }, { r, c: this.grid.act.c }); return true }
    if (e.altKey && code === 'Equal') { this.autoSum(); return true }
    return false
  }
  selectAll() {
    const g = this.grid
    const s = g.sel
    const region = this.currentRegion(g.act.r, g.act.c)
    const same = s.r1 === region.r1 && s.c1 === region.c1 && s.r2 === region.r2 && s.c2 === region.c2
    if (same || (region.r1 === region.r2 && region.c1 === region.c2)) g.selectRect({ r1: 0, c1: 0, r2: MAXR - 1, c2: MAXC - 1 }, { r: g.act.r, c: g.act.c })
    else g.selectRect(region, { r: g.act.r, c: g.act.c })
  }
  insertToday() {
    const d = new Date()
    const text = this.model.wb.opts.dateOrder === 'mdy' ? `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}` : `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
    this.guard('Insert date', () => this.model.setInput(this.sh, this.grid.act.r, this.grid.act.c, text))
  }

  // ---------- menus ----------
  /** Split button: the left part applies the last color, the arrow opens the palette. */
  colorQuick(anchor, kind, ev) {
    const onArrow = ev && ev.clientX > anchor.getBoundingClientRect().right - 14
    if (onArrow || !this.lastColors[kind]) return this.pickColor(anchor, kind)
    this.applyStyle({ [kind]: this.lastColors[kind] }, kind === 'fc' ? 'Text color' : 'Fill color')
  }
  bordersMenu(anchor) {
    const M = (m, l, ic) => ({ label: l, icon: ic, onClick: () => { this.lastBorderMode = m; this.setBorders(m) } })
    menu(this.root, anchor, [M('all', 'All borders', 'grid-3x3'), M('outer', 'Outer border', 'square'), M('inner', 'Inner borders', 'grid-2x2'), M('top', 'Top border', 'panel-top'), M('bottom', 'Bottom border', 'panel-bottom'), M('left', 'Left border', 'panel-left'), M('right', 'Right border', 'panel-right'), M('none', 'No border', 'ban'), '-',
      { label: 'Border color and style...', icon: 'palette', onClick: () => this.openPanel('format') }])
  }
  insertMenu(anchor) {
    menu(this.root, anchor, [{ label: 'Insert row above', icon: 'between-horizontal-start', onClick: () => this.insertRC('row') }, { label: 'Insert row below', icon: 'between-horizontal-end', onClick: () => this.insertRC('row', true) },
      { label: 'Insert column left', icon: 'between-vertical-start', onClick: () => this.insertRC('col') }, { label: 'Insert column right', icon: 'between-vertical-end', onClick: () => this.insertRC('col', true) }])
  }
  deleteMenu(anchor) {
    menu(this.root, anchor, [{ label: 'Delete row(s)', icon: 'trash-2', onClick: () => this.deleteRC('row') }, { label: 'Delete column(s)', icon: 'trash-2', onClick: () => this.deleteRC('col') }, '-', { label: 'Clear contents', icon: 'eraser', onClick: () => this.clear('contents') }])
  }

  // ---------- panels ----------
  togglePanel(name) { if (this.panelName === name) this.closePanel(); else this.openPanel(name) }
  openPanel(name) {
    const def = PANELS[name]
    if (!def) return
    if (!this.panels[name]) this.panels[name] = def.build(this)
    this.panelName = name
    const p = this.panels[name]
    this.inspEl.replaceChildren(h('div', { class: 'sx-ph' }, icon(def.icon), h('span', def.label), this.btn('x', 'Close panel', () => this.closePanel(), { pos: 'left' })), p.el)
    this.main.classList.add('has-insp')
    for (const b of this.railEl.querySelectorAll('[data-panel]')) b.setAttribute('aria-pressed', String(b.dataset.panel === name))
    p.update()
    setTimeout(() => { this.grid.invalidate(); this.charts.reposition(); this.measureScrollbars() }, 0)
  }
  closePanel() {
    this.panelName = null
    this.main.classList.remove('has-insp')
    for (const b of this.railEl.querySelectorAll('[data-panel]')) b.setAttribute('aria-pressed', 'false')
    this.inspEl.replaceChildren()
    setTimeout(() => { this.grid.invalidate(); this.charts.reposition(); this.measureScrollbars() }, 0)
    this.grid.focus()
  }
  refreshPanels(force) {
    if (force) for (const k of Object.keys(this.panels)) { this.panels[k]._sig = null; this.panels[k]._key = null }
    if (this.panelName) this.panels[this.panelName].update()
  }
  invalidatePanel(name) { if (this.panelName === name) { this.panels[name]._key = null; this.panels[name].update() } }
  renderNf() { this.refreshPanels() }
  onChartSelect() { if (this.panelName === 'charts') this.panels.charts.update() }

  // ---------- state updates ----------
  updateNameBox() {
    const g = this.grid.sel
    const single = g.r1 === g.r2 && g.c1 === g.c2
    this.nameBox.value = single ? colName(g.c1) + (g.r1 + 1) : rangeText(g)
  }
  goToName(text) {
    const t = text.trim()
    const def = this.model.wb.names[t.toUpperCase()]
    const ref = this.model.parseRefText(def ? def.ref : t, this.sh.id)
    if (!ref && !def && Model.validName(t)) {
      // an unknown valid name defines it for the selection (like a spreadsheet's name box)
      const ok = this.guard('Define name', () => this.model.setName(t, ops.absRefText(this.sh, this.selectionRect())))
      if (ok) this.toast(`Defined name ${t} for ${rangeText(this.selectionRect())}. Use it in formulas, for example =SUM(${t}).`, 'success')
      this.updateNameBox(); this.grid.focus(); this.refreshPanels()
      return
    }
    if (!ref) { this.toast(`"${text}" is not a cell, a range or a valid name`, 'error'); this.updateNameBox(); return }
    const sh = this.model.sheet(ref.sid)
    if (sh !== this.sh) this.switchSheet(sh)
    this.grid.selectRect({ r1: ref.r1, c1: ref.c1, r2: ref.r2, c2: ref.c2 }, { r: ref.r1, c: ref.c1 })
    this.grid.focus()
  }
  onSelectionChange() {
    if (!this.grid || !this.model) return
    this.updateNameBox()
    if (!this.grid.editing) this.fbar.value = this.rawText(this.grid.act.r, this.grid.act.c)
    if (this.charts.selected && !this.grid.editing) { /* keep chart selection until another cell is picked */ }
    this.updateToolbar()
    this.updateStatus()
    this.updateWelcome()
    if (this.panelName) this.panels[this.panelName].update()
    this.grid.invalidate()
    clearTimeout(this.timers.say)
    this.timers.say = setTimeout(() => {
      const { r, c } = this.grid.act
      const t = ops.displayOf(this.model, this.sh, r, c).text
      this.grid.announce(`${colName(c)}${r + 1}, ${t || 'empty'}`)
    }, 250)
  }
  updateWelcome() { this.welcome.hidden = this.isDirty() || this.model.sheets.length > 1 || this.grid.editing }
  updateToolbar() {
    const T = this.tb
    const st = this.activeStyle()
    const press = (b, on) => b.setAttribute('aria-pressed', String(!!on))
    press(T.b, st.b); press(T.i, st.i); press(T.u, st.u); press(T.st, st.st); press(T.wrap, st.wr)
    ;['left', 'center', 'right'].forEach((a, i) => press(T.ha[i], st.ha === a))
    ;['top', 'middle', 'bottom'].forEach((a, i) => press(T.va[i], st.va === a))
    press(T.filter, !!this.sh.filter)
    T.size.value = String(st.fs || 11)
    const nf = st.nf || 'General'
    T.nf.value = NF_OPTIONS.some(([v]) => v === nf) ? nf : 'custom'
    if (T.nf.value === 'custom') { T.nf.options[T.nf.options.length - 1].textContent = nfLabel(nf) === 'Custom' ? 'Custom' : nfLabel(nf) }
    T.undo.disabled = !this.model.undoStack.length
    T.redo.disabled = !this.model.redoStack.length
    this.zoomEl.value = String(Math.round(this.grid.zoom * 100))
    this.zoomLabel.textContent = Math.round(this.grid.zoom * 100) + '%'
  }
  updateStatus() {
    clearTimeout(this.timers.stats)
    this.timers.stats = setTimeout(() => {
      if (!this.grid.sh) return
      const g = this.grid.sel, m = this.model
      let n = 0, sum = 0, min = Infinity, max = -Infinity, count = 0
      const ref = new Ref(this.sh.id, g.r1, g.c1, g.r2, g.c2)
      let budget = 300000
      m.iterRange(ref, (v) => {
        if (budget-- < 0) return
        count++
        if (typeof v === 'number') { n++; sum += v; if (v < min) min = v; if (v > max) max = v }
      })
      const single = g.r1 === g.r2 && g.c1 === g.c2
      const num = (x) => `<b>${generalText(+x.toPrecision(10))}</b>`
      const parts = []
      if (n > 1 || (!single && n > 0)) parts.push(`Average ${num(sum / n)}`, `Count ${num(count)}`, `Numeric ${num(n)}`, `Min ${num(min)}`, `Max ${num(max)}`, `Sum ${num(sum)}`)
      else if (!single && count) parts.push(`Count ${num(count)}`)
      this.statsEl.innerHTML = parts.length ? parts.join(' &nbsp;·&nbsp; ') : (this.sh.filter ? `Filter on &nbsp;·&nbsp; ${Object.keys(this.sh.fHide).length} rows hidden` : 'Ready')
    }, 60)
  }
  onModelChange(info) {
    if (info.struct) { this.ensureSheet(); this.renderTabs() }
    if (info.layout) this.grid.relayout(); else this.grid.invalidate()
    if (this._afterRaf) return
    this._afterRaf = setTimeout(() => {
      this._afterRaf = 0
      if (!this.grid.sh) return
      if (!this.grid.editing) this.fbar.value = this.rawText(this.grid.act.r, this.grid.act.c)
      this.updateToolbar(); this.updateStatus(); this.updateWelcome()
      this.charts.sync()
      if (this.panelName) this.panels[this.panelName].update()
      this.scheduleSave()
    }, 16)
  }

  // ---------- save status / autosave ----------
  setSaveStatus(text, busy = false) {
    this.saveEl.classList.toggle('busy', busy)
    this.saveEl.replaceChildren(icon(busy ? 'loader' : 'circle-check'), h('span', text || (this.savedAt ? `Saved in this browser at ${this.savedAt}` : 'Saved in this browser')))
  }
  scheduleSave() {
    clearTimeout(this.timers.save)
    this.setSaveStatus('Saving...', true)
    this.timers.save = setTimeout(() => this.flushSave(), SAVE_DELAY)
  }
  async flushSave() {
    clearTimeout(this.timers.save)
    if (!this.model) return
    this.model.wb.active = Math.max(0, this.model.sheets.indexOf(this.sh))
    this.grid.saveState()
    try {
      const ok = await idb.set(this.key, { v: 1, ts: Date.now(), json: this.model.toJSON() })
      if (ok) { this.savedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); this.setSaveStatus() } else this.setSaveStatus('Could not save in this browser')
    } catch (e) { console.error(e); this.setSaveStatus('Could not save in this browser') }
  }
  toast(msg, type = 'info') { toast(msg, type) }

  destroy() {
    clearTimeout(this.timers.save); clearTimeout(this.timers.stats); clearTimeout(this._afterRaf)
    this.flushSave()
    this.unsub?.()
    this.grid?.destroy()
    this.charts?.destroy()
    this.ro?.disconnect()
    this.themeMo?.disconnect()
    document.removeEventListener('copy', this.onCopy); document.removeEventListener('cut', this.onCut); document.removeEventListener('paste', this.onPaste)
    window.removeEventListener('beforeunload', this.onUnload)
    document.querySelectorAll('.sx-pop').forEach((p) => p.remove())
  }
}

Object.assign(SheetsApp.prototype, cmd, files)

export async function mount(root, ctx) {
  const app = new SheetsApp(root, ctx)
  await app.start()
  return () => app.destroy()
}
