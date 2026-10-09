// Text and image stamping shared by watermark, page numbers and header/footer: one layout model for the live preview and the saved file.
// Everything is positioned in displayed points (origin top-left, rotation applied); see pageGeom/placeRect in _shared.js.
import { h } from '../../lib/ui.js'
import { pdfLib } from '../../lib/libs.js'
import { toBlob } from '../../lib/image.js'
import { hexToRgb, pageGeom, placeRect } from './_shared.js'

export const FAMILIES = {
  Helvetica: { std: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'], css: 'Helvetica, Arial, "Liberation Sans", sans-serif' },
  Times: { std: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'], css: '"Times New Roman", Times, "Liberation Serif", serif' },
  Courier: { std: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'], css: '"Courier New", Courier, "Liberation Mono", monospace' },
}
const WIN = String.fromCodePoint(0x20ac, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x17d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x17e, 0x178)
/** True when the standard PDF fonts can draw this text (Latin, WinAnsi). */
export const isWinAnsi = (s) => [...s].every((c) => { const n = c.codePointAt(0); return (n >= 32 && n <= 126) || (n >= 160 && n <= 255) || WIN.includes(c) })
const sub = (s) => s.replace(/\r?\n/g, ' ')

/** CSS font string for the canvas preview. */
export const cssFont = (o, px) => `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${px}px ${FAMILIES[o.family || 'Helvetica'].css}`

let measureCtx
/** Width of a text in points at a size (browser metrics, used only for non-Latin fallback and preview alignment). */
export function canvasWidth(text, o) {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  measureCtx.font = cssFont(o, 100)
  return measureCtx.measureText(text).width / 100 * o.size
}

/**
 * stamper(doc, {family, bold, italic}) -> {width(text, size), drawText(page, text, o), drawImage(page, img, o), finish()}
 * drawText o: {u, v, size, align: 'left'|'center'|'right', angle, opacity, color}. (u, v) is the left/center/right edge of the text's top.
 * Latin text uses the standard PDF fonts (vector, selectable). Anything else is drawn as a sharp image so every script works.
 */
export async function stamper(doc, font) {
  const { StandardFonts, rgb, degrees } = await pdfLib()
  const fam = FAMILIES[font.family || 'Helvetica']
  const std = fam.std[(font.bold ? 1 : 0) + (font.italic ? 2 : 0)]
  const pdfFont = await doc.embedFont(StandardFonts[std])
  const imgCache = new Map()

  async function textImage(text, size, color) {
    const key = `${text}|${size}|${color}`
    if (imgCache.has(key)) return imgCache.get(key)
    const k = 4
    const w = Math.ceil(canvasWidth(text, { ...font, size }) + size * 0.3)
    const hh = Math.ceil(size * 1.4)
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.round(hh * k)
    const ctx = c.getContext('2d')
    ctx.scale(k, k)
    ctx.font = cssFont({ ...font }, size)
    ctx.fillStyle = color
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(text, size * 0.15, size * 1.05)
    const emb = await doc.embedPng(await (await toBlob(c, 'image/png')).arrayBuffer())
    const r = { emb, w, h: hh }
    imgCache.set(key, r)
    return r
  }

  const api = {
    isLatin: (t) => isWinAnsi(sub(t)),
    width(text, size) { const t = sub(text); return isWinAnsi(t) ? pdfFont.widthOfTextAtSize(t, size) : canvasWidth(t, { ...font, size }) },
    async drawText(page, text, o) {
      const t = sub(text)
      if (!t) return
      const g = pageGeom(page)
      const w = api.width(t, o.size)
      const left = o.align === 'center' ? o.u - w / 2 : o.align === 'right' ? o.u - w : o.u
      const c = hexToRgb(o.color || '#000000')
      const color = rgb(c.r, c.g, c.b)
      if (isWinAnsi(t)) {
        const p = placeRect(g, left, o.v, w, o.size, o.angle || 0)
        const a = (p.rotate * Math.PI) / 180
        page.drawText(t, { x: p.x - Math.sin(a) * o.size * 0.2, y: p.y + Math.cos(a) * o.size * 0.2, size: o.size, font: pdfFont, color, opacity: o.opacity ?? 1, rotate: degrees(p.rotate) })
      } else {
        const im = await textImage(t, o.size, o.color || '#000000')
        const p = placeRect(g, left - o.size * 0.15, o.v - o.size * 0.15, im.w, im.h, o.angle || 0)
        page.drawImage(im.emb, { x: p.x, y: p.y, width: im.w, height: im.h, opacity: o.opacity ?? 1, rotate: degrees(p.rotate) })
      }
    },
    /** Draw an embedded image whose centre sits at (cx, cy). */
    drawImage(page, emb, o) {
      const g = pageGeom(page)
      const p = placeRect(g, o.cx - o.w / 2, o.cy - o.h / 2, o.w, o.h, o.angle || 0)
      page.drawImage(emb, { x: p.x, y: p.y, width: o.w, height: o.h, opacity: o.opacity ?? 1, rotate: degrees(p.rotate) })
    },
  }
  return api
}

/** Move the most recently drawn content of a page behind its existing content. */
export async function sendToBack(page) {
  const { PDFArray } = await pdfLib()
  const arr = page.node.Contents()
  if (arr instanceof PDFArray && arr.size() > 1) { const last = arr.size() - 1; const ref = arr.get(last); arr.remove(last); arr.insert(0, ref) }
}

/** Lattice of centres for tiled stamps, rotated with the stamp. Returns [{cx, cy}] in displayed points. */
export function tileCentres(pw, ph, bw, bh, { angle = 0, gapX = 0.6, gapY = 1, stagger = true } = {}) {
  const sx = bw * (1 + gapX), sy = bh * (1 + gapY)
  const a = (angle * Math.PI) / 180
  const dir = [Math.cos(a), -Math.sin(a)], down = [Math.sin(a), Math.cos(a)]
  const reach = Math.hypot(pw, ph) / 2 + Math.hypot(bw, bh)
  const nI = Math.ceil(reach / sx) + 1, nJ = Math.ceil(reach / sy) + 1
  const out = []
  for (let j = -nJ; j <= nJ; j++) {
    for (let i = -nI; i <= nI; i++) {
      const aa = i * sx + (stagger && (j & 1) ? sx / 2 : 0), bb = j * sy
      const cx = pw / 2 + aa * dir[0] + bb * down[0], cy = ph / 2 + aa * dir[1] + bb * down[1]
      const m = Math.hypot(bw, bh) / 2
      if (cx > -m && cx < pw + m && cy > -m && cy < ph + m) out.push({ cx, cy })
    }
  }
  return out
}

/** Anchor point (centre of a w x h box) for a 3x3 position name like 'tl', 'bc', 'mc'. */
export function anchorCentre(pos, pw, ph, bw, bh, margin = 24) {
  const [r, c] = [pos[0], pos[1]]
  const cx = c === 'l' ? margin + bw / 2 : c === 'r' ? pw - margin - bw / 2 : pw / 2
  const cy = r === 't' ? margin + bh / 2 : r === 'b' ? ph - margin - bh / 2 : ph / 2
  return { cx, cy }
}

/**
 * Live preview canvas on top of a stage. draw(ctx, stage) paints in displayed points (origin top-left).
 * Returns {redraw()}. Re-draws by itself when the stage renders a page.
 */
export function previewLayer(stage, draw) {
  const c = h('canvas', { style: 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none' })
  stage.layer.prepend(c)
  const redraw = () => {
    if (!stage.pw) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const wpx = Math.max(1, Math.round(stage.pw * stage.scale * dpr)), hpx = Math.max(1, Math.round(stage.ph * stage.scale * dpr))
    if (c.width !== wpx || c.height !== hpx) { c.width = wpx; c.height = hpx }
    const ctx = c.getContext('2d')
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.setTransform(stage.scale * dpr, 0, 0, stage.scale * dpr, 0, 0)
    draw(ctx, stage)
  }
  stage.onRender(redraw)
  return { redraw, canvas: c }
}
