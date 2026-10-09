// Preview engine: video elements that seek, a canvas compositor, and WebAudio playback, driven by one clock.
// FrameRenderer is also used by the exporter, which asks for exact frames instead of playing in real time.
import { layersAt, projectDuration, srcTime, clamp } from './_model.js'
import { drawFrame } from './_draw.js'
import { scheduleAudio } from './_audio.js'
import { seekTo } from './_media.js'
import { parseMp4, matchElement, Mp4Frames } from './_demux.js'

const LATENCY = 0.06 // seconds between pressing play and the first audio sample
const fontLoads = new Map()

/** Load the fonts used by title clips (canvas silently falls back to a default until a web font is ready). */
export function ensureFonts(project) {
  const jobs = []
  for (const c of project.clips) {
    if (c.kind !== 'title') continue
    const key = `${c.bold ? 700 : 400} 24px ${c.font}`
    if (!fontLoads.has(key)) fontLoads.set(key, (document.fonts?.load(key, 'Aa') || Promise.resolve()).catch(() => {}).then(() => { fontLoads.set(key, null) }))
    if (fontLoads.get(key)) jobs.push(fontLoads.get(key))
  }
  return Promise.all(jobs)
}
const fontsLoading = (project) => project.clips.some((c) => c.kind === 'title' && fontLoads.get(`${c.bold ? 700 : 400} 24px ${c.font}`) !== null)

export class FrameRenderer {
  constructor(media, { max = 8, fast = false } = {}) {
    this.media = media
    this.max = max
    this.vids = new Map()
    this.onFrame = null
    this.fast = fast // export only: decode MP4/MOV sources in order with WebCodecs instead of seeking an element per frame
    this.readers = new Map()
    this.frames = new Map()
    this.parsed = new Map()
  }

  video(clip) {
    const m = this.media.get(clip.mediaId)
    if (!m || m.status !== 'ok' || !m.url) return null
    let e = this.vids.get(clip.id)
    if (e && e.mediaId !== m.id) { this.drop(clip.id); e = null }
    if (!e) {
      const el = document.createElement('video')
      el.muted = true
      el.playsInline = true
      el.preload = 'auto'
      el.addEventListener('seeked', () => this.onFrame?.())
      el.addEventListener('loadeddata', () => this.onFrame?.())
      el.src = m.url
      e = { el, mediaId: m.id }
      this.vids.set(clip.id, e)
    }
    return e.el
  }

  drop(id) {
    const e = this.vids.get(id)
    if (!e) return
    e.el.pause()
    e.el.removeAttribute('src')
    e.el.load()
    this.vids.delete(id)
  }

  /** Called once per frame with the visible layers: frees the least recently needed elements. */
  begin(layers) {
    const keep = new Set(layers.map((l) => l.clip.id))
    if (this.readers.size > this.max) {
      for (const [id, r] of [...this.readers]) {
        if (this.readers.size <= this.max) break
        if (keep.has(id)) continue
        r?.dispose()
        this.readers.delete(id)
        this.frames.delete(id)
      }
    }
    if (this.vids.size <= this.max) return
    for (const id of [...this.vids.keys()]) {
      if (this.vids.size <= this.max) break
      if (!keep.has(id)) this.drop(id)
    }
  }

  target(clip, t, el) {
    return clamp(srcTime(clip, t) + 0.001, 0, Math.max(0, (Number.isFinite(el.duration) ? el.duration : 1e9) - 0.05))
  }

  videoLayers(layers) { return layers.filter((l) => l.clip.kind === 'video') }

  /** Paused: point every needed video element at its frame (does not wait). */
  seekStill(layers, fps) {
    const tol = 0.5 / (fps || 30)
    for (const L of this.videoLayers(layers)) {
      const el = this.video(L.clip)
      if (!el || el.error) continue
      const target = this.target(L.clip, L.t, el)
      if (Math.abs(el.currentTime - target) > tol) el.currentTime = target
    }
  }

  /** True while any needed frame has not arrived yet. */
  pending(layers) {
    return this.videoLayers(layers).some((L) => {
      const el = this.video(L.clip)
      return el && !el.error && (el.readyState < 2 || el.seeking)
    })
  }

  /** Fast path for one layer. Returns false when the clip cannot use it (the caller then seeks the element). */
  async fastFrame(L) {
    const c = L.clip
    this.frames.delete(c.id)
    let r = this.readers.get(c.id)
    if (r === undefined) {
      const m = this.media.get(c.mediaId)
      let p = this.parsed.get(c.mediaId)
      if (!p) { p = m?.blob ? parseMp4(m.blob).then((d) => d && matchElement(d, m)) : Promise.resolve(null); this.parsed.set(c.mediaId, p) }
      const data = await p
      r = data && m && data.width === m.width && data.height === m.height ? new Mp4Frames(data) : null
      this.readers.set(c.id, r)
    }
    if (!r) return false
    try {
      const f = await r.frameAt(srcTime(c, L.t))
      if (!f) throw new Error('no frame')
      this.frames.set(c.id, f)
      return true
    } catch {
      r.dispose()
      this.readers.set(c.id, null)
      return false
    }
  }

