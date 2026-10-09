// Speech-to-text plumbing shared by the transcript and subtitle tools: probing a file, getting 16 kHz audio (with a
// built-in video engine fallback for formats the browser cannot decode), cutting long audio at quiet moments so progress
// is real, running lib/whisper.js on each piece, and turning the result into segments, words, paragraphs and cues.
import { transcribe, decodeAudio, WHISPER_MODELS } from '../../lib/whisper.js'
import { transformers } from '../../lib/libs.js'
import { runFFmpeg, MAX_INPUT_BYTES } from '../../lib/ffmpeg.js'
import { isAbort, formatBytes } from '../../lib/ui.js'
import { encodeWav, floatToInt16, findSpeech } from './_audio.js'
import { spreadWords, buildCues } from './_subs.js'

export const LARGE_BYTES = 150 * 1024 * 1024 // above this the file goes through the video engine instead of decodeAudioData
export const LONG_SECONDS = 40 * 60
const RATE = 16000
export const SLICE_SECONDS = 120

export const MODELS = WHISPER_MODELS.map(([id, label]) => {
  const key = id.split('-').pop()
  return {
    id, key, name: key[0].toUpperCase() + key.slice(1), size: label.match(/\(([^)]+)\)/)?.[1] || '',
    note: { tiny: 'Fastest. Fine for clear speech.', base: 'Balanced speed and accuracy.', small: 'Most accurate, slowest.' }[key] || '',
    bars: { tiny: 1, base: 2, small: 3 }[key] || 2,
  }
})

/** Read duration and kind with a media element. Resolves with unplayable: true when the browser cannot play the file (WMA, some MKV or AVI). */
export function probeMedia(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const isVideo = (file.type || '').startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|3gp)$/i.test(file.name)
    const el = document.createElement(isVideo ? 'video' : 'audio')
    el.preload = 'metadata'
    let done = false
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); el.removeAttribute('src'); el.load(); resolve(v) }
    const timer = setTimeout(() => finish({ url, duration: null, video: isVideo }), 8000)
    el.onloadedmetadata = () => finish({ url, duration: Number.isFinite(el.duration) ? el.duration : null, video: isVideo && el.videoWidth > 0, width: el.videoWidth, height: el.videoHeight })
    el.onerror = () => finish({ url, duration: null, video: isVideo, unplayable: true })
    el.src = url
  })
}

/** 16 kHz mono samples. Small files decode in the browser; big, long or unusual ones go through ffmpeg first. */
export async function getAudio(file, { duration, onProgress, signal } = {}) {
  const big = file.size > LARGE_BYTES || (duration && duration > LONG_SECONDS)
  if (!big) {
    try { return await decodeAudio(file) } catch (e) { if (isAbort(e)) throw e /* otherwise try the video engine */ }
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error(`This file is ${formatBytes(file.size)}. In-browser processing handles up to ${formatBytes(MAX_INPUT_BYTES)}, so extract just the audio first with Extract audio from video, then transcribe that.`)
  }
  const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'bin').toLowerCase()
  const inName = `in.${ext}`
  onProgress?.(null, 'Extracting the audio')
  const wav = await runFFmpeg({
    inputs: [{ name: inName, data: file }], args: ['-i', inName, '-vn', '-ac', '1', '-ar', String(RATE), '-c:a', 'pcm_s16le', 'out.wav'], output: 'out.wav', signal,
    onProgress: (f, label) => onProgress?.(f, /Processing/.test(label) ? 'Extracting the audio' : label),
  }).catch((e) => {
    if (isAbort(e)) throw e
    console.warn('ffmpeg could not read the file', e)
    throw new Error('Could not read audio from this file. It may be damaged or have no sound track. Try MP3, WAV, M4A, MP4 or WebM.')
  })
  return decodeAudio(wav)
}

/** True when nothing in the audio rises above about -50 dB, so there is no speech to find (and Whisper would only make some up). */
export function isSilent(audio, sr = RATE, thresholdDb = -50) {
  const win = Math.round(sr * 0.02)
  const limit = Math.pow(10, thresholdDb / 20)
  for (let s = 0; s + win <= audio.length; s += win) {
    let sum = 0
    for (let i = s; i < s + win; i++) sum += audio[i] * audio[i]
    if (Math.sqrt(sum / win) > limit) return false
  }
  return true
}

