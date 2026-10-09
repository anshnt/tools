// Lecture audio to notes: on-device Whisper transcript, then notes. Local mode picks key sentences, terms and review questions;
// with an API key, Claude writes structured notes from the transcript. A pasted transcript works too.
import { h, button, busy, dropzone, field, select, toggle, segmented, progress, alert, clear, download, toast, copyText, formatDuration, formatNumber, onCleanup } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { transcribe, toSRT, WHISPER_MODELS, WHISPER_LANGS } from '../../lib/whisper.js'
import { load, save } from '../../lib/store.js'
import { baseName, safeName } from '../../lib/files.js'
import { stage, tile, toolStyle, pill, emptyState, TINTS, confetti, handoff, esc } from './_kit.js'
import { splitSentences, summarize, keyTerms, extractDefinitions } from './_text.js'
import { buildShort } from './_qgen.js'
import { renderMarkdown, htmlToPdf, printDoc, DOC_CSS } from './_pages.js'

const CSS = `
.t-ln .md { width: 100%; min-height: 460px; font: 500 13.5px/1.65 var(--mono); resize: vertical; }
.t-ln .paper { background: #fff; border-radius: 10px; box-shadow: 0 1px 2px rgba(0,0,0,.1); padding: 24px 26px; max-height: 680px; overflow: auto; border: 1px solid var(--border); }
.t-ln .tr { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 10px; padding: 6px 0; border-bottom: 1px dashed var(--border); font-size: 14.5px; line-height: 1.55; }
.t-ln .tr time { font: 600 12px var(--mono); color: var(--accent); padding-top: 3px; }
.t-ln .transcript { max-height: 560px; overflow: auto; }
.t-ln .opt-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
.t-ln .fileinfo { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13.5px; }
`

