// Image to exact KB: type a size limit (and optionally a minimum) and get the best quality that fits. For government forms and uploads.
import { number, toggle, progress } from '../../lib/ui.js'
import { compressToTarget } from '../../lib/image.js'
import {
  shell, h, button, busy, chips, section, note, tiles, stage, batchSlot, results, runBatch, readSource, colorField, sameFormat, outName, clear, formatBytes,
  field, ring, FORMATS, countUp, objURL, revokeURL, toast, errorMessage,
} from './_kit.js'
import { renderResize } from './resize-image.js'
import { padJpeg, padPng } from './_meta.js'

const PRESETS = [[20, 'KB', '20 KB'], [50, 'KB', '50 KB'], [100, 'KB', '100 KB'], [200, 'KB', '200 KB'], [500, 'KB', '500 KB'], [1, 'MB', '1 MB'], [2, 'MB', '2 MB']]

/** Bytes for a value in KB or MB, using 1024 (default) or 1000 per KB. */
export const toBytes = (v, unit, base = 1024) => Math.round(v * (unit === 'MB' ? base * base : base))

/** Compress one image into [minBytes, maxBytes]. Returns {blob, quality, width, height, status, note}. */
export async function fitToSize(src, { maxBytes, minBytes = 0, fmt = 'jpg', bg = '#ffffff', allowShrink = true, pad = true, dims = null, fit = 'fill', file }) {
  let source = src.img
  if (dims) source = renderResize(src.img, { w: dims.w, h: dims.h }, { exact: true, fit, anchor: 'cc', bg })
  const w0 = source.naturalWidth || source.width
  const type = FORMATS[fmt].mime
  // Already inside the window and nothing to change: keep the original bytes.
  if (file && !dims && sameFormat(src.type, src.name) === fmt && file.size <= maxBytes && file.size >= minBytes && /jpeg|png|webp/.test(src.type)) {
    return { blob: file, quality: 1, width: src.w, height: src.h, status: 'ok', note: 'already within the limit, unchanged' }
  }
  const r = await compressToTarget(source, { maxBytes, minBytes, type, background: bg, allowResize: allowShrink, minQuality: allowShrink ? 0.35 : 0.03 })
  let blob = r.blob, status = blob.size <= maxBytes ? 'ok' : 'over', note = ''
  if (status === 'ok' && blob.size < minBytes) {
    if (pad && (fmt === 'jpg' || fmt === 'png')) {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const padded = fmt === 'jpg' ? padJpeg(bytes, minBytes - bytes.length) : padPng(bytes, minBytes - bytes.length)
      blob = new Blob([padded], { type })
      note = 'padded with filler bytes to reach the minimum'
      if (blob.size > maxBytes) status = 'over'
    } else status = 'under'
  }
  if (r.width !== w0) note = note ? `${note}; shrunk to fit` : 'shrunk to fit'
  return { blob, quality: r.quality, width: r.width, height: r.height, status, note }
}

