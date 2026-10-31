// Pixel-format codecs written for this pack: TGA, PNM, PCX, QOI, DDS, ICO/CUR, ICNS, BMP (write), TIFF (write), MNG.
// Pure functions on bytes, no DOM and no libraries, so they run in the browser and in Node tests.
// A decoded picture is a "raster": { width, height, data: Uint8ClampedArray } holding non-premultiplied RGBA, top row first.

const fail = (m) => { throw new Error(m) }
export const raster = (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) })
const u16 = (b, o) => b[o] | (b[o + 1] << 8)
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
const be16 = (b, o) => (b[o] << 8) | b[o + 1]
const be32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
const ascii = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n))
const checkSize = (w, h, what) => { if (!(w > 0 && h > 0) || w * h > 268_000_000) fail(`This ${what} has an unsupported size (${w} x ${h}).`) }

/** zlib deflate with the browser (and Node) CompressionStream. */
export async function deflate(bytes) {
  const cs = new CompressionStream('deflate')
  const w = cs.writable.getWriter()
  w.write(bytes); w.close()
  return new Uint8Array(await new Response(cs.readable).arrayBuffer())
}
export async function inflate(bytes, format = 'deflate') {
  const ds = new DecompressionStream(format)
  const w = ds.writable.getWriter()
  w.write(bytes); w.close()
  return new Uint8Array(await new Response(ds.readable).arrayBuffer())
}

/** Turn a picture the way its orientation tag (1 to 8, as in EXIF) says it should be shown. */
export function orient(r, o) {
  if (!(o >= 2 && o <= 8)) return r
  const { width: w, height: h, data: s } = r
  const swap = o >= 5, W = swap ? h : w, H = swap ? w : h
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let dx, dy
    if (o === 2) { dx = w - 1 - x; dy = y } else if (o === 3) { dx = w - 1 - x; dy = h - 1 - y } else if (o === 4) { dx = x; dy = h - 1 - y }
    else if (o === 5) { dx = y; dy = x } else if (o === 6) { dx = h - 1 - y; dy = x } else if (o === 7) { dx = h - 1 - y; dy = w - 1 - x } else { dx = y; dy = w - 1 - x }
    const si = (y * w + x) * 4, di = (dy * W + dx) * 4
    out[di] = s[si]; out[di + 1] = s[si + 1]; out[di + 2] = s[si + 2]; out[di + 3] = s[si + 3]
  }
  return { width: W, height: H, data: out }
}

export function hasAlpha(r) {
  const d = r.data
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return true
  return false
}
export function isGray(r) {
  const d = r.data
  for (let i = 0; i < d.length; i += 4) if (d[i] !== d[i + 1] || d[i] !== d[i + 2]) return false
  return true
}

// ---------------------------------------------------------------- TGA
export function decodeTga(b) {
  if (b.length < 18) fail('This TGA file is too short to be an image.')
  const idLen = b[0], cmapType = b[1], type = b[2]
  const cmapFirst = u16(b, 3), cmapLen = u16(b, 5), cmapBits = b[7]
  const w = u16(b, 12), h = u16(b, 14), bpp = b[16], desc = b[17]
  if (![1, 2, 3, 9, 10, 11].includes(type)) fail(`This TGA uses an unsupported image type (${type}).`)
  checkSize(w, h, 'TGA')
  const rle = type >= 9, kind = type & 3
  const bytesPP = (bpp + 7) >> 3
  if (![8, 15, 16, 24, 32].includes(bpp)) fail(`This TGA uses ${bpp} bits per pixel, which is not supported.`)
  let pos = 18 + idLen
  let pal = null
  if (cmapType === 1) {
    const eb = (cmapBits + 7) >> 3
    pal = new Uint8ClampedArray(cmapLen * 4)
    for (let i = 0; i < cmapLen; i++, pos += eb) putPixel(pal, i * 4, b, pos, cmapBits, 8)
  } else if (kind === 1) fail('This TGA is palette based but has no palette.')
  const n = w * h, raw = new Uint8Array(n * bytesPP)
  if (!rle) {
    if (pos + raw.length > b.length) fail('This TGA file is cut off.')
    raw.set(b.subarray(pos, pos + raw.length))
  } else {
    let o = 0
    while (o < raw.length && pos < b.length) {
      const hd = b[pos++], cnt = (hd & 127) + 1
      if (hd & 128) {
        if (pos + bytesPP > b.length) break
        for (let i = 0; i < cnt && o < raw.length; i++, o += bytesPP) for (let k = 0; k < bytesPP; k++) raw[o + k] = b[pos + k]
        pos += bytesPP
      } else {
        const len = Math.min(cnt * bytesPP, raw.length - o, b.length - pos)
        raw.set(b.subarray(pos, pos + len), o); o += len; pos += len
      }
    }
    if (o < raw.length) fail('This TGA file is cut off.')
  }
  const out = raster(w, h), d = out.data
  const attr = desc & 15, topDown = !!(desc & 0x20), rightToLeft = !!(desc & 0x10)
  let anyAlpha = false
  for (let y = 0; y < h; y++) {
    const sy = topDown ? y : h - 1 - y
    for (let x = 0; x < w; x++) {
      const sx = rightToLeft ? w - 1 - x : x
      const si = (sy * w + sx) * bytesPP, di = (y * w + x) * 4
      if (kind === 1) {
        const idx = (bytesPP === 1 ? raw[si] : u16(raw, si)) - cmapFirst
        const p = Math.max(0, Math.min(cmapLen - 1, idx)) * 4
        d[di] = pal[p]; d[di + 1] = pal[p + 1]; d[di + 2] = pal[p + 2]; d[di + 3] = pal[p + 3]
      } else if (kind === 3) {
        d[di] = d[di + 1] = d[di + 2] = raw[si]; d[di + 3] = bytesPP === 2 ? raw[si + 1] : 255
      } else putPixel(d, di, raw, si, bpp, attr)
      if (d[di + 3] !== 0) anyAlpha = true
    }
  }
  if (!anyAlpha) for (let i = 3; i < d.length; i += 4) d[i] = 255 // some tools write an all-zero alpha channel
  return out
}
function putPixel(d, di, s, si, bits, attr) {
  if (bits === 24) { d[di] = s[si + 2]; d[di + 1] = s[si + 1]; d[di + 2] = s[si]; d[di + 3] = 255 }
  else if (bits === 32) { d[di] = s[si + 2]; d[di + 1] = s[si + 1]; d[di + 2] = s[si]; d[di + 3] = attr ? s[si + 3] : 255 }
  else { // 15 or 16: A1R5G5B5
    const v = s[si] | (s[si + 1] << 8)
    const r = (v >> 10) & 31, g = (v >> 5) & 31, bl = v & 31
    d[di] = (r << 3) | (r >> 2); d[di + 1] = (g << 3) | (g >> 2); d[di + 2] = (bl << 3) | (bl >> 2)
    d[di + 3] = bits === 16 && attr ? (v & 0x8000 ? 255 : 0) : 255
  }
}

