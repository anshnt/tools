// DXF import (dxf-parser, MIT) and export (ASCII DXF R2000 written here) for CAD Studio.
import { TAU, R2D, D2R, pt, norm, Tf } from './_vec.js'
import { explode, transform, bbox } from './_ent.js'
import { LTYPES, UNITS, newLayer, defaultsFor } from './_doc.js'
import { textLines } from './_dim.js'
import { HATCH_PATTERNS } from './_edit.js'

const DXF_PARSER = 'https://cdn.jsdelivr.net/npm/dxf-parser@1.1.2/+esm'
let parserP = null
/** Test hook: supply a parser class instead of loading it from the CDN. */
export const useParser = (P) => { parserP = Promise.resolve(P) }
const loadParser = () => (parserP ??= import(DXF_PARSER).then((m) => m.default || m.DxfParser).catch((e) => { parserP = null; throw Object.assign(new Error('Could not load the DXF reader. Check your connection and try again.'), { cause: e }) }))

const userErr = (m) => Object.assign(new Error(m), { userMessage: m })

// ---------- Import ----------
const INS_UNITS = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' }
const SUPPORTED = new Set(['LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'POLYLINE', 'ELLIPSE', 'SPLINE', 'TEXT', 'MTEXT', 'INSERT', 'DIMENSION', 'SOLID'])
const hex = (n) => '#' + (n & 0xffffff).toString(16).padStart(6, '0')

/** Decode DXF text codes (%%d, %%c, %%p and \U+XXXX). */
export function decodeDxfText(s) {
  return String(s ?? '').replace(/%%[dD]/g, '°').replace(/%%[cC]/g, 'Ø').replace(/%%[pP]/g, '±').replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}
export function stripMText(s) {
  return decodeDxfText(String(s ?? '').replace(/\\P/g, '\n').replace(/\\~/g, ' ').replace(/\\[ACFHQTWpfcwqhta][^;\\{}]*;/g, '').replace(/\\[Ll]|\\[Oo]|\\[Kk]/g, '').replace(/[{}]/g, '').replace(/\\\\/g, '\\'))
}

function decodeBytes(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch { return new TextDecoder('windows-1252').decode(buf) }
}

/** Count entity types in the ENTITIES section so unsupported ones can be reported. */
function scanTypes(text) {
  const lines = text.split(/\r?\n/)
  const counts = {}
  let inEntities = false
  for (let i = 0; i + 1 < lines.length; i += 2) {
    if (lines[i].trim() !== '0') continue
    const v = lines[i + 1].trim()
    if (v === 'SECTION') { const n = (lines[i + 3] || '').trim(); inEntities = n === 'ENTITIES' }
    else if (v === 'ENDSEC') inEntities = false
    else if (inEntities) counts[v] = (counts[v] || 0) + 1
  }
  return counts
}

/** Evaluate a B-spline with de Boor's algorithm. */
function splinePoints(en) {
  const cp = en.controlPoints || []
  const deg = en.degreeOfSplineCurve || 3
  const knots = en.knotValues || []
  if (cp.length >= deg + 1 && knots.length === cp.length + deg + 1) {
    const t0 = knots[deg], t1 = knots[cp.length]
    const n = Math.max(24, Math.min(600, cp.length * 12))
    const out = []
    for (let i = 0; i <= n; i++) {
      const t = i === n ? t1 - 1e-12 : t0 + ((t1 - t0) * i) / n
      let k = deg
      while (k < cp.length - 1 && t >= knots[k + 1]) k++
      const d = []
      for (let j = 0; j <= deg; j++) d.push({ x: cp[j + k - deg].x, y: cp[j + k - deg].y })
      for (let r = 1; r <= deg; r++) {
        for (let j = deg; j >= r; j--) {
          const den = knots[j + 1 + k - r] - knots[j + k - deg]
          const a = den === 0 ? 0 : (t - knots[j + k - deg]) / den
          d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y }
        }
      }
      out.push(d[deg])
    }
    return out
  }
  const through = en.fitPoints?.length > 1 ? en.fitPoints : cp
  if (through.length < 3) return through.map((p) => ({ x: p.x, y: p.y }))
  // no usable knots: smooth curve through the points (Catmull-Rom)
  const P = through.map((p) => ({ x: p.x, y: p.y }))
  const out = []
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)]
    for (let k = 0; k < 12; k++) {
      const t = k / 12, t2 = t * t, t3 = t2 * t
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) })
    }
  }
  out.push(P[P.length - 1])
  return out
}

