// Change background: reuse the cutout mask and place the subject on a color, gradient, blurred copy of the photo,
// another photo, or nothing. Serves change-background, white-background and blur-background.
import { h, icon, button, busy, segmented, rangeField, toast, downloadButton, download, progress, dropzone, clear, formatBytes } from '../../lib/ui.js'
import { suffixName, zip } from '../../lib/files.js'
import { canvas as makeCanvas, loadImage, toCanvas } from '../../lib/image.js'
import { canvasBlob, fitCanvas, gaussU8, handoff, ctxOf } from './_ml.js'
import { subjects, modelSection, edgesSection, PREV_MAX } from './_subject.js'
import { subjectStudio } from './_studio.js'
import { shell, panelOf, section, swatches, devicePill, doneCard, note, drag } from './_ui.js'

export const COLORS = ['#ffffff', '#f3f4f6', '#d1d5db', '#111118', '#ef4444', '#f97316', '#eab308', '#22c55e', '#0ea5e9', '#6366f1', '#d946ef']
export const GRADIENTS = [
  { id: 'sunset', name: 'Sunset', a: '#ff9a9e', b: '#fecfef', angle: 135 },
  { id: 'ocean', name: 'Ocean', a: '#2193b0', b: '#6dd5ed', angle: 160 },
  { id: 'violet', name: 'Violet', a: '#8e2de2', b: '#4a00e0', angle: 135 },
  { id: 'mint', name: 'Mint', a: '#d4fc79', b: '#96e6a1', angle: 120 },
  { id: 'peach', name: 'Peach', a: '#ffecd2', b: '#fcb69f', angle: 150 },
  { id: 'midnight', name: 'Midnight', a: '#0f2027', b: '#2c5364', angle: 160 },
  { id: 'studio', name: 'Studio', a: '#ffffff', b: '#c9d3e6', angle: 180 },
  { id: 'fire', name: 'Fire', a: '#f12711', b: '#f5af19', angle: 135 },
]
export const RATIOS = [['original', 'Original'], ['1:1', '1:1'], ['4:5', '4:5'], ['16:9', '16:9'], ['9:16', '9:16']]

/** Canvas size for a ratio key, keeping the longest side at `long`. */
export function ratioSize(key, ow, oh, long) {
  if (key === 'original') { const s = long / Math.max(ow, oh); return [Math.max(1, Math.round(ow * s)), Math.max(1, Math.round(oh * s))] }
  const [a, b] = key.split(':').map(Number)
  const r = a / b
  return r >= 1 ? [long, Math.max(1, Math.round(long / r))] : [Math.max(1, Math.round(long * r)), long]
}

/** Start and end points of a CSS-style linear gradient of `angle` degrees (0 = to top, 90 = to right) over W x H. */
export function gradientLine(angle, W, H) {
  const t = (angle * Math.PI) / 180
  const vx = Math.sin(t), vy = -Math.cos(t)
  const L = (Math.abs(W * vx) + Math.abs(H * vy)) / 2
  return [W / 2 - vx * L, H / 2 - vy * L, W / 2 + vx * L, H / 2 + vy * L]
}

/** Source rectangle that covers (cover-fits) a W x H box. */
export function coverRect(sw, sh, W, H) {
  const s = Math.max(W / sw, H / sh)
  return [(W - sw * s) / 2, (H - sh * s) / 2, sw * s, sh * s]
}

function blurredCover(src, W, H, strength) {
  const k = Math.min(1, 480 / Math.max(W, H))
  const w = Math.max(2, Math.round(W * k)), hh = Math.max(2, Math.round(H * k))
  const c = makeCanvas(w, hh)
  const cx = ctxOf(c)
  const [x, y, dw, dh] = coverRect(src.width, src.height, w, hh)
  cx.drawImage(src, x, y, dw, dh)
  const id = cx.getImageData(0, 0, w, hh)
  const sigma = 0.6 + (strength / 100) * 16
  for (let ch = 0; ch < 3; ch++) {
    const plane = new Uint8ClampedArray(w * hh)
    for (let i = 0; i < plane.length; i++) plane[i] = id.data[i * 4 + ch]
    const b = gaussU8(plane, w, hh, sigma)
    for (let i = 0; i < b.length; i++) id.data[i * 4 + ch] = b[i]
  }
  cx.putImageData(id, 0, 0)
  return c
}

/**
 * Draw the new picture: background + subject.
 * spec: {bg: {kind, color, grad:{a,b,angle}, blur, photo, photoBlur}, scale (percent), shadow (0..100), trimmed (bool), dx, dy (fractions of the canvas)}
 * cut: cutout canvas (trimmed to the subject when spec.trimmed), src: the original photo canvas
 */
