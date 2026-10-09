// A queue of photos whose subject has been cut out. Shared by Remove background and Change background so both reuse
// the same model, the same cached masks and the same edge settings.
import { fileType } from '../../lib/ui.js'
import { canvas as makeCanvas } from '../../lib/image.js'
import {
  MATTE_LIST, isReady, loadWorking, matte, fitCanvas, imageDataOf, guidedRefine, tightenAlpha, resizeMask, finalizeAlpha,
  makeCutout, maskBounds, getCachedMatte, putCachedMatte, thumbOf, checkAbort,
} from './_ml.js'
import { optionCards, section, note } from './_ui.js'
import { rangeField, toggle } from '../../lib/ui.js'

export const WORK_MAX = 4096
export const PREV_MAX = 1400

/** Crop a cutout canvas to the bounding box of its mask. */
export function trimTo(cut, alpha, w, h) {
  const b = maskBounds(alpha, w, h, 8)
  if (!b) return cut
  const c = makeCanvas(b.w, b.h)
  c.getContext('2d').drawImage(cut, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h)
  return c
}

/** Default edge settings (pixel values are relative to a 1000 px long edge). */
export const defaultEdges = () => ({ refine: true, shift: 0, feather: 1, defringe: true })

/**
 * const q = subjects({ model: 'balanced' })
 * item = q.add(file) ; await q.process(item, {onProgress, signal}) ; q.preview(item) ; q.cutout(item, edges)
 */
export function subjects({ model = 'balanced' } = {}) {
  const items = []
  const works = []
  let seq = 0
  const api = {
    items,
    model,
    edges: defaultEdges(),

    add(files) {
      const added = files.map((file) => {
        const item = { id: ++seq, file, name: file.name, status: 'queued', thumb: null, base: null, modelUsed: null, refined: null, prev: null, error: null }
        if (/^image\/(jpeg|png|webp|gif|avif|bmp)/.test(fileType(file))) { item.thumb = URL.createObjectURL(file); item.thumbOwned = true }
        items.push(item)
        return item
      })
      return added
    },
    remove(item) {
      const i = items.indexOf(item)
      if (i >= 0) items.splice(i, 1)
      const w = works.findIndex((x) => x.item === item)
      if (w >= 0) works.splice(w, 1)
      if (item.thumbOwned) URL.revokeObjectURL(item.thumb)
    },
    dispose() { for (const it of items) if (it.thumbOwned) URL.revokeObjectURL(it.thumb) },

    /** Decoded working canvas for an item (keeps the last two in memory). */
    async work(item) {
      let w = works.find((x) => x.item === item)
      if (!w) {
        w = { item, work: await loadWorking(item.file, { maxSide: WORK_MAX }) }
        works.unshift(w)
        works.length = Math.min(works.length, 2)
        if (!item.thumb || !item.thumbOwned) item.thumb = await thumbOf(w.work.canvas)
      }
      return w.work
    },

    /** True when the item needs (re)processing for the current model. */
    stale(item) { return item.status !== 'done' || item.modelUsed !== api.model },

    /** Cut out the subject. Idempotent for the same model. Throws on failure (item.status becomes 'error'). */
    async process(item, { onProgress, signal } = {}) {
      if (!api.stale(item)) return item
      item.status = 'run'
      item.error = null
      try {
        const work = await api.work(item)
        let res = getCachedMatte(item.file, api.model)
        if (!res) {
          res = await matte(api.model, work.canvas, { onProgress, signal })
          putCachedMatte(item.file, api.model, res)
        }
        checkAbort(signal)
        item.raw = res.alpha
        item.device = res.device
        item.ms = res.ms
        item.modelUsed = api.model
        await api.rebase(item)
        item.status = 'done'
        return item
      } catch (e) {
        item.status = e?.code === 'ABORT' || e?.name === 'AbortError' ? 'queued' : 'error'
        item.error = e
        throw e
      }
    },

    /** Recompute the base mask after the "smart edge" setting changes. */
    async rebase(item) {
      const work = await api.work(item)
      const { width: w, height: h } = work
      let base = item.raw
      if (api.edges.refine) base = guidedRefine(imageDataOf(work.canvas), base, w, h)
      item.base = tightenAlpha(base)
      item.rev = (item.rev || 0) + 1
      item.refined = api.edges.refine
      const pc = fitCanvas(work.canvas, PREV_MAX)
      item.prev = { canvas: pc, width: pc.width, height: pc.height, alpha: resizeMask(item.base, w, h, pc.width, pc.height) }
    },

    /** Decode just enough to show the photo (before processing). */
    async prepare(item) {
      const work = await api.work(item)
      if (!item.prev) {
        const pc = fitCanvas(work.canvas, PREV_MAX)
        item.prev = { canvas: pc, width: pc.width, height: pc.height, alpha: null }
      }
      return item.prev
    },

    /** Fast cutout at preview size for sliders (cached until the edge settings or mask change). trim: crop to the subject. */
    previewCutout(item, { trim = false } = {}) {
      const p = item.prev
      const e = api.edges
      const key = `${item.rev || 0}|${e.shift}|${e.feather}|${e.defringe}|${trim}`
      if (item.cutKey === key && item.cutCache) return item.cutCache
      const a = finalizeAlpha(p.alpha, p.width, p.height, e)
      let out = makeCutout(p.canvas, a, { defringe: e.defringe })
      if (trim) out = trimTo(out, a, p.width, p.height)
      item.cutKey = key
      item.cutCache = out
      return out
    },

    /** Full-resolution cutout canvas. trim: crop to the subject. */
    async cutout(item, { trim = false } = {}) {
      if (item.refined !== api.edges.refine) await api.rebase(item)
      const work = await api.work(item)
      const a = finalizeAlpha(item.base, work.width, work.height, api.edges)
      let out = makeCutout(work.canvas, a, { defringe: api.edges.defringe })
      if (trim) out = trimTo(out, a, work.width, work.height)
      return { canvas: out, alpha: a, work }
    },
  }
  return api
}

