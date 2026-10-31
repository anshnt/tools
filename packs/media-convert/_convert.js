// Video, audio and embedded-subtitle routes for the File Converter hub. The same functions as the tools (see _core.js), run with ffmpeg.wasm.
// ffmpeg is one engine instance, so every route here sets `exclusive: 'ffmpeg'` and the hub runs them one after another.
import { VIDEO_EXTS, AUDIO_EXTS } from './_core.js'

const MIME = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo', gif: 'image/gif', apng: 'image/apng', mp3: 'audio/mpeg', m4a: 'audio/mp4', flac: 'audio/flac', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', aac: 'audio/aac', srt: 'application/x-subrip', vtt: 'text/vtt', ass: 'text/plain' }

/** Build the `run(spec)` the shared jobs expect: runs one ffmpeg job and maps progress (engine download takes the first 5%). */
function runner(signal, onProgress) {
  const crashed = (e) => /memory|Aborted|out of bounds|RangeError|unreachable/i.test(String(e?.message ?? e))
  return async (spec) => {
    const { runFFmpeg, terminateFFmpeg } = await import('../../lib/ffmpeg.js')
    const go = () => runFFmpeg({
      ...spec, signal,
      onProgress: (f, label) => {
        if (f == null || !onProgress) return
        onProgress(/download|loading/i.test(label || '') ? 0.05 * f : 0.05 + 0.95 * f)
      },
    })
    try {
      return await go()
    } catch (e) {
      // a crashed wasm instance cannot be reused (it can run out of memory after many jobs): start a fresh engine and try once more
      if (!crashed(e) || signal?.aborted) throw e
      terminateFFmpeg()
      return go()
    }
  }
}

const asFile = (blob, name) => new File([blob], name, { type: MIME[name.split('.').pop()] || blob.type || 'application/octet-stream' })

const qualityOpt = { key: 'quality', label: 'Quality', type: 'select', default: 'balanced', choices: [['high', 'High (bigger file)'], ['balanced', 'Balanced'], ['small', 'Small'], ['tiny', 'Tiny']] }
const sizeOpt = { key: 'cap', label: 'Size (short side)', type: 'select', default: '0', choices: [['0', 'Keep the original'], ['1080', '1080p'], ['720', '720p'], ['480', '480p'], ['360', '360p']] }
const fpsOpt = { key: 'fps', label: 'Frame rate', type: 'select', default: '0', choices: [['0', 'Keep the original'], ['30', '30 fps'], ['25', '25 fps'], ['24', '24 fps'], ['15', '15 fps'], ['12', '12 fps']] }
const abitrateOpt = { key: 'bitrate', label: 'Audio bitrate', type: 'select', default: '192', choices: [['96', '96 kbps'], ['128', '128 kbps'], ['160', '160 kbps'], ['192', '192 kbps'], ['256', '256 kbps'], ['320', '320 kbps']] }
const rateOpt = { key: 'sampleRate', label: 'Sample rate', type: 'select', default: '0', choices: [['0', 'Keep the original'], ['48000', '48 kHz'], ['44100', '44.1 kHz'], ['32000', '32 kHz'], ['22050', '22.05 kHz'], ['16000', '16 kHz']] }
const channelOpt = { key: 'channels', label: 'Channels', type: 'select', default: '0', choices: [['0', 'Keep the original'], ['2', 'Stereo'], ['1', 'Mono']] }

async function probeFile(file) {
  const { inspect } = await import('./_engine.js')
  const { terminateFFmpeg } = await import('../../lib/ffmpeg.js')
  try {
    return await inspect(file)
  } catch (e) {
    if (!/memory|Aborted|out of bounds|RangeError|unreachable/i.test(String(e?.message ?? e))) throw e
    terminateFFmpeg() // the previous job crashed the engine: start a fresh one and try once more
    return inspect(file)
  }
}

const audioRun = (file, to, o = {}, { signal, onProgress } = {}) => audioJob(file, to, o, signal, onProgress)

