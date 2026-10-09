// Rotate & flip video: fix sideways phone videos. Live preview of the result; exact (re-encode) or quick (rotation flag only).
import { createShell, step, tilePicker, note, h } from './_ui.js'
import { inputName } from './_media.js'
import { reencodePlan, mapAV, QUALITY_OPTIONS } from './_video.js'
import { toggle } from '../../lib/ui.js'
import { suffixName, ext } from '../../lib/files.js'

const ANGLES = [
  { value: '0', label: 'No rotation', sub: 'Keep it as it is', icon: 'circle-dot' },
  { value: '90', label: 'Right 90 degrees', sub: 'Clockwise', icon: 'rotate-cw' },
  { value: '270', label: 'Left 90 degrees', sub: 'Counterclockwise', icon: 'rotate-ccw' },
  { value: '180', label: 'Upside down', sub: '180 degrees', icon: 'refresh-cw' },
]
const TRANSPOSE = { 0: [], 90: ['transpose=1'], 270: ['transpose=2'], 180: ['transpose=1', 'transpose=1'] }

/** ffmpeg video filters for a clockwise rotation (0, 90, 180, 270) followed by optional flips. */
export const rotateFilters = (angle, flipH, flipV) => [...TRANSPOSE[angle], ...(flipH ? ['hflip'] : []), ...(flipV ? ['vflip'] : [])]

