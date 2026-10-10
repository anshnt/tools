// Writes the edited document with pdf-lib: page organization, form values, and every annotation as a real PDF annotation
// with an appearance stream (or flattened into the page when asked). Redaction rebuilds the affected pages as images so the
// covered text and graphics are really gone, and a sweep removes everything no longer reachable (deleted pages, old pages).
import { pdfLib } from '../../lib/libs.js'
import { loadPdfLib, openPdf } from '../../lib/pdf.js'
import { toBlob, MAX_PIXELS } from '../../lib/image.js'
import { yieldToMain } from '../../lib/ui.js'
import { invert, apply, bbox, hexToRgb, smoothSegs, rectPts, grow } from './_geom.js'
import { layoutText, arrowHead, noteShape, bounds, fontString, NOTE_SIZE } from './_annots.js'

const f = (n) => (Math.round(n * 1000) / 1000).toString()
const rgb = (hex, stroke) => `${hexToRgb(hex).map(f).join(' ')} ${stroke ? 'RG' : 'rg'}`
const STD = {
  helv: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
  times: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'],
  cour: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'],
}
const KAPPA = 0.5522847498
// The standard PDF fonts only cover WinAnsi; anything else is drawn as a picture of the text box instead of becoming "?".
const WIN_EXTRA = new Set([0x20ac, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x17d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x17e, 0x178])
const winAnsi = (text) => [...text].every((ch) => { const c = ch.codePointAt(0); return (c >= 32 && c < 127) || (c >= 160 && c <= 255) || WIN_EXTRA.has(c) })

/** What the save dialog needs to know before writing. */
export function summarize(store) {
  const st = store.state
  const redactions = st.annots.filter((a) => a.type === 'redact')
  const redactedPages = new Set(redactions.map((a) => a.pid))
  return {
    annots: st.annots.filter((a) => a.type !== 'redact').length,
    redactions: redactions.length,
    redactedPages: redactedPages.size,
    fields: Object.keys(st.fields).length,
    pages: st.pages.length,
  }
}

/** Collects one appearance stream: operators, graphics states, fonts and images. */
class Ap {
  constructor() { this.ops = []; this.gs = new Map(); this.fonts = new Map(); this.imgs = new Map() }
  op(s) { this.ops.push(s) }
  alpha(opacity, blend) {
    if ((opacity ?? 1) >= 1 && !blend) return null
    const key = `${opacity}|${blend || ''}`
    if (!this.gs.has(key)) this.gs.set(key, { name: `G${this.gs.size + 1}`, dict: { Type: 'ExtGState', CA: opacity ?? 1, ca: opacity ?? 1, ...(blend ? { BM: blend } : {}) } })
    return this.gs.get(key).name
  }
  font(ref) { if (!this.fonts.has(ref)) this.fonts.set(ref, `F${this.fonts.size + 1}`); return this.fonts.get(ref) }
  image(ref) { if (!this.imgs.has(ref)) this.imgs.set(ref, `I${this.imgs.size + 1}`); return this.imgs.get(ref) }
}

