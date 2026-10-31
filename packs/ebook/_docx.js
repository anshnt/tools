// Book -> DOCX with the docx library: headings, paragraphs, lists, quotes, tables, links and pictures.
import { docx } from '../../lib/libs.js'
import { sniffImage, imageSize, fail, startsWithPicture } from './_book.js'
import { htmlToBlocks } from './_blocks.js'
import { comicAsBook } from './_write.js'

const yieldNow = () => new Promise((r) => setTimeout(r, 0))

async function toPng(data, type) {
  const bmp = await createImageBitmap(new Blob([data], { type }))
  const c = document.createElement('canvas')
  c.width = bmp.width
  c.height = bmp.height
  c.getContext('2d').drawImage(bmp, 0, 0)
  bmp.close?.()
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  c.width = c.height = 0
  return { data: new Uint8Array(await blob.arrayBuffer()), width: bmp.width, height: bmp.height }
}

/** opts: { fontSize: 11 }. Returns a Blob (.docx). */
export async function writeDocx(inBook, opts = {}, onProgress) {
  const book = inBook.kind === 'comic' ? comicAsBook(inBook) : inBook
  const D = await docx()
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, Table, TableRow, TableCell, WidthType, AlignmentType, ExternalHyperlink, BorderStyle } = D
  const H = [null, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6]
  const size = Math.round((Number(opts.fontSize) || 11) * 2)
  const children = []
  const pics = new Map()

  const runOf = (r, extra = {}) => {
    if (r.br) return new TextRun({ break: 1 })
    const o = { text: r.text, bold: r.b || extra.bold || undefined, italics: r.i || undefined, underline: r.u ? {} : undefined, strike: r.s || undefined, superScript: r.sup || undefined, subScript: r.sub || undefined, font: r.code ? 'Courier New' : undefined }
    if (r.href && /^https?:\/\//i.test(r.href)) return new ExternalHyperlink({ link: r.href, children: [new TextRun({ ...o, color: '0563C1', underline: {} })] })
    return new TextRun(o)
  }
  const picture = async (src) => {
    if (pics.has(src)) return pics.get(src)
    const im = book.images.get(src)
    let out = null
    if (im) {
      try {
        let type = sniffImage(im.data) || im.type
        let data = im.data
        let dim = imageSize(data)
        if (!/^image\/(jpeg|png|gif|bmp)$/.test(type) || !dim) {
          const p = await toPng(data, type)
          data = p.data; type = 'image/png'; dim = { width: p.width, height: p.height }
        }
        const s = Math.min(1, 600 / dim.width, 820 / dim.height)
        out = { data, type: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/bmp': 'bmp' }[type], width: Math.max(1, Math.round(dim.width * s)), height: Math.max(1, Math.round(dim.height * s)) }
      } catch { out = null }
    }
    pics.set(src, out)
    return out
  }

  let pageBreak = false
  const add = (p) => children.push(p)
  const para = (runs, o = {}) => {
    const p = new Paragraph({ children: runs.map((r) => runOf(r, o)), pageBreakBefore: pageBreak || undefined, ...o.opts })
    pageBreak = false
    add(p)
  }

  // title page
  const coverPage = !!book.cover && !book.fixed && !startsWithPicture(book)
  if (coverPage) {
    const p = await picture((() => { const k = [...book.images.entries()].find(([, im]) => im.data === book.cover.data); if (k) return k[0]; book.images.set('images/__cover', { data: book.cover.data, type: book.cover.type }); return 'images/__cover' })())
    if (p) add(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: p.type, data: p.data, transformation: { width: p.width, height: p.height } })] }))
  }
  if (book.meta.title) add(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: book.meta.title })] }))
  if (book.meta.authors.length) add(new Paragraph({ children: [new TextRun({ text: book.meta.authors.join(', '), italics: true })] }))
  pageBreak = !!(book.meta.title || coverPage)

  const n = book.chapters.length
  for (let ci = 0; ci < n; ci++) {
    pageBreak = pageBreak || ci > 0 || coverPage
    for (const b of htmlToBlocks(book.chapters[ci].body)) {
      const left = (b.quote || 0) * 540
      if (b.t === 'h') para(b.runs, { bold: false, opts: { heading: H[Math.min(6, b.level)] } })
      else if (b.t === 'p') para(b.runs, { opts: { indent: left ? { left } : undefined, spacing: { after: 120 } } })
      else if (b.t === 'li') {
        para([{ text: `${b.marker}\t` }, ...b.runs], { opts: { indent: { left: 540 * (b.depth + 1) + left, hanging: 360 }, tabStops: [{ type: 'left', position: 540 * (b.depth + 1) + left }], spacing: { after: 60 } } })
      } else if (b.t === 'pre') {
        for (const line of b.text.split('\n')) para([{ text: line || ' ', code: true }], { opts: { spacing: { after: 0 }, indent: { left: 360 } } })
      } else if (b.t === 'hr') {
        add(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'AAAAAA', space: 1 } }, children: [] }))
      } else if (b.t === 'table') {
        const cols = Math.max(...b.rows.map((r) => r.length))
        add(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: b.rows.map((r) => new TableRow({ children: Array.from({ length: cols }, (_, k) => new TableCell({ children: [new Paragraph({ children: (r[k] || []).map((x) => runOf(x)) })] })) })),
        }))
        add(new Paragraph({ children: [] }))
      } else if (b.t === 'img') {
        const p = await picture(b.src)
        if (p) {
          add(new Paragraph({ alignment: AlignmentType.CENTER, pageBreakBefore: pageBreak || undefined, children: [new ImageRun({ type: p.type, data: p.data, transformation: { width: p.width, height: p.height }, altText: { title: b.alt || 'Picture', description: b.alt || 'Picture', name: 'Picture' } })] }))
          pageBreak = false
        }
      }
    }
    onProgress?.((ci + 1) / n * 0.9, 'Writing document')
    if (ci % 5 === 4) await yieldNow()
  }
  if (!children.length) throw fail('There is no text to put in a Word document.', 'EMPTY')
  const doc = new Document({
    creator: book.meta.authors.join(', ') || 'Unknown',
    title: book.meta.title || 'Untitled',
    description: book.meta.description || undefined,
    styles: { default: { document: { run: { size, font: 'Calibri' }, paragraph: { spacing: { line: 300 } } } } },
    sections: [{ children }],
  })
  onProgress?.(0.95, 'Packing')
  return Packer.toBlob(doc)
}

