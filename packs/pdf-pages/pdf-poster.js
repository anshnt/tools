// PDF poster printer: scale one page up across a grid of sheets with overlap, crop marks and tile labels.
import { h, icon, alert, button, busy, progress, field, number, segmented, toggle, split, panel, stats, clear, downloadButton, formatBytes, yieldToMain } from '../../lib/ui.js'
import { suffixName } from '../../lib/files.js'
import { savePdf } from '../../lib/pdf.js'
import { pdfLib } from '../../lib/libs.js'
import { pdfSource, ppRoot, paperPicker, doneCard, embedPages, drawEmbedded, mm, toMm, round, countUp, useStyle, whenVisible } from './_shared.js'

const MAX_SHEETS = 150

/**
 * Work out the tiling. page: displayed size {w, h}; sheet: {w, h}; all lengths in points.
 * cols is fixed; rows is computed from the page shape unless given. Returns the poster size, scale, content offset and tiles.
 */
export function posterPlan({ page, sheet, margin, overlap, cols, rows = null }) {
  const pw = sheet.w - 2 * margin, ph = sheet.h - 2 * margin
  const step = (n, size) => n * size - (n - 1) * overlap
  const PW = step(cols, pw)
  let k, R
  if (rows == null) {
    k = PW / page.w
    R = Math.max(1, Math.ceil((page.h * k - overlap) / (ph - overlap) - 1e-9))
  } else {
    R = rows
    k = Math.min(PW / page.w, step(R, ph) / page.h)
  }
  const PH = step(R, ph)
  const cw = page.w * k, chh = page.h * k
  const ox = (PW - cw) / 2, oy = rows == null ? 0 : (PH - chh) / 2
  const tiles = []
  for (let r = 0; r < R; r++) for (let c = 0; c < cols; c++) tiles.push({ c, r, tx: c * (pw - overlap), ty: r * (ph - overlap) })
  return { cols, rows: R, pw, ph, PW, PH, k, ox, oy, cw, ch: chh, tiles, sheet, margin, overlap }
}

const colName = (c) => String.fromCharCode(65 + (c % 26)).repeat(1 + Math.floor(c / 26))

