// PDF booklet maker: saddle-stitch imposition. Pads to a multiple of 4, puts two pages on each landscape sheet side in the right order,
// optional creep compensation and fold line. Print double-sided (flip on short edge), fold, staple.
import { h, icon, button, busy, progress, field, number, segmented, select, toggle, split, panel, stats, clear, downloadButton, formatBytes } from '../../lib/ui.js'
import { suffixName } from '../../lib/files.js'
import { savePdf } from '../../lib/pdf.js'
import { PAGE_SIZES } from '../../lib/pdf.js'
import { pdfSource, ppRoot, sheetView, doneCard, imposeToPdf, fitInto, mm, countUp } from './_shared.js'

/**
 * Page order for a saddle-stitched booklet. n source pages -> {total, sheets: [{front: [left, right], back: [left, right]}]}
 * Entries are 1-based page numbers, or null for a blank page. blanks: 'end' | 'before-back'. rtl swaps left and right (right-bound books).
 */
export function bookletOrder(n, { blanks = 'end', rtl = false } = {}) {
  const total = Math.max(4, Math.ceil(n / 4) * 4)
  const seq = Array.from({ length: n }, (_, i) => i + 1)
  const pad = total - n
  if (pad) {
    if (blanks === 'before-back' && n > 1) seq.splice(n - 1, 0, ...Array(pad).fill(null))
    else seq.push(...Array(pad).fill(null))
  }
  const sheets = []
  for (let k = 0; k < total / 4; k++) {
    let front = [seq[total - 1 - 2 * k], seq[2 * k]]
    let back = [seq[2 * k + 1], seq[total - 2 - 2 * k]]
    if (rtl) { front = front.reverse(); back = back.reverse() }
    sheets.push({ front, back })
  }
  return { total, pad, sheets }
}

/** Sheet geometry: items for the two halves, with margins, gutter and creep (all in points). */
export function layoutSide(pair, sheet, sizes, { margin = 0, gutter = 0, creep = 0, sheetIndex = 0, fold = false }) {
  const half = sheet.w / 2
  const cellW = Math.max(10, half - margin - gutter), cellH = Math.max(10, sheet.h - 2 * margin)
  const shift = creep * sheetIndex // inner sheets move toward the spine
  const items = pair.map((p, side) => {
    const x0 = side === 0 ? margin : half + gutter
    const sz = p == null ? { w: cellW, h: cellH } : sizes[p - 1]
    const fit = fitInto(sz.w, sz.h, x0, margin, cellW, cellH)
    const dx = side === 0 ? shift : -shift
    return { page: p, x: fit.x + dx, y: fit.y, w: fit.w, h: fit.h }
  })
  return { w: sheet.w, h: sheet.h, items, lines: fold ? [{ x1: half, y1: 0, x2: half, y2: sheet.h }] : [] }
}

