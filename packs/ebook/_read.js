// Readers: EPUB (2 and 3, KEPUB), FB2 (and FB2.ZIP), HTMLZ, TXTZ, comic archives (CBZ, CBR, CB7) -> Book. MOBI, AZW3 and PDB live in _mobi.js.
// Everything runs locally. Libraries load lazily inside the functions.
import { jszip } from '../../lib/libs.js'
import {
  newBook, fail, drmError, extOf, typeOfName, isImageName, naturalCompare, resolvePath, isExternal, addImage, sniffImage, fromBytes, escapeXml,
  parseXhtmlOrHtml, parseHtml, innerXhtml, stripActive, unwrap, svgToImg, splitByHeadings, splitTextChapters, titleChapters, ensureToc,
} from './_book.js'

export const READ_EXTS = ['epub', 'kepub', 'mobi', 'azw', 'azw3', 'azw4', 'prc', 'pdb', 'fb2', 'fbz', 'htmlz', 'txtz', 'cbz', 'cbr', 'cb7', 'zip']
export const COMIC_EXTS = ['cbz', 'cbr', 'cb7']
const yieldNow = () => new Promise((r) => setTimeout(r, 0))

/** Work out the format from the first bytes and the name: epub, mobi, pdb, fb2, htmlz, txtz, comic, or null. */
export async function sniffFormat(file) {
  const head = new Uint8Array(await file.slice(0, 80).arrayBuffer())
  const ascii = (a, b) => String.fromCharCode(...head.subarray(a, b))
  const name = file.name.toLowerCase()
  if (ascii(60, 68) === 'BOOKMOBI') return 'mobi'
  if (ascii(60, 68) === 'TEXtREAd') return 'pdb'
  if (ascii(0, 4) === 'Rar!') return 'comic'
  if (head[0] === 0x37 && head[1] === 0x7a && head[2] === 0xbc && head[3] === 0xaf) return 'comic'
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const JSZip = await jszip()
    let zip
    try { zip = await JSZip.loadAsync(file) } catch { throw fail('This file looks like a ZIP but could not be opened. It may be damaged.', 'BAD') }
    const names = Object.keys(zip.files)
    if (zip.file('META-INF/container.xml') || zip.file('mimetype')) return 'epub'
    if (names.some((n) => /\.fb2$/i.test(n))) return 'fb2zip'
    if (names.some((n) => /(^|\/)index\.html?$/i.test(n))) return 'htmlz'
    if (names.some((n) => /(^|\/)index\.txt$/i.test(n))) return 'txtz'
    if (names.some((n) => isImageName(n))) return 'comic'
    return null
  }
  const text = fromBytes(head).trimStart()
  if (/^<\?xml|^<FictionBook/i.test(text)) return 'fb2'
  const e = extOf(name)
  if (['mobi', 'azw', 'azw3', 'azw4', 'prc'].includes(e)) return 'mobi'
  if (e === 'pdb') return 'pdb'
  if (e === 'fb2') return 'fb2'
  return null
}

/** Read any supported e-book into a Book. */
export async function readBook(file, { onProgress } = {}) {
  const fmt = await sniffFormat(file)
  let book
  if (fmt === 'epub') book = await readEpub(file, onProgress)
  else if (fmt === 'mobi' || fmt === 'pdb') book = await (await import('./_mobi.js')).readMobi(file, onProgress)
  else if (fmt === 'fb2') book = await readFb2(fromBytesAuto(new Uint8Array(await file.arrayBuffer())))
  else if (fmt === 'fb2zip') book = await readFb2Zip(file)
  else if (fmt === 'htmlz') book = await readHtmlz(file)
  else if (fmt === 'txtz') book = await readTxtz(file)
  else if (fmt === 'comic') book = await readComic(file, onProgress)
  else throw fail('This file is not a supported e-book. Supported: EPUB, KEPUB, MOBI, AZW, AZW3, FB2, FB2.ZIP, HTMLZ, TXTZ, PDB, CBZ, CBR and CB7.', 'FORMAT')
  book.format = fmt === 'fb2zip' ? 'fb2' : fmt
  book.sourceName = file.name
  if (book.kind === 'reflow') {
    if (!book.chapters.length) throw fail('No readable text was found in this book.', 'EMPTY')
    titleChapters(book)
    ensureToc(book)
  } else if (!book.pages.length) throw fail('No pictures were found in this comic archive.', 'EMPTY')
  return book
}

