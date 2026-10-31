// Presentations: PPTX -> blocks (slide titles, bullet outline, tables, speaker notes and slide pictures, ready for DOCX / text / Markdown) and
// Markdown / HTML -> PPTX (split on headings, with PptxGenJS).
import { jszip, pptxgen } from '../../lib/libs.js'
import { fail, parseXml, kid, kids, deep, attrNS, utf8, normalizeImage, sniffImage, checkAbort } from './_util.js'

const A = (el, n) => attrNS(el, n)
const FOOTER_PH = new Set(['sldNum', 'ftr', 'dt', 'hdr'])

/** Slide text and structure from a .pptx. -> {slides: [{index, title, blocks, notes, hidden}], width, height} */
export async function readPptxSlides(bytes, { onProgress, signal } = {}) {
  const JSZip = await jszip()
  let zip
  try { zip = await JSZip.loadAsync(bytes) } catch { throw fail('This file is not a valid .pptx. Old .ppt files must be saved as .pptx in PowerPoint first.') }
  const pres = zip.file('ppt/presentation.xml')
  if (!pres) throw fail('This does not look like a PowerPoint (.pptx) file.')
  const presDoc = parseXml(await pres.async('string'), 'presentation')
  const relsDoc = parseXml(await zip.file('ppt/_rels/presentation.xml.rels').async('string'), 'relationships')
  const relMap = new Map(deep(relsDoc, 'Relationship').map((r) => [A(r, 'Id'), A(r, 'Target')]))
  const sz = deep(presDoc, 'sldSz')[0]
  const order = deep(presDoc, 'sldId').map((s) => relMap.get(s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id'))).filter(Boolean).map((t) => 'ppt/' + t.replace(/^\/?(ppt\/)?/, ''))
  const slides = []
  const media = async (slidePath, rid) => {
    const rp = slidePath.replace(/([^/]*)$/, '_rels/$1.rels')
    const f = zip.file(rp)
    if (!f) return null
    const d = parseXml(await f.async('string'), 'relationships')
    const target = deep(d, 'Relationship').find((r) => A(r, 'Id') === rid)
    if (!target) return null
    const parts = (A(target, 'Target').startsWith('/') ? A(target, 'Target').slice(1) : slidePath.replace(/[^/]*$/, '') + A(target, 'Target')).split('/')
    const out = []
    for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p) }
    const file = zip.file(out.join('/'))
    return file ? new Uint8Array(await file.async('uint8array')) : null
  }
  for (let i = 0; i < order.length; i++) {
    checkAbort(signal)
    const path = order[i]
    const f = zip.file(path)
    if (!f) continue
    const doc = parseXml(await f.async('string'), 'slide')
    const root = doc.documentElement
    let title = ''
    const blocks = []
    const para = (p, isBody) => {
      const lvl = Number(A(kid(p, 'pPr'), 'lvl')) || 0
      const runs = []
      for (const c of p.children) {
        if (c.localName === 'r' || c.localName === 'fld') {
          const t = kid(c, 't')?.textContent || ''
          if (!t) continue
          const rp = kid(c, 'rPr')
          const run = { text: t }
          if (A(rp, 'b') === '1') run.b = true
          if (A(rp, 'i') === '1') run.i = true
          if (A(rp, 'u') && A(rp, 'u') !== 'none') run.u = true
          runs.push(run)
        } else if (c.localName === 'br') runs.push({ br: true })
      }
      if (!runs.some((r) => r.text?.trim())) return null
      const pPr = kid(p, 'pPr')
      const noBullet = !!kid(pPr, 'buNone')
      const hasBullet = !!(kid(pPr, 'buChar') || kid(pPr, 'buAutoNum'))
      const numbered = !!kid(pPr, 'buAutoNum')
      const out = { t: 'p', runs }
      if ((isBody && !noBullet) || hasBullet) out.list = { ordered: numbered, level: Math.min(lvl, 5), n: 1, type: 'decimal' }
      return out
    }
    const tree = (node) => {
      for (const sp of node.children) {
        const ln = sp.localName
        if (ln === 'sp') {
          const ph = deep(kid(kid(sp, 'nvSpPr'), 'nvPr') || sp, 'ph')[0]
          const type = A(ph, 'type')
          if (FOOTER_PH.has(type)) continue
          const tb = kid(sp, 'txBody')
          if (!tb) continue
          const isTitle = type === 'title' || type === 'ctrTitle'
          const isBody = !!ph && !isTitle && type !== 'subTitle'
          const ps = kids(tb, 'p').map((p) => para(p, isBody)).filter(Boolean)
          if (isTitle) { if (!title) title = ps.map((p) => p.runs.map((r) => r.text || ' ').join('')).join(' ').trim() } else blocks.push(...ps)
        } else if (ln === 'graphicFrame') {
          const tbl = deep(sp, 'tbl')[0]
          if (tbl) {
            const rows = kids(tbl, 'tr').map((tr) => kids(tr, 'tc').filter((tc) => A(tc, 'hMerge') !== '1' && A(tc, 'vMerge') !== '1').map((tc) => ({ blocks: kids(kid(tc, 'txBody'), 'p').map((p) => para(p, false)).filter(Boolean).concat([]) , th: false, colspan: Number(A(tc, 'gridSpan')) || 1, rowspan: Number(A(tc, 'rowSpan')) || 1, bg: null })))
            for (const r of rows) for (const c of r) if (!c.blocks.length) c.blocks = [{ t: 'p', runs: [{ text: '' }] }]
            if (rows.length) blocks.push({ t: 'table', rows, border: true })
          }
        } else if (ln === 'grpSp') tree(sp)
        else if (ln === 'pic') {
          const blip = deep(sp, 'blip')[0]
          const rid = blip && attrNS(blip, 'embed')
          if (rid) blocks.push({ t: 'pic', rid, path })
        }
      }
    }
    tree(kid(kid(root, 'cSld'), 'spTree'))
    // pictures
    for (let k = 0; k < blocks.length; k++) {
      if (blocks[k].t !== 'pic') continue
      const bytes2 = await media(blocks[k].path, blocks[k].rid)
      const norm = bytes2 ? await normalizeImage(bytes2, sniffImage(bytes2)) : null
      blocks[k] = norm ? { t: 'p', runs: [{ img: { bytes: norm.bytes, mime: norm.mime, w: Math.min(norm.w, 520), h: Math.round((Math.min(norm.w, 520) * norm.h) / norm.w), alt: '' } }] } : { t: 'p', runs: [] }
    }
    // notes
    let notes = ''
    const relFile = zip.file(path.replace(/([^/]*)$/, '_rels/$1.rels'))
    if (relFile) {
      const rd = parseXml(await relFile.async('string'), 'relationships')
      const nt = deep(rd, 'Relationship').find((r) => /notesSlide$/.test(A(r, 'Type')))
      if (nt) {
        const np = 'ppt/notesSlides/' + A(nt, 'Target').split('/').pop()
        const nf = zip.file(np)
        if (nf) {
          const nd = parseXml(await nf.async('string'), 'notes')
          notes = deep(nd, 'sp').filter((sp) => A(deep(sp, 'ph')[0], 'type') === 'body').map((sp) => kids(kid(sp, 'txBody'), 'p').map((p) => deep(p, 't').map((t) => t.textContent).join('')).join('\n')).join('\n').trim()
        }
      }
    }
    slides.push({ index: i + 1, title, blocks: blocks.filter((b) => b.t !== 'p' || b.runs.length), notes, hidden: A(root, 'show') === '0', path })
    onProgress?.((i + 1) / order.length, `Reading slide ${i + 1} of ${order.length}`)
  }
  if (!slides.length) throw fail('No slides were found in this file.')
  return { slides, width: Number(A(sz, 'cx')) || 9144000, height: Number(A(sz, 'cy')) || 6858000 }
}

