// Byte-level image metadata helpers (no DOM): read DPI, ICC and format facts, set DPI losslessly and strip
// metadata from JPEG, PNG and WebP without re-encoding the pixels. Used by Image DPI, Image info and EXIF remover.

const u16 = (b, i) => (b[i] << 8) | b[i + 1]
const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
const le32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0
const ascii = (b, s, e) => String.fromCharCode(...b.subarray(s, e))
const startsWith = (b, i, text) => ascii(b, i, i + text.length) === text

export function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

let crcTable
export function crc32(bytes, crc = 0) {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0 }
  }
  let c = ~crc >>> 0
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8)
  return ~c >>> 0
}

/** Detect the container from magic bytes: jpeg, png, gif, webp, bmp, ico, tiff, avif, heic, svg or null. */
export function sniff(b) {
  if (b[0] === 0xFF && b[1] === 0xD8) return 'jpeg'
  if (b[0] === 0x89 && startsWith(b, 1, 'PNG')) return 'png'
  if (startsWith(b, 0, 'GIF8')) return 'gif'
  if (startsWith(b, 0, 'RIFF') && startsWith(b, 8, 'WEBP')) return 'webp'
  if (b[0] === 0x42 && b[1] === 0x4D) return 'bmp'
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'ico'
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2A) || (b[0] === 0x4D && b[1] === 0x4D && b[3] === 0x2A)) return 'tiff'
  if (startsWith(b, 4, 'ftyp')) {
    const brand = ascii(b, 8, 12)
    if (/^avi[fs]$/.test(brand)) return 'avif'
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return 'heic'
  }
  const head = ascii(b, 0, Math.min(b.length, 400)).trimStart().toLowerCase()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg'
  return null
}

// ---------- JPEG ----------
/** Walk the JPEG segment list. Each seg: {m: marker byte, s: start (the FF), e: end (exclusive)}. SOS segments include their scan data. */
export function jpegParse(b) {
  if (b[0] !== 0xFF || b[1] !== 0xD8) throw new Error('This is not a valid JPEG file.')
  const segs = [{ m: 0xD8, s: 0, e: 2 }]
  let i = 2
  while (i + 1 < b.length) {
    if (b[i] !== 0xFF) { i++; continue }
    const m = b[i + 1]
    if (m === 0xFF) { i++; continue }
    if (m === 0xD9) { segs.push({ m, s: i, e: i + 2 }); return { segs, end: i + 2 } }
    if (m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { segs.push({ m, s: i, e: i + 2 }); i += 2; continue }
    const len = u16(b, i + 2)
    if (m === 0xDA) {
      let j = i + 2 + len
      while (j < b.length) {
        if (b[j] === 0xFF) {
          const n = b[j + 1]
          if (n === 0x00 || (n >= 0xD0 && n <= 0xD7)) { j += 2; continue }
          if (n === 0xFF) { j++; continue }
          break
        }
        j++
      }
      segs.push({ m, s: i, e: Math.min(j, b.length) })
      i = j
      continue
    }
    segs.push({ m, s: i, e: Math.min(i + 2 + len, b.length) })
    i += 2 + len
  }
  return { segs, end: b.length }
}

const segKind = (b, seg) => {
  const d = seg.s + 4
  if (seg.m === 0xE0) return startsWith(b, d, 'JFIF\0') ? 'jfif' : startsWith(b, d, 'JFXX') ? 'jfxx' : 'app0'
  if (seg.m === 0xE1) return startsWith(b, d, 'Exif\0') ? 'exif' : startsWith(b, d, 'http://ns.adobe.com/xap/1.0/') ? 'xmp' : startsWith(b, d, 'http://ns.adobe.com/xmp/extension/') ? 'xmp' : 'app1'
  if (seg.m === 0xE2) return startsWith(b, d, 'ICC_PROFILE\0') ? 'icc' : startsWith(b, d, 'MPF\0') ? 'mpf' : 'app2'
  if (seg.m === 0xED) return 'iptc'
  if (seg.m === 0xEE) return startsWith(b, d, 'Adobe') ? 'adobe' : 'app14'
  if (seg.m === 0xFE) return 'comment'
  if (seg.m >= 0xE0 && seg.m <= 0xEF) return 'app'
  return 'core'
}

/** Read the TIFF structure inside an Exif block. tiff = offset of the TIFF header in b. Returns IFD0 tags {tag: {type, count, valueOffset(abs), value}}. */
function exifIfd0(b, tiff) {
  const le = b[tiff] === 0x49
  const r16 = (i) => (le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1])
  const r32 = (i) => (le ? le32(b, i) : u32(b, i))
  if (!(le || b[tiff] === 0x4D) || r16(tiff + 2) !== 42) return null
  const ifd = tiff + r32(tiff + 4)
  if (ifd + 2 > b.length) return null
  const n = r16(ifd)
  const tags = {}
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12
    if (e + 12 > b.length) break
    const type = r16(e + 2), count = r32(e + 4)
    const size = ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 }[type] || 1) * count
    tags[r16(e)] = { type, count, at: size > 4 ? tiff + r32(e + 8) : e + 8, r16, r32, le }
  }
  return tags
}

