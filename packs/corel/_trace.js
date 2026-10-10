// Raster image -> vector paths with imagetracerjs (Unlicense). Presets for logos, line art and posters or photos.
import { imagetracer } from './_libs.js'
import { hex } from './_model.js'
import { yieldToMain } from '../../lib/ui.js'

export const PRESETS = {
  logo: { label: 'Logo or clipart', colors: 8, detail: 6, smooth: 1, removeBg: true, bw: false, hint: 'Flat colours and clean edges. Best for logos, icons and cartoons.' },
  lineart: { label: 'Line art (black and white)', colors: 2, detail: 6, smooth: 1, removeBg: true, bw: true, hint: 'Black shapes on a transparent background. Best for drawings, signatures and stencils.' },
  poster: { label: 'Poster or photo', colors: 24, detail: 5, smooth: 2, removeBg: false, bw: false, hint: 'Many colours, stacked like a poster. Larger files with more nodes.' },
}

/** Longest side the tracer works at (bigger inputs are scaled down for speed). */
export const TRACE_MAX = 1000

/**
 * Palette of k colours for the image: weighted k-means on a 15-bit colour histogram, started from the most common colour and then the
 * colours farthest from the chosen ones (so small flat areas such as a green dot in a logo keep their own colour).
 */
export function quantize(rgba, k) {
  const bins = new Map()
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue
    const key = ((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3)
    const b = bins.get(key)
    if (b) { b.n++; b.r += rgba[i]; b.g += rgba[i + 1]; b.b += rgba[i + 2] } else bins.set(key, { n: 1, r: rgba[i], g: rgba[i + 1], b: rgba[i + 2] })
  }
  const pts = [...bins.values()].map((b) => ({ n: b.n, r: b.r / b.n, g: b.g / b.n, b: b.b / b.n }))
  if (!pts.length) return []
  const d2 = (p, c) => (p.r - c.r) ** 2 + (p.g - c.g) ** 2 + (p.b - c.b) ** 2
  const centers = [{ ...pts.reduce((a, p) => (p.n > a.n ? p : a)) }]
  const near = pts.map((p) => d2(p, centers[0]))
  while (centers.length < Math.min(k, pts.length)) {
    let best = -1, bi = 0
    for (let i = 0; i < pts.length; i++) { const sc = near[i] * Math.sqrt(pts[i].n); if (sc > best) { best = sc; bi = i } }
    if (best <= 0) break
    centers.push({ ...pts[bi] })
    for (let i = 0; i < pts.length; i++) near[i] = Math.min(near[i], d2(pts[i], centers[centers.length - 1]))
  }
  for (let it = 0; it < 6; it++) {
    const acc = centers.map(() => ({ n: 0, r: 0, g: 0, b: 0 }))
    for (const p of pts) {
      let bi = 0, bd = Infinity
      for (let c = 0; c < centers.length; c++) { const d = d2(p, centers[c]); if (d < bd) { bd = d; bi = c } }
      const a = acc[bi]; a.n += p.n; a.r += p.r * p.n; a.g += p.g * p.n; a.b += p.b * p.n
    }
    acc.forEach((a, c) => { if (a.n) centers[c] = { r: a.r / a.n, g: a.g / a.n, b: a.b / a.n } })
  }
  return centers.map((c) => ({ r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b), a: 255 }))
}

function tracerOptions(o, pal) {
  // straight lines are accepted only when they are really straight; curves get the looser tolerance so round shapes stay round
  const ltres = (0.15 + (10 - o.detail) * 0.05) * (1 + o.smooth * 0.2)
  const qtres = Math.max(0.4, 2 - (o.detail - 1) * 0.16) * (1 + o.smooth * 0.25)
  const opts = {
    ltres, qtres, pathomit: Math.max(1, Math.round(40 / o.detail)), numberofcolors: o.colors, colorquantcycles: 3, colorsampling: o.bw ? 0 : 2,
    blurradius: Math.min(5, o.smooth), blurdelta: 20, strokewidth: 0, roundcoords: 2, scale: 1, rightangleenhance: true, layering: 0, mincolorratio: 0,
  }
  opts.pal = pal
  return opts
}

