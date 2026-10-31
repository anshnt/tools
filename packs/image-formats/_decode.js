// Read any supported picture into rasters. decodeFile(file, opts) -> { kind, frames: [{ raster, delay?, label? }], note?, layers? }
import {
  raster, orient, decodeTga, decodePnm, decodePcx, decodeQoi, decodeDds, parseIco, decodeIcoDib, parseIcns, decodeIcnsLegacy, mngFirstFrame, ascii, be32,
} from './_codecs.js'
import { parseFits, renderFits, parseHdr, toneMap, parseDicom, renderDicomFrame } from './_sci.js'
import { decodeWithBrowser, fromCanvas, newCanvas } from './_raster.js'
import { upng, agPsd, gifuct, parseExr, jxlDecode, openjpeg } from './_libs.js'
import { RAW_EXTS, extractPreview, decodeWithLibRaw } from './_raw.js'
import { decodeXcf } from './_xcf.js'

export const extOf = (name = '') => (name.match(/\.([^.\/\\]+)$/)?.[1] || '').toLowerCase()

const EXT_KIND = {
  tif: 'tiff', tiff: 'tiff', tga: 'tga', icb: 'tga', vda: 'tga', vst: 'tga', ppm: 'pnm', pgm: 'pnm', pbm: 'pnm', pnm: 'pnm', pam: 'pnm', pcx: 'pcx', qoi: 'qoi', dds: 'dds',
  ico: 'ico', cur: 'ico', icns: 'icns', mng: 'mng', jxl: 'jxl', jp2: 'jp2', j2k: 'jp2', j2c: 'jp2', jpc: 'jp2', jpf: 'jp2', jpx: 'jp2', apng: 'png', png: 'png', gif: 'gif',
  psd: 'psd', psb: 'psd', xcf: 'xcf', heic: 'heic', heif: 'heic', hif: 'heic', dcm: 'dicom', dicom: 'dicom', dic: 'dicom', exr: 'exr', hdr: 'hdr', rgbe: 'hdr', fits: 'fits', fit: 'fits', fts: 'fits',
  jpg: 'browser', jpeg: 'browser', jfif: 'browser', jpe: 'browser', webp: 'browser', bmp: 'browser', dib: 'browser', avif: 'browser',
}
for (const e of RAW_EXTS) EXT_KIND[e] = 'raw'

const same = (b, sig, at = 0) => sig.every((v, i) => b[at + i] === v)
/** Magic-number tests, by file extension. Exported as SNIFF for the file converter hub. */
export const MAGIC = {
  tiff: (b) => same(b, [0x49, 0x49, 0x2A, 0]) || same(b, [0x4D, 0x4D, 0, 0x2A]),
  qoi: (b) => ascii(b, 0, 4) === 'qoif',
  dds: (b) => ascii(b, 0, 4) === 'DDS ',
  icns: (b) => ascii(b, 0, 4) === 'icns',
  psd: (b) => ascii(b, 0, 4) === '8BPS',
  jxl: (b) => same(b, [0xFF, 0x0A]) || (same(b, [0, 0, 0, 0x0C]) && ascii(b, 4, 4) === 'JXL '),
  jp2: (b) => same(b, [0, 0, 0, 0x0C, 0x6A, 0x50, 0x20, 0x20]) || same(b, [0xFF, 0x4F, 0xFF, 0x51]),
  fits: (b) => ascii(b, 0, 9) === 'SIMPLE  =',
  hdr: (b) => ascii(b, 0, 2) === '#?',
  exr: (b) => same(b, [0x76, 0x2F, 0x31, 0x01]),
  dcm: (b) => b.length > 132 && ascii(b, 128, 4) === 'DICM',
  mng: (b) => same(b, [0x8A, 0x4D, 0x4E, 0x47]),
  xcf: (b) => ascii(b, 0, 9) === 'gimp xcf ',
  pcx: (b) => b[0] === 0x0A && [0, 2, 3, 4, 5].includes(b[1]) && b[2] === 1,
}
const MAGIC_KIND = { tiff: 'tiff', qoi: 'qoi', dds: 'dds', icns: 'icns', psd: 'psd', jxl: 'jxl', jp2: 'jp2', fits: 'fits', hdr: 'hdr', exr: 'exr', dcm: 'dicom', mng: 'mng', xcf: 'xcf' }

