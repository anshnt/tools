// Writers: Book -> EPUB 3, KEPUB, single-file HTML, TXT, Markdown, CBZ. DOCX is in _docx.js and PDF in _pdf.js.
import { jszip } from '../../lib/libs.js'
import {
  startsWithPicture, escapeXml, uuid, IMAGE_EXT, imageSize, parseHtml, innerXhtml, fail, bytesEqual,
} from './_book.js'
import { htmlToBlocks, runsText } from './_blocks.js'

const MIME_OF_EXT = Object.fromEntries(Object.entries(IMAGE_EXT).map(([m, e]) => [e, m]))
const mediaTypeOf = (name) => MIME_OF_EXT[name.split('.').pop().toLowerCase()] || 'application/octet-stream'
const yieldNow = () => new Promise((r) => setTimeout(r, 0))
const zipOpts = { createFolders: false }

function cleanLang(l) { return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l || '') ? l : 'en' }
function isoDate(d) {
  if (!d) return ''
  const m = String(d).match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/)
  return m ? [m[1], m[2], m[3]].filter(Boolean).join('-') : ''
}
const authorsOf = (book) => (book.meta.authors.length ? book.meta.authors : [])

/** Turn a comic into a book of picture pages that the book writers understand. */
export function comicAsBook(comic) {
  const book = { ...comic, kind: 'reflow', chapters: [], toc: [], images: new Map(), fixed: true }
  const pad = String(comic.pages.length).length
  let allSized = true
  comic.pages.forEach((p, i) => {
    const ext = IMAGE_EXT[p.type] || 'jpg'
    const name = `images/page-${String(i + 1).padStart(Math.max(3, pad), '0')}.${ext}`
    book.images.set(name, { data: p.data, type: p.type })
    const size = imageSize(p.data)
    if (!size) allSized = false
    book.chapters.push({ title: `Page ${i + 1}`, body: `<div class="page"><img src="${name}" alt="Page ${i + 1}"/></div>`, viewport: size ? `width=${size.width}, height=${size.height}` : '' })
    book.toc.push({ title: `Page ${i + 1}`, ch: i, children: [] })
  })
  book.fixed = allSized && comic.pages.length > 0
  book.css = 'html,body{margin:0;padding:0;background:#fff}div.page{margin:0;padding:0;text-align:center}div.page img{max-width:100%;max-height:100vh;height:auto;width:auto}'
  return book
}

const ensureAlt = (xhtml) => xhtml.replace(/<img\b(?![^>]*\balt\s*=)/g, '<img alt=""')

function chapterXhtml(book, ch, i, lang, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}">
<head>
<meta charset="utf-8"/>
<title>${escapeXml(ch.title || book.meta.title || `Part ${i + 1}`)}</title>
${ch.viewport ? `<meta name="viewport" content="${escapeXml(ch.viewport)}"/>\n` : ''}<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${body}
</body>
</html>
`
}

/**
 * Build an EPUB 3 file. opts: { kepub: true } adds Kobo reading spans. Returns a Blob.
 * The first ZIP entry is the stored "mimetype", then META-INF/container.xml, then the package, navigation, styles, chapters and pictures.
 */
export async function writeEpub(inBook, opts = {}, onProgress) {
  const book = inBook.kind === 'comic' ? comicAsBook(inBook) : inBook
  const JSZip = await jszip()
  const z = new JSZip()
  const lang = cleanLang(book.meta.language)
  const title = book.meta.title || 'Untitled'
  const id = book.meta.identifier && /\S/.test(book.meta.identifier) ? book.meta.identifier : `urn:uuid:${uuid()}`
  z.file('mimetype', 'application/epub+zip', { compression: 'STORE', ...zipOpts })
  z.file('META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>\n', zipOpts)

  // pictures (the cover is added once)
  const images = [...book.images.entries()]
  let coverName = null
  if (book.cover) {
    coverName = images.find(([, im]) => im.data === book.cover.data || (im.data.length === book.cover.data.length && bytesEqual(im.data, book.cover.data)))?.[0] || null
    if (!coverName) {
      coverName = `images/cover.${IMAGE_EXT[book.cover.type] || 'jpg'}`
      while (book.images.has(coverName)) coverName = coverName.replace('cover', 'cover-')
      images.push([coverName, book.cover])
    }
  }
  // navigation
  const tocList = book.toc.length ? book.toc : book.chapters.map((c, i) => ({ title: c.title || `Part ${i + 1}`, ch: i, children: [] }))
  const href = (t) => `chapter-${t.ch + 1}.xhtml${t.frag ? `#${t.frag}` : ''}`
  const navLi = (list) => `<ol>${list.map((t) => `<li><a href="${escapeXml(href(t))}">${escapeXml(t.title || 'Untitled')}</a>${t.children?.length ? navLi(t.children) : ''}</li>`).join('')}</ol>`
  z.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}">
<head><meta charset="utf-8"/><title>Contents</title></head>
<body>
<nav epub:type="toc" id="toc"><h1>Contents</h1>
${navLi(tocList)}
</nav>
</body>
</html>
`, zipOpts)
  let order = 0
  let depth = 1
  const ncxPoint = (t, d) => {
    depth = Math.max(depth, d)
    const n = ++order
    return `<navPoint id="np${n}" playOrder="${n}"><navLabel><text>${escapeXml(t.title || 'Untitled')}</text></navLabel><content src="${escapeXml(href(t))}"/>${(t.children || []).map((c) => ncxPoint(c, d + 1)).join('')}</navPoint>`
  }
  const points = tocList.map((t) => ncxPoint(t, 1)).join('\n')
  z.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${escapeXml(id)}"/><meta name="dtb:depth" content="${depth}"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>
