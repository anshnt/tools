// Mixdown export: render with OfflineAudioContext, then encode WAV directly or MP3 through ffmpeg.wasm.
import { renderMix } from './_engine.js'
import { encodeWav, peakAll, gainToDb, dbToGain } from './_dsp.js'

export const WAV_BITS = [['16', '16-bit (CD quality)'], ['24', '24-bit'], ['32', '32-bit float']]
export const MP3_RATES = [['128', '128 kbps'], ['192', '192 kbps'], ['256', '256 kbps'], ['320', '320 kbps (best)']]

/**
 * Export a range of the project. opts: {format: 'wav'|'mp3', bits, kbps, sampleRate, channels, from, to, normalize, tail, onProgress(fraction, label), signal}
 * Resolves with {blob, ext, duration, peakDb, frames}.
 */
export async function exportMix(project, assets, opts) {
  const { format = 'wav', bits = 16, kbps = 192, sampleRate = 44100, channels = 2, normalize = false, tail = true, onProgress, signal } = opts
  const wavShare = format === 'mp3' ? 0.5 : 0.9
  onProgress?.(0, 'Rendering the mix')
  const buf = await renderMix(project, assets, { from: opts.from, to: opts.to, sampleRate, channels, tail, onProgress: (f) => onProgress?.(f * wavShare, 'Rendering the mix') })
  if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
  const chans = []
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c))
  // drop trailing digital silence left over from effect tails, but never cut into the requested range
  const minLen = Math.min(buf.length, Math.ceil((opts.to - opts.from) * sampleRate))
  let end = buf.length
  const floor = 0.0001
  while (end > minLen && chans.every((d) => Math.abs(d[end - 1]) < floor)) end--
  end = Math.min(buf.length, Math.max(minLen, end + Math.round(sampleRate * 0.05)))
  const out = chans.map((d) => d.subarray(0, end))
  let peak = peakAll(out)
  if (normalize && peak > 1e-5) {
    const g = dbToGain(-1) / peak
    for (const d of out) for (let i = 0; i < d.length; i++) d[i] *= g
    peak *= g
  }
  const duration = end / sampleRate
  const peakDb = gainToDb(peak)
  if (format === 'wav') {
    onProgress?.(0.95, 'Writing WAV')
    return { blob: encodeWav(out, sampleRate, bits), ext: 'wav', duration, peakDb, frames: end }
  }
  const wav = encodeWav(out, sampleRate, 16)
  const { runFFmpeg } = await import('../../lib/ffmpeg.js')
  const blob = await runFFmpeg({
    inputs: [{ name: 'mix.wav', data: wav }],
    args: ['-i', 'mix.wav', '-vn', '-codec:a', 'libmp3lame', '-b:a', `${kbps}k`, '-ar', String(sampleRate), '-ac', String(channels), '-id3v2_version', '3', 'mix.mp3'],
    output: 'mix.mp3', signal,
    onProgress: (f, label) => onProgress?.(wavShare + (f == null ? 0 : f * (1 - wavShare)), /Download/.test(label || '') ? label : 'Encoding MP3'),
  })
  return { blob: new Blob([blob], { type: 'audio/mpeg' }), ext: 'mp3', duration, peakDb, frames: end }
}
