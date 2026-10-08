// Shared building blocks for the pdf-pages pack (files starting with "_" are never tool modules).
// Gives every tool the same flow: pdfSource() (drop, password, file chip) -> live previews -> result card.
import { h, icon, button, dropzone, alert, input, formatBytes, onCleanup, clear, field, number, select, segmented, yieldToMain, toast } from '../../lib/ui.js'
import { openPdf, loadPdfLib, renderPage, PAGE_SIZES } from '../../lib/pdf.js'
import { pdfLib } from '../../lib/libs.js'

// ---------------------------------------------------------------------------------------------------------------------
// Units and paper
// ---------------------------------------------------------------------------------------------------------------------
export const MM = 72 / 25.4
export const mm = (v) => v * MM
export const toMm = (pt) => pt / MM
export const toIn = (pt) => pt / 72
export const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d

/** Named paper sizes in millimetres (short side, long side). */
export const NAMED_SIZES = [
  ['A0', 841, 1189], ['A1', 594, 841], ['A2', 420, 594], ['A3', 297, 420], ['A4', 210, 297], ['A5', 148, 210], ['A6', 105, 148],
  ['B4', 250, 353], ['B5', 176, 250], ['Letter', 215.9, 279.4], ['Legal', 215.9, 355.6], ['Tabloid', 279.4, 431.8],
  ['Executive', 184.2, 266.7], ['Statement', 139.7, 215.9], ['Folio', 210, 330],
]

/** Orientation of a page from its displayed size in points. */
export const orientationOf = (w, h) => (Math.abs(w - h) < 1 ? 'Square' : w > h ? 'Landscape' : 'Portrait')

/**
 * Match a page size (points) to a named paper size, either orientation, within tolMm on both sides.
 * -> {name, diffMm, exact} or null
 */
export function identifyPaper(wPt, hPt, tolMm = 2) {
  const a = toMm(Math.min(wPt, hPt)), b = toMm(Math.max(wPt, hPt))
  let best = null
  for (const [name, s, l] of NAMED_SIZES) {
    const d = Math.max(Math.abs(a - s), Math.abs(b - l))
    if (d <= tolMm && (!best || d < best.diffMm)) best = { name, diffMm: d, exact: d < 0.6 }
  }
  return best
}

/** Large-print paper choices for pickers (points, portrait). */
export const PAPERS = ['A4', 'A3', 'A5', 'Letter', 'Legal', 'Tabloid']

/**
 * Paper picker: size select (with custom mm), optional orientation control.
 * paperPicker({value: 'A4', orient: 'auto', onChange}) -> el; el.get() -> {name, w, h} (points, portrait); el.sheet(contentLandscape) -> {w, h} with orientation applied.
 */
export function paperPicker({ value = 'A4', orient = 'auto', auto = true, onChange, label = 'Paper size', hint } = {}) {
  const state = { name: value, orient, cw: 210, ch: 297 }
  const fire = () => onChange?.(el.get())
  const sel = select([...PAPERS.map((p) => [p, `${p}  (${round(toMm(PAGE_SIZES[p][0]), 1)} x ${round(toMm(PAGE_SIZES[p][1]), 1)} mm)`]), ['custom', 'Custom size...']], value, (v) => {
    state.name = v
    customRow.hidden = v !== 'custom'
    fire()
  })
  const cw = number(state.cw, { min: 20, max: 2000, onInput: (n) => { state.cw = n; fire() }, ariaLabel: 'Custom width in millimetres' })
  const ch = number(state.ch, { min: 20, max: 2000, onInput: (n) => { state.ch = n; fire() }, ariaLabel: 'Custom height in millimetres' })
  const customRow = h('div', { class: 'grid-2', hidden: true }, field('Width (mm)', cw), field('Height (mm)', ch))
  const opts = [...(auto ? [['auto', 'Auto']] : []), ['portrait', 'Portrait'], ['landscape', 'Landscape']]
  const seg = orient == null ? null : segmented(opts, orient, (v) => { state.orient = v; fire() }, 'Sheet orientation')
  const el = h('div', { class: 'stack tight' }, field(label, sel, hint), customRow, seg && field('Orientation', seg))
  el.get = () => {
    if (state.name === 'custom') {
      const a = mm(Number.isFinite(state.cw) ? state.cw : 210), b = mm(Number.isFinite(state.ch) ? state.ch : 297)
      return { name: 'Custom', w: Math.min(a, b), h: Math.max(a, b), orient: state.orient }
    }
    const [w, hh] = PAGE_SIZES[state.name]
    return { name: state.name, w, h: hh, orient: state.orient }
  }
  el.sheet = (contentLandscape = false) => {
    const p = el.get()
    const land = p.orient === 'landscape' || (p.orient === 'auto' && contentLandscape)
    return land ? { w: p.h, h: p.w, name: p.name } : { w: p.w, h: p.h, name: p.name }
  }
  return el
}