export function mount(root, { signal }) {
  const o = { value: 50, unit: 'KB', min: NaN, fmt: 'jpg', base: 1024, bg: '#ffffff', shrink: true, pad: true, dimsOn: false, w: 413, h: 531, fit: 'fill' }
  const valIn = number(50, { min: 0.1, step: 'any', ariaLabel: 'Maximum file size', onInput: (v) => { o.value = v; presetChips.set(null); sync() } })
  const unitChips = chips([['KB', 'KB'], ['MB', 'MB']], 'KB', (v) => { o.unit = v; presetChips.set(null); sync() }, { label: 'Unit' })
  const presetChips = chips(PRESETS.map(([n, u, l]) => [l, l]), '50 KB', (v) => {
    const [n, u] = PRESETS.find((p) => p[2] === v); o.value = n; o.unit = u; valIn.value = n; unitChips.set(u); sync()
  }, { label: 'Common limits' })
  const minIn = number('', { min: 0, step: 'any', placeholder: 'No minimum', ariaLabel: 'Minimum file size in KB', onInput: (v) => { o.min = v; sync() } })
  const fmtChips = chips([['jpg', 'JPG'], ['webp', 'WebP'], ['png', 'PNG']], 'jpg', (v) => { o.fmt = v; sync() }, { label: 'Format' })
  const baseChips = chips([[1024, '1 KB = 1024 bytes'], [1000, '1 KB = 1000 bytes']], 1024, (v) => { o.base = v; sync() }, { label: 'KB definition' })
  const bg = colorField('Background for transparent areas', '#ffffff', (v) => { o.bg = v }, { swatches: ['#ffffff', '#000000'] })
  const shrink = toggle('Shrink the picture if quality alone is not enough', true, (v) => { o.shrink = v })
  const pad = toggle('Add invisible filler to reach the minimum (JPG, PNG)', true, (v) => { o.pad = v })
  const dimsT = toggle('Also set exact pixel size', false, (v) => { o.dimsOn = v; dimsBox.hidden = !v })
  const wIn = number(413, { min: 1, step: 1, ariaLabel: 'Width in pixels', onInput: (v) => { o.w = v } })
  const hIn = number(531, { min: 1, step: 1, ariaLabel: 'Height in pixels', onInput: (v) => { o.h = v } })
  const fitChips = chips([['fill', 'Crop to fill'], ['pad', 'Fit + padding'], ['stretch', 'Stretch']], 'fill', (v) => { o.fit = v }, { label: 'Shape' })
  const dimsBox = h('div', { class: 'stack', hidden: true }, h('div', { class: 'ie-row2' }, field('Width (px)', wIn), field('Height (px)', hIn)), fitChips, note('For forms that ask for a photo like 200 x 230 px and under 50 KB. The size is set first, then the file is squeezed.'))
  const summary = h('div', { class: 'ie-note' })
  const rule = h('div')

  function sync() {
    const max = toBytes(o.value, o.unit, o.base)
    const min = Number.isFinite(o.min) && o.min > 0 ? toBytes(o.min, 'KB', o.base) : 0
    const bad = !(max > 0) || (min && min >= max)
    clear(summary, !(o.value > 0) ? 'Enter the size limit.' : min >= max ? 'The minimum must be smaller than the maximum.' : `Target: ${min ? `${formatBytes(min)} to ` : 'up to '}${formatBytes(max)} (${max.toLocaleString()} bytes).`)
    goBtn.disabled = bad
    if (cur) showFacts(cur.file, cur.src, max)
    pad.hidden = !min
    bg.hidden = o.fmt !== 'jpg'
    return { max, min }
  }

  // ----- results
  const prog = progress()
  const res = results({ zipName: 'resized-to-kb.zip', compare: false, noun: 'image' })
  const goBtn = button('Compress image', { icon: 'target', variant: 'primary', size: 'lg', block: true })
  let shown = null, cur = null
  const previewImg = h('img', { alt: 'Selected image' })
  const previewBox = stage(previewImg)
  const factsHost = h('div')
  async function select(file) {
    if (!file) return
    try {
      const src = await readSource(file)
      if (shown) revokeURL(shown)
      shown = objURL(file)
      previewImg.src = shown
      const { max } = sync()
      cur = { file, src }
      showFacts(file, src, max)
    } catch (e) { toast(errorMessage(e), 'error') }
  }
  function showFacts(file, src, max) {
    const k = file.size / max
    clear(factsHost, tiles([
      { label: 'Original', value: formatBytes(file.size), sub: `${src.w} x ${src.h} px` },
      { label: 'Your limit', value: formatBytes(max), hot: true, sub: 'The result will be at or under this' },
      { label: k > 1 ? 'Needs to shrink' : 'Already smaller', value: k > 1 ? `${k >= 10 ? Math.round(k) : k.toFixed(1)}x` : 'Fits', sub: k > 1 ? 'Quality is raised as high as it can go' : 'The file stays unchanged', good: k <= 1 },
    ]))
  }
  const slot = batchSlot({ onChange: (fs) => { goBtn.querySelector('span').textContent = fs.length > 1 ? `Fit ${fs.length} images` : 'Fit to size'; work.hidden = !fs.length; clear(rule); if (!fs.length) { cur = null; clear(factsHost) } }, onSelect: select })
  goBtn.addEventListener('click', () => busy(goBtn, async () => {
    const files = [...slot.files]
    const { max, min } = sync()
    if (!files.length) return
    clear(rule)
    let last = null
    await runBatch(files, async (file) => {
      const src = await readSource(file)
      const dims = o.dimsOn && o.w > 0 && o.h > 0 ? { w: Math.round(o.w), h: Math.round(o.h) } : null
      const r = await fitToSize(src, { maxBytes: max, minBytes: min, fmt: o.fmt, bg: o.bg, allowShrink: o.shrink, pad: o.pad && !!min, dims, fit: o.fit, file })
      last = { r, max, min, file }
      const kind = r.status === 'ok' ? 'good' : 'warn'
      const badge = r.status === 'ok' ? `${formatBytes(r.blob.size)} OK` : r.status === 'over' ? 'Over the limit' : 'Under the minimum'
      const keepName = r.blob === file
      return {
        name: keepName ? file.name : outName(file.name, `${o.value}${o.unit.toLowerCase()}`.replace(/\./g, '_'), o.fmt), blob: r.blob, w: r.width, h: r.height, inSize: file.size, badge, badgeKind: kind,
        note: `${r.blob === file ? '' : `quality ${Math.round(r.quality * 100)}%`}${r.note ? `${r.blob === file ? '' : ', '}${r.note}` : ''}`.replace(/^, /, ''),
      }
    }, { out: res, prog, signal, label: 'Fitting' })
    if (last && files.length === 1) {
      const { r } = last
      const g = ring(Math.min(100, (r.blob.size / max) * 100), { accent: r.status === 'ok' })
      const vEl = h('div', { class: 'v' })
      clear(rule, h('div', { class: 'panel ie-glass', style: 'display:flex;align-items:center;gap:16px;flex-wrap:wrap' }, g.el,
        h('div', { style: 'flex:1;min-width:180px' }, h('div', { class: 'ie-note' }, r.status === 'ok' ? 'Final size' : r.status === 'over' ? 'Could not reach the limit' : 'Below the minimum'), vEl,
          h('div', { class: 'ie-note' }, `${Math.round((r.blob.size / max) * 100)}% of your limit · quality ${Math.round(r.quality * 100)}% · ${r.width} x ${r.height} px`)),
        r.status !== 'ok' ? h('div', { class: 'ie-note', style: 'flex-basis:100%' }, r.status === 'over' ? 'Even the lowest quality is too big. Turn on "Shrink the picture", pick JPG or WebP, or allow a larger size.' : 'Turn on filler bytes, choose JPG, or lower the minimum.') : null))
      countUp(vEl, r.blob.size, { format: (n) => formatBytes(n) })
      vEl.style.cssText = 'font-size:30px;font-weight:650;letter-spacing:-.03em'
    }
  }, { label: 'Fitting', progress: prog }))

  const side = h('aside', { class: 'ie-side ie-glass' },
    section('Maximum size', 'target', presetChips, h('div', { class: 'ie-row2' }, field('Up to', valIn), field('Unit', unitChips)), summary),
    section('Minimum size', 'arrow-up-to-line', field('At least (KB), optional', minIn, 'Some portals reject files that are too small.'), pad),
    section('Format', 'file-type', fmtChips, bg, baseChips, shrink),
    section('Picture size', 'frame', dimsT, dimsBox),
    h('div', { class: 'ie-foot' }, goBtn, prog.el))
  const intro = h('div', { class: 'ie-main pin' }, previewBox, factsHost, rule)
  const work = h('div', { class: 'ie-work', hidden: true }, intro, side)
  root.append(shell(slot.el, work, res.el))
  sync()
}
