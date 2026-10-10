// Keyframe animation core: a property is {v} (static) or {v, k: [{id, t, v, e}]} (animated).
// Keyframe easing `e` describes the curve from that keyframe to the next one: undefined = linear, 'hold', or a cubic bezier [x1, y1, x2, y2].
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
export const uid = (p = '') => p + Math.random().toString(36).slice(2, 9)
export const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)))

export const EASES = [
  ['linear', 'Linear', [0, 0, 1, 1]],
  ['easeInOut', 'Ease in and out', [0.42, 0, 0.58, 1]],
  ['easeIn', 'Ease in', [0.42, 0, 1, 1]],
  ['easeOut', 'Ease out', [0, 0, 0.58, 1]],
  ['overshoot', 'Overshoot', [0.34, 1.56, 0.64, 1]],
  ['hold', 'Hold', 'hold'],
]
export const EASE = Object.fromEntries(EASES.map(([k, , v]) => [k, v]))
export const DEFAULT_EASE = EASE.easeInOut

/** Name of the easing preset a value matches, or 'custom'. */
export function easeName(e) {
  if (!e) return 'linear'
  for (const [k, , v] of EASES) if (v === e || (Array.isArray(v) && Array.isArray(e) && v.every((x, i) => Math.abs(x - e[i]) < 1e-3))) return k
  return 'custom'
}

/** CSS-style cubic-bezier solver: returns y for a given x in 0..1. */
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const X = (t) => ((ax * t + bx) * t + cx) * t
  const Y = (t) => ((ay * t + by) * t + cy) * t
  const dX = (t) => (3 * ax * t + 2 * bx) * t + cx
  return (x) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 8; i++) {
      const err = X(t) - x
      if (Math.abs(err) < 1e-6) return Y(t)
      const d = dX(t)
      if (Math.abs(d) < 1e-6) break
      t -= err / d
    }
    let lo = 0, hi = 1
    t = x
    for (let i = 0; i < 40; i++) {
      const err = X(t)
      if (Math.abs(err - x) < 1e-6) break
      if (x > err) lo = t; else hi = t
      t = (lo + hi) / 2
    }
    return Y(t)
  }
}
const fnCache = new Map()
const LINEAR = (x) => x
export function easeFn(e) {
  if (!Array.isArray(e)) return LINEAR
  const key = e.join(',')
  let f = fnCache.get(key)
  if (!f) { f = bezier(...e); fnCache.set(key, f) }
  return f
}

/** Value of a property at time t (seconds). Arrays are returned as-is for static props, so never mutate the result. */
export function valueAt(p, t) {
  const k = p.k
  if (!k || !k.length) return p.v
  if (t <= k[0].t) return k[0].v
  const last = k[k.length - 1]
  if (t >= last.t) return last.v
  let i = 0
  while (k[i + 1].t <= t) i++
  const a = k[i], b = k[i + 1]
  if (a.e === 'hold') return a.v
  const e = easeFn(a.e)((t - a.t) / (b.t - a.t))
  return Array.isArray(a.v) ? a.v.map((x, j) => x + (b.v[j] - x) * e) : a.v + (b.v - a.v) * e
}

export const isAnimated = (p) => !!(p.k && p.k.length)
const EPS = 1e-4
export const keyAt = (p, t) => p.k?.find((k) => Math.abs(k.t - t) < EPS)

/** Set the value at time t: updates the static value, or adds/updates a keyframe when the property is animated. */
export function setValue(p, t, v, ease = DEFAULT_EASE) {
  v = clone(v)
  if (!isAnimated(p)) { p.v = v; return null }
  return setKey(p, t, v, ease)
}
export function setKey(p, t, v, ease = DEFAULT_EASE) {
  p.k ||= []
  let kf = keyAt(p, t)
  if (kf) kf.v = clone(v)
  else {
    kf = { id: uid('k'), t: Math.max(0, t), v: clone(v) }
    if (ease) kf.e = clone(ease)
    p.k.push(kf)
    p.k.sort((a, b) => a.t - b.t)
  }
  return kf
}
export function removeKey(p, id) {
  if (!p.k) return
  const i = p.k.findIndex((k) => k.id === id)
  if (i < 0) return
  if (p.k.length === 1) { p.v = clone(p.k[0].v); delete p.k } else p.k.splice(i, 1)
}
/** Stopwatch on: start animating from the current value. */
export function enableAnim(p, t) {
  if (isAnimated(p)) return
  p.k = [{ id: uid('k'), t: Math.max(0, t), v: clone(p.v), e: clone(DEFAULT_EASE) }]
}
/** Stopwatch off: freeze the value at time t and drop keyframes. */
export function disableAnim(p, t) {
  if (!isAnimated(p)) return
  p.v = clone(valueAt(p, t))
  delete p.k
}
/** Re-sort after times were edited, merging keyframes that landed on the same time (later one wins). */
export function normalizeKeys(p) {
  if (!p.k) return
  p.k.sort((a, b) => a.t - b.t)
  const out = []
  for (const k of p.k) {
    const prev = out[out.length - 1]
    if (prev && Math.abs(prev.t - k.t) < EPS) out[out.length - 1] = k
    else out.push(k)
  }
  p.k = out
}
/** Nearest keyframe time before/after t (or null). */
export const prevKey = (p, t) => (p.k || []).filter((k) => k.t < t - EPS).at(-1) || null
export const nextKey = (p, t) => (p.k || []).find((k) => k.t > t + EPS) || null
