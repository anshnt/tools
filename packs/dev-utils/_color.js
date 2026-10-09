// Colour maths shared by the colour tools: parsing, conversions (sRGB, HSL, HSV, HWB, CMYK, CIE Lab/LCH D50, OKLab/OKLCH), WCAG contrast, palettes.
// Pure functions, no DOM except the named-colour lookup (canvas). A colour is {r, g, b, a} with r,g,b in 0..1 (sRGB) and a in 0..1.

const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n))
const mod = (n, m) => ((n % m) + m) % m
export const rgb = (r, g, b, a = 1) => ({ r, g, b, a })

const sign = (c) => (c < 0 ? -1 : 1)
const toLin = (c) => { const a = Math.abs(c); return sign(c) * (a <= 0.04045 ? a / 12.92 : ((a + 0.055) / 1.055) ** 2.4) }
const toGam = (c) => { const a = Math.abs(c); return sign(c) * (a <= 0.0031308 ? a * 12.92 : 1.055 * a ** (1 / 2.4) - 0.055) }
const mul = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2])

const M_XYZ = [[0.4123907992659595, 0.357584339383878, 0.1804807884018343], [0.21263900587151036, 0.715168678767756, 0.07219231536073371], [0.01930802283234266, 0.11919477979462598, 0.9505321522496607]]
const M_XYZ_INV = [[3.2409699419045226, -1.537383177570094, -0.4986107602930034], [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559], [0.05563007969699366, -0.20397695888897652, 1.0569715142428786]]
const D65_D50 = [[1.0479298208405488, 0.022946793341019088, -0.05019222954313557], [0.029627815688159344, 0.990434484573249, -0.01707382502938514], [-0.009243058152591178, 0.015055144896577895, 0.7518742899580008]]
const D50_D65 = [[0.9554734527042182, -0.023098536874261423, 0.0632593086610217], [-0.028369706963208136, 1.0099954580058226, 0.021041398966943008], [0.012314001688319899, -0.020507696433477912, 1.3303659366080753]]
const WHITE_D50 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585]
const EPS = 216 / 24389
const KAPPA = 24389 / 27

export const linear = (c) => [toLin(c.r), toLin(c.g), toLin(c.b)]
export const fromLinear = (l, a = 1) => ({ r: toGam(l[0]), g: toGam(l[1]), b: toGam(l[2]), a })

// ----- Lab / LCH (D50, as in CSS Color 4) -----
export function toLab(c) {
  const xyz = mul(D65_D50, mul(M_XYZ, linear(c)))
  const f = xyz.map((v, i) => { const t = v / WHITE_D50[i]; return t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116 })
  return { l: 116 * f[1] - 16, a: 500 * (f[0] - f[1]), b: 200 * (f[1] - f[2]) }
}
export function fromLab({ l, a, b }, alpha = 1) {
  const fy = (l + 16) / 116, fx = a / 500 + fy, fz = fy - b / 200
  const xyz = [fx ** 3 > EPS ? fx ** 3 : (116 * fx - 16) / KAPPA, l > KAPPA * EPS ? fy ** 3 : l / KAPPA, fz ** 3 > EPS ? fz ** 3 : (116 * fz - 16) / KAPPA].map((v, i) => v * WHITE_D50[i])
  return fromLinear(mul(M_XYZ_INV, mul(D50_D65, xyz)), alpha)
}
export const toLch = (c) => { const { l, a, b } = toLab(c); const ch = Math.hypot(a, b); return { l, c: ch, h: ch < 0.0015 ? 0 : mod((Math.atan2(b, a) * 180) / Math.PI, 360) } }
export const fromLch = ({ l, c, h }, alpha = 1) => fromLab({ l, a: c * Math.cos((h * Math.PI) / 180), b: c * Math.sin((h * Math.PI) / 180) }, alpha)

// ----- OKLab / OKLCH -----
export function toOklab(c) {
  const [r, g, b] = linear(c)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return { l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s }
}
export function fromOklab({ l, a, b }, alpha = 1) {
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return fromLinear([4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_], alpha)
}
export const toOklch = (c) => { const { l, a, b } = toOklab(c); const ch = Math.hypot(a, b); return { l, c: ch, h: ch < 0.00004 ? 0 : mod((Math.atan2(b, a) * 180) / Math.PI, 360) } }
export const fromOklch = ({ l, c, h }, alpha = 1) => fromOklab({ l, a: c * Math.cos((h * Math.PI) / 180), b: c * Math.sin((h * Math.PI) / 180) }, alpha)

