// JPG / PNG to PDF, and Photo to PDF (params.scan: document-scan filters). Page size, orientation, margins, fit or fill,
// reorderable images, HEIC accepted. JPEG and PNG are embedded untouched when possible, so quality is never lost needlessly.
import { h, button, busy, progress, alert, segmented, select, field, input, rangeField, toggle, dropzone, fileList, split, formatBytes, debounce, clear, onCleanup, yieldToMain, download, fileType, icon } from '../../lib/ui.js'
import { pdfLib } from '../../lib/libs.js'
import { loadImage, toCanvas, fitSize, toBlob, MAX_PIXELS } from '../../lib/image.js'
import { PAGE_SIZES, savePdf } from '../../lib/pdf.js'
import { baseName } from '../../lib/files.js'
import { scanFilter, documentBounds, cropCanvas } from './_scan.js'
import { useStyles, flow, step, options, done, note, beforeAfter, secs, plural, checkAbort } from './_shared.js'

const MM = 72 / 25.4
const QUALITY = { original: { label: 'Original', max: Infinity, q: 0.92 }, high: { label: 'High', max: 3200, q: 0.9 }, medium: { label: 'Medium', max: 2200, q: 0.78 }, small: { label: 'Small', max: 1400, q: 0.62 } }

/** EXIF orientation (1-8) of a JPEG, or 1. Browsers apply it when drawing, raw embedding does not. */
export function jpegOrientation(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1
  let i = 2
  while (i + 4 < b.length && b[i] === 0xff) {
    const marker = b[i + 1], len = (b[i + 2] << 8) | b[i + 3]
    if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      const t = i + 10, le = b[t] === 0x49
      const u16 = (o) => (le ? b[t + o] | (b[t + o + 1] << 8) : (b[t + o] << 8) | b[t + o + 1])
      const u32 = (o) => (le ? (b[t + o] | (b[t + o + 1] << 8) | (b[t + o + 2] << 16) | (b[t + o + 3] << 24)) >>> 0 : ((b[t + o] << 24) | (b[t + o + 1] << 16) | (b[t + o + 2] << 8) | b[t + o + 3]) >>> 0)
      const ifd = u32(4)
      const n = u16(ifd)
      for (let k = 0; k < n; k++) if (u16(ifd + 2 + k * 12) === 0x0112) return u16(ifd + 2 + k * 12 + 8) || 1
      return 1
    }
    if (marker === 0xda) break
    i += 2 + len
  }
  return 1
}

/** Where the image goes on its page (PDF points, origin bottom-left). Shared by the live preview and the PDF writer. */
export function planPage(iw, ih, o) {
  const m = o.margin * MM
  if (o.size === 'fit') {
    const k = Math.min(0.75, 1400 / Math.max(iw, ih))
    return { pw: iw * k + 2 * m, ph: ih * k + 2 * m, x: m, y: m, w: iw * k, h: ih * k, clip: null }
  }
  let [W, H] = PAGE_SIZES[o.size]
  if (o.orient === 'landscape' || (o.orient === 'auto' && iw > ih)) [W, H] = [H, W]
  const aw = Math.max(10, W - 2 * m), ah = Math.max(10, H - 2 * m)
  const s = o.fit === 'fill' ? Math.max(aw / iw, ah / ih) : Math.min(aw / iw, ah / ih)
  const w = iw * s, hh = ih * s
  return { pw: W, ph: H, x: (W - w) / 2, y: (H - hh) / 2, w, h: hh, clip: o.fit === 'fill' ? { x: m, y: m, w: aw, h: ah } : null }
}

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
const naturalSort = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })

