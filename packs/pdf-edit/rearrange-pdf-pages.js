// Rearrange PDF pages: drag thumbnails (mouse, touch or Alt+arrows) into a new order, then save.
import { h, busy, progress, button, formatBytes } from '../../lib/ui.js'
import { savePdf } from '../../lib/pdf.js'
import { pdfWorkspace, dock, showResult, plural, outName, setPageOrder } from './_shared.js'
import { pageGrid, pageItems } from './_pages.js'

export function mount(root) {
  pdfWorkspace(root, {
    label: 'Drop a PDF to reorder',
    onLoad(src, ws) {
      const result = h('div'), prog = progress()
      const n = src.numPages
      const tb = (text, ic, fn, needsSel) => button(text, { icon: ic, variant: 'secondary', size: 'sm', onClick: fn, attrs: needsSel ? { 'data-needs-sel': '' } : {} })
      const grid = pageGrid({
        pdf: src.pdf, reorder: true, label: 'Pages in their new order',
        bar: [h('span', { class: 'pe-sep' }),
          tb('Reverse', 'arrow-down-up', () => grid.reverse()),
          tb('To start', 'arrow-left-to-line', () => grid.moveTo(grid.selected(), 'start'), true),
          tb('To end', 'arrow-right-to-line', () => grid.moveTo(grid.selected(), 'end'), true),
          tb('Duplicate', 'copy-plus', () => grid.duplicate(grid.selected()), true),
          tb('Fix duplex scan', 'scan-line', () => duplexFix()),
          button('Undo all', { icon: 'undo-2', variant: 'ghost', size: 'sm', onClick: () => grid.set(pageItems(src.pdf)) })],
        onChange: () => update(),
      })
      const btn = button('Save new order', { icon: 'layout-grid', variant: 'primary', onClick: () => run() })
      const bar = dock({ actions: [btn] })

      // Double-sided scans: all fronts come first (1..k) and the backs follow in reverse. Interleave them back into reading order.
      function duplexFix() {
        const it = grid.items
        const half = Math.ceil(it.length / 2)
        const fronts = it.slice(0, half), backs = it.slice(half).reverse()
        const next = []
        fronts.forEach((f, i) => { next.push(f); if (backs[i]) next.push(backs[i]) })
        grid.order(next)
      }
      const changed = () => grid.items.length !== n || grid.items.some((x, i) => x.page !== i + 1)
      function update() {
        btn.disabled = !changed()
        bar.text(changed() ? h('span', 'New order ready: ', h('b', grid.items.length), ' pages.') : 'Drag a page (or its grip handle on a phone) to a new spot. With a keyboard, focus a page and press Alt with an arrow key.')
      }

      async function run() {
        await busy(btn, async () => {
          prog.set(null, 'Reordering')
          const doc = await src.edit()
          const pages = doc.getPages()
          const seen = new Set(), plan = []
          for (const it of grid.items) {
            if (!seen.has(it.page)) { seen.add(it.page); plan.push(pages[it.page - 1]) } else plan.push((await doc.copyPages(doc, [it.page - 1]))[0])
          }
          await setPageOrder(doc, plan)
          const blob = await savePdf(doc)
          await showResult(result, {
            blob, name: outName(src.file, 'reordered'), title: 'New page order saved', lead: 'Metadata and form fields are kept.',
            facts: [{ label: 'Pages', value: grid.items.length }, { label: 'Moved', value: plural(grid.items.filter((x, i) => x.page !== i + 1).length, 'page') }, { label: 'File size', value: formatBytes(blob.size) }], again: ws.reset,
          })
        }, { label: 'Saving', errorTo: result, progress: prog })
      }

      update()
      return [grid.el, prog.el, result, bar]
    },
  })
}
