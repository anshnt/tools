// Add pages to a PDF: insert blank pages, images or pages from another PDF anywhere, then drag them into place.
import { h, icon, busy, progress, input, number, select, field, button, dropzone, alert, tabs, formatBytes, segmented, clear, toast, errorMessage } from '../../lib/ui.js'
import { openPdf, loadPdfLib, savePdf, parseRanges, pageSize, PAGE_SIZES } from '../../lib/pdf.js'
import { loadImage, toCanvas, toBlob } from '../../lib/image.js'
import { pdfLib } from '../../lib/libs.js'
import { pdfWorkspace, dock, showResult, plural, outName, copyInfo, destroyPdf } from './_shared.js'
import { pageGrid, newItem, itemRotation } from './_pages.js'

const MM = 72 / 25.4
const sizeOf = (name) => (name === 'a4' ? PAGE_SIZES.A4 : name === 'letter' ? PAGE_SIZES.Letter : name === 'legal' ? PAGE_SIZES.Legal : name === 'a3' ? PAGE_SIZES.A3 : PAGE_SIZES.A5)
const thumbOf = (w, h2, fill) => { const k = 260 / Math.max(w, h2); const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h2 * k); fill?.(c.getContext('2d'), k); return c }

/** Where an image goes on its page: returns {pageW, pageH, x, y, w, h} (points, y from the bottom). */
export function imageLayout(iw, ih, { size = 'a4', margin = 10 } = {}) {
  const m = margin * MM
  if (size === 'image') return { pageW: iw + 2 * m, pageH: ih + 2 * m, x: m, y: m, w: iw, h: ih }
  let [pw, ph] = sizeOf(size)
  if (iw > ih) [pw, ph] = [ph, pw]
  const k = Math.min((pw - 2 * m) / iw, (ph - 2 * m) / ih)
  const w = iw * k, hh = ih * k
  return { pageW: pw, pageH: ph, x: (pw - w) / 2, y: (ph - hh) / 2, w, h: hh }
}

