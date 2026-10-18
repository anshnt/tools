// SQLite database viewer: open a .sqlite / .db file with sql.js (SQLite compiled to WebAssembly, MIT), browse tables
// with paging, read the schema, run SQL and export results to CSV. The file never leaves the device.
import { h, clear, dropzone, alert, button, busy, field, input, select, textarea, tabs, stats, progress, copyButton, download, modal, formatBytes, formatNumber, yieldToMain, onCleanup, icon, errorMessage } from '../../lib/ui.js'
import { script } from '../../lib/libs.js'
import { baseName, ext } from '../../lib/files.js'

// sql.js 1.14.1 (MIT), the same build the data pack uses, so the browser cache is shared.
const SQLJS = 'https://cdn.jsdelivr.net/npm/sql.js@1.14.1/dist/'
let sqlPromise = null
const loadSql = () => (sqlPromise ||= script(`${SQLJS}sql-wasm.js`)
  .then(() => window.initSqlJs({ locateFile: (f) => `${SQLJS}${f}` }))
  .catch((e) => { sqlPromise = null; throw Object.assign(new Error('Could not load the SQLite engine. Check your connection and try again.'), { cause: e }) }))

export const MAX_DB_BYTES = 1024 * 1024 * 1024
const RESULT_CAP = 100000
const SHOW_CAP = 1000

// ---------- Pure helpers (exported for tests) ----------

const MAGIC = 'SQLite format 3\u0000'
/** True when the bytes start with the SQLite 3 file header. */
export function isSqlite(bytes) {
  if (!bytes || bytes.length < 16) return false
  for (let i = 0; i < 16; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) return false
  return true
}

/** Read the 100-byte database header. */
export function headerInfo(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 100))
  const ps = dv.getUint16(16)
  const pageSize = ps === 1 ? 65536 : ps
  return {
    pageSize,
    wal: bytes[18] === 2 || bytes[19] === 2,
    pages: dv.getUint32(28),
    encoding: ({ 1: 'UTF-8', 2: 'UTF-16le', 3: 'UTF-16be' })[dv.getUint32(56)] || 'UTF-8',
    userVersion: dv.getUint32(60),
    applicationId: dv.getUint32(68),
    sqliteVersion: versionString(dv.getUint32(96)),
  }
}
const versionString = (n) => (n ? `${Math.floor(n / 1000000)}.${Math.floor((n % 1000000) / 1000)}.${n % 1000}` : '')

/** Explain why bytes are not a usable SQLite database. */
export function notSqliteReason(bytes, name = '') {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 64))
  if (bytes.length === 0) return 'The file is empty.'
  if (/^-- |^CREATE |^BEGIN TRANSACTION|^PRAGMA /i.test(head)) return 'This looks like a SQL text dump, not a database file. Use the Query CSV with SQL tool, or import it with the sqlite3 command line.'
  if (/-wal$|-shm$|-journal$/i.test(name)) return 'This is a SQLite side file (WAL, shared memory or journal), not the database itself. Open the main .db file instead.'
  if (bytes.length < 100) return 'The file is too small to be a SQLite database.'
  return 'This file does not start with the SQLite 3 header ("SQLite format 3"). It may be another format, or an encrypted database (for example SQLCipher), which cannot be opened without its key.'
}

