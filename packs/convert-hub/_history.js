// Recent conversions: the last 30 results kept in IndexedDB on this device (about 300 MB in total, oldest dropped first).
import * as idb from '../../lib/idb.js'
import { ext as extOf } from '../../lib/files.js'
import { fileType } from '../../lib/ui.js'

const INDEX = 'fc-hist:index'
const blobKey = (id) => `fc-hist:b:${id}`
export const MAX_ENTRIES = 30
export const MAX_BYTES = 300 * 1024 * 1024

let chain = Promise.resolve()
const serial = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p }

export async function list() {
  const idx = (await idb.get(INDEX)) || []
  return [...idx].sort((a, b) => b.date - a.date)
}

const canvasThumb = (src, w, h) => {
  const k = Math.min(1, 96 / Math.max(w, h))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k))
  const g = c.getContext('2d')
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height)
  g.drawImage(src, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.7)
}

/** A small picture for the list: the image itself, the first page of a PDF, a video frame; null when it would be costly. */
export async function makeThumb(file) {
  const type = fileType(file), ext = extOf(file.name)
  try {
    if (/^image\/(jpeg|png|webp|gif|bmp|avif)/.test(type)) {
      const bmp = await createImageBitmap(file)
      const t = canvasThumb(bmp, bmp.width, bmp.height)
      bmp.close?.()
      return t
    }
    if ((type === 'application/pdf' || ext === 'pdf') && file.size < 40 * 1024 * 1024) {
      const { openPdf, thumbnail } = await import('../../lib/pdf.js')
      const doc = await openPdf(file)
      try { const c = await thumbnail(doc, 1, 120); return canvasThumb(c, c.width, c.height) } finally { doc.destroy?.() }
    }
    if (type.startsWith('video/') && file.size < 300 * 1024 * 1024) {
      const url = URL.createObjectURL(file)
      try {
        const v = document.createElement('video')
        v.muted = true; v.preload = 'auto'; v.src = url
        await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej; setTimeout(rej, 4000) })
        v.currentTime = Math.min(0.5, (v.duration || 1) / 2)
        await new Promise((res) => { v.onseeked = res; setTimeout(res, 1500) })
        return canvasThumb(v, v.videoWidth || 160, v.videoHeight || 90)
      } finally { URL.revokeObjectURL(url) }
    }
  } catch { /* no thumbnail: the list shows a format badge */ }
  return null
}

/** Save a result. Returns the entry, or null when storage is blocked. */
export function addResult(file, { from = '', to = '' } = {}) {
  return serial(async () => {
    const thumb = await makeThumb(file)
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const entry = { id, name: file.name, size: file.size, type: file.type || fileType(file), date: Date.now(), from, to, thumb }
    if (!(await idb.set(blobKey(id), file))) return null
    const idx = (await idb.get(INDEX)) || []
    idx.push(entry)
    idx.sort((a, b) => b.date - a.date)
    let total = 0
    const keep = []
    for (const e of idx) {
      if (keep.length < MAX_ENTRIES && (total + e.size <= MAX_BYTES || keep.length === 0)) { keep.push(e); total += e.size } else await idb.del(blobKey(e.id))
    }
    await idb.set(INDEX, keep)
    return entry
  })
}

export const getFile = (id) => idb.get(blobKey(id))
export function remove(id) {
  return serial(async () => {
    await idb.del(blobKey(id))
    await idb.set(INDEX, ((await idb.get(INDEX)) || []).filter((e) => e.id !== id))
  })
}
export function clear() {
  return serial(async () => {
    for (const e of (await idb.get(INDEX)) || []) await idb.del(blobKey(e.id))
    await idb.set(INDEX, [])
  })
}
