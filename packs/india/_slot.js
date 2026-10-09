// One upload slot (photo, signature, thumb impression or declaration): drop an image, frame it, clean it, and get a JPEG that
// passes the size rules, with a pass/fail checklist. Used by the government photo resizer, signature resizer and the package tool.
import { h, icon, dropzone, button, field, number, select, segmented, toggle, rangeField, alert, clear, downloadButton, debounce, onCleanup, formatBytes, toast } from '../../lib/ui.js'
import { loadImage } from '../../lib/image.js'
import { cropRect, drawCrop, drawContain, detectFace, frameForFace, backgroundMask, applyBackground, cleanSignature, flatten, trimToInk, encodeToSpec, inspectBlob } from './_imaging.js'
import { checkSlot } from './_presets.js'
import { style, checklist, details, useStyles } from './_shared.js'

const CSS = `
.in-slot { display: grid; gap: 12px; min-width: 0; align-content: start; }
.in-slot h3 { margin: 0; font-size: 16px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.in-slot .chips { display: flex; flex-wrap: wrap; gap: 6px; }
.in-slot .chips span { font-size: 12px; padding: 2px 9px; border-radius: 99px; background: var(--surface-2); border: 1px solid var(--border); color: var(--text-2); font-variant-numeric: tabular-nums; }
.in-slot .work { display: grid; gap: 12px; }
.in-slot .stage { display: grid; place-items: center; }
.in-slot canvas.cv { display: block; height: auto; max-width: 100%; touch-action: none; cursor: grab; border-radius: 4px; outline-offset: 3px; }
.in-slot canvas.cv.still { cursor: default; touch-action: auto; }
.in-slot canvas.cv:active { cursor: grabbing; }
.in-slot canvas.cv.still:active { cursor: default; }
.in-slot .tip { font-size: 12.5px; color: var(--muted); text-align: center; margin-top: 6px; }
.in-slot .status { font-size: 13px; color: var(--text-2); }
`

const FACE_KINDS = new Set(['photo'])
const COVER_KINDS = new Set(['photo', 'thumb'])

