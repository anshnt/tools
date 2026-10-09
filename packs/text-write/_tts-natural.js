// Text to voice (natural, download): Kokoro-82M on the device. Streams audio while it is being generated and saves a WAV.
import { h, button, busy, alert, rangeField, toggle, segmented, progress, clear, formatDuration, formatBytes, download, toast, onCleanup } from '../../lib/ui.js'
import { toolRoot, addStyle, textInput, tiles, kicker, note, wave, celebrate, SAMPLE_ARTICLE } from './_shared.js'
import { VOICES, SAMPLE_RATE, chunkText, loadEngine, speakChunk, encodeWav, gpuAvailable, modelSize } from './_kokoro.js'
import { load, save } from '../../lib/store.js'

const MAX_CHARS = 12000
const GRADE = { A: 'best', 'A-': 'best', 'B-': 'great', 'C+': 'good', C: 'good', 'C-': 'good', 'D+': 'okay', D: 'okay', 'F+': 'okay' }
const SAMPLE = SAMPLE_ARTICLE.split('\n\n')[0]

const CSS = `
.tw-voice .tw-now { padding: 12px 14px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--border); font-size: 14px; line-height: 1.55; min-height: 56px; display: flex; gap: 12px; align-items: center; }
.tw-voice .tw-now q { quotes: none; color: var(--text-2); overflow-wrap: anywhere; }
.tw-voice audio { width: 100%; height: 44px; }
.tw-voice .tw-gen { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
`

