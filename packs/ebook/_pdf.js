// PDF output: reflowed e-book text with pictures and headings (real text, Unicode fonts embedded), comics (one picture per page),
// and PDF -> CBZ page pictures. pdf-lib draws the pages; the fonts come from pdf-convert/_fonts.js (Noto, subsets fetched on demand).
import { pdfLib } from '../../lib/libs.js'
import { createFontSet, drawRuns } from '../pdf-convert/_fonts.js'
import { sniffImage, fail, startsWithPicture } from './_book.js'
import { htmlToBlocks, runsText } from './_blocks.js'
import { comicAsBook } from './_write.js'

const hasSystemText = (s) => SYSTEM.test(s)
export const PAGE_PRESETS = { A4: [595.28, 841.89], A5: [419.53, 595.28], A6: [297.64, 419.53], Letter: [612, 792] }
const yieldNow = () => new Promise((r) => setTimeout(r, 0))
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef\u3000-\u303f]/
// Scripts the bundled fonts do not cover are drawn by the browser's own text engine with the fonts installed on this device
const SYSTEM = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff\u0e00-\u0e7f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u3000-\u303f\uff00-\uffef]+/u
const SYSTEM_RUN = new RegExp('(' + SYSTEM.source + ')', 'u')
const RTL = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/g
const SYS_CSS = 'Noto Sans CJK SC", "Microsoft YaHei", "PingFang SC", "Hiragino Sans", "Yu Gothic", "Malgun Gothic", "Noto Sans Arabic", "Noto Sans Hebrew", "Noto Sans Thai", "Segoe UI", "Tahoma", "Arial Unicode MS", sans-serif, "x'
const measureCtx = (() => { let c; return () => (c ||= document.createElement('canvas').getContext('2d')) })()
const sysFace = (bold) => ({
  complex: true, css: SYS_CSS, bold,
  widthOfTextAtSize(text, size) { const g = measureCtx(); g.font = `${bold ? 700 : 400} 100px "${SYS_CSS}"`; return (g.measureText(text).width * size) / 100 },
  heightAtSize: (size) => size * 1.3, getCharacterSet: () => [],
})
const SYS_FACES = [sysFace(false), sysFace(true)]
/** Wrap a font set so characters it cannot draw (CJK, Arabic, Hebrew, Thai) use system fonts instead of becoming "?". */
export function withSystemFonts(fs) {
  const hasSys = (s) => SYSTEM.test(s)
  const runs = (str, style = {}) => {
    if (!hasSys(str)) return fs.runs(str, style)
    const out = []
    str.split(SYSTEM_RUN).forEach((part, i) => {
      if (!part) return
      if (i % 2) out.push({ text: part, font: SYS_FACES[style.bold ? 1 : 0] })
      else out.push(...fs.runs(part, style))
    })
    return out
  }
  const widths = new Map()
  return {
    ...fs, runs,
    width(str, size, style = {}) {
      if (!hasSys(str)) return fs.width(str, size, style)
      const k = `${+!!style.bold}|${size}|${str}`
      if (!widths.has(k)) { let w = 0; for (const r of runs(str, style)) w += r.font.widthOfTextAtSize(r.text, size); if (widths.size > 40000) widths.clear(); widths.set(k, w) }
      return widths.get(k)
    },
  }
}

/** Decode any picture format the browser knows into PNG or JPEG bytes for the PDF. */
async function reencode(data, type, { jpeg = false, quality = 0.9 } = {}) {
  const bmp = await createImageBitmap(new Blob([data], { type }))
  const c = document.createElement('canvas')
  c.width = bmp.width
  c.height = bmp.height
  const g = c.getContext('2d')
  if (jpeg) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height) }
  g.drawImage(bmp, 0, 0)
  bmp.close?.()
  const blob = await new Promise((r) => c.toBlob(r, jpeg ? 'image/jpeg' : 'image/png', quality))
  c.width = c.height = 0
  if (!blob) throw new Error('image encode')
  return { data: new Uint8Array(await blob.arrayBuffer()), type: jpeg ? 'image/jpeg' : 'image/png' }
}

