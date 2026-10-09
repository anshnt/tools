// Markdown to Word: marked tokens -> docx. Headings, bold, italic, strike, code, links, lists (nested, tasks), tables, quotes, rules, data-URI images.
import { h, button, busy, alert, field, input, number, select, toggle, clear, debounce, formatBytes, downloadButton, onCleanup } from '../../lib/ui.js'
import { docx as loadDocx, marked as loadMarked, dompurify as loadPurify } from '../../lib/libs.js'
import { toolRoot, addStyle, textInput, chips, kicker, note, celebrate, wordCount } from './_shared.js'
import { FONTS, PAGES, MARGINS, fontStack, lineValue, docName } from './_docx.js'

const SAMPLE = `# Project Proposal

A short **proposal** for the *Atlas* launch, written in Markdown and converted to Word in one click.

## Goals

- Ship the beta by **June**
- Reach 1,000 active users
  - 600 from the newsletter
  - 400 from partners
- ~~Build a mobile app~~ (postponed)

## Timeline

1. Research and interviews
2. Design and prototype
3. Build and test
4. Launch

| Phase | Owner | Weeks |
| :--- | :---: | ---: |
| Research | Asha | 3 |
| Design | Rohan | 4 |
| Build | Meera | 8 |

> "Make it simple, then make it fast." - team motto

### Checklist

- [x] Budget approved
- [ ] Legal review

Run \`npm run build\` to create the release, or see the [docs](https://example.com/docs).

\`\`\`js
function launch(date) {
  return \`Launching on \${date}\`
}
\`\`\`

---

Thanks for reading.`

/** Visual themes: heading sizes in pt, colors and the defaults they select. */
export const THEMES = {
  clean: { label: 'Clean', font: 'Calibri', size: 11, line: 1.15, heads: [24, 18, 14, 12, 11, 11], color: '1F2937', hfont: 'Calibri', accent: '2563EB', center1: false },
  modern: { label: 'Modern', font: 'Segoe UI', size: 10.5, line: 1.3, heads: [28, 20, 15, 12.5, 11, 11], color: '4338CA', hfont: 'Segoe UI', accent: '4F46E5', center1: false },
  academic: { label: 'Academic', font: 'Times New Roman', size: 12, line: 1.5, heads: [18, 14, 12, 12, 12, 12], color: '000000', hfont: 'Times New Roman', accent: '000000', center1: true },
  report: { label: 'Report', font: 'Georgia', size: 11, line: 1.4, heads: [26, 19, 15, 12.5, 11, 11], color: '14325C', hfont: 'Georgia', accent: '14325C', center1: false },
}

const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|#x27|nbsp);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'", nbsp: ' ' })[e])
const stripTags = (s) => decode(s.replace(/<[^>]+>/g, ''))

