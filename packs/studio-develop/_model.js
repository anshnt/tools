// Develop settings model: plain JSON, no DOM. Defaults, ranges, copy/paste groups, tone-curve math, crop and
// geometry math, export sizing and filename patterns. Everything here is pure so it can be tested in Node.

export const HUES = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta']
export const HUE_CENTERS = [0, 30, 60, 120, 180, 240, 285, 330]
export const HUE_WIDTHS = [35, 35, 45, 60, 60, 55, 50, 45]
export const HUE_COLORS = ['#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#2fd4c8', '#0a84ff', '#8b5cf6', '#f43f9d']

const z8 = () => [0, 0, 0, 0, 0, 0, 0, 0]
const line = () => [[0, 0], [255, 255]]

/** Every key of a photo's edit settings with its neutral value. */
export function defaults() {
  return {
    exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    temp: 0, tint: 0, vibrance: 0, saturation: 0,
    texture: 0, clarity: 0, dehaze: 0,
    bw: false, hue: z8(), sat: z8(), lum: z8(),
    curve: { rgb: line(), r: line(), g: line(), b: line() },
    grade: { sh: { h: 0, s: 0, l: 0 }, mid: { h: 0, s: 0, l: 0 }, hi: { h: 0, s: 0, l: 0 }, blend: 50, balance: 0 },
    sharpen: 0, sharpMask: 0, nrLuma: 0, nrColor: 0,
    vignette: 0, vigMid: 50, vigFeather: 50, vigRound: 0,
    grain: 0, grainSize: 25, grainRough: 50,
    crop: { x: 0, y: 0, w: 1, h: 1 }, angle: 0, rot: 0, flipH: false, flipV: false,
  }
}

export const RANGES = {
  exposure: [-5, 5], contrast: [-100, 100], highlights: [-100, 100], shadows: [-100, 100], whites: [-100, 100], blacks: [-100, 100],
  temp: [-100, 100], tint: [-100, 100], vibrance: [-100, 100], saturation: [-100, 100],
  texture: [-100, 100], clarity: [-100, 100], dehaze: [-100, 100],
  sharpen: [0, 100], sharpMask: [0, 100], nrLuma: [0, 100], nrColor: [0, 100],
  vignette: [-100, 100], vigMid: [0, 100], vigFeather: [0, 100], vigRound: [-100, 100],
  grain: [0, 100], grainSize: [0, 100], grainRough: [0, 100],
  angle: [-45, 45],
}

/** Groups used by copy/paste and presets. */
export const GROUPS = {
  basic: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'],
  color: ['temp', 'tint', 'vibrance', 'saturation'],
  presence: ['texture', 'clarity', 'dehaze'],
  hsl: ['hue', 'sat', 'lum', 'bw'],
  curve: ['curve'],
  grading: ['grade'],
  detail: ['sharpen', 'sharpMask', 'nrLuma', 'nrColor'],
  effects: ['vignette', 'vigMid', 'vigFeather', 'vigRound', 'grain', 'grainSize', 'grainRough'],
  geometry: ['crop', 'angle', 'rot', 'flipH', 'flipV'],
}
export const GROUP_LABELS = {
  basic: 'Tone (exposure, contrast, highlights...)', color: 'White balance and color', presence: 'Texture, clarity, dehaze', hsl: 'HSL and black and white',
  curve: 'Tone curve', grading: 'Color grading', detail: 'Sharpening and noise reduction', effects: 'Vignette and grain', geometry: 'Crop and rotation',
}
export const LOOK_GROUPS = ['basic', 'color', 'presence', 'hsl', 'curve', 'grading', 'detail', 'effects']

export const clone = (o) => JSON.parse(JSON.stringify(o))
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** Copy only the keys of the given groups. */
export function pick(s, groups) {
  const out = {}
  for (const g of groups) for (const k of GROUPS[g]) out[k] = clone(s[k])
  return out
}
/** New settings = base with the keys of `part` replaced. */
export function merge(base, part) {
  return normalize({ ...clone(base), ...clone(part) })
}
export function isDefault(s) {
  return same(normalize(s), defaults())
}
/** True if any key of the group differs from its default. */
export function groupChanged(s, g) {
  const d = defaults()
  return GROUPS[g].some((k) => !same(s[k], d[k]))
}

