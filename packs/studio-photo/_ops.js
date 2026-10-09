// Document operations triggered by menus, shortcuts and tools: selection commands, fills, clipboard, new layers, gradients.
import { cv, rctx, copyCanvas, hexToRgb, luma, rgba, clamp } from './_util.js'
import { rasterLayer, adjustLayer } from './_doc.js'
import { makeSel, fullMask, invertMask, featherMask, growMask } from './_select.js'
import { renderDoc } from './_render.js'

export function createOps(app) {
  const doc = () => app.doc

  const selRect = () => { const d = doc(); return d.sel ? { x: d.sel.x, y: d.sel.y, w: d.sel.w, h: d.sel.h } : { x: 0, y: 0, w: d.w, h: d.h } }

  const ops = {
    // ----- selection -----
    selectAll() { const d = doc(); d.setSel(makeSel(fullMask(d.w, d.h), d.w, d.h), 'Select all') },
    deselect() { if (doc().sel) doc().setSel(null, 'Deselect') },
    invertSelection() {
      const d = doc()
      d.setSel(d.sel ? makeSel(invertMask(d.sel.mask), d.w, d.h) : makeSel(fullMask(d.w, d.h), d.w, d.h), 'Invert selection')
    },
    featherSelection(r) { const d = doc(); if (d.sel && r > 0) d.setSel(makeSel(featherMask(d.sel.mask, d.w, d.h, r), d.w, d.h), 'Feather selection') },
    growSelection(n) { const d = doc(); if (d.sel && n) d.setSel(makeSel(growMask(d.sel.mask, d.w, d.h, n), d.w, d.h), n > 0 ? 'Expand selection' : 'Contract selection') },
    cropToSelection() { const d = doc(); if (d.sel) { const r = { x: d.sel.x, y: d.sel.y, w: d.sel.w, h: d.sel.h }; d.crop(r); app.vp.fit() } },

    // ----- fills -----
    /** Paint a coverage mask (Uint8Array, doc size) with a color on a paint target t = { L, target }. */
    fillMask(mask, t, color, opacity, label) {
      const d = doc(), s = makeSel(mask, d.w, d.h)
      if (!s) return
      const tmp = cv(s.w, s.h), ctx = rctx(tmp), img = ctx.createImageData(s.w, s.h), px = img.data
      const [r, g, b] = hexToRgb(color)
      for (let y = 0; y < s.h; y++) {
        let mi = (s.y + y) * d.w + s.x, pi = y * s.w * 4
        for (let x = 0; x < s.w; x++, mi++, pi += 4) { px[pi] = r; px[pi + 1] = g; px[pi + 2] = b; px[pi + 3] = mask[mi] }
      }
      ctx.putImageData(img, 0, 0)
      const erase = t.target === 'mask' && luma(r, g, b) < 0.5
      d.editPixels(t.L, t.target, { x: s.x, y: s.y, w: s.w, h: s.h }, label, (c, rr) => {
        c.globalAlpha = opacity
        c.globalCompositeOperation = erase ? 'destination-out' : 'source-over'
        c.drawImage(tmp, rr.x, rr.y)
        c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'
      })
    },
    fillSelection(color, opacity = 1) {
      const t = app.paintTarget()
      if (!t) return
      const d = doc()
      ops.fillMask(d.sel ? d.sel.mask : fullMask(d.w, d.h), t, color, opacity, 'Fill')
    },
    clearSelection() {
      const t = app.paintTarget()
      if (!t) return
      const d = doc(), sc = d.selectionCanvas()
      const r = selRect()
      d.editPixels(t.L, t.target, r, 'Clear', (c, rr) => {
        c.globalCompositeOperation = 'destination-out'
        if (sc) c.drawImage(sc, r.x, r.y, r.w, r.h, rr.x, rr.y, r.w, r.h); else { c.fillStyle = '#000'; c.fillRect(rr.x, rr.y, rr.w, rr.h) }
        c.globalCompositeOperation = 'source-over'
      })
    },
    applyGradient(a, b, o) {
      const t = app.paintTarget()
      if (!t) return
      const d = doc(), tmp = cv(d.w, d.h), ctx = rctx(tmp)
      const radial = o.type === 'radial', len = Math.hypot(b.x - a.x, b.y - a.y)
      const g = radial ? ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, len) : ctx.createLinearGradient(a.x, a.y, b.x, b.y)
      let c0 = app.fg, c1 = app.bg, a0 = 1, a1 = 1
      if (o.preset === 'bw') { c0 = '#000000'; c1 = '#ffffff' } else if (o.preset === 'fgt') { c1 = app.fg; a1 = 0 }
      if (o.reverse) { [c0, c1] = [c1, c0]; [a0, a1] = [a1, a0] }
      const mask = t.target === 'mask'
      const col = (c, alpha) => (mask ? `rgba(0,0,0,${luma(...hexToRgb(c)) * alpha})` : rgba(c, alpha))
      g.addColorStop(0, col(c0, a0)); g.addColorStop(1, col(c1, a1))
      ctx.fillStyle = g
      ctx.fillRect(0, 0, d.w, d.h)
      const sc = d.selectionCanvas()
      if (sc) { ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(sc, 0, 0); ctx.globalCompositeOperation = 'source-over' }
      d.editPixels(t.L, t.target, { x: 0, y: 0, w: d.w, h: d.h }, 'Gradient', (c, r) => {
        if (mask) { // gradients on a mask replace its values inside the selection
          c.globalCompositeOperation = 'destination-out'
          if (sc) c.drawImage(sc, r.x, r.y); else { c.fillStyle = '#000'; c.fillRect(r.x, r.y, r.w, r.h) }
        }
        c.globalAlpha = o.opacity / 100
        c.globalCompositeOperation = 'source-over'
        c.drawImage(tmp, r.x, r.y)
        c.globalAlpha = 1
      })
    },

    // ----- clipboard and new layers from pixels -----
    regionCanvas(merged) {
      const d = doc(), L = d.active, r = selRect()
      const out = cv(r.w, r.h), ctx = rctx(out)
      if (merged || !L || L.type !== 'raster') {
        const only = merged ? undefined : new Set([L.id])
        ctx.drawImage(renderDoc(d, { rect: r, opts: only ? { only, raw: true, noMask: true } : {} }), 0, 0)
      } else ctx.drawImage(L.canvas, L.x - r.x, L.y - r.y)
      const sc = d.selectionCanvas()
      if (sc) { ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(sc, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h); ctx.globalCompositeOperation = 'source-over' }
      return { canvas: out, x: r.x, y: r.y }
    },
    copy(cut = false, merged = false) {
      const d = doc(), L = d.active
      if (!L || L.type === 'adjust') return app.warn('Pick a pixel, text or shape layer to copy from.')
      app.clip = ops.regionCanvas(merged)
      app.clip.canvas.toBlob?.((blob) => { if (blob) navigator.clipboard?.write?.([new ClipboardItem({ 'image/png': blob })]).catch(() => {}) }, 'image/png')
      if (cut && !merged) { if (L.type !== 'raster') return app.warn('Rasterize the layer first to cut pixels out of it.'); ops.clearSelection() }
      app.toast(cut ? 'Cut to clipboard' : 'Copied')
    },
    paste() {
      if (!app.clip) return app.warn('Nothing copied yet. Copy a selection first, or paste an image from another app with Ctrl+V.')
      ops.placeCanvas(copyCanvas(app.clip.canvas), 'Pasted layer', { x: app.clip.x, y: app.clip.y })
    },
    layerViaCopy() {
      const d = doc(), L = d.active
      if (!L) return
      if (!d.sel || L.type === 'adjust') return L.type === 'adjust' ? undefined : d.duplicate(L.id)
      const { canvas, x, y } = ops.regionCanvas(false)
      d.addLayer(rasterLayer(1, 1, `${L.name} copy`, { canvas, x, y }), 'Layer via copy')
    },
    layerViaCut() {
      const d = doc(), L = d.active
      if (!L || !d.sel || L.type !== 'raster') return app.warn('Make a selection on a pixel layer first.')
      const { canvas, x, y } = ops.regionCanvas(false)
      ops.clearSelection()
      d.addLayer(rasterLayer(1, 1, 'Cut layer', { canvas, x, y }), 'Layer via cut')
    },
    /** Used by Move: lift the selected pixels onto their own layer. */
    liftSelection() {
      const d = doc(), L = d.active
      if (!d.sel || !L || L.type !== 'raster' || L.locked) return false
      const { canvas, x, y } = ops.regionCanvas(false)
      ops.clearSelection()
      d.addLayer(rasterLayer(1, 1, 'Lifted selection', { canvas, x, y }), 'Lift selection')
      return true
    },
    /** Add a canvas as a new layer. Large images are scaled to fit the document; without pos it is centered. */
    placeCanvas(canvas, name = 'Layer', pos) {
      const d = doc()
      let c = canvas
      if (!pos && (c.width > d.w || c.height > d.h)) {
        const k = Math.min(d.w / c.width, d.h / c.height)
        const n = cv(Math.max(1, Math.round(c.width * k)), Math.max(1, Math.round(c.height * k))), ctx = rctx(n)
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(c, 0, 0, n.width, n.height)
        c = n
      }
      const x = pos ? pos.x : Math.round((d.w - c.width) / 2), y = pos ? pos.y : Math.round((d.h - c.height) / 2)
      return d.addLayer(rasterLayer(1, 1, name, { canvas: c, x, y }), `Place ${name}`)
    },
    newLayer() { const d = doc(); return d.addLayer(rasterLayer(1, 1, `Layer ${d.layers.length + 1}`), 'New layer') },
    addAdjustment(kind) {
      const d = doc(), L = adjustLayer(kind)
      if (d.sel) L.mask = { canvas: copyCanvas(d.selectionCanvas()) }
      return d.addLayer(L, `Add ${L.name}`)
    },
    deleteOrClear() { const d = doc(); if (d.sel) ops.clearSelection(); else if (d.active) d.deleteLayer(d.activeId) },
  }
  return ops
}
