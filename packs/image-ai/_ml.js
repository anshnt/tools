// Shared on-device ML helpers for the image-ai pack: device choice, model downloads with progress, background matting,
// mask refinement (guided filter, feather, shift, color decontamination) and a cached ONNX Runtime session loader.
import { transformers } from '../../lib/libs.js'
import { loadImage, toCanvas, canvas as makeCanvas, toBlob, MAX_PIXELS } from '../../lib/image.js'
import { load as getPref, save as setPref } from '../../lib/store.js'
import { formatBytes, isAbort, yieldToMain } from '../../lib/ui.js'

// ---------------------------------------------------------------- device

const dev = { gpu: null, f16: false, broken: false }
/** Detect WebGPU once. */
export async function probeDevice() {
  if (dev.gpu !== null) return dev
  dev.gpu = false
  try {
    const adapter = navigator.gpu && await navigator.gpu.requestAdapter()
    if (adapter) { dev.gpu = true; dev.f16 = !!adapter.features?.has('shader-f16') }
  } catch { /* no WebGPU */ }
  return dev
}
/** 'webgpu' when it works on this device, else 'wasm'. */
export async function bestDevice() {
  await probeDevice()
  return dev.gpu && !dev.broken ? 'webgpu' : 'wasm'
}
export const markGpuBroken = () => { dev.broken = true }
export const hasShaderF16 = () => dev.f16

export function friendlyError(e) {
  const m = String(e?.message || e || '')
  if (isAbort(e)) return e
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m) || e?.name === 'TypeError' && /fetch/i.test(m)) {
    return Object.assign(new Error('Could not download the AI model. Check your connection and try again.'), { cause: e })
  }
  if (/memory|allocation|OOM|out of range|RangeError|Aborted\(\)/i.test(m)) {
    return Object.assign(new Error('Your device ran out of memory. Try a smaller image or a lighter model.'), { cause: e })
  }
  return e instanceof Error ? e : new Error(m)
}

// ---------------------------------------------------------------- tiny helpers

const READY_KEY = 'image-ai:ready'
/** Remember which models finished downloading on this device (UI hint only). */
export const isReady = (id) => !!getPref(READY_KEY, {})[id]
export const markReady = (id) => setPref(READY_KEY, { ...getPref(READY_KEY, {}), [id]: 1 })

/** Cooperative abort check for long loops. */
export function checkAbort(signal) {
  if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError', code: 'ABORT' })
}

/** Scaled copy of a canvas/image so its longest side is at most `max`. Returns the source itself when small enough. */
export function fitCanvas(src, max) {
  const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height
  const s = Math.min(1, max / Math.max(w, h))
  if (s >= 1 && src instanceof HTMLCanvasElement) return src
  return toCanvas(src, Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)))
}

/**
 * Decode a file into a canvas capped to `maxSide` (and to the device pixel budget).
 * -> {canvas, width, height, scale, originalWidth, originalHeight, name}
 */
export async function loadWorking(file, { maxSide = 4096 } = {}) {
  const img = await loadImage(file)
  const ow = img.naturalWidth, oh = img.naturalHeight
  const s = Math.min(1, maxSide / Math.max(ow, oh), Math.sqrt(MAX_PIXELS / (ow * oh)))
  const c = toCanvas(img, Math.max(1, Math.round(ow * s)), Math.max(1, Math.round(oh * s)))
  return { canvas: c, width: c.width, height: c.height, scale: s, originalWidth: ow, originalHeight: oh, name: file.name }
}

export const ctxOf = (c) => c.getContext('2d', { willReadFrequently: true })
export const imageDataOf = (c) => ctxOf(c).getImageData(0, 0, c.width, c.height)

/** Small object URL thumbnail (JPEG) for queue strips. */
export async function thumbOf(c, size = 132) {
  const t = fitCanvas(c, size)
  return URL.createObjectURL(await toBlob(t, 'image/jpeg', 0.8))
}

export const canvasBlob = (c, type = 'image/png', q) => toBlob(c, type, q)

// ---------------------------------------------------------------- handoff between tools

let held = null
/**
 * Pass a file to the next tool: handoff.put(file, {model}); location.hash = '#/other'.
 * The other tool calls handoff.take() on mount and gets {file, meta} (or null).
 */
