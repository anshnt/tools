// Scientific and medical formats: FITS, Radiance HDR, tone mapping for HDR pixels, and DICOM (parser, RLE, lossless JPEG).
// No DOM, no libraries. A raster is { width, height, data: Uint8ClampedArray RGBA }.
import { raster, inflate, ascii, be32 } from './_codecs.js'

const fail = (m) => { throw new Error(m) }

// ---------------------------------------------------------------- FITS
/** Read the first image in a FITS file. Returns { width, height, planes, data: Float32Array (planes x h x w, rows bottom first), header }. */
export function parseFits(b) {
  if (b.length < 2880 || ascii(b, 0, 9) !== 'SIMPLE  =') fail('This is not a FITS file.')
  let pos = 0
  for (let hdu = 0; hdu < 64 && pos + 2880 <= b.length; hdu++) {
    const header = {}
    let done = false
    while (!done && pos + 2880 <= b.length) {
      for (let c = 0; c < 36; c++) {
        const card = ascii(b, pos + c * 80, 80)
        const key = card.slice(0, 8).trim()
        if (key === 'END') { done = true; break }
        if (card[8] === '=') {
          let v = card.slice(10)
          const q = v.trim()[0] === "'"
          if (q) { const m = v.match(/'((?:[^']|'')*)'/); v = m ? m[1].replace(/''/g, "'").trim() : '' } else v = v.split('/')[0].trim()
          if (!(key in header)) header[key] = v
        }
      }
      pos += 2880
    }
    const bitpix = +header.BITPIX, naxis = +header.NAXIS || 0
    const dims = []
    for (let i = 1; i <= naxis; i++) dims.push(+header['NAXIS' + i])
    const count = naxis ? dims.reduce((a, c) => a * c, 1) : 0
    const bytes = (Math.abs(bitpix) / 8) * count
    const isImage = hdu === 0 || header.XTENSION === 'IMAGE'
    if (header.ZIMAGE === 'T') fail('This FITS file stores its image in tile-compressed form, which is not supported.')
    if (isImage && naxis >= 2 && count > 0 && bytes <= b.length - pos) {
      const w = dims[0], h = dims[1], planes = naxis >= 3 ? Math.min(dims[2], 3) : 1
      if (w * h > 268_000_000) fail('This FITS image is too large.')
      const n = w * h * planes
      const out = new Float32Array(n), dv = new DataView(b.buffer, b.byteOffset + pos, bytes)
      const bz = header.BZERO !== undefined ? +header.BZERO : 0, bs = header.BSCALE !== undefined ? +header.BSCALE : 1
      for (let i = 0; i < n; i++) {
        let v
        if (bitpix === 8) v = dv.getUint8(i)
        else if (bitpix === 16) v = dv.getInt16(i * 2)
        else if (bitpix === 32) v = dv.getInt32(i * 4)
        else if (bitpix === 64) v = Number(dv.getBigInt64(i * 8))
        else if (bitpix === -32) v = dv.getFloat32(i * 4)
        else if (bitpix === -64) v = dv.getFloat64(i * 8)
        else fail(`This FITS file uses BITPIX ${bitpix}, which is not supported.`)
        out[i] = v * bs + bz
      }
      return { width: w, height: h, planes, data: out, header }
    }
    pos += Math.ceil(Math.max(bytes, 0) / 2880) * 2880
  }
  fail('This FITS file has no image in it.')
}

/** Percentile of a numeric sample (skips NaN and Infinity). */
function percentile(values, lo, hi) {
  const step = Math.max(1, Math.floor(values.length / 200000)), s = []
  for (let i = 0; i < values.length; i += step) if (Number.isFinite(values[i])) s.push(values[i])
  if (!s.length) return [0, 1]
  s.sort((x, y) => x - y)
  const at = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]
  return [at(lo), at(hi)]
}

/** FITS to an 8-bit picture. opts: { stretch: 'asinh'|'linear'|'sqrt'|'log', low: 0..1, high: 0..1 }. */
export function renderFits(f, { stretch = 'asinh', low = 0.005, high = 0.995 } = {}) {
  const { width: w, height: h, planes, data } = f
  const [lo, hi0] = percentile(data, low, high)
  const hi = hi0 > lo ? hi0 : lo + 1
  const curve = {
    linear: (t) => t,
    sqrt: (t) => Math.sqrt(t),
    log: (t) => Math.log(1 + 1000 * t) / Math.log(1001),
    asinh: (t) => Math.asinh(10 * t) / Math.asinh(10),
  }[stretch] || ((t) => t)
  const out = raster(w, h), d = out.data
  for (let y = 0; y < h; y++) {
    const sy = h - 1 - y // FITS stores the bottom row first
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      for (let c = 0; c < 3; c++) {
        const v = data[(planes === 3 ? c : 0) * w * h + sy * w + x]
        const t = Number.isFinite(v) ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0
        d[o + c] = Math.round(curve(t) * 255)
      }
      d[o + 3] = 255
    }
  }
  return out
}

