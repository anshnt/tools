// Animation presets (applied to the selected layers starting at the playhead) and quick-start templates.
import { uid, clone, valueAt, EASE } from './_anim.js'
import { makeDoc, makeLayer, makeEffect, makeAnimator } from './_model.js'

const OVER = EASE.overshoot, OUT = EASE.easeOut, IN = EASE.easeIn, IO = EASE.easeInOut

/** Replace the keyframes of p inside the time span of `list` ([[t, value, ease?], ...]). */
function keys(p, list) {
  const lo = list[0][0] - 1e-4, hi = list[list.length - 1][0] + 1e-4
  const keep = (p.k || []).filter((k) => k.t < lo || k.t > hi)
  p.k = [...keep, ...list.map(([t, v, e]) => ({ id: uid('k'), t, v: clone(v), ...(e ? { e: clone(e) } : {}) }))].sort((a, b) => a.t - b.t)
}
const val = (p, t) => clone(p.k?.length ? valueAt(p, t) : p.v)

export const PRESETS = [
  { id: 'fade-in', label: 'Fade in', group: 'Fade', apply: (L, t) => { const o = val(L.props.opacity, t + 0.6); keys(L.props.opacity, [[t, 0, OUT], [t + 0.6, o]]) } },
  { id: 'fade-out', label: 'Fade out', group: 'Fade', apply: (L, t) => { const o = val(L.props.opacity, t); keys(L.props.opacity, [[t, o, IN], [t + 0.6, 0]]) } },
  ...[['left', 'Slide in from left', [-1, 0]], ['right', 'Slide in from right', [1, 0]], ['top', 'Slide in from top', [0, -1]], ['bottom', 'Slide in from bottom', [0, 1]]].map(([id, label, [dx, dy]]) => ({
    id: `slide-${id}`, label, group: 'Slide', apply: (L, t, doc) => {
      const p = L.props.position, end = val(p, t + 0.7), o = val(L.props.opacity, t + 0.5)
      const dist = dx ? doc.comp.width * 0.3 : doc.comp.height * 0.3
      keys(p, [[t, [end[0] + dx * dist, end[1] + dy * dist], OUT], [t + 0.7, end]])
      keys(L.props.opacity, [[t, 0, OUT], [t + 0.5, o]])
    },
  })),
  { id: 'pop', label: 'Pop in', group: 'Scale', apply: (L, t) => { const s = val(L.props.scale, t + 0.5), o = val(L.props.opacity, t + 0.15); keys(L.props.scale, [[t, [0, 0], OVER], [t + 0.5, s]]); keys(L.props.opacity, [[t, 0, OUT], [t + 0.15, o]]) } },
  { id: 'zoom-out', label: 'Zoom out to fit', group: 'Scale', apply: (L, t) => { const s = val(L.props.scale, t + 0.9), o = val(L.props.opacity, t + 0.4); keys(L.props.scale, [[t, s.map((n) => n * 1.6), OUT], [t + 0.9, s]]); keys(L.props.opacity, [[t, 0, OUT], [t + 0.4, o]]) } },
  { id: 'pulse', label: 'Pulse', group: 'Scale', apply: (L, t) => { const s = val(L.props.scale, t); keys(L.props.scale, [[t, s, IO], [t + 0.4, s.map((n) => n * 1.15), IO], [t + 0.8, s]]) } },
  { id: 'bounce', label: 'Bounce drop', group: 'Motion', apply: (L, t, doc) => {
    const p = L.props.position, y = val(p, t + 1)
    const at = (dy) => [y[0], y[1] + dy]
    keys(p, [[t, at(-doc.comp.height * 0.6), IN], [t + 0.42, at(0), OUT], [t + 0.6, at(-120), IN], [t + 0.76, at(0), OUT], [t + 0.87, at(-40), IN], [t + 0.96, at(0)]])
  } },
  { id: 'shake', label: 'Shake', group: 'Motion', apply: (L, t) => { const p = L.props.position, v = val(p, t); keys(p, [0, 1, 2, 3, 4, 5, 6].map((i) => [t + i * 0.07, [v[0] + (i % 2 ? 18 : -18) * (i === 6 ? 0 : 1), v[1]], IO])) } },
  { id: 'spin-in', label: 'Spin in', group: 'Motion', apply: (L, t) => {
    const r = val(L.props.rotation, t + 0.9), s = val(L.props.scale, t + 0.9)
    keys(L.props.rotation, [[t, r - 360, OUT], [t + 0.9, r]]); keys(L.props.scale, [[t, [0, 0], OUT], [t + 0.9, s]])
  } },
  { id: 'draw-on', label: 'Draw on (trim path)', group: 'Shape', types: ['shape'], apply: (L, t) => { keys(L.props.trimEnd, [[t, 0, IO], [t + 1.2, 100]]) } },
  { id: 'draw-off', label: 'Draw off (trim path)', group: 'Shape', types: ['shape'], apply: (L, t) => { keys(L.props.trimStart, [[t, 0, IO], [t + 1.2, 100]]) } },
  { id: 'typewriter', label: 'Typewriter', group: 'Text', types: ['text'], apply: (L, t) => {
    const an = makeAnimator({ name: 'Typewriter', unit: 'chars', shape: 'square' })
    const n = Array.from(L.data.text).length
    keys(an.props.start, [[t, 0], [t + Math.max(0.4, n * 0.07), 100]])
    L.animators.push(an)
  } },
  { id: 'fade-per-char', label: 'Fade in per character', group: 'Text', types: ['text'], apply: (L, t) => {
    const an = makeAnimator({ name: 'Fade per character', unit: 'chars', shape: 'ramp' })
    an.props.end.v = 30
    keys(an.props.offset, [[t, -30], [t + 1.4, 100]])
    L.animators.push(an)
  } },
  { id: 'rise-per-char', label: 'Rise per character', group: 'Text', types: ['text'], apply: (L, t) => {
    const an = makeAnimator({ name: 'Rise per character', unit: 'chars', shape: 'ramp' })
    an.props.end.v = 30; an.props.position.v = [0, 70]
    keys(an.props.offset, [[t, -30], [t + 1.4, 100]])
    L.animators.push(an)
  } },
  { id: 'words-pop', label: 'Pop in per word', group: 'Text', types: ['text'], apply: (L, t) => {
    const an = makeAnimator({ name: 'Pop per word', unit: 'words', shape: 'ramp' })
    an.props.end.v = 40; an.props.scale.v = [0, 0]
    keys(an.props.offset, [[t, -40], [t + 1.2, 100]])
    L.animators.push(an)
  } },
  { id: 'wave', label: 'Wave', group: 'Text', types: ['text'], apply: (L, t) => {
    const an = makeAnimator({ name: 'Wave', unit: 'chars', shape: 'smooth' })
    an.props.opacity.v = 100; an.props.position.v = [0, -40]; an.props.end.v = 35
    keys(an.props.offset, [[t, -35], [t + 1.6, 100]])
    L.animators.push(an)
  } },
]

