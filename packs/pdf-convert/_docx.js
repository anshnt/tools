// Layout blocks (from _layout.js analyze() or OCR) -> a real .docx with heading styles, lists, tables, pictures and hyperlinks.
import { docx as docxLib } from '../../lib/libs.js'

const FAMILIES = [
  [/arial|helvetica|swiss|liberation\s*sans|nimbus\s*sans/i, 'Arial'], [/times|nimbus\s*roman|liberation\s*serif/i, 'Times New Roman'], [/courier|nimbus\s*mono/i, 'Courier New'],
  [/calibri|carlito/i, 'Calibri'], [/cambria|caladea/i, 'Cambria'], [/georgia/i, 'Georgia'], [/verdana/i, 'Verdana'], [/tahoma/i, 'Tahoma'], [/trebuchet/i, 'Trebuchet MS'],
  [/garamond/i, 'Garamond'], [/palatino|book\s*antiqua|bookman/i, 'Palatino Linotype'], [/segoe/i, 'Segoe UI'], [/consolas/i, 'Consolas'], [/century/i, 'Century Schoolbook'],
  [/lato|roboto|open\s*sans|noto\s*sans|inter\b|source\s*sans|opensans/i, 'Calibri'],
]
/** Map a PDF font name to a font Word will have. */
export function wordFont(name = '', { mono, serif } = {}) {
  if (mono) return 'Courier New'
  for (const [re, fam] of FAMILIES) if (re.test(name)) return fam
  return serif ? 'Times New Roman' : 'Calibri'
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0 }
const NUMERIC = /^[\s$€£₹(+-]*\d[\d.,\s]*%?\)?$/

/**
 * blocksToDocx({pages, body, bodyFont, sizes, pageBreaks, fonts: 'match' | 'Calibri' | ..., title}) -> Blob
 * pages: [{width, height, bounds, blocks}] in PDF points.
 */