export const handoff = {
  put(file, meta = {}) { held = { file, meta } },
  take() { const f = held; held = null; return f },
  has() { return !!held },
}

// ---------------------------------------------------------------- Hugging Face (transformers.js) loading

/** Aggregates per-file download events into one fraction using the known model size. */
function progressMeter(onProgress, totalBytes, label = 'Downloading AI model') {
  const files = new Map()
  return (p) => {
    if (p.status === 'progress' && p.total) {
      files.set(p.file, p.loaded)
      let loaded = 0
      for (const v of files.values()) loaded += v
      const total = Math.max(totalBytes || 0, loaded)
      onProgress?.(total ? Math.min(0.99, loaded / total) : null, `${label} (${formatBytes(loaded)})`)
    } else if (p.status === 'done' || p.status === 'ready') {
      onProgress?.(null, 'Starting the model')
    }
  }
}

const hfCache = new Map()
/** AutoModel + AutoProcessor with progress. Cached per (spec, device). */
async function loadHF(spec, device, onProgress) {
  const key = `${spec.id}:${device}`
  if (!hfCache.has(key)) {
    hfCache.set(key, (async () => {
      const T = await transformers()
      T.env.allowLocalModels = false
      const dtype = typeof spec.dtype === 'function' ? spec.dtype(device) : spec.dtype
      const bytes = typeof spec.bytes === 'function' ? spec.bytes(device) : spec.bytes
      const cb = progressMeter(onProgress, bytes)
      const [model, processor] = await Promise.all([
        T.AutoModel.from_pretrained(spec.repo, { device, dtype, progress_callback: cb }),
        T.AutoProcessor.from_pretrained(spec.repo),
      ])
      markReady(spec.id)
      return { T, model, processor, device }
    })().catch((e) => { hfCache.delete(key); throw e }))
  }
  return hfCache.get(key)
}

// ---------------------------------------------------------------- matting models

/**
 * Background removal models (all permissively licensed, no AGPL or non-commercial weights).
 * quality: 1..3 dots, speed: 1..3 dots (3 = fastest).
 * Researched and rejected: BiRefNet lite (MIT) hits the 4 GB WebAssembly memory limit at 1024 px and fails on WebGPU with
 * "too many storage buffers" on common GPUs, and RMBG (non-commercial) and onnx-community/ISNet (AGPL) are not allowed.
 */
export const MATTE = {
  portrait: {
    id: 'matte-portrait', key: 'portrait', name: 'Portrait', sub: 'MODNet', repo: 'Xenova/modnet', license: 'Apache-2.0', maxIn: 1024,
    desc: 'Best for people and pets. Very fast and small.', quality: 2, speed: 3, mb: 26, dtype: 'fp32', bytes: 26e6, gpu: false, // WebGPU output is wrong on some GPUs, and WebAssembly is fast enough
  },
  balanced: {
    id: 'matte-balanced', key: 'balanced', name: 'Any subject', sub: 'ISNet', repo: 'xrds/isnet-general-onnx-int8', license: 'MIT', maxIn: 1024, minmax: true,
    desc: 'Products, objects, animals and people. A good balance.', quality: 3, speed: 2, mb: 44, dtype: 'q8', bytes: 44e6,
  },
}
export const MATTE_LIST = Object.values(MATTE)

async function inferMatte(h, spec, source) {
  const { T, model, processor } = h
  const small = fitCanvas(source, spec.maxIn * 1.5)
  const raw = T.RawImage.fromCanvas(small).rgb()
  const { pixel_values } = await processor(raw)
  const inputName = model.sessions?.model?.inputNames?.[0] || 'input'
  const out = await model({ [inputName]: pixel_values })
  let t = Object.values(out)[0]
  if (t.type !== 'float32') t = t.to('float32')
  const dims = t.dims
  const H = dims[dims.length - 2], W = dims[dims.length - 1]
  const plane = t.data.subarray(0, W * H)
  let min = Infinity, max = -Infinity
  for (let i = 0; i < plane.length; i++) { const v = plane[i]; if (v < min) min = v; if (v > max) max = v }
  const sig = min < -1e-3 || max > 1 + 1e-3
  const g = new ImageData(W, H)
  if (spec.minmax) {
    const lo = min, span = Math.max(1e-6, max - min)
    for (let i = 0; i < plane.length; i++) { const v = Math.round(255 * (plane[i] - lo) / span); g.data[i * 4] = g.data[i * 4 + 1] = g.data[i * 4 + 2] = v; g.data[i * 4 + 3] = 255 }
  } else {
    for (let i = 0; i < plane.length; i++) {
      const x = plane[i]
      const v = Math.round(255 * (sig ? 1 / (1 + Math.exp(-x)) : Math.min(1, Math.max(0, x))))
      g.data[i * 4] = g.data[i * 4 + 1] = g.data[i * 4 + 2] = v; g.data[i * 4 + 3] = 255
    }
  }
  return g
}