export function applyPreset(preset, layers, doc, t) {
  let n = 0
  for (const L of layers) {
    if (preset.types && !preset.types.includes(L.type)) continue
    preset.apply(L, t, doc)
    n++
  }
  return n
}

// ---------- templates ----------
export const TEMPLATES = [
  ['blank', 'Blank 1080p'], ['title-reveal', 'Title reveal'], ['lower-third', 'Lower third'], ['logo-reveal', 'Logo reveal'],
]

export function buildTemplate(id) {
  if (id === 'title-reveal') return titleReveal()
  if (id === 'lower-third') return lowerThird()
  if (id === 'logo-reveal') return logoReveal()
  return makeDoc()
}

const add = (doc, type, o, fn) => { const L = makeLayer(doc, type, o); fn?.(L); doc.layers.unshift(L); return L }

function titleReveal() {
  const doc = makeDoc({ name: 'Title reveal', bg: '#0b0b14' })
  const { width: W, height: H } = doc.comp
  add(doc, 'shape', { name: 'Spotlight', position: [W / 2, H / 2], data: { kind: 'ellipse', w: 1100, h: 520, fill: '#6366f1' } }, (L) => {
    L.props.opacity.v = 30
    L.effects.push(makeEffect('blur'))
    L.effects[0].params.radius.v = 150
    keys(L.props.scale, [[0, [80, 80], IO], [5, [125, 125]]])
  })
  add(doc, 'text', { name: 'Subtitle', position: [W / 2, H / 2 + 175], data: { text: 'Made right in your browser', size: 46, weight: 400, fill: '#c7c7d9', tracking: 6 } }, (L) => {
    keys(L.props.opacity, [[1.6, 0, OUT], [2.4, 100]])
    keys(L.props.position, [[1.6, [W / 2, H / 2 + 205], OUT], [2.4, [W / 2, H / 2 + 175]]])
  })
  add(doc, 'shape', { name: 'Underline', position: [W / 2, H / 2 + 95], data: { kind: 'line', w: 760, strokeWidth: 6, stroke: '#a855f7' } }, (L) => {
    keys(L.props.trimEnd, [[0.9, 0, IO], [1.9, 100]])
  })
  add(doc, 'text', { name: 'Title', position: [W / 2, H / 2 - 30], data: { text: 'MOTION STUDIO', size: 180, weight: 800, tracking: 10 } }, (L) => {
    PRESETS.find((p) => p.id === 'rise-per-char').apply(L, 0.2)
    const glow = makeEffect('glow')
    glow.params.intensity.v = 55
    glow.params.radius.v = 34
    L.effects.push(glow)
  })
  return doc
}

