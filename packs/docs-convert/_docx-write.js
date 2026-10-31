// Blocks (see _ast.js) -> a .docx file with the docx library: headings, runs with styles, links, lists, tables (spans, shading), pictures, quotes, code.
import { docx as docxLib, jszip } from '../../lib/libs.js'

const HEADING = ['HEADING_1', 'HEADING_2', 'HEADING_3', 'HEADING_4', 'HEADING_5', 'HEADING_6']
const IMG_TYPE = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp' }
const MAX_W_PX = 600

export async function astToDocx(blocks, { title = '', creator = 'Toolverse', font = 'Calibri', size = 11, landscape = false } = {}) {
  const D = await docxLib()
  const { Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, AlignmentType, HeadingLevel, ExternalHyperlink, LevelFormat, BorderStyle, ShadingType, PageBreak, Tab, VerticalAlign, TableLayoutType, PageOrientation } = D

  const ALIGN = { left: AlignmentType.LEFT, right: AlignmentType.RIGHT, center: AlignmentType.CENTER, justify: AlignmentType.JUSTIFIED }
  const listInst = { ordered: 0 }
  let lastOrderedN = new Map()
  let prevWasList = false

  const makeRun = (r, base = {}) => {
    if (r.br) return new TextRun({ break: 1 })
    if (r.tab) return new TextRun({ children: [new Tab()] })
    if (r.img) {
      const type = IMG_TYPE[r.img.mime]
      if (!type) return new TextRun({ text: r.img.alt ? `[${r.img.alt}]` : '' })
      let w = r.img.w || 200, h = r.img.h || 150
      if (w > MAX_W_PX) { h = Math.round((h * MAX_W_PX) / w); w = MAX_W_PX }
      return new ImageRun({ type, data: r.img.bytes, transformation: { width: Math.max(1, w), height: Math.max(1, h) }, altText: { title: r.img.alt || 'image', description: r.img.alt || 'image', name: 'image' } })
    }
    const o = { text: r.text || '', ...base }
    if (r.b) o.bold = true
    if (r.i) o.italics = true
    if (r.u) o.underline = {}
    if (r.s) o.strike = true
    if (r.sup) o.superScript = true
    if (r.sub) o.subScript = true
    if (r.color) o.color = r.color
    if (r.bg) o.shading = { type: ShadingType.CLEAR, fill: r.bg, color: 'auto' }
    if (r.size) o.size = Math.round(r.size * 2)
    if (r.font) o.font = r.font
    if (r.mono && !r.font) o.font = 'Consolas'
    if (r.href) { o.color = o.color || '0563C1'; o.underline = {} }
    return new TextRun(o)
  }
  const makeRuns = (runs, base) => {
    const out = []
    let i = 0
    while (i < runs.length) {
      const r = runs[i]
      if (r.href && !r.img) {
        const group = []
        while (i < runs.length && runs[i].href === r.href && !runs[i].img) group.push(makeRun(runs[i++], base))
        out.push(new ExternalHyperlink({ link: r.href, children: group }))
      } else { out.push(makeRun(r, base)); i++ }
    }
    return out.length ? out : [new TextRun({ text: '' })]
  }

  const numberingLevels = (ordered) => Array.from({ length: 9 }, (_, level) => ({
    level,
    format: ordered ? [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3] : LevelFormat.BULLET,
    text: ordered ? `%${level + 1}.` : ['•', '◦', '▪'][level % 3],
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } },
  }))

  const para = (b) => {
    const o = { children: makeRuns(b.runs, b.code ? { font: 'Consolas', size: Math.round(size * 2 * 0.9) } : {}) }
    if (b.level) o.heading = HeadingLevel[HEADING[b.level - 1]]
    if (b.align) o.alignment = ALIGN[b.align]
    if (b.code) o.shading = { type: ShadingType.CLEAR, fill: 'F3F3F5', color: 'auto' }
    if (b.code) o.spacing = { after: 0 }
    if (b.quote) { o.indent = { left: 567 * b.quote }; o.border = { left: { style: BorderStyle.SINGLE, size: 12, color: 'B8B8C4', space: 8 } } }
    if (b.list) {
      if (b.task !== undefined) o.children.unshift(new TextRun({ text: b.task ? '☑ ' : '☐ ' }))
      if (b.list.ordered) {
        const key = b.list.level
        if (!prevWasList || b.list.n <= (lastOrderedN.get(key) ?? 0)) listInst.ordered++
        lastOrderedN.set(key, b.list.n)
        o.numbering = { reference: 'num', level: Math.min(8, b.list.level), instance: listInst.ordered }
      } else o.numbering = { reference: 'bul', level: Math.min(8, b.list.level) }
    } else if (b.cont != null) o.indent = { left: 720 + (b.cont + 1) * 360 }
    prevWasList = !!b.list || b.cont != null
    if (!b.list) lastOrderedN = new Map()
    return new Paragraph(o)
  }

  const tableOf = (t) => {
    const ncols = Math.max(...t.rows.map((r) => r.reduce((n, c) => n + c.colspan, 0)), 1)
    const weights = new Array(ncols).fill(4)
    for (const row of t.rows) { let ci = 0; for (const c of row) { if (c.colspan === 1) weights[ci] = Math.max(weights[ci], Math.min(40, c.blocks.map((b) => (b.runs || []).map((r) => r.text || '').join('')).join(' ').length)); ci += c.colspan } }
    const total = 9000, wsum = weights.reduce((a, b) => a + b, 0)
    const widths = weights.map((w) => Math.max(500, Math.round((w / wsum) * total)))
    const border = t.border ? { style: BorderStyle.SINGLE, size: 4, color: 'BBBBBB' } : { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
    const borders = { top: border, bottom: border, left: border, right: border }
    const rows = t.rows.map((row) => {
      let ci = 0
      return new TableRow({
        children: row.map((c) => {
          const w = widths.slice(ci, ci + c.colspan).reduce((a, b) => a + b, 0)
          ci += c.colspan
          const children = blocksOf(c.blocks, true)
          return new TableCell({
            children: children.length ? children : [new Paragraph({})], columnSpan: c.colspan > 1 ? c.colspan : undefined, rowSpan: c.rowspan > 1 ? c.rowspan : undefined,
            width: { size: w, type: WidthType.DXA }, borders, verticalAlign: VerticalAlign.TOP,
            shading: c.bg ? { type: ShadingType.CLEAR, fill: c.bg, color: 'auto' } : c.th && t.border ? { type: ShadingType.CLEAR, fill: 'F1F1F5', color: 'auto' } : undefined,
            margins: { top: 40, bottom: 40, left: 80, right: 80 },
          })
        }),
      })
    })
    return new Table({ rows, width: { size: total, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED })
  }

  function blocksOf(list, inCell = false) {
    const out = []
    for (const b of list) {
      if (b.t === 'p') out.push(para(b))
      else if (b.t === 'table') { out.push(tableOf(b)); if (!inCell) out.push(new Paragraph({ spacing: { after: 0 }, children: [] })); else out.push(new Paragraph({ spacing: { after: 0 }, children: [] })); prevWasList = false }
      else if (b.t === 'hr') { out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'AAAAAA', space: 1 } }, children: [] })); prevWasList = false }
      else if (b.t === 'pagebreak') out.push(new Paragraph({ children: [new PageBreak()] }))
    }
    return out
  }

  const children = blocksOf(blocks)
  if (!children.length) children.push(new Paragraph({ children: [new TextRun('')] }))
  const doc = new Document({
    creator, title: title || undefined,
    numbering: { config: [{ reference: 'bul', levels: numberingLevels(false) }, { reference: 'num', levels: numberingLevels(true) }] },
    styles: { default: { document: { run: { font, size: size * 2 }, paragraph: { spacing: { after: 120, line: 276 } } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838, orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children }],
  })
  const raw = new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer())
  // the library leaves out a default "Normal" paragraph style, which strict readers expect
  const JSZip = await jszip()
  const zip = await JSZip.loadAsync(raw)
  const styles = await zip.file('word/styles.xml').async('string')
  if (!/w:styleId="Normal"/.test(styles)) {
    zip.file('word/styles.xml', styles.replace(/<w:style /, '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style '))
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  }
  return raw
}
