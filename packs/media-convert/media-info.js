// Video & audio info: what is inside a media file (container, codecs, resolution, frame rate, bitrate, streams).
import { createShell, step, h } from './_ui.js'
import { fmtTime } from './_media.js'
import { stats, table, copyButton, formatBytes, downloadButton } from '../../lib/ui.js'
import { baseName } from '../../lib/files.js'

const CONTAINER = { mov: ['MP4 / MOV', 'QuickTime family'], matroska: ['MKV / WebM', 'Matroska'], avi: ['AVI', 'Audio Video Interleave'], mp3: ['MP3', 'MPEG audio'], wav: ['WAV', 'Uncompressed audio'], ogg: ['OGG', 'Ogg container'], flac: ['FLAC', 'Lossless audio'], aac: ['AAC', 'ADTS stream'], mpegts: ['MPEG-TS', 'Transport stream'], flv: ['FLV', 'Flash video'], asf: ['WMV / WMA', 'Windows Media'], gif: ['GIF', 'Animated image'] }
const kbps = (n) => (n >= 1000 ? `${+(n / 1000).toFixed(2)} Mbps` : `${Math.round(n)} kbps`)
const n2 = (n) => +Number(n).toFixed(2)

/** Stream lines from ffmpeg's log: [{index, type, text}] */
export function streamLines(log) {
  return String(log).split(/\r?\n/).map((l) => l.match(/^\s*Stream #\d+:(\d+)(?:\[[^\]]*\])?(?:\(([^)]*)\))?:\s*(Video|Audio|Subtitle|Data|Attachment):\s*(.*)$/)).filter(Boolean)
    .map((m) => ({ index: +m[1], lang: m[2] || '', type: m[3], text: m[4] }))
}

export function summaryText(file, info) {
  const lines = [`File: ${file.name}`, `Size: ${formatBytes(file.size)}`, `Container: ${CONTAINER[info.container]?.join(', ') || info.container || 'unknown'}`]
  if (info.duration != null) lines.push(`Duration: ${fmtTime(info.duration, 2)} (${n2(info.duration)} s)`)
  if (info.bitrate) lines.push(`Overall bitrate: ${kbps(info.bitrate)}`)
  if (info.video) lines.push(`Video: ${info.video.codec}${info.video.profile ? ` (${info.video.profile})` : ''}, ${info.video.width}x${info.video.height}${info.rotation ? ` rotated ${info.rotation} deg` : ''}, ${info.video.fps ? n2(info.video.fps) + ' fps' : 'unknown fps'}${info.video.bitrate ? ', ' + kbps(info.video.bitrate) : ''}${info.video.pix ? ', ' + info.video.pix : ''}`)
  if (info.audio) lines.push(`Audio: ${info.audio.codec}, ${info.audio.rate ? n2(info.audio.rate / 1000) + ' kHz' : ''}, ${info.audio.layout}${info.audio.bitrate ? ', ' + kbps(info.audio.bitrate) : ''}`)
  return lines.join('\n')
}

export function mount(root, { signal }) {
  createShell(root, { signal }, {
    kind: 'video',
    dropIcon: 'info',
    dropLabel: 'Drop a video or audio file to look inside',
    dropHint: 'Any video or audio file. Nothing is changed or uploaded.',
    accept: 'video/*,audio/*,.mkv,.avi,.mov,.m4v,.wmv,.flv,.3gp,.ts,.mts,.m2ts,.webm,.mp4,.mp3,.wav,.m4a,.aac,.ogg,.opus,.flac,.wma,.amr',
    trust: [['shield-check', 'Stays on your device', 'The file is read inside this tab. Nothing is uploaded.'], ['search', 'Every detail', 'Codecs, resolution, frame rate, bitrate, channels and tags.'], ['copy', 'Copy or save the report', 'Handy for support tickets and upload requirements.']],
    options(media) {
      const { info, file } = media
      const streams = streamLines(info.log)
      const items = [
        { label: 'Container', value: CONTAINER[info.container]?.[0] || info.container || '-', hint: CONTAINER[info.container]?.[1], accent: true },
        { label: 'Duration', value: info.duration != null ? fmtTime(info.duration, 2) : '-' },
        { label: 'File size', value: formatBytes(file.size) },
        { label: 'Overall bitrate', value: info.bitrate ? kbps(info.bitrate) : '-' },
      ]
      if (info.video) {
        items.push({ label: 'Video', value: info.video.codec.toUpperCase(), hint: `${info.display.width} x ${info.display.height}${info.rotation ? ` (stored ${info.video.width} x ${info.video.height}, rotated ${info.rotation} deg)` : ''}` })
        items.push({ label: 'Frame rate', value: info.video.fps ? `${n2(info.video.fps)} fps` : '-' })
        if (info.video.bitrate) items.push({ label: 'Video bitrate', value: kbps(info.video.bitrate) })
        if (info.video.pix) items.push({ label: 'Pixel format', value: info.video.pix })
      }
      if (info.audio) {
        items.push({ label: 'Audio', value: info.audio.codec.toUpperCase(), hint: [info.audio.layout, info.audio.rate ? `${n2(info.audio.rate / 1000)} kHz` : ''].filter(Boolean).join(', ') })
        if (info.audio.bitrate) items.push({ label: 'Audio bitrate', value: kbps(info.audio.bitrate) })
      }
      const tags = Object.entries(info.tags || {})
      const report = summaryText(file, info)
      return [
        step(1, 'At a glance', stats(items)),
        step(2, `Streams (${streams.length})`, streams.length
          ? table({ columns: [{ label: '#', num: true }, 'Type', 'Language', 'Details'], rows: streams.map((s) => [String(s.index), s.type, s.lang || '-', s.text]) })
          : h('div', { class: 'mc-note' }, 'No streams were found.')),
        tags.length ? step(3, 'Tags', h('dl', { class: 'mc-kv' }, tags.flatMap(([k, v]) => [h('dt', k), h('dd', v)]))) : null,
        step(tags.length ? 4 : 3, 'Full report', [
          h('div', { class: 'row' }, copyButton(() => report, 'Copy summary'), copyButton(() => info.log, 'Copy full ffmpeg log'), downloadButton(new Blob([`${report}\n\n--- ffmpeg log ---\n${info.log}\n`], { type: 'text/plain' }), `${baseName(file.name)}-info.txt`, 'Download as text', { variant: 'secondary', size: 'sm' })),
          h('details', h('summary', { style: 'cursor:pointer;font-size:13px;color:var(--muted);margin:6px 0' }, 'Show the raw ffmpeg log'), h('pre', { class: 'code-out' }, info.log)),
        ]),
      ]
    },
  })
}
