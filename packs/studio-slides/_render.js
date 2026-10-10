// Renders a slide to DOM. One renderer serves the editor, thumbnails, present mode, the presenter window and PNG/PDF export
// (export serialises this same DOM into an SVG foreignObject, so what you see is what you export).
import { h, svg } from '../../lib/ui.js'
import { fontStack, hexToRgb, linePoints } from './_model.js'
import { colorOf, fontOf, bgOf, decorOf } from './_themes.js'

export const rgba = (hex, a) => { const c = hexToRgb(hex); return c ? `rgba(${c[0]},${c[1]},${c[2]},${a})` : hex }
export const bgCss = (bg) => (bg.c2 ? `linear-gradient(${bg.ang}deg, ${bg.c1}, ${bg.c2})` : bg.c1)
const PH_HINT = { title: 'Click to add title', subtitle: 'Click to add subtitle', body: 'Click to add text', body2: 'Click to add text', caption: 'Add a caption' }

/** SVG path for a preset shape inside a w x h box. */
export function shapePath(kind, w, h, rad = 0.2) {
  const m = Math.min(w, h)
  const poly = (pts) => `M${pts.map((p) => `${+p[0].toFixed(2)} ${+p[1].toFixed(2)}`).join('L')}Z`
  const star = (n, inner) => poly(Array.from({ length: n * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / n, r = i % 2 ? inner : 1
    return [w / 2 + (Math.cos(a) * r * w) / 2, h / 2 + (Math.sin(a) * r * h) / 2]
  }))
  switch (kind) {
    case 'roundRect': { const r = Math.min(m / 2, Math.max(0, rad) * m); return `M${r} 0H${w - r}Q${w} 0 ${w} ${r}V${h - r}Q${w} ${h} ${w - r} ${h}H${r}Q0 ${h} 0 ${h - r}V${r}Q0 0 ${r} 0Z` }
    case 'ellipse': return `M0 ${h / 2}A${w / 2} ${h / 2} 0 1 0 ${w} ${h / 2}A${w / 2} ${h / 2} 0 1 0 0 ${h / 2}Z`
    case 'donut': { const t = 0.22, iw = w * (1 - t * 2) / 2, ih = h * (1 - t * 2) / 2
      return `M0 ${h / 2}A${w / 2} ${h / 2} 0 1 0 ${w} ${h / 2}A${w / 2} ${h / 2} 0 1 0 0 ${h / 2}ZM${w / 2 - iw} ${h / 2}A${iw} ${ih} 0 1 1 ${w / 2 + iw} ${h / 2}A${iw} ${ih} 0 1 1 ${w / 2 - iw} ${h / 2}Z` }
    case 'triangle': return poly([[w / 2, 0], [w, h], [0, h]])
    case 'rtTriangle': return poly([[0, 0], [w, h], [0, h]])
    case 'diamond': return poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]])
    case 'pentagon': return poly([[w / 2, 0], [w, h * 0.38], [w * 0.81, h], [w * 0.19, h], [0, h * 0.38]])
    case 'hexagon': return poly([[w * 0.25, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [w * 0.25, h], [0, h / 2]])
    case 'octagon': { const c = m * 0.29; return poly([[c, 0], [w - c, 0], [w, c], [w, h - c], [w - c, h], [c, h], [0, h - c], [0, c]]) }
    case 'parallelogram': return poly([[w * 0.2, 0], [w, 0], [w * 0.8, h], [0, h]])
    case 'trapezoid': return poly([[w * 0.2, 0], [w * 0.8, 0], [w, h], [0, h]])
    case 'star4': return star(4, 0.4)
    case 'star5': return star(5, 0.4)
    case 'rightArrow': return poly([[0, h * 0.26], [w * 0.62, h * 0.26], [w * 0.62, 0], [w, h / 2], [w * 0.62, h], [w * 0.62, h * 0.74], [0, h * 0.74]])
    case 'leftArrow': return poly([[w, h * 0.26], [w * 0.38, h * 0.26], [w * 0.38, 0], [0, h / 2], [w * 0.38, h], [w * 0.38, h * 0.74], [w, h * 0.74]])
    case 'chevron': return poly([[0, 0], [w * 0.7, 0], [w, h / 2], [w * 0.7, h], [0, h], [w * 0.3, h / 2]])
    case 'mathPlus': { const a = 0.34, x1 = w * (0.5 - a / 2), x2 = w * (0.5 + a / 2), y1 = h * (0.5 - a / 2), y2 = h * (0.5 + a / 2)
      return poly([[x1, 0], [x2, 0], [x2, y1], [w, y1], [w, y2], [x2, y2], [x2, h], [x1, h], [x1, y2], [0, y2], [0, y1], [x1, y1]]) }
    case 'heart': return `M${w / 2} ${h}C${-w * 0.12} ${h * 0.56} ${w * 0.02} ${-h * 0.06} ${w / 2} ${h * 0.28}C${w * 0.98} ${-h * 0.06} ${w * 1.12} ${h * 0.56} ${w / 2} ${h}Z`
    case 'wedgeRoundRectCallout': { const r = Math.min(m * 0.12, 24), bh = h * 0.8
      return `M${r} 0H${w - r}Q${w} 0 ${w} ${r}V${bh - r}Q${w} ${bh} ${w - r} ${bh}H${w * 0.42}L${w * 0.16} ${h}L${w * 0.26} ${bh}H${r}Q0 ${bh} 0 ${bh - r}V${r}Q0 0 ${r} 0Z` }
    default: return `M0 0H${w}V${h}H0Z`
  }
}

