// Photo enhancement math (pure functions on {data, width, height} RGBA images): analysis for the Auto button, a tone and
// color pipeline built from per-channel lookup tables, edge-preserving denoise and luminance unsharp mask.
// Also used by the upscaler to sharpen resized images.
import { gaussU8 } from './_ml.js'

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

export const DEFAULTS = Object.freeze({
  autoLevels: 0, autoWB: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, warmth: 0, saturation: 0, vibrance: 0, sharpen: 0, denoise: 0,
})

/** Histogram based facts about an image, sampled so it is fast on large photos. */
export function analyze(img) {
  const { data, width: w, height: h } = img
  const step = Math.max(1, Math.round(Math.sqrt((w * h) / 250000)))
  const hist = new Uint32Array(256)
  let n = 0, sr = 0, sg = 0, sb = 0, sy = 0, syy = 0, dark = 0, bright = 0, chroma = 0, nm = 0
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4
      const r = data[i], g = data[i + 1], b = data[i + 2]
      const l = 0.299 * r + 0.587 * g + 0.114 * b
      hist[Math.round(l)]++
      n++
      sy += l; syy += l * l
      if (l < 38) dark++
      if (l > 235) bright++
      // the color cast is read from near-neutral pixels only, so a red table or a blue sky is not mistaken for a cast
      if (l > 25 && l < 225 && Math.max(r, g, b) - Math.min(r, g, b) < 70) { sr += r; sg += g; sb += b; nm++ }
      chroma += Math.max(r, g, b) - Math.min(r, g, b)
    }
  }
  const pct = (p) => { let c = 0; const t = n * p; for (let i = 0; i < 256; i++) { c += hist[i]; if (c >= t) return i } return 255 }
  const mean = sy / n
  const sd = Math.sqrt(Math.max(0, syy / n - mean * mean))
  const enough = nm > n * 0.02
  const mr = enough ? sr / nm : 128, mg = enough ? sg / nm : 128, mb = enough ? sb / nm : 128
  return {
    black: pct(0.004), white: pct(0.996), mean: mean / 255, sd: sd / 255, darkFrac: dark / n, brightFrac: bright / n,
    chroma: chroma / n / 255, grayWorld: [mg / Math.max(1, mr), 1, mg / Math.max(1, mb)], noise: estimateNoise(img), blur: estimateSharpness(img),
  }
}

/** Immerkaer fast noise estimate (sigma in 0..255 units) on luminance. */
export function estimateNoise(img) {
  const { data, width: w, height: h } = img
  if (w < 8 || h < 8) return 0
  const step = Math.max(1, Math.round(Math.sqrt((w * h) / 300000)))
  const L = (x, y) => { const i = (y * w + x) * 4; return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] }
  let sum = 0, n = 0
  for (let y = 1; y < h - 1; y += step) {
    for (let x = 1; x < w - 1; x += step) {
      const v = L(x - 1, y - 1) - 2 * L(x, y - 1) + L(x + 1, y - 1) - 2 * L(x - 1, y) + 4 * L(x, y) - 2 * L(x + 1, y) + L(x - 1, y + 1) - 2 * L(x, y + 1) + L(x + 1, y + 1)
      sum += Math.abs(v); n++
    }
  }
  return n ? Math.sqrt(Math.PI / 2) * (sum / n) / 6 : 0
}

/** Mean gradient magnitude relative to contrast: low values mean a soft image. */
export function estimateSharpness(img) {
  const { data, width: w, height: h } = img
  const step = Math.max(1, Math.round(Math.sqrt((w * h) / 250000)))
  let g = 0, n = 0
  for (let y = 0; y < h - 1; y += step) {
    for (let x = 0; x < w - 1; x += step) {
      const i = (y * w + x) * 4, j = i + 4, k = i + w * 4
      g += Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 1] - data[k + 1]); n++
    }
  }
  return n ? g / n / 255 : 0
}

