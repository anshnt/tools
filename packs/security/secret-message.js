// Secret message encoder: hide text inside text with zero-width characters, or inside a PNG with LSB steganography. Reveal both again.
// Optional password: the hidden bytes are sealed with AES-256-GCM (see _shared.js) so the message is hidden AND unreadable without it.
import { h, icon, field, textarea, segmented, panel, button, alert, clear, busy, tabs, dropzone, stats, toast, formatBytes, formatNumber, debounce, download, preview } from '../../lib/ui.js'
import { loadImage, toCanvas, toBlob } from '../../lib/image.js'
import { baseName } from '../../lib/files.js'
import { useStyles, secretInput, copyBtn, burst, utf8, fromUtf8, encryptBytes, decryptBytes } from './_shared.js'

// ---------- Zero-width text ----------
const ZW = ['​', '‌', '‍', '⁠'] // 2 bits each
const ZW_RUN = /[​‌‍⁠]{20,}/g
const MAGIC_ZW = 0x5a
/** Invisible characters worth reporting (a superset of the four we write). */
const INVISIBLE = /[­͏؜᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]|[\u{E0000}-\u{E007F}]/gu
const NAMES = { 0xad: 'soft hyphen', 0x34f: 'combining grapheme joiner', 0x61c: 'Arabic letter mark', 0x180e: 'Mongolian vowel separator', 0x200b: 'zero width space', 0x200c: 'zero width non-joiner', 0x200d: 'zero width joiner', 0x200e: 'left-to-right mark', 0x200f: 'right-to-left mark', 0x2060: 'word joiner', 0x2061: 'function application', 0x2062: 'invisible times', 0x2063: 'invisible separator', 0x2064: 'invisible plus', 0xfeff: 'zero width no-break space (BOM)' }
const nameOf = (cp) => NAMES[cp] || (cp >= 0xe0000 ? 'tag character' : cp >= 0x202a && cp <= 0x202e ? 'text direction control' : cp >= 0x2066 && cp <= 0x2069 ? 'text isolate control' : 'invisible character')

export function zwEncode(bytes) {
  let s = ''
  for (const b of bytes) s += ZW[b >> 6] + ZW[(b >> 4) & 3] + ZW[(b >> 2) & 3] + ZW[b & 3]
  return s
}
export function zwDecode(str) {
  const syms = [...str].filter((c) => ZW.includes(c))
  const out = new Uint8Array(Math.floor(syms.length / 4))
  for (let i = 0; i < out.length; i++) out[i] = (ZW.indexOf(syms[i * 4]) << 6) | (ZW.indexOf(syms[i * 4 + 1]) << 4) | (ZW.indexOf(syms[i * 4 + 2]) << 2) | ZW.indexOf(syms[i * 4 + 3])
  return out
}
const xor = (b) => b.reduce((a, x) => a ^ x, 0)
/** Packet: [0x5A][flags][len hi][len lo][payload][xor checksum]. */
export const zwPack = (payload, encrypted) => {
  if (payload.length > 65535) throw new Error('That message is too long to hide in text (limit 64 KB).')
  const p = new Uint8Array(payload.length + 5)
  p[0] = MAGIC_ZW; p[1] = encrypted ? 1 : 0; p[2] = payload.length >> 8; p[3] = payload.length & 255
  p.set(payload, 4)
  p[p.length - 1] = xor(payload)
  return p
}
export function zwUnpack(bytes) {
  if (bytes.length < 5 || bytes[0] !== MAGIC_ZW) return null
  const len = (bytes[2] << 8) | bytes[3]
  if (bytes.length < len + 5) return null
  const payload = bytes.slice(4, 4 + len)
  if (bytes[4 + len] !== xor(payload)) return null
  return { encrypted: !!(bytes[1] & 1), payload }
}
export async function hideInText(cover, message, password, where = 'word') {
  const raw = utf8(message)
  const packed = zwPack(password ? await encryptBytes(raw, password) : raw, !!password)
  const hidden = zwEncode(packed)
  const chars = [...cover]
  let at = chars.length
  if (where === 'word') { const sp = chars.findIndex((c) => /\s/.test(c)); at = sp < 0 ? chars.length : sp }
  return { text: chars.slice(0, at).join('') + hidden + chars.slice(at).join(''), hiddenChars: [...hidden].length }
}
/** Scan text for hidden packets and invisible characters. */
export function inspectText(text) {
  const packets = []
  for (const m of text.matchAll(ZW_RUN)) {
    const p = zwUnpack(zwDecode(m[0]))
    if (p) packets.push(p)
  }
  const counts = new Map()
  for (const c of text.matchAll(INVISIBLE)) counts.set(c[0].codePointAt(0), (counts.get(c[0].codePointAt(0)) || 0) + 1)
  return { packets, counts, total: [...counts.values()].reduce((a, b) => a + b, 0), clean: text.replace(INVISIBLE, '') }
}