const dashOf = (dash, sw) => (dash === 'dash' ? `${sw * 3} ${sw * 2}` : dash === 'dot' ? `${sw} ${sw * 1.6}` : null)

// ---------- Text ----------
function runNode(deck, r, tx) {
  const st = {}
  if (r.b !== undefined) st.fontWeight = r.b ? 700 : 400
  if (r.i !== undefined) st.fontStyle = r.i ? 'italic' : 'normal'
  if (r.u) st.textDecoration = 'underline'
  if (r.c) st.color = colorOf(deck, r.c)
  if (r.s) st.fontSize = `${r.s}px`
  if (r.f) st.fontFamily = fontStack(fontOf(deck, r.f))
  if (r.hl) st.backgroundColor = colorOf(deck, r.hl)
  return Object.keys(st).length ? h('span', { style: st }, r.t) : document.createTextNode(r.t)
}

export function textBlock(deck, e, o = {}) {
  const tx = e.tx
  const hint = o.mode === 'edit' && e.ph && !(tx.paras || []).some((p) => p.runs.some((r) => r.t)) ? PH_HINT[e.ph] : ''
  const paras = (tx.paras?.length ? tx.paras : [{ runs: [{ t: '' }] }]).map((p, i) => {
    const kids = p.runs.length ? p.runs.map((r) => runNode(deck, r, tx)) : []
    const empty = !p.runs.some((r) => r.t)
    const endsNl = /\n$/.test(p.runs.at(-1)?.t || '')
    const el = h('div', { class: 'ss-p' }, kids, ((empty && !(hint && i === 0)) || endsNl) && h('br'))
    if (p.bu) el.dataset.bu = p.bu
    if (p.lv) { el.dataset.lv = p.lv; el.style.setProperty('--lv', p.lv) }
    if (p.a) el.style.textAlign = p.a
    if (tx.ps) el.style.marginBottom = `${tx.ps}px`
    if (hint && i === 0) el.dataset.hint = hint
    return el
  })
  return h('div', {
    class: 'ss-tc',
    style: {
      fontFamily: fontStack(fontOf(deck, tx.font)), fontSize: `${tx.size}px`, color: colorOf(deck, tx.color, '#000000'),
      fontWeight: tx.b ? 700 : 400, fontStyle: tx.i ? 'italic' : 'normal', textAlign: tx.a || 'left', lineHeight: String(+(1.2 * (tx.lh || 1)).toFixed(3)),
    },
  }, paras)
}

