// Shared GDI drawing state for the EMF and WMF readers. A Player holds the device-context state (pens, brushes, fonts, clip, transform)
// and turns drawing calls into items of the shared vector model (packs/corel/_model.js): paths, text and images, in points, y down.
import { I, mul, apply, mapPath, meanScale, rectPath, ellipsePath, pathBBox, hex } from '../corel/_model.js'

export const KAPPA = 0.5522847498307936
const TAU = Math.PI * 2
const u16 = (u8, o) => u8[o] | (u8[o + 1] << 8)
const u32 = (u8, o) => (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0
const i32 = (u8, o) => u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)
const i16 = (u8, o) => (u16(u8, o) << 16) >> 16
export { u16, u32, i32, i16 }

/** COLORREF (0x00BBGGRR) to '#rrggbb'. */
export const colorRef = (c) => hex(c & 255, (c >> 8) & 255, (c >> 16) & 255)

// ---------- DIB decoding ----------
const RLE = (src, off, end, w, h, four) => {
  const out = new Uint8Array(w * h)
  let x = 0, y = 0, i = off
  const put = (v) => { if (x < w && y < h) out[y * w + x] = v; x++ }
  while (i + 1 < end && y < h) {
    const n = src[i++], v = src[i++]
    if (n) {
      for (let k = 0; k < n; k++) put(four ? (k & 1 ? v & 15 : v >> 4) : v)
    } else if (v === 0) { x = 0; y++ } else if (v === 1) break
    else if (v === 2) { x += src[i++]; y += src[i++] } else {
      for (let k = 0; k < v; k++) {
        if (four) { const b = src[i + (k >> 1)]; put(k & 1 ? b & 15 : b >> 4) } else put(src[i + k])
      }
      const bytes = four ? (v + 1) >> 1 : v
      i += bytes + (bytes & 1)
    }
  }
  return out
}

/**
 * Decode a device-independent bitmap (header and optional colour table at offBmi, pixels at offBits) into top-down RGBA.
 * Returns {w, h, rgba, bottomUp, alpha} or {w, h, bytes, mime} for embedded JPEG and PNG data, or null when it cannot be read.
 */