const num = (v, d, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d)
function arr8(a) {
  return Array.from({ length: 8 }, (_, i) => num(a?.[i], 0, -100, 100))
}
function curvePts(p) {
  if (!Array.isArray(p) || p.length < 2) return line()
  const pts = p.filter((q) => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1])).map(([x, y]) => [clamp(Math.round(x), 0, 255), clamp(Math.round(y), 0, 255)])
  pts.sort((a, b) => a[0] - b[0])
  const out = []
  for (const q of pts) if (!out.length || q[0] > out.at(-1)[0]) out.push(q)
  return out.length >= 2 ? out : line()
}
function wheel(w) {
  return { h: num(w?.h, 0, 0, 360), s: num(w?.s, 0, 0, 100), l: num(w?.l, 0, -100, 100) }
}

/** Fill missing keys, clamp numbers, drop unknown keys. Use on anything loaded from storage, files or presets. */
export function normalize(input) {
  const d = defaults()
  const s = input && typeof input === 'object' ? input : {}
  const out = {}
  for (const k of Object.keys(RANGES)) out[k] = num(s[k], d[k], RANGES[k][0], RANGES[k][1])
  out.bw = !!s.bw
  out.hue = arr8(s.hue); out.sat = arr8(s.sat); out.lum = arr8(s.lum)
  out.curve = { rgb: curvePts(s.curve?.rgb), r: curvePts(s.curve?.r), g: curvePts(s.curve?.g), b: curvePts(s.curve?.b) }
  out.grade = { sh: wheel(s.grade?.sh), mid: wheel(s.grade?.mid), hi: wheel(s.grade?.hi), blend: num(s.grade?.blend, 50, 0, 100), balance: num(s.grade?.balance, 0, -100, 100) }
  const c = s.crop || {}
  const w = num(c.w, 1, 0.02, 1), h = num(c.h, 1, 0.02, 1)
  out.crop = { x: num(c.x, 0, 0, 1 - w), y: num(c.y, 0, 0, 1 - h), w, h }
  out.rot = ((Math.round(num(s.rot, 0, -1000, 1000)) % 4) + 4) % 4
  out.flipH = !!s.flipH; out.flipV = !!s.flipV
  return Object.fromEntries(Object.keys(d).map((k) => [k, out[k]])) // stable key order so same() works
}

// ---------- Tone curve ----------

/** Monotone cubic (Fritsch-Carlson) evaluation of curve points [[x,y]...] (0..255) into a 256-entry table. */
export function curveTable(points) {
  const p = curvePts(points)
  const n = p.length
  const t = new Uint8Array(256)
  if (n === 2 && p[0][0] === 0 && p[0][1] === 0 && p[1][0] === 255 && p[1][1] === 255) {
    for (let i = 0; i < 256; i++) t[i] = i
    return t
  }
  const dx = [], m = []
  for (let i = 0; i < n - 1; i++) { dx.push(p[i + 1][0] - p[i][0]); m.push((p[i + 1][1] - p[i][1]) / dx[i]) }
  const c1 = [m[0]]
  for (let i = 1; i < n - 1; i++) c1.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2)
  c1.push(m[n - 2])
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { c1[i] = 0; c1[i + 1] = 0; continue }
    const a = c1[i] / m[i], b = c1[i + 1] / m[i], r = a * a + b * b
    if (r > 9) { const k = 3 / Math.sqrt(r); c1[i] = k * a * m[i]; c1[i + 1] = k * b * m[i] }
  }
  let seg = 0
  for (let x = 0; x < 256; x++) {
    let y
    if (x <= p[0][0]) y = p[0][1]
    else if (x >= p[n - 1][0]) y = p[n - 1][1]
    else {
      while (seg < n - 2 && x > p[seg + 1][0]) seg++
      const h = dx[seg], u = (x - p[seg][0]) / h
      const u2 = u * u, u3 = u2 * u
      y = (2 * u3 - 3 * u2 + 1) * p[seg][1] + (u3 - 2 * u2 + u) * h * c1[seg] + (-2 * u3 + 3 * u2) * p[seg + 1][1] + (u3 - u2) * h * c1[seg + 1]
    }
    t[x] = clamp(Math.round(y), 0, 255)
  }
  return t
}

