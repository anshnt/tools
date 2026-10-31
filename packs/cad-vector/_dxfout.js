// Model (SVG, PDF, EMF, ... as read by the corel readers) -> DXF (ASCII, R2000). Units are millimetres, y points up (the page is flipped).
// Lines and polygons become LWPOLYLINE, circles and axis-aligned ellipses CIRCLE and ELLIPSE, curves SPLINE (or flattened polylines),
// text TEXT, filled shapes optionally HATCH. Layers are by colour, entity colours are true colour with the nearest index colour alongside.
import { rgbOf, onWhite, apply, MM } from '../corel/_model.js'
import { flattenPath } from './_emfout.js'
import { aciOf } from '../studio-cad/_dxf.js'

const f = (v) => { const s = (+v).toFixed(5); return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s }
const LW = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211]
const lwOf = (mm) => { const v = mm * 100; return LW.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a)) }
const dxfText = (s) => String(s).replace(/[^\x20-\x7e]/g, (c) => `\\U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`)

/** 4 bezier segments forming an axis-aligned ellipse -> {cx, cy, rx, ry} (units of the commands) or null. */
function asEllipse(d) {
  const cs = d.filter((c) => c[0] !== 'Z')
  if (cs.length !== 5 || cs[0][0] !== 'M' || cs.slice(1).some((c) => c[0] !== 'C')) return null
  const ends = [[cs[0][1], cs[0][2]], ...cs.slice(1).map((c) => [c[5], c[6]])]
  if (Math.hypot(ends[0][0] - ends[4][0], ends[0][1] - ends[4][1]) > 1e-3) return null
  const xs = ends.map((p) => p[0]), ys = ends.map((p) => p[1])
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const rx = (Math.max(...xs) - Math.min(...xs)) / 2, ry = (Math.max(...ys) - Math.min(...ys)) / 2
  if (!(rx > 0 && ry > 0)) return null
  // the four end points must sit on the axes through the centre, and the curve must bulge like a real ellipse
  const onAxes = ends.slice(0, 4).every((p) => Math.abs(p[0] - cx) < rx * 1e-3 + 1e-6 || Math.abs(p[1] - cy) < ry * 1e-3 + 1e-6)
  if (!onAxes) return null
  const m = cs[1], p0 = ends[0]
  const t = 0.5, u = 0.5
  const bx = u * u * u * p0[0] + 3 * u * u * t * m[1] + 3 * u * t * t * m[3] + t * t * t * m[5]
  const by = u * u * u * p0[1] + 3 * u * u * t * m[2] + 3 * u * t * t * m[4] + t * t * t * m[6]
  const e = Math.hypot((bx - cx) / rx, (by - cy) / ry)
  return Math.abs(e - 1) < 0.01 ? { cx, cy, rx, ry } : null
}

/**
 * Write one page as DXF. opts: {curves: 'spline' | 'polyline', fills: bool (solid hatches), weights: bool, name}
 * Returns {blob, notes, counts}.
 */
