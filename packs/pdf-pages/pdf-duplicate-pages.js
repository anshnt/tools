// Duplicate page finder: compares a hash of each page's text and a perceptual hash (pHash) of its picture, groups repeats,
// lets you choose which copy to keep, and saves the PDF without the extra copies.
import { h, icon, button, busy, progress, field, rangeField, segmented, toggle, stats, empty, clear, formatBytes, downloadButton, toast } from '../../lib/ui.js'
import { suffixName } from '../../lib/files.js'
import { extractText, savePdf } from '../../lib/pdf.js'
import { pdfSource, ppRoot, scanAll, doneCard, useStyle, countUp, compressRanges } from './_shared.js'

/** 53-bit string hash (cyrb53). */
export function hashText(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** Text key for a page: lower case, letters and digits only, optionally without a page number at either end. null when there is too little text. */
export function textKey(text, ignoreNumbers = true) {
  let t = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  if (ignoreNumbers) t = t.replace(/^\d{1,4}\s+/, '').replace(/\s+\d{1,4}$/, '')
  return t.length >= 25 ? hashText(t) : null
}

const COS = Array.from({ length: 8 }, (_, u) => Array.from({ length: 32 }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / 64)))

/** Perceptual hash (pHash): 32 x 32 greyscale, DCT, 8 x 8 lowest frequencies against their median. -> {hi, lo, flat} (flat = almost no detail). */
export function pHash(c) {
  const t = document.createElement('canvas'); t.width = 32; t.height = 32
  const x = t.getContext('2d', { willReadFrequently: true })
  x.fillStyle = '#fff'; x.fillRect(0, 0, 32, 32)
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'
  x.drawImage(c, 0, 0, 32, 32)
  const d = x.getImageData(0, 0, 32, 32).data
  const f = new Float64Array(1024)
  let mean = 0
  for (let i = 0; i < 1024; i++) { f[i] = (d[i * 4] * 54 + d[i * 4 + 1] * 183 + d[i * 4 + 2] * 19) / 256; mean += f[i] }
  mean /= 1024
  let sd = 0
  for (let i = 0; i < 1024; i++) sd += (f[i] - mean) ** 2
  sd = Math.sqrt(sd / 1024)
  // separable DCT, low frequencies only
  const G = Array.from({ length: 8 }, () => new Float64Array(32))
  for (let u = 0; u < 8; u++) for (let yy = 0; yy < 32; yy++) { let s = 0; for (let xx = 0; xx < 32; xx++) s += f[yy * 32 + xx] * COS[u][xx]; G[u][yy] = s }
  const F = []
  for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) { let s = 0; for (let yy = 0; yy < 32; yy++) s += G[u][yy] * COS[v][yy]; F.push(s) }
  const sorted = F.slice(1).sort((a, b) => a - b)
  const med = sorted[Math.floor(sorted.length / 2)]
  let hi = 0, lo = 0
  F.forEach((val, i) => { const on = val > med ? 1 : 0; if (i < 32) hi = (hi << 1) | on; else lo = (lo << 1) | on })
  return { hi: hi >>> 0, lo: lo >>> 0, flat: sd < 5 }
}

const pop32 = (v) => { v -= (v >>> 1) & 0x55555555; v = (v & 0x33333333) + ((v >>> 2) & 0x33333333); return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24 }
export const hamming = (a, b) => pop32((a.hi ^ b.hi) >>> 0) + pop32((a.lo ^ b.lo) >>> 0)

/**
 * Group duplicate pages. pages: [{page, tkey, hash, aspect}]. mode: 'text' | 'look' | 'either' | 'both'. maxDist: Hamming limit.
 * -> [{pages: [1-based...], why: 'text' | 'look' | 'both'}] with at least two pages each, ordered by first page.
 */
