// Text to speech with the browser's own voices (Web Speech API): voice and language pickers, rate, pitch, volume,
// word-by-word highlighting, pause and resume, click a word to start from there. params.hq switches to natural on-device voices (Kokoro).
import { h, button, alert, field, rangeField, clear, toast, icon, onCleanup, debounce } from '../../lib/ui.js'
import { toolRoot, addStyle, textInput, chips, kicker, note, wave, SAMPLE_ARTICLE } from './_shared.js'
import { mount as mountNatural } from './_tts-natural.js'
import { load, save } from '../../lib/store.js'

const CSS = `
.tw-tts .tw-reader .cur { background: color-mix(in srgb, var(--accent) 14%, transparent); border-radius: 6px; }
.tw-tts .tw-trk { height: 6px; border-radius: 99px; background: var(--surface-3); overflow: hidden; }
.tw-tts .tw-trk i { display: block; height: 100%; width: 0; border-radius: inherit; background: var(--brand); transition: width .25s linear; }
.tw-tts .tw-ctl { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.tw-tts .tw-status { font-size: 13px; color: var(--muted); min-width: 0; flex: 1; overflow-wrap: anywhere; }
.tw-tts .tw-status b { color: var(--text); font-weight: 600; }
.tw-tts .tw-badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 99px; border: 1px solid var(--border); color: var(--muted); }
`