export function pageToDxf(page, { curves = 'spline', fills = false, weights = true } = {}) {
  const notes = new Set()
  const H = page.h
  const X = (x) => x / MM
  const Y = (y) => (H - y) / MM
  const layers = new Map() // name -> aci
  const ents = []
  let handle = 0x100
  const hex = () => (handle++).toString(16).toUpperCase()
  const counts = { lines: 0, polylines: 0, circles: 0, ellipses: 0, splines: 0, hatches: 0, texts: 0 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const grow = (x, y) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
  const layerFor = (color) => {
    const c = (color || '#000000').slice(1).toUpperCase()
    const name = `C_${c}`
    if (!layers.has(name)) layers.set(name, aciOf('#' + c))
    return name
  }
  const common = (type, sub, color, lw) => {
    const [r, g, b] = rgbOf(color)
    const out = [0, type, 5, hex(), 330, '1F', 100, 'AcDbEntity', 8, layerFor(color), 62, aciOf(color), 420, (r << 16) | (g << 8) | b]
    if (lw) out.push(370, lw)
    if (sub) out.push(100, sub)
    return out
  }
  const lines = (a) => ents.push(a)
  const lwpoly = (pts, closed, color, lw) => {
    const e = common('LWPOLYLINE', 'AcDbPolyline', color, lw)
    e.push(90, pts.length, 70, closed ? 1 : 0, 43, 0)
    for (const [x, y] of pts) { e.push(10, f(x), 20, f(y)); grow(x, y) }
    lines(e); counts.polylines++
  }
  const spline = (segs, color, lw) => { // segs: array of [p0,p1,p2,p3] in mm, joined end to end
    const e = common('SPLINE', 'AcDbSpline', color, lw)
    const n = segs.length
    const knots = [0, 0, 0, 0]
    for (let i = 1; i < n; i++) knots.push(i, i, i)
    knots.push(n, n, n, n)
    e.push(210, 0, 220, 0, 230, 1, 70, 8, 71, 3, 72, knots.length, 73, 3 * n + 1, 74, 0, 42, '0.0000001', 43, '0.0000001', 44, '0.0000001')
    for (const k of knots) e.push(40, k)
    const cps = [segs[0][0], ...segs.flatMap((s) => [s[1], s[2], s[3]])]
    for (const [x, y] of cps) { e.push(10, f(x), 20, f(y), 30, 0); grow(x, y) }
    lines(e); counts.splines++
  }
  const hatch = (loops, color, evenodd) => {
    const e = common('HATCH', 'AcDbHatch', color, 0)
    e.push(10, 0, 20, 0, 30, 0, 210, 0, 220, 0, 230, 1, 2, 'SOLID', 70, 1, 71, 0, 91, loops.length)
    for (const l of loops) {
      e.push(92, 3, 72, 0, 73, 1, 93, l.length)
      for (const [x, y] of l) { e.push(10, f(x), 20, f(y)); grow(x, y) }
      e.push(97, 0)
    }
    e.push(75, evenodd ? 0 : 0, 76, 1, 47, 1, 98, 0)
    lines(e); counts.hatches++
  }

  for (const it of page.items) {
    if (it.clip?.length) notes.add('DXF has no clipping, so clipped shapes were written unclipped.')
    if (it.t === 'path') {
      const stroke = it.stroke && it.strokeWidth > 0 ? onWhite(it.stroke, it.strokeOpacity ?? 1) : null
      const fill = it.fill ? (typeof it.fill === 'object' ? onWhite(it.fill.stops[0].c, 1) : onWhite(it.fill, it.fillOpacity ?? 1)) : null
      const color = stroke || fill
      if (!color) continue
      if (typeof it.fill === 'object' && it.fill) notes.add('Gradients were written with their first colour.')
      const lw = weights && stroke ? lwOf(it.strokeWidth / MM) : 0
      const d = it.d.map((c) => (c[0] === 'Z' ? c : [c[0], ...c.slice(1).map((v, i) => (i % 2 ? Y(v) : X(v)))]))
      // outlines
      const ell = asEllipse(d)
      if (ell && (stroke || !fills)) {
        if (Math.abs(ell.rx - ell.ry) < 1e-3 * ell.rx) {
          const e = common('CIRCLE', 'AcDbCircle', color, lw)
          e.push(10, f(ell.cx), 20, f(ell.cy), 30, 0, 40, f(ell.rx)); lines(e); counts.circles++
        } else {
          const maj = ell.rx >= ell.ry
          const e = common('ELLIPSE', 'AcDbEllipse', color, lw)
          e.push(10, f(ell.cx), 20, f(ell.cy), 30, 0, 11, f(maj ? ell.rx : 0), 21, f(maj ? 0 : ell.ry), 31, 0, 210, 0, 220, 0, 230, 1, 40, f(maj ? ell.ry / ell.rx : ell.rx / ell.ry), 41, 0, 42, '6.2831853')
          lines(e); counts.ellipses++
        }
        grow(ell.cx - ell.rx, ell.cy - ell.ry); grow(ell.cx + ell.rx, ell.cy + ell.ry)
      } else if (curves === 'spline' && d.some((c) => c[0] === 'C')) {
        // runs of straight segments and runs of curves become separate entities
        let cx = 0, cy = 0, sx = 0, sy = 0, runL = [], runC = []
        const flushL = (closed) => { if (runL.length > 1) { if (runL.length === 2 && !closed) { const e = common('LINE', 'AcDbLine', color, lw); e.push(10, f(runL[0][0]), 20, f(runL[0][1]), 30, 0, 11, f(runL[1][0]), 21, f(runL[1][1]), 31, 0); grow(...runL[0]); grow(...runL[1]); lines(e); counts.lines++ } else lwpoly(runL, closed, color, lw) } runL = [] }
        const flushC = () => { if (runC.length) spline(runC, color, lw); runC = [] }
        for (const c of d) {
          if (c[0] === 'M') { flushL(false); flushC(); cx = sx = c[1]; cy = sy = c[2]; runL = [[cx, cy]] } else if (c[0] === 'L') { flushC(); if (!runL.length) runL = [[cx, cy]]; runL.push([c[1], c[2]]); cx = c[1]; cy = c[2] } else if (c[0] === 'C') { if (runL.length > 1) { flushL(false) } runL = []; runC.push([[cx, cy], [c[1], c[2]], [c[3], c[4]], [c[5], c[6]]]); cx = c[5]; cy = c[6] } else { // Z
            if (runC.length) { if (Math.hypot(cx - sx, cy - sy) > 1e-4) { flushC(); lwpoly([[cx, cy], [sx, sy]], false, color, lw) } else flushC() } else { flushL(true) }
            cx = sx; cy = sy; runL = []
          }
        }
        flushL(false); flushC()
      } else {
        for (const s of flattenPath(d, 0.05)) {
          if (s.pts.length === 2 && !s.closed) { const e = common('LINE', 'AcDbLine', color, lw); e.push(10, f(s.pts[0][0]), 20, f(s.pts[0][1]), 30, 0, 11, f(s.pts[1][0]), 21, f(s.pts[1][1]), 31, 0); grow(...s.pts[0]); grow(...s.pts[1]); lines(e); counts.lines++ } else if (s.pts.length > 1) {
            let pts = s.pts
            if (s.closed && pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6) pts = pts.slice(0, -1)
            lwpoly(pts, s.closed, color, lw)
          }
        }
      }
      if (fills && fill) {
        const loops = flattenPath(d, 0.05).filter((s) => s.pts.length > 2).map((s) => s.pts)
        if (loops.length) hatch(loops, fill, it.rule === 'evenodd')
      }
    } else if (it.t === 'text') {
      const m = it.m
      const color = onWhite(it.fill || '#000000', it.opacity ?? 1)
      const lh = it.size * (it.lh || 1.2)
      const sc = Math.hypot(m[0], m[1])
      const rot = (Math.atan2(-m[1], m[0]) * 180) / Math.PI
      String(it.str).split('\n').forEach((ln, i) => {
        if (!ln.trim()) return
        const [px, py] = apply(m, 0, i * lh)
        const e = common('TEXT', 'AcDbText', color, 0)
        e.push(10, f(X(px)), 20, f(Y(py)), 30, 0, 40, f((it.size * sc) / MM), 1, dxfText(ln), 50, f(rot), 7, 'STANDARD', 100, 'AcDbText')
        grow(X(px), Y(py)); grow(X(px) + (ln.length * it.size * sc * 0.55) / MM, Y(py) + (it.size * sc) / MM)
        lines(e); counts.texts++
      })
    } else if (it.t === 'image') notes.add('Pictures cannot be placed in a DXF and were left out.')
  }
  if (!Number.isFinite(minX)) { minX = minY = 0; maxX = maxY = 1 }

  // ----- assemble -----
  const hb = [hex(), hex(), hex(), hex()]
  const out = []
  const g = (...a) => { for (let i = 0; i < a.length; i += 2) out.push(String(a[i]), String(a[i + 1])) }
  g(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1015', 9, '$HANDSEED', 5, handle.toString(16).toUpperCase(), 9, '$INSBASE', 10, 0, 20, 0, 30, 0, 9, '$EXTMIN', 10, f(minX), 20, f(minY), 30, 0, 9, '$EXTMAX', 10, f(maxX), 20, f(maxY), 30, 0,
    9, '$LIMMIN', 10, 0, 20, 0, 9, '$LIMMAX', 10, f(page.w / MM), 20, f(page.h / MM), 9, '$LTSCALE', 40, 1, 9, '$LWDISPLAY', 290, weights ? 1 : 0, 9, '$INSUNITS', 70, 4, 9, '$MEASUREMENT', 70, 1, 0, 'ENDSEC')
  g(0, 'SECTION', 2, 'CLASSES', 0, 'ENDSEC')
  g(0, 'SECTION', 2, 'TABLES')
  g(0, 'TABLE', 2, 'VPORT', 5, 8, 330, 0, 100, 'AcDbSymbolTable', 70, 0, 0, 'ENDTAB')
  g(0, 'TABLE', 2, 'LTYPE', 5, 5, 330, 0, 100, 'AcDbSymbolTable', 70, 3)
  g(0, 'LTYPE', 5, 10, 330, 5, 100, 'AcDbSymbolTableRecord', 100, 'AcDbLinetypeTableRecord', 2, 'ByBlock', 70, 0, 3, '', 72, 65, 73, 0, 40, 0)
  g(0, 'LTYPE', 5, 11, 330, 5, 100, 'AcDbSymbolTableRecord', 100, 'AcDbLinetypeTableRecord', 2, 'ByLayer', 70, 0, 3, '', 72, 65, 73, 0, 40, 0)
  g(0, 'LTYPE', 5, 12, 330, 5, 100, 'AcDbSymbolTableRecord', 100, 'AcDbLinetypeTableRecord', 2, 'Continuous', 70, 0, 3, 'Solid line', 72, 65, 73, 0, 40, 0)
  g(0, 'ENDTAB')
  const lnames = ['0', ...layers.keys()]
  g(0, 'TABLE', 2, 'LAYER', 5, 2, 330, 0, 100, 'AcDbSymbolTable', 70, lnames.length)
  let lh = 0x20
  for (const n of lnames) g(0, 'LAYER', 5, (lh++).toString(16).toUpperCase(), 330, 2, 100, 'AcDbSymbolTableRecord', 100, 'AcDbLayerTableRecord', 2, n, 70, 0, 62, n === '0' ? 7 : layers.get(n), 6, 'Continuous', 370, -3)
  g(0, 'ENDTAB')
  g(0, 'TABLE', 2, 'STYLE', 5, 3, 330, 0, 100, 'AcDbSymbolTable', 70, 1)
  g(0, 'STYLE', 5, 13, 330, 3, 100, 'AcDbSymbolTableRecord', 100, 'AcDbTextStyleTableRecord', 2, 'STANDARD', 70, 0, 40, 0, 41, 1, 50, 0, 71, 0, 42, 2.5, 3, 'txt', 4, '')
  g(0, 'ENDTAB')
  g(0, 'TABLE', 2, 'VIEW', 5, 6, 330, 0, 100, 'AcDbSymbolTable', 70, 0, 0, 'ENDTAB')
  g(0, 'TABLE', 2, 'UCS', 5, 7, 330, 0, 100, 'AcDbSymbolTable', 70, 0, 0, 'ENDTAB')
  g(0, 'TABLE', 2, 'APPID', 5, 9, 330, 0, 100, 'AcDbSymbolTable', 70, 1)
  g(0, 'APPID', 5, 14, 330, 9, 100, 'AcDbSymbolTableRecord', 100, 'AcDbRegAppTableRecord', 2, 'ACAD', 70, 0)
  g(0, 'ENDTAB')
  g(0, 'TABLE', 2, 'DIMSTYLE', 5, 'A', 330, 0, 100, 'AcDbSymbolTable', 70, 0, 0, 'ENDTAB')
  g(0, 'TABLE', 2, 'BLOCK_RECORD', 5, 1, 330, 0, 100, 'AcDbSymbolTable', 70, 2)
  g(0, 'BLOCK_RECORD', 5, '1F', 330, 1, 100, 'AcDbSymbolTableRecord', 100, 'AcDbBlockTableRecord', 2, '*Model_Space', 340, 0, 70, 0, 280, 1, 281, 0)
  g(0, 'BLOCK_RECORD', 5, '1B', 330, 1, 100, 'AcDbSymbolTableRecord', 100, 'AcDbBlockTableRecord', 2, '*Paper_Space', 340, 0, 70, 0, 280, 1, 281, 0)
  g(0, 'ENDTAB')
  g(0, 'ENDSEC')
  g(0, 'SECTION', 2, 'BLOCKS')
  g(0, 'BLOCK', 5, hb[0], 330, '1F', 100, 'AcDbEntity', 8, 0, 100, 'AcDbBlockBegin', 2, '*Model_Space', 70, 0, 10, 0, 20, 0, 30, 0, 3, '*Model_Space', 1, '')
  g(0, 'ENDBLK', 5, hb[1], 330, '1F', 100, 'AcDbEntity', 8, 0, 100, 'AcDbBlockEnd')
  g(0, 'BLOCK', 5, hb[2], 330, '1B', 100, 'AcDbEntity', 67, 1, 8, 0, 100, 'AcDbBlockBegin', 2, '*Paper_Space', 70, 0, 10, 0, 20, 0, 30, 0, 3, '*Paper_Space', 1, '')
  g(0, 'ENDBLK', 5, hb[3], 330, '1B', 100, 'AcDbEntity', 67, 1, 8, 0, 100, 'AcDbBlockEnd')
  g(0, 'ENDSEC')
  g(0, 'SECTION', 2, 'ENTITIES')
  for (const e of ents) for (const v of e) out.push(String(v))
  g(0, 'ENDSEC')
  g(0, 'SECTION', 2, 'OBJECTS', 0, 'DICTIONARY', 5, 'C', 330, 0, 100, 'AcDbDictionary', 281, 1, 0, 'ENDSEC', 0, 'EOF')
  const ext = { x0: minX, y0: minY, x1: maxX, y1: maxY }
  return { blob: new Blob([out.join('\r\n') + '\r\n'], { type: 'application/dxf' }), notes: [...notes], counts, extents: ext }
}
