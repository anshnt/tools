// PDF helpers on top of pdf.js (read/render) and pdf-lib (edit/write). Fully local.
import { pdfjs, pdfjsDocOptions, pdfLib } from './libs.js'
import { MAX_PIXELS, toBlob } from './image.js'
import { yieldToMain } from './ui.js'

const toBytes = async (data) => (data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(data.slice ? data.slice(0) : data))
const passwordError = (password) => Object.assign(new Error(password ? 'Wrong password for this PDF.' : 'This PDF is password-protected. Enter its password (or unlock it first with Remove PDF password).'), { code: 'PASSWORD' })

/** Open a PDF with pdf.js for reading/rendering. Throws err.code = 'PASSWORD' when a password is needed or wrong. */
export async function openPdf(data, { password } = {}) {
  const lib = await pdfjs()
  try {
    return await lib.getDocument({ data: await toBytes(data), password, ...pdfjsDocOptions() }).promise
  } catch (e) {
    if (e?.name === 'PasswordException') throw passwordError(password)
    throw Object.assign(new Error('Could not open this PDF. It may be damaged or not a PDF.'), { cause: e })
  }
}

/** Render page (1-based) to a canvas. scale 1 = 72 dpi; use 2 for ~144 dpi. The scale is reduced if the page would exceed MAX_PIXELS. */
export async function renderPage(doc, pageNumber, { scale = 1.5, background = '#ffffff' } = {}) {
  const page = await doc.getPage(pageNumber)
  let viewport = page.getViewport({ scale })
  const area = viewport.width * viewport.height
  if (area > MAX_PIXELS) viewport = page.getViewport({ scale: scale * Math.sqrt(MAX_PIXELS / area) * 0.98 })
  const c = document.createElement('canvas')
  c.width = Math.ceil(viewport.width)
  c.height = Math.ceil(viewport.height)
  const ctx = c.getContext('2d')
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, c.width, c.height) }
  await page.render({ canvasContext: ctx, canvas: c, viewport }).promise
  page.cleanup()
  return c
}

/** Thumbnail canvas whose longest side is ~maxSize px. */
export async function thumbnail(doc, pageNumber, maxSize = 180) {
  const page = await doc.getPage(pageNumber)
  const vp = page.getViewport({ scale: 1 })
  return renderPage(doc, pageNumber, { scale: maxSize / Math.max(vp.width, vp.height) })
}

/** Page size in PDF points as displayed (rotation applied), from pdf.js: {width, height, rotation}. */
export async function pageSize(doc, pageNumber) {
  const page = await doc.getPage(pageNumber)
  const vp = page.getViewport({ scale: 1 })
  return { width: vp.width, height: vp.height, rotation: page.rotate }
}

/** Extract text per page: [{page, text, items}] - items carry x/y (transform[4], transform[5]) for layout-aware tools. */
export async function extractText(doc, onProgress) {
  const out = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    let text = '', lastY
    for (const it of tc.items) {
      if (!('str' in it)) continue
      const y = it.transform[5]
      if (lastY !== undefined && Math.abs(y - lastY) > 2 && text && !text.endsWith('\n')) text += '\n'
      text += it.str
      if (it.hasEOL) text += '\n'
      lastY = y
    }
    out.push({ page: i, text: text.replace(/\n{3,}/g, '\n\n').trim(), items: tc.items })
    onProgress?.(i / doc.numPages)
  }
  return out
}

/**
 * Load with pdf-lib for editing. Encrypted PDFs are decrypted: owner-locked files open as-is, user-password files need
 * {password}. Throws err.code = 'PASSWORD' when a password is required or wrong (so tools can ask for it).
 */
export async function loadPdfLib(data, { password, ...opts } = {}) {
  const { PDFDocument } = await pdfLib()
  const bytes = await toBytes(data)
  try {
    return await PDFDocument.load(bytes, { password: password ?? '', ...opts })
  } catch (e) {
    if (/password|encrypt/i.test(e?.message || '') || e?.name === 'EncryptedPDFError') throw passwordError(password)
    throw Object.assign(new Error('Could not open this PDF for editing. It may be damaged or not a PDF.'), { cause: e })
  }
}

