// Trim audio: waveform timeline with dual handles, preview of the selection, optional fades, output format incl. iPhone ringtone.
import { createShell, step, tilePicker, note, alert, h } from './_ui.js'
import { AUDIO_FORMATS, audioArgs, inputName, fmtTime, copyExtFor } from './_media.js'
import { createTrimmer, computePeaks } from './_timeline.js'
import { number, field, formatBytes } from '../../lib/ui.js'
import { suffixName } from '../../lib/files.js'

const SAME = 'same'
const KEEP_EXTS = ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus', 'aac']

export function mount(root, { signal }) {
  let trimmer = null
  let update = () => {}
  let get = null

  createShell(root, { signal }, {
    kind: 'audio',
    require: 'audio',
    dropIcon: 'scissors',
    dropLabel: 'Drop audio to cut it',
    trust: [['shield-check', 'Stays on your device', 'Nothing is uploaded. The audio is cut inside this tab.'], ['audio-waveform', 'See the sound', 'A waveform shows loud and quiet parts so cuts are easy to place.'], ['smartphone', 'Ringtones too', 'Save an iPhone ringtone (M4R) or any other format.']],
    action: { label: 'Cut audio', icon: 'scissors', busy: 'Cutting' },

    stageExtra(media) {
      const dur = media.info.duration || media.el?.duration || 0
      if (!dur) return h('div', { class: 'mc-note', style: 'padding:10px' }, 'The length of this file could not be read, so the timeline is unavailable.')
      trimmer = createTrimmer({ media, duration: dur, start: 0, end: dur, minLen: 0.2, tall: true, onChange: () => update() })
      const status = h('div', { class: 'mc-note', style: 'padding:0 14px 8px' }, 'Drawing the waveform...')
      computePeaks(media.file, { signal }).then((p) => {
        if (p) { trimmer.setPeaks(p); status.remove() } else status.textContent = 'The waveform could not be drawn for this file, but the handles still work.'
      }).catch(() => { status.textContent = 'The waveform could not be drawn for this file, but the handles still work.' })
      return h('div', { class: 'mc-over' }, trimmer.el, status)
    },

    options(media, shell) {
      const { info, file } = media
      const dur = info.duration || 0
      const srcExt = (file.name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase()
      const canKeep = KEEP_EXTS.includes(srcExt) || !!copyExtFor(info.audio.codec)
      let fmt = canKeep ? SAME : 'mp3'
      const fadeIn = number(0, { min: 0, max: 30, step: 0.5, ariaLabel: 'Fade in seconds', onInput: () => update() })
      const fadeOut = number(0, { min: 0, max: 30, step: 0.5, ariaLabel: 'Fade out seconds', onInput: () => update() })
      const picker = tilePicker({
        label: 'Save as', value: fmt, onChange: (v) => { fmt = v; update() },
        options: [
          ...(canKeep ? [{ value: SAME, label: 'Same as original', sub: `${(srcExt || info.audio.codec).toUpperCase()}, no re-encoding`, icon: 'sparkles' }] : []),
          { value: 'mp3', label: 'MP3', sub: 'Plays everywhere', icon: 'music' },
          { value: 'm4a', label: 'M4A', sub: 'AAC, Apple and Android', icon: 'smartphone' },
          { value: 'm4r', label: 'iPhone ringtone', sub: 'M4R, up to 40 seconds', icon: 'bell' },
          { value: 'wav', label: 'WAV', sub: 'Uncompressed', icon: 'audio-waveform' },
          { value: 'ogg', label: 'OGG', sub: 'Open format', icon: 'waves' },
        ],
      })
      const explain = note('')
      get = () => ({ fmt, fadeIn: Math.max(0, fadeIn.valueAsNumber || 0), fadeOut: Math.max(0, fadeOut.valueAsNumber || 0) })
      update = () => {
        const { start, end } = trimmer ? trimmer.getRange() : { start: 0, end: dur }
        const keep = end - start
        const whole = start < 0.05 && end > dur - 0.05
        const o = get()
        const fades = o.fadeIn + o.fadeOut
        const tooLongFades = fades > keep
        const ring = o.fmt === 'm4r' && keep > 40
        shell.setEnabled(!!trimmer && !(whole && !fades && o.fmt === SAME) && keep >= 0.2 && !tooLongFades, tooLongFades ? 'The fades are longer than the cut' : 'Drag a handle to choose the part to keep')
        shell.setInfo(`Keep ${fmtTime(keep, 1)}`, `${fmtTime(start, 1)} to ${fmtTime(end, 1)}${o.fmt === SAME && !fades ? ', copied without re-encoding' : ''}`)
        explain.textContent = ring ? 'iPhone ringtones can be at most 40 seconds. Shorten the selection or save as another format.'
          : fades && o.fmt === SAME ? 'Fades need a re-encode, so the original format is re-encoded at a high bitrate.'
            : o.fmt === 'm4r' ? 'Save as .m4r, then add it to your iPhone with Finder or iTunes (or GarageBand on the phone).' : ''
        explain.className = ring ? 'mc-note warn' : 'mc-note'
      }
      update()
      return [
        step(1, 'Save as', [picker, explain]),
        step(2, 'Fades (optional)', h('div', { class: 'mc-grid' }, field('Fade in (seconds)', fadeIn), field('Fade out (seconds)', fadeOut))),
      ]
    },

    async execute(media, hp) {
      const { file, info } = media
      const o = get()
      const { start, end } = trimmer.getRange()
      const keep = +(end - start).toFixed(3)
      const inName = inputName(file)
      const inputs = [{ name: inName, data: file }]
      const pre = ['-ss', start.toFixed(3), '-i', inName, '-t', keep.toFixed(3), '-vn', '-map', '0:a:0', '-map_metadata', '0']
      const af = [o.fadeIn ? `afade=t=in:st=0:d=${o.fadeIn}` : '', o.fadeOut ? `afade=t=out:st=${Math.max(0, keep - o.fadeOut).toFixed(3)}:d=${o.fadeOut}` : ''].filter(Boolean).join(',')
      const copy = o.fmt === SAME && !af
      let blob
      let e
      let label = 'Original format'
      if (copy) {
        e = (file.name.match(/\.([^.]+)$/)?.[1] || copyExtFor(info.audio.codec) || 'mka').toLowerCase()
        try {
          blob = await hp.ffmpeg({ inputs, args: [...pre, '-c:a', 'copy', `out.${e}`], output: `out.${e}`, label: 'Copying the selection' })
        } catch (err) {
          if (err?.code === 'ABORT') throw err
          blob = null
        }
      }
      if (!blob) {
        const id = o.fmt === SAME ? (Object.values(AUDIO_FORMATS).find((f) => f.ext === (file.name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase())?.id || 'mp3') : o.fmt === 'm4r' ? 'm4a' : o.fmt
        const f = AUDIO_FORMATS[id]
        e = o.fmt === 'm4r' ? 'm4r' : f.ext
        const br = f.lossy ? Math.max(128, f.bitrates.find((b) => b >= (info.audio.bitrate || 0) * 0.95) || f.def) : 0
        const fmtArgs = o.fmt === 'm4r' ? ['-f', 'ipod'] : []
        blob = await hp.ffmpeg({ inputs, args: [...pre, ...(af ? ['-af', af] : []), ...audioArgs(id, { bitrate: br }), ...fmtArgs, `out.${e}`], output: `out.${e}`, label: 'Cutting the audio' })
        label = f.label
      }
      return {
        blob, kind: 'audio', name: suffixName(file.name, 'trimmed', e), inputSize: file.size, compare: false,
        title: `Kept ${fmtTime(keep, 1)}`,
        summary: `${fmtTime(start, 1)} to ${fmtTime(end, 1)} of the original, saved as ${e.toUpperCase()}${af ? ' with fades' : ''}.${o.fmt === 'm4r' ? ' Ready to use as an iPhone ringtone.' : ''}`,
        stats: [{ label: 'Kept', value: fmtTime(keep, 1) }],
      }
    },
  })
}
