// Question paper to text: OCR photos, scans and PDFs (language picker), tidy the numbering and line breaks, export DOCX, TXT or Markdown.
import { h, button, busy, dropzone, fileList, field, select, toggle, segmented, progress, alert, clear, debounce, download, toast, copyText, formatBytes, formatNumber } from '../../lib/ui.js'
import { recognize, OCR_LANGS } from '../../lib/ocr.js'
import { openPdf, renderPage, extractText } from '../../lib/pdf.js'
import { loadImage, fitSize, toCanvas } from '../../lib/image.js'
import { docx as loadDocx } from '../../lib/libs.js'
import { baseName, safeName } from '../../lib/files.js'
import { load, save } from '../../lib/store.js'
import { stage, tile, toolStyle, pill, emptyState, TINTS, confetti, handoff } from './_kit.js'
import { scanFilter } from './notes-to-pdf.js'

const CSS = `
.t-qp .out { width: 100%; min-height: 420px; font: 500 14px/1.65 var(--mono); resize: vertical; white-space: pre-wrap; }
.t-qp .pages { display: flex; flex-wrap: wrap; gap: 6px; }
.t-qp .opt-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
`

const PAGE_BREAK = '\n\u000c\n'

// ---------- clean-up (pure, exported for tests) ----------
const SECTION_RE = /^(?:section|part|group)\s+([A-Z]|\d+|[IVX]+)\b.*$/i
const Q_START = /^\s*(?:(?:question|ques|que|qn|q)\s*\.?\s*(?:no\.?\s*)?[(\[]?\s*(\d{1,3})\s*[)\].:\-]?|[(\[]?\s*(\d{1,3})\s*[)\].:\-])\s+(?=\S)/i
const MISREAD_ONE = /^\s*[lI|]\s*[.)]\s+(?=\S)/
const SUB_START = /^\s*[(\[]\s*([a-h]|i{1,3}|iv|v|vi{1,3})\s*[)\]]\s+(?=\S)|^\s*([a-h])\s*[).]\s+(?=[A-Z0-9])/i

/**
 * cleanText(raw, {numbering, join, headers, sections}) -> string. raw may contain form feeds (\f) between pages.
 * numbering: "Q1.", "1)", "(1)", "Question 1:" -> "1."   sub-parts "a)" -> "(a)"
 * join: merge hard-wrapped lines into paragraphs   headers: drop page numbers and lines repeated on every page
 */
