// DuckDB-WASM engine shared by the data-sql tools and routes. DOM-free: nothing here touches the page except loading scripts.
// The engine (about 36 MB of WebAssembly) loads on first use from a pinned CDN and stays cached by the browser.
import { xlsx as loadXlsx } from '../../lib/libs.js'
import { ext as extOf, baseName } from '../../lib/files.js'

export const DUCKDB_VERSION = '1.32.0'
export const ARROW_VERSION = '17.0.0'
const DIST = `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${DUCKDB_VERSION}/dist/`

export class DataError extends Error { constructor(m, o) { super(m, o); this.name = 'DataError'; this.userMessage = m } }

// ---------------- Engine ----------------
let pending = null
let handle = null // { duckdb, arrow, db, worker }
let active = 0
let seq = 0
const progressListeners = new Set()
let lastProgress = null

/** Call fn(fraction|null, text) while the engine downloads. Returns an unsubscribe function. */
export function onEngineProgress(fn) {
  progressListeners.add(fn)
  if (lastProgress) fn(...lastProgress)
  return () => progressListeners.delete(fn)
}
const emit = (f, t) => { lastProgress = [f, t]; for (const fn of progressListeners) fn(f, t) }

export const engineLoaded = () => !!handle

/** Load DuckDB-WASM once. Resolves to { duckdb, arrow, db }. */
export function loadEngine() {
  pending ||= (async () => {
    emit(null, 'Loading the SQL engine')
    let duckdb, arrow
    try {
      ;[duckdb, arrow] = await Promise.all([
        import(`https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${DUCKDB_VERSION}/+esm`),
        import(`https://cdn.jsdelivr.net/npm/apache-arrow@${ARROW_VERSION}/+esm`),
      ])
    } catch (e) { throw new DataError('Could not load the SQL engine. Check your connection and try again.', { cause: e }) }
    const bundle = await duckdb.selectBundle({
      mvp: { mainModule: `${DIST}duckdb-mvp.wasm`, mainWorker: `${DIST}duckdb-browser-mvp.worker.js` },
      eh: { mainModule: `${DIST}duckdb-eh.wasm`, mainWorker: `${DIST}duckdb-browser-eh.worker.js` },
    })
    // A cross-origin worker script cannot be started directly, so wrap it in a same-origin Blob worker that imports it.
    const workerUrl = URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(bundle.mainWorker)});`], { type: 'text/javascript' }))
    const worker = new Worker(workerUrl)
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker)
    try {
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker, (p) => {
        const total = p.bytesTotal || 0
        emit(total ? p.bytesLoaded / total : null, total ? `Downloading the SQL engine (${(p.bytesLoaded / 1048576).toFixed(0)} of ${(total / 1048576).toFixed(0)} MB, once)` : 'Downloading the SQL engine')
      })
    } catch (e) {
      worker.terminate()
      throw new DataError('Could not start the SQL engine. Check your connection and try again.', { cause: e })
    } finally { URL.revokeObjectURL(workerUrl) }
    emit(1, 'SQL engine ready')
    handle = { duckdb, arrow, db, worker }
    return handle
  })().catch((e) => { pending = null; handle = null; throw e })
  return pending
}

/** Free the engine and its memory when nothing is using it (the next use loads it again from the browser cache). */
export async function releaseEngine() {
  if (active > 0 || !handle) return
  const h = handle
  handle = null
  pending = null
  lastProgress = null
  try { await h.db.terminate() } catch { /* already gone */ }
  h.worker.terminate()
}

/** Run fn(engine, conn) on a fresh connection. The engine stays alive while fn runs. */
export async function withConn(fn) {
  const eng = await loadEngine()
  active++
  const conn = await eng.db.connect()
  try { return await fn(eng, conn) } finally {
    try { await conn.close() } catch { /* ignore */ }
    active--
  }
}
/** Keep the engine alive for a longer session (a tool page). Returns release(). */
export function hold() { active++; let done = false; return () => { if (!done) { done = true; active-- } } }

export const uid = (prefix = 'f') => `${prefix}${++seq}`
export const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`
export const ident = (s) => `"${String(s).replace(/"/g, '""')}"`

// ---------------- File kinds ----------------
export const KINDS = {
  csv: { label: 'CSV', exts: ['csv', 'txt', 'tab'] },
  tsv: { label: 'TSV', exts: ['tsv'] },
  json: { label: 'JSON', exts: ['json'] },
  jsonl: { label: 'JSON Lines', exts: ['jsonl', 'ndjson'] },
  parquet: { label: 'Parquet', exts: ['parquet', 'pq', 'parq'] },
  arrow: { label: 'Arrow', exts: ['arrow', 'feather', 'arrows', 'ipc'] },
  avro: { label: 'Avro', exts: ['avro'] },
  xlsx: { label: 'Excel', exts: ['xlsx', 'xlsm', 'xls', 'xlsb', 'ods'] },
}
export const ACCEPT = Object.values(KINDS).flatMap((k) => k.exts).map((e) => `.${e}`).join(',')
const EXT_KIND = new Map(Object.entries(KINDS).flatMap(([k, v]) => v.exts.map((e) => [e, k])))
const ascii = (b, from, n) => String.fromCharCode(...b.subarray(from, from + n))

/** Work out what a file is from its extension, then its first bytes. Returns a key of KINDS or null. */
export async function detectKind(file) {
  const byExt = EXT_KIND.get(extOf(file.name))
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  if (ascii(head, 0, 4) === 'PAR1') return 'parquet'
  if (ascii(head, 0, 4) === 'Obj\u0001') return 'avro'
  if (ascii(head, 0, 6) === 'ARROW1' || (head[0] === 0xff && head[1] === 0xff && head[2] === 0xff && head[3] === 0xff)) return 'arrow'
  if (byExt) return byExt
  if (head[0] === 0x50 && head[1] === 0x4b) return 'xlsx'
  const t = new TextDecoder().decode(head).trimStart()
  if (t.startsWith('[') ) return 'json'
  if (t.startsWith('{')) return 'jsonl'
  return null
}

/** A SQL-safe table name from a file name ("Sales 2024.csv" -> sales_2024). */
export function tableName(fileName, used = new Set()) {
  let n = baseName(fileName).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'data'
  if (/^\d/.test(n)) n = `t_${n}`
  if (/^(result|select|with|from|table|values)$/.test(n)) n = `${n}_1`
  let out = n
  for (let i = 2; used.has(out); i++) out = `${n}_${i}`
  used.add(out)
  return out
}

// ---------------- Reading files into DuckDB ----------------
const MAX_IN_MEMORY = 1.5 * 1024 * 1024 * 1024

/** Register a File with the engine and return its virtual path. Parquet is read in place; the rest are copied in. */
export async function registerFile(eng, file, virtualName) {
  const { db, duckdb } = eng
  if (file.size > MAX_IN_MEMORY) throw new DataError(`${file.name} is larger than the browser can hold in memory (about 1.5 GB).`)
  const kind = await detectKind(file)
  if (kind === 'parquet' || kind === 'csv' || kind === 'tsv' || kind === 'json' || kind === 'jsonl') {
    // BROWSER_FILEREADER reads the File on demand, without copying it into memory first
    await db.registerFileHandle(virtualName, file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true)
  } else {
    await db.registerFileBuffer(virtualName, new Uint8Array(await file.arrayBuffer()))
  }
  return virtualName
}

const CSV_TRIES = [
  { opts: '', note: '' },
  { opts: ', sample_size=-1', note: '' },
  { opts: ', sample_size=-1, all_varchar=true', note: 'Some columns have mixed values, so they were read as text.' },
  { opts: ', sample_size=-1, all_varchar=true, ignore_errors=true, null_padding=true', note: 'Some rows were irregular. Short rows were padded and broken rows skipped.' },
]

/**
 * Turn a File into one or more DuckDB tables or views on `conn`.
 * Returns [{ name, kind, note }]. Excel gives one table per sheet; everything else one.
 * opts: { name, sheet (index, or 'all'), kind, onProgress }
 */
export async function loadFile(eng, conn, file, opts = {}) {
  const kind = opts.kind || (await detectKind(file))
  if (!kind) throw new DataError(`${file.name}: this file type is not supported. Use CSV, TSV, JSON, JSON Lines, Parquet, Arrow, Avro or Excel.`)
  const name = opts.name || tableName(file.name)
  const vname = `${uid('in')}_${file.name.replace(/[^\w.-]+/g, '_')}`
  const T = ident(name)
  const done = (sql) => conn.query(sql)
  const notes = []
  let keep = false // a Parquet view reads its file lazily, so the file must stay registered
  try {
    if (kind === 'csv' || kind === 'tsv') {
      await registerFile(eng, file, vname)
      let err
      for (const t of CSV_TRIES) {
        try {
          const delim = kind === 'tsv' ? ", delim='\\t'" : ''
          await done(`CREATE OR REPLACE TEMP TABLE ${T} AS SELECT * FROM read_csv(${sqlStr(vname)}${delim}${t.opts})`)
          if (t.note) notes.push(t.note)
          err = null
          break
        } catch (e) { err = e }
      }
      if (err) throw new DataError(`${file.name}: could not read this as a table. ${cleanErr(err)}`, { cause: err })
    } else if (kind === 'json' || kind === 'jsonl') {
      await registerFile(eng, file, vname)
      const fmt = kind === 'jsonl' ? 'newline_delimited' : 'auto'
      try {
        await done(`CREATE OR REPLACE TEMP TABLE ${T} AS SELECT * FROM read_json_auto(${sqlStr(vname)}, format=${sqlStr(fmt)}, sample_size=-1, maximum_object_size=268435456)`)
      } catch (e) {
        throw new DataError(`${file.name}: could not read this JSON. It should be an array of objects or one object per line. ${cleanErr(e)}`, { cause: e })
      }
    } else if (kind === 'parquet') {
      await registerFile(eng, file, vname)
      try { await done(`CREATE OR REPLACE TEMP VIEW ${T} AS SELECT * FROM read_parquet(${sqlStr(vname)})`); await done(`SELECT 1 FROM ${T} LIMIT 0`) } catch (e) {
        throw new DataError(`${file.name}: this does not look like a valid Parquet file. ${cleanErr(e)}`, { cause: e })
      }
      keep = true
    } else if (kind === 'arrow') {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let table, A = eng.arrow
      try { table = A.tableFromIPC(bytes) } catch (e) {
        if (!/compress|codec|lz4|zstd/i.test(String(e?.message))) throw arrowError(file, e)
        try { A = await compressedArrow(); table = A.tableFromIPC(bytes) } catch (e2) { throw arrowError(file, e2) }
      }
      const stream = A.tableToIPC(table, 'stream')
      const stage = uid('arrowstage')
      await conn.insertArrowFromIPCStream(stream, { name: stage, create: true })
      await done(`CREATE OR REPLACE TEMP TABLE ${T} AS SELECT * FROM ${ident(stage)}`)
      await done(`DROP TABLE ${ident(stage)}`)
    } else if (kind === 'avro') {
      const { readAvro } = await import('./_avro.js')
      const { columns, json, rows } = await readAvro(new Uint8Array(await file.arrayBuffer()))
      if (!columns.length || !rows) throw new DataError(`${file.name}: the Avro file has no records.`)
      await eng.db.registerFileText(vname, json)
      await done(`CREATE OR REPLACE TEMP TABLE ${T} AS SELECT * FROM read_json_auto(${sqlStr(vname)}, format='newline_delimited', sample_size=-1, maximum_object_size=268435456)`)
    } else if (kind === 'xlsx') {
      const sheets = await excelSheets(file)
      const pick = opts.sheet === 'all' ? sheets : [sheets[Math.min(Math.max(Number(opts.sheet ?? 0) || 0, 0), sheets.length - 1)]]
      const out = []
      for (const sh of pick) {
        const tname = pick.length > 1 || opts.sheet === 'all' ? `${name}_${tableName(sh.name).replace(/^t_/, '')}` : name
        const jname = `${uid('xl')}.jsonl`
        const { columns, json, rows, kinds } = sh.read()
        sh.kinds = kinds
        if (!columns.length || !rows) { notes.push(`Sheet "${sh.name}" is empty.`); continue }
        await eng.db.registerFileText(jname, json)
        const sel = columns.map((c, i) => `${sh.kinds?.[i] === 'date' ? `CAST(c${i} AS DATE)` : sh.kinds?.[i] === 'ts' ? `CAST(c${i} AS TIMESTAMP)` : `c${i}`} AS ${ident(c)}`).join(', ')
        await done(`CREATE OR REPLACE TEMP TABLE ${ident(tname)} AS SELECT ${sel} FROM read_json_auto(${sqlStr(jname)}, format='newline_delimited', sample_size=-1)`)
        await eng.db.dropFile(jname)
        out.push({ name: tname, kind, note: sh.name })
      }
      if (!out.length) throw new DataError(`${file.name}: no data found in the workbook.`)
      return out
    }
  } finally {
    if (!keep) { try { await eng.db.dropFile(vname) } catch { /* not registered */ } }
  }
  return [{ name, kind, note: notes.join(' '), file: keep ? vname : null }]
}

// Arrow files saved with LZ4 or ZSTD buffer compression (Feather's default is LZ4) need a newer Arrow reader plus a decompressor.
let packed = null
function compressedArrow() {
  packed ||= (async () => {
    const [A, lz4, zstd] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/apache-arrow@21.1.0/+esm'),
      import('https://cdn.jsdelivr.net/npm/lz4js@0.2.0/+esm'),
      import('https://cdn.jsdelivr.net/npm/fzstd@0.1.1/+esm'),
    ])
    const L = lz4.default || lz4 // the decoders return copies because Arrow needs 8-byte aligned buffers
    const Z = zstd.default || zstd
    A.compressionRegistry.set(A.CompressionType.LZ4_FRAME, { decode: (d) => new Uint8Array(L.decompress(d)) })
    A.compressionRegistry.set(A.CompressionType.ZSTD, { decode: (d) => new Uint8Array(Z.decompress(d)) })
    return A
  })().catch((e) => { packed = null; throw e })
  return packed
}

