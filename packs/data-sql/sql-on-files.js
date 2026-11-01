// SQL on files: drop CSV, TSV, JSON, JSON Lines, Parquet, Arrow, Avro or Excel files, each one becomes a table, and run DuckDB SQL on them
// (joins across files included). Results page through a grid and export to CSV, TSV, JSON, JSON Lines, Parquet, Arrow or Excel.
// DuckDB-WASM runs in a worker on this device; the engine downloads once, on first use.
import { h, icon, clear, button, busy, alert, dropzone, select, progress, toast, download, formatBytes, formatNumber, onCleanup, textarea } from '../../lib/ui.js'
import * as store from '../../lib/store.js'
import {
  loadEngine, onEngineProgress, hold, releaseEngine, loadFile, detectKind, tableName, describe, countOf, exportData, typeClass,
  ident, uid, cleanErr, ACCEPT, KINDS, EXPORT_FORMATS, DataError,
} from './_engine.js'

const CSS = `
.dsql { display: grid; grid-template-columns: minmax(250px, 320px) minmax(0, 1fr); gap: 14px; align-items: start; }
.dsql-side, .dsql-main { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.dsql-side > * { flex: none; }
.dsql-side { position: sticky; top: calc(var(--header-h) + 8px); max-height: calc(100dvh - var(--header-h) - 24px); overflow: auto; padding-right: 2px; }
.dsql-note { font-size: 12.5px; color: var(--muted); margin: 0; display: flex; gap: 6px; align-items: flex-start; }
.dsql-note .icon { width: 14px; height: 14px; flex: none; margin-top: 2px; color: var(--success); }
.dsql-quick { display: flex; flex-direction: column; gap: 8px; }
.dsql-quick textarea { min-height: 120px; font-family: var(--mono); font-size: 13px; white-space: pre; }
.dsql-seg { display: flex; gap: 4px; padding: 3px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; }
.dsql-seg button { flex: 1; min-height: 32px; border-radius: 9px; border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.dsql-seg button[aria-pressed="true"] { background: var(--surface); color: var(--text); box-shadow: var(--shadow-sm); }
.dsql-list { display: flex; flex-direction: column; gap: 8px; }
.dsql-empty { font-size: 13px; color: var(--muted); padding: 10px 2px; }
.dsql-tbl { border: 1px solid var(--border); border-radius: 12px; background: var(--surface); overflow: hidden; }
.dsql-tbl > summary { display: flex; gap: 8px; align-items: center; padding: 8px 10px; cursor: pointer; list-style: none; min-height: 40px; }
.dsql-tbl > summary::-webkit-details-marker { display: none; }
.dsql-tbl > summary .icon { width: 15px; height: 15px; color: var(--accent); flex: none; }
.dsql-tbl .nm { font-weight: 650; font-family: var(--mono); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
.dsql-tbl .ct { font-size: 12px; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.dsql-tbl .body { padding: 2px 8px 8px; display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--border); }
.dsql-tbl .cols { max-height: 240px; overflow: auto; display: flex; flex-direction: column; }
.dsql-tbl .acts { display: flex; gap: 4px; flex-wrap: wrap; padding-top: 6px; }
.dsql-col { display: flex; gap: 8px; align-items: baseline; width: 100%; padding: 5px 8px; border: 0; border-radius: 8px; background: transparent; color: var(--text); font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; min-height: 30px; }
.dsql-col:hover, .dsql-col:focus-visible { background: var(--surface-2); }
.dsql-col .t { margin-left: auto; color: var(--muted); font-family: var(--mono); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 55%; }
.dsql-col .n { font-family: var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsql-item { display: block; width: 100%; text-align: left; padding: 8px 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text); font: inherit; font-size: 12.5px; cursor: pointer; min-height: 36px; }
.dsql-item:hover, .dsql-item:focus-visible { border-color: var(--accent); }
.dsql-item .l { font-weight: 650; display: block; }
.dsql-item code { display: block; font-family: var(--mono); font-size: 11.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsql-editor { font-family: var(--mono); font-size: 13.5px; line-height: 1.5; min-height: 150px; white-space: pre; overflow: auto; tab-size: 2; resize: vertical; }
.dsql-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dsql-bar .grow { flex: 1; min-width: 0; }
.dsql-meta { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
.dsql-meta b { color: var(--text); font-weight: 650; }
.dsql-grid { position: relative; overflow: auto; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); max-height: min(60vh, 560px); overscroll-behavior: contain; }
.dsql-grid table { border-collapse: separate; border-spacing: 0; font-size: 13px; min-width: 100%; }
.dsql-grid th { position: sticky; top: 0; z-index: 1; background: var(--surface-2); text-align: left; padding: 0; border-bottom: 1px solid var(--border-strong); white-space: nowrap; }
.dsql-grid th button { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 36px; padding: 0 12px; border: 0; background: transparent; color: var(--text); font: inherit; font-weight: 650; cursor: pointer; }
.dsql-grid th button small { color: var(--muted); font-weight: 500; font-family: var(--mono); font-size: 11px; }
.dsql-grid th button .icon { width: 12px; height: 12px; color: var(--accent); }
.dsql-grid td { padding: 6px 12px; border-bottom: 1px solid var(--border); max-width: 380px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
.dsql-grid td.num { text-align: right; }
.dsql-grid td.rn, .dsql-grid th.rn { color: var(--muted); text-align: right; font-size: 11.5px; position: sticky; left: 0; background: var(--surface-2); z-index: 1; padding: 6px 8px; min-width: 44px; }
.dsql-grid tr:hover td { background: color-mix(in srgb, var(--accent) 5%, var(--surface)); }
.dsql-grid .null { color: var(--muted); font-style: italic; font-size: 12px; opacity: .8; }
.dsql-pager { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 13px; color: var(--muted); }
.dsql-pager .grow { flex: 1; }
.dsql-export { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dsql-export .select { width: auto; min-width: 150px; }
@media (max-width: 860px) {
  .dsql { grid-template-columns: minmax(0, 1fr); }
  .dsql-side { position: static; max-height: none; overflow: visible; }
  .dsql-editor { min-height: 130px; }
}
`

