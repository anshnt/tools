// PDF orientation fixer: rotate landscape pages to portrait (or the reverse), with a live animated preview. Rotation is lossless (/Rotate only).
import { h, icon, button, busy, progress, field, segmented, panel, stats, clear, downloadButton, formatBytes, yieldToMain } from '../../lib/ui.js'
import { suffixName } from '../../lib/files.js'
import { savePdf } from '../../lib/pdf.js'
import { pdfLib } from '../../lib/libs.js'
import { pdfSource, ppRoot, doneCard, whenVisible, useStyle, countUp, compressRanges } from './_shared.js'

/**
 * Clockwise quarter turns that make the text upright, from pdf.js text items and the page /Rotate. null if unsure.
 * 1 = text reads upward (turn right), 3 = text reads downward (turn left), 2 = upside down, 0 = already upright.
 */
export function textTurn(items, rot = 0) {
  const w = [0, 0, 0, 0] // displayed reading direction in quarter turns CCW from "left to right"
  for (const it of items) {
    if (!it.str || !it.str.trim() || !it.transform) continue
    const ang = (Math.atan2(it.transform[1], it.transform[0]) * 180) / Math.PI - rot
    const q = ((Math.round(ang / 90) % 4) + 4) % 4
    w[q] += it.str.trim().length
  }
  const total = w[0] + w[1] + w[2] + w[3]
  if (total < 3) return null
  const best = [0, 1, 2, 3].sort((a, b) => w[b] - w[a])[0]
  if (w[best] < total * 0.6) return null
  return best
}

