// The e-book engine's shared model and helpers (no UI, no network).
//
// A Book is what every reader produces and every writer consumes:
//   { kind: 'reflow' | 'comic',
//     meta: { title, authors: [], language, identifier, publisher, description, date },
//     cover: { data: Uint8Array, type } | null,
//     chapters: [{ title, body }]        body = XHTML fragment; images are referenced as "images/<name>", chapters as "chapter-<n>.xhtml#id"
//     toc: [{ title, ch, frag, children }]   ch = 0-based chapter index
//     images: Map('images/<name>' -> { data: Uint8Array, type }),
//     css: string,
//     pages: [{ name, data, type }]       comics only, in reading order
//     files: [{ name, data }]             comics only: extra files from the archive (ComicInfo.xml ...)
//     warnings: [] }

export const IMAGE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff' }
export const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/tiff': 'tif' }
export const extOf = (name = '') => (name.match(/\.([^./\\]+)$/)?.[1] || '').toLowerCase()
export const typeOfName = (name) => IMAGE_TYPES[extOf(name)] || null
export const isImageName = (name) => !!typeOfName(name) && !/(^|\/)(__MACOSX|\.)/.test(name) && !/(^|\/)\._/.test(name)

/** An error whose message is safe to show as is. */
export const fail = (message, code) => Object.assign(new Error(message), { code })
export const drmError = (what) => fail(`This ${what} is protected by DRM (copy protection), so it cannot be converted. Only DRM-free books can be opened here. If you bought the book, check whether the store offers a DRM-free download.`, 'DRM')

export const naturalCompare = (() => {
  const c = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  return (a, b) => c.compare(a, b)
})()

export function newBook(kind = 'reflow') {
  return { kind, meta: { title: '', authors: [], language: '', identifier: '', publisher: '', description: '', date: '' }, cover: null, chapters: [], toc: [], images: new Map(), css: '', pages: [], files: [], warnings: [] }
}

export const utf8 = new TextEncoder()
export const toBytes = (s) => utf8.encode(s)
export const fromBytes = (b, enc = 'utf-8') => { try { return new TextDecoder(enc).decode(b) } catch { return new TextDecoder('utf-8').decode(b) } }

export function escapeXml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
}

/** Sniff an image type from its first bytes. */
export function sniffImage(b) {
  if (!b || b.length < 4) return null
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  if (b.length > 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 && /avif|avis/.test(String.fromCharCode(...b.subarray(8, 12)))) return 'image/avif'
  const head = fromBytes(b.subarray(0, 256))
  if (/<svg[\s>]/i.test(head)) return 'image/svg+xml'
  return null
}

/** {width, height} from the header of a JPEG, PNG, GIF, BMP or WebP, or null. */
export function imageSize(b) {
  const t = sniffImage(b)
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  try {
    if (t === 'image/png') return { width: dv.getUint32(16), height: dv.getUint32(20) }
    if (t === 'image/gif') return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) }
    if (t === 'image/bmp') return { width: dv.getInt32(18, true), height: Math.abs(dv.getInt32(22, true)) }
    if (t === 'image/jpeg') {
      let p = 2
      while (p < b.length - 9) {
        if (b[p] !== 0xff) { p++; continue }
        const m = b[p + 1]
        if (m === 0xff) { p++; continue }
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: dv.getUint16(p + 5), width: dv.getUint16(p + 7) }
        p += 2 + dv.getUint16(p + 2)
      }
    }
    if (t === 'image/webp') {
      const fmt = String.fromCharCode(...b.subarray(12, 16))
      if (fmt === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
      if (fmt === 'VP8L') { const v = dv.getUint32(21, true); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 } }
      if (fmt === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff }
    }
  } catch { /* fall through */ }
  return null
}

