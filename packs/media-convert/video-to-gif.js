// Video to GIF: pick a range on the timeline, choose size, FPS and quality. Uses a generated palette for clean colors.
import { createShell, step, tilePicker, note, alert, h } from './_ui.js'
import { inputName, fmtTime } from './_media.js'
import { createTrimmer } from './_timeline.js'
import { select, field, toggle } from '../../lib/ui.js'
import { baseName } from '../../lib/files.js'

const WIDTHS = [[240, 'Small, 240 px'], [320, '320 px'], [480, 'Medium, 480 px'], [640, '640 px'], [800, 'Large, 800 px']]
const QUALITY = [
  { value: 'small', label: 'Small file', sub: '64 colors, light dithering', icon: 'feather', colors: 64, dither: 'bayer:bayer_scale=5' },
  { value: 'balanced', label: 'Balanced', sub: '128 colors, clean gradients', icon: 'scale', colors: 128, dither: 'bayer:bayer_scale=4' },
  { value: 'best', label: 'Best looking', sub: '256 colors, smooth shading', icon: 'sparkles', colors: 256, dither: 'sierra2_4a' },
]

/** ffmpeg filter graph for a GIF with a generated palette. */
export const gifFilter = ({ fps, width, colors, dither }) =>
  `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=${colors}:stats_mode=diff[p];[s1][p]paletteuse=dither=${dither}:diff_mode=rectangle`

export function mount(root, { signal }) {
  let trimmer = null
  let update = () => {}
  let get = null

  createShell(root, { signal }, {
    kind: 'video',
    require: 'video',
    dropIcon: 'film',
    dropLabel: 'Drop a video to turn a clip into a GIF',
    action: { label: 'Make GIF', icon: 'film', busy: 'Making the GIF' },
    trust: [['shield-check', 'Stays on your device', 'Nothing is uploaded. The GIF is made inside this tab.'], ['scissors', 'Pick the moment', 'Drag the handles to choose exactly which seconds become the GIF.'], ['palette', 'Clean colors', 'A custom palette is generated for your clip, so it looks sharper than a quick convert.']],

    stageExtra(media, shell) {
      const dur = media.info.duration || media.el?.duration || 0
      if (!dur) return h('div', { class: 'mc-note', style: 'padding:10px' }, 'The length of this video could not be read, so the timeline is unavailable.')
      trimmer = createTrimmer({ media, duration: dur, start: 0, end: Math.min(dur, 5), minLen: 0.3, maxLen: 60, film: true, onChange: () => update() })
      shell.onDispose(trimmer.destroy)
      return trimmer.el
    },

    options(media, shell) {
      const { info } = media
      const srcW = info.display?.width || info.video.width
      const srcFps = info.video.fps || 30
      let quality = 'balanced'
      const widths = WIDTHS.filter(([w]) => w <= srcW)
      if (!widths.length || widths.at(-1)[0] < srcW) widths.push([srcW, `Original, ${srcW} px`])
      const wSel = select(widths, widths.find(([w]) => w >= 480)?.[0] ?? widths.at(-1)[0], () => update())
      const fpsOpts = [[5, '5 fps (tiny)'], [8, '8 fps'], [10, '10 fps'], [12, '12 fps (recommended)'], [15, '15 fps'], [20, '20 fps'], [25, '25 fps'], [30, '30 fps (smooth, large)']].filter(([f]) => f <= Math.max(12, Math.ceil(srcFps)))
      const fSel = select(fpsOpts, 12, () => update())
      const loop = toggle('Loop forever', true, () => update())
      const picker = tilePicker({ label: 'Quality', options: QUALITY, value: quality, onChange: (v) => { quality = v; update() } })
      const explain = h('div', { class: 'stack tight' })

      get = () => {
        const q = QUALITY.find((x) => x.value === quality)
        return { width: +wSel.value, fps: +fSel.value, colors: q.colors, dither: q.dither, loop: loop.input.checked }
      }
      update = () => {
        if (!trimmer) return
        const { start, end } = trimmer.getRange()
        const o = get()
        const len = end - start
        const frames = Math.round(len * o.fps)
        const hh = Math.round((o.width * (info.display?.height || info.video.height)) / srcW)
        const nodes = []
        if (len > 15 || frames > 250) nodes.push(alert('warn', `${frames} frames at ${o.width} px will make a big GIF (often 10 MB or more). Shorten the clip, lower the FPS, or choose a smaller size to keep it light.`))
        else nodes.push(note(`${frames} frames, ${o.width} x ${hh} px. GIFs are large for what they show: a few seconds at this size is typically 1 to 5 MB.`))
        explain.replaceChildren(...nodes)
        shell.setEnabled(len >= 0.3, 'Pick at least 0.3 seconds')
        shell.setInfo(`${fmtTime(len, 1)} clip, ${frames} frames`, `${o.width} x ${hh} px at ${o.fps} fps`)
      }
      update()
      return [
        step(1, 'Size and speed', [h('div', { class: 'mc-grid' }, field('Width', wSel), field('Frames per second', fSel)), h('div', { class: 'mc-switches' }, loop)]),
        step(2, 'Quality', [picker, explain]),
      ]
    },

    async execute(media, hp) {
      const { file } = media
      const o = get()
      const { start, end } = trimmer.getRange()
      const len = +(end - start).toFixed(3)
      const inName = inputName(file)
      const blob = await hp.ffmpeg({
        inputs: [{ name: inName, data: file }],
        args: ['-ss', start.toFixed(3), '-t', len.toFixed(3), '-i', inName, '-an', '-vf', gifFilter(o), '-loop', o.loop ? '0' : '-1', 'out.gif'],
        output: 'out.gif', label: 'Building the GIF',
      })
      return {
        blob, kind: 'image', name: `${baseName(file.name)}.gif`, inputSize: file.size, compare: false,
        title: 'Your GIF is ready',
        summary: `${fmtTime(len, 1)} from ${fmtTime(start, 1)}, ${o.width} px wide at ${o.fps} fps.${blob.size > 15 * 1024 * 1024 ? ' It is large; shorten it or lower the size for sharing.' : ''}`,
        duration: len, stats: [{ label: 'Frames', value: String(Math.round(len * o.fps)) }],
      }
    },
  })
}
