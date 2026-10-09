// Photo + signature package: every file a form asks for in one go (ZIP), or the photo and signature stacked on one image.
import { h, stack, panel, field, number, button, alert, clear, downloadButton, formatBytes, debounce } from '../../lib/ui.js'
import { canvas as newCanvas } from '../../lib/image.js'
import { createWorkbench } from './_workbench.js'
import { encodeToSpec } from './_imaging.js'
import { style, note } from './_shared.js'

async function bitmap(blob) { return createImageBitmap(blob) }

export function mount(root) {
  style('in-pkg', '.in-pkg-out{display:grid;gap:10px;justify-items:start}.in-pkg-out canvas{max-width:100%;height:auto;border:1px solid var(--border);border-radius:6px;background:#fff}')
  let widthTouched = false
  const width = number(400, { min: 100, max: 2000, step: 10, ariaLabel: 'Combined image width', onInput: () => { widthTouched = true; combine() } })
  const gap = number(16, { min: 0, max: 200, step: 2, ariaLabel: 'Gap between photo and signature', onInput: () => combine() })
  const maxKB = number(100, { min: 0, max: 5000, step: 5, ariaLabel: 'Maximum KB for the combined image', onInput: () => combine() })
  const out = h('div', { class: 'in-pkg-out' })
  const msg = h('div')

  const combine = debounce(async () => {
    const res = wb.results()
    const photo = res.find((r) => r.slot.spec().kind === 'photo')
    const sig = res.find((r) => r.slot.spec().kind === 'signature')
    if (!photo || !sig) {
      clear(out)
      return clear(msg, h('div', { class: 'empty' }, 'Add a photograph and a signature above to see them combined on one image.'))
    }
    clear(msg)
    if (!widthTouched) width.value = photo.slot.spec().w // match the photo's own width so nothing is scaled up
    try {
      const [pb, sb] = await Promise.all([bitmap(photo.result.blob), bitmap(sig.result.blob)])
      const W = Math.round(width.valueAsNumber) || 400, G = Math.round(gap.valueAsNumber) || 0
      const ph = Math.round((pb.height * W) / pb.width), sh = Math.round((sb.height * W) / sb.width)
      const c = newCanvas(W, ph + G + sh)
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(pb, 0, 0, W, ph)
      ctx.drawImage(sb, 0, ph + G, W, sh)
      pb.close?.(); sb.close?.()
      const kb = Math.max(0, maxKB.valueAsNumber || 0)
      const enc = await encodeToSpec(c, { maxKB: kb, minKB: 0 })
      const name = `${wb.prefix() || wb.preset().id}-photo-and-signature.jpg`
      clear(out, c, h('div', { class: 'small muted' }, `${c.width} x ${c.height} px, ${formatBytes(enc.blob.size)}${kb ? ` (limit ${kb} KB)` : ''}${enc.softened ? ', detail softened to fit' : ''}`),
        downloadButton(enc.blob, name, `Download combined JPG`, { size: 'lg' }))
    } catch (e) { clear(msg, alert('error', e.message || 'Could not combine the images.')) }
  }, 250)

  const wb = createWorkbench({ filter: (p) => p.slots.some((s) => s.kind === 'photo') && p.slots.some((s) => s.kind === 'signature'), custom: false, initial: 'ibps', onChange: () => combine() })
  root.append(stack(
    wb.el,
    panel(h('div', { class: 'stack' },
      h('h2', { style: 'margin:0' }, 'Or put the photo and signature on one image'),
      h('div', { class: 'small muted' }, 'Some forms want a single scan with the signature under the photo. Each part is first made to fit its own rules above.'),
      h('div', { class: 'grid-2' }, field('Image width (px)', width), field('Gap (px)', gap), field('Maximum KB (0 = none)', maxKB)),
      msg, out)),
    note('For a ZIP of separate files, use the button under the cards. The combined image is built from the finished photo and signature, so it keeps the framing and cleaning you chose.')))
  combine()
}
