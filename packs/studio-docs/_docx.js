// Export a document to .docx with the docx library, walking the editor's document tree (not HTML) so structure maps 1:1.
import { docx as loadDocx, jszip } from '../../lib/libs.js'
import { base64ToBytes } from '../../lib/files.js'
import { loadImage, toCanvas, toBlob } from '../../lib/image.js'
import { PAPERS, TWIPS_PER_MM, contentWidthPx } from './_page.js'
import { imageSize } from './_img.js'

const hex = (c) => String(c || '000000').replace('#', '').toUpperCase()
const half = (pt) => Math.round(pt * 2)
const LINK_BLUE = '1558D6'
const BULLETS = ['•', '◦', '▪']

/** Build the .docx Blob. Returns {blob, notes} where notes lists things that could not be carried over. */
export async function buildDocx(doc, settings, title) {
  const D = await loadDocx()
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, ImageRun, ExternalHyperlink, PageBreak, BorderStyle,
    LevelFormat, UnderlineType, ShadingType, Header, Footer, PageNumber, TableLayoutType, TabStopType, Tab, PageOrientation, LineRuleType } = D
  const notes = []
  let listInstance = 0
  const contentTwips = Math.round(contentWidthPx(settings) * 15)

  // ---------- inline ----------
  const runProps = (marks, base = {}) => {
    const o = { ...base }
    for (const m of marks) {
      const a = m.attrs
      switch (m.type.name) {
        case 'strong': o.bold = true; break
        case 'em': o.italics = true; break
        case 'underline': o.underline = { type: UnderlineType.SINGLE }; break
        case 'strike': o.strike = true; break
        case 'code': o.font = 'Courier New'; o.shading = { type: ShadingType.CLEAR, fill: 'F0F0F4', color: 'auto' }; break
        case 'sub': o.subScript = true; break
        case 'sup': o.superScript = true; break
        case 'color': o.color = hex(a.color); break
        case 'highlight': o.shading = { type: ShadingType.CLEAR, fill: hex(a.color), color: 'auto' }; break
        case 'fontSize': o.size = half(a.size); break
        case 'fontFamily': o.font = a.family; break
        case 'link': o.color = LINK_BLUE; o.underline = { type: UnderlineType.SINGLE }; break
        default: break
      }
    }
    return o
  }

  async function imageRun(node) {
    const { src, alt } = node.attrs
    try {
      let bytes, type
      const m = src.match(/^data:image\/([a-z+.-]+);base64,/i)
      if (m && /^(png|jpe?g|gif|bmp)$/i.test(m[1])) {
        bytes = base64ToBytes(src)
        type = m[1].toLowerCase().replace('jpeg', 'jpg')
      } else {
        const img = await loadImage(src) // webp, svg, avif and linked images become PNG
        const c = toCanvas(img, img.naturalWidth || 300, img.naturalHeight || 200)
        bytes = new Uint8Array(await (await toBlob(c, 'image/png')).arrayBuffer())
        type = 'png'
      }
      let { width, height } = node.attrs
      if (!width) {
        const nat = await imageSize(src)
        const maxW = contentWidthPx(settings)
        const k = Math.min(1, maxW / nat.width)
        width = Math.round(nat.width * k)
        height = Math.round(nat.height * k)
      } else if (!height) height = Math.round(width * 0.66)
      return new ImageRun({ type, data: bytes, transformation: { width, height }, altText: { name: alt || 'image', description: alt || '', title: alt || '' } })
    } catch {
      notes.push(`An image${alt ? ` (${alt})` : ''} could not be embedded and was replaced with text.`)
      return new TextRun({ text: `[image${alt ? `: ${alt}` : ''}]`, italics: true })
    }
  }

  async function inlineRuns(parent, base = {}) {
    const out = []
    let group = null // consecutive nodes sharing one link
    const flush = () => { if (group) { out.push(new ExternalHyperlink({ link: group.href, children: group.runs })); group = null } }
    const kids = []
    parent.forEach((c) => kids.push(c))
    for (const child of kids) {
      const link = child.marks.find((m) => m.type.name === 'link')
      let run
      if (child.isText) run = new TextRun({ text: child.text, ...runProps(child.marks, base) })
      else if (child.type.name === 'hard_break') run = new TextRun({ break: 1 })
      else if (child.type.name === 'image') run = await imageRun(child)
      else continue
      if (link) {
        if (group && group.href !== link.attrs.href) flush()
        group ??= { href: link.attrs.href, runs: [] }
        group.runs.push(run)
      } else { flush(); out.push(run) }
    }
    flush()
    return out
  }

  // ---------- blocks ----------
  const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED }
  const paraOpts = (node, extra = {}) => {
    const a = node.attrs
    const o = { ...extra }
    if (a.align && ALIGN[a.align]) o.alignment = ALIGN[a.align]
    if (a.indent) o.indent = { ...(o.indent || {}), left: (o.indent?.left || 0) + a.indent * 720 }
    if (a.lineHeight) o.spacing = { ...(o.spacing || {}), line: Math.round(a.lineHeight * 240), lineRule: LineRuleType.AUTO }
    return o
  }

  async function textblock(node, ctx, extra = {}, base = {}) {
    const children = await inlineRuns(node, { ...(ctx.run || {}), ...base })
    let opts = extra
    if (node.type.name === 'heading') opts = { heading: HeadingLevel[`HEADING_${node.attrs.level}`], ...opts }
    else if (node.attrs.variant === 'title') opts = { style: 'Title', ...opts }
    else if (node.attrs.variant === 'subtitle') opts = { style: 'Subtitle', ...opts }
    else if (ctx.quote && !opts.style) opts = { style: 'Quote', ...opts }
    return new Paragraph({ ...paraOpts(node, opts), children })
  }

  async function blocksOf(parent, ctx) {
    const out = []
    const kids = []
    parent.forEach((c) => kids.push(c))
    for (const child of kids) out.push(...(await block(child, ctx)))
    return out
  }

  async function block(node, ctx) {
    switch (node.type.name) {
      case 'paragraph': case 'heading': return [await textblock(node, ctx, ctx.paraExtra || {})]
      case 'blockquote': return blocksOf(node, { ...ctx, quote: true })
      case 'code_block': return node.textContent.split('\n').map((line) => new Paragraph({ style: 'CodeBlock', children: [new TextRun({ text: line })] }))
      case 'horizontal_rule':
        return [new Paragraph({ spacing: { before: 120, after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'C9C9D3', space: 1 } }, children: [] })]
      case 'page_break': return [new Paragraph({ children: [new PageBreak()] })]
      case 'bullet_list': case 'ordered_list': case 'task_list': return listBlocks(node, ctx)
      case 'table': return [await tableBlock(node, ctx)]
      default: return []
    }
  }

  async function listBlocks(list, ctx) {
    const level = Math.min(8, ctx.level ?? 0)
    const type = list.type.name
    const instance = type === 'ordered_list' && ctx.parentType !== 'ordered_list' ? ++listInstance : ctx.instance
    const out = []
    let n = 0
    const items = []
    list.forEach((it) => items.push(it))
    for (const item of items) {
      const kids = []
      item.forEach((c) => kids.push(c))
      for (let i = 0; i < kids.length; i++) {
        const k = kids[i]
        const inner = { ...ctx, level: level + 1, instance, parentType: type }
        if (i === 0) {
          if (type === 'task_list') {
            const box = new TextRun({ text: item.attrs.checked ? '☑  ' : '☐  ', font: 'Segoe UI Symbol' })
            const runs = await inlineRuns(k, ctx.run || {})
            out.push(new Paragraph({ ...paraOpts(k, { indent: { left: 360 * (level + 1) + 360, hanging: 360 }, spacing: { after: 60 } }), children: [box, ...runs] }))
          } else {
            const numbering = type === 'bullet_list' ? { reference: 'bullets', level } : { reference: `ol-${list.attrs.order > 1 ? list.attrs.order : 1}`, level, instance }
            const para = await textblock(k, ctx, { numbering, spacing: { after: 60 } })
            out.push(para)
          }
          n++
        } else if (['bullet_list', 'ordered_list', 'task_list'].includes(k.type.name)) {
          out.push(...(await listBlocks(k, inner)))
        } else if (k.isTextblock) {
          out.push(await textblock(k, ctx, { indent: { left: 360 * (level + 1) + 360 }, spacing: { after: 60 } }))
        } else out.push(...(await block(k, ctx)))
      }
    }
    return out
  }

  async function tableBlock(table, ctx) {
    const first = table.firstChild
    const grid = []
    first.forEach((cell) => {
      const span = cell.attrs.colspan || 1
      const cw = cell.attrs.colwidth || []
      for (let i = 0; i < span; i++) grid.push(cw[i] ? Math.round(cw[i] * 15) : 0)
    })
    const known = grid.reduce((a, b) => a + b, 0)
    const unknown = grid.filter((w) => !w).length
    const fill = unknown ? Math.max(720, Math.round((Math.max(contentTwips - known, 720 * unknown)) / unknown)) : 0
    const columnWidths = grid.map((w) => w || fill)
    const total = columnWidths.reduce((a, b) => a + b, 0)
    const line = { style: BorderStyle.SINGLE, size: 4, color: 'C4C4CF' }
    const rows = []
    const trs = []
    table.forEach((r) => trs.push(r))
    for (const tr of trs) {
      const cells = []
      const tds = []
      tr.forEach((c) => tds.push(c))
      let col = 0
      let allHeader = true
      for (const td of tds) {
        const header = td.type.name === 'table_header'
        if (!header) allHeader = false
        const span = td.attrs.colspan || 1
        const width = columnWidths.slice(col, col + span).reduce((a, b) => a + b, 0)
        col += span
        const kids = await blocksOf(td, { ...ctx, quote: false, run: header ? { bold: true } : undefined, paraExtra: { spacing: { after: 40 } } })
        cells.push(new TableCell({
          children: kids.length ? kids : [new Paragraph({ children: [] })],
          columnSpan: span > 1 ? span : undefined,
          rowSpan: td.attrs.rowspan > 1 ? td.attrs.rowspan : undefined,
          width: { size: width, type: WidthType.DXA },
          shading: td.attrs.background ? { type: ShadingType.CLEAR, fill: hex(td.attrs.background), color: 'auto' } : header ? { type: ShadingType.CLEAR, fill: 'F1F1F6', color: 'auto' } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
        }))
      }
      rows.push(new TableRow({ children: cells, tableHeader: allHeader && rows.length === 0, cantSplit: true }))
    }
    return new Table({
      rows, columnWidths, width: { size: total, type: WidthType.DXA }, layout: TableLayoutType.FIXED,
      borders: { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line },
    })
  }

  // ---------- document ----------
  const children = await blocksOf(doc, {})
  if (!children.length) children.push(new Paragraph({ children: [] }))

  const p = PAPERS[settings.paper] || PAPERS.a4
  const mm = (v) => Math.round(v * TWIPS_PER_MM)
  const hfRun = { size: 18, color: '7A7A86', font: 'Arial' }
  const header = settings.header ? new Header({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: settings.header, ...hfRun })] })] }) : null
  let footer = null
  if (settings.footer || settings.pageNumbers) {
    const kids = []
    if (settings.footer && settings.pageNumbers) {
      kids.push(new TextRun({ text: settings.footer, ...hfRun }), new TextRun({ children: [new Tab(), PageNumber.CURRENT], ...hfRun }))
      footer = new Footer({ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: contentTwips }], children: kids })] })
    } else if (settings.pageNumbers) {
      footer = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], ...hfRun })] })] })
    } else footer = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: settings.footer, ...hfRun })] })] })
  }

  const ordered = (start) => ({
    reference: `ol-${start}`,
    levels: Array.from({ length: 9 }, (_, i) => ({
      level: i, format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][i % 3], text: `%${i + 1}.`, alignment: AlignmentType.LEFT, start: i === 0 ? start : 1,
      style: { paragraph: { indent: { left: 720 + i * 360, hanging: 360 } } },
    })),
  })
  const starts = new Set([1])
  const scan = (n) => { if (n.type.name === 'ordered_list' && n.attrs.order > 1) starts.add(n.attrs.order); n.forEach(scan) }
  scan(doc)

  // built-in styles are overridden through styles.default (a second definition with the same id would duplicate the style)
  const heading = (size, extra = {}) => ({
    run: { size, bold: true, color: '1A1A1F', ...(extra.run || {}) },
    paragraph: { spacing: { before: extra.before ?? 240, after: extra.after ?? 100 }, keepNext: true, keepLines: true },
  })

  const document = new Document({
    creator: 'Docs', title, description: 'Created with Docs in the browser',
    styles: {
      default: {
        document: { run: { font: settings.font, size: half(settings.fontSize), color: '1A1A1F' }, paragraph: { spacing: { after: 160, line: 276 } } },
        title: { run: { size: 60, bold: true, color: '1A1A1F' }, paragraph: { spacing: { after: 120 } } },
        heading1: heading(44, { before: 360, after: 120 }), heading2: heading(32), heading3: heading(26), heading4: heading(23),
        heading5: heading(22, { run: { allCaps: true } }), heading6: heading(22, { run: { bold: false, italics: true, color: '5B5B66' } }),
      },
      paragraphStyles: [
        { id: 'Subtitle', name: 'Subtitle', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 30, color: '5B5B66' }, paragraph: { spacing: { after: 280 } } },
        { id: 'Quote', name: 'Quote', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { color: '4B4B57' },
          paragraph: { indent: { left: 360 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'C9C9D3', space: 10 } } } },
        { id: 'CodeBlock', name: 'Code Block', basedOn: 'Normal', run: { font: 'Courier New', size: 20 }, paragraph: { spacing: { after: 0, line: 260 }, shading: { type: ShadingType.CLEAR, fill: 'F4F4F7', color: 'auto' } } },
      ],
    },
    numbering: {
      config: [
        { reference: 'bullets', levels: Array.from({ length: 9 }, (_, i) => ({ level: i, format: LevelFormat.BULLET, text: BULLETS[i % 3], alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 + i * 360, hanging: 360 } } } })) },
        ...[...starts].map(ordered),
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: mm(Math.min(p.w, p.h)), height: mm(Math.max(p.w, p.h)), orientation: settings.orient === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
          margin: { top: mm(settings.margins.top), right: mm(settings.margins.right), bottom: mm(settings.margins.bottom), left: mm(settings.margins.left), header: 708, footer: 708 },
        },
      },
      headers: header ? { default: header } : undefined,
      footers: footer ? { default: footer } : undefined,
      children,
    }],
  })
  return { blob: await withNormalStyle(await Packer.toBlob(document)), notes: [...new Set(notes)] }
}

/** docx writes no "Normal" paragraph style. Add it as the default so Word, LibreOffice and python-docx all resolve styles. */
async function withNormalStyle(blob) {
  const JSZip = await jszip()
  const zip = await JSZip.loadAsync(blob)
  let xml = await zip.file('word/styles.xml').async('string')
  if (!/w:styleId="Normal"/.test(xml)) {
    xml = xml.replace('</w:docDefaults>', '</w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>')
    zip.file('word/styles.xml', xml)
  }
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' })
}