/** EXIF orientation (1-8) or 1 when absent. */
export function jpegOrientation(b) {
  const { segs } = jpegParse(b)
  for (const s of segs) if (s.m === 0xE1 && segKind(b, s) === 'exif') {
    const tags = exifIfd0(b, s.s + 10)
    const o = tags?.[0x0112]
    if (o) return o.r16(o.at) || 1
  }
  return 1
}

/** Smallest valid Exif block that carries only the orientation tag (so rotated photos still display upright). */
export function minimalExif(orientation) {
  const body = new Uint8Array([
    0x45, 0x78, 0x69, 0x66, 0, 0, // Exif\0\0
    0x4D, 0x4D, 0x00, 0x2A, 0, 0, 0, 8, // TIFF header, big-endian, IFD0 at 8
    0, 1, // one entry
    0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, // Orientation SHORT
    0, 0, 0, 0, // no next IFD
  ])
  return concat(new Uint8Array([0xFF, 0xE1, 0, body.length + 2]), body)
}

/** Resolution info from JPEG: {x, y, unit: 'inch'|'cm'|null, dpi: [x, y]|null, source: 'jfif'|'exif'|null}. */
export function jpegDensity(b) {
  const { segs } = jpegParse(b)
  let jfif = null, exif = null
  for (const s of segs) {
    const k = segKind(b, s)
    if (k === 'jfif' && !jfif) {
      const d = s.s + 4, units = b[d + 7], x = u16(b, d + 8), y = u16(b, d + 10)
      jfif = { units, x, y }
    }
    if (k === 'exif' && !exif) {
      const t = exifIfd0(b, s.s + 10)
      const xr = t?.[0x011A], yr = t?.[0x011B], ru = t?.[0x0128]
      if (xr && yr && xr.type === 5) {
        const rat = (e) => { const d = e.r32(e.at + 4); return d ? e.r32(e.at) / d : 0 }
        exif = { x: rat(xr), y: rat(yr), unit: ru ? ru.r16(ru.at) : 2 }
      }
    }
  }
  if (jfif && jfif.units === 1) return { dpi: [jfif.x, jfif.y], source: 'jfif', aspectOnly: false, jfif, exif }
  if (jfif && jfif.units === 2) return { dpi: [Math.round(jfif.x * 2.54), Math.round(jfif.y * 2.54)], source: 'jfif', aspectOnly: false, jfif, exif }
  if (exif && exif.x > 0) return { dpi: exif.unit === 3 ? [Math.round(exif.x * 2.54), Math.round(exif.y * 2.54)] : [Math.round(exif.x), Math.round(exif.y)], source: 'exif', aspectOnly: false, jfif, exif }
  return { dpi: null, source: null, aspectOnly: !!jfif, jfif, exif }
}

