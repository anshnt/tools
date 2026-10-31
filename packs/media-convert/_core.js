// Conversion jobs shared by the tools and the File Converter hub routes. No DOM in here.
// Every job takes `run(spec)`, a function that runs ONE ffmpeg job ({inputs, args, output, label}) and resolves with a Blob
// (or an array of Blobs when `output` is an array). The tools pass the runner of their shell, the hub routes pass runFFmpeg.
import {
  VIDEO_TARGETS, X264_PRESETS, QUALITY_CRF, COPY_AUDIO, ALL_AUDIO, COVER_OK, encodeArgs, canRemux, capShortSide, audioArgs, inputName,
} from './_media.js'
import { withExt, suffixName, baseName, ext } from '../../lib/files.js'

// ---------- What we read ----------

/** Video containers and codecs the engine can open. */
export const VIDEO_EXTS = ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'asf', 'flv', 'f4v', 'mpeg', 'mpg', 'mpe', 'm2v', 'dat', 'vob', 'ts', 'm2ts', 'mts', '3gp', '3g2', 'ogv', 'dv']
/** Audio files the engine can open. */
export const AUDIO_EXTS = ['mp3', 'm4a', 'm4b', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif', 'aifc', 'amr', 'ape', 'wv', 'tta', 'dsf', 'dff', 'dts', 'ac3', 'eac3', 'ec3', 'mka', 'caf', 'au', 'w64', 'mp2']
export const dots = (list) => list.map((e) => `.${e}`).join(',')
export const VIDEO_ACCEPT = `video/*,${dots(VIDEO_EXTS)}`
export const AUDIO_ACCEPT = `audio/*,video/*,${dots(AUDIO_EXTS)},${dots(VIDEO_EXTS)}`

// ---------- Outputs ----------

/** Output name: the input's name with the new extension (a suffix is added when the extension does not change). */
export function outName(file, extension, suffix = 'converted') {
  return ext(file.name) === extension ? suffixName(file.name, suffix, extension) : withExt(file.name, extension)
}

export const VIDEO_QUALITIES = [['high', 'High'], ['balanced', 'Balanced'], ['small', 'Small'], ['tiny', 'Tiny']]
export const VIDEO_SPEEDS = [['fast', 'Fastest'], ['balanced', 'Balanced'], ['small', 'Slower, smaller']]
export const SHORT_SIDES = [[0, 'Keep the original size'], [2160, '4K (2160p)'], [1440, '1440p'], [1080, '1080p'], [720, '720p (HD)'], [480, '480p'], [360, '360p']]
export const FPS_CHOICES = [[0, 'Keep the original'], [60, '60 fps'], [30, '30 fps'], [25, '25 fps'], [24, '24 fps'], [15, '15 fps'], [12, '12 fps'], [10, '10 fps']]
export const kindOfTarget = (to) => VIDEO_TARGETS[to]?.kind || 'video'

/**
 * The ways to make `to` from a video with probe result `info`, best first.
 * o: {quality, speed, cap (short side in px, 0 keeps the size), fps (0 keeps), smart (copy streams when they fit, default true),
 *     abitrate (audio kbps for mp3 and m4a)}
 * Returns {kind, ext, attempts: [{mode: 'copy'|'encode', args, label}], warnings: []}; `args` go between `-i <input>` and the output name.
 */
export function videoPlan(info, to, o = {}) {
  const t = VIDEO_TARGETS[to]
  if (!t) throw new Error(`Cannot make ${to} here.`)
  const kind = t.kind || 'video'
  const warnings = []
  if (kind === 'audio') {
    if (!info.hasAudio) throw new Error('This video has no sound to save.')
    return { kind, ext: t.ext, attempts: [{ mode: 'encode', label: `Saving ${t.label}`, args: audioPlan(info, to, { bitrate: o.abitrate || (to === 'mp3' ? 192 : 160) }).attempts[0].args }], warnings }
  }
  if (!info.hasVideo) throw new Error('No video found in this file.')
  const anim = kind === 'anim'
  const cap = o.cap ?? (anim ? 480 : 0)
  const fps = o.fps || (anim ? 12 : 0)
  const dims = cap && info.display ? capShortSide(info.display.width, info.display.height, cap) : null
  const scale = dims?.w && (dims.w !== info.display.width || dims.h !== info.display.height) ? `scale=${dims.w}:${dims.h}:flags=lanczos` : ''
  const interlaced = ['mpeg2video', 'dvvideo'].includes(info.video.codec)

  if (anim) {
    const chain = [interlaced && 'yadif=deint=interlaced', `fps=${fps}`, scale || 'scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos'].filter(Boolean).join(',')
    if (info.duration > 30) warnings.push('Long clips make very large animated images. Trim the video first for a smaller file.')
    const args = to === 'gif'
      ? ['-an', '-sn', '-vf', `${chain},split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, '-loop', '0']
      : ['-an', '-sn', '-vf', chain, '-plays', '0', '-f', 'apng']
    return { kind, ext: t.ext, attempts: [{ mode: 'encode', label: `Making ${t.label}`, args }], warnings }
  }

  const maps = ['-map', '0:v:0', ...(info.hasAudio ? ['-map', to === 'mkv' ? '0:a' : '0:a:0'] : [])]
  const attempts = []
  if (o.smart !== false && !cap && !fps && canRemux(info, to)) {
    attempts.push({ mode: 'copy', label: 'Copying streams', args: [...maps, '-c', 'copy', ...(['mp4', 'mov'].includes(to) ? ['-movflags', '+faststart'] : [])] })
  }
  const vf = [interlaced && 'yadif=deint=interlaced', fps && `fps=${fps}`, scale || 'scale=trunc(iw/2)*2:trunc(ih/2)*2'].filter(Boolean).join(',')
  const audio = !info.hasAudio ? 'none' : (COPY_AUDIO[to] || []).includes(info.audio.codec) ? 'copy' : 'encode'
  const enc = encodeArgs(to, { crf: QUALITY_CRF[o.quality || 'balanced'], preset: X264_PRESETS[o.speed || 'balanced'], vp: 'vp8', audio }) // VP9 is not offered: the engine's libvpx-vp9 crashes inside the single-thread wasm build
  attempts.push({ mode: 'encode', label: `Encoding ${t.label}`, args: [...maps, '-vf', vf, ...enc] })
  return { kind, ext: t.ext, attempts, warnings }
}

/** Convert a video. Resolves {blob, name, mode: 'copy'|'encode', kind}. A copy that the container refuses falls back to a real re-encode. */
export async function convertVideo({ file, info, to, o = {}, run, isAbort = (e) => e?.code === 'ABORT' }) {
  const plan = videoPlan(info, to, o)
  if (plan.kind === 'anim' && info.duration > 300) throw new Error('This video is too long for an animated image (over 5 minutes). Trim it first.')
  const inName = inputName(file)
  const out = `out.${plan.ext}`
  let last
  for (const a of plan.attempts) {
    try {
      const blob = await run({ inputs: [{ name: inName, data: file }], args: ['-i', inName, ...a.args, out], output: out, label: a.label, total: info.duration })
      return { blob, name: outName(file, plan.ext), mode: a.mode, kind: plan.kind, warnings: plan.warnings, ext: plan.ext }
    } catch (e) {
      if (isAbort(e)) throw e
      last = e
    }
  }
  throw last
}

// ---------- Audio ----------

/** Plan for audio out of any file. o: {bitrate, sampleRate, channels, depth, cover (keep cover art, default true)}. Returns {ext, attempts: [{args, label}]}. */
export function audioPlan(info, to, o = {}) {
  const f = ALL_AUDIO[to]
  if (!f) throw new Error(`Cannot make ${to} here.`)
  if (!info.hasAudio) throw new Error('No sound found in this file.')
  const a = audioArgs(to, { bitrate: o.bitrate || f.def, sampleRate: o.sampleRate, channels: o.channels, depth: o.depth, srcRate: info.audio?.rate, srcCodec: info.audio?.codec, srcChannels: info.audio?.channels })
  const base = ['-map', '0:a:0', '-map_metadata', '0']
  const attempts = []
  if (info.cover && o.cover !== false && COVER_OK.has(to)) attempts.push({ label: 'Converting', args: ['-map', '0:v:0', '-c:v', 'copy', '-disposition:v:0', 'attached_pic', ...base, ...a] })
  attempts.push({ label: 'Converting', args: ['-vn', ...base, ...a] })
  return { ext: f.ext, attempts }
}

/** Convert audio (or the soundtrack of a video). Resolves {blob, name}. */
export async function convertAudio({ file, info, to, o = {}, run, isAbort = (e) => e?.code === 'ABORT', name, label }) {
  const plan = audioPlan(info, to, o)
  const inName = inputName(file)
  const out = `out.${plan.ext}`
  let last
  for (const a of plan.attempts) {
    try {
      const blob = await run({ inputs: [{ name: inName, data: file }], args: ['-i', inName, ...a.args, out], output: out, label: label || a.label, total: info.duration })
      return { blob, name: name || outName(file, plan.ext), ext: plan.ext }
    } catch (e) {
      if (isAbort(e)) throw e
      last = e
    }
  }
  throw last
}

// ---------- Subtitles inside videos ----------

const SUB_CODEC = { srt: 'srt', ass: 'ass', vtt: 'webvtt' }
const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)

/** Describe the subtitle tracks of a probed video: [{ord, label, lang, codec, text}]. */
export function subtitleTracks(info) {
  return (info.subs || []).map((s) => ({
    ord: s.ord, lang: s.lang, codec: s.codec, text: s.text, title: s.title,
    label: `#${s.ord + 1}${s.lang ? ` ${s.lang}` : ''}${s.title ? ` - ${s.title}` : ''} (${s.codec}${s.text ? '' : ', picture'})`,
  }))
}

