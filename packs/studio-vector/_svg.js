// SVG output for Vector Studio. One renderer feeds both the live canvas and the exported file, so what you see is what you save.
import { subsToD } from './_geom.js'
import { toSubs } from './_model.js'

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const num = (v) => { const r = Math.round(v * 1000) / 1000; return Object.is(r, -0) ? '0' : String(r) }
const matrixAttr = (t) => (t ? ` transform="matrix(${t.map(num).join(' ')})"` : '')

function gradientDef(p, id) {
  const stops = [...p.stops].sort((a, b) => a.o - b.o).map((s) => `<stop offset="${num(s.o)}" stop-color="${esc(s.c)}"${s.a < 1 ? ` stop-opacity="${num(s.a)}"` : ''}/>`).join('')
  if (p.t === 'linear') return `<linearGradient id="${id}" x1="${num(p.x1)}" y1="${num(p.y1)}" x2="${num(p.x2)}" y2="${num(p.y2)}">${stops}</linearGradient>`
  const fx = p.fx ?? p.cx, fy = p.fy ?? p.cy
  return `<radialGradient id="${id}" cx="${num(p.cx)}" cy="${num(p.cy)}" r="${num(p.r)}" fx="${num(fx)}" fy="${num(fy)}">${stops}</radialGradient>`
}

function paintAttr(kind, p, n, ctx) {
  if (!p) return kind === 'fill' ? ' fill="none"' : ''
  if (p.t === 'solid') return ` ${kind}="${esc(p.c)}"${p.a < 1 ? ` ${kind}-opacity="${num(p.a)}"` : ''}`
  const id = ctx.canvas ? `g-${n.id}-${kind[0]}` : `grad${++ctx.gid}`
  ctx.defs.push(gradientDef(p, id))
  return ` ${kind}="url(#${id})"`
}

function styleAttrs(n, ctx) {
  let s = paintAttr('fill', n.fill, n, ctx) + paintAttr('stroke', n.stroke, n, ctx)
  if (n.stroke && n.sw > 0) {
    if (n.sw !== 1) s += ` stroke-width="${num(n.sw)}"`
    if (n.dash) s += ` stroke-dasharray="${esc(n.dash)}"`
    if (n.cap && n.cap !== 'butt') s += ` stroke-linecap="${esc(n.cap)}"`
    if (n.join && n.join !== 'miter') s += ` stroke-linejoin="${esc(n.join)}"`
    else if (n.ml && n.ml !== 4) s += ` stroke-miterlimit="${num(n.ml)}"`
  }
  if (n.rule === 'evenodd') s += ' fill-rule="evenodd"'
  return s
}

function geomAttrs(n) {
  switch (n.type) {
    case 'rect': return `x="${num(n.x)}" y="${num(n.y)}" width="${num(n.w)}" height="${num(n.h)}"${n.rx ? ` rx="${num(n.rx)}" ry="${num(n.ry ?? n.rx)}"` : ''}`
    case 'ellipse': return `cx="${num(n.cx)}" cy="${num(n.cy)}" rx="${num(n.rx)}" ry="${num(n.ry)}"`
    default: return ''
  }
}
const TAG = { rect: 'rect', ellipse: 'ellipse', path: 'path' }

function textSvg(n, extra, ctx) {
  const lines = n.text.split('\n')
  const a = `font-family="${esc(n.ff)}" font-size="${num(n.fs)}"${n.fw && n.fw !== 400 ? ` font-weight="${n.fw}"` : ''}${n.fi ? ' font-style="italic"' : ''}${n.ta && n.ta !== 'start' ? ` text-anchor="${esc(n.ta)}"` : ''}${n.ls ? ` letter-spacing="${num(n.ls)}"` : ''}`
  const body = lines.map((ln, i) => (ln === '' ? '' : `<tspan x="${num(n.x)}" y="${num(n.y + i * n.fs * n.lh)}">${esc(ln)}</tspan>`)).join('')
  return `<text ${a}${styleAttrs(n, ctx)}${matrixAttr(n.t)} xml:space="preserve"${extra}>${body}</text>`
}