  /** Export: seek every needed element to its exact frame and wait until all are ready. */
  async seekAll(layers, fps) {
    const tol = 0.5 / (fps || 30)
    await Promise.all(this.videoLayers(layers).map(async (L) => {
      if (this.fast && (await this.fastFrame(L))) return
      const el = this.video(L.clip)
      if (!el || el.error) return
      if (el.readyState < 1) await new Promise((res) => { el.addEventListener('loadedmetadata', res, { once: true }); setTimeout(res, 8000) })
      const target = this.target(L.clip, L.t, el)
      if (Math.abs(el.currentTime - target) > tol || el.readyState < 2) await seekTo(el, target)
    }))
  }

  /** Playing: keep elements that should be on screen playing at the clip speed, pause the rest, and fix drift. */
  playLayers(layers, t, p) {
    const active = new Set()
    for (const L of this.videoLayers(layers)) {
      const c = L.clip
      const el = this.video(c)
      if (!el || el.error) continue
      active.add(c.id)
      const target = this.target(c, t, el)
      const last = (Number.isFinite(el.duration) ? el.duration : Infinity) - 0.06
      if (target >= last) { // past the end of the source (a crossfade handle, or the final frame): hold it, never restart
        if (!el.paused) el.pause()
        if (Math.abs(el.currentTime - last) > 0.05 && Number.isFinite(last)) el.currentTime = last
        continue
      }
      const rate = clamp(c.speed, 0.0625, 16)
      if (el.playbackRate !== rate) el.playbackRate = rate
      if (el.paused) {
        if (Math.abs(el.currentTime - target) > 0.05) el.currentTime = target
        el.play().catch(() => {})
      } else if (Math.abs(el.currentTime - target) > 0.3) el.currentTime = target
    }
    // warm up clips that start within the next second so their first frame is decoded
    for (const c of p.clips) {
      if (c.kind !== 'video' || c.start <= t || c.start > t + 1 || active.has(c.id)) continue
      const el = this.video(c)
      if (el && el.paused && !el.seeking && Math.abs(el.currentTime - c.in) > 0.05) el.currentTime = c.in
    }
    for (const [id, e] of this.vids) if (!e.el.paused && !active.has(id)) e.el.pause()
  }

  pauseAll() { for (const e of this.vids.values()) e.el.pause() }

  source(layer) {
    const c = layer.clip
    const m = this.media.get(c.mediaId)
    if (!m || m.status !== 'ok') return null
    if (c.kind === 'image') return m.img ? { src: m.img, w: m.img.width, h: m.img.height } : null
    const fast = this.frames.get(c.id)
    if (fast) return { src: fast, w: fast.displayWidth, h: fast.displayHeight }
    const el = this.video(c)
    return el && el.readyState >= 2 && el.videoWidth ? { src: el, w: el.videoWidth, h: el.videoHeight } : null
  }

  draw(g, W, H, project, layers) { drawFrame(g, W, H, project, layers, (L) => this.source(L)) }

  dispose() {
    for (const id of [...this.vids.keys()]) this.drop(id)
    for (const r of this.readers.values()) r?.dispose()
    this.readers.clear()
    this.frames.clear()
    this.parsed.clear()
  }
}

export class Player {
  constructor({ doc, media, canvas, monitor = true }) {
    this.doc = doc
    this.media = media
    this.canvas = canvas
    this.monitor = monitor
    this.g = canvas.getContext('2d')
    this.fr = new FrameRenderer(media)
    this.fr.onFrame = () => this.requestRender()
    this.t = 0
    this.playing = false
    this.muted = false
    this.ac = null
    this.master = null
    this.sources = []
    this.onTime = null
    this.onPlay = null
    this.onRender = null
    this.onBusy = null
    this._raf = 0
    this._loop = 0
    this._pendingSince = 0
    this._run = 0
    this._off = doc.on((kind) => {
      if (kind === 'live') return this.requestRender()
      if (this.playing) this._reschedule()
      else this.requestRender()
    })
    this._offMedia = media.on(() => this.requestRender())
  }

  get duration() { return projectDuration(this.doc.p) }

