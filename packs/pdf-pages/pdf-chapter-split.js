// Split a PDF by chapters: reads the bookmarks (outline), resolves each destination to a page, and saves one PDF per
// chapter (top-level bookmarks, or deeper levels) as a ZIP.
import { h, icon, button, busy, progress, field, segmented, toggle, stats, empty, clear, formatBytes, downloadButton, input, yieldToMain } from '../../lib/ui.js'
import { zip, baseName, safeName } from '../../lib/files.js'
import { savePdf } from '../../lib/pdf.js'
import { pdfLib } from '../../lib/libs.js'
import { pdfSource, ppRoot, pageThumb, doneCard, useStyle, countUp, readOutline } from './_shared.js'

/** Deepest nesting level in an outline tree (1 = only top-level entries). */
export const outlineDepth = (items) => (items.length ? 1 + Math.max(...items.map((i) => outlineDepth(i.items || []))) : 0)

/**
 * Chapters from an outline tree. level: split at bookmarks up to this depth (1 = top level only).
 * -> {chapters: [{title, start, end, depth}] (0-based inclusive page indices), skipped: bookmarks without a page in this file}
 */
export function chaptersFrom(outline, pageCount, { level = 1, frontMatter = true, frontTitle = 'Front matter' } = {}) {
  const flat = []
  let skipped = 0
  const walk = (items, depth) => {
    for (const it of items) {
      if (depth <= level) {
        if (it.page == null || it.page < 0 || it.page >= pageCount) skipped++
        else flat.push({ title: it.title, page: it.page, depth, order: flat.length })
      }
      if (it.items?.length && depth < level) walk(it.items, depth + 1)
    }
  }
  walk(outline, 1)
  flat.sort((a, b) => a.page - b.page || a.order - b.order)
  const points = []
  for (const f of flat) if (!points.length || points.at(-1).page !== f.page) points.push(f) // two bookmarks on one page: keep the outer one
  const chapters = points.map((p, i) => ({ title: p.title, start: p.page, end: (points[i + 1]?.page ?? pageCount) - 1, depth: p.depth }))
  if (frontMatter && points.length && points[0].page > 0) chapters.unshift({ title: frontTitle, start: 0, end: points[0].page - 1, depth: 1, front: true })
  return { chapters, skipped }
}

