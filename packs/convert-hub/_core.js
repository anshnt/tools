// Routes for the formats the site already handles itself: pictures, PDF, Word, Excel, PowerPoint, text, Markdown and HTML.
// Every run() works without any page UI and loads its libraries only when called. Other packs add their routes in their own _convert.js.
import { withExt, baseName, ext as extOf } from '../../lib/files.js'

const abortErr = () => Object.assign(new Error('Cancelled'), { code: 'ABORT' })
const check = (signal) => { if (signal?.aborted) throw abortErr() }
const file = (blob, name) => new File([blob], name, { type: blob.type })
const pad = (n, total) => String(n).padStart(String(total).length, '0')
const num = (v, d = 0) => (Number.isFinite(+v) && v !== '' && v !== null ? +v : d)

// ---------- shared option definitions ----------
const SIZE_OPTS = [
  { key: 'maxWidth', label: 'Max width (px, 0 = keep)', type: 'number', min: 0, default: 0 },
  { key: 'maxHeight', label: 'Max height (px, 0 = keep)', type: 'number', min: 0, default: 0 },
]
const QUALITY = { key: 'quality', label: 'Quality', type: 'range', min: 1, max: 100, step: 1, default: 90 }
const PAGES = { key: 'pages', label: 'Pages (e.g. 1-3, 5; empty = all)', type: 'text', default: '' }
const DPI = { key: 'dpi', label: 'Resolution', type: 'select', choices: [[72, '72 dpi (small)'], [96, '96 dpi'], [150, '150 dpi (standard)'], [200, '200 dpi'], [300, '300 dpi (print)']], default: 150 }
const PAGE_SIZE = { key: 'pageSize', label: 'Page size', type: 'select', choices: [['fit', 'Same as the picture'], ['A4', 'A4'], ['Letter', 'US Letter']], default: 'fit' }
const MARGIN = { key: 'margin', label: 'Margin (mm)', type: 'number', min: 0, max: 50, default: 0 }
const A4_LETTER = { A4: [595.28, 841.89], Letter: [612, 792] }

// ---------- pictures ----------
const IMG_IN = ['jpg', 'png', 'webp', 'avif', 'gif', 'bmp', 'ico', 'heic', 'heif', 'svg']
let canAvif
const avifOk = () => {
  if (canAvif === undefined) { try { const c = document.createElement('canvas'); c.width = c.height = 1; canAvif = c.toDataURL('image/avif').startsWith('data:image/avif') } catch { canAvif = false } }
  return canAvif
}

/** Decode any supported picture and apply max width/height. Returns a canvas. */
async function decodeScaled(f, o, { background } = {}) {
  const { loadImage, fitSize } = await import('../../lib/image.js')
  const { resample } = await import('../image-edit/_encode.js')
  const img = await loadImage(f)
  let w = img.naturalWidth, h = img.naturalHeight
  if (extOf(f.name) === 'svg' || !w || !h) { w = w || 300; h = h || 150; const k = Math.max(1, 1024 / Math.max(w, h)); w *= k; h *= k }
  const mw = num(o.maxWidth, 0), mh = num(o.maxHeight, 0)
  const s = fitSize(w, h, mw > 0 ? mw : Infinity, mh > 0 ? mh : Infinity)
  return resample(img, s.width, s.height, { background })
}

async function imageToImage(f, to, o, { signal, onProgress } = {}) {
  const { encode } = await import('../image-edit/_encode.js')
  if (to === 'avif' && !avifOk()) throw new Error('This browser cannot save AVIF pictures. Use Chrome or Edge, or pick WebP.')
  onProgress?.(0.1)
  const c = await decodeScaled(f, o)
  check(signal)
  onProgress?.(0.6)
  const sizes = String(o.sizes || '16,32,48').split(/[\s,]+/).map(Number).filter((n) => n >= 1 && n <= 256)
  const blob = await encode(c, to, { quality: num(o.quality, 90) / 100, sizes: sizes.length ? sizes : [16, 32, 48] })
  c.width = c.height = 0
  onProgress?.(1)
  return file(blob, withExt(f.name, to))
}

