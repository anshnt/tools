// The geospatial engine: read any supported file into GeoJSON-style features (always WGS 84 lon/lat), apply simple operations,
// and write them back out as GeoJSON, KML, KMZ, GPX, Shapefile, CSV, XLSX, JSON, TopoJSON or WKT. DOM-free and local only.
import { jszip, xlsx } from '../../lib/libs.js'
import { baseName, ext as extOf, safeName } from '../../lib/files.js'
import { findCrs, reprojectFeatures, looksProjected, crsToWkt, checkCrs } from './_proj.js'
import { readShp, readDbf, writeShp, writeDbf, shpClass } from './_shp.js'
import { guessLegacyEncoding } from './_enc.js'
import { readKml, writeKml } from './_kml.js'
import { readGpx, writeGpx } from './_gpx.js'
import { readGml } from './_gml.js'
import { isFit, readFit } from './_fit.js'
import { parseWkt, parseWkb, hexToBytes, toWkt, looksLikeWkt, looksLikeHexWkb } from './_wkt.js'
import { isTopology, readTopo, writeTopo } from './_topo.js'
import { parseCsv, rowsToFeatures, recordsToRows, featuresToRows, toCsv, toRecords } from './_table.js'
import { applyOps } from './_ops.js'
import { mapCoords, bboxOf, typeCounts, columnsOf, flatGeoms, throwIfAborted, tick } from './_util.js'

export const READ_EXTS = ['shp', 'zip', 'geojson', 'json', 'topojson', 'kml', 'kmz', 'gpx', 'gml', 'xml', 'fit', 'csv', 'tsv', 'txt', 'xlsx', 'xls', 'ods', 'wkt', 'wkb', 'prj', 'dbf', 'shx', 'cpg']
export const WRITE_FORMATS = [
  ['geojson', 'GeoJSON', 'application/geo+json'], ['kml', 'KML', 'application/vnd.google-earth.kml+xml'], ['kmz', 'KMZ', 'application/vnd.google-earth.kmz'],
  ['gpx', 'GPX', 'application/gpx+xml'], ['shp', 'Shapefile (ZIP)', 'application/zip'], ['csv', 'CSV', 'text/csv'],
  ['xlsx', 'Excel (XLSX)', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], ['json', 'JSON records', 'application/json'],
  ['topojson', 'TopoJSON', 'application/json'], ['wkt', 'WKT (one per line)', 'text/plain'],
]
const MIME = Object.fromEntries(WRITE_FORMATS.map(([k, , m]) => [k, m]))

const err = (msg, code) => Object.assign(new Error(msg), code ? { code } : {})
const mkFile = (data, name, type) => new File([data], name, { type })

// ---------------- reading ----------------
/** A readable thing: a File, or an entry of a ZIP. */
const vfile = (name, getBytes) => ({ name, base: baseName(name.split('/').pop()), ext: extOf(name), dir: name.includes('/') ? name.slice(0, name.lastIndexOf('/') + 1) : '', bytes: getBytes, text: async () => new TextDecoder('utf-8').decode(await getBytes()) })
const fromFile = (f) => vfile(f.name, async () => new Uint8Array(await f.arrayBuffer()))

async function expandZip(vf) {
  const JSZip = await jszip()
  let z
  try { z = await JSZip.loadAsync(await vf.bytes()) } catch { throw err('This ZIP file could not be opened. It may be damaged or password-protected.') }
  const out = []
  z.forEach((path, e) => {
    if (e.dir || /(^|\/)(__MACOSX|\.[^/]*$)/.test(path) || /\/\.[^/]*$/.test(path)) return
    out.push(vfile(path, async () => e.async('uint8array')))
  })
  return out
}

const SHP_SIDE = new Set(['shp', 'shx', 'dbf', 'prj', 'cpg', 'qix', 'sbn', 'sbx', 'atx', 'fbn', 'fbx', 'ain', 'aih', 'ixs', 'mxs', 'xml', 'qpj', 'qmd'])