export function mount(root) {
  const body = h('div', { class: 'stack' })
  let s
  const src = pdfSource({ onLoad: async (source) => { s = source; await s.pageSizes(); build() }, onClear: () => { s = null; clear(body) } })

  function build() {
    const o = { page: 1, cols: 2, rows: null, overlap: 10, margin: 8, marks: true, labels: true }
    const info = h('div')
    const preview = h('div', { class: 'stack' })
    const prog = progress()
    const result = h('div')
    const go = button('Make poster PDF', { icon: 'grid-2x2', variant: 'primary', size: 'lg' })

    const pageEl = number(1, { min: 1, max: s.pages, step: 1, onInput: (n) => { o.page = Number.isFinite(n) ? Math.min(s.pages, Math.max(1, Math.round(n))) : 1; refresh() }, ariaLabel: 'Page to enlarge' })
    const paperEl = paperPicker({ value: 'A4', orient: 'auto', label: 'Print on', onChange: () => refresh() })
    const colsEl = number(2, { min: 1, max: 12, step: 1, onInput: (n) => { o.cols = Number.isFinite(n) ? Math.min(12, Math.max(1, Math.round(n))) : 2; refresh() }, ariaLabel: 'Sheets across' })
    const rowsEl = number(2, { min: 1, max: 12, step: 1, onInput: (n) => { o.rows = Number.isFinite(n) ? Math.min(12, Math.max(1, Math.round(n))) : 2; refresh() }, ariaLabel: 'Sheets down' })
    const rowsWrap = h('div', { hidden: true }, field('Sheets down', rowsEl))
    const autoRows = toggle('Work out the rows from the page shape', true, (c) => { rowsWrap.hidden = c; o.rows = c ? null : +rowsEl.value || 2; refresh() })
    const overlapEl = number(10, { min: 0, max: 40, onInput: (n) => { o.overlap = Number.isFinite(n) ? n : 0; refresh() }, ariaLabel: 'Overlap in mm' })
    const marginEl = number(8, { min: 0, max: 30, onInput: (n) => { o.margin = Number.isFinite(n) ? n : 0; refresh() }, ariaLabel: 'Margin in mm' })
    const marksEl = toggle('Crop marks at the corners', true, (c) => { o.marks = c; refresh() })
    const labelsEl = toggle('Label each sheet (A1, B1, ...)', true, (c) => { o.labels = c; refresh() })

    const compute = () => {
      const pg = s.sizeOf(o.page)
      const p = paperEl.get()
      const margin = mm(Math.max(o.margin, o.marks ? 6 : 0))
      const overlap = Math.min(mm(o.overlap), Math.min(p.w, p.h) / 3)
      const mk = (sheet) => posterPlan({ page: pg, sheet, margin, overlap, cols: o.cols, rows: o.rows })
      const portrait = mk({ w: p.w, h: p.h }), landscape = mk({ w: p.h, h: p.w })
      const plan = p.orient === 'portrait' ? portrait : p.orient === 'landscape' ? landscape
        : (landscape.tiles.length < portrait.tiles.length ? landscape : portrait)
      return { plan, paper: p, pg }
    }

    function refresh() {
      const { plan, paper } = compute()
      const n = plan.tiles.length
      const tooMany = n > MAX_SHEETS
      go.disabled = tooMany
      const scalePct = Math.round(plan.k * 100)
      const st = stats([
        { label: 'Sheets to print', value: h('span', { 'data-n': n }, '0'), accent: true, hint: `${plan.cols} across x ${plan.rows} down`, danger: tooMany },
        { label: 'Poster size', value: `${round(toMm(plan.cw) / 10, 0)} x ${round(toMm(plan.ch) / 10, 0)}`, hint: `cm, on ${paper.name}` },
        { label: 'Enlargement', value: `${scalePct}%`, hint: 'of the original page' },
      ])
      for (const el of st.querySelectorAll('[data-n]')) countUp(el, +el.dataset.n, { ms: 450 })
      clear(info, st, tooMany ? h('div', { style: 'margin-top:10px' }, alert('error', `That is ${n} sheets. The limit here is ${MAX_SHEETS}. Use fewer sheets across.`)) : null)
      // poster preview: page placed on the poster canvas with the tile grid on top
      const box = h('div', { class: 'pp-poster', style: { aspectRatio: `${plan.PW} / ${plan.PH}`, maxWidth: `${Math.min(460, 150 + 90 * plan.cols)}px` } })
      const pct = (v, total) => `${(v / total) * 100}%`
      const imgWrap = h('div', { class: 'pp-poster-page', style: { left: pct(plan.ox, plan.PW), top: pct(plan.oy, plan.PH), width: pct(plan.cw, plan.PW), height: pct(plan.ch, plan.PH) } })
      whenVisible(imgWrap, () => s.thumbURL(o.page, 700).then((u) => imgWrap.append(h('img', { src: u, alt: '' })), () => {}))
      box.append(imgWrap)
      plan.tiles.forEach((t, i) => {
        const tile = h('div', { class: 'pp-poster-tile', style: { left: pct(t.tx, plan.PW), top: pct(t.ty, plan.PH), width: pct(plan.pw, plan.PW), height: pct(plan.ph, plan.PH), '--i': Math.min(i, 30) } },
          h('span', `${colName(t.c)}${t.r + 1}`))
        box.append(tile)
      })
      clear(preview,
        h('div', { class: 'pp-section-title' }, icon('eye'), `Poster map (page ${o.page})`),
        box,
        h('div', { class: 'pp-hint' }, `Print all ${n} sheets at 100% (no "fit to page"), trim the margins, overlap by ${o.overlap} mm and glue along the shaded strips.`))
      const strips = (axis) => {
        for (let i = 1; i < (axis === 'x' ? plan.cols : plan.rows); i++) {
          const v = i * ((axis === 'x' ? plan.pw : plan.ph) - plan.overlap)
          box.append(h('div', { class: 'pp-poster-overlap', style: axis === 'x'
            ? { left: pct(v, plan.PW), width: pct(plan.overlap, plan.PW), top: 0, height: '100%' }
            : { top: pct(v, plan.PH), height: pct(plan.overlap, plan.PH), left: 0, width: '100%' } }))
        }
      }
      strips('x'); strips('y')
    }

    go.addEventListener('click', () => busy(go, async () => {
      clear(result)
      const { plan } = compute()
      const { PDFDocument, StandardFonts, rgb, degrees, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = await pdfLib()
      const srcDoc = await s.inspect()
      const out = await PDFDocument.create()
      const emb = await embedPages(out, srcDoc, [o.page - 1])
      const e = emb.get(o.page - 1)
      const font = await out.embedFont(StandardFonts.Helvetica)
      const { sheet, margin: m, pw, ph } = plan
      const markLen = Math.min(m * 0.8, mm(8))
      for (let i = 0; i < plan.tiles.length; i++) {
        const t = plan.tiles[i]
        const pg = out.addPage([sheet.w, sheet.h])
        const px = m, py = sheet.h - m - ph // printable area lower-left
        const box = { x: m + plan.ox - t.tx, y: sheet.h - (m + plan.oy - t.ty) - plan.ch, w: plan.cw, h: plan.ch }
        pg.pushOperators(pushGraphicsState(), rectangle(px, py, pw, ph), clip(), endPath())
        drawEmbedded(pg, degrees, e.emb, e.geom, box)
        pg.pushOperators(popGraphicsState())
        const grey = rgb(0.35, 0.35, 0.4)
        if (o.marks) {
          for (const [cx, cy, sx, sy] of [[px, py, -1, -1], [px + pw, py, 1, -1], [px, py + ph, -1, 1], [px + pw, py + ph, 1, 1]]) {
            pg.drawLine({ start: { x: cx + sx * 1.5, y: cy }, end: { x: cx + sx * (1.5 + markLen), y: cy }, thickness: 0.5, color: grey })
            pg.drawLine({ start: { x: cx, y: cy + sy * 1.5 }, end: { x: cx, y: cy + sy * (1.5 + markLen) }, thickness: 0.5, color: grey })
          }
        }
        if (o.labels) {
          const label = `${colName(t.c)}${t.r + 1}  (${plan.cols} x ${plan.rows})`
          const tw = font.widthOfTextAtSize(label, 7)
          pg.drawRectangle({ x: px + 3, y: py + ph - 14, width: tw + 6, height: 11, color: rgb(1, 1, 1), opacity: 0.85 })
          pg.drawText(label, { x: px + 6, y: py + ph - 11.5, size: 7, font, color: rgb(0.2, 0.2, 0.25) })
        }
        prog.set((i + 1) / plan.tiles.length, `Sheet ${i + 1} of ${plan.tiles.length}`)
        if (i % 4 === 0) await yieldToMain()
      }
      const blob = await savePdf(out)
      clear(result, doneCard({
        title: `Poster ready: ${plan.tiles.length} sheets (${plan.cols} x ${plan.rows})`,
        detail: `${round(toMm(plan.cw) / 10, 0)} x ${round(toMm(plan.ch) / 10, 0)} cm when assembled. ${formatBytes(blob.size)}.`,
        actions: [downloadButton(blob, suffixName(s.name, `poster-p${o.page}`), 'Download poster PDF', { size: 'lg' })],
      }))
    }, { label: 'Tiling', errorTo: result, progress: prog }))

    const controls = panel(h('div', { class: 'stack' },
      field('Page to enlarge', pageEl, s.pages > 1 ? `Page 1 to ${s.pages}` : null),
      paperEl,
      field('Sheets across', colsEl, 'The poster is this many sheets wide'),
      autoRows, rowsWrap,
      h('div', { class: 'grid-2' }, field('Overlap (mm)', overlapEl, 'For gluing'), field('Margin (mm)', marginEl, 'Unprintable edge')),
      marksEl, labelsEl))
    clear(body, info, split(controls, panel(preview), 'wide-right'), h('div', { class: 'row' }, go), prog.el, result)
    refresh()
  }

  useStyle('pp-style-poster', CSS)
  root.append(ppRoot(src.el, body))
}

const CSS = `
.pp .pp-poster { position: relative; width: 100%; margin: 0 auto; background: var(--pp-paper); box-shadow: var(--pp-shadow); border-radius: 3px; overflow: hidden; }
.pp .pp-poster-page { position: absolute; }
.pp .pp-poster-page img { width: 100%; height: 100%; display: block; object-fit: fill; }
.pp .pp-poster-tile { position: absolute; border: 1.5px dashed var(--accent); display: grid; place-items: center; animation: pp-pop .5s var(--ease) both; animation-delay: calc(var(--i, 0) * 25ms); background: color-mix(in srgb, var(--accent) 5%, transparent); }
.pp .pp-poster-tile span { font-weight: 700; font-size: clamp(14px, 4vw, 30px); color: var(--accent); background: color-mix(in srgb, #fff 82%, transparent); border-radius: 8px; padding: 0 8px; letter-spacing: -.02em; }
.pp .pp-poster-overlap { position: absolute; background: repeating-linear-gradient(45deg, color-mix(in srgb, var(--accent-2) 30%, transparent) 0 4px, transparent 4px 8px); pointer-events: none; }
`
