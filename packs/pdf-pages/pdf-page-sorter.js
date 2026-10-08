// PDF page sorter. One module, several focused entries (params.mode): reverse the order, interleave front and back scans
// (backs reversed), or sort pages by the number printed on them. mode 'all' shows all three as tabs.
import { h, icon, button, busy, progress, field, input, segmented, toggle, stats, empty, clear, formatBytes, downloadButton, tabs, alert, yieldToMain } from '../../lib/ui.js'
import { suffixName } from '../../lib/files.js'
import { savePdf } from '../../lib/pdf.js'
import { pdfLib } from '../../lib/libs.js'
import { pdfSource, ppRoot, pageThumb, doneCard, useStyle, countUp, reorderGrid, compressRanges } from './_shared.js'

// ---------------------------------------------------------------------------------------------------------------------
// Pure logic (exported for tests)
// ---------------------------------------------------------------------------------------------------------------------
/** New order of 0-based page indices for reversing n pages (optionally keeping the first page, e.g. a cover, in place). */
export function reverseOrder(n, keepFirst = false) {
  const idx = Array.from({ length: n }, (_, i) => i)
  if (keepFirst && n > 1) return [0, ...idx.slice(1).reverse()]
  return idx.reverse()
}

/**
 * Interleave fronts and backs. Returns [{side: 'F' | 'B', idx}] where idx is 0-based within that side's list.
 * reverseBacks: the backs were scanned from the last sheet to the first (stack flipped over), so back k belongs to front (backs - 1 - k).
 */
export function interleaveOrder(fronts, backs, reverseBacks = true) {
  const out = []
  for (let i = 0; i < fronts; i++) {
    out.push({ side: 'F', idx: i, front: i })
    const b = reverseBacks ? backs - 1 - i : i
    if (b >= 0 && b < backs) out.push({ side: 'B', idx: b, front: i })
  }
  for (let b = 0; b < backs; b++) {
    const used = out.some((o) => o.side === 'B' && o.idx === b)
    if (!used) out.push({ side: 'B', idx: b, front: null })
  }
  return out
}

