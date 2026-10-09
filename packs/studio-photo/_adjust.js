// Adjustment math (non-destructive adjustment layers) and destructive filters. Everything works on RGBA Uint8ClampedArray data.
import { clamp, hexToRgb, rgbToHsl, hslToRgb } from './_util.js'
import { blurArray } from './_select.js'

const lutOf = (fn) => { const l = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) l[i] = fn(i); return l }
const identityLut = () => lutOf((i) => i)

/** Monotone cubic spline through points [[x,y],...] (0..255) -> 256-entry LUT. */
export function curveLut(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0]).filter((p, i, a) => !i || p[0] !== a[i - 1][0])
  if (pts.length < 2) return identityLut()
  const n = pts.length
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const dx = [], m = []
  for (let i = 0; i < n - 1; i++) { dx.push(xs[i + 1] - xs[i]); m.push((ys[i + 1] - ys[i]) / dx[i]) }
  const t = [m[0]]
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2)
  t.push(m[n - 2])
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i] }
  }
  return lutOf((x) => {
    if (x <= xs[0]) return ys[0]
    if (x >= xs[n - 1]) return ys[n - 1]
    let i = 0
    while (x > xs[i + 1]) i++
    const h = dx[i], u = (x - xs[i]) / h
    const u2 = u * u, u3 = u2 * u
    return clamp((2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * h * t[i] + (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * h * t[i + 1], 0, 255)
  })
}

/** 256-entry RGB lookup for a gradient map. stops: [[0..1, '#rrggbb'], ...] */
export function gradientLut(stops) {
  const s = [...stops].sort((a, b) => a[0] - b[0]).map(([p, c]) => [p, hexToRgb(c)])
  const out = new Uint8ClampedArray(256 * 3)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let a = s[0], b = s[s.length - 1]
    for (let k = 0; k < s.length - 1; k++) if (t >= s[k][0] && t <= s[k + 1][0]) { a = s[k]; b = s[k + 1]; break }
    const f = b[0] === a[0] ? 0 : clamp((t - a[0]) / (b[0] - a[0]), 0, 1)
    const col = t <= s[0][0] ? s[0][1] : t >= s[s.length - 1][0] ? s[s.length - 1][1] : a[1].map((v, j) => v + (b[1][j] - v) * f)
    out[i * 3] = col[0]; out[i * 3 + 1] = col[1]; out[i * 3 + 2] = col[2]
  }
  return out
}

const num = (v, d) => (Number.isFinite(v) ? v : d)

/** Registry: names, icons, defaults and slider schema (the UI builds its controls from this). */
export const ADJUSTMENTS = {
  brightness: { name: 'Brightness/Contrast', icon: 'sun', defaults: { brightness: 0, contrast: 0 },
    controls: [{ k: 'brightness', label: 'Brightness', min: -100, max: 100 }, { k: 'contrast', label: 'Contrast', min: -100, max: 100 }] },
  exposure: { name: 'Exposure', icon: 'aperture', defaults: { exposure: 0, offset: 0, gamma: 1 },
    controls: [{ k: 'exposure', label: 'Exposure (EV)', min: -4, max: 4, step: 0.05 }, { k: 'offset', label: 'Offset', min: -0.5, max: 0.5, step: 0.01 }, { k: 'gamma', label: 'Gamma', min: 0.2, max: 3, step: 0.01 }] },
  huesat: { name: 'Hue/Saturation', icon: 'palette', defaults: { hue: 0, sat: 0, light: 0 },
    controls: [{ k: 'hue', label: 'Hue', min: -180, max: 180 }, { k: 'sat', label: 'Saturation', min: -100, max: 100 }, { k: 'light', label: 'Lightness', min: -100, max: 100 }] },
  levels: { name: 'Levels', icon: 'sliders-vertical', defaults: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 },
    controls: [{ k: 'inBlack', label: 'Input black', min: 0, max: 254 }, { k: 'gamma', label: 'Midtones (gamma)', min: 0.1, max: 4, step: 0.01 }, { k: 'inWhite', label: 'Input white', min: 1, max: 255 },
      { k: 'outBlack', label: 'Output black', min: 0, max: 254 }, { k: 'outWhite', label: 'Output white', min: 1, max: 255 }] },
  curves: { name: 'Curves', icon: 'spline', defaults: { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] }, controls: [] },
  vibrance: { name: 'Vibrance', icon: 'sparkles', defaults: { vibrance: 0, sat: 0 },
    controls: [{ k: 'vibrance', label: 'Vibrance', min: -100, max: 100 }, { k: 'sat', label: 'Saturation', min: -100, max: 100 }] },
  bw: { name: 'Black & White', icon: 'contrast', defaults: { r: 30, g: 59, b: 11 },
    controls: [{ k: 'r', label: 'Reds', min: -100, max: 200 }, { k: 'g', label: 'Greens', min: -100, max: 200 }, { k: 'b', label: 'Blues', min: -100, max: 200 }] },
  invert: { name: 'Invert', icon: 'flip-horizontal-2', defaults: {}, controls: [] },
  gradmap: { name: 'Gradient Map', icon: 'rainbow', defaults: { stops: [[0, '#1b1464'], [0.5, '#e84393'], [1, '#ffeaa7']] }, controls: [] },
}
export const adjustDefaults = (kind) => JSON.parse(JSON.stringify(ADJUSTMENTS[kind].defaults))

