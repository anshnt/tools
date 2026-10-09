// Pivot table: group by rows and columns, summarize with sum, count, average, min, max and more, with totals and heat map.
import { h, icon, clear, button, field, select, toggle, alert, number } from '../../lib/ui.js'
import { inferTypes, isNumericType, aggregate, AGGREGATES, groupDate, collator, isEmpty, str, num, inferDateOrder, localeDateOrder, plural } from './_table.js'
import { toolFlow, virtualTable, exportBar, statTiles, chipSelect, section, colSelect, nameBase } from './_view.js'

const MAX_COLS = 200
const AGG_LABEL = Object.fromEntries(AGGREGATES.map(([k, l]) => [k, l]))
const DATE_MODES = [['none', 'As written'], ['year', 'Year'], ['quarter', 'Quarter'], ['month', 'Month'], ['day', 'Day'], ['weekday', 'Day of week']]

/**
 * Build a pivot. cfg: { rows: [col], cols: col | -1, values: [{ col, agg }], dateMode, grand: bool, show: 'value'|'pctTotal'|'pctRow'|'pctCol', sort: 'label'|'desc'|'asc', fill, decimals, types }
 * Returns { table, numeric: Set(column index), heat: [{min,max}] , notes }.
 */
export function buildPivot(t, cfg) {
  const types = cfg.types
  const orders = new Map()
  const keyOf = (r, c) => {
    const v = r[c]
    if (cfg.dateMode !== 'none' && (types[c] === 'date' || types[c] === 'datetime')) {
      if (!orders.has(c)) orders.set(c, inferDateOrder(t.rows.slice(0, 2000).map((x) => x[c])) || localeDateOrder())
      const g = groupDate(v, cfg.dateMode, orders.get(c))
      return g ? { label: g.label, sort: g.sort } : { label: '(not a date)', sort: Infinity }
    }
    return { label: isEmpty(v) ? '(blank)' : str(v).trim(), sort: null }
  }
  const values = cfg.values.length ? cfg.values : [{ col: -1, agg: 'count' }]
  const rowKeys = new Map(), colKeys = new Map(), cells = new Map(), rowTot = new Map(), colTot = new Map()
  const all = values.map(() => [])
  const push = (map, key, vi, v) => { let a = map.get(key); if (!a) { a = values.map(() => []); map.set(key, a) } a[vi].push(v) }
  for (const r of t.rows) {
    const rk = cfg.rows.map((c) => keyOf(r, c))
    const rKey = rk.map((k) => k.label).join('\u0001')
    if (!rowKeys.has(rKey)) rowKeys.set(rKey, { labels: rk.map((k) => k.label), sorts: rk.map((k) => k.sort) })
    let cKey = ''
    if (cfg.cols >= 0) { const ck = keyOf(r, cfg.cols); cKey = ck.label; if (!colKeys.has(cKey)) colKeys.set(cKey, ck.sort) }
    values.forEach((v, vi) => {
      const cell = v.col >= 0 ? r[v.col] : 1
      push(cells, `${rKey}\u0002${cKey}`, vi, cell)
      push(rowTot, rKey, vi, cell)
      if (cfg.cols >= 0) push(colTot, cKey, vi, cell)
      all[vi].push(cell)
    })
  }
  const notes = []
  let colList = [...colKeys.keys()]
  colList.sort((a, b) => (colKeys.get(a) != null && colKeys.get(b) != null ? colKeys.get(a) - colKeys.get(b) : collator.compare(a, b)))
  if (colList.length > MAX_COLS) { notes.push(`Showing the first ${MAX_COLS} of ${colList.length} column groups. Pick a column with fewer values.`); colList = colList.slice(0, MAX_COLS) }
  const agg = (arr, vi) => aggregate(arr, values[vi].agg)
  let rowList = [...rowKeys.keys()]
  const natural = (a, b) => { const A = rowKeys.get(a), B = rowKeys.get(b); for (let i = 0; i < A.labels.length; i++) { const sa = A.sorts[i], sb = B.sorts[i]; const d = sa != null && sb != null ? sa - sb : collator.compare(A.labels[i], B.labels[i]); if (d) return d } return 0 }
  rowList.sort(natural)
  if (cfg.sort !== 'label') {
    const val = (k) => { const a = rowTot.get(k); const x = a ? agg(a[0], 0) : 0; return typeof x === 'number' ? x : 0 }
    rowList.sort((a, b) => (cfg.sort === 'desc' ? val(b) - val(a) : val(a) - val(b)) || natural(a, b))
  }
  const grandVals = values.map((_, vi) => agg(all[vi], vi))
  const pct = (x, base) => (typeof x === 'number' && typeof base === 'number' && base ? x / base : '')
  const canPct = (vi) => ['sum', 'count', 'counta'].includes(values[vi].agg) && cfg.show !== 'value'
  const lab = (v) => (v.col >= 0 ? `${AGG_LABEL[v.agg]} of ${t.headers[v.col]}` : 'Count of rows')
  // headers
  const headers = [...cfg.rows.map((c) => t.headers[c])]
  const colDefs = []
  const colsOrSingle = cfg.cols >= 0 ? colList : ['']
  for (const ck of colsOrSingle) values.forEach((v, vi) => { colDefs.push({ ck, vi }); headers.push(cfg.cols >= 0 ? (values.length > 1 ? `${ck} | ${lab(v)}` : ck) : lab(v)) })
  const totalDefs = cfg.grand && cfg.cols >= 0 ? values.map((v, vi) => { headers.push(values.length > 1 ? `Total | ${lab(v)}` : 'Total'); return vi }) : []
  const rows = []
  const numeric = new Set()
  for (let c = cfg.rows.length; c < headers.length; c++) numeric.add(c)
  for (const rk of rowList) {
    const info = rowKeys.get(rk)
    const row = [...info.labels]
    const rt = rowTot.get(rk)
    for (const { ck, vi } of colDefs) {
      const a = cells.get(`${rk}\u0002${ck}`)
      let x = a ? agg(a[vi], vi) : cfg.fill
      if (a && canPct(vi)) {
        const base = cfg.show === 'pctRow' ? agg(rt[vi], vi) : cfg.show === 'pctCol' ? (cfg.cols >= 0 ? agg(colTot.get(ck)[vi], vi) : grandVals[vi]) : grandVals[vi]
        x = pct(x, base)
      }
      row.push(x)
    }
    for (const vi of totalDefs) { const x = agg(rt[vi], vi); row.push(canPct(vi) ? pct(x, cfg.show === 'pctRow' ? x : grandVals[vi]) : x) }
    rows.push(row)
  }
  if (cfg.grand && rows.length) {
    const row = [...cfg.rows.map((_, i) => (i === 0 ? 'Grand total' : ''))]
    for (const { ck, vi } of colDefs) {
      const a = cfg.cols >= 0 ? colTot.get(ck) : [all[vi]]
      const x = cfg.cols >= 0 ? agg(a[vi], vi) : grandVals[vi]
      row.push(canPct(vi) ? pct(x, cfg.show === 'pctCol' ? x : grandVals[vi]) : x)
    }
    for (const vi of totalDefs) row.push(canPct(vi) ? (cfg.show === 'pctTotal' || cfg.show === 'pctRow' || cfg.show === 'pctCol' ? 1 : grandVals[vi]) : grandVals[vi])
    rows.push(row)
  }
  return { table: { headers, rows }, numeric, notes, hasGrand: !!(cfg.grand && rows.length), valueStart: cfg.rows.length, percent: cfg.show !== 'value' }
}