export function encodeTga(r, { rle = true } = {}) {
  const { width: w, height: h, data } = r
  if (w > 65535 || h > 65535) fail('TGA images can be at most 65535 pixels wide or tall.')
  const alpha = hasAlpha(r), bpp = alpha ? 4 : 3
  const out = []
  const head = new Uint8Array(18)
  head[2] = rle ? 10 : 2; head[12] = w & 255; head[13] = w >> 8; head[14] = h & 255; head[15] = h >> 8
  head[16] = bpp * 8; head[17] = 0x20 | (alpha ? 8 : 0) // top-left origin
  out.push(head)
  const px = (i) => alpha ? [data[i + 2], data[i + 1], data[i], data[i + 3]] : [data[i + 2], data[i + 1], data[i]]
  if (!rle) {
    const body = new Uint8Array(w * h * bpp)
    for (let i = 0, o = 0; i < data.length; i += 4) { body.set(px(i), o); o += bpp }
    out.push(body)
  } else {
    const buf = []
    for (let y = 0; y < h; y++) {
      const row = []
      for (let x = 0; x < w; x++) row.push(px((y * w + x) * 4))
      const same = (a, b2) => a.every((v, k) => v === b2[k])
      let x = 0
      while (x < w) {
        let run = 1
        while (x + run < w && run < 128 && same(row[x], row[x + run])) run++
        if (run > 1) { buf.push(0x80 | (run - 1), ...row[x]); x += run; continue }
        let lit = 1
        while (x + lit < w && lit < 128 && !(x + lit + 1 < w && same(row[x + lit], row[x + lit + 1]))) lit++
        buf.push(lit - 1)
        for (let k = 0; k < lit; k++) buf.push(...row[x + k])
        x += lit
      }
    }
    out.push(Uint8Array.from(buf))
  }
  return concat(out)
}