/** A readable one-line message from a DuckDB error (the message may be plain text or a JSON object). */
export function cleanErr(e) {
  let m = String(e?.message || e)
  try { const j = JSON.parse(m); if (j.exception_message) m = `${j.exception_type ? `${j.exception_type} Error: ` : ''}${j.exception_message}` } catch { /* plain text */ }
  return m.replace(/^(Invalid Input|IO|Parser|Binder|Catalog|Conversion|Out of Memory|Not implemented|Invalid) Error:\s*/i, '').split(String.fromCharCode(10))[0].slice(0, 400)
}
function arrowError(file, e) {
  const m = String(e?.message || e)
  if (/compress|codec|lz4|zstd/i.test(m)) return new DataError(`${file.name}: this Arrow file is compressed (for example Feather with LZ4), which the browser reader cannot decode. Save it again uncompressed (pyarrow: compression='uncompressed') and retry.`, { cause: e })
  return new DataError(`${file.name}: this does not look like a valid Arrow or Feather file. ${cleanErr(e)}`, { cause: e })
}

// ---------------- Excel ----------------
const isDateFmt = (X, z) => !!z && z !== 'General' && X.SSF.is_date(z)
const pad = (n, w = 2) => String(n).padStart(w, '0')

/** Sheets of a workbook, each with read() -> { columns, rows, json } (typed JSON lines, column keys c0, c1, ...). */
export async function excelSheets(file) {
  const X = await loadXlsx()
  const wb = X.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: false, cellNF: true, dense: false })
  if (!wb.SheetNames.length) throw new DataError(`${file.name}: the workbook has no sheets.`)
  return wb.SheetNames.map((name) => ({ name, read: () => sheetToJsonl(X, wb.Sheets[name]) }))
}