export const GRADIENT_PRESETS = [
  ['Sunset', [[0, '#1b1464'], [0.5, '#e84393'], [1, '#ffeaa7']]],
  ['Black to white', [[0, '#000000'], [1, '#ffffff']]],
  ['Duotone', [[0, '#0b132b'], [1, '#5bc0be']]],
  ['Sepia', [[0, '#2b1a0e'], [0.55, '#a8763e'], [1, '#f5deb3']]],
  ['Infrared', [[0, '#12003a'], [0.4, '#d6246e'], [0.75, '#ffd36e'], [1, '#ffffff']]],
]

/** Apply an adjustment in place to RGBA data. */
export function applyAdjust(d, kind, p) {
  const n = d.length
  if (kind === 'invert') { for (let i = 0; i < n; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2] } return }
  if (kind === 'brightness' || kind === 'exposure' || kind === 'levels' || kind === 'curves') {
    let lr, lg, lb
    if (kind === 'brightness') {
      const b = num(p.brightness, 0) * 1.7, cf = Math.tan((clamp(num(p.contrast, 0), -100, 99.5) / 100 + 1) * Math.PI / 4)
      lr = lg = lb = lutOf((v) => (v - 128 + b) * cf + 128)
    } else if (kind === 'exposure') {
      const k = Math.pow(2, num(p.exposure, 0)), off = num(p.offset, 0), g = 1 / clamp(num(p.gamma, 1), 0.05, 10)
      lr = lg = lb = lutOf((v) => 255 * Math.pow(clamp(Math.pow(v / 255, 2.2) * k + off, 0, 1), 1 / 2.2) ** g)
    } else if (kind === 'levels') {
      const ib = num(p.inBlack, 0), iw = Math.max(ib + 1, num(p.inWhite, 255)), g = 1 / clamp(num(p.gamma, 1), 0.05, 10), ob = num(p.outBlack, 0), ow = num(p.outWhite, 255)
      lr = lg = lb = lutOf((v) => ob + Math.pow(clamp((v - ib) / (iw - ib), 0, 1), g) * (ow - ob))
    } else {
      const m = curveLut(p.rgb || [[0, 0], [255, 255]]), r = curveLut(p.r || [[0, 0], [255, 255]]), g = curveLut(p.g || [[0, 0], [255, 255]]), b = curveLut(p.b || [[0, 0], [255, 255]])
      lr = lutOf((v) => r[m[v]]); lg = lutOf((v) => g[m[v]]); lb = lutOf((v) => b[m[v]])
    }
    for (let i = 0; i < n; i += 4) { d[i] = lr[d[i]]; d[i + 1] = lg[d[i + 1]]; d[i + 2] = lb[d[i + 2]] }
    return
  }
  if (kind === 'huesat') {
    const hue = num(p.hue, 0), sat = num(p.sat, 0) / 100, light = num(p.light, 0) / 100
    if (!hue && !sat && !light) return
    for (let i = 0; i < n; i += 4) {
      let [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2])
      h += hue
      s = sat >= 0 ? s + (1 - s) * sat : s * (1 + sat)
      l = light >= 0 ? l + (1 - l) * light : l * (1 + light)
      const [r, g, b] = hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1))
      d[i] = r; d[i + 1] = g; d[i + 2] = b
    }
    return
  }
  if (kind === 'vibrance') {
    const vib = num(p.vibrance, 0) / 100, sat = 1 + num(p.sat, 0) / 100
    for (let i = 0; i < n; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2]
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
      const s = mx ? (mx - mn) / mx : 0
      const f = (vib >= 0 ? 1 + vib * (1 - s) * 1.6 : 1 + vib) * sat
      const y = 0.299 * r + 0.587 * g + 0.114 * b
      d[i] = y + (r - y) * f; d[i + 1] = y + (g - y) * f; d[i + 2] = y + (b - y) * f
    }
    return
  }
  if (kind === 'bw') {
    const wr = num(p.r, 30) / 100, wg = num(p.g, 59) / 100, wb = num(p.b, 11) / 100
    for (let i = 0; i < n; i += 4) { const y = d[i] * wr + d[i + 1] * wg + d[i + 2] * wb; d[i] = d[i + 1] = d[i + 2] = y }
    return
  }
  if (kind === 'gradmap') {
    const lut = gradientLut(p.stops || ADJUSTMENTS.gradmap.defaults.stops)
    for (let i = 0; i < n; i += 4) {
      const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * 3
      d[i] = lut[y]; d[i + 1] = lut[y + 1]; d[i + 2] = lut[y + 2]
    }
  }
}