/** Put one picture into a pdf-lib document, on its own page. */
async function addPicture(doc, f, o) {
  const { toBlob } = await import('../../lib/image.js')
  const { jpegOrientation } = await import('../image-edit/_meta.js')
  const bytes = new Uint8Array(await f.arrayBuffer())
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8
  let embed, iw, ih
  if (isJpg && jpegOrientation(bytes) === 1 && !num(o.maxWidth, 0) && !num(o.maxHeight, 0)) {
    embed = await doc.embedJpg(bytes) // untouched: no quality loss
    iw = embed.width; ih = embed.height
  } else {
    const c = await decodeScaled(f, o)
    const blob = await toBlob(c, isJpg ? 'image/jpeg' : 'image/png', 0.92)
    embed = isJpg ? await doc.embedJpg(await blob.arrayBuffer()) : await doc.embedPng(await blob.arrayBuffer())
    iw = c.width; ih = c.height
    c.width = c.height = 0
  }
  const m = num(o.margin, 0) * (72 / 25.4)
  if (!o.pageSize || o.pageSize === 'fit') {
    const k = Math.min(0.75, 1400 / Math.max(iw, ih))
    doc.addPage([iw * k + 2 * m, ih * k + 2 * m]).drawImage(embed, { x: m, y: m, width: iw * k, height: ih * k })
  } else {
    let [W, H] = A4_LETTER[o.pageSize] || A4_LETTER.A4
    if (iw > ih) [W, H] = [H, W]
    const s = Math.min(Math.max(10, W - 2 * m) / iw, Math.max(10, H - 2 * m) / ih)
    doc.addPage([W, H]).drawImage(embed, { x: (W - iw * s) / 2, y: (H - ih * s) / 2, width: iw * s, height: ih * s })
  }
}

async function imageToPdf(f, to, o, ctx) {
  const { pdfLib } = await import('../../lib/libs.js')
  const { savePdf } = await import('../../lib/pdf.js')
  const { PDFDocument } = await pdfLib()
  const doc = await PDFDocument.create()
  ctx?.onProgress?.(0.1)
  await addPicture(doc, f, o)
  ctx?.onProgress?.(0.8)
  return file(await savePdf(doc), withExt(f.name, 'pdf'))
}

/** Several pictures and PDFs, in the order given, into one PDF. */
async function mergeToPdf(files, to, o, { signal, onProgress } = {}) {
  const { pdfLib } = await import('../../lib/libs.js')
  const { savePdf, loadPdfLib } = await import('../../lib/pdf.js')
  const { PDFDocument } = await pdfLib()
  const out = await PDFDocument.create()
  for (let i = 0; i < files.length; i++) {
    check(signal)
    const f = files[i]
    if (extOf(f.name) === 'pdf' || f.type === 'application/pdf') {
      let src
      try { src = await loadPdfLib(f) } catch (e) { throw new Error(e.code === 'PASSWORD' ? `${f.name} is password-protected. Unlock it first, then merge.` : `${f.name}: ${e.message}`) }
      const pages = await out.copyPages(src, src.getPageIndices())
      for (const p of pages) out.addPage(p)
      if (o.blank && i < files.length - 1 && pages.length) out.addPage([pages.at(-1).getWidth(), pages.at(-1).getHeight()])
    } else {
      await addPicture(out, f, o)
      if (o.blank && i < files.length - 1) out.addPage()
    }
    onProgress?.((i + 1) / files.length)
    await new Promise((r) => setTimeout(r, 0))
  }
  return file(await savePdf(out), 'merged.pdf')
}

// ---------- PDF ----------
async function openForRead(f) {
  const { openPdf } = await import('../../lib/pdf.js')
  return openPdf(f)
}
async function pickPages(doc, spec) {
  const { parseRanges } = await import('../../lib/pdf.js')
  return String(spec || '').trim() ? parseRanges(spec, doc.numPages) : Array.from({ length: doc.numPages }, (_, i) => i + 1)
}

async function pdfToImages(f, to, o, { signal, onProgress } = {}) {
  const { renderPage } = await import('../../lib/pdf.js')
  const { toBlob } = await import('../../lib/image.js')
  const doc = await openForRead(f)
  try {
    const list = await pickPages(doc, o.pages)
    const out = []
    const mime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[to]
    for (let i = 0; i < list.length; i++) {
      check(signal)
      const c = await renderPage(doc, list[i], { scale: num(o.dpi, 150) / 72 })
      const blob = await toBlob(c, mime, num(o.quality, 90) / 100)
      c.width = c.height = 0
      out.push(file(blob, list.length === 1 ? withExt(f.name, to) : `${baseName(f.name)}-page-${pad(list[i], doc.numPages)}.${to}`))
      onProgress?.((i + 1) / list.length)
      await new Promise((r) => setTimeout(r, 0))
    }
    return out
  } finally { doc.destroy?.() }
}

