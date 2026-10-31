// Write rasters as any output format. encodeFrames(frames, to, opts) -> { blob, ext, mime }
import {
  encodeTga, encodePnm, encodePcx, encodeQoi, encodeBmp, encodeTiff, buildIco, buildIcns, dibIconImage, ICNS_SIZES, hasAlpha,
} from './_codecs.js'
import { canvasBlob, flatten, newCanvas, toCanvas, resizeRaster, fromCanvas } from './_raster.js'
import { gifenc, upng, jxlEncoder, pdfLib } from './_libs.js'

export const OUTPUTS = {
  jpg: { ext: 'jpg', mime: 'image/jpeg', label: 'JPG' },
  png: { ext: 'png', mime: 'image/png', label: 'PNG' },
  webp: { ext: 'webp', mime: 'image/webp', label: 'WebP' },
  avif: { ext: 'avif', mime: 'image/avif', label: 'AVIF' },
  tiff: { ext: 'tiff', mime: 'image/tiff', label: 'TIFF', multi: true },
  bmp: { ext: 'bmp', mime: 'image/bmp', label: 'BMP' },
  gif: { ext: 'gif', mime: 'image/gif', label: 'GIF', multi: true },
  ico: { ext: 'ico', mime: 'image/x-icon', label: 'ICO' },
  cur: { ext: 'cur', mime: 'image/x-icon', label: 'CUR' },
  icns: { ext: 'icns', mime: 'image/icns', label: 'ICNS' },
  tga: { ext: 'tga', mime: 'image/x-tga', label: 'TGA' },
  ppm: { ext: 'ppm', mime: 'image/x-portable-pixmap', label: 'PPM' },
  pgm: { ext: 'pgm', mime: 'image/x-portable-graymap', label: 'PGM' },
  pbm: { ext: 'pbm', mime: 'image/x-portable-bitmap', label: 'PBM' },
  pnm: { ext: 'pnm', mime: 'image/x-portable-anymap', label: 'PNM' },
  pcx: { ext: 'pcx', mime: 'image/x-pcx', label: 'PCX' },
  qoi: { ext: 'qoi', mime: 'image/qoi', label: 'QOI' },
  jxl: { ext: 'jxl', mime: 'image/jxl', label: 'JPEG XL' },
  apng: { ext: 'png', mime: 'image/apng', label: 'APNG', multi: true },
  pdf: { ext: 'pdf', mime: 'application/pdf', label: 'PDF', multi: true },
}
/** Targets that keep several frames in one file. */
export const MULTI = new Set(Object.keys(OUTPUTS).filter((k) => OUTPUTS[k].multi))

export const ICO_SIZE_SETS = { all: [16, 24, 32, 48, 64, 128, 256], web: [16, 32, 48], large: [256], one: [32] }
const sizesOf = (opts, fallback) => {
  const s = opts.sizes
  const list = Array.isArray(s) ? s : ICO_SIZE_SETS[s] || fallback
  return [...new Set(list.map(Number).filter((n) => n >= 1 && n <= 1024))].sort((a, b) => a - b)
}

/** s x s square from a raster, the picture scaled to fit and centered on transparency. */
export function fitSquare(r, s) {
  const k = Math.min(s / r.width, s / r.height)
  const w = Math.max(1, Math.round(r.width * k)), h = Math.max(1, Math.round(r.height * k))
  const scaled = resizeRaster(r, w, h)
  const out = newCanvas(s, s), g = out.getContext('2d')
  g.drawImage(toCanvas(scaled), Math.round((s - w) / 2), Math.round((s - h) / 2))
  return fromCanvas(out)
}
const pngBytes = async (r) => new Uint8Array(await (await canvasBlob(r, 'image/png')).arrayBuffer())
const sameSize = (frames) => {
  const { width: w, height: h } = frames[0]
  return frames.map((f) => (f.width === w && f.height === h ? f : resizeRaster(f, w, h)))
}

