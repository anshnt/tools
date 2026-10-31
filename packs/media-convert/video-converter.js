// Video converter (also video-to-mp4, mov-to-mp4, mkv-to-mp4, video-to-720p, video-to-apng ... via params).
// Reads MP4, MOV, MKV, WebM, AVI, WMV, FLV, MPEG, TS, 3GP and more. Writes MP4 (H.264), WebM (VP8), MOV, MKV, AVI, GIF, APNG, MP3 and M4A.
// Streams are copied without re-encoding whenever the target container takes them. The jobs live in _core.js (shared with the File Converter hub).
import { createShell, step, tilePicker, pills, note, fixedOutput, h } from './_ui.js'
import { VIDEO_TARGETS } from './_media.js'
import { videoPlan, convertVideo, VIDEO_ACCEPT } from './_core.js'
import { select, field, toggle } from '../../lib/ui.js'

const QUALITY = [
  { value: 'high', label: 'High', sub: 'Best picture, bigger file', icon: 'sparkles' },
  { value: 'balanced', label: 'Balanced', sub: 'Looks great, sensible size', icon: 'scale' },
  { value: 'small', label: 'Small', sub: 'Smaller file, softer look', icon: 'minimize-2' },
  { value: 'tiny', label: 'Tiny', sub: 'Smallest, visibly compressed', icon: 'feather' },
]
const SPEEDS = [['fast', 'Fastest (larger file)'], ['balanced', 'Balanced'], ['small', 'Slower (smaller file)']]
const SIDES = [[2160, '4K (2160p)'], [1440, '1440p'], [1080, '1080p'], [720, '720p (HD)'], [480, '480p'], [360, '360p']]
const VIDEO_FPS = [[0, 'Keep the original'], [60, '60 fps'], [30, '30 fps'], [25, '25 fps'], [24, '24 fps'], [15, '15 fps']]
const ANIM_FPS = [[24, '24 fps (smooth, big)'], [15, '15 fps'], [12, '12 fps (recommended)'], [10, '10 fps'], [8, '8 fps (small)']]
const ANIM_SIDES = [[720, '720 px (large)'], [640, '640 px'], [480, '480 px (recommended)'], [360, '360 px'], [240, '240 px (small)']]
const ABITRATES = [[96, '96 kbps'], [128, '128 kbps'], [160, '160 kbps'], [192, '192 kbps (recommended)'], [256, '256 kbps'], [320, '320 kbps']]
const PRESETS = [
  ['mp4-720', '720p MP4'], ['mp4-480', 'Small MP4 (480p)'], ['mp4-best', 'Best quality MP4'],
]

const FIXED_TEXT = {
  mp4: ['smartphone', 'H.264 video and AAC audio. Plays on iPhone, Android, Windows, Mac, TVs and WhatsApp.'],
  webm: ['globe', 'VP8 video with Vorbis audio. Made for the web: plays in Chrome, Firefox, Edge and most browsers.'],
  apng: ['image-play', 'An animated PNG: full colour and smooth edges, sharper than a GIF. Plays in all current browsers.'],
  mkv: ['layers', 'A flexible container for PCs and TVs. Streams are copied when they fit.'],
  mov: ['apple', 'QuickTime video for Mac, iPhone and editors like Final Cut and iMovie.'],
}
const SOURCES = {
  mov: { accept: '.mov,video/quicktime', label: 'Drop a MOV video to make an MP4', hint: 'iPhone and Mac recordings (.mov)', note: 'iPhone videos are often HEVC (H.265), which many Windows, Android and web apps cannot play. They are converted to H.264 here.' },
  mkv: { accept: '.mkv,video/x-matroska', label: 'Drop an MKV video to make an MP4', hint: 'Matroska videos (.mkv)', note: 'When the MKV already holds H.264 video and AAC or MP3 sound, only the container changes, so it is instant and lossless. Embedded subtitles are not carried into the MP4: use Extract subtitles first.' },
  avi: { accept: '.avi,video/x-msvideo', label: 'Drop an AVI video to make an MP4', hint: 'Old AVI videos (.avi)', note: 'AVI files usually hold older video codecs (like Xvid), so they are re-encoded to H.264 for a smaller, widely playable MP4.' },
  webm: { accept: '.webm,video/webm', label: 'Drop a WebM video to make an MP4', hint: 'Web videos (.webm)', note: 'WebM (VP8 or VP9) is re-encoded to H.264 so it plays in apps and players that do not support WebM.' },
  wmv: { accept: '.wmv,.asf', label: 'Drop a WMV video to make an MP4', hint: 'Windows Media videos (.wmv, .asf)', note: 'Windows Media video is re-encoded to H.264 so it plays on phones, Macs and TVs.' },
  flv: { accept: '.flv,.f4v', label: 'Drop an FLV video to make an MP4', hint: 'Flash videos (.flv, .f4v)', note: 'Flash video is converted to H.264. If it already holds H.264, only the container changes.' },
  mpeg: { accept: '.mpg,.mpeg,.mpe,.m2v,.vob,.dat', label: 'Drop an MPEG video to make an MP4', hint: 'MPEG, DVD (.vob) and Video CD (.dat) files', note: 'Interlaced DVD and MPEG-2 video is de-interlaced while it is converted to H.264.' },
}