function isApng(b) {
  if (!same(b, [0x89, 0x50, 0x4E, 0x47])) return false
  let p = 8
  while (p + 12 <= b.length) {
    const t = ascii(b, p + 4, 4)
    if (t === 'acTL') return true
    if (t === 'IDAT' || t === 'IEND') return false
    p += 12 + be32(b, p)
  }
  return false
}

export function detectKind(name, b) {
  const ext = extOf(name)
  let kind = EXT_KIND[ext]
  if (kind === 'browser' || kind === 'png') {
    if (kind === 'png' && isApng(b)) return 'apng'
    // a file saved with the wrong extension: trust clear magic numbers
    for (const [k, test] of Object.entries(MAGIC)) if (MAGIC_KIND[k] && test(b)) return MAGIC_KIND[k]
    return kind === 'png' ? 'browser' : kind
  }
  if (kind) return kind
  for (const [k, test] of Object.entries(MAGIC)) if (test(b)) return MAGIC_KIND[k] || k
  return null
}

const asU8c = (a) => (a instanceof Uint8ClampedArray ? a : new Uint8ClampedArray(a.buffer, a.byteOffset, a.length))
const frame1 = (r, extra = {}) => ({ frames: [{ raster: r }], ...extra })
/** A frame's pixels: decoded already, or loaded now (TIFF pages are decoded when they are needed). */
export const rasterOf = async (f) => f.raster || (f.raster = await f.load())
const abOf = (b) => (b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b.buffer : b.slice().buffer)
const tick = () => new Promise((r) => setTimeout(r, 0))

/** Formats this module can read (extensions). */
export const INPUT_EXTS = Object.keys(EXT_KIND)

export async function decodeFile(file, opts = {}, { signal } = {}) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const kind = detectKind(file.name, bytes)
  if (!kind) throw new Error('This file type is not supported.')
  const first = opts.pages === 'first'
  const res = await decodeBytes(kind, bytes, file, opts, signal)
  res.kind = kind
  if (first && res.frames.length > 1) res.frames = res.frames.slice(0, 1)
  for (const f of res.frames) {
    const r = f.raster
    if (r && (!(r.width > 0 && r.height > 0) || r.data.length !== r.width * r.height * 4)) throw new Error('The picture could not be decoded.')
  }
  return res
}

async function decodeBytes(kind, b, file, opts, signal) {
  switch (kind) {
    case 'browser': return frame1(await decodeWithBrowser(file))
    case 'tga': return frame1(decodeTga(b))
    case 'pnm': return frame1(decodePnm(b))
    case 'pcx': return frame1(decodePcx(b))
    case 'qoi': return frame1(decodeQoi(b))
    case 'dds': return frame1(decodeDds(b))
    case 'mng': return frame1(await decodeWithBrowser(new Blob([mngFirstFrame(b)], { type: 'image/png' })), { note: 'MNG: first frame only' })
    case 'heic': {
      const { heicToBlob } = await import('../../lib/image.js')
      return frame1(await decodeWithBrowser(await heicToBlob(file, 'image/png')))
    }
    case 'tiff': return decodeTiff(b, signal)
    case 'gif': return decodeGif(b, file)
    case 'apng': return decodeApng(b)
    case 'ico': return decodeIco(b)
    case 'icns': return decodeIcns(b)
    case 'psd': return decodePsd(b, opts)
    case 'jxl': return frame1(await decodeJxl(b))
    case 'jp2': return frame1(await decodeJp2(b))
    case 'raw': return decodeRawFile(b, opts)
    case 'dicom': return decodeDicomFile(b, opts, signal)
    case 'exr': return decodeExr(b, opts)
    case 'hdr': return frame1(toneMap(parseHdr(b), opts))
    case 'fits': return frame1(renderFits(parseFits(b), opts))
    case 'xcf': { const x = await decodeXcf(b); return frame1(x.raster, { note: x.note }) }
    default: throw new Error('This file type is not supported.')
  }
}

