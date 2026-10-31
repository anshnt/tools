// KML reading and writing (Placemarks, folders, styles, ExtendedData, MultiGeometry, gx:Track). KMZ is a zip around doc.kml (see _geo.js).
import { parseXml, kids, kid, txt, esc, tag } from './_xml.js'
import { mergeGeoms, flatGeoms, fixWinding, isNum, cell } from './_util.js'

const SKIP_PROPS = new Set(['name', 'description', 'desc', 'folder', 'stroke', 'stroke-opacity', 'stroke-width', 'fill', 'fill-opacity', 'marker-color', 'timestamp', 'begin', 'end', 'time', 'coordinateProperties'])

// KML colors are aabbggrr.
const fromKmlColor = (c) => {
  const m = /^#?([0-9a-f]{8})$/i.exec((c || '').trim())
  if (!m) return null
  const [a, b, g, r] = [0, 2, 4, 6].map((i) => m[1].slice(i, i + 2))
  return { hex: `#${r}${g}${b}`.toLowerCase(), opacity: Math.round((parseInt(a, 16) / 255) * 100) / 100 }
}
const toKmlColor = (hex, opacity = 1) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''))
  if (!m) return null
  const a = Math.round(Math.min(1, Math.max(0, Number(opacity ?? 1))) * 255).toString(16).padStart(2, '0')
  return a + m[1].slice(4, 6) + m[1].slice(2, 4) + m[1].slice(0, 2)
}

function parseCoords(str) {
  const out = []
  for (const t of String(str || '').trim().replace(/\s*,\s*/g, ',').split(/\s+/)) {
    if (!t) continue
    const p = t.split(',').map(Number)
    if (p.length >= 2 && isNum(p[0]) && isNum(p[1])) out.push(p.length > 2 && isNum(p[2]) ? [p[0], p[1], p[2]] : [p[0], p[1]])
  }
  return out
}
const ring = (n) => parseCoords(txt(kid(n, 'LinearRing'), 'coordinates'))

/** A KML geometry element -> { geometry, times? } where times parallels the coordinates of gx:Track lines. */
function geometryOf(n, notes) {
  switch (n.name) {
    case 'Point': { const c = parseCoords(txt(n, 'coordinates')); return c[0] ? { geometry: { type: 'Point', coordinates: c[0] } } : null }
    case 'LineString': case 'LinearRing': { const c = parseCoords(txt(n, 'coordinates')); return c.length ? { geometry: { type: 'LineString', coordinates: c } } : null }
    case 'Polygon': {
      const outer = kid(n, 'outerBoundaryIs')
      if (!outer) return null
      const rings = [ring(outer), ...kids(n, 'innerBoundaryIs').map(ring)].filter((r) => r.length >= 3)
      return rings.length ? { geometry: { type: 'Polygon', coordinates: fixWinding(rings) } } : null
    }
    case 'Track': {
      const when = kids(n, 'when').map((w) => w.text.trim())
      const coords = kids(n, 'coord').map((c) => c.text.trim().split(/\s+/).map(Number)).filter((p) => p.length >= 2 && p.every(isNum))
      if (!coords.length) return null
      return { geometry: { type: 'LineString', coordinates: coords.map((p) => (p.length > 2 ? p.slice(0, 3) : p)) }, times: when.length === coords.length ? when : undefined }
    }
    case 'MultiTrack': {
      const parts = kids(n, 'Track').map((t) => geometryOf(t, notes)).filter(Boolean)
      if (!parts.length) return null
      const hasTimes = parts.every((p) => p.times)
      return { geometry: { type: 'MultiLineString', coordinates: parts.map((p) => p.geometry.coordinates) }, times: hasTimes ? parts.map((p) => p.times) : undefined }
    }
    case 'MultiGeometry': {
      const parts = n.children.map((c) => geometryOf(c, notes)).filter(Boolean)
      if (!parts.length) return null
      const geoms = parts.flatMap((p) => flatGeoms(p.geometry))
      return { geometry: mergeGeoms(geoms) }
    }
    case 'Model': notes.add('3D models (Model) were skipped.'); return null
    default: return null
  }
}

