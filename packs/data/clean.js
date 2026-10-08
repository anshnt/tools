// CSV cleaner: a live "recipe" of tidy-up steps with a before/after preview and a change report.
import { h, icon, clear, field, input, select, toggle, debounce } from '../../lib/ui.js'
import { inferTypes, isNumericType, isEmpty, parseDate, parseNumberEx, fmtDate, inferDateOrder, localeDateOrder, dedupeRows, uniqueHeaders, str, plural } from './_table.js'
import { toolFlow, virtualTable, exportBar, statTiles, chipSelect, section, nameBase } from './_view.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const p2 = (n) => String(n).padStart(2, '0')
const DATE_FORMATS = {
  iso: (d) => fmtDate(d),
  dmy: (d) => `${p2(d.d)}/${p2(d.m)}/${d.y}${d.hasTime ? ` ${p2(d.H)}:${p2(d.M)}:${p2(d.S)}` : ''}`,
  mdy: (d) => `${p2(d.m)}/${p2(d.d)}/${d.y}${d.hasTime ? ` ${p2(d.H)}:${p2(d.M)}:${p2(d.S)}` : ''}`,
  mon: (d) => `${p2(d.d)} ${MONTHS[d.m - 1]} ${d.y}${d.hasTime ? ` ${p2(d.H)}:${p2(d.M)}` : ''}`,
}
const NOT_NAME = /mail|url|link|id$|code|sku|phone|zip|postal|ref|uuid|hash/i
const INVISIBLE = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F\\u200B-\\u200D\\u2060\\uFEFF]', 'g')
const NBSP = new RegExp('[\\u00A0\\u2007\\u202F]', 'g')
const CURLY_S = new RegExp('[\\u2018\\u2019\\u201B]', 'g')
const CURLY_D = new RegExp('[\\u201C\\u201D\\u201E]', 'g')