const segPath = (segs) => {
  if (!segs.length) return []
  const d = [['M', segs[0].x1, segs[0].y1]]
  for (const s of segs) {
    if (s.type === 'L') d.push(['L', s.x2, s.y2])
    else d.push(['C', s.x1 + (2 / 3) * (s.x2 - s.x1), s.y1 + (2 / 3) * (s.y2 - s.y1), s.x3 + (2 / 3) * (s.x2 - s.x3), s.y3 + (2 / 3) * (s.y2 - s.y3), s.x3, s.y3])
  }
  d.push(['Z'])
  return d
}

/**
 * Trace an image element or canvas. opts: {colors, detail 1-10, smooth 0-5, removeBg, bw, widthPt}
 * Returns {page: {w, h, items}, paths, nodes, colors}. Output size is widthPt wide (default 96 dpi).
 */
export async function traceImage(source, opts) {
  const ImageTracer = await imagetracer()
  const sw = source.naturalWidth || source.width, sh = source.naturalHeight || source.height
  const k = Math.min(1, TRACE_MAX / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k))
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(source, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h)
  await yieldToMain()
  let transparent = 0
  for (let i = 3; i < data.data.length; i += 4) if (data.data[i] < 128) transparent++
  const pal = opts.bw ? [{ r: 255, g: 255, b: 255, a: 255 }, { r: 0, g: 0, b: 0, a: 255 }] : quantize(data.data, opts.colors)
  if (transparent > w * h * 0.002) pal.push({ r: 0, g: 0, b: 0, a: 0 })
  const td = ImageTracer.imagedataToTracedata(data, tracerOptions(opts, pal))
  const pt = (opts.widthPt || (sw * 72) / 96) / w
  // background: transparent layers always go; otherwise the palette colour closest to the corner pixels when asked
  const corner = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([x, y]) => [data.data[(y * w + x) * 4], data.data[(y * w + x) * 4 + 1], data.data[(y * w + x) * 4 + 2], data.data[(y * w + x) * 4 + 3]])
  const opaqueCorners = corner.filter((p) => p[3] > 200)
  let bgIndex = -1
  if (opts.removeBg && opaqueCorners.length >= 3) {
    const avg = [0, 1, 2].map((i) => opaqueCorners.reduce((a, p) => a + p[i], 0) / opaqueCorners.length)
    let best = Infinity
    td.palette.forEach((p, i) => { const dist = (p.r - avg[0]) ** 2 + (p.g - avg[1]) ** 2 + (p.b - avg[2]) ** 2; if (dist < best) { best = dist; bgIndex = i } })
    if (best > 40 * 40) bgIndex = -1
  }
  const items = []
  const used = new Set()
  // photos and posters: a base shape in the most common colour so the hairline seams between colour areas are not white
  if (!opts.removeBg && transparent <= w * h * 0.002 && td.layers.length) {
    let big = 0, bi = -1
    td.layers.forEach((layer, li) => { const n = layer.reduce((a, p) => a + (p.isholepath ? 0 : p.boundingbox ? (p.boundingbox[2] - p.boundingbox[0]) * (p.boundingbox[3] - p.boundingbox[1]) : 0), 0); if (n > big) { big = n; bi = li } })
    const p = td.palette[bi]
    if (p) { items.push({ t: 'path', d: [['M', 0, 0], ['L', w * pt, 0], ['L', w * pt, h * pt], ['L', 0, h * pt], ['Z']], fill: hex(p.r, p.g, p.b), fillOpacity: 1, rule: 'nonzero', stroke: null, strokeWidth: 0 }); used.add(hex(p.r, p.g, p.b)) }
  }
  td.layers.forEach((layer, li) => {
    const p = td.palette[li]
    if (!p || p.a < 100 || li === bgIndex) return
    const fill = hex(p.r, p.g, p.b)
    for (const path of layer) {
      if (path.isholepath || !path.segments?.length) continue
      const d = segPath(path.segments)
      for (const hi of path.holechildren || []) { const hp = layer[hi]; if (hp?.segments?.length) d.push(...segPath(hp.segments)) }
      d.forEach((cmd) => { for (let i = 1; i < cmd.length; i++) cmd[i] *= pt })
      items.push({ t: 'path', d, fill, fillOpacity: p.a < 250 ? p.a / 255 : 1, rule: 'evenodd', stroke: null, strokeWidth: 0 })
      used.add(fill)
    }
  })
  const nodes = items.reduce((a, it) => a + it.d.filter((x) => x[0] !== 'Z').length, 0)
  return { page: { w: w * pt, h: h * pt, items }, paths: items.length, nodes, colors: used.size }
}