/** Cut points (in samples) about every `slice` seconds, each moved to the quietest 100 ms nearby so words are not split. */
export function sliceBounds(audio, sr = RATE, slice = SLICE_SECONDS) {
  const n = audio.length
  if (n <= slice * 1.5 * sr) return [0, n]
  const out = [0]
  const win = Math.round(sr * 0.1)
  let t = slice * sr
  while (t < n - slice * 0.5 * sr) {
    const lo = Math.max(out.at(-1) + sr * 30, t - 8 * sr), hi = Math.min(n - sr, t + 8 * sr)
    let best = Math.min(Math.max(t, lo), hi), bestE = Infinity
    for (let p = lo; p < hi; p += win) {
      let e = 0
      for (let i = p; i < p + win && i < n; i++) e += audio[i] * audio[i]
      if (e < bestE) { bestE = e; best = p + (win >> 1) }
    }
    out.push(best)
    t = best + slice * sr
  }
  out.push(n)
  return out
}

let gpuOk = null
/**
 * lib/whisper.js uses WebGPU whenever navigator.gpu exists, but some machines expose it without a usable adapter
 * (blocked GPUs, remote desktops) and the model then fails to load. Check for a real adapter first; if there is none,
 * hide navigator.gpu while fn runs so the CPU (wasm) path is used.
 */
export async function withBestDevice(fn) {
  if (!navigator.gpu) return fn()
  gpuOk ??= await navigator.gpu.requestAdapter().then((a) => !!a, () => false)
  if (gpuOk) return fn()
  Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true })
  try { return await fn() } finally { delete navigator.gpu }
}

const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Trim, drop empty or placeholder segments, and cut Whisper's habit of repeating one line over and over. */
export function cleanSegments(segs) {
  const out = []
  let run = 0
  for (const s of segs) {
    const text = s.text.replace(/\s+/g, ' ').trim()
    if (!text || /^\[?\s*(blank_audio|silence|music)\s*\]?$/i.test(text)) continue
    const prev = out.at(-1)
    run = prev && norm(prev.text) === norm(text) ? run + 1 : 0
    if (run >= 2) { prev.end = Math.max(prev.end, s.end); continue } // third and later repeats are merged away
    out.push({ ...s, text })
  }
  return out
}

/**
 * transcribeAudio(audio16k, { model, language, task, words, onProgress({phase, fraction, label}), signal })
 * -> { segments: [{start, end, text}], words: [{start, end, text}] | null, wordLevel, duration }
 * words: ask for word-level timing (uses the "_timestamped" build of the model; falls back to segments if it cannot load).
 */
export async function transcribeAudio(audio, { model, language = '', task = 'transcribe', words = false, onProgress, signal } = {}) {
  const n = audio.length
  const bounds = sliceBounds(audio)
  const segments = []
  const wordList = []
  let wordMode = words
  let wordFailed = false
  const emit = (phase, fraction, label) => onProgress?.({ phase, fraction, label })
  const lib = (base) => (f, label = '') => {
    if (/^Downloading/.test(label)) emit('model', f, label.replace(/\(.*\)/, '').trim())
    else if (/^Transcribing/.test(label)) emit('transcribe', base, label)
  }
  for (let i = 0; i < bounds.length - 1; i++) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
    const a = bounds[i], b = bounds[i + 1]
    const off = a / RATE, end = b / RATE
    const wav = encodeWav(floatToInt16(audio.subarray(a, b)), RATE)
    emit('transcribe', a / n, `Transcribing ${Math.round(off)}s to ${Math.round(end)}s`)
    let res = null
    if (wordMode) {
      try {
        res = { ...(await withBestDevice(() => transcribe(wav, { model: `${model}_timestamped`, language, task, timestamps: 'word', onProgress: lib(a / n) }))), word: true }
      } catch (e) {
        if (isAbort(e)) throw e
        console.warn('Word-level timing is not available, using segments', e)
        wordMode = false
        wordFailed = true
      }
    }
    if (!res) res = { ...(await withBestDevice(() => transcribe(wav, { model, language, task, timestamps: true, onProgress: lib(a / n) }))), word: false }
    for (const c of res.chunks || []) {
      const start = Math.min(end, off + (c.timestamp?.[0] ?? 0))
      const e = Math.min(end, off + (c.timestamp?.[1] ?? Math.min(c.timestamp?.[0] + 2, (b - a) / RATE)))
      const item = { start, end: Math.max(e, start), text: c.text }
      ;(res.word ? wordList : segments).push(item)
    }
    emit('transcribe', b / n, `Transcribed ${Math.round(end)}s of ${Math.round(n / RATE)}s`)
  }
  const wordLevel = wordList.length > 0 && !wordFailed
  const segs = wordLevel ? groupWords(wordList) : cleanSegments(segments)
  return { segments: segs, words: wordLevel ? wordList.filter((w) => w.text.trim()) : null, wordLevel, wordFailed, duration: n / RATE }
}