const LT_RE = [[/dash.?dot|dashdot/i, 'dashdot'], [/phantom/i, 'phantom'], [/cent(er|re)/i, 'center'], [/hidden|dashed2|^dash/i, 'hidden'], [/dash/i, 'dashed'], [/dot/i, 'dot']]
function mapLtype(name) {
  if (!name || /^(bylayer|byblock|continuous)$/i.test(name)) return undefined
  for (const [re, k] of LT_RE) if (re.test(name)) return k === 'hidden' && /dashed/i.test(name) ? 'dashed' : k
  return undefined
}

const ACI_RGB = { 1: 0xff0000, 2: 0xffff00, 3: 0x00ff00, 4: 0x00ffff, 5: 0x0000ff, 6: 0xff00ff, 7: 0xffffff, 8: 0x808080, 9: 0xc0c0c0 }
const HATCH_NAMES = [[/^solid$/i, 'solid'], [/ansi3[78]|net|honey|cross|plus/i, 'ansi37'], [/ansi3|angle|line|steel|iso0|dash/i, 'ansi31']]

/** The dxf-parser library has no HATCH support, so read hatches straight from the ENTITIES section (polyline and line/arc edge boundaries). */
export function parseHatches(text) {
  const lines = text.split(/\r?\n/)
  const out = []
  let inEntities = false
  let i = 0
  const pairs = []
  for (; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i], 10), lines[i + 1].trim()])
  for (let k = 0; k < pairs.length; k++) {
    const [c, v] = pairs[k]
    if (c === 0 && v === 'SECTION') { inEntities = pairs[k + 1]?.[1] === 'ENTITIES'; continue }
    if (c === 0 && v === 'ENDSEC') { inEntities = false; continue }
    if (!inEntities || c !== 0 || v !== 'HATCH') continue
    let end = k + 1
    while (end < pairs.length && pairs[end][0] !== 0) end++
    const g = pairs.slice(k + 1, end)
    const h = { layer: '0', pattern: 'ansi31', scale: 1, angle: 0, solid: false, loops: [], color: undefined }
    let j = 0
    const num = (x) => parseFloat(x)
    let loopsLeft = -1
    while (j < g.length) {
      const [code, val] = g[j]
      if (code === 8) h.layer = val
      else if (code === 62 && ACI_RGB[+val] && h.color === undefined && loopsLeft < 0) h.color = '#' + ACI_RGB[+val].toString(16).padStart(6, '0')
      else if (code === 420 && loopsLeft < 0) h.color = '#' + (parseInt(val, 10) & 0xffffff).toString(16).padStart(6, '0')
      else if (code === 2 && loopsLeft < 0) h.name = val
      else if (code === 70 && loopsLeft < 0) h.solid = val === '1'
      else if (code === 91) loopsLeft = parseInt(val, 10)
      else if (code === 92 && loopsLeft > 0) {
        const flag = parseInt(val, 10)
        loopsLeft--
        const pts = []
        j++
        if (flag & 2) {
          let hasBulge = 0
          while (j < g.length && g[j][0] !== 93) { if (g[j][0] === 72) hasBulge = +g[j][1]; j++ }
          const n = parseInt(g[j]?.[1], 10) || 0
          j++
          for (let q = 0; q < n && j < g.length; q++) {
            const p = { x: num(g[j][1]), y: num(g[j + 1][1]), b: 0 }
            j += 2
            if (hasBulge && g[j]?.[0] === 42) { p.b = num(g[j][1]); j++ }
            pts.push(p)
          }
        } else {
          while (j < g.length && g[j][0] !== 93) j++
          const n = parseInt(g[j]?.[1], 10) || 0
          j++
          const seg = []
          let ok = true
          for (let q = 0; q < n && j < g.length; q++) {
            const type = parseInt(g[j][1], 10)
            j++
            const take = (codes) => { const r = {}; for (const cd of codes) { if (g[j]?.[0] !== cd) { ok = false; return r } r[cd] = num(g[j][1]); j++ } return r }
            if (type === 1) { const e = take([10, 20, 11, 21]); seg.push({ t: 1, a: { x: e[10], y: e[20] }, b: { x: e[11], y: e[21] } }) }
            else if (type === 2) { const e = take([10, 20, 40, 50, 51, 73]); seg.push({ t: 2, c: { x: e[10], y: e[20] }, r: e[40], a0: e[50] * D2R, a1: e[51] * D2R, ccw: e[73] !== 0 }) }
            else { ok = false; while (j < g.length && g[j][0] !== 72 && g[j][0] !== 97) j++ }
          }
          if (ok && seg.length) {
            for (const e of seg) {
              if (e.t === 1) pts.push({ x: e.a.x, y: e.a.y, b: 0 })
              else {
                const sa = e.ccw ? e.a0 : e.a1, ea = e.ccw ? e.a1 : e.a0
                const start = { x: e.c.x + Math.cos(e.ccw ? e.a0 : e.a1) * e.r, y: e.c.y + Math.sin(e.ccw ? e.a0 : e.a1) * e.r }
                const sweep = ((ea - sa) % TAU + TAU) % TAU || TAU
                pts.push({ x: start.x, y: start.y, b: Math.tan(sweep / 4) * (e.ccw ? 1 : -1) })
              }
            }
          }
        }
        while (j < g.length && g[j][0] !== 97) j++
        if (pts.length >= 3 || (pts.length === 2 && pts.some((p) => p.b))) h.loops.push(pts)
        continue
      } else if (code === 52 && loopsLeft === 0) h.angle = num(val)
      else if (code === 41 && loopsLeft === 0) h.scale = num(val) || 1
      j++
    }
    if (!h.loops.length) continue
    h.pattern = h.solid ? 'solid' : (HATCH_NAMES.find(([re]) => re.test(h.name || ''))?.[1] || 'ansi31')
    out.push(h)
  }
  return out
}

