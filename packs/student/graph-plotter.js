// Graph plotter: several functions, implicit curves like x^2+y^2=25, sliders for parameters, pan/zoom (mouse, touch, pinch, keys),
// roots, intersections and extrema. Expressions go through the safe parser in _expr.js (no eval).
import { h, button, segmented, toggle, toast, download, onCleanup, clear, copyText, icon } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { compile, ExprError, formatNum } from './_expr.js'
import { stage, tile, toolStyle, pill, reduceMotion } from './_kit.js'

const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#0ea5e9', '#ef4444', '#a855f7', '#14b8a6']
const PRESETS = [['sin x', 'sin(x)'], ['x²', 'x^2'], ['1/x', '1/x'], ['|x|', 'abs(x)'], ['eˣ', 'e^x'], ['ln x', 'ln(x)'], ['tan x', 'tan(x)'], ['a·sin(bx)', 'a*sin(b*x)'], ['circle', 'x^2+y^2=25'], ['x³ − 3x', 'x^3-3x']]
const RESERVED = new Set(['x', 'y'])

const CSS = `
.t-graph .gp-wrap { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 340px); gap: 12px; align-items: start; }
.t-graph .gp-canvas-tile { grid-column: 1; grid-row: 1 / span 4; padding: 10px; position: sticky; top: calc(var(--header-h) + 12px); align-self: start; }
.t-graph .gp-side { grid-column: 2; }
@media (max-width: 960px) { .t-graph .gp-wrap { grid-template-columns: minmax(0, 1fr); } .t-graph .gp-canvas-tile, .t-graph .gp-side { grid-column: 1; grid-row: auto; position: relative; top: auto; } }
.t-graph .gp-box { position: relative; border-radius: 16px; overflow: hidden; background: var(--surface); border: 1px solid var(--border); height: clamp(340px, 62vh, 620px); touch-action: none; }
.t-graph canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; outline: none; }
.t-graph canvas:active { cursor: grabbing; }
.t-graph canvas:focus-visible { box-shadow: inset 0 0 0 3px var(--ring); border-radius: 16px; }
.t-graph .gp-bar { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; }
.t-graph .gp-bar .sp { flex: 1; }
.t-graph .gp-zoom { position: absolute; right: 10px; bottom: 10px; display: flex; flex-direction: column; gap: 6px; }
.t-graph .gp-zoom .btn { background: color-mix(in srgb, var(--surface) 88%, transparent); backdrop-filter: blur(8px); box-shadow: var(--shadow); }
.t-graph .gp-hint { position: absolute; left: 12px; bottom: 10px; font-size: 12px; color: var(--muted); pointer-events: none; transition: opacity .6s; }
.t-graph .fn-row { display: flex; align-items: center; gap: 8px; animation: stu-pop .35s var(--ease) both; }
.t-graph .fn-dot { width: 26px; height: 26px; border-radius: 50%; border: 0; flex: none; cursor: pointer; display: grid; place-items: center; color: #fff; background: var(--dot); box-shadow: 0 4px 10px -4px var(--dot); transition: transform .2s var(--pop), opacity .2s; padding: 0; }
.t-graph .fn-dot:hover { transform: scale(1.12); }
.t-graph .fn-dot[aria-pressed="false"] { background: transparent; border: 2px solid var(--dot); box-shadow: none; color: transparent; }
.t-graph .fn-dot .icon { width: 14px; height: 14px; }
.t-graph .fn-in { flex: 1; min-width: 0; font-family: var(--mono); font-size: 14px; }
.t-graph .fn-in.invalid { border-color: var(--danger); }
.t-graph .fn-err { font-size: 12px; color: var(--danger); margin: -2px 0 2px 34px; }
.t-graph .par { display: grid; grid-template-columns: 28px minmax(0, 1fr) 76px 34px; gap: 8px; align-items: center; }
.t-graph .par b { font: 650 15px var(--mono); color: var(--accent); }
.t-graph .par input[type=number] { height: 34px; padding: 0 8px; font-size: 13px; }
.t-graph .poi { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow: auto; }
.t-graph .poi li { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; font: 500 12.5px var(--mono); transition: border-color .2s, transform .2s var(--ease); }
.t-graph .poi li:hover { border-color: var(--accent); transform: translateX(3px); }
.t-graph .poi li .k { font: 600 11px var(--font); color: var(--muted); min-width: 62px; }
.t-graph .win { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 0 0 8px; }
.t-graph .win .input { height: 36px; padding: 0 8px; font-size: 13px; }
.t-graph .win label { display: grid; gap: 3px; font-size: 11.5px; color: var(--muted); }
@media (max-width: 480px) { .t-graph .win { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
`

/**
 * Parse one line typed by the user. Returns {kind: 'explicit'|'vertical'|'implicit', exprs, vars}.
 *  "x^2", "y = x^2", "f(x) = x^2"  -> explicit   (y as a function of x)
 *  "x = 3"                           -> vertical line
 *  "x^2 + y^2 = 25"                  -> implicit curve
 */
