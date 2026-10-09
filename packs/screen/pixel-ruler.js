// Pixel ruler: capture a screen frame (or open an image), then measure distances, read coordinates and colors, and drop guides.
import { h, icon, button, toast, copyText, toggle, select, segmented, clear, table } from '../../lib/ui.js'
import { baseCss, injectCss, dock, sourceHero, sourceActions, loupe, pixelAt, rgbToHex, fmt, listen, isTyping, clamp } from './_shared.js'

const TOOLS = [
  { id: 'measure', label: 'Measure', icon: 'ruler', key: 'M', hint: 'Drag between two points, or click once to start and click again to finish. Hold Shift for 0, 45 or 90 degrees.' },
  { id: 'gh', label: 'Horizontal guide', icon: 'move-horizontal', key: 'H', hint: 'Click to drop a horizontal guide. Drag a guide to move it. Gaps between guides are labelled.' },
  { id: 'gv', label: 'Vertical guide', icon: 'move-vertical', key: 'V', hint: 'Click to drop a vertical guide. Drag a guide to move it. Gaps between guides are labelled.' },
]
const INK = '#7c5cff'
const GUIDE = '#ff3d81'
const SCALES = [['1', '1x (pixels)'], ['1.25', '1.25x'], ['1.5', '1.5x'], ['2', '2x (Retina)'], ['3', '3x'], ['4', '4x']]

// ---------- pure helpers (exported for tests) ----------
/** Distances between two points, in picture pixels. angle is -180..180 degrees from the +x axis, positive counter-clockwise (y up). */
export function measure(m) {
  const dx = m.x2 - m.x1, dy = m.y2 - m.y1
  return { dx: Math.abs(dx), dy: Math.abs(dy), dist: Math.hypot(dx, dy), angle: Math.round((Math.atan2(-dy, dx) * 180) / Math.PI * 10) / 10 + 0 }
}
const num = (v, d = 1) => (Number.isInteger(v) ? String(v) : (Math.round(v * 10 ** d) / 10 ** d).toString())
const diff = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])

/** Snap a point to the nearest color edge within r pixels, independently on each axis. Edge positions are pixel boundaries. */
export function snapEdge(c, x, y, r = 6, threshold = 48) {
  const ctx = c.getContext('2d', { willReadFrequently: true })
  const sy = clamp(Math.round(y), 0, c.height - 1), sx = clamp(Math.round(x), 0, c.width - 1)
  const x0 = clamp(Math.round(x) - r - 1, 0, c.width - 1), x1 = clamp(Math.round(x) + r, 0, c.width - 1)
  const y0 = clamp(Math.round(y) - r - 1, 0, c.height - 1), y1 = clamp(Math.round(y) + r, 0, c.height - 1)
  const row = ctx.getImageData(x0, sy, x1 - x0 + 1, 1).data
  const col = ctx.getImageData(sx, y0, 1, y1 - y0 + 1).data
  let bx = x, by = y, bd = r + 1
  for (let i = 1; i <= x1 - x0; i++) {
    if (diff([row[i * 4], row[i * 4 + 1], row[i * 4 + 2]], [row[(i - 1) * 4], row[(i - 1) * 4 + 1], row[(i - 1) * 4 + 2]]) >= threshold) {
      const ex = x0 + i, d = Math.abs(ex - x)
      if (d < bd) { bd = d; bx = ex }
    }
  }
  bd = r + 1
  for (let i = 1; i <= y1 - y0; i++) {
    if (diff([col[i * 4], col[i * 4 + 1], col[i * 4 + 2]], [col[(i - 1) * 4], col[(i - 1) * 4 + 1], col[(i - 1) * 4 + 2]]) >= threshold) {
      const ey = y0 + i, d = Math.abs(ey - y)
      if (d < bd) { bd = d; by = ey }
    }
  }
  return { x: bx, y: by }
}

