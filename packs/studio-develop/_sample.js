// Procedural sample scenes so people can try the editor without a photo. Drawn on a canvas, nothing is downloaded.
import { toBlob } from '../../lib/image.js'

function rng(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}
/** Midpoint-displaced ridge line: array of y values across the width. */
function ridge(r, w, base, rough, steps = 9) {
  let pts = [base + (r() - 0.5) * rough, base + (r() - 0.5) * rough]
  let amp = rough
  for (let i = 0; i < steps; i++) {
    const next = []
    for (let j = 0; j < pts.length - 1; j++) { next.push(pts[j], (pts[j] + pts[j + 1]) / 2 + (r() - 0.5) * amp) }
    next.push(pts.at(-1))
    pts = next; amp *= 0.55
  }
  return pts
}
function fillRidge(ctx, pts, w, h, fill) {
  ctx.beginPath(); ctx.moveTo(0, h)
  pts.forEach((y, i) => ctx.lineTo((i / (pts.length - 1)) * w, y))
  ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = fill; ctx.fill()
}
function grainDots(ctx, r, w, h, n) {
  for (let i = 0; i < n; i++) { ctx.fillStyle = `rgba(${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},${0.03 + r() * 0.04})`; ctx.fillRect(r() * w, r() * h, 1.6, 1.6) }
}
function clouds(ctx, r, w, h, y0, y1, tint) {
  ctx.save(); ctx.filter = 'blur(14px)'
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = tint.replace('A', String(0.12 + r() * 0.22))
    ctx.beginPath(); ctx.ellipse(r() * w, y0 + r() * (y1 - y0), 90 + r() * 220, 14 + r() * 34, 0, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}

const SCENES = {
  dusk(ctx, w, h, r) {
    const hz = h * 0.58
    const sky = ctx.createLinearGradient(0, 0, 0, hz)
    sky.addColorStop(0, '#2b3a67'); sky.addColorStop(0.55, '#8f6a8f'); sky.addColorStop(0.85, '#e39a6b'); sky.addColorStop(1, '#f2c48a')
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, hz)
    const sun = ctx.createRadialGradient(w * 0.68, hz - 24, 4, w * 0.68, hz - 24, w * 0.34)
    sun.addColorStop(0, 'rgba(255,238,196,.95)'); sun.addColorStop(0.18, 'rgba(255,200,140,.55)'); sun.addColorStop(1, 'rgba(255,170,120,0)')
    ctx.fillStyle = sun; ctx.fillRect(0, 0, w, hz)
    clouds(ctx, r, w, h, hz * 0.15, hz * 0.7, 'rgba(255,222,210,A)')
    fillRidge(ctx, ridge(r, w, hz - 70, 70), w, hz, '#6a5878')
    fillRidge(ctx, ridge(r, w, hz - 30, 54), w, hz, '#44405e')
    const water = ctx.createLinearGradient(0, hz, 0, h)
    water.addColorStop(0, '#d79a78'); water.addColorStop(0.35, '#7b6d8a'); water.addColorStop(1, '#2c3552')
    ctx.fillStyle = water; ctx.fillRect(0, hz, w, h - hz)
    for (let i = 0; i < 90; i++) { ctx.fillStyle = `rgba(255,${200 + r() * 40 | 0},150,${0.05 + r() * 0.12})`; ctx.fillRect(w * 0.68 - 120 + r() * 240, hz + r() * (h - hz), 20 + r() * 90, 2) }
    fillRidge(ctx, ridge(r, w, h - 70, 60), w, h, '#1d2238')
  },
  harbour(ctx, w, h, r) {
    const hz = h * 0.55
    const sky = ctx.createLinearGradient(0, 0, 0, hz)
    sky.addColorStop(0, '#8fb5d6'); sky.addColorStop(1, '#dfe7ea')
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, hz)
    clouds(ctx, r, w, h, hz * 0.1, hz * 0.8, 'rgba(255,255,255,A)')
    const sea = ctx.createLinearGradient(0, hz, 0, h)
    sea.addColorStop(0, '#6fa0a8'); sea.addColorStop(1, '#2f5e6d')
    ctx.fillStyle = sea; ctx.fillRect(0, hz, w, h - hz)
    const cols = ['#c9503f', '#e2b04a', '#3f78a8', '#e8e2d2', '#7a9a5a', '#b9728a']
    let x = 0
    while (x < w) { const bw = 70 + r() * 90, bh = 90 + r() * 140; ctx.fillStyle = cols[r() * cols.length | 0]; ctx.fillRect(x, hz - bh, bw, bh); ctx.fillStyle = 'rgba(30,30,40,.55)'
      for (let wy = hz - bh + 16; wy < hz - 20; wy += 34) for (let wx = x + 12; wx < x + bw - 16; wx += 28) ctx.fillRect(wx, wy, 12, 18)
      x += bw + 6 }
    for (let i = 0; i < 5; i++) { const bx = 120 + i * (w / 5.4), by = hz + 60 + r() * (h - hz - 140); ctx.fillStyle = cols[i % cols.length]; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + 150, by); ctx.lineTo(bx + 120, by + 34); ctx.lineTo(bx + 24, by + 34); ctx.closePath(); ctx.fill()
      ctx.fillStyle = '#f4f0e6'; ctx.fillRect(bx + 70, by - 70, 4, 70); ctx.beginPath(); ctx.moveTo(bx + 76, by - 68); ctx.lineTo(bx + 130, by - 6); ctx.lineTo(bx + 76, by - 6); ctx.fill() }
    ctx.fillStyle = 'rgba(255,255,255,.12)'
    for (let i = 0; i < 160; i++) ctx.fillRect(r() * w, hz + r() * (h - hz), 30 + r() * 80, 1.5)
  },
  meadow(ctx, w, h, r) {
    const hz = h * 0.5
    const sky = ctx.createLinearGradient(0, 0, 0, hz)
    sky.addColorStop(0, '#4d8bd4'); sky.addColorStop(1, '#bcd8ee')
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, hz)
    clouds(ctx, r, w, h, 20, hz * 0.8, 'rgba(255,255,255,A)')
    const greens = ['#5f8a45', '#4f7a3a', '#3f6a30', '#335a28']
    greens.forEach((g, i) => fillRidge(ctx, ridge(r, w, hz + i * 70, 50 - i * 6), w, h, g))
    for (let i = 0; i < 1400; i++) {
      const y = hz + 30 + Math.pow(r(), 0.6) * (h - hz - 30), s = 1 + (y - hz) / (h - hz) * 5
      ctx.fillStyle = ['#f6e05e', '#ffffff', '#e86a8a', '#b58ae0'][r() * 4 | 0]
      ctx.beginPath(); ctx.arc(r() * w, y, s, 0, Math.PI * 2); ctx.fill()
    }
  },
}
export const SAMPLE_NAMES = { dusk: 'sample-dusk-lake.jpg', harbour: 'sample-harbour.jpg', meadow: 'sample-meadow.jpg' }

/** Draw a sample scene and return it as a JPEG File. */
export async function makeSample(kind = 'dusk', w = 1800, h = 1200) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')
  const r = rng(kind === 'dusk' ? 7 : kind === 'harbour' ? 21 : 42)
  SCENES[kind](ctx, w, h, r)
  grainDots(ctx, r, w, h, 26000)
  // gentle flat look so there is room to edit
  ctx.fillStyle = 'rgba(140,140,150,.10)'; ctx.fillRect(0, 0, w, h)
  const blob = await toBlob(c, 'image/jpeg', 0.92)
  return new File([blob], SAMPLE_NAMES[kind], { type: 'image/jpeg', lastModified: Date.now() })
}
export const SAMPLE_KINDS = Object.keys(SCENES)
