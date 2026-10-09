// Format converters: csv-to-excel, excel-to-csv, json-to-csv, csv-to-json, json-to-excel. One module, five focused tools (params.mode).
import { h, icon, clear, field, select, toggle, input, segmented, tabs, alert, debounce, formatBytes, progress, panel, copyButton } from '../../lib/ui.js'
import { zip } from '../../lib/files.js'
import {
  inferTypes, toCsv, tableToJson, jsonText, encodeText, sheetToTable, jsonToTable, findRecordPaths, getPath, pathLabel, isNumericType,
  DELIMITERS, plural, str, localeDateOrder, baseOf,
} from './_table.js'
import { buildXlsx, sheetName } from './_xlsx.js'
import { toolFlow, virtualTable, exportBar, statTiles, section, nameBase, TYPE_SHORT } from './_view.js'

const CSV_ACCEPT = '.csv,.tsv,.txt,.tab,.psv,text/csv'
const EXCEL_ACCEPT = '.xlsx,.xlsm,.xlsb,.xls,.ods,.fods,.xltx'
const JSON_ACCEPT = '.json,.ndjson,.jsonl,application/json,.txt'
const TYPE_OPTS = [['auto', 'Auto'], ['text', 'Text'], ['integer', 'Whole number'], ['number', 'Number'], ['percent', 'Percent'], ['currency', 'Currency'], ['boolean', 'True/False'], ['date', 'Date'], ['datetime', 'Date and time']]
const DATE_ORDER = [['auto', 'Detect from the data'], ['mdy', 'Month / Day / Year'], ['dmy', 'Day / Month / Year']]
const ENC_OPTS = [['utf-8-bom', 'UTF-8 with BOM (best for Excel)'], ['utf-8', 'UTF-8'], ['utf-16le', 'UTF-16 LE'], ['windows-1252', 'Windows-1252 (legacy)']]
const BIG_PREVIEW = 120_000

export function mount(root, { params }) {
  const mode = params.mode
  const fn = { 'csv-to-excel': csvToExcel, 'excel-to-csv': excelToCsv, 'json-to-csv': jsonToCsv, 'csv-to-json': csvToJson, 'json-to-excel': jsonToExcel }[mode]
  if (!fn) throw new Error(`Unknown converter "${mode}"`)
  return fn(root)
}

const code = (text, max = BIG_PREVIEW) => h('pre', { class: 'dt-code', tabindex: 0 }, text.length > max ? `${text.slice(0, max)}\n\n... preview cut off (${formatBytes(text.length)} in total). The download has everything.` : text)

