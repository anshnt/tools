// Opening documents: pdf.js for viewing (pages cached briefly), plus the page list the editor works on.
import { openPdf, PAGE_SIZES } from '../../lib/pdf.js'
import { pdfLib } from '../../lib/libs.js'
import { yieldToMain } from '../../lib/ui.js'
import { uid } from './_geom.js'

export class Doc {
  constructor(pdf, bytes, name, password) {
    this.pdf = pdf
    this.bytes = bytes // original file bytes (kept for saving); never handed to pdf.js directly
    this.name = name
    this.password = password
    this.textCache = new Map()
    this.pages = new Map()
    this.fieldCount = 0
    this.fieldMap = null
  }
  /** pdf.js page for a 0-based source index (small LRU so huge files stay light). */
  async page(src) {
    let p = this.pages.get(src)
    if (!p) {
      p = this.pdf.getPage(src + 1)
      this.pages.set(src, p)
      if (this.pages.size > 24) {
        const [oldKey] = this.pages.keys()
        const old = this.pages.get(oldKey)
        this.pages.delete(oldKey)
        old.then((pg) => pg.cleanup()).catch(() => {})
      }
    }
    return p
  }
  destroy() {
    this.pages.clear()
    this.textCache.clear()
    this.pdf.loadingTask?.destroy()
  }
}

/** Load bytes into a Doc and return it with the initial page list. Throws err.code === 'PASSWORD' when needed. */
export async function loadDoc(bytes, name, { password, onProgress } = {}) {
  const pdf = await openPdf(new Uint8Array(bytes), { password })
  const doc = new Doc(pdf, bytes, name, password)
  const pages = []
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await doc.page(i)
    const vp = page.getViewport({ scale: 1 })
    pages.push({ id: uid('p'), src: i, rot: 0, w: vp.width, h: vp.height })
    if (i % 25 === 24) { onProgress?.((i + 1) / pdf.numPages); await yieldToMain() }
  }
  return { doc, pages }
}

/** A one-page blank PDF (A4 by default) as bytes. */
export async function blankPdfBytes(size = PAGE_SIZES.A4) {
  const { PDFDocument } = await pdfLib()
  const d = await PDFDocument.create()
  d.addPage(size)
  return new Uint8Array(await d.save())
}