// ---------- Pure helpers (exported for tests) ----------

/** Split SQL text into statements at semicolons, ignoring semicolons inside quotes, comments and $$ strings. */
export function splitSql(sql) {
  const out = []
  let cur = ''
  let i = 0
  const n = sql.length
  while (i < n) {
    const c = sql[i]
    const two = sql.substr(i, 2)
    if (c === "'" || c === '"') {
      let j = i + 1
      while (j < n && !(sql[j] === c && sql[j + 1] !== c)) j += sql[j] === c ? 2 : 1
      cur += sql.slice(i, j + 1); i = j + 1
    } else if (two === '--') {
      let j = sql.indexOf('\n', i); if (j < 0) j = n
      cur += sql.slice(i, j); i = j
    } else if (two === '/*') {
      let j = sql.indexOf('*/', i + 2); j = j < 0 ? n : j + 2
      cur += sql.slice(i, j); i = j
    } else if (two === '$$') {
      let j = sql.indexOf('$$', i + 2); j = j < 0 ? n : j + 2
      cur += sql.slice(i, j); i = j
    } else if (c === ';') {
      out.push(cur); cur = ''; i++
    } else { cur += c; i++ }
  }
  out.push(cur)
  return out.map((s) => s.trim()).filter((s) => s.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').trim())
}

const SELECT_LIKE = /^\s*(\(\s*)*(select|with|from|values|table|pivot|unpivot)\b/i
export const isSelectLike = (sql) => SELECT_LIKE.test(sql.replace(/^(\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/, ''))
const plainIdent = (s) => (/^[a-z_][a-z0-9_]*$/.test(s) ? s : ident(s))

/** Starter queries for the tables that are loaded. tables: [{ name, cols: [{ name, type }] }]. Returns [[label, sql]]. */
export function examplesFor(tables) {
  if (!tables.length) {
    return [
      ['Try it with no files', "SELECT i AS n, i * i AS square FROM range(1, 11) t(i);"],
      ['Read a file by name', "-- After adding a file, its table appears in the list on the left.\nSELECT 42 AS answer;"],
    ]
  }
  const ex = []
  const t = tables[0]
  const q = plainIdent(t.name)
  const cls = (c) => typeClass(c.type)
  const text = t.cols.find((c) => cls(c) === 'str' && /^(VARCHAR|ENUM)/i.test(c.type))
  const num = t.cols.find((c) => cls(c) === 'float') || t.cols.find((c) => cls(c) === 'int' && !/(^|_)id$/i.test(c.name))
  const date = t.cols.find((c) => cls(c) === 'date' || cls(c) === 'ts')
  ex.push([`Preview ${t.name}`, `SELECT * FROM ${q} LIMIT 100;`])
  ex.push(['Count rows', `SELECT count(*) AS rows FROM ${q};`])
  ex.push(['Column summary', `SUMMARIZE ${q};`])
  ex.push(['Column types', `DESCRIBE ${q};`])
  ex.push(['Missing values per column', `SELECT ${t.cols.slice(0, 12).map((c) => `count(*) - count(${plainIdent(c.name)}) AS ${ident(`${c.name}_nulls`)}`).join(',\n       ')}\nFROM ${q};`])
  if (text) ex.push([`Rows per ${text.name}`, `SELECT ${plainIdent(text.name)}, count(*) AS rows${num ? `, round(sum(${plainIdent(num.name)}), 2) AS total` : ''}\nFROM ${q}\nGROUP BY ALL\nORDER BY ${num ? 'total' : 'rows'} DESC\nLIMIT 50;`])
  if (num) ex.push([`Top 10 by ${num.name}`, `SELECT * FROM ${q}\nORDER BY ${plainIdent(num.name)} DESC NULLS LAST\nLIMIT 10;`])
  if (num) ex.push([`Percentiles of ${num.name}`, `SELECT min(${plainIdent(num.name)}) AS min,\n       quantile_cont(${plainIdent(num.name)}, [0.25, 0.5, 0.75, 0.95]) AS quartiles,\n       max(${plainIdent(num.name)}) AS max,\n       avg(${plainIdent(num.name)}) AS mean\nFROM ${q};`])
  if (date && num) ex.push([`${num.name} per month`, `SELECT date_trunc('month', ${plainIdent(date.name)}) AS month, round(sum(${plainIdent(num.name)}), 2) AS total, count(*) AS rows\nFROM ${q}\nGROUP BY ALL\nORDER BY month;`])
  if (text && num) ex.push([`Best row in each ${text.name}`, `SELECT *\nFROM ${q}\nQUALIFY row_number() OVER (PARTITION BY ${plainIdent(text.name)} ORDER BY ${plainIdent(num.name)} DESC) = 1\nORDER BY ${plainIdent(num.name)} DESC\nLIMIT 50;`])
  if (tables.length > 1) {
    for (let a = 0; a < tables.length; a++) {
      for (let b = a + 1; b < tables.length; b++) {
        const shared = tables[a].cols.find((c) => tables[b].cols.some((d) => d.name === c.name && (typeClass(d.type) === typeClass(c.type) || (typeClass(d.type) !== 'str' && typeClass(c.type) !== 'str'))))
        if (shared) { ex.splice(1, 0, [`Join ${tables[a].name} and ${tables[b].name}`, `SELECT *\nFROM ${plainIdent(tables[a].name)} a\nJOIN ${plainIdent(tables[b].name)} b USING (${plainIdent(shared.name)})\nLIMIT 100;`]); a = tables.length; break }
      }
    }
  }
  return ex
}

/** A deterministic sample: customers and orders as CSV text. */
export function sampleCsv() {
  const names = ['Asha Verma', 'Ben Carter', 'Chloe Martin', 'Diego Alvarez', 'Emi Tanaka', 'Farid Haddad', 'Grace Okafor', 'Hugo Lang', 'Ines Costa', 'Jon Bell', 'Kavya Rao', 'Liam Walsh']
  const cities = ['Pune', 'Austin', 'Lyon', 'Madrid', 'Osaka', 'Cairo', 'Lagos', 'Berlin']
  const segs = ['Retail', 'Wholesale', 'Online']
  let seed = 7
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
  const pad = (n) => String(n).padStart(2, '0')
  const cust = ['id,name,city,segment,signup_date']
  for (let i = 1; i <= 24; i++) cust.push(`${i},${names[(i - 1) % names.length]}${i > names.length ? ` ${i}` : ''},${cities[(i * 3) % cities.length]},${segs[i % 3]},2023-${pad(1 + (i % 12))}-${pad(1 + ((i * 7) % 28))}`)
  const prods = [['Keyboard', 49], ['Mouse', 25.5], ['Monitor', 229], ['Webcam', 59.9], ['Headset', 89], ['Dock', 149]]
  const stat = ['paid', 'paid', 'paid', 'shipped', 'refunded']
  const ord = ['order_id,customer_id,product,qty,unit_price,order_date,status']
  for (let i = 1; i <= 240; i++) {
    const p = prods[Math.floor(rnd() * prods.length)]
    ord.push(`${i},${1 + Math.floor(rnd() * 24)},${p[0]},${1 + Math.floor(rnd() * 4)},${p[1]},2024-${pad(1 + Math.floor(rnd() * 12))}-${pad(1 + Math.floor(rnd() * 28))},${stat[Math.floor(rnd() * stat.length)]}`)
  }
  return { customers: `${cust.join('\n')}\n`, orders: `${ord.join('\n')}\n` }
}

const PAGE_SIZES = [50, 100, 500, 1000]
const NUMERIC = new Set(['int', 'float'])

export function mount(root, { params = {} } = {}) {
  if (!document.getElementById('dsql-style')) document.head.append(h('style', { id: 'dsql-style' }, CSS))
  const quick = !!params.quick
  const hist = store.persisted('dsql-history', [])
  const used = new Set()
  /** name -> { name, kind, rows, cols, size, file, source } */
  const tables = new Map()
  const st = { eng: null, conn: null, release: null, starting: null, result: null, page: 0, size: 100, sort: null, running: false }

  // ---------- Sidebar ----------
  const prog = progress('Loading the SQL engine')
  const errHost = h('div', { class: 'stack' })
  const drop = dropzone({
    accept: ACCEPT, multiple: true, compact: true, label: 'Add files', paste: true,
    hint: 'CSV, TSV, JSON, Parquet, Arrow, Avro or Excel. Each file becomes a table.',
    onFiles: (files) => addFiles(files),
  })
  const sampleBtn = button('Load sample data', { icon: 'sparkles', size: 'sm', variant: 'secondary', onClick: () => loadSample() })
  const listHost = h('div', { class: 'dsql-list' })
  const exHost = h('div', { class: 'dsql-list' })
  const histHost = h('div', { class: 'dsql-list' })
  const panes = { tables: listHost, examples: exHost, history: histHost }
  const segBtns = {}
  const seg = h('div', { class: 'dsql-seg', role: 'group', 'aria-label': 'Sidebar' }, [['tables', 'Tables'], ['examples', 'Examples'], ['history', 'History']].map(([k, l]) => (segBtns[k] = h('button', { type: 'button', 'aria-pressed': String(k === 'tables'), onclick: () => showPane(k) }, l))))
  function showPane(k) { for (const [id, el] of Object.entries(panes)) { el.hidden = id !== k; segBtns[id].setAttribute('aria-pressed', String(id === k)) } if (k === 'history') drawHistory(); if (k === 'examples') drawExamples() }

  // quick mode: paste CSV or JSON straight in
  const pasteBox = textarea({ mono: true, rows: 5, placeholder: 'Paste CSV or JSON here. It becomes the table "data".', 'aria-label': 'Paste CSV or JSON', spellcheck: false })
  let pasteTimer = 0
  pasteBox.addEventListener('input', () => { clearTimeout(pasteTimer); pasteTimer = setTimeout(applyPaste, 450) })
  const pasteExample = button('Use an example', { size: 'sm', variant: 'ghost', icon: 'file-text', onClick: () => { pasteBox.value = 'name,team,score\nAsha,Red,82\nBen,Blue,91\nChloe,Red,77\nDiego,Blue,68\nEmi,Green,95\nFarid,Green,88\n'; applyPaste() } })
  async function applyPaste() {
    const text = pasteBox.value
    if (tables.has('data')) await removeTable('data', true)
    if (!text.trim()) return
    const t = text.trim()
    const kind = /^\s*\[/.test(t) ? 'json' : /^\s*\{[\s\S]*\}\s*\n\s*\{/.test(t) ? 'jsonl' : 'csv'
    await addFiles([new File([text], `data.${kind === 'json' ? 'json' : kind === 'jsonl' ? 'jsonl' : 'csv'}`, { type: 'text/plain' })], { select: false, name: 'data' })
    if (!editor.value.trim()) editor.value = 'SELECT * FROM data;'
    run() // new data: run the current query again
  }

  const side = h('aside', { class: 'dsql-side', 'aria-label': 'Files and tables' },
    quick ? h('div', { class: 'dsql-quick' }, pasteBox, h('div', { class: 'row' }, pasteExample)) : null,
    drop, h('div', { class: 'row' }, sampleBtn), prog.el,
    h('p', { class: 'dsql-note' }, icon('shield-check'), h('span', 'Your files stay on this device. The SQL engine (about 36 MB) downloads once, the first time you add a file or run a query.')),
    seg, listHost, exHost, histHost)
  exHost.hidden = histHost.hidden = true

  // ---------- Main ----------
  const editor = textarea({ class: 'dsql-editor', mono: true, spellcheck: false, 'aria-label': 'SQL query', placeholder: 'SELECT * FROM my_table LIMIT 100;\n\nAdd files on the left, then write a query. Ctrl+Enter runs it.' })
  editor.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run() }
    else if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end') }
  })
  const runBtn = button('Run', { icon: 'play', variant: 'primary', title: 'Run (Ctrl+Enter)', onClick: () => run() })
  const clearBtn = button('', { icon: 'eraser', variant: 'ghost', ariaLabel: 'Clear the editor', title: 'Clear the editor', onClick: () => { editor.value = ''; editor.focus() } })
  const status = h('span', { class: 'small muted', 'aria-live': 'polite' }, 'Ctrl+Enter runs the query, or only the text you highlight.')
  const sqlErr = h('div')
  const metaHost = h('div', { class: 'dsql-meta', 'aria-live': 'polite' })
  const gridHost = h('div')
  const pagerHost = h('div', { class: 'dsql-pager' })
  const exportHost = h('div', { class: 'dsql-export' })
  const resultBox = h('div', { class: 'stack' }, metaHost, gridHost, pagerHost, exportHost)
  resultBox.hidden = true
  const main = h('main', { class: 'dsql-main' }, editor, h('div', { class: 'dsql-bar' }, runBtn, clearBtn, h('span', { class: 'grow' }, status)), errHost, sqlErr, resultBox)

  root.append(h('div', { class: 'dsql' }, side, main))
  drawTables(); drawExamples()

  // ---------- Engine ----------
  const off = onEngineProgress((f, t) => { if (st.starting || !st.eng) prog.set(f, t); if (f === 1) setTimeout(() => prog.hide(), 400) })
  onCleanup(off)
  async function ensure() {
    if (st.conn) return
    st.starting ||= (async () => {
      prog.set(null, 'Loading the SQL engine')
      st.eng = await loadEngine()
      st.release = hold()
      st.conn = await st.eng.db.connect()
    })().catch((e) => { st.starting = null; prog.hide(); throw e })
    await st.starting
  }

  // ---------- Files and tables ----------
  async function addFiles(files, { select: sel = true, name } = {}) {
    if (!files.length) return
    clear(errHost)
    const problems = []
    try { await ensure() } catch (e) { clear(errHost, alert('error', e.message)); return }
    let first = null
    for (const file of files) {
      try {
        const kind = await detectKind(file)
        if (!kind) throw new DataError(`${file.name}: this file type is not supported. Use CSV, TSV, JSON, JSON Lines, Parquet, Arrow, Avro or Excel.`)
        const base = name || tableName(file.name, used)
        if (name) used.add(name)
        prog.set(null, `Reading ${file.name}`)
        const made = await loadFile(st.eng, st.conn, file, { name: base, kind, sheet: 'all' })
        for (const m of made) {
          if (made.length > 1) used.add(m.name)
          const [cols, counts] = await Promise.all([describe(st.conn, m.name), countOf(st.conn, m.name)])
          tables.set(m.name, { name: m.name, kind, rows: counts.rows, cols, size: file.size, file: m.file, source: file.name, note: m.note })
          first ||= m.name
          if (m.note && kind !== 'xlsx') problems.push(`${file.name}: ${m.note}`)
        }
      } catch (e) {
        console.error(e)
        problems.push(e.userMessage || e.message)
      }
    }
    prog.hide()
    drawTables(); drawExamples()
    if (problems.length) clear(errHost, ...problems.map((p) => alert(/^[^:]+: (Some|Sheet)/.test(p) ? 'warn' : 'error', p)))
    if (first && sel) {
      showPane('tables')
      if (!editor.value.trim() || /^SELECT \* FROM \w+ LIMIT 100;?$/.test(editor.value.trim())) { editor.value = `SELECT * FROM ${plainIdent(first)} LIMIT 100;`; run() }
    }
  }

  async function loadSample() {
    const { customers, orders } = sampleCsv()
    for (const n of ['customers', 'orders']) if (tables.has(n)) await removeTable(n, true)
    used.delete('customers'); used.delete('orders')
    await addFiles([new File([customers], 'customers.csv', { type: 'text/csv' }), new File([orders], 'orders.csv', { type: 'text/csv' })], { select: false })
    editor.value = 'SELECT c.name, c.city, count(*) AS orders, round(sum(o.qty * o.unit_price), 2) AS revenue\nFROM orders o\nJOIN customers c ON c.id = o.customer_id\nWHERE o.status <> \'refunded\'\nGROUP BY ALL\nORDER BY revenue DESC\nLIMIT 20;'
    run()
  }

  async function removeTable(name, silent) {
    const t = tables.get(name)
    if (!t) return
    try {
      await st.conn.query(`DROP VIEW IF EXISTS ${ident(name)}`).catch(() => {})
      await st.conn.query(`DROP TABLE IF EXISTS ${ident(name)}`).catch(() => {})
      if (t.file) await st.eng.db.dropFile(t.file).catch(() => {})
    } finally { tables.delete(name); used.delete(name) }
    if (!silent) { drawTables(); drawExamples() }
  }

  const insertText = (txt) => { const s = editor.selectionStart ?? editor.value.length; editor.setRangeText(txt, s, editor.selectionEnd ?? s, 'end'); editor.focus() }

  function drawTables() {
    const list = [...tables.values()]
    if (!list.length) { clear(listHost, h('div', { class: 'dsql-empty' }, 'No tables yet. Add files above, or load the sample data to try it.')); return }
    clear(listHost, list.map((t) => h('details', { class: 'dsql-tbl', open: list.length <= 3 && matchMedia('(min-width: 861px)').matches },
      h('summary', icon(t.kind === 'parquet' ? 'columns-3' : 'table'), h('span', { class: 'nm', title: t.name }, t.name), h('span', { class: 'ct' }, `${formatNumber(t.rows, 0)} rows`)),
      h('div', { class: 'body' },
        h('div', { class: 'small muted', style: 'padding-top:6px' }, `${t.source ? `${t.source} · ` : ''}${KINDS[t.kind]?.label || t.kind}${t.size ? ` · ${formatBytes(t.size)}` : ''}${t.kind === 'xlsx' && t.note ? ` · sheet "${t.note}"` : ''}`),
        h('div', { class: 'acts' },
          button('Select *', { size: 'sm', variant: 'secondary', icon: 'corner-down-left', onClick: () => { editor.value = `SELECT * FROM ${plainIdent(t.name)} LIMIT 100;`; run() } }),
          button('Insert name', { size: 'sm', variant: 'ghost', onClick: () => insertText(plainIdent(t.name)) }),
          button('Remove', { size: 'sm', variant: 'ghost', icon: 'x', onClick: () => removeTable(t.name) })),
        h('div', { class: 'cols' }, t.cols.map((c) => h('button', { type: 'button', class: 'dsql-col', title: `Insert ${c.name}`, onclick: () => insertText(plainIdent(c.name)) }, h('span', { class: 'n' }, c.name), h('span', { class: 't' }, c.type))))))))
  }

  function drawExamples() {
    clear(exHost, examplesFor([...tables.values()]).map(([label, sql]) => h('button', { type: 'button', class: 'dsql-item', onclick: () => { editor.value = sql; if (st.conn) run(); else editor.focus() } }, h('span', { class: 'l' }, label), h('code', sql.replace(/\s+/g, ' ')))))
  }

  function drawHistory() {
    const items = hist.get()
    if (!items.length) { clear(histHost, h('div', { class: 'dsql-empty' }, 'Queries you run are kept here, on this device only.')); return }
    clear(histHost,
      items.map((x) => h('button', { type: 'button', class: 'dsql-item', onclick: () => { editor.value = x.sql; editor.focus() } },
        h('span', { class: 'l' }, x.rows != null ? `${formatNumber(x.rows, 0)} rows · ${x.ms} ms` : 'Query'), h('code', x.sql.replace(/\s+/g, ' ')))),
      button('Clear history', { size: 'sm', variant: 'ghost', icon: 'trash-2', onClick: () => { hist.set([]); drawHistory() } }))
  }
  const remember = (sql, rows, ms) => hist.set([{ sql, rows, ms, at: Date.now() }, ...hist.get().filter((x) => x.sql !== sql)].slice(0, 40))

  // ---------- Running queries ----------
  async function run() {
    if (st.running) return
    const sel = editor.selectionStart !== editor.selectionEnd ? editor.value.slice(editor.selectionStart, editor.selectionEnd) : ''
    const text = (sel.trim() ? sel : editor.value).trim()
    clear(sqlErr)
    if (!text) { clear(sqlErr, alert('info', 'Type a query first, for example SELECT * FROM my_table LIMIT 100;')); return }
    const stmts = splitSql(text)
    if (!stmts.length) { clear(sqlErr, alert('info', 'There is only a comment here. Add a query below it.')); return }
    st.running = true
    await busy(runBtn, async () => {
      try { await ensure() } catch (e) { clear(sqlErr, alert('error', e.message)); return }
      const t0 = performance.now()
      let affected = null
      try {
        for (const s of stmts.slice(0, -1)) await st.conn.query(s)
        const last = stmts.at(-1)
        let res = null
        await st.conn.query('DROP TABLE IF EXISTS __result')
        if (isSelectLike(last)) await st.conn.query(`CREATE TEMP TABLE __result AS ${last.replace(/;\s*$/, '')}`)
        else {
          res = await st.conn.query(last)
          if (res.numCols > 0 && res.numRows > 0) {
            const stage = uid('stage')
            await st.conn.insertArrowTable(res, { name: stage, create: true })
            await st.conn.query(`CREATE TEMP TABLE __result AS SELECT * FROM ${ident(stage)}`)
            await st.conn.query(`DROP TABLE ${ident(stage)}`)
          } else affected = true
        }
      } catch (e) {
        resultBox.hidden = true
        clear(sqlErr, alert('error', h('div', h('strong', 'SQL error: '), cleanErr(e))))
        status.textContent = 'The query did not run.'
        return
      }
      const ms = Math.round(performance.now() - t0)
      await syncTables()
      if (affected) {
        resultBox.hidden = true
        clear(sqlErr, alert('success', `Done in ${ms} ms. Statements that change data only change this in-browser copy, never your files.`))
        status.textContent = `Done in ${ms} ms`
        remember(text, null, ms)
        return
      }
      const [cols, counts] = await Promise.all([describe(st.conn, '__result'), countOf(st.conn, '__result')])
      st.result = { cols, rows: counts.rows, ms, sql: text }
      st.page = 0
      st.sort = null
      resultBox.hidden = false
      status.textContent = `Ran in ${ms} ms`
      remember(text, counts.rows, ms)
      await drawResult()
    }, { label: 'Running' })
    st.running = false
    if (!sidebarPaneIs('history')) return
    drawHistory()
  }
  const sidebarPaneIs = (k) => !panes[k].hidden

  /** Tables made by SQL (CREATE TABLE ...) show up in the list too. */
  async function syncTables() {
    const t = await st.conn.query(`SELECT table_name FROM duckdb_tables() WHERE table_name <> '__result' AND NOT internal UNION SELECT view_name FROM duckdb_views() WHERE NOT internal AND view_name <> '__result' AND schema_name = 'main'`)
    const names = new Set(t.toArray().map((r) => String(r.table_name)))
    let changed = false
    for (const n of names) {
      if (!tables.has(n)) {
        const [cols, counts] = await Promise.all([describe(st.conn, n), countOf(st.conn, n)])
        tables.set(n, { name: n, kind: 'sql', rows: counts.rows, cols, size: 0, source: 'created with SQL' })
        used.add(n); changed = true
      }
    }
    for (const n of [...tables.keys()]) if (!names.has(n)) { tables.delete(n); used.delete(n); changed = true }
    if (changed) { drawTables(); drawExamples() }
  }

  async function drawResult() {
    const r = st.result
    if (!r) return
    const off = st.page * st.size
    const order = st.sort ? ` ORDER BY ${ident(st.sort.col)} ${st.sort.dir} NULLS LAST` : ''
    let page
    try {
      page = await st.conn.query(`SELECT ${r.cols.map((c) => `CAST(${ident(c.name)} AS VARCHAR) AS ${ident(c.name)}`).join(', ')} FROM __result${order} LIMIT ${st.size} OFFSET ${off}`)
    } catch (e) { clear(sqlErr, alert('error', cleanErr(e))); return }
    const vecs = r.cols.map((_, i) => page.getChildAt(i))
    const n = page.numRows
    const head = h('tr', h('th', { class: 'rn', scope: 'col' }, '#'), r.cols.map((c) => {
      const active = st.sort?.col === c.name
      return h('th', { scope: 'col', 'aria-sort': active ? (st.sort.dir === 'ASC' ? 'ascending' : 'descending') : 'none' },
        h('button', { type: 'button', title: `Sort by ${c.name}`, onclick: () => { st.sort = active && st.sort.dir === 'DESC' ? null : { col: c.name, dir: active ? 'DESC' : 'ASC' }; st.page = 0; drawResult() } },
          h('span', c.name), h('small', c.type), active ? icon(st.sort.dir === 'ASC' ? 'arrow-up' : 'arrow-down') : null))
    }))
    const body = []
    for (let i = 0; i < n; i++) {
      body.push(h('tr', h('td', { class: 'rn' }, off + i + 1), r.cols.map((c, k) => {
        const v = vecs[k].get(i)
        const num = NUMERIC.has(typeClass(c.type))
        return v == null ? h('td', h('span', { class: 'null' }, 'NULL')) : h('td', { class: num ? 'num' : null, title: v.length > 40 ? v : null }, v)
      })))
    }
    clear(gridHost, h('div', { class: 'dsql-grid', tabindex: 0, role: 'region', 'aria-label': 'Query results' }, h('table', h('thead', head), h('tbody', body))))
    clear(metaHost, h('span', h('b', formatNumber(r.rows, 0)), ` row${r.rows === 1 ? '' : 's'}`), h('span', h('b', r.cols.length), ` column${r.cols.length === 1 ? '' : 's'}`), h('span', h('b', `${r.ms} ms`), ' to run'))
    const pages = Math.max(1, Math.ceil(r.rows / st.size))
    const go = (p) => { st.page = Math.min(Math.max(p, 0), pages - 1); drawResult() }
    clear(pagerHost,
      button('', { icon: 'chevrons-left', size: 'sm', variant: 'ghost', ariaLabel: 'First page', disabled: st.page === 0, onClick: () => go(0) }),
      button('', { icon: 'chevron-left', size: 'sm', variant: 'ghost', ariaLabel: 'Previous page', disabled: st.page === 0, onClick: () => go(st.page - 1) }),
      h('span', r.rows ? `Rows ${formatNumber(off + 1, 0)} to ${formatNumber(off + n, 0)} of ${formatNumber(r.rows, 0)}` : 'No rows'),
      button('', { icon: 'chevron-right', size: 'sm', variant: 'ghost', ariaLabel: 'Next page', disabled: st.page >= pages - 1, onClick: () => go(st.page + 1) }),
      button('', { icon: 'chevrons-right', size: 'sm', variant: 'ghost', ariaLabel: 'Last page', disabled: st.page >= pages - 1, onClick: () => go(pages - 1) }),
      h('span', { class: 'grow' }),
      h('label', { class: 'small' }, 'Rows per page '), select(PAGE_SIZES.map((x) => [x, x]), st.size, (v) => { st.size = +v; st.page = 0; drawResult() }))
    pagerHost.querySelector('select')?.setAttribute('aria-label', 'Rows per page')
    if (!exportHost.childElementCount) drawExport()
  }

  const expProg = progress('Preparing the file')
  function drawExport() {
    const fmtSel = select([['csv', 'CSV'], ['tsv', 'TSV'], ['json', 'JSON'], ['jsonl', 'JSON Lines'], ['parquet', 'Parquet'], ['arrow', 'Arrow (Feather)'], ['xlsx', 'Excel (XLSX)']], 'csv')
    fmtSel.setAttribute('aria-label', 'Export format')
    const comp = select([['snappy', 'Snappy'], ['zstd', 'Zstandard'], ['gzip', 'Gzip'], ['uncompressed', 'No compression']], 'snappy')
    comp.setAttribute('aria-label', 'Parquet compression')
    comp.hidden = true
    fmtSel.addEventListener('change', () => { comp.hidden = fmtSel.value !== 'parquet' })
    const btn = button('Download results', { icon: 'download', variant: 'secondary', onClick: () => busy(btn, async () => {
      const fmt = fmtSel.value
      expProg.set(null, 'Preparing the file')
      const bytes = await exportData(st.eng, st.conn, '__result', fmt, { compression: comp.value, sheetName: 'Results' })
      download(new Blob([bytes], { type: EXPORT_FORMATS[fmt].mime }), `query-result.${EXPORT_FORMATS[fmt].ext}`)
      toast(`Saved ${st.result.rows.toLocaleString()} rows as ${EXPORT_FORMATS[fmt].label}`, 'success')
    }, { label: 'Preparing', progress: expProg, errorTo: sqlErr }) })
    clear(exportHost, h('span', { class: 'small muted' }, 'Export all rows'), fmtSel, comp, btn, expProg.el)
  }

  // files handed over by the shell ("open with") arrive through the dropzone
  return () => {
    clearTimeout(pasteTimer)
    const { conn, eng, release } = st
    ;(async () => {
      try { await conn?.close() } catch { /* ignore */ }
      release?.()
      if (eng) await releaseEngine()
    })()
  }
}