// ---------- paths inside archives ----------
export const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '')
/** Resolve a (possibly relative, possibly %-encoded) href against a base file path inside a zip. Returns a normal path without fragment. */
export function resolvePath(base, href) {
  let h = href.split('#')[0].split('?')[0]
  try { h = decodeURIComponent(h) } catch { /* keep as is */ }
  const parts = (h.startsWith('/') ? '' : dirOf(base)).split('/').filter(Boolean)
  for (const seg of h.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}
export const isExternal = (href) => /^[a-z][a-z0-9+.-]*:/i.test(href) && !/^(data):/i.test(href)

// ---------- HTML helpers (need a DOM; every modern browser has one, workers do not) ----------
const XHTML_NS = 'http://www.w3.org/1999/xhtml'
export const parseHtml = (html) => new DOMParser().parseFromString(html, 'text/html')
/** Parse as XHTML when it is well-formed, else as forgiving HTML. */
export function parseXhtmlOrHtml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xhtml+xml')
  if (!doc.querySelector('parsererror')) return doc
  return parseHtml(text)
}
let ser
const serializer = { serializeToString: (n) => (ser ||= new XMLSerializer()).serializeToString(n) }
/** Serialize the children of an element as an XHTML fragment (no stray namespace declarations). */
export function innerXhtml(el) {
  let out = ''
  for (const n of el.childNodes) {
    if (n.nodeType === 3) out += escapeXml(n.nodeValue)
    else if (n.nodeType === 1) out += serializer.serializeToString(n)
  }
  return out.replace(new RegExp(` xmlns="${XHTML_NS}"`, 'g'), '')
}
/** Remove scripts, inline event handlers and other active content. */
export function stripActive(root) {
  for (const el of root.querySelectorAll('script, iframe, object, embed, applet, form, input, button, select, textarea, audio, video, canvas, noscript, link, style, meta, base')) el.remove()
  for (const el of root.querySelectorAll('*')) {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || (/^(href|src|xlink:href)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name)
    }
  }
}
/** SVG wrappers around one picture (typical cover pages) become a plain <img>; other SVG is dropped. */
export function svgToImg(body) {
  for (const svg of [...body.getElementsByTagNameNS('*', 'svg')]) {
    const im = [...svg.getElementsByTagNameNS('*', 'image')][0]
    const href = im && (im.getAttribute('xlink:href') || im.getAttribute('href'))
    if (href) {
      const img = svg.ownerDocument.createElementNS(XHTML_NS, 'img')
      img.setAttribute('src', href)
      img.setAttribute('alt', '')
      svg.replaceWith(img)
    } else svg.remove()
  }
}
/** Replace an element by its children. */
export function unwrap(el) {
  el.replaceWith(...el.childNodes)
}

/** Plain text of an XHTML fragment (for titles, search, TXT). */
export function textOfHtml(html) {
  const doc = parseHtml(`<body>${html}</body>`)
  return doc.body.textContent.replace(/\s+/g, ' ').trim()
}

/** HTML (from a legacy source) -> well-formed XHTML body fragment, with active content removed. */
export function toXhtml(html, { fix } = {}) {
  const doc = parseHtml(`<!doctype html><body>${html}</body>`)
  stripActive(doc.body)
  fix?.(doc.body)
  return innerXhtml(doc.body)
}

/** Split a chapter on its top-level headings when the book is one huge blob. Returns [{title, body}]. */
export function splitByHeadings(bodyHtml, minChunk = 4000) {
  const doc = parseHtml(`<body>${bodyHtml}</body>`)
  const kids = [...doc.body.childNodes]
  for (const level of ['H1', 'H2', 'H3']) {
    const idx = kids.map((n, i) => (n.nodeName === level ? i : -1)).filter((i) => i >= 0)
    if (idx.length < 2) continue
    const out = []
    const starts = idx[0] > 0 ? [0, ...idx] : idx
    for (let k = 0; k < starts.length; k++) {
      const start = starts[k]
      const end = starts[k + 1] ?? kids.length
      const tmp = doc.createElement('body')
      for (const n of kids.slice(start, end)) tmp.append(n.cloneNode(true))
      const h = tmp.querySelector(level.toLowerCase())
      out.push({ title: h ? h.textContent.replace(/\s+/g, ' ').trim() : '', body: innerXhtml(tmp) })
    }
    // merge tiny pieces into the previous chapter
    const merged = []
    for (const c of out) {
      if (merged.length && c.body.length < minChunk && !c.title) merged[merged.length - 1].body += c.body
      else merged.push(c)
    }
    return merged
  }
  return [{ title: '', body: innerXhtml(doc.body) }]
}

/** Plain text -> XHTML paragraphs. Blank lines separate paragraphs, single newlines are joined. */
export function textToXhtml(text) {
  const paras = text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  return paras.map((p) => `<p>${escapeXml(p).replace(/\n/g, ' ')}</p>`).join('\n')
}

const CHAPTER_LINE = /^(chapter|part|book|section|prologue|epilogue|preface|introduction|contents|appendix)\b[^\n]{0,70}$|^(chapitre|kapitel|capitulo|capítulo|глава|章)\b[^\n]{0,70}$/i
/** Split plain text into chapters at lines such as "Chapter 3". */
export function splitTextChapters(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const marks = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim()
    if (l && CHAPTER_LINE.test(l) && (i === 0 || !lines[i - 1].trim()) && (!lines[i + 1] || !lines[i + 1].trim() || lines[i + 1].trim().length < 90)) marks.push(i)
  }
  if (marks.length < 2) return [{ title: '', body: textToXhtml(text) }]
  const out = []
  if (marks[0] > 0 && lines.slice(0, marks[0]).join('').trim()) out.push({ title: '', body: textToXhtml(lines.slice(0, marks[0]).join('\n')) })
  marks.forEach((m, k) => {
    const end = marks[k + 1] ?? lines.length
    const title = lines[m].trim()
    out.push({ title, body: `<h2>${escapeXml(title)}</h2>\n${textToXhtml(lines.slice(m + 1, end).join('\n'))}` })
  })
  return out
}

