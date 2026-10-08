// File helpers shared by tools. Everything here runs locally; nothing is uploaded.
import { jszip } from './libs.js'
export { download, formatBytes } from './ui.js'

export const ext = (name = '') => (name.match(/\.([^.\/\\]+)$/)?.[1] || '').toLowerCase()
export const baseName = (name = '') => name.replace(/\.[^.\/\\]+$/, '')
/** withExt('photo.jpeg', 'png') -> 'photo.png' */
export const withExt = (name, newExt) => `${baseName(name) || 'file'}.${newExt.replace(/^\./, '')}`
/** suffixName('report.pdf', 'compressed') -> 'report-compressed.pdf' */
export const suffixName = (name, suffix, newExt) => `${baseName(name) || 'file'}-${suffix}.${(newExt || ext(name) || 'bin').replace(/^\./, '')}`
export const safeName = (name) => name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || 'file'

export const readText = (file) => file.text()
export const readBuffer = (file) => file.arrayBuffer()
export const readBytes = async (file) => new Uint8Array(await file.arrayBuffer())
export function readDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}
/** Base64 without the data: prefix. */
export const blobToBase64 = async (blob) => (await readDataURL(blob)).split(',')[1]
export function base64ToBytes(b64) {
  const bin = atob(b64.replace(/^data:[^,]*,/, '').replace(/\s+/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
export function bytesToBase64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** zip([{name, data: Blob|ArrayBuffer|Uint8Array|string}]) -> Blob */
export async function zip(entries, onProgress) {
  const JSZip = await jszip()
  const z = new JSZip()
  const used = new Set()
  for (const { name, data } of entries) {
    let n = name, i = 1
    while (used.has(n)) n = `${baseName(name)} (${i++})${ext(name) ? '.' + ext(name) : ''}`
    used.add(n)
    z.file(n, data)
  }
  return z.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }, (m) => onProgress?.(m.percent / 100))
}

/** Open a native file picker. Resolves with File[] (empty if cancelled). */
export function pickFiles({ accept = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept, multiple })
    inp.onchange = () => resolve([...inp.files])
    inp.oncancel = () => resolve([])
    inp.click()
  })
}

/** Pick a folder. Resolves with File[]; each file has webkitRelativePath. */
export function pickFolder() {
  return new Promise((resolve) => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', multiple: true })
    inp.webkitdirectory = true
    inp.onchange = () => resolve([...inp.files])
    inp.oncancel = () => resolve([])
    inp.click()
  })
}

/** Guess a MIME type from an extension for files with an empty .type */
export function mimeOf(file) {
  if (file.type) return file.type
  return ({
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
    heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', bmp: 'image/bmp', txt: 'text/plain', csv: 'text/csv', json: 'application/json',
    md: 'text/markdown', html: 'text/html', xml: 'application/xml', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', zip: 'application/zip',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  })[ext(file.name)] || 'application/octet-stream'
}