function textLayer(deck, e, o) {
  const tx = e.tx
  const jc = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[tx.va] || 'flex-start'
  return h('div', { class: 'ss-tx', style: { padding: `${tx.pad ?? 8}px`, justifyContent: jc } }, textBlock(deck, e, o))
}

// ---------- Elements ----------
function lineGeo(deck, e) {
  const sw = Math.max(0.5, e.sw || 1), col = colorOf(deck, e.stroke, '#000000')
  const pad = Math.ceil(sw * 3 + 14), W = Math.max(e.w, 1), H = Math.max(e.h, 1)
  let [[x1, y1], [x2, y2]] = linePoints({ ...e, x: 0, y: 0, w: e.w, h: e.h })
  const len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len
  const head = Math.min(len * 0.45, Math.max(9, sw * 4)), kids = []
  const arrow = (px, py, dx, dy) => {
    const bx = px - dx * head, by = py - dy * head, hw = head * 0.42
    return svg('polygon', { points: `${px},${py} ${bx - dy * hw},${by + dx * hw} ${bx + dy * hw},${by - dx * hw}`, fill: col })
  }
  if (e.ae) { kids.push(arrow(x2, y2, ux, uy)); x2 -= ux * head * 0.8; y2 -= uy * head * 0.8 }
  if (e.as) { kids.push(arrow(x1, y1, -ux, -uy)); x1 += ux * head * 0.8; y1 += uy * head * 0.8 }
  const line = svg('line', { x1, y1, x2, y2, stroke: col, 'stroke-width': sw, 'stroke-dasharray': dashOf(e.dash, sw), 'stroke-linecap': e.dash === 'dot' ? 'round' : 'butt' })
  const hit = svg('line', { class: 'ss-hit', x1: e.fh ? e.w : 0, y1: e.fv ? e.h : 0, x2: e.fh ? 0 : e.w, y2: e.fv ? 0 : e.h, stroke: 'transparent', 'stroke-width': Math.max(14, sw + 10) })
  return svg('svg', { class: 'ss-geo', width: W + pad * 2, height: H + pad * 2, viewBox: `${-pad} ${-pad} ${W + pad * 2} ${H + pad * 2}`, style: { left: `${-pad}px`, top: `${-pad}px` } }, hit, line, kids)
}

function tableNode(deck, e) {
  const theme = (k) => colorOf(deck, k)
  const rows = e.cells.length, cols = e.cells[0]?.length || 1
  const tot = (e.colw || []).reduce((a, b) => a + b, 0) || 1
  const border = rgba(theme('@muted'), 0.45)
  const rowH = e.h / rows
  const body = e.cells.map((row, r) => h('tr', { style: { height: `${rowH}px` } }, row.map((cell, c) => {
    const head = e.hdr && r === 0
    const band = e.band && !head && (r - (e.hdr ? 1 : 0)) % 2 === 1
    return h('td', {
      dataset: { r, c },
      style: {
        border: `1px solid ${border}`, padding: '4px 10px', verticalAlign: 'middle', textAlign: e.a || 'left',
        background: head ? theme('@accent') : band ? theme('@surface') : 'transparent', color: head ? theme('@onAccent') : theme('@text'), fontWeight: head ? 700 : 400,
      },
    }, String(cell ?? ''))
  })))
  return h('table', {
    class: 'ss-tbl',
    style: { width: '100%', height: `${e.h}px`, fontFamily: fontStack(fontOf(deck, '@body')), fontSize: `${e.size || 18}px`, lineHeight: '1.2' },
  }, h('colgroup', Array.from({ length: cols }, (_, i) => h('col', { style: { width: `${((e.colw?.[i] ?? 1 / cols) / tot) * 100}%` } }))), h('tbody', body))
}

