// Routes of the e-book engine for the universal File Converter, and the functions the e-book tools call.
// Everything lazy-loads inside run(), so importing this file is cheap.
import { baseName } from '../../lib/files.js'
import { fail, sniffImage, naturalCompare } from './_book.js'

const stem = (name) => baseName(name).replace(/\.kepub$/i, '') || 'book'
const file = (blob, name) => new File([blob], name, { type: blob.type })

export const BOOK_IN = ['epub', 'kepub', 'mobi', 'azw', 'azw3', 'azw4', 'prc', 'pdb', 'fb2', 'fbz', 'htmlz', 'txtz']
export const COMIC_IN = ['cbz', 'cbr', 'cb7']
export const BOOK_OUT = [['epub', 'EPUB'], ['kepub', 'KEPUB'], ['pdf', 'PDF'], ['docx', 'DOCX'], ['txt', 'TXT'], ['html', 'HTML'], ['md', 'Markdown']]
export const COMIC_OUT = [['pdf', 'PDF'], ['cbz', 'CBZ'], ['epub', 'EPUB']]
export const OUT_EXT = { epub: 'epub', kepub: 'kepub.epub', pdf: 'pdf', docx: 'docx', txt: 'txt', html: 'html', md: 'md', cbz: 'cbz' }

/** Read any supported book. Returns a Book (see _book.js). */
export async function openBook(f, onProgress) {
  const { readBook } = await import('./_read.js')
  return readBook(f, { onProgress })
}

/** Write a Book in a target format. Returns File[] (one file, or the Markdown file plus its pictures as a ZIP). */
export async function saveBook(book, to, opts = {}, name = book.sourceName || 'book', onProgress) {
  const s = stem(name)
  const isComic = book.kind === 'comic'
  if (isComic && !['pdf', 'cbz', 'epub'].includes(to)) throw fail('Comics can be saved as PDF, CBZ or EPUB.', 'FORMAT')
  let blob
  if (to === 'epub' || to === 'kepub') blob = await (await import('./_write.js')).writeEpub(book, { kepub: to === 'kepub' }, onProgress)
  else if (to === 'pdf') {
    const m = await import('./_pdf.js')
    blob = isComic ? await m.writeComicPdf(book, opts, onProgress) : await m.writeBookPdf(book, opts, onProgress)
  } else if (to === 'docx') blob = await (await import('./_docx.js')).writeDocx(book, opts, onProgress)
  else if (to === 'txt') blob = (await import('./_write.js')).writeTxt(book, opts)
  else if (to === 'html') blob = await (await import('./_write.js')).writeHtml(book, opts)
  else if (to === 'cbz') blob = await (await import('./_write.js')).writeCbz(book, onProgress)
  else if (to === 'md') {
    const { writeMarkdown } = await import('./_write.js')
    const md = writeMarkdown(book, { images: opts.images ? 'files' : 'none' })
    if (opts.images && md.images.length) {
      const { zip } = await import('../../lib/files.js')
      const entries = [{ name: `${s}.md`, data: md.text }, ...md.images.map((n) => ({ name: n, data: book.images.get(n).data }))]
      const z = await zip(entries)
      return [file(z, `${s}-markdown.zip`)]
    }
    blob = new Blob([md.text], { type: 'text/markdown;charset=utf-8' })
  } else throw fail(`Cannot save as ${to}.`, 'FORMAT')
  const out = file(blob, `${s}.${OUT_EXT[to]}`)
  if (blob.notes?.length) out.notes = blob.notes
  return [out]
}

/** Read then write. */
export async function convertBook(f, to, opts = {}, { onProgress } = {}) {
  const book = await openBook(f, (p, t) => onProgress?.(p == null ? null : p * 0.4, t))
  const out = await saveBook(book, to, opts, f.name, (p, t) => onProgress?.(0.4 + (p ?? 0) * 0.6, t))
  onProgress?.(1)
  return out
}

/** Pictures (any browser-readable format, plus HEIC) -> one CBZ in reading order. */
export async function imagesToCbz(files, opts = {}, onProgress) {
  const list = [...files]
  if (opts.sort !== false) list.sort((a, b) => naturalCompare(a.name, b.name))
  if (!list.length) throw fail('Add at least one picture.', 'EMPTY')
  const { loadImage, toCanvas, toBlob } = await import('../../lib/image.js')
  const pages = []
  for (let i = 0; i < list.length; i++) {
    const f = list[i]
    let data = new Uint8Array(await f.arrayBuffer())
    let type = sniffImage(data)
    if (!type || !/^image\/(jpeg|png|gif|webp)$/.test(type)) {
      // BMP, AVIF, TIFF, HEIC ... are converted to JPEG so every comic reader can open them
      const img = await loadImage(f)
      const blob = await toBlob(toCanvas(img, undefined, undefined, { background: '#ffffff' }), 'image/jpeg', 0.92)
      data = new Uint8Array(await blob.arrayBuffer())
      type = 'image/jpeg'
    }
    pages.push({ name: f.name, data, type })
    onProgress?.((i + 1) / list.length * 0.8, `Reading picture ${i + 1} of ${list.length}`)
    if (i % 5 === 4) await new Promise((r) => setTimeout(r, 0))
  }
  const { writeCbz } = await import('./_write.js')
  const blob = await writeCbz({ pages, meta: { title: opts.title || '', authors: [] }, files: [] }, (p) => onProgress?.(0.8 + p * 0.2, 'Packing'))
  return file(blob, `${opts.name || 'comic'}.cbz`)
}