/**
 * Parse DXF bytes/text into { layers, ents (no ids), units, skipped, count, ltscale }.
 * Blocks are expanded in place; dimensions use their drawn block geometry.
 */
export async function importDxf(data) {
  let text = typeof data === 'string' ? data : decodeBytes(data instanceof ArrayBuffer ? new Uint8Array(data) : data)
  if (/^AutoCAD Binary DXF/.test(text)) throw userErr('This is a binary DXF. Save it as an ASCII DXF from your CAD program and try again.')
  if (!/\bSECTION\b/.test(text.slice(0, 4000))) throw userErr('This does not look like a DXF file. DWG files are not supported; export a DXF from your CAD program.')
  const Parser = await loadParser()
  let dxf
  try { dxf = new Parser().parseSync(text) } catch (e) { throw userErr(`Could not read this DXF: ${e.message || e}`) }
  if (!dxf) throw userErr('Could not read this DXF.')
  const types = scanTypes(text)
  const skipped = {}
  const bump = (t) => { skipped[t] = (skipped[t] || 0) + 1 }
  for (const [t, n] of Object.entries(types)) if (!SUPPORTED.has(t) && t !== 'ATTRIB' && t !== 'ATTDEF' && t !== 'HATCH') skipped[t] = n

  const header = dxf.header || {}
  const units = INS_UNITS[header.$INSUNITS] || 'mm'
  const layers = []
  const layerTable = dxf.tables?.layer?.layers || {}
  for (const [name, l] of Object.entries(layerTable)) {
    if (!name) continue
    layers.push(newLayer(name, { color: l.color != null ? hex(l.color) : '#ffffff', visible: l.visible !== false && !l.frozen }))
  }
  if (!layers.some((l) => l.name === '0')) layers.unshift(newLayer('0'))
  const known = new Set(layers.map((l) => l.name))
  const ents = []
  const dimDefaults = defaultsFor(units)
  const dimTxt = header.$DIMTXT > 0 ? header.$DIMTXT : dimDefaults.dimTh
  const dimAsz = header.$DIMASZ > 0 ? header.$DIMASZ : dimTxt

  const style = (en, ctx) => {
    const o = {}
    let layer = en.layer || '0'
    if (layer === '0' && ctx.layer) layer = ctx.layer
    if (!known.has(layer)) { layers.push(newLayer(layer)); known.add(layer) }
    o.layer = layer
    if (en.colorIndex === 0 && ctx.color) o.color = ctx.color
    else if (en.color != null && en.colorIndex !== 256 && en.colorIndex !== 0) o.color = hex(en.color)
    const lt = mapLtype(en.lineType)
    if (lt) o.ltype = lt
    if (typeof en.lineweight === 'number' && en.lineweight > 0) o.lw = en.lineweight / 100
    return o
  }
  const P = (p) => ({ x: p.x, y: p.y })

  function convert(en, ctx, out, depth) {
    if (en.visible === false) return
    const base = () => style(en, ctx)
    const push = (e) => out.push({ ...base(), ...e })
    switch (en.type) {
      case 'LINE': if (en.vertices?.length >= 2) push({ type: 'line', x1: en.vertices[0].x, y1: en.vertices[0].y, x2: en.vertices[1].x, y2: en.vertices[1].y }); break
      case 'CIRCLE': push({ type: 'circle', cx: en.center.x, cy: en.center.y, r: en.radius }); break
      case 'ARC': push({ type: 'arc', cx: en.center.x, cy: en.center.y, r: en.radius, a0: norm(en.startAngle), a1: norm(en.endAngle) }); break
      case 'ELLIPSE': {
        const m = en.majorAxisEndPoint
        const t0 = en.startAngle ?? 0
        let t1 = en.endAngle ?? TAU
        if (Math.abs(t1 - t0) < 1e-9) t1 = t0 + TAU
        push({ type: 'ellipse', cx: en.center.x, cy: en.center.y, mx: m.x, my: m.y, ratio: en.axisRatio, t0, t1 })
        break
      }
      case 'LWPOLYLINE': case 'POLYLINE': {
        const vs = (en.vertices || []).filter((v) => v && Number.isFinite(v.x) && Number.isFinite(v.y))
        if (vs.length < 2) break
        push({ type: 'polyline', closed: !!(en.shape || en.closed), pts: vs.map((v) => ({ x: v.x, y: v.y, b: v.bulge || 0 })) })
        break
      }
      case 'SPLINE': {
        const pts = splinePoints(en)
        if (pts.length >= 2) push({ type: 'polyline', closed: !!en.closed, pts: pts.map((p) => ({ x: p.x, y: p.y, b: 0 })) })
        break
      }
      case 'SOLID': {
        const ps = (en.points || []).map(P)
        if (ps.length >= 3) push({ type: 'hatch', pattern: 'solid', scale: 1, angle: 0, loops: [[ps[0], ps[1], ps[3] || ps[2], ps[3] ? ps[2] : null].filter(Boolean).map((p) => ({ x: p.x, y: p.y, b: 0 }))] })
        break
      }
      case 'TEXT': {
        const str = decodeDxfText(en.text)
        if (!str.trim()) break
        const ha = en.halign || 0
        const a = ha === 1 || ha === 4 ? 'c' : ha === 2 ? 'r' : 'l'
        const at = a !== 'l' && en.endPoint ? en.endPoint : en.startPoint
        if (!at) break
        push({ type: 'text', x: at.x, y: at.y, h: en.textHeight || dimTxt, text: str, rot: (en.rotation || 0) * D2R, align: a })
        break
      }
      case 'MTEXT': {
        const str = stripMText(en.text)
        if (!str.trim() || !en.position) break
        const h = en.height || dimTxt
        const ap = en.attachmentPoint || 1
        const lines = str.split('\n').length
        const rot = en.directionVector ? Math.atan2(en.directionVector.y, en.directionVector.x) : (en.rotation || 0) * D2R
        const row = Math.ceil(ap / 3)
        const drop = row === 1 ? h * 0.85 : row === 2 ? h * 0.35 - ((lines - 1) / 2) * h * 1.35 : -(lines - 1) * h * 1.35
        const co = Math.cos(rot), si = Math.sin(rot)
        push({ type: 'text', x: en.position.x + si * drop, y: en.position.y - co * drop, h, text: str, rot, align: ap % 3 === 2 ? 'c' : ap % 3 === 0 ? 'r' : 'l' })
        break
      }
      case 'INSERT': {
        const blk = dxf.blocks?.[en.name]
        if (!blk || depth > 6) { if (!blk) bump('INSERT (missing block)'); break }
        const sx = en.xScale || 1, sy = en.yScale || 1
        const k = (Math.abs(sx) + Math.abs(sy)) / 2 || 1
        let t = Tf.compose(Tf.move(-(blk.position?.x || 0), -(blk.position?.y || 0)), Tf.scale(pt(0, 0), k))
        if (sx < 0 && sy < 0) t = Tf.compose(t, Tf.rotate(pt(0, 0), Math.PI))
        else if (sx < 0) t = Tf.compose(t, Tf.mirror(pt(0, 0), pt(0, 1)))
        else if (sy < 0) t = Tf.compose(t, Tf.mirror(pt(0, 0), pt(1, 0)))
        t = Tf.compose(Tf.compose(t, Tf.rotate(pt(0, 0), (en.rotation || 0) * D2R)), Tf.move(en.position.x, en.position.y))
        const inner = []
        const b = base()
        const sub2 = { layer: b.layer, color: b.color }
        for (const child of blk.entities || []) convert(child, sub2, inner, depth + 1)
        for (const e of inner) out.push(transform(e, t))
        break
      }
      case 'DIMENSION': {
        const blk = en.block && dxf.blocks?.[en.block]
        if (blk?.entities?.length) {
          const inner = []
          const b = base()
          for (const child of blk.entities) convert(child, { layer: b.layer, color: b.color }, inner, depth + 1)
          out.push(...inner)
          break
        }
        const type = (en.dimensionType || 0) & 7
        if ((type === 0 || type === 1) && en.linearOrAngularPoint1 && en.linearOrAngularPoint2 && en.anchorPoint) {
          const a = P(en.linearOrAngularPoint1), bb = P(en.linearOrAngularPoint2)
          push({ type: 'dim', kind: type === 1 ? 'aligned' : 'linear', a, b: bb, loc: P(en.anchorPoint), ang: (en.rotation || en.angle || 0) * D2R, th: dimTxt, as: dimAsz, pr: 2 })
        } else bump('DIMENSION')
        break
      }
      default: break
    }
  }

  for (const en of dxf.entities || []) convert(en, {}, ents, 0)
  let badHatch = types.HATCH || 0
  for (const hh of parseHatches(text)) {
    if (!known.has(hh.layer)) { layers.push(newLayer(hh.layer)); known.add(hh.layer) }
    ents.push({ type: 'hatch', layer: hh.layer, ...(hh.color ? { color: hh.color } : {}), pattern: hh.pattern, scale: hh.scale, angle: hh.angle, loops: hh.loops })
    badHatch--
  }
  if (badHatch > 0) skipped.HATCH = badHatch
  const valid = ents.filter((e) => { const b = bbox(e); return Number.isFinite(b.x0 + b.x1 + b.y0 + b.y1) })
  if (valid.length < ents.length) skipped['invalid objects'] = ents.length - valid.length
  ents.length = 0
  ents.push(...valid)
  // blocks that only exist as DIMENSION bodies are already used; nothing else to do
  return { layers, ents, units, skipped, count: ents.length, ltscale: header.$LTSCALE > 0 ? header.$LTSCALE : undefined, dimTh: dimTxt }
}

