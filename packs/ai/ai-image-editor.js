// AI image editor: describe a change in plain words. Claude looks at the image and returns an edit plan in a fixed JSON schema
// (crop, rotate, flip, resize, tone and filter adjustments, text overlays, blurred regions). The plan is applied locally on a
// canvas: the image never changes unless the plan says so, and every step can be undone.
import { h, button, field, select, textarea, dropzone, alert, clear, panel, split, row, preview, download, busy, icon } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { baseName } from '../../lib/files.js'
import { loadImage, toCanvas, toBlob, fitSize, MAX_PIXELS } from '../../lib/image.js'
import { injectStyle, runner, UNTRUSTED } from './_shared.js'

const WORK_MAX = 3000
const POSITIONS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right']
const OPS = ['crop', 'rotate', 'flip', 'resize', 'brightness', 'contrast', 'saturation', 'warmth', 'blur', 'sharpen', 'grayscale', 'sepia', 'text', 'blur_region']
const SCHEMA = {
  type: 'object',
  properties: {
    explanation: { type: 'string' },
    operations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: OPS },
          amount: { type: 'number' },
          x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' },
          aspect: { type: 'string' },
          degrees: { type: 'number' },
          direction: { type: 'string', enum: ['horizontal', 'vertical'] },
          px_width: { type: 'number' }, px_height: { type: 'number' }, scale: { type: 'number' },
          text: { type: 'string' },
          position: { type: 'string', enum: POSITIONS },
          size: { type: 'number' },
          color: { type: 'string' }, background: { type: 'string' },
          bold: { type: 'boolean' }, italic: { type: 'boolean' }, outline: { type: 'boolean' },
          font: { type: 'string', enum: ['sans', 'serif', 'mono', 'display'] },
          opacity: { type: 'number' },
          shape: { type: 'string', enum: ['rect', 'ellipse'] },
          style: { type: 'string', enum: ['blur', 'pixelate'] },
        },
        required: ['op'],
        additionalProperties: false,
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['explanation', 'operations'],
  additionalProperties: false,
}
const EXAMPLES = ['Make it brighter with more contrast', 'Turn it black and white', 'Crop to a square', 'Add the caption "Summer 2026" at the bottom in white', 'Warm it up a little and sharpen', 'Rotate 90 degrees clockwise', 'Blur any faces or license plates']

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const num = (v, d = 0) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : d)
const mk = (w, hh) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(hh)); return c }
const clone = (c) => { const n = mk(c.width, c.height); n.getContext('2d').drawImage(c, 0, 0); return n }

// ---------- Pixel operations (ImageData, no ctx.filter so every browser behaves the same) ----------
function mapPixels(c, fn) {
  const ctx = c.getContext('2d')
  const img = ctx.getImageData(0, 0, c.width, c.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) fn(d, i)
  ctx.putImageData(img, 0, 0)
}
const b255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v)
const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]

function boxBlurData(img, r) {
  const { width: w, height: hh, data } = img
  r = Math.round(r)
  if (r < 1) return
  const tmp = new Uint8ClampedArray(data.length)
  const pass = (src, dst, len, lines, stride, lineStride) => {
    for (let l = 0; l < lines; l++) {
      for (let ch = 0; ch < 4; ch++) {
        const base = l * lineStride + ch
        let sum = 0
        for (let k = -r; k <= r; k++) sum += src[base + clamp(k, 0, len - 1) * stride]
        for (let p = 0; p < len; p++) {
          dst[base + p * stride] = sum / (2 * r + 1)
          sum += src[base + clamp(p + r + 1, 0, len - 1) * stride] - src[base + clamp(p - r, 0, len - 1) * stride]
        }
      }
    }
  }
  for (let n = 0; n < 3; n++) { pass(data, tmp, w, hh, 4, w * 4); pass(tmp, data, hh, w, w * 4, 4) }
}
function blurCanvas(c, radius) {
  const ctx = c.getContext('2d')
  const img = ctx.getImageData(0, 0, c.width, c.height)
  boxBlurData(img, radius / 1.7)
  ctx.putImageData(img, 0, 0)
}
function sharpenCanvas(c, amount) {
  const a = clamp(amount, 0, 100) / 100
  const ctx = c.getContext('2d')
  const src = ctx.getImageData(0, 0, c.width, c.height)
  const out = ctx.createImageData(c.width, c.height)
  const { width: w, height: hh } = c
  const s = src.data, o = out.data
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      for (let ch = 0; ch < 3; ch++) {
        const up = s[(Math.max(0, y - 1) * w + x) * 4 + ch], dn = s[(Math.min(hh - 1, y + 1) * w + x) * 4 + ch]
        const lf = s[(y * w + Math.max(0, x - 1)) * 4 + ch], rt = s[(y * w + Math.min(w - 1, x + 1)) * 4 + ch]
        o[i + ch] = b255(s[i + ch] * (1 + 4 * a) - a * (up + dn + lf + rt))
      }
      o[i + 3] = s[i + 3]
    }
  }
  ctx.putImageData(out, 0, 0)
}

