// Delete PDF pages: tap the pages to remove (or type a range), see what stays, save.
import { h, busy, progress, alert, input, field, button, formatBytes } from '../../lib/ui.js'
import { savePdf } from '../../lib/pdf.js'
import { pdfWorkspace, dock, showResult, buildPages, plural, outName } from './_shared.js'
import { pageGrid, bindRange } from './_pages.js'

export function mount(root) {
  pdfWorkspace(root, {
    label: 'Drop a PDF to remove pages from',
    onLoad(src, ws) {
      const result = h('div'), prog = progress()
      const total = src.numPages
      const range = input({ placeholder: 'e.g. 2, 5-7', 'aria-label': 'Pages to delete', oninput: () => sync.fromText() })
      const grid = pageGrid({ pdf: src.pdf, tone: 'danger', label: 'Pages to delete', onChange: () => { sync.toText(); update() } })
      const sync = bindRange(grid, range, total, () => update())
      const btn = button('Delete pages', { icon: 'trash-2', variant: 'primary', onClick: () => run() })
      const bar = dock({ actions: [btn] })

      function update() {
        const n = grid.selected().length
        btn.disabled = n === 0 || n >= total
        btn.querySelector('span').textContent = n ? `Delete ${plural(n, 'page')}` : 'Delete pages'
        bar.text(n === 0 ? 'Tap the pages you want to remove.' : n >= total ? 'Keep at least one page.' : h('span', 'Removing ', h('b', n), ' of ', h('b', total), ' pages. ', h('b', total - n), ' will remain.'))
      }

      async function run() {
        const keep = grid.items.filter((x) => !grid.isSelected(x))
        const removed = total - keep.length
        await busy(btn, async () => {
          prog.set(null, 'Removing pages')
          const doc = await src.edit()
          const out = await buildPages(doc, keep.map((x) => ({ index: x.page - 1 })), (f) => prog.set(f, 'Copying pages'))
          const blob = await savePdf(out)
          await showResult(result, {
            blob, name: outName(src.file, 'pages-removed'), title: `${plural(removed, 'page')} removed`,
            lead: `${src.name} now has ${plural(keep.length, 'page')}.`,
            facts: [{ label: 'Pages left', value: keep.length }, { label: 'Removed', value: removed }, { label: 'File size', value: formatBytes(blob.size), tone: blob.size < src.size ? 'good' : undefined }],
            again: ws.reset,
          })
        }, { label: 'Deleting', errorTo: result, progress: prog })
      }

      update()
      return [
        h('div', { class: 'tool-split wide-left' }, h('div', { class: 'stack' }, grid.el),
          h('section', { class: 'panel stack' }, h('h2', 'Pages to delete'),
            field('Type pages or ranges', range, 'Tapping thumbnails fills this in for you.'),
            h('div', { class: 'row' }, button('First page', { variant: 'secondary', size: 'sm', onClick: () => { range.value = '1'; sync.fromText() } }), button('Last page', { variant: 'secondary', size: 'sm', onClick: () => { range.value = String(total); sync.fromText() } }),
              button('Even pages', { variant: 'secondary', size: 'sm', onClick: () => grid.selectBy((x) => (grid.items.indexOf(x) + 1) % 2 === 0) })),
            alert('info', 'Your original file is never changed. The result downloads as a new PDF.'))),
        prog.el, result, bar]
    },
  })
}
