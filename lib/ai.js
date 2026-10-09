// AI helper: Claude (Anthropic) or Gemini (Google) with the visitor's own API key, called straight from the browser.
// The key never leaves this device except in requests to the chosen provider (api.anthropic.com or generativelanguage.googleapis.com).
// Tools stay provider-agnostic: they call ask() and the visitor picks the provider in AI settings.
//
//   import * as ai from '../../lib/ai.js'
//   if (!(await ai.ensureKey())) return
//   const text = await ai.ask({ prompt, system, images: [file], pdfs: [file], onText: (t) => out.textContent = t })
//   const data = await ai.ask({ prompt, json: { type: 'object', properties: {...}, required: [...], additionalProperties: false } })
import { anthropic } from './libs.js'
import { h, button, field, input, select, toggle, segmented, alert, modal, toast, icon, busy, clear, onCleanup } from './ui.js'
import { blobToBase64 } from './files.js'
import { loadImage, fitSize, toCanvas, toBlob } from './image.js'

const KEY = 'tools:claude'
export const MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5 - best quality'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 - faster, lower cost'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5 - fastest, lowest cost'],
]
export const GEMINI_MODELS = [
  ['gemini-3.8-flash', 'Gemini 3.8 Flash - fast, strong all-rounder'],
  ['gemini-3.1-pro-preview', 'Gemini 3.1 Pro (preview) - most capable'],
  ['gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite - fastest, lowest cost'],
]
export const PROVIDERS = {
  anthropic: { name: 'Claude', company: 'Anthropic', models: MODELS, placeholder: 'sk-ant-...', keyUrl: 'https://console.anthropic.com/settings/keys', keySite: 'console.anthropic.com', host: 'api.anthropic.com' },
  gemini: { name: 'Gemini', company: 'Google', models: GEMINI_MODELS, placeholder: 'AIza...', keyUrl: 'https://aistudio.google.com/app/apikey', keySite: 'aistudio.google.com', host: 'generativelanguage.googleapis.com' },
}
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5'])

function readCfg() {
  for (const s of ['sessionStorage', 'localStorage']) {
    try {
      const v = window[s].getItem(KEY)
      if (v) return JSON.parse(v)
    } catch { /* storage blocked */ }
  }
  return {}
}
function writeCfg(c) {
  try {
    localStorage.removeItem(KEY)
    sessionStorage.removeItem(KEY)
    if (c) (c.remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(c))
  } catch { /* storage blocked: key lives for this page only */ memoryCfg = c }
  window.dispatchEvent(new CustomEvent('ai-config'))
}
let memoryCfg = null

/** {provider, apiKey, model, remember, keys, models} - apiKey/model are for the active provider. Reads the older {apiKey, model} shape too. */
export function config() {
  const c = memoryCfg || readCfg()
  const keys = { anthropic: c.keys?.anthropic ?? c.apiKey ?? '', gemini: c.keys?.gemini ?? '' }
  const models = { anthropic: c.models?.anthropic ?? c.model ?? MODELS[0][0], gemini: c.models?.gemini ?? GEMINI_MODELS[0][0] }
  const provider = PROVIDERS[c.provider] ? c.provider : 'anthropic'
  return { provider, apiKey: keys[provider], model: models[provider], remember: c.remember ?? false, keys, models }
}
export const isConfigured = () => !!config().apiKey

