// Converter for Parquet, Arrow (Feather), Avro, CSV, TSV, JSON, JSON Lines and Excel files. Several files at once, nothing uploaded.
// The focused entries (parquet-to-csv, csv-to-parquet, ...) are this module with params { from: [kinds], to }.
import { h, icon, clear, button, busy, alert, dropzone, fileList, field, select, toggle, number, panel, progress, downloadButton, download, formatBytes, formatNumber, isAbort, onCleanup } from '../../lib/ui.js'
import { zip, baseName, ext as extOf } from '../../lib/files.js'
import { onEngineProgress, releaseEngine, hold, KINDS, EXPORT_FORMATS, detectKind } from './_engine.js'
import { convertFile } from './_convert.js'

const NESTED_SRC = new Set(['parquet', 'arrow', 'avro', 'json', 'jsonl'])
const TARGETS = ['csv', 'tsv', 'json', 'jsonl', 'parquet', 'arrow', 'feather', 'xlsx']

export function mount(root, { params = {}, signal } = {}) {
  const fromKinds = params.from ? [params.from].flat() : Object.keys(KINDS)
  const accept = fromKinds.flatMap((k) => KINDS[k].exts).map((e) => `.${e}`).join(',')
  const st = { to: params.to || 'parquet', kinds: new Map() }
  const prog = progress('Converting')
  const resHost = h('div', { class: 'stack' })
  const errHost = h('div')
  const optHost = h('div')

  const list = fileList({ sortable: false, onChange: () => onFiles() })
  const drop = dropzone({
    accept, multiple: true,
    label: fromKinds.length === 1 ? `Drop ${KINDS[fromKinds[0]].label} files here, or click to choose` : undefined,
    hint: `${fromKinds.map((k) => KINDS[k].label).join(', ')} files. Converted on this device, nothing is uploaded. The conversion engine (about 36 MB) downloads once.`,
    onFiles: (files) => { list.add(files) },
  })

  const toSel = select(TARGETS.map((k) => [k, EXPORT_FORMATS[k].label]), st.to, (v) => { st.to = v; drawOptions() })
  toSel.setAttribute('aria-label', 'Convert to')
  const comp = select([['snappy', 'Snappy (fast, the usual default)'], ['zstd', 'Zstandard (smaller files)'], ['gzip', 'Gzip'], ['uncompressed', 'None']], 'snappy')
  const sheet = number(1, { min: 0, step: 1, ariaLabel: 'Excel sheet number' })
  const header = toggle('Include a header row', true)
  const go = button('Convert', { icon: 'refresh-cw', variant: 'primary', size: 'lg', disabled: true })

  function drawOptions() {
    const kinds = [...st.kinds.values()]
    const bits = []
    if (st.to === 'parquet') bits.push(field('Parquet compression', comp))
    if (kinds.includes('xlsx')) bits.push(field('Excel sheet', sheet, '1 is the first sheet. 0 converts every sheet to its own file.'))
    if (st.to === 'csv' || st.to === 'tsv') bits.push(header)
    const notes = []
    if ((st.to === 'csv' || st.to === 'tsv' || st.to === 'xlsx') && kinds.some((k) => NESTED_SRC.has(k))) notes.push('Nested columns (structs, lists, maps) are written as text here. JSON and Parquet keep them as they are.')
    if (st.to === 'xlsx') notes.push('Excel sheets hold up to 1,048,575 rows. Very large files take a while to write.')
    if (st.to === 'arrow' || st.to === 'feather') notes.push('Written as an Arrow IPC file (Feather v2, uncompressed), which pandas, pyarrow and Polars read directly.')
    clear(optHost, bits.length || notes.length ? panel(h('div', { class: 'row', style: 'align-items:flex-end;gap:16px' }, bits), notes.map((n) => h('p', { class: 'small muted', style: 'margin:8px 0 0' }, n))) : null)
  }

  async function onFiles() {
    st.kinds = new Map()
    for (const f of list.files) st.kinds.set(f, (await detectKind(f)) || 'unknown')
    go.disabled = !list.files.length
    drawOptions()
  }

  go.addEventListener('click', () => busy(go, async () => {
    const files = [...list.files]
    if (!files.length) return
    clear(errHost); clear(resHost)
    list.setDisabled(true)
    const release = hold()
    const done = []
    const fails = []
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        prog.set(i / files.length, `Converting ${f.name} (${i + 1} of ${files.length})`)
        try {
          const r = await convertFile(f, st.to, { compression: comp.value, sheet: number_(sheet), header: header.input.checked }, { signal, onProgress: (p) => prog.set((i + p) / files.length, `Converting ${f.name} (${i + 1} of ${files.length})`) })
          done.push({ file: f, ...r })
        } catch (e) {
          if (isAbort(e)) throw e
          console.error(e)
          fails.push(e.userMessage || e.message)
        }
      }
    } finally { list.setDisabled(false); release() }
    const outs = done.flatMap((d) => d.files.map((o, k) => ({ out: o, src: d.file, table: d.tables[k] })))
    // two inputs can share a base name (data.csv and data.tsv): keep the download names apart
    const taken = new Set()
    for (const o of outs) {
      const withSuffix = (suffix) => o.out.name.replace(/(\.[^.]+)$/, `-${suffix}$1`)
      let n = o.out.name
      if (taken.has(n)) n = withSuffix(extOf(o.src.name) || 'file')
      for (let i = 2; taken.has(n); i++) n = withSuffix(`${extOf(o.src.name) || 'file'}-${i}`)
      if (n !== o.out.name) o.out = new File([o.out], n, { type: o.out.type })
      taken.add(n)
    }
    clear(errHost, fails.map((m) => alert('error', m)))
    if (!outs.length) return
    clear(resHost,
      alert('success', `Converted ${done.length} file${done.length === 1 ? '' : 's'} to ${EXPORT_FORMATS[st.to].label}.`, ...done.flatMap((d) => d.notes).map((n) => h('div', n))),
      outs.map(({ out, src, table }) => h('div', { class: 'panel row', style: 'justify-content:space-between;gap:12px;flex-wrap:wrap' },
        h('div', { style: 'min-width:0;flex:1' }, h('div', { style: 'font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, out.name),
          h('div', { class: 'small muted' }, `${formatBytes(src.size)} in, ${formatBytes(out.size)} out${table ? ` · ${formatNumber(table.rows, 0)} rows, ${table.cols} columns` : ''}`)),
        downloadButton(out, out.name, 'Download', { size: 'sm' }))),
      outs.length > 1 ? button('Download all (ZIP)', { icon: 'file-archive', variant: 'secondary', onClick: async () => download(await zip(outs.map((o) => ({ name: o.out.name, data: o.out }))), `${baseName(outs[0].out.name)}-converted.zip`) }) : null)
  }, { label: 'Converting', progress: prog, errorTo: errHost }))

  const off = onEngineProgress((f, t) => { if (go.getAttribute('aria-busy') === 'true') prog.set(f, t) })
  onCleanup(() => { off(); releaseEngine() })
  root.append(h('div', { class: 'stack' }, drop, list.el, h('div', { class: 'row', style: 'align-items:flex-end;gap:12px' }, field('Convert to', toSel)), optHost, h('div', null, go), prog.el, errHost, resHost))
  drawOptions()
}
const number_ = (el) => { const n = el.valueAsNumber; return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 1 }
