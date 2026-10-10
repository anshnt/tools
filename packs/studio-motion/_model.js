// Document model: a composition plus a tree of layers (index 0 = top). Everything is plain JSON so history, autosave and project files are trivial.
import { uid, clone, clamp } from './_anim.js'

export const COMP_LIMITS = { minSize: 16, maxSize: 4096, maxFps: 60, maxDuration: 120 }
export const SIZE_PRESETS = [
  ['1920x1080', 'HD 1920 x 1080'], ['1280x720', 'HD 1280 x 720'], ['1080x1920', 'Vertical 1080 x 1920'], ['1080x1080', 'Square 1080'],
  ['1080x1350', 'Portrait 1080 x 1350'], ['3840x2160', 'UHD 3840 x 2160'], ['640x360', 'Small 640 x 360 (GIF)'], ['480x480', 'Small square 480 (GIF)'],
]
export const BLENDS = [['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['lighten', 'Lighten'], ['darken', 'Darken'], ['difference', 'Difference'], ['lighter', 'Add']]
export const FONTS = ['Geist', 'Arial', 'Helvetica', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'sans-serif', 'serif', 'monospace']
export const SHAPES = [['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['polygon', 'Polygon'], ['star', 'Star'], ['line', 'Line']]

/** Property definitions: dim 1 = number, 2 = [x, y]. */
export const PROP_DEFS = {
  anchor: { label: 'Anchor point', dim: 2, step: 1, unit: 'px' },
  position: { label: 'Position', dim: 2, step: 1, unit: 'px' },
  scale: { label: 'Scale', dim: 2, step: 1, unit: '%' },
  rotation: { label: 'Rotation', dim: 1, step: 1, unit: 'deg' },
  opacity: { label: 'Opacity', dim: 1, step: 1, unit: '%', min: 0, max: 100 },
  trimStart: { label: 'Trim start', dim: 1, step: 1, unit: '%', min: 0, max: 100 },
  trimEnd: { label: 'Trim end', dim: 1, step: 1, unit: '%', min: 0, max: 100 },
  trimOffset: { label: 'Trim offset', dim: 1, step: 1, unit: '%', min: -100, max: 100 },
}
export const EFFECTS = {
  blur: { label: 'Blur', params: { radius: { label: 'Radius', v: 12, min: 0, max: 300, unit: 'px' } }, opts: {} },
  glow: {
    label: 'Glow', params: { radius: { label: 'Radius', v: 28, min: 0, max: 300, unit: 'px' }, intensity: { label: 'Intensity', v: 100, min: 0, max: 400, unit: '%' } },
    opts: { color: '' }, // '' = glow in the layer's own colours
  },
  shadow: {
    label: 'Drop shadow', params: {
      distance: { label: 'Distance', v: 24, min: 0, max: 400, unit: 'px' }, angle: { label: 'Direction', v: 45, min: -360, max: 360, unit: 'deg' },
      blur: { label: 'Softness', v: 16, min: 0, max: 200, unit: 'px' }, opacity: { label: 'Opacity', v: 60, min: 0, max: 100, unit: '%' },
    }, opts: { color: '#000000' },
  },
  color: {
    label: 'Colour adjust', params: {
      brightness: { label: 'Brightness', v: 100, min: 0, max: 400, unit: '%' }, contrast: { label: 'Contrast', v: 100, min: 0, max: 400, unit: '%' },
      saturation: { label: 'Saturation', v: 100, min: 0, max: 400, unit: '%' }, hue: { label: 'Hue shift', v: 0, min: -180, max: 180, unit: 'deg' },
    }, opts: {},
  },
}
export const ANIM_PROPS = {
  start: { label: 'Range start', dim: 1, v: 0, min: -200, max: 300, unit: '%' },
  end: { label: 'Range end', dim: 1, v: 100, min: -200, max: 300, unit: '%' },
  offset: { label: 'Range offset', dim: 1, v: 0, min: -400, max: 400, unit: '%' },
  opacity: { label: 'Opacity', dim: 1, v: 0, min: 0, max: 100, unit: '%' },
  position: { label: 'Position', dim: 2, v: [0, 0], step: 1, unit: 'px' },
  scale: { label: 'Scale', dim: 2, v: [100, 100], step: 1, unit: '%' },
  rotation: { label: 'Rotation', dim: 1, v: 0, step: 1, unit: 'deg' },
}

const P = (v) => ({ v })
const transformProps = () => ({ anchor: P([0, 0]), position: P([0, 0]), scale: P([100, 100]), rotation: P(0), opacity: P(100) })

export function makeDoc(over = {}) {
  return {
    v: 1,
    comp: { name: 'Composition 1', width: 1920, height: 1080, fps: 30, duration: 5, bg: '#14141c', transparent: false, ...over },
    layers: [],
  }
}

/** Create a layer of any type with sensible defaults, centred in the composition. */
export function makeLayer(doc, type, o = {}) {
  const { width: W, height: H, duration } = doc.comp
  const L = { id: uid('l'), type, name: '', visible: true, locked: false, inPoint: 0, outPoint: duration, blend: 'source-over', props: transformProps(), effects: [] }
  L.props.position = P([W / 2, H / 2])
  if (type === 'text') {
    L.data = { text: 'Your text', font: 'Geist', size: Math.round(H / 9), weight: 700, italic: false, align: 'center', tracking: 0, lineHeight: 1.15, fill: '#ffffff', stroke: '#000000', strokeWidth: 0, ...o.data }
    L.animators = []
  } else if (type === 'shape') {
    L.data = { kind: 'rect', w: Math.round(H / 3), h: Math.round(H / 3), radius: 0, sides: 5, inner: 45, fillOn: true, fill: '#6366f1', stroke: '#ffffff', strokeWidth: 0, cap: 'round', ...o.data }
    if (L.data.kind === 'line') { L.data.fillOn = false; L.data.strokeWidth = L.data.strokeWidth || 10; L.data.h = 0 }
    L.props.trimStart = P(0); L.props.trimEnd = P(100); L.props.trimOffset = P(0)
  } else if (type === 'image') {
    L.data = { asset: '', w: 400, h: 300, ...o.data }
  } else if (type === 'solid') {
    L.data = { color: '#6366f1', w: W, h: H, ...o.data }
  } else if (type === 'group') {
    L.children = []
    L.props.position = P([0, 0])
  }
  L.name = o.name || uniqueName(doc, { text: 'Text', shape: 'Shape', image: 'Image', solid: 'Solid', group: 'Group' }[type])
  if (o.position) L.props.position = P(o.position)
  return L
}

// ---------- tree helpers ----------
export function walk(layers, fn, parent = null, depth = 0) {
  for (const L of layers) {
    fn(L, parent, depth)
    if (L.children) walk(L.children, fn, L, depth + 1)
  }
}
export const allLayers = (doc) => { const out = []; walk(doc.layers, (L) => out.push(L)); return out }
/** Locate a layer: {layer, parent (layer | null), list (array holding it), index}. */
export function findLayer(doc, id) {
  let hit = null
  walk(doc.layers, (L, parent) => {
    if (!hit && L.id === id) {
      const list = parent ? parent.children : doc.layers
      hit = { layer: L, parent, list, index: list.indexOf(L) }
    }
  })
  return hit
}
export function pathTo(doc, id) {
  const out = []
  const f = (list) => { for (const L of list) { out.push(L); if (L.id === id) return true; if (L.children && f(L.children)) return true; out.pop() } return false }
  return f(doc.layers) ? out : []
}
export function uniqueName(doc, base) {
  const names = new Set(allLayers(doc).map((l) => l.name))
  let n = 1
  while (names.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}
/** Deep copy with fresh ids (layers, effects, animators, keyframes). */
export function cloneLayer(L) {
  const c = clone(L)
  const fresh = (l) => {
    l.id = uid('l')
    for (const e of l.effects || []) e.id = uid('e')
    for (const a of l.animators || []) a.id = uid('a')
    const ps = [Object.values(l.props), ...(l.effects || []).map((e) => Object.values(e.params)), ...(l.animators || []).map((a) => Object.values(a.props))].flat()
    for (const p of ps) for (const k of p.k || []) k.id = uid('k')
    for (const ch of l.children || []) fresh(ch)
  }
  fresh(c)
  return c
}

// ---------- property resolution ----------
/** Keys: 'position' (layer.props), 'fx:<effectId>:<param>', 'an:<animatorId>:<param>'. */
export function resolveProp(L, key) {
  if (key.startsWith('fx:')) { const [, id, name] = key.split(':'); return L.effects.find((e) => e.id === id)?.params[name] }
  if (key.startsWith('an:')) { const [, id, name] = key.split(':'); return L.animators?.find((a) => a.id === id)?.props[name] }
  return L.props[key]
}
/** Every animatable property of a layer in display order: [{key, label, group, def}]. */
export function propList(L) {
  const out = []
  for (const k of ['anchor', 'position', 'scale', 'rotation', 'opacity']) out.push({ key: k, label: PROP_DEFS[k].label, group: 'Transform', def: PROP_DEFS[k] })
  if (L.type === 'shape') for (const k of ['trimStart', 'trimEnd', 'trimOffset']) out.push({ key: k, label: PROP_DEFS[k].label, group: 'Trim paths', def: PROP_DEFS[k] })
  for (const a of L.animators || []) for (const k of Object.keys(a.props)) out.push({ key: `an:${a.id}:${k}`, label: ANIM_PROPS[k].label, group: a.name, def: ANIM_PROPS[k] })
  for (const e of L.effects) for (const [k, d] of Object.entries(EFFECTS[e.type].params)) out.push({ key: `fx:${e.id}:${k}`, label: d.label, group: EFFECTS[e.type].label, def: { dim: 1, step: 1, ...d } })
  return out
}
export function allProps(L) {
  return propList(L).map((d) => ({ ...d, prop: resolveProp(L, d.key) })).filter((d) => d.prop)
}

export function makeEffect(type) {
  const def = EFFECTS[type]
  return { id: uid('e'), type, enabled: true, params: Object.fromEntries(Object.entries(def.params).map(([k, d]) => [k, P(d.v)])), opts: { ...def.opts } }
}
export function makeAnimator(over = {}) {
  const props = Object.fromEntries(Object.entries(ANIM_PROPS).map(([k, d]) => [k, P(clone(d.v))]))
  return { id: uid('a'), name: 'Animator', enabled: true, unit: 'chars', shape: 'square', props, ...over }
}

// ---------- sanitising (project files, autosave) ----------
const num = (v, d, a = -1e9, b = 1e9) => (Number.isFinite(+v) ? clamp(+v, a, b) : d)
export function sanitizeDoc(raw) {
  if (!raw || typeof raw !== 'object' || !raw.comp || !Array.isArray(raw.layers)) throw new Error('This file is not a Motion Studio project.')
  const c = raw.comp, L = COMP_LIMITS
  const doc = makeDoc({
    name: String(c.name || 'Composition 1').slice(0, 80), width: Math.round(num(c.width, 1920, L.minSize, L.maxSize)), height: Math.round(num(c.height, 1080, L.minSize, L.maxSize)),
    fps: Math.round(num(c.fps, 30, 1, L.maxFps)), duration: num(c.duration, 5, 0.1, L.maxDuration), bg: /^#[0-9a-f]{6}$/i.test(c.bg) ? c.bg : '#14141c', transparent: !!c.transparent,
  })
  const fixProp = (p, def) => {
    const o = { v: p && p.v !== undefined ? p.v : clone(def) }
    if (p && Array.isArray(p.k) && p.k.length) {
      o.k = p.k.filter((k) => k && Number.isFinite(+k.t) && k.v !== undefined).map((k) => ({ id: k.id || uid('k'), t: Math.max(0, +k.t), v: k.v, ...(k.e ? { e: k.e } : {}) }))
      o.k.sort((a, b) => a.t - b.t)
      if (!o.k.length) delete o.k
    }
    return o
  }
  const fixLayer = (r) => {
    if (!r || !['text', 'shape', 'image', 'solid', 'group'].includes(r.type)) return null
    const tmp = makeLayer(doc, r.type, { name: r.name || 'Layer' })
    const l = { ...tmp, id: r.id || tmp.id, name: String(r.name || tmp.name).slice(0, 80), visible: r.visible !== false, locked: !!r.locked,
      inPoint: num(r.inPoint, 0, 0, doc.comp.duration), outPoint: num(r.outPoint, doc.comp.duration, 0, doc.comp.duration), blend: BLENDS.some((b) => b[0] === r.blend) ? r.blend : 'source-over' }
    for (const [k, d] of Object.entries(tmp.props)) l.props[k] = fixProp(r.props?.[k], d.v)
    l.data = { ...tmp.data, ...(r.data || {}) }
    l.effects = (r.effects || []).filter((e) => EFFECTS[e?.type]).map((e) => {
      const fx = makeEffect(e.type)
      fx.id = e.id || fx.id; fx.enabled = e.enabled !== false; fx.opts = { ...fx.opts, ...(e.opts || {}) }
      for (const k of Object.keys(fx.params)) fx.params[k] = fixProp(e.params?.[k], fx.params[k].v)
      return fx
    })
    if (r.type === 'text') {
      l.animators = (r.animators || []).map((a) => {
        const an = makeAnimator({ id: a.id || uid('a'), name: String(a.name || 'Animator'), enabled: a.enabled !== false, unit: ['chars', 'words', 'lines'].includes(a.unit) ? a.unit : 'chars', shape: ['square', 'ramp', 'smooth'].includes(a.shape) ? a.shape : 'square' })
        for (const k of Object.keys(an.props)) an.props[k] = fixProp(a.props?.[k], an.props[k].v)
        return an
      })
    }
    if (r.type === 'group') l.children = (r.children || []).map(fixLayer).filter(Boolean)
    return l
  }
  doc.layers = raw.layers.map(fixLayer).filter(Boolean)
  return doc
}