/** 256 x 4 bytes lookup: master curve first, then the per-channel curve. */
export function curveLut(curve) {
  const m = curveTable(curve.rgb), r = curveTable(curve.r), g = curveTable(curve.g), b = curveTable(curve.b)
  const out = new Uint8Array(256 * 4)
  for (let i = 0; i < 256; i++) { out[i * 4] = r[m[i]]; out[i * 4 + 1] = g[m[i]]; out[i * 4 + 2] = b[m[i]]; out[i * 4 + 3] = 255 }
  return out
}

// ---------- Geometry ----------

export const orientedSize = (w, h, rot) => (rot % 2 ? [h, w] : [w, h])
const rad = (d) => (d * Math.PI) / 180

/** Corners of the crop rectangle mapped into the oriented image (pixels), with the image straightened by `angle`. */
function cropCorners(crop, angle, Wo, Ho) {
  const cx = (crop.x + crop.w / 2) * Wo, cy = (crop.y + crop.h / 2) * Ho
  const hw = (crop.w * Wo) / 2, hh = (crop.h * Ho) / 2
  const a = -rad(angle), ca = Math.cos(a), sa = Math.sin(a)
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [cx + x * ca - y * sa, cy + x * sa + y * ca])
}
/** True when the straightened crop rectangle lies fully inside the image. */
export function cropInside(crop, angle, Wo, Ho, eps = 0.75) {
  return cropCorners(crop, angle, Wo, Ho).every(([x, y]) => x >= -eps && y >= -eps && x <= Wo + eps && y <= Ho + eps)
}
/** Shrink (and if needed recentre) a crop until it fits inside the straightened image. Keeps the aspect ratio. */
export function constrainCrop(crop, angle, Wo, Ho) {
  let c = { ...crop }
  c.w = clamp(c.w, 0.02, 1); c.h = clamp(c.h, 0.02, 1)
  c.x = clamp(c.x, 0, 1 - c.w); c.y = clamp(c.y, 0, 1 - c.h)
  if (cropInside(c, angle, Wo, Ho)) return c
  const cx0 = c.x + c.w / 2, cy0 = c.y + c.h / 2
  for (let pull = 0; pull <= 10; pull++) {
    const t = pull / 10
    const cx = cx0 + (0.5 - cx0) * t, cy = cy0 + (0.5 - cy0) * t
    let lo = 0.02, hi = 1
    const at = (k) => ({ x: cx - (c.w * k) / 2, y: cy - (c.h * k) / 2, w: c.w * k, h: c.h * k })
    if (!cropInside(at(lo), angle, Wo, Ho)) continue
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (cropInside(at(mid), angle, Wo, Ho)) lo = mid; else hi = mid }
    return at(lo)
  }
  return { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }
}
/** Largest centered crop with pixel aspect ratio r (w/h) that fits the straightened image. */
export function aspectCrop(r, angle, Wo, Ho, around = { x: 0.5, y: 0.5 }) {
  let w = 1, h = (Wo / Ho) / r
  if (h > 1) { h = 1; w = (Ho * r) / Wo }
  return constrainCrop({ x: around.x - w / 2, y: around.y - h / 2, w, h }, angle, Wo, Ho)
}
/** Pixel dimensions of the cropped result in the full-resolution oriented image. */
export function cropPixels(s, w, h) {
  const [Wo, Ho] = orientedSize(w, h, s.rot)
  return [Math.max(1, Math.round(s.crop.w * Wo)), Math.max(1, Math.round(s.crop.h * Ho))]
}

/**
 * Affine map from output uv (0..1, v down) to raw source uv: raw = p0 + ax * u + ay * v.
 * The crop rectangle is axis aligned in the output; the image is rotated by `angle` (degrees, clockwise) beneath it.
 * Orientation (rot x 90 degrees clockwise, then flips) is undone to reach the raw pixels.
 */
