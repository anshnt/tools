// Image assets for Draw Studio: Blobs live here, outside the document. Nodes hold an asset id; object URLs are created lazily and revoked
// together, so history, autosave records and the DOM never see base64. Data URLs exist only while an export runs (ensureDataUrls).
import { yieldToMain } from '../../lib/ui.js'
import { readDataURL } from '../../lib/files.js'
import { MAX_PIXELS } from '../../lib/image.js'
import { LIMITS } from './_ds-doc.js'

const MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']
/** Image type from the first bytes (the declared type of a file or data URL is never trusted), or null. */
export function sniffImage(b) {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  return null
}

export function createAssets() {
  const items = new Map() // id -> {blob, w, h, mime, name}
  const urls = new Map()
  const keys = new Map() // dedupe key (an href string) -> id
  let seq = 0, bytes = 0
  let dataUrls = new Map()
  const api = {
    /** Add an image Blob. Resolves {id, w, h}. Throws readable errors for unknown types, oversized images and limits. */
    async addBlob(blob, name = '', { key } = {}) {
      if (key && keys.has(key)) return { id: keys.get(key), ...items.get(keys.get(key)) }
      if (items.size >= LIMITS.images) throw new Error('This drawing has more than 500 pictures, which is too many to open here.')
      if (bytes + blob.size > LIMITS.imageBytes) throw new Error('The pictures in this drawing are larger than 400 MB together, which is too much to open here.')
      const mime = sniffImage(new Uint8Array(await blob.slice(0, 16).arrayBuffer()))
      if (!mime || !MIMES.includes(mime)) throw new Error('This picture is not a PNG, JPEG, WebP, GIF or BMP image.')
      const typed = blob.type === mime ? blob : new Blob([blob], { type: mime })
      let w, h
      try { const bmp = await createImageBitmap(typed); w = bmp.width; h = bmp.height; bmp.close?.() } catch { throw new Error('This picture could not be decoded. It may be damaged.') }
      if (w * h > MAX_PIXELS) throw new Error(`This picture is too large to open here (${w} x ${h} pixels).`)
      const id = `a${++seq}`
      items.set(id, { blob: typed, w, h, mime, name })
      bytes += typed.size
      if (key) keys.set(key, id)
      return { id, w, h }
    },
    /** Raw RGBA pixels (a CDR bitmap) -> PNG asset. */
    async addRgba(rgba, w, h, name = '') {
      const c = document.createElement('canvas')
      c.width = w; c.height = h
      c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4), w, h), 0, 0)
      const blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode a bitmap.'))), 'image/png'))
      c.width = c.height = 0
      return api.addBlob(blob, name)
    },
    has: (id) => items.has(id),
    blob: (id) => items.get(id)?.blob || null,
    dims: (id) => { const a = items.get(id); return a ? { w: a.w, h: a.h } : null },
    mime: (id) => items.get(id)?.mime || null,
    url(id) {
      const a = items.get(id)
      if (!a) return ''
      if (!urls.has(id)) urls.set(id, URL.createObjectURL(a.blob))
      return urls.get(id)
    },
    get size() { return items.size },
    get bytes() { return bytes },
    ids: () => [...items.keys()],
    /** data: URLs for the given ids (read one at a time so the page stays responsive). Kept until dropDataUrls(). */
    async ensureDataUrls(ids, signal) {
      for (const id of ids) {
        if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
        if (dataUrls.has(id) || !items.has(id)) continue
        dataUrls.set(id, await readDataURL(items.get(id).blob))
        await yieldToMain()
      }
      return dataUrls
    },
    dataUrl: (id) => dataUrls.get(id) || null,
    dropDataUrls() { dataUrls = new Map() },
    /** Forget assets that no document node references any more (ids still in `keep`). */
    prune(keep) {
      for (const id of [...items.keys()]) if (!keep.has(id)) { bytes -= items.get(id).blob.size; items.delete(id); if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id) } }
      for (const [k, id] of keys) if (!items.has(id)) keys.delete(k)
    },
    serialize: (ids) => ids.filter((id) => items.has(id)).map((id) => ({ id, ...items.get(id) })),
    /**
     * Re-add assets read from storage. A stored id that the open drawing already uses is given a fresh id, so a restore can never overwrite a
     * picture that is in use. Returns Map(stored id -> id in this store); the caller maps the document's picture references through it.
     */
    async restore(list) {
      const map = new Map()
      for (const a of list || []) {
        if (!a || typeof a.id !== 'string' || !(a.blob instanceof Blob)) continue
        const mime = sniffImage(new Uint8Array(await a.blob.slice(0, 16).arrayBuffer()))
        if (!mime) continue
        const id = items.has(a.id) ? `a${seq + 1}` : a.id
        items.set(id, { blob: a.blob.type === mime ? a.blob : new Blob([a.blob], { type: mime }), w: a.w | 0, h: a.h | 0, mime, name: String(a.name || '') })
        bytes += a.blob.size
        seq = Math.max(seq, parseInt(id.slice(1), 10) || 0)
        map.set(a.id, id)
      }
      return map
    },
    revokeAll() { for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear() },
    clear() { api.revokeAll(); items.clear(); keys.clear(); dataUrls = new Map(); bytes = 0 },
    dispose() { api.clear() },
  }
  return api
}