/** Sniff the kind of a file whose extension is missing or unhelpful. */
function sniff(head) {
  if (head[0] === 0x50 && head[1] === 0x4b) return 'zip'
  if (isFit(head)) return 'fit'
  if (head[0] === 0 && head[1] === 0 && head[2] === 0x27 && head[3] === 0x0a) return 'shp'
  const t = new TextDecoder().decode(head.subarray(0, 600)).replace(/^\uFEFF/, '').trimStart()
  if (t.startsWith('{') || t.startsWith('[')) return 'json'
  if (t.startsWith('<')) return 'xml'
  if (looksLikeWkt(t)) return 'wkt'
  return 'text'
}

function kindOf(vf, head) {
  switch (vf.ext) {
    case 'shp': return 'shp'
    case 'zip': case 'kmz': return 'zip'
    case 'geojson': case 'json': case 'topojson': return 'json'
    case 'kml': return 'kml'
    case 'gpx': return 'gpx'
    case 'gml': return 'gml'
    case 'xml': return 'xml'
    case 'fit': return 'fit'
    case 'csv': case 'tsv': case 'tab': return 'text'
    case 'txt': return sniff(head)
    case 'xlsx': case 'xls': case 'ods': return 'sheet'
    case 'wkt': return 'wkt'
    case 'wkb': return 'wkb'
    default: return SHP_SIDE.has(vf.ext) ? 'side' : sniff(head)
  }
}

const typedGeom = (g) => g && g.type && (g.coordinates !== undefined || g.geometries !== undefined)
function geojsonFeatures(o) {
  const feats = []
  const add = (x) => {
    if (!x) return
    if (x.type === 'FeatureCollection') (x.features || []).forEach(add)
    else if (x.type === 'Feature') feats.push({ type: 'Feature', ...(x.id !== undefined ? { id: x.id } : {}), properties: x.properties && typeof x.properties === 'object' ? x.properties : {}, geometry: typedGeom(x.geometry) ? x.geometry : null })
    else if (typedGeom(x)) feats.push({ type: 'Feature', properties: {}, geometry: x })
  }
  add(o)
  return feats
}

async function readSheet(bytes, opts) {
  const X = await xlsx()
  let wb
  try { wb = X.read(bytes, { type: 'array', cellDates: true }) } catch { throw err('This spreadsheet could not be opened.') }
  let lastErr
  for (const name of wb.SheetNames) {
    const aoa = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false })
    if (aoa.length < 2) continue
    const rows = aoa.map((r) => r.map((v) => (v instanceof Date ? v.toISOString().replace('.000Z', 'Z') : v)))
    try { const r = rowsToFeatures(rows, opts); if (wb.SheetNames.length > 1) r.notes.push(`Read the sheet "${name}".`); return r } catch (e) { lastErr = e }
  }
  throw lastErr || err('The spreadsheet has no rows.')
}

function textLines(text) { return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) }