// ---------- CSV to Excel ----------
function csvToExcel(root) {
  const o = { typed: true, freeze: true, filter: true, order: 'auto', layout: 'book' }
  const overrides = new Map()
  let entries = []
  let active = 0
  const prog = progress('Building workbook')
  const sheetInput = input({ placeholder: 'Sheet1', 'aria-label': 'Sheet name', oninput: () => {} })
  const statsHost = h('div'), typesHost = h('div'), barHost = h('div'), tabsHost = h('div')
  const multiField = h('div', { hidden: true }, field('When there are several files', segmented([['book', 'One workbook, a sheet per file'], ['files', 'Separate .xlsx files (ZIP)']], 'book', (v) => { o.layout = v; refresh(false); buildBar() })))
  const preview = virtualTable({ height: 380 })
  const order = () => (o.order === 'auto' ? undefined : o.order)
  const effective = (e) => {
    const det = o.typed ? inferTypes(e.table, { dateOrder: order() }) : e.table.headers.map(() => 'text')
    const ov = overrides.get(e)
    return det.map((t, i) => (ov && ov[i] !== 'auto' ? ov[i] : t))
  }
  const sheetsOf = () => entries.map((e) => ({ name: entries.length === 1 && sheetInput.value.trim() ? sheetInput.value.trim() : baseOf(e.name), headers: e.table.headers, rows: e.table.rows, types: effective(e), freeze: o.freeze, filter: o.filter }))
  const f = toolFlow({
    titles: ['Add your CSV files', 'Choose how it should look in Excel', 'Check the result and download'],
    source: { multiple: true, accept: CSV_ACCEPT, sample: 'sales', hint: 'CSV, TSV or TXT files. Drop several to put them in one workbook.' },
    onData: (list) => { entries = list; active = 0; refresh(true) },
  })

  function refresh(rebuildTypes) {
    if (!entries.length) return
    const e = entries[Math.min(active, entries.length - 1)]
    const types = effective(e)
    preview.setTable(e.table, { types })
    const rows = entries.reduce((a, x) => a + x.table.rows.length, 0)
    const typed = types.filter((t) => t !== 'text' && t !== 'empty').length
    clear(statsHost, statTiles([
      { label: 'Rows', value: rows, accent: true, hint: entries.length > 1 ? `in ${entries.length} files` : undefined },
      { label: 'Columns', value: e.table.headers.length },
      { label: 'Typed columns', value: typed, hint: 'numbers, dates, ...' },
      { label: entries.length > 1 && o.layout === 'files' ? 'Files' : entries.length > 1 ? 'Sheets' : 'Sheet', value: entries.length },
    ]))
    multiField.hidden = entries.length < 2
    if (rebuildTypes) { buildTabs(); buildTypes(e); buildBar() }
  }
  function buildTabs() {
    clear(tabsHost, entries.length > 1 ? segmented(entries.map((e, i) => [i, e.name.length > 22 ? `${e.name.slice(0, 20)}...` : e.name]), active, (i) => { active = i; refresh(false); buildTypes(entries[i]) }, 'Preview file') : null)
  }
  function buildTypes(e) {
    if (!overrides.has(e)) overrides.set(e, e.table.headers.map(() => 'auto'))
    const ov = overrides.get(e)
    const det = o.typed ? inferTypes(e.table, { dateOrder: order() }) : e.table.headers.map(() => 'text')
    clear(typesHost, h('details', { class: 'dt-det' }, h('summary', icon('sliders-horizontal'), `Column types (${e.table.headers.length})`),
      h('div', { class: 'dt-det-body' }, h('div', { class: 'dt-grid' }, e.table.headers.map((name, i) => field(name,
        select(TYPE_OPTS.map(([v, l]) => [v, v === 'auto' ? `Auto: ${TYPE_SHORT[det[i]] || 'Text'}` : l]), ov[i], (v) => { ov[i] = v; refresh(false) })))))))
  }
  function buildBar() {
    const single = entries.length === 1
    clear(barHost, exportBar({
      sticky: true,
      items: [{
        label: single ? 'Download Excel file' : o.layout === 'files' ? 'Download ZIP of .xlsx files' : 'Download one workbook', icon: o.layout === 'files' && !single ? 'archive' : 'file-spreadsheet', primary: true,
        make: async () => {
          const sheets = sheetsOf()
          const opts = { typed: o.typed, dateOrder: order(), onProgress: (p) => prog.set(p, 'Building workbook') }
          if (single || o.layout === 'book') {
            const blob = await buildXlsx(sheets, opts)
            return { blob, name: `${single ? nameBase(entries[0]) : 'combined'}.xlsx` }
          }
          const parts = []
          for (const sh of sheets) parts.push({ name: `${baseOf(entries.find((e) => e.table.headers === sh.headers).name)}.xlsx`, data: await buildXlsx([sh], opts) })
          return { blob: await zip(parts), name: 'xlsx-files.zip' }
        },
      }],
      copy: false,
      note: 'Header row is bold. Leading zeros and long IDs stay as text.',
    }))
  }

  const opts = panel(h('div', { class: 'stack' },
    section('Cell types', 'wand-sparkles',
      toggle('Turn numbers, dates, percentages and currency into real Excel values', true, (v) => { o.typed = v; refresh(true) }),
      field('Dates like 03/04/2024 are', select(DATE_ORDER, 'auto', (v) => { o.order = v; refresh(true) }), `Your region uses ${localeDateOrder() === 'mdy' ? 'month first' : 'day first'}. Dates such as 25/12/2024 are always read correctly.`)),
    h('hr', { class: 'divider' }),
    section('Layout', 'layout-panel-top',
      h('div', { class: 'row' }, toggle('Freeze the header row', true, (v) => { o.freeze = v }), toggle('Filter buttons on the header', true, (v) => { o.filter = v })),
      field('Sheet name (single file)', sheetInput, 'Defaults to the file name.'),
      multiField),
    typesHost))
  f.s2.body.append(opts)
  f.s3.body.append(statsHost, tabsHost, preview.el, prog.el, barHost)
  root.append(f.el)
}

