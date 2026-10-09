// Natural on-device text to speech with Kokoro-82M (Apache-2.0 model, onnx-community/Kokoro-82M-v1.0-ONNX, 8-bit weights, about 92 MB, downloaded once).
// The text normaliser and phoneme clean-up follow kokoro-js (Apache-2.0, hexgrad and Xenova), re-implemented here on top of the
// transformers.js version the site already pins, so only one copy of the ONNX runtime is loaded. Phonemes come from phonemizer.js (espeak-ng).
import { transformers } from '../../lib/libs.js'

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const PHONEMIZER = 'https://cdn.jsdelivr.net/npm/phonemizer@1.2.1/+esm'
export const SAMPLE_RATE = 24000
export const MODEL_MB = 92

/** English voices of Kokoro v1.0. grade is the quality grade published by the model authors. */
export const VOICES = [
  ['af_heart', 'Heart', 'F', 'us', 'A'], ['af_bella', 'Bella', 'F', 'us', 'A-'], ['af_nicole', 'Nicole', 'F', 'us', 'B-'], ['af_kore', 'Kore', 'F', 'us', 'C+'], ['af_sarah', 'Sarah', 'F', 'us', 'C+'],
  ['af_aoede', 'Aoede', 'F', 'us', 'C+'], ['af_sky', 'Sky', 'F', 'us', 'C-'], ['af_nova', 'Nova', 'F', 'us', 'C'], ['af_alloy', 'Alloy', 'F', 'us', 'C'],
  ['am_michael', 'Michael', 'M', 'us', 'C+'], ['am_fenrir', 'Fenrir', 'M', 'us', 'C+'], ['am_puck', 'Puck', 'M', 'us', 'C+'], ['am_echo', 'Echo', 'M', 'us', 'D'], ['am_eric', 'Eric', 'M', 'us', 'D'],
  ['am_liam', 'Liam', 'M', 'us', 'D'], ['am_onyx', 'Onyx', 'M', 'us', 'D'], ['am_adam', 'Adam', 'M', 'us', 'F+'],
  ['bf_emma', 'Emma', 'F', 'gb', 'B-'], ['bf_isabella', 'Isabella', 'F', 'gb', 'C'], ['bf_alice', 'Alice', 'F', 'gb', 'D'], ['bf_lily', 'Lily', 'F', 'gb', 'D'],
  ['bm_george', 'George', 'M', 'gb', 'C'], ['bm_fable', 'Fable', 'M', 'gb', 'C'], ['bm_lewis', 'Lewis', 'M', 'gb', 'D+'], ['bm_daniel', 'Daniel', 'M', 'gb', 'D'],
].map(([id, name, gender, accent, grade]) => ({ id, name, gender, accent, grade }))

// ---------------------------------------------------------------- text normalisation (numbers, money, titles)

const splitNum = (m) => {
  if (m.includes('.')) return m
  if (m.includes(':')) {
    const [a, b] = m.split(':').map(Number)
    return b === 0 ? `${a} o'clock` : b < 10 ? `${a} oh ${b}` : `${a} ${b}`
  }
  const year = parseInt(m.slice(0, 4), 10)
  if (year < 1100 || year % 1000 < 10) return m
  const left = m.slice(0, 2), right = parseInt(m.slice(2, 4), 10), s = m.endsWith('s') ? 's' : ''
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (right === 0) return `${left} hundred${s}`
    if (right < 10) return `${left} oh ${right}${s}`
  }
  return `${left} ${right}${s}`
}
const flipMoney = (m) => {
  const unit = m[0] === '$' ? 'dollar' : 'pound'
  if (Number.isNaN(Number(m.slice(1)))) return `${m.slice(1)} ${unit}s`
  if (!m.includes('.')) return `${m.slice(1)} ${unit}${m.slice(1) === '1' ? '' : 's'}`
  const [whole, cents] = m.slice(1).split('.')
  const c = parseInt(cents.padEnd(2, '0'), 10)
  return `${whole} ${unit}${whole === '1' ? '' : 's'} and ${c} ${m[0] === '$' ? (c === 1 ? 'cent' : 'cents') : c === 1 ? 'penny' : 'pence'}`
}
const pointNum = (m) => { const [a, b] = m.split('.'); return `${a} point ${b.split('').join(' ')}` }

