// EPUB 3 writer: mimetype stored first, META-INF/container.xml, package document (OPF), navigation document, a legacy NCX for older readers,
// XHTML chapters split on H1 / H2, and pictures pulled out of data: URLs into images/. Exports buildEpub (chapters in, EPUB out) and
// htmlToEpub / textToEpub, which prepare the chapters from HTML or plain text. The `ebook` pack can import this file.
import { jszip } from '../../lib/libs.js'
import { xesc, parseHtml, parseDataUrl, normalizeImage, utf8 } from './_util.js'

const NS_XHTML = 'http://www.w3.org/1999/xhtml'
const GLOBAL_ATTRS = new Set(['id', 'class', 'lang', 'title', 'style', 'dir', 'xml:lang', 'role', 'epub:type'])
const ATTRS = { a: ['href'], img: ['src', 'alt', 'width', 'height'], td: ['colspan', 'rowspan', 'headers', 'scope'], th: ['colspan', 'rowspan', 'headers', 'scope', 'abbr'], ol: ['start', 'type', 'reversed'], li: ['value'], col: ['span'], colgroup: ['span'], blockquote: ['cite'], q: ['cite'], table: ['border'], time: ['datetime'], abbr: [], bdo: [] }
const ALLOWED_TAGS = new Set('a abbr b bdi bdo blockquote br caption cite code col colgroup dd del dfn div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark ol p pre q rp rt ruby s samp section small span strong sub sup table tbody td tfoot th thead time tr u ul var wbr aside article header footer nav main address'.split(' '))
const RENAME = { font: 'span', center: 'div', strike: 's', tt: 'code', big: 'span', acronym: 'abbr', dir: 'ul', menu: 'ul', details: 'div', summary: 'p', label: 'span', body: 'div' }
const DROP = new Set(['script', 'style', 'link', 'meta', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'svg', 'canvas', 'audio', 'video', 'source', 'noscript', 'template', 'head', 'title', 'base', 'applet', 'frame', 'frameset', 'math'])

export const DEFAULT_CSS = `body { font-family: serif; line-height: 1.5; margin: 0 5%; }
h1, h2, h3, h4, h5, h6 { font-family: sans-serif; line-height: 1.25; margin: 1.4em 0 .5em; page-break-after: avoid; }
h1 { font-size: 1.7em; } h2 { font-size: 1.4em; } h3 { font-size: 1.2em; }
p { margin: 0 0 .8em; text-align: justify; } img { max-width: 100%; height: auto; }
pre, code { font-family: monospace; } pre { white-space: pre-wrap; background: #f3f3f5; padding: .5em .7em; }
blockquote { margin: 1em 1.5em; font-style: italic; } table { border-collapse: collapse; margin: 1em 0; } td, th { border: 1px solid #999; padding: .25em .5em; } th { background: #eee; }
`

/** Make a DOM node XHTML-safe: unknown tags unwrapped, attributes whitelisted, obsolete elements renamed. */
function cleanNode(node, doc) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 8) { child.remove(); continue }
    if (child.nodeType !== 1) continue
    let tag = child.localName
    if (DROP.has(tag)) { child.remove(); continue }
    if (RENAME[tag]) {
      const el = doc.createElement(RENAME[tag])
      if (tag === 'center') el.setAttribute('style', 'text-align:center')
      if (tag === 'font') { const st = []; if (child.getAttribute('color')) st.push(`color:${child.getAttribute('color')}`); if (child.getAttribute('face')) st.push(`font-family:${child.getAttribute('face')}`); if (st.length) el.setAttribute('style', st.join(';')) }
      if (tag === 'summary') el.setAttribute('style', 'font-weight:bold')
      for (const a of [...child.attributes]) if (GLOBAL_ATTRS.has(a.name)) el.setAttribute(a.name, a.value)
      while (child.firstChild) el.append(child.firstChild)
      child.replaceWith(el)
      cleanNode(el, doc)
      continue
    }
    if (!ALLOWED_TAGS.has(tag)) { cleanNode(child, doc); while (child.firstChild) child.before(child.firstChild); child.remove(); continue }
    const allowed = new Set([...(ATTRS[tag] || []), ...GLOBAL_ATTRS])
    for (const a of [...child.attributes]) {
      if (!allowed.has(a.name) || /^on/i.test(a.name)) child.removeAttribute(a.name)
    }
    // inline styles: drop the ones that can load remote content
    if (child.hasAttribute('style')) { const s = child.getAttribute('style').replace(/url\([^)]*\)/gi, '').replace(/expression\([^)]*\)/gi, ''); child.setAttribute('style', s) }
    if (tag === 'a') { const href = child.getAttribute('href') || ''; if (/^\s*javascript:/i.test(href)) child.removeAttribute('href') }
    if (tag === 'img' && !child.hasAttribute('alt')) child.setAttribute('alt', '')
    if (tag === 'table' && child.getAttribute('border') && !/^(|1)$/.test(child.getAttribute('border'))) child.setAttribute('border', '1')
    cleanNode(child, doc)
  }
}