function imageSvg(n, extra, ctx) {
  return `<image x="${num(n.x)}" y="${num(n.y)}" width="${num(n.w)}" height="${num(n.h)}" preserveAspectRatio="none" href="${esc(n.href)}"${ctx.canvas ? '' : ` xlink:href="${esc(n.href)}"`}${matrixAttr(n.t)}${extra}/>`
}

/** SVG markup for one node. ctx: {canvas, defs, gid}. */
export function nodeSvg(n, ctx) {
  if (!n.vis || ctx.skip === n.id) return ''
  const o = n.op < 1 ? ` opacity="${num(n.op)}"` : ''
  const ed = ctx.canvas ? ` data-id="${n.id}"${n.lock ? ' data-lock="1"' : ''}` : ''
  if (n.type === 'group') {
    const inner = n.kids.map((k) => nodeSvg(k, ctx)).join(ctx.canvas ? '' : '\n')
    if (!inner) return ''
    return `<g${idAttr(n, ctx)}${o}${ed}>${ctx.canvas ? '' : '\n'}${inner}${ctx.canvas ? '' : '\n'}</g>`
  }
  if (n.type === 'text') return textSvg(n, o + ed, ctx)
  if (n.type === 'image') return imageSvg(n, o + ed, ctx)
  const tag = TAG[n.type]
  const geom = n.type === 'path' ? `d="${subsToD(n.subs)}"` : geomAttrs(n)
  let out = `<${tag}${idAttr(n, ctx)} ${geom}${styleAttrs(n, ctx)}${matrixAttr(n.t)}${o}${ed}/>`
  if (ctx.canvas && n.stroke && n.sw > 0 && n.sw < 10) {
    // transparent, wider copy of the stroke so thin lines are easy to click (constant on-screen width)
    out += `<${tag} ${geom} fill="none" stroke="transparent" stroke-width="12" vector-effect="non-scaling-stroke" pointer-events="stroke"${matrixAttr(n.t)}${ed} data-hit="1"/>`
  }
  return out
}
const idOf = (s) => String(s).trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').replace(/^(\d)/, 'n$1')
/** id="..." from the layer name in exported files (unique, SVG-safe); nothing in the live canvas. */
function idAttr(n, ctx) {
  if (ctx.canvas || !n.name) return ''
  const base = idOf(n.name)
  if (!base) return ''
  let id = base, i = 1
  while (ctx.ids.has(id)) id = `${base}-${++i}`
  ctx.ids.add(id)
  return ` id="${esc(id)}"`
}

/** Markup of the artwork (everything inside the artboard's SVG), canvas or export flavour. */
export function artSvg(doc, { canvas = false, skip = null } = {}) {
  const ctx = { canvas, skip, defs: [], gid: 0, ids: new Set() }
  const body = doc.nodes.map((n) => nodeSvg(n, ctx)).join(canvas ? '' : '\n')
  return { defs: ctx.defs.join(canvas ? '' : '\n'), body, hasImage: /<image /.test(body) }
}

/** A clean, standalone SVG file for the artboard. */
export function exportSvg(doc, { transparent = doc.ab.transparent, scale = 1 } = {}) {
  const { w, h, bg } = doc.ab
  const { defs, body, hasImage } = artSvg(doc)
  const dim = scale === 1 ? `width="${num(w)}" height="${num(h)}"` : `width="${num(w * scale)}" height="${num(h * scale)}"`
  return `<svg xmlns="http://www.w3.org/2000/svg"${hasImage ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : ''} ${dim} viewBox="0 0 ${num(w)} ${num(h)}">\n`
    + (defs ? `<defs>\n${defs}\n</defs>\n` : '')
    + (transparent ? '' : `<rect width="${num(w)}" height="${num(h)}" fill="${esc(bg)}"/>\n`)
    + body + '\n</svg>\n'
}

/** Path data of any shape in document coordinates (used by boolean ops). */
export const nodeD = (n) => { const s = toSubs(n); return s ? subsToD(s) : '' }
