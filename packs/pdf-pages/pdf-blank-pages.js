// Blank page remover: renders small thumbnails, measures how much of each page is non-white, flags blank or nearly blank pages
// with an adjustable sensitivity, lets you override any page, and saves the PDF without them.
import { h, icon, button, busy, progress, field, rangeField, toggle, stats, empty, clear, formatBytes, downloadButton } from '../../lib/ui.js'
import { suffixName } from '../../lib/files.js'
import { savePdf } from '../../lib/pdf.js'
import { pdfSource, ppRoot, scanAll, doneCard, useStyle, countUp, compressRanges } from './_shared.js'

/**
 * Share of pixels that are clearly darker than the page background. data: RGBA bytes, w x h, edge: fraction of each side to ignore.
 * -> {ratio, bg}. A dark page (background luminance below 150) counts as fully inked.
 */
export function inkRatio(data, w, h, edge = 0.03) {
  const x0 = Math.floor(w * edge), x1 = Math.ceil(w * (1 - edge)), y0 = Math.floor(h * edge), y1 = Math.ceil(h * (1 - edge))
  const hist = new Uint32Array(256)
  const lum = new Uint8Array((x1 - x0) * (y1 - y0))
  let k = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * w + x) * 4
      const l = (data[o] * 54 + data[o + 1] * 183 + data[o + 2] * 19) >> 8
      lum[k++] = l; hist[l]++
    }
  }
  let bg = 255, best = -1
  for (let i = 0; i < 256; i++) if (hist[i] > best) { best = hist[i]; bg = i }
  if (bg < 150) return { ratio: 1, bg }
  const cut = bg - 40
  let ink = 0
  for (let i = 0; i < lum.length; i++) if (lum[i] < cut) ink++
  return { ratio: ink / Math.max(1, lum.length), bg }
}

/** Slider position 0..100 -> ink cutoff (fraction). 0 = only truly empty, 100 = up to 5% of the page. */
export const cutoffFor = (t) => 0.00005 * 10 ** ((t / 100) * 3)

const pctText = (r) => (r === 0 ? '0%' : r < 0.0001 ? '<0.01%' : `${(r * 100).toFixed(r < 0.01 ? 2 : 1)}%`)