const textOfEl = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim()
const serializeBody = (nodes) => {
  const ser = new XMLSerializer()
  return nodes.map((n) => ser.serializeToString(n)).join('\n').replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '')
}
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/svg+xml': 'svg' }

function guessLang(text) {
  const s = text.slice(0, 4000)
  const cnt = (re) => (s.match(re) || []).length
  const han = cnt(/[가-힣]/g), kana = cnt(/[぀-ヿ]/g), cjk = cnt(/[一-鿿]/g), cyr = cnt(/[Ѐ-ӿ]/g), arab = cnt(/[؀-ۿ]/g), deva = cnt(/[ऀ-ॿ]/g)
  const n = Math.max(1, s.replace(/\s/g, '').length)
  if (han / n > 0.15) return 'ko'
  if (kana / n > 0.1) return 'ja'
  if (cjk / n > 0.2) return 'zh'
  if (cyr / n > 0.3) return 'ru'
  if (arab / n > 0.3) return 'ar'
  if (deva / n > 0.3) return 'hi'
  return 'en'
}

/**
 * Prepare chapters from an HTML string: sanitize to XHTML, pull data: images out, split on headings.
 * -> {chapters: [{title, level, body}], images: [{name, bytes, mime}], title, lang}
 */
export async function htmlToChapters(html, { split = 2, title = '' } = {}) {
  const doc = parseHtml(html)
  const docTitle = title || doc.title || ''
  const body = doc.body
  cleanNode(body, doc)
  // images: data URLs -> files
  const images = []
  const seen = new Map()
  for (const img of [...body.querySelectorAll('img')]) {
    const d = parseDataUrl(img.getAttribute('src') || '')
    if (!d) { img.replaceWith(doc.createTextNode(img.getAttribute('alt') ? `[${img.getAttribute('alt')}]` : '')); continue }
    let { bytes, mime } = d
    if (!EXT[mime]) {
      const n = await normalizeImage(bytes, mime)
      if (!n) { img.remove(); continue }
      bytes = n.bytes; mime = n.mime
    }
    const key = `${mime}:${bytes.length}:${bytes[bytes.length >> 1]}:${bytes[7]}`
    let name = seen.get(key)
    if (!name) { name = `images/image${images.length + 1}.${EXT[mime] || 'png'}`; seen.set(key, name); images.push({ name, bytes, mime }) }
    img.setAttribute('src', name)
  }
  // flatten wrappers so headings sit at the top level
  const hasHeading = (el) => !!el.querySelector('h1, h2')
  const flat = []
  const flatten = (parent) => {
    for (const n of [...parent.childNodes]) {
      if (n.nodeType === 1 && /^(div|section|article|main|header|footer|aside|nav)$/.test(n.localName) && hasHeading(n)) flatten(n)
      else if (n.nodeType === 3 && !n.data.trim()) continue
      else flat.push(n)
    }
  }
  flatten(body)
  const lvl = (n) => (n.nodeType === 1 && /^h[12]$/.test(n.localName) && (split === 2 || n.localName === 'h1') ? +n.localName[1] : 0)
  const chapters = []
  let cur = null
  const push = () => { if (cur && (cur.nodes.length)) chapters.push(cur); cur = null }
  const hasText = (nodes) => nodes.some((n) => (n.nodeType === 1 ? (n.textContent.trim() || n.querySelector('img')) : n.data?.trim()))
  for (const n of flat) {
    const l = split ? lvl(n) : 0
    if (l) { if (cur && !hasText(cur.nodes) && !cur.title) cur = null; push(); cur = { title: textOfEl(n) || `Section ${chapters.length + 1}`, level: l, nodes: [n] } }
    else { if (!cur) cur = { title: '', level: 1, nodes: [] }; cur.nodes.push(n) }
  }
  if (cur && hasText(cur.nodes)) chapters.push(cur)
  if (!chapters.length) chapters.push({ title: docTitle || 'Document', level: 1, nodes: [] })
  chapters.forEach((c, i) => { if (!c.title) c.title = i === 0 ? docTitle || 'Start' : `Part ${i + 1}` })
  const allText = body.textContent || ''
  return { chapters: chapters.map((c) => ({ title: c.title, level: c.level, body: serializeBody(c.nodes) })), images, title: docTitle, lang: guessLang(allText) }
}

/** Plain text -> chapters (blank-line paragraphs, headings recognised by "Chapter N" style lines). */
export function textToChapters(text, { title = '' } = {}) {
  const esc = xesc
  const paras = text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const headRe = /^(chapter|part|book|section|prologue|epilogue|preface|introduction|第.{1,6}[章節部編]|제\s*\d+\s*[장절편화부])(?![A-Za-z0-9]).{0,80}$/i
  const chapters = []
  let cur = { title: title || 'Text', level: 1, parts: [] }
  for (const p of paras) {
    const oneLine = !p.includes('\n')
    if (oneLine && p.length < 90 && headRe.test(p)) { if (cur.parts.length || chapters.length) chapters.push(cur); cur = { title: p, level: 1, parts: [`<h1>${esc(p)}</h1>`] }; continue }
    cur.parts.push(`<p>${esc(p).replace(/\n/g, ' ')}</p>`)
  }
  chapters.push(cur)
  return { chapters: chapters.filter((c) => c.parts.length).map((c) => ({ title: c.title, level: 1, body: c.parts.join('\n') })), images: [], title, lang: guessLang(text) }
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => ((Math.random() * 16) | 0).toString(16)))
const isoNow = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z')

