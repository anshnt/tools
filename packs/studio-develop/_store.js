// Persistence for the photo library (IndexedDB) and the import pipeline. Originals, thumbnails and per-photo edit
// settings are stored separately so ratings and sliders can be saved without rewriting any image bytes.
import * as idb from '../../lib/idb.js'
import { loadImage, isHeic, heicToBlob, toCanvas, toBlob, fitSize, MAX_PIXELS } from '../../lib/image.js'
import { fileType } from '../../lib/ui.js'
import { jszip } from '../../lib/libs.js'
import { baseName, ext } from '../../lib/files.js'
import { defaults, normalize } from './_model.js'
import { readExif } from './_exif.js'

const K = { order: 'pdev:order', presets: 'pdev:presets', meta: (id) => `pdev:meta:${id}`, blob: (id) => `pdev:blob:${id}`, thumb: (id) => `pdev:thumb:${id}`, ethumb: (id) => `pdev:ethumb:${id}` }
export const THUMB = 360
export const ACCEPT = 'image/*,.heic,.heif,.jpg,.jpeg,.png,.webp,.avif,.gif,.bmp'

const uid = () => (crypto.randomUUID ? crypto.randomUUID().slice(0, 12) : Math.random().toString(36).slice(2, 14))

function cleanMeta(m) {
  return {
    id: String(m.id), name: String(m.name || 'photo'), type: String(m.type || 'image/jpeg'), size: Number(m.size) || 0,
    w: Number(m.w) || 1, h: Number(m.h) || 1, added: Number(m.added) || Date.now(), taken: Number(m.taken) || 0,
    rating: Math.min(5, Math.max(0, Math.round(Number(m.rating) || 0))), flag: m.flag === 'pick' || m.flag === 'reject' ? m.flag : '',
    edits: normalize(m.edits || defaults()),
    exif: cleanExif(m.exif),
  }
}
function cleanExif(x) {
  if (!x || typeof x !== 'object') return null
  const str = (v) => (typeof v === 'string' ? v.slice(0, 80) : '')
  const out = { camera: str(x.camera), lens: str(x.lens), shutter: str(x.shutter), aperture: str(x.aperture), iso: str(x.iso), focal: str(x.focal) }
  return Object.values(out).some(Boolean) ? out : null
}

/** Everything saved on this device: photos in order, plus user presets. */
export async function loadLibrary() {
  const order = (await idb.get(K.order)) || []
  const metas = await Promise.all(order.map((id) => idb.get(K.meta(id))))
  const photos = metas.filter(Boolean).map(cleanMeta)
  const presets = ((await idb.get(K.presets)) || []).filter((p) => p && p.id && p.name && p.look)
  return { photos, presets }
}
export const saveMeta = (m) => idb.set(K.meta(m.id), m)
export const saveOrder = (ids) => idb.set(K.order, ids)
export const savePresets = (list) => idb.set(K.presets, list)
export const getBlob = (id) => idb.get(K.blob(id))
export const getThumb = (id) => idb.get(K.thumb(id))
export const getEditedThumb = (id) => idb.get(K.ethumb(id))
export const setEditedThumb = (id, blob) => (blob ? idb.set(K.ethumb(id), blob) : idb.del(K.ethumb(id)))
export const editedThumbIds = () => idb.keys('pdev:ethumb:').then((k) => new Set(k.map((x) => x.slice('pdev:ethumb:'.length))))
export async function deletePhoto(id) {
  await Promise.all([idb.del(K.meta(id)), idb.del(K.blob(id)), idb.del(K.thumb(id)), idb.del(K.ethumb(id))])
}
export async function clearLibrary(ids) {
  await Promise.all(ids.map(deletePhoto))
  await idb.del(K.order)
}

export const isImageFile = (f) => /^image\//.test(fileType(f)) || /\.(heic|heif|jpe?g|png|webp|avif|gif|bmp)$/i.test(f.name)

async function makeThumb(img) {
  const { width, height } = fitSize(img.naturalWidth, img.naturalHeight, THUMB, THUMB)
  return toBlob(toCanvas(img, width, height, { background: '#111' }), 'image/jpeg', 0.82)
}