// ---- TIFF (decoded in a worker that is stopped if it hangs; pages are decoded one at a time, on request)
async function decodeTiff(b, signal) {
  const ab = b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b.buffer.slice(0) : b.slice().buffer
  let worker
  try { worker = new Worker(new URL('./_tiff-worker.js', import.meta.url), { type: 'module' }) } catch { throw new Error('Could not start the TIFF decoder.') }
  let nextId = 0
  const pending = new Map()
  const stop = () => { worker.terminate(); for (const p of pending.values()) p.reject(new Error('stopped')); pending.clear() }
  worker.onmessage = ({ data }) => { const p = pending.get(data.id); if (p) { pending.delete(data.id); clearTimeout(p.timer); p.resolve(data) } }
  worker.onerror = () => { for (const p of pending.values()) p.reject(new Error('Could not load the TIFF decoder. Check your connection and try again.')); pending.clear() }
  signal?.addEventListener('abort', stop, { once: true })
  const call = (msg, transfer, ms = 60000) => new Promise((resolve, reject) => {
    const id = nextId++
    const timer = setTimeout(() => { pending.delete(id); stop(); reject(new Error('This TIFF took too long to decode. It may be damaged or use an unsupported layout.')) }, ms)
    pending.set(id, { resolve, reject: (e) => { clearTimeout(timer); reject(signal?.aborted ? Object.assign(new Error('Cancelled'), { name: 'AbortError' }) : e) }, timer })
    worker.postMessage({ ...msg, id }, transfer)
  })
  let opened
  try { opened = await call({ op: 'open', buffer: ab, jpegByBrowser: true }, [ab]) } catch (e) { stop(); throw e }
  if (opened.error || !opened.pages?.length) { stop(); throw new Error(opened.error ? 'This TIFF file could not be read. It may be damaged or use an unsupported layout.' : 'This TIFF has no image in it.') }
  if (opened.pages.length > 2000) { stop(); throw new Error('This TIFF has too many pages (over 2000).') }
  const n = opened.pages.length
  const frames = opened.pages.map((p, i) => ({
    label: n > 1 ? `page-${String(i + 1).padStart(String(n).length, '0')}` : undefined,
    load: async () => {
      let r = null
      if (p.jpeg) r = await tiffJpeg(b, p.jpeg).catch(() => null)
      if (!r) {
        const d = await call({ op: 'page', index: i })
        if (d.error) throw new Error('This TIFF uses a compression or layout that could not be decoded.')
        r = { width: d.width, height: d.height, data: new Uint8ClampedArray(d.rgba) }
      }
      return orient(r, p.orientation)
    },
  }))
  return { frames, close: stop }
}

