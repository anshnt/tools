// Live PDF preview: renders a PDF blob into stacked "paper" canvases with pdf.js. What you see is the file you download.
import { h, onCleanup, debounce } from '../../lib/ui.js'
import { openPdf, renderPage } from '../../lib/pdf.js'
import { closePdf } from './_extract.js'

/**
 * const view = pdfPreview({ maxWidth: 720 })
 * root.append(view.el); view.show(blob) re-renders (stale renders are dropped); view.refresh() re-renders for a new width.
 */
export function pdfPreview({ maxWidth = 760, empty = '' } = {}) {
  const pages = h('div')
  const note = h('div', { class: 'cr-pages' })
  const el = h('div', { class: 'cr-stage', 'aria-label': 'Live preview' }, pages, note)
  let token = 0, last = null, doc = null, shownWidth = 0
  const dispose = () => { closePdf(doc); doc = null }
  async function show(blob) {
    last = blob
    const my = ++token
    if (!blob) { pages.replaceChildren(empty ? h('div', { class: 'empty' }, empty) : ''); note.textContent = ''; return }
    const next = await openPdf(blob)
    if (my !== token) { closePdf(next); return }
    const avail = Math.min(maxWidth, pages.clientWidth || Math.max(0, el.clientWidth - 32) || 600)
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const sheets = []
    for (let p = 1; p <= next.numPages; p++) {
      const page = await next.getPage(p)
      const vp = page.getViewport({ scale: 1 })
      const canvas = await renderPage(next, p, { scale: (avail * dpr) / vp.width })
      if (my !== token) { closePdf(next); return }
      sheets.push(h('div', { class: 'cr-paper', style: { maxWidth: `${maxWidth}px` } }, canvas))
    }
    dispose()
    doc = next
    shownWidth = avail
    pages.replaceChildren(...sheets)
    note.textContent = next.numPages > 1 ? `${next.numPages} pages` : '1 page'
  }
  // re-render when the available width really changes (window resize, switching the mobile tab), never on height changes
  const rerender = debounce(() => { if (last && Math.abs(Math.min(maxWidth, pages.clientWidth || 0) - shownWidth) > 24) show(last) }, 200)
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (el.clientWidth > 0) rerender() }) : null
  ro?.observe(el)
  onCleanup(() => { ro?.disconnect(); token++; dispose() })
  return { el, show, get blob() { return last } }
}
