// Encoders and resampling for the image tools: canvas formats plus our own BMP, ICO (PNG-in-ICO), GIF and indexed PNG.
import { toBlob, canEncode, canvas as makeCanvas, toCanvas } from '../../lib/image.js'
import { pngChunk, PNG_SIG, concat } from './_meta.js'

const GIFENC = 'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/+esm'
let gifencP
const gifenc = () => (gifencP ??= import(GIFENC).catch((e) => { gifencP = null; throw Object.assign(new Error('Could not load the GIF encoder. Check your connection and try again.'), { cause: e }) }))

export const FORMATS = {
  jpg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPG', lossy: true, alpha: false },
  png: { mime: 'image/png', ext: 'png', label: 'PNG', alpha: true },
  webp: { mime: 'image/webp', ext: 'webp', label: 'WebP', lossy: true, alpha: true },
  avif: { mime: 'image/avif', ext: 'avif', label: 'AVIF', lossy: true, alpha: true },
  gif: { mime: 'image/gif', ext: 'gif', label: 'GIF', alpha: true },
  bmp: { mime: 'image/bmp', ext: 'bmp', label: 'BMP', alpha: false },
  ico: { mime: 'image/x-icon', ext: 'ico', label: 'ICO', alpha: true },
}
export const formatFromMime = (mime = '') => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico' })[mime.toLowerCase()]

/** Draw src onto a fresh w x h canvas, halving step by step first so big reductions stay sharp. background fills transparency. */
export function resample(src, w, h, { background } = {}) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h))
  let cur = src
  let sw = src.naturalWidth || src.videoWidth || src.width, sh = src.naturalHeight || src.videoHeight || src.height
  while (sw / 2 >= w && sh / 2 >= h && sw > 2 && sh > 2) {
    const tw = Math.max(w, Math.ceil(sw / 2)), th = Math.max(h, Math.ceil(sh / 2))
    cur = toCanvas(cur, tw, th)
    sw = tw; sh = th
  }
  return toCanvas(cur, w, h, { background })
}

/** Copy a canvas onto an opaque background (needed before JPEG/BMP, which have no transparency). */
export function flatten(c, background = '#ffffff') {
  const out = makeCanvas(c.width, c.height)
  const ctx = out.getContext('2d')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(c, 0, 0)
  return out
}

/** s x s square from any source. fit 'contain' pads with transparency, 'cover' crops the middle. */
export function fitSquare(src, s, fit = 'contain', { background } = {}) {
  const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height
  const out = makeCanvas(s, s)
  const ctx = out.getContext('2d')
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, s, s) }
  const k = fit === 'cover' ? Math.max(s / sw, s / sh) : Math.min(s / sw, s / sh)
  const dw = Math.max(1, Math.round(sw * k)), dh = Math.max(1, Math.round(sh * k))
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(resample(src, dw, dh), Math.round((s - dw) / 2), Math.round((s - dh) / 2))
  return out
}

export function encodeBmp(c, background = '#ffffff') {
  const flat = flatten(c, background)
  const { data } = flat.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, flat.width, flat.height)
  const w = flat.width, h = flat.height, row = (w * 3 + 3) & ~3, size = 54 + row * h
  const buf = new ArrayBuffer(size)
  const dv = new DataView(buf), px = new Uint8Array(buf)
  px[0] = 0x42; px[1] = 0x4D
  dv.setUint32(2, size, true); dv.setUint32(10, 54, true); dv.setUint32(14, 40, true)
  dv.setInt32(18, w, true); dv.setInt32(22, h, true); dv.setUint16(26, 1, true); dv.setUint16(28, 24, true)
  dv.setUint32(34, row * h, true); dv.setInt32(38, 2835, true); dv.setInt32(42, 2835, true)
  for (let y = 0; y < h; y++) {
    let o = 54 + (h - 1 - y) * row
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) { px[o++] = data[i + 2]; px[o++] = data[i + 1]; px[o++] = data[i] }
  }
  return new Blob([buf], { type: 'image/bmp' })
}