export async function buildPdf(app, opts = {}) {
  const L = await pdfLib()
  const { PDFName, PDFHexString, PDFString, PDFDict, PDFArray, PDFRef, PDFStream, StandardFonts, degrees, drawObject, pushGraphicsState, popGraphicsState } = L
  const { PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList } = L
  const { store, doc: src } = app
  const st = store.state
  const notes = []
  const progress = (fr, t) => opts.onProgress?.(fr, t)

  progress(0.02, 'Reading the document')
  const pdf = await loadPdfLib(src.bytes, { password: src.password })
  const ctx = pdf.context

  // ---------- form values ----------
  const redactPids = new Set(st.annots.filter((a) => a.type === 'redact').map((a) => a.pid))
  const fieldNames = Object.keys(st.fields)
  let form = null
  if (src.fieldCount || fieldNames.length) { try { form = pdf.getForm() } catch (e) { notes.push('Form fields could not be read.') } }
  if (form) {
    for (const name of fieldNames) {
      const fld = form.getFieldMaybe(name)
      const v = st.fields[name]
      if (!fld) continue
      try {
        if (fld instanceof PDFTextField) fld.setText(v === '' || v == null ? undefined : String(v))
        else if (fld instanceof PDFCheckBox) v ? fld.check() : fld.uncheck()
        else if (fld instanceof PDFRadioGroup) v && v !== 'Off' ? fld.select(v) : fld.clear()
        else if (fld instanceof PDFDropdown) v ? fld.select(v) : fld.clear()
        else if (fld instanceof PDFOptionList) { fld.clear(); if (v?.length) fld.select(v) }
      } catch (e) { notes.push(`Field "${name}" was not filled: ${e.message}`) }
    }
    if (opts.flattenForms || redactPids.size) {
      try { form.flatten() } catch (e) { notes.push(`Form fields could not be flattened: ${e.message}`) }
    }
  }

  // ---------- redaction: rebuild affected pages as images ----------
  const rasters = new Map()
  if (redactPids.size) {
    progress(0.08, 'Redacting')
    const tmp = await pdf.save({ useObjectStreams: false })
    const pj = await openPdf(tmp)
    const dpi = opts.redactDpi || 200
    let k = 0
    for (const p of st.pages) {
      if (!redactPids.has(p.id)) continue
      let scale = dpi / 72
      if (p.w * scale * p.h * scale > MAX_PIXELS * 0.6) scale = Math.sqrt((MAX_PIXELS * 0.6) / (p.w * p.h))
      const canvas = Object.assign(document.createElement('canvas'), { width: Math.ceil(p.w * scale), height: Math.ceil(p.h * scale) })
      const c2 = canvas.getContext('2d')
      c2.fillStyle = '#fff'; c2.fillRect(0, 0, canvas.width, canvas.height)
      if (p.src != null) {
        const page = await pj.getPage(p.src + 1)
        await page.render({ canvasContext: c2, canvas, viewport: page.getViewport({ scale }) }).promise
        page.cleanup()
      }
      c2.fillStyle = '#000'
      for (const a of st.annots) if (a.pid === p.id && a.type === 'redact') c2.fillRect(Math.floor(a.x * scale), Math.floor(a.y * scale), Math.ceil(a.w * scale) + 1, Math.ceil(a.h * scale) + 1)
      const blob = await toBlob(canvas, 'image/jpeg', 0.9)
      rasters.set(p.id, new Uint8Array(await blob.arrayBuffer()))
      canvas.width = canvas.height = 0
      progress(0.08 + 0.3 * (++k / redactPids.size), `Redacting page ${k} of ${redactPids.size}`)
      await yieldToMain()
    }
    pj.loadingTask?.destroy()
  }

  // ---------- page order, rotation, blanks ----------
  progress(0.4, 'Arranging pages')
  const srcPages = pdf.getPages()
  const baseRot = srcPages.map((p) => ((p.getRotation().angle % 360) + 360) % 360)
  const origCount = srcPages.length
  const outs = []
  for (const p of st.pages) {
    let page, N
    if (rasters.has(p.id)) {
      page = pdf.addPage([p.w, p.h])
      page.drawImage(await pdf.embedJpg(rasters.get(p.id)), { x: 0, y: 0, width: p.w, height: p.h })
      N = [1, 0, 0, -1, 0, p.h]
      page.setRotation(degrees(p.rot % 360))
    } else if (p.src != null) {
      page = srcPages[p.src]
      const pg = await src.page(p.src)
      N = invert(pg.getViewport({ scale: 1 }).transform)
      page.setRotation(degrees((baseRot[p.src] + p.rot) % 360))
    } else {
      page = pdf.addPage([p.w, p.h])
      N = [1, 0, 0, -1, 0, p.h]
      page.setRotation(degrees(p.rot % 360))
    }
    outs.push({ p, page, N })
  }
  // Rewrite the page tree as one flat list in the new order (robust for nested trees; dropped pages become unreachable).
  {
    const rootRef = pdf.catalog.get(PDFName.of('Pages'))
    const rootNode = pdf.catalog.Pages()
    for (const { page } of outs) {
      for (const k of ['MediaBox', 'CropBox', 'Resources', 'Rotate']) {
        const key = PDFName.of(k)
        const v = page.node.getInheritableAttribute(key)
        if (v && !page.node.has(key)) page.node.set(key, v)
      }
      page.node.set(PDFName.of('Parent'), rootRef)
    }
    rootNode.set(PDFName.of('Kids'), ctx.obj(outs.map(({ page }) => page.ref)))
    rootNode.set(PDFName.of('Count'), ctx.obj(outs.length))
  }

  // ---------- annotations ----------
  const fonts = new Map(), images = new Map()
  const getFont = async (a) => {
    const name = STD[a.font]?.[a.bold && a.italic ? 3 : a.italic ? 2 : a.bold ? 1 : 0] || 'Helvetica'
    if (!fonts.has(name)) fonts.set(name, await pdf.embedFont(StandardFonts[name]))
    return fonts.get(name)
  }
  const getImage = async (id) => {
    if (!images.has(id)) {
      const asset = app.assets.get(id)
      if (!asset) return null
      images.set(id, asset.mime === 'image/jpeg' ? await pdf.embedJpg(asset.bytes) : await pdf.embedPng(asset.bytes))
    }
    return images.get(id)
  }
  const canvasImage = async (canvas) => pdf.embedPng(new Uint8Array(await (await toBlob(canvas, 'image/png')).arrayBuffer()))

  const total = st.annots.filter((a) => a.type !== 'redact').length
  let done = 0, written = 0, flattened = 0
  for (const { p, page, N } of outs) {
    const list = st.annots.filter((a) => a.pid === p.id && a.type !== 'redact')
    for (const a of list) {
      try {
        const res = await buildAnnotation(a, N, { pdf, ctx, L, getFont, getImage, canvasImage })
        if (!res) continue
        const ap = res.ap
        const resources = {}
        if (ap.gs.size) resources.ExtGState = Object.fromEntries([...ap.gs.values()].map((g) => [g.name, g.dict]))
        if (ap.fonts.size) resources.Font = Object.fromEntries([...ap.fonts].map(([ref, name]) => [name, ref]))
        if (ap.imgs.size) resources.XObject = Object.fromEntries([...ap.imgs].map(([ref, name]) => [name, ref]))
        const content = `q ${N.map(f).join(' ')} cm\n${ap.ops.join('\n')}\nQ`
        const form = ctx.flateStream(content, { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: res.rect, Resources: resources })
        const formRef = ctx.register(form)
        if (opts.flatten || res.flatten) {
          const name = page.node.newXObject('PSA', formRef)
          page.pushOperators(pushGraphicsState(), drawObject(name), popGraphicsState())
          flattened++
        } else {
          const dict = {
            Type: 'Annot', Subtype: res.subtype, Rect: res.rect, F: 4, AP: { N: formRef }, NM: PDFString.of(a.id), M: PDFString.fromDate(new Date(a.date || Date.now())),
            ...(a.author ? { T: PDFHexString.fromText(a.author) } : {}), ...(a.text ? { Contents: PDFHexString.fromText(a.text) } : {}), ...res.dict,
          }
          page.node.addAnnot(ctx.register(ctx.obj(dict)))
          written++
        }
      } catch (e) {
        console.error(e)
        notes.push(`One ${a.type} on page ${store.pageIndex(p.id) + 1} could not be written: ${e.message}`)
      }
      if (++done % 8 === 0) { progress(0.4 + 0.45 * (done / Math.max(1, total)), `Writing annotations ${done} of ${total}`); await yieldToMain() }
    }
  }

  // ---------- clean up what must not survive ----------
  progress(0.88, 'Cleaning up')
  if (rasters.size || st.pages.length < origCount) {
    for (const key of ['Outlines', 'Names', 'Dests', 'StructTreeRoot', 'MarkInfo', 'OpenAction', 'Threads', 'AA']) pdf.catalog.delete(PDFName.of(key))
    if (rasters.size) pdf.catalog.delete(PDFName.of('AcroForm'))
    for (const { page } of outs) {
      const arr = page.node.Annots()
      if (!arr) continue
      for (let i = arr.size() - 1; i >= 0; i--) {
        const d = ctx.lookupMaybe(arr.get(i), PDFDict)
        if (d && d.get(PDFName.of('Subtype'))?.toString() === '/Link') arr.remove(i)
      }
    }
    notes.push('Bookmarks and internal links were removed because pages were deleted or redacted.')
  }
  sweep(ctx, { PDFRef, PDFDict, PDFArray, PDFStream })
  pdf.setProducer('PDF Studio')
  pdf.setModificationDate(new Date())

  progress(0.94, 'Saving')
  const bytes = await pdf.save({ useObjectStreams: true })
  progress(1, 'Done')
  return { blob: new Blob([bytes], { type: 'application/pdf' }), notes, stats: { pages: st.pages.length, annotations: written, flattened, redactedPages: rasters.size } }
}