// ---------------------------------------------------------------- Radiance HDR
/** Read a Radiance .hdr (RGBE) file. Returns { width, height, channels: 3, data: Float32Array RGB (linear), top row first }. */
export function parseHdr(b) {
  const head = ascii(b, 0, Math.min(11, b.length))
  if (!head.startsWith('#?RADIANCE') && !head.startsWith('#?RGBE')) fail('This is not a Radiance HDR (.hdr) file.')
  let p = 0, line = ''
  const readLine = () => { let s = ''; while (p < b.length && b[p] !== 10) s += String.fromCharCode(b[p++]); p++; return s }
  while (p < b.length) { line = readLine(); if (line === '') break }
  const res = readLine().trim().match(/^([-+])Y (\d+) ([-+])X (\d+)$/)
  if (!res) fail('This HDR file has an unsupported layout (only standard scanline order works).')
  const h = +res[2], w = +res[4], flipY = res[1] === '+', flipX = res[3] === '-'
  if (!(w > 0 && h > 0) || w * h > 268_000_000) fail('This HDR file has an unsupported size.')
  const rgbe = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    const row = y * w * 4
    if (w >= 8 && w < 32768 && b[p] === 2 && b[p + 1] === 2 && !(b[p + 2] & 128)) { // new-style RLE
      if (((b[p + 2] << 8) | b[p + 3]) !== w) fail('This HDR file is damaged.')
      p += 4
      for (let c = 0; c < 4; c++) {
        let x = 0
        while (x < w) {
          let n = b[p++]
          if (p > b.length) fail('This HDR file is cut off.')
          if (n > 128) { n -= 128; const v = b[p++]; for (let i = 0; i < n && x < w; i++) rgbe[row + x++ * 4 + c] = v }
          else for (let i = 0; i < n && x < w; i++) rgbe[row + x++ * 4 + c] = b[p++]
        }
      }
    } else { // flat pixels, with the old run-length escape
      let x = 0, shift = 0
      while (x < w) {
        if (p + 4 > b.length) fail('This HDR file is cut off.')
        const r = b[p], g = b[p + 1], bl = b[p + 2], e = b[p + 3]; p += 4
        if (r === 1 && g === 1 && bl === 1 && x > 0) { const n = e << shift; for (let i = 0; i < n && x < w; i++, x++) rgbe.copyWithin(row + x * 4, row + (x - 1) * 4, row + x * 4); shift += 8 }
        else { rgbe[row + x * 4] = r; rgbe[row + x * 4 + 1] = g; rgbe[row + x * 4 + 2] = bl; rgbe[row + x * 4 + 3] = e; x++; shift = 0 }
      }
    }
  }
  const data = new Float32Array(w * h * 3)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sy = flipY ? h - 1 - y : y, sx = flipX ? w - 1 - x : x
    const i = (sy * w + sx) * 4, o = (y * w + x) * 3, e = rgbe[i + 3]
    if (e) { const f = 2 ** (e - 136); data[o] = rgbe[i] * f; data[o + 1] = rgbe[i + 1] * f; data[o + 2] = rgbe[i + 2] * f }
  }
  return { width: w, height: h, channels: 3, data }
}

/** Linear float pixels (3 or 4 channels, top row first) to an sRGB 8-bit picture. opts: { exposure: EV stops, tonemap: 'reinhard'|'aces'|'clip' }. */
export function toneMap({ width: w, height: h, channels, data }, { exposure = 0, tonemap = 'reinhard' } = {}) {
  const out = raster(w, h), d = out.data, k = 2 ** exposure
  const srgb = (v) => { v = v <= 0 ? 0 : v >= 1 ? 1 : v; return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255) }
  const aces = (v) => (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14)
  for (let i = 0, o = 0; i < w * h; i++, o += 4) {
    let r = data[i * channels] * k, g = data[i * channels + 1] * k, bl = data[i * channels + 2] * k
    if (!Number.isFinite(r)) r = 0; if (!Number.isFinite(g)) g = 0; if (!Number.isFinite(bl)) bl = 0
    if (tonemap === 'reinhard') {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * bl
      if (l > 0) { const s = 1 / (1 + l); r *= s; g *= s; bl *= s }
    } else if (tonemap === 'aces') { r = aces(Math.max(0, r)); g = aces(Math.max(0, g)); bl = aces(Math.max(0, bl)) }
    d[o] = srgb(r); d[o + 1] = srgb(g); d[o + 2] = srgb(bl)
    d[o + 3] = channels === 4 ? Math.round(Math.min(1, Math.max(0, data[i * 4 + 3])) * 255) : 255
  }
  return out
}