function sheetToJsonl(X, ws) {
  if (!ws || !ws['!ref']) return { columns: [], rows: 0, json: '' }
  const range = X.utils.decode_range(ws['!ref'])
  let isDate = false // set by cell() when the value it returned came from a date cell: 'date' (no time of day) or 'ts'
  const cell = (r, c) => {
    isDate = false
    const x = ws[X.utils.encode_cell({ r, c })]
    if (!x || x.v === undefined || x.t === 'z') return null
    if (x.t === 'n' && isDateFmt(X, x.z)) {
      const d = X.SSF.parse_date_code(x.v)
      if (d) {
        isDate = d.H || d.M || d.S ? 'ts' : 'date'
        return isDate === 'ts' ? `${pad(d.y, 4)}-${pad(d.m)}-${pad(d.d)} ${pad(d.H)}:${pad(d.M)}:${pad(Math.floor(d.S))}` : `${pad(d.y, 4)}-${pad(d.m)}-${pad(d.d)}`
      }
    }
    if (x.t === 'd') { isDate = 'ts'; return x.v instanceof Date ? x.v.toISOString().slice(0, 19).replace('T', ' ') : String(x.v) }
    if (x.t === 'e') return null
    return x.v
  }
  // header = first row that has any value
  let h0 = range.s.r
  while (h0 <= range.e.r && Array.from({ length: range.e.c - range.s.c + 1 }, (_, i) => cell(h0, range.s.c + i)).every((v) => v == null || v === '')) h0++
  if (h0 > range.e.r) return { columns: [], rows: 0, json: '' }
  const used = new Set()
  const columns = []
  for (let c = range.s.c; c <= range.e.c; c++) {
    let n = String(cell(h0, c) ?? '').trim() || `column${c - range.s.c + 1}`
    let out = n
    for (let i = 2; used.has(out.toLowerCase()); i++) out = `${n}_${i}`
    used.add(out.toLowerCase())
    columns.push(out)
  }
  const lines = []
  const kinds = columns.map(() => undefined) // undefined: no values yet; 'date' or 'ts': every value is a date cell; null: anything else
  for (let r = h0 + 1; r <= range.e.r; r++) {
    const o = {}
    let any = false
    for (let c = range.s.c; c <= range.e.c; c++) {
      const v = cell(r, c)
      const i = c - range.s.c
      o[`c${i}`] = v
      if (v != null && v !== '') {
        any = true
        const k = isDate || null
        kinds[i] = kinds[i] === undefined ? k : kinds[i] === k ? k : kinds[i] && k ? 'ts' : null // dates with and without a time stay a timestamp
      }
    }
    if (any) lines.push(JSON.stringify(o))
  }
  return { columns, kinds, rows: lines.length, json: lines.join('\n') }
}

