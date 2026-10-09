// Chart maker: Chart.js charts from table data with live preview, aggregation, palettes and PNG / SVG / data export.
import { h, icon, clear, field, input, select, toggle, tabs, number, toast, alert, onCleanup } from '../../lib/ui.js'
import { chartjs } from '../../lib/libs.js'
import { aggregate, inferTypes, isNumericType, num, groupDate, localeDateOrder, inferDateOrder, collator, isEmpty, str, plural, toCsv } from './_table.js'
import { toolFlow, exportBar, statTiles, nameBase, colSelect, chipSelect, cssVar, watchTheme } from './_view.js'

const SVGCANVAS = 'https://cdn.jsdelivr.net/npm/svgcanvas@2.6.0/dist/svgcanvas.esm.js'
export const PALETTES = {
  vivid: ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316', '#84cc16'],
  ocean: ['#0ea5e9', '#6366f1', '#14b8a6', '#3b82f6', '#06b6d4', '#818cf8', '#0284c7', '#2dd4bf', '#1d4ed8', '#22d3ee'],
  sunset: ['#f97316', '#ec4899', '#ef4444', '#a855f7', '#f59e0b', '#fb7185', '#c026d3', '#fbbf24', '#dc2626', '#ea580c'],
  forest: ['#16a34a', '#0d9488', '#65a30d', '#059669', '#84cc16', '#15803d', '#10b981', '#4d7c0f', '#a3e635', '#047857'],
  pastel: ['#a5b4fc', '#f9a8d4', '#fde68a', '#86efac', '#93c5fd', '#fca5a5', '#c4b5fd', '#5eead4', '#fdba74', '#bef264'],
  safe: ['#0072B2', '#E69F00', '#009E73', '#D55E00', '#CC79A7', '#56B4E9', '#F0E442', '#444444', '#999999', '#000000'],
  mono: ['#111827', '#4b5563', '#9ca3af', '#d1d5db', '#374151', '#6b7280', '#e5e7eb', '#1f2937', '#a1a1aa', '#71717a'],
}
const TYPES = [['bar', 'Bar', 'chart-column'], ['barh', 'Horizontal', 'chart-bar'], ['line', 'Line', 'chart-line'], ['area', 'Area', 'chart-area'], ['pie', 'Pie', 'chart-pie'], ['doughnut', 'Doughnut', 'donut'], ['scatter', 'Scatter', 'chart-scatter']]
const SIZES = [['1200x675', 'Wide 1200 x 675'], ['1080x1080', 'Square 1080 x 1080'], ['1000x700', 'Classic 1000 x 700'], ['800x500', 'Small 800 x 500'], ['1600x900', 'Large 1600 x 900']]
const AGGS = [['sum', 'Add them up (sum)'], ['avg', 'Average'], ['count', 'Count rows'], ['min', 'Smallest'], ['max', 'Largest'], ['median', 'Median'], ['none', 'Plot every row as it is']]
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const full = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })
const MAX_CATS = 400, MAX_POINTS = 20000