// ---------- destructive filters (operate on ImageData, return ImageData) ----------
function premultiply(d) { for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; d[i] *= a; d[i + 1] *= a; d[i + 2] *= a } }
function unpremultiply(d) { for (let i = 0; i < d.length; i += 4) { const a = d[i + 3]; if (a && a < 255) { const k = 255 / a; d[i] *= k; d[i + 1] *= k; d[i + 2] *= k } } }

export function gaussianBlur(img, radius) {
  const { width: w, height: h } = img
  const src = new Uint8ClampedArray(img.data)
  premultiply(src)
  const out = blurArray(src, w, h, radius, 4)
  const res = new Uint8ClampedArray(out)
  unpremultiply(res)
  return new ImageData(res, w, h)
}

export function unsharpMask(img, amount, radius, threshold) {
  const blurred = gaussianBlur(img, radius).data
  const d = img.data, out = new Uint8ClampedArray(d.length)
  const k = amount / 100
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = d[i + c] - blurred[i + c]
      out[i + c] = Math.abs(diff) > threshold ? d[i + c] + diff * k : d[i + c]
    }
    out[i + 3] = d[i + 3]
  }
  return new ImageData(out, img.width, img.height)
}

function rng(seed) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
export function addNoise(img, amount, mono, seed = 1) {
  const r = rng(seed), d = img.data, out = new Uint8ClampedArray(d), sigma = amount * 2.55 * 0.5
  const gauss = () => (r() + r() + r() + r() - 2) * 1.7
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue
    if (mono) { const v = gauss() * sigma; out[i] += v; out[i + 1] += v; out[i + 2] += v } else { out[i] += gauss() * sigma; out[i + 1] += gauss() * sigma; out[i + 2] += gauss() * sigma }
  }
  return new ImageData(out, img.width, img.height)
}

export function pixelate(img, size) {
  const { width: w, height: h } = img, d = img.data, out = new Uint8ClampedArray(d.length), s = Math.max(1, Math.round(size))
  for (let by = 0; by < h; by += s) {
    for (let bx = 0; bx < w; bx += s) {
      let r = 0, g = 0, b = 0, a = 0, cnt = 0
      const ye = Math.min(h, by + s), xe = Math.min(w, bx + s)
      for (let y = by; y < ye; y++) for (let x = bx; x < xe; x++) { const i = (y * w + x) * 4; const al = d[i + 3]; r += d[i] * al; g += d[i + 1] * al; b += d[i + 2] * al; a += al; cnt++ }
      const k = a || 1
      const pr = r / k, pg = g / k, pb = b / k, pa = a / cnt
      for (let y = by; y < ye; y++) for (let x = bx; x < xe; x++) { const i = (y * w + x) * 4; out[i] = pr; out[i + 1] = pg; out[i + 2] = pb; out[i + 3] = pa }
    }
  }
  return new ImageData(out, w, h)
}

export const FILTERS = {
  blur: { name: 'Gaussian blur', icon: 'droplet', controls: [{ k: 'radius', label: 'Radius (px)', min: 0.5, max: 60, step: 0.5, value: 6 }], run: (img, p) => gaussianBlur(img, p.radius) },
  sharpen: { name: 'Sharpen (unsharp mask)', icon: 'triangle', controls: [{ k: 'amount', label: 'Amount (%)', min: 10, max: 500, step: 5, value: 120 }, { k: 'radius', label: 'Radius (px)', min: 0.5, max: 30, step: 0.5, value: 2 }, { k: 'threshold', label: 'Threshold', min: 0, max: 64, step: 1, value: 0 }], run: (img, p) => unsharpMask(img, p.amount, p.radius, p.threshold) },
  noise: { name: 'Add noise', icon: 'dices', controls: [{ k: 'amount', label: 'Amount', min: 1, max: 100, step: 1, value: 20 }, { k: 'mono', label: 'Monochrome', type: 'toggle', value: false }], run: (img, p) => addNoise(img, p.amount, p.mono) },
  pixelate: { name: 'Pixelate', icon: 'grid-3x3', controls: [{ k: 'size', label: 'Cell size (px)', min: 2, max: 120, step: 1, value: 12 }], run: (img, p) => pixelate(img, p.size) },
}
