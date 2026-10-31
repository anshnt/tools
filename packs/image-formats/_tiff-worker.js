// Runs the TIFF decoder in a worker so a big or damaged file cannot freeze the page (the page stops this worker if it takes too long).
// UTIF (MIT) does the decoding. Its LZW routine has no end check and can loop forever on some files, so it is replaced by a bounded one.
// Pages are decoded one at a time on request, so a long scan never has to sit in memory all at once.
import UTIF0 from 'https://cdn.jsdelivr.net/npm/utif@3.1.0/+esm'

const UTIF = UTIF0.default || UTIF0

/** TIFF LZW (most significant bit first, early code width change), bounded by the size of the target. */
UTIF.decode._decodeLZW = function (data, off, tgt, toff) {
  const prefix = new Int32Array(4096), suffix = new Uint8Array(4096), len = new Int32Array(4096), first = new Uint8Array(4096)
  for (let i = 0; i < 256; i++) { len[i] = 1; first[i] = i; suffix[i] = i }
  let bits = 9, next = 258, old = -1, pos = off * 8
  const end = data.length * 8
  const put = (code) => {
    const l = len[code]
    if (toff + l > tgt.length) return false
    let p = toff + l, c = code
    while (c >= 258) { tgt[--p] = suffix[c]; c = prefix[c] }
    tgt[--p] = c
    toff += l
    return true
  }
  while (pos + bits <= end && toff < tgt.length) {
    let code = 0
    for (let k = 0; k < bits; k++, pos++) code = (code << 1) | ((data[pos >> 3] >> (7 - (pos & 7))) & 1)
    if (code === 257) break
    if (code === 256) { bits = 9; next = 258; old = -1; continue }
    if (old === -1) { if (code > 255 || !put(code)) break; old = code; continue }
    if (code > next || next >= 4096 && code >= 4096) break
    if (code < next) {
      if (!put(code)) break
      if (next < 4096) { prefix[next] = old; suffix[next] = first[code]; len[next] = len[old] + 1; first[next] = first[old]; next++ }
    } else { // the code about to be defined: previous string plus its own first character
      prefix[next] = old; suffix[next] = first[old]; len[next] = len[old] + 1; first[next] = first[old]; next++
      if (!put(next - 1)) break
    }
    if (next + 1 >= (1 << bits) && bits < 12) bits++
    old = code
  }
}

// UTIF applies the predictor with the size of the whole image. For tiles it must use the size of one tile.
const decompress = UTIF.decode._decompress
UTIF.decode._decompress = function (img, ifds, data, off, len, cmpr, tgt, toff, fo) {
  if (img.t322 && img.t317 && img.t317[0] === 2) {
    const tile = Object.create(img)
    tile.width = img.t322[0]; tile.t278 = [img.t323[0]]
    return decompress.call(this, tile, ifds, data, off, len, cmpr, tgt, toff, fo)
  }
  return decompress.apply(this, arguments)
}

/** Planar (separate colour planes) pages: decode each plane on its own, then interleave them the way UTIF expects. */
function decodePlanar(ifd) {
  const spp = ifd.t277[0], tiled = !!ifd.t322
  const offs = tiled ? ifd.t324 : ifd.t273, cnts = tiled ? ifd.t325 : ifd.t279
  const per = offs.length / spp, bits = ifd.t258[0]
  if (!Number.isInteger(per) || (bits !== 8 && bits !== 16)) throw new Error('planar layout')
  const planes = []
  let w = 0, h = 0
  for (let p = 0; p < spp; p++) {
    const plane = Object.assign({}, ifd, { t277: [1], t258: [bits], t284: [1], t262: [1] })
    if (tiled) { plane.t324 = offs.slice(p * per, (p + 1) * per); plane.t325 = cnts.slice(p * per, (p + 1) * per) } else { plane.t273 = offs.slice(p * per, (p + 1) * per); plane.t279 = cnts.slice(p * per, (p + 1) * per) }
    UTIF.decodeImage(ab, plane, ifds)
    planes.push(plane.data); w = plane.width; h = plane.height
  }
  const by = bits >> 3, n = w * h, out = new Uint8Array(n * spp * by)
  for (let p = 0; p < spp; p++) for (let i = 0; i < n; i++) for (let k = 0; k < by; k++) out[(i * spp + p) * by + k] = planes[p][i * by + k]
  ifd.width = w; ifd.height = h; ifd.data = out; ifd.t284 = [1]
}

const TAGS = ['t254', 't256', 't257', 't259', 't262', 't273', 't277', 't278', 't279', 't284', 't322', 't323', 't324', 't325', 't347']
let ab = null, ifds = null, pages = []

self.onmessage = ({ data }) => {
  try {
    if (data.op === 'open') {
      ab = data.buffer
      ifds = UTIF.decode(ab)
      pages = ifds.filter((i) => i.t256 && i.t257)
      const full = pages.filter((i) => !((i.t254?.[0] || 0) & 1)) // skip reduced-resolution copies
      if (full.length) pages = full
      self.postMessage({ id: data.id, pages: pages.map((ifd) => {
        const jpeg = ifd.t259?.[0] === 7 && data.jpegByBrowser
        const tags = {}
        if (jpeg) for (const k of TAGS) if (ifd[k]) tags[k] = Array.from(ifd[k])
        return { width: ifd.t256[0], height: ifd.t257[0], orientation: ifd.t274?.[0] || 1, jpeg: jpeg ? tags : undefined }
      }) })
    } else if (data.op === 'page') {
      const ifd = pages[data.index]
      if (ifd.t284?.[0] === 2 && (ifd.t277?.[0] || 1) > 1) decodePlanar(ifd)
      else UTIF.decodeImage(ab, ifd, ifds)
      if (!ifd.width || !ifd.height || !ifd.data || !ifd.data.length) { self.postMessage({ id: data.id, error: 'empty' }); return }
      const rgba = UTIF.toRGBA8(ifd)
      const copy = rgba.buffer.byteLength === rgba.length ? rgba.buffer : rgba.slice().buffer
      const out = { id: data.id, width: ifd.width, height: ifd.height, rgba: copy }
      ifd.data = null
      self.postMessage(out, [copy])
    }
  } catch (e) {
    self.postMessage({ id: data.id, error: String((e && e.message) || e) })
  }
}