async function audioJob(file, to, o, signal, onProgress) {
  const { convertAudio } = await import('./_core.js')
  const info = await probeFile(file)
  const r = await convertAudio({ file, info, to, o: { bitrate: +o.bitrate || 0, sampleRate: +o.sampleRate || 0, channels: +o.channels || 0 }, run: runner(signal, onProgress) })
  return asFile(r.blob, r.name)
}

export const CONVERTERS = [
  {
    from: VIDEO_EXTS,
    to: ['mp4', 'webm', 'mov', 'mkv', 'avi', 'gif', 'apng', 'mp3', 'm4a'],
    group: 'Video',
    exclusive: 'ffmpeg',
    options: [qualityOpt, sizeOpt, fpsOpt, { ...abitrateOpt, label: 'Audio bitrate (MP3, M4A)' }],
    run: async (file, to, o = {}, { signal, onProgress } = {}) => {
      const { convertVideo } = await import('./_core.js')
      const info = await probeFile(file)
      const cap = +o.cap || 0
      const r = await convertVideo({
        file, info, to, run: runner(signal, onProgress),
        o: { quality: o.quality || 'balanced', cap: cap || undefined, fps: +o.fps || 0, abitrate: +o.bitrate || 0 },
      })
      return asFile(r.blob, r.name)
    },
  },
  {
    from: VIDEO_EXTS,
    to: ['wav', 'flac', 'ogg', 'opus', 'aac', 'alac', 'aiff', 'wv', 'ac3'],
    group: 'Video soundtrack',
    exclusive: 'ffmpeg',
    options: [abitrateOpt, rateOpt, channelOpt],
    run: audioRun,
  },
  {
    from: AUDIO_EXTS,
    to: ['mp3', 'm4a', 'alac', 'aac', 'wav', 'flac', 'ogg', 'opus', 'wv', 'tta', 'w64', 'ac3', 'eac3', 'aiff'],
    group: 'Audio',
    exclusive: 'ffmpeg',
    options: [abitrateOpt, rateOpt, channelOpt],
    run: audioRun,
  },
  {
    from: ['mkv', 'mp4', 'm4v', 'mov', 'webm', 'ts', 'm2ts', 'mts', '3gp', 'ogv'],
    to: ['srt', 'ass', 'vtt'],
    group: 'Subtitles in a video',
    firstOnly: true, // only for a dropped video, never after another conversion
    exclusive: 'ffmpeg',
    options: [{ key: 'track', label: 'Subtitle track', type: 'select', default: 'all', choices: [['all', 'Every text track'], ['1', 'Track 1'], ['2', 'Track 2'], ['3', 'Track 3'], ['4', 'Track 4'], ['5', 'Track 5']] }],
    run: async (file, to, o = {}, { signal, onProgress } = {}) => {
      const { extractSubtitles } = await import('./_core.js')
      const info = await probeFile(file)
      const tracks = o.track && o.track !== 'all' ? [+o.track - 1] : undefined
      const outs = await extractSubtitles({ file, info, to, tracks, run: runner(signal, onProgress) })
      const files = outs.map((x) => asFile(x.blob, x.name))
      return files.length === 1 ? files[0] : files
    },
  },
]

export const SNIFF = [
  { ext: 'mkv', test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  { ext: 'flv', test: (b) => b[0] === 0x46 && b[1] === 0x4c && b[2] === 0x56 && b[3] === 1 },
  { ext: 'wma', test: (b) => b[0] === 0x30 && b[1] === 0x26 && b[2] === 0xb2 && b[3] === 0x75 },
  { ext: 'ape', test: (b) => b[0] === 0x4d && b[1] === 0x41 && b[2] === 0x43 && b[3] === 0x20 },
  { ext: 'wv', test: (b) => b[0] === 0x77 && b[1] === 0x76 && b[2] === 0x70 && b[3] === 0x6b },
  { ext: 'tta', test: (b) => b[0] === 0x54 && b[1] === 0x54 && b[2] === 0x41 && b[3] === 0x31 },
  { ext: 'dsf', test: (b) => b[0] === 0x44 && b[1] === 0x53 && b[2] === 0x44 && b[3] === 0x20 },
  { ext: 'caf', test: (b) => b[0] === 0x63 && b[1] === 0x61 && b[2] === 0x66 && b[3] === 0x66 },
]