export function concat(parts) {
  let n = 0
  for (const p of parts) n += p.length
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

// ---------------------------------------------------------------- PNM (PBM, PGM, PPM, PAM)
export function decodePnm(b) {
  if (b[0] !== 0x50 || b.length < 3) fail('This is not a PNM (PBM, PGM or PPM) file.')
  const kind = b[1] - 48
  if (kind < 1 || kind > 7) fail('This is not a PNM (PBM, PGM or PPM) file.')
  let pos = 2, w, h, maxv = 1, depth = 0
  const token = () => {
    for (;;) {
      while (pos < b.length && (b[pos] === 32 || b[pos] === 9 || b[pos] === 10 || b[pos] === 13)) pos++
      if (b[pos] === 0x23) { while (pos < b.length && b[pos] !== 10) pos++ } else break
    }
    let s = ''
    while (pos < b.length && !(b[pos] === 32 || b[pos] === 9 || b[pos] === 10 || b[pos] === 13)) s += String.fromCharCode(b[pos++])
    return s
  }
  if (kind === 7) { // PAM
    let tupl = ''
    for (;;) {
      const key = token()
      if (key === 'ENDHDR' || key === '') break
      const val = token()
      if (key === 'WIDTH') w = +val; else if (key === 'HEIGHT') h = +val; else if (key === 'DEPTH') depth = +val; else if (key === 'MAXVAL') maxv = +val; else if (key === 'TUPLTYPE') tupl = val
    }
    pos++ // single whitespace after ENDHDR
    if (!(depth >= 1 && depth <= 4)) fail(`This PAM file has ${depth} channels per pixel, which is not supported.`)
    void tupl
  } else {
    w = +token(); h = +token()
    if (kind !== 1 && kind !== 4) maxv = +token()
    depth = kind === 3 || kind === 6 ? 3 : 1
    if (kind === 4 || kind === 5 || kind === 6) pos++
  }
  if (!(w > 0 && h > 0) || !(maxv > 0 && maxv < 65536)) fail('This PNM file has a damaged header.')
  checkSize(w, h, 'PNM')
  const out = raster(w, h), d = out.data, n = w * h
  const ascii = kind <= 3
  const wide = maxv > 255
  const scale = 255 / maxv
  if (kind === 4) { // 1 bit packed rows, 1 = black
    const rowBytes = (w + 7) >> 3
    if (pos + rowBytes * h > b.length) fail('This PBM file is cut off.')
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const bit = (b[pos + y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1
      const i = (y * w + x) * 4
      d[i] = d[i + 1] = d[i + 2] = bit ? 0 : 255; d[i + 3] = 255
    }
    return out
  }
  const samples = n * depth
  const vals = wide ? new Uint16Array(samples) : new Uint8Array(samples)
  if (ascii) {
    for (let i = 0; i < samples; i++) {
      if (kind === 1) { // PBM ascii digits may be written without spaces
        while (pos < b.length && (b[pos] === 32 || b[pos] === 10 || b[pos] === 13 || b[pos] === 9)) pos++
        if (b[pos] === 0x23) { while (pos < b.length && b[pos] !== 10) pos++; i--; continue }
        vals[i] = b[pos++] - 48
      } else vals[i] = +token()
    }
  } else if (wide) {
    if (pos + samples * 2 > b.length) fail('This PNM file is cut off.')
    for (let i = 0; i < samples; i++, pos += 2) vals[i] = (b[pos] << 8) | b[pos + 1]
  } else {
    if (pos + samples > b.length) fail('This PNM file is cut off.')
    vals.set(b.subarray(pos, pos + samples))
  }
  for (let i = 0; i < n; i++) {
    const o = i * 4
    if (kind === 1) { d[o] = d[o + 1] = d[o + 2] = vals[i] ? 0 : 255; d[o + 3] = 255; continue }
    if (depth === 1 || depth === 2) { d[o] = d[o + 1] = d[o + 2] = vals[i * depth] * scale; d[o + 3] = depth === 2 ? vals[i * depth + 1] * scale : 255 }
    else { d[o] = vals[i * depth] * scale; d[o + 1] = vals[i * depth + 1] * scale; d[o + 2] = vals[i * depth + 2] * scale; d[o + 3] = depth === 4 ? vals[i * depth + 3] * scale : 255 }
  }
  return out
}

/** kind: 'ppm' (color), 'pgm' (gray), 'pbm' (black and white), 'pnm' (color, or gray when the picture is gray). Transparency is flattened on white. */
export function encodePnm(r, kind = 'ppm', { threshold = 128 } = {}) {
  const { width: w, height: h, data } = r
  const lum = (i) => {
    const a = data[i + 3] / 255
    const f = (v) => v * a + 255 * (1 - a)
    return 0.299 * f(data[i]) + 0.587 * f(data[i + 1]) + 0.114 * f(data[i + 2])
  }
  if (kind === 'pnm') kind = isGray(r) ? 'pgm' : 'ppm'
  const enc = new TextEncoder()
  if (kind === 'pbm') {
    const rowBytes = (w + 7) >> 3, body = new Uint8Array(rowBytes * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (lum((y * w + x) * 4) < threshold) body[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7)
    return concat([enc.encode(`P4\n${w} ${h}\n`), body])
  }
  const ch = kind === 'pgm' ? 1 : 3, body = new Uint8Array(w * h * ch)
  for (let i = 0, o = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255
    if (ch === 1) body[o++] = Math.round(lum(i))
    else { body[o++] = Math.round(data[i] * a + 255 * (1 - a)); body[o++] = Math.round(data[i + 1] * a + 255 * (1 - a)); body[o++] = Math.round(data[i + 2] * a + 255 * (1 - a)) }
  }
  return concat([enc.encode(`${ch === 1 ? 'P5' : 'P6'}\n${w} ${h}\n255\n`), body])
}

// ---------------------------------------------------------------- PCX
export function decodePcx(b) {
  if (b.length < 128 || b[0] !== 0x0A || b[2] !== 1) fail('This is not a PCX image (or it uses an unsupported compression).')
  const bits = b[3], x0 = u16(b, 4), y0 = u16(b, 6), x1 = u16(b, 8), y1 = u16(b, 10)
  const planes = b[65], bpl = u16(b, 66)
  const w = x1 - x0 + 1, h = y1 - y0 + 1
  checkSize(w, h, 'PCX')
  if (![1, 2, 4, 8].includes(bits) || planes < 1 || planes > 4) fail('This PCX uses a layout that is not supported.')
  const scan = bpl * planes
  const lines = new Uint8Array(scan * h)
  let pos = 128, o = 0
  while (o < lines.length && pos < b.length) {
    let c = b[pos++], run = 1
    if ((c & 0xC0) === 0xC0) { run = c & 0x3F; c = b[pos++] }
    for (let i = 0; i < run && o < lines.length; i++) lines[o++] = c
  }
  if (o < lines.length) fail('This PCX file is cut off.')
  let pal = null
  if (bits === 8 && planes === 1) {
    if (b[b.length - 769] !== 0x0C) fail('This PCX has no 256-color palette.')
    pal = b.subarray(b.length - 768)
  } else if (bits < 8) pal = b.subarray(16, 64)
  const out = raster(w, h), d = out.data
  for (let y = 0; y < h; y++) {
    const row = y * scan
    for (let x = 0; x < w; x++) {
      const di = (y * w + x) * 4
      if (bits === 8 && planes >= 3) {
        d[di] = lines[row + x]; d[di + 1] = lines[row + bpl + x]; d[di + 2] = lines[row + 2 * bpl + x]; d[di + 3] = planes === 4 ? lines[row + 3 * bpl + x] : 255
      } else {
        let idx = 0
        if (bits === 8) idx = lines[row + x]
        else for (let p = 0; p < planes; p++) {
          const bitPos = x * bits, byte = lines[row + p * bpl + (bitPos >> 3)]
          const v = (byte >> (8 - bits - (bitPos & 7))) & ((1 << bits) - 1)
          idx |= v << (p * bits)
        }
        if (bits === 1 && planes === 1 && !(pal[0] | pal[1] | pal[2] | pal[3] | pal[4] | pal[5])) d[di] = d[di + 1] = d[di + 2] = idx ? 255 : 0 // no real palette: black and white
        else { d[di] = pal[idx * 3]; d[di + 1] = pal[idx * 3 + 1]; d[di + 2] = pal[idx * 3 + 2] }
        d[di + 3] = 255
      }
    }
  }
  return out
}

/** 24-bit RLE PCX. Transparency is flattened on white. */
export function encodePcx(r) {
  const { width: w, height: h, data } = r
  if (w > 65535 || h > 65535) fail('PCX images can be at most 65535 pixels wide or tall.')
  const bpl = w + (w & 1)
  const head = new Uint8Array(128)
  head[0] = 0x0A; head[1] = 5; head[2] = 1; head[3] = 8
  head[8] = (w - 1) & 255; head[9] = (w - 1) >> 8; head[10] = (h - 1) & 255; head[11] = (h - 1) >> 8
  head[12] = 72; head[14] = 72; head[65] = 3; head[66] = bpl & 255; head[67] = bpl >> 8; head[68] = 1
  const out = []
  const push = (v, run) => { if (run > 1 || v >= 0xC0) out.push(0xC0 | run, v); else out.push(v) }
  for (let y = 0; y < h; y++) for (let c = 0; c < 3; c++) {
    const line = new Uint8Array(bpl)
    for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, a = data[i + 3] / 255; line[x] = Math.round(data[i + c] * a + 255 * (1 - a)) }
    let x = 0
    while (x < bpl) {
      let run = 1
      while (x + run < bpl && run < 63 && line[x + run] === line[x]) run++
      push(line[x], run); x += run
    }
  }
  return concat([head, Uint8Array.from(out)])
}

// ---------------------------------------------------------------- QOI
export function decodeQoi(b) {
  if (b.length < 22 || ascii(b, 0, 4) !== 'qoif') fail('This is not a QOI image.')
  const w = be32(b, 4), h = be32(b, 8)
  checkSize(w, h, 'QOI')
  const out = raster(w, h), d = out.data, n = w * h
  const idx = new Uint8Array(256)
  let r = 0, g = 0, bl = 0, a = 255, run = 0, p = 14
  for (let i = 0; i < n; i++) {
    if (run > 0) run--
    else if (p < b.length - 8) {
      const t = b[p++]
      if (t === 0xFE) { r = b[p++]; g = b[p++]; bl = b[p++] }
      else if (t === 0xFF) { r = b[p++]; g = b[p++]; bl = b[p++]; a = b[p++] }
      else if ((t & 0xC0) === 0) { const k = (t & 63) * 4; r = idx[k]; g = idx[k + 1]; bl = idx[k + 2]; a = idx[k + 3] }
      else if ((t & 0xC0) === 0x40) { r = (r + ((t >> 4) & 3) - 2) & 255; g = (g + ((t >> 2) & 3) - 2) & 255; bl = (bl + (t & 3) - 2) & 255 }
      else if ((t & 0xC0) === 0x80) {
        const t2 = b[p++], dg = (t & 63) - 32
        r = (r + dg - 8 + ((t2 >> 4) & 15)) & 255; g = (g + dg) & 255; bl = (bl + dg - 8 + (t2 & 15)) & 255
      } else run = t & 63
      const k = ((r * 3 + g * 5 + bl * 7 + a * 11) & 63) * 4
      idx[k] = r; idx[k + 1] = g; idx[k + 2] = bl; idx[k + 3] = a
    }
    const o = i * 4
    d[o] = r; d[o + 1] = g; d[o + 2] = bl; d[o + 3] = a
  }
  return out
}

export function encodeQoi(r) {
  const { width: w, height: h, data } = r
  const out = new Uint8Array(14 + w * h * 5 + 8)
  const dv = new DataView(out.buffer)
  out.set([0x71, 0x6F, 0x69, 0x66]); dv.setUint32(4, w); dv.setUint32(8, h); out[12] = 4; out[13] = 0
  const idx = new Uint8Array(256)
  let pr = 0, pg = 0, pb = 0, pa = 255, run = 0, p = 14
  const n = w * h
  for (let i = 0; i < n; i++) {
    const o = i * 4, cr = data[o], cg = data[o + 1], cb = data[o + 2], ca = data[o + 3]
    if (cr === pr && cg === pg && cb === pb && ca === pa) {
      if (++run === 62 || i === n - 1) { out[p++] = 0xC0 | (run - 1); run = 0 }
      continue
    }
    if (run > 0) { out[p++] = 0xC0 | (run - 1); run = 0 }
    const k = ((cr * 3 + cg * 5 + cb * 7 + ca * 11) & 63) * 4
    if (idx[k] === cr && idx[k + 1] === cg && idx[k + 2] === cb && idx[k + 3] === ca) out[p++] = k / 4
    else {
      idx[k] = cr; idx[k + 1] = cg; idx[k + 2] = cb; idx[k + 3] = ca
      if (ca === pa) {
        const vr = (cr - pr + 128) & 255, vg = (cg - pg + 128) & 255, vb = (cb - pb + 128) & 255
        const dr = ((vr - 128) << 24) >> 24, dg = ((vg - 128) << 24) >> 24, db = ((vb - 128) << 24) >> 24
        const drg = dr - dg, dbg = db - dg
        if (dr >= -2 && dr <= 1 && dg >= -2 && dg <= 1 && db >= -2 && db <= 1) out[p++] = 0x40 | ((dr + 2) << 4) | ((dg + 2) << 2) | (db + 2)
        else if (dg >= -32 && dg <= 31 && drg >= -8 && drg <= 7 && dbg >= -8 && dbg <= 7) { out[p++] = 0x80 | (dg + 32); out[p++] = ((drg + 8) << 4) | (dbg + 8) }
        else { out[p++] = 0xFE; out[p++] = cr; out[p++] = cg; out[p++] = cb }
      } else { out[p++] = 0xFF; out[p++] = cr; out[p++] = cg; out[p++] = cb; out[p++] = ca }
    }
    pr = cr; pg = cg; pb = cb; pa = ca
  }
  out.set([0, 0, 0, 0, 0, 0, 0, 1], p); p += 8
  return out.slice(0, p)
}

// ---------------------------------------------------------------- DDS
const c565 = (v) => { const r = (v >> 11) & 31, g = (v >> 5) & 63, b = v & 31; return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)] }
function bc1Colors(b, o, fourColor) {
  const c0 = u16(b, o), c1 = u16(b, o + 2), e0 = c565(c0), e1 = c565(c1)
  const pal = [[...e0, 255], [...e1, 255]]
  if (c0 > c1 || fourColor) pal.push([...e0.map((v, i) => ((2 * v + e1[i]) / 3) | 0), 255], [...e0.map((v, i) => ((v + 2 * e1[i]) / 3) | 0), 255])
  else pal.push([...e0.map((v, i) => (v + e1[i]) >> 1), 255], [0, 0, 0, 0])
  return pal
}
function bc4Values(b, o) {
  const a0 = b[o], a1 = b[o + 1], pal = [a0, a1]
  if (a0 > a1) for (let i = 1; i <= 6; i++) pal.push(((7 - i) * a0 + i * a1) / 7 | 0)
  else { for (let i = 1; i <= 4; i++) pal.push(((5 - i) * a0 + i * a1) / 5 | 0); pal.push(0, 255) }
  let bits = 0n
  for (let i = 5; i >= 0; i--) bits = (bits << 8n) | BigInt(b[o + 2 + i])
  const vals = new Uint8Array(16)
  for (let i = 0; i < 16; i++) vals[i] = pal[Number((bits >> BigInt(3 * i)) & 7n)]
  return vals
}
const DXGI = { 28: 'rgba', 29: 'rgba', 87: 'bgra', 91: 'bgra', 88: 'bgrx', 71: 'bc1', 72: 'bc1', 74: 'bc2', 75: 'bc2', 77: 'bc3', 78: 'bc3', 80: 'bc4', 81: 'bc4', 83: 'bc5', 84: 'bc5', 61: 'r8', 65: 'a8' }