const CSS = `
.tw-md2w .tw-sheetwrap { container-type: inline-size; }
.tw-md2w .tw-sheet { width: 100%; max-height: min(78vh, 760px); overflow: auto; background: #fff; color: #17171c; border-radius: 4px; box-shadow: 0 1px 2px rgba(16,16,40,.08), 0 30px 60px -28px rgba(16,16,40,.5);
  padding: calc(var(--m) * 100cqw / var(--pw)); font-size: calc(var(--pt) * 100cqw / var(--pw)); line-height: var(--lh); min-height: 220px; }
.tw-md2w .tw-sheet > :first-child { margin-top: 0; }
.tw-md2w .tw-sheet p, .tw-md2w .tw-sheet ul, .tw-md2w .tw-sheet ol, .tw-md2w .tw-sheet table, .tw-md2w .tw-sheet pre, .tw-md2w .tw-sheet blockquote { margin: 0 0 .7em; }
.tw-md2w .tw-sheet h1, .tw-md2w .tw-sheet h2, .tw-md2w .tw-sheet h3, .tw-md2w .tw-sheet h4, .tw-md2w .tw-sheet h5, .tw-md2w .tw-sheet h6 { color: var(--hc); font-family: var(--hf); line-height: 1.2; margin: 1em 0 .4em; }
.tw-md2w .tw-sheet h1 { font-size: calc(var(--h1) * 100cqw / var(--pw)); text-align: var(--h1a); } .tw-md2w .tw-sheet h2 { font-size: calc(var(--h2) * 100cqw / var(--pw)); }
.tw-md2w .tw-sheet h3 { font-size: calc(var(--h3) * 100cqw / var(--pw)); } .tw-md2w .tw-sheet h4 { font-size: calc(var(--h4) * 100cqw / var(--pw)); }
.tw-md2w .tw-sheet h5, .tw-md2w .tw-sheet h6 { font-size: calc(var(--h5) * 100cqw / var(--pw)); }
.tw-md2w .tw-sheet a { color: var(--ha); text-decoration: underline; }
.tw-md2w .tw-sheet code { font-family: Consolas, "Cascadia Mono", monospace; font-size: .92em; background: #f1f1f4; padding: 0 .25em; border-radius: 3px; }
.tw-md2w .tw-sheet pre { background: #f4f4f7; padding: .6em .8em; border-radius: 4px; overflow: auto; } .tw-md2w .tw-sheet pre code { background: none; padding: 0; }
.tw-md2w .tw-sheet blockquote { border-left: .25em solid #b8b8c4; padding-left: .9em; color: #55555f; font-style: italic; }
.tw-md2w .tw-sheet table { border-collapse: collapse; width: 100%; } .tw-md2w .tw-sheet th, .tw-md2w .tw-sheet td { border: 1px solid #c9c9d3; padding: .25em .5em; }
.tw-md2w .tw-sheet th { background: #f1f1f5; } .tw-md2w .tw-sheet img { max-width: 100%; } .tw-md2w .tw-sheet hr { border: 0; border-top: 1px solid #bbb; margin: 1em 0; }
.tw-md2w .tw-sheet ul, .tw-md2w .tw-sheet ol { padding-left: 1.6em; } .tw-md2w .tw-sheet li > ul, .tw-md2w .tw-sheet li > ol { margin: 0; }
`