/** Turn table + options into plotted data. Returns { labels, series: [{ name, data }], points, note, tableOut }. */
export function prepareData(t, o, types) {
  const notes = []
  if (o.type === 'scatter') {
    const xs = t.rows.map((r) => num(r[o.xCol])), name = t.headers[o.yCols[0]] || 'Y'
    const pts = []
    t.rows.forEach((r, i) => { const x = xs[i], y = num(r[o.yCols[0]]); if (x != null && y != null) pts.push({ x, y }) })
    let shown = pts
    if (pts.length > MAX_POINTS) { const step = Math.ceil(pts.length / MAX_POINTS); shown = pts.filter((_, i) => i % step === 0); notes.push(`Showing ${shown.length.toLocaleString()} of ${pts.length.toLocaleString()} points`) }
    return { labels: [], series: [{ name, data: shown }], points: shown.length, note: notes.join('. '), tableOut: { headers: [t.headers[o.xCol], name], rows: pts.map((p) => [p.x, p.y]) } }
  }
  const order = o.dateGroup !== 'none' ? inferDateOrder(t.rows.slice(0, 2000).map((r) => r[o.xCol])) || localeDateOrder() : null
  const yCols = o.agg === 'count' || !o.yCols.length ? [] : o.yCols
  const names = yCols.length ? yCols.map((c) => t.headers[c]) : ['Count']
  const groups = new Map()
  t.rows.forEach((r, i) => {
    let label, sort
    const raw = o.xCol >= 0 ? r[o.xCol] : i + 1
    if (o.dateGroup !== 'none') { const k = groupDate(raw, o.dateGroup, order); if (!k) return; label = k.label; sort = k.sort }
    else { label = isEmpty(raw) ? '(blank)' : str(raw).trim(); sort = null }
    const key = o.agg === 'none' ? `${label}\u0000${i}` : label
    let g = groups.get(key)
    if (!g) { g = { label, sort, rows: [] }; groups.set(key, g) }
    g.rows.push(r)
  })
  let list = [...groups.values()]
  const value = (g, k) => {
    if (!yCols.length) return g.rows.length
    const cells = g.rows.map((r) => r[yCols[k]])
    if (o.agg === 'none') return num(cells[0])
    return aggregate(cells, o.agg === 'count' ? 'count' : o.agg)
  }
  let series = names.map((name, k) => ({ name, data: list.map((g) => { const v = value(g, k); return typeof v === 'number' && Number.isFinite(v) ? v : null }) }))
  let labels = list.map((g) => g.label)
  const idx = () => labels.map((_, i) => i)
  const reorder = (ord) => { labels = ord.map((i) => labels[i]); series = series.map((s) => ({ ...s, data: ord.map((i) => s.data[i]) })); list = ord.map((i) => list[i]) }
  if (o.dateGroup !== 'none' && o.sort === 'none') reorder(idx().sort((a, b) => list[a].sort - list[b].sort))
  if (o.sort === 'label') reorder(idx().sort((a, b) => collator.compare(labels[a], labels[b])))
  const first = (i) => series[0].data[i] ?? -Infinity
  if (o.sort === 'desc' || (o.top > 0 && o.sort === 'none')) reorder(idx().sort((a, b) => first(b) - first(a)))
  if (o.sort === 'asc') reorder(idx().sort((a, b) => first(a) - first(b)))
  if (o.top > 0 && labels.length > o.top) {
    const keep = o.top
    const restIdx = idx().slice(keep)
    if (o.other && (o.agg === 'sum' || o.agg === 'count')) {
      const rest = series.map((s) => s.data.slice(keep).reduce((a, b) => a + (b || 0), 0))
      labels = [...labels.slice(0, keep), `Other (${restIdx.length})`]
      series = series.map((s, k) => ({ ...s, data: [...s.data.slice(0, keep), rest[k]] }))
    } else {
      labels = labels.slice(0, keep); series = series.map((s) => ({ ...s, data: s.data.slice(0, keep) }))
    }
    notes.push(`Top ${keep} of ${list.length.toLocaleString()}`)
  }
  if (labels.length > MAX_CATS) { notes.push(`Showing the first ${MAX_CATS} of ${labels.length.toLocaleString()} categories`); labels = labels.slice(0, MAX_CATS); series = series.map((s) => ({ ...s, data: s.data.slice(0, MAX_CATS) })) }
  return { labels, series, points: labels.length, note: notes.join('. '), tableOut: { headers: [o.xCol >= 0 ? t.headers[o.xCol] : 'Row', ...series.map((s) => s.name)], rows: labels.map((l, i) => [l, ...series.map((s) => s.data[i] ?? '')]) } }
}

