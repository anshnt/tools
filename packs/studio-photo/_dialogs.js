// Dialogs: new document, image and canvas size, filters (live preview), export, selection tweaks, layer transform, shortcuts.
import { h, modal, button, download, formatBytes, debounce, toast, errorMessage } from '../../lib/ui.js'
import { cv, rctx, copyCanvas, clamp } from './_util.js'
import { cover } from './_doc.js'
import { FILTERS } from './_adjust.js'
import { renderDoc } from './_render.js'
import { exportBlob, psdBlob, FORMATS, fitToLimit } from './_io.js'
import { formDialog, ctl } from './_chrome.js'
import { safeName } from '../../lib/files.js'

export const PRESETS = [
  ['Instagram post', 1080, 1080, 'Square'], ['Instagram story', 1080, 1920, 'Vertical 9:16'], ['YouTube thumbnail', 1280, 720, '16:9'], ['Full HD', 1920, 1080, 'Landscape'],
  ['A4 at 300 dpi', 2480, 3508, 'Print portrait'], ['Facebook cover', 820, 312, 'Banner'], ['Passport 35x45 mm', 413, 531, 'At 300 dpi'], ['Square 2000', 2000, 2000, 'Large square'],
]

export const SHORTCUTS = [
  ['Tools', [['V', 'Move'], ['M', 'Marquee (press again for ellipse)'], ['L', 'Lasso'], ['W', 'Magic wand'], ['C', 'Crop'], ['B', 'Brush'], ['E', 'Eraser'], ['S', 'Clone stamp'], ['K', 'Paint bucket'], ['G', 'Gradient'], ['T', 'Text'], ['U', 'Shapes'], ['I', 'Eyedropper'], ['Z', 'Zoom'], ['H or Space', 'Hand (pan)']]],
  ['Edit', [['Ctrl+Z', 'Undo'], ['Ctrl+Shift+Z / Ctrl+Y', 'Redo'], ['Ctrl+C / X / V', 'Copy, cut, paste'], ['Ctrl+Shift+C', 'Copy merged'], ['Ctrl+J', 'Layer via copy'], ['Ctrl+Shift+J', 'Layer via cut'], ['Delete', 'Clear selection (or delete layer)'], ['Alt+Delete', 'Fill with foreground'], ['Ctrl+Delete', 'Fill with background']]],
  ['Selection', [['Ctrl+A', 'Select all'], ['Ctrl+D', 'Deselect'], ['Ctrl+Shift+I', 'Invert selection'], ['Shift / Alt + drag', 'Add to / subtract from selection']]],
  ['Brush and colors', [['[ and ]', 'Smaller and larger brush'], ['X', 'Swap foreground and background'], ['D', 'Default colors (black and white)'], ['0-9', 'Brush or layer opacity (0 = 100%)']]],
  ['View and layers', [['Ctrl+0', 'Fit on screen'], ['Ctrl+1', '100%'], ['Ctrl + / -', 'Zoom in and out'], ['Ctrl+scroll', 'Zoom at the cursor'], ['Ctrl+Shift+N', 'New layer'], ['Ctrl+E', 'Merge down'], ['Ctrl+] / [', 'Layer up and down'], ['Arrows', 'Nudge with Move (Shift = 10 px)'], ['Ctrl+S', 'Save project file'], ['Ctrl+Shift+E', 'Export image']]],
]

