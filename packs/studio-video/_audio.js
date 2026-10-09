// Audio mixing with WebAudio. The same scheduler feeds the live preview (AudioContext) and the exporter (OfflineAudioContext).
import { clipEnd, gainAt, projectDuration } from './_model.js'

/** Clips that make sound: audio clips and video clips with decoded audio, on tracks that are not muted. */
export function audioClips(project, buffers) {
  const muted = new Set(project.tracks.filter((t) => t.muted).map((t) => t.id))
  return project.clips.filter((c) => (c.kind === 'audio' || c.kind === 'video') && !muted.has(c.track) && c.volume > 0 && buffers.get(c.mediaId))
}

/**
 * Schedule every audible clip between timeline times t0 and t1. Timeline time t plays at context time when0 + (t - t0).
 * Returns the source nodes so the caller can stop them. Speed changes pitch (playbackRate), fades are linear gain ramps.
 */
export function scheduleAudio({ ctx, dest, project, buffers, t0, t1 = Infinity, when0 }) {
  const out = []
  const at = (t) => when0 + (t - t0)
  for (const c of audioClips(project, buffers)) {
    const end = clipEnd(c)
    const s = Math.max(c.start, t0), e = Math.min(end, t1)
    if (e - s < 0.005) continue
    const buf = buffers.get(c.mediaId)
    const offset = c.in + (s - c.start) * c.speed
    if (offset >= buf.duration) continue
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = c.speed
    const g = ctx.createGain()
    const pts = [...new Set([s, c.start + c.fadeIn, end - c.fadeOut, e].filter((x) => x >= s && x <= e))].sort((a, b) => a - b)
    g.gain.setValueAtTime(gainAt(c, pts[0]), at(pts[0]))
    for (let i = 1; i < pts.length; i++) g.gain.linearRampToValueAtTime(gainAt(c, pts[i]), at(pts[i]))
    src.connect(g)
    g.connect(dest)
    src.start(at(s), offset, Math.min((e - s) * c.speed, buf.duration - offset))
    out.push(src)
  }
  return out
}

/** Render the whole mix in 10 second segments so long projects never need one giant buffer. Yields {start, buffer}. */
export async function* renderMix(project, buffers, { sampleRate = 48000, seg = 10, signal } = {}) {
  const dur = projectDuration(project)
  for (let t = 0; t < dur - 1e-6; t += seg) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
    const len = Math.max(1, Math.ceil(Math.min(seg, dur - t) * sampleRate))
    const ctx = new OfflineAudioContext(2, len, sampleRate)
    scheduleAudio({ ctx, dest: ctx.destination, project, buffers, t0: t, t1: t + len / sampleRate, when0: 0 })
    yield { start: t, buffer: await ctx.startRendering() }
  }
}
