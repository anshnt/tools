// Inspector panels: format, data, charts, rules, functions, find and settings. Each build(app) returns {el, update()}.
import { h, icon, button, field, input, select, segmented, toggle, number } from '../../lib/ui.js'
import { FUNCS, CATS } from './_funcs.js'
import { PRESETS, formatText } from './_fmt.js'
import { colName, rangeText, parseRange } from './_a1.js'
import { CHART_TYPES } from './_charts.js'
import { CF_PRESETS } from './_cf.js'
import { colorPicker } from './_menu.js'
import { displayOf, findAll } from './_ops.js'

const sec = (title, ...kids) => h('div', { class: 'sx-sec' }, title && h('h4', title), ...kids)
const row = (...kids) => h('div', { class: 'sx-row' }, ...kids)
const swatch = (c) => h('span', { style: { width: '14px', height: '14px', borderRadius: '4px', border: '1px solid rgba(0,0,0,.25)', background: c || 'transparent', display: 'inline-block', flex: 'none' } })
const iconBtn = (ic, label, onClick, pressed) => h('button', { type: 'button', class: 'sx-b', 'aria-label': label, 'data-tip': label, 'aria-pressed': pressed === undefined ? null : String(pressed), onclick: onClick }, icon(ic))

// ---------------- Format ----------------
function formatPanel(app) {
  const sample = h('div', { class: 'sx-note' })
  const custom = input({ mono: true, placeholder: 'e.g. 0.00 or dd/mm/yyyy', 'aria-label': 'Custom number format' })
  const list = h('div', { class: 'sx-list' })
  const btns = []
  for (const [label, code, ex] of PRESETS) {
    const b = h('button', { type: 'button', class: 'sx-nfi', onclick: () => { app.setNumberFormat(code); custom.value = code === 'General' ? '' : code } }, h('span', label), h('span', formatText(ex, code)))
    b._code = code
    btns.push(b)
    list.append(b)
  }
  custom.addEventListener('keydown', (e) => { if (e.key === 'Enter') { app.setNumberFormat(custom.value.trim() || 'General'); e.preventDefault() } })
  const size = select([8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72].map((n) => [String(n), `${n} pt`]), '11', (v) => app.applyStyle({ fs: +v === 11 ? null : +v }))
  const fam = select([['', 'Default'], ['serif', 'Serif'], ['mono', 'Monospace']], '', (v) => app.applyStyle({ ff: v || null }))
  const tog = (key, ic, label) => { const b = iconBtn(ic, label, () => app.toggleStyle(key)); b._key = key; return b }
  const tb = [tog('b', 'bold', 'Bold (Ctrl+B)'), tog('i', 'italic', 'Italic (Ctrl+I)'), tog('u', 'underline', 'Underline (Ctrl+U)'), tog('st', 'strikethrough', 'Strikethrough')]
  const fc = button('Text color', { size: 'sm', onClick: (e) => app.pickColor(e.currentTarget, 'fc') })
  const bg = button('Fill color', { size: 'sm', onClick: (e) => app.pickColor(e.currentTarget, 'bg') })
  const ha = segmented([['left', 'Left'], ['center', 'Center'], ['right', 'Right']], '', (v) => app.applyStyle({ ha: v }), 'Horizontal alignment')
  const va = segmented([['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']], 'middle', (v) => app.applyStyle({ va: v === 'middle' ? null : v }), 'Vertical alignment')
  const wrap = toggle('Wrap text', false, (c) => app.setWrap(c))
  const styleSel = select([['thin', 'Thin'], ['medium', 'Medium'], ['thick', 'Thick'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['double', 'Double']], 'thin', (v) => { app.borderStyle = v })
  const bcol = button('Border color', { size: 'sm', onClick: (e) => app.pickColor(e.currentTarget, 'border') })
  const bmodes = [['all', 'grid-3x3', 'All borders'], ['outer', 'square', 'Outer border'], ['inner', 'grid-2x2', 'Inner borders'], ['top', 'panel-top', 'Top'], ['bottom', 'panel-bottom', 'Bottom'], ['left', 'panel-left', 'Left'], ['right', 'panel-right', 'Right'], ['none', 'ban', 'No borders']]
  const rh = number('', { min: 12, max: 600, placeholder: 'auto', ariaLabel: 'Row height' })
  const cw = number('', { min: 20, max: 800, placeholder: 'auto', ariaLabel: 'Column width' })
  rh.addEventListener('change', () => { if (Number.isFinite(rh.valueAsNumber)) app.setRowHeight(rh.valueAsNumber) })
  cw.addEventListener('change', () => { if (Number.isFinite(cw.valueAsNumber)) app.setColWidth(cw.valueAsNumber) })
  const el = h('div', { class: 'sx-pb' },
    sec('Number format', sample, list, field('Custom format code', custom, 'Press Enter to apply. Use 0, #, dd, mm, yyyy, hh:mm and quoted text.'),
      row(button('More decimals', { size: 'sm', icon: 'decimals-arrow-right', onClick: () => app.decimals(1) }), button('Fewer', { size: 'sm', icon: 'decimals-arrow-left', onClick: () => app.decimals(-1) }))),
    sec('Font', row(field('Size', size), field('Family', fam)), row(...tb, fc, bg)),
    sec('Alignment', ha, va, row(wrap, button('Merge', { size: 'sm', icon: 'merge', onClick: () => app.mergeSelection() }), button('Unmerge', { size: 'sm', onClick: () => app.unmergeSelection() })),
      row(button('Indent', { size: 'sm', icon: 'indent-increase', onClick: () => app.indent(1) }), button('Outdent', { size: 'sm', icon: 'indent-decrease', onClick: () => app.indent(-1) }))),
    sec('Borders', h('div', { class: 'sx-bordergrid' }, bmodes.map(([m, ic, l]) => iconBtn(ic, l, () => app.setBorders(m)))), row(styleSel, bcol)),
    sec('Size', row(field('Row height (px)', rh), field('Column width (px)', cw)), row(button('Autofit columns', { size: 'sm', onClick: () => app.autofit('col') }), button('Autofit rows', { size: 'sm', onClick: () => app.autofit('row') }))),
    sec('Clear', row(button('Clear formats', { size: 'sm', onClick: () => app.clear('formats') }), button('Clear contents', { size: 'sm', onClick: () => app.clear('contents') }), button('Clear all', { size: 'sm', variant: 'danger', onClick: () => app.clear('all') }))))
  return {
    el,
    update() {
      const st = app.activeStyle()
      const d = displayOf(app.model, app.sh, app.grid.act.r, app.grid.act.c)
      const nf = st.nf || 'General'
      for (const b of btns) b.classList.toggle('on', b._code === nf)
      if (document.activeElement !== custom) custom.value = nf === 'General' ? '' : nf
      sample.textContent = d.text ? `Active cell shows: ${d.text}` : 'Select a cell to see how it is formatted.'
      size.value = String(st.fs || 11)
      fam.value = st.ff || ''
      for (const b of tb) b.setAttribute('aria-pressed', String(!!st[b._key]))
      fc.replaceChildren(swatch(st.fc || '#111111'), h('span', 'Text color'))
      bg.replaceChildren(swatch(st.bg), h('span', 'Fill color'))
      ha.set(st.ha || '')
      va.set(st.va || 'middle')
      wrap.input.checked = !!st.wr
      styleSel.value = app.borderStyle || 'thin'
      const g = app.grid.sel
      if (document.activeElement !== rh) rh.value = g.r1 === g.r2 ? app.axes().row.size(g.r1) : ''
      if (document.activeElement !== cw) cw.value = g.c1 === g.c2 ? app.axes().col.size(g.c1) : ''
    },
  }
}

// ---------------- Data ----------------
function dataPanel(app) {
  const sortRows = []
  const sortBox = h('div', { class: 'sx-list' })
  const hasHeader = toggle('My data has a header row', true)
  let levels = [{ col: 0, desc: false }]
  const colOptions = () => {
    const g = app.dataRegion()
    const out = []
    for (let c = g.c1; c <= g.c2; c++) {
      const hv = app.model.valueAt(app.sh.id, g.r1, c)
      out.push([String(c), hasHeader.input.checked && hv !== null && hv !== '' ? `${colName(c)} - ${String(displayOf(app.model, app.sh, g.r1, c).text).slice(0, 24)}` : `Column ${colName(c)}`])
    }
    return out
  }
  function renderSort() {
    sortBox.replaceChildren(...levels.map((lv, i) => h('div', { class: 'sx-row' },
      h('span', { class: 'sx-note', style: 'width:48px' }, i ? 'Then by' : 'Sort by'),
      Object.assign(select(colOptions(), String(lv.col), (v) => { lv.col = +v }), { className: 'select grow' }),
      segmented([['asc', 'A-Z'], ['desc', 'Z-A']], lv.desc ? 'desc' : 'asc', (v) => { lv.desc = v === 'desc' }),
      i ? iconBtn('x', 'Remove level', () => { levels.splice(i, 1); renderSort() }) : null)))
  }
  const filterToggle = toggle('Filter buttons on header row', false, () => app.toggleFilter())
  const dupCols = h('div', { class: 'sx-fl' })
  const frz = [['Freeze top row', () => app.setFreeze(1, 0)], ['Freeze first column', () => app.setFreeze(0, 1)], ['Freeze at selection', () => app.setFreeze(app.grid.act.r, app.grid.act.c)], ['Unfreeze', () => app.setFreeze(0, 0)]]
  const el = h('div', { class: 'sx-pb' },
    sec('Sort', hasHeader, sortBox, row(button('Add level', { size: 'sm', icon: 'plus', disabled: false, onClick: () => { if (levels.length < 4) { levels.push({ col: levels.length, desc: false }); renderSort() } } }),
      button('Sort', { size: 'sm', variant: 'primary', icon: 'arrow-down-a-z', onClick: () => app.sortSelection(levels, hasHeader.input.checked) })), h('div', { class: 'sx-note' }, 'Sorts the data around the selected cell. Formulas keep working because their references move with each row.')),
    sec('Filter', filterToggle, row(button('Clear filters', { size: 'sm', onClick: () => app.clearFilters() }), button('Reapply', { size: 'sm', onClick: () => app.reapplyFilter() }))),
    sec('Remove duplicates', dupCols, row(button('Remove duplicate rows', { size: 'sm', icon: 'copy-x', onClick: () => app.removeDuplicates([...dupCols.querySelectorAll('input:checked')].map((i) => +i.value), hasHeader.input.checked) }))),
    sec('Freeze panes', row(...frz.map(([l, f]) => button(l, { size: 'sm', onClick: f })))),
    sec('Rows and columns', row(button('Hide rows', { size: 'sm', onClick: () => app.hideSel('row', true) }), button('Unhide rows', { size: 'sm', onClick: () => app.hideSel('row', false) })), row(button('Hide columns', { size: 'sm', onClick: () => app.hideSel('col', true) }), button('Unhide columns', { size: 'sm', onClick: () => app.hideSel('col', false) }))))
  return {
    el,
    update() {
      const g = app.dataRegion()
      const sig = `${g.c1}-${g.c2}-${g.r1}-${hasHeader.input.checked}-${app.sh.id}`
      if (sig !== this._sig) {
        this._sig = sig
        levels = levels.map((l) => ({ ...l, col: Math.min(Math.max(l.col, g.c1), g.c2) }))
        if (levels[0].col < g.c1 || levels[0].col > g.c2) levels[0].col = g.c1
        renderSort()
        dupCols.replaceChildren(...colOptions().map(([v, l]) => h('label', h('input', { type: 'checkbox', value: v, checked: true }), h('span', l))))
      }
      filterToggle.input.checked = !!app.sh.filter
    },
  }
}

// ---------------- Charts ----------------
function chartsPanel(app) {
  const types = h('div', { class: 'sx-types' }, CHART_TYPES.map(([t, l, ic]) => h('button', { type: 'button', class: 'sx-type', title: l, onclick: () => app.insertChart(t) }, icon(ic), h('span', l))))
  const listBox = h('div', { class: 'sx-list' })
  const settings = h('div', { class: 'sx-sec' })
  let deb = 0
  const patch = (id, p, label) => { clearTimeout(deb); deb = setTimeout(() => app.updateChart(id, p, label || 'Edit chart'), 350) }
  const el = h('div', { class: 'sx-pb' }, sec('Insert chart from selection', types, h('div', { class: 'sx-note' }, 'Select a table with a header row (and labels in the first column), then pick a chart type. Charts float over the sheet: drag to move, drag the corner to resize.')), sec('Charts on this sheet', listBox), settings)
  function renderSettings(ch) {
    if (!ch) { settings.replaceChildren(); return }
    const title = input({ value: ch.title || '', placeholder: 'Chart title', 'aria-label': 'Chart title' })
    title.addEventListener('input', () => patch(ch.id, { title: title.value }))
    const rangeIn = input({ value: rangeText(ch.src), mono: true, 'aria-label': 'Data range' })
    rangeIn.addEventListener('change', () => { const g = parseRange(rangeIn.value); if (g) app.updateChart(ch.id, { src: { ...ch.src, ...g } }, 'Chart data'); else app.toast('Enter a range such as A1:C10', 'error') })
    const type = select(CHART_TYPES.map(([t, l]) => [t, l]), ch.type, (v) => app.updateChart(ch.id, { type: v }, 'Chart type'))
    const by = segmented([['cols', 'Series in columns'], ['rows', 'Series in rows']], ch.by || 'cols', (v) => app.updateChart(ch.id, { by: v }, 'Chart data'))
    const tg = (label, key, def = true) => toggle(label, ch[key] === undefined ? def : ch[key], (c) => app.updateChart(ch.id, { [key]: c }, 'Edit chart'))
    const xt = input({ value: ch.xTitle || '', placeholder: 'Horizontal axis title', 'aria-label': 'Horizontal axis title' })
    const yt = input({ value: ch.yTitle || '', placeholder: 'Vertical axis title', 'aria-label': 'Vertical axis title' })
    xt.addEventListener('input', () => patch(ch.id, { xTitle: xt.value }))
    yt.addEventListener('input', () => patch(ch.id, { yTitle: yt.value }))
    settings.replaceChildren(h('h4', 'Selected chart'), field('Type', type), field('Title', title), field('Data range', rangeIn), by,
      tg('First row holds series names', 'headers'), tg('First column holds labels', 'labels'), tg('Show legend', 'legend'), tg('Smooth lines', 'smooth', false), tg('Start axis at zero', 'zero'),
      row(xt, yt), row(button('Use selection as data', { size: 'sm', onClick: () => app.updateChart(ch.id, { src: { ...app.selectionRect(), sid: app.sh.id } }, 'Chart data') }), button('Delete chart', { size: 'sm', variant: 'danger', icon: 'trash-2', onClick: () => app.deleteChart(ch.id) })))
  }
  return {
    el,
    update() {
      const charts = app.sh.charts
      listBox.replaceChildren(...(charts.length ? charts.map((c) => h('button', { type: 'button', class: ['sx-li', app.charts.selected === c.id && 'on'], onclick: () => { app.charts.select(c.id); app.invalidatePanel('charts') } },
        icon(CHART_TYPES.find((t) => t[0] === c.type)?.[2] || 'chart-column'), h('span', { class: 'grow' }, c.title || 'Untitled chart'), h('small', rangeText(c.src)))) : [h('div', { class: 'sx-empty' }, 'No charts yet.')]))
      const sel = charts.find((c) => c.id === app.charts.selected)
      const key = sel ? JSON.stringify(sel) : ''
      if (key !== this._key) { this._key = key; renderSettings(sel) }
    },
  }
}

// ---------------- Rules (conditional formatting) ----------------
function describeRule(r) {
  const op = { gt: 'greater than', ge: 'at least', lt: 'less than', le: 'at most', eq: 'equal to', ne: 'not equal to', between: 'between', nbetween: 'not between' }
  switch (r.type) {
    case 'cell': return `Value ${op[r.op]} ${r.v1}${r.op.includes('between') ? ' and ' + r.v2 : ''}`
    case 'text': return `Text ${{ contains: 'contains', ncontains: 'does not contain', begins: 'begins with', ends: 'ends with' }[r.op]} "${r.v}"`
    case 'blank': return 'Is blank'
    case 'nblank': return 'Is not blank'
    case 'error': return 'Is an error'
    case 'dup': return 'Duplicate values'
    case 'uniq': return 'Unique values'
    case 'top': return `Top ${r.n}${r.pct ? '%' : ''}`
    case 'bottom': return `Bottom ${r.n}${r.pct ? '%' : ''}`
    case 'above': return 'Above average'
    case 'below': return 'Below average'
    case 'expr': return `Formula =${r.f}`
    case 'scale': return `Color scale${r.c3 ? ' (3 colors)' : ''}`
    case 'bar': return 'Data bars'
    default: return r.type
  }
}
function rulesPanel(app) {
  const listBox = h('div', { class: 'sx-list' })
  const kind = select([['cell', 'Cell value'], ['text', 'Text'], ['blank', 'Blank cells'], ['nblank', 'Cells with content'], ['dup', 'Duplicate values'], ['uniq', 'Unique values'], ['top', 'Top N'], ['bottom', 'Bottom N'], ['above', 'Above average'], ['below', 'Below average'], ['expr', 'Custom formula'], ['scale', 'Color scale'], ['bar', 'Data bars']], 'cell', () => form())
  const rangeIn = input({ mono: true, 'aria-label': 'Apply to range' })
  const params = h('div', { class: 'sx-sec' })
  let preset = 'red', custom = { bg: '#ffeb9c', fc: '#9c5700' }, c1 = '#f8696b', c2 = '#63be7b', c3 = '', barColor = '#638ec6'
  const stylePick = h('div', { class: 'sx-row' })
  function renderStyle() {
    const k = kind.value
    if (k === 'scale') { stylePick.replaceChildren(colorBtn('Low', () => c1, (v) => { c1 = v || c1 }), colorBtn('High', () => c2, (v) => { c2 = v || c2 }), colorBtn('Middle (optional)', () => c3 || '#ffeb84', (v) => { c3 = v || '' })); return }
    if (k === 'bar') { stylePick.replaceChildren(colorBtn('Bar color', () => barColor, (v) => { barColor = v || barColor })); return }
    const opts = Object.entries({ red: 'Light red', yellow: 'Yellow', green: 'Green', blue: 'Blue', boldred: 'Red text', grey: 'Grey', custom: 'Custom' })
    const sel = select(opts, preset, (v) => { preset = v; renderStyle() })
    stylePick.replaceChildren(...[sel, preset === 'custom' ? colorBtn('Fill', () => custom.bg, (v) => { custom.bg = v || undefined }) : null, preset === 'custom' ? colorBtn('Text', () => custom.fc, (v) => { custom.fc = v || undefined }) : null].filter(Boolean))
  }
  function colorBtn(label, get, set) {
    const b = button(label, { size: 'sm', onClick: (e) => colorPicker(app.root, e.currentTarget, { current: get(), onPick: (v) => { set(v); renderStyle() }, noneLabel: 'None' }) })
    b.prepend(swatch(get()))
    return b
  }
  let v1, v2, vt, vn, vf, opSel
  function form() {
    const k = kind.value
    v1 = input({ placeholder: 'Value', 'aria-label': 'Value' }); v2 = input({ placeholder: 'And', 'aria-label': 'Second value' }); vt = input({ placeholder: 'Text', 'aria-label': 'Text' })
    vn = number(10, { min: 1, ariaLabel: 'Count' }); vf = input({ mono: true, placeholder: 'e.g. $B2>100', 'aria-label': 'Formula' })
    opSel = select(k === 'text' ? [['contains', 'contains'], ['ncontains', 'does not contain'], ['begins', 'begins with'], ['ends', 'ends with']] : [['gt', 'greater than'], ['ge', 'at least'], ['lt', 'less than'], ['le', 'at most'], ['eq', 'equal to'], ['ne', 'not equal to'], ['between', 'between'], ['nbetween', 'not between']], k === 'text' ? 'contains' : 'gt')
    const pct = toggle('Percent', false)
    params._pct = pct
    params.replaceChildren(...(k === 'cell' ? [opSel, row(v1, v2)] : k === 'text' ? [opSel, vt] : k === 'top' || k === 'bottom' ? [row(vn, pct)] : k === 'expr' ? [vf, h('div', { class: 'sx-note' }, 'Write the formula for the first cell of the range. References move with each cell, for example =$B2>100 colors a whole row.')] : []))
    renderStyle()
  }
  const add = button('Add rule', { variant: 'primary', icon: 'plus', onClick: () => {
    const range = parseRange(rangeIn.value)
    if (!range) return app.toast('Enter the range this rule applies to, such as B2:B50', 'error')
    const k = kind.value
    const r = { id: 'cf' + Math.random().toString(36).slice(2, 8), range, type: k }
    if (k === 'cell') { Object.assign(r, { op: opSel.value, v1: v1.value, v2: v2.value }); if (v1.value === '') return app.toast('Enter a value to compare with', 'error') }
    else if (k === 'text') Object.assign(r, { op: opSel.value, v: vt.value })
    else if (k === 'top' || k === 'bottom') Object.assign(r, { n: Math.max(1, vn.valueAsNumber || 10), pct: params._pct.input.checked })
    else if (k === 'expr') { if (!vf.value.trim()) return app.toast('Enter a formula', 'error'); r.f = vf.value.trim().replace(/^=/, '') }
    if (k === 'scale') Object.assign(r, { c1, c2, c3: c3 || undefined })
    else if (k === 'bar') r.color = barColor
    else r.style = preset === 'custom' ? { ...custom } : { ...CF_PRESETS[preset] }
    app.addRule(r)
  } })
  form()
  const el = h('div', { class: 'sx-pb' }, sec('Rules on this sheet', listBox), sec('New rule', field('Format', kind), field('Apply to', rangeIn), params, field('Style', stylePick), row(add, button('Use selection', { size: 'sm', onClick: () => { rangeIn.value = rangeText(app.selectionRect()) } }))))
  return {
    el,
    update() {
      const rules = app.sh.cf
      listBox.replaceChildren(...(rules.length ? rules.map((r) => h('div', { class: 'sx-li' }, swatch(r.style?.bg || r.c1 || r.color || r.style?.fc), h('span', { class: 'grow' }, h('b', rangeText(r.range)), ' ', h('small', describeRule(r))), iconBtn('trash-2', 'Delete rule', () => app.deleteRule(r.id)))) : [h('div', { class: 'sx-empty' }, 'No rules yet. Highlight values, find duplicates or add color scales and data bars.')]))
      if (!rangeIn.value || !this._init) { rangeIn.value = rangeText(app.selectionRect()); this._init = true }
    },
  }
}

// ---------------- Functions ----------------
function functionsPanel(app) {
  const q = input({ placeholder: 'Search functions', 'aria-label': 'Search functions', type: 'search' })
  let cat = 'All'
  const cats = h('div', { class: 'sx-row tight' })
  const list = h('div', { class: 'sx-list' })
  const all = Object.values(FUNCS).sort((a, b) => a.name.localeCompare(b.name))
  function render() {
    const t = q.value.trim().toUpperCase()
    const items = all.filter((f) => (cat === 'All' || f.cat === cat) && (!t || f.name.includes(t) || f.desc.toUpperCase().includes(t))).slice(0, 80)
    list.replaceChildren(...(items.length ? items.map((f) => h('button', { type: 'button', class: 'sx-li', onclick: () => app.insertFunction(f.name), title: f.desc, style: 'display:grid;gap:2px' }, h('div', h('b', f.name), h('small', ` (${f.sig})`)), h('small', f.desc))) : [h('div', { class: 'sx-empty' }, 'No function matches.')]))
    cats.replaceChildren(...['All', ...CATS].map((c) => h('button', { type: 'button', class: ['sx-chip', 'sx-catchip'], style: c === cat ? 'background:var(--accent);color:var(--accent-text);border:0;cursor:pointer' : 'cursor:pointer;border:0;color:var(--text)', onclick: () => { cat = c; render() } }, c)))
  }
  q.addEventListener('input', render)
  render()
  return { el: h('div', { class: 'sx-pb' }, h('div', { class: 'sx-note' }, `${all.length} functions. Click one to insert it into the formula you are editing.`), q, cats, list), update() {} }
}

// ---------------- Find ----------------
function findPanel(app) {
  const f = input({ placeholder: 'Find', 'aria-label': 'Find', type: 'search' })
  const r = input({ placeholder: 'Replace with', 'aria-label': 'Replace with' })
  const mc = toggle('Match case', false), wc = toggle('Entire cell', false), fo = toggle('Search formulas', false), aw = toggle('All sheets', false)
  const out = h('div', { class: 'sx-list', style: 'gap:0' })
  const info = h('div', { class: 'sx-found' })
  let hits = [], idx = -1
  const opts = () => ({ text: f.value, matchCase: mc.input.checked, wholeCell: wc.input.checked, formulas: fo.input.checked, allSheets: aw.input.checked, sheet: app.sh })
  function search() {
    hits = findAll(app.model, opts())
    idx = -1
    info.textContent = f.value ? `${hits.length} match${hits.length === 1 ? '' : 'es'}` : ''
    out.replaceChildren(...hits.slice(0, 200).map((h2, i) => { const sh = app.model.sheet(h2.sid); return h('button', { type: 'button', class: 'sx-hit', onclick: () => { idx = i; app.goTo(h2) } }, h('b', `${aw.input.checked ? sh.name + '!' : ''}${colName(h2.c)}${h2.r + 1}`), h('span', h2.text)) }))
    if (hits.length > 200) out.append(h('div', { class: 'sx-note', style: 'padding:6px 9px' }, `Showing the first 200 of ${hits.length}.`))
  }
  function next(dir = 1) {
    if (!hits.length) search()
    if (!hits.length) return
    idx = (idx + dir + hits.length) % hits.length
    app.goTo(hits[idx])
  }
  f.addEventListener('input', search)
  f.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); next(e.shiftKey ? -1 : 1) } })
  for (const t of [mc, wc, fo, aw]) t.input.addEventListener('change', search)
  const el = h('div', { class: 'sx-pb' }, sec(null, f, r, row(mc, wc), row(fo, aw)),
    row(button('Find next', { size: 'sm', icon: 'search', onClick: () => next(1) }), button('Previous', { size: 'sm', onClick: () => next(-1) }), button('Replace', { size: 'sm', onClick: () => { if (!hits.length) search(); if (idx < 0) next(1); else { app.replaceHit(hits[idx], opts(), r.value); search() } } }), button('Replace all', { size: 'sm', variant: 'primary', onClick: () => { app.replaceAll(opts(), r.value); search() } })),
    info, out)
  return { el, update() {}, focus() { f.focus(); f.select() }, search, setText(t) { f.value = t; search() } }
}

