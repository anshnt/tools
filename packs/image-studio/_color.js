// Color science helpers for the image-studio pack: sRGB tables, Lab, palette extraction (k-means and median cut), color names, exports.
import { rng, rgbToHex, rgbToHsl } from './_shared.js'

/** sRGB (0..255) to linear light (0..1), as a lookup table. */
export const LIN = Float32Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
const SRGB_LUT = new Uint8ClampedArray(4096)
for (let i = 0; i < 4096; i++) { const c = i / 4095; SRGB_LUT[i] = Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)) }
/** Linear light (0..1) to sRGB (0..255). */
export const toSrgb = (v) => SRGB_LUT[Math.max(0, Math.min(4095, Math.round(v * 4095)))]

const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
/** [r,g,b] 0..255 -> CIE L*a*b* (D65). */
export function rgb2lab(r, g, b) {
  const R = LIN[r], G = LIN[g], B = LIN[b]
  const fx = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047), fy = f(R * 0.2126 + G * 0.7152 + B * 0.0722), fz = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}
export const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

const isNeutral = (r, g, b) => (r > 238 && g > 238 && b > 238) || (r < 18 && g < 18 && b < 18)

/** Collect opaque pixels of RGBA data. */
function collect(data, skipNeutral) {
  const n = data.length / 4
  const rgb = new Uint8Array(n * 3)
  let m = 0
  for (let i = 0; i < n; i++) {
    const o = i * 4
    if (data[o + 3] < 128) continue
    const r = data[o], g = data[o + 1], b = data[o + 2]
    if (skipNeutral && isNeutral(r, g, b)) continue
    rgb[m * 3] = r; rgb[m * 3 + 1] = g; rgb[m * 3 + 2] = b
    m++
  }
  return { rgb: rgb.subarray(0, m * 3), n: m }
}

function kmeans({ rgb, n }, k, seed) {
  const lab = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { const l = rgb2lab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]); lab[i * 3] = l[0]; lab[i * 3 + 1] = l[1]; lab[i * 3 + 2] = l[2] }
  const rand = rng(seed)
  const cen = new Float32Array(k * 3)
  const d2 = (i, c) => { const a = lab[i * 3] - cen[c * 3], b = lab[i * 3 + 1] - cen[c * 3 + 1], e = lab[i * 3 + 2] - cen[c * 3 + 2]; return a * a + b * b + e * e }
  // k-means++ initialisation
  const first = Math.floor(rand() * n)
  cen.set(lab.subarray(first * 3, first * 3 + 3), 0)
  const best = new Float32Array(n).fill(Infinity)
  for (let c = 1; c < k; c++) {
    let sum = 0
    for (let i = 0; i < n; i++) { const d = d2(i, c - 1); if (d < best[i]) best[i] = d; sum += best[i] }
    let pick = rand() * sum, idx = n - 1
    for (let i = 0; i < n; i++) { pick -= best[i]; if (pick <= 0) { idx = i; break } }
    cen.set(lab.subarray(idx * 3, idx * 3 + 3), c * 3)
  }
  const assign = new Int16Array(n).fill(-1)
  for (let it = 0; it < 18; it++) {
    let changed = 0
    for (let i = 0; i < n; i++) {
      let bi = 0, bd = Infinity
      for (let c = 0; c < k; c++) { const d = d2(i, c); if (d < bd) { bd = d; bi = c } }
      if (assign[i] !== bi) { assign[i] = bi; changed++ }
    }
    const sum = new Float64Array(k * 3), cnt = new Uint32Array(k)
    for (let i = 0; i < n; i++) { const c = assign[i]; sum[c * 3] += lab[i * 3]; sum[c * 3 + 1] += lab[i * 3 + 1]; sum[c * 3 + 2] += lab[i * 3 + 2]; cnt[c]++ }
    for (let c = 0; c < k; c++) if (cnt[c]) { cen[c * 3] = sum[c * 3] / cnt[c]; cen[c * 3 + 1] = sum[c * 3 + 1] / cnt[c]; cen[c * 3 + 2] = sum[c * 3 + 2] / cnt[c] }
    if (!changed) break
  }
  const sum = new Float64Array(k * 3), cnt = new Uint32Array(k)
  for (let i = 0; i < n; i++) { const c = assign[i]; sum[c * 3] += rgb[i * 3]; sum[c * 3 + 1] += rgb[i * 3 + 1]; sum[c * 3 + 2] += rgb[i * 3 + 2]; cnt[c]++ }
  const out = []
  for (let c = 0; c < k; c++) if (cnt[c]) out.push({ rgb: [0, 1, 2].map((j) => Math.round(sum[c * 3 + j] / cnt[c])), count: cnt[c] })
  return out
}

