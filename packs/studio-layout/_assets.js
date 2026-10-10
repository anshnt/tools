// Image assets: import (HEIC, EXIF rotation, odd formats normalised) and conversion to PDF-embeddable bytes.
import { loadImage, isHeic, heicToBlob, toCanvas, toBlob } from '../../lib/image.js'
import { fileType } from '../../lib/ui.js'
import { uid } from './_model.js'

/** EXIF orientation (1..8) of a JPEG, or 1. */
export function jpegOrientation(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1
  let o = 2
  while (o + 4 < bytes.length) {
    if (bytes[o] !== 0xff) break
    const marker = bytes[o + 1], len = (bytes[o + 2] << 8) | bytes[o + 3]
    if (marker === 0xe1 && bytes[o + 4] === 0x45 && bytes[o + 5] === 0x78) {
      const t = o + 10, le = bytes[t] === 0x49
      const u16 = (i) => (le ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1])
      const u32 = (i) => (le ? (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0 : ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0)
      const ifd = t + u32(t + 4), n = u16(ifd)
      for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (u16(e) === 0x0112) return u16(e + 8) || 1 }
      return 1
    }
    if (marker === 0xda) break
    o += 2 + len
  }
  return 1
}

/** Turn a picked file into an asset record {id, name, type, w, h, blob}. Throws a readable error for unsupported files. */
export async function importImage(file) {
  let blob = file
  let type = fileType(file)
  if (isHeic(file)) { blob = await heicToBlob(file); type = 'image/jpeg' }
  if (!type.startsWith('image/')) throw new Error(`${file.name} is not an image. Use JPG, PNG, WebP, GIF, SVG, AVIF or HEIC.`)
  const img = await loadImage(blob)
  let w = img.naturalWidth || 1200, h = img.naturalHeight || 800
  if (type === 'image/svg+xml' && (!img.naturalWidth || !img.naturalHeight)) { w = 1200; h = 800 }
  const native = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
  if (type === 'image/jpeg') {
    const bytes = new Uint8Array(await blob.slice(0, 65536).arrayBuffer())
    if (jpegOrientation(bytes) > 1) blob = await toBlob(toCanvas(img, w, h), 'image/jpeg', 0.95) // the browser applied the rotation; bake it in
  } else if (!native.includes(type)) {
    blob = await toBlob(toCanvas(img, w, h), 'image/png')
    type = 'image/png'
  }
  return { id: uid('a'), name: file.name || 'image', type, w, h, blob }
}

/** Bytes pdf-lib can embed: {kind: 'jpg'|'png', bytes}. Other formats (SVG, WebP, GIF) are drawn to a canvas first. */
export async function embeddable(asset, maxSide = 3000) {
  if (asset.type === 'image/jpeg') return { kind: 'jpg', bytes: new Uint8Array(await asset.blob.arrayBuffer()) }
  if (asset.type === 'image/png') return { kind: 'png', bytes: new Uint8Array(await asset.blob.arrayBuffer()) }
  const img = await loadImage(asset.blob)
  const s = Math.min(1, maxSide / Math.max(img.naturalWidth || asset.w, img.naturalHeight || asset.h))
  const c = toCanvas(img, Math.round((img.naturalWidth || asset.w) * s), Math.round((img.naturalHeight || asset.h) * s))
  return { kind: 'png', bytes: new Uint8Array(await (await toBlob(c, 'image/png')).arrayBuffer()) }
}