const CSS = `
.t-pr .bar{display:flex;flex-wrap:wrap;gap:12px 16px;align-items:center}
.t-pr .bar .grow{flex:1}
.t-pr .scroll{position:relative;border-radius:var(--radius-xl);border:1px solid var(--border);overflow:auto;max-height:min(78vh,880px);background:var(--surface-2);padding:clamp(8px,2vw,18px)}
.t-pr .inner{position:relative;line-height:0;width:fit-content;max-width:100%;margin:0 auto;border-radius:4px;box-shadow:0 26px 54px -28px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.12)}
.t-pr canvas.view{display:block;touch-action:none;cursor:crosshair;max-width:100%;height:auto;border-radius:4px;outline-offset:3px}
.t-pr .lp{position:absolute;z-index:2;pointer-events:none;display:none;padding:4px;border-radius:50%;background:#fff;box-shadow:0 14px 30px -8px rgba(0,0,0,.5),0 0 0 1px rgba(0,0,0,.15)}
.t-pr .readout{display:flex;gap:6px 18px;flex-wrap:wrap;align-items:center;font-family:var(--mono);font-size:13px;min-height:28px;padding:6px 14px;border-radius:14px}
.t-pr .readout i{display:inline-block;width:14px;height:14px;border-radius:4px;vertical-align:-2px;margin-right:6px;box-shadow:0 0 0 1px var(--border-strong)}
.t-pr .readout b{color:var(--accent);font-weight:600}
.t-pr .hint{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:13px}
.t-pr .hint .icon{width:15px;height:15px;color:var(--accent);flex:none}
.t-pr .chips{display:flex;gap:8px;flex-wrap:wrap}
.t-pr .gchip{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 6px 0 11px;border-radius:999px;border:1px solid color-mix(in srgb,${GUIDE} 35%,var(--border));background:color-mix(in srgb,${GUIDE} 8%,var(--surface));font-family:var(--mono);font-size:12.5px}
.t-pr .gchip .btn{height:22px;width:22px;min-width:0}
.t-pr .scale{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted)}
.t-pr .scale .select{height:36px;min-width:130px}
`