export function decodeDib(u8, offBmi, cbBmi, offBits, cbBits, { useAlpha = false } = {}) {
  if (offBmi + 12 > u8.length) return null
  const hs = u32(u8, offBmi)
  let w, h, bpp, comp = 0, used = 0
  if (hs === 12) { w = u16(u8, offBmi + 4); h = u16(u8, offBmi + 6); bpp = u16(u8, offBmi + 10) } else if (hs >= 40) {
    w = i32(u8, offBmi + 4); h = i32(u8, offBmi + 8); bpp = u16(u8, offBmi + 14); comp = u32(u8, offBmi + 16); used = u32(u8, offBmi + 32)
  } else return null
  const bottomUp = h > 0
  h = Math.abs(h)
  if (!(w > 0 && h > 0) || w * h > 120e6) return null
  const end = Math.min(u8.length, offBits + cbBits || u8.length)
  if (comp === 4 || comp === 5) return { w, h, bytes: u8.subarray(offBits, end), mime: comp === 4 ? 'image/jpeg' : 'image/png' }
  let masks = null, palOff = offBmi + hs
  if ((comp === 3 || comp === 6) && hs === 40) { masks = [u32(u8, offBmi + 40), u32(u8, offBmi + 44), u32(u8, offBmi + 48), comp === 6 ? u32(u8, offBmi + 52) : 0]; palOff += 12 } else if (hs >= 52 && comp === 3) masks = [u32(u8, offBmi + 40), u32(u8, offBmi + 44), u32(u8, offBmi + 48), hs >= 56 ? u32(u8, offBmi + 52) : 0]
  const nPal = bpp <= 8 ? used || 1 << bpp : 0
  const pal = []
  const entry = hs === 12 ? 3 : 4
  for (let k = 0; k < nPal; k++) { const o = palOff + k * entry; pal.push(o + 2 < u8.length ? [u8[o + 2], u8[o + 1], u8[o]] : [0, 0, 0]) }
  const rgba = new Uint8ClampedArray(w * h * 4)
  const stride = (((w * bpp + 31) >> 5) << 2)
  let idx = null
  if (comp === 1 || comp === 2) idx = RLE(u8, offBits, end, w, h, comp === 2)
  let alphaSeen = false
  const shiftOf = (m) => { if (!m) return null; let s = 0; while (!((m >>> s) & 1)) s++; let b = 0; while ((m >>> (s + b)) & 1) b++; return [s, b, m] }
  const mk = masks ? masks.map(shiftOf) : null
  for (let y = 0; y < h; y++) {
    const sy = bottomUp ? h - 1 - y : y
    const row = offBits + sy * stride
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      let r = 0, g = 0, b = 0, a = 255
      if (idx) { const c = pal[idx[sy * w + x]] || [0, 0, 0]; r = c[0]; g = c[1]; b = c[2] } else if (bpp === 24) {
        const p = row + x * 3
        b = u8[p]; g = u8[p + 1]; r = u8[p + 2]
      } else if (bpp === 32) {
        const p = row + x * 4
        if (mk) {
          const v = u32(u8, p), ch = (m) => (m ? Math.round((((v & m[2]) >>> m[0]) * 255) / ((1 << m[1]) - 1 || 1)) : 255)
          r = ch(mk[0]); g = ch(mk[1]); b = ch(mk[2]); a = mk[3] ? ch(mk[3]) : 255
        } else { b = u8[p]; g = u8[p + 1]; r = u8[p + 2]; a = u8[p + 3] }
        if (a) alphaSeen = true
      } else if (bpp === 16) {
        const v = u16(u8, row + x * 2)
        if (mk) { const ch = (m) => (m ? Math.round((((v & m[2]) >>> m[0]) * 255) / ((1 << m[1]) - 1 || 1)) : 0); r = ch(mk[0]); g = ch(mk[1]); b = ch(mk[2]) } else { r = ((v >> 10) & 31) * 255 / 31; g = ((v >> 5) & 31) * 255 / 31; b = (v & 31) * 255 / 31 }
      } else if (bpp === 8) { const c = pal[u8[row + x]] || [0, 0, 0]; r = c[0]; g = c[1]; b = c[2] } else if (bpp === 4) {
        const v = u8[row + (x >> 1)]; const c = pal[x & 1 ? v & 15 : v >> 4] || [0, 0, 0]; r = c[0]; g = c[1]; b = c[2]
      } else if (bpp === 1) { const c = pal[(u8[row + (x >> 3)] >> (7 - (x & 7))) & 1] || [0, 0, 0]; r = c[0]; g = c[1]; b = c[2] } else return null
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a
    }
  }
  // 32-bit DIBs from GDI carry no alpha: treat them as opaque unless the caller knows the alpha is real
  if (bpp === 32 && !(useAlpha && alphaSeen)) for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255
  return { w, h, rgba, bottomUp }
}

/** Decode a packed DIB (header, colour table, pixels in one block) that runs from `off` to `end`. */
export function decodePackedDib(u8, off, end, opts) {
  if (off + 12 > end) return null
  const hs = u32(u8, off)
  let skip = hs
  if (hs >= 40) {
    const bpp = u16(u8, off + 14), comp = u32(u8, off + 16), used = u32(u8, off + 32)
    if (bpp <= 8) skip += (used || 1 << bpp) * 4
    else if ((comp === 3 || comp === 6) && hs === 40) skip += comp === 6 ? 16 : 12
    else if (used) skip += used * 4
  } else if (hs === 12) { const bpp = u16(u8, off + 10); if (bpp <= 8) skip += (1 << bpp) * 3 } else return null
  return decodeDib(u8.subarray(0, end), off, skip, off + skip, end - off - skip, opts)
}

