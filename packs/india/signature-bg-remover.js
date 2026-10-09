// Signature background remover: paper to transparent (PNG) or white (JPG), darker ink in black, blue or its own colour.
import { h, stack, split, panel, dropzone, field, number, segmented, rangeField, toggle, alert, clear, downloadButton, formatBytes, debounce, toast } from '../../lib/ui.js'
import { loadImage, toBlob, toCanvas, canvas as newCanvas } from '../../lib/image.js'
import { baseName } from '../../lib/files.js'
import { cleanSignature, flatten, encodeToSpec } from './_imaging.js'
import { style, note } from './_shared.js'

const CSS = `
.in-sbr .pair { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
.in-sbr .pair figure { margin: 0; display: grid; gap: 6px; min-width: 0; }
.in-sbr .pair figcaption { font-size: 12.5px; color: var(--muted); }
.in-sbr .pair .preview { min-height: 120px; padding: 10px; }
.in-sbr .pair img, .in-sbr .pair canvas { max-width: 100%; height: auto; max-height: 300px; }
.in-sbr .dark-preview { background: #fff; }
@media (max-width: 640px) { .in-sbr .pair { grid-template-columns: minmax(0, 1fr); } }
`

export function mount(root) {
  style('in-sbr-style', CSS)
  const st = { img: null, file: null, thr: 50, str: 1.2, ink: 'black', trim: true, format: 'png', width: 0, maxKB: 0 }
  let cleaned = null, outBlob = null, run = 0

  const zone = dropzone({ accept: 'image/*,.heic,.heif', paste: true, label: 'Add a photo or scan of your signature', hint: 'Sign on white paper with a dark pen, then photograph it flat in good light', onFiles: ([f]) => open(f), icon: 'signature' })
  const thr = rangeField('Paper removal', { min: 0, max: 100, step: 1, value: 50, onInput: (v) => { st.thr = v; render() }, hint: 'Raise it to wipe paper texture and shadows, lower it to keep thin strokes' })
  const str = rangeField('Ink darkness', { min: 0.6, max: 2.2, step: 0.05, value: 1.2, format: (v) => `${v.toFixed(2)}x`, onInput: (v) => { st.str = v; render() }, hint: 'Make a weak pen stroke bolder' })
  const ink = segmented([['black', 'Black ink'], ['blue', 'Blue ink'], ['original', 'Keep colour']], 'black', (v) => { st.ink = v; render() }, 'Ink colour')
  const trim = toggle('Trim empty margins', true, (v) => { st.trim = v; render() })
  const fmt = segmented([['png', 'Transparent PNG'], ['jpg', 'White JPG']], 'png', (v) => { st.format = v; maxBox.hidden = v !== 'jpg'; render() }, 'Output')
  const width = number('', { min: 0, max: 4000, step: 10, placeholder: 'original', ariaLabel: 'Output width in pixels', onInput: (v) => { st.width = Number.isFinite(v) ? v : 0; render() } })
  const maxKB = number('', { min: 0, max: 5000, step: 1, placeholder: 'no limit', ariaLabel: 'Maximum file size in KB', onInput: (v) => { st.maxKB = Number.isFinite(v) ? v : 0; render() } })
  const maxBox = h('div', { hidden: true }, field('Maximum file size (KB)', maxKB))

  const before = h('div', { class: 'preview' }, h('div', { class: 'small muted' }, 'Your image'))
  const after = h('div', { class: 'preview' }, h('div', { class: 'small muted' }, 'Result'))
  const info = h('div', { class: 'small muted', 'aria-live': 'polite' })
  const dl = h('div')
  const controls = h('div', { class: 'stack' }, thr, str, ink, trim, h('div', { class: 'grid-2' }, field('Output', fmt), field('Width (px, optional)', width)), maxBox)
  const controlsPanel = panel(controls)
  controlsPanel.hidden = true
  const work = h('div', { class: 'stack', hidden: true },
    h('div', { class: 'pair' }, h('figure', before, h('figcaption', 'Original')), h('figure', after, h('figcaption', 'Cleaned (checkerboard = transparent)'))),
    info, dl)

  async function open(file) {
    try {
      st.img = await loadImage(file)
      st.file = file
      const k = Math.min(1, 900 / Math.max(st.img.naturalWidth, st.img.naturalHeight))
      clear(before, toCanvas(st.img, Math.round(st.img.naturalWidth * k), Math.round(st.img.naturalHeight * k)))
      work.hidden = false
      controlsPanel.hidden = false
      zone.classList.add('compact')
      render()
    } catch (e) { toast(e.message, 'error') }
  }

  const render = debounce(async () => {
    if (!st.img) return
    const mine = ++run
    let c = cleanSignature(st.img, { threshold: st.thr, strength: st.str, ink: st.ink, trim: st.trim, pad: 12 })
    if (st.width && st.width !== c.width) {
      const s = newCanvas(st.width, Math.max(1, Math.round((c.height * st.width) / c.width)))
      const ctx = s.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(c, 0, 0, s.width, s.height)
      c = s
    }
    cleaned = c
    const show = st.format === 'jpg' ? flatten(c) : c
    clear(after, show)
    try {
      if (st.format === 'png') outBlob = await toBlob(c, 'image/png')
      else outBlob = (await encodeToSpec(flatten(c), { maxKB: st.maxKB, minKB: 0 })).blob
    } catch (e) { clear(info, alert('error', e.message)); return }
    if (mine !== run) return
    const ext = st.format === 'png' ? 'png' : 'jpg'
    info.textContent = `${c.width} x ${c.height} px, ${formatBytes(outBlob.size)}, ${st.format === 'png' ? 'transparent background' : 'white background'}`
    clear(dl, downloadButton(outBlob, `${baseName(st.file.name)}-signature.${ext}`, `Download ${ext.toUpperCase()}`, { size: 'lg' }))
  }, 120)

  root.append(h('div', { class: 'in-sbr' }, stack(
    zone,
    split(controlsPanel, work, 'wide-right'),
    note('Works by comparing every pixel with the paper brightness around it, so uneven light and soft shadows disappear while the pen stroke stays. Use a transparent PNG to place the signature on documents, or a white JPG for forms. Nothing leaves your device.'))))
}
