// Built-in looks. Each preset lists only what it changes; applying one replaces the current look but keeps the crop and rotation.
import { GROUPS, LOOK_GROUPS, clone, defaults, merge, normalize, pick } from './_model.js'

const arr = (o) => { const a = [0, 0, 0, 0, 0, 0, 0, 0]; for (const [i, v] of Object.entries(o)) a[i] = v; return a }
const grade = (sh, mid, hi, blend = 50, balance = 0) => ({ sh: { h: 0, s: 0, l: 0, ...sh }, mid: { h: 0, s: 0, l: 0, ...mid }, hi: { h: 0, s: 0, l: 0, ...hi }, blend, balance })
const curve = (rgb, r, g, b) => { const d = defaults().curve; return { rgb: rgb || d.rgb, r: r || d.r, g: g || d.g, b: b || d.b } }
const SCURVE = [[0, 0], [64, 52], [192, 204], [255, 255]]
const MATTE = [[0, 30], [255, 244]]

export const BUILTIN = [
  { id: 'vivid', group: 'Color', name: 'Vivid', s: { contrast: 18, vibrance: 35, saturation: 10, clarity: 10, highlights: -12, shadows: 10 } },
  { id: 'natural-pop', group: 'Color', name: 'Natural pop', s: { contrast: 10, vibrance: 22, clarity: 8, texture: 8, highlights: -10, shadows: 12 } },
  { id: 'soft-portrait', group: 'Portrait', name: 'Soft portrait', s: { contrast: -8, clarity: -14, texture: -18, highlights: -15, shadows: 12, temp: 8, vibrance: 10, nrLuma: 18, grade: grade({}, { h: 28, s: 14 }, {}) } },
  { id: 'warm-skin', group: 'Portrait', name: 'Warm skin', s: { temp: 14, tint: 4, exposure: 0.12, contrast: 6, highlights: -14, shadows: 14, vibrance: 14, hue: arr({ 1: -4 }), sat: arr({ 1: 8 }), lum: arr({ 0: 8, 1: 10 }) } },
  { id: 'landscape-punch', group: 'Landscape', name: 'Landscape punch', s: { contrast: 20, dehaze: 18, clarity: 22, vibrance: 28, saturation: 6, highlights: -25, shadows: 20, sharpen: 35, sharpMask: 15, sat: arr({ 3: 18, 4: 12, 5: 20 }), lum: arr({ 5: -14 }) } },
  { id: 'golden-hour', group: 'Landscape', name: 'Golden hour', s: { temp: 28, tint: 6, exposure: 0.15, contrast: 12, highlights: -22, shadows: 18, vibrance: 22, vignette: -18, grade: grade({ h: 215, s: 14 }, {}, { h: 40, s: 32 }) } },
  { id: 'cool-morning', group: 'Landscape', name: 'Cool morning', s: { temp: -24, tint: -4, contrast: 8, shadows: 14, highlights: -10, vibrance: 12, grade: grade({ h: 225, s: 16 }, {}, { h: 195, s: 10 }) } },
  { id: 'teal-orange', group: 'Cinematic', name: 'Teal and orange', s: { contrast: 18, highlights: -10, shadows: 8, saturation: -6, vignette: -20, curve: curve(SCURVE), grade: grade({ h: 195, s: 42 }, { h: 25, s: 8 }, { h: 35, s: 38 }), sat: arr({ 1: 10, 5: -10 }), hue: arr({ 5: -8 }) } },
  { id: 'moody-dark', group: 'Cinematic', name: 'Moody dark', s: { exposure: -0.3, contrast: 22, highlights: -28, shadows: -8, blacks: -15, saturation: -12, clarity: 15, vignette: -35, grade: grade({ h: 220, s: 24 }, {}, { h: 40, s: 8 }) } },
  { id: 'matte-fade', group: 'Cinematic', name: 'Matte fade', s: { contrast: -10, highlights: -8, saturation: -10, curve: curve(MATTE) } },
  { id: 'film-warm', group: 'Film', name: 'Warm film', s: { temp: 12, contrast: 10, saturation: -8, grain: 28, grainSize: 30, curve: curve([[0, 18], [64, 56], [192, 206], [255, 250]]), grade: grade({ h: 215, s: 12 }, {}, { h: 45, s: 22 }) } },
  { id: 'faded-vintage', group: 'Film', name: 'Faded vintage', s: { contrast: -10, saturation: -22, temp: 10, tint: 8, grain: 30, vignette: -28, curve: curve([[0, 40], [255, 232]]), grade: grade({ h: 170, s: 14 }, {}, { h: 50, s: 22 }) } },
  { id: 'cross-process', group: 'Film', name: 'Cross process', s: { contrast: 12, saturation: 8, curve: curve(null, [[0, 0], [90, 60], [180, 215], [255, 255]], [[0, 12], [128, 138], [255, 245]], [[0, 30], [128, 112], [255, 220]]) } },
  { id: 'bw-classic', group: 'Black and white', name: 'B&W classic', s: { bw: true, contrast: 15, clarity: 12, highlights: -10, shadows: 8, grain: 15, lum: arr({ 0: 10, 1: 6, 5: -8 }) } },
  { id: 'bw-punch', group: 'Black and white', name: 'B&W high contrast', s: { bw: true, contrast: 45, clarity: 25, blacks: -20, whites: 15, vignette: -25, grain: 25, curve: curve(SCURVE) } },
  { id: 'bw-matte', group: 'Black and white', name: 'B&W soft matte', s: { bw: true, contrast: -10, clarity: -8, grain: 20, curve: curve([[0, 34], [255, 236]]) } },
  { id: 'bw-red-filter', group: 'Black and white', name: 'B&W red filter', s: { bw: true, contrast: 22, clarity: 14, lum: arr({ 0: 60, 1: 42, 2: -6, 3: -36, 4: -52, 5: -72, 6: -46, 7: -8 }), grain: 12 } },
  { id: 'sepia', group: 'Black and white', name: 'Sepia', s: { bw: true, contrast: 8, grain: 10, grade: grade({ h: 30, s: 30 }, { h: 35, s: 42 }, { h: 45, s: 30 }) } },
  { id: 'cyanotype', group: 'Black and white', name: 'Cyanotype', s: { bw: true, contrast: 14, grain: 12, grade: grade({ h: 215, s: 55 }, { h: 205, s: 45 }, { h: 190, s: 22 }) } },
  { id: 'dreamy-glow', group: 'Creative', name: 'Dreamy glow', s: { exposure: 0.2, clarity: -35, contrast: -5, dehaze: -15, highlights: -10, vibrance: 15, temp: 5 } },
  { id: 'crisp-detail', group: 'Creative', name: 'Crisp detail', s: { texture: 35, clarity: 20, sharpen: 55, sharpMask: 20, nrLuma: 8 } },
]

const LOOK_KEYS = new Set(LOOK_GROUPS.flatMap((g) => GROUPS[g]))

/**
 * Settings after applying a look to `current`. Built-in looks replace the whole look (everything except crop and rotation);
 * a saved preset with only some groups (replace = false) changes just the settings it contains.
 */
export function applyLook(current, look, replace = true) {
  if (!replace) return merge(current, cleanLook(look))
  return normalize({ ...defaults(), ...clone(look), ...pick(current, ['geometry']) })
}
/** A saved preset's look = the chosen groups, never the crop and rotation. */
export const lookOf = (s, groups = LOOK_GROUPS) => pick(s, groups)
/** Keep only known look keys, with values clamped (for presets read from files). */
export function cleanLook(look) {
  const full = normalize({ ...defaults(), ...(look && typeof look === 'object' ? look : {}) })
  return Object.fromEntries(Object.keys(look || {}).filter((k) => LOOK_KEYS.has(k)).map((k) => [k, full[k]]))
}