/** Delete every indirect object that is no longer reachable from the trailer (deleted pages, replaced pages, old streams). */
function sweep(ctx, { PDFRef, PDFDict, PDFArray, PDFStream }) {
  const seen = new Set()
  const stack = Object.values(ctx.trailerInfo || {}).filter(Boolean)
  while (stack.length) {
    const o = stack.pop()
    if (o instanceof PDFRef) {
      if (seen.has(o.tag)) continue
      seen.add(o.tag)
      const t = ctx.lookup(o)
      if (t) stack.push(t)
    } else if (o instanceof PDFDict) stack.push(...o.values())
    else if (o instanceof PDFArray) stack.push(...o.asArray())
    else if (o instanceof PDFStream) stack.push(o.dict)
  }
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.tag)) ctx.delete(ref)
}

const userRect = (N, pts, pad = 0) => {
  const b = grow(bbox(pts.map(([x, y]) => apply(N, x, y))), pad)
  return [b.x, b.y, b.x + Math.max(b.w, 1), b.y + Math.max(b.h, 1)]
}
const quad = (N, r) => [[r[0], r[1]], [r[0] + r[2], r[1]], [r[0], r[1] + r[3]], [r[0] + r[2], r[1] + r[3]]].flatMap(([x, y]) => apply(N, x, y))

