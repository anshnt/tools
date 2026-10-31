// Camera RAW: full decode with LibRaw (wasm, in a worker) and a fallback that pulls out the JPEG preview every RAW file carries.
import { libraw } from './_libs.js'
import { raster } from './_codecs.js'

export const RAW_EXTS = ['cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'dng', 'orf', 'raf', 'rw2', 'rwl', 'pef', 'ptx', 'srw', 'raw', '3fr', 'fff', 'erf', 'mef', 'mrw', 'kdc', 'dcr', 'mos', 'iiq', 'x3f', 'cap', 'gpr']

/** End offset (exclusive) of the JPEG stream that starts at `s`, plus its size, or null when the stream is not a plain (baseline or progressive) JPEG. */
function jpegSpan(b, s) {
  let p = s + 2, w = 0, h = 0, sof = false
  while (p + 4 <= b.length) {
    if (b[p] !== 0xFF) return null
    const m = b[p + 1]
    if (m === 0xFF) { p++; continue }
    if (m === 0xD9) return sof ? { end: p + 2, width: w, height: h } : null
    if (m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { p += 2; continue }
    const len = (b[p + 2] << 8) | b[p + 3]
    if (m === 0xC0 || m === 0xC1 || m === 0xC2) { h = (b[p + 5] << 8) | b[p + 6]; w = (b[p + 7] << 8) | b[p + 8]; sof = true }
    else if (m >= 0xC3 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return null // lossless or arithmetic JPEG: sensor data, not a picture
    p += 2 + len
    if (m === 0xDA) { // skip entropy-coded data up to the next real marker
      while (p + 1 < b.length && !(b[p] === 0xFF && b[p + 1] !== 0 && !(b[p + 1] >= 0xD0 && b[p + 1] <= 0xD7))) p++
    }
  }
  return null
}

/** The biggest ordinary JPEG inside a RAW file (its preview), or null. */
export function extractPreview(b) {
  let best = null
  const n = b.length - 3
  for (let i = 0; i < n; i++) {
    if (b[i] !== 0xFF || b[i + 1] !== 0xD8 || b[i + 2] !== 0xFF) continue
    const span = jpegSpan(b, i)
    if (!span) continue
    const area = span.width * span.height
    if (area >= 160 * 120 && (!best || area > best.area)) best = { start: i, end: span.end, width: span.width, height: span.height, area }
    i = span.end - 1
  }
  return best ? { bytes: b.subarray(best.start, best.end), width: best.width, height: best.height } : null
}

/** Full decode with LibRaw. Resolves { raster, meta }. opts: { half: decode at half size, faster }. */
export async function decodeWithLibRaw(bytes, { half = false } = {}) {
  const lib = await libraw()
  try {
    await lib.call('open', bytes.slice(), { useCameraWb: true, outputBps: 8, outputColor: 1, halfSize: !!half })
    const meta = await lib.call('metadata', false).catch(() => ({}))
    const img = await lib.call('imageData')
    if (!img || !img.data || !img.width) throw new Error('The decoder returned no image.')
    const { width, height, colors, data, bits } = img
    const r = raster(width, height), d = r.data, shift = bits > 8 ? bits - 8 : 0
    for (let i = 0, o = 0; i < width * height; i++, o += 4) {
      if (colors >= 3) { d[o] = data[i * colors] >> shift; d[o + 1] = data[i * colors + 1] >> shift; d[o + 2] = data[i * colors + 2] >> shift }
      else d[o] = d[o + 1] = d[o + 2] = data[i * colors] >> shift
      d[o + 3] = 255
    }
    return { raster: r, meta }
  } finally {
    lib.close()
  }
}