/** Overwrite XResolution/YResolution/ResolutionUnit in place when the Exif block already has them. */
function patchExifDpi(b, tiff, dpi) {
  const t = exifIfd0(b, tiff)
  if (!t) return false
  const xr = t[0x011A], yr = t[0x011B], ru = t[0x0128]
  if (!xr || !yr || xr.type !== 5 || yr.type !== 5) return false
  const put32 = (e, at, v) => {
    if (e.le) { b[at] = v & 255; b[at + 1] = (v >>> 8) & 255; b[at + 2] = (v >>> 16) & 255; b[at + 3] = (v >>> 24) & 255 }
    else { b[at] = (v >>> 24) & 255; b[at + 1] = (v >>> 16) & 255; b[at + 2] = (v >>> 8) & 255; b[at + 3] = v & 255 }
  }
  for (const e of [xr, yr]) { put32(e, e.at, dpi); put32(e, e.at + 4, 1) }
  if (ru) { if (ru.le) { b[ru.at] = 2; b[ru.at + 1] = 0 } else { b[ru.at] = 0; b[ru.at + 1] = 2 } }
  return true
}

/** Set the DPI of a JPEG without touching the compressed image data: JFIF density, plus Exif resolution tags when present. */
export function setJpegDpi(bytes, dpi) {
  dpi = Math.max(1, Math.min(65535, Math.round(dpi)))
  const out = bytes.slice()
  const { segs } = jpegParse(out)
  for (const s of segs) if (s.m === 0xE1 && segKind(out, s) === 'exif') patchExifDpi(out, s.s + 10, dpi)
  const app0 = segs.find((s) => s.m === 0xE0 && segKind(out, s) === 'jfif')
  if (app0) {
    const d = app0.s + 4
    out[d + 7] = 1
    out[d + 8] = dpi >> 8; out[d + 9] = dpi & 255; out[d + 10] = dpi >> 8; out[d + 11] = dpi & 255
    return out
  }
  const jfif = new Uint8Array([0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 1, dpi >> 8, dpi & 255, dpi >> 8, dpi & 255, 0, 0])
  return concat(out.subarray(0, 2), jfif, out.subarray(2))
}

/**
 * Remove every metadata segment from a JPEG and leave the compressed image data byte-for-byte identical.
 * opts.keepIcc keeps the color profile; opts.keepOrientation writes back a tiny Exif block with only the orientation.
 * Returns {bytes, removed: [labels], removedBytes}.
 */
export function stripJpeg(bytes, { keepIcc = true, keepOrientation = true } = {}) {
  const { segs, end } = jpegParse(bytes)
  if (!segs.some((s) => s.m === 0xDA) || !segs.some((s) => s.m >= 0xC0 && s.m <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(s.m))) throw new Error('This JPEG looks damaged, so it was left alone.')
  const orientation = keepOrientation ? jpegOrientation(bytes) : 1
  const parts = []
  const removed = new Set()
  let removedBytes = 0
  let insertedExif = false
  const addExif = () => { if (!insertedExif && orientation > 1) { parts.push(minimalExif(orientation)); insertedExif = true } }
  const drop = (seg, label) => { removed.add(label); removedBytes += seg.e - seg.s }
  for (const seg of segs) {
    const kind = segKind(bytes, seg)
    if (kind === 'core') {
      if (seg.m !== 0xD8 && seg.m !== 0xE0) addExif()
      parts.push(bytes.subarray(seg.s, seg.e))
      if (seg.m === 0xD8) continue
    } else if (kind === 'jfif') {
      const d = seg.s + 4
      const thumb = bytes[d + 12] || bytes[d + 13]
      if (thumb) removed.add('Thumbnail')
      const j = bytes.slice(seg.s, seg.s + 20)
      j[2] = 0; j[3] = 16; j[d + 12 - seg.s] = 0; j[d + 13 - seg.s] = 0
      parts.push(j.subarray(0, 18))
      removedBytes += seg.e - seg.s - 18
      addExif()
    } else if (kind === 'icc' && keepIcc) parts.push(bytes.subarray(seg.s, seg.e))
    else if (kind === 'adobe') parts.push(bytes.subarray(seg.s, seg.e))
    else if (kind === 'exif') drop(seg, 'EXIF')
    else if (kind === 'xmp') drop(seg, 'XMP')
    else if (kind === 'iptc') drop(seg, 'IPTC')
    else if (kind === 'comment') drop(seg, 'Comment')
    else if (kind === 'icc') drop(seg, 'Color profile')
    else if (kind === 'mpf') drop(seg, 'Multi-picture data')
    else drop(seg, 'Other metadata')
  }
  const trailing = bytes.length - end
  if (trailing > 0) { removed.add('Trailing data'); removedBytes += trailing }
  // An EOI is always the last part when present; if the file had no EOI keep what we have.
  const outBytes = concat(...parts)
  return { bytes: outBytes, removed: [...removed], removedBytes: Math.max(0, bytes.length - outBytes.length) }
}

