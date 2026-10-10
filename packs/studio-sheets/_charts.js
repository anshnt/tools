// Charts from a selection: floating Chart.js charts anchored to the sheet, draggable and resizable.
import { h, icon } from '../../lib/ui.js'
import { chartjs } from '../../lib/libs.js'
import { formatValue } from './_fmt.js'
import { HW, HH } from './_grid.js'

export const CHART_TYPES = [
  ['bar', 'Column', 'chart-column'], ['hbar', 'Bar', 'chart-bar'], ['stacked', 'Stacked column', 'chart-column-stacked'], ['line', 'Line', 'chart-line'], ['area', 'Area', 'chart-area'],
  ['pie', 'Pie', 'chart-pie'], ['doughnut', 'Doughnut', 'circle-dot'], ['scatter', 'Scatter', 'chart-scatter'],
]
export const PALETTE = ['#5b4cf0', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#ec4899', '#14b8a6', '#8b5cf6', '#f97316', '#84cc16']

/** Read the data a chart plots from the model: {labels, series: [{name, data}]}. */
export function chartData(model, ch) {
  const s = ch.src
  const sh = model.sheet(s.sid)
  if (!sh) return { labels: [], series: [] }
  const ex = model.extent(sh.id)
  const r2 = Math.min(s.r2, Math.max(s.r1, ex.r)), c2 = Math.min(s.c2, Math.max(s.c1, ex.c))
  let m = []
  for (let r = s.r1; r <= r2; r++) { const row = []; for (let c = s.c1; c <= c2; c++) row.push(model.valueAt(sh.id, r, c)); m.push(row) }
  const fmt = (r, c) => formatValue(model.valueAt(sh.id, r, c), model.style(model.styleAt(sh, r, c)).nf).text
  if (ch.by === 'rows') m = m[0].map((_, j) => m.map((r) => r[j]))
  const rowsN = m.length, colsN = m[0]?.length || 0
  if (!rowsN || !colsN) return { labels: [], series: [] }
  const hasHead = ch.headers !== false && rowsN > 1
  const hasLabels = ch.labels !== false && colsN > 1
  const body = m.slice(hasHead ? 1 : 0)
  const labels = body.map((r, i) => (hasLabels ? (typeof r[0] === 'number' && ch.type === 'scatter' ? r[0] : String(fmtCell(r[0], model, sh, s, ch, i + (hasHead ? 1 : 0), 0, fmt))) : String(i + 1)))
  const series = []
  for (let c = hasLabels ? 1 : 0; c < colsN; c++) {
    const name = hasHead && m[0][c] != null ? String(m[0][c]) : `Series ${series.length + 1}`
    series.push({ name, data: body.map((r) => (typeof r[c] === 'number' ? r[c] : r[c] == null || r[c] === '' ? null : Number.isNaN(Number(r[c])) ? null : Number(r[c]))) })
  }
  return { labels, series }
}
function fmtCell(v, model, sh, s, ch, i, j, fmt) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') {
    const r = ch.by === 'rows' ? s.r1 + j : s.r1 + i, c = ch.by === 'rows' ? s.c1 + i : s.c1 + j
    try { return fmt(r, c) } catch { return String(v) }
  }
  return typeof v === 'object' ? v.code : String(v)
}

export function chartConfig(ch, data, theme) {
  const { text, muted, grid } = theme
  const t = ch.type
  const pie = t === 'pie' || t === 'doughnut'
  const colors = ch.colors && ch.colors.length ? ch.colors : PALETTE
  const common = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
    plugins: {
      legend: { display: ch.legend !== false && (pie || data.series.length > 1), position: ch.legendPos || 'bottom', labels: { color: text, boxWidth: 12, usePointStyle: true, font: { size: 12 } } },
      title: { display: !!ch.title, text: ch.title || '', color: text, font: { size: 15, weight: '600' }, padding: { bottom: 10 } },
      tooltip: { mode: pie ? 'nearest' : 'index', intersect: false },
    },
  }
  if (pie) {
    const d = data.series[0] || { data: [] }
    return {
      type: t, options: { ...common, cutout: t === 'doughnut' ? '58%' : 0 },
      data: { labels: data.labels, datasets: [{ label: d.name, data: d.data, backgroundColor: data.labels.map((_, i) => colors[i % colors.length]), borderColor: theme.surface, borderWidth: 2 }] },
    }
  }
  const scales = {
    x: { stacked: t === 'stacked', ticks: { color: muted, maxRotation: 45, autoSkip: true }, grid: { color: grid, display: t !== 'bar' && t !== 'stacked' && t !== 'hbar' ? true : false }, title: { display: !!ch.xTitle, text: ch.xTitle || '', color: muted } },
    y: { stacked: t === 'stacked', beginAtZero: ch.zero !== false, ticks: { color: muted }, grid: { color: grid }, title: { display: !!ch.yTitle, text: ch.yTitle || '', color: muted } },
  }
  if (t === 'scatter') {
    return {
      type: 'scatter', options: { ...common, scales: { x: { ...scales.x, type: 'linear', grid: { color: grid } }, y: scales.y } },
      data: { datasets: data.series.map((s, i) => ({ label: s.name, data: s.data.map((y, k) => ({ x: typeof data.labels[k] === 'number' ? data.labels[k] : k + 1, y })), backgroundColor: colors[i % colors.length], borderColor: colors[i % colors.length], pointRadius: 4 })) },
    }
  }
  const type = t === 'hbar' || t === 'stacked' || t === 'bar' ? 'bar' : 'line'
  return {
    type, options: { ...common, indexAxis: t === 'hbar' ? 'y' : 'x', scales: t === 'hbar' ? { x: scales.y, y: scales.x } : scales, elements: { line: { tension: ch.smooth ? 0.35 : 0, borderWidth: 2.5 }, point: { radius: 3 } } },
    data: {
      labels: data.labels,
      datasets: data.series.map((s, i) => ({
        label: s.name, data: s.data, backgroundColor: type === 'bar' ? colors[i % colors.length] : t === 'area' ? colors[i % colors.length] + '55' : colors[i % colors.length],
        borderColor: colors[i % colors.length], fill: t === 'area', borderRadius: type === 'bar' ? 4 : 0, maxBarThickness: 48,
      })),
    },
  }
}

