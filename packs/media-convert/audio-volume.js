// Audio volume & normalize: boost or lower with a live preview, normalize loudness (two-pass loudnorm) or peak. Works on audio and video.
import { createShell, step, tilePicker, pills, note, alert, h, icon, button, clear } from './_ui.js'
import { AUDIO_FORMATS, inputName, parseLoudnorm, parseVolume, audioArgs } from './_media.js'
import { firstThatWorks } from './_video.js'
import { analyze } from './_engine.js'
import { rangeField, select, field, toggle, isAbort, onCleanup } from '../../lib/ui.js'
import { suffixName, ext } from '../../lib/files.js'

const TARGETS = [[-16, 'Podcasts, YouTube, voice (-16 LUFS)'], [-14, 'Spotify, Apple Music (-14 LUFS)'], [-23, 'TV and radio, EBU R128 (-23 LUFS)'], [-18, 'Quieter, for calm listening (-18 LUFS)']]
const dbToGain = (db) => 10 ** (db / 20)
const fmtDb = (v) => `${v > 0 ? '+' : ''}${v} dB (${Math.round(dbToGain(v) * 100)}%)`
const AUDIO_EXTS = Object.values(AUDIO_FORMATS).map((f) => f.ext)

export function mount(root, { signal }) {
  let get = null
  createShell(root, { signal }, {
    kind: 'audio',
    require: 'audio',
    dropIcon: 'volume-2',
    dropLabel: 'Drop audio or a video to adjust the volume',
    action: { label: 'Apply', icon: 'volume-2', busy: 'Adjusting volume' },
    options(media, shell) {
      const { info, file } = media
      const isVideo = info.hasVideo
      let mode = 'gain'
      let measured = null
      let busyMeasure = false

      const modePicker = tilePicker({
        label: 'What to do', value: mode, onChange: (v) => { mode = v; refresh() },
        options: [
          { value: 'gain', label: 'Louder or quieter', sub: 'Pick an exact change, hear it live', icon: 'sliders-horizontal' },
          { value: 'loudness', label: 'Even loudness', sub: 'Match a standard like -16 LUFS', icon: 'audio-lines' },
          { value: 'peak', label: 'Peak normalize', sub: 'Make the loudest peak just reach full scale', icon: 'trending-up' },
        ],
      })

      // ---- gain
      const gain = rangeField('Volume change', { min: -30, max: 30, step: 0.5, value: 6, format: fmtDb, onInput: () => refresh() })
      const quick = pills([[-12, '-12 dB'], [-6, 'Half (-6)'], [3, '+3'], [6, 'Double (+6)'], [10, '+10'], [20, '+20']], null, (v) => { gain.set(v); refresh() }, 'Quick picks')
      const limiter = toggle('Prevent clipping (softly limit the peaks)', true, () => refresh())
      const gainBox = h('div', { class: 'stack' }, quick, gain, h('div', { class: 'mc-switches' }, limiter))

      // ---- loudness
      const targetSel = select(TARGETS, -16, () => refresh())
      const measureOut = h('div', { class: 'stack tight' })
      const measureBtn = button('Check current loudness', { icon: 'activity', variant: 'secondary', size: 'sm', onClick: () => runMeasure() })
      const loudBox = h('div', { class: 'stack' }, field('Target loudness', targetSel), h('div', { class: 'row' }, measureBtn), measureOut,
        note('Measures the whole file first, then applies one precise gain so quiet and loud files end up equally loud. The sound is not squashed.'))
      const peakBox = h('div', { class: 'stack' }, note('Raises or lowers everything by the same amount so the loudest moment ends at -1 dB. Good for quiet recordings.'))

      async function runMeasure() {
        if (busyMeasure) return
        busyMeasure = true
        measureBtn.disabled = true
        clear(measureOut, h('div', { class: 'mc-note' }, 'Measuring...'))
        refresh()
        try {
          const log = await analyze({ inputs: [{ name: inputName(file), data: file }], args: ['-i', inputName(file), '-vn', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], signal })
          measured = parseLoudnorm(log)
          showMeasure()
        } catch (e) {
          if (!isAbort(e)) clear(measureOut, alert('error', 'Could not measure this file.'))
        } finally {
          busyMeasure = false
          measureBtn.disabled = false
          refresh()
        }
      }
      function showMeasure() {
        if (!measured) { clear(measureOut, alert('warn', 'No loudness could be measured. The file may be silent.')); return }
        const t = +targetSel.value
        clear(measureOut, h('div', { class: 'mc-chips' },
          h('span', { class: 'mc-chip' }, icon('audio-lines'), `Loudness ${measured.i.toFixed(1)} LUFS`),
          h('span', { class: 'mc-chip' }, icon('trending-up'), `True peak ${measured.tp.toFixed(1)} dBTP`),
          h('span', { class: 'mc-chip' }, icon('ruler'), `Range ${measured.lra.toFixed(1)} LU`)),
        h('div', { class: 'mc-note' }, `To reach ${t} LUFS this file changes by ${(t - measured.i > 0 ? '+' : '') + (t - measured.i).toFixed(1)} dB.`))
      }

      // ---- live preview through WebAudio
      let ac = null
      let gainNode = null
      if (media.el && media.canPlay) {
        try {
          ac = new (window.AudioContext || window.webkitAudioContext)()
          const srcNode = ac.createMediaElementSource(media.el)
          gainNode = ac.createGain()
          srcNode.connect(gainNode).connect(ac.destination)
          media.el.addEventListener('play', () => ac.resume())
          onCleanup(() => { try { ac.close() } catch { /* closed */ } })
        } catch { ac = null }
      }
      const previewNote = note('')

      get = () => ({ mode, gainDb: gain.input.valueAsNumber, limiter: limiter.input.checked, target: +targetSel.value, measured })
      function refresh() {
        gainBox.hidden = mode !== 'gain'
        loudBox.hidden = mode !== 'loudness'
        peakBox.hidden = mode !== 'peak'
        const g = gain.input.valueAsNumber
        if (gainNode) gainNode.gain.value = mode === 'gain' ? dbToGain(g) : 1
        previewNote.textContent = mode === 'gain' ? (ac ? 'Press play above to hear the new volume live. It only changes the preview until you apply it.' : 'Live preview is not available for this file in your browser.') : ''
        if (measured && mode === 'loudness') showMeasure()
        shell.setEnabled(!busyMeasure && (mode !== 'gain' || Math.abs(g) > 0.01), busyMeasure ? 'Measuring the loudness...' : 'Choose a volume change first')
        shell.setInfo(mode === 'gain' ? (Math.abs(g) < 0.01 ? 'Choose a change' : `${fmtDb(g)}`) : mode === 'loudness' ? `Target ${targetSel.value} LUFS` : 'Peak to -1 dB',
          isVideo ? 'The picture is copied, only the sound is processed' : 'Saved in the same format as the original')
      }
      refresh()
      return [
        step(1, 'What to do', modePicker),
        step(2, 'Settings', [gainBox, loudBox, peakBox, previewNote]),
      ]
    },

    async execute(media, hp) {
      const { file, info } = media
      const o = get()
      const inName = inputName(file)
      const rate = info.audio.rate || 44100
      const inputs = () => [{ name: inName, data: file }]
      let filter
      let post = []
      let note2 = ''
      let encodeStart = 0
      if (o.mode === 'gain') {
        filter = `volume=${o.gainDb}dB${o.limiter && o.gainDb > 0 ? ',alimiter=limit=0.97:level=0' : ''}`
      } else if (o.mode === 'peak') {
        const log = await analyze({ inputs: inputs(), args: ['-i', inName, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], signal: hp.signal, onProgress: (f) => hp.report(f == null ? null : f * 0.4, 'Finding the loudest peak') })
        const v = parseVolume(log)
        if (!v) throw new Error('Could not measure this file. It may be silent.')
        const db = +(-1 - v.max).toFixed(2)
        filter = `volume=${db}dB`
        note2 = `The peak was ${v.max} dB, so everything was changed by ${db > 0 ? '+' : ''}${db} dB.`
        encodeStart = 0.4
      } else {
        let m = o.measured
        if (!m) {
          const log = await analyze({ inputs: inputs(), args: ['-i', inName, '-vn', '-af', `loudnorm=I=${o.target}:TP=-1.5:LRA=11:print_format=json`, '-f', 'null', '-'], signal: hp.signal, onProgress: (f) => hp.report(f == null ? null : f * 0.4, 'Measuring loudness') })
          m = parseLoudnorm(log)
          if (!m || !Number.isFinite(m.i)) throw new Error('Could not measure this file. It may be silent.')
        }
        filter = `loudnorm=I=${o.target}:TP=-1.5:LRA=11:measured_I=${m.i}:measured_TP=${m.tp}:measured_LRA=${m.lra}:measured_thresh=${m.thresh}:offset=${m.offset}:linear=true`
        post = ['-ar', String(rate)]
        note2 = `Loudness went from ${m.i.toFixed(1)} to about ${o.target} LUFS.`
        encodeStart = 0.4
      }
      const span = [encodeStart, 1]
      const e0 = ext(file.name)

      if (info.hasVideo) {
        const build = (e) => () => {
          const out = `out.${e}`
          const enc = e === 'webm' ? ['-c:a', 'libopus', '-b:a', '128k'] : ['-c:a', 'aac', '-b:a', '160k']
          return hp.ffmpeg({ inputs: inputs(), args: ['-i', inName, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-af', filter, ...enc, ...post, out], output: out, label: 'Adjusting the sound' }, span).then((blob) => ({ blob, e }))
        }
        const pick = ['mp4', 'mov', 'mkv', 'webm'].includes(e0) ? e0 : 'mp4'
        const { blob, e } = await firstThatWorks([build(pick), build('mkv')], isAbort)
        return { blob, name: suffixName(file.name, 'volume', e), inputSize: file.size, title: 'Volume adjusted', summary: `${note2 || 'The sound was changed.'} The picture was copied untouched.` }
      }
      const fmt = AUDIO_EXTS.includes(e0) ? AUDIO_FORMATS[Object.keys(AUDIO_FORMATS).find((k) => AUDIO_FORMATS[k].ext === e0)] : AUDIO_FORMATS.mp3
      const br = fmt.lossy ? (fmt.bitrates.find((b) => b >= (info.audio.bitrate || 0) * 0.95) || fmt.def) : 0
      const out = `out.${fmt.ext}`
      const blob = await hp.ffmpeg({
        inputs: inputs(), args: ['-i', inName, '-vn', '-map', '0:a:0', '-map_metadata', '0', '-af', filter, ...audioArgs(fmt.id, { bitrate: Math.max(br, fmt.lossy ? 128 : 0) }), ...post, out], output: out, label: 'Adjusting the sound',
      }, span)
      return { blob, kind: 'audio', name: suffixName(file.name, 'volume', fmt.ext), inputSize: file.size, title: 'Volume adjusted', summary: note2 || 'The sound was changed and saved in the same format.' }
    },
  })
}