/** Build sentence-like segments from timed words (used for the text view when only words were produced). */
function groupWords(words) {
  const out = []
  let cur = []
  const flush = () => {
    if (!cur.length) return
    out.push({ start: cur[0].start, end: cur.at(-1).end, text: cur.map((w) => w.text).join('').replace(/\s+/g, ' ').trim() })
    cur = []
  }
  for (const w of words) {
    if (cur.length && w.start - cur.at(-1).end > 1.2) flush()
    cur.push(w)
    if (/[.!?。？！]["')\]]?\s*$/.test(w.text) && cur.length > 3) flush()
  }
  flush()
  return cleanSegments(out)
}

/** Paragraphs of text from segments: a new paragraph after a pause or when one gets long. */
export function toParagraphs(segments, { timestamps = false, paragraphs = true, pause = 1.5, maxChars = 600 } = {}) {
  const stamp = (t) => { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `[${m}:${String(s).padStart(2, '0')}]` }
  const paras = []
  let cur = null
  for (const s of segments) {
    const text = s.text.trim()
    if (!text) continue
    let brk
    if (!cur) brk = true
    else if (!paragraphs) brk = timestamps
    else brk = s.start - cur.end > pause || (cur.text.length > maxChars && /[.!?]$/.test(cur.text))
    if (brk) { cur = { start: s.start, end: s.end, text: '' }; paras.push(cur) }
    cur.text = cur.text ? `${cur.text} ${text}` : text
    cur.end = s.end
  }
  return paras.map((p) => (timestamps ? `${stamp(p.start)} ${p.text}` : p.text)).join(paragraphs ? '\n\n' : '\n')
}

/** Subtitle cues from a transcription result. lineChars 0 keeps Whisper's own segments as the cues. */
export function makeCues(result, { lineChars = 42, lines = 2 } = {}) {
  if (!lineChars) return result.segments.map((s) => ({ start: s.start, end: s.end, text: s.text }))
  const words = result.words || spreadWords(result.segments)
  return buildCues(words, { maxChars: lineChars, maxLines: lines })
}

// ---------- Language detection ----------
// transformers.js assumes English when no language is given, so "auto" is done here: one decoder step of the tiny model
// on the first 30 seconds of speech, then the most likely language token wins (this is how Whisper itself detects it).
let detector = null

/** Returns a Whisper language code such as 'en' or 'es'. Throws if the model cannot run. */
export async function detectLanguage(audio, { onProgress } = {}) {
  const { pipeline, Tensor } = await transformers()
  detector ??= withBestDevice(async () => {
    const device = navigator.gpu ? 'webgpu' : 'wasm'
    return pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny', {
      device, dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
      progress_callback: (p) => { if (p.status === 'progress' && p.total) onProgress?.(p.loaded / p.total, 'Downloading the language detector') },
    })
  }).catch((e) => { detector = null; throw e })
  const pipe = await detector
  const speech = findSpeech(floatToInt16(audio.subarray(0, Math.min(audio.length, RATE * 600))), RATE, { pad: 0.3 })
  const from = speech ? speech.start : 0
  const part = audio.subarray(from, Math.min(audio.length, from + RATE * 30))
  const { input_features } = await pipe.processor(part)
  const cfg = pipe.model.generation_config
  const ids = new Tensor('int64', BigInt64Array.from([BigInt(cfg.decoder_start_token_id)]), [1, 1])
  const out = await pipe.model.forward({ input_features, decoder_input_ids: ids })
  const logits = out.logits.data
  let best = null, bestV = -Infinity
  for (const [tok, id] of Object.entries(cfg.lang_to_id)) {
    if (logits[id] > bestV) { bestV = logits[id]; best = tok }
  }
  if (!best) throw new Error('Could not tell the language')
  return best.replace(/[<|>]/g, '')
}

/** "es" -> "Spanish" */
export const languageName = (code) => { try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code } catch { return code } }
