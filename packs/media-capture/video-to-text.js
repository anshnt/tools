// Video / audio to transcript, and the Subtitle generator (params.mode === 'subtitles'): on-device Whisper.
// Pick a model, language and options, transcribe with real progress, then edit the text or the timed subtitle lines and export.
import { h, icon, button, alert, toast, progress, busy, dropzone, stats, tabs, textarea, toggle, copyButton, download, onCleanup, clear, formatBytes, formatDuration, isAbort } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { WHISPER_LANGS } from '../../lib/whisper.js'
import { baseName } from '../../lib/files.js'
import * as K from './_kit.js'
import * as T from './_transcribe.js'
import { cueEditor, mediaPlayer } from './_cues.js'
import { toSRT, toVTT, toPlain } from './_subs.js'

const ACCEPT = 'video/*,audio/*,.mp4,.m4v,.mov,.webm,.mkv,.avi,.flv,.wmv,.3gp,.mp3,.wav,.m4a,.aac,.ogg,.oga,.opus,.flac,.wma,.amr'
const LINE_OPTS = [['32', 'Narrow (32 characters)'], ['42', 'Standard (42)'], ['60', 'Wide (60)'], ['0', 'Whisper segments']]
const STEPS = [['audio-lines', 'Reading audio'], ['download', 'Loading model'], ['mic', 'Transcribing'], ['sparkles', 'Finishing up']]

