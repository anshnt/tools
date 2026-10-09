// Merge audio files: order them, optionally crossfade, and save as one track. Matching files join instantly (concat demuxer, no re-encode).
import { createMultiShell, storyboard } from './_multi.js'
import { audioOptions } from './_audio.js'
import { step, note, alert, h } from './_ui.js'
import { AUDIO_FORMATS, audioArgs, inputName, streamSig, fmtTime } from './_media.js'
import { number, field, isAbort } from '../../lib/ui.js'
import { baseName, ext } from '../../lib/files.js'

const FORMAT_BY_EXT = Object.fromEntries(Object.values(AUDIO_FORMATS).map((f) => [f.ext, f.id]))

export function mount(root, { signal }) {
  let opts = null
  let board = null
  let fade = null
  let refresh = () => {}

  createMultiShell(root, { signal }, {
    kind: 'audio',
    min: 2,
    max: 30,
    dropIcon: 'merge',
    dropLabel: 'Drop two or more audio files here or click to choose',
    dropHint: 'MP3, WAV, M4A, OGG, FLAC and more. Reorder them after adding.',
    action: { label: 'Join audio', icon: 'merge', busy: 'Joining' },
    trust: [['shield-check', 'Stays on your device', 'Nothing is uploaded. The files are joined inside this tab.'], ['zap', 'Instant when files match', 'Same-format files are joined with no re-encoding and no loss.'], ['audio-lines', 'Crossfade option', 'Blend the end of one track into the start of the next.']],

    options(set, shell) {
      opts = audioOptions({
        fmt: 'copy', getInfo: () => set.info(set.files[0]), onChange: () => refresh(), startStep: 2,
        extra: [{ value: 'copy', label: 'Same as the files', sub: 'Instant when they match', icon: 'sparkles' }],
        formats: ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus'], formatTitle: 'Save as',
      })
      board = storyboard(set)
      fade = number(0, { min: 0, max: 15, step: 0.5, ariaLabel: 'Crossfade seconds', onInput: () => refresh() })
      const fadeNote = note('')
      const verdict = h('div')
      refresh = () => {
        board.update()
        const infos = set.files.map((f) => set.info(f))
        const ready = infos.every(Boolean)
        const cf = Math.max(0, fade.valueAsNumber || 0)
        const shortest = ready ? Math.min(...infos.map((i) => i.duration || Infinity)) : Infinity
        const total = infos.reduce((a, i) => a + (i?.duration || 0), 0) - Math.max(0, set.files.length - 1) * cf
        const same = ready && new Set(infos.map(streamSig)).size === 1 && new Set(set.files.map((f) => ext(f.name))).size === 1
        const o = opts.get()
        const copy = o.fmt === 'copy' && same && !cf
        const nodes = []
        if (!ready) nodes.push(note('Reading the files...'))
        else if (o.fmt === 'copy' && !same) nodes.push(alert('info', h('strong', 'The files differ. '), 'They have different formats, so they are converted to one common format. Pick a format below or use the suggestion.'))
        else if (copy) nodes.push(alert('success', h('strong', 'These files match. '), 'They are joined instantly with no re-encoding.'))
        verdict.replaceChildren(...nodes)
        const badFade = ready && cf > 0 && cf * 2 > shortest
        fadeNote.textContent = badFade ? `The crossfade is longer than half of the shortest file (${fmtTime(shortest, 1)}). Use a shorter one.` : cf ? `Each pair of tracks overlaps by ${cf} s, so the result is ${cf * (set.files.length - 1)} s shorter.` : 'Set a few seconds to blend one track into the next. 0 means a clean cut.'
        fadeNote.className = badFade ? 'mc-note warn' : 'mc-note'
        shell.setEnabled(ready && !badFade && set.files.length >= 2, badFade ? 'The crossfade is too long' : 'Add at least 2 files')
        shell.setInfo(`${set.files.length} files${total > 0 ? `, ${fmtTime(total, 1)}` : ''}`, copy ? 'Joined instantly, no re-encoding' : ready ? 'Re-encoded to one format' : 'Reading the files...')
      }
      const nodes = [step(1, 'Order', board), ...opts.nodes, step(4, 'Crossfade (optional)', [field('Crossfade length (seconds)', fade), fadeNote]), h('div', verdict)]
      refresh()
      return nodes
    },
    onSet: () => { opts?.refresh(); refresh() },

    async execute(set, hp) {
      await set.ready()
      const files = [...set.files]
      const infos = files.map((f) => set.info(f))
      const o = opts.get()
      const cf = Math.max(0, fade.valueAsNumber || 0)
      const total = infos.reduce((a, i) => a + (i.duration || 0), 0) - (files.length - 1) * cf
      const names = files.map((f, i) => inputName(f, String(i)))
      const inputs = files.map((f, i) => ({ name: names[i], data: f }))
      const same = new Set(infos.map(streamSig)).size === 1 && new Set(files.map((f) => ext(f.name))).size === 1
      let blob = null
      let outExt
      let how = 'encode'

      if (o.fmt === 'copy' && same && !cf) {
        const e = ext(files[0].name)
        const list = names.map((n) => `file '${n}'`).join('\n')
        try {
          blob = await hp.ffmpeg({ inputs: [...inputs, { name: 'list.txt', data: new Blob([list]) }], args: ['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-vn', '-map', '0:a:0', '-c', 'copy', `out.${e}`], output: `out.${e}`, label: 'Joining the files', total })
          outExt = e
          how = 'copy'
        } catch (e) { if (isAbort(e)) throw e }
      }
      if (!blob) {
        const id = o.fmt === 'copy' ? (FORMAT_BY_EXT[ext(files[0].name)] || 'mp3') : o.fmt
        const f = AUDIO_FORMATS[id]
        const rate = o.sampleRate || infos[0].audio.rate || 44100
        const layout = o.channels === 1 ? 'mono' : o.channels === 2 ? 'stereo' : infos.some((i) => (i.audio.channels || 2) > 1) ? 'stereo' : 'mono'
        const norm = files.map((_, i) => `[${i}:a:0]aresample=${rate},aformat=sample_fmts=fltp:channel_layouts=${layout}[a${i}]`)
        let chain
        if (cf > 0) {
          const steps = []
          let prev = '[a0]'
          for (let i = 1; i < files.length; i++) {
            const out = i === files.length - 1 ? '[a]' : `[x${i}]`
            steps.push(`${prev}[a${i}]acrossfade=d=${cf}:c1=tri:c2=tri${out}`)
            prev = out
          }
          chain = steps.join(';')
        } else chain = `${files.map((_, i) => `[a${i}]`).join('')}concat=n=${files.length}:v=0:a=1[a]`
        const br = f.lossy ? (o.bitrate || f.def) : 0
        const args = [...names.flatMap((n) => ['-i', n]), '-filter_complex', [...norm, chain].join(';'), '-map', '[a]', ...audioArgs(id, { bitrate: br, depth: o.depth }), `out.${f.ext}`]
        blob = await hp.ffmpeg({ inputs, args, output: `out.${f.ext}`, label: 'Joining and encoding', total })
        outExt = f.ext
      }
      return {
        blob, kind: 'audio', name: `${baseName(files[0].name)}-merged.${outExt}`, compare: false,
        title: `Joined ${files.length} files`,
        summary: how === 'copy' ? 'The files matched, so they were joined without re-encoding.' : `The files were combined${cf ? ` with a ${cf} s crossfade` : ''} and saved as ${outExt.toUpperCase()}.`,
        stats: [{ label: 'Files', value: String(files.length) }],
      }
    },
  })
}