export function cleanText(raw, { numbering = true, join = true, headers = true, sections = true } = {}) {
  let pages = String(raw).replace(/\r/g, '').split('\f').map((p) => p.split('\n').map((l) => l.replace(/[ \t]+$/g, '')))
  if (headers) {
    const count = new Map()
    for (const p of pages) for (const l of new Set(p.map((x) => x.trim()).filter((x) => x && x.length < 70))) count.set(l, (count.get(l) || 0) + 1)
    const repeated = new Set([...count].filter(([l, n]) => pages.length > 1 && n >= Math.max(2, Math.ceil(pages.length * 0.6)) && !Q_START.test(l)).map(([l]) => l))
    pages = pages.map((p) => p.filter((l) => !repeated.has(l.trim()) && !/^\s*(?:page\s*)?\d{1,3}(?:\s*(?:of|\/)\s*\d{1,3})?\s*$/i.test(l) && !/^\s*[-–]\s*\d{1,3}\s*[-–]\s*$/.test(l)))
  }
  let lines = pages.flat()
  lines = lines.map((l) => l.replace(/ /g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/ {2,}/g, ' '))
  // hyphenation at the end of a wrapped line
  for (let i = 0; i < lines.length - 1; i++) if (/[a-z]-$/.test(lines[i]) && /^[a-z]/.test(lines[i + 1] || '')) { lines[i] = lines[i].slice(0, -1) + lines[i + 1]; lines.splice(i + 1, 1); i-- }
  const out = []
  let expected = 1
  const push = (t) => out.push(t)
  for (const rawLine of lines) {
    const l = rawLine.trim()
    if (!l) { if (out.length && out.at(-1) !== '') push(''); continue }
    if (sections && SECTION_RE.test(l) && l.length < 80) { if (out.length && out.at(-1) !== '') push(''); push(l.toUpperCase()); push(''); continue }
    let q = numbering ? Q_START.exec(l) : null
    let n = q ? q[1] || q[2] : null
    if (!q && numbering && expected === 1 && (q = MISREAD_ONE.exec(l))) n = '1' // OCR often reads "1." as "l." or "I."
    if (q && n && !/^\d+\.\d/.test(l)) {
      expected = parseInt(n, 10) + 1
      if (out.length && out.at(-1) !== '') push('')
      push(`${n}. ${l.slice(q[0].length)}`)
      continue
    }
    const s = numbering ? SUB_START.exec(l) : null
    if (s) { push(`(${(s[1] || s[2]).toLowerCase()}) ${l.slice(s[0].length)}`); continue }
    let prev = out.at(-1)
    const startsNew = /^[-*•]\s/.test(l)
    // OCR often puts a blank line inside a wrapped sentence: a lowercase start after an unfinished line continues it
    if (join && prev === '' && out.length > 1 && /^[a-z]/.test(l) && !startsNew && !/[.?!:;]$/.test(out.at(-2)) && !SECTION_RE.test(out.at(-2))) { out.pop(); prev = out.at(-1) }
    if (join && prev && !startsNew && (!/[.?!:;]$/.test(prev) || /^[a-z]/.test(l))) out[out.length - 1] = `${prev} ${l}`
    else push(l)
  }
  while (out.at(-1) === '') out.pop()
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

/** Cleaned text -> docx paragraph descriptors [{text, kind: 'section'|'q'|'sub'|'text'|'gap'}] */
export function structure(text) {
  return text.split('\n').map((l) => (!l.trim() ? { text: '', kind: 'gap' } : SECTION_RE.test(l) && l === l.toUpperCase() ? { text: l, kind: 'section' } : /^\d+\.\s/.test(l) ? { text: l, kind: 'q' } : /^\([a-h]|i{1,3}|iv|v|vi{1,3}\)\s/.test(l) ? { text: l, kind: 'sub' } : { text: l, kind: 'text' }))
}

async function textDocx(text, title) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await loadDocx()
  const children = []
  if (title) children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: title, font: 'Calibri' })] }))
  for (const p of structure(text)) {
    if (p.kind === 'gap') continue
    if (p.kind === 'section') children.push(new Paragraph({ spacing: { before: 280, after: 120 }, children: [new TextRun({ text: p.text, bold: true, font: 'Calibri', size: 26 })] }))
    else if (p.kind === 'q') { const m = /^(\d+\.)\s(.*)$/s.exec(p.text); children.push(new Paragraph({ spacing: { before: 160, after: 80 }, indent: { left: 540, hanging: 540 }, children: [new TextRun({ text: m[1] + '\t', bold: true, font: 'Calibri' }), new TextRun({ text: m[2], font: 'Calibri' })], tabStops: [{ type: 'left', position: 540 }] })) }
    else if (p.kind === 'sub') children.push(new Paragraph({ spacing: { after: 60 }, indent: { left: 1080, hanging: 460 }, children: [new TextRun({ text: p.text, font: 'Calibri' })] }))
    else children.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: p.text, font: 'Calibri' })] }))
  }
  return Packer.toBlob(new Document({ sections: [{ children }] }))
}

const toMarkdown = (text) => structure(text).map((p) => (p.kind === 'section' ? `\n## ${p.text}\n` : p.kind === 'sub' ? `   - ${p.text}` : p.text)).join('\n').replace(/\n{3,}/g, '\n\n')

