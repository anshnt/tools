// Meeting summarizer (also Meeting transcript to summary via params.transcript): minutes, decisions, action items and open
// questions from a pasted transcript or a recording (transcribed on this device with Whisper, then summarized).
import { h, button, field, input, select, textarea, dropzone, alert, clear, panel, split, row, progress, tabs, download, formatDuration } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { baseName } from '../../lib/files.js'
import { transcribe, WHISPER_MODELS, WHISPER_LANGS } from '../../lib/whisper.js'
import { injectStyle, resultView, exportBar, runner, readSource, LANGUAGES, todayISO, UNTRUSTED } from './_shared.js'

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    participants: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    key_points: { type: 'array', items: { type: 'string' } },
    decisions: { type: 'array', items: { type: 'string' } },
    action_items: { type: 'array', items: { type: 'object', properties: { task: { type: 'string' }, owner: { type: 'string' }, due: { type: 'string' }, priority: { type: 'string' } }, required: ['task', 'owner', 'due', 'priority'], additionalProperties: false } },
    open_questions: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'participants', 'summary', 'key_points', 'decisions', 'action_items', 'open_questions'],
  additionalProperties: false,
}
const TYPES = ['General meeting', 'Daily stand-up', 'Client call', 'Project review', 'Interview', 'Lecture or class', 'Brainstorm']

