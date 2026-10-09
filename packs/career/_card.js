// Business card renderer: six front/back designs drawn on a canvas at 300 dpi, plus vCard text. Pure drawing helpers.
import { drawQr } from './_qr.js'

export const SIZES = {
  us: { label: '3.5 x 2 in (US, India)', w: 1050, h: 600, mm: [88.9, 50.8] },
  eu: { label: '85 x 55 mm (Europe)', w: 1004, h: 650, mm: [85, 55] },
  wide: { label: '90 x 50 mm (common)', w: 1063, h: 591, mm: [90, 50] },
}
export const DESIGNS = [['minimal', 'Minimal'], ['gradient', 'Gradient'], ['split', 'Split'], ['dark', 'Midnight'], ['monogram', 'Monogram'], ['bold', 'Bold block']]
export const FONTS = {
  sans: { label: 'Sans', css: 'Geist, Inter, "Segoe UI", system-ui, Arial, sans-serif' },
  serif: { label: 'Serif', css: 'Georgia, "Times New Roman", serif' },
  mono: { label: 'Mono', css: '"Geist Mono", Consolas, "Courier New", monospace' },
}

const rgb = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex) || ['', '0d9b8a']; return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) }
const toHex = (r) => `#${r.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`
export function hslShift(hex, dh = 0, ds = 0, dl = 0) {
  let [r, g, b] = rgb(hex).map((x) => x / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h *= 60
  }
  h = (h + dh + 360) % 360; s = Math.max(0, Math.min(1, s + ds)); const L = Math.max(0, Math.min(1, l + dl))
  const c = (1 - Math.abs(2 * L - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = L - c / 2
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return toHex([(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255])
}
const alpha = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})` }
export const initials = (name) => (String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('') || 'YN').toUpperCase()

export function vcard(d) {
  const parts = String(d.name || '').trim().split(/\s+/)
  const last = parts.length > 1 ? parts.pop() : ''
  const esc = (s) => String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n')
  const L = ['BEGIN:VCARD', 'VERSION:3.0', `N:${esc(last)};${esc(parts.join(' '))};;;`, `FN:${esc(d.name || '')}`]
  if (d.company) L.push(`ORG:${esc(d.company)}`)
  if (d.title) L.push(`TITLE:${esc(d.title)}`)
  if (d.phone) L.push(`TEL;TYPE=WORK,VOICE:${esc(d.phone)}`)
  if (d.email) L.push(`EMAIL;TYPE=INTERNET:${esc(d.email)}`)
  if (d.website) L.push(`URL:${/^https?:/i.test(d.website) ? d.website : `https://${d.website}`}`)
  if (d.address) L.push(`ADR;TYPE=WORK:;;${esc(d.address)};;;;`)
  if (d.tagline) L.push(`NOTE:${esc(d.tagline)}`)
  L.push('END:VCARD')
  return L.join('\r\n')
}

function palette(design, accent) {
  const a2 = hslShift(accent, 38, 0.05, -0.04)
  return {
    minimal: { bg: '#ffffff', fg: '#16161a', muted: '#6b7280', a: accent, a2, onA: '#ffffff', qrBg: '#ffffff' },
    gradient: { bg: [accent, a2], fg: '#ffffff', muted: 'rgba(255,255,255,.82)', a: '#ffffff', a2, onA: accent, qrBg: '#ffffff' },
    split: { bg: '#ffffff', fg: '#16161a', muted: '#6b7280', a: accent, a2, onA: '#ffffff', qrBg: '#ffffff' },
    dark: { bg: '#0d0d12', fg: '#f4f4f8', muted: '#a1a1b0', a: accent, a2, onA: '#0d0d12', qrBg: '#ffffff' },
    monogram: { bg: '#faf6ef', fg: '#2a2622', muted: '#7a7268', a: accent, a2, onA: '#ffffff', qrBg: '#ffffff' },
    bold: { bg: '#ffffff', fg: '#16161a', muted: '#6b7280', a: accent, a2, onA: '#ffffff', qrBg: '#ffffff' },
  }[design]
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}
function fitText(ctx, str, x, y, { size, weight = 400, color, font, align = 'left', maxW, min = 0.6, spacing = 0 }) {
  if (!str) return 0
  let s = size
  const set = () => { ctx.font = `${weight} ${s}px ${font}`; try { ctx.letterSpacing = `${spacing}px` } catch { /* unsupported */ } }
  set()
  while (maxW && ctx.measureText(str).width > maxW && s > size * min) { s -= 1; set() }
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'
  ctx.fillText(str, x, y)
  const w = ctx.measureText(str).width
  try { ctx.letterSpacing = '0px' } catch { /* ignore */ }
  return w
}
function wrapText(ctx, str, x, y, { size, weight = 400, color, font, maxW, lh = 1.35, align = 'left', maxLines = 3 }) {
  ctx.font = `${weight} ${size}px ${font}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'
  const words = String(str).split(/\s+/); const lines = []; let cur = ''
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w } else cur = t }
  if (cur) lines.push(cur)
  lines.slice(0, maxLines).forEach((l, i) => ctx.fillText(i === maxLines - 1 && lines.length > maxLines ? `${l}...` : l, x, y + i * size * lh))
  return Math.min(lines.length, maxLines) * size * lh
}
function icon(ctx, kind, x, y, s, color) {
  ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(2, s * 0.11); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  const c = [x + s / 2, y + s / 2]
  if (kind === 'phone') { rr(ctx, x + s * 0.28, y + s * 0.06, s * 0.44, s * 0.88, s * 0.1); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x + s * 0.43, y + s * 0.8); ctx.lineTo(x + s * 0.57, y + s * 0.8); ctx.stroke() }
  else if (kind === 'mail') { rr(ctx, x + s * 0.06, y + s * 0.2, s * 0.88, s * 0.6, s * 0.08); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x + s * 0.08, y + s * 0.26); ctx.lineTo(...c); ctx.lineTo(x + s * 0.92, y + s * 0.26); ctx.stroke() }
  else if (kind === 'web') { ctx.beginPath(); ctx.arc(c[0], c[1], s * 0.42, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.ellipse(c[0], c[1], s * 0.18, s * 0.42, 0, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x + s * 0.08, c[1]); ctx.lineTo(x + s * 0.92, c[1]); ctx.stroke() }
  else { ctx.beginPath(); ctx.arc(c[0], y + s * 0.38, s * 0.28, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x + s * 0.24, y + s * 0.52); ctx.lineTo(c[0], y + s * 0.94); ctx.lineTo(x + s * 0.76, y + s * 0.52); ctx.stroke(); ctx.beginPath(); ctx.arc(c[0], y + s * 0.38, s * 0.08, 0, 7); ctx.fill() }
  ctx.restore()
}
function background(ctx, W, H, P) {
  if (Array.isArray(P.bg)) { const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, P.bg[0]); g.addColorStop(1, P.bg[1]); ctx.fillStyle = g } else ctx.fillStyle = P.bg
  ctx.fillRect(0, 0, W, H)
}
const contacts = (d) => [['phone', d.phone], ['mail', d.email], ['web', d.website], ['pin', d.address]].filter(([, v]) => v && String(v).trim())