/** Multi-size ICO with PNG-compressed images (supported since Windows Vista and by every browser). */
export async function encodeIco(c, sizes = [16, 32, 48], fit = 'contain') {
  sizes = [...new Set(sizes)].filter((s) => s >= 1 && s <= 256).sort((a, b) => a - b)
  if (!sizes.length) throw new Error('Pick at least one icon size.')
  const pngs = []
  for (const s of sizes) pngs.push(new Uint8Array(await (await toBlob(fitSquare(c, s, fit), 'image/png')).arrayBuffer()))
  const head = new Uint8Array(6 + 16 * sizes.length)
  const dv = new DataView(head.buffer)
  dv.setUint16(2, 1, true); dv.setUint16(4, sizes.length, true)
  let offset = head.length
  sizes.forEach((s, i) => {
    const e = 6 + i * 16
    head[e] = s >= 256 ? 0 : s; head[e + 1] = s >= 256 ? 0 : s
    dv.setUint16(e + 4, 1, true); dv.setUint16(e + 6, 32, true)
    dv.setUint32(e + 8, pngs[i].length, true); dv.setUint32(e + 12, offset, true)
    offset += pngs[i].length
  })
  return new Blob([head, ...pngs], { type: 'image/x-icon' })
}

/**
 * Reduce a canvas to a palette (<= maxColors) with optional Floyd-Steinberg dithering.
 * Returns {palette: [[r,g,b,a]], index: Uint8Array, width, height, hasAlpha}. When hasAlpha, palette[0] is fully transparent.
 */
export async function quantizeCanvas(c, maxColors = 256, { dither = 'auto' } = {}) {
  const { quantize } = await gifenc()
  const { data, width: w, height: h } = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height)
  let hasAlpha = false
  for (let i = 3; i < data.length; i += 4) if (data[i] < 128) { hasAlpha = true; break }
  maxColors = Math.max(2, Math.min(256, Math.round(maxColors)))
  let palette
  if (hasAlpha) {
    const q = quantize(data, maxColors - 1, { format: 'rgba4444', oneBitAlpha: true }).filter((p) => p[3] > 0 || false)
    palette = [[0, 0, 0, 0], ...q.map((p) => [p[0], p[1], p[2], 255])]
  } else palette = quantize(data, maxColors).map((p) => [p[0], p[1], p[2], 255])
  if (dither === 'auto') {
    const seen = new Set()
    for (let i = 0; i < data.length && seen.size < 3000; i += 28) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2])
    dither = seen.size >= 3000
  }
  const first = hasAlpha ? 1 : 0, n = palette.length
  const cache = new Int16Array(32768).fill(-1)
  const nearest = (r, g, b) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    if (cache[key] >= 0) return cache[key]
    const rr = (r & 248) | 4, gg = (g & 248) | 4, bb = (b & 248) | 4
    let best = first, bd = Infinity
    for (let i = first; i < n; i++) {
      const p = palette[i], dr = p[0] - rr, dg = p[1] - gg, db = p[2] - bb
      const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db
      if (d < bd) { bd = d; best = i }
    }
    return (cache[key] = best)
  }
  const index = new Uint8Array(w * h)
  let errCur = new Float32Array((w + 2) * 3), errNext = new Float32Array((w + 2) * 3)
  for (let y = 0; y < h; y++) {
    errNext.fill(0)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (hasAlpha && data[i + 3] < 128) { index[y * w + x] = 0; continue }
      let r = data[i], g = data[i + 1], b = data[i + 2]
      if (dither) {
        const e = (x + 1) * 3
        r = Math.max(0, Math.min(255, r + errCur[e])); g = Math.max(0, Math.min(255, g + errCur[e + 1])); b = Math.max(0, Math.min(255, b + errCur[e + 2]))
      }
      const k = nearest(r | 0, g | 0, b | 0)
      index[y * w + x] = k
      if (dither) {
        const p = palette[k], er = (r - p[0]) * 0.85, eg = (g - p[1]) * 0.85, eb = (b - p[2]) * 0.85
        const e = (x + 1) * 3
        errCur[e + 3] += er * 7 / 16; errCur[e + 4] += eg * 7 / 16; errCur[e + 5] += eb * 7 / 16
        errNext[e - 3] += er * 3 / 16; errNext[e - 2] += eg * 3 / 16; errNext[e - 1] += eb * 3 / 16
        errNext[e] += er * 5 / 16; errNext[e + 1] += eg * 5 / 16; errNext[e + 2] += eb * 5 / 16
        errNext[e + 3] += er / 16; errNext[e + 4] += eg / 16; errNext[e + 5] += eb / 16
      }
    }
    ;[errCur, errNext] = [errNext, errCur]
  }
  return { palette, index, width: w, height: h, hasAlpha }
}

