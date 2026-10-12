// Model -> SVG. The "Corel-friendly" flavour used for export: absolute size in mm (user unit = 1 mm), presentation attributes instead of
// inline styles or CSS, transforms flattened into path data, plain linear and radial gradients, no filters or masks.
// The same writer draws the CDR viewer (unit 'pt', ids on). With opts.fonts (Doc.fonts) text that carries glyphs is written with the embedded font
// (an @font-face data URL inside the SVG, only for fonts the page uses), so the exact letter shapes survive.
import { n4, mapPath, scale, mul, MM, bytesToDataUrl } from './_model.js'

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const dStr = (d) => d.map((c) => (c[0] === 'Z' ? 'Z' : c[0] + c.slice(1).map(n4).join(' '))).join('')

/**
 * SVG source for one page. opts: {unit: 'mm' | 'pt' (default mm), ids: add data-i="<item index>" and data-id, background, title, fonts: Doc.fonts}
 * Returns the SVG string. Item coordinates are scaled to the unit, so the result is self-contained.
 */
export function pageToSvg(page, { unit = 'mm', ids = false, background = null, title = '', fonts = null } = {}) {
  const k = unit === 'mm' ? 1 / MM : 1, S = scale(k)
  const W = page.w * k, H = page.h * k
  const defs = []
  let uid = 0
  const attrs = (it, i) => (ids ? ` data-i="${i}"${it.id != null ? ` data-id="${esc(it.id)}"` : ''}` : '')

  const gradient = (g) => {
    const id = `g${++uid}`
    const m = mul(S, g.m || [1, 0, 0, 1, 0, 0])
    const mat = `gradientTransform="matrix(${m.map(n4).join(' ')})"`
    const stops = [...g.stops].sort((a, b) => a.o - b.o).map((s) => `<stop offset="${n4(s.o)}" stop-color="${esc(s.c)}"${s.a != null && s.a < 1 ? ` stop-opacity="${n4(s.a)}"` : ''}/>`).join('')
    const spread = g.spread && g.spread !== 'pad' ? ` spreadMethod="${esc(g.spread)}"` : ''
    if (g.g === 'radial') defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n4(g.cx)}" cy="${n4(g.cy)}" r="${n4(g.r)}" fx="${n4(g.fx ?? g.cx)}" fy="${n4(g.fy ?? g.cy)}" ${mat}${spread}>${stops}</radialGradient>`)
    else defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n4(g.x1)}" y1="${n4(g.y1)}" x2="${n4(g.x2)}" y2="${n4(g.y2)}" ${mat}${spread}>${stops}</linearGradient>`)
    return `url(#${id})`
  }
  // glyph text: the run is the glyph characters of the embedded font, one x per UTF-16 unit; the font travels inside the SVG as a data URL
  const faces = new Map()
  const glyphFace = (it) => {
    const f = fonts && it.font && it.glyphs?.length && fonts[it.font]
    if (!f || !f.data || it.glyphs.some((g) => typeof g.c !== 'string' || !g.c || /[\x00-\x1f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(g.c) || !Number.isFinite(g.x))) return null
    if (!faces.has(it.font)) {
      const fam = `dsf-${String(it.font).replace(/[^\w-]/g, '_')}`
      faces.set(it.font, fam)
      defs.push(`<style>@font-face{font-family:${fam};src:url(${bytesToDataUrl(f.data, f.data[0] === 0x4f ? 'font/otf' : 'font/ttf')})}</style>`)
    }
    return faces.get(it.font)
  }
  const clipRef = (clips) => {
    if (!clips?.length) return ''
    const id = `c${++uid}`
    defs.push(`<clipPath id="${id}">${clips.map((c) => `<path d="${dStr(mapPath(c.d, S))}"${c.rule === 'evenodd' ? ' clip-rule="evenodd"' : ''}/>`).join('')}</clipPath>`)
    return id
  }

  const body = page.items.map((it, i) => {
    let el = ''
    if (it.t === 'path') {
      let a = `d="${dStr(mapPath(it.d, S))}"`
      a += ` fill="${it.fill ? (typeof it.fill === 'object' ? gradient(it.fill) : esc(it.fill)) : 'none'}"`
      if (it.fill && it.fillOpacity != null && it.fillOpacity < 1) a += ` fill-opacity="${n4(it.fillOpacity)}"`
      if (it.rule === 'evenodd') a += ' fill-rule="evenodd"'
      if (it.stroke && it.strokeWidth > 0) {
        a += ` stroke="${esc(it.stroke)}" stroke-width="${n4(it.strokeWidth * k)}"`
        if (it.strokeOpacity != null && it.strokeOpacity < 1) a += ` stroke-opacity="${n4(it.strokeOpacity)}"`
        if (it.cap) a += ` stroke-linecap="${['butt', 'round', 'square'][it.cap]}"`
        if (it.join) a += ` stroke-linejoin="${['miter', 'round', 'bevel'][it.join]}"`
        if (it.join === 0 && it.miter && it.miter !== 4) a += ` stroke-miterlimit="${n4(it.miter)}"`
        if (it.dash?.length) a += ` stroke-dasharray="${it.dash.map((v) => n4(v * k)).join(' ')}"${it.dashOffset ? ` stroke-dashoffset="${n4(it.dashOffset * k)}"` : ''}`
      }
      el = `<path ${a}${attrs(it, i)}/>`
    } else if (it.t === 'image') {
      const m = mul(S, it.m)
      el = `<image width="1" height="1" preserveAspectRatio="none" transform="matrix(${m.map(n4).join(' ')})" xlink:href="${esc(it.href)}"${it.opacity != null && it.opacity < 1 ? ` opacity="${n4(it.opacity)}"` : ''}${attrs(it, i)}/>`
    } else if (it.t === 'text') {
      const m = mul(S, it.m), simple = Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && Math.abs(m[0] - m[3]) < 1e-9
      const size = it.size * (simple ? m[0] : 1)
      const tr = simple ? `x="${n4(m[4])}" y="${n4(m[5])}"` : `transform="matrix(${m.map(n4).join(' ')})" x="0" y="0"`
      const fam = esc(it.family || 'Arial').replace(/'/g, '&apos;')
      const face = glyphFace(it)
      if (face) {
        const xs = it.glyphs.flatMap((g) => Array.from({ length: g.c.length }, () => n4(simple ? m[4] + m[0] * g.x : g.x))).join(' ')
        const place = simple ? `y="${n4(m[5])}"` : `transform="matrix(${m.map(n4).join(' ')})" y="0"`
        el = `<text x="${xs}" ${place} font-family="${face}, ${fam}" font-size="${n4(size)}" fill="${esc(it.fill || '#000000')}"${it.opacity != null && it.opacity < 1 ? ` opacity="${n4(it.opacity)}"` : ''} style="font-kerning:none;font-variant-ligatures:none;font-feature-settings:'liga' 0,'clig' 0,'calt' 0;text-rendering:geometricPrecision" xml:space="preserve"${attrs(it, i)}>${esc(it.glyphs.map((g) => g.c).join(''))}</text>`
      } else
      el = `<text ${tr} font-family="${fam}" font-size="${n4(size)}"${it.bold ? ' font-weight="bold"' : ''}${it.italic ? ' font-style="italic"' : ''} fill="${esc(it.fill || '#000000')}"${it.opacity != null && it.opacity < 1 ? ` opacity="${n4(it.opacity)}"` : ''} xml:space="preserve"${attrs(it, i)}>${esc(it.str)}</text>`
    }
    const clip = el && clipRef(it.clip)
    return clip ? `<g clip-path="url(#${clip})">${el}</g>` : el
  }).filter(Boolean).join('\n')

  const size = unit === 'mm' ? `width="${n4(W)}mm" height="${n4(H)}mm"` : `width="${n4(W)}" height="${n4(H)}"`
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" ${size} viewBox="0 0 ${n4(W)} ${n4(H)}">`
    + (title ? `<title>${esc(title)}</title>` : '')
    + (defs.length ? `<defs>${defs.join('')}</defs>` : '')
    + (background ? `<rect width="${n4(W)}" height="${n4(H)}" fill="${esc(background)}"/>` : '')
    + `\n${body}\n</svg>\n`
}

export const svgBlob = (page, opts) => new Blob([pageToSvg(page, opts)], { type: 'image/svg+xml' })
