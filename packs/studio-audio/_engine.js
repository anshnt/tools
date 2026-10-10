// WebAudio engine for Audio Studio. The same per-track graph and clip scheduling code drives both real-time playback
// (Engine) and the offline export render (renderMix), so what you hear is what you export.
import { SR, dbToGain, impulseData, gateEnvelope } from './_dsp.js'
import { clipEnd, projectLength, tailSeconds } from './_model.js'

export const isAudible = (project, track) => !track.mute && (!project.tracks.some((t) => t.solo) || track.solo)

// ---------- Caches ----------
const gateCache = new WeakMap()
function gateFor(asset, g) {
  let m = gateCache.get(asset)
  if (!m) gateCache.set(asset, (m = new Map()))
  const key = `${g.threshold}|${g.attack}|${g.release}|${g.hold}|${g.range}`
  let r = m.get(key)
  if (!r) {
    r = gateEnvelope(asset.chans, asset.length, asset.sampleRate, g)
    m.set(key, r)
    if (m.size > 6) m.delete(m.keys().next().value)
  }
  return r
}
const irCache = new Map()
function impulseFor(ctx, decay) {
  const key = `${ctx.sampleRate}:${decay.toFixed(2)}`
  let d = irCache.get(key)
  if (!d) {
    d = impulseData(ctx.sampleRate, decay)
    irCache.set(key, d)
    if (irCache.size > 10) irCache.delete(irCache.keys().next().value)
  }
  const b = ctx.createBuffer(2, d[0].length, ctx.sampleRate)
  b.copyToChannel(d[0], 0)
  b.copyToChannel(d[1], 1)
  return b
}

// ---------- Per-track effect chain ----------
// input -> [EQ] -> [compressor] -> (dry) --------------------+-> volume -> pan (equal power) -> out
//                                  +-> [delay] -> wet --------+
//                                  +-> [reverb] -> wet -------+
// The noise gate runs per clip, before the chain (see scheduleClip).
export function buildChain(ctx) {
  const g = () => ctx.createGain()
  const n = {
    input: g(), lo: ctx.createBiquadFilter(), mid: ctx.createBiquadFilter(), hi: ctx.createBiquadFilter(), comp: ctx.createDynamicsCompressor(), makeup: g(),
    dly: ctx.createDelay(2), fb: g(), dlyWet: g(), conv: ctx.createConvolver(), revWet: g(), sum: g(), vol: g(), split: ctx.createChannelSplitter(2), gl: g(), gr: g(), merge: ctx.createChannelMerger(2), analyser: ctx.createAnalyser(),
  }
  const out = g()
  n.lo.type = 'lowshelf'
  n.lo.frequency.value = 120
  n.mid.type = 'peaking'
  n.mid.Q.value = 0.9
  n.hi.type = 'highshelf'
  n.hi.frequency.value = 6000
  n.sum.channelCount = 2 // mono clips are upmixed to L=R here, so a centered mono clip is as loud as a stereo one
  n.sum.channelCountMode = 'explicit'
  n.analyser.fftSize = 512
  n.analyser.smoothingTimeConstant = 0
  let key = '', irKey = '', irTimer = 0, fresh = true
  const all = Object.values(n)

  function wire(fx) {
    for (const x of all) x.disconnect()
    let tail = n.input
    if (fx.eq.on) { tail.connect(n.lo); n.lo.connect(n.mid); n.mid.connect(n.hi); tail = n.hi }
    if (fx.comp.on) { tail.connect(n.comp); n.comp.connect(n.makeup); tail = n.makeup }
    tail.connect(n.sum)
    if (fx.delay.on) { tail.connect(n.dly); n.dly.connect(n.fb); n.fb.connect(n.dly); n.dly.connect(n.dlyWet); n.dlyWet.connect(n.sum) }
    if (fx.reverb.on) { tail.connect(n.conv); n.conv.connect(n.revWet); n.revWet.connect(n.sum) }
    n.sum.connect(n.vol)
    n.vol.connect(n.split)
    n.split.connect(n.gl, 0)
    n.split.connect(n.gr, 1)
    n.gl.connect(n.merge, 0, 0)
    n.gr.connect(n.merge, 0, 1)
    n.merge.connect(out)
    n.merge.connect(n.analyser)
  }

  return {
    input: n.input,
    out,
    analyser: n.analyser,
    /** Apply a track's settings. smooth = ramp gains (real time); otherwise set instantly (offline render, first build). */
    update(track, audible, smooth = true) {
      const fx = track.fx
      const k = [fx.eq.on, fx.comp.on, fx.delay.on, fx.reverb.on].map(Number).join('')
      if (k !== key) { key = k; wire(fx) }
      const now = ctx.currentTime
      const soft = smooth && !fresh
      const set = (p, v) => (soft ? p.setTargetAtTime(v, now, 0.012) : (p.value = v))
      n.lo.gain.value = fx.eq.low
      n.mid.gain.value = fx.eq.mid
      n.mid.frequency.value = fx.eq.midFreq
      n.hi.gain.value = fx.eq.high
      n.comp.threshold.value = fx.comp.threshold
      n.comp.ratio.value = fx.comp.ratio
      n.comp.attack.value = fx.comp.attack
      n.comp.release.value = fx.comp.release
      n.comp.knee.value = fx.comp.knee
      set(n.makeup.gain, dbToGain(fx.comp.makeup, -40))
      n.dly.delayTime.value = Math.min(2, Math.max(0.01, fx.delay.time))
      set(n.fb.gain, Math.min(0.9, fx.delay.feedback))
      set(n.dlyWet.gain, fx.delay.mix)
      set(n.revWet.gain, fx.reverb.mix)
      const decay = Math.round(fx.reverb.decay * 10) / 10
      if (fx.reverb.on && decay !== irKey) {
        const apply = () => { irKey = decay; n.conv.buffer = impulseFor(ctx, decay) }
        clearTimeout(irTimer)
        if (soft && irKey !== '') irTimer = setTimeout(apply, 160)
        else apply()
      }
      set(n.vol.gain, audible ? dbToGain(track.vol) : 0)
      // equal-power pan with 0 dB at the center: a centered clip keeps its level, a hard-panned one is 3 dB louder on its side
      const theta = ((Math.max(-1, Math.min(1, track.pan)) + 1) * Math.PI) / 4
      set(n.gl.gain, Math.SQRT2 * Math.cos(theta))
      set(n.gr.gain, Math.SQRT2 * Math.sin(theta))
      fresh = false
    },
    dispose() {
      clearTimeout(irTimer)
      for (const x of all) x.disconnect()
      out.disconnect()
    },
  }
}

