// Canvas helpers around the raster type { width, height, data: Uint8ClampedArray RGBA }. Uses OffscreenCanvas when there is one.
import { raster } from './_codecs.js'

export const MAX_PIXELS = 100_000_000

export function newCanvas(w, h) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h))
  if (w * h > MAX_PIXELS) throw new Error(`That image is too large to process here (${w} x ${h} pixels). Try a smaller size.`)
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  return Object.assign(document.createElement('canvas'), { width: w, height: h })
}

export function toCanvas(r) {
  const c = newCanvas(r.width, r.height)
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.data.buffer, r.data.byteOffset, r.data.length), r.width, r.height), 0, 0)
  return c
}

export function fromCanvas(c) {
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height)
  return { width: c.width, height: c.height, data: d.data }
}

/** Decode any picture the browser knows (JPEG, PNG, WebP, GIF, AVIF, BMP, ICO) into a raster. */
export async function decodeWithBrowser(blob) {
  let bmp
  try { bmp = await createImageBitmap(blob) } catch { throw new Error('This browser could not read that picture. The file may be damaged or in a format it does not support.') }
  try {
    const c = newCanvas(bmp.width, bmp.height)
    c.getContext('2d').drawImage(bmp, 0, 0)
    return fromCanvas(c)
  } finally { bmp.close?.() }
}

/** Resize to w x h, halving step by step first so big reductions stay sharp. */
export function resizeRaster(r, w, h) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h))
  if (w === r.width && h === r.height) return r
  let cur = toCanvas(r), cw = r.width, ch = r.height
  while (cw / 2 >= w && ch / 2 >= h) {
    const nw = Math.max(w, Math.ceil(cw / 2)), nh = Math.max(h, Math.ceil(ch / 2))
    const next = newCanvas(nw, nh), g = next.getContext('2d')
    g.imageSmoothingQuality = 'high'; g.drawImage(cur, 0, 0, nw, nh)
    cur = next; cw = nw; ch = nh
  }
  const out = newCanvas(w, h), g = out.getContext('2d')
  g.imageSmoothingQuality = 'high'; g.drawImage(cur, 0, 0, w, h)
  return fromCanvas(out)
}

/** Shrink to fit inside maxW x maxH (0 or empty means no limit). Never enlarges. */
export function limitSize(r, maxW, maxH) {
  const mw = maxW > 0 ? maxW : Infinity, mh = maxH > 0 ? maxH : Infinity
  const k = Math.min(1, mw / r.width, mh / r.height)
  return k >= 1 ? r : resizeRaster(r, r.width * k, r.height * k)
}

export function toGray(r) {
  const out = { width: r.width, height: r.height, data: new Uint8ClampedArray(r.data) }
  const d = out.data
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
  return out
}

/** Composite on an opaque background ('#rrggbb'). */
export function flatten(r, bg = '#ffffff') {
  const m = /^#?([0-9a-f]{6})$/i.exec(bg)
  const n = m ? parseInt(m[1], 16) : 0xFFFFFF
  const br = n >> 16, bgc = (n >> 8) & 255, bb = n & 255
  const out = { width: r.width, height: r.height, data: new Uint8ClampedArray(r.data.length) }
  const s = r.data, d = out.data
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3] / 255
    d[i] = s[i] * a + br * (1 - a); d[i + 1] = s[i + 1] * a + bgc * (1 - a); d[i + 2] = s[i + 2] * a + bb * (1 - a); d[i + 3] = 255
  }
  return out
}

/** Encode a canvas or raster as PNG, JPEG, WebP or AVIF. Rejects when the browser cannot write that type. */
export async function canvasBlob(source, type, quality) {
  const c = source.getContext ? source : toCanvas(source)
  const blob = c.convertToBlob ? await c.convertToBlob({ type, quality }) : await new Promise((res) => c.toBlob(res, type, quality))
  if (!blob || blob.type !== type) throw new Error(`This browser cannot save ${type.replace('image/', '').toUpperCase()} files. Try JPG, PNG or WebP.`)
  return blob
}

export const blank = raster