/** Fit a (dw x dh) rectangle into the box (bx, by, bw, bh), centred, keeping the aspect ratio. */
export function fitInto(dw, dh, bx, by, bw, bh, { upscale = true } = {}) {
  let s = Math.min(bw / dw, bh / dh)
  if (!upscale) s = Math.min(1, s)
  const w = dw * s, hh = dh * s
  return { x: bx + (bw - w) / 2, y: by + (bh - hh) / 2, w, h: hh, scale: s }
}

// ---------------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------------
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** Animate a number up to its value (instant when the visitor prefers reduced motion). */
export function countUp(el, to, { format = (n) => Math.round(n).toLocaleString(), ms = 700 } = {}) {
  if (!Number.isFinite(to) || reduced() || to === 0) { el.textContent = format(to); return }
  const t0 = performance.now()
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / ms)
    el.textContent = format(to * (1 - (1 - k) ** 3))
    if (k < 1 && el.isConnected) requestAnimationFrame(tick)
    else el.textContent = format(to)
  }
  requestAnimationFrame(tick)
}

/** [1,2,3,5,7,8] -> "1-3, 5, 7-8" */
export function compressRanges(nums) {
  const a = [...new Set(nums)].sort((x, y) => x - y)
  const out = []
  for (let i = 0; i < a.length; i++) {
    let j = i
    while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++
    out.push(j > i ? `${a[i]}-${a[j]}` : `${a[i]}`)
    i = j
  }
  return out.join(', ')
}

export function toCSV(rows) {
  const q = (v) => {
    const s = String(v ?? '')
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map((r) => r.map(q).join(',')).join('\r\n')
}

/** Run async tasks with limited concurrency. */
export function limiter(max = 3) {
  let active = 0
  const queue = []
  const next = () => {
    while (active < max && queue.length) {
      const { fn, resolve, reject } = queue.shift()
      active++
      Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next() })
    }
  }
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next() })
}

const abortError = () => Object.assign(new Error('Cancelled'), { code: 'ABORT' })

// ---------------------------------------------------------------------------------------------------------------------
// PDF source: dropzone -> (password) -> file chip
// ---------------------------------------------------------------------------------------------------------------------
function makeSource(file, bytes, doc, password) {
  let dead = false
  const run = limiter(3)
  const urls = new Map()
  let sizes = null
  let shared = null
  const hooks = []
  const s = {
    file, bytes, doc, password, name: file.name, size: file.size, pages: doc.numPages,
    get dead() { return dead },
    /** Fresh pdf-lib document for editing (a new copy each call). Decrypts with the password the visitor gave. */
    edit: (opts) => loadPdfLib(bytes, { password, ...opts }),
    /** Cached pdf-lib document for reading only (original metadata is kept). */
    inspect: () => (shared ||= loadPdfLib(bytes, { password, updateMetadata: false }).catch((e) => { shared = null; throw e })),
    /** Displayed size of every page in points: [{w, h, rot}]. */
    async pageSizes() {
      if (sizes) return sizes
      const out = []
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i)
        const vp = p.getViewport({ scale: 1 })
        out.push({ w: vp.width, h: vp.height, rot: p.rotate })
        if (i % 50 === 0) await yieldToMain()
      }
      return (sizes = out)
    },
    sizeOf: (n) => sizes?.[n - 1] || { w: 595, h: 842, rot: 0 },
    /** Run a render task through the shared queue (3 at a time). */
    queue: (fn) => run(() => (dead ? Promise.reject(abortError()) : fn())),
    /** Render page n (1-based) to a canvas whose longest side is about `max` px. */
    async canvas(n, max = 260) {
      const sz = s.sizeOf(n)
      return s.queue(() => renderPage(doc, n, { scale: max / Math.max(sz.w, sz.h) }))
    },
    /** Cached JPEG object URL of a thumbnail (cheap to keep for hundreds of pages). */
    thumbURL(n, max = 260) {
      const key = `${n}:${max}`
      if (!urls.has(key)) {
        urls.set(key, s.canvas(n, max).then(async (c) => {
          const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86))
          c.width = c.height = 0
          if (dead || !blob) throw abortError()
          return URL.createObjectURL(blob)
        }).catch((e) => { urls.delete(key); throw e }))
      }
      return urls.get(key)
    },
    /** Register cleanup that runs when this PDF is replaced or the page is left. */
    onDestroy: (fn) => hooks.push(fn),
    /**
     * Render page n small, run fn(canvas) on it and keep a thumbnail URL for later (same cache as thumbURL).
     * -> {result, url}
     */
    async scan(n, max, fn) {
      const c = await s.canvas(n, max)
      let result
      try { result = await fn(c) } catch (e) { c.width = c.height = 0; throw e }
      const key = `${n}:${max}`
      if (!urls.has(key)) {
        urls.set(key, new Promise((resolve, reject) => c.toBlob((blob) => {
          c.width = c.height = 0
          if (dead || !blob) { urls.delete(key); reject(abortError()); return }
          resolve(URL.createObjectURL(blob))
        }, 'image/jpeg', 0.86)))
      } else c.width = c.height = 0
      return { result, url: await urls.get(key) }
    },
    destroy() {
      if (dead) return
      dead = true
      for (const fn of hooks) { try { fn() } catch { /* ignore */ } }
      for (const p of urls.values()) p.then((u) => URL.revokeObjectURL(u), () => {})
      urls.clear()
      try { doc.destroy() } catch { /* already gone */ }
    },
  }
  return s
}

