// Merge PDF. Reference file tool: dropzone -> reorderable list -> options -> action -> download.
import { h, dropzone, fileList, button, busy, progress, alert, panel, toggle, downloadButton, clear, formatBytes, yieldToMain } from '../../lib/ui.js'
import { pdfLib } from '../../lib/libs.js'
import { loadPdfLib, savePdf } from '../../lib/pdf.js'

export function mount(root) {
  const result = h('div')
  const prog = progress()
  const list = fileList({ onChange: () => update() })
  const blankBetween = toggle('Insert a blank page between files', false)
  const mergeBtn = button('Merge PDFs', { icon: 'combine', variant: 'primary', size: 'lg' })
  const zone = dropzone({ accept: '.pdf,application/pdf', multiple: true, label: 'Drop PDFs here or click to choose', onFiles: (files) => list.add(files) })

  function update() {
    const n = list.files.length
    mergeBtn.disabled = n < 2
    zone.classList.toggle('compact', n > 0)
    clear(result, n === 1 ? alert('info', 'Add at least one more PDF to merge.') : null)
  }

  mergeBtn.addEventListener('click', () => busy(mergeBtn, async () => {
    const files = [...list.files] // snapshot: the list stays editable but this run uses the order you clicked with
    clear(result)
    list.setDisabled(true)
    try {
      const { PDFDocument } = await pdfLib()
      const out = await PDFDocument.create()
      for (let i = 0; i < files.length; i++) {
        prog.set(i / files.length, `Adding ${files[i].name}`)
        let src
        try {
          src = await loadPdfLib(files[i])
        } catch (e) {
          throw new Error(e.code === 'PASSWORD'
            ? `${files[i].name} is password-protected. Unlock it first with Remove PDF password, then merge.`
            : `${files[i].name}: ${e.message}`)
        }
        const pages = await out.copyPages(src, src.getPageIndices())
        for (const p of pages) out.addPage(p)
        if (blankBetween.input.checked && i < files.length - 1) {
          const last = pages.at(-1)
          out.addPage(last ? [last.getWidth(), last.getHeight()] : undefined)
        }
        await yieldToMain()
      }
      prog.set(1, 'Saving')
      const blob = await savePdf(out)
      clear(result, alert('success', h('strong', 'Done. '), `${files.length} files, ${out.getPageCount()} pages, ${formatBytes(blob.size)}.`),
        h('div', { class: 'row', style: 'margin-top:12px' }, downloadButton(blob, 'merged.pdf', 'Download merged PDF', { size: 'lg' })))
    } finally {
      list.setDisabled(false)
    }
  }, { label: 'Merging', errorTo: result, progress: prog }))

  update()
  root.append(h('div', { class: 'stack' },
    zone,
    list.el,
    panel(h('div', { class: 'stack' }, blankBetween, h('div', { class: 'row' }, mergeBtn, h('span', { class: 'small muted' }, 'Drag or use the arrows to reorder. Files never leave your device.')))),
    prog.el,
    result))
}
