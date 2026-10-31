// GML simple features (read only): GML 2 and 3 points, lines, polygons and their multi-geometries, with the feature's simple attributes.
import { parseXml, kids, kid } from './_xml.js'
import { isNum, fixWinding, mergeGeoms, flatGeoms } from './_util.js'

const nums = (s) => String(s || '').trim().split(/[\s,]+/).filter(Boolean).map(Number)
const GEOM = new Set(['Point', 'LineString', 'LinearRing', 'Polygon', 'MultiPoint', 'MultiLineString', 'MultiCurve', 'MultiPolygon', 'MultiSurface', 'MultiGeometry', 'Curve', 'Surface', 'Envelope', 'Box'])

function positions(n) {
  const out = []
  const pos = kids(n, 'pos')
  if (pos.length) { for (const p of pos) { const v = nums(p.text); if (v.length >= 2) out.push(v.slice(0, 3)) } return out }
  const pl = kid(n, 'posList')
  if (pl) {
    const dim = Number(pl.attrs.srsDimension || n.attrs.srsDimension || (nums(pl.text).length % 3 === 0 && nums(pl.text).length % 2 !== 0 ? 3 : 2)) || 2
    const v = nums(pl.text)
    for (let i = 0; i + dim <= v.length; i += dim) out.push(v.slice(i, i + Math.min(dim, 3)))
    return out
  }
  const c = kid(n, 'coordinates')
  if (c) {
    const dec = c.attrs.decimal || '.', cs = c.attrs.cs || ',', ts = c.attrs.ts || /\s+/
    for (const t of c.text.trim().split(ts)) { const v = t.split(cs).map((x) => Number(dec === '.' ? x : x.replace(dec, '.'))); if (v.length >= 2 && v.every(isNum)) out.push(v.slice(0, 3)) }
  }
  return out
}
const ringOf = (n) => { const lr = kid(n, 'LinearRing') || n; return positions(lr) }

function geometry(n) {
  switch (n.name) {
    case 'Point': { const p = positions(n); return p[0] ? { type: 'Point', coordinates: p[0] } : null }
    case 'LineString': case 'LinearRing': case 'Curve': {
      let p = positions(n)
      if (!p.length) p = kids(n, 'segments').flatMap((s) => s.children.flatMap((seg) => positions(seg)))
      return p.length ? { type: 'LineString', coordinates: p } : null
    }
    case 'Polygon': case 'Surface': {
      if (n.name === 'Surface') { const polys = (kid(n, 'patches')?.children || []).map((pp) => geometry({ ...pp, name: 'Polygon' })).filter(Boolean); return polys.length ? mergeGeoms(polys) : null }
      const outer = kid(n, 'exterior') || kid(n, 'outerBoundaryIs')
      if (!outer) return null
      const inner = [...kids(n, 'interior'), ...kids(n, 'innerBoundaryIs')]
      const rings = [ringOf(outer), ...inner.map(ringOf)].filter((r) => r.length >= 3)
      return rings.length ? { type: 'Polygon', coordinates: fixWinding(rings) } : null
    }
    case 'MultiPoint': case 'MultiLineString': case 'MultiCurve': case 'MultiPolygon': case 'MultiSurface': case 'MultiGeometry': {
      const members = n.children.flatMap((m) => m.children.filter((c) => GEOM.has(c.name)).map((c) => geometry(c)))
      const parts = members.filter(Boolean).flatMap((g) => flatGeoms(g))
      return parts.length ? mergeGeoms(parts) : null
    }
    default: return null
  }
}

const typed = (v) => (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v) && !/^-?0\d/.test(v) && v.length < 16 ? Number(v) : v)

export function readGml(text) {
  const root = parseXml(text)
  const members = []
  const collect = (n) => { for (const c of n.children) if (['featureMember', 'featureMembers', 'member'].includes(c.name)) members.push(...c.children) }
  if (/FeatureCollection/.test(root.name)) collect(root)
  else members.push(root)
  let srs = null
  const findSrs = (n) => { if (!srs && n.attrs.srsName) srs = n.attrs.srsName; for (const c of n.children) if (!srs) findSrs(c) }
  findSrs(root)
  const features = []
  for (const m of members) {
    let geom = null
    const props = {}
    const visit = (n) => {
      for (const c of n.children) {
        if (c.name === 'boundedBy') continue
        if (GEOM.has(c.name)) { if (!geom) geom = geometry(c) } else if (!c.children.length) { if (c.text.trim() !== '') props[c.name] = typed(c.text.trim()) } else visit(c)
      }
    }
    visit(m)
    if (m.attrs.id) props.gml_id = m.attrs.id
    features.push({ type: 'Feature', properties: props, geometry: geom })
  }
  if (!features.some((f) => f.geometry)) throw new Error('No simple-feature geometries were found in this GML file.')
  // GML 3 with an "urn:" or "http://www.opengis.net/def/crs" name and a geographic CRS lists latitude first
  const swap = !!srs && /^(urn:|http:\/\/www\.opengis\.net\/def\/crs)/i.test(srs) && /(4326|4269|4258|4612|4737|4490)\s*$/.test(srs)
  return { features, notes: [], srs, swap }
}
