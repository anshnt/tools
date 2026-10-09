// Auto blur faces: detect every face (including small ones in group photos), blur / pixelate / cover them,
// toggle individual faces, draw extra boxes by hand, and download a clean copy with no EXIF data.
import { h, icon, button, busy, alert, clear, segmented, rangeField, toggle, toast, download, progress, debounce, fileType } from '../../lib/ui.js'
import { suffixName, zip } from '../../lib/files.js'
import { canvas as makeCanvas, canEncode } from '../../lib/image.js'
import { loadWorking, fitCanvas, thumbOf, canvasBlob, boxBlurU8, friendlyError } from './_ml.js'
import { detectFaces } from './_face.js'
import { shell, steps, heroDrop, panelOf, section, stage, scanFx, strip, note, burst, drag } from './_ui.js'

const PREV_MAX = 1400
const MAX_FILES = 30
const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t) }

/** Soft mask value (0..1) at pixel (x, y) for a box with the given shape. Exported for tests. */
export function maskAt(b, x, y, shape) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2
  if (shape === 'oval') {
    const r = Math.hypot((x - cx) / (b.w / 2), (y - cy) / (b.h / 2))
    return smooth((1 - r) / 0.14)
  }
  const half = Math.min(b.w, b.h) / 2
  const rad = half * 0.28
  const qx = Math.abs(x - cx) - (b.w / 2 - rad), qy = Math.abs(y - cy) - (b.h / 2 - rad)
  const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad
  return smooth(-sd / (half * 0.12 + 1))
}

/** Grow a detected face box so the effect also covers forehead, ears and chin. pad is a percentage. */
export function growBox(b, pad, W, H) {
  const gw = b.w * (pad / 100), gh = b.h * (pad / 100)
  const x0 = Math.max(0, b.x - gw / 2), y0 = Math.max(0, b.y - gh * 0.7)
  const x1 = Math.min(W, b.x + b.w + gw / 2), y1 = Math.min(H, b.y + b.h + gh * 0.3)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Apply the effect to the given boxes (already in canvas pixels), in place. */
export function applyEffect(canvas, boxes, { style = 'blur', strength = 70, shape = 'oval' } = {}) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  for (const b of boxes) {
    const minSide = Math.min(b.w, b.h)
    const sigma = style === 'blur' ? 2 + (strength / 100) * minSide * 0.2 : 0
    const m = Math.ceil(sigma * 2.2) + 2
    const rx = Math.max(0, Math.floor(b.x - m)), ry = Math.max(0, Math.floor(b.y - m))
    const rw = Math.min(canvas.width, Math.ceil(b.x + b.w + m)) - rx, rh = Math.min(canvas.height, Math.ceil(b.y + b.h + m)) - ry
    if (rw < 2 || rh < 2) continue
    const id = ctx.getImageData(rx, ry, rw, rh)
    const d = id.data
    const fx = new Uint8ClampedArray(d.length)
    if (style === 'blur') {
      const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2 - 0.5))
      for (let ch = 0; ch < 3; ch++) {
        const plane = new Uint8ClampedArray(rw * rh)
        for (let i = 0; i < plane.length; i++) plane[i] = d[i * 4 + ch]
        const o = boxBlurU8(boxBlurU8(boxBlurU8(plane, rw, rh, r), rw, rh, r), rw, rh, r)
        for (let i = 0; i < o.length; i++) fx[i * 4 + ch] = o[i]
      }
      for (let i = 3; i < fx.length; i += 4) fx[i] = 255
    } else if (style === 'pixelate') {
      const k = Math.max(3, Math.round(minSide * (0.05 + (strength / 100) * 0.17)))
      const ox = Math.round(b.x - rx), oy = Math.round(b.y - ry)
      for (let by = oy - Math.ceil(oy / k) * k; by < rh; by += k) {
        for (let bx = ox - Math.ceil(ox / k) * k; bx < rw; bx += k) {
          const x0 = Math.max(0, bx), y0 = Math.max(0, by), x1 = Math.min(rw, bx + k), y1 = Math.min(rh, by + k)
          let r = 0, g = 0, bl = 0, n = 0
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * rw + x) * 4; r += d[i]; g += d[i + 1]; bl += d[i + 2]; n++ }
          if (!n) continue
          r /= n; g /= n; bl /= n
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * rw + x) * 4; fx[i] = r; fx[i + 1] = g; fx[i + 2] = bl; fx[i + 3] = 255 }
        }
      }
    } else {
      for (let i = 0; i < fx.length; i += 4) { fx[i] = 16; fx[i + 1] = 16; fx[i + 2] = 22; fx[i + 3] = 255 }
    }
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const a = maskAt(b, rx + x + 0.5, ry + y + 0.5, shape)
        if (a <= 0) continue
        const i = (y * rw + x) * 4
        d[i] += (fx[i] - d[i]) * a; d[i + 1] += (fx[i + 1] - d[i + 1]) * a; d[i + 2] += (fx[i + 2] - d[i + 2]) * a
      }
    }
    ctx.putImageData(id, rx, ry)
  }
}