export function geometry(s, w, h) {
  const [Wo, Ho] = orientedSize(w, h, s.rot)
  const c = s.crop
  const cx = (c.x + c.w / 2) * Wo, cy = (c.y + c.h / 2) * Ho
  const cw = c.w * Wo, ch = c.h * Ho
  const a = -rad(s.angle), ca = Math.cos(a), sa = Math.sin(a)
  const f = (u, v) => {
    const lx = (u - 0.5) * cw, ly = (v - 0.5) * ch
    let ou = (cx + lx * ca - ly * sa) / Wo, ov = (cy + lx * sa + ly * ca) / Ho
    if (s.flipV) ov = 1 - ov
    if (s.flipH) ou = 1 - ou
    switch (s.rot) {
      case 1: return [ov, 1 - ou]
      case 2: return [1 - ou, 1 - ov]
      case 3: return [1 - ov, ou]
      default: return [ou, ov]
    }
  }
  const p0 = f(0, 0), px = f(1, 0), py = f(0, 1)
  return { p0, ax: [px[0] - p0[0], px[1] - p0[1]], ay: [py[0] - p0[0], py[1] - p0[1]] }
}

export const ASPECTS = [
  ['free', 'Free'], ['original', 'Original'], ['1:1', '1:1 Square'], ['4:5', '4:5 Portrait'], ['5:7', '5:7'], ['2:3', '2:3'], ['3:4', '3:4'],
  ['3:2', '3:2 Landscape'], ['4:3', '4:3'], ['16:9', '16:9 Wide'], ['16:10', '16:10'], ['3:1', '3:1 Panorama'],
]
/** Ratio (w/h) for an aspect id given the oriented source size; null for free. */
export function aspectValue(id, Wo, Ho) {
  if (id === 'free') return null
  if (id === 'original') return Wo / Ho
  const [a, b] = id.split(':').map(Number)
  return a / b
}

// ---------- Export ----------

/** Output size for the export options. mode: original | long | width | height | percent | fit */
export function exportSize(cw, ch, o = {}) {
  const v = Math.max(1, Number(o.value) || 0)
  let k = 1
  switch (o.mode) {
    case 'long': k = v / Math.max(cw, ch); break
    case 'width': k = v / cw; break
    case 'height': k = v / ch; break
    case 'percent': k = v / 100; break
    case 'fit': k = Math.min(v / cw, (Number(o.value2) || v) / ch); break
    default: k = 1
  }
  if (!o.upscale && k > 1) k = 1
  return [Math.max(1, Math.round(cw * k)), Math.max(1, Math.round(ch * k))]
}

const pad = (n, w) => String(n).padStart(w, '0')
/** Filename from a pattern: {name} {n} {nn} {nnn} {date} {w} {h} {rating} {flag}. */
export function renderName(pattern, info) {
  const d = info.date instanceof Date ? info.date : new Date()
  const map = {
    name: info.name, n: info.n, nn: pad(info.n, 2), nnn: pad(info.n, 3), nnnn: pad(info.n, 4),
    date: `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`, w: info.w, h: info.h, rating: info.rating ?? 0, flag: info.flag || 'none',
  }
  const out = String(pattern || '{name}').replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m)).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim()
  return out || info.name
}

/** Blend two settings objects: numbers and arrays interpolate, curves and booleans switch at the halfway point. */
export function lerpSettings(a, b, t) {
  if (t <= 0) return clone(a)
  if (t >= 1) return clone(b)
  const mix = (x, y) => x + (y - x) * t
  const walk = (x, y) => {
    if (typeof x === 'number' && typeof y === 'number') return mix(x, y)
    if (Array.isArray(x) && Array.isArray(y) && x.every((v) => typeof v === 'number')) return x.map((v, i) => mix(v, y[i]))
    if (x && y && typeof x === 'object' && !Array.isArray(x)) return Object.fromEntries(Object.keys(x).map((k) => [k, walk(x[k], y[k])]))
    return t < 0.5 ? clone(x) : clone(y)
  }
  const out = {}
  for (const k of Object.keys(a)) out[k] = GROUPS.geometry.includes(k) ? clone(a[k]) : k === 'curve' ? clone(t < 0.5 ? a[k] : b[k]) : walk(a[k], b[k])
  return normalize(out)
}
