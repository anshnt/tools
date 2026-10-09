// Audio converter (also serves audio-to-mp3 and audio-to-wav via params.to). Converts one file or a whole batch.
import { createMultiShell } from './_multi.js'
import { audioOptions } from './_audio.js'
import { fixedOutput, step } from './_ui.js'
import { AUDIO_FORMATS, inputName } from './_media.js'
import { withExt } from '../../lib/files.js'
import { isAbort, formatBytes } from '../../lib/ui.js'

const FIXED = {
  mp3: ['music', 'MP3', 'The format that plays on every phone, car stereo and app.'],
  wav: ['audio-waveform', 'WAV', 'Uncompressed audio for editing, samplers and old hardware. Files are large.'],
}

export function mount(root, { params, signal }) {
  const fixed = params?.to
  let opts = null
  let update = () => {}

  createMultiShell(root, { signal }, {
    kind: 'audio',
    min: 1,
    sortable: false,
    dropLabel: fixed ? `Drop audio to convert to ${AUDIO_FORMATS[fixed].label}` : 'Drop audio files here or click to choose',
    dropHint: 'MP3, WAV, M4A, OGG, FLAC, OPUS, AMR and more. Videos work too. Add as many as you like.',
    action: { label: fixed ? `Convert to ${AUDIO_FORMATS[fixed].label}` : 'Convert audio', icon: 'repeat-2', busy: 'Converting' },
    options(set, shell) {
      opts = audioOptions({
        fmt: fixed || 'mp3', getInfo: () => set.info(set.files[0]), hideFormat: !!fixed, onChange: () => update(),
        formats: ['mp3', 'm4a', 'ogg', 'opus', 'wav', 'flac'],
      })
      const nodes = fixed ? [step(1, 'Output', fixedOutput(...FIXED[fixed])), ...opts.nodes] : opts.nodes
      update = () => {
        const o = opts.get()
        const n = set.files.length
        const total = set.files.reduce((a, f) => a + (set.info(f)?.duration || 0), 0)
        const est = opts.estimate(total)
        shell.setInfo(`${n} file${n === 1 ? '' : 's'} to ${AUDIO_FORMATS[o.fmt].label}`, est ? `About ${formatBytes(est)} in total` : 'Runs in your browser')
      }
      update()
      return nodes
    },
    onSet: () => { opts?.refresh(); update() },
    async execute(set, hp) {
      const o = opts.get()
      const f = AUDIO_FORMATS[o.fmt]
      const files = [...set.files]
      const used = new Set()
      const items = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const name = inputName(file)
        const out = `out.${f.ext}`
        let outName = withExt(file.name, f.ext)
        for (let k = 1; used.has(outName.toLowerCase()); k++) outName = withExt(file.name, f.ext).replace(/(\.[^.]+)$/, ` (${k})$1`)
        used.add(outName.toLowerCase())
        try {
          const blob = await hp.ffmpeg({
            inputs: [{ name, data: file }],
            args: ['-i', name, '-vn', '-map', '0:a:0', '-map_metadata', '0', ...o.args, out], output: out,
            label: files.length > 1 ? `Converting ${i + 1} of ${files.length}` : 'Converting',
          }, [i / files.length, (i + 1) / files.length])
          items.push({ blob, name: outName, inputSize: file.size, kind: 'audio' })
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
      return { items, title: `Converted to ${f.label}`, zipName: `audio-${f.ext}.zip`, summary: `${items.filter((i) => i.blob).length} of ${items.length} files converted to ${f.label}.` }
    },
  })
}