<docTitle><text>${escapeXml(title)}</text></docTitle>
<navMap>
${points}
</navMap>
</ncx>
`, zipOpts)

  const css = `${book.css || ''}\n${opts.kepub ? '' : ''}`.trim()
  z.file('OEBPS/style.css', `${css || 'body{line-height:1.4}img{max-width:100%;height:auto}'}\n`, zipOpts)

  // chapters
  const n = book.chapters.length
  for (let i = 0; i < n; i++) {
    const ch = book.chapters[i]
    let body = ensureAlt(ch.body)
    if (opts.kepub) body = kepubify(body)
    z.file(`OEBPS/chapter-${i + 1}.xhtml`, chapterXhtml(book, ch, i, lang, body), zipOpts)
    if (i % 25 === 24) { onProgress?.((i / n) * 0.5, 'Writing chapters'); await yieldNow() }
  }
  for (const [name, im] of images) z.file(`OEBPS/${name}`, im.data, { ...zipOpts, compression: im.type === 'image/svg+xml' ? 'DEFLATE' : 'STORE' })

  // package
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    ...book.chapters.map((_, i) => `<item id="ch${i + 1}" href="chapter-${i + 1}.xhtml" media-type="application/xhtml+xml"/>`),
    ...images.map(([name, im], i) => `<item id="img${i + 1}" href="${escapeXml(name)}" media-type="${im.type || mediaTypeOf(name)}"${name === coverName ? ' properties="cover-image"' : ''}/>`),
  ]
  const coverId = coverName ? `img${images.findIndex(([nm]) => nm === coverName) + 1}` : null
  const date = isoDate(book.meta.date)
  z.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${escapeXml(id)}</dc:identifier>
<dc:title>${escapeXml(title)}</dc:title>
${authorsOf(book).map((a) => `<dc:creator>${escapeXml(a)}</dc:creator>`).join('\n')}
<dc:language>${lang}</dc:language>
${book.meta.publisher ? `<dc:publisher>${escapeXml(book.meta.publisher)}</dc:publisher>\n` : ''}${date ? `<dc:date>${date}</dc:date>\n` : ''}${book.meta.description ? `<dc:description>${escapeXml(book.meta.description)}</dc:description>\n` : ''}<meta property="dcterms:modified">${modified}</meta>
${coverId ? `<meta name="cover" content="${coverId}"/>\n` : ''}${book.fixed ? '<meta property="rendition:layout">pre-paginated</meta>\n<meta property="rendition:orientation">auto</meta>\n<meta property="rendition:spread">none</meta>\n' : ''}</metadata>
<manifest>
${manifest.join('\n')}
</manifest>
<spine toc="ncx">
${book.chapters.map((_, i) => `<itemref idref="ch${i + 1}"/>`).join('\n')}
</spine>
</package>
`, zipOpts)
  onProgress?.(0.6, 'Packing')
  return z.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE', compressionOptions: { level: 6 }, streamFiles: false }, (m) => onProgress?.(0.6 + (m.percent / 100) * 0.4, 'Packing'))
}