const FILLER = /\b(?:um+|uh+|er+m?|ah+|you know|i mean|sort of|kind of)\b[,.]?\s*/gi
const CUES = /\b(important|remember|note that|make sure|key (?:point|idea|thing)|exam|test|quiz|homework|assignment|deadline|don't forget|do not forget|will be asked|essential|crucial|must know|pay attention)\b/i
const tidy = (s) => s.replace(FILLER, '').replace(/\s+/g, ' ').replace(/^[\s,;]+/, '').replace(/\s+([,.;!?])/g, '$1').trim().replace(/^[a-z]/, (c) => c.toUpperCase())
const mmss = (s) => formatDuration(Math.max(0, s))

/** Group Whisper chunks into parts by time. -> [{start, end, text}] */
export function partsFromChunks(chunks, duration) {
  if (!chunks?.length) return []
  const n = Math.max(1, Math.min(8, Math.round((duration || chunks.at(-1).timestamp[1] || 0) / 180)))
  const total = duration || chunks.at(-1).timestamp[1] || 1
  const size = total / n
  const parts = Array.from({ length: n }, (_, i) => ({ start: i * size, end: (i + 1) * size, text: '' }))
  for (const c of chunks) {
    const t = c.timestamp[0] ?? 0
    const i = Math.min(n - 1, Math.floor(t / size))
    parts[i].text += ` ${c.text.trim()}`
  }
  return parts.filter((p) => p.text.trim())
}
/** A pasted transcript has no times: cut it into parts of about the same number of sentences. */
export function partsFromText(text) {
  const sents = splitSentences(text)
  const n = Math.max(1, Math.min(8, Math.round(sents.length / 7)))
  const per = Math.ceil(sents.length / n)
  return Array.from({ length: n }, (_, i) => ({ start: null, end: null, text: sents.slice(i * per, (i + 1) * per).map((s) => s.text).join(' ') })).filter((p) => p.text.trim())
}

/** Local notes in Markdown. src: {text, chunks?, duration?, title?} */
export function buildNotes({ text, chunks, duration, title = 'Lecture notes' }) {
  // speech recognition often leaves the first word of a sentence in lower case, which hides sentence boundaries
  const clean = text.replace(/\s+/g, ' ').trim().replace(/([a-z]{3,}[.!?])\s+([a-z])/g, (_, a, c) => `${a} ${c.toUpperCase()}`)
  const parts = chunks?.length ? partsFromChunks(chunks, duration) : partsFromText(text)
  const md = [`# ${title}`, '']
  if (duration) md.push(`*${mmss(duration)} lecture, ${formatNumber((clean.match(/\S+/g) || []).length, 0)} words spoken*`, '')
  const overview = summarize(clean, 4).map(tidy)
  if (overview.length) md.push('## Overview', '', ...overview.map((s) => `- ${s}`), '')
  if (parts.length > 1) {
    md.push('## Notes by section', '')
    parts.forEach((p, i) => {
      const pts = summarize(p.text, 3).map(tidy).filter((s) => s.length > 20)
      const terms = keyTerms(p.text, 4).filter((t) => t.kind !== 'word' || t.count >= 2).map((t) => t.term)
      md.push(`### Part ${i + 1}${p.start != null ? ` (${mmss(p.start)} to ${mmss(p.end)})` : ''}`, '', ...pts.map((s) => `- ${s}`))
      if (terms.length) md.push('', `*Key words: ${terms.join(', ')}*`)
      md.push('')
    })
  }
  const defs = extractDefinitions(clean).filter((d) => !d.low).slice(0, 12)
  if (defs.length) md.push('## Key terms', '', ...defs.map((d) => `- **${d.term}**: ${tidy(d.definition)}`), '')
  const stressed = splitSentences(clean).map((s) => s.text).filter((s) => CUES.test(s) && s.length < 260).slice(0, 8).map(tidy)
  if (stressed.length) md.push('## Things the lecturer stressed', '', ...stressed.map((s) => `- ${s}`), '')
  const qs = buildShort(clean, { max: 5 })
  if (qs.length) md.push('## Questions to test yourself', '', ...qs.map((q, i) => `${i + 1}. ${q.q}`), '')
  if (md.length < 6) md.push('*Not enough text to build notes. Try a longer recording or paste more of the transcript.*')
  return md.join('\n').replace(/\n{3,}/g, '\n\n')
}

export function mount(root) {
  toolStyle('ln', CSS)
  toolStyle('pgdoc', DOC_CSS)
  const prefs = { model: WHISPER_MODELS[0][0], lang: '', source: 'audio', ...load('ln:prefs', {}) }
  const sp = () => save('ln:prefs', prefs)
  const S = { file: null, transcript: null, notes: '', view: 'notes', duration: 0 }
  const prog = progress('Transcribing')
  const result = h('div')
  const fileInfo = h('div', { class: 'fileinfo' })
  const ac = new AbortController()
  onCleanup(() => ac.abort())

  const dz = dropzone({ accept: 'audio/*,video/*,.mp3,.wav,.m4a,.mp4,.webm,.ogg,.aac,.flac,.mkv,.mov', label: 'Add a lecture recording', hint: 'Audio or video. It is transcribed on your device and never uploaded.', onFiles: ([f]) => { S.file = f; clear(fileInfo, pill(f.name, '', 'file-audio'), pill(`${(f.size / 1048576).toFixed(1)} MB`)); go.disabled = false; clear(result) } })
  const pasteTa = h('textarea', { class: 'textarea', rows: 9, placeholder: 'Paste a transcript from Zoom, Meet, YouTube or your own notes. Notes are built from it right away.', 'aria-label': 'Transcript to turn into notes' })
  const modelSel = select(WHISPER_MODELS, prefs.model, (v) => { prefs.model = v; sp() })
  const langSel = select(WHISPER_LANGS, prefs.lang, (v) => { prefs.lang = v; sp() })
  const go = button('Transcribe and make notes', { variant: 'primary', size: 'lg', icon: 'audio-lines', disabled: true })

  const mdTa = h('textarea', { class: 'textarea md', spellcheck: true, 'aria-label': 'Notes in Markdown', placeholder: 'Your notes appear here as Markdown. Edit them freely.', oninput: () => { S.notes = mdTa.value; if (S.view === 'preview') drawPreview() } })
  const paper = h('div', { class: 'paper' })
  const trBox = h('div', { class: 'transcript' })
  const body = h('div')
  const statsRow = h('div', { class: 'row' })
  const viewSeg = segmented([['notes', 'Notes'], ['preview', 'Preview'], ['transcript', 'Transcript']], S.view, (v) => { S.view = v; showView() }, 'View')
  const aiOut = h('div')

  async function drawPreview() { clear(paper, h('div', { class: 'pgdoc', style: { '--pg-fs': '14px' }, html: await renderMarkdown(S.notes) })) }
  function drawTranscript() {
    const t = S.transcript
    if (!t) { clear(trBox, emptyState('audio-lines', 'No transcript yet', 'Transcribe a recording or paste a transcript to see it here.')); return }
    clear(trBox, t.chunks?.length ? t.chunks.map((c) => h('div', { class: 'tr' }, h('time', mmss(c.timestamp[0] || 0)), h('div', c.text.trim()))) : h('div', { class: 'tr', style: 'grid-template-columns:1fr' }, h('div', t.text)))
  }
  function showView() {
    viewSeg.set(S.view)
    const hasNotes = !!S.notes.trim()
    if (S.view === 'notes') { clear(body, mdTa); mdTa.value = S.notes }
    else if (S.view === 'preview') { clear(body, hasNotes ? paper : emptyState('notebook', 'Nothing to preview yet', 'Make notes first.')); if (hasNotes) drawPreview() }
    else { clear(body, trBox); drawTranscript() }
  }
  function setNotes(md) { S.notes = md; mdTa.value = md; showView(); clear(statsRow, S.transcript ? [pill(`${formatNumber((S.transcript.text.match(/\S+/g) || []).length, 0)} words`, '', 'text'), S.duration ? pill(mmss(S.duration), '', 'clock') : null] : null) }

  const titleOf = () => safeName(baseName(S.file?.name || 'lecture')).replace(/[-_]+/g, ' ')
  function localNotes() {
    if (!S.transcript) return
    setNotes(buildNotes({ text: S.transcript.text, chunks: S.transcript.chunks, duration: S.duration, title: `Notes: ${titleOf()}` }))
  }

  go.addEventListener('click', () => busy(go, async () => {
    clear(result); clear(aiOut)
    if (prefs.source === 'paste') {
      const text = pasteTa.value.trim()
      if (text.length < 80) throw new Error('Paste a longer transcript first (at least a few sentences).')
      S.transcript = { text, chunks: [] }; S.duration = 0
      S.file = null
      localNotes()
      S.view = 'notes'; showView()
      return
    }
    if (!S.file) throw new Error('Add a recording first.')
    const t = await transcribe(S.file, { model: prefs.model, language: prefs.lang, onProgress: (f, label) => prog.set(f, label) })
    S.transcript = t; S.duration = t.duration
    if (!t.text.trim()) { clear(result, alert('warn', 'No speech was found in that recording. Check the volume and the language setting.')); return }
    localNotes()
    S.view = 'notes'; showView()
    clear(result, alert('success', `Transcribed ${mmss(t.duration)} of audio. Local notes are ready; use "Write notes with AI" for a more polished version.`))
    confetti(go, { count: 40 })
  }, { label: 'Working', errorTo: result, progress: prog }))

  const aiBtn = button('Write notes with AI', { icon: 'sparkles', variant: 'secondary', onClick: () => busy(aiBtn, async () => {
    if (!S.transcript?.text) throw new Error('Transcribe a recording or paste a transcript first.')
    if (!(await ai.ensureKey())) return
    clear(aiOut)
    S.view = 'notes'; showView(); mdTa.value = ''
    const text = S.transcript.chunks?.length ? S.transcript.chunks.map((c) => `[${mmss(c.timestamp[0] || 0)}] ${c.text.trim()}`).join('\n') : S.transcript.text
    const md = await ai.ask({
      system: 'You turn lecture transcripts into excellent study notes. The transcript comes from speech recognition and may contain mistakes: fix obvious misrecognitions of technical terms, but never invent content that was not said. Write clear Markdown: a one-paragraph summary, then sections with short bullet points, bold key terms with one-line definitions, worked examples and formulas where mentioned (use $...$ for math), a "Likely exam points" list for anything the lecturer stressed, and 5 review questions at the end. Keep the language of the lecture.',
      prompt: `Make study notes from this lecture transcript.\n\n${text.slice(0, 90000)}`,
      effort: 'low', maxTokens: 12000,
      onText: (t) => { S.notes = t; mdTa.value = t },
      signal: ac.signal,
    })
    setNotes(md)
    clear(aiOut, alert('success', 'AI notes are ready. Compare with the transcript for anything important.'))
  }, { label: 'Writing notes', errorTo: aiOut }) })
  const localBtn = button('Local notes again', { icon: 'cpu', variant: 'ghost', onClick: () => { if (!S.transcript) return toast('Nothing to work from yet', 'error'); localNotes() } })

  const need = () => { if (!S.notes.trim()) { toast('Make notes first', 'error'); return false } return true }
  const exportRow = h('div', { class: 'stack' },
    h('div', { class: 'row' },
      button('Copy notes', { variant: 'primary', icon: 'copy', onClick: () => need() && copyText(S.notes) }),
      button('.md', { icon: 'file-code', onClick: () => need() && download(S.notes, `${titleOf()}-notes.md`, 'text/markdown') }),
      (() => { const b = button('PDF', { icon: 'file-down', onClick: () => need() && busy(b, async () => { const { blob } = await htmlToPdf(await renderMarkdown(S.notes), { size: 'a4', margin: 56, footer: { left: `Notes: ${titleOf()}`, right: (i, n) => `Page ${i} of ${n}` } }); download(blob, `${titleOf()}-notes.pdf`) }, 'Building') }); return b })(),
      button('Print', { icon: 'printer', onClick: async () => { if (need()) printDoc(await renderMarkdown(S.notes), { title: titleOf() }) } }),
      button('Transcript .txt', { icon: 'file-text', onClick: () => S.transcript ? download(S.transcript.chunks?.length ? S.transcript.chunks.map((c) => `[${mmss(c.timestamp[0] || 0)}] ${c.text.trim()}`).join('\n') : S.transcript.text, `${titleOf()}-transcript.txt`, 'text/plain') : toast('No transcript yet', 'error') }),
      button('Subtitles .srt', { icon: 'captions', onClick: () => (S.transcript?.chunks?.length ? download(toSRT(S.transcript.chunks), `${titleOf()}.srt`, 'text/plain') : toast('Subtitles need a transcribed recording', 'error')) })),
    h('div', { class: 'row' }, h('span', { class: 'stu-hint' }, 'Study with it:'),
      button('Flashcards', { size: 'sm', icon: 'layers', variant: 'secondary', onClick: () => need() && handoff('flashcards', S.transcript?.text || S.notes) }),
      button('Quiz', { size: 'sm', icon: 'list-checks', variant: 'secondary', onClick: () => need() && handoff('quiz-generator', S.transcript?.text || S.notes) }),
      button('Multiple choice', { size: 'sm', icon: 'circle-check', variant: 'secondary', onClick: () => need() && handoff('mcq-generator', S.transcript?.text || S.notes) })))

  const sourceSeg = segmented([['audio', 'Recording'], ['paste', 'Paste transcript']], prefs.source, (v) => { prefs.source = v; sp(); drawSource() }, 'Source')
  const srcBox = h('div', { class: 'stack' })
  function drawSource() {
    clear(srcBox, prefs.source === 'audio'
      ? [dz, fileInfo, h('div', { class: 'opt-grid' }, field('Speech model', modelSel, 'Downloaded once, then cached.'), field('Spoken language', langSel))]
      : [pasteTa])
    go.disabled = prefs.source === 'audio' ? !S.file : false
    const lbl = prefs.source === 'audio' ? 'Transcribe and make notes' : 'Make notes'
    go.querySelector('span').textContent = lbl
  }
  const left = h('div', { class: 'stack' },
    tile({ tint: TINTS[0], title: 'Your lecture', icon: 'audio-lines' }, h('div', { class: 'stack' }, h('div', { class: 'row' }, sourceSeg), srcBox, h('div', { class: 'row' }, go), prog.el)), result)
  const right = tile({ tint: TINTS[4], title: 'Notes', icon: 'notebook-pen', actions: statsRow },
    h('div', { class: 'stack' }, h('div', { class: 'row' }, viewSeg, aiBtn, localBtn), ai.notice('AI notes use Claude'), aiOut, body, exportRow))
  root.append(stage('t-ln', h('div', { class: 'stu-bento' }, h('div', { class: 's5', style: 'min-width:0' }, left), h('div', { class: 's7', style: 'min-width:0' }, right))))
  drawSource(); showView()
}
