// Free on-device AI for lib/ai.js: an open model run on the visitor's GPU with WebLLM (WebGPU), or the browser's own
// built-in model when the browser offers one (the Prompt API, `LanguageModel`). No key, no account, nothing leaves the device.
// Requests with images go to a small vision model run with transformers.js (WebGPU, or WebAssembly as a slower fallback).
// Models download once and are cached by the browser. PDFs are read as text.
import { h, icon } from './ui.js'
import { pdfjs, pdfjsDocOptions, transformers } from './libs.js'

const WEBLLM = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/lib/index.js'
export const BUILTIN = 'browser-builtin'
/** [id, label]: WebLLM ids without the -q4f16_1-MLC / -q4f32_1-MLC suffix, picked by GPU support at load time. */
export const LOCAL_MODELS = [
  ['Qwen3.5-2B', 'Qwen 3.5 2B - good balance (needs about 2.3 GB of GPU memory)'],
  ['Llama-3.2-1B-Instruct', 'Llama 3.2 1B - fastest, smallest (about 0.9 GB)'],
  ['Qwen3.5-4B', 'Qwen 3.5 4B - best quality (about 3.9 GB)'],
  ['Phi-4-mini-instruct', 'Phi 4 mini - strong at reasoning (about 3.4 GB)'],
]
/** [id, label, Hugging Face repo] for requests that include images. */
export const VISION_MODELS = [
  ['SmolVLM-500M', 'SmolVLM 500M - quick, small download (about 360 MB)', 'HuggingFaceTB/SmolVLM-500M-Instruct'],
  ['Qwen3-VL-2B', 'Qwen3-VL 2B - more detail on busy photos and documents (about 1.3 GB)', 'onnx-community/Qwen3-VL-2B-Instruct-ONNX'],
]
const VISION_SIDE = 896 // longest image side sent to the vision model: enough detail, far fewer tokens than 2000 px
const CONTEXT = 8192
const MAX_OUT = 2048

export const hasWebGpu = () => typeof navigator !== 'undefined' && !!navigator.gpu
export const hasBuiltin = () => typeof globalThis.LanguageModel?.create === 'function'
/** Models to offer: the browser's own model first when it exists. */
export const localModels = () => (hasBuiltin() ? [[BUILTIN, 'Built into this browser - no download from this site']] : []).concat(LOCAL_MODELS)
export const isSupported = () => hasWebGpu() || hasBuiltin()

const abortErr = () => Object.assign(new Error('Cancelled'), { code: 'ABORT' })

// ---------- Download progress (one small card for the whole page) ----------
let card = null
function progress(text, frac) {
  if (!card) {
    card = h('div', { class: 'ai-dl', role: 'status' }, icon('cpu'), h('div', { class: 'ai-dl-main' }, h('strong', 'Getting the free AI model ready'), h('span', { class: 'ai-dl-text' }), h('div', { class: 'ai-dl-bar' }, h('i'))))
    document.body.append(card)
  }
  card.querySelector('.ai-dl-text').textContent = text
  card.querySelector('.ai-dl-bar i').style.width = `${Math.round((frac || 0) * 100)}%`
}
const progressDone = () => { card?.remove(); card = null }

// ---------- WebLLM engine (one loaded model at a time) ----------
let engine = null
let engineId = null
let loading = null
async function getEngine(model) {
  if (!hasWebGpu()) throw new Error('The free AI needs WebGPU, which this browser does not offer. Use a recent Chrome or Edge on a computer, or pick Claude or Gemini in AI settings.')
  const adapter = await navigator.gpu.requestAdapter().catch(() => null)
  if (!adapter) throw new Error('No usable graphics chip was found for the free AI. Pick Claude or Gemini in AI settings.')
  const id = `${model}-${adapter.features.has('shader-f16') ? 'q4f16_1' : 'q4f32_1'}-MLC`
  if (engine && engineId === id) return engine
  if (loading?.id === id) return loading.p
  const p = (async () => {
    const webllm = await import(WEBLLM).catch(() => { throw new Error('Could not load the free AI engine. Check your connection and try again.') })
    if (engine) { await engine.unload().catch(() => {}); engine = null }
    await dropVision() // free GPU memory held by the image model
    try {
      progress('Starting...', 0)
      const e = await webllm.CreateMLCEngine(id, {
        initProgressCallback: (r) => progress(`${Math.round((r.progress || 0) * 100)}% - downloads once, then it is saved in this browser`, r.progress),
      }, { context_window_size: CONTEXT })
      engine = e; engineId = id
      return e
    } catch (e) {
      const msg = String(e?.message || e)
      if (/memory|OOM|allocate|device lost/i.test(msg)) throw new Error('This device does not have enough graphics memory for that model. Pick a smaller model in AI settings.')
      if (/fetch|network|Failed to load/i.test(msg)) throw new Error('The model download was interrupted. Check your connection and try again; finished parts are kept.')
      throw new Error(`The free AI could not start: ${msg}`)
    } finally {
      progressDone(); loading = null
    }
  })()
  loading = { id, p }
  return p
}