export function mount(root, { params, signal }) {
  K.useStyle()
  const subMode = params?.mode === 'subtitles'
  const KEY = subMode ? 'mc:subgen' : 'mc:v2t'
  const prefs = { model: T.MODELS[1]?.id || T.MODELS[0].id, language: 'auto', translate: false, words: subMode, lineChars: '42', lines: '2', timestamps: false, paragraphs: true, ...load(KEY, {}) }
  if (!T.MODELS.some((m) => m.id === prefs.model)) prefs.model = T.MODELS[0].id
  if (!prefs.language) prefs.language = 'auto'
  const keep = () => save(KEY, prefs)

  let file = null
  let info = null // probe result: { url, duration, video, ... }
  let result = null
  let player = null
  let job = null
  let disposed = false
  let urlToRevoke = null

  // ---- input ----
  const zone = dropzone({
    accept: ACCEPT, label: subMode ? 'Drop a video or audio file to caption' : 'Drop a video or audio file to transcribe',
    hint: 'MP4, MOV, MKV, WebM, MP3, WAV, M4A and more. It stays on your device.', icon: 'file-audio', onFiles: ([f]) => setFile(f),
  })
  const fileHost = h('div')

  // ---- options ----
  const modelCards = T.MODELS.map((m) => K.optRadio({
    name: 'mc-model', value: m.id, icon: m.key === 'tiny' ? 'zap' : m.key === 'base' ? 'scale' : 'brain', title: `${m.name} · ${m.size}`, desc: m.note, checked: prefs.model === m.id, bars: m.bars,
    onSelect: (v) => { prefs.model = v; keep() },
  }))
  const langSel = K.optSelect({ icon: 'languages', title: 'Spoken language', desc: 'Auto-detect listens to the first 30 seconds', options: [['auto', 'Auto-detect'], ...WHISPER_LANGS.filter(([v]) => v)], value: prefs.language, onChange: (v) => { prefs.language = v; keep() } })
  const translate = K.optToggle({ icon: 'arrow-right-left', title: 'Translate to English', desc: 'Get English text from any language', checked: prefs.translate, onChange: (v) => { prefs.translate = v; keep() } })
  const words = K.optToggle({ icon: 'text-cursor-input', title: 'Word-level timing', desc: subMode ? 'Sharper subtitle timing (extra download)' : 'More exact SRT and VTT timing', checked: prefs.words, onChange: (v) => { prefs.words = v; keep() } })
  const tiles = [langSel, translate, words]
  const lineSel = K.optSelect({ icon: 'align-justify', title: 'Line length', options: LINE_OPTS, value: prefs.lineChars, onChange: (v) => { prefs.lineChars = v; keep() } })
  const linesSel = K.optSelect({ icon: 'rows-2', title: 'Lines per subtitle', options: [['1', 'One line'], ['2', 'Up to two lines']], value: prefs.lines, onChange: (v) => { prefs.lines = v; keep() } })
  if (subMode) tiles.push(lineSel, linesSel)
  const options = h('div', { class: 'stack tight' },
    h('div', { class: 'mc-models', role: 'radiogroup', 'aria-label': 'Speech model' }, modelCards),
    h('div', { class: 'mc-opts' }, tiles))

  const runBtn = button(subMode ? 'Generate subtitles' : 'Transcribe', { icon: subMode ? 'captions' : 'file-text', variant: 'primary', size: 'lg', disabled: true, onClick: () => run() })
  const hint = h('span', { class: 'small muted' }, 'Pick a file to begin. The speech model downloads the first time, then stays cached in your browser.')
  const actions = h('div', { class: 'row' }, runBtn, hint)
  const workHost = h('div')
  const resultHost = h('div', { 'aria-live': 'polite' })

  // ---- file card ----
  function renderFile() {
    if (!file) return clear(fileHost)
    const dur = info?.duration
    const big = file.size > T.LARGE_BYTES || (dur && dur > T.LONG_SECONDS)
    const tooBig = file.size > 500 * 1024 * 1024 || (dur && dur > 4 * 3600)
    clear(fileHost, h('div', { class: 'stack tight' },
      h('div', { class: 'mc-media' },
        h('div', { class: 'tile lg' }, icon(info?.video ? 'file-video' : 'file-audio')),
        h('div', { class: 'meta' },
          h('div', { class: 'name', title: file.name }, file.name),
          h('div', { class: 'sub' }, [formatBytes(file.size), info ? (dur ? formatDuration(dur) : 'length unknown') : 'reading...', info?.width ? `${info.width}x${info.height}` : null].filter(Boolean).join(' · '))),
        button('Remove', { icon: 'x', variant: 'ghost', size: 'sm', onClick: () => clearFile(), disabled: !!job })),
      tooBig ? alert('error', h('strong', 'This file is too large to process in the browser. '), 'Pull out the audio first with ', h('a', { class: 'link', href: '#/extract-audio', target: '_blank', rel: 'noopener' }, 'Extract audio from video'), ' (a low-bitrate MP3 is plenty), then transcribe that.')
        : big ? alert('warn', h('strong', 'This is a big one. '), 'It will go through the built-in video engine first (a one-time ~31 MB download) and can take several minutes. Keep this tab open and the screen awake.')
          : info?.unplayable ? alert('info', 'Your browser cannot preview this format, but it can still be transcribed using the built-in video engine.') : null))
    runBtn.disabled = !!job || tooBig
    zone.classList.add('compact')
  }

  async function setFile(f) {
    if (job) return toast('Wait for the current transcription to finish, or cancel it.', 'info')
    clearResult()
    releaseInfo()
    file = f
    info = null
    renderFile()
    hint.textContent = 'Choose a model and language, then start.'
    info = await T.probeMedia(f)
    if (disposed || file !== f) return releaseUrl(info)
    urlToRevoke = info.url
    renderFile()
  }
  const releaseUrl = (i) => { if (i?.url) URL.revokeObjectURL(i.url) }
  function releaseInfo() { if (urlToRevoke) { URL.revokeObjectURL(urlToRevoke); urlToRevoke = null } }
  function clearFile() {
    clearResult(); releaseInfo(); file = null; info = null
    clear(fileHost); runBtn.disabled = true; zone.classList.remove('compact')
    hint.textContent = 'Pick a file to begin. The speech model downloads the first time, then stays cached in your browser.'
  }
  function clearResult() {
    player?.dispose(); player = null; result = null
    clear(resultHost)
  }

  // ---- work card ----
  function workCard(ctl) {
    const prog = progress('Working')
    const status = h('p', 'Starting')
    const eta = h('span', { class: 'small muted' })
    const stepEls = STEPS.map(([ic, label]) => h('span', { class: 'mc-step' }, icon('loader'), label))
    const cancel = button('Cancel', { icon: 'x', variant: 'ghost', size: 'sm', onClick: () => { ctl.abort(); status.textContent = 'Stopping...'; cancel.disabled = true } })
    const el = h('div', { class: 'mc-work', role: 'status' },
      h('div', { class: 'mc-work-top' }, h('div', { class: 'mc-eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'), h('i')),
        h('div', { class: 'grow', style: 'flex:1;min-width:0' }, h('h3', subMode ? 'Listening and writing subtitles' : 'Listening and writing it down'), status), cancel),
      h('div', { class: 'mc-steps' }, stepEls), prog.el, h('div', { class: 'row between' }, eta, h('span', { class: 'small muted' }, 'Everything runs on this device.')))
    prog.set(null, 'Starting')
    let tStart = 0
    const mark = (i) => stepEls.forEach((el, k) => {
      el.className = `mc-step ${k < i ? 'done' : k === i ? 'now' : ''}`
      el.firstChild.replaceWith(icon(k < i ? 'check' : k === i ? 'loader' : STEPS[k][0]))
    })
    mark(0)
    return {
      el, prog,
      set(phase, fraction, label) {
        const i = phase === 'read' ? 0 : phase === 'model' ? 1 : phase === 'transcribe' ? 2 : 3
        mark(i)
        status.textContent = label || STEPS[i][1]
        if (phase === 'transcribe') {
          tStart ||= performance.now()
          prog.set(fraction > 0.001 ? fraction : null, label || 'Transcribing')
          if (fraction > 0.06) { const left = ((performance.now() - tStart) / fraction) * (1 - fraction) / 1000; eta.textContent = left > 3 ? `About ${formatDuration(left)} left` : 'Almost done' }
        } else prog.set(phase === 'model' || phase === 'read' ? fraction : null, label)
      },
    }
  }

  // ---- run ----
  async function run() {
    if (!file || job) return
    const ctl = new AbortController()
    job = ctl
    signal?.addEventListener('abort', () => ctl.abort(), { once: true })
    clearResult()
    zone.style.pointerEvents = 'none'
    renderFile()
    const wc = workCard(ctl)
    clear(workHost, wc.el)
    wc.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    await busy(runBtn, async () => {
      try {
        const { audio, duration } = await T.getAudio(file, { duration: info?.duration, signal: ctl.signal, onProgress: (f, l) => wc.set('read', f, l) })
        if (duration > 4 * 3600) throw new Error('That is longer than 4 hours. Split the file or extract a shorter section first.')
        if (ctl.signal.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
        let lang = prefs.language === 'auto' ? '' : prefs.language
        let langName = lang ? (WHISPER_LANGS.find(([v]) => v === lang)?.[1] || lang) : ''
        if (!lang) {
          wc.set('model', null, 'Detecting the spoken language')
          try {
            const code = await T.detectLanguage(audio, { onProgress: (f, l) => wc.set('model', f, l) })
            lang = code
            langName = T.languageName(code)
          } catch (e) {
            console.warn('Language detection failed', e)
            lang = 'en'
            langName = 'English'
            toast('Could not detect the language, so English is assumed. Pick the language yourself if that is wrong.', 'info', 7000)
          }
          if (ctl.signal.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
        }
        wc.set('model', null, 'Loading the speech model')
        const res = await T.transcribeAudio(audio, {
          model: prefs.model, language: lang, task: prefs.translate && lang !== 'en' && lang !== 'english' ? 'translate' : 'transcribe', words: prefs.words, signal: ctl.signal,
          onProgress: ({ phase, fraction, label }) => wc.set(phase, fraction, label),
        })
        wc.set('finish', null, 'Putting it together')
        if (disposed) return
        if (!res.segments.length) {
          clear(resultHost, alert('info', h('strong', 'No speech found. '), 'Check that the file has audible speech, or pick a larger model or the spoken language.'))
          return
        }
        const translated = prefs.translate && lang !== 'en' && lang !== 'english'
        result = { ...res, translated, languageName: translated ? `${langName} to English` : langName }
        showResult()
        if (prefs.words && !res.wordLevel) toast('Word-level timing was not available, so timings are estimated from the segments.', 'info', 7000)
      } catch (e) {
        if (isAbort(e)) { toast('Cancelled', 'info'); return }
        throw e
      }
    }, { label: 'Working', errorTo: resultHost })
    job = null
    zone.style.pointerEvents = ''
    clear(workHost)
    renderFile()
  }

  // ---- results ----
  function showResult() {
    const r = result
    const base = baseName(file.name)
    const cueEd = cueEditor({
      cues: T.makeCues(r, { lineChars: +prefs.lineChars, lines: +prefs.lines }),
      emptyText: 'No subtitle lines.',
      seek: info?.unplayable || !info?.url ? null : (t) => player?.play(t),
      onChange: (cues) => { player?.update(cues); },
    })
    if (info?.url && !info.unplayable) {
      player = mediaPlayer({ url: info.url, video: info.video, cues: cueEd.cues() })
      player.onTime((t) => cueEd.setTime(t))
    }
    const nWords = (r.segments.map((s) => s.text).join(' ').match(/\S+/g) || []).length
    const head = stats([
      { label: 'Words', value: nWords.toLocaleString(), accent: true },
      { label: 'Audio length', value: formatDuration(r.duration) },
      { label: 'Language', value: r.languageName || '-', hint: prefs.language === 'auto' ? 'detected' : 'chosen' },
      { label: subMode ? 'Subtitle lines' : 'Reading time', value: subMode ? String(cueEd.length) : `${Math.max(1, Math.round(nWords / 238))} min`, hint: r.wordLevel ? 'word-level timing' : 'phrase-level timing' },
    ])
    const fileBase = `${base}${r.translated ? '-en' : ''}`
    const srtBtn = button('SRT', { icon: 'download', variant: subMode ? 'primary' : 'secondary', size: 'sm', onClick: () => download(toSRT(cueEd.cues()), `${fileBase}.srt`, 'application/x-subrip') })
    const vttBtn = button('VTT', { icon: 'download', variant: 'secondary', size: 'sm', onClick: () => download(toVTT(cueEd.cues()), `${fileBase}.vtt`, 'text/vtt') })

    let body
    if (subMode) {
      const rebuild = button('Rebuild lines', { icon: 'refresh-cw', variant: 'secondary', size: 'sm', title: 'Re-split the speech with the line length chosen above. Replaces your edits.', onClick: () => { cueEd.set(T.makeCues(r, { lineChars: +prefs.lineChars, lines: +prefs.lines })); toast('Subtitle lines rebuilt', 'success') } })
      const txtBtn = button('TXT', { icon: 'download', variant: 'secondary', size: 'sm', onClick: () => download(toPlain(cueEd.cues(), { merge: true }), `${fileBase}.txt`, 'text/plain') })
      body = h('div', { class: 'stack' },
        player ? player.el : null,
        h('div', { class: 'mc-cue-tools' }, srtBtn, vttBtn, txtBtn, copyButton(() => toSRT(cueEd.cues()), 'Copy SRT'), rebuild, h('span', { class: 'grow', style: 'flex:1' }),
          button('Add line', { icon: 'plus', variant: 'ghost', size: 'sm', onClick: () => cueEd.add(player?.media.currentTime) })),
        cueEd.el,
        h('p', { class: 'small muted' }, 'Edit any text or time above. Want the subtitles inside the video file? Try ', h('a', { class: 'link', href: '#/add-subtitles', target: '_blank', rel: 'noopener' }, 'Add subtitles to video'), '.'))
    } else {
      let dirty = false
      const text = textarea({ rows: 16, 'aria-label': 'Transcript', spellcheck: true })
      const build = () => { text.value = T.toParagraphs(r.segments, { timestamps: prefs.timestamps, paragraphs: prefs.paragraphs }) }
      const tsT = toggle('Timestamps', prefs.timestamps, (v) => { prefs.timestamps = v; keep(); build() })
      const paraT = toggle('Paragraphs', prefs.paragraphs, (v) => { prefs.paragraphs = v; keep(); build() })
      const reset = button('Reset edits', { icon: 'rotate-ccw', variant: 'ghost', size: 'sm', attrs: { hidden: true }, onClick: () => { dirty = false; build(); sync() } })
      const sync = () => { reset.hidden = !dirty; tsT.input.disabled = paraT.input.disabled = dirty }
      text.addEventListener('input', () => { dirty = true; sync() })
      build()
      const txtBtn = button('TXT', { icon: 'download', variant: 'primary', size: 'sm', onClick: () => download(text.value, `${fileBase}.txt`, 'text/plain') })
      const transcriptTab = () => h('div', { class: 'stack' },
        h('div', { class: 'mc-cue-tools' }, copyButton(() => text.value, 'Copy text'), txtBtn, tsT, paraT, reset),
        text,
        h('p', { class: 'small muted' }, 'The text is yours to edit. Timestamps and paragraph options apply until you start typing.'))
      const timedTab = () => h('div', { class: 'stack' },
        player ? player.el : null,
        h('div', { class: 'mc-cue-tools' }, srtBtn, vttBtn, copyButton(() => toSRT(cueEd.cues()), 'Copy SRT')),
        cueEd.el,
        h('p', { class: 'small muted' }, 'Subtitle lines are built from the same speech. Edits here change the SRT and VTT files, not the transcript text.'))
      body = tabs([{ id: 'text', label: 'Transcript', render: transcriptTab }, { id: 'timed', label: 'Timed lines (SRT, VTT)', render: timedTab }], 'text')
    }
    clear(resultHost, h('div', { class: 'stack' }, alert('success', h('strong', 'Done. '), subMode ? 'Review the lines, fix any word, then download.' : 'Edit the text if you like, then copy or download it.'), head, body))
    resultHost.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  const cleanup = () => {
    disposed = true
    job?.abort()
    player?.dispose()
    releaseInfo()
  }
  signal?.addEventListener('abort', cleanup, { once: true })

  root.append(h('div', { class: 'mc stack' },
    zone, fileHost, options, actions, workHost, resultHost,
    h('p', { class: 'small muted' }, icon('shield-check'), ' Speech recognition (Whisper) runs on your device. The model downloads once, about 40 to 250 MB depending on the size you pick, and your audio is never uploaded. Accuracy depends on audio quality and accents, so read it over before you share it.')))
  return cleanup
}
