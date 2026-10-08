// Video converter (also serves video-to-mp4 via params.to). MP4, WebM, MOV, MKV and AVI, copying streams when they already fit.
import { createShell, step, tilePicker, note, fixedOutput, h } from './_ui.js'
import { VIDEO_FORMATS, X264_PRESETS, QUALITY_CRF, encodeArgs, canRemux, capShortSide, inputName } from './_media.js'
import { select, field, toggle, isAbort } from '../../lib/ui.js'
import { withExt, suffixName, ext } from '../../lib/files.js'

const QUALITY = [
  { value: 'high', label: 'High', sub: 'Best picture, bigger file', icon: 'sparkles' },
  { value: 'balanced', label: 'Balanced', sub: 'Looks great, sensible size', icon: 'scale' },
  { value: 'small', label: 'Small', sub: 'Smaller file, softer look', icon: 'minimize-2' },
  { value: 'tiny', label: 'Tiny', sub: 'Smallest, visibly compressed', icon: 'feather' },
]
const SPEEDS = [['fast', 'Fastest (larger file)'], ['balanced', 'Balanced'], ['small', 'Slower (smaller file)']]
const CAPS = [[2160, '4K (2160p)'], [1440, '1440p'], [1080, '1080p'], [720, '720p'], [480, '480p'], [360, '360p']]

