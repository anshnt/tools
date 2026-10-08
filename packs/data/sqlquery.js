// Query CSV with SQL: load files into an in-browser SQLite database (sql.js WebAssembly), run SELECTs, export results.
// Second tab: run a SQL script (CREATE TABLE and INSERT statements) and export every table as CSV.
import { h, icon, clear, button, busy, alert, tabs, field, toggle, textarea, formatBytes, onCleanup, yieldToMain, progress, dropzone, toast, download } from '../../lib/ui.js'
import { script } from '../../lib/libs.js'
import { zip } from '../../lib/files.js'
import { inferTypes, sqlName, baseOf, toCsv, parseNumber, plural, isNumericType, isEmpty, str, sheetToTable } from './_table.js'
import { toolFlow, virtualTable, exportBar, statTiles, tableSource, step, flow, nameBase, section, injectStyles } from './_view.js'

const SQLJS = 'https://cdn.jsdelivr.net/npm/sql.js@1.14.1/dist/'
let sqlPromise = null
const loadSql = () => (sqlPromise ||= script(`${SQLJS}sql-wasm.js`).then(() => window.initSqlJs({ locateFile: (f) => `${SQLJS}${f}` })).catch((e) => { sqlPromise = null; throw Object.assign(new Error('Could not load the SQL engine. Check your connection and try again.'), { cause: e }) }))

/** Make a MySQL / phpMyAdmin dump readable by SQLite. */
export function cleanDump(sql) {
  let s = sql.replace(/\/\*![\s\S]*?\*\/\s*;?/g, '')
  s = s.replace(/^\s*(LOCK TABLES|UNLOCK TABLES|SET\s+[@\w]|USE\s+|START TRANSACTION|DELIMITER)[^\n;]*;?\s*$/gim, '')
  s = s.replace(/\)\s*(ENGINE|DEFAULT CHARSET|AUTO_INCREMENT|COLLATE|ROW_FORMAT|CHARSET)\b[^;]*;/gi, ');')
  s = s.replace(/^\s*(UNIQUE\s+)?KEY\s+[^\n]*$/gim, '').replace(/,\s*\n\s*\)/g, '\n)')
  s = s.replace(/\s+AUTO_INCREMENT\b(?!\s*=)/gi, '').replace(/\s+unsigned\b/gi, '').replace(/\s+COMMENT\s+'(?:[^']|'')*'/gi, '')
  s = s.replace(/\s+(CHARACTER SET|CHARSET)\s+\w+/gi, '').replace(/\s+COLLATE\s+\w+/gi, '')
  s = s.replace(/\\'/g, "''").replace(/\\"/g, '"')
  return s
}

const EXAMPLE_SCRIPT = `-- A tiny shop database. Edit it, or paste your own dump.
CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, city TEXT);
INSERT INTO customers VALUES (1, 'Asha Verma', 'Pune'), (2, 'Ben Carter', 'Austin'), (3, 'Chloe Martin', 'Lyon');
CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, item TEXT, qty INTEGER, price REAL);
INSERT INTO orders (customer_id, item, qty, price) VALUES
  (1, 'Keyboard', 2, 49.0), (1, 'Mouse', 1, 25.5), (2, 'Monitor', 1, 229.0), (3, 'Webcam', 3, 59.9);
SELECT c.name, SUM(o.qty * o.price) AS spent FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY c.name ORDER BY spent DESC;
`

