// OCR helpers for the pdf-convert pack: a reusable tesseract worker that can also return a text-only PDF layer, and
// conversion of tesseract's paragraphs into layout blocks (for Word output).
import { tesseract } from '../../lib/libs.js'
export { OCR_LANGS } from '../../lib/ocr.js'

let worker = null, workerLang = null, progressCb = null

async function getWorker(lang) {
  if (worker && workerLang === lang) return worker
  if (worker) { try { await worker.terminate() } catch { /* already gone */ } worker = null }
  const T = await tesseract()
  const w = await T.createWorker(lang, 1, { logger: (m) => progressCb?.(m) })
  worker = w
  workerLang = lang
  return w
}

/**
 * recognizePage(canvas, {lang: 'eng' | 'eng+hin', onProgress(fraction, label), pdf: bool}) -> tesseract result data
 * With pdf: true, data.pdf holds a text-only PDF page (invisible text for a searchable PDF).
 */
export async function recognizePage(canvas, { lang = 'eng', onProgress, pdf = false } = {}) {
  progressCb = (m) => onProgress?.(m.progress ?? 0, m.status === 'recognizing text' ? 'Reading text' : 'Loading OCR engine')
  const w = await getWorker(lang)
  const { data } = await w.recognize(canvas, pdf ? { pdfTextOnly: true, pdfTitle: 'OCR' } : {}, { blocks: true, text: true, ...(pdf ? { pdf: true } : {}) })
  progressCb = null
  return data
}

export async function terminateOcr() {
  if (worker) { try { await worker.terminate() } catch { /* ignore */ } }
  worker = null
  workerLang = null
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0 }

/** Tesseract paragraphs -> layout blocks. `bodyPt` is the font size to give body text. */
export function ocrToBlocks(data, { bodyPt = 11 } = {}) {
  const paras = (data.blocks || []).flatMap((b) => (b.paragraphs || []))
  const heights = paras.flatMap((p) => (p.lines || []).map((l) => l.bbox.y1 - l.bbox.y0))
  const med = median(heights) || 1
  const left = paras.length ? Math.min(...paras.map((p) => p.bbox.x0)) : 0
  const blocks = []
  const MARK = /^([•●◦*-]|\d{1,2}[.)])\s+(.*)$/s
  const join = (a, t) => (!a ? t : /[A-Za-z]-$/.test(a) && /^[a-z]/.test(t) ? a.slice(0, -1) + t : `${a} ${t}`)
  for (const p of paras) {
    const lines = (p.lines || []).filter((l) => l.text.trim())
    if (!lines.length) continue
    const lh = median(lines.map((l) => l.bbox.y1 - l.bbox.y0))
    const ratio = lh / med
    const fs = Math.max(8, Math.min(30, bodyPt * ratio))
    const mk = (text) => ({ text, bold: false, italic: false, mono: false, sup: false, sub: false, fs })
    // split the paragraph into list items where lines start with a marker
    const groups = []
    for (const l of lines) {
      const t = l.text.replace(/\s+/g, ' ').trim()
      const m = t.match(MARK)
      if (m && lines.length >= 1 && p.bbox.x0 - left < 160) groups.push({ marker: m[1], text: m[2] })
      else if (groups.length) groups[groups.length - 1].text = join(groups[groups.length - 1].text, t)
      else groups.push({ marker: null, text: t })
    }
    for (const g of groups) {
      if (g.text.replace(/[^\p{L}\p{N}]/gu, '').length < 1) continue
      if (g.marker) { blocks.push({ type: 'li', ordered: /\d/.test(g.marker), marker: g.marker, level: 0, x: p.bbox.x0, runs: [mk(g.text)], fs }); continue }
      const isHeading = lines.length <= 2 && ratio >= 1.35 && g.text.split(/\s+/).length <= 14 && groups.length === 1
      if (isHeading) blocks.push({ type: 'heading', level: ratio >= 1.4 ? 1 : 2, runs: [{ ...mk(g.text), bold: true }], fs, text: g.text })
      else blocks.push({ type: 'p', runs: [mk(g.text)], align: 'left', indent: 0, firstIndent: 0, fs: bodyPt, x0: p.bbox.x0, text: g.text })
    }
  }
  return blocks
}