// ---------- PNG LSB ----------
const IMG_MAGIC = [0x53, 0x58, 0x4d, 0x31] // "SXM1"
const HEAD = 9 // magic(4) flags(1) length u32(4)
export const lsbCapacity = (w, h) => Math.max(0, Math.floor((w * h * 3) / 8) - HEAD)
/** Write header + payload into the least significant bit of the R, G and B bytes. data is RGBA with alpha 255. */
export function lsbEmbed(data, payload, encrypted) {
  const bytes = new Uint8Array(HEAD + payload.length)
  bytes.set(IMG_MAGIC)
  bytes[4] = encrypted ? 1 : 0
  new DataView(bytes.buffer).setUint32(5, payload.length)
  bytes.set(payload, HEAD)
  if (bytes.length * 8 > Math.floor(data.length / 4) * 3) throw new Error('The message does not fit in this image.')
  let bit = 0
  for (const b of bytes) for (let k = 7; k >= 0; k--, bit++) {
    const i = Math.floor(bit / 3) * 4 + (bit % 3)
    data[i] = (data[i] & 0xfe) | ((b >> k) & 1)
  }
}
export function lsbExtract(data) {
  const avail = Math.floor(data.length / 4) * 3
  const readBits = (start, n) => {
    const out = new Uint8Array(n)
    for (let j = 0; j < n * 8; j++) {
      const bit = start * 8 + j
      const i = Math.floor(bit / 3) * 4 + (bit % 3)
      out[j >> 3] = (out[j >> 3] << 1) | (data[i] & 1)
    }
    return out
  }
  if (avail < HEAD * 8) return null
  const head = readBits(0, HEAD)
  if (IMG_MAGIC.some((m, i) => head[i] !== m)) return null
  const len = new DataView(head.buffer).getUint32(5)
  if ((HEAD + len) * 8 > avail) return null
  return { encrypted: !!(head[4] & 1), payload: readBits(HEAD, len) }
}
async function pixelsOf(file, background) {
  const img = await loadImage(file)
  const c = toCanvas(img, img.naturalWidth || img.width, img.naturalHeight || img.height, { background, smoothing: 'low' })
  const ctx = c.getContext('2d', { willReadFrequently: true })
  return { c, ctx, d: ctx.getImageData(0, 0, c.width, c.height) }
}

const CSS = `
.sx-sm-out{font-family:var(--mono);font-size:14px;line-height:1.55;padding:14px 16px;border-radius:16px;border:1px dashed var(--border-strong);background:var(--surface-2);overflow-wrap:anywhere;white-space:pre-wrap;min-height:56px}
.sx-sm-out .zw{display:inline-block;width:6px;height:1.1em;margin:0 .5px;vertical-align:text-bottom;border-radius:2px;background:linear-gradient(var(--accent),var(--accent-2));opacity:.75}
.sx-sm-found{display:flex;gap:14px;align-items:flex-start;padding:16px 18px;border-radius:20px;border:1.5px solid transparent;background:linear-gradient(var(--surface),var(--surface)) padding-box,var(--brand) border-box;box-shadow:var(--shadow);animation:sx-in .45s var(--ease) both}
.sx-sm-found .ic{width:42px;height:42px;border-radius:13px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);flex:none}
.sx-sm-found .msg{white-space:pre-wrap;overflow-wrap:anywhere;font-size:16px;line-height:1.5;flex:1;min-width:0}
.sx-sm-cap{height:10px;border-radius:99px;background:var(--surface-3);overflow:hidden}
.sx-sm-cap i{display:block;height:100%;width:0;background:var(--brand);border-radius:inherit;transition:width .5s var(--ease)}
.sx-sm-cap.over i{background:var(--danger)}
.sx-sm-pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.sx-sm-pair figure{margin:0;display:flex;flex-direction:column;gap:6px}
.sx-sm-pair figcaption{font-size:12px;color:var(--muted);text-align:center}
.sx-sm-pair canvas,.sx-sm-pair img{width:100%;height:auto;max-height:340px;object-fit:contain;border-radius:12px;display:block}
.sx-inv{display:flex;flex-wrap:wrap;gap:8px}
.sx-inv span{font-size:12.5px;padding:4px 10px;border-radius:99px;background:var(--surface-2);border:1px solid var(--border)}
.sx-inv b{font-variant-numeric:tabular-nums}
@media (max-width:560px){.sx-sm-pair{grid-template-columns:1fr}}
`

