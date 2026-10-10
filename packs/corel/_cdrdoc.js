// CDR reader output -> an editable document (pages, layers, groups, objects) and the shared vector model used by the writers.
// Editing never touches the parsed file: edits are small overrides on the document nodes (fill, line, move, delete, hide).
import { I, mul, apply, mapPath, pathBBox, unionBox, ellipsePath, itemBBox, translate } from './_model.js'

const PT = 72 // points per inch
const K = 0.5522847498307936
const rad = (d) => (d * Math.PI) / 180

/** Rectangle with a separate radius per corner (top-right, top-left, bottom-left, bottom-right), centred at the origin, y up. */
function rectLocal(w, h, [tr, tl, bl, br]) {
  const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2
  const lim = (r) => Math.max(0, Math.min(r, w / 2, h / 2))
  tr = lim(tr); tl = lim(tl); bl = lim(bl); br = lim(br)
  if (!tr && !tl && !bl && !br) return [['M', x0, y1], ['L', x1, y1], ['L', x1, y0], ['L', x0, y0], ['Z']]
  const d = [['M', x0 + tl, y1], ['L', x1 - tr, y1]]
  if (tr) d.push(['C', x1 - tr + tr * K, y1, x1, y1 - tr + tr * K, x1, y1 - tr])
  d.push(['L', x1, y0 + br])
  if (br) d.push(['C', x1, y0 + br - br * K, x1 - br + br * K, y0, x1 - br, y0])
  d.push(['L', x0 + bl, y0])
  if (bl) d.push(['C', x0 + bl - bl * K, y0, x0, y0 + bl - bl * K, x0, y0 + bl])
  d.push(['L', x0, y1 - tl])
  if (tl) d.push(['C', x0, y1 - tl + tl * K, x0 + tl - tl * K, y1, x0 + tl, y1])
  d.push(['Z'])
  return d
}

/** Ellipse or arc/pie (angles in degrees, counter-clockwise, y up). */
function ellipseLocal(g) {
  const { cx, cy, rx, ry, a1, a2, pie } = g
  if (!rx || !ry) return []
  const full = Math.abs(a1 - a2) < 1e-6 || Math.abs(Math.abs(a2 - a1) - 360) < 1e-6
  if (full) return ellipsePath(cx, cy, rx, ry)
  let sweep = (a2 - a1) % 360
  if (sweep <= 0) sweep += 360
  const n = Math.ceil(sweep / 90), step = rad(sweep / n), t = (4 / 3) * Math.tan(step / 4)
  const P = (a) => [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]
  const D = (a) => [-rx * Math.sin(a), ry * Math.cos(a)]
  let a = rad(a1)
  const s = P(a)
  const d = [['M', s[0], s[1]]]
  for (let i = 0; i < n; i++) {
    const b = a + step, p0 = P(a), p3 = P(b), d0 = D(a), d3 = D(b)
    d.push(['C', p0[0] + t * d0[0], p0[1] + t * d0[1], p3[0] - t * d3[0], p3[1] - t * d3[1], p3[0], p3[1]])
    a = b
  }
  if (pie) { d.push(['L', cx, cy]); d.push(['Z']) }
  return d
}

const gradientFor = (fill, box) => {
  // box in page points; stops run along the CorelDRAW angle (0 degrees = left to right)
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2
  const stops = fill.stops.map((s) => ({ o: s.o, c: s.c, a: 1 }))
  if (fill.kind === 'radial') return { g: 'radial', cx, cy, r: Math.max(box.w, box.h) / 2 || 1, fx: cx, fy: cy, m: I, stops, spread: 'pad' }
  const th = rad(fill.angle || 0), dx = Math.cos(th), dy = -Math.sin(th)
  const half = (Math.abs(box.w * dx) + Math.abs(box.h * dy)) / 2 || 1
  return { g: 'linear', x1: cx - dx * half, y1: cy - dy * half, x2: cx + dx * half, y2: cy + dy * half, m: I, stops, spread: 'pad' }
}

/** Walk the CDR page structure and give every node the editing fields. */
export function buildDoc(cdr) {
  const doc = { version: cdr.version, versionName: cdr.versionName, container: cdr.container, warnings: [...cdr.warnings, ...(cdr.approx || [])], preview: cdr.preview, pages: [], index: new Map(), notes: [] }
  for (const p of cdr.pages) {
    const page = { name: p.name, master: p.master, wIn: p.w, hIn: p.h, layers: [] }
    for (const l of p.layers) {
      const layer = { name: l.name || (l.type === 8 ? 'Desktop' : l.type === 0x0a ? 'Guides' : l.type === 0x1a ? 'Grid' : `Layer ${page.layers.length + 1}`), type: l.type, visible: l.type === 0, objects: l.objects, page }
      const reg = (node, parent) => {
        node.visible = true; node.deleted = false; node.dx = 0; node.dy = 0; node.parent = parent; node.layer = layer
        doc.index.set(node.id, node)
        for (const c of node.children || []) reg(c, node)
      }
      for (const o of layer.objects) reg(o, null)
      page.layers.push(layer)
    }
    doc.pages.push(page)
  }
  return doc
}

