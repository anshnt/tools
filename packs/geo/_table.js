// Tables with coordinates: CSV / TSV / XLSX / JSON records -> features (auto-detecting lat/lon, x/y or WKT columns) and back.
import { isNum, columnsOf, cell, flatGeoms, eachCoord } from './_util.js'
import { parseWkt, parseWkb, hexToBytes, toWkt, looksLikeWkt, looksLikeHexWkb } from './_wkt.js'

// ---------- CSV ----------
export function detectDelimiter(text) {
  const head = text.slice(0, 20000).split(/\r?\n/).slice(0, 8).filter(Boolean)
  let best = ',', bestScore = -1
  for (const d of [',', ';', '\t', '|']) {
    const counts = head.map((l) => { let n = 0, q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === d && !q) n++ } return n })
    const score = counts.length && counts[0] > 0 && counts.every((c) => c === counts[0]) ? counts[0] * 10 + 5 : counts.length ? Math.min(...counts) : 0
    if (score > bestScore) { bestScore = score; best = d }
  }
  return best
}

/** Parse CSV text (quotes, doubled quotes, newlines in cells) into an array of rows. */
export function parseCsv(text, delimiter) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const d = delimiter || detectDelimiter(text)
  const rows = []
  let row = [], cur = '', q = false, i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i += 2; continue } q = false; i++; continue }
      cur += ch; i++; continue
    }
    if (ch === '"' && cur === '') { q = true; i++; continue }
    if (ch === d) { row.push(cur); cur = ''; i++; continue }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cur); cur = ''; i++
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
      continue
    }
    cur += ch; i++
  }
  if (cur !== '' || row.length) { row.push(cur); if (row.length > 1 || row[0] !== '') rows.push(row) }
  return rows
}

// ---------- coordinate columns ----------
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9ㄱ-힝一-鿿]/g, '')
const LAT = ['lat', 'latitude', 'latitud', 'latdd', 'latdeg', 'latdecimal', 'gpslat', 'gpslatitude', 'pointy', 'wgs84lat', 'wgs84latitude', 'ycoord', 'ycoordinate', 'ycentroid', 'ylat', '위도', '위도y', 'y좌표', '纬度']
const LON = ['lon', 'lng', 'long', 'longitude', 'longitud', 'londd', 'londeg', 'londecimal', 'gpslon', 'gpslong', 'gpslongitude', 'pointx', 'wgs84lon', 'wgs84longitude', 'xcoord', 'xcoordinate', 'xcentroid', 'xlon', '경도', '경도x', 'x좌표', '经度']
const X = ['x', 'easting', 'east', 'e', 'xcoord', 'xcoordinate', 'x좌표']
const Y = ['y', 'northing', 'north', 'n', 'ycoord', 'ycoordinate', 'y좌표']
const ELE = ['ele', 'elevation', 'alt', 'altitude', 'elev', 'z', 'gpsalt', 'altitudem', 'elevationm', '고도', '해발']
const WKT = ['wkt', 'geom', 'geometry', 'thegeom', 'shape', 'wkbgeometry', 'geomwkt', 'geometrywkt', 'geometria', 'geo']
const COMBINED = ['location', 'coordinates', 'coordinate', 'latlng', 'latlon', 'lnglat', 'lonlat', 'position', 'coord', 'point', 'latlong', 'gps', 'centroid']

