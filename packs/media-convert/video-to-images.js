// Video to images: one still at a chosen moment, a frame every N seconds, or an even set of frames. Many frames come as a ZIP.
import { createShell, step, tilePicker, note, alert, button, h } from './_ui.js'
import { inputName, fmtTime } from './_media.js'
import { timeInput } from './_timeline.js'
import { number, select, field } from '../../lib/ui.js'
import { baseName } from '../../lib/files.js'

const MAX_FRAMES = 120
const FORMATS = {
  jpg: { label: 'JPG', sub: 'Small, photos', ext: 'jpg' },
  png: { label: 'PNG', sub: 'Lossless, larger', ext: 'png' },
  webp: { label: 'WebP', sub: 'Small and sharp', ext: 'webp' },
}
const QUALITY = { jpg: { high: ['-q:v', '2'], balanced: ['-q:v', '5'], small: ['-q:v', '10'] }, webp: { high: ['-quality', '92'], balanced: ['-quality', '80'], small: ['-quality', '60'] }, png: { high: [], balanced: [], small: [] } }

/** Which moments (seconds) to grab. Pure, so it can be tested. */
export function frameTimes({ mode, duration, at = 0, every = 5, count = 10 }) {
  const last = Math.max(0, duration - 0.15)
  let t = []
  if (mode === 'now') t = [at]
  else if (mode === 'interval') for (let s = 0; s < duration && t.length < MAX_FRAMES + 1; s += Math.max(0.1, every)) t.push(s)
  else for (let i = 0; i < count; i++) t.push(((i + 0.5) * duration) / count)
  return t.map((x) => +Math.min(Math.max(0, x), last).toFixed(3))
}

