// Extract pages with a keyword: search the text of every page (case and whole-word options, phrase / any / all),
// see highlighted snippets per page, pick pages and save them as a new PDF.
import { h, icon, button, busy, progress, field, input, segmented, toggle, stats, empty, clear, formatBytes, downloadButton, debounce } from '../../lib/ui.js'
import { suffixName } from '../../lib/files.js'
import { extractText, savePdf } from '../../lib/pdf.js'
import { pdfLib } from '../../lib/libs.js'
import { pdfSource, ppRoot, pageThumb, doneCard, useStyle, countUp, compressRanges } from './_shared.js'

const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const W = '[\\p{L}\\p{N}_]'

/** Build one RegExp per search term. mode: 'phrase' | 'any' | 'all'. */
export function buildTerms(query, { mode = 'phrase', matchCase = false, wholeWord = false } = {}) {
  const raw = mode === 'phrase' ? [query.trim()] : query.split(/[\s,;]+/).map((t) => t.trim())
  const terms = [...new Set(raw.filter(Boolean))]
  const flags = `gu${matchCase ? '' : 'i'}`
  return terms.map((t) => {
    let src = esc(t).replace(/\s+/g, '\\s+')
    if (wholeWord) src = `(?<!${W})${src}(?!${W})`
    return new RegExp(src, flags)
  })
}

/** Search page texts. -> [{page, count, snippets: [{text, ranges: [[start, end]]}]}] for pages that qualify (or do not, with invert). */
export function searchPages(texts, query, opts = {}) {
  const res = buildTerms(query, opts)
  if (!res.length) return []
  const out = []
  for (const { page, text } of texts) {
    const flat = text.replace(/\s+/g, ' ')
    const counts = res.map((re) => { re.lastIndex = 0; return [...flat.matchAll(re)] })
    const ok = opts.mode === 'all' ? counts.every((m) => m.length) : counts.some((m) => m.length)
    const all = counts.flat().sort((a, b) => a.index - b.index)
    if ((opts.invert ? !ok : ok) === false) continue
    const snippets = []
    let lastEnd = -1
    for (const m of all) {
      if (m.index < lastEnd) continue
      const a = Math.max(0, m.index - 56), b = Math.min(flat.length, m.index + m[0].length + 56)
      snippets.push({ text: (a > 0 ? '...' : '') + flat.slice(a, b) + (b < flat.length ? '...' : '') })
      lastEnd = b
      if (snippets.length >= 8) break
    }
    out.push({ page, count: all.length, snippets })
  }
  return out
}

