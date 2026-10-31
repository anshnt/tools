// Audio converter (also audio-to-mp3, audio-to-wav, flac-to-mp3, wav-to-mp3 ... via params). Converts one file or a whole batch.
// Reads MP3, M4A, AAC, WAV, FLAC, OGG, Opus, WMA, AIFF, AMR, APE, WavPack, TTA, DSD (DSF, DFF), DTS, AC3, E-AC3, MKA, CAF and AU.
// Writes MP3, M4A (AAC or ALAC), WAV, FLAC, OGG, Opus, AAC, WavPack, TTA, W64, AC3, E-AC3 and AIFF, keeping tags and cover art where the format can hold them.
import { createMultiShell } from './_multi.js'
import { audioOptions } from './_audio.js'
import { fixedOutput, step } from './_ui.js'
import { ALL_AUDIO } from './_media.js'
import { convertAudio, outName, AUDIO_ACCEPT } from './_core.js'
import { inspect } from './_engine.js'
import { isAbort, formatBytes } from '../../lib/ui.js'

const FORMATS = ['mp3', 'm4a', 'alac', 'aac', 'wav', 'flac', 'ogg', 'opus', 'wv', 'tta', 'w64', 'ac3', 'eac3', 'aiff']
const FIXED = {
  mp3: ['music', 'MP3', 'The format that plays on every phone, car stereo and app.'],
  wav: ['audio-waveform', 'WAV', 'Uncompressed audio for editing, samplers and old hardware. Files are large.'],
  ogg: ['waves', 'OGG Vorbis', 'An open format that is small and plays in browsers, games and many players.'],
  flac: ['gem', 'FLAC', 'Lossless: the same sound as the original, in a smaller file than WAV.'],
  m4a: ['smartphone', 'M4A (AAC)', 'AAC audio for iPhone, Android and most players. Cover art and tags are kept.'],
}
const SOURCES = {
  flac: { accept: '.flac,audio/flac', label: 'Drop FLAC files to convert', hint: 'Lossless FLAC (.flac). Add as many as you like.' },
  wav: { accept: '.wav,audio/wav,audio/x-wav', label: 'Drop WAV files to convert', hint: 'Uncompressed WAV (.wav). Add as many as you like.' },
  m4a: { accept: '.m4a,.m4b,.m4r,audio/mp4', label: 'Drop M4A files to convert', hint: 'AAC and Apple Lossless (.m4a). Add as many as you like.' },
  mp3: { accept: '.mp3,audio/mpeg', label: 'Drop MP3 files to convert', hint: 'MP3 (.mp3). Add as many as you like.' },
  wma: { accept: '.wma,.asf', label: 'Drop WMA files to convert', hint: 'Windows Media Audio (.wma). Add as many as you like.' },
  ogg: { accept: '.ogg,.oga,audio/ogg', label: 'Drop OGG files to convert', hint: 'OGG Vorbis (.ogg). Add as many as you like.' },
  ape: { accept: '.ape,.wv,.tta,.dsf,.dff', label: 'Drop APE, WavPack, TTA or DSD files', hint: 'Monkey\'s Audio, WavPack, TTA and DSD. Add as many as you like.' },
}

export function mount(root, { params, signal }) {
  const fixed = params?.to
  const src = SOURCES[params?.from]
  let opts = null
  let update = () => {}
  const label = (id) => ALL_AUDIO[id].label

  createMultiShell(root, { signal }, {
    kind: 'audio',
    min: 1,
    sortable: false,
    accept: src?.accept || AUDIO_ACCEPT,
    dropLabel: src?.label || (fixed ? `Drop audio to convert to ${label(fixed)}` : 'Drop audio files here or click to choose'),
    dropHint: src?.hint || 'MP3, M4A, WAV, FLAC, OGG, Opus, WMA, AIFF, AMR, APE, WavPack, DSD, DTS, AC3 and more. Videos work too.',
    action: { label: fixed ? `Convert to ${label(fixed)}` : 'Convert audio', icon: 'repeat-2', busy: 'Converting' },
    options(set, shell) {
      opts = audioOptions({
        fmt: fixed || 'mp3', getInfo: () => set.info(set.files[0]), hideFormat: !!fixed, onChange: () => update(),
        formats: FORMATS,
      })
      const nodes = fixed ? [step(1, 'Output', fixedOutput(...(FIXED[fixed] || ['music', label(fixed), ALL_AUDIO[fixed].note]))), ...opts.nodes] : opts.nodes
      update = () => {
        const o = opts.get()
        const n = set.files.length
        const total = set.files.reduce((a, f) => a + (set.info(f)?.duration || 0), 0)
        const est = opts.estimate(total)
        shell.setInfo(`${n} file${n === 1 ? '' : 's'} to ${label(o.fmt)}`, est ? `About ${formatBytes(est)} in total` : 'Runs in your browser')
      }
      update()
      return nodes
    },
    onSet: () => { opts?.refresh(); update() },
    async execute(set, hp) {
      const o = opts.get()
      const f = ALL_AUDIO[o.fmt]
      const files = [...set.files]
      const used = new Set()
      const items = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        let name = outName(file, f.ext)
        for (let k = 1; used.has(name.toLowerCase()); k++) name = outName(file, f.ext).replace(/(\.[^.]+)$/, ` (${k})$1`)
        used.add(name.toLowerCase())
        try {
          const info = set.info(file) || await inspect(file)
          const span = [i / files.length, (i + 1) / files.length]
          const r = await convertAudio({
            file, info, to: o.fmt, name,
            o: { bitrate: o.bitrate, sampleRate: o.sampleRate, channels: o.channels, depth: o.depth },
            label: files.length > 1 ? `Converting ${i + 1} of ${files.length}` : 'Converting',
            run: (spec) => hp.ffmpeg(spec, span),
          })
          items.push({ blob: r.blob, name: r.name, inputSize: file.size, kind: 'audio' })
        } catch (e) {
          if (isAbort(e)) throw e
          items.push({ name: file.name, error: String(e.message || e).replace(/^Processing failed: /, '').slice(0, 140) })
        }
      }
      if (items.length === 1) {
        const it = items[0]
        if (!it.blob) throw new Error(it.error)
        return { blob: it.blob, name: it.name, inputSize: it.inputSize, kind: 'audio', title: `Converted to ${f.label}`, summary: `${files[0].name} is now a ${f.label} file.` }
      }
      return { items, title: `Converted to ${f.label}`, zipName: `audio-${o.fmt}.zip`, summary: `${items.filter((i) => i.blob).length} of ${items.length} files converted to ${f.label}.` }
    },
  })
}

