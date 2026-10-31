// XCF image reader: flattens the visible layers (normal blending with opacity and layer masks). 8-bit RGB, gray and indexed images,
// stored uncompressed, with RLE or with zlib. No DOM, no libraries.
import { raster, ascii } from './_codecs.js'

const fail = (m) => { throw new Error(m) }

/** Returns { raster, note } */
export async function decodeXcf(b) {
  if (b.length < 40 || ascii(b, 0, 9) !== 'gimp xcf ') fail('This is not an XCF file.')
  const dv = new DataView(b.buffer, b.byteOffset, b.length)
  const vs = ascii(b, 9, 4)
  const version = vs === 'file' ? 0 : parseInt(vs.slice(1), 10)
  if (!(version >= 0 && version < 100)) fail('This XCF file has an unknown version.')
  let p = 14
  const u32 = () => { if (p + 4 > b.length) fail('This XCF file is cut off.'); const v = dv.getUint32(p); p += 4; return v }
  const i32 = () => { const v = dv.getInt32(p); p += 4; return v }
  const ptr = () => { if (version >= 11) { const v = Number(dv.getBigUint64(p)); p += 8; return v } return u32() }
  const str = () => { const n = u32(); const s = new TextDecoder().decode(b.subarray(p, p + Math.max(0, n - 1))); p += n; return s }
  const width = u32(), height = u32(), baseType = u32()
  const precision = version >= 4 ? u32() : 150
  if (version >= 4 && precision !== 100 && precision !== 150) fail('This XCF file stores more than 8 bits per channel, which is not supported yet. Convert the image to 8 bits per channel and save it again.')
  if (!(width > 0 && height > 0) || width * height > 100_000_000) fail('This XCF file has an unsupported size.')

  const readProps = () => {
    const props = {}
    for (;;) {
      const type = u32(), size = u32()
      if (type === 0) break
      if (!(type in props)) props[type] = b.subarray(p, p + size)
      p += size
      if (p > b.length) fail('This XCF file is cut off.')
    }
    return props
  }
  const imageProps = readProps()
  const compression = imageProps[17] ? imageProps[17][0] : 0
  if (compression > 2) fail('This XCF file uses a compression that is not supported.')
  const palette = imageProps[1] ? imageProps[1].subarray(4, 4 + 3 * ((imageProps[1][2] << 8) | imageProps[1][3])) : null
  const layerPtrs = []
  for (let o = ptr(); o !== 0; o = ptr()) layerPtrs.push(o)

  // every offset in the file, so a compressed tile knows where it ends
  const offsets = new Set([b.length])
  const tileJobs = []

  function hierarchy(off, bppExpect) {
    p = off
    const hw = u32(), hh = u32(), bpp = u32()
    const lvl = ptr()
    offsets.add(lvl)
    p = lvl
    const lw = u32(), lh = u32()
    const tiles = []
    for (let o = ptr(); o !== 0; o = ptr()) { tiles.push(o); offsets.add(o) }
    void hw; void hh
    if (bppExpect && bpp !== bppExpect) fail('This XCF file uses a pixel layout that is not supported.')
    if (lw * lh > 100_000_000) fail('A layer in this XCF file is too large.')
    return { lw, lh, bpp, tiles, data: new Uint8Array(lw * lh * bpp) }
  }
  const layers = []
  let sawOtherMode = false
  for (const lo of layerPtrs) {
    p = lo
    const lw = u32(), lh = u32(), type = u32()
    const name = str()
    const props = readProps()
    const hptr = ptr(), mptr = ptr()
    offsets.add(hptr)
    const isGroup = !!props[29]
    const visible = props[8] ? new DataView(props[8].buffer, props[8].byteOffset, 4).getUint32(0) !== 0 : true
    let opacity = props[6] ? new DataView(props[6].buffer, props[6].byteOffset, 4).getUint32(0) / 255 : 1
    if (props[33]) opacity = new DataView(props[33].buffer, props[33].byteOffset, 4).getFloat32(0)
    const off = props[15] ? [new DataView(props[15].buffer, props[15].byteOffset, 8).getInt32(0), new DataView(props[15].buffer, props[15].byteOffset, 8).getInt32(4)] : [0, 0]
    const mode = props[7] ? new DataView(props[7].buffer, props[7].byteOffset, 4).getUint32(0) : 0
    if (mode !== 0 && mode !== 28) sawOtherMode = true
    const applyMask = props[10] ? props[10][3] !== 0 : true
    if (isGroup || !visible || !hptr || lw * lh === 0) continue
    const chans = { 0: 3, 1: 4, 2: 1, 3: 2, 4: 1, 5: 2 }[type]
    if (!chans) fail('This XCF file uses a layer type that is not supported.')
    const hi = hierarchy(hptr, chans)
    let mask = null
    if (mptr && applyMask) {
      p = mptr
      u32(); u32(); str(); readProps()
      const mh = ptr()
      if (mh) mask = hierarchy(mh, 1)
    }
    layers.push({ name, type, w: lw, h: lh, off, opacity, hi, mask })
  }
  // read the tiles now that every offset is known
  const sorted = [...offsets].sort((x, y) => x - y)
  const endOf = (o) => { let lo = 0, hi = sorted.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] > o) hi = m; else lo = m + 1 } return sorted[lo] }
  const decodeTiles = async (h) => {
    const tx = Math.ceil(h.lw / 64)
    for (let i = 0; i < h.tiles.length; i++) {
      const x0 = (i % tx) * 64, y0 = Math.floor(i / tx) * 64
      if (y0 >= h.lh) break
      const tw = Math.min(64, h.lw - x0), th = Math.min(64, h.lh - y0), size = tw * th * h.bpp
      const start = h.tiles[i]
      const end = Math.max(endOf(start), start)
      const src = b.subarray(start, end)
      let tile
      if (compression === 0) tile = src.subarray(0, size)
      else if (compression === 1) tile = unRle(src, tw * th, h.bpp)
      else { try { tile = inflateTile(src, size) } catch { fail('A tile of this XCF file could not be decompressed.') } }
      if (tile.length < size) fail('This XCF file is damaged (a tile is too short).')
      for (let y = 0; y < th; y++) h.data.set(tile.subarray(y * tw * h.bpp, (y + 1) * tw * h.bpp), ((y0 + y) * h.lw + x0) * h.bpp)
    }
  }
  for (const l of layers) { await decodeTiles(l.hi); if (l.mask) await decodeTiles(l.mask) }

  const out = raster(width, height), d = out.data
  const pal = (i) => (palette && palette.length >= i * 3 + 3 ? [palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2]] : [i, i, i])
  for (const l of layers.reverse()) { // the file lists the top layer first
    const { hi, mask } = l, bpp = hi.bpp
    for (let y = 0; y < hi.lh; y++) {
      const dy = y + l.off[1]
      if (dy < 0 || dy >= height) continue
      for (let x = 0; x < hi.lw; x++) {
        const dx = x + l.off[0]
        if (dx < 0 || dx >= width) continue
        const s = (y * hi.lw + x) * bpp
        let r, g, bl, a = 255
        if (l.type === 0 || l.type === 1) { r = hi.data[s]; g = hi.data[s + 1]; bl = hi.data[s + 2]; if (l.type === 1) a = hi.data[s + 3] }
        else if (l.type === 2 || l.type === 3) { r = g = bl = hi.data[s]; if (l.type === 3) a = hi.data[s + 1] }
        else { [r, g, bl] = pal(hi.data[s]); if (l.type === 5) a = hi.data[s + 1] }
        let al = (a / 255) * l.opacity
        if (mask && x < mask.lw && y < mask.lh) al *= mask.data[y * mask.lw + x] / 255
        if (al <= 0) continue
        const di = (dy * width + dx) * 4, da = d[di + 3] / 255, oa = al + da * (1 - al)
        d[di] = (r * al + d[di] * da * (1 - al)) / oa
        d[di + 1] = (g * al + d[di + 1] * da * (1 - al)) / oa
        d[di + 2] = (bl * al + d[di + 2] * da * (1 - al)) / oa
        d[di + 3] = oa * 255
      }
    }
  }
  if (!layers.length) fail('This XCF file has no visible layers.')
  void baseType
  return { raster: out, note: sawOtherMode ? 'Layer blend modes other than Normal are drawn as Normal' : undefined }
}