/**
 * The first thing in every PDF tool. Handles drop / browse / paste, password-protected files and a friendly file chip.
 * pdfSource({onLoad(source), onClear(), label, hint, paste}) -> {el, current, clear()}
 * source: {file, name, size, pages, bytes, doc (pdf.js), edit(), inspect(), pageSizes(), sizeOf(n), thumbURL(n), canvas(n), queue(fn), destroy()}
 */
export function pdfSource({ onLoad, onClear, label, hint, paste = true } = {}) {
  injectStyles()
  const root = h('div', { class: 'pp-source' })
  const msg = h('div')
  let current = null
  let token = 0
  const zone = dropzone({
    accept: '.pdf,application/pdf', label: label || 'Drop a PDF here or click to choose', hint: hint || 'Your file stays on this device', paste,
    onFiles: ([f]) => open(f),
  })
  const api = { el: root, zone, get current() { return current } }
  root.append(zone, msg)
  onCleanup(() => current?.destroy())

  function drop(files) {
    const pdfs = files.filter((f) => /pdf$/i.test(f.name) || f.type === 'application/pdf')
    if (pdfs.length) open(pdfs[0])
  }

  function chip(s) {
    const el = h('div', { class: 'pp-file', ondragover: (e) => e.preventDefault(), ondrop: (e) => { e.preventDefault(); drop([...e.dataTransfer.files]) } },
      h('div', { class: 'pp-stackicon', 'aria-hidden': 'true' }, h('i'), h('i'), h('i', icon('file-text'))),
      h('div', { class: 'pp-file-meta' },
        h('div', { class: 'pp-file-name', title: s.name }, s.name),
        h('div', { class: 'pp-file-sub' },
          h('span', { class: 'pp-chip' }, `${s.pages} ${s.pages === 1 ? 'page' : 'pages'}`),
          h('span', { class: 'pp-chip' }, formatBytes(s.size)))),
      button('Change', { icon: 'refresh-cw', variant: 'ghost', size: 'sm', onClick: () => zone.open() }))
    return el
  }

  function setCurrent(s) {
    current?.destroy()
    onClear?.()
    clear(msg)
    current = s
    root.querySelector('.pp-file, .pp-pw')?.remove()
    zone.hidden = true
    root.insertBefore(chip(s), zone)
    Promise.resolve().then(() => onLoad?.(s)).catch((e) => {
      console.error(e)
      clear(msg, alert('error', e?.message || 'Could not read this PDF.'))
    })
  }

  function askPassword(file, wrong) {
    root.querySelector('.pp-file, .pp-pw')?.remove()
    zone.hidden = true
    const pw = input({ type: 'password', placeholder: 'Password', 'aria-label': 'PDF password', autocomplete: 'off' })
    const go = () => { if (pw.value) open(file, pw.value) }
    pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go() })
    const box = h('div', { class: 'pp-pw' },
      h('div', { class: 'pp-pw-icon' }, icon('lock')),
      h('div', { class: 'pp-pw-body' },
        h('strong', `${file.name} is password-protected`),
        h('div', { class: 'small muted' }, wrong ? 'That password did not work. Try again.' : 'Enter the password to open it. It is only used on this device.'),
        h('div', { class: 'row', style: 'margin-top:10px' }, h('div', { class: 'grow' }, pw), button('Unlock', { icon: 'unlock', variant: 'primary', onClick: go }),
          button('Other file', { variant: 'ghost', onClick: () => { box.remove(); zone.hidden = !!current; if (current) root.insertBefore(chip(current), zone); zone.open() } }))))
    root.insertBefore(box, zone)
    pw.focus()
  }

  async function open(file, password) {
    const my = ++token
    clear(msg)
    try {
      if (file.size > 300 * 1024 * 1024) throw new Error('That file is over 300 MB, which is too large to process in a browser tab.')
      const bytes = new Uint8Array(await file.arrayBuffer())
      const doc = await openPdf(bytes, { password })
      if (my !== token) { doc.destroy(); return }
      setCurrent(makeSource(file, bytes, doc, password))
    } catch (e) {
      if (my !== token) return
      if (e.code === 'PASSWORD') return askPassword(file, password != null)
      console.error(e)
      zone.hidden = false
      clear(msg, alert('error', e.message || 'Could not open this PDF.'))
    }
  }
  api.clear = () => { current?.destroy(); current = null; onClear?.(); root.querySelector('.pp-file, .pp-pw')?.remove(); zone.hidden = false }
  return api
}

