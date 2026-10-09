// Watermark image: text or logo watermark with position grid, drag to place, size, opacity, rotation and tiling. Batch with ZIP.
import { textarea, toggle, progress } from '../../lib/ui.js'
import { canvas, loadImage } from '../../lib/image.js'
import {
  shell, h, icon, button, busy, field, chips, section, note, hint, stage, slider, colorField, anchorGrid, intake, batchSlot, results, runBatch,
  readSource, previewCanvas, outputPicker, encodeWith, outName, toast, errorMessage, objURL,
} from './_kit.js'
import { FONTS, newLayer, layerSprite } from './_text.js'

const AX = { l: 0, c: 0.5, r: 1 }, AY = { t: 0, c: 0.5, b: 1 }

/**
 * Draw a watermark sprite onto ctx (W x H). wm: {pos: {anchor|x,y}, size (fraction of W), opacity 0..1, rotation, tile, gap, margin (fraction of W)}.
 * Returns the center {cx, cy} used when not tiled.
 */
export function drawWatermark(ctx, W, H, sprite, wm) {
  const sw = Math.max(2, wm.size * W), sh = (sprite.height / sprite.width) * sw
  ctx.save()
  ctx.globalAlpha = wm.opacity
  ctx.imageSmoothingQuality = 'high'
  if (wm.tile) {
    const gx = sw * (1 + wm.gap), gy = sh * (1 + wm.gap) * 1.4
    const diag = Math.hypot(W, H)
    ctx.translate(W / 2, H / 2)
    ctx.rotate((wm.rotation * Math.PI) / 180)
    let row = 0
    for (let y = -diag / 2; y < diag / 2 + gy; y += gy, row++) {
      for (let x = -diag / 2 - (row % 2 ? gx / 2 : 0); x < diag / 2 + gx; x += gx) ctx.drawImage(sprite, x, y, sw, sh)
    }
    ctx.restore()
    return null
  }
  const m = wm.margin * W
  let cx, cy
  if (wm.free) { cx = wm.free.x * W; cy = wm.free.y * H }
  else { cx = m + sw / 2 + AX[wm.anchor[1]] * (W - 2 * m - sw); cy = m + sh / 2 + AY[wm.anchor[0]] * (H - 2 * m - sh) }
  ctx.translate(cx, cy)
  ctx.rotate((wm.rotation * Math.PI) / 180)
  ctx.drawImage(sprite, -sw / 2, -sh / 2, sw, sh)
  ctx.restore()
  return { cx, cy, w: sw, h: sh }
}

