// QR code engine for the web pack: matrix from qrcode-generator (MIT) and our own SVG renderer
// (module shapes, eye styles, gradients, logo, caption). Used by qr-generator, url-shortener, utm-builder and others.

const QR_URL = 'https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/+esm'
let lib

/** Load qrcode-generator once and make it encode UTF-8 (its default is Latin-1). */
export function loadQrLib() {
  lib ??= import(QR_URL).then((m) => {
    const q = m.default || m
    q.stringToBytes = (s) => [...new TextEncoder().encode(s)]
    return q
  }).catch((e) => { lib = null; throw Object.assign(new Error('Could not load the QR engine. Check your connection and try again.'), { cause: e }) })
  return lib
}

/** Capacity (bytes) of a version-40 code per error correction level, byte mode. */
export const QR_MAX_BYTES = { L: 2953, M: 2331, Q: 1663, H: 1273 }

const modeFor = (s) => (/^\d+$/.test(s) ? 'Numeric' : /^[0-9A-Z $%*+\-./:]+$/.test(s) ? 'Alphanumeric' : 'Byte')

/** Build the boolean module matrix. Throws a friendly error if the text does not fit. */
export async function qrMatrix(text, ecl = 'M') {
  const qrcode = await loadQrLib()
  const qr = qrcode(0, ecl)
  qr.addData(text, modeFor(text))
  try { qr.make() } catch (e) {
    throw new Error('That is too much data for one QR code. Shorten it, or lower the error correction level.', { cause: e })
  }
  const n = qr.getModuleCount()
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)))
}

const f = (x) => +x.toFixed(3)
const inEye = (n, r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7)

function roundedRect(x, y, w, hgt, [tl, tr, br, bl]) {
  return `M${f(x + tl)} ${f(y)}H${f(x + w - tr)}${tr ? `A${tr} ${tr} 0 0 1 ${f(x + w)} ${f(y + tr)}` : ''}V${f(y + hgt - br)}${br ? `A${br} ${br} 0 0 1 ${f(x + w - br)} ${f(y + hgt)}` : ''}H${f(x + bl)}${bl ? `A${bl} ${bl} 0 0 1 ${f(x)} ${f(y + hgt - bl)}` : ''}V${f(y + tl)}${tl ? `A${tl} ${tl} 0 0 1 ${f(x + tl)} ${f(y)}` : ''}Z`
}
const circlePath = (cx, cy, r) => `M${f(cx - r)} ${f(cy)}a${r} ${r} 0 1 0 ${f(2 * r)} 0a${r} ${r} 0 1 0 ${f(-2 * r)} 0Z`

export const SHAPES = [['square', 'Square'], ['rounded', 'Rounded'], ['dots', 'Dots'], ['classy', 'Classy']]
export const EYE_FRAMES = [['square', 'Square'], ['rounded', 'Rounded'], ['circle', 'Circle']]
export const EYE_BALLS = [['square', 'Square'], ['rounded', 'Rounded'], ['circle', 'Circle']]

export const escXml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))

/** Fraction of the code area a centered logo of `logoSize` (0..0.35) hides, including the cleared modules around it. */
export function logoCoverage(n, logoSize) {
  if (!logoSize) return 0
  const side = Math.min(n - 14, Math.ceil(logoSize * n + 1) | 1)
  return (side * side) / (n * n)
}

let uid = 0
/**
 * buildQr(matrix, opts) -> {svg, width, height, coverage}
 * opts: size (px, default 512), margin (modules), fg, fg2 + gradient ('none'|'diagonal'|'horizontal'|'vertical'|'radial'), bg (null = transparent),
 * shape, eyeFrame, eyeBall, eyeColor, logo (data URL), logoSize (fraction of width), caption, roundBg (bool)
 */