export function mount(root, { params, signal }) {
  const scan = !!params.scan
  useStyles({ id: 'itp', css: `
    .t-itp .strip { display: flex; gap: 14px; overflow-x: auto; padding: 8px 4px 14px; scroll-snap-type: x proximity; }
    .t-itp .strip figure { margin: 0; flex: none; scroll-snap-align: start; display: flex; flex-direction: column; gap: 6px; align-items: center; font-size: 12px; color: var(--muted); cursor: pointer; border-radius: 6px; transition: transform .3s var(--spring); }
    .t-itp .strip figure:hover { transform: translateY(-4px); }
    .t-itp .strip canvas { display: block; background: #fff; border-radius: 3px; box-shadow: 0 10px 22px -10px rgba(0,0,0,.5), 0 0 0 1px var(--border); max-height: 170px; width: auto; }
    .t-itp .strip figure[aria-current="true"] canvas { box-shadow: 0 10px 22px -10px var(--accent), 0 0 0 2px var(--accent); }
    .t-itp .cv-color { width: 100%; padding: 3px; height: 42px; cursor: pointer; }
    .t-itp .cv-ba canvas { max-height: 460px; }` })

  const S = { size: 'A4', orient: 'auto', margin: scan ? 6 : 10, fit: 'fit', quality: scan ? 'high' : 'original', bg: '#ffffff', filter: scan ? 'enhance' : 'none', crop: true, contrast: 30, brightness: 0, threshold: 150, name: '' }
  const fl = flow(scan ? 'img' : 'jpg', 'pdf', scan ? 'Scan mode' : undefined)
  const prog = progress()
  const result = h('div', { class: 'stack' })
  const cache = new Map() // File -> Promise<canvas> (decoded at <= 900 px for previews)
  const small = (f) => {
    if (!cache.has(f)) cache.set(f, loadImage(f).then((img) => { const { width, height } = fitSize(img.naturalWidth, img.naturalHeight, 900, 900); return toCanvas(img, width, height, { background: '#ffffff' }) }))
    return cache.get(f)
  }

  // ----- step 1: images
  const list = fileList({ onChange: () => { onFilesChanged() } })
  const zone = dropzone({ accept: 'image/*,.heic,.heif,.avif,.jpg,.jpeg,.png,.webp', multiple: true, icon: 'images',
    label: scan ? 'Drop photos or scans here, or click to choose' : 'Drop images here, or click to choose', hint: 'JPG, PNG, WebP, GIF, AVIF, BMP and iPhone HEIC · or paste with Ctrl+V', onFiles: (fs) => list.add(fs) })
  const sortBtn = button('Sort A-Z', { icon: 'arrow-down-a-z', size: 'sm', variant: 'ghost', onClick: () => list.set([...list.files].sort(naturalSort)) })
  const revBtn = button('Reverse', { icon: 'arrow-up-down', size: 'sm', variant: 'ghost', onClick: () => list.set([...list.files].reverse()) })
  const clearBtn = button('Clear all', { icon: 'trash-2', size: 'sm', variant: 'ghost', onClick: () => list.set([]) })
  const listBar = h('div', { class: 'row', hidden: true }, sortBtn, revBtn, clearBtn, h('span', { class: 'cv-sub', style: 'margin-left:auto' }, 'Drag to reorder, or use the arrows'))

  // ----- step 2: options
  const sizeSel = select([['A4', 'A4'], ['Letter', 'US Letter'], ['Legal', 'US Legal'], ['A3', 'A3'], ['A5', 'A5'], ['fit', 'Same as image']], S.size, (v) => { S.size = v; sync(); redraw() })
  const orientSeg = segmented([['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], S.orient, (v) => { S.orient = v; redraw() }, 'Orientation')
  const marginSeg = segmented([[0, 'None'], [6, 'Small'], [10, 'Medium'], [20, 'Large']], S.margin, (v) => { S.margin = +v; redraw() }, 'Margin')
  const fitSeg = segmented([['fit', 'Fit inside'], ['fill', 'Fill page']], S.fit, (v) => { S.fit = v; redraw() }, 'Image fit')
  const qualSel = select(Object.entries(QUALITY).map(([k, q]) => [k, q.label + (k === 'original' ? ' (no recompression)' : '')]), S.quality, (v) => { S.quality = v })
  const bgInput = h('input', { type: 'color', class: 'input cv-color', value: S.bg, 'aria-label': 'Page colour', oninput: (e) => { S.bg = e.target.value; redraw() } })
  const nameInput = input({ placeholder: scan ? 'scan.pdf' : 'images.pdf', 'aria-label': 'File name', oninput: (e) => { S.name = e.target.value } })

  const filterSeg = segmented([['none', 'Original'], ['enhance', 'Enhance'], ['gray', 'Grayscale'], ['bw', 'Black and white']], S.filter, (v) => { S.filter = v; sync(); redraw() }, 'Scan filter')
  const contrastR = rangeField('Contrast', { min: -100, max: 100, value: S.contrast, format: (v) => (v > 0 ? `+${v}` : v), onInput: (v) => { S.contrast = v; redraw() } })
  const brightR = rangeField('Brightness', { min: -100, max: 100, value: S.brightness, format: (v) => (v > 0 ? `+${v}` : v), onInput: (v) => { S.brightness = v; redraw() } })
  const thrR = rangeField('Threshold', { min: 90, max: 210, value: S.threshold, onInput: (v) => { S.threshold = v; redraw() }, hint: 'Higher keeps more detail, lower removes more grey.' })
  const cropTog = toggle('Crop to the page automatically', S.crop, (v) => { S.crop = v; redraw() })
  const scanBox = h('div', { class: 'stack' }, cropTog, field('Scan filter', filterSeg, 'Removes shadows and the yellow cast of indoor light, whitens the paper and sharpens the text.'),
    h('div', { class: 'cv-opts' }, contrastR, brightR, thrR))
  const baHost = h('div')

  function sync() {
    const fit = S.size === 'fit'
    orientSeg.closest('.field').hidden = fit
    fitSeg.closest('.field').hidden = fit
    thrR.hidden = S.filter !== 'bw'
    contrastR.hidden = S.filter === 'none' || S.filter === 'bw'
    brightR.hidden = S.filter === 'none'
  }

  // ----- live preview strip
  const strip = h('div', { class: 'strip', role: 'list', 'aria-label': 'Page preview' })
  let selected = 0, drawToken = 0
  /** Crop to the paper (scan mode) then apply the scan filter. `unfiltered` keeps only the crop. */
  const prepare = (c, { unfiltered = false } = {}) => {
    let out = c
    if (scan && S.crop) { const r = documentBounds(c); if (r) out = cropCanvas(c, r) }
    if (!unfiltered && scan && S.filter !== 'none') out = scanFilter(out, S.filter, filterParams())
    return out
  }
  const filterParams = () => ({ contrast: S.contrast / 100, brightness: S.brightness / 100, threshold: S.threshold })
  const redraw = debounce(async () => {
    const token = ++drawToken
    const files = list.files
    if (!files.length) { clear(strip); clear(baHost); return }
    const frag = []
    for (let i = 0; i < Math.min(files.length, 60); i++) {
      let c
      try { c = await small(files[i]) } catch { frag.push(h('figure', { role: 'listitem' }, h('div', { class: 'cv-chip warn' }, 'Unreadable'), h('span', String(i + 1)))); continue }
      if (token !== drawToken) return
      let src = c
      if (scan && (S.crop || S.filter !== 'none')) src = prepare(toCanvas(c, ...Object.values(fitSize(c.width, c.height, 360, 360)), { background: '#fff' }))
      const plan = planPage(src.width, src.height, S)
      const k = 150 / plan.ph
      const page = document.createElement('canvas')
      page.width = Math.max(40, Math.round(plan.pw * k)); page.height = 150
      const g = page.getContext('2d')
      g.fillStyle = S.bg; g.fillRect(0, 0, page.width, page.height)
      g.save()
      if (plan.clip) { g.beginPath(); g.rect(plan.clip.x * k, (plan.ph - plan.clip.y - plan.clip.h) * k, plan.clip.w * k, plan.clip.h * k); g.clip() }
      g.drawImage(src, plan.x * k, (plan.ph - plan.y - plan.h) * k, plan.w * k, plan.h * k)
      g.restore()
      const idx = i
      const fig = h('figure', { role: 'listitem', 'aria-current': String(idx === selected), tabindex: 0, onclick: () => { selected = idx; redraw() }, onkeydown: (e) => { if (e.key === 'Enter') { selected = idx; redraw() } } }, page, h('span', `Page ${i + 1}`))
      frag.push(fig)
      await yieldToMain()
    }
    if (token !== drawToken) return
    if (files.length > 60) frag.push(h('figure', h('span', `+${files.length - 60} more`)))
    clear(strip, frag)
    if (scan && (S.filter !== 'none' || S.crop)) {
      const f = files[Math.min(selected, files.length - 1)]
      try {
        const orig = await small(f)
        const before = prepare(orig, { unfiltered: true })
        const after = prepare(orig)
        if (token !== drawToken) return
        clear(baHost, beforeAfter(before === orig ? cloneCanvas(before) : before, after, ['Original', 'Scanned']))
      } catch { /* preview only */ }
    } else clear(baHost)
  }, 160)
  const cloneCanvas = (c) => { const n = document.createElement('canvas'); n.width = c.width; n.height = c.height; n.getContext('2d').drawImage(c, 0, 0); return n }

  function onFilesChanged() {
    const n = list.files.length
    zone.classList.toggle('compact', n > 0)
    listBar.hidden = n === 0
    sortBtn.disabled = revBtn.disabled = n < 2
    if (n) { s2.unlock(); s3.unlock() } else { s2.lock(); s3.lock() }
    selected = Math.min(selected, Math.max(0, n - 1))
    createBtn.disabled = !n
    for (const k of [...cache.keys()]) if (!list.files.includes(k)) cache.delete(k)
    clear(result)
    fl.state('idle')
    redraw()
  }

  // ----- build the PDF
  async function build() {
    const files = [...list.files]
    const { PDFDocument, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = await pdfLib()
    const out = await PDFDocument.create()
    const q = QUALITY[S.quality]
    const [br, bgc, bb] = hexToRgb(S.bg)
    const filtered = scan && S.filter !== 'none'
    const t0 = performance.now()
    for (let i = 0; i < files.length; i++) {
      checkAbort(signal)
      prog.set(i / files.length, `Adding ${files[i].name} (${i + 1} of ${files.length})`)
      const f = files[i]
      const type = fileType(f)
      let emb = null
      const direct = S.quality === 'original' && !filtered && !(scan && S.crop)
      if (direct && (type === 'image/jpeg' || type === 'image/png')) {
        const bytes = new Uint8Array(await f.arrayBuffer())
        try {
          if (type === 'image/jpeg' && jpegOrientation(bytes) <= 1) emb = await out.embedJpg(bytes)
          else if (type === 'image/png') emb = await out.embedPng(bytes)
        } catch { emb = null }
      }
      if (!emb) {
        let img
        try { img = await loadImage(f) } catch (e) { throw new Error(`${f.name}: ${e.message}`) }
        const { width, height } = fitSize(img.naturalWidth, img.naturalHeight, q.max, q.max)
        let c = toCanvas(img, width, height, { background: S.bg })
        let mime = 'image/jpeg', quality = q.q
        if (scan && S.crop) { const r = documentBounds(c); if (r) c = cropCanvas(c, r) }
        if (filtered) {
          const fc = scanFilter(c, S.filter, filterParams())
          c.width = c.height = 0
          c = fc
          if (S.filter === 'bw') { mime = 'image/png' }
        }
        const blob = await toBlob(c, mime, quality)
        emb = mime === 'image/png' ? await out.embedPng(await blob.arrayBuffer()) : await out.embedJpg(await blob.arrayBuffer())
        c.width = c.height = 0
      }
      const plan = planPage(emb.width, emb.height, S)
      const page = out.addPage([plan.pw, plan.ph])
      if (S.bg.toLowerCase() !== '#ffffff') page.drawRectangle({ x: 0, y: 0, width: plan.pw, height: plan.ph, color: rgb(br, bgc, bb) })
      if (plan.clip) page.pushOperators(pushGraphicsState(), rectangle(plan.clip.x, plan.clip.y, plan.clip.w, plan.clip.h), clip(), endPath())
      page.drawImage(emb, { x: plan.x, y: plan.y, width: plan.w, height: plan.h })
      if (plan.clip) page.pushOperators(popGraphicsState())
      await yieldToMain()
    }
    out.setTitle(S.name.replace(/\.pdf$/i, '') || baseName(files[0].name))
    out.setProducer('Tools (browser)')
    prog.set(1, 'Saving')
    const blob = await savePdf(out)
    return { blob, pages: out.getPageCount(), ms: performance.now() - t0 }
  }

  const createBtn = button(scan ? 'Create scanned PDF' : 'Create PDF', { icon: 'file-plus-2', variant: 'primary', size: 'lg', disabled: true })
  createBtn.addEventListener('click', () => busy(createBtn, async () => {
    fl.state('working')
    clear(result)
    try {
      const { blob, pages, ms } = await build()
      const fname = (S.name.trim() || (list.files.length === 1 ? baseName(list.files[0].name) : scan ? 'scan' : 'images')).replace(/\.pdf$/i, '') + '.pdf'
      const url = URL.createObjectURL(blob)
      onCleanup(() => URL.revokeObjectURL(url))
      done(result, {
        flowEl: fl, title: 'Your PDF is ready', stats: [plural(pages, 'page'), formatBytes(blob.size), secs(ms)],
        actions: [button('Download PDF', { icon: 'download', variant: 'primary', size: 'lg', onClick: () => download(blob, fname) }), button('Preview', { icon: 'external-link', onClick: () => window.open(url, '_blank', 'noopener') })],
      })
    } catch (e) { fl.state('idle'); throw e }
  }, { label: 'Building PDF', errorTo: result, progress: prog }))

  const layoutOpts = options(field('Page size', sizeSel), field('Orientation', orientSeg), field('Margin', marginSeg), field('Image fit', fitSeg), field('Image quality', qualSel),
    field('Page colour', bgInput, 'Shows around images and behind transparent PNGs.'), field('File name', nameInput))
  const s1 = step(1, scan ? 'Add your photos' : 'Add your images', h('div', { class: 'stack' }, zone, list.el, listBar))
  const s2 = step(2, scan ? 'Clean up and layout' : 'Page layout', h('div', { class: 'stack' }, scan ? scanBox : null, scan ? baHost : null, layoutOpts,
    h('div', { class: 'stack tight' }, h('div', { class: 'field-label' }, 'Page preview'), h('div', { class: 'preview', style: 'background:var(--surface-2); justify-content:start; padding:6px 14px' }, strip))), { locked: true })
  const s3 = step(3, 'Create the PDF', h('div', { class: 'stack' }, h('div', { class: 'row' }, createBtn, note(scan ? 'Photos stay on your device. Shadow removal runs locally.' : 'Images are embedded as they are whenever possible. Nothing is uploaded.', 'shield-check')), prog.el, result), { locked: true })
  sync()
  root.append(h('div', { class: 'cv t-itp' }, fl, s1, s2, s3))
  onCleanup(() => cache.clear())
}