// ---------- Excel to CSV ----------
function excelToCsv(root) {
  const o = { delimiter: ',', quote: 'min', enc: 'utf-8-bom', eol: '\r\n', scope: 'sheet' }
  let entry = null
  const prog = progress('Converting sheets')
  const statsHost = h('div'), textHost = h('div'), warnHost = h('div'), barHost = h('div'), scopeHost = h('div')
  const preview = virtualTable({ height: 360, types: false })
  const csvOpts = () => ({ delimiter: o.delimiter, quote: o.quote, eol: o.eol, header: false })
  const f = toolFlow({
    titles: ['Add your spreadsheet', 'Choose the CSV format', 'Preview and download'],
    source: { accept: EXCEL_ACCEPT, sample: 'workbook', excelOptions: true, header: false, headerToggle: false, hint: 'Excel (.xlsx, .xlsm, .xlsb, .xls) or OpenDocument (.ods) files.', jsonOptions: false },
    onData: (e) => { entry = e; if (e) refresh(true) },
  })

  const encode = (text) => {
    const bom = o.enc === 'utf-8-bom'
    return encodeText(text, o.enc === 'utf-8-bom' ? 'utf-8' : o.enc, bom || o.enc === 'utf-16le')
  }
  function refresh(rebuild) {
    if (!entry) return
    const t = entry.table
    const text = toCsv(t, csvOpts())
    preview.setTable(t, { types: [] })
    const enc = encode(text.length > 2_000_000 ? text.slice(0, 2000) : text)
    clear(warnHost, enc.lossy ? alert('warn', `${plural(enc.lossy, 'character')} cannot be stored in Windows-1252 and will turn into "?". Choose a UTF-8 option to keep them.`) : null)
    clear(statsHost, statTiles([
      { label: 'Rows', value: t.rows.length, accent: true }, { label: 'Columns', value: t.headers.length },
      { label: 'CSV size', value: formatBytes(new Blob([text]).size) }, { label: 'Sheets in file', value: entry.sheets.length },
    ]))
    clear(textHost, code(text.split('\n').slice(0, 60).join('\n')))
    if (rebuild) buildScope()
    buildBar()
  }
  function buildScope() {
    clear(scopeHost, entry.sheets.length > 1 ? field('Sheets to convert', segmented([['sheet', `Only "${entry.sheet.length > 18 ? entry.sheet.slice(0, 16) + '...' : entry.sheet}"`], ['all', `All ${entry.sheets.length} sheets (ZIP)`]], o.scope, (v) => { o.scope = v; buildBar() })) : null)
  }
  function buildBar() {
    const all = o.scope === 'all' && entry.sheets.length > 1
    clear(barHost, exportBar({
      items: [{
        label: all ? 'Download ZIP of CSV files' : 'Download CSV', icon: all ? 'archive' : 'file-text', primary: true,
        make: async () => {
          if (!all) {
            const { bytes } = encode(toCsv(entry.table, csvOpts()))
            return { blob: new Blob([bytes], { type: 'text/csv' }), name: `${nameBase(entry)}${entry.sheets.length > 1 ? `-${entry.sheet}` : ''}.csv` }
          }
          const parts = []
          for (let i = 0; i < entry.sheets.length; i++) {
            prog.set(i / entry.sheets.length, `Converting ${entry.sheets[i]}`)
            const t = sheetToTable(entry.book, entry.sheets[i], { header: false, formatted: entry.opts.formatted, fillMerged: entry.opts.fillMerged })
            parts.push({ name: `${nameBase(entry)}-${entry.sheets[i].replace(/[\\/:*?"<>|]+/g, '_')}.csv`, data: encode(toCsv(t, csvOpts())).bytes })
          }
          prog.hide()
          return { blob: await zip(parts), name: `${nameBase(entry)}-csv.zip` }
        },
      }],
      getTable: () => entry.table, note: `${o.enc === 'utf-8-bom' ? 'UTF-8 BOM' : o.enc.toUpperCase()}, ${{ ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' }[o.delimiter]}-separated`,
    }))
  }
  const opts = panel(h('div', { class: 'dt-grid' },
    field('Delimiter', select(DELIMITERS.slice(1).map(([v, l]) => [v, l]), ',', (v) => { o.delimiter = v; refresh() })),
    field('Encoding', select(ENC_OPTS, 'utf-8-bom', (v) => { o.enc = v; refresh() }), 'Pick the BOM option if Excel shows garbled accents.'),
    field('Quote values', select([['min', 'Only when needed'], ['all', 'Every value']], 'min', (v) => { o.quote = v; refresh() })),
    field('Line endings', select([['\r\n', 'Windows (CRLF)'], ['\n', 'Mac / Linux (LF)']], '\r\n', (v) => { o.eol = v; refresh() }))), scopeHost)
  f.s2.body.append(opts)
  f.s3.body.append(statsHost, warnHost, tabs([{ id: 'csv', label: 'CSV text', render: () => textHost }, { id: 'table', label: 'As a table', render: () => preview.el }]), prog.el, barHost)
  root.append(f.el)
}