async function pdfToText(f, to, o, { signal, onProgress } = {}) {
  const { extractText } = await import('../../lib/pdf.js')
  const doc = await openForRead(f)
  try {
    const list = await pickPages(doc, o.pages)
    const all = await extractText(doc, (p) => { check(signal); onProgress?.(p) })
    const text = all.filter((p) => list.includes(p.page)).map((p) => p.text).join('\n\n')
    if (!text.trim()) throw new Error('No text found. This PDF looks like a scan, so there is no text to copy out.')
    return file(new Blob([text], { type: 'text/plain' }), withExt(f.name, 'txt'))
  } finally { doc.destroy?.() }
}

async function pdfToDocx(f, to, o, { signal, onProgress } = {}) {
  const { readPages, analyze, attachImages } = await import('../pdf-convert/_layout.js')
  const { blocksToDocx } = await import('../pdf-convert/_docx.js')
  const doc = await openForRead(f)
  try {
    const list = await pickPages(doc, o.pages)
    const data = await readPages(doc, list, { signal, onProgress: (p) => onProgress?.(p * 0.5) })
    if (!data.some((p) => p.items.length)) throw new Error('No text found. This PDF looks like a scan, and reading scans needs OCR. Use the PDF to Word tool for that.')
    for (let i = 0; i < data.length; i++) {
      check(signal)
      try { await attachImages(doc, data[i]) } catch { data[i].images = [] }
      onProgress?.(0.5 + (0.4 * (i + 1)) / data.length)
    }
    const a = analyze(data.map((p) => ({ ...p, images: p.images || [] })), { headings: true, lists: true, tables: true, boldHeadings: true, removeHeaders: true, joinPages: true, columns: true })
    const bf = data.flatMap((p) => p.items).find((it) => it.font === a.bodyFont)
    const blob = await blocksToDocx({ pages: a.pages, body: a.body, bodyFont: a.bodyFont, bodySerif: !!bf?.serif, sizes: a.sizes, pageBreaks: false, fonts: 'match', title: baseName(f.name) })
    return file(blob, withExt(f.name, 'docx'))
  } finally { doc.destroy?.() }
}

async function pdfToLayoutText(f, to, o, { signal, onProgress } = {}) {
  const { readPages, analyze, blocksToHtml, blocksToMarkdown } = await import('../pdf-convert/_layout.js')
  const doc = await openForRead(f)
  try {
    const list = await pickPages(doc, o.pages)
    const data = await readPages(doc, list, { signal, onProgress })
    if (!data.some((p) => p.items.length)) throw new Error('No text found. This PDF looks like a scan, so there is nothing to turn into text.')
    const a = analyze(data.map((p) => ({ ...p, images: [] })), { headings: true, lists: true, tables: true, boldHeadings: true, removeHeaders: true, joinPages: true, columns: true })
    if (to === 'md') return file(new Blob([blocksToMarkdown(a.pages)], { type: 'text/markdown' }), withExt(f.name, 'md'))
    const body = blocksToHtml(a.pages)
    return file(new Blob([`<!doctype html><html><head><meta charset="utf-8"><title>${baseName(f.name).replace(/[<>&]/g, '')}</title></head><body>${body}</body></html>`], { type: 'text/html' }), withExt(f.name, 'html'))
  } finally { doc.destroy?.() }
}

async function pdfCompress(f, to, o, { onProgress } = {}) {
  const { loadPdfLib, savePdf } = await import('../../lib/pdf.js')
  const { findJpegs, applyLevel, levelAt } = await import('../pdf-edit/compress-pdf.js')
  const doc = await loadPdfLib(f)
  const level = o.level || 'balanced'
  onProgress?.(0.05)
  let best = await savePdf(doc)
  if (level !== 'lossless') {
    const info = await findJpegs(doc)
    if (info.images.length) {
      await applyLevel(doc, info.images, levelAt({ balanced: 2, small: 4, smallest: 6 }[level] ?? 2), (p) => onProgress?.(0.1 + p * 0.8))
      const b = await savePdf(doc)
      if (b.size < best.size) best = b
    }
  }
  if (best.size >= f.size) best = new Blob([await f.arrayBuffer()], { type: 'application/pdf' })
  return file(best, `${baseName(f.name)}-compressed.pdf`)
}

