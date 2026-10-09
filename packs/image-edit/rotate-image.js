// Rotate and flip: quarter turns, any angle with a fill color, mirror, live preview, batch.
import { number, progress, toggle } from '../../lib/ui.js'
import { canvas } from '../../lib/image.js'
import {
  shell, h, button, busy, field, chips, section, note, tiles, stage, slider, colorField, batchSlot, results, runBatch, readSource, previewCanvas,
  outputPicker, encodeWith, outName, clear, toast, errorMessage,
} from './_kit.js'

/** Draw an image rotated clockwise by `angle` degrees (after optional flips). expand grows the canvas so nothing is cut off. */
export function renderRotate(img, { angle = 0, flipH = false, flipV = false, expand = true, fill = 'transparent', scale = 1 } = {}) {
  const sw = Math.max(1, Math.round((img.naturalWidth || img.width) * scale)), sh = Math.max(1, Math.round((img.naturalHeight || img.height) * scale))
  const rad = (angle * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad))
  let W = sw, H = sh
  if (angle % 90 === 0) { if ((angle / 90) % 2 !== 0) { W = sh; H = sw } }
  else if (expand) { W = Math.round(sw * cos + sh * sin); H = Math.round(sw * sin + sh * cos) }
  const c = canvas(W, H)
  const ctx = c.getContext('2d')
  if (fill !== 'transparent') { ctx.fillStyle = fill; ctx.fillRect(0, 0, W, H) }
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(W / 2, H / 2)
  ctx.rotate(rad)
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
  ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh)
  return c
}

const norm = (a) => { a = ((a + 180) % 360 + 360) % 360 - 180; return a === -180 ? 180 : a }

