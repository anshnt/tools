// Fast frame access for MP4/MOV sources during export. Seeking a <video> element costs a decode from the previous keyframe
// for every output frame, which is very slow when keyframes are far apart. Here mp4box.js (BSD-3-Clause) splits the file into
// samples and WebCodecs' VideoDecoder decodes them in order, so each frame is decoded once.
// Anything unusual (rotation, edit lists, unsupported codec, huge files) returns null and the exporter falls back to seeking.
import { script } from '../../lib/libs.js'
import { seekTo } from './_media.js'

const MP4BOX = 'https://cdn.jsdelivr.net/npm/mp4box@0.5.4/dist/mp4box.all.min.js'
const MAX_BYTES = 400 * 1024 * 1024
const US = 1e6

export const canDecode = () => typeof VideoDecoder === 'function' && typeof EncodedVideoChunk === 'function'

/** Parse the first video track of an MP4/MOV Blob into samples in decode order. Resolves null when the fast path is not safe. */
export async function parseMp4(blob) {
  if (!canDecode() || blob.size > MAX_BYTES || !/mp4|quicktime|m4v|mov/i.test(`${blob.type} ${blob.name || ''}`)) return null
  try {
    await script(MP4BOX)
    const MP4Box = window.MP4Box
    const f = MP4Box.createFile()
    const samples = []
    const info = await new Promise((resolve, reject) => {
      f.onReady = resolve
      f.onError = reject
      blob.arrayBuffer().then((buf) => { buf.fileStart = 0; f.appendBuffer(buf); f.flush() }, reject)
    })
    const t = info.videoTracks[0]
    if (!t) return null
    const trak = f.getTrackById(t.id)
    const entry = trak.mdia.minf.stbl.stsd.entries[0]
    const box = entry.avcC || entry.hvcC
    if (!box) return null
    const DS = window.DataStream || MP4Box.DataStream // mp4box 0.5 exposes it as a global
    const ds = new DS(undefined, 0, DS.BIG_ENDIAN)
    box.write(ds)
    const description = new Uint8Array(ds.buffer, 8)
    const m = t.matrix || []
    if (m.length >= 2 && (m[1] !== 0 || m[0] < 0)) return null // rotated or flipped video: the element applies it, decoded frames would not
    f.onSamples = (id, user, list) => { for (const s of list) samples.push(s) }
    f.setExtractionOptions(t.id, null, { nbSamples: 1000 })
    f.start()
    f.flush()
    const t0 = performance.now()
    while (samples.length < t.nb_samples && performance.now() - t0 < 15000) { f.flush(); await new Promise((r) => setTimeout(r, 10)) }
    if (samples.length < t.nb_samples || samples.length < 1) return null
    const minTicks = samples.reduce((a, s) => Math.min(a, s.cts), Infinity)
    const elst = trak.edts?.elst?.entries
    if (elst && !(elst.length === 1 && elst[0].media_time === minTicks)) return null // an edit that trims or delays the start: keep the element's timing
    const base = samples.map((s) => ({
      pts: Math.round(((s.cts - minTicks) / s.timescale) * US), dur: Math.round((s.duration / s.timescale) * US), key: !!s.is_sync, data: s.data,
    }))
    const order = base.map((_, i) => i).sort((a, b) => base[a].pts - base[b].pts)
    const sortedPts = order.map((i) => base[i].pts)
    const keyBefore = new Int32Array(base.length)
    let last = 0
    base.forEach((s, i) => { if (s.key) last = i; keyBefore[i] = last })
    if (!base[0].key) return null
    const cfg = { codec: t.codec, codedWidth: t.video.width, codedHeight: t.video.height, description }
    if (!(await VideoDecoder.isConfigSupported(cfg)).supported) return null
    return { cfg, width: t.video.width, height: t.video.height, samples: base, order, sortedPts, keyBefore }
  } catch (e) {
    console.debug('MP4 fast path unavailable, seeking instead:', e)
    return null
  }
}

/**
 * Decoded frames must look exactly like what the preview shows (the <video> element). Files without color tags can be read
 * with different assumptions by the two paths, so compare one frame and pick a matching color space, or give up (null).
 */