/** Scale a gray mask (ImageData, value in R) to w x h with smooth interpolation -> Uint8ClampedArray. */
export function scaleMask(gray, w, h) {
  const a = document.createElement('canvas')
  a.width = gray.width; a.height = gray.height
  a.getContext('2d').putImageData(gray, 0, 0)
  const b = makeCanvas(w, h)
  const bx = b.getContext('2d', { willReadFrequently: true })
  bx.imageSmoothingEnabled = true
  bx.imageSmoothingQuality = 'high'
  bx.drawImage(a, 0, 0, w, h)
  const d = bx.getImageData(0, 0, w, h).data
  const out = new Uint8ClampedArray(w * h)
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4]
  return out
}

/** Resize a Uint8 mask with smooth interpolation. */
export function resizeMask(alpha, w, h, nw, nh) {
  if (w === nw && h === nh) return alpha
  const g = new ImageData(w, h)
  for (let i = 0; i < alpha.length; i++) { const v = alpha[i]; g.data[i * 4] = g.data[i * 4 + 1] = g.data[i * 4 + 2] = v; g.data[i * 4 + 3] = 255 }
  return scaleMask(g, nw, nh)
}

const matteCache = new WeakMap()
/** Masks computed earlier for the same File (lets "Change background" reuse the mask from "Remove background"). */
export const getCachedMatte = (file, key) => matteCache.get(file)?.get(key)
export const putCachedMatte = (file, key, val) => {
  let m = matteCache.get(file)
  if (!m) matteCache.set(file, m = new Map())
  m.set(key, val)
}

/**
 * Find the subject in `source` (canvas). Returns {alpha: Uint8ClampedArray (width*height), width, height, device, ms}.
 * onProgress(fraction|null, label). Falls back from WebGPU to WebAssembly automatically.
 */
export async function matte(key, source, { onProgress, signal } = {}) {
  const spec = MATTE[key]
  let device = spec.gpu === false ? 'wasm' : await bestDevice()
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      onProgress?.(null, 'Loading AI model')
      const h = await loadHF(spec, device, onProgress)
      checkAbort(signal)
      onProgress?.(null, 'Finding the subject')
      await yieldToMain()
      const t0 = performance.now()
      const gray = await inferMatte(h, spec, source)
      checkAbort(signal)
      const alpha = scaleMask(gray, source.width, source.height)
      return { alpha, width: source.width, height: source.height, device: h.device, ms: performance.now() - t0 }
    } catch (e) {
      if (isAbort(e)) throw e
      if (device === 'webgpu') { console.warn('WebGPU failed, retrying on WebAssembly', e); markGpuBroken(); device = 'wasm'; continue }
      throw friendlyError(e)
    }
  }
}

// ---------------------------------------------------------------- mask math