export function readKml(text) {
  const root = parseXml(text)
  const notes = new Set()
  const styles = new Map(), maps = new Map()
  const collect = (n) => {
    for (const c of n.children) {
      if (c.name === 'Style' && c.attrs.id) styles.set(c.attrs.id, styleProps(c))
      else if (c.name === 'StyleMap' && c.attrs.id) maps.set(c.attrs.id, c)
      if (['Document', 'Folder', 'kml'].includes(c.name)) collect(c)
    }
  }
  collect(root)
  const styleFor = (n) => {
    const inline = kid(n, 'Style')
    if (inline) return styleProps(inline)
    const url = txt(n, 'styleUrl')
    if (!url?.startsWith('#')) return {}
    let id = url.slice(1)
    const sm = maps.get(id)
    if (sm) {
      const pair = kids(sm, 'Pair').find((p) => txt(p, 'key') === 'normal') || kids(sm, 'Pair')[0]
      id = (txt(pair, 'styleUrl') || '').replace(/^#/, '')
    }
    return styles.get(id) || {}
  }
  const features = []
  const walk = (n, path) => {
    for (const c of n.children) {
      if (c.name === 'Placemark') {
        const g = geometryOf2(c)
        if (!g) { notes.add('Placemarks without a geometry were skipped.'); continue }
        const props = {}
        const name = txt(c, 'name'); if (name) props.name = name
        const desc = txt(c, 'description'); if (desc) props.description = desc
        if (path.length) props.folder = path.join('/')
        Object.assign(props, styleFor(c))
        const ts = txt(kid(c, 'TimeStamp'), 'when'); if (ts) props.timestamp = ts
        const span = kid(c, 'TimeSpan')
        if (span) { const b = txt(span, 'begin'), e = txt(span, 'end'); if (b) props.begin = b; if (e) props.end = e }
        const ext = kid(c, 'ExtendedData')
        if (ext) {
          for (const d of kids(ext, 'Data')) { const v = txt(d, 'value'); if (d.attrs.name) props[d.attrs.name] = typed(v ?? d.text.trim()) }
          for (const sd of kids(ext, 'SchemaData')) for (const s of kids(sd, 'SimpleData')) if (s.attrs.name) props[s.attrs.name] = typed(s.text.trim())
        }
        if (g.times) props.coordinateProperties = { times: g.times }
        features.push({ type: 'Feature', properties: props, geometry: g.geometry })
      } else if (c.name === 'Folder' || c.name === 'Document') {
        const nm = c.name === 'Folder' ? txt(c, 'name') : null
        walk(c, nm ? [...path, nm] : path)
      } else if (c.name === 'GroundOverlay' || c.name === 'ScreenOverlay' || c.name === 'PhotoOverlay') notes.add('Image overlays were skipped.')
      else if (c.name === 'NetworkLink') notes.add('Network links were skipped (they point to files that are not in this one).')
    }
  }
  const geometryOf2 = (pm) => {
    const parts = []
    for (const c of pm.children) { const g = geometryOf(c, notes); if (g) parts.push(g) }
    if (!parts.length) return null
    if (parts.length === 1) return parts[0]
    return { geometry: mergeGeoms(parts.flatMap((p) => flatGeoms(p.geometry))) }
  }
  walk(root.name === 'kml' ? root : { children: [root] }, [])
  return { features, notes: [...notes], name: txt(kid(root, 'Document'), 'name') }
}

function typed(v) {
  if (v === undefined || v === '') return v ?? null
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v) && v.replace(/^-/, '').length < 16 && !/^-?0\d/.test(v)) return Number(v)
  return v
}

function styleProps(st) {
  const o = {}
  const ls = kid(st, 'LineStyle')
  if (ls) {
    const c = fromKmlColor(txt(ls, 'color')); if (c) { o.stroke = c.hex; o['stroke-opacity'] = c.opacity }
    const w = Number(txt(ls, 'width')); if (isNum(w) && w > 0) o['stroke-width'] = w
  }
  const ps = kid(st, 'PolyStyle')
  if (ps) {
    const c = fromKmlColor(txt(ps, 'color')); if (c) { o.fill = c.hex; o['fill-opacity'] = c.opacity }
    if (txt(ps, 'fill') === '0') o['fill-opacity'] = 0
  }
  const is = kid(st, 'IconStyle')
  if (is) { const c = fromKmlColor(txt(is, 'color')); if (c) o['marker-color'] = c.hex }
  return o
}