export function mount(root) {
  const body = h('div', { class: 'stack' })
  let s
  const src = pdfSource({ onLoad: async (source) => { s = source; await load(source) }, onClear: () => { s = null; clear(body) } })

  async function load(source) {
    await source.pageSizes()
    const prog = progress()
    clear(body, h('div', { class: 'row' }, h('span', { class: 'spinner' }), h('strong', 'Reading the text of every page...')), prog.el)
    const texts = await extractText(source.doc, (f) => prog.set(f, `Reading text ${Math.round(f * 100)}%`))
    if (source.dead) return
    prog.hide()
    const chars = texts.reduce((a, t) => a + t.text.length, 0)
    if (chars < 5) {
      clear(body, empty('This PDF has no text layer (it looks like a scan). Run OCR PDF first, then search it here.', 'scan-text'))
      return
    }
    show(texts, source)
  }

  function show(texts, source) {
    const o = { q: '', mode: 'phrase', matchCase: false, wholeWord: false, invert: false }
    const selected = new Set()
    const info = h('div')
    const list = h('div', { class: 'pp-hits' })
    const prog = progress()
    const result = h('div')
    const go = button('Extract pages', { icon: 'file-output', variant: 'primary', size: 'lg' })
    const q = input({ placeholder: 'Type a word or phrase to find...', 'aria-label': 'Search text', autocomplete: 'off', oninput: (e) => { o.q = e.target.value; slow() } })
    let hits = []

    const modeEl = segmented([['phrase', 'Exact phrase'], ['any', 'Any word'], ['all', 'All words']], 'phrase', (v) => { o.mode = v; render() }, 'Match')
    const caseEl = toggle('Match case', false, (c) => { o.matchCase = c; render() })
    const wordEl = toggle('Whole words only', false, (c) => { o.wholeWord = c; render() })
    const invEl = toggle('Pages that do NOT contain it', false, (c) => { o.invert = c; render() })

    function mark(sn) {
      const t = sn.text
      const re = buildTerms(o.q, o)
      const spans = []
      for (const r of re) { r.lastIndex = 0; for (const m of t.matchAll(r)) spans.push([m.index, m.index + m[0].length]) }
      spans.sort((a, b) => a[0] - b[0])
      const out = []
      let pos = 0
      for (const [a, b] of spans) {
        if (a < pos) continue
        out.push(t.slice(pos, a), h('mark', { class: 'pp-hit' }, t.slice(a, b)))
        pos = b
      }
      out.push(t.slice(pos))
      return out
    }

    function render() {
      if (!o.q.trim()) {
        hits = []
        selected.clear()
        clear(info)
        clear(list, empty('Type something above to find the pages that contain it.', 'search'))
        go.disabled = true
        return
      }
      hits = searchPages(texts, o.q, o)
      selected.clear()
      hits.forEach((x) => selected.add(x.page))
      const total = hits.reduce((a, x) => a + (o.invert ? 0 : x.count), 0)
      const st = stats([
        { label: 'Pages searched', value: String(texts.length) },
        { label: o.invert ? 'Pages without it' : 'Pages with a match', value: h('span', { 'data-n': hits.length }, '0'), accent: hits.length > 0, danger: hits.length === 0 },
        ...(o.invert ? [] : [{ label: 'Matches', value: h('span', { 'data-n': total }, '0') }]),
      ])
      for (const el of st.querySelectorAll('[data-n]')) countUp(el, +el.dataset.n, { ms: 350 })
      clear(info, st)
      clear(list, hits.length ? hits.map((x, i) => {
        const card = h('div', { class: 'pp-hit-row pp-in', role: 'button', tabindex: 0, 'data-state': 'on', style: { '--i': Math.min(i, 20) }, 'aria-label': `Page ${x.page}` },
          h('div', { class: 'pp-hit-thumb' }, pageThumb(s, x.page, { max: 160 })),
          h('div', { class: 'pp-hit-body' },
            h('div', { class: 'pp-hit-head' }, h('strong', `Page ${x.page}`), o.invert ? null : h('span', { class: 'pp-chip' }, `${x.count} ${x.count === 1 ? 'match' : 'matches'}`)),
            o.invert ? h('div', { class: 'small muted' }, 'No match on this page') : x.snippets.slice(0, 3).map((sn) => h('p', { class: 'pp-snip' }, mark(sn))),
            !o.invert && x.snippets.length > 3 ? h('div', { class: 'small muted' }, `+ ${x.snippets.length - 3} more on this page`) : null),
          h('span', { class: 'pp-tick', style: 'position:static;transform:scale(1)' }, icon('check')))
        const flip = () => {
          if (selected.has(x.page)) selected.delete(x.page); else selected.add(x.page)
          card.dataset.state = selected.has(x.page) ? 'on' : 'off'
          card.querySelector('.pp-tick').style.transform = selected.has(x.page) ? 'scale(1)' : 'scale(0)'
          sync()
        }
        card.addEventListener('click', flip)
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip() } })
        return card
      }) : empty(o.invert ? 'Every page contains it.' : 'No page matches. Try fewer words, or turn off Match case and Whole words.', 'search-x'))
      sync()
    }
    function sync() {
      go.disabled = selected.size === 0
      go.querySelector('span').textContent = selected.size ? `Extract ${selected.size} ${selected.size === 1 ? 'page' : 'pages'}` : 'Extract pages'
    }
    const slow = debounce(render, 160)

    go.addEventListener('click', () => busy(go, async () => {
      clear(result)
      const pages = [...selected].sort((a, b) => a - b)
      const { PDFDocument } = await pdfLib()
      const srcDoc = await s.inspect()
      const out = await PDFDocument.create()
      const copied = await out.copyPages(srcDoc, pages.map((p) => p - 1))
      copied.forEach((p) => out.addPage(p))
      const blob = await savePdf(out)
      clear(result, doneCard({
        title: `${pages.length} ${pages.length === 1 ? 'page' : 'pages'} extracted`, detail: `Pages ${compressRanges(pages)} of ${source.pages}. ${formatBytes(blob.size)}.`,
        actions: [downloadButton(blob, suffixName(s.name, 'keyword-pages'), 'Download PDF', { size: 'lg' })],
      }))
    }, { label: 'Extracting', errorTo: result, progress: prog }))

    clear(body,
      h('div', { class: 'panel' }, h('div', { class: 'stack' },
        h('div', { class: 'pp-searchbar' }, icon('search'), q),
        h('div', { class: 'pp-toolbar' }, field('Match', modeEl)),
        h('div', { class: 'pp-toolbar' }, caseEl, wordEl, invEl))),
      info, list, h('div', { class: 'row' }, go), prog.el, result)
    render()
    q.focus({ preventScroll: true })
  }

  useStyle('pp-style-keyword', CSS)
  root.append(ppRoot(src.el, body))
}

const CSS = `
.pp .pp-searchbar { position: relative; }
.pp .pp-searchbar > .icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
.pp .pp-searchbar input { padding-left: 42px; height: 48px; font-size: 16px; }
.pp .pp-hits { display: flex; flex-direction: column; gap: 10px; }
.pp .pp-hit-row { display: flex; gap: 14px; align-items: flex-start; padding: 12px; border-radius: 16px; background: var(--surface); border: 1px solid var(--border); cursor: pointer; transition: transform .25s var(--spring), border-color .2s, box-shadow .2s, opacity .2s; }
.pp .pp-hit-row:hover { transform: translateX(3px); border-color: var(--border-strong); }
.pp .pp-hit-row[data-state="on"] { border-color: color-mix(in srgb, var(--accent) 60%, var(--border)); box-shadow: 0 0 0 3px var(--ring); }
.pp .pp-hit-row[data-state="off"] { opacity: .55; }
.pp .pp-hit-thumb { width: 74px; flex: none; }
.pp .pp-hit-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.pp .pp-hit-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pp .pp-snip { margin: 0; font-size: 13.5px; color: var(--text-2); line-height: 1.5; overflow-wrap: anywhere; }
.pp .pp-hit-row .pp-tick { flex: none; transition: transform .3s var(--spring); }
`