export function mount(root, { signal }) {
  let get = null
  createShell(root, { signal }, {
    kind: 'video',
    require: 'video',
    dropIcon: 'rotate-cw',
    dropLabel: 'Drop a sideways video to fix it',
    action: { label: 'Rotate video', icon: 'rotate-cw', busy: 'Rotating' },
    options(media, shell) {
      const { info, file } = media
      let angle = '0'
      let method = 'exact'
      let quality = 'balanced'
      const flipH = toggle('Flip horizontally (mirror)', false, () => refresh())
      const flipV = toggle('Flip vertically (upside down mirror)', false, () => refresh())
      const anglePicker = tilePicker({ label: 'Rotate', options: ANGLES, value: angle, onChange: (v) => { angle = v; refresh() } })
      const methodPicker = tilePicker({
        label: 'Method', value: method, compact: true, onChange: (v) => { method = v; refresh() },
        options: [{ value: 'exact', label: 'Exact', sub: 'Re-encodes. Works everywhere' }, { value: 'quick', label: 'Quick', sub: 'Instant. Sets the rotation flag' }],
      })
      const qualityPicker = tilePicker({ label: 'Quality', options: QUALITY_OPTIONS, value: quality, compact: true, onChange: (v) => { quality = v } })
      const methodStep = step(3, 'How to apply it', [methodPicker, note('')])
      const methodNote = methodStep.querySelector('.mc-note')
      const qualityStep = step(4, 'Quality', qualityPicker)
      const canvas = h('canvas', { 'aria-label': 'Preview of the rotated video', style: 'max-width:340px;margin:0 auto' })
      const previewNote = note('')
      const quickOk = () => ['mp4', 'mov', 'm4v'].includes(ext(file.name)) && !info.rotation

      function draw() {
        const v = media.el
        if (!v || !media.canPlay || !v.videoWidth) return
        const rot = +angle
        const swap = rot % 180 !== 0
        const cw = swap ? v.videoHeight : v.videoWidth
        const ch = swap ? v.videoWidth : v.videoHeight
        const k = Math.min(1, 340 / cw)
        canvas.width = Math.max(2, Math.round(cw * k))
        canvas.height = Math.max(2, Math.round(ch * k))
        const ctx = canvas.getContext('2d')
        ctx.save()
        ctx.translate(canvas.width / 2, canvas.height / 2)
        ctx.scale(flipH.input.checked ? -1 : 1, flipV.input.checked ? -1 : 1)
        ctx.rotate((rot * Math.PI) / 180)
        try { ctx.drawImage(v, (-v.videoWidth * k) / 2, (-v.videoHeight * k) / 2, v.videoWidth * k, v.videoHeight * k) } catch { /* frame not ready */ }
        ctx.restore()
      }
      let raf = 0
      const loop = () => { draw(); raf = media.el && !media.el.paused ? requestAnimationFrame(loop) : 0 }
      const kick = () => { cancelAnimationFrame(raf); draw(); if (media.el && !media.el.paused) raf = requestAnimationFrame(loop) }
      if (media.el) for (const ev of ['loadeddata', 'seeked', 'play', 'pause', 'timeupdate']) media.el.addEventListener(ev, kick)

      get = () => ({ angle: +angle, flipH: flipH.input.checked, flipV: flipV.input.checked, method, quality })
      function refresh() {
        const flips = flipH.input.checked || flipV.input.checked
        const none = angle === '0' && !flips
        const canQuick = quickOk() && !flips && angle !== '0'
        methodStep.hidden = !canQuick
        if (!canQuick) method = 'exact'
        methodPicker.set(method)
        qualityStep.hidden = method === 'quick' && canQuick
        shell.setEnabled(!none, 'Pick a rotation or a flip first')
        const swap = angle === '90' || angle === '270'
        const w = info.display?.width || info.video.width
        const hh = info.display?.height || info.video.height
        shell.setInfo(none ? 'Pick a rotation' : method === 'quick' ? 'Instant, no re-encoding' : 'Re-encoded', none ? 'Choose how the video should turn' : `${swap ? hh : w} x ${swap ? w : hh}${method === 'quick' ? ', rotation flag only' : ''}`)
        methodNote.textContent = method === 'quick'
          ? 'Instant and lossless: only the rotation flag in the file changes. Phones, browsers and VLC respect it, but some editors and older players ignore it.'
          : 'Re-encodes the picture so it is physically rotated. Works in every player and editor.'
        previewNote.textContent = media.canPlay ? 'This is how the result will look. Play or scrub the video above to check other moments.' : 'Your browser cannot preview this format, but the rotation will still be applied.'
        kick()
      }
      refresh()
      return [
        step(1, 'Rotate', anglePicker),
        step(2, 'Flip', h('div', { class: 'mc-switches' }, flipH, flipV)),
        methodStep,
        qualityStep,
        step(5, 'Preview', [media.canPlay ? h('div', { class: 'mc-orient' }, canvas) : null, previewNote]),
      ]
    },
    async execute(media, hp) {
      const { file, info } = media
      const o = get()
      const inName = inputName(file)
      const inputs = [{ name: inName, data: file }]
      const tag = o.angle ? `rot${o.angle}` : o.flipH && o.flipV ? 'flipped' : o.flipH ? 'mirrored' : 'flipped-v'
      if (o.method === 'quick') {
        // ffmpeg's rotate tag is counterclockwise; our angle is clockwise
        const flag = (360 - o.angle) % 360
        const out = 'out.mp4'
        const blob = await hp.ffmpeg({ inputs, args: ['-i', inName, '-map', '0:v:0', ...(info.hasAudio ? ['-map', '0:a:0'] : []), '-c', 'copy', '-metadata:s:v:0', `rotate=${flag}`, '-movflags', '+faststart', out], output: out, label: 'Setting the rotation' })
        return { blob, name: suffixName(file.name, tag, ext(file.name) === 'mov' ? 'mov' : 'mp4'), inputSize: file.size, title: 'Rotated instantly', summary: 'Only the rotation flag changed, so the picture and sound are untouched.' }
      }
      const plan = reencodePlan(file, info, { quality: o.quality })
      const vf = rotateFilters(o.angle, o.flipH, o.flipV).join(',')
      const out = `out.${plan.ext}`
      const blob = await hp.ffmpeg({ inputs, args: ['-i', inName, ...mapAV(info), '-vf', vf, ...plan.codec, out], output: out, label: 'Rotating the video' })
      return { blob, name: suffixName(file.name, tag, plan.ext), inputSize: file.size, title: 'Video rotated', summary: 'The picture was re-encoded in the new orientation, so it looks right in every player.' }
    },
  })
}
