// Create ZIP: add files and whole folders (structure kept), choose the compression, and download one archive. JSZip streams the
// files from disk, so large selections do not need to be held in memory twice. Nothing is uploaded.
import { h, clear, button, busy, alert, stats, field, input, select, toggle, progress, table, download, formatBytes, toast } from '../../lib/ui.js'
import { jszip } from '../../lib/libs.js'
import { extOf, stemOf, naturalCompare } from './_core.js'
import { useFx, sourceZone, card, tile, celebrate, countUp } from './_ui.js'

const JUNK = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX|\.Spotlight-V100|\.Trashes)(\/|$)/i
const PRECOMPRESSED = new Set('jpg jpeg png gif webp avif heic heif mp3 m4a aac ogg opus flac mp4 m4v mov mkv webm avi zip gz tgz bz2 xz 7z rar zst jar docx xlsx pptx odt ods odp epub woff woff2 pdf'.split(' '))
const LEVELS = [['0', 'Store only (fastest, no compression)'], ['1', 'Fast'], ['6', 'Normal (recommended)'], ['9', 'Maximum (slowest, smallest)']]
const LIMIT = 3.5 * 1024 ** 3

/** Plan the archive: entries [{path, file}] -> [{zipPath, file, store}] after junk filtering, flattening and name de-duplication. */
export function planZip(items, { skipJunk = true, flatten = false, storeCompressed = true } = {}) {
  const used = new Set()
  const out = []
  for (const it of items) {
    if (skipJunk && JUNK.test(it.path)) continue
    let p = flatten ? it.path.split('/').pop() : it.path
    if (flatten) {
      const base = stemOf(p), e = extOf(p) ? '.' + extOf(p) : ''
      let n = p, i = 2
      while (used.has(n.toLowerCase())) n = `${base} (${i++})${e}`
      p = n
    }
    used.add(p.toLowerCase())
    out.push({ zipPath: p, file: it.file, mtime: it.mtime, store: storeCompressed && PRECOMPRESSED.has(extOf(it.path)) })
  }
  return out
}