// ---------- shared ----------
function tagsOf(root, name) { return [...root.getElementsByTagNameNS('*', name)] }
const first = (root, name) => tagsOf(root, name)[0] || null
const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '')

/** Decode text bytes, honouring a BOM or an XML encoding declaration. */
export function fromBytesAuto(b) {
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return fromBytes(b.subarray(3))
  if (b[0] === 0xff && b[1] === 0xfe) return fromBytes(b, 'utf-16le')
  if (b[0] === 0xfe && b[1] === 0xff) return fromBytes(b, 'utf-16be')
  const head = String.fromCharCode(...b.subarray(0, 200))
  const enc = head.match(/encoding\s*=\s*["']([\w-]+)["']/i)?.[1]
  return fromBytes(b, enc || 'utf-8')
}

// ---------- EPUB ----------
const FONT_ALGOS = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'])

async function readEpub(file, onProgress) {
  const JSZip = await jszip()
  let zip
  try { zip = await JSZip.loadAsync(file) } catch { throw fail('This EPUB could not be opened. It may be damaged.', 'BAD') }
  const lower = new Map(Object.keys(zip.files).map((n) => [n.toLowerCase(), n]))
  const entry = (p) => zip.file(p) || zip.file(lower.get(p.toLowerCase()) || '\u0000')
  const readText = async (p) => { const e = entry(p); return e ? fromBytesAuto(await e.async('uint8array')) : null }

  const encXml = await readText('META-INF/encryption.xml')
  if (encXml) {
    const algos = [...encXml.matchAll(/Algorithm\s*=\s*"([^"]+)"/g)].map((m) => m[1])
    if (algos.some((a) => !FONT_ALGOS.has(a))) throw drmError('EPUB')
  }
  const rights = await readText('META-INF/rights.xml')
  if (rights && /adept|license|encryptedKey/i.test(rights)) throw drmError('EPUB')

  const container = await readText('META-INF/container.xml')
  let opfPath = container && container.match(/full-path\s*=\s*"([^"]+)"/)?.[1]
  if (!opfPath) opfPath = [...lower.values()].find((n) => /\.opf$/i.test(n))
  if (!opfPath) throw fail('This EPUB has no package file (OPF), so it cannot be read.', 'BAD')
  const opfText = await readText(opfPath)
  if (!opfText) throw fail('This EPUB has no package file (OPF), so it cannot be read.', 'BAD')
  const opf = new DOMParser().parseFromString(opfText, 'application/xml')
  if (opf.querySelector('parsererror')) throw fail('The package file (OPF) of this EPUB is damaged.', 'BAD')

  const book = newBook('reflow')
  const m = book.meta
  const meta = first(opf, 'metadata')
  const dc = (n) => (meta ? tagsOf(meta, n) : [])
  m.title = txt(dc('title')[0])
  m.authors = dc('creator').map(txt).filter(Boolean)
  m.language = txt(dc('language')[0])
  m.publisher = txt(dc('publisher')[0])
  m.description = txt(dc('description')[0])
  m.date = txt(dc('date')[0])
  m.identifier = txt(dc('identifier')[0])

  const manifest = new Map()
  for (const it of tagsOf(opf, 'item')) {
    const href = it.getAttribute('href')
    if (!href) continue
    manifest.set(it.getAttribute('id'), { id: it.getAttribute('id'), path: resolvePath(opfPath, href), type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || '' })
  }
  const spineEl = first(opf, 'spine')
  const spineIds = tagsOf(opf, 'itemref').map((r) => r.getAttribute('idref')).filter((id) => manifest.has(id))
  const spine = spineIds.map((id) => manifest.get(id))
  if (!spine.length) throw fail('This EPUB lists no chapters.', 'BAD')

  // cover
  let coverItem = null
  const coverId = tagsOf(opf, 'meta').find((x) => x.getAttribute('name') === 'cover')?.getAttribute('content')
  if (coverId && manifest.has(coverId)) coverItem = manifest.get(coverId)
  coverItem ||= [...manifest.values()].find((i) => /\bcover-image\b/.test(i.props))
  if (coverItem && !coverItem.type.startsWith('image/') && !typeOfName(coverItem.path)) coverItem = null
  if (coverItem) {
    const e = entry(coverItem.path)
    if (e) { const data = await e.async('uint8array'); book.cover = { data, type: sniffImage(data) || coverItem.type || typeOfName(coverItem.path) } }
  }

  // shared state for resolving resources
  const imgByPath = new Map()
  const imageFor = async (path) => {
    if (imgByPath.has(path)) return imgByPath.get(path)
    const e = entry(path)
    let name = null
    if (e) {
      const data = await e.async('uint8array')
      const type = sniffImage(data) || typeOfName(path)
      if (type) name = addImage(book, data, type, path)
    }
    imgByPath.set(path, name)
    return name
  }
  const spineIndex = new Map(spine.map((s, i) => [s.path, i]))
  const cssSeen = new Set()
  const cssParts = []
  const addCss = async (cssText, cssPath) => {
    const urls = [...cssText.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)]
    let out = cssText.replace(/@font-face\s*\{[^}]*\}/gi, '').replace(/@import[^;]+;/gi, '').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const u of urls) {
      const href = u[2]
      if (/^data:/i.test(href)) continue
      const name = isExternal(href) ? null : await imageFor(resolvePath(cssPath, href))
      out = out.split(u[0]).join(name ? `url(${name})` : 'url()')
    }
    cssParts.push(out.trim())
  }

  const rewriteBody = async (body, docPath) => {
    for (const el of body.querySelectorAll('span.koboSpan')) unwrap(el)
    for (const el of body.querySelectorAll('#book-inner, #book-columns')) unwrap(el)
    svgToImg(body)
    stripActive(body)
    for (const img of [...body.querySelectorAll('img')]) {
      const src = img.getAttribute('src')
      const name = src && !isExternal(src) && !/^data:/i.test(src) ? await imageFor(resolvePath(docPath, src)) : null
      if (/^data:image\//i.test(src || '')) { /* keep inline images */ }
      else if (name) img.setAttribute('src', name)
      else img.remove()
      img.removeAttribute('srcset')
      img.removeAttribute('sizes')
    }
    for (const a of body.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href')
      if (!href || href.startsWith('#') || isExternal(href)) continue
      const target = resolvePath(docPath, href)
      const idx = spineIndex.get(target)
      const frag = href.includes('#') ? href.slice(href.indexOf('#')) : ''
      if (idx != null) a.setAttribute('href', `chapter-${idx + 1}.xhtml${frag}`)
      else a.removeAttribute('href')
    }
    for (const el of body.querySelectorAll('*')) {
      for (const at of [...el.attributes]) if (/^epub:|^xmlns:/i.test(at.name)) el.removeAttribute(at.name)
    }
  }

  for (let i = 0; i < spine.length; i++) {
    const item = spine[i]
    onProgress?.(i / spine.length, 'Reading chapters')
    if (i % 8 === 7) await yieldNow()
    const e = entry(item.path)
    if (!e) { book.chapters.push({ title: '', body: '<p></p>' }); continue }
    if (item.type.startsWith('image/')) {
      const name = await imageFor(item.path)
      book.chapters.push({ title: '', body: name ? `<div><img src="${escapeXml(name)}" alt=""/></div>` : '<p></p>' })
      continue
    }
    const raw = fromBytesAuto(await e.async('uint8array'))
    const doc = parseXhtmlOrHtml(raw)
    const head = doc.head
    if (head) {
      for (const node of head.children) {
        const ln = node.localName.toLowerCase()
        if (ln === 'link' && /stylesheet/i.test(node.getAttribute('rel') || '') && node.getAttribute('href') && !isExternal(node.getAttribute('href'))) {
          const p = resolvePath(item.path, node.getAttribute('href'))
          if (!cssSeen.has(p)) { cssSeen.add(p); const t = await readText(p); if (t) await addCss(t, p) }
        } else if (ln === 'style' && !(node.getAttribute('type') && !/css/i.test(node.getAttribute('type')))) await addCss(node.textContent, item.path)
      }
    }
    const body = doc.body
    if (!body) { book.chapters.push({ title: '', body: '<p></p>' }); continue }
    await rewriteBody(body, item.path)
    book.chapters.push({ title: '', body: innerXhtml(body).trim() || '<p></p>' })
  }
  book.css = cssParts.filter(Boolean).join('\n')
  onProgress?.(1, 'Reading chapters')

  // table of contents: EPUB 3 nav document, else NCX
  const navItem = [...manifest.values()].find((i) => /\bnav\b/.test(i.props))
  const ncxItem = (spineEl && manifest.get(spineEl.getAttribute('toc'))) || [...manifest.values()].find((i) => /dtbncx/.test(i.type) || /\.ncx$/i.test(i.path))
  const mapTarget = (tocPath, src) => {
    const p = resolvePath(tocPath, src)
    const idx = spineIndex.get(p)
    return idx == null ? null : { ch: idx, frag: src.includes('#') ? src.slice(src.indexOf('#') + 1) : '' }
  }
  try {
    if (navItem && entry(navItem.path)) {
      const doc = parseXhtmlOrHtml(await readText(navItem.path))
      const navs = [...doc.getElementsByTagName('nav')]
      const nav = navs.find((n) => /\btoc\b/.test(n.getAttribute('epub:type') || n.getAttribute('type') || '')) || navs[0]
      const walk = (ol) => [...(ol?.children || [])].filter((li) => li.localName === 'li').map((li) => {
        const a = [...li.children].find((c) => c.localName === 'a' || c.localName === 'span')
        const sub = [...li.children].find((c) => c.localName === 'ol')
        const t = a ? a.textContent.replace(/\s+/g, ' ').trim() : ''
        const tgt = a?.localName === 'a' && a.getAttribute('href') ? mapTarget(navItem.path, a.getAttribute('href')) : null
        return { title: t, ...(tgt || {}), children: walk(sub) }
      })
      if (nav) book.toc = walk([...nav.children].find((c) => c.localName === 'ol'))
    }
    if (!flatCount(book.toc) && ncxItem && entry(ncxItem.path)) {
      const doc = new DOMParser().parseFromString(await readText(ncxItem.path), 'application/xml')
      const walk = (parent) => [...parent.children].filter((c) => c.localName === 'navPoint').map((np) => {
        const label = txt(first(first(np, 'navLabel') || np, 'text'))
        const content = [...np.children].find((c) => c.localName === 'content')
        const tgt = content?.getAttribute('src') ? mapTarget(ncxItem.path, content.getAttribute('src')) : null
        return { title: label, ...(tgt || {}), children: walk(np) }
      })
      const map = first(doc, 'navMap')
      if (map) book.toc = walk(map)
    }
  } catch (e) { book.warnings.push('The table of contents could not be read.') }
  book.toc = cleanToc(book.toc)
  // chapter titles from the TOC
  const walkTitles = (list) => { for (const t of list) { if (t.ch != null && !t.frag && !book.chapters[t.ch].title) book.chapters[t.ch].title = t.title; walkTitles(t.children) } }
  walkTitles(book.toc)

  if (!book.cover) {
    const firstCh = book.chapters[0]?.body || ''
    const only = firstCh.match(/^\s*(?:<div[^>]*>\s*|<p[^>]*>\s*)?<img[^>]*src="([^"]+)"[^>]*\/?>\s*(?:<\/(?:div|p)>\s*)?$/i)
    if (only && book.images.has(only[1])) { const im = book.images.get(only[1]); book.cover = { data: im.data, type: im.type } }
  }
  if (!m.title) m.title = file.name.replace(/\.[^.]+$/, '')
  return book
}
const flatCount = (t) => t.reduce((n, x) => n + 1 + flatCount(x.children || []), 0)
/** Drop entries that point nowhere and have no children; keep nested ones. */
function cleanToc(list) {
  const out = []
  for (const t of list) {
    const children = cleanToc(t.children || [])
    if (!t.title && !children.length) continue
    if (t.ch == null && !children.length) continue
    out.push({ title: t.title, ch: t.ch ?? children[0]?.ch ?? 0, frag: t.ch == null ? '' : t.frag || '', children })
  }
  return out
}

