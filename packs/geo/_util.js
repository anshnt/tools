// Geometry helpers shared by the readers, writers and tools. Plain GeoJSON objects, coordinates are [x, y, z?].

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/** Visit every position of a geometry. fn(position) may return a new position to replace it. */
export function mapCoords(g, fn) {
  if (!g) return g
  if (g.type === 'GeometryCollection') return { ...g, geometries: g.geometries.map((x) => mapCoords(x, fn)) }
  const walk = (c, depth) => (depth === 0 ? fn(c) : c.map((x) => walk(x, depth - 1)))
  return { ...g, coordinates: walk(g.coordinates, DEPTH[g.type] ?? 0) }
}
const DEPTH = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 }

export function eachCoord(g, fn) {
  if (!g) return
  if (g.type === 'GeometryCollection') { for (const x of g.geometries) eachCoord(x, fn); return }
  const walk = (c, depth) => { if (depth === 0) fn(c); else for (const x of c) walk(x, depth - 1) }
  walk(g.coordinates, DEPTH[g.type] ?? 0)
}

/** [minX, minY, maxX, maxY] of a list of features, or null when empty. */
export function bboxOf(features) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity
  for (const f of features) eachCoord(f.geometry, (p) => { if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0]; if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1] })
  return a === Infinity ? null : [a, b, c, d]
}

/** Count features by geometry type (GeometryCollection members are counted under the collection). */
export function typeCounts(features) {
  const out = {}
  for (const f of features) { const t = f.geometry?.type || 'No geometry'; out[t] = (out[t] || 0) + 1 }
  return out
}

/** Signed area (positive = counter-clockwise) of a ring in x/y. */
export function ringArea(r) {
  let s = 0
  for (let i = 0, n = r.length - 1; i < n; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
  return s / 2
}
export const closeRing = (r) => {
  if (!r.length) return r
  const a = r[0], b = r[r.length - 1]
  return a[0] === b[0] && a[1] === b[1] ? r : [...r, a.slice()]
}
/** GeoJSON (RFC 7946) winding: exterior counter-clockwise, holes clockwise. Rings are closed. */
export function fixWinding(poly, shapefile = false) {
  return poly.map((ring, i) => {
    const r = closeRing(ring)
    const ccw = ringArea(r) > 0
    const wantCcw = shapefile ? i !== 0 : i === 0
    return ccw === wantCcw || ringArea(r) === 0 ? r : [...r].reverse()
  })
}

/** Flatten GeometryCollections into a list of simple (non-collection) geometries. */
export function flatGeoms(g, out = []) {
  if (!g) return out
  if (g.type === 'GeometryCollection') { for (const x of g.geometries) flatGeoms(x, out) } else out.push(g)
  return out
}

/** Merge simple geometries: same kinds become one Multi* geometry; mixed kinds become a GeometryCollection of those. */
export function mergeGeoms(list) {
  list = list.filter(Boolean)
  if (!list.length) return null
  const groups = new Map()
  for (const g of list) { const base = g.type.replace('Multi', ''); if (!groups.has(base)) groups.set(base, []); groups.get(base).push(g) }
  const merged = [...groups].map(([base, gs]) => (gs.length === 1 ? gs[0] : { type: `Multi${base}`, coordinates: gs.flatMap((g) => (g.type.startsWith('Multi') ? g.coordinates : [g.coordinates])) }))
  return merged.length === 1 ? merged[0] : { type: 'GeometryCollection', geometries: merged }
}

/** Approximate length in metres of a lon/lat line. */
export function lineLengthM(coords) {
  let s = 0
  for (let i = 1; i < coords.length; i++) s += haversine(coords[i - 1], coords[i])
  return s
}
export function haversine(a, b) {
  const R = 6371008.8, r = Math.PI / 180
  const dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)))
}

export const asProps = (p) => (p && typeof p === 'object' && !Array.isArray(p) ? p : {})
/** A scalar for table/DBF/CSV cells: objects and arrays become JSON text. */
export const cell = (v) => (v === undefined || v === null ? null : typeof v === 'object' ? JSON.stringify(v) : v)

/** Column names in first-seen order, hiding internal members. */
export const HIDDEN = new Set(['coordinateProperties'])
export function columnsOf(features) {
  const seen = new Set(), cols = []
  for (const f of features) for (const k of Object.keys(f.properties || {})) if (!seen.has(k) && !HIDDEN.has(k)) { seen.add(k); cols.push(k) }
  return cols
}

export const throwIfAborted = (signal) => { if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError', code: 'ABORT' }) }
export const tick = () => new Promise((r) => setTimeout(r, 0))
