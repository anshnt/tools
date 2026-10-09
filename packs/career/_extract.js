// Text extraction from resumes and job descriptions: PDF (pdf.js), DOCX (mammoth) and plain text. Also reports layout red flags
// (columns, tables, images, scanned pages) that matter to applicant tracking systems. Everything stays on this device.
import { openPdf } from '../../lib/pdf.js'
import { mammoth } from '../../lib/libs.js'
import { ext } from '../../lib/files.js'

/** Rebuild reading-order lines from pdf.js text items: [{y, x, text, segs:[{x, text}]}]. */
export function pdfLines(items) {
  const rows = []
  for (const it of items) {
    if (!('str' in it) || !it.str.trim() && it.str !== ' ') continue
    const x = it.transform[4], y = it.transform[5], fs = Math.abs(it.transform[3]) || it.height || 10
    let row = rows.find((r) => Math.abs(r.y - y) <= Math.max(1.8, fs * 0.35))
    if (!row) rows.push((row = { y, fs, parts: [] }))
    row.parts.push({ x, w: it.width, text: it.str, fs })
  }
  rows.sort((a, b) => b.y - a.y)
  for (const r of rows) {
    r.parts.sort((a, b) => a.x - b.x)
    let text = '', prev = null
    const segs = []
    for (const p of r.parts) {
      const gap = prev ? p.x - (prev.x + prev.w) : 0
      if (prev && gap > 0.14 * p.fs && !text.endsWith(' ') && !p.text.startsWith(' ')) text += ' '
      if (!prev || gap > 24) segs.push({ x: p.x, text: p.text })
      else segs.at(-1).text += (gap > 0.14 * p.fs && !segs.at(-1).text.endsWith(' ') ? ' ' : '') + p.text
      text += p.text
      prev = p
    }
    r.text = text.replace(/\s+/g, ' ').trim()
    r.x = r.parts[0]?.x ?? 0
    r.segs = segs
  }
  return rows.filter((r) => r.text)
}

function columnRows(rows, pageW) {
  let n = 0
  for (const r of rows) {
    if (r.segs.length < 2) continue
    const right = r.segs[1]
    if (right.x > pageW * 0.28 && right.x < pageW * 0.72 && right.text.length > 22) n++
  }
  return n
}

/** Extract text + layout info from a File. Throws friendly errors. */
export async function extractFile(file, { password, onProgress } = {}) {
  const e = ext(file.name)
  if (e === 'pdf' || file.type === 'application/pdf') {
    const doc = await openPdf(file, { password })
    const out = []
    let colRows = 0, totalRows = 0, chars = 0, links = 0
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const tc = await page.getTextContent()
      const vp = page.getViewport({ scale: 1 })
      const rows = pdfLines(tc.items)
      let text = '', last = null
      for (const r of rows) {
        if (last && last.y - r.y > last.fs * 2.1) text += '\n'
        text += r.text + '\n'
        last = r
      }
      const annots = await page.getAnnotations().catch(() => [])
      links += annots.filter((a) => a.subtype === 'Link').length
      out.push(text)
      colRows += columnRows(rows, vp.width)
      totalRows += rows.length
      chars += text.replace(/\s/g, '').length
      onProgress?.(i / doc.numPages)
    }
    const pages = doc.numPages
    closePdf(doc)
    return {
      kind: 'pdf', name: file.name, size: file.size, text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), pages,
      info: { columns: totalRows > 12 && colRows >= 5 && colRows / totalRows > 0.12, scanned: chars < 80 * pages, links },
    }
  }
  if (e === 'docx') {
    const m = await mammoth()
    const buf = await file.arrayBuffer()
    const [raw, html] = await Promise.all([m.extractRawText({ arrayBuffer: buf.slice(0) }), m.convertToHtml({ arrayBuffer: buf.slice(0) })])
    return {
      kind: 'docx', name: file.name, size: file.size, text: raw.value.replace(/\n{3,}/g, '\n\n').trim(), pages: null,
      info: { tables: (html.value.match(/<table/g) || []).length, images: (html.value.match(/<img/g) || []).length, links: (html.value.match(/<a /g) || []).length, columns: false, scanned: false },
    }
  }
  if (e === 'doc' || e === 'pages' || e === 'odt' || e === 'rtf') throw new Error(`.${e} files are not supported here. Save the resume as PDF or DOCX first, or paste its text.`)
  if (['txt', 'md', 'text', ''].includes(e) || file.type.startsWith('text/')) {
    return { kind: 'text', name: file.name, size: file.size, text: (await file.text()).replace(/\r/g, '').trim(), pages: null, info: {} }
  }
  throw new Error('Use a PDF, DOCX or plain text file.')
}

/** Release a pdf.js document (the method lives on the loading task in recent versions). */
export const closePdf = (d) => {
  try {
    if (d?.loadingTask?.destroy) d.loadingTask.destroy()
    else d?.destroy?.()
  } catch { /* already closed */ }
}

export const ACCEPT = '.pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain'