const bytesB64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s) }
/** Decoded DIB to an image href (PNG data URL). */
export async function dibHref(d) {
  if (d.bytes) return `data:${d.mime};base64,${bytesB64(d.bytes)}`
  const { encodePng } = await import('../corel/_psin.js')
  return `data:image/png;base64,${bytesB64(await encodePng(d.w, d.h, new Uint8Array(d.rgba.buffer), 4))}`
}
/** Average colour of a decoded DIB (used where a pattern brush is approximated by one colour). */
export function avgColor(d) {
  if (!d?.rgba) return '#808080'
  let r = 0, g = 0, b = 0, n = 0
  const step = Math.max(1, Math.floor((d.w * d.h) / 2000)) * 4
  for (let i = 0; i < d.rgba.length; i += step) { r += d.rgba[i]; g += d.rgba[i + 1]; b += d.rgba[i + 2]; n++ }
  return n ? hex(r / n, g / n, b / n) : '#808080'
}

// ---------- fonts ----------
const CHARSET_LABEL = { 128: 'shift_jis', 129: 'euc-kr', 134: 'gbk', 136: 'big5', 130: 'euc-kr', 161: 'windows-1253', 162: 'windows-1254', 177: 'windows-1255', 178: 'windows-1256', 186: 'windows-1257', 204: 'windows-1251', 238: 'windows-1250', 222: 'windows-874', 163: 'windows-1258' }
export function decodeAnsi(bytes, charset) {
  try { return new TextDecoder(CHARSET_LABEL[charset] || 'windows-1252').decode(bytes) } catch { return new TextDecoder('windows-1252').decode(bytes) }
}
const STOCK_FONT = { family: 'Arial', h: -12, w: 0, esc: 0, bold: false, italic: false, underline: false, strike: false, charset: 0 }
const SYMBOLISH = /^(symbol|wingdings|webdings|marlett)/i

