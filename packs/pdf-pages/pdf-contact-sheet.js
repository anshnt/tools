// PDF contact sheet: a thumbnail grid of every page as one PNG/JPG image or a one-page PDF (several sheets when there are many pages).
import { h, icon, button, busy, progress, field, input, number, segmented, select, toggle, split, panel, stats, clear, preview as previewBox, formatBytes, downloadButton, yieldToMain } from '../../lib/ui.js'
import { suffixName, zip, baseName } from '../../lib/files.js'
import { parseRanges, renderPage, savePdf } from '../../lib/pdf.js'
import { toBlob, MAX_PIXELS } from '../../lib/image.js'
import { pdfLib } from '../../lib/libs.js'
import { pdfSource, ppRoot, pageThumb, doneCard, countUp, useStyle } from './_shared.js'

const BACKGROUNDS = { white: ['#ffffff', '#1c1c24', '#6b6b78'], light: ['#eef0f5', '#1c1c24', '#6b6b78'], dark: ['#15151c', '#f2f2f7', '#9a9aa8'], transparent: [null, '#1c1c24', '#6b6b78'] }
const MAX_SIDE = 16000

/** Canvas geometry for `count` pages. -> {cols, rows, cellW, cellH, width, height} (pixels) */
export function sheetGeometry(count, { cols, thumbW, aspect, gap, pad, header }) {
  const c = Math.max(1, Math.min(cols, count))
  const rows = Math.ceil(count / c)
  const cellH = Math.round(thumbW * aspect)
  return { cols: c, rows, cellW: thumbW, cellH, width: pad * 2 + c * thumbW + (c - 1) * gap, height: pad * 2 + header + rows * cellH + (rows - 1) * gap }
}

