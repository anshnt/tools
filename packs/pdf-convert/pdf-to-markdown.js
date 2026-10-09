// PDF to Markdown. Headings from font sizes, bold and italic from font names, lists, tables, code, links, columns in reading order.
// Edit the Markdown on the left and the rendered preview on the right follows.
import { h, button, busy, progress, alert, toggle, field, textarea, debounce, clear, download, icon, formatNumber } from '../../lib/ui.js'
import { copyText } from '../../lib/ui.js'
import { marked as markedLib, dompurify } from '../../lib/libs.js'
import { baseName } from '../../lib/files.js'
import { analyze, blocksToMarkdown, pageReader } from './_layout.js'
import { useStyles, flow, step, options, pdfSource, pageSelector, chip, note, plural, secs } from './_shared.js'

const CSS = `
.t-ptm .editor { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: stretch; }
.t-ptm .editor .textarea { min-height: 460px; height: 100%; font-size: 13px; resize: vertical; }
.t-ptm .pv { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); padding: 6px 22px 22px; overflow: auto; max-height: 640px; min-height: 460px; font-size: 15px; line-height: 1.65; }
.t-ptm .pv h1 { font-size: 1.7em; letter-spacing: -.03em; } .t-ptm .pv h2 { font-size: 1.35em; letter-spacing: -.02em; } .t-ptm .pv h3 { font-size: 1.15em; }
.t-ptm .pv table { border-collapse: collapse; display: block; overflow-x: auto; font-size: 13.5px; margin: 0 0 1em; } .t-ptm .pv th { background: var(--surface-2); }
.t-ptm .pv code { font-family: var(--mono); font-size: .9em; background: var(--surface-2); padding: 1px 5px; border-radius: 5px; } .t-ptm .pv pre code { background: none; padding: 0; }
.t-ptm .pv blockquote { margin: 0 0 1em; padding-left: 14px; border-left: 3px solid var(--accent); color: var(--text-2); } .t-ptm .pv hr { border: 0; border-top: 1px solid var(--border); margin: 1.5em 0; }
.t-ptm .pv ul, .t-ptm .pv ol { padding-left: 1.5em; } .t-ptm .pv-h { display: flex; justify-content: space-between; align-items: center; font-size: 13px; font-weight: 600; margin-bottom: 8px; color: var(--text-2); }
@media (max-width: 900px) { .t-ptm .editor { grid-template-columns: minmax(0, 1fr); } .t-ptm .editor .textarea, .t-ptm .pv { min-height: 280px; } }
`