/** Which columns hold the coordinates? Returns { kind: 'wkt'|'pair'|'combined', ... } or null. `o` can force columns by name. */
export function detectColumns(header, rows, o = {}) {
  const find = (names, forced) => {
    if (forced) { const i = header.findIndex((h) => String(h) === forced || norm(h) === norm(forced)); if (i < 0) throw new Error(`There is no column called "${forced}".`); return i }
    for (const nm of names) { const i = header.findIndex((h) => norm(h) === nm); if (i >= 0) return i }
    return -1
  }
  const sample = (ci) => rows.slice(0, 50).map((r) => r[ci]).filter((v) => v !== null && v !== undefined && v !== '')
  const eleCol = find(ELE, o.eleCol)
  let w = find(WKT, o.wktCol)
  if (w >= 0) {
    const s = sample(w)
    if (o.wktCol || s.some((v) => typeof v === 'string' && (looksLikeWkt(v) || looksLikeHexWkb(v) || v.trim().startsWith('{')))) return { kind: 'wkt', col: w }
  }
  if (!o.wktCol) {
    // any column whose values look like WKT
    for (let c = 0; c < header.length; c++) { if (sample(c).length && sample(c).every((v) => typeof v === 'string' && looksLikeWkt(v))) return { kind: 'wkt', col: c } }
  }
  let lat = find(LAT, o.latCol), lon = find(LON, o.lonCol)
  if (lat >= 0 && lon >= 0 && lat !== lon) return { kind: 'pair', lat, lon, ele: eleCol }
  const y = find(Y, o.latCol), x = find(X, o.lonCol)
  if (x >= 0 && y >= 0 && x !== y) return { kind: 'pair', lat: y, lon: x, ele: eleCol, xy: true }
  const cb = find(COMBINED, '')
  if (cb >= 0 && sample(cb).some((v) => typeof v === 'string' && /[-\d.]+\s*[,;\s]\s*[-\d.]+/.test(v))) return { kind: 'combined', col: cb, ele: eleCol }
  return null
}

