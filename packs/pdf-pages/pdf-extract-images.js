// Extract images from a PDF: walks the pdf.js operator list (image paint operators, inline images, form XObjects),
// decodes each unique image, shows thumbnails with sizes and pages, and exports PNG / JPG files or a ZIP.
import { h, icon, button, busy, progress, field, select, segmented, stats, empty, clear, formatBytes, download, toast, yieldToMain } from '../../lib/ui.js'
import { zip, baseName, safeName } from '../../lib/files.js'
import { pdfjs } from '../../lib/libs.js'
import { toBlob } from '../../lib/image.js'
import { pdfSource, ppRoot, useStyle, whenVisible, compressRanges, countUp, doneCard } from './_shared.js'

const MAX_IMAGES = 1500
const MAX_PIXELS_EACH = 120_000_000

// 2D matrix helpers for working out how large an image is drawn on the page
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]

/** Decode a pdf.js image object (ImageBitmap or raw data) into a canvas. */
export function imageToCanvas(img, { mask = false } = {}) {
  const w = img.width, hh = img.height
  if (w * hh > MAX_PIXELS_EACH) throw new Error('too large')
  const c = document.createElement('canvas')
  c.width = w; c.height = hh
  const ctx = c.getContext('2d')
  if (img.bitmap) { ctx.drawImage(img.bitmap, 0, 0); return c }
  const d = img.data
  if (!d) throw new Error('no pixel data')
  const out = ctx.createImageData(w, hh)
  const px = out.data
  if (mask || img.isMask) {
    // 1 bit per pixel, a set bit means "not painted"
    const rowBytes = Math.ceil(w / 8)
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const bit = (d[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1
      const o = (y * w + x) * 4
      px[o] = px[o + 1] = px[o + 2] = 0
      px[o + 3] = bit ? 0 : 255
    }
  } else if (img.kind === 3 || d.length === w * hh * 4) {
    px.set(d.subarray ? d.subarray(0, px.length) : d)
  } else if (img.kind === 2 || d.length === w * hh * 3) {
    for (let i = 0, o = 0; i < w * hh; i++, o += 4) { px[o] = d[i * 3]; px[o + 1] = d[i * 3 + 1]; px[o + 2] = d[i * 3 + 2]; px[o + 3] = 255 }
  } else {
    // grayscale, 1 bit per pixel
    const rowBytes = Math.ceil(w / 8)
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const v = ((d[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1) * 255
      const o = (y * w + x) * 4
      px[o] = px[o + 1] = px[o + 2] = v; px[o + 3] = 255
    }
  }
  ctx.putImageData(out, 0, 0)
  return c
}

const hasAlpha = (c) => {
  const w = Math.min(c.width, 64), hh = Math.min(c.height, 64)
  const t = document.createElement('canvas'); t.width = w; t.height = hh
  const x = t.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0, w, hh)
  const d = x.getImageData(0, 0, w, hh).data
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true
  return false
}

/** Cheap fingerprint of a canvas (16 x 16 sample) used to merge identical inline images. */
const fingerprint = (c) => {
  const t = document.createElement('canvas'); t.width = t.height = 16
  const x = t.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0, 16, 16)
  const d = x.getImageData(0, 0, 16, 16).data
  let a = 2166136261
  for (let i = 0; i < d.length; i++) a = Math.imul(a ^ (d[i] >> 2), 16777619)
  return `${c.width}x${c.height}:${(a >>> 0).toString(36)}`
}

async function getObj(page, id) {
  const store = id.startsWith('g_') ? page.commonObjs : page.objs
  if (store.has(id)) return store.get(id)
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out')), 20000)
    store.get(id, (v) => { clearTimeout(t); resolve(v) })
  })
}