// ---------------------------------------------------------------- DICOM
const TS = {
  '1.2.840.10008.1.2': 'Implicit VR Little Endian',
  '1.2.840.10008.1.2.1': 'Explicit VR Little Endian',
  '1.2.840.10008.1.2.1.99': 'Deflated Explicit VR Little Endian',
  '1.2.840.10008.1.2.2': 'Explicit VR Big Endian',
  '1.2.840.10008.1.2.5': 'RLE Lossless',
  '1.2.840.10008.1.2.4.50': 'JPEG Baseline',
  '1.2.840.10008.1.2.4.51': 'JPEG Extended',
  '1.2.840.10008.1.2.4.57': 'JPEG Lossless',
  '1.2.840.10008.1.2.4.70': 'JPEG Lossless (first-order prediction)',
  '1.2.840.10008.1.2.4.80': 'JPEG-LS Lossless',
  '1.2.840.10008.1.2.4.81': 'JPEG-LS Near-lossless',
  '1.2.840.10008.1.2.4.90': 'JPEG 2000 Lossless',
  '1.2.840.10008.1.2.4.91': 'JPEG 2000',
}
const KNOWN_VR = {
  0x00020010: 'UI', 0x00080060: 'CS', 0x00080020: 'DA', 0x0008103E: 'LO', 0x00081030: 'LO', 0x00100010: 'PN', 0x00100020: 'LO', 0x00180050: 'DS',
  0x00280002: 'US', 0x00280004: 'CS', 0x00280006: 'US', 0x00280008: 'IS', 0x00280010: 'US', 0x00280011: 'US', 0x00280030: 'DS', 0x00280100: 'US', 0x00280101: 'US', 0x00280102: 'US', 0x00280103: 'US',
  0x00281050: 'DS', 0x00281051: 'DS', 0x00281052: 'DS', 0x00281053: 'DS', 0x00200013: 'IS', 0x00080070: 'LO', 0x00080080: 'LO', 0x00081090: 'LO',
}
const LONG_VR = new Set(['OB', 'OW', 'OF', 'OD', 'OL', 'OV', 'SQ', 'UN', 'UC', 'UR', 'UT', 'SV', 'UV'])
const TAG = { TS: 0x00020010, MODALITY: 0x00080060, PHOTO: 0x00280004, SPP: 0x00280002, PLANAR: 0x00280006, FRAMES: 0x00280008, ROWS: 0x00280010, COLS: 0x00280011, ALLOC: 0x00280100, STORED: 0x00280101, REPR: 0x00280103, PIXEL: 0x7FE00010 }

/**
 * Parse a DICOM file. Returns { info, tags, frameCount, getFrame(i) }.
 * getFrame(i) is synchronous for uncompressed, RLE and lossless JPEG; for baseline JPEG and JPEG 2000 it returns { codec: 'jpeg' | 'j2k', bytes } to be decoded by the caller.
 */