/** Add filler bytes to a JPEG as comment segments (used to reach a minimum file size without touching pixels). */
export function padJpeg(bytes, extra) {
  if (extra <= 0) return bytes
  const { segs } = jpegParse(bytes)
  const at = segs.find((s) => s.m === 0xDA)?.s ?? bytes.length
  const parts = [bytes.subarray(0, at)]
  for (let left = extra; left > 0;) {
    const total = Math.max(4, Math.min(left, 65537))
    const seg = new Uint8Array(total)
    seg[0] = 0xFF; seg[1] = 0xFE; seg[2] = (total - 2) >> 8; seg[3] = (total - 2) & 255
    seg.fill(0x20, 4)
    parts.push(seg)
    left -= total
  }
  parts.push(bytes.subarray(at))
  return concat(...parts)
}

// ---------- PNG ----------
export const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
export function pngChunk(type, data = new Uint8Array(0)) {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}
/** [{type, s, e, data: [ds, de]}] for every chunk. */
export function pngChunks(b) {
  if (b[0] !== 0x89 || !startsWith(b, 1, 'PNG')) throw new Error('This is not a valid PNG file.')
  const list = []
  let i = 8
  while (i + 8 <= b.length) {
    const len = u32(b, i)
    const type = ascii(b, i + 4, i + 8)
    const e = Math.min(i + 12 + len, b.length)
    list.push({ type, s: i, e, data: [i + 8, i + 8 + len] })
    i += 12 + len
    if (type === 'IEND') break
  }
  return list
}

export function pngDensity(b) {
  const c = pngChunks(b).find((x) => x.type === 'pHYs')
  if (!c) return { dpi: null, source: null }
  const x = u32(b, c.data[0]), y = u32(b, c.data[0] + 4), unit = b[c.data[0] + 8]
  if (unit !== 1) return { dpi: null, source: 'pHYs', aspectOnly: true }
  return { dpi: [Math.round(x * 0.0254), Math.round(y * 0.0254)], source: 'pHYs', ppm: [x, y] }
}

/** Set the DPI of a PNG by writing a pHYs chunk (pixels per metre) before the image data. */
export function setPngDpi(bytes, dpi) {
  const ppm = Math.round(dpi / 0.0254)
  const data = new Uint8Array(9)
  const dv = new DataView(data.buffer)
  dv.setUint32(0, ppm); dv.setUint32(4, ppm); data[8] = 1
  const chunks = pngChunks(bytes).filter((c) => c.type !== 'pHYs')
  const parts = [PNG_SIG]
  let placed = false
  for (const c of chunks) {
    if (!placed && c.type !== 'IHDR') { parts.push(pngChunk('pHYs', data)); placed = true }
    parts.push(bytes.subarray(c.s, c.e))
  }
  return concat(...parts)
}

