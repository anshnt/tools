// CSV to SQL: CREATE TABLE and INSERT statements for MySQL, PostgreSQL, SQLite and SQL Server.
import { h, clear, field, select, toggle, input, number, tabs, formatBytes, copyButton, button, download, debounce, alert } from '../../lib/ui.js'
import { inferTypes, isNumericType, parseNumberEx, parseDate, fmtDate, inferDateOrder, localeDateOrder, isEmpty, str, sqlName, plural } from './_table.js'
import { toolFlow, statTiles, nameBase, section } from './_view.js'

const MAX_ROWS = 500000
export const DIALECTS = [['mysql', 'MySQL / MariaDB'], ['postgres', 'PostgreSQL'], ['sqlite', 'SQLite'], ['sqlserver', 'SQL Server']]

const quoteId = (d, n) => (d === 'mysql' ? `\`${n}\`` : d === 'sqlserver' ? `[${n}]` : `"${n}"`)
const lit = (d, s) => `'${(d === 'mysql' ? s.replace(/\\/g, '\\\\') : s).replace(/'/g, "''")}'`

function colType(d, type, maxLen, scale) {
  if (type === 'integer') return d === 'mysql' || d === 'sqlserver' ? 'INT' : 'INTEGER'
  if (type === 'number' || type === 'currency' || type === 'percent') {
    if (scale !== null && scale <= 4 && d !== 'sqlite') return `DECIMAL(18,${scale})`
    return d === 'mysql' ? 'DOUBLE' : d === 'postgres' ? 'DOUBLE PRECISION' : d === 'sqlserver' ? 'FLOAT' : 'REAL'
  }
  if (type === 'boolean') return d === 'sqlserver' ? 'BIT' : d === 'sqlite' ? 'INTEGER' : 'BOOLEAN'
  if (type === 'date') return d === 'sqlite' ? 'TEXT' : 'DATE'
  if (type === 'datetime') return d === 'sqlite' ? 'TEXT' : d === 'postgres' ? 'TIMESTAMP' : d === 'sqlserver' ? 'DATETIME2' : 'DATETIME'
  if (d === 'sqlite') return 'TEXT'
  if (maxLen > 4000) return d === 'sqlserver' ? 'NVARCHAR(MAX)' : 'TEXT'
  if (maxLen > 255 && d === 'mysql') return maxLen > 16000 ? 'TEXT' : `VARCHAR(${Math.min(65535, Math.ceil(maxLen / 100) * 100)})`
  const n = Math.max(32, Math.min(255, Math.ceil(maxLen / 32) * 32))
  return d === 'sqlserver' ? `NVARCHAR(${Math.max(n, 255)})` : `VARCHAR(${Math.max(n, 255)})`
}

