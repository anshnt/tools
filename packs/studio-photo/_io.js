// Import and export: images (incl. HEIC), PSD with layers (ag-psd), flat image export, project files (zip) and IndexedDB autosave.
import { loadImage, toBlob, MAX_PIXELS } from '../../lib/image.js'
import { zip } from '../../lib/files.js'
import { jszip } from '../../lib/libs.js'
import * as idb from '../../lib/idb.js'
import { cv, rctx, hexToRgb, rgbToHex, clamp, heavy } from './_util.js'
import { Doc, rasterLayer, mkLayer, adjustLayer, DEFAULT_TEXT, DEFAULT_SHAPE } from './_doc.js'
import { renderDoc, layerBounds } from './_render.js'
import { adjustDefaults } from './_adjust.js'

const AG_PSD = 'https://cdn.jsdelivr.net/npm/ag-psd@31.0.2/+esm'
let psdLib = null
const loadPsd = () => (psdLib ??= import(AG_PSD).catch((e) => { psdLib = null; throw Object.assign(new Error('Could not load the PSD library. Check your connection and try again.'), { cause: e }) }))

export const isPsd = (f) => /\.(psd|psb)$/i.test(f.name) || f.type === 'image/vnd.adobe.photoshop'
export const isProject = (f) => /\.(zip|photostudio)$/i.test(f.name)

/** Largest size that fits the device's canvas limit, keeping aspect ratio. */
export function fitToLimit(w, h) {
  if (w * h <= MAX_PIXELS) return { w, h, scaled: false }
  const k = Math.sqrt(MAX_PIXELS / (w * h))
  return { w: Math.floor(w * k), h: Math.floor(h * k), scaled: true }
}

/** Decode an image file into a canvas (HEIC, JPG, PNG, WebP, GIF, AVIF, BMP, SVG). Downscales beyond the device limit. */
export async function imageToCanvas(file) {
  const img = await loadImage(file)
  const { w, h, scaled } = fitToLimit(img.naturalWidth || img.width, img.naturalHeight || img.height)
  const c = cv(w, h), ctx = rctx(c)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  return { canvas: c, scaled, original: { w: img.naturalWidth, h: img.naturalHeight } }
}

export async function docFromImage(file) {
  const { canvas, scaled, original } = await imageToCanvas(file)
  const doc = new Doc(canvas.width, canvas.height, file.name.replace(/\.[^.]+$/, ''))
  const L = rasterLayer(1, 1, 'Background', { bg: true })
  L.canvas = canvas
  doc.layers = [L]; doc.activeId = L.id
  return { doc, scaled, original }
}

export function blankDoc(w, h, background = '#ffffff', name = 'Untitled') {
  const f = fitToLimit(w, h)
  const doc = new Doc(f.w, f.h, name)
  const L = rasterLayer(f.w, f.h, 'Background', { bg: true })
  if (background && background !== 'transparent') { const ctx = rctx(L.canvas); ctx.fillStyle = background; ctx.fillRect(0, 0, f.w, f.h); doc.bgColor = background }
  doc.layers = [L]; doc.activeId = L.id
  return doc
}

// ---------- PSD ----------
const TO_PSD = { 'source-over': 'normal', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', 'color-dodge': 'color dodge', 'color-burn': 'color burn', 'hard-light': 'hard light', 'soft-light': 'soft light', difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity' }
const FROM_PSD = Object.fromEntries(Object.entries(TO_PSD).map(([k, v]) => [v, k]))
Object.assign(FROM_PSD, { 'linear dodge': 'screen', 'linear burn': 'multiply', 'vivid light': 'hard-light', 'linear light': 'hard-light', 'pin light': 'hard-light', 'darker color': 'darken', 'lighter color': 'lighten' })

const putData = (id) => {
  const c = cv(id.width, id.height)
  rctx(c).putImageData(new ImageData(new Uint8ClampedArray(id.data), id.width, id.height), 0, 0)
  return c
}

