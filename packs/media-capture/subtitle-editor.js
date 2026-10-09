// Subtitle editor: open an SRT, VTT or ASS file (optionally with its video), watch the lines appear on the picture, fix text and
// timing line by line, shift everything, find and replace, tidy overlaps, then save as SRT, VTT, ASS or text. Your work is kept
// in this browser so a refresh does not lose it.
import { h, icon, button, alert, dropzone, number, input, toggle, copyButton, download, clear, toast } from '../../lib/ui.js'
import { baseName } from '../../lib/files.js'
import { load, save, remove } from '../../lib/store.js'
import * as K from './_kit.js'
import { cueEditor, mediaPlayer } from './_cues.js'
import { SUB_ACCEPT, parseSubtitles, decodeText, format, shiftCues } from './_subs.js'

const SAMPLE = [
  { start: 1, end: 3.5, text: 'Welcome to the subtitle editor.' },
  { start: 4, end: 7.2, text: 'Edit any line, then drag the times\nor press the arrows in the time boxes.' },
  { start: 8, end: 11, text: 'Open a video to see your lines on the picture.' },
]

export function mount(root, { signal }) {
  K.useStyle()
  let name = ''
  let ed = null
  let player = null
  let mediaUrl = null
  let loaded = false
  const stored = load('mc:subedit', null)
  const host = h('div', { class: 'stack' })
  const notice = h('div')

  const subZone = dropzone({
    accept: SUB_ACCEPT, compact: true, label: 'Open a subtitle file', hint: 'SRT, VTT, ASS or SSA', icon: 'captions',
    onFiles: async ([f]) => {
      const { cues, format: fmt } = parseSubtitles(decodeText(await f.arrayBuffer()))
      if (!cues.length) return toast(`No subtitle lines found in ${f.name}.`, 'error')
      open(cues, f.name)
      toast(`Opened ${cues.length} lines (${fmt.toUpperCase()})`, 'success')
    },
  })
  const mediaZone = dropzone({
    accept: 'video/*,audio/*,.mkv,.mp4,.webm,.mov,.mp3,.wav,.m4a,.ogg', compact: true, paste: false, label: 'Add the video or audio (optional)', hint: 'Plays here only, never uploaded', icon: 'film',
    onFiles: ([f]) => {
      if (mediaUrl) URL.revokeObjectURL(mediaUrl)
      mediaUrl = URL.createObjectURL(f)
      mediaIsVideo = !(f.type || '').startsWith('audio/')
      mediaName = f.name
      if (!name) name = f.name
      if (loaded) rebuild(ed.cues())
      else toast('Now open a subtitle file, or start from scratch.', 'info')
    },
  })
  let mediaIsVideo = true
  let mediaName = ''

  const persist = () => { if (ed) save('mc:subedit', { name, cues: ed.cues(), at: Date.now() }) }

  function open(cues, fileName) {
    name = fileName || name
    loaded = true
    clear(notice)
    rebuild(cues)
  }

  function rebuild(cues) {
    player?.dispose(); player = null
    ed = cueEditor({
      cues, emptyText: 'No lines yet. Press "Add line".',
      seek: mediaUrl ? (t) => player?.play(t) : null,
      getTime: mediaUrl ? () => player?.media.currentTime ?? 0 : null,
      onChange: (c) => { player?.update(c); persist() },
    })
    if (mediaUrl) {
      player = mediaPlayer({ url: mediaUrl, video: mediaIsVideo, cues: ed.cues() })
      player.onTime((t) => ed.setTime(t))
    }
    persist()

    const shiftIn = number(0, { step: 100, placeholder: '0', ariaLabel: 'Shift all lines by milliseconds' })
    const findIn = input({ placeholder: 'Find', 'aria-label': 'Find text' })
    const replIn = input({ placeholder: 'Replace with', 'aria-label': 'Replace with' })
    const caseT = toggle('Match case', false)
    const base = () => baseName(name) || 'subtitles'
    const fmtBtn = (label, kind, mime, primary) => button(label, { icon: 'download', variant: primary ? 'primary' : 'secondary', size: 'sm', onClick: () => download(format(ed.cues(), kind, { title: base() }), `${base()}.${kind}`, mime) })

    const tools = h('div', { class: 'panel' }, h('div', { class: 'stack tight' },
      h('div', { class: 'mc-cue-tools', style: 'align-items:flex-end' },
        h('label', { class: 'field', style: 'flex:0 1 180px' }, h('span', { class: 'field-label' }, 'Shift all lines (ms)'), shiftIn),
        button('Apply shift', { icon: 'move-horizontal', size: 'sm', onClick: () => {
          const ms = shiftIn.valueAsNumber
          if (!Number.isFinite(ms) || !ms) return toast('Enter a number of milliseconds first.', 'info')
          const r = shiftCues(ed.cues(), ms)
          ed.set(r.cues)
          toast(`Shifted ${r.cues.length} lines${r.dropped ? `, removed ${r.dropped} that would start before 0:00` : ''}`, r.dropped ? 'info' : 'success')
          shiftIn.value = ''
        } })),
      h('div', { class: 'mc-cue-tools' },
        h('div', { style: 'flex:1 1 140px' }, findIn), h('div', { style: 'flex:1 1 140px' }, replIn), caseT,
        button('Replace all', { icon: 'replace-all', size: 'sm', onClick: () => {
          const f = findIn.value
          if (!f) return toast('Type the text to find.', 'info')
          const re = new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseT.input.checked ? 'g' : 'gi')
          let n = 0
          const next = ed.cues().map((c) => ({ ...c, text: c.text.replace(re, () => { n++; return replIn.value }) }))
          if (!n) return toast('Nothing matched.', 'info')
          ed.set(next)
          toast(`Replaced ${n} match${n === 1 ? '' : 'es'}`, 'success')
        } })),
      h('div', { class: 'mc-cue-tools' },
        button('Tidy up', { icon: 'sparkles', size: 'sm', title: 'Remove empty lines and trim overlaps so each line ends before the next starts', onClick: () => {
          const cs = ed.cues().filter((c) => c.text.trim()).sort((a, b) => a.start - b.start)
          const removed = ed.length - cs.length
          let fixed = 0
          for (let i = 0; i < cs.length - 1; i++) if (cs[i].end > cs[i + 1].start) { cs[i].end = Math.max(cs[i].start, cs[i + 1].start); fixed++ }
          for (const c of cs) if (c.end < c.start) { c.end = c.start + 1; fixed++ }
          ed.set(cs)
          toast(removed || fixed ? `Removed ${removed} empty, fixed ${fixed} overlapping or reversed` : 'Already tidy', removed || fixed ? 'success' : 'info')
        } }),
        button('Add line', { icon: 'plus', size: 'sm', onClick: () => ed.add(player?.media.currentTime) }),
        h('span', { style: 'flex:1' }),
        fmtBtn('SRT', 'srt', 'application/x-subrip', true), fmtBtn('VTT', 'vtt', 'text/vtt'), fmtBtn('ASS', 'ass', 'text/plain'), fmtBtn('TXT', 'txt', 'text/plain'),
        copyButton(() => format(ed.cues(), 'srt'), 'Copy SRT'))))

    clear(host,
      mediaUrl ? h('div', { class: 'mc-media' }, h('div', { class: 'tile lg' }, icon(mediaIsVideo ? 'file-video' : 'file-audio')), h('div', { class: 'meta' }, h('div', { class: 'name' }, mediaName), h('div', { class: 'sub' }, 'Lines show on the picture while it plays'))) : alert('info', 'Add the video or audio above to see your lines on the picture and set times from the playhead. Without it you can still edit text and times.'),
      player ? player.el : null,
      tools,
      ed.el,
      h('p', { class: 'small muted' }, icon('shield-check'), ' Your work is saved in this browser as you type. Nothing is uploaded. Press the play button on a line to jump there, and use the small arrow buttons beside the times to set a line start or end from the playhead.'))
  }

  if (stored?.cues?.length) {
    notice.append(alert('info', h('strong', 'Pick up where you left off? '), `${stored.cues.length} lines${stored.name ? ` from ${stored.name}` : ''} are saved in this browser. `,
      h('span', { class: 'row', style: 'display:inline-flex;margin-left:8px' },
        button('Restore', { size: 'sm', variant: 'primary', onClick: () => open(stored.cues, stored.name) }),
        button('Discard', { size: 'sm', variant: 'ghost', onClick: () => { remove('mc:subedit'); clear(notice) } }))))
  }

  const scratch = button('Start from scratch', { icon: 'plus', variant: 'secondary', size: 'sm', onClick: () => open([], '') })
  const example = button('Try an example', { icon: 'sparkles', variant: 'ghost', size: 'sm', onClick: () => open(SAMPLE.map((c) => ({ ...c })), 'example.srt') })
  root.append(h('div', { class: 'mc stack' },
    notice,
    h('div', { class: 'grid-2' }, subZone, mediaZone),
    h('div', { class: 'row' }, scratch, example),
    host))
  return () => { player?.dispose(); if (mediaUrl) URL.revokeObjectURL(mediaUrl) }
}
