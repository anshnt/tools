// Normalize page size: put every page on the same paper size (A4, Letter...), scaled to fit and centred, never stretched.
import { h, icon, button, busy, progress, alert, field, number, segmented, toggle, split, panel, stats, clear, downloadButton, formatBytes, yieldToMain } from '../../lib/ui.js'
import { suffixName } from '../../lib/files.js'
import { savePdf } from '../../lib/pdf.js'
import { pdfLib } from '../../lib/libs.js'
import { pdfSource, ppRoot, paperPicker, PAPERS, sheetView, doneCard, embedPages, drawEmbedded, fitInto, mm, pageGeom, round, toMm, identifyPaper, countUp } from './_shared.js'

/**
 * Decide where each page goes. sizes: displayed sizes [{w, h}] in points.
 * -> [{index, sheet: {w, h}, box: {x, y, w, h}, keep}] (box is where the displayed page lands on the sheet)
 */
export function plan(sizes, { paper, orient = 'auto', margin = 0, fit = 'fit', keep = true, upscale = true, tol = 1.5 }) {
  return sizes.map((sz, index) => {
    const landscape = orient === 'landscape' || (orient === 'auto' && sz.w > sz.h + 0.5)
    const sheet = landscape ? { w: paper.h, h: paper.w } : { w: paper.w, h: paper.h }
    const same = Math.abs(sz.w - sheet.w) <= tol && Math.abs(sz.h - sheet.h) <= tol
    const bx = margin, by = margin, bw = Math.max(10, sheet.w - 2 * margin), bh = Math.max(10, sheet.h - 2 * margin)
    let box
    if (fit === 'fill') {
      const k = Math.max(bw / sz.w, bh / sz.h)
      const w = sz.w * k, hh = sz.h * k
      box = { x: bx + (bw - w) / 2, y: by + (bh - hh) / 2, w, h: hh }
    } else box = fitInto(sz.w, sz.h, bx, by, bw, bh, { upscale })
    return { index, sheet, box, keep: keep && same && margin === 0, same, clip: fit === 'fill' ? { x: bx, y: by, w: bw, h: bh } : null }
  })
}