/** TIFF page whose strips or tiles are JPEG streams (compression 7): rebuild each stream with the shared tables and let the browser decode it. */
async function tiffJpeg(b, ifd) {
  const photo = ifd.t262?.[0], spp = ifd.t277?.[0] || 1
  if (spp !== 3 && spp !== 1) throw new Error('unsupported')
  const w = ifd.t256[0], h = ifd.t257[0]
  const tables = ifd.t347 ? Uint8Array.from(ifd.t347) : null
  const tiled = !!ifd.t324
  const offs = tiled ? ifd.t324 : ifd.t273, lens = tiled ? ifd.t325 : ifd.t279
  const tw = tiled ? ifd.t322[0] : w, th = tiled ? ifd.t323[0] : (ifd.t278?.[0] || h)
  const out = newCanvas(w, h), g = out.getContext('2d')
  const across = Math.ceil(w / tw)
  for (let i = 0; i < offs.length; i++) {
    let data = b.subarray(offs[i], offs[i] + lens[i])
    if (tables && data[0] === 0xFF && data[1] === 0xD8) { // abbreviated stream: SOI + tables (without their EOI) + the rest of the strip
      const t = tables.subarray(0, tables.length - 2)
      data = concatBytes([t, data.subarray(2)])
    }
    if (photo === 2 && spp === 3) data = withRgbMarker(data) // RGB-coded JPEG: stop the decoder from assuming YCbCr
    const bmp = await createImageBitmap(new Blob([data], { type: 'image/jpeg' }))
    const x = tiled ? (i % across) * tw : 0, y = tiled ? Math.floor(i / across) * th : i * th
    g.drawImage(bmp, x, y)
    bmp.close()
  }
  const r = fromCanvas(out)
  if (spp === 1) for (let i = 3; i < r.data.length; i += 4) r.data[i] = 255
  return r
}
function withRgbMarker(d) { // insert an APP14 colour-transform segment (transform 0 = RGB) right after SOI
  const seg = Uint8Array.from([0xFF, 0xEE, 0, 14, 0x41, 0x64, 0x6F, 0x62, 0x65, 0, 100, 0, 0, 0, 0, 0])
  return concatBytes([d.subarray(0, 2), seg, d.subarray(2)])
}
const concatBytes = (parts) => { const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let k = 0; for (const p of parts) { o.set(p, k); k += p.length } return o }

// ---- GIF (all frames composited onto the full canvas)
async function decodeGif(b, file) {
  let gif, frames
  try {
    const g = await gifuct()
    gif = g.parseGIF(abOf(b))
    frames = g.decompressFrames(gif, true)
  } catch { return frame1(await decodeWithBrowser(file)) }
  if (frames.length <= 1) return frame1(await decodeWithBrowser(file))
  const W = gif.lsd.width, H = gif.lsd.height
  let cur = new Uint8ClampedArray(W * H * 4)
  const out = []
  for (const f of frames) {
    const saved = f.disposalType === 3 ? new Uint8ClampedArray(cur) : null
    const { left, top, width, height } = f.dims
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4, dx = left + x, dy = top + y
      if (dx >= W || dy >= H || f.patch[s + 3] === 0) continue
      const d = (dy * W + dx) * 4
      cur[d] = f.patch[s]; cur[d + 1] = f.patch[s + 1]; cur[d + 2] = f.patch[s + 2]; cur[d + 3] = 255
    }
    out.push({ raster: { width: W, height: H, data: new Uint8ClampedArray(cur) }, delay: Math.max(20, f.delay || 100) })
    if (f.disposalType === 2) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const dx = left + x, dy = top + y; if (dx < W && dy < H) cur.fill(0, (dy * W + dx) * 4, (dy * W + dx) * 4 + 4) }
    else if (saved) cur = saved
  }
  return { frames: out }
}

// ---- animated PNG
async function decodeApng(b) {
  const UPNG = await upng()
  const img = UPNG.decode(abOf(b))
  const bufs = UPNG.toRGBA8(img)
  const frames = bufs.map((buf, i) => ({ raster: { width: img.width, height: img.height, data: new Uint8ClampedArray(buf) }, delay: Math.max(20, img.frames?.[i]?.delay || 100), label: bufs.length > 1 ? `frame-${i + 1}` : undefined }))
  return { frames }
}

