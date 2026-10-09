// Rotate PDF: rotate every page or only the ones you pick, with live thumbnails.
import { h, busy, progress, button, formatBytes } from '../../lib/ui.js'
import { savePdf } from '../../lib/pdf.js'
import { pdfLib } from '../../lib/libs.js'
import { pdfWorkspace, dock, showResult, plural, outName } from './_shared.js'
import { pageGrid, itemRotation } from './_pages.js'

export function mount(root) {
  pdfWorkspace(root, {
    label: 'Drop a PDF to rotate',
    onLoad(src, ws) {
      const result = h('div'), prog = progress()
      const act = (ic, text, deg) => button(text, { icon: ic, variant: 'secondary', size: 'sm', onClick: () => grid.rotate(grid.targets(), deg) })
      const reset = button('Reset', { icon: 'undo-2', variant: 'ghost', size: 'sm', onClick: () => { for (const x of grid.items) x.rot = 0; grid.refresh(); update() } })
      const grid = pageGrid({
        pdf: src.pdf, rotate: true, label: 'Pages to rotate',
        bar: [h('span', { class: 'pe-sep' }), act('rotate-ccw', 'Left', -90), act('rotate-cw', 'Right', 90), act('refresh-cw', '180', 180), reset],
        onChange: () => update(),
      })
      const btn = button('Save rotated PDF', { icon: 'rotate-cw', variant: 'primary', onClick: () => run() })
      const bar = dock({ actions: [btn] })

      function update() {
        const changed = grid.items.filter((x) => itemRotation(x))
        btn.disabled = !changed.length
        bar.text(changed.length ? h('span', h('b', changed.length), ` of ${src.numPages} pages rotated.`) : 'Hover a page and tap its rotate button, or select pages and use Left, Right or 180. With nothing selected, those buttons rotate every page.')
      }

      async function run() {
        await busy(btn, async () => {
          prog.set(null, 'Rotating')
          const { degrees } = await pdfLib()
          const doc = await src.edit()
          const pages = doc.getPages()
          let n = 0
          for (const it of grid.items) {
            const r = itemRotation(it)
            if (!r) continue
            const pg = pages[it.page - 1]
            pg.setRotation(degrees((((pg.getRotation().angle + r) % 360) + 360) % 360))
            n++
          }
          const blob = await savePdf(doc)
          await showResult(result, {
            blob, name: outName(src.file, 'rotated'), title: `${plural(n, 'page')} rotated`, lead: 'Text, links and forms stay exactly as they were. Only the page orientation changed.',
            facts: [{ label: 'Rotated', value: n }, { label: 'Pages', value: src.numPages }, { label: 'File size', value: formatBytes(blob.size) }], again: ws.reset,
          })
        }, { label: 'Saving', errorTo: result, progress: prog })
      }

      update()
      return [grid.el, prog.el, result, bar]
    },
  })
}