export function mount(root) {
  useStyles('sx-secret', CSS)

  const seeZw = (s) => { const f = document.createDocumentFragment(); for (const c of s) f.append(ZW.includes(c) ? h('span', { class: 'zw', title: nameOf(c.codePointAt(0)) }) : c); return f }

  // ---------- Text: hide ----------
  function textHide() {
    const cover = textarea({ rows: 3, value: 'Nothing unusual to see in this sentence.', 'aria-label': 'Visible cover text', oninput: () => run() })
    const secret = textarea({ rows: 3, placeholder: 'The message you want to hide', 'aria-label': 'Secret message', oninput: () => run() })
    const pw = secretInput({ placeholder: 'Optional password', ariaLabel: 'Optional password', onInput: () => run() })
    const where = segmented([['word', 'After the first word'], ['end', 'At the end']], 'word', () => run(), 'Where to hide it')
    const out = h('div')
    let last = ''
    let seq = 0
    const run = debounce(async () => {
      const mine = ++seq
      if (!secret.value) return clear(out, alert('info', 'Type a secret message to hide it inside the cover text.'))
      if (!cover.value.trim()) return clear(out, alert('info', 'Add some cover text. The hidden message rides along inside it.'))
      let r
      try { r = await hideInText(cover.value, secret.value, pw.input.value, where.value) } catch (e) { return clear(out, alert('error', e.message)) }
      if (mine !== seq) return
      last = r.text
      const vis = [...cover.value].length
      clear(out, h('div', { class: 'stack' },
        h('div', { class: 'row', style: 'justify-content:space-between' }, h('div', { class: 'sx-k' }, icon('venetian-mask'), 'Text with a hidden message'), copyBtn(() => last, 'Copy text')),
        h('div', { class: 'sx-sm-out' }, last),
        stats([{ label: 'Looks like', value: `${vis} characters`, hint: 'same as your cover text', accent: true }, { label: 'Actually contains', value: `${[...last].length}`, hint: `${r.hiddenChars} invisible characters${pw.input.value ? ', encrypted' : ''}` }]),
        h('details', { class: 'panel' }, h('summary', { style: 'cursor:pointer;font-weight:600' }, 'Show where the invisible characters are'), h('div', { class: 'sx-sm-out', style: 'margin-top:12px' }, seeZw(last))),
        h('div', { class: 'sx-hint' }, 'Paste it into any text box. Some apps strip invisible characters (many editors and a few chat apps do), so test with the app you will use first.')))
    }, 250)
    run()
    return h('div', { class: 'stack' }, panel(h('div', { class: 'stack' },
      field('Visible cover text', cover),
      field('Secret message', secret),
      h('div', { class: 'sx-cols' }, field('Password (optional)', pw, 'Encrypts the hidden message with AES-256-GCM.'), h('div', { class: 'stack tight' }, h('div', { class: 'field-label' }, 'Position'), where)))), out)
  }

  // ---------- Text: reveal ----------
  function textReveal() {
    const input = textarea({ rows: 5, placeholder: 'Paste text that may contain a hidden message', 'aria-label': 'Text to inspect', oninput: () => run() })
    const pw = secretInput({ placeholder: 'Password (if the message is encrypted)', ariaLabel: 'Password for the hidden message', onInput: () => run() })
    const out = h('div', { class: 'stack' })
    let seq = 0
    const run = debounce(async () => {
      const mine = ++seq
      const text = input.value
      if (!text) return clear(out, alert('info', 'Paste some text above. This checks for messages hidden by this tool and lists any invisible characters.'))
      const r = inspectText(text)
      const parts = []
      for (const p of r.packets) {
        if (!p.encrypted) parts.push(found(fromUtf8(p.payload), false))
        else if (!pw.input.value) parts.push(alert('warn', 'A hidden message was found, but it is encrypted. Enter the password above to read it.'))
        else {
          try { parts.push(found(fromUtf8(await decryptBytes(p.payload, pw.input.value)), true)) } catch (e) { parts.push(alert('error', e.message)) }
        }
      }
      if (mine !== seq) return
      if (!r.packets.length) parts.push(r.total ? alert('info', `No message from this tool, but the text has ${r.total} invisible character${r.total === 1 ? '' : 's'}. They are listed below.`) : alert('success', 'No hidden characters found. This text is clean.'))
      if (r.total) {
        parts.push(h('div', { class: 'stack tight' }, h('div', { class: 'sx-k' }, icon('eye-off'), 'Invisible characters'),
          h('div', { class: 'sx-inv' }, [...r.counts].map(([cp, n]) => h('span', h('b', n), ` x ${nameOf(cp)} (U+${cp.toString(16).toUpperCase().padStart(4, '0')})`)))))
        parts.push(h('div', { class: 'row' }, copyBtn(() => r.clean, 'Copy cleaned text'), h('span', { class: 'sx-hint' }, 'Removes every invisible character listed above (this also removes legitimate joiners in some emoji and scripts).')))
        parts.push(h('div', { class: 'sx-sm-out' }, seeZw(text)))
      }
      clear(out, ...parts)
    }, 250)
    function found(msg, enc) {
      const el = h('div', { class: 'sx-sm-found' }, h('div', { class: 'ic' }, icon(enc ? 'lock-open' : 'mail-open')), h('div', { class: 'stack tight', style: 'flex:1;min-width:0' },
        h('div', { class: 'sx-k' }, 'Hidden message', enc ? ' (decrypted)' : ''), h('div', { class: 'msg' }, msg), h('div', { class: 'row' }, copyBtn(() => msg, 'Copy message'))))
      setTimeout(() => burst(el.querySelector('.ic')), 60)
      return el
    }
    run()
    return h('div', { class: 'stack' }, panel(h('div', { class: 'stack' }, field('Text', input), field('Password (only if encrypted)', pw))), out)
  }

  // ---------- Image: hide ----------
  function imageHide() {
    let file = null, cap = 0, dims = null
    const secret = textarea({ rows: 4, placeholder: 'The message you want to hide', 'aria-label': 'Secret message', oninput: () => updateCap() })
    const pw = secretInput({ placeholder: 'Optional password', ariaLabel: 'Optional password', onInput: () => updateCap() })
    const capBar = h('div', { class: 'sx-sm-cap' }, h('i'))
    const capText = h('div', { class: 'sx-hint' }, 'Choose an image to see how much text it can hold.')
    const info = h('div')
    const go = button('Hide message', { icon: 'venetian-mask', variant: 'primary', size: 'lg' })
    go.disabled = true
    const out = h('div')
    const zone = dropzone({ accept: 'image/*', multiple: false, label: 'Choose a cover image', hint: 'JPG, PNG, WebP and more. The result is always a PNG.', onFiles: async ([f]) => {
      file = f
      zone.classList.add('compact')
      clear(out)
      try {
        const img = await loadImage(f)
        dims = { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height }
        cap = lsbCapacity(dims.w, dims.h)
        clear(info, h('div', { class: 'sx-file' }, h('div', { class: 'ic' }, icon('image')), h('div', { class: 'meta' }, h('div', { class: 'name', title: f.name }, f.name), h('div', { class: 'size' }, `${dims.w} x ${dims.h} px - holds up to ${formatBytes(cap)} of text`))))
        updateCap()
      } catch (e) { clear(info, alert('error', e.message)); file = null; go.disabled = true }
    } })
    const overhead = () => (pw.input.value ? 33 + 16 : 0)
    function updateCap() {
      const need = utf8(secret.value).length + overhead()
      go.disabled = !file || !need || need > cap
      if (!file) return
      capBar.classList.toggle('over', need > cap)
      capBar.firstChild.style.width = `${Math.min(100, (need / Math.max(1, cap)) * 100)}%`
      capText.textContent = need > cap ? `Too long: needs ${formatBytes(need)} but this image holds ${formatBytes(cap)}. Shorten the message or pick a larger image.` : `${formatBytes(need)} of ${formatBytes(cap)} used (${formatNumber((need / Math.max(1, cap)) * 100, 1)}%)${pw.input.value ? ', including encryption overhead' : ''}.`
    }
    go.addEventListener('click', () => busy(go, async () => {
      clear(out)
      if (!file) throw new Error('Choose a cover image first.')
      if (!secret.value) throw new Error('Type the message to hide.')
      const raw = utf8(secret.value)
      const payload = pw.input.value ? await encryptBytes(raw, pw.input.value) : raw
      const { c, ctx, d } = await pixelsOf(file, '#ffffff')
      if (HEAD + payload.length > lsbCapacity(c.width, c.height) + HEAD) throw new Error('The message does not fit in this image. Use a larger image or a shorter message.')
      lsbEmbed(d.data, payload, !!pw.input.value)
      ctx.putImageData(d, 0, 0)
      const blob = await toBlob(c, 'image/png')
      const name = `${baseName(file.name) || 'image'}-secret.png`
      const orig = URL.createObjectURL(file)
      const res = URL.createObjectURL(blob)
      const before = h('img', { src: orig, alt: 'Original image' })
      const after = h('img', { src: res, alt: 'Image with hidden message' })
      setTimeout(() => { URL.revokeObjectURL(orig); URL.revokeObjectURL(res) }, 600_000)
      clear(out, h('div', { class: 'stack' },
        alert('success', h('strong', 'Message hidden. '), `${formatBytes(payload.length)} stored in ${c.width} x ${c.height} px. The picture looks the same: no channel changes by more than 1 out of 255.`),
        h('div', { class: 'sx-sm-pair' }, h('figure', preview(before), h('figcaption', 'Original')), h('figure', preview(after), h('figcaption', 'With hidden message'))),
        h('div', { class: 'row' }, button(`Download ${name}`, { icon: 'download', variant: 'primary', onClick: () => download(blob, name) })),
        h('div', { class: 'sx-hint' }, 'Share the PNG as a file or document. Messengers and social networks that recompress photos destroy the hidden data. Privacy browsers that randomise canvas pixels (Brave shields) can also break extraction.')))
      burst(go)
    }, { label: 'Hiding', errorTo: out }))
    return h('div', { class: 'stack' }, panel(h('div', { class: 'stack' }, zone, info,
      field('Secret message', secret), capBar, capText,
      field('Password (optional)', pw, 'Encrypts the message before hiding it, so it is also unreadable if someone finds it.'),
      h('div', { class: 'row' }, go))), out)
  }

  // ---------- Image: extract ----------
  function imageReveal() {
    const out = h('div', { class: 'stack' })
    const zone = dropzone({ accept: 'image/png,.png', multiple: false, label: 'Choose the PNG with the hidden message', hint: 'It must be the exact file this tool produced (PNG)', onFiles: ([f]) => scan(f) })
    async function scan(f) {
      clear(out, h('div', { class: 'sx-skel' }))
      zone.classList.add('compact')
      try {
        const { d } = await pixelsOf(f, undefined)
        const r = lsbExtract(d.data)
        if (!r) return clear(out, alert('warn', 'No hidden message found. Either this image has none from this tool, or it was recompressed or edited after the message was hidden.'))
        if (!r.encrypted) return clear(out, show(fromUtf8(r.payload), false))
        const pw = secretInput({ placeholder: 'Password', ariaLabel: 'Password for the hidden message' })
        const unlock = button('Decrypt', { icon: 'lock-open', variant: 'primary' })
        const res = h('div')
        const go = () => busy(unlock, async () => { clear(res); clear(res, show(fromUtf8(await decryptBytes(r.payload, pw.input.value)), true)) }, { label: 'Decrypting', errorTo: res })
        unlock.addEventListener('click', go)
        pw.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go() })
        clear(out, alert('info', 'A hidden message was found. It is encrypted, so enter the password.'), field('Password', pw), h('div', { class: 'row' }, unlock), res)
      } catch (e) { clear(out, alert('error', e.message)) }
    }
    function show(msg, enc) {
      const el = h('div', { class: 'sx-sm-found' }, h('div', { class: 'ic' }, icon(enc ? 'lock-open' : 'mail-open')), h('div', { class: 'stack tight', style: 'flex:1;min-width:0' },
        h('div', { class: 'sx-k' }, 'Hidden message', enc ? ' (decrypted)' : ''), h('div', { class: 'msg' }, msg), h('div', { class: 'row' }, copyBtn(() => msg, 'Copy message'))))
      setTimeout(() => burst(el.querySelector('.ic')), 60)
      return el
    }
    return h('div', { class: 'stack' }, panel(h('div', { class: 'stack' }, zone)), out)
  }

  const sub = (a, b) => {
    const A = a(), B = b()
    const seg = segmented([['hide', 'Hide a message'], ['reveal', 'Reveal a message']], 'hide', (v) => { A.hidden = v !== 'hide'; B.hidden = v !== 'reveal' }, 'Direction')
    B.hidden = true
    return h('div', { class: 'stack' }, seg, A, B)
  }
  root.append(h('div', { class: 'sx stack' },
    tabs([{ id: 'text', label: 'In text', render: () => sub(textHide, textReveal) }, { id: 'image', label: 'In a PNG image', render: () => sub(imageHide, imageReveal) }], 'text'),
    h('div', { class: 'sx-hint' }, 'Steganography hides that a message exists; it is not strong secrecy on its own. Add a password to encrypt the message too. Everything happens in this tab.')))
}