// ---- ICO, CUR, ICNS
async function decodeIco(b) {
  const { entries } = parseIco(b)
  const frames = []
  for (const e of entries) {
    const r = e.png ? await decodeWithBrowser(new Blob([e.data], { type: 'image/png' })) : decodeIcoDib(e.data)
    frames.push({ raster: r, label: `${r.width}x${r.height}` })
  }
  frames.sort((a, c) => a.raster.width - c.raster.width)
  return { frames }
}
async function decodeIcns(b) {
  const entries = parseIcns(b)
  const frames = [], seen = new Set()
  const add = (r) => { const k = `${r.width}x${r.height}`; if (!seen.has(k)) { seen.add(k); frames.push({ raster: r, label: k }) } }
  for (const e of entries) {
    if (e.data[0] === 0x89 && e.data[1] === 0x50) add(await decodeWithBrowser(new Blob([e.data], { type: 'image/png' })))
    else if (same(e.data, [0, 0, 0, 0x0C, 0x6A, 0x50, 0x20, 0x20]) || same(e.data, [0xFF, 0x4F, 0xFF, 0x51])) { try { add(await decodeJp2(e.data)) } catch { /* skip */ } }
  }
  for (const l of decodeIcnsLegacy(entries)) add(l.raster)
  if (!frames.length) throw new Error('This ICNS file has no icon sizes that can be read.')
  frames.sort((a, c) => a.raster.width - c.raster.width)
  return { frames }
}

// ---- PSD
async function decodePsd(b, opts) {
  if (ascii(b, 0, 4) !== '8BPS') throw new Error('This is not a PSD file.')
  if (b[4] === 0 && b[5] === 2) throw new Error('This is a PSB (large document) file. Only regular PSD files up to 30,000 pixels can be read here.')
  const { readPsd } = await agPsd()
  let psd
  try { psd = readPsd(abOf(b), { useImageData: true, skipThumbnail: true, skipLayerImageData: !opts.layers }) } catch (e) { throw new Error(`This PSD file could not be read (${e.message || 'unsupported layout'}).`) }
  let r = psd.imageData ? { width: psd.width, height: psd.height, data: asU8c(psd.imageData.data) } : null
  let note
  const layers = []
  const walk = (list, path) => {
    for (const l of list || []) {
      if (l.children) walk(l.children, [...path, l.name])
      else if (l.imageData && l.imageData.width > 0) layers.push({ name: [...path, l.name || 'layer'].join(' - '), hidden: !!l.hidden, left: l.left, top: l.top, imageData: l.imageData })
    }
  }
  if (opts.layers) walk(psd.children, [])
  if (!r) { // no flattened preview saved in the file: stack the visible layers
    if (!layers.length) {
      const again = readPsd(abOf(b), { useImageData: true, skipThumbnail: true })
      walk(again.children, [])
    }
    r = raster(psd.width, psd.height)
    for (const l of layers) if (!l.hidden) blit(r, l)
    note = 'This PSD has no flattened preview, so it was built from its visible layers (blend modes ignored)'
  }
  return { frames: [{ raster: r }], note, layers: opts.layers ? layers.map((l) => ({ name: l.name, hidden: l.hidden, raster: layerRaster(l, psd.width, psd.height) })) : undefined }
}
function blit(dst, l) {
  const src = l.imageData
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    const dx = l.left + x, dy = l.top + y
    if (dx < 0 || dy < 0 || dx >= dst.width || dy >= dst.height) continue
    const s = (y * src.width + x) * 4, d = (dy * dst.width + dx) * 4, a = src.data[s + 3] / 255, da = dst.data[d + 3] / 255
    const oa = a + da * (1 - a)
    if (oa <= 0) continue
    for (let c = 0; c < 3; c++) dst.data[d + c] = (src.data[s + c] * a + dst.data[d + c] * da * (1 - a)) / oa
    dst.data[d + 3] = oa * 255
  }
}
function layerRaster(l, w, h) {
  const r = raster(w, h)
  blit(r, l)
  return r
}