/** Returns {ap, rect, subtype, dict, flatten?} for one annotation, with content authored in base space. */
async function buildAnnotation(a, N, { L, getFont, getImage, canvasImage }) {
  const ap = new Ap()
  const c = a.color, op = a.opacity ?? 1
  const gs = (o, blend) => { const n = ap.alpha(o, blend); if (n) ap.op(`/${n} gs`) }
  switch (a.type) {
    case 'highlight': {
      gs(op, 'Multiply')
      ap.op(rgb(c, false))
      for (const [x, y, w, h] of a.rects) ap.op(`${f(x)} ${f(y)} ${f(w)} ${f(h)} re f`)
      return { ap, subtype: 'Highlight', rect: userRect(N, a.rects.flatMap((r) => rectPts({ x: r[0], y: r[1], w: r[2], h: r[3] }))), dict: { C: hexToRgb(c), CA: op, QuadPoints: a.rects.flatMap((r) => quad(N, r)) } }
    }
    case 'underline': case 'strike': {
      gs(op)
      ap.op(rgb(c, true))
      for (const [x, y, w, h] of a.rects) {
        const yy = a.type === 'underline' ? y + h - 1.2 : y + h * 0.52
        ap.op(`${f(Math.max(1, h * 0.075))} w ${f(x)} ${f(yy)} m ${f(x + w)} ${f(yy)} l S`)
      }
      return { ap, subtype: a.type === 'underline' ? 'Underline' : 'StrikeOut', rect: userRect(N, a.rects.flatMap((r) => rectPts({ x: r[0], y: r[1], w: r[2], h: r[3] }))), dict: { C: hexToRgb(c), CA: op, QuadPoints: a.rects.flatMap((r) => quad(N, r)) } }
    }
    case 'ink': {
      gs(op)
      ap.op(`${rgb(c, true)} ${f(a.width)} w 1 J 1 j`)
      for (const path of a.paths) {
        for (const [t, ...v] of smoothSegs(path)) ap.op(t === 'M' ? `${f(v[0])} ${f(v[1])} m` : t === 'L' ? `${f(v[0])} ${f(v[1])} l` : `${v.map(f).join(' ')} c`)
        ap.op('S')
      }
      return { ap, subtype: 'Ink', rect: userRect(N, a.paths.flat(), a.width), dict: { C: hexToRgb(c), CA: op, BS: { W: a.width }, InkList: a.paths.map((p) => p.flatMap(([x, y]) => apply(N, x, y))) } }
    }
    case 'rect': case 'ellipse': {
      gs(op)
      if (a.fill) ap.op(rgb(a.fill, false))
      ap.op(`${rgb(a.stroke, true)} ${f(a.width)} w`)
      if (a.type === 'rect') ap.op(`${f(a.x)} ${f(a.y)} ${f(a.w)} ${f(a.h)} re`)
      else {
        const cx = a.x + a.w / 2, cy = a.y + a.h / 2, rx = a.w / 2, ry = a.h / 2, k = KAPPA
        ap.op(`${f(cx + rx)} ${f(cy)} m ${f(cx + rx)} ${f(cy + k * ry)} ${f(cx + k * rx)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} c ${f(cx - k * rx)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + k * ry)} ${f(cx - rx)} ${f(cy)} c ${f(cx - rx)} ${f(cy - k * ry)} ${f(cx - k * rx)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} c ${f(cx + k * rx)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - k * ry)} ${f(cx + rx)} ${f(cy)} c h`)
      }
      ap.op(a.fill ? 'B' : 'S')
      return { ap, subtype: a.type === 'rect' ? 'Square' : 'Circle', rect: userRect(N, rectPts(a), a.width / 2), dict: { C: hexToRgb(a.stroke), CA: op, BS: { W: a.width }, ...(a.fill ? { IC: hexToRgb(a.fill) } : {}) } }
    }
    case 'line': case 'arrow': {
      gs(op)
      ap.op(`${rgb(a.stroke, true)} ${f(a.width)} w 1 J ${f(a.x1)} ${f(a.y1)} m ${f(a.x2)} ${f(a.y2)} l S`)
      const pts = [[a.x1, a.y1], [a.x2, a.y2]]
      if (a.type === 'arrow') {
        const hd = arrowHead(a)
        ap.op(`${rgb(a.stroke, false)} 1 j ${hd.map(([x, y], i) => `${f(x)} ${f(y)} ${i ? 'l' : 'm'}`).join(' ')} h f`)
        pts.push(...hd)
      }
      return { ap, subtype: 'Line', rect: userRect(N, pts, a.width / 2), dict: { C: hexToRgb(a.stroke), CA: op, BS: { W: a.width }, L: [...apply(N, a.x1, a.y1), ...apply(N, a.x2, a.y2)], LE: ['None', a.type === 'arrow' ? 'ClosedArrow' : 'None'] } }
    }
    case 'note': {
      ap.op(`${rgb(a.color, false)} 0.35 0.35 0.35 RG 0.8 w ${noteShape(a.x, a.y).map(([x, y], i) => `${f(x)} ${f(y)} ${i ? 'l' : 'm'}`).join(' ')} h B`)
      ap.op('0.3 0.3 0.3 RG 1.2 w')
      for (const o of [5, 9, 13]) ap.op(`${f(a.x + 4)} ${f(a.y + o - 0.5)} m ${f(a.x + 18)} ${f(a.y + o - 0.5)} l S`)
      return { ap, subtype: 'Text', rect: userRect(N, rectPts({ x: a.x, y: a.y, w: NOTE_SIZE, h: NOTE_SIZE })), dict: { C: hexToRgb(a.color), Name: 'Comment', Open: false } }
    }
    case 'whiteout': {
      ap.op(`1 1 1 rg ${f(a.x)} ${f(a.y)} ${f(a.w)} ${f(a.h)} re f`)
      return { ap, subtype: 'Square', rect: userRect(N, rectPts(a)), dict: {}, flatten: true }
    }
    case 'image': {
      const img = await getImage(a.asset)
      if (!img) return null
      const name = ap.image(img.ref)
      ap.op(`q ${f(a.w)} 0 0 ${f(-a.h)} ${f(a.x)} ${f(a.y + a.h)} cm /${name} Do Q`)
      return { ap, subtype: 'Stamp', rect: userRect(N, rectPts(a)), dict: { Name: 'Stamp', Subj: L.PDFHexString.fromText(a.kind === 'signature' ? 'Signature' : a.kind === 'stamp' ? 'Stamp' : 'Image') } }
    }
    case 'text': {
      const lay = layoutText(a)
      const hh = Math.max(a.h, lay.h)
      const box = { x: a.x, y: a.y, w: a.w, h: hh }
      const font = await getFont(a)
      let encoded
      try { encoded = lay.lines.every((l) => winAnsi(l.text)) ? lay.lines.map((l) => (l.text ? font.encodeText(l.text).toString() : null)) : null } catch { encoded = null }
      if (!encoded) { // characters the standard PDF fonts cannot draw: use a picture of the text box
        const S = 3
        const cv = Object.assign(document.createElement('canvas'), { width: Math.ceil(box.w * S), height: Math.ceil(box.h * S) })
        const cx = cv.getContext('2d')
        cx.scale(S, S)
        if (a.fill) { cx.fillStyle = a.fill; cx.fillRect(0, 0, box.w, box.h) }
        if (a.border) { cx.strokeStyle = a.border; cx.strokeRect(0.5, 0.5, box.w - 1, box.h - 1) }
        cx.font = fontString(a); cx.fillStyle = a.color
        for (const l of lay.lines) cx.fillText(l.text, l.x - a.x, l.y - a.y)
        const img = await canvasImage(cv)
        ap.op(`q ${f(box.w)} 0 0 ${f(-box.h)} ${f(box.x)} ${f(box.y + box.h)} cm /${ap.image(img.ref)} Do Q`)
        return { ap, subtype: 'Stamp', rect: userRect(N, rectPts(box)), dict: { Name: 'Text' } }
      }
      if (a.fill) ap.op(`${rgb(a.fill, false)} ${f(box.x)} ${f(box.y)} ${f(box.w)} ${f(box.h)} re f`)
      if (a.border) ap.op(`${rgb(a.border, true)} 1 w ${f(box.x)} ${f(box.y)} ${f(box.w)} ${f(box.h)} re S`)
      const fn = ap.font(font.ref)
      lay.lines.forEach((l, i) => { if (encoded[i]) ap.op(`BT /${fn} ${f(a.size)} Tf ${rgb(a.color, false)} 1 0 0 -1 ${f(l.x)} ${f(l.y)} Tm ${encoded[i]} Tj ET`) })
      return { ap, subtype: 'FreeText', rect: userRect(N, rectPts(box)), dict: { DA: L.PDFString.of(`${hexToRgb(a.color).map(f).join(' ')} rg /Helv ${f(a.size)} Tf`), Q: { left: 0, center: 1, right: 2 }[a.align] ?? 0 } }
    }
  }
  return null
}