export function mount(root, { params, signal }) {
  const flipFirst = params.mode === 'flip'
  const o = { angle: 0, flipH: false, flipV: false, expand: true, fill: 'transparent', grid: false }
  let active = null, seq = 0

  const angleSlider = slider('Angle', { min: -180, max: 180, step: 0.5, value: 0, format: (v) => `${v}°`, onInput: (v) => { o.angle = v; angleNum.value = v; draw() } })
  const angleNum = number(0, { step: 0.1, ariaLabel: 'Angle in degrees', onInput: (v) => { if (Number.isFinite(v)) { o.angle = norm(v); angleSlider.set(o.angle); draw() } } })
  const setAngle = (a) => { o.angle = norm(a); angleSlider.set(o.angle); angleNum.value = o.angle; draw() }
  const flipHBtn = button('Flip horizontal', { icon: 'flip-horizontal-2', onClick: () => { o.flipH = !o.flipH; flipHBtn.setAttribute('aria-pressed', String(o.flipH)); draw() } })
  const flipVBtn = button('Flip vertical', { icon: 'flip-vertical-2', onClick: () => { o.flipV = !o.flipV; flipVBtn.setAttribute('aria-pressed', String(o.flipV)); draw() } })
  for (const b of [flipHBtn, flipVBtn]) { b.classList.add('ie-chip'); b.classList.remove('btn', 'btn-secondary'); b.setAttribute('aria-pressed', 'false') }
  const turnL = button('Rotate left', { icon: 'rotate-ccw', onClick: () => setAngle(o.angle - 90) })
  const turnR = button('Rotate right', { icon: 'rotate-cw', onClick: () => setAngle(o.angle + 90) })
  const reset = button('Reset', { icon: 'undo-2', variant: 'ghost', size: 'sm', onClick: () => { o.flipH = o.flipV = false; for (const b of [flipHBtn, flipVBtn]) b.setAttribute('aria-pressed', 'false'); setAngle(0) } })
  const fill = colorField('Fill for the empty corners', 'transparent', (v) => { o.fill = v; draw() }, { swatches: ['#ffffff', '#000000', '#f3f4f6'], none: true })
  const canvasMode = chips([[true, 'Fit whole image'], [false, 'Keep original size']], true, (v) => { o.expand = v; draw() }, { label: 'Canvas' })
  const gridT = toggle('Show a straightening grid', false, (v) => { o.grid = v; gridEl.hidden = !v })
  const out = outputPicker({ formats: ['png', 'jpg', 'webp'], value: 'same', showBg: false })

  const gridEl = h('div', { class: 'ie-rgrid', hidden: true })
  const host = stage(h('div', { class: 'ie-center ie-note' }, 'Your preview appears here.'))
  const info = h('div')
  const wrapHost = h('div', { class: 'ie-rwrap' }, host, gridEl)

  function draw() {
    if (!active) return
    const token = ++seq
    requestAnimationFrame(() => {
      if (token !== seq) return
      try {
        const c = renderRotate(active.prev, { angle: o.angle, flipH: o.flipH, flipV: o.flipV, expand: o.expand, fill: o.fill })
        host.replaceChildren(c)
        const k = active.src.w / active.prev.width
        clear(info, tiles([
          { label: 'Original', value: `${active.src.w} x ${active.src.h}` },
          { label: 'Result', value: `${Math.round(c.width * k)} x ${Math.round(c.height * k)}`, hot: true, sub: o.angle || o.flipH || o.flipV ? `${o.angle}° ${o.flipH ? '· mirrored' : ''}${o.flipV ? '· upside down' : ''}`.trim() : 'No change yet' },
        ]))
      } catch (e) { clear(info, h('div', { class: 'ie-note' }, errorMessage(e))) }
    })
  }
  async function select(file) {
    if (!file) { active = null; work.hidden = true; return }
    try {
      const src = await readSource(file)
      active = { file, src, prev: previewCanvas(src.img, 1000) }
      work.hidden = false
      draw()
    } catch (e) { toast(errorMessage(e), 'error') }
  }
  const slot = batchSlot({ ic: 'rotate-cw', onChange: (fs) => { goBtn.querySelector('span').textContent = fs.length > 1 ? `Apply to ${fs.length} images` : 'Save image'; if (!fs.length) select(null) }, onSelect: select })
  const prog = progress()
  const res = results({ zipName: 'rotated-images.zip', compare: false, noun: 'image' })
  const goBtn = button('Save image', { icon: 'rotate-cw', variant: 'primary', size: 'lg', block: true })
  goBtn.addEventListener('click', () => busy(goBtn, async () => {
    const files = [...slot.files]
    if (!files.length) return
    const onlyFlip = !o.angle && (o.flipH || o.flipV)
    await runBatch(files, async (file) => {
      const src = await readSource(file)
      const c = renderRotate(src.img, { angle: o.angle, flipH: o.flipH, flipV: o.flipV, expand: o.expand, fill: o.fill })
      const pick = out.resolve(src)
      const blob = await encodeWith(c, { ...pick, bg: o.fill !== 'transparent' ? o.fill : '#ffffff' })
      return { name: outName(file.name, onlyFlip ? 'flipped' : 'rotated', pick.fmt), blob, w: c.width, h: c.height, inSize: file.size, original: file }
    }, { out: res, prog, signal, label: 'Rotating' })
  }, { label: 'Saving', progress: prog }))

  const rotateSec = section('Rotate', 'rotate-cw', h('div', { class: 'ie-row2' }, turnL, turnR), angleSlider, field('Exact angle (degrees)', angleNum), fill, canvasMode, gridT)
  const flipSec = section('Flip', 'flip-horizontal-2', h('div', { class: 'ie-chips' }, flipHBtn, flipVBtn))
  const style = h('style', `.ie-rwrap{position:relative}.ie-rgrid{position:absolute;inset:12px;pointer-events:none;border-radius:8px;opacity:.55;background:linear-gradient(90deg,rgba(255,255,255,.9) 1px,transparent 1px) 0 0/10% 100%,linear-gradient(rgba(255,255,255,.9) 1px,transparent 1px) 0 0/100% 10%;mix-blend-mode:difference}`)
  const side = h('aside', { class: 'ie-side ie-glass' }, ...(flipFirst ? [flipSec, rotateSec] : [rotateSec, flipSec]), out.el, h('div', { class: 'ie-foot' }, goBtn, reset, prog.el))
  const work = h('div', { class: 'ie-work', hidden: true }, h('div', { class: 'ie-main pin live' }, wrapHost, info), side)
  root.append(shell(style, slot.el, work, res.el))
}