export function compose(spec, cut, src, W, H) {
  const c = makeCanvas(W, H)
  const ctx = c.getContext('2d')
  const bg = spec.bg
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  if (bg.kind === 'color') { ctx.fillStyle = bg.color; ctx.fillRect(0, 0, W, H) }
  else if (bg.kind === 'gradient') {
    const [x0, y0, x1, y1] = gradientLine(bg.grad.angle, W, H)
    const g = ctx.createLinearGradient(x0, y0, x1, y1)
    g.addColorStop(0, bg.grad.a); g.addColorStop(1, bg.grad.b)
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  } else if (bg.kind === 'blur') {
    const b = blurredCover(src, W, H, bg.blur)
    ctx.drawImage(b, 0, 0, W, H)
  } else if (bg.kind === 'photo') {
    if (bg.photo) {
      const base = bg.photoBlur > 0 ? blurredCover(bg.photo, W, H, bg.photoBlur) : null
      if (base) ctx.drawImage(base, 0, 0, W, H)
      else { const [x, y, dw, dh] = coverRect(bg.photo.width, bg.photo.height, W, H); ctx.drawImage(bg.photo, x, y, dw, dh) }
    } else { ctx.fillStyle = '#e5e7eb'; ctx.fillRect(0, 0, W, H) }
  }
  const fitFrac = spec.trimmed ? 0.84 : 1
  const s = Math.min(W / cut.width, H / cut.height) * fitFrac * (spec.scale / 100)
  const dw = cut.width * s, dh = cut.height * s
  const x = (W - dw) / 2 + spec.dx * W, y = (H - dh) / 2 + spec.dy * H
  if (spec.shadow > 0) {
    ctx.save()
    ctx.shadowColor = `rgba(8, 10, 24, ${0.18 + spec.shadow / 100 * 0.42})`
    ctx.shadowBlur = (spec.shadow / 100) * 0.05 * Math.max(W, H) + 2
    ctx.shadowOffsetY = (spec.shadow / 100) * 0.022 * Math.max(W, H)
    ctx.drawImage(cut, x, y, dw, dh)
    ctx.restore()
  } else ctx.drawImage(cut, x, y, dw, dh)
  return c
}

