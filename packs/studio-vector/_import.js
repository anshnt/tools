// SVG import for Vector Studio. The file is parsed with DOMParser and rebuilt as editor nodes, never inserted as markup,
// so scripts, event handlers and external references in the file cannot run. Clip paths, masks, filters and patterns are skipped.
import { I, mul, tr, sc, rot, DEG, ap, det, parseD, transformSubs, P } from './_geom.js'
import { mk, applyMatrix, localBBox, solid, leaves, toSubs } from './_model.js'

const INHERIT = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'fill-rule', 'fill-opacity', 'stroke-opacity',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'letter-spacing', 'color']
const OWN = ['opacity', 'display', 'visibility']

let cctx = null
/** Any CSS color -> {c: '#rrggbb', a} or null for none/transparent. */
export function parseColor(str) {
  str = String(str ?? '').trim()
  if (!str || /^(none|transparent)$/i.test(str)) return null
  cctx ||= document.createElement('canvas').getContext('2d')
  cctx.fillStyle = '#000000'
  cctx.fillStyle = str
  const v = cctx.fillStyle
  if (v.startsWith('#')) return { c: v, a: 1 }
  const m = v.match(/rgba?\(([^)]+)\)/)
  if (!m) return { c: '#000000', a: 1 }
  const [r, g, b, a = 1] = m[1].split(',').map(Number)
  return { c: '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join(''), a }
}

const LEN = { px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, em: 16, rem: 16 }
export function parseLen(s, fallback = 0) {
  const m = String(s ?? '').trim().match(/^(-?[\d.]+(?:e-?\d+)?)\s*(px|pt|pc|mm|cm|in|em|rem|%)?$/i)
  if (!m) return fallback
  return m[2] === '%' ? fallback : parseFloat(m[1]) * (LEN[(m[2] || 'px').toLowerCase()] || 1)
}
const nums = (s) => (String(s || '').match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || []).map(Number)

export function parseTransform(str) {
  let m = I
  for (const t of String(str || '').matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = nums(t[2])
    let k = null
    switch (t[1]) {
      case 'matrix': if (a.length === 6) k = a; break
      case 'translate': k = tr(a[0] || 0, a[1] || 0); break
      case 'scale': k = sc(a[0] ?? 1, a[1] ?? a[0] ?? 1); break
      case 'rotate': k = a.length === 3 ? mul(tr(a[1], a[2]), mul(rot((a[0] || 0) * DEG), tr(-a[1], -a[2]))) : rot((a[0] || 0) * DEG); break
      case 'skewX': k = [1, 0, Math.tan((a[0] || 0) * DEG), 1, 0, 0]; break
      case 'skewY': k = [1, Math.tan((a[0] || 0) * DEG), 0, 1, 0, 0]; break
    }
    if (k) m = mul(m, k)
  }
  return m
}

function parseDecls(text) {
  const out = {}
  for (const d of String(text || '').split(';')) {
    const i = d.indexOf(':')
    if (i > 0) out[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).replace(/!important/i, '').trim()
  }
  return out
}