export function mount(root, { params, signal }) {
  const fixed = params?.to
  let get = null // set once a file is loaded: () => current settings

  createShell(root, { signal }, {
    kind: 'video',
    require: 'video',
    dropIcon: fixed === 'mp4' ? 'file-video' : 'repeat-2',
    dropLabel: fixed === 'mp4' ? 'Drop any video to make an MP4' : undefined,
    action: { label: fixed ? `Convert to ${VIDEO_FORMATS[fixed].label}` : 'Convert video', icon: 'repeat-2', busy: 'Converting' },

    options(media, shell) {
      const { info, file } = media
      let fmt = fixed || (['mp4', 'm4v'].includes(ext(file.name)) ? 'webm' : 'mp4')
      let quality = 'balanced'
      const short = Math.min(info.video?.width || 0, info.video?.height || 0)

      const formatPicker = fixed ? null : tilePicker({
        label: 'Output format', value: fmt, onChange: (v) => { fmt = v; refresh() },
        options: Object.values(VIDEO_FORMATS).map((f) => ({ value: f.id, label: f.label, sub: f.note, icon: f.icon })),
      })
      const qualityPicker = tilePicker({ label: 'Quality', options: QUALITY, value: quality, onChange: (v) => { quality = v; refresh() } })
      const capSel = select([[0, `Keep original size${info.display ? ` (${info.display.width} x ${info.display.height})` : ''}`], ...CAPS.filter(([c]) => c < short).map(([c, l]) => [c, l])], 0, () => refresh())
      const speedSel = select(SPEEDS, 'balanced', () => refresh())
      const vpSel = select([['vp8', 'VP8 (faster, bigger files)'], ['vp9', 'VP9 (smaller, much slower)']], 'vp8', () => refresh())
      const vpField = field('WebM video codec', vpSel)
      const capField = field('Resolution', capSel)
      const speedField = field('Encoding speed', speedSel)
      const smart = toggle('Copy without re-encoding when the video already fits', true, () => refresh())
      const planNote = note('')
      const qualityStep = step(2, 'Quality', qualityPicker)

      const plan = () => {
        const cap = +capSel.value || 0
        return { fmt, cap, quality, speed: speedSel.value, vp: vpSel.value, remux: smart.input.checked && !cap && canRemux(info, fmt) }
      }
      get = plan

      function refresh() {
        const f = VIDEO_FORMATS[fmt]
        const { remux } = plan()
        vpField.hidden = fmt !== 'webm' || remux
        qualityStep.hidden = remux
        speedField.hidden = remux || fmt === 'webm' || fmt === 'avi'
        planNote.className = 'mc-note'
        if (remux) {
          shell.setInfo('Instant, no quality loss', `The streams already fit ${f.label}, so they are copied as they are.`)
          planNote.textContent = `Good news: this video is ${info.video.codec.toUpperCase()}${info.audio ? ' + ' + info.audio.codec.toUpperCase() : ''}, which ${f.label} accepts as it is. Only the container changes, so it takes a moment and looks identical.`
        } else if (fmt === 'webm') {
          shell.setInfo(`Re-encode to ${f.label}`, 'WebM is slow to encode in a browser.')
          planNote.textContent = 'WebM needs a full re-encode, which is slow in a browser. VP8 is quicker; VP9 gives smaller files but can take several times longer than the clip itself. For long videos, MP4 is much faster.'
          planNote.className = 'mc-note warn'
        } else {
          shell.setInfo(`Re-encode to ${f.label}`, `${f.sub}. Longer videos take longer.`)
          planNote.textContent = `The video is re-encoded to ${f.sub}. A 1 minute 1080p clip takes a few minutes in the browser; smaller resolutions are quicker.`
          if (fmt === 'avi') planNote.textContent += ' AVI is an old format: files are larger and some players ignore parts of it.'
        }
      }
      refresh()
      return [
        formatPicker
          ? step(1, 'Convert to', formatPicker)
          : step(1, 'Output', fixedOutput('smartphone', 'MP4', 'H.264 video and AAC audio. Plays on iPhone, Android, Windows, Mac, TVs and WhatsApp.')),
        qualityStep,
        step(3, 'Fine tuning', [h('div', { class: 'mc-grid' }, capField, speedField, vpField), h('div', { class: 'mc-switches' }, smart), planNote]),
      ]
    },

    async execute(media, hp) {
      const { file, info } = media
      const o = get()
      const f = VIDEO_FORMATS[o.fmt]
      const inName = inputName(file)
      const out = `out.${f.ext}`
      const inputs = [{ name: inName, data: file }]
      const maps = ['-map', '0:v:0', ...(info.hasAudio ? ['-map', o.fmt === 'mkv' ? '0:a' : '0:a:0'] : [])]
      const flags = ['mp4', 'mov'].includes(o.fmt) ? ['-movflags', '+faststart'] : []
      const name = ext(file.name) === f.ext ? suffixName(file.name, 'converted', f.ext) : withExt(file.name, f.ext)
      let blob = null
      let mode = 'encode'

      if (o.remux) {
        try {
          blob = await hp.ffmpeg({ inputs, args: ['-i', inName, ...maps, '-c', 'copy', ...flags, out], output: out, label: 'Copying streams' })
          mode = 'copy'
        } catch (e) {
          if (isAbort(e)) throw e
          blob = null // the container refused these streams: fall through to a real re-encode
        }
      }
      if (!blob) {
        const dims = o.cap && info.display ? capShortSide(info.display.width, info.display.height, o.cap) : null
        const vf = dims?.w ? ['-vf', `scale=${dims.w}:${dims.h}`] : []
        const audio = !info.hasAudio ? 'none' : (info.audio && ({ mp4: ['aac', 'mp3'], mov: ['aac', 'mp3'], mkv: ['aac', 'mp3', 'opus', 'vorbis'], webm: ['opus', 'vorbis'], avi: ['mp3'] }[o.fmt] || []).includes(info.audio.codec) ? 'copy' : 'encode')
        const enc = encodeArgs(o.fmt, { crf: QUALITY_CRF[o.quality], preset: X264_PRESETS[o.speed], vp: o.vp, audio })
        blob = await hp.ffmpeg({ inputs, args: ['-i', inName, ...maps, ...vf, ...enc, out], output: out, label: `Encoding ${f.label}` })
      }
      return {
        blob, name, inputSize: file.size,
        title: mode === 'copy' ? 'Converted instantly' : `Converted to ${f.label}`,
        summary: mode === 'copy' ? 'The streams were copied as they are, so the picture and sound are untouched.' : `Re-encoded to ${f.sub}.`,
      }
    },
  })
}
