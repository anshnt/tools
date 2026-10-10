// Canvas renderer for CAD Studio. drawScene() paints the document in world space (used by the live canvas and by PNG export);
// the overlay helpers paint selection grips, snap markers and rubber-band UI in screen space.
import { TAU, bulgeArc, angle, primPoint, boxHit, emptyBox, growBox } from './_vec.js'
import { prims, bbox } from './_ent.js'
import { dimGeom } from './_dim.js'
import { LTYPES, shade } from './_doc.js'
import { hatchSegments } from './_edit.js'

const FONT = '100px Helvetica, Arial, "Helvetica Neue", sans-serif'
export const ACCENT = '#4f7cff'

/** world -> screen for a view { cx, cy, scale, w, h } */
export const toScreen = (v, p) => ({ x: (p.x - v.cx) * v.scale + v.w / 2, y: v.h / 2 - (p.y - v.cy) * v.scale })
export const toWorld = (v, x, y) => ({ x: (x - v.w / 2) / v.scale + v.cx, y: (v.h / 2 - y) / v.scale + v.cy })
export const viewBox = (v) => { const a = toWorld(v, 0, v.h), b = toWorld(v, v.w, 0); return { x0: a.x, y0: a.y, x1: b.x, y1: b.y } }

/** Add a polyline (with bulge arcs) to the current path. */
export function pathPoly(ctx, pts, closed) {
  if (!pts.length) return
  ctx.moveTo(pts[0].x, pts[0].y)
  const n = pts.length, last = closed ? n : n - 1
  for (let i = 0; i < last; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % n]
    const g = bulgeArc(p1, p2, p1.b)
    if (g) { const a1 = angle(g.c, p1); g.ccw ? ctx.arc(g.c.x, g.c.y, g.r, a1, a1 + g.sw, false) : ctx.arc(g.c.x, g.c.y, g.r, a1, a1 - g.sw, true) }
    else ctx.lineTo(p2.x, p2.y)
  }
  if (closed) ctx.closePath()
}

function pathPrim(ctx, p) {
  if (p.k === 's') { ctx.moveTo(p.a.x, p.a.y); ctx.lineTo(p.b.x, p.b.y) }
  else if (p.k === 'a') { ctx.moveTo(primPoint(p, 0).x, primPoint(p, 0).y); ctx.arc(p.c.x, p.c.y, p.r, p.a0, p.a0 + p.sw, false) }
  else { const s = primPoint(p, 0); ctx.moveTo(s.x, s.y); ctx.ellipse(p.c.x, p.c.y, Math.hypot(p.ax.x, p.ax.y), Math.hypot(p.ay.x, p.ay.y), Math.atan2(p.ax.y, p.ax.x), p.t0, p.t0 + p.sw, false) }
}

const segCache = new WeakMap()
const hatchBox = (h) => h.loops.reduce((b, l) => { for (const p of l) growBox(b, p); return b }, emptyBox())
function hatchLines(h) {
  let s = segCache.get(h)
  if (s === undefined) { s = hatchSegments(h, hatchBox(h)); segCache.set(h, s || false) }
  return s
}

export function drawText(ctx, x, y, h, str, rot, align) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rot || 0)
  ctx.scale(h / 100, -h / 100)
  ctx.font = FONT
  ctx.textAlign = align === 'c' ? 'center' : align === 'r' ? 'right' : 'left'
  ctx.textBaseline = 'alphabetic'
  String(str).split(/\r?\n/).forEach((line, i) => ctx.fillText(line, 0, i * 135))
  ctx.restore()
}

function arrow(ctx, tip, dir, L) {
  const co = Math.cos(dir), si = Math.sin(dir)
  const bx = tip.x - co * L, by = tip.y - si * L
  ctx.moveTo(tip.x, tip.y)
  ctx.lineTo(bx - si * L / 6, by + co * L / 6)
  ctx.lineTo(bx + si * L / 6, by - co * L / 6)
  ctx.closePath()
}

/**
 * Draw one entity with the current stroke/fill style already set. `s` = screen px per world unit.
 */
