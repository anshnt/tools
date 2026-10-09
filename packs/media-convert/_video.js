// Helpers for tools that edit one video and write it back in (roughly) the same format.
import { h } from './_ui.js'
import { sameContainer, encodeArgs, COPY_AUDIO, QUALITY_CRF, X264_PRESETS, VIDEO_FORMATS } from './_media.js'

export const QUALITY_OPTIONS = [
  { value: 'high', label: 'High', sub: 'Looks the same as the original', icon: 'sparkles' },
  { value: 'balanced', label: 'Balanced', sub: 'Great picture, smaller file', icon: 'scale' },
  { value: 'small', label: 'Small', sub: 'Smaller file, a little softer', icon: 'minimize-2' },
]

/**
 * Plan a re-encode that keeps the file's own container (mp4, mov, mkv, webm; anything else becomes mp4).
 * Returns {fmt, ext, video: args, audio: 'copy'|'encode'|'none', args(extra) }
 */
export function reencodePlan(file, info, { quality = 'high', speed = 'balanced', audio: forced } = {}) {
  const fmt = sameContainer(file.name)
  const audio = forced || (!info.hasAudio ? 'none' : (COPY_AUDIO[fmt] || []).includes(info.audio.codec) ? 'copy' : 'encode')
  return {
    fmt, ext: VIDEO_FORMATS[fmt].ext, audio,
    codec: encodeArgs(fmt, { crf: QUALITY_CRF[quality], preset: X264_PRESETS[speed], vp: 'vp8', audio }),
  }
}

/** Stream mapping that takes the first video stream and the first audio stream (if any). */
export const mapAV = (info) => ['-map', '0:v:0', ...(info.hasAudio ? ['-map', '0:a:0'] : [])]

/** A small shape diagram: the source frame inside the output frame for fit / fill / stretch. */
export function shapePreview(srcW, srcH, outW, outH, mode) {
  const k = Math.min(220 / outW, 170 / outH)
  const box = h('div', { class: 'mc-shape', 'aria-hidden': 'true', style: { width: `${Math.round(outW * k)}px`, height: `${Math.round(outH * k)}px` } })
  const inner = h('div', { class: 'mc-shape-in' })
  const srcAr = srcW / srcH
  const outAr = outW / outH
  let w = 100
  let hh = 100
  if (mode === 'fit') { if (srcAr > outAr) hh = (outAr / srcAr) * 100; else w = (srcAr / outAr) * 100 }
  else if (mode === 'fill') { if (srcAr > outAr) w = (srcAr / outAr) * 100; else hh = (outAr / srcAr) * 100 }
  inner.style.width = `${w}%`
  inner.style.height = `${hh}%`
  box.append(inner)
  return box
}

/** Try each attempt in order and return the first result; abort errors are rethrown straight away. */
export async function firstThatWorks(attempts, isAbort) {
  let last
  for (const run of attempts) {
    try { return await run() } catch (e) { if (isAbort(e)) throw e; last = e }
  }
  throw last
}
