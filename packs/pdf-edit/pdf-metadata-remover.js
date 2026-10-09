// PDF metadata remover: see everything a PDF says about its author and software, edit it, or wipe it.
import { h, icon, busy, progress, input, textarea, field, button, toggle, alert, formatBytes } from '../../lib/ui.js'
import { savePdf, loadPdfLib } from '../../lib/pdf.js'
import { pdfLib } from '../../lib/libs.js'
import { pdfWorkspace, showResult, outName, css, heading, plural } from './_shared.js'

const CSS = `
.pe-meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.pe-hidden { display: grid; gap: 8px; }
.pe-hid { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface); }
.pe-hid.has { border-color: color-mix(in srgb, var(--warning) 40%, var(--border)); background: color-mix(in srgb, var(--warning) 6%, var(--surface)); }
.pe-hid b { font-size: 13.5px; display: block; }
.pe-hid small { color: var(--muted); font-size: 12px; }
.pe-custom { display: grid; gap: 6px; }
.pe-custom .pe-crow { display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 12px; border-radius: 12px; border: 1px solid var(--border); font-size: 13px; }
.pe-custom .pe-crow code { font-weight: 600; }
.pe-custom .pe-crow span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
.pe-xmp { max-height: 220px; font-size: 12px; }
@media (max-width: 560px) { .pe-meta-grid { grid-template-columns: minmax(0, 1fr); } }
`
const TEXT_KEYS = [['Title', 'Title'], ['Author', 'Author'], ['Subject', 'Subject'], ['Keywords', 'Keywords'], ['Creator', 'Created with'], ['Producer', 'PDF software']]
const DATE_KEYS = [['CreationDate', 'Created'], ['ModDate', 'Last modified']]
const STANDARD = new Set([...TEXT_KEYS, ...DATE_KEYS].map(([k]) => k))

const toLocalInput = (d) => (d instanceof Date && !Number.isNaN(+d) ? new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')

/** Everything the file says about itself: {info: {Key: string}, dates, custom: [[key, value]], xmp, counts}. */
export async function scan(doc) {
  const lib = await pdfLib()
  const { PDFDict, PDFName, PDFString, PDFHexString, PDFNumber, PDFStream, PDFArray } = lib
  const ctx = doc.context
  const infoDict = ctx.trailerInfo.Info ? ctx.lookupMaybe(ctx.trailerInfo.Info, PDFDict) : undefined
  const text = (o) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : o instanceof PDFName ? o.decodeText() : o instanceof PDFNumber ? String(o.asNumber()) : o ? String(o) : '')
  const info = {}, custom = []
  if (infoDict) for (const [k, v] of infoDict.entries()) { const key = k.decodeText(); const val = text(ctx.lookup(v)); if (STANDARD.has(key)) info[key] = val; else custom.push([key, val]) }
  let xmp = null, xmpRef = null
  const mRef = doc.catalog.get(PDFName.of('Metadata'))
  const mStream = mRef && ctx.lookupMaybe(mRef, PDFStream)
  if (mStream) {
    xmpRef = mRef
    try { xmp = new TextDecoder().decode(lib.decodePDFRawStream(mStream).decode()) } catch { xmp = '(could not decode)' }
  }
  const counts = { xmp: xmp ? 1 : 0, imageMeta: 0, pieceInfo: doc.catalog.has(PDFName.of('PieceInfo')) ? 1 : 0, annotAuthors: 0, otherMeta: 0 }
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null
    if (!dict) continue
    if (ref !== xmpRef && dict.has(PDFName.of('Metadata')) && ref !== ctx.trailerInfo.Root) { const sub = dict.get(PDFName.of('Subtype'))?.toString(); if (sub === '/Image') counts.imageMeta++; else counts.otherMeta++ }
    if (dict.has(PDFName.of('PieceInfo')) && ref !== ctx.trailerInfo.Root) counts.pieceInfo++
    if (dict.get(PDFName.of('Type'))?.toString() === '/Annot' || (dict.has(PDFName.of('Subtype')) && dict.has(PDFName.of('Rect')))) { if (dict.has(PDFName.of('T'))) counts.annotAuthors++ }
  }
  return { info, custom, xmp, counts, creation: doc.getCreationDate(), modified: doc.getModificationDate(), hasInfo: !!infoDict, ID: ctx.trailerInfo.ID ? 1 : 0 }
}

