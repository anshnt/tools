// Base64 encoder / decoder: UTF-8 safe, URL-safe variant, auto-detect, line wrapping, image preview for decoded files.
import { h, icon, segmented, toggle, select, number, textarea, button, split, stats, alert, clear, formatBytes, formatNumber, onCleanup, preview, downloadButton } from '../../lib/ui.js'
import { bytesToBase64 } from '../../lib/files.js'
import { useKit, css, outBox, hex, eyebrow, pill } from './_kit.js'

const enc = new TextEncoder()
const dec = new TextDecoder('utf-8', { fatal: true })

/** Wrap a string every n characters with \n (0 = no wrapping). */
export const wrapLines = (s, n) => (n > 0 ? s.replace(new RegExp(`(.{${n}})`, 'g'), '$1\n').replace(/\n$/, '') : s)

export function encodeBase64(bytes, { url = false, pad = true, wrap = 0 } = {}) {
  let s = bytesToBase64(bytes)
  if (url) s = s.replace(/\+/g, '-').replace(/\//g, '_')
  if (!pad) s = s.replace(/=+$/, '')
  return wrapLines(s, wrap)
}

/** Parse Base64 or Base64URL (padding optional, whitespace and data: prefix ignored). Throws a readable error. */
export function decodeBase64(input) {
  let s = input.trim()
  let mime = null
  const m = s.match(/^data:([^;,]*)((?:;[^;,]*)*),/i)
  if (m) { mime = m[1] || null; s = s.slice(m[0].length) }
  s = s.replace(/\s+/g, '')
  if (!s) return { bytes: new Uint8Array(), mime, urlSafe: false }
  const bad = s.search(/[^A-Za-z0-9+/_=-]/)
  if (bad >= 0) throw new Error(`Not valid Base64: unexpected character "${s[bad]}" at position ${bad + 1}.`)
  const urlSafe = /[-_]/.test(s)
  if (urlSafe && /[+/]/.test(s)) throw new Error('Mixes the standard (+ /) and URL-safe (- _) alphabets. Use one or the other.')
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  const eq = s.indexOf('=')
  if (eq >= 0 && !/^[A-Za-z0-9+/]*={1,2}$/.test(s)) throw new Error('Padding "=" may only appear at the very end.')
  const body = s.replace(/=+$/, '')
  if (body.length % 4 === 1) throw new Error('Not valid Base64: the length is impossible (one character too many or too few).')
  const padded = body + '='.repeat((4 - (body.length % 4)) % 4)
  const bin = atob(padded)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, mime, urlSafe }
}

/** Decode bytes as UTF-8 text, or null when they are not valid UTF-8. */
export function bytesToText(bytes) {
  try { return dec.decode(bytes) } catch { return null }
}

const MAGIC = [
  ['image/png', [0x89, 0x50, 0x4e, 0x47], 'PNG image'], ['image/jpeg', [0xff, 0xd8, 0xff], 'JPEG image'], ['image/gif', [0x47, 0x49, 0x46, 0x38], 'GIF image'],
  ['application/pdf', [0x25, 0x50, 0x44, 0x46], 'PDF document'], ['application/zip', [0x50, 0x4b, 0x03, 0x04], 'ZIP archive (or Office file)'],
  ['application/gzip', [0x1f, 0x8b], 'gzip data'], ['image/bmp', [0x42, 0x4d], 'BMP image'], ['audio/mpeg', [0x49, 0x44, 0x33], 'MP3 audio'],
]
export function sniff(b) {
  for (const [mime, sig, label] of MAGIC) if (sig.every((v, i) => b[i] === v)) return { mime, label }
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return { mime: 'image/webp', label: 'WebP image' }
  return null
}

const isPlain = (t) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f�]/.test(t)

