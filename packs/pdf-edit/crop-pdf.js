// Crop PDF: drag the crop box on a live page preview, type exact margins, or auto-trim the white space.
import { h, busy, progress, number, field, button, segmented, toggle, formatBytes, yieldToMain } from '../../lib/ui.js'
import { renderPage, savePdf } from '../../lib/pdf.js'
import { pdfWorkspace, dock, showResult, plural, outName, pageRange, pageGeom, css as addCss } from './_shared.js'
import { pageGrid } from './_pages.js'
import { createStage, pageNav, movable, clickAwayDeselect } from './_overlay.js'

const CSS = `
.pe-cropbox { box-shadow: 0 0 0 9999px rgba(8, 8, 18, .52) !important; outline: 2px solid #fff !important; outline-offset: 0 !important; }
.pe-cropbox .pe-fill { background-image: linear-gradient(rgba(255,255,255,.55) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.55) 1px, transparent 1px); background-size: 33.333% 33.333%; opacity: .6; }
.pe-cropbox .pe-hd::after { border-color: #fff; background: var(--accent); }
.pe-marg { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.pe-dims { font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
`
const UNITS = { mm: 72 / 25.4, in: 72, pt: 1 }

/** Bounding box of the non-white pixels of a canvas, as fractions {l, t, r, b} of the page that are blank on each side. */
export function blankMargins(canvas, threshold = 245) {
  const { width: w, height: hh } = canvas
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, hh).data
  let minX = w, minY = hh, maxX = -1, maxY = -1
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (d[i + 3] > 8 && (d[i] < threshold || d[i + 1] < threshold || d[i + 2] < threshold)) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
    }
  }
  if (maxX < 0) return null
  return { l: minX / w, t: minY / hh, r: (w - 1 - maxX) / w, b: (hh - 1 - maxY) / hh }
}