function fromPsdAdjustment(a) {
  const n = (v, d) => (Number.isFinite(v) ? v : d)
  switch (a?.type) {
    case 'brightness/contrast': return adjustLayer('brightness', { brightness: n(a.brightness, 0), contrast: n(a.contrast, 0) })
    case 'hue/saturation': return adjustLayer('huesat', { hue: n(a.master?.hue, 0), sat: n(a.master?.saturation, 0), light: n(a.master?.lightness, 0) })
    case 'exposure': return adjustLayer('exposure', { exposure: n(a.exposure, 0), offset: n(a.offset, 0), gamma: n(a.gamma, 1) })
    case 'vibrance': return adjustLayer('vibrance', { vibrance: n(a.vibrance, 0), sat: n(a.saturation, 0) })
    case 'invert': return adjustLayer('invert')
    case 'levels': { const l = a.rgb; return l ? adjustLayer('levels', { inBlack: n(l.shadowInput, 0), inWhite: n(l.highlightInput, 255), gamma: n(l.midtoneInput, 1), outBlack: n(l.shadowOutput, 0), outWhite: n(l.highlightOutput, 255) }) : null }
    case 'curves': {
      const p = adjustDefaults('curves')
      for (const [k, key] of [['rgb', 'rgb'], ['red', 'r'], ['green', 'g'], ['blue', 'b']]) if (a[k]?.length >= 2) p[key] = a[k].map((q) => [q.input, q.output])
      return adjustLayer('curves', p)
    }
    case 'gradient map': {
      const s = (a.colorStops || []).map((c) => [clamp(c.location / 4096, 0, 1), rgbToHex(c.color.r ?? 0, c.color.g ?? 0, c.color.b ?? 0)])
      return s.length >= 2 ? adjustLayer('gradmap', { stops: a.reverse ? s.map(([p, c]) => [1 - p, c]) : s }) : null
    }
    default: return null
  }
}

function toPsdAdjustment(A) {
  const { kind, params: p } = A
  switch (kind) {
    case 'brightness': return { type: 'brightness/contrast', brightness: p.brightness, contrast: p.contrast, useLegacy: true }
    case 'huesat': return { type: 'hue/saturation', master: { a: 0, b: 0, c: 0, d: 0, hue: p.hue, saturation: p.sat, lightness: p.light } }
    case 'exposure': return { type: 'exposure', exposure: p.exposure, offset: p.offset, gamma: p.gamma }
    case 'vibrance': return { type: 'vibrance', vibrance: p.vibrance, saturation: p.sat }
    case 'invert': return { type: 'invert' }
    case 'levels': return { type: 'levels', rgb: { shadowInput: p.inBlack, highlightInput: p.inWhite, shadowOutput: p.outBlack, highlightOutput: p.outWhite, midtoneInput: p.gamma } }
    case 'curves': {
      const ch = (pts) => pts.map(([input, output]) => ({ input, output }))
      return { type: 'curves', rgb: ch(p.rgb), red: ch(p.r), green: ch(p.g), blue: ch(p.b) }
    }
    case 'gradmap': return {
      type: 'gradient map', gradientType: 'solid', smoothness: 1,
      colorStops: p.stops.map(([pos, hex]) => { const [r, g, b] = hexToRgb(hex); return { color: { r, g, b }, location: Math.round(pos * 4096), midpoint: 50 } }),
      opacityStops: [{ opacity: 1, location: 0, midpoint: 50 }, { opacity: 1, location: 4096, midpoint: 50 }],
    }
    default: return null // black & white has no faithful equivalent
  }
}