// ---------------- Describing and exporting ----------------
/** Columns of a table or SELECT: [{ name, type }]. */
export async function describe(conn, src) {
  const t = await conn.query(`DESCRIBE ${/^\s*(select|with|from)\b/i.test(src) ? `(${src})` : ident(src)}`)
  return t.toArray().map((r) => ({ name: String(r.column_name), type: String(r.column_type) }))
}
const NUMERIC = /^(TINYINT|SMALLINT|INTEGER|BIGINT|UTINYINT|USMALLINT|UINTEGER|FLOAT|DOUBLE|REAL)$/i
const INTEGER = /^(TINYINT|SMALLINT|INTEGER|BIGINT|UTINYINT|USMALLINT|UINTEGER)$/i

/** Classify a DuckDB type: int, float, bool, date, ts, blob or str. */
export function typeClass(type) {
  const t = String(type).toUpperCase()
  if (INTEGER.test(t)) return 'int'
  if (NUMERIC.test(t) || /^DECIMAL|^HUGEINT|^UBIGINT|^UHUGEINT/.test(t)) return 'float'
  if (t === 'BOOLEAN') return 'bool'
  if (t === 'DATE') return 'date'
  if (/^TIMESTAMP/.test(t)) return 'ts'
  if (t === 'BLOB') return 'blob'
  return 'str'
}