export function drawEntity(ctx, e, s, fillStyle) {
  switch (e.type) {
    case 'line': ctx.beginPath(); ctx.moveTo(e.x1, e.y1); ctx.lineTo(e.x2, e.y2); ctx.stroke(); break
    case 'circle': ctx.beginPath(); ctx.arc(e.cx, e.cy, e.r, 0, TAU); ctx.stroke(); break
    case 'arc': { const p = prims(e)[0]; ctx.beginPath(); ctx.arc(p.c.x, p.c.y, p.r, p.a0, p.a0 + p.sw, false); ctx.stroke(); break }
    case 'ellipse': { const p = prims(e)[0]; ctx.beginPath(); pathPrim(ctx, p); ctx.stroke(); break }
    case 'polyline': ctx.beginPath(); pathPoly(ctx, e.pts, e.closed); ctx.stroke(); break
    case 'text': {
      if (e.h * s < 2.5) { ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + e.h * 2 * Math.cos(e.rot || 0), e.y + e.h * 2 * Math.sin(e.rot || 0)); ctx.stroke(); break }
      ctx.fillStyle = ctx.strokeStyle
      drawText(ctx, e.x, e.y, e.h, e.text, e.rot, e.align)
      break
    }
    case 'dim': {
      const g = dimGeom(e)
      ctx.beginPath()
      for (const [a, b] of g.lines) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y) }
      for (const a of g.arcs) { ctx.moveTo(a.c.x + Math.cos(a.a0) * a.r, a.c.y + Math.sin(a.a0) * a.r); ctx.arc(a.c.x, a.c.y, a.r, a.a0, a.a0 + a.sw, false) }
      ctx.stroke()
      ctx.fillStyle = ctx.strokeStyle
      ctx.beginPath()
      for (const a of g.arrows) arrow(ctx, a.tip, a.dir, e.as ?? e.th)
      ctx.fill()
      for (const t of g.texts) {
        if (t.h * s < 2.5) continue
        drawText(ctx, t.x, t.y, t.h, t.str, t.rot, t.align)
      }
      break
    }
    case 'hatch': {
      ctx.beginPath()
      for (const l of e.loops) pathPoly(ctx, l, true)
      const lines = hatchLines(e)
      if (!lines) { ctx.fillStyle = fillStyle || ctx.strokeStyle; ctx.fill('evenodd'); break }
      ctx.save()
      ctx.clip('evenodd')
      ctx.beginPath()
      for (const [a, b] of lines) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y) }
      ctx.stroke()
      ctx.restore()
      break
    }
    default: break
  }
}