/** Read a PSD (layers, masks, blend modes, opacity, visibility, simple adjustments). Text and smart objects arrive as pixels. */
export async function docFromPsd(file) {
  const { readPsd } = await loadPsd()
  const buf = await file.arrayBuffer()
  let psd
  try { psd = readPsd(buf, { useImageData: true, skipThumbnail: true }) } catch (e) { throw Object.assign(new Error(`Could not read this PSD (${e.message || 'unsupported variant'}). Try saving it as RGB, 8 bits per channel.`), { cause: e }) }
  const { w, h, scaled } = fitToLimit(psd.width, psd.height)
  if (scaled) throw new Error(`This PSD is ${psd.width} x ${psd.height}, too large for this device. Reduce its size and try again.`)
  const doc = new Doc(w, h, file.name.replace(/\.[^.]+$/, ''))
  const stats = { layers: 0, skipped: 0, adjustments: 0 }
  const walk = (list, parentHidden) => {
    for (const l of list || []) {
      if (l.children) { walk(l.children, parentHidden || !!l.hidden); continue }
      const base = { name: l.name || 'Layer', visible: !(parentHidden || l.hidden), opacity: l.opacity ?? 1, blend: FROM_PSD[l.blendMode] || 'source-over' }
      let L = null
      if (l.adjustment) {
        L = fromPsdAdjustment(l.adjustment)
        if (L) stats.adjustments++
      } else if (l.imageData && l.imageData.width > 0 && l.imageData.height > 0) {
        L = mkLayer('raster', { canvas: putData(l.imageData), x: l.left ?? 0, y: l.top ?? 0 })
      } else if (l.canvas) {
        L = mkLayer('raster', { canvas: l.canvas, x: l.left ?? 0, y: l.top ?? 0 })
      }
      if (!L) { stats.skipped++; continue }
      Object.assign(L, base)
      const m = l.mask
      if (m && (m.imageData || m.canvas) && !m.fromVectorData) {
        const src = m.imageData ? putData(m.imageData) : m.canvas
        const mc = cv(w, h), ctx = rctx(mc)
        const dflt = m.defaultColor ?? 255
        ctx.fillStyle = '#000'
        if (dflt > 127) ctx.fillRect(0, 0, w, h)
        ctx.clearRect(m.left ?? 0, m.top ?? 0, src.width, src.height)
        const tmp = cv(src.width, src.height), tctx = rctx(tmp)
        tctx.drawImage(src, 0, 0)
        const img = tctx.getImageData(0, 0, tmp.width, tmp.height), d = img.data
        for (let i = 0; i < d.length; i += 4) { d[i + 3] = d[i]; d[i] = d[i + 1] = d[i + 2] = 0 } // grayscale -> alpha
        tctx.putImageData(img, 0, 0)
        ctx.drawImage(tmp, m.left ?? 0, m.top ?? 0)
        L.mask = { canvas: mc }; L.maskOn = !m.disabled
      }
      doc.layers.push(L); stats.layers++
    }
  }
  walk(psd.children, false)
  if (!doc.layers.length) {
    const comp = psd.imageData ? putData(psd.imageData) : psd.canvas
    if (!comp) throw new Error('This PSD has no readable image data.')
    const L = rasterLayer(1, 1, 'Background', { bg: true })
    L.canvas = comp
    doc.layers.push(L)
  }
  doc.activeId = doc.layers[doc.layers.length - 1].id
  return { doc, stats }
}

/** Our masks are alpha-only canvases; PSD wants a grayscale image. */
function psdMask(L) {
  const m = L.mask.canvas, g = cv(m.width, m.height), ctx = rctx(g)
  const img = rctx(m).getImageData(0, 0, m.width, m.height), d = img.data
  for (let i = 0; i < d.length; i += 4) { const v = d[i + 3]; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255 }
  ctx.putImageData(img, 0, 0)
  return { top: 0, left: 0, bottom: m.height, right: m.width, canvas: g, defaultColor: 255, disabled: !L.maskOn }
}

/** Write a layered PSD. Text and shape layers are saved as pixel layers; unsupported adjustments are listed in `dropped`. */
export const psdBlob = (doc) => heavy(() => buildPsd(doc))
async function buildPsd(doc) {
  const { writePsd } = await loadPsd()
  const dropped = []
  const children = []
  for (const L of doc.layers) {
    const o = { name: L.name, opacity: L.opacity, hidden: !L.visible, blendMode: TO_PSD[L.blend] || 'normal' }
    if (L.type === 'adjust') {
      const a = toPsdAdjustment(L.adjust)
      if (!a) { dropped.push(L.name); continue }
      o.adjustment = a
      if (L.mask) o.mask = psdMask(L)
    } else {
      let canvas = L.canvas, left = L.x, top = L.y
      if (L.type !== 'raster') {
        const b = layerBounds(L), pad = L.type === 'text' ? Math.ceil(L.text.size * 0.4) : 4
        const r = { x: Math.floor(b.x - pad), y: Math.floor(b.y - pad), w: Math.ceil(b.w + pad * 2), h: Math.ceil(b.h + pad * 2) }
        canvas = renderDoc({ layers: [L], w: doc.w, h: doc.h }, { rect: r, opts: { only: new Set([L.id]), raw: true, noMask: true } })
        left = r.x; top = r.y
      }
      Object.assign(o, { canvas, left, top })
      if (L.mask) o.mask = psdMask(L)
    }
    children.push(o)
  }
  const buf = writePsd({ width: doc.w, height: doc.h, children, canvas: renderDoc(doc) }, { generateThumbnail: true, noBackground: true })
  return { blob: new Blob([buf], { type: 'image/vnd.adobe.photoshop' }), dropped }
}