let measureCtx
function measure(str, family, size, bold, italic) {
  try {
    measureCtx ||= (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(4, 4) : document.createElement('canvas')).getContext('2d')
    measureCtx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${Math.max(1, size)}px "${family}", sans-serif`
    return measureCtx.measureText(str).width
  } catch { return str.length * size * 0.55 }
}

// dash patterns: cosmetic and plain pens count device pixels, geometric pens count pen widths
const DASH_PX = { 1: [18, 6], 2: [3, 3], 3: [9, 6, 3, 6], 4: [9, 3, 3, 3, 3, 3] }
const DASH_W = { 1: [3, 1], 2: [1, 1], 3: [3, 1, 1, 1], 4: [3, 1, 1, 1, 1, 1] }
const STOCK_BRUSH = { 0: '#ffffff', 1: '#c0c0c0', 2: '#808080', 3: '#404040', 4: '#000000' }

export class Player {
  /** pxPt: points per device pixel (width of a hairline). */
  constructor({ pxPt = 0.75 } = {}) {
    this.items = []
    this.warnings = new Set()
    this.pxPt = pxPt
    this.stack = []
    this.s = {
      ctm: I, pen: { kind: 'solid', w: 0, color: '#000000', cap: 1, join: 1, dash: null, miter: 10, cosmetic: true }, brush: { kind: 'solid', color: '#ffffff' },
      font: STOCK_FONT, textColor: '#000000', bkColor: '#ffffff', bkMode: 2, evenodd: true, textAlign: 0, arcCCW: true, clips: [], dcBrush: '#ffffff', dcPen: '#000000', miter: 10,
    }
    this.pos = [0, 0]
    this.path = null // array of absolute commands in page points while a path bracket is open
    this.pathStart = null
    this.pending = [] // promises for images
  }

  warn(msg) { this.warnings.add(msg) }
  save() { this.stack.push({ s: { ...this.s, clips: [...this.s.clips] }, pos: [...this.pos] }) }
  restore(n = 1) {
    // n > 0: pop that many; n < 0: relative (-1 is the most recent), as in RestoreDC
    let k = n < 0 ? -n : this.stack.length - n + 1
    k = Math.min(k, this.stack.length)
    let last = null
    while (k-- > 0) last = this.stack.pop()
    if (last) { this.s = last.s; this.pos = last.pos }
  }
  get scale() { return meanScale(this.s.ctm) }
  P(x, y) { return apply(this.s.ctm, x, y) }

  // ----- pens and brushes -----
  /** Pen from GDI style bits. style & 15: 0 solid 1 dash 2 dot 3 dashdot 4 dashdotdot 5 null 6 insideframe 7 userstyle. */
  makePen({ style, width, color, user, geometric, cosmetic }) {
    const kind = (style & 15) === 5 ? 'none' : 'solid'
    const base = style & 15
    const cap = (style & 0xf00) === 0x100 ? 2 : (style & 0xf00) === 0x200 ? 0 : 1
    const join = (style & 0xf000) === 0x1000 ? 2 : (style & 0xf000) === 0x2000 ? 0 : 1
    // a plain CreatePen pen wider than one pixel is always solid
    const plainWide = !geometric && !cosmetic && width > 1
    const dash = base === 7 && user?.length ? user : plainWide ? null : (geometric ? DASH_W : DASH_PX)[base] || null
    return { kind, w: width, color, cap: geometric ? cap : 1, join: geometric ? join : 1, dash, dashUnit: base === 7 ? 'logical' : geometric ? 'w' : 'px', cosmetic: !!cosmetic }
  }
  penWidthPt(pen) { return pen.cosmetic ? this.pxPt : Math.max(pen.w * this.scale, this.pxPt) }

  // ----- emitting -----
  _clip() { return this.s.clips.length ? { clip: this.s.clips.map((c) => ({ d: c.d, rule: c.rule })) } : null }
  _fillColor() { const b = this.s.brush; return b.kind === 'solid' ? b.color : b.kind === 'color' ? b.color : null }
  /** Emit a shape. d: commands in logical coordinates. closed shapes may be filled; open ones are only stroked. */
  shape(d, { fill = true, stroke = true } = {}) {
    if (!d.length) return
    const dd = mapPath(d, this.s.ctm)
    if (this.path) { this._appendPath(dd); return }
    const f = fill ? this._fillColor() : null
    const pen = this.s.pen
    const st = stroke && pen.kind !== 'none'
    if (!f && !st) return
    const w = st ? this.penWidthPt(pen) : 0
    const it = { t: 'path', d: dd, fill: f, rule: this.s.evenodd ? 'evenodd' : 'nonzero', stroke: st ? pen.color : null, strokeWidth: w }
    if (st) {
      it.cap = pen.cap; it.join = pen.join
      if (pen.join === 0) it.miter = this.s.miter || 10
      if (pen.dash) { it.dash = this._dash(pen, w); if (it.dash.some((v) => !(v > 0))) it.dash = null; else it.cap = 0 } // caps would close the gaps
    }
    Object.assign(it, this._clip())
    this.items.push(it)
  }
  _dash(pen, w) {
    const k = pen.dashUnit === 'logical' ? this.scale : pen.dashUnit === 'w' ? w : this.pxPt
    return pen.dash.map((v) => v * k)
  }
  _appendPath(dd) {
    for (const c of dd) { if (c[0] === 'M') this.pathStart = [c[1], c[2]]; this.path.push(c) }
  }
  beginPath() { this.path = []; this.pathStart = null }
  endPath() { const p = this.path; this.path = null; this.lastPath = p || []; return this.lastPath }
  closeFigure() { if (this.path && this.path.length) this.path.push(['Z']) }
  /** fill and/or stroke the stored path (page points already). */
  paintPath(fill, stroke) {
    const d = this.lastPath
    if (!d?.length) return
    const f = fill ? this._fillColor() : null
    const pen = this.s.pen
    const st = stroke && pen.kind !== 'none'
    if (!f && !st) return
    const w = st ? this.penWidthPt(pen) : 0
    const it = { t: 'path', d, fill: f, rule: this.s.evenodd ? 'evenodd' : 'nonzero', stroke: st ? pen.color : null, strokeWidth: w }
    if (st) { it.cap = pen.cap; it.join = pen.join; if (pen.join === 0) it.miter = this.s.miter || 10; if (pen.dash) { it.dash = this._dash(pen, w); it.cap = 0 } }
    Object.assign(it, this._clip())
    this.items.push(it)
  }
  clipToPath(mode = 1) {
    const d = this.lastPath
    if (!d?.length) return
    this.applyClip([{ d, rule: this.s.evenodd ? 'evenodd' : 'nonzero' }], mode)
  }
  /** mode: 1 AND (intersect), 5 COPY (replace), others are approximated as AND with a note. */
  applyClip(parts, mode) {
    if (mode === 5) this.s.clips = []
    else if (mode !== 1) this.warn('Some clipping operations (union, exclude) were approximated.')
    for (const p of parts) this.s.clips.push(p)
  }
  clipRect(l, t, r, b, exclude = false) {
    if (exclude) { this.warn('Some clipping operations (union, exclude) were approximated.'); return }
    this.s.clips.push({ d: mapPath(rectPath(l, t, r - l, b - t), this.s.ctm), rule: 'nonzero' })
  }

  // ----- primitives (logical coordinates) -----
  moveTo(x, y) { this.pos = [x, y]; if (this.path) this._appendPath([['M', ...this.P(x, y)]]) }
  lineTo(x, y) {
    if (this.path) { if (!this.path.length) this.path.push(['M', ...this.P(...this.pos)]); this.path.push(['L', ...this.P(x, y)]) } else this.shape([['M', this.pos[0], this.pos[1]], ['L', x, y]], { fill: false })
    this.pos = [x, y]
  }
  poly(pts, { closed, fill }) {
    if (pts.length < 1) return
    const d = pts.map((p, i) => [i ? 'L' : 'M', p[0], p[1]])
    if (closed) d.push(['Z'])
    this.shape(d, { fill: closed && fill })
    if (!closed) this.pos = [...pts[pts.length - 1]]
  }
  polyBezier(pts, from) {
    // pts: from===null -> 1 + 3n points starting at pts[0]; else 3n points continuing from `from`
    const d = []
    let i = 0
    if (!from) { d.push(['M', pts[0][0], pts[0][1]]); i = 1 } else d.push(['M', from[0], from[1]])
    for (; i + 2 < pts.length; i += 3) d.push(['C', pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], pts[i + 2][0], pts[i + 2][1]])
    if (this.path) {
      const dd = mapPath(d, this.s.ctm)
      if (from && this.path.length) dd.shift() // continue the open figure
      else if (from) { /* start of figure at current point */ }
      for (const c of dd) { if (c[0] === 'M') this.pathStart = [c[1], c[2]]; this.path.push(c) }
    } else this.shape(d, { fill: false })
    this.pos = [...pts[pts.length - 1]]
  }
  rect(l, t, r, b) { this.shape(rectPath(Math.min(l, r), Math.min(t, b), Math.abs(r - l), Math.abs(b - t))) }
  roundRect(l, t, r, b, cw, ch) { this.shape(rectPath(Math.min(l, r), Math.min(t, b), Math.abs(r - l), Math.abs(b - t), Math.abs(cw) / 2, Math.abs(ch) / 2)) }
  ellipse(l, t, r, b) {
    const cx = (l + r) / 2, cy = (t + b) / 2
    this.shape(ellipsePath(cx, cy, Math.abs(r - l) / 2, Math.abs(b - t) / 2))
  }
  /** Elliptical arc as cubic commands (no move). t0 and sweep are ellipse parameters in logical space. */
  _arcCubics(cx, cy, rx, ry, t0, sweep) {
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9)), step = sweep / n, k = (4 / 3) * Math.tan(step / 4)
    const P = (t) => [cx + rx * Math.cos(t), cy + ry * Math.sin(t)]
    const D = (t) => [-rx * Math.sin(t), ry * Math.cos(t)]
    const out = []
    for (let i = 0; i < n; i++) {
      const a = t0 + i * step, b = a + step, p0 = P(a), p3 = P(b), d0 = D(a), d3 = D(b)
      out.push(['C', p0[0] + k * d0[0], p0[1] + k * d0[1], p3[0] - k * d3[0], p3[1] - k * d3[1], p3[0], p3[1]])
    }
    return out
  }
  /** Arc, pie or chord of the ellipse in box (l,t,r,b) from the ray through (sx,sy) to the ray through (ex,ey). kind: 'arc' | 'pie' | 'chord' | 'arcto'. */
  arc(l, t, r, b, sx, sy, ex, ey, kind) {
    const cx = (l + r) / 2, cy = (t + b) / 2, rx = Math.abs(r - l) / 2, ry = Math.abs(b - t) / 2
    if (!(rx > 0 && ry > 0)) return
    const ang = (x, y) => Math.atan2((y - cy) / ry, (x - cx) / rx)
    const t0 = ang(sx, sy)
    let t1 = ang(ex, ey)
    // the recorded arc direction is relative to the logical plane drawn with y down: counter-clockwise means the ellipse parameter decreases
    const increasing = !this.s.arcCCW
    let sweep = increasing ? t1 - t0 : t0 - t1
    sweep = ((sweep % TAU) + TAU) % TAU
    if (sweep < 1e-9) sweep = TAU
    if (!increasing) sweep = -sweep
    const start = [cx + rx * Math.cos(t0), cy + ry * Math.sin(t0)]
    const d = []
    if (kind === 'arcto') d.push(['M', this.pos[0], this.pos[1]], ['L', start[0], start[1]])
    else d.push(['M', start[0], start[1]])
    d.push(...this._arcCubics(cx, cy, rx, ry, t0, sweep))
    const end = [cx + rx * Math.cos(t0 + sweep), cy + ry * Math.sin(t0 + sweep)]
    if (kind === 'pie') { d.push(['L', cx, cy], ['Z']) } else if (kind === 'chord') d.push(['Z'])
    this.shape(d, { fill: kind === 'pie' || kind === 'chord' })
    if (kind === 'arcto') this.pos = end
  }
  angleArc(cx, cy, r, startDeg, sweepDeg) {
    // angles run counter-clockwise on screen when y is down: x = cx + r cos a, y = cy - r sin a
    const a0 = (startDeg * Math.PI) / 180, sw = (sweepDeg * Math.PI) / 180
    const sgn = this.s.arcCCW ? -1 : 1
    const d = [['M', this.pos[0], this.pos[1]], ['L', cx + r * Math.cos(a0), cy + sgn * r * Math.sin(a0)]]
    const segs = this._arcCubics(cx, cy, r, r, sgn * a0, sgn * sw)
    d.push(...segs)
    this.shape(d, { fill: false })
    const e = a0 + sw
    this.pos = [cx + r * Math.cos(e), cy + sgn * r * Math.sin(e)]
  }

  // ----- text -----
  /**
   * Draw a string. (x, y) is the reference point in logical units, dx the per-character advances in logical units (or null),
   * opaque the background rectangle [l,t,r,b] (logical) to fill first.
   */
  text(str, x, y, { dx = null, opaque = null, rotation = null } = {}) {
    if (this.path) { this.warn('Text inside a path was skipped.'); return }
    const s = this.s, f = s.font
    if (opaque) {
      const keep = s.brush, keepPen = s.pen
      s.brush = { kind: 'solid', color: s.bkColor }; s.pen = { ...s.pen, kind: 'none' }
      this.rect(opaque[0], opaque[1], opaque[2], opaque[3])
      s.brush = keep; s.pen = keepPen
    }
    if (!str || !str.trim()) { if (s.textAlign & 1 && dx) this.pos[0] += dx.reduce((a, b) => a + b, 0); return }
    const sc = this.scale
    const emLog = f.h < 0 ? -f.h : f.h > 0 ? f.h / 1.12 : 12
    const size = emLog * sc
    if (!(size > 0.05)) return
    const family = f.family || 'Arial'
    const adv = dx ? dx.reduce((a, b) => a + b, 0) * sc : measure(str, family, size, f.bold, f.italic)
    const al = s.textAlign
    const hx = al & 6 // 0 left, 2 right, 6 center
    const vy = al & 24 // 0 top, 8 bottom, 24 baseline
    const ref = this.P(x, y)
    // the escapement is counter-clockwise in the logical plane drawn with y down; the base line then goes through the transform
    const e = ((rotation ?? f.esc) / 10) * (Math.PI / 180), c = s.ctm
    const th = Math.atan2(c[1] * Math.cos(e) - c[3] * Math.sin(e), c[0] * Math.cos(e) - c[2] * Math.sin(e))
    const co = Math.cos(th), si = Math.sin(th)
    const ox = hx === 6 ? -adv / 2 : hx === 2 ? -adv : 0
    const oy = vy === 0 ? size * 0.905 : vy === 8 ? -size * 0.212 : 0
    const m = [co, si, -si, co, ref[0] + co * ox - si * oy, ref[1] + si * ox + co * oy]
    const fam = family.replace(/^@/, '')
    const it = { t: 'text', str, family: SYMBOLISH.test(fam) ? 'Arial' : fam, size, bold: f.bold, italic: f.italic, fill: s.textColor, m }
    Object.assign(it, this._clip())
    this.items.push(it)
    if (al & 1) this.pos = [this.pos[0] + (dx ? dx.reduce((a, b) => a + b, 0) : adv / sc), this.pos[1]]
    if (f.underline || f.strike) {
      const w = adv, thick = Math.max(size * 0.06, 0.2)
      const lineAt = (off) => {
        const p0 = [m[4] + -si * off, m[5] + co * off]
        return { t: 'path', d: [['M', p0[0] + 0, p0[1] + 0], ['L', p0[0] + co * w, p0[1] + si * w]], fill: null, stroke: s.textColor, strokeWidth: thick, ...this._clip() }
      }
      if (f.underline) this.items.push(lineAt(size * 0.12))
      if (f.strike) this.items.push(lineAt(-size * 0.3))
    }
  }

  // ----- images -----
  /** Place a decoded bitmap. dest rect (dx,dy,dw,dh) in logical units (negative sizes mirror); src rect in image pixels (top-down). */
  image(href, wImg, hImg, dest, src) {
    const [dx, dy, dw, dh] = dest
    if (!dw || !dh) return
    const [sx, sy, sw, sh] = src && src[2] > 0 && src[3] > 0 ? src : [0, 0, wImg, hImg]
    const kx = dw / sw, ky = dh / sh
    const L = [wImg * kx, 0, 0, hImg * ky, dx - sx * kx, dy - sy * ky]
    const m = mul(this.s.ctm, L)
    const it = { t: 'image', href, w: wImg, h: hImg, m, opacity: 1 }
    const partial = sx > 0 || sy > 0 || sx + sw < wImg - 0.5 || sy + sh < hImg - 0.5
    const clips = this._clip()?.clip ? [...this._clip().clip] : []
    if (partial) clips.push({ d: mapPath(rectPath(Math.min(dx, dx + dw), Math.min(dy, dy + dh), Math.abs(dw), Math.abs(dh)), this.s.ctm), rule: 'nonzero' })
    if (clips.length) it.clip = clips
    this.items.push(it)
  }
}

export { rectPath, ellipsePath, pathBBox, I, mul }
export const stockBrushColor = (n) => STOCK_BRUSH[n]
