// EMF reader: Windows enhanced metafile bytes -> the shared vector model (packs/corel/_model.js). Written from the public record layouts.
// Handles the common GDI records: lines, polygons, beziers, paths, rectangles, ellipses, arcs, pies, text with fonts, solid pens and brushes,
// dashes, caps and joins, bitmaps, world transforms, window and viewport mapping, clipping by rectangle, path or region, save and restore.
// EMF+ files that carry their GDI records too (the usual dual mode) are read through those; EMF+-only files are reported as unsupported.
import { mul, mapPath, MM } from '../corel/_model.js'
import { Player, u16, u32, i32, i16, colorRef, decodeDib, dibHref, avgColor, decodeAnsi, stockBrushColor, rectPath } from './_gdi.js'

const MAPMODE = { 2: 0.1, 3: 0.01, 4: 0.254, 5: 0.0254, 6: 25.4 / 1440 } // mm per logical unit for the fixed mapping modes (y points up)

/** Is this the start of an EMF file? */
export const isEmf = (b) => b.length > 88 && u32(b, 0) === 1 && u32(b, 40) === 0x464d4520

export async function emfToDoc(bytes, { onProgress, signal } = {}) {
  const u8 = bytes
  if (!isEmf(u8)) throw new Error('This does not look like an EMF file.')
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const f32 = (o) => dv.getFloat32(o, true)
  const bounds = [i32(u8, 8), i32(u8, 12), i32(u8, 16), i32(u8, 20)]
  const frame = [i32(u8, 24), i32(u8, 28), i32(u8, 32), i32(u8, 36)] // 0.01 mm
  const nHandles = u16(u8, 56)
  const dev = [i32(u8, 72), i32(u8, 76)], mmSize = [i32(u8, 80), i32(u8, 84)]
  const mmPerPx = [dev[0] > 0 && mmSize[0] > 0 ? mmSize[0] / dev[0] : 0.2646, dev[1] > 0 && mmSize[1] > 0 ? mmSize[1] / dev[1] : 0.2646]
  const pxPerMm = [1 / mmPerPx[0], 1 / mmPerPx[1]]
  let pageW, pageH, ox, oy // page size in pt and the device pixel at the page's top-left corner
  if (frame[2] > frame[0] && frame[3] > frame[1]) {
    pageW = ((frame[2] - frame[0]) / 100) * MM; pageH = ((frame[3] - frame[1]) / 100) * MM
    ox = (frame[0] / 100) * pxPerMm[0]; oy = (frame[1] / 100) * pxPerMm[1]
  } else {
    pageW = (bounds[2] - bounds[0] + 1) * mmPerPx[0] * MM; pageH = (bounds[3] - bounds[1] + 1) * mmPerPx[1] * MM
    ox = bounds[0]; oy = bounds[1]
  }
  if (!(pageW > 0 && pageH > 0)) { pageW = 595; pageH = 842 }
  const kx = mmPerPx[0] * MM, ky = mmPerPx[1] * MM
  const pageMap = [kx, 0, 0, ky, -ox * kx, -oy * ky]
  const P = new Player({ pxPt: (kx + ky) / 2 })

  // ----- mapping state -----
  let mode = 1
  let wOrg = [0, 0], wExt = [1, 1], vOrg = [0, 0], vExt = [1, 1]
  let world = [1, 0, 0, 1, 0, 0]
  const recalc = () => {
    let sx = 1, sy = 1
    if (MAPMODE[mode]) { sx = pxPerMm[0] * MAPMODE[mode]; sy = -pxPerMm[1] * MAPMODE[mode] } else if (mode === 7 || mode === 8) {
      sx = wExt[0] ? vExt[0] / wExt[0] : 1; sy = wExt[1] ? vExt[1] / wExt[1] : 1
      if (mode === 7) { const s = Math.min(Math.abs(sx), Math.abs(sy)); sx = Math.sign(sx || 1) * s; sy = Math.sign(sy || 1) * s }
    }
    const dm = [sx, 0, 0, sy, vOrg[0] - wOrg[0] * sx, vOrg[1] - wOrg[1] * sy]
    P.s.ctm = mul(pageMap, mul(dm, world))
  }
  recalc()
  // the mapping state is part of the saved device context
  const saveStack = []
  const saveMap = () => ({ mode, wOrg, wExt, vOrg, vExt, world })
  const loadMap = (m) => { ({ mode, wOrg, wExt, vOrg, vExt, world } = m); recalc() }
  const origSave = P.save.bind(P), origRestore = P.restore.bind(P)
  P.save = () => { origSave(); saveStack.push(saveMap()) }
  P.restore = (n) => {
    const before = P.stack.length
    origRestore(n)
    const popped = before - P.stack.length
    let m = null
    for (let i = 0; i < popped; i++) m = saveStack.pop()
    if (m) loadMap(m)
  }

  // ----- objects -----
  const objs = new Array(Math.max(nHandles, 1) + 8).fill(null)
  const stockPen = (n) => (n === 6 ? { kind: 'solid', w: 0, color: '#ffffff', cap: 1, join: 1, dash: null, cosmetic: true } : n === 7 ? { kind: 'solid', w: 0, color: '#000000', cap: 1, join: 1, dash: null, cosmetic: true } : n === 8 ? { kind: 'none', w: 0, color: '#000000', cap: 1, join: 1, dash: null, cosmetic: true } : { kind: 'solid', w: 0, color: P.s.dcPen, cap: 1, join: 1, dash: null, cosmetic: true })
  const select = (h) => {
    if (h & 0x80000000) {
      const n = h & 0x7fffffff
      if (n <= 4) P.s.brush = { kind: 'solid', color: stockBrushColor(n) }
      else if (n === 5) P.s.brush = { kind: 'none' }
      else if (n === 18) P.s.brush = { kind: 'solid', color: P.s.dcBrush }
      else if (n === 6 || n === 7 || n === 8 || n === 19) P.s.pen = stockPen(n)
      else if (n >= 10 && n <= 17) P.s.font = { family: n === 10 || n === 11 || n === 16 ? 'Courier New' : 'Arial', h: -12, esc: 0, bold: false, italic: false, underline: false, strike: false, charset: 0 }
      return
    }
    const o = objs[h]
    if (!o) return
    if (o.type === 'pen') P.s.pen = o.v
    else if (o.type === 'brush') P.s.brush = o.v
    else if (o.type === 'font') P.s.font = o.v
  }

  const pts32 = (o, n) => { const a = []; for (let i = 0; i < n; i++) a.push([i32(u8, o + i * 8), i32(u8, o + i * 8 + 4)]); return a }
  const pts16 = (o, n) => { const a = []; for (let i = 0; i < n; i++) a.push([i16(u8, o + i * 4), i16(u8, o + i * 4 + 2)]); return a }
  const rect = (o) => [i32(u8, o), i32(u8, o + 4), i32(u8, o + 8), i32(u8, o + 12)]
  const unknown = new Map()
  let hasPlus = false, plusOnly = false

  let off = 0, n = 0
  const total = u8.length
  while (off + 8 <= total) {
    const type = u32(u8, off), size = u32(u8, off + 4)
    if (size < 8 || off + size > total) { if (off + size > total && n === 0) throw new Error('This EMF file is damaged.'); break }
    n++
    if (n % 400 === 0) { onProgress?.(off / total); if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' }); await new Promise((r) => setTimeout(r, 0)) }
    const o = off
    off += size
    if (type === 14) break
    const poly = (is16) => ({ n: u32(u8, o + 24), pts: (cnt, base = o + 28) => (is16 ? pts16(base, cnt) : pts32(base, cnt)) })
    switch (type) {
      case 1: break
      case 2: case 85: { const { n: c, pts } = poly(type === 85); if (c > 3) P.polyBezier(pts(c), null); break }
      case 3: case 86: { const { n: c, pts } = poly(type === 86); P.poly(pts(c), { closed: true, fill: true }); break }
      case 4: case 87: { const { n: c, pts } = poly(type === 87); P.poly(pts(c), { closed: false }); break }
      case 5: case 88: { const { n: c, pts } = poly(type === 88); P.polyBezier(pts(c), [...P.pos]); break }
      case 6: case 89: {
        const { n: c, pts } = poly(type === 89)
        const a = pts(c)
        P.poly([[...P.pos], ...a], { closed: false })
        break
      }
      case 7: case 8: case 90: case 91: {
        const is16 = type >= 90, np = u32(u8, o + 24), cnt = u32(u8, o + 28)
        const counts = []
        for (let i = 0; i < np; i++) counts.push(u32(u8, o + 32 + i * 4))
        const all = (is16 ? pts16 : pts32)(o + 32 + np * 4, cnt)
        const closed = type === 8 || type === 91
        let k = 0
        if (closed) {
          const d = []
          for (const c of counts) { all.slice(k, k + c).forEach((p, i) => d.push([i ? 'L' : 'M', p[0], p[1]])); d.push(['Z']); k += c }
          P.shape(d, { fill: true })
        } else for (const c of counts) { P.poly(all.slice(k, k + c), { closed: false }); k += c }
        break
      }
      case 56: case 92: {
        const is16 = type === 92, c = u32(u8, o + 24)
        const pts = (is16 ? pts16 : pts32)(o + 28, c)
        const tb = o + 28 + c * (is16 ? 4 : 8)
        const d = []
        let k = 0
        for (; k < c; k++) {
          const t = u8[tb + k]
          const kind = t & 6
          if (kind === 6) d.push(['M', pts[k][0], pts[k][1]])
          else if (kind === 2) d.push(['L', pts[k][0], pts[k][1]])
          else if (kind === 4 && k + 2 < c) { d.push(['C', pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], pts[k + 2][0], pts[k + 2][1]]); k += 2; if (u8[tb + k] & 1) d.push(['Z']); continue }
          if (t & 1) d.push(['Z'])
        }
        P.shape(d, { fill: false })
        break
      }
      case 9: wExt = [i32(u8, o + 8), i32(u8, o + 12)]; recalc(); break
      case 10: wOrg = [i32(u8, o + 8), i32(u8, o + 12)]; recalc(); break
      case 11: vExt = [i32(u8, o + 8), i32(u8, o + 12)]; recalc(); break
      case 12: vOrg = [i32(u8, o + 8), i32(u8, o + 12)]; recalc(); break
      case 17: mode = u32(u8, o + 8); recalc(); break
      case 18: P.s.bkMode = u32(u8, o + 8); break
      case 19: P.s.evenodd = u32(u8, o + 8) === 1; break
      case 22: P.s.textAlign = u32(u8, o + 8); break
      case 24: P.s.textColor = colorRef(u32(u8, o + 8)); break
      case 25: P.s.bkColor = colorRef(u32(u8, o + 8)); break
      case 27: P.moveTo(i32(u8, o + 8), i32(u8, o + 12)); break
      case 54: P.lineTo(i32(u8, o + 8), i32(u8, o + 12)); break
      case 29: { const r = rect(o + 8); P.clipRect(r[0], r[1], r[2], r[3], true); break }
      case 30: { const r = rect(o + 8); P.clipRect(r[0], r[1], r[2], r[3]); break }
      case 31: { const [a, b, c, d] = [i32(u8, o + 8), i32(u8, o + 12), i32(u8, o + 16), i32(u8, o + 20)]; if (b && d) vExt = [(vExt[0] * a) / b, (vExt[1] * c) / d]; recalc(); break }
      case 32: { const [a, b, c, d] = [i32(u8, o + 8), i32(u8, o + 12), i32(u8, o + 16), i32(u8, o + 20)]; if (b && d) wExt = [(wExt[0] * a) / b, (wExt[1] * c) / d]; recalc(); break }
      case 33: P.save(); break
      case 34: P.restore(i32(u8, o + 8)); break
      case 35: world = [f32(o + 8), f32(o + 12), f32(o + 16), f32(o + 20), f32(o + 24), f32(o + 28)]; recalc(); break
      case 36: {
        const x = [f32(o + 8), f32(o + 12), f32(o + 16), f32(o + 20), f32(o + 24), f32(o + 28)], md = u32(u8, o + 32)
        if (md === 1) world = [1, 0, 0, 1, 0, 0]; else if (md === 2) world = mul(world, x); else if (md === 3) world = mul(x, world); else if (md === 4) world = x
        recalc(); break
      }
      case 37: select(u32(u8, o + 8)); break
      case 38: {
        const st = u32(u8, o + 12), w = i32(u8, o + 16)
        objs[u32(u8, o + 8)] = { type: 'pen', v: P.makePen({ style: st, width: w, color: colorRef(u32(u8, o + 24)), geometric: false, cosmetic: false }) }
        break
      }
      case 95: {
        const st = u32(u8, o + 28), w = u32(u8, o + 32), bs = u32(u8, o + 36), ne = u32(u8, o + 48)
        const user = []
        for (let i = 0; i < ne && i < 16; i++) user.push(u32(u8, o + 52 + i * 4))
        const geometric = (st & 0x30000) === 0x10000
        const pen = P.makePen({ style: bs === 1 ? 5 : st, width: w, color: colorRef(u32(u8, o + 40)), user, geometric, cosmetic: !geometric })
        objs[u32(u8, o + 8)] = { type: 'pen', v: pen }
        break
      }
      case 39: {
        const style = u32(u8, o + 12), col = colorRef(u32(u8, o + 16))
        let b = { kind: 'solid', color: col }
        if (style === 1) b = { kind: 'none' }
        else if (style === 2) { b = { kind: 'solid', color: col }; P.warn('Hatched fills are drawn as solid fills.') } else if (style === 3 || style === 5 || style === 6) { b = { kind: 'solid', color: col } }
        objs[u32(u8, o + 8)] = { type: 'brush', v: b }
        break
      }
      case 93: case 94: {
        const d = decodeDib(u8, o + u32(u8, o + 16), u32(u8, o + 20), o + u32(u8, o + 24), u32(u8, o + 28))
        objs[u32(u8, o + 8)] = { type: 'brush', v: { kind: 'solid', color: avgColor(d) } }
        P.warn('Pattern fills are drawn as one average colour.')
        break
      }
      case 40: { const h = u32(u8, o + 8); if (h < objs.length) objs[h] = null; break }
      case 41: { const c = [i32(u8, o + 8), i32(u8, o + 12)], r = u32(u8, o + 16); P.angleArc(c[0], c[1], r, f32(o + 20), f32(o + 24)); break }
      case 42: { const r = rect(o + 8); P.ellipse(r[0], r[1], r[2], r[3]); break }
      case 43: { const r = rect(o + 8); P.rect(r[0], r[1], r[2], r[3]); break }
      case 44: { const r = rect(o + 8); P.roundRect(r[0], r[1], r[2], r[3], i32(u8, o + 24), i32(u8, o + 28)); break }
      case 45: case 46: case 47: case 55: {
        const r = rect(o + 8), s = [i32(u8, o + 24), i32(u8, o + 28)], e = [i32(u8, o + 32), i32(u8, o + 36)]
        P.arc(r[0], r[1], r[2], r[3], s[0], s[1], e[0], e[1], type === 45 ? 'arc' : type === 46 ? 'chord' : type === 47 ? 'pie' : 'arcto')
        break
      }
      case 57: P.s.arcCCW = u32(u8, o + 8) === 1; break
      case 58: P.s.miter = u32(u8, o + 8) || 10; break
      case 59: P.beginPath(); break
      case 60: P.endPath(); break
      case 61: P.closeFigure(); break
      case 62: P.paintPath(true, false); break
      case 63: P.paintPath(true, true); break
      case 64: P.paintPath(false, true); break
      case 67: P.clipToPath(u32(u8, o + 8)); break
      case 68: P.path = null; P.lastPath = []; break
      case 70: { // comment: EMF+ marker
        const id = u32(u8, o + 12)
        if (id === 0x2b464d45) { hasPlus = true; if (u16(u8, o + 16) === 0x4001) plusOnly = !(u16(u8, o + 18) & 1) }
        break
      }
      case 75: { // ExtSelectClipRgn
        const cb = u32(u8, o + 8), md = u32(u8, o + 12)
        if (!cb) { if (md === 5) P.s.clips = []; break }
        const cnt = u32(u8, o + 24)
        const d = []
        for (let i = 0; i < cnt && i < 20000; i++) { const r = rect(o + 48 + i * 16); d.push(...rectPath(r[0], r[1], r[2] - r[0], r[3] - r[1])) }
        if (d.length) P.applyClip([{ d: mapPath(d, P.s.ctm), rule: 'nonzero' }], md)
        break
      }
      case 72: case 73: case 74: case 71: P.warn('Region fills and frames were skipped.'); break
      case 76: case 77: case 114: case 116: {
        const dx = i32(u8, o + 24), dy = i32(u8, o + 28), dw = i32(u8, o + 32), dh = i32(u8, o + 36)
        const rop = u32(u8, o + 40)
        const offBmi = u32(u8, o + 84), cbBmi = u32(u8, o + 88), offBits = u32(u8, o + 92), cbBits = u32(u8, o + 96)
        if (!cbBmi) {
          if (rop === 0x00f00021) { const keep = P.s.pen; P.s.pen = { ...keep, kind: 'none' }; P.rect(dx, dy, dx + dw, dy + dh); P.s.pen = keep } else if (rop === 0x42 || rop === 0xff0062) {
            const keepB = P.s.brush, keep = P.s.pen
            P.s.brush = { kind: 'solid', color: rop === 0x42 ? '#000000' : '#ffffff' }; P.s.pen = { ...keep, kind: 'none' }
            P.rect(dx, dy, dx + dw, dy + dh); P.s.brush = keepB; P.s.pen = keep
          }
          break
        }
        const sx = i32(u8, o + 44), sy = i32(u8, o + 48)
        const stretch = type !== 76
        const cxS = stretch ? i32(u8, o + 100) : dw, cyS = stretch ? i32(u8, o + 104) : dh
        const alpha = type === 114 && (rop >> 24) & 1
        const d = decodeDib(u8, o + offBmi, cbBmi, o + offBits, cbBits, { useAlpha: !!alpha })
        if (!d) { P.warn('A bitmap in a format that cannot be read was skipped.'); break }
        P.image(await dibHref(d), d.w, d.h, [dx, dy, dw, dh], [Math.max(0, sx), Math.max(0, sy), Math.abs(cxS), Math.abs(cyS)])
        break
      }
      case 81: {
        const dx = i32(u8, o + 24), dy = i32(u8, o + 28), sx = i32(u8, o + 32), sy = i32(u8, o + 36), cxS = i32(u8, o + 40), cyS = i32(u8, o + 44)
        const offBmi = u32(u8, o + 48), cbBmi = u32(u8, o + 52), offBits = u32(u8, o + 56), cbBits = u32(u8, o + 60)
        const dw = i32(u8, o + 72), dh = i32(u8, o + 76)
        if (!cbBmi) break
        const d = decodeDib(u8, o + offBmi, cbBmi, o + offBits, cbBits)
        if (!d) { P.warn('A bitmap in a format that cannot be read was skipped.'); break }
        const href = await dibHref(d)
        const top = d.h - sy - cyS
        P.image(href, d.w, d.h, [dx, dy, dw, dh], [sx, Math.max(0, top), cxS, cyS])
        break
      }
      case 80: {
        const dx = i32(u8, o + 24), dy = i32(u8, o + 28), sx = i32(u8, o + 32), sy = i32(u8, o + 36), cxS = u32(u8, o + 40), cyS = u32(u8, o + 44)
        const offBmi = u32(u8, o + 48), cbBmi = u32(u8, o + 52), offBits = u32(u8, o + 56), cbBits = u32(u8, o + 60)
        const d = decodeDib(u8, o + offBmi, cbBmi, o + offBits, cbBits)
        if (!d) break
        P.image(await dibHref(d), d.w, d.h, [dx, dy, cxS, cyS], [sx, Math.max(0, d.h - sy - cyS), cxS, cyS])
        break
      }
      case 82: {
        const h = u32(u8, o + 8)
        let name = ''
        for (let i = 0; i < 32; i++) { const c = u16(u8, o + 40 + i * 2); if (!c) break; name += String.fromCharCode(c) }
        objs[h] = { type: 'font', v: { family: name || 'Arial', h: i32(u8, o + 12), w: i32(u8, o + 16), esc: i32(u8, o + 20), bold: u32(u8, o + 28) >= 600, italic: !!u8[o + 32], underline: !!u8[o + 33], strike: !!u8[o + 34], charset: u8[o + 35] } }
        break
      }
      case 83: case 84: {
        const wide = type === 84
        const rx = i32(u8, o + 36), ry = i32(u8, o + 40), nc = u32(u8, o + 44), offS = u32(u8, o + 48), opts = u32(u8, o + 52)
        const rc = rect(o + 56), offDx = u32(u8, o + 72)
        if (nc > 100000 || o + offS + nc * (wide ? 2 : 1) > total) break
        let str
        if (wide) { const cu = []; for (let i = 0; i < nc; i++) cu.push(u16(u8, o + offS + i * 2)); str = String.fromCharCode(...cu) } else str = decodeAnsi(u8.subarray(o + offS, o + offS + nc), P.s.font.charset)
        let dxs = null
        if (offDx && o + offDx + nc * 4 <= total && !(opts & 0x2000)) { dxs = []; for (let i = 0; i < nc; i++) dxs.push(i32(u8, o + offDx + i * 4)) }
        const upd = P.s.textAlign & 1
        const [x, y] = upd ? P.pos : [rx, ry]
        P.text(str, x, y, { dx: dxs, opaque: opts & 2 ? rc : null })
        break
      }
      case 98: case 16: case 20: case 21: case 23: case 13: case 28: case 48: case 49: case 50: case 51: case 52: case 53: case 65: case 66: case 99: case 100: case 101: case 102: case 103: case 104: case 105: case 106: case 107: case 108: case 109: case 110: case 111: case 112: case 113: case 117: case 119: case 120: case 121: case 122: case 15: case 26: case 115: case 123: case 124:
        if (type === 121) P.s.dcPen = colorRef(u32(u8, o + 8))
        else if (type === 122) P.s.dcBrush = colorRef(u32(u8, o + 8))
        else if (type === 26 || type === 15 || type === 53) { /* clip offset, pixel, flood fill: ignored */ }
        break
      case 96: case 97: P.warn('Some text records (PolyTextOut) were skipped.'); break
      case 118: P.warn('Gradient fills were skipped.'); break
      case 78: case 79: P.warn('Masked and parallelogram bitmaps were skipped.'); break
      default: unknown.set(type, (unknown.get(type) || 0) + 1)
    }
  }
  if (hasPlus && !P.items.length) {
    throw Object.assign(new Error('This EMF contains only GDI+ drawing records (EMF+), which this converter cannot draw. Save it from the source program as a standard EMF.'), { userMessage: 'This EMF contains only GDI+ drawing records (EMF+), which this converter cannot draw. Save it from the source program as a standard EMF.' })
  }
  if (plusOnly) P.warn('This file is EMF+ only; the drawing may be incomplete.')
  if (unknown.size) P.warn(`${[...unknown.values()].reduce((a, b) => a + b, 0)} record(s) of an unsupported kind were skipped.`)
  const items = P.items
  if (!items.length) P.warn('The metafile has no visible drawing records.')
  return { pages: [{ w: pageW, h: pageH, name: 'EMF', items }], warnings: [...P.warnings] }
}