// ---------------------------------------------------------------------------------------------------------------------
// Page thumbnails (lazy, with the right aspect ratio from the start so layouts never jump)
// ---------------------------------------------------------------------------------------------------------------------
let io
const pending = new WeakMap()
function observer() {
  if (!io) {
    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        io.unobserve(e.target)
        pending.get(e.target)?.()
        pending.delete(e.target)
      }
    }, { rootMargin: '500px 0px' })
    onCleanup(() => { io?.disconnect(); io = null })
  }
  return io
}

/**
 * A white "paper" element showing page n. Call `await s.pageSizes()` first so the aspect ratio is right.
 * pageThumb(source, n, {max, quarter}) - quarter rotates the picture by clockwise quarter turns (CSS, animated).
 */
export function pageThumb(s, n, { max = 260, alt = '' } = {}) {
  const sz = s.sizeOf(n)
  const paper = h('div', { class: 'pp-paper pp-loading', style: { aspectRatio: `${sz.w} / ${sz.h}` } })
  pending.set(paper, () => {
    s.thumbURL(n, max).then((url) => {
      if (!paper.isConnected && s.dead) return
      paper.append(h('img', { src: url, alt, draggable: false, decoding: 'async' }))
      paper.classList.remove('pp-loading')
    }, () => {})
  })
  observer().observe(paper)
  return paper
}

/** Put `items` into `container` in this order, sliding each one from its old position (FLIP). Items keep their identity between calls. */
export function reorderGrid(container, items) {
  const before = new Map([...container.children].map((c) => [c, c.getBoundingClientRect()]))
  container.append(...items)
  if (reduced()) return
  for (const c of items) {
    const a = before.get(c)
    if (!a) continue
    const b = c.getBoundingClientRect()
    const dx = a.left - b.left, dy = a.top - b.top
    if (!dx && !dy) continue
    c.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 480, easing: 'cubic-bezier(.2,.8,.2,1)' })
  }
}

/** Run fn once when el scrolls near the viewport. */
export const whenVisible = (el, fn) => { pending.set(el, fn); observer().observe(el) }

/** Set entry animation index on an element (staggered pop-in). */
export const pop = (el, i) => { el.classList.add('pp-in'); el.style.setProperty('--i', Math.min(i, 24)); return el }

/** A selectable page card: paper + number pill. */
export function pageCard(s, n, { label, state, onClick, max, extra } = {}) {
  const card = h('div', { class: 'pp-card', role: onClick ? 'button' : null, tabindex: onClick ? 0 : null, 'data-state': state || '', 'aria-label': `Page ${n}` },
    pageThumb(s, n, { max }),
    h('span', { class: 'pp-num' }, label ?? n),
    h('span', { class: 'pp-tick', 'aria-hidden': 'true' }, icon('check')),
    extra || null)
  if (onClick) {
    card.addEventListener('click', (e) => onClick(e, card))
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e, card) } })
  }
  return card
}

// ---------------------------------------------------------------------------------------------------------------------
// pdf-lib page geometry and placement
// ---------------------------------------------------------------------------------------------------------------------
/** Geometry of a pdf-lib page: crop box, /Rotate and displayed size. */
export function pageGeom(page) {
  const cb = page.getCropBox()
  const rot = (((page.getRotation().angle % 360) + 360) % 360)
  const swap = rot === 90 || rot === 270
  return { x: cb.x, y: cb.y, w: cb.width, h: cb.height, rot, dw: swap ? cb.height : cb.width, dh: swap ? cb.width : cb.height }
}

/**
 * Embed pages of a source doc (by 0-based index) into `out`. -> Map(index -> {emb, geom}); emb is null for pages without content (blank).
 * Uses the crop box of each page. Pages are re-embedded as reusable page objects: links and form fields are not carried over.
 */
export async function embedPages(out, src, indices) {
  const uniq = [...new Set(indices)].filter((i) => i != null)
  const pages = uniq.map((i) => src.getPage(i))
  const map = new Map()
  const withContent = []
  uniq.forEach((idx, k) => {
    const c = pages[k].node.Contents()
    const empty = !c || (c.size && c.size() === 0)
    if (empty) map.set(idx, { emb: null, geom: pageGeom(pages[k]) })
    else withContent.push(k)
  })
  const boxes = withContent.map((k) => { const g = pageGeom(pages[k]); return { left: g.x, bottom: g.y, right: g.x + g.w, top: g.y + g.h } })
  const embedded = withContent.length ? await out.embedPages(withContent.map((k) => pages[k]), boxes) : []
  withContent.forEach((k, j) => map.set(uniq[k], { emb: embedded[j], geom: pageGeom(pages[k]) }))
  return map
}

/**
 * Draw an embedded page so its displayed (rotated) image fills `box` {x, y, w, h} exactly. Includes the page's own /Rotate plus `extraQuarter`
 * clockwise quarter turns. The caller chooses the box with fitInto().
 */