/** Read one source into { features, crs (a findCrs result or null), fixed (always WGS 84), notes, format }. */
async function readOne(vf, kind, ctx) {
  const { opts, siblings } = ctx
  const notes = []
  switch (kind) {
    case 'shp': {
      const group = siblings
      const shpBytes = await vf.bytes()
      const r = await readShp(shpBytes, { signal: ctx.signal })
      notes.push(...r.notes)
      const dbfVf = group.get('dbf'), prjVf = group.get('prj'), cpgVf = group.get('cpg')
      let rows = null, enc
      if (dbfVf) {
        const d = readDbf(await dbfVf.bytes(), { encoding: opts.encoding, cpg: cpgVf ? await cpgVf.text() : '' })
        rows = d.rows; enc = d.encoding
        if (rows.length !== r.geoms.length) notes.push(`The .dbf has ${rows.length} rows but the .shp has ${r.geoms.length} shapes; extra items were ignored.`)
        notes.push(`Attribute text read as ${{ 'euc-kr': 'Korean (CP949)', 'utf-8': 'UTF-8', 'windows-1252': 'Windows-1252', gbk: 'Chinese (GBK)', big5: 'Chinese (Big5)', shift_jis: 'Japanese (Shift-JIS)' }[enc] || enc}.`)
      } else notes.push('No .dbf file was found next to the .shp, so there are no attributes.')
      const features = []
      r.geoms.forEach((g, i) => {
        if (rows && rows[i] === null) return // deleted record
        if (rows && i >= rows.length) return
        features.push({ type: 'Feature', properties: rows ? rows[i] : {}, geometry: g })
      })
      let crs = null
      if (prjVf) { try { crs = findCrs(await prjVf.text()) } catch (e) { notes.push(`The .prj could not be read (${e.message}), so WGS 84 was assumed.`) } } else notes.push('No .prj file was found, so the coordinates are assumed to be WGS 84 unless you set the input CRS.')
      if (crs?.notes) notes.push(...crs.notes)
      return { features, crs, notes, format: `Shapefile (${r.typeName})` }
    }
    case 'json': {
      let o
      try { o = JSON.parse(await vf.text()) } catch { throw err('This file is not valid JSON.') }
      if (isTopology(o)) { const r = readTopo(o); return { features: r.features, crs: null, notes, format: 'TopoJSON' } }
      if (Array.isArray(o) && o.length && o.every((x) => x && typeof x === 'object' && !x.type)) {
        const r = rowsToFeatures(recordsToRows(o), opts)
        return { features: r.features, crs: null, notes: r.notes, format: 'JSON records' }
      }
      const features = geojsonFeatures(o)
      if (!features.length) throw err('No GeoJSON features were found in this file.')
      let crs = null
      const name = o?.crs?.properties?.name || (o?.crs?.properties?.code ? `EPSG:${o.crs.properties.code}` : '')
      if (name) { try { crs = findCrs(name) } catch (e) { notes.push(`The file names a coordinate system that is not built in (${name}).`) } }
      return { features, crs, notes, format: 'GeoJSON' }
    }
    case 'kml': { const r = readKml(await vf.text()); return { features: r.features, fixed: true, notes: r.notes, format: 'KML', name: r.name } }
    case 'gpx': { const r = readGpx(await vf.text()); return { features: r.features, fixed: true, notes: r.notes, format: 'GPX', name: r.name } }
    case 'gml': case 'xml': {
      const text = await vf.text()
      const root = /<\s*([A-Za-z0-9_]+:)?(kml|gpx)\b/i.exec(text.slice(0, 2000))
      if (root) { const k = root[2].toLowerCase(); const r = k === 'kml' ? readKml(text) : readGpx(text); return { features: r.features, fixed: true, notes: r.notes, format: k.toUpperCase() } }
      const r = readGml(text)
      let crs = null
      if (r.srs) { try { crs = findCrs(r.srs) } catch { notes.push(`The GML names a coordinate system that is not built in (${r.srs}).`) } }
      let features = r.features
      if (r.swap) features = features.map((f) => ({ ...f, geometry: f.geometry && mapCoords(f.geometry, (c) => [c[1], c[0], ...c.slice(2)]) }))
      return { features, crs, notes, format: 'GML' }
    }
    case 'fit': { const r = readFit(await vf.bytes()); return { features: r.features, fixed: true, notes: r.notes, format: 'FIT' } }
    case 'sheet': { const r = await readSheet(await vf.bytes(), opts); return { features: r.features, crs: null, notes: r.notes, format: 'Spreadsheet', xy: r.xy } }
    case 'wkt': case 'wkb': case 'text': {
      let bytes = await vf.bytes()
      let text = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '')
      let lines = textLines(text)
      if (kind === 'wkb' && !looksLikeHexWkb(lines[0] || '')) {
        const g = parseWkb(bytes)
        return { features: [{ type: 'Feature', properties: {}, geometry: g.geometry }], crs: g.srid ? tryCrs(`EPSG:${g.srid}`) : null, notes, format: 'WKB' }
      }
      const wktLike = lines.length && lines.every((l) => looksLikeWkt(l) || looksLikeHexWkb(l))
      if (kind === 'wkt' || kind === 'wkb' || wktLike) {
        const features = []
        let srid, bad = 0
        for (const l of lines) {
          try {
            const g = looksLikeHexWkb(l) ? parseWkb(hexToBytes(l)) : parseWkt(l)
            srid ??= g.srid
            features.push({ type: 'Feature', properties: {}, geometry: g.geometry })
          } catch { bad++ }
        }
        if (!features.length) throw err('No valid WKT geometries were found in this file.')
        if (bad) notes.push(`${bad} line(s) were not valid WKT and were skipped.`)
        return { features, crs: srid && srid !== 4326 ? tryCrs(`EPSG:${srid}`) : null, notes, format: kind === 'wkb' ? 'WKB' : 'WKT' }
      }
      let delimiter = opts.delimiter
      if (vf.ext === 'tsv') delimiter ||= '\t'
      // legacy Korean spreadsheets are often saved as CP949
      if (opts.encoding && opts.encoding !== 'auto') text = new TextDecoder(opts.encoding).decode(bytes).replace(/^\uFEFF/, '')
      else { try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '') } catch { const lbl = guessLegacyEncoding(bytes); text = new TextDecoder(lbl).decode(bytes); notes.push(`The text is not UTF-8, so it was read as ${lbl === 'euc-kr' ? 'Korean (CP949)' : 'Windows-1252'}. Choose another text encoding if letters look wrong.`) } }
      const r = rowsToFeatures(parseCsv(text, delimiter), opts)
      return { features: r.features, crs: null, notes: [...notes, ...r.notes], format: vf.ext === 'tsv' ? 'TSV' : 'CSV', xy: r.xy }
    }
    default: throw err('This file type is not supported.')
  }
}
const tryCrs = (s) => { try { return findCrs(s) } catch { return null } }

