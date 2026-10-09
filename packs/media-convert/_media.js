// Pure helpers for the media-convert pack: parsing ffmpeg's log, format tables, argument builders and small
// calculators. Nothing here touches the DOM, so every function can be unit-tested in Node.
import { ext as extOf } from '../../lib/files.js'

// ---------- Time ----------

/** fmtTime(65.3) -> '1:05', fmtTime(65.34, 1) -> '1:05.3', fmtTime(3725) -> '1:02:05' */
export function fmtTime(sec, decimals = 0) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const f = 10 ** decimals
  const t = Math.floor(sec * f + 1e-6) / f
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t - h * 3600 - m * 60
  const ss = decimals ? s.toFixed(decimals).padStart(3 + decimals, '0') : String(Math.floor(s)).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** parseTime('1:23.5') -> 83.5. Accepts seconds ('83.5'), m:ss, h:mm:ss. Returns NaN when it cannot be read. */
export function parseTime(text) {
  const s = String(text ?? '').trim().replace(',', '.')
  if (!s) return NaN
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d*)?$/.test(s)) return NaN
  const parts = s.split(':').map(Number)
  return parts.reduce((acc, p) => acc * 60 + p, 0)
}

/** ffmpeg time argument: 83.5 -> '83.500' */
export const ts = (sec) => Math.max(0, sec).toFixed(3)

// ---------- Reading ffmpeg's -i log ----------

const CHANNELS = { mono: 1, stereo: 2, '2.1': 3, '3.0': 3, quad: 4, '4.0': 4, '5.0': 5, '5.1': 6, '6.1': 7, '7.1': 8 }
const channelCount = (layout = '') => {
  const k = layout.trim().replace(/\(.*\)$/, '')
  if (CHANNELS[k]) return CHANNELS[k]
  return +(layout.match(/(\d+)\s*channels/)?.[1] || 0) || null
}

/**
 * parseInfo(log) -> {duration, bitrate, container, video, audio, hasVideo, hasAudio, nSub, rotation, display, tags}
 * `log` is the text ffmpeg prints for `ffmpeg -i file` (as returned by lib/ffmpeg.js probe()). Cover art is not video.
 */
