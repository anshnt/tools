// WMF reader: Windows metafile bytes (with or without the placeable header) -> the shared vector model. Written from the public record layouts.
// Handles lines, polygons, rectangles, ellipses, arcs, pies, chords, text with fonts, pens, brushes, bitmaps, clipping by rectangle and the
// window origin and extent. Page size comes from the placeable header; without one the window extent is used (1 unit = 1/96 inch).
import { MM } from '../corel/_model.js'
import { Player, u16, u32, i16, colorRef, decodePackedDib, dibHref, avgColor, decodeAnsi } from './_gdi.js'

/** Placeable header key 0x9AC6CDD7 or a plain header (type 1 or 2, header size 9). */
export function isWmf(b) {
  if (b.length < 18) return false
  if (u32(b, 0) === 0x9ac6cdd7) return true
  return (u16(b, 0) === 1 || u16(b, 0) === 2) && u16(b, 2) === 9 && (u16(b, 4) === 0x300 || u16(b, 4) === 0x100)
}

export async function wmfToDoc(bytes, { onProgress, signal } = {}) {
  const u8 = bytes
  if (!isWmf(u8)) throw new Error('This does not look like a WMF file.')
  const placeable = u32(u8, 0) === 0x9ac6cdd7
  const start = placeable ? 22 : 0
  const bbox = placeable ? [i16(u8, 6), i16(u8, 8), i16(u8, 10), i16(u8, 12)] : null
  const inch = placeable ? u16(u8, 14) || 1440 : 96
  const hdrWords = u16(u8, start + 2)
  const first = start + hdrWords * 2
  const total = u8.length

  // first pass: window origin and extent (the first ones set), so the page can be sized before drawing
  let org = null, ext = null
  for (let o = first; o + 6 <= total;) {
    const sz = u32(u8, o) * 2, fn = u16(u8, o + 4)
    if (sz < 6 || o + sz > total) break
    if (fn === 0x020b && !org) org = [i16(u8, o + 8), i16(u8, o + 6)]
    else if (fn === 0x020c && !ext) ext = [i16(u8, o + 8), i16(u8, o + 6)]
    if (fn === 0) break
    o += sz
  }
  const warnings = []
  let pw, ph, wOrg, wExt
  if (placeable && bbox[2] !== bbox[0] && bbox[3] !== bbox[1]) {
    pw = (Math.abs(bbox[2] - bbox[0]) / inch) * 72; ph = (Math.abs(bbox[3] - bbox[1]) / inch) * 72
    wOrg = org || [Math.min(bbox[0], bbox[2]), Math.min(bbox[1], bbox[3])]
    wExt = ext || [bbox[2] - bbox[0], bbox[3] - bbox[1]]
  } else if (ext && ext[0] && ext[1]) {
    wOrg = org || [0, 0]; wExt = ext
    let k = 0.75
    const big = Math.max(Math.abs(ext[0]), Math.abs(ext[1]))
    if (big * k > 3000) k = 800 / big
    pw = Math.abs(ext[0]) * k; ph = Math.abs(ext[1]) * k
    warnings.push('This WMF has no size information, so the page size was estimated.')
  } else throw Object.assign(new Error('This WMF has no usable size information.'), { userMessage: 'This WMF has no usable size information.' })
  const P = new Player({ pxPt: 0.75 })
  const setMap = () => {
    const kx = wExt[0] ? pw / wExt[0] : 1, ky = wExt[1] ? ph / wExt[1] : 1
    P.s.ctm = [kx, 0, 0, ky, -wOrg[0] * kx + (kx < 0 ? pw : 0), -wOrg[1] * ky + (ky < 0 ? ph : 0)]
  }
  setMap()
  const saveStack = []
  const origSave = P.save.bind(P), origRestore = P.restore.bind(P)
  P.save = () => { origSave(); saveStack.push([wOrg, wExt]) }
  P.restore = (n) => {
    const before = P.stack.length
    origRestore(n)
    let m = null
    for (let i = before - P.stack.length; i > 0; i--) m = saveStack.pop()
    if (m) { [wOrg, wExt] = m; setMap() }
  }

  // objects take the lowest free slot
  const objs = []
  const addObj = (o) => { let i = objs.findIndex((x) => x === undefined || x === null); if (i < 0) i = objs.length; objs[i] = o }
  const select = (i) => {
    const o = objs[i]
    if (!o) return
    if (o.type === 'pen') P.s.pen = o.v
    else if (o.type === 'brush') P.s.brush = o.v
    else if (o.type === 'font') P.s.font = o.v
  }
  const unknown = new Map()
  let n = 0
  const withBrush = (color, fn) => { const kb = P.s.brush, kp = P.s.pen; P.s.brush = { kind: 'solid', color }; P.s.pen = { ...kp, kind: 'none' }; fn(); P.s.brush = kb; P.s.pen = kp }

  for (let o = first; o + 6 <= total;) {
    const sz = u32(u8, o) * 2, fn = u16(u8, o + 4)
    if (sz < 6 || o + sz > total) break
    n++
    if (n % 400 === 0) { onProgress?.(o / total); if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' }); await new Promise((r) => setTimeout(r, 0)) }
    const end = o + sz
    const w = (i) => i16(u8, o + 6 + i * 2) // i-th signed parameter word
    const uw = (i) => u16(u8, o + 6 + i * 2)
    const pts = (at, cnt) => { const a = []; for (let i = 0; i < cnt && o + 6 + (at + i * 2 + 1) * 2 < end + 2; i++) a.push([w(at + i * 2), w(at + i * 2 + 1)]); return a }
    switch (fn) {
      case 0x0000: o = total; continue
      case 0x001e: P.save(); break
      case 0x0127: P.restore(w(0)); break
      case 0x0102: P.s.bkMode = uw(0); break
      case 0x0106: P.s.evenodd = uw(0) === 1; break
      case 0x0201: P.s.bkColor = colorRef(u32(u8, o + 6)); break
      case 0x0209: P.s.textColor = colorRef(u32(u8, o + 6)); break
      case 0x012e: P.s.textAlign = uw(0); break
      case 0x020b: wOrg = [w(1), w(0)]; setMap(); break
      case 0x020c: wExt = [w(1), w(0)]; setMap(); break
      case 0x020f: wOrg = [wOrg[0] + w(1), wOrg[1] + w(0)]; setMap(); break
      case 0x0410: if (w(0) && w(2)) { wExt = [(wExt[0] * w(3)) / w(2), (wExt[1] * w(1)) / w(0)]; setMap() } break
      case 0x0213: P.lineTo(w(1), w(0)); break
      case 0x0214: P.moveTo(w(1), w(0)); break
      case 0x0416: P.clipRect(w(3), w(2), w(1), w(0)); break
      case 0x0415: P.clipRect(w(3), w(2), w(1), w(0), true); break
      case 0x0418: P.ellipse(w(3), w(2), w(1), w(0)); break
      case 0x041b: P.rect(w(3), w(2), w(1), w(0)); break
      case 0x061c: P.roundRect(w(5), w(4), w(3), w(2), w(1), w(0)); break
      case 0x0817: case 0x081a: case 0x0830:
        P.arc(w(7), w(6), w(5), w(4), w(3), w(2), w(1), w(0), fn === 0x0817 ? 'arc' : fn === 0x081a ? 'pie' : 'chord')
        break
      case 0x0324: { const c = uw(0); P.poly(pts(1, c), { closed: true, fill: true }); break }
      case 0x0325: { const c = uw(0); P.poly(pts(1, c), { closed: false }); break }
      case 0x0538: {
        const np = uw(0)
        const counts = []
        for (let i = 0; i < np; i++) counts.push(uw(1 + i))
        const all = pts(1 + np, counts.reduce((a, b) => a + b, 0))
        const d = []
        let k = 0
        for (const c of counts) { all.slice(k, k + c).forEach((p, i) => d.push([i ? 'L' : 'M', p[0], p[1]])); d.push(['Z']); k += c }
        P.shape(d, { fill: true })
        break
      }
      case 0x061d: { // PatBlt
        const rop = u32(u8, o + 6)
        if (rop === 0x00f00021) P.rect(w(5), w(4), w(5) + w(3), w(4) + w(2)) // keeps the pen; GDI paints with the brush only
        else if (rop === 0x42 || rop === 0xff0062) withBrush(rop === 0x42 ? '#000000' : '#ffffff', () => P.rect(w(5), w(4), w(5) + w(3), w(4) + w(2)))
        break
      }
      case 0x0521: { // TextOut
        const len = uw(0), off = o + 8
        const str = decodeAnsi(u8.subarray(off, off + len), P.s.font.charset)
        const at = off + ((len + 1) & ~1)
        const y = i16(u8, at), x = i16(u8, at + 2)
        P.text(str, P.s.textAlign & 1 ? P.pos[0] : x, P.s.textAlign & 1 ? P.pos[1] : y)
        break
      }
      case 0x0a32: { // ExtTextOut
        const y = w(0), x = w(1), len = uw(2), opts = uw(3)
        let at = o + 6 + 8
        let rc = null
        if (opts & 6) { rc = [w(4), w(5), w(6), w(7)]; at += 8 }
        const str = decodeAnsi(u8.subarray(at, at + len), P.s.font.charset)
        const dxAt = at + ((len + 1) & ~1)
        let dx = null
        if (dxAt + len * 2 <= end) { dx = []; for (let i = 0; i < len; i++) dx.push(i16(u8, dxAt + i * 2)) }
        P.text(str, P.s.textAlign & 1 ? P.pos[0] : x, P.s.textAlign & 1 ? P.pos[1] : y, { dx, opaque: opts & 2 && rc ? rc : null })
        break
      }
      case 0x02fa: { // CreatePenIndirect
        const st = uw(0)
        addObj({ type: 'pen', v: P.makePen({ style: st, width: w(1), color: colorRef(u32(u8, o + 12)), geometric: false, cosmetic: false }) })
        break
      }
      case 0x02fc: { // CreateBrushIndirect
        const st = uw(0), col = colorRef(u32(u8, o + 8))
        if (st === 2) P.warn('Hatched fills are drawn as solid fills.')
        addObj({ type: 'brush', v: st === 1 ? { kind: 'none' } : { kind: 'solid', color: col } })
        break
      }
      case 0x0142: { // DibCreatePatternBrush
        const d = decodePackedDib(u8, o + 10, end)
        P.warn('Pattern fills are drawn as one average colour.')
        addObj({ type: 'brush', v: { kind: 'solid', color: avgColor(d) } })
        break
      }
      case 0x02fb: { // CreateFontIndirect
        let name = ''
        for (let i = 0; i < 32 && u8[o + 24 + i]; i++) name += String.fromCharCode(u8[o + 24 + i])
        const charset = u8[o + 6 + 13]
        addObj({ type: 'font', v: { family: name || 'Arial', h: w(0), w: w(1), esc: w(2), bold: w(4) >= 600, italic: !!u8[o + 6 + 10], underline: !!u8[o + 6 + 11], strike: !!u8[o + 6 + 12], charset } })
        break
      }
      case 0x00f7: case 0x01f9: case 0x02fd: case 0x06fe: case 0x06ff: addObj({ type: 'other' }); break
      case 0x012d: select(uw(0)); break
      case 0x01f0: { const i = uw(0); if (i < objs.length) objs[i] = null; break }
      case 0x0b41: case 0x0f43: case 0x0940: case 0x0d33: {
        let dxy, sxy, dwh, swh, off
        const rop = u32(u8, o + 6)
        if (fn === 0x0b41) { // DibStretchBlt: rop, srcH, srcW, srcY, srcX, destH, destW, destY, destX
          swh = [w(3), w(2)]; sxy = [w(5), w(4)]; dwh = [w(7), w(6)]; dxy = [w(9), w(8)]; off = o + 6 + 20
          if (off >= end) { if (rop === 0x00f00021) P.rect(dxy[0], dxy[1], dxy[0] + dwh[0], dxy[1] + dwh[1]); break }
        } else if (fn === 0x0f43) { // StretchDIBits: rop, usage, srcH, srcW, srcY, srcX, destH, destW, destY, destX
          swh = [w(5), w(4)]; sxy = [w(7), w(6)]; dwh = [w(9), w(8)]; dxy = [w(11), w(10)]; off = o + 6 + 22
        } else if (fn === 0x0940) { // DibBitBlt: rop, srcY, srcX, height, width, destY, destX
          swh = [w(4), w(3)]; sxy = [w(6), w(5)]; dwh = [w(4), w(3)]; dxy = [w(8), w(7)]; off = o + 6 + 16
          if (off >= end) { if (rop === 0x00f00021) P.rect(dxy[0], dxy[1], dxy[0] + dwh[0], dxy[1] + dwh[1]); break }
        } else { // SetDIBitsToDevice: usage, scans, startScan, srcY, srcX, height, width, destY, destX
          swh = [w(6), w(5)]; sxy = [w(4), w(3)]; dwh = [w(6), w(5)]; dxy = [w(8), w(7)]; off = o + 6 + 18
        }
        const d = decodePackedDib(u8, off, end)
        if (!d) { P.warn('A bitmap in a format that cannot be read was skipped.'); break }
        const href = await dibHref(d)
        P.image(href, d.w, d.h, [dxy[0], dxy[1], dwh[0], dwh[1]], [sxy[0], Math.max(0, d.h - sxy[1] - swh[1]), Math.abs(swh[0]), Math.abs(swh[1])])
        break
      }
      case 0x0103: case 0x0104: case 0x0105: case 0x0107: case 0x0108: case 0x020a: case 0x020d: case 0x020e: case 0x0211: case 0x0412: case 0x0220: case 0x012c: case 0x0626: case 0x0231: case 0x0232: case 0x0234: case 0x0035: case 0x0037: case 0x0436: case 0x0419: case 0x0228: case 0x0525: break
      default: unknown.set(fn, (unknown.get(fn) || 0) + 1)
    }
    o = end
  }
  if (unknown.size) warnings.push(`${[...unknown.values()].reduce((a, b) => a + b, 0)} record(s) of an unsupported kind were skipped.`)
  if (!P.items.length) warnings.push('The metafile has no visible drawing records.')
  return { pages: [{ w: pw, h: ph, name: 'WMF', items: P.items }], warnings: [...new Set([...warnings, ...P.warnings])] }
}
