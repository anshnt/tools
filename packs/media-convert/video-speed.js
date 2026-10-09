// Change video speed: slow motion or fast forward, with the audio tempo kept in step (setpts plus an atempo chain).
import { createShell, step, tilePicker, pills, note } from './_ui.js'
import { inputName, atempoChain, fmtTime } from './_media.js'
import { reencodePlan, mapAV, QUALITY_OPTIONS } from './_video.js'
import { number, field } from '../../lib/ui.js'
import { suffixName } from '../../lib/files.js'

const QUICK = [0.25, 0.5, 0.75, 1.25, 1.5, 2, 3, 4, 8]
export const speedLabel = (s) => `${+s.toFixed(3)}x`

export function mount(root, { signal }) {
  let get = null
  createShell(root, { signal }, {
    kind: 'video',
    require: 'video',
    dropIcon: 'fast-forward',
    dropLabel: 'Drop a video to speed it up or slow it down',
    action: { label: 'Change speed', icon: 'fast-forward', busy: 'Changing speed' },
    options(media, shell) {
      const { info } = media
      let speed = 2
      let sound = 'keep'
      let quality = 'balanced'
      const custom = number(speed, { min: 0.1, max: 16, step: 0.05, ariaLabel: 'Custom speed multiplier', onInput: (n) => { if (Number.isFinite(n)) { speed = n; quick.set(QUICK.includes(n) ? n : null); refresh() } else refresh() } })
      const quick = pills(QUICK.map((q) => [q, speedLabel(q)]), speed, (v) => { speed = v; custom.value = String(v); refresh() }, 'Speed')
      const soundPicker = tilePicker({
        label: 'Sound', value: sound, onChange: (v) => { sound = v; refresh() },
        options: [
          { value: 'keep', label: 'Keep the sound', sub: 'Speeds up with the same pitch', icon: 'volume-2' },
          { value: 'pitch', label: 'Change the pitch', sub: 'Chipmunk when fast, deep when slow', icon: 'audio-waveform' },
          { value: 'mute', label: 'Remove the sound', sub: 'Silent video', icon: 'volume-x' },
        ],
      })
      const qualityPicker = tilePicker({ label: 'Quality', options: QUALITY_OPTIONS, value: quality, compact: true, onChange: (v) => { quality = v } })
      const explain = note('')
      const soundStep = step(2, 'Sound', soundPicker)
      soundStep.hidden = !info.hasAudio

      get = () => ({ speed, sound: info.hasAudio ? sound : 'mute', quality })
      function refresh() {
        const ok = Number.isFinite(speed) && speed >= 0.1 && speed <= 16
        shell.setEnabled(ok && Math.abs(speed - 1) > 0.001, ok ? 'Pick a speed other than 1x' : 'Pick a speed between 0.1x and 16x')
        if (!ok) { shell.setInfo('Pick a speed', ''); return }
        const out = (info.duration || 0) / speed
        if (media.el && media.canPlay) { try { media.el.playbackRate = Math.min(16, Math.max(0.0625, speed)) } catch { /* unsupported rate */ } }
        shell.setInfo(`${speedLabel(speed)} speed`, info.duration ? `${fmtTime(info.duration)} becomes ${fmtTime(out, out < 10 ? 1 : 0)}` : 'Re-encoded')
        explain.textContent = speed > 1
          ? `Plays ${speedLabel(speed)} faster. Press play on the video above to preview it at this speed.${speed > 4 ? ' Very fast speeds make speech unintelligible.' : ''}`
          : speed < 1 ? `Slow motion at ${speedLabel(speed)}. Frames are repeated, so for silky slow motion you need footage shot at a high frame rate. Press play above to preview.`
            : 'This is the original speed.'
        explain.className = 'mc-note'
      }
      refresh()
      return [
        step(1, 'Speed', [quick, field('Custom speed (1 = normal)', custom), explain]),
        soundStep,
        step(3, 'Quality', qualityPicker),
      ]
    },
    async execute(media, hp) {
      const { file, info } = media
      const { speed, sound, quality } = get()
      const fps = Math.min(60, Math.round((info.video.fps || 30) * 100) / 100)
      const plan = reencodePlan(file, info, { quality, audio: sound === 'mute' || !info.hasAudio ? 'none' : 'encode' })
      const inName = inputName(file)
      const out = `out.${plan.ext}`
      const rate = info.audio?.rate || 44100
      const af = sound === 'keep' ? atempoChain(speed) : `asetrate=${Math.round(rate * speed)},aresample=${rate}`
      const args = ['-i', inName, ...mapAV(info), '-vf', `setpts=PTS/${speed},fps=${fps}`, ...(plan.audio === 'none' ? [] : ['-af', af]), ...plan.codec, out]
      const blob = await hp.ffmpeg({ inputs: [{ name: inName, data: file }], args, output: out, label: 'Changing the speed' })
      return {
        blob, name: suffixName(file.name, speedLabel(speed).replace('.', '_'), plan.ext), inputSize: file.size,
        title: speed > 1 ? `${speedLabel(speed)} faster` : `${speedLabel(speed)} slow motion`,
        summary: `The video now runs at ${speedLabel(speed)} and lasts about ${fmtTime((info.duration || 0) / speed, 1)}.`,
      }
    },
  })
}