export function parseInfo(log) {
  const text = String(log || '')
  const lines = text.split(/\r?\n/)
  const d = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  const info = {
    duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : null,
    bitrate: +(text.match(/Duration:[^\n]*?bitrate:\s*(\d+)\s*kb\/s/)?.[1] || 0) || null,
    container: (text.match(/Input #0,\s*(.+?),\s*from\s/)?.[1] || '').split(',')[0] || null,
    video: null, audio: null, nSub: 0, nVideo: 0, nAudio: 0, rotation: 0, tags: {},
  }
  let inMeta = false
  let last = ''
  for (const line of lines) {
    if (/^\s*Duration:/.test(line)) inMeta = false
    if (/^\s{2}Metadata:/.test(line)) { inMeta = !info.duration || Object.keys(info.tags).length === 0; last = 'meta'; continue }
    const tag = line.match(/^\s{4}(title|artist|album|album_artist|date|genre)\s*:\s*(.+)$/i)
    if (tag && inMeta) { info.tags[tag[1].toLowerCase()] = tag[2].trim(); continue }
    const m = line.match(/Stream #\d+:(\d+)(?:\[[^\]]*\])?(?:\(([^)]*)\))?:\s*(Video|Audio|Subtitle|Attachment|Data):\s*(.*)$/)
    if (m) {
      inMeta = false
      const [, index, lang, type, rest] = m
      last = type
      const codec = rest.match(/^([\w.-]+)/)?.[1] || ''
      const kbps = +(rest.match(/(\d+)\s*kb\/s/)?.[1] || 0) || null
      if (type === 'Video') {
        if (/attached pic/.test(rest)) { last = 'cover'; continue }
        info.nVideo++
        if (info.video) continue
        const size = rest.match(/,\s*(\d{2,5})x(\d{2,5})\b/)
        const fps = +(rest.match(/(\d+(?:\.\d+)?)\s*fps/)?.[1] || rest.match(/(\d+(?:\.\d+)?)\s*tbr/)?.[1] || 0) || null
        const pix = rest.match(/(?:\)|^[\w.-]+),\s*([a-z][a-z0-9_]*)(?=[(,])/i)?.[1] || ''
        info.video = { index: +index, codec, pix, width: size ? +size[1] : null, height: size ? +size[2] : null, fps, bitrate: kbps, lang }
      } else if (type === 'Audio') {
        info.nAudio++
        if (info.audio) continue
        const layout = rest.match(/Hz,\s*([^,]+)/)?.[1]?.trim() || ''
        info.audio = { index: +index, codec, rate: +(rest.match(/(\d+)\s*Hz/)?.[1] || 0) || null, layout, channels: channelCount(layout), bitrate: kbps, lang }
      } else if (type === 'Subtitle') info.nSub++
      continue
    }
    if (last === 'Video') {
      const r = line.match(/rotation of\s*(-?[\d.]+)\s*degrees/) || line.match(/\brotate\s*:\s*(-?[\d.]+)/)
      if (r) info.rotation = ((Math.round(+r[1]) % 360) + 360) % 360
    }
  }
  info.hasVideo = !!info.video
  info.hasAudio = !!info.audio
  const sw = info.rotation === 90 || info.rotation === 270
  info.display = info.video?.width ? { width: sw ? info.video.height : info.video.width, height: sw ? info.video.width : info.video.height } : null
  return info
}

/** One-line description of a media file for chips and tests. */
export function describe(info) {
  const bits = []
  if (info.display) bits.push(`${info.display.width}x${info.display.height}`)
  if (info.video?.fps) bits.push(`${+info.video.fps.toFixed(2)} fps`)
  if (info.video) bits.push(info.video.codec)
  if (info.audio) bits.push(info.audio.codec)
  return bits.join(' \u00B7 ')
}

// ---------- Formats ----------

/** Audio output formats. `bitrates` are kbps choices; `def` the default. Lossless formats ignore bitrate. */
export const AUDIO_FORMATS = {
  mp3: { id: 'mp3', label: 'MP3', ext: 'mp3', codec: 'libmp3lame', lossy: true, bitrates: [64, 96, 128, 160, 192, 256, 320], def: 192, note: 'Plays everywhere' },
  m4a: { id: 'm4a', label: 'M4A (AAC)', ext: 'm4a', codec: 'aac', lossy: true, bitrates: [64, 96, 128, 160, 192, 256, 320], def: 160, note: 'Apple and Android' },
  ogg: { id: 'ogg', label: 'OGG Vorbis', ext: 'ogg', codec: 'libvorbis', lossy: true, bitrates: [64, 96, 128, 160, 192, 256, 320], def: 160, note: 'Open format' },
  opus: { id: 'opus', label: 'Opus', ext: 'opus', codec: 'libopus', lossy: true, bitrates: [24, 32, 48, 64, 96, 128, 192], def: 96, note: 'Best at low bitrates' },
  wav: { id: 'wav', label: 'WAV', ext: 'wav', codec: 'pcm_s16le', lossy: false, bitrates: [], def: 0, note: 'Uncompressed' },
  flac: { id: 'flac', label: 'FLAC', ext: 'flac', codec: 'flac', lossy: false, bitrates: [], def: 0, note: 'Lossless, smaller than WAV' },
}

/** audioArgs('mp3', {bitrate: 192, sampleRate: 44100, channels: 2}) -> ['-c:a','libmp3lame','-b:a','192k',...] */
export function audioArgs(fmtId, { bitrate, sampleRate, channels, depth = 16 } = {}) {
  const f = AUDIO_FORMATS[fmtId]
  const args = ['-c:a', fmtId === 'wav' && depth === 24 ? 'pcm_s24le' : f.codec]
  if (f.lossy) args.push('-b:a', `${bitrate || f.def}k`)
  // libopus only encodes at 8, 12, 16, 24 and 48 kHz
  if (sampleRate && !(fmtId === 'opus' && ![8000, 12000, 16000, 24000, 48000].includes(sampleRate))) args.push('-ar', String(sampleRate))
  if (channels) args.push('-ac', String(channels))
  if (fmtId === 'm4a') args.push('-movflags', '+faststart')
  return args
}

/** Container extension to use when copying a given audio codec out of a video without re-encoding. */
export function copyExtFor(codec) {
  const c = String(codec).toLowerCase()
  if (c === 'aac') return 'm4a'
  if (c === 'mp3') return 'mp3'
  if (c === 'opus') return 'opus'
  if (c === 'vorbis') return 'ogg'
  if (c === 'flac') return 'flac'
  if (c === 'ac3') return 'ac3'
  if (c === 'eac3') return 'eac3'
  if (c.startsWith('pcm_')) return 'wav'
  if (c === 'alac') return 'm4a'
  if (c === 'wmav2' || c === 'wmav1') return 'wma'
  if (c === 'amr_nb' || c === 'amr_wb') return 'amr'
  return null
}

export const VIDEO_FORMATS = {
  mp4: { id: 'mp4', label: 'MP4', ext: 'mp4', sub: 'H.264 + AAC', note: 'Works on every phone, TV and browser', icon: 'smartphone' },
  webm: { id: 'webm', label: 'WebM', ext: 'webm', sub: 'VP9 + Opus', note: 'Web video. Encoding is slow', icon: 'globe' },
  mov: { id: 'mov', label: 'MOV', ext: 'mov', sub: 'H.264 + AAC', note: 'QuickTime, Final Cut, iMovie', icon: 'apple' },
  mkv: { id: 'mkv', label: 'MKV', ext: 'mkv', sub: 'H.264 + AAC', note: 'Flexible container for PCs and TVs', icon: 'layers' },
  avi: { id: 'avi', label: 'AVI', ext: 'avi', sub: 'MPEG-4 + MP3', note: 'Old players and editors', icon: 'file-video' },
}

export const X264_PRESETS = { fast: 'ultrafast', balanced: 'veryfast', small: 'faster' }
export const QUALITY_CRF = { high: 20, balanced: 23, small: 27, tiny: 31 }

/**
 * Re-encode arguments for a target container. opts: {crf, preset, vp, abitrate, bitrate (kbps, overrides crf), audio}
 * audio: 'encode' (default) | 'copy' | 'none'. Streams are mapped by the caller; this only sets codecs.
 */
export function encodeArgs(fmtId, { crf = 23, preset = 'veryfast', vp = 'vp9', abitrate = 128, bitrate = 0, audio = 'encode' } = {}) {
  const a = []
  if (fmtId === 'webm') {
    if (vp === 'vp8') a.push('-c:v', 'libvpx', ...(bitrate ? ['-b:v', `${bitrate}k`] : ['-crf', String(Math.min(30, crf - 9)), '-b:v', '2M']), '-deadline', 'realtime', '-cpu-used', '5')
    else a.push('-c:v', 'libvpx-vp9', ...(bitrate ? ['-b:v', `${bitrate}k`] : ['-crf', String(crf + 9), '-b:v', '0']), '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1')
    a.push('-pix_fmt', 'yuv420p')
    if (audio === 'encode') a.push('-c:a', 'libopus', '-b:a', `${abitrate}k`)
  } else if (fmtId === 'avi') {
    a.push('-c:v', 'mpeg4', ...(bitrate ? ['-b:v', `${bitrate}k`] : ['-q:v', String(Math.max(2, Math.min(12, Math.round((crf - 14) / 1.6))))]), '-pix_fmt', 'yuv420p')
    if (audio === 'encode') a.push('-c:a', 'libmp3lame', '-b:a', `${abitrate}k`)
  } else {
    a.push('-c:v', 'libx264', '-preset', preset, ...(bitrate ? ['-b:v', `${bitrate}k`, '-maxrate', `${Math.round(bitrate * 1.4)}k`, '-bufsize', `${Math.round(bitrate * 2)}k`] : ['-crf', String(crf)]), '-pix_fmt', 'yuv420p')
    if (audio === 'encode') a.push('-c:a', 'aac', '-b:a', `${abitrate}k`)
    if (fmtId === 'mp4' || fmtId === 'mov') a.push('-movflags', '+faststart')
  }
  if (audio === 'copy') a.push('-c:a', 'copy')
  if (audio === 'none') a.push('-an')
  return a
}

/** Audio codecs that can be copied into a container without re-encoding. */
export const COPY_AUDIO = { mp4: ['aac', 'mp3'], mov: ['aac', 'mp3'], mkv: ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'ac3', 'eac3'], webm: ['opus', 'vorbis'], avi: ['mp3', 'ac3'] }

const H264_PIX = /^(yuv420p|yuvj420p|nv12)$/
/**
 * Can the streams of a file go into container `fmtId` as they are (no re-encode) and still be universally playable?
 * MP4 and MOV need H.264 8-bit with AAC/MP3 audio (or no audio); MKV takes almost anything; WebM needs VP8/VP9/AV1 + Opus/Vorbis.
 */
export function canRemux(info, fmtId) {
  if (!info?.video) return false
  const v = info.video.codec
  const a = info.audio?.codec
  const hasA = !!info.audio
  if (fmtId === 'mp4') return v === 'h264' && H264_PIX.test(info.video.pix || 'yuv420p') && (!hasA || a === 'aac' || a === 'mp3')
  if (fmtId === 'mov') return v === 'h264' && H264_PIX.test(info.video.pix || 'yuv420p') && (!hasA || a === 'aac' || a === 'mp3')
  if (fmtId === 'mkv') return !['wmv1', 'wmv2', 'wmv3', 'vc1'].includes(v)
  if (fmtId === 'webm') return ['vp8', 'vp9', 'av1'].includes(v) && (!hasA || a === 'opus' || a === 'vorbis')
  if (fmtId === 'avi') return ['mpeg4', 'mjpeg'].includes(v) && (!hasA || ['mp3', 'ac3', 'pcm_s16le'].includes(a)) // H.264 and AAC in AVI break on B-frames and seeking, so those are re-encoded
  return false
}

/** Which output container to keep for simple edits: the input's own when ffmpeg can write it well, else MP4. */
export function sameContainer(fileName) {
  const e = extOf(fileName)
  return ['mp4', 'mov', 'mkv', 'webm'].includes(e) ? e : e === 'm4v' ? 'mp4' : 'mp4'
}

// ---------- Geometry ----------

const even = (n) => Math.max(2, Math.round(n / 2) * 2)

/** Scale (w,h) so the SHORTER side is at most `cap` (never upscales). Returns even numbers. */
export function capShortSide(w, h, cap) {
  if (!w || !h) return { w: null, h: null }
  const short = Math.min(w, h)
  if (!cap || short <= cap) return { w: even(w), h: even(h) }
  const k = cap / short
  return { w: even(w * k), h: even(h * k) }
}

/** Largest standard resolution (short side) that keeps at least `minBpp` bits per pixel at this bitrate. */
export function pickShortSide(kbps, w, h, fps = 30, minBpp = 0.055) {
  const short = Math.min(w, h)
  const steps = [2160, 1440, 1080, 720, 540, 480, 360, 240, 144].filter((s) => s <= short)
  if (!steps.length) return short
  for (const s of steps) {
    const d = capShortSide(w, h, s)
    if ((kbps * 1000) / (d.w * d.h * (fps || 30)) >= minBpp) return s
  }
  return steps.at(-1)
}

/** Video bitrate (kbps) that makes a file of `targetBytes`, after audio and container overhead. */
export function videoKbpsFor(targetBytes, duration, audioKbps, overhead = 0.04) {
  if (!duration) return 0
  return Math.floor((targetBytes * 8 * (1 - overhead)) / duration / 1000 - audioKbps)
}

// ---------- Filters ----------

/** atempo only accepts 0.5 to 2 per stage, so chain stages: 4 -> 'atempo=2,atempo=2'; 0.25 -> 'atempo=0.5,atempo=0.5' */
export function atempoChain(speed) {
  const out = []
  let s = speed
  while (s > 2.0000001) { out.push(2); s /= 2 }
  while (s < 0.4999999) { out.push(0.5); s /= 0.5 }
  if (Math.abs(s - 1) > 1e-6 || !out.length) out.push(s)
  return out.map((v) => `atempo=${+v.toFixed(6)}`).join(',')
}

/** Extract the JSON block loudnorm prints (print_format=json) from ffmpeg's log. */
export function parseLoudnorm(log) {
  const m = String(log).match(/\{\s*"input_i"[\s\S]*?\}/)
  if (!m) return null
  try {
    const j = JSON.parse(m[0])
    const n = (k) => parseFloat(j[k])
    return { i: n('input_i'), tp: n('input_tp'), lra: n('input_lra'), thresh: n('input_thresh'), offset: n('target_offset') }
  } catch { return null }
}

/** volumedetect results: {mean, max} in dB. */
export function parseVolume(log) {
  const mean = String(log).match(/mean_volume:\s*(-?[\d.]+)\s*dB/)
  const max = String(log).match(/max_volume:\s*(-?[\d.]+)\s*dB/)
  return mean && max ? { mean: +mean[1], max: +max[1] } : null
}

// ---------- Subtitles ----------

const cueTime = (s) => {
  const m = s.trim().replace(',', '.').match(/^(?:(\d+):)?(\d+):(\d+)(?:\.(\d{1,3}))?$/)
  if (!m) return NaN
  return (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3] + (m[4] ? +m[4].padEnd(3, '0') / 1000 : 0)
}

/** Parse SRT or WebVTT text into [{start, end, text}] (plain text, simple tags stripped). */
export function parseSubtitles(src) {
  const text = String(src || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const cues = []
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    const i = lines.findIndex((l) => l.includes('-->'))
    if (i < 0) continue
    const [a, b] = lines[i].split('-->')
    const start = cueTime(a)
    const end = cueTime(b.trim().split(/\s+/)[0])
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    const body = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
    if (body) cues.push({ start, end, text: body })
  }
  return cues.sort((x, y) => x.start - y.start)
}

/** Shift every cue by `delta` seconds (negative moves earlier) and return SRT text. */
export function toSrt(cues, delta = 0) {
  const t = (s) => {
    const ms = Math.max(0, Math.round((s + delta) * 1000))
    const p = (n, l = 2) => String(n).padStart(l, '0')
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`
  }
  return cues.map((c, i) => `${i + 1}\n${t(c.start)} --> ${t(c.end)}\n${c.text}\n`).join('\n')
}

/**
 * Fonts for burned-in subtitles. libass only draws glyphs from fonts we hand it, so we load the Noto Sans subsets
 * (OFL licence, from @fontsource) that the subtitle text needs. Subsets of one family merge, so mixed scripts work.
 */
const FS = 'https://cdn.jsdelivr.net/npm/@fontsource'
const noto = (script) => `${FS}/noto-sans@5.2.10/files/noto-sans-${script}-400-normal.woff`
const scriptFont = (pkg, ver, script, family) => ({
  family,
  files: [`${FS}/noto-sans-${pkg}@${ver}/files/noto-sans-${pkg}-${script}-400-normal.woff`, `${FS}/noto-sans-${pkg}@${ver}/files/noto-sans-${pkg}-latin-400-normal.woff`, `${FS}/noto-sans-${pkg}@${ver}/files/noto-sans-${pkg}-latin-ext-400-normal.woff`],
})
const SCRIPTS = [
  ['Devanagari', /[\u0900-\u097F]/, scriptFont('devanagari', '5.2.8', 'devanagari', 'Noto Sans Devanagari')],
  ['Bengali', /[\u0980-\u09FF]/, scriptFont('bengali', '5.2.8', 'bengali', 'Noto Sans Bengali')],
  ['Gujarati', /[\u0A80-\u0AFF]/, scriptFont('gujarati', '5.2.7', 'gujarati', 'Noto Sans Gujarati')],
  ['Gurmukhi', /[\u0A00-\u0A7F]/, scriptFont('gurmukhi', '5.2.8', 'gurmukhi', 'Noto Sans Gurmukhi')],
  ['Tamil', /[\u0B80-\u0BFF]/, scriptFont('tamil', '5.2.7', 'tamil', 'Noto Sans Tamil')],
  ['Telugu', /[\u0C00-\u0C7F]/, scriptFont('telugu', '5.2.8', 'telugu', 'Noto Sans Telugu')],
  ['Kannada', /[\u0C80-\u0CFF]/, scriptFont('kannada', '5.2.8', 'kannada', 'Noto Sans Kannada')],
  ['Malayalam', /[\u0D00-\u0D7F]/, scriptFont('malayalam', '5.2.8', 'malayalam', 'Noto Sans Malayalam')],
  ['Arabic', /[\u0600-\u06FF\u0750-\u077F]/, scriptFont('arabic', '5.2.8', 'arabic', 'Noto Sans Arabic')],
  ['Hebrew', /[\u0590-\u05FF]/, scriptFont('hebrew', '5.2.8', 'hebrew', 'Noto Sans Hebrew')],
  ['Thai', /[\u0E00-\u0E7F]/, scriptFont('thai', '5.2.8', 'thai', 'Noto Sans Thai')],
]
const UNSUPPORTED = [['Chinese, Japanese or Korean', /[\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/]]

/**
 * pickFonts(text) -> {family, files: [url], unsupported: ['Chinese, Japanese or Korean'] }
 * Non-Latin scripts get their own Noto Sans family (with Latin glyphs included); everything else uses Noto Sans.
 */
export function pickFonts(text) {
  const unsupported = UNSUPPORTED.filter(([, re]) => re.test(text)).map(([n]) => n)
  const hit = SCRIPTS.find(([, re]) => re.test(text))
  if (hit) return { family: hit[2].family, script: hit[0], files: hit[2].files, unsupported }
  const files = [noto('latin')]
  if (/[\u0100-\u024F\u1E00-\u1EFF]/.test(text)) files.push(noto('latin-ext'))
  if (/[\u0400-\u04FF]/.test(text)) files.push(noto('cyrillic'))
  if (/[\u0370-\u03FF]/.test(text)) files.push(noto('greek'))
  if (/[\u0102\u0103\u0110\u0111\u0128\u0129\u0168\u0169\u01A0\u01A1\u01AF\u01B0\u1EA0-\u1EF9]/.test(text)) files.push(noto('vietnamese'))
  return { family: 'Noto Sans', script: 'Latin', files, unsupported }
}

// ---------- Misc ----------

/** Safe, short input name for the ffmpeg file system: in.mp4, in2.mov */
export function inputName(file, n = '') {
  const e = (extOf(file.name) || 'bin').replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin'
  return `in${n}.${e}`
}

export const MB = 1024 * 1024
export const LARGE_FILE = 200 * MB

/** "-62%" style change label; positive numbers get a plus sign. */
export function pctChange(from, to) {
  if (!from) return ''
  const p = Math.round(((to - from) / from) * 100)
  return `${p > 0 ? '+' : ''}${p}%`
}

/** Two files can be joined with a stream copy only when this signature matches. */
export function streamSig(info) {
  const v = info.video
  const a = info.audio
  return [
    v ? `${v.codec}/${v.pix}/${v.width}x${v.height}/${Math.round((v.fps || 0) * 100)}/${info.rotation}` : 'novideo',
    a ? `${a.codec}/${a.rate}/${a.channels}` : 'noaudio',
  ].join('|')
}