/** Side-panel section with the model picker. onChange(key) */
export function modelSection(q, onChange, { open = true } = {}) {
  const opts = () => MATTE_LIST.map((m) => ({
    value: m.key, title: m.name, desc: m.desc, icon: m.key === 'portrait' ? 'user-round' : 'shapes',
    tags: [isReady(m.id) ? { text: 'Ready', cls: 'ok', title: 'Already downloaded on this device' } : `${m.mb} MB`, m.sub],
    dots: m.quality, dotsLabel: `Quality ${m.quality} of 3`,
  }))
  const cards = optionCards(opts(), q.model, (v) => { q.model = v; onChange?.(v) }, { col: true, label: 'AI model' })
  const el = section('AI model', 'cpu', [cards, note('shield-check', 'Models run on your device and download once. Your photos are never uploaded.')], open)
  el.cards = cards
  el.refresh = () => cards.refresh(opts())
  return el
}

/** Edge controls (smart refine, grow/shrink, feather, defringe). onChange(kind) where kind is 'rebase' or 'preview'. */
export function edgesSection(q, onChange, { open = true } = {}) {
  const e = q.edges
  const refine = toggle('Smart edge refine', e.refine, (v) => { e.refine = v; onChange('rebase') })
  const shift = rangeField('Grow or shrink edge', { min: -6, max: 6, step: 1, value: e.shift, format: (v) => (v > 0 ? `+${v}` : `${v}`), onInput: (v) => { e.shift = v; onChange('preview') }, hint: 'Shrink to cut off a halo, grow to keep more.' })
  const feather = rangeField('Soft edges', { min: 0, max: 8, step: 0.5, value: e.feather, format: (v) => `${v} px`, onInput: (v) => { e.feather = v; onChange('preview') } })
  const fringe = toggle('Remove color halo', e.defringe, (v) => { e.defringe = v; onChange('preview') })
  const el = section('Edges', 'pen-tool', [refine, shift, feather, fringe], open)
  el.reset = () => { Object.assign(e, defaultEdges()); refine.input.checked = e.refine; fringe.input.checked = e.defringe; shift.set(0); feather.set(1) }
  return el
}