/** Paint the document. o: { dark, lwPx(lw) -> px, mono, selection:Set, hover, grid:{step}, ghosts:[], axes, bg, fg, ltscale } */
export function drawScene(ctx, doc, view, dpr, o = {}) {
  const { w, h, scale } = view
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  if (o.bg) { ctx.fillStyle = o.bg; ctx.fillRect(0, 0, w * dpr, h * dpr) } else ctx.clearRect(0, 0, w * dpr, h * dpr)
  if (o.grid) drawGrid(ctx, view, dpr, o)
  ctx.setTransform(dpr * scale, 0, 0, -dpr * scale, dpr * (w / 2 - view.cx * scale), dpr * (h / 2 + view.cy * scale))
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'round'
  const vb = viewBox(view)
  const pad = 2 / scale
  const lt = doc.settings.ltscale || 1
  const sel = o.selection || new Set()
  const hatches = [], rest = []
  for (const e of doc.visible()) (e.type === 'hatch' ? hatches : rest).push(e)
  const paint = (e, mode) => {
    const b = bbox(e)
    if (!boxHit(b, { x0: vb.x0 - pad, y0: vb.y0 - pad, x1: vb.x1 + pad, y1: vb.y1 + pad })) return
    const st = doc.style(e)
    const color = mode === 'sel' ? ACCENT : o.mono ? '#000000' : shade(st.color, o.dark)
    const px = Math.max(1, o.lwPx ? o.lwPx(st.lw) : 1) + (mode === 'sel' ? 0.6 : mode === 'hover' ? 0.8 : 0)
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = px / scale
    const dash = (LTYPES[st.ltype] || LTYPES.continuous).dash
    if (dash.length && mode !== 'sel') {
      const d = dash.map((x) => x * lt)
      const total = d.reduce((a, c) => a + c, 0)
      ctx.setLineDash(total * scale < 8 || d.some((x) => x * scale < 0.4) ? [] : d)
    } else ctx.setLineDash(mode === 'sel' ? [6 / scale, 3 / scale] : [])
    if (e.type === 'hatch' && !hatchLines(e) && !o.mono) { ctx.globalAlpha = 0.9 }
    drawEntity(ctx, e, scale, color)
    ctx.globalAlpha = 1
  }
  for (const e of hatches) paint(e, sel.has(e.id) ? 'sel' : 'norm')
  for (const e of rest) paint(e, sel.has(e.id) ? 'sel' : e.id === o.hover ? 'hover' : 'norm')
  ctx.setLineDash([])
  if (o.ghosts?.length) {
    ctx.globalAlpha = 0.9
    for (const e of o.ghosts) {
      ctx.strokeStyle = ACCENT
      ctx.fillStyle = ACCENT
      ctx.lineWidth = 1.4 / scale
      ctx.setLineDash([5 / scale, 3 / scale])
      drawEntity(ctx, e, scale, ACCENT)
    }
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function drawGrid(ctx, view, dpr, o) {
  const { w, h, scale } = view
  let step = o.grid.step
  if (!(step > 0)) return
  let k = 0
  while (step * scale < 9 && k < 40) step *= k++ % 2 === 0 ? 5 : 2
  const tl = toWorld(view, 0, 0), br = toWorld(view, w, h)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const major = 5
  const line = (x0, y0, x1, y1) => { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1) }
  for (const pass of [0, 1]) {
    ctx.beginPath()
    for (let i = Math.floor(tl.x / step); i * step <= br.x; i++) {
      if ((i % major === 0) !== (pass === 1)) continue
      const x = Math.round((i * step - view.cx) * scale + w / 2) + 0.5
      line(x, 0, x, h)
    }
    for (let j = Math.floor(br.y / step); j * step <= tl.y; j++) {
      if ((j % major === 0) !== (pass === 1)) continue
      const y = Math.round(h / 2 - (j * step - view.cy) * scale) + 0.5
      line(0, y, w, y)
    }
    ctx.strokeStyle = o.dark ? (pass ? 'rgba(255,255,255,.10)' : 'rgba(255,255,255,.045)') : (pass ? 'rgba(20,20,40,.11)' : 'rgba(20,20,40,.05)')
    ctx.lineWidth = 1
    ctx.stroke()
  }
  if (o.axes) {
    const o0 = toScreen(view, { x: 0, y: 0 })
    ctx.beginPath(); line(0, Math.round(o0.y) + 0.5, w, Math.round(o0.y) + 0.5)
    ctx.strokeStyle = o.dark ? 'rgba(255,110,110,.35)' : 'rgba(210,60,60,.35)'; ctx.stroke()
    ctx.beginPath(); line(Math.round(o0.x) + 0.5, 0, Math.round(o0.x) + 0.5, h)
    ctx.strokeStyle = o.dark ? 'rgba(110,220,140,.35)' : 'rgba(30,150,80,.35)'; ctx.stroke()
  }
}

// ---------- Screen-space overlays ----------
export function drawGrips(ctx, view, grips, hot) {
  ctx.setLineDash([])
  for (const g of grips) {
    const p = toScreen(view, g)
    const s = g.mid ? 5 : 6
    ctx.beginPath()
    if (g.mid) { ctx.moveTo(p.x, p.y - s); ctx.lineTo(p.x + s, p.y); ctx.lineTo(p.x, p.y + s); ctx.lineTo(p.x - s, p.y); ctx.closePath() }
    else ctx.rect(p.x - s / 2 - 0.5, p.y - s / 2 - 0.5, s + 1, s + 1)
    ctx.fillStyle = g === hot ? '#ff5d5d' : ACCENT
    ctx.fill()
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 1
    ctx.stroke()
  }
}

const SNAP_LABEL = { end: 'Endpoint', mid: 'Midpoint', cen: 'Centre', int: 'Intersection', per: 'Perpendicular', nea: 'Nearest', quad: 'Quadrant', ins: 'Insertion', grid: 'Grid' }
export function drawSnapMarker(ctx, view, snap) {
  const p = toScreen(view, snap.pt)
  const r = 6
  ctx.save()
  ctx.lineWidth = 2
  ctx.strokeStyle = '#ffb020'
  ctx.setLineDash([])
  ctx.beginPath()
  switch (snap.kind) {
    case 'end': ctx.rect(p.x - r, p.y - r, r * 2, r * 2); break
    case 'mid': ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y + r * 0.8); ctx.lineTo(p.x - r, p.y + r * 0.8); ctx.closePath(); break
    case 'cen': ctx.arc(p.x, p.y, r, 0, TAU); break
    case 'int': ctx.moveTo(p.x - r, p.y - r); ctx.lineTo(p.x + r, p.y + r); ctx.moveTo(p.x + r, p.y - r); ctx.lineTo(p.x - r, p.y + r); break
    case 'quad': ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y); ctx.closePath(); break
    case 'per': ctx.moveTo(p.x - r, p.y - r); ctx.lineTo(p.x - r, p.y + r); ctx.lineTo(p.x + r, p.y + r); ctx.moveTo(p.x - r, p.y); ctx.lineTo(p.x, p.y); ctx.lineTo(p.x, p.y + r); break
    case 'nea': ctx.moveTo(p.x - r, p.y - r); ctx.lineTo(p.x + r, p.y - r); ctx.lineTo(p.x - r, p.y + r); ctx.lineTo(p.x + r, p.y + r); ctx.closePath(); break
    default: ctx.rect(p.x - 4, p.y - 4, 8, 8)
  }
  ctx.stroke()
  const label = SNAP_LABEL[snap.kind]
  if (label && snap.kind !== 'grid') {
    ctx.font = '600 11px Geist, system-ui, sans-serif'
    const tw = ctx.measureText(label).width
    const x = Math.min(view.w - tw - 14, p.x + 12), y = Math.max(16, p.y - 12)
    ctx.fillStyle = 'rgba(20,20,28,.86)'
    ctx.beginPath(); ctx.roundRect(x - 5, y - 12, tw + 10, 18, 5); ctx.fill()
    ctx.fillStyle = '#ffd37a'
    ctx.fillText(label, x, y + 1)
  }
  ctx.restore()
}