/**
 * Build the EPUB. chapters: [{title, level (1 or 2), body: XHTML fragment}], images: [{name: 'images/x.png', bytes, mime}].
 * -> Uint8Array
 */
export async function buildEpub({ title = 'Untitled', author = '', lang = 'en', identifier = '', chapters, images = [], css = DEFAULT_CSS, description = '' }) {
  const JSZip = await jszip()
  const zip = new JSZip()
  const opt = { createFolders: false }
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE', ...opt })
  zip.file('META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>', opt)
  const id = identifier || `urn:uuid:${uuid()}`
  const files = chapters.map((c, i) => ({ ...c, file: `text/chapter${String(i + 1).padStart(3, '0')}.xhtml`, id: `ch${i + 1}` }))
  const page = (t, body) => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="${NS_XHTML}" xmlns:epub="http://www.idpf.org/2007/ops" lang="${xesc(lang)}" xml:lang="${xesc(lang)}"><head><meta charset="utf-8"/><title>${xesc(t)}</title><link rel="stylesheet" type="text/css" href="../style.css"/></head><body>\n${body}\n</body></html>\n`
  for (const f of files) zip.file(`OEBPS/${f.file}`, page(f.title, f.body || `<h1>${xesc(f.title)}</h1>`), opt)
  zip.file('OEBPS/style.css', css, opt)
  for (const im of images) zip.file(`OEBPS/${im.name}`, im.bytes, opt)
  // navigation document (nested: level 2 under the previous level 1)
  const navItems = []
  for (const f of files) { if (f.level >= 2 && navItems.length) navItems[navItems.length - 1].kids.push(f); else navItems.push({ ...f, kids: [] }) }
  const navLi = (n) => `<li><a href="${n.file}">${xesc(n.title)}</a>${n.kids?.length ? `<ol>${n.kids.map(navLi).join('')}</ol>` : ''}</li>`
  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="${NS_XHTML}" xmlns:epub="http://www.idpf.org/2007/ops" lang="${xesc(lang)}" xml:lang="${xesc(lang)}"><head><meta charset="utf-8"/><title>${xesc(title)}</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${navItems.map(navLi).join('')}</ol></nav></body></html>\n`, opt)
  // legacy NCX
  let order = 0
  const ncxPoint = (n) => `<navPoint id="np${++order}" playOrder="${order}"><navLabel><text>${xesc(n.title)}</text></navLabel><content src="${n.file}"/>${(n.kids || []).map(ncxPoint).join('')}</navPoint>`
  zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${xesc(id)}"/><meta name="dtb:depth" content="${navItems.some((n) => n.kids.length) ? 2 : 1}"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head><docTitle><text>${xesc(title)}</text></docTitle><navMap>${navItems.map(ncxPoint).join('')}</navMap></ncx>\n`, opt)
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    ...files.map((f) => `<item id="${f.id}" href="${f.file}" media-type="application/xhtml+xml"/>`),
    ...images.map((im, i) => `<item id="img${i + 1}" href="${im.name}" media-type="${im.mime}"/>`),
  ]
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${xesc(lang)}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${xesc(id)}</dc:identifier><dc:title>${xesc(title)}</dc:title><dc:language>${xesc(lang)}</dc:language>${author ? `<dc:creator>${xesc(author)}</dc:creator>` : ''}${description ? `<dc:description>${xesc(description)}</dc:description>` : ''}<meta property="dcterms:modified">${isoNow()}</meta></metadata><manifest>${manifest.join('')}</manifest><spine toc="ncx">${files.map((f) => `<itemref idref="${f.id}"/>`).join('')}</spine></package>\n`, opt)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/epub+zip' })
}

/** HTML -> EPUB. options: {title, author, lang, split: 0 | 1 | 2 (split on H1 only / H1 and H2), css} */
export async function htmlToEpub(html, { title = '', author = '', lang = '', split = 2, css } = {}) {
  const r = await htmlToChapters(html, { split, title })
  return buildEpub({ title: title || r.title || 'Untitled', author, lang: lang || r.lang, chapters: r.chapters, images: r.images, css })
}
/** Plain text -> EPUB. */
export async function textToEpub(text, { title = 'Untitled', author = '', lang = '', css } = {}) {
  const r = textToChapters(text, { title })
  return buildEpub({ title, author, lang: lang || r.lang, chapters: r.chapters, images: [], css })
}
void utf8