/**
 * PPTX -> blocks for DOCX / TXT / Markdown. opts: {text (default true), notes, images: 'none' | 'slide' (a picture of each slide), hidden (include hidden slides), pageBreaks}
 */
export async function pptxToBlocks(bytes, { notes = true, images = 'none', hidden = false, pageBreaks = false, text = true, onProgress, signal } = {}) {
  const data = await readPptxSlides(bytes, { onProgress: (f, t) => onProgress?.(f * 0.4, t), signal })
  let pp = null
  if (images === 'slide') {
    const { openPptx } = await import('../pdf-convert/_pptx.js')
    pp = await openPptx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  }
  const blocks = []
  const list = data.slides.filter((s) => hidden || !s.hidden)
  for (let i = 0; i < list.length; i++) {
    checkAbort(signal)
    const s = list[i]
    if (pageBreaks && i > 0) blocks.push({ t: 'pagebreak' })
    blocks.push({ t: 'p', level: 2, runs: [{ text: `Slide ${s.index}${s.title ? ': ' + s.title : ''}` }] })
    if (pp) {
      const r = await pp.render(s.index - 1, { widthPx: 1280 })
      const png = new Uint8Array(await (await new Promise((res) => r.canvas.toBlob(res, 'image/png'))).arrayBuffer())
      const w = 560, h = Math.round((w * r.canvas.height) / r.canvas.width)
      blocks.push({ t: 'p', runs: [{ img: { bytes: png, mime: 'image/png', w, h, alt: s.title || `Slide ${s.index}` } }] })
      r.canvas.width = r.canvas.height = 0
    }
    if (text) {
      let n = 0
      for (const b of s.blocks) {
        if (b.t === 'p' && b.list?.ordered) { n++; b.list.n = n } else n = 0
        blocks.push(b)
      }
    }
    if (notes && s.notes) blocks.push({ t: 'p', runs: [{ text: 'Notes: ', b: true }, { text: s.notes, i: true }] })
    onProgress?.(0.4 + 0.6 * ((i + 1) / list.length), `Slide ${i + 1} of ${list.length}`)
  }
  pp?.close()
  return { blocks, slides: list, title: data.slides[0]?.title || '' }
}