/** Save embedded text subtitles as SRT, ASS or WebVTT. `tracks` is a list of 0-based track numbers (default: every text track). Resolves [{blob, name, track}]. */
export async function extractSubtitles({ file, info, to, tracks, run }) {
  const codec = SUB_CODEC[to]
  if (!codec) throw new Error(`Cannot save subtitles as ${to}.`)
  if (!info.subs?.length) throw new Error('This video has no embedded subtitles.')
  const text = info.subs.filter((s) => s.text)
  if (!text.length) throw new Error('The subtitles in this video are pictures (DVD or Blu-ray style), not text, so they cannot be converted.')
  const picked = tracks?.length ? text.filter((s) => tracks.includes(s.ord)) : text
  if (!picked.length) throw new Error('That subtitle track is a picture track or does not exist.')
  const inName = inputName(file)
  const outs = picked.map((_, i) => `sub${i}.${to}`)
  const args = ['-i', inName, ...picked.flatMap((s, i) => ['-map', `0:s:${s.ord}`, '-c:s', codec, outs[i]])]
  const blobs = await run({ inputs: [{ name: inName, data: file }], args, output: outs, label: 'Reading subtitles' })
  const seen = new Map()
  return picked.map((s, i) => {
    const tag = clean(s.lang) || `track${s.ord + 1}`
    const n = (seen.get(tag) || 0) + 1
    seen.set(tag, n)
    return { blob: blobs[i], name: `${baseName(file.name)}.${tag}${n > 1 ? `.${n}` : ''}.${to}`, track: s.ord }
  })
}
