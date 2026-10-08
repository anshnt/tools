// Image helpers: decode (incl. iPhone HEIC), draw, encode, and compress to a target size. Canvas-based, fully local.
import { fileType } from './ui.js'

export const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', bmp: 'image/bmp' }
export const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'image/bmp': 'bmp' }
/** Types every modern browser can encode from a canvas. AVIF works in Chromium only (check canEncode); GIF, BMP, ICO and TIFF need your own encoder. */
export const NATIVE_ENCODE = ['image/jpeg', 'image/png', 'image/webp']

const HEIC_TO = 'https://cdn.jsdelivr.net/npm/heic-to@1.5.2/+esm'
export const isHeic = (f) => f instanceof Blob && /image\/hei[cf]/.test(f.name !== undefined ? fileType(f) : f.type || '')

/** Convert a HEIC/HEIF photo to a JPEG (or PNG) Blob in the browser. */
export async function heicToBlob(file, type = 'image/jpeg', quality = 0.92) {
  const { heicTo } = await import(HEIC_TO)
  try {
    return await heicTo({ blob: file, type, quality })
  } catch (e) {
    throw Object.assign(new Error('Could not decode this HEIC photo.'), { cause: e })
  }
}

/** Decode a File/Blob/URL into an HTMLImageElement (EXIF orientation applied by the browser). HEIC is converted automatically. */
export async function loadImage(src) {
  if (src instanceof Blob && isHeic(src)) src = await heicToBlob(src)
  const url = src instanceof Blob ? URL.createObjectURL(src) : src
  const img = new Image()
  img.decoding = 'async'
  img.src = url
  try {
    await img.decode()
  } catch {
    throw new Error('Could not read this image. Try JPG, PNG, WebP, GIF, AVIF or HEIC.')
  } finally {
    if (src instanceof Blob) setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return img
}

/** Largest canvas area that is safe on this device (iOS Safari caps at ~16.7 MP). */
export const MAX_PIXELS = /iP(hone|ad|od)|Macintosh.*Mobile/.test(navigator.userAgent) || navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform) ? 16_000_000 : 64_000_000

export function canvas(w, h) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  if (c.width * c.height > MAX_PIXELS) throw new Error(`That image is too large to process here (${c.width} x ${c.height}). Try a smaller size.`)
  return c
}

/** Draw a source (img/canvas/bitmap/video) into a new canvas of size w x h. background fills transparency (e.g. '#fff' for JPEG). */
export function toCanvas(source, w = source.naturalWidth || source.videoWidth || source.width, h = source.naturalHeight || source.videoHeight || source.height, { background, smoothing = 'high' } = {}) {
  const c = canvas(w, h)
  const ctx = c.getContext('2d')
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, c.width, c.height) }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = smoothing
  ctx.drawImage(source, 0, 0, c.width, c.height)
  return c
}

/** Fit (w,h) inside (maxW,maxH) keeping aspect ratio. Never upscales unless allowUpscale. */
export function fitSize(w, h, maxW = Infinity, maxH = Infinity, allowUpscale = false) {
  let s = Math.min(maxW / w, maxH / h)
  if (!allowUpscale) s = Math.min(1, s)
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) }
}

/** canvas -> Blob of exactly `type` (rejects instead of silently returning PNG). quality 0..1 for jpeg/webp/avif. */
export function toBlob(c, type = 'image/png', quality) {
  return new Promise((resolve, reject) => c.toBlob((b) => {
    if (!b) reject(new Error('Could not encode the image (it may be too large for this device).'))
    else if (b.type !== type) reject(new Error(`This browser cannot save ${type.replace('image/', '').toUpperCase()} images. Try JPG, PNG or WebP.`))
    else resolve(b)
  }, type, quality))
}

const encodable = new Map()
/** True if the browser can encode the MIME type from a canvas (e.g. AVIF is Chromium-only). */
export function canEncode(type) {
  if (!encodable.has(type)) {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    encodable.set(type, c.toDataURL(type).startsWith(`data:${type}`))
  }
  return encodable.get(type)
}

/**
 * Compress to a byte budget. Binary-searches quality, then downsizes if needed.
 * compressToTarget(source, {maxBytes, minBytes, type: 'image/jpeg', background: '#fff', minQuality: .05, allowResize: true})
 * -> {blob, quality, width, height, hit}  (hit = within [minBytes, maxBytes])
 */
export async function compressToTarget(source, opts) {
  const { maxBytes, minBytes = 0, type = 'image/jpeg', background = type === 'image/jpeg' ? '#ffffff' : undefined, minQuality = 0.05, allowResize = true } = opts
  if (!canEncode(type)) throw new Error(`This browser cannot save ${type.replace('image/', '').toUpperCase()} images. Try JPG or WebP.`)
  const lossy = type !== 'image/png'
  let w = source.naturalWidth || source.width, h = source.naturalHeight || source.height
  let best = null
  for (let attempt = 0; attempt < 14; attempt++) {
    const c = toCanvas(source, w, h, { background })
    if (!lossy) {
      const blob = await toBlob(c, type)
      best = { blob, quality: 1, width: c.width, height: c.height }
      if (blob.size <= maxBytes) break
    } else {
      let lo = minQuality, hi = 1, found = null
      for (let i = 0; i < 8; i++) {
        const q = (lo + hi) / 2
        const blob = await toBlob(c, type, q)
        if (blob.size <= maxBytes) { found = { blob, quality: q, width: c.width, height: c.height }; lo = q } else hi = q
      }
      if (!found) {
        const blob = await toBlob(c, type, minQuality)
        if (blob.size <= maxBytes) found = { blob, quality: minQuality, width: c.width, height: c.height }
      }
      if (found) { best = found; break }
      best = { blob: await toBlob(c, type, minQuality), quality: minQuality, width: c.width, height: c.height }
    }
    if (!allowResize) break
    w = Math.max(16, Math.round(w * 0.85)); h = Math.max(16, Math.round(h * 0.85))
  }
  best.hit = best.blob.size <= maxBytes && best.blob.size >= minBytes
  return best
}

/** Read pixels: returns ImageData for a source scaled to (w,h). */
export function pixels(source, w, h) {
  const c = toCanvas(source, w, h)
  return c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height)
}