export function mount(root) {
  addCss('pe-crop', CSS)
  pdfWorkspace(root, {
    label: 'Drop a PDF to crop',
    onLoad(src, ws) {
      const total = src.numPages
      const result = h('div'), prog = progress()
      let unit = 'mm', page = 1, global = { t: 0, r: 0, b: 0, l: 0 }
      const perPage = new Map()
      let separate = false, syncing = false
      const stage = createStage({ pdf: src.pdf, maxWidth: 560 })
      clickAwayDeselect(stage)
      const nav = pageNav(total, (n) => go(n))
      const grid = pageGrid({ pdf: src.pdf, select: 'single', toolbar: false, size: 'sm', label: 'Pick a page to preview', onChange: (e) => { if (e.type === 'select') { const s = grid.selected()[0]; if (s && s.page !== page) go(s.page) } } })
      const dims = h('div', { class: 'pe-dims' })
      const inputs = {}
      const fieldFor = (k, label) => { inputs[k] = number(0, { min: 0, step: 0.5, ariaLabel: `${label} margin`, onInput: () => fromInputs() }); return field(label, inputs[k]) }
      const marg = h('div', { class: 'pe-marg' }, fieldFor('t', 'Top'), fieldFor('r', 'Right'), fieldFor('b', 'Bottom'), fieldFor('l', 'Left'))
      const units = segmented([['mm', 'mm'], ['in', 'inch'], ['pt', 'points']], 'mm', (u) => { unit = u; toInputs() }, 'Units')
      const sepToggle = toggle('Trim each page separately', false, (v) => { separate = v; perPage.clear(); if (v) perPage.set(page, { ...global }) })
      const range = pageRange(total, { label: 'Apply to', modes: ['all', 'odd', 'even', 'custom'], onChange: () => update() })
      const trim = button('Auto-trim white space', { icon: 'wand-sparkles', variant: 'secondary', onClick: () => busy(trim, autoTrim, { label: 'Scanning', progress: prog }) })
      const reset = button('Reset', { icon: 'undo-2', variant: 'ghost', size: 'sm', onClick: () => { global = { t: 0, r: 0, b: 0, l: 0 }; perPage.clear(); applyToBox(); toInputs() } })
      const btn = button('Crop PDF', { icon: 'crop', variant: 'primary', onClick: () => run() })
      const bar = dock({ actions: [btn] })

      const current = () => (separate ? perPage.get(page) : null) ?? global
      const box = movable(stage, { x: 0, y: 0, w: stage.pw, h: stage.ph, handles: 'all', min: 24, className: 'pe-cropbox', label: 'Crop box', onChange: () => fromBox() })
      box.el.classList.add('is-active')
      function applyToBox() {
        const m = current()
        syncing = true
        box.set({ x: m.l, y: m.t, w: Math.max(24, stage.pw - m.l - m.r), h: Math.max(24, stage.ph - m.t - m.b) })
        syncing = false
        toInputs()
      }
      function fromBox() {
        if (syncing) return
        const r = box.rect()
        const m = { l: r.x, t: r.y, r: stage.pw - r.x - r.w, b: stage.ph - r.y - r.h }
        if (separate) perPage.set(page, m); else global = m
        toInputs()
      }
      function toInputs() {
        const m = current(), k = UNITS[unit]
        for (const key of ['t', 'r', 'b', 'l']) inputs[key].value = +(m[key] / k).toFixed(unit === 'pt' ? 1 : 2)
        const w = stage.pw - m.l - m.r, hh = stage.ph - m.t - m.b
        dims.textContent = `Page ${page}: ${(stage.pw / UNITS.mm).toFixed(0)} x ${(stage.ph / UNITS.mm).toFixed(0)} mm becomes ${(w / UNITS.mm).toFixed(0)} x ${(hh / UNITS.mm).toFixed(0)} mm`
        update()
      }
      function fromInputs() {
        const k = UNITS[unit]
        const m = {}
        for (const key of ['t', 'r', 'b', 'l']) { const v = inputs[key].valueAsNumber; m[key] = Number.isFinite(v) ? Math.max(0, v * k) : 0 }
        if (m.l + m.r > stage.pw - 24) m.r = Math.max(0, stage.pw - 24 - m.l)
        if (m.t + m.b > stage.ph - 24) m.b = Math.max(0, stage.ph - 24 - m.t)
        if (separate) perPage.set(page, m); else global = m
        syncing = true
        box.set({ x: m.l, y: m.t, w: stage.pw - m.l - m.r, h: stage.ph - m.t - m.b })
        syncing = false
        dims.textContent = `Page ${page}: ${(stage.pw / UNITS.mm).toFixed(0)} x ${(stage.ph / UNITS.mm).toFixed(0)} mm becomes ${((stage.pw - m.l - m.r) / UNITS.mm).toFixed(0)} x ${((stage.ph - m.t - m.b) / UNITS.mm).toFixed(0)} mm`
        update()
      }
      async function go(n) {
        page = n
        nav.set(n)
        await stage.show(n)
        applyToBox()
        grid.select(grid.items.filter((x) => x.page === n))
      }

      async function autoTrim() {
        const pages = (() => { try { return range.pages() } catch { return Array.from({ length: total }, (_, i) => i + 1) } })()
        const found = new Map()
        for (let i = 0; i < pages.length; i++) {
          prog.set(i / pages.length, `Looking at page ${pages[i]}`)
          const c = await renderPage(src.pdf, pages[i], { scale: 0.5 })
          const f = blankMargins(c)
          c.width = c.height = 0
          if (f) { const pg = await src.pdf.getPage(pages[i]); const vp = pg.getViewport({ scale: 1 }); found.set(pages[i], { l: f.l * vp.width, r: f.r * vp.width, t: f.t * vp.height, b: f.b * vp.height }) }
          await yieldToMain()
        }
        if (!found.size) throw new Error('These pages look empty, so there is nothing to trim.')
        const pad = 6
        const shrink = (m) => ({ l: Math.max(0, m.l - pad), r: Math.max(0, m.r - pad), t: Math.max(0, m.t - pad), b: Math.max(0, m.b - pad) })
        if (separate) { perPage.clear(); for (const [p, m] of found) perPage.set(p, shrink(m)) }
        else {
          const all = [...found.values()]
          global = shrink({ l: Math.min(...all.map((m) => m.l)), r: Math.min(...all.map((m) => m.r)), t: Math.min(...all.map((m) => m.t)), b: Math.min(...all.map((m) => m.b)) })
        }
        applyToBox()
      }

      function update() {
        const err = range.error()
        const m = current()
        const trimmed = m.l + m.r + m.t + m.b > 0.5 || (separate && perPage.size)
        btn.disabled = !!err || !trimmed
        let n = 0
        try { n = range.pages().length } catch { /* shown by the range control */ }
        bar.text(err ? err : trimmed ? h('span', 'Cropping ', h('b', plural(n, 'page')), separate ? ' with their own boxes.' : ' with the same margins.') : 'Drag the crop box, type margins, or use Auto-trim.')
      }

      async function run() {
        const targets = range.pages()
        await busy(btn, async () => {
          prog.set(null, 'Cropping')
          const doc = await src.edit()
          const pages = doc.getPages()
          for (const p of targets) {
            const m = (separate ? perPage.get(p) : null) ?? global
            const pg = pages[p - 1]
            const g = pageGeom(pg)
            const a = g.toPdf(m.l, m.t), b = g.toPdf(g.width - m.r, g.height - m.b)
            const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), w = Math.abs(a[0] - b[0]), hh = Math.abs(a[1] - b[1])
            if (w < 10 || hh < 10) throw new Error(`Page ${p} would be cropped to almost nothing. Use smaller margins.`)
            pg.setCropBox(x, y, w, hh)
            pg.setMediaBox(x, y, w, hh)
          }
          const blob = await savePdf(doc)
          await showResult(result, {
            blob, name: outName(src.file, 'cropped'), title: `${plural(targets.length, 'page')} cropped`, lead: 'Page sizes are updated, text stays selectable.',
            facts: [{ label: 'Pages cropped', value: targets.length }, { label: 'File size', value: formatBytes(blob.size) }],
            note: 'Content outside the box is hidden, not erased. Use Redact PDF if something must be gone for good.', again: ws.reset,
          })
        }, { label: 'Cropping', errorTo: result, progress: prog })
      }

      stage.show(1).then(() => { applyToBox(); update() })
      const left = h('div', { class: 'stack', style: 'align-items:center' }, h('div', { class: 'row', style: 'justify-content:center' }, nav), stage.el, dims)
      const panel = h('section', { class: 'panel stack' }, h('h2', 'Crop box'), marg, units, h('div', { class: 'row' }, trim, reset), sepToggle, range)
      return [h('div', { class: 'tool-split wide-left' }, left, panel), h('div', { class: 'pe-sub-h' }, 'Pick a page to preview'), grid.el, prog.el, result, bar]
    },
  })
}