export const inGamut = (c, eps = 0.0005) => [c.r, c.g, c.b].every((v) => v >= -eps && v <= 1 + eps)
export const clampRgb = (c) => ({ r: clamp(c.r), g: clamp(c.g), b: clamp(c.b), a: c.a })
/** Reduce OKLCH chroma until the colour fits in sRGB (keeps lightness and hue). */
export function oklchInGamut({ l, c, h }, alpha = 1) {
  const L = clamp(l)
  let col = fromOklch({ l: L, c, h }, alpha)
  if (inGamut(col)) return clampRgb(col)
  let lo = 0
  let hi = c
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; col = fromOklch({ l: L, c: mid, h }, alpha); if (inGamut(col)) lo = mid; else hi = mid }
  return clampRgb(fromOklch({ l: L, c: lo, h }, alpha))
}

// ----- HSL / HSV / HWB / CMYK -----
export function toHsl({ r, g, b }) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  const l = (max + min) / 2
  let h = 0
  if (d) h = max === r ? mod((g - b) / d, 6) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: h * 60, s: d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)), l }
}
export function fromHsl({ h, s, l }, a = 1) {
  const k = (n) => mod(n + h / 30, 12)
  const f = (n) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return { r: f(0), g: f(8), b: f(4), a }
}
export function toHsv({ r, g, b }) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d) h = max === r ? mod((g - b) / d, 6) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: h * 60, s: max === 0 ? 0 : d / max, v: max }
}
export function fromHsv({ h, s, v }, a = 1) {
  const f = (n) => { const k = mod(n + h / 60, 6); return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)) }
  return { r: f(5), g: f(3), b: f(1), a }
}
export function toHwb(c) { const { h } = toHsl(c); return { h, w: Math.min(c.r, c.g, c.b), b: 1 - Math.max(c.r, c.g, c.b) } }
export function fromHwb({ h, w, b }, a = 1) {
  if (w + b >= 1) { const g = w / (w + b); return { r: g, g, b: g, a } }
  const c = fromHsl({ h, s: 1, l: 0.5 })
  const f = (v) => v * (1 - w - b) + w
  return { r: f(c.r), g: f(c.g), b: f(c.b), a }
}
export function toCmyk({ r, g, b }) {
  const k = 1 - Math.max(r, g, b)
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 1 }
  return { c: (1 - r - k) / (1 - k), m: (1 - g - k) / (1 - k), y: (1 - b - k) / (1 - k), k }
}
export const fromCmyk = ({ c, m, y, k }, a = 1) => ({ r: (1 - c) * (1 - k), g: (1 - m) * (1 - k), b: (1 - y) * (1 - k), a })

// ----- Formatting -----
const rnd = (n, d = 0) => { const p = 10 ** d; const v = Math.round(n * p) / p; return Object.is(v, -0) ? 0 : v }
const byte = (v) => Math.round(clamp(v) * 255)
const hx = (n) => n.toString(16).padStart(2, '0')
export const toHex = (c, withAlpha = false) => `#${hx(byte(c.r))}${hx(byte(c.g))}${hx(byte(c.b))}${withAlpha || c.a < 1 ? hx(byte(c.a)) : ''}`
const alphaStr = (a) => (a < 1 ? ` / ${rnd(a, 3)}` : '')

export function formats(c) {
  const hsl = toHsl(c), hsv = toHsv(c), hwb = toHwb(c), cmyk = toCmyk(c), lab = toLab(c), lch = toLch(c), ok = toOklab(c), okl = toOklch(c)
  const R = byte(c.r), G = byte(c.g), B = byte(c.b)
  const pc = (v) => `${rnd(v * 100, 1)}%`
  const argb = (hx(byte(c.a)) + hx(R) + hx(G) + hx(B)).toUpperCase()
  return {
    hex: toHex(c),
    hex8: toHex(c, true),
    rgb: `rgb(${R} ${G} ${B}${alphaStr(c.a)})`,
    rgbLegacy: c.a < 1 ? `rgba(${R}, ${G}, ${B}, ${rnd(c.a, 3)})` : `rgb(${R}, ${G}, ${B})`,
    hsl: `hsl(${rnd(hsl.h, 1)} ${pc(hsl.s)} ${pc(hsl.l)}${alphaStr(c.a)})`,
    hsv: `hsv(${rnd(hsv.h, 1)}, ${pc(hsv.s)}, ${pc(hsv.v)}${c.a < 1 ? `, ${rnd(c.a, 3)}` : ''})`,
    hwb: `hwb(${rnd(hwb.h, 1)} ${pc(hwb.w)} ${pc(hwb.b)}${alphaStr(c.a)})`,
    cmyk: `cmyk(${pc(cmyk.c)}, ${pc(cmyk.m)}, ${pc(cmyk.y)}, ${pc(cmyk.k)})`,
    lab: `lab(${rnd(lab.l, 2)}% ${rnd(lab.a, 2)} ${rnd(lab.b, 2)}${alphaStr(c.a)})`,
    lch: `lch(${rnd(lch.l, 2)}% ${rnd(lch.c, 2)} ${rnd(lch.h, 1)}${alphaStr(c.a)})`,
    oklab: `oklab(${rnd(ok.l * 100, 2)}% ${rnd(ok.a, 4)} ${rnd(ok.b, 4)}${alphaStr(c.a)})`,
    oklch: `oklch(${rnd(okl.l * 100, 2)}% ${rnd(okl.c, 4)} ${rnd(okl.h, 1)}${alphaStr(c.a)})`,
    int: String((R << 16) | (G << 8) | B),
    flutter: `Color(0x${argb})`,
    android: `#${argb}`,
    swift: `UIColor(red: ${rnd(c.r, 3)}, green: ${rnd(c.g, 3)}, blue: ${rnd(c.b, 3)}, alpha: ${rnd(c.a, 3)})`,
    swiftui: `Color(red: ${rnd(c.r, 3)}, green: ${rnd(c.g, 3)}, blue: ${rnd(c.b, 3)}${c.a < 1 ? `, opacity: ${rnd(c.a, 3)}` : ''})`,
    css: `--color: ${toHex(c)};`,
  }
}

