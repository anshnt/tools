// Base64 to image: paste a data URI or raw Base64, preview it and download the real file.
import { textarea, debounce } from '../../lib/ui.js'
import { base64ToBytes } from '../../lib/files.js'
import {
  shell, h, icon, button, section, hint, tiles, stage, clear, formatBytes, download, objURL, revokeURL, onCleanup,
} from './_kit.js'
import { sniff } from './_meta.js'

const EXT = { jpeg: 'jpg', png: 'png', gif: 'gif', webp: 'webp', bmp: 'bmp', ico: 'ico', tiff: 'tif', avif: 'avif', heic: 'heic', svg: 'svg' }
const MIME = { jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', tiff: 'image/tiff', avif: 'image/avif', heic: 'image/heic', svg: 'image/svg+xml' }

/** Decode pasted text (data URI, URL-safe or plain Base64, or an inline SVG data URI) into bytes. Throws a readable error. */
export function decodeInput(text) {
  let t = text.trim()
  if (!t) throw Object.assign(new Error('empty'), { empty: true })
  const m = /^data:([^,]*?),/i.exec(t)
  if (m) {
    const isB64 = /;base64/i.test(m[1])
    t = t.slice(m[0].length)
    if (!isB64) return new TextEncoder().encode(decodeURIComponent(t))
  }
  t = t.replace(/^['"]|['"]$/g, '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (/[^A-Za-z0-9+/=]/.test(t)) throw new Error('That does not look like Base64. It contains characters Base64 never uses.')
  t = t.replace(/=+$/, '')
  if (t.length % 4 === 1) throw new Error('This Base64 text is incomplete. It may have been cut off when copied.')
  return base64ToBytes(t.padEnd(t.length + ((4 - (t.length % 4)) % 4), '='))
}

/** A small valid PNG drawn on the fly, used by the example button. */
const sampleUri = () => {
  const c = Object.assign(document.createElement('canvas'), { width: 96, height: 96 })
  const x = c.getContext('2d')
  const g = x.createLinearGradient(0, 0, 96, 96)
  g.addColorStop(0, '#6366f1'); g.addColorStop(0.6, '#ec4899'); g.addColorStop(1, '#f97316')
  x.fillStyle = g; x.beginPath(); x.roundRect(0, 0, 96, 96, 22); x.fill()
  x.fillStyle = 'rgba(255,255,255,.92)'; x.beginPath(); x.arc(48, 48, 22, 0, Math.PI * 2); x.fill()
  return c.toDataURL('image/png')
}

export function mount(root) {
  let url = null, bytes = null, kind = null
  const input = textarea({ rows: 8, mono: true, placeholder: 'data:image/png;base64,iVBORw0KGgo...   or just the Base64 text', 'aria-label': 'Base64 or data URI', })
  const host = h('div', { class: 'stack' })
  const hintEl = h('div')

  async function run() {
    if (url) { revokeURL(url); url = null }
    let b
    try { b = decodeInput(input.value) } catch (e) {
      bytes = null
      clear(host)
      clear(hintEl, e.empty ? null : h('div', { class: 'alert error' }, icon('circle-alert'), h('div', e.message)))
      return
    }
    kind = sniff(b)
    if (!kind) {
      bytes = null
      const head = [...b.slice(0, 8)].map((x) => x.toString(16).padStart(2, '0')).join(' ')
      clear(host)
      clear(hintEl, h('div', { class: 'alert error' }, icon('circle-alert'), h('div', `Decoded ${formatBytes(b.length)}, but it is not a known image. The file starts with ${head || 'nothing'}.`)))
      return
    }
    clear(hintEl)
    bytes = b
    url = objURL(new Blob([b], { type: MIME[kind] }))
    const img = h('img', { src: url, alt: 'Decoded image' })
    const ok = await img.decode().then(() => true, () => false)
    const name = `image.${EXT[kind]}`
    clear(host,
      ok ? stage(img) : h('div', { class: 'alert warn' }, icon('triangle-alert'), h('div', `This is a ${kind.toUpperCase()} file, but this browser cannot show it. You can still download it.`)),
      tiles([{ label: 'Type', value: kind.toUpperCase(), sub: MIME[kind], hot: true }, { label: 'Size', value: formatBytes(b.length), sub: `${b.length.toLocaleString()} bytes` }, ok ? { label: 'Dimensions', value: `${img.naturalWidth || '?'} x ${img.naturalHeight || '?'}`, sub: 'pixels' } : { label: 'Preview', value: 'Not available' }]),
      h('div', { class: 'row' }, button(`Download ${name}`, { icon: 'download', variant: 'primary', onClick: () => download(new Blob([b], { type: MIME[kind] }), name) })))
  }
  input.addEventListener('input', debounce(run, 120))
  onCleanup(() => { if (url) revokeURL(url) })
  root.append(shell(
    section('Paste Base64', 'binary', input, h('div', { class: 'row' }, button('Try an example', { icon: 'wand-sparkles', size: 'sm', onClick: () => { input.value = sampleUri(); run() } }), button('Clear', { icon: 'eraser', size: 'sm', variant: 'ghost', onClick: () => { input.value = ''; run(); input.focus() } }))),
    hintEl, host, hint('Works with data URIs, plain Base64 and URL-safe Base64. The type is detected from the bytes, not from the label.', 'lightbulb')))
}
