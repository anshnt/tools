// SQLite to CSV (every table of a .sqlite or .db file, as a ZIP) and CSV (or other data files) to a SQLite database.
// params.mode: 'to-csv' | 'to-sqlite'. sql.js reads and writes the database, DuckDB detects the column types. All on this device.
import { h, clear, button, busy, alert, dropzone, fileList, field, toggle, input, panel, table, progress, downloadButton, download, formatBytes, formatNumber, isAbort, onCleanup } from '../../lib/ui.js'
import { zip, baseName, safeName } from '../../lib/files.js'
import { ACCEPT, hold, releaseEngine } from './_engine.js'
import { sqliteToCsv, filesToSqlite } from './_sqlite.js'

export function mount(root, { params = {}, signal } = {}) {
  const toCsv = (params.mode || 'to-csv') === 'to-csv'
  const prog = progress('Converting')
  const errHost = h('div')
  const resHost = h('div', { class: 'stack' })
  const go = button(toCsv ? 'Export tables to CSV' : 'Build the database', { icon: toCsv ? 'file-spreadsheet' : 'database', variant: 'primary', size: 'lg', disabled: true })
  const list = fileList({ sortable: !toCsv, onChange: (fs) => { go.disabled = !fs.length } })
  const drop = dropzone({
    accept: toCsv ? '.sqlite,.sqlite3,.db,.db3,.s3db' : ACCEPT, multiple: !toCsv,
    label: toCsv ? 'Drop a SQLite database here, or click to choose' : 'Drop CSV files here, or click to choose',
    hint: toCsv ? '.sqlite, .db or .sqlite3. Opened on this device, nothing is uploaded.' : 'CSV, TSV, JSON, Parquet, Arrow, Avro or Excel. One table per file (or per Excel sheet).',
    onFiles: (files) => { if (toCsv) list.set(files); else list.add(files) },
  })
  const views = toggle('Include views', false)
  const bom = toggle('Add a UTF-8 marker so Excel shows accents correctly', false)
  const header = toggle('Include a header row', true)
  const dbName = input({ value: 'database', 'aria-label': 'Database file name', placeholder: 'database' })
  const opts = panel(h('div', { class: 'row', style: 'gap:16px;align-items:flex-end' }, ...(toCsv ? [header, views, bom] : [field('Database name', dbName, 'Saved as name.sqlite')])),
    h('p', { class: 'small muted', style: 'margin:8px 0 0' }, toCsv
      ? 'Text and numbers are written as they are stored. BLOB columns are written as hex. NULL becomes an empty cell.'
      : 'Column types (integer, decimal, text, date) are detected from the data. Dates are stored as text, which is how SQLite keeps them. Nested values become text.'))

  go.addEventListener('click', () => busy(go, async () => {
    const files = [...list.files]
    if (!files.length) return
    clear(errHost); clear(resHost)
    list.setDisabled(true)
    const release = toCsv ? () => {} : hold()
    try {
      if (toCsv) {
        const file = files[0]
        prog.set(null, `Reading ${file.name}`)
        const tables = await sqliteToCsv(file, { views: views.input.checked, bom: bom.input.checked, header: header.input.checked, signal, onProgress: (p) => prog.set(p, 'Writing CSV files') })
        const outs = tables.map((t) => ({ name: `${safeName(t.name)}.csv`, blob: t.blob, rows: t.rows, cols: t.columns }))
        clear(resHost,
          alert('success', `Exported ${tables.length} table${tables.length === 1 ? '' : 's'} from ${file.name}.`),
          table({ columns: ['Table', { label: 'Rows', num: true }, { label: 'Columns', num: true }, { label: 'Size', num: true }, ''], rows: outs.map((o) => [o.name.replace(/\.csv$/, ''), formatNumber(o.rows, 0), o.cols, formatBytes(o.blob.size), downloadButton(o.blob, o.name, 'CSV', { size: 'sm', variant: 'secondary' })]) }),
          outs.length > 1 ? downloadButton(() => zip(outs.map((o) => ({ name: o.name, data: o.blob }))), `${baseName(file.name)}-csv.zip`, 'Download all (ZIP)') : null)
      } else {
        const { bytes, tables } = await filesToSqlite(files, { onProgress: (p) => prog.set(p, 'Building the database') })
        const name = `${safeName(dbName.value.trim() || (files.length === 1 ? baseName(files[0].name) : 'database'))}.sqlite`
        const blob = new Blob([bytes], { type: 'application/vnd.sqlite3' })
        clear(resHost,
          alert('success', `Built ${name} with ${tables.length} table${tables.length === 1 ? '' : 's'} (${formatBytes(blob.size)}).`),
          table({ columns: ['Table', { label: 'Rows', num: true }, { label: 'Columns', num: true }], rows: tables.map((t) => [t.name, formatNumber(t.rows, 0), t.columns]) }),
          downloadButton(blob, name, `Download ${name}`))
      }
    } catch (e) {
      if (isAbort(e)) return
      throw e
    } finally { list.setDisabled(false); release() }
  }, { label: 'Converting', progress: prog, errorTo: errHost }))

  onCleanup(() => releaseEngine())
  root.append(h('div', { class: 'stack' }, drop, list.el, opts, h('div', null, go), prog.el, errHost, resHost))
}
