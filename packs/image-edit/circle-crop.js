// Circle crop & round corners: round avatars, rounded squares, squircles or rounded corners that keep the shape. Transparent PNG/WebP output.
import { toggle } from '../../lib/ui.js'
import { canvas } from '../../lib/image.js'
import {
  shell, h, icon, button, busy, chips, section, note, hint, stage, slider, colorField, imageSlot, previewCanvas, outputPicker, encodeWith, outName,
  download,
} from './_kit.js'

/** Trace the mask outline on ctx for a box. shape: circle | rounded | squircle | corners. radius 0..0.5 (fraction of the short side). */
export function maskPath(ctx, shape, x, y, w, hh, radius = 0.2) {
  ctx.beginPath()
  if (shape === 'circle') ctx.ellipse(x + w / 2, y + hh / 2, w / 2, hh / 2, 0, 0, Math.PI * 2)
  else if (shape === 'squircle') {
    const n = 4.4, steps = 120
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t)
      const px = x + w / 2 + (w / 2) * Math.sign(c) * Math.abs(c) ** (2 / n), py = y + hh / 2 + (hh / 2) * Math.sign(s) * Math.abs(s) ** (2 / n)
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)
    }
    ctx.closePath()
  } else ctx.roundRect(x, y, w, hh, Math.min(w, hh) * radius)
}

/** Draw the masked image. avatar shapes crop a square (zoom, pan as fractions of the square); `corners` keeps the original shape. */
export function renderRound(img, o, size) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height
  const keep = o.shape === 'corners'
  const W = keep ? Math.max(1, Math.round(iw * (size / Math.max(iw, ih)))) : size, H = keep ? Math.max(1, Math.round(ih * (size / Math.max(iw, ih)))) : size
  const c = canvas(W, H)
  const ctx = c.getContext('2d')
  if (o.bg && o.bg !== 'transparent') { ctx.fillStyle = o.bg; ctx.fillRect(0, 0, W, H) }
  const bw = o.border ? (o.borderWidth / 100) * Math.min(W, H) : 0
  ctx.save()
  maskPath(ctx, o.shape, 0, 0, W, H, o.radius)
  ctx.clip()
  ctx.imageSmoothingQuality = 'high'
  if (keep) ctx.drawImage(img, 0, 0, W, H)
  else {
    const k = Math.max(W / iw, H / ih) * o.zoom
    const dw = iw * k, dh = ih * k
    const maxX = (dw - W) / 2, maxY = (dh - H) / 2
    const px = Math.max(-maxX, Math.min(maxX, o.ox * W)), py = Math.max(-maxY, Math.min(maxY, o.oy * H))
    ctx.drawImage(img, (W - dw) / 2 + px, (H - dh) / 2 + py, dw, dh)
  }
  ctx.restore()
  if (bw) {
    ctx.save()
    maskPath(ctx, o.shape, bw / 2, bw / 2, W - bw, H - bw, o.radius)
    ctx.lineWidth = bw; ctx.strokeStyle = o.borderColor; ctx.stroke()
    ctx.restore()
  }
  return c
}