export function mount(root, { signal }) {
  const body = h('div', { class: 'stack' })
  let s
  const src = pdfSource({ onLoad: (source) => { s = source; return load(source) }, onClear: () => { s = null; clear(body) } })

  async function load(source) {
    await source.pageSizes()
    clear(body, h('div', { class: 'row' }, h('span', { class: 'spinner' }), h('strong', 'Reading bookmarks...')))
    const outline = await readOutline(source.doc)
    if (source.dead) return
    if (!outline) {
      clear(body, empty('This PDF has no bookmarks, so there are no chapters to split on. Add some first with the PDF bookmark editor, or split by page range with Split PDF.', 'book-marked'))
      return
    }
    show(outline, source)
  }

  function show(outline, source) {
    const depth = outlineDepth(outline)
    const o = { level: 1, front: true }
    const sel = new Map() // start page -> {on, name}
    const info = h('div')
    const list = h('div', { class: 'pp-chaps' })
    const prog = progress(), result = h('div')
    const go = button('Split into files', { icon: 'book-marked', variant: 'primary', size: 'lg' })
    let chapters = []

    const fname = (c, i) => `${String(i + 1).padStart(2, '0')}-${safeName(sel.get(c.start)?.name || c.title).slice(0, 80)}.pdf`
    const chosen = () => chapters.filter((c) => sel.get(c.start)?.on !== false)

    function compute() {
      const r = chaptersFrom(outline, source.pages, { level: o.level, frontMatter: o.front })
      chapters = r.chapters
      render(r.skipped)
    }

    function render(skipped) {
      const st = stats([
        { label: 'Pages', value: String(source.pages) },
        { label: 'Chapters', value: h('span', { 'data-n': chapters.length }, '0'), accent: true, hint: skipped ? `${skipped} bookmark${skipped > 1 ? 's' : ''} point outside this file` : `Level ${o.level} of ${depth}` },
      ])
      for (const el of st.querySelectorAll('[data-n]')) countUp(el, +el.dataset.n, { ms: 350 })
      clear(info, st)
      clear(list, chapters.map((c, i) => {
        if (!sel.has(c.start)) sel.set(c.start, { on: true, name: c.title })
        const st = sel.get(c.start)
        const pagesN = c.end - c.start + 1
        const thumb = h('div', { class: 'pp-chap-thumb' }, pageThumb(source, c.start + 1, { max: 140 }))
        const nameEl = input({ value: st.name, 'aria-label': `File name for chapter ${i + 1}`, oninput: (e) => { st.name = e.target.value; fileEl.textContent = fname(c, i) } })
        const fileEl = h('div', { class: 'small muted pp-chap-file' }, fname(c, i))
        const check = h('input', { type: 'checkbox', checked: st.on, 'aria-label': `Include chapter ${i + 1}`, onchange: (e) => { st.on = e.target.checked; row.dataset.state = st.on ? 'on' : 'off'; sync() } })
        const row = h('div', { class: 'pp-chap pp-in', 'data-state': st.on ? 'on' : 'off', style: { '--i': Math.min(i, 16), '--d': c.depth - 1 } },
          check, thumb,
          h('div', { class: 'pp-chap-body' }, nameEl, fileEl),
          h('div', { class: 'pp-chap-range' }, h('strong', pagesN === 1 ? `Page ${c.start + 1}` : `Pages ${c.start + 1}-${c.end + 1}`), h('span', { class: 'small muted' }, `${pagesN} ${pagesN === 1 ? 'page' : 'pages'}`)))
        return row
      }))
      sync()
    }
    function sync() {
      const n = chosen().length
      go.disabled = n === 0
      go.querySelector('span').textContent = n === 1 ? 'Save 1 file' : `Save ${n} files (ZIP)`
    }

    go.addEventListener('click', () => busy(go, async () => {
      clear(result)
      const list2 = chosen()
      const doc = await s.edit()
      const files = []
      for (let i = 0; i < list2.length; i++) {
        const c = list2[i]
        const { PDFDocument } = await pdfLib()
        const out = await PDFDocument.create()
        const idx = Array.from({ length: c.end - c.start + 1 }, (_, k) => c.start + k)
        const pages = await out.copyPages(doc, idx)
        pages.forEach((p) => out.addPage(p))
        out.setTitle(sel.get(c.start)?.name || c.title)
        files.push({ name: fname(c, chapters.indexOf(c)), data: await savePdf(out) })
        prog.set((i + 1) / list2.length, `Chapter ${i + 1} of ${list2.length}`)
        await yieldToMain()
      }
      const out = files.length === 1 ? files[0] : { name: `${baseName(s.name)}-chapters.zip`, data: await zip(files) }
      clear(result, doneCard({
        title: files.length === 1 ? '1 chapter saved' : `${files.length} chapters ready`, detail: `${formatBytes(out.data.size)}${files.length > 1 ? ' ZIP' : ''}.`,
        actions: [downloadButton(out.data, out.name, files.length === 1 ? 'Download PDF' : 'Download ZIP', { size: 'lg' })],
      }))
    }, { label: 'Splitting', errorTo: result, progress: prog }))

    const levelEl = depth > 1 ? field('Split at', segmented(Array.from({ length: Math.min(depth, 4) }, (_, i) => [i + 1, i === 0 ? 'Top level' : `Level ${i + 1}`]), 1, (v) => { o.level = +v; sel.clear(); compute() }, 'Bookmark level'), 'Deeper levels split chapters into smaller parts.') : null
    const frontEl = toggle('Keep pages before the first bookmark as "Front matter"', true, (c) => { o.front = c; compute() })
    clear(body, info, h('div', { class: 'panel' }, h('div', { class: 'stack' }, levelEl, frontEl)), list, h('div', { class: 'row' }, go), prog.el, result)
    compute()
  }

  useStyle('pp-style-chapters', CSS)
  root.append(ppRoot(src.el, body))
}

const CSS = `
.pp .pp-chaps { display: flex; flex-direction: column; gap: 10px; }
.pp .pp-chap { display: flex; align-items: center; gap: 14px; padding: 10px 14px 10px calc(14px + var(--d, 0) * 18px); border-radius: 16px; background: var(--surface); border: 1px solid var(--border); transition: opacity .2s, border-color .2s, transform .25s var(--spring); }
.pp .pp-chap:hover { transform: translateX(3px); border-color: var(--border-strong); }
.pp .pp-chap[data-state="off"] { opacity: .5; }
.pp .pp-chap-thumb { width: 52px; flex: none; }
.pp .pp-chap-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.pp .pp-chap-file { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pp .pp-chap-range { display: flex; flex-direction: column; align-items: flex-end; text-align: right; flex: none; }
@media (max-width: 560px) { .pp .pp-chap { flex-wrap: wrap; } .pp .pp-chap-range { align-items: flex-start; text-align: left; } .pp .pp-chap-body { flex-basis: 60%; } }
`
