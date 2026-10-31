// Video to Android Motion Photo (experimental): a JPEG with a short moving clip inside, like phone cameras save.
import { createShell, step, note, h } from './_ui.js'
import { makeMotionPhoto } from './_motion.js'
import { VIDEO_ACCEPT } from './_core.js'
import { select, field, number, button, formatDuration } from '../../lib/ui.js'

export function mount(root, { signal }) {
  let get = null

  createShell(root, { signal }, {
    kind: 'video',
    require: 'video',
    accept: VIDEO_ACCEPT,
    dropIcon: 'image-play',
    dropLabel: 'Drop a video to make a Motion Photo',
    dropHint: 'Any short clip. Experimental: for Google Photos and Android galleries.',
    action: { label: 'Make Motion Photo', icon: 'image-play', busy: 'Making the photo' },

    options(media, shell) {
      const { info, el } = media
      const dur = info.duration || 0
      const timeIn = number(Math.min(1.5, dur / 2).toFixed(1), { min: 0, max: dur || undefined, step: 0.1, ariaLabel: 'Still frame time in seconds' })
      const clipSel = select([[2, '2 seconds'], [3, '3 seconds (like phone cameras)'], [4, '4 seconds'], [5, '5 seconds']], 3)
      const sizeSel = select([[1080, '1080p'], [720, '720p (smaller file)'], [0, 'Keep the original size']], 1080)
      const useFrame = button('Use the frame I am watching', { icon: 'crosshair', variant: 'secondary', size: 'sm', onClick: () => { if (el && Number.isFinite(el.currentTime)) timeIn.value = el.currentTime.toFixed(1) } })
      get = () => ({ time: timeIn.valueAsNumber, clip: +clipSel.value, cap: +sizeSel.value })
      shell.setInfo('JPEG with a moving clip inside', 'The still frame is the cover; the clip plays around it')
      return [
        step(1, 'Pick the still frame', [h('div', { class: 'row' }, field(`Still frame at (seconds, video is ${formatDuration(dur)})`, timeIn), useFrame), note('Pause the preview where you like and press the button, or type a time. This frame becomes the photo.')]),
        step(2, 'Clip and size', [h('div', { class: 'mc-grid' }, field('Moving part', clipSel), field('Resolution', sizeSel)), note('Experimental. This follows the published Motion Photo format used by Pixel and Samsung cameras, so Google Photos and many Android galleries show it as a Motion Photo. It has not been tried on every phone. iPhone Live Photos use a different format that cannot be made here.', 'warn')]),
      ]
    },

    async execute(media, hp) {
      const { file, info } = media
      const o = get()
      const r = await makeMotionPhoto({ file, info, time: o.time, clip: o.clip, cap: o.cap, run: (spec) => hp.ffmpeg(spec) })
      return {
        blob: r.blob, name: r.name, kind: 'image', compare: false,
        title: 'Motion Photo ready', summary: `A JPEG with a ${o.clip} second clip inside, centred on ${r.stillTime.toFixed(1)} s of your video. Open it in Google Photos or an Android gallery to see it move.`,
        stats: [{ label: 'Clip size', value: `${Math.round(r.videoBytes / 1024)} KB` }],
      }
    },
  })
}