export function mount(root, { params }) {
  const o = { shape: params.shape || 'circle', radius: 0.22, zoom: 1, ox: 0, oy: 0, border: false, borderWidth: 3, borderColor: '#ffffff', bg: 'transparent', size: 1024 }
  let src = null, work = null

  const shape = chips([['circle', 'Circle', 'circle'], ['rounded', 'Rounded square', 'square'], ['squircle', 'Squircle', 'app-window'], ['corners', 'Round corners', 'crop']], o.shape, (v) => { o.shape = v; sync(); draw() }, { label: 'Shape' })
  const radius = slider('Corner radius', { min: 0, max: 50, value: Math.round(o.radius * 100), format: (v) => `${v}%`, onInput: (v) => { o.radius = v / 100; draw() } })
  const zoom = slider('Zoom', { min: 100, max: 400, value: 100, format: (v) => `${v}%`, onInput: (v) => { o.zoom = v / 100; draw() } })
  const sizeChips = chips([[256, '256'], [512, '512'], [1024, '1024'], [2048, '2048']], 1024, (v) => { o.size = v; sync() }, { label: 'Size' })
  const borderT = toggle('Add a border', false, (v) => { o.border = v; bBox.hidden = !v; draw() })
  const borderColor = colorField('Border color', '#ffffff', (v) => { o.borderColor = v; draw() }, { swatches: ['#ffffff', '#000000', '#5b4cf0', '#ec4899'] })
  const borderW = slider('Border width', { min: 1, max: 12, value: 3, format: (v) => `${v}%`, onInput: (v) => { o.borderWidth = v; draw() } })
  const bBox = h('div', { class: 'stack', hidden: true }, borderColor, borderW)
  const bg = colorField('Background', 'transparent', (v) => { o.bg = v; draw() }, { swatches: ['#ffffff', '#000000'], none: true })
  const out = outputPicker({ formats: ['png', 'webp', 'jpg'], value: 'png', same: false })
  const view = h('canvas', { class: 'ie-circlecanvas', tabindex: 0, 'aria-label': 'Preview. Drag to move the picture inside the shape, scroll to zoom.' })
  const host = stage(view)
  const sizeLabel = h('div', { class: 'ie-note ie-center' })

  function sync() {
    const keep = o.shape === 'corners'
    zoom.hidden = keep
    radius.hidden = o.shape === 'circle' || o.shape === 'squircle'
    sizeChips.setOptions(keep ? [[256, '256'], [512, '512'], [1024, '1024'], [2048, '2048'], [0, 'Original']] : [[256, '256'], [512, '512'], [1024, '1024'], [2048, '2048']])
    if (!keep && !o.size) o.size = 1024
    sizeChips.set(o.size)
    hintEl.hidden = keep
  }
  const hintEl = hint('Drag the picture to reposition it. Scroll or use the zoom slider to zoom.', 'move')

  const sizeFor = () => (o.size || Math.max(src.w, src.h))
  let raf = 0
  function draw() {
    if (!work) return
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      const pv = o.shape === 'corners' ? 700 : 560
      const c = renderRound(work, o, pv)
      view.width = c.width; view.height = c.height
      view.getContext('2d').drawImage(c, 0, 0)
      const s = sizeFor()
      sizeLabel.textContent = o.shape === 'corners' ? `Output keeps the picture's shape, longest side ${o.size ? s : src.w + ' x ' + src.h} px` : `Output ${s} x ${s} px`
    })
  }
  let drag = null
  view.addEventListener('pointerdown', (e) => { if (o.shape === 'corners' || !work) return; drag = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: o.ox, oy: o.oy }; view.setPointerCapture(e.pointerId); view.classList.add('grabbing'); e.preventDefault() })
  view.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return
    const r = view.getBoundingClientRect()
    o.ox = drag.ox + (e.clientX - drag.x) / r.width; o.oy = drag.oy + (e.clientY - drag.y) / r.height
    draw()
  })
  const end = () => { drag = null; view.classList.remove('grabbing') }
  view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end)
  view.addEventListener('wheel', (e) => { if (o.shape === 'corners') return; e.preventDefault(); o.zoom = Math.max(1, Math.min(4, o.zoom * (e.deltaY < 0 ? 1.06 : 0.94))); zoom.set(Math.round(o.zoom * 100)); draw() }, { passive: false })
  view.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-0.01, 0], ArrowRight: [0.01, 0], ArrowUp: [0, -0.01], ArrowDown: [0, 0.01] }[e.key]
    if (d) { e.preventDefault(); o.ox += d[0]; o.oy += d[1]; draw() }
  })

  const goBtn = button('Download image', { icon: 'download', variant: 'primary', size: 'lg', block: true })
  goBtn.addEventListener('click', () => busy(goBtn, async () => {
    const pick = out.get()
    const flat = pick.fmt === 'jpg'
    const c = renderRound(src.img, { ...o, bg: flat && o.bg === 'transparent' ? pick.bg : o.bg }, sizeFor())
    download(await encodeWith(c, { ...pick, bg: pick.bg }), outName(src.name, o.shape === 'corners' ? 'rounded' : o.shape, pick.fmt))
  }, { label: 'Rendering' }))

  const slot = imageSlot({
    ic: 'circle',
    onImage: async (s) => {
      src = s
      work = previewCanvas(s.img, 1600)
      o.ox = 0; o.oy = 0; o.zoom = 1; zoom.set(100)
      workEl.hidden = false; sync(); draw()
    },
    onClear: () => { src = work = null; workEl.hidden = true },
  })
  const style = h('style', '.ie-circlecanvas{cursor:grab;touch-action:none;outline:none;border-radius:0!important;box-shadow:none!important;max-height:min(62vh,560px)!important}.ie-circlecanvas.grabbing{cursor:grabbing}.ie-circlecanvas:focus-visible{outline:3px solid var(--ring)}')
  const side = h('aside', { class: 'ie-side ie-glass' },
    section('Shape', 'circle', shape, radius, zoom),
    section('Style', 'palette', borderT, bBox, bg),
    section('Size', 'maximize', sizeChips),
    out.el, h('div', { class: 'ie-foot' }, goBtn))
  const workEl = h('div', { class: 'ie-work', hidden: true }, h('div', { class: 'ie-main pin live' }, host, sizeLabel, hintEl), side)
  root.append(shell(style, slot.el, workEl))
  sync()
}
