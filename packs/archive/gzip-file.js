// Gzip / gunzip: compress any file to .gz with the browser's own gzip, or unpack a single compressed file (.gz, .bz2, .xz, .Z, .zst).
// Several files at once, each saved on its own. Nothing is uploaded.
import { h, clear, dropzone, fileList, button, busy, alert, segmented, field, progress, download, downloadButton, formatBytes, errorMessage, isAbort } from '../../lib/ui.js'
import { zip as zipFiles } from '../../lib/files.js'
import { card } from '../files/_ui.js'
import { gzipFile, gunzipFile } from './_ops.js'
import { useAx } from './_ui.js'

const PACKED = /\.(gz|bz2|xz|z|zst)$/i

export function mount(root, { params = {}, signal }) {
  useAx()
  const files = fileList({ sortable: false, onChange: () => sync() })
  const filesHost = h('div', { hidden: true }, files.el)
  const out = h('div', { class: 'stack' })
  const prog = progress('Working')
  const mode = segmented([['auto', 'Auto'], ['gz', 'Compress to .gz'], ['un', 'Unpack']], params.mode || 'auto', () => sync(), 'What to do')
  const go = button('Go', { icon: 'file-archive', variant: 'primary', size: 'lg', disabled: true, onClick: () => run() })
  const hint = h('div', { class: 'small muted' })
  const zone = dropzone({
    multiple: true,
    label: 'Drop files here or click to choose',
    hint: 'Any file to compress, or .gz, .bz2, .xz, .Z and .zst files to unpack. Nothing is uploaded.',
    onFiles: (f) => { files.add(f); zone.classList.add('compact'); clear(out); sync() },
  })
  const actionFor = (f) => (mode.value === 'gz' ? 'gz' : mode.value === 'un' ? 'un' : PACKED.test(f.name) ? 'un' : 'gz')
  function sync() {
    filesHost.hidden = !files.files.length
    go.disabled = !files.files.length
    const n = files.files.filter((f) => actionFor(f) === 'gz').length
    const m = files.files.length - n
    hint.textContent = !files.files.length ? '' : `${n ? `${n} to compress` : ''}${n && m ? ', ' : ''}${m ? `${m} to unpack` : ''}.`
    go.querySelector('span').textContent = n && !m ? 'Compress' : m && !n ? 'Unpack' : 'Go'
  }

  async function run() {
    const list = [...files.files]
    files.setDisabled(true)
    await busy(go, async () => {
      clear(out)
      const results = h('div', { class: 'stack' })
      out.append(results)
      const done = []
      let n = 0
      for (const f of list) {
        const row = h('div', { class: 'ax-res' }, h('div', { class: 'nm' }, f.name, h('div', { class: 'small muted' }, 'Working...')), h('span', { class: 'sz' }, formatBytes(f.size)))
        results.append(row)
        try {
          const onProgress = (p) => prog.set((n + p) / list.length, f.name)
          const r = actionFor(f) === 'gz' ? await gzipFile(f, { signal, onProgress }) : await gunzipFile(f, { signal, onProgress })
          done.push({ name: r.name, data: r.blob })
          row.replaceChildren(h('div', { class: 'nm' }, r.name, h('div', { class: 'small muted' }, `${formatBytes(f.size)} to ${formatBytes(r.blob.size)}`)), h('span', { class: 'sz' }, formatBytes(r.blob.size)), button('Download', { icon: 'download', variant: 'primary', size: 'sm', onClick: () => download(r.blob, r.name) }))
        } catch (e) {
          if (isAbort(e)) throw e
          row.replaceChildren(alert('error', h('strong', `${f.name}: `), errorMessage(e)))
        }
        n++
      }
      prog.set(1, 'Done')
      if (done.length > 1) results.append(downloadButton(async () => zipFiles(done), 'files.zip', 'Download all (ZIP)', { variant: 'secondary' }))
    }, { label: 'Working', errorTo: out, progress: prog })
    files.setDisabled(false)
  }

  root.append(h('div', { class: 'stack fx' }, zone, filesHost, card('Gzip', 'file-archive', '#d99a1e', h('div', { class: 'stack' }, field('What to do', mode, 'Auto compresses normal files and unpacks .gz, .bz2, .xz, .Z and .zst files.'), hint, h('div', { class: 'row' }, go))), prog.el, out))
  sync()
}