/** Quote an identifier for SQL. */
export const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`

export const toHex = (bytes, max = bytes.length) => Array.from(bytes.subarray(0, max), (b) => b.toString(16).padStart(2, '0')).join('')

export function csvCell(v) {
  if (v == null) return ''
  const s = v instanceof Uint8Array ? toHex(v) : String(v)
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
/** CSV with RFC 4180 quoting. NULL becomes an empty field and BLOBs become hex. */
export const toCsv = (columns, rows) => [columns, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'

const tsvCell = (v) => (v == null ? '' : v instanceof Uint8Array ? toHex(v) : String(v).replace(/[\t\r\n]+/g, ' '))
/** Tab separated text for pasting into a spreadsheet. */
export const toTsv = (columns, rows) => [columns, ...rows].map((r) => r.map(tsvCell).join('\t')).join('\n')

/** Hex + ASCII dump lines, 16 bytes each. */
export function hexDump(bytes, max = 4096) {
  const n = Math.min(bytes.length, max)
  const out = []
  for (let o = 0; o < n; o += 16) {
    const chunk = bytes.subarray(o, Math.min(n, o + 16))
    const hex = Array.from(chunk, (b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ')
    const asc = Array.from(chunk, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('')
    out.push(`${o.toString(16).padStart(8, '0')}  ${hex}  ${asc}`)
  }
  return out.join('\n')
}

/**
 * Run SQL that may hold several statements. Returns { columns, rows, truncated, statements, changes, ms } for the
 * last statement that returned columns (or the last statement). Throws the SQLite error with the statement number.
 */
export function runSql(db, sql, cap = RESULT_CAP) {
  const t0 = performance.now()
  const before = totalChanges(db)
  let last = null, n = 0, inStmt = false, cur = null
  try {
    for (const st of db.iterateStatements(sql)) {
      n++
      inStmt = true
      cur = st
      const columns = st.getColumnNames()
      const rows = []
      let truncated = false
      while (st.step()) {
        if (rows.length >= cap) { truncated = true; break }
        rows.push(st.get())
      }
      st.free()
      inStmt = false
      if (columns.length || !last || !last.columns.length) last = { columns, rows, truncated }
    }
  } catch (e) {
    if (inStmt) { try { cur.free() } catch { /* already freed */ } }
    const which = inStmt ? n : n + 1
    const err = new Error(which > 1 ? `Statement ${which}: ${e.message}` : e.message)
    err.sqlite = true
    throw err
  }
  return { ...(last || { columns: [], rows: [], truncated: false }), statements: n, changes: totalChanges(db) - before, ms: performance.now() - t0 }
}
const totalChanges = (db) => db.exec('SELECT total_changes()')[0].values[0][0]

/** List schema objects with row counts for tables and views. */
export async function listObjects(db, { yieldFn } = {}) {
  const res = db.exec("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_autoindex_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1 WHEN 'index' THEN 2 ELSE 3 END, name COLLATE NOCASE")
  const out = (res[0]?.values || []).map(([type, name, tbl, sql]) => ({ type, name, table: tbl, sql: sql || '', rows: null, internal: /^sqlite_/.test(name) }))
  out.push({ type: 'table', name: 'sqlite_master', table: 'sqlite_master', sql: '-- Built-in schema table\nCREATE TABLE sqlite_master (type text, name text, tbl_name text, rootpage integer, sql text);', rows: null, internal: true })
  for (const o of out) {
    if (o.type !== 'table' && o.type !== 'view') continue
    try { o.rows = db.exec(`SELECT COUNT(*) FROM ${quoteIdent(o.name)}`)[0].values[0][0] } catch (e) { o.rows = null; o.error = e.message }
    if (yieldFn) await yieldFn()
  }
  return out
}

// ---------- UI ----------

const STYLE = `
.t-sqlv .sv-layout { display: grid; grid-template-columns: minmax(0, 250px) minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 760px) { .t-sqlv .sv-layout { grid-template-columns: minmax(0, 1fr); } .t-sqlv .sv-side .sv-objs { max-height: 240px; } }
.t-sqlv .sv-side { padding: 12px; }
.t-sqlv .sv-objs { display: flex; flex-direction: column; gap: 2px; max-height: 560px; overflow: auto; }
.t-sqlv .sv-group { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 10px 6px 4px; }
.t-sqlv .sv-obj { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 8px; cursor: pointer; min-height: 32px; font-size: 14px; }
.t-sqlv .sv-obj:hover { background: var(--surface-2); }
.t-sqlv .sv-obj:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.t-sqlv .sv-obj[aria-current="true"] { background: var(--accent-soft); color: var(--text); font-weight: 600; }
.t-sqlv .sv-obj .icon { width: 16px; height: 16px; flex: none; color: var(--muted); }
.t-sqlv .sv-obj .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t-sqlv .sv-obj .ct { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.t-sqlv .sv-null { color: var(--muted); font-style: italic; }
.t-sqlv .sv-blob { all: unset; cursor: pointer; font-family: var(--mono); font-size: 12px; color: var(--text-2); border-bottom: 1px dotted var(--muted); }
.t-sqlv .sv-blob:focus-visible, .t-sqlv .sv-long:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.t-sqlv .sv-long { all: unset; cursor: pointer; border-bottom: 1px dotted var(--muted); }
.t-sqlv .sv-pager { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.t-sqlv .sv-pager .select { width: auto; }
.t-sqlv .sv-sql { min-height: 120px; }
.t-sqlv .sv-title { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 0; font-size: 17px; overflow-wrap: anywhere; }
.t-sqlv .sv-tag { font-size: 12px; padding: 2px 8px; border-radius: 99px; background: var(--surface-2); color: var(--muted); font-weight: 500; }
.t-sqlv .table td { max-width: 360px; overflow: hidden; text-overflow: ellipsis; }
`
let styled = false
const injectStyle = () => { if (!styled) { styled = true; document.head.append(h('style', { 'data-tool': 'sqlite-viewer' }, STYLE)) } }

const TYPE_ICON = { table: 'table', view: 'eye', index: 'list-ordered', trigger: 'zap' }

export function mount(root) {
  injectStyle()
  const st = { db: null, file: null, info: null, objects: [], current: null, page: 0, pageSize: 100, last: null, modified: false }
  let gone = false
  onCleanup(() => { gone = true; try { st.db?.close() } catch { /* already closed */ } st.db = null })
  const prog = progress('Opening database')
  const result = h('div', { class: 'stack' })
  const zone = dropzone({
    label: 'Drop a SQLite database here or click to choose',
    hint: '.sqlite, .sqlite3, .db, .db3 or any SQLite file (for example browser History or app data). Opened on your device.',
    icon: 'database',
    onFiles: ([f]) => openFile(f),
  })

  async function openFile(file) {
    clear(result)
    if (file.size > MAX_DB_BYTES) { clear(result, alert('error', `${file.name} is ${formatBytes(file.size)}. The in-browser engine can open databases up to ${formatBytes(MAX_DB_BYTES)}.`)); return }
    try {
      prog.set(null, `Reading ${file.name}`)
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (!isSqlite(bytes)) throw Object.assign(new Error(notSqliteReason(bytes, file.name)), { userError: true })
      const info = headerInfo(bytes)
      prog.set(null, 'Loading the SQLite engine')
      const SQL = await loadSql()
      prog.set(null, 'Opening database')
      await yieldToMain()
      let db
      try {
        db = new SQL.Database(bytes)
        db.exec('SELECT count(*) FROM sqlite_master')
      } catch (e) {
        try { db?.close() } catch { /* ignore */ }
        throw Object.assign(new Error(`SQLite could not read this database: ${e.message}. The file may be damaged or encrypted.`), { userError: true })
      }
      // The page was left while the engine loaded: close now, or the copy of the database stays in WebAssembly memory.
      if (gone) { db.close(); return }
      try { st.db?.close() } catch { /* ignore */ }
      Object.assign(st, { db, file, info, current: null, page: 0, last: null, modified: false })
      prog.set(null, 'Counting rows')
      st.objects = await listObjects(db, { yieldFn: yieldToMain })
      if (gone) return
      zone.classList.add('compact')
      render()
      const first = st.objects.find((o) => o.type === 'table' && !o.internal) || st.objects.find((o) => o.type === 'view')
      if (first) pick(first)
    } catch (e) {
      if (gone) return // the database was closed on unmount while rows were being counted
      if (!(e.userError)) console.error(e)
      clear(result, alert('error', errorMessage(e)))
    } finally { prog.hide() }
  }

  // Elements that live for one opened database
  let sideList, mainTitle, browseHost, schemaHost, sqlEditor, sqlOut, mainTabs, dbStats, modNote

  function render() {
    const { info, file } = st
    sideList = h('div', { class: 'sv-objs', role: 'list' })
    const filterIn = input({ type: 'search', placeholder: 'Filter', 'aria-label': 'Filter tables' })
    filterIn.addEventListener('input', () => drawSide(filterIn.value))
    mainTitle = h('h2', { class: 'sv-title' })
    browseHost = h('div', { class: 'stack tight' })
    schemaHost = h('div', { class: 'stack tight' })
    sqlEditor = textarea({ class: 'sv-sql', rows: 6, mono: true, spellcheck: false, 'aria-label': 'SQL query', placeholder: 'SELECT * FROM my_table LIMIT 100;' })
    sqlOut = h('div', { class: 'stack tight' })
    const runBtn = button('Run', { icon: 'play', variant: 'primary', title: 'Run (Ctrl+Enter)' })
    const doRun = () => busy(runBtn, async () => runEditor(), { label: 'Running' })
    runBtn.addEventListener('click', doRun)
    sqlEditor.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doRun() } })
    modNote = h('span', { class: 'small muted', 'aria-live': 'polite' })
    dbStats = h('div')
    mainTabs = tabs([
      { id: 'browse', label: 'Browse', render: () => browseHost },
      { id: 'schema', label: 'Schema', render: () => schemaHost },
      { id: 'sql', label: 'SQL', render: () => h('div', { class: 'stack tight' },
        field('Query', sqlEditor, 'Ctrl+Enter (Cmd+Enter on Mac) runs it. Several statements are fine; the last result is shown.'),
        h('div', { class: 'row' }, runBtn, button('Full schema', { icon: 'file-code', size: 'sm', variant: 'ghost', onClick: () => { sqlEditor.value = st.objects.filter((o) => o.sql && o.name !== 'sqlite_master').map((o) => o.sql + ';').join('\n\n'); sqlEditor.focus() } })),
        sqlOut) },
    ])
    const dlName = () => (st.modified ? `${baseName(file.name)}-edited.${ext(file.name) || 'sqlite'}` : file.name)
    const dlBtn = button('Download database', { icon: 'download', onClick: () => {
      const data = st.db.export()
      download(new Blob([data], { type: 'application/vnd.sqlite3' }), dlName())
    } })
    clear(result,
      info.wal ? alert('info', 'This database uses WAL journal mode. Changes still waiting in a separate -wal file are not part of this file and are not shown. To include them, checkpoint the database first (PRAGMA wal_checkpoint) or copy it while the app that uses it is closed.') : null,
      dbStats,
      h('div', { class: 'sv-layout' },
        h('aside', { class: 'panel sv-side stack tight', 'aria-label': 'Database objects' }, field('', filterIn), sideList),
        h('section', { class: 'panel stack tight', style: 'min-width:0' }, mainTitle, mainTabs)),
      h('div', { class: 'row' }, dlBtn, modNote))
    drawStats()
    drawSide('')
    sqlEditor.value = (() => { const t = st.objects.find((o) => o.type === 'table' && !o.internal); return t ? `SELECT * FROM ${quoteIdent(t.name)} LIMIT 100;` : 'SELECT * FROM sqlite_master;' })()
  }

  function drawStats() {
    const { info, file, objects } = st
    const n = (t) => objects.filter((o) => o.type === t && !o.internal).length
    clear(dbStats, stats([
      { label: 'Tables', value: formatNumber(n('table')), accent: true },
      { label: 'Views', value: formatNumber(n('view')) },
      { label: 'Indexes', value: formatNumber(n('index')) },
      { label: 'Size', value: formatBytes(file.size), hint: `${formatNumber(info.pages)} pages of ${formatBytes(info.pageSize)}` },
      { label: 'Encoding', value: info.encoding, hint: [info.sqliteVersion && `written by SQLite ${info.sqliteVersion}`, info.userVersion && `user_version ${info.userVersion}`].filter(Boolean).join(', ') || null },
    ]))
  }

  function drawSide(filter) {
    const f = filter.trim().toLowerCase()
    const groups = [['table', 'Tables'], ['view', 'Views'], ['index', 'Indexes'], ['trigger', 'Triggers']]
    const items = []
    for (const [type, label] of groups) {
      const list = st.objects.filter((o) => o.type === type && (!f || o.name.toLowerCase().includes(f)))
      if (!list.length) continue
      items.push(h('div', { class: 'sv-group', role: 'presentation' }, label))
      for (const o of list) {
        items.push(h('button', { type: 'button', class: 'sv-obj', role: 'listitem', 'aria-current': String(st.current === o), title: o.name, onclick: () => pick(o) },
          icon(TYPE_ICON[o.type] || 'table'), h('span', { class: 'nm' }, o.name),
          o.rows != null ? h('span', { class: 'ct' }, formatNumber(o.rows)) : o.error ? h('span', { class: 'ct', title: o.error }, '?') : null))
      }
    }
    clear(sideList, items.length ? items : h('p', { class: 'small muted' }, f ? 'Nothing matches.' : 'This database has no tables.'))
  }

  function pick(o) {
    st.current = o
    st.page = 0
    for (const b of sideList.querySelectorAll('.sv-obj')) b.setAttribute('aria-current', String(b.title === o.name && b.querySelector('.nm').textContent === o.name))
    clear(mainTitle, icon(TYPE_ICON[o.type] || 'table'), h('span', o.name), h('span', { class: 'sv-tag' }, o.type), o.rows != null ? h('span', { class: 'sv-tag' }, `${formatNumber(o.rows)} rows`) : null)
    drawBrowse()
    drawSchema()
    mainTabs.show(o.type === 'table' || o.type === 'view' ? 'browse' : 'schema')
  }

  function drawBrowse() {
    const o = st.current
    if (!o) return
    if (o.type !== 'table' && o.type !== 'view') { clear(browseHost, h('p', { class: 'muted' }, `An ${o.type} has no rows to browse. See the Schema tab.`)); return }
    if (o.error) { clear(browseHost, alert('warn', `This ${o.type} cannot be read here: ${o.error}`)); return }
    const total = o.rows ?? 0
    const pages = Math.max(1, Math.ceil(total / st.pageSize))
    st.page = Math.min(st.page, pages - 1)
    let res
    try {
      res = runSql(st.db, `SELECT * FROM ${quoteIdent(o.name)} LIMIT ${st.pageSize} OFFSET ${st.page * st.pageSize}`)
    } catch (e) { clear(browseHost, alert('error', e.message)); return }
    const go = (p) => { st.page = Math.max(0, Math.min(pages - 1, p)); drawBrowse() }
    const from = total ? st.page * st.pageSize + 1 : 0, to = Math.min(total, (st.page + 1) * st.pageSize)
    const sizeSel = select([25, 50, 100, 250, 500].map((n) => [n, `${n} per page`]), st.pageSize, (v) => { st.pageSize = +v; st.page = 0; drawBrowse() })
    sizeSel.setAttribute('aria-label', 'Rows per page')
    const pageIn = h('input', { class: 'input', type: 'number', min: 1, max: pages, value: st.page + 1, style: 'width:88px', 'aria-label': 'Page number', onchange: (e) => go((e.target.valueAsNumber || 1) - 1) })
    clear(browseHost,
      h('div', { class: 'sv-pager' },
        button('', { icon: 'chevrons-left', size: 'sm', ariaLabel: 'First page', disabled: st.page === 0, onClick: () => go(0) }),
        button('', { icon: 'chevron-left', size: 'sm', ariaLabel: 'Previous page', disabled: st.page === 0, onClick: () => go(st.page - 1) }),
        h('span', { class: 'small' }, 'Page '), pageIn, h('span', { class: 'small' }, ` of ${formatNumber(pages)}`),
        button('', { icon: 'chevron-right', size: 'sm', ariaLabel: 'Next page', disabled: st.page >= pages - 1, onClick: () => go(st.page + 1) }),
        button('', { icon: 'chevrons-right', size: 'sm', ariaLabel: 'Last page', disabled: st.page >= pages - 1, onClick: () => go(pages - 1) }),
        sizeSel,
        h('span', { class: 'small muted', 'aria-live': 'polite' }, `Rows ${formatNumber(from)} to ${formatNumber(to)} of ${formatNumber(total)}`)),
      resultTable(res.columns, res.rows),
      h('div', { class: 'row' }, button('Query this in SQL', { icon: 'square-terminal', size: 'sm', variant: 'ghost', onClick: () => { sqlEditor.value = `SELECT * FROM ${quoteIdent(o.name)} LIMIT 100;`; mainTabs.show('sql'); sqlEditor.focus() } }),
        button('Export this page (CSV)', { icon: 'download', size: 'sm', variant: 'ghost', onClick: () => download(toCsv(res.columns, res.rows), `${safe(o.name)}-page${st.page + 1}.csv`, 'text/csv') })))
  }

  function drawSchema() {
    const o = st.current
    if (!o) return
    const kids = [h('pre', { class: 'code-out' }, o.sql || '-- no CREATE statement (internal object)'), h('div', { class: 'row' }, copyButton(() => o.sql, 'Copy CREATE SQL'))]
    if (o.type === 'table') {
      const q = (sql) => { try { return st.db.exec(sql)[0] } catch { return null } }
      const cols = q(`PRAGMA table_xinfo(${quoteIdent(o.name)})`)
      if (cols) {
        kids.push(h('h3', { style: 'margin:8px 0 0;font-size:15px' }, 'Columns'), simpleTable(['#', 'Name', 'Type', 'Not null', 'Default', 'Primary key', 'Hidden'],
          cols.values.map(([cid, name, type, notnull, dflt, pk, hidden]) => [cid, name, type || h('span', { class: 'sv-null' }, 'any'), notnull ? 'yes' : '', dflt ?? '', pk ? `yes (${pk})` : '', hidden ? (hidden === 1 ? 'virtual table' : 'generated') : ''])))
      }
      const idx = q(`PRAGMA index_list(${quoteIdent(o.name)})`)
      if (idx?.values.length) kids.push(h('h3', { style: 'margin:8px 0 0;font-size:15px' }, 'Indexes'), simpleTable(['Name', 'Unique', 'Origin', 'Partial'], idx.values.map(([, name, uniq, origin, partial]) => [name, uniq ? 'yes' : '', { c: 'CREATE INDEX', u: 'UNIQUE constraint', pk: 'PRIMARY KEY' }[origin] || origin, partial ? 'yes' : ''])))
      const fk = q(`PRAGMA foreign_key_list(${quoteIdent(o.name)})`)
      if (fk?.values.length) kids.push(h('h3', { style: 'margin:8px 0 0;font-size:15px' }, 'Foreign keys'), simpleTable(['Column', 'References', 'On update', 'On delete'], fk.values.map(([, , table, from, to, onUpd, onDel]) => [from, `${table}(${to ?? ''})`, onUpd, onDel])))
    } else if (o.type === 'index' || o.type === 'trigger') {
      kids.unshift(h('p', { class: 'small muted' }, `On table ${o.table}`))
    }
    clear(schemaHost, kids)
  }

  async function runEditor() {
    const sql = sqlEditor.value.trim()
    if (!sql) { clear(sqlOut, alert('info', 'Type a SQL query first.')); return }
    clear(sqlOut, h('p', { class: 'small muted' }, 'Running...'))
    await yieldToMain()
    const schemaBefore = st.db.exec('PRAGMA schema_version')[0].values[0][0]
    let res
    try { res = runSql(st.db, sql) } catch (e) { clear(sqlOut, alert('error', h('strong', 'SQL error: '), e.message)); return }
    const schemaAfter = st.db.exec('PRAGMA schema_version')[0].values[0][0]
    st.last = res
    if (res.changes > 0 || schemaAfter !== schemaBefore) {
      st.modified = true
      modNote.textContent = 'The database was changed in this page. Download it to keep the changes.'
      st.objects = await listObjects(st.db, { yieldFn: yieldToMain })
      drawStats()
      drawSide('')
      const again = st.current && st.objects.find((o) => o.name === st.current.name && o.type === st.current.type)
      if (again) { st.current = again; drawBrowse(); drawSchema() }
    }
    const summary = `${res.statements} statement${res.statements === 1 ? '' : 's'} in ${res.ms < 1000 ? Math.round(res.ms) + ' ms' : (res.ms / 1000).toFixed(2) + ' s'}`
    if (!res.columns.length) {
      clear(sqlOut, alert('success', `Done. ${summary}.${res.changes ? ` ${formatNumber(res.changes)} row(s) changed.` : ''}`))
      return
    }
    clear(sqlOut,
      h('div', { class: 'row between' },
        h('span', { class: 'small muted', 'aria-live': 'polite' }, `${formatNumber(res.rows.length)}${res.truncated ? '+' : ''} row${res.rows.length === 1 ? '' : 's'}, ${summary}${res.changes ? `, ${formatNumber(res.changes)} change(s)` : ''}`),
        h('div', { class: 'row' }, button('Export CSV', { icon: 'download', size: 'sm', onClick: () => download(toCsv(res.columns, res.rows), `${safe(baseName(st.file.name))}-query.csv`, 'text/csv') }),
          copyButton(() => toTsv(res.columns, res.rows.slice(0, 5000)), 'Copy as TSV'))),
      res.truncated ? alert('info', `Only the first ${formatNumber(RESULT_CAP)} rows were read. Add a LIMIT or narrow the query to see the rest.`) : null,
      resultTable(res.columns, res.rows.slice(0, SHOW_CAP)),
      res.rows.length > SHOW_CAP ? h('p', { class: 'small muted' }, `Showing the first ${formatNumber(SHOW_CAP)} rows. Export CSV includes all ${formatNumber(res.rows.length)}.`) : null)
  }

  root.append(h('div', { class: 'stack t-sqlv' }, zone, prog.el, result))
}

const safe = (s) => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 80) || 'result'

function simpleTable(columns, rows) {
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', h('tr', columns.map((c) => h('th', { scope: 'col' }, c)))),
    h('tbody', rows.map((r) => h('tr', r.map((v) => h('td', v instanceof Node ? v : String(v ?? ''))))))))
}

function resultTable(columns, rows) {
  if (!rows.length) return h('p', { class: 'muted small' }, 'No rows.')
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', h('tr', columns.map((c) => h('th', { scope: 'col' }, c)))),
    h('tbody', rows.map((r) => h('tr', r.map((v, i) => h('td', { class: typeof v === 'number' ? 'num' : null }, cell(v, columns[i]))))))))
}

function cell(v, col) {
  if (v == null) return h('span', { class: 'sv-null' }, 'NULL')
  if (v instanceof Uint8Array) {
    return h('button', { type: 'button', class: 'sv-blob', title: 'Show the whole BLOB', onclick: () => showValue(v, col) },
      `BLOB ${formatBytes(v.length)}${v.length ? ' ' + toHex(v, 8) + (v.length > 8 ? '...' : '') : ''}`)
  }
  const s = String(v)
  if (s.length > 80 || s.includes('\n')) {
    const short = s.replace(/\s+/g, ' ').slice(0, 80)
    return h('button', { type: 'button', class: 'sv-long', title: 'Show the full value', onclick: () => showValue(s, col) }, short + (s.length > 80 ? '...' : ''))
  }
  return s
}

function showValue(v, col) {
  const isBlob = v instanceof Uint8Array
  let shown = 4096
  const pre = h('pre', { class: 'code-out', style: 'max-height:50vh' }, isBlob ? hexDump(v, shown) : v)
  const more = isBlob && v.length > shown ? button('Show more', { size: 'sm', icon: 'chevrons-down', onClick: () => { shown += 16384; pre.textContent = hexDump(v, shown); if (shown >= v.length) more.remove() } }) : null
  modal({
    title: col || 'Value',
    icon: isBlob ? 'binary' : 'text',
    body: h('div', { class: 'stack tight' },
      h('div', { class: 'small muted' }, isBlob ? `BLOB, ${formatBytes(v.length)}${blobKind(v) ? `, looks like ${blobKind(v)}` : ''}` : `${formatNumber(v.length)} characters`),
      pre, more),
    actions: [
      isBlob ? button('Download', { icon: 'download', onClick: () => download(new Blob([v]), `${safe(col)}.bin`) }) : copyButton(() => v, 'Copy'),
      isBlob ? copyButton(() => toHex(v), 'Copy hex') : null,
    ].filter(Boolean),
  })
}

/** Guess a BLOB's format from its first bytes. */
export function blobKind(b) {
  const s = (n) => String.fromCharCode(...b.subarray(0, n))
  if (b[0] === 0x89 && s(4).slice(1) === 'PNG') return 'a PNG image'
  if (b[0] === 0xff && b[1] === 0xd8) return 'a JPEG image'
  if (s(4) === 'GIF8') return 'a GIF image'
  if (s(4) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'a WebP image'
  if (s(4) === '%PDF') return 'a PDF'
  if (b[0] === 0x50 && b[1] === 0x4b) return 'a ZIP archive'
  if (b[0] === 0x1f && b[1] === 0x8b) return 'gzip data'
  if (s(6) === 'bplist') return 'a binary plist'
  if (s(15) === 'SQLite format 3') return 'a SQLite database'
  return ''
}
