// Speech to text. Tab 1: live dictation with the browser's speech recognition. Tab 2: transcribe or translate an audio/video file or a
// recording with on-device Whisper (lib/whisper.js), with timestamps and TXT / SRT / VTT downloads. params.file opens the file tab first.
import { h, button, busy, alert, field, select, toggle, textarea, tabs, progress, stats, dropzone, clear, copyButton, download, formatDuration, formatBytes, formatNumber, toast, onCleanup, icon } from '../../lib/ui.js'
import { transcribe, toSRT, toVTT, WHISPER_MODELS, WHISPER_LANGS } from '../../lib/whisper.js'
import { baseName } from '../../lib/files.js'
import { toolRoot, addStyle, kicker, note, wave, celebrate, wordCount } from './_shared.js'
import { load, save } from '../../lib/store.js'

const DICTATION_LANGS = [
  ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['en-IN', 'English (India)'], ['en-AU', 'English (Australia)'], ['hi-IN', 'Hindi'], ['mr-IN', 'Marathi'], ['gu-IN', 'Gujarati'],
  ['bn-IN', 'Bengali'], ['ta-IN', 'Tamil'], ['te-IN', 'Telugu'], ['kn-IN', 'Kannada'], ['ml-IN', 'Malayalam'], ['pa-Guru-IN', 'Punjabi'], ['ur-IN', 'Urdu'],
  ['es-ES', 'Spanish (Spain)'], ['es-MX', 'Spanish (Mexico)'], ['fr-FR', 'French'], ['de-DE', 'German'], ['it-IT', 'Italian'], ['pt-BR', 'Portuguese (Brazil)'], ['pt-PT', 'Portuguese (Portugal)'],
  ['nl-NL', 'Dutch'], ['ru-RU', 'Russian'], ['uk-UA', 'Ukrainian'], ['pl-PL', 'Polish'], ['cs-CZ', 'Czech'], ['ro-RO', 'Romanian'], ['hu-HU', 'Hungarian'], ['el-GR', 'Greek'], ['tr-TR', 'Turkish'],
  ['sv-SE', 'Swedish'], ['da-DK', 'Danish'], ['nb-NO', 'Norwegian'], ['fi-FI', 'Finnish'], ['he-IL', 'Hebrew'], ['ar-SA', 'Arabic'], ['ja-JP', 'Japanese'], ['ko-KR', 'Korean'],
  ['cmn-Hans-CN', 'Chinese (Mandarin)'], ['zh-TW', 'Chinese (Taiwan)'], ['id-ID', 'Indonesian'], ['ms-MY', 'Malay'], ['vi-VN', 'Vietnamese'], ['th-TH', 'Thai'], ['fil-PH', 'Filipino'], ['sw-KE', 'Swahili'],
]

