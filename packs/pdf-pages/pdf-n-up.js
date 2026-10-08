// N-up: put 2, 4, 6, 8, 9, 12 or 16 pages on each sheet, with reading order, margins, gaps and borders.
import { h, icon, button, busy, progress, field, number, segmented, select, toggle, split, panel, stats, clear, downloadButton, formatBytes } from '../../lib/ui.js'
import { suffixName } from '../../lib/files.js'
import { savePdf } from '../../lib/pdf.js'
import { pdfSource, ppRoot, paperPicker, sheetView, doneCard, imposeToPdf, fitInto, mm, countUp } from './_shared.js'

const GRIDS = { 2: [[1, 2], [2, 1]], 4: [[2, 2]], 6: [[2, 3], [3, 2]], 8: [[2, 4], [4, 2]], 9: [[3, 3]], 12: [[3, 4], [4, 3]], 16: [[4, 4]] }

/**
 * Choose columns x rows and sheet orientation for n pages per sheet so pages end up as large as possible.
 * paper: {w, h} portrait points; orient: 'auto' | 'portrait' | 'landscape'; page: {w, h} typical page size.
 */
export function bestGrid(n, paper, orient, page, margin = 0, gap = 0) {
  const orients = orient === 'auto' ? ['portrait', 'landscape'] : [orient]
  let best = null
  for (const o of orients) {
    const sw = o === 'landscape' ? paper.h : paper.w, sh = o === 'landscape' ? paper.w : paper.h
    for (const [cols, rows] of GRIDS[n]) {
      const cw = (sw - 2 * margin - (cols - 1) * gap) / cols, ch = (sh - 2 * margin - (rows - 1) * gap) / rows
      const scale = Math.min(cw / page.w, ch / page.h)
      if (!best || scale > best.scale + 1e-9) best = { cols, rows, sw, sh, scale, orient: o }
    }
  }
  return best
}

/** Items for one sheet. pages: 1-based page numbers (or null) in reading order; order: 'row' | 'column'. */
export function layoutSheet(pages, grid, sizes, { margin = 0, gap = 0, order = 'row', border = false }) {
  const { cols, rows, sw, sh } = grid
  const cw = (sw - 2 * margin - (cols - 1) * gap) / cols, ch = (sh - 2 * margin - (rows - 1) * gap) / rows
  const items = []
  pages.forEach((p, i) => {
    if (p == null) return
    const c = order === 'row' ? i % cols : Math.floor(i / rows)
    const r = order === 'row' ? Math.floor(i / cols) : i % rows
    const x0 = margin + c * (cw + gap)
    const yTop = margin + r * (ch + gap)
    const sz = sizes[p - 1]
    const fit = fitInto(sz.w, sz.h, x0, sh - yTop - ch, cw, ch)
    items.push({ page: p, x: fit.x, y: fit.y, w: fit.w, h: fit.h, border })
  })
  return { w: sw, h: sh, items, lines: [] }
}

