// YouTube video summarizer (and YouTube video to notes via params.preset 'notes').
// Browsers cannot download YouTube transcripts, so the visitor pastes the transcript from YouTube's "Show transcript" panel.
// The title comes from noembed.com; timestamps in the answer become links that open the video at that moment.
import { h, button, field, input, select, segmented, textarea, dropzone, alert, clear, panel, split, row, debounce, icon } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { injectStyle, resultView, exportBar, runner, streamAsk, readSource, LANGUAGES, UNTRUSTED } from './_shared.js'

/** Video id from youtu.be, watch?v=, shorts, embed and live URLs (or a bare 11-character id). */
export function parseVideoId(url = '') {
  const s = url.trim()
  if (/^[\w-]{11}$/.test(s)) return s
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
    const host = u.hostname.replace(/^www\.|^m\./, '')
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0].match(/^[\w-]{11}$/)?.[0] || null
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = u.searchParams.get('v') || u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/)?.[1]
      return v?.match(/^[\w-]{11}$/)?.[0] || null
    }
  } catch { /* not a URL */ }
  return null
}

const TS = '(?:\\d{1,2}:)?\\d{1,2}:\\d{2}'
const toSec = (t) => t.split(':').reduce((a, x) => a * 60 + +x, 0)
const fmt = (sec) => { const s = Math.floor(sec); const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60; return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}` }

/**
 * Turn what YouTube's transcript panel copies ("0:15" on one line, text on the next), "0:15 text" lines or SRT/VTT cues
 * into "[0:15] text" lines. Text without timestamps is returned unchanged.
 */
export function normalizeTranscript(raw) {
  const src = raw.replace(/\r/g, '').trim()
  if (/-->/.test(src)) {
    const out = []
    for (const block of src.split(/\n{2,}/)) {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
      const i = lines.findIndex((l) => /-->/.test(l))
      if (i < 0) continue
      const m = lines[i].match(/(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,]\d+)?\s*-->/)
      const text = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').trim()
      if (m && text) out.push(`[${fmt((+m[1] || 0) * 3600 + +m[2] * 60 + +m[3])}] ${text}`)
    }
    return out.join('\n')
  }
  const out = []
  let pending = null
  for (const line of src.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const only = line.match(new RegExp(`^${TS}$`))
    const inline = line.match(new RegExp(`^(${TS})\\s+(.+)$`))
    if (only) { pending = line; continue }
    if (inline) { out.push(`[${inline[1]}] ${inline[2]}`); pending = null; continue }
    if (pending) { out.push(`[${pending}] ${line}`); pending = null } else out.push(line)
  }
  return out.join('\n')
}

/** [12:34] -> a link that opens the video at that time. */
export const linkTimestamps = (md, id) => (id ? md.replace(new RegExp(`\\[(${TS})\\](?!\\()`, 'g'), (_, t) => `[${t}](https://youtu.be/${id}?t=${toSec(t)})`) : md)

const STYLES = [['summary', 'Summary'], ['chapters', 'Chapters'], ['notes', 'Study notes']]
function buildSystem({ style, length, language, timestamps }) {
  const len = { short: 'Keep it short.', standard: '', long: 'Be thorough and detailed.' }[length]
  const spec = {
    summary: 'Write: a level-2 title; "**TL;DR**" (2 to 3 sentences); "## Key takeaways" (5 to 10 bullets, each with the timestamp where it is discussed); "## Chapters" (a list of "[m:ss] Chapter title" lines covering the whole video); and "## Worth remembering" with up to 3 notable quotes, numbers or claims.',
    chapters: 'Write a level-2 title and then a chapter list: one line per chapter as "[m:ss] **Title** - one sentence on what is covered", covering the whole video in order (8 to 20 chapters depending on length).',
    notes: 'Write study notes: a level-2 title; "**Big idea**"; sections with headings in the order of the lecture, each with concise bullets, **bold key terms**, definitions and formulas; "## Key terms" as a table (Term | Meaning); "## Quick recap"; and "## Practice questions" (6 questions) followed by "### Answers".',
  }[style]
  return `You summarize YouTube videos from their transcripts. ${UNTRUSTED} Use only the transcript; do not add outside facts, and say when the transcript is unclear or incomplete. Transcripts come from auto-captions and can contain mistakes in names and jargon; use the video title to correct them. ${timestamps ? 'Lines start with [time] stamps. When you cite a moment, write the stamp exactly as [m:ss] or [h:mm:ss] using only stamps that appear in the transcript.' : 'The transcript has no timestamps, so do not invent any.'} ${len} ${language.startsWith('Same') ? 'Write in the same language as the transcript.' : `Write in ${language}.`} Reply with Markdown only.\n\n${spec}`
}

export function mount(root, { params, signal }) {
  injectStyle()
  const notes = params.preset === 'notes'
  let meta = null
  const view = resultView({ emptyIcon: notes ? 'notebook-pen' : 'circle-play', emptyTitle: notes ? 'Study notes appear here' : 'Your video summary appears here', emptyText: 'Paste the video link and its transcript (the steps are on the left). You get key takeaways, chapters and timestamps that jump to the right moment.' })
  const status = h('div')
  const card = h('div')
  const url = input({ placeholder: 'https://www.youtube.com/watch?v=...', inputmode: 'url', 'aria-label': 'YouTube link' })
  const title = input({ placeholder: 'Video title (filled in automatically)', maxlength: 200, 'aria-label': 'Video title' })
  const text = textarea({ rows: 8, placeholder: 'Paste the transcript here...\n\n0:00\nWelcome to the channel\n0:04\nToday we are going to...', 'aria-label': 'Transcript' })
  const style = segmented(notes ? [['notes', 'Study notes'], ['summary', 'Summary'], ['chapters', 'Chapters']] : STYLES, notes ? 'notes' : 'summary', null, 'Output style')
  const length = segmented([['short', 'Short'], ['standard', 'Standard'], ['long', 'Detailed']], 'standard', null, 'Length')
  const language = select(['Same as the transcript', ...LANGUAGES], 'Same as the transcript')
  const go = button(notes ? 'Make notes' : 'Summarize video', { icon: 'sparkles', variant: 'primary', size: 'lg' })
  const run = runner({ btn: go, errorTo: status, signal, label: 'Writing' })
  const bar = exportBar(view, () => (title.value || 'video-summary').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60), { title: () => title.value })
  const zone = dropzone({ accept: '.srt,.vtt,.txt', label: 'Or drop a subtitle file', hint: 'SRT, VTT or TXT', compact: true, paste: false,
    onFiles: async ([f]) => { try { text.value = normalizeTranscript((await readSource(f, { allow: ['text'] })).text) } catch (e) { clear(status, alert('error', e.message)) } } })

  const lookup = debounce(async () => {
    const id = parseVideoId(url.value)
    clear(card)
    meta = null
    if (!id) { if (url.value.trim()) clear(card, h('div', { class: 'small', style: 'color:var(--danger)' }, 'That does not look like a YouTube link.')); return }
    try {
      const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, { signal })
      const j = await res.json()
      if (!j.title) throw new Error('no title')
      meta = j
      if (!title.value) title.value = j.title
      clear(card, h('div', { class: 'row', style: 'gap:12px;align-items:center' }, j.thumbnail_url && h('img', { src: j.thumbnail_url, alt: '', width: 96, height: 54, style: 'border-radius:8px;object-fit:cover;flex:none', loading: 'lazy' }),
        h('div', { style: 'min-width:0' }, h('strong', { style: 'display:block;overflow-wrap:anywhere' }, j.title), h('span', { class: 'small muted' }, j.author_name || ''))))
    } catch { /* the title is optional */ }
  }, 400)
  url.addEventListener('input', lookup)

  go.addEventListener('click', () => run.go(async (sig) => {
    const id = parseVideoId(url.value)
    const transcript = normalizeTranscript(text.value)
    if (transcript.length < 80) throw new Error('Paste the video transcript first. The steps are listed above the box.')
    if (transcript.length > 900_000) throw new Error('That transcript is very long. Paste a shorter section.')
    const stamped = /^\[/m.test(transcript)
    const head = `Video title: ${title.value.trim() || meta?.title || 'unknown'}${meta?.author_name ? `\nChannel: ${meta.author_name}` : ''}`
    await streamAsk(view, {
      system: buildSystem({ style: style.value, length: length.value, language: language.value, timestamps: stamped }), effort: 'low',
      messages: [{ role: 'user', content: [ai.textBlock(`${head}\n\n<transcript>\n${transcript}\n</transcript>`)] }],
    }, sig, (t) => linkTimestamps(t, id))
  }, { label: 'Writing' }))

  const steps = h('details', { class: 'panel', style: 'padding:12px 16px;background:var(--surface-2)', open: true },
    h('summary', { style: 'cursor:pointer;font-weight:600' }, 'How to copy the transcript from YouTube'),
    h('ol', { class: 'small', style: 'margin:10px 0 0;padding-left:20px;display:grid;gap:4px;color:var(--text-2)' },
      h('li', 'Open the video on YouTube (on a phone, use the website in your browser).'),
      h('li', 'Tap or click "...more" under the video, then "Show transcript".'),
      h('li', 'Optional: use the three-dot menu in the transcript box and keep "Toggle timestamps" on, so the summary can link to moments.'),
      h('li', 'Select all the transcript text (Ctrl+A inside the box), copy it, and paste it below.')))

  root.append(h('div', { class: 'stack' }, ai.notice(),
    split(
      panel(h('div', { class: 'stack' },
        field('Video link', url, 'Used to fetch the title (via noembed.com) and to link timestamps.'), card,
        field('Video title', title),
        steps, field('Transcript', text), zone,
        field('Output', style), h('div', { class: 'grid-auto' }, field('Length', length), field('Language', language)),
        row(go, run.stop), status)),
      h('div', { class: 'stack' }, view.el, bar), 'wide-right')))
}