/** A number, or a coordinate written like "37.5N", "37°25'19.07\"N" or "37,5". NaN when it is not a number. */
export function parseCoordNum(v) {
  if (typeof v === 'number') return v
  if (v === null || v === undefined) return NaN
  let s = String(v).trim()
  if (!s) return NaN
  if (/^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) return Number(s)
  if (/^[-+]?\d+,\d+$/.test(s)) return Number(s.replace(',', '.'))
  let hemi = ''
  const hm = /^([NSEW])\s*(.*)$/i.exec(s) || /^(.*?)\s*([NSEW])$/i.exec(s)
  if (hm) { hemi = (hm[1].length === 1 && /[NSEW]/i.test(hm[1]) ? hm[1] : hm[2]).toUpperCase(); s = (hm[1].length === 1 && /[NSEW]/i.test(hm[1]) ? hm[2] : hm[1]).trim() }
  let m = /^([-+]?\d+(?:[.,]\d+)?)\s*[°º]?$/.exec(s)
  let val
  if (m) val = Number(m[1].replace(',', '.'))
  else if ((m = /^([-+]?\d+)\s*(?:°|º|d|\s)\s*(\d+(?:\.\d+)?)\s*(?:['′m]|\s)\s*(?:(\d+(?:\.\d+)?)\s*(?:["″s]|'')?)?$/i.exec(s))) {
    const deg = Math.abs(Number(m[1]))
    val = (deg + Number(m[2]) / 60 + (m[3] ? Number(m[3]) / 3600 : 0)) * (/^-/.test(m[1]) ? -1 : 1)
  } else return NaN
  return hemi === 'S' || hemi === 'W' ? -Math.abs(val) : val
}

const looseNum = (v) => (typeof v === 'string' && /^-?(?:0|[1-9]\d{0,14})(\.\d+)?$/.test(v.trim()) ? Number(v) : v === '' ? null : v)

function geomFromCell(v) {
  const s = String(v).trim()
  if (!s) return null
  if (s.startsWith('{')) { try { const o = JSON.parse(s); return o.type === 'Feature' ? o.geometry : o } catch { return null } }
  try {
    if (looksLikeHexWkb(s)) return parseWkb(hexToBytes(s)).geometry
    return parseWkt(s).geometry
  } catch { return null }
}

/**
 * rows: array of arrays whose first row is the header (or array of objects when `objects` is true).
 * Returns { features, notes, used: {...}, skipped, srid? }.
 */
export function rowsToFeatures(rows, o = {}) {
  if (!rows.length) throw new Error('The table is empty.')
  const header = rows[0].map((h, i) => (h === null || h === undefined || String(h).trim() === '' ? `column${i + 1}` : String(h).trim()))
  const body = rows.slice(1)
  const cols = detectColumns(header, body, o)
  if (!cols) throw new Error(`Could not find coordinate columns. Name them lat and lon (or latitude/longitude, x/y), or add a WKT column. Columns found: ${header.slice(0, 12).join(', ')}.`)
  const drop = new Set([cols.col, cols.lat, cols.lon, cols.ele].filter((x) => x !== undefined && x >= 0))
  const keep = header.map((h, i) => [h, i]).filter(([, i]) => !drop.has(i))
  const features = []
  let skipped = 0
  let srid
  for (const r of body) {
    let geometry = null
    if (cols.kind === 'wkt') {
      const v = r[cols.col]
      geometry = v === null || v === undefined || v === '' ? null : geomFromCell(v)
    } else if (cols.kind === 'pair') {
      const a = parseCoordNum(r[cols.lat]), b = parseCoordNum(r[cols.lon])
      if (isNum(a) && isNum(b)) {
        const e = cols.ele >= 0 ? parseCoordNum(r[cols.ele]) : NaN
        geometry = { type: 'Point', coordinates: isNum(e) ? [b, a, e] : [b, a] }
      }
    } else {
      const m = /^[(\[\s]*([-+]?[\d.]+)\s*[,;\s]\s*([-+]?[\d.]+)\s*[)\]\s]*$/.exec(String(r[cols.col] ?? ''))
      if (m) geometry = { type: 'Point', coordinates: [Number(m[2]), Number(m[1])] } // "lat, lon" as most spreadsheets and map apps write it
    }
    if (!geometry) { skipped++; continue }
    const props = {}
    for (const [h, i] of keep) { const v = r[i]; if (v !== undefined && v !== null && v !== '') props[h] = typeof v === 'string' ? looseNum(v) : v; else props[h] = null }
    features.push({ type: 'Feature', properties: props, geometry })
  }
  if (!features.length) throw new Error('No row has valid coordinates. Check the latitude and longitude columns.')
  const notes = []
  if (skipped) notes.push(`${skipped} row(s) without valid coordinates were skipped.`)
  if (cols.kind === 'combined') notes.push('A single column with two numbers was read as "latitude, longitude".')
  const name = (i) => (i >= 0 && i !== undefined ? header[i] : null)
  return { features, notes, skipped, used: cols.kind === 'wkt' ? { wkt: name(cols.col) } : cols.kind === 'pair' ? { lat: name(cols.lat), lon: name(cols.lon), ele: name(cols.ele) } : { combined: name(cols.col) }, xy: !!cols.xy, srid }
}

/** Array of objects -> rows with a header row. */
export function recordsToRows(records) {
  const keys = []
  const seen = new Set()
  for (const r of records.slice(0, 5000)) for (const k of Object.keys(r || {})) if (!seen.has(k)) { seen.add(k); keys.push(k) }
  return [keys, ...records.map((r) => keys.map((k) => { const v = r?.[k]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v }))]
}

// ---------- features -> rows ----------
const CP_COLUMNS = { times: 'time', heartRates: 'hr', cadences: 'cadence', temperatures: 'temp', distances: 'distance_m', speeds: 'speed_ms', powers: 'power', waterTemperatures: 'water_temp' }

/**
 * Build a flat table. opts: { lines: 'wkt' | 'points', geographic: true (lat/lon names) or false (x/y names) }.
 * Points become lat/lon columns, everything else a WKT column; with lines: 'points' every vertex of a line is its own row.
 * Returns { header, rows, notes }.
 */
export function featuresToRows(features, opts = {}) {
  const allAttr = columnsOf(features)
  const geographic = opts.geographic !== false
  const asPoints = opts.lines === 'points'
  const latName = geographic ? 'lat' : 'y', lonName = geographic ? 'lon' : 'x'
  let anyZ = false, anyWkt = false, anyPoint = false
  const cpKeys = new Set()
  for (const f of features) {
    const g = f.geometry
    if (!g) continue
    eachCoord(g, (c) => { if (isNum(c[2])) anyZ = true })
    for (const sg of flatGeoms(g)) { if (sg.type === 'Point') anyPoint = true }
    if (asPoints) for (const k of Object.keys(f.properties?.coordinateProperties || {})) if (CP_COLUMNS[k]) cpKeys.add(k)
  }
  const cpCols = [...cpKeys]
  // a "time" attribute (GPX waypoints) shares its column with the per-vertex times
  const attr = cpCols.includes('times') ? allAttr.filter((a) => a !== 'time') : allAttr
  const clash = attr.some((a) => [latName, lonName, 'ele', 'wkt'].includes(a))
  const nm = (s) => (clash ? `geom_${s}` : s)
  const rows = []
  const push = (f, geomPart, extra) => {
    const p = f.properties || {}
    const base = attr.map((a) => cell(p[a]))
    rows.push({ base, ...geomPart, extra, props: p })
  }
  for (const f of features) {
    const g = f.geometry
    if (!g) { push(f, {}, []); continue }
    if (g.type === 'Point') { push(f, { c: g.coordinates }, []); continue }
    if (g.type === 'GeometryCollection') { anyWkt = true; push(f, { wkt: toWkt(g) }, []); continue }
    if (g.type === 'MultiPoint') { for (const c of g.coordinates) push(f, { c }, []); continue }
    if (asPoints && (g.type === 'LineString' || g.type === 'MultiLineString')) {
      const cp = f.properties?.coordinateProperties || {}
      const segs = g.type === 'LineString' ? [g.coordinates] : g.coordinates
      segs.forEach((seg, si) => seg.forEach((c, i) => {
        const extra = cpCols.map((k) => { const arr = g.type === 'LineString' ? cp[k] : cp[k]?.[si]; return arr?.[i] ?? null })
        push(f, { c, seq: i + 1, seg: si + 1 }, extra)
      }))
      continue
    }
    anyWkt = true
    push(f, { wkt: toWkt(g) }, [])
  }
  const hasSeq = asPoints && rows.some((r) => r.seq)
  const header = [
    ...(anyPoint || asPoints || rows.some((r) => r.c) ? [nm(latName), nm(lonName)] : []),
    ...(anyZ ? [nm('ele')] : []),
    ...attr,
    ...(hasSeq ? ['seq', ...(features.some((f) => f.geometry?.type === 'MultiLineString') ? ['segment'] : [])] : []),
    ...cpCols.map((k) => CP_COLUMNS[k]),
    ...(anyWkt ? [nm('wkt')] : []),
  ]
  const segCol = hasSeq && features.some((f) => f.geometry?.type === 'MultiLineString')
  const hasLatLon = header.includes(nm(latName))
  const out = rows.map((r) => {
    const row = []
    if (hasLatLon) row.push(r.c ? r.c[1] : null, r.c ? r.c[0] : null)
    if (anyZ) row.push(r.c && isNum(r.c[2]) ? r.c[2] : null)
    row.push(...r.base)
    if (hasSeq) { row.push(r.seq ?? null); if (segCol) row.push(r.seg ?? null) }
    if (cpCols.length) row.push(...cpCols.map((k, i) => (r.extra.length ? r.extra[i] : k === 'times' ? cell(r.props.time) : null)))
    if (anyWkt) row.push(r.wkt ?? null)
    return row
  })
  return { header, rows: out, notes: [] }
}

const needsQuote = (s, d) => s.includes(d) || s.includes('"') || s.includes('\n') || s.includes('\r') || /^\s|\s$/.test(s)
export function toCsv(header, rows, { delimiter = ',', bom = true } = {}) {
  const fmt = (v) => { if (v === null || v === undefined) return ''; const s = typeof v === 'number' ? String(v) : String(v); return needsQuote(s, delimiter) ? `"${s.replace(/"/g, '""')}"` : s }
  return (bom ? '\uFEFF' : '') + [header, ...rows].map((r) => r.map(fmt).join(delimiter)).join('\r\n') + '\r\n'
}

/** Rows as plain JSON records: [{col: value}]. */
export function toRecords(header, rows) {
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? null])))
}