export function mount(root) {
  const body = h('div', { class: 'stack' })
  let s
  const src = pdfSource({ onLoad: async (source) => { s = source; await s.pageSizes(); build() }, onClear: () => { s = null; clear(body) } })

  function build() {
    const n = s.pages
    const o = { cols: Math.min(6, Math.max(2, Math.round(Math.sqrt(n * 1.4)))), thumb: 220, gap: 16, labels: true, title: true, bg: 'white', range: '', per: 0, fmt: 'png', paper: 'fit' }
    const info = h('div')
    const grid = h('div', { class: 'pp-contact' })
    const prog = progress()
    const result = h('div')
    const go = button('Make contact sheet', { icon: 'layout-dashboard', variant: 'primary', size: 'lg' })

    const colsEl = number(o.cols, { min: 1, max: 20, step: 1, onInput: (v) => { o.cols = Number.isFinite(v) ? Math.min(20, Math.max(1, Math.round(v))) : o.cols; refresh() }, ariaLabel: 'Columns' })
    const thumbEl = select([[140, 'Small (140 px)'], [220, 'Medium (220 px)'], [320, 'Large (320 px)'], [480, 'Extra large (480 px)']], 220, (v) => { o.thumb = +v; refresh() })
    const bgEl = select([['white', 'White'], ['light', 'Light grey'], ['dark', 'Dark'], ['transparent', 'Transparent (PNG)']], 'white', (v) => { o.bg = v; refresh() })
    const rangeEl = input({ placeholder: 'All pages, or e.g. 1-8, 12', 'aria-label': 'Pages to include', oninput: (e) => { o.range = e.target.value; refresh() } })
    const perEl = select([[0, 'All on one sheet'], [12, '12 per sheet'], [24, '24 per sheet'], [48, '48 per sheet'], [100, '100 per sheet']], 0, (v) => { o.per = +v; refresh() })
    const fmtEl = segmented([['png', 'PNG'], ['jpg', 'JPG'], ['pdf', 'PDF']], 'png', (v) => { o.fmt = v; paperWrap.hidden = v !== 'pdf'; refresh() }, 'Output format')
    const paperEl = select([['fit', 'Same shape as the image'], ['a4', 'A4'], ['letter', 'Letter']], 'fit', (v) => { o.paper = v })
    const paperWrap = h('div', { hidden: true }, field('PDF paper', paperEl))
    const labelsEl = toggle('Page numbers', true, (c) => { o.labels = c; refresh() })
    const titleEl = toggle('File name header', true, (c) => { o.title = c; refresh() })

    const pagesList = () => {
      if (!o.range.trim()) return { pages: Array.from({ length: n }, (_, i) => i + 1) }
      try { return { pages: parseRanges(o.range, n) } } catch (e) { return { error: e.message, pages: [] } }
    }
    const aspectOf = (pages) => Math.min(2.6, Math.max(0.4, ...pages.map((p) => s.sizeOf(p).h / s.sizeOf(p).w)))
    const plan = () => {
      const { pages, error } = pagesList()
      if (error || !pages.length) return { error: error || 'No pages selected', pages }
      const aspect = aspectOf(pages)
      const header = o.title ? Math.round(o.thumb * 0.28) : 0
      const geom = (count) => sheetGeometry(count, { cols: o.cols, thumbW: o.thumb, aspect, gap: o.gap, pad: o.gap + 8, header })
      let per = o.per || pages.length
      // keep every sheet inside the canvas limits by splitting automatically
      while (per > 1) {
        const g = geom(per)
        if (g.width <= MAX_SIDE && g.height <= MAX_SIDE && g.width * g.height <= Math.min(MAX_PIXELS, 90_000_000)) break
        per = Math.max(1, Math.floor(per * 0.75))
      }
      const chunks = []
      for (let i = 0; i < pages.length; i += per) chunks.push(pages.slice(i, i + per))
      return { pages, chunks, geom, aspect, header, per }
    }

    function refresh() {
      const p = plan()
      const err = p.error
      go.disabled = !!err
      if (err) { clear(info, h('div', { class: 'pp-hint', style: 'color:var(--danger)' }, err)); clear(grid); return }
      const g = p.geom(p.chunks[0].length)
      const st = stats([
        { label: 'Pages', value: h('span', { 'data-n': p.pages.length }, '0') },
        { label: 'Sheets', value: h('span', { 'data-n': p.chunks.length }, '0'), accent: true, hint: p.chunks.length > 1 ? `${p.per} pages each` : 'One image' },
        { label: 'Image size', value: `${g.width} x ${g.height}`, hint: 'pixels' },
      ])
      for (const el of st.querySelectorAll('[data-n]')) countUp(el, +el.dataset.n, { ms: 400 })
      clear(info, st, p.chunks.length > 1 && o.per === 0 ? h('div', { class: 'pp-hint', style: 'margin-top:8px' }, 'That is more pages than fit on one image, so they are split into several sheets.') : null)
      const [bgc, fg, mut] = BACKGROUNDS[o.bg]
      grid.style.setProperty('--cols', Math.min(o.cols, p.chunks[0].length))
      grid.style.background = bgc || 'var(--checker)'
      grid.style.setProperty('--fg', fg); grid.style.setProperty('--mut', mut)
      const shown = p.chunks[0].slice(0, 60)
      clear(grid,
        o.title ? h('div', { class: 'pp-contact-title' }, h('strong', baseName(s.name)), h('span', `${n} pages`)) : null,
        h('div', { class: 'pp-contact-grid' }, shown.map((pg, i) => h('div', { class: 'pp-contact-cell', style: { aspectRatio: `1 / ${p.aspect}`, '--i': Math.min(i, 24) } },
          h('div', { class: 'pp-contact-page', style: { width: `${Math.min(100, (s.sizeOf(pg).w / s.sizeOf(pg).h) * p.aspect * 100)}%` } }, pageThumb(s, pg, { max: 240 })),
          o.labels ? h('span', { class: 'pp-contact-n' }, pg) : null))),
        p.chunks[0].length > shown.length ? h('div', { class: 'pp-hint', style: 'text-align:center;padding-top:8px' }, `Preview shows the first ${shown.length} pages of this sheet.`) : null)
    }

    async function drawSheet(pages, p, k) {
      const g = p.geom(pages.length)
      const c = document.createElement('canvas')
      c.width = g.width; c.height = g.height
      const ctx = c.getContext('2d')
      const [bgc, fg, mut] = BACKGROUNDS[o.bg]
      const fill = bgc || (o.fmt === 'png' ? null : '#ffffff')
      if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, 0, c.width, c.height) }
      const pad = o.gap + 8
      const fontPx = Math.max(11, Math.round(o.thumb * 0.07))
      if (o.title) {
        ctx.fillStyle = fg; ctx.font = `700 ${Math.round(o.thumb * 0.115)}px system-ui, sans-serif`; ctx.textBaseline = 'alphabetic'
        ctx.fillText(baseName(s.name).slice(0, 60), pad, pad + Math.round(o.thumb * 0.13))
        ctx.fillStyle = mut; ctx.font = `500 ${Math.round(o.thumb * 0.065)}px system-ui, sans-serif`
        ctx.fillText(`${n} pages${p.chunks.length > 1 ? `  -  sheet ${k + 1} of ${p.chunks.length}` : ''}`, pad, pad + Math.round(o.thumb * 0.23))
      }
      for (let i = 0; i < pages.length; i++) {
        const pg = pages[i]
        const sz = s.sizeOf(pg)
        const col = i % g.cols, row = Math.floor(i / g.cols)
        const cx = pad + col * (g.cellW + o.gap), cy = pad + p.header + row * (g.cellH + o.gap)
        const fit = Math.min(g.cellW / sz.w, g.cellH / sz.h)
        const w = Math.round(sz.w * fit), hh = Math.round(sz.h * fit)
        const pc = await s.queue(() => renderPage(s.doc, pg, { scale: fit }))
        const x = cx + Math.round((g.cellW - w) / 2), y = cy + Math.round((g.cellH - hh) / 2)
        ctx.save()
        ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = Math.round(o.thumb * 0.05); ctx.shadowOffsetY = Math.round(o.thumb * 0.012)
        ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, hh)
        ctx.restore()
        ctx.drawImage(pc, x, y, w, hh)
        pc.width = pc.height = 0
        if (o.labels) {
          const label = String(pg)
          ctx.font = `700 ${fontPx}px system-ui, sans-serif`
          const tw = ctx.measureText(label).width
          const bw = tw + fontPx * 0.9, bh = fontPx * 1.5
          ctx.fillStyle = 'rgba(15,15,25,.82)'
          ctx.beginPath(); ctx.roundRect(x + 6, y + hh - bh - 6, bw, bh, bh / 2); ctx.fill()
          ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'
          ctx.fillText(label, x + 6 + fontPx * 0.45, y + hh - bh / 2 - 6)
        }
        prog.set(((k + (i + 1) / pages.length) / p.chunks.length), `Sheet ${k + 1} of ${p.chunks.length}: page ${pg}`)
        if (i % 6 === 0) await yieldToMain()
      }
      return c
    }

    go.addEventListener('click', () => busy(go, async () => {
      clear(result)
      const p = plan()
      if (p.error) throw new Error(p.error)
      const files = []
      const sheets = []
      for (let k = 0; k < p.chunks.length; k++) {
        const c = await drawSheet(p.chunks[k], p, k)
        sheets.push(c)
      }
      const stem = baseName(s.name)
      let blob, name, previewSrc
      if (o.fmt === 'pdf') {
        const { PDFDocument } = await pdfLib()
        const out = await PDFDocument.create()
        for (const c of sheets) {
          const jpg = await out.embedJpg(await (await toBlob(c, 'image/jpeg', 0.92)).arrayBuffer())
          const ratio = c.width / c.height
          let pw = c.width * 0.75, ph = c.height * 0.75, ix = 0, iy = 0, iw = pw, ih = ph
          if (o.paper !== 'fit') {
            const [a, b] = o.paper === 'a4' ? [595.28, 841.89] : [612, 792]
            const land = ratio > 1
            pw = land ? b : a; ph = land ? a : b
            const m = 24, k = Math.min((pw - 2 * m) / c.width, (ph - 2 * m) / c.height)
            iw = c.width * k; ih = c.height * k; ix = (pw - iw) / 2; iy = (ph - ih) / 2
          }
          out.addPage([pw, ph]).drawImage(jpg, { x: ix, y: iy, width: iw, height: ih })
        }
        out.setTitle(`${stem} - contact sheet`)
        blob = await savePdf(out); name = suffixName(s.name, 'contact-sheet', 'pdf')
      } else {
        const type = o.fmt === 'png' ? 'image/png' : 'image/jpeg'
        for (let i = 0; i < sheets.length; i++) {
          const b = await toBlob(sheets[i], type, 0.92)
          files.push({ name: suffixName(s.name, sheets.length > 1 ? `contact-${i + 1}` : 'contact-sheet', o.fmt), data: b })
        }
        if (files.length === 1) { blob = files[0].data; name = files[0].name } else { blob = await zip(files); name = suffixName(s.name, 'contact-sheets', 'zip') }
      }
      const first = sheets[0]
      previewSrc = first
      const thumb = document.createElement('canvas')
      const k = Math.min(1, 900 / first.width)
      thumb.width = Math.round(first.width * k); thumb.height = Math.round(first.height * k)
      thumb.getContext('2d').drawImage(first, 0, 0, thumb.width, thumb.height)
      for (const c of sheets) c.width = c.height = 0
      clear(result,
        doneCard({ title: sheets.length > 1 ? `${sheets.length} contact sheets ready` : 'Contact sheet ready', detail: `${p.pages.length} pages, ${formatBytes(blob.size)}.`, actions: [downloadButton(blob, name, `Download ${name.split('.').pop().toUpperCase()}`, { size: 'lg' })] }),
        previewBox(thumb))
    }, { label: 'Rendering', errorTo: result, progress: prog }))

    const controls = panel(h('div', { class: 'stack' },
      field('Pages', rangeEl),
      h('div', { class: 'grid-2' }, field('Columns', colsEl), field('Thumbnail size', thumbEl)),
      field('Background', bgEl),
      field('Sheets', perEl),
      field('Save as', fmtEl), paperWrap,
      h('div', { class: 'stack tight' }, labelsEl, titleEl)))
    clear(body, info, split(controls, panel(grid), 'wide-right'), h('div', { class: 'row' }, go), prog.el, result)
    refresh()
  }

  useStyle('pp-style-contact', CSS)
  root.append(ppRoot(src.el, body))
}

const CSS = `
.pp .pp-contact { border-radius: 14px; padding: 14px; border: 1px solid var(--border); min-height: 120px; transition: background .3s; }
.pp .pp-contact-title { display: flex; flex-direction: column; margin-bottom: 12px; color: var(--fg, var(--text)); }
.pp .pp-contact-title span { font-size: 12.5px; color: var(--mut, var(--muted)); }
.pp .pp-contact-grid { display: grid; grid-template-columns: repeat(var(--cols, 4), minmax(0, 1fr)); gap: 10px; }
.pp .pp-contact-cell { position: relative; display: grid; place-items: center; animation: pp-pop .5s var(--spring) both; animation-delay: calc(var(--i, 0) * 25ms); }
.pp .pp-contact-page { max-width: 100%; max-height: 100%; }
.pp .pp-contact-n { position: absolute; left: 4px; bottom: 4px; min-width: 20px; height: 18px; padding: 0 6px; border-radius: 999px; background: rgba(15,15,25,.82); color: #fff; font-size: 10.5px; font-weight: 700; display: grid; place-items: center; font-variant-numeric: tabular-nums; }
`
