// Transpose rows and columns of a table.
import { h, clear, toggle, field, select } from '../../lib/ui.js'
import { colName, toTsv, tableToJson, jsonText } from './_table.js'
import { toolFlow, virtualTable, exportBar, statTiles, nameBase } from './_view.js'
import { copyButton } from '../../lib/ui.js'

/** Swap rows and columns. includeHeader: treat the header row as the first row of data. headerFromFirstRow: turn the first row of the result into the header. */
export function flip(t, { includeHeader = true, headerFromFirstRow = false } = {}) {
  const grid = includeHeader ? [t.headers, ...t.rows] : t.rows
  const w = grid.reduce((m, r) => Math.max(m, r.length), 0)
  const cols = []
  for (let c = 0; c < w; c++) cols.push(grid.map((r) => (r[c] == null ? '' : r[c])))
  if (headerFromFirstRow && cols.length) {
    const seen = new Map()
    const headers = cols[0].map((v, i) => {
      let n = String(v ?? '').trim() || `Column ${i + 1}`
      const k = n.toLowerCase(), c = (seen.get(k) || 0) + 1
      seen.set(k, c)
      return c === 1 ? n : `${n}_${c}`
    })
    return { headers, rows: cols.slice(1), header: true }
  }
  const n = cols[0]?.length || 0
  return { headers: Array.from({ length: n }, (_, i) => colName(i)), rows: cols, header: false }
}

export function mount(root) {
  let entry = null, out = null
  const o = { includeHeader: true, firstRow: false }
  const statsHost = h('div'), barHost = h('div')
  const preview = virtualTable({ height: 440, types: false })
  const f = toolFlow({
    titles: ['Add your table', 'Choose how to flip it', 'Check the result and download'],
    source: { sample: 'customers', hint: 'CSV, Excel or JSON. You can also paste rows from a spreadsheet.' },
    onData: (e) => { entry = e; if (e) run() },
  })
  function run() {
    if (!entry) return
    const t = entry.table
    out = flip(t, { includeHeader: o.includeHeader, headerFromFirstRow: o.firstRow })
    preview.setTable(out, { types: [] })
    clear(statsHost, statTiles([
      { label: 'Rows now', value: out.rows.length + (out.header ? 0 : 0), accent: true, hint: `was ${t.rows.length + (o.includeHeader ? 1 : 0)} rows` },
      { label: 'Columns now', value: out.headers.length, hint: `was ${t.headers.length} columns` },
    ]))
    const tbl = () => ({ headers: out.headers, rows: out.rows })
    clear(barHost, exportBar({
      getTable: tbl, name: () => `${nameBase(entry)}-transposed`, formats: ['csv', 'xlsx'], copy: false,
      csv: () => ({ header: out.header }), xlsx: () => ({ header: out.header, freeze: out.header, filter: out.header }),
      items: [{ label: 'Download JSON', icon: 'braces', make: async () => ({ blob: new Blob([out.header ? jsonText(tableToJson(tbl(), { infer: true })) : jsonText(out.rows)], { type: 'application/json' }), name: `${nameBase(entry)}-transposed.json` }) }],
      extra: [copyButton(() => toTsv(tbl(), out.header), 'Copy for Excel', { variant: 'ghost', size: undefined })],
      note: 'Copy pastes straight into Excel or Google Sheets',
    }))
  }
  f.s2.body.append(h('div', { class: 'panel stack' },
    toggle('Flip the header row too (it becomes the first column of the result)', true, (v) => { o.includeHeader = v; run() }),
    toggle('Use the first row of the result as column titles', false, (v) => { o.firstRow = v; run() }),
    h('p', { class: 'small muted' }, 'Example: a table with columns Name and City becomes two rows, one holding the names and one holding the cities.')))
  f.s3.body.append(statsHost, preview.el, barHost)
  root.append(f.el)
}
