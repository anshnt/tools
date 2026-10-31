// Simple operations applied between reading and writing: filter rows by attribute, keep chosen columns, simplify lines and polygons.
import { isNum } from './_util.js'

export const FILTER_OPS = [
  ['eq', 'equals'], ['ne', 'does not equal'], ['contains', 'contains'], ['notcontains', 'does not contain'], ['startswith', 'starts with'],
  ['gt', 'is greater than'], ['gte', 'is at least'], ['lt', 'is less than'], ['lte', 'is at most'], ['empty', 'is empty'], ['notempty', 'is not empty'],
]

const blank = (v) => v === null || v === undefined || v === ''
function test(v, op, target) {
  if (op === 'empty') return blank(v)
  if (op === 'notempty') return !blank(v)
  if (blank(v)) return op === 'ne' || op === 'notcontains'
  const a = typeof v === 'object' ? JSON.stringify(v) : v
  const na = Number(a), nb = Number(target)
  const bothNum = isNum(na) && isNum(nb) && String(target).trim() !== '' && String(a).trim() !== ''
  const sa = String(a).toLowerCase(), sb = String(target).toLowerCase()
  switch (op) {
    case 'eq': return bothNum ? na === nb : sa === sb
    case 'ne': return bothNum ? na !== nb : sa !== sb
    case 'contains': return sa.includes(sb)
    case 'notcontains': return !sa.includes(sb)
    case 'startswith': return sa.startsWith(sb)
    case 'gt': return bothNum ? na > nb : sa > sb
    case 'gte': return bothNum ? na >= nb : sa >= sb
    case 'lt': return bothNum ? na < nb : sa < sb
    case 'lte': return bothNum ? na <= nb : sa <= sb
    default: return true
  }
}

/** conditions: [{ column, op, value }] (all must match). */
export function filterFeatures(features, conditions) {
  const cs = (conditions || []).filter((c) => c && c.column)
  if (!cs.length) return features
  return features.filter((f) => cs.every((c) => test(f.properties?.[c.column], c.op || 'eq', c.value)))
}

export function pickColumns(features, columns) {
  if (!columns || !columns.length) return features
  const keep = new Set(columns)
  return features.map((f) => ({ ...f, properties: Object.fromEntries(Object.entries(f.properties || {}).filter(([k]) => keep.has(k) || k === 'coordinateProperties')) }))
}

// ---------- Douglas-Peucker ----------
/** Indices kept by Douglas-Peucker on points already in a metric plane. */
function dpIndices(pts, tol) {
  const n = pts.length
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack = [[0, n - 1]]
  const t2 = tol * tol
  while (stack.length) {
    const [a, b] = stack.pop()
    let max = -1, idx = -1
    const [ax, ay] = pts[a], [bx, by] = pts[b]
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]
      let d2
      if (len2 === 0) d2 = (px - ax) ** 2 + (py - ay) ** 2
      else { const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)); d2 = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2 }
      if (d2 > max) { max = d2; idx = i }
    }
    if (max > t2 && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]) }
  }
  const out = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i)
  return out
}

/** Simplify one list of lon/lat positions. Returns the kept indices (rings keep at least 4 positions, lines 2). */
function simplifyLine(coords, tolM, ring) {
  const n = coords.length
  if (n <= (ring ? 4 : 2)) return coords.map((_, i) => i)
  let lat = 0
  for (const c of coords) lat += c[1]
  const kx = 111320 * Math.cos(((lat / n) * Math.PI) / 180), ky = 110574
  const pts = coords.map((c) => [c[0] * kx, c[1] * ky])
  const idx = dpIndices(pts, tolM)
  if (ring && idx.length < 4) return coords.map((_, i) => i)
  return idx
}

/** Simplify geometries (tolerance in metres). Per-vertex arrays in coordinateProperties are cut to match. */
export function simplifyFeatures(features, tolM) {
  if (!(tolM > 0)) return { features, before: 0, after: 0 }
  let before = 0, after = 0
  const out = features.map((f) => {
    const g = f.geometry
    if (!g) return f
    const cp = f.properties?.coordinateProperties
    let newCp = cp
    const cut = (coords, ring, arrs) => {
      before += coords.length
      const idx = simplifyLine(coords, tolM, ring)
      after += idx.length
      return { coords: idx.map((i) => coords[i]), arrs: arrs && Object.fromEntries(Object.entries(arrs).map(([k, v]) => [k, Array.isArray(v) ? idx.map((i) => v[i] ?? null) : v])) }
    }
    let ng
    switch (g.type) {
      case 'LineString': { const r = cut(g.coordinates, false, cp); ng = { ...g, coordinates: r.coords }; newCp = r.arrs; break }
      case 'MultiLineString': {
        const parts = g.coordinates.map((l, i) => cut(l, false, cp && Object.fromEntries(Object.entries(cp).map(([k, v]) => [k, v?.[i]]))))
        ng = { ...g, coordinates: parts.map((p) => p.coords) }
        if (cp) newCp = Object.fromEntries(Object.keys(cp).map((k) => [k, parts.map((p) => p.arrs[k])]))
        break
      }
      case 'Polygon': ng = { ...g, coordinates: g.coordinates.map((r) => cut(r, true).coords) }; break
      case 'MultiPolygon': ng = { ...g, coordinates: g.coordinates.map((p) => p.map((r) => cut(r, true).coords)) }; break
      default: ng = g
    }
    return { ...f, geometry: ng, properties: cp ? { ...f.properties, coordinateProperties: newCp } : f.properties }
  })
  return { features: out, before, after }
}

/** Apply the options in order: filter, columns, simplify. */
export function applyOps(features, o = {}) {
  const notes = []
  let out = features
  const conds = o.filters || (o.filterColumn ? [{ column: o.filterColumn, op: o.filterOp || 'eq', value: o.filterValue ?? '' }] : [])
  if (conds.some((c) => c && c.column)) {
    const n = out.length
    out = filterFeatures(out, conds)
    notes.push(`Filter kept ${out.length} of ${n} features.`)
  }
  const cols = typeof o.columns === 'string' ? o.columns.split(',').map((s) => s.trim()).filter(Boolean) : o.columns
  if (cols?.length) out = pickColumns(out, cols)
  if (o.tolerance > 0) {
    const r = simplifyFeatures(out, Number(o.tolerance))
    out = r.features
    if (r.before) notes.push(`Simplify reduced ${r.before.toLocaleString('en-US')} points to ${r.after.toLocaleString('en-US')}.`)
  }
  return { features: out, notes }
}