export function mount(root) {
  useFx()
  const items = new Map() // path -> {path, file, size, mtime}
  const folders = new Set()
  const list = h('div')
  const result = h('div', { class: 'stack' })
  const prog = progress('Creating ZIP')
  const optsHost = h('div')
  const name = input({ value: 'archive', 'aria-label': 'ZIP file name', placeholder: 'archive' })
  const level = select(LEVELS, '6')
  const junk = toggle('Leave out system files (.DS_Store, Thumbs.db)', true, () => draw())
  const flat = toggle('Put every file in the top level (no folders)', false, () => draw())
  const smart = toggle('Do not recompress files that are already compressed (JPG, MP4, PDF...)', true, () => draw())
  const makeBtn = button('Create ZIP', { icon: 'file-archive', variant: 'primary', size: 'lg', disabled: true, onClick: () => make() })
  const clearBtn = button('Clear all', { icon: 'x', variant: 'ghost', size: 'sm', onClick: () => { items.clear(); folders.clear(); clear(result); draw() } })
  let nameTouched = false
  name.addEventListener('input', () => { nameTouched = true })

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
  function draw() {
    const plan = planZip([...items.values()], { skipJunk: junk.input.checked, flatten: flat.input.checked, storeCompressed: smart.input.checked })
    const total = plan.reduce((s, p) => s + p.file.size, 0)
    makeBtn.disabled = !plan.length
    optsHost.hidden = !items.size
    zone.classList.toggle('compact', items.size > 0)
    const dropped = items.size - plan.length
    const sorted = [...items.values()].sort((a, b) => naturalCompare(a.path, b.path))
    clear(list, items.size ? h('div', { class: 'stack' },
      stats([{ label: 'Files', value: plan.length.toLocaleString(), hint: dropped ? `${dropped} system file${dropped === 1 ? '' : 's'} left out` : '' }, { label: 'Total size', value: formatBytes(total), accent: true }, { label: 'Folders', value: folders.size.toLocaleString() }]),
      total > LIMIT ? alert('error', `That is ${formatBytes(total)}. A browser cannot build a ZIP bigger than about 3.5 GB. Split it into several ZIPs.`) : total > 1.5 * 1024 ** 3 ? alert('warn', 'This is a big archive. It will work, but may take a while and use a lot of memory. Close other tabs first.') : null,
      table({
        columns: ['File', { label: 'Size', num: true }, ''],
        rows: sorted.slice(0, 300).map((it) => [h('span', { style: 'display:inline-flex;gap:8px;align-items:center;overflow-wrap:anywhere' }, tile(it.path, { size: 'sm' }), it.path), formatBytes(it.size),
          button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: `Remove ${it.path}`, onClick: () => { items.delete(it.path); draw() } })]), max: 300,
      }), clearBtn) : null)
  }

  async function make() {
    const plan = planZip([...items.values()], { skipJunk: junk.input.checked, flatten: flat.input.checked, storeCompressed: smart.input.checked })
    const total = plan.reduce((s, p) => s + p.file.size, 0)
    if (!plan.length) return
    if (total > LIMIT) return toast('Too big for one ZIP in a browser. Split it into several.', 'error')
    const lvl = +level.value
    const fileName = (name.value.trim().replace(/\.zip$/i, '').replace(/[\\/:*?"<>|]+/g, '_') || 'archive') + '.zip'
    await busy(makeBtn, async () => {
      clear(result)
      const JSZip = await jszip()
      const z = new JSZip()
      const t0 = performance.now()
      for (const p of plan) z.file(p.zipPath, p.file, { date: new Date(p.mtime), compression: lvl === 0 || p.store ? 'STORE' : 'DEFLATE', compressionOptions: { level: lvl || 6 } })
      if (!flat.input.checked) for (const f of folders) if (![...plan].some((p) => p.zipPath.startsWith(f + '/'))) z.folder(f) // keep empty folders
      const blob = await z.generateAsync({ type: 'blob', streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: lvl || 6 } }, (m) => prog.set(m.percent / 100, m.currentFile ? `Adding ${m.currentFile.split('/').pop()}` : 'Creating ZIP'))
      const saved = total ? Math.max(0, Math.round((1 - blob.size / total) * 100)) : 0
      const secs = (performance.now() - t0) / 1000
      const sizeEl = h('div', { class: 'value' }, formatBytes(blob.size))
      const st = stats([{ label: 'ZIP size', value: '', accent: true }, { label: 'Original', value: formatBytes(total) }, { label: 'Saved', value: `${saved}%` }, { label: 'Files', value: plan.length.toLocaleString() }])
      st.querySelector('.stat.accent .value').replaceWith(sizeEl)
      countUp(sizeEl, blob.size, formatBytes, 600)
      const dl = button(`Download ${fileName}`, { icon: 'download', variant: 'primary', size: 'lg', onClick: () => download(blob, fileName) })
      clear(result, alert('success', h('strong', 'Your ZIP is ready. '), `Built in ${secs < 10 ? secs.toFixed(1) : Math.round(secs)} s. Nothing left your device.`), st, h('div', { class: 'row' }, dl))
      celebrate(makeBtn, 18)
    }, { label: 'Creating', errorTo: result, progress: prog })
  }

  optsHost.append(card('ZIP options', 'settings-2', '#d99a1e', h('div', { class: 'stack' },
    h('div', { class: 'grid-2' }, field('File name', name, '.zip is added for you'), field('Compression', level)),
    h('div', { class: 'stack tight' }, junk, smart, flat),
    h('div', { class: 'row' }, makeBtn, h('span', { class: 'small muted' }, 'Password-protected ZIPs are not supported here.')))))
  optsHost.hidden = true
  root.append(h('div', { class: 'stack fx' }, zone, list, optsHost, prog.el, result))
}