// ------------------------------------------------------------------ Markdown / HTML -> PPTX
/** Blocks -> slides: a new slide at every heading of level <= splitLevel; long slides continue on another slide. */
export function blocksToSlides(blocks, { splitLevel = 2, maxLines = 13 } = {}) {
  const slides = []
  let cur = null
  const start = (title, level) => { cur = { title, level, items: [], lines: 0 }; slides.push(cur) }
  const textLen = (b) => (b.runs || []).reduce((n, r) => n + (r.text?.length || 0), 0)
  for (const b of blocks) {
    if (b.t === 'p' && b.level && b.level <= splitLevel) { start((b.runs || []).map((r) => r.text || '').join(''), b.level); continue }
    if (!cur) start('', 1)
    const cost = b.t === 'table' ? b.rows.length + 1 : b.t === 'p' && b.runs.some((r) => r.img) ? 9 : b.t === 'p' ? Math.max(1, Math.ceil(textLen(b) / 75)) : 1
    if (cur.lines + cost > maxLines && cur.items.length) { start(cur.title ? `${cur.title.replace(/ \(cont\.\)$/, '')} (cont.)` : '', cur.level) }
    cur.items.push(b)
    cur.lines += cost
  }
  return slides.filter((s) => s.title || s.items.length)
}

/** Blocks -> .pptx (16:9). -> Uint8Array */
export async function blocksToPptx(blocks, { title = '', splitLevel = 2, theme = 'light', onProgress } = {}) {
  const P = await pptxgen()
  const pres = new P()
  pres.layout = 'LAYOUT_WIDE'
  pres.title = title || 'Presentation'
  const dark = theme === 'dark'
  const bg = dark ? '1B1B22' : 'FFFFFF', fg = dark ? 'F2F2F5' : '1F2937', accent = dark ? '8AA4FF' : '2B5BD7', muted = dark ? 'A5A5B2' : '6B7280'
  const slides = blocksToSlides(blocks, { splitLevel })
  if (!slides.length) throw fail('There is no text to turn into slides.')
  const W = 13.33
  const plain = (b) => (b.runs || []).map((r) => (r.br ? '\n' : r.tab ? '    ' : r.text || '')).join('')
  const textRuns = (runs, base = {}) => {
    const out = []
    for (const r of runs) {
      if (r.img) continue
      if (r.br) { out.push({ text: '\n', options: base }); continue }
      out.push({ text: r.tab ? '    ' : r.text || '', options: { ...base, bold: r.b || undefined, italic: r.i || undefined, underline: r.u ? { style: 'sng' } : undefined, strike: r.s ? 'sngStrike' : undefined, color: r.color || base.color, fontFace: r.mono ? 'Consolas' : undefined, hyperlink: r.href ? { url: r.href } : undefined } })
    }
    return out
  }
  slides.forEach((sd, idx) => {
    const s = pres.addSlide()
    s.background = { color: bg }
    const isTitleSlide = idx === 0 && sd.level === 1 && sd.items.every((b) => b.t === 'p') && sd.items.length <= 2
    let y = 0.45
    if (isTitleSlide) {
      s.addText(sd.title || title || 'Presentation', { x: 0.8, y: 2.3, w: W - 1.6, h: 1.4, fontSize: 40, bold: true, color: fg, align: 'left', fontFace: 'Calibri', valign: 'bottom' })
      const sub = sd.items.map(plain).join('\n')
      if (sub) s.addText(sub, { x: 0.8, y: 3.8, w: W - 1.6, h: 1.4, fontSize: 20, color: muted, align: 'left', fontFace: 'Calibri', valign: 'top' })
      s.addShape(pres.ShapeType.rect, { x: 0.8, y: 3.72, w: 1.2, h: 0.06, fill: { color: accent }, line: { color: accent } })
      return
    }
    if (sd.title) { s.addText(sd.title, { x: 0.6, y, w: W - 1.2, h: 0.9, fontSize: 30, bold: true, color: fg, fontFace: 'Calibri', valign: 'middle' }); s.addShape(pres.ShapeType.rect, { x: 0.6, y: y + 0.92, w: 1.0, h: 0.05, fill: { color: accent }, line: { color: accent } }); y += 1.25 }
    // group consecutive paragraphs into one text box; tables and pictures stand alone
    let group = []
    const flushGroup = () => {
      if (!group.length) return
      const items = []
      for (const b of group) {
        const base = { fontSize: b.code ? 14 : 20, color: b.code ? accent : fg, fontFace: b.code ? 'Consolas' : 'Calibri' }
        const runs = textRuns(b.runs, base)
        if (!runs.length) continue
        const first = runs[0]
        if (b.list) first.options = { ...first.options, bullet: b.list.ordered ? { type: 'number' } : true, indentLevel: Math.min(b.list.level, 4) }
        if (b.quote) first.options = { ...first.options, italic: true, indentLevel: 1 }
        runs[runs.length - 1].options = { ...runs[runs.length - 1].options, breakLine: true }
        items.push(...runs)
      }
      const h = Math.min(7.5 - y - 0.4, Math.max(0.6, items.length * 0.42))
      if (items.length) s.addText(items, { x: 0.7, y, w: W - 1.4, h: Math.max(0.6, 7.1 - y), valign: 'top', paraSpaceAfter: 6, fit: 'shrink' })
      y += h
      group = []
    }
    for (const b of sd.items) {
      if (b.t === 'p' && b.runs.some((r) => r.img)) {
        flushGroup()
        const im = b.runs.find((r) => r.img).img
        const maxW = W - 1.4, maxH = Math.max(1.5, 7.2 - y)
        let w = Math.min(maxW, (im.w || 400) / 96), h = ((im.h || 300) / (im.w || 400)) * w
        if (h > maxH) { w = (w * maxH) / h; h = maxH }
        const b64 = (() => { let str = ''; for (let i = 0; i < im.bytes.length; i += 0x8000) str += String.fromCharCode.apply(null, im.bytes.subarray(i, i + 0x8000)); return btoa(str) })()
        s.addImage({ data: `${im.mime};base64,${b64}`, x: 0.7, y, w, h })
        y += h + 0.2
      } else if (b.t === 'table') {
        flushGroup()
        const rows = b.rows.map((r, ri) => r.map((c) => ({ text: c.blocks.map(plain).join('\n'), options: { bold: ri === 0 || c.th, fontSize: 14, color: fg, fill: { color: ri === 0 ? (dark ? '2A2A35' : 'EEF1F8') : bg }, colspan: c.colspan > 1 ? c.colspan : undefined, rowspan: c.rowspan > 1 ? c.rowspan : undefined } })))
        const rh = Math.min(0.5, (7.1 - y) / rows.length)
        s.addTable(rows, { x: 0.7, y, w: W - 1.4, rowH: rh, border: { type: 'solid', pt: 1, color: dark ? '555566' : 'C9CCD6' }, fontFace: 'Calibri' })
        y += rh * rows.length + 0.2
      } else if (b.t === 'p') group.push(b)
    }
    flushGroup()
    onProgress?.((idx + 1) / slides.length, `Slide ${idx + 1} of ${slides.length}`)
  })
  const out = await pres.write({ outputType: 'uint8array' })
  return out instanceof Uint8Array ? out : new Uint8Array(out)
}
void utf8