// ---------- Messages: Claude-shaped blocks -> plain chat text ----------
async function pdfText(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const lib = await pdfjs()
  const task = lib.getDocument({ data: bytes, ...pdfjsDocOptions() })
  try {
    const doc = await task.promise
    const pages = []
    for (let i = 1; i <= doc.numPages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent()
      pages.push(`[Page ${i}]\n` + tc.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('').trim())
    }
    return pages.join('\n\n')
  } finally {
    task.destroy()
  }
}
async function toChat(messages, images = []) {
  const out = []
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue
    const parts = []
    for (const b of typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content) {
      if (b.type === 'text') parts.push(b.text)
      else if (b.type === 'image' && b.source?.type === 'base64') images.push({ at: out.length, mime: b.source.media_type, data: b.source.data })
      else if (b.type === 'document' && b.source?.type === 'base64') parts.push(`Document${b.title ? ` "${b.title}"` : ''}:\n${await pdfText(b.source.data)}`)
      else if (b.type === 'document' && b.source?.type === 'text') parts.push(b.source.data)
    }
    if (parts.length || images.some((im) => im.at === out.length)) out.push({ role: m.role, content: parts.join('\n\n') })
  }
  return out
}
/** Small models have a short memory: keep the newest turns and shorten the longest text so it fits. */
function fit(chat, system, maxOut) {
  const budget = (CONTEXT - maxOut - 200) * 3.2 // about 3.2 characters per token
  let used = (system || '').length + chat.reduce((n, m) => n + m.content.length, 0)
  let cut = false
  while (used > budget && chat.length > 1) { used -= chat.shift().content.length; cut = true }
  if (used > budget) {
    const keep = Math.max(500, chat[0].content.length - (used - budget))
    chat[0] = { ...chat[0], content: chat[0].content.slice(0, keep) + '\n\n[The rest was left out to fit the on-device model]' }
    cut = true
  }
  while (chat.length && chat[0].role !== 'user') chat.shift()
  return cut
}
const stripThink = (s) => s.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s+/, '')

/** Same contract as the cloud providers in lib/ai.js: returns {content: [{type:'text', text}], stop_reason}. */
export async function askLocal(opts, model, messages, visionModel) {
  if (opts.signal?.aborted) throw abortErr()
  const images = []
  const chat = await toChat(messages, images)
  if (images.length) return askVision(opts, visionModel, chat, images)
  const maxOut = Math.min(opts.maxTokens || MAX_OUT, MAX_OUT)
  const system = [opts.system, opts.json && `Reply with only JSON that matches this JSON Schema, with no other text:\n${JSON.stringify(opts.json)}`].filter(Boolean).join('\n\n')
  const cut = fit(chat, system, maxOut)
  const text = model === BUILTIN ? await askBuiltin(opts, chat, system) : await askWebLlm(opts, model, chat, system, maxOut)
  return { content: [{ type: 'text', text: text.text }], stop_reason: text.stop, provider: 'local', shortened: cut }
}

