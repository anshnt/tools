// TXT to Word: paste or open plain text, pick font, size, spacing and page setup, preview the page, download a .docx.
import { h, button, busy, alert, field, input, number, select, toggle, segmented, clear, debounce, formatBytes, downloadButton } from '../../lib/ui.js'
import { docx as loadDocx } from '../../lib/libs.js'
import { toolRoot, addStyle, textInput, chips, kicker, note, celebrate, wordCount } from './_shared.js'
import { FONTS, PAGES, MARGINS, fontStack, lineValue, docName } from './_docx.js'

const SAMPLE = `Meeting notes - Project Kickoff

Attendees: Asha, Rohan, Meera and Dev.

We agreed that the first milestone is a working prototype by the end of the month. Asha will own the design review, Rohan the backend, and Meera the testing plan.

Action items
1. Share the draft timeline by Friday
2. Book the demo room for the 28th
3. Confirm the budget with finance

Next meeting: Monday, 10:30 am.`

/** Split plain text into paragraphs. Each paragraph is an array of lines (kept as line breaks unless join is true). */
export function toParagraphs(text, { mode = 'blank', join = false } = {}) {
  const t = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  if (!t.trim()) return []
  if (mode === 'line') return t.split('\n').map((l) => [l])
  return t.split(/\n[ \t]*\n+/).map((block) => {
    const lines = block.split('\n')
    return join ? [lines.map((l) => l.trim()).filter(Boolean).join(' ')] : lines
  }).filter((p) => p.some((l) => l.trim()))
}

const CSS = `
.tw-txt2word .tw-sheetwrap { container-type: inline-size; }
.tw-txt2word .tw-sheet { position: relative; width: 100%; aspect-ratio: var(--ar); overflow: hidden; background: #fff; color: #17171c; border-radius: 4px;
  box-shadow: 0 1px 2px rgba(16,16,40,.08), 0 30px 60px -28px rgba(16,16,40,.5); transition: font-family .2s;
  padding: calc(var(--m) * 100cqw / var(--pw)); font-size: calc(var(--pt) * 100cqw / var(--pw)); line-height: var(--lh); }
.tw-txt2word .tw-sheet::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 16%; background: linear-gradient(transparent, #fff 85%); pointer-events: none; }
.tw-txt2word .tw-sheet p { margin: 0; overflow-wrap: anywhere; }
.tw-txt2word .tw-sheet .t { font-weight: 700; font-size: 1.6em; line-height: 1.2; }
.tw-txt2word .tw-sheet .ph { color: #9a9aa6; font-style: italic; }
.tw-txt2word .tw-pg { text-align: center; font-size: 12px; color: var(--muted); margin-top: 8px; }
`

