// Batch export: render each photo's saved edits at full quality with the same WebGL pipeline, resize, name and zip them.
import { h, icon, modal, button, segmented, select, number, input, toggle, progress, alert, stats, download, formatBytes, yieldToMain, toast, errorMessage } from '../../lib/ui.js'
import { loadImage, toCanvas, toBlob, canEncode, MAX_PIXELS } from '../../lib/image.js'
import { zip, withExt } from '../../lib/files.js'
import * as store from '../../lib/store.js'
import { createRenderer } from './_gl.js'
import { getBlob } from './_store.js'
import { cropPixels, exportSize, renderName } from './_model.js'

const FORMATS = { jpeg: ['image/jpeg', 'jpg', 'JPEG'], png: ['image/png', 'png', 'PNG'], webp: ['image/webp', 'webp', 'WebP'] }
export const DEFAULT_EXPORT = { format: 'jpeg', quality: 90, mode: 'original', value: 2048, value2: 2048, upscale: false, pattern: '{name}-edit', zip: true }

/** Render one photo with its settings to a Blob. Throws a readable Error when it cannot. */
export async function renderPhoto(renderer, meta, opts, signal) {
  const blob = await getBlob(meta.id)
  if (!blob) throw new Error(`${meta.name} is no longer stored on this device.`)
  const img = await loadImage(blob)
  const fw = img.naturalWidth, fh = img.naturalHeight
  const [cw, ch] = cropPixels(meta.edits, fw, fh)
  let [ow, oh] = exportSize(cw, ch, { mode: opts.mode, value: opts.value, value2: opts.value2, upscale: opts.upscale })
  // GPU and canvas limits
  const limit = Math.min(renderer.maxSize, 16384)
  let k = Math.min(1, limit / Math.max(ow, oh), Math.sqrt(MAX_PIXELS / (ow * oh)))
  if (k < 1) { ow = Math.max(1, Math.floor(ow * k)); oh = Math.max(1, Math.floor(oh * k)) }
  // source resolution: enough for the output, never above the original or the GPU limit
  const need = ow / cw
  let ps = Math.min(1, Math.max(need * 2, need))
  ps = Math.min(ps, limit / Math.max(fw, fh))
  const src = toCanvas(img, Math.max(1, Math.round(fw * ps)), Math.max(1, Math.round(fh * ps)))
  renderer.setSource(src, src.width, src.height)
  src.width = src.height = 1
  if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' })
  renderer.render(meta.edits, ow, oh, { opaque: true })
  const [mime] = FORMATS[opts.format]
  const out = await toBlob(renderer.canvas, mime, opts.format === 'png' ? undefined : opts.quality / 100)
  renderer.trim()
  return { blob: out, width: ow, height: oh }
}

/**
 * Export many photos. Returns {blob, filename, count, bytes, names} (a ZIP, or the single image when opts.zip is false and there is one photo).
 * onProgress(fraction, text). Photos that fail are skipped and reported in `failed`.
 */
export async function exportPhotos(photos, opts, { onProgress, signal } = {}) {
  const canvas = document.createElement('canvas')
  const renderer = createRenderer(canvas)
  const [, ext] = FORMATS[opts.format]
  const entries = [], failed = []
  let bytes = 0
  try {
    for (let i = 0; i < photos.length; i++) {
      if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' })
      const m = photos[i]
      onProgress?.(i / photos.length, `Exporting ${i + 1} of ${photos.length}: ${m.name}`)
      await yieldToMain()
      try {
        const r = await renderPhoto(renderer, m, opts, signal)
        const base = renderName(opts.pattern, { name: m.name.replace(/\.[^.]+$/, ''), n: i + 1, w: r.width, h: r.height, rating: m.rating, flag: m.flag, date: new Date() })
        entries.push({ name: withExt(base, ext), data: r.blob })
        bytes += r.blob.size
      } catch (e) {
        if (e?.name === 'AbortError') throw e
        console.error(e)
        failed.push(`${m.name}: ${errorMessage(e)}`)
      }
    }
  } finally {
    renderer.trim()
  }
  if (!entries.length) throw new Error(failed[0] || 'Nothing could be exported.')
  if (entries.length === 1 && !opts.zip) return { blob: entries[0].data, filename: entries[0].name, count: 1, bytes, failed }
  onProgress?.(0.98, 'Packing the ZIP')
  const blob = await zip(entries, (p) => onProgress?.(0.98 + p * 0.02, 'Packing the ZIP'))
  return { blob, filename: `photo-develop-export-${new Date().toISOString().slice(0, 10)}.zip`, count: entries.length, bytes, failed }
}