export function drawEmbedded(pdfPage, rotateFn, emb, geom, box, extraQuarter = 0) {
  if (!emb) return
  const q = ((geom.rot / 90 + extraQuarter) % 4 + 4) % 4
  const odd = q % 2 === 1
  const drawW = odd ? box.h : box.w, drawH = odd ? box.w : box.h
  const origin = [[box.x, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h], [box.x + box.w, box.y]][q]
  pdfPage.drawPage(emb, { x: origin[0], y: origin[1], width: drawW, height: drawH, rotate: rotateFn(-90 * q) })
}

/**
 * Build a new PDF from sheet layouts (n-up, booklet...). sheets: [{w, h, items: [{page (1-based or null for blank), x, y, w, h, border}], lines: [{x1, y1, x2, y2}]}]
 * Each item's box is where the displayed page lands on the sheet (use fitInto). Returns the pdf-lib document.
 */
export async function imposeToPdf(srcDoc, sheets, { onProgress } = {}) {
  const { PDFDocument, degrees, rgb } = await pdfLib()
  const out = await PDFDocument.create()
  const need = [...new Set(sheets.flatMap((sh) => sh.items.map((i) => i.page).filter((p) => p != null)))].map((p) => p - 1)
  const emb = await embedPages(out, srcDoc, need)
  for (let k = 0; k < sheets.length; k++) {
    const sh = sheets[k]
    const pg = out.addPage([sh.w, sh.h])
    for (const it of sh.items) {
      if (it.page != null) { const e = emb.get(it.page - 1); drawEmbedded(pg, degrees, e.emb, e.geom, it) }
      if (it.border) pg.drawRectangle({ x: it.x, y: it.y, width: it.w, height: it.h, borderColor: rgb(0.45, 0.45, 0.5), borderWidth: 0.6 })
    }
    for (const l of sh.lines || []) pg.drawLine({ start: { x: l.x1, y: l.y1 }, end: { x: l.x2, y: l.y2 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.66), dashArray: [4, 3] })
    onProgress?.((k + 1) / sheets.length, `Sheet ${k + 1} of ${sheets.length}`)
    if (k % 4 === 0) await yieldToMain()
  }
  const t = srcDoc.getTitle()
  if (t) out.setTitle(t)
  return out
}

/** pdf-lib helpers in one call: {PDFDocument, rgb, degrees, ...}. */
export const lib = () => pdfLib()

// ---------------------------------------------------------------------------------------------------------------------
// Sheet preview (imposition tools): positions in PDF points, y up
// ---------------------------------------------------------------------------------------------------------------------
/**
 * A to-scale picture of one sheet. items: [{x, y, w, h, page (1-based, or null for blank), label, border}]
 * sheetView(source, {w, h, items, width: 150}) -> element
 */
export function sheetView(s, { w, h: hh, items, width = 150, title, grid = false }) {
  const view = h('div', { class: 'pp-sheetview', style: { width: `${width}px`, aspectRatio: `${w} / ${hh}` } })
  items.forEach((it, i) => {
    const cell = h('div', {
      class: ['pp-cell', it.page == null && 'blank', it.border && 'bordered'],
      style: { left: `${(it.x / w) * 100}%`, top: `${(1 - (it.y + it.h) / hh) * 100}%`, width: `${(it.w / w) * 100}%`, height: `${(it.h / hh) * 100}%`, '--i': Math.min(i, 12) },
    })
    if (it.page != null) {
      pending.set(cell, () => s.thumbURL(it.page, 200).then((url) => cell.prepend(h('img', { src: url, alt: '', draggable: false })), () => {}))
      observer().observe(cell)
    }
    cell.append(h('span', { class: 'pp-cell-n' }, it.label ?? (it.page == null ? '' : it.page)))
    view.append(cell)
  })
  return h('figure', { class: 'pp-sheetwrap' }, view, title && h('figcaption', title))
}

/**
 * Analyse every page: scanAll(source, {max: 200, fn: (canvas, pageNo) => any, onProgress(frac, text), alive: () => bool})
 * -> [{page, result, url}] in page order. Stops early (returns what it has) when alive() turns false.
 */
export async function scanAll(s, { max = 200, fn, onProgress, alive = () => true } = {}) {
  await s.pageSizes()
  const out = new Array(s.pages)
  let done = 0
  const jobs = Array.from({ length: s.pages }, (_, i) => i + 1)
  const worker = async () => {
    while (jobs.length && alive()) {
      const n = jobs.shift()
      const r = await s.scan(n, max, (c) => fn(c, n))
      out[n - 1] = { page: n, ...r }
      done++
      onProgress?.(done / s.pages, `Page ${done} of ${s.pages}`)
      if (done % 8 === 0) await yieldToMain()
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return out
}

// ---------------------------------------------------------------------------------------------------------------------
// Result card
// ---------------------------------------------------------------------------------------------------------------------
/** Success card with a drawn check mark. doneCard({title, detail, actions: [Node]}) */
export function doneCard({ title = 'Done', detail, actions = [] }) {
  const check = h('svg', { viewBox: '0 0 52 52', class: 'pp-check', 'aria-hidden': 'true' },
    h('circle', { cx: 26, cy: 26, r: 23, fill: 'none' }), h('path', { d: 'M15 27.5l8 8 15-17', fill: 'none' }))
  return h('div', { class: 'pp-done', role: 'status' }, check,
    h('div', { class: 'pp-done-body' }, h('strong', title), detail && h('div', { class: 'small muted' }, detail)),
    h('div', { class: 'pp-done-actions' }, actions))
}

/** Horizontal bar list: bars([{label, value, text, color, hint}]) */
export function bars(items, { max } = {}) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value))
  return h('div', { class: 'pp-bars' }, items.map((it, i) => h('div', { class: 'pp-bar-row', style: { '--i': i } },
    h('div', { class: 'pp-bar-label' }, it.swatch && h('i', { style: { background: it.swatch } }), h('span', it.label)),
    h('div', { class: 'pp-bar-track' }, h('b', { style: { '--w': `${Math.max(it.value > 0 ? 1.5 : 0, (it.value / top) * 100)}%`, background: it.color || it.swatch || null } })),
    h('div', { class: 'pp-bar-val' }, it.text ?? it.value, it.hint && h('small', it.hint)))))
}