function medianCut({ rgb, n }, k) {
  let boxes = [Array.from({ length: n }, (_, i) => i)]
  const range = (box) => {
    const mn = [255, 255, 255], mx = [0, 0, 0]
    for (const i of box) for (let j = 0; j < 3; j++) { const v = rgb[i * 3 + j]; if (v < mn[j]) mn[j] = v; if (v > mx[j]) mx[j] = v }
    const r = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]]
    const ch = r[0] >= r[1] && r[0] >= r[2] ? 0 : r[1] >= r[2] ? 1 : 2
    return { ch, span: r[ch] }
  }
  while (boxes.length < k) {
    let bi = -1, bs = 0, bch = 0
    boxes.forEach((b, i) => { if (b.length < 2) return; const { ch, span } = range(b); const score = span * Math.sqrt(b.length); if (score > bs) { bs = score; bi = i; bch = ch } })
    if (bi < 0 || bs === 0) break
    const box = boxes[bi].sort((a, b) => rgb[a * 3 + bch] - rgb[b * 3 + bch])
    const mid = box.length >> 1
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid))
  }
  return boxes.filter((b) => b.length).map((b) => {
    const s = [0, 0, 0]
    for (const i of b) { s[0] += rgb[i * 3]; s[1] += rgb[i * 3 + 1]; s[2] += rgb[i * 3 + 2] }
    return { rgb: s.map((v) => Math.round(v / b.length)), count: b.length }
  })
}

/**
 * Extract a palette from RGBA pixel data.
 * Returns [{rgb, hex, hsl, share, count, name}] sorted by share, largest first. Near-identical colors (Delta E under 6) are merged.
 */
export function extractPalette(data, k = 6, { method = 'kmeans', skipNeutral = false, seed = 7 } = {}) {
  const pts = collect(data, skipNeutral)
  if (!pts.n) return []
  k = Math.max(1, Math.min(k, pts.n))
  let colors = method === 'median' ? medianCut(pts, k) : kmeans(pts, k, seed)
  // merge near duplicates
  for (let again = true; again && colors.length > 1;) {
    again = false
    const labs = colors.map((c) => rgb2lab(...c.rgb))
    let bi = -1, bj = -1, bd = 6
    for (let i = 0; i < colors.length; i++) for (let j = i + 1; j < colors.length; j++) { const d = deltaE(labs[i], labs[j]); if (d < bd) { bd = d; bi = i; bj = j } }
    if (bi >= 0) {
      const a = colors[bi], b = colors[bj], t = a.count + b.count
      colors.splice(bj, 1)
      colors[bi] = { rgb: a.rgb.map((v, j) => Math.round((v * a.count + b.rgb[j] * b.count) / t)), count: t }
      again = true
    }
  }
  colors.sort((a, b) => b.count - a.count)
  return colors.map((c) => ({ ...c, share: c.count / pts.n, hex: rgbToHex(c.rgb), hsl: rgbToHsl(c.rgb), name: nameOf(c.rgb) }))
}

/** Plain average of all opaque pixels. */
export function averageColor(data, skipNeutral = false) {
  const { rgb, n } = collect(data, skipNeutral)
  if (!n) return null
  const s = [0, 0, 0]
  for (let i = 0; i < n; i++) { s[0] += LIN[rgb[i * 3]]; s[1] += LIN[rgb[i * 3 + 1]]; s[2] += LIN[rgb[i * 3 + 2]] }
  return s.map((v) => toSrgb(v / n))
}