/** Draw the front of the card. */
export function drawFront(ctx, W, H, d, o) {
  const u = H / 600, P = palette(o.design, o.accent), font = FONTS[o.font]?.css || FONTS.sans.css
  background(ctx, W, H, P)
  const list = contacts(d)
  const name = d.name || 'Your Name'
  const contactBlock = (x, y, { color = P.fg, ic = P.a, size = 23 * u, gap = 44 * u, maxW = W - x - 50 * u } = {}) => {
    list.forEach(([k, v], i) => { icon(ctx, k, x, y + i * gap - size * 0.82, size, ic); fitText(ctx, String(v), x + size * 1.55, y + i * gap, { size, color, font, maxW: maxW - size * 1.55, weight: 450 }) })
  }
  switch (o.design) {
    case 'gradient': {
      ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.beginPath(); ctx.arc(W * 0.9, H * 0.08, 210 * u, 0, 7); ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.beginPath(); ctx.arc(W * 0.78, H * 1.02, 170 * u, 0, 7); ctx.fill()
      fitText(ctx, name, 64 * u, 190 * u, { size: 66 * u, weight: 700, color: P.fg, font, maxW: W - 128 * u })
      fitText(ctx, d.title, 66 * u, 238 * u, { size: 29 * u, weight: 500, color: P.muted, font, maxW: W - 128 * u })
      fitText(ctx, d.company, 66 * u, 276 * u, { size: 24 * u, weight: 600, color: P.fg, font, maxW: W - 128 * u, spacing: 1.5 * u })
      contactBlock(66 * u, 394 * u, { color: P.fg, ic: P.fg, size: 22 * u, gap: 42 * u })
      break
    }
    case 'split': {
      const pw = W * 0.36
      ctx.fillStyle = P.a; ctx.fillRect(0, 0, pw, H)
      ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.beginPath(); ctx.arc(pw * 0.2, H * 0.1, 150 * u, 0, 7); ctx.fill()
      fitText(ctx, initials(name), pw / 2, H / 2 + 28 * u, { size: 110 * u, weight: 700, color: '#fff', font, align: 'center', maxW: pw - 40 * u })
      fitText(ctx, (d.company || '').toUpperCase(), pw / 2, H - 56 * u, { size: 19 * u, weight: 600, color: 'rgba(255,255,255,.9)', font, align: 'center', maxW: pw - 40 * u, spacing: 2 * u })
      const x = pw + 54 * u
      fitText(ctx, name, x, 150 * u, { size: 52 * u, weight: 700, color: P.fg, font, maxW: W - x - 40 * u })
      fitText(ctx, d.title, x, 194 * u, { size: 26 * u, weight: 500, color: P.a, font, maxW: W - x - 40 * u })
      ctx.fillStyle = P.a; ctx.fillRect(x, 232 * u, 56 * u, 5 * u)
      contactBlock(x, 318 * u, { size: 22 * u, gap: 46 * u, maxW: W - x - 24 * u })
      break
    }
    case 'dark': {
      const g = ctx.createRadialGradient(W * 0.95, H * 1.05, 10, W * 0.95, H * 1.05, 520 * u); g.addColorStop(0, alpha(o.accent, 0.55)); g.addColorStop(1, alpha(o.accent, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = P.a; ctx.fillRect(64 * u, 92 * u, 46 * u, 5 * u)
      fitText(ctx, name, 64 * u, 168 * u, { size: 58 * u, weight: 700, color: P.fg, font, maxW: W - 128 * u })
      fitText(ctx, d.title, 66 * u, 212 * u, { size: 27 * u, weight: 500, color: P.a, font, maxW: W - 128 * u })
      fitText(ctx, d.company, 66 * u, 250 * u, { size: 22 * u, weight: 500, color: P.muted, font, maxW: W - 128 * u })
      contactBlock(66 * u, 380 * u, { color: P.fg, ic: P.a, size: 21 * u, gap: 42 * u })
      break
    }
    case 'monogram': {
      const cx = W / 2, cy = 142 * u
      ctx.strokeStyle = P.a; ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.arc(cx, cy, 62 * u, 0, 7); ctx.stroke()
      fitText(ctx, initials(name), cx, cy + 20 * u, { size: 56 * u, weight: 600, color: P.a, font: FONTS.serif.css, align: 'center' })
      fitText(ctx, name.toUpperCase(), cx, 270 * u, { size: 38 * u, weight: 600, color: P.fg, font: FONTS.serif.css, align: 'center', maxW: W - 120 * u, spacing: 5 * u })
      fitText(ctx, [d.title, d.company].filter(Boolean).join('  ·  '), cx, 312 * u, { size: 22 * u, weight: 400, color: P.muted, font, align: 'center', maxW: W - 120 * u, spacing: 1.5 * u })
      ctx.fillStyle = P.a; ctx.fillRect(cx - 28 * u, 346 * u, 56 * u, 3 * u)
      const items = list.map(([, v]) => String(v))
      const l1 = items.slice(0, 2).join('   |   '), l2 = items.slice(2).join('   |   ')
      fitText(ctx, l1, cx, 408 * u, { size: 21 * u, color: P.fg, font, align: 'center', maxW: W - 100 * u })
      fitText(ctx, l2, cx, 446 * u, { size: 21 * u, color: P.fg, font, align: 'center', maxW: W - 100 * u })
      break
    }
    case 'bold': {
      const bh = H * 0.6
      ctx.fillStyle = P.a; ctx.fillRect(0, 0, W, bh)
      ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.arc(W * 0.92, bh * 0.2, 200 * u, 0, 7); ctx.fill()
      fitText(ctx, name, 60 * u, bh - 110 * u, { size: 76 * u, weight: 800, color: '#fff', font, maxW: W - 120 * u })
      fitText(ctx, d.title, 62 * u, bh - 62 * u, { size: 29 * u, weight: 500, color: 'rgba(255,255,255,.92)', font, maxW: W - 120 * u })
      fitText(ctx, d.company, 62 * u, bh - 24 * u, { size: 22 * u, weight: 600, color: 'rgba(255,255,255,.8)', font, maxW: W - 120 * u, spacing: 2 * u })
      const half = Math.ceil(list.length / 2)
      const col = (arr, x) => arr.forEach(([k, v], i) => { icon(ctx, k, x, bh + 56 * u + i * 44 * u - 18 * u, 21 * u, P.a); fitText(ctx, String(v), x + 34 * u, bh + 56 * u + i * 44 * u, { size: 21 * u, color: P.fg, font, weight: 450, maxW: W / 2 - 100 * u }) })
      col(list.slice(0, half), 60 * u); col(list.slice(half), W / 2 + 10 * u)
      break
    }
    default: { // minimal
      ctx.fillStyle = alpha(o.accent, 0.1); ctx.beginPath(); ctx.arc(W * 0.93, H * 0.05, 190 * u, 0, 7); ctx.fill()
      ctx.fillStyle = P.a; ctx.fillRect(0, 0, 16 * u, H)
      fitText(ctx, name, 70 * u, 168 * u, { size: 56 * u, weight: 700, color: P.fg, font, maxW: W - 130 * u })
      fitText(ctx, d.title, 72 * u, 212 * u, { size: 27 * u, weight: 500, color: P.a, font, maxW: W - 130 * u })
      fitText(ctx, d.company, 72 * u, 250 * u, { size: 22 * u, weight: 500, color: P.muted, font, maxW: W - 130 * u })
      contactBlock(72 * u, 372 * u, { size: 21 * u, gap: 42 * u })
    }
  }
}

/** Draw the back: QR tile, company and tagline. qr is a model from qrModel() or null. */
export function drawBack(ctx, W, H, d, o, qr) {
  const u = H / 600, P = palette(o.design, o.accent), font = FONTS[o.font]?.css || FONTS.sans.css
  const darkish = o.design === 'gradient' || o.design === 'dark'
  const bg = o.design === 'minimal' || o.design === 'split' || o.design === 'bold' ? { ...P, bg: P.a, fg: '#fff', muted: 'rgba(255,255,255,.85)' } : P
  background(ctx, W, H, bg)
  ctx.fillStyle = 'rgba(255,255,255,.09)'; ctx.beginPath(); ctx.arc(W * 0.05, H * 0.95, 220 * u, 0, 7); ctx.fill()
  if (o.design === 'dark') { const g = ctx.createRadialGradient(W * 0.1, H * 0.1, 10, W * 0.1, H * 0.1, 460 * u); g.addColorStop(0, alpha(o.accent, 0.5)); g.addColorStop(1, alpha(o.accent, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H) }
  const fg = bg.fg, muted = bg.muted
  if (qr) {
    const qs = 336 * u, qx = 64 * u, qy = (H - qs) / 2
    ctx.fillStyle = 'rgba(0,0,0,.18)'; rr(ctx, qx + 4 * u, qy + 8 * u, qs, qs, 26 * u); ctx.fill()
    ctx.fillStyle = '#fff'; rr(ctx, qx, qy, qs, qs, 26 * u); ctx.fill()
    drawQr(ctx, qr, qx + 14 * u, qy + 14 * u, qs - 28 * u, { fg: '#0b0b10', bg: null, margin: 1 })
    const x = qx + qs + 54 * u, mw = W - x - 50 * u
    fitText(ctx, d.company || d.name || 'Your Company', x, H / 2 - 40 * u, { size: 42 * u, weight: 700, color: fg, font, maxW: mw })
    let y = H / 2 + 6 * u
    if (d.tagline) y += wrapText(ctx, d.tagline, x, y, { size: 25 * u, color: muted, font, maxW: mw, maxLines: 3 }) + 14 * u
    fitText(ctx, o.qrKind === 'url' ? 'Scan to visit my site' : 'Scan to save my contact', x, y + 22 * u, { size: 20 * u, weight: 600, color: darkish || bg !== P ? fg : P.a, font, maxW: mw, spacing: 1 * u })
  } else {
    fitText(ctx, d.company || d.name || 'Your Company', W / 2, H / 2 - 10 * u, { size: 62 * u, weight: 700, color: fg, font, align: 'center', maxW: W - 120 * u })
    if (d.tagline) wrapText(ctx, d.tagline, W / 2, H / 2 + 44 * u, { size: 28 * u, color: muted, font, maxW: W - 200 * u, align: 'center', maxLines: 2 })
  }
}
