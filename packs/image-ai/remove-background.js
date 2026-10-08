// Remove background: on-device AI cutout with edge refinement, preview backgrounds, batch and ZIP download.
import { h, button, busy, segmented, toast, downloadButton, download, progress, clear } from '../../lib/ui.js'
import { suffixName, zip } from '../../lib/files.js'
import { canEncode } from '../../lib/image.js'
import { canvasBlob, handoff } from './_ml.js'
import { subjects, modelSection, edgesSection } from './_subject.js'
import { subjectStudio } from './_studio.js'
import { shell, panelOf, section, swatches, devicePill, doneCard, nextLink, note } from './_ui.js'

export function mount(root, { signal }) {
  const q = subjects({ model: 'balanced' })
  const out = { fmt: 'png', trim: false }

  const outName = (it) => suffixName(it.name, 'no-bg', out.fmt)
  async function exportBlob(it) {
    const { canvas } = await q.cutout(it, { trim: out.trim })
    return canvasBlob(canvas, out.fmt === 'webp' ? 'image/webp' : 'image/png', 0.95)
  }
  async function copyImage(it) {
    try {
      const { canvas } = await q.cutout(it, { trim: out.trim })
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': await canvasBlob(canvas, 'image/png') })])
      toast('Image copied. Paste it anywhere.', 'success')
    } catch {
      toast('Your browser would not let us copy the image. Use Download instead.', 'error')
    }
  }

  const studio = subjectStudio({
    q, signal, afterLabel: 'Cutout', resultView: 'Cutout',
    hero: {
      label: 'Drop photos here, or click to choose',
      hint: 'JPG, PNG, WebP, HEIC and more. Paste with Ctrl+V works too.',
      icons: ['user-round', 'shapes', 'sparkles', 'wand-sparkles'],
      features: [['shield-check', 'Stays on your device'], ['sparkles', 'Transparent PNG'], ['images', 'Batch and ZIP']],
    },
    draw(it, cv) {
      const cut = q.previewCutout(it)
      cv.width = cut.width; cv.height = cut.height
      const ctx = cv.getContext('2d')
      ctx.clearRect(0, 0, cut.width, cut.height)
      ctx.drawImage(cut, 0, 0)
    },
    renderDone: (it) => doneCard({
      title: 'Background removed',
      sub: `${(it.ms / 1000).toFixed(1)} s on ${it.device === 'webgpu' ? 'your GPU' : 'your CPU'}. Refine the edges on the right if you like.`,
      actions: [
        downloadButton(() => exportBlob(it), () => outName(it), `Download ${out.fmt.toUpperCase()}`, { size: 'lg' }),
        button('Copy image', { icon: 'copy', variant: 'secondary', size: 'lg', onClick: () => copyImage(it) }),
        devicePill(it.device),
      ],
      next: [nextLink('change-background', 'Change background', 'paint-bucket', () => handoff.put(it.file, { model: q.model }))],
    }),
  })

  // ---------- side panel
  const models = modelSection(q, () => { if (studio.active) studio.run(studio.active) })
  const edges = edgesSection(q, async (kind) => {
    const a = studio.active
    if (!a || q.stale(a)) return
    if (kind === 'rebase') await q.rebase(a)
    studio.redraw()
  })
  const setPreviewBg = (v) => {
    const stg = studio.stage
    stg.style.background = ''
    stg.setVariant('')
    if (v === '#ffffff') stg.setVariant('on-white')
    else if (v !== 'none') stg.style.background = v
  }
  const bgSw = swatches(['#ffffff', '#101018', '#22c55e', '#38bdf8'], 'none', setPreviewBg, { none: true })
  const fmtSeg = segmented([['png', 'PNG'], ...(canEncode('image/webp') ? [['webp', 'WebP (smaller)']] : [])], out.fmt, (v) => { out.fmt = v; studio.select(studio.active) })
  const trimToggle = h('label', { class: 'switch' }, h('input', { type: 'checkbox', role: 'switch', onchange: (e) => { out.trim = e.target.checked } }), h('span', 'Crop to the subject'))
  const panel = panelOf(
    models, edges,
    section('Preview', 'eye', [bgSw, note('info', 'The preview background is only for viewing. Your download stays transparent.')], false),
    section('Download', 'download', [h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Format'), fmtSeg), trimToggle], false))

  const dlBtn = button('Download cutout', { icon: 'download', variant: 'primary', size: 'lg', block: true })
  dlBtn.addEventListener('click', () => busy(dlBtn, async () => {
    const it = studio.active
    if (!it) return
    await studio.runAndWait(it)
    if (q.stale(it)) return
    download(await exportBlob(it), outName(it))
  }, { label: 'Preparing file' }))
  const allBtn = button('Download all as ZIP', { icon: 'archive', variant: 'secondary', block: true })
  const allProg = progress('Processing')
  allBtn.addEventListener('click', () => busy(allBtn, async () => {
    const files = []
    const list = [...q.items]
    for (let i = 0; i < list.length; i++) {
      allProg.set(i / list.length, `Cutting out ${list[i].name} (${i + 1} of ${list.length})`)
      await studio.runAndWait(list[i])
      if (q.stale(list[i])) continue
      files.push({ name: outName(list[i]), data: await exportBlob(list[i]) })
    }
    if (!files.length) throw new Error('None of the photos could be processed.')
    allProg.set(1, 'Zipping')
    download(await zip(files), 'background-removed.zip')
    toast(`Saved ${files.length} cutouts`, 'success')
  }, { label: 'Working', progress: allProg }))
  const startOver = button('Start over', { icon: 'rotate-ccw', variant: 'ghost', block: true, onClick: () => studio.reset() })
  allBtn.hidden = true
  studio.onQueue = (n) => { allBtn.hidden = n < 2 }
  studio.onReset = () => edges.reset()
  studio.setSide(panel, h('div', { class: 'stack tight' }, dlBtn, allBtn, allProg.el, startOver))

  shell(root, studio.stepper, studio.hero, studio.layout)
  return () => studio.dispose()
}