const toNum = (v) => (typeof v === 'bigint' ? Number(v) : v)
/** Run a SELECT and hand back plain rows (arrays) for the typed columns: numbers, booleans, strings (dates as text), or null. */
export async function typedRows(conn, src, { dates = 'text', blobs = 'hex' } = {}) {
  const cols = await describe(conn, src)
  const sel = cols.map((c) => {
    const k = typeClass(c.type)
    const q = ident(c.name)
    if (k === 'int' || k === 'bool') return q
    if (k === 'float') return /^(FLOAT|DOUBLE|REAL)$/i.test(c.type) ? q : `CAST(${q} AS DOUBLE) AS ${q}`
    if (k === 'date' && dates === 'serial') return `CAST(epoch(CAST(${q} AS TIMESTAMP)) / 86400.0 + 25569.0 AS DOUBLE) AS ${q}`
    if (k === 'ts' && dates === 'serial') return `CAST(epoch(CAST(${q} AS TIMESTAMP)) / 86400.0 + 25569.0 AS DOUBLE) AS ${q}`
    if (k === 'blob' && blobs === 'hex') return `lower(hex(${q})) AS ${q}`
    if (k === 'blob') return q
    return `CAST(${q} AS VARCHAR) AS ${q}`
  })
  const table = await conn.query(`SELECT ${sel.join(', ')} FROM (${/^\s*(select|with|from)\b/i.test(src) ? src : `SELECT * FROM ${ident(src)}`})`)
  return { cols, table, rowCount: table.numRows, get: (i) => table.getChildAt(i) }
}
export { toNum }