// ----- Parsing -----
export const NAMED = 'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(' ')

/** A named colour via the browser's own colour parser (canvas). Returns null outside a browser. */
function parseNamed(name) {
  try {
    const ctx = (parseNamed.ctx ||= document.createElement('canvas').getContext('2d', { willReadFrequently: true }))
    ctx.fillStyle = '#010203'
    ctx.fillStyle = name
    const v = ctx.fillStyle
    const m = /^#([0-9a-f]{6})$/i.exec(v)
    if (m) return rgb(parseInt(m[1].slice(0, 2), 16) / 255, parseInt(m[1].slice(2, 4), 16) / 255, parseInt(m[1].slice(4), 16) / 255)
  } catch { /* no canvas */ }
  return null
}
let namedCache = null
/** Every CSS named colour as {name, c}; built lazily in the browser. */
export function namedColors() {
  if (!namedCache) namedCache = NAMED.map((name) => ({ name, c: parseNamed(name) })).filter((x) => x.c)
  return namedCache
}

const num = (s, pctScale, hue) => {
  const t = String(s).trim().toLowerCase()
  if (t === 'none') return 0
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|rad|grad|turn)?$/.exec(t)
  if (!m) throw new Error(`"${s}" is not a number`)
  let v = parseFloat(m[1])
  if (m[2] === '%') v = (v / 100) * pctScale
  else if (hue) { if (m[2] === 'rad') v = (v * 180) / Math.PI; else if (m[2] === 'grad') v *= 0.9; else if (m[2] === 'turn') v *= 360 }
  return v
}
const frac = (s) => clamp(/%/.test(s) ? num(s, 1) : num(s, 1) / 100)

/** Parse a CSS-like colour string (hex, rgb, hsl, hwb, lab, lch, oklab, oklch, names, 0xAARRGGBB, "r, g, b"). Returns a colour or null. */
export function parseColor(input) {
  const t = String(input ?? '').trim()
  if (!t) return null
  let m
  if ((m = /^(#|0x)([0-9a-f]+)$/i.exec(t)) || (m = /^()([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(t))) {
    let h = m[2]
    const argb = m[1].toLowerCase() === '0x'
    if (!argb && (h.length === 3 || h.length === 4)) h = [...h].map((x) => x + x).join('')
    if (h.length !== 6 && h.length !== 8) return null
    const p = (i) => parseInt(h.slice(i, i + 2), 16) / 255
    if (argb) return h.length === 8 ? rgb(p(2), p(4), p(6), p(0)) : rgb(p(0), p(2), p(4))
    return rgb(p(0), p(2), p(4), h.length === 8 ? p(6) : 1)
  }
  if ((m = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*([^)]*?)\s*\)$/i.exec(t))) {
    const fn = m[1].toLowerCase().replace(/^(rgb|hsl)a$/, '$1')
    const parts = m[2].split(/\s*[\s,/]\s*/).filter(Boolean)
    if (parts.length < 3 || parts.length > 4) return null
    try {
      const a = parts[3] != null ? clamp(num(parts[3], 1)) : 1
      const [p0, p1, p2] = parts
      switch (fn) {
        case 'rgb': return rgb(clamp(num(p0, 255) / 255), clamp(num(p1, 255) / 255), clamp(num(p2, 255) / 255), a)
        case 'hsl': return fromHsl({ h: num(p0, 360, true), s: frac(p1), l: frac(p2) }, a)
        case 'hwb': return fromHwb({ h: num(p0, 360, true), w: frac(p1), b: frac(p2) }, a)
        case 'lab': return clampRgb(fromLab({ l: num(p0, 100), a: num(p1, 125), b: num(p2, 125) }, a))
        case 'lch': return clampRgb(fromLch({ l: num(p0, 100), c: num(p1, 150), h: num(p2, 360, true) }, a))
        case 'oklab': return clampRgb(fromOklab({ l: num(p0, 1), a: num(p1, 0.4), b: num(p2, 0.4) }, a))
        case 'oklch': return oklchInGamut({ l: num(p0, 1), c: num(p1, 0.4), h: num(p2, 360, true) }, a)
        default: return null
      }
    } catch { return null }
  }
  if (/^[a-z]+$/i.test(t)) {
    const n = t.toLowerCase()
    if (n === 'transparent') return rgb(0, 0, 0, 0)
    return NAMED.includes(n) ? parseNamed(n) : null
  }
  if ((m = /^(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})$/.exec(t)) && [m[1], m[2], m[3]].every((x) => +x <= 255)) return rgb(m[1] / 255, m[2] / 255, m[3] / 255)
  return null
}

