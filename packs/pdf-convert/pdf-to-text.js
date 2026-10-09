// PDF to text. Reading-order text (columns, paragraphs, lists), layout-preserving text, or the raw line order. Per-page cards with
// search, copy and download. Scanned PDFs are detected and pointed at the OCR tool.
import { h, button, busy, progress, alert, segmented, toggle, field, input, debounce, clear, download, icon, formatNumber } from '../../lib/ui.js'
import { copyText } from '../../lib/ui.js'
import { zip, baseName } from '../../lib/files.js'
import { analyze, blocksToText, layoutText, buildLines, pageReader } from './_layout.js'
import { useStyles, flow, step, options, pdfSource, pageSelector, chip, note, plural, secs, checkAbort } from './_shared.js'

const CSS = `
.t-ptt .pg { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); overflow: hidden; animation: rise .4s var(--ease) both; }
.t-ptt .pg-h { display: flex; align-items: center; gap: 8px; padding: 9px 12px 9px 16px; background: var(--surface-2); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.t-ptt .pg-h b { font-size: 13.5px; } .t-ptt .pg-h .grow { flex: 1; }
.t-ptt .pg pre { margin: 0; padding: 16px; white-space: pre-wrap; overflow-wrap: anywhere; font: 14.5px/1.65 var(--font); max-height: 440px; overflow: auto; color: var(--text); tab-size: 4; }
.t-ptt.layout .pg pre { font: 12.5px/1.5 var(--mono); white-space: pre; overflow-wrap: normal; }
.t-ptt .pg pre.empty-pg { color: var(--muted); font-style: italic; }
.t-ptt mark { background: color-mix(in srgb, var(--accent) 28%, transparent); color: inherit; border-radius: 4px; padding: 0 2px; }
.t-ptt .bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.t-ptt .bar .input { flex: 1 1 200px; max-width: 320px; }
.t-ptt .more { align-self: center; }
`

const MODES = [['reading', 'Reading order'], ['layout', 'Keep layout'], ['raw', 'Raw lines']]
const PAGE_LIMIT = 40