export function drawTrack(ctx, view, a, b, label) {
  const p = toScreen(view, a), q = toScreen(view, b)
  ctx.save()
  ctx.setLineDash([2, 4])
  ctx.strokeStyle = 'rgba(79,124,255,.8)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke()
  if (label) {
    ctx.setLineDash([])
    ctx.font = '600 11px Geist, system-ui, sans-serif'
    const tw = ctx.measureText(label).width
    const x = Math.min(view.w - tw - 12, q.x + 14), y = Math.min(view.h - 10, q.y + 22)
    ctx.fillStyle = 'rgba(20,20,28,.86)'
    ctx.beginPath(); ctx.roundRect(x - 5, y - 12, tw + 10, 18, 5); ctx.fill()
    ctx.fillStyle = '#cfe0ff'
    ctx.fillText(label, x, y + 1)
  }
  ctx.restore()
}

export function drawCursor(ctx, view, p, dark, box, crosshair) {
  const s = toScreen(view, p)
  ctx.save()
  ctx.lineWidth = 1
  ctx.strokeStyle = dark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.5)'
  ctx.beginPath()
  if (crosshair) { ctx.moveTo(0, Math.round(s.y) + 0.5); ctx.lineTo(view.w, Math.round(s.y) + 0.5); ctx.moveTo(Math.round(s.x) + 0.5, 0); ctx.lineTo(Math.round(s.x) + 0.5, view.h) }
  else { ctx.moveTo(s.x - 12, s.y); ctx.lineTo(s.x + 12, s.y); ctx.moveTo(s.x, s.y - 12); ctx.lineTo(s.x, s.y + 12) }
  ctx.stroke()
  if (box) ctx.strokeRect(s.x - 4.5, s.y - 4.5, 9, 9)
  ctx.restore()
}

export function drawWindow(ctx, a, b) {
  const crossing = b.x < a.x
  ctx.save()
  ctx.setLineDash(crossing ? [5, 3] : [])
  ctx.lineWidth = 1
  ctx.strokeStyle = crossing ? '#3fbf7f' : ACCENT
  ctx.fillStyle = crossing ? 'rgba(63,191,127,.12)' : 'rgba(79,124,255,.12)'
  ctx.beginPath(); ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.fill(); ctx.stroke()
  ctx.restore()
}

/** Small UCS icon in the bottom-left corner. */
export function drawUcs(ctx, view, dark) {
  const x = 34, y = view.h - 30
  ctx.save()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = dark ? 'rgba(255,120,120,.85)' : 'rgba(210,60,60,.9)'
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 26, y); ctx.stroke()
  ctx.strokeStyle = dark ? 'rgba(120,230,150,.85)' : 'rgba(30,150,80,.9)'
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 26); ctx.stroke()
  ctx.fillStyle = dark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.5)'
  ctx.font = '600 10px Geist, system-ui, sans-serif'
  ctx.fillText('X', x + 29, y + 3); ctx.fillText('Y', x - 3, y - 29)
  ctx.restore()
}