async function embedPicture(doc, data, type, opts = {}) {
  const t = sniffImage(data) || type
  try {
    if (t === 'image/jpeg') return await doc.embedJpg(data)
    if (t === 'image/png' && opts.keepPng !== false) return await doc.embedPng(data)
    const re = await reencode(data, t, { jpeg: !(t === 'image/png' || t === 'image/gif' || t === 'image/webp' || t === 'image/svg+xml') || opts.jpeg === true, quality: opts.quality })
    return re.type === 'image/jpeg' ? await doc.embedJpg(re.data) : await doc.embedPng(re.data)
  } catch {
    return null
  }
}

// ---------- reflowed books ----------
/**
 * opts: { pageSize: 'A5'|'A6'|'A4'|'Letter', fontSize: 11, font: 'serif'|'sans', pageNumbers: true }
 * Returns a Blob (application/pdf).
 */
export async function writeBookPdf(inBook, opts = {}, onProgress) {
  const book = inBook.kind === 'comic' ? comicAsBook(inBook) : inBook
  const lib = await pdfLib()
  const { PDFDocument, rgb, PDFName, PDFHexString } = lib
  const doc = await PDFDocument.create()
  const [W, H] = PAGE_PRESETS[opts.pageSize] || PAGE_PRESETS.A5
  const size = Math.max(6, Math.min(30, Number(opts.fontSize) || 11))
  const margin = Math.round(Math.min(W, H) * 0.11)
  const innerW = W - margin * 2
  const bottom = margin + 6
  const top = H - margin
  const lead = 1.42
  const ink = rgb(0.07, 0.07, 0.09)
  const grey = rgb(0.5, 0.5, 0.55)

  const chBlocks = []
  let text = `${book.meta.title || ''} ${book.meta.authors.join(' ')}`
  for (let i = 0; i < book.chapters.length; i++) {
    const b = htmlToBlocks(book.chapters[i].body)
    chBlocks.push(b)
    for (const x of b) text += ' ' + (x.runs ? runsText(x.runs) : x.text || (x.rows ? x.rows.map((r) => r.map(runsText).join(' ')).join(' ') : ''))
    if (i % 40 === 39) await yieldNow()
  }
  onProgress?.(0.05, 'Loading fonts')
  const base = await createFontSet(doc, {
    family: opts.font === 'sans' ? 'sans' : 'serif', text,
    styles: [{ bold: false, italic: false }, { bold: true, italic: false }, { bold: false, italic: true }, { bold: true, italic: true }],
  })
  const fs = withSystemFonts(base)
  const sysUsed = hasSystemText(text)
  const unsupported = [...(base.unsupported || [])].filter((c) => !hasSystemText(c) && c.codePointAt(0) !== 0xfffd)

  let page = null, y = 0
  const startPage = () => { page = doc.addPage([W, H]); y = top; return page }
  const emptyPage = () => y === top
  const pictures = new Map()
  const picture = async (src) => {
    if (pictures.has(src)) return pictures.get(src)
    const im = book.images.get(src)
    const emb = im ? await embedPicture(doc, im.data, im.type, { keepPng: true }) : null
    pictures.set(src, emb)
    return emb
  }

  // cover
  const coverPage = !!book.cover && !book.fixed && !startsWithPicture(book)
  if (coverPage) {
    const emb = await embedPicture(doc, book.cover.data, book.cover.type)
    if (emb) {
      startPage()
      const s = Math.min(innerW / emb.width, (H - margin * 2) / emb.height)
      page.drawImage(emb, { x: (W - emb.width * s) / 2, y: (H - emb.height * s) / 2, width: emb.width * s, height: emb.height * s })
      y = bottom - 1
    }
  }

  const styleKey = (r, extra = {}) => ({ bold: !!(r.b || extra.bold), italic: !!(r.i || extra.italic) })
  const tokenize = (runs, extra) => {
    const toks = []
    for (const r of runs) {
      if (r.br) { toks.push({ br: true }); continue }
      const st = styleKey(r, extra)
      const f = r.sup || r.sub ? 0.7 : 1
      const parts = r.text.split(/(\s+)/)
      for (const p of parts) {
        if (!p) continue
        if (/^\s+$/.test(p)) { toks.push({ space: true, st, f }); continue }
        if (CJK.test(p)) { for (const ch of p) toks.push({ text: ch, st, f, sup: r.sup, sub: r.sub }) } else toks.push({ text: p, st, f, sup: r.sup, sub: r.sub })
      }
    }
    return toks
  }
  /** Break tokens into lines for a given width; returns [{items: [{text, st, f, w}], w}] */
  const breakLines = (toks, sz, avail) => {
    const lines = []
    let cur = { items: [], w: 0 }
    let space = null
    const wOf = (t) => fs.width(t.text, sz * (t.f || 1), t.st)
    for (const t of toks) {
      if (t.br) { lines.push(cur); cur = { items: [], w: 0 }; space = null; continue }
      if (t.space) { if (cur.items.length) space = t; continue }
      const w = wOf(t)
      const sw = space ? fs.width(' ', sz * (space.f || 1), space.st) : 0
      if (cur.items.length && cur.w + sw + w > avail) { lines.push(cur); cur = { items: [], w: 0 }; space = null }
      if (cur.items.length && space) { cur.items.push({ text: ' ', st: space.st, f: space.f, w: sw }); cur.w += sw }
      space = null
      if (w > avail) {
        // a word wider than the line: cut it into pieces
        let piece = ''
        for (const ch of t.text) {
          if (piece && fs.width(piece + ch, sz * (t.f || 1), t.st) > avail) {
            const pw = fs.width(piece, sz * (t.f || 1), t.st)
            if (cur.items.length) { lines.push(cur); cur = { items: [], w: 0 } }
            cur.items.push({ ...t, text: piece, w: pw }); cur.w = pw
            lines.push(cur); cur = { items: [], w: 0 }
            piece = ch
          } else piece += ch
        }
        if (piece) { const pw = fs.width(piece, sz * (t.f || 1), t.st); cur.items.push({ ...t, text: piece, w: pw }); cur.w += pw }
      } else { cur.items.push({ ...t, w }); cur.w += w }
    }
    if (cur.items.length || !lines.length) lines.push(cur)
    return lines
  }
  const drawLine = async (line, x, yy, sz, extraBold, right = null) => {
    if (right != null) {
      // right-to-left paragraphs: words run from the right margin leftwards
      let rx = right - line.w
      for (const it of [...line.items].reverse()) {
        await drawRuns(doc, page, fs.runs(it.text, { bold: it.st.bold || extraBold, italic: it.st.italic }), { x: rx, y: yy, size: sz * (it.f || 1), color: ink, bold: it.st.bold || extraBold })
        rx += it.w
      }
      return
    }
    // merge neighbours that share a style and baseline shift into one text run
    let i = 0
    let cx = x
    while (i < line.items.length) {
      const it = line.items[i]
      let txt = it.text, w = it.w, j = i + 1
      while (j < line.items.length && line.items[j].st.bold === it.st.bold && line.items[j].st.italic === it.st.italic && line.items[j].f === it.f && !!line.items[j].sup === !!it.sup && !!line.items[j].sub === !!it.sub) { txt += line.items[j].text; w += line.items[j].w; j++ }
      const fsz = sz * (it.f || 1)
      const dy = it.sup ? sz * 0.35 : it.sub ? -sz * 0.15 : 0
      await drawRuns(doc, page, fs.runs(txt, { bold: it.st.bold || extraBold, italic: it.st.italic }), { x: cx, y: yy + dy, size: fsz, color: ink, bold: it.st.bold || extraBold })
      cx += w
      i = j
    }
  }
  const lineCount = { n: 0 }
  const para = async (runs, { sz = size, indent = 0, bold = false, hang = 0, marker = null, before = 0, after = size * 0.55, keep = 0 } = {}) => {
    const toks = tokenize(runs, { bold })
    const sample = runsText(runs)
    const rtl = (sample.match(RTL) || []).length > (sample.match(/[A-Za-z\u00c0-\u024f\u0400-\u04ff]/g) || []).length
    const lines = breakLines(toks, sz, innerW - indent - hang)
    const lh = sz * lead
    if (!page) startPage()
    if (!emptyPage()) y -= before
    if (y - lh * (1 + keep) < bottom) { startPage() }
    for (let k = 0; k < lines.length; k++) {
      if (y - lh < bottom) startPage()
      y -= lh
      if (k === 0 && marker) await drawRuns(doc, page, fs.runs(marker, { bold: false }), { x: margin + indent, y: y + lh * 0.2, size: sz, color: ink })
      await drawLine(lines[k], margin + indent + hang, y + lh * 0.2, sz, bold, rtl ? margin + innerW - (indent) : null)
      lineCount.n++
    }
    y -= after
  }

  const sizes = { 1: 1.7, 2: 1.4, 3: 1.2, 4: 1.1, 5: 1.05, 6: 1 }
  const pageOfChapter = []
  const total = book.chapters.length
  for (let ci = 0; ci < total; ci++) {
    if (!page || !emptyPage()) startPage()
    pageOfChapter[ci] = doc.getPageCount() - 1
    let first = true
    for (const b of chBlocks[ci]) {
      if (b.t === 'h') {
        const sz = size * sizes[b.level]
        await para(b.runs, { sz, bold: true, before: first ? sz * 0.6 : sz * 0.9, after: sz * 0.45, keep: 2 })
      } else if (b.t === 'p') {
        await para(b.runs, { indent: (b.quote || 0) * size * 1.6 })
      } else if (b.t === 'li') {
        await para(b.runs, { indent: size * 1.2 * (b.depth + 1) + (b.quote || 0) * size, hang: size * 1.3, marker: b.marker, after: size * 0.25 })
      } else if (b.t === 'pre') {
        const sz = size * 0.88
        for (const line of b.text.split('\n')) {
          const toks = [{ text: line.replace(/\t/g, '    ') || ' ', st: { bold: false, italic: false }, f: 1 }]
          const ls = breakLines(toks, sz, innerW - size * 0.5)
          for (const l of ls) {
            if (!page) startPage()
            if (y - sz * 1.3 < bottom) startPage()
            y -= sz * 1.3
            await drawLine(l, margin + size * 0.5, y + sz * 0.25, sz, false)
          }
        }
        y -= size * 0.6
      } else if (b.t === 'hr') {
        if (!page) startPage()
        if (y - size * 2 < bottom) startPage()
        y -= size
        page.drawLine({ start: { x: margin + innerW * 0.3, y }, end: { x: margin + innerW * 0.7, y }, thickness: 0.6, color: grey })
        y -= size
      } else if (b.t === 'table') {
        for (const row of b.rows) {
          const runs = []
          row.forEach((cell, k) => { if (k) runs.push({ text: '   |   ', b: false }); runs.push(...cell) })
          await para(runs, { after: size * 0.2 })
        }
        y -= size * 0.4
      } else if (b.t === 'img') {
        const emb = await picture(b.src)
        if (!emb) { first = false; continue }
        if (!page) startPage()
        const maxH = top - bottom
        const s = Math.min(1, innerW / emb.width, maxH / emb.height)
        const w = emb.width * s, h = emb.height * s
        if (y - h < bottom) startPage()
        y -= h
        page.drawImage(emb, { x: margin + (innerW - w) / 2, y, width: w, height: h })
        y -= size * 0.8
      }
      first = false
    }
    onProgress?.(0.1 + ((ci + 1) / total) * 0.8, 'Laying out pages')
    if (ci % 4 === 3) await yieldNow()
  }
  if (!doc.getPageCount()) startPage()

  // page numbers
  if (opts.pageNumbers !== false) {
    const pages = doc.getPages()
    const startAt = coverPage ? 1 : 0
    for (let i = startAt; i < pages.length; i++) {
      const label = String(i - startAt + 1)
      const f = fs.runs(label)
      const w = fs.width(label, 8)
      await drawRuns(doc, pages[i], f, { x: (W - w) / 2, y: margin * 0.5, size: 8, color: grey, rgbCss: '#80808c' })
    }
  }
  // bookmarks
  try {
    const pages = doc.getPages()
    const conv = (list, depth) => list.slice(0, 600).map((t) => ({ title: t.title || 'Untitled', page: Math.min(pages.length - 1, pageOfChapter[t.ch] ?? 0), children: depth < 3 ? conv(t.children || [], depth + 1) : [] }))
    const items = conv(book.toc, 1)
    if (items.length) {
      const ctx = doc.context
      const make = (list, parentRef) => {
        let total = list.length
        const refs = list.map(() => ctx.nextRef())
        list.forEach((it, i) => {
          const dict = ctx.obj({ Title: PDFHexString.fromText(it.title), Parent: parentRef, Dest: [pages[it.page].ref, PDFName.of('XYZ'), null, null, null] })
          if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1])
          if (i < list.length - 1) dict.set(PDFName.of('Next'), refs[i + 1])
          const sub = it.children.length ? make(it.children, refs[i]) : null
          if (sub) { dict.set(PDFName.of('First'), sub.first); dict.set(PDFName.of('Last'), sub.last); dict.set(PDFName.of('Count'), ctx.obj(sub.count)); total += sub.count }
          ctx.assign(refs[i], dict)
        })
        return { first: refs[0], last: refs[refs.length - 1], count: total }
      }
      const rootRef = ctx.nextRef()
      const kids = make(items, rootRef)
      ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: kids.first, Last: kids.last, Count: kids.count }))
      doc.catalog.set(PDFName.of('Outlines'), rootRef)
    }
  } catch { /* bookmarks are optional */ }

  doc.setTitle(book.meta.title || 'Untitled')
  if (book.meta.authors.length) doc.setAuthor(book.meta.authors.join(', '))
  if (book.meta.language) { try { doc.setLanguage(book.meta.language) } catch { /* ignore */ } }
  doc.setProducer('E-book to PDF converter')
  doc.setCreator('E-book to PDF converter')
  onProgress?.(0.95, 'Saving')
  const bytes = await doc.save()
  const out = new Blob([bytes], { type: 'application/pdf' })
  out.notes = [
    ...(sysUsed ? ['Chinese, Japanese, Korean, Arabic, Hebrew and Thai text is drawn with fonts installed on this device and is saved as pictures, so it cannot be selected or searched in the PDF.'] : []),
    ...(unsupported.length ? [`Some characters have no glyph in the built-in fonts and show as "?": ${unsupported.slice(0, 8).join(' ')}`] : []),
  ]
  return out
}