export function mount(root, { signal }) {
  addStyle('tw-voice-css', CSS)
  const prefs = { voice: 'af_heart', speed: 1, gpu: true, accent: 'us', gender: 'F', ...load('tts-natural', {}) }
  const state = { running: false, abort: null, chunks: [], blob: null, url: null, ctx: null }
  const result = h('div')
  const prog = progress('Preparing the voice')
  const now = h('div', { class: 'tw-now', hidden: true })
  const wv = wave(11)
  let gpuOk = false, gpuBroken = false

  const inp = textInput({ rows: 12, placeholder: 'Type or paste the text to read aloud, or open a .txt, .docx or .pdf file...', sample: SAMPLE, label: 'Text to speak', onInput: () => { if (!state.running) clear(result) } })
  const accentSeg = segmented([['us', 'American'], ['gb', 'British']], prefs.accent, (v) => { prefs.accent = v; refreshTiles(); persist() }, 'Accent')
  const genderSeg = segmented([['F', 'Female'], ['M', 'Male']], prefs.gender, (v) => { prefs.gender = v; refreshTiles(); persist() }, 'Voice type')
  let voiceTiles = buildTiles()
  const speed = rangeField('Speed', { min: 0.6, max: 1.5, step: 0.05, value: prefs.speed, format: (v) => `${v.toFixed(2)}x`, onInput: (v) => { prefs.speed = v; persist() } })
  const gpuTog = toggle('Use GPU acceleration (faster, falls back automatically)', prefs.gpu, (v) => { prefs.gpu = v; persist() })
  gpuTog.hidden = true
  const go = button('Generate speech', { icon: 'audio-lines', variant: 'primary', size: 'lg' })
  const stop = button('Stop', { icon: 'square', variant: 'secondary', size: 'lg', disabled: true })

  function persist() { save('tts-natural', prefs) }
  function refreshTiles() { const t = buildTiles(); voiceTiles.replaceWith(t); voiceTiles = t }
  function buildTiles() {
    const list = VOICES.filter((v) => v.accent === prefs.accent && v.gender === prefs.gender)
    if (!list.some((v) => v.id === prefs.voice)) prefs.voice = list[0].id
    return tiles(list.map((v) => ({ id: v.id, title: v.name, sub: GRADE[v.grade], icon: v.gender === 'F' ? 'user-round' : 'user' })), prefs.voice, (id) => { prefs.voice = id; persist() }, { ariaLabel: 'Voice', compact: true })
  }
  gpuAvailable().then((ok) => { gpuOk = ok; gpuTog.hidden = !ok })

  function reset() {
    state.blob = null
    if (state.url) URL.revokeObjectURL(state.url)
    state.url = null
    clear(result)
  }

  async function run() {
    const text = inp.get().trim()
    if (!text) throw new Error('Type or paste some text first.')
    const trimmed = text.length > MAX_CHARS
    const chunks = chunkText(trimmed ? text.slice(0, MAX_CHARS) : text)
    if (!chunks.length) throw new Error('There is nothing readable in that text (it needs some letters or digits).')
    reset()
    state.running = true
    stop.disabled = false
    state.abort = new AbortController()
    const sig = state.abort.signal
    const device = gpuOk && prefs.gpu && !gpuBroken ? 'webgpu' : 'wasm'
    const audios = []
    const AC = window.AudioContext || window.webkitAudioContext
    const ctx = new AC({ sampleRate: SAMPLE_RATE })
    state.ctx = ctx
    let nextAt = 0, playAlong = false, started = false, sources = [], doneChars = 0, genAfter = 0, audioAfter = 0
    const totalChars = chunks.reduce((n, c) => n + c.length, 0)
    const queue = []
    const play = (a) => {
      const buf = ctx.createBuffer(1, a.length, SAMPLE_RATE)
      buf.copyToChannel(a, 0)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)
      nextAt = Math.max(ctx.currentTime + 0.05, nextAt)
      src.start(nextAt)
      sources.push(src)
      nextAt += buf.duration + 0.18
    }
    try {
      prog.set(null, `Loading the voice model (first time downloads ${modelSize(device)} MB, then it is cached)`)
      let eng
      try {
        eng = await loadEngine(device, (f, label) => prog.set(f, label))
      } catch (e) {
        if (device === 'webgpu') { toast('GPU mode is not available here, using the standard model', 'info'); eng = await loadEngine('wasm', (f, label) => prog.set(f, label)) } else throw e
      }
      if (sig.aborted) return
      await ctx.resume()
      now.hidden = false
      wv.set(true)
      let genSec = 0, audioSec = 0
      for (let i = 0; i < chunks.length; i++) {
        if (sig.aborted) break
        prog.set(i / chunks.length, `Sentence ${i + 1} of ${chunks.length}`)
        clear(now, wv.el, h('q', chunks[i]))
        const t0 = performance.now()
        let a
        try {
          a = await speakChunk(eng, chunks[i], { voice: prefs.voice, speed: prefs.speed })
        } catch (e) {
          if (eng.device !== 'webgpu') throw e
          toast('The GPU could not run the voice model, switching to the standard model', 'info')
          gpuBroken = true
          eng = await loadEngine('wasm', (f, label) => prog.set(f, label))
          a = await speakChunk(eng, chunks[i], { voice: prefs.voice, speed: prefs.speed })
        }
        if (sig.aborted) break
        const gs = (performance.now() - t0) / 1000
        genSec += gs
        audioSec += a.length / SAMPLE_RATE
        doneChars += chunks[i].length
        if (!a.length) continue
        if (audios.length >= 1) { genAfter += gs; audioAfter += a.length / SAMPLE_RATE } // the first chunk includes model warm-up, so it is left out of the speed estimate
        audios.push(a)
        queue.push(a)
        // Start playing as soon as that cannot run dry: when generation is faster than playback straight away, otherwise
        // once enough audio is buffered to cover the gap for the rest of the text.
        if (!started) {
          const rtf = audios.length >= 2 ? genAfter / Math.max(audioAfter, 0.01) : gs / Math.max(a.length / SAMPLE_RATE, 0.01)
          const remaining = ((totalChars - doneChars) / Math.max(doneChars, 1)) * audioSec
          const need = Math.max(0, remaining * (rtf - 1))
          const firstOnly = audios.length === 1 && chunks.length > 1 && rtf > 0.5
          if (!firstOnly && audioSec >= need) started = true
        }
        if (started) while (queue.length) play(queue.shift())
      }
      playAlong = started
      wv.set(false)
      now.hidden = true
      if (!audios.length) return
      state.blob = encodeWav(audios)
      state.url = URL.createObjectURL(state.blob)
      const dur = audios.reduce((n, a) => n + a.length, 0) / SAMPLE_RATE + 0.18 * (audios.length - 1)
      const stopped = sig.aborted
      const audio = h('audio', { controls: true, src: state.url, 'aria-label': 'Generated speech' })
      const host = h('div', { class: 'stack tw-result-in', style: 'position:relative' },
        alert(stopped ? 'info' : 'success', h('strong', stopped ? 'Stopped. ' : 'Your audio is ready. '),
          `${formatDuration(dur)} of speech, ${audios.length} of ${chunks.length} sentence${chunks.length === 1 ? '' : 's'}, ${formatBytes(state.blob.size)} WAV.`,
          !stopped && !playAlong ? ' This device generates slower than real time, so press play when you are ready.' : ''),
        audio,
        h('div', { class: 'row' }, button('Download WAV', { icon: 'download', variant: 'primary', onClick: () => download(state.blob, `speech-${prefs.voice}.wav`) })),
        trimmed ? note(`Only the first ${MAX_CHARS.toLocaleString()} characters were read. Split longer text into parts.`, 'triangle-alert') : null)
      clear(result, host)
      if (!stopped) celebrate(host)
      if (!playAlong && !stopped) audio.play().catch(() => {})
    } finally {
      if (sig.aborted || !started) { sources.forEach((s) => { try { s.stop() } catch { /* already finished */ } }); ctx.close().catch(() => {}) } else {
        // generation finished while the audio is still playing: let it play out, then free the audio device
        setTimeout(() => ctx.close().catch(() => {}), Math.max(0, nextAt - ctx.currentTime) * 1000 + 800)
        state.late = { ctx, sources }
      }
      state.ctx = null
      state.running = false
      stop.disabled = true
      wv.set(false)
      now.hidden = true
      prog.hide()
    }
  }

  go.addEventListener('click', () => busy(go, run, { label: 'Generating', errorTo: result, progress: prog }))
  stop.addEventListener('click', () => state.abort?.abort())
  signal?.addEventListener('abort', () => state.abort?.abort())
  onCleanup(() => {
    state.abort?.abort()
    state.late?.sources.forEach((src) => { try { src.stop() } catch { /* done */ } })
    state.late?.ctx.close().catch(() => {})
    if (state.url) URL.revokeObjectURL(state.url)
  })

  const voicePanel = h('section', { class: 'tw-stage' }, h('div', { class: 'stack' },
    kicker('Voice', 'audio-lines'),
    h('div', { class: 'row' }, accentSeg, genderSeg),
    voiceTiles,
    speed, gpuTog))
  const left = h('div', { class: 'stack' }, h('section', { class: 'tw-stage' }, h('div', { class: 'stack' }, kicker('Text', 'type'), inp.el)),
    h('div', { class: 'tw-gen' }, go, stop, h('span', { class: 'tw-sub' }, 'Natural voices run on your device. Nothing is uploaded.')), prog.el, now, result)
  root.append(toolRoot('voice', h('div', { class: ['tool-split', 'wide-left'] }, left, voicePanel),
    note('Uses the open Kokoro-82M voice model (Apache 2.0) with espeak-ng pronunciation, English voices only. The model downloads once and is then cached by your browser. Speech is generated sentence by sentence and plays while it is created when your device is fast enough.', 'cpu')))
}
