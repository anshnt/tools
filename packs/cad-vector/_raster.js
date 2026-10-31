// Model page -> PNG through the browser's own SVG renderer (needs a canvas, no other DOM).
import { pageToSvg } from '../corel/_svgout.js'

const MAX_PX = 64_000_000

/** Render one page to a PNG Blob. opts: {dpi (default 150), transparent, fonts: Doc.fonts}. */
export async function pageToPng(page, { dpi = 150, transparent = false, fonts = null } = {}) {
  let k = dpi / 72
  if (page.w * page.h * k * k > MAX_PX) k = Math.sqrt(MAX_PX / (page.w * page.h))
  const w = Math.max(1, Math.round(page.w * k)), h = Math.max(1, Math.round(page.h * k))
  const svg = pageToSvg(page, { unit: 'pt', background: transparent ? null : '#ffffff', fonts }).replace(/ width="[^"]*" height="[^"]*"/, ` width="${w}" height="${h}"`)
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    try { await img.decode() } catch { throw new Error('The drawing could not be rendered to an image.') }
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h })
    c.getContext('2d').drawImage(img, 0, 0, w, h)
    const blob = c.convertToBlob ? await c.convertToBlob({ type: 'image/png' }) : await new Promise((res) => c.toBlob(res, 'image/png'))
    if (!blob) throw new Error('Could not create the PNG. Try a lower resolution.')
    return blob
  } finally { URL.revokeObjectURL(url) }
}