/**
 * Read files (loose shapefile parts, ZIPs, single files) into one list of features in WGS 84.
 * opts: { inCrs, encoding, delimiter, latCol, lonCol, wktCol, eleCol }.
 * Returns { features, notes, sources: [{ name, format, count, crs }] }.
 */
export async function readGeo(files, opts = {}, { signal, onProgress } = {}) {
  const list = [...files]
  if (!list.length) throw err('Choose a file first.')
  // 1. open ZIPs
  let vfiles = []
  for (const f of list) {
    const v = fromFile(f)
    const head = (await f.slice(0, 600).arrayBuffer().then((b) => new Uint8Array(b)))
    const k = kindOf(v, head)
    if (k === 'zip') {
      const inner = await expandZip(v)
      if (!inner.length) throw err('This ZIP file is empty.')
      vfiles.push(...inner.map((x) => Object.assign(x, { zipName: baseName(f.name) })))
    } else vfiles.push(Object.assign(v, { head }))
  }
  // 2. group shapefile parts and decide what to read
  const groups = new Map()
  const units = []
  const prjOnly = vfiles.find((v) => v.ext === 'prj')
  for (const v of vfiles) {
    const key = (v.dir + v.base).toLowerCase()
    if (!groups.has(key)) groups.set(key, new Map())
    if (SHP_SIDE.has(v.ext) && v.ext !== 'xml') groups.get(key).set(v.ext, v)
  }
  for (const v of vfiles) {
    const head = v.head || (await v.bytes()).subarray(0, 600)
    const kind = kindOf(v, head)
    if (kind === 'side' || kind === 'zip') continue
    if (v.ext === 'xml' && /\.shp\.xml$/i.test(v.name)) continue
    units.push({ v, kind })
  }
  if (!units.length) {
    const dbfs = vfiles.filter((v) => v.ext === 'dbf')
    if (dbfs.length) throw err('Only a .dbf attribute file was found. A shapefile needs its .shp file too (drop the .shp, .shx, .dbf and .prj files together, or a ZIP of them).')
    throw err('No geospatial files were recognized. Supported: Shapefile, GeoJSON, TopoJSON, KML, KMZ, GPX, GML, FIT, CSV, XLSX, WKT.')
  }
  // 3. read each unit
  const all = []
  const notes = []
  const sources = []
  const explicit = opts.inCrs && String(opts.inCrs).trim() ? findCrs(opts.inCrs) : null
  if (explicit) await checkCrs(explicit)
  let n = 0
  for (const { v, kind } of units) {
    throwIfAborted(signal)
    const siblings = groups.get((v.dir + v.base).toLowerCase()) || new Map()
    let r
    try { r = await readOne(v, kind, { opts, signal, siblings }) } catch (e) { if (units.length === 1) throw e; notes.push(`${v.name}: ${e.message}`); continue }
    let crs = r.fixed ? findCrs('EPSG:4326') : explicit || r.crs
    if (!crs && prjOnly && !r.fixed) { try { crs = findCrs(await prjOnly.text()) } catch { /* ignore */ } }
    let features = r.features
    if (!crs) {
      if (looksProjected(features)) throw err(`${v.name}: the coordinates look projected (not longitude/latitude). Set the input coordinate system (for example EPSG:32652 or EPSG:5179), or add the .prj file.`)
      crs = findCrs('EPSG:4326')
    }
    if (!crs.wgs84) {
      const rr = await reprojectFeatures(features, crs, findCrs('EPSG:4326'), { onTick: tick })
      features = rr.features
      if (rr.lost) r.notes.push(`${rr.lost} feature(s) had coordinates outside the area of ${crs.name} and were left without geometry.`)
      if (looksProjected(features)) throw err(`${v.name}: after converting from ${crs.name} the coordinates are not valid longitude/latitude. The input coordinate system is probably wrong.`)
    }
    for (const f of features) f.geometry = f.geometry || null
    const layer = units.length > 1 ? (units.filter((u) => u.v.base === v.base).length > 1 ? `${v.zipName ? v.zipName + '/' : ''}${v.dir}${v.base}` : v.base) : null
    if (layer) features = features.map((f) => ({ ...f, properties: { ...f.properties, layer } }))
    for (const f of features) all.push(f)
    sources.push({ name: v.name, format: r.format, count: features.length, crs: crs.wgs84 ? 'WGS 84' : `${crs.name}${crs.id ? ` (${crs.id})` : ''}`, crsFromFile: !explicit && !!r.crs, wasProjected: !crs.wgs84 })
    notes.push(...r.notes.map((x) => (units.length > 1 ? `${v.name}: ${x}` : x)))
    onProgress?.(++n / units.length)
    await tick()
  }
  if (!all.length && !sources.length) throw err('Nothing could be read from these files.')
  return { features: all, notes, sources, name: baseName(list[0].name) }
}