/** Mean filter (edge normalised) over a Float32 plane. */
export function boxMeanF32(src, w, h, r) {
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const o = y * w
    let sum = 0
    for (let x = 0, lim = Math.min(r, w - 1); x <= lim; x++) sum += src[o + x]
    for (let x = 0; x < w; x++) {
      tmp[o + x] = sum / (Math.min(w - 1, x + r) - Math.max(0, x - r) + 1)
      if (x + r + 1 < w) sum += src[o + x + r + 1]
      if (x - r >= 0) sum -= src[o + x - r]
    }
  }
  const col = new Float32Array(w)
  for (let y = 0, lim = Math.min(r, h - 1); y <= lim; y++) for (let x = 0; x < w; x++) col[x] += tmp[y * w + x]
  for (let y = 0; y < h; y++) {
    const inv = 1 / (Math.min(h - 1, y + r) - Math.max(0, y - r) + 1)
    const o = y * w
    for (let x = 0; x < w; x++) out[o + x] = col[x] * inv
    if (y + r + 1 < h) { const a = (y + r + 1) * w; for (let x = 0; x < w; x++) col[x] += tmp[a + x] }
    if (y - r >= 0) { const a = (y - r) * w; for (let x = 0; x < w; x++) col[x] -= tmp[a + x] }
  }
  return out
}

/** Mean filter over a Uint8 plane (used for feathering at full resolution). Returns a new array. */
export function boxBlurU8(src, w, h, r) {
  if (r < 1) return src.slice()
  const tmp = new Uint8ClampedArray(w * h)
  const out = new Uint8ClampedArray(w * h)
  for (let y = 0; y < h; y++) {
    const o = y * w
    let sum = 0
    for (let x = 0, lim = Math.min(r, w - 1); x <= lim; x++) sum += src[o + x]
    for (let x = 0; x < w; x++) {
      tmp[o + x] = sum / (Math.min(w - 1, x + r) - Math.max(0, x - r) + 1) + 0.5
      if (x + r + 1 < w) sum += src[o + x + r + 1]
      if (x - r >= 0) sum -= src[o + x - r]
    }
  }
  const col = new Int32Array(w)
  for (let y = 0, lim = Math.min(r, h - 1); y <= lim; y++) for (let x = 0; x < w; x++) col[x] += tmp[y * w + x]
  for (let y = 0; y < h; y++) {
    const inv = 1 / (Math.min(h - 1, y + r) - Math.max(0, y - r) + 1)
    const o = y * w
    for (let x = 0; x < w; x++) out[o + x] = col[x] * inv + 0.5
    if (y + r + 1 < h) { const a = (y + r + 1) * w; for (let x = 0; x < w; x++) col[x] += tmp[a + x] }
    if (y - r >= 0) { const a = (y - r) * w; for (let x = 0; x < w; x++) col[x] -= tmp[a + x] }
  }
  return out
}

/** Gaussian-like blur of a Uint8 plane: three box passes. sigma in pixels. */
export function gaussU8(src, w, h, sigma) {
  if (sigma <= 0.4) return src.slice()
  const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2 - 0.5))
  let a = boxBlurU8(src, w, h, r)
  a = boxBlurU8(a, w, h, r)
  return boxBlurU8(a, w, h, r)
}

/** Grow (op 'max') or shrink (op 'min') a mask by `n` pixels with 3x3 steps. */
export function morph(src, w, h, n, op) {
  let a = src
  const mx = op === 'max'
  for (let k = 0; k < n; k++) {
    const t = new Uint8ClampedArray(w * h)
    for (let y = 0; y < h; y++) {
      const o = y * w
      for (let x = 0; x < w; x++) {
        const c = a[o + x], l = x > 0 ? a[o + x - 1] : c, r = x < w - 1 ? a[o + x + 1] : c
        t[o + x] = mx ? Math.max(c, l, r) : Math.min(c, l, r)
      }
    }
    const b = new Uint8ClampedArray(w * h)
    for (let y = 0; y < h; y++) {
      const o = y * w, u = (y > 0 ? y - 1 : y) * w, d = (y < h - 1 ? y + 1 : y) * w
      for (let x = 0; x < w; x++) {
        const c = t[o + x], up = t[u + x], dn = t[d + x]
        b[o + x] = mx ? Math.max(c, up, dn) : Math.min(c, up, dn)
      }
    }
    a = b
  }
  return a
}

/**
 * Edge-aware refinement (fast guided filter): snaps a soft, low-resolution mask to the real edges in the photo.
 * img: ImageData of the photo, alpha: Uint8 mask of the same size. Returns a new Uint8ClampedArray.
 */