function region(op, c) {
  const x = clamp(num(op.x), 0, 1), y = clamp(num(op.y), 0, 1)
  const w = clamp(num(op.w, 0.3), 0.01, 1 - x), hh = clamp(num(op.h, 0.3), 0.01, 1 - y)
  return { x: Math.round(x * c.width), y: Math.round(y * c.height), w: Math.max(1, Math.round(w * c.width)), h: Math.max(1, Math.round(hh * c.height)) }
}
function blurRegion(c, op) {
  const r = region(op, c)
  const tmp = mk(r.w, r.h)
  const t = tmp.getContext('2d')
  t.drawImage(c, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
  const strength = clamp(num(op.amount, 40), 1, 100) * (Math.max(c.width, c.height) / 1000)
  if (op.style === 'pixelate') {
    const blockPx = Math.max(4, Math.round(strength * 0.6))
    const small = mk(r.w / blockPx, r.h / blockPx)
    const sctx = small.getContext('2d')
    sctx.imageSmoothingEnabled = true
    sctx.drawImage(tmp, 0, 0, small.width, small.height)
    t.imageSmoothingEnabled = false
    t.clearRect(0, 0, r.w, r.h)
    t.drawImage(small, 0, 0, r.w, r.h)
  } else blurCanvas(tmp, strength)
  const ctx = c.getContext('2d')
  ctx.save()
  ctx.beginPath()
  if (op.shape === 'ellipse') ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2)
  else ctx.rect(r.x, r.y, r.w, r.h)
  ctx.clip()
  ctx.drawImage(tmp, r.x, r.y)
  ctx.restore()
}

// ---------- Geometry ----------
function cropCanvas(c, op) {
  let x, y, w, hh
  if (op.w > 0 && op.h > 0) {
    x = clamp(num(op.x), 0, 0.99); y = clamp(num(op.y), 0, 0.99)
    w = clamp(op.w, 0.01, 1 - x); hh = clamp(op.h, 0.01, 1 - y)
    x *= c.width; y *= c.height; w *= c.width; hh *= c.height
  } else {
    const m = String(op.aspect || '').match(/^(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)$/)
    if (!m) return null
    const ar = +m[1] / +m[2]
    if (c.width / c.height > ar) { hh = c.height; w = hh * ar } else { w = c.width; hh = w / ar }
    x = (c.width - w) / 2; y = (c.height - hh) / 2
  }
  const out = mk(w, hh)
  out.getContext('2d').drawImage(c, Math.round(x), Math.round(y), Math.round(w), Math.round(hh), 0, 0, out.width, out.height)
  return out
}
function rotateCanvas(c, deg) {
  const d = ((deg % 360) + 360) % 360
  if (!d) return c
  const rad = (d * Math.PI) / 180
  const sw = Math.abs(Math.sin(rad)), cw = Math.abs(Math.cos(rad))
  const quarter = d % 90 === 0
  const out = quarter ? mk(d % 180 ? c.height : c.width, d % 180 ? c.width : c.height) : mk(c.width * cw + c.height * sw, c.width * sw + c.height * cw)
  const ctx = out.getContext('2d')
  ctx.translate(out.width / 2, out.height / 2)
  ctx.rotate(rad)
  ctx.drawImage(c, -c.width / 2, -c.height / 2)
  return out
}
function flipCanvas(c, dir) {
  const out = mk(c.width, c.height)
  const ctx = out.getContext('2d')
  if (dir === 'vertical') { ctx.translate(0, c.height); ctx.scale(1, -1) } else { ctx.translate(c.width, 0); ctx.scale(-1, 1) }
  ctx.drawImage(c, 0, 0)
  return out
}
function resizeCanvas(c, op) {
  let w = num(op.px_width), hh = num(op.px_height)
  if (op.scale > 0) { w = c.width * op.scale; hh = c.height * op.scale }
  else if (w > 0 && !(hh > 0)) hh = (w * c.height) / c.width
  else if (hh > 0 && !(w > 0)) w = (hh * c.width) / c.height
  if (!(w > 0 && hh > 0)) return null
  const f = fitSize(w, hh, 8192, 8192)
  w = f.width; hh = f.height
  if (w * hh > MAX_PIXELS) { const k = Math.sqrt(MAX_PIXELS / (w * hh)); w *= k; hh *= k }
  const out = mk(w, hh)
  const ctx = out.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(c, 0, 0, out.width, out.height)
  return out
}