export function buildQr(matrix, o = {}) {
  const n = matrix.length
  const { size = 512, margin = 4, fg = '#000000', fg2 = null, gradient = 'none', bg = '#ffffff', shape = 'square', eyeFrame = 'square', eyeBall = 'square',
    eyeColor = null, logo = null, logoSize = 0.2, caption = '', roundBg = false } = o
  const gid = `qg${++uid}`
  const total = n + margin * 2
  const bandH = caption ? Math.max(3.2, n * 0.12) : 0
  const W = total, H = total + bandH
  const paint = fg2 && gradient !== 'none' ? `url(#${gid})` : fg
  const eyePaint = eyeColor || paint

  // Area cleared for the logo (module coordinates, centered).
  let clear = null
  if (logo && logoSize > 0) {
    const side = Math.min(n - 14, Math.ceil(logoSize * n + 1) | 1)
    const start = Math.floor((n - side) / 2)
    clear = { r0: start, r1: start + side, c0: start, c1: start + side, side }
  }
  const inClear = (r, c) => clear && r >= clear.r0 && r < clear.r1 && c >= clear.c0 && c < clear.c1

  const dark = (r, c) => r >= 0 && c >= 0 && r < n && c < n && matrix[r][c] && !inEye(n, r, c) && !inClear(r, c)
  let d = ''
  for (let r = 0; r < n; r++) {
    if (shape === 'square') {
      let c = 0
      while (c < n) {
        if (!dark(r, c)) { c++; continue }
        let e = c
        while (e < n && dark(r, e)) e++
        d += `M${margin + c} ${margin + r}h${e - c}v1h${c - e}Z`
        c = e
      }
      continue
    }
    for (let c = 0; c < n; c++) {
      if (!dark(r, c)) continue
      const x = margin + c, y = margin + r
      if (shape === 'dots') { d += circlePath(x + 0.5, y + 0.5, 0.44); continue }
      const up = dark(r - 1, c), dn = dark(r + 1, c), lf = dark(r, c - 1), rt = dark(r, c + 1)
      if (shape === 'classy') d += roundedRect(x, y, 1, 1, [up || lf ? 0 : 0.5, 0, dn || rt ? 0 : 0.5, 0])
      else d += roundedRect(x, y, 1, 1, [!up && !lf ? 0.5 : 0, !up && !rt ? 0.5 : 0, !dn && !rt ? 0.5 : 0, !dn && !lf ? 0.5 : 0])
    }
  }

  // Finder patterns (frame ring + ball) drawn as shapes so they can be styled.
  let frames = '', balls = ''
  for (const [er, ec] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    const x = margin + ec, y = margin + er
    if (eyeFrame === 'circle') frames += circlePath(x + 3.5, y + 3.5, 3.5) + circlePath(x + 3.5, y + 3.5, 2.5)
    else if (eyeFrame === 'rounded') frames += roundedRect(x, y, 7, 7, [2, 2, 2, 2]) + roundedRect(x + 1, y + 1, 5, 5, [1.2, 1.2, 1.2, 1.2])
    else frames += `M${x} ${y}h7v7h-7ZM${x + 1} ${y + 1}h5v5h-5Z`
    if (eyeBall === 'circle') balls += circlePath(x + 3.5, y + 3.5, 1.5)
    else if (eyeBall === 'rounded') balls += roundedRect(x + 2, y + 2, 3, 3, [0.9, 0.9, 0.9, 0.9])
    else balls += `M${x + 2} ${y + 2}h3v3h-3Z`
  }

  const defs = fg2 && gradient !== 'none'
    ? (gradient === 'radial'
      ? `<radialGradient id="${gid}" gradientUnits="userSpaceOnUse" cx="${W / 2}" cy="${total / 2}" r="${total * 0.72}"><stop offset="0" stop-color="${fg}"/><stop offset="1" stop-color="${fg2}"/></radialGradient>`
      : `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${gradient === 'vertical' ? 0 : total}" y2="${gradient === 'horizontal' ? 0 : total}"><stop offset="0" stop-color="${fg}"/><stop offset="1" stop-color="${fg2}"/></linearGradient>`)
    : ''

  const stroke = shape === 'dots' ? '' : ` stroke="${paint}" stroke-width=".04" stroke-linejoin="round"`
  let body = ''
  if (bg) body += `<rect width="${W}" height="${H}"${roundBg ? ` rx="${f(total * 0.045)}"` : ''} fill="${escXml(bg)}"/>`
  body += `<path d="${d}" fill="${paint}"${stroke}/>`
  body += `<path d="${frames}" fill="${eyePaint}" fill-rule="evenodd"/><path d="${balls}" fill="${eyePaint}"/>`

  let coverage = 0
  if (clear) {
    const pad = 0.35
    const lx = margin + clear.c0, ly = margin + clear.r0
    coverage = (clear.side * clear.side) / (n * n)
    if (bg) body += `<rect x="${f(lx - pad)}" y="${f(ly - pad)}" width="${f(clear.side + pad * 2)}" height="${f(clear.side + pad * 2)}" rx="${f(clear.side * 0.18)}" fill="${escXml(bg)}"/>`
    const inner = clear.side - 0.8
    body += `<image href="${escXml(logo)}" x="${f(lx + 0.4)}" y="${f(ly + 0.4)}" width="${f(inner)}" height="${f(inner)}" preserveAspectRatio="xMidYMid meet"/>`
  }
  if (caption) {
    const chars = [...caption].length
    const fs = Math.min(bandH * 0.52, (W * 0.88) / (chars * 0.6))
    body += `<text x="${f(W / 2)}" y="${f(total + bandH * 0.55 + fs * 0.1)}" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-weight="600" font-size="${f(fs)}" fill="${eyePaint === paint ? paint : eyePaint}">${escXml(caption)}</text>`
  }

  const px = Math.round(size)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(W)} ${f(H)}" width="${px}" height="${Math.round((px * H) / W)}" role="img" aria-label="QR code">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`
  return { svg, width: px, height: Math.round((px * H) / W), coverage, modules: n }
}

/** Rasterize an SVG string to a canvas of the given pixel width. */
export async function svgToCanvas(svg, widthPx, heightPx) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const c = document.createElement('canvas')
    c.width = Math.round(widthPx)
    c.height = Math.round(heightPx)
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0, c.width, c.height)
    return c
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function qrPng(matrix, opts, px = 1024) {
  const { svg, width, height } = buildQr(matrix, { ...opts, size: px })
  const c = await svgToCanvas(svg, width, height)
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not create the PNG.'))), 'image/png'))
}

/** WCAG-style contrast ratio between two hex colors (1..21). */
export function contrast(a, b) {
  const lum = (hex) => {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex)
    if (!m) return 0
    let s = m[1]
    if (s.length === 3) s = [...s].map((x) => x + x).join('')
    const [r, g, bl] = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [x, y] = [lum(a), lum(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** Read an image file and shrink it to a small data URL for embedding as a QR logo. */
export async function logoDataUrl(file, max = 256) {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const s = Math.min(1, max / Math.max(img.naturalWidth || max, img.naturalHeight || max))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round((img.naturalWidth || max) * s))
    c.height = Math.max(1, Math.round((img.naturalHeight || max) * s))
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/png')
  } catch (e) {
    throw new Error('Could not read that image. Use a PNG, JPG, WebP or SVG logo.', { cause: e })
  } finally {
    URL.revokeObjectURL(url)
  }
}