export function mount(root) {
  pdfWorkspace(root, {
    label: 'Drop the PDF you want to add pages to',
    onLoad(src, ws) {
      const result = h('div'), prog = progress()
      const others = []
      const grid = pageGrid({
        pdf: src.pdf, select: 'single', reorder: true, rotate: true, remove: true, toolbar: false, label: 'Pages. Select one to insert after it.',
        onChange: () => update(),
      })
      const where = segmented([['after', 'After selected page'], ['start', 'At the start'], ['end', 'At the end']], 'after', undefined, 'Insert position')
      const hint = h('small', { class: 'field-hint' })
      const insertAt = () => {
        if (where.value === 'start') return 0
        if (where.value === 'end') return grid.items.length
        const sel = grid.selected()[0]
        return sel ? grid.items.indexOf(sel) + 1 : grid.items.length
      }
      const mark = (it) => Object.assign(it, { sub: 'new', tint: 'var(--accent-2)' })
      const put = (list) => {
        const at = insertAt()
        grid.insert(list.map(mark), at)
        grid.select(list.slice(-1))
        hint.textContent = `Added ${plural(list.length, 'page')} at position ${at + 1}. Drag them to move them.`
      }

      // --- blank pages ---
      const blankCount = number(1, { min: 1, max: 100, step: 1, ariaLabel: 'Number of blank pages' })
      const blankSize = select([['same', 'Same as the page before'], ['a4', 'A4'], ['letter', 'Letter'], ['legal', 'Legal'], ['a3', 'A3'], ['a5', 'A5']], 'same')
      const addBlank = button('Insert blank pages', { icon: 'file-plus', variant: 'primary', onClick: () => busy(addBlank, async () => {
        const at = insertAt()
        let dim = sizeOf(blankSize.value)
        if (blankSize.value === 'same') {
          const prev = grid.items.slice(0, at).reverse().find((x) => x.pdf) || grid.items.find((x) => x.pdf)
          const s = prev ? await pageSize(prev.pdf, prev.page) : { width: PAGE_SIZES.A4[0], height: PAGE_SIZES.A4[1] }
          dim = [s.width, s.height]
        }
        const n = Math.max(1, Math.min(100, Math.floor(blankCount.valueAsNumber) || 1))
        put(Array.from({ length: n }, () => newItem({ kind: 'blank', dim, caption: 'Blank', draw: () => thumbOf(dim[0], dim[1], (ctx) => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 9999, 9999) }) })))
      }, 'Adding') })

      // --- images ---
      const imgSize = select([['a4', 'Fit on A4'], ['letter', 'Fit on Letter'], ['image', 'Page the size of the image']], 'a4')
      const imgMargin = select([['0', 'No margin'], ['10', 'Small margin'], ['20', 'Big margin']], '10')
      const imgZone = dropzone({ accept: 'image/*,.heic,.heif', multiple: true, compact: true, paste: false, label: 'Add images (JPG, PNG, WebP, HEIC...)', onFiles: async (files) => {
        imgZone.style.opacity = '.5'
        try {
          const list = []
          for (const f of files) {
            const img = await loadImage(f)
            const lay = imageLayout(img.naturalWidth, img.naturalHeight, { size: imgSize.value, margin: +imgMargin.value })
            const flat = toCanvas(img, Math.min(img.naturalWidth, 2600), Math.round(img.naturalHeight * Math.min(1, 2600 / img.naturalWidth)), { background: '#ffffff' })
            list.push(newItem({ kind: 'image', flat, lay, caption: f.name.replace(/\.[^.]+$/, '').slice(0, 14),
              draw: () => thumbOf(lay.pageW, lay.pageH, (ctx, k) => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 9999, 9999); ctx.drawImage(flat, lay.x * k, (lay.pageH - lay.y - lay.h) * k, lay.w * k, lay.h * k) }) }))
          }
          put(list)
        } catch (e) { toast(errorMessage(e), 'error') } finally { imgZone.style.opacity = '' }
      } })

      // --- pages from another PDF ---
      const otherBox = h('div', { class: 'stack' })
      const otherZone = dropzone({ accept: '.pdf,application/pdf', compact: true, paste: false, label: 'Choose a PDF to take pages from', onFiles: ([f]) => openOther(f) })
      async function openOther(f, password) {
        try {
          const bytes = new Uint8Array(await f.arrayBuffer())
          const pdf = await openPdf(bytes, { password })
          const rec = { file: f, bytes, password, pdf, doc: null }
          others.push(rec)
          src.dispose(() => destroyPdf(pdf))
          const range = input({ placeholder: `all ${pdf.numPages} pages, or e.g. 1-3, 5`, 'aria-label': 'Pages to insert' })
          const err = h('div')
          clear(otherBox, h('div', { class: 'row' }, icon('file-text'), h('strong', f.name), h('span', { class: 'muted small' }, plural(pdf.numPages, 'page'))), field('Pages to insert', range),
            err, button('Insert these pages', { icon: 'file-input', variant: 'primary', onClick: () => {
              try {
                const pages = range.value.trim() ? parseRanges(range.value, pdf.numPages) : Array.from({ length: pdf.numPages }, (_, i) => i + 1)
                clear(err)
                put(pages.map((p) => newItem({ kind: 'pdf', pdf, page: p, rec, sub: 'new' })))
              } catch (e) { clear(err, alert('error', e.message)) }
            } }), otherZone)
        } catch (e) {
          if (e.code === 'PASSWORD') {
            const pw = input({ type: 'password', placeholder: 'Password for that PDF', 'aria-label': 'Password' })
            clear(otherBox, alert('warn', f.name, ' is password-protected.'), h('div', { class: 'pe-pwd' }, pw, button('Unlock', { variant: 'primary', onClick: () => openOther(f, pw.value) })))
          } else clear(otherBox, alert('error', e.message), otherZone)
        }
      }
      otherBox.append(otherZone)

      const panel = h('section', { class: 'panel stack' }, h('h2', 'Add pages'),
        tabs([
          { id: 'blank', label: 'Blank', render: () => h('div', { class: 'stack' }, h('div', { class: 'grid-2' }, field('How many', blankCount), field('Page size', blankSize)), addBlank) },
          { id: 'image', label: 'Images', render: () => h('div', { class: 'stack' }, h('div', { class: 'grid-2' }, field('Size', imgSize), field('Margin', imgMargin)), imgZone, h('small', { class: 'field-hint' }, 'Photos are turned upright using their EXIF orientation.')) },
          { id: 'pdf', label: 'From a PDF', render: () => otherBox },
        ]),
        field('Where', where, 'Click a page in the grid to choose "after selected page".'), hint)
      const btn = button('Save PDF', { icon: 'file-plus', variant: 'primary', onClick: () => run() })
      const bar = dock({ actions: [btn] })

      const added = () => grid.items.filter((x) => x.kind && !x.removed)
      function update() {
        const live = grid.items.filter((x) => !x.removed).length
        const changed = added().length || grid.items.some((x, i) => x.removed || x.page !== i + 1 || itemRotation(x))
        btn.disabled = !changed || !live
        bar.text(changed ? h('span', h('b', live), ' pages in the new file, ', h('b', added().length), ' added.') : 'Add pages with the panel, then drag them where you want.')
      }

      async function run() {
        await busy(btn, async () => {
          const { PDFDocument, degrees } = await pdfLib()
          const live = grid.items.filter((x) => !x.removed)
          if (!live.length) throw new Error('The new file would have no pages.')
          const base = await src.edit()
          const out = await PDFDocument.create()
          // copy every borrowed page in one batch per source so shared fonts and images are copied once
          const copy = async (doc, items) => { const pgs = items.length ? await out.copyPages(doc, items.map((x) => x.page - 1)) : []; items.forEach((x, i) => { x._pg = pgs[i] }) }
          await copy(base, live.filter((x) => !x.kind))
          for (const rec of others) { rec.doc ??= await loadPdfLib(rec.bytes, { password: rec.password }); await copy(rec.doc, live.filter((x) => x.rec === rec)) }
          for (let i = 0; i < live.length; i++) {
            const it = live[i]
            prog.set(i / live.length, `Page ${i + 1} of ${live.length}`)
            let pg = it._pg
            if (it.kind === 'blank') pg = out.addPage(it.dim)
            else if (it.kind === 'image') {
              const emb = await out.embedJpg(await (await toBlob(it.flat, 'image/jpeg', 0.92)).arrayBuffer())
              pg = out.addPage([it.lay.pageW, it.lay.pageH])
              pg.drawImage(emb, { x: it.lay.x, y: it.lay.y, width: it.lay.w, height: it.lay.h })
            } else out.addPage(pg)
            const r = itemRotation(it)
            if (r) pg.setRotation(degrees((pg.getRotation().angle + r) % 360))
            await new Promise((r2) => setTimeout(r2, 0))
          }
          copyInfo(base, out)
          const blob = await savePdf(out)
          await showResult(result, {
            blob, name: outName(src.file, 'edited'), title: 'Pages added', lead: `${src.name} now has ${plural(live.length, 'page')}.`,
            facts: [{ label: 'Pages', value: live.length }, { label: 'Added', value: added().length }, { label: 'File size', value: formatBytes(blob.size) }], again: ws.reset,
          })
        }, { label: 'Saving', errorTo: result, progress: prog })
      }

      update()
      return [h('div', { class: 'tool-split wide-left' }, grid.el, panel), prog.el, result, bar]
    },
  })
}