/** The XCF tile RLE: each channel is coded separately, runs of one value or literal runs. */
function unRle(src, pixels, bpp) {
  const out = new Uint8Array(pixels * bpp)
  let p = 0
  for (let c = 0; c < bpp; c++) {
    let o = c, left = pixels
    while (left > 0) {
      if (p >= src.length) fail('This XCF file is damaged (a tile is cut off).')
      let len = src[p++]
      if (len >= 128) {
        len = 256 - len
        if (len === 128) { len = (src[p] << 8) | src[p + 1]; p += 2 }
        for (let i = 0; i < len && left > 0; i++, left--, o += bpp) out[o] = src[p++]
      } else {
        len += 1
        if (len === 128) { len = (src[p] << 8) | src[p + 1]; p += 2 }
        const v = src[p++]
        for (let i = 0; i < len && left > 0; i++, left--, o += bpp) out[o] = v
      }
    }
  }
  return out
}

/**
 * Inflate one zlib stream to exactly `size` bytes. A small decoder of our own, because the browser's DecompressionStream refuses data
 * that has anything after the end of the stream, and in an XCF file the next tile starts right behind it.
 */
const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]
function huff(lengths) {
  const counts = new Uint16Array(16), symbols = new Uint16Array(lengths.length)
  for (const l of lengths) counts[l]++
  counts[0] = 0
  const offs = new Uint16Array(16)
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1]
  lengths.forEach((l, sym) => { if (l) symbols[offs[l]++] = sym })
  return { counts, symbols }
}
function inflateTile(src, size) {
  if (src.length < 6 || (src[0] & 15) !== 8 || (src[1] & 32)) throw new Error('not zlib')
  const out = new Uint8Array(size)
  let p = 2, o = 0, buf = 0, cnt = 0
  const bits = (n) => {
    while (cnt < n) { if (p >= src.length) throw new Error('eof'); buf |= src[p++] << cnt; cnt += 8 }
    const v = buf & ((1 << n) - 1)
    buf >>>= n; cnt -= n
    return v
  }
  const decode = (t) => {
    let code = 0, first = 0, index = 0
    for (let len = 1; len < 16; len++) {
      code |= bits(1)
      const count = t.counts[len]
      if (code - count < first) return t.symbols[index + (code - first)]
      index += count; first += count; first <<= 1; code <<= 1
    }
    throw new Error('bad code')
  }
  let fixedL = null, fixedD = null
  for (let last = 0; !last && o < size;) {
    last = bits(1)
    const type = bits(2)
    if (type === 0) {
      buf = 0; cnt = 0
      const len = src[p] | (src[p + 1] << 8)
      p += 4
      for (let i = 0; i < len && o < size; i++) out[o++] = src[p++]
      continue
    }
    let lt, dt
    if (type === 1) {
      if (!fixedL) {
        const l = new Uint8Array(288)
        for (let i = 0; i < 144; i++) l[i] = 8
        for (let i = 144; i < 256; i++) l[i] = 9
        for (let i = 256; i < 280; i++) l[i] = 7
        for (let i = 280; i < 288; i++) l[i] = 8
        fixedL = huff(l); fixedD = huff(new Uint8Array(30).fill(5))
      }
      lt = fixedL; dt = fixedD
    } else if (type === 2) {
      const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4
      const lens = new Uint8Array(19)
      for (let i = 0; i < ncode; i++) lens[CL_ORDER[i]] = bits(3)
      const cl = huff(lens), all = new Uint8Array(nlen + ndist)
      for (let i = 0; i < nlen + ndist;) {
        const sym = decode(cl)
        if (sym < 16) all[i++] = sym
        else {
          let prev = 0, rep
          if (sym === 16) { prev = all[i - 1]; rep = 3 + bits(2) } else if (sym === 17) rep = 3 + bits(3); else rep = 11 + bits(7)
          while (rep-- && i < all.length) all[i++] = prev
        }
      }
      lt = huff(all.subarray(0, nlen)); dt = huff(all.subarray(nlen))
    } else throw new Error('bad block')
    for (;;) {
      const sym = decode(lt)
      if (sym < 256) { if (o >= size) return out; out[o++] = sym }
      else if (sym === 256) break
      else {
        const li = sym - 257
        const len = LBASE[li] + bits(LEXT[li])
        const di = decode(dt)
        const dist = DBASE[di] + bits(DEXT[di])
        if (dist > o) throw new Error('bad distance')
        for (let i = 0; i < len && o < size; i++, o++) out[o] = out[o - dist]
        if (o >= size) return out
      }
    }
  }
  if (o < size) throw new Error('short')
  return out
}
