// File to Base64 (encode) and Base64 to file (decode, params.mode = 'decode'). Data URIs, raw Base64, URL-safe, line wrapping,
// CSS / HTML / JSON snippets; decoding finds the file type from its bytes and offers a download. Everything stays on this device.
import { h, clear, dropzone, button, alert, stats, field, input, select, toggle, textarea, copyButton, download, formatBytes, debounce, errorMessage } from '../../lib/ui.js'
import { blobToBase64 } from '../../lib/files.js'
import { sniff, readRange, decodeText, looksBinary } from './_core.js'
import { useFx, card, chip, objectUrl, docGlyph, checkRing } from './_ui.js'

const MAX_ENCODE = 100 * 1024 * 1024
const SHOW_CHARS = 200_000
const MIME_EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/x-icon': 'ico', 'image/heic': 'heic',
  'application/pdf': 'pdf', 'application/zip': 'zip', 'application/json': 'json', 'application/xml': 'xml', 'text/plain': 'txt', 'text/html': 'html', 'text/css': 'css', 'text/csv': 'csv',
  'text/markdown': 'md', 'text/javascript': 'js', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/flac': 'flac', 'video/mp4': 'mp4', 'video/webm': 'webm',
  'video/quicktime': 'mov', 'font/woff': 'woff', 'font/woff2': 'woff2', 'font/ttf': 'ttf', 'font/otf': 'otf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx', 'application/octet-stream': 'bin',
}

// ---------- Pure helpers ----------
/** Wrap a long string every n characters with \n (n <= 0 means no wrapping). */
export function wrapText(text, n) {
  if (!n || n <= 0 || text.length <= n) return text
  const out = []
  for (let i = 0; i < text.length; i += n) out.push(text.slice(i, i + n))
  return out.join('\n')
}

