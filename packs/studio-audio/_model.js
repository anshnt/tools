// Document model for Audio Studio: plain objects only (so snapshots, autosave and project files are just JSON),
// plus the pure edit operations (split, cut, paste, trim...) and the undo history.
export const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#a855f7', '#ef4444', '#84cc16']
export const EPS = 0.001
export const MAX_TRACKS = 32

let counter = 0
export const uid = (p = 'x') => `${p}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

export const defaultFx = () => ({
  gate: { on: false, threshold: -45, attack: 0.005, release: 0.12, hold: 0.06, range: -80 },
  eq: { on: false, low: 0, mid: 0, midFreq: 1000, high: 0 },
  comp: { on: false, threshold: -24, ratio: 4, attack: 0.01, release: 0.2, knee: 10, makeup: 0 },
  delay: { on: false, time: 0.3, feedback: 0.35, mix: 0.3 },
  reverb: { on: false, decay: 1.8, mix: 0.25 },
})

const preset = (patch) => () => {
  const f = defaultFx()
  for (const [k, v] of Object.entries(patch)) f[k] = { ...f[k], ...v, on: true }
  return f
}
export const FX_PRESETS = {
  flat: defaultFx,
  voice: preset({ gate: { threshold: -52 }, eq: { low: -3, mid: 2, midFreq: 2800, high: 2 }, comp: { threshold: -22, ratio: 3, makeup: 4 } }),
  vocal: preset({ eq: { low: -2, mid: 1.5, midFreq: 3200, high: 3 }, comp: { threshold: -20, ratio: 3.5, makeup: 3 }, reverb: { decay: 2.2, mix: 0.28 } }),
  echo: preset({ delay: { time: 0.25, feedback: 0.4, mix: 0.35 }, reverb: { decay: 1.2, mix: 0.12 } }),
  radio: preset({ eq: { low: -14, mid: 6, midFreq: 1600, high: -8 }, comp: { threshold: -30, ratio: 8, attack: 0.003, release: 0.1, makeup: 8 } }),
}
export const PRESET_LIST = [['flat', 'Flat (all effects off)'], ['voice', 'Clear voice'], ['vocal', 'Vocal with reverb'], ['echo', 'Slapback echo'], ['radio', 'Radio']]

export function newTrack(name, index = 0, fx) {
  return { id: uid('t'), name, color: COLORS[index % COLORS.length], vol: 0, pan: 0, mute: false, solo: false, fx: fx || defaultFx(), clips: [] }
}

export const TEMPLATES = {
  blank: { name: 'Blank project', tracks: [] },
  podcast: { name: 'Podcast', bpm: 120, tracks: [['Host', 'voice'], ['Guest', 'voice'], ['Music', 'flat', -12]] },
  music: { name: 'Music sketch', bpm: 100, grid: '1/4', tracks: [['Drums'], ['Bass'], ['Keys'], ['Vocals', 'vocal']] },
  voiceover: { name: 'Voice-over', tracks: [['Voice', 'voice']] },
}
export function newProject(template = 'blank') {
  const t = TEMPLATES[template] || TEMPLATES.blank
  const p = {
    v: 1, name: t.name === 'Blank project' ? 'Untitled project' : `${t.name} project`, bpm: t.bpm || 120, beats: 4, grid: t.grid || 'off', snap: true,
    metro: false, metroVol: 0.5, ripple: false, follow: true, trackH: 104, masterVol: 0, loop: { on: false, start: 0, end: 8 }, tracks: [],
  }
  ;(t.tracks || []).forEach(([name, fx, vol], i) => {
    const tr = newTrack(name, i, FX_PRESETS[fx]?.())
    if (vol != null) tr.vol = vol
    p.tracks.push(tr)
  })
  return p
}

/** Fill in anything a project file or an older save might be missing. */
export function fixProject(raw) {
  const base = newProject()
  const p = { ...base, ...raw, loop: { ...base.loop, ...(raw.loop || {}) } }
  p.tracks = (raw.tracks || []).slice(0, MAX_TRACKS).map((t, i) => {
    const d = newTrack('Track', i)
    const fx = defaultFx()
    for (const k of Object.keys(fx)) fx[k] = { ...fx[k], ...(t.fx?.[k] || {}) }
    return { ...d, ...t, fx, clips: (t.clips || []).filter((c) => c && c.asset && c.dur > 0).map((c) => ({ gain: 1, fadeIn: 0, fadeOut: 0, offset: 0, ...c })) }
  })
  return p
}

export function newClip(asset, start = 0) {
  return { id: uid('c'), asset: asset.id, name: asset.name.replace(/\.[^.]+$/, ''), start, offset: 0, dur: asset.duration, gain: 1, fadeIn: 0, fadeOut: 0 }
}

export const clipEnd = (c) => c.start + c.dur
export const projectLength = (p) => p.tracks.reduce((m, t) => t.clips.reduce((mm, c) => Math.max(mm, clipEnd(c)), m), 0)
export const findClip = (p, id) => {
  for (const t of p.tracks) { const c = t.clips.find((x) => x.id === id); if (c) return { track: t, clip: c } }
  return null
}
export const usedAssets = (p) => new Set(p.tracks.flatMap((t) => t.clips.map((c) => c.asset)))

/** Seconds of reverb and echo tail to render after the last clip so effects are not cut off. */
export function tailSeconds(p) {
  let tail = 0
  for (const t of p.tracks) {
    if (t.fx.reverb.on) tail = Math.max(tail, t.fx.reverb.decay + 0.1)
    if (t.fx.delay.on) {
      const fb = Math.min(0.9, t.fx.delay.feedback)
      tail = Math.max(tail, t.fx.delay.time * Math.min(12, Math.ceil(Math.log(0.001) / Math.log(Math.max(fb, 0.05)))))
    }
  }
  return Math.min(tail, 12)
}

// ---------- Edit operations (each mutates the project it is given) ----------
/** Split a clip in two at timeline time t. Returns the new right-hand clip, or null when t is not inside the clip. */
export function splitClip(track, clip, t) {
  const end = clipEnd(clip)
  if (t <= clip.start + EPS || t >= end - EPS) return null
  const right = { ...clip, id: uid('c'), start: t, offset: clip.offset + (t - clip.start), dur: end - t, fadeIn: 0 }
  clip.dur = t - clip.start
  clip.fadeOut = 0
  clip.fadeIn = Math.min(clip.fadeIn, clip.dur)
  right.fadeOut = Math.min(right.fadeOut, right.dur)
  track.clips.splice(track.clips.indexOf(clip) + 1, 0, right)
  return right
}

/** Split every clip of a track at both edges of [t0, t1]. Returns the clips that now lie inside the range. */
export function splitRange(track, t0, t1) {
  for (const c of [...track.clips]) {
    const r = splitClip(track, c, t0) || c
    splitClip(track, r, t1)
  }
  return track.clips.filter((c) => c.start >= t0 - EPS && clipEnd(c) <= t1 + EPS && c.dur > EPS)
}

/** Remove the audio between t0 and t1 from a track. With ripple, later clips slide left to close the gap. */
export function removeRange(track, t0, t1, ripple = false) {
  const out = []
  for (const c of track.clips) {
    const s = c.start, e = clipEnd(c)
    if (e <= t0 + EPS || s >= t1 - EPS) { out.push(c); continue }
    if (s >= t0 - EPS && e <= t1 + EPS) continue
    if (s < t0 - EPS && e > t1 + EPS) {
      const right = { ...c, id: uid('c'), start: t1, offset: c.offset + (t1 - s), dur: e - t1, fadeIn: 0 }
      c.dur = t0 - s
      c.fadeOut = 0
      c.fadeIn = Math.min(c.fadeIn, c.dur)
      right.fadeOut = Math.min(right.fadeOut, right.dur)
      out.push(c, right)
    } else if (s < t0 - EPS) {
      c.dur = t0 - s
      c.fadeOut = 0
      c.fadeIn = Math.min(c.fadeIn, c.dur)
      out.push(c)
    } else {
      c.offset += t1 - s
      c.dur = e - t1
      c.start = t1
      c.fadeIn = 0
      c.fadeOut = Math.min(c.fadeOut, c.dur)
      out.push(c)
    }
  }
  track.clips = out
  if (ripple) for (const c of out) if (c.start >= t1 - EPS) c.start -= t1 - t0
}

/** Copy of the clip pieces inside [t0, t1], positioned relative to t0 (clipboard format). */
export function extractRange(track, t0, t1) {
  const items = []
  for (const c of track.clips) {
    const s = Math.max(c.start, t0)
    const e = Math.min(clipEnd(c), t1)
    if (e - s < EPS) continue
    items.push({
      ...c, id: undefined, start: s - t0, offset: c.offset + (s - c.start), dur: e - s,
      fadeIn: s <= c.start + EPS ? Math.min(c.fadeIn, e - s) : 0, fadeOut: e >= clipEnd(c) - EPS ? Math.min(c.fadeOut, e - s) : 0,
    })
  }
  return items
}

/** Insert clipboard items on a track at time t. Returns the new clips. */
export function pasteItems(track, items, t) {
  return items.map((it) => {
    const c = { ...it, id: uid('c'), start: it.start + t }
    track.clips.push(c)
    return c
  })
}

/** Crop every clip that overlaps [t0, t1] down to that range. Clips outside the range are left alone. */
export function trimToRange(track, t0, t1) {
  for (const c of track.clips) {
    const end = clipEnd(c)
    const s = Math.max(c.start, t0)
    const e = Math.min(end, t1)
    if (e - s < EPS) continue
    if (s > c.start + EPS) { c.offset += s - c.start; c.start = s; c.fadeIn = 0 }
    if (e < end - EPS) c.fadeOut = 0
    c.dur = e - c.start
    c.fadeIn = Math.min(c.fadeIn, c.dur)
    c.fadeOut = Math.min(c.fadeOut, c.dur)
  }
}

export function duplicateClip(track, clip) {
  const c = { ...clip, id: uid('c'), start: clipEnd(clip) }
  track.clips.push(c)
  return c
}

/** Keep fades inside the clip and the clip inside its source audio. */
export function clampClip(c, assetDuration) {
  c.offset = Math.max(0, c.offset)
  if (assetDuration) c.dur = Math.min(c.dur, assetDuration - c.offset)
  c.dur = Math.max(EPS * 5, c.dur)
  c.start = Math.max(0, c.start)
  c.fadeIn = Math.max(0, Math.min(c.fadeIn, c.dur))
  c.fadeOut = Math.max(0, Math.min(c.fadeOut, c.dur - c.fadeIn))
}

// ---------- Undo history (JSON snapshots; audio data is never part of them) ----------
export class History {
  constructor(limit = 120) {
    this.undoStack = []
    this.redoStack = []
    this.limit = limit
    this.lastKey = null
    this.lastAt = 0
  }
  /** Record the state before an edit. Edits sharing a key within 900 ms (slider drags) merge into one step. */
  record(label, before, key) {
    const now = Date.now()
    this.redoStack.length = 0
    if (key && key === this.lastKey && now - this.lastAt < 900 && this.undoStack.length) { this.lastAt = now; return }
    this.undoStack.push({ label, json: before })
    if (this.undoStack.length > this.limit) this.undoStack.shift()
    this.lastKey = key || null
    this.lastAt = now
  }
  undo(current) {
    const e = this.undoStack.pop()
    if (!e) return null
    this.redoStack.push({ label: e.label, json: current })
    this.lastKey = null
    return e
  }
  redo(current) {
    const e = this.redoStack.pop()
    if (!e) return null
    this.undoStack.push({ label: e.label, json: current })
    this.lastKey = null
    return e
  }
  clear() { this.undoStack = []; this.redoStack = []; this.lastKey = null }
  get canUndo() { return this.undoStack.length > 0 }
  get canRedo() { return this.redoStack.length > 0 }
}