async function pdfSplit(f, to, o, { signal, onProgress } = {}) {
  const { loadPdfLib, savePdf, parseRanges } = await import('../../lib/pdf.js')
  const { pdfLib } = await import('../../lib/libs.js')
  const { PDFDocument } = await pdfLib()
  const src = await loadPdfLib(f)
  const total = src.getPageCount()
  let parts
  if (o.mode === 'ranges') {
    parts = String(o.ranges || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => ({ pages: parseRanges(s, total), label: s.replace(/\s+/g, '') }))
    if (!parts.length) throw new Error('Type the pages for each file, like 1-3, 4-6, 8.')
  } else if (o.mode === 'every') {
    const n = Math.max(1, Math.floor(num(o.every, 2)))
    parts = []
    for (let s = 1; s <= total; s += n) { const e = Math.min(total, s + n - 1); parts.push({ pages: Array.from({ length: e - s + 1 }, (_, i) => s + i), label: s === e ? `${s}` : `${s}-${e}` }) }
  } else parts = Array.from({ length: total }, (_, i) => ({ pages: [i + 1], label: `${i + 1}` }))
  const out = []
  for (let i = 0; i < parts.length; i++) {
    check(signal)
    const d = await PDFDocument.create()
    for (const p of await d.copyPages(src, parts[i].pages.map((n) => n - 1))) d.addPage(p)
    out.push(file(await savePdf(d), `${baseName(f.name)}-pages-${parts[i].label.replace(/,/g, '_')}.pdf`))
    onProgress?.((i + 1) / parts.length)
    await new Promise((r) => setTimeout(r, 0))
  }
  return out
}

// ---------- Office documents ----------
const office = () => import('./_office.js')
const docxToPdf = async (f, to, o, c) => (await office()).docxToPdf(f, o, c)
const pptxToPdf = async (f, to, o, c) => (await office()).pptxToPdf(f, o, c)
const textToPdf = async (f, to, o, c) => (await office()).textToPdf(f, to, o, c)

async function docxToText(f, to, o) {
  const { mammoth, turndown } = await import('../../lib/libs.js')
  const mm = await mammoth()
  const buffer = await f.arrayBuffer()
  if (to === 'txt') return file(new Blob([(await mm.extractRawText({ arrayBuffer: buffer })).value], { type: 'text/plain' }), withExt(f.name, 'txt'))
  const html = (await mm.convertToHtml({ arrayBuffer: buffer })).value
  if (to === 'md') {
    const T = await turndown()
    return file(new Blob([new T({ headingStyle: 'atx', bulletListMarker: '-' }).turndown(html)], { type: 'text/markdown' }), withExt(f.name, 'md'))
  }
  return file(new Blob([`<!doctype html><html><head><meta charset="utf-8"><title>${baseName(f.name).replace(/[<>&]/g, '')}</title></head><body>${html}</body></html>`], { type: 'text/html' }), withExt(f.name, 'html'))
}

// ---------- spreadsheets ----------
const DELIMS = [[',', 'Comma'], [';', 'Semicolon'], ['\t', 'Tab']]
async function sheetToCsv(f, to, o) {
  const { xlsx } = await import('../../lib/libs.js')
  const XLSX = await xlsx()
  const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true })
  const FS = to === 'tsv' ? '\t' : o.delimiter || ','
  const names = o.allSheets === false ? wb.SheetNames.slice(0, 1) : wb.SheetNames
  if (!names.length) throw new Error('This workbook has no sheets.')
  return names.map((n) => {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS, blankrows: false, dateNF: 'yyyy-mm-dd' })
    return file(new Blob([(o.bom === false ? '' : '﻿') + csv], { type: 'text/csv' }), names.length === 1 ? withExt(f.name, to) : `${baseName(f.name)}-${n.replace(/[\\/:*?"<>|]+/g, '_')}.${to}`)
  })
}
async function csvToXlsx(f, to, o) {
  const { xlsx } = await import('../../lib/libs.js')
  const XLSX = await xlsx()
  const text = await f.text()
  const wb = XLSX.read(text, { type: 'string', raw: o.typed === false, FS: extOf(f.name) === 'tsv' ? '\t' : undefined })
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return file(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), withExt(f.name, 'xlsx'))
}