export function mount(root, { params, signal }) {
  const preset = params.mode || ''
  const q = subjects({ model: 'balanced' })
  const spec = {
    bg: {
      kind: preset === 'blur' ? 'blur' : preset === 'white' ? 'color' : 'gradient',
      color: '#ffffff', grad: { ...GRADIENTS[0] }, blur: 60, photo: null, photoName: '', photoBlur: 0,
    },
    scale: 100, shadow: preset === 'white' ? 22 : 0, ratio: 'original', dx: 0, dy: 0,
  }
  const out = { fmt: 'jpg', quality: 92 }
  const effFmt = () => (spec.bg.kind === 'transparent' && out.fmt === 'jpg' ? 'png' : out.fmt)
  const mimeOf = (f) => ({ jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[f])
  const word = { white: 'White background', blur: 'Blurred background' }[preset] || 'Background changed'

  const outName = (it) => suffixName(it.name, preset === 'white' ? 'white-bg' : preset === 'blur' ? 'blur-bg' : 'new-bg', effFmt())

  const itemSpec = (it) => ({ ...spec, dx: it.dx || 0, dy: it.dy || 0, trimmed: spec.ratio !== 'original' })

  function renderPreview(it, cv) {
    const p = it.prev
    const spc = itemSpec(it)
    const cut = q.previewCutout(it, { trim: spc.trimmed })
    const [W, H] = spc.trimmed ? ratioSize(spec.ratio, p.width, p.height, PREV_MAX) : [p.width, p.height]
    const res = compose(spc, cut, p.canvas, W, H)
    cv.width = W; cv.height = H
    cv.getContext('2d').drawImage(res, 0, 0)
    studio.cmp.setAspect(W, H)
  }

  async function exportBlob(it) {
    const { canvas: cut, work } = await q.cutout(it, { trim: spec.ratio !== 'original' })
    const spc = itemSpec(it)
    const [W, H] = spc.trimmed ? ratioSize(spec.ratio, work.width, work.height, Math.max(work.width, work.height)) : [work.width, work.height]
    const res = compose(spc, cut, work.canvas, W, H)
    const fmt = effFmt()
    if (fmt === 'jpg') {
      const flat = makeCanvas(W, H)
      const fx = flat.getContext('2d')
      fx.fillStyle = '#ffffff'; fx.fillRect(0, 0, W, H); fx.drawImage(res, 0, 0)
      return canvasBlob(flat, 'image/jpeg', out.quality / 100)
    }
    return canvasBlob(res, mimeOf(fmt), out.quality / 100)
  }

  const studio = subjectStudio({
    q, signal, afterLabel: 'New background', resultView: 'Result',
    hero: {
      label: 'Drop a photo here, or click to choose',
      hint: 'JPG, PNG, WebP, HEIC and more. Paste with Ctrl+V works too.',
      icons: ['paint-bucket', 'image', 'sparkles', 'palette'],
      features: [['shield-check', 'Stays on your device'], ['palette', 'Colors, gradients, photos'], ['images', 'Batch and ZIP']],
    },
    draw: (it, cv) => renderPreview(it, cv),
    renderDone: (it, fresh) => doneCard({
      title: word,
      sub: `${fresh ? `Subject found in ${(it.ms / 1000).toFixed(1)} s. ` : ''}Drag the photo to move it, or use the controls on the right.`,
      actions: [downloadButton(() => exportBlob(it), () => outName(it), `Download ${effFmt().toUpperCase()}`, { size: 'lg' }), devicePill(it.device)],
    }),
  })
  studio.cmp.classList.add('ia-movable')

  // Drag the subject around the canvas
  {
    let start = null
    drag(studio.cmp, (type, e) => {
      const it = studio.active
      if (!it || q.stale(it) || studio.view !== 'result') return
      const r = studio.cmp.getBoundingClientRect()
      if (type === 'down') start = { x: e.clientX, y: e.clientY, dx: it.dx || 0, dy: it.dy || 0 }
      else if (type === 'move' && start) {
        it.dx = start.dx + (e.clientX - start.x) / r.width
        it.dy = start.dy + (e.clientY - start.y) / r.height
        studio.redraw()
      } else if (type === 'up') start = null
    })
  }

  // ---------- background controls
  const gradBtns = h('div', { class: 'ia-sws' }, GRADIENTS.map((g) => h('button', {
    type: 'button', class: 'ia-sw', 'aria-label': g.name, title: g.name, 'aria-pressed': String(g.id === spec.bg.grad.id),
    style: { '--sw': `linear-gradient(${g.angle}deg, ${g.a}, ${g.b})` }, dataset: { id: g.id },
    onclick: () => { spec.bg.grad = { ...g }; angle.set(g.angle); syncGrad(); studio.redraw() },
  })))
  const syncGrad = () => { for (const b of gradBtns.children) b.setAttribute('aria-pressed', String(b.dataset.id === spec.bg.grad.id)) }
  const gradA = h('input', { type: 'color', class: 'input', value: spec.bg.grad.a, 'aria-label': 'Gradient start color', oninput: (e) => { spec.bg.grad = { ...spec.bg.grad, id: 'custom', a: e.target.value }; syncGrad(); studio.redraw() } })
  const gradB = h('input', { type: 'color', class: 'input', value: spec.bg.grad.b, 'aria-label': 'Gradient end color', oninput: (e) => { spec.bg.grad = { ...spec.bg.grad, id: 'custom', b: e.target.value }; syncGrad(); studio.redraw() } })
  const angle = rangeField('Angle', { min: 0, max: 360, step: 5, value: spec.bg.grad.angle, format: (v) => `${v} deg`, onInput: (v) => { spec.bg.grad = { ...spec.bg.grad, id: 'custom', angle: v }; syncGrad(); studio.redraw() } })
  const colorSw = swatches(COLORS, spec.bg.color, (v) => { spec.bg.color = v; studio.redraw() })
  const blurRange = rangeField('Blur amount', { min: 0, max: 100, value: spec.bg.blur, format: (v) => `${v}%`, onInput: (v) => { spec.bg.blur = v; studio.redraw() } })
  const photoBlur = rangeField('Soften the photo', { min: 0, max: 100, value: 0, format: (v) => `${v}%`, onInput: (v) => { spec.bg.photoBlur = v; studio.redraw() } })
  const photoName = h('div', { class: 'small muted' }, 'No photo chosen yet.')
  const photoZone = dropzone({
    accept: 'image/*', compact: true, paste: false, label: 'Choose a background photo', hint: 'Any JPG, PNG or WebP',
    onFiles: async ([f]) => {
      try {
        const img = await loadImage(f)
        spec.bg.photo = fitCanvas(toCanvas(img), 2400)
        spec.bg.photoName = f.name
        photoName.textContent = `${f.name} (${formatBytes(f.size)})`
        studio.redraw()
      } catch (e) { toast(e.message, 'error') }
    },
  })
  const panes = {
    color: [colorSw],
    gradient: [gradBtns, h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'From'), gradA), h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'To'), gradB)), angle],
    blur: [blurRange, note('info', 'Uses a blurred copy of your own photo, like portrait mode.')],
    photo: [photoZone, photoName, photoBlur],
    transparent: [note('info', 'No background. Download as PNG or WebP to keep it transparent.')],
  }
  const paneHost = h('div', { class: 'stack' })
  const showPane = () => { clear(paneHost, panes[spec.bg.kind]) }
  const syncStage = () => studio.stage.setVariant(spec.bg.kind === 'transparent' ? '' : 'on-plain')
  const kindSeg = segmented([['color', 'Color'], ['gradient', 'Gradient'], ['blur', 'Blur'], ['photo', 'Photo'], ['transparent', 'Clear']], spec.bg.kind, (v) => {
    spec.bg.kind = v
    showPane()
    syncStage()
    syncFmt()
    studio.redraw()
  }, 'Background type')
  syncStage()
  showPane()
  if (preset === 'white') colorSw.set('#ffffff')

  const scale = rangeField('Subject size', { min: 30, max: 170, value: spec.scale, format: (v) => `${v}%`, onInput: (v) => { spec.scale = v; studio.redraw() } })
  const shadow = rangeField('Soft shadow', { min: 0, max: 100, value: spec.shadow, format: (v) => (v ? `${v}%` : 'Off'), onInput: (v) => { spec.shadow = v; studio.redraw() } })
  const resetPos = button('Reset position', { icon: 'move', variant: 'secondary', size: 'sm', onClick: () => { const a = studio.active; if (a) { a.dx = 0; a.dy = 0; scale.set(100); spec.scale = 100; studio.redraw() } } })
  const ratioSeg = segmented(RATIOS, spec.ratio, (v) => { spec.ratio = v; for (const it of q.items) { it.dx = 0; it.dy = 0 } studio.redraw() }, 'Canvas shape')

  const models = modelSection(q, () => { if (studio.active) studio.run(studio.active) }, { open: false })
  const edges = edgesSection(q, async (kind) => {
    const a = studio.active
    if (!a || q.stale(a)) return
    if (kind === 'rebase') await q.rebase(a)
    studio.redraw()
  }, { open: false })

  const fmtSeg = segmented([['jpg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP']], out.fmt, (v) => { out.fmt = v; syncFmt() }, 'File format')
  const quality = rangeField('Quality', { min: 50, max: 100, value: out.quality, format: (v) => `${v}%`, onInput: (v) => { out.quality = v } })
  const fmtNote = h('div')
  function syncFmt() {
    clear(fmtNote, spec.bg.kind === 'transparent' && out.fmt === 'jpg' ? note('info', 'JPG cannot be transparent, so this will download as PNG.') : null)
    quality.hidden = effFmt() === 'png'
    if (studio.active && !q.stale(studio.active)) studio.showDone(studio.active, false)
  }

  const panel = panelOf(
    section('Background', 'palette', [kindSeg, paneHost]),
    section('Subject', 'user-round', [scale, shadow, h('div', { class: 'ia-note' }, icon('move'), h('div', 'Drag the photo to reposition the subject.')), resetPos]),
    section('Canvas shape', 'crop', [ratioSeg, note('info', 'Original keeps your photo as it is. Other shapes center the subject on a new canvas.')], false),
    edges, models,
    section('Download', 'download', [h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Format'), fmtSeg), quality, fmtNote], false))

  const dlBtn = button('Download', { icon: 'download', variant: 'primary', size: 'lg', block: true })
  dlBtn.addEventListener('click', () => busy(dlBtn, async () => {
    const it = studio.active
    if (!it) return
    await studio.runAndWait(it)
    if (q.stale(it)) return
    download(await exportBlob(it), outName(it))
  }, { label: 'Preparing file' }))
  const allBtn = button('Download all as ZIP', { icon: 'archive', variant: 'secondary', block: true })
  const allProg = progress('Processing')
  allBtn.addEventListener('click', () => busy(allBtn, async () => {
    const files = []
    const list = [...q.items]
    for (let i = 0; i < list.length; i++) {
      allProg.set(i / list.length, `Working on ${list[i].name} (${i + 1} of ${list.length})`)
      await studio.runAndWait(list[i])
      if (q.stale(list[i])) continue
      files.push({ name: outName(list[i]), data: await exportBlob(list[i]) })
    }
    if (!files.length) throw new Error('None of the photos could be processed.')
    allProg.set(1, 'Zipping')
    download(await zip(files), 'new-backgrounds.zip')
    toast(`Saved ${files.length} photos`, 'success')
  }, { label: 'Working', progress: allProg }))
  allBtn.hidden = true
  studio.onQueue = (n) => { allBtn.hidden = n < 2 }
  studio.onSelect = () => {}
  studio.setSide(panel, h('div', { class: 'stack tight' }, dlBtn, allBtn, allProg.el, button('Start over', { icon: 'rotate-ccw', variant: 'ghost', block: true, onClick: () => studio.reset() })))

  shell(root, studio.stepper, studio.hero, studio.layout)
  syncFmt()

  // Picked up from "Remove background": same file, so the cached mask is reused.
  const held = handoff.take()
  if (held) {
    if (held.meta?.model) { q.model = held.meta.model; models.cards.set(q.model) }
    studio.addFiles([held.file])
  }
  return () => studio.dispose()
}