export function mount(root) {
  const body = h('div', { class: 'stack' })
  let s
  const src = pdfSource({ onLoad: async (source) => { s = source; await s.pageSizes(); build() }, onClear: () => { s = null; clear(body) } })

  function build() {
    const sizes = Array.from({ length: s.pages }, (_, i) => s.sizeOf(i + 1))
    const o = { n: 4, order: 'row', margin: 8, gap: 4, border: true }
    const info = h('div')
    const preview = h('div', { class: 'stack' })
    const prog = progress()
    const result = h('div')
    const go = button('Make N-up PDF', { icon: 'columns-2', variant: 'primary', size: 'lg' })

    const perEl = select([[2, '2 per sheet'], [4, '4 per sheet'], [6, '6 per sheet'], [8, '8 per sheet'], [9, '9 per sheet'], [12, '12 per sheet'], [16, '16 per sheet']], 4, (v) => { o.n = +v; refresh() })
    const paperEl = paperPicker({ value: 'A4', orient: 'auto', onChange: () => refresh() })
    const orderEl = segmented([['row', 'Across, then down'], ['column', 'Down, then across']], 'row', (v) => { o.order = v; refresh() }, 'Page order')
    const marginEl = number(8, { min: 0, max: 40, onInput: (n) => { o.margin = Number.isFinite(n) ? n : 0; refresh() }, ariaLabel: 'Margin in mm' })
    const gapEl = number(4, { min: 0, max: 40, onInput: (n) => { o.gap = Number.isFinite(n) ? n : 0; refresh() }, ariaLabel: 'Gap in mm' })
    const borderEl = toggle('Draw a thin border around each page', true, (c) => { o.border = c; refresh() })

    const compute = () => {
      const p = paperEl.get()
      const first = sizes[0]
      const grid = bestGrid(o.n, { w: p.w, h: p.h }, p.orient, first, mm(o.margin), mm(o.gap))
      const sheets = []
      for (let i = 0; i < s.pages; i += o.n) {
        const pages = Array.from({ length: o.n }, (_, k) => (i + k < s.pages ? i + k + 1 : null))
        sheets.push(layoutSheet(pages, grid, sizes, { margin: mm(o.margin), gap: mm(o.gap), order: o.order, border: o.border }))
      }
      return { grid, sheets, paper: p }
    }

    function refresh() {
      const { grid, sheets, paper } = compute()
      const saved = Math.max(0, Math.round((1 - sheets.length / s.pages) * 100))
      const st = stats([
        { label: 'Pages in', value: String(s.pages) },
        { label: 'Sheets out', value: h('span', { 'data-n': sheets.length }, '0'), accent: true, hint: `${grid.cols} x ${grid.rows} grid, ${grid.orient}` },
        { label: 'Paper saved', value: h('span', { 'data-n': saved, 'data-pct': 1 }, '0'), hint: `On ${paper.name} paper` },
      ])
      for (const el of st.querySelectorAll('[data-n]')) countUp(el, +el.dataset.n, { ms: 450, format: (n) => (el.dataset.pct ? `${Math.round(n)}%` : Math.round(n).toString()) })
      clear(info, st)
      const shown = sheets.slice(0, 4)
      const longest = Math.max(grid.sw, grid.sh)
      const width = Math.round(170 * (grid.sw / longest) * 1.25)
      clear(preview,
        h('div', { class: 'pp-section-title' }, icon('eye'), 'Sheets'),
        h('div', { class: 'pp-sheets' }, shown.map((sh, i) => {
          const v = sheetView(s, { w: sh.w, h: sh.h, items: sh.items, width, title: `Sheet ${i + 1}` })
          v.style.setProperty('--i', i)
          return v
        })),
        sheets.length > shown.length ? h('div', { class: 'pp-hint' }, `Showing ${shown.length} of ${sheets.length} sheets.`) : null)
    }

    go.addEventListener('click', () => busy(go, async () => {
      clear(result)
      const { sheets, grid } = compute()
      const doc = await s.inspect()
      const out = await imposeToPdf(doc, sheets, { onProgress: (f, t) => prog.set(f, t) })
      prog.set(1, 'Saving')
      const blob = await savePdf(out)
      clear(result, doneCard({
        title: `${s.pages} pages on ${sheets.length} sheets`, detail: `${o.n} per sheet (${grid.cols} x ${grid.rows}). ${formatBytes(blob.size)}.`,
        actions: [downloadButton(blob, suffixName(s.name, `${o.n}-up`), 'Download PDF', { size: 'lg' })],
      }))
    }, { label: 'Arranging', errorTo: result, progress: prog }))

    const controls = panel(h('div', { class: 'stack' },
      field('Pages per sheet', perEl),
      paperEl,
      field('Reading order', orderEl),
      h('div', { class: 'grid-2' }, field('Margin (mm)', marginEl), field('Gap (mm)', gapEl)),
      borderEl))
    clear(body, info, split(controls, panel(preview), 'wide-right'), h('div', { class: 'row' }, go), prog.el, result)
    refresh()
  }

  root.append(ppRoot(src.el, body))
}