export const CONVERTERS = [
  { from: IMG_IN, to: ['png', 'bmp'], sameFormat: true, group: 'Pictures', options: [...SIZE_OPTS], run: imageToImage },
  { from: IMG_IN, to: ['jpg', 'webp', 'avif'].filter((t) => t !== 'avif' || avifOk()), sameFormat: true, group: 'Pictures', options: [QUALITY, ...SIZE_OPTS], run: imageToImage },
  { from: IMG_IN, to: ['gif'], sameFormat: true, group: 'Pictures', note: 'Animated GIFs become a still picture.', options: [...SIZE_OPTS], run: imageToImage },
  { from: IMG_IN, to: ['ico'], group: 'Pictures', options: [{ key: 'sizes', label: 'Icon sizes (px, comma separated)', type: 'text', default: '16,32,48' }], run: imageToImage },
  { from: IMG_IN, to: ['pdf'], lastOnly: true, group: 'Pictures to PDF', options: [PAGE_SIZE, MARGIN, ...SIZE_OPTS], run: imageToPdf },
  { from: [...IMG_IN, 'pdf'], to: ['pdf-merge'], combine: true, group: 'PDF tools', options: [PAGE_SIZE, MARGIN, { key: 'blank', label: 'Blank page between files', type: 'toggle', default: false }], run: mergeToPdf },
  { from: ['pdf'], to: ['png'], group: 'PDF pages as pictures', options: [DPI, PAGES], run: pdfToImages },
  { from: ['pdf'], to: ['jpg', 'webp'], group: 'PDF pages as pictures', options: [DPI, PAGES, QUALITY], run: pdfToImages },
  { from: ['pdf'], to: ['txt'], group: 'PDF to text', options: [PAGES], run: pdfToText },
  { from: ['pdf'], to: ['html', 'md'], group: 'PDF to text', options: [PAGES], run: pdfToLayoutText },
  { from: ['pdf'], to: ['docx'], group: 'PDF to documents', options: [PAGES], run: pdfToDocx },
  { from: ['pdf'], to: ['pdf-compress'], group: 'PDF tools', options: [{ key: 'level', label: 'Compression', type: 'select', choices: [['balanced', 'Balanced'], ['small', 'Smaller'], ['smallest', 'Smallest'], ['lossless', 'Lossless tidy-up']], default: 'balanced' }], run: pdfCompress },
  { from: ['pdf'], to: ['pdf-split'], group: 'PDF tools', options: [{ key: 'mode', label: 'Split', type: 'select', choices: [['each', 'Every page'], ['every', 'Every N pages'], ['ranges', 'By page ranges']], default: 'each' },
    { key: 'every', label: 'Pages per file (for Every N pages)', type: 'number', min: 1, default: 2 }, { key: 'ranges', label: 'Ranges (for By page ranges)', type: 'text', default: '' }], run: pdfSplit },
  { from: ['docx'], to: ['pdf'], group: 'Documents', run: docxToPdf },
  { from: ['docx'], to: ['txt', 'html', 'md'], group: 'Documents', run: docxToText },
  { from: ['pptx'], to: ['pdf'], group: 'Presentations', options: [{ key: 'dpi', label: 'Sharpness', type: 'select', choices: [[96, 'Draft (96 dpi)'], [150, 'Standard (150 dpi)'], [220, 'Sharp (220 dpi)']], default: 150 }, { key: 'hidden', label: 'Include hidden slides', type: 'toggle', default: false }], run: pptxToPdf },
  { from: ['txt', 'md', 'html'], to: ['pdf'], group: 'Text to PDF', options: [{ key: 'pageSize', label: 'Page size', type: 'select', choices: [['A4', 'A4'], ['Letter', 'US Letter']], default: 'A4' }], run: textToPdf },
  { from: ['xlsx', 'xls', 'ods'], to: ['csv'], group: 'Spreadsheets', options: [{ key: 'delimiter', label: 'Separator', type: 'select', choices: DELIMS, default: ',' }, { key: 'allSheets', label: 'Every sheet (one file each)', type: 'toggle', default: true },
    { key: 'bom', label: 'Add a marker so Excel reads accents correctly', type: 'toggle', default: true }], run: sheetToCsv },
  { from: ['xlsx', 'xls', 'ods'], to: ['tsv'], group: 'Spreadsheets', options: [{ key: 'allSheets', label: 'Every sheet (one file each)', type: 'toggle', default: true }, { key: 'bom', label: 'Add a marker so Excel reads accents correctly', type: 'toggle', default: true }], run: sheetToCsv },
  { from: ['csv', 'tsv'], to: ['xlsx'], group: 'Spreadsheets', options: [{ key: 'typed', label: 'Turn numbers and dates into real cells (off keeps everything as text)', type: 'toggle', default: true }], run: csvToXlsx },
]
export const SNIFF = []
