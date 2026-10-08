// Audio output options shared by audio-converter, extract-audio and compress-audio.
import { h, step, tilePicker, note } from './_ui.js'
import { AUDIO_FORMATS, audioArgs } from './_media.js'
import { select, field, formatBytes } from '../../lib/ui.js'

const ICONS = { mp3: 'music', m4a: 'smartphone', ogg: 'waves', opus: 'mic', wav: 'audio-waveform', flac: 'gem' }
export const RATES = [[0, 'Keep original'], [48000, '48 kHz'], [44100, '44.1 kHz (CD)'], [32000, '32 kHz'], [22050, '22.05 kHz'], [16000, '16 kHz (speech)'], [8000, '8 kHz (phone)']]
export const CHANNELS = [[0, 'Keep original'], [2, 'Stereo'], [1, 'Mono']]

const LOSSLESS = new Set(['pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le', 'flac', 'alac', 'pcm_u8'])

/** Default bitrate for a format: the format's own default, but never far above what a lossy source had. */
export function defaultBitrate(fmtId, info) {
  const f = AUDIO_FORMATS[fmtId]
  if (!f.lossy) return 0
  const src = info?.audio && !LOSSLESS.has(info.audio.codec) ? info.audio.bitrate || info.bitrate : 0
  if (!src) return f.def
  const fit = f.bitrates.find((b) => b >= src * 0.95)
  return Math.min(f.def, fit || f.def)
}

export function setSelectOptions(sel, options, value) {
  sel.replaceChildren(...options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)))
  sel.value = String(value)
}

/** Estimated size in bytes of an encode. */
export function estimateBytes({ fmt, bitrate, sampleRate, channels, duration, info }) {
  if (!duration) return 0
  const f = AUDIO_FORMATS[fmt]
  if (f.lossy) return (bitrate * 1000 / 8) * duration
  const rate = sampleRate || info?.audio?.rate || 44100
  const ch = channels || info?.audio?.channels || 2
  const wav = rate * ch * 2 * duration
  return fmt === 'flac' ? wav * 0.6 : wav
}

/**
 * audioOptions({formats, fmt, extra, info, hideFormat, onChange, startStep})
 * -> {nodes, get() -> {fmt, bitrate, sampleRate, channels, depth, args}, setFormat(id), estimate(duration)}
 * `extra` adds leading tiles (e.g. {value: 'copy', label: 'Original', sub: '...'}); get().fmt is then 'copy'.
 */
export function audioOptions({ formats = Object.keys(AUDIO_FORMATS), fmt = 'mp3', extra = [], info: info0, getInfo, hideFormat = false, onChange, startStep = 1, formatTitle = 'Output format' }) {
  let cur = fmt
  let touched = false
  const info = () => (getInfo ? getInfo() : info0)
  const tiles = hideFormat ? null : tilePicker({
    label: formatTitle, value: cur, compact: false, onChange: (v) => { cur = v; sync(true) },
    options: [...extra, ...formats.map((id) => ({ value: id, label: AUDIO_FORMATS[id].label, sub: AUDIO_FORMATS[id].note, icon: ICONS[id] }))],
  })
  const br = select([], '', () => { touched = true; sync() })
  const rate = select(RATES, 0, () => sync())
  const ch = select(CHANNELS, 0, () => sync())
  const depth = select([[16, '16-bit (standard)'], [24, '24-bit (studio)']], 16, () => sync())
  const brField = field('Bitrate (quality)', br)
  const depthField = field('Bit depth', depth)
  const hint = note('')
  const fine = h('div', { class: 'stack' }, h('div', { class: 'mc-grid three' }, brField, depthField, field('Sample rate', rate), field('Channels', ch)), hint)

  const qStep = step(startStep + (hideFormat ? 0 : 1), 'Quality', fine)

  function sync(formatChanged) {
    const isCopy = cur === 'copy'
    const f = AUDIO_FORMATS[cur]
    qStep.hidden = isCopy
    if (!isCopy) {
      brField.hidden = !f.lossy
      depthField.hidden = cur !== 'wav'
      if (f.lossy && (formatChanged || !br.options.length)) setSelectOptions(br, f.bitrates.map((b) => [b, `${b} kbps${b === f.def ? ' (recommended)' : ''}`]), defaultBitrate(cur, info()))
      const inf = info()
      const src = inf?.audio && !LOSSLESS.has(inf.audio.codec) ? inf.audio.bitrate : 0
      if (f.lossy && src && +br.value > src * 1.15) { hint.textContent = `The original is about ${src} kbps. Going higher keeps the same sound but makes a bigger file.`; hint.className = 'mc-note warn' }
      else if (!f.lossy && inf?.audio && !LOSSLESS.has(inf.audio.codec)) { hint.textContent = `${f.label} is lossless, but the original was already compressed. The file gets much bigger without sounding better.`; hint.className = 'mc-note warn' }
      else { hint.textContent = f.lossy ? 'Higher bitrate means better sound and a bigger file.' : `${f.label} keeps every detail of the source.`; hint.className = 'mc-note' }
    }
    onChange?.(get())
  }
  function get() {
    const isCopy = cur === 'copy'
    const f = AUDIO_FORMATS[cur]
    const o = { fmt: cur, bitrate: f?.lossy ? +br.value : 0, sampleRate: +rate.value || 0, channels: +ch.value || 0, depth: +depth.value || 16 }
    o.args = isCopy ? ['-c:a', 'copy'] : audioArgs(cur, o)
    return o
  }
  sync(true)
  return {
    nodes: [...(tiles ? [step(startStep, formatTitle, tiles)] : []), qStep],
    get,
    setFormat(id) { cur = id; tiles?.set(id); sync(true) },
    /** Re-evaluate once probe results arrive (keeps the bitrate if the user already picked one). */
    refresh() { sync(!touched) },
    estimate(duration) { const o = get(); return o.fmt === 'copy' ? 0 : estimateBytes({ ...o, duration, info: info() }) },
    tiles,
  }
}

export const sizeText = (bytes) => (bytes ? `About ${formatBytes(bytes)}` : '')