/** Generate SQL. o: { dialect, table, create, drop, pk, cols (snake | keep), batch, emptyNull, transaction, ifNotExists }. Returns { sql, notes, rows }. */
export function generateSql(t, o, types = inferTypes(t)) {
  const d = o.dialect
  const used = new Set()
  const names = t.headers.map((x) => (o.cols === 'keep' ? x.replace(/[`"\[\]]/g, '') || 'col' : sqlName(x, used)))
  const q = (n) => quoteId(d, n)
  const tbl = q(o.cols === 'keep' ? o.table.replace(/[`"\[\]]/g, '') || 'my_table' : sqlName(o.table, new Set()))
  const notes = []
  const orders = t.headers.map((_, c) => (types[c] === 'date' || types[c] === 'datetime' ? inferDateOrder(t.rows.slice(0, 3000).map((r) => r[c])) || localeDateOrder() : null))
  let bad = 0
  const cell = (v, c) => {
    const ty = types[c]
    if (isEmpty(v)) return ty === 'text' && !o.emptyNull ? "''" : 'NULL'
    if (isNumericType(ty)) {
      const p = parseNumberEx(v)
      if (!p) { bad++; return 'NULL' }
      return String(+p.n.toPrecision(15))
    }
    if (ty === 'boolean') {
      const on = /^true$/i.test(str(v).trim()) || v === true
      return d === 'postgres' || d === 'mysql' ? (on ? 'TRUE' : 'FALSE') : on ? '1' : '0'
    }
    if (ty === 'date' || ty === 'datetime') {
      const p = typeof v === 'string' ? parseDate(v, orders[c]) : null
      if (!p) { bad++; return 'NULL' }
      return lit(d, fmtDate(p, ty === 'datetime'))
    }
    return lit(d, str(v))
  }
  const out = []
  if (o.transaction && d !== 'mysql') out.push(d === 'sqlserver' ? 'BEGIN TRANSACTION;' : 'BEGIN;')
  else if (o.transaction) out.push('START TRANSACTION;')
  if (o.drop) out.push(d === 'sqlserver' ? `IF OBJECT_ID('${tbl.replace(/[\[\]]/g, '')}', 'U') IS NOT NULL DROP TABLE ${tbl};` : `DROP TABLE IF EXISTS ${tbl};`)
  if (o.create) {
    const lens = t.headers.map((_, c) => { let m = 0; for (const r of t.rows) { const l = str(r[c]).length; if (l > m) m = l }; return m })
    const scales = t.headers.map((_, c) => {
      if (!isNumericType(types[c]) || types[c] === 'integer') return null
      let s = 0
      for (const r of t.rows.slice(0, 5000)) { const m = /[.](\d+)\s*%?$/.exec(str(r[c]).trim()); if (m) s = Math.max(s, m[1].length) }
      return types[c] === 'percent' ? null : s
    })
    const cols = names.map((n, c) => `  ${q(n)} ${colType(d, types[c], lens[c], scales[c])}${o.pk === c ? ' PRIMARY KEY' : ''}`)
    out.push(`CREATE TABLE ${o.ifNotExists && d !== 'sqlserver' ? 'IF NOT EXISTS ' : ''}${tbl} (\n${cols.join(',\n')}\n);`)
  }
  const colList = o.withCols ? ` (${names.map(q).join(', ')})` : ''
  const rows = t.rows.slice(0, MAX_ROWS)
  const batch = Math.max(1, Math.min(o.batch, d === 'sqlserver' ? 1000 : 100000))
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch)
    const vals = chunk.map((r) => `(${t.headers.map((_, c) => cell(r[c], c)).join(', ')})`)
    out.push(`INSERT INTO ${tbl}${colList} VALUES\n${vals.map((v) => `  ${v}`).join(',\n')};`)
  }
  if (o.transaction) out.push('COMMIT;')
  if (t.rows.length > MAX_ROWS) notes.push(`Only the first ${MAX_ROWS.toLocaleString()} rows were written. Split the file first for more.`)
  if (bad) notes.push(`${plural(bad, 'value')} did not fit the detected column type and became NULL. Check the CREATE TABLE types.`)
  return { sql: out.join('\n\n') + '\n', notes, rows: rows.length }
}

export function mount(root) {
  let entry = null
  const o = { dialect: 'mysql', table: 'my_table', create: true, drop: false, pk: -1, cols: 'snake', batch: 100, emptyNull: true, transaction: false, ifNotExists: false, withCols: true }
  const statsHost = h('div'), outHost = h('div'), noteHost = h('div'), actHost = h('div')
  let sql = ''
  const pkSel = h('select', { class: 'select', 'aria-label': 'Primary key', onchange: (e) => { o.pk = +e.target.value; run() } })
  const tableInput = input({ value: o.table, 'aria-label': 'Table name', oninput: (e) => { o.table = e.target.value || 'my_table'; run() } })
  const f = toolFlow({
    titles: ['Add your CSV', 'Choose the SQL flavor', 'Copy or download the SQL'],
    source: { sample: 'sales', hint: 'CSV, Excel or JSON. You can also paste rows from a spreadsheet.' },
    onData: (e) => { entry = e; if (e) init() },
  })
  function init() {
    const t = entry.table
    o.table = sqlName(nameBase(entry).replace(/[-_ ]?sample$/i, ''), new Set())
    tableInput.value = o.table
    o.pk = -1
    clear(pkSel, [h('option', { value: '-1' }, 'None'), ...t.headers.map((x, i) => h('option', { value: String(i) }, x))])
    const guess = t.headers.findIndex((x) => /^(id|.*_id)$/i.test(x))
    if (guess >= 0 && new Set(t.rows.map((r) => str(r[guess]))).size === t.rows.length) { o.pk = guess; pkSel.value = String(guess) }
    run()
  }
  const run = debounce(() => {
    if (!entry) return
    const r = generateSql(entry.table, o)
    sql = r.sql
    clear(statsHost, statTiles([{ label: 'Rows', value: r.rows, accent: true }, { label: 'Columns', value: entry.table.headers.length }, { label: 'SQL size', value: formatBytes(new Blob([sql]).size) }]))
    clear(noteHost, r.notes.map((n) => alert('warn', n)))
    clear(outHost, h('pre', { class: 'dt-code', tabindex: 0, style: 'max-height:520px' }, sql.length > 300_000 ? `${sql.slice(0, 300_000)}\n\n-- ... cut off in the preview. Copy or download for everything.` : sql))
    clear(actHost, h('div', { class: 'dt-actions sticky' }, button('Download .sql', { icon: 'download', variant: 'primary', size: 'lg', onClick: () => download(new Blob([sql], { type: 'application/sql' }), `${o.table || 'table'}.sql`) }), copyButton(() => sql, 'Copy SQL', { variant: 'secondary', size: undefined })))
  }, 120)
  const T = (label, key) => toggle(label, o[key], (v) => { o[key] = v; run() })
  const n = number(100, { min: 1, step: 1, ariaLabel: 'Rows per INSERT', onInput: (v) => { if (v >= 1) { o.batch = Math.floor(v); run() } } })
  f.s2.body.append(h('div', { class: 'panel stack' }, h('div', { class: 'dt-grid' },
    field('SQL flavor', select(DIALECTS, 'mysql', (v) => { o.dialect = v; run() })), field('Table name', tableInput), field('Primary key', pkSel),
    field('Column names', select([['snake', 'Tidy (lower_case_with_underscores)'], ['keep', 'Keep as written']], 'snake', (v) => { o.cols = v; run() })),
    field('Rows per INSERT', n, 'Bigger batches load faster.')),
  h('div', { class: 'row' }, T('Include CREATE TABLE', 'create'), T('Drop the table first', 'drop'), T('IF NOT EXISTS', 'ifNotExists'), T('List column names in INSERT', 'withCols'), T('Empty text cells become NULL', 'emptyNull'), T('Wrap in a transaction', 'transaction'))))
  f.s3.body.append(statsHost, noteHost, outHost, actHost)
  root.append(f.el)
}