const fmtCell = (v, dec, pctMode) => {
  if (typeof v !== 'number') return v
  if (pctMode) return `${(v * 100).toFixed(dec === 'auto' ? 1 : +dec)}%`
  return dec === 'auto' ? Number(v.toPrecision(10)) : Number(v.toFixed(+dec))
}

export function mount(root) {
  let entry = null, types = [], res = null, shownTable = null
  const o = { rows: [], cols: -1, values: [], dateMode: 'none', grand: true, show: 'value', sort: 'label', fill: '', decimals: 'auto', heat: true }
  const statsHost = h('div'), barHost = h('div'), valHost = h('div', { class: 'stack tight' }), notes = h('div'), rowHost = h('div'), dateHost = h('div')
  const preview = virtualTable({
    height: 480, types: false,
    cellClass: (ri, c) => {
      if (!res || !o.heat) return ''
      const v = res.table.rows[ri][c]
      if (typeof v !== 'number' || c < res.valueStart || (res.hasGrand && ri === res.table.rows.length - 1)) return ''
      const col = res.heat
      if (!col || col.max === col.min) return ''
      const k = Math.min(5, Math.max(1, Math.ceil(((v - col.min) / (col.max - col.min)) * 5)))
      return `dt-heat-${k}`
    },
  })
  const f = toolFlow({
    titles: ['Add your data', 'Build the pivot', 'Review and download'],
    source: { sample: 'sales' },
    onData: (e) => { entry = e; if (e) init() },
  })
  const colPick = colSelect({ headers: [], none: 'No column groups', value: -1, onChange: (c) => { o.cols = c; run() } })

  function init() {
    const t = entry.table
    types = inferTypes(t)
    const cats = t.headers.map((_, i) => i).filter((i) => types[i] === 'text' || types[i] === 'boolean')
    const dates = t.headers.map((_, i) => i).filter((i) => types[i] === 'date' || types[i] === 'datetime')
    o.rows = cats.length ? [cats.find((i) => /region|category|type|status|country|city|product|name/i.test(t.headers[i])) ?? cats[0]] : dates.slice(0, 1)
    o.cols = -1
    o.dateMode = dates.length ? 'month' : 'none'
    const nums = t.headers.map((_, i) => i).filter((i) => isNumericType(types[i]))
    const pref = [/revenue|amount|total|sales/i, /price|value|score|cost/i, /qty|units|count/i].map((re) => nums.find((i) => re.test(t.headers[i]))).find((x) => x != null)
    o.values = nums.length ? [{ col: pref ?? nums[0], agg: 'sum' }] : [{ col: -1, agg: 'count' }]
    colPick.setHeaders(t.headers, false)
    colPick.value = '-1'
    buildRows(); buildValues(); run()
  }
  function buildRows() {
    const t = entry.table
    clear(rowHost, chipSelect({ items: t.headers.map((n, i) => ({ value: i, label: n, type: types[i] })), value: o.rows, bulk: false, label: 'Group rows by', onChange: (v) => { o.rows = v; buildDate(); run() } }))
    buildDate()
  }
  function buildDate() {
    const hasDate = [...o.rows, o.cols].some((c) => c >= 0 && (types[c] === 'date' || types[c] === 'datetime'))
    clear(dateHost, hasDate ? field('Group dates by', select(DATE_MODES, o.dateMode, (v) => { o.dateMode = v; run() })) : null)
  }
  function buildValues() {
    const t = entry.table
    clear(valHost, o.values.map((v, i) => h('div', { class: 'dt-rule' },
      h('span', { class: 'dt-rule-n' }, i === 0 ? 'Show' : 'And'),
      select(AGGREGATES, v.agg, (a) => { v.agg = a; if (a === 'count') v.col = -1; else if (v.col < 0) v.col = Math.max(0, entry.table.headers.findIndex((_, k) => isNumericType(types[k]))); buildValues(); run() }),
      h('span', { class: 'small muted' }, v.agg === 'count' ? 'of rows' : 'of'),
      v.agg === 'count' ? null : colSelect({ headers: t.headers, value: Math.max(0, v.col), label: 'Value column', onChange: (c) => { v.col = c; run() } }),
      o.values.length > 1 ? button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: 'Remove this value', onClick: () => { o.values.splice(i, 1); buildValues(); run() } }) : null)),
    o.values.length < 6 ? button('Add another value', { icon: 'plus', variant: 'ghost', size: 'sm', onClick: () => { o.values.push({ col: Math.max(0, entry.table.headers.findIndex((_, i) => isNumericType(types[i]))), agg: 'avg' }); buildValues(); run() } }) : null)
  }

  function run() {
    if (!entry) return
    const t = entry.table
    if (!o.rows.length && o.cols < 0) { clear(notes, alert('info', 'Pick at least one column to group the rows by.')); return }
    clear(notes)
    const vals = o.values.map((v) => (v.agg !== 'count' && v.agg !== 'counta' && v.agg !== 'distinct' && v.col < 0 ? { ...v, col: 0 } : v)).map((v) => (v.agg === 'count' ? { col: -1, agg: 'count' } : v))
    res = buildPivot(t, { rows: o.rows, cols: o.cols, values: vals, dateMode: o.dateMode, grand: o.grand, show: o.show, sort: o.sort, fill: o.fill, types })
    // heat map: per column min/max over body rows
    res.heat = null
    const body = res.hasGrand ? res.table.rows.slice(0, -1) : res.table.rows
    let min = Infinity, max = -Infinity
    for (const r of body) for (let c = res.valueStart; c < r.length; c++) if (typeof r[c] === 'number') { if (r[c] < min) min = r[c]; if (r[c] > max) max = r[c] }
    if (min < max) res.heat = { min, max }
    // display copy: rounding and percent text
    const pctMode = res.percent
    shownTable = { headers: res.table.headers, rows: res.table.rows.map((r) => r.map((v, c) => (c >= res.valueStart ? fmtCell(v, o.decimals, pctMode) : v))) }
    preview.setTable({ headers: res.table.headers, rows: shownTable.rows }, { types: res.table.headers.map((_, c) => (c >= res.valueStart ? 'number' : 'text')) })
    const grand = res.hasGrand ? res.table.rows.at(-1) : null
    clear(statsHost, statTiles([
      { label: 'Groups', value: res.table.rows.length - (res.hasGrand ? 1 : 0), accent: true }, { label: 'Columns', value: res.table.headers.length },
      ...(grand && !pctMode && typeof grand.at(-1) === 'number' ? [{ label: 'Grand total', value: Number(grand.at(-1).toPrecision(10)).toLocaleString('en', { maximumFractionDigits: 4 }) }] : []),
    ]))
    clear(notes, res.notes.map((n) => alert('warn', n)))
    clear(barHost, exportBar({ getTable: () => shownTable, name: () => `${nameBase(entry)}-pivot`, note: pctMode ? 'Percent cells are exported as text like 12.5%' : undefined }))
  }

  f.s2.body.append(h('div', { class: 'panel stack' },
    section('Rows', 'rows-3', rowHost, dateHost),
    h('hr', { class: 'divider' }),
    section('Columns (optional)', 'columns-3', field('Spread across columns by', colPick)),
    h('hr', { class: 'divider' }),
    section('Values', 'sigma', valHost),
    h('hr', { class: 'divider' }),
    h('div', { class: 'dt-grid' },
      field('Show as', select([['value', 'The calculated value'], ['pctTotal', '% of grand total'], ['pctRow', '% of row total'], ['pctCol', '% of column total']], 'value', (v) => { o.show = v; run() }), 'Percentages work with sum and count.'),
      field('Sort groups', select([['label', 'By name'], ['desc', 'Biggest first'], ['asc', 'Smallest first']], 'label', (v) => { o.sort = v; run() })),
      field('Decimals', select([['auto', 'Automatic'], ['0', '0'], ['1', '1'], ['2', '2'], ['3', '3']], 'auto', (v) => { o.decimals = v; run() })),
      field('Empty cells show', select([['', 'Blank'], ['0', '0'], ['-', '-']], '', (v) => { o.fill = v === '0' ? 0 : v; run() }))),
    h('div', { class: 'row' }, toggle('Totals', true, (v) => { o.grand = v; run() }), toggle('Heat map', true, (v) => { o.heat = v; preview.refresh() }))), notes)
  f.s3.body.append(statsHost, preview.el, barHost)
  root.append(h('style', {}, `
.dt-heat-1 { background: color-mix(in srgb, var(--accent) 7%, var(--surface)) !important; } .dt-heat-2 { background: color-mix(in srgb, var(--accent) 16%, var(--surface)) !important; }
.dt-heat-3 { background: color-mix(in srgb, var(--accent) 27%, var(--surface)) !important; } .dt-heat-4 { background: color-mix(in srgb, var(--accent) 40%, var(--surface)) !important; }
.dt-heat-5 { background: color-mix(in srgb, var(--accent) 55%, var(--surface)) !important; color: var(--text); font-weight: 600; }
.dt-rule { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--border); animation: dtIn .35s var(--ease) both; }
.dt-rule > .select, .dt-rule > .input { flex: 1 1 150px; min-width: 0; width: auto; height: 38px; }
.dt-rule-n { font-size: 12.5px; font-weight: 600; color: var(--muted); min-width: 44px; }
`), f.el)
}
