// Model -> EPS (Encapsulated PostScript level 2, DSC 3.0). Paths, solid fills and strokes, dashes, caps, joins, even-odd fills, clips,
// embedded images (colorimage, ASCII85) and standard-font text. Gradients are written as stepped bands (clipped), the usual way
// PostScript from other tools carries them. Opacity is blended toward white because EPS has no transparency.
import { n4, rgbOf, pathBBox, invert, apply, imagePixels, baseFont, winAnsi, onWhite } from './_model.js'

const rgbPS = (c) => rgbOf(c).map((v) => n4(v / 255)).join(' ')
const mix = (c, a) => { const [r, g, b] = rgbOf(c); const k = Math.max(0, Math.min(1, a ?? 1)); return '#' + [r, g, b].map((v) => Math.round(v * k + 255 * (1 - k)).toString(16).padStart(2, '0')).join('') }

const pathPS = (d) => d.map((c) => {
  switch (c[0]) {
    case 'M': return `${n4(c[1])} ${n4(c[2])} m`
    case 'L': return `${n4(c[1])} ${n4(c[2])} l`
    case 'C': return `${n4(c[1])} ${n4(c[2])} ${n4(c[3])} ${n4(c[4])} ${n4(c[5])} ${n4(c[6])} c`
    default: return 'h'
  }
}).join('\n')

function a85(bytes) {
  const out = []
  let line = ''
  const push = (s) => { line += s; if (line.length >= 72) { out.push(line); line = '' } }
  for (let i = 0; i < bytes.length; i += 4) {
    const n = Math.min(4, bytes.length - i)
    let v = 0
    for (let k = 0; k < 4; k++) v = v * 256 + (k < n ? bytes[i + k] : 0)
    if (n === 4 && v === 0) { push('z'); continue }
    const ch = []
    for (let k = 4; k >= 0; k--) { ch[k] = String.fromCharCode(33 + (v % 85)); v = Math.floor(v / 85) }
    push(ch.slice(0, n + 1).join(''))
  }
  if (line) out.push(line)
  return out.join('\n') + '~>'
}

export function colorAt(stops, t) {
  if (!stops.length) return '#000000'
  if (t <= stops[0].o) return stops[0].c
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i].o) {
      const a = stops[i - 1], b = stops[i], k = b.o === a.o ? 1 : (t - a.o) / (b.o - a.o)
      const x = rgbOf(a.c), y = rgbOf(b.c)
      return '#' + x.map((v, j) => Math.round(v + (y[j] - v) * k).toString(16).padStart(2, '0')).join('')
    }
  }
  return stops[stops.length - 1].c
}

function gradientPS(g, box, opacity = 1) {
  const m = g.m || [1, 0, 0, 1, 0, 0], inv = invert(m)
  if (!inv) return ''
  const corners = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]].map(([x, y]) => apply(inv, x, y))
  const stops = [...g.stops].sort((a, b) => a.o - b.o).map((s) => ({ o: s.o, c: onWhite(s.c, (s.a ?? 1) * opacity) }))
  const N = 48, out = [`gsave [${m.map(n4).join(' ')}] concat`]
  if (g.g === 'radial') {
    const reach = Math.max(...corners.map(([x, y]) => Math.hypot(x - g.cx, y - g.cy))) * 1.5 + 1
    out.push(`${rgbPS(stops[stops.length - 1].c)} rg ${n4(g.cx - reach)} ${n4(g.cy - reach)} m ${n4(g.cx + reach)} ${n4(g.cy - reach)} l ${n4(g.cx + reach)} ${n4(g.cy + reach)} l ${n4(g.cx - reach)} ${n4(g.cy + reach)} l h f`)
    for (let i = N - 1; i >= 0; i--) {
      const r = (g.r * (i + 1)) / N
      out.push(`${rgbPS(colorAt(stops, (i + 0.5) / N))} rg ${n4(g.cx + r)} ${n4(g.cy)} m ${n4(g.cx)} ${n4(g.cy)} ${n4(r)} 0 360 arc h f`)
    }
  } else {
    const dx = g.x2 - g.x1, dy = g.y2 - g.y1, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len
    const L = Math.max(...corners.map(([x, y]) => Math.hypot(x - g.x1, y - g.y1))) * 1.5 + 1
    const quad = (t0, t1, color) => {
      const ax = g.x1 + dx * t0, ay = g.y1 + dy * t0, bx = g.x1 + dx * t1, by = g.y1 + dy * t1, px = -uy * L, py = ux * L
      return `${rgbPS(color)} rg ${n4(ax + px)} ${n4(ay + py)} m ${n4(bx + px)} ${n4(by + py)} l ${n4(bx - px)} ${n4(by - py)} l ${n4(ax - px)} ${n4(ay - py)} l h f`
    }
    out.push(quad(-L / len, 0.001, stops[0].c))
    for (let i = 0; i < N; i++) out.push(quad(i / N, Math.min(1, (i + 1) / N + 0.002), colorAt(stops, (i + 0.5) / N)))
    out.push(quad(1 - 0.001, 1 + L / len, stops[stops.length - 1].c))
  }
  out.push('grestore')
  return out.join('\n')
}

const psStr = (bytes) => '(' + [...bytes].map((b) => (b === 40 || b === 41 || b === 92 ? '\\' + String.fromCharCode(b) : b >= 32 && b < 127 ? String.fromCharCode(b) : '\\' + b.toString(8).padStart(3, '0'))).join('') + ')'

