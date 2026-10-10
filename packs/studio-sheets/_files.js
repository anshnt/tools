// File, sheet-tab, menu and dialog actions for the app. Mixed into SheetsApp.prototype, so `this` is the app.
import { h, icon, button, field, select, toggle, modal, progress, download, input, busy, alert } from '../../lib/ui.js'
import { safeName } from '../../lib/files.js'
import { rangeText } from './_a1.js'
import { newSheet, makeCell } from './_model.js'
import { menu, popup, closePopup } from './_menu.js'
import * as ops from './_ops.js'
import { writeXlsx, writeOds } from './_xlsx.js'
import { toCsv, openFile, modelFromDesc } from './_io.js'
import { buildPdf } from './_print.js'
import { TEMPLATES } from './_templates.js'

const MOD = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl+'

export const files = {
  // ---------- sheet tabs ----------
  renderTabs() {
    const bar = this.tabsEl
    const keep = bar.querySelector('.sx-tabadd')
    bar.replaceChildren()
    const sheets = this.model.sheets
    sheets.forEach((sh, i) => {
      const on = sh === this.sh
      const tab = h('button', {
        type: 'button', class: 'sx-tab', role: 'tab', 'aria-selected': String(on), tabindex: on ? 0 : -1, draggable: true, style: sh.color ? { '--tabc': sh.color } : null,
        onclick: () => { if (!on) this.switchSheet(sh) },
        ondblclick: () => this.startRename(sh, tab),
        oncontextmenu: (e) => { e.preventDefault(); this.sheetMenu(sh, e) },
        ondragstart: (e) => { e.dataTransfer.setData('text/x-sheet', String(i)); e.dataTransfer.effectAllowed = 'move' },
        ondragover: (e) => { if ([...e.dataTransfer.types].includes('text/x-sheet')) { e.preventDefault(); tab.classList.add('drop') } },
        ondragleave: () => tab.classList.remove('drop'),
        ondrop: (e) => { e.preventDefault(); tab.classList.remove('drop'); const from = +e.dataTransfer.getData('text/x-sheet'); if (!Number.isNaN(from) && from !== i) this.reorderSheet(from, i) },
        onkeydown: (e) => {
          if (e.key === 'F2') { e.preventDefault(); this.startRename(sh, tab) }
          else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = sheets[(i + (e.key === 'ArrowRight' ? 1 : -1) + sheets.length) % sheets.length]; this.switchSheet(n); this.tabsEl.querySelector('[aria-selected="true"]')?.focus() }
        },
      }, h('span', sh.name))
      tab.dataset.sid = sh.id
      bar.append(tab)
    })
    bar.append(keep || h('button', { type: 'button', class: 'sx-tabadd', 'aria-label': 'Add sheet', title: 'Add sheet', onclick: () => this.addSheet() }, icon('plus')))
    if (!keep) this.tabAdd = bar.lastChild
  },
  startRename(sh, tab) {
    const inp = h('input', { value: sh.name, 'aria-label': 'Sheet name', maxlength: 60 })
    tab.replaceChildren(inp)
    inp.focus(); inp.select()
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      if (ok && inp.value.trim() && inp.value.trim() !== sh.name) this.renameSheet(sh, inp.value.trim())
      this.renderTabs()
      this.grid.focus()
    }
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false) })
    inp.addEventListener('blur', () => finish(true))
    inp.addEventListener('click', (e) => e.stopPropagation())
  },
  switchSheet(sh) {
    if (this.grid.editing) { if (!this.grid.editor.isFormula) this.grid.editor.commit(); }
    this.model.wb.active = this.model.sheets.indexOf(sh)
    this.grid.setSheet(sh)
    this.charts.select(null)
    this.renderTabs()
    this.charts.sync(true)
    this.onSelectionChange()
    this.scheduleSave()
  },
  ensureSheet() {
    if (!this.model.sheets.includes(this.sh)) {
      const sh = this.model.sheets[Math.min(this.model.wb.active, this.model.sheets.length - 1)] || this.model.sheets[0]
      this.sh = sh
      this.grid.setSheet(sh, false)
    }
  },
  addSheet() {
    const name = this.model.uniqueName(`Sheet${this.model.sheets.length + 1}`)
    const sh = newSheet(this.model.nextSid++, name)
    this.guard('Add sheet', () => this.model.setSheets([...this.model.sheets, sh]))
    this.switchSheet(sh)
  },
  deleteSheet(sh) {
    if (this.model.sheets.length < 2) return this.toast('A workbook needs at least one sheet', 'error')
    const go = () => {
      this.guard('Delete sheet', () => this.model.setSheets(this.model.sheets.filter((s) => s !== sh)))
      this.ensureSheet(); this.renderTabs(); this.charts.sync(true); this.onSelectionChange()
    }
    const hasData = sh.cells.size > 0
    if (!hasData) return go()
    const m = modal({ title: `Delete "${sh.name}"?`, icon: 'trash-2', body: h('p', 'The sheet and everything on it will be removed. You can undo this with Ctrl+Z.'), actions: [button('Cancel', { onClick: () => m.close() }), button('Delete sheet', { variant: 'danger', onClick: () => { m.close(); go() } })] })
  },
  duplicateSheet(sh) {
    const copy = newSheet(this.model.nextSid++, this.model.uniqueName(sh.name))
    for (const [k, cell] of sh.cells) {
      const c = cell.f != null ? makeCell(cell.f) : { v: cell.v, f: null }
      if (cell.s) c.s = cell.s
      copy.cells.set(k, c)
    }
    const clone = (o) => JSON.parse(JSON.stringify(o))
    Object.assign(copy, { colW: clone(sh.colW), rowH: clone(sh.rowH), hideR: clone(sh.hideR), hideC: clone(sh.hideC), fHide: clone(sh.fHide), colS: clone(sh.colS), rowS: clone(sh.rowS), freeze: clone(sh.freeze), filter: clone(sh.filter), cf: clone(sh.cf).map((r) => ({ ...r, id: 'cf' + Math.random().toString(36).slice(2, 8) })), merges: clone(sh.merges), color: sh.color, grid: sh.grid, extDirty: true })
    copy.charts = clone(sh.charts).map((c) => ({ ...c, id: 'ch' + Math.random().toString(36).slice(2, 9), src: { ...c.src, sid: c.src.sid === sh.id ? copy.id : c.src.sid } }))
    const arr = [...this.model.sheets]
    arr.splice(arr.indexOf(sh) + 1, 0, copy)
    this.guard('Duplicate sheet', () => this.model.setSheets(arr))
    this.switchSheet(copy)
  },
  renameSheet(sh, name) {
    name = name.replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 60)
    if (!name) return
    const other = this.model.sheetByName(name)
    if (other && other !== sh) return this.toast('Another sheet already uses that name', 'error')
    const old = sh.name
    this.guard('Rename sheet', () => {
      ops.rewriteAll(this.model, (n) => (n.sh && n.sh.toLowerCase() === old.toLowerCase() ? { ...n, sh: name } : n))
      this.model.setProp(sh, 'name', name, true)
    })
    this.renderTabs()
  },
  moveSheet(sh, dir) {
    const i = this.model.sheets.indexOf(sh)
    const j = i + dir
    if (j < 0 || j >= this.model.sheets.length) return
    this.reorderSheet(i, j)
  },
  reorderSheet(from, to) {
    const arr = [...this.model.sheets]
    const [s] = arr.splice(from, 1)
    arr.splice(to, 0, s)
    this.guard('Move sheet', () => this.model.setSheets(arr))
    this.model.wb.active = arr.indexOf(this.sh)
    this.renderTabs()
  },
  sheetMenu(sh, e) {
    menu(this.root, { x: e.clientX, y: e.clientY }, [
      { label: 'Rename', icon: 'pencil', onClick: () => this.startRename(sh, this.tabsEl.querySelector(`[data-sid="${sh.id}"]`)) },
      { label: 'Duplicate', icon: 'copy', onClick: () => this.duplicateSheet(sh) },
      { label: 'Move left', icon: 'arrow-left', onClick: () => this.moveSheet(sh, -1), disabled: this.model.sheets.indexOf(sh) === 0 },
      { label: 'Move right', icon: 'arrow-right', onClick: () => this.moveSheet(sh, 1), disabled: this.model.sheets.indexOf(sh) === this.model.sheets.length - 1 },
      { label: 'Tab color', icon: 'palette', onClick: () => { this.switchSheet(sh); this.pickColor(this.tabsEl, 'tab') } },
      '-', { label: 'Delete', icon: 'trash-2', danger: true, onClick: () => this.deleteSheet(sh) },
    ])
  },

  // ---------- context menu ----------
  contextMenu(e, info) {
    const g = this.grid.sel
    const whole = info.header
    const hasClip = !!this.clip
    const sel = { x: e.clientX, y: e.clientY }
    const items = [
      { label: 'Cut', icon: 'scissors', kbd: `${MOD}X`, onClick: () => this.copySel(true) },
      { label: 'Copy', icon: 'copy', kbd: `${MOD}C`, onClick: () => this.copySel(false) },
      { label: 'Paste', icon: 'clipboard-paste', kbd: `${MOD}V`, onClick: () => this.pasteButton('all') },
      { label: 'Paste values only', icon: 'clipboard-type', onClick: () => this.pasteButton('values'), disabled: !hasClip && false },
      '-',
    ]
    if (whole === 'row') items.push({ label: `Insert ${g.r2 - g.r1 + 1 > 1 ? g.r2 - g.r1 + 1 + ' rows' : 'row'} above`, icon: 'between-horizontal-start', onClick: () => this.insertRC('row') }, { label: 'Delete row' + (g.r2 > g.r1 ? 's' : ''), icon: 'trash-2', onClick: () => this.deleteRC('row') }, { label: 'Hide', icon: 'eye-off', onClick: () => this.hideSel('row', true) }, { label: 'Unhide', icon: 'eye', onClick: () => this.hideSel('row', false) }, { label: 'Row height...', icon: 'move-vertical', onClick: () => this.askSize('row') })
    else if (whole === 'col') items.push({ label: `Insert ${g.c2 - g.c1 + 1 > 1 ? g.c2 - g.c1 + 1 + ' columns' : 'column'} left`, icon: 'between-vertical-start', onClick: () => this.insertRC('col') }, { label: 'Delete column' + (g.c2 > g.c1 ? 's' : ''), icon: 'trash-2', onClick: () => this.deleteRC('col') }, { label: 'Hide', icon: 'eye-off', onClick: () => this.hideSel('col', true) }, { label: 'Unhide', icon: 'eye', onClick: () => this.hideSel('col', false) }, { label: 'Column width...', icon: 'move-horizontal', onClick: () => this.askSize('col') }, { label: 'Autofit width', icon: 'arrow-left-right', onClick: () => this.autofit('col') })
    else items.push(
      { label: 'Insert row above', icon: 'between-horizontal-start', onClick: () => this.insertRC('row') }, { label: 'Insert column left', icon: 'between-vertical-start', onClick: () => this.insertRC('col') },
      { label: 'Delete row', icon: 'trash-2', onClick: () => this.deleteRC('row') }, { label: 'Delete column', icon: 'trash-2', onClick: () => this.deleteRC('col') }, '-',
      { label: 'Clear contents', icon: 'eraser', kbd: 'Del', onClick: () => this.clear('contents') }, { label: 'Clear formats', icon: 'paintbrush', onClick: () => this.clear('formats') }, '-',
      { label: 'Sort A to Z', icon: 'arrow-down-a-z', onClick: () => this.quickSort(false) }, { label: 'Sort Z to A', icon: 'arrow-up-z-a', onClick: () => this.quickSort(true) },
      { label: this.sh.filter ? 'Remove filter' : 'Filter', icon: 'funnel', onClick: () => this.toggleFilter() }, '-',
      { label: 'Merge cells', icon: 'merge', onClick: () => this.mergeSelection(), disabled: g.r1 === g.r2 && g.c1 === g.c2 }, { label: 'Format cells...', icon: 'palette', kbd: `${MOD}1`, onClick: () => this.openPanel('format') })
    menu(this.root, sel, items)
  },
  askSize(kind) {
    const g = this.grid.sel
    const cur = kind === 'row' ? this.axes().row.size(g.r1) : this.axes().col.size(g.c1)
    const inp = input({ type: 'number', value: cur, min: kind === 'row' ? 12 : 20, 'aria-label': kind === 'row' ? 'Row height in pixels' : 'Column width in pixels' })
    const m = modal({ title: kind === 'row' ? 'Row height' : 'Column width', icon: kind === 'row' ? 'move-vertical' : 'move-horizontal', body: field('Pixels', inp), actions: [button('Cancel', { onClick: () => m.close() }), button('Apply', { variant: 'primary', onClick: () => { const v = +inp.value; if (v > 0) { kind === 'row' ? this.setRowHeight(v) : this.setColWidth(v); m.close() } } })] })
    inp.focus(); inp.select()
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const v = +inp.value; if (v > 0) { kind === 'row' ? this.setRowHeight(v) : this.setColWidth(v); m.close() } } })
  },

  // ---------- filter dropdown ----------
  openFilterMenu(c, rect) {
    const sh = this.sh, f = sh.filter
    if (!f) return
    const spec = (f.cols && f.cols[c]) || {}
    const values = ops.distinctValues(this.model, sh, f, c)
    const hide = new Set(spec.hide || [])
    const ops2 = [['', 'No condition'], ['eq', 'Equals'], ['ne', 'Does not equal'], ['contains', 'Contains'], ['notcontains', 'Does not contain'], ['begins', 'Begins with'], ['ends', 'Ends with'], ['gt', 'Greater than'], ['ge', 'At least'], ['lt', 'Less than'], ['le', 'At most'], ['between', 'Between'], ['blank', 'Is blank'], ['notblank', 'Is not blank']]
    const condSel = select(ops2, spec.cond?.op || '', () => {})
    const v1 = input({ value: spec.cond?.v1 ?? '', placeholder: 'Value', 'aria-label': 'Value' })
    const v2 = input({ value: spec.cond?.v2 ?? '', placeholder: 'and', 'aria-label': 'Second value' })
    const search = input({ type: 'search', placeholder: 'Search values', 'aria-label': 'Search values' })
    const all = h('input', { type: 'checkbox', checked: hide.size === 0, 'aria-label': 'Select all' })
    const checks = values.map((x) => ({ x, box: h('input', { type: 'checkbox', checked: !hide.has(x.text) }) }))
    const listEl = h('div', { class: 'sx-fl' })
    const renderList = () => {
      const q = search.value.trim().toLowerCase()
      listEl.replaceChildren(...checks.filter((k) => !q || k.x.text.toLowerCase().includes(q)).map((k) => h('label', k.box, h('span', k.x.text === '' ? '(Blank)' : k.x.text), h('span', { class: 'n' }, String(k.x.n)))))
    }
    search.addEventListener('input', renderList)
    all.addEventListener('change', () => { const q = search.value.trim().toLowerCase(); for (const k of checks) if (!q || k.x.text.toLowerCase().includes(q)) k.box.checked = all.checked })
    renderList()
    const apply = () => {
      const hid = checks.filter((k) => !k.box.checked).map((k) => k.x.text)
      const cond = condSel.value ? { op: condSel.value, v1: v1.value, v2: v2.value } : null
      const cols = { ...(f.cols || {}) }
      if (!hid.length && !cond) delete cols[c]; else cols[c] = { hide: hid, cond }
      this.guard('Filter', () => { this.model.setProp(sh, 'filter', { ...f, cols }, true); ops.applyFilter(this.model, sh) })
      closePopup()
    }
    const sortCol = (desc) => { closePopup(); this.guard('Sort', () => ops.sortRect(this.model, sh, f, [{ col: c, desc }], true)); if (sh.filter) this.guard('Reapply filter', () => ops.applyFilter(this.model, sh)) }
    const box = this.grid.sc.getBoundingClientRect()
    const body = h('div', { class: 'sx-fm' },
      h('div', { class: 'sx-row' }, button('Sort A to Z', { size: 'sm', icon: 'arrow-down-a-z', onClick: () => sortCol(false) }), button('Sort Z to A', { size: 'sm', icon: 'arrow-up-z-a', onClick: () => sortCol(true) })),
      h('div', { class: 'sx-row' }, condSel, v1, v2),
      search,
      h('label', { class: 'sx-row' }, all, h('span', 'Select all')),
      listEl,
      h('div', { class: 'sx-row' }, button('Clear', { size: 'sm', onClick: () => { for (const k of checks) k.box.checked = true; condSel.value = ''; v1.value = ''; v2.value = ''; all.checked = true; apply() } }), h('span', { class: 'sx-spacer' }), button('Cancel', { size: 'sm', onClick: () => closePopup() }), button('Apply', { size: 'sm', variant: 'primary', onClick: apply })))
    popup(this.root, { x: box.left + rect.x + rect.w - 20, y: box.top + rect.y + rect.h }, body, { class: 'sx-menu' })
    body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); apply() } })
    search.focus()
  },

  // ---------- documents ----------
  loadModel(model) {
    this.unsub?.()
    this.model = model
    this.grid.model = model
    this.grid.states.clear()
    this.grid.marquee = null
    this.clip = null
    this.sh = model.sheets[Math.min(model.wb.active || 0, model.sheets.length - 1)]
    this.grid.setSheet(this.sh, false)
    this.unsub = model.on((info) => this.onModelChange(info))
    this.titleIn.value = model.wb.name
    this.charts.app = this
    this.charts.select(null)
    this.renderTabs()
    this.charts.sync(true)
    this.onSelectionChange()
    this.refreshPanels(true)
    this.scheduleSave()
  },
  isDirty() { return this.model.sheets.some((s) => s.cells.size > 0) },
  confirmReplace(then) {
    if (!this.isDirty()) return then()
    const m = modal({
      title: 'Replace the current workbook?', icon: 'triangle-alert',
      body: h('p', 'Your current workbook is kept only in this browser. Download it first if you want a copy; this action cannot be undone.'),
      actions: [button('Cancel', { onClick: () => m.close() }), button('Download .xlsx first', { onClick: async () => { await this.exportXlsx(); m.close(); then() } }), button('Replace', { variant: 'danger', onClick: () => { m.close(); then() } })],
    })
  },
  newWorkbook(template = 'blank') {
    this.confirmReplace(() => {
      const t = TEMPLATES[template] || TEMPLATES.blank
      const m = modelFromDesc(t.build(), { dateOrder: this.model.wb.opts.dateOrder })
      if (template === 'blank') { m.wb.name = 'Untitled'; m.sheets[0].grid = true }
      this.loadModel(m)
      this.grid.focus()
    })
  },
  templatesDialog() {
    const m = modal({
      title: 'Start from a template', icon: 'layout-template',
      body: h('div', { class: 'sx-templates' }, Object.entries(TEMPLATES).map(([k, t]) => h('button', { type: 'button', class: 'sx-tpl', onclick: () => { m.close(); this.newWorkbook(k) } }, icon(t.icon), h('b', t.label), h('small', t.desc)))),
    })
  },
  async openFiles(list) {
    const file = list[0]
    if (!file) return
    this.confirmReplace(async () => {
      this.setSaveStatus('Opening...', true)
      try {
        const { model } = await openFile(file, this.model.wb.opts.dateOrder)
        this.loadModel(model)
        this.toast(`Opened ${file.name}`, 'success')
        this.grid.focus()
      } catch (e) {
        console.error(e)
        this.toast(e.message || 'Could not open that file', 'error')
      } finally { this.setSaveStatus() }
    })
  },
  fileName(ext) { return `${safeName(this.model.wb.name || 'Workbook')}.${ext}` },
  async exportXlsx() {
    this.setSaveStatus('Building .xlsx...', true)
    try {
      const blob = await writeXlsx(this.model)
      download(blob, this.fileName('xlsx'))
      this.toast('Saved as Excel workbook', 'success')
    } catch (e) { console.error(e); this.toast(`Could not build the Excel file: ${e.message}`, 'error') } finally { this.setSaveStatus() }
  },
  async exportOds() {
    try { download(await writeOds(this.model), this.fileName('ods')); this.toast('Saved as OpenDocument spreadsheet. Formatting is not included in .ods files.', 'success') } catch (e) { console.error(e); this.toast(`Could not build the ODS file: ${e.message}`, 'error') }
  },
  exportJson() {
    download(new Blob([JSON.stringify(this.model.toJSON())], { type: 'application/json' }), this.fileName('sheets.json'))
    this.toast('Project saved. It keeps charts, filters and every sheet setting.', 'success')
  },
  exportCsvDialog() {
    const delim = select([[',', 'Comma (,)'], [';', 'Semicolon (;)'], ['\t', 'Tab'], ['|', 'Pipe (|)']], ',')
    const shown = toggle('Save values as shown (formats, dates, currency)', true)
    const bom = toggle('Add a byte-order mark so Excel reads UTF-8', true)
    const m = modal({
      title: `Save "${this.sh.name}" as CSV`, icon: 'file-text',
      body: h('div', { class: 'stack' }, field('Separator', delim), shown, bom, h('p', { class: 'small muted' }, 'CSV holds one sheet of plain values. Use Excel format to keep formulas and formatting.')),
      actions: [button('Cancel', { onClick: () => m.close() }), button('Save CSV', { variant: 'primary', icon: 'download', onClick: () => {
        const text = toCsv(this.model, this.sh, { delimiter: delim.value, displayed: shown.input.checked, bom: bom.input.checked })
        download(new Blob([text], { type: 'text/csv;charset=utf-8' }), this.fileName('csv'))
        m.close()
      } })],
    })
  },
  exportPdfDialog() {
    const g = this.grid.sel
    const multi = g.r1 !== g.r2 || g.c1 !== g.c2
    const what = select([['sheet', 'This sheet (used range)'], ...(multi ? [['selection', `Selection (${rangeText(g)})`]] : []), ...(this.model.sheets.length > 1 ? [['all', 'All sheets']] : [])], multi ? 'selection' : 'sheet')
    const paper = select([['a4', 'A4'], ['letter', 'Letter'], ['a3', 'A3'], ['legal', 'Legal']], 'a4')
    const orient = select([['auto', 'Automatic'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], 'auto')
    const fit = toggle('Fit all columns to the page width', true)
    const grid = toggle('Print gridlines', this.sh.grid)
    const charts = toggle('Add a page for each chart', this.sh.charts.length > 0)
    const foot = toggle('Add a footer with the file name and page numbers', true)
    const prog = progress('Building PDF')
    const result = h('div')
    const go = button('Create PDF', { variant: 'primary', icon: 'file-down' })
    const m = modal({
      title: 'Save as PDF', icon: 'file-down',
      body: h('div', { class: 'stack' }, field('Print', what), h('div', { class: 'grid-2' }, field('Paper', paper), field('Orientation', orient)), fit, grid, charts, foot, prog.el, result,
        h('p', { class: 'small muted' }, 'Pages are drawn exactly as you see them, with a hidden text layer so the PDF stays searchable.')),
      actions: [button('Close', { onClick: () => m.close() }), go],
    })
    go.addEventListener('click', () => busy(go, async () => {
      result.replaceChildren()
      const blob = await buildPdf(this.model, this.sh, { range: what.value === 'selection' ? 'selection' : 'sheet', allSheets: what.value === 'all', sel: this.selectionRect(), paper: paper.value, orientation: orient.value, fit: fit.input.checked, grid: grid.input.checked, charts: charts.input.checked, title: foot.input.checked, font: this.grid.fontFamily }, (f, t) => prog.set(f, t))
      download(blob, this.fileName('pdf'))
      result.replaceChildren(alert('success', 'PDF created and downloaded.'))
    }, { label: 'Building', errorTo: result, progress: prog }))
  },
  saveMenu(anchor) {
    menu(this.root, anchor, [
      { label: 'Excel workbook (.xlsx)', icon: 'file-spreadsheet', kbd: `${MOD}S`, onClick: () => this.exportXlsx() },
      { label: 'PDF...', icon: 'file-down', kbd: `${MOD}P`, onClick: () => this.exportPdfDialog() },
      { label: 'CSV (current sheet)...', icon: 'file-text', onClick: () => this.exportCsvDialog() },
      { label: 'OpenDocument (.ods)', icon: 'file', onClick: () => this.exportOds() },
      '-', { label: 'Project file (.sheets.json)', icon: 'braces', onClick: () => this.exportJson() },
    ], { align: 'end' })
  },
  newMenu(anchor) {
    menu(this.root, anchor, [
      { label: 'Blank workbook', icon: 'file-plus', onClick: () => this.newWorkbook('blank') },
      { label: 'From a template...', icon: 'layout-template', onClick: () => this.templatesDialog() },
    ])
  },
  showShortcuts() {
    const rows = [
      ['Editing', null], ['Edit the cell', 'F2 or double-click'], ['Finish and move down', 'Enter'], ['Finish and move right', 'Tab'], ['Cancel editing', 'Esc'], ['Fill the selection with the entry', `${MOD}Enter`], ['New line in a cell', 'Alt+Enter'], ['Cycle $ in a reference', 'F4'],
      ['Undo and redo', `${MOD}Z, ${MOD}Y`], ['Copy, cut, paste', `${MOD}C, ${MOD}X, ${MOD}V`], ['Paste values only', `${MOD}Shift+V`], ['Fill down, fill right', `${MOD}D, ${MOD}R`], ['Insert today\'s date', `${MOD};`], ['AutoSum', 'Alt+='],
      ['Formatting', null], ['Bold, italic, underline', `${MOD}B, ${MOD}I, ${MOD}U`], ['Strikethrough', `${MOD}5`], ['Format cells panel', `${MOD}1`], ['Percent, currency, number', `${MOD}Shift+5, ${MOD}Shift+4, ${MOD}Shift+1`],
      ['Navigating', null], ['Move one cell', 'Arrow keys'], ['Jump to the edge of data', `${MOD}Arrow`], ['Extend selection', 'Shift+Arrow'], ['Select all', `${MOD}A`], ['Select column, row', `${MOD}Space, Shift+Space`], ['Start, end of data', `${MOD}Home, ${MOD}End`], ['Page up, down', 'PageUp, PageDown'],
      ['Other', null], ['Find, replace', `${MOD}F, ${MOD}H`], ['Save as Excel', `${MOD}S`], ['Zoom', `${MOD}scroll, ${MOD}+ and ${MOD}-`], ['Toggle filter', `${MOD}Shift+L`], ['Delete selected chart', 'Delete'],
    ]
    modal({ title: 'Keyboard shortcuts', icon: 'keyboard', body: h('div', { class: 'sx-keys' }, rows.map(([a, b]) => (b === null ? h('h4', a) : [h('span', a), h('kbd', b)]))) })
  },
}