export function decodeDds(b) {
  if (b.length < 128 || ascii(b, 0, 4) !== 'DDS ' || u32(b, 4) !== 124) fail('This is not a DDS texture.')
  const h = u32(b, 12), w = u32(b, 16)
  checkSize(w, h, 'DDS')
  const pf = u32(b, 80), fourcc = ascii(b, 84, 4), bitCount = u32(b, 88)
  const masks = [u32(b, 92), u32(b, 96), u32(b, 100), u32(b, 104)]
  let pos = 128, mode = null
  if (pf & 4) {
    if (fourcc === 'DX10') {
      const fmt = u32(b, 128); pos = 148
      mode = DXGI[fmt]
      if (!mode) fail(`This DDS uses a texture format (DXGI ${fmt}) that is not supported. BC1 to BC5 and 8-bit color formats work.`)
    } else mode = { DXT1: 'bc1', DXT2: 'bc2', DXT3: 'bc2', DXT4: 'bc3', DXT5: 'bc3', ATI1: 'bc4', BC4U: 'bc4', ATI2: 'bc5', BC5U: 'bc5' }[fourcc]
    if (!mode) fail(`This DDS uses the "${fourcc}" compression, which is not supported. DXT1, DXT3, DXT5, BC4 and BC5 work.`)
  }
  const out = raster(w, h), d = out.data
  if (mode && mode.startsWith('bc')) {
    const bw = (w + 3) >> 2, bh = (h + 3) >> 2, size = mode === 'bc1' || mode === 'bc4' ? 8 : 16
    if (pos + bw * bh * size > b.length) fail('This DDS file is cut off.')
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      const o = pos + (by * bw + bx) * size
      let px, alpha = null, rg = null
      if (mode === 'bc1') px = bc1Colors(b, o, false)
      else if (mode === 'bc2') { px = bc1Colors(b, o + 8, true); alpha = (i) => { const v = (b[o + (i >> 1)] >> ((i & 1) * 4)) & 15; return v * 17 } }
      else if (mode === 'bc3') { px = bc1Colors(b, o + 8, true); const av = bc4Values(b, o); alpha = (i) => av[i] }
      else { rg = [bc4Values(b, o), size === 16 ? bc4Values(b, o + 8) : null] }
      const ci = mode === 'bc1' || mode === 'bc2' || mode === 'bc3' ? u32(b, o + (mode === 'bc1' ? 4 : 12)) : 0
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i & 3), y = by * 4 + (i >> 2)
        if (x >= w || y >= h) continue
        const di = (y * w + x) * 4
        if (rg) { // BC4 is one gray channel; BC5 is two channels (normal maps), the blue channel is rebuilt from them
          const x = rg[0][i], y = rg[1] ? rg[1][i] : x
          d[di] = x; d[di + 1] = y; d[di + 3] = 255
          if (rg[1]) { const nx = x / 127.5 - 1, ny = y / 127.5 - 1; d[di + 2] = Math.round((Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * 0.5 + 0.5) * 255) } else d[di + 2] = x
        }
        else { const c = px[(ci >> (2 * i)) & 3]; d[di] = c[0]; d[di + 1] = c[1]; d[di + 2] = c[2]; d[di + 3] = alpha ? alpha(i) : c[3] }
      }
    }
    return out
  }
  if (mode) { // DX10 uncompressed
    const bytes = mode === 'r8' || mode === 'a8' ? 1 : 4
    if (pos + w * h * bytes > b.length) fail('This DDS file is cut off.')
    for (let i = 0; i < w * h; i++) {
      const s = pos + i * bytes, o = i * 4
      if (mode === 'rgba') { d[o] = b[s]; d[o + 1] = b[s + 1]; d[o + 2] = b[s + 2]; d[o + 3] = b[s + 3] }
      else if (mode === 'bgra') { d[o] = b[s + 2]; d[o + 1] = b[s + 1]; d[o + 2] = b[s]; d[o + 3] = b[s + 3] }
      else if (mode === 'bgrx') { d[o] = b[s + 2]; d[o + 1] = b[s + 1]; d[o + 2] = b[s]; d[o + 3] = 255 }
      else if (mode === 'r8') { d[o] = d[o + 1] = d[o + 2] = b[s]; d[o + 3] = 255 }
      else { d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = b[s] }
    }
    return out
  }
  // uncompressed with channel masks
  const bytes = bitCount >> 3
  if (!(pf & 0x40 || pf & 0x20000 || pf & 2) || !bytes || bytes > 4) fail('This DDS uses a pixel layout that is not supported.')
  if (pos + w * h * bytes > b.length) fail('This DDS file is cut off.')
  const ext = (v, m) => { if (!m) return 0; let s = 0; while (!((m >> s) & 1)) s++; let bits = 0; while ((m >> (s + bits)) & 1) bits++; const x = (v & m) >>> s; return bits >= 8 ? x >> (bits - 8) : Math.round(x * 255 / ((1 << bits) - 1)) }
  const lum = !!(pf & 0x20000)
  for (let i = 0; i < w * h; i++) {
    let v = 0
    for (let k = 0; k < bytes; k++) v |= b[pos + i * bytes + k] << (8 * k)
    v >>>= 0
    const o = i * 4
    if (lum) { d[o] = d[o + 1] = d[o + 2] = ext(v, masks[0]); d[o + 3] = pf & 1 ? ext(v, masks[3]) : 255 }
    else if (pf & 2 && !(pf & 0x40)) { d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = ext(v, masks[3] || masks[0]) }
    else { d[o] = ext(v, masks[0]); d[o + 1] = ext(v, masks[1]); d[o + 2] = ext(v, masks[2]); d[o + 3] = pf & 1 ? ext(v, masks[3]) : 255 }
  }
  return out
}