export async function blocksToDocx({ pages, body = 11, bodyFont = '', bodySerif = false, sizes = [], pageBreaks = false, fonts = 'match', title = '', margins }) {
  const D = await docxLib()
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, ImageRun, ExternalHyperlink, LevelFormat, VerticalAlign } = D
  const bodyFam = fonts === 'match' ? wordFont(bodyFont, { serif: bodySerif }) : fonts
  const pw = pages[0]?.width || 595, ph = pages[0]?.height || 842
  const bs = pages.map((p) => p.bounds).filter(Boolean)
  const m = margins || {
    left: clamp(median(bs.map((b) => b.x0)) || 72, 36, 144), right: clamp(median(bs.map((b, i) => (pages[i]?.width || pw) - b.x1)) || 72, 36, 144),
    top: clamp(median(bs.map((b) => b.y0)) || 72, 36, 108), bottom: clamp(median(bs.map((b, i) => (pages[i]?.height || ph) - b.y1)) || 72, 36, 108),
  }
  const contentTw = Math.round((pw - m.left - m.right) * 20)
  const contentPt = pw - m.left - m.right

  // numbering: one bullet definition, and a fresh decimal list for every ordered list
  const numbering = [{
    reference: 'bullets', levels: [0, 1, 2].map((level) => ({ level, format: LevelFormat.BULLET, text: ['•', '◦', '▪'][level], alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540 + level * 360, hanging: 270 } } } })),
  }]
  let listN = 0
  const newOrdered = (start) => {
    const reference = `ol-${++listN}`
    numbering.push({ reference, levels: [0, 1, 2].map((level) => ({ level, format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level], text: `%${level + 1}.`, start: level === 0 ? start : 1, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540 + level * 360, hanging: 360 } } } })) })
    return reference
  }

  const hFam = (name) => (fonts === 'match' ? wordFont(name) : fonts)
  const sizeFor = (level) => (level <= sizes.length ? sizes[level - 1] : Math.max(body, body * 1.05))
  const heading = (level) => ({ run: { size: Math.round(sizeFor(level) * 2), bold: true, color: '000000', font: bodyFam }, paragraph: { spacing: { before: level === 1 ? 360 : 240, after: 120 }, keepNext: true, outlineLevel: level - 1 } })

  const makeRuns = (runs, base) => {
    const out = []
    for (const r of runs) {
      if (!r.text) continue
      const o = { text: r.text, bold: r.bold || undefined, italics: r.italic || undefined, superScript: r.sup || undefined, subScript: r.sub || undefined }
      const fam = r.mono ? 'Courier New' : fonts === 'match' ? wordFont(r.font, r) : fonts
      if (fam !== bodyFam) o.font = fam
      if (base && Math.abs((r.fs || base) - base) > 0.7) o.size = Math.round(r.fs * 2)
      if (r.url) { o.color = '0563C1'; o.underline = {} }
      const tr = new TextRun(o)
      out.push(r.url ? new ExternalHyperlink({ link: r.url, children: [tr] }) : tr)
    }
    return out
  }

  const alignOf = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT }
  const edge = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' }
  const children = []
  let breakNext = false
  const push = (el, isPara) => {
    if (breakNext && !isPara) children.push(new Paragraph({ pageBreakBefore: true, spacing: { after: 0, line: 20 }, children: [] }))
    children.push(el)
    breakNext = false
  }
  const brk = () => (breakNext ? { pageBreakBefore: true } : {})

  let currentList = null // { ref, ordered }
  pages.forEach((page, pi) => {
    if (pi > 0 && pageBreaks) { breakNext = true; currentList = null }
    for (const b of page.blocks) {
      if (b.type !== 'li') currentList = null
      if (b.type === 'heading') {
        push(new Paragraph({ heading: HeadingLevel[`HEADING_${Math.min(6, b.level)}`], children: makeRuns(b.runs, 0), ...brk() }), true)
      } else if (b.type === 'li') {
        const ordered = b.ordered
        if (!currentList || currentList.ordered !== ordered) {
          const first = parseInt(String(b.marker).replace(/\D/g, ''), 10)
          currentList = { ordered, ref: ordered ? newOrdered(Number.isFinite(first) ? first : 1) : 'bullets' }
        }
        push(new Paragraph({ children: makeRuns(b.runs, body), numbering: { reference: currentList.ref, level: Math.min(2, b.level || 0) }, spacing: { after: 60 }, ...brk() }), true)
      } else if (b.type === 'code') {
        const lines = b.text.split('\n')
        push(new Paragraph({ children: lines.map((ln, i) => new TextRun({ text: ln, font: 'Courier New', size: Math.round(Math.min(b.fs || 10, 10) * 2), break: i ? 1 : undefined })), shading: { type: ShadingType.CLEAR, fill: 'F2F2F2' }, spacing: { after: 160 }, ...brk() }), true)
      } else if (b.type === 'table') {
        const cols = b.cols
        const w = Math.floor(contentTw / cols)
        const spans = new Map(b.merges.map((s) => [`${s.r}:${s.c}`, s.span]))
        const rows = b.rows.map((cells, r) => {
          const tcs = []
          for (let c = 0; c < cols;) {
            const span = spans.get(`${r}:${c}`) || 1
            const text = cells[c] || ''
            const head = r === 0 && b.boldRows[0]
            tcs.push(new TableCell({
              columnSpan: span > 1 ? span : undefined, width: { size: w * span, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER,
              margins: { top: 50, bottom: 50, left: 100, right: 100 }, shading: head ? { type: ShadingType.CLEAR, fill: 'F2F2F2' } : undefined,
              children: [new Paragraph({ alignment: NUMERIC.test(text) && text.trim() ? AlignmentType.RIGHT : AlignmentType.LEFT, spacing: { after: 0 }, children: [new TextRun({ text, bold: head || (b.boldRows[r] && b.boldRows.filter(Boolean).length < b.rows.length) || undefined, size: Math.round(body * 1.9) })] })],
            }))
            c += span
          }
          return new TableRow({ children: tcs, tableHeader: r === 0 && b.boldRows[0] })
        })
        push(new Table({ rows, width: { size: contentTw, type: WidthType.DXA }, columnWidths: new Array(cols).fill(w), borders: { top: edge, bottom: edge, left: edge, right: edge, insideHorizontal: edge, insideVertical: edge } }), false)
        children.push(new Paragraph({ spacing: { after: 120 }, children: [] }))
      } else if (b.type === 'image') {
        const wPt = Math.min(b.width, contentPt), hPt = wPt * (b.height / b.width)
        push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, ...brk(), children: [new ImageRun({ type: 'png', data: b.data, transformation: { width: Math.round(wPt * 96 / 72), height: Math.round(hPt * 96 / 72) } })] }), true)
      } else {
        const o = { children: makeRuns(b.runs, body), alignment: alignOf[b.align] || AlignmentType.LEFT, ...brk() }
        const left = b.align === 'left' ? Math.round((b.indent || 0) * 20) : 0
        if (left > 200) o.indent = { left: Math.min(left, 3600) }
        if (b.firstIndent > body * 0.8 && b.align === 'left') o.indent = { ...(o.indent || {}), firstLine: Math.round(b.firstIndent * 20) }
        push(new Paragraph(o), true)
      }
    }
  })
  if (!children.length) children.push(new Paragraph({ children: [] }))

  const doc = new Document({
    creator: 'Tools', title: title || undefined, description: 'Converted from PDF in the browser',
    styles: { default: { document: { run: { font: bodyFam, size: Math.round(body * 2) }, paragraph: { spacing: { after: 120, line: 276 } } }, heading1: heading(1), heading2: heading(2), heading3: heading(3), heading4: heading(4), heading5: heading(5), heading6: heading(6) } },
    numbering: { config: numbering },
    sections: [{ properties: { page: { size: { width: Math.round(pw * 20), height: Math.round(ph * 20) }, margin: { top: Math.round(m.top * 20), bottom: Math.round(m.bottom * 20), left: Math.round(m.left * 20), right: Math.round(m.right * 20) } } }, children }],
  })
  return Packer.toBlob(doc)
}