export function mount(root, { signal }) {
  const body = h('div', { class: 'stack' })
  let s
  let gen = 0
  const src = pdfSource({ onLoad: (source) => { s = source; return scan(source) }, onClear: () => { s = null; gen++; clear(body) } })

  async function scan(source) {
    const my = ++gen
    const alive = () => my === gen && !source.dead && !signal.aborted
    const lib = await pdfjs()
    const { OPS } = lib
    const prog = progress()
    const found = h('span', { class: 'pp-hint' }, '')
    clear(body, h('div', { class: 'row' }, h('span', { class: 'spinner' }), h('strong', 'Looking for images...'), found), prog.el)
    const images = []
    const byKey = new Map()
    const IMG_OPS = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat, OPS.paintJpegXObject].filter((x) => x != null))
    let skipped = 0

    for (let p = 1; p <= source.pages && alive(); p++) {
      prog.set((p - 1) / source.pages, `Page ${p} of ${source.pages}`)
      const page = await source.doc.getPage(p)
      const ol = await page.getOperatorList()
      let ctm = [1, 0, 0, 1, 0, 0]
      const stack = []
      for (let i = 0; i < ol.fnArray.length && alive(); i++) {
        const fn = ol.fnArray[i], a = ol.argsArray[i]
        if (fn === OPS.save) stack.push(ctm)
        else if (fn === OPS.restore) ctm = stack.pop() || ctm
        else if (fn === OPS.transform) ctm = mul(ctm, a)
        else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (a?.[0]) ctm = mul(ctm, a[0]) }
        else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm
        if (!IMG_OPS.has(fn)) continue
        if (images.length >= MAX_IMAGES) { skipped++; continue }
        try {
          const isMask = fn === OPS.paintImageMaskXObject
          const img = typeof a[0] === 'string' ? await getObj(page, a[0]) : a[0]
          if (!img?.width || !img?.height) continue
          const drawnW = Math.hypot(ctm[0], ctm[1]) || 0
          const dpi = drawnW > 1 ? Math.round(img.width / (drawnW / 72)) : null
          const key0 = img.ref ? `ref:${img.ref}` : typeof a[0] === 'string' ? `id:${a[0]}` : null
          if (key0 && byKey.has(key0)) { byKey.get(key0).pages.add(p); continue }
          const canvas = imageToCanvas(img, { mask: isMask })
          const key = key0 || fingerprint(canvas)
          if (byKey.has(key)) { byKey.get(key).pages.add(p); canvas.width = canvas.height = 0; continue }
          const alpha = hasAlpha(canvas)
          const blob = await toBlob(canvas, 'image/png')
          const t = document.createElement('canvas')
          const k = Math.min(1, 280 / Math.max(canvas.width, canvas.height))
          t.width = Math.max(1, Math.round(canvas.width * k)); t.height = Math.max(1, Math.round(canvas.height * k))
          const tctx = t.getContext('2d'); tctx.imageSmoothingQuality = 'high'; tctx.drawImage(canvas, 0, 0, t.width, t.height)
          const thumb = await toBlob(t, 'image/png')
          const rec = { n: images.length + 1, w: img.width, h: img.height, dpi, pages: new Set([p]), blob, alpha, ref: img.ref || null, canvasArea: canvas.width * canvas.height, thumbURL: URL.createObjectURL(thumb), selected: true }
          canvas.width = canvas.height = 0
          images.push(rec); byKey.set(key, rec)
          found.textContent = `${images.length} found`
        } catch (e) {
          console.warn('image skipped', e)
          skipped++
        }
      }
      page.cleanup()
      await yieldToMain()
    }
    if (!alive()) { for (const r of images) URL.revokeObjectURL(r.thumbURL); return }
    prog.hide()
    show(images, skipped, source)
  }

  function show(images, skipped, source) {
    const stem = baseName(source.name)
    if (!images.length) {
      clear(body, empty('No embedded images in this PDF. Text and vector drawings are not images. To save pages as pictures, use PDF to JPG / PNG.', 'image-off'))
      return
    }
    const state = { min: 32, fmt: 'png', jpgQ: 0.92 }
    const cards = h('div', { class: 'pp-masonry pp-img-grid' })
    const info = h('div')
    const result = h('div')
    const prog = progress()
    const dlBtn = button('Download', { icon: 'download', variant: 'primary', size: 'lg' })
    const visible = () => images.filter((r) => Math.min(r.w, r.h) >= state.min)
    const chosen = () => visible().filter((r) => r.selected)
    const nameOf = (r) => {
      const pg = compressRanges([...r.pages]).replace(/, /g, '_')
      return safeName(`${stem}-img${String(r.n).padStart(2, '0')}-p${pg}.${state.fmt === 'png' || r.alpha ? 'png' : 'jpg'}`)
    }

    async function encode(r) {
      if (state.fmt === 'png' || r.alpha) return r.blob
      // JPG: flatten on white
      const bmp = await createImageBitmap(r.blob)
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0)
      bmp.close()
      const b = await toBlob(c, 'image/jpeg', state.jpgQ)
      c.width = c.height = 0
      return b
    }

    function updateInfo() {
      const vis = visible(), sel = chosen()
      const total = sel.reduce((a, r) => a + r.blob.size, 0)
      const st = stats([
        { label: 'Unique images', value: h('span', { 'data-n': images.length }, '0'), accent: true, hint: skipped ? `${skipped} could not be read` : null },
        { label: 'Shown', value: String(vis.length), hint: state.min ? `at least ${state.min} px` : 'all sizes' },
        { label: 'Selected', value: String(sel.length), hint: `${formatBytes(total)} as PNG` },
      ])
      for (const el of st.querySelectorAll('[data-n]')) { if (!updateInfo.done) countUp(el, +el.dataset.n, { ms: 500 }); else el.textContent = el.dataset.n }
      updateInfo.done = true
      clear(info, st)
      dlBtn.querySelector('span').textContent = sel.length === 1 ? 'Download image' : `Download ${sel.length} images (ZIP)`
      dlBtn.disabled = sel.length === 0
    }

    const oneBtn = (r) => {
      const b = button('', { icon: 'download', variant: 'ghost', size: 'sm', ariaLabel: `Download image ${r.n}`, onClick: async (e) => { e.stopPropagation(); download(await encode(r), nameOf(r)) } })
      b.classList.add('pp-one')
      return b
    }

    function renderCards() {
      clear(cards, visible().map((r, i) => {
        const card = h('div', { class: 'pp-card pp-in', role: 'button', tabindex: 0, 'data-state': r.selected ? 'on' : 'off', style: { '--i': Math.min(i, 24) }, 'aria-label': `Image ${r.n}, ${r.w} by ${r.h}` },
          h('div', { class: 'pp-paper pp-imgpaper', style: { aspectRatio: `${r.w} / ${r.h}` } }, h('img', { src: r.thumbURL, alt: '', draggable: false })),
          h('span', { class: 'pp-num' }, r.n), h('span', { class: 'pp-tick' }, icon('check')),
          h('div', { class: 'pp-foot' }, h('span', `${r.w} x ${r.h}`), h('span', formatBytes(r.blob.size))),
          h('div', { class: 'pp-foot' }, h('span', `p. ${compressRanges([...r.pages])}`), h('span', r.dpi ? `${r.dpi} dpi` : (r.alpha ? 'transparent' : ''))),
          oneBtn(r))
        const flip = () => { r.selected = !r.selected; card.dataset.state = r.selected ? 'on' : 'off'; updateInfo() }
        card.addEventListener('click', flip)
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip() } })
        return card
      }))
    }

    dlBtn.addEventListener('click', () => busy(dlBtn, async () => {
      clear(result)
      const sel = chosen()
      if (sel.length === 1) { const b = await encode(sel[0]); download(b, nameOf(sel[0])); return }
      const files = []
      for (let i = 0; i < sel.length; i++) {
        files.push({ name: nameOf(sel[i]), data: await encode(sel[i]) })
        prog.set((i + 1) / sel.length, `Preparing ${i + 1} of ${sel.length}`)
        if (i % 4 === 0) await yieldToMain()
      }
      const blob = await zip(files)
      download(blob, `${stem}-images.zip`)
      clear(result, doneCard({ title: `${files.length} images saved`, detail: `${formatBytes(blob.size)} ZIP.` }))
    }, { label: 'Packing', errorTo: result, progress: prog }))

    const minEl = select([[0, 'All sizes'], [32, 'Hide under 32 px'], [64, 'Hide under 64 px'], [128, 'Hide under 128 px'], [256, 'Hide under 256 px'], [512, 'Hide under 512 px']], state.min, (v) => { state.min = +v; renderCards(); updateInfo() })
    const fmtEl = segmented([['png', 'PNG (lossless)'], ['jpg', 'JPG']], 'png', (v) => { state.fmt = v }, 'Format')
    clear(body, info,
      h('div', { class: 'pp-toolbar' },
        field('Size filter', minEl), field('Save as', fmtEl), h('span', { class: 'grow' }),
        button('Select all', { variant: 'ghost', size: 'sm', onClick: () => { visible().forEach((r) => { r.selected = true }); renderCards(); updateInfo() } }),
        button('None', { variant: 'ghost', size: 'sm', onClick: () => { visible().forEach((r) => { r.selected = false }); renderCards(); updateInfo() } })),
      h('div', { class: 'pp-hint' }, 'Click an image to select it. JPG puts transparent images on white and keeps transparent ones as PNG. dpi is how sharp the image is at its printed size.'),
      cards, h('div', { class: 'row' }, dlBtn), prog.el, result)
    renderCards(); updateInfo()
    source.onDestroy(() => { for (const r of images) URL.revokeObjectURL(r.thumbURL) })
  }

  useStyle('pp-style-images', CSS)
  root.append(ppRoot(src.el, body))
}

const CSS = `
.pp .pp-img-grid { columns: 4 190px; }
.pp .pp-imgpaper { background: var(--checker); }
.pp .pp-imgpaper img { object-fit: contain; }
.pp .pp-one { position: absolute; right: 10px; bottom: 44px; background: color-mix(in srgb, var(--surface) 85%, transparent); backdrop-filter: blur(6px); opacity: 0; transition: opacity .2s; }
.pp .pp-card:hover .pp-one, .pp .pp-one:focus-visible { opacity: 1; }
@media (hover: none) { .pp .pp-one { opacity: 1; } }
`
