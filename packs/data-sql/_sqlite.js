// SQLite <-> CSV helpers. sql.js (SQLite compiled to WebAssembly, MIT) reads and writes the .sqlite file; DuckDB parses the CSV and
// guesses the column types. The same sql.js build the data and reverse packs use, so the browser cache is shared. DOM-free apart from script loading.
import { script } from '../../lib/libs.js'
import { yieldToMain } from '../../lib/ui.js'
import { DataError, withConn, loadFile, typedRows, tableName, typeClass, ident } from './_engine.js'

const SQLJS = 'https://cdn.jsdelivr.net/npm/sql.js@1.14.1/dist/'
let sqlPromise = null
export const loadSql = () => (sqlPromise ||= script(`${SQLJS}sql-wasm.js`)
  .then(() => window.initSqlJs({ locateFile: (f) => `${SQLJS}${f}` }))
  .catch((e) => { sqlPromise = null; throw new DataError('Could not load the SQLite engine. Check your connection and try again.', { cause: e }) }))

const MAGIC = 'SQLite format 3\u0000'
export const isSqlite = (b) => b.length >= 16 && [...MAGIC].every((c, i) => b[i] === c.charCodeAt(0))

const csvCell = (v) => {
  if (v == null) return ''
  if (v instanceof Uint8Array) return Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('') // BLOBs as hex
  const s = typeof v === 'string' ? v : String(v)
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Open a SQLite file with sql.js. Returns the database (the caller closes it). */
export async function openSqlite(file) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!bytes.length) throw new DataError(`${file.name}: the file is empty.`)
  if (!isSqlite(bytes)) throw new DataError(`${file.name}: this is not a SQLite database (it does not start with the "SQLite format 3" header). Encrypted databases cannot be opened.`)
  const SQL = await loadSql()
  try { return new SQL.Database(bytes) } catch (e) { throw new DataError(`${file.name}: could not open this database. ${e.message}`, { cause: e }) }
}

/** Every table (and optionally view) of a SQLite file as CSV. Returns [{ name, rows, columns, blob }]. */
export async function sqliteToCsv(file, { views = false, bom = false, header = true, onProgress, signal } = {}) {
  const db = await openSqlite(file)
  try {
    const list = db.exec(`SELECT name FROM sqlite_master WHERE type IN ('table'${views ? ",'view'" : ''}) AND name NOT LIKE 'sqlite_%' ORDER BY name`)[0]?.values.flat() || []
    if (!list.length) throw new DataError(`${file.name}: the database has no tables.`)
    const out = []
    for (let t = 0; t < list.length; t++) {
      const name = list[t]
      let stmt
      try { stmt = db.prepare(`SELECT * FROM ${ident(name)}`) } catch (e) { throw new DataError(`${file.name}: could not read table "${name}". ${e.message}`, { cause: e }) }
      const cols = stmt.getColumnNames()
      const chunks = [bom ? '﻿' : '']
      if (header) chunks.push(`${cols.map(csvCell).join(',')}\n`)
      let buf = []
      let n = 0
      while (stmt.step()) {
        buf.push(`${stmt.get().map(csvCell).join(',')}\n`)
        if (++n % 20000 === 0) {
          chunks.push(buf.join(''))
          buf = []
          await yieldToMain()
          if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
        }
      }
      stmt.free()
      chunks.push(buf.join(''))
      out.push({ name, rows: n, columns: cols.length, blob: new Blob(chunks, { type: 'text/csv' }) })
      onProgress?.((t + 1) / list.length)
    }
    return out
  } finally { db.close() }
}

const SQLITE_TYPE = { int: 'INTEGER', bool: 'INTEGER', float: 'REAL', blob: 'BLOB', date: 'TEXT', ts: 'TEXT', str: 'TEXT' }

/**
 * Build a SQLite database from data files (CSV, TSV, JSON, Parquet, Excel ...), one table per file (per sheet for Excel).
 * Returns { bytes, tables: [{ name, rows, columns }] }.
 */
export async function filesToSqlite(files, { onProgress } = {}) {
  const SQL = await loadSql()
  const db = new SQL.Database()
  const used = new Set()
  const tables = []
  try {
    await withConn(async (eng, conn) => {
      for (let f = 0; f < files.length; f++) {
        const file = files[f]
        const loaded = await loadFile(eng, conn, file, { name: `src${f}`, sheet: 'all' })
        for (const t of loaded) {
          const name = tableName(loaded.length > 1 ? `${file.name.replace(/\.[^.]+$/, '')}_${t.note || t.name}` : file.name, used)
          const { cols, table, rowCount } = await typedRows(conn, t.name, { dates: 'text', blobs: 'raw' })
          const seen = new Set()
          const names = cols.map((c) => {
            const n = c.name || 'column'
            let o = n
            for (let i = 2; seen.has(o.toLowerCase()); i++) o = `${n}_${i}`
            seen.add(o.toLowerCase())
            return o
          })
          db.run(`CREATE TABLE ${ident(name)} (${cols.map((c, i) => `${ident(names[i])} ${SQLITE_TYPE[typeClass(c.type)]}`).join(', ')})`)
          const ins = db.prepare(`INSERT INTO ${ident(name)} VALUES (${cols.map(() => '?').join(',')})`)
          const vecs = cols.map((_, i) => table.getChildAt(i))
          db.run('BEGIN')
          for (let r = 0; r < rowCount; r++) {
            ins.run(vecs.map((v) => {
              const x = v.get(r)
              if (x == null) return null
              if (typeof x === 'bigint') return Number.isSafeInteger(Number(x)) ? Number(x) : String(x)
              if (typeof x === 'boolean') return x ? 1 : 0
              return x
            }))
            if (r % 20000 === 19999) await yieldToMain()
          }
          db.run('COMMIT')
          ins.free()
          tables.push({ name, rows: rowCount, columns: cols.length })
          await conn.query(`DROP VIEW IF EXISTS ${ident(t.name)}`).catch(() => {})
          await conn.query(`DROP TABLE IF EXISTS ${ident(t.name)}`).catch(() => {})
          if (t.file) await eng.db.dropFile(t.file).catch(() => {})
        }
        onProgress?.((f + 1) / files.length)
      }
    })
    return { bytes: db.export(), tables }
  } finally { db.close() }
}
