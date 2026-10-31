// Small helpers shared by the document converters. No DOM needed except parseXml / parseHtml (which use DOMParser).
import { bytesToBase64, base64ToBytes } from '../../lib/files.js'

export { bytesToBase64, base64ToBytes }
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** XML-safe text: also drops characters XML 1.0 forbids. */
export const xesc = (s) => esc(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
export const fail = (msg, cause) => Object.assign(new Error(msg), cause ? { cause } : {})
export const checkAbort = (signal) => { if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' }) }

export const u8 = async (file) => (file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer()))
export function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
export const utf8 = (s) => new TextEncoder().encode(s)
export const decodeText = (bytes, enc = 'utf-8') => {
  try { return new TextDecoder(enc).decode(bytes) } catch { return new TextDecoder('utf-8').decode(bytes) }
}
export const file = (data, name, type = 'application/octet-stream') => new File([data], name, { type })

export const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/emf', wmf: 'image/wmf' }
export const MIME = {
  pdf: 'application/pdf', html: 'text/html', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', eml: 'message/rfc822',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  rtf: 'application/rtf', epub: 'application/epub+zip', hwpx: 'application/hwp+zip', fods: 'application/xml', png: 'image/png', jpg: 'image/jpeg',
}
export const mimeFor = (ext) => MIME[ext] || IMAGE_MIME[ext] || 'application/octet-stream'

/** Sniff an image type from its first bytes. -> 'image/png' | ... | null */
export function sniffImage(b) {
  if (!b || b.length < 4) return null
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57) return 'image/webp'
  if (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) return 'image/tiff'
  if (b[0] === 0x01 && b[1] === 0x00 && b[2] === 0x00 && b[3] === 0x00) return 'image/emf'
  if (b[0] === 0xd7 && b[1] === 0xcd) return 'image/wmf'
  const head = new TextDecoder().decode(b.subarray(0, 200))
  if (/<svg[\s>]/i.test(head) || /^\s*<\?xml/.test(head) && /<svg/i.test(head)) return 'image/svg+xml'
  return null
}
export const dataUrl = (bytes, mime) => `data:${mime};base64,${bytesToBase64(bytes)}`
export function parseDataUrl(src) {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(src || '')
  if (!m) return null
  const b64 = /;base64/i.test(m[2])
  try { return { mime: m[1] || 'application/octet-stream', bytes: b64 ? base64ToBytes(m[3]) : utf8(decodeURIComponent(m[3])) } } catch { return null }
}

export function parseXml(text, what = 'XML') {
  const doc = new DOMParser().parseFromString(text.replace(/^﻿/, ''), 'application/xml')
  const err = doc.getElementsByTagName('parsererror')[0]
  if (err) throw fail(`Could not read the ${what} inside this file. It may be damaged.`)
  return doc
}
export const parseHtml = (html) => new DOMParser().parseFromString(html, 'text/html')
export const kids = (el, name) => (el ? [...el.children].filter((c) => c.localName === name) : [])
export const kid = (el, name) => (el ? [...el.children].find((c) => c.localName === name) || null : null)
export const deep = (el, name) => (el ? [...el.getElementsByTagName('*')].filter((c) => c.localName === name) : [])
export const attrNS = (el, name) => {
  if (!el) return null
  const direct = el.getAttribute(name)
  if (direct != null) return direct
  for (const a of el.attributes) if (a.localName === name) return a.value
  return null
}

/** Image size in pixels from a PNG / JPEG / GIF / BMP header, or null. Async fallback decodes the image. */
export function imageSizeSync(b, mime) {
  try {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
    if (mime === 'image/png') return { w: dv.getUint32(16), h: dv.getUint32(20) }
    if (mime === 'image/gif') return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) }
    if (mime === 'image/bmp') return { w: Math.abs(dv.getInt32(18, true)), h: Math.abs(dv.getInt32(22, true)) }
    if (mime === 'image/jpeg') {
      let i = 2
      while (i < b.length - 9) {
        if (b[i] !== 0xff) { i++; continue }
        const m = b[i + 1]
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: dv.getUint16(i + 5), w: dv.getUint16(i + 7) }
        i += 2 + dv.getUint16(i + 2)
      }
    }
  } catch { /* fall through */ }
  return null
}

/**
 * Make an image usable in office formats: PNG / JPEG / GIF pass through, anything else the browser can draw (WebP, SVG, ...) becomes PNG.
 * -> {bytes, mime, w, h} or null when it cannot be decoded.
 */
export async function normalizeImage(bytes, mime) {
  mime = mime && mime !== 'application/octet-stream' ? mime : sniffImage(bytes)
  if (!mime) return null
  if (/^image\/(png|jpeg|gif)$/.test(mime)) {
    const s = imageSizeSync(bytes, mime)
    if (s && s.w > 0 && s.h > 0) return { bytes, mime, ...s }
  }
  if (/emf|wmf|tiff/.test(mime)) return null
  try {
    const blob = new Blob([bytes], { type: mime })
    const bmp = await createImageBitmap(blob)
    let w = bmp.width, h = bmp.height
    if (!w || !h) { w = 300; h = 150 }
    const c = new OffscreenCanvas(w, h)
    c.getContext('2d').drawImage(bmp, 0, 0, w, h)
    const out = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
    return { bytes: out, mime: 'image/png', w, h }
  } catch {
    if (mime === 'image/svg+xml') {
      // createImageBitmap cannot decode SVG blobs: go through an <img>
      try {
        const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
        const img = new Image()
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url })
        const w = img.naturalWidth || 300, h = img.naturalHeight || 150
        const c = new OffscreenCanvas(w, h)
        c.getContext('2d').drawImage(img, 0, 0, w, h)
        URL.revokeObjectURL(url)
        return { bytes: new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()), mime: 'image/png', w, h }
      } catch { return null }
    }
    return null
  }
}

/** "#rrggbb" / "rgb(...)" / named colors -> "rrggbb" or null. Needs a DOM only for named colors. */
export function hex6(c) {
  if (!c) return null
  c = String(c).trim().toLowerCase()
  let m = /^#([0-9a-f]{6})$/.exec(c)
  if (m) return m[1]
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(c)
  if (m) return m[1] + m[1] + m[2] + m[2] + m[3] + m[3]
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(c)
  if (m) return [m[1], m[2], m[3]].map((n) => Math.min(255, +n).toString(16).padStart(2, '0')).join('')
  const NAMED = { black: '000000', white: 'ffffff', red: 'ff0000', green: '008000', blue: '0000ff', yellow: 'ffff00', gray: '808080', grey: '808080', orange: 'ffa500', purple: '800080', navy: '000080', maroon: '800000', teal: '008080', silver: 'c0c0c0', lime: '00ff00', aqua: '00ffff', fuchsia: 'ff00ff', brown: 'a52a2a', pink: 'ffc0cb' }
  return NAMED[c] || null
}
export const NUMBERED = (n) => String(n)
export const romanOf = (n) => { const t = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let s = ''; for (const [v, r] of t) while (n >= v) { s += r; n -= v } return s }
export const alphaOf = (n) => { let s = ''; while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26) } return s }

export function formatSize(n) {
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}
