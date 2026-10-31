// GPX 1.0/1.1 reading and writing: waypoints, routes and tracks with time, elevation and Garmin heart rate / cadence / temperature.
import { parseXml, kids, kid, txt, esc, tag } from './_xml.js'
import { isNum, bboxOf, flatGeoms } from './_util.js'

const EXT = { hr: 'heartRates', cad: 'cadences', atemp: 'temperatures', wtemp: 'waterTemperatures', speed: 'speeds', power: 'powers' }
const EXT_OUT = { heartRates: 'hr', cadences: 'cad', temperatures: 'atemp', waterTemperatures: 'wtemp' }
const POINT_TEXT = ['name', 'cmt', 'desc', 'src', 'sym', 'type']

function ptExt(n, acc, idx) {
  const ex = kid(n, 'extensions')
  if (!ex) return
  const visit = (e) => {
    for (const c of e.children) {
      if (EXT[c.name]) { const v = Number(c.text); if (isNum(v)) (acc[EXT[c.name]] ||= [])[idx] = v } else visit(c)
    }
  }
  visit(ex)
}

function line(n, ptName) {
  const coords = [], times = [], acc = {}
  for (const p of kids(n, ptName)) {
    const lat = Number(p.attrs.lat), lon = Number(p.attrs.lon)
    if (!isNum(lat) || !isNum(lon)) continue
    const eleText = txt(p, 'ele'), ele = Number(eleText)
    coords.push(eleText && isNum(ele) ? [lon, lat, ele] : [lon, lat])
    times[coords.length - 1] = txt(p, 'time') || null
    ptExt(p, acc, coords.length - 1)
  }
  return { coords, times, acc }
}
const fill = (arr, n) => Array.from({ length: n }, (_, i) => arr?.[i] ?? null)
/** Per-vertex arrays (times, heart rate ...) go in properties.coordinateProperties, one entry per coordinate. */
function attach(props, parts) {
  const cp = {}
  if (parts.some((p) => p.times.some(Boolean))) cp.times = parts.length === 1 ? fill(parts[0].times, parts[0].coords.length) : parts.map((p) => fill(p.times, p.coords.length))
  for (const key of new Set(parts.flatMap((p) => Object.keys(p.acc)))) cp[key] = parts.length === 1 ? fill(parts[0].acc[key], parts[0].coords.length) : parts.map((p) => fill(p.acc[key], p.coords.length))
  if (Object.keys(cp).length) props.coordinateProperties = cp
}
function common(n, props) {
  for (const k of POINT_TEXT) { const v = txt(n, k); if (v) props[k] = v }
  const link = kid(n, 'link')
  if (link?.attrs.href) props.link = link.attrs.href
  const num = txt(n, 'number'); if (num) props.number = Number(num)
}

export function readGpx(text) {
  const root = parseXml(text)
  if (root.name !== 'gpx') throw new Error('This file is not a GPX file.')
  const features = []
  const meta = kid(root, 'metadata')
  for (const w of kids(root, 'wpt')) {
    const lat = Number(w.attrs.lat), lon = Number(w.attrs.lon)
    if (!isNum(lat) || !isNum(lon)) continue
    const props = {}
    common(w, props)
    const t = txt(w, 'time'); if (t) props.time = t
    const ele = txt(w, 'ele')
    features.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: ele && isNum(Number(ele)) ? [lon, lat, Number(ele)] : [lon, lat] } })
  }
  for (const r of kids(root, 'rte')) {
    const part = line(r, 'rtept')
    if (!part.coords.length) continue
    const props = {}
    common(r, props)
    attach(props, [part])
    features.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: part.coords } })
  }
  for (const t of kids(root, 'trk')) {
    const parts = kids(t, 'trkseg').map((s) => line(s, 'trkpt')).filter((p) => p.coords.length)
    if (!parts.length) continue
    const props = {}
    common(t, props)
    attach(props, parts)
    features.push({ type: 'Feature', properties: props, geometry: parts.length === 1 ? { type: 'LineString', coordinates: parts[0].coords } : { type: 'MultiLineString', coordinates: parts.map((p) => p.coords) } })
  }
  return { features, notes: [], name: txt(meta, 'name') || undefined }
}

// ---------------- writing ----------------
const point = (tagName, c, extra = '') => `<${tagName} lat="${c[1]}" lon="${c[0]}">${extra}</${tagName}>`
function trackPoint(c, i, cp) {
  const t = cp?.times?.[i]
  const ext = Object.entries(EXT_OUT).map(([k, short]) => (isNum(cp?.[k]?.[i]) ? `<gpxtpx:${short}>${cp[k][i]}</gpxtpx:${short}>` : '')).join('')
  return point('trkpt', c, `${isNum(c[2]) ? `<ele>${c[2]}</ele>` : ''}${t ? `<time>${esc(t)}</time>` : ''}${ext ? `<extensions><gpxtpx:TrackPointExtension>${ext}</gpxtpx:TrackPointExtension></extensions>` : ''}`)
}
const textTags = (p) => tag('name', p.name ?? p.Name) + tag('cmt', p.cmt) + tag('desc', p.desc ?? p.description) + tag('src', p.src) + (p.link ? `<link href="${esc(p.link)}"/>` : '')

/** features -> { text, notes }. Points become waypoints, lines become tracks, polygons become closed tracks (GPX has no polygons). */
export function writeGpx(features, opts = {}) {
  let wpts = '', trks = ''
  let polys = 0
  for (const f of features) {
    const p = f.properties || {}
    const cp = p.coordinateProperties
    for (const g of flatGeoms(f.geometry)) {
      if (g.type === 'Point' || g.type === 'MultiPoint') {
        for (const c of g.type === 'Point' ? [g.coordinates] : g.coordinates) {
          wpts += point('wpt', c, `${isNum(c[2]) ? `<ele>${c[2]}</ele>` : ''}${tag('time', p.time ?? p.timestamp)}${textTags(p)}${tag('sym', p.sym)}${tag('type', p.type)}`)
        }
      } else if (g.type === 'LineString' || g.type === 'MultiLineString') {
        const multi = g.type === 'MultiLineString'
        const segs = multi ? g.coordinates : [g.coordinates]
        const body = segs.map((s, si) => {
          const c = multi ? Object.fromEntries(Object.entries(cp || {}).map(([k, v]) => [k, v?.[si]])) : cp
          return `<trkseg>${s.map((q, i) => trackPoint(q, i, c)).join('')}</trkseg>`
        }).join('')
        trks += `<trk>${textTags(p)}${tag('type', p.type)}${body}</trk>`
      } else if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
        polys++
        const list = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
        trks += `<trk>${textTags(p)}${list.flat().map((r) => `<trkseg>${r.map((q) => trackPoint(q, 0, null)).join('')}</trkseg>`).join('')}</trk>`
      }
    }
  }
  const b = bboxOf(features)
  const name = opts.name ? `<name>${esc(opts.name)}</name>` : ''
  const meta = name || b ? `<metadata>${name}${b ? `<bounds minlat="${b[1]}" minlon="${b[0]}" maxlat="${b[3]}" maxlon="${b[2]}"/>` : ''}</metadata>` : ''
  const notes = []
  if (polys) notes.push(`GPX has no polygons: ${polys} polygon(s) were written as tracks along their rings.`)
  return {
    text: `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Toolverse geo converter" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">${meta}${wpts}${trks}</gpx>\n`,
    notes,
  }
}