/** PDF pages -> pictures in a CBZ. opts: { dpi: 150, quality: 0.85 } */
export async function pdfToCbz(f, opts = {}, onProgress) {
  const { openPdf, renderPage } = await import('../../lib/pdf.js')
  const { toBlob } = await import('../../lib/image.js')
  const doc = await openPdf(f)
  const pages = []
  try {
    const scale = (opts.dpi || 150) / 72
    for (let i = 1; i <= doc.numPages; i++) {
      const c = await renderPage(doc, i, { scale })
      const blob = await toBlob(c, 'image/jpeg', opts.quality || 0.85)
      c.width = c.height = 0
      pages.push({ name: `${i}.jpg`, data: new Uint8Array(await blob.arrayBuffer()), type: 'image/jpeg' })
      onProgress?.((i / doc.numPages) * 0.9, `Page ${i} of ${doc.numPages}`)
      await new Promise((r) => setTimeout(r, 0))
    }
  } finally { doc.destroy?.() }
  const { writeCbz } = await import('./_write.js')
  const blob = await writeCbz({ pages, meta: { title: stem(f.name), authors: [] }, files: [] })
  return file(blob, `${stem(f.name)}.cbz`)
}

const PDF_OPTS = [
  { key: 'pageSize', label: 'Page size', type: 'select', choices: [['A5', 'A5 (book)'], ['A6', 'A6 (pocket)'], ['A4', 'A4'], ['Letter', 'Letter']], default: 'A5' },
  { key: 'fontSize', label: 'Font size', type: 'range', min: 8, max: 18, step: 1, default: 11 },
  { key: 'font', label: 'Font', type: 'select', choices: [['serif', 'Serif'], ['sans', 'Sans']], default: 'serif' },
]
const COMIC_PDF_OPTS = [
  { key: 'pageSize', label: 'Page size', type: 'select', choices: [['fit', 'Fit each picture'], ['A4', 'A4'], ['A5', 'A5'], ['Letter', 'Letter']], default: 'fit' },
  { key: 'images', label: 'Pictures', type: 'select', choices: [['smart', 'Keep as they are'], ['jpeg', 'Smaller file (JPEG)']], default: 'smart' },
]

// Routes this pack can convert. Extensions are lowercase, without the dot.
export const CONVERTERS = [
  { from: BOOK_IN, to: ['pdf'], group: 'E-books', options: PDF_OPTS, run: (f, to, o, c) => convertBook(f, to, o, c) },
  { from: BOOK_IN, to: ['epub', 'kepub', 'docx', 'html'], group: 'E-books', run: (f, to, o, c) => convertBook(f, to, o, c) },
  { from: BOOK_IN, to: ['txt'], group: 'E-books', options: [{ key: 'wrap', label: 'Wrap lines at (0 = no wrapping)', type: 'number', min: 0, max: 200, default: 0 }], run: (f, to, o, c) => convertBook(f, to, o, c) },
  { from: BOOK_IN, to: ['md'], group: 'E-books', options: [{ key: 'images', label: 'Include pictures (as a ZIP)', type: 'toggle', default: false }], run: (f, to, o, c) => convertBook(f, to, o, c) },
  { from: COMIC_IN, to: ['pdf'], group: 'Comics', options: COMIC_PDF_OPTS, run: (f, to, o, c) => convertBook(f, to, o, c) },
  { from: COMIC_IN, to: ['cbz', 'epub'], group: 'Comics', run: (f, to, o, c) => convertBook(f, to, o, c) },
  {
    from: ['pdf'], to: ['cbz'], group: 'Comics',
    options: [{ key: 'dpi', label: 'Resolution (dpi)', type: 'range', min: 72, max: 300, step: 6, default: 150 }],
    run: async (f, to, o, c) => [await pdfToCbz(f, { dpi: o.dpi }, c?.onProgress)],
  },
]

// Magic-byte sniffing for the hub: the formats that have an unmistakable signature.
export const SNIFF = [
  { ext: 'mobi', test: (b) => b.length > 68 && String.fromCharCode(...b.subarray(60, 68)) === 'BOOKMOBI' },
]