// ---------- Text ----------
const FONTS = { sans: 'system-ui, "Segoe UI", Arial, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: 'Consolas, "Courier New", monospace', display: 'Impact, "Arial Black", sans-serif' }
function safeColor(v, fallback) {
  const t = mk(1, 1).getContext('2d')
  t.fillStyle = '#010203'
  t.fillStyle = String(v || '')
  const a = t.fillStyle
  t.fillStyle = '#040506'
  t.fillStyle = String(v || '')
  return a === t.fillStyle && v ? String(v) : fallback
}
function drawText(c, op) {
  const text = String(op.text || '').trim()
  if (!text) return false
  const ctx = c.getContext('2d')
  const fontPx = Math.max(8, Math.round((clamp(num(op.size, 6), 1, 40) / 100) * c.height))
  ctx.font = `${op.italic ? 'italic ' : ''}${op.bold ? '700' : '500'} ${fontPx}px ${FONTS[op.font] || FONTS.sans}`
  ctx.textBaseline = 'top'
  const maxW = c.width * 0.9
  const lines = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/)) {
      const t = line ? `${line} ${word}` : word
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = word } else line = t
    }
    lines.push(line)
  }
  const lh = fontPx * 1.2
  const bw = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width)))
  const bh = lines.length * lh
  const pad = op.background ? fontPx * 0.35 : 0
  const margin = Math.min(c.width, c.height) * 0.04
  let cx, cy
  if (Number.isFinite(+op.x) && Number.isFinite(+op.y) && op.x !== undefined && op.y !== undefined) { cx = clamp(op.x, 0, 1) * c.width; cy = clamp(op.y, 0, 1) * c.height } else {
    const pos = POSITIONS.includes(op.position) ? op.position : 'bottom'
    const hx = pos.includes('left') ? 'l' : pos.includes('right') ? 'r' : 'c'
    const vy = pos.startsWith('top') ? 't' : pos.startsWith('bottom') ? 'b' : 'm'
    cx = hx === 'l' ? margin + pad + bw / 2 : hx === 'r' ? c.width - margin - pad - bw / 2 : c.width / 2
    cy = vy === 't' ? margin + pad + bh / 2 : vy === 'b' ? c.height - margin - pad - bh / 2 : c.height / 2
  }
  const left = clamp(cx - bw / 2, pad, Math.max(pad, c.width - bw - pad)), top = clamp(cy - bh / 2, pad, Math.max(pad, c.height - bh - pad))
  ctx.save()
  ctx.globalAlpha = clamp(num(op.opacity, 1), 0.05, 1)
  if (op.background) {
    ctx.fillStyle = safeColor(op.background, 'rgba(0,0,0,.55)')
    ctx.beginPath()
    ctx.roundRect(left - pad, top - pad, bw + pad * 2, bh + pad * 2, fontPx * 0.25)
    ctx.fill()
  }
  const color = safeColor(op.color, '#ffffff')
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  const rgb = ((x) => { const t = mk(1, 1).getContext('2d'); t.fillStyle = x; t.fillRect(0, 0, 1, 1); return t.getImageData(0, 0, 1, 1).data })(color)
  const dark = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] < 140
  const outline = op.outline ?? !op.background
  lines.forEach((l, i) => {
    const y = top + i * lh + (lh - fontPx) / 2
    if (outline) { ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, fontPx / 9); ctx.strokeStyle = dark ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.6)'; ctx.strokeText(l, left + bw / 2, y) }
    ctx.fillText(l, left + bw / 2, y)
  })
  ctx.restore()
  return true
}