/** Wrap each sentence of the text in a Kobo span and the content in Kobo's two containers. */
export function kepubify(bodyXhtml) {
  const doc = parseHtml(`<body>${bodyXhtml}</body>`)
  const blockOf = (node) => {
    for (let p = node.parentElement; p; p = p.parentElement) if (/^(p|h[1-6]|li|div|td|th|blockquote|dt|dd|figcaption|pre|caption|body)$/i.test(p.localName)) return p
    return doc.body
  }
  const paras = new Map()
  const counters = new Map()
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const nodes = []
  for (let nd = walker.nextNode(); nd; nd = walker.nextNode()) if (nd.nodeValue.trim() && !nd.parentElement.closest('script, style, svg')) nodes.push(nd)
  const para = { n: 0 }
  for (const t of nodes) {
    const b = blockOf(t)
    if (!paras.has(b)) { paras.set(b, ++para.n); counters.set(b, 0) }
    const parts = t.nodeValue.match(/[^.!?。！？…]*[.!?。！？…]+["'”’)»\]]*\s*|[^.!?。！？…]+$/g) || [t.nodeValue]
    const frag = doc.createDocumentFragment()
    for (const s of parts) {
      if (!s) continue
      if (!s.trim()) { frag.append(doc.createTextNode(s)); continue }
      const sp = doc.createElement('span')
      sp.setAttribute('class', 'koboSpan')
      counters.set(b, counters.get(b) + 1)
      sp.setAttribute('id', `kobo.${paras.get(b)}.${counters.get(b)}`)
      sp.textContent = s
      frag.append(sp)
    }
    t.replaceWith(frag)
  }
  return `<div id="book-columns"><div id="book-inner">${innerXhtml(doc.body)}</div></div>`
}

// ---------- single-file HTML ----------
function b64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export async function writeHtml(book, opts = {}) {
  if (book.kind === 'comic') book = comicAsBook(book)
  const data = new Map()
  const uri = (name) => {
    if (!data.has(name)) { const im = book.images.get(name); data.set(name, im ? `data:${im.type};base64,${b64(im.data)}` : '') }
    return data.get(name)
  }
  const sections = book.chapters.map((c, i) => {
    let body = ensureAlt(c.body)
    body = body.replace(/\bsrc="(images\/[^"]+)"/g, (_, p) => `src="${uri(p.replace(/&amp;/g, '&'))}"`)
    body = body.replace(/\sid="([^"]*)"/g, (_, v) => ` id="c${i + 1}-${v}"`)
    body = body.replace(/\bhref="chapter-(\d+)\.xhtml(?:#([^"]*))?"/g, (_, k, f) => `href="#${f ? `c${k}-${f}` : `ch-${k}`}"`)
    body = body.replace(/\bhref="#([^"]*)"/g, (all, v) => (/^c\d+-|^ch-/.test(v) ? all : `href="#c${i + 1}-${v}"`))
    return `<section class="chapter" id="ch-${i + 1}">\n${body}\n</section>`
  })
  const css = (book.css || '').replace(/url\((images\/[^)]+)\)/g, (_, p) => `url(${uri(p)})`)
  const tocLi = (list) => `<ol>${list.map((t) => `<li><a href="#${t.frag ? `c${t.ch + 1}-${escapeXml(t.frag)}` : `ch-${t.ch + 1}`}">${escapeXml(t.title || 'Untitled')}</a>${t.children?.length ? tocLi(t.children) : ''}</li>`).join('')}</ol>`
  const lang = cleanLang(book.meta.language)
  const coverImg = book.cover && !startsWithPicture(book) ? `<p class="cover"><img src="data:${book.cover.type};base64,${b64(book.cover.data)}" alt="Cover"/></p>\n` : ''
  return new Blob([`<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeXml(book.meta.title || 'Book')}</title>
${book.meta.authors.length ? `<meta name="author" content="${escapeXml(book.meta.authors.join(', '))}"/>\n` : ''}<style>
:root{color-scheme:light dark}
body{font:18px/1.6 Georgia,'Times New Roman',serif;max-width:42rem;margin:0 auto;padding:1.5rem 1rem 4rem}
img{max-width:100%;height:auto}
section.chapter{margin-top:3rem}
nav.toc ol{padding-left:1.2rem}
p.cover{text-align:center}
${css}
</style>
</head>
<body>
<header><h1>${escapeXml(book.meta.title || '')}</h1>${book.meta.authors.length ? `<p>${escapeXml(book.meta.authors.join(', '))}</p>` : ''}</header>
${coverImg}${(book.toc.length || book.chapters.length > 1) ? `<nav class="toc"><h2>Contents</h2>${tocLi(book.toc.length ? book.toc : book.chapters.map((c, i) => ({ title: c.title || `Part ${i + 1}`, ch: i })))}</nav>\n` : ''}${sections.join('\n')}
</body>
</html>
`], { type: 'text/html' })
}

