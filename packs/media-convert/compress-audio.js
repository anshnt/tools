// Compress audio: pick a purpose (voice, podcast, music) or an exact size, with bitrate, mono and format controls.
import { createShell, step, tilePicker, note, alert, h } from './_ui.js'
import { AUDIO_FORMATS, audioArgs, inputName, MB, fmtTime } from './_media.js'
import { number, select, field, toggle, formatBytes } from '../../lib/ui.js'
import { withExt } from '../../lib/files.js'
import { setSelectOptions } from './_audio.js'

const PRESETS = {
  voice: { label: 'Voice message', sub: 'Clear speech, tiny file', icon: 'mic', kbps: 48, mono: true, rate: 22050 },
  podcast: { label: 'Podcast', sub: 'Spoken word, small', icon: 'podcast', kbps: 64, mono: true, rate: 0 },
  music: { label: 'Music, small', sub: 'Good for phones', icon: 'music', kbps: 128, mono: false, rate: 0 },
  music_hq: { label: 'Music, great', sub: 'Near transparent', icon: 'sparkles', kbps: 192, mono: false, rate: 0 },
  size: { label: 'Exact size', sub: 'Fit a size limit in MB', icon: 'ruler', kbps: 0, mono: false, rate: 0 },
}
const FORMATS = ['mp3', 'm4a', 'opus', 'ogg']

/** Bitrate (kbps) that makes a file of `bytes` for `duration` seconds, clamped to what encoders accept. */
export const kbpsForSize = (bytes, duration) => Math.max(8, Math.min(320, Math.floor((bytes * 8 * 0.97) / duration / 1000)))