async function askWebLlm(opts, model, chat, system, maxOut) {
  const e = await getEngine(model)
  if (opts.signal?.aborted) throw abortErr()
  const onAbort = () => e.interruptGenerate()
  opts.signal?.addEventListener('abort', onAbort)
  const req = (schema) => ({
    messages: [...(system ? [{ role: 'system', content: system }] : []), ...chat],
    stream: true, max_tokens: maxOut, temperature: opts.json ? 0.2 : 0.7,
    ...(opts.json ? { response_format: { type: 'json_object', ...(schema ? { schema: JSON.stringify(opts.json) } : {}) } } : {}),
    extra_body: { enable_thinking: false },
  })
  let raw = ''
  let stop = 'end_turn'
  try {
    let stream
    try { stream = await e.chat.completions.create(req(true)) } catch (err) {
      if (!opts.json) throw err
      stream = await e.chat.completions.create(req(false)) // schema the grammar engine cannot compile: plain JSON mode
    }
    for await (const chunk of stream) {
      const c = chunk.choices?.[0]
      raw += c?.delta?.content || ''
      if (c?.finish_reason === 'length') stop = 'max_tokens'
      if (opts.onText && !opts.json) opts.onText(stripThink(raw))
    }
  } catch (err) {
    if (opts.signal?.aborted) throw abortErr()
    throw new Error(`The free AI stopped: ${err?.message || err}`)
  } finally {
    opts.signal?.removeEventListener('abort', onAbort)
  }
  if (opts.signal?.aborted) throw abortErr()
  const text = stripThink(raw)
  if (opts.onText && opts.json) opts.onText(text)
  return { text, stop }
}

async function askBuiltin(opts, chat, system) {
  const LM = globalThis.LanguageModel
  const avail = await LM.availability?.().catch(() => 'unavailable')
  if (avail === 'unavailable') throw new Error('This browser has no built-in AI model on this device. Pick another free model in AI settings.')
  const last = chat.pop()
  let session
  try {
    session = await LM.create({
      initialPrompts: [...(system ? [{ role: 'system', content: system }] : []), ...chat],
      signal: opts.signal,
      monitor: (m) => m.addEventListener('downloadprogress', (ev) => progress(`${Math.round(ev.loaded * 100)}% - the browser downloads its model once`, ev.loaded)),
    })
  } catch (e) {
    if (opts.signal?.aborted) throw abortErr()
    throw new Error(`The browser's built-in AI could not start: ${e?.message || e}`)
  } finally {
    progressDone()
  }
  let text = ''
  try {
    const stream = session.promptStreaming(last?.content || '', { signal: opts.signal, ...(opts.json ? { responseConstraint: opts.json } : {}) })
    for await (const chunk of stream) {
      text = chunk.startsWith(text) ? chunk : text + chunk // older builds stream snapshots, newer ones stream deltas
      if (opts.onText && !opts.json) opts.onText(text)
    }
  } catch (e) {
    if (opts.signal?.aborted) throw abortErr()
    throw new Error(`The browser's built-in AI stopped: ${e?.message || e}`)
  } finally {
    session.destroy?.()
  }
  return { text, stop: 'end_turn' }
}

// ---------- Vision: transformers.js image-text-to-text ----------
let vis = null // {id, processor, model, T}
let visLoading = null
async function dropVision() { const v = vis; vis = null; await v?.model?.dispose?.().catch(() => {}) }
async function getVision(key) {
  const [, , repo] = VISION_MODELS.find(([id]) => id === key) || VISION_MODELS[0]
  if (vis?.id === repo) return vis
  if (visLoading?.id === repo) return visLoading.p
  const p = (async () => {
    const T = await transformers()
    await dropVision()
    if (engine) { await engine.unload().catch(() => {}); engine = null; engineId = null } // free GPU memory for the image model
    const adapter = hasWebGpu() ? await navigator.gpu.requestAdapter().catch(() => null) : null
    const files = new Map()
    const onProgress = (e) => {
      if (e.status !== 'progress' || !e.total) return
      files.set(e.file, [e.loaded, e.total])
      let a = 0, b = 0
      for (const [l, t] of files.values()) { a += l; b += t }
      progress(`${Math.round((a / b) * 100)}% of the image model - downloads once, then it is saved in this browser`, a / b)
    }
    try {
      progress('Starting...', 0)
      const processor = await T.AutoProcessor.from_pretrained(repo)
      const model = await T.AutoModelForImageTextToText.from_pretrained(repo, {
        device: adapter ? 'webgpu' : 'wasm', dtype: adapter?.features.has('shader-f16') ? 'q4f16' : 'q4', progress_callback: onProgress,
      })
      vis = { id: repo, processor, model, T }
      return vis
    } catch (e) {
      const msg = String(e?.message || e)
      if (/memory|allocate|device lost/i.test(msg)) throw new Error('This device does not have enough memory for the image model. Pick the smaller image model in AI settings.')
      if (/fetch|network|Failed to load/i.test(msg)) throw new Error('The image model download was interrupted. Check your connection and try again.')
      throw new Error(`The free image AI could not start: ${msg}`)
    } finally {
      progressDone(); visLoading = null
    }
  })()
  visLoading = { id: repo, p }
  return p
}