// ---------- TXT ----------
function wrapText(s, width) {
  if (!width) return s
  return s.split('\n').map((line) => {
    if (line.length <= width) return line
    const words = line.split(' ')
    const out = []
    let cur = ''
    for (const w of words) {
      if (cur && (cur + ' ' + w).length > width) { out.push(cur); cur = w } else cur = cur ? `${cur} ${w}` : w
    }
    if (cur) out.push(cur)
    return out.join('\n')
  }).join('\n')
}

export function writeTxt(book, opts = {}) {
  if (book.kind === 'comic') throw fail('Comics have no text to save as TXT.', 'FORMAT')
  const parts = []
  const head = [book.meta.title, book.meta.authors.join(', ')].filter(Boolean).join('\n')
  if (head) parts.push(head)
  for (const c of book.chapters) {
    const lines = []
    for (const b of htmlToBlocks(c.body)) {
      const q = b.quote ? '    '.repeat(b.quote) : ''
      if (b.t === 'h') lines.push(`\n${wrapText(runsText(b.runs), opts.wrap)}\n`)
      else if (b.t === 'p') lines.push(wrapText(runsText(b.runs), opts.wrap).split('\n').map((l) => q + l).join('\n'))
      else if (b.t === 'li') lines.push(`${'  '.repeat(b.depth)}${b.marker === '•' ? '-' : b.marker} ${wrapText(runsText(b.runs), opts.wrap)}`)
      else if (b.t === 'pre') lines.push(b.text)
      else if (b.t === 'hr') lines.push('* * *')
      else if (b.t === 'table') lines.push(b.rows.map((r) => r.map((cell) => runsText(cell).trim()).join(' | ')).join('\n'))
      else if (b.t === 'img' && b.alt) lines.push(`[Image: ${b.alt}]`)
    }
    // list items stay together, everything else gets a blank line between
    let text = ''
    lines.forEach((l, i) => { text += (i && !(/^\s*(-|\d+\.) /.test(l) && /^\s*(-|\d+\.) /.test(lines[i - 1])) ? '\n\n' : i ? '\n' : '') + l })
    if (text.trim()) parts.push(text.trim())
  }
  const nl = opts.crlf ? '\r\n' : '\n'
  return new Blob([parts.join('\n\n\n').replace(/\n/g, nl) + nl], { type: 'text/plain;charset=utf-8' })
}

// ---------- Markdown ----------
const mdEsc = (s) => s.replace(/([\\`*_[\]<>])/g, '\\$1')
function mdRuns(runs) {
  return runs.map((r) => {
    if (r.br) return '  \n'
    let t = mdEsc(r.text)
    if (!t.trim()) return t
    const lead = t.match(/^\s*/)[0], trail = t.match(/\s*$/)[0]
    t = t.trim()
    if (r.code) t = '`' + r.text.trim().replace(/`/g, "'") + '`'
    if (r.b && r.i) t = `***${t}***`
    else if (r.b) t = `**${t}**`
    else if (r.i) t = `*${t}*`
    if (r.s) t = `~~${t}~~`
    if (r.href && /^(https?:|mailto:)/i.test(r.href)) t = `[${t}](${r.href})`
    return lead + t + trail
  }).join('')
}