export function mount(root, { params, signal }) {
  const fixed = params?.to
  const src = SOURCES[params?.from]
  let get = null // set once a file is loaded: () => current settings

  const targetLabel = fixed ? VIDEO_TARGETS[fixed].label : ''
  createShell(root, { signal }, {
    kind: 'video',
    require: VIDEO_TARGETS[fixed]?.kind === 'audio' ? 'audio' : 'video',
    dropIcon: fixed ? (FIXED_TEXT[fixed]?.[0] || 'file-video') : 'repeat-2',
    dropLabel: src?.label || (fixed ? `Drop any video to make a${/^[aeiou]/i.test(targetLabel) ? 'n' : ''} ${targetLabel}` : undefined),
    dropHint: src?.hint || 'MP4, MOV, MKV, WebM, AVI, WMV, FLV, MPEG, TS, 3GP, VOB and more',
    accept: src?.accept || VIDEO_ACCEPT,
    action: { label: fixed ? `Convert to ${targetLabel}` : 'Convert video', icon: 'repeat-2', busy: 'Converting' },

    options(media, shell) {
      const { info } = media
      let fmt = fixed || 'mp4'
      let quality = 'balanced'
      const short = Math.min(info.video?.width || 0, info.video?.height || 0)

      const targetOpts = Object.values(VIDEO_TARGETS)
      const formatPicker = fixed ? null : tilePicker({
        label: 'Output format', value: fmt, onChange: (v) => { fmt = v; refresh() },
        options: targetOpts.map((f) => ({ value: f.id, label: f.label, sub: f.note, icon: f.icon })),
      })
      const qualityPicker = tilePicker({ label: 'Quality', options: QUALITY, value: quality, onChange: (v) => { quality = v; refresh() } })
      const sideSel = select([[0, 'Keep the original']], 0, () => refresh())
      const fpsSel = select(VIDEO_FPS, 0, () => refresh())
      const speedSel = select(SPEEDS, 'balanced', () => refresh())
      const abSel = select(ABITRATES, 192, () => refresh())
      const sideField = field('Resolution', sideSel)
      const fpsField = field('Frame rate', fpsSel)
      const speedField = field('Encoding speed', speedSel)
      const abField = field('Audio bitrate', abSel)
      const smart = toggle('Copy without re-encoding when the video already fits', true, () => refresh())
      const planNote = note('')
      const presetRow = pills(PRESETS, '', (v) => applyPreset(v), 'Quick presets')
      const presetField = fixed && !['mp4', 'mov', 'mkv'].includes(fixed) ? null : field('Quick presets', presetRow)
      const qualityStep = step(2, 'Quality', qualityPicker)

      const kindOf = () => VIDEO_TARGETS[fmt].kind || 'video'
      const setList = (sel, list, value) => { sel.replaceChildren(...list.map(([v, l]) => h('option', { value: v }, l))); sel.value = String(value) }
      const plan = () => ({
        fmt, quality, speed: speedSel.value, cap: +sideSel.value || 0, fps: +fpsSel.value || 0,
        smart: smart.input.checked, abitrate: +abSel.value || 192,
      })
      get = plan

      function applyPreset(v) {
        presetRow.set('')
        const to = fixed || 'mp4'
        if (!['mp4', 'mov', 'mkv'].includes(to)) return
        fmt = to
        formatPicker?.set(to)
        quality = v === 'mp4-480' ? 'small' : v === 'mp4-best' ? 'high' : 'balanced'
        qualityPicker.set(quality)
        refresh()
        const cap = v === 'mp4-720' ? 720 : v === 'mp4-480' ? 480 : 0
        sideSel.value = String(cap && (!short || cap < short) ? cap : 0)
        refresh()
      }

      function refresh() {
        const f = VIDEO_TARGETS[fmt]
        const kind = kindOf()
        // lists that depend on the kind of output
        if (kind === 'anim') {
          if (!sideSel.dataset.kind || sideSel.dataset.kind !== 'anim') { setList(sideSel, [...ANIM_SIDES.filter(([c]) => !short || c <= short), [0, 'Keep the original']], short && short < 480 ? 0 : 480); sideSel.dataset.kind = 'anim' }
          if (fpsSel.dataset.kind !== 'anim') { setList(fpsSel, ANIM_FPS, 12); fpsSel.dataset.kind = 'anim' }
        } else {
          if (sideSel.dataset.kind !== 'video') { setList(sideSel, [[0, `Keep the original${info.display ? ` (${info.display.width} x ${info.display.height})` : ''}`], ...SIDES.filter(([c]) => c < short)], 0); sideSel.dataset.kind = 'video' }
          if (fpsSel.dataset.kind !== 'video') { setList(fpsSel, VIDEO_FPS, 0); fpsSel.dataset.kind = 'video' }
        }
        const o = plan()
        let p
        try { p = videoPlan(info, fmt, o); shell.setEnabled(true) } catch (e) {
          shell.setEnabled(false, e.message)
          shell.setInfo('Cannot convert', e.message)
          planNote.textContent = e.message
          planNote.className = 'mc-note warn'
          return
        }
        const remux = p.attempts[0].mode === 'copy'
        qualityStep.hidden = remux || kind !== 'video'
        presetField && (presetField.hidden = kind !== 'video')
        sideField.hidden = kind === 'audio'
        fpsField.hidden = kind === 'audio'
        speedField.hidden = remux || kind !== 'video' || fmt === 'webm' || fmt === 'avi'
        abField.hidden = kind !== 'audio'
        smart.hidden = kind !== 'video'
        planNote.className = 'mc-note'
        const warn = p.warnings.join(' ')
        if (remux) {
          shell.setInfo('Instant, no quality loss', `The streams already fit ${f.label}, so they are copied as they are.`)
          planNote.textContent = `Good news: this video is ${info.video.codec.toUpperCase()}${info.audio ? ' + ' + info.audio.codec.toUpperCase() : ''}, which ${f.label} accepts as it is. Only the container changes, so it takes a moment and looks identical.`
        } else if (kind === 'audio') {
          shell.setInfo(`Save the sound as ${f.label}`, f.note)
          planNote.textContent = `The soundtrack is saved as ${f.label}. The picture is dropped. For WAV, FLAC, OGG, Opus and more, use Extract audio.`
        } else if (kind === 'anim') {
          shell.setInfo(`Make an animated ${f.label}`, `${o.fps || 12} frames a second, no sound`)
          planNote.textContent = `${f.label} has no sound. ${fmt === 'gif' ? 'A custom 256-colour palette is made for your clip, so colours stay clean.' : 'Colours are not limited, so files are larger than a GIF.'} Short clips work best: ${warn || 'trim long videos first.'}`
          planNote.className = `mc-note${info.duration > 30 ? ' warn' : ''}`
        } else if (fmt === 'webm') {
          shell.setInfo(`Re-encode to ${f.label}`, 'WebM is slow to encode in a browser.')
          planNote.textContent = 'WebM needs a full re-encode (VP8 video, Vorbis audio), which is slow in a browser. For long videos, MP4 is much faster.'
          planNote.className = 'mc-note warn'
        } else {
          shell.setInfo(`Re-encode to ${f.label}`, `${f.sub}. Longer videos take longer.`)
          planNote.textContent = `The video is re-encoded to ${f.sub}. A 1 minute 1080p clip takes a few minutes in the browser; smaller resolutions are quicker.`
          if (fmt === 'avi') planNote.textContent += ' AVI is an old format: files are larger and some players ignore parts of it.'
        }
        if (['mp4', 'mov', 'mkv'].includes(fmt) && info.nSub) planNote.textContent += ' Embedded subtitles are not carried over: use Extract subtitles first.'
      }
      refresh()
      const startCap = +params?.cap || 0
      if (startCap && short && startCap < short) { sideSel.value = String(startCap); refresh() }
      return [
        formatPicker
          ? step(1, 'Convert to', formatPicker)
          : step(1, 'Output', [fixedOutput(FIXED_TEXT[fixed]?.[0] || 'file-video', targetLabel, FIXED_TEXT[fixed]?.[1] || VIDEO_TARGETS[fixed].note), src ? note(src.note) : null]),
        qualityStep,
        step(3, 'Fine tuning', [presetField, h('div', { class: 'mc-grid' }, sideField, fpsField, speedField, abField), h('div', { class: 'mc-switches' }, smart), planNote]),
      ]
    },

    async execute(media, hp) {
      const { file, info } = media
      const o = get()
      const r = await convertVideo({
        file, info, to: o.fmt, run: (spec) => hp.ffmpeg(spec),
        o: { quality: o.quality, speed: o.speed, cap: o.cap, fps: o.fps, smart: o.smart, abitrate: o.abitrate },
      })
      const f = VIDEO_TARGETS[o.fmt]
      return {
        blob: r.blob, name: r.name, inputSize: file.size, kind: r.kind === 'anim' ? 'image' : r.kind === 'audio' ? 'audio' : 'video',
        title: r.mode === 'copy' ? 'Converted instantly' : `Converted to ${f.label}`,
        summary: r.mode === 'copy' ? 'The streams were copied as they are, so the picture and sound are untouched.' : `Re-encoded to ${f.sub}.`,
      }
    },
  })
}