/** One-line description of an operation for the plan list. */
export function describe(op) {
  const a = num(op.amount, NaN)
  const sign = (v) => (v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`)
  switch (op.op) {
    case 'brightness': case 'contrast': case 'saturation': case 'warmth': return `${op.op[0].toUpperCase()}${op.op.slice(1)} ${sign(num(a))}`
    case 'blur': return `Blur ${Math.round(num(a, 5))}`
    case 'sharpen': return `Sharpen ${Math.round(num(a, 50))}`
    case 'grayscale': return 'Black and white'
    case 'sepia': return 'Sepia tone'
    case 'crop': return op.aspect && !(op.w > 0) ? `Crop to ${op.aspect}` : `Crop to ${Math.round(num(op.w) * 100)}% x ${Math.round(num(op.h) * 100)}% at (${Math.round(num(op.x) * 100)}%, ${Math.round(num(op.y) * 100)}%)`
    case 'rotate': return `Rotate ${Math.round(num(op.degrees))} degrees clockwise`
    case 'flip': return `Flip ${op.direction === 'vertical' ? 'vertically' : 'horizontally'}`
    case 'resize': return op.scale > 0 ? `Resize to ${Math.round(op.scale * 100)}%` : `Resize to ${op.px_width || 'auto'} x ${op.px_height || 'auto'} px`
    case 'text': return `Add text "${String(op.text || '').slice(0, 40)}" (${op.position || 'bottom'})`
    case 'blur_region': return `${op.style === 'pixelate' ? 'Pixelate' : 'Blur'} an area (${Math.round(num(op.x) * 100)}%, ${Math.round(num(op.y) * 100)}%, ${Math.round(num(op.w) * 100)}% wide)`
    default: return String(op.op)
  }
}

const TONAL = new Set(['brightness', 'contrast', 'saturation', 'warmth', 'blur', 'sharpen', 'grayscale', 'sepia'])
const GEOM = new Set(['crop', 'rotate', 'flip', 'resize'])

/**
 * Apply an edit plan to a canvas (the source is never modified). Order: tone and filters, blurred regions (coordinates refer to the
 * picture as it is now), geometry in the given order, then text (placed on the final picture).
 * Returns {canvas, applied: [description], skipped: [reason]}.
 */
export function applyOps(source, ops) {
  let c = clone(source)
  const applied = [], skipped = []
  const list = (Array.isArray(ops) ? ops : []).filter((o) => o && OPS.includes(o.op))
  for (const o of (Array.isArray(ops) ? ops : [])) if (!o || !OPS.includes(o?.op)) skipped.push(`Unknown step "${o?.op}"`)
  const run = (o, fn) => { try { const r = fn(); if (r === false || r === null) skipped.push(`${describe(o)}: nothing to do`); else applied.push(describe(o)) } catch (e) { skipped.push(`${describe(o)}: ${e.message}`) } }
  for (const o of list.filter((x) => TONAL.has(x.op))) {
    const a = num(o.amount, NaN)
    run(o, () => {
      switch (o.op) {
        case 'brightness': { const f = 1 + clamp(num(a), -100, 100) / 100; mapPixels(c, (d, i) => { d[i] *= f; d[i + 1] *= f; d[i + 2] *= f }); break }
        case 'contrast': { const k = clamp(num(a), -100, 100) * 2.55; const f = (259 * (k + 255)) / (255 * (259 - k)); mapPixels(c, (d, i) => { d[i] = f * (d[i] - 128) + 128; d[i + 1] = f * (d[i + 1] - 128) + 128; d[i + 2] = f * (d[i + 2] - 128) + 128 }); break }
        case 'saturation': { const s = 1 + clamp(num(a), -100, 100) / 100; mapPixels(c, (d, i) => { const g = luma(d, i); d[i] = g + (d[i] - g) * s; d[i + 1] = g + (d[i + 1] - g) * s; d[i + 2] = g + (d[i + 2] - g) * s }); break }
        case 'warmth': { const k = clamp(num(a), -100, 100) * 0.5; mapPixels(c, (d, i) => { d[i] += k; d[i + 1] += k * 0.15; d[i + 2] -= k }); break }
        case 'grayscale': { const t = clamp(num(a, 100), 0, 100) / 100; mapPixels(c, (d, i) => { const g = luma(d, i); d[i] += (g - d[i]) * t; d[i + 1] += (g - d[i + 1]) * t; d[i + 2] += (g - d[i + 2]) * t }); break }
        case 'sepia': { const t = clamp(num(a, 100), 0, 100) / 100; mapPixels(c, (d, i) => { const r = d[i], g = d[i + 1], b = d[i + 2]; d[i] += (0.393 * r + 0.769 * g + 0.189 * b - r) * t; d[i + 1] += (0.349 * r + 0.686 * g + 0.168 * b - g) * t; d[i + 2] += (0.272 * r + 0.534 * g + 0.131 * b - b) * t }); break }
        case 'blur': blurCanvas(c, clamp(num(a, 5), 0, 50) * (Math.max(c.width, c.height) / 1000)); break
        case 'sharpen': sharpenCanvas(c, num(a, 50)); break
        default:
      }
    })
  }
  for (const o of list.filter((x) => x.op === 'blur_region')) run(o, () => blurRegion(c, o))
  for (const o of list.filter((x) => GEOM.has(x.op))) {
    run(o, () => {
      const out = o.op === 'crop' ? cropCanvas(c, o) : o.op === 'rotate' ? rotateCanvas(c, num(o.degrees)) : o.op === 'flip' ? flipCanvas(c, o.direction) : resizeCanvas(c, o)
      if (!out) return null
      c = out
    })
  }
  for (const o of list.filter((x) => x.op === 'text')) run(o, () => drawText(c, o))
  return { canvas: c, applied, skipped }
}

export function mount(root, { signal }) {
  injectStyle()
  let original = null
  const history = [] // {canvas, ops, instruction, explanation}
  const status = h('div')
  const stage = h('div')
  const planBox = h('div')
  const zone = dropzone({ accept: 'image/*,.heic,.heif', label: 'Drop a photo to edit', icon: 'wand-sparkles', hint: 'JPG, PNG, WebP, HEIC · or paste with Ctrl+V', onFiles: ([f]) => load(f) })
  const instr = textarea({ rows: 3, placeholder: 'What should change? e.g. "brighten it, crop to a square and add the caption Sunday market at the bottom".', 'aria-label': 'Edit instruction', maxlength: 1200 })
  const go = button('Apply edit', { icon: 'wand-sparkles', variant: 'primary', size: 'lg', disabled: true })
  const run = runner({ btn: go, errorTo: status, signal, label: 'Planning' })
  const undo = button('Undo', { icon: 'undo-2', disabled: true })
  const reset = button('Start over', { icon: 'rotate-ccw', disabled: true })
  const compare = button('Hold to compare', { icon: 'eye', disabled: true })
  const fmt = select([['image/png', 'PNG'], ['image/jpeg', 'JPEG'], ['image/webp', 'WebP']], 'image/png')
  const dl = button('Download', { icon: 'download', variant: 'primary', disabled: true })
  const info = h('div', { class: 'small muted' })
  let fileName = 'image'

  const cur = () => (history.length ? history.at(-1).canvas : original)
  function paint(c) {
    const view = mk(c.width, c.height)
    view.getContext('2d').drawImage(c, 0, 0)
    view.setAttribute('role', 'img'); view.setAttribute('aria-label', 'Image being edited')
    clear(stage, preview(view))
    info.textContent = `${c.width} x ${c.height} px`
  }
  function sync() {
    const has = !!original
    go.disabled = !has
    undo.disabled = !history.length
    reset.disabled = !history.length
    compare.disabled = !history.length
    dl.disabled = !has
    zone.classList.toggle('compact', has)
  }
  async function load(f) {
    clear(status); clear(planBox); history.length = 0
    try {
      const img = await loadImage(f)
      const { width, height } = fitSize(img.naturalWidth, img.naturalHeight, WORK_MAX, WORK_MAX)
      original = toCanvas(img, width, height)
      fileName = baseName(f.name)
      if (width < img.naturalWidth) clear(status, alert('info', `Large photo: editing a ${width} x ${height} px working copy so it stays fast. The download is that size.`))
      paint(original); sync()
    } catch (e) { original = null; clear(stage); sync(); clear(status, alert('error', e.message || 'Could not open that image.')) }
  }

  function showPlan(entry) {
    clear(planBox, panel(h('div', { class: 'stack' },
      h('h2', 'What was done'),
      entry.explanation && h('p', { style: 'margin:0;color:var(--text-2)' }, entry.explanation),
      entry.applied.length ? h('ol', { style: 'margin:0;padding-left:20px;display:grid;gap:4px' }, entry.applied.map((a) => h('li', a))) : alert('warn', 'The AI did not find anything to change for that request. Try describing it differently.'),
      entry.skipped.length ? alert('warn', h('strong', 'Skipped: '), entry.skipped.join('; ')) : null,
      entry.warnings?.length ? h('p', { class: 'small muted', style: 'margin:0' }, entry.warnings.join(' ')) : null,
      h('details', null, h('summary', { class: 'small muted', style: 'cursor:pointer' }, 'Edit plan (JSON)'), h('pre', { class: 'code-out', style: 'margin-top:8px;max-height:200px' }, JSON.stringify({ operations: entry.ops }, null, 2))))))
  }

  go.addEventListener('click', () => run.go(async (sig) => {
    const text = instr.value.trim()
    if (!text) throw new Error('Say what you want changed first.')
    const base = cur()
    const block = await ai.imageBlock(base)
    const system = `You are the planner of an image editor. Look at the image and the instruction, then return an edit plan as JSON. ${UNTRUSTED}
The image is ${base.width} x ${base.height} pixels. Only use the allowed operations; do the minimum the instruction needs, and never make up changes the user did not ask for.
Operations: brightness, contrast, saturation, warmth (amount -100..100; 0 changes nothing; typical edits are 10 to 30), blur (amount 1..30 px at 1000 px wide), sharpen (amount 0..100), grayscale and sepia (amount 0..100, default 100), flip (direction), rotate (degrees clockwise, any number), resize (px_width and/or px_height, or scale as a fraction), crop (x, y, w, h as fractions 0..1 of the picture as it is now, or just aspect like "1:1" or "16:9" for a centered crop), blur_region (x, y, w, h fractions of the picture as it is now, shape rect or ellipse, style blur or pixelate, amount 1..100; use it to hide faces, plates or private text, and place the region carefully from what you can see), text (text, position one of ${POSITIONS.join(', ')}, size as percent of picture height 2..15, color, optional background color, bold, italic, font sans/serif/mono/display, outline, opacity).
Order matters little: the editor applies tone and filters first, then blur_region, then crop/rotate/flip/resize in the order you give, then text. Text positions refer to the FINAL picture after cropping and resizing. blur_region coordinates refer to the picture BEFORE cropping, rotating or resizing. If the request cannot be done with these operations, return an empty operations array and say why in warnings. explanation is one friendly sentence on what you will do.`
    const plan = await ai.ask({ system, json: SCHEMA, effort: 'low', signal: sig, messages: [{ role: 'user', content: [block, ai.textBlock(`Instruction: ${text}`)] }] })
    const ops = Array.isArray(plan.operations) ? plan.operations : []
    const res = applyOps(base, ops)
    const entry = { canvas: res.canvas, ops, instruction: text, explanation: plan.explanation, applied: res.applied, skipped: res.skipped, warnings: plan.warnings }
    if (res.applied.length) { history.push(entry); paint(res.canvas); instr.value = '' }
    showPlan(entry)
    sync()
  }, { label: 'Planning' }))

  undo.addEventListener('click', () => { history.pop(); paint(cur()); history.length ? showPlan(history.at(-1)) : clear(planBox); sync() })
  reset.addEventListener('click', () => { history.length = 0; paint(original); clear(planBox); sync() })
  const down = () => { if (history.length) paint(original) }
  const up = () => { if (history.length) paint(cur()) }
  compare.addEventListener('pointerdown', down); compare.addEventListener('pointerup', up); compare.addEventListener('pointerleave', up); compare.addEventListener('pointercancel', up)
  compare.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') down() }); compare.addEventListener('keyup', up)

  dl.addEventListener('click', () => busy(dl, async () => {
    let c = cur()
    if (fmt.value === 'image/jpeg') c = toCanvas(c, c.width, c.height, { background: '#ffffff' })
    download(await toBlob(c, fmt.value, 0.92), `${fileName}-edited.${{ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[fmt.value]}`)
  }, 'Preparing'))

  root.append(h('div', { class: 'stack' }, ai.notice(),
    split(
      panel(h('div', { class: 'stack' }, zone, stage, info,
        h('div', { class: 'row', style: 'gap:8px' }, undo, reset, compare, h('span', { class: 'grow' }), fmt, dl))),
      panel(h('div', { class: 'stack' },
        field('What should change?', instr),
        h('div', { class: 'ai-chips' }, EXAMPLES.map((ex) => h('button', { type: 'button', class: 'ai-chip', onclick: () => { instr.value = ex; instr.focus() } }, icon('sparkles'), h('span', ex)))),
        row(go, run.stop), status,
        planBox,
        h('p', { class: 'small muted' }, 'Claude looks at the picture and writes an edit plan. The edits run on your device, so nothing is regenerated or invented: only the steps listed are applied. You can keep giving instructions and undo any step.'))), 'wide-left')))
}