// ---------- flat export ----------
export const FORMATS = { png: ['image/png', 'png'], jpeg: ['image/jpeg', 'jpg'], webp: ['image/webp', 'webp'] }
export function exportBlob(doc, { format = 'png', quality = 0.92, scale = 1, background } = {}) {
  const [type] = FORMATS[format]
  const bg = format === 'jpeg' ? background || '#ffffff' : null
  return heavy(() => toBlob(renderDoc(doc, { scale, background: bg }), type, type === 'image/png' ? undefined : quality))
}

// ---------- project (zip / IndexedDB) ----------
const pngOf = (L, key, canvas) => {
  const cache = (L._png ||= {})
  const c = cache[key]
  if (c && c.v === L.v && c.canvas === canvas) return c.blob
  const p = toBlob(canvas, 'image/png').then((b) => b)
  cache[key] = { v: L.v, canvas, blob: p }
  return p
}

/** -> { meta, files: { path: Blob } } (shared by the project file and the autosave). */
export async function serialize(doc) {
  const files = {}
  const layers = []
  for (const L of doc.layers) {
    const m = { id: L.id, type: L.type, name: L.name, visible: L.visible, locked: L.locked, opacity: L.opacity, blend: L.blend, x: L.x, y: L.y, maskOn: L.maskOn, text: L.text, shape: L.shape, adjust: L.adjust, bg: L.bg }
    if (L.canvas) { m.img = `layers/${L.id}.png`; files[m.img] = await pngOf(L, 'c', L.canvas) }
    if (L.mask) { m.mask = `masks/${L.id}.png`; files[m.mask] = await pngOf(L, 'm', L.mask.canvas) }
    layers.push(m)
  }
  return { meta: { app: 'photo-studio', version: 1, w: doc.w, h: doc.h, name: doc.name, bgColor: doc.bgColor, activeId: doc.activeId, layers }, files }
}

async function canvasFromBlob(blob) {
  const img = await loadImage(blob)
  const c = cv(img.naturalWidth, img.naturalHeight)
  rctx(c).drawImage(img, 0, 0)
  return c
}

export async function deserialize(meta, getBlob) {
  if (meta.app !== 'photo-studio') throw new Error('This is not a Photo Studio project.')
  const doc = new Doc(meta.w, meta.h, meta.name)
  doc.bgColor = meta.bgColor || '#ffffff'
  for (const m of meta.layers) {
    const L = mkLayer(m.type, { id: m.id, name: m.name, visible: m.visible, locked: m.locked, opacity: m.opacity, blend: m.blend, x: m.x, y: m.y, maskOn: m.maskOn, text: m.text ? { ...DEFAULT_TEXT, ...m.text } : null, shape: m.shape ? { ...DEFAULT_SHAPE, ...m.shape } : null, adjust: m.adjust, bg: !!m.bg })
    if (m.img) L.canvas = await canvasFromBlob(await getBlob(m.img))
    if (m.mask) L.mask = { canvas: await canvasFromBlob(await getBlob(m.mask)) }
    doc.layers.push(L)
  }
  doc.activeId = doc.layer(meta.activeId) ? meta.activeId : doc.layers[doc.layers.length - 1]?.id
  return doc
}

export const projectBlob = (doc) => heavy(() => buildProject(doc))
async function buildProject(doc) {
  const { meta, files } = await serialize(doc)
  return zip([{ name: 'project.json', data: JSON.stringify(meta) }, ...Object.entries(files).map(([name, data]) => ({ name, data }))])
}

export async function docFromProject(file) {
  const JSZip = await jszip()
  const z = await JSZip.loadAsync(file)
  const j = z.file('project.json')
  if (!j) throw new Error('This zip is not a Photo Studio project (project.json is missing).')
  return deserialize(JSON.parse(await j.async('string')), async (p) => {
    const f = z.file(p)
    if (!f) throw new Error(`Project file is damaged (missing ${p}).`)
    return f.async('blob')
  })
}

const key = (slot) => `photo-studio:${slot}`
export const saveAuto = (doc, slot) => heavy(async () => {
  const { meta, files } = await serialize(doc)
  return idb.set(key(slot), { meta, files, ts: Date.now() })
})
export async function loadAuto(slot) {
  const rec = await idb.get(key(slot))
  if (!rec?.meta) return null
  try { return { doc: await deserialize(rec.meta, async (p) => rec.files[p]), ts: rec.ts } } catch (e) { console.warn('Autosave could not be restored', e); return null }
}
export const hasAuto = async (slot) => !!(await idb.get(key(slot)))?.meta
export const clearAuto = (slot) => idb.del(key(slot))