export function mount(root) {
  addStyle('tw-txt2word-css', CSS)
  const o = { font: 'Calibri', size: 11, line: 1.15, mode: 'blank', join: false, align: 'left', after: 8, indent: false, page: 'a4', margin: 'normal', title: '', pageNum: false, name: 'document' }
  const result = h('div')
  const previewBox = h('div', { class: 'tw-sheetwrap' })
  const pageLabel = h('div', { class: 'tw-pg' })
  const inp = textInput({ rows: 12, placeholder: 'Paste or type your text here, or drop a .txt file...', sample: SAMPLE, label: 'Text to convert', onInput: () => { dirty(); drawLater() } })

  const fontSel = select(FONTS.map((f) => [f[0], f[0]]), o.font, (v) => { o.font = v; draw() })
  const sizeInp = number(o.size, { min: 6, max: 72, step: 0.5, ariaLabel: 'Font size', onInput: (n) => { if (n >= 6 && n <= 72) { o.size = n; draw() } } })
  const lineChips = chips([[1, '1.0'], [1.15, '1.15'], [1.5, '1.5'], [2, '2.0']], o.line, (v) => { o.line = v; draw() }, { ariaLabel: 'Line spacing' })
  const modeSeg = segmented([['blank', 'Blank line starts a paragraph'], ['line', 'Every line is a paragraph']], o.mode, (v) => { o.mode = v; joinTog.hidden = v !== 'blank'; draw() }, 'Paragraph detection')
  const joinTog = toggle('Join lines that were hard-wrapped', o.join, (v) => { o.join = v; draw() })
  const alignSeg = segmented([['left', 'Left'], ['both', 'Justify'], ['center', 'Center'], ['right', 'Right']], o.align, (v) => { o.align = v; draw() }, 'Alignment')
  const afterSeg = segmented([[0, 'None'], [6, '6 pt'], [8, '8 pt'], [12, '12 pt']], o.after, (v) => { o.after = v; draw() }, 'Space after paragraphs')
  const indentTog = toggle('Indent first line', o.indent, (v) => { o.indent = v; draw() })
  const pageSel = select(Object.entries(PAGES).map(([k, p]) => [k, p.label]), o.page, (v) => { o.page = v; draw() })
  const marginSel = select([['normal', 'Normal (2.54 cm)'], ['narrow', 'Narrow (1.27 cm)'], ['wide', 'Wide (3.81 cm)']], o.margin, (v) => { o.margin = v; draw() })
  const titleInp = input({ placeholder: 'Optional heading at the top', 'aria-label': 'Document title', oninput: (e) => { o.title = e.target.value; draw() } })
  const numTog = toggle('Page numbers in the footer', o.pageNum, (v) => { o.pageNum = v })
  const nameInp = input({ value: o.name, 'aria-label': 'File name', oninput: (e) => { o.name = e.target.value } })
  const go = button('Create Word document', { icon: 'file-plus-2', variant: 'primary', size: 'lg' })

  const dirty = () => clear(result)

  function paragraphsNow() { return toParagraphs(inp.get(), o) }

  function draw() {
    const pg = PAGES[o.page]
    const m = MARGINS[o.margin] / 20
    const paras = paragraphsNow()
    const sheet = h('div', { class: 'tw-sheet', style: { '--ar': `${pg.pt[0]} / ${pg.pt[1]}`, '--pw': pg.pt[0], '--m': m, '--pt': o.size, '--lh': o.line, fontFamily: fontStack(o.font) } },
      o.title && h('p', { class: 't', style: { marginBottom: `${(o.after * 100) / pg.pt[0]}cqw` } }, o.title),
      paras.length ? paras.slice(0, 40).map((lines) => h('p', { style: { textAlign: o.align === 'both' ? 'justify' : o.align, textIndent: o.indent ? '2.2em' : '0', marginBottom: `${(o.after * 100) / pg.pt[0]}cqw` } },
        lines.flatMap((l, i) => (i ? [h('br'), l] : [l])))) : h('p', { class: 'ph' }, 'Your text will appear here as you type.'))
    clear(previewBox, sheet)
    pageLabel.textContent = `${pg.label} · ${o.font} ${o.size} pt · ${o.line}x spacing · page 1 preview`
    go.disabled = !paras.length
  }
  const drawLater = debounce(draw, 120)

  async function build() {
    const paras = paragraphsNow()
    if (!paras.length) throw new Error('Add some text first.')
    const { Document, Packer, Paragraph, TextRun, AlignmentType, LineRuleType, Tab, Footer, PageNumber } = await loadDocx()
    const alignment = { left: AlignmentType.LEFT, both: AlignmentType.JUSTIFIED, center: AlignmentType.CENTER, right: AlignmentType.RIGHT }[o.align]
    const runs = (lines) => lines.flatMap((line, i) => {
      const parts = line.split('\t')
      return parts.map((txt, j) => new TextRun({ children: [...(j ? [new Tab()] : []), txt], break: i && !j ? 1 : 0 }))
    })
    const pg = PAGES[o.page]
    const m = MARGINS[o.margin]
    const children = []
    if (o.title.trim()) {
      children.push(new Paragraph({ children: [new TextRun({ text: o.title.trim(), bold: true, size: Math.round(o.size * 2 * 1.6) })], alignment: o.align === 'both' ? AlignmentType.LEFT : alignment, spacing: { after: Math.max(o.after * 20, 160), line: lineValue(1.1), lineRule: LineRuleType.AUTO } }))
    }
    for (const lines of paras) {
      children.push(new Paragraph({ children: runs(lines), alignment, indent: o.indent ? { firstLine: 567 } : undefined }))
    }
    const doc = new Document({
      creator: 'Tools',
      title: o.title.trim() || docName(o.name),
      styles: { default: { document: {
        run: { font: o.font, size: Math.round(o.size * 2) },
        paragraph: { spacing: { line: lineValue(o.line), lineRule: LineRuleType.AUTO, after: o.after * 20 } },
      } } },
      sections: [{
        properties: { page: { size: { width: pg.width, height: pg.height }, margin: { top: m, right: m, bottom: m, left: m } } },
        footers: o.pageNum ? { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT] })] })] }) } : undefined,
        children,
      }],
    })
    return Packer.toBlob(doc)
  }

  go.addEventListener('click', () => busy(go, async () => {
    const blob = await build()
    const file = `${docName(o.name)}.docx`
    const host = h('div', { style: 'position:relative' }, alert('success', h('strong', 'Your document is ready. '), `${wordCount(inp.get()).toLocaleString()} words, ${formatBytes(blob.size)}, ${PAGES[o.page].label}.`),
      h('div', { class: 'row', style: 'margin-top:12px' }, downloadButton(blob, file, `Download ${file}`, { size: 'lg' })))
    clear(result, host)
    celebrate(host)
  }, { label: 'Building', errorTo: result }))

  const optionsCol = h('section', { class: 'tw-stage' }, h('div', { class: 'stack' },
    kicker('Formatting', 'type'),
    h('div', { class: 'grid-2' }, field('Font', fontSel), field('Size (pt)', sizeInp)),
    field('Line spacing', lineChips),
    field('Paragraphs', modeSeg), joinTog,
    field('Alignment', alignSeg),
    h('div', { class: 'grid-2' }, field('Space after paragraph', afterSeg), h('div', { style: 'align-self:end' }, indentTog)),
    kicker('Page', 'file'),
    h('div', { class: 'grid-2' }, field('Paper', pageSel), field('Margins', marginSel)),
    field('Heading (optional)', titleInp), numTog,
    field('File name', nameInp, '.docx is added for you')))

  const inputCol = h('div', { class: 'stack' }, inp.el)
  const left = h('div', { class: 'stack' }, inputCol, optionsCol)
  const right = h('div', { class: 'stack', style: 'position:sticky; top:84px; align-self:start' },
    kicker('Live preview', 'eye'), previewBox, pageLabel)
  draw()
  root.append(toolRoot('txt2word', h('div', { class: ['tool-split', 'wide-left'] }, left, right), h('div', { class: 'row' }, go), result,
    note('Everything happens in your browser. The .docx opens in Word, Google Docs, LibreOffice and Pages.', 'shield-check')))
}