export function groupDuplicates(pages, { mode = 'either', maxDist = 4 } = {}) {
  const n = pages.length
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  const reason = new Map()
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = pages[i], b = pages[j]
      const text = a.tkey && a.tkey === b.tkey
      // pictures only decide for scans (pages without text) unless the visitor asks for appearance-only matching
      const pictureCounts = mode === 'look' || mode === 'both' || !a.tkey || !b.tkey
      const look = pictureCounts && !a.hash.flat && !b.hash.flat && Math.abs(a.aspect - b.aspect) < 0.06 && hamming(a.hash, b.hash) <= maxDist
      const ok = mode === 'text' ? text : mode === 'look' ? look : mode === 'both' ? text && look : text || look
      if (!ok) continue
      parent[find(j)] = find(i)
      const key = find(i)
      const prev = reason.get(key)
      const r = text && look ? 'both' : text ? 'text' : 'look'
      reason.set(key, prev && prev !== r ? 'both' : r)
    }
  }
  const groups = new Map()
  for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(pages[i].page) }
  return [...groups.entries()].filter(([, g]) => g.length > 1).map(([root, g]) => ({ pages: g, why: reason.get(find(root)) || 'look' })).sort((a, b) => a.pages[0] - b.pages[0])
}

export function mount(root, { signal }) {
  const body = h('div', { class: 'stack' })
  let s
  let gen = 0
  const src = pdfSource({ onLoad: (source) => { s = source; return scan(source) }, onClear: () => { s = null; gen++; clear(body) } })

  async function scan(source) {
    const my = ++gen
    const alive = () => my === gen && !source.dead && !signal.aborted
    const prog = progress()
    clear(body, h('div', { class: 'row' }, h('span', { class: 'spinner' }), h('strong', 'Comparing pages...')), prog.el)
    const texts = await extractText(source.doc, (f) => prog.set(f * 0.4, 'Reading text'))
    if (!alive()) return
    const looks = await scanAll(source, { max: 128, alive, onProgress: (f, t) => prog.set(0.4 + f * 0.6, `Looking at ${t.toLowerCase()}`), fn: (c) => ({ hash: pHash(c), aspect: c.width / c.height }) })
    if (!alive()) return
    show(texts.map((t, i) => ({ page: i + 1, text: t.text, url: looks[i].url, ...looks[i].result })), source)
  }

  function show(pages, source) {
    const o = { mode: 'either', dist: 6, ignoreNums: true }
    const removed = new Set()
    const info = h('div')
    const list = h('div', { class: 'stack' })
    const prog = progress()
    const result = h('div')
    const go = button('Remove duplicates', { icon: 'copy-minus', variant: 'primary', size: 'lg' })
    const hasText = pages.some((p) => p.text.length >= 25)
    let groups = []

    function compute() {
      const keyed = pages.map((p) => ({ ...p, tkey: textKey(p.text, o.ignoreNums) }))
      groups = groupDuplicates(keyed, { mode: o.mode, maxDist: o.dist })
      removed.clear()
      for (const g of groups) g.pages.slice(1).forEach((p) => removed.add(p))
      render()
    }

    const whyText = { text: 'Same text', look: 'Look the same', both: 'Same text and look' }

    function paint() {
      const extra = removed.size
      const st = stats([
        { label: 'Pages', value: String(pages.length) },
        { label: 'Duplicate groups', value: h('span', { 'data-n': groups.length }, '0') },
        { label: 'Extra copies', value: h('span', { 'data-n': extra }, '0'), accent: extra > 0, hint: extra ? `Pages ${compressRanges([...removed]).slice(0, 36)}` : 'Nothing to remove' },
      ])
      for (const el of st.querySelectorAll('[data-n]')) { if (!paint.done) countUp(el, +el.dataset.n, { ms: 400 }); else el.textContent = el.dataset.n }
      clear(info, st)
      go.disabled = extra === 0
      go.querySelector('span').textContent = extra ? `Remove ${extra} duplicate ${extra === 1 ? 'page' : 'pages'}` : 'Remove duplicates'
    }

    function render() {
      paint.done = false
      paint()
      paint.done = true
      if (!groups.length) {
        clear(list, empty(o.mode === 'both' || o.dist < 3 ? 'No duplicates at this strictness. Try "Either" or a looser look setting.' : 'No duplicate pages found. Every page is different.', 'copy-check'))
        return
      }
      clear(list, groups.map((g, gi) => {
        const row = h('div', { class: 'pp-dup-group pp-in', style: { '--i': Math.min(gi, 12) } },
          h('div', { class: 'pp-dup-head' }, h('strong', `Group ${gi + 1}`), h('span', { class: 'pp-chip' }, whyText[g.why]), h('span', { class: 'small muted' }, `${g.pages.length} pages`)),
          h('div', { class: 'pp-dup-row' }, g.pages.map((pn) => {
            const p = pages[pn - 1]
            const card = h('div', { class: 'pp-card', role: 'button', tabindex: 0, 'aria-label': `Page ${pn}` },
              h('div', { class: 'pp-paper', style: { aspectRatio: `${s.sizeOf(pn).w} / ${s.sizeOf(pn).h}` } }, h('img', { src: p.url, alt: '', draggable: false })),
              h('span', { class: 'pp-num' }, pn), h('span', { class: 'pp-tick' }, icon('check'), icon('x')),
              h('div', { class: 'pp-foot' }, h('span', { 'data-role': 'v' })))
            const sync = () => { const r = removed.has(pn); card.dataset.state = r ? 'bad' : 'good'; card.setAttribute('aria-pressed', String(!r)); card.querySelector('[data-role=v]').textContent = r ? 'Remove' : 'Keep' }
            const flip = () => {
              if (!removed.has(pn) && g.pages.filter((x) => !removed.has(x)).length === 1) return toast('Keep at least one copy of each page.')
              if (removed.has(pn)) removed.delete(pn); else removed.add(pn)
              row.querySelectorAll('.pp-card').forEach((c, i) => { const q = g.pages[i]; c.dataset.state = removed.has(q) ? 'bad' : 'good'; c.setAttribute('aria-pressed', String(!removed.has(q))); c.querySelector('[data-role=v]').textContent = removed.has(q) ? 'Remove' : 'Keep' })
              paint()
            }
            card.addEventListener('click', flip)
            card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip() } })
            sync()
            return card
          })))
        return row
      }))
    }

    const modeEl = segmented([['either', 'Text or look'], ['text', 'Same text'], ['look', 'Looks the same'], ['both', 'Both']], 'either', (v) => { o.mode = v; compute() }, 'Match by')
    const distEl = rangeField('How alike pages must look', { min: 0, max: 14, step: 1, value: o.dist, format: (v) => (v === 0 ? 'Identical' : v <= 4 ? 'Very close' : v <= 8 ? 'Close' : 'Loose'), onInput: (v) => { o.dist = v; compute() }, hint: 'Compares a tiny fingerprint of each page picture, so rescans of the same sheet still match. Pages that have text are matched by their text.' })
    const numEl = toggle('Ignore page numbers when comparing text', true, (c) => { o.ignoreNums = c; compute() })

    go.addEventListener('click', () => busy(go, async () => {
      clear(result)
      const doc = await s.edit()
      for (const p of [...removed].sort((a, b) => b - a)) doc.removePage(p - 1)
      const blob = await savePdf(doc)
      clear(result, doneCard({
        title: `${removed.size} duplicate ${removed.size === 1 ? 'page' : 'pages'} removed`, detail: `${source.pages} pages down to ${doc.getPageCount()}. ${formatBytes(blob.size)}.`,
        actions: [downloadButton(blob, suffixName(s.name, 'no-duplicates'), 'Download PDF', { size: 'lg' })],
      }))
    }, { label: 'Removing', errorTo: result, progress: prog }))

    clear(body, info,
      h('div', { class: 'panel' }, h('div', { class: 'stack' }, field('Match by', modeEl), distEl, numEl, hasText ? null : h('div', { class: 'pp-hint' }, 'No text layer found, so pages are compared by how they look.'))),
      h('div', { class: 'pp-hint' }, 'The first page of each group is kept. Click a page to change which copies are removed.'),
      list, h('div', { class: 'row' }, go), prog.el, result)
    compute()
  }

  useStyle('pp-style-dups', CSS)
  root.append(ppRoot(src.el, body))
}

const CSS = `
.pp .pp-dup-group { padding: 14px; border-radius: 18px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow-sm); }
.pp .pp-dup-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.pp .pp-dup-row { display: flex; gap: 12px; overflow-x: auto; padding: 4px 4px 8px; }
.pp .pp-dup-row .pp-card { width: 112px; flex: none; }
.pp .pp-dup-row .pp-card[data-state="good"] .pp-tick .icon:last-child, .pp .pp-dup-row .pp-card[data-state="bad"] .pp-tick .icon:first-child { display: none; }
`
