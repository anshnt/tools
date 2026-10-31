// Map and GPS file converter. One module serves the all-in-one converter and the focused entries (KML to GeoJSON, GPX to KML ...)
// through params.from / params.to. Reads Shapefile, GeoJSON, TopoJSON, KML, KMZ, GPX, GML, FIT, CSV, XLSX and WKT; writes GeoJSON,
// KML, KMZ, GPX, Shapefile, CSV, XLSX, JSON, TopoJSON and WKT. Everything runs on this device.
import {
  h, clear, dropzone, fileList, button, busy, field, input, select, number, toggle, panel, alert, progress, download, formatBytes, debounce, errorMessage, isAbort, icon,
} from '../../lib/ui.js'
import { readGeo, writeGeo, summarize, WRITE_FORMATS } from './_geo.js'
import { applyOps, FILTER_OPS } from './_ops.js'
import { COMMON_CRS } from './_proj.js'
import { ENCODINGS } from './_enc.js'
import { createMap } from './_map.js'
import { geoCss, geoTable, summaryTiles } from './_ui.js'
import { columnsOf } from './_util.js'

const LABEL = Object.fromEntries([...WRITE_FORMATS.map(([k, l]) => [k, l]), ['shp', 'Shapefile'], ['fit', 'Garmin FIT'], ['gml', 'GML'], ['csv', 'CSV'], ['wkb', 'WKB']])
const ACCEPT = {
  shp: '.zip,.shp,.shx,.dbf,.prj,.cpg',
  geojson: '.geojson,.json,.topojson', topojson: '.topojson,.json,.geojson', kml: '.kml,.kmz', kmz: '.kmz,.kml', gpx: '.gpx', fit: '.fit', gml: '.gml,.xml', wkt: '.wkt,.txt',
  csv: '.csv,.tsv,.txt,.xlsx,.xls,.ods',
}
const ALL_ACCEPT = '.zip,.shp,.shx,.dbf,.prj,.cpg,.geojson,.json,.topojson,.kml,.kmz,.gpx,.gml,.xml,.fit,.csv,.tsv,.txt,.xlsx,.xls,.ods,.wkt,.wkb'
const BLURB = {
  geojson: 'Plain GeoJSON, readable by every web map and GIS tool.',
  kml: 'KML for Google Earth and Google My Maps. Track times are kept as gx:Track.',
  kmz: 'KMZ, a zipped KML for Google Earth.',
  gpx: 'GPX for GPS devices and apps. Points become waypoints, lines become tracks.',
  shp: 'A ZIP with .shp, .shx, .dbf, .prj and .cpg, one set per kind of shape.',
  csv: 'Points as lat and lon columns, other shapes as WKT. Choose one row per track point for GPS tracks.',
  xlsx: 'An Excel sheet with lat and lon columns, and WKT for other shapes.',
  json: 'Plain JSON records with lat and lon, easy to use in code.',
  topojson: 'TopoJSON, a compact format for web maps.',
  wkt: 'Well-known text, one geometry per line.',
}

