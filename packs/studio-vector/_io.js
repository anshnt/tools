// Import/export plumbing for Vector Studio: PNG and PDF export, project files, and strict validation of untrusted documents.
import { script } from '../../lib/libs.js'
import { canvas, toBlob } from '../../lib/image.js'
import { exportSvg } from './_svg.js'
import { newDoc } from './_model.js'

const JSPDF = 'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js'
const SVG2PDF = 'https://cdn.jsdelivr.net/npm/svg2pdf.js@2.7.0/dist/svg2pdf.umd.min.js'

/** Render the artboard to a PNG at `scale` (1 = artboard pixels). */
export async function exportPng(doc, scale = 1, transparent = false) {
  const w = Math.max(1, Math.round(doc.ab.w * scale)), h = Math.max(1, Math.round(doc.ab.h * scale))
  const c = canvas(w, h) // throws a friendly error when too large for this device
  const svg = exportSvg(doc, { transparent, scale })
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0, w, h)
  } finally { URL.revokeObjectURL(url) }
  return toBlob(c, 'image/png')
}

/** Vector PDF with the artboard as the page (1 px = 0.75 pt). Text uses the standard PDF fonts closest to the chosen family. */
export async function exportPdf(doc, transparent = false) {
  await script(JSPDF)
  await script(SVG2PDF)
  const { jsPDF } = window.jspdf
  const w = doc.ab.w * 0.75, h = doc.ab.h * 0.75
  const pdf = new jsPDF({ unit: 'pt', format: [w, h], orientation: w > h ? 'landscape' : 'portrait', compress: true })
  const el = document.importNode(new DOMParser().parseFromString(exportSvg(doc, { transparent }), 'image/svg+xml').documentElement, true)
  const host = document.createElement('div')
  host.setAttribute('style', 'position:fixed;left:-99999px;top:0;pointer-events:none;visibility:hidden')
  host.append(el)
  document.body.append(host)
  try {
    const s2p = window.svg2pdf?.svg2pdf || window.svg2pdf
    await s2p(el, pdf, { x: 0, y: 0, width: w, height: h })
  } finally { host.remove() }
  return pdf.output('blob')
}

export const projectBlob = (doc) => new Blob([JSON.stringify({ app: 'vector-studio', v: 1, doc })], { type: 'application/json' })

export async function readProject(file) {
  let raw
  try { raw = JSON.parse(await file.text()) } catch { throw new Error('This is not a Vector Studio project file.') }
  if (!raw || raw.app !== 'vector-studio' || !raw.doc) throw new Error('This is not a Vector Studio project file.')
  return cleanDoc(raw.doc)
}

// ---------- Validation: rebuild a document from untrusted JSON ----------
const fin = (v, d = 0) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : d)
const clamp01 = (v) => Math.min(1, Math.max(0, fin(v, 1)))
const col = (v) => (/^#[0-9a-f]{6}$/i.test(v) ? String(v).toLowerCase() : '#000000')
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '')
const oneOf = (v, list, d) => (list.includes(v) ? v : d)
const mat = (t) => (Array.isArray(t) && t.length === 6 && t.every((x) => Number.isFinite(+x)) ? t.map(Number) : undefined)

function cleanPaint(p) {
  if (!p || typeof p !== 'object') return null
  if (p.t === 'solid') return { t: 'solid', c: col(p.c), a: clamp01(p.a) }
  if (p.t !== 'linear' && p.t !== 'radial') return null
  const stops = (Array.isArray(p.stops) ? p.stops : []).slice(0, 24).map((s) => ({ o: clamp01(s?.o), c: col(s?.c), a: clamp01(s?.a) }))
  if (stops.length < 2) return null
  return p.t === 'linear'
    ? { t: 'linear', stops, x1: fin(p.x1, 0), y1: fin(p.y1, 0), x2: fin(p.x2, 1), y2: fin(p.y2, 0) }
    : { t: 'radial', stops, cx: fin(p.cx, 0.5), cy: fin(p.cy, 0.5), r: Math.max(0.001, fin(p.r, 0.5)), fx: fin(p.fx, fin(p.cx, 0.5)), fy: fin(p.fy, fin(p.cy, 0.5)) }
}