export function mount(root, { signal }) {
  const body = h('div', { class: 'stack' })
  let s
  let gen = 0
  const src = pdfSource({ onLoad: (source) => { s = source; return scan(source) }, onClear: () => { s = null; gen++; clear(body) } })

  async function scan(source) {
    const my = ++gen
    const alive = () => my === gen && !source.dead && !signal.aborted
    const prog = progress()
    clear(body, h('div', { class: 'row' }, h('span', { class: 'spinner' }), h('strong', 'Measuring every page...')), prog.el)
    const res = await scanAll(source, {
      max: 220, alive, onProgress: (f, t) => prog.set(f, t),
      fn: (c) => { const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height); return { ...inkRatio(d.data, c.width, c.height, 0.03), w: c.width, h: c.height } },
    })
    if (!alive()) return
    show(res.map((r) => ({ page: r.page, url: r.url, ...r.result })), source)
  }

  function show(pages, source) {
    const o = { t: 40, edge: 3, only: false }
    const manual = new Map() // page -> true (force remove) | false (force keep)
    // ratios depend on the edge setting, so keep the raw image data sizes only; recompute from stored ratios for the default edge
    const info = h('div')
    const grid = h('div', { class: 'pp-grid pp-blank-grid', style: '--min:120px' })
    const prog = progress()
    const result = h('div')
    const go = button('Remove blank pages', { icon: 'file-minus', variant: 'primary', size: 'lg' })
    const cards = new Map()

    const flagged = (p) => (manual.has(p.page) ? manual.get(p.page) : p.ratio <= cutoffFor(o.t))
    const removeList = () => pages.filter(flagged).map((p) => p.page)

    pages.forEach((p, i) => {
      const card = h('div', { class: 'pp-card pp-in', role: 'button', tabindex: 0, style: { '--i': Math.min(i, 30) }, 'aria-label': `Page ${p.page}` },
        h('div', { class: 'pp-paper', style: { aspectRatio: `${p.w} / ${p.h}` } }, h('img', { src: p.url, alt: '', draggable: false })),
        h('span', { class: 'pp-num' }, p.page), h('span', { class: 'pp-tick' }, icon('x')),
        h('div', { class: 'pp-foot' }, h('span', { 'data-role': 'verdict' }), h('span', { title: 'Share of the page that is not white' }, `${pctText(p.ratio)} ink`)))
      const flip = () => { manual.set(p.page, !flagged(p)); paint() }
      card.addEventListener('click', flip)
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip() } })
      cards.set(p.page, card)
      grid.append(card)
    })

    function paint() {
      const rm = removeList()
      for (const p of pages) {
        const card = cards.get(p.page)
        const f = flagged(p)
        card.dataset.state = f ? 'bad' : ''
        card.querySelector('[data-role=verdict]').textContent = f ? (manual.has(p.page) ? 'Remove (you)' : 'Blank') : (manual.has(p.page) ? 'Keep (you)' : '')
        card.hidden = o.only && !f
        card.setAttribute('aria-pressed', String(f))
      }
      const st = stats([
        { label: 'Pages', value: String(pages.length) },
        { label: 'Blank found', value: h('span', { 'data-n': rm.length }, '0'), danger: rm.length > 0 && rm.length === pages.length, accent: rm.length > 0 && rm.length < pages.length, hint: rm.length ? compressRanges(rm).slice(0, 40) : 'None at this setting' },
        { label: 'Will remain', value: String(pages.length - rm.length) },
      ])
      for (const el of st.querySelectorAll('[data-n]')) { if (!paint.done) countUp(el, +el.dataset.n, { ms: 450 }); else el.textContent = el.dataset.n }
      paint.done = true
      clear(info, st)
      go.disabled = rm.length === 0 || rm.length === pages.length
      go.querySelector('span').textContent = rm.length ? `Remove ${rm.length} ${rm.length === 1 ? 'page' : 'pages'}` : 'Remove blank pages'
    }

    const sens = rangeField('Sensitivity', { min: 0, max: 100, step: 1, value: o.t, format: (v) => (v < 20 ? 'Strict' : v < 55 ? 'Balanced' : v < 80 ? 'Lenient' : 'Very lenient'), onInput: (v) => { o.t = v; paint() }, hint: 'Strict removes only pages with nothing on them. Lenient also removes pages with a stray speck, a page number or scanner noise.' })
    const onlyEl = toggle('Show only the pages that will be removed', false, (c) => { o.only = c; paint() })

    go.addEventListener('click', () => busy(go, async () => {
      clear(result)
      const rm = removeList()
      const doc = await s.edit()
      for (const p of [...rm].sort((a, b) => b - a)) doc.removePage(p - 1)
      const blob = await savePdf(doc)
      clear(result, doneCard({
        title: `${rm.length} blank ${rm.length === 1 ? 'page' : 'pages'} removed`, detail: `${source.pages} pages down to ${doc.getPageCount()}. ${formatBytes(source.size)} to ${formatBytes(blob.size)}.`,
        actions: [downloadButton(blob, suffixName(s.name, 'no-blanks'), 'Download PDF', { size: 'lg' })],
      }))
    }, { label: 'Removing', errorTo: result, progress: prog }))

    clear(body, info, h('div', { class: 'panel' }, h('div', { class: 'stack' }, sens, onlyEl)),
      h('div', { class: 'pp-hint' }, 'Click any page to override the verdict. Red pages will be removed.'), grid,
      h('div', { class: 'row' }, go), prog.el, result)
    paint()
  }

  useStyle('pp-style-blank', CSS)
  root.append(ppRoot(src.el, body))
}

const CSS = `
.pp .pp-blank-grid .pp-card[data-state="bad"] .pp-paper img { opacity: .55; }
.pp .pp-blank-grid .pp-card[data-state="bad"] .pp-foot [data-role=verdict] { color: var(--danger); font-weight: 600; }
`