/** marked tokens -> docx children. Exported for tests via the page. */
export async function markdownToDocx(md, o) {
  const [D, { marked }] = await Promise.all([loadDocx(), loadMarked()])
  const { Document, Packer, Paragraph, TextRun, ExternalHyperlink, ImageRun, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, AlignmentType, HeadingLevel, LevelFormat, LineRuleType, Footer, PageNumber } = D
  const th = THEMES[o.theme] || THEMES.clean
  const pg = PAGES[o.page]
  const m = MARGINS[o.margin]
  const contentW = pg.width - 2 * m
  const HEADS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6]
  const MONO = 'Consolas'
  const olConfigs = []
  const dims = new Map()
  const tokens = marked.lexer(md.replace(/\r\n?/g, '\n'))
  let firstH1 = ''

  // ---- inline
  const runs = (toks = [], st = {}) => toks.flatMap((t) => {
    switch (t.type) {
      case 'text': case 'escape':
        return t.tokens ? runs(t.tokens, st) : [new TextRun({ text: decode(t.text), ...st })]
      case 'strong': return runs(t.tokens, { ...st, bold: true })
      case 'em': return runs(t.tokens, { ...st, italics: true })
      case 'del': return runs(t.tokens, { ...st, strike: true })
      case 'codespan': return [new TextRun({ text: decode(t.text), ...st, style: 'CodeChar' })]
      case 'br': return [new TextRun({ break: 1 })]
      case 'link':
        return [new ExternalHyperlink({ link: t.href, children: runs(t.tokens, { ...st, color: th.accent, underline: {} }) })]
      case 'image': {
        const dm = /^data:image\/(png|jpe?g|gif|bmp);base64,(.+)$/i.exec(t.href || '')
        if (dm) {
          const [w0, h0] = dims.get(t.href) || [320, 200]
          const k = Math.min(1, Math.min(contentW / 15, 560) / w0)
          return [new ImageRun({ type: dm[1].toLowerCase().replace('jpeg', 'jpg'), data: Uint8Array.from(atob(dm[2]), (c) => c.charCodeAt(0)), transformation: { width: Math.round(w0 * k), height: Math.round(h0 * k) },
            altText: { title: t.text || 'image', description: t.text || 'image', name: 'image' } })]
        }
        return [new TextRun({ text: `[Image: ${decode(t.text || t.href || 'image')}]`, italics: true, color: '6B7280', ...st })]
      }
      case 'html': {
        if (/^<br\s*\/?>$/i.test(t.text.trim())) return [new TextRun({ break: 1 })]
        const s = stripTags(t.text)
        return s ? [new TextRun({ text: s, ...st })] : []
      }
      default: return t.text ? [new TextRun({ text: decode(t.text), ...st })] : []
    }
  })

  // images need their pixel size, so resolve them before building paragraphs
  const collectImages = (toks) => {
    for (const t of toks || []) {
      if (t.type === 'image' && /^data:image\/(png|jpe?g|gif|bmp);base64,/i.test(t.href || '')) dims.set(t.href, null)
      collectImages(t.tokens); collectImages(t.items); for (const r of t.rows || []) for (const c of r) collectImages(c.tokens); for (const c of t.header || []) collectImages(c.tokens)
    }
  }
  collectImages(tokens)
  await Promise.all([...dims.keys()].map(async (href) => {
    try {
      const bmp = await createImageBitmap(await (await fetch(href)).blob())
      dims.set(href, [bmp.width, bmp.height])
      bmp.close?.()
    } catch { dims.set(href, [320, 200]) }
  }))
  const inline = (toks, st) => runs(toks, st)

  const alignOf = (a) => ({ left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT })[a] || AlignmentType.LEFT
  const bodyAlign = o.justify ? AlignmentType.JUSTIFIED : AlignmentType.LEFT
  const flat = (t) => (t.tokens ? t.tokens.map(flat).join('') : decode(t.text || ''))

  // ---- blocks
  let olCount = 0
  const list = (t, level, indentExtra) => {
    const out = []
    let ref = 'ul'
    if (t.ordered) {
      ref = `ol-${++olCount}`
      olConfigs.push({ reference: ref, levels: ['decimal', 'lowerLetter', 'lowerRoman', 'decimal', 'lowerLetter', 'lowerRoman', 'decimal', 'lowerLetter', 'lowerRoman'].map((f, i) => ({
        level: i, format: { decimal: LevelFormat.DECIMAL, lowerLetter: LevelFormat.LOWER_LETTER, lowerRoman: LevelFormat.LOWER_ROMAN }[f], text: `%${i + 1}.`, start: i === 0 && Number(t.start) > 0 ? Number(t.start) : 1,
        alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 * (i + 1) + indentExtra, hanging: 360 } } } })) })
    }
    for (const item of t.items) {
      let first = true
      for (const b of item.tokens) {
        if (b.type === 'list') out.push(...list(b, Math.min(level + 1, 8), indentExtra))
        else if (b.type === 'text' || b.type === 'paragraph') {
          const pre = first && item.task ? [new TextRun({ text: item.checked ? '☑ ' : '☐ ' })] : []
          out.push(new Paragraph({ children: [...pre, ...inline(b.tokens || [{ type: 'text', text: b.text }])], numbering: first && !item.task ? { reference: ref, level } : undefined, alignment: bodyAlign,
            indent: first && !item.task ? undefined : { left: 720 * (level + 1) + indentExtra - (item.task && first ? 360 : 0) }, spacing: { after: 60 } }))
          first = false
        } else out.push(...block(b, indentExtra + 720 * (level + 1)))
      }
    }
    return out
  }

  const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: 'BFC3CC' }
  const table = (t) => {
    const n = t.header.length
    const w = Math.floor(contentW / n)
    const mk = (cell, i, head) => new TableCell({
      width: { size: w, type: WidthType.DXA }, margins: { top: 60, bottom: 60, left: 100, right: 100 },
      shading: head ? { type: ShadingType.CLEAR, fill: 'F1F3F7', color: 'auto' } : undefined,
      children: [new Paragraph({ alignment: alignOf(t.align[i]), spacing: { after: 0 }, children: inline(cell.tokens, head ? { bold: true } : {}) })],
    })
    return new Table({
      width: { size: contentW, type: WidthType.DXA }, columnWidths: Array(n).fill(w),
      borders: { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder, insideHorizontal: cellBorder, insideVertical: cellBorder },
      rows: [new TableRow({ tableHeader: true, children: t.header.map((c, i) => mk(c, i, true)) }), ...t.rows.map((r) => new TableRow({ children: r.map((c, i) => mk(c, i, false)) }))],
    })
  }

  const quote = (t, indent, depth) => t.tokens.flatMap((b) => {
    if (b.type === 'blockquote') return quote(b, indent, depth + 1)
    if (b.type === 'paragraph' || b.type === 'text') {
      return [new Paragraph({ style: 'Quote', children: inline(b.tokens || [{ type: 'text', text: b.text }]), indent: { left: indent + 480 + 360 * (depth - 1) } })]
    }
    return block(b, indent + 360 * depth)
  })

  const block = (t, indent = 0) => {
    switch (t.type) {
      case 'heading': {
        if (t.depth === 1 && !firstH1) firstH1 = flat(t)
        return [new Paragraph({ heading: HEADS[Math.min(t.depth, 6) - 1], children: inline(t.tokens), alignment: t.depth === 1 && th.center1 ? AlignmentType.CENTER : AlignmentType.LEFT, indent: indent ? { left: indent } : undefined })]
      }
      case 'paragraph': case 'text':
        return [new Paragraph({ children: inline(t.tokens || [{ type: 'text', text: t.text }]), alignment: bodyAlign, indent: indent ? { left: indent } : undefined })]
      case 'list': return list(t, 0, indent)
      case 'code': {
        const lines = t.text.replace(/\n$/, '').split('\n')
        return [new Paragraph({ style: 'Code', children: lines.map((l, i) => new TextRun({ text: l, break: i ? 1 : 0 })), indent: { left: 160 + indent, right: 160 } })]
      }
      case 'blockquote': return quote(t, indent, 1)
      case 'table': return [table(t), new Paragraph({ children: [], spacing: { after: 120 } })]
      case 'hr': return [new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'B8BCC6', space: 1 } }, spacing: { before: 120, after: 200 } })]
      case 'html': { const s = stripTags(t.text).trim(); return s ? [new Paragraph({ children: [new TextRun({ text: s })] })] : [] }
      default: return []
    }
  }

  const children = []
  for (const t of tokens) children.push(...block(t))
  if (!children.length) throw new Error('Add some Markdown first.')

  const headStyle = (i) => ({
    id: `Heading${i + 1}`, name: `Heading ${i + 1}`, basedOn: 'Normal', next: 'Normal', quickFormat: true,
    run: { font: th.hfont, size: Math.round(th.heads[i] * 2), bold: i < 4 || th.hfont === 'Times New Roman', color: th.color, italics: i === 5 },
    paragraph: { spacing: { before: i === 0 ? 360 : 280, after: 120 }, keepNext: true, keepLines: true, outlineLevel: i },
  })
  const doc = new Document({
    creator: 'Tools',
    title: firstH1 || docName(o.name),
    numbering: { config: [
      { reference: 'ul', levels: Array.from({ length: 9 }, (_, i) => ({ level: i, format: LevelFormat.BULLET, text: ['•', '◦', '▪'][i % 3], alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 * (i + 1), hanging: 360 } } } })) },
      ...olConfigs,
    ] },
    styles: {
      default: { document: { run: { font: o.font, size: Math.round(o.size * 2) }, paragraph: { spacing: { line: lineValue(o.line), lineRule: LineRuleType.AUTO, after: 140 } } } },
      paragraphStyles: [
        ...[0, 1, 2, 3, 4, 5].map(headStyle),
        { id: 'Quote', name: 'Quote', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { italics: true, color: '4B5563' },
          paragraph: { spacing: { after: 100 }, indent: { left: 480 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'A3A8B4', space: 10 } } } },
        { id: 'Code', name: 'Code', basedOn: 'Normal', quickFormat: true, run: { font: MONO, size: Math.round(o.size * 2 * 0.9) },
          paragraph: { spacing: { before: 80, after: 160, line: 260, lineRule: LineRuleType.AUTO }, shading: { type: ShadingType.CLEAR, fill: 'F3F4F8', color: 'auto' }, indent: { left: 160, right: 160 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: th.accent, space: 6 } } } },
      ],
      characterStyles: [{ id: 'CodeChar', name: 'Code Char', basedOn: 'DefaultParagraphFont', run: { font: MONO, size: Math.round(o.size * 2 * 0.92), shading: { type: ShadingType.CLEAR, fill: 'EEEEF2', color: 'auto' } } }],
    },
    sections: [{
      properties: { page: { size: { width: pg.width, height: pg.height }, margin: { top: m, right: m, bottom: m, left: m } } },
      footers: o.pageNum ? { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT] })] })] }) } : undefined,
      children,
    }],
  })
  return Packer.toBlob(doc)
}

