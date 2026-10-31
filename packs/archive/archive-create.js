// Create archive: add files and whole folders (structure kept) and pack them as ZIP, TAR, TAR.GZ, TAR.XZ, TAR.BZ2 or 7z. ZIP and 7z can be
// protected with a password. Nothing is uploaded. Writers live in _write.js.
import { h, clear, button, busy, alert, stats, field, input, select, toggle, progress, table, download, formatBytes, toast, segmented } from '../../lib/ui.js'
import { sourceZone, card, tile, celebrate, countUp } from '../files/_ui.js'
import { naturalCompare, stemOf } from '../files/_core.js'
import { createArchive } from './_ops.js'
import { FORMATS } from './_write.js'
import { useAx } from './_ui.js'

const JUNK = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX|\.Spotlight-V100|\.Trashes)(\/|$)/i
const LEVELS = [['0', 'Store only (fastest, no compression)'], ['1', 'Fast'], ['5', 'Normal'], ['9', 'Maximum (slowest, smallest)']]
const LIMITS = { zip: 3.5 * 1024 ** 3, tar: 3.5 * 1024 ** 3, 'tar.gz': 3.5 * 1024 ** 3, '7z': 1.5 * 1024 ** 3, 'tar.xz': 1.5 * 1024 ** 3, 'tar.bz2': 1.5 * 1024 ** 3 }
const ORDER = ['zip', '7z', 'tar.gz', 'tar', 'tar.xz', 'tar.bz2']