// ---------- FB2 ----------
const XLINK = 'http://www.w3.org/1999/xlink'
const hrefOf = (el) => el.getAttributeNS(XLINK, 'href') || el.getAttribute('l:href') || el.getAttribute('xlink:href') || el.getAttribute('href') || ''

async function readFb2Zip(file) {
  const JSZip = await jszip()
  const zip = await JSZip.loadAsync(file)
  const name = Object.keys(zip.files).find((n) => /\.fb2$/i.test(n))
  if (!name) throw fail('No .fb2 file was found inside this ZIP.', 'BAD')
  return readFb2(fromBytesAuto(await zip.file(name).async('uint8array')))
}

export async function readFb2(xml) {
  const doc = new DOMParser().parseFromString(xml.replace(/^\ufeff/, ''), 'application/xml')
  if (doc.querySelector('parsererror') || !first(doc, 'FictionBook')) throw fail('This FB2 file is damaged or not a FictionBook document.', 'BAD')
  const book = newBook('reflow')
  const info = first(doc, 'title-info')
  if (info) {
    book.meta.title = txt(first(info, 'book-title'))
    book.meta.authors = tagsOf(info, 'author').map((a) => ['first-name', 'middle-name', 'last-name'].map((n) => txt(first(a, n))).filter(Boolean).join(' ') || txt(first(a, 'nickname'))).filter(Boolean)
    book.meta.language = txt(first(info, 'lang'))
    book.meta.date = txt(first(info, 'date'))
    const ann = first(info, 'annotation')
    book.meta.description = ann ? txt(ann) : ''
  }
  const pub = first(doc, 'publish-info')
  if (pub) book.meta.publisher = txt(first(pub, 'publisher'))
  book.meta.identifier = txt(first(first(doc, 'document-info') || doc, 'id'))

  // pictures
  const bin = new Map()
  for (const b of tagsOf(doc, 'binary')) {
    const id = b.getAttribute('id')
    if (!id) continue
    try {
      const s = atob(b.textContent.replace(/\s+/g, ''))
      const data = new Uint8Array(s.length)
      for (let i = 0; i < s.length; i++) data[i] = s.charCodeAt(i)
      bin.set(id, { data, type: b.getAttribute('content-type') || '' })
    } catch { /* skip a bad picture */ }
  }
  const imgNames = new Map()
  const imageFor = (id) => {
    if (imgNames.has(id)) return imgNames.get(id)
    const b = bin.get(id)
    const name = b && b.data.length ? addImage(book, b.data, b.type || typeOfName(id), id) : null
    imgNames.set(id, name)
    return name
  }
  const cover = first(first(info || doc, 'coverpage') || doc, 'image')
  if (cover) { const id = hrefOf(cover).replace(/^#/, ''); const b = bin.get(id); if (b) book.cover = { data: b.data, type: sniffImage(b.data) || b.type } }

  const inline = (node) => {
    let out = ''
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { out += escapeXml(c.nodeValue); continue }
      if (c.nodeType !== 1) continue
      const n = c.localName
      const inner = () => inline(c)
      if (n === 'emphasis') out += `<em>${inner()}</em>`
      else if (n === 'strong') out += `<strong>${inner()}</strong>`
      else if (n === 'strikethrough') out += `<del>${inner()}</del>`
      else if (n === 'sub' || n === 'sup' || n === 'code') out += `<${n}>${inner()}</${n}>`
      else if (n === 'a') { const h = hrefOf(c); out += `<a href="${escapeXml(h)}">${inner()}</a>` }
      else if (n === 'image') { const name = imageFor(hrefOf(c).replace(/^#/, '')); if (name) out += `<img src="${name}" alt=""/>` }
      else out += inner()
    }
    return out
  }
  const idAttr = (el) => (el.getAttribute('id') ? ` id="${escapeXml(el.getAttribute('id'))}"` : '')
  const blocks = (parent) => {
    let out = ''
    for (const c of parent.children) {
      const n = c.localName
      if (n === 'p') out += `<p${idAttr(c)}>${inline(c)}</p>\n`
      else if (n === 'empty-line') out += '<p class="empty">&#160;</p>\n'
      else if (n === 'subtitle') out += `<h4${idAttr(c)}>${inline(c)}</h4>\n`
      else if (n === 'text-author') out += `<p class="text-author">${inline(c)}</p>\n`
      else if (n === 'epigraph') out += `<blockquote class="epigraph">${blocks(c)}</blockquote>\n`
      else if (n === 'cite') out += `<blockquote${idAttr(c)}>${blocks(c)}</blockquote>\n`
      else if (n === 'annotation') out += `<div class="annotation">${blocks(c)}</div>\n`
      else if (n === 'poem') out += `<div class="poem">${poem(c)}</div>\n`
      else if (n === 'image') { const name = imageFor(hrefOf(c).replace(/^#/, '')); if (name) out += `<div class="image"><img src="${name}" alt=""/></div>\n` }
      else if (n === 'table') out += `<table>${[...c.getElementsByTagNameNS('*', 'tr')].map((tr) => `<tr>${[...tr.children].map((td) => `<${td.localName === 'th' ? 'th' : 'td'}>${inline(td)}</${td.localName === 'th' ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</table>\n`
      else if (n === 'title') { /* handled by the section */ }
      else if (n === 'section') { /* handled by the walker */ }
    }
    return out
  }
  const poem = (p) => {
    let out = ''
    for (const c of p.children) {
      if (c.localName === 'title') out += `<h4>${inline(c)}</h4>`
      else if (c.localName === 'epigraph') out += `<blockquote class="epigraph">${blocks(c)}</blockquote>`
      else if (c.localName === 'stanza') out += `<div class="stanza">${[...c.children].map((v) => (v.localName === 'v' ? `<p class="v">${inline(v)}</p>` : v.localName === 'title' ? `<h5>${inline(v)}</h5>` : '')).join('')}</div>`
      else if (c.localName === 'text-author') out += `<p class="text-author">${inline(c)}</p>`
      else if (c.localName === 'date') out += `<p class="date">${inline(c)}</p>`
    }
    return out
  }

  const bodies = tagsOf(doc, 'body')
  const toc = []
  const emit = (title, level, section, tocList) => {
    const own = section ? blocks(section) : ''
    const heading = title ? `<h${Math.min(level, 6)}${section ? idAttr(section) : ''}>${escapeXml(title)}</h${Math.min(level, 6)}>\n` : ''
    const idx = book.chapters.length
    book.chapters.push({ title, body: `${heading}${own}`.trim() || '<p></p>' })
    const entry = { title, ch: idx, children: [] }
    tocList.push(entry)
    return entry
  }
  const walk = (section, level, tocList) => {
    const titleEl = [...section.children].find((c) => c.localName === 'title')
    const title = titleEl ? txt(titleEl) : ''
    const subs = [...section.children].filter((c) => c.localName === 'section')
    const ownContent = [...section.children].some((c) => !['title', 'section'].includes(c.localName))
    if (!subs.length) { emit(title, level, section, tocList); return }
    const holder = ownContent || title ? emit(title, level, section, tocList) : { children: tocList }
    for (const s of subs) walk(s, level + 1, holder.children)
  }
  let mainDone = false
  for (const b of bodies) {
    const name = b.getAttribute('name') || ''
    const isNotes = /note|comment/i.test(name)
    const titleEl = [...b.children].find((c) => c.localName === 'title')
    const sections = [...b.children].filter((c) => c.localName === 'section')
    if (isNotes) {
      const parts = sections.map((s) => `<div${idAttr(s)}>${[...s.children].filter((c) => c.localName === 'title').map((t) => `<p><strong>${escapeXml(txt(t))}</strong></p>`).join('')}${blocks(s)}</div>`).join('\n')
      const idx = book.chapters.length
      book.chapters.push({ title: 'Notes', body: `<h2>${escapeXml(titleEl ? txt(titleEl) : 'Notes')}</h2>\n${parts}` })
      toc.push({ title: 'Notes', ch: idx, children: [] })
      continue
    }
    if (!mainDone && titleEl) emit(txt(titleEl), 1, null, toc)
    mainDone = true
    for (const s of sections) walk(s, 1, toc)
    if (!sections.length) emit('', 1, b, toc)
  }
  // inter-chapter links: #id -> chapter-N.xhtml#id
  const owner = new Map()
  book.chapters.forEach((c, i) => { for (const m of c.body.matchAll(/\sid="([^"]+)"/g)) if (!owner.has(m[1])) owner.set(m[1], i) })
  book.chapters.forEach((c, i) => {
    c.body = c.body.replace(/href="#([^"]+)"/g, (all, id) => (owner.has(id) && owner.get(id) !== i ? `href="chapter-${owner.get(id) + 1}.xhtml#${id}"` : all))
  })
  book.toc = toc.filter((t) => t.title || t.children.length)
  if (!book.meta.title) book.meta.title = 'Untitled'
  book.css = 'blockquote.epigraph{margin:1em 2em;font-style:italic}p.text-author{text-align:right;font-style:italic}p.v{margin:0}div.stanza{margin:1em 0 1em 1.5em}p.empty{margin:0}div.image{text-align:center}'
  return book
}

// ---------- HTMLZ and TXTZ ----------
async function readMetaOpf(zip, book) {
  const e = zip.file(/(^|\/)metadata\.opf$/i)[0]
  if (!e) return
  const opf = new DOMParser().parseFromString(await e.async('string'), 'application/xml')
  if (opf.querySelector('parsererror')) return
  const m = book.meta
  m.title ||= txt(first(opf, 'title'))
  if (!m.authors.length) m.authors = tagsOf(opf, 'creator').map(txt).filter(Boolean)
  m.language ||= txt(first(opf, 'language'))
  m.publisher ||= txt(first(opf, 'publisher'))
  m.description ||= txt(first(opf, 'description'))
}
async function readHtmlz(file) {
  const JSZip = await jszip()
  const zip = await JSZip.loadAsync(file)
  const idx = zip.file(/(^|\/)index\.html?$/i)[0] || zip.file(/\.html?$/i)[0]
  if (!idx) throw fail('No index.html was found inside this HTMLZ file.', 'BAD')
  const book = newBook('reflow')
  const doc = parseHtml(fromBytesAuto(await idx.async('uint8array')))
  const base = idx.name
  const cssParts = []
  for (const s of doc.querySelectorAll('style')) cssParts.push(s.textContent)
  for (const l of doc.querySelectorAll('link[rel~=stylesheet]')) {
    const f = zip.file(resolvePath(base, l.getAttribute('href') || ''))
    if (f) cssParts.push(await f.async('string'))
  }
  book.css = cssParts.join('\n').replace(/@font-face\s*\{[^}]*\}/gi, '').replace(/@import[^;]+;/gi, '').replace(/url\([^)]*\)/g, 'url()')
  const cache = new Map()
  for (const img of [...doc.body.querySelectorAll('img')]) {
    const src = img.getAttribute('src') || ''
    const path = resolvePath(base, src)
    if (!cache.has(path)) {
      const f = zip.file(path)
      const data = f && !isExternal(src) ? await f.async('uint8array') : null
      cache.set(path, data && (sniffImage(data) || typeOfName(path)) ? addImage(book, data, sniffImage(data) || typeOfName(path), path) : null)
    }
    if (cache.get(path)) img.setAttribute('src', cache.get(path))
    else img.remove()
  }
  for (const a of doc.body.querySelectorAll('a[href]')) if (isExternal(a.getAttribute('href')) === false && !a.getAttribute('href').startsWith('#')) a.removeAttribute('href')
  stripActive(doc.body)
  book.meta.title = txt(doc.querySelector('title')) || ''
  const parts = splitByHeadings(innerXhtml(doc.body))
  for (const p of parts) book.chapters.push({ title: p.title, body: p.body })
  await readMetaOpf(zip, book)
  const cover = zip.file(/(^|\/)cover\.(jpe?g|png|gif)$/i)[0]
  if (cover) { const data = await cover.async('uint8array'); book.cover = { data, type: sniffImage(data) } }
  if (!book.meta.title) book.meta.title = file.name.replace(/\.[^.]+$/, '')
  return book
}
async function readTxtz(file) {
  const JSZip = await jszip()
  const zip = await JSZip.loadAsync(file)
  const idx = zip.file(/(^|\/)index\.txt$/i)[0] || zip.file(/\.txt$/i)[0]
  if (!idx) throw fail('No text file was found inside this TXTZ file.', 'BAD')
  const book = newBook('reflow')
  const text = fromBytesAuto(await idx.async('uint8array'))
  for (const p of splitTextChapters(text)) book.chapters.push(p)
  await readMetaOpf(zip, book)
  if (!book.meta.title) book.meta.title = file.name.replace(/\.[^.]+$/, '')
  return book
}

// ---------- comics ----------
/** Pull [{name, data}] out of a CBZ (ZIP), CBR (RAR) or CB7 (7z), whatever the file extension says. */
export async function readArchiveFiles(file, onProgress) {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const JSZip = await jszip()
    let zip
    try { zip = await JSZip.loadAsync(file) } catch { throw fail('This archive could not be opened. It may be damaged.', 'BAD') }
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir)
    const out = []
    let i = 0
    for (const n of names) {
      out.push({ name: n, data: await zip.files[n].async('uint8array') })
      onProgress?.(++i / names.length, 'Reading pages')
      if (i % 10 === 0) await yieldNow()
    }
    return out
  }
  onProgress?.(null, 'Unpacking archive')
  return (await import('./_archive.js')).extractArchive(file)
}

export async function readComic(file, onProgress) {
  const files = await readArchiveFiles(file, onProgress)
  const book = newBook('comic')
  const imgs = files.filter((f) => isImageName(f.name)).sort((a, b) => naturalCompare(a.name, b.name))
  for (const f of imgs) book.pages.push({ name: f.name, data: f.data, type: sniffImage(f.data) || typeOfName(f.name) })
  book.files = files.filter((f) => !isImageName(f.name) && !/(^|\/)(__MACOSX|Thumbs\.db|\.DS_Store)/i.test(f.name) && !/\/$/.test(f.name))
  const info = book.files.find((f) => /(^|\/)ComicInfo\.xml$/i.test(f.name))
  if (info) {
    const doc = new DOMParser().parseFromString(fromBytesAuto(info.data), 'application/xml')
    if (!doc.querySelector('parsererror')) {
      const g = (n) => txt(first(doc, n))
      book.meta.title = g('Title') || [g('Series'), g('Number') && `#${g('Number')}`].filter(Boolean).join(' ')
      book.meta.authors = [g('Writer')].filter(Boolean)
      book.meta.description = g('Summary')
      book.meta.language = g('LanguageISO')
    }
  }
  if (!book.meta.title) book.meta.title = file.name.replace(/\.[^.]+$/, '')
  if (book.pages[0]) book.cover = { data: book.pages[0].data, type: book.pages[0].type }
  return book
}