// ---------------- writing ----------------
const roundN = (v, d) => { const k = 10 ** d; return Math.round(v * k) / k }
function roundFeatures(features, digits) {
  return features.map((f) => (f.geometry ? { ...f, geometry: mapCoords(f.geometry, (c) => c.map((x, i) => (i < 2 ? roundN(x, digits) : roundN(x, 3)))) } : f))
}

const OUT_ALWAYS_WGS84 = new Set(['kml', 'kmz', 'gpx', 'topojson'])

/** Resolve the output CRS for a feature list (handles 'utm'). */
export function outputCrs(features, spec) {
  const s = (spec || 'EPSG:4326').trim()
  const b = bboxOf(features)
  return findCrs(s, { center: b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : [0, 0] })
}

/**
 * Write features (WGS 84) to a format. opts: { outCrs, outEncoding (shp), delimiter, bom, csvLines, tracks (kml), nameField, pretty, quantization, name }.
 * Returns { files: File[], notes }.
 */
export async function writeGeo(features, to, opts = {}, { name = 'geodata', signal, onProgress } = {}) {
  to = to.toLowerCase()
  if (!MIME[to]) throw err(`Cannot write ${to.toUpperCase()}.`)
  const notes = []
  let crs = outputCrs(features, opts.outCrs)
  if (!crs.wgs84 && OUT_ALWAYS_WGS84.has(to)) { notes.push(`${to.toUpperCase()} always uses WGS 84, so the output coordinate system was set to WGS 84.`); crs = findCrs('EPSG:4326') }
  let feats = features
  if (!crs.wgs84) {
    await checkCrs(crs)
    const r = await reprojectFeatures(features, findCrs('EPSG:4326'), crs, { onTick: tick })
    feats = r.features
    if (r.lost) notes.push(`${r.lost} feature(s) could not be converted to ${crs.name} and were left without geometry.`)
  }
  throwIfAborted(signal)
  const geographic = crs.wgs84 || /\+proj=longlat/.test(crs.def)
  const rounded = to === 'shp' ? feats : roundFeatures(feats, geographic ? 9 : 4)
  const base = safeName(baseName(name)) || 'geodata'
  const out = []
  const type = MIME[to]
  switch (to) {
    case 'geojson': {
      const fc = { type: 'FeatureCollection', ...(crs.wgs84 ? {} : { crs: { type: 'name', properties: { name: crs.id ? `urn:ogc:def:crs:EPSG::${crs.code}` : crs.name } } }), features: rounded }
      out.push(mkFile(JSON.stringify(fc, null, opts.pretty === false || rounded.length > 20000 ? 0 : 2), `${base}.geojson`, type))
      break
    }
    case 'topojson': out.push(mkFile(JSON.stringify(writeTopo(rounded, { name: base, quantization: opts.quantization })), `${base}.topojson`, type)); break
    case 'kml': out.push(mkFile(writeKml(rounded, { name: base, nameField: opts.nameField, tracks: opts.tracks }), `${base}.kml`, type)); break
    case 'kmz': {
      const JSZip = await jszip()
      const z = new JSZip()
      z.file('doc.kml', writeKml(rounded, { name: base, nameField: opts.nameField, tracks: opts.tracks }))
      out.push(mkFile(await z.generateAsync({ type: 'blob', compression: 'DEFLATE' }), `${base}.kmz`, type))
      break
    }
    case 'gpx': { const g = writeGpx(rounded, { name: base }); notes.push(...g.notes); out.push(mkFile(g.text, `${base}.gpx`, type)); break }
    case 'wkt': out.push(mkFile(rounded.filter((f) => f.geometry).map((f) => toWkt(f.geometry)).join('\n') + '\n', `${base}.wkt`, type)); break
    case 'csv': case 'json': case 'xlsx': {
      const t = featuresToRows(rounded, { lines: opts.csvLines, geographic })
      if (to === 'csv') out.push(mkFile(toCsv(t.header, t.rows, { delimiter: opts.delimiter || ',', bom: opts.bom !== false }), `${base}.csv`, type))
      else if (to === 'json') out.push(mkFile(JSON.stringify(toRecords(t.header, t.rows), null, 2), `${base}.json`, type))
      else {
        const X = await xlsx()
        let cut = 0
        const rows = t.rows.map((r) => r.map((v) => { if (typeof v === 'string' && v.length > 32767) { cut++; return null } return v }))
        if (cut) notes.push(`${cut} cell(s) were longer than the 32,767 characters a spreadsheet cell can hold and were left empty. Use CSV or GeoJSON for those.`)
        const ws = X.utils.aoa_to_sheet([t.header, ...rows])
        const wb = X.utils.book_new()
        X.utils.book_append_sheet(wb, ws, 'features')
        out.push(mkFile(X.write(wb, { bookType: 'xlsx', type: 'array' }), `${base}.xlsx`, type))
      }
      break
    }
    case 'shp': out.push(await writeShapefileZip(feats, crs, base, opts, notes)); break
  }
  onProgress?.(1)
  return { files: out, notes, crs }
}