export function mount(root, { signal }) {
  let get = null
  createShell(root, { signal }, {
    kind: 'audio',
    require: 'audio',
    dropIcon: 'minimize-2',
    dropLabel: 'Drop audio to make it smaller',
    action: { label: 'Compress audio', icon: 'minimize-2', busy: 'Compressing' },
    options(media, shell) {
      const { info, file } = media
      const dur = info.duration
      const srcKbps = info.audio.bitrate || info.bitrate || 0
      let preset = 'podcast'
      let fmt = 'mp3'
      const presetPicker = tilePicker({
        label: 'What is it for?', value: preset, onChange: (v) => { preset = v; apply(); refresh() },
        options: Object.entries(PRESETS).map(([value, p]) => ({ value, label: p.label, sub: p.sub, icon: p.icon })),
      })
      const sizeIn = number(Math.max(0.5, Math.round((file.size / MB) * 0.3 * 10) / 10), { min: 0.1, max: 500, step: 0.1, ariaLabel: 'Target size in megabytes', onInput: () => refresh() })
      const sizeBox = h('div', { hidden: true }, field('Target size (MB)', sizeIn, 'The bitrate is chosen so the file lands just under this.'))
      const fmtPicker = tilePicker({
        label: 'Format', value: fmt, compact: true, onChange: (v) => { fmt = v; fillBitrates(); refresh() },
        options: FORMATS.map((id) => ({ value: id, label: AUDIO_FORMATS[id].label.replace(' (AAC)', ''), sub: AUDIO_FORMATS[id].note })),
      })
      const br = select([], 64, () => refresh())
      const mono = toggle('Mono (one channel, about half the size)', true, () => refresh())
      const rate = select([[0, 'Keep original'], [44100, '44.1 kHz'], [32000, '32 kHz'], [22050, '22.05 kHz'], [16000, '16 kHz']], 0, () => refresh())
      const brField = field('Bitrate', br)
      const explain = h('div', { class: 'stack tight' })

      function fillBitrates() {
        const f = AUDIO_FORMATS[fmt]
        const list = [...new Set([...f.bitrates, 48, 40, 32].filter((b) => b >= 24 || fmt === 'opus'))].sort((a, b) => a - b)
        setSelectOptions(br, list.map((b) => [b, `${b} kbps`]), list.includes(+br.value) ? +br.value : list.find((b) => b >= (PRESETS[preset].kbps || 64)) || list.at(-1))
      }
      function apply() {
        const p = PRESETS[preset]
        if (p.kbps) { fillBitrates(); br.value = String([...br.options].map((o) => +o.value).find((b) => b >= p.kbps) ?? br.value); mono.input.checked = p.mono; rate.value = String(p.rate) }
      }
      fillBitrates()
      apply()

      get = () => {
        const isSize = preset === 'size'
        const mb = sizeIn.valueAsNumber
        const kbps = isSize ? (dur && mb > 0 ? kbpsForSize(mb * MB, dur) : 0) : +br.value
        return { fmt, kbps, mono: mono.input.checked, rate: +rate.value || 0, isSize, mb }
      }
      function refresh() {
        const o = get()
        sizeBox.hidden = !o.isSize
        brField.hidden = o.isSize
        let ok = true
        let why = ''
        const nodes = []
        if (o.isSize && !(dur && o.mb > 0)) { ok = false; why = dur ? 'Enter a target size' : 'The length of this file is unknown, so a size target is not possible' }
        if (ok) {
          const est = (o.kbps * 1000 / 8) * (dur || 0)
          if (o.isSize && o.kbps <= 24) nodes.push(alert('warn', `To fit ${o.mb} MB the bitrate drops to ${o.kbps} kbps. Speech may survive, music will sound rough.${fmt !== 'opus' ? ' Opus holds up best at very low bitrates.' : ''}`))
          if (srcKbps && o.kbps >= srcKbps * 1.05) nodes.push(alert('info', `The original is only about ${srcKbps} kbps, so ${o.kbps} kbps will not make it smaller.`))
          nodes.push(h('dl', { class: 'mc-kv' }, h('dt', 'Result'), h('dd', `${AUDIO_FORMATS[fmt].label.replace(' (AAC)', '')}, ${o.kbps} kbps, ${o.mono ? 'mono' : 'keeps stereo'}`), h('dt', 'Expected size'), h('dd', dur ? `about ${formatBytes(est)} (now ${formatBytes(file.size)}, ${fmtTime(dur)})` : '-')))
          shell.setInfo(dur ? `About ${formatBytes(est)}` : `${o.kbps} kbps`, `${o.kbps} kbps ${o.mono ? 'mono' : 'stereo'}${dur ? `, from ${formatBytes(file.size)}` : ''}`)
        } else shell.setInfo('', why)
        shell.setEnabled(ok, why)
        explain.replaceChildren(...nodes)
      }
      refresh()
      return [
        step(1, 'What is it for?', [presetPicker, sizeBox]),
        step(2, 'Format and quality', [fmtPicker, h('div', { class: 'mc-grid' }, brField, field('Sample rate', rate)), h('div', { class: 'mc-switches' }, mono), explain]),
      ]
    },
    async execute(media, hp) {
      const { file, info } = media
      const o = get()
      const f = AUDIO_FORMATS[o.fmt]
      const inName = inputName(file)
      const out = `out.${f.ext}`
      const encode = (kbps, label) => hp.ffmpeg({
        inputs: [{ name: inName, data: file }],
        args: ['-i', inName, '-vn', '-map', '0:a:0', '-map_metadata', '0', ...audioArgs(o.fmt, { bitrate: kbps, sampleRate: o.rate, channels: o.mono ? 1 : 0 }), out], output: out, label,
      })
      let kbps = o.kbps
      let blob = await encode(kbps, 'Compressing the audio')
      let tries = 1
      if (o.isSize) {
        // headers and VBR can push a small file a bit over: squeeze the bitrate and go again (audio encodes are quick)
        while (blob.size > o.mb * MB && tries < 4 && kbps > 8) {
          kbps = Math.max(8, Math.floor(kbps * ((o.mb * MB * 0.96) / blob.size)))
          blob = await encode(kbps, 'A little over, squeezing a bit more')
          tries++
        }
      }
      const notes = []
      if (o.isSize) {
        const lim = o.mb * MB
        notes.push(blob.size <= lim ? alert('success', h('strong', `Under ${o.mb} MB. `), `${formatBytes(blob.size)} fits the limit.`) : alert('warn', h('strong', 'A little over. '), `${formatBytes(blob.size)} is slightly above ${o.mb} MB. Try a slightly smaller target.`))
      }
      return {
        blob, kind: 'audio', name: withExt(file.name.replace(/(\.[^.]+)$/, '-compressed$1'), f.ext), inputSize: file.size, notes,
        title: blob.size < file.size ? `Down to ${formatBytes(blob.size)}` : 'Compressed',
        summary: `${f.label.replace(' (AAC)', '')} at ${kbps} kbps${o.mono ? ', mono' : ''}.`,
      }
    },
  })
}