/** Opens the settings dialog. Resolves true if a key is saved for the chosen provider. */
export function openSettings() {
  return new Promise((resolve) => {
    const cfg = config()
    const keys = { ...cfg.keys }
    const models = { ...cfg.models }
    let provider = cfg.provider
    let saved = false
    const keyInput = input({ type: 'password', autocomplete: 'off', mono: true })
    const modelSlot = h('div')
    const keyHint = h('span')
    const intro = h('div')
    const status = h('div')
    const remember = toggle('Remember on this device (otherwise only until you close the tab)', cfg.apiKey ? cfg.remember : false)
    let modelSelect
    const render = () => {
      const P = PROVIDERS[provider]
      keyInput.value = keys[provider] || ''
      keyInput.placeholder = P.placeholder
      modelSelect = select(P.models, models[provider], (v) => { models[provider] = v })
      clear(modelSlot, field('Model', modelSelect))
      clear(keyHint, 'Create one at ', h('a', { class: 'link', href: P.keyUrl, target: '_blank', rel: 'noopener' }, P.keySite), `. Usage is billed to your ${P.company} account.`)
      clear(intro, alert('info', `AI tools use ${P.name} by ${P.company} with your own API key. The key is stored only in this browser, and requests go directly from your browser to ${P.host}. Anything you send to an AI tool is processed by ${P.company} under your account.`))
      clear(status)
    }
    keyInput.addEventListener('input', () => { keys[provider] = keyInput.value.trim() })
    const providerSwitch = segmented(Object.entries(PROVIDERS).map(([id, P]) => [id, P.name]), provider, (v) => { provider = v; render() }, 'AI provider')
    const save = () => {
      keys[provider] = keyInput.value.trim()
      if (!keys[provider]) return clear(status, alert('error', `Paste your ${PROVIDERS[provider].company} API key first.`))
      writeCfg({ provider, keys, models, remember: remember.input.checked })
      saved = true
      toast(`AI is ready (${PROVIDERS[provider].name})`, 'success')
      m.close()
    }
    const test = button('Test key', { icon: 'plug-zap', variant: 'secondary' })
    test.addEventListener('click', () => { clear(status); busy(test, async () => {
      const apiKey = keyInput.value.trim()
      if (!apiKey) throw new Error(`Paste your ${PROVIDERS[provider].company} API key first.`)
      await ask({ prompt: 'Reply with the single word OK.', maxTokens: 512, effort: 'low', apiKey, provider, model: modelSelect.value })
      clear(status, alert('success', 'Key works.'))
    }, { label: 'Testing', errorTo: status }) })
    const remove = button('Remove key', { icon: 'trash-2', variant: 'danger', onClick: () => {
      keys[provider] = ''
      const any = keys.anthropic || keys.gemini
      writeCfg(any ? { provider: keys[provider] ? provider : (keys.anthropic ? 'anthropic' : 'gemini'), keys, models, remember: remember.input.checked } : null)
      if (!any) memoryCfg = null
      toast(`${PROVIDERS[provider].name} key removed`)
      m.close()
    } })
    render()
    const m = modal({
      title: 'AI settings', icon: 'sparkles',
      body: [
        field('Provider', providerSwitch, 'Pick the AI you have a key for. You can save a key for each and switch any time.'),
        intro,
        field('API key', keyInput, keyHint),
        modelSlot,
        remember,
        status,
      ],
      actions: [(cfg.keys.anthropic || cfg.keys.gemini) && remove, test, button('Save', { icon: 'check', variant: 'primary', onClick: save })].filter(Boolean),
      onClose: () => resolve(saved || isConfigured()),
    })
    keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') save() })
    setTimeout(() => keyInput.focus(), 50)
  })
}

/** Resolves true when a key is configured, prompting the visitor if needed. */
export const ensureKey = async () => isConfigured() || openSettings()

/** Small status line for AI tools: "Uses Claude (Opus 5.5) · Settings". Updates live. */
export function notice(text) {
  const el = h('div', { class: 'row small muted' })
  const render = () => {
    const c = config()
    const P = PROVIDERS[c.provider]
    const label = P.models.find((m) => m[0] === c.model)?.[1].split(' - ')[0] || c.model
    el.replaceChildren(icon('sparkles'),
      h('span', isConfigured() ? `${text || `Uses ${P.name} with your ${P.company} API key`} · ${label}` : 'AI needs your Claude or Gemini API key (stored only in this browser)'),
      button(isConfigured() ? 'Settings' : 'Connect', { size: 'sm', variant: isConfigured() ? 'ghost' : 'primary', icon: 'key-round', onClick: openSettings }))
  }
  render()
  const onCfg = () => render()
  window.addEventListener('ai-config', onCfg)
  onCleanup(() => window.removeEventListener('ai-config', onCfg))
  return el
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
/** Image (File/Blob/canvas) -> content block. Large or unsupported images are re-encoded to JPEG <= 2000px. */
export async function imageBlock(src) {
  let blob = src instanceof HTMLCanvasElement ? await toBlob(src, 'image/png') : src
  const img = await loadImage(blob)
  const big = Math.max(img.naturalWidth, img.naturalHeight) > 2000 || blob.size > 3.5 * 1024 * 1024
  if (big || !IMAGE_TYPES.has(blob.type)) {
    const { width, height } = fitSize(img.naturalWidth, img.naturalHeight, 2000, 2000)
    blob = await toBlob(toCanvas(img, width, height, { background: '#fff' }), 'image/jpeg', 0.88)
  }
  return { type: 'image', source: { type: 'base64', media_type: blob.type, data: await blobToBase64(blob) } }
}
/** PDF File/Blob -> document block (Claude: ~32 MB / 600 pages per request; Gemini: ~20 MB per request). */
export async function pdfBlock(blob, title) {
  return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await blobToBase64(blob) }, ...(title ? { title } : {}) }
}
export const textBlock = (text) => ({ type: 'text', text })