/** The export dialog. `scopes` is [{id, label, ids}] and the first non-empty one is selected. */
export function openExportDialog(app, scopes) {
  const saved = { ...DEFAULT_EXPORT, ...store.load('pdev:export', {}) }
  const o = { ...saved }
  const usable = scopes.filter((s) => s.ids.length)
  if (!usable.length) return toast('Add photos first, then export.')
  let scope = usable[0]
  const ctl = new AbortController()

  const scopeSel = select(usable.map((s) => [s.id, `${s.label} (${s.ids.length})`]), scope.id, (v) => { scope = usable.find((s) => s.id === v); refresh() })
  const fmtSeg = segmented(Object.entries(FORMATS).map(([k, v]) => [k, v[2]]), o.format, (v) => { o.format = v; refresh() }, 'Format')
  const qVal = h('output', String(o.quality))
  const quality = h('input', { type: 'range', class: 'pd-range', min: 40, max: 100, step: 1, value: o.quality, 'aria-label': 'Quality', oninput: (e) => { o.quality = e.target.valueAsNumber; qVal.textContent = String(o.quality) } })
  const modeSel = select([['original', 'Original size'], ['long', 'Long edge'], ['width', 'Width'], ['height', 'Height'], ['percent', 'Percentage'], ['fit', 'Fit in a box']], o.mode, (v) => { o.mode = v; refresh() })
  const val1 = number(o.value, { min: 1, max: 20000, step: 1, ariaLabel: 'Size', onInput: (n) => { if (n > 0) o.value = n; refresh() } })
  const val2 = number(o.value2, { min: 1, max: 20000, step: 1, ariaLabel: 'Box height', onInput: (n) => { if (n > 0) o.value2 = n; refresh() } })
  const unit = h('span', { class: 'muted small' }, 'px')
  const up = toggle('Allow enlarging', o.upscale, (v) => { o.upscale = v })
  const pattern = input({ value: o.pattern, 'aria-label': 'File name pattern', oninput: (e) => { o.pattern = e.target.value; refresh() } })
  const zipTog = toggle('Pack in a ZIP (always for several photos)', o.zip, (v) => { o.zip = v })
  const summary = h('div', { class: 'small muted' })
  const prog = progress('Exporting')
  const result = h('div')
  const field = (label, ...kids) => h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), ...kids)

  function names() {
    const first = app.get(scope.ids[0])
    const f = FORMATS[o.format]
    const [cw, ch] = cropPixels(first.edits, first.w, first.h)
    const [w, hh] = exportSize(cw, ch, o)
    return { first, f, w, hh }
  }
  function refresh() {
    const { first, f, w, hh } = names()
    quality.disabled = o.format === 'png'
    val2.parentElement && (val2.parentElement.hidden = o.mode !== 'fit')
    val1.disabled = o.mode === 'original'
    unit.textContent = o.mode === 'percent' ? '%' : 'px'
    summary.textContent = `${scope.ids.length} photo${scope.ids.length > 1 ? 's' : ''}. First file: ${renderName(o.pattern, { name: first.name.replace(/\.[^.]+$/, ''), n: 1, w, h: hh, rating: first.rating, flag: first.flag })}.${f[1]} at ${w} x ${hh} px.`
    zipTog.input.disabled = scope.ids.length > 1
    if (scope.ids.length > 1) zipTog.input.checked = true
  }

  const run = button('Export', { icon: 'download', variant: 'primary', onClick: async () => {
    const photos = scope.ids.map((id) => app.get(id)).filter(Boolean)
    if (o.format !== 'jpeg' && !canEncode(FORMATS[o.format][0])) return toast(`This browser cannot save ${FORMATS[o.format][2]}. Choose JPEG or PNG.`, 'error')
    store.save('pdev:export', o)
    run.disabled = true; result.replaceChildren(); prog.set(0, 'Starting')
    cancel.textContent = 'Cancel'
    try {
      const r = await exportPhotos(photos, { ...o, zip: scope.ids.length > 1 || o.zip }, { onProgress: (f, t) => prog.set(f, t), signal: ctl.signal })
      download(r.blob, r.filename)
      prog.hide()
      result.replaceChildren(alert(r.failed.length ? 'warn' : 'success', h('strong', `Exported ${r.count} photo${r.count > 1 ? 's' : ''}. `), `${formatBytes(r.blob.size)} saved as ${r.filename}.`, r.failed.length ? h('div', { class: 'small' }, `${r.failed.length} skipped: ${r.failed[0]}`) : null),
        h('div', { class: 'row', style: 'margin-top:10px' }, button('Download again', { icon: 'download', size: 'sm', onClick: () => download(r.blob, r.filename) })))
      cancel.textContent = 'Close'
    } catch (e) {
      prog.hide()
      if (e?.name === 'AbortError') toast('Export cancelled')
      else result.replaceChildren(alert('error', errorMessage(e)))
    } finally { run.disabled = false }
  } })
  const cancel = button('Close', { onClick: () => { ctl.abort(); dlg.close() } })
  const body = h('div', { class: 'stack pd-export' },
    field('Photos', scopeSel),
    field('Format', fmtSeg),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, h('span', 'Quality'), qVal), quality),
    field('Size', modeSel, h('div', { class: 'row' }, h('div', { class: 'grow' }, val1), h('div', { class: 'grow' }, val2), unit), up),
    field('File name', pattern, h('small', { class: 'field-hint' }, 'Use {name}, {n}, {nn}, {nnn}, {date}, {w}, {h}, {rating}.')),
    zipTog, summary, prog.el, result,
    h('div', { class: 'small muted' }, 'Exports are rendered at full quality from the original files. Metadata such as EXIF is not copied.'))
  const dlg = modal({ title: 'Export photos', icon: 'download', body, actions: [cancel, run], onClose: () => ctl.abort() })
  refresh()
  return dlg
}