// ---- JPEG XL, JPEG 2000
async function decodeJxl(b) {
  const decode = await jxlDecode()
  let img
  try { img = await decode(abOf(b)) } catch { throw new Error('This JPEG XL file could not be decoded. It may be damaged or use a feature this decoder lacks.') }
  return { width: img.width, height: img.height, data: asU8c(img.data) }
}
export async function decodeJp2(b) {
  const mod = await openjpeg()
  const dec = new mod.J2KDecoder()
  try {
    dec.getEncodedBuffer(b.length).set(b)
    dec.decode()
    return j2kToRaster(dec)
  } catch (e) {
    throw new Error('This JPEG 2000 file could not be decoded. Files with a transparency (alpha) channel or four channels are not supported; gray and RGB files work.')
  } finally { dec.delete?.() }
}
function j2kPixels(dec) {
  const fi = dec.getFrameInfo(), out = dec.getDecodedBuffer()
  const bps = fi.bitsPerSample, n = fi.width * fi.height * fi.componentCount
  const view = bps > 8 ? (fi.isSigned ? new Int16Array(out.buffer, out.byteOffset, n) : new Uint16Array(out.buffer, out.byteOffset, n)) : (fi.isSigned ? new Int8Array(out.buffer, out.byteOffset, n) : new Uint8Array(out.buffer, out.byteOffset, n))
  return { fi, pix: view.slice() }
}
function j2kToRaster(dec) {
  const { fi, pix } = j2kPixels(dec)
  const { width: w, height: h, componentCount: nc, bitsPerSample: bps, isSigned } = fi
  const r = raster(w, h), d = r.data
  const shift = bps > 8 ? bps - 8 : 0, off = isSigned ? 1 << (bps - 1) : 0
  const v = (i) => Math.max(0, Math.min(255, ((pix[i] + off) >> shift)))
  for (let i = 0, o = 0; i < w * h; i++, o += 4) {
    if (nc >= 3) { d[o] = v(i * nc); d[o + 1] = v(i * nc + 1); d[o + 2] = v(i * nc + 2); d[o + 3] = nc >= 4 ? v(i * nc + 3) : 255 }
    else { d[o] = d[o + 1] = d[o + 2] = v(i * nc); d[o + 3] = nc === 2 ? v(i * nc + 1) : 255 }
  }
  return r
}
/** Raw JPEG 2000 pixels for DICOM: { width, height, components, signed, bits, pix } */
async function decodeJ2kRaw(bytes) {
  const mod = await openjpeg()
  const dec = new mod.J2KDecoder()
  try {
    dec.getEncodedBuffer(bytes.length).set(bytes)
    dec.decode()
    const { fi, pix } = j2kPixels(dec)
    return { width: fi.width, height: fi.height, components: fi.componentCount, signed: fi.isSigned, bits: fi.bitsPerSample, pix }
  } finally { dec.delete?.() }
}

// ---- camera RAW
async function decodeRawFile(b, opts) {
  const mode = opts.rawMode || 'auto'
  let fullError = null
  if (mode !== 'preview') {
    try {
      const { raster: r } = await decodeWithLibRaw(b, { half: !!opts.rawHalf })
      return frame1(r, { note: 'Full RAW decode with camera white balance' })
    } catch (e) { fullError = e; if (mode === 'full') throw new Error(`This RAW file could not be decoded (${e?.message || 'unsupported camera'}).`) }
  }
  const prev = extractPreview(b)
  if (!prev) throw new Error(mode === 'preview' ? 'No embedded JPEG preview was found in this RAW file. Try the full decode instead.' : `This RAW file could not be decoded${fullError ? ` (${fullError.message})` : ''}, and no embedded preview was found.`)
  const r = await decodeWithBrowser(new Blob([prev.bytes], { type: 'image/jpeg' }))
  return frame1(r, { note: `Embedded JPEG preview (${prev.width} x ${prev.height}), not the full RAW data${fullError ? '; the full decoder could not open this file' : ''}` })
}