// ---------------- writing ----------------
const coordStr = (p) => (isNum(p[2]) ? `${p[0]},${p[1]},${p[2]}` : `${p[0]},${p[1]}`)
const coords = (list) => `<coordinates>${list.map(coordStr).join(' ')}</coordinates>`
const poly = (rings) => {
  const r = fixWinding(rings)
  return `<Polygon><outerBoundaryIs><LinearRing>${coords(r[0])}</LinearRing></outerBoundaryIs>${r.slice(1).map((h) => `<innerBoundaryIs><LinearRing>${coords(h)}</LinearRing></innerBoundaryIs>`).join('')}</Polygon>`
}
function track(line, times) {
  return `<gx:Track>${times.map((t) => `<when>${esc(t)}</when>`).join('')}${line.map((p) => `<gx:coord>${p[0]} ${p[1]} ${isNum(p[2]) ? p[2] : 0}</gx:coord>`).join('')}</gx:Track>`
}
function geometryXml(g, times, useTracks) {
  switch (g.type) {
    case 'Point': return `<Point>${coords([g.coordinates])}</Point>`
    case 'MultiPoint': return `<MultiGeometry>${g.coordinates.map((c) => `<Point>${coords([c])}</Point>`).join('')}</MultiGeometry>`
    case 'LineString':
      if (useTracks && Array.isArray(times) && times.length === g.coordinates.length && times.every((t) => typeof t === 'string' && t)) return track(g.coordinates, times)
      return `<LineString><tessellate>1</tessellate>${coords(g.coordinates)}</LineString>`
    case 'MultiLineString':
      if (useTracks && Array.isArray(times) && times.length === g.coordinates.length && g.coordinates.every((l, i) => Array.isArray(times[i]) && times[i].length === l.length)) return `<gx:MultiTrack><gx:interpolate>0</gx:interpolate>${g.coordinates.map((l, i) => track(l, times[i])).join('')}</gx:MultiTrack>`
      return `<MultiGeometry>${g.coordinates.map((l) => `<LineString><tessellate>1</tessellate>${coords(l)}</LineString>`).join('')}</MultiGeometry>`
    case 'Polygon': return poly(g.coordinates)
    case 'MultiPolygon': return `<MultiGeometry>${g.coordinates.map(poly).join('')}</MultiGeometry>`
    case 'GeometryCollection': return `<MultiGeometry>${g.geometries.map((x) => geometryXml(x, null, false)).join('')}</MultiGeometry>`
    default: return ''
  }
}

const NAME_KEYS = ['name', 'Name', 'NAME', 'title', 'Title', 'label', 'id', 'ID']
export function pickName(props, nameField) {
  if (nameField && props[nameField] != null && props[nameField] !== '') return String(props[nameField])
  for (const k of NAME_KEYS) if (typeof props[k] === 'string' && props[k]) return props[k]
  return undefined
}

/**
 * features -> KML text. opts: { name, nameField, tracks (use gx:Track when times exist, default true) }.
 */
export function writeKml(features, opts = {}) {
  const useTracks = opts.tracks !== false
  const styleIds = new Map()
  let styles = ''
  const styleFor = (p) => {
    const line = toKmlColor(p.stroke, p['stroke-opacity']), fillOp = p['fill-opacity'], fill = toKmlColor(p.fill, fillOp), mk = toKmlColor(p['marker-color'])
    const w = p['stroke-width']
    if (!line && !fill && !mk && !w) return ''
    const key = [line, w, fill, fillOp, mk].join('|')
    if (!styleIds.has(key)) {
      const id = `s${styleIds.size + 1}`
      styleIds.set(key, id)
      styles += `<Style id="${id}">${mk ? `<IconStyle><color>${mk}</color></IconStyle>` : ''}${line || w ? `<LineStyle>${line ? `<color>${line}</color>` : ''}${isNum(Number(w)) && w ? `<width>${Number(w)}</width>` : ''}</LineStyle>` : ''}${fill || fillOp === 0 ? `<PolyStyle>${fill ? `<color>${fill}</color>` : ''}${fillOp === 0 ? '<fill>0</fill>' : ''}</PolyStyle>` : ''}</Style>`
    }
    return `<styleUrl>#${styleIds.get(key)}</styleUrl>`
  }
  const pm = (f) => {
    const p = f.properties || {}
    const cp = p.coordinateProperties
    const name = pickName(p, opts.nameField)
    const ext = Object.keys(p).filter((k) => !SKIP_PROPS.has(k) && p[k] !== null && p[k] !== undefined)
    const when = p.timestamp || (typeof p.time === 'string' ? p.time : null)
    return `<Placemark>${tag('name', name)}${tag('description', p.description ?? p.desc)}${when ? `<TimeStamp><when>${esc(when)}</when></TimeStamp>` : ''}${styleFor(p)}${ext.length ? `<ExtendedData>${ext.map((k) => `<Data name="${esc(k)}"><value>${esc(cell(p[k]))}</value></Data>`).join('')}</ExtendedData>` : ''}${geometryXml(f.geometry, cp?.times, useTracks)}</Placemark>`
  }
  // folders: the "folder" property (a/b/c) becomes nested folders
  const tree = { items: [], kids: new Map() }
  for (const f of features) {
    if (!f.geometry) continue
    let node = tree
    for (const part of String(f.properties?.folder || '').split('/').filter(Boolean)) {
      if (!node.kids.has(part)) node.kids.set(part, { items: [], kids: new Map() })
      node = node.kids.get(part)
    }
    node.items.push(f)
  }
  const emit = (node) => node.items.map(pm).join('') + [...node.kids].map(([n, c]) => `<Folder><name>${esc(n)}</name>${emit(c)}</Folder>`).join('')
  const body = emit(tree)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document>${tag('name', opts.name || 'Converted')}${styles}${body}</Document></kml>\n`
}
