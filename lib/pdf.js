// PDF helpers on top of pdf.js (read/render) and pdf-lib (edit/write). Fully local.
import { pdfjs, pdfjsDocOptions, pdfLib } from './libs.js'

/** Open a PDF with pdf.js for reading/rendering. Throws err.code = 'PASSWORD' when a password is needed or wrong. */
export async function openPdf(data, { password } = {}) {
  const lib = await pdfjs()
  const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(data.slice ? data.slice(0) : data)
  try {
    return await lib.getDocument({ data: bytes, password, ...pdfjsDocOptions() }).promise
  } catch (e) {
    if (e?.name === 'PasswordException') throw Object.assign(new Error(password ? 'Wrong password for this PDF.' : 'This PDF is password-protected.'), { code: 'PASSWORD' })
    throw Object.assign(new Error('Could not open this PDF. It may be damaged or not a PDF.'), { cause: e })
  }
}

/** Render page (1-based) to a canvas. scale 1 = 72 dpi; use 2 for ~144 dpi. */
export async function renderPage(doc, pageNumber, { scale = 1.5, background = '#ffffff' } = {}) {
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale })
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

/** Extract text per page: [{page, text, items}] - items carry x/y for layout-aware tools. */
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

/** Load with pdf-lib for editing. ignoreEncryption lets you read owner-locked files. */
export async function loadPdfLib(data, opts = {}) {
  const { PDFDocument } = await pdfLib()
  const bytes = data instanceof Blob ? await data.arrayBuffer() : data
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: true, ...opts })
  } catch (e) {
    throw Object.assign(new Error('Could not open this PDF for editing. It may be damaged or encrypted.'), { cause: e })
  }
}

/** pdf-lib doc -> Blob */
export const savePdf = async (doc, opts) => new Blob([await doc.save(opts)], { type: 'application/pdf' })

/**
 * Parse a page selection like "1-3, 5, 8-" into sorted unique 1-based page numbers.
 * Throws a readable error for bad input.
 */
export function parseRanges(spec, pageCount) {
  const pages = new Set()
  for (const part of String(spec).split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*(?:-\s*(\d*))?$/)
    if (!m) throw new Error(`"${part}" is not a valid page or range`)
    const a = m[1] ? +m[1] : 1
    const b = part.includes('-') ? (m[2] ? +m[2] : pageCount) : a
    if (a < 1 || b > pageCount || a > b) throw new Error(`"${part}" is outside 1-${pageCount}`)
    for (let i = a; i <= b; i++) pages.add(i)
  }
  return [...pages].sort((x, y) => x - y)
}

export const PAGE_SIZES = {
  A3: [841.89, 1190.55], A4: [595.28, 841.89], A5: [419.53, 595.28], Letter: [612, 792], Legal: [612, 1008], Tabloid: [792, 1224],
}