export function guidedRefine(img, alpha, w, h, { radius = 0.012, eps = 2e-4 } = {}) {
  const s = Math.max(1, Math.round(Math.max(w, h) / 800))
  const ws = Math.ceil(w / s), hs = Math.ceil(h / s)
  const I = new Float32Array(ws * hs), P = new Float32Array(ws * hs)
  const d = img.data
  for (let by = 0; by < hs; by++) {
    for (let bx = 0; bx < ws; bx++) {
      let si = 0, sp = 0
      const y1 = Math.min(h, (by + 1) * s), x1 = Math.min(w, (bx + 1) * s)
      let n = 0
      for (let y = by * s; y < y1; y++) {
        for (let x = bx * s; x < x1; x++) {
          const i = y * w + x
          si += 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
          sp += alpha[i]
          n++
        }
      }
      I[by * ws + bx] = si / n / 255
      P[by * ws + bx] = sp / n / 255
    }
  }
  const r = Math.max(1, Math.round((Math.max(w, h) * radius) / s))
  const mI = boxMeanF32(I, ws, hs, r), mP = boxMeanF32(P, ws, hs, r)
  const II = new Float32Array(I.length), IP = new Float32Array(I.length)
  for (let i = 0; i < I.length; i++) { II[i] = I[i] * I[i]; IP[i] = I[i] * P[i] }
  const mII = boxMeanF32(II, ws, hs, r), mIP = boxMeanF32(IP, ws, hs, r)
  const A = new Float32Array(I.length), B = new Float32Array(I.length)
  for (let i = 0; i < I.length; i++) {
    const varI = mII[i] - mI[i] * mI[i]
    const cov = mIP[i] - mI[i] * mP[i]
    const a = cov / (varI + eps)
    A[i] = a
    B[i] = mP[i] - a * mI[i]
  }
  const mA = boxMeanF32(A, ws, hs, r), mB = boxMeanF32(B, ws, hs, r)
  const out = new Uint8ClampedArray(w * h)
  for (let y = 0; y < h; y++) {
    const fy = Math.min(hs - 1, Math.max(0, (y + 0.5) / s - 0.5))
    const y0 = Math.floor(fy), y1 = Math.min(hs - 1, y0 + 1), ty = fy - y0
    for (let x = 0; x < w; x++) {
      const fx = Math.min(ws - 1, Math.max(0, (x + 0.5) / s - 0.5))
      const x0 = Math.floor(fx), x1 = Math.min(ws - 1, x0 + 1), tx = fx - x0
      const i00 = y0 * ws + x0, i01 = y0 * ws + x1, i10 = y1 * ws + x0, i11 = y1 * ws + x1
      const w00 = (1 - tx) * (1 - ty), w01 = tx * (1 - ty), w10 = (1 - tx) * ty, w11 = tx * ty
      const a = mA[i00] * w00 + mA[i01] * w01 + mA[i10] * w10 + mA[i11] * w11
      const b = mB[i00] * w00 + mB[i01] * w01 + mB[i10] * w10 + mB[i11] * w11
      const i = y * w + x
      const lum = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255
      out[i] = (a * lum + b) * 255 + 0.5
    }
  }
  return out
}

/** Mild S-curve that snaps near-0 / near-1 mask values (removes faint ghosting and pinholes). */
export function tightenAlpha(alpha, lo = 0.06, hi = 0.94) {
  const lut = new Uint8ClampedArray(256)
  for (let i = 0; i < 256; i++) {
    const t = Math.min(1, Math.max(0, (i / 255 - lo) / (hi - lo)))
    lut[i] = (t * t * (3 - 2 * t)) * 255 + 0.5
  }
  const out = new Uint8ClampedArray(alpha.length)
  for (let i = 0; i < alpha.length; i++) out[i] = lut[alpha[i]]
  return out
}

/**
 * Turn the model output into the final mask. opts: {refine: true, source: ImageData, shift: px (+grow/-shrink), feather: px}
 * Pixel values are relative to a 1000 px long edge so sliders behave the same on every image size.
 */
export function finalizeAlpha(base, w, h, { shift = 0, feather = 0 } = {}) {
  const k = Math.max(w, h) / 1000
  let a = base
  const n = Math.round(Math.abs(shift) * k)
  if (n > 0) a = morph(a, w, h, n, shift > 0 ? 'max' : 'min')
  if (feather > 0) a = gaussU8(a, w, h, feather * k * 0.5)
  return a
}