  resize(W, H) {
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H }
    this.requestRender()
  }

  seek(t) {
    this.t = clamp(t, 0, Math.max(0, this.duration))
    if (this.playing) this._reschedule()
    else this.requestRender()
    this.onTime?.(this.t)
  }

  requestRender() {
    if (this._raf) return
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.render() })
  }

  render(force = false) {
    const p = this.doc.p
    const layers = layersAt(p, this.t)
    this.fr.begin(layers)
    if (fontsLoading(p)) ensureFonts(p).then(() => this.requestRender())
    if (!this.playing) this.fr.seekStill(layers, p.fps)
    if (!force && this.fr.pending(layers)) {
      if (!this._pendingSince) { this._pendingSince = performance.now(); setTimeout(() => this.requestRender(), 1600) }
      if (performance.now() - this._pendingSince < 1500) return
    }
    this._pendingSince = 0
    this.fr.draw(this.g, this.canvas.width, this.canvas.height, p, layers)
    this.onRender?.(layers)
  }

  async ensureContext() {
    if (!this.ac) {
      const AC = window.AudioContext || window.webkitAudioContext
      try { this.ac = new AC({ sampleRate: 48000 }) } catch { this.ac = new AC() }
      this.master = this.ac.createGain()
      if (this.monitor) this.master.connect(this.ac.destination)
    }
    this.master.gain.value = this.muted ? 0 : 1
    if (this.ac.state === 'suspended') await Promise.race([this.ac.resume().catch(() => {}), new Promise((r) => setTimeout(r, 400))])
  }

  async _buffers() {
    const ids = [...new Set(this.doc.p.clips.filter((c) => c.kind === 'audio' || c.kind === 'video').map((c) => c.mediaId))]
    const map = new Map()
    const todo = ids.filter((id) => this.media.get(id)?.audio === undefined)
    let timer
    if (todo.length) timer = setTimeout(() => this.onBusy?.(true), 250)
    await Promise.all(ids.map(async (id) => { const b = await this.media.ensureAudio(id); if (b) map.set(id, b) }))
    clearTimeout(timer)
    if (todo.length) this.onBusy?.(false)
    return map
  }

  _stopAudio() {
    for (const s of this.sources) { try { s.stop() } catch { /* already stopped */ } try { s.disconnect() } catch { /* ignore */ } }
    this.sources = []
  }

  async _startAt(t) {
    const run = ++this._run
    await this.ensureContext()
    const buffers = await this._buffers()
    await this._settle(500)
    if (run !== this._run || !this.playing) return
    this._stopAudio()
    this.sources = scheduleAudio({ ctx: this.ac, dest: this.master, project: this.doc.p, buffers, t0: t, when0: this.ac.currentTime + LATENCY })
    this._t0 = t
    this._acStart = this.ac.currentTime + LATENCY
    this._wallStart = performance.now() / 1000 + LATENCY
    cancelAnimationFrame(this._loop)
    this._loop = requestAnimationFrame(this._tick)
    this.onStarted?.()
  }

  _reschedule() {
    cancelAnimationFrame(this._loop)
    this._stopAudio()
    this.fr.pauseAll()
    this._startAt(this.t)
  }

  async _settle(ms) {
    const end = performance.now() + ms
    while (performance.now() < end) {
      const layers = layersAt(this.doc.p, this.t)
      this.fr.begin(layers)
      this.fr.seekStill(layers, this.doc.p.fps)
      if (!this.fr.pending(layers)) break
      await new Promise((r) => setTimeout(r, 25))
    }
  }

  _tick = () => {
    if (!this.playing) return
    const p = this.doc.p
    const dur = projectDuration(p)
    // The audio clock is the master while it runs, so picture follows sound; the wall clock covers a suspended context.
    const elapsed = this.ac?.state === 'running' ? this.ac.currentTime - this._acStart : performance.now() / 1000 - this._wallStart
    const t = this._t0 + Math.max(0, elapsed)
    if (t >= dur) { this.t = dur; this.pause(); this.render(true); this.onTime?.(this.t); this.onEnd?.(); return }
    this.t = t
    const layers = layersAt(p, t)
    this.fr.begin(layers)
    this.fr.playLayers(layers, t, p)
    this.render()
    this.onTime?.(t)
    this._loop = requestAnimationFrame(this._tick)
  }

  async play() {
    if (this.playing) return
    const dur = this.duration
    if (dur <= 0) return
    if (this.t >= dur - 0.02) this.t = 0
    this.playing = true
    this.onPlay?.(true)
    await this._startAt(this.t)
  }

  pause() {
    if (!this.playing) return
    this.playing = false
    this._run++
    cancelAnimationFrame(this._loop)
    this._stopAudio()
    this.fr.pauseAll()
    this.onPlay?.(false)
    this.requestRender()
  }

  toggle() { return this.playing ? this.pause() : this.play() }

  setMuted(m) {
    this.muted = m
    if (this.master) this.master.gain.value = m ? 0 : 1
  }

  destroy() {
    this.playing = false
    this._run++
    cancelAnimationFrame(this._loop)
    cancelAnimationFrame(this._raf)
    this._stopAudio()
    this._off()
    this._offMedia()
    this.fr.dispose()
    this.ac?.close().catch(() => {})
  }
}
