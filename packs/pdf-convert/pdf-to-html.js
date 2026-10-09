// PDF to HTML. Text becomes semantic HTML (headings, paragraphs, lists, tables, code, links) with optional pictures as embedded images. Preview the page,
// copy the source, or download a complete .html file with tidy styles or just the body markup.
import { h, button, busy, progress, alert, toggle, field, segmented, tabs, clear, download, debounce, formatBytes, formatNumber } from '../../lib/ui.js'
import { copyText } from '../../lib/ui.js'
import { baseName } from '../../lib/files.js'
import { analyze, blocksToHtml, pageReader, attachImages } from './_layout.js'
import { useStyles, flow, step, options, pdfSource, pageSelector, chip, note, plural, secs } from './_shared.js'

const CSS = `
.t-pth .pvf { width: 100%; height: 560px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: #fff; display: block; }
.t-pth .src { min-height: 360px; max-height: 560px; font-size: 12.5px; }
`
const PAGE_CSS = `body{font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1c2430;max-width:780px;margin:40px auto;padding:0 20px}h1,h2,h3,h4{line-height:1.25;margin:1.6em 0 .5em}h1{font-size:2em;margin-top:0}p{margin:0 0 1em}table{border-collapse:collapse;width:100%;margin:1em 0}th,td{border:1px solid #d7dbe2;padding:6px 10px;text-align:left}th{background:#f3f4f7}pre{background:#f3f4f7;padding:12px 14px;border-radius:8px;overflow:auto}code{font-family:ui-monospace,Menlo,Consolas,monospace}img{max-width:100%;height:auto}a{color:#4f46e5}`

export function mount(root, { signal }) {
  useStyles({ id: 'pth', css: CSS })
  const S = { headings: true, lists: true, tables: true, pictures: false, removeHeaders: true, full: true, columns: true }
  const fl = flow('pdf', 'html')
  const prog = progress()
  const out = h('div', { class: 'stack' })
  const reader = pageReader(() => src.doc)
  const imgDone = new WeakSet()
  let token = 0, body = ''
  const src = pdfSource({
    onLoad: () => { reader.clear(); pages.reset(); s2.unlock(); s3.unlock(); clear(out); body = ''; fl.state('idle'); if (src.numPages <= 30) run() },
    onClear: () => { s2.lock(); s3.lock(); clear(out); body = '' },
  })
  const pages = pageSelector(src, { thumbs: false, onChange: () => { if (src.doc) auto() } })
  const tog = (key, label) => toggle(label, S[key], (v) => { S[key] = v; if (key === 'full') render(); else auto() })
  const auto = debounce(() => { if (body || src.numPages <= 30) run() }, 350)
  const runBtn = button('Convert to HTML', { icon: 'code', variant: 'primary', size: 'lg' })
  runBtn.addEventListener('click', () => busy(runBtn, run, { label: 'Converting', errorTo: out, progress: prog }))
  let stats = null

  async function run() {
    const t = ++token
    let list
    try { list = pages.pages() } catch (e) { return clear(out, alert('warn', e.message)) }
    fl.state('working')
    const t0 = performance.now()
    try {
      const data = await reader.pages(list, { signal, onProgress: (f, tx) => prog.set(f * (S.pictures ? 0.5 : 1), tx) })
      if (S.pictures) {
        for (let i = 0; i < data.length; i++) { if (!imgDone.has(data[i])) { prog.set(0.5 + 0.5 * (i / data.length), `Looking for pictures on page ${data[i].n}`); await attachImages(src.doc, data[i], { scale: 1.6 }); imgDone.add(data[i]) } }
      }
      if (t !== token) return
      const prepared = data.map((d) => ({ ...d, images: S.pictures ? d.images || [] : [] }))
      const a = analyze(prepared, { headings: S.headings, boldHeadings: S.headings, lists: S.lists, tables: S.tables, removeHeaders: S.removeHeaders, joinPages: true, columns: S.columns })
      body = blocksToHtml(a.pages)
      const all = a.pages.flatMap((p) => p.blocks)
      stats = { headings: all.filter((b) => b.type === 'heading').length, tables: all.filter((b) => b.type === 'table').length, pictures: all.filter((b) => b.type === 'image').length, pages: list.length, ms: performance.now() - t0 }
      prog.hide()
      render()
      fl.state('done')
    } catch (e) { fl.state('idle'); prog.hide(); throw e }
  }

  function html() {
    if (!S.full) return body
    return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${baseName(src.file.name).replace(/[<&]/g, '')}</title>\n<style>${PAGE_CSS}</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`
  }
  function render() {
    if (!body && !stats) return
    const full = html()
    const blobSize = new Blob([full]).size
    const pv = h('iframe', { class: 'pvf', sandbox: '', title: 'HTML preview', srcdoc: `<!doctype html><html><head><meta charset="utf-8"><style>${PAGE_CSS}</style></head><body>${body}</body></html>` })
    const srcTa = h('textarea', { class: 'textarea mono src', readonly: true, spellcheck: false, 'aria-label': 'HTML source' })
    srcTa.value = full
    clear(out,
      !body.trim() ? alert('warn', h('strong', 'No text found. '), 'This PDF may be scanned. ', h('a', { class: 'link', href: '#/pdf-ocr' }, 'Run OCR PDF'), ' first.') : null,
      h('div', { class: 'cv-chips' }, chip(plural(stats.pages, 'page'), '', 'layers'), stats.headings ? chip(plural(stats.headings, 'heading'), '', 'heading') : null, stats.tables ? chip(plural(stats.tables, 'table'), '', 'table') : null, stats.pictures ? chip(plural(stats.pictures, 'picture'), '', 'image') : null, chip(formatBytes(blobSize), '', 'hard-drive'), chip(secs(stats.ms), '', 'timer')),
      h('div', { class: 'row' }, button('Download .html', { icon: 'download', variant: 'primary', onClick: () => download(new Blob([html()], { type: 'text/html;charset=utf-8' }), `${baseName(src.file.name)}.html`) }), button('Copy HTML', { icon: 'copy', onClick: () => copyText(html()) })),
      tabs([{ id: 'preview', label: 'Preview', render: () => pv }, { id: 'source', label: 'HTML source', render: () => srcTa }], 'preview'))
  }

  const s1 = step(1, 'Choose your PDF', src.el)
  const s2 = step(2, 'Pages and structure', h('div', { class: 'stack' }, pages.el, options(
    h('div', { class: 'stack tight' }, tog('headings', 'Headings from font size and weight'), tog('lists', 'Detect lists'), tog('tables', 'Detect tables')),
    h('div', { class: 'stack tight' }, tog('columns', 'Follow multi-column reading order'), tog('removeHeaders', 'Remove headers, footers and page numbers'), tog('pictures', 'Include pictures (embedded in the file)')),
    h('div', { class: 'stack tight' }, tog('full', 'Complete page with styles (off: body markup only)')))), { locked: true })
  const s3 = step(3, 'Your HTML', h('div', { class: 'stack' }, h('div', { class: 'row' }, runBtn, note('Structure is inferred from fonts and positions. Runs on your device.', 'shield-check')), prog.el, out), { locked: true })
  root.append(h('div', { class: 'cv t-pth' }, fl, s1, s2, s3))
}