function lowerThird() {
  const doc = makeDoc({ name: 'Lower third', bg: '#0f172a', transparent: true })
  const { width: W, height: H } = doc.comp
  const y = H * 0.8, x = W * 0.3
  const grp = makeLayer(doc, 'group', { name: 'Lower third' })
  const bar = makeLayer(doc, 'shape', { name: 'Bar', position: [x, y], data: { kind: 'rect', w: 820, h: 132, radius: 14, fill: '#6366f1' } })
  const accent = makeLayer(doc, 'shape', { name: 'Accent', position: [x - 410 + 10, y], data: { kind: 'rect', w: 20, h: 132, fill: '#f472b6' } })
  const name = makeLayer(doc, 'text', { name: 'Name', position: [x, y - 25], data: { text: 'Alex Morgan', size: 56, weight: 700 } })
  const role = makeLayer(doc, 'text', { name: 'Role', position: [x, y + 35], data: { text: 'Motion designer', size: 32, weight: 400, fill: '#e0e7ff', tracking: 2 } })
  PRESETS.find((p) => p.id === 'typewriter').apply(name, 0.5)
  grp.children = [role, name, accent, bar]
  keys(grp.props.position, [[0, [-1100, 0], OUT], [0.7, [0, 0]], [3.2, [0, 0], IN], [3.9, [-1100, 0]]])
  grp.outPoint = 4
  doc.comp.duration = 4
  for (const L of [grp, ...grp.children]) L.outPoint = 4
  doc.layers.push(grp)
  return doc
}

function logoReveal() {
  const doc = makeDoc({ name: 'Logo reveal', width: 1080, height: 1080, bg: '#0b0b14', duration: 4 })
  const { width: W, height: H } = doc.comp
  add(doc, 'shape', { name: 'Ring', position: [W / 2, H / 2 - 40], data: { kind: 'ellipse', w: 400, h: 400, fillOn: false, stroke: '#a855f7', strokeWidth: 18 } }, (L) => {
    keys(L.props.trimEnd, [[0.2, 0, IO], [1.3, 100]])
    keys(L.props.rotation, [[0.2, -90, IO], [1.3, 0]])
  })
  add(doc, 'shape', { name: 'Gem', position: [W / 2, H / 2 - 40], data: { kind: 'polygon', sides: 6, w: 230, h: 230, fill: '#6366f1' } }, (L) => {
    keys(L.props.scale, [[1, [0, 0], OVER], [1.6, [100, 100]]])
    keys(L.props.rotation, [[1, -60, OUT], [1.6, 0]])
    L.effects.push(makeEffect('glow'))
  })
  add(doc, 'text', { name: 'Wordmark', position: [W / 2, H / 2 + 270], data: { text: 'NOVA', size: 120, weight: 800, tracking: 28 } }, (L) => {
    PRESETS.find((p) => p.id === 'fade-per-char').apply(L, 1.4)
  })
  return doc
}

/** Playhead time at which a freshly created template shows its content (so the first view is not an empty frame). */
export const showTime = (id) => ({ 'title-reveal': 2.7, 'lower-third': 1.6, 'logo-reveal': 2.8 })[id] || 0