/**
 * Remove metadata in place. opts: {info, xmp, pieceInfo, imageMeta, annotAuthors}. Referenced objects are deleted from the file, not just unlinked.
 */
export async function wipe(doc, opts) {
  const { PDFDict, PDFName, PDFStream } = await pdfLib()
  const ctx = doc.context
  const kill = (ref) => { if (ref && ref.objectNumber !== undefined) ctx.delete(ref) }
  if (opts.info && ctx.trailerInfo.Info) { kill(ctx.trailerInfo.Info); ctx.trailerInfo.Info = undefined }
  for (const [ref, obj] of [...ctx.enumerateIndirectObjects()]) {
    const isRoot = ref === ctx.trailerInfo.Root
    const dict = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null
    if (!dict) continue
    const sub = dict.get(PDFName.of('Subtype'))?.toString()
    const wantMeta = isRoot ? opts.xmp : sub === '/Image' ? opts.imageMeta : opts.xmp
    if (wantMeta && dict.has(PDFName.of('Metadata'))) { kill(dict.get(PDFName.of('Metadata'))); dict.delete(PDFName.of('Metadata')) }
    if (opts.pieceInfo && dict.has(PDFName.of('PieceInfo'))) { kill(dict.get(PDFName.of('PieceInfo'))); dict.delete(PDFName.of('PieceInfo')) }
    if (opts.annotAuthors && (dict.get(PDFName.of('Type'))?.toString() === '/Annot' || (dict.has(PDFName.of('Subtype')) && dict.has(PDFName.of('Rect'))))) {
      for (const k of ['T', 'M', 'CreationDate']) dict.delete(PDFName.of(k))
    }
  }
}