export function mount(root) {
  const body = h('div', { class: 'stack' })
  let s
  const src = pdfSource({ onLoad: async (source) => { s = source; await s.pageSizes(); build() }, onClear: () => { s = null; clear(body) } })

  function build() {
    const n = s.pages
    const sizes = Array.from({ length: n }, (_, i) => s.sizeOf(i + 1))
    const isLand = sizes.map((z) => z.w > z.h + 0.5)
    const state = { target: 'portrait', dir: 'smart', over: new Map() }
    const dirs = new Map() // page index -> reading direction bucket (or null)
    let dirsReady = false
    const cards = []
    const grid = h('div', { class: 'pp-grid pp-orient-grid', style: '--min:150px; align-items:start' })
    const info = h('div')
    const prog = progress()
    const result = h('div')
    const go = button('Fix orientation', { icon: 'rectangle-vertical', variant: 'primary', size: 'lg' })

    const targetFor = () => (state.target === 'first' ? (isLand[0] ? 'landscape' : 'portrait') : state.target)
    const mismatch = (i) => (targetFor() === 'landscape') !== isLand[i] && Math.abs(sizes[i].w - sizes[i].h) > 0.5
    const willRotate = (i) => (state.over.has(i) ? state.over.get(i) : mismatch(i))
    // clockwise quarter turns for page i (1 or 3)
    const turns = (i) => {
      if (state.dir === 'cw') return 1
      if (state.dir === 'ccw') return 3
      const t = dirs.get(i)
      return t === 1 || t === 3 ? t : 1
    }

    async function readText() {
      if (dirsReady) return
      for (let i = 1; i <= n; i++) {
        const page = await s.doc.getPage(i)
        const tc = await page.getTextContent()
        dirs.set(i - 1, textTurn(tc.items, page.rotate))
        if (i % 10 === 0) { prog.set(i / n, `Reading text direction, page ${i} of ${n}`); await yieldToMain() }
      }
      dirsReady = true
      prog.hide()
    }

    function paint() {
      let count = 0
      cards.forEach((c, i) => {
        const on = willRotate(i)
        const q = on ? turns(i) : 0
        if (on) count++
        c.card.dataset.state = on ? 'on' : 'off'
        c.box.dataset.q = String(q)
        const z = sizes[i]
        c.box.style.aspectRatio = q % 2 === 1 ? `${z.h} / ${z.w}` : `${z.w} / ${z.h}`
        c.box.style.setProperty('--r', `${q === 3 ? -90 : q * 90}deg`)
        c.label.textContent = on ? (q === 1 ? 'Turns right' : 'Turns left') : (mismatch(i) ? 'You kept it' : 'Already fine')
        c.dir.replaceChildren(icon(on ? (q === 3 ? 'rotate-ccw' : 'rotate-cw') : 'check'))
        c.card.setAttribute('aria-pressed', String(on))
      })
      const land = isLand.filter(Boolean).length
      const pages = cards.map((_, i) => i).filter(willRotate).map((i) => i + 1)
      const st = stats([
        { label: 'Portrait now', value: String(n - land) },
        { label: 'Landscape now', value: String(land) },
        { label: 'Will rotate', value: h('span', { 'data-n': count }, '0'), accent: count > 0, hint: count ? `Pages ${compressRanges(pages).slice(0, 36)}` : 'Nothing to do' },
      ])
      for (const el of st.querySelectorAll('[data-n]')) countUp(el, +el.dataset.n, { ms: 450 })
      clear(info, st)
      go.disabled = count === 0
    }

    for (let i = 0; i < n; i++) {
      const box = h('div', { class: 'pp-rotbox', style: { aspectRatio: `${sizes[i].w} / ${sizes[i].h}` } })
      const label = h('span')
      const dir = h('span', { class: 'pp-dir' })
      const card = h('div', { class: 'pp-card pp-in', role: 'button', tabindex: 0, 'aria-label': `Page ${i + 1}`, style: { '--i': Math.min(i, 24) } },
        box, h('span', { class: 'pp-num' }, i + 1), h('span', { class: 'pp-tick' }, icon('rotate-cw')), h('div', { class: 'pp-foot' }, label, dir))
      const flip = () => { state.over.set(i, !willRotate(i)); paint() }
      card.addEventListener('click', flip)
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip() } })
      whenVisible(box, () => s.thumbURL(i + 1, 260).then((url) => box.append(h('img', { src: url, alt: '', draggable: false })), () => {}))
      cards.push({ card, box, label, dir })
      grid.append(card)
    }

    const targetEl = segmented([['portrait', 'All portrait'], ['landscape', 'All landscape'], ['first', 'Match page 1']], 'portrait', (v) => { state.target = v; state.over.clear(); paint() }, 'Target orientation')
    const dirEl = segmented([['smart', 'Smart (follow the text)'], ['cw', 'Clockwise'], ['ccw', 'Counter-clockwise']], 'smart', async (v) => {
      state.dir = v
      if (v === 'smart' && !dirsReady) await readText()
      paint()
    }, 'Rotation direction')

    go.addEventListener('click', () => busy(go, async () => {
      clear(result)
      const { degrees } = await pdfLib()
      if (state.dir === 'smart') await readText()
      const doc = await s.edit()
      let changed = 0
      for (let i = 0; i < n; i++) {
        if (!willRotate(i)) continue
        const page = doc.getPage(i)
        page.setRotation(degrees((page.getRotation().angle + 90 * turns(i)) % 360))
        changed++
      }
      const blob = await savePdf(doc)
      clear(result, doneCard({
        title: `${changed} ${changed === 1 ? 'page' : 'pages'} rotated`, detail: `Content is untouched, only the page rotation changed. ${formatBytes(blob.size)}.`,
        actions: [downloadButton(blob, suffixName(s.name, targetFor()), 'Download PDF', { size: 'lg' })],
      }))
    }, { label: 'Rotating', errorTo: result, progress: prog }))

    const controls = panel(h('div', { class: 'stack' },
      field('Make pages', targetEl),
      field('Rotate which way?', dirEl, 'Smart mode reads the text on each page so scans end up upright. Pages without text turn clockwise.')))
    clear(body, info, controls, h('div', { class: 'pp-hint' }, 'Click any page to turn it on or off.'), grid, h('div', { class: 'row' }, go), prog.el, result)
    paint()
    readText().then(paint).catch(() => {})
  }

  useStyle('pp-style-orient', CSS)
  root.append(ppRoot(src.el, body))
}

const CSS = `
.pp .pp-rotbox { position: relative; width: 100%; container-type: size; background: var(--pp-paper); border-radius: 5px; box-shadow: var(--pp-shadow); overflow: hidden; transition: aspect-ratio .6s var(--ease); }
.pp .pp-rotbox img { position: absolute; left: 50%; top: 50%; width: 100cqw; height: 100cqh; object-fit: contain; transform: translate(-50%, -50%) rotate(var(--r, 0deg)); transition: transform .7s var(--spring), width .7s var(--ease), height .7s var(--ease); }
.pp .pp-rotbox[data-q="1"] img, .pp .pp-rotbox[data-q="3"] img { width: 100cqh; height: 100cqw; }
.pp .pp-dir { display: inline-grid; place-items: center; color: var(--accent); }
.pp .pp-card[data-state="off"] .pp-dir { color: var(--success); }
`