/**
 * Remove background color bleeding from semi-transparent edge pixels (blur-fusion style foreground estimate).
 * Mutates `data` (RGBA Uint8ClampedArray) in place.
 */
export function decontaminate(data, alpha, w, h) {
  const s = Math.max(1, Math.round(Math.max(w, h) / 420))
  const ws = Math.ceil(w / s), hs = Math.ceil(h / s)
  const n = ws * hs
  const A = new Float32Array(n), A1 = new Float32Array(n)
  const FR = new Float32Array(n), FG = new Float32Array(n), FB = new Float32Array(n)
  const BR = new Float32Array(n), BG = new Float32Array(n), BB = new Float32Array(n)
  for (let by = 0; by < hs; by++) {
    for (let bx = 0; bx < ws; bx++) {
      const y1 = Math.min(h, (by + 1) * s), x1 = Math.min(w, (bx + 1) * s)
      let cnt = 0, sa = 0, fr = 0, fg = 0, fb = 0, br = 0, bg = 0, bb = 0
      for (let y = by * s; y < y1; y++) {
        for (let x = bx * s; x < x1; x++) {
          const i = y * w + x
          const a = alpha[i] / 255
          const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
          sa += a; fr += r * a; fg += g * a; fb += b * a
          br += r * (1 - a); bg += g * (1 - a); bb += b * (1 - a)
          cnt++
        }
      }
      const j = by * ws + bx
      A[j] = sa / cnt; A1[j] = 1 - sa / cnt
      FR[j] = fr / cnt; FG[j] = fg / cnt; FB[j] = fb / cnt
      BR[j] = br / cnt; BG[j] = bg / cnt; BB[j] = bb / cnt
    }
  }
  const r = Math.max(2, Math.round(Math.max(ws, hs) / 40))
  const bA = boxMeanF32(A, ws, hs, r), bA1 = boxMeanF32(A1, ws, hs, r)
  const bFR = boxMeanF32(FR, ws, hs, r), bFG = boxMeanF32(FG, ws, hs, r), bFB = boxMeanF32(FB, ws, hs, r)
  const bBR = boxMeanF32(BR, ws, hs, r), bBG = boxMeanF32(BG, ws, hs, r), bBB = boxMeanF32(BB, ws, hs, r)
  const fr = new Float32Array(n), fg = new Float32Array(n), fb = new Float32Array(n)
  const br = new Float32Array(n), bg = new Float32Array(n), bb = new Float32Array(n)
  for (let j = 0; j < n; j++) {
    const ka = bA[j] > 1e-3 ? 1 / bA[j] : 0, kb = bA1[j] > 1e-3 ? 1 / bA1[j] : 0
    fr[j] = bFR[j] * ka; fg[j] = bFG[j] * ka; fb[j] = bFB[j] * ka
    br[j] = bBR[j] * kb; bg[j] = bBG[j] * kb; bb[j] = bBB[j] * kb
  }
  const samp = (arr, fx, fy) => {
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(ws - 1, x0 + 1), y1 = Math.min(hs - 1, y0 + 1)
    const tx = fx - x0, ty = fy - y0
    return arr[y0 * ws + x0] * (1 - tx) * (1 - ty) + arr[y0 * ws + x1] * tx * (1 - ty) + arr[y1 * ws + x0] * (1 - tx) * ty + arr[y1 * ws + x1] * tx * ty
  }
  for (let y = 0; y < h; y++) {
    const fy = Math.min(hs - 1, Math.max(0, (y + 0.5) / s - 0.5))
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const av = alpha[i]
      if (av >= 250) continue
      const fx = Math.min(ws - 1, Math.max(0, (x + 0.5) / s - 0.5))
      const a = av / 255
      const Fr = samp(fr, fx, fy), Fg = samp(fg, fx, fy), Fb = samp(fb, fx, fy)
      if (av <= 2) { data[i * 4] = Fr; data[i * 4 + 1] = Fg; data[i * 4 + 2] = Fb; continue }
      const Br = samp(br, fx, fy), Bg = samp(bg, fx, fy), Bb = samp(bb, fx, fy)
      data[i * 4] = Fr + a * (data[i * 4] - a * Fr - (1 - a) * Br)
      data[i * 4 + 1] = Fg + a * (data[i * 4 + 1] - a * Fg - (1 - a) * Bg)
      data[i * 4 + 2] = Fb + a * (data[i * 4 + 2] - a * Fb - (1 - a) * Bb)
    }
  }
}