const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME', 'dSIG'])
/** Drop text, EXIF and timestamp chunks from a PNG. Pixels are untouched. */
export function stripPng(bytes, { keepIcc = true } = {}) {
  const chunks = pngChunks(bytes)
  if (chunks[0]?.type !== 'IHDR' || !chunks.some((c) => c.type === 'IDAT')) throw new Error('This PNG looks damaged, so it was left alone.')
  const parts = [PNG_SIG]
  const removed = new Set()
  let removedBytes = 0
  const label = { tEXt: 'Text', zTXt: 'Text', iTXt: 'Text', eXIf: 'EXIF', tIME: 'Timestamp', dSIG: 'Signature', iCCP: 'Color profile' }
  for (const c of chunks) {
    const drop = PNG_DROP.has(c.type) || (c.type === 'iCCP' && !keepIcc)
    if (drop) { removed.add(label[c.type]); removedBytes += c.e - c.s } else parts.push(bytes.subarray(c.s, c.e))
  }
  return { bytes: concat(...parts), removed: [...removed], removedBytes }
}

/** Read PNG text chunks as [{key, value}] (tEXt and uncompressed iTXt; zTXt is listed without a value). */
export function pngTexts(b) {
  const dec = new TextDecoder('utf-8')
  const out = []
  for (const c of pngChunks(b)) {
    const d = b.subarray(c.data[0], c.data[1])
    if (c.type === 'tEXt') { const z = d.indexOf(0); out.push({ key: dec.decode(d.subarray(0, z)), value: dec.decode(d.subarray(z + 1)) }) }
    else if (c.type === 'iTXt') {
      const z = d.indexOf(0)
      const compressed = d[z + 1]
      if (!compressed) {
        let p = z + 3
        p = d.indexOf(0, p) + 1
        p = d.indexOf(0, p) + 1
        out.push({ key: dec.decode(d.subarray(0, z)), value: dec.decode(d.subarray(p)) })
      } else out.push({ key: dec.decode(d.subarray(0, z)), value: '(compressed)' })
    } else if (c.type === 'zTXt') out.push({ key: dec.decode(d.subarray(0, d.indexOf(0))), value: '(compressed)' })
  }
  return out
}

/** Add filler bytes to a PNG as one tEXt chunk (used to reach a minimum file size without touching pixels). */
export function padPng(bytes, extra) {
  if (extra <= 0) return bytes
  const iend = pngChunks(bytes).find((c) => c.type === 'IEND')
  const at = iend ? iend.s : bytes.length
  const data = new Uint8Array(Math.max(2, extra - 12))
  data[0] = 0x66
  data.fill(0x20, 2)
  return concat(bytes.subarray(0, at), pngChunk('tEXt', data), bytes.subarray(at))
}

export function pngInfo(b) {
  const chunks = pngChunks(b)
  const ihdr = chunks.find((c) => c.type === 'IHDR')
  const d = ihdr.data[0]
  const colorType = b[d + 9]
  const types = new Set(chunks.map((c) => c.type))
  return {
    width: u32(b, d), height: u32(b, d + 4), bitDepth: b[d + 8], colorType, interlaced: b[d + 12] === 1,
    color: { 0: 'Grayscale', 2: 'RGB', 3: 'Indexed (palette)', 4: 'Grayscale + alpha', 6: 'RGBA' }[colorType] || 'Unknown',
    alpha: colorType === 4 || colorType === 6 || types.has('tRNS'),
    icc: types.has('iCCP'), srgb: types.has('sRGB'), animated: types.has('acTL'),
    hasText: ['tEXt', 'zTXt', 'iTXt'].some((t) => types.has(t)), hasExif: types.has('eXIf'),
  }
}