export async function parseDicom(bytes) {
  let b = bytes, pos = 0
  let explicit = true, little = true
  if (b.length > 132 && ascii(b, 128, 4) === 'DICM') pos = 132
  else if (b.length < 8 || b[1] !== 0) fail('This is not a DICOM file.')
  else { explicit = false; pos = 0 } // some old files have no preamble
  const tags = {}
  let tsUid = '1.2.840.10008.1.2'
  let metaDone = pos === 0
  let frames = null, pixelOffset = -1, pixelLen = 0, encapsulated = false

  const rd16 = () => { const v = little ? b[pos] | (b[pos + 1] << 8) : (b[pos] << 8) | b[pos + 1]; pos += 2; return v }
  const rd32 = () => { const v = little ? (b[pos] | (b[pos + 1] << 8) | (b[pos + 2] << 16) | (b[pos + 3] << 24)) >>> 0 : be32(b, pos); pos += 4; return v }
  const readHeader = () => { // returns { tag, vr, len } or null at end
    if (pos + 8 > b.length) return null
    const g = rd16(), e = rd16(), tag = ((g << 16) | e) >>> 0
    if (g === 0xFFFE) return { tag, vr: null, len: rd32() }
    let vr = null, len
    const isMeta = g === 2
    if (explicit || isMeta) {
      vr = String.fromCharCode(b[pos], b[pos + 1]); pos += 2
      if (LONG_VR.has(vr)) { pos += 2; len = rd32() } else len = rd16()
    } else { vr = KNOWN_VR[tag] || null; len = rd32() }
    return { tag, vr, len }
  }
  const skipSeq = () => { // positioned just after an undefined-length SQ header
    for (;;) {
      if (pos + 8 > b.length) return
      const h = readHeader()
      if (!h) return
      if (h.tag === 0xFFFEE0DD) return
      if (h.tag === 0xFFFEE000) {
        if (h.len !== 0xFFFFFFFF) pos += h.len
        else skipItem()
      }
    }
  }
  const skipItem = () => {
    for (;;) {
      if (pos + 8 > b.length) return
      const h = readHeader()
      if (!h) return
      if (h.tag === 0xFFFEE00D) return
      if (h.len === 0xFFFFFFFF) skipSeq(); else pos += h.len
    }
  }
  const value = (tag, vr, start, len) => {
    const v = b.subarray(start, start + len)
    const dv = new DataView(b.buffer, b.byteOffset + start, len)
    const num = (size, fn) => { const a = []; for (let i = 0; i + size <= len; i += size) a.push(fn(i)); return a }
    if (vr === 'US') return num(2, (i) => dv.getUint16(i, little))
    if (vr === 'SS') return num(2, (i) => dv.getInt16(i, little))
    if (vr === 'UL') return num(4, (i) => dv.getUint32(i, little))
    if (vr === 'SL') return num(4, (i) => dv.getInt32(i, little))
    if (vr === 'FL') return num(4, (i) => dv.getFloat32(i, little))
    if (vr === 'FD') return num(8, (i) => dv.getFloat64(i, little))
    if (vr === 'OB' || vr === 'OW' || vr === 'UN' || vr === 'SQ') return v
    const s = new TextDecoder('latin1').decode(v).replace(/[\0 ]+$/, '').replace(/^ +/, '')
    if (vr === 'DS' || vr === 'IS') return s.split('\\').map(Number)
    return s
  }

  for (;;) {
    const at = pos
    const h = readHeader()
    if (!h) break
    if (!metaDone && (h.tag >>> 16) !== 2) { // end of file meta: switch syntax and read this element again
      pos = at
      metaDone = true
      tsUid = String(tags[TAG.TS] ?? tsUid).trim()
      if (tsUid === '1.2.840.10008.1.2') explicit = false
      else if (tsUid === '1.2.840.10008.1.2.2') { explicit = true; little = false }
      else explicit = true
      if (tsUid === '1.2.840.10008.1.2.1.99') b = concatBytes(b.subarray(0, pos), await inflate(b.subarray(pos), 'deflate-raw'))
      continue
    }
    if (h.tag === TAG.PIXEL) {
      pixelOffset = pos
      if (h.len === 0xFFFFFFFF) { // encapsulated fragments
        encapsulated = true
        frames = []
        let first = true, bot = []
        for (;;) {
          const it = readHeader()
          if (!it || it.tag === 0xFFFEE0DD) break
          if (it.tag !== 0xFFFEE000) break
          if (first) { first = false; for (let i = 0; i + 4 <= it.len; i += 4) bot.push(le32(b, pos + i)); pos += it.len; continue }
          frames.push(b.subarray(pos, pos + it.len)); pos += it.len
        }
        frames = { fragments: frames, bot }
      } else pixelLen = h.len
      break
    }
    if (h.len === 0xFFFFFFFF) { skipSeq(); continue }
    if (h.tag === 0xFFFEE000 || h.vr === 'SQ') { pos += h.len; continue }
    if (pos + h.len > b.length) break
    const tagV = (h.tag >>> 16) <= 0x0028 || KNOWN_VR[h.tag] ? true : false
    if (tagV && h.len < 65536) tags[h.tag] = value(h.tag, h.vr || KNOWN_VR[h.tag] || 'LO', pos, h.len)
    pos += h.len
  }
  if (pixelOffset < 0) fail('This DICOM file has no image in it (no pixel data).')
  tsUid = String(tags[TAG.TS] ?? tsUid).trim()
  const get = (t, d) => { const v = tags[t]; return Array.isArray(v) ? (v.length ? v[0] : d) : v ?? d }
  const rows = get(TAG.ROWS), cols = get(TAG.COLS), spp = get(TAG.SPP, 1), alloc = get(TAG.ALLOC, 16), stored = get(TAG.STORED, alloc)
  const signed = get(TAG.REPR, 0) === 1, planar = get(TAG.PLANAR, 0), photo = String(get(TAG.PHOTO, 'MONOCHROME2')).trim()
  const nFrames = Math.max(1, Math.round(get(TAG.FRAMES, 1)) || 1)
  if (!rows || !cols) fail('This DICOM file does not say how big its image is.')
  if (rows * cols > 100_000_000) fail('This DICOM image is too large.')
  if (/^PALETTE/.test(photo)) fail('This DICOM image uses a color palette lookup, which is not supported.')
  const rescale = [get(0x00281053, 1) || 1, get(0x00281052, 0) || 0]
  const wc = tags[0x00281050], ww = tags[0x00281051]
  const info = {
    width: cols, height: rows, frames: nFrames, samples: spp, bitsStored: stored, bitsAllocated: alloc, signed, photometric: photo,
    transferSyntax: TS[tsUid] || tsUid, modality: String(get(TAG.MODALITY, '') || ''),
    patientName: String(get(0x00100010, '') || '').replace(/\^/g, ' ').trim(), patientId: String(get(0x00100020, '') || ''),
    studyDate: String(get(0x00080020, '') || ''), studyDescription: String(get(0x00081030, '') || ''), seriesDescription: String(get(0x0008103E, '') || ''),
    pixelSpacing: Array.isArray(tags[0x00280030]) ? tags[0x00280030] : null,
    slope: rescale[0], intercept: rescale[1],
    windowCenter: Array.isArray(wc) && wc.length && Number.isFinite(wc[0]) ? wc[0] : null, windowWidth: Array.isArray(ww) && ww.length && Number.isFinite(ww[0]) ? ww[0] : null,
  }
  const frameBytes = alloc === 1 ? Math.ceil((rows * cols * spp) / 8) : rows * cols * spp * (alloc >> 3)
  const bytesPerSample = alloc >> 3

  function fragmentsFor(i) {
    const { fragments, bot } = frames
    if (nFrames === 1) return concatBytes(...fragments)
    if (bot.length === nFrames) {
      // offsets are from the first fragment item; walk items to map offsets to fragments
      let off = 0, start = 0; const starts = []
      fragments.forEach((f) => { starts.push(off); off += f.length + 8 })
      start = bot[i]; const end = i + 1 < nFrames ? bot[i + 1] : Infinity
      return concatBytes(...fragments.filter((_, k) => starts[k] >= start && starts[k] < end))
    }
    if (fragments.length === nFrames) return fragments[i]
    fail('This multi-frame DICOM file stores its frames in a way that is not supported.')
  }

  function getFrame(i) {
    if (i < 0 || i >= nFrames) fail('That frame does not exist.')
    const f = { width: cols, height: rows, samples: spp }
    if (!encapsulated) {
      const start = pixelOffset + (alloc === 1 ? Math.floor((i * rows * cols * spp) / 8) : i * frameBytes)
      if (start + frameBytes > b.length) fail('This DICOM file is cut off.')
      return { ...f, ...fromRaw(b.subarray(start, start + frameBytes)) }
    }
    const data = fragmentsFor(i)
    if (tsUid === '1.2.840.10008.1.2.5') return { ...f, ...fromRaw(unRle(data, rows * cols, spp, bytesPerSample), 1) }
    if (tsUid === '1.2.840.10008.1.2.4.50' || tsUid === '1.2.840.10008.1.2.4.51') return { ...f, codec: 'jpeg', bytes: data }
    if (tsUid === '1.2.840.10008.1.2.4.90' || tsUid === '1.2.840.10008.1.2.4.91') return { ...f, codec: 'j2k', bytes: data }
    if (tsUid === '1.2.840.10008.1.2.4.57' || tsUid === '1.2.840.10008.1.2.4.70') {
      const j = decodeJpegLossless(data)
      let pix = j.data
      if (signed) { const half = 2 ** (stored - 1), full = 2 ** stored; pix = Int32Array.from(pix, (v) => (v >= half ? v - full : v)) }
      return { ...f, samples: j.components, pix }
    }
    fail(`This DICOM file uses ${TS[tsUid] || tsUid} compression, which is not supported here. Uncompressed, RLE, JPEG baseline, JPEG lossless and JPEG 2000 work.`)
  }

  function fromRaw(raw, planarOverride) {
    const n = rows * cols * spp
    if (alloc === 1) { // packed bits, least significant bit first
      const bits = new Uint8Array(n)
      for (let k = 0; k < n; k++) bits[k] = (raw[k >> 3] >> (k & 7)) & 1
      return { pix: bits }
    }
    if (alloc === 8) {
      if (spp === 3) return { rgb: toInterleaved(raw, planarOverride ?? planar) }
      return { pix: signed ? Int8Array.from(raw, (v) => (v << 24) >> 24) : Uint8Array.from(raw) }
    }
    if (alloc !== 16 && alloc !== 32) fail(`This DICOM image uses ${alloc} bits per pixel, which is not supported.`)
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.length)
    const pix = alloc === 16 ? (signed ? new Int16Array(n) : new Uint16Array(n)) : (signed ? new Int32Array(n) : new Uint32Array(n))
    const mask = stored >= 32 ? 0xFFFFFFFF : (2 ** stored) - 1
    for (let k = 0; k < n; k++) {
      let v = alloc === 16 ? dv.getUint16(k * 2, little) : dv.getUint32(k * 4, little)
      if (signed) {
        if (stored < alloc) { v &= mask; if (v >= 2 ** (stored - 1)) v -= 2 ** stored } else if (alloc === 16) v = (v << 16) >> 16; else v |= 0
      } else if (stored < alloc) v &= mask
      pix[k] = v
    }
    return spp === 3 ? { pix, rgb16: true } : { pix }
  }
  function toInterleaved(raw, pl) {
    if (pl !== 1) return raw
    const n = rows * cols, out = new Uint8Array(n * 3)
    for (let k = 0; k < n; k++) { out[k * 3] = raw[k]; out[k * 3 + 1] = raw[n + k]; out[k * 3 + 2] = raw[2 * n + k] }
    return out
  }
  return { info, tags, frameCount: nFrames, getFrame, photometric: photo }
}
function le32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 } // basic offset table is little endian
function concatBytes(...parts) {
  let n = 0
  for (const p of parts) n += p.length
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

/** DICOM RLE (PackBits segments, one per byte plane, most significant byte first) to raw little-endian bytes. */
function unRle(data, pixels, spp, bps) {
  const dv = new DataView(data.buffer, data.byteOffset, data.length)
  const nseg = dv.getUint32(0, true)
  if (nseg !== spp * bps) fail('This RLE-compressed DICOM image has an unexpected layout.')
  const planes = []
  for (let s = 0; s < nseg; s++) {
    const start = dv.getUint32(4 + s * 4, true), end = s + 1 < nseg ? dv.getUint32(4 + (s + 1) * 4, true) : data.length
    const out = new Uint8Array(pixels)
    let p = start, o = 0
    while (p < end && o < pixels) {
      const n = (data[p++] << 24) >> 24
      if (n >= 0) { for (let k = 0; k <= n && o < pixels; k++) out[o++] = data[p++] }
      else if (n !== -128) { const v = data[p++]; for (let k = 0; k < 1 - n && o < pixels; k++) out[o++] = v }
    }
    planes.push(out)
  }
  // planes are ordered: for each sample, for each byte (MSB first). Interleave to little-endian samples; keep planar RGB as planar.
  const out = new Uint8Array(pixels * spp * bps)
  for (let c = 0; c < spp; c++) for (let k = 0; k < bps; k++) {
    const plane = planes[c * bps + k]
    for (let i = 0; i < pixels; i++) {
      // RGB 8-bit: keep planar layout (planar configuration is 1 for RLE); gray/16-bit: little-endian samples
      if (spp === 3 && bps === 1) out[c * pixels + i] = plane[i]
      else out[(i * spp + c) * bps + (bps - 1 - k)] = plane[i]
    }
  }
  return out
}

/** Frame to an 8-bit picture. opts: { center, width, invert }. Returns a raster. */
export function renderDicomFrame(frame, info, { center, width, invert = false } = {}) {
  const { width: w, height: h } = frame
  const out = raster(w, h), d = out.data
  if (frame.rgb) {
    const ybr = /^YBR_FULL/.test(info.photometric) && !frame.codec
    for (let i = 0; i < w * h; i++) {
      let r = frame.rgb[i * 3], g = frame.rgb[i * 3 + 1], b = frame.rgb[i * 3 + 2]
      if (ybr) { const Y = r, cb = g - 128, cr = b - 128; r = Y + 1.402 * cr; g = Y - 0.344136 * cb - 0.714136 * cr; b = Y + 1.772 * cb }
      d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255
    }
    return out
  }
  const pix = frame.pix, spp = frame.samples || 1
  if (spp === 3) { // 16-bit color: scale by the stored range
    const max = 2 ** (info.bitsStored || 16) - 1
    for (let i = 0; i < w * h; i++) { d[i * 4] = pix[i * 3] / max * 255; d[i * 4 + 1] = pix[i * 3 + 1] / max * 255; d[i * 4 + 2] = pix[i * 3 + 2] / max * 255; d[i * 4 + 3] = 255 }
    return out
  }
  const slope = info.slope || 1, icpt = info.intercept || 0
  let identity = false
  if (!(width > 0)) ({ center, width, identity } = autoWindow(frame, info))
  const lo = center - 0.5 - (width - 1) / 2, hi = center - 0.5 + (width - 1) / 2
  const mono1 = /MONOCHROME1/.test(info.photometric) !== invert
  for (let i = 0; i < w * h; i++) {
    const v = pix[i] * slope + icpt
    let t = v <= lo ? 0 : v > hi ? 1 : (v - (center - 0.5)) / (width - 1) + 0.5
    if (width <= 1) t = v >= center ? 1 : 0
    let g = identity ? Math.max(0, Math.min(255, pix[i])) : Math.round(t * 255)
    if (mono1) g = 255 - g
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g; d[i * 4 + 3] = 255
  }
  return out
}

/** Window from the file (center and width tags) or, when absent, the 0.5 to 99.5 percentile range of the pixel values. */
export function autoWindow(frame, info) {
  if (info.windowWidth > 0 && info.windowCenter !== null) return { center: info.windowCenter, width: info.windowWidth, fromFile: true }
  const slope = info.slope || 1, icpt = info.intercept || 0
  if (info.bitsStored <= 8 && !info.signed && slope === 1 && icpt === 0) return { center: 127.5, width: 256, fromFile: false, identity: true } // 8-bit pictures keep their values
  const [lo, hi] = percentile(frame.pix, 0.005, 0.995)
  const a = Math.min(lo * slope + icpt, hi * slope + icpt), bb = Math.max(lo * slope + icpt, hi * slope + icpt)
  return { center: (a + bb) / 2, width: Math.max(1, bb - a), fromFile: false }
}
/** Min and max of the rescaled pixel values, to size the window sliders. */
export function valueRange(frame, info) {
  let lo = Infinity, hi = -Infinity
  const pix = frame.pix
  for (let i = 0; i < pix.length; i++) { const v = pix[i]; if (v < lo) lo = v; if (v > hi) hi = v }
  const s = info.slope || 1, c = info.intercept || 0
  return [Math.min(lo * s + c, hi * s + c), Math.max(lo * s + c, hi * s + c)]
}

// ---------------------------------------------------------------- Lossless JPEG (ITU T.81 annex H), used by DICOM
/** Decode a lossless JPEG stream (SOF3). Returns { width, height, components, precision, data: Uint16Array interleaved }. */
export function decodeJpegLossless(b) {
  if (b[0] !== 0xFF || b[1] !== 0xD8) fail('The lossless JPEG data is damaged.')
  let p = 2, frame = null, ri = 0
  const tables = {}
  let scan = null
  while (p < b.length) {
    if (b[p] !== 0xFF) { p++; continue }
    const m = b[p + 1]
    if (m === 0xFF) { p++; continue }
    p += 2
    if (m === 0xD8 || (m >= 0xD0 && m <= 0xD7) || m === 0x01) continue
    if (m === 0xD9) break
    const len = (b[p] << 8) | b[p + 1], seg = b.subarray(p + 2, p + len)
    if (m === 0xC3) frame = { precision: seg[0], height: (seg[1] << 8) | seg[2], width: (seg[3] << 8) | seg[4], comps: Array.from({ length: seg[5] }, (_, i) => ({ id: seg[6 + i * 3], h: seg[7 + i * 3] >> 4, v: seg[7 + i * 3] & 15 })) }
    else if (m === 0xC0 || m === 0xC1 || m === 0xC2 || m === 0xC5 || m === 0xC6 || m === 0xC7 || m === 0xC9 || m === 0xCA || m === 0xCB) fail('This is not a lossless JPEG image.')
    else if (m === 0xC4) {
      let q = 0
      while (q < seg.length) {
        const tc = seg[q] >> 4, th = seg[q] & 15, counts = seg.subarray(q + 1, q + 17)
        let total = 0; for (const c of counts) total += c
        const vals = seg.subarray(q + 17, q + 17 + total)
        tables[(tc << 4) | th] = buildHuff(counts, vals)
        q += 17 + total
      }
    } else if (m === 0xDD) ri = (seg[0] << 8) | seg[1]
    else if (m === 0xDA) {
      const ns = seg[0], comps = []
      for (let i = 0; i < ns; i++) comps.push({ id: seg[1 + i * 2], table: seg[2 + i * 2] >> 4 })
      scan = { comps, predictor: seg[1 + ns * 2], pt: seg[3 + ns * 2] & 15, start: p + len }
      break
    }
    p += len
  }
  if (!frame || !scan) fail('The lossless JPEG data is damaged.')
  const { width: w, height: h, precision: P } = frame, nc = scan.comps.length
  const out = new Uint16Array(w * h * nc)
  // entropy-coded data with byte stuffing removed and restart markers noted
  let bitBuf = 0, bitCnt = 0, q = scan.start
  const fill = () => {
    while (bitCnt <= 24) {
      let v = 0
      if (q < b.length) {
        v = b[q++]
        if (v === 0xFF) { const n = b[q]; if (n === 0) q++; else { q--; v = 0; bitCnt += 8; bitBuf = (bitBuf << 8) >>> 0; continue } }
      }
      bitBuf = ((bitBuf << 8) | v) >>> 0; bitCnt += 8
    }
  }
  const bits = (n) => { if (n === 0) return 0; if (bitCnt < n) fill(); bitCnt -= n; return (bitBuf >>> bitCnt) & ((1 << n) - 1) }
  const huff = (t) => {
    let code = 0
    for (let l = 1; l <= 16; l++) {
      code = (code << 1) | bits(1)
      if (t.maxcode[l] >= 0 && code <= t.maxcode[l] && code >= t.mincode[l]) return t.vals[t.valptr[l] + code - t.mincode[l]]
    }
    fail('The lossless JPEG data is damaged.')
  }
  const tabs = scan.comps.map((c) => tables[c.table])
  if (tabs.some((t) => !t)) fail('The lossless JPEG data is damaged.')
  const init = 1 << (P - scan.pt - 1), mask = 0xFFFF
  let mcu = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (ri && mcu > 0 && mcu % ri === 0) { // restart: byte align and skip the marker
      bitCnt = 0; bitBuf = 0
      while (q < b.length - 1 && !(b[q] === 0xFF && b[q + 1] >= 0xD0 && b[q + 1] <= 0xD7)) q++
      q += 2
    }
    const firstAfterRestart = ri && mcu % ri === 0
    for (let c = 0; c < nc; c++) {
      const t = huff(tabs[c])
      let diff = t === 0 ? 0 : t === 16 ? 32768 : bits(t)
      if (t > 0 && t < 16 && diff < (1 << (t - 1))) diff -= (1 << t) - 1
      const idx = (y * w + x) * nc + c
      const ra = x > 0 ? out[idx - nc] : 0, rb = y > 0 ? out[idx - w * nc] : 0, rc = x > 0 && y > 0 ? out[idx - w * nc - nc] : 0
      let pred
      if ((y === 0 && x === 0) || firstAfterRestart) pred = init
      else if (y === 0) pred = ra
      else if (x === 0) pred = rb
      else pred = [0, ra, rb, rc, ra + rb - rc, ra + ((rb - rc) >> 1), rb + ((ra - rc) >> 1), (ra + rb) >> 1][scan.predictor]
      out[idx] = ((pred + diff) & mask) << scan.pt
    }
    mcu++
  }
  return { width: w, height: h, components: nc, precision: P, data: out }
}
function buildHuff(counts, vals) {
  const mincode = new Int32Array(17), maxcode = new Int32Array(17).fill(-1), valptr = new Int32Array(17)
  let code = 0, k = 0
  for (let l = 1; l <= 16; l++) {
    valptr[l] = k; mincode[l] = code
    code += counts[l - 1]; k += counts[l - 1]
    maxcode[l] = counts[l - 1] ? code - 1 : -1
    code <<= 1
  }
  return { mincode, maxcode, valptr, vals: Uint8Array.from(vals) }
}