/** pdf-lib doc -> Blob */
export const savePdf = async (doc, opts) => new Blob([await doc.save({ useObjectStreams: true, ...opts })], { type: 'application/pdf' })

/**
 * Rebuild a PDF from page images. Text stops being selectable (say so in the UI), but this shrinks scans and photos a lot.
 * rasterizePdf(file | pdf.js doc, {scale: 1.5, quality: .75, grayscale: false, pages: [1-based], password, onProgress, signal}) -> Blob
 * Page sizes come from pdf.js, so rotated pages keep their visible orientation.
 */
export async function rasterizePdf(src, { scale = 1.5, quality = 0.75, grayscale = false, pages, password, onProgress, signal } = {}) {
  const doc = src?.numPages ? src : await openPdf(src, { password })
  const { PDFDocument } = await pdfLib()
  const out = await PDFDocument.create()
  const list = pages || Array.from({ length: doc.numPages }, (_, i) => i + 1)
  for (let i = 0; i < list.length; i++) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
    const n = list[i]
    const { width, height } = await pageSize(doc, n)
    const c = await renderPage(doc, n, { scale })
    if (grayscale) {
      const ctx = c.getContext('2d')
      ctx.filter = 'grayscale(1)'
      ctx.drawImage(c, 0, 0)
      ctx.filter = 'none'
    }
    const jpg = await out.embedJpg(await (await toBlob(c, 'image/jpeg', quality)).arrayBuffer())
    out.addPage([width, height]).drawImage(jpg, { x: 0, y: 0, width, height })
    c.width = c.height = 0
    onProgress?.((i + 1) / list.length, `Page ${i + 1} of ${list.length}`)
    await yieldToMain()
  }
  return savePdf(out)
}

/**
 * Make a PDF fit under maxBytes. Tries a lossless re-save first, then rasterizes with falling resolution/quality.
 * -> {blob, rasterized, scale, quality, hit}
 */
export async function pdfToTargetSize(file, { maxBytes, grayscale = false, password, onProgress, signal } = {}) {
  if (!grayscale) {
    onProgress?.(null, 'Optimizing')
    const doc = await loadPdfLib(file, { password })
    const blob = await savePdf(doc)
    if (blob.size <= maxBytes) return { blob, rasterized: false, hit: true }
  }
  const doc = await openPdf(file, { password })
  const ladder = [[2, 0.8], [1.6, 0.7], [1.3, 0.6], [1.1, 0.5], [0.9, 0.45], [0.75, 0.4], [0.6, 0.35], [0.5, 0.3]]
  let last
  for (let i = 0; i < ladder.length; i++) {
    const [scale, quality] = ladder[i]
    const blob = await rasterizePdf(doc, { scale, quality, grayscale, signal, onProgress: (f) => onProgress?.((i + f) / ladder.length, `Trying ${Math.round(scale * 72)} dpi`) })
    last = { blob, rasterized: true, scale, quality, hit: blob.size <= maxBytes }
    if (last.hit) return last
  }
  return last
}

/**
 * Parse a page selection like "1-3, 5, 8-" into sorted unique 1-based page numbers.
 * Throws a readable error for bad input.
 */
export function parseRanges(spec, pageCount) {
  const pages = new Set()
  for (const part of String(spec).split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*(?:-\s*(\d*))?$/)
    if (!m || (!m[1] && !part.includes('-'))) throw new Error(`"${part}" is not a valid page or range`)
    const a = m[1] ? +m[1] : 1
    const b = part.includes('-') ? (m[2] ? +m[2] : pageCount) : a
    if (a < 1 || b > pageCount || a > b) throw new Error(`"${part}" is outside 1-${pageCount}`)
    for (let i = a; i <= b; i++) pages.add(i)
  }
  return [...pages].sort((x, y) => x - y)
}

/** Paper sizes in PDF points [width, height] (portrait). */
export const PAGE_SIZES = {
  A3: [841.89, 1190.55], A4: [595.28, 841.89], A5: [419.53, 595.28], Letter: [612, 792], Legal: [612, 1008], Tabloid: [792, 1224],
}