/** Settings that fix the common problems found by analyze(). */
export function autoParams(a) {
  const p = { ...DEFAULTS }
  const spread = (a.white - a.black) / 255
  p.autoLevels = spread < 0.93 ? 85 : 35
  const cast = Math.max(...a.grayWorld.map((v) => Math.abs(v - 1)))
  p.autoWB = cast > 0.07 ? Math.min(90, 45 + cast * 220) : 0
  const meanAfter = clamp(a.mean + (1 - spread) * 0.08, 0.05, 0.95)
  p.exposure = clamp(Math.log2(0.46 / meanAfter) * 0.6, -0.6, 0.8)
  if (Math.abs(p.exposure) < 0.08) p.exposure = 0
  p.contrast = a.sd < 0.17 ? 22 : a.sd < 0.22 ? 12 : a.sd > 0.31 ? -5 : 4
  p.shadows = a.darkFrac > 0.25 ? 45 : a.darkFrac > 0.12 ? 28 : 8
  p.highlights = a.brightFrac > 0.12 ? 45 : a.brightFrac > 0.05 ? 25 : 0
  p.vibrance = a.chroma < 0.14 ? 38 : a.chroma < 0.22 ? 24 : 10
  p.saturation = a.chroma < 0.1 ? 8 : 0
  p.sharpen = a.blur < 0.03 ? 110 : a.blur < 0.06 ? 80 : 45
  p.denoise = a.noise > 6 ? 55 : a.noise > 3.5 ? 35 : a.noise > 2 ? 18 : 0
  return p
}

export const PRESETS = {
  vivid: { ...DEFAULTS, autoLevels: 60, contrast: 22, vibrance: 55, saturation: 14, sharpen: 60, shadows: 12 },
  crisp: { ...DEFAULTS, autoLevels: 50, contrast: 12, sharpen: 140, denoise: 10 },
  lowlight: { ...DEFAULTS, autoLevels: 70, exposure: 0.55, shadows: 60, highlights: 15, denoise: 60, sharpen: 40, vibrance: 20 },
  soft: { ...DEFAULTS, autoLevels: 30, contrast: -8, highlights: 20, shadows: 18, warmth: 12, denoise: 40, sharpen: 0 },
  document: { ...DEFAULTS, autoLevels: 100, contrast: 38, saturation: -100, exposure: 0.25, sharpen: 130, denoise: 12 },
}

/** Build three lookup tables (R, G, B) for the channel-independent steps. */
export function buildLuts(p, a) {
  const gains = [1, 1, 1]
  if (p.autoWB > 0) {
    const k = p.autoWB / 100
    for (let c = 0; c < 3; c++) gains[c] = 1 + (clamp(a.grayWorld[c], 0.8, 1.25) - 1) * k
  }
  if (p.warmth) { const t = p.warmth / 100 * 0.2; gains[0] *= 1 + t; gains[2] *= 1 - t }
  const black = p.autoLevels > 0 ? (a.black * p.autoLevels) / 100 / 255 : 0
  const white = p.autoLevels > 0 ? 1 - ((1 - a.white / 255) * p.autoLevels) / 100 : 1
  const span = Math.max(0.2, white - black)
  const ev = Math.pow(2, p.exposure)
  const cf = p.contrast / 100
  const luts = [new Uint8ClampedArray(256), new Uint8ClampedArray(256), new Uint8ClampedArray(256)]
  for (let c = 0; c < 3; c++) {
    for (let v = 0; v < 256; v++) {
      let x = (v / 255) * gains[c]
      x = (x - black) / span
      x = clamp(x, 0, 1)
      x = Math.pow(x, 1 / ev)               // exposure as a gamma move keeps highlights from clipping
      if (cf > 0) { const sc = x * x * (3 - 2 * x); x = x + (sc - x) * Math.min(1, cf * 1.4) }
      else if (cf < 0) x = 0.5 + (x - 0.5) * (1 + cf)
      luts[c][v] = clamp(x, 0, 1) * 255 + 0.5
    }
  }
  return luts
}

