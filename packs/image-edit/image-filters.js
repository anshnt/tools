// Adjust & filter image: brightness, contrast, saturation, hue, warmth, blur, sharpen, grayscale, sepia, invert, vignette,
// one-click presets with live thumbnails, and a before/after slider. One pixel pipeline runs on the preview and on the full-size export.
import { progress } from '../../lib/ui.js'
import { canvas } from '../../lib/image.js'
import {
  shell, h, icon, button, busy, section, hint, tiles, slider, compare, batchSlot, results, runBatch, readSource, previewCanvas, outputPicker,
  encodeWith, outName, clear, toast, errorMessage,
} from './_kit.js'

export const NEUTRAL = { brightness: 0, contrast: 0, saturation: 0, hue: 0, warmth: 0, sepia: 0, grayscale: 0, invert: 0, blur: 0, sharpen: 0, vignette: 0 }
export const PRESETS = {
  original: { label: 'Original', v: {} },
  vivid: { label: 'Vivid', v: { contrast: 15, saturation: 35, sharpen: 20 } },
  warm: { label: 'Warm', v: { warmth: 35, saturation: 8, brightness: 5 } },
  cool: { label: 'Cool', v: { warmth: -35, contrast: 8, saturation: 5 } },
  bw: { label: 'B&W', v: { grayscale: 100, contrast: 15 } },
  noir: { label: 'Noir', v: { grayscale: 100, contrast: 45, brightness: -10, vignette: 45 } },
  sepia: { label: 'Sepia', v: { sepia: 100, vignette: 20 } },
  vintage: { label: 'Vintage', v: { sepia: 45, contrast: -10, saturation: -15, warmth: 15, vignette: 35, brightness: 5 } },
  fade: { label: 'Fade', v: { contrast: -20, brightness: 12, saturation: -25 } },
  dramatic: { label: 'Dramatic', v: { contrast: 40, saturation: -10, brightness: -8, vignette: 40, sharpen: 30 } },
  soft: { label: 'Soft', v: { blur: 2, brightness: 10, saturation: 15 } },
  negative: { label: 'Negative', v: { invert: 100 } },
}
const SLIDERS = [
  ['Light', 'sun', [['brightness', 'Brightness', -100, 100], ['contrast', 'Contrast', -100, 100]]],
  ['Color', 'palette', [['saturation', 'Saturation', -100, 100], ['hue', 'Hue shift', -180, 180, '°'], ['warmth', 'Warmth', -100, 100], ['sepia', 'Sepia', 0, 100], ['grayscale', 'Grayscale', 0, 100], ['invert', 'Invert', 0, 100]]],
  ['Detail', 'focus', [['blur', 'Blur', 0, 20], ['sharpen', 'Sharpen', 0, 100]]],
  ['Effects', 'sparkles', [['vignette', 'Vignette', 0, 100]]],
]

// ----- color math: everything before blur is one affine 3x3 + offset
const mul = (a, b) => [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]))
const apply3 = (m, v) => [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2])
const I3 = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
const mix = (a, b, t) => a.map((row, i) => row.map((x, j) => x * (1 - t) + b[i][j] * t))

/** Combine the color adjustments into {A, t} so that out = A * rgb + t (values 0..1). */
export function colorMatrix(s) {
  let A = I3(), t = [0, 0, 0]
  const lin = (M) => { A = mul(M, A); t = apply3(M, t) }
  const aff = (k, off) => { A = A.map((r) => r.map((x) => x * k)); t = t.map((x) => x * k + off) }
  aff(1 + s.brightness / 100, 0)
  { const k = 1 + s.contrast / 100; aff(k, 0.5 * (1 - k)) }
  { const k = 1 + s.saturation / 100, [r, g, b] = [0.2126, 0.7152, 0.0722]
    lin([[r + (1 - r) * k, g - g * k, b - b * k], [r - r * k, g + (1 - g) * k, b - b * k], [r - r * k, g - g * k, b + (1 - b) * k]]) }
  if (s.hue) {
    const a = (s.hue * Math.PI) / 180, c = Math.cos(a), n = Math.sin(a)
    lin([[0.213 + c * 0.787 - n * 0.213, 0.715 - c * 0.715 - n * 0.715, 0.072 - c * 0.072 + n * 0.928], [0.213 - c * 0.213 + n * 0.143, 0.715 + c * 0.285 + n * 0.140, 0.072 - c * 0.072 - n * 0.283], [0.213 - c * 0.213 - n * 0.787, 0.715 - c * 0.715 + n * 0.715, 0.072 + c * 0.928 + n * 0.072]])
  }
  if (s.sepia) lin(mix(I3(), [[0.393, 0.769, 0.189], [0.349, 0.686, 0.168], [0.272, 0.534, 0.131]], s.sepia / 100))
  if (s.grayscale) lin(mix(I3(), [[0.2126, 0.7152, 0.0722], [0.2126, 0.7152, 0.0722], [0.2126, 0.7152, 0.0722]], s.grayscale / 100))
  if (s.warmth) { const w = s.warmth / 100; lin([[1 + 0.22 * w, 0, 0], [0, 1 + 0.02 * w, 0], [0, 0, 1 - 0.22 * w]]) }
  if (s.invert) { const i = s.invert / 100; aff(1 - 2 * i, i) }
  return { A, t }
}

