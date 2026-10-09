// Extract PDF pages: pick pages (tap or type), get them as one new PDF or one file per page.
import { h, busy, progress, input, field, button, segmented, formatBytes } from '../../lib/ui.js'
import { savePdf } from '../../lib/pdf.js'
import { zip, suffixName, baseName } from '../../lib/files.js'
import { pdfWorkspace, dock, showResult, buildPages, plural, outName, formatRanges } from './_shared.js'
import { pageGrid, bindRange } from './_pages.js'

export function mount(root) {
  pdfWorkspace(root, {
    label: 'Drop a PDF to pull pages out of',
    onLoad(src, ws) {
      const result = h('div'), prog = progress()
      const total = src.numPages
      const range = input({ placeholder: 'e.g. 1-3, 8', 'aria-label': 'Pages to extract', oninput: () => sync.fromText() })
      const grid = pageGrid({ pdf: src.pdf, label: 'Pages to extract', onChange: () => { sync.toText(); update() } })
      const sync = bindRange(grid, range, total, () => update())
      const how = segmented([['one', 'One PDF'], ['each', 'One file per page (ZIP)']], 'one', () => update(), 'Output')
      const btn = button('Extract pages', { icon: 'file-output', variant: 'primary', onClick: () => run() })
      const bar = dock({ actions: [btn] })

      function update() {
        const n = grid.selected().length
        btn.disabled = n === 0
        btn.querySelector('span').textContent = n ? `Extract ${plural(n, 'page')}` : 'Extract pages'
        bar.text(n === 0 ? 'Tap the pages you want to keep.' : h('span', h('b', n), ` of ${total} pages will be extracted`, how.value === 'each' ? ' as separate files.' : ' into one PDF.'))
      }

      async function run() {
        const picked = grid.selected().map((x) => x.page)
        await busy(btn, async () => {
          const doc = await src.edit()
          if (how.value === 'each' && picked.length > 1) {
            const files = []
            for (let i = 0; i < picked.length; i++) {
              prog.set(i / picked.length, `Page ${picked[i]}`)
              const out = await buildPages(doc, [{ index: picked[i] - 1 }])
              files.push({ name: suffixName(src.name, `page-${picked[i]}`, 'pdf'), data: await savePdf(out) })
            }
            const blob = await zip(files)
            await showResult(result, {
              blob, name: `${baseName(src.name)}-pages.zip`, title: `${plural(files.length, 'file')} ready`, lead: 'Each selected page is its own PDF, bundled in a ZIP.',
              facts: [{ label: 'Files', value: files.length }, { label: 'ZIP size', value: formatBytes(blob.size) }], again: ws.reset,
            })
          } else {
            prog.set(null, 'Extracting')
            const out = await buildPages(doc, picked.map((p) => ({ index: p - 1 })), (f) => prog.set(f, 'Copying pages'))
            const blob = await savePdf(out)
            await showResult(result, {
              blob, name: outName(src.file, `pages-${formatRanges(picked).replace(/, /g, '_')}`), title: `${plural(picked.length, 'page')} extracted`,
              lead: `Pages ${formatRanges(picked)} of ${src.name}.`, facts: [{ label: 'Pages', value: picked.length }, { label: 'File size', value: formatBytes(blob.size), tone: blob.size < src.size ? 'good' : undefined }], again: ws.reset,
            })
          }
        }, { label: 'Extracting', errorTo: result, progress: prog })
      }

      update()
      return [
        h('div', { class: 'tool-split wide-left' }, grid.el,
          h('section', { class: 'panel stack' }, h('h2', 'Pages to extract'),
            field('Type pages or ranges', range, 'For example 1-3, 8. Tapping thumbnails fills this in.'),
            field('Save as', how),
            h('div', { class: 'row' }, button('Odd', { variant: 'secondary', size: 'sm', onClick: () => grid.selectBy((x) => x.page % 2 === 1) }), button('Even', { variant: 'secondary', size: 'sm', onClick: () => grid.selectBy((x) => x.page % 2 === 0) }),
              button('All', { variant: 'secondary', size: 'sm', onClick: () => grid.selectAll() })))),
        prog.el, result, bar]
    },
  })
}