// ---------------------------------------------------------------------------------------------------------------------
// Outlines (bookmarks)
// ---------------------------------------------------------------------------------------------------------------------
/** Resolve a pdf.js destination (name or array) to a 0-based page index, or null. */
export async function destToPage(doc, dest) {
  try {
    let d = dest
    if (typeof d === 'string') d = await doc.getDestination(d)
    if (!Array.isArray(d) || !d.length) return null
    const ref = d[0]
    if (ref && typeof ref === 'object') return await doc.getPageIndex(ref)
    if (Number.isInteger(ref)) return ref
  } catch { /* unresolved destination */ }
  return null
}

/** Existing bookmarks as a tree: [{title, page (0-based or null), bold, italic, items}], or null if the PDF has none. */
export async function readOutline(doc) {
  const raw = await doc.getOutline()
  if (!raw?.length) return null
  const walk = async (items, depth = 0) => {
    const out = []
    for (const it of items) {
      out.push({ title: String(it.title || '').trim() || 'Untitled', page: await destToPage(doc, it.dest), url: it.url || null, bold: !!it.bold, italic: !!it.italic, items: depth < 8 ? await walk(it.items || [], depth + 1) : [] })
    }
    return out
  }
  return walk(raw)
}

// ---------------------------------------------------------------------------------------------------------------------
// Styles (one block, every rule scoped under .pp so nothing leaks)
// ---------------------------------------------------------------------------------------------------------------------
const CSS = `
.pp { --pp-paper: #fff; --pp-shadow: 0 1px 2px rgba(16,16,40,.1), 0 10px 22px -12px rgba(16,16,40,.4); --pp-line: color-mix(in srgb, var(--accent) 55%, transparent); }
:root[data-theme="dark"] .pp { --pp-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 12px 26px -12px rgba(0,0,0,.9); }
@keyframes pp-pop { from { opacity: 0; transform: translateY(14px) scale(.94); } }
@keyframes pp-shimmer { to { background-position: -200% 0; } }
@keyframes pp-fan { from { transform: rotate(0) translate(0, 0); } }
@keyframes pp-draw { to { stroke-dashoffset: 0; } }
@keyframes pp-ring { from { stroke-dashoffset: 150; } }
@keyframes pp-grow { from { width: 0; } }
@keyframes pp-slide { from { opacity: 0; transform: translateX(-10px); } }
.pp .pp-in { animation: pp-pop .55s var(--spring) both; animation-delay: calc(var(--i, 0) * 28ms); }

.pp .pp-source { display: flex; flex-direction: column; gap: 12px; }
.pp .pp-file, .pp .pp-pw {
  position: relative; display: flex; align-items: center; gap: 16px; padding: 14px 16px 14px 18px; border-radius: 20px; border: 1.5px solid transparent; overflow: hidden; isolation: isolate;
  background: linear-gradient(var(--surface), var(--surface)) padding-box, var(--brand) border-box; box-shadow: var(--shadow); animation: pp-pop .5s var(--spring) both;
}
.pp .pp-file::before, .pp .pp-pw::before { content: ""; position: absolute; inset: 0; z-index: -1; opacity: .55;
  background: radial-gradient(380px 120px at 0% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 70%), radial-gradient(300px 100px at 100% 100%, color-mix(in srgb, var(--accent-2) 12%, transparent), transparent 70%); }
.pp .pp-file-meta { flex: 1; min-width: 0; }
.pp .pp-file-name { font-weight: 600; font-size: 15.5px; letter-spacing: -.015em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pp .pp-file-sub { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
.pp .pp-chip { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 10px; border-radius: 999px; font-size: 12px; font-weight: 550; background: var(--accent-soft); color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent); white-space: nowrap; }
.pp .pp-chip.warn { background: var(--warning-soft); color: var(--warning); border-color: color-mix(in srgb, var(--warning) 25%, transparent); }
.pp .pp-chip.ok { background: var(--success-soft); color: var(--success); border-color: color-mix(in srgb, var(--success) 25%, transparent); }
.pp .pp-chip.bad { background: var(--danger-soft); color: var(--danger); border-color: color-mix(in srgb, var(--danger) 25%, transparent); }
.pp .pp-chip.plain { background: var(--surface-2); color: var(--text-2); border-color: var(--border); }
.pp .pp-stackicon { position: relative; width: 46px; height: 56px; flex: none; }
.pp .pp-stackicon i { position: absolute; inset: 0; border-radius: 8px; background: var(--surface); border: 1.5px solid var(--border-strong); display: grid; place-items: center; color: var(--accent); box-shadow: var(--shadow-sm); }
.pp .pp-stackicon i:nth-child(1) { transform: rotate(-9deg) translate(-4px, 1px); opacity: .55; animation: pp-fan .7s var(--spring) both; }
.pp .pp-stackicon i:nth-child(2) { transform: rotate(7deg) translate(4px, 0); opacity: .8; animation: pp-fan .7s .06s var(--spring) both; }
.pp .pp-stackicon i:nth-child(3) { background: linear-gradient(160deg, var(--surface), var(--accent-soft)); border-color: var(--accent); }
.pp .pp-stackicon .icon { width: 20px; height: 20px; }
.pp .pp-pw-icon { width: 46px; height: 46px; border-radius: 14px; display: grid; place-items: center; background: var(--warning-soft); color: var(--warning); flex: none; }
.pp .pp-pw-body { flex: 1; min-width: 0; }

.pp .pp-paper { position: relative; width: 100%; background: var(--pp-paper); border-radius: 5px; box-shadow: var(--pp-shadow); overflow: hidden; }
.pp .pp-paper img, .pp .pp-paper canvas { display: block; width: 100%; height: 100%; object-fit: contain; animation: pp-pop .4s var(--ease) both; user-select: none; -webkit-user-drag: none; }
.pp .pp-paper.pp-loading { background: linear-gradient(100deg, var(--surface-2) 30%, var(--surface-3) 50%, var(--surface-2) 70%) 100% 0 / 200% 100%; animation: pp-shimmer 1.3s linear infinite; }
.pp .pp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--min, 128px), 1fr)); gap: 14px; }
.pp .pp-masonry { columns: 5 150px; column-gap: 14px; }
.pp .pp-masonry > * { break-inside: avoid; margin-bottom: 14px; }
.pp .pp-card {
  position: relative; padding: 9px 9px 9px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow-sm); min-width: 0;
  transition: transform .3s var(--spring), border-color .2s, box-shadow .25s, opacity .25s, filter .25s;
}
.pp .pp-card[role="button"] { cursor: pointer; }
.pp .pp-card:hover { transform: translateY(-4px) rotate(-.4deg); box-shadow: var(--shadow); border-color: var(--border-strong); }
.pp .pp-card[data-state="on"] { border-color: var(--accent); box-shadow: 0 0 0 3px var(--ring), var(--shadow); }
.pp .pp-card[data-state="off"] { opacity: .5; filter: grayscale(.85); }
.pp .pp-card[data-state="bad"] { border-color: var(--danger); box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 22%, transparent); }
.pp .pp-card[data-state="good"] { border-color: var(--success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 22%, transparent); }
.pp .pp-num { position: absolute; left: 15px; top: 15px; min-width: 24px; height: 22px; padding: 0 7px; border-radius: 999px; display: grid; place-items: center; font-size: 11.5px; font-weight: 650; font-variant-numeric: tabular-nums;
  background: color-mix(in srgb, var(--surface) 78%, transparent); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border: 1px solid var(--border); color: var(--text); box-shadow: var(--shadow-sm); pointer-events: none; }
.pp .pp-tick { position: absolute; right: 14px; top: 14px; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: var(--accent); color: var(--accent-text); transform: scale(0); transition: transform .35s var(--spring); pointer-events: none; }
.pp .pp-tick .icon { width: 14px; height: 14px; stroke-width: 3; }
.pp .pp-card[data-state="on"] .pp-tick { transform: scale(1); }
.pp .pp-card[data-state="bad"] .pp-tick { background: var(--danger); transform: scale(1); }
.pp .pp-card[data-state="good"] .pp-tick { background: var(--success); transform: scale(1); }
.pp .pp-foot { display: flex; justify-content: space-between; gap: 6px; align-items: center; margin-top: 8px; font-size: 12px; color: var(--muted); min-width: 0; }
.pp .pp-foot > * { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.pp .pp-sheets { display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-start; }
.pp .pp-sheetwrap { margin: 0; display: flex; flex-direction: column; gap: 8px; align-items: center; max-width: 100%; animation: pp-pop .5s var(--spring) both; animation-delay: calc(var(--i, 0) * 45ms); }
.pp .pp-sheetwrap figcaption { font-size: 12px; font-weight: 550; color: var(--muted); text-align: center; }
.pp .pp-sheetview { position: relative; max-width: 100%; background: var(--pp-paper); border-radius: 3px; box-shadow: var(--pp-shadow); transition: transform .35s var(--spring); }
.pp .pp-sheetwrap:hover .pp-sheetview { transform: translateY(-3px) rotate(-.6deg); }
.pp .pp-cell { position: absolute; overflow: hidden; background: #f1f1f5; display: grid; place-items: center; animation: pp-pop .5s var(--ease) both; animation-delay: calc(var(--i, 0) * 30ms); }
.pp .pp-cell img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.pp .pp-cell.blank { background: repeating-linear-gradient(135deg, #f3f3f7 0 6px, #ebebf1 6px 12px); }
.pp .pp-cell.bordered { outline: 1px solid rgba(60,60,80,.45); outline-offset: -1px; }
.pp .pp-cell-n { position: absolute; right: 3px; bottom: 3px; font-size: 10px; font-weight: 700; line-height: 1; padding: 2px 4px; border-radius: 5px; background: rgba(20,20,35,.78); color: #fff; font-variant-numeric: tabular-nums; pointer-events: none; }
.pp .pp-cell-n:empty { display: none; }

.pp .pp-done { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 16px 18px; border-radius: 20px; border: 1px solid color-mix(in srgb, var(--success) 30%, var(--border));
  background: linear-gradient(120deg, color-mix(in srgb, var(--success) 10%, var(--surface)), var(--surface) 65%); animation: pp-pop .5s var(--spring) both; }
.pp .pp-check { width: 46px; height: 46px; flex: none; }
.pp .pp-check circle { stroke: var(--success); stroke-width: 3; stroke-dasharray: 150; animation: pp-ring .7s var(--ease) both; }
.pp .pp-check path { stroke: var(--success); stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 40; stroke-dashoffset: 40; animation: pp-draw .45s .35s var(--ease) forwards; }
.pp .pp-done-body { flex: 1; min-width: 200px; display: flex; flex-direction: column; gap: 2px; overflow-wrap: anywhere; }
.pp .pp-done-body strong { font-size: 16px; letter-spacing: -.015em; }
.pp .pp-done-actions { display: flex; gap: 8px; flex-wrap: wrap; }

.pp .pp-bars { display: flex; flex-direction: column; gap: 10px; }
.pp .pp-bar-row { display: grid; grid-template-columns: minmax(90px, 150px) 1fr minmax(70px, auto); gap: 12px; align-items: center; animation: pp-slide .5s var(--ease) both; animation-delay: calc(var(--i, 0) * 60ms); }
.pp .pp-bar-label { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 550; min-width: 0; }
.pp .pp-bar-label i { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.pp .pp-bar-label span { overflow: hidden; text-overflow: ellipsis; }
.pp .pp-bar-track { height: 12px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--border); overflow: hidden; }
.pp .pp-bar-track b { display: block; height: 100%; width: var(--w); border-radius: inherit; background: var(--brand); animation: pp-grow .9s var(--ease) both; animation-delay: calc(var(--i, 0) * 60ms + 120ms); }
.pp .pp-bar-val { font-size: 13px; font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
.pp .pp-bar-val small { display: block; color: var(--muted); font-size: 11.5px; }

.pp .pp-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pp .pp-toolbar .grow { flex: 1; min-width: 0; }
.pp .pp-hint { font-size: 12.5px; color: var(--muted); }
.pp .pp-section-title { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
.pp .pp-section-title .icon { width: 15px; height: 15px; color: var(--accent); }
.pp .pp-kv { display: grid; grid-template-columns: minmax(96px, 150px) 1fr; gap: 6px 14px; font-size: 13.5px; margin: 0; }
.pp .pp-kv dt { color: var(--muted); }
.pp .pp-kv dd { margin: 0; overflow-wrap: anywhere; min-width: 0; }
.pp mark.pp-hit { background: color-mix(in srgb, #facc15 55%, transparent); color: inherit; border-radius: 4px; padding: 0 2px; }
@media (max-width: 720px) {
  .pp .pp-file, .pp .pp-pw { gap: 12px; padding: 12px; }
  .pp .pp-bar-row { grid-template-columns: 1fr auto; }
  .pp .pp-bar-track { grid-column: 1 / -1; grid-row: 2; }
  .pp .pp-masonry { columns: 2 130px; column-gap: 10px; }
  .pp .pp-grid { --min: 104px; gap: 10px; }
}
@media (prefers-reduced-motion: reduce) {
  .pp .pp-in, .pp .pp-card, .pp .pp-sheetwrap, .pp .pp-cell { animation: none !important; }
  .pp .pp-check path { stroke-dashoffset: 0; }
}
`

/** Inject a <style> block once per id (tool-specific rules, always scoped under .pp). */
export function useStyle(id, css) {
  if (document.getElementById(id)) return
  document.head.append(h('style', { id, html: css }))
}
export const injectStyles = () => useStyle('pp-style', CSS)

/** Convenience: wrap content in the pack's root class. */
export const ppRoot = (...kids) => { injectStyles(); return h('div', { class: 'pp stack' }, kids) }

export { toast }