/**
 * ask({prompt, system, images, pdfs, messages, json, maxTokens, effort, onText, signal, model, provider}) -> string | object
 * - messages: full conversation (overrides prompt/images/pdfs) for multi-turn chat tools, in the Claude shape
 *   ({role: 'user' | 'assistant', content: string | blocks}); it is converted automatically for Gemini
 * - json: a JSON Schema; the reply is parsed and returned as an object
 * - onText(snapshot): called as text streams in
 * - effort: 'low' | 'medium' | 'high' (default 'medium'; Claude only)
 * - raw: true returns the full message ({content, stop_reason, usage}) instead of text, e.g. to read Claude citations
 *   (set citations: {enabled: true} on document blocks). Gemini returns plain text blocks without citations.
 * Multi-turn chat: keep a messages array, push {role: 'user', content: [...blocks]} / {role: 'assistant', content: text}
 * and call ask({messages}). Spread cache_control: {type: 'ephemeral'} onto a large pdfBlock so Claude follow-ups are cheaper.
 * Aborting `signal` throws an error with code 'ABORT' (busy() ignores it); text already streamed stays in your onText output.
 */
export async function ask(opts) {
  const cfg = config()
  const provider = opts.provider || cfg.provider
  const apiKey = opts.apiKey || cfg.keys[provider]
  if (!apiKey) throw Object.assign(new Error('Connect your AI API key in AI settings first.'), { code: 'NO_KEY' })
  const model = opts.model || cfg.models[provider]
  const messages = opts.messages || [{
    role: 'user',
    content: [
      ...(await Promise.all((opts.pdfs || []).map((p) => pdfBlock(p, p.name)))),
      ...(await Promise.all((opts.images || []).map(imageBlock))),
      textBlock(opts.prompt || ''),
    ],
  }]
  const final = provider === 'gemini' ? await askGemini(opts, apiKey, model, messages) : await askClaude(opts, apiKey, model, messages)
  if (opts.raw) return final
  const text = final.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  if (opts.json) {
    try {
      return JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))
    } catch {
      throw new Error(final.stop_reason === 'max_tokens' ? 'The answer was too long and got cut off. Try a smaller input.' : 'The AI returned an unexpected format. Please try again.')
    }
  }
  return final.stop_reason === 'max_tokens' ? text + '\n\n[Output truncated: reached the length limit]' : text
}

async function askClaude(opts, apiKey, model, messages) {
  const params = {
    model,
    max_tokens: opts.maxTokens || 16000,
    messages,
    output_config: { effort: opts.effort || 'medium', ...(opts.json ? { format: { type: 'json_schema', schema: opts.json } } : {}) },
    ...(opts.system ? { system: opts.system } : {}),
  }
  if (FALLBACK_MODELS.has(model)) Object.assign(params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
  const Anthropic = await anthropic()
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 })
  let final
  try {
    const stream = client.beta.messages.stream(params, { signal: opts.signal })
    if (opts.onText) stream.on('text', (_delta, snapshot) => opts.onText(snapshot))
    final = await stream.finalMessage()
  } catch (e) {
    throw friendly(e, Anthropic)
  }
  if (final.stop_reason === 'refusal') throw new Error('Claude declined this request. Try rephrasing it.')
  return final
}

function friendly(e, Anthropic) {
  if (e?.name === 'AbortError' || e instanceof Anthropic.APIUserAbortError) return Object.assign(new Error('Cancelled'), { code: 'ABORT' })
  if (e instanceof Anthropic.AuthenticationError) return new Error('Your Anthropic API key was rejected. Update it in AI settings.')
  if (e instanceof Anthropic.PermissionDeniedError) return new Error('This API key is not allowed to use that model. Pick another model in AI settings.')
  if (e instanceof Anthropic.RateLimitError) return new Error('Rate limited by Anthropic. Wait a moment and try again.')
  if (e instanceof Anthropic.NotFoundError) return new Error('That model is not available for this API key. Pick another model in AI settings.')
  if (e?.status === 413) return new Error('That request is too large. Use a smaller file (PDFs up to about 24 MB / 600 pages).')
  if (e instanceof Anthropic.BadRequestError) return new Error(`Request rejected: ${e.error?.error?.message || e.message}`)
  if (e instanceof Anthropic.APIConnectionError) return new Error('Could not reach api.anthropic.com. Check your connection.')
  if (e instanceof Anthropic.APIError) return new Error(e.status >= 500 ? 'Anthropic is busy right now. Please try again shortly.' : e.error?.error?.message || e.message)
  return e
}