/** EPS source (string) for one page of a doc. */
export async function toEps(doc, pageIndex = 0, { title = 'Drawing', creator = 'Tools' } = {}) {
  const page = doc.pages[pageIndex]
  const W = page.w, H = page.h
  const fontsUsed = new Set(), notes = new Set()
  const body = []
  let imgCount = 0
  for (const it of page.items) {
    const clips = it.clip || []
    body.push('gsave')
    for (const c of clips) body.push(pathPS(c.d), c.rule === 'evenodd' ? 'eoclip newpath' : 'clip newpath')
    if (it.t === 'path') {
      const path = pathPS(it.d)
      const rule = it.rule === 'evenodd' ? 'e' : 'f'
      if (it.fill && typeof it.fill === 'object') {
        const box = pathBBox(it.d)
        if (box) {
          body.push('gsave', path, it.rule === 'evenodd' ? 'eoclip newpath' : 'clip newpath', gradientPS(it.fill, box, it.fillOpacity ?? 1), 'grestore')
          if ((it.fillOpacity != null && it.fillOpacity < 1) || it.fill.stops.some((x) => (x.a ?? 1) < 1)) notes.add('EPS has no transparency, so see-through gradients were blended with white.')
        }
      } else if (it.fill) {
        body.push(`${rgbPS(mix(it.fill, it.fillOpacity))} rg`, path, rule)
        if (it.fillOpacity != null && it.fillOpacity < 1) notes.add('EPS has no transparency, so see-through fills were blended with white.')
      }
      if (it.stroke && it.strokeWidth > 0) {
        body.push(`${rgbPS(mix(it.stroke, it.strokeOpacity))} rg ${n4(it.strokeWidth)} w ${it.cap || 0} J ${it.join || 0} j ${n4(it.miter || 4)} M`)
        body.push(it.dash?.length ? `[${it.dash.map(n4).join(' ')}] ${n4(it.dashOffset || 0)} d` : '[] 0 d')
        body.push(path, 'S')
      }
    } else if (it.t === 'image') {
      const px = await imagePixels(it, 3000)
      const rgb = new Uint8Array(px.w * px.h * 3)
      let alpha = false
      for (let i = 0, j = 0; i < px.data.length; i += 4, j += 3) {
        const a = px.data[i + 3] / 255
        if (a < 1) alpha = true
        rgb[j] = px.data[i] * a + 255 * (1 - a); rgb[j + 1] = px.data[i + 1] * a + 255 * (1 - a); rgb[j + 2] = px.data[i + 2] * a + 255 * (1 - a)
      }
      if (alpha) notes.add('EPS has no transparency, so see-through image areas were blended with white.')
      imgCount++
      body.push(`gsave [${it.m.map(n4).join(' ')}] concat`, `${px.w} ${px.h} 8 [${px.w} 0 0 ${px.h} 0 0]`, 'currentfile /ASCII85Decode filter false 3 colorimage', a85(rgb), 'grestore')
    } else if (it.t === 'text') {
      const font = baseFont(it.family, it.bold, it.italic)
      fontsUsed.add(font)
      body.push(`gsave [${it.m.map(n4).join(' ')}] concat 1 -1 scale ${rgbPS(mix(it.fill || '#000000', it.opacity))} rg /${font}-ISO findfont ${n4(it.size)} scalefont setfont 0 0 m ${psStr(winAnsi(it.str))} show grestore`)
      notes.add('Text uses standard PostScript fonts (Helvetica, Times, Courier). Use "Convert text to outlines" for the exact letter shapes.')
    }
    body.push('grestore')
  }
  const bb = [0, 0, Math.ceil(W), Math.ceil(H)]
  const head = [
    '%!PS-Adobe-3.0 EPSF-3.0',
    `%%Creator: ${creator}`,
    `%%Title: ${String(title).replace(/[^\x20-\x7e]/g, '_')}`,
    `%%CreationDate: ${new Date().toISOString()}`,
    `%%BoundingBox: ${bb.join(' ')}`,
    `%%HiResBoundingBox: 0.0000 0.0000 ${W.toFixed(4)} ${H.toFixed(4)}`,
    '%%DocumentData: Clean7Bit',
    '%%LanguageLevel: 2',
    '%%Pages: 1',
    '%%EndComments',
    '%%BeginProlog',
    '/m {moveto} bind def /l {lineto} bind def /c {curveto} bind def /h {closepath} bind def',
    '/f {fill} bind def /e {eofill} bind def /S {stroke} bind def /rg {setrgbcolor} bind def',
    '/w {setlinewidth} bind def /J {setlinecap} bind def /j {setlinejoin} bind def /M {setmiterlimit} bind def /d {setdash} bind def',
    '/RE {findfont dup length dict begin {1 index /FID ne {def} {pop pop} ifelse} forall /Encoding ISOLatin1Encoding def currentdict end definefont pop} bind def',
    ...[...fontsUsed].map((f) => `/${f}-ISO /${f} RE`),
    '%%EndProlog',
    '%%Page: 1 1',
    '%%BeginPageSetup',
    'gsave',
    `0 ${n4(H)} translate 1 -1 scale`,
    `newpath 0 0 m ${n4(W)} 0 l ${n4(W)} ${n4(H)} l 0 ${n4(H)} l h clip newpath`,
    '%%EndPageSetup',
  ]
  const tail = ['grestore', 'showpage', '%%Trailer', '%%EOF', '']
  return { text: [...head, ...body, ...tail].join('\n'), notes: [...notes], images: imgCount }
}

/** Blob of one EPS page. */
export async function epsBlob(doc, pageIndex, opts) {
  const r = await toEps(doc, pageIndex, opts)
  return { blob: new Blob([r.text], { type: 'application/postscript' }), notes: r.notes }
}