export async function matchElement(data, media) {
  const probe = (src) => {
    const c = document.createElement('canvas')
    c.width = c.height = 16
    const g = c.getContext('2d', { willReadFrequently: true })
    g.drawImage(src, 0, 0, 16, 16)
    return g.getImageData(0, 0, 16, 16).data
  }
  const el = document.createElement('video')
  try {
    el.muted = true
    el.preload = 'auto'
    el.src = media.url
    await new Promise((res, rej) => { el.onloadeddata = res; el.onerror = rej; setTimeout(rej, 10000) })
    const mid = data.sortedPts[data.sortedPts.length >> 1]
    const t = mid / US + 0.002
    await seekTo(el, t)
    const ref = probe(el)
    const spaces = [null, { primaries: 'smpte170m', transfer: 'smpte170m', matrix: 'smpte170m', fullRange: false }, { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false }]
    let best = null
    for (const cs of spaces) {
      const cfg = { ...data.cfg, ...(cs ? { colorSpace: cs } : {}) }
      if (cs && !(await VideoDecoder.isConfigSupported(cfg)).supported) continue
      const reader = new Mp4Frames({ ...data, cfg })
      try {
        const px = probe(await reader.frameAt(t))
        let diff = 0
        for (let i = 0; i < ref.length; i += 4) diff += Math.abs(px[i] - ref[i]) + Math.abs(px[i + 1] - ref[i + 1]) + Math.abs(px[i + 2] - ref[i + 2])
        diff /= (ref.length / 4) * 3
        if (!best || diff < best.diff) best = { diff, cfg }
        if (diff < 0.5) break
      } catch { /* try the next color space */ } finally { reader.dispose() }
    }
    if (best && best.diff < 3) return { ...data, cfg: best.cfg }
    return null
  } catch {
    return null
  } finally {
    el.removeAttribute('src')
    el.load()
  }
}

/** Sequential reader: frameAt(seconds) returns a VideoFrame (kept until the next different frame is requested). */
export class Mp4Frames {
  constructor(data) {
    this.d = data
    this.dec = null
    this.queue = []
    this.next = 0
    this.cur = null
    this.lastWanted = -1
    this.err = null
    this.wake = null
    this.stale = true
  }

  _open() {
    try { this.dec?.close() } catch { /* already closed */ }
    this.err = null
    this.dec = new VideoDecoder({ output: (f) => { this.queue.push(f); this._ping() }, error: (e) => { this.err = e; this._ping() } })
    this.dec.configure(this.d.cfg)
    this.stale = false
  }
  _ping() { const w = this.wake; this.wake = null; w?.() }
  _wait(ms) { return new Promise((res) => { const to = setTimeout(() => { this.wake = null; res() }, ms); this.wake = () => { clearTimeout(to); res() } }) }
  _clear() { for (const f of this.queue) f.close(); this.queue = [] }
  _take(want) {
    let found = null
    this.queue = this.queue.filter((f) => {
      if (f.timestamp === want && !found) { found = f; return false }
      if (f.timestamp < want) { f.close(); return false }
      return true
    })
    return found
  }

  async frameAt(seconds) {
    const d = this.d
    const target = seconds * US + 1000
    let lo = 0, hi = d.sortedPts.length - 1, r = 0
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (d.sortedPts[mid] <= target) { r = mid; lo = mid + 1 } else hi = mid - 1 }
    const want = d.sortedPts[r]
    const si = d.order[r]
    if (this.cur && this.cur.timestamp === want) return this.cur
    const queued = this._take(want)
    if (queued) return this._give(queued, want)
    const kf = d.keyBefore[si]
    if (this.stale || !this.dec || want < this.lastWanted || kf > this.next + 4 || this.next > si + 64) {
      this._clear()
      this._open()
      this.next = kf
    }
    let flushing = false
    let stalls = 0
    for (;;) {
      const f = this._take(want)
      if (f) return this._give(f, want)
      if (this.err) throw this.err
      const n = d.samples.length
      if (this.next < n) {
        let fed = 0
        while (this.next < n && this.dec.decodeQueueSize < 8 && fed < 8) {
          const s = d.samples[this.next++]
          this.dec.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: s.pts, duration: s.dur, data: s.data }))
          fed++
        }
        await this._wait(fed ? 150 : 50)
        if (!fed && ++stalls > 100) throw new Error('The decoder stalled.')
        continue
      }
      // End of the stream: flush so the decoder releases its reordered frames. Do not block on the flush promise, because the
      // decoder stops producing while we hold frames, so keep draining the queue instead.
      if (!flushing) {
        flushing = true
        this.stale = true // after a flush the decoder needs a keyframe again; frames already queued are still served first
        this.flushDone = false
        this.dec.flush().catch(() => {}).then(() => { this.flushDone = true; this._ping() })
        continue
      }
      if (this.flushDone) return null
      await this._wait(100)
      if (++stalls > 100) throw new Error('The decoder stalled.')
    }
  }

  _give(f, want) {
    if (this.cur && this.cur !== f) this.cur.close()
    this.cur = f
    this.lastWanted = want
    return f
  }

  dispose() {
    this._clear()
    try { this.cur?.close() } catch { /* ignore */ }
    this.cur = null
    try { this.dec?.close() } catch { /* ignore */ }
    this.dec = null
  }
}