export function parseRelation(src, angle = 'rad') {
  const s = String(src).trim()
  if (!s) return null
  const parts = s.split('=')
  if (parts.length > 2) throw new ExprError('Use only one "=" sign')
  const c = (e) => compile(e, { angle })
  const clean = (v) => new Set([...v])
  if (parts.length === 1) {
    const a = c(s)
    if (a.vars.has('y')) throw new ExprError('Use "=" for equations with y, e.g. x^2 + y^2 = 25')
    return { kind: 'explicit', fn: a.fn, vars: clean(a.vars) }
  }
  const [l, r] = parts.map((t) => t.trim())
  if (!l || !r) throw new ExprError('Both sides of "=" need something')
  const explicit = (e) => {
    const a = c(e)
    if (a.vars.has('y')) throw new ExprError('y can only appear once, on one side of "="')
    return { kind: 'explicit', fn: a.fn, vars: clean(a.vars) }
  }
  if (l === 'y' || /^[a-wz]\s*\(\s*x\s*\)$/i.test(l)) return explicit(r)
  if (r === 'y') return explicit(l)
  if (l === 'x') {
    const a = c(r)
    if (!a.vars.has('x') && !a.vars.has('y')) return { kind: 'vertical', fn: a.fn, vars: clean(a.vars) }
  }
  const a = c(l), b = c(r)
  const vars = new Set([...a.vars, ...b.vars])
  if (!vars.has('x') && !vars.has('y')) throw new ExprError('Add x or y to draw a graph')
  return { kind: 'implicit', fn: (sc) => a.fn(sc) - b.fn(sc), vars }
}

/** Sign-change roots of f on [a, b] sampled at n points (bisection refined). */
export function findRoots(f, a, b, n = 800) {
  const out = []
  let x0 = a, y0 = f(x0)
  for (let i = 1; i <= n; i++) {
    const x1 = a + ((b - a) * i) / n, y1 = f(x1)
    if (Number.isFinite(y0) && Number.isFinite(y1) && y0 !== y1 && ((y0 < 0 && y1 > 0) || (y0 > 0 && y1 < 0) || y1 === 0)) {
      let lo = x0, hi = x1, flo = y0
      for (let k = 0; k < 50; k++) {
        const mid = (lo + hi) / 2, fm = f(mid)
        if (!Number.isFinite(fm)) break
        if ((fm < 0) === (flo < 0) && fm !== 0) { lo = mid; flo = fm } else hi = mid
      }
      const r = (lo + hi) / 2, fr = f(r)
      const scale = Math.max(Math.abs(y0), Math.abs(y1))
      // reject jumps across asymptotes: the value at the "root" must be tiny compared with the neighbours
      if (Number.isFinite(fr) && Math.abs(fr) <= Math.max(1e-6, scale * 1e-3)) out.push(r)
    }
    x0 = x1; y0 = y1
  }
  return out.filter((r, i) => i === 0 || Math.abs(r - out[i - 1]) > (b - a) * 1e-6)
}

/** Local minima and maxima of f on [a, b]. */
export function findExtrema(f, a, b, n = 600) {
  const xs = [], ys = []
  for (let i = 0; i <= n; i++) { const x = a + ((b - a) * i) / n; xs.push(x); ys.push(f(x)) }
  const out = []
  for (let i = 1; i < n; i++) {
    const p = ys[i - 1], c = ys[i], q = ys[i + 1]
    if (![p, c, q].every(Number.isFinite)) continue
    const isMax = c > p && c >= q, isMin = c < p && c <= q
    if (!isMax && !isMin) continue
    let lo = xs[i - 1], hi = xs[i + 1]
    const sgn = isMax ? 1 : -1
    for (let k = 0; k < 60; k++) {
      const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3
      if (sgn * f(m1) < sgn * f(m2)) lo = m1; else hi = m2
    }
    const x = (lo + hi) / 2, y = f(x)
    // ignore asymptote spikes: a real extremum lies between its neighbours' values, a spike runs off to infinity
    if (Number.isFinite(y) && Math.abs(y - c) <= 1.5 * Math.max(Math.abs(p - c), Math.abs(q - c)) + 1e-12) out.push({ x, y, type: isMax ? 'max' : 'min' })
  }
  return out
}

function niceStep(rawStep) {
  const p = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const m = rawStep / p
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p
}
const fmtTick = (v, step) => {
  if (Math.abs(v) < step * 1e-9) return '0'
  if (Math.abs(v) >= 1e7 || Math.abs(v) < 1e-5) return v.toExponential(0).replace('e+', 'e')
  const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  return String(Number(v.toFixed(Math.min(dec, 10))))
}
function piLabel(k, n) {
  // k*pi/n in lowest terms
  const g = (a, b) => (b ? g(b, a % b) : Math.abs(a))
  const d = g(k, n)
  k /= d; n /= d
  if (k === 0) return '0'
  const num = Math.abs(k) === 1 ? '' : Math.abs(k)
  const sign = k < 0 ? '-' : ''
  return n === 1 ? `${sign}${num}π` : `${sign}${num}π/${n}`
}