/** Markdown text. opts.images: 'none' (default) | 'files' (links to images/ files, which the caller must save). */
export function writeMarkdown(book, opts = {}) {
  if (book.kind === 'comic') throw fail('Comics have no text to save as Markdown.', 'FORMAT')
  const out = []
  if (book.meta.title) out.push(`# ${mdEsc(book.meta.title)}`)
  if (book.meta.authors.length) out.push(`*${mdEsc(book.meta.authors.join(', '))}*`)
  const used = new Set()
  book.chapters.forEach((c) => {
    for (const b of htmlToBlocks(c.body)) {
      const q = b.quote ? '> '.repeat(b.quote) : ''
      if (b.t === 'h') out.push(`${'#'.repeat(Math.min(6, b.level + (book.meta.title ? 1 : 0)))} ${mdRuns(b.runs.map((r) => ({ ...r, b: false })))}`)
      else if (b.t === 'p') out.push(mdRuns(b.runs).split('\n').map((l) => q + l).join('\n'))
      else if (b.t === 'li') out.push(`@@LI${'  '.repeat(b.depth)}${b.marker === '•' ? '-' : b.marker} ${mdRuns(b.runs)}`)
      else if (b.t === 'pre') out.push('```\n' + b.text + '\n```')
      else if (b.t === 'hr') out.push('---')
      else if (b.t === 'table') {
        const rows = b.rows.map((r) => r.map((cell) => mdRuns(cell).replace(/\|/g, '\\|').replace(/\n/g, ' ').trim()))
        const w = Math.max(...rows.map((r) => r.length))
        const line = (r) => `| ${[...r, ...Array(w - r.length).fill('')].join(' | ')} |`
        out.push([line(rows[0]), line(Array(w).fill('---')), ...rows.slice(1).map(line)].join('\n'))
      } else if (b.t === 'img' && opts.images === 'files' && book.images.has(b.src)) {
        used.add(b.src)
        out.push(`![${mdEsc(b.alt)}](${b.src})`)
      }
    }
  })
  // keep list items on consecutive lines
  const text = out.map((x, i) => (x.startsWith('@@LI') ? (out[i - 1]?.startsWith('@@LI') ? '\n' : '\n\n') + x.slice(4) : '\n\n' + x)).join('').replace(/^\n+/, '')
  return { text: text.replace(/\n{4,}/g, '\n\n\n') + '\n', images: [...used] }
}

// ---------- CBZ ----------
/** CBZ from a comic's pages (or any [{name, data}]). Pictures are stored as they are. */
export async function writeCbz(comic, onProgress) {
  const JSZip = await jszip()
  const z = new JSZip()
  const pages = comic.pages
  const pad = Math.max(3, String(pages.length).length)
  const used = new Set()
  pages.forEach((p, i) => {
    const ext = IMAGE_EXT[p.type] || (p.name.split('.').pop() || 'jpg').toLowerCase()
    let name = `${String(i + 1).padStart(pad, '0')}.${ext}`
    while (used.has(name)) name = `0${name}`
    used.add(name)
    z.file(name, p.data, { ...zipOpts, compression: 'STORE' })
  })
  const info = comic.files?.find((f) => /(^|\/)ComicInfo\.xml$/i.test(f.name))
  if (info) z.file('ComicInfo.xml', info.data, zipOpts)
  else if (comic.meta?.title) {
    z.file('ComicInfo.xml', `<?xml version="1.0" encoding="utf-8"?>\n<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n<Title>${escapeXml(comic.meta.title)}</Title>\n${comic.meta.authors?.length ? `<Writer>${escapeXml(comic.meta.authors.join(', '))}</Writer>\n` : ''}<PageCount>${pages.length}</PageCount>\n</ComicInfo>\n`, zipOpts)
  }
  return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.comicbook+zip', compression: 'STORE' }, (m) => onProgress?.(m.percent / 100, 'Packing'))
}