export function mount(root, { signal }) {
  const o = { kind: 'text', size: 22, opacity: 0.6, rotation: 0, tile: false, gap: 0.8, margin: 3, anchor: 'br', free: null }
  const layer = newLayer({ text: '© Your name', size: 6, bold: true, color: '#ffffff', shadow: true, opacity: 1 })
  let logo = null // {img, url, name}
  let active = null, boxCache = null, seq = 0

  const kind = chips([['text', 'Text', 'type'], ['logo', 'Logo', 'image']], 'text', (v) => { o.kind = v; syncKind(); draw() }, { label: 'Watermark type' })
  const text = textarea({ rows: 2, value: layer.text, 'aria-label': 'Watermark text', oninput: (e) => { layer.text = e.target.value || ' '; draw() } })
  const fontSel = h('select', { class: 'select', 'aria-label': 'Font', onchange: (e) => { layer.font = e.target.value; draw() } }, FONTS.map(([v, l]) => h('option', { value: v }, l)))
  const color = colorField('Text color', '#ffffff', (v) => { layer.color = v; draw() }, { swatches: ['#ffffff', '#000000', '#facc15', '#ef4444'] })
  const boldT = toggle('Bold', true, (v) => { layer.bold = v; draw() })
  const shadowT = toggle('Shadow', true, (v) => { layer.shadow = v; draw() })
  const strokeT = toggle('Outline', false, (v) => { layer.stroke = v; layer.strokeColor = '#000000'; draw() })
  const logoZone = intake({ accept: 'image/*', multiple: false, label: 'Choose a logo (PNG with transparency works best)', formats: [], paste: false, compact: true, ic: 'image', onFiles: async ([f]) => {
    try {
      const img = await loadImage(f)
      if (logo?.url) URL.revokeObjectURL(logo.url)
      logo = { img, name: f.name, url: objURL(f) }
      logoName.textContent = f.name
      draw()
    } catch (e) { toast(errorMessage(e), 'error') }
  } })
  logoZone.classList.add('compact')
  const logoName = h('div', { class: 'ie-note' }, 'No logo yet.')
  const textBox = h('div', { class: 'stack' }, field('Text', text), field('Font', fontSel), color, h('div', { class: 'ie-chips' }, boldT, shadowT, strokeT))
  const logoBox = h('div', { class: 'stack', hidden: true }, logoZone, logoName)
  const size = slider('Size', { min: 3, max: 90, value: 22, format: (v) => `${v}%`, onInput: (v) => { o.size = v; draw() }, hint: 'Width of the watermark compared to the image.' })
  const opacity = slider('Opacity', { min: 5, max: 100, value: 60, format: (v) => `${v}%`, onInput: (v) => { o.opacity = v / 100; draw() } })
  const rotation = slider('Rotation', { min: -90, max: 90, value: 0, format: (v) => `${v}°`, onInput: (v) => { o.rotation = v; draw() } })
  const anchor = anchorGrid('br', (v) => { o.anchor = v; o.free = null; draw() })
  const margin = slider('Margin', { min: 0, max: 15, step: 0.5, value: 3, format: (v) => `${v}%`, onInput: (v) => { o.margin = v; draw() } })
  const tileT = toggle('Repeat across the whole image', false, (v) => { o.tile = v; tileBox.hidden = !v; placeBox.hidden = v; draw() })
  const gap = slider('Spacing', { min: 0, max: 300, step: 5, value: 80, format: (v) => `${v}%`, onInput: (v) => { o.gap = v / 100; draw() } })
  const tileBox = h('div', { class: 'stack', hidden: true }, gap, note('Tip: rotate by -30° for the classic diagonal stamp.'))
  const placeBox = h('div', { class: 'stack' }, anchor, margin, note('You can also drag the watermark on the preview.'))
  const out = outputPicker({ formats: ['jpg', 'png', 'webp'], value: 'same' })

  const spriteFor = (W) => {
    if (o.kind !== 'text') return logo?.img
    const probe = layerSprite({ ...layer, size: 6 }, W)
    return layerSprite({ ...layer, size: 6 * ((o.size / 100) * W / probe.width) }, W) // draw the text at its final size so it stays crisp
  }
  const wmFor = () => ({ size: o.size / 100, opacity: o.opacity, rotation: o.rotation, tile: o.tile, gap: o.gap, margin: o.margin / 100, anchor: o.anchor, free: o.free })
  function syncKind() { textBox.hidden = o.kind !== 'text'; logoBox.hidden = o.kind !== 'logo' }

  const view = h('canvas', { class: 'ie-textcanvas', tabindex: 0, 'aria-label': 'Preview. Drag to place the watermark.' })
  const host = stage(view)
  let raf = 0
  function draw() {
    if (!active) return
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      const { prev } = active
      view.width = prev.width; view.height = prev.height
      const ctx = view.getContext('2d')
      ctx.drawImage(prev, 0, 0)
      const sprite = spriteFor(prev.width)
      if (!sprite) { boxCache = null; return }
      boxCache = drawWatermark(ctx, prev.width, prev.height, sprite, wmFor())
    })
  }
  let drag = null
  const toFrac = (e) => { const r = view.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) } }
  view.addEventListener('pointerdown', (e) => {
    if (!active || o.tile) return
    drag = e.pointerId; view.setPointerCapture(e.pointerId); view.classList.add('grabbing')
    o.free = toFrac(e); anchor.set(''); draw(); e.preventDefault()
  })
  view.addEventListener('pointermove', (e) => { if (drag === e.pointerId) { o.free = toFrac(e); draw() } })
  const end = () => { drag = null; view.classList.remove('grabbing') }
  view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end)

  async function select(file) {
    if (!file) { active = null; work.hidden = true; return }
    try {
      const src = await readSource(file)
      active = { file, src, prev: previewCanvas(src.img, 1100) }
      work.hidden = false
      draw()
    } catch (e) { toast(errorMessage(e), 'error') }
  }
  const slot = batchSlot({ ic: 'stamp', onChange: (fs) => { goBtn.querySelector('span').textContent = fs.length > 1 ? `Watermark ${fs.length} images` : 'Add watermark'; if (!fs.length) select(null) }, onSelect: select })

  const prog = progress()
  const res = results({ zipName: 'watermarked-images.zip', compare: false, noun: 'image' })
  const goBtn = button('Add watermark', { icon: 'stamp', variant: 'primary', size: 'lg', block: true })
  goBtn.addEventListener('click', () => busy(goBtn, async () => {
    const files = [...slot.files]
    if (!files.length) return
    if (o.kind === 'logo' && !logo) return toast('Choose a logo first.', 'error')
    if (o.kind === 'text' && !layer.text.trim()) return toast('Type the watermark text first.', 'error')
    const wm = wmFor()
    await runBatch(files, async (file) => {
      const src = await readSource(file)
      const c = canvas(src.w, src.h)
      const ctx = c.getContext('2d')
      ctx.drawImage(src.img, 0, 0, src.w, src.h)
      drawWatermark(ctx, c.width, c.height, spriteFor(c.width), wm)
      const pick = out.resolve(src)
      return { name: outName(file.name, 'watermarked', pick.fmt), blob: await encodeWith(c, pick), w: c.width, h: c.height, inSize: file.size, original: file }
    }, { out: res, prog, signal, label: 'Stamping' })
  }, { label: 'Stamping', progress: prog }))

  const style = h('style', `.ie-textcanvas{cursor:crosshair;touch-action:none;outline:none}.ie-textcanvas.grabbing{cursor:grabbing}`)
  const side = h('aside', { class: 'ie-side ie-glass' },
    section('Watermark', 'stamp', kind, textBox, logoBox),
    section('Look', 'sliders-horizontal', size, opacity, rotation),
    section('Position', 'move', tileT, placeBox, tileBox),
    out.el,
    h('div', { class: 'ie-foot' }, goBtn, prog.el))
  const work = h('div', { class: 'ie-work', hidden: true }, h('div', { class: 'ie-main pin live' }, host, hint('Click or drag on the preview to place the watermark. The same settings are used for every image.', 'move')), side)
  root.append(shell(style, slot.el, work, res.el))
  syncKind()
}