export function mount(root) {
  baseCss()
  injectCss('pr', CSS)
  let src = null, tool = 'measure', scale = 1, zoom = 'fit', snap = true
  let ms = [], guides = [], draft = null, pending = null, drag = null, cursor = null, raf = 0

  const view = h('canvas', { class: 'view', tabindex: 0, role: 'img', 'aria-label': 'Picture to measure. Use arrow keys to move the pointer, Enter to set a point.' })
  const vctx = view.getContext('2d')
  const lp = loupe({ size: 118, cells: 11 })
  const lpBox = h('div', { class: 'lp' }, lp.el)
  const inner = h('div', { class: 'inner' }, view, lpBox)
  const scroller = h('div', { class: 'scroll' }, inner)
  const readout = h('div', { class: 'readout sc-glass' }, 'Move over the picture to see coordinates and colors.')
  const hint = h('div', { class: 'hint', 'aria-live': 'polite' }, icon('info'), h('span'))
  const editor = h('div', { class: 'stack', hidden: true })
  const heroHost = h('div')
  const listHost = h('div')
  const guideHost = h('div')
  const dimsText = h('span', { class: 'small muted sc-mono' })

  const k = () => (view.clientWidth ? view.width / view.clientWidth : 1)
  const schedule = () => { if (!raf) raf = requestAnimationFrame(paint) }
  const U = (v) => v / scale // picture px -> displayed units
  const unit = () => (scale === 1 ? 'px' : 'css px')

  // ----- drawing -----
  function pill(ctx, lines, x, y, kk, color = INK) {
    const fs = 12.5 * kk
    ctx.save()
    ctx.font = `600 ${fs}px "Geist Mono", ui-monospace, Menlo, Consolas, monospace`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14 * kk, hh = lines.length * fs * 1.3 + 8 * kk
    const px = clamp(x, w / 2 + 2 * kk, view.width - w / 2 - 2 * kk), py = clamp(y, hh / 2 + 2 * kk, view.height - hh / 2 - 2 * kk)
    ctx.fillStyle = color
    ctx.beginPath(); ctx.roundRect(px - w / 2, py - hh / 2, w, hh, 6 * kk); ctx.fill()
    ctx.lineWidth = kk; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke()
    ctx.fillStyle = '#fff'
    lines.forEach((l, i) => ctx.fillText(l, px, py - hh / 2 + 4 * kk + fs * 0.65 + i * fs * 1.3))
    ctx.restore()
  }

  function line(ctx, x1, y1, x2, y2, kk, color, dash) {
    ctx.save()
    ctx.lineCap = 'round'
    ctx.setLineDash(dash ? [6 * kk, 5 * kk] : [])
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 3.2 * kk
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
    ctx.strokeStyle = color; ctx.lineWidth = 1.5 * kk
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
    ctx.restore()
  }

  function drawMeasure(ctx, m, kk) {
    const { dx, dy, dist, angle } = measure(m)
    const diag = dx >= 1 && dy >= 1
    if (diag && dist > 30 * kk) {
      line(ctx, m.x1, m.y1, m.x2, m.y1, kk, INK + 'aa', true)
      line(ctx, m.x2, m.y1, m.x2, m.y2, kk, INK + 'aa', true)
    }
    line(ctx, m.x1, m.y1, m.x2, m.y2, kk, INK)
    // end caps perpendicular to the line
    const a = Math.atan2(m.y2 - m.y1, m.x2 - m.x1), cap = 6 * kk
    for (const [x, y] of [[m.x1, m.y1], [m.x2, m.y2]]) {
      line(ctx, x - Math.sin(a) * cap, y + Math.cos(a) * cap, x + Math.sin(a) * cap, y - Math.cos(a) * cap, kk, INK)
    }
    const label = diag ? [`${num(U(dist))} ${unit()}`, `${num(U(dx))} × ${num(U(dy))}  ${num(angle)}°`] : [`${num(U(dist))} ${unit()}`]
    const off = 22 * kk
    const nx = -Math.sin(a), ny = Math.cos(a)
    pill(ctx, label, (m.x1 + m.x2) / 2 + nx * off * (ny < 0 ? 1 : -1), (m.y1 + m.y2) / 2 + ny * off * (ny < 0 ? 1 : -1), kk)
  }

  function paint() {
    raf = 0
    if (!src) return
    const kk = k()
    vctx.clearRect(0, 0, view.width, view.height)
    vctx.drawImage(src, 0, 0)
    // guides and gaps between them
    for (const axis of ['h', 'v']) {
      const gs = guides.filter((g) => g.axis === axis).map((g) => g.pos).sort((a, b) => a - b)
      for (const pos of gs) {
        if (axis === 'h') line(vctx, 0, pos, view.width, pos, kk, GUIDE, true); else line(vctx, pos, 0, pos, view.height, kk, GUIDE, true)
      }
      for (const pos of gs) pill(vctx, [`${axis === 'h' ? 'y' : 'x'} ${num(U(pos))}`], axis === 'h' ? 34 * kk : pos, axis === 'h' ? pos : 12 * kk + 8 * kk, kk, GUIDE)
      for (let i = 1; i < gs.length; i++) {
        const gap = gs[i] - gs[i - 1]
        if (gap < 1) continue
        const mid = (gs[i] + gs[i - 1]) / 2
        pill(vctx, [`${num(U(gap))} ${unit()}`], axis === 'h' ? view.width - 48 * kk : mid, axis === 'h' ? mid : view.height - 20 * kk, kk, '#0f172a')
      }
    }
    for (const m of ms) drawMeasure(vctx, m, kk)
    if (draft) drawMeasure(vctx, draft, kk)
    if (cursor && !drag) {
      vctx.save()
      vctx.globalCompositeOperation = 'difference'
      vctx.strokeStyle = '#fff'; vctx.lineWidth = kk
      vctx.beginPath(); vctx.moveTo(cursor.x, 0); vctx.lineTo(cursor.x, view.height); vctx.moveTo(0, cursor.y); vctx.lineTo(view.width, cursor.y); vctx.stroke()
      vctx.restore()
    }
    if (pending && !draft) {
      vctx.save(); vctx.fillStyle = INK; vctx.strokeStyle = '#fff'; vctx.lineWidth = 1.5 * kk
      vctx.beginPath(); vctx.arc(pending.x, pending.y, 4.5 * kk, 0, Math.PI * 2); vctx.fill(); vctx.stroke(); vctx.restore()
    }
  }

  // ----- pointer helpers -----
  function ptr(e) {
    const r = view.getBoundingClientRect()
    const fx = ((e.clientX - r.left) / r.width) * view.width, fy = ((e.clientY - r.top) / r.height) * view.height
    return { fx, fy, px: clamp(Math.floor(fx), 0, view.width - 1), py: clamp(Math.floor(fy), 0, view.height - 1), cx: e.clientX, cy: e.clientY }
  }
  const edgeOf = (p, shift) => {
    let x = clamp(Math.round(p.fx), 0, view.width), y = clamp(Math.round(p.fy), 0, view.height)
    if (snap && !shift) ({ x, y } = snapEdge(src, x, y, Math.max(3, Math.round(7 * k()))))
    return { x, y }
  }

  function showReadout(p, extra) {
    const px = pixelAt(src, p.px, p.py)
    const hex = px ? rgbToHex(px) : ''
    const parts = [h('span', h('i', { style: { background: hex || 'transparent' } }), hex), h('span', `x ${num(U(p.px))}  y ${num(U(p.py))}`)]
    if (extra) parts.push(extra)
    else if (px) parts.push(h('span', { class: 'muted' }, fmt.rgb(px)))
    clear(readout, parts)
  }
  function moveLoupe(p) {
    lp.update(src, p.px, p.py)
    const r = inner.getBoundingClientRect()
    lpBox.style.display = 'block'
    lpBox.style.left = `${clamp(p.cx - r.left - 63, 0, Math.max(0, r.width - 126))}px`
    lpBox.style.top = `${p.cy - r.top < 170 ? p.cy - r.top + 28 : p.cy - r.top - 150}px`
  }
  const measureText = (m) => {
    const d = measure(m)
    return h('span', h('b', `${num(U(d.dist))} ${unit()}`), `   Δx ${num(U(d.dx))}   Δy ${num(U(d.dy))}   ${num(d.angle)}°`)
  }
  const guideAt = (p) => {
    const tol = 8 * k()
    return guides.find((g) => (g.axis === 'h' ? Math.abs(p.fy - g.pos) : Math.abs(p.fx - g.pos)) <= tol)
  }

  view.addEventListener('pointermove', (e) => {
    if (!src) return
    const p = ptr(e)
    cursor = { x: p.fx, y: p.fy }
    moveLoupe(p)
    if (drag?.kind === 'guide') {
      drag.g.pos = clamp(Math.round(drag.g.axis === 'h' ? p.fy : p.fx), 0, drag.g.axis === 'h' ? view.height : view.width)
      showReadout(p, h('span', h('b', `${drag.g.axis === 'h' ? 'y' : 'x'} ${num(U(drag.g.pos))}`)))
    } else if (drag?.kind === 'measure' || pending) {
      const s = drag?.start || pending
      let { x, y } = edgeOf(p, e.shiftKey)
      if (e.shiftKey) {
        const ang = Math.round(Math.atan2(p.fy - s.y, p.fx - s.x) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(p.fx - s.x, p.fy - s.y)
        x = Math.round(s.x + Math.cos(ang) * len); y = Math.round(s.y + Math.sin(ang) * len)
      }
      draft = { x1: s.x, y1: s.y, x2: x, y2: y }
      showReadout(p, measureText(draft))
    } else {
      showReadout(p)
      if (tool !== 'measure') view.style.cursor = guideAt(p) ? (guideAt(p).axis === 'h' ? 'ns-resize' : 'ew-resize') : 'crosshair'
    }
    schedule()
  })
  view.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !drag) { cursor = null; lpBox.style.display = 'none'; schedule() } })

  view.addEventListener('pointerdown', (e) => {
    if (!src || e.button > 0) return
    view.setPointerCapture(e.pointerId)
    view.focus({ preventScroll: true })
    const p = ptr(e)
    if (tool === 'measure') {
      drag = { kind: 'measure', start: pending || edgeOf(p, e.shiftKey), t: performance.now(), x: e.clientX, y: e.clientY, wasPending: !!pending }
    } else {
      let g = guideAt(p)
      if (!g) { g = { axis: tool === 'gh' ? 'h' : 'v', pos: Math.round(tool === 'gh' ? p.fy : p.fx) }; guides.push(g); renderLists() }
      drag = { kind: 'guide', g }
    }
    moveLoupe(p)
  })
  view.addEventListener('pointerup', (e) => {
    if (!drag) return
    const d = drag
    drag = null
    const p = ptr(e)
    if (d.kind === 'guide') { renderLists(); showReadout(p) } else if (d.kind === 'measure') {
      const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4
      if (moved || d.wasPending) {
        let end = draft || { x1: d.start.x, y1: d.start.y, x2: d.start.x, y2: d.start.y }
        if (!moved && d.wasPending) { const q = edgeOf(p, e.shiftKey); end = { x1: d.start.x, y1: d.start.y, x2: q.x, y2: q.y } }
        if (end.x1 !== end.x2 || end.y1 !== end.y2) { ms.push(end); toast(`${num(U(measure(end).dist))} ${unit()}`, 'success', 1400) }
        pending = null
        draft = null
        renderLists()
      } else { pending = d.start; draft = null }
    }
    if (e.pointerType !== 'mouse') lpBox.style.display = 'none'
    schedule()
  })
  view.addEventListener('pointercancel', () => { drag = null; draft = null; schedule() })
  view.addEventListener('dblclick', (e) => {
    if (tool === 'measure') return
    const g = guideAt(ptr(e))
    if (g) { guides = guides.filter((x) => x !== g); renderLists(); schedule() }
  })
  view.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
    if (d) {
      e.preventDefault()
      const s = e.shiftKey ? 10 : 1
      const c = cursor || { x: view.width / 2, y: view.height / 2 }
      cursor = { x: clamp(Math.round(c.x) + d[0] * s, 0, view.width - 1), y: clamp(Math.round(c.y) + d[1] * s, 0, view.height - 1) }
      const r = view.getBoundingClientRect()
      const q = { fx: cursor.x, fy: cursor.y, px: Math.floor(cursor.x), py: Math.floor(cursor.y), cx: r.left + (cursor.x / view.width) * r.width, cy: r.top + (cursor.y / view.height) * r.height }
      moveLoupe(q); showReadout(q, pending ? measureText({ x1: pending.x, y1: pending.y, x2: Math.round(cursor.x), y2: Math.round(cursor.y) }) : null)
      if (pending) draft = { x1: pending.x, y1: pending.y, x2: Math.round(cursor.x), y2: Math.round(cursor.y) }
      schedule()
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const c = cursor || { x: view.width / 2, y: view.height / 2 }
      const q = { x: Math.round(c.x), y: Math.round(c.y) }
      if (tool !== 'measure') { guides.push({ axis: tool === 'gh' ? 'h' : 'v', pos: tool === 'gh' ? q.y : q.x }); renderLists() } else if (!pending) pending = q
      else { if (pending.x !== q.x || pending.y !== q.y) ms.push({ x1: pending.x, y1: pending.y, x2: q.x, y2: q.y }); pending = null; draft = null; renderLists() }
      schedule()
    }
  })

  // ----- lists -----
  function renderLists() {
    const rows = ms.map((m, i) => {
      const d = measure(m)
      return [String(i + 1), `${num(U(m.x1))}, ${num(U(m.y1))}`, `${num(U(m.x2))}, ${num(U(m.y2))}`, num(U(d.dx)), num(U(d.dy)), num(U(d.dist)), `${num(d.angle)}°`,
        h('span', { class: 'row', style: 'gap:2px;flex-wrap:nowrap' },
          button('', { icon: 'copy', size: 'sm', variant: 'ghost', ariaLabel: `Copy measurement ${i + 1}`, onClick: () => copyText(`${num(U(d.dx))} × ${num(U(d.dy))} ${unit()} (distance ${num(U(d.dist))} ${unit()})`) }),
          button('', { icon: 'x', size: 'sm', variant: 'ghost', ariaLabel: `Remove measurement ${i + 1}`, onClick: () => { ms.splice(i, 1); renderLists(); schedule() } }))]
    })
    clear(listHost, h('section', { class: 'panel stack' },
      h('div', { class: 'row between' }, h('h2', { style: 'margin:0' }, `Measurements${ms.length ? ` (${ms.length})` : ''}`),
        h('div', { class: 'row' },
          button('Copy all', { icon: 'copy', size: 'sm', disabled: !ms.length, onClick: () => copyText(ms.map((m, i) => { const d = measure(m); return `#${i + 1}: ${num(U(d.dx))} × ${num(U(d.dy))} ${unit()}, distance ${num(U(d.dist))} ${unit()}, angle ${num(d.angle)}°` }).join('\n')) }),
          button('Clear', { icon: 'trash-2', size: 'sm', variant: 'ghost', disabled: !ms.length && !guides.length, onClick: () => { ms = []; guides = []; pending = null; draft = null; renderLists(); schedule() } }))),
      ms.length
        ? table({ columns: ['#', 'From', 'To', { label: 'Δx', num: true }, { label: 'Δy', num: true }, { label: 'Distance', num: true }, { label: 'Angle', num: true }, ''], rows })
        : h('div', { class: 'empty' }, icon('ruler'), h('div', 'No measurements yet. Drag across the picture to measure.')),
      scale !== 1 ? h('p', { class: 'small muted' }, `Values are CSS pixels: picture pixels divided by the screenshot scale (${scale}x).`) : h('p', { class: 'small muted' }, 'Values are picture pixels. Points snap to pixel edges.')))
    const gs = guides.map((g, i) => h('span', { class: 'gchip' }, `${g.axis === 'h' ? 'y' : 'x'} ${num(U(g.pos))}`,
      button('', { icon: 'x', size: 'sm', variant: 'ghost', ariaLabel: `Remove guide ${g.axis === 'h' ? 'y' : 'x'} ${num(U(g.pos))}`, onClick: () => { guides.splice(i, 1); renderLists(); schedule() } })))
    clear(guideHost, gs.length ? h('div', { class: 'stack tight' }, h('div', { class: 'field-label' }, `Guides (${gs.length})`), h('div', { class: 'chips' }, gs)) : null)
  }

  // ----- chrome -----
  const toolDock = dock(TOOLS, tool, (id) => setTool(id), { ariaLabel: 'Ruler tools' })
  function setTool(id) {
    tool = id
    toolDock.set(id)
    pending = null; draft = null
    view.style.cursor = 'crosshair'
    hint.lastChild.textContent = TOOLS.find((t) => t.id === id).hint
    schedule()
  }
  const snapToggle = toggle('Snap to edges', snap, (v) => { snap = v })
  const scaleSel = select(SCALES, '1', (v) => { scale = Number(v); renderLists(); schedule() })
  const scaleBox = h('label', { class: 'scale' }, h('span', 'Screenshot scale'), scaleSel)
  const zoomSeg = segmented([['fit', 'Fit'], ['1', '100%'], ['2', '200%'], ['4', '400%']], zoom, (v) => { zoom = v; applyZoom() }, 'Zoom')
  function applyZoom() {
    if (!src) return
    view.style.width = zoom === 'fit' ? '' : `${src.width * Number(zoom)}px`
    view.style.maxWidth = zoom === 'fit' ? '' : 'none'
    inner.style.maxWidth = zoom === 'fit' ? '100%' : 'none'
    schedule()
  }

  function load(c, info = {}) {
    src = c
    view.width = c.width
    view.height = c.height
    ms = []; guides = []; draft = null; pending = null; drag = null; cursor = null
    const dpr = Math.round(window.devicePixelRatio * 4) / 4
    scale = info.source === 'screen' ? (SCALES.some(([v]) => Number(v) === dpr) ? dpr : 1) : 1
    scaleSel.value = String(scale)
    dimsText.textContent = `${c.width} × ${c.height} px`
    heroHost.hidden = true
    editor.hidden = false
    applyZoom()
    setTool('measure')
    renderLists()
    schedule()
    scroller.scrollTo?.(0, 0)
  }

  const actions = sourceActions({ onCanvas: (c, info) => load(c, info) })
  editor.append(
    h('div', { class: 'bar' }, toolDock, h('div', { class: 'grow' }), snapToggle),
    hint,
    scroller,
    readout,
    h('div', { class: 'bar' }, actions, dimsText, h('div', { class: 'grow' }), scaleBox, zoomSeg),
    guideHost, listHost)
  heroHost.append(sourceHero({
    title: 'Measure anything on your screen',
    text: 'Capture a window or your whole screen, then drag to measure distances in pixels, read coordinates and colors, and drop guides.',
    onCanvas: (c, info) => load(c, info), art: 'ruler',
  }))
  root.append(h('div', { class: 't-pr stack' }, heroHost, editor))
  hint.lastChild.textContent = TOOLS[0].hint

  listen(document, 'keydown', (e) => {
    if (!src || editor.hidden || isTyping(e)) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); ms.pop(); renderLists(); schedule(); return }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Escape') { pending = null; draft = null; schedule(); return }
    const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase())
    if (t) { e.preventDefault(); setTool(t.id) }
  })
  listen(window, 'resize', schedule)
  return () => cancelAnimationFrame(raf)
}
