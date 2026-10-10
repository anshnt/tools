// Keeps the library and filmstrip thumbnails in step with the edits: after a pause, each changed photo's small preview is
// re-rendered with its settings (same shader pipeline) and stored next to the original thumbnail.
import { yieldToMain } from '../../lib/ui.js'
import { toBlob } from '../../lib/image.js'
import { createRenderer } from './_gl.js'
import { cropPixels } from './_model.js'
import * as store from './_store.js'

export function createThumbs(app) {
  const dirty = new Set()
  let timer = 0, running = false, disposed = false, renderer = null, canvas = null, broken = false

  function queue(ids, delay = 1200) {
    if (broken || disposed) return
    for (const id of ids) dirty.add(id)
    clearTimeout(timer)
    timer = setTimeout(run, delay)
  }

  async function renderOne(id) {
    const m = app.get(id)
    if (!m) return
    if (!app.isEdited(id)) { await app.setEditedThumb(id, null); return }
    const blob = await store.getThumb(id)
    if (!blob) return
    const bmp = await createImageBitmap(blob)
    try {
      if (!renderer || renderer.lost) { canvas = document.createElement('canvas'); renderer = createRenderer(canvas) }
      renderer.setSource(bmp, bmp.width, bmp.height)
      const [cw, ch] = cropPixels(m.edits, bmp.width, bmp.height)
      const k = Math.min(1, store.THUMB / Math.max(cw, ch))
      renderer.render(m.edits, Math.max(1, Math.round(cw * k)), Math.max(1, Math.round(ch * k)), { opaque: true })
      await app.setEditedThumb(id, await toBlob(canvas, 'image/jpeg', 0.82))
    } finally {
      bmp.close?.()
    }
  }

  async function run() {
    if (running || disposed) return
    running = true
    try {
      while (dirty.size && !disposed) {
        const id = dirty.values().next().value
        dirty.delete(id)
        try { await renderOne(id) } catch (e) { console.error(e); if (/WebGL2/.test(e?.message || '')) { broken = true; dirty.clear() } }
        await yieldToMain()
      }
    } finally {
      running = false
      if (dirty.size && !disposed) timer = setTimeout(run, 300)
    }
  }

  /** Photos edited in an earlier session (or restored from a backup) that have no edited thumbnail yet. */
  async function backfill() {
    const have = await store.editedThumbIds()
    queue(app.order.filter((id) => app.isEdited(id) && !have.has(id)), 400)
  }

  return { queue, backfill, dispose() { disposed = true; clearTimeout(timer); dirty.clear(); renderer?.dispose() } }
}