export function mount(root) {
  toolStyle('qp', CSS)
  const prefs = { lang: 'eng', numbering: true, join: true, headers: true, sections: true, enhance: false, forceOcr: false, ...load('qp:prefs', {}) }
  const sp = () => save('qp:prefs', prefs)
  const S = { raw: '', conf: [], sources: [] }
  const list = fileList({ onChange: () => { go.disabled = !list.files.length } })
  const dz = dropzone({ accept: 'image/*,.heic,.heif,.pdf,application/pdf', multiple: true, label: 'Add photos, scans or PDFs of the paper', hint: 'Pages are read in the order shown. Sharp, well-lit, straight-on photos work best.', onFiles: (fs) => list.add(fs) })
  const prog = progress('Reading pages')
  const result = h('div')
  const info = h('div')
  const out = h('textarea', { class: 'textarea out', spellcheck: true, 'aria-label': 'Recognised text', placeholder: 'The text appears here once the pages are read. You can edit it freely.' })
  let view = 'clean'
  const viewSeg = segmented([['clean', 'Cleaned'], ['raw', 'Raw OCR']], view, (v) => { view = v; showText() }, 'Text version')
  const langSel = select(OCR_LANGS, prefs.lang, (v) => { prefs.lang = v; sp() })
  const go = button('Read the pages', { variant: 'primary', size: 'lg', icon: 'scan-text', disabled: true })

  const cleaned = () => cleanText(S.raw, prefs)
  function showText() {
    out.value = S.raw ? (view === 'clean' ? cleaned() : S.raw.replace(/\f/g, '\n\n----- page break -----\n\n')) : ''
    const t = out.value
    clear(info, S.raw ? h('div', { class: 'row' }, pill(`${formatNumber((t.match(/\S+/g) || []).length, 0)} words`, '', 'text'), pill(`${(S.raw.match(/\f/g) || []).length + 1} page${(S.raw.match(/\f/g) || []).length ? 's' : ''}`, '', 'files'),
      ...S.conf.filter((c) => c != null).slice(0, 1).map(() => pill(`OCR confidence ${Math.round(S.conf.filter((c) => c != null).reduce((a, b) => a + b, 0) / S.conf.filter((c) => c != null).length)}%`, S.conf.filter((c) => c != null).reduce((a, b) => a + b, 0) / S.conf.filter((c) => c != null).length >= 80 ? 'ok' : 'warn', 'gauge'))) : null)
  }
  const reclean = debounce(() => { if (S.raw && view === 'clean') showText() }, 200)
  const opt = (label, key, hint) => toggle(label, prefs[key], (v) => { prefs[key] = v; sp(); reclean() })

  go.addEventListener('click', () => busy(go, async () => {
    const files = [...list.files]
    if (!files.length) throw new Error('Add at least one file first.')
    clear(result)
    list.setDisabled(true)
    const pages = []
    S.conf = []
    try {
      // work out the list of page jobs first so the progress bar is honest
      const jobs = []
      for (const f of files) {
        if (/pdf/i.test(f.type) || /\.pdf$/i.test(f.name)) {
          const doc = await openPdf(f)
          let textPages = []
          if (!prefs.forceOcr) {
            try { textPages = (await extractText(doc)).map((p) => p.text) } catch { textPages = [] }
          }
          const hasText = textPages.length && textPages.filter((t) => t.replace(/\s/g, '').length > 40).length >= Math.ceil(doc.numPages / 2)
          for (let i = 1; i <= doc.numPages; i++) jobs.push(hasText ? { kind: 'text', text: textPages[i - 1] || '', name: `${f.name} p${i}` } : { kind: 'pdf', doc, n: i, name: `${f.name} p${i}` })
        } else jobs.push({ kind: 'img', file: f, name: f.name })
      }
      if (jobs.length > 60) throw new Error(`That is ${jobs.length} pages. Please read up to 60 pages at a time.`)
      for (let i = 0; i < jobs.length; i++) {
        const j = jobs[i]
        const base = i / jobs.length
        const step = (frac, label) => prog.set(base + (frac / jobs.length), `Page ${i + 1} of ${jobs.length}: ${label}`)
        if (j.kind === 'text') { pages.push(j.text); S.conf.push(null); step(1, 'text layer'); continue }
        step(0, 'preparing')
        let canvas
        if (j.kind === 'pdf') canvas = await renderPage(j.doc, j.n, { scale: 2.2 })
        else {
          const img = await loadImage(j.file)
          const { width, height } = fitSize(img.naturalWidth, img.naturalHeight, 3200, 3200)
          canvas = toCanvas(img, width, height, { background: '#fff' })
        }
        if (prefs.enhance) scanFilter(canvas, 'gray', 60)
        const r = await recognize(canvas, { lang: prefs.lang, onProgress: (f, l) => step(f, l) })
        pages.push(r.text); S.conf.push(r.confidence)
        canvas.width = canvas.height = 0
      }
    } finally { list.setDisabled(false) }
    S.raw = pages.join('\f')
    if (!S.raw.replace(/[\s\f]/g, '')) { clear(result, alert('warn', 'No text was found. Try a sharper photo, the right language, or switch on "Enhance contrast".')); showText(); return }
    view = 'clean'; viewSeg.set('clean'); showText()
    clear(result, alert('success', `Read ${pages.length} page${pages.length === 1 ? '' : 's'}. Check the text against the paper, especially numbers and symbols.`))
    confetti(go, { count: 40 })
  }, { label: 'Reading', errorTo: result, progress: prog }))

  const need = () => { if (!out.value.trim()) { toast('Read some pages first', 'error'); return false } return true }
  const stem = () => safeName(baseName(list.files[0]?.name || 'question-paper'))
  const left = h('div', { class: 'stack' },
    tile({ tint: TINTS[0], title: 'Pages', icon: 'files' }, h('div', { class: 'stack' }, dz, list.el)),
    tile({ tint: TINTS[2], title: 'Options', icon: 'sliders-horizontal' }, h('div', { class: 'stack' },
      field('Language of the paper', langSel, 'The language data downloads once and is then cached.'),
      opt('Clean up numbering (Q1., 1), (1) become 1.)', 'numbering'), opt('Join broken lines into paragraphs', 'join'), opt('Remove page numbers and repeated headers', 'headers'), opt('Mark SECTION headings', 'sections'),
      toggle('Enhance contrast for dim photos', prefs.enhance, (v) => { prefs.enhance = v; sp() }), toggle('Always OCR PDFs (skip their text layer)', prefs.forceOcr, (v) => { prefs.forceOcr = v; sp() }))),
    h('div', { class: 'row' }, go), prog.el, result)
  const right = tile({ tint: TINTS[4], title: 'Text', icon: 'file-text', actions: info },
    h('div', { class: 'stack' }, h('div', { class: 'row' }, viewSeg), out,
      h('div', { class: 'row' },
        button('Copy text', { variant: 'primary', icon: 'copy', onClick: () => need() && copyText(out.value) }),
        button('.docx', { icon: 'file-type', onClick: function () { if (need()) busy(this, async () => download(await textDocx(out.value, ''), `${stem()}.docx`), 'Building') } }),
        button('.txt', { icon: 'file-text', onClick: () => need() && download(out.value, `${stem()}.txt`, 'text/plain') }),
        button('.md', { icon: 'file-code', onClick: () => need() && download(toMarkdown(out.value), `${stem()}.md`, 'text/markdown') }),
        button('Make a quiz', { icon: 'list-checks', variant: 'ghost', onClick: () => need() && handoff('quiz-generator', out.value) })),
      h('div', { class: 'stu-hint' }, 'OCR is never perfect: check numbers, units and symbols. Math formulas are not read as math, so use Math equation OCR for those.')))
  root.append(stage('t-qp', h('div', { class: 'stu-bento' }, h('div', { class: 's5', style: 'min-width:0' }, left), h('div', { class: 's7', style: 'min-width:0' }, right))))
  out.addEventListener('input', () => { /* edits stay in the box; exports use what you see */ })
  showText()
}
