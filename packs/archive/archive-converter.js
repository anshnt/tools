// Archive converter: turn any readable archive (RAR, 7z, ZIP, TAR, TAR.GZ, ISO, CAB ...) into ZIP, TAR, TAR.GZ, TAR.XZ, TAR.BZ2 or 7z.
// Also unlocks a password-protected archive into a normal one, or protects a ZIP or 7z with a new password. Local only.
import { h, clear, dropzone, fileList, button, busy, alert, field, input, select, toggle, segmented, progress, download, downloadButton, formatBytes, toast, errorMessage, isAbort } from '../../lib/ui.js'
import { zip as zipFiles } from '../../lib/files.js'
import { card, tile } from '../files/_ui.js'
import { repack, outName } from './_ops.js'
import { FORMATS } from './_write.js'
import { ACCEPT } from './_engine.js'
import { useAx } from './_ui.js'

const LEVELS = [['1', 'Fast'], ['5', 'Normal'], ['9', 'Maximum (slowest, smallest)']]
const ORDER = ['zip', '7z', 'tar.gz', 'tar', 'tar.xz', 'tar.bz2']

export function mount(root, { params = {}, signal }) {
  useAx()
  const files = fileList({ onChange: () => syncBtn() })
  const filesHost = h('div', { hidden: true }, files.el)
  const out = h('div', { class: 'stack' })
  const prog = progress('Converting')
  const to = segmented(ORDER.map((k) => [k, FORMATS[k].label]), FORMATS[params.to] ? params.to : 'zip', () => syncOpts(), 'Convert to')
  const level = select(LEVELS, '5')
  const pwIn = input({ type: 'password', autocomplete: 'off', 'aria-label': 'Password of the archive', placeholder: 'Only if the archive is protected' })
  const pwOut = input({ type: 'password', autocomplete: 'new-password', 'aria-label': 'New password', placeholder: 'Leave empty for no password' })
  const zc = select([['aes', 'AES-256 (strong)'], ['zc', 'Standard ZIP password (opens everywhere)']], 'aes')
  const hdr = toggle('Also hide the file names (7z only)', true)
  const go = button('Convert', { icon: 'refresh-cw', variant: 'primary', size: 'lg', disabled: true, onClick: () => convert() })
  const outPwField = field(params.unlock ? '' : 'New password (optional)', pwOut)
  const zcField = field('New password type', zc)
  const levelField = field('Compression', level)
  const note = h('div', { class: 'small muted' })
  const zone = dropzone({
    multiple: true, accept: '',
    label: params.from ? `Drop ${params.from.toUpperCase()} files here or click to choose` : 'Drop archives here or click to choose',
    hint: `${ACCEPT.split(',').slice(0, 14).map((e) => e.slice(1).toUpperCase()).join(', ')} and more. Several at once is fine.`,
    onFiles: (f) => { files.add(f); filesHost.hidden = false; zone.classList.add('compact'); clear(out); syncBtn() },
  })
  function syncBtn() { go.disabled = !files.files.length; filesHost.hidden = !files.files.length }
  function syncOpts() {
    const k = to.value
    outPwField.hidden = !(k === 'zip' || k === '7z') || !!params.unlock
    zcField.hidden = k !== 'zip' || !!params.unlock
    hdr.hidden = k !== '7z' || !!params.unlock
    levelField.hidden = k === 'tar' || k === 'tar.gz'
    note.textContent = k === 'tar.gz' ? 'TAR.GZ uses the gzip built into your browser, so there is no compression level.' : k === '7z' || k === 'tar.xz' || k === 'tar.bz2' ? 'Made on your device.' : ''
  }

  async function convert() {
    const list = [...files.files]
    const k = to.value
    const outPass = params.unlock ? '' : pwOut.value
    files.setDisabled(true)
    await busy(go, async () => {
      clear(out)
      const results = h('div', { class: 'stack' })
      out.append(results)
      const done = []
      let n = 0
      for (const f of list) {
        const row = h('div', { class: 'ax-res' }, h('div', { class: 'nm' }, f.name, h('div', { class: 'small muted' }, 'Converting...')), h('span', { class: 'sz' }, formatBytes(f.size)))
        results.append(row)
        try {
          const blob = await repack(f, k, {
            password: pwIn.value, outPassword: outPass, level: Number(level.value), zipCrypto: zc.value === 'zc', encryptNames: hdr.input.checked, signal,
            onProgress: (p, t) => prog.set((n + p) / list.length, `${f.name}${t ? `: ${t}` : ''}`),
          })
          const name = outName(f, k)
          done.push({ name, data: blob })
          row.replaceChildren(h('div', { class: 'nm' }, name, h('div', { class: 'small muted' }, `${formatBytes(f.size)} to ${formatBytes(blob.size)}`)), h('span', { class: 'sz' }, formatBytes(blob.size)), button('Download', { icon: 'download', variant: 'primary', size: 'sm', onClick: () => download(blob, name) }))
        } catch (e) {
          if (isAbort(e)) throw e
          row.replaceChildren(alert('error', h('strong', `${f.name}: `), errorMessage(e)))
        }
        n++
      }
      prog.set(1, 'Done')
      if (done.length > 1) results.append(downloadButton(async () => zipFiles(done), 'converted-archives.zip', 'Download all (ZIP)', { variant: 'secondary' }))
      else if (!done.length) toast('Nothing could be converted.', 'error')
      else if (done.length) results.prepend(alert('success', h('strong', 'Done. '), `${done.length} archive${done.length === 1 ? '' : 's'} converted on this device.`))
    }, { label: 'Converting', errorTo: out, progress: prog })
    files.setDisabled(false)
  }

  root.append(h('div', { class: 'stack fx' }, zone, filesHost,
    card('Convert', 'refresh-cw', '#d99a1e', h('div', { class: 'stack' },
      params.unlock ? null : field('Convert to', to),
      h('div', { class: 'grid-2' }, field(params.unlock ? 'Password of the protected archive' : 'Archive password', pwIn, params.unlock ? 'The new archive will have no password.' : undefined), levelField),
      h('div', { class: 'grid-2' }, outPwField, zcField),
      hdr, note, h('div', { class: 'row' }, go))),
    prog.el, out))
  syncOpts()
  syncBtn()
}