export function mount(root) {
  const body = h('div', { class: 'stack' })
  let s
  const src = pdfSource({ onLoad: async (source) => { s = source; await s.pageSizes(); build() }, onClear: () => { s = null; clear(body) } })

  function build() {
    const sizes = Array.from({ length: s.pages }, (_, i) => s.sizeOf(i + 1))
    const opt = { size: 'auto', blanks: 'end', rtl: false, margin: 0, gutter: 0, creep: 0, fold: false }
    const maxW = Math.max(...sizes.map((z) => z.w)), maxH = Math.max(...sizes.map((z) => z.h))
    const sheetSize = () => {
      if (opt.size === 'auto') return { w: maxW * 2, h: maxH }
      const [a, b] = PAGE_SIZES[opt.size]
      return { w: b, h: a }
    }
    const info = h('div')
    const preview = h('div', { class: 'stack' })
    const prog = progress()
    const result = h('div')
    const go = button('Make booklet', { icon: 'book-open', variant: 'primary', size: 'lg' })

    const sizeEl = select([['auto', 'Automatic (two pages side by side)'], ...Object.keys(PAGE_SIZES).map((k) => [k, `${k} landscape`])], 'auto', (v) => { opt.size = v; refresh() })
    const blanksEl = select([['end', 'At the end'], ['before-back', 'Before the back cover']], 'end', (v) => { opt.blanks = v; refresh() })
    const rtlEl = segmented([['ltr', 'Left edge'], ['rtl', 'Right edge']], 'ltr', (v) => { opt.rtl = v === 'rtl'; refresh() }, 'Binding side')
    const marginEl = number(0, { min: 0, max: 40, onInput: (n) => { opt.margin = Number.isFinite(n) ? n : 0; refresh() }, ariaLabel: 'Outer margin in mm' })
    const gutterEl = number(0, { min: 0, max: 40, onInput: (n) => { opt.gutter = Number.isFinite(n) ? n : 0; refresh() }, ariaLabel: 'Gutter in mm' })
    const creepEl = number(0, { min: 0, max: 2, step: 0.05, onInput: (n) => { opt.creep = Number.isFinite(n) ? n : 0; refresh() }, ariaLabel: 'Creep per sheet in mm' })
    const foldEl = toggle('Draw a faint fold line', false, (c) => { opt.fold = c; refresh() })

    const compute = () => {
      const order = bookletOrder(s.pages, { blanks: opt.blanks, rtl: opt.rtl })
      const sheet = sheetSize()
      const lay = (pair, k) => layoutSide(pair, sheet, sizes, { margin: mm(opt.margin), gutter: mm(opt.gutter), creep: mm(opt.creep), sheetIndex: k, fold: opt.fold })
      const sides = order.sheets.flatMap((sh, k) => [{ ...lay(sh.front, k), name: `Sheet ${k + 1} front` }, { ...lay(sh.back, k), name: `Sheet ${k + 1} back` }])
      return { order, sheet, sides }
    }

    function refresh() {
      const { order, sheet, sides } = compute()
      const st = stats([
        { label: 'Your pages', value: String(s.pages) },
        { label: 'Blank pages added', value: h('span', { 'data-n': order.pad }, '0'), hint: order.pad ? 'To fill the last sheet' : 'No padding needed' },
        { label: 'Sheets of paper', value: h('span', { 'data-n': order.total / 4 }, '0'), accent: true, hint: `${order.total / 2} printed sides` },
      ])
      for (const el of st.querySelectorAll('[data-n]')) countUp(el, +el.dataset.n, { ms: 450 })
      clear(info, st)
      const shown = sides.slice(0, 8)
      clear(preview,
        h('div', { class: 'pp-section-title' }, icon('eye'), 'Sheet order (first sheets)'),
        h('div', { class: 'pp-sheets' }, shown.map((sd, i) => {
          const v = sheetView(s, { w: sd.w, h: sd.h, items: sd.items, width: 200, title: sd.name })
          v.style.setProperty('--i', i)
          return v
        })),
        sides.length > shown.length ? h('div', { class: 'pp-hint' }, `Showing ${shown.length} of ${sides.length} sides. The finished PDF has all of them.`) : null,
        h('div', { class: 'pp-hint' }, `Print double-sided, flip on short edge. Fold the stack in half and staple along the fold. Sheet: ${Math.round(sheet.w / mm(1))} x ${Math.round(sheet.h / mm(1))} mm.`))
    }

    go.addEventListener('click', () => busy(go, async () => {
      clear(result)
      const { order, sides } = compute()
      const doc = await s.inspect()
      const out = await imposeToPdf(doc, sides, { onProgress: (f, t) => prog.set(f, t) })
      prog.set(1, 'Saving')
      const blob = await savePdf(out)
      clear(result, doneCard({
        title: `Booklet ready: ${order.total / 4} sheets, ${sides.length} sides`,
        detail: `${s.pages} pages${order.pad ? ` plus ${order.pad} blank` : ''}. Print double-sided with "flip on short edge", then fold. ${formatBytes(blob.size)}.`,
        actions: [downloadButton(blob, suffixName(s.name, 'booklet'), 'Download booklet PDF', { size: 'lg' })],
      }))
    }, { label: 'Imposing', errorTo: result, progress: prog }))

    const controls = panel(h('div', { class: 'stack' },
      field('Sheet size', sizeEl, 'Each page is scaled to fit its half'),
      field('Binding edge', rtlEl, 'Use right edge for right-to-left books'),
      field('Blank pages go', blanksEl, 'Added when pages are not a multiple of 4'),
      h('div', { class: 'grid-3' },
        field('Margin (mm)', marginEl), field('Gutter (mm)', gutterEl), field('Creep (mm)', creepEl)),
      h('div', { class: 'pp-hint' }, 'Creep nudges inner sheets toward the fold to offset paper thickness in thick booklets. About 0.1 mm per sheet for office paper.'),
      foldEl))
    clear(body, info, split(controls, panel(preview), 'wide-right'), h('div', { class: 'row' }, go), prog.el, result)
    refresh()
  }

  root.append(ppRoot(src.el, body))
}