/** Re-case text. mode: lower | upper | title | sentence. */
export function recase(s, mode) {
  if (mode === 'lower') return s.toLowerCase()
  if (mode === 'upper') return s.toUpperCase()
  if (mode === 'title') return s.toLowerCase().replace(/(^|[\s\-/(–])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
  if (mode === 'sentence') return s.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
  return s
}
/** Header styles: trim | snake | camel | title | lower | upper. */
export function headerStyle(s, mode) {
  const t = s.trim().replace(/\s+/g, ' ')
  if (mode === 'keep' || mode === 'trim') return t
  const words = t.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean)
  if (mode === 'snake') return words.join('_').toLowerCase()
  if (mode === 'camel') return words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('')
  if (mode === 'title') return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ')
  if (mode === 'lower') return words.join(' ').toLowerCase()
  if (mode === 'upper') return words.join(' ').toUpperCase()
  return t
}
const BOOL = { true: 'true', yes: 'true', y: 'true', t: 'true', 1: 'true', false: 'false', no: 'false', n: 'false', f: 'false', 0: 'false' }

/**
 * Apply the cleaning recipe. Returns { table, report, srcRows, srcCols } where srcRows/srcCols map output positions back to the input.
 * o: { trim, collapse, invisible, quotes, linebreaks, nulls, nullList, caseMode, headers, dates, dateOrder, numbers, decimals, decimalSep, pctToDecimal, bools,
 *      emptyRows, emptyCols, dedupe }, sel: { casing, dates, numbers } column index lists.
 */
export function cleanTable(table, o, types, sel) {
  const rep = {}
  const bump = (k) => { rep[k] = (rep[k] || 0) + 1 }
  const nullSet = new Set(o.nullList.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))
  const nc = table.headers.length
  const casing = new Set(sel.casing), dateCols = new Set(sel.dates), numCols = new Set(sel.numbers)
  const orders = table.headers.map((_, c) => (dateCols.has(c) ? (o.dateOrder === 'auto' ? inferDateOrder(table.rows.slice(0, 3000).map((r) => r[c])) || localeDateOrder() : o.dateOrder) : null))
  let headers = table.headers.map((x) => {
    const n = headerStyle(x, o.headers)
    if (n !== x) bump('headers')
    return n
  })
  headers = uniqueHeaders(headers)
  const rows = []
  const srcRows = []
  table.rows.forEach((row, ri) => {
    const out = new Array(nc)
    for (let c = 0; c < nc; c++) {
      let v = row[c]
      if (typeof v === 'string') {
        let s = v
        if (o.invisible) { const t = s.replace(INVISIBLE, '').replace(NBSP, ' '); if (t !== s) { bump('invisible'); s = t } }
        if (o.quotes) { const t = s.replace(CURLY_S, "'").replace(CURLY_D, '"'); if (t !== s) { bump('quotes'); s = t } }
        if (o.linebreaks) { const t = s.replace(/\s*[\r\n]+\s*/g, ' '); if (t !== s) { bump('linebreaks'); s = t } }
        if (o.collapse) { const t = s.replace(/[ \t]{2,}/g, ' '); if (t !== s) { bump('spaces'); s = t } }
        if (o.trim) { const t = s.trim(); if (t !== s) { bump('trimmed'); s = t } }
        if (o.nulls && s !== '' && nullSet.has(s.trim().toLowerCase())) { bump('nulls'); s = '' }
        if (s !== '' && casing.has(c) && o.caseMode !== 'keep') { const t = recase(s, o.caseMode); if (t !== s) { bump('case'); s = t } }
        if (s !== '' && dateCols.has(c) && o.dates !== 'keep') {
          const d = parseDate(s, orders[c])
          if (d) { const t = DATE_FORMATS[o.dates](d); if (t !== s) { bump('dates'); s = t } }
        }
        if (s !== '' && numCols.has(c) && o.numbers !== 'keep') {
          const p = parseNumberEx(s, o.decimalSep)
          if (p && (!p.pct || o.pctToDecimal)) {
            let n = p.n
            if (o.decimals !== 'keep') n = Number(n.toFixed(+o.decimals))
            const t = o.numbers === 'thousands' ? n.toLocaleString('en-US', { maximumFractionDigits: o.decimals === 'keep' ? 20 : +o.decimals, minimumFractionDigits: o.decimals === 'keep' ? 0 : +o.decimals }) : String(+n.toPrecision(15))
            if (t !== s) { bump('numbers'); s = t }
          }
        }
        if (s !== '' && o.bools) { const t = BOOL[s.toLowerCase()]; if (t && c >= 0 && types[c] === 'boolean' && t !== s) { bump('bools'); s = t } }
        v = s
      }
      out[c] = v
    }
    if (o.emptyRows && out.every(isEmpty)) { bump('emptyRows'); return }
    rows.push(out)
    srcRows.push(ri)
  })
  let t = { headers, rows }
  let srcCols = headers.map((_, i) => i)
  if (o.emptyCols && rows.length) {
    const keep = srcCols.filter((c) => rows.some((r) => !isEmpty(r[c])))
    if (keep.length !== srcCols.length && keep.length) {
      rep.emptyCols = srcCols.length - keep.length
      t = { headers: keep.map((c) => headers[c]), rows: rows.map((r) => keep.map((c) => r[c])) }
      srcCols = keep
    }
  }
  if (o.dedupe) {
    const d = dedupeRows(t, { cols: [], keep: 'first' })
    if (d.removed.length) {
      rep.duplicates = d.removed.length
      const keepSet = new Set(d.table.rows)
      const nr = [], ns = []
      t.rows.forEach((r, i) => { if (keepSet.has(r)) { nr.push(r); ns.push(srcRows[i]) } })
      t = { headers: t.headers, rows: nr }
      srcRows.length = 0
      srcRows.push(...ns)
    }
  }
  return { table: t, report: rep, srcRows, srcCols }
}

const REPORT = [
  ['trimmed', (n) => `${plural(n, 'cell')} had spaces trimmed from the ends`], ['spaces', (n) => `${plural(n, 'cell')} had repeated spaces collapsed`],
  ['invisible', (n) => `${plural(n, 'cell')} had invisible or non-breaking characters cleaned`], ['quotes', (n) => `${plural(n, 'cell')} had curly quotes straightened`],
  ['linebreaks', (n) => `${plural(n, 'cell')} had line breaks replaced by a space`], ['nulls', (n) => `${plural(n, 'placeholder')} like N/A turned into empty cells`],
  ['case', (n) => `${plural(n, 'cell')} changed letter case`], ['dates', (n) => `${plural(n, 'date')} rewritten in one format`],
  ['numbers', (n) => `${plural(n, 'number')} rewritten as plain numbers`], ['bools', (n) => `${plural(n, 'yes/no value')} turned into true/false`],
  ['headers', (n) => `${plural(n, 'header')} renamed`], ['emptyRows', (n) => `${plural(n, 'empty row')} removed`], ['emptyCols', (n) => `${plural(n, 'empty column')} removed`],
  ['duplicates', (n) => `${plural(n, 'duplicate row')} removed`],
]

