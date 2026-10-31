// Map and table viewer for Shapefile, GeoJSON, KML, KMZ, GPX, FIT, CSV and more. Drag to pan, scroll to zoom, click a row or a shape.
// The map is drawn on this device with no network; an optional OpenStreetMap background can be switched on.
import { h, clear, dropzone, fileList, alert, progress, input, field, select, toggle, button, busy, download, formatBytes, debounce, errorMessage, isAbort, icon } from '../../lib/ui.js'
import { readGeo, writeGeo, summarize, WRITE_FORMATS } from './_geo.js'
import { createMap } from './_map.js'
import { geoCss, geoTable, summaryTiles } from './_ui.js'

export function mount(root, { signal }) {
  geoCss()
  let files = [], read = null, ctl = null, id = 0, query = ''
  const zone = dropzone({
    multiple: true, icon: 'map', label: 'Drop a map or GPS file here, or click to choose',
    accept: '.zip,.shp,.shx,.dbf,.prj,.cpg,.geojson,.json,.topojson,.kml,.kmz,.gpx,.gml,.xml,.fit,.csv,.tsv,.txt,.xlsx,.xls,.ods,.wkt,.wkb',
    hint: 'Shapefile (ZIP or loose files), GeoJSON, KML, KMZ, GPX, FIT, CSV, XLSX, TopoJSON. Nothing leaves your device.',
    onFiles: (fs) => { const seen = new Set(files.map((f) => f.name + f.size)); files = [...files, ...fs.filter((f) => !seen.has(f.name + f.size))]; list.set(files); load() },
  })
  const list = fileList({ sortable: false, onChange: (fs) => { files = [...fs]; load() } })
  list.el.hidden = true
  const prog = progress('Reading')
  const body = h('div', { class: 'stack' })
  const map = createMap({ height: 460, onSelect: (i) => tbl.mark(i) })
  const tbl = geoTable({ max: 200, onPick: (i) => { map.select(i, { zoom: true }); tbl.mark(i) } })
  const basemap = toggle('Show an OpenStreetMap background (loads map images from tile.openstreetmap.org)', false, (v) => map.setBasemap(v))
  const search = input({ placeholder: 'Search the attributes', 'aria-label': 'Search the attributes', oninput: debounce((e) => { query = e.target.value.trim().toLowerCase(); fillTable() }, 200) })
  const fmt = select(WRITE_FORMATS.map(([k, l]) => [k, l]), 'geojson')
  const exportOut = h('div', { class: 'stack' })
  const exportBtn = button('Convert', { icon: 'download', variant: 'secondary', onClick: () => busy(exportBtn, doExport, { label: 'Converting', errorTo: exportOut }) })

  root.append(h('div', { class: 't-geo stack' }, zone, list.el, prog.el, body))

  const match = (f) => !query || Object.values(f.properties || {}).some((v) => v !== null && v !== undefined && String(typeof v === 'object' ? JSON.stringify(v) : v).toLowerCase().includes(query))
  const fillTable = () => { if (read) tbl.set(read.features, { filter: query ? match : undefined, limit: 200 }) }

  async function load() {
    const my = ++id
    exportOut.replaceChildren()
    if (!files.length) { body.replaceChildren(); list.el.hidden = true; read = null; return }
    list.el.hidden = false
    ctl?.abort(); ctl = new AbortController()
    prog.set(null, 'Reading')
    try {
      const r = await readGeo(files, {}, { signal: ctl.signal })
      if (my !== id) return
      read = r
      const sum = summarize(r.features)
      clear(body,
        ...r.notes.map((m) => alert(/skipped|left out|could not|outside|looks|not UTF/i.test(m) ? 'warn' : 'info', m)),
        summaryTiles(r.features, r.sources, sum), map.el, basemap,
        h('div', { class: 'geo-row' }, h('div', { class: 'grow2' }, field('Search', search))), tbl.el,
        h('div', { class: 'geo-row' }, field('Save as', fmt), exportBtn), exportOut)
      query = ''; search.value = ''
      map.setFeatures(r.features)
      fillTable()
      queueMicrotask(() => map.resize())
    } catch (e) {
      if (my !== id || isAbort(e)) return
      read = null
      clear(body, alert('error', errorMessage(e)))
    } finally { if (my === id) prog.hide() }
  }

  async function doExport() {
    if (!read) return
    const w = await writeGeo(read.features, fmt.value, {}, { name: read.name })
    clear(exportOut, ...w.notes.map((m) => alert('info', m)), ...w.files.map((f) => h('div', { class: 'geo-out' }, icon('file-down'), h('div', { class: 'nm' }, f.name), h('div', { class: 'sz' }, formatBytes(f.size)), button('Download', { icon: 'download', variant: 'primary', size: 'sm', onClick: () => download(f, f.name) }))))
  }

  return () => { ctl?.abort(); id++ }
}
