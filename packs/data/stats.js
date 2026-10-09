// Statistics calculator: descriptive stats per column, percentiles, histogram and correlation matrix.
import { h, icon, clear, field, input, select, toggle, segmented, tabs, number, onCleanup, alert } from '../../lib/ui.js'
import { chartjs } from '../../lib/libs.js'
import { inferTypes, isNumericType, isEmpty, num, describe, percentile, pearson, spearman, plural } from './_table.js'
import { toolFlow, exportBar, statTiles, chipSelect, section, nameBase, cssVar, watchTheme, typeBadge } from './_view.js'

const MAX_COLS = 24

/** Histogram bins: Freedman-Diaconis, falling back to Sturges. Returns { edges, counts, width }. */
export function histogram(sorted, bins = 0) {
  const n = sorted.length
  const lo = sorted[0], hi = sorted[n - 1]
  if (!n || lo === hi) return { edges: [lo, hi ?? lo], counts: [n], width: 0 }
  let k = bins
  if (!k) {
    const iqr = percentile(sorted, 75) - percentile(sorted, 25)
    const w = (2 * iqr) / Math.cbrt(n)
    k = w > 0 ? Math.ceil((hi - lo) / w) : Math.ceil(Math.log2(n)) + 1
    k = Math.max(5, Math.min(40, k))
  }
  const width = (hi - lo) / k
  const counts = new Array(k).fill(0)
  for (const x of sorted) counts[Math.min(k - 1, Math.floor((x - lo) / width))]++
  return { edges: Array.from({ length: k + 1 }, (_, i) => lo + i * width), counts, width }
}

const fmtFor = (dec) => (x) => {
  if (x == null || Number.isNaN(x)) return '-'
  if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity'
  if (dec === 'auto') return Number(x.toPrecision(7)).toLocaleString('en', { maximumFractionDigits: 8 })
  return x.toLocaleString('en', { minimumFractionDigits: +dec, maximumFractionDigits: +dec })
}

function boxSvg(d, w = 150) {
  const ns = 'http://www.w3.org/2000/svg'
  if (!d.count || d.min === d.max) return h('span', { class: 'muted small' }, '-')
  const x = (v) => 6 + ((v - d.min) / (d.max - d.min)) * (w - 12)
  const el = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e }
  const svg = el('svg', { viewBox: `0 0 ${w} 26`, width: w, height: 26, role: 'img', 'aria-label': `Box plot from ${d.min} to ${d.max}, median ${d.median}` })
  svg.append(el('line', { x1: x(d.min), x2: x(d.max), y1: 13, y2: 13, stroke: 'var(--border-strong)', 'stroke-width': 2, 'stroke-linecap': 'round' }),
    el('rect', { x: x(d.q1), y: 5, width: Math.max(2, x(d.q3) - x(d.q1)), height: 16, rx: 5, fill: 'var(--accent-soft)', stroke: 'var(--accent)', 'stroke-width': 1.5 }),
    el('line', { x1: x(d.median), x2: x(d.median), y1: 4, y2: 22, stroke: 'var(--accent)', 'stroke-width': 3, 'stroke-linecap': 'round' }),
    el('circle', { cx: x(d.mean), cy: 13, r: 2.6, fill: 'var(--accent-2)' }))
  return svg
}