// ---------- JSON to CSV ----------
function jsonToCsv(root) {
  const o = { delimiter: ',', quote: 'min', bom: true, header: true, eol: '\n' }
  let entry = null
  const statsHost = h('div'), textHost = h('div'), barHost = h('div')
  const preview = virtualTable({ height: 380 })
  const f = toolFlow({
    titles: ['Add your JSON', 'Choose the CSV format', 'Preview and download'],
    source: { accept: JSON_ACCEPT, sample: 'products', hint: 'A .json file, or JSON Lines (.jsonl). You can also paste JSON.', pasteOpen: false },
    onData: (e) => { entry = e; if (e) refresh() },
  })
  const csvOpts = () => ({ delimiter: o.delimiter, quote: o.quote, eol: o.eol, header: o.header, bom: o.bom })
  function refresh() {
    if (!entry) return
    const t = entry.table
    preview.setTable(t)
    const text = toCsv(t, csvOpts())
    clear(statsHost, statTiles([{ label: 'Rows', value: t.rows.length, accent: true }, { label: 'Columns', value: t.headers.length }, { label: 'CSV size', value: formatBytes(new Blob([text]).size) }]))
    clear(textHost, code(text))
    clear(barHost, exportBar({ formats: ['csv'], getTable: () => entry.table, name: () => nameBase(entry), csv: csvOpts, note: 'Nested objects become columns like address.city' }))
  }
  f.s2.body.append(panel(h('div', { class: 'dt-grid' },
    field('Delimiter', select(DELIMITERS.slice(1), ',', (v) => { o.delimiter = v; refresh() })),
    field('Quote values', select([['min', 'Only when needed'], ['all', 'Every value']], 'min', (v) => { o.quote = v; refresh() })),
    field('Line endings', select([['\n', 'Mac / Linux (LF)'], ['\r\n', 'Windows (CRLF)']], '\n', (v) => { o.eol = v; refresh() })),
    h('div', { class: 'stack tight' }, toggle('Include the header row', true, (v) => { o.header = v; refresh() }), toggle('Add a BOM so Excel reads accents', true, (v) => { o.bom = v; refresh() })))))
  f.s3.body.append(statsHost, tabs([{ id: 'table', label: 'As a table', render: () => preview.el }, { id: 'csv', label: 'CSV text', render: () => textHost }]), barHost)
  root.append(f.el)
}

// ---------- CSV to JSON ----------
function csvToJson(root) {
  const o = { shape: 'objects', infer: true, nest: false, empty: 'null', indent: 2 }
  let entry = null
  const statsHost = h('div'), outHost = h('div'), barHost = h('div')
  let text = ''
  const f = toolFlow({
    titles: ['Add your CSV', 'Choose the JSON shape', 'Copy or download the JSON'],
    source: { accept: `${CSV_ACCEPT},${EXCEL_ACCEPT}`, sample: 'sales', hint: 'CSV, TSV or an Excel sheet. You can also paste rows.' },
    onData: (e) => { entry = e; if (e) refresh() },
  })
  const build = () => {
    const lines = o.shape === 'lines'
    const value = tableToJson(entry.table, { shape: lines ? 'objects' : o.shape, infer: o.infer, nest: o.nest, empty: o.empty })
    text = jsonText(value, { indent: o.indent === 'min' ? 0 : o.indent, lines })
    return { value, lines }
  }
  const refresh = debounce(() => {
    if (!entry) return
    const { value, lines } = build()
    const count = lines || o.shape === 'objects' || o.shape === 'arrays' ? (Array.isArray(value) ? value.length : 0) : entry.table.headers.length
    clear(statsHost, statTiles([
      { label: o.shape === 'columns' ? 'Columns' : 'Records', value: o.shape === 'columns' ? entry.table.headers.length : Math.max(0, count - (o.shape === 'arrays' ? 1 : 0)), accent: true },
      { label: 'Keys per record', value: entry.table.headers.length }, { label: 'JSON size', value: formatBytes(new Blob([text]).size) },
    ]))
    clear(outHost, code(text))
    clear(barHost, exportBar({
      items: [{ label: 'Download JSON', icon: 'braces', primary: true, make: async () => (build(), { blob: new Blob([text], { type: lines ? 'application/x-ndjson' : 'application/json' }), name: `${nameBase(entry)}.${lines ? 'jsonl' : 'json'}` }) }],
      extra: [copyButton(() => (build(), text), 'Copy JSON')], copy: false,
    }))
  }, 120)
  f.s2.body.append(panel(h('div', { class: 'stack' },
    h('div', { class: 'dt-grid' },
      field('Shape', select([['objects', 'Array of objects'], ['arrays', 'Array of arrays (rows)'], ['columns', 'Object of columns'], ['lines', 'JSON Lines (one object per line)']], 'objects', (v) => { o.shape = v; refresh() })),
      field('Empty cells become', select([['null', 'null'], ['', 'empty string'], ['omit', 'left out']], 'null', (v) => { o.empty = v; refresh() })),
      field('Indent', select([[2, '2 spaces'], [4, '4 spaces'], ['tab', 'Tab'], ['min', 'Minified']], 2, (v) => { o.indent = v === 'tab' || v === 'min' ? v : +v; refresh() }))),
    h('div', { class: 'row' }, toggle('Convert numbers and true/false', true, (v) => { o.infer = v; refresh() }), toggle('Nest dotted headers (a.b becomes {a:{b}})', false, (v) => { o.nest = v; refresh() })))))
  f.s3.body.append(statsHost, outHost, barHost)
  root.append(f.el)
}