/** Make written text easier to say: smart quotes, titles, years, times, money, decimals. */
export function normalizeText(text) {
  return text
    .replace(/[‘’]/g, "'").replace(/«/g, '“').replace(/»/g, '”').replace(/[“”]/g, '"')
    .replace(/\(/g, '«').replace(/\)/g, '»')
    .replace(/、/g, ', ').replace(/。/g, '. ').replace(/！/g, '! ').replace(/，/g, ', ').replace(/：/g, ': ').replace(/；/g, '; ').replace(/？/g, '? ')
    .replace(/[^\S \n]/g, ' ').replace(/ {2,}/g, ' ').replace(/(?<=\n) +(?=\n)/g, '')
    .replace(/\bD[Rr]\.(?= [A-Z])/g, 'Doctor').replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, 'Mister').replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, 'Miss').replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, 'Mrs')
    .replace(/\betc\.(?! [A-Z])/gi, 'etc').replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, splitNum)
    .replace(/(?<=\d),(?=\d)/g, '')
    .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, flipMoney)
    .replace(/\d*\.\d+/g, pointNum)
    .replace(/(?<=\d)-(?=\d)/g, ' to ').replace(/(?<=\d)S/g, ' S')
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S").replace(/(?<=X')S\b/g, 's')
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, '-')).replace(/(?<=[A-Z])\.(?=[A-Z])/gi, '-')
    .trim()
}

const EM_DASH = String.fromCharCode(0x2014) // built from its code so the source file stays free of the character
const PUNCT = `;:,.!?¡¿${EM_DASH}…"«»“”(){}[]`
const PUNCT_RE = new RegExp(`(\\s*[${PUNCT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]+\\s*)+`, 'g')

