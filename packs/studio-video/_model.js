// Video Studio document model: plain objects, pure helpers and the undo history. No DOM in here, so it is easy to test
// (run: node packs/studio-video/_model.test.mjs).
//
// project = { v, name, aspect, width, height, fps, bg, tracks: [{id, kind, name, muted, hidden, locked}], clips: [clip] }
// Tracks are listed top to bottom as shown in the timeline; the top-most visual track is drawn last (on top).
// clip.kind: 'video' | 'image' | 'title' | 'audio'. Times are seconds on the timeline; `in` is the source offset in seconds.

export const EPS = 1e-6
export const MIN_DUR = 0.1
export const IMAGE_DUR = 5
export const MAX_SPEED = 4
export const MIN_SPEED = 0.25
export const ASPECTS = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] }
export const FONTS = [
  ['Geist, system-ui, sans-serif', 'Geist'],
  ['Georgia, serif', 'Georgia'],
  ['Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif', 'Impact'],
  ['"Trebuchet MS", sans-serif', 'Trebuchet'],
  ['"Arial Black", Gadget, sans-serif', 'Arial Black'],
  ['"Times New Roman", Times, serif', 'Times'],
  ['"Courier New", monospace', 'Courier'],
  ['"Brush Script MT", cursive', 'Script'],
]