export function elementNode(deck, e, o = {}) {
  const wrap = h('div', {
    class: ['ss-el', o.decor && 'ss-decor'], dataset: { id: e.id, type: e.type, ...(e.ph ? { ph: e.ph } : {}) },
    style: { left: `${e.x}px`, top: `${e.y}px`, width: `${e.w}px`, height: `${e.h}px`, opacity: e.op < 1 ? e.op : null, transform: e.rot ? `rotate(${e.rot}deg)` : null },
  })
  if (e.type === 'shape') {
    const sw = e.stroke ? e.sw || 0 : 0, dash = dashOf(e.dash, sw)
    const pad = Math.ceil(sw) + 1
    wrap.append(svg('svg', { class: 'ss-geo', width: e.w + pad * 2, height: e.h + pad * 2, viewBox: `${-pad} ${-pad} ${e.w + pad * 2} ${e.h + pad * 2}`, style: { left: `${-pad}px`, top: `${-pad}px` } },
      svg('path', { d: shapePath(e.shape, e.w, e.h, e.rad), fill: e.fill ? colorOf(deck, e.fill) : 'none', stroke: sw ? colorOf(deck, e.stroke) : 'none', 'stroke-width': sw, 'stroke-dasharray': dash, 'stroke-linejoin': 'round', 'fill-rule': 'evenodd' })))
    if (e.tx) wrap.append(textLayer(deck, e, o))
  } else if (e.type === 'text') {
    if (e.fill) wrap.style.background = colorOf(deck, e.fill)
    if (e.stroke && e.sw) wrap.style.border = `${e.sw}px solid ${colorOf(deck, e.stroke)}`
    wrap.append(textLayer(deck, e, o))
  } else if (e.type === 'line') {
    wrap.append(lineGeo(deck, e))
  } else if (e.type === 'image') {
    const url = e.asset && o.url?.(e.asset)
    const st = { borderRadius: e.rad ? `${e.rad}px` : null, border: e.stroke && e.sw ? `${e.sw}px solid ${colorOf(deck, e.stroke)}` : null }
    if (url) wrap.append(h('img', { class: 'ss-img', src: url, alt: e.alt || '', draggable: false, style: { ...st, objectFit: { cover: 'cover', fill: 'fill' }[e.fit] || 'contain' } }))
    else if (o.mode === 'edit') wrap.append(h('div', { class: 'ss-imgph' }, h('span', e.ph === 'image' ? 'Click to add a picture' : 'Image missing')))
  } else if (e.type === 'table') {
    wrap.append(tableNode(deck, e))
  }
  return wrap
}

/**
 * Build the DOM for one slide at its natural size (deck.w x deck.h px).
 * o: { mode: 'edit' | 'view' | 'export', url(assetId) -> src }
 */
export function renderSlide(deck, slide, o = {}) {
  const root = h('div', { class: ['ss-slide', o.mode === 'edit' && 'ss-edit'], style: { width: `${deck.w}px`, height: `${deck.h}px`, background: bgCss(bgOf(deck, slide)) } })
  for (const d of decorOf(deck, slide)) root.append(elementNode(deck, d, { ...o, decor: true }))
  for (const e of slide.elements) root.append(elementNode(deck, e, o))
  return root
}

/** A scaled, non-interactive copy for the slide sorter, galleries and the presenter's next-slide preview. */
export function renderThumb(deck, slide, width, o = {}) {
  const k = width / deck.w
  const inner = renderSlide(deck, slide, { mode: 'view', ...o })
  inner.style.transform = `scale(${k})`
  return h('div', { class: 'ss-thumb-box', style: { width: `${width}px`, height: `${Math.round(deck.h * k)}px` } }, inner)
}