function splitKeep(text, re) {
  const out = []
  let last = 0
  for (const m of text.matchAll(re)) {
    if (last < m.index) out.push({ punct: false, text: text.slice(last, m.index) })
    if (m[0].length) out.push({ punct: true, text: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ punct: false, text: text.slice(last) })
  return out
}

/** Text -> espeak phonemes for the given accent ('us' | 'gb'). */
export async function phonemize(text, accent = 'us') {
  const { phonemize: ph } = await import(PHONEMIZER)
  const parts = splitKeep(normalizeText(text), PUNCT_RE)
  const lang = accent === 'gb' ? 'en' : 'en-us'
  let p = (await Promise.all(parts.map(async (s) => (s.punct ? s.text : (await ph(s.text, lang)).join(' '))))).join('')
  p = p.replace(/kəkˈoːɹoʊ/g, 'kˈoʊkəɹoʊ').replace(/kəkˈɔːɹəʊ/g, 'kˈəʊkəɹəʊ')
    .replace(/ʲ/g, 'j').replace(/r/g, 'ɹ').replace(/x/g, 'k').replace(/ɬ/g, 'l')
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ').replace(new RegExp(` z(?=[${PUNCT.replace(/[\]\\^-]/g, '\\$&')} ]|$)`, 'g'), 'z')
  if (accent === 'us') p = p.replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di')
  return p.trim()
}

// ---------------------------------------------------------------- chunking

/** Split text into pieces the model can say in one go (about 240 characters, on sentence then clause boundaries). */
export function chunkText(text, max = 240) {
  const out = []
  const paras = text.replace(/\r\n?/g, '\n').split(/\n+/)
  for (const para of paras) {
    const sents = para.match(/[^.!?…।。]+(?:[.!?…।。]+["')\]”’]*|$)/g) || [para]
    let cur = ''
    for (let s of sents) {
      s = s.trim()
      if (!s) continue
      while (s.length > max) {
        let cut = Math.max(s.lastIndexOf(', ', max), s.lastIndexOf('; ', max), s.lastIndexOf(': ', max))
        if (cut < max * 0.4) cut = s.lastIndexOf(' ', max)
        if (cut < 1) cut = max
        if (cur) { out.push(cur); cur = '' }
        out.push(s.slice(0, cut + 1).trim())
        s = s.slice(cut + 1).trim()
      }
      if (cur && (cur + ' ' + s).length > max) { out.push(cur); cur = s } else cur = cur ? `${cur} ${s}` : s
    }
    if (cur) out.push(cur)
  }
  return out.filter((c) => /[\p{L}\p{N}]/u.test(c))
}

// ---------------------------------------------------------------- model

const engines = new Map()

/** True when this browser can run the model on the GPU in half precision (WebGPU with shader-f16). */
export async function gpuAvailable() {
  try {
    const ad = await navigator.gpu?.requestAdapter()
    return !!ad && !ad.isFallbackAdapter && ad.features.has('shader-f16')
  } catch { return false }
}
export const modelSize = (device) => (device === 'webgpu' ? 86 : MODEL_MB)

/**
 * Load (once per device) the model, tokenizer and phonemizer. device: 'wasm' (8-bit, about 92 MB, any browser) or 'webgpu' (8-bit weights with 16-bit maths, about 86 MB, several times faster).
 * onProgress(fraction 0..1, label). Resolves with an engine object for speakChunk().
 */
export function loadEngine(device = 'wasm', onProgress) {
  if (!engines.has(device)) {
    const files = new Map()
    const mb = modelSize(device)
    const cb = (p) => {
      if (p.status === 'progress' && p.total) {
        files.set(p.file, { loaded: p.loaded, total: p.total })
        let l = 0, t = 0
        for (const f of files.values()) { l += f.loaded; t += f.total }
        onProgress?.(Math.min(0.99, l / Math.max(t, mb * 1e6)), `Downloading voice model (${Math.round(l / 1e6)} of ${mb} MB)`)
      }
    }
    engines.set(device, (async () => {
      const [{ StyleTextToSpeech2Model, AutoTokenizer, Tensor, env }] = await Promise.all([transformers(), import(PHONEMIZER)])
      if (device === 'wasm') env.backends.onnx.wasm.proxy = true // run the CPU model in a worker so the page stays responsive while it speaks
      const [model, tokenizer] = await Promise.all([
        StyleTextToSpeech2Model.from_pretrained(MODEL, { dtype: device === 'webgpu' ? 'q8f16' : 'q8', device, progress_callback: cb }),
        AutoTokenizer.from_pretrained(MODEL, { progress_callback: cb }),
      ])
      return { model, tokenizer, Tensor, voices: new Map(), device }
    })().catch((e) => { engines.delete(device); throw Object.assign(new Error('Could not load the voice model. Check your connection and try again.'), { cause: e }) }))
  }
  return engines.get(device)
}

async function voiceData(eng, id) {
  if (eng.voices.has(id)) return eng.voices.get(id)
  const url = `https://huggingface.co/${MODEL}/resolve/main/voices/${id}.bin`
  let buf
  try {
    const cache = await caches.open('tw-kokoro-voices')
    const hit = await cache.match(url)
    if (hit) buf = await hit.arrayBuffer()
    else {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`voice ${id}: HTTP ${res.status}`)
      buf = await res.clone().arrayBuffer()
      cache.put(url, res).catch(() => {})
    }
  } catch (e) {
    if (!buf) {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Could not download the "${id}" voice (HTTP ${res.status}).`)
      buf = await res.arrayBuffer()
    }
  }
  const data = new Float32Array(buf)
  eng.voices.set(id, data)
  return data
}

/** Say one chunk of text. Returns Float32Array samples at SAMPLE_RATE. Splits again if the chunk is too long for the model. */
export async function speakChunk(eng, text, { voice = 'af_heart', speed = 1 } = {}) {
  const v = VOICES.find((x) => x.id === voice) || VOICES[0]
  const phonemes = await phonemize(text, v.accent)
  if (!phonemes) return new Float32Array(0)
  const { input_ids } = eng.tokenizer(phonemes, { truncation: true })
  const n = input_ids.dims.at(-1)
  if (n >= 510 && text.length > 60) {
    const mid = text.lastIndexOf(' ', text.length / 2)
    const a = await speakChunk(eng, text.slice(0, mid), { voice, speed })
    const b = await speakChunk(eng, text.slice(mid + 1), { voice, speed })
    const out = new Float32Array(a.length + b.length)
    out.set(a); out.set(b, a.length)
    return out
  }
  const all = await voiceData(eng, v.id)
  const off = 256 * Math.min(Math.max(n - 2, 0), 509)
  const style = new eng.Tensor('float32', all.slice(off, off + 256), [1, 256])
  const { waveform } = await eng.model({ input_ids, style, speed: new eng.Tensor('float32', [speed], [1]) })
  const out = new Float32Array(waveform.data)
  // some GPU drivers return NaN for half-precision maths: report it so the caller can fall back to the CPU model
  if (out.length && Number.isNaN(out[out.length >> 1])) throw Object.assign(new Error('The GPU returned invalid audio.'), { code: 'BAD_AUDIO' })
  return out
}

// ---------------------------------------------------------------- audio

/** Float32 mono chunks (with a short pause between them) -> 16-bit PCM WAV Blob. */
export function encodeWav(chunks, rate = SAMPLE_RATE, gapSec = 0.18) {
  const gap = Math.round(rate * gapSec)
  const total = chunks.reduce((n, c) => n + c.length, 0) + gap * Math.max(0, chunks.length - 1)
  const buf = new ArrayBuffer(44 + total * 2)
  const v = new DataView(buf)
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + total * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, total * 2, true)
  let o = 44
  chunks.forEach((c, i) => {
    for (let j = 0; j < c.length; j++) { const s = Math.max(-1, Math.min(1, c[j])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2 }
    if (i < chunks.length - 1) o += gap * 2
  })
  return new Blob([buf], { type: 'audio/wav' })
}