// ---------- Clip scheduling ----------
/** Gain automation for a clip: clip gain with linear fade in and out, for clip-relative seconds r0..r1 starting at ctx time `when`. */
function scheduleClipGain(param, clip, r0, r1, when) {
  const G = clip.gain, fi = clip.fadeIn, fo = clip.fadeOut, D = clip.dur
  const val = (r) => G * (fi > 0 && r < fi ? r / fi : 1) * (fo > 0 && r > D - fo ? Math.max(0, (D - r) / fo) : 1)
  param.setValueAtTime(val(r0), when)
  const marks = [fi, D - fo].filter((m, i) => (i === 0 ? fi > 0 : fo > 0) && m > r0 + 1e-6 && m < r1 - 1e-6)
  for (const m of marks) param.linearRampToValueAtTime(val(m), when + (m - r0))
  if (r1 > r0) param.linearRampToValueAtTime(val(r1), when + (r1 - r0))
}

/**
 * Schedule the part of a clip that lies inside timeline range [a, b]; timeline time a plays at context time `when`.
 * Returns {src, nodes} or null when the clip is outside the range.
 */
export function scheduleClip(ctx, dest, track, clip, asset, a, b, when) {
  const s = Math.max(clip.start, a)
  const e = Math.min(clipEnd(clip), b, clip.start + (asset.duration - clip.offset))
  if (e - s < 0.0005 || !asset.buffer) return null
  const src = ctx.createBufferSource()
  src.buffer = asset.buffer
  const cg = ctx.createGain()
  const nodes = [cg]
  const ws = when + (s - a)
  const rel = s - clip.start
  if (track.fx.gate.on) {
    const gate = ctx.createGain()
    const { env, rate } = gateFor(asset, track.fx.gate)
    const i0 = Math.floor((clip.offset + rel) * rate)
    const i1 = Math.min(env.length, Math.ceil((clip.offset + rel + (e - s)) * rate) + 2)
    if (i1 - i0 >= 2) {
      gate.gain.value = env[i0]
      gate.gain.setValueCurveAtTime(env.subarray(i0, i1), ws, (i1 - i0 - 1) / rate)
    }
    src.connect(gate)
    gate.connect(cg)
    nodes.push(gate)
  } else src.connect(cg)
  cg.connect(dest)
  scheduleClipGain(cg.gain, clip, rel, rel + (e - s), ws)
  src.start(ws, clip.offset + rel, e - s)
  return { src, nodes }
}