async function deflate(bytes) {
  const cs = new CompressionStream('deflate')
  const writer = cs.writable.getWriter()
  writer.write(bytes)
  writer.close()
  return new Uint8Array(await new Response(cs.readable).arrayBuffer())
}

/** Palette (indexed) PNG: far smaller than truecolor for graphics and screenshots. colors 2-256. */
export async function encodeIndexedPng(c, colors = 256, opts = {}) {
  const { palette, index, width: w, height: h, hasAlpha } = await quantizeCanvas(c, colors, opts)
  const depth = palette.length <= 2 ? 1 : palette.length <= 4 ? 2 : palette.length <= 16 ? 4 : 8
  const rowBytes = Math.ceil((w * depth) / 8)
  const raw = new Uint8Array((rowBytes + 1) * h)
  for (let y = 0; y < h; y++) {
    const o = y * (rowBytes + 1) + 1
    if (depth === 8) raw.set(index.subarray(y * w, (y + 1) * w), o)
    else for (let x = 0; x < w; x++) raw[o + ((x * depth) >> 3)] |= index[y * w + x] << (8 - depth - ((x * depth) & 7))
  }
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = depth; ihdr[9] = 3
  const plte = new Uint8Array(palette.length * 3)
  palette.forEach((p, i) => plte.set([p[0], p[1], p[2]], i * 3))
  const parts = [PNG_SIG, pngChunk('IHDR', ihdr), pngChunk('PLTE', plte)]
  if (hasAlpha) parts.push(pngChunk('tRNS', new Uint8Array([0])))
  parts.push(pngChunk('IDAT', await deflate(raw)), pngChunk('IEND'))
  return new Blob([concat(...parts)], { type: 'image/png' })
}

/** GIF with a median-cut palette, optional dithering and 1-bit transparency. */
export async function encodeGif(c, { colors = 256, dither = 'auto', background } = {}) {
  const { GIFEncoder } = await gifenc()
  const src = background ? flatten(c, background) : c
  const { palette, index, width, height, hasAlpha } = await quantizeCanvas(src, colors, { dither })
  const gif = GIFEncoder()
  gif.writeFrame(index, width, height, { palette: palette.map((p) => [p[0], p[1], p[2]]), transparent: hasAlpha, transparentIndex: 0 })
  gif.finish()
  return new Blob([gif.bytes()], { type: 'image/gif' })
}

/**
 * Encode a canvas to a Blob in any supported format.
 * opts: quality 0..1 (jpg, webp, avif), background (jpg, bmp, gif), colors (gif), sizes + icoFit (ico).
 */
export async function encode(c, fmt, { quality = 0.9, background, colors = 256, dither = 'auto', sizes = [16, 32, 48], icoFit = 'contain' } = {}) {
  const f = FORMATS[fmt]
  if (!f) throw new Error(`Unknown image format "${fmt}".`)
  if (fmt === 'jpg') return toBlob(flatten(c, background || '#ffffff'), f.mime, quality)
  if (fmt === 'png') return toBlob(c, f.mime)
  if (fmt === 'webp') return toBlob(background ? flatten(c, background) : c, f.mime, quality)
  if (fmt === 'avif') {
    if (!canEncode(f.mime)) throw new Error('This browser cannot save AVIF images. Use Chrome or Edge, or pick WebP.')
    return toBlob(background ? flatten(c, background) : c, f.mime, quality)
  }
  if (fmt === 'gif') return encodeGif(c, { colors, dither, background })
  if (fmt === 'bmp') return encodeBmp(c, background || '#ffffff')
  return encodeIco(c, sizes, icoFit)
}

/** Whether the browser can write this format (GIF, BMP and ICO use our encoders, so they always work). */
export const canWrite = (fmt) => (fmt === 'avif' ? canEncode('image/avif') : fmt === 'webp' ? canEncode('image/webp') : true)