export function mount(root) {
  injectStyles()
  let SQL = null
  const state = { db: null, tables: [] }
  const cleanups = []
  onCleanup(() => { try { state.db?.close() } catch { /* closed */ } })

  // ---------------- Tab 1: query files ----------------
  const schemaHost = h('div', { class: 'dt-schema' })
  const editor = textarea({ rows: 6, mono: true, spellcheck: false, 'aria-label': 'SQL query', placeholder: 'SELECT * FROM sales LIMIT 20;' })
  const ideas = h('div', { class: 'dt-feat' })
  const errHost = h('div'), statsHost = h('div'), barHost = h('div')
  const result = virtualTable({ height: 420 })
  const resultWrap = h('div', { class: 'stack' }, statsHost, result.el, barHost)
  resultWrap.hidden = true
  let last = null
  const run = button('Run query', { icon: 'play', variant: 'primary', size: 'lg' })

  const f = toolFlow({
    titles: ['Add your files', 'Write a query', 'Results'],
    source: { multiple: true, sample: ['sales', 'customers'], hint: 'CSV, Excel or JSON files. Each file (and each Excel sheet) becomes a table you can query.', excelOptions: false, headerToggle: true },
    onData: (list) => { load(list).catch((e) => clear(errHost, alert('error', e.message))) },
  })

  async function load(entries) {
    clear(errHost)
    try { state.db?.close() } catch { /* ignore */ }
    state.db = null
    state.tables = []
    if (!entries.length) { clear(schemaHost); clear(ideas); resultWrap.hidden = true; return }
    SQL ||= await loadSql()
    const db = new SQL.Database()
    const used = new Set()
    const defs = []
    for (const e of entries) {
      const sheets = e.kind === 'excel' ? e.sheets : [null]
      for (const sh of sheets) {
        const t = sh == null || sh === e.sheet ? e.table : sheetToTable(e.book, sh, { header: e.opts.header, formatted: e.opts.formatted, fillMerged: e.opts.fillMerged })
        const base = baseOf(e.name).replace(/[-_ ]?sample$/i, '')
        defs.push({ name: sqlName(sh == null || sheets.length === 1 ? base : `${base}_${sh}`, used), table: t })
      }
    }
    for (const d of defs) {
      const types = inferTypes(d.table)
      const colNames = new Set()
      const cols = d.table.headers.map((hd, i) => ({ name: sqlName(hd, colNames), type: types[i] }))
      const sqlType = (t) => (t === 'integer' ? 'INTEGER' : t === 'number' || t === 'currency' || t === 'percent' ? 'REAL' : 'TEXT')
      db.run(`CREATE TABLE "${d.name}" (${cols.map((c) => `"${c.name}" ${sqlType(c.type)}`).join(', ')})`)
      const stmt = db.prepare(`INSERT INTO "${d.name}" VALUES (${cols.map(() => '?').join(',')})`)
      db.run('BEGIN')
      for (let i = 0; i < d.table.rows.length; i++) {
        const r = d.table.rows[i]
        stmt.run(cols.map((c, k) => {
          const v = r[k]
          if (isEmpty(v)) return null
          if (isNumericType(c.type)) { const n = parseNumber(v); return n == null ? String(v) : n }
          return typeof v === 'number' || typeof v === 'string' ? v : String(v)
        }))
        if (i % 25000 === 24999) await yieldToMain()
      }
      db.run('COMMIT')
      stmt.free()
      d.cols = cols
      d.rows = d.table.rows.length
    }
    state.db = db
    state.tables = defs
    drawSchema()
    const first = defs[0]
    editor.value = `SELECT * FROM "${first.name}" LIMIT 20;`
    drawIdeas()
    await exec()
  }

  const insert = (txt) => { const s = editor.selectionStart ?? editor.value.length; editor.setRangeText(txt, s, editor.selectionEnd ?? s, 'end'); editor.focus() }
  const colChip = (c) => h('button', { type: 'button', class: 'dt-chip', title: `Insert ${c.name}`, onclick: () => insert(`"${c.name}"`) },
    h('span', c.name), h('small', { class: 'muted' }, c.type === 'integer' ? 'int' : c.type))
  function drawSchema() {
    clear(schemaHost, state.tables.map((t) => {
      const useBtn = button('Use table', { size: 'sm', variant: 'ghost', icon: 'corner-down-left', onClick: () => insert(`"${t.name}"`) })
      return h('details', { class: 'dt-det', open: state.tables.length <= 3 },
        h('summary', icon('table'), h('b', t.name), h('span', { class: 'small muted' }, `${t.rows.toLocaleString()} rows`)),
        h('div', { class: 'dt-det-body' }, h('div', { class: 'row', style: 'gap:6px' }, useBtn, t.cols.map(colChip))))
    }))
  }
  function drawIdeas() {
    const q = []
    const t = state.tables[0]
    const text = t.cols.find((c) => c.type === 'text')
    const num = t.cols.find((c) => isNumericType(c.type) && c.type !== 'integer') || t.cols.find((c) => isNumericType(c.type))
    const date = t.cols.find((c) => c.type === 'date' || c.type === 'datetime')
    q.push(['Preview rows', `SELECT * FROM "${t.name}" LIMIT 20;`], ['Count rows', `SELECT COUNT(*) AS total_rows FROM "${t.name}";`])
    if (text) q.push([`Rows per ${text.name}`, `SELECT "${text.name}", COUNT(*) AS rows${num ? `, ROUND(SUM("${num.name}"), 2) AS total` : ''}\nFROM "${t.name}"\nGROUP BY "${text.name}"\nORDER BY ${num ? 'total' : 'rows'} DESC;`])
    if (date && num) q.push(['Per month', `SELECT strftime('%Y-%m', "${date.name}") AS month, ROUND(SUM("${num.name}"), 2) AS total\nFROM "${t.name}"\nGROUP BY month\nORDER BY month;`])
    if (state.tables.length > 1) {
      const [a, b] = state.tables
      const shared = a.cols.find((c) => b.cols.some((d) => d.name === c.name))
      if (shared) q.push(['Join two tables', `SELECT a.*, b.*\nFROM "${a.name}" a\nJOIN "${b.name}" b ON a."${shared.name}" = b."${shared.name}"\nLIMIT 50;`])
    }
    if (num) q.push([`Top 10 by ${num.name}`, `SELECT * FROM "${t.name}"\nORDER BY "${num.name}" DESC\nLIMIT 10;`])
    clear(ideas, q.map(([l, sql]) => h('button', { type: 'button', class: 'dt-chip', onclick: () => { editor.value = sql; exec() } }, h('span', l))))
  }

  async function exec() {
    if (!state.db) return
    const sql = editor.value.trim()
    if (!sql) { clear(errHost, alert('info', 'Type a query first, for example SELECT * FROM sales LIMIT 10;')); return }
    clear(errHost)
    const t0 = performance.now()
    let sets
    try { sets = state.db.exec(sql) } catch (e) { resultWrap.hidden = true; clear(errHost, alert('error', h('div', h('strong', 'SQL error: '), e.message))); return }
    const ms = performance.now() - t0
    if (!sets.length) { resultWrap.hidden = true; clear(errHost, alert('success', 'The statement ran. It did not return rows. Only this in-browser copy changes, never your files.')); return }
    const set = sets[sets.length - 1]
    const CAP = 300000
    const rows = set.values.length > CAP ? set.values.slice(0, CAP) : set.values
    last = { headers: set.columns, rows: rows.map((r) => r.map((v) => (v == null ? '' : v))) }
    resultWrap.hidden = false
    result.setTable(last)
    clear(statsHost, statTiles([{ label: 'Rows returned', value: set.values.length, accent: true }, { label: 'Columns', value: set.columns.length }, { label: 'Time', value: `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms` }]))
    if (set.values.length > CAP) clear(errHost, alert('warn', `Showing the first ${CAP.toLocaleString()} rows. Add a LIMIT or a WHERE to narrow it down.`))
    clear(barHost, exportBar({ getTable: () => last, name: () => 'query-result' }))
  }
  run.addEventListener('click', () => exec())
  editor.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); exec() } })

  f.s2.body.append(h('div', { class: 'dt-sqlgrid' }, h('div', { class: 'panel stack' }, h('h3', { style: 'font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em' }, 'Tables'), schemaHost),
    h('div', { class: 'stack' }, editor, h('div', { class: 'row' }, run, h('span', { class: 'small muted' }, 'Ctrl + Enter runs it. SQLite syntax.')), ideas)), errHost)
  f.s3.body.append(resultWrap)

  // ---------------- Tab 2: SQL script to CSV ----------------
  const script2 = textarea({ rows: 14, mono: true, spellcheck: false, value: EXAMPLE_SCRIPT, 'aria-label': 'SQL script' })
  const out2 = h('div', { class: 'stack' }), err2 = h('div')
  const prog2 = progress('Running script')
  const clean = { on: true }
  let produced = []
  const run2 = button('Run script', { icon: 'play', variant: 'primary', size: 'lg' })
  const drop2 = dropzone({ accept: '.sql,.txt,text/plain', label: 'Drop a .sql file here, or click to choose', hint: 'phpMyAdmin, mysqldump and SQLite dumps work. Or paste below.', compact: true, onFiles: async ([file]) => { script2.value = await file.text(); toast(`Loaded ${file.name}`, 'success') } })
  run2.addEventListener('click', () => busy(run2, async () => {
    clear(err2); clear(out2)
    SQL ||= await loadSql()
    const db = new SQL.Database()
    try {
      const sql = clean.on ? cleanDump(script2.value) : script2.value
      if (!sql.trim()) throw new Error('Paste a SQL script first.')
      let sets = []
      try { sets = db.exec(sql) } catch (e) { throw new Error(`${e.message}. If this came from MySQL or Postgres, keep "Clean up dump syntax" on, and note that COPY ... FROM stdin is not supported.`) }
      const names = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid")[0]?.values.flat() || []
      produced = []
      for (const n of names) {
        const r = db.exec(`SELECT * FROM "${n.replace(/"/g, '""')}"`)[0]
        const cols = db.exec(`PRAGMA table_info("${n.replace(/"/g, '""')}")`)[0]?.values.map((x) => x[1]) || []
        produced.push({ name: n, table: { headers: r?.columns || cols, rows: (r?.values || []).map((row) => row.map((v) => (v == null ? '' : v))) } })
      }
      const sel = sets.at(-1)
      if (sel && sets.length) produced.push({ name: 'query result', table: { headers: sel.columns, rows: sel.values.map((row) => row.map((v) => (v == null ? '' : v))) }, isQuery: true })
      if (!produced.length) throw new Error('The script ran but created no tables and returned no rows.')
    } finally { db.close() }
    drawOut2()
  }, { label: 'Running', errorTo: err2, progress: prog2 }))
  function drawOut2() {
    const tables = produced.filter((p) => !p.isQuery)
    clear(out2,
      statTiles([{ label: 'Tables', value: tables.length, accent: true }, { label: 'Rows in total', value: tables.reduce((a, p) => a + p.table.rows.length, 0) }, ...(produced.some((p) => p.isQuery) ? [{ label: 'Query result rows', value: produced.find((p) => p.isQuery).table.rows.length }] : [])]),
      ...produced.map((p, i) => {
        const vt = virtualTable({ height: 260 })
        vt.setTable(p.table)
        return h('details', { class: 'dt-det', open: i < 2 }, h('summary', icon(p.isQuery ? 'search' : 'table-2'), h('b', p.name), h('span', { class: 'small muted' }, `${p.table.rows.length.toLocaleString()} rows, ${p.table.headers.length} columns`)),
          h('div', { class: 'dt-det-body stack' }, vt.el, h('div', { class: 'row' }, button('Download CSV', { icon: 'file-text', size: 'sm', onClick: () => download(new Blob([toCsv(p.table)], { type: 'text/csv' }), `${p.name.replace(/[^\w.-]+/g, '_')}.csv`) }))))
      }),
      exportBar({
        copy: false,
        items: [
          { label: tables.length > 1 ? `Download ZIP of ${tables.length} CSV files` : 'Download CSV', icon: 'archive', primary: true, make: async () => (tables.length > 1 ? { blob: await zip(tables.map((p) => ({ name: `${p.name.replace(/[^\w.-]+/g, '_')}.csv`, data: toCsv(p.table) }))), name: 'tables-csv.zip' } : { blob: new Blob([toCsv(tables[0].table)], { type: 'text/csv' }), name: `${tables[0].name}.csv` }) },
          { label: 'Download Excel workbook', icon: 'file-spreadsheet', make: async () => { const { buildXlsx } = await import('./_xlsx.js'); return { blob: await buildXlsx(tables.map((p) => ({ name: p.name, headers: p.table.headers, rows: p.table.rows }))), name: 'tables.xlsx' } } },
        ],
        note: 'Every table in the script becomes one file',
      }))
  }
  const scriptTab = () => h('div', { class: 'stack' }, drop2, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'SQL script'), script2),
    h('div', { class: 'row' }, run2, toggle('Clean up MySQL / phpMyAdmin dump syntax', true, (v) => { clean.on = v })), prog2.el, err2, out2)

  const queryTab = () => flow(f.s1, f.s2, f.s3)
  root.append(h('style', {}, `
.dt-sqlgrid { display: grid; grid-template-columns: minmax(220px, 300px) minmax(0, 1fr); gap: 14px; align-items: start; }
.dt-schema { display: flex; flex-direction: column; gap: 8px; }
.dt-schema .dt-det > summary b { font-family: var(--mono); font-size: 13px; }
.dt-schema .dt-chip { min-height: 28px; font-size: 12.5px; padding: 0 9px; font-family: var(--mono); }
.dt-schema small { font-size: 10.5px; }
@media (max-width: 900px) { .dt-sqlgrid { grid-template-columns: minmax(0, 1fr); } }
`), tabs([{ id: 'q', label: 'Query my files', render: queryTab }, { id: 's', label: 'SQL script to CSV', render: scriptTab }], 'q'))
}