/** Split text[from..] into speakable chunks (about 200 characters, on sentence ends where possible). Returns [{start, end}]. */
export function chunkRanges(text, from = 0, max = 200) {
  const out = []
  let p = from
  while (p < text.length) {
    let end = Math.min(p + max, text.length)
    if (end < text.length) {
      const win = text.slice(p, end)
      let cut = -1
      for (const m of win.matchAll(/[.!?।。！？]["')\]”]*(?=\s)|\n/g)) if (m.index + m[0].length > max * 0.35) cut = m.index + m[0].length
      if (cut < 0) { const sp = Math.max(win.lastIndexOf(' '), win.lastIndexOf('\n')); cut = sp > 0 ? sp + 1 : win.length }
      end = p + cut
    }
    const lead = text.slice(p, end).search(/\S/)
    if (lead >= 0) out.push({ start: p + lead, end })
    p = end
  }
  return out
}

const langLabel = (code) => {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code.replace('_', '-')) || code } catch { return code }
}

export function mount(root, ctx) {
  addStyle('tw-tts-css', CSS)
  if (ctx.params?.hq) return mountNatural(root, ctx)
  const synth = window.speechSynthesis
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
    root.append(toolRoot('tts', alert('warn', h('strong', 'This browser cannot read text aloud. '), 'Try Chrome, Edge or Safari, or use the natural voices tool, which generates the audio itself: ',
      h('a', { class: 'link', href: '#/text-to-voice' }, 'Text to voice'), '.')))
    return
  }
  const prefs = { voiceURI: '', lang: '', rate: 1, pitch: 1, volume: 1, ...load('tts-browser', {}) }
  const st = { state: 'idle', session: 0, text: '', chunks: [], spans: [], cur: -1, pos: 0, word: 0, voices: [], keep: null, timer: 0 }
  const persist = () => save('tts-browser', prefs)

  // ---- input and reader
  const inp = textInput({ rows: 11, placeholder: 'Type or paste the text to read aloud, or open a .txt, .docx or .pdf file...', sample: SAMPLE_ARTICLE.split('\n\n').slice(0, 2).join('\n\n'), label: 'Text to read aloud', onInput: () => { idleStatus() } })
  const reader = h('div', { class: 'tw-reader', tabindex: 0, role: 'textbox', 'aria-readonly': 'true', 'aria-label': 'Reading view. Click a word to start from there.', hidden: true })
  const editBtn = button('Stop and edit', { icon: 'pencil', size: 'sm', variant: 'secondary', onClick: () => { stopAll(); inp.focus() } })
  const readerBox = h('div', { class: 'stack', hidden: true }, reader, h('div', { class: 'tw-bar' }, editBtn, h('span', { class: 'tw-sub' }, 'Click any word to jump there.')))
  const inputBox = h('div', inp.el)

  // ---- controls
  const playBtn = h('button', { type: 'button', class: 'tw-play', 'aria-label': 'Read aloud', onclick: () => toggle() }, icon('play'))
  const stopBtn = button('', { icon: 'square', variant: 'secondary', ariaLabel: 'Stop', disabled: true, onClick: () => stopAll() })
  const status = h('div', { class: 'tw-status', 'aria-live': 'polite' })
  const wv = wave(9)
  const trkBar = h('i')
  const trk = h('div', { class: 'tw-trk', role: 'progressbar', 'aria-label': 'Reading progress', 'aria-valuemin': 0, 'aria-valuemax': 100 }, trkBar)

  // ---- voice panel
  const langSel = h('select', { class: 'select', 'aria-label': 'Language', onchange: (e) => { prefs.lang = e.target.value; persist(); fillVoices() } })
  const voiceSel = h('select', { class: 'select', 'aria-label': 'Voice', onchange: (e) => { prefs.voiceURI = e.target.value; persist(); voiceNote(); restartIfSpeaking() } })
  const voiceInfo = h('div', { class: 'tw-sub' })
  const rate = rangeField('Speed', { min: 0.5, max: 2, step: 0.05, value: prefs.rate, format: (v) => `${v.toFixed(2)}x`, onInput: (v) => { prefs.rate = v; speedChips.set(v); persist(); restartIfSpeaking() } })
  const pitch = rangeField('Pitch', { min: 0, max: 2, step: 0.1, value: prefs.pitch, format: (v) => v.toFixed(1), onInput: (v) => { prefs.pitch = v; persist(); restartIfSpeaking() } })
  const volume = rangeField('Volume', { min: 0, max: 1, step: 0.05, value: prefs.volume, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { prefs.volume = v; persist(); restartIfSpeaking() } })
  const speedChips = chips([[0.75, '0.75x'], [1, '1x'], [1.25, '1.25x'], [1.5, '1.5x'], [2, '2x']], prefs.rate, (v) => { prefs.rate = v; rate.set(v); persist(); restartIfSpeaking() }, { ariaLabel: 'Speed presets' })
  const preview = button('Hear this voice', { icon: 'volume-2', size: 'sm', variant: 'secondary', onClick: () => previewVoice() })

  const currentVoice = () => st.voices.find((v) => v.voiceURI === prefs.voiceURI) || null

  function fillVoices() {
    const all = st.voices
    const langs = [...new Set(all.map((v) => v.lang.replace('_', '-').split('-')[0].toLowerCase()))].sort((a, b) => langLabel(a).localeCompare(langLabel(b)))
    clear(langSel, h('option', { value: '' }, `All languages (${langs.length})`), langs.map((l) => h('option', { value: l, selected: prefs.lang === l }, langLabel(l))))
    langSel.value = langs.includes(prefs.lang) ? prefs.lang : ''
    if (!langs.includes(prefs.lang)) prefs.lang = ''
    const shown = all.filter((v) => !prefs.lang || v.lang.toLowerCase().startsWith(prefs.lang))
    if (!shown.some((v) => v.voiceURI === prefs.voiceURI)) {
      const nav = (navigator.language || 'en').toLowerCase()
      prefs.voiceURI = (shown.find((v) => v.lang.toLowerCase() === nav && v.localService) || shown.find((v) => v.lang.toLowerCase().startsWith(nav.split('-')[0])) || shown.find((v) => v.default) || shown[0])?.voiceURI || ''
    }
    const groups = new Map()
    for (const v of shown) {
      const k = langLabel(v.lang)
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k).push(v)
    }
    clear(voiceSel, [...groups].sort((a, b) => a[0].localeCompare(b[0])).map(([k, list]) => h('optgroup', { label: k }, list.map((v) => h('option', { value: v.voiceURI, selected: v.voiceURI === prefs.voiceURI },
      `${v.name.replace(/^Microsoft |^Google /, '')}${v.localService ? '' : ' (online)'}`)))))
    voiceSel.value = prefs.voiceURI
    voiceSel.disabled = !shown.length
    voiceNote()
  }
  function voiceNote() {
    const v = currentVoice()
    clear(voiceInfo, !st.voices.length ? 'Looking for voices on this device...' : !v ? 'No voice selected.' :
      v.localService ? `${v.name} runs on this device.` : `${v.name} is streamed from an online service, so the text you read is sent to the browser vendor.`)
  }
  let tries = 0
  function loadVoices() {
    st.voices = synth.getVoices().slice().sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name))
    if (st.voices.length || tries++ > 12) { fillVoices(); if (!st.voices.length) clear(voiceInfo, 'This browser reports no voices. Install a system voice or try another browser.') } else setTimeout(loadVoices, 250)
  }
  synth.addEventListener?.('voiceschanged', () => { st.voices = synth.getVoices().slice().sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name)); fillVoices() })
  loadVoices()

  // ---- speaking
  const wordsLeft = (from) => (st.text.slice(from).match(/\S+/g) || []).length
  const eta = (from) => { const s = wordsLeft(from) / (170 * prefs.rate) * 60; return s < 60 ? `${Math.max(1, Math.round(s))} sec` : `${Math.round(s / 6) / 10} min` }
  function setState(s) {
    st.state = s
    playBtn.classList.toggle('live', s === 'speaking')
    playBtn.replaceChildren(icon(s === 'speaking' ? 'pause' : 'play'))
    playBtn.setAttribute('aria-label', s === 'speaking' ? 'Pause' : s === 'paused' ? 'Resume' : 'Read aloud')
    stopBtn.disabled = s === 'idle'
    wv.set(s === 'speaking')
    inputBox.hidden = s !== 'idle'
    readerBox.hidden = s === 'idle'
    reader.hidden = s === 'idle'
  }
  function idleStatus() {
    const t = inp.get()
    clear(status, t.trim() ? h('span', 'Ready: ', h('b', `${(t.match(/\S+/g) || []).length.toLocaleString()} words`), ` · about ${eta0(t)} at ${prefs.rate.toFixed(2)}x`) : 'Type or paste something, then press play.')
  }
  const eta0 = (t) => { const s = ((t.match(/\S+/g) || []).length / (170 * prefs.rate)) * 60; return s < 60 ? `${Math.max(1, Math.round(s))} sec` : `${Math.round(s / 6) / 10} min` }

  function buildReader() {
    reader.replaceChildren()
    st.spans = []
    let pos = 0
    st.chunks.forEach((c) => {
      if (c.start > pos) reader.append(st.text.slice(pos, c.start))
      const sp = h('span', st.text.slice(c.start, c.end))
      st.spans.push(sp)
      reader.append(sp)
      pos = c.end
    })
    if (pos < st.text.length) reader.append(st.text.slice(pos))
    st.cur = -1
  }
  const chunkAt = (i) => { const k = st.chunks.findIndex((c) => c.end > i); return k < 0 ? st.chunks.length - 1 : k }
  function resetChunk(i) { const c = st.chunks[i]; if (c && st.spans[i]) { st.spans[i].replaceChildren(st.text.slice(c.start, c.end)); st.spans[i].classList.remove('cur') } }
  function mark(gi, len) {
    const i = chunkAt(gi)
    if (i !== st.cur) {
      if (st.cur >= 0) resetChunk(st.cur)
      st.spans.forEach((s, k) => s.classList.toggle('done', k < i))
      st.cur = i
    }
    const c = st.chunks[i]
    const word = len || (/^\S+/.exec(st.text.slice(gi)) || [''])[0].length || 1
    const a = Math.max(c.start, gi) - c.start, b = Math.min(c.end, gi + word) - c.start
    const sp = st.spans[i]
    const m = h('mark', st.text.slice(c.start + a, c.start + b))
    sp.classList.remove('cur')
    sp.replaceChildren(st.text.slice(c.start, c.start + a), m, st.text.slice(c.start + b, c.end))
    const top = m.offsetTop - reader.offsetTop
    if (top < reader.scrollTop + 20 || top > reader.scrollTop + reader.clientHeight - 60) reader.scrollTop = Math.max(0, top - reader.clientHeight / 3)
    st.word = gi
    progressTo(gi)
  }
  function progressTo(i) {
    const f = st.text.length ? i / st.text.length : 0
    trkBar.style.width = `${Math.round(f * 100)}%`
    trk.setAttribute('aria-valuenow', Math.round(f * 100))
    if (st.state === 'speaking') clear(status, h('span', 'Reading ', h('b', `${Math.round(f * 100)}%`), ` · about ${eta(i)} left`))
  }

  function speakFrom(pos) {
    const sid = ++st.session
    synth.cancel()
    window.clearTimeout(st.timer)
    pos = Math.max(0, Math.min(pos, st.text.length - 1))
    let i = chunkAt(pos)
    setState('speaking')
    const v = currentVoice()
    const next = () => {
      if (sid !== st.session) return
      if (i >= st.chunks.length) return finish()
      const c = st.chunks[i]
      const start = Math.max(c.start, pos)
      pos = 0
      const u = new SpeechSynthesisUtterance(st.text.slice(start, c.end))
      if (v) { u.voice = v; u.lang = v.lang }
      u.rate = prefs.rate; u.pitch = prefs.pitch; u.volume = prefs.volume
      let sawBoundary = false
      u.onstart = () => {
        if (sid !== st.session) return
        if (st.cur !== i) { if (st.cur >= 0) resetChunk(st.cur); st.spans.forEach((s, k) => s.classList.toggle('done', k < i)); st.cur = i }
        if (!sawBoundary) { st.spans[i].classList.add('cur'); st.word = start; progressTo(start) }
      }
      u.onboundary = (e) => {
        if (sid !== st.session || (e.name && e.name !== 'word')) return
        sawBoundary = true
        mark(start + e.charIndex, e.charLength)
      }
      u.onend = () => { if (sid !== st.session) return; i++; next() }
      u.onerror = (e) => {
        if (sid !== st.session || e.error === 'canceled' || e.error === 'interrupted') return
        stopAll()
        toast(e.error === 'not-allowed' ? 'The browser blocked speech. Click play again.' : `Could not read aloud (${e.error || 'unknown error'}).`, 'error')
      }
      st.keep = u // keep a reference: Chrome can garbage collect a running utterance and drop its events
      synth.speak(u)
    }
    st.timer = window.setTimeout(next, 60)
  }
  function finish() {
    st.session++
    trkBar.style.width = '100%'
    setState('idle')
    clear(status, h('span', h('b', 'Finished.'), ' Press play to hear it again.'))
    trkBar.style.width = '0%'
  }
  function stopAll() {
    st.session++
    window.clearTimeout(st.timer)
    synth.cancel()
    setState('idle')
    trkBar.style.width = '0%'
    idleStatus()
  }
  function begin(from = 0) {
    const ta = inp.ta
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd)
    st.text = sel.trim().length > 1 && from === 0 && st.state === 'idle' ? sel : ta.value
    if (!st.text.trim()) { toast('Type or paste some text first.', 'error'); ta.focus(); return }
    if (st.text !== ta.value) toast('Reading the selected text only', 'info')
    st.chunks = chunkRanges(st.text)
    buildReader()
    speakFrom(from)
  }
  function toggle() {
    if (st.state === 'idle') begin(0)
    else if (st.state === 'speaking') {
      st.session++
      window.clearTimeout(st.timer)
      synth.cancel()
      st.cur >= 0 && st.spans[st.cur]?.classList.remove('cur')
      setState('paused')
      wv.set(false)
      clear(status, h('span', h('b', 'Paused.'), ' Press play to continue from this word.'))
    } else speakFrom(st.word)
  }
  const restartIfSpeaking = debounce(() => { if (st.state === 'speaking') speakFrom(st.word) }, 250)
  function previewVoice() {
    const v = currentVoice()
    if (st.state !== 'idle') stopAll()
    const sid = ++st.session
    synth.cancel()
    const u = new SpeechSynthesisUtterance(/^en/i.test(v?.lang || 'en') ? `Hello, this is ${v?.name.replace(/^Microsoft |^Google /, '').replace(/ Online.*| \(.*/, '') || 'your voice'}.` : (inp.get().trim().slice(0, 80) || 'Hello'))
    if (v) { u.voice = v; u.lang = v.lang }
    u.rate = prefs.rate; u.pitch = prefs.pitch; u.volume = prefs.volume
    u.onend = u.onerror = () => { void sid }
    st.keep = u
    window.setTimeout(() => synth.speak(u), 60)
  }

  // click a word in the reading view to jump there
  reader.addEventListener('click', (e) => {
    if (st.state === 'idle') return
    let node, off
    if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(e.clientX, e.clientY); node = p?.offsetNode; off = p?.offset } else if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(e.clientX, e.clientY); node = r?.startContainer; off = r?.startOffset }
    if (!node) return
    const sp = node.nodeType === 3 ? node.parentElement?.closest('span') || node.parentElement : node.closest?.('span')
    const k = st.spans.indexOf(sp?.tagName === 'MARK' ? sp.parentElement : sp)
    if (k < 0) return
    let inside = off
    for (let s = node.previousSibling; s; s = s.previousSibling) inside += s.textContent.length
    if (node.parentElement?.tagName === 'MARK') for (let s = node.parentElement.previousSibling; s; s = s.previousSibling) inside += s.textContent.length
    let gi = st.chunks[k].start + inside
    while (gi > 0 && /\S/.test(st.text[gi - 1])) gi--
    speakFrom(gi)
  })
  inp.ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); toggle() } })
  onCleanup(() => { st.session++; synth.cancel() })
  ctx.signal?.addEventListener('abort', () => { st.session++; synth.cancel() })

  idleStatus()
  setState('idle')
  const left = h('div', { class: 'stack' },
    h('section', { class: 'tw-stage' }, h('div', { class: 'stack' }, kicker('Text', 'type'), inputBox, readerBox,
      h('div', { class: 'tw-ctl' }, playBtn, h('div', { class: 'stack tight', style: 'flex:1; min-width:140px' }, h('div', { class: 'row' }, wv.el, status), trk), stopBtn))))
  const right = h('section', { class: 'tw-stage' }, h('div', { class: 'stack' }, kicker('Voice', 'audio-lines'),
    field('Language', langSel), field('Voice', voiceSel, undefined), voiceInfo, preview,
    h('div', { class: 'stack tight' }, rate, speedChips), pitch, volume))
  root.append(toolRoot('tts', h('div', { class: ['tool-split', 'wide-left'] }, left, right),
    note('Voices come from your device or browser, so they differ between Windows, Mac, Android and iPhone. This tool plays the sound but cannot save it. For a downloadable file with a more natural voice, use Text to voice.', 'info'),
    h('div', { class: 'row' }, h('a', { class: 'link', href: '#/text-to-voice' }, 'Open Text to voice (natural, download)'))))
}