/** True when the text looks like Base64 that decodes to readable UTF-8 (used by Auto mode). */
export function looksLikeBase64Text(text) {
  const s = text.trim().replace(/\s+/g, '')
  if (s.length < 4 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return false
  try {
    const { bytes } = decodeBase64(text)
    const t = bytesToText(bytes)
    return t != null && isPlain(t) && t.length > 0
  } catch { return false }
}

/** Core conversion used by the UI and by tests. */
export function convert(text, { mode = 'auto', url = false, pad = true, wrap = 0 } = {}) {
  let action = mode
  if (mode === 'auto') action = looksLikeBase64Text(text) ? 'decode' : 'encode'
  if (action === 'encode') {
    const bytes = enc.encode(text)
    return { action, out: encodeBase64(bytes, { url, pad, wrap }), inBytes: bytes.length, outBytes: bytes.length }
  }
  const { bytes, mime, urlSafe } = decodeBase64(text)
  const t = bytesToText(bytes)
  return { action, bytes, mime, urlSafe, text: t, out: t != null && isPlain(t) ? t : null, inBytes: text.length, outBytes: bytes.length }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const STYLE = `
.t-b64 .bits { display: grid; grid-template-columns: repeat(24, minmax(0, 1fr)); gap: 2px; font-family: var(--mono); font-size: 11px; }
.t-b64 .bit { height: 26px; display: grid; place-items: center; border-radius: 6px; color: var(--text); background: color-mix(in srgb, var(--c) 16%, var(--surface)); border: 1px solid color-mix(in srgb, var(--c) 30%, transparent); animation: dv-rise .5s var(--ease) both; animation-delay: calc(var(--i) * 14ms); }
.t-b64 .bit.one { background: color-mix(in srgb, var(--c) 55%, var(--surface)); color: #fff; font-weight: 600; }
.t-b64 .bit.gap { margin-left: 5px; }
.t-b64 .cell { height: 40px; display: grid; place-items: center; border-radius: 10px; font-family: var(--mono); font-weight: 650; font-size: 17px; color: #fff; background: linear-gradient(140deg, var(--c), color-mix(in srgb, var(--c) 60%, #000)); animation: dv-pop .5s var(--spring) both; animation-delay: calc(var(--i) * 70ms + 400ms); }
.t-b64 .cell small { display: block; font-size: 10px; font-weight: 500; opacity: .8; line-height: 1; margin-top: 1px; }
.t-b64 .viz-row { display: grid; gap: 6px; }
.t-b64 .viz-label { font-size: 12px; color: var(--muted); }
.t-b64 .quad { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
`
const COLORS = ['#6366f1', '#d946ef', '#f97316']

/** The "how it works" strip: up to 3 bytes become 24 bits, regroup into 4 sextets, then map to 4 characters. */
function bitViz(bytes) {
  const b = [...bytes.slice(0, 3)]
  const n = b.length
  const bits = b.map((v) => v.toString(2).padStart(8, '0')).join('').padEnd(24, '0')
  const rows = (by) => h('div', { class: 'bits', 'aria-hidden': 'true' }, [...bits].map((x, i) => h('span', {
    class: ['bit', x === '1' && 'one', i && i % by === 0 && by === 8 && 'gap'], style: { '--c': COLORS[by === 8 ? Math.floor(i / 8) : Math.floor((i * 3) / 24) % 3], '--i': i },
  }, x)))
  const sextets = [0, 1, 2, 3].map((i) => parseInt(bits.slice(i * 6, i * 6 + 6), 2))
  const used = n === 1 ? 2 : n === 2 ? 3 : 4
  return h('div', { class: 'viz-row' },
    h('div', { class: 'viz-label' }, `${n} byte${n > 1 ? 's' : ''} = ${n * 8} bits${n < 3 ? ' (padded with zeros)' : ''}`), rows(8),
    h('div', { class: 'viz-label' }, 'Regrouped into 6-bit chunks'), rows(6),
    h('div', { class: 'viz-label' }, 'Each chunk is an index into A-Z a-z 0-9 + /'),
    h('div', { class: 'quad' }, sextets.map((v, i) => h('div', { class: 'cell', style: { '--c': i < used ? ['#6366f1', '#8b5cf6', '#d946ef', '#f97316'][i] : '#94a3b8', '--i': i }, title: `index ${v}` },
      h('div', i < used ? B64[v] : '=', h('small', i < used ? String(v) : 'pad'))))))
}

export function mount(root) {
  useKit()
  css('t-b64-css', STYLE)
  let mode = 'auto'
  let objUrl = null
  const input = textarea({ rows: 9, mono: true, placeholder: 'Type text to encode, or paste Base64 to decode...', 'aria-label': 'Input', spellcheck: false })
  const inLabel = h('span', 'Input')
  const inEyebrow = h('div', { class: 'dv-eyebrow' }, icon('pencil-line'), inLabel)
  const out = outBox('Result', { placeholder: 'The result appears here as you type.' })
  const note = h('div', { class: 'row', style: 'min-height:26px' })
  const info = h('div')
  const view = h('div')
  const viz = h('div')
  const urlSafe = toggle('URL-safe (- and _)', false, () => run())
  const noPad = toggle('No padding (=)', false, () => run())
  const wrapSel = select([['0', 'No line wrap'], ['64', 'Wrap at 64 (PEM)'], ['76', 'Wrap at 76 (MIME)'], ['custom', 'Custom...']], '0', () => { custom.hidden = wrapSel.value !== 'custom'; run() })
  const custom = number(80, { min: 4, max: 1000, step: 1, ariaLabel: 'Custom wrap width', onInput: () => run() })
  custom.hidden = true
  wrapSel.style.cssText = 'width:auto;min-width:180px'
  custom.style.maxWidth = '110px'
  const seg = segmented([['auto', 'Auto'], ['encode', 'Encode'], ['decode', 'Decode']], 'auto', (v) => { mode = v; run() }, 'Direction')

  const revoke = () => { if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null } }
  onCleanup(revoke)

  function wrapWidth() {
    if (wrapSel.value === 'custom') { const n = Math.round(custom.valueAsNumber); return Number.isFinite(n) && n > 0 ? n : 0 }
    return +wrapSel.value
  }

  function run() {
    revoke()
    clear(info); clear(view); clear(note); clear(viz)
    const text = input.value
    if (!text) {
      out.set('')
      inLabel.textContent = mode === 'decode' ? 'Base64 to decode' : mode === 'encode' ? 'Text to encode' : 'Input'
      return
    }
    let r
    try {
      r = convert(text, { mode, url: urlSafe.input.checked, pad: !noPad.input.checked, wrap: wrapWidth() })
    } catch (e) {
      out.set('')
      note.append(pill('bad', 'circle-alert', 'Cannot decode'))
      clear(info, alert('error', e.message))
      return
    }
    inLabel.textContent = r.action === 'decode' ? 'Base64 to decode' : 'Text to encode'
    if (mode === 'auto') note.append(pill('info', r.action === 'decode' ? 'unlock' : 'lock', r.action === 'decode' ? 'Looks like Base64, decoding' : 'Plain text, encoding'))
    else note.append(pill('ok', r.action === 'decode' ? 'unlock' : 'lock', r.action === 'decode' ? 'Decoded' : 'Encoded'))
    if (r.action === 'encode') {
      out.set(r.out)
      clear(info, stats([
        { label: 'Input', value: formatBytes(r.inBytes), hint: 'UTF-8 bytes' },
        { label: 'Base64', value: formatNumber(r.out.replace(/\n/g, '').length, 0), hint: 'characters', accent: true },
        { label: 'Overhead', value: r.inBytes ? `+${Math.round((r.out.replace(/\n/g, '').length / r.inBytes - 1) * 100)}%` : '-', hint: 'about 33% is normal' },
      ]))
      viz.append(h('div', { class: 'panel stack tight' }, eyebrow('sparkles', 'How the first bytes are encoded'), bitViz(enc.encode(text))))
      return
    }
    // decode
    const kind = sniff(r.bytes)
    if (r.out != null) {
      out.set(r.out)
      if (r.urlSafe) note.append(pill('info', 'link', 'URL-safe alphabet'))
      if (r.mime) note.append(pill('', 'file', r.mime))
    } else {
      out.set(hex(r.bytes.subarray(0, 4096), ' ') + (r.bytes.length > 4096 ? '\n... (first 4096 bytes shown)' : ''))
      note.append(pill('warn', 'file-question', `Binary data${kind ? ': ' + kind.label : ''}`))
    }
    clear(info, stats([
      { label: 'Base64', value: formatNumber(text.replace(/\s+/g, '').length, 0), hint: 'characters' },
      { label: 'Decoded', value: formatBytes(r.outBytes), hint: r.out != null ? 'UTF-8 text' : 'raw bytes', accent: true },
    ]))
    if (r.out == null) {
      const type = kind?.mime || r.mime || 'application/octet-stream'
      const blob = new Blob([r.bytes], { type })
      if (kind?.mime.startsWith('image/')) {
        objUrl = URL.createObjectURL(blob)
        view.append(preview(h('img', { src: objUrl, alt: 'Decoded image preview' })))
      }
      view.append(h('div', { class: 'row', style: 'margin-top:10px' }, downloadButton(blob, `decoded.${(kind?.mime.split('/')[1] || 'bin').replace('jpeg', 'jpg')}`, 'Download decoded file', { size: 'sm' }),
        h('span', { class: 'small muted' }, 'These bytes are not text, so the box above shows them as hex.')))
    }
  }

  const swap = button('Swap', {
    icon: 'arrow-left-right', size: 'sm', title: 'Use the result as the new input',
    onClick: () => {
      const v = out.get()
      if (!v || out.body.classList.contains('dv-ph')) return
      const wasDecode = (mode === 'decode') || (mode === 'auto' && looksLikeBase64Text(input.value))
      input.value = v
      mode = wasDecode ? 'encode' : 'decode'
      seg.set(mode)
      run()
    },
  })
  const sample = button('Try an example', { icon: 'sparkles', size: 'sm', variant: 'ghost', onClick: () => { input.value = 'Hello, world! Namaste, 世界 🚀'; run(); input.focus() } })
  const clearBtn = button('Clear', { icon: 'eraser', size: 'sm', variant: 'ghost', onClick: () => { input.value = ''; run(); input.focus() } })
  input.addEventListener('input', run)

  root.append(h('div', { class: 'dv t-b64 stack' },
    h('div', { class: 'panel stack' },
      h('div', { class: 'row between' }, seg, note),
      h('div', { class: 'row' }, urlSafe, noPad, wrapSel, custom)),
    split(
      h('div', { class: 'stack tight' }, inEyebrow, input, h('div', { class: 'row' }, sample, clearBtn)),
      h('div', { class: 'stack tight' }, h('div', { class: 'row between' }, eyebrow('sparkles', 'Output'), swap), out.el, view)),
    info,
    viz,
    h('p', { class: 'small muted' }, 'Everything is processed in your browser. Text is converted as UTF-8, so emoji and non-Latin scripts round-trip correctly. To turn whole files into Base64, use File to Base64.')))
  input.focus({ preventScroll: true })
}
