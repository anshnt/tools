// SVG, PDF and PNG export for CAD Studio. The PDF is written here as real vector graphics (no library needed).
import { TAU, angle, bulgeArc, primPoint, emptyBox, growBox } from './_vec.js'
import { prims } from './_ent.js'
import { dimGeom, textWidth, textLines, LINE_GAP } from './_dim.js'
import { LTYPES, UNITS, shade } from './_doc.js'
import { hatchSegments } from './_edit.js'
import { arrowPts } from './_ent.js'
import { drawScene } from './_render.js'

export const PAPERS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841], Letter: [279.4, 215.9], Tabloid: [431.8, 279.4] }
export const SCALES = [['fit', 'Fit to page'], [1, '1:1'], [0.5, '1:2'], [0.2, '1:5'], [0.1, '1:10'], [0.05, '1:20'], [0.02, '1:50'], [0.01, '1:100'], [0.005, '1:200'], [2, '2:1']]

/** Page size, scale and placement for a plot. k = paper millimetres per drawing unit. */
export function layout(doc, o = {}) {
  const ext = o.box || doc.extents() || { x0: 0, y0: 0, x1: 100, y1: 100 }
  const mmU = UNITS[doc.settings.units]?.mm || 1
  const w = Math.max(ext.x1 - ext.x0, 1e-9), h = Math.max(ext.y1 - ext.y0, 1e-9)
  const margin = o.margin ?? 10
  const fit = o.scale === 'fit' || o.scale == null
  let pw, ph, k
  if (o.paper === 'drawing') {
    k = mmU * (fit ? 1 : o.scale)
    pw = w * k + 2 * margin
    ph = h * k + 2 * margin
  } else {
    const base = PAPERS[o.paper] || PAPERS.A4
    const long = Math.max(...base), short = Math.min(...base)
    const land = o.orient === 'landscape' || (o.orient !== 'portrait' && w >= h)
    ;[pw, ph] = land ? [long, short] : [short, long]
    k = fit ? Math.min((pw - 2 * margin) / w, (ph - 2 * margin) / h) : mmU * o.scale
  }
  return { pw, ph, k, tx: (pw - w * k) / 2, ty: (ph - h * k) / 2, ext, w, h, margin, mmU, overflow: w * k > pw - 2 * margin + 1e-6 || h * k > ph - 2 * margin + 1e-6 }
}
export const scaleLabel = (L) => { const r = L.mmU / L.k; return r >= 1 ? `1:${r >= 100 ? Math.round(r) : +r.toFixed(2)}` : `${+(1 / r).toFixed(2)}:1` }

const f = (v) => { const s = (+v).toFixed(4); return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s }
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function styleOf(doc, e, o) {
  const st = doc.style(e)
  return { color: o.mono ? '#000000' : shade(st.color, false), lw: st.lw, dash: (LTYPES[st.ltype] || LTYPES.continuous).dash.map((d) => d * (doc.settings.ltscale || 1)) }
}

/** Ellipse (or circle) parameter range as cubic Bezier segments, each at most 90 degrees. d may be negative. */
function bezierArc(c, ax, ay, t0, sw) {
  const n = Math.max(1, Math.ceil(Math.abs(sw) / (Math.PI / 2) - 1e-9))
  const d = sw / n, kk = (4 / 3) * Math.tan(d / 4)
  const P = (t) => ({ x: c.x + ax.x * Math.cos(t) + ay.x * Math.sin(t), y: c.y + ax.y * Math.cos(t) + ay.y * Math.sin(t) })
  const D = (t) => ({ x: -ax.x * Math.sin(t) + ay.x * Math.cos(t), y: -ax.y * Math.sin(t) + ay.y * Math.cos(t) })
  const out = []
  for (let i = 0; i < n; i++) {
    const ta = t0 + i * d, tb = ta + d
    const p0 = P(ta), p3 = P(tb), da = D(ta), db = D(tb)
    out.push([p0, { x: p0.x + da.x * kk, y: p0.y + da.y * kk }, { x: p3.x - db.x * kk, y: p3.y - db.y * kk }, p3])
  }
  return out
}
const circleAxes = (r) => [{ x: r, y: 0 }, { x: 0, y: r }]