const CLASS_LABEL = { point: 'points', multipoint: 'multipoints', line: 'lines', polygon: 'polygons' }
async function writeShapefileZip(features, crs, base, opts, notes) {
  const buckets = { point: [], multipoint: [], line: [], polygon: [] }
  let noGeom = 0, split = 0
  for (const f of features) {
    if (!f.geometry) { noGeom++; continue }
    const parts = flatGeoms(f.geometry)
    if (f.geometry.type === 'GeometryCollection') split++
    for (const g of parts) { const c = shpClass(g); if (c) buckets[c].push({ g, props: f.properties || {} }) }
  }
  if (noGeom) notes.push(`${noGeom} feature(s) without geometry were left out (a shapefile needs a shape for each row).`)
  if (split) notes.push(`${split} geometry collection(s) were split into separate shapes, repeating the attributes.`)
  const used = Object.entries(buckets).filter(([, v]) => v.length)
  if (!used.length) throw err('There are no geometries to write to a shapefile.')
  if (used.length > 1) notes.push(`A shapefile holds one kind of shape, so the result has ${used.length} sets of files: ${used.map(([k]) => CLASS_LABEL[k]).join(', ')}.`)
  const prj = crsToWkt(crs)
  if (crs.notes?.length) notes.push(...crs.notes)
  const JSZip = await jszip()
  const z = new JSZip()
  const encLabel = opts.outEncoding && opts.outEncoding !== 'auto' ? opts.outEncoding : 'utf-8'
  for (const [cls, items] of used) {
    const nm = used.length > 1 ? `${base}_${CLASS_LABEL[cls]}` : base
    const { shp, shx } = writeShp(items.map((i) => i.g), cls)
    const cols = columnsOf(items.map((i) => ({ properties: i.props })))
    const d = writeDbf(items.map((i) => i.props), cols, encLabel)
    notes.push(...d.notes)
    z.file(`${nm}.shp`, shp); z.file(`${nm}.shx`, shx); z.file(`${nm}.dbf`, d.bytes); z.file(`${nm}.cpg`, d.cpg)
    if (prj) z.file(`${nm}.prj`, prj)
    if (cols.length && d.names.some((n, i) => n !== cols[i])) notes.push('Some column names were shortened to fit the 10-byte limit of .dbf files.')
  }
  return mkFile(await z.generateAsync({ type: 'blob', compression: 'DEFLATE' }), `${base}-shapefile.zip`, 'application/zip')
}

// ---------------- the whole pipeline ----------------
/** Short description of a feature list for the UI. */
export function summarize(features) {
  return { count: features.length, types: typeCounts(features), bbox: bboxOf(features), columns: columnsOf(features) }
}

/**
 * Read, apply the operations, write. Returns { files, notes, summary, sources }.
 * `files` is a File[] (or File[] of FileLike); `to` an extension from WRITE_FORMATS.
 */
export async function convertGeo(files, to, opts = {}, ctx = {}) {
  const read = await readGeo(files, opts, ctx)
  const ops = applyOps(read.features, opts)
  if (!ops.features.length) throw err('No features are left after filtering.')
  const w = await writeGeo(ops.features, to, opts, { ...ctx, name: opts.name || read.name })
  return { files: w.files, notes: [...read.notes, ...ops.notes, ...w.notes], summary: summarize(ops.features), sources: read.sources }
}