/** Build a transparent cutout canvas from a photo canvas and its mask. */
export function makeCutout(src, alpha, { defringe = true } = {}) {
  const w = src.width, h = src.height
  const id = imageDataOf(src)
  if (defringe) decontaminate(id.data, alpha, w, h)
  const d = id.data
  for (let i = 0; i < alpha.length; i++) d[i * 4 + 3] = alpha[i]
  const out = makeCanvas(w, h)
  out.getContext('2d').putImageData(id, 0, 0)
  return out
}

/** Bounding box of mask pixels above `thr`, or null. */
export function maskBounds(alpha, w, h, thr = 16) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    const o = y * w
    for (let x = 0; x < w; x++) {
      if (alpha[o + x] > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

// ---------------------------------------------------------------- ONNX Runtime (for models that are not in transformers.js format)

const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/'
let ortP = null
/** onnxruntime-web (WebGPU + WebAssembly build). Same version transformers.js uses, so the engine downloads once. */
export function ortRuntime() {
  if (!ortP) {
    ortP = import(`${ORT_BASE}ort.webgpu.bundle.min.mjs`).then((m) => {
      m.env.wasm.wasmPaths = ORT_BASE
      m.env.logLevel = 'error'
      return m
    }).catch((e) => { ortP = null; throw friendlyError(e) })
  }
  return ortP
}

const MODEL_CACHE = 'image-ai-models-v1'
/** Download a model file with progress, keeping a copy in Cache Storage so it only downloads once. */
export async function fetchModel(url, { size = 0, onProgress, signal, label = 'Downloading AI model' } = {}) {
  let cache = null
  try { cache = await caches.open(MODEL_CACHE) } catch { /* private mode */ }
  const hit = cache && await cache.match(url).catch(() => null)
  if (hit) return new Uint8Array(await hit.arrayBuffer())
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Could not download the AI model (HTTP ${res.status}).`)
  const total = Number(res.headers.get('content-length')) || size
  const reader = res.body.getReader()
  const chunks = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    onProgress?.(total ? Math.min(0.99, loaded / total) : null, `${label} (${formatBytes(loaded)})`)
  }
  const bytes = new Uint8Array(loaded)
  let o = 0
  for (const c of chunks) { bytes.set(c, o); o += c.length }
  try { await cache?.put(url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })) } catch { /* quota */ }
  return bytes
}

const sessions = new Map()
/**
 * Create (or reuse) an ONNX session. spec: {id, urls: {webgpu, wasm} | url, size}.
 * Tries WebGPU first when the spec allows it, then WebAssembly.
 */
export async function ortSession(spec, { onProgress, signal } = {}) {
  const order = []
  if (spec.gpu !== false && await bestDevice() === 'webgpu') order.push('webgpu')
  order.push('wasm')
  let lastErr = null
  for (const ep of order) {
    const key = `${spec.id}:${ep}`
    try {
      if (!sessions.has(key)) {
        sessions.set(key, (async () => {
          const ort = await ortRuntime()
          const url = typeof spec.urls === 'string' ? spec.urls : spec.urls[ep] || spec.urls.wasm
          const bytes = await fetchModel(url, { size: spec.size?.[ep] || spec.size, onProgress, signal })
          checkAbort(signal)
          onProgress?.(null, 'Starting the model')
          await yieldToMain()
          const session = await ort.InferenceSession.create(bytes, { executionProviders: [ep], graphOptimizationLevel: 'all', logSeverityLevel: 3 })
          markReady(spec.id)
          return { ort, session, ep }
        })().catch((e) => { sessions.delete(key); throw e }))
      }
      return await sessions.get(key)
    } catch (e) {
      if (isAbort(e)) throw e
      lastErr = e
      if (ep === 'webgpu') markGpuBroken()
    }
  }
  throw friendlyError(lastErr)
}
