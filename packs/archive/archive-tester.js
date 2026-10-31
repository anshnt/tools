// Archive tester: unpack every file of an archive in memory and check it, so you know the archive is intact before you rely on it or delete
// the original. ZIP, 7z, RAR and CAB carry checksums (CRC) that are verified; TAR and plain gzip are checked for structure only.
import { h, clear, dropzone, fileList, button, busy, alert, field, input, progress, formatBytes, errorMessage, isAbort, stats } from '../../lib/ui.js'
import { card, chip, chips } from '../files/_ui.js'
import { openArchive } from './_engine.js'
import { useAx, formatLabel, passwordPrompt } from './_ui.js'

const HAS_CRC = new Set(['zip', '7z', 'rar', 'rar5', 'cab', 'gz', 'gzip', 'bz2', 'bzip2', 'xz', 'wim', 'iso', 'lzh', 'arj', 'rpm'])

export function mount(root, { signal }) {
  useAx()
  const files = fileList({ sortable: false, onChange: () => sync() })
  const filesHost = h('div', { hidden: true }, files.el)
  const out = h('div', { class: 'stack' })
  const prog = progress('Testing')
  const pw = input({ type: 'password', autocomplete: 'off', 'aria-label': 'Password', placeholder: 'Only if the archive is protected' })
  const go = button('Test archives', { icon: 'shield-check', variant: 'primary', size: 'lg', disabled: true, onClick: () => run() })
  const zone = dropzone({
    multiple: true,
    label: 'Drop archives here or click to choose',
    hint: 'ZIP, 7Z, RAR, TAR, TAR.GZ, ISO, CAB, CPIO, DEB, WIM and more. Checked on this device.',
    onFiles: (f) => { files.add(f); zone.classList.add('compact'); clear(out); sync() },
  })
  const sync = () => { filesHost.hidden = !files.files.length; go.disabled = !files.files.length }

  async function testOne(f, row, n, total) {
    let arc
    try {
      arc = await openArchive(f, { password: pw.value, signal })
      if (arc.encrypted && arc.needsPassword) { row.replaceChildren(alert('warn', h('strong', `${f.name}: `), 'password protected. Type the password above and test again.')); return }
      if (arc.encrypted) await arc.setPassword(pw.value, signal)
      const r = await arc.test({ signal, onProgress: (p, t) => prog.set((n + p) / total, `${f.name}: ${t}`) })
      const label = formatLabel(arc)
      const crc = HAS_CRC.has(String(arc.format).toLowerCase()) || /\.(t?gz|tbz2?|txz)$/i.test(f.name)
      const bad = r.problems
      row.replaceChildren(h('div', { class: 'stack' },
        h('div', { class: 'row' }, h('strong', f.name), chips(chip(label, ''), chip(formatBytes(f.size), ''), bad.length ? chip(`${bad.length} problem${bad.length === 1 ? '' : 's'}`, 'bad', 'circle-alert') : chip('Intact', 'ok', 'circle-check'))),
        bad.length
          ? alert('error', h('strong', 'This archive has problems. '), 'It may be damaged or incomplete.', h('ul', { style: 'margin:8px 0 0;padding-left:18px' }, bad.slice(0, 30).map((b) => h('li', `${b.path ? b.path + ': ' : ''}${b.error}`))))
          : alert('success', h('strong', 'All good. '), `${r.checked.toLocaleString()} file${r.checked === 1 ? '' : 's'} unpacked without errors${crc ? ' and the checksums matched' : ''}.${crc ? '' : ' This format has no checksums, so only its structure was checked.'}`)))
    } catch (e) {
      if (isAbort(e)) throw e
      if (e.code === 'NEEDPW') row.replaceChildren(alert('warn', h('strong', `${f.name}: `), 'password protected. Type the password above and test again.'))
      else row.replaceChildren(alert('error', h('strong', `${f.name}: `), e.code === 'BADPW' ? 'That password did not work.' : errorMessage(e)))
    } finally { arc?.close() }
  }

  async function run() {
    const list = [...files.files]
    files.setDisabled(true)
    await busy(go, async () => {
      clear(out)
      const box = h('div', { class: 'stack' })
      out.append(box)
      let n = 0
      for (const f of list) {
        const row = h('div', { class: 'ax-res', style: 'display:block' }, h('div', { class: 'small muted' }, `Testing ${f.name}...`))
        box.append(row)
        await testOne(f, row, n++, list.length)
      }
      prog.set(1, 'Done')
    }, { label: 'Testing', errorTo: out, progress: prog })
    files.setDisabled(false)
  }

  root.append(h('div', { class: 'stack fx' }, zone, filesHost, card('Test', 'shield-check', '#d99a1e', h('div', { class: 'stack' }, field('Password (optional)', pw), h('div', { class: 'row' }, go))), prog.el, out))
  sync()
}