// ---------------------------------------------------------------- ICO and CUR
/** Parse an ICO or CUR directory. Each entry: { width, height, bpp, hotX, hotY, png, data }. */
export function parseIco(b) {
  if (b.length < 6 || u16(b, 0) !== 0 || (u16(b, 2) !== 1 && u16(b, 2) !== 2)) fail('This is not an ICO or CUR file.')
  const type = u16(b, 2) === 2 ? 'cur' : 'ico', n = u16(b, 4), entries = []
  for (let i = 0; i < n; i++) {
    const o = 6 + i * 16
    if (o + 16 > b.length) break
    const size = u32(b, o + 8), off = u32(b, o + 12)
    if (off + size > b.length || !size) continue
    const data = b.subarray(off, off + size)
    const png = data[0] === 0x89 && data[1] === 0x50
    entries.push({ width: b[o] || 256, height: b[o + 1] || 256, bpp: type === 'ico' ? u16(b, o + 6) : 0, hotX: type === 'cur' ? u16(b, o + 4) : 0, hotY: type === 'cur' ? u16(b, o + 6) : 0, png, data })
  }
  if (!entries.length) fail('This icon file has no images in it.')
  return { type, entries }
}

/** Decode a DIB (bitmap) icon image, with its AND transparency mask. */
export function decodeIcoDib(data) {
  const hs = u32(data, 0), w = u32(data, 4), hh = u32(data, 8) | 0
  const bpp = u16(data, 14), comp = u32(data, 16)
  const h = Math.abs(hh) >> 1 || Math.abs(hh)
  if (comp !== 0 && comp !== 3) fail('This icon uses a compressed bitmap that is not supported.')
  checkSize(w, h, 'icon')
  let colors = u32(data, 32)
  if (bpp <= 8 && !colors) colors = 1 << bpp
  let pos = hs
  let masks = null
  if (comp === 3 && hs === 40) { masks = [u32(data, 40), u32(data, 44), u32(data, 48)]; pos += 12 }
  const pal = bpp <= 8 ? data.subarray(pos, pos + colors * 4) : null
  if (bpp <= 8) pos += colors * 4
  const stride = ((w * bpp + 31) >> 5) << 2
  const maskStride = ((w + 31) >> 5) << 2
  const xorEnd = pos + stride * h
  const out = raster(w, h), d = out.data
  let anyA = false
  for (let y = 0; y < h; y++) {
    const row = pos + (h - 1 - y) * stride
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      if (bpp === 32) { d[o] = data[row + x * 4 + 2]; d[o + 1] = data[row + x * 4 + 1]; d[o + 2] = data[row + x * 4]; d[o + 3] = data[row + x * 4 + 3]; if (d[o + 3]) anyA = true }
      else if (bpp === 24) { d[o] = data[row + x * 3 + 2]; d[o + 1] = data[row + x * 3 + 1]; d[o + 2] = data[row + x * 3]; d[o + 3] = 255 }
      else if (bpp === 16) {
        const v = u16(data, row + x * 2)
        if (masks && masks[1] === 0x7E0) { d[o] = c565(v)[0]; d[o + 1] = c565(v)[1]; d[o + 2] = c565(v)[2] } else { const r = (v >> 10) & 31, g = (v >> 5) & 31, bl = v & 31; d[o] = (r << 3) | (r >> 2); d[o + 1] = (g << 3) | (g >> 2); d[o + 2] = (bl << 3) | (bl >> 2) }
        d[o + 3] = 255
      } else {
        const bit = x * bpp, v = (data[row + (bit >> 3)] >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1)
        d[o] = pal[v * 4 + 2]; d[o + 1] = pal[v * 4 + 1]; d[o + 2] = pal[v * 4]; d[o + 3] = 255
      }
    }
  }
  const hasMask = xorEnd + maskStride * h <= data.length
  if (hasMask && (bpp !== 32 || !anyA)) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const m = (data[xorEnd + (h - 1 - y) * maskStride + (x >> 3)] >> (7 - (x & 7))) & 1
      const o = (y * w + x) * 4
      if (m) d[o + 3] = 0; else if (bpp === 32) d[o + 3] = 255
    }
  }
  return out
}