/** Build the text shown for an encoded file. s: {format, urlsafe, nopad, wrap}. */
export function formatEncoded(b64, { name, mime, size }, s) {
  const m = mime || 'application/octet-stream'
  switch (s.format) {
    case 'raw': {
      let v = b64
      if (s.urlsafe) v = v.replace(/\+/g, '-').replace(/\//g, '_')
      if (s.nopad) v = v.replace(/=+$/, '')
      return wrapText(v, s.wrap)
    }
    case 'css': return `background-image: url("data:${m};base64,${b64}");`
    case 'html': {
      const src = `data:${m};base64,${b64}`
      if (m.startsWith('image/')) return `<img src="${src}" alt="${name.replace(/"/g, '&quot;')}">`
      if (m.startsWith('audio/')) return `<audio controls src="${src}"></audio>`
      if (m.startsWith('video/')) return `<video controls src="${src}"></video>`
      return `<a href="${src}" download="${name.replace(/"/g, '&quot;')}">Download ${name.replace(/</g, '&lt;')}</a>`
    }
    case 'json': return JSON.stringify({ filename: name, mime: m, size, base64: b64 }, null, 2)
    default: return `data:${m};base64,${b64}`
  }
}

/**
 * Parse pasted text into bytes. Accepts a data URI, a CSS url(...) or HTML tag that contains one, raw Base64 (standard or URL-safe), with or without
 * padding and line breaks. Returns {bytes, mime, dataUri} or {error}.
 */
export function parseBase64(text) {
  let t = (text || '').trim()
  if (!t) return { empty: true }
  let mime = ''
  let dataUri = false
  const m = t.match(/data:([a-z0-9.+*-]+\/[a-z0-9.+*-]+)?((?:;[a-z0-9=._+-]+)*?);base64,([A-Za-z0-9+/=_\s-]*)/i)
  if (m) { mime = (m[1] || '').toLowerCase(); t = m[3]; dataUri = true } else t = t.replace(/^base64[,:]\s*/i, '')
  t = t.replace(/^["']|["']$/g, '').replace(/\s+/g, '')
  if (/[-_]/.test(t) && !/[+/]/.test(t)) t = t.replace(/-/g, '+').replace(/_/g, '/')
  const bad = t.search(/[^A-Za-z0-9+/=]/)
  if (bad >= 0) return { error: `Character ${JSON.stringify(t[bad])} at position ${bad + 1} is not valid Base64. Base64 uses A-Z, a-z, 0-9, + and /.` }
  const eq = t.indexOf('=')
  if (eq >= 0 && /[^=]/.test(t.slice(eq))) return { error: 'Found "=" padding in the middle of the text. The text may be several Base64 strings joined together.' }
  t = t.replace(/=+$/, '')
  if (!t.length) return { error: 'Nothing to decode.' }
  if (t.length % 4 === 1) return { error: `The length (${t.length} characters) is not valid for Base64, so some characters are probably missing. Check that you copied all of it.` }
  t += '='.repeat((4 - (t.length % 4)) % 4)
  let bin
  try { bin = atob(t) } catch { return { error: 'This is not valid Base64.' } }
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, mime, dataUri }
}

// ---------- Mount ----------
export function mount(root, { params }) {
  useFx()
  if (params?.mode === 'decode') return mountDecode(root)
  return mountEncode(root)
}

function mountEncode(root) {
  const s = { format: 'datauri', urlsafe: false, nopad: false, wrap: 0 }
  let cur = null // {file, b64, mime}
  const out = h('div', { class: 'stack' })
  const zone = dropzone({ multiple: false, label: 'Drop a file here or click to choose', hint: 'Any file, up to 100 MB. It is encoded on this device and never uploaded.', onFiles: ([f]) => load(f) })

  const text = textarea({ readonly: true, mono: true, rows: 9, 'aria-label': 'Encoded output', spellcheck: false })
  const note = h('div', { class: 'small muted' })
  const statsEl = h('div')
  const format = select([['datauri', 'Data URI  (data:image/png;base64,...)'], ['raw', 'Raw Base64 only'], ['css', 'CSS background-image'], ['html', 'HTML tag (img, audio, video or link)'], ['json', 'JSON with name and type']], s.format, (v) => { s.format = v; refresh() })
  const urlsafe = toggle('URL-safe alphabet (- and _ instead of + and /)', false, (v) => { s.urlsafe = v; refresh() })
  const nopad = toggle('Remove = padding', false, (v) => { s.nopad = v; refresh() })
  const wrapSel = select([[0, 'No line breaks'], [64, 'Every 64 characters (PEM)'], [76, 'Every 76 characters (MIME email)']], 0, (v) => { s.wrap = +v; refresh() })
  const rawOnly = h('div', { class: 'stack tight' }, urlsafe, nopad, field('Line breaks', wrapSel))
  const rawNote = h('div', { class: 'small muted' })
  let fullText = ''

  async function load(file) {
    clear(out)
    if (file.size > MAX_ENCODE) { out.append(alert('error', `That file is ${formatBytes(file.size)}. Base64 text is a third larger than the file, so this tool stops at 100 MB. Use a command-line tool for bigger files.`)); return }
    zone.classList.add('compact')
    const holder = h('div', { class: 'stack' }, h('div', { class: 'fx-skel', style: 'height:90px' }))
    out.append(holder)
    try {
      const [b64, head] = await Promise.all([blobToBase64(file), readRange(file, 0, 4096)])
      const det = sniff(head, file.name)
      const mime = file.type || det?.mime || 'application/octet-stream'
      cur = { file, b64, mime }
      const thumb = mime.startsWith('image/') && /^image\/(png|jpeg|gif|webp|svg\+xml|bmp|avif|x-icon)$/.test(mime) ? h('div', { class: 'fx-thumb', style: 'width:96px;height:72px' }, h('img', { src: objectUrl(file), alt: '' })) : null
      clear(holder,
        h('div', { class: 'fx-hero fx-in', style: { '--k': 'var(--accent)' } }, thumb || docGlyph(file.name),
          h('div', { class: 'fx-body' }, h('div', { class: 'fx-title' }, file.name), h('div', { class: 'fx-sub' }, `${formatBytes(file.size)} · ${mime}`))),
        statsEl,
        h('div', { class: 'fx-bento' }, card('Format', 'settings-2', '#3e63dd', h('div', { class: 'stack tight' }, field('Output', format), rawOnly, rawNote)),
          card('Result', 'file-code', '#12a594', h('div', { class: 'stack tight' }, text, note,
            h('div', { class: 'row' }, copyButton(() => fullText, 'Copy all', { variant: 'primary', size: '' }),
              button('Download .txt', { icon: 'download', onClick: () => download(fullText, `${file.name}.base64.txt`, 'text/plain;charset=utf-8') }))))))
      refresh()
    } catch (e) { clear(holder, alert('error', errorMessage(e))) }
  }

  const refresh = debounce(() => {
    if (!cur) return
    const raw = s.format === 'raw'
    for (const el of rawOnly.querySelectorAll('input, select')) el.disabled = !raw
    rawOnly.style.opacity = raw ? '' : '.5'
    rawNote.textContent = raw ? '' : 'Alphabet, padding and line breaks only apply to raw Base64.'
    fullText = formatEncoded(cur.b64, { name: cur.file.name, mime: cur.mime, size: cur.file.size }, s)
    text.value = fullText.length > SHOW_CHARS ? fullText.slice(0, SHOW_CHARS) : fullText
    note.textContent = fullText.length > SHOW_CHARS ? `Showing the first ${SHOW_CHARS.toLocaleString()} of ${fullText.length.toLocaleString()} characters. Copy and Download use all of it.` : ''
    clear(statsEl, stats([
      { label: 'Original', value: formatBytes(cur.file.size) },
      { label: 'Encoded text', value: formatBytes(fullText.length), hint: `${fullText.length.toLocaleString()} characters`, accent: true },
      { label: 'Growth', value: cur.file.size ? `+${Math.round((fullText.length / cur.file.size - 1) * 100)}%` : '-', hint: 'Base64 adds about a third' },
    ]))
  }, 60)

  root.append(h('div', { class: 'stack fx' }, zone, out))
}

function mountDecode(root) {
  const input_ = textarea({ mono: true, rows: 8, placeholder: 'Paste Base64 or a data URI here, for example data:image/png;base64,iVBORw0KGgo...', 'aria-label': 'Base64 text', spellcheck: false })
  const result = h('div', { class: 'stack' })
  const zone = dropzone({
    multiple: false, compact: true, label: 'Or drop a text file that contains Base64', hint: '.txt, .b64, .base64 or any text file', paste: false,
    onFiles: async ([f]) => { if (f.size > 120 * 1024 * 1024) return result.replaceChildren(alert('error', 'That file is too large for this tool (limit about 120 MB of text).')); input_.value = await f.text(); run() },
  })
  const clearBtn = button('Clear', { variant: 'ghost', icon: 'eraser', size: 'sm', onClick: () => { input_.value = ''; run() } })
  const pasteBtn = navigator.clipboard?.readText ? button('Paste', { icon: 'clipboard-paste', size: 'sm', onClick: async () => { try { input_.value = await navigator.clipboard.readText(); run() } catch { /* denied */ } } }) : null
  let revoke = null

  const run = debounce(() => {
    revoke?.()
    revoke = null
    const p = parseBase64(input_.value)
    if (p.empty) return clear(result, h('div', { class: 'empty' }, h('div', 'The decoded file appears here. Nothing is uploaded.')))
    if (p.error) return clear(result, alert('error', p.error))
    const { bytes, mime } = p
    const det = sniff(bytes.subarray(0, 4096), '')
    const type = det?.mime || mime || 'application/octet-stream'
    const ext = det && !(det.text && det.ext === 'txt') ? det.ext : MIME_EXT[mime] || (det?.text ? 'txt' : 'bin')
    const blob = new Blob([bytes], { type })
    const url = URL.createObjectURL(blob)
    revoke = () => URL.revokeObjectURL(url)
    const kind = type.split('/')[0]
    let view
    if (/^image\/(png|jpeg|gif|webp|svg\+xml|bmp|avif|x-icon)$/.test(type)) view = h('img', { class: 'fx-media', src: url, alt: 'Decoded image' })
    else if (kind === 'audio') view = h('audio', { src: url, controls: true, style: 'width:100%' })
    else if (kind === 'video') view = h('video', { class: 'fx-media', src: url, controls: true })
    else if (type === 'application/pdf') view = h('object', { data: url, type, style: 'width:100%;height:50vh;border-radius:12px;border:1px solid var(--border)' })
    else if (!looksBinary(bytes.subarray(0, 4096))) view = h('pre', { class: 'code-out', style: 'max-height:280px' }, decodeText(bytes.subarray(0, 4000)) + (bytes.length > 4000 ? '\n...' : ''))
    const mismatch = mime && det && det.mime !== mime && !det.text && det.mime !== 'application/octet-stream'
    const nameIn = input({ value: `decoded.${ext}`, 'aria-label': 'File name', mono: true })
    clear(result,
      h('div', { class: 'fx-hero fx-in', style: { '--k': 'var(--success)' } }, checkRing('fx-pop'),
        h('div', { class: 'fx-body' }, h('div', { class: 'fx-title' }, 'Decoded successfully'),
          h('div', { class: 'fx-sub' }, `${formatBytes(bytes.length)} · ${det ? det.label : 'Unknown type'}${mime ? ` · declared ${mime}` : ''}`),
          h('div', { class: 'fx-chips' }, chip(type, '', 'fingerprint'), p.dataUri ? chip('Data URI', 'accent', 'link') : chip('Raw Base64', 'accent', 'code')))),
      mismatch ? alert('warn', `The text says ${mime}, but the bytes look like ${det.label}. The file name below uses the real type.`) : null,
      view ? h('div', { class: 'panel' }, view) : null,
      h('div', { class: 'row' }, field('File name', nameIn), h('div', { style: 'align-self:flex-end' }, button('Download file', { icon: 'download', variant: 'primary', size: 'lg', onClick: () => download(blob, nameIn.value.trim().replace(/[\\/:*?"<>|]+/g, '_') || 'decoded.bin') }))))
  }, 120)

  input_.addEventListener('input', run)
  run()
  root.append(h('div', { class: 'stack fx' }, h('div', { class: 'stack tight' }, input_, h('div', { class: 'row' }, pasteBtn, clearBtn, h('span', { class: 'small muted' }, 'Accepts raw Base64, URL-safe Base64 and full data URIs, with or without line breaks.'))), zone, result))
  return () => revoke?.()
}