/** Edge-preserving 3x3 bilateral filter. strength 0..100. Returns a new RGBA array. */
export function denoise(data, w, h, strength) {
  if (strength <= 0) return data
  const sigma = 5 + strength * 0.32
  const rangeLut = new Float32Array(766)
  for (let d = 0; d < 766; d++) rangeLut[d] = Math.exp(-(d * d) / (2 * sigma * sigma * 9))
  const passes = strength > 55 ? 2 : 1
  let src = data
  for (let pass = 0; pass < passes; pass++) {
    const out = new Uint8ClampedArray(src.length)
    for (let y = 0; y < h; y++) {
      const y0 = y > 0 ? y - 1 : y, y1 = y < h - 1 ? y + 1 : y
      for (let x = 0; x < w; x++) {
        const x0 = x > 0 ? x - 1 : x, x1 = x < w - 1 ? x + 1 : x
        const i = (y * w + x) * 4
        const r = src[i], g = src[i + 1], b = src[i + 2]
        let sr = r, sg = g, sb = b, sw = 1
        for (let yy = y0; yy <= y1; yy++) {
          for (let xx = x0; xx <= x1; xx++) {
            if (xx === x && yy === y) continue
            const j = (yy * w + xx) * 4
            const d = Math.abs(src[j] - r) + Math.abs(src[j + 1] - g) + Math.abs(src[j + 2] - b)
            const wt = rangeLut[d] * (xx === x || yy === y ? 1 : 0.7)
            sw += wt; sr += src[j] * wt; sg += src[j + 1] * wt; sb += src[j + 2] * wt
          }
        }
        out[i] = sr / sw; out[i + 1] = sg / sw; out[i + 2] = sb / sw; out[i + 3] = src[i + 3]
      }
    }
    src = out
  }
  return src
}

/** Luminance unsharp mask. amount 0..200 (percent), radius in pixels. Mutates `data`. */
export function unsharp(data, w, h, amount, radius, threshold = 2) {
  if (amount <= 0) return
  const n = w * h
  const Y = new Uint8ClampedArray(n)
  for (let i = 0; i < n; i++) Y[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  const B = gaussU8(Y, w, h, Math.max(0.5, radius))
  const k = amount / 100
  for (let i = 0; i < n; i++) {
    let d = Y[i] - B[i]
    const ad = Math.abs(d)
    if (ad <= threshold) continue
    d = Math.sign(d) * (ad - threshold) * k   // soft threshold: noise below it is left alone
    d = clamp(d, -70, 70)
    data[i * 4] = data[i * 4] + d; data[i * 4 + 1] = data[i * 4 + 1] + d; data[i * 4 + 2] = data[i * 4 + 2] + d
  }
}

/**
 * Run the whole pipeline. img: {data, width, height} (not modified). a: analyze() result. p: settings.
 * scale: size of the image relative to a 1000 px long edge, so radii look the same at any size.
 * Returns a new Uint8ClampedArray (RGBA).
 */
export function enhance(img, p, a, { fast = false } = {}) {
  const { width: w, height: h } = img
  const luts = buildLuts(p, a)
  const out = new Uint8ClampedArray(img.data.length)
  const src = img.data
  const sh = p.shadows / 100, hi = p.highlights / 100
  const sat = 1 + p.saturation / 100, vib = p.vibrance / 100
  const [lr, lg, lb] = luts
  for (let i = 0; i < src.length; i += 4) {
    let r = lr[src[i]], g = lg[src[i + 1]], b = lb[src[i + 2]]
    let y = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    if (sh > 0 || hi > 0) {
      // lift shadows and pull highlights with smooth, luminance-driven gains
      const lift = sh * (1 - y) * (1 - y) * (1 - y) * 0.9
      const pull = hi * y * y * y * 0.55
      const gain = (1 + lift) * (1 - pull)
      r *= gain; g *= gain; b *= gain
      y = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    }
    if (sat !== 1 || vib > 0) {
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
      const c = (mx - mn) / 255
      // vibrance boosts dull colors more than already vivid ones and protects skin-like hues
      let s = sat * (1 + vib * (1 - c) * (1 - c))
      if (vib > 0 && r > g && g > b && c < 0.6) s = 1 + (s - 1) * 0.65
      const yy = y * 255
      r = yy + (r - yy) * s; g = yy + (g - yy) * s; b = yy + (b - yy) * s
    }
    out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = src[i + 3]
  }
  const k = Math.max(w, h) / 1000
  let data = out
  if (p.denoise > 0) data = denoise(data, w, h, p.denoise)
  const noiseNow = p.sharpen > 0 ? estimateNoise({ data, width: w, height: h }) : 0
  if (p.sharpen > 0) {
    unsharp(data, w, h, p.sharpen, (fast ? 0.9 : 1.1) * Math.max(0.8, k), Math.max(1.5, noiseNow * 1.8))
  }
  return data
}