const COMPRESSIONS = new Set(['snappy', 'zstd', 'gzip', 'uncompressed', 'brotli', 'lz4'])
export const EXPORT_FORMATS = {
  csv: { label: 'CSV', ext: 'csv', mime: 'text/csv' },
  tsv: { label: 'TSV', ext: 'tsv', mime: 'text/tab-separated-values' },
  json: { label: 'JSON', ext: 'json', mime: 'application/json' },
  jsonl: { label: 'JSON Lines', ext: 'jsonl', mime: 'application/x-ndjson' },
  parquet: { label: 'Parquet', ext: 'parquet', mime: 'application/vnd.apache.parquet' },
  arrow: { label: 'Arrow (Feather)', ext: 'arrow', mime: 'application/vnd.apache.arrow.file' },
  feather: { label: 'Feather', ext: 'feather', mime: 'application/vnd.apache.arrow.file' },
  xlsx: { label: 'Excel (XLSX)', ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
}

/**
 * Export a table (name) or a SELECT to bytes.
 * fmt: csv, tsv, json, jsonl, parquet, arrow, feather, xlsx. opts: { compression, header (csv), sheetName }
 */
export async function exportData(eng, conn, src, fmt, opts = {}) {
  const from = /^\s*(select|with|from)\b/i.test(src) ? `(${src})` : ident(src)
  const out = `${uid('out')}.${fmt === 'feather' ? 'arrow' : fmt}`
  try {
    if (fmt === 'csv' || fmt === 'tsv') {
      await conn.query(`COPY ${from} TO ${sqlStr(out)} (FORMAT CSV, HEADER ${opts.header === false ? 'false' : 'true'}, DELIMITER ${fmt === 'tsv' ? "'\\t'" : "','"})`)
    } else if (fmt === 'json' || fmt === 'jsonl') {
      await conn.query(`COPY ${from} TO ${sqlStr(out)} (FORMAT JSON, ARRAY ${fmt === 'json' ? 'true' : 'false'})`)
    } else if (fmt === 'parquet') {
      const c = COMPRESSIONS.has(opts.compression) ? opts.compression : 'snappy'
      await conn.query(`COPY ${from} TO ${sqlStr(out)} (FORMAT PARQUET, COMPRESSION ${c})`)
    } else if (fmt === 'arrow' || fmt === 'feather') {
      const table = await conn.query(`SELECT * FROM ${from}`)
      return eng.arrow.tableToIPC(table, 'file')
    } else if (fmt === 'xlsx') {
      return await toXlsx(conn, src, opts)
    } else throw new DataError(`Unknown output format ${fmt}.`)
    return await eng.db.copyFileToBuffer(out)
  } finally { try { await eng.db.dropFile(out) } catch { /* not created */ } }
}

const XLSX_MAX_ROWS = 1048575
async function toXlsx(conn, src, opts) {
  const X = await loadXlsx()
  const { cols, table, rowCount } = await typedRows(conn, src, { dates: 'serial', blobs: 'hex' })
  if (rowCount > XLSX_MAX_ROWS) throw new DataError(`Excel sheets hold at most ${XLSX_MAX_ROWS.toLocaleString()} rows and this has ${rowCount.toLocaleString()}. Filter it first, or use CSV or Parquet.`)
  const vecs = cols.map((_, i) => table.getChildAt(i))
  const ws = {}
  const fmts = cols.map((c) => { const k = typeClass(c.type); return k === 'date' ? 'yyyy-mm-dd' : k === 'ts' ? 'yyyy-mm-dd hh:mm:ss' : null })
  cols.forEach((c, i) => { ws[X.utils.encode_cell({ r: 0, c: i })] = { t: 's', v: c.name } })
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < cols.length; c++) {
      let v = vecs[c].get(r)
      if (v == null) continue
      const k = typeClass(cols[c].type)
      let cell
      if (typeof v === 'bigint') v = Number.isSafeInteger(Number(v)) ? Number(v) : String(v)
      if (typeof v === 'number') cell = { t: 'n', v }
      else if (typeof v === 'boolean') cell = { t: 'b', v }
      else cell = { t: 's', v: String(v) }
      if (cell.t === 'n' && fmts[c] && (k === 'date' || k === 'ts')) cell.z = fmts[c]
      ws[X.utils.encode_cell({ r: r + 1, c })] = cell
    }
  }
  ws['!ref'] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rowCount, 0), c: Math.max(cols.length - 1, 0) } })
  ws['!cols'] = cols.map((c) => ({ wch: Math.min(40, Math.max(8, c.name.length + 2)) }))
  const wb = X.utils.book_new()
  X.utils.book_append_sheet(wb, ws, String(opts.sheetName || 'Sheet1').replace(/[\\/?*[\]:]/g, '_').slice(0, 31) || 'Sheet1')
  return new Uint8Array(X.write(wb, { type: 'array', bookType: 'xlsx', compression: true }))
}

/** Row and column counts of a table or SELECT. */
export async function countOf(conn, src) {
  const from = /^\s*(select|with|from)\b/i.test(src) ? `(${src})` : ident(src)
  const [r, c] = await Promise.all([conn.query(`SELECT count(*) AS n FROM ${from}`), describe(conn, src)])
  return { rows: Number(r.getChildAt(0).get(0)), cols: c.length }
}