// ---------- JSON to Excel ----------
function jsonToExcel(root) {
  const o = { typed: true, freeze: true, filter: true, multi: true }
  let entry = null
  const statsHost = h('div'), barHost = h('div'), tabsHost = h('div')
  const preview = virtualTable({ height: 380 })
  const sheetInput = input({ placeholder: 'Sheet1', 'aria-label': 'Sheet name' })
  const multiToggle = h('div', { hidden: true }, toggle('One sheet for each list in the file', true, (v) => { o.multi = v; active = 0; refresh(false) }))
  let active = 0
  const f = toolFlow({
    titles: ['Add your JSON', 'Choose how it should look in Excel', 'Check the result and download'],
    source: { accept: JSON_ACCEPT, sample: 'products', hint: 'A .json file, or JSON Lines (.jsonl). You can also paste JSON.' },
    onData: (e) => { entry = e; active = 0; if (e) refresh(true) },
  })
  const lists = () => {
    const keys = Object.keys(entry.root || {})
    return findRecordPaths(entry.root).filter((x) => x.kind === 'array' && x.path.length && getPath(entry.root, x.path).some((r) => r && typeof r === 'object'))
      .sort((a, b) => keys.indexOf(a.path[0]) - keys.indexOf(b.path[0]))
  }
  function sheets() {
    const base = { freeze: o.freeze, filter: o.filter }
    const flat = { arrays: entry.opts.arrays || 'join', flatten: entry.opts.flatten !== false, sep: entry.opts.sep || '.' }
    const ls = lists()
    if (o.multi && ls.length > 1) return ls.map((c) => ({ ...base, name: String(c.path.at(-1)), ...jsonToTable(entry.root, { path: c.path, ...flat }).table }))
    return [{ ...base, name: sheetInput.value.trim() || nameBase(entry), headers: entry.table.headers, rows: entry.table.rows }]
  }
  function refresh(rebuild) {
    if (!entry) return
    const ss = sheets()
    const s = ss[Math.min(active, ss.length - 1)]
    const t = { headers: s.headers, rows: s.rows }
    preview.setTable(t)
    clear(statsHost, statTiles([{ label: 'Rows', value: ss.reduce((a, x) => a + x.rows.length, 0), accent: true }, { label: 'Columns', value: t.headers.length }, { label: ss.length > 1 ? 'Sheets' : 'Sheet', value: ss.length }]))
    clear(tabsHost, ss.length > 1 ? segmented(ss.map((x, i) => [i, x.name]), active, (i) => { active = i; refresh(false) }, 'Preview sheet') : null)
    if (rebuild) {
      multiToggle.hidden = lists().length < 2
      clear(barHost, exportBar({
        items: [{ label: 'Download Excel file', icon: 'file-spreadsheet', primary: true, make: async () => ({ blob: await buildXlsx(sheets(), { typed: o.typed }), name: `${nameBase(entry)}.xlsx` }) }], copy: false,
        note: 'Header row is bold and frozen.',
      }))
    }
  }
  f.s2.body.append(panel(h('div', { class: 'stack' },
    h('div', { class: 'row' }, toggle('Turn text that looks like dates and numbers into real values', true, (v) => { o.typed = v }), toggle('Freeze the header row', true, (v) => { o.freeze = v }), toggle('Filter buttons on the header', true, (v) => { o.filter = v })),
    field('Sheet name', sheetInput, 'Defaults to the file name.'),
    multiToggle)))
  f.s3.body.append(statsHost, tabsHost, preview.el, barHost)
  root.append(f.el)
}