export function boxBlur(src, w, hh, r, passes = 2) {
  r = Math.round(r)
  if (r < 1) return src
  const pass = (from, to, horizontal) => {
    const n = horizontal ? w : hh, lines = horizontal ? hh : w
    const stride = horizontal ? 4 : w * 4, lineStride = horizontal ? w * 4 : 4
    const div = 2 * r + 1
    for (let l = 0; l < lines; l++) {
      const base = l * lineStride
      for (let c = 0; c < 4; c++) {
        let sum = 0
        for (let k = -r; k <= r; k++) sum += from[base + Math.min(n - 1, Math.max(0, k)) * stride + c]
        for (let p = 0; p < n; p++) {
          to[base + p * stride + c] = sum / div
          sum += from[base + Math.min(n - 1, p + r + 1) * stride + c] - from[base + Math.max(0, p - r) * stride + c]
        }
      }
    }
  }
  const a = src.slice(), b = new Uint8ClampedArray(src.length)
  for (let i = 0; i < passes; i++) { pass(a, b, true); pass(b, a, false) }
  return a
}

/** Apply all adjustments to ImageData-like {data, width, height} in place. scale = imageWidth / 1000 keeps blur and sharpen consistent between preview and export. */
export function applyFilters(img, s, scale = 1) {
  const { data, width: w, height: hh } = img
  const { A, t } = colorMatrix(s)
  const identity = A.every((r, i) => r.every((x, j) => Math.abs(x - (i === j ? 1 : 0)) < 1e-9)) && t.every((x) => Math.abs(x) < 1e-9)
  if (!identity) {
    const [a0, a1, a2] = A[0], [b0, b1, b2] = A[1], [c0, c1, c2] = A[2]
    const ot0 = t[0] * 255, ot1 = t[1] * 255, ot2 = t[2] * 255
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2]
      data[i] = a0 * r + a1 * g + a2 * b + ot0
      data[i + 1] = b0 * r + b1 * g + b2 * b + ot1
      data[i + 2] = c0 * r + c1 * g + c2 * b + ot2
    }
  }
  if (s.blur > 0) data.set(boxBlur(data, w, hh, (s.blur * scale) / 1.6))
  if (s.sharpen > 0) {
    const blurred = boxBlur(data, w, hh, Math.max(1, 1.2 * scale))
    const k = (s.sharpen / 100) * 1.6
    for (let i = 0; i < data.length; i += 4) {
      data[i] += k * (data[i] - blurred[i]); data[i + 1] += k * (data[i + 1] - blurred[i + 1]); data[i + 2] += k * (data[i + 2] - blurred[i + 2])
    }
  }
  if (s.vignette > 0) {
    const v = (s.vignette / 100) * 0.9, cx = (w - 1) / 2, cy = (hh - 1) / 2
    for (let y = 0; y < hh; y++) {
      const ny = (y - cy) / cy
      for (let x = 0; x < w; x++) {
        const nx = (x - cx) / cx
        const d = Math.min(1, Math.sqrt(nx * nx + ny * ny) / 1.4142)
        const e = Math.max(0, (d - 0.3) / 0.7)
        const f = 1 - v * e * e * (3 - 2 * e)
        const i = (y * w + x) * 4
        data[i] *= f; data[i + 1] *= f; data[i + 2] *= f
      }
    }
  }
  return img
}

/** Filter a canvas into a new canvas. */
export function filterCanvas(src, s, scale) {
  const c = canvas(src.width, src.height)
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(src, 0, 0)
  const id = ctx.getImageData(0, 0, c.width, c.height)
  applyFilters(id, s, scale)
  ctx.putImageData(id, 0, 0)
  return c
}

