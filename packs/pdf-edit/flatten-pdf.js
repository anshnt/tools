// Flatten PDF: bake form fields and annotations (stamps, notes, highlights, ink) into the page so they can no longer be edited.
import { h, icon, busy, progress, field, button, toggle, alert, formatBytes } from '../../lib/ui.js'
import { savePdf } from '../../lib/pdf.js'
import { pdfLib } from '../../lib/libs.js'
import { pdfWorkspace, showResult, outName, css, heading, plural } from './_shared.js'

const CSS = `
.pe-found { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr)); gap: 10px; }
.pe-found > div { padding: 14px; border-radius: 16px; border: 1px solid var(--border); background: var(--surface); animation: pe-pop .45s var(--spring) both; }
.pe-found b { display: block; font-size: 26px; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.pe-found small { color: var(--muted); }
.pe-found .zero b { color: var(--muted); }
`

/** Matrix that maps an appearance stream's transformed BBox onto the annotation Rect (PDF 32000, 12.5.5). */
export function appearanceMatrix(bbox, matrix, rect) {
  const [a, b, c, d, e, f] = matrix
  const pts = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[2], bbox[3]], [bbox[0], bbox[3]]].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f])
  const tx0 = Math.min(...pts.map((p) => p[0])), tx1 = Math.max(...pts.map((p) => p[0]))
  const ty0 = Math.min(...pts.map((p) => p[1])), ty1 = Math.max(...pts.map((p) => p[1]))
  const rx0 = Math.min(rect[0], rect[2]), rx1 = Math.max(rect[0], rect[2]), ry0 = Math.min(rect[1], rect[3]), ry1 = Math.max(rect[1], rect[3])
  const sx = tx1 - tx0 ? (rx1 - rx0) / (tx1 - tx0) : 1, sy = ty1 - ty0 ? (ry1 - ry0) / (ty1 - ty0) : 1
  return [sx, 0, 0, sy, rx0 - tx0 * sx, ry0 - ty0 * sy]
}

/** Count what is in the file: form fields and annotations by kind. */
export async function inspect(doc) {
  const { PDFName, PDFDict, PDFArray } = await pdfLib()
  let fields = 0
  try { fields = doc.getForm().getFields().length } catch { /* no form */ }
  const kinds = { links: 0, markup: 0, notes: 0, other: 0 }
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) continue
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookupMaybe(i, PDFDict)
      const sub = a?.get(PDFName.of('Subtype'))?.toString().slice(1)
      if (!sub || sub === 'Widget' || sub === 'Popup') continue
      if (sub === 'Link') kinds.links++
      else if (sub === 'Text') kinds.notes++
      else if (['Highlight', 'Underline', 'StrikeOut', 'Squiggly', 'Stamp', 'FreeText', 'Ink', 'Square', 'Circle', 'Line', 'Polygon', 'PolyLine', 'Caret', 'Watermark'].includes(sub)) kinds.markup++
      else kinds.other++
    }
  }
  return { fields, ...kinds }
}

