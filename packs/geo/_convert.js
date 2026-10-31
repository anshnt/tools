// Routes this pack can convert, for the universal File Converter hub. Extensions are lowercase, without the dot.
// Everything runs on the visitor's device. The engine (_geo.js) is loaded on first use, never at import time.
const GEO_OUT = ['geojson', 'kml', 'kmz', 'gpx', 'shp', 'topojson', 'wkt']
const ALL_OUT = [...GEO_OUT, 'csv', 'xlsx', 'json']

const OPTIONS = [
  { key: 'outCrs', label: 'Output coordinate system (EPSG code, UTM zone or proj4)', type: 'text', default: 'EPSG:4326' },
  { key: 'inCrs', label: 'Input coordinate system, if the file does not say', type: 'text', default: '' },
  { key: 'tolerance', label: 'Simplify lines and shapes (metres, 0 = off)', type: 'number', min: 0, default: 0 },
  { key: 'csvLines', label: 'Lines in CSV, XLSX and JSON', type: 'select', choices: [['wkt', 'As WKT'], ['points', 'One row per track point']], default: 'wkt' },
]

async function run(file, to, opts, ctx) {
  const { convertGeo } = await import('./_geo.js')
  const o = { ...opts, tolerance: Number(opts?.tolerance) || 0, name: file.name.replace(/\.[^.]+$/, '') }
  const r = await convertGeo([file], to, o, { signal: ctx?.signal, onProgress: ctx?.onProgress })
  return r.files.length === 1 ? r.files[0] : r.files
}

export const CONVERTERS = [
  { from: ['shp', 'geojson', 'topojson', 'kml', 'kmz', 'gpx', 'gml', 'fit', 'wkt', 'wkb'], to: ALL_OUT, group: 'Maps and GPS', options: OPTIONS, run },
  { from: ['zip'], to: ALL_OUT, group: 'Maps and GPS (zipped shapefile)', options: OPTIONS, run },
  { from: ['csv', 'tsv', 'xlsx', 'xls', 'ods'], to: GEO_OUT, group: 'Maps and GPS (tables with coordinates)', options: OPTIONS, run },
  { from: ['json'], to: GEO_OUT, group: 'Maps and GPS', options: OPTIONS, run },
]

export const SNIFF = [
  { ext: 'fit', test: (b) => b.length > 12 && b[8] === 0x2e && b[9] === 0x46 && b[10] === 0x49 && b[11] === 0x54 },
  { ext: 'shp', test: (b) => b.length > 100 && b[0] === 0 && b[1] === 0 && b[2] === 0x27 && b[3] === 0x0a },
]