export function mount(root, { params, signal }) {
  const start = PRESETS[({ invert: 'negative', mono: 'bw' })[params.preset] || params.preset] ? ({ invert: 'negative', mono: 'bw' })[params.preset] || params.preset : 'original'
  let s = { ...NEUTRAL, ...PRESETS[start].v }
  let preset = start
  let active = null, seq = 0
  const sliders = {}

  const strip = h('div', { class: 'ie-presets', role: 'group', 'aria-label': 'Presets' })
  const before = h('canvas'), after = h('canvas')
  const cmp = compare({ before, after, labels: ['Original', 'Edited'] })
  const info = h('div')
  const out = outputPicker({ formats: ['png', 'jpg', 'webp'], value: 'same' })

  const sliderSecs = SLIDERS.map(([title, ic, items]) => section(title, ic, ...items.map(([key, label, min, max, unit = '']) => {
    const el = slider(label, { min, max, value: s[key], format: (v) => `${v}${unit}`, onInput: (v) => { s[key] = v; setPreset('custom'); drawSoon() } })
    sliders[key] = el
    return el
  })))
  const syncSliders = () => { for (const k of Object.keys(sliders)) sliders[k].set(s[k]) }

  function setPreset(id) {
    preset = id
    for (const b of strip.children) b.setAttribute('aria-pressed', String(b.dataset.id === id))
  }
  function choose(id) {
    s = { ...NEUTRAL, ...PRESETS[id].v }
    setPreset(id); syncSliders(); draw()
  }
  const reset = button('Reset', { icon: 'undo-2', variant: 'ghost', size: 'sm', onClick: () => choose('original') })

  let timer = 0
  const drawSoon = () => { cancelAnimationFrame(timer); timer = requestAnimationFrame(draw) }
  function draw() {
    if (!active) return
    const c = filterCanvas(active.prev, s, active.prev.width / 1000)
    after.width = c.width; after.height = c.height
    after.getContext('2d').drawImage(c, 0, 0)
    const changed = Object.keys(NEUTRAL).filter((k) => s[k] !== 0).length
    clear(info, changed ? tiles([{ label: 'Adjustments', value: String(changed), sub: Object.keys(NEUTRAL).filter((k) => s[k] !== 0).map((k) => `${k} ${s[k] > 0 ? '+' : ''}${s[k]}`).join(', '), hot: true }]) : hint('Pick a preset or move a slider. Drag the divider to compare.', 'wand-sparkles'))
  }

  function buildStrip(prev) {
    const small = previewCanvas(prev, 120)
    clear(strip, Object.entries(PRESETS).map(([id, p]) => {
      const t = filterCanvas(small, { ...NEUTRAL, ...p.v }, small.width / 1000)
      t.setAttribute('aria-hidden', 'true')
      return h('button', { type: 'button', class: 'ie-preset', 'data-id': id, 'aria-pressed': String(id === preset), onclick: () => choose(id) }, t, h('span', p.label))
    }))
  }

  async function select(file) {
    if (!file) { active = null; work.hidden = true; stripWrap.hidden = true; return }
    try {
      const src = await readSource(file)
      const prev = previewCanvas(src.img, 1100)
      active = { file, src, prev }
      before.width = prev.width; before.height = prev.height
      before.getContext('2d').drawImage(prev, 0, 0)
      cmp.setAspect(prev.width, prev.height)
      cmp.setPos(50)
      buildStrip(prev)
      work.hidden = false; stripWrap.hidden = false
      draw()
    } catch (e) { toast(errorMessage(e), 'error') }
  }
  const slot = batchSlot({ ic: 'sliders-horizontal', onChange: (fs) => { goBtn.querySelector('span').textContent = fs.length > 1 ? `Apply to ${fs.length} images` : 'Save image'; if (!fs.length) select(null) }, onSelect: select })

  const prog = progress()
  const res = results({ zipName: 'edited-images.zip', compare: false, noun: 'image' })
  const goBtn = button('Save image', { icon: 'sliders-horizontal', variant: 'primary', size: 'lg', block: true })
  goBtn.addEventListener('click', () => busy(goBtn, async () => {
    const files = [...slot.files]
    if (!files.length) return
    const snapshot = { ...s }
    await runBatch(files, async (file) => {
      const src = await readSource(file)
      const base = canvas(src.w, src.h)
      base.getContext('2d').drawImage(src.img, 0, 0, src.w, src.h)
      const c = filterCanvas(base, snapshot, src.w / 1000)
      const pick = out.resolve(src)
      return { name: outName(file.name, preset === 'negative' ? 'negative' : 'edited', pick.fmt), blob: await encodeWith(c, pick), w: c.width, h: c.height, inSize: file.size, original: file }
    }, { out: res, prog, signal, label: 'Editing' })
  }, { label: 'Saving', progress: prog }))

  const style = h('style', `
.ie-presets{display:flex;gap:10px;overflow-x:auto;padding:4px 2px 10px;scrollbar-width:thin}
.ie-preset{flex:none;width:92px;border:2px solid transparent;border-radius:16px;background:var(--surface);padding:0;cursor:pointer;overflow:hidden;text-align:center;box-shadow:var(--shadow-sm);transition:transform .3s var(--spring),border-color .2s,box-shadow .3s}
.ie-preset:hover{transform:translateY(-3px)}
.ie-preset canvas{display:block;width:100%;height:68px;object-fit:cover}
.ie-preset span{display:block;font-size:12px;font-weight:600;padding:5px 4px 6px;color:var(--text-2)}
.ie-preset[aria-pressed="true"]{border-color:var(--accent);box-shadow:0 12px 22px -12px var(--accent)}
.ie-preset[aria-pressed="true"] span{color:var(--accent)}`)
  const side = h('aside', { class: 'ie-side ie-glass' }, ...sliderSecs, out.el, h('div', { class: 'ie-foot' }, goBtn, reset, prog.el))
  const stripWrap = h('div', { hidden: true }, strip)
  const work = h('div', { class: 'ie-work', hidden: true }, h('div', { class: 'ie-main pin live' }, cmp, info), side)
  root.append(shell(style, slot.el, stripWrap, work, res.el))
}