const alpha = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})` }

/** Chart.js configuration. theme: { text, grid, bg, muted }. */
export function makeConfig(data, o, theme, { fixed = false } = {}) {
  const pal = PALETTES[o.palette] || PALETTES.vivid
  const pie = o.type === 'pie' || o.type === 'doughnut'
  const line = o.type === 'line' || o.type === 'area'
  const horizontal = o.type === 'barh'
  const many = data.labels.length
  const col = (i) => pal[i % pal.length]
  const datasets = data.series.map((s, i) => {
    const base = { label: s.name, data: s.data }
    if (pie) return { ...base, backgroundColor: data.labels.map((_, j) => col(j)), borderColor: theme.bg === 'transparent' ? 'rgba(255,255,255,0)' : theme.bgSolid, borderWidth: 2, hoverOffset: 8 }
    if (o.type === 'scatter') return { ...base, backgroundColor: alpha(col(i), 0.65), borderColor: col(i), pointRadius: o.points ? 4 : 2.5, pointHoverRadius: 7 }
    if (line) return { ...base, borderColor: col(i), backgroundColor: alpha(col(i), o.type === 'area' ? 0.22 : 0.1), fill: o.type === 'area' ? (o.stacked ? (i === 0 ? 'origin' : '-1') : 'origin') : false, tension: o.smooth ? 0.38 : 0, borderWidth: 2.5, pointRadius: o.points && many <= 80 ? 3.5 : 0, pointHoverRadius: 6, pointBackgroundColor: col(i), spanGaps: true }
    return { ...base, backgroundColor: o.vary && data.series.length === 1 ? data.labels.map((_, j) => col(j)) : alpha(col(i), 0.9), borderColor: col(i), borderWidth: 0, borderRadius: Math.min(o.round, many > 40 ? 2 : 99), borderSkipped: false, maxBarThickness: 64 }
  })
  const legendPos = o.legend === 'auto' ? (pie ? 'right' : 'top') : o.legend
  const showLegend = o.legend !== 'none' && (o.legend !== 'auto' || pie || data.series.length > 1)
  const title = o.title.trim()
  const axisTitle = (txt) => (txt ? { display: true, text: txt, color: theme.muted, font: { family: FONT, size: 12, weight: '600' } } : { display: false })
  const tick = { color: theme.muted, font: { family: FONT, size: 11.5 } }
  const grid = { color: theme.grid, drawTicks: false }
  const scales = pie ? {} : {
    x: { type: o.type === 'scatter' ? 'linear' : 'category', title: axisTitle(o.xTitle), ticks: { ...tick, maxRotation: 55, autoSkip: true, ...(horizontal ? { callback: (v) => compact.format(v) } : {}) }, grid: { ...grid, display: o.type === 'scatter' || horizontal ? o.grid : false }, stacked: o.stacked && !line, border: { color: theme.grid } },
    y: { title: axisTitle(o.yTitle), beginAtZero: o.zero, ticks: { ...tick, padding: 6, callback: horizontal ? undefined : (v) => compact.format(v) }, grid: { ...grid, display: horizontal ? false : o.grid }, stacked: o.stacked, border: { display: false } },
  }
  return {
    type: o.type === 'barh' ? 'bar' : o.type === 'area' ? 'line' : o.type,
    data: { labels: data.labels, datasets },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      responsive: !fixed, maintainAspectRatio: false, animation: fixed ? false : { duration: 650, easing: 'easeOutQuart' },
      layout: { padding: { top: 8, right: 10, bottom: 4, left: 4 } },
      interaction: { mode: o.type === 'scatter' ? 'nearest' : 'index', intersect: o.type === 'scatter' },
      plugins: {
        title: title ? { display: true, text: title, color: theme.text, font: { family: FONT, size: 17, weight: '700' }, padding: { bottom: 14 } } : { display: false },
        legend: { display: showLegend, position: legendPos, labels: { color: theme.text, font: { family: FONT, size: 12 }, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 14 } },
        tooltip: { backgroundColor: 'rgba(17,17,24,.92)', titleFont: { family: FONT, weight: '600' }, bodyFont: { family: FONT }, padding: 10, cornerRadius: 10, callbacks: { label: (c) => { const v = c.parsed?.y ?? c.parsed; const n = typeof v === 'object' ? v.y : v; const lab = c.dataset.label ? `${c.dataset.label}: ` : ''; return o.type === 'scatter' ? `${full.format(c.parsed.x)}, ${full.format(c.parsed.y)}` : `${pie ? `${c.label}: ` : lab}${full.format(horizontal ? c.parsed.x : n)}` } } },
        dtLabels: { on: o.labels, color: pie ? '#fff' : theme.text, family: FONT },
      },
      scales,
      ...(fixed ? { devicePixelRatio: fixed.dpr } : {}),
    },
  }
}

const labelsPlugin = {
  id: 'dtLabels',
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts?.on) return
    const { ctx } = chart
    ctx.save()
    ctx.font = `600 11px ${opts.family}`
    ctx.fillStyle = opts.color
    ctx.textAlign = 'center'
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i)
      if (meta.hidden) return
      meta.data.forEach((el, j) => {
        let v = ds.data[j]
        if (v == null) return
        if (typeof v === 'object') v = v.y
        const txt = compact.format(v)
        const pos = el.tooltipPosition ? el.tooltipPosition() : { x: el.x, y: el.y }
        if (meta.type === 'bar') {
          if (chart.options.indexAxis === 'y') { ctx.textAlign = 'left'; ctx.fillText(txt, el.x + 6, el.y + 4) } else { ctx.textAlign = 'center'; ctx.fillText(txt, el.x, el.y - 6) }
        } else if (meta.type === 'doughnut' || meta.type === 'pie') { ctx.textAlign = 'center'; ctx.fillText(txt, pos.x, pos.y + 4) }
        else { ctx.textAlign = 'center'; ctx.fillText(txt, pos.x, pos.y - 9) }
      })
    })
    ctx.restore()
  },
}
const bgPlugin = (color) => ({ id: 'dtBg', beforeDraw(chart) { if (!color) return; const { ctx, width, height } = chart; ctx.save(); ctx.fillStyle = color; ctx.fillRect(0, 0, width, height); ctx.restore() } })

const liveTheme = () => ({ text: cssVar('--text', '#111'), muted: cssVar('--muted', '#666'), grid: cssVar('--border', '#e5e5e5'), bg: 'live', bgSolid: cssVar('--surface', '#fff') })
const exportTheme = (bg) => bg === 'dark' ? { text: '#f4f4f8', muted: '#a8a8b8', grid: 'rgba(255,255,255,.12)', bg: 'dark', bgSolid: '#12121a' } : { text: '#15151c', muted: '#5b5b6a', grid: 'rgba(20,20,40,.1)', bg: bg === 'transparent' ? 'transparent' : 'white', bgSolid: '#ffffff' }

export async function mount(root) {
  let entry = null, types = [], data = null, chart = null
  const Chart = await chartjs()
  const o = {
    type: 'bar', xCol: 0, yCols: [], agg: 'sum', sort: 'none', top: 0, other: true, dateGroup: 'none', stacked: false, vary: false, palette: 'vivid', title: '', xTitle: '', yTitle: '',
    legend: 'auto', grid: true, labels: false, smooth: true, points: true, zero: true, round: 6, bg: 'white', size: '1200x675',
  }
  const canvas = h('canvas', { role: 'img', 'aria-label': 'Chart preview' })
  const box = h('div', { class: 'dt-chartbox' }, canvas)
  const noteHost = h('div', { class: 'small muted', 'aria-live': 'polite' })
  const statsHost = h('div'), dataHost = h('div'), warnHost = h('div'), exportHost = h('div')
  const xSel = colSelect({ headers: [], onChange: (c) => { o.xCol = c; autoDate(); refresh() }, none: 'Row number' })
  const ySel = h('div')
  const dateSel = select([['none', 'Keep each date'], ['day', 'Day'], ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year'], ['weekday', 'Day of week']], 'none', (v) => { o.dateGroup = v; if (v !== 'none' && o.agg === 'none') o.agg = 'sum'; syncAgg(); refresh() })
  const dateField = field('Group dates by', dateSel)
  const aggSel = select(AGGS, 'sum', (v) => { o.agg = v; refresh() })
  const topOther = toggle('Group the rest as "Other"', true, (v) => { o.other = v; refresh() })
  const xField = field('Labels (X axis)', xSel), aggField = field('Rows with the same label', aggSel)

  const f = toolFlow({
    titles: ['Add your data', 'Build the chart', 'Download it'],
    source: { sample: 'sales' },
    onData: (e) => { entry = e; if (e) init() },
  })

  function init() {
    const t = entry.table
    types = inferTypes(t)
    xSel.setHeaders(t.headers, false)
    const catIdx = types.findIndex((x) => x === 'text' || x === 'date' || x === 'datetime')
    o.xCol = catIdx >= 0 ? catIdx : -1
    const nums = t.headers.map((_, i) => i).filter((i) => isNumericType(types[i]) && i !== o.xCol)
    const pref = [/revenue|amount|total|sales/i, /price|value|score|cost|profit/i, /qty|units|count|quantity/i].map((re) => nums.find((i) => re.test(t.headers[i]))).find((x) => x != null)
    o.yCols = nums.length ? [pref ?? nums[nums.length - 1]] : []
    o.agg = o.yCols.length ? 'sum' : 'count'
    o.type = 'bar'; o.dateGroup = 'none'; o.sort = 'none'; o.top = 0; o.title = ''; o.xTitle = ''; o.yTitle = ''
    xSel.value = String(o.xCol)
    autoDate()
    buildY()
    syncTypeButtons()
    refresh()
  }
  const isDateX = () => o.xCol >= 0 && (types[o.xCol] === 'date' || types[o.xCol] === 'datetime')
  function autoDate() {
    dateField.hidden = !isDateX()
    if (isDateX() && o.dateGroup === 'none') {
      const t = entry.table
      const keys = new Set(t.rows.map((r) => r[o.xCol]))
      if (keys.size > 24) { o.dateGroup = 'month'; dateSel.value = 'month'; o.type = o.type === 'bar' ? 'line' : o.type; syncTypeButtons() }
    } else if (!isDateX()) { o.dateGroup = 'none'; dateSel.value = 'none' }
    syncAgg()
  }
  function syncAgg() {
    const t = entry.table
    const labelsRepeat = o.dateGroup !== 'none' || (o.xCol >= 0 && new Set(t.rows.slice(0, 5000).map((r) => str(r[o.xCol]).trim())).size < Math.min(t.rows.length, 5000))
    if (o.agg === 'none' && labelsRepeat) o.agg = 'sum'
    if (!labelsRepeat && o.agg === 'sum' && o.type !== 'scatter') o.agg = 'none'
    aggSel.value = o.agg
  }
  function buildY() {
    const t = entry.table
    const nums = t.headers.map((_, i) => i).filter((i) => isNumericType(types[i]))
    o.yCols = o.yCols.filter((c) => nums.includes(c))
    clear(ySel, nums.length ? field(o.type === 'scatter' ? 'Values (Y axis)' : 'Values to plot', chipSelect({ items: nums.map((i) => ({ value: i, label: t.headers[i], type: types[i] })), value: o.yCols, multi: o.type !== 'scatter' && o.type !== 'pie' && o.type !== 'doughnut', bulk: false, onChange: (v) => { o.yCols = o.type === 'scatter' || o.type === 'pie' || o.type === 'doughnut' ? v.slice(-1) : v; if (!o.yCols.length && o.agg !== 'count') { o.agg = 'count'; aggSel.value = 'count' } else if (o.yCols.length && o.agg === 'count') { o.agg = 'sum'; aggSel.value = 'sum' } refresh() } }), 'Pick one or more number columns. With none picked, rows are counted.') : h('p', { class: 'small muted' }, 'No number columns found, so the chart counts rows for each label.'))
  }
  const typeBtns = []
  function syncTypeButtons() { for (const b of typeBtns) b.setAttribute('aria-pressed', String(b.dataset.type === o.type)) }

  function destroyChart() { if (chart) { try { chart.destroy() } catch { /* already gone */ } chart = null } }
  function draw() {
    const t = entry.table
    if (o.type === 'scatter' && (o.xCol < 0 || types[o.xCol] === undefined || !isNumericType(types[o.xCol]))) {
      destroyChart(); clear(warnHost, alert('info', 'A scatter chart needs a number column for the X axis. Pick one under "Labels (X axis)".')); return
    }
    clear(warnHost)
    data = prepareData(t, o, types)
    const cfg = makeConfig(data, o, liveTheme())
    cfg.options.plugins.dtLabels.on = o.labels
    if (chart && chart.config.type === cfg.type) {
      chart.data = cfg.data; chart.options = cfg.options; chart.update()
    } else {
      destroyChart()
      chart = new Chart(canvas, { ...cfg, plugins: [labelsPlugin] })
    }
    clear(statsHost, statTiles([{ label: o.type === 'scatter' ? 'Points' : 'Categories', value: data.points, accent: true }, { label: 'Series', value: data.series.length }]))
    noteHost.textContent = data.note || ''
  }
  const refresh = () => { if (entry) { buildY(); draw() } }

  // keep the chart readable if the visitor flips light and dark
  watchTheme(() => { if (chart) { destroyChart(); draw() } })
  onCleanup(destroyChart)

  async function renderTo(kind) {
    const [w, hgt] = o.size.split('x').map(Number)
    const theme = exportTheme(o.bg)
    const cfg = makeConfig(prepareData(entry.table, o, types), o, theme, { fixed: { dpr: kind === 'png' ? 2 : 1 } })
    cfg.options.plugins.dtLabels.on = o.labels
    cfg.options.responsive = false
    const bg = o.bg === 'transparent' ? null : theme.bgSolid
    if (kind === 'png') {
      const c = h('canvas', { width: w, height: hgt })
      c.style.width = `${w}px`; c.style.height = `${hgt}px`
      const ch = new Chart(c, { ...cfg, plugins: [labelsPlugin, bgPlugin(bg)] })
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'))
      ch.destroy()
      return blob
    }
    const m = await import(SVGCANVAS)
    const Ctx = m.Context || m.default
    const ctx = new Ctx(w, hgt)
    const cv = ctx.canvas
    Object.assign(cv, { width: w, height: hgt, getContext: () => ctx, getAttribute: (k) => (k === 'width' ? w : hgt), addEventListener() {}, removeEventListener() {}, parentNode: null, style: {} })
    const ch = new Chart(ctx, { ...cfg, plugins: [labelsPlugin, bgPlugin(bg)] })
    const svg = ctx.getSerializedSvg(true)
    try { ch.destroy() } catch { /* svg contexts cannot detach */ }
    return new Blob([svg], { type: 'image/svg+xml' })
  }

  // ----- controls
  const typeRow = h('div', { class: 'dt-types', role: 'group', 'aria-label': 'Chart type' }, TYPES.map(([id, label, ic]) => {
    const b = h('button', { type: 'button', class: 'dt-type', 'data-type': id, 'aria-pressed': String(id === o.type), onclick: () => {
      o.type = id
      if (id === 'barh') o.sort = o.sort === 'none' ? 'desc' : o.sort
      if ((id === 'pie' || id === 'doughnut') && !o.top) { o.top = 8; topInput.value = 8 }
      if (id === 'scatter') { o.agg = 'none'; aggSel.value = 'none' } else if (o.agg === 'none') syncAgg()
      if (id === 'line' || id === 'area' || id === 'scatter') o.zero = id === 'area'
      zeroT.input.checked = o.zero
      aggField.hidden = id === 'scatter'
      syncTypeButtons(); buildY(); draw()
    } }, icon(ic), h('span', label))
    typeBtns.push(b)
    return b
  }))
  const topInput = number(0, { min: 0, step: 1, placeholder: '0 = all', ariaLabel: 'Show only the top', onInput: (v) => { o.top = v > 0 ? Math.floor(v) : 0; refresh() } })
  const zeroT = toggle('Start the value axis at zero', true, (v) => { o.zero = v; draw() })
  const dataTab = h('div', { class: 'stack' }, typeRow, h('div', { class: 'dt-grid' }, xField, dateField), ySel, aggField,
    h('div', { class: 'dt-grid' }, field('Sort', select([['none', 'As in the file'], ['desc', 'Largest first'], ['asc', 'Smallest first'], ['label', 'By label']], 'none', (v) => { o.sort = v; refresh() })), field('Show only the top', topInput)), topOther)
  const swatches = h('div', { class: 'dt-pal' }, Object.entries(PALETTES).map(([k, cols]) => h('button', { type: 'button', class: 'dt-sw', 'aria-pressed': String(k === o.palette), title: k === 'safe' ? 'Color-blind safe' : k[0].toUpperCase() + k.slice(1), 'aria-label': `Palette ${k}`, onclick: (e) => { o.palette = k; for (const b of swatches.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); draw() } }, cols.slice(0, 5).map((c) => h('i', { style: `background:${c}` })))))
  const styleTab = h('div', { class: 'stack' }, field('Colors', swatches),
    h('div', { class: 'row' }, toggle('Gridlines', true, (v) => { o.grid = v; draw() }), toggle('Value labels', false, (v) => { o.labels = v; draw() }), toggle('Smooth lines', true, (v) => { o.smooth = v; draw() }), toggle('Show points', true, (v) => { o.points = v; draw() })),
    h('div', { class: 'row' }, toggle('Stack series', false, (v) => { o.stacked = v; draw() }), toggle('A color for each bar', false, (v) => { o.vary = v; draw() }), zeroT),
    h('div', { class: 'dt-grid' }, field('Legend', select([['auto', 'Automatic'], ['top', 'Top'], ['bottom', 'Bottom'], ['right', 'Right'], ['left', 'Left'], ['none', 'Hidden']], 'auto', (v) => { o.legend = v; draw() })),
      field('Bar roundness', select([[0, 'Square'], [4, 'Slight'], [6, 'Soft'], [14, 'Round'], [99, 'Pill']], 6, (v) => { o.round = +v; draw() }))))
  const textTab = h('div', { class: 'stack' }, field('Chart title', input({ placeholder: 'Monthly revenue', oninput: (e) => { o.title = e.target.value; draw() } })),
    h('div', { class: 'dt-grid' }, field('X axis title', input({ placeholder: 'Month', oninput: (e) => { o.xTitle = e.target.value; draw() } })), field('Y axis title', input({ placeholder: 'Revenue ($)', oninput: (e) => { o.yTitle = e.target.value; draw() } }))))

  f.s2.body.append(h('div', { class: 'dt-chartgrid' },
    h('div', { class: 'panel dt-ctl' }, tabs([{ id: 'data', label: 'Data', render: () => dataTab }, { id: 'style', label: 'Style', render: () => styleTab }, { id: 'text', label: 'Titles', render: () => textTab }], 'data')),
    h('div', { class: 'dt-chartcol' }, warnHost, h('div', { class: 'panel dt-chartpanel' }, box), noteHost, statsHost)))
  const actions = h('div', { class: 'stack' },
    h('div', { class: 'dt-grid' },
      field('Export size', select(SIZES, o.size, (v) => { o.size = v })),
      field('Background', select([['white', 'White'], ['transparent', 'Transparent'], ['dark', 'Dark']], 'white', (v) => { o.bg = v }), 'Colors adapt to the background you pick.')),
    exportBar({
      copy: false,
      items: [
        { label: 'Download PNG', icon: 'image', primary: true, make: async () => ({ blob: await renderTo('png'), name: `${nameBase(entry, 'chart')}-chart.png` }) },
        { label: 'Download SVG', icon: 'file-code', make: async () => ({ blob: await renderTo('svg'), name: `${nameBase(entry, 'chart')}-chart.svg` }) },
        { label: 'Download chart data (CSV)', icon: 'file-text', make: async () => ({ blob: new Blob([toCsv(prepareData(entry.table, o, types).tableOut)], { type: 'text/csv' }), name: `${nameBase(entry, 'chart')}-chart-data.csv` }) },
        { label: 'Copy image', icon: 'copy', make: async () => { const b = await renderTo('png'); try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); toast('Image copied. Paste it into a document or chat.', 'success') } catch { toast('Your browser would not copy the image. Download the PNG instead.', 'error') } return null } },
      ],
      note: 'PNG is 2x sharp. SVG stays crisp at any size.',
    }))
  f.s3.body.append(actions)
  root.append(h('style', {}, `
