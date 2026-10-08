// Trim video: dual-handle timeline with a filmstrip and live preview. Fast cut copies streams; precise cut re-encodes for frame accuracy.
import { createShell, step, tilePicker, note, alert, h } from './_ui.js'
import { inputName, fmtTime } from './_media.js'
import { reencodePlan, mapAV, firstThatWorks } from './_video.js'
import { createTrimmer } from './_timeline.js'
import { mediaDuration } from './_engine.js'
import { isAbort } from '../../lib/ui.js'
import { suffixName, ext } from '../../lib/files.js'

export function mount(root, { signal }) {
  let trimmer = null
  let mode = 'fast'
  let update = () => {}

  createShell(root, { signal }, {
    kind: 'video',
    require: 'video',
    dropIcon: 'scissors',
    dropLabel: 'Drop a video to cut it',
    action: { label: 'Cut video', icon: 'scissors', busy: 'Cutting' },
    trust: [['shield-check', 'Stays on your device', 'Nothing is uploaded. The video is cut inside this tab.'], ['scissors', 'Drag, play, cut', 'Drag the handles, preview the selection, then save just that part.'], ['zap', 'Instant fast cut', 'Fast mode copies the video as it is, with no quality loss.']],

    stageExtra(media) {
      const dur = media.info.duration || media.el?.duration || 0
      if (!dur) return h('div', { class: 'mc-note', style: 'padding:10px' }, 'The length of this video could not be read, so the timeline is unavailable.')
      trimmer = createTrimmer({ media, duration: dur, start: 0, end: dur, minLen: 0.2, film: true, tall: true, onChange: () => update() })
      return trimmer.el
    },

    options(media, shell) {
      const { info } = media
      const dur = info.duration || 0
      const picker = tilePicker({
        label: 'Cutting method', value: mode, onChange: (v) => { mode = v; update() },
        options: [
          { value: 'fast', label: 'Fast cut', sub: 'Instant, no quality loss. Starts at the nearest earlier keyframe', icon: 'zap' },
          { value: 'precise', label: 'Precise cut', sub: 'Frame accurate. Re-encodes, so it takes longer', icon: 'crosshair' },
        ],
      })
      const explain = note('')
      update = () => {
        if (!trimmer) return
        const { start, end } = trimmer.getRange()
        const keep = end - start
        const whole = start < 0.05 && end > dur - 0.05
        shell.setEnabled(!whole && keep >= 0.2, whole ? 'Drag a handle to choose the part to keep' : 'Pick at least 0.2 seconds')
        shell.setInfo(`Keep ${fmtTime(keep, 1)}`, `${fmtTime(start, 1)} to ${fmtTime(end, 1)}${mode === 'fast' ? ', copied without re-encoding' : ', re-encoded'}`)
        explain.textContent = mode === 'fast'
          ? 'Video can only be cut cleanly at keyframes, so a fast cut may begin up to a few seconds before your start point (the sound stays in sync). Use a precise cut when the exact frame matters.'
          : 'The part you chose is re-encoded, so the cut lands on exactly the frame you picked. This takes longer for long clips.'
      }
      update()
      return [step(1, 'How to cut', [picker, explain])]
    },

    async execute(media, hp) {
      const { file, info } = media
      const { start, end } = trimmer.getRange()
      const keep = +(end - start).toFixed(3)
      const inName = inputName(file)
      const inputs = [{ name: inName, data: file }]
      const e0 = ext(file.name) || 'mp4'
      const pre = ['-ss', start.toFixed(3), '-i', inName, '-t', keep.toFixed(3)]
      let blob
      let outExt
      let early = 0
      if (mode === 'fast') {
        const build = (e) => () => {
          const out = `out.${e}`
          return hp.ffmpeg({ inputs, args: [...pre, ...mapAV(info), '-c', 'copy', '-avoid_negative_ts', 'make_zero', out], output: out, label: 'Copying the selection' }).then((b) => ({ b, e }))
        }
        const r = await firstThatWorks([build(e0), build('mkv')], isAbort)
        blob = r.b
        outExt = r.e
        const got = await mediaDuration(blob, 'video')
        if (got != null) early = Math.max(0, got - keep)
      } else {
        const plan = reencodePlan(file, info, { quality: 'high' })
        outExt = plan.ext
        const out = `out.${outExt}`
        blob = await hp.ffmpeg({ inputs, args: [...pre, ...mapAV(info), ...plan.codec, out], output: out, label: 'Cutting precisely' })
      }
      const notes = []
      if (mode === 'fast' && early > 0.4) notes.push(alert('info', h('strong', `Starts about ${early.toFixed(1)} s early. `), 'A fast cut can only begin at a keyframe. Choose Precise cut if the exact start matters.'))
      return {
        blob, name: suffixName(file.name, 'trimmed', outExt), inputSize: file.size, notes, compare: false,
        title: `Kept ${fmtTime(keep, 1)}`,
        summary: `${fmtTime(start, 1)} to ${fmtTime(end, 1)} of the original${mode === 'fast' ? ', copied without re-encoding' : ', cut precisely'}.`,
      }
    },
  })
}
