// Change video FPS: 60 to 30, 30 to 24, or any rate. Drops or repeats frames, or blends them.
import { createShell, step, tilePicker, note, h } from './_ui.js'
import { inputName } from './_media.js'
import { reencodePlan, mapAV, QUALITY_OPTIONS } from './_video.js'
import { number, field } from '../../lib/ui.js'
import { suffixName } from '../../lib/files.js'

const RATES = [[60, 'Ultra smooth, sports and games'], [50, 'Smooth, PAL regions'], [30, 'Standard for phones and web'], [25, 'PAL television'], [24, 'The cinema look'], [15, 'Lighter file'], [12, 'Choppy but tiny'], [10, 'Slideshow feel']]

export function mount(root, { signal }) {
  let get = null
  createShell(root, { signal }, {
    kind: 'video',
    require: 'video',
    dropIcon: 'gauge',
    dropLabel: 'Drop a video to change its frame rate',
    action: { label: 'Change frame rate', icon: 'gauge', busy: 'Changing frame rate' },
    options(media, shell) {
      const { info } = media
      const src = info.video.fps || 30
      const srcLabel = +src.toFixed(2)
      let rate = String((RATES.find(([r]) => r < src - 0.5) || [30])[0])
      let method = 'drop'
      let quality = 'balanced'
      const custom = number('', { min: 1, max: 120, step: 0.001, placeholder: 'e.g. 29.97', ariaLabel: 'Custom frames per second', onInput: () => refresh() })
      const customBox = h('div', { hidden: true }, field('Frames per second', custom))
      const picker = tilePicker({
        label: 'Target frame rate', value: rate, onChange: (v) => { rate = v; refresh() },
        options: [...RATES.map(([r, sub]) => ({ value: String(r), label: `${r} fps`, sub: Math.abs(r - src) < 0.5 ? `Same as the original` : sub, icon: 'gauge' })), { value: 'custom', label: 'Custom', sub: 'Type any rate', icon: 'sliders-horizontal' }],
      })
      const methodPicker = tilePicker({
        label: 'How frames are changed', value: method, compact: true, onChange: (v) => { method = v; refresh() },
        options: [{ value: 'drop', label: 'Drop or repeat', sub: 'Fast, exact timing' }, { value: 'blend', label: 'Blend frames', sub: 'Smoother, a bit slower' }],
      })
      const qualityPicker = tilePicker({ label: 'Quality', options: QUALITY_OPTIONS, value: quality, compact: true, onChange: (v) => { quality = v } })
      const explain = note('')

      const target = () => (rate === 'custom' ? custom.valueAsNumber : +rate)
      get = () => ({ fps: target(), method, quality })
      function refresh() {
        customBox.hidden = rate !== 'custom'
        const t = target()
        const ok = Number.isFinite(t) && t >= 1 && t <= 120
        shell.setEnabled(ok, 'Enter a frame rate between 1 and 120')
        if (!ok) { shell.setInfo('Pick a frame rate', ''); return }
        const k = t / src
        if (Math.abs(k - 1) < 0.01) { explain.textContent = 'This is already the frame rate of the video. Pick a different one to change it.'; explain.className = 'mc-note warn' }
        else if (k < 1) { explain.textContent = `Going from ${srcLabel} to ${+t.toFixed(3)} fps keeps ${Math.round(k * 100)}% of the frames, so the file gets smaller and motion looks a little less fluid.`; explain.className = 'mc-note' }
        else { explain.textContent = `Raising ${srcLabel} to ${+t.toFixed(3)} fps cannot create new detail. Frames are ${method === 'blend' ? 'blended' : 'repeated'}, so the file gets bigger without looking smoother.`; explain.className = 'mc-note warn' }
        shell.setInfo(`${srcLabel} to ${+t.toFixed(3)} fps`, info.duration ? `About ${Math.round(info.duration * t).toLocaleString()} frames` : 'Re-encoded')
      }
      refresh()
      return [
        step(1, 'Frame rate', [picker, customBox], `Original: ${srcLabel} fps`),
        step(2, 'Method', [methodPicker, explain]),
        step(3, 'Quality', qualityPicker),
      ]
    },
    async execute(media, hp) {
      const { file, info } = media
      const { fps, method, quality } = get()
      const f = +fps.toFixed(3)
      const plan = reencodePlan(file, info, { quality })
      const inName = inputName(file)
      const out = `out.${plan.ext}`
      const vf = method === 'blend' ? `framerate=fps=${f}` : `fps=${f}`
      const blob = await hp.ffmpeg({ inputs: [{ name: inName, data: file }], args: ['-i', inName, ...mapAV(info), '-vf', vf, ...plan.codec, out], output: out, label: 'Changing the frame rate' })
      return { blob, name: suffixName(file.name, `${f}fps`, plan.ext), inputSize: file.size, title: `Now ${f} fps`, summary: `The frame rate changed from ${+(info.video.fps || 0).toFixed(2)} to ${f} fps. The length and sound are unchanged.` }
    },
  })
}