/** Bake annotations of one document into their pages. Returns {baked, removed}. */
export async function flattenAnnotations(doc, { keepLinks = true, dropUnrenderable = false } = {}) {
  const lib = await pdfLib()
  const { PDFName, PDFDict, PDFArray, PDFStream, PDFNumber, PDFRef, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } = lib
  let baked = 0, removed = 0
  const nums = (arr, n, fallback) => (arr ? Array.from({ length: n }, (_, i) => arr.lookup(i, PDFNumber).asNumber()) : fallback)
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) continue
    const keep = []
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i)
      const a = annots.lookupMaybe(i, PDFDict)
      if (!a) continue
      const sub = a.get(PDFName.of('Subtype'))?.toString().slice(1)
      if (sub === 'Widget') { keep.push(ref); continue } // form fields are flattened separately
      if (sub === 'Link') { if (keepLinks) keep.push(ref); else removed++; continue }
      if (sub === 'Popup') { removed++; continue }
      const flags = a.lookupMaybe(PDFName.of('F'), PDFNumber)?.asNumber() ?? 0
      if (flags & (2 | 32)) { removed++; continue } // hidden or not viewable
      const ap = a.lookupMaybe(PDFName.of('AP'), PDFDict)
      let nRaw = ap?.get(PDFName.of('N')), n = ap?.lookup(PDFName.of('N'))
      if (n instanceof PDFDict) { const as = a.get(PDFName.of('AS')); nRaw = as ? n.get(as) : undefined; n = as ? n.lookup(as) : undefined }
      const rect = nums(a.lookupMaybe(PDFName.of('Rect'), PDFArray), 4)
      if (!(n instanceof PDFStream) || !rect) { if (dropUnrenderable) removed++; else keep.push(ref); continue }
      const bbox = nums(n.dict.lookupMaybe(PDFName.of('BBox'), PDFArray), 4, [0, 0, rect[2] - rect[0], rect[3] - rect[1]])
      const matrix = nums(n.dict.lookupMaybe(PDFName.of('Matrix'), PDFArray), 6, [1, 0, 0, 1, 0, 0])
      const m = appearanceMatrix(bbox, matrix, rect)
      const xref = nRaw instanceof PDFRef ? nRaw : doc.context.register(n)
      const key = page.node.newXObject('FlatAnnot', xref)
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m), drawObject(key), popGraphicsState())
      baked++
    }
    if (keep.length) page.node.set(PDFName.of('Annots'), doc.context.obj(keep))
    else page.node.delete(PDFName.of('Annots'))
  }
  return { baked, removed }
}

export function mount(root) {
  css('pe-flatten', CSS)
  pdfWorkspace(root, {
    label: 'Drop a PDF with form fields or comments',
    icon: 'layers',
    async onLoad(src, ws) {
      const result = h('div'), prog = progress()
      const found = await inspect(await src.edit())
      const cell = (n, label) => h('div', { class: n ? '' : 'zero' }, h('b', n), h('small', label))
      const forms = toggle('Flatten form fields', found.fields > 0)
      const marks = toggle('Flatten comments, stamps, highlights and drawings', found.markup + found.notes + found.other > 0)
      const links = toggle('Keep links clickable', true)
      const drop = toggle('Remove annotations that cannot be drawn (for example notes without an appearance)', false)
      const btn = button('Flatten PDF', { icon: 'layers', variant: 'primary', size: 'lg', onClick: () => run() })
      const nothing = !found.fields && !(found.markup + found.notes + found.other)

      async function run() {
        await busy(btn, async () => {
          prog.set(null, 'Flattening')
          const doc = await src.edit()
          let fieldsDone = 0, ann = { baked: 0, removed: 0 }
          if (forms.input.checked && found.fields) {
            const form = doc.getForm()
            try { form.updateFieldAppearances() } catch { /* fields keep their own appearance */ }
            fieldsDone = form.getFields().length
            form.flatten()
          }
          if (marks.input.checked) ann = await flattenAnnotations(doc, { keepLinks: links.input.checked, dropUnrenderable: drop.input.checked })
          if (!fieldsDone && !ann.baked && !ann.removed) throw new Error('Nothing to flatten with these options.')
          const blob = await savePdf(doc)
          await showResult(result, {
            blob, name: outName(src.file, 'flattened'), title: 'Flattened', lead: 'What you could click or edit is now part of the page.',
            facts: [{ label: 'Form fields', value: fieldsDone }, { label: 'Annotations baked', value: ann.baked }, { label: 'Dropped', value: ann.removed }, { label: 'File size', value: formatBytes(blob.size) }],
            note: 'Text stays selectable. Flattened content cannot be edited or un-flattened.', again: ws.reset,
          })
        }, { label: 'Flattening', errorTo: result, progress: prog })
      }

      return [
        h('section', { class: 'panel stack' }, heading('search', 'What is in this PDF'),
          h('div', { class: 'pe-found' }, cell(found.fields, 'Form fields'), cell(found.markup, 'Stamps, highlights, drawings'), cell(found.notes, 'Sticky notes'), cell(found.links, 'Links'), cell(found.other, 'Other annotations')),
          nothing ? alert('info', 'This PDF has no form fields or annotations, so there is nothing to flatten.') : null),
        h('section', { class: 'panel stack' }, heading('sliders-horizontal', 'Options'), forms, marks, links, drop),
        h('div', { class: 'row' }, btn), prog.el, result]
    },
  })
}
