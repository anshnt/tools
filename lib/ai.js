// AI helper: Claude (Anthropic) with the visitor's own API key, called straight from the browser.
// The key never leaves this device except in requests to api.anthropic.com.
//
//   import * as ai from '../../lib/ai.js'
//   if (!(await ai.ensureKey())) return
//   const text = await ai.ask({ prompt, system, images: [file], pdfs: [file], onText: (t) => out.textContent = t })
//   const data = await ai.ask({ prompt, json: { type: 'object', properties: {...}, required: [...], additionalProperties: false } })
import { anthropic } from './libs.js'
import { h, button, field, input, select, toggle, alert, modal, toast, icon, busy } from './ui.js'
import { blobToBase64 } from './files.js'
import { loadImage, fitSize, toCanvas, toBlob } from './image.js'

const KEY = 'tools:claude'
export const MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5 - best quality'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 - faster, lower cost'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5 - fastest, lowest cost'],
]
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

export function config() {
  const c = memoryCfg || readCfg()
  return { apiKey: c.apiKey || '', model: c.model || MODELS[0][0], remember: c.remember ?? true }
}
export const isConfigured = () => !!config().apiKey

/** Opens the settings dialog. Resolves true if a key is saved. */
export function openSettings() {
  return new Promise((resolve) => {
    const cfg = config()
    let saved = false
    const keyInput = input({ type: 'password', value: cfg.apiKey, placeholder: 'sk-ant-...', autocomplete: 'off', mono: true })
    const modelSelect = select(MODELS, cfg.model)
    const remember = toggle('Remember on this device', cfg.remember)
    const status = h('div')
    const save = () => {
      const apiKey = keyInput.value.trim()
      if (!apiKey) return toast('Paste your Anthropic API key first', 'error')
      writeCfg({ apiKey, model: modelSelect.value, remember: remember.input.checked })
      saved = true
      toast('AI is ready', 'success')
      m.close()
    }
    const test = button('Test key', { icon: 'plug-zap', variant: 'secondary' })
    test.addEventListener('click', () => busy(test, async () => {
      const apiKey = keyInput.value.trim()
      if (!apiKey) throw new Error('Paste your Anthropic API key first')
      await ask({ prompt: 'Reply with the single word OK.', maxTokens: 512, effort: 'low', apiKey, model: modelSelect.value })
      status.replaceChildren(alert('success', 'Key works.'))
    }, 'Testing'))
    const m = modal({
      title: 'AI settings', icon: 'sparkles',
      body: [
        alert('info', 'AI tools use Claude by Anthropic with your own API key. The key is stored only in this browser, and requests go directly from your browser to api.anthropic.com. Anything you send to an AI tool is processed by Anthropic under your account.'),
        field('Anthropic API key', keyInput, h('span', 'Create one at ', h('a', { class: 'link', href: 'https://console.anthropic.com/settings/keys', target: '_blank', rel: 'noopener' }, 'console.anthropic.com'), '. Usage is billed to your Anthropic account.')),
        field('Model', modelSelect),
        remember,
        status,
      ],
      actions: [
        cfg.apiKey && button('Remove key', { icon: 'trash-2', variant: 'danger', onClick: () => { writeCfg(null); memoryCfg = null; toast('Key removed'); m.close() } }),
        test,
        button('Save', { icon: 'check', variant: 'primary', onClick: save }),
      ].filter(Boolean),
      onClose: () => resolve(saved || isConfigured()),
    })
    keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') save() })
    setTimeout(() => keyInput.focus(), 50)
  })
}

/** Resolves true when a key is configured, prompting the visitor if needed. */
export const ensureKey = async () => isConfigured() || openSettings()

/** Small status line for AI tools: "Uses Claude (Opus 5.5) · Settings". Updates live. */
export function notice(text = 'Uses Claude with your Anthropic API key') {
  const el = h('div', { class: 'row small muted' })
  const render = () => {
    const c = config()
    el.replaceChildren(icon('sparkles'), h('span', isConfigured() ? `${text} · ${MODELS.find((m) => m[0] === c.model)?.[1].split(' - ')[0] || c.model}` : 'AI needs your Anthropic API key (stored only in this browser)'),
      button(isConfigured() ? 'Settings' : 'Connect', { size: 'sm', variant: isConfigured() ? 'ghost' : 'primary', icon: 'key-round', onClick: openSettings }))
  }
  render()
  const onCfg = () => (el.isConnected ? render() : window.removeEventListener('ai-config', onCfg))
  window.addEventListener('ai-config', onCfg)
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
/** PDF File/Blob -> document block (max ~32 MB / 600 pages per request). */
export async function pdfBlock(blob, title) {
  return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await blobToBase64(blob) }, ...(title ? { title } : {}) }
}
export const textBlock = (text) => ({ type: 'text', text })

/**
 * ask({prompt, system, images, pdfs, messages, json, maxTokens, effort, onText, signal, model}) -> string | object
 * - messages: full conversation (overrides prompt/images/pdfs) for multi-turn chat tools
 * - json: a JSON Schema; the reply is parsed and returned as an object
 * - onText(snapshot): called as text streams in
 * - effort: 'low' | 'medium' | 'high' (default 'medium')
 */
export async function ask(opts) {
  const cfg = config()
  const apiKey = opts.apiKey || cfg.apiKey
  if (!apiKey) throw Object.assign(new Error('Connect your Anthropic API key in AI settings first.'), { code: 'NO_KEY' })
  const model = opts.model || cfg.model
  const messages = opts.messages || [{
    role: 'user',
    content: [
      ...(await Promise.all((opts.pdfs || []).map((p) => pdfBlock(p, p.name)))),
      ...(await Promise.all((opts.images || []).map(imageBlock))),
      textBlock(opts.prompt || ''),
    ],
  }]
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
  const text = final.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  if (opts.json) {
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(final.stop_reason === 'max_tokens' ? 'The answer was too long and got cut off. Try a smaller input.' : 'Claude returned an unexpected format. Please try again.')
    }
  }
  return final.stop_reason === 'max_tokens' ? text + '\n\n[Output truncated: reached the length limit]' : text
}

function friendly(e, Anthropic) {
  if (e?.name === 'AbortError' || e instanceof Anthropic.APIUserAbortError) return Object.assign(new Error('Cancelled'), { code: 'ABORT' })
  if (e instanceof Anthropic.AuthenticationError) return new Error('Your Anthropic API key was rejected. Update it in AI settings.')
  if (e instanceof Anthropic.PermissionDeniedError) return new Error('This API key is not allowed to use that model. Pick another model in AI settings.')
  if (e instanceof Anthropic.RateLimitError) return new Error('Rate limited by Anthropic. Wait a moment and try again.')
  if (e instanceof Anthropic.BadRequestError) return new Error(`Request rejected: ${e.error?.error?.message || e.message}`)
  if (e instanceof Anthropic.APIConnectionError) return new Error('Could not reach api.anthropic.com. Check your connection.')
  if (e instanceof Anthropic.APIError) return new Error(e.status >= 500 ? 'Anthropic is busy right now. Please try again shortly.' : e.message)
  return e
}
