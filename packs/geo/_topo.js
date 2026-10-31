// TopoJSON: reading (arcs, transform, all object types) and a simple writer (quantized, delta-encoded arcs, no arc sharing).
import { bboxOf, flatGeoms, fixWinding } from './_util.js'

export const isTopology = (o) => o && o.type === 'Topology' && Array.isArray(o.arcs) && o.objects && typeof o.objects === 'object'

export function readTopo(topo) {
  const { scale = [1, 1], translate = [0, 0] } = topo.transform || {}
  const q = !!topo.transform
  const arcs = topo.arcs.map((a) => {
    let x = 0, y = 0
    return a.map((p) => {
      if (q) { x += p[0]; y += p[1]; return [x * scale[0] + translate[0], y * scale[1] + translate[1], ...p.slice(2)] }
      return p.slice()
    })
  })
  const arc = (i) => (i < 0 ? arcs[~i].slice().reverse() : arcs[i])
  const stitch = (idx) => {
    const out = []
    idx.forEach((i, k) => { const a = arc(i); for (let j = k ? 1 : 0; j < a.length; j++) out.push(a[j]) })
    return out
  }
  const pt = (p) => (q ? [p[0] * scale[0] + translate[0], p[1] * scale[1] + translate[1], ...p.slice(2)] : p.slice())
  const geom = (g) => {
    switch (g.type) {
      case 'Point': return { type: 'Point', coordinates: pt(g.coordinates) }
      case 'MultiPoint': return { type: 'MultiPoint', coordinates: g.coordinates.map(pt) }
      case 'LineString': return { type: 'LineString', coordinates: stitch(g.arcs) }
      case 'MultiLineString': return { type: 'MultiLineString', coordinates: g.arcs.map(stitch) }
      case 'Polygon': return { type: 'Polygon', coordinates: fixWinding(g.arcs.map(stitch)) }
      case 'MultiPolygon': return { type: 'MultiPolygon', coordinates: g.arcs.map((p) => fixWinding(p.map(stitch))) }
      case 'GeometryCollection': return { type: 'GeometryCollection', geometries: g.geometries.map(geom).filter(Boolean) }
      default: return null
    }
  }
  const features = []
  const names = Object.keys(topo.objects)
  for (const name of names) {
    const obj = topo.objects[name]
    const items = obj.type === 'GeometryCollection' ? obj.geometries : [obj]
    for (const g of items) {
      const props = { ...(g.properties || {}) }
      if (names.length > 1) props.layer = name
      const f = { type: 'Feature', properties: props, geometry: geom(g) }
      if (g.id !== undefined) f.id = g.id
      features.push(f)
    }
  }
  return { features, notes: [] }
}

/** features -> TopoJSON object. opts: { name: 'collection', quantization: 100000 (0 = none) } */
export function writeTopo(features, opts = {}) {
  const qn = opts.quantization ?? 1e5
  const b = bboxOf(features) || [0, 0, 0, 0]
  const transform = qn ? { scale: [(b[2] - b[0]) / (qn - 1) || 1, (b[3] - b[1]) / (qn - 1) || 1], translate: [b[0], b[1]] } : null
  const arcs = []
  const quant = (p) => (transform ? [Math.round((p[0] - b[0]) / transform.scale[0]), Math.round((p[1] - b[1]) / transform.scale[1])] : [p[0], p[1]])
  const addArc = (coords, minLen) => {
    let pts = coords.map(quant)
    if (transform) pts = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1])
    while (pts.length < minLen) pts.push(pts[pts.length - 1] || [0, 0])
    let px = 0, py = 0
    arcs.push(transform ? pts.map((p) => { const d = [p[0] - px, p[1] - py]; px = p[0]; py = p[1]; return d }) : pts)
    return arcs.length - 1
  }
  const conv = (g) => {
    switch (g.type) {
      case 'Point': return { type: 'Point', coordinates: quant(g.coordinates) }
      case 'MultiPoint': return { type: 'MultiPoint', coordinates: g.coordinates.map(quant) }
      case 'LineString': return { type: 'LineString', arcs: [addArc(g.coordinates, 2)] }
      case 'MultiLineString': return { type: 'MultiLineString', arcs: g.coordinates.map((l) => [addArc(l, 2)]) }
      case 'Polygon': return { type: 'Polygon', arcs: g.coordinates.map((r) => [addArc(r, 4)]) }
      case 'MultiPolygon': return { type: 'MultiPolygon', arcs: g.coordinates.map((p) => p.map((r) => [addArc(r, 4)])) }
      default: return null
    }
  }
  const geometries = features.map((f, i) => {
    const parts = f.geometry ? flatGeoms(f.geometry).map(conv).filter(Boolean) : []
    const props = Object.fromEntries(Object.entries(f.properties || {}).filter(([k]) => k !== 'coordinateProperties'))
    const base = parts.length === 0 ? { type: null } : parts.length === 1 ? parts[0] : { type: 'GeometryCollection', geometries: parts }
    return { ...base, properties: props, ...(f.id !== undefined ? { id: f.id } : {}) }
  })
  const topo = { type: 'Topology', objects: { [opts.name || 'collection']: { type: 'GeometryCollection', geometries } }, arcs }
  if (transform) topo.transform = transform
  if (transform) topo.bbox = b
  return topo
}