export function mount(root) {
  const body = h('div', { class: 'stack' })
  let s
  const state = { margin: 0, fit: 'fit', keep: true, upscale: true }

  const src = pdfSource({
    onLoad: async (source) => {
      s = source
      await s.pageSizes()
      build()
    },
    onClear: () => { s = null; clear(body) },
  })

  function build() {
    const sizes = Array.from({ length: s.pages }, (_, i) => s.sizeOf(i + 1))
    const dominant = (() => { const m = new Map(); for (const z of sizes) { const k = identifyPaper(z.w, z.h)?.name || 'A4'; m.set(k, (m.get(k) || 0) + 1) } return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] })()
    const paperEl = paperPicker({ value: PAPERS.includes(dominant) ? dominant : 'A4', orient: 'auto', onChange: refresh })
    const marginEl = number(0, { min: 0, max: 100, step: 1, onInput: (n) => { state.margin = Number.isFinite(n) ? Math.max(0, n) : 0; refresh() }, ariaLabel: 'Margin in millimetres' })
    const fitEl = segmented([['fit', 'Fit inside'], ['fill', 'Fill and crop']], 'fit', (v) => { state.fit = v; refresh() }, 'Fit mode')
    const keepEl = toggle('Keep pages that already match untouched (keeps links and form fields)', true, (c) => { state.keep = c; refresh() })
    const upEl = toggle('Enlarge small pages to fill the sheet', true, (c) => { state.upscale = c; refresh() })
    const preview = h('div', { class: 'stack' })
    const info = h('div')
    const prog = progress()
    const result = h('div')
    const go = button('Normalize pages', { icon: 'scaling', variant: 'primary', size: 'lg' })

    const current = () => {
      const p = paperEl.get()
      return plan(sizes, { paper: { w: p.w, h: p.h }, orient: p.orient, margin: mm(state.margin), fit: state.fit, keep: state.keep, upscale: state.upscale })
    }

    function refresh() {
      const items = current()
      const changed = items.filter((i) => !i.keep)
      const p = paperEl.get()
      const st = stats([
        { label: 'Pages', value: h('span', { 'data-n': s.pages }, '0') },
        { label: 'Will be resized', value: h('span', { 'data-n': changed.length }, '0'), accent: changed.length > 0 },
        { label: 'Already match', value: h('span', { 'data-n': items.length - changed.length }, '0') },
        { label: 'Target', value: p.name, hint: p.orient === 'auto' ? 'Each page keeps portrait or landscape' : p.orient === 'portrait' ? 'All portrait' : 'All landscape' },
      ])
      for (const el of st.querySelectorAll('[data-n]')) countUp(el, +el.dataset.n)
      clear(info, st)
      const shown = [...changed, ...items.filter((i) => i.keep)].slice(0, 8)
      clear(preview,
        h('div', { class: 'pp-section-title' }, icon('eye'), 'Preview (white is the new sheet)'),
        h('div', { class: 'pp-sheets' }, shown.map((it, i) => {
          const sz = sizes[it.index]
          const from = identifyPaper(sz.w, sz.h)?.name || `${round(toMm(sz.w), 0)} x ${round(toMm(sz.h), 0)} mm`
          const longest = Math.max(it.sheet.w, it.sheet.h)
          const wpx = Math.round(Math.min(150, 150 * (it.sheet.w / longest) * 1.15))
          const v = sheetView(s, { w: it.sheet.w, h: it.sheet.h, width: Math.max(80, wpx), items: [{ ...it.box, page: it.index + 1 }], title: `Page ${it.index + 1}: ${from}${it.keep ? ' (kept)' : ''}` })
          v.style.setProperty('--i', i)
          return v
        })),
        items.length > shown.length ? h('div', { class: 'pp-hint' }, `Showing ${shown.length} of ${items.length} pages.`) : null)
    }

    go.addEventListener('click', () => busy(go, async () => {
      clear(result)
      const items = current()
      const { PDFDocument, degrees, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = await pdfLib()
      const srcDoc = await s.edit()
      const out = await PDFDocument.create()
      const keepIdx = items.filter((i) => i.keep).map((i) => i.index)
      const copied = keepIdx.length ? new Map((await out.copyPages(srcDoc, keepIdx)).map((p, k) => [keepIdx[k], p])) : new Map()
      const need = items.filter((i) => !i.keep).map((i) => i.index)
      const emb = await embedPages(out, srcDoc, need)
      for (let k = 0; k < items.length; k++) {
        const it = items[k]
        if (it.keep) out.addPage(copied.get(it.index))
        else {
          const pg = out.addPage([it.sheet.w, it.sheet.h])
          const e = emb.get(it.index)
          if (it.clip) pg.pushOperators(pushGraphicsState(), rectangle(it.clip.x, it.clip.y, it.clip.w, it.clip.h), clip(), endPath())
          drawEmbedded(pg, degrees, e.emb, e.geom, it.box)
          if (it.clip) pg.pushOperators(popGraphicsState())
        }
        prog.set((k + 1) / items.length, `Page ${k + 1} of ${items.length}`)
        if (k % 8 === 0) await yieldToMain()
      }
      const title = srcDoc.getTitle()
      if (title) out.setTitle(title)
      prog.set(1, 'Saving')
      const blob = await savePdf(out)
      const p = paperEl.get()
      const resized = items.filter((i) => !i.keep).length
      clear(result, doneCard({
        title: `${items.length} pages on ${p.name}`,
        detail: `${resized} resized, ${items.length - resized} kept as they were. ${formatBytes(s.size)} to ${formatBytes(blob.size)}.`,
        actions: [downloadButton(blob, suffixName(s.name, p.name.toLowerCase()), 'Download PDF', { size: 'lg' })],
      }))
    }, { label: 'Working', errorTo: result, progress: prog }))

    const controls = panel(h('div', { class: 'stack' },
      paperEl,
      field('Margin (mm)', marginEl, 'Blank border around each page'),
      field('Scaling', fitEl, state.fit === 'fit' ? null : null),
      upEl, keepEl))
    clear(body, info, split(controls, panel(preview), 'wide-right'), h('div', { class: 'row' }, go, h('span', { class: 'pp-hint' }, 'Pages are scaled evenly, never stretched. Text stays sharp.')), prog.el, result)
    refresh()
  }

  root.append(ppRoot(src.el, body))
}
