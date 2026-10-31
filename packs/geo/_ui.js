// Shared pieces for the geo tools' screens: styles, the attribute table, the summary tiles.
import { h, stats, formatNumber } from '../../lib/ui.js'
import { columnsOf } from './_util.js'

const CSS = `
.t-geo .geo-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; align-items: start; }
.t-geo .geo-sec { display: flex; flex-direction: column; gap: 10px; }
.t-geo .geo-sec > h3 { margin: 4px 0 0; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 650; }
.t-geo details.geo-more { border: 1px solid var(--border); border-radius: 12px; padding: 0 12px; background: var(--surface); }
.t-geo details.geo-more > summary { cursor: pointer; padding: 10px 0; font-weight: 600; font-size: 14px; }
.t-geo details.geo-more[open] > summary { border-bottom: 1px solid var(--border); margin-bottom: 12px; }
.t-geo details.geo-more > .geo-sec { padding-bottom: 14px; }
.t-geo .geo-cols { display: flex; flex-wrap: wrap; gap: 6px 14px; max-height: 150px; overflow: auto; padding: 4px 0; }
.t-geo .geo-cols label { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; }
.t-geo .geo-cols input { accent-color: var(--accent); width: 16px; height: 16px; margin: 0; }
.t-geo .geo-tbl { max-height: 360px; overflow: auto; border: 1px solid var(--border); border-radius: 12px; }
.t-geo .geo-tbl table { border-collapse: collapse; width: 100%; font-size: 13px; }
.t-geo .geo-tbl th, .t-geo .geo-tbl td { padding: 6px 10px; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
.t-geo .geo-tbl th { position: sticky; top: 0; background: var(--surface-2); z-index: 1; font-weight: 600; color: var(--text-2); }
.t-geo .geo-tbl tbody tr { cursor: pointer; }
.t-geo .geo-tbl tbody tr:hover { background: var(--accent-soft); }
.t-geo .geo-tbl tbody tr.on { background: var(--accent-soft); outline: 1px solid var(--accent); outline-offset: -1px; }
.t-geo .geo-tbl td.n, .t-geo .geo-tbl th.n { color: var(--muted); text-align: right; }
.t-geo .geo-note { font-size: 13px; color: var(--muted); }
.t-geo .geo-out { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.t-geo .geo-out .nm { flex: 1; min-width: 160px; overflow-wrap: anywhere; font-weight: 600; }
.t-geo .geo-out .sz { color: var(--muted); font-size: 13px; }
.t-geo .geo-banner { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-weight: 650; }
.t-geo .geo-banner .tag { padding: 3px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 13px; }
.t-geo .geo-banner .tag.to { background: var(--accent); color: var(--accent-text); }
.t-geo .geo-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end; }
.t-geo .geo-row > * { flex: 1 1 140px; min-width: 0; }
.t-geo .geo-row > .grow2 { flex: 2 1 220px; }
`
let injected = false
export function geoCss() {
  if (injected) return
  document.head.append(h('style', { 'data-geo-ui': '' }, CSS))
  injected = true
}

const TYPE_NAMES = { Point: 'point', MultiPoint: 'multipoint', LineString: 'line', MultiLineString: 'multiline', Polygon: 'polygon', MultiPolygon: 'multipolygon', GeometryCollection: 'collection', 'No geometry': 'no geometry' }
/** "4 points, 1 polygon" */
export function typeText(types) {
  const parts = Object.entries(types).map(([t, n]) => `${formatNumber(n, 0)} ${TYPE_NAMES[t] || t}${n === 1 || t === 'No geometry' ? '' : 's'}`)
  return parts.join(', ') || 'none'
}
export const fmtBbox = (b) => (b ? `${b[0].toFixed(5)}, ${b[1].toFixed(5)} to ${b[2].toFixed(5)}, ${b[3].toFixed(5)}` : '-')

export function summaryTiles(features, sources, summary) {
  const crs = [...new Set(sources.map((s) => s.crs))].join(', ')
  return stats([
    { label: 'Features', value: formatNumber(summary.count, 0), accent: true, hint: typeText(summary.types) },
    { label: 'Columns', value: formatNumber(summary.columns.length, 0), hint: summary.columns.slice(0, 4).join(', ') + (summary.columns.length > 4 ? '...' : '') },
    { label: 'Coordinate system', value: sources.some((s) => s.wasProjected) ? 'Converted' : 'WGS 84', hint: crs },
    { label: 'Bounding box (W, S, E, N)', value: summary.bbox ? `${summary.bbox[0].toFixed(3)}, ${summary.bbox[1].toFixed(3)}` : '-', hint: summary.bbox ? `to ${summary.bbox[2].toFixed(3)}, ${summary.bbox[3].toFixed(3)}` : '' },
  ])
}

/**
 * Attribute table. geoTable({ onPick(index) }) -> { el, set(features, {max}), mark(index), page }.
 * Shows the first `max` rows; clicking a row calls onPick with the feature index.
 */
export function geoTable({ onPick, max = 100 } = {}) {
  const wrap = h('div', { class: 'geo-tbl', tabindex: 0, role: 'region', 'aria-label': 'Feature attributes' })
  const more = h('div', { class: 'geo-note' })
  const el = h('div', { class: 'stack' }, wrap, more)
  let marked = -1
  const api = {
    el,
    set(features, { limit = max, filter } = {}) {
      const cols = columnsOf(features).slice(0, 60)
      const idx = []
      for (let i = 0; i < features.length && idx.length < limit; i++) if (!filter || filter(features[i])) idx.push(i)
      const cell = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
      const tbody = h('tbody', idx.map((i) => h('tr', { dataset: { i } }, h('td', { class: 'n' }, i + 1), h('td', features[i].geometry?.type || ''), cols.map((c) => h('td', { title: cell(features[i].properties?.[c]) }, cell(features[i].properties?.[c]))))))
      const tbl = h('table', h('thead', h('tr', h('th', { class: 'n' }, '#'), h('th', 'Geometry'), cols.map((c) => h('th', { scope: 'col' }, c)))), tbody)
      tbl.addEventListener('click', (e) => { const tr = e.target.closest('tbody tr'); if (tr) onPick?.(Number(tr.dataset.i)) })
      wrap.replaceChildren(tbl)
      const total = filter ? features.filter(filter).length : features.length
      more.textContent = total > idx.length ? `Showing the first ${idx.length} of ${formatNumber(total, 0)} rows.` : total ? `${formatNumber(total, 0)} row${total === 1 ? '' : 's'}.` : 'No rows match.'
      marked = -1
    },
    mark(i) {
      marked = i
      for (const tr of wrap.querySelectorAll('tbody tr')) tr.classList.toggle('on', Number(tr.dataset.i) === i)
      const on = wrap.querySelector('tbody tr.on')
      on?.scrollIntoView({ block: 'nearest' })
    },
  }
  return api
}