/** 32-bit DIB icon image (BGRA with an empty AND mask): the form every Windows version reads in a cursor. */
export function dibIconImage(r) {
  const { width: w, height: h, data } = r
  const stride = w * 4, maskStride = ((w + 31) >> 5) << 2
  const out = new Uint8Array(40 + stride * h + maskStride * h), dv = new DataView(out.buffer)
  dv.setUint32(0, 40, true); dv.setInt32(4, w, true); dv.setInt32(8, h * 2, true); dv.setUint16(12, 1, true); dv.setUint16(14, 32, true); dv.setUint32(20, stride * h, true)
  for (let y = 0; y < h; y++) {
    let o = 40 + (h - 1 - y) * stride
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) { out[o++] = data[i + 2]; out[o++] = data[i + 1]; out[o++] = data[i]; out[o++] = data[i + 3] }
  }
  return out
}

/** Build an ICO (or CUR) file: entries = [{ width, height, data (PNG or DIB bytes), hotX, hotY }]. Sizes of 256 are stored as 0. */
export function buildIco(entries, type = 'ico') {
  const head = new Uint8Array(6 + 16 * entries.length), dv = new DataView(head.buffer)
  dv.setUint16(2, type === 'cur' ? 2 : 1, true); dv.setUint16(4, entries.length, true)
  let off = head.length
  entries.forEach((e, i) => {
    const o = 6 + i * 16
    head[o] = e.width >= 256 ? 0 : e.width; head[o + 1] = e.height >= 256 ? 0 : e.height
    dv.setUint16(o + 4, type === 'cur' ? e.hotX || 0 : 1, true); dv.setUint16(o + 6, type === 'cur' ? e.hotY || 0 : 32, true)
    dv.setUint32(o + 8, e.data.length, true); dv.setUint32(o + 12, off, true)
    off += e.data.length
  })
  return concat([head, ...entries.map((e) => e.data)])
}