// ---------------- Settings ----------------
function settingsPanel(app) {
  const order = select([['dmy', 'Day / Month / Year (31/12/2025)'], ['mdy', 'Month / Day / Year (12/31/2025)']], 'dmy', (v) => app.setDateOrder(v))
  const grid = toggle('Show gridlines', true, (c) => app.setGrid(c))
  const touch = toggle('Touch select mode (drag to select cells)', false, (c) => app.setTouchSelect(c))
  const zoom = select([['0.5', '50%'], ['0.75', '75%'], ['1', '100%'], ['1.25', '125%'], ['1.5', '150%'], ['2', '200%']], '1', (v) => app.setZoom(+v))
  const tabc = button('Sheet tab color', { size: 'sm', onClick: (e) => app.pickColor(e.currentTarget, 'tab') })
  return {
    el: h('div', { class: 'sx-pb' },
      sec('Workbook', field('Typed dates are read as', order, 'Applies when you type or paste dates such as 05/06/2025.')),
      sec('This sheet', grid, tabc),
      sec('View', field('Zoom', zoom), touch),
      sec('Help', row(button('Keyboard shortcuts', { size: 'sm', icon: 'keyboard', onClick: () => app.showShortcuts() }))),
      sec('Good to know', h('div', { class: 'sx-note' }, 'Your work is saved in this browser automatically. Use Save to download an Excel file. Charts, filters and conditional formats are kept in .xlsx files, but charts are only drawn inside this editor and the PDF export.'))),
    update() { order.value = app.model.wb.opts.dateOrder; grid.input.checked = app.sh.grid; zoom.value = String(app.grid.zoom); tabc.replaceChildren(swatch(app.sh.color || 'var(--accent)'), h('span', 'Sheet tab color')); touch.input.checked = app.grid.touchSelect },
  }
}

export const PANELS = {
  format: { label: 'Format cells', icon: 'palette', build: formatPanel },
  data: { label: 'Data tools', icon: 'arrow-up-down', build: dataPanel },
  charts: { label: 'Charts', icon: 'chart-column', build: chartsPanel },
  rules: { label: 'Conditional formatting', icon: 'wand-sparkles', build: rulesPanel },
  functions: { label: 'Functions', icon: 'square-function', build: functionsPanel },
  find: { label: 'Find and replace', icon: 'search', build: findPanel },
  settings: { label: 'Settings', icon: 'settings', build: settingsPanel },
}