// ---------- WebP ----------
/** [{id, s, e, data: [ds, de]}] RIFF chunks of a WebP file. */
export function webpChunks(b) {
  const list = []
  let i = 12
  while (i + 8 <= b.length) {
    const len = le32(b, i + 4)
    const e = Math.min(i + 8 + len + (len & 1), b.length)
    list.push({ id: ascii(b, i, i + 4), s: i, e, data: [i + 8, i + 8 + len] })
    i += 8 + len + (len & 1)
  }
  return list
}
export function webpInfo(b) {
  const chunks = webpChunks(b)
  const ids = new Set(chunks.map((c) => c.id))
  const vp8x = chunks.find((c) => c.id === 'VP8X')
  const flags = vp8x ? b[vp8x.data[0]] : 0
  return { icc: ids.has('ICCP'), exif: ids.has('EXIF'), xmp: ids.has('XMP '), animated: !!(flags & 2), alpha: !!(flags & 0x10) || ids.has('ALPH'), lossless: ids.has('VP8L') }
}
export function stripWebp(bytes, { keepIcc = true } = {}) {
  const chunks = webpChunks(bytes)
  const removed = new Set()
  const parts = []
  for (const c of chunks) {
    if (c.id === 'EXIF') { removed.add('EXIF'); continue }
    if (c.id === 'XMP ') { removed.add('XMP'); continue }
    if (c.id === 'ICCP' && !keepIcc) { removed.add('Color profile'); continue }
    let chunk = bytes.slice(c.s, c.e)
    if (c.id === 'VP8X') { chunk[8] &= ~0x0C; if (!keepIcc) chunk[8] &= ~0x20 }
    parts.push(chunk)
  }
  const body = concat(...parts)
  const head = new Uint8Array(12)
  head.set(bytes.subarray(0, 12))
  new DataView(head.buffer).setUint32(4, body.length + 4, true)
  const out = concat(head, body)
  return { bytes: out, removed: [...removed], removedBytes: bytes.length - out.length }
}

// ---------- GIF / BMP ----------
export function gifInfo(b) {
  const width = b[6] | (b[7] << 8), height = b[8] | (b[9] << 8)
  let i = 13
  if (b[10] & 0x80) i += 3 * (1 << ((b[10] & 7) + 1))
  let frames = 0, transparent = false
  while (i < b.length) {
    const t = b[i]
    if (t === 0x3B) break
    if (t === 0x21) {
      if (b[i + 1] === 0xF9 && b[i + 3] & 1) transparent = true
      i += 2
      while (b[i]) i += b[i] + 1
      i++
    } else if (t === 0x2C) {
      frames++
      const flags = b[i + 9]
      i += 10
      if (flags & 0x80) i += 3 * (1 << ((flags & 7) + 1))
      i++
      while (b[i]) i += b[i] + 1
      i++
    } else break
  }
  return { width, height, frames, transparent }
}
export function bmpInfo(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const xppm = dv.getInt32(38, true), yppm = dv.getInt32(42, true)
  return { bitDepth: dv.getUint16(28, true), dpi: xppm > 0 ? [Math.round(xppm * 0.0254), Math.round(yppm * 0.0254)] : null }
}

// ---------- JPEG facts ----------
export function jpegInfo(b) {
  const { segs } = jpegParse(b)
  const kinds = segs.map((s) => segKind(b, s))
  const sof = segs.find((s) => s.m >= 0xC0 && s.m <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(s.m))
  const info = { progressive: false, bitDepth: 8, components: 0, icc: kinds.includes('icc'), exif: kinds.includes('exif'), xmp: kinds.includes('xmp'), iptc: kinds.includes('iptc'), comment: kinds.includes('comment') }
  if (sof) {
    const d = sof.s + 4
    info.progressive = [0xC2, 0xC6, 0xCA, 0xCE].includes(sof.m)
    info.bitDepth = b[d]
    info.components = b[d + 5]
    if (info.components === 3) {
      const h = b[d + 7] >> 4, v = b[d + 7] & 15
      info.subsampling = h === 2 && v === 2 ? '4:2:0' : h === 2 && v === 1 ? '4:2:2' : h === 1 && v === 1 ? '4:4:4' : `${h}x${v}`
    }
  }
  return info
}

/** DPI for any supported container: {dpi: [x, y]|null, source}. */
export function readDensity(b) {
  const kind = sniff(b)
  try {
    if (kind === 'jpeg') { const d = jpegDensity(b); return { dpi: d.dpi, source: d.source } }
    if (kind === 'png') return pngDensity(b)
    if (kind === 'bmp') { const d = bmpInfo(b); return { dpi: d.dpi, source: 'BMP header' } }
  } catch { /* corrupt metadata: report as unknown */ }
  return { dpi: null, source: null }
}
