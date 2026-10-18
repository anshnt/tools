// ASAR archive explorer: Electron's app.asar format. Only the JSON header is read up front; file contents are sliced from the
// File on demand, so large archives open instantly. Preview text and images, check integrity hashes, download files or a ZIP.
import { h, dropzone, progress, alert, clear, stats, button, download, formatBytes, formatNumber, yieldToMain, onCleanup, errorMessage, card, split, busy } from '../../lib/ui.js'
import { jszip } from '../../lib/libs.js'
import { baseName } from '../../lib/files.js'
import { useCss, kv, pill, pills, codeBlock, fileTree, hexDump, rowDownload, sectionTitle } from './_pkg-ui.js'

const MAX_HEADER = 256 * 1024 * 1024
const PREVIEW_TEXT = 512 * 1024
const PREVIEW_IMAGE = 25 * 1024 * 1024
const ZIP_LIMIT = 2 * 1024 ** 3
const fail = (msg) => { throw Object.assign(new Error(msg), { userMessage: msg }) }

// ---------- Pure helpers (exported for tests) ----------

/** Read the 16-byte pickle prefix. Returns {headerSize, jsonSize, dataOffset}. */
export function parseAsarPrefix(b) {
  if (b.length < 16) fail('This file is too small to be an ASAR archive.')
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const sizeField = dv.getUint32(0, true), headerSize = dv.getUint32(4, true), payload = dv.getUint32(8, true), jsonSize = dv.getUint32(12, true)
  if (sizeField !== 4 || jsonSize === 0 || jsonSize > headerSize || payload > headerSize || headerSize > MAX_HEADER) fail('This is not an ASAR archive (the header sizes do not match the format).')
  return { headerSize, jsonSize, dataOffset: 8 + headerSize }
}

/** Parse the header JSON text. */
export function parseAsarHeader(text) {
  let header
  try { header = JSON.parse(text) } catch { fail('The ASAR header is not valid JSON, so the archive is damaged.') }
  if (!header || typeof header.files !== 'object') fail('The ASAR header has no file list.')
  return header
}

/** Flatten the header tree into entries [{path, size, offset, unpacked, executable, link, integrity}] and count folders. */
export function flattenAsar(header) {
  const files = []
  let dirs = 0
  const walk = (node, prefix) => {
    for (const [name, e] of Object.entries(node.files || {})) {
      const path = prefix ? `${prefix}/${name}` : name
      if (e.files) { dirs++; walk(e, path) } else if ('link' in e) files.push({ path, size: 0, link: e.link, unpacked: false })
      else files.push({ path, size: Number(e.size) || 0, offset: e.offset != null ? Number(e.offset) : null, unpacked: !!e.unpacked, executable: !!e.executable, integrity: e.integrity || null })
    }
  }
  walk(header, '')
  return { files, dirs }
}

/** Open an archive given a range reader. Returns {header, files, dirs, dataOffset}. */
export async function openAsar(readRange, size) {
  const pre = parseAsarPrefix(await readRange(0, 16))
  if (16 + pre.jsonSize > size) fail('The ASAR archive is truncated (the header is longer than the file).')
  const text = new TextDecoder().decode(await readRange(16, 16 + pre.jsonSize))
  const header = parseAsarHeader(text)
  const { files, dirs } = flattenAsar(header)
  for (const f of files) if (!f.unpacked && f.offset != null && pre.dataOffset + f.offset + f.size > size) f.truncated = true
  return { header, files, dirs, dataOffset: pre.dataOffset }
}

/** Resolve a symlink target relative to the archive root, following chains. */
export function resolveLink(files, path, max = 20) {
  const byPath = new Map(files.map((f) => [f.path, f]))
  let cur = byPath.get(path)
  for (let i = 0; cur && cur.link != null && i < max; i++) cur = byPath.get(normalize(cur.link, cur.path))
  return cur && cur.link == null ? cur : null
}
function normalize(link, from) {
  // asar stores links relative to the archive root
  const parts = []
  for (const p of link.split('/')) { if (p === '..') parts.pop(); else if (p && p !== '.') parts.push(p) }
  return parts.join('/') || from
}

export const looksText = (u8) => {
  const n = Math.min(u8.length, 8000)
  let bad = 0
  for (let i = 0; i < n; i++) { const c = u8[i]; if (c === 0) return false; if (c < 9 || (c > 13 && c < 32)) bad++ }
  return bad / Math.max(1, n) < 0.02
}

const IMG = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp', avif: 'image/avif' }
const extOf = (p) => (p.match(/\.([^./]+)$/)?.[1] || '').toLowerCase()

// ---------- UI ----------

