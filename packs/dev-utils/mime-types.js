// MIME type lookup: 1,000+ types and 1,200+ extensions both ways, with header/server snippets, plus a file checker that sniffs the real type.
import { h, input, button, dropzone, empty, clear, copyText, formatBytes, fileType } from '../../lib/ui.js'
import { useKit, css, chips, eyebrow, pill, outBox, hashParams } from './_kit.js'
import { MIME_DATA, PRIMARY, EXTRA } from './_mime-data.js'

// ---------- database ----------
const types = new Map() // mime -> {mime, exts, compressible, registered, notes: {ext: note}}
const byExt = new Map() // ext -> [mime]
function add(mime, exts, compressible, registered, notes = {}) {
  let t = types.get(mime)
  if (!t) { t = { mime, exts: [], compressible, registered, notes: {} }; types.set(mime, t) }
  for (const e of exts) {
    if (!t.exts.includes(e)) t.exts.push(e)
    const l = byExt.get(e) || []
    if (!l.includes(mime)) l.push(mime)
    byExt.set(e, l)
  }
  Object.assign(t.notes, notes)
}
for (const line of MIME_DATA.split('\n')) {
  const [mime, c, exts] = line.split('\t')
  add(mime, exts.split(' '), c === '1' ? true : c === '0' ? false : null, true)
}
for (const [ext, mime, note] of EXTRA) add(mime, [ext], mime.startsWith('text/') ? true : null, /^IANA/.test(note), { [ext]: note })
export const ALL = [...types.values()].sort((a, b) => a.mime.localeCompare(b.mime))
export const EXT_COUNT = byExt.size

/** The best-known type for an extension (overrides first, then the first registered one). */
export function primaryFor(ext) {
  const e = ext.toLowerCase().replace(/^\./, '')
  const list = byExt.get(e)
  if (!list) return null
  return PRIMARY[e] && list.includes(PRIMARY[e]) ? PRIMARY[e] : list.find((m) => m !== 'application/octet-stream') || list[0]
}

const POPULAR = ['html', 'css', 'js', 'json', 'png', 'jpg', 'svg', 'webp', 'gif', 'pdf', 'mp4', 'mp3', 'zip', 'woff2', 'wasm', 'csv', 'md', 'txt', 'xml', 'docx', 'xlsx', 'ico', 'yaml', 'webm']
const POP_SET = new Set(POPULAR.map((e) => byExt.has(e) && primaryFor(e)))
const cat = (m) => m.split('/')[0]

/** Search by extension (.png / png), type (image/png), wildcard (image/*) or any word. Best matches first. */
export function search(raw, category = 'all') {
  let q = raw.trim().toLowerCase()
  let list = ALL
  if (category === 'popular') list = ALL.filter((t) => POP_SET.has(t.mime))
  else if (category !== 'all') list = ALL.filter((t) => cat(t.mime) === category)
  if (!q) return category === 'all' ? list.filter((t) => POP_SET.has(t.mime)).concat(list.filter((t) => !POP_SET.has(t.mime))) : list
  if (q.endsWith('/*')) return list.filter((t) => t.mime.startsWith(q.slice(0, -1)))
  const dot = q.startsWith('.')
  if (dot) q = q.slice(1)
  const score = (t) => {
    if (t.mime === q) return 0
    if (t.exts.includes(q)) return primaryFor(q) === t.mime ? 1 : 2
    if (!dot && t.mime.startsWith(q)) return 3
    if (!dot && t.exts.some((e) => e.startsWith(q))) return 4
    if (!dot && t.mime.includes(q)) return 5
    return 9
  }
  return list.map((t) => [score(t), t]).filter(([s]) => s < 9).sort((a, b) => a[0] - b[0] || a[1].mime.localeCompare(b[1].mime)).map(([, t]) => t)
}

// ---------- content sniffing ----------
const sig = (bytes, ...parts) => parts.every(([off, vals]) => vals.every((v, i) => bytes[off + i] === (typeof v === 'string' ? v.charCodeAt(0) : v)))
const str = (bytes, from, to) => String.fromCharCode(...bytes.slice(from, to))
const OFFICE = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation', jar: 'application/java-archive', apk: 'application/vnd.android.package-archive', epub: 'application/epub+zip', xpi: 'application/x-xpinstall' }