/** frames: [{ raster | load(), delay?, label? }]. TIFF pages are decoded as they are needed, and PDF and TIFF output is written page by page. */
export async function encodeFrames(frames, to, opts = {}) {
  const o = OUTPUTS[to]
  if (!o) throw new Error(`Unknown output format "${to}".`)
  const q = Math.min(100, Math.max(1, opts.quality ?? 90)) / 100
  const bg = opts.background || '#ffffff'
  const rasterOf = async (f) => f.raster || (f.load ? await f.load() : f)
  const first = await rasterOf(frames[0])
  const pages = async function* () { for (const f of frames) yield f === frames[0] ? first : await rasterOf(f) }
  const loadAll = async () => { const out = []; for (const f of frames) out.push(await rasterOf(f)); return out }
  const blob = (data) => ({ blob: new Blob([data], { type: o.mime }), ext: o.ext, mime: o.mime })
  switch (to) {
    case 'jpg': return { blob: await canvasBlob(flatten(first, bg), 'image/jpeg', q), ext: o.ext, mime: o.mime }
    case 'png': return { blob: await canvasBlob(first, 'image/png'), ext: o.ext, mime: o.mime }
    case 'webp': return { blob: await canvasBlob(first, 'image/webp', q), ext: o.ext, mime: o.mime }
    case 'avif': return { blob: await canvasBlob(first, 'image/avif', q), ext: o.ext, mime: o.mime }
    case 'bmp': return blob(encodeBmp(first))
    case 'tga': return blob(encodeTga(first, { rle: opts.tgaRle !== false }))
    case 'ppm': case 'pgm': case 'pbm': case 'pnm': return blob(encodePnm(first, to))
    case 'pcx': return blob(encodePcx(first))
    case 'qoi': return blob(encodeQoi(first))
    case 'tiff': return blob(await encodeTiff(pages(), { compression: opts.tiffCompression === 'none' ? 'none' : 'deflate', gray: !!opts.grayscale }))
    case 'gif': return blob(await encodeGif(await loadAll(), frames, opts))
    case 'apng': return blob(await encodeApng(sameSize(await loadAll()), frames, opts))
    case 'jxl': return blob(await encodeJxl(first, opts))
    case 'pdf': return blob(await encodePdf(pages(), opts))
    case 'ico': {
      const sizes = sizesOf(opts, ICO_SIZE_SETS.all)
      if (!sizes.length) throw new Error('Pick at least one icon size.')
      const entries = []
      for (const s of sizes.filter((s) => s <= 256)) entries.push({ width: s, height: s, data: await pngBytes(fitSquare(first, s)) })
      if (!entries.length) throw new Error('ICO files hold sizes up to 256 pixels.')
      return blob(buildIco(entries, 'ico'))
    }
    case 'cur': {
      const s = Math.min(256, Array.isArray(opts.sizes) && Number(opts.sizes[0]) >= 1 ? Number(opts.sizes[0]) : 32)
      const sq = fitSquare(first, s)
      return blob(buildIco([{ width: s, height: s, data: dibIconImage(sq), hotX: Math.min(s - 1, Math.max(0, opts.hotX | 0)), hotY: Math.min(s - 1, Math.max(0, opts.hotY | 0)) }], 'cur'))
    }
    case 'icns': {
      const big = Math.max(first.width, first.height)
      const sizes = (Array.isArray(opts.sizes) ? opts.sizes : ICNS_SIZES).filter((s) => ICNS_SIZES.includes(+s) && (s <= 256 || s <= big * 1.01 || opts.upscale))
      if (!sizes.length) throw new Error('Pick at least one icon size.')
      const pngs = {}
      for (const s of sizes) pngs[s] = await pngBytes(fitSquare(first, +s))
      return blob(buildIcns(pngs))
    }
    default: throw new Error(`Cannot write ${o.label} files.`)
  }
}

async function encodeGif(rs, frames, opts) {
  const { GIFEncoder, quantize, applyPalette } = await gifenc()
  const enc = GIFEncoder()
  const flat = rs.length > 1 ? sameSize(rs) : rs
  flat.forEach((r, i) => {
    const data = r.data
    let alpha = false
    for (let k = 3; k < data.length; k += 4) if (data[k] < 128) { alpha = true; break }
    const fmt = alpha ? 'rgba4444' : 'rgb565'
    const palette = quantize(data, 256, alpha ? { format: fmt, oneBitAlpha: true } : { format: fmt })
    const index = applyPalette(data, palette, fmt)
    const ti = alpha ? palette.findIndex((p) => p[3] === 0) : -1
    enc.writeFrame(index, r.width, r.height, { palette, delay: frames[i]?.delay ?? 100, repeat: opts.loop === 'once' ? -1 : 0, transparent: ti >= 0, transparentIndex: Math.max(0, ti), dispose: ti >= 0 ? 2 : -1 })
  })
  enc.finish()
  return enc.bytes()
}

async function encodeApng(rs, frames, opts) {
  const UPNG = await upng()
  const { width: w, height: h } = rs[0]
  const bufs = rs.map((r) => r.data.buffer.slice(r.data.byteOffset, r.data.byteOffset + r.data.length))
  const colors = opts.apngColors > 0 ? Math.min(256, opts.apngColors) : 0
  const delays = rs.map((_, i) => frames[i]?.delay ?? 100)
  return new Uint8Array(UPNG.encode(bufs, w, h, colors, rs.length > 1 ? delays : undefined))
}

async function encodeJxl(r, opts) {
  const enc = await jxlEncoder()
  const quality = Math.min(100, Math.max(1, Math.round(opts.quality ?? 90)))
  const lossless = opts.jxlLossless === true || quality >= 100
  const out = enc.encode(r.data, r.width, r.height, {
    effort: opts.effort ?? 7, quality: lossless ? 100 : quality, progressive: false, epf: -1, lossyPalette: false, decodingSpeedTier: 0, photonNoiseIso: 0, lossyModular: false, lossless,
  })
  if (!out) throw new Error('Could not write the JPEG XL file.')
  return new Uint8Array(out)
}

async function encodePdf(rs, opts) {
  const { PDFDocument } = await pdfLib()
  const doc = await PDFDocument.create()
  const dpi = opts.dpi > 0 ? opts.dpi : 150
  const q = Math.min(100, Math.max(1, opts.quality ?? 90)) / 100
  for await (const r of rs) {
    const alpha = hasAlpha(r)
    const img = alpha ? await doc.embedPng(await pngBytes(r)) : await doc.embedJpg(new Uint8Array(await (await canvasBlob(r, 'image/jpeg', q)).arrayBuffer()))
    const page = doc.addPage([(r.width * 72) / dpi, (r.height * 72) / dpi])
    page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() })
  }
  return doc.save()
}