export function mount(root, { params, signal }) {
  geoCss()
  const fixedTo = params?.to
  const fromKey = params?.from
  const o = {
    to: fixedTo || 'geojson', outPick: 'EPSG:4326', outCustom: '', inCrs: '', encoding: 'auto', outEncoding: 'utf-8', tolerance: 0, fcol: '', fop: 'eq', fval: '',
    keep: null, delimiter: ',', lines: !!params?.lines, bom: true, tracks: true, nameField: '', latCol: '', lonCol: '', wktCol: '',
  }
  let files = []
  let read = null, ops = [], readId = 0, ctl = null
  const state = { selected: -1 }

  // ----- input
  const zone = dropzone({
    multiple: true, accept: ACCEPT[fromKey] || ALL_ACCEPT, icon: 'map',
    label: fromKey ? `Drop ${LABEL[fromKey] || fromKey.toUpperCase()} files here or click to choose` : 'Drop map or GPS files here, or click to choose',
    hint: fromKey === 'shp' || !fromKey ? 'Shapefile: a ZIP, or the .shp, .shx, .dbf and .prj files together. Nothing leaves your device.' : 'Nothing leaves your device.',
    onFiles: (fs) => { const names = new Set(files.map((f) => f.name + f.size)); files = [...files, ...fs.filter((f) => !names.has(f.name + f.size))]; list.set(files); readAll() },
  })
  const list = fileList({ sortable: false, onChange: (fs) => { files = [...fs]; readAll() } })
  list.el.hidden = true
  const prog = progress('Reading')
  const infoEl = h('div', { class: 'stack' })
  const optsEl = h('div', { class: 'stack' })
  const outEl = h('div', { class: 'stack' })

  // ----- the map and table
  const map = createMap({ height: 340, onSelect: (i) => { state.selected = i; tbl.mark(i) } })
  const tbl = geoTable({ onPick: (i) => { map.select(i, { zoom: true }); tbl.mark(i) } })
  const basemap = toggle('Show an OpenStreetMap background (loads map images from tile.openstreetmap.org)', false, (v) => map.setBasemap(v))

  // ----- option controls
  const toSel = select(WRITE_FORMATS.map(([k, l]) => [k, l]), o.to, (v) => { o.to = v; syncFormat() })
  const crsSel = select([...COMMON_CRS, ['custom', 'Other (EPSG code, UTM zone or proj4 string)']], o.outPick, (v) => { o.outPick = v; customCrs.hidden = v !== 'custom'; syncFormat() })
  const customCrs = input({ placeholder: 'EPSG:32652, UTM 52N or +proj=...', 'aria-label': 'Custom output coordinate system', oninput: (e) => { o.outCustom = e.target.value }, hidden: true })
  const inCrs = input({ placeholder: 'Detected from the file', 'aria-label': 'Input coordinate system', oninput: debounce((e) => { o.inCrs = e.target.value.trim(); readAll() }, 500) })
  const encSel = select(ENCODINGS, 'auto', (v) => { o.encoding = v; readAll() })
  const outEnc = select(ENCODINGS.filter(([k]) => k !== 'auto'), 'utf-8', (v) => { o.outEncoding = v })
  const tol = number(0, { min: 0, placeholder: '0', ariaLabel: 'Simplify tolerance in metres', onInput: debounce((v) => { o.tolerance = Number.isFinite(v) ? v : 0; refresh(false) }, 300) })
  const fcol = select([['', 'No filter']], '', (v) => { o.fcol = v; refresh(false) })
  const fop = select(FILTER_OPS, 'eq', (v) => { o.fop = v; refresh(false) })
  const fval = input({ placeholder: 'value', 'aria-label': 'Filter value', oninput: debounce((e) => { o.fval = e.target.value; refresh(false) }, 250) })
  const keepBox = h('div', { class: 'geo-cols' })
  const delim = select([[',', 'Comma'], [';', 'Semicolon'], ['\t', 'Tab']], ',', (v) => { o.delimiter = v })
  const nameSel = select([['', 'Automatic']], '', (v) => { o.nameField = v })
  const lat = input({ placeholder: 'auto (lat, latitude, y)', 'aria-label': 'Latitude column', oninput: debounce((e) => { o.latCol = e.target.value.trim(); readAll() }, 500) })
  const lon = input({ placeholder: 'auto (lon, lng, x)', 'aria-label': 'Longitude column', oninput: debounce((e) => { o.lonCol = e.target.value.trim(); readAll() }, 500) })
  const wktc = input({ placeholder: 'auto (wkt, geometry)', 'aria-label': 'WKT column', oninput: debounce((e) => { o.wktCol = e.target.value.trim(); readAll() }, 500) })

  const gTable = h('div', { class: 'geo-sec' }, h('h3', 'Tables with coordinates (CSV, XLSX)'),
    h('div', { class: 'geo-grid' }, field('Latitude / y column', lat), field('Longitude / x column', lon), field('WKT column', wktc)))
  const gCsv = h('div', { class: 'geo-sec' }, h('h3', 'CSV, XLSX and JSON output'),
    h('div', { class: 'geo-grid' }, field('Delimiter (CSV)', delim)),
    toggle('Lines as one row per track point (with time, elevation, heart rate)', o.lines, (v) => { o.lines = v }),
    toggle('Add a BOM so Excel shows non-English text correctly (CSV)', true, (v) => { o.bom = v }))
  const gKml = h('div', { class: 'geo-sec' }, h('h3', 'KML and KMZ output'),
    h('div', { class: 'geo-grid' }, field('Placemark name from column', nameSel)),
    toggle('Keep track times as gx:Track', true, (v) => { o.tracks = v }))
  const gShp = h('div', { class: 'geo-sec' }, h('h3', 'Shapefile output'), h('div', { class: 'geo-grid' }, field('Text encoding of the .dbf', outEnc, 'UTF-8 works in QGIS and current ArcGIS. Choose Korean (CP949) for older Korean software.')))

  const readMore = h('details', { class: 'geo-more geo-read', hidden: true }, h('summary', 'Reading options'),
    h('div', { class: 'geo-sec' },
      h('div', { class: 'geo-grid' }, field('Input coordinate system', inCrs, 'Leave empty to use the .prj file or the one named in the file. Needed for CSV with projected x and y.'), field('Text encoding of attributes', encSel)),
      gTable))
  const more = h('details', { class: 'geo-more geo-extra' }, h('summary', 'More options'),
    h('div', { class: 'geo-sec' },
      h('h3', 'Shapes and columns'),
      h('div', { class: 'geo-grid' }, field('Simplify lines and shapes (metres, 0 = off)', tol, 'Douglas-Peucker. Per-point times stay with the points that are kept.')),
      field('Keep only the rows where', h('div', { class: 'geo-row' }, fcol, fop, h('div', { class: 'grow2' }, fval))),
      field('Columns to keep', keepBox),
      gCsv, gKml, gShp))

  const outputRow = h('div', { class: 'geo-grid' },
    fixedTo ? null : field('Convert to', toSel),
    field('Output coordinate system', crsSel, 'WGS 84 is what GeoJSON, KML and GPX expect.'),
    field('', customCrs))
  const fmtNote = h('div', { class: 'geo-note' })
  const goBtn = button('Convert', { icon: 'repeat-2', variant: 'primary', size: 'lg', block: true, onClick: () => busy(goBtn, convert, { label: 'Converting', errorTo: outEl, progress: prog }) })

  const banner = fixedTo ? h('div', { class: 'geo-banner' }, h('span', { class: 'tag' }, (LABEL[fromKey] || fromKey || 'Map').toString().toUpperCase().replace(' (ZIP)', '')), icon('arrow-right'), h('span', { class: 'tag to' }, (LABEL[fixedTo] || fixedTo).toString().toUpperCase().replace(' (ZIP)', ''))) : null

  root.append(h('div', { class: 't-geo stack' }, banner, zone, list.el, readMore, prog.el, infoEl, optsEl, outEl))

  function syncFormat() {
    const t = o.to
    gCsv.hidden = !['csv', 'xlsx', 'json'].includes(t)
    gKml.hidden = !['kml', 'kmz'].includes(t)
    gShp.hidden = t !== 'shp'
    fmtNote.textContent = (BLURB[t] || '') + (['kml', 'kmz', 'gpx', 'topojson'].includes(t) ? ' Always WGS 84.' : '')
    crsSel.disabled = ['kml', 'kmz', 'gpx', 'topojson'].includes(t)
    customCrs.disabled = crsSel.disabled
    gCsv.querySelector('.geo-grid').hidden = t !== 'csv'
  }

  const readOpts = () => ({ inCrs: o.inCrs, encoding: o.encoding, latCol: o.latCol, lonCol: o.lonCol, wktCol: o.wktCol })
  const opsOpts = () => ({ filterColumn: o.fcol, filterOp: o.fop, filterValue: o.fval, columns: o.keep && o.keep.size ? [...o.keep] : null, tolerance: o.tolerance })

  async function readAll() {
    const id = ++readId
    outEl.replaceChildren()
    if (!files.length) { read = null; ops = []; infoEl.replaceChildren(); optsEl.replaceChildren(); list.el.hidden = true; readMore.hidden = true; return }
    list.el.hidden = false; readMore.hidden = false
    ctl?.abort(); ctl = new AbortController()
    prog.set(null, 'Reading')
    try {
      const r = await readGeo(files, readOpts(), { signal: ctl.signal, onProgress: (f) => prog.set(f) })
      if (id !== readId) return
      read = r
      afterRead()
    } catch (e) {
      if (id !== readId || isAbort(e)) return
      read = null; ops = []
      clear(infoEl, alert('error', errorMessage(e)))
      optsEl.replaceChildren()
      readMore.open = true
    } finally { if (id === readId) prog.hide() }
  }

  function afterRead() {
    const cols = columnsOf(read.features)
    fcol.replaceChildren(h('option', { value: '' }, 'No filter'), ...cols.map((c) => h('option', { value: c }, c)))
    nameSel.replaceChildren(h('option', { value: '' }, 'Automatic'), ...cols.map((c) => h('option', { value: c }, c)))
    o.fcol = ''; o.keep = null; o.nameField = ''
    keepBox.replaceChildren(...cols.map((c) => h('label', h('input', { type: 'checkbox', checked: true, onchange: () => { const keep = new Set([...keepBox.querySelectorAll('input')].filter((x) => x.checked).map((x) => x.nextSibling.textContent)); o.keep = keep.size === cols.length ? null : keep; refresh(false) } }), h('span', c))))
    inCrs.placeholder = `Detected: ${read.sources.map((s) => s.crs).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`
    clear(optsEl, panel(
      h('div', { class: 'stack' }, outputRow, fmtNote, more, goBtn)))
    syncFormat()
    mountInfo()
    refresh(true)
  }

  const statHost = h('div'), noteHost = h('div', { class: 'stack' })
  function mountInfo() {
    clear(infoEl, noteHost, statHost, map.el, basemap, tbl.el)
    queueMicrotask(() => map.resize())
  }

  function refresh(fit) {
    if (!read) return
    const r = applyOps(read.features, opsOpts())
    ops = r.features
    const sum = summarize(ops)
    clear(statHost, summaryTiles(ops, read.sources, sum))
    const msgs = [...read.notes, ...r.notes]
    clear(noteHost, ...msgs.map((m) => alert(/skipped|left out|could not|were cut|outside|looks|guess|not UTF/i.test(m) ? 'warn' : 'info', m)))
    map.setFeatures(ops, { fit })
    tbl.set(ops)
  }

  async function convert() {
    if (!read) throw new Error('Choose a file first.')
    if (!ops.length) throw new Error('No features are left. Loosen the filter.')
    ctl?.abort(); ctl = new AbortController()
    prog.set(null, 'Converting')
    const outCrs = o.outPick === 'custom' ? o.outCustom.trim() : o.outPick
    if (o.outPick === 'custom' && !outCrs) throw new Error('Type the output coordinate system, or pick one from the list.')
    const base = read.name
    const w = await writeGeo(ops, o.to, { outCrs, outEncoding: o.outEncoding, delimiter: o.delimiter, bom: o.bom, csvLines: o.lines ? 'points' : 'wkt', tracks: o.tracks, nameField: o.nameField }, { name: base, signal: ctl.signal })
    const notes = w.notes
    const rows = w.files.map((f) => h('div', { class: 'geo-out' }, icon('file-down'), h('div', { class: 'nm' }, f.name), h('div', { class: 'sz' }, formatBytes(f.size)), button('Download', { icon: 'download', variant: 'primary', size: 'sm', onClick: () => download(f, f.name) })))
    clear(outEl,
      alert('success', h('strong', 'Done. '), `${ops.length.toLocaleString('en-US')} feature${ops.length === 1 ? '' : 's'} converted on this device.`),
      ...notes.map((m) => alert(/left out|could not|were cut|cannot|No \.prj/i.test(m) ? 'warn' : 'info', m)),
      ...rows)
    outEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  syncFormat()
  return () => { ctl?.abort(); readId++ }
}