.dt-chartgrid { display: grid; grid-template-columns: minmax(280px, 380px) minmax(0, 1fr); gap: 16px; align-items: start; }
.dt-chartcol { display: flex; flex-direction: column; gap: 10px; min-width: 0; position: sticky; top: calc(var(--header-h) + 12px); }
.dt-chartpanel { padding: 12px; }
.dt-chartbox { position: relative; height: 430px; }
.dt-chartbox canvas { max-width: 100%; }
.dt-types { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.dt-type { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 4px 8px; border-radius: 13px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; font-size: 11.5px; color: var(--text-2); transition: transform .25s var(--spring), border-color .2s, background .2s, box-shadow .2s; }
.dt-type .icon { width: 22px; height: 22px; transition: transform .35s var(--spring); }
.dt-type:hover { transform: translateY(-2px); border-color: var(--border-strong); }
.dt-type:hover .icon { transform: scale(1.12) rotate(-5deg); }
.dt-type[aria-pressed="true"] { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); color: var(--accent); font-weight: 600; box-shadow: 0 8px 18px -12px var(--accent); }
.dt-pal { display: flex; flex-wrap: wrap; gap: 8px; }
.dt-sw { display: inline-flex; padding: 3px; gap: 0; border-radius: 12px; border: 2px solid transparent; background: var(--surface-2); cursor: pointer; overflow: hidden; transition: transform .2s var(--spring), border-color .2s; }
.dt-sw:hover { transform: scale(1.06); }
.dt-sw[aria-pressed="true"] { border-color: var(--accent); }
.dt-sw i { width: 14px; height: 30px; display: block; }
.dt-sw i:first-child { border-radius: 8px 0 0 8px; } .dt-sw i:last-child { border-radius: 0 8px 8px 0; }
@media (max-width: 1000px) { .dt-chartgrid { grid-template-columns: minmax(0, 1fr); } .dt-chartcol { position: static; order: -1; } .dt-chartbox { height: 340px; } }
`), f.el)
}
