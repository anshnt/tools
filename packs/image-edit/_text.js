// Text layer model and canvas drawing shared by Add text to image and Watermark. All sizes are fractions of the image width,
// so a layer looks the same on the small live preview and on the full-size export.
import { canvas } from '../../lib/image.js'

export const FONTS = [
  ['Geist, system-ui, sans-serif', 'Geist'], ['Arial, Helvetica, sans-serif', 'Arial'], ['Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif', 'Impact'],
  ['Georgia, "Times New Roman", serif', 'Georgia'], ['"Times New Roman", Times, serif', 'Times'], ['Verdana, Geneva, sans-serif', 'Verdana'],
  ['"Trebuchet MS", Helvetica, sans-serif', 'Trebuchet'], ['"Courier New", Courier, monospace', 'Courier'], ['"Brush Script MT", "Segoe Script", cursive', 'Script'],
  ['"Comic Sans MS", "Comic Neue", cursive', 'Comic'],
]

let nextId = 1
export function newLayer(over = {}) {
  return {
    id: nextId++, text: 'Your text', font: FONTS[0][0], size: 8, bold: true, italic: false, align: 'center', color: '#ffffff', opacity: 1,
    stroke: false, strokeColor: '#000000', strokeWidth: 8, shadow: true, shadowColor: '#000000', bg: false, bgColor: '#000000', bgOpacity: 0.55, rotation: 0,
    upper: false, spacing: 0, x: 0.5, y: 0.5, ...over,
  }
}

/** One-click looks. They only change styling, never the text or position. */
export const STYLES = {
  classic: { font: FONTS[0][0], bold: true, italic: false, color: '#ffffff', stroke: false, shadow: true, bg: false, upper: false, spacing: 0 },
  meme: { font: FONTS[2][0], bold: false, italic: false, color: '#ffffff', stroke: true, strokeColor: '#000000', strokeWidth: 12, shadow: false, bg: false, upper: true, spacing: 0 },
  label: { font: FONTS[0][0], bold: true, italic: false, color: '#ffffff', stroke: false, shadow: false, bg: true, bgColor: '#111827', bgOpacity: 0.8, upper: false, spacing: 0 },
  neon: { font: FONTS[1][0], bold: true, italic: false, color: '#f0abfc', stroke: false, shadow: true, shadowColor: '#d946ef', bg: false, upper: true, spacing: 0.08 },
  elegant: { font: FONTS[3][0], bold: false, italic: true, color: '#fef3c7', stroke: false, shadow: true, shadowColor: '#000000', bg: false, upper: false, spacing: 0.02 },
  stamp: { font: FONTS[7][0], bold: true, italic: false, color: '#dc2626', stroke: false, shadow: false, bg: false, upper: true, spacing: 0.1 },
}

const fontString = (l, px) => `${l.italic ? 'italic ' : ''}${l.bold ? '700' : '400'} ${px}px ${l.font}`
const hexA = (hex, a) => {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0'), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
const scratch = () => (scratch.c ??= document.createElement('canvas').getContext('2d'))

/** Measure a layer at image width W. Returns {lines, px, lh, w, h, pad} in image pixels (text block, before rotation). */
export function measureLayer(l, W) {
  const px = Math.max(4, (l.size / 100) * W)
  const ctx = scratch()
  ctx.font = fontString(l, px)
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${l.spacing * px}px`
  const text = l.upper ? l.text.toUpperCase() : l.text
  const lines = text.split('\n')
  const lh = px * 1.2
  const w = Math.max(px * 0.5, ...lines.map((s) => ctx.measureText(s).width))
  const pad = l.bg ? px * 0.35 : 0
  return { lines, px, lh, w: w + pad * 2, h: lines.length * lh + pad * 2, tw: w, pad }
}

/** Draw a layer centered on (x*W, y*H). Returns its box {cx, cy, w, h, rot} in image pixels for hit testing. */
export function drawLayer(ctx, l, W, H, { dx = 0, dy = 0, alpha = true } = {}) {
  const m = measureLayer(l, W)
  const cx = l.x * W + dx, cy = l.y * H + dy
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((l.rotation * Math.PI) / 180)
  if (alpha) ctx.globalAlpha = l.opacity
  if (l.bg) {
    ctx.fillStyle = hexA(l.bgColor, l.bgOpacity)
    ctx.beginPath()
    ctx.roundRect(-m.w / 2, -m.h / 2, m.w, m.h, m.px * 0.25)
    ctx.fill()
  }
  ctx.font = fontString(l, m.px)
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${l.spacing * m.px}px`
  ctx.textBaseline = 'middle'
  ctx.textAlign = l.align
  ctx.lineJoin = 'round'
  const ax = l.align === 'left' ? -m.tw / 2 : l.align === 'right' ? m.tw / 2 : 0
  const top = -((m.lines.length - 1) * m.lh) / 2
  if (l.shadow) { ctx.shadowColor = hexA(l.shadowColor, 0.75); ctx.shadowBlur = m.px * 0.14; ctx.shadowOffsetY = m.px * 0.05 }
  m.lines.forEach((line, i) => {
    const y = top + i * m.lh
    if (l.stroke) {
      ctx.lineWidth = m.px * (l.strokeWidth / 100) * 2
      ctx.strokeStyle = l.strokeColor
      ctx.strokeText(line, ax, y)
      ctx.shadowColor = 'transparent'
    }
    ctx.fillStyle = l.color
    ctx.fillText(line, ax, y)
    if (l.shadow && l.stroke) { ctx.shadowColor = hexA(l.shadowColor, 0.75) }
  })
  ctx.restore()
  return { cx, cy, w: m.w, h: m.h, rot: l.rotation }
}

/** Render a layer to its own transparent canvas (for watermark sprites). */
export function layerSprite(l, W) {
  const m = measureLayer(l, W)
  const extra = m.px * (l.stroke ? l.strokeWidth / 50 : 0) + (l.shadow ? m.px * 0.3 : 0) + 4
  const c = canvas(Math.ceil(m.w + extra * 2), Math.ceil(m.h + extra * 2))
  const ctx = c.getContext('2d')
  drawLayer(ctx, { ...l, x: 0, y: 0, rotation: 0, opacity: 1 }, W, W, { dx: c.width / 2, dy: c.height / 2, alpha: false })
  return c
}

/** Is image point (px, py) inside the (rotated) layer box? */
export function hitBox(box, px, py, grow = 0) {
  const a = (-box.rot * Math.PI) / 180
  const dx = px - box.cx, dy = py - box.cy
  const x = dx * Math.cos(a) - dy * Math.sin(a), y = dx * Math.sin(a) + dy * Math.cos(a)
  return Math.abs(x) <= box.w / 2 + grow && Math.abs(y) <= box.h / 2 + grow
}