// ----- WCAG contrast -----
export const luminance = (c) => { const [r, g, b] = linear(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
/** Alpha-composite c over a background colour. */
export const over = (c, bg) => ({ r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a), a: 1 })
export function contrast(fg, bg) {
  const f = fg.a < 1 ? over(fg, bg) : fg
  const a = luminance(f), b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
export const wcag = (ratio) => ({ aa: ratio >= 4.5, aaLarge: ratio >= 3, aaa: ratio >= 7, aaaLarge: ratio >= 4.5, ui: ratio >= 3 })
/** Closest-lightness version of fg (same hue and chroma in OKLCH) that reaches the target ratio on bg, or null. */
export function accessibleVariant(fg, bg, target = 4.5) {
  if (contrast(fg, bg) >= target) return fg
  const { l: base, c, h } = toOklch(fg)
  for (let i = 1; i <= 100; i++) {
    const cands = [-1, 1].map((dir) => oklchInGamut({ l: clamp(base + (dir * i) / 100), c, h }, 1)).filter((col) => contrast(col, bg) >= target)
    if (cands.length) return { ...cands[0], a: fg.a }
  }
  return null
}

// ----- Palettes -----
export const mix = (a, b, t) => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: a.a + (b.a - a.a) * t })
export const rotateHue = (c, deg) => { const o = toOklch(c); return oklchInGamut({ ...o, h: mod(o.h + deg, 360) }, c.a) }
export function harmonies(c) {
  return [['Complementary', [0, 180]], ['Analogous', [-30, 0, 30]], ['Triadic', [0, 120, 240]], ['Split complementary', [0, 150, 210]], ['Tetradic', [0, 90, 180, 270]]]
    .map(([name, rot]) => ({ name, colors: rot.map((d) => (d === 0 ? c : rotateHue(c, d))) }))
}
export const tints = (c, n = 9) => Array.from({ length: n }, (_, i) => mix(c, rgb(1, 1, 1, c.a), (i + 1) / (n + 1)))
export const shades = (c, n = 9) => Array.from({ length: n }, (_, i) => mix(c, rgb(0, 0, 0, c.a), (i + 1) / (n + 1)))
export const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
const STEP_L = [0.975, 0.945, 0.89, 0.82, 0.74, 0.65, 0.57, 0.49, 0.41, 0.34, 0.25]
/** An 11-step scale (50-950) with the same hue; chroma follows the base colour, lightness follows a fixed curve. [[step, colour, isBase]] */
export function scale(c) {
  const { l, c: ch, h } = toOklch(c)
  const idx = STEP_L.reduce((best, v, i) => (Math.abs(v - l) < Math.abs(STEP_L[best] - l) ? i : best), 0)
  return STEPS.map((s, i) => {
    const L = STEP_L[i]
    const k = 1 - Math.abs(L - 0.62) * 0.9
    return [s, i === idx ? { ...c, a: 1 } : oklchInGamut({ l: L, c: ch * Math.max(0.25, Math.min(1.1, k)), h }, 1), i === idx]
  })
}
/** Closest CSS named colour (by OKLab distance), or null without a canvas. */
export function nearestName(c) {
  const list = namedColors()
  const o = toOklab(c)
  let best = null
  for (const { name, c: n } of list) {
    const p = toOklab(n)
    const d = (o.l - p.l) ** 2 + (o.a - p.a) ** 2 + (o.b - p.b) ** 2
    if (!best || d < best.d) best = { name, d }
  }
  return best && { name: best.name, exact: best.d < 1e-6 }
}