// ---------- SVG ----------
export function toSvg(doc, o = {}) {
  const L = layout(doc, o)
  const k = L.k
  const out = []
  const m = [k, 0, 0, -k, L.tx - L.ext.x0 * k, L.ty + L.ext.y1 * k]
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${f(L.pw)}mm" height="${f(L.ph)}mm" viewBox="0 0 ${f(L.pw)} ${f(L.ph)}">`)
  out.push(`<title>${esc(doc.name || 'Drawing')}</title>`)
  if (o.background) out.push(`<rect width="${f(L.pw)}" height="${f(L.ph)}" fill="${o.background}"/>`)
  out.push(`<g transform="matrix(${m.map(f).join(' ')})" stroke-linecap="butt" stroke-linejoin="round" fill="none">`)
  let clipId = 0
  const byLayer = new Map()
  for (const e of doc.visible()) { if (!byLayer.has(e.layer)) byLayer.set(e.layer, []); byLayer.get(e.layer).push(e) }
  const polyPath = (pts, closed) => {
    let d = `M${f(pts[0].x)} ${f(pts[0].y)}`
    const n = pts.length, last = closed ? n : n - 1
    for (let i = 0; i < last; i++) {
      const p1 = pts[i], p2 = pts[(i + 1) % n]
      const g = bulgeArc(p1, p2, p1.b)
      d += g ? `A${f(g.r)} ${f(g.r)} 0 ${g.sw > Math.PI ? 1 : 0} ${g.ccw ? 1 : 0} ${f(p2.x)} ${f(p2.y)}` : `L${f(p2.x)} ${f(p2.y)}`
    }
    return d + (closed ? 'Z' : '')
  }
  const textEl = (t, color) => {
    const anchor = t.align === 'c' ? 'middle' : t.align === 'r' ? 'end' : 'start'
    const lines = textLines(t.str)
    const spans = lines.map((ln, i) => `<tspan x="0" dy="${i ? f(t.h * LINE_GAP) : 0}">${esc(ln)}</tspan>`).join('')
    return `<text transform="translate(${f(t.x)} ${f(t.y)}) rotate(${f((t.rot || 0) * 180 / Math.PI)}) scale(1 -1)" font-family="Helvetica, Arial, sans-serif" font-size="${f(t.h)}" text-anchor="${anchor}" fill="${color}" stroke="none">${spans}</text>`
  }
  const arrowEl = (a, size, color) => `<path d="M${arrowPts(a.tip, a.dir, size).map((p) => `${f(p.x)} ${f(p.y)}`).join('L')}Z" fill="${color}" stroke="none"/>`
  for (const [layer, ents] of byLayer) {
    out.push(`<g id="${esc('layer-' + layer)}">`)
    for (const e of ents) {
      const s = styleOf(doc, e, o)
      const stroke = `stroke="${s.color}" stroke-width="${f(Math.max(s.lw, 0.05) / k)}"${s.dash.length ? ` stroke-dasharray="${s.dash.map(f).join(' ')}"` : ''}`
      switch (e.type) {
        case 'line': out.push(`<path d="M${f(e.x1)} ${f(e.y1)}L${f(e.x2)} ${f(e.y2)}" ${stroke}/>`); break
        case 'circle': out.push(`<circle cx="${f(e.cx)}" cy="${f(e.cy)}" r="${f(e.r)}" ${stroke}/>`); break
        case 'arc': case 'ellipse': {
          const p = prims(e)[0]
          const a = primPoint(p, 0), b = primPoint(p, p.sw)
          const rx = p.k === 'a' ? p.r : Math.hypot(p.ax.x, p.ax.y), ry = p.k === 'a' ? p.r : Math.hypot(p.ay.x, p.ay.y)
          const rot = p.k === 'a' ? 0 : Math.atan2(p.ax.y, p.ax.x) * 180 / Math.PI
          let d
          if (p.sw >= TAU - 1e-9) { const mid = primPoint(p, p.sw / 2); d = `M${f(a.x)} ${f(a.y)}A${f(rx)} ${f(ry)} ${f(rot)} 1 1 ${f(mid.x)} ${f(mid.y)}A${f(rx)} ${f(ry)} ${f(rot)} 1 1 ${f(a.x)} ${f(a.y)}Z` }
          else d = `M${f(a.x)} ${f(a.y)}A${f(rx)} ${f(ry)} ${f(rot)} ${p.sw > Math.PI ? 1 : 0} 1 ${f(b.x)} ${f(b.y)}`
          out.push(`<path d="${d}" ${stroke}/>`)
          break
        }
        case 'polyline': out.push(`<path d="${polyPath(e.pts, e.closed)}" ${stroke}/>`); break
        case 'text': out.push(textEl({ x: e.x, y: e.y, h: e.h, str: e.text, rot: e.rot, align: e.align }, s.color)); break
        case 'dim': {
          const g = dimGeom(e)
          const d = g.lines.map(([a, b]) => `M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`).join('') + g.arcs.map((a) => { const p0 = { x: a.c.x + Math.cos(a.a0) * a.r, y: a.c.y + Math.sin(a.a0) * a.r }, p1 = { x: a.c.x + Math.cos(a.a0 + a.sw) * a.r, y: a.c.y + Math.sin(a.a0 + a.sw) * a.r }; return `M${f(p0.x)} ${f(p0.y)}A${f(a.r)} ${f(a.r)} 0 ${a.sw > Math.PI ? 1 : 0} 1 ${f(p1.x)} ${f(p1.y)}` }).join('')
          out.push(`<g ${stroke}><path d="${d}"/>${g.arrows.map((a) => arrowEl(a, e.as ?? e.th, s.color)).join('')}${g.texts.map((t) => textEl(t, s.color)).join('')}</g>`)
          break
        }
        case 'hatch': {
          const region = e.loops.map((l) => polyPath(l, true)).join('')
          const box = emptyBox(); for (const l of e.loops) for (const p of l) growBox(box, p)
          const lines = hatchSegments(e, box)
          if (!lines) { out.push(`<path d="${region}" fill="${s.color}" fill-rule="evenodd" stroke="none"/>`); break }
          const id = `h${++clipId}`
          out.push(`<clipPath id="${id}"><path d="${region}" clip-rule="evenodd"/></clipPath><path clip-path="url(#${id})" d="${lines.map(([a, b]) => `M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`).join('')}" ${stroke}/>`)
          break
        }
        default: break
      }
    }
    out.push('</g>')
  }
  out.push('</g></svg>')
  return out.join('\n')
}