/** Guess a file's real type from its first bytes. Returns {mime, label} or null. */
export function sniff(bytes, name = '') {
  const ext = (name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase()
  const b = bytes
  if (sig(b, [0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]])) return { mime: 'image/png', label: 'PNG image' }
  if (sig(b, [0, [0xff, 0xd8, 0xff]])) return { mime: 'image/jpeg', label: 'JPEG image' }
  if (sig(b, [0, ['G', 'I', 'F', '8']])) return { mime: 'image/gif', label: 'GIF image' }
  if (sig(b, [0, ['R', 'I', 'F', 'F']]) && str(b, 8, 12) === 'WEBP') return { mime: 'image/webp', label: 'WebP image' }
  if (sig(b, [0, ['R', 'I', 'F', 'F']]) && str(b, 8, 12) === 'WAVE') return { mime: 'audio/wav', label: 'WAV audio' }
  if (sig(b, [0, ['R', 'I', 'F', 'F']]) && str(b, 8, 12) === 'AVI ') return { mime: 'video/x-msvideo', label: 'AVI video' }
  if (sig(b, [0, ['%', 'P', 'D', 'F']])) return { mime: 'application/pdf', label: 'PDF document' }
  if (sig(b, [0, [0x50, 0x4b, 0x03, 0x04]]) || sig(b, [0, [0x50, 0x4b, 0x05, 0x06]])) return OFFICE[ext] ? { mime: OFFICE[ext], label: `${ext.toUpperCase()} (ZIP-based)` } : { mime: 'application/zip', label: 'ZIP archive' }
  if (sig(b, [0, [0x1f, 0x8b]])) return { mime: 'application/gzip', label: 'gzip data' }
  if (sig(b, [0, ['B', 'Z', 'h']])) return { mime: 'application/x-bzip2', label: 'bzip2 data' }
  if (sig(b, [0, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]])) return { mime: 'application/x-xz', label: 'xz data' }
  if (sig(b, [0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]])) return { mime: 'application/x-7z-compressed', label: '7-Zip archive' }
  if (sig(b, [0, ['R', 'a', 'r', '!', 0x1a, 0x07]])) return { mime: 'application/vnd.rar', label: 'RAR archive' }
  if (sig(b, [0, [0x28, 0xb5, 0x2f, 0xfd]])) return { mime: 'application/zstd', label: 'Zstandard data' }
  if (sig(b, [4, ['f', 't', 'y', 'p']])) {
    const brand = str(b, 8, 12)
    if (/^(heic|heix|hevc|mif1|msf1)/.test(brand)) return { mime: 'image/heic', label: 'HEIC image' }
    if (brand === 'avif') return { mime: 'image/avif', label: 'AVIF image' }
    if (/^(M4A|M4B)/.test(brand)) return { mime: 'audio/mp4', label: 'M4A audio' }
    if (brand.startsWith('qt')) return { mime: 'video/quicktime', label: 'QuickTime video' }
    if (brand.startsWith('3gp')) return { mime: 'video/3gpp', label: '3GPP video' }
    return { mime: 'video/mp4', label: 'MP4 video' }
  }
  if (sig(b, [0, ['I', 'D', '3']]) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { mime: 'audio/mpeg', label: 'MP3 audio' }
  if (sig(b, [0, ['O', 'g', 'g', 'S']])) return { mime: 'audio/ogg', label: 'Ogg media' }
  if (sig(b, [0, ['f', 'L', 'a', 'C']])) return { mime: 'audio/flac', label: 'FLAC audio' }
  if (sig(b, [0, [0x1a, 0x45, 0xdf, 0xa3]])) return { mime: ext === 'mkv' ? 'video/x-matroska' : 'video/webm', label: 'Matroska / WebM video' }
  if (sig(b, [0, ['B', 'M']]) && b.length > 14) return { mime: 'image/bmp', label: 'BMP image' }
  if (sig(b, [0, [0x49, 0x49, 0x2a, 0x00]]) || sig(b, [0, [0x4d, 0x4d, 0x00, 0x2a]])) return { mime: 'image/tiff', label: 'TIFF image' }
  if (sig(b, [0, [0x00, 0x00, 0x01, 0x00]])) return { mime: 'image/vnd.microsoft.icon', label: 'ICO icon' }
  if (sig(b, [0, ['S', 'Q', 'L', 'i', 't', 'e', ' ', 'f']])) return { mime: 'application/vnd.sqlite3', label: 'SQLite database' }
  if (sig(b, [0, [0x7f, 'E', 'L', 'F']])) return { mime: 'application/x-executable', label: 'ELF executable' }
  if (sig(b, [0, [0x00, 0x61, 0x73, 0x6d]])) return { mime: 'application/wasm', label: 'WebAssembly module' }
  if (sig(b, [0, ['M', 'Z']])) return { mime: 'application/vnd.microsoft.portable-executable', label: 'Windows executable' }
  if (sig(b, [0, ['w', 'O', 'F', '2']])) return { mime: 'font/woff2', label: 'WOFF2 font' }
  if (sig(b, [0, ['w', 'O', 'F', 'F']])) return { mime: 'font/woff', label: 'WOFF font' }
  if (sig(b, [0, ['O', 'T', 'T', 'O']])) return { mime: 'font/otf', label: 'OpenType font' }
  if (sig(b, [0, [0x00, 0x01, 0x00, 0x00]])) return { mime: 'font/ttf', label: 'TrueType font' }
  if (sig(b, [0, ['{', '\\', 'r', 't', 'f']])) return { mime: 'application/rtf', label: 'RTF document' }
  // text
  const head = new TextDecoder('utf-8').decode(b.slice(0, 512)).replace(/^﻿/, '')
  const printable = [...head].filter((c) => c.charCodeAt(0) >= 32 || /[\n\r\t]/.test(c)).length / Math.max(1, head.length)
  if (head.length && printable > 0.97 && !head.includes('\u0000')) {
    const t = head.trimStart()
    if (/^<svg[\s>]/i.test(t) || (/^<\?xml/i.test(t) && /<svg[\s>]/i.test(t))) return { mime: 'image/svg+xml', label: 'SVG image' }
    if (/^<\?xml/i.test(t)) return { mime: 'application/xml', label: 'XML document' }
    if (/^<!doctype html|^<html/i.test(t)) return { mime: 'text/html', label: 'HTML document' }
    if (/^[\[{]/.test(t) && ext === 'json') return { mime: 'application/json', label: 'JSON text' }
    return { mime: 'text/plain', label: 'Plain text' }
  }
  return null
}

const norm = (m) => ({ 'image/jpg': 'image/jpeg', 'audio/mp3': 'audio/mpeg', 'audio/wave': 'audio/wav', 'audio/x-wav': 'audio/wav', 'image/x-icon': 'image/vnd.microsoft.icon', 'application/x-zip-compressed': 'application/zip', 'text/xml': 'application/xml', 'application/x-gzip': 'application/gzip' }[m] || m)

const STYLE = `
.t-mt .mt-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 10px; }
.t-mt .mt-card { text-align: left; display: grid; gap: 6px; padding: 12px 14px; border-radius: 16px; border: 1px solid var(--border); background: var(--surface); color: inherit; cursor: pointer; min-width: 0;
  transition: border-color .2s, transform .25s var(--spring), box-shadow .2s; animation: dv-rise .35s var(--ease) both; animation-delay: calc(var(--i, 0) * 10ms); }
.t-mt .mt-card:hover { border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); transform: translateY(-2px); box-shadow: var(--shadow); }
.t-mt .mt-card[aria-pressed="true"] { border-color: var(--accent); box-shadow: 0 0 0 3px var(--ring); }
.t-mt .mt-card code { font-family: var(--mono); font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.t-mt .mt-exts { display: flex; flex-wrap: wrap; gap: 5px; }
.t-mt .mt-exts span { font-family: var(--mono); font-size: 11.5px; padding: 1px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }
.t-mt .mt-big { font-family: var(--mono); font-size: clamp(20px, 4vw, 32px); font-weight: 700; letter-spacing: -.02em; overflow-wrap: anywhere; line-height: 1.2; }
.t-mt .mt-ext { font-family: var(--mono); font-size: 13px; padding: 4px 11px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; color: var(--text); transition: transform .2s var(--spring), border-color .2s; }
.t-mt .mt-ext:hover { border-color: var(--accent); transform: translateY(-1px); }
.t-mt .mt-ext.pri { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
.t-mt .mt-chk { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 14px; font-size: 13.5px; }
.t-mt .mt-chk dt { color: var(--muted); }
.t-mt .mt-chk dd { margin: 0; font-family: var(--mono); font-size: 13px; overflow-wrap: anywhere; }
`

const PAGE = 60

export function mount(root) {
  useKit()
  css('t-mt-css', STYLE)
  const q = hashParams()
  let category = 'all'
  let query = q.get('q') || ''
  let shown = PAGE
  let sel = types.get(q.get('type') || '') || types.get(primaryFor(query) || '') || types.get('image/png')
  let selExt = null

  const searchIn = input({ type: 'search', value: query, placeholder: `Search ${EXT_COUNT.toLocaleString()} extensions and ${ALL.length.toLocaleString()} types: .png, image/webp, pdf, font/*...`, 'aria-label': 'Search extensions or MIME types', oninput: (ev) => { query = ev.target.value; shown = PAGE; renderList(); const e = query.trim().toLowerCase().replace(/^\./, ''); if (byExt.has(e)) pick(types.get(primaryFor(e)), e, false); else if (types.has(query.trim().toLowerCase())) pick(types.get(query.trim().toLowerCase()), null, false) } })
  const catChips = chips([['all', 'All'], ['popular', 'Popular'], ...['application', 'audio', 'font', 'image', 'model', 'text', 'video'].map((c) => [c, c])], { value: 'all', ariaLabel: 'Category', onChange: (v) => { category = v; shown = PAGE; renderList() } })
  const quick = h('div', { class: 'dv-chips' }, POPULAR.slice(0, 14).map((e) => h('button', { type: 'button', class: 'dv-chip mono', onclick: () => { searchIn.value = `.${e}`; searchIn.dispatchEvent(new Event('input')) } }, `.${e}`)))
  const detail = h('div', { class: 'panel stack' })
  const list = h('div', { class: 'mt-grid' })
  const more = h('div', { class: 'row', style: 'justify-content:center' })
  const resultNote = h('div', { class: 'small muted' })
  const snipKind = chips([['header', 'Content-Type'], ['accept', 'accept attr'], ['nginx', 'nginx'], ['apache', 'Apache'], ['express', 'Express'], ['python', 'Python']], { value: 'header', ariaLabel: 'Snippet', onChange: () => renderSnip() })
  const snip = outBox('Use it', { placeholder: '' })
  function renderSnip() {
    const t = sel
    const ext = selExt && t.exts.includes(selExt) ? selExt : t.exts[0]
    const k = snipKind.value
    snip.set({
      header: `Content-Type: ${t.mime}${t.mime.startsWith('text/') ? '; charset=utf-8' : ''}`,
      accept: t.exts.length ? `<input type="file" accept="${[t.mime, ...t.exts.slice(0, 4).map((e) => '.' + e)].join(',')}">` : `<input type="file" accept="${t.mime}">`,
      nginx: `types {\n    ${t.mime}${' '.repeat(Math.max(1, 34 - t.mime.length))}${t.exts.join(' ') || 'ext'};\n}`,
      apache: `AddType ${t.mime} ${t.exts.map((e) => '.' + e).join(' ') || '.ext'}`,
      express: ext ? `res.type('${ext}')   // Content-Type: ${t.mime}` : `res.set('Content-Type', '${t.mime}')`,
      python: ext ? `import mimetypes\nmimetypes.guess_type('file.${ext}')   # ('${t.mime}', None)` : `Response(content, media_type='${t.mime}')`,
    }[k], { quiet: true })
  }

  function pick(t, ext, scroll = true) {
    sel = t
    selExt = ext
    for (const b of list.children) b.setAttribute?.('aria-pressed', String(b.dataset.mime === t.mime))
    clear(detail,
      h('div', { class: 'row between', style: 'align-items:flex-start' },
        h('div', { class: 'stack tight' }, h('div', { class: 'small muted' }, ext ? `.${ext} is served as` : 'MIME type'), h('div', { class: 'mt-big' }, t.mime),
          h('div', { class: 'row', style: 'gap:6px' }, pill('', null, cat(t.mime)), t.registered ? pill('ok', 'badge-check', 'Registered') : pill('warn', 'triangle-alert', 'Convention'),
            t.compressible === true ? pill('info', 'file-archive', 'Compresses well (gzip/brotli)') : t.compressible === false ? pill('', 'package', 'Already compressed or binary') : null)),
        h('div', { class: 'row', style: 'gap:6px' }, button('Copy type', { icon: 'copy', size: 'sm', onClick: () => copyText(t.mime) }), t.exts.length ? button(`Copy .${t.exts[0]}`, { icon: 'copy', size: 'sm', variant: 'ghost', onClick: () => copyText(`.${t.exts[0]}`) }) : null)),
      t.exts.length ? h('div', { class: 'stack tight' }, h('div', { class: 'small muted' }, `Extensions (${t.exts.length})`),
        h('div', { class: 'row', style: 'gap:6px' }, t.exts.map((e) => h('button', { type: 'button', class: ['mt-ext', primaryFor(e) === t.mime && 'pri'], title: primaryFor(e) === t.mime ? `Primary type for .${e}` : `.${e} is also used by: ${byExt.get(e).filter((m) => m !== t.mime).join(', ')}`, onclick: () => { searchIn.value = `.${e}`; query = `.${e}`; renderList(); pick(types.get(primaryFor(e)), e, false) } }, `.${e}`)))) : null,
      ...[...new Set(t.exts)].filter((e) => t.notes[e]).slice(0, 1).map((e) => h('div', { class: 'small muted' }, `Note: ${t.notes[e]}`)),
      (() => { const alt = ext ? byExt.get(ext)?.filter((m) => m !== t.mime) : []; return alt?.length ? h('div', { class: 'small' }, `.${ext} is also registered for: `, ...alt.flatMap((m, i) => [i ? ', ' : '', h('a', { href: `#/mime-types?type=${encodeURIComponent(m)}`, onclick: (e) => { e.preventDefault(); pick(types.get(m), ext, false) } }, m)])) : null })(),
      h('div', { class: 'stack tight' }, eyebrow('code', 'Use it'), snipKind, snip.el))
    renderSnip()
    if (scroll) detail.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }

  function renderList() {
    const res = search(query, category)
    resultNote.textContent = query.trim() || category !== 'all' ? `${res.length.toLocaleString()} match${res.length === 1 ? '' : 'es'}` : 'Popular types first'
    clear(list, ...(res.length ? res.slice(0, shown).map((t, i) => h('button', { type: 'button', class: 'mt-card', dataset: { mime: t.mime }, 'aria-pressed': String(t.mime === sel.mime), style: { '--i': Math.min(i, 20) }, onclick: () => pick(t, null) },
      h('code', t.mime), h('div', { class: 'mt-exts' }, t.exts.slice(0, 8).map((e) => h('span', `.${e}`)), t.exts.length > 8 ? h('span', { style: 'background:none;color:var(--muted)' }, `+${t.exts.length - 8}`) : null))) : [h('div', { style: 'grid-column:1/-1' }, empty('Nothing found. Try an extension such as .webp, a type such as audio/mpeg, or a wildcard such as video/*.', 'search-x'))]))
    clear(more, res.length > shown ? button(`Show ${Math.min(PAGE, res.length - shown)} more`, { icon: 'chevrons-down', onClick: () => { shown += PAGE; renderList() } }) : null)
  }

  // ---------- file checker ----------
  const chkOut = h('div')
  const dz = dropzone({ accept: '', label: 'Check a file: drop it here or click', hint: 'Reads the first bytes in your browser and compares them with the extension. The file is not uploaded.', compact: true, paste: false, onFiles: async ([f]) => {
    const bytes = new Uint8Array(await f.slice(0, 4096).arrayBuffer())
    const s = sniff(bytes, f.name)
    const ext = (f.name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase()
    const byName = ext ? primaryFor(ext) : null
    const browser = fileType(f)
    let verdict
    if (!s) verdict = pill('warn', 'circle-help', 'Content not recognised')
    else if (!byName) verdict = pill('info', 'info', 'Extension has no known type')
    else if (norm(s.mime) === norm(byName) || (byExt.get(ext) || []).map(norm).includes(norm(s.mime))) verdict = pill('ok', 'check', 'Extension and content agree')
    else if (s.mime === 'text/plain') verdict = pill('ok', 'check', 'Plain text, extension is just a label')
    else verdict = pill('bad', 'triangle-alert', 'Mismatch: content looks like something else')
    clear(chkOut, h('div', { class: 'stack tight' }, verdict,
      h('dl', { class: 'mt-chk' }, h('dt', 'File'), h('dd', `${f.name} (${formatBytes(f.size)})`),
        h('dt', 'By extension'), h('dd', byName || '(none)'), h('dt', 'Browser says'), h('dd', browser || '(empty)'), h('dt', 'By content'), h('dd', s ? `${s.mime}  (${s.label})` : 'unknown')),
      s && types.get(s.mime) ? button(`Open ${s.mime}`, { size: 'sm', icon: 'arrow-right', onClick: () => pick(types.get(s.mime), null) }) : null))
  } })

  root.append(h('div', { class: 'dv t-mt stack' }, detail,
    h('div', { class: 'stack tight' }, eyebrow('search', 'Find a type'), searchIn, quick, catChips, resultNote), list, more,
    h('div', { class: 'panel stack tight' }, eyebrow('scan-search', 'Does a file match its extension?'), dz, chkOut),
    h('p', { class: 'small muted' }, `Type and extension data comes from the mime-db project (MIT licence) plus a few developer conventions. When an extension is registered for several types, the best-known one is marked as primary. ${EXT_COUNT.toLocaleString()} extensions, ${ALL.length.toLocaleString()} types.`)))
  renderList()
  pick(sel, selExt, false)
}