function parseCss(text) {
  const rules = []
  const src = String(text || '').replace(/\/\*[\s\S]*?\*\//g, '')
  let order = 0
  for (const m of src.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const decls = parseDecls(m[2])
    for (const raw of m[1].split(',')) {
      const sel = raw.trim()
      const parts = sel.match(/^([a-zA-Z][\w-]*|\*)?((?:[.#][\w-]+)*)$/)
      if (!parts) continue
      rules.push({ tag: parts[1] && parts[1] !== '*' ? parts[1].toLowerCase() : null, classes: [...parts[2].matchAll(/\.([\w-]+)/g)].map((x) => x[1]), id: parts[2].match(/#([\w-]+)/)?.[1] || null, decls, order: order++,
        spec: (parts[2].includes('#') ? 100 : 0) + [...parts[2].matchAll(/\./g)].length * 10 + (parts[1] && parts[1] !== '*' ? 1 : 0) })
    }
  }
  return rules.sort((a, b) => a.spec - b.spec || a.order - b.order)
}

export function parseSvg(text, doc) {
  const dom = new DOMParser().parseFromString(text, 'image/svg+xml')
  const root = dom.documentElement
  if (!root || root.localName !== 'svg' || dom.querySelector('parsererror')) throw new Error('This file is not a valid SVG.')
  const warn = new Set()
  const byId = new Map()
  for (const el of dom.querySelectorAll('[id]')) byId.set(el.getAttribute('id'), el)
  const rules = parseCss([...dom.querySelectorAll('style')].map((s) => s.textContent).join('\n'))

  // ----- size and viewBox -----
  const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
  const hasVb = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0
  let w = parseLen(root.getAttribute('width'), 0), h = parseLen(root.getAttribute('height'), 0)
  if (!w) w = hasVb ? vb[2] : 0
  if (!h) h = hasVb ? vb[3] : 0
  let vp = { w: hasVb ? vb[2] : w || 100, h: hasVb ? vb[3] : h || 100 } // size that percentage lengths refer to
  let M0 = I
  if (hasVb) {
    if (!w) w = vb[2]
    if (!h) h = vb[3]
    const s = Math.min(w / vb[2], h / vb[3])
    M0 = mul(tr((w - vb[2] * s) / 2, (h - vb[3] * s) / 2), mul(sc(s), tr(-vb[0], -vb[1])))
  }

  // ----- styles -----
  const propsFor = (el, inherited) => {
    const decl = {}
    for (const k of [...INHERIT, ...OWN]) if (el.hasAttribute(k)) decl[k] = el.getAttribute(k)
    const tag = el.localName.toLowerCase(), cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean), id = el.getAttribute('id')
    for (const r of rules) if ((!r.tag || r.tag === tag) && r.classes.every((c) => cls.includes(c)) && (!r.id || r.id === id) && (r.tag || r.classes.length || r.id)) Object.assign(decl, r.decls)
    Object.assign(decl, parseDecls(el.getAttribute('style')))
    const props = { ...inherited }
    for (const k of INHERIT) if (decl[k] != null && decl[k] !== 'inherit') props[k] = decl[k]
    return { props, own: { opacity: decl.opacity, display: decl.display, visibility: decl.visibility } }
  }

  // ----- gradients -----
  const gradAttr = (el, name) => {
    for (let g = el, n = 0; g && n < 8; n++) {
      if (g.hasAttribute(name)) return g.getAttribute(name)
      const ref = (g.getAttribute('href') || g.getAttribute('xlink:href') || '').replace(/^#/, '')
      g = ref ? byId.get(ref) : null
    }
    return null
  }
  const gradStops = (el) => {
    for (let g = el, n = 0; g && n < 8; n++) {
      const st = [...g.children].filter((c) => c.localName === 'stop')
      if (st.length) return st
      const ref = (g.getAttribute('href') || g.getAttribute('xlink:href') || '').replace(/^#/, '')
      g = ref ? byId.get(ref) : null
    }
    return []
  }
  const frac = (v, def) => { if (v == null || v === '') return def; const s = String(v).trim(); return s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s) }
  function gradientPaint(el, opacity, node, M, props) {
    const stops = gradStops(el).map((s) => {
      const d = { ...parseDecls(s.getAttribute('style')) }
      const col = parseColor((d['stop-color'] ?? s.getAttribute('stop-color') ?? 'black') === 'currentColor' ? props.color : d['stop-color'] ?? s.getAttribute('stop-color') ?? 'black') || { c: '#000000', a: 0 }
      const o = frac(s.getAttribute('offset'), 0)
      return { o: Math.min(1, Math.max(0, Number.isFinite(o) ? o : 0)), c: col.c, a: col.a * parseFloat(d['stop-opacity'] ?? s.getAttribute('stop-opacity') ?? 1) * opacity }
    })
    if (!stops.length) return null
    if (stops.length === 1) stops.push({ ...stops[0], o: 1 })
    const user = (gradAttr(el, 'gradientUnits') || 'objectBoundingBox') === 'userSpaceOnUse'
    const G = parseTransform(gradAttr(el, 'gradientTransform'))
    const bb = user ? localBBox(node) : null
    if (user && (!bb || !bb.w || !bb.h)) return null
    const toLocal = node.t ? I : M
    const conv = (x, y) => {
      if (!user) return ap(G, x, y)
      const [lx, ly] = ap(toLocal, ...ap(G, x, y))
      return [(lx - bb.x) / bb.w, (ly - bb.y) / bb.h]
    }
    if (el.localName === 'linearGradient') {
      const [x1, y1] = conv(frac(gradAttr(el, 'x1'), 0), frac(gradAttr(el, 'y1'), 0)), [x2, y2] = conv(frac(gradAttr(el, 'x2'), 1), frac(gradAttr(el, 'y2'), 0))
      return { t: 'linear', stops, x1, y1, x2, y2 }
    }
    const [cx, cy] = conv(frac(gradAttr(el, 'cx'), 0.5), frac(gradAttr(el, 'cy'), 0.5))
    const rUser = frac(gradAttr(el, 'r'), 0.5)
    const [ex, ey] = conv(frac(gradAttr(el, 'cx'), 0.5) + rUser, frac(gradAttr(el, 'cy'), 0.5))
    const r = Math.hypot(ex - cx, ey - cy) || 0.5
    const [fx, fy] = conv(frac(gradAttr(el, 'fx'), frac(gradAttr(el, 'cx'), 0.5)), frac(gradAttr(el, 'fy'), frac(gradAttr(el, 'cy'), 0.5)))
    return { t: 'radial', stops, cx, cy, r, fx, fy }
  }
  function paintOf(value, opacity, node, M, props) {
    if (value == null) return null
    const v = String(value).trim()
    const u = v.match(/^url\(\s*['"]?#([^)'"]+)['"]?\s*\)\s*(.*)$/)
    if (u) {
      const el = byId.get(u[1])
      if (el && /Gradient$/.test(el.localName)) return gradientPaint(el, opacity, node, M, props)
      warn.add('patterns')
      const fb = u[2] && parseColor(u[2])
      return fb ? solid(fb.c, fb.a * opacity) : null
    }
    const c = parseColor(v === 'currentColor' ? props.color || '#000000' : v)
    return c ? solid(c.c, c.a * opacity) : null
  }
  const dashOf = (v) => (!v || v === 'none' ? '' : nums(v).join(' '))
  function styleNode(node, props, M) {
    const fo = parseFloat(props['fill-opacity'] ?? 1), so = parseFloat(props['stroke-opacity'] ?? 1)
    node.fill = paintOf(props.fill ?? 'black', Number.isFinite(fo) ? fo : 1, node, M, props)
    node.stroke = paintOf(props.stroke ?? 'none', Number.isFinite(so) ? so : 1, node, M, props)
    // geometry is baked into the node, so strokes and dashes take on the matrix scale here (nodes that keep a matrix scale with it)
    const k = node.t ? 1 : Math.sqrt(Math.abs(det(M))) || 1
    node.sw = Math.max(0, parseLen(props['stroke-width'], 1)) * k
    node.dash = dashOf(props['stroke-dasharray']).split(' ').filter(Boolean).map((x) => Math.round(+x * k * 1000) / 1000).join(' ')
    node.cap = ['round', 'square'].includes(props['stroke-linecap']) ? props['stroke-linecap'] : 'butt'
    node.join = ['round', 'bevel'].includes(props['stroke-linejoin']) ? props['stroke-linejoin'] : 'miter'
    node.ml = parseFloat(props['stroke-miterlimit']) || 4
    node.rule = props['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero'
  }

  // ----- elements -----
  function finish(node, el, own, M) {
    const op = parseFloat(own.opacity)
    if (Number.isFinite(op)) node.op = Math.min(1, Math.max(0, op))
    const name = el.getAttribute('inkscape:label') || el.getAttribute('data-name') || el.getAttribute('id') || ''
    node.name = name.replace(/_x[0-9A-F]{2}_/g, ' ').slice(0, 60)
    if (own.visibility === 'hidden') node.vis = false
    return node
  }
  const pointsOf = (s) => { const a = nums(s), pts = []; for (let i = 0; i + 1 < a.length; i += 2) pts.push(P(a[i], a[i + 1])); return pts }

  // clip-path="url(#id)": the referenced shapes become the mask (top-most object) of a clipping group
  const clipOf = (el) => {
    const v = el.getAttribute('clip-path') || parseDecls(el.getAttribute('style'))['clip-path'] || ''
    const m = v.match(/^url\(\s*['"]?#([^)'"]+)['"]?\s*\)/)
    const cp = m && byId.get(m[1])
    return cp && cp.localName === 'clipPath' ? cp : null
  }
  function buildClip(cp, M, depth) {
    if ((cp.getAttribute('clipPathUnits') || '') === 'objectBoundingBox') return null
    const Mc = mul(M, parseTransform(cp.getAttribute('transform')))
    const subs = []
    for (const c of cp.children) for (const n of res2leaves(convertEl(c, { fill: 'black' }, Mc, depth + 1))) { const x = toSubs(n); if (x) subs.push(...x) }
    return subs.length ? mk(doc, 'path', { subs, name: 'Clip path' }, { fill: null, stroke: null, sw: 0, dash: '', cap: 'butt', join: 'miter', ml: 4, rule: 'nonzero' }) : null
  }
  const res2leaves = (nodes) => nodes.flatMap((n) => leaves(n))
  function convert(el, inherited, M, depth = 0) {
    const kids = convertEl(el, inherited, M, depth)
    const cp = kids.length && el.nodeType === 1 ? clipOf(el) : null
    if (!cp) return kids
    const mask = buildClip(cp, mul(M, parseTransform(el.getAttribute('transform'))), depth)
    if (!mask) { warn.add('clip paths'); return kids }
    return [mk(doc, 'group', { kids: [...kids, mask], clip: true })]
  }

  function convertEl(el, inherited, M, depth = 0) {
    if (el.nodeType !== 1 || depth > 40) return []
    const tag = el.localName
    if (['defs', 'clippath', 'mask', 'filter', 'lineargradient', 'radialgradient', 'pattern', 'style', 'title', 'desc', 'metadata', 'marker', 'symbol', 'script', 'foreignobject', 'animate', 'set', 'animatetransform'].includes(tag.toLowerCase())) return []
    const { props, own } = propsFor(el, inherited)
    if (own.display === 'none') return []
    for (const a of ['mask', 'filter']) if (el.hasAttribute(a) && !/^none$/i.test(el.getAttribute(a))) warn.add(a === 'mask' ? 'masks' : 'filters')
    const own_M = mul(M, parseTransform(el.getAttribute('transform')))
    const AXIS = { x: 'w', cx: 'w', x1: 'w', x2: 'w', width: 'w', rx: 'w', y: 'h', cy: 'h', y1: 'h', y2: 'h', height: 'h', ry: 'h', r: 'r' }
    const n = (a, d = 0) => {
      const raw = String(el.getAttribute(a) ?? '').trim()
      if (raw.endsWith('%')) { const k = AXIS[a], ref = k === 'r' ? Math.sqrt((vp.w ** 2 + vp.h ** 2) / 2) : vp[k] || 0; return (parseFloat(raw) / 100) * ref }
      return parseLen(raw, d)
    }

    if (tag === 'svg' && el !== root) { // nested svg: position and viewBox scale its content
      const nvb = (el.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
      const ok = nvb.length === 4 && nvb.every(Number.isFinite) && nvb[2] > 0 && nvb[3] > 0
      const nw = el.hasAttribute('width') ? n('width') : ok ? nvb[2] : vp.w, nh = el.hasAttribute('height') ? n('height') : ok ? nvb[3] : vp.h
      let inner = mul(own_M, tr(n('x'), n('y')))
      const saved = vp
      if (ok) { const k = Math.min(nw / nvb[2], nh / nvb[3]); inner = mul(inner, mul(tr((nw - nvb[2] * k) / 2, (nh - nvb[3] * k) / 2), mul(sc(k), tr(-nvb[0], -nvb[1])))); vp = { w: nvb[2], h: nvb[3] } }
      else vp = { w: nw, h: nh }
      const kids = []
      for (const c of el.children) kids.push(...convert(c, props, inner, depth + 1))
      vp = saved
      return kids.length ? [finish(mk(doc, 'group', { kids }), el, own, inner)] : []
    }
    if (tag === 'g' || tag === 'svg' || tag === 'a' || tag === 'switch') {
      const kids = []
      for (const c of el.children) kids.push(...convert(c, props, own_M, depth + 1))
      if (!kids.length) return []
      if (kids.length === 1 && !el.getAttribute('id') && !Number.isFinite(parseFloat(own.opacity))) return kids
      const g = mk(doc, 'group', { kids })
      return [finish(g, el, own, own_M)]
    }
    if (tag === 'use') {
      const ref = byId.get((el.getAttribute('href') || el.getAttribute('xlink:href') || '').replace(/^#/, ''))
      if (!ref || ref === el || ref.contains(el)) return []
      const kids = convert(ref, props, mul(own_M, tr(n('x'), n('y'))), depth + 1)
      return kids.length ? [finish(mk(doc, 'group', { kids }), el, own, own_M)] : []
    }
    let node = null
    if (tag === 'rect') {
      const rx0 = n('rx', NaN), ry0 = n('ry', NaN)
      const rx = Number.isFinite(rx0) ? rx0 : Number.isFinite(ry0) ? ry0 : 0, ry = Number.isFinite(ry0) ? ry0 : rx
      node = mk(doc, 'rect', { x: n('x'), y: n('y'), w: n('width'), h: n('height'), rx, ry })
      if (!(node.w > 0 && node.h > 0)) return []
    } else if (tag === 'circle') {
      const r = n('r')
      if (!(r > 0)) return []
      node = mk(doc, 'ellipse', { cx: n('cx'), cy: n('cy'), rx: r, ry: r })
    } else if (tag === 'ellipse') {
      if (!(n('rx') > 0 && n('ry') > 0)) return []
      node = mk(doc, 'ellipse', { cx: n('cx'), cy: n('cy'), rx: n('rx'), ry: n('ry') })
    } else if (tag === 'line') {
      node = mk(doc, 'path', { subs: [{ closed: false, pts: [P(n('x1'), n('y1')), P(n('x2'), n('y2'))] }] })
    } else if (tag === 'polyline' || tag === 'polygon') {
      const pts = pointsOf(el.getAttribute('points'))
      if (pts.length < 2) return []
      node = mk(doc, 'path', { subs: [{ closed: tag === 'polygon', pts }] })
    } else if (tag === 'path') {
      const subs = parseD(el.getAttribute('d'))
      if (!subs.length) return []
      node = mk(doc, 'path', { subs })
    } else if (tag === 'text') {
      const lines = [''], push = () => { if (lines.at(-1) !== '') lines.push('') }
      const walkText = (e, first) => {
        for (const c of e.childNodes) {
          if (c.nodeType === 3) lines[lines.length - 1] += c.textContent.replace(/\s+/g, ' ')
          else if (c.nodeType === 1 && c.localName === 'tspan') { if (!first && (c.hasAttribute('x') || c.hasAttribute('dy')) && lines.at(-1).trim() !== '') push(); walkText(c, false); first = false }
        }
      }
      walkText(el, true)
      const text = lines.map((l) => l.trim()).filter((l, i, a) => l !== '' || (i > 0 && i < a.length - 1)).join('\n')
      if (!text.trim()) return []
      const fs = parseLen(props['font-size'], 16) || 16, fw = props['font-weight'] === 'bold' ? 700 : parseInt(props['font-weight']) || 400
      const first = el.querySelector('tspan[x]')
      const coord = (a, ref) => { const v = String(el.getAttribute(a) ?? first?.getAttribute(a) ?? '0').trim().split(/[\s,]+/)[0]; return v.endsWith('%') ? (parseFloat(v) / 100) * ref : parseLen(v, 0) }
      const xs = [coord('x', vp.w)], ys = [coord('y', vp.h)]
      node = mk(doc, 'text', {
        x: xs[0] || 0, y: ys[0] || 0, text, ff: props['font-family'] || 'sans-serif', fs, fw, fi: /italic|oblique/.test(props['font-style'] || ''),
        ta: { middle: 'middle', end: 'end' }[props['text-anchor']] || 'start', lh: 1.2, ls: parseLen(props['letter-spacing'], 0),
      })
    } else if (tag === 'image') {
      const href = el.getAttribute('href') || el.getAttribute('xlink:href') || ''
      if (!/^data:image\//i.test(href)) { warn.add('external images'); return [] }
      node = mk(doc, 'image', { x: n('x'), y: n('y'), w: n('width'), h: n('height'), href })
      if (!(node.w > 0 && node.h > 0)) return []
      applyMatrix(node, own_M)
      return [finish(node, el, own, own_M)]
    } else return []
    if (node.type === 'path') node.subs = transformSubs(node.subs, own_M)
    else applyMatrix(node, own_M)
    styleNode(node, props, own_M)
    if (tag === 'line') node.fill = null
    return [finish(node, el, own, own_M)]
  }

  const nodes = []
  const rootStyle = propsFor(root, { fill: 'black' })
  for (const c of root.children) nodes.push(...convert(c, rootStyle.props, M0))
  const rootOwn = rootStyle.own
  if (Number.isFinite(parseFloat(rootOwn.opacity)) && nodes.length) { const g = mk(doc, 'group', { kids: nodes.splice(0) }); g.op = parseFloat(rootOwn.opacity); nodes.push(g) }
  return { nodes, w: w || 0, h: h || 0, warnings: [...warn] }
}