export function mount(root) {
  addStyle('tw-md2w-css', CSS)
  const o = { theme: 'clean', font: 'Calibri', size: 11, line: 1.15, page: 'a4', margin: 'normal', pageNum: false, justify: false, name: 'document' }
  const result = h('div')
  const sheetHost = h('div', { class: 'tw-sheetwrap' })
  const label = h('div', { class: 'tw-sub', style: 'text-align:center' })
  const inp = textInput({ rows: 16, placeholder: 'Paste Markdown here, or drop a .md file...', value: '', sample: SAMPLE, label: 'Markdown', accept: '.md,.markdown,.txt', onInput: () => { clear(result); drawLater() } })
  inp.ta.classList.add('mono')
  inp.ta.style.fontFamily = 'var(--mono)'
  inp.ta.style.fontSize = '13px'

  const themeChips = chips(Object.entries(THEMES).map(([k, t]) => [k, t.label]), o.theme, (v) => applyTheme(v), { ariaLabel: 'Theme' })
  const fontSel = select(FONTS.map((f) => [f[0], f[0]]), o.font, (v) => { o.font = v; draw() })
  const sizeInp = number(o.size, { min: 6, max: 36, step: 0.5, ariaLabel: 'Font size', onInput: (n) => { if (n >= 6 && n <= 36) { o.size = n; draw() } } })
  const lineChips = chips([[1, '1.0'], [1.15, '1.15'], [1.5, '1.5'], [2, '2.0']], o.line, (v) => { o.line = v; draw() }, { ariaLabel: 'Line spacing' })
  const pageSel = select(Object.entries(PAGES).map(([k, p]) => [k, p.label]), o.page, (v) => { o.page = v; draw() })
  const marginSel = select([['normal', 'Normal (2.54 cm)'], ['narrow', 'Narrow (1.27 cm)'], ['wide', 'Wide (3.81 cm)']], o.margin, (v) => { o.margin = v; draw() })
  const numTog = toggle('Page numbers in the footer', o.pageNum, (v) => { o.pageNum = v })
  const justTog = toggle('Justify paragraphs', o.justify, (v) => { o.justify = v; draw() })
  const nameInp = input({ value: o.name, 'aria-label': 'File name', oninput: (e) => { o.name = e.target.value } })
  const go = button('Create Word document', { icon: 'file-type-2', variant: 'primary', size: 'lg' })

  function applyTheme(k) {
    const t = THEMES[k]
    Object.assign(o, { theme: k, font: t.font, size: t.size, line: t.line })
    fontSel.value = o.font
    sizeInp.value = o.size
    lineChips.set(o.line)
    draw()
  }

  let seq = 0
  async function draw() {
    const my = ++seq
    const md = inp.get()
    go.disabled = !md.trim()
    const pg = PAGES[o.page]
    const th = THEMES[o.theme]
    let html = ''
    if (md.trim()) {
      const [{ marked }, purify] = await Promise.all([loadMarked(), loadPurify()])
      if (my !== seq) return
      html = purify.sanitize(marked.parse(md))
    }
    const sheet = h('div', { class: 'tw-sheet', html: html || '<p style="color:#9a9aa6;font-style:italic">Your formatted document appears here as you type Markdown.</p>',
      style: { '--pw': pg.pt[0], '--m': MARGINS[o.margin] / 20, '--pt': o.size, '--lh': o.line, '--hc': `#${th.color}`, '--ha': `#${th.accent}`, '--hf': fontStack(th.hfont), '--h1a': th.center1 ? 'center' : 'left',
        '--h1': th.heads[0], '--h2': th.heads[1], '--h3': th.heads[2], '--h4': th.heads[3], '--h5': th.heads[4], fontFamily: fontStack(o.font), textAlign: o.justify ? 'justify' : 'left' } })
    sheet.querySelectorAll('a').forEach((a) => a.removeAttribute('target'))
    clear(sheetHost, sheet)
    label.textContent = `${pg.label} · ${o.font} ${o.size} pt · ${THEMES[o.theme].label} theme`
  }
  const drawLater = debounce(draw, 150)

  go.addEventListener('click', () => busy(go, async () => {
    const blob = await markdownToDocx(inp.get(), o)
    const file = `${docName(o.name)}.docx`
    const host = h('div', { style: 'position:relative' }, alert('success', h('strong', 'Your document is ready. '), `${wordCount(inp.get()).toLocaleString()} words, ${formatBytes(blob.size)}, ${PAGES[o.page].label}.`),
      h('div', { class: 'row', style: 'margin-top:12px' }, downloadButton(blob, file, `Download ${file}`, { size: 'lg' })))
    clear(result, host)
    celebrate(host)
  }, { label: 'Building', errorTo: result }))

  const optionsCol = h('section', { class: 'tw-stage' }, h('div', { class: 'stack' },
    kicker('Style', 'palette'), field('Theme', themeChips),
    h('div', { class: 'grid-2' }, field('Font', fontSel), field('Size (pt)', sizeInp)),
    field('Line spacing', lineChips), justTog,
    kicker('Page', 'file'),
    h('div', { class: 'grid-2' }, field('Paper', pageSel), field('Margins', marginSel)),
    numTog, field('File name', nameInp, '.docx is added for you')))
  const left = h('div', { class: 'stack' }, inp.el, optionsCol)
  const right = h('div', { class: 'stack', style: 'position:sticky; top:84px; align-self:start' }, kicker('Live preview', 'eye'), sheetHost, label)
  draw()
  root.append(toolRoot('md2w', h('div', { class: ['tool-split', 'wide-left'] }, left, right), h('div', { class: 'row' }, go), result,
    note('Supports headings, bold, italic, strikethrough, inline code, code blocks, links, nested and task lists, tables, quotes, rules and embedded (data URI) images. Web images are shown as a placeholder because browsers cannot always fetch them.', 'info')))
  onCleanup(() => { seq++ })
}