export class ChartLayer {
  constructor(grid, app) {
    this.grid = grid
    this.app = app
    this.root = h('div', { class: 'sx-charts' })
    grid.ov.prepend(this.root)
    this.boxes = new Map()
    this.selected = null
    this.drag = null
    this.theme = null
    this._t = 0
  }
  themeColors() {
    const cs = getComputedStyle(this.grid.root)
    const dark = document.documentElement.dataset.theme === 'dark'
    return { text: cs.getPropertyValue('--text').trim() || '#111', muted: cs.getPropertyValue('--muted').trim() || '#666', grid: dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.07)', surface: cs.getPropertyValue('--surface').trim() || '#fff', dark }
  }
  pos(ch) {
    const g = this.grid, Z = g.zoom, f = g.frozen(), ax = g.axes()
    const fx = ax.col.offset(f.c), fy = ax.row.offset(f.r)
    return {
      left: HW + ch.x * Z - (ch.x >= fx ? g.sc.scrollLeft : 0) - HW,
      top: HH + ch.y * Z - (ch.y >= fy ? g.sc.scrollTop : 0) - HH,
      width: ch.w * Z, height: ch.h * Z,
    }
  }
  /** Rebuild boxes for the current sheet and refresh data. */
  async sync(force = false) {
    const g = this.grid, sh = g.sh
    if (!sh) return
    const list = sh.charts
    const ids = new Set(list.map((c) => c.id))
    for (const [id, b] of this.boxes) if (!ids.has(id) || b.sid !== sh.id) { b.chart?.destroy(); b.el.remove(); this.boxes.delete(id) }
    if (this.selected && !ids.has(this.selected)) this.selected = null
    const theme = this.themeColors()
    const themeKey = theme.dark ? 'd' : 'l'
    for (const ch of list) {
      let b = this.boxes.get(ch.id)
      if (!b) {
        const canvas = h('canvas', { 'aria-label': ch.title || 'Chart' })
        const el = h('div', { class: 'sx-chart', tabindex: 0, role: 'img', 'aria-label': `Chart: ${ch.title || 'untitled'}`, dataset: { id: ch.id } }, canvas,
          h('div', { class: 'sx-chart-rs', title: 'Resize' }), h('div', { class: 'sx-chart-bar' },
            h('button', { type: 'button', class: 'sx-chart-x', 'aria-label': 'Delete chart', title: 'Delete chart', onclick: (e) => { e.stopPropagation(); this.app.deleteChart(ch.id) } }, icon('trash-2')),
            h('button', { type: 'button', class: 'sx-chart-x', 'aria-label': 'Edit chart', title: 'Chart settings', onclick: (e) => { e.stopPropagation(); this.select(ch.id); this.app.openPanel('charts') } }, icon('settings-2'))))
        el.addEventListener('pointerdown', (e) => this.pointerDown(e, ch.id))
        el.addEventListener('keydown', (e) => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.app.deleteChart(ch.id) } else if (e.key === 'Escape') { this.select(null); g.focus() } })
        this.root.append(el)
        b = { el, canvas, chart: null, sid: sh.id, sig: '', themeKey: '' }
        this.boxes.set(ch.id, b)
      }
      const p = this.pos(ch)
      Object.assign(b.el.style, { left: p.left + 'px', top: p.top + 'px', width: p.width + 'px', height: p.height + 'px' })
      b.el.classList.toggle('sel', this.selected === ch.id)
      b.el.setAttribute('aria-label', `Chart: ${ch.title || 'untitled'}`)
      const data = chartData(this.app.model, ch)
      const sig = JSON.stringify([ch.type, ch.title, ch.legend, ch.legendPos, ch.smooth, ch.zero, ch.xTitle, ch.yTitle, ch.colors, ch.src, ch.by, ch.headers, ch.labels, data])
      if (!force && b.sig === sig && b.themeKey === themeKey) continue
      b.sig = sig; b.themeKey = themeKey
      try {
        const Chart = await chartjs()
        const cfg = chartConfig(ch, data, theme)
        if (b.chart && b.chart.config.type === cfg.type && b.themeKey === themeKey && !force) { b.chart.data = cfg.data; b.chart.options = cfg.options; b.chart.update('none') } else {
          b.chart?.destroy()
          b.chart = new Chart(b.canvas, cfg)
        }
      } catch (e) { console.error(e) }
    }
  }
  reposition() {
    const sh = this.grid.sh
    if (!sh) return
    for (const ch of sh.charts) {
      const b = this.boxes.get(ch.id)
      if (!b) continue
      const p = this.pos(ch)
      Object.assign(b.el.style, { left: p.left + 'px', top: p.top + 'px', width: p.width + 'px', height: p.height + 'px' })
    }
  }
  select(id) {
    this.selected = id
    for (const [cid, b] of this.boxes) b.el.classList.toggle('sel', cid === id)
    this.app.onChartSelect?.(id)
  }
  pointerDown(e, id) {
    if (e.target.closest('button')) return
    e.preventDefault()
    e.stopPropagation()
    const ch = this.grid.sh.charts.find((c) => c.id === id)
    this.select(id)
    const b = this.boxes.get(id)
    b.el.focus({ preventScroll: true })
    const resize = !!e.target.closest('.sx-chart-rs')
    this.drag = { id, resize, x0: e.clientX, y0: e.clientY, orig: { x: ch.x, y: ch.y, w: ch.w, h: ch.h }, cur: { x: ch.x, y: ch.y, w: ch.w, h: ch.h } }
    b.el.setPointerCapture(e.pointerId)
    const move = (ev) => {
      const d = this.drag
      if (!d) return
      const Z = this.grid.zoom
      const dx = (ev.clientX - d.x0) / Z, dy = (ev.clientY - d.y0) / Z
      d.cur = d.resize ? { ...d.orig, w: Math.max(200, d.orig.w + dx), h: Math.max(140, d.orig.h + dy) } : { ...d.orig, x: Math.max(0, d.orig.x + dx), y: Math.max(0, d.orig.y + dy) }
      const p = this.pos({ ...ch, ...d.cur })
      Object.assign(b.el.style, { left: p.left + 'px', top: p.top + 'px', width: p.width + 'px', height: p.height + 'px' })
    }
    const up = () => {
      b.el.removeEventListener('pointermove', move); b.el.removeEventListener('pointerup', up); b.el.removeEventListener('pointercancel', up)
      const d = this.drag
      this.drag = null
      if (d && (d.cur.x !== d.orig.x || d.cur.y !== d.orig.y || d.cur.w !== d.orig.w || d.cur.h !== d.orig.h)) this.app.updateChart(id, { x: Math.round(d.cur.x), y: Math.round(d.cur.y), w: Math.round(d.cur.w), h: Math.round(d.cur.h) }, 'Move chart')
    }
    b.el.addEventListener('pointermove', move); b.el.addEventListener('pointerup', up); b.el.addEventListener('pointercancel', up)
  }
  image(id) { return this.boxes.get(id)?.chart?.toBase64Image('image/png', 1) }
  destroy() { for (const b of this.boxes.values()) b.chart?.destroy(); this.boxes.clear(); this.root.remove() }
}

/** Render a chart to a PNG data URL off screen (used for PDF export). */
export async function chartImage(model, ch, w = 900, hh = 540, theme) {
  const Chart = await chartjs()
  const canvas = document.createElement('canvas')
  canvas.width = w * 2; canvas.height = hh * 2
  canvas.style.cssText = `position:fixed;left:-9999px;top:0;width:${w}px;height:${hh}px`
  document.body.append(canvas)
  try {
    const cfg = chartConfig(ch, chartData(model, ch), theme || { text: '#111111', muted: '#555555', grid: 'rgba(0,0,0,.08)', surface: '#ffffff' })
    cfg.options = { ...cfg.options, animation: false, responsive: false, devicePixelRatio: 2 }
    const chart = new Chart(canvas, cfg)
    const bg = canvas.getContext('2d')
    bg.save(); bg.globalCompositeOperation = 'destination-over'; bg.fillStyle = '#ffffff'; bg.fillRect(0, 0, canvas.width, canvas.height); bg.restore()
    const url = canvas.toDataURL('image/png')
    chart.destroy()
    return url
  } finally { canvas.remove() }
}