const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100 }
export function romanToInt(s) {
  const t = s.toLowerCase()
  if (!/^[ivxlc]{1,8}$/.test(t)) return null
  let n = 0
  for (let i = 0; i < t.length; i++) { const v = ROMAN[t[i]], nx = ROMAN[t[i + 1]] || 0; n += v < nx ? -v : v }
  return n > 0 && n < 400 && intToRoman(n) === t ? n : null
}
export function intToRoman(n) {
  const map = [[100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
  let out = ''
  for (const [v, s] of map) while (n >= v) { out += s; n -= v }
  return out
}

/** Parse a page number the way a person would type it or see it printed: "12", "Page 12", "12 of 40", "- 12 -", "xiv". -> {key, text} or null. */
export function parsePageNumber(str) {
  const t = String(str).trim()
  if (!t) return null
  let m = t.match(/^(?:page\s*|p\.?\s*)?(\d{1,4})(?:\s*(?:of|\/)\s*\d{1,4})?$/i) || t.match(/^[-\u2013\u2014]\s*(\d{1,4})\s*[-\u2013\u2014]$/)
  if (m) return { key: +m[1], text: String(+m[1]) }
  const r = romanToInt(t.replace(/^page\s*/i, ''))
  if (r) return { key: r - 100000, text: intToRoman(r) } // front matter sorts before page 1
  return null
}

/** Find the printed number of a page from its text items. items: [{str, x, y}] with y measured from the top of the displayed page. */
export function pickPageNumber(items, height) {
  const cands = []
  for (const it of items) {
    const p = parsePageNumber(it.str)
    if (!p) continue
    if (it.y > height * 0.86) cands.push({ ...p, band: 'bottom', y: it.y })
    else if (it.y < height * 0.12) cands.push({ ...p, band: 'top', y: it.y })
  }
  if (!cands.length) return null
  const bottom = cands.filter((c) => c.band === 'bottom').sort((a, b) => b.y - a.y)
  return (bottom[0] || cands.filter((c) => c.band === 'top').sort((a, b) => a.y - b.y)[0])
}

/** Sort order (0-based indices) from numbers: [{key} | null]. Unnumbered pages stay right after the page before them. */
export function orderByNumbers(nums) {
  let last = -Infinity, extra = 0
  const keyed = nums.map((n, i) => {
    if (n) { last = n.key; extra = 0; return { i, k: n.key, e: 0 } }
    extra += 1
    return { i, k: last === -Infinity ? -1e9 : last, e: extra }
  })
  return keyed.sort((a, b) => a.k - b.k || a.e - b.e || a.i - b.i).map((x) => x.i)
}

// ---------------------------------------------------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------------------------------------------------
const orderCard = (s, pageNo, label, i, extra) => {
  const c = h('div', { class: 'pp-card pp-in', style: { '--i': Math.min(i, 24) }, 'aria-label': `Page ${pageNo}` },
    pageThumb(s, pageNo, { max: 200 }), h('span', { class: 'pp-num' }, label ?? pageNo), extra || null)
  return c
}

async function assemble(parts, order, title) {
  // parts: [{doc}] ; order: [{part, idx}] -> pdf-lib doc with pages copied in that order
  const { PDFDocument } = await pdfLib()
  const out = await PDFDocument.create()
  const copied = new Map()
  for (let p = 0; p < parts.length; p++) {
    const idxs = order.filter((o) => o.part === p).map((o) => o.idx)
    if (!idxs.length) continue
    const pages = await out.copyPages(parts[p].doc, idxs)
    idxs.forEach((ix, k) => copied.set(`${p}:${ix}`, pages[k]))
  }
  for (const o of order) out.addPage(copied.get(`${o.part}:${o.idx}`))
  if (title) out.setTitle(title)
  return out
}

function reversePanel(s) {
  const n = s.pages
  const o = { keep: false }
  const cards = Array.from({ length: n }, (_, i) => orderCard(s, i + 1, i + 1, i))
  const grid = h('div', { class: 'pp-grid', style: '--min:110px' })
  const prog = progress(), result = h('div')
  const go = button('Reverse pages', { icon: 'arrow-down-wide-narrow', variant: 'primary', size: 'lg' })
  const paint = () => {
    const order = reverseOrder(n, o.keep)
    reorderGrid(grid, order.map((i) => cards[i]))
    order.forEach((src, pos) => { cards[src].querySelector('.pp-foot')?.remove(); cards[src].append(h('div', { class: 'pp-foot' }, h('span', `now page ${pos + 1}`))) })
  }
  go.addEventListener('click', () => busy(go, async () => {
    clear(result)
    const order = reverseOrder(n, o.keep).map((idx) => ({ part: 0, idx }))
    const out = await assemble([{ doc: await s.edit() }], order, null)
    const blob = await savePdf(out)
    clear(result, doneCard({ title: 'Pages reversed', detail: `${n} pages, last to first${o.keep ? ' (cover kept first)' : ''}. ${formatBytes(blob.size)}.`, actions: [downloadButton(blob, suffixName(s.name, 'reversed'), 'Download PDF', { size: 'lg' })] }))
  }, { label: 'Reversing', errorTo: result, progress: prog }))
  const keepEl = toggle('Keep the first page (cover) where it is', false, (c) => { o.keep = c; paint() })
  const el = h('div', { class: 'stack' }, h('div', { class: 'panel' }, keepEl), h('div', { class: 'pp-section-title' }, icon('arrow-down-wide-narrow'), 'New order'), grid, h('div', { class: 'row' }, go), prog.el, result)
  grid.append(...cards)
  paint()
  return el
}

function interleavePanel(s) {
  const o = { input: 'one', rev: true }
  const grid = h('div', { class: 'pp-grid', style: '--min:104px' })
  const info = h('div'), second = h('div'), prog = progress(), result = h('div')
  let s2 = null
  const go = button('Interleave pages', { icon: 'arrow-left-right', variant: 'primary', size: 'lg' })
  const src2 = pdfSource({ label: 'Drop the PDF with the back sides', hint: 'Scanned when you flipped the stack over', paste: false, sample: false, onLoad: (x) => { s2 = x; return x.pageSizes().then(paint) }, onClear: () => { s2 = null; paint() } })
  second.append(src2.el); second.hidden = true

  const sides = () => {
    if (o.input === 'one') {
      const f = Math.ceil(s.pages / 2)
      return { fronts: Array.from({ length: f }, (_, i) => ({ src: s, page: i + 1 })), backs: Array.from({ length: s.pages - f }, (_, i) => ({ src: s, page: f + i + 1 })) }
    }
    return { fronts: Array.from({ length: s.pages }, (_, i) => ({ src: s, page: i + 1 })), backs: s2 ? Array.from({ length: s2.pages }, (_, i) => ({ src: s2, page: i + 1 })) : [] }
  }
  const order = () => { const { fronts, backs } = sides(); return interleaveOrder(fronts.length, backs.length, o.rev).map((x) => ({ ...(x.side === 'F' ? fronts : backs)[x.idx], side: x.side, n: x.front == null ? x.idx + 1 : x.front + 1 })) }

  function paint() {
    const { fronts, backs } = sides()
    const ord = order()
    const ready = o.input === 'one' || !!s2
    go.disabled = !ready || !ord.length
    const mismatch = ready && fronts.length !== backs.length
    clear(info,
      stats([{ label: 'Front pages', value: String(fronts.length) }, { label: 'Back pages', value: String(backs.length), danger: mismatch }, { label: 'Result', value: String(ord.length), accent: true, hint: 'pages' }]),
      mismatch ? h('div', { style: 'margin-top:10px' }, alert('warn', `There are ${fronts.length} fronts but ${backs.length} backs. They should match, one back for every front. Extra pages are added at the end.`)) : null)
    clear(grid, ready ? ord.slice(0, 80).map((p, i) => orderCard(p.src, p.page, i + 1, i, h('div', { class: 'pp-foot' }, h('span', { class: p.side === 'F' ? 'pp-chip' : 'pp-chip plain' }, `${p.side === 'F' ? 'Front' : 'Back'} ${p.n}`)))) : empty('Add the PDF with the back sides to see the new order.', 'files'))
  }

  go.addEventListener('click', () => busy(go, async () => {
    clear(result)
    const ord = order()
    const parts = [{ doc: await s.edit() }]
    if (s2) parts.push({ doc: await s2.edit() })
    const out = await assemble(parts, ord.map((p) => ({ part: p.src === s ? 0 : 1, idx: p.page - 1 })), null)
    const blob = await savePdf(out)
    clear(result, doneCard({ title: `${ord.length} pages in reading order`, detail: `Fronts and backs alternate${o.rev ? ', backs flipped back into order' : ''}. ${formatBytes(blob.size)}.`, actions: [downloadButton(blob, suffixName(s.name, 'interleaved'), 'Download PDF', { size: 'lg' })] }))
  }, { label: 'Interleaving', errorTo: result, progress: prog }))

  const inEl = segmented([['one', 'One PDF: fronts, then backs'], ['two', 'Two PDFs']], 'one', (v) => { o.input = v; second.hidden = v === 'one'; paint() }, 'Scan input')
  const revEl = toggle('The back sides were scanned in reverse (last sheet first)', true, (c) => { o.rev = c; paint() })
  const el = h('div', { class: 'stack' },
    h('div', { class: 'panel' }, h('div', { class: 'stack' }, field('Where are the back sides?', inEl, 'One PDF means the first half has all the fronts and the second half all the backs.'), second, revEl)),
    info, h('div', { class: 'pp-section-title' }, icon('arrow-left-right'), 'Result (first pages)'), grid, h('div', { class: 'row' }, go), prog.el, result)
  paint()
  return el
}

function numberPanel(s, signal) {
  const n = s.pages
  const prog = progress(), result = h('div'), info = h('div')
  const grid = h('div', { class: 'pp-grid', style: '--min:118px; align-items:start' })
  const go = button('Sort pages', { icon: 'arrow-down-wide-narrow', variant: 'primary', size: 'lg' })
  const detected = new Array(n).fill(null)
  const nums = new Array(n).fill(null)
  const cards = [], inputs = []
  let found = 0

  const order = () => orderByNumbers(nums)
  function paint(animate = true) {
    const ord = order()
    const moved = ord.filter((src, pos) => src !== pos).length
    const shown = nums.filter(Boolean).length
    const st = stats([
      { label: 'Pages', value: String(n) },
      { label: 'Numbers found', value: h('span', { 'data-n': found }, '0'), hint: `${shown} in use`, danger: found === 0 },
      { label: 'Pages that move', value: h('span', { 'data-n': moved }, '0'), accent: moved > 0 },
    ])
    for (const el of st.querySelectorAll('[data-n]')) { if (!paint.done) countUp(el, +el.dataset.n, { ms: 400 }); else el.textContent = el.dataset.n }
    paint.done = true
    clear(info, st)
    const items = ord.map((i) => cards[i])
    if (animate) reorderGrid(grid, items); else grid.append(...items)
    ord.forEach((src, pos) => cards[src].querySelector('[data-role=pos]').textContent = `now ${pos + 1}`)
    go.disabled = moved === 0
  }

  for (let i = 0; i < n; i++) {
    const inp = input({ class: 'pp-numinput', placeholder: '?', value: '', 'aria-label': `Printed number of page ${i + 1}`, inputmode: 'text',
      oninput: (e) => { const p = parsePageNumber(e.target.value); nums[i] = p; e.target.classList.toggle('invalid', !!e.target.value.trim() && !p); paint() } })
    inputs.push(inp)
    cards.push(orderCard(s, i + 1, i + 1, i, h('div', { class: 'pp-foot' }, inp, h('span', { 'data-role': 'pos' }))))
  }
  grid.append(...cards)

  async function detect() {
    prog.set(0, 'Looking for page numbers')
    for (let p = 1; p <= n; p++) {
      if (s.dead || signal.aborted) return
      const page = await s.doc.getPage(p)
      const vp = page.getViewport({ scale: 1 })
      const tc = await page.getTextContent()
      const items = tc.items.filter((x) => 'str' in x && x.str.trim()).map((x) => ({ str: x.str, y: vp.convertToViewportPoint(x.transform[4], x.transform[5])[1] }))
      const hit = pickPageNumber(items, vp.height)
      if (hit) { detected[p - 1] = { key: hit.key, text: hit.text }; nums[p - 1] = detected[p - 1]; inputs[p - 1].value = hit.text; found++ }
      page.cleanup()
      if (p % 10 === 0) { prog.set(p / n, `Looking for page numbers: ${p} of ${n}`); await yieldToMain() }
    }
    prog.hide()
    paint(false)
  }

  go.addEventListener('click', () => busy(go, async () => {
    clear(result)
    const ord = order().map((idx) => ({ part: 0, idx }))
    const out = await assemble([{ doc: await s.edit() }], ord, null)
    const blob = await savePdf(out)
    clear(result, doneCard({ title: 'Pages sorted by printed number', detail: `New order: ${order().map((i) => i + 1).join(', ').slice(0, 120)}. ${formatBytes(blob.size)}.`, actions: [downloadButton(blob, suffixName(s.name, 'sorted'), 'Download PDF', { size: 'lg' })] }))
  }, { label: 'Sorting', errorTo: result, progress: prog }))

  const reset = button('Reset numbers', { variant: 'ghost', size: 'sm', icon: 'rotate-ccw', onClick: () => { detected.forEach((d, i) => { nums[i] = d; inputs[i].value = d ? d.text : ''; inputs[i].classList.remove('invalid') }); paint() } })
  const el = h('div', { class: 'stack' },
    info,
    h('div', { class: 'pp-hint' }, 'Numbers are read from the top and bottom margins. Fix or fill in any number below and the pages re-sort instantly. Roman numerals (i, ii, iv) sort before page 1. A page without a number stays behind the page before it.'),
    h('div', { class: 'pp-toolbar' }, h('span', { class: 'grow' }), reset),
    grid, h('div', { class: 'row' }, go), prog.el, result)
  paint(false)
  detect().catch((e) => console.error(e))
  return el
}

export function mount(root, { params, signal }) {
  const mode = params?.mode || 'all'
  const body = h('div', { class: 'stack' })
  let s
  const labels = { reverse: 'Drop the PDF to reverse', interleave: 'Drop the PDF with the front sides (or both sides in one file)', number: 'Drop the PDF to sort' }
  const src = pdfSource({
    label: labels[mode],
    sampleKind: { interleave: 'duplex', number: 'scrambled' }[mode] || 'general',
    onLoad: async (source) => {
      s = source
      await s.pageSizes()
      const panels = { reverse: () => reversePanel(s), interleave: () => interleavePanel(s), number: () => numberPanel(s, signal) }
      if (mode === 'all') {
        clear(body, tabs([{ id: 'reverse', label: 'Reverse', render: panels.reverse }, { id: 'interleave', label: 'Interleave scans', render: panels.interleave }, { id: 'number', label: 'By printed number', render: panels.number }], 'reverse'))
      } else clear(body, panels[mode]())
    },
    onClear: () => { s = null; clear(body) },
  })
  useStyle('pp-style-sorter', CSS)
  root.append(ppRoot(src.el, body))
}

const CSS = `
.pp .pp-numinput { height: 30px !important; padding: 0 8px !important; border-radius: 8px !important; font-size: 13px !important; font-variant-numeric: tabular-nums; max-width: 64px; }
.pp .pp-foot [data-role=pos] { font-size: 11.5px; white-space: nowrap; }
@media (max-width: 720px) { .pp .pp-numinput { font-size: 16px !important; } }
`