export function cleanDoc(raw) {
  const doc = newDoc()
  const ab = raw?.ab || {}
  doc.ab = { w: Math.min(20000, Math.max(1, fin(ab.w, 1200))), h: Math.min(20000, Math.max(1, fin(ab.h, 800))), bg: col(ab.bg ?? '#ffffff'), transparent: !!ab.transparent }
  let seq = Math.max(0, Math.floor(fin(raw?.seq, 0)))
  const used = new Set()
  const clean = (n, depth) => {
    if (!n || typeof n !== 'object' || depth > 30) return null
    const type = oneOf(n.type, ['group', 'rect', 'ellipse', 'path', 'text', 'image'], null)
    if (!type) return null
    let id = /^n\d+$/.test(n.id) && !used.has(n.id) ? n.id : null
    if (!id) { do id = 'n' + ++seq; while (used.has(id)) }
    used.add(id)
    seq = Math.max(seq, parseInt(id.slice(1)) || 0)
    const o = { id, type, name: str(n.name, 80), vis: n.vis !== false, lock: !!n.lock, op: clamp01(n.op) }
    if (type === 'group') { o.kids = (Array.isArray(n.kids) ? n.kids : []).map((k) => clean(k, depth + 1)).filter(Boolean); return o }
    if (type !== 'image') {
      o.fill = cleanPaint(n.fill); o.stroke = cleanPaint(n.stroke); o.sw = Math.max(0, fin(n.sw, 1))
      o.dash = /^[\d.\s]*$/.test(n.dash || '') ? str(n.dash, 60) : ''
      o.cap = oneOf(n.cap, ['butt', 'round', 'square'], 'butt'); o.join = oneOf(n.join, ['miter', 'round', 'bevel'], 'miter')
      o.ml = Math.max(1, fin(n.ml, 4)); o.rule = oneOf(n.rule, ['nonzero', 'evenodd'], 'nonzero')
    }
    const t = mat(n.t)
    if (type === 'rect') Object.assign(o, { x: fin(n.x), y: fin(n.y), w: Math.max(0, fin(n.w)), h: Math.max(0, fin(n.h)), rx: Math.max(0, fin(n.rx)), ry: Math.max(0, fin(n.ry, fin(n.rx))) })
    else if (type === 'ellipse') Object.assign(o, { cx: fin(n.cx), cy: fin(n.cy), rx: Math.max(0, fin(n.rx)), ry: Math.max(0, fin(n.ry)) })
    else if (type === 'path') {
      o.subs = (Array.isArray(n.subs) ? n.subs : []).slice(0, 5000).map((s) => ({ closed: !!s?.closed, pts: (Array.isArray(s?.pts) ? s.pts : []).slice(0, 100000).map((p) => ({ x: fin(p?.x), y: fin(p?.y), ix: fin(p?.ix), iy: fin(p?.iy), ox: fin(p?.ox), oy: fin(p?.oy) })) })).filter((s) => s.pts.length)
    } else if (type === 'text') {
      Object.assign(o, { x: fin(n.x), y: fin(n.y), text: str(n.text, 20000), ff: str(n.ff, 160).replace(/[<>{};]/g, ''), fs: Math.max(1, fin(n.fs, 24)), fw: Math.min(900, Math.max(100, fin(n.fw, 400))), fi: !!n.fi, ta: oneOf(n.ta, ['start', 'middle', 'end'], 'start'), lh: Math.max(0.5, fin(n.lh, 1.2)), ls: fin(n.ls) })
    } else if (type === 'image') {
      if (!/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(n.href || '')) return null
      Object.assign(o, { x: fin(n.x), y: fin(n.y), w: Math.max(0, fin(n.w)), h: Math.max(0, fin(n.h)), href: n.href })
    }
    if (t) o.t = t
    return o
  }
  doc.nodes = (Array.isArray(raw?.nodes) ? raw.nodes : []).map((n) => clean(n, 0)).filter(Boolean)
  doc.seq = seq
  return doc
}