export function mount(root, { signal }) {
  const opts = { style: 'blur', strength: 75, shape: 'oval', pad: 30, sens: 0.5, thorough: true, fmt: 'jpg', quality: 92 }
  const items = []
  let active = null
  let seq = 0
  let showOriginal = false
  let detecting = false
  const ctl = new AbortController()
  signal.addEventListener('abort', () => ctl.abort())

  injectStyle()
  const stepper = steps(['Add photos', 'Check faces', 'Download'], 0)
  const cv = document.createElement('canvas')
  cv.className = 'ia-fb-cv'
  const overlay = h('div', { class: 'ia-fb-overlay' })
  const wrap = h('div', { class: 'ia-fb-wrap' }, cv, overlay)
  const rubber = h('div', { class: 'ia-fb-box rubber', hidden: true })
  overlay.append(rubber)
  const stg = stage('on-plain')
  const scan = scanFx()
  const nameChip = h('div', { class: 'ia-chip bl' }, icon('image'), h('span', ''))
  const countChip = h('div', { class: 'ia-chip br' }, icon('scan-face'), h('span', ''))
  const holdBtn = button('Hold to see original', { icon: 'eye', variant: 'secondary', size: 'sm', onClick: () => {} })
  const hold = (on) => { showOriginal = on; paint() }
  holdBtn.addEventListener('pointerdown', () => hold(true))
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) holdBtn.addEventListener(ev, () => hold(false))
  holdBtn.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') hold(true) })
  holdBtn.addEventListener('keyup', () => hold(false))
  stg.append(wrap, nameChip, countChip, h('div', { class: 'ia-tools' }, holdBtn), scan.el)
  const msgSlot = h('div')
  const hint = note('mouse-pointer-click', 'Click a box to keep that face visible. Drag on the photo to cover something we missed.')
  const thumbs = strip({ onSelect: (i) => select(items[i]), onRemove: (i) => removeItem(items[i]), onAdd: () => hero.zone.open() })

  // ---------- side panel
  const styleSeg = segmented([['blur', 'Blur'], ['pixelate', 'Pixelate'], ['black', 'Cover']], opts.style, (v) => { opts.style = v; paint() }, 'Effect')
  const strengthR = rangeField('Strength', { min: 20, max: 100, value: opts.strength, format: (v) => `${v}%`, onInput: (v) => { opts.strength = v; paint() } })
  const shapeSeg = segmented([['oval', 'Oval'], ['rect', 'Rounded box']], opts.shape, (v) => { opts.shape = v; paint() }, 'Shape')
  const padR = rangeField('Cover a bit more', { min: 0, max: 80, value: opts.pad, format: (v) => `${v}%`, onInput: (v) => { opts.pad = v; syncBoxes() }, hint: 'Grows each box to include hair and ears.' })
  const sensR = rangeField('Sensitivity', { min: 1, max: 10, step: 1, value: 6, format: (v) => (v >= 8 ? 'High' : v >= 4 ? 'Normal' : 'Low'), onInput: (v) => { opts.sens = Math.round((0.85 - (v - 1) * 0.07) * 100) / 100; rescan() }, hint: 'Higher finds more faces but may add false ones.' })
  const thoroughT = toggle('Look for small faces (slower)', opts.thorough, (v) => { opts.thorough = v; rescan(true) })
  const fmtSeg = segmented([['jpg', 'JPG'], ['png', 'PNG'], ...(canEncode('image/webp') ? [['webp', 'WebP']] : [])], opts.fmt, (v) => { opts.fmt = v; quality.hidden = v === 'png' }, 'File format')
  const quality = rangeField('Quality', { min: 50, max: 100, value: opts.quality, format: (v) => `${v}%`, onInput: (v) => { opts.quality = v } })
  const panel = panelOf(
    section('Hide faces with', 'eye-off', [styleSeg, strengthR, shapeSeg]),
    section('Detection', 'scan-face', [sensR, thoroughT, padR, button('Find faces again', { icon: 'refresh-cw', variant: 'secondary', size: 'sm', onClick: () => rescan(true) })]),
    section('Download', 'download', [h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Format'), fmtSeg), quality, note('shield-check', 'Downloads are re-encoded, so GPS location and camera details in the original are not copied.')], false))
  const dlBtn = button('Download photo', { icon: 'download', variant: 'primary', size: 'lg', block: true })
  dlBtn.addEventListener('click', () => busy(dlBtn, async () => {
    if (!active) return
    await ensureDetected(active)
    const r = await exportItem(active)
    download(r.blob, r.name)
    toast(`Saved. ${r.n} face${r.n === 1 ? '' : 's'} hidden.`, 'success')
  }, { label: 'Preparing file', errorTo: msgSlot }))
  const allBtn = button('Download all as ZIP', { icon: 'archive', variant: 'secondary', block: true })
  const allProg = progress('Working')
  allBtn.addEventListener('click', () => busy(allBtn, async () => {
    const files = []
    for (let i = 0; i < items.length; i++) {
      allProg.set(i / items.length, `Hiding faces in ${items[i].name} (${i + 1} of ${items.length})`)
      await ensureDetected(items[i])
      const r = await exportItem(items[i])
      files.push({ name: r.name, data: r.blob })
    }
    allProg.set(1, 'Zipping')
    download(await zip(files), 'faces-hidden.zip')
    toast(`Saved ${files.length} photos`, 'success')
  }, { label: 'Working', progress: allProg }))
  allBtn.hidden = true
  const actions = h('div', { class: 'stack tight' }, dlBtn, allBtn, allProg.el, button('Start over', { icon: 'rotate-ccw', variant: 'ghost', block: true, onClick: reset }))

  const studioEl = h('div', { class: 'ia-studio', hidden: true },
    h('div', { class: 'ia-main' }, thumbs.el, stg, hint, msgSlot),
    h('div', { class: 'ia-side' }, panel, actions))
  const hero = heroDrop({
    accept: 'image/*', multiple: true, label: 'Drop photos with faces here',
    hint: 'Group shots, crowds, screenshots. Nothing is uploaded. Paste with Ctrl+V works too.',
    icons: ['scan-face', 'eye-off', 'users', 'shield-check'],
    features: [['shield-check', 'Private, on your device'], ['users', 'Finds small faces too'], ['pointer', 'Tap a face to keep it']],
    onFiles: addFiles,
  })
  shell(root, stepper, hero, studioEl)

  // ---------- items
  async function addFiles(files) {
    files = files.slice(0, MAX_FILES - items.length)
    if (!files.length) return toast(`That is the limit for one batch (${MAX_FILES} photos).`)
    for (const f of files) {
      const it = { id: ++seq, file: f, name: f.name, status: '', boxes: null, work: null, prev: null, thumb: null }
      if (/^image\/(jpeg|png|webp|gif|avif|bmp)/.test(fileType(f))) it.thumb = URL.createObjectURL(f)
      items.push(it)
    }
    hero.hidden = true; studioEl.hidden = false
    if (!active) await select(items[items.length - files.length])
    else renderThumbs()
    allBtn.hidden = items.length < 2
  }

  function removeItem(it) {
    items.splice(items.indexOf(it), 1)
    if (it.thumb?.startsWith('blob:')) URL.revokeObjectURL(it.thumb)
    if (!items.length) return reset()
    if (it === active) select(items[0]); else renderThumbs()
    allBtn.hidden = items.length < 2
  }

  function reset() {
    ctl.abort()
    for (const it of items) if (it.thumb?.startsWith('blob:')) URL.revokeObjectURL(it.thumb)
    items.length = 0; active = null
    studioEl.hidden = true; hero.hidden = false
    scan.stop(); clear(msgSlot); clear(overlay); overlay.append(rubber)
    stepper.set(0)
  }

  function renderThumbs() {
    thumbs.render(items.map((it) => ({ name: it.name, thumb: it.thumb, status: it.status })), items.indexOf(active))
  }

  async function ensureWork(it) {
    if (!it.work) {
      it.work = await loadWorking(it.file, { maxSide: 4096 })
      const pc = fitCanvas(it.work.canvas, PREV_MAX)
      it.prev = { canvas: pc, k: pc.width / it.work.width }
      if (!it.thumb) it.thumb = await thumbOf(it.work.canvas)
    }
    return it
  }

  async function ensureDetected(it) {
    await ensureWork(it)
    if (!it.boxes) await detect(it)
  }

  async function detect(it, { onProgress } = {}) {
    it.status = 'run'
    const prev = it.boxes || []
    const found = await detectFaces(it.work.canvas, { minScore: opts.sens, thorough: opts.thorough, signal: ctl.signal, onProgress })
    const old = prev.filter((b) => !b.manual)
    const iou = (a, b) => {
      const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h)
      const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
      return i / (a.w * a.h + b.w * b.h - i)
    }
    const auto = found.map((f) => ({ ...f, manual: false, on: !(old.find((o) => iou(o, f) > 0.5)?.on === false) }))
    it.boxes = [...auto, ...prev.filter((b) => b.manual)]
    it.status = 'done'
    it.sig = `${opts.sens}|${opts.thorough}`
  }

  async function select(it) {
    if (!it) return
    active = it
    renderThumbs()
    clear(msgSlot)
    try {
      await ensureWork(it)
    } catch (e) { clear(msgSlot, alert('error', friendlyError(e).message)); return }
    if (active !== it) return
    nameChip.querySelector('span').textContent = `${it.name}  -  ${it.work.originalWidth} x ${it.work.originalHeight}`
    cv.width = it.prev.canvas.width; cv.height = it.prev.canvas.height
    wrap.style.setProperty('--ar', String(cv.width / cv.height))
    paint()
    drawBoxes()
    if (!it.boxes || it.sig !== `${opts.sens}|${opts.thorough}`) {
      scan.onCancel = () => ctl.abort()
      scan.start('Looking for faces', false)
      stepper.set(1)
      try {
        await detect(it, { onProgress: (f) => active === it && scan.update(f, 'Looking for faces') })
      } catch (e) {
        scan.stop()
        if (e?.code === 'ABORT' || e?.name === 'AbortError') return
        clear(msgSlot, alert('error', friendlyError(e).message, ' ', button('Try again', { size: 'sm', icon: 'refresh-cw', onClick: () => select(it) })))
        it.status = 'error'; renderThumbs()
        return
      }
      scan.stop()
      if (active === it && it.boxes.some((b) => b.on)) burst(stg, 10)
    }
    renderThumbs()
    drawBoxes(); paint()
    stepper.set(2)
  }

  const rescan = debounce(async (now) => {
    if (!active || detecting) return
    detecting = true
    const it = active
    scan.start('Looking for faces')
    try { await detect(it, { onProgress: (f) => scan.update(f, 'Looking for faces') }) } catch (e) { if (e?.code !== 'ABORT') toast(friendlyError(e).message, 'error') }
    scan.stop(); detecting = false
    if (active === it) { drawBoxes(); paint() }
  }, 350)

  // ---------- drawing
  const scaled = (it, k) => it.boxes.filter((b) => b.on).map((b) => growBox(b, opts.pad, it.work.width, it.work.height)).map((b) => ({ x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k }))

  function paint() {
    const it = active
    if (!it?.prev) return
    const ctx = cv.getContext('2d')
    ctx.drawImage(it.prev.canvas, 0, 0)
    if (showOriginal || !it.boxes) return
    applyEffect(cv, scaled(it, it.prev.k), opts)
  }
  const syncBoxes = () => { drawBoxes(); paint() }

  function drawBoxes() {
    const it = active
    for (const n of [...overlay.children]) if (n !== rubber) n.remove()
    if (!it?.boxes) return
    const W = it.work.width, H = it.work.height
    const n = it.boxes.filter((b) => b.on).length
    countChip.querySelector('span').textContent = it.boxes.length ? `${n} of ${it.boxes.length} hidden` : 'No faces found'
    if (!it.boxes.length) clear(msgSlot, alert('info', 'No faces found. Raise the sensitivity, or drag on the photo to cover something by hand.'))
    else clear(msgSlot)
    it.boxes.forEach((b, i) => {
      const g = growBox(b, opts.pad, W, H)
      const el = h('button', {
        type: 'button', class: ['ia-fb-box', b.on && 'on', opts.shape === 'oval' && 'oval'],
        style: { left: `${(g.x / W) * 100}%`, top: `${(g.y / H) * 100}%`, width: `${(g.w / W) * 100}%`, height: `${(g.h / H) * 100}%` },
        'aria-pressed': String(b.on), 'aria-label': `${b.manual ? 'Box' : 'Face'} ${i + 1}, ${b.on ? 'hidden. Press to keep it visible' : 'visible. Press to hide it'}`,
        onclick: (e) => { e.stopPropagation(); b.on = !b.on; drawBoxes(); paint() },
        onpointerdown: (e) => e.stopPropagation(),
      }, h('span', { class: 'tag' }, b.on ? icon('eye-off') : icon('eye'), String(i + 1)))
      if (b.manual) el.append(h('span', { class: 'rm', role: 'button', tabindex: 0, 'aria-label': `Remove box ${i + 1}`, onclick: (e) => { e.stopPropagation(); it.boxes.splice(i, 1); drawBoxes(); paint() } }, icon('x')))
      overlay.append(el)
    })
  }

  // Draw a box by hand
  {
    let s = null
    drag(overlay, (type, e) => {
      const it = active
      if (!it?.boxes) return
      const r = overlay.getBoundingClientRect()
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height
      if (type === 'down') { s = { x: px, y: py }; rubber.hidden = true }
      else if (type === 'move' && s) {
        const x0 = Math.min(s.x, px), y0 = Math.min(s.y, py)
        Object.assign(rubber.style, { left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${Math.abs(px - s.x) * 100}%`, height: `${Math.abs(py - s.y) * 100}%` })
        rubber.hidden = false
      } else if (type === 'up' && s) {
        rubber.hidden = true
        const W = it.work.width, H = it.work.height
        const w = Math.abs(px - s.x) * W, hh = Math.abs(py - s.y) * H
        if (w > 14 && hh > 14) {
          // The drawn box is already the area to hide, so store it shrunk by the current padding.
          const f = 1 / (1 + opts.pad / 100)
          const cx = (Math.min(s.x, px) + Math.abs(px - s.x) / 2) * W, cy = (Math.min(s.y, py) + Math.abs(py - s.y) / 2) * H
          it.boxes.push({ x: cx - (w * f) / 2, y: cy - (hh * f) / 2 + (hh * f * 0.1), w: w * f, h: hh * f, score: 1, manual: true, on: true })
          drawBoxes(); paint()
        }
        s = null
      }
    })
  }

  async function exportItem(it) {
    await ensureWork(it)
    const c = makeCanvas(it.work.width, it.work.height)
    c.getContext('2d').drawImage(it.work.canvas, 0, 0)
    const bx = it.boxes.filter((b) => b.on).map((b) => growBox(b, opts.pad, it.work.width, it.work.height))
    applyEffect(c, bx, opts)
    const type = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[opts.fmt]
    const blob = await canvasBlob(c, type, opts.quality / 100)
    return { blob, name: suffixName(it.name, 'faces-hidden', opts.fmt), n: bx.length }
  }

  return () => { ctl.abort(); for (const it of items) if (it.thumb?.startsWith('blob:')) URL.revokeObjectURL(it.thumb) }
}

let styled = false
function injectStyle() {
  if (styled || document.getElementById('ia-fb-style')) return
  styled = true
  document.head.append(h('style', { id: 'ia-fb-style' }, `
.ia-fb-wrap { position: relative; width: min(100%, calc(72vh * var(--ar, 1))); aspect-ratio: var(--ar, 1); margin: 0 auto; border-radius: 10px; overflow: hidden; }
.ia-fb-cv { position: absolute; inset: 0; width: 100%; height: 100%; max-height: none !important; border-radius: 0 !important; }
.ia-fb-overlay { position: absolute; inset: 0; touch-action: none; cursor: crosshair; }
.ia-fb-box { position: absolute; padding: 0; background: transparent; cursor: pointer; border: 2px dashed rgba(255, 255, 255, .85); box-shadow: 0 0 0 1px rgba(0, 0, 0, .35); border-radius: 14%; transition: border-color .2s, box-shadow .2s, background .2s, transform .25s var(--spring); }
.ia-fb-box.oval { border-radius: 50%; }
.ia-fb-box:hover { background: rgba(255, 255, 255, .12); }
.ia-fb-box:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.ia-fb-box.on { border: 2px solid var(--accent); box-shadow: 0 0 0 1px rgba(255, 255, 255, .6), 0 0 20px -2px var(--accent); animation: ia-pop .35s var(--spring) both; }
.ia-fb-box.rubber { border: 2px dashed var(--accent); background: color-mix(in srgb, var(--accent) 18%, transparent); pointer-events: none; }
.ia-fb-box .tag { position: absolute; top: -11px; left: 50%; transform: translateX(-50%); display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px 1px 6px; border-radius: 999px; font-size: 11px; font-weight: 600; background: rgba(12, 12, 20, .78); color: #fff; backdrop-filter: blur(6px); white-space: nowrap; }
.ia-fb-box.on .tag { background: var(--accent); color: var(--accent-text); }
.ia-fb-box .tag .icon { width: 11px; height: 11px; }
.ia-fb-box .rm { position: absolute; right: -8px; bottom: -8px; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; background: var(--danger); color: #fff; cursor: pointer; }
.ia-fb-box .rm .icon { width: 12px; height: 12px; }
`))
}