// ---------- Export ----------
const num = (v) => {
  if (!Number.isFinite(v)) return '0'
  const s = v.toFixed(8)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') || '0' : s
}
const ACI = [[1, 0xff0000], [2, 0xffff00], [3, 0x00ff00], [4, 0x00ffff], [5, 0x0000ff], [6, 0xff00ff], [7, 0xffffff], [8, 0x808080], [9, 0xc0c0c0]]
export function aciOf(hexColor) {
  const n = parseInt(String(hexColor || '#ffffff').slice(1), 16)
  if (n === 0xffffff || n === 0) return 7
  let best = 7, bd = Infinity
  for (const [i, c] of ACI) {
    const d = ((n >> 16) - (c >> 16)) ** 2 + (((n >> 8) & 255) - ((c >> 8) & 255)) ** 2 + ((n & 255) - (c & 255)) ** 2
    if (d < bd) { bd = d; best = i }
  }
  return best
}
const LT_NAME = { continuous: 'Continuous', dashed: 'DASHED', hidden: 'HIDDEN', center: 'CENTER', phantom: 'PHANTOM', dot: 'DOT', dashdot: 'DASHDOT' }
const VALID_LW = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211]
const lwCode = (mm) => VALID_LW.reduce((b, v) => (Math.abs(v - mm * 100) < Math.abs(b - mm * 100) ? v : b), 25)
const layerName = (n) => String(n).replace(/[<>/\\":;?*|=`]/g, '_') || '0'
export function encodeDxfText(s) {
  return String(s).replace(/°/g, '%%d').replace(/Ø/g, '%%c').replace(/±/g, '%%p').replace(/[\u0080-￿]/g, (c) => '\\U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).replace(/[\r\n]+/g, ' ')
}

/** Write the drawing as an ASCII DXF (R2000). Dimensions are written as plain lines, arrowheads and text. */
export function exportDxf(doc) {
  const st = doc.state
  let n = 1
  const H = () => (n++).toString(16).toUpperCase()
  const body = []
  const g = (code, v) => body.push(String(code), String(v))
  const hLtypeT = H(), hLayerT = H(), hStyleT = H(), hAppidT = H(), hBlockT = H(), hModelRec = H(), hPaperRec = H(), hStyle = H()
  const ext = doc.extents() || { x0: 0, y0: 0, x1: 0, y1: 0 }

  // TABLES
  g(0, 'SECTION'); g(2, 'TABLES')
  g(0, 'TABLE'); g(2, 'LTYPE'); g(5, hLtypeT); g(330, 0); g(100, 'AcDbSymbolTable'); g(70, 3 + Object.keys(LTYPES).length - 1)
  for (const [name, desc] of [['ByBlock', ''], ['ByLayer', ''], ['Continuous', 'Solid line']]) {
    g(0, 'LTYPE'); g(5, H()); g(330, hLtypeT); g(100, 'AcDbSymbolTableRecord'); g(100, 'AcDbLinetypeTableRecord'); g(2, name); g(70, 0); g(3, desc); g(72, 65); g(73, 0); g(40, 0)
  }
  for (const [key, def] of Object.entries(LTYPES)) {
    if (key === 'continuous') continue
    g(0, 'LTYPE'); g(5, H()); g(330, hLtypeT); g(100, 'AcDbSymbolTableRecord'); g(100, 'AcDbLinetypeTableRecord'); g(2, LT_NAME[key]); g(70, 0); g(3, def.name)
    g(72, 65); g(73, def.dash.length); g(40, num(def.dash.reduce((a, b) => a + b, 0)))
    def.dash.forEach((d, i) => { g(49, num(i % 2 ? -d : d)); g(74, 0) })
  }
  g(0, 'ENDTAB')
  g(0, 'TABLE'); g(2, 'LAYER'); g(5, hLayerT); g(330, 0); g(100, 'AcDbSymbolTable'); g(70, st.layers.length)
  for (const l of st.layers) {
    const rgb = parseInt(l.color.slice(1), 16)
    g(0, 'LAYER'); g(5, H()); g(330, hLayerT); g(100, 'AcDbSymbolTableRecord'); g(100, 'AcDbLayerTableRecord'); g(2, layerName(l.name))
    g(70, l.locked ? 4 : 0); g(62, l.visible ? aciOf(l.color) : -aciOf(l.color)); g(420, rgb); g(6, LT_NAME[l.ltype] || 'Continuous'); g(370, lwCode(l.lw))
  }
  g(0, 'ENDTAB')
  g(0, 'TABLE'); g(2, 'STYLE'); g(5, hStyleT); g(330, 0); g(100, 'AcDbSymbolTable'); g(70, 1)
  g(0, 'STYLE'); g(5, hStyle); g(330, hStyleT); g(100, 'AcDbSymbolTableRecord'); g(100, 'AcDbTextStyleTableRecord'); g(2, 'Standard'); g(70, 0); g(40, 0); g(41, 1); g(50, 0); g(71, 0); g(42, 2.5); g(3, 'txt'); g(4, '')
  g(0, 'ENDTAB')
  g(0, 'TABLE'); g(2, 'APPID'); g(5, hAppidT); g(330, 0); g(100, 'AcDbSymbolTable'); g(70, 1)
  g(0, 'APPID'); g(5, H()); g(330, hAppidT); g(100, 'AcDbSymbolTableRecord'); g(100, 'AcDbRegAppTableRecord'); g(2, 'ACAD'); g(70, 0)
  g(0, 'ENDTAB')
  g(0, 'TABLE'); g(2, 'BLOCK_RECORD'); g(5, hBlockT); g(330, 0); g(100, 'AcDbSymbolTable'); g(70, 2)
  g(0, 'BLOCK_RECORD'); g(5, hModelRec); g(330, hBlockT); g(100, 'AcDbSymbolTableRecord'); g(100, 'AcDbBlockTableRecord'); g(2, '*Model_Space')
  g(0, 'BLOCK_RECORD'); g(5, hPaperRec); g(330, hBlockT); g(100, 'AcDbSymbolTableRecord'); g(100, 'AcDbBlockTableRecord'); g(2, '*Paper_Space')
  g(0, 'ENDTAB')
  g(0, 'ENDSEC')

  // BLOCKS
  g(0, 'SECTION'); g(2, 'BLOCKS')
  for (const [name, rec, mark] of [['*Model_Space', hModelRec, 0], ['*Paper_Space', hPaperRec, 1]]) {
    g(0, 'BLOCK'); g(5, H()); g(330, rec); g(100, 'AcDbEntity'); if (mark) g(67, 1); g(8, 0); g(100, 'AcDbBlockBegin'); g(2, name); g(70, 0); g(10, 0); g(20, 0); g(30, 0); g(3, name); g(1, '')
    g(0, 'ENDBLK'); g(5, H()); g(330, rec); g(100, 'AcDbEntity'); if (mark) g(67, 1); g(8, 0); g(100, 'AcDbBlockEnd')
  }
  g(0, 'ENDSEC')

  // ENTITIES
  g(0, 'SECTION'); g(2, 'ENTITIES')
  const common = (type, e, sub) => {
    g(0, type); g(5, H()); g(330, hModelRec); g(100, 'AcDbEntity'); g(8, layerName(e.layer))
    if (e.ltype) g(6, LT_NAME[e.ltype] || 'Continuous')
    if (e.color) { g(62, aciOf(e.color)); g(420, parseInt(e.color.slice(1), 16)) }
    if (e.lw != null) g(370, lwCode(e.lw))
    if (sub) g(100, sub)
  }
  const pt3 = (c, p) => { g(c, num(p.x)); g(c + 10, num(p.y)); g(c + 20, 0) }
  const writeText = (e, x, y, str) => {
    common('TEXT', e, 'AcDbText')
    const align = e.align || 'l'
    pt3(10, { x, y })
    g(40, num(e.h)); g(1, encodeDxfText(str)); g(50, num((e.rot || 0) * R2D)); g(7, 'Standard')
    if (align !== 'l') { g(72, align === 'c' ? 1 : 2); pt3(11, { x, y }) }
    g(100, 'AcDbText'); g(73, 0)
  }
  for (const orig of st.ents) {
    for (const e of orig.type === 'dim' ? explode(orig) : [orig]) {
      switch (e.type) {
        case 'line': common('LINE', e, 'AcDbLine'); pt3(10, { x: e.x1, y: e.y1 }); pt3(11, { x: e.x2, y: e.y2 }); break
        case 'circle': common('CIRCLE', e, 'AcDbCircle'); pt3(10, { x: e.cx, y: e.cy }); g(40, num(e.r)); break
        case 'arc': common('ARC', e, 'AcDbCircle'); pt3(10, { x: e.cx, y: e.cy }); g(40, num(e.r)); g(100, 'AcDbArc'); g(50, num(norm(e.a0) * R2D)); g(51, num(norm(e.a1) * R2D)); break
        case 'ellipse':
          common('ELLIPSE', e, 'AcDbEllipse'); pt3(10, { x: e.cx, y: e.cy }); pt3(11, { x: e.mx, y: e.my }); g(210, 0); g(220, 0); g(230, 1)
          g(40, num(e.ratio)); g(41, num(e.t0)); g(42, num(e.t1)); break
        case 'polyline':
          common('LWPOLYLINE', e, 'AcDbPolyline'); g(90, e.pts.length); g(70, e.closed ? 1 : 0); g(43, 0)
          for (const v of e.pts) { g(10, num(v.x)); g(20, num(v.y)); if (v.b) g(42, num(v.b)) }
          break
        case 'text': {
          const rot = e.rot || 0
          textLines(e.text).forEach((line, i) => {
            if (!line) return
            const drop = i * e.h * 1.35
            writeText(e, e.x + Math.sin(rot) * drop, e.y - Math.cos(rot) * drop, line)
          })
          break
        }
        case 'hatch': writeHatch(e); break
        default: break
      }
    }
  }
  function writeHatch(e) {
    const loops = e.loops
    if (e.pattern === 'solid' && loops.length === 1 && loops[0].length <= 4 && loops[0].every((v) => !v.b)) {
      const q = loops[0]
      common('SOLID', e, 'AcDbTrace')
      pt3(10, q[0]); pt3(11, q[1]); pt3(12, q[2] || q[1]); pt3(13, q[3] || q[2] || q[1])
      return
    }
    const pat = HATCH_PATTERNS[e.pattern] || HATCH_PATTERNS.ansi31
    const solid = !pat.lines.length
    common('HATCH', e, 'AcDbHatch')
    g(10, 0); g(20, 0); g(30, 0); g(210, 0); g(220, 0); g(230, 1)
    g(2, solid ? 'SOLID' : e.pattern.toUpperCase()); g(70, solid ? 1 : 0); g(71, 0)
    g(91, loops.length)
    loops.forEach((l, i) => {
      g(92, i === 0 ? 3 : 2)
      g(72, l.some((v) => v.b) ? 1 : 0); g(73, 1); g(93, l.length)
      for (const v of l) { g(10, num(v.x)); g(20, num(v.y)); if (l.some((q) => q.b)) g(42, num(v.b || 0)) }
      g(97, 0)
    })
    g(75, 0); g(76, 1)
    if (!solid) {
      g(52, num(e.angle || 0)); g(41, num(e.scale || 1)); g(77, 0)
      const lines = []
      for (const L of pat.lines) {
        const th = (L.ang + (e.angle || 0)) * D2R
        const step = L.step * (e.scale || 1)
        lines.push({ ang: L.ang + (e.angle || 0), dx: -Math.sin(th) * step, dy: Math.cos(th) * step })
      }
      g(78, lines.length)
      for (const L of lines) { g(53, num(L.ang)); g(43, 0); g(44, 0); g(45, num(L.dx)); g(46, num(L.dy)); g(79, 0) }
    }
    g(47, 1); g(98, 0)
  }
  g(0, 'ENDSEC')
  g(0, 'SECTION'); g(2, 'OBJECTS')
  g(0, 'DICTIONARY'); g(5, H()); g(330, 0); g(100, 'AcDbDictionary'); g(281, 1)
  g(0, 'ENDSEC')

  const head = []
  const hg = (c, v) => head.push(String(c), String(v))
  hg(0, 'SECTION'); hg(2, 'HEADER')
  hg(9, '$ACADVER'); hg(1, 'AC1015')
  hg(9, '$DWGCODEPAGE'); hg(3, 'ANSI_1252')
  hg(9, '$INSBASE'); hg(10, 0); hg(20, 0); hg(30, 0)
  hg(9, '$EXTMIN'); hg(10, num(ext.x0)); hg(20, num(ext.y0)); hg(30, 0)
  hg(9, '$EXTMAX'); hg(10, num(ext.x1)); hg(20, num(ext.y1)); hg(30, 0)
  hg(9, '$LTSCALE'); hg(40, num(st.settings.ltscale || 1))
  hg(9, '$INSUNITS'); hg(70, UNITS[st.settings.units]?.insunits ?? 4)
  hg(9, '$DIMTXT'); hg(40, num(st.settings.dimTh || 2.5))
  hg(9, '$DIMASZ'); hg(40, num(st.settings.dimAs || 2.5))
  hg(9, '$HANDSEED'); hg(5, H())
  hg(0, 'ENDSEC')
  const lines = [...head, ...body, '0', 'EOF']
  return lines.join('\r\n') + '\r\n'
}