export function createDialogs(app) {
  const docRect = (d) => ({ x: 0, y: 0, w: d.w, h: d.h })

  const api = {
    newDoc(preset) {
      const p = preset || PRESETS[0]
      formDialog({
        title: 'New document', icon: 'file-plus', ok: 'Create',
        fields: [
          { k: 'preset', label: 'Preset', type: 'select', value: preset ? preset[0] : 'custom', options: [['custom', 'Custom size'], ...PRESETS.map((x) => [x[0], `${x[0]} (${x[1]} x ${x[2]})`])],
            onInput: (v, vals, els) => { const x = PRESETS.find((q) => q[0] === v); if (x) { els.w.value = x[1]; els.h.value = x[2]; vals.w = x[1]; vals.h = x[2] } } },
          { k: 'w', label: 'Width', type: 'number', value: p[1] || 1600, min: 1, max: 12000, unit: 'px' },
          { k: 'h', label: 'Height', type: 'number', value: p[2] || 1200, min: 1, max: 12000, unit: 'px' },
          { k: 'bg', label: 'Background', type: 'select', value: '#ffffff', options: [['#ffffff', 'White'], ['#000000', 'Black'], ['transparent', 'Transparent']] },
        ],
        onOk: (v) => {
          if (!(v.w >= 1 && v.h >= 1)) throw new Error('Enter a width and height of at least 1 px.')
          const f = fitToLimit(Math.round(v.w), Math.round(v.h))
          if (f.scaled) toast(`Reduced to ${f.w} x ${f.h} px, the largest this device can handle.`)
          app.newDoc(Math.round(v.w), Math.round(v.h), v.bg)
        },
      })
    },

    imageSize() {
      const d = app.doc, ratio = d.w / d.h
      let lock = true
      formDialog({
        title: 'Image size', icon: 'scaling', ok: 'Resize',
        note: 'Resamples every layer. Text and shapes scale with the image.',
        fields: [
          { k: 'w', label: 'Width', type: 'number', value: d.w, min: 1, max: 12000, unit: 'px', onInput: (v, vals, els) => { if (lock && v > 0) { vals.h = Math.max(1, Math.round(v / ratio)); els.h.value = vals.h } } },
          { k: 'h', label: 'Height', type: 'number', value: d.h, min: 1, max: 12000, unit: 'px', onInput: (v, vals, els) => { if (lock && v > 0) { vals.w = Math.max(1, Math.round(v * ratio)); els.w.value = vals.w } } },
          { k: 'lock', label: 'Keep aspect ratio', type: 'toggle', value: true },
        ].map((f) => f),
        onChange: (v) => { lock = v.lock },
        onOk: (v) => {
          const w = Math.round(v.w), h = Math.round(v.h)
          if (!(w >= 1 && h >= 1)) throw new Error('Enter a width and height of at least 1 px.')
          if (w * h > 64e6) throw new Error('That is larger than this device can handle. Try a smaller size.')
          if (w !== d.w || h !== d.h) { d.resizeImage(w, h); app.vp.fit() }
        },
      })
    },

    canvasSize() {
      const d = app.doc
      formDialog({
        title: 'Canvas size', icon: 'maximize-2', ok: 'Apply',
        note: 'Adds or removes space around the image. New space on the background layer uses the background color.',
        fields: [
          { k: 'w', label: 'Width', type: 'number', value: d.w, min: 1, max: 12000, unit: 'px' }, { k: 'h', label: 'Height', type: 'number', value: d.h, min: 1, max: 12000, unit: 'px' },
          { k: 'anchor', label: 'Anchor', type: 'anchor', value: [0.5, 0.5] }, { k: 'bg', label: 'Extension color', type: 'color', value: app.bg },
        ],
        onOk: (v) => {
          const w = Math.round(v.w), h = Math.round(v.h)
          if (!(w >= 1 && h >= 1) || w * h > 64e6) throw new Error('Enter a size between 1 px and what this device can handle.')
          d.bgColor = v.bg
          d.resizeCanvas(w, h, v.anchor[0], v.anchor[1]); app.vp.fit()
        },
      })
    },

    /** Gaussian blur, sharpen, noise, pixelate with a live preview on the canvas. */
    filter(kind) {
      const d = app.doc, L = d?.active, F = FILTERS[kind]
      if (!L || L.type !== 'raster') return app.warn('Filters work on pixel layers. Rasterize text or shape layers first.')
      if (L.locked) return app.warn('This layer is locked.')
      if (d.editMask) return app.warn('Select the layer thumbnail (not the mask) to apply a filter.')
      cover(L, docRect(d))
      const region = d.sel ? { x: d.sel.x, y: d.sel.y, w: d.sel.w, h: d.sel.h } : docRect(d)
      const lr = { x: region.x - L.x, y: region.y - L.y, w: region.w, h: region.h }
      const src = rctx(L.canvas).getImageData(lr.x, lr.y, lr.w, lr.h)
      const ov = copyCanvas(L.canvas), octx = rctx(ov)
      const sc = d.selectionCanvas()
      const compute = (vals) => {
        const out = F.run(src, vals)
        const res = cv(lr.w, lr.h), rx = rctx(res)
        if (sc) {
          const t = cv(lr.w, lr.h), tx = rctx(t)
          tx.putImageData(out, 0, 0)
          tx.globalCompositeOperation = 'destination-in'
          tx.drawImage(sc, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h)
          rx.putImageData(src, 0, 0)
          rx.drawImage(t, 0, 0)
        } else rx.putImageData(out, 0, 0)
        octx.clearRect(lr.x, lr.y, lr.w, lr.h)
        octx.drawImage(res, lr.x, lr.y)
        app.preview = { layerId: L.id, canvas: ov }
        app.vp.invalidate(region)
      }
      const later = debounce(compute, 90)
      formDialog({
        title: F.name, icon: F.icon, ok: 'Apply',
        note: d.sel ? 'Applies inside the selection.' : 'Applies to the whole layer.',
        fields: F.controls.map((c) => ({ k: c.k, label: c.label, type: c.type === 'toggle' ? 'toggle' : 'range', min: c.min, max: c.max, step: c.step, value: c.value, fmt: c.fmt })),
        onChange: (v) => { if (app.preview) later(v); else compute(v) },
        onOk: (v) => {
          compute(v)
          d.editPixels(L, 'layer', region, F.name, (ctx, r) => { ctx.clearRect(r.x, r.y, r.w, r.h); ctx.drawImage(ov, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h) })
        },
        onClose: () => { app.preview = null; app.vp.invalidate() },
      })
    },

    feather() {
      formDialog({ title: 'Feather selection', icon: 'lasso', ok: 'Feather', fields: [{ k: 'r', label: 'Feather radius', type: 'range', min: 1, max: 100, value: 10, fmt: (v) => `${v} px` }], onOk: (v) => app.ops.featherSelection(v.r) })
    },
    grow() {
      formDialog({ title: 'Expand or contract selection', icon: 'lasso', ok: 'Apply', fields: [{ k: 'n', label: 'Pixels (negative contracts)', type: 'range', min: -50, max: 50, value: 5, fmt: (v) => `${v > 0 ? '+' : ''}${v} px` }], onOk: (v) => app.ops.growSelection(v.n) })
    },
    fill() {
      formDialog({
        title: 'Fill', icon: 'paint-bucket', ok: 'Fill', note: app.doc.sel ? 'Fills the selection.' : 'No selection: fills the whole layer.',
        fields: [{ k: 'with', label: 'Fill with', type: 'select', value: 'fg', options: [['fg', 'Foreground color'], ['bg', 'Background color'], ['#ffffff', 'White'], ['#000000', 'Black']] },
          { k: 'op', label: 'Opacity', type: 'range', min: 1, max: 100, value: 100, fmt: (v) => `${v}%` }],
        onOk: (v) => app.ops.fillSelection(v.with === 'fg' ? app.fg : v.with === 'bg' ? app.bg : v.with, v.op / 100),
      })
    },

    transformLayer() {
      const d = app.doc, L = d.active
      if (!L || L.type !== 'raster') return app.warn('Transform works on pixel layers. Rasterize text or shape layers first.')
      formDialog({
        title: 'Transform layer', icon: 'scaling', ok: 'Apply',
        fields: [{ k: 's', label: 'Scale', type: 'range', min: 5, max: 400, value: 100, fmt: (v) => `${v}%` }, { k: 'a', label: 'Rotate', type: 'range', min: -180, max: 180, value: 0, fmt: (v) => `${v}°` }],
        onOk: (v) => d.transformLayer(L.id, v.s / 100, (v.a * Math.PI) / 180),
      })
    },

    export() {
      const d = app.doc
      let token = 0
      const bigDoc = d.w * d.h > 8e6
      const info = h('p', { class: 'ps-note', 'aria-live': 'polite' }, 'Calculating size...')
      const update = debounce((v) => {
        const t = ++token
        if (v.format === 'psd') { info.textContent = `Layered PSD, ${d.w} x ${d.h} px, ${d.layers.length} layers.`; return }
        const sc = clamp((v.scale || 100) / 100, 0.01, 8)
        if (bigDoc) { info.textContent = `${Math.round(d.w * sc)} x ${Math.round(d.h * sc)} px. The file size is shown after you export.`; return }
        ;(async () => {
          if (t !== token) return
          try {
            info.textContent = 'Calculating size...'
            const blob = await exportBlob(d, { format: v.format, quality: v.quality / 100, scale: sc, background: v.bg })
            if (t === token) info.textContent = `${Math.round(d.w * sc)} x ${Math.round(d.h * sc)} px, about ${formatBytes(blob.size)}.`
          } catch (e) { if (t === token) info.textContent = errorMessage(e) }
        })()
      }, 350)
      const m = formDialog({
        title: 'Export', icon: 'download', ok: 'Download',
        fields: [
          { k: 'format', label: 'Format', type: 'seg', value: 'png', options: [['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP'], ['psd', 'PSD']] },
          { k: 'name', label: 'File name', type: 'text', value: safeName(d.name || 'photo') },
          { k: 'scale', label: 'Scale', type: 'range', min: 10, max: 400, step: 5, value: 100, fmt: (v) => `${v}%` },
          { k: 'quality', label: 'Quality (JPG and WebP)', type: 'range', min: 40, max: 100, value: 92, fmt: (v) => `${v}%` },
          { k: 'bg', label: 'Background for JPG', type: 'color', value: '#ffffff' },
        ],
        onChange: update,
        onOk: async (v) => {
          const name = safeName(v.name || 'photo')
          if (v.format === 'psd') {
            const { blob, dropped } = await psdBlob(d)
            download(blob, `${name}.psd`)
            toast(dropped.length ? `Saved PSD. ${dropped.length} adjustment layer(s) have no PSD equivalent and were skipped: ${dropped.join(', ')}` : 'Saved PSD with layers, masks and blend modes', dropped.length ? 'info' : 'success')
          } else {
            token++
            const blob = await exportBlob(d, { format: v.format, quality: v.quality / 100, scale: clamp(v.scale / 100, 0.01, 8), background: v.bg })
            download(blob, `${name}.${FORMATS[v.format][1]}`)
            toast(`Saved ${name}.${FORMATS[v.format][1]} (${formatBytes(blob.size)})`, 'success')
          }
        },
        onClose: () => { token++ },
      })
      m.el.querySelector('.ps-form').append(info)
    },

    shortcuts() {
      modal({
        title: 'Keyboard shortcuts', icon: 'keyboard',
        body: h('div', { class: 'ps-form', style: 'gap:14px' }, SHORTCUTS.map(([title, rows]) => h('div', h('div', { class: 'ps-mh', style: 'padding-left:0' }, title),
          h('div', { style: 'display:grid;grid-template-columns:auto 1fr;gap:4px 18px;font-size:13px' }, rows.flatMap(([k, t]) => [h('kbd', { style: 'font:12px var(--mono);color:var(--text-2)' }, k), h('span', t)]))))),
      })
    },
  }
  return api
}