export function mount(root) {
  toolStyle('graph', CSS)
  const q = new URLSearchParams(location.hash.split('?')[1] || '')
  const saved = load('graph:state', null)
  let fns = (q.get('f') ? q.get('f').split('|').filter(Boolean).slice(0, 8) : saved?.fns?.length ? saved.fns : ['sin(x)', 'x^2/4']).map((src, i) => ({ id: i, src, visible: true, color: COLORS[i % COLORS.length] }))
  let nextId = fns.length
  const params = { ...(saved?.params || {}) }
  const view = saved?.view && saved.view.sx > 0 ? { ...saved.view } : { cx: 0, cy: 0, sx: 60, sy: 60 }
  const st = { angle: saved?.angle || 'rad', piTicks: saved?.piTicks ?? false, showPoi: saved?.showPoi ?? true }
  let compiled = []   // per fn: {kind, fn, vars} | {error}
  let poi = []
  let trace = null    // {px, py} in css px
  let W = 600, H = 400, dpr = 1
  let raf = 0, poiTimer = 0, animId = 0

  const canvas = h('canvas', { tabindex: 0, role: 'img', 'aria-label': 'Graph. Drag to pan, scroll or pinch to zoom, arrow keys also pan.' })
  const ctx = canvas.getContext('2d')
  const box = h('div', { class: 'gp-box' }, canvas)
  const fnList = h('div', { class: 'stack tight' })
  const parBox = h('div', { class: 'stack tight' })
  const poiList = h('ul', { class: 'poi' })
  const poiTile = tile({ tint: '#10b981', title: 'Roots, crossings and peaks', icon: 'crosshair', cls: 'gp-side', i: 3 }, poiList)
  const parTile = tile({ tint: '#f59e0b', title: 'Sliders', icon: 'sliders-horizontal', cls: 'gp-side', i: 2 }, parBox)
  const winBox = h('div', { class: 'win', hidden: true })
  const hint = h('div', { class: 'gp-hint' }, 'Drag to pan, scroll or pinch to zoom')

  // ---------- coordinate helpers ----------
  const X = (x) => W / 2 + (x - view.cx) * view.sx
  const Y = (y) => H / 2 - (y - view.cy) * view.sy
  const wx = (px) => view.cx + (px - W / 2) / view.sx
  const wy = (py) => view.cy - (py - H / 2) / view.sy
  const clampView = () => { view.sx = Math.min(1e7, Math.max(0.02, view.sx)); view.sy = Math.min(1e7, Math.max(0.02, view.sy)) }

  const persist = () => save('graph:state', { fns: fns.map((f) => f.src), view, params, angle: st.angle, piTicks: st.piTicks, showPoi: st.showPoi })
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw() }) }

  // ---------- compile ----------
  function recompile() {
    compiled = fns.map((f) => {
      try { return f.src.trim() ? parseRelation(f.src, st.angle) : null } catch (e) { return { error: e instanceof ExprError ? e.message : 'Could not read that' } }
    })
    const names = new Set()
    compiled.forEach((c) => c?.vars && c.vars.forEach((v) => { if (!RESERVED.has(v)) names.add(v) }))
    for (const n of names) if (params[n] === undefined) params[n] = 1
    renderParams(names)
    renderFnErrors()
    computePoi()
    schedule()
  }
  const scopeFor = (extra) => Object.assign({ ...params }, extra)

  // ---------- drawing ----------
  const css = (name) => getComputedStyle(root).getPropertyValue(name).trim()
  function drawGrid(colors) {
    ctx.lineWidth = 1
    const targetPx = 70
    let stepX = niceStep(targetPx / view.sx), stepY = niceStep(targetPx / view.sy)
    let piStep = null
    if (st.piTicks) {
      const cands = [Math.PI / 12, Math.PI / 6, Math.PI / 4, Math.PI / 3, Math.PI / 2, Math.PI, 2 * Math.PI, 4 * Math.PI, 8 * Math.PI, 16 * Math.PI, 32 * Math.PI]
      piStep = cands.find((c) => c * view.sx >= targetPx) || cands.at(-1)
      stepX = piStep
    }
    const x0 = wx(0), x1 = wx(W), y1 = wy(0), y0 = wy(H)
    const lines = (step, min, max, horizontal) => {
      const minor = step / (piStep && horizontal === false ? 1 : 5)
      if (!(piStep && horizontal === false)) {
        ctx.strokeStyle = colors.minor
        ctx.beginPath()
        for (let v = Math.ceil(min / minor) * minor; v <= max; v += minor) {
          if (horizontal) { const py = Math.round(Y(v)) + .5; ctx.moveTo(0, py); ctx.lineTo(W, py) } else { const px = Math.round(X(v)) + .5; ctx.moveTo(px, 0); ctx.lineTo(px, H) }
        }
        ctx.stroke()
      }
      ctx.strokeStyle = colors.major
      ctx.beginPath()
      for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
        if (horizontal) { const py = Math.round(Y(v)) + .5; ctx.moveTo(0, py); ctx.lineTo(W, py) } else { const px = Math.round(X(v)) + .5; ctx.moveTo(px, 0); ctx.lineTo(px, H) }
      }
      ctx.stroke()
    }
    if (stepX * view.sx > 8 && stepY * view.sy > 8) { lines(stepX, x0, x1, false); lines(stepY, y0, y1, true) }
    // axes
    const ax = Math.min(H - 1, Math.max(0, Y(0))), ay = Math.min(W - 1, Math.max(0, X(0)))
    ctx.strokeStyle = colors.axis; ctx.lineWidth = 1.6
    ctx.beginPath(); ctx.moveTo(0, Math.round(ax) + .5); ctx.lineTo(W, Math.round(ax) + .5); ctx.moveTo(Math.round(ay) + .5, 0); ctx.lineTo(Math.round(ay) + .5, H); ctx.stroke()
    // labels
    ctx.fillStyle = colors.text; ctx.font = '11.5px ' + colors.mono
    ctx.textBaseline = 'top'; ctx.textAlign = 'center'
    const labY = ax > H - 18 ? ax - 16 : ax + 4
    for (let v = Math.ceil(x0 / stepX) * stepX; v <= x1; v += stepX) {
      if (Math.abs(v) < stepX * 1e-6) continue
      const label = piStep ? piLabel(Math.round(v / (Math.PI / 12)), 12) : fmtTick(v, stepX)
      ctx.fillText(label, X(v), labY)
    }
    ctx.textAlign = ay < 40 ? 'left' : 'right'
    ctx.textBaseline = 'middle'
    const labX = ay < 40 ? ay + 6 : ay - 6
    for (let v = Math.ceil(y0 / stepY) * stepY; v <= y1; v += stepY) {
      if (Math.abs(v) < stepY * 1e-6) continue
      ctx.fillText(fmtTick(v, stepY), labX, Y(v))
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'top'
    if (ay >= 0 && ay <= W && ax >= 0 && ax <= H) { ctx.textAlign = ay < 40 ? 'left' : 'right'; ctx.fillText('0', ay < 40 ? ay + 6 : ay - 6, labY) }
  }

  function plotExplicit(c, f) {
    const sc = scopeFor({ x: 0 })
    ctx.beginPath()
    let pen = false, prevPy = 0, prevY = 0
    for (let px = 0; px <= W; px += 1) {
      sc.x = wx(px)
      let y
      try { y = c.fn(sc) } catch { y = NaN }
      if (!Number.isFinite(y)) { pen = false; continue }
      let py = Y(y)
      if (py > H * 40) py = H * 40; else if (py < -H * 40) py = -H * 40
      if (pen && Math.abs(py - prevPy) > H * 2 && (y > 0) !== (prevY > 0)) pen = false // asymptote
      if (!pen) { ctx.moveTo(px, py); pen = true } else ctx.lineTo(px, py)
      prevPy = py; prevY = y
    }
    strokeCurve(f.color)
  }
  function plotVertical(c, f) {
    let v
    try { v = c.fn(scopeFor({})) } catch { return }
    if (!Number.isFinite(v)) return
    ctx.beginPath(); const px = X(v); ctx.moveTo(px, 0); ctx.lineTo(px, H)
    strokeCurve(f.color)
  }
  function strokeCurve(color) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    ctx.save()
    ctx.strokeStyle = color; ctx.globalAlpha = .14; ctx.lineWidth = 7; ctx.stroke()
    ctx.restore()
    ctx.strokeStyle = color; ctx.lineWidth = 2.6; ctx.stroke()
  }
  function plotImplicit(c, f) {
    const cs = W * H > 700 * 500 ? 5 : 4
    const nx = Math.ceil(W / cs) + 1, ny = Math.ceil(H / cs) + 1
    const sc = scopeFor({ x: 0, y: 0 })
    const vals = new Float64Array(nx * ny)
    for (let j = 0; j < ny; j++) {
      sc.y = wy(j * cs)
      for (let i = 0; i < nx; i++) {
        sc.x = wx(i * cs)
        let v
        try { v = c.fn(sc) } catch { v = NaN }
        vals[j * nx + i] = v
      }
    }
    ctx.beginPath()
    const lerp = (a, b, va, vb) => a + ((b - a) * (0 - va)) / (vb - va)
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = vals[j * nx + i], b = vals[j * nx + i + 1], d = vals[(j + 1) * nx + i], cc = vals[(j + 1) * nx + i + 1]
        if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(cc) && Number.isFinite(d))) continue
        const x0 = i * cs, y0 = j * cs, x1 = x0 + cs, y1 = y0 + cs
        const pts = []
        const cross = (va, vb) => (va < 0) !== (vb < 0) && Math.abs(va) < 1e7 && Math.abs(vb) < 1e7
        if (cross(a, b)) pts.push([lerp(x0, x1, a, b), y0, 'T'])
        if (cross(b, cc)) pts.push([x1, lerp(y0, y1, b, cc), 'R'])
        if (cross(d, cc)) pts.push([lerp(x0, x1, d, cc), y1, 'B'])
        if (cross(a, d)) pts.push([x0, lerp(y0, y1, a, d), 'L'])
        if (pts.length === 2) { ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]) }
        else if (pts.length === 4) {
          const center = (a + b + cc + d) / 4
          const [t, r, bt, l] = pts
          if ((center < 0) === (a < 0)) { ctx.moveTo(t[0], t[1]); ctx.lineTo(r[0], r[1]); ctx.moveTo(bt[0], bt[1]); ctx.lineTo(l[0], l[1]) }
          else { ctx.moveTo(t[0], t[1]); ctx.lineTo(l[0], l[1]); ctx.moveTo(bt[0], bt[1]); ctx.lineTo(r[0], r[1]) }
        }
      }
    }
    strokeCurve(f.color)
  }

  function draw() {
    const colors = {
      bg: css('--surface') || '#fff', minor: css('--border') || '#eee', major: css('--border-strong') || '#ccc',
      axis: css('--text-2') || '#444', text: css('--muted') || '#777', mono: css('--mono') || 'monospace',
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, W, H)
    ctx.globalAlpha = .55; drawGrid(colors); ctx.globalAlpha = 1
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip()
    fns.forEach((f, i) => {
      const c = compiled[i]
      if (!c || c.error || !f.visible) return
      if (c.kind === 'explicit') plotExplicit(c, f)
      else if (c.kind === 'vertical') plotVertical(c, f)
      else plotImplicit(c, f)
    })
    ctx.restore()
    // points of interest
    if (st.showPoi) {
      for (const p of poi) {
        const px = X(p.x), py = Y(p.y)
        if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue
        ctx.beginPath(); ctx.arc(px, py, 5.5, 0, Math.PI * 2)
        ctx.fillStyle = colors.bg; ctx.fill()
        ctx.lineWidth = 2.4; ctx.strokeStyle = p.color; ctx.stroke()
      }
    }
    if (trace) drawTrace(colors)
  }

  function drawTrace(colors) {
    const x = wx(trace.px)
    let best = null
    fns.forEach((f, i) => {
      const c = compiled[i]
      if (!c || c.error || !f.visible || c.kind !== 'explicit') return
      let y; try { y = c.fn(scopeFor({ x })) } catch { return }
      if (!Number.isFinite(y)) return
      const d = Math.abs(Y(y) - trace.py)
      if (!best || d < best.d) best = { x, y, d, color: f.color }
    })
    // snap to a point of interest when close
    for (const p of poi) if (Math.hypot(X(p.x) - trace.px, Y(p.y) - trace.py) < 12) { best = { x: p.x, y: p.y, d: 0, color: p.color, snap: p.kind }; break }
    ctx.save()
    ctx.strokeStyle = colors.minor; ctx.setLineDash([4, 4]); ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(trace.px, 0); ctx.lineTo(trace.px, H); ctx.stroke()
    ctx.restore()
    if (!best || best.d > 60) return
    const px = X(best.x), py = Y(best.y)
    ctx.beginPath(); ctx.arc(px, py, 6.5, 0, Math.PI * 2); ctx.fillStyle = best.color; ctx.fill()
    ctx.lineWidth = 2.5; ctx.strokeStyle = colors.bg; ctx.stroke()
    const label = `(${formatNum(best.x, { digits: 6 })}, ${formatNum(best.y, { digits: 6 })})${best.snap ? ' ' + best.snap : ''}`
    ctx.font = '600 12px ' + colors.mono
    const tw = ctx.measureText(label).width + 16
    let bx = px + 12, by = py - 34
    if (bx + tw > W - 4) bx = px - tw - 12
    if (by < 4) by = py + 14
    ctx.fillStyle = css('--text') || '#000'
    ctx.beginPath(); ctx.roundRect(bx, by, tw, 24, 8); ctx.fill()
    ctx.fillStyle = css('--bg') || '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
    ctx.fillText(label, bx + 8, by + 12.5)
  }

  // ---------- points of interest ----------
  function computePoi() {
    const a = wx(0), b = wx(W)
    const out = []
    const explicit = []
    fns.forEach((f, i) => { const c = compiled[i]; if (c && !c.error && f.visible && c.kind === 'explicit') explicit.push({ f, c }) })
    for (const { f, c } of explicit) {
      const fx = (x) => { try { return c.fn(scopeFor({ x })) } catch { return NaN } }
      for (const r of findRoots(fx, a, b)) out.push({ x: r, y: 0, kind: 'root', color: f.color, fn: f })
      const y0 = fx(0)
      if (Number.isFinite(y0) && a <= 0 && b >= 0) out.push({ x: 0, y: y0, kind: 'y-intercept', color: f.color, fn: f })
      for (const e of findExtrema(fx, a, b)) out.push({ x: e.x, y: e.y, kind: e.type === 'max' ? 'maximum' : 'minimum', color: f.color, fn: f })
    }
    for (let i = 0; i < explicit.length; i++) for (let j = i + 1; j < explicit.length; j++) {
      const A = explicit[i].c, B = explicit[j].c
      const d = (x) => { try { return A.fn(scopeFor({ x })) - B.fn(scopeFor({ x })) } catch { return NaN } }
      for (const r of findRoots(d, a, b)) {
        let y; try { y = A.fn(scopeFor({ x: r })) } catch { continue }
        if (Number.isFinite(y)) out.push({ x: r, y, kind: 'intersection', color: '#64748b', fn: explicit[i].f })
      }
    }
    const tolX = (b - a) * 1e-9, tolY = (wy(0) - wy(H)) * 1e-9
    for (const p of out) { if (Math.abs(p.x) < tolX) p.x = 0; if (Math.abs(p.y) < tolY) p.y = 0 }
    poi = out.slice(0, 80)
    renderPoi()
  }
  function renderPoi() {
    clear(poiList)
    if (!poi.length) { poiList.append(h('li', { style: 'cursor:default;color:var(--muted);font-family:var(--font)' }, 'Nothing in view yet. Zoom or pan, or add functions that cross the axis.')); return }
    const order = { root: 0, intersection: 1, 'y-intercept': 2, maximum: 3, minimum: 3 }
    ;[...poi].sort((p, q) => order[p.kind] - order[q.kind] || p.x - q.x).slice(0, 40).forEach((p) => {
      poiList.append(h('li', { tabindex: 0, role: 'button', onclick: () => centerOn(p), onkeydown: (e) => e.key === 'Enter' && centerOn(p) },
        h('span', { style: `width:10px;height:10px;border-radius:50%;background:${p.color};flex:none` }), h('span', { class: 'k' }, p.kind),
        h('span', `(${formatNum(p.x, { digits: 6 })}, ${formatNum(p.y, { digits: 6 })})`)))
    })
  }
  function centerOn(p) {
    const from = { cx: view.cx, cy: view.cy }
    const t0 = performance.now()
    const step = (t) => {
      const k = reduceMotion() ? 1 : Math.min(1, (t - t0) / 350), e = 1 - Math.pow(1 - k, 3)
      view.cx = from.cx + (p.x - from.cx) * e; view.cy = from.cy + (p.y - from.cy) * e
      draw()
      if (k < 1) requestAnimationFrame(step); else { trace = { px: X(p.x), py: Y(p.y) }; viewChanged(); draw() }
    }
    requestAnimationFrame(step)
  }

  // ---------- view changes ----------
  function viewChanged() {
    clearTimeout(poiTimer)
    poiTimer = setTimeout(() => { computePoi(); schedule(); persist(); syncWindow() }, 160)
    schedule()
  }
  function zoomAt(px, py, k, kx = k, ky = k) {
    const x = wx(px), y = wy(py)
    view.sx *= kx; view.sy *= ky
    clampView()
    view.cx = x - (px - W / 2) / view.sx
    view.cy = y + (py - H / 2) / view.sy
    viewChanged()
  }
  function resetView() { Object.assign(view, { cx: 0, cy: 0, sx: 60, sy: 60 }); viewChanged() }

  // pointer interaction
  const ptrs = new Map()
  let moved = 0
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId)
    ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY })
    moved = 0
    hint.style.opacity = '0'
  })
  canvas.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId)
    if (!p) { if (e.pointerType === 'mouse') { trace = { px: e.offsetX, py: e.offsetY }; schedule() } return }
    const nx = e.offsetX, ny = e.offsetY
    if (ptrs.size === 1) {
      view.cx -= (nx - p.x) / view.sx; view.cy += (ny - p.y) / view.sy
      moved += Math.abs(nx - p.x) + Math.abs(ny - p.y)
      trace = e.pointerType === 'mouse' ? { px: nx, py: ny } : null
    } else if (ptrs.size === 2) {
      const other = [...ptrs.entries()].find(([id]) => id !== e.pointerId)[1]
      const d0 = Math.hypot(p.x - other.x, p.y - other.y), d1 = Math.hypot(nx - other.x, ny - other.y)
      const mx0 = (p.x + other.x) / 2, my0 = (p.y + other.y) / 2, mx1 = (nx + other.x) / 2, my1 = (ny + other.y) / 2
      view.cx -= (mx1 - mx0) / view.sx; view.cy += (my1 - my0) / view.sy
      if (d0 > 8 && d1 > 8) zoomAt(mx1, my1, d1 / d0)
      moved += 20
    }
    p.x = nx; p.y = ny
    viewChanged()
  })
  const up = (e) => {
    const was = ptrs.get(e.pointerId)
    ptrs.delete(e.pointerId)
    if (was && moved < 6 && ptrs.size === 0 && e.type === 'pointerup' && e.pointerType !== 'mouse') { trace = { px: e.offsetX, py: e.offsetY }; schedule() }
  }
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointercancel', up)
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !ptrs.size) { trace = null; schedule() } })
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault()
    const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016))
    if (e.shiftKey) zoomAt(e.offsetX, e.offsetY, 1, k, 1); else zoomAt(e.offsetX, e.offsetY, k)
  }, { passive: false })
  canvas.addEventListener('dblclick', (e) => zoomAt(e.offsetX, e.offsetY, 2))
  canvas.addEventListener('keydown', (e) => {
    const stepPx = 40
    const m = { ArrowLeft: [-stepPx, 0], ArrowRight: [stepPx, 0], ArrowUp: [0, -stepPx], ArrowDown: [0, stepPx] }[e.key]
    if (m) { e.preventDefault(); view.cx += m[0] / view.sx; view.cy -= m[1] / view.sy; viewChanged() }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(W / 2, H / 2, 1.25) }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAt(W / 2, H / 2, 0.8) }
    else if (e.key === '0') { e.preventDefault(); resetView() }
  })

  const ro = new ResizeObserver(() => {
    const r = box.getBoundingClientRect()
    if (!r.width) return
    dpr = Math.min(3, window.devicePixelRatio || 1)
    W = Math.round(r.width); H = Math.round(r.height)
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
    viewChanged()
  })
  ro.observe(box)
  const themeObs = new MutationObserver(schedule)
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  const mq = matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener?.('change', schedule)
  onCleanup(() => { ro.disconnect(); themeObs.disconnect(); mq.removeEventListener?.('change', schedule); cancelAnimationFrame(raf); clearTimeout(poiTimer); cancelAnimationFrame(animId) })

  // ---------- function list ----------
  function renderFns() {
    clear(fnList)
    fns.forEach((f, i) => {
      const inp = h('input', { class: ['input', 'fn-in'], type: 'text', value: f.src, placeholder: i === 0 ? 'y = sin(x)' : 'Type a function, e.g. x^2 - 3', 'aria-label': `Function ${i + 1}`, autocomplete: 'off', autocapitalize: 'off', spellcheck: false,
        oninput: (e) => { f.src = e.target.value; recompile(); persist() } })
      f.input = inp
      const dot = h('button', { type: 'button', class: 'fn-dot', style: { '--dot': f.color }, 'aria-pressed': String(f.visible), 'aria-label': `Show or hide function ${i + 1}`, title: 'Show / hide',
        onclick: () => { f.visible = !f.visible; dot.setAttribute('aria-pressed', String(f.visible)); computePoi(); schedule() } }, icon('check'))
      fnList.append(h('div', { class: 'fn-row' }, dot, inp,
        fns.length > 1 ? button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: `Remove function ${i + 1}`, onClick: () => { fns.splice(i, 1); renderFns(); recompile(); persist() } }) : null),
      h('div', { class: 'fn-err', hidden: true, 'data-err': i }))
    })
    renderFnErrors()
  }
  function renderFnErrors() {
    fns.forEach((f, i) => {
      const c = compiled[i]
      const el = fnList.querySelector(`[data-err="${i}"]`)
      if (!el || !f.input) return
      const bad = !!c?.error
      f.input.classList.toggle('invalid', bad)
      el.hidden = !bad
      el.textContent = bad ? c.error : ''
    })
  }
  function addFn(src = '') {
    if (fns.length >= 8) { toast('That is the maximum of 8 graphs', 'error'); return }
    const empty = fns.find((f) => !f.src.trim())
    if (empty && src) { empty.src = src; renderFns(); recompile(); persist(); return }
    fns.push({ id: nextId++, src, visible: true, color: COLORS.find((c) => !fns.some((f) => f.color === c)) || COLORS[fns.length % COLORS.length] })
    renderFns(); recompile(); persist()
    if (!src) fns.at(-1).input?.focus()
  }

  // ---------- sliders ----------
  const playing = new Set()
  function renderParams(names) {
    parTile.hidden = names.size === 0
    const sig = [...names].sort().join(',')
    if (parBox.dataset.sig === sig) return
    parBox.dataset.sig = sig
    clear(parBox)
    for (const n of [...names].sort()) {
      const range = h('input', { type: 'range', min: -10, max: 10, step: 0.1, value: Math.max(-10, Math.min(10, params[n])), 'aria-label': `Value of ${n}` })
      const num = h('input', { class: 'input', type: 'number', step: 'any', value: params[n], 'aria-label': `${n} exact value` })
      const set = (v) => { params[n] = v; range.value = v; if (document.activeElement !== num) num.value = Number(v.toFixed(3)); computePoi(); schedule(); persist() }
      range.addEventListener('input', () => set(range.valueAsNumber))
      num.addEventListener('input', () => { if (Number.isFinite(num.valueAsNumber)) { params[n] = num.valueAsNumber; range.value = num.valueAsNumber; computePoi(); schedule(); persist() } })
      const play = button('', { icon: 'play', variant: 'ghost', size: 'sm', ariaLabel: `Animate ${n}` })
      play.addEventListener('click', () => {
        if (playing.has(n)) { playing.delete(n); play.replaceChildren(icon('play')); return }
        playing.add(n); play.replaceChildren(icon('pause'))
        let dir = 1
        const tick = () => {
          if (!playing.has(n)) return
          let v = params[n] + dir * 0.06
          if (v > 5) { v = 5; dir = -1 } else if (v < -5) { v = -5; dir = 1 }
          set(v)
          animId = requestAnimationFrame(tick)
        }
        animId = requestAnimationFrame(tick)
      })
      parBox.append(h('div', { class: 'par' }, h('b', n), range, num, play))
    }
  }

  // ---------- window panel ----------
  const winInputs = {}
  function syncWindow() {
    const v = { xmin: wx(0), xmax: wx(W), ymin: wy(H), ymax: wy(0) }
    for (const [k, el] of Object.entries(winInputs)) if (document.activeElement !== el) el.value = Number(v[k].toPrecision(5))
  }
  function applyWindow() {
    const g = (k) => winInputs[k].valueAsNumber
    const [a, b, c, d] = [g('xmin'), g('xmax'), g('ymin'), g('ymax')]
    if (![a, b, c, d].every(Number.isFinite) || a >= b || c >= d) return
    Object.assign(view, { cx: (a + b) / 2, cy: (c + d) / 2, sx: W / (b - a), sy: H / (d - c) })
    clampView(); computePoi(); schedule(); persist()
  }
  for (const [k, label] of [['xmin', 'x min'], ['xmax', 'x max'], ['ymin', 'y min'], ['ymax', 'y max']]) {
    const el = h('input', { class: 'input', type: 'number', step: 'any', 'aria-label': label, oninput: applyWindow })
    winInputs[k] = el
    winBox.append(h('label', label, el))
  }

  // ---------- toolbar ----------
  const angleSeg = segmented([['rad', 'rad'], ['deg', 'deg']], st.angle, (v) => { st.angle = v; recompile(); persist() }, 'Angle unit')
  const piToggle = toggle('π ticks', st.piTicks, (v) => { st.piTicks = v; schedule(); persist() })
  const poiToggle = toggle('Points', st.showPoi, (v) => { st.showPoi = v; schedule(); persist() })
  const toolbar = h('div', { class: 'gp-bar' }, angleSeg, piToggle, poiToggle, h('span', { class: 'sp' }),
    button('Window', { icon: 'maximize', variant: 'ghost', size: 'sm', onClick: () => { winBox.hidden = !winBox.hidden; syncWindow() } }),
    button('Trig view', { icon: 'activity', variant: 'ghost', size: 'sm', onClick: () => { st.piTicks = true; piToggle.input.checked = true; const a = -2 * Math.PI, b = 2 * Math.PI; Object.assign(view, { cx: 0, cy: 0, sx: W / (b - a) , sy: H / 5 }); viewChanged() } }),
    button('PNG', { icon: 'image-down', variant: 'secondary', size: 'sm', onClick: () => canvas.toBlob((b) => b && download(b, 'graph.png'), 'image/png') }),
    button('', { icon: 'link', variant: 'ghost', size: 'sm', ariaLabel: 'Copy a link to this graph', onClick: () => {
      const f = fns.map((x) => x.src.trim()).filter(Boolean).join('|')
      copyText(`${location.origin}${location.pathname}#/graph-plotter?f=${encodeURIComponent(f)}`)
    } }))
  const zoomCtl = h('div', { class: 'gp-zoom' },
    button('', { icon: 'plus', variant: 'secondary', size: 'sm', ariaLabel: 'Zoom in', onClick: () => zoomAt(W / 2, H / 2, 1.3) }),
    button('', { icon: 'minus', variant: 'secondary', size: 'sm', ariaLabel: 'Zoom out', onClick: () => zoomAt(W / 2, H / 2, 1 / 1.3) }),
    button('', { icon: 'locate-fixed', variant: 'secondary', size: 'sm', ariaLabel: 'Reset view', onClick: resetView }))
  box.append(zoomCtl, hint)
  setTimeout(() => { hint.style.opacity = '0' }, 6000)

  const presets = h('div', { class: 'stu-chips' }, PRESETS.map(([label, src]) => h('button', { type: 'button', class: 'stu-chip-btn', onclick: () => addFn(src) }, label)))
  const fnTile = tile({ tint: '#6366f1', title: 'Functions', icon: 'chart-spline', cls: 'gp-side', i: 1, actions: button('Add', { icon: 'plus', size: 'sm', variant: 'secondary', onClick: () => addFn('') }) },
    fnList, h('div', { class: 'stu-hint', style: 'margin:10px 0 8px' }, 'Try ', h('code', 'y = x^2'), ', ', h('code', 'x = 3'), ' or ', h('code', 'x^2 + y^2 = 25'), '. Letters like a, b are turned into sliders.'), presets)

  renderFns()
  recompile()
  root.append(stage('t-graph',
    h('div', { class: 'gp-wrap' }, fnTile,
      tile({ tint: '#ec4899', cls: 'gp-canvas-tile', i: 0 }, toolbar, winBox, box,
        h('div', { class: 'row', style: 'margin-top:8px' }, pill('Hover or tap the curve to read values', '', 'mouse-pointer-2'), pill('Double-click to zoom in', '', 'zoom-in'))),
      parTile, poiTile)))
}