// ---------- Names ----------
const NAMES = `Alice blue:f0f8ff|Antique white:faebd7|Aqua:00ffff|Aquamarine:7fffd4|Azure:f0ffff|Beige:f5f5dc|Bisque:ffe4c4|Black:000000|Blue:0000ff|Blue violet:8a2be2|Brown:a52a2a|Burlywood:deb887|Cadet blue:5f9ea0|Chartreuse:7fff00|Chocolate:d2691e|Coral:ff7f50|Cornflower blue:6495ed|Cornsilk:fff8dc|Crimson:dc143c|Dark blue:00008b|Dark cyan:008b8b|Dark goldenrod:b8860b|Dark gray:a9a9a9|Dark green:006400|Dark khaki:bdb76b|Dark magenta:8b008b|Dark olive green:556b2f|Dark orange:ff8c00|Dark orchid:9932cc|Dark red:8b0000|Dark salmon:e9967a|Dark sea green:8fbc8f|Dark slate blue:483d8b|Dark slate gray:2f4f4f|Dark turquoise:00ced1|Dark violet:9400d3|Deep pink:ff1493|Deep sky blue:00bfff|Dim gray:696969|Dodger blue:1e90ff|Firebrick:b22222|Forest green:228b22|Fuchsia:ff00ff|Gainsboro:dcdcdc|Gold:ffd700|Goldenrod:daa520|Gray:808080|Green:008000|Green yellow:adff2f|Hot pink:ff69b4|Indian red:cd5c5c|Indigo:4b0082|Ivory:fffff0|Khaki:f0e68c|Lavender:e6e6fa|Lawn green:7cfc00|Lemon chiffon:fffacd|Light blue:add8e6|Light coral:f08080|Light cyan:e0ffff|Light gray:d3d3d3|Light green:90ee90|Light pink:ffb6c1|Light salmon:ffa07a|Light sea green:20b2aa|Light sky blue:87cefa|Light slate gray:778899|Light steel blue:b0c4de|Light yellow:ffffe0|Lime:00ff00|Lime green:32cd32|Linen:faf0e6|Maroon:800000|Medium aquamarine:66cdaa|Medium blue:0000cd|Medium orchid:ba55d3|Medium purple:9370db|Medium sea green:3cb371|Medium slate blue:7b68ee|Medium spring green:00fa9a|Medium turquoise:48d1cc|Medium violet red:c71585|Midnight blue:191970|Mint cream:f5fffa|Misty rose:ffe4e1|Moccasin:ffe4b5|Navajo white:ffdead|Navy:000080|Old lace:fdf5e6|Olive:808000|Olive drab:6b8e23|Orange:ffa500|Orange red:ff4500|Orchid:da70d6|Pale goldenrod:eee8aa|Pale green:98fb98|Pale turquoise:afeeee|Pale violet red:db7093|Papaya whip:ffefd5|Peach puff:ffdab9|Peru:cd853f|Pink:ffc0cb|Plum:dda0dd|Powder blue:b0e0e6|Purple:800080|Rebecca purple:663399|Red:ff0000|Rosy brown:bc8f8f|Royal blue:4169e1|Saddle brown:8b4513|Salmon:fa8072|Sandy brown:f4a460|Sea green:2e8b57|Seashell:fff5ee|Sienna:a0522d|Silver:c0c0c0|Sky blue:87ceeb|Slate blue:6a5acd|Slate gray:708090|Snow:fffafa|Spring green:00ff7f|Steel blue:4682b4|Tan:d2b48c|Teal:008080|Thistle:d8bfd8|Tomato:ff6347|Turquoise:40e0d0|Violet:ee82ee|Wheat:f5deb3|White:ffffff|White smoke:f5f5f5|Yellow:ffff00|Yellow green:9acd32`
let NAME_LIST = null
/** Closest CSS color name (nearest in Lab). */
export function nameOf(rgb) {
  NAME_LIST ||= NAMES.split('|').map((s) => { const [name, hex] = s.split(':'); const n = parseInt(hex, 16); return { name, lab: rgb2lab((n >> 16) & 255, (n >> 8) & 255, n & 255) } })
  const lab = rgb2lab(...rgb)
  let best = NAME_LIST[0], bd = Infinity
  for (const c of NAME_LIST) { const d = deltaE(lab, c.lab); if (d < bd) { bd = d; best = c } }
  return best.name
}

// ---------- Exports ----------
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
/** Text formats for a palette. */
export function paletteFormats(pal) {
  const names = pal.map((c, i) => `${slug(c.name)}-${i + 1}`)
  return {
    css: `:root {\n${pal.map((c, i) => `  --color-${i + 1}: ${c.hex};  /* ${c.name} */`).join('\n')}\n}\n`,
    scss: pal.map((c, i) => `$color-${i + 1}: ${c.hex}; // ${c.name}`).join('\n') + '\n',
    json: JSON.stringify({ colors: pal.map((c) => ({ hex: c.hex, rgb: c.rgb, hsl: c.hsl, name: c.name, share: Math.round(c.share * 1000) / 10 })) }, null, 2) + '\n',
    tailwind: `// tailwind.config.js\nmodule.exports = {\n  theme: {\n    extend: {\n      colors: {\n${pal.map((c, i) => `        '${names[i]}': '${c.hex}',`).join('\n')}\n      },\n    },\n  },\n}\n`,
    hex: pal.map((c) => c.hex).join('\n') + '\n',
  }
}