/** createSlot({spec, paste, prefix, onChange}) -> {el, spec, setSpec(spec), result: {blob, info, ok} | null, hasImage(), setFile(file), filename()} */
export function createSlot({ spec: initial, paste = false, prefix = '', onChange, onFile, defaults = {} } = {}) {
  useStyles()
  style('in-slot-style', CSS)
  let spec = { ...initial }
  const st = { src: null, name: '', zoom: 1, cx: 0.5, cy: 0.5, white: false, tol: 28, clean: true, trim: true, ink: 'black', thr: 50, str: 1.2, fit: 'contain', ...defaults }
  let token = 0, cache = null, bgCache = null
  const api = { result: null }

  const chips = h('div', { class: 'chips' })
  const title = h('h3')
  const zone = dropzone({ accept: 'image/*,.heic,.heif', paste, compact: true, label: `Add ${spec.label.toLowerCase()}`, hint: 'JPG, PNG, WebP or iPhone HEIC' + (paste ? ' · paste with Ctrl+V' : ''), onFiles: ([f]) => api.setFile(f), icon: 'image-up' })
  const cv = h('canvas', { class: 'cv', width: 10, height: 10, tabindex: 0, 'aria-label': `${spec.label} preview` })
  const preview = h('div', { class: 'preview', style: 'padding:14px' }, cv)
  const tip = h('div', { class: 'tip' })
  const checks = h('div')
  const status = h('div', { class: 'status', 'aria-live': 'polite' })
  const dl = h('div')
  const faceNote = h('small', { class: 'field-hint' })
  const bgNote = h('small', { class: 'field-hint', 'aria-live': 'polite' })

  // ----- controls -----
  const zoom = rangeField('Zoom', { min: 1, max: 6, step: 0.01, value: 1, format: (v) => `${v.toFixed(2)}x`, onInput: (v) => { st.zoom = v; refresh() } })
  const white = toggle('Make the background white', false, (v) => { st.white = v; tolBox.hidden = !v; refresh() })
  const tol = rangeField('Background tolerance', { min: 8, max: 90, step: 1, value: 28, onInput: (v) => { st.tol = v; refresh() }, hint: 'Raise it if grey patches remain, lower it if your hair or clothes turn white' })
  const tolBox = h('div', { hidden: true }, tol)
  const auto = button('Auto-frame face', { icon: 'scan-face', size: 'sm', onClick: () => autoFrame(true) })
  const reset = button('Reset', { icon: 'rotate-ccw', size: 'sm', onClick: () => { st.zoom = 1; st.cx = st.cy = 0.5; zoom.set(1); refresh() } })
  const clean = toggle('Make paper white and ink dark', st.clean, (v) => { st.clean = v; refresh() })
  const trim = toggle('Trim empty margins', st.trim, (v) => { st.trim = v; refresh() })
  const ink = segmented([['black', 'Black ink'], ['blue', 'Blue ink'], ['original', 'Keep colour']], st.ink, (v) => { st.ink = v; refresh() }, 'Ink colour')
  const thr = rangeField('Paper removal', { min: 0, max: 100, step: 1, value: 50, onInput: (v) => { st.thr = v; refresh() }, hint: 'Raise it to wipe faint paper texture, lower it to keep thin pen strokes' })
  const photoCtl = spec.kind === 'photo' ? h('div', { class: 'stack' }, zoom, h('div', { class: 'row' }, auto, reset), white, tolBox, bgNote, faceNote) : null
  const fit = select([['contain', 'Keep proportions, pad with white'], ['stretch', 'Stretch to the exact size']], st.fit, (v) => { st.fit = v; refresh() })
  const inkCtl = COVER_KINDS.has(spec.kind) ? null : h('div', { class: 'stack' }, field('Fit', fit), clean, trim, ink, thr)
  const thumbCtl = spec.kind === 'thumb' ? h('div', { class: 'stack' }, zoom, h('div', { class: 'row' }, reset)) : null

  const f = {
    w: number(spec.w, { min: 8, max: 4000, step: 1, ariaLabel: `${spec.label} width in pixels`, onInput: (v) => edit('w', v) }),
    h: number(spec.h, { min: 8, max: 4000, step: 1, ariaLabel: `${spec.label} height in pixels`, onInput: (v) => edit('h', v) }),
    minKB: number(spec.minKB, { min: 0, max: 5000, step: 1, ariaLabel: `${spec.label} minimum KB`, onInput: (v) => edit('minKB', v) }),
    maxKB: number(spec.maxKB, { min: 0, max: 5000, step: 1, ariaLabel: `${spec.label} maximum KB`, onInput: (v) => edit('maxKB', v) }),
  }
  const rules = details('Adjust the size rules', [
    h('div', { class: 'grid-2' }, field('Width (px)', f.w), field('Height (px)', f.h), field('Minimum KB (0 = none)', f.minKB), field('Maximum KB (0 = none)', f.maxKB)),
    h('small', { class: 'field-hint' }, 'Use this when your notice asks for something different.'),
  ])
  function edit(k, v) {
    if (!Number.isFinite(v)) return
    spec = { ...spec, [k]: v }
    if (k === 'w' || k === 'h') delete spec.range
    drawChips()
    if (st.src) { if (COVER_KINDS.has(spec.kind)) refit(); refresh() }
  }

  const work = h('div', { class: 'work', hidden: true },
    h('div', { class: 'stage' }, preview, tip),
    COVER_KINDS.has(spec.kind) ? (FACE_KINDS.has(spec.kind) ? photoCtl : thumbCtl) : inkCtl,
    status, checks, dl,
    h('div', { class: 'row' }, button('Replace image', { icon: 'image-up', size: 'sm', onClick: () => zone.open() })),
    rules)
  const el = h('section', { class: 'panel in-slot' }, title, chips, zone, work)

  function drawChips() {
    const r = spec.range
    clear(title, icon(spec.kind === 'signature' ? 'signature' : spec.kind === 'thumb' ? 'fingerprint' : spec.kind === 'declaration' ? 'file-pen-line' : 'user-round'), spec.label)
    clear(chips, [r ? `${r.minW}-${r.maxW} x ${r.minH}-${r.maxH} px` : `${spec.w} x ${spec.h} px`, `${spec.minKB ? spec.minKB + ' to ' : 'up to '}${spec.maxKB || 'any'} KB`.replace('up to any KB', 'no size limit'), 'JPEG', spec.dpi ? `${spec.dpi} dpi` : null].filter(Boolean).map((t) => h('span', t)))
  }

  // ----- pipeline -----
  const cover = () => COVER_KINDS.has(spec.kind)
  const aspect = () => spec.w / spec.h

  function refit() {
    // keep the centre valid after the box shape changed
    const r = cropRect(st.src.naturalWidth, st.src.naturalHeight, aspect(), st.zoom, st.cx, st.cy)
    st.cx = (r.x + r.w / 2) / st.src.naturalWidth
    st.cy = (r.y + r.h / 2) / st.src.naturalHeight
  }

  function build() {
    const src = st.src
    if (cover()) {
      const rect = cropRect(src.naturalWidth, src.naturalHeight, aspect(), st.zoom, st.cx, st.cy)
      const c = drawCrop(src, rect, spec.w, spec.h)
      if (st.white && spec.kind === 'photo') {
        const key = `${st.tol}`
        if (!bgCache || bgCache.src !== src || bgCache.key !== key) bgCache = { src, key, mask: backgroundMask(src, st.tol) }
        if (bgCache.mask) applyBackground(c, bgCache.mask, rect)
        bgNote.textContent = bgCache.mask ? '' : 'No plain background found along the edges, so nothing was whitened. This works best on a photo taken against a plain wall.'
      } else if (bgNote.textContent) {
        bgNote.textContent = ''
      }
      return c
    }
    let base
    if (st.clean) {
      const key = [st.thr, st.str, st.ink, st.trim].join('|')
      if (!cache || cache.key !== key) cache = { key, canvas: cleanSignature(src, { threshold: st.thr, strength: st.str, ink: st.ink, trim: st.trim, pad: 10 }) }
      base = flatten(cache.canvas)
    } else if (st.trim) {
      const flat = flatten(drawContain(src, Math.min(1800, src.naturalWidth), Math.round(Math.min(1800, src.naturalWidth) * src.naturalHeight / src.naturalWidth)))
      base = trimToInk(flat, 10, false)
    } else base = src
    if (st.fit === 'stretch') {
      const c = drawContain(base, spec.w, spec.h, '#ffffff', 0)
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(base, 0, 0, base.naturalWidth || base.width, base.naturalHeight || base.height, 0, 0, c.width, c.height)
      return c
    }
    return drawContain(base, spec.w, spec.h, '#ffffff', Math.max(2, Math.round(Math.min(spec.w, spec.h) * 0.05)))
  }

  let current = null
  function paint() {
    if (!st.src) return
    current = build()
    cv.width = current.width
    cv.height = current.height
    cv.getContext('2d').drawImage(current, 0, 0)
    const shown = Math.min(Math.max(current.width, 220), 340)
    cv.style.width = `${shown}px`
    cv.classList.toggle('still', !cover())
    tip.textContent = cover() ? 'Drag the picture to move it, use the zoom slider to resize.' : 'This is what will be uploaded.'
  }

  const encode = debounce(async () => {
    if (!st.src || !current) return
    const mine = ++token
    status.textContent = 'Checking the file size'
    try {
      const out = await encodeToSpec(current, { minKB: spec.minKB, maxKB: spec.maxKB, dpi: spec.dpi })
      if (mine !== token) return
      const info = await inspectBlob(out.blob)
      if (mine !== token) return
      const items = checkSlot(spec, info, out)
      const ok = items.every((i) => i.ok !== false)
      api.result = { blob: out.blob, info, ok }
      status.textContent = ''
      clear(checks, checklist(items), ok ? null : h('div', { style: 'margin-top:8px' }, alert('warn', 'One or more rules are not met. Check the numbers under "Adjust the size rules", or the notice for your form.')))
      clear(dl, downloadButton(out.blob, filename(), `Download ${formatBytes(out.blob.size)} JPG`, { size: 'lg' }))
      onChange?.(api)
    } catch (e) {
      if (mine !== token) return
      api.result = null
      status.textContent = ''
      clear(checks, alert('error', e.message || 'Could not make this file.'))
      clear(dl)
      onChange?.(api)
    }
  }, 260)

  function refresh() {
    paint()
    encode()
  }

  async function autoFrame(announce) {
    if (!st.src || !FACE_KINDS.has(spec.kind)) return
    const iw = st.src.naturalWidth, ih = st.src.naturalHeight
    const face = await detectFace(st.src)
    if (face) {
      const fr = frameForFace(face, iw, ih, aspect(), spec.face || 0.62)
      Object.assign(st, { zoom: fr.zoom, cx: fr.cx, cy: fr.cy })
      faceNote.textContent = face.source === 'detector' ? 'Face found and centred. Drag to fine-tune.' : 'Face centred by skin colour (best effort). Drag to fine-tune.'
    } else {
      // no face found: centre horizontally, favour the upper half where heads usually are
      Object.assign(st, { zoom: 1, cx: 0.5, cy: ih > iw / aspect() ? 0.42 : 0.5 })
      faceNote.textContent = 'No face found, so the photo is centred. Drag to place your face in the middle.'
    }
    refit()
    zoom.set(st.zoom)
    if (announce) toast(face ? 'Framed on the face' : 'No face found. Position it by hand.', face ? 'success' : 'info')
    refresh()
  }

  const opening = h('div', { class: 'small muted', hidden: true, role: 'status' }, h('span', { class: 'spinner' }), ' Opening the image')
  zone.after(opening)
  api.setFile = async (file) => {
    opening.hidden = false
    try {
      const img = await loadImage(file)
      st.src = img
      st.name = file.name
      cache = null
      Object.assign(st, { zoom: 1, cx: 0.5, cy: 0.5 })
      zoom.set(1)
      work.hidden = false
      zone.classList.add('compact')
      onFile?.(file)
      if (FACE_KINDS.has(spec.kind)) await autoFrame(false)
      else refresh()
    } catch (e) {
      toast(e.message || 'Could not open that image.', 'error')
    } finally {
      opening.hidden = true
    }
  }
  api.setSpec = (next) => {
    spec = { ...next }
    for (const k of Object.keys(f)) f[k].value = spec[k] ?? 0
    drawChips()
    if (st.src) { if (cover()) { refit(); if (FACE_KINDS.has(spec.kind)) autoFrame(false); else refresh() } else refresh() }
  }
  api.hasImage = () => !!st.src
  api.sourceSize = () => (st.src ? { w: st.src.naturalWidth, h: st.src.naturalHeight } : null)
  api.destroy = () => { token++ }
  api.spec = () => spec
  const filename = () => `${prefix ? prefix + '-' : ''}${spec.key}.jpg`
  api.filename = filename
  api.setPrefix = (p) => { prefix = p }

  // ----- drag to pan -----
  let drag = null
  cv.addEventListener('pointerdown', (e) => {
    if (!cover() || !st.src) return
    drag = { x: e.clientX, y: e.clientY, cx: st.cx, cy: st.cy }
    cv.setPointerCapture(e.pointerId)
  })
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return
    const rect = cropRect(st.src.naturalWidth, st.src.naturalHeight, aspect(), st.zoom, st.cx, st.cy)
    const k = rect.w / cv.getBoundingClientRect().width
    st.cx = drag.cx - ((e.clientX - drag.x) * k) / st.src.naturalWidth
    st.cy = drag.cy - ((e.clientY - drag.y) * k) / st.src.naturalHeight
    refit()
    paint()
    encode()
  })
  const end = () => { drag = null }
  cv.addEventListener('pointerup', end)
  cv.addEventListener('pointercancel', end)
  cv.addEventListener('keydown', (e) => {
    if (!cover() || !st.src) return
    const step = 0.02 / st.zoom
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (d) { e.preventDefault(); st.cx += d[0]; st.cy += d[1]; refit(); refresh() }
    else if (e.key === '+' || e.key === '=') { st.zoom = Math.min(6, st.zoom + 0.1); zoom.set(st.zoom); refit(); refresh() }
    else if (e.key === '-') { st.zoom = Math.max(1, st.zoom - 0.1); zoom.set(st.zoom); refit(); refresh() }
  })
  onCleanup(() => { token++ })

  drawChips()
  api.el = el
  return api
}