// ---------- Reading edited text back into the model ----------
const BLOCK = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE'])
export const normFont = (family, deck) => {
  const first = String(family || '').split(',')[0].replace(/["']/g, '').trim()
  if (!first) return ''
  if (first === fontOf(deck, '@head')) return '@head'
  return first
}

/** Parse the contenteditable .ss-tc back into paragraphs of runs, dropping run styles that equal the element's base style. */
export function parseParas(tc, deck, tx) {
  const baseColor = colorOf(deck, tx.color, '#000000').toLowerCase()
  const baseFont = fontOf(deck, tx.font)
  const paras = []
  const readRun = (n, st, out) => {
    if (n.nodeType === 3) {
      const t = n.nodeValue.replace(/​/g, '')
      if (t) out.push({ ...st, t })
      return
    }
    if (n.nodeType !== 1) return
    if (n.tagName === 'BR') { if (n.nextSibling && n.previousSibling) out.push({ ...st, t: '\n' }); return }
    const s = { ...st }
    const tag = n.tagName
    if (tag === 'B' || tag === 'STRONG') s.b = true
    if (tag === 'I' || tag === 'EM') s.i = true
    if (tag === 'U') s.u = true
    if (tag === 'FONT') { if (n.color) s.c = n.color; if (n.face) s.f = n.face }
    const cs = n.style
    if (cs.fontWeight) s.b = cs.fontWeight === 'bold' || cs.fontWeight === 'bolder' || +cs.fontWeight >= 600
    if (cs.fontStyle) s.i = cs.fontStyle === 'italic'
    if (cs.textDecorationLine?.includes('underline') || cs.textDecoration?.includes('underline')) s.u = true
    if (cs.color) s.c = cs.color
    if (cs.backgroundColor) s.hl = cs.backgroundColor
    if (cs.fontSize) { const px = parseFloat(cs.fontSize); if (px) s.s = Math.round(px * 10) / 10 }
    if (cs.fontFamily) s.f = cs.fontFamily
    for (const k of n.childNodes) readRun(k, s, out)
  }
  const finish = (runs, el) => {
    const merged = []
    for (const r of runs) {
      const x = { ...r }
      if (x.c !== undefined) { const hex = cssHex(x.c); if (!hex || hex.toLowerCase() === baseColor) delete x.c; else x.c = hex }
      if (x.hl !== undefined) { const hex = cssHex(x.hl); if (!hex) delete x.hl; else x.hl = hex }
      if (x.f !== undefined) { const f = normFont(x.f, deck); if (!f || fontOf(deck, f) === baseFont) delete x.f; else x.f = f }
      if (x.b !== undefined && !!x.b === !!tx.b) delete x.b
      if (x.i !== undefined && !!x.i === !!tx.i) delete x.i
      if (x.s !== undefined && Math.abs(x.s - tx.size) < 0.05) delete x.s
      if (x.u === false) delete x.u
      const prev = merged.at(-1)
      const { t: _t1, ...a } = x, { t: _t2, ...b } = prev || {}
      if (prev && JSON.stringify(a) === JSON.stringify(b)) prev.t += x.t
      else merged.push(x)
    }
    const p = { runs: merged.length ? merged : [{ t: '' }] }
    if (el) {
      if (el.dataset?.bu) p.bu = el.dataset.bu
      if (el.dataset?.lv && +el.dataset.lv) p.lv = +el.dataset.lv
      if (el.style?.textAlign && el.style.textAlign !== (tx.a || 'left')) p.a = el.style.textAlign
    }
    return p
  }
  const walk = (parent) => {
    let cur = null
    for (const n of parent.childNodes) {
      if (n.nodeType === 1 && BLOCK.has(n.tagName)) {
        cur = null
        if ([...n.children].some((c) => BLOCK.has(c.tagName))) { walk(n); continue }
        const runs = []
        for (const k of n.childNodes) readRun(k, {}, runs)
        paras.push(finish(runs, n))
      } else {
        if (!cur) { cur = { runs: [], el: null }; paras.push(cur) }
        readRun(n, {}, cur.runs)
      }
    }
  }
  walk(tc)
  const out = paras.map((p) => (p.el === null ? finish(p.runs, null) : p))
  return out.length ? out : [{ runs: [{ t: '' }] }]
}
const cssHex = (c) => {
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(String(c).trim())
  if (m) return `#${[m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, '0')).join('')}`
  const hx = /^#([0-9a-f]{6})$/i.exec(String(c).trim())
  if (hx) return `#${hx[1].toLowerCase()}`
  const s = /^#([0-9a-f]{3})$/i.exec(String(c).trim())
  if (s) return `#${s[1].replace(/./g, (x) => x + x).toLowerCase()}`
  return ''
}