/** Give chapters without a title the text of their first heading. */
export function titleChapters(book) {
  book.chapters.forEach((c, i) => {
    if (c.title) return
    const m = c.body.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)
    const t = m ? textOfHtml(m[1]) : ''
    c.title = t || ''
  })
}

/** Build a flat TOC from chapter titles when the source has none. */
export function ensureToc(book) {
  if (book.toc.length) return
  book.chapters.forEach((c, i) => { if (c.title) book.toc.push({ title: c.title, ch: i, children: [] }) })
  if (!book.toc.length && book.chapters.length) book.toc.push({ title: book.meta.title || 'Start', ch: 0, children: [] })
}

export const bookText = (book) => book.chapters.map((c) => textOfHtml(c.body)).join('\n')

/** A stable id for remembering a book (reading position): from title, authors and size of the text. */
export function bookKey(book, fileName = '', size = 0) {
  const s = `${book.meta.title}|${book.meta.authors.join(',')}|${fileName}|${size}`
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

export function uuid() {
  return globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16) })
}

/** Register image bytes in a book under a unique name; returns its "images/<name>" path. */
export function addImage(book, data, type, wantedName = '') {
  type = sniffImage(data) || type || 'image/jpeg'
  const ext = IMAGE_EXT[type] || 'jpg'
  let base = (wantedName.split('/').pop() || 'image').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'image'
  let name = `images/${base}.${ext}`
  let n = 1
  while (book.images.has(name)) name = `images/${base}-${n++}.${ext}`
  book.images.set(name, { data, type })
  return name
}

export function bytesEqual(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

const OBSOLETE_ATTRS = ['valign', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'face', 'size', 'color', 'nowrap', 'hspace', 'vspace', 'clear', 'noshade', 'link', 'vlink', 'alink', 'text', 'background', 'language', 'compact', 'type_', 'start_']
/** Old HTML (as found in MOBI 6) -> elements and attributes that are valid in EPUB 3 XHTML. */
export function modernize(root) {
  const doc = root.ownerDocument
  for (const el of [...root.querySelectorAll('font, big, tt, strike, center, acronym, u, nobr, marquee')]) {
    const n = el.localName
    if (n === 'center') { const d = doc.createElement('div'); d.setAttribute('style', 'text-align:center'); d.append(...el.childNodes); el.replaceWith(d) }
    else if (n === 'tt') { const c = doc.createElement('code'); c.append(...el.childNodes); el.replaceWith(c) }
    else if (n === 'strike') { const c = doc.createElement('del'); c.append(...el.childNodes); el.replaceWith(c) }
    else if (n === 'u') continue
    else unwrap(el)
  }
  for (const el of root.querySelectorAll('*')) {
    const al = el.getAttribute('align')
    if (al !== null) {
      el.removeAttribute('align')
      if (/^(left|right|center|justify)$/i.test(al)) el.setAttribute('style', `text-align:${al.toLowerCase()};${el.getAttribute('style') || ''}`)
    }
    if (el.localName === 'a' && el.hasAttribute('name')) { if (!el.id) el.setAttribute('id', el.getAttribute('name')); el.removeAttribute('name') }
    for (const a of OBSOLETE_ATTRS) if (el.hasAttribute(a) && !(a === 'size' && el.localName === 'input')) el.removeAttribute(a)
    if (el.localName === 'img') { for (const a of ['width', 'height']) { const v = el.getAttribute(a); if (v && !/^\d+$/.test(v)) el.removeAttribute(a) } }
    if (el.hasAttribute('width') && !/^(img|td|th|col|canvas)$/.test(el.localName)) el.removeAttribute('width')
    if (el.hasAttribute('height') && !/^(img|td|th)$/.test(el.localName)) el.removeAttribute('height')
    if (el.hasAttribute('id')) { const id = el.getAttribute('id'); if (!/^[A-Za-z_][\w.:-]*$/.test(id)) el.setAttribute('id', 'x' + id.replace(/[^\w.:-]/g, '_')) }
  }
}

/** True when the first chapter is just a picture (a cover page), so writers need not add another cover. */
export function startsWithPicture(book) {
  const body = book.chapters[0]?.body || ''
  return /<img/i.test(body) && !textOfHtml(body)
}
