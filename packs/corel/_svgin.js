// SVG -> model. The file is parsed, cleaned (scripts, event handlers and outside references removed), and loaded into a hidden, sandboxed
// frame so the browser itself resolves CSS, inheritance, units and transforms. Every shape is read back as flattened path data.
// Supported: path, rect, circle, ellipse, line, polyline, polygon, groups, use, nested svg, clip paths, solid fills and strokes,
// linear and radial gradients, images (data URLs), text. Filters, masks, markers and patterns are dropped with a note.
import { I, mul, translate, mapPath, parseD, pointsPath, rectPath, ellipsePath, parseColor, pathBBox, meanScale, rotate } from './_model.js'

const PX = 0.75 // CSS px -> pt
const UNITS = { px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, q: 96 / 101.6 }
const SKIP = new Set(['defs', 'clippath', 'mask', 'marker', 'symbol', 'pattern', 'lineargradient', 'radialgradient', 'style', 'title', 'desc', 'metadata', 'filter', 'script', 'font', 'cursor'])
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'])
const xlink = 'http://www.w3.org/1999/xlink'

const lenPx = (s) => {
  const m = /^\s*([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*([a-z%]*)\s*$/i.exec(s || '')
  if (!m || m[2] === '%') return NaN
  return parseFloat(m[1]) * (UNITS[(m[2] || 'px').toLowerCase()] ?? NaN)
}
const hrefOf = (el) => el.getAttribute('href') ?? el.getAttributeNS(xlink, 'href') ?? el.getAttribute('xlink:href')
const idOf = (ref) => (ref && ref.startsWith('#') ? ref.slice(1) : null)

/** Clean the parsed SVG in place and expand <use>. Returns the number of removed external or active items. */
function sanitize(doc, warn) {
  const root = doc.documentElement
  let removed = 0
  for (const el of [...root.querySelectorAll('script,foreignObject,iframe,audio,video,animate,animateTransform,animateMotion,set')]) { el.remove(); removed++ }
  for (const el of root.querySelectorAll('*')) {
    for (const a of [...el.attributes]) if (/^on/i.test(a.name)) el.removeAttribute(a.name)
    if (el.localName === 'image') {
      const h = hrefOf(el) || ''
      if (!/^data:image\//i.test(h)) { el.remove(); removed++ }
    }
    if (el.localName === 'style') el.textContent = el.textContent.replace(/@import[^;]*;?/gi, '').replace(/url\(\s*(?!['"]?(?:#|data:))[^)]*\)/gi, 'none')
    const st = el.getAttribute('style')
    if (st && /url\(\s*(?!['"]?(?:#|data:))/i.test(st)) el.setAttribute('style', st.replace(/url\(\s*(?!['"]?(?:#|data:))[^)]*\)/gi, 'none'))
  }
  if (removed) warn(`${removed} script, animation or outside-link item(s) were removed.`)
  // expand <use> by cloning the referenced element
  for (let pass = 0; pass < 8; pass++) {
    const uses = [...root.querySelectorAll('use')]
    if (!uses.length) break
    for (const u of uses) {
      const target = idOf(hrefOf(u)) && doc.getElementById(idOf(hrefOf(u)))
      if (!target || target.contains(u)) { u.remove(); continue }
      const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g')
      for (const a of [...u.attributes]) if (!/^(x|y|width|height|href|xlink:href)$/.test(a.name)) g.setAttribute(a.name, a.value)
      const x = parseFloat(u.getAttribute('x')) || 0, y = parseFloat(u.getAttribute('y')) || 0
      if (x || y) g.setAttribute('transform', `${u.getAttribute('transform') || ''} translate(${x} ${y})`.trim())
      const copy = target.cloneNode(true)
      copy.removeAttribute('id')
      for (const c of copy.querySelectorAll('[id]')) c.removeAttribute('id')
      if (/^(symbol)$/i.test(copy.localName)) for (const c of [...copy.childNodes]) g.append(c)
      else g.append(copy)
      u.replaceWith(g)
    }
  }
  return doc
}

function rootSize(root) {
  const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
  const hasVb = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0
  let w = lenPx(root.getAttribute('width')), h = lenPx(root.getAttribute('height'))
  if (!(w > 0) && hasVb) w = h > 0 ? (h * vb[2]) / vb[3] : vb[2]
  if (!(h > 0) && hasVb) h = w > 0 ? (w * vb[3]) / vb[2] : vb[3]
  return { w: w > 0 ? w : 0, h: h > 0 ? h : 0, hasVb }
}

async function mountFrame(svgText, w, h) {
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }))
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-same-origin')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.style.cssText = `position:fixed;left:-30000px;top:0;width:${Math.ceil(w)}px;height:${Math.ceil(h)}px;border:0;visibility:hidden;pointer-events:none`
  await new Promise((res, rej) => {
    frame.onload = res
    frame.onerror = () => rej(new Error('Could not read this SVG.'))
    frame.src = url
    document.body.append(frame)
  })
  return { frame, dispose: () => { frame.remove(); URL.revokeObjectURL(url) } }
}

const matrixOf = (dm) => [dm.a, dm.b, dm.c, dm.d, dm.e, dm.f]

/**
 * Convert SVG text. Returns {pages: [{w, h, items}], warnings}. Page size is the SVG's own size in points.
 */
export async function svgToDoc(text) {
  const warnings = new Set()
  const warn = (s) => warnings.add(s)
  const xml = new DOMParser().parseFromString(text, 'image/svg+xml')
  if (xml.querySelector('parsererror') || xml.documentElement.localName !== 'svg') throw new Error('This does not look like a valid SVG file.')
  sanitize(xml, warn)
  const root = xml.documentElement
  let { w, h } = rootSize(root)
  const measured = !(w > 0 && h > 0)
  const ser = () => new XMLSerializer().serializeToString(xml)
  if (measured) { w = 800; h = 600 }
  root.setAttribute('width', `${w}px`); root.setAttribute('height', `${h}px`)
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  let mount = await mountFrame(ser(), w, h)
  try {
    if (measured) { // no size at all: use the drawing's own extent
      const bb = mount.frame.contentDocument.documentElement.getBBox()
      if (bb.width > 0 && bb.height > 0) {
        mount.dispose()
        root.setAttribute('viewBox', `${bb.x} ${bb.y} ${bb.width} ${bb.height}`)
        w = bb.width; h = bb.height
        root.setAttribute('width', `${w}px`); root.setAttribute('height', `${h}px`)
        mount = await mountFrame(ser(), w, h)
      }
    }
    const win = mount.frame.contentWindow, d = mount.frame.contentDocument
    const items = []
    const cs = (el) => win.getComputedStyle(el)
    let dropped = { filter: 0, mask: 0, marker: 0, pattern: 0, textPath: 0, aniso: 0, groupOpacity: 0 }

    const ctmOf = (el) => { const s = el.getScreenCTM?.(); return s ? mul([PX, 0, 0, PX, 0, 0], matrixOf(s)) : null }

    // ----- paint -----
    const stopsOf = (g) => {
      let node = g, guard = 0
      while (node && guard++ < 8) {
        const st = [...node.children].filter((c) => c.localName === 'stop')
        if (st.length) {
          let last = 0
          return st.map((s) => {
            const raw = s.getAttribute('offset') || '0'
            let o = raw.trim().endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw)
            o = Number.isFinite(o) ? Math.min(1, Math.max(0, o)) : 0
            o = Math.max(o, last); last = o
            const c = parseColor(cs(s).stopColor) || { c: '#000000', a: 1 }
            const so = parseFloat(cs(s).stopOpacity)
            return { o, c: c.c, a: (Number.isFinite(so) ? so : 1) * c.a }
          })
        }
        const next = idOf(hrefOf(node))
        node = next && d.getElementById(next)
      }
      return []
    }
    const gradAttr = (g, name) => {
      let node = g, guard = 0
      while (node && guard++ < 8) {
        if (node.hasAttribute(name)) return node.getAttribute(name)
        const next = idOf(hrefOf(node))
        node = next && d.getElementById(next)
      }
      return null
    }
    const gradientFor = (ref, bbox, M, el) => {
      const g = d.getElementById(ref)
      if (!g) return { fallback: true }
      const tag = g.localName
      if (tag !== 'linearGradient' && tag !== 'radialGradient') return { pattern: tag }
      const stops = stopsOf(g)
      if (!stops.length) return { none: true }
      if (stops.length === 1) return { color: stops[0] }
      const bboxUnits = (gradAttr(g, 'gradientUnits') || 'objectBoundingBox') !== 'userSpaceOnUse'
      if (bboxUnits && (!bbox || bbox.w <= 0 || bbox.h <= 0)) return { color: stops[0] }
      const vp = el.ownerSVGElement?.viewBox?.baseVal
      const val = (name, defFrac, axis) => {
        const raw = gradAttr(g, name)
        const s = raw == null ? `${defFrac * 100}%` : raw.trim()
        if (s.endsWith('%')) { const f = parseFloat(s) / 100; return bboxUnits ? f : f * (axis === 'x' ? (vp?.width || w) : axis === 'y' ? (vp?.height || h) : Math.hypot(vp?.width || w, vp?.height || h) / Math.SQRT2) }
        const v = lenPx(s)
        return Number.isFinite(v) ? v : parseFloat(s) || 0
      }
      let gt = I
      const tr = gradAttr(g, 'gradientTransform')
      if (tr) { const tmp = d.createElementNS('http://www.w3.org/2000/svg', 'g'); tmp.setAttribute('transform', tr); gt = matrixOf(tmp.transform.baseVal.consolidate()?.matrix || new DOMMatrix()) }
      const base = bboxUnits ? mul(M, mul([bbox.w, 0, 0, bbox.h, bbox.x, bbox.y], gt)) : mul(M, gt)
      const spread = gradAttr(g, 'spreadMethod') || 'pad'
      if (tag === 'linearGradient') return { grad: { g: 'linear', x1: val('x1', 0, 'x'), y1: val('y1', 0, 'y'), x2: val('x2', 1, 'x'), y2: val('y2', 0, 'y'), m: base, stops, spread } }
      const cx = val('cx', 0.5, 'x'), cy = val('cy', 0.5, 'y')
      return { grad: { g: 'radial', cx, cy, r: val('r', 0.5, 'r'), fx: gradAttr(g, 'fx') == null ? cx : val('fx', 0.5, 'x'), fy: gradAttr(g, 'fy') == null ? cy : val('fy', 0.5, 'y'), m: base, stops, spread } }
    }
    /** {paint: '#hex' | Gradient | null, alpha} */
    const paintOf = (el, value, bbox, M) => {
      const v = String(value || 'none').trim()
      if (!v || v === 'none') return { paint: null, alpha: 1 }
      const u = /^url\(\s*["']?#([^"')]+)["']?\s*\)\s*(.*)$/.exec(v)
      if (u) {
        const r = gradientFor(u[1], bbox, M, el)
        if (r.grad) return { paint: r.grad, alpha: 1 }
        if (r.color) return { paint: r.color.c, alpha: r.color.a }
        if (r.pattern) { dropped.pattern++; return { paint: '#cccccc', alpha: 1 } }
        const fb = parseColor(u[2])
        return fb ? { paint: fb.c, alpha: fb.a } : { paint: null, alpha: 1 }
      }
      const c = parseColor(v)
      return c ? { paint: c.c, alpha: c.a } : { paint: null, alpha: 1 }
    }

    // ----- geometry -----
    const L = (len) => len.baseVal.value
    const shapePath = (el) => {
      switch (el.localName) {
        case 'path': return parseD(el.getAttribute('d'))
        case 'rect': {
          const hasRx = el.hasAttribute('rx'), hasRy = el.hasAttribute('ry')
          let rx = hasRx ? L(el.rx) : 0, ry = hasRy ? L(el.ry) : 0
          if (!hasRx && hasRy) rx = ry
          if (hasRx && !hasRy) ry = rx
          return L(el.width) > 0 && L(el.height) > 0 ? rectPath(L(el.x), L(el.y), L(el.width), L(el.height), rx, ry) : []
        }
        case 'circle': return L(el.r) > 0 ? ellipsePath(L(el.cx), L(el.cy), L(el.r), L(el.r)) : []
        case 'ellipse': return L(el.rx) > 0 && L(el.ry) > 0 ? ellipsePath(L(el.cx), L(el.cy), L(el.rx), L(el.ry)) : []
        case 'line': return [['M', L(el.x1), L(el.y1)], ['L', L(el.x2), L(el.y2)]]
        case 'polyline': return pointsPath(el.getAttribute('points'), false)
        case 'polygon': return pointsPath(el.getAttribute('points'), true)
        default: return []
      }
    }
    const localTransformOf = (el) => { const t = el.transform?.baseVal?.consolidate?.(); return t ? matrixOf(t.matrix) : I }
    const clipFor = (el, M) => {
      const v = cs(el).clipPath
      const u = /url\(\s*["']?#([^"')]+)["']?\s*\)/.exec(v || '')
      if (!u) return null
      const cp = d.getElementById(u[1])
      if (!cp || cp.localName !== 'clipPath') return null
      if (cp.getAttribute('clipPathUnits') === 'objectBoundingBox') { warn('A clip path that uses object units was ignored.'); return null }
      const base = mul(M, localTransformOf(cp))
      const parts = []
      for (const c of cp.children) {
        if (!SHAPES.has(c.localName)) continue
        const dd = shapePath(c)
        if (dd.length) parts.push(...mapPath(dd, mul(base, localTransformOf(c))))
      }
      return parts.length ? { d: parts, rule: cs(cp).clipRule === 'evenodd' || (cp.firstElementChild && cs(cp.firstElementChild).clipRule === 'evenodd') ? 'evenodd' : 'nonzero' } : null
    }

    const dashOf = (style, k) => {
      const v = style.strokeDasharray
      if (!v || v === 'none') return null
      const a = v.split(/[\s,]+/).map((x) => parseFloat(x) * k).filter((x) => Number.isFinite(x))
      if (!a.length || a.every((x) => x === 0)) return null
      return a.length % 2 ? [...a, ...a] : a
    }

    // ----- text -----
    const collapse = (strs, preserve) => {
      let prevSpace = true
      const out = strs.map((s) => {
        let t = String(s).replace(/[\n\r\t]/g, ' ')
        if (!preserve) {
          t = t.replace(/ +/g, ' ')
          if (prevSpace && t.startsWith(' ')) t = t.slice(1)
          if (t) prevSpace = t.endsWith(' ')
        }
        return t
      })
      if (!preserve && out.length) { const li = out.length - 1; out[li] = out[li].replace(/ +$/, '') }
      return out
    }
    const textNodes = (el, op, M) => {
      const runs = []
      const walk = (node) => {
        for (const c of node.childNodes) {
          if (c.nodeType === 3) runs.push({ str: c.nodeValue, el: node })
          else if (c.nodeType === 1 && /^(tspan|a|textPath)$/i.test(c.localName)) { if (/textPath/i.test(c.localName)) dropped.textPath++; walk(c) }
        }
      }
      walk(el)
      if (!runs.length) return
      const preserve = el.getAttribute('xml:space') === 'preserve' || cs(el).whiteSpace?.startsWith('pre')
      const strs = collapse(runs.map((r) => r.str), preserve)
      let total = 0
      try { total = el.getNumberOfChars() } catch { total = 0 }
      const sum = strs.reduce((a, s) => a + s.length, 0)
      const single = sum !== total
      if (single && runs.length > 1) warn('Text with mixed styles in one line was simplified.')
      let idx = 0
      const emit = (str, run, startIdx) => {
        if (!str.trim() && !preserve) return
        const st = cs(run.el)
        const size = parseFloat(st.fontSize) || 16
        let p
        try { p = el.getStartPositionOfChar(Math.min(startIdx, Math.max(0, total - 1))) } catch { p = { x: parseFloat(el.getAttribute('x')) || 0, y: parseFloat(el.getAttribute('y')) || 0 } }
        let rot = 0
        try { rot = el.getRotationOfChar(Math.min(startIdx, Math.max(0, total - 1))) || 0 } catch { rot = 0 }
        const { paint, alpha } = paintOf(run.el, st.fill, null, M)
        const fill = typeof paint === 'string' ? paint : paint?.stops?.[0]?.c || (paint === null && st.fill === 'none' ? null : '#000000')
        if (!fill) return
        const fam = (st.fontFamily || 'sans-serif').split(',')[0].replace(/["']/g, '').trim()
        const fw = st.fontWeight
        items.push({ ...op, t: 'text', str, family: fam, size, bold: fw === 'bold' || parseInt(fw, 10) >= 600, italic: /italic|oblique/.test(st.fontStyle), fill, opacity: alpha * op.opacity,
          m: mul(M, mul(translate(p.x, p.y), rotate((rot * Math.PI) / 180))) })
      }
      if (single) { emit(strs.join(''), runs[0], 0); return }
      runs.forEach((r, i) => { emit(strs[i], r, idx); idx += strs[i].length })
    }

    // ----- walk -----
    const visit = async (el, inherited) => {
      const tag = el.localName.toLowerCase()
      if (SKIP.has(tag)) return
      const st = cs(el)
      if (st.display === 'none') return
      const op = { opacity: inherited.opacity * (parseFloat(st.opacity) || (st.opacity === '0' ? 0 : 1)), clips: inherited.clips }
      if (st.opacity !== '1' && tag === 'g') dropped.groupOpacity++
      if (st.filter && st.filter !== 'none') dropped.filter++
      if (st.mask && st.mask !== 'none') dropped.mask++
      const M = ctmOf(el)
      if (!M) return
      let clips = inherited.clips
      const own = clipFor(el, M)
      if (own) clips = [...clips, own]
      const next = { opacity: op.opacity, clips }
      if (tag === 'g' || tag === 'a' || tag === 'svg' || tag === 'switch') {
        for (const c of el.children) await visit(c, next)
        return
      }
      const base = { opacity: op.opacity, ...(clips.length ? { clip: clips } : {}), ...(el.id ? { name: el.id } : {}) }
      if (tag === 'text') { textNodes(el, base, M); return }
      if (tag === 'image') {
        const href = hrefOf(el)
        if (!href || st.visibility === 'hidden') return
        const img = new Image()
        img.src = href
        try { await img.decode() } catch { warn('An embedded image could not be decoded and was skipped.'); return }
        const x = L(el.x), y = L(el.y)
        let bw = L(el.width), bh = L(el.height)
        if (!(bw > 0)) bw = img.naturalWidth
        if (!(bh > 0)) bh = img.naturalHeight
        const par = (el.getAttribute('preserveAspectRatio') || 'xMidYMid meet').trim().split(/\s+/)
        let fw = bw, fh = bh, fx = x, fy = y
        if (par[0] !== 'none' && img.naturalWidth && img.naturalHeight) {
          const sc = (par[1] === 'slice' ? Math.max : Math.min)(bw / img.naturalWidth, bh / img.naturalHeight)
          fw = img.naturalWidth * sc; fh = img.naturalHeight * sc
          const al = par[0] || 'xMidYMid'
          fx = x + (al.includes('xMin') ? 0 : al.includes('xMax') ? bw - fw : (bw - fw) / 2)
          fy = y + (al.includes('YMin') ? 0 : al.includes('YMax') ? bh - fh : (bh - fh) / 2)
        }
        const it = { t: 'image', href, w: img.naturalWidth, h: img.naturalHeight, opacity: op.opacity, m: mul(M, [fw, 0, 0, fh, fx, fy]), ...(clips.length ? { clip: clips } : {}) }
        if (par[1] === 'slice') it.clip = [...(it.clip || []), { d: mapPath(rectPath(x, y, bw, bh), M), rule: 'nonzero' }]
        items.push(it)
        return
      }
      if (!SHAPES.has(tag)) return
      const local = shapePath(el)
      if (!local.length) return
      if (st.markerStart !== 'none' || st.markerEnd !== 'none' || st.markerMid !== 'none') dropped.marker++
      const bbox = pathBBox(local)
      const f = paintOf(el, st.fill, bbox, M), s = paintOf(el, st.stroke, bbox, M)
      const sw = parseFloat(st.strokeWidth)
      const k = meanScale(M)
      const hasStroke = s.paint && typeof s.paint === 'string' && sw > 0
      if (!f.paint && !hasStroke) return
      if (hasStroke && Math.abs(Math.hypot(M[0], M[1]) - Math.hypot(M[2], M[3])) > 0.02 * k) dropped.aniso++
      if (st.visibility === 'hidden') return
      const fo = parseFloat(st.fillOpacity), so = parseFloat(st.strokeOpacity)
      items.push({
        ...base, t: 'path', d: mapPath(local, M),
        fill: f.paint, fillOpacity: (Number.isFinite(fo) ? fo : 1) * f.alpha * op.opacity, rule: st.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
        stroke: hasStroke ? s.paint : null, strokeWidth: hasStroke ? sw * k : 0, strokeOpacity: (Number.isFinite(so) ? so : 1) * s.alpha * op.opacity,
        cap: { butt: 0, round: 1, square: 2 }[st.strokeLinecap] ?? 0, join: { miter: 0, 'miter-clip': 0, round: 1, bevel: 2 }[st.strokeLinejoin] ?? 0,
        miter: parseFloat(st.strokeMiterlimit) || 4, dash: hasStroke ? dashOf(st, k) : null, dashOffset: (parseFloat(st.strokeDashoffset) || 0) * k,
      })
    }
    await visit(d.documentElement, { opacity: 1, clips: [] })
    if (dropped.filter) warn(`Filters (blur, shadows and similar) on ${dropped.filter} element(s) are not supported in CorelDRAW SVG and were removed.`)
    if (dropped.mask) warn(`Masks on ${dropped.mask} element(s) are not supported and were removed.`)
    if (dropped.marker) warn('Line markers (arrowheads) were not carried over.')
    if (dropped.pattern) warn('Pattern fills were replaced by a plain light grey.')
    if (dropped.textPath) warn('Text on a path was written as straight text.')
    if (dropped.aniso) warn('Stroke widths on unevenly scaled shapes were averaged.')
    if (dropped.groupOpacity) warn('Group opacity was applied to each object inside the group.')
    return { pages: [{ w: w * PX, h: h * PX, items }], warnings: [...warnings] }
  } finally {
    mount.dispose()
  }
}