export function mount(root, { signal }) {
  useStyles({ id: 'ptm', css: CSS })
  const S = { headings: true, boldHeadings: true, lists: true, tables: true, removeHeaders: true, pageBreaks: false, joinPages: true, columns: true }
  const fl = flow('pdf', 'md')
  const prog = progress()
  const out = h('div', { class: 'stack' })
  const reader = pageReader(() => src.doc)
  let token = 0, md = null, stats = null

  const src = pdfSource({
    onLoad: () => { reader.clear(); pages.reset(); s2.unlock(); s3.unlock(); clear(out); md = null; fl.state('idle'); if (src.numPages <= 30) run() },
    onClear: () => { s2.lock(); s3.lock(); clear(out); md = null },
  })
  const pages = pageSelector(src, { thumbs: false, onChange: () => { if (src.doc) auto() } })
  const tog = (key, label) => toggle(label, S[key], (v) => { S[key] = v; auto() })
  const auto = debounce(() => { if (md !== null || src.numPages <= 30) run() }, 350)
  const runBtn = button('Convert to Markdown', { icon: 'file-code-2', variant: 'primary', size: 'lg' })
  runBtn.addEventListener('click', () => busy(runBtn, run, { label: 'Converting', errorTo: out, progress: prog }))

  async function run() {
    const t = ++token
    let list
    try { list = pages.pages() } catch (e) { return clear(out, alert('warn', e.message)) }
    fl.state('working')
    const t0 = performance.now()
    try {
      const data = await reader.pages(list, { signal, onProgress: (f, tx) => prog.set(f, tx) })
      if (t !== token) return
      const a = analyze(data, { headings: S.headings, boldHeadings: S.boldHeadings, lists: S.lists, tables: S.tables, removeHeaders: S.removeHeaders, joinPages: S.joinPages, columns: S.columns })
      md = blocksToMarkdown(a.pages, { pageBreaks: S.pageBreaks })
      const all = a.pages.flatMap((p) => p.blocks)
      stats = {
        headings: all.filter((b) => b.type === 'heading').length, lists: all.filter((b) => b.type === 'li').length, tables: all.filter((b) => b.type === 'table').length,
        words: (md.match(/\S+/g) || []).length, removed: a.removed, ms: performance.now() - t0, pages: list.length,
      }
      prog.hide()
      await render()
      fl.state('done')
    } catch (e) { fl.state('idle'); prog.hide(); throw e }
  }

  async function renderPreview(text, pv) {
    const [{ marked }, DOMPurify] = await Promise.all([markedLib(), dompurify()])
    pv.innerHTML = DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: false }), { ADD_ATTR: ['target'] })
    for (const a of pv.querySelectorAll('a')) { a.target = '_blank'; a.rel = 'noopener noreferrer' }
  }

  async function render() {
    const name = baseName(src.file.name)
    const ta = textarea({ value: md, spellcheck: false, mono: true, 'aria-label': 'Markdown output' })
    const pv = h('div', { class: 'pv prose', 'aria-label': 'Rendered preview' })
    await renderPreview(md, pv)
    ta.addEventListener('input', debounce(() => { md = ta.value; renderPreview(md, pv) }, 200))
    const scanned = stats.words < 5
    clear(out,
      scanned ? alert('warn', h('strong', 'No selectable text found. '), 'This PDF looks scanned. ', h('a', { class: 'link', href: '#/pdf-ocr' }, 'Run OCR PDF'), ' first, then convert the searchable result.') : null,
      h('div', { class: 'cv-chips' }, chip(plural(stats.pages, 'page'), '', 'layers'), chip(`${formatNumber(stats.words, 0)} words`, '', 'text'), stats.headings ? chip(plural(stats.headings, 'heading'), '', 'heading') : null,
        stats.lists ? chip(plural(stats.lists, 'list item'), '', 'list') : null, stats.tables ? chip(plural(stats.tables, 'table'), '', 'table') : null,
        stats.removed ? chip(`${stats.removed} header/footer lines removed`, '', 'eraser') : null, chip(secs(stats.ms), '', 'timer')),
      h('div', { class: 'row' }, button('Copy Markdown', { icon: 'copy', variant: 'primary', onClick: () => copyText(ta.value) }),
        button('Download .md', { icon: 'download', onClick: () => download(new Blob([ta.value], { type: 'text/markdown;charset=utf-8' }), `${name}.md`) })),
      h('div', { class: 'editor' }, h('div', h('div', { class: 'pv-h' }, 'Markdown (editable)'), ta), h('div', h('div', { class: 'pv-h' }, 'Preview'), pv)))
  }

  const s1 = step(1, 'Choose your PDF', src.el)
  const s2 = step(2, 'Pages and structure', h('div', { class: 'stack' }, pages.el, options(
    h('div', { class: 'stack tight' }, tog('headings', 'Headings from font size'), tog('boldHeadings', 'Treat short bold lines as headings'), tog('lists', 'Detect bullet and numbered lists')),
    h('div', { class: 'stack tight' }, tog('tables', 'Tables as Markdown tables'), tog('columns', 'Follow multi-column reading order'), tog('removeHeaders', 'Remove headers, footers and page numbers')),
    h('div', { class: 'stack tight' }, tog('joinPages', 'Join paragraphs split across pages'), tog('pageBreaks', 'Mark page breaks with a rule (---)')))), { locked: true })
  const s3 = step(3, 'Your Markdown', h('div', { class: 'stack' }, h('div', { class: 'row' }, runBtn, note('Structure is inferred from fonts and positions, so check the result. Runs on your device.', 'shield-check')), prog.el, out), { locked: true })
  root.append(h('div', { class: 'cv t-ptm' }, fl, s1, s2, s3))
}