// ---------------------------------------------------------------- ICNS
export function parseIcns(b) {
  if (b.length < 16 || ascii(b, 0, 4) !== 'icns') fail('This is not an ICNS icon file.')
  const total = Math.min(be32(b, 4), b.length), entries = []
  let p = 8
  while (p + 8 <= total) {
    const len = be32(b, p + 4)
    if (len < 8 || p + len > total) break
    entries.push({ type: ascii(b, p, 4), data: b.subarray(p + 8, p + len) })
    p += len
  }
  return entries
}
const LEGACY = { is32: [16, 's8mk'], il32: [32, 'l8mk'], ih32: [48, 'h8mk'], it32: [128, 't8mk'], ic04: [16], ic05: [32] }
function unpackBits(src, pos, n) {
  const out = new Uint8Array(n)
  let o = 0
  while (o < n && pos < src.length) {
    const c = src[pos++]
    if (c & 0x80) { const len = c - 125, v = src[pos++]; for (let i = 0; i < len && o < n; i++) out[o++] = v }
    else { const len = c + 1; for (let i = 0; i < len && o < n; i++) out[o++] = src[pos++] }
  }
  return { out, pos }
}
/** Decode the old (pre-PNG) ICNS icons into rasters. Returns [{ type, size, raster }]. */
export function decodeIcnsLegacy(entries) {
  const res = []
  for (const e of entries) {
    const info = LEGACY[e.type]
    if (!info) continue
    const s = info[0], n = s * s, r = raster(s, s), d = r.data
    if (e.type === 'ic04' || e.type === 'ic05') {
      if (ascii(e.data, 0, 4) !== 'ARGB') continue
      let pos = 4
      const ch = []
      for (let c = 0; c < 4; c++) { const u = unpackBits(e.data, pos, n); ch.push(u.out); pos = u.pos }
      for (let i = 0; i < n; i++) { d[i * 4] = ch[1][i]; d[i * 4 + 1] = ch[2][i]; d[i * 4 + 2] = ch[3][i]; d[i * 4 + 3] = ch[0][i] }
    } else {
      let pos = e.type === 'it32' ? 4 : 0
      if (e.data.length === n * 3 && e.type !== 'it32') { // uncompressed
        for (let i = 0; i < n; i++) { d[i * 4] = e.data[i]; d[i * 4 + 1] = e.data[n + i]; d[i * 4 + 2] = e.data[2 * n + i] }
      } else {
        const ch = []
        for (let c = 0; c < 3; c++) { const u = unpackBits(e.data, pos, n); ch.push(u.out); pos = u.pos }
        for (let i = 0; i < n; i++) { d[i * 4] = ch[0][i]; d[i * 4 + 1] = ch[1][i]; d[i * 4 + 2] = ch[2][i] }
      }
      const mk = entries.find((x) => x.type === info[1])
      for (let i = 0; i < n; i++) d[i * 4 + 3] = mk && mk.data.length >= n ? mk.data[i] : 255
    }
    res.push({ type: e.type, size: s, raster: r })
  }
  return res
}
const ICNS_TYPES = { 16: 'icp4', 32: 'icp5', 64: 'icp6', 128: 'ic07', 256: 'ic08', 512: 'ic09', 1024: 'ic10' }
const ICNS_RETINA = { 32: 'ic11', 64: 'ic12', 256: 'ic13', 512: 'ic14' }
export const ICNS_SIZES = [16, 32, 64, 128, 256, 512, 1024]
/** Build an ICNS file from PNG images: pngs = { 16: Uint8Array, 32: ... } (sizes from ICNS_SIZES). Retina entries reuse the double-size PNG. */
export function buildIcns(pngs) {
  const parts = []
  const add = (type, data) => { const h = new Uint8Array(8); h.set([...type].map((c) => c.charCodeAt(0))); new DataView(h.buffer).setUint32(4, data.length + 8); parts.push(h, data) }
  for (const s of ICNS_SIZES) if (pngs[s]) add(ICNS_TYPES[s], pngs[s])
  for (const s of Object.keys(ICNS_RETINA)) if (pngs[s]) add(ICNS_RETINA[s], pngs[s])
  if (!parts.length) fail('Pick at least one icon size.')
  const body = concat(parts)
  const head = new Uint8Array(8)
  head.set([0x69, 0x63, 0x6E, 0x73]); new DataView(head.buffer).setUint32(4, body.length + 8)
  return concat([head, body])
}

// ---------------------------------------------------------------- BMP (write)
/** 24-bit BMP, or 32-bit with alpha when the picture has transparency. Opaque pictures are flattened on white when `flatten` is set. */
export function encodeBmp(r) {
  const { width: w, height: h, data } = r
  const alpha = hasAlpha(r), bpp = alpha ? 32 : 24
  const hs = alpha ? 108 : 40, stride = alpha ? w * 4 : (w * 3 + 3) & ~3
  const size = 14 + hs + stride * h
  const out = new Uint8Array(size), dv = new DataView(out.buffer)
  out[0] = 0x42; out[1] = 0x4D; dv.setUint32(2, size, true); dv.setUint32(10, 14 + hs, true)
  dv.setUint32(14, hs, true); dv.setInt32(18, w, true); dv.setInt32(22, h, true); dv.setUint16(26, 1, true); dv.setUint16(28, bpp, true)
  dv.setUint32(34, stride * h, true); dv.setInt32(38, 2835, true); dv.setInt32(42, 2835, true)
  if (alpha) { dv.setUint32(30, 3, true); dv.setUint32(54, 0xFF0000, true); dv.setUint32(58, 0xFF00, true); dv.setUint32(62, 0xFF, true); dv.setUint32(66, 0xFF000000, true); dv.setUint32(70, 0x73524742, true) }
  for (let y = 0; y < h; y++) {
    let o = 14 + hs + (h - 1 - y) * stride
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
      out[o++] = data[i + 2]; out[o++] = data[i + 1]; out[o++] = data[i]
      if (alpha) out[o++] = data[i + 3]
    }
  }
  return out
}