// ---------- Metronome clicks ----------
function makeClick(ctx, freq, ms, level) {
  const len = Math.floor((ctx.sampleRate * ms) / 1000)
  const b = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = b.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.sin((2 * Math.PI * freq * i) / ctx.sampleRate) * Math.exp((-6 * i) / len) * level
  return b
}

// ---------- Real-time engine ----------
export class Engine {
  constructor(getProject, getAssets) {
    this.getProject = getProject
    this.getAssets = getAssets
    this.ctx = null
    this.chains = new Map()
    this.live = new Set()
    this.playing = false
    this.recording = false
    this.pos = 0
    this.startPos = 0
    this.iters = []
    this.loop = null
    this.timer = 0
    this.endedCb = null
    this.buf = new Float32Array(1024)
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      let ctx
      try { ctx = new AC({ sampleRate: SR, latencyHint: 'interactive' }) } catch { ctx = new AC() }
      this.ctx = ctx
      this.master = ctx.createGain()
      const split = ctx.createChannelSplitter(2)
      this.anL = ctx.createAnalyser()
      this.anR = ctx.createAnalyser()
      for (const a of [this.anL, this.anR]) { a.fftSize = 1024; a.smoothingTimeConstant = 0 }
      this.master.connect(ctx.destination)
      this.master.connect(split)
      split.connect(this.anL, 0)
      split.connect(this.anR, 1)
      this.clickGain = ctx.createGain()
      this.clickGain.connect(ctx.destination)
      this.clicks = [makeClick(ctx, 1500, 45, 0.9), makeClick(ctx, 1000, 35, 0.6)]
      this.syncMix(true)
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {})
    return this.ctx
  }

  /** Create, remove and update the per-track chains to match the project. Cheap; call after any mixer change. */
  syncMix(first = false) {
    if (!this.ctx) return
    const p = this.getProject()
    const ids = new Set(p.tracks.map((t) => t.id))
    for (const [id, ch] of this.chains) if (!ids.has(id)) { ch.dispose(); this.chains.delete(id) }
    for (const t of p.tracks) {
      let ch = this.chains.get(t.id)
      if (!ch) { ch = buildChain(this.ctx); ch.out.connect(this.master); this.chains.set(t.id, ch) }
      ch.update(t, isAudible(p, t), !first)
    }
    const now = this.ctx.currentTime
    this.master.gain.setTargetAtTime(dbToGain(p.masterVol, -60), now, 0.01)
    this.clickGain.gain.setTargetAtTime(p.metroVol, now, 0.01)
  }

  position() {
    if (!this.playing) return this.pos
    const now = this.ctx.currentTime
    let it = this.iters[0]
    for (const x of this.iters) if (x.when <= now) it = x
    return Math.min(it.b, it.a + Math.max(0, now - it.when))
  }

  play(from, { recording = false } = {}) {
    this.ensure()
    this.halt()
    this.syncMix()
    const p = this.getProject()
    const loop = !recording && p.loop.on && p.loop.end - p.loop.start > 0.05 && from < p.loop.end ? p.loop : null
    this.loop = loop ? { start: p.loop.start, end: p.loop.end } : null
    this.recording = recording
    this.playEnd = recording ? from + 36000 : loop ? Infinity : projectLength(p) + tailSeconds(p) + 0.05
    this.startPos = from
    this.playing = true
    const when = this.ctx.currentTime + 0.06
    this.iters = []
    this.scheduleIter(from, loop ? loop.end : this.playEnd, when)
    this.fill()
    clearInterval(this.timer)
    this.timer = setInterval(() => this.tick(), 40)
  }

  scheduleIter(a, b, when) {
    const p = this.getProject()
    const assets = this.getAssets()
    this.iters.push({ a, b, when })
    for (const t of p.tracks) {
      const ch = this.chains.get(t.id)
      if (!ch) continue
      for (const c of t.clips) {
        const asset = assets.get(c.asset)
        if (!asset) continue
        const r = scheduleClip(this.ctx, ch.input, t, c, asset, a, b, when)
        if (!r) continue
        const entry = r
        this.live.add(entry)
        r.src.onended = () => { this.live.delete(entry); for (const n of entry.nodes) n.disconnect() }
      }
    }
    if (p.metro) {
      const beat = 60 / p.bpm
      const end = Math.min(b, a + 900)
      for (let k = Math.ceil(a / beat - 1e-9); k * beat < end; k++) {
        const s = this.ctx.createBufferSource()
        s.buffer = this.clicks[k % p.beats === 0 ? 0 : 1]
        s.connect(this.clickGain)
        s.start(when + (k * beat - a))
        const entry = { src: s, nodes: [] }
        this.live.add(entry)
        s.onended = () => { this.live.delete(entry); s.disconnect() }
      }
    }
  }

  /** Keep a few seconds of loop iterations scheduled ahead (survives throttled timers in background tabs). */
  fill() {
    if (!this.loop) return
    const horizon = this.ctx.currentTime + 12
    let last = this.iters.at(-1)
    let guard = 0
    while (last.when + (last.b - last.a) < horizon && guard++ < 400) {
      const when = last.when + (last.b - last.a)
      this.scheduleIter(this.loop.start, this.loop.end, when)
      last = this.iters.at(-1)
    }
  }

  tick() {
    if (!this.playing) return
    const now = this.ctx.currentTime
    while (this.iters.length > 1 && this.iters[1].when <= now) this.iters.shift()
    if (this.loop) this.fill()
    else if (!this.recording && this.position() >= this.playEnd - 0.001) {
      this.pos = Math.min(projectLength(this.getProject()), this.playEnd)
      this.halt()
      this.playing = false
      this.endedCb?.()
    }
  }

  halt() {
    clearInterval(this.timer)
    for (const e of this.live) {
      try { e.src.onended = null; e.src.stop() } catch { /* not started */ }
      e.src.disconnect()
      for (const n of e.nodes) n.disconnect()
    }
    this.live.clear()
    this.iters = []
  }

  pause() {
    if (!this.playing) return
    const p = this.position()
    this.halt()
    this.playing = false
    this.recording = false
    this.pos = p
  }

  stopAndReturn() {
    const wasPlaying = this.playing
    this.pause()
    this.pos = wasPlaying ? this.startPos : 0
  }

  seek(t) {
    this.pos = Math.max(0, t)
    if (this.playing && !this.recording) this.play(this.pos)
  }

  /** Restart playback from the current position so edits to clips, loop or metronome take effect. */
  refresh() {
    if (this.playing && !this.recording) {
      const keep = this.startPos
      this.play(this.position())
      this.startPos = keep
    }
  }

  /** Peak level 0..1 of the two master channels. */
  levels() {
    if (!this.ctx) return [0, 0]
    return [this.anL, this.anR].map((a) => peak(a, this.buf))
  }
  trackLevel(id) {
    const ch = this.chains.get(id)
    return ch ? peak(ch.analyser, this.buf) : 0
  }

  dispose() {
    this.halt()
    for (const ch of this.chains.values()) ch.dispose()
    this.chains.clear()
    this.playing = false
    this.ctx?.close().catch(() => {})
    this.ctx = null
  }
}