/** Remove WebVTT / SRT timing lines, cue numbers and voice tags so only the spoken text (with speakers) remains. */
export function cleanTranscript(raw) {
  const out = []
  for (const block of raw.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    if (!lines.length || /^(WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[0])) continue
    const body = lines.filter((l, i) => !/-->/.test(l) && !(i === 0 && /^\d+$/.test(l) && lines.some((x) => /-->/.test(x))))
    for (const l of body) out.push(l.replace(/<v\s+([^>]+)>/g, '$1: ').replace(/<\/?[a-z][^>]*>/gi, '').trim())
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function minutesMarkdown(d) {
  const list = (a) => (a?.length ? a.map((x) => `- ${x}`).join('\n') : '- None recorded')
  const cell = (v) => String(v || '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const items = d.action_items || []
  return [
    `# ${d.title || 'Meeting summary'}`,
    d.participants?.length ? `**Participants:** ${d.participants.join(', ')}` : '',
    `## Summary\n\n${d.summary}`,
    `## Key points\n\n${list(d.key_points)}`,
    `## Decisions\n\n${list(d.decisions)}`,
    `## Action items\n\n${items.length ? `| Task | Owner | Due | Priority |\n| --- | --- | --- | --- |\n${items.map((a) => `| ${cell(a.task)} | ${cell(a.owner) || 'Unassigned'} | ${cell(a.due) || '-'} | ${cell(a.priority) || '-'} |`).join('\n')}` : 'None recorded'}`,
    `## Open questions\n\n${list(d.open_questions)}`,
  ].filter(Boolean).join('\n\n')
}

export const actionsCsv = (items) => ['Task,Owner,Due,Priority', ...items.map((a) => [a.task, a.owner, a.due, a.priority].map((v) => (/[",\n]/.test(v || '') ? `"${(v || '').replace(/"/g, '""')}"` : v || '')).join(','))].join('\n')

export function mount(root, { params, signal }) {
  injectStyle()
  const textOnly = !!params.transcript
  let data = null
  let recording = null
  let activeTab = 'paste'
  const view = resultView({ emptyIcon: 'users', emptyTitle: 'Minutes appear here', emptyText: textOnly ? 'Paste a transcript and get a summary, decisions, action items with owners and due dates, and open questions.' : 'Paste a transcript or add a recording. You get a summary, decisions, action items with owners and due dates, and open questions.' })
  const status = h('div')
  const prog = progress()
  const text = textarea({ rows: 10, placeholder: 'Paste the transcript here (Zoom, Google Meet, Teams, or plain notes)...', 'aria-label': 'Transcript' })
  const tzone = dropzone({ accept: '.txt,.vtt,.srt,.md,.docx,text/plain', label: 'Or drop a transcript file', hint: 'TXT, VTT, SRT or Word', compact: true, paste: false,
    onFiles: async ([f]) => { clear(status); try { const s = await readSource(f, { allow: ['docx', 'text'] }); text.value = cleanTranscript(s.text) } catch (e) { clear(status, alert('error', e.message)) } } })
  const meetingType = select(TYPES, TYPES[0])
  const detail = select([['brief', 'Brief'], ['standard', 'Standard'], ['detailed', 'Detailed']], 'standard')
  const people = input({ placeholder: 'e.g. Asha, Ravi, Meera (helps fix name spelling and owners)', maxlength: 300 })
  const date = h('input', { class: 'input', type: 'date', value: todayISO(), 'aria-label': 'Meeting date' })
  const language = select(['Same as the transcript', ...LANGUAGES], 'Same as the transcript')
  const wmodel = select(WHISPER_MODELS, WHISPER_MODELS[1][0])
  const wlang = select(WHISPER_LANGS, '')
  const recLabel = h('div', { class: 'small muted' })
  const rzone = dropzone({ accept: 'audio/*,video/*,.mp3,.m4a,.wav,.mp4,.webm,.mov,.mkv,.ogg,.opus,.aac', label: 'Drop an audio or video recording', hint: 'MP3, M4A, WAV, MP4, WebM... transcribed on this device', icon: 'mic', compact: true,
    onFiles: ([f]) => { recording = f; clear(recLabel, `Selected: ${f.name}`) } })
  const go = button('Summarize', { icon: 'sparkles', variant: 'primary', size: 'lg' })
  const run = runner({ btn: go, errorTo: status, signal, label: 'Working' })
  const csv = button('Action items CSV', { icon: 'download', size: 'sm', onClick: () => data?.action_items?.length && download(actionsCsv(data.action_items), `${baseName(data.title || 'meeting')}-actions.csv`, 'text/csv') })
  const bar = exportBar(view, () => (data?.title || 'meeting-summary').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), { title: () => data?.title })
  view.onDone((v) => { csv.hidden = !v.text || !data?.action_items?.length })
  csv.hidden = true

  const setLabel = () => { go.querySelector('span:not(.spinner)').textContent = activeTab === 'file' ? 'Transcribe and summarize' : 'Summarize' }

  go.addEventListener('click', () => run.go(async (sig) => {
    let transcript = text.value.trim()
    if (activeTab === 'file') {
      if (!recording) throw new Error('Add a recording first, or switch to Paste transcript.')
      const r = await transcribe(recording, { model: wmodel.value, language: wlang.value, timestamps: true, onProgress: (f, label) => prog.set(f, label) })
      if (!r.text) throw new Error('No speech was found in that recording.')
      transcript = r.chunks?.length ? r.chunks.map((c) => `[${formatDuration(c.timestamp[0])}] ${c.text.trim()}`).join('\n') : r.text
      text.value = transcript
      prog.hide()
      if (sig.aborted) return
    }
    if (transcript.length < 40) throw new Error('That transcript is too short to summarize. Paste the full text.')
    if (transcript.length > 900_000) throw new Error('That transcript is very long. Split it into parts and summarize each.')
    const lang = language.value.startsWith('Same') ? 'Write in the same language as the transcript.' : `Write the summary in ${language.value}.`
    const system = `You turn meeting transcripts into precise minutes. Use only what was said and never invent decisions, owners or dates. If an owner, due date or priority is not stated, use an empty string. Resolve relative dates such as "next Friday" using the meeting date ${date.value || todayISO()} and write them as YYYY-MM-DD. Transcripts can contain speech-recognition errors; correct obvious misspellings of names${people.value.trim() ? ` using this participant list: ${people.value.trim()}` : ''}. Meeting type: ${meetingType.value}. Detail level: ${detail.value} (${{ brief: 'a 2 to 3 sentence summary, at most 5 key points', standard: 'a short paragraph summary, 5 to 8 key points', detailed: 'a thorough summary of every topic, up to 15 key points' }[detail.value]}). ${lang} ${UNTRUSTED}`
    view.reset()
    prog.set(null, 'Writing the minutes')
    data = await ai.ask({ system, json: SCHEMA, effort: 'low', signal: sig, messages: [{ role: 'user', content: [ai.textBlock(`<transcript>\n${transcript}\n</transcript>\n\nWrite the minutes.`)] }] })
    await view.set(minutesMarkdown(data))
  }, { label: 'Working', progress: prog }))

  const pasteTab = h('div', { class: 'stack' }, text, tzone)
  const fileTab = h('div', { class: 'stack' }, rzone, recLabel,
    h('div', { class: 'grid-auto' }, field('Speech model', wmodel, 'Downloads once (40-250 MB), then works offline.'), field('Spoken language', wlang)))
  const inputTabs = textOnly ? pasteTab : tabs([{ id: 'paste', label: 'Paste transcript', render: () => pasteTab }, { id: 'file', label: 'Upload recording', render: () => fileTab }], 'paste', (id) => { activeTab = id; setLabel() })

  root.append(h('div', { class: 'stack' }, ai.notice(),
    split(
      panel(h('div', { class: 'stack' }, inputTabs,
        h('div', { class: 'grid-auto' }, field('Meeting type', meetingType), field('Detail', detail), field('Meeting date', date), field('Output language', language)),
        field('Participants (optional)', people),
        row(go, run.stop), prog.el, status,
        h('p', { class: 'small muted' }, textOnly ? 'Your transcript goes only to the AI provider you chose.' : 'Recordings are transcribed on this device. Only the text goes to the AI provider you chose.'))),
      h('div', { class: 'stack' }, view.el, h('div', { class: 'row', style: 'gap:8px' }, bar, csv)), 'wide-right')))
}
