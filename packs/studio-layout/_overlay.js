// Editor overlays: guides, grids, frame edges, selection handles, text ports and rulers. Stateless drawing helpers.
import { UNITS, rotateAround, center, corners, aabb, unionBox, columnWidth, rad } from './_model.js'

export const ACCENT = '#5b4cf0'
export const HANDLE = 8
export const ROT_OFFSET = 26
export const PORT = 11

/** Draw per-page overlays in page coordinates (the context is already translated and scaled by zoom z). */
export function drawPageOverlay(ctx, doc, page, z, view, kind) {
  const lw = 1 / z
  ctx.save()
  ctx.lineWidth = lw
  if (doc.bleed > 0 && view.bleed) {
    ctx.strokeStyle = 'rgba(239,68,68,.75)'
    ctx.strokeRect(-doc.bleed, -doc.bleed, doc.w + 2 * doc.bleed, doc.h + 2 * doc.bleed)
  }
  if (doc.grid.showGrid && doc.grid.size * z >= 4) {
    ctx.strokeStyle = 'rgba(14,165,233,.22)'
    ctx.beginPath()
    for (let x = doc.grid.size; x < doc.w; x += doc.grid.size) { ctx.moveTo(x, 0); ctx.lineTo(x, doc.h) }
    for (let y = doc.grid.size; y < doc.h; y += doc.grid.size) { ctx.moveTo(0, y); ctx.lineTo(doc.w, y) }
    ctx.stroke()
  }
  if (doc.grid.showBaseline && doc.grid.baseline * z >= 3) {
    ctx.strokeStyle = 'rgba(236,72,153,.28)'
    ctx.beginPath()
    for (let y = doc.margins.t; y < doc.h - doc.margins.b + 0.1; y += doc.grid.baseline) { ctx.moveTo(0, y); ctx.lineTo(doc.w, y) }
    ctx.stroke()
  }
  if (view.margins) {
    const m = doc.margins
    ctx.strokeStyle = 'rgba(217,70,239,.8)'
    ctx.strokeRect(m.l, m.t, doc.w - m.l - m.r, doc.h - m.t - m.b)
    if (doc.cols > 1) {
      ctx.strokeStyle = 'rgba(139,92,246,.55)'
      const cw = columnWidth(doc)
      ctx.beginPath()
      for (let i = 0; i < doc.cols; i++) {
        const x = m.l + i * (cw + doc.gutter)
        ctx.moveTo(x, m.t); ctx.lineTo(x, doc.h - m.b)
        ctx.moveTo(x + cw, m.t); ctx.lineTo(x + cw, doc.h - m.b)
      }
      ctx.stroke()
    }
  }
  if (view.guides && kind === 'page') {
    ctx.strokeStyle = 'rgba(6,182,212,.9)'
    ctx.beginPath()
    for (const x of page.guides.v) { ctx.moveTo(x, -40); ctx.lineTo(x, doc.h + 40) }
    for (const y of page.guides.h) { ctx.moveTo(-40, y); ctx.lineTo(doc.w + 40, y) }
    ctx.stroke()
  }
  if (view.frames) {
    ctx.strokeStyle = 'rgba(91,76,240,.35)'
    for (const it of page.items) {
      if (it.type !== 'text' && it.type !== 'image') continue
      ctx.save()
      if (it.rot) { const c = center(it); ctx.translate(c.x, c.y); ctx.rotate(rad(it.rot)); ctx.translate(-c.x, -c.y) }
      ctx.strokeRect(it.x, it.y, it.w, it.h)
      ctx.restore()
    }
  }
  ctx.restore()
}

/** Handles for the current selection in screen space. `toScreen(item-space point)` maps page-local to view px. */
export function selectionGeometry(items, toScreen) {
  if (!items.length) return null
  if (items.length === 1) {
    const it = items[0]
    const c = center(it)
    const pt = (hx, hy) => toScreen(it.rot ? rotateAround({ x: c.x + (hx * it.w) / 2, y: c.y + (hy * it.h) / 2 }, c, it.rot) : { x: c.x + (hx * it.w) / 2, y: c.y + (hy * it.h) / 2 })
    const dirs = it.type === 'line' ? [[-1, 0], [1, 0]] : [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]
    const handles = dirs.map(([hx, hy]) => ({ hx, hy, ...pt(hx, hy) }))
    const top = pt(0, -1), mid = pt(0, 0)
    const ux = top.x - mid.x, uy = top.y - mid.y, len = Math.hypot(ux, uy) || 1
    const rot = it.type === 'line' ? null : { x: top.x + (ux / len) * ROT_OFFSET, y: top.y + (uy / len) * ROT_OFFSET, from: top }
    const outline = corners(it).map(toScreen)
    return { single: true, handles, rot, outline }
  }
  const b = unionBox(items)
  const dirs = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]
  const handles = dirs.map(([hx, hy]) => ({ hx, hy, ...toScreen({ x: b.x + (b.w * (hx + 1)) / 2, y: b.y + (b.h * (hy + 1)) / 2 }) }))
  const outline = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([x, y]) => toScreen({ x, y }))
  return { single: false, handles, rot: null, outline, box: b }
}