export function mount(root, { params = {} }) {
  useAx()
  const items = new Map() // path -> {path, file, size, mtime}
  const folders = new Set()
  const list = h('div')
  const result = h('div', { class: 'stack' })
  const prog = progress('Creating archive')
  const optsHost = h('div')
  const name = input({ value: 'archive', 'aria-label': 'Archive file name', placeholder: 'archive' })
  let nameTouched = false
  name.addEventListener('input', () => { nameTouched = true })
  const fmt = segmented(ORDER.map((k) => [k, FORMATS[k].label]), params.kind && FORMATS[params.kind] ? params.kind : 'zip', () => syncOpts(), 'Archive format')
  const level = select(LEVELS, '5')
  const pw = input({ type: 'password', autocomplete: 'new-password', 'aria-label': 'Password', placeholder: params.password ? 'Type a password' : 'Leave empty for no password' })
  const zipCrypto = select([['aes', 'AES-256 (strong, some older unzip tools cannot open it)'], ['zc', 'Standard ZIP password (weaker, opens everywhere)']], 'aes')
  const hdr = toggle('Also hide the file names (7z only)', true)
  const junk = toggle('Leave out system files (.DS_Store, Thumbs.db)', true, () => draw())
  const smart = toggle('Do not recompress files that are already compressed (JPG, MP4, PDF...)', true)
  const makeBtn = button('Create archive', { icon: 'package', variant: 'primary', size: 'lg', disabled: true, onClick: () => make() })
  const clearBtn = button('Clear all', { icon: 'x', variant: 'ghost', size: 'sm', onClick: () => { items.clear(); folders.clear(); clear(result); draw() } })
  const pwField = field('Password (optional)', pw)
  const zcField = field('Password type', zipCrypto)
  const levelField = field('Compression', level)
  const noteEl = h('div', { class: 'small muted' })

  const zone = sourceZone({
    hint: 'Add files or a whole folder. Folders keep their structure. You can add more later.',
    onScan: (res) => {
      const prefix = ['Selected files', 'Dropped items'].includes(res.name) ? '' : `${res.name}/`
      let added = 0
      for (const e of res.entries) {
        const path = prefix + e.path
        if (!items.has(path)) added++
        items.set(path, { path, file: e.file, size: e.size, mtime: e.mtime })
      }
      for (const f of res.folders) folders.add(prefix + f.path)
      if (prefix) folders.add(prefix.slice(0, -1))
      if (!nameTouched && prefix) name.value = res.name
      else if (!nameTouched && items.size === 1) name.value = stemOf([...items.keys()][0].split('/').pop())
      toast(`Added ${added.toLocaleString()} file${added === 1 ? '' : 's'}`, 'success')
      clear(result)
      draw()
    },
  })

  const plan = () => [...items.values()].filter((i) => !(junk.input.checked && JUNK.test(i.path)))
  function syncOpts() {
    const k = fmt.value
    const canPw = k === 'zip' || k === '7z'
    pwField.hidden = !canPw
    zcField.hidden = k !== 'zip'
    hdr.hidden = k !== '7z'
    smart.hidden = k !== 'zip'
    levelField.hidden = k === 'tar' || k === 'tar.gz'
    noteEl.textContent = k === 'tar.gz' ? 'TAR.GZ uses the gzip built into your browser, so there is no compression level.' : k === 'tar' ? 'A plain TAR bundles files without compressing them.' : k === '7z' ? 'Made on your device. Solid compression, so many small similar files shrink a lot.' : k === 'zip' ? '' : 'Made on your device.'
    draw()
  }
  function draw() {
    const p = plan()
    const total = p.reduce((s, i) => s + i.size, 0)
    const k = fmt.value
    makeBtn.disabled = !p.length || total > LIMITS[k]
    optsHost.hidden = !items.size
    zone.classList.toggle('compact', items.size > 0)
    const dropped = items.size - p.length
    const sorted = [...items.values()].sort((a, b) => naturalCompare(a.path, b.path))
    clear(list, items.size ? h('div', { class: 'stack' },
      stats([{ label: 'Files', value: p.length.toLocaleString(), hint: dropped ? `${dropped} system file${dropped === 1 ? '' : 's'} left out` : '' }, { label: 'Total size', value: formatBytes(total), accent: true }, { label: 'Folders', value: folders.size.toLocaleString() }]),
      total > LIMITS[k] ? alert('error', `That is ${formatBytes(total)}. A browser cannot build a ${FORMATS[k].label} bigger than about ${formatBytes(LIMITS[k])}. Split it into several archives.`) : total > 1024 ** 3 ? alert('warn', 'This is a big archive. It will work, but may take a while and use a lot of memory. Close other tabs first.') : null,
      table({
        columns: ['File', { label: 'Size', num: true }, ''],
        rows: sorted.slice(0, 300).map((it) => [h('span', { style: 'display:inline-flex;gap:8px;align-items:center;overflow-wrap:anywhere' }, tile(it.path, { size: 'sm' }), it.path), formatBytes(it.size),
          button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: `Remove ${it.path}`, onClick: () => { items.delete(it.path); draw() } })]), max: 300,
      }), clearBtn) : null)
  }

  async function make() {
    const k = fmt.value
    const p = plan()
    if (!p.length) return
    const password = ['zip', '7z'].includes(k) ? pw.value : ''
    if (params.password && !password) return toast('Type a password first.', 'error')
    const base = name.value.trim().replace(/\.(zip|7z|tar|tar\.gz|tgz|tar\.xz|tar\.bz2)$/i, '').replace(/[\\/:*?"<>|]+/g, '_') || 'archive'
    const fileName = `${base}.${FORMATS[k].ext}`
    await busy(makeBtn, async () => {
      clear(result)
      const t0 = performance.now()
      const keepDirs = [...folders].filter((f) => !p.some((i) => i.path.startsWith(`${f}/`)))
      const blob = await createArchive(p, k, {
        level: Number(level.value), password, zipCrypto: zipCrypto.value === 'zc', encryptNames: hdr.input.checked, folders: keepDirs, smart: smart.input.checked,
        onProgress: (f, t) => prog.set(f, t ? `Adding ${t}` : 'Creating archive'),
      })
      const total = p.reduce((s, i) => s + i.size, 0)
      const saved = total ? Math.max(0, Math.round((1 - blob.size / total) * 100)) : 0
      const secs = (performance.now() - t0) / 1000
      const sizeEl = h('div', { class: 'value' }, formatBytes(blob.size))
      const st = stats([{ label: `${FORMATS[k].label} size`, value: '', accent: true }, { label: 'Original', value: formatBytes(total) }, { label: 'Saved', value: `${saved}%` }, { label: 'Files', value: p.length.toLocaleString() }])
      st.querySelector('.stat.accent .value').replaceWith(sizeEl)
      countUp(sizeEl, blob.size, formatBytes, 600)
      const dl = button(`Download ${fileName}`, { icon: 'download', variant: 'primary', size: 'lg', onClick: () => download(blob, fileName) })
      clear(result, alert('success', h('strong', 'Your archive is ready. '), `Built in ${secs < 10 ? secs.toFixed(1) : Math.round(secs)} s. Nothing left your device.${password ? ' Remember the password: it cannot be recovered.' : ''}`), st, h('div', { class: 'row' }, dl))
      celebrate(makeBtn, 18)
    }, { label: 'Creating', errorTo: result, progress: prog })
  }

  optsHost.append(card('Archive options', 'settings-2', '#d99a1e', h('div', { class: 'stack' },
    field('Format', fmt),
    h('div', { class: 'grid-2' }, field('File name', name, 'The extension is added for you'), levelField),
    h('div', { class: 'grid-2' }, pwField, zcField),
    h('div', { class: 'stack tight' }, hdr, junk, smart),
    noteEl,
    h('div', { class: 'row' }, makeBtn))))
  optsHost.hidden = true
  syncOpts()
  root.append(h('div', { class: 'stack fx' }, zone, list, optsHost, prog.el, result))
}