function peak(an, buf) {
  an.getFloatTimeDomainData(buf)
  let p = 0
  for (let i = 0; i < buf.length; i++) { const v = buf[i] < 0 ? -buf[i] : buf[i]; if (v > p) p = v }
  return p
}

// ---------- Offline render (export) ----------
/**
 * Render timeline range [from, to] of the project to an AudioBuffer. Effect tails (reverb, echo) are rendered after `to`.
 * Resolves with the AudioBuffer; onProgress(0..1) is called while rendering long mixes.
 */
export async function renderMix(project, assets, { from = 0, to, sampleRate = SR, channels = 2, tail = true, onProgress } = {}) {
  to = to ?? projectLength(project)
  if (!(to - from > 0.001)) throw new Error('Nothing to export: the project is empty or the range has no length.')
  const seconds = to - from + (tail ? tailSeconds(project) : 0)
  const frames = Math.ceil(seconds * sampleRate)
  if (frames * channels * 4 > 1.4e9) throw new Error('This mix is too long to render in the browser. Export a shorter selection.')
  const off = new OfflineAudioContext(channels, frames, sampleRate)
  const master = off.createGain()
  master.gain.value = dbToGain(project.masterVol)
  master.connect(off.destination)
  for (const t of project.tracks) {
    if (!isAudible(project, t)) continue
    const ch = buildChain(off)
    ch.update(t, true, false)
    ch.out.connect(master)
    for (const c of t.clips) {
      const asset = assets.get(c.asset)
      if (asset) scheduleClip(off, ch.input, t, c, asset, from, to, 0)
    }
  }
  if (onProgress && seconds > 10) {
    const step = Math.max(3, seconds / 12)
    const used = new Set()
    for (let t = step; t < seconds - 0.2; t += step) {
      const at = Math.floor((t * sampleRate) / 128) * 128
      if (used.has(at) || at >= frames) continue
      used.add(at)
      off.suspend(at / sampleRate).then(() => { onProgress(at / frames); off.resume() }).catch(() => {})
    }
  }
  const out = await off.startRendering()
  onProgress?.(1)
  return out
}