const COMMANDS = [
  [/[ \t]*\b(?:new paragraph)\b[.,]?[ \t]*/gi, '\n\n'], [/[ \t]*\b(?:new line|next line)\b[.,]?[ \t]*/gi, '\n'],
  [/[ \t]*\b(?:question mark)\b/gi, '?'], [/[ \t]*\b(?:exclamation (?:mark|point))\b/gi, '!'], [/[ \t]*\b(?:full stop|period)\b[.,]?/gi, '.'],
  [/[ \t]*\bsemi-?colon\b/gi, ';'], [/[ \t]*\bcolon\b/gi, ':'], [/[ \t]*\bcomma\b/gi, ','],
]
/** Turn spoken punctuation ("comma", "full stop", "new line") into the real thing. English only. */
export function applyCommands(text) {
  let t = text
  for (const [re, to] of COMMANDS) t = t.replace(re, to)
  return t.replace(/([,.;:?!])(?=[^\s\n,.;:?!)"'])/g, '$1 ').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n')
}

const CSS = `
.tw-s2t .tw-mic { width: 84px; height: 84px; }
.tw-s2t .tw-mic .icon { width: 34px; height: 34px; fill: none; stroke-width: 1.8; }
.tw-s2t .tw-hear { min-height: 24px; font-size: 14px; color: var(--muted); font-style: italic; overflow-wrap: anywhere; }
.tw-s2t .tw-seg-list { display: flex; flex-direction: column; gap: 4px; max-height: 420px; overflow: auto; padding: 4px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
.tw-s2t .tw-seg { display: grid; grid-template-columns: 62px minmax(0, 1fr); gap: 10px; align-items: start; text-align: left; padding: 8px 10px; border-radius: 10px; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 14.5px; line-height: 1.5; cursor: pointer; transition: background .2s; }
.tw-s2t .tw-seg:hover { background: var(--surface-2); }
.tw-s2t .tw-seg time { font: 600 12px var(--mono); color: var(--accent); padding-top: 3px; }
.tw-s2t .tw-seg.on { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.tw-s2t audio { width: 100%; height: 44px; }
.tw-s2t .tw-rec { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.tw-s2t .tw-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--danger); animation: tw-pulse 1.2s ease-out infinite; }
`

export function mount(root, { params, signal }) {
  addStyle('tw-s2t-css', CSS)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  const t = tabs([
    { id: 'live', label: 'Dictate live', render: () => liveTab() },
    { id: 'file', label: 'Transcribe a file or recording', render: () => fileTab() },
  ], params?.file ? 'file' : 'live')
  root.append(toolRoot('s2t', t))

  // ------------------------------------------------------------------ live dictation
  function liveTab() {
    const prefs = { lang: '', commands: true, ...load('stt-live', {}) }
    if (!prefs.lang) {
      const nav = navigator.language || 'en-US'
      prefs.lang = (DICTATION_LANGS.find(([c]) => c.toLowerCase() === nav.toLowerCase()) || DICTATION_LANGS.find(([c]) => c.split('-')[0] === nav.split('-')[0]) || DICTATION_LANGS[0])[0]
    }
    if (!SR) {
      return h('div', { class: 'stack' }, alert('warn', h('strong', 'Live dictation is not available in this browser. '), 'Chrome, Edge and Safari support it. You can still transcribe a recording or audio file on your device in the other tab.'),
        button('Open the file tab', { icon: 'file-audio', variant: 'primary', onClick: () => t.show('file') }))
    }
    const out = textarea({ rows: 11, placeholder: 'Press the microphone and start talking. Your words appear here, and you can edit them any time.', 'aria-label': 'Dictated text' })
    const hear = h('div', { class: 'tw-hear', 'aria-live': 'polite' })
    const wv = wave(13)
    const mic = h('button', { type: 'button', class: 'tw-play tw-mic', 'aria-label': 'Start dictation', onclick: () => (on ? stop() : start()) }, icon('mic'))
    const status = h('div', { class: 'tw-sub', 'aria-live': 'polite' }, 'Ready when you are.')
    const langSel = select(DICTATION_LANGS, prefs.lang, (v) => { prefs.lang = v; save('stt-live', prefs); cmdTog.hidden = !/^en/i.test(v); if (on) { stop(); setTimeout(start, 300) } })
    const cmdTog = toggle('Spoken punctuation: say "comma", "full stop", "new line"', prefs.commands, (v) => { prefs.commands = v; save('stt-live', prefs) })
    cmdTog.hidden = !/^en/i.test(prefs.lang)
    let rec = null, on = false, wantOn = false, retry = 0

    const insert = (text) => {
      const v = out.value
      const atCaret = document.activeElement === out
      const a = atCaret ? out.selectionStart : v.length, b = atCaret ? out.selectionEnd : v.length
      const before = v.slice(0, a), after = v.slice(b)
      let s = prefs.commands && /^en/i.test(prefs.lang) ? applyCommands(text) : text
      s = s.trim()
      if (!s) return
      if (!before || /[.!?]\s*$|\n\s*$/.test(before)) s = s.charAt(0).toUpperCase() + s.slice(1)
      const sep = !before || /\s$/.test(before) || /^[,.;:?!\n]/.test(s) ? '' : ' '
      const ins = sep + s + (after && !/^\s/.test(after) ? ' ' : '')
      out.value = before + ins + after
      const pos = (before + ins).length
      out.setSelectionRange(pos, pos)
      out.scrollTop = out.scrollHeight
      count()
    }
    const count = () => { counter.textContent = `${formatNumber(wordCount(out.value), 0)} words` }
    const counter = h('span', { class: 'tw-count' })

    function setUi(listening) {
      on = listening
      mic.classList.toggle('live', listening)
      mic.setAttribute('aria-label', listening ? 'Stop dictation' : 'Start dictation')
      mic.replaceChildren(icon(listening ? 'square' : 'mic'))
      mic.firstChild.style.fill = listening ? 'currentColor' : 'none'
      wv.set(listening)
      clear(status, listening ? 'Listening... speak naturally. Press the button to stop.' : 'Ready when you are.')
      if (!listening) clear(hear)
    }
    function start() {
      wantOn = true
      rec = new SR()
      rec.lang = prefs.lang
      rec.continuous = true
      rec.interimResults = true
      rec.maxAlternatives = 1
      rec.onstart = () => { retry = 0; setUi(true) }
      rec.onresult = (e) => {
        let interim = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]
          if (r.isFinal) insert(r[0].transcript)
          else interim += r[0].transcript
        }
        hear.textContent = interim
      }
      rec.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return
        wantOn = false
        const msg = {
          'not-allowed': 'Microphone access was blocked. Allow the microphone for this site in the address bar, then try again.',
          'service-not-allowed': 'This browser blocked its speech service. Check the browser settings and try again.',
          'audio-capture': 'No microphone was found. Plug one in or check your system sound settings.',
          network: 'The speech service could not be reached. Check your internet connection.',
          'language-not-supported': 'This browser does not support dictation in that language. Pick another language.',
        }[e.error] || `Dictation stopped (${e.error}).`
        toast(msg, 'error')
        setUi(false)
      }
      rec.onend = () => {
        if (wantOn && retry < 30) { retry++; setTimeout(() => { if (wantOn) { try { rec.start() } catch { /* already started */ } } }, 250) } else setUi(false)
      }
      try { rec.start() } catch (e) { toast('Could not start the microphone.', 'error'); setUi(false) }
    }
    function stop() {
      wantOn = false
      try { rec?.stop() } catch { /* not running */ }
      setUi(false)
    }
    out.addEventListener('input', count)
    onCleanup(() => { wantOn = false; try { rec?.abort() } catch { /* ignore */ } })
    signal?.addEventListener('abort', () => { wantOn = false; try { rec?.abort() } catch { /* ignore */ } })
    count()
    return h('div', { class: 'stack' },
      h('section', { class: 'tw-stage' }, h('div', { class: 'stack' },
        h('div', { class: 'tw-head' }, kicker('Live dictation', 'mic'), field('', langSel)),
        h('div', { class: 'row', style: 'gap:18px' }, mic, h('div', { class: 'stack tight', style: 'flex:1; min-width:150px' }, wv.el, status)),
        hear, out,
        h('div', { class: 'tw-bar' }, copyButton(() => out.value, 'Copy'), button('Download .txt', { icon: 'download', size: 'sm', variant: 'secondary', onClick: () => out.value.trim() ? download(new Blob([out.value], { type: 'text/plain;charset=utf-8' }), 'dictation.txt') : toast('Nothing to download yet', 'error') }),
          button('Clear', { icon: 'eraser', size: 'sm', variant: 'ghost', onClick: () => { out.value = ''; count() } }), h('span', { class: 'grow' }), counter),
        cmdTog)),
      note('Live dictation uses the speech recognition built into your browser. In Chrome and Edge your voice is sent to Google or Microsoft servers to be turned into text, so use the file tab (fully on-device) for anything private.', 'cloud'))
  }

  // ------------------------------------------------------------------ file / recording with Whisper
  function fileTab() {
    const prefs = { model: WHISPER_MODELS[1][0], language: '', task: 'transcribe', ...load('stt-file', {}) }
    const s = { file: null, url: null, result: null, rec: null, stream: null, timer: 0, secs: 0, shownTs: true }
    const result = h('div')
    const prog = progress('Preparing')
    const playerBox = h('div')
    const fileInfo = h('div')
    const zone = dropzone({ accept: 'audio/*,video/*,.mp3,.m4a,.wav,.ogg,.opus,.webm,.mp4,.mov,.mkv,.aac,.flac,.amr,.3gp', label: 'Drop an audio or video file here', hint: 'MP3, M4A, WAV, OGG, MP4, WebM... · or paste with Ctrl+V', onFiles: ([f]) => setFile(f) })
    const modelSel = select(WHISPER_MODELS, prefs.model, (v) => { prefs.model = v; save('stt-file', prefs) })
    const langSel = select(WHISPER_LANGS, prefs.language, (v) => { prefs.language = v; save('stt-file', prefs) })
    const taskSel = select([['transcribe', 'Transcribe (same language)'], ['translate', 'Translate to English']], prefs.task, (v) => { prefs.task = v; save('stt-file', prefs) })
    const go = button('Transcribe', { icon: 'captions', variant: 'primary', size: 'lg', disabled: true })
    const recBtn = button('Record a voice note', { icon: 'mic', variant: 'secondary' })
    const recInfo = h('div', { class: 'tw-rec', hidden: true })
    const wv = wave(9)

    function setFile(f) {
      s.file = f
      if (s.url) URL.revokeObjectURL(s.url)
      s.url = URL.createObjectURL(f)
      go.disabled = false
      clear(result)
      clear(fileInfo, h('div', { class: 'tw-sub' }, `${f.name} · ${formatBytes(f.size)}`))
      clear(playerBox, h('audio', { controls: true, src: s.url, 'aria-label': 'Selected audio' }))
      if (f.size > 300 * 1024 * 1024) toast('This is a very large file. Decoding may fail or take a long time; try a shorter clip.', 'info')
    }

    async function startRec() {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { toast('Recording is not supported in this browser. Choose a file instead.', 'error'); return }
      try {
        s.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (e) {
        toast(e.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in the address bar and try again.' : 'No microphone could be opened.', 'error')
        return
      }
      const chunks = []
      const mr = new MediaRecorder(s.stream)
      s.rec = mr
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      mr.onstop = () => {
        s.stream?.getTracks().forEach((tr) => tr.stop())
        s.stream = null
        clearInterval(s.timer)
        wv.set(false)
        recInfo.hidden = true
        recBtn.replaceChildren(icon('mic'), h('span', 'Record a voice note'))
        const type = mr.mimeType || 'audio/webm'
        if (chunks.length) setFile(new File(chunks, `voice-note.${/ogg/.test(type) ? 'ogg' : /mp4/.test(type) ? 'm4a' : 'webm'}`, { type }))
      }
      mr.start()
      s.secs = 0
      recInfo.hidden = false
      clear(recInfo, h('span', { class: 'tw-dot' }), wv.el, h('b', { class: 'tw-count' }, '0:00'), h('span', { class: 'tw-sub' }, 'Recording... press stop when you are done.'))
      wv.set(true)
      s.timer = setInterval(() => { s.secs++; recInfo.querySelector('b').textContent = formatDuration(s.secs) }, 1000)
      recBtn.replaceChildren(icon('square'), h('span', 'Stop recording'))
    }
    recBtn.addEventListener('click', () => (s.rec?.state === 'recording' ? s.rec.stop() : startRec()))
    onCleanup(() => { clearInterval(s.timer); s.stream?.getTracks().forEach((tr) => tr.stop()); if (s.url) URL.revokeObjectURL(s.url) })

    const fmt = (sec) => formatDuration(sec || 0)
    const textOf = (r, ts) => (ts ? r.chunks.map((c) => `[${fmt(c.timestamp[0])}] ${c.text.trim()}`).join('\n') : r.text)

    function showResult(r, took) {
      const list = h('div', { class: 'tw-seg-list', role: 'list' })
      const segs = r.chunks.map((c) => {
        const b = h('button', { type: 'button', class: 'tw-seg', role: 'listitem', title: 'Jump to this moment', onclick: () => { const a = playerBox.querySelector('audio'); if (a) { a.currentTime = c.timestamp[0] || 0; a.play().catch(() => {}) } } },
          h('time', fmt(c.timestamp[0])), h('span', c.text.trim()))
        b._c = c
        list.append(b)
        return b
      })
      const a = playerBox.querySelector('audio')
      if (a) a.ontimeupdate = () => { for (const b of segs) b.classList.toggle('on', a.currentTime >= b._c.timestamp[0] && a.currentTime < (b._c.timestamp[1] ?? b._c.timestamp[0] + 5)) }
      const ts = toggle('Show timestamps in text', true, (v) => { box.value = textOf(r, v); s.shownTs = v })
      const box = textarea({ rows: 8, readonly: false, value: textOf(r, true), 'aria-label': 'Transcript text' })
      const name = baseName(s.file.name)
      const host = h('div', { class: 'stack tw-result-in', style: 'position:relative' },
        stats([{ label: 'Audio length', value: fmt(r.duration), accent: true }, { label: 'Words', value: formatNumber(wordCount(r.text), 0) }, { label: 'Segments', value: formatNumber(r.chunks.length, 0) }, { label: 'Took', value: formatDuration(took) }]),
        h('section', { class: 'tw-stage' }, h('div', { class: 'stack' }, kicker('Transcript', 'captions'), r.chunks.length ? list : null, ts, box,
          h('div', { class: 'tw-bar' }, copyButton(() => box.value, 'Copy'),
            button('.txt', { icon: 'download', size: 'sm', variant: 'secondary', onClick: () => download(new Blob([box.value], { type: 'text/plain;charset=utf-8' }), `${name}.txt`) }),
            button('.srt', { icon: 'download', size: 'sm', variant: 'secondary', onClick: () => download(new Blob([toSRT(r.chunks)], { type: 'application/x-subrip' }), `${name}.srt`) }),
            button('.vtt', { icon: 'download', size: 'sm', variant: 'secondary', onClick: () => download(new Blob([toVTT(r.chunks)], { type: 'text/vtt' }), `${name}.vtt`) })))))
      clear(result, host)
      celebrate(host)
    }

    go.addEventListener('click', () => busy(go, async () => {
      if (!s.file) throw new Error('Choose or record some audio first.')
      clear(result)
      const t0 = performance.now()
      const r = await transcribe(s.file, {
        model: prefs.model, language: prefs.language, task: prefs.task, timestamps: true,
        onProgress: (f, label) => prog.set(f, label),
      })
      if (!r.text) { clear(result, alert('warn', 'No speech was detected in this file.')); return }
      if (!r.chunks.length) r.chunks = [{ timestamp: [0, r.duration], text: r.text }]
      s.result = r
      showResult(r, (performance.now() - t0) / 1000)
    }, { label: 'Transcribing', errorTo: result, progress: prog }))

    return h('div', { class: 'stack' },
      h('div', { class: 'tool-split' },
        h('div', { class: 'stack' }, zone, h('div', { class: 'tw-stage' }, h('div', { class: 'stack' }, kicker('Or record', 'mic'), h('div', { class: 'row' }, recBtn), recInfo)), fileInfo, playerBox),
        h('section', { class: 'tw-stage' }, h('div', { class: 'stack' }, kicker('Options', 'sliders-horizontal'), field('Accuracy', modelSel, 'Larger models are more accurate but download and run slower.'),
          field('Spoken language', langSel, 'Auto-detect works for most clips; pick the language for better results.'), field('Task', taskSel), go))),
      prog.el, result,
      note('Runs entirely on your device with the open Whisper model. The model (40 to 250 MB) downloads once and is cached. Nothing you upload leaves your computer.', 'shield-check'))
  }
}
