// Extract subtitles from a video (MKV, MP4, MOV, WebM, TS ...): lists the tracks first, then saves the text ones as SRT, ASS or WebVTT.
import { createShell, step, tilePicker, note, h } from './_ui.js'
import { VIDEO_ACCEPT, subtitleTracks, extractSubtitles } from './_core.js'
import { parseSubtitles } from '../media-capture/_subs.js'
import { toggle, alert } from '../../lib/ui.js'

const FORMATS = [
  { value: 'srt', label: 'SRT', sub: 'Plain text, works in every player', icon: 'captions' },
  { value: 'vtt', label: 'WebVTT', sub: 'For web video and HTML5', icon: 'globe' },
  { value: 'ass', label: 'ASS', sub: 'Keeps fonts, colours and positions', icon: 'palette' },
]

export function mount(root, { params, signal }) {
  let get = null

  createShell(root, { signal }, {
    kind: 'video',
    accept: VIDEO_ACCEPT,
    dropIcon: 'captions',
    dropLabel: 'Drop a video to pull its subtitles out',
    dropHint: 'MKV, MP4, MOV, WebM, TS and more. Text subtitles only, picture subtitles (DVD, Blu-ray) cannot be converted.',
    action: { label: 'Extract subtitles', icon: 'captions', busy: 'Extracting subtitles' },

    options(media, shell) {
      const { info } = media
      const tracks = subtitleTracks(info)
      let fmt = params?.to || 'srt'
      const picked = new Set(tracks.filter((t) => t.text).map((t) => t.ord))
      get = () => ({ fmt, tracks: [...picked] })

      const count = () => {
        const n = picked.size
        shell.setEnabled(n > 0, n ? '' : 'Pick at least one subtitle track')
        shell.setInfo(n ? `${n} track${n === 1 ? '' : 's'} to ${fmt.toUpperCase()}` : 'No track selected', 'Each track becomes its own file')
      }
      if (!tracks.length) {
        shell.setEnabled(false, 'This video has no embedded subtitles')
        return step(1, 'Subtitle tracks', alert('warn', h('strong', 'No subtitles found. '), 'This file has no embedded subtitle tracks. Subtitles are sometimes a separate .srt file next to the video, or burned into the picture.'))
      }
      const rows = tracks.map((t) => {
        const tg = toggle(`${t.label}`, t.text, (on) => { if (on) picked.add(t.ord); else picked.delete(t.ord); count() })
        if (!t.text) { tg.input.disabled = true; tg.input.checked = false }
        return h('div', { class: 'stack tight' }, tg, t.text ? null : note('This track is made of pictures, not text, so it cannot be turned into SRT, ASS or WebVTT.', 'warn'))
      })
      const picker = tilePicker({ label: 'Output format', options: FORMATS, value: fmt, onChange: (v) => { fmt = v; count() } })
      count()
      return [
        step(1, `Subtitle tracks (${tracks.length})`, [h('div', { class: 'mc-switches' }, rows), note('Language codes come from the file (for example eng, spa). Names are added to each saved file.')]),
        step(2, 'Save as', picker),
      ]
    },

    async execute(media, hp) {
      const { file, info } = media
      const o = get()
      const outs = await extractSubtitles({ file, info, to: o.fmt, tracks: o.tracks, run: (spec) => hp.ffmpeg(spec) })
      const items = []
      for (const x of outs) {
        let lines = null
        try { lines = parseSubtitles(await x.blob.text()).cues.length } catch { /* not parsable as text */ }
        items.push({ blob: x.blob, name: x.name, kind: 'text', note: lines != null ? `${lines} lines` : '' })
      }
      return { items, title: `${items.length} subtitle file${items.length === 1 ? '' : 's'} saved`, zipName: 'subtitles.zip', summary: `Text subtitles from ${file.name}, saved as ${o.fmt.toUpperCase()}.` }
    },
  })
}