async function toRawImage(T, img) {
  const blob = new Blob([Uint8Array.from(atob(img.data), (c) => c.charCodeAt(0))], { type: img.mime })
  const bmp = await createImageBitmap(blob)
  const k = Math.min(1, VISION_SIDE / Math.max(bmp.width, bmp.height))
  const c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)))
  const g = c.getContext('2d')
  g.fillStyle = '#fff'
  g.fillRect(0, 0, c.width, c.height)
  g.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close?.()
  return T.RawImage.fromBlob(await c.convertToBlob({ type: 'image/png' }))
}

// Small vision models can get stuck repeating a line: stop once the same line has come out three times in a row.
const lastLines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean)
function looping(s) {
  if (!s.endsWith('\n')) return false
  const L = lastLines(s)
  return L.length >= 3 && L.at(-1) === L.at(-2) && L.at(-2) === L.at(-3)
}
function unloop(s) {
  const out = []
  for (let line of s.split('\n')) {
    line = line.replace(/^(\s*)(\S.{5,}?)(?:\s+\2)+\s*$/, '$1$2') // "OPEN 9 AM OPEN 9 AM" -> "OPEN 9 AM"
    if (!(line.trim() && out.length && line.trim() === lastLines(out.join('\n')).at(-1))) out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

async function askVision(opts, key, chat, images) {
  const { T, processor, model } = await getVision(key)
  if (opts.signal?.aborted) throw abortErr()
  const system = [opts.system, opts.json && `Reply with only JSON that matches this JSON Schema, with no other text:\n${JSON.stringify(opts.json)}`].filter(Boolean).join('\n\n')
  // Image placeholders go in front of the text of the turn they came with; instructions get their own system turn.
  const msgs = chat.map((m, i) => ({
    role: m.role,
    content: [...images.filter((im) => im.at === i).map(() => ({ type: 'image' })), { type: 'text', text: m.content }],
  }))
  if (system) msgs.unshift({ role: 'system', content: [{ type: 'text', text: system }] })
  const placed = images.filter((im) => im.at < chat.length).length
  if (placed < images.length && msgs.length > (system ? 1 : 0)) msgs[msgs.length - 1].content.unshift(...images.slice(placed).map(() => ({ type: 'image' })))
  const prompt = processor.apply_chat_template(msgs, { add_generation_prompt: true })
  const raws = []
  for (const im of images) raws.push(await toRawImage(T, im))
  const inputs = await processor(prompt, raws)
  const stop = new T.InterruptableStoppingCriteria()
  const onAbort = () => stop.interrupt()
  opts.signal?.addEventListener('abort', onAbort)
  let text = ''
  try {
    const streamer = new T.TextStreamer(processor.tokenizer, {
      skip_prompt: true, skip_special_tokens: true,
      callback_function: (t) => {
        text += t
        if (looping(text)) { stop.interrupt(); text = unloop(text) }
        if (opts.onText && !opts.json) opts.onText(text.trimStart())
      },
    })
    await model.generate({ ...inputs, max_new_tokens: Math.min(opts.maxTokens || 1024, 1024), do_sample: false, repetition_penalty: 1.15, streamer, stopping_criteria: stop })
  } catch (e) {
    if (opts.signal?.aborted) throw abortErr()
    throw new Error(`The free image AI stopped: ${e?.message || e}`)
  } finally {
    opts.signal?.removeEventListener('abort', onAbort)
  }
  if (opts.signal?.aborted) throw abortErr()
  text = unloop(text).trim()
  if (opts.onText) opts.onText(text)
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn', provider: 'local' }
}

/** Download the image model ahead of time. */
export const warmUpVision = (key) => getVision(key)

/** Load the model ahead of time (the Download button in AI settings). */
export async function warmUp(model) {
  if (model === BUILTIN) return askLocal({ maxTokens: 8 }, model, [{ role: 'user', content: 'Say OK.' }])
  await getEngine(model)
}
