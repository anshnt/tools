// Routes this pack can convert (see docs/TOOLS.md and the converter contract). Every route lazy-loads its libraries inside run(), so the hub can
// import this file cheaply. The user-facing tools in this pack call the same functions.
import { withExt, baseName, ext as extOf, zip as zipFiles } from '../../lib/files.js'
import { esc, u8, decodeText, file as mkFile, utf8, checkAbort, fail, mimeFor, dataUrl } from './_util.js'

// ------------------------------------------------------------------ shared helpers
const out = (data, name, type) => mkFile(data, name, type || mimeFor(extOf(name)))
const bytesOf = async (f) => u8(f)

/** Decode a text file in any encoding (detected unless `enc` names one). */
async function readText(f, enc) {
  const { toUtf8 } = await import('./_encoding.js')
  return toUtf8(await bytesOf(f), { from: enc && enc !== 'auto' ? enc : undefined }).text
}

/** Any supported document -> {blocks, title, kind}. */
export async function readBlocks(f, { onProgress, signal } = {}) {
  const e = extOf(f.name)
  const bytes = await bytesOf(f)
  const A = await import('./_ast.js')
  if (e === 'rtf') { const { rtfToBlocks } = await import('./_rtf.js'); return rtfToBlocks(bytes) }
  if (['odt', 'fodt', 'ott'].includes(e)) { const { odtToBlocks } = await import('./_odf.js'); return odtToBlocks(bytes) }
  if (['hwp', 'hwpx'].includes(e)) { const { hwpToBlocks } = await import('./_hwp.js'); return hwpToBlocks(bytes) }
  if (e === 'docx' || e === 'docm' || e === 'dotx') {
    const { mammoth } = await import('../../lib/libs.js')
    const mm = await mammoth()
    let r
    try { r = await mm.convertToHtml({ arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, { styleMap: ['u => u', 'strike => s', 'comment-reference => sup'] }) } catch (err) { throw fail('Could not read this Word file. It may be damaged or password protected.', err) }
    return A.htmlToBlocks(r.value)
  }
  if (e === 'html' || e === 'htm' || e === 'xhtml') return A.htmlToBlocks(await readText(f))
  if (e === 'md' || e === 'markdown') {
    const { marked } = await import('../../lib/libs.js')
    const m = await marked()
    return A.htmlToBlocks(m.parse(await readText(f)))
  }
  if (e === 'pptx') { const { pptxToBlocks } = await import('./_slides.js'); return pptxToBlocks(bytes, { onProgress, signal }) }
  if (e === 'eml' || e === 'msg') {
    const E = await import('./_email.js')
    const msg = e === 'eml' ? E.parseEml(bytes) : await E.parseMsg(bytes)
    const html = await E.emailToHtml(msg, { embedAttachments: false })
    return A.htmlToBlocks(html)
  }
  // plain text: paragraphs split on blank lines, lines inside kept as line breaks
  const text = (await readText(f)).replace(/\r\n?/g, '\n')
  const blocks = text.split(/\n{2,}/).map((p) => p.replace(/^\n+|\n+$/g, '')).filter((p) => p.trim()).map((p) => {
    const runs = []
    p.split('\n').forEach((line, i) => { if (i) runs.push({ br: true }); runs.push({ text: line }) })
    return { t: 'p', runs }
  })
  return { blocks, title: baseName(f.name) }
}

/** Blocks -> output files in the requested format. */
export async function writeBlocks({ blocks, title }, to, name, opts = {}, ctx = {}) {
  const A = await import('./_ast.js')
  const base = baseName(name)
  if (to === 'txt') return [out(A.astToText(blocks), `${base}.txt`, 'text/plain')]
  if (to === 'md') {
    const mode = opts.images || 'files'
    const r = A.astToMarkdown(blocks, { images: mode })
    if (r.images.length) return [out(await zipFiles([{ name: `${base}.md`, data: r.text }, ...r.images.map((i) => ({ name: i.name, data: i.bytes }))]), `${base}.zip`, 'application/zip')]
    return [out(r.text, `${base}.md`, 'text/markdown')]
  }
  if (to === 'html') {
    const { wrapDoc } = await import('./_html.js')
    return [out(wrapDoc(A.astToHtml(blocks), { title: title || base }), `${base}.html`, 'text/html')]
  }
  if (to === 'pdf') {
    const { wrapDoc, htmlToPdf } = await import('./_html.js')
    const html = wrapDoc(A.astToHtml(blocks), { title: title || base })
    const bytes = await htmlToPdf(html, { title: title || base, size: opts.size || 'A4', pageNumbers: !!opts.pageNumbers, onProgress: ctx.onProgress, signal: ctx.signal })
    return [out(bytes, `${base}.pdf`, 'application/pdf')]
  }
  if (to === 'docx') { const { astToDocx } = await import('./_docx-write.js'); return [out(await astToDocx(blocks, { title }), `${base}.docx`)] }
  if (to === 'odt') { const { astToOdt } = await import('./_odt-write.js'); return [out(await astToOdt(blocks, { title }), `${base}.odt`)] }
  if (to === 'rtf') { const { astToRtf } = await import('./_rtf.js'); return [out(astToRtf(blocks, { title }), `${base}.rtf`, 'application/rtf')] }
  if (to === 'hwpx') { const { astToHwpx } = await import('./_hwp.js'); return [out(await astToHwpx(blocks, { title }), `${base}.hwpx`)] }
  if (to === 'epub') {
    const { wrapDoc } = await import('./_html.js')
    const { htmlToEpub } = await import('./_epub-writer.js')
    const html = wrapDoc(A.astToHtml(blocks), { title: title || base })
    return [out(await htmlToEpub(html, { title: opts.title || title || base, author: opts.author || '', split: Number(opts.split ?? 2) }), `${base}.epub`)]
  }
  throw fail(`Cannot write ${to} from this document.`)
}

const GROUPS = { email: 'E-mail', odf: 'OpenDocument', sheets: 'Spreadsheets', rtf: 'Rich Text', slides: 'Presentations', epub: 'E-books', hwp: 'Korean HWP', text: 'Text', markup: 'Markup' }

async function docRoute(f, to, opts, ctx) {
  const doc = await readBlocks(f, ctx)
  ctx.onProgress?.(0.2, 'Writing')
  return writeBlocks(doc, to, f.name, opts, { ...ctx, onProgress: (p, t) => ctx.onProgress?.(0.2 + 0.8 * (p || 0), t) })
}

// ------------------------------------------------------------------ e-mail
async function emailRoute(f, to, opts, ctx) {
  const E = await import('./_email.js')
  const e = extOf(f.name)
  const bytes = await bytesOf(f)
  const msg = e === 'msg' ? await E.parseMsg(bytes) : E.parseEml(bytes)
  const base = baseName(f.name)
  const files = []
  if (to === 'eml') {
    const { buildEml } = await import('./_mime.js')
    files.push(out(buildEml(msg), `${base}.eml`, 'message/rfc822'))
  } else if (to === 'txt') files.push(out(await E.emailToText(msg), `${base}.txt`, 'text/plain'))
  else if (to === 'html') files.push(out(await E.emailToHtml(msg, { remoteImages: !!opts.remoteImages, embedAttachments: true }), `${base}.html`, 'text/html'))
  else if (to === 'pdf') {
    const { htmlToPdf } = await import('./_html.js')
    const html = await E.emailToHtml(msg, { remoteImages: !!opts.remoteImages, embedAttachments: false })
    files.push(out(await htmlToPdf(html, { title: msg.headers.subject || base, onProgress: ctx.onProgress, signal: ctx.signal }), `${base}.pdf`, 'application/pdf'))
  } else throw fail(`Cannot convert e-mail to ${to}.`)
  if (opts.attachments) for (const a of msg.attachments) files.push(out(a.bytes, a.name, a.type || 'application/octet-stream'))
  return files
}

// ------------------------------------------------------------------ spreadsheets
async function sheetRoute(f, to, opts, ctx) {
  const S = await import('./_sheets.js')
  ctx.onProgress?.(0.1, 'Reading the spreadsheet')
  const wb = await S.readWorkbook(f)
  ctx.onProgress?.(0.6, 'Converting')
  const parts = await S.convertWorkbook(wb, to, baseName(f.name), { header: opts.header !== false, jsonShape: opts.jsonShape || 'objects', bom: opts.bom !== false, sheets: opts.sheets || 'all' })
  return parts.map((p) => out(p.data, p.name, p.type))
}

// ------------------------------------------------------------------ slides
async function pptxRoute(f, to, opts, ctx) {
  const { pptxToBlocks } = await import('./_slides.js')
  const bytes = await bytesOf(f)
  const r = await pptxToBlocks(bytes, { notes: opts.notes !== false, images: opts.images ? 'slide' : 'none', hidden: !!opts.hidden, pageBreaks: !!opts.pageBreaks, onProgress: ctx.onProgress, signal: ctx.signal })
  if (to === 'md' || to === 'txt') {
    // outline: slide titles as headings, bullets by level
    const blocks = r.blocks
    return writeBlocks({ blocks, title: r.title }, to, f.name, opts, ctx)
  }
  return writeBlocks({ blocks: r.blocks, title: r.title }, to, f.name, opts, ctx)
}
async function toPptxRoute(f, to, opts, ctx) {
  const { blocksToPptx } = await import('./_slides.js')
  const doc = await readBlocks(f, ctx)
  const bytes = await blocksToPptx(doc.blocks, { title: doc.title || baseName(f.name), splitLevel: Number(opts.split ?? 2), theme: opts.theme || 'light', onProgress: ctx.onProgress })
  return [out(bytes, withExt(f.name, 'pptx'), mimeFor('pptx'))]
}

// ------------------------------------------------------------------ text
async function encodingRoute(f, to, opts) {
  const { toUtf8 } = await import('./_encoding.js')
  const r = toUtf8(await bytesOf(f), { from: opts.from, bom: !!opts.bom, eol: opts.eol || 'keep' })
  return [out(r.bytes, extOf(f.name) === 'txt' ? `${baseName(f.name)}-utf8.txt` : withExt(f.name, 'txt'), 'text/plain;charset=utf-8')]
}
async function codeRoute(f, to, opts, ctx) {
  const { textToPdf } = await import('./_html.js')
  const text = await readText(f)
  const bytes = await textToPdf(text, { title: f.name, lineNumbers: !!opts.lineNumbers, size: Number(opts.size || 9.5), orient: opts.orient || 'portrait', wrap: opts.wrap !== false, pageNumbers: true })
  void ctx
  return [out(bytes, withExt(f.name, 'pdf'), 'application/pdf')]
}
async function mhtmlRoute(f, to, opts, ctx) {
  const E = await import('./_email.js')
  const r = await E.mhtmlToHtml(await bytesOf(f))
  const base = baseName(f.name)
  if (to === 'html') return [out(r.html, `${base}.html`, 'text/html')]
  if (to === 'txt') { const A = await import('./_ast.js'); return [out(A.astToText((await A.htmlToBlocks(r.html)).blocks), `${base}.txt`, 'text/plain')] }
  const { htmlToPdf } = await import('./_html.js')
  return [out(await htmlToPdf(r.html, { title: r.title || base, onProgress: ctx.onProgress, signal: ctx.signal }), `${base}.pdf`, 'application/pdf')]
}
async function ipynbRoute(f, to, opts, ctx) {
  const N = await import('./_ipynb.js')
  const nb = N.parseNotebook(await readText(f))
  const base = baseName(f.name)
  if (to === 'md') {
    const r = N.notebookToMarkdown(nb, { code: opts.code !== false })
    if (r.images.length) return [out(await zipFiles([{ name: `${base}.md`, data: r.text }, ...r.images.map((i) => ({ name: i.name, data: i.bytes }))]), `${base}.zip`, 'application/zip')]
    return [out(r.text, `${base}.md`, 'text/markdown')]
  }
  const html = await N.notebookToHtml(nb, { title: base, code: opts.code !== false })
  if (to === 'html') return [out(html, `${base}.html`, 'text/html')]
  const { htmlToPdf } = await import('./_html.js')
  return [out(await htmlToPdf(html, { title: base, onProgress: ctx.onProgress, signal: ctx.signal }), `${base}.pdf`, 'application/pdf')]
}
async function markupRoute(f, to, opts, ctx) {
  const M = await import('./_markup.js')
  const from = M.formatByExt(extOf(f.name))
  const target = M.formatByExt(to)
  if (!from || !target) throw fail('That format is not supported.')
  const text = await readText(f)
  const res = await M.convertMarkup(text, from.id, target.id, { onProgress: ctx.onProgress, title: baseName(f.name) })
  return [out(res, withExt(f.name, target.ext), target.id === 'html' ? 'text/html' : 'text/plain')]
}
async function epubRoute(f, to, opts, ctx) {
  const e = extOf(f.name)
  const E = await import('./_epub-writer.js')
  const base = baseName(f.name)
  const common = { title: opts.title || base, author: opts.author || '', lang: opts.lang || '', split: Number(opts.split ?? 2) }
  ctx.onProgress?.(0.2, 'Building the e-book')
  if (e === 'txt') return [out(await E.textToEpub(await readText(f), common), `${base}.epub`)]
  if (e === 'html' || e === 'htm') return [out(await E.htmlToEpub(await readText(f), common), `${base}.epub`)]
  if (e === 'md' || e === 'markdown') {
    const { marked } = await import('../../lib/libs.js')
    const m = await marked()
    return [out(await E.htmlToEpub(`<!doctype html><title></title><body>${m.parse(await readText(f))}</body>`, common), `${base}.epub`)]
  }
  if (e === 'docx') {
    const { mammoth } = await import('../../lib/libs.js')
    const mm = await mammoth()
    const bytes = await bytesOf(f)
    const r = await mm.convertToHtml({ arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, { styleMap: ['u => u', 'strike => s'] })
    return [out(await E.htmlToEpub(`<!doctype html><title></title><body>${r.value}</body>`, common), `${base}.epub`)]
  }
  throw fail('That file type cannot be turned into an e-book.')
}

async function odpRoute(f, to, opts, ctx) {
  const O = await import('./_odp.js')
  const base = baseName(f.name)
  const bytes = await bytesOf(f)
  if (to === 'pdf') return [out(await O.odpToPdf(bytes, { onProgress: ctx.onProgress, signal: ctx.signal }), `${base}.pdf`, 'application/pdf')]
  const r = await O.renderOdp(bytes, { scale: Number(opts.scale || 2), onProgress: ctx.onProgress, signal: ctx.signal })
  const files = r.pages.map((p, i) => out(p.bytes, `${base}-${String(i + 1).padStart(2, '0')}.${p.jpeg ? 'jpg' : 'png'}`, p.jpeg ? 'image/jpeg' : 'image/png'))
  return files
}

const DOC_TO = ['docx', 'html', 'txt', 'pdf', 'rtf', 'md']
const SRC_EXTS = ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'java', 'kt', 'c', 'h', 'cpp', 'cc', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'sh', 'bat', 'ps1', 'sql', 'css', 'scss', 'less', 'json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'r', 'lua', 'pl', 'dart', 'vue', 'svelte', 'gradle', 'diff', 'patch', 'log']
const PDF_OPTS = [{ key: 'pageNumbers', label: 'Page numbers', type: 'toggle', default: false }]

export const CONVERTERS = [
  // e-mail
  { from: ['eml'], to: ['pdf', 'html', 'txt'], group: GROUPS.email, options: [{ key: 'attachments', label: 'Also save attachments', type: 'toggle', default: true }, { key: 'remoteImages', label: 'Load pictures from the web', type: 'toggle', default: false }], run: emailRoute },
  { from: ['msg'], to: ['eml', 'pdf', 'html', 'txt'], group: GROUPS.email, options: [{ key: 'attachments', label: 'Also save attachments', type: 'toggle', default: true }, { key: 'remoteImages', label: 'Load pictures from the web', type: 'toggle', default: false }], run: emailRoute },
  // OpenDocument text and Rich Text
  { from: ['odt', 'fodt', 'ott'], to: DOC_TO, group: GROUPS.odf, options: PDF_OPTS, run: docRoute },
  { from: ['docx'], to: ['odt', 'rtf'], group: GROUPS.odf, run: docRoute },
  { from: ['odp', 'fodp', 'otp'], to: ['pdf', 'png'], group: GROUPS.odf, options: [{ key: 'scale', label: 'Picture sharpness', type: 'select', choices: [[1, 'Draft'], [2, 'Standard'], [3, 'Sharp']], default: 2 }], run: odpRoute },
  { from: ['rtf'], to: ['docx', 'html', 'txt', 'pdf', 'md', 'odt'], group: GROUPS.rtf, options: PDF_OPTS, run: docRoute },
  { from: ['html', 'htm', 'txt', 'md', 'markdown'], to: ['rtf'], group: GROUPS.rtf, run: docRoute },
  // spreadsheets
  {
    from: ['ods', 'fods', 'ots', 'xlsx', 'xlsm', 'xlsb', 'xls', 'xlt', 'xltx', 'csv', 'tsv'], to: ['xlsx', 'ods', 'csv', 'tsv', 'json', 'html', 'xls'], group: GROUPS.sheets, run: sheetRoute,
    options: [{ key: 'sheets', label: 'Sheets', type: 'select', choices: [['all', 'All sheets'], ['first', 'First sheet only']], default: 'all' }, { key: 'header', label: 'First row holds column names (JSON)', type: 'toggle', default: true }],
  },
  // presentations
  { from: ['pptx'], to: ['docx', 'txt', 'md'], group: GROUPS.slides, options: [{ key: 'images', label: 'Add a picture of each slide', type: 'toggle', default: false }, { key: 'notes', label: 'Speaker notes', type: 'toggle', default: true }, { key: 'pageBreaks', label: 'One slide per page', type: 'toggle', default: false }], run: pptxRoute },
  { from: ['md', 'markdown', 'html', 'htm'], to: ['pptx'], group: GROUPS.slides, options: [{ key: 'split', label: 'New slide at', type: 'select', choices: [[1, 'Heading 1'], [2, 'Heading 1 and 2'], [3, 'Heading 1 to 3']], default: 2 }, { key: 'theme', label: 'Theme', type: 'select', choices: [['light', 'Light'], ['dark', 'Dark']], default: 'light' }], run: toPptxRoute },
  // e-books
  { from: ['docx', 'md', 'markdown', 'html', 'htm', 'txt'], to: ['epub'], group: GROUPS.epub, options: [{ key: 'title', label: 'Title', type: 'text', default: '' }, { key: 'author', label: 'Author', type: 'text', default: '' }, { key: 'split', label: 'Chapters start at', type: 'select', choices: [[0, 'Single chapter'], [1, 'Heading 1'], [2, 'Heading 1 and 2']], default: 2 }], run: epubRoute },
  // Korean HWP
  { from: ['hwp', 'hwpx'], to: ['txt', 'html', 'md', 'docx', 'pdf'], group: GROUPS.hwp, options: PDF_OPTS, run: docRoute },
  { from: ['docx', 'txt', 'md', 'markdown', 'html', 'htm'], to: ['hwpx'], group: GROUPS.hwp, run: docRoute },
  // text
  { from: ['txt', 'text', 'log', 'lrc', 'nfo', 'asc', 'cfg', 'conf'], to: ['txt'], group: GROUPS.text, options: [{ key: 'bom', label: 'Add a UTF-8 byte order mark', type: 'toggle', default: false }, { key: 'eol', label: 'Line endings', type: 'select', choices: [['keep', 'Keep'], ['lf', 'LF (Unix)'], ['crlf', 'CRLF (Windows)']], default: 'keep' }], run: encodingRoute },
  { from: SRC_EXTS, to: ['pdf'], group: GROUPS.text, options: [{ key: 'lineNumbers', label: 'Line numbers', type: 'toggle', default: true }, { key: 'size', label: 'Font size', type: 'number', min: 6, max: 16, default: 9.5 }], run: codeRoute },
  { from: ['mhtml', 'mht'], to: ['html', 'pdf', 'txt'], group: GROUPS.text, run: mhtmlRoute },
  { from: ['ipynb'], to: ['html', 'md', 'pdf'], group: GROUPS.markup, options: [{ key: 'code', label: 'Include code cells', type: 'toggle', default: true }], run: ipynbRoute },
  {
    from: ['md', 'markdown', 'html', 'htm', 'rst', 'adoc', 'asciidoc', 'org', 'tex', 'latex', 'wiki', 'mediawiki', 'textile', 'dbk', 'docbook', 'ipynb', 'opml', 'man'],
    to: ['md', 'html', 'rst', 'adoc', 'org', 'tex', 'wiki', 'textile', 'dbk', 'ipynb', 'opml', 'man'], group: GROUPS.markup, run: markupRoute,
  },
]

/** Magic-byte sniffing for formats whose extension may be missing. */
export const SNIFF = [
  { ext: 'msg', test: (b) => b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 && false },
  { ext: 'rtf', test: (b) => b[0] === 0x7b && b[1] === 0x5c && b[2] === 0x72 && b[3] === 0x74 && b[4] === 0x66 },
]
void esc; void decodeText; void utf8; void checkAbort; void dataUrl