// ---- DICOM
/** Parse a DICOM file and give back frame accessors that decode JPEG and JPEG 2000 frames too. */
export async function openDicom(file) {
  const d = await parseDicom(new Uint8Array(await file.arrayBuffer()))
  const mono = !/RGB|YBR|ARGB|HSV|CMYK/.test(d.info.photometric)
  async function frameData(i) {
    const f = d.getFrame(i)
    if (f.codec === 'jpeg') {
      if (f.bytes.length > 12) for (let p = 2; p + 9 < f.bytes.length;) { // 12-bit JPEG cannot be shown by a browser
        if (f.bytes[p] !== 0xFF) break
        const m = f.bytes[p + 1]
        if (m === 0xC0 || m === 0xC1 || m === 0xC2) { if (f.bytes[p + 4] > 8) throw new Error('This DICOM image is a 12-bit JPEG, which browsers cannot decode. Uncompressed, RLE, JPEG lossless and JPEG 2000 images work.'); break }
        p += 2 + ((f.bytes[p + 2] << 8) | f.bytes[p + 3])
      }
      const r = await decodeWithBrowser(new Blob([f.bytes], { type: 'image/jpeg' }))
      if (r.width !== f.width || r.height !== f.height) throw new Error('This DICOM image size does not match its JPEG data.')
      if (mono) { const pix = new Uint8Array(r.width * r.height); for (let k = 0; k < pix.length; k++) pix[k] = r.data[k * 4]; return { width: f.width, height: f.height, samples: 1, pix } }
      const rgb = new Uint8Array(r.width * r.height * 3)
      for (let k = 0; k < r.width * r.height; k++) { rgb[k * 3] = r.data[k * 4]; rgb[k * 3 + 1] = r.data[k * 4 + 1]; rgb[k * 3 + 2] = r.data[k * 4 + 2] }
      return { width: f.width, height: f.height, samples: 3, rgb, codec: 'jpeg' }
    }
    if (f.codec === 'j2k') {
      const j = await decodeJ2kRaw(f.bytes)
      if (j.components >= 3) { const rgb = new Uint8Array(j.width * j.height * 3); for (let k = 0; k < j.width * j.height; k++) for (let c = 0; c < 3; c++) rgb[k * 3 + c] = j.pix[k * j.components + c] >> Math.max(0, j.bits - 8); return { width: j.width, height: j.height, samples: 3, rgb, codec: 'j2k' } }
      return { width: j.width, height: j.height, samples: 1, pix: j.pix }
    }
    return f
  }
  return { info: d.info, frameCount: d.frameCount, frameData, tags: d.tags }
}
async function decodeDicomFile(b, opts, signal) {
  const dc = await openDicom(new Blob([b]))
  const n = opts.pages === 'first' ? 1 : Math.min(dc.frameCount, 500)
  const frames = []
  for (let i = 0; i < n; i++) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' })
    const f = await dc.frameData(i)
    frames.push({ raster: renderDicomFrame(f, dc.info, { center: opts.windowCenter, width: opts.windowWidth }), label: n > 1 ? `frame-${String(i + 1).padStart(String(n).length, '0')}` : undefined })
    await tick()
  }
  return { frames, note: dc.info.modality ? `DICOM ${dc.info.modality}, ${dc.info.transferSyntax}` : `DICOM, ${dc.info.transferSyntax}` }
}

// ---- OpenEXR
async function decodeExr(b, opts) {
  const parse = await parseExr()
  let img
  try { img = parse(abOf(b), 1015) } catch (e) { throw new Error(`This EXR file could not be read (${e?.message || 'unsupported layout'}). Files saved with B44 or DWA compression are not supported; ZIP, PIZ, RLE, PXR24 and uncompressed files work.`) }
  const { width: w, height: h, data } = img
  // three.js style EXR data has the bottom row first
  const flipped = new Float32Array(w * h * 4)
  for (let y = 0; y < h; y++) flipped.set(data.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4)
  return frame1(toneMap({ width: w, height: h, channels: 4, data: flipped }, opts))
}

export { fromCanvas, newCanvas }