export function mount(root, { signal }) {
  useStyles({ id: 'ptt', css: CSS })
  const S = { mode: 'reading', headers: false, markers: true, q: '' }
  const fl = flow('pdf', 'txt')
  const prog = progress()
  const out = h('div', { class: 'stack' })
  const reader = pageReader(() => src.doc)
  let texts = [], nums = [], shown = PAGE_LIMIT, runToken = 0

  const src = pdfSource({
    onLoad: () => { reader.clear(); pages.reset(); texts = []; s2.unlock(); s3.unlock(); clear(out); fl.state('idle'); if (src.numPages <= 30) run() },
    onClear: () => { s2.lock(); s3.lock(); clear(out); texts = [] },
  })
  src.onSniff = () => { if (texts.length) renderOut() }
  const pages = pageSelector(src, { thumbs: false, onChange: () => { if (src.doc) auto() } })

  const modeSeg = segmented(MODES, S.mode, (v) => { S.mode = v; root.firstChild.classList.toggle('layout', v === 'layout'); sync(); auto() }, 'Text mode')
  const headTog = toggle('Remove headers, footers and page numbers', S.headers, (v) => { S.headers = v; auto() })
  const markTog = toggle('Add page markers', S.markers, (v) => { S.markers = v; renderOut() })
  const hint = h('div', { class: 'cv-sub' })
  const modeHints = {
    reading: 'Follows columns, joins lines into paragraphs and keeps lists. Best for copying and editing.',
    layout: 'Keeps text where it sits on the page, with columns and gaps aligned in monospace.',
    raw: 'Every line as it is stored in the PDF, top to bottom. Nothing is joined or reordered.',
  }
  function sync() { hint.textContent = modeHints[S.mode]; headTog.hidden = S.mode !== 'reading' }

  const auto = debounce(() => { if (texts.length || src.numPages <= 30) run() }, 350)
  const runBtn = button('Extract text', { icon: 'text-select', variant: 'primary', size: 'lg' })
  runBtn.addEventListener('click', () => busy(runBtn, run, { label: 'Extracting', errorTo: out, progress: prog }))

  async function run() {
    const token = ++runToken
    let list
    try { list = pages.pages() } catch (e) { return clear(out, alert('warn', e.message)) }
    fl.state('working')
    const t0 = performance.now()
    try {
      const data = await reader.pages(list, { signal, onProgress: (f, t) => prog.set(f, t) })
      if (token !== runToken) return
      let res
      if (S.mode === 'layout') {
        const body = (() => { const sizes = data.flatMap((p) => p.items.map((i) => Math.round(i.fs))); const m = new Map(); for (const s of sizes) m.set(s, (m.get(s) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 11 })()
        res = layoutText(data, { body })
      } else if (S.mode === 'raw') res = data.map((p) => buildLines(p.items).map((l) => l.text).join('\n'))
      else {
        const a = analyze(data, { removeHeaders: S.headers, joinPages: false, hyphens: true })
        res = a.pages.map((p) => blocksToText([p]))
      }
      nums = list
      texts = res
      shown = PAGE_LIMIT
      prog.hide()
      renderOut(performance.now() - t0)
      fl.state('done')
    } catch (e) { fl.state('idle'); prog.hide(); throw e }
  }

  const wordsOf = (t) => (t.match(/\S+/g) || []).length
  const full = () => texts.map((t, i) => (S.markers ? `--- Page ${nums[i]} ---\n\n${t}` : t)).join('\n\n')
  function renderOut(ms) {
    if (!texts.length) return
    const totalWords = texts.reduce((n, t) => n + wordsOf(t), 0), totalChars = texts.reduce((n, t) => n + t.length, 0)
    const q = S.q.trim().toLowerCase()
    const matching = texts.map((t, i) => i).filter((i) => !q || texts[i].toLowerCase().includes(q))
    const name = baseName(src.file.name)
    const bar = h('div', { class: 'bar' },
      button('Copy all', { icon: 'copy', variant: 'primary', onClick: () => copyText(full()) }),
      button('Download .txt', { icon: 'download', onClick: () => download(new Blob([full()], { type: 'text/plain;charset=utf-8' }), `${name}.txt`) }),
      texts.length > 1 && button('Pages as ZIP', { icon: 'folder-down', onClick: async () => download(await zip(texts.map((t, i) => ({ name: `${name}-page-${String(nums[i]).padStart(String(src.numPages).length, '0')}.txt`, data: t }))), `${name}-text.zip`) }),
      input({ type: 'search', placeholder: 'Search the text', 'aria-label': 'Search extracted text', value: S.q, oninput: debounce((e) => { S.q = e.target.value; renderOut() }, 200) }))
    const chips = h('div', { class: 'cv-chips' }, chip(plural(texts.length, 'page'), '', 'layers'), chip(`${formatNumber(totalWords, 0)} words`, '', 'text'), chip(`${formatNumber(totalChars, 0)} characters`, '', 'case-sensitive'),
      q && chip(`${matching.length} page${matching.length === 1 ? '' : 's'} match`, 'good', 'search'), ms != null && chip(secs(ms), '', 'timer'))
    const shownList = matching.slice(0, shown)
    const cards = shownList.map((i) => {
      const t = texts[i]
      const pre = h('pre', { class: !t.trim() && 'empty-pg' }, t.trim() ? highlight(t, q) : 'No text found on this page.')
      return h('section', { class: 'pg' }, h('div', { class: 'pg-h' }, h('b', `Page ${nums[i]}`), h('span', { class: 'cv-sub grow' }, `${formatNumber(wordsOf(t), 0)} words`),
        button('Copy', { icon: 'copy', variant: 'ghost', size: 'sm', onClick: () => copyText(t) }),
        button('.txt', { icon: 'download', variant: 'ghost', size: 'sm', ariaLabel: `Download page ${nums[i]}`, onClick: () => download(new Blob([t], { type: 'text/plain;charset=utf-8' }), `${name}-page-${nums[i]}.txt`) })), pre)
    })
    const scanned = totalChars < 20 * texts.length && totalChars < 60
    clear(out,
      scanned ? alert('warn', h('strong', 'No selectable text found. '), 'This PDF looks scanned. ', h('a', { class: 'link', href: '#/pdf-ocr' }, 'Run OCR PDF'), ' to read the text from the page images.') : null,
      chips, bar, ...cards,
      matching.length > shown ? h('div', { class: 'row' }, button(`Show ${Math.min(PAGE_LIMIT, matching.length - shown)} more pages`, { variant: 'secondary', onClick: () => { shown += PAGE_LIMIT; renderOut() } })) : null,
      q && !matching.length ? alert('info', `No page contains "${S.q}".`) : null)
  }

  function highlight(t, q) {
    if (!q) return t
    const parts = []
    const low = t.toLowerCase()
    let i = 0, k
    while ((k = low.indexOf(q, i)) >= 0 && parts.length < 800) { parts.push(t.slice(i, k), h('mark', t.slice(k, k + q.length))); i = k + q.length }
    parts.push(t.slice(i))
    return parts
  }

  const s1 = step(1, 'Choose your PDF', src.el)
  const s2 = step(2, 'Pages and style', h('div', { class: 'stack' }, pages.el, options(h('div', { class: 'stack tight' }, field('Text mode', modeSeg), hint), h('div', { class: 'stack tight' }, headTog, markTog))), { locked: true })
  const s3 = step(3, 'Your text', h('div', { class: 'stack' }, h('div', { class: 'row' }, runBtn, note('Reads the text layer on your device. Nothing is uploaded.', 'shield-check')), prog.el, out), { locked: true })
  sync()
  root.append(h('div', { class: 'cv t-ptt' }, fl, s1, s2, s3))
}
