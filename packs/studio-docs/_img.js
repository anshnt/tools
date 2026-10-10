// Image helpers for the document editor: turn a File into an image node's attributes, shrinking huge photos.
import { loadImage, fitSize, toCanvas, toBlob, isHeic } from '../../lib/image.js'
import { readDataURL } from '../../lib/files.js'
import { fileType } from '../../lib/ui.js'

const MAX_SIDE = 1800
const KEEP = /^image\/(png|jpeg|gif|webp|svg\+xml)$/

/** -> {src, width, height, alt}. Display width is capped at maxDisplayW CSS px so a photo fits the page. */
export async function fileToImageAttrs(file, maxDisplayW = 600) {
  const img = await loadImage(file)
  const nw = img.naturalWidth || 300, nh = img.naturalHeight || 200
  const type = fileType(file)
  let src, w = nw, h = nh
  const heavy = file.size > 1_500_000 || Math.max(nw, nh) > MAX_SIDE
  if (!isHeic(file) && KEEP.test(type) && !(heavy && type !== 'image/svg+xml' && type !== 'image/gif')) {
    src = await readDataURL(file)
  } else {
    const fit = fitSize(nw, nh, MAX_SIDE, MAX_SIDE)
    const out = type === 'image/png' || type === 'image/webp' || type === 'image/gif' ? 'image/png' : 'image/jpeg'
    const c = toCanvas(img, fit.width, fit.height, { background: out === 'image/jpeg' ? '#ffffff' : undefined })
    src = await readDataURL(await toBlob(c, out, 0.88))
    w = fit.width
    h = fit.height
  }
  const shown = fitSize(w, h, maxDisplayW, Infinity)
  return { src, width: shown.width, height: shown.height, alt: file.name.replace(/\.[^.]+$/, '') }
}

/** Natural size of an image URL or data URL. */
export async function imageSize(src) {
  const img = await loadImage(src)
  return { width: img.naturalWidth || 300, height: img.naturalHeight || 200 }
}