export async function mount(root) {
  const Chart = await chartjs()
  let entry = null, types = [], cols = [], results = []
  const o = { pop: false, dec: 'auto', method: 'pearson', hist: 0, bins: 0, curve: true, pcts: '5, 95' }
  let chart = null
  const statsHost = h('div'), tableHost = h('div'), corrHost = h('div'), histHost = h('div'), barHost = h('div'), chipHost = h('div'), tilesHost = h('div')
  const canvas = h('canvas', { role: 'img', 'aria-label': 'Histogram' })
  const histBox = h('div', { class: 'dt-chartbox', style: 'height:340px' }, canvas)
  const histSel = select([['0', '']], '0', (v) => { o.hist = +v; drawHist() })
  const f = toolFlow({
    titles: ['Add your numbers', 'Pick columns and options', 'Results'],
    source: { sample: 'students', hint: 'A CSV or Excel file, or paste numbers straight from a sheet (one column or many).' },
    onData: (e) => { entry = e; if (e) init() },
    lockText: 'Add numbers first',
  })

  function init() {
    const t = entry.table
    types = inferTypes(t)
    const numeric = t.headers.map((_, i) => i).filter((i) => isNumericType(types[i]))
    cols = numeric.slice(0, MAX_COLS)
    clear(chipHost, numeric.length ? chipSelect({ items: numeric.map((i) => ({ value: i, label: t.headers[i], type: types[i] })), value: cols, onChange: (v) => { cols = v.slice(0, MAX_COLS); o.hist = Math.min(o.hist, Math.max(0, cols.length - 1)); run() }, label: 'Columns to analyze' }) : alert('warn', 'No number columns were found. Check that the first row is a header, or paste only numbers.'))
    o.hist = 0
    run()
  }
  const sortedFor = (c) => {
    const t = entry.table
    const a = []
    let bad = 0
    for (const r of t.rows) { const v = r[c]; if (isEmpty(v)) continue; const x = num(v); if (x == null) bad++; else a.push(x) }
    return { a, bad }
  }

  function run() {
    if (!entry) return
    const t = entry.table
    clear(histSel, cols.map((c, i) => h('option', { value: String(i) }, t.headers[c])))
    histSel.value = String(o.hist)
    results = cols.map((c) => { const { a, bad } = sortedFor(c); return { c, name: t.headers[c], d: describe(a), bad, missing: t.rows.length - a.length - bad } })
    if (!results.length) { clear(tilesHost); clear(tableHost); clear(corrHost); clear(histHost); clear(barHost); destroyChart(); return }
    const fm = fmtFor(o.dec)
    const sd = (d) => (o.pop ? d.stdPop : d.stdSample), vr = (d) => (o.pop ? d.variancePop : d.varianceSample)
    const extra = o.pcts.split(',').map((x) => parseFloat(x)).filter((x) => x >= 0 && x <= 100)
    const defs = [
      ['Count', (r) => r.d.count, 'i'], ['Missing or text', (r) => r.missing + r.bad, 'i'], ['Sum', (r) => r.d.sum], ['Mean', (r) => r.d.mean], ['Median', (r) => r.d.median],
      ['Mode', (r) => (r.d.mode.length ? r.d.mode.slice(0, 3).map(fm).join(', ') + (r.d.mode.length > 3 ? ', ...' : '') : 'none'), 's'],
      ['Minimum', (r) => r.d.min], ['Maximum', (r) => r.d.max], ['Range', (r) => r.d.range], ['Q1 (25th percentile)', (r) => r.d.q1], ['Q3 (75th percentile)', (r) => r.d.q3], ['IQR', (r) => r.d.iqr],
      [`Variance (${o.pop ? 'population' : 'sample'})`, (r) => vr(r.d)], [`Std deviation (${o.pop ? 'population' : 'sample'})`, (r) => sd(r.d)], ['Standard error', (r) => r.d.sem],
      ['Coefficient of variation', (r) => (Number.isFinite(r.d.cv) ? `${(r.d.cv * 100).toFixed(2)}%` : '-'), 's'], ['Skewness', (r) => r.d.skew], ['Excess kurtosis', (r) => r.d.kurt],
      ['Outliers (1.5 x IQR)', (r) => r.d.outliers, 'i'],
      ...extra.map((p) => [`Percentile ${p}`, (r) => percentile(r.d.sorted, p)]),
    ]
    const cell = (def, r) => { const v = def[1](r); return typeof v === 'string' ? v : def[2] === 'i' ? v.toLocaleString() : fm(v) }
    const first = results[0]
    clear(tilesHost, statTiles([
      { label: results.length > 1 ? `${first.name}: mean` : 'Mean', value: fm(first.d.mean), accent: true }, { label: 'Median', value: fm(first.d.median) },
      { label: o.pop ? 'Std dev (population)' : 'Std dev (sample)', value: fm(sd(first.d)) }, { label: 'Count', value: first.d.count },
      { label: 'Min to max', value: `${fm(first.d.min)} to ${fm(first.d.max)}` },
    ]))
    // stats table (statistics down, columns across)
    const table = h('div', { class: 'table-wrap', style: 'max-height:640px' }, h('table', { class: 'table dt-stat-t' },
      h('thead', h('tr', h('th', 'Statistic'), results.map((r) => h('th', { class: 'num', title: r.name }, r.name)))),
      h('tbody', h('tr', h('td', 'Distribution'), results.map((r) => h('td', { class: 'num' }, boxSvg(r.d)))),
        defs.map((def) => h('tr', h('td', def[0]), results.map((r) => h('td', { class: 'num' }, cell(def, r))))))))
    clear(tableHost, table)
    // correlation
    if (results.length > 1) {
      const vals = results.map((r) => { const rows = entry.table.rows; return rows.map((row) => num(row[r.c])) })
      const corr = (i, j) => {
        const xs = [], ys = []
        for (let k = 0; k < vals[i].length; k++) if (vals[i][k] != null && vals[j][k] != null) { xs.push(vals[i][k]); ys.push(vals[j][k]) }
        return o.method === 'spearman' ? spearman(xs, ys) : pearson(xs, ys)
      }
      const color = (v) => { if (!Number.isFinite(v)) return 'transparent'; const a = Math.min(1, Math.abs(v)) * 0.62; return v >= 0 ? `rgba(79,70,229,${a})` : `rgba(244,63,94,${a})` }
      clear(corrHost, h('div', { class: 'table-wrap', style: 'max-height:560px' }, h('table', { class: 'table dt-corr' },
        h('thead', h('tr', h('th'), results.map((r) => h('th', { class: 'num', title: r.name }, r.name)))),
        h('tbody', results.map((a, i) => h('tr', h('td', { style: 'font-weight:600' }, a.name), results.map((b, j) => { const v = i === j ? 1 : corr(i, j); return h('td', { class: 'num', style: `background:${color(v)}`, title: `${a.name} vs ${b.name}` }, Number.isFinite(v) ? v.toFixed(2) : '-') })))))),
      h('p', { class: 'small muted' }, `${o.method === 'spearman' ? 'Spearman rank' : 'Pearson'} correlation: 1 means they rise together, -1 means one rises as the other falls, 0 means no straight-line link.`))
    } else clear(corrHost, h('div', { class: 'empty' }, icon('grid-3x3'), 'Pick two or more number columns to see how they relate.'))
    drawHist()
    const out = { headers: ['Statistic', ...results.map((r) => r.name)], rows: defs.map((def) => [def[0], ...results.map((r) => cell(def, r))]) }
    clear(barHost, exportBar({ getTable: () => out, name: () => `${nameBase(entry)}-statistics`, formats: ['csv', 'xlsx'], note: 'Downloads the statistics table' }))
  }

  const theme = () => ({ text: cssVar('--text-2', '#444'), muted: cssVar('--muted', '#777'), grid: cssVar('--border', '#e5e5e5'), accent: cssVar('--accent', '#5b4cf0'), pink: cssVar('--accent-2', '#c026d3') })
  function destroyChart() { if (chart) { try { chart.destroy() } catch { /* ignore */ } chart = null } }
  function drawHist() {
    destroyChart()
    const r = results[o.hist] || results[0]
    if (!r || !r.d.count) { clear(histHost); return }
    const hs = histogram(r.d.sorted, o.bins)
    const th = theme()
    const fm = fmtFor(o.dec === 'auto' ? 'auto' : o.dec)
    const labels = hs.counts.map((_, i) => `${Number(hs.edges[i].toPrecision(4))} to ${Number(hs.edges[i + 1].toPrecision(4))}`)
    const mid = hs.counts.map((_, i) => (hs.edges[i] + hs.edges[i + 1]) / 2)
    const sd = r.d.stdSample, mu = r.d.mean
    const curve = o.curve && sd > 0 && hs.width > 0 ? mid.map((m) => r.d.count * hs.width * Math.exp(-0.5 * ((m - mu) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI))) : null
    chart = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets: [
        { label: 'Values in range', data: hs.counts, backgroundColor: 'rgba(99,102,241,.78)', borderRadius: 6, barPercentage: 1, categoryPercentage: 0.92 },
        ...(curve ? [{ type: 'line', label: 'Normal curve', data: curve, borderColor: th.pink, borderWidth: 2.5, pointRadius: 0, tension: 0.4, fill: false }] : []),
      ] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 700, easing: 'easeOutQuart' },
        plugins: { legend: { display: !!curve, labels: { color: th.text, usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { title: (it) => it[0].label } } },
        scales: { x: { ticks: { color: th.muted, maxRotation: 50, autoSkip: true, font: { size: 11 } }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: th.muted, precision: 0 }, grid: { color: th.grid }, title: { display: true, text: 'How many', color: th.muted } } },
      },
    })
    clear(histHost)
  }
  watchTheme(() => { if (results.length) drawHist() })
  onCleanup(destroyChart)

  f.s2.body.append(h('div', { class: 'panel stack' }, section('Columns', 'columns-3', chipHost),
    h('hr', { class: 'divider' }),
    h('div', { class: 'dt-grid' },
      field('Standard deviation', select([['s', 'Sample (n - 1)'], ['p', 'Population (n)']], 's', (v) => { o.pop = v === 'p'; run() }), 'Use sample if your data is part of a bigger group.'),
      field('Decimal places', select([['auto', 'Automatic'], ['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['6', '6']], 'auto', (v) => { o.dec = v; run() })),
      field('Extra percentiles', input({ value: o.pcts, 'aria-label': 'Extra percentiles', oninput: (e) => { o.pcts = e.target.value; run() } }), 'Comma separated, 0 to 100.'))))
  f.s3.body.append(tilesHost, tabs([
    { id: 'tbl', label: 'Descriptive statistics', render: () => tableHost },
    { id: 'hist', label: 'Histogram', render: () => h('div', { class: 'stack' }, h('div', { class: 'dt-grid' }, field('Column', histSel), field('Bars', select([['0', 'Automatic'], ['5', '5'], ['10', '10'], ['15', '15'], ['20', '20'], ['30', '30']], '0', (v) => { o.bins = +v; drawHist() })), h('div', { style: 'align-self:end' }, toggle('Normal curve', true, (v) => { o.curve = v; drawHist() }))), h('div', { class: 'panel' }, histBox), histHost) },
    { id: 'corr', label: 'Correlations', render: () => h('div', { class: 'stack' }, segmented([['pearson', 'Pearson'], ['spearman', 'Spearman (ranks)']], 'pearson', (v) => { o.method = v; run() }, 'Correlation method'), corrHost) },
  ], 'tbl'), barHost)
  root.append(h('style', {}, `
.dt-stat-t td:first-child, .dt-stat-t th:first-child { position: sticky; left: 0; background: var(--surface-2); z-index: 1; font-weight: 600; }
.dt-stat-t th:first-child { z-index: 3; }
.dt-stat-t td svg { display: block; margin-left: auto; }
.dt-corr td { min-width: 64px; }
`), f.el)
}
