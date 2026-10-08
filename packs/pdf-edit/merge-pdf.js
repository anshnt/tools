// Merge PDF. Reference file tool: dropzone -> reorderable list -> options -> action -> download.
import { h, dropzone, fileList, button, busy, progress, alert, panel, field, toggle, downloadButton, clear, formatBytes } from '../../lib/ui.js'
import { pdfLib } from '../../lib/libs.js'
import { loadPdfLib, savePdf } from '../../lib/pdf.js'

export function mount(root) {
  const result = h('div')
  const prog = progress()
  prog.hide()
  const list = fileList({ onChange: () => update() })
  const blankBetween = toggle('Insert a blank page between files', false)
  const mergeBtn = button('Merge PDFs', { icon: 'combine', variant: 'primary', size: 'lg' })
  const zone = dropzone({ accept: '.pdf,application/pdf', multiple: true, label: 'Drop PDFs here or click to choose', onFiles: (files) => list.add(files) })

  function update() {
    const n = list.files.length
    mergeBtn.disabled = n < 2
    zone.classList.toggle('compact', n > 0)
    clear(result)
  }

  mergeBtn.addEventListener('click', () => busy(mergeBtn, async () => {
    const { PDFDocument } = await pdfLib()
    const out = await PDFDocument.create()
    const files = list.files
    for (let i = 0; i < files.length; i++) {
      prog.set(i / files.length, `Adding ${files[i].name}`)
      let src
      try {
        src = await loadPdfLib(files[i])
      } catch (e) {
        throw new Error(`${files[i].name}: ${e.message}`)
      }
      const pages = await out.copyPages(src, src.getPageIndices())
      for (const p of pages) out.addPage(p)
      if (blankBetween.input.checked && i < files.length - 1) {
        const last = pages.at(-1)
        out.addPage(last ? [last.getWidth(), last.getHeight()] : undefined)
      }
    }
    prog.set(1, 'Saving')
    const blob = await savePdf(out)
    prog.hide()
    const name = 'merged.pdf'
    clear(result, alert('success', h('strong', 'Done. '), `${files.length} files, ${out.getPageCount()} pages, ${formatBytes(blob.size)}.`),
      h('div', { class: 'row', style: 'margin-top:12px' }, downloadButton(blob, name, 'Download merged PDF', { size: 'lg' })))
  }, 'Merging'))

  update()
  root.append(h('div', { class: 'stack' },
    zone,
    list.el,
    panel(h('div', { class: 'stack' }, blankBetween, h('div', { class: 'row' }, mergeBtn, h('span', { class: 'small muted' }, 'Drag to reorder. Files never leave your device.')))),
    prog.el,
    result))
}