// ---------- comics ----------
/**
 * Comic -> PDF, one picture per page, in reading order.
 * opts: { pageSize: 'fit' | 'A4' | 'A5' | 'Letter', images: 'smart' | 'jpeg', quality: 0.9 }
 * 'smart' keeps JPEG and PNG pictures as they are and converts everything else; 'jpeg' re-encodes PNG pages as JPEG to make the file smaller.
 */
export async function writeComicPdf(comic, opts = {}, onProgress) {
  const { PDFDocument } = await pdfLib()
  const doc = await PDFDocument.create()
  const preset = PAGE_PRESETS[opts.pageSize]
  const n = comic.pages.length
  for (let i = 0; i < n; i++) {
    const p = comic.pages[i]
    const emb = await embedPicture(doc, p.data, p.type, { keepPng: opts.images !== 'jpeg', jpeg: opts.images === 'jpeg' && sniffImage(p.data) !== 'image/jpeg', quality: opts.quality || 0.9 })
    if (!emb) { comic.skipped = (comic.skipped || 0) + 1; continue }
    const iw = emb.width, ih = emb.height
    let pw, ph
    if (preset) { [pw, ph] = iw > ih ? [preset[1], preset[0]] : preset } else { pw = iw <= ih ? 595.28 : 841.89; ph = pw * (ih / iw) }
    const page = doc.addPage([pw, ph])
    const s = Math.min(pw / iw, ph / ih)
    page.drawImage(emb, { x: (pw - iw * s) / 2, y: (ph - ih * s) / 2, width: iw * s, height: ih * s })
    onProgress?.((i + 1) / n, `Page ${i + 1} of ${n}`)
    if (i % 3 === 2) await yieldNow()
  }
  if (!doc.getPageCount()) throw fail('None of the pictures in this comic could be read.', 'BAD')
  doc.setTitle(comic.meta?.title || 'Comic')
  if (comic.meta?.authors?.length) doc.setAuthor(comic.meta.authors.join(', '))
  doc.setProducer('E-book to PDF converter')
  const out = new Blob([await doc.save()], { type: 'application/pdf' })
  out.notes = comic.skipped ? [`${comic.skipped} picture(s) could not be read and were left out.`] : []
  return out
}