/**
 * Decode, thumbnail and store one image. HEIC is converted to JPEG once so later opens are fast.
 * Returns {meta, thumb}; the caller saves the order. Throws a readable Error for files that cannot be used.
 */
export async function importFile(file) {
  if (!isImageFile(file)) throw new Error(`${file.name} is not an image.`)
  let working = file
  if (isHeic(file)) working = await heicToBlob(file, 'image/jpeg', 0.95)
  const img = await loadImage(working)
  const w = img.naturalWidth, h = img.naturalHeight
  if (w * h > MAX_PIXELS) throw new Error(`${file.name} is too large for this device (${w} x ${h}). Try a smaller copy.`)
  const thumb = await makeThumb(img)
  const exif = /jpe?g/i.test(working.type || file.name) ? await readExif(working) : null
  const meta = cleanMeta({ id: uid(), name: file.name, type: working.type || 'image/jpeg', size: file.size, w, h, added: Date.now(), taken: exif?.taken || file.lastModified || 0, edits: defaults(), exif })
  const ok = await Promise.all([idb.set(K.blob(meta.id), working), idb.set(K.thumb(meta.id), thumb), saveMeta(meta)])
  if (ok.includes(false)) throw new Error('Could not save this photo on the device (storage may be full or blocked).')
  return { meta, thumb }
}

/** Decode a stored photo for the editor: a proxy canvas no larger than maxLong on its long edge. */
export async function loadSource(id, maxLong = 3072) {
  const blob = await getBlob(id)
  if (!blob) throw new Error('This photo is no longer stored on this device.')
  const img = await loadImage(blob)
  const w = img.naturalWidth, h = img.naturalHeight
  const { width, height } = fitSize(w, h, maxLong, maxLong)
  const c = toCanvas(img, width, height)
  return { canvas: c, width, height, fullWidth: w, fullHeight: h, image: img, blob }
}

// ---------- Catalog backup (ZIP with originals + catalog.json) ----------

/** Zip every photo and its edits so the library can be restored on another device. */
export async function exportCatalog(photos, presets, onProgress) {
  const JSZip = await jszip()
  const z = new JSZip()
  const list = []
  let i = 0
  for (const m of photos) {
    const blob = await getBlob(m.id)
    if (!blob) continue
    const file = `photos/${m.id}.${ext(m.name) || (m.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`
    z.file(file, blob)
    list.push({ ...m, file })
    onProgress?.(++i / photos.length)
  }
  z.file('catalog.json', JSON.stringify({ app: 'photo-develop', version: 1, photos: list, presets }, null, 1))
  return z.generateAsync({ type: 'blob', compression: 'STORE' })
}

/** Read a catalog ZIP made by exportCatalog. Returns the number of photos added. */
export async function importCatalog(file, existingIds, onProgress) {
  const JSZip = await jszip()
  const z = await JSZip.loadAsync(file)
  const entry = z.file('catalog.json')
  if (!entry) throw new Error('This ZIP is not a Photo Develop catalog (catalog.json is missing).')
  const cat = JSON.parse(await entry.async('string'))
  if (cat.app !== 'photo-develop' || !Array.isArray(cat.photos)) throw new Error('This ZIP is not a Photo Develop catalog.')
  const added = [], skipped = []
  let i = 0
  for (const raw of cat.photos) {
    onProgress?.(++i / cat.photos.length)
    const m = cleanMeta(raw)
    if (existingIds.has(m.id)) { skipped.push(m.id); continue }
    const f = z.file(String(raw.file || ''))
    if (!f) continue
    const blob = new Blob([await f.async('arraybuffer')], { type: m.type })
    const img = await loadImage(blob)
    m.w = img.naturalWidth; m.h = img.naturalHeight
    await Promise.all([idb.set(K.blob(m.id), blob), idb.set(K.thumb(m.id), await makeThumb(img)), saveMeta(m)])
    added.push(m)
  }
  return { added, skipped: skipped.length, presets: (cat.presets || []).filter((p) => p && p.id && p.name && p.look) }
}

export const photoBaseName = (m) => baseName(m.name)