export function mount(root) {
  css('pe-meta', CSS)
  pdfWorkspace(root, {
    label: 'Drop a PDF to inspect or clean',
    icon: 'file-minus',
    async onLoad(src, ws) {
      const result = h('div'), prog = progress()
      const doc0 = await src.edit()
      const found = await scan(doc0)
      const fields = {}
      for (const [k, label] of TEXT_KEYS) fields[k] = input({ value: found.info[k] || '', 'aria-label': label, placeholder: '(empty)' })
      fields.CreationDate = input({ type: 'datetime-local', value: toLocalInput(found.creation), 'aria-label': 'Created' })
      fields.ModDate = input({ type: 'datetime-local', value: toLocalInput(found.modified), 'aria-label': 'Last modified' })
      const keepCustom = new Set(found.custom.map(([k]) => k))
      const opt = { xmp: toggle('Remove XMP metadata', true), imageMeta: toggle('Remove metadata inside images and objects', true), pieceInfo: toggle('Remove hidden app data', true), annotAuthors: toggle('Remove comment authors and dates', true) }
      const c = found.counts
      const row = (key, title, desc, n) => h('div', { class: ['pe-hid', n && 'has'] }, h('div', h('b', title), h('small', n ? desc : 'None found')), opt[key])
      const totalFields = Object.values(found.info).filter(Boolean).length + found.custom.length

      const customBox = found.custom.length ? h('div', { class: 'stack tight' }, h('div', { class: 'pe-sub-h' }, 'Custom fields'),
        h('div', { class: 'pe-custom' }, found.custom.map(([k, v]) => h('div', { class: 'pe-crow' }, h('code', k), h('span', { title: v }, v || '(empty)'),
          button('', { icon: 'trash-2', variant: 'ghost', size: 'sm', ariaLabel: `Remove ${k}`, onClick: (e) => { keepCustom.delete(k); e.currentTarget.closest('.pe-crow').remove() } }))))) : null

      const save = button('Save with my edits', { icon: 'save', variant: 'primary', size: 'lg', onClick: () => run(false) })
      const wipeBtn = button('Wipe all metadata', { icon: 'eraser', variant: 'danger', size: 'lg', onClick: () => { for (const k of Object.keys(fields)) fields[k].value = ''; for (const t of Object.values(opt)) t.input.checked = true; keepCustom.clear(); run(true) } })

      async function run(all) {
        await busy(all ? wipeBtn : save, async () => {
          prog.set(null, all ? 'Wiping metadata' : 'Saving')
          const doc = await src.edit()
          const lib = await pdfLib()
          const { PDFName, PDFHexString, PDFString } = lib
          const before = await scan(doc)
          if (all) await wipe(doc, { info: true, xmp: true, pieceInfo: true, imageMeta: true, annotAuthors: true })
          else {
            const ctx = doc.context
            const editedAny = TEXT_KEYS.some(([k]) => (fields[k].value || '') !== (found.info[k] || '')) || keepCustom.size !== found.custom.length || fields.CreationDate.value !== toLocalInput(found.creation) || fields.ModDate.value !== toLocalInput(found.modified)
            const infoDict = doc.getInfoDict()
            for (const [k] of TEXT_KEYS) { const v = fields[k].value.trim(); if (v) infoDict.set(PDFName.of(k), PDFHexString.fromText(v)); else infoDict.delete(PDFName.of(k)) }
            for (const [k] of DATE_KEYS) { const v = fields[k].value; if (v && !Number.isNaN(+new Date(v))) infoDict.set(PDFName.of(k), PDFString.fromDate(new Date(v))); else infoDict.delete(PDFName.of(k)) }
            for (const [k] of found.custom) if (!keepCustom.has(k)) infoDict.delete(PDFName.of(k))
            const w = { info: false, xmp: opt.xmp.input.checked, pieceInfo: opt.pieceInfo.input.checked, imageMeta: opt.imageMeta.input.checked, annotAuthors: opt.annotAuthors.input.checked }
            if (w.xmp || w.pieceInfo || w.imageMeta || w.annotAuthors) await wipe(doc, w)
            if (!editedAny && !(w.xmp || w.pieceInfo || w.imageMeta || w.annotAuthors)) throw new Error('Nothing changed yet. Edit a field, remove something, or use Wipe all metadata.')
            void ctx
          }
          const blob = await savePdf(doc)
          const after = await scan(await loadPdfLib(blob, { updateMetadata: false }))
          const left = Object.values(after.info).filter(Boolean).length + after.custom.length
          await showResult(result, {
            blob, name: outName(src.file, all ? 'clean' : 'edited'), title: all ? 'Metadata wiped' : 'Metadata updated',
            lead: all ? 'The title, author, dates, software, XMP and hidden app data are gone from the saved file.' : 'Your changes are saved in the new file.',
            facts: [{ label: 'Info fields', value: `${totalFields} → ${left}`, tone: left < totalFields ? 'good' : undefined }, { label: 'XMP block', value: after.xmp ? 'Kept' : 'None', tone: after.xmp ? undefined : 'good' }, { label: 'File size', value: formatBytes(blob.size) }],
            note: before.counts.annotAuthors && !all ? undefined : 'The page content itself is not touched, so names written inside the text or images stay.', again: ws.reset,
          })
        }, { label: all ? 'Wiping' : 'Saving', errorTo: result, progress: prog })
      }

      const left = h('section', { class: 'panel stack' }, heading('file-text', 'Document details'),
        h('div', { class: 'pe-meta-grid' }, TEXT_KEYS.map(([k, label]) => field(label, fields[k]))),
        h('div', { class: 'pe-meta-grid' }, DATE_KEYS.map(([k, label]) => field(label, fields[k]))), customBox,
        h('small', { class: 'field-hint' }, totalFields ? `${plural(totalFields, 'field')} found in the file's info block.` : 'This file has no info block.'))
      const right = h('section', { class: 'panel stack' }, heading('eye-off', 'Hidden data'),
        h('div', { class: 'pe-hidden' },
          row('xmp', 'XMP metadata', 'An XML copy of title, author, dates and the software used.', c.xmp),
          row('imageMeta', 'Image and object metadata', `${plural(c.imageMeta + c.otherMeta, 'object')} carry their own metadata (camera and editing details).`, c.imageMeta + c.otherMeta),
          row('pieceInfo', 'Hidden app data', 'Private data left behind by design tools.', c.pieceInfo),
          row('annotAuthors', 'Comment authors', `${plural(c.annotAuthors, 'comment')} name their author.`, c.annotAuthors)),
        found.xmp ? h('details', h('summary', { class: 'small muted', style: 'cursor:pointer' }, 'Show the XMP block'), h('pre', { class: 'code-out pe-xmp' }, found.xmp.slice(0, 6000))) : null)
      return [h('div', { class: 'tool-split' }, left, right), h('div', { class: 'row' }, save, wipeBtn, h('span', { class: 'small muted' }, 'Runs on your device. Your original is not changed.')), prog.el, result]
    },
  })
}