// ---------------------------------------------------------------- TIFF (write)
/** Baseline TIFF, one page per raster. opts: { compression: 'deflate' | 'none', gray: boolean } */
export async function encodeTiff(pages, { compression = 'deflate', gray = false } = {}) {
  const parts = [], le = new Uint8Array([0x49, 0x49, 0x2A, 0, 8, 0, 0, 0])
  parts.push(le)
  let off = 8
  const push = (u8) => { parts.push(u8); off += u8.length; if (off & 1) { parts.push(new Uint8Array(1)); off++ } }
  let prevIfdPtr = 4
  const patch = (pos, val) => { // patch a 4-byte value that was already pushed
    let acc = 0
    for (const p of parts) { if (pos < acc + p.length) { new DataView(p.buffer, p.byteOffset, p.length).setUint32(pos - acc, val, true); return } acc += p.length }
  }
  for await (const page of pages) {
    const { width: w, height: h, data } = page
    const alpha = !gray && hasAlpha(page), spp = gray ? 1 : alpha ? 4 : 3
    const rowBytes = w * spp
    const rps = Math.max(1, Math.min(h, Math.floor(262144 / rowBytes)))
    const strips = []
    for (let y0 = 0; y0 < h; y0 += rps) {
      const rows = Math.min(rps, h - y0), buf = new Uint8Array(rows * rowBytes)
      for (let y = 0; y < rows; y++) {
        let o = y * rowBytes
        for (let x = 0, i = (y0 + y) * w * 4; x < w; x++, i += 4) {
          if (gray) { buf[o++] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) }
          else { buf[o++] = data[i]; buf[o++] = data[i + 1]; buf[o++] = data[i + 2]; if (alpha) buf[o++] = data[i + 3] }
        }
      }
      if (compression === 'deflate') {
        for (let y = rows - 1; y >= 0; y--) for (let k = rowBytes - 1; k >= spp; k--) buf[y * rowBytes + k] = (buf[y * rowBytes + k] - buf[y * rowBytes + k - spp]) & 255
        strips.push(await deflate(buf))
      } else strips.push(buf)
    }
    const offsets = [], counts = []
    for (const s of strips) { offsets.push(off); counts.push(s.length); push(s) }
    // out-of-line values
    const bps = new Uint8Array(spp * 2); for (let i = 0; i < spp; i++) bps[i * 2] = 8
    const bpsOff = off; if (spp > 2) push(bps)
    const offArr = new Uint8Array(strips.length * 4), cntArr = new Uint8Array(strips.length * 4)
    const odv = new DataView(offArr.buffer), cdv = new DataView(cntArr.buffer)
    strips.forEach((_, i) => { odv.setUint32(i * 4, offsets[i], true); cdv.setUint32(i * 4, counts[i], true) })
    const offArrOff = off; if (strips.length > 1) push(offArr)
    const cntArrOff = off; if (strips.length > 1) push(cntArr)
    const resOff = off; const res = new Uint8Array(16); const rdv = new DataView(res.buffer); rdv.setUint32(0, 72, true); rdv.setUint32(4, 1, true); rdv.setUint32(8, 72, true); rdv.setUint32(12, 1, true); push(res)
    const tags = [] // [tag, type, count, value]
    tags.push([254, 4, 1, 0], [256, 4, 1, w], [257, 4, 1, h])
    tags.push([258, 3, spp, spp > 2 ? bpsOff : 8])
    tags.push([259, 3, 1, compression === 'deflate' ? 8 : 1], [262, 3, 1, gray ? 1 : 2])
    tags.push([273, 4, strips.length, strips.length > 1 ? offArrOff : offsets[0]], [277, 3, 1, spp], [278, 4, 1, rps], [279, 4, strips.length, strips.length > 1 ? cntArrOff : counts[0]])
    tags.push([282, 5, 1, resOff], [283, 5, 1, resOff + 8], [284, 3, 1, 1], [296, 3, 1, 2])
    if (compression === 'deflate') tags.push([317, 3, 1, 2])
    if (alpha) tags.push([338, 3, 1, 2])
    tags.sort((a, b) => a[0] - b[0])
    const ifd = new Uint8Array(2 + tags.length * 12 + 4), idv = new DataView(ifd.buffer)
    idv.setUint16(0, tags.length, true)
    tags.forEach(([tag, type, count, value], i) => {
      const o = 2 + i * 12
      idv.setUint16(o, tag, true); idv.setUint16(o + 2, type, true); idv.setUint32(o + 4, count, true)
      if (type === 3 && count === 1) idv.setUint16(o + 8, value, true); else idv.setUint32(o + 8, value, true)
    })
    const ifdOff = off
    patch(prevIfdPtr, ifdOff)
    push(ifd)
    prevIfdPtr = ifdOff + 2 + tags.length * 12
  }
  return concat(parts)
}

// ---------------------------------------------------------------- MNG
/** First embedded PNG datastream of an MNG file, as a PNG file. */
export function mngFirstFrame(b) {
  const sig = [0x8A, 0x4D, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
  if (b.length < 20 || !sig.every((v, i) => b[i] === v)) fail('This is not an MNG animation.')
  let p = 8, start = -1, global = []
  while (p + 12 <= b.length) {
    const len = be32(b, p), type = ascii(b, p + 4, 4), end = p + 12 + len
    if (end > b.length) break
    if (type === 'IHDR' && start < 0) start = p
    if (start < 0 && (type === 'PLTE' || type === 'tRNS' || type === 'gAMA' || type === 'sRGB')) global.push(b.subarray(p, end))
    if (type === 'IEND' && start >= 0) {
      const png = b.subarray(start, end)
      const hasPlte = (() => { let q = 0; while (q + 12 <= png.length) { const t = ascii(png, q + 4, 4); if (t === 'PLTE') return true; q += 12 + be32(png, q) } return false })()
      const pre = hasPlte ? [] : global.filter((g) => ascii(g, 4, 4) === 'PLTE' || ascii(g, 4, 4) === 'tRNS')
      if (pre.length) { // insert the global palette right after IHDR
        const ihdrEnd = 12 + be32(png, 0)
        return concat([new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), png.subarray(0, ihdrEnd), ...pre, png.subarray(ihdrEnd)])
      }
      return concat([new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), png])
    }
    p = end
  }
  fail('This MNG has no PNG image inside it that can be read. Only MNG files made of PNG frames work.')
}

export { be16, be32, u16, u32, ascii }