let counter = 0
export const uid = (p = 'c') => `${p}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
export const trans = (type = 'none', dur = 0.5) => ({ type, dur })

export function newProject({ aspect = '16:9', name = 'Untitled project' } = {}) {
  const [width, height] = ASPECTS[aspect] || ASPECTS['16:9']
  return {
    v: 1, name, aspect: ASPECTS[aspect] ? aspect : '16:9', width, height, fps: 30, bg: '#000000',
    tracks: [
      { id: 'T1', kind: 'title', name: 'Titles' },
      { id: 'V2', kind: 'video', name: 'Video 2' },
      { id: 'V1', kind: 'video', name: 'Video 1' },
      { id: 'A1', kind: 'audio', name: 'Audio 1' },
      { id: 'A2', kind: 'audio', name: 'Audio 2' },
    ],
    clips: [],
  }
}

const BASE = () => ({
  in: 0, speed: 1, opacity: 100, scale: 100, x: 0, y: 0, rot: 0, fit: 'contain', volume: 100, fadeIn: 0, fadeOut: 0,
  tin: trans(), tout: trans(), bright: 100, contrast: 100, sat: 100,
})
export const TITLE_DEFAULTS = () => ({
  text: 'Your title', font: FONTS[0][0], size: 9, color: '#ffffff', bold: true, italic: false, align: 'center',
  bg: '#000000', bgOpacity: 0, strokeColor: '#000000', strokeW: 0, shadow: true,
})

export function makeClip(kind, track, start, dur, extra = {}) {
  return { id: uid(), kind, track, start, dur, name: '', ...BASE(), ...(kind === 'title' ? TITLE_DEFAULTS() : {}), ...extra }
}

/** Fill in fields missing from an older or hand-edited project so the editor never sees undefined. */
export function normalize(p) {
  const base = newProject({ aspect: p?.aspect })
  const out = { ...base, ...p }
  if (!Array.isArray(out.tracks) || !out.tracks.length) out.tracks = base.tracks
  out.clips = (Array.isArray(p?.clips) ? p.clips : []).filter((c) => c && c.id && out.tracks.some((t) => t.id === c.track))
    .map((c) => ({ ...BASE(), ...(c.kind === 'title' ? TITLE_DEFAULTS() : {}), ...c, tin: { ...trans(), ...c.tin }, tout: { ...trans(), ...c.tout } }))
  return out
}

export const clipEnd = (c) => c.start + c.dur
export const srcTime = (c, t) => c.in + (t - c.start) * c.speed
export const trackById = (p, id) => p.tracks.find((t) => t.id === id)
export const clipById = (p, id) => p.clips.find((c) => c.id === id)
export const clipsOn = (p, trackId) => p.clips.filter((c) => c.track === trackId).sort((a, b) => a.start - b.start)
export const projectDuration = (p) => p.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0)
const LANE = { video: 'video', image: 'video', title: 'title', audio: 'audio' }
export const laneKind = (clipKind) => LANE[clipKind]
export const fits = (clipKind, trackKind) => LANE[clipKind] === trackKind

/** Nearest start >= 0 where a clip of `dur` fits on the track without touching other clips (ignoring the ids in `ignore`). */
export function freeStart(p, trackId, start, dur, ignore = new Set()) {
  const others = clipsOn(p, trackId).filter((c) => !ignore.has(c.id))
  const ok = (s) => s >= -EPS && others.every((o) => s + dur <= o.start + EPS || s >= clipEnd(o) - EPS)
  start = Math.max(0, start)
  if (ok(start)) return start
  let best = null
  for (const o of others) for (const s of [clipEnd(o), o.start - dur]) if (s >= 0 && ok(s) && (best === null || Math.abs(s - start) < Math.abs(best - start))) best = s
  return best ?? start
}

export const trackEnd = (p, trackId) => clipsOn(p, trackId).reduce((m, c) => Math.max(m, clipEnd(c)), 0)

/** Remove clips; with ripple, later clips on the same track slide left to close the gap. */
export function removeClips(p, ids, ripple) {
  const set = new Set(ids)
  const gone = p.clips.filter((c) => set.has(c.id)).sort((a, b) => b.start - a.start)
  p.clips = p.clips.filter((c) => !set.has(c.id))
  if (!ripple) return
  for (const r of gone) for (const c of p.clips) if (c.track === r.track && c.start >= clipEnd(r) - EPS) c.start = Math.max(0, c.start - r.dur)
}

/** Split the clip at timeline time t. Returns the new (right-hand) clip id, or null when t is too close to an edge. */
export function splitClip(p, id, t) {
  const c = clipById(p, id)
  if (!c || t <= c.start + 0.04 || t >= clipEnd(c) - 0.04) return null
  const d = t - c.start
  const b = structuredClone(c)
  b.id = uid()
  b.start = t
  b.dur = c.dur - d
  b.in = c.in + d * c.speed
  b.tin = trans('none', c.tin.dur)
  b.fadeIn = 0
  c.dur = d
  c.tout = trans('none', c.tout.dur)
  c.fadeOut = 0
  p.clips.push(b)
  return b.id
}

/** Change playback speed keeping the source range, shortening the clip when the next clip is in the way. */
export function setSpeed(p, c, speed) {
  speed = clamp(speed, MIN_SPEED, MAX_SPEED)
  const span = c.dur * c.speed
  let dur = span / speed
  const next = clipsOn(p, c.track).find((o) => o.id !== c.id && o.start >= clipEnd(c) - EPS)
  if (next && c.start + dur > next.start + EPS) dur = Math.max(MIN_DUR, next.start - c.start)
  c.speed = speed
  c.dur = dur
}

export function snapPoints(p, exclude = new Set(), extra = []) {
  const pts = [0, ...extra]
  for (const c of p.clips) if (!exclude.has(c.id)) pts.push(c.start, clipEnd(c))
  return pts
}
/** Snap t to the closest point within `thr` seconds. Returns {t, hit}. */
export function snapTime(t, points, thr) {
  let best = null
  for (const x of points) if (Math.abs(x - t) <= thr && (best === null || Math.abs(x - t) < Math.abs(best - t))) best = x
  return best === null ? { t, hit: null } : { t: best, hit: best }
}

const ramp = (x) => clamp(x, 0, 1)
/**
 * Everything to draw at time t, bottom to top: [{clip, t, alpha, dip, ghost}].
 * alpha is 0..1 opacity (clip opacity and fades); dip is a black overlay 0..1 drawn right after the layer;
 * ghost layers are the outgoing clip kept alive underneath an incoming crossfade.
 */
export function layersAt(p, t) {
  const layers = []
  for (let i = p.tracks.length - 1; i >= 0; i--) {
    const tr = p.tracks[i]
    if (tr.kind === 'audio' || tr.hidden) continue
    const on = clipsOn(p, tr.id)
    for (const c of on) {
      const end = clipEnd(c)
      if (t < c.start - EPS || t >= end - EPS) continue
      const lt = t - c.start
      let alpha = c.opacity / 100
      let dip = 0
      if (c.kind === 'title') {
        if (c.fadeIn > 0) alpha *= ramp(lt / c.fadeIn)
        if (c.fadeOut > 0) alpha *= ramp((c.dur - lt) / c.fadeOut)
      } else {
        const a = c.tin, b = c.tout
        if (a.type !== 'none' && a.dur > 0 && lt < a.dur) {
          const k = ramp(lt / a.dur)
          if (a.type === 'crossfade') {
            alpha *= k
            const prev = on.find((o) => o !== c && Math.abs(clipEnd(o) - c.start) < 1e-3)
            if (prev) layers.push({ clip: prev, t, alpha: prev.opacity / 100, dip: 0, ghost: true })
          } else dip = Math.max(dip, 1 - k)
        }
        if (b.type !== 'none' && b.dur > 0 && c.dur - lt < b.dur) {
          const k = ramp((c.dur - lt) / b.dur)
          if (b.type === 'fade') alpha *= k
          else dip = Math.max(dip, 1 - k)
        }
      }
      layers.push({ clip: c, t, alpha, dip, ghost: false })
    }
  }
  return layers
}

/** Gain 0..1+ of an audio-bearing clip at timeline time t (volume and fades). */
export function gainAt(c, t) {
  const a = c.fadeIn > 0 ? ramp((t - c.start) / c.fadeIn) : 1
  const b = c.fadeOut > 0 ? ramp((clipEnd(c) - t) / c.fadeOut) : 1
  return (c.volume / 100) * a * b
}

/** Undo history: a stack of whole-project snapshots (projects are small, media blobs live elsewhere). */
export class Doc {
  constructor(project) {
    this.p = project
    this.undoStack = []
    this.redoStack = []
    this.subs = new Set()
    this._key = null
    this._at = 0
  }
  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn) }
  emit(kind = 'change') { for (const fn of [...this.subs]) fn(kind) }
  snapshot() { return structuredClone(this.p) }
  pushUndo(label, snap) {
    this.undoStack.push({ label, state: snap })
    if (this.undoStack.length > 120) this.undoStack.shift()
    this.redoStack = []
  }
  /** Run fn(project) as one undoable step. Steps with the same `key` within 800 ms merge (slider drags, typing). */
  commit(label, fn, { key = null } = {}) {
    const now = Date.now()
    const merge = key && key === this._key && now - this._at < 800 && this.undoStack.length
    if (!merge) this.pushUndo(label, this.snapshot())
    this._key = key
    this._at = now
    fn(this.p)
    this.emit('change')
  }
  get canUndo() { return this.undoStack.length > 0 }
  get canRedo() { return this.redoStack.length > 0 }
  undo() {
    const s = this.undoStack.pop()
    if (!s) return null
    this.redoStack.push({ label: s.label, state: this.snapshot() })
    this.p = s.state
    this._key = null
    this.emit('undo')
    return s.label
  }
  redo() {
    const s = this.redoStack.pop()
    if (!s) return null
    this.undoStack.push({ label: s.label, state: this.snapshot() })
    this.p = s.state
    this._key = null
    this.emit('redo')
    return s.label
  }
  /** Replace the whole project (new/open) and forget the history. */
  reset(project) {
    this.p = project
    this.undoStack = []
    this.redoStack = []
    this._key = null
    this.emit('reset')
  }
}

export function timecode(t, fps = 30) {
  t = Math.max(0, t)
  const f = Math.floor((t % 1) * fps + 1e-6)
  const s = Math.floor(t) % 60, m = Math.floor(t / 60) % 60, hh = Math.floor(t / 3600)
  const two = (n) => String(n).padStart(2, '0')
  return `${hh ? hh + ':' : ''}${two(m)}:${two(s)}:${two(f)}`
}