// ---------- Gemini (REST, streamed as server-sent events) ----------
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models'
const BLOCKED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY'])

/** Claude-shaped messages -> Gemini contents. Unknown block types (tool use etc.) are skipped. */
export function toGeminiContents(messages) {
  return messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content).flatMap((b) => {
      if (b.type === 'text') return b.text ? [{ text: b.text }] : []
      if ((b.type === 'image' || b.type === 'document') && b.source?.type === 'base64') return [{ inline_data: { mime_type: b.source.media_type, data: b.source.data } }]
      if (b.type === 'document' && b.source?.type === 'text') return [{ text: b.source.data }]
      return []
    }),
  })).filter((c) => c.parts.length)
}

async function askGemini(opts, apiKey, model, messages) {
  const body = (schemaMode) => JSON.stringify({
    contents: toGeminiContents(messages),
    ...(opts.system || (opts.json && !schemaMode) ? { systemInstruction: { parts: [{ text: [opts.system, opts.json && !schemaMode && `Reply with only JSON that matches this JSON Schema:\n${JSON.stringify(opts.json)}`].filter(Boolean).join('\n\n') }] } } : {}),
    generationConfig: { maxOutputTokens: opts.maxTokens || 16000, ...(opts.json ? { responseMimeType: 'application/json', ...(schemaMode ? { responseJsonSchema: opts.json } : {}) } : {}) },
  })
  const send = (schemaMode) => fetch(`${GEMINI}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: body(schemaMode), signal: opts.signal,
  })
  let res
  try {
    res = await send(!!opts.json)
    if (!res.ok && opts.json && res.status === 400) {
      const msg = (await res.clone().json().catch(() => ({})))?.error?.message || ''
      if (/schema|responseJsonSchema|Unknown name/i.test(msg)) res = await send(false) // older models: describe the schema instead
    }
  } catch (e) {
    throw e?.name === 'AbortError' ? Object.assign(new Error('Cancelled'), { code: 'ABORT' }) : new Error('Could not reach generativelanguage.googleapis.com. Check your connection.')
  }
  if (!res.ok) throw await geminiError(res)

  let text = ''
  let finish = null
  let usage = null
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line.startsWith('data:')) continue
        let chunk
        try { chunk = JSON.parse(line.slice(5)) } catch { continue }
        if (chunk.promptFeedback?.blockReason) throw new Error('Gemini declined this request. Try rephrasing it.')
        const cand = chunk.candidates?.[0]
        for (const p of cand?.content?.parts || []) if (p.text && !p.thought) text += p.text
        if (cand?.finishReason) finish = cand.finishReason
        if (chunk.usageMetadata) usage = chunk.usageMetadata
        if (opts.onText && cand?.content?.parts?.length) opts.onText(text)
      }
    }
  } catch (e) {
    if (e?.name === 'AbortError') throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
    throw e
  }
  if (BLOCKED.has(finish) && !text) throw new Error('Gemini declined this request. Try rephrasing it.')
  return { content: [{ type: 'text', text }], stop_reason: finish === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn', usage, provider: 'gemini' }
}

async function geminiError(res) {
  const err = (await res.json().catch(() => ({})))?.error || {}
  const msg = err.message || `HTTP ${res.status}`
  if (res.status === 400 && /API key/i.test(msg)) return new Error('Your Google API key was rejected. Update it in AI settings.')
  if (res.status === 403) return new Error('This API key is not allowed to use Gemini (check the key and that the Generative Language API is enabled).')
  if (res.status === 404) return new Error('That Gemini model is not available for this key. Pick another model in AI settings.')
  if (res.status === 413 || /payload size|too large/i.test(msg)) return new Error('That request is too large for Gemini. Use a smaller file (about 20 MB per request).')
  if (res.status === 429) return new Error('Gemini rate limit or quota reached. Wait a moment and try again.')
  if (res.status >= 500) return new Error('Gemini is busy right now. Please try again shortly.')
  return new Error(`Request rejected: ${msg}`)
}