export function drawSelection(ctx, geo, locked) {
  if (!geo) return
  ctx.save()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = locked ? '#94a3b8' : ACCENT
  ctx.setLineDash(locked ? [4, 3] : [])
  ctx.beginPath()
  geo.outline.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
  ctx.closePath()
  ctx.stroke()
  ctx.setLineDash([])
  if (!locked) {
    if (geo.rot) {
      ctx.beginPath(); ctx.moveTo(geo.rot.from.x, geo.rot.from.y); ctx.lineTo(geo.rot.x, geo.rot.y); ctx.stroke()
      ctx.fillStyle = '#fff'
      ctx.beginPath(); ctx.arc(geo.rot.x, geo.rot.y, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    }
    ctx.fillStyle = '#fff'
    for (const h of geo.handles) { ctx.beginPath(); ctx.rect(h.x - HANDLE / 2, h.y - HANDLE / 2, HANDLE, HANDLE); ctx.fill(); ctx.stroke() }
  }
  ctx.restore()
}

/** In/out port positions of a text frame in screen space: on the left edge near the top and the right edge near the bottom, clear of the text. */
export function portPositions(it, toScreen) {
  const c = center(it)
  const at = (lx, ly) => toScreen(it.rot ? rotateAround({ x: lx, y: ly }, c, it.rot) : { x: lx, y: ly })
  const px = Math.hypot(at(it.x, it.y + 1).x - at(it.x, it.y).x, at(it.x, it.y + 1).y - at(it.x, it.y).y) || 1
  const d = Math.min(15 / px, it.h / 4)
  return { in: at(it.x, it.y + d), out: at(it.x + it.w, it.y + it.h - d) }
}

export function drawPort(ctx, p, state) {
  // state: 'free' | 'linked' | 'overflow'
  ctx.save()
  ctx.lineWidth = 1.5
  const s = PORT
  ctx.fillStyle = state === 'overflow' ? '#ef4444' : state === 'linked' ? ACCENT : '#fff'
  ctx.strokeStyle = state === 'overflow' ? '#ef4444' : ACCENT
  ctx.beginPath(); ctx.rect(p.x - s / 2, p.y - s / 2, s, s); ctx.fill(); ctx.stroke()
  ctx.strokeStyle = '#fff'
  if (state === 'overflow') {
    ctx.beginPath(); ctx.moveTo(p.x - 3, p.y); ctx.lineTo(p.x + 3, p.y); ctx.moveTo(p.x, p.y - 3); ctx.lineTo(p.x, p.y + 3); ctx.stroke()
  } else if (state === 'linked') {
    ctx.beginPath(); ctx.moveTo(p.x - 2, p.y - 3); ctx.lineTo(p.x + 2, p.y); ctx.lineTo(p.x - 2, p.y + 3); ctx.stroke()
  }
  ctx.restore()
}

export function drawThreadLine(ctx, a, b) {
  ctx.save()
  ctx.strokeStyle = ACCENT
  ctx.fillStyle = ACCENT
  ctx.lineWidth = 1.5
  ctx.setLineDash([5, 4])
  ctx.beginPath()
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
  ctx.moveTo(a.x, a.y)
  ctx.quadraticCurveTo(mx + (b.y - a.y) * 0.12, my - (b.x - a.x) * 0.12, b.x, b.y)
  ctx.stroke()
  ctx.setLineDash([])
  const ang = Math.atan2(b.y - a.y, b.x - a.x)
  ctx.translate(b.x, b.y); ctx.rotate(ang)
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-8, -4); ctx.lineTo(-8, 4); ctx.closePath(); ctx.fill()
  ctx.restore()
}

// ---------- Rulers ----------
const STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]
/** Draw a ruler into a canvas. axis 'h' | 'v'. origin = screen px of the current page's zero. */
export function drawRuler(canvas, axis, { origin, zoom, unit, colors, length }) {
  const dpr = window.devicePixelRatio || 1
  const thick = 20
  const w = axis === 'h' ? length : thick, h = axis === 'h' ? thick : length
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr) }
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = colors.bg
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = colors.tick
  ctx.fillStyle = colors.text
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
  ctx.lineWidth = 1
  const f = UNITS[unit].f
  const pxPerUnit = f * zoom
  const major = STEPS.find((s) => s * pxPerUnit >= 64) || STEPS[STEPS.length - 1]
  const minorDiv = major >= 1 && Number.isInteger(major / 5) ? 5 : major === 0.5 || major === 0.25 ? 5 : 10
  const minor = major / minorDiv
  const lo = Math.floor((0 - origin) / pxPerUnit / minor) * minor, hi = Math.ceil(((axis === 'h' ? w : h) - origin) / pxPerUnit / minor) * minor
  ctx.beginPath()
  for (let v = lo, n = 0; v <= hi && n < 4000; v += minor, n++) {
    const pos = Math.round(origin + v * pxPerUnit) + 0.5
    const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6
    const len = isMajor ? thick : Math.abs((v / minor) % (minorDiv / 2)) < 1e-6 && minorDiv % 2 === 0 ? 10 : 5
    if (axis === 'h') { ctx.moveTo(pos, thick); ctx.lineTo(pos, thick - len) } else { ctx.moveTo(thick, pos); ctx.lineTo(thick - len, pos) }
  }
  ctx.stroke()
  for (let v = Math.floor(lo / major) * major, n = 0; v <= hi && n < 400; v += major, n++) {
    const pos = origin + v * pxPerUnit
    const label = String(Math.round(v * 1000) / 1000)
    if (axis === 'h') ctx.fillText(label, pos + 3, 10)
    else { ctx.save(); ctx.translate(10, pos - 3); ctx.rotate(-Math.PI / 2); ctx.fillText(label, 0, 0); ctx.restore() }
  }
}

export const cursorFor = (hx, hy, rot = 0) => {
  const ang = (((Math.atan2(hy, hx) * 180) / Math.PI + rot) % 180 + 180) % 180
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'][Math.round(ang / 45)]
}
export { aabb }