// ---------- PDF ----------
const winBytes = (s) => { let r = ''; for (const ch of String(s)) { const c = ch.charCodeAt(0); r += c === 0x2013 ? '-' : c < 256 ? ch : '?' } return r }
const pdfEsc = (s) => winBytes(s).replace(/[\\()]/g, (c) => '\\' + c).replace(/[\r\n]/g, ' ')
const rgb = (hex) => { const n = parseInt(String(hex).slice(1), 16); return `${f(((n >> 16) & 255) / 255)} ${f(((n >> 8) & 255) / 255)} ${f((n & 255) / 255)}` }
const latin = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b }

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null
  const cs = new CompressionStream('deflate')
  const w = cs.writable.getWriter()
  w.write(bytes); w.close()
  return new Uint8Array(await new Response(cs.readable).arrayBuffer())
}

export async function toPdf(doc, o = {}) {
  const L = layout(doc, o)
  const k = L.k
  const pt = 72 / 25.4
  const c = []
  const kp = k * pt
  c.push('q', `${f(kp)} 0 0 ${f(kp)} ${f((L.tx - L.ext.x0 * k) * pt)} ${f((L.ph - L.ty - L.ext.y1 * k) * pt)} cm`)
  c.push('1 J 1 j')
  const polyOps = (pts, closed) => {
    const ops = [`${f(pts[0].x)} ${f(pts[0].y)} m`]
    const n = pts.length, last = closed ? n : n - 1
    for (let i = 0; i < last; i++) {
      const p1 = pts[i], p2 = pts[(i + 1) % n]
      const g = bulgeArc(p1, p2, p1.b)
      if (g) {
        const [ax, ay] = circleAxes(g.r)
        const a1 = angle(g.c, p1)
        for (const [, c1, c2, p3] of bezierArc(g.c, ax, ay, a1, g.ccw ? g.sw : -g.sw)) ops.push(`${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p3.x)} ${f(p3.y)} c`)
      } else ops.push(`${f(p2.x)} ${f(p2.y)} l`)
    }
    if (closed) ops.push('h')
    return ops
  }
  const arcOps = (cn, ax, ay, t0, sw, move = true) => {
    const segs = bezierArc(cn, ax, ay, t0, sw)
    const ops = move ? [`${f(segs[0][0].x)} ${f(segs[0][0].y)} m`] : []
    for (const [, c1, c2, p3] of segs) ops.push(`${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p3.x)} ${f(p3.y)} c`)
    return ops
  }
  const textOps = (t, color) => {
    const res = []
    const rot = t.rot || 0
    const co = Math.cos(rot), si = Math.sin(rot)
    textLines(t.str).forEach((ln, i) => {
      const w = textWidth(ln, t.h)
      const off = t.align === 'c' ? -w / 2 : t.align === 'r' ? -w : 0
      const drop = i * t.h * LINE_GAP
      const x = t.x + co * off + si * drop, y = t.y + si * off - co * drop
      res.push(`BT /F1 ${f(t.h)} Tf ${rgb(color)} rg ${f(co)} ${f(si)} ${f(-si)} ${f(co)} ${f(x)} ${f(y)} Tm (${pdfEsc(ln)}) Tj ET`)
    })
    return res
  }
  const arrowOps = (a, size, color) => [`${rgb(color)} rg`, ...arrowPts(a.tip, a.dir, size).map((p, i) => `${f(p.x)} ${f(p.y)} ${i ? 'l' : 'm'}`), 'f']
  for (const e of doc.visible()) {
    const s = styleOf(doc, e, o)
    c.push('q', `${rgb(s.color)} RG`, `${f(Math.max(s.lw, 0.05) / k)} w`, s.dash.length ? `[${s.dash.map(f).join(' ')}] 0 d` : '[] 0 d')
    switch (e.type) {
      case 'line': c.push(`${f(e.x1)} ${f(e.y1)} m ${f(e.x2)} ${f(e.y2)} l S`); break
      case 'circle': c.push(...arcOps({ x: e.cx, y: e.cy }, ...circleAxes(e.r), 0, TAU), 'S'); break
      case 'arc': case 'ellipse': {
        const p = prims(e)[0]
        const [ax, ay] = p.k === 'a' ? circleAxes(p.r) : [p.ax, p.ay]
        c.push(...arcOps(p.c, ax, ay, p.k === 'a' ? p.a0 : p.t0, p.sw), p.sw >= TAU - 1e-9 ? 'h S' : 'S')
        break
      }
      case 'polyline': c.push(...polyOps(e.pts, e.closed), 'S'); break
      case 'text': c.push(...textOps({ x: e.x, y: e.y, h: e.h, str: e.text, rot: e.rot, align: e.align }, s.color)); break
      case 'dim': {
        const g = dimGeom(e)
        for (const [a, b] of g.lines) c.push(`${f(a.x)} ${f(a.y)} m ${f(b.x)} ${f(b.y)} l S`)
        for (const a of g.arcs) c.push(...arcOps(a.c, ...circleAxes(a.r), a.a0, a.sw), 'S')
        for (const a of g.arrows) c.push(...arrowOps(a, e.as ?? e.th, s.color))
        for (const t of g.texts) c.push(...textOps(t, s.color))
        break
      }
      case 'hatch': {
        const region = e.loops.flatMap((l) => polyOps(l, true))
        const box = emptyBox(); for (const l of e.loops) for (const p of l) growBox(box, p)
        const lines = hatchSegments(e, box)
        if (!lines) { c.push(`${rgb(s.color)} rg`, ...region, 'f*'); break }
        c.push(...region, 'W* n')
        c.push(...lines.map(([a, b]) => `${f(a.x)} ${f(a.y)} m ${f(b.x)} ${f(b.y)} l`), 'S')
        break
      }
      default: break
    }
    c.push('Q')
  }
  c.push('Q')
  const raw = latin(c.join('\n'))
  const packed = await deflate(raw)
  const parts = []
  const offsets = []
  let size = 0
  const push = (u8) => { parts.push(u8); size += u8.length }
  const str = (s) => push(latin(s))
  const obj = (n, body) => { offsets[n] = size; str(`${n} 0 obj\n${body}\nendobj\n`) }
  str('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(L.pw * pt)} ${f(L.ph * pt)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`)
  offsets[4] = size
  const data = packed || raw
  str(`4 0 obj\n<< /Length ${data.length}${packed ? ' /Filter /FlateDecode' : ''} >>\nstream\n`)
  push(data)
  str('\nendstream\nendobj\n')
  obj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  obj(6, `<< /Title (${pdfEsc(doc.name || 'Drawing')}) /Producer (CAD Studio) >>`)
  const xref = size
  str(`xref\n0 7\n0000000000 65535 f \n${[1, 2, 3, 4, 5, 6].map((i) => String(offsets[i]).padStart(10, '0') + ' 00000 n \n').join('')}`)
  str(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(parts, { type: 'application/pdf' })
}

// ---------- PNG ----------
/** Render the whole drawing to a canvas about `px` pixels wide. */
export function renderCanvas(doc, o = {}) {
  const ext = o.box || doc.extents() || { x0: 0, y0: 0, x1: 100, y1: 100 }
  const w = Math.max(ext.x1 - ext.x0, 1e-9), h = Math.max(ext.y1 - ext.y0, 1e-9)
  const px = o.px || 2000
  const pad = Math.round(px * 0.03)
  let cw = px, scale = (px - 2 * pad) / w
  let ch = Math.round(h * scale + 2 * pad)
  const maxH = Math.min(o.maxPx || 8000, Math.floor(36e6 / px))
  if (ch > maxH) { scale *= maxH / ch; ch = maxH; cw = Math.round(w * scale + 2 * pad) }
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  const view = { cx: (ext.x0 + ext.x1) / 2, cy: (ext.y0 + ext.y1) / 2, scale, w: cw, h: ch }
  const q = Math.max(1, cw / 1200)
  drawScene(ctx, doc, view, 1, { bg: o.transparent ? null : '#ffffff', dark: false, mono: !!o.mono, lwPx: (lw) => Math.max(1, (0.4 + lw * 2.4) * q) })
  return canvas
}
export const toPngBlob = (doc, o) => new Promise((res, rej) => renderCanvas(doc, o).toBlob((b) => (b ? res(b) : rej(new Error('Could not create the image. Try a smaller size.'))), 'image/png'))

