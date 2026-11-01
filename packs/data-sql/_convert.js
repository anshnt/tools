// Routes this pack can convert (for the File Converter hub) and the functions the tools call. Nothing here needs the DOM.
// Parquet, Arrow (Feather), Avro, CSV, TSV, JSON, JSON Lines, Excel and SQLite, all through DuckDB-WASM (loaded only when a route runs).
import { baseName, safeName, zip } from '../../lib/files.js'
import { withConn, loadFile, exportData, countOf, EXPORT_FORMATS, DataError, detectKind } from './_engine.js'

const PARQUET_OPTIONS = [{ key: 'compression', label: 'Parquet compression', type: 'select', choices: [['snappy', 'Snappy (fast, default)'], ['zstd', 'Zstandard (smaller)'], ['gzip', 'Gzip'], ['uncompressed', 'None']], default: 'snappy' }]
const SHEET_OPTION = { key: 'sheet', label: 'Excel sheet (0 = every sheet)', type: 'number', min: 0, default: 1 }
const TEXT_OUT = ['csv', 'tsv', 'json', 'jsonl', 'xlsx']

export const CONVERTERS = [
  { from: ['parquet'], to: [...TEXT_OUT, 'arrow', 'feather'], group: 'Data files', run: (f, to, o, c) => run(f, to, o, c) },
  { from: ['arrow', 'feather', 'arrows', 'ipc'], to: [...TEXT_OUT, 'parquet'], group: 'Data files', options: PARQUET_OPTIONS, run: (f, to, o, c) => run(f, to, o, c) },
  { from: ['avro'], to: [...TEXT_OUT, 'parquet', 'arrow'], group: 'Data files', options: PARQUET_OPTIONS, run: (f, to, o, c) => run(f, to, o, c) },
  { from: ['csv', 'tsv', 'json', 'jsonl', 'ndjson', 'xlsx'], to: ['parquet', 'arrow', 'feather'], group: 'Data files', options: [...PARQUET_OPTIONS, SHEET_OPTION], run: (f, to, o, c) => run(f, to, o, c) },
  {
    from: ['sqlite', 'db', 'sqlite3'], to: ['csv'], group: 'Data files', note: 'One CSV per table, in a ZIP when there are several.',
    run: async (file, to, o, ctx) => {
      const { sqliteToCsv } = await import('./_sqlite.js')
      const tables = await sqliteToCsv(file, { views: !!o?.views, bom: !!o?.bom, onProgress: ctx?.onProgress, signal: ctx?.signal })
      return packCsv(file, tables)
    },
  },
  {
    from: ['csv', 'tsv'], to: ['sqlite'], group: 'Data files', note: 'Column types are detected from the data.',
    run: async (file, to, o, ctx) => {
      const { filesToSqlite } = await import('./_sqlite.js')
      const { bytes } = await filesToSqlite([file], { onProgress: ctx?.onProgress })
      return new File([bytes], `${baseName(file.name) || 'data'}.sqlite`, { type: 'application/vnd.sqlite3' })
    },
  },
]

export const SNIFF = [
  { ext: 'parquet', test: (b) => b[0] === 0x50 && b[1] === 0x41 && b[2] === 0x52 && b[3] === 0x31 },
  { ext: 'avro', test: (b) => b[0] === 0x4f && b[1] === 0x62 && b[2] === 0x6a && b[3] === 0x01 },
  { ext: 'arrow', test: (b) => b[0] === 0x41 && b[1] === 0x52 && b[2] === 0x52 && b[3] === 0x4f && b[4] === 0x57 && b[5] === 0x31 },
]

/** One CSV file, or a ZIP of them, from the tables sqliteToCsv returned. */
export async function packCsv(file, tables) {
  if (tables.length === 1) return new File([tables[0].blob], `${baseName(file.name)}-${safeName(tables[0].name)}.csv`, { type: 'text/csv' })
  const blob = await zip(tables.map((t) => ({ name: `${safeName(t.name)}.csv`, data: t.blob })))
  return new File([blob], `${baseName(file.name)}-csv.zip`, { type: 'application/zip' })
}

/** What the hub calls: one File, or an array when an Excel workbook is split into one file per sheet. */
async function run(file, to, opts = {}, ctx = {}) {
  const r = await convertFile(file, to, opts, ctx)
  return r.files.length === 1 ? r.files[0] : r.files
}

/**
 * Convert one data file. Returns { files: File[], tables: [{ name, rows, cols }], notes: string[] }.
 * to: csv, tsv, json, jsonl, parquet, arrow, feather, xlsx. opts: { compression, sheet (1-based, 0 = all), header }
 */
export async function convertFile(file, to, opts = {}, ctx = {}) {
  const fmt = EXPORT_FORMATS[to]
  if (!fmt) throw new DataError(`Cannot write ${to} files.`)
  const kind = await detectKind(file)
  if (!kind) throw new DataError(`${file.name}: this file type is not supported. Use CSV, TSV, JSON, JSON Lines, Parquet, Arrow, Avro or Excel.`)
  ctx.onProgress?.(0.05)
  const sheet = Number(opts.sheet ?? 1)
  return withConn(async (eng, conn) => {
    const loaded = await loadFile(eng, conn, file, { name: 'src', kind, sheet: sheet === 0 ? 'all' : Math.max(0, sheet - 1) })
    ctx.onProgress?.(0.4)
    const files = []
    const tables = []
    const notes = loaded.map((t) => t.note).filter((n) => n && kind !== 'xlsx')
    try {
      for (let i = 0; i < loaded.length; i++) {
        const t = loaded[i]
        if (ctx.signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
        const counts = await countOf(conn, t.name)
        const bytes = await exportData(eng, conn, t.name, to, { compression: opts.compression, header: opts.header, sheetName: t.note || 'Sheet1' })
        const suffix = loaded.length > 1 ? `-${safeName(t.note || t.name)}` : ''
        files.push(new File([bytes], `${baseName(file.name) || 'data'}${suffix}.${fmt.ext}`, { type: fmt.mime }))
        tables.push({ name: t.note || t.name, ...counts })
        ctx.onProgress?.(0.4 + (0.6 * (i + 1)) / loaded.length)
      }
    } finally {
      for (const t of loaded) {
        await conn.query(`DROP VIEW IF EXISTS "${t.name}"`).catch(() => {})
        await conn.query(`DROP TABLE IF EXISTS "${t.name}"`).catch(() => {})
        if (t.file) await eng.db.dropFile(t.file).catch(() => {})
      }
    }
    return { files, tables, notes }
  })
}
