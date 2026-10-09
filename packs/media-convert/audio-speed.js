// Change audio speed: faster or slower with the pitch kept (atempo chain), or pitch following the speed (asetrate).
import { createShell, step, tilePicker, pills, note } from './_ui.js'
import { inputName, atempoChain, fmtTime, audioArgs } from './_media.js'
import { sameFormat } from './_audio.js'
import { number, field } from '../../lib/ui.js'
import { suffixName } from '../../lib/files.js'

const QUICK = [0.5, 0.75, 1.25, 1.5, 1.75, 2, 2.5, 3]
const label = (s) => `${+s.toFixed(3)}x`

export function mount(root, { signal }) {
  let get = null
  createShell(root, { signal }, {
    kind: 'audio',
    require: 'audio',
    dropIcon: 'timer',
    dropLabel: 'Drop audio to speed it up or slow it down',
    action: { label: 'Change speed', icon: 'timer', busy: 'Changing speed' },
    options(media, shell) {
      const { info } = media
      let speed = 1.5
      let pitch = 'keep'
      const custom = number(speed, { min: 0.25, max: 4, step: 0.05, ariaLabel: 'Custom speed multiplier', onInput: (n) => { if (Number.isFinite(n)) { speed = n; quick.set(QUICK.includes(n) ? n : null) } refresh() } })
      const quick = pills(QUICK.map((q) => [q, label(q)]), speed, (v) => { speed = v; custom.value = String(v); refresh() }, 'Speed')
      const pitchPicker = tilePicker({
        label: 'Pitch', value: pitch, onChange: (v) => { pitch = v; refresh() },
        options: [{ value: 'keep', label: 'Keep the pitch', sub: 'Voices sound natural at any speed', icon: 'mic' }, { value: 'follow', label: 'Pitch follows speed', sub: 'Chipmunk when fast, deep when slow', icon: 'audio-waveform' }],
      })
      const explain = note('')
      get = () => ({ speed, pitch })
      function refresh() {
        const ok = Number.isFinite(speed) && speed >= 0.25 && speed <= 4
        shell.setEnabled(ok && Math.abs(speed - 1) > 0.001, ok ? 'Pick a speed other than 1x' : 'Pick a speed between 0.25x and 4x')
        if (!ok) return shell.setInfo('Pick a speed', '')
        if (media.el && media.canPlay) {
          try { media.el.playbackRate = speed; media.el.preservesPitch = pitch === 'keep' } catch { /* unsupported */ }
        }
        const out = (info.duration || 0) / speed
        shell.setInfo(`${label(speed)} speed`, info.duration ? `${fmtTime(info.duration)} becomes ${fmtTime(out, out < 10 ? 1 : 0)}` : 'Re-encoded')
        explain.textContent = 'Press play above to hear the new speed before you save. It is only a preview until you apply it.'
      }
      refresh()
      return [step(1, 'Speed', [quick, field('Custom speed (1 = normal)', custom)]), step(2, 'Pitch', [pitchPicker, explain])]
    },
    async execute(media, hp) {
      const { file, info } = media
      const { speed, pitch } = get()
      const rate = info.audio.rate || 44100
      const { fmt, bitrate } = sameFormat(file, info)
      const out = `out.${fmt.ext}`
      const inName = inputName(file)
      const af = pitch === 'keep' ? atempoChain(speed) : `asetrate=${Math.round(rate * speed)},aresample=${rate}`
      const blob = await hp.ffmpeg({
        inputs: [{ name: inName, data: file }],
        args: ['-i', inName, '-vn', '-map', '0:a:0', '-map_metadata', '0', '-af', af, ...audioArgs(fmt.id, { bitrate }), out], output: out, label: 'Changing the speed',
      })
      return {
        blob, kind: 'audio', name: suffixName(file.name, label(speed).replace('.', '_'), fmt.ext), inputSize: file.size,
        title: speed > 1 ? `${label(speed)} faster` : `${label(speed)} slower`,
        summary: `${fmtTime((info.duration || 0) / speed, 1)} long now${pitch === 'keep' ? ', with the original pitch' : ''}.`,
      }
    },
  })
}
