// Change video resolution: 1080p/720p/480p presets, social formats, or a custom size, with a live shape preview.
import { createShell, step, tilePicker, note, h } from './_ui.js'
import { inputName, capShortSide } from './_media.js'
import { reencodePlan, mapAV, shapePreview, QUALITY_OPTIONS } from './_video.js'
import { number, field } from '../../lib/ui.js'
import { suffixName } from '../../lib/files.js'

const STD = [[1080, 'Full HD'], [720, 'HD, small and sharp'], [480, 'Standard definition'], [360, 'Small and quick to share'], [240, 'Tiny']]
const SOCIAL = { reel: [1080, 1920, 'Vertical 9:16', '1080 x 1920 for Reels, Shorts, TikTok'], square: [1080, 1080, 'Square 1:1', '1080 x 1080 for feeds'], wide: [1920, 1080, 'Widescreen 16:9', '1920 x 1080 for YouTube'] }
const even = (n) => Math.max(2, Math.round(n / 2) * 2)

export function mount(root, { signal }) {
  let get = null
  createShell(root, { signal }, {
    kind: 'video',
    require: 'video',
    dropIcon: 'monitor',
    dropLabel: 'Drop a video to resize it',
    action: { label: 'Resize video', icon: 'scaling', busy: 'Resizing' },
    options(media, shell) {
      const { info } = media
      const sw = info.display?.width || info.video.width
      const sh = info.display?.height || info.video.height
      const short = Math.min(sw, sh)
      const firstStd = STD.find(([c]) => c < short)
      let preset = firstStd ? String(firstStd[0]) : 'custom'
      let fit = 'fit'
      let quality = 'balanced'
      const wIn = number(sw, { min: 16, max: 7680, step: 1, ariaLabel: 'Width in pixels', onInput: () => refresh() })
      const hIn = number('', { min: 16, max: 7680, step: 1, placeholder: 'auto', ariaLabel: 'Height in pixels (leave empty to keep the shape)', onInput: () => refresh() })
      const custom = h('div', { class: 'stack', hidden: true }, h('div', { class: 'mc-dim-row' }, field('Width (px)', wIn), h('span', 'x'), field('Height (px)', hIn)), note('Leave the height empty to keep the shape of the video. Fill both to force a size.'))
      const options = [
        ...STD.map(([c, sub]) => ({ value: String(c), label: `${c}p`, sub: c < short ? sub : 'Not smaller than the original', icon: 'monitor', disabled: c >= short })),
        ...Object.entries(SOCIAL).map(([k, [, , label, sub]]) => ({ value: k, label, sub, icon: k === 'reel' ? 'smartphone' : k === 'square' ? 'square' : 'tv' })),
        { value: 'custom', label: 'Custom size', sub: 'Type your own width and height', icon: 'ruler' },
      ]
      const picker = tilePicker({ label: 'Size', options, value: preset, onChange: (v) => { preset = v; refresh() } })
      const fitPicker = tilePicker({
        label: 'If the shape is different', value: fit, compact: true, onChange: (v) => { fit = v; refresh() },
        options: [{ value: 'fit', label: 'Fit', sub: 'Add black bars' }, { value: 'fill', label: 'Fill', sub: 'Crop the edges' }, { value: 'stretch', label: 'Stretch', sub: 'Distort to fit' }],
      })
      const fitStep = step(2, 'If the shape is different', [fitPicker, note('The new size has a different shape than the video. Choose how to deal with it.')])
      const qualityPicker = tilePicker({ label: 'Quality', options: QUALITY_OPTIONS, value: quality, compact: true, onChange: (v) => { quality = v } })
      const diagram = h('div', { class: 'mc-preview-pane' })

      function target() {
        if (SOCIAL[preset]) { const [w, hh] = SOCIAL[preset]; return { w, h: hh, forced: true } }
        if (preset === 'custom') {
          const w = Math.round(wIn.valueAsNumber)
          const hh = Math.round(hIn.valueAsNumber)
          if (!Number.isFinite(w) || w < 16) return null
          if (Number.isFinite(hh) && hh >= 16) return { w: even(w), h: even(hh), forced: true }
          return { w: even(w), h: even((w * sh) / sw), forced: false }
        }
        const d = capShortSide(sw, sh, +preset)
        return { w: d.w, h: d.h, forced: false }
      }
      get = () => ({ t: target(), fit, quality })
      function refresh() {
        custom.hidden = preset !== 'custom'
        const t = target()
        const differs = !!t?.forced && Math.abs(t.w / t.h - sw / sh) > 0.01
        fitStep.hidden = !differs
        shell.setEnabled(!!t, 'Enter a width of at least 16 pixels')
        if (!t) { shell.setInfo('Pick a size', ''); return }
        const k = (t.w * t.h) / (sw * sh)
        diagram.replaceChildren(
          h('div', { class: 'stack tight' }, h('b', 'New size'), h('div', { class: 'result-big' }, `${t.w} x ${t.h}`),
            h('div', { class: ['mc-note', k > 1.05 && 'warn'] }, `From ${sw} x ${sh}. ${k < 0.99 ? `${Math.round((1 - k) * 100)}% fewer pixels, so the file will usually be smaller.` : k > 1.05 ? 'Larger than the original. This cannot add detail, and the file will be bigger.' : 'About the same number of pixels.'}`)),
          shapePreview(sw, sh, t.w, t.h, differs ? fit : 'stretch'))
        shell.setInfo(`${t.w} x ${t.h}`, k < 0.99 ? `About ${Math.round(k * 100)}% of the pixels` : 'Re-encoded at the new size')
      }
      refresh()
      return [
        step(1, 'New size', [picker, custom]),
        fitStep,
        step(3, 'Preview', diagram),
        step(4, 'Quality', qualityPicker),
      ]
    },
    async execute(media, hp) {
      const { file, info } = media
      const { t, fit, quality } = get()
      const sw = info.display?.width || info.video.width
      const sh = info.display?.height || info.video.height
      const differs = t.forced && Math.abs(t.w / t.h - sw / sh) > 0.01
      let vf = `scale=${t.w}:${t.h}`
      if (differs && fit === 'fit') vf = `scale=${t.w}:${t.h}:force_original_aspect_ratio=decrease,pad=${t.w}:${t.h}:(ow-iw)/2:(oh-ih)/2:color=black`
      else if (differs && fit === 'fill') vf = `scale=${t.w}:${t.h}:force_original_aspect_ratio=increase,crop=${t.w}:${t.h}`
      vf += ',setsar=1'
      const plan = reencodePlan(file, info, { quality })
      const inName = inputName(file)
      const out = `out.${plan.ext}`
      const blob = await hp.ffmpeg({ inputs: [{ name: inName, data: file }], args: ['-i', inName, ...mapAV(info), '-vf', vf, ...plan.codec, out], output: out, label: 'Resizing the video' })
      return { blob, name: suffixName(file.name, `${t.w}x${t.h}`, plan.ext), inputSize: file.size, title: `Resized to ${t.w} x ${t.h}`, summary: `The video was re-encoded at ${t.w} x ${t.h}.` }
    },
  })
}
