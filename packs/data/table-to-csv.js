// Table to CSV: paste or open an HTML table, a Markdown or ASCII table, or cells copied from a spreadsheet or web page.
import { h, clear, field, select, toggle, tabs, formatBytes, alert } from '../../lib/ui.js'
import { toCsv, str } from './_table.js'
import { toolFlow, virtualTable, exportBar, statTiles, nameBase } from './_view.js'

const DELIMS = [[',', 'Comma'], [';', 'Semicolon'], ['\t', 'Tab (TSV)'], ['|', 'Pipe']]

export function mount(root) {
  let entry = null
  const o = { delimiter: ',', quote: 'min', trim: true, header: true, bom: false, lines: true }
  const statsHost = h('div'), textHost = h('div'), barHost = h('div'), notes = h('div')
  const preview = virtualTable({ height: 360 })
  const f = toolFlow({
    titles: ['Paste or open your table', 'Choose the CSV format', 'Copy or download the CSV'],
    source: { sample: 'htmltable', pasteOpen: true, accept: '.html,.htm,.md,.markdown,.txt,.csv,.tsv,text/html', hint: 'Drop an .html, .md or .txt file, or paste below. Copying a table from a web page or Excel works too.' },
    onData: (e) => { entry = e; if (e) run() },
  })
  const tableOf = () => {
    const t = entry.table
    const clean = (v) => { let s = str(v); if (o.trim) s = s.trim().replace(/[ \t]+/g, ' '); if (!o.lines) s = s.replace(/\s*[\r\n]+\s*/g, ' '); return s }
    return { headers: t.headers.map(clean), rows: t.rows.map((r) => r.map(clean)) }
  }
  function run() {
    if (!entry) return
    const t = tableOf()
    preview.setTable(t)
    const csv = toCsv(t, { delimiter: o.delimiter, quote: o.quote, header: o.header })
    clear(statsHost, statTiles([{ label: 'Rows', value: t.rows.length, accent: true }, { label: 'Columns', value: t.headers.length }, { label: 'CSV size', value: formatBytes(new Blob([csv]).size) }, { label: 'Found as', value: { html: 'HTML table', markdown: 'Markdown table', csv: 'Delimited text', json: 'JSON' }[entry.pasteKind] || 'Table' }]))
    clear(notes, entry.pasteKind === 'csv' && entry.table.headers.length === 1 && entry.table.rows.length > 1 ? alert('info', 'Only one column was found. If this was meant to be a table, check the delimiter above, or paste the table with its borders (| or <table>).') : null)
    clear(textHost, h('pre', { class: 'dt-code', tabindex: 0 }, csv.length > 200_000 ? `${csv.slice(0, 200_000)}\n\n... cut off in the preview. The download has everything.` : csv))
    clear(barHost, exportBar({ getTable: () => tableOf(), name: () => nameBase(entry, 'table'), csv: () => ({ delimiter: o.delimiter, quote: o.quote, header: o.header, bom: o.bom }), note: 'Merged cells (rowspan, colspan) are repeated in every cell they cover' }))
  }
  f.s2.body.append(h('div', { class: 'panel stack' }, h('div', { class: 'dt-grid' },
    field('Delimiter', select(DELIMS, ',', (v) => { o.delimiter = v; run() })),
    field('Quote values', select([['min', 'Only when needed'], ['all', 'Every value']], 'min', (v) => { o.quote = v; run() }))),
  h('div', { class: 'row' }, toggle('Trim extra spaces', true, (v) => { o.trim = v; run() }), toggle('Keep line breaks inside cells', true, (v) => { o.lines = v; run() }), toggle('Include the header row', true, (v) => { o.header = v; run() }), toggle('Add a BOM for Excel', false, (v) => { o.bom = v; run() }))), notes)
  f.s3.body.append(statsHost, tabs([{ id: 'csv', label: 'CSV text', render: () => textHost }, { id: 'table', label: 'As a table', render: () => preview.el }], 'csv'), barHost)
  root.append(f.el)
}