export const isGroup = (n) => n.kind === 'group'
export function* leaves(nodes) { for (const n of nodes) { if (n.children) yield* leaves(n.children); else yield n } }
export const topOf = (n) => { while (n.parent) n = n.parent; return n }
export const nodeLabel = (n) => n.name || ({ rect: 'Rectangle', ellipse: 'Ellipse', path: 'Curve', text: 'Text', bitmap: 'Bitmap', group: 'Group', unknown: 'Object' }[n.kind] || 'Object') + (n.kind === 'text' && n.geom?.text ? `: ${n.geom.text.slice(0, 24)}` : '')

/**
 * Build the vector-model page for a document page. Returns {page, bounds, warnings} where page = {w, h, items} in points
 * (items carry id = object id). opts: {bitmapHref(bmp) -> data URL, showHidden}
 */
export function pageModel(page, opts = {}) {
  const warnings = new Set()
  const entries = [] // {node, d (page frame, inches, y up) | item parts}
  const place = (node, M, layer) => {
    const g = node.geom
    const mine = (d) => mapPath(d, M)
    let kind = node.kind, d = null, text = null, image = null
    if (g.kind === 'rect') d = mine(rectLocal(g.w, g.h, [g.radii[0], g.radii[1], g.radii[2], g.radii[3]]))
    else if (g.kind === 'ellipse') d = mine(ellipseLocal(g))
    else if (g.kind === 'path') d = mine(g.d)
    else if (g.kind === 'text') text = { x: g.x, y: g.y }
    else if (g.kind === 'bitmap') image = { x0: Math.min(g.x1, g.x2), x1: Math.max(g.x1, g.x2), yt: Math.max(g.y1, g.y2), yb: Math.min(g.y1, g.y2) }
    let box = d ? pathBBox(d) : null
    if (image) box = pathBBox(mapPath([['M', image.x0, image.yt], ['L', image.x1, image.yt], ['L', image.x1, image.yb], ['L', image.x0, image.yb], ['Z']], M))
    // align with the stored bounding box (positions are the least certain part of the format, the stored box is exact)
    let corr = [0, 0]
    if (node.bbox && box) {
      const bx = (node.bbox.x0 + node.bbox.x1) / 2 - (box.x + box.w / 2), by = (node.bbox.y0 + node.bbox.y1) / 2 - (box.y + box.h / 2)
      if (Math.hypot(bx, by) > 0.02) { corr = [bx, by]; warnings.add('Object positions were aligned with the bounding boxes stored in the file.') }
    }
    entries.push({ node, d, text, image, M, corr, kind, layer })
  }
  const walk = (nodes, M, layer, hidden) => {
    for (const n of nodes) {
      if (n.deleted) continue
      const hide = hidden || !n.visible
      const m = n.m ? mul(M, n.m) : M
      if (n.children) walk(n.children, m, layer, hide)
      else if (!hide) {
        if (n.kind === 'unknown' && n.bbox) entries.push({ node: n, d: null, placeholder: true, M, corr: [0, 0], layer })
        else if (n.kind !== 'unknown') place(n, m, layer)
        else if (n.geom?.note) warnings.add(`Some objects (${n.geom.note}) are not supported and are not shown.`)
      }
    }
  }
  for (const layer of page.layers) { if (layer.visible || opts.showHidden) walk(layer.objects, I, layer, false) }

  // frame: the page centre is the origin (CorelDRAW), unless the content says otherwise
  const W = page.wIn, H = page.hIn
  const ext = entries.reduce((u, e) => {
    let b = null
    if (e.placeholder) b = { x: e.node.bbox.x0, y: e.node.bbox.y0, w: e.node.bbox.x1 - e.node.bbox.x0, h: e.node.bbox.y1 - e.node.bbox.y0 }
    else if (e.d) b = pathBBox(e.d)
    else if (e.image) b = pathBBox(mapPath([['M', e.image.x0, e.image.yt], ['L', e.image.x1, e.image.yb]], e.M))
    else if (e.text) { const [tx, ty] = apply(e.M, e.text.x, e.text.y); b = { x: tx, y: ty - 0.1, w: 0.5, h: 0.2 } }
    if (!b) return u
    b = { x: b.x + e.corr[0] + e.node.dx, y: b.y + e.corr[1] + e.node.dy, w: b.w, h: b.h }
    e.b = b
    return unionBox(u, b)
  }, null)
  const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  let origin = 'center'
  let C = [PT, 0, 0, -PT, (W * PT) / 2, (H * PT) / 2]
  let pw = W * PT, ph = H * PT
  if (ext && ext.w > 0 && ext.h > 0) {
    const area = Math.max(ext.w * ext.h, 1e-9)
    const sc = inter(ext, { x: -W / 2, y: -H / 2, w: W, h: H }) / area
    const sk = inter(ext, { x: 0, y: 0, w: W, h: H }) / area
    if (Math.max(sc, sk) < 0.5) {
      const mx = Math.max(0.1, Math.max(ext.w, ext.h) * 0.03)
      origin = 'extent'
      C = [PT, 0, 0, -PT, (-ext.x + mx) * PT, (ext.y + ext.h + mx) * PT]
      pw = (ext.w + 2 * mx) * PT; ph = (ext.h + 2 * mx) * PT
      warnings.add('The objects lie outside the stored page, so the view shows the extent of the drawing.')
    } else if (sk > sc) { origin = 'corner'; C = [PT, 0, 0, -PT, 0, H * PT] }
  }

  const items = []
  const bitmap = opts.bitmapHref
  for (const e of entries) {
    const n = e.node
    const T = mul(C, mul(translate(e.corr[0] + n.dx, e.corr[1] + n.dy), I))
    const base = { id: n.id, ...(n.opacity < 1 ? { opacityOverride: n.opacity } : {}) }
    if (e.placeholder) {
      const b = n.bbox
      const d = mapPath([['M', b.x0, b.y1], ['L', b.x1, b.y1], ['L', b.x1, b.y0], ['L', b.x0, b.y0], ['Z']], mul(C, translate(n.dx, n.dy)))
      items.push({ ...base, t: 'path', d, fill: null, stroke: '#9aa0a6', strokeWidth: 0.75, dash: [4, 3], cap: 0, join: 0, rule: 'nonzero', placeholder: true })
      continue
    }
    const fill = n.fill, line = n.line
    if (e.d) {
      const d = mapPath(e.d, T)
      const box = pathBBox(d)
      let f = null
      if (fill?.type === 'solid') f = fill.color
      else if (fill?.type === 'gradient' && box) f = gradientFor(fill, box)
      else if (fill?.type === 'unsupported') f = '#c8c8c8'
      const stroked = line && !line.none
      const hair = !f && !stroked && n.kind === 'path' // an open curve with no outline would be invisible
      items.push({ ...base, t: 'path', d, fill: f, fillOpacity: n.opacity, rule: 'evenodd',
        stroke: stroked ? line.color : hair ? '#000000' : null, strokeWidth: stroked ? Math.max(line.width * PT, 0.25) : hair ? 0.25 : 0, strokeOpacity: n.opacity,
        cap: stroked ? line.cap : 0, join: stroked ? line.join : 0, miter: 4, dash: stroked && line.dash ? line.dash.map((v) => Math.max(v, 1) * Math.max(line.width * PT, 0.5)) : null })
    } else if (e.text) {
      const g = n.geom
      const m = mul(mul(T, mul(e.M, translate(g.x, g.y))), [1 / PT, 0, 0, -1 / PT, 0, 0])
      const sizePt = (g.size || 0.1667) * PT
      items.push({ ...base, t: 'text', str: g.text, family: g.family, size: sizePt, bold: g.bold, italic: g.italic, fill: fill?.type === 'solid' ? fill.color : '#000000', opacity: n.opacity, m })
    } else if (e.image) {
      const bmp = n.geom.bmp
      if (!bmp || !bitmap) { warnings.add('Some bitmaps could not be decoded and are not shown.'); continue }
      const im = e.image
      const u = mul(T, mul(e.M, [im.x1 - im.x0, 0, 0, -(im.yt - im.yb), im.x0, im.yt]))
      items.push({ ...base, t: 'image', href: bitmap(bmp), w: bmp.w, h: bmp.h, opacity: n.opacity, m: u })
    }
  }
  return { page: { w: pw, h: ph, name: page.name, items }, origin, warnings: [...warnings] }
}

/** Items of a page model grouped for hit testing: bounding box per object id (leaf and group). */
export function boundsById(doc, model) {
  const map = new Map()
  for (const it of model.page.items) {
    const b = itemBBox(it)
    if (!b) continue
    for (let n = doc.index.get(it.id); n; n = n.parent) map.set(n.id, unionBox(map.get(n.id), b))
  }
  return map
}

/** A model Doc for the writers: the listed pages (default every non-master page). */
export function toModelDoc(doc, pageIdxs, opts = {}) {
  const idx = pageIdxs || doc.pages.map((_, i) => i).filter((i) => !doc.pages[i].master)
  const warnings = new Set()
  const pages = idx.map((i) => { const r = pageModel(doc.pages[i], opts); r.warnings.forEach((w) => warnings.add(w)); return r.page })
  return { pages, warnings: [...warnings] }
}