export function mount(root) {
  root.classList.add(useCss())
  const result = h('div', { class: 'stack' })
  const prog = progress()
  let previewUrl = null
  const revoke = () => { if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null } }
  onCleanup(revoke)
  let run = 0

  const zone = dropzone({ accept: '.asar', label: 'Drop an app.asar file here', hint: 'Electron ASAR archive · read on your device, nothing is uploaded', icon: 'archive', onFiles: ([f]) => open(f) })

  async function open(file) {
    const my = ++run
    let arc = null
    revoke()
    clear(result)
    zone.classList.add('compact')
    prog.set(null, `Reading the header of ${file.name}`)
    try {
      await yieldToMain()
      const range = async (s, e) => new Uint8Array(await file.slice(s, e).arrayBuffer())
      arc = await openAsar(range, file.size)
      if (my !== run) return
      let pkg = null
      const pj = arc.files.find((f) => f.path === 'package.json' && !f.unpacked && f.offset != null)
      if (pj && pj.size < 2 * 1024 * 1024) { try { pkg = JSON.parse(await blobOf(pj).text()) } catch { /* optional */ } }
      render(arc, pkg)
    } catch (e) {
      if (!e?.userMessage) console.error(e)
      clear(result, alert('error', errorMessage(e)))
    } finally { if (my === run) prog.hide() }

    function blobOf(f) { return file.slice(arcOffset(f), arcOffset(f) + f.size) }
    function arcOffset(f) { return arc.dataOffset + f.offset }

    function render(arc, pkg) {
      const packed = arc.files.filter((f) => !f.unpacked && f.link == null)
      const unpacked = arc.files.filter((f) => f.unpacked)
      const links = arc.files.filter((f) => f.link != null)
      const total = packed.reduce((s, f) => s + f.size, 0)
      const truncated = arc.files.filter((f) => f.truncated)
      const previewBox = h('div', { class: 'stack' }, h('div', { class: 'empty' }, h('div', 'Pick a file on the left to preview it.')))

      const entries = arc.files.map((f) => ({ ...f, note: f.unpacked ? 'unpacked' : f.link != null ? 'link' : f.truncated ? 'missing' : null, noteKind: f.truncated ? 'bad' : f.unpacked ? 'warn' : 'info', icon: f.link != null ? 'link' : undefined, size: f.link != null ? null : f.size }))
      const tree = fileTree(entries, {
        open: 1, label: 'Archive contents',
        onSelect: (f) => preview(arc.files.find((x) => x.path === f.path)),
        actions: (f) => (f.unpacked || f.link != null || f.truncated ? null : rowDownload(f.name, () => download(blobOf(f), f.path.split('/').pop()))),
      })

      let previewSeq = 0
      async function preview(f) {
        const seq = ++previewSeq
        revoke()
        const meta = kv([['Path', f.path], ['Size', f.link != null ? null : `${formatBytes(f.size)} (${formatNumber(f.size)} bytes)`],
          ['Offset', f.offset != null && !f.unpacked ? `${formatNumber(f.offset)} (file byte ${formatNumber(arc.dataOffset + f.offset)})` : null],
          ['Executable', f.executable ? 'yes' : null], ['Integrity', f.integrity ? `${f.integrity.algorithm} ${f.integrity.hash}` : null],
          ['Blocks', f.integrity?.blocks ? `${f.integrity.blocks.length} x ${formatBytes(f.integrity.blockSize)}` : null]])
        const head = h('div', { class: 'stack' }, h('strong', { style: 'overflow-wrap:anywhere' }, f.path.split('/').pop()), meta)
        if (f.link != null) {
          const target = resolveLink(arc.files, f.path)
          clear(previewBox, head, alert('info', `Symbolic link to "${f.link}".`), target ? button('Open link target', { icon: 'corner-down-right', size: 'sm', onClick: () => preview(target) }) : alert('warn', 'The link target is not in the archive.'))
          return
        }
        if (f.unpacked) {
          clear(previewBox, head, alert('info', `This file is not inside the archive. Electron keeps it next to it in app.asar.unpacked/${f.path}, usually because it is a native module or an executable.`))
          return
        }
        if (f.truncated) { clear(previewBox, head, alert('error', 'The archive ends before this file, so it is truncated or damaged.')); return }
        const acts = h('div', { class: 'row' }, button('Download', { icon: 'download', size: 'sm', variant: 'primary', onClick: () => download(blobOf(f), f.path.split('/').pop()) }))
        const verifyOut = h('div')
        if (f.integrity?.algorithm?.toUpperCase() === 'SHA256') {
          const vb = button('Check integrity', { icon: 'shield-check', size: 'sm' })
          vb.addEventListener('click', () => busy(vb, async () => {
            const got = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blobOf(f).arrayBuffer()))].map((x) => x.toString(16).padStart(2, '0')).join('')
            clear(verifyOut, got === f.integrity.hash ? alert('success', 'SHA-256 matches the hash in the header.') : alert('error', `SHA-256 does not match. Header: ${f.integrity.hash}, file: ${got}.`))
          }, { label: 'Hashing', errorTo: verifyOut }))
          acts.append(vb)
        }
        clear(previewBox, head, acts, verifyOut, h('div', { class: 'small muted' }, 'Loading preview...'))
        try {
          const ext = extOf(f.path)
          let body
          if (IMG[ext] && f.size <= PREVIEW_IMAGE) {
            previewUrl = URL.createObjectURL(new Blob([blobOf(f)], { type: IMG[ext] }))
            body = h('div', { class: 'preview' }, h('img', { class: 'pkg-imgprev', src: previewUrl, alt: f.path }))
          } else {
            const bytes = new Uint8Array(await blobOf(f).slice(0, PREVIEW_TEXT).arrayBuffer())
            if (seq !== previewSeq) return // another file was picked while this one was read
            if (looksText(bytes)) {
              let text = new TextDecoder().decode(bytes)
              if (f.size > PREVIEW_TEXT) text += `\n\n... preview stops at ${formatBytes(PREVIEW_TEXT)}. Download the file to see all of it.`
              if (ext === 'json' && f.size <= PREVIEW_TEXT) { try { text = JSON.stringify(JSON.parse(text), null, 2) } catch { /* show as is */ } }
              body = codeBlock(text)
            } else body = h('div', { class: 'stack' }, h('div', { class: 'small muted' }, 'Binary file. First bytes:'), codeBlock(hexDump(bytes, 1024)))
          }
          previewBox.lastChild.replaceWith(body)
        } catch (e) { if (seq === previewSeq) previewBox.lastChild.replaceWith(alert('error', errorMessage(e))) }
      }

      const zipOut = h('div')
      const zipProg = progress()
      const zipBtn = button('Download all as ZIP', { icon: 'file-archive', variant: 'primary' })
      zipBtn.addEventListener('click', () => busy(zipBtn, async () => {
        if (total > ZIP_LIMIT) fail(`The archive holds ${formatBytes(total)}, which is too much to zip in a browser tab. Download single files instead.`)
        clear(zipOut)
        const JSZip = await jszip()
        const z = new JSZip()
        for (let i = 0; i < packed.length; i++) {
          const f = packed[i]
          if (f.truncated) continue
          z.file(f.path, new Uint8Array(await blobOf(f).arrayBuffer()), { unixPermissions: f.executable ? 0o755 : 0o644 })
          if (i % 50 === 0) { zipProg.set((i / packed.length) * 0.3, `Collecting files (${i + 1} of ${packed.length})`); await yieldToMain() }
        }
        const blob = await z.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'UNIX' }, (m) => zipProg.set(0.3 + (m.percent / 100) * 0.7, 'Compressing'))
        download(blob, `${baseName(file.name) || 'app'}.zip`)
        clear(zipOut, alert('success', `ZIP ready: ${packed.length} files, ${formatBytes(blob.size)}.`, unpacked.length || links.length ? ` Not included: ${[unpacked.length && `${unpacked.length} unpacked`, links.length && `${links.length} symlinks`].filter(Boolean).join(' and ')} (they are not stored inside the archive).` : ''))
      }, { label: 'Zipping', errorTo: zipOut, progress: zipProg }))

      clear(result,
        truncated.length ? alert('warn', `${truncated.length} file${truncated.length === 1 ? ' points' : 's point'} past the end of the archive, so it is truncated.`) : null,
        stats([
          { label: 'Files', value: formatNumber(packed.length), accent: true, hint: formatBytes(total) },
          { label: 'Folders', value: formatNumber(arc.dirs) },
          { label: 'Unpacked', value: formatNumber(unpacked.length), hint: 'outside the archive' },
          { label: 'Symlinks', value: formatNumber(links.length) },
          { label: 'Header', value: formatBytes(arc.dataOffset), hint: 'JSON index' },
        ]),
        pkg ? card(sectionTitle('package.json'), h('div', { class: 'stack' }, kv([['Name', pkg.productName ? `${pkg.productName} (${pkg.name})` : pkg.name], ['Version', pkg.version], ['Main', pkg.main || 'index.js (default)'],
          ['Description', pkg.description], ['Author', typeof pkg.author === 'object' ? pkg.author?.name : pkg.author], ['License', pkg.license],
          ['Dependencies', pkg.dependencies ? Object.keys(pkg.dependencies).length : null], ['Electron', pkg.devDependencies?.electron || pkg.dependencies?.electron]]),
          pkg.main && !arc.files.some((f) => f.path === String(pkg.main).replace(/^\.\//, '')) ? alert('warn', `The main entry "${pkg.main}" is not in the archive.`) : null)) : null,
        card(sectionTitle('Contents', zipBtn), h('div', { class: 'stack' }, zipProg.el, zipOut,
          pills(pill('click a file to preview', 'info'), unpacked.length ? pill(`${unpacked.length} unpacked`, 'warn') : null, links.length ? pill(`${links.length} links`) : null),
          split(tree, previewBox))))
    }
  }

  root.append(h('div', { class: 'stack' }, zone, prog.el, result))
}