export function mount(root, { signal }) {
  let get = null
  createShell(root, { signal }, {
    kind: 'video',
    require: 'video',
    dropIcon: 'images',
    dropLabel: 'Drop a video to grab pictures from it',
    action: { label: 'Save images', icon: 'images', busy: 'Grabbing frames' },
    trust: [['shield-check', 'Stays on your device', 'Nothing is uploaded. The pictures are made inside this tab.'], ['image', 'Full quality stills', 'Frames are taken straight from the video, at its full size if you like.'], ['archive', 'ZIP for many', 'Several frames are bundled into one ZIP download.']],

    options(media, shell) {
      const { info } = media
      const dur = info.duration || 0
      const srcW = info.display?.width || info.video.width
      let mode = 'now'
      let fmt = 'jpg'
      let quality = 'high'
      const at = timeInput('Time', { value: 0, onCommit: (t) => { at.set(Math.min(dur, Math.max(0, t))); refresh() } })
      const here = button('Use the current position', { icon: 'crosshair', variant: 'secondary', size: 'sm', onClick: () => { if (media.el) { at.set(Math.min(dur, media.el.currentTime)); refresh() } } })
      const every = number(Math.max(1, Math.round(dur / 10)), { min: 0.1, max: 3600, step: 0.5, ariaLabel: 'Seconds between frames', onInput: () => refresh() })
      const count = number(10, { min: 1, max: MAX_FRAMES, step: 1, ariaLabel: 'Number of frames', onInput: () => refresh() })
      const nowBox = h('div', { class: 'stack' }, h('div', { class: 'mc-times' }, at.el, h('div', { class: 'stack', style: 'align-self:end' }, media.canPlay ? here : null)), note('Pause the video above on the exact frame you want and press "Use the current position", or type a time.'))
      const intervalBox = h('div', { hidden: true }, field('Seconds between frames', every))
      const countBox = h('div', { hidden: true }, field('How many frames', count, 'They are spread evenly across the whole video.'))
      const modePicker = tilePicker({
        label: 'What to grab', value: mode, onChange: (v) => { mode = v; refresh() },
        options: [
          { value: 'now', label: 'One still', sub: 'At the moment you choose', icon: 'image' },
          { value: 'interval', label: 'Every few seconds', sub: 'A frame at a steady pace', icon: 'timer' },
          { value: 'count', label: 'A set number', sub: 'Evenly spread across the video', icon: 'layout-grid' },
        ],
      })
      const fmtPicker = tilePicker({ label: 'Format', compact: true, value: fmt, onChange: (v) => { fmt = v; refresh() }, options: Object.entries(FORMATS).map(([value, f]) => ({ value, label: f.label, sub: f.sub })) })
      const widths = [[0, `Original (${srcW} px wide)`], ...[1920, 1280, 720, 480].filter((w) => w < srcW).map((w) => [w, `${w} px wide`])]
      const wSel = select(widths, 0, () => refresh())
      const qSel = select([['high', 'High'], ['balanced', 'Balanced'], ['small', 'Smaller files']], 'high', () => { quality = qSel.value })
      const qField = field('Quality', qSel)
      const explain = h('div', { class: 'stack tight' })

      get = () => ({ mode, fmt, quality: qSel.value, width: +wSel.value, times: frameTimes({ mode, duration: dur, at: at.get(), every: every.valueAsNumber || 5, count: Math.round(count.valueAsNumber) || 1 }) })
      function refresh() {
        nowBox.hidden = mode !== 'now'
        intervalBox.hidden = mode !== 'interval'
        countBox.hidden = mode !== 'count'
        qField.hidden = fmt === 'png'
        const o = get()
        const n = o.times.length
        const nodes = []
        if (n > MAX_FRAMES) nodes.push(alert('warn', `That would be ${n} frames. The limit is ${MAX_FRAMES}, so only the first ${MAX_FRAMES} are saved. Use a longer gap.`))
        else if (n > 40) nodes.push(note(`${n} frames will be saved as a ZIP.`))
        explain.replaceChildren(...nodes)
        shell.setEnabled(n > 0 && (mode !== 'now' || at.get() <= dur), 'Pick a time inside the video')
        shell.setInfo(n === 1 ? 'One image' : `${Math.min(n, MAX_FRAMES)} images`, `${o.fmt.toUpperCase()}${o.width ? `, ${o.width} px wide` : ', full size'}${n > 1 ? ', in a ZIP' : ''}`)
      }
      refresh()
      return [
        step(1, 'What to grab', [modePicker, nowBox, intervalBox, countBox, explain]),
        step(2, 'Picture format', [fmtPicker, h('div', { class: 'mc-grid' }, field('Size', wSel), qField)]),
      ]
    },

    async execute(media, hp) {
      const { file, info } = media
      const o = get()
      const times = o.times.slice(0, MAX_FRAMES)
      const f = FORMATS[o.fmt]
      const inName = inputName(file)
      const names = times.map((_, i) => `f${String(i + 1).padStart(3, '0')}.${f.ext}`)
      const vf = o.width ? ['-vf', `scale=${o.width}:-2`] : []
      const codec = o.fmt === 'png' ? [] : o.fmt === 'webp' ? ['-c:v', 'libwebp'] : ['-c:v', 'mjpeg', '-pix_fmt', 'yuvj420p']
      const args = [
        ...times.flatMap((t) => ['-ss', t.toFixed(3), '-i', inName]),
        ...times.flatMap((_, i) => ['-map', `${i}:v:0`, '-frames:v', '1', ...vf, ...codec, ...QUALITY[o.fmt][o.quality], names[i]]),
      ]
      const blobs = await hp.ffmpeg({ inputs: [{ name: inName, data: file }], args, output: names, label: times.length > 1 ? `Grabbing ${times.length} frames` : 'Grabbing the frame' })
      const base = baseName(file.name)
      if (times.length === 1) {
        return { blob: blobs[0], kind: 'image', name: `${base}-${times[0].toFixed(1)}s.${f.ext}`, compare: false, duration: null, title: 'Frame saved', summary: `The picture at ${fmtTime(times[0], 1)} as a ${f.label}.` }
      }
      return {
        items: blobs.map((blob, i) => ({ blob, kind: 'image', name: `${base}-${String(i + 1).padStart(3, '0')}.${f.ext}`, note: `at ${fmtTime(times[i], 1)}` })),
        zipName: `${base}-frames.zip`, title: `${blobs.length} frames saved`, summary: `${blobs.length} ${f.label} pictures, ready as a ZIP or one by one.`,
      }
    },
  })
}