export function mount(root) {
  let entry = null, types = [], result = null
  const o = {
    trim: true, collapse: true, invisible: true, quotes: false, linebreaks: false, nulls: false, nullList: 'n/a, na, null, none, nil, -, --, ?, missing, #n/a',
    caseMode: 'keep', headers: 'trim', dates: 'keep', dateOrder: 'auto', numbers: 'keep', decimals: 'keep', decimalSep: 'auto', pctToDecimal: false, bools: false,
    emptyRows: true, emptyCols: true, dedupe: false,
  }
  const sel = { casing: [], dates: [], numbers: [] }
  const statsHost = h('div'), reportHost = h('div'), barHost = h('div'), caseHost = h('div'), dateHost = h('div'), numHost = h('div')
  const preview = virtualTable({
    height: 420,
    cellClass: (ri, c) => {
      if (!result) return ''
      const so = result.srcRows[ri], sc = result.srcCols[c]
      return str(entry.table.rows[so]?.[sc]) !== str(result.table.rows[ri][c]) ? 'dt-chg' : ''
    },
    rowClass: () => '',
  })
  const f = toolFlow({
    titles: ['Add the messy file', 'Pick the tidy-up steps', 'Review the changes and download'],
    source: { sample: 'messy', excelOptions: false },
    onData: (e) => { entry = e; if (e) init() },
  })

  function init() {
    types = inferTypes(entry.table)
    const t = entry.table
    sel.casing = []
    sel.dates = t.headers.map((_, i) => i).filter((i) => types[i] === 'date' || types[i] === 'datetime')
    sel.numbers = t.headers.map((_, i) => i).filter((i) => isNumericType(types[i]))
    buildChips()
    run()
  }
  function buildChips() {
    const t = entry.table
    const items = (list) => list.map((i) => ({ value: i, label: t.headers[i], type: types[i] }))
    const textCols = t.headers.map((_, i) => i).filter((i) => types[i] === 'text')
    sel.casing = o.caseMode === 'keep' ? [] : textCols.filter((i) => !NOT_NAME.test(t.headers[i]))
    clear(caseHost, o.caseMode === 'keep' ? null : h('div', { class: 'stack tight' }, h('span', { class: 'small muted' }, 'Apply to these text columns (emails, ids and codes are left out by default)'),
      chipSelect({ items: items(textCols), value: sel.casing, onChange: (v) => { sel.casing = v; run() } })))
    const dcols = t.headers.map((_, i) => i).filter((i) => types[i] === 'date' || types[i] === 'datetime')
    clear(dateHost, o.dates === 'keep' ? null : dcols.length ? chipSelect({ items: items(dcols), value: sel.dates, onChange: (v) => { sel.dates = v; run() } }) : h('span', { class: 'small muted' }, 'No date columns were detected.'))
    const ncols = t.headers.map((_, i) => i).filter((i) => isNumericType(types[i]))
    clear(numHost, o.numbers === 'keep' ? null : ncols.length ? chipSelect({ items: items(ncols), value: sel.numbers, onChange: (v) => { sel.numbers = v; run() } }) : h('span', { class: 'small muted' }, 'No number columns were detected.'))
  }

  const run = debounce(() => {
    if (!entry) return
    result = cleanTable(entry.table, o, types, sel)
    const t = result.table
    preview.setTable(t, { types: result.srcCols.map((c) => types[c]) })
    const changed = Object.entries(result.report).filter(([k]) => !['emptyRows', 'emptyCols', 'duplicates', 'headers'].includes(k)).reduce((a, [, n]) => a + n, 0)
    const removedRows = entry.table.rows.length - t.rows.length
    clear(statsHost, statTiles([
      { label: 'Cells changed', value: changed, accent: true }, { label: 'Rows removed', value: removedRows, hint: `${t.rows.length.toLocaleString()} left` },
      { label: 'Columns removed', value: entry.table.headers.length - t.headers.length }, { label: 'Headers renamed', value: result.report.headers || 0 },
    ]))
    const items = REPORT.filter(([k]) => result.report[k]).map(([k, fn]) => h('li', icon('check'), fn(result.report[k])))
    clear(reportHost, h('ul', { class: 'dt-report' }, items.length ? items : h('li', { class: 'muted' }, icon('sparkles'), 'Nothing to change with these steps. Your data is already tidy, or switch on more steps.')))
    clear(barHost, exportBar({ getTable: () => result.table, name: () => `${nameBase(entry)}-clean`, note: 'Changed cells are marked in the preview' }))
  }, 120)
  const T = (label, key, hint) => toggle(label, o[key], (v) => { o[key] = v; run() })
  const set = (key, rebuild) => (v) => { o[key] = v; if (rebuild) buildChips(); run() }
  f.s2.body.append(h('div', { class: 'dt-recipe' },
    h('div', { class: 'panel stack' }, section('Spaces and invisible characters', 'eraser',
      T('Trim spaces at the start and end', 'trim'), T('Collapse repeated spaces into one', 'collapse'), T('Remove hidden characters and non-breaking spaces', 'invisible'),
      T('Straighten curly quotes', 'quotes'), T('Replace line breaks inside cells with a space', 'linebreaks')),
    h('hr', { class: 'divider' }),
    section('Letter case', 'case-sensitive', field('Change text to', select([['keep', 'Leave as it is'], ['lower', 'lowercase'], ['upper', 'UPPERCASE'], ['title', 'Title Case'], ['sentence', 'Sentence case']], 'keep', set('caseMode', true))), caseHost)),
    h('div', { class: 'panel stack' }, section('Rows, columns and headers', 'rows-3',
      T('Remove empty rows', 'emptyRows'), T('Remove empty columns', 'emptyCols'), T('Remove exact duplicate rows', 'dedupe'),
      field('Header names', select([['trim', 'Tidy spaces only'], ['snake', 'snake_case'], ['camel', 'camelCase'], ['title', 'Title Case'], ['lower', 'lower case'], ['upper', 'UPPER CASE']], 'trim', set('headers')))),
    h('hr', { class: 'divider' }),
    section('Placeholders', 'circle-slash',
      T('Turn placeholders into empty cells', 'nulls'),
      field('Placeholders (comma separated)', input({ value: o.nullList, oninput: (e) => { o.nullList = e.target.value; if (o.nulls) run() } })))),
    h('div', { class: 'panel stack' }, section('Dates', 'calendar-days',
      field('Write dates as', select([['keep', 'Leave as it is'], ['iso', '2024-03-05 (ISO)'], ['dmy', '05/03/2024 (day first)'], ['mdy', '03/05/2024 (month first)'], ['mon', '05 Mar 2024']], 'keep', set('dates', true))),
      field('Dates like 03/04/2024 are', select([['auto', 'Detected from the data'], ['mdy', 'Month / Day / Year'], ['dmy', 'Day / Month / Year']], 'auto', set('dateOrder'))), dateHost),
    h('hr', { class: 'divider' }),
    section('Numbers and yes/no', 'hash',
      field('Write numbers as', select([['keep', 'Leave as they are'], ['plain', 'Plain numbers (1234.5)'], ['thousands', 'With thousands (1,234.5)']], 'keep', set('numbers', true))),
      h('div', { class: 'dt-grid' },
        field('Decimals', select([['keep', 'Keep'], ['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']], 'keep', set('decimals'))),
        field('Decimal mark in the file', select([['auto', 'Detect'], ['.', 'Period (1.5)'], [',', 'Comma (1,5)']], 'auto', set('decimalSep')))),
      T('Turn percentages into decimals (12% becomes 0.12)', 'pctToDecimal'), numHost,
      T('Turn yes / no / 1 / 0 columns into true / false', 'bools')))))
  f.s3.body.append(statsHost, reportHost, preview.el, barHost)
  root.append(h('style', {}, `
.dt-recipe { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 14px; align-items: start; }
.dt-report { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.dt-report li { display: flex; gap: 9px; align-items: center; font-size: 14px; padding: 8px 12px; border-radius: 11px; background: var(--surface); border: 1px solid var(--border); animation: dtIn .4s var(--ease) both; }
.dt-report li .icon { color: var(--success); }
.dt-report li.muted .icon { color: var(--accent); }
`), f.el)
}
