// Direct PDF export with jsPDF: a small layout engine that draws the document tree with real (selectable) text.
// Uses the PDF standard fonts, so it covers Latin scripts. Other scripts need Print > Save as PDF (the editor says so).
import { jspdf } from '../../lib/libs.js'
import { loadImage, toCanvas, toBlob } from '../../lib/image.js'
import { readDataURL } from '../../lib/files.js'
import { pageMm } from './_page.js'
import { imageSize } from './_img.js'

const MM_PT = 72 / 25.4
const PX_PT = 0.75
// Unicode -> WinAnsi byte for the characters in 0x80-0x9F; the PDF standard fonts address them by byte
const WIN_MAP = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e,
  0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f }
const enc = (str) => str.replace(/[^\u0000-\u00ff]/g, (ch) => String.fromCharCode(WIN_MAP[ch.charCodeAt(0)] ?? 63))
const FAMILY = {
  'Times New Roman': 'times', Georgia: 'times', Cambria: 'times', 'Courier New': 'courier', Calibri: 'helvetica', Arial: 'helvetica', Verdana: 'helvetica',
}
const SIZES = { h1: 22, h2: 16, h3: 13, h4: 11.5, h5: 11, h6: 11 }
const rgb = (hex) => { const h = (hex || '#1a1a1f').replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) }
const supported = (ch) => { const c = ch.codePointAt(0); return c < 0x100 || c in WIN_MAP || c === 0x2610 || c === 0x2611 }

export async function buildPdf(doc, settings, title) {
  const notes = []
  // unsupported characters: tell the person up front instead of drawing garbage
  const bad = new Set()
  doc.descendants((n) => { if (n.isText) for (const ch of n.text) if (!supported(ch)) bad.add(ch) })
  if (bad.size) {
    throw Object.assign(new Error(`This document has characters the built-in PDF fonts cannot draw (${[...bad].slice(0, 6).join(' ')}). Use Print, then choose Save as PDF, which supports every script.`), { code: 'UNICODE' })
  }
  const JsPDF = await jspdf()
  const { w: wmm, h: hmm } = pageMm(settings)
  const pdf = new JsPDF({ unit: 'pt', format: [wmm * MM_PT, hmm * MM_PT], orientation: wmm > hmm ? 'landscape' : 'portrait', compress: true })
  pdf.setProperties({ title, creator: 'Docs' })
  const PW = pdf.internal.pageSize.getWidth(), PH = pdf.internal.pageSize.getHeight()
  const M = { t: settings.margins.top * MM_PT, r: settings.margins.right * MM_PT, b: settings.margins.bottom * MM_PT, l: settings.margins.left * MM_PT }
  const baseFam = FAMILY[settings.font] || 'helvetica'
  const baseSize = settings.fontSize
  const images = new Map()

  let y = M.t
  let dry = false
  const bottom = () => PH - M.b
  const newPage = () => { if (!dry) { pdf.addPage([PW, PH], PW > PH ? 'landscape' : 'portrait'); } y = M.t }
  const ensure = (h) => { if (!dry && y + h > bottom() + 0.5 && y > M.t + 1) newPage() }

  // ---------- images ----------
  async function prepImage(src) {
    if (images.has(src)) return images.get(src)
    let rec
    try {
      let data = src, fmt
      const m = src.match(/^data:image\/([a-z+.-]+);base64,/i)
      if (m && /^(png|jpe?g)$/i.test(m[1])) fmt = m[1].toLowerCase() === 'png' ? 'PNG' : 'JPEG'
      else {
        const img = await loadImage(src)
        const c = toCanvas(img, img.naturalWidth || 300, img.naturalHeight || 200)
        data = await readDataURL(await toBlob(c, 'image/png'))
        fmt = 'PNG'
      }
      rec = { data, fmt }
    } catch { rec = null }
    images.set(src, rec)
    return rec
  }

  // ---------- inline atoms ----------
  const fontFor = (a) => {
    const fam = a.fam
    const st = a.bold && a.italic ? 'bolditalic' : a.bold ? 'bold' : a.italic ? 'italic' : 'normal'
    pdf.setFont(fam, st)
    pdf.setFontSize(a.size)
  }
  const widthOf = (a) => { fontFor(a); return pdf.getTextWidth(a.text) }

  async function atomsOf(node, base) {
    const atoms = []
    const kids = []
    node.forEach((c) => kids.push(c))
    for (const c of kids) {
      if (c.type.name === 'hard_break') { atoms.push({ type: 'br', size: base.size, fam: base.fam }); continue }
      if (c.type.name === 'image') {
        const rec = await prepImage(c.attrs.src)
        if (!rec) { notes.push('Some images could not be added to the PDF.'); continue }
        let { width, height } = c.attrs
        if (!width) { const s = await imageSize(c.attrs.src); width = s.width; height = s.height }
        else if (!height) height = Math.round(width * 0.66)
        atoms.push({ type: 'img', rec, w: width * PX_PT, h: height * PX_PT, size: height * PX_PT, fam: base.fam })
        continue
      }
      if (!c.isText) continue
      const a = { ...base }
      for (const m of c.marks) {
        const v = m.attrs
        switch (m.type.name) {
          case 'strong': a.bold = true; break
          case 'em': a.italic = true; break
          case 'underline': a.underline = true; break
          case 'strike': a.strike = true; break
          case 'code': a.fam = 'courier'; a.size = base.size * 0.92; a.bg = a.bg || '#f0f0f4'; break
          case 'sub': a.rise = -0.2; a.size = a.size * 0.7; break
          case 'sup': a.rise = 0.35; a.size = a.size * 0.7; break
          case 'color': a.color = v.color; break
          case 'highlight': a.bg = v.color; break
          case 'fontSize': a.size = v.size; break
          case 'fontFamily': a.fam = FAMILY[v.family] || base.fam; break
          case 'link': a.href = v.href; a.color = '#1558d6'; a.underline = true; break
          default: break
        }
      }
      for (const tok of c.text.split(/(\s+)/)) {
        if (!tok) continue
        atoms.push({ ...a, type: /^\s+$/.test(tok) ? 'space' : 'word', text: /^\s+$/.test(tok) ? ' ' : enc(tok) })
      }
    }
    return atoms
  }

  function breakLines(atoms, width) {
    const lines = []
    let cur = { atoms: [], w: 0 }
    const push = (force) => { lines.push(cur); cur = { atoms: [], w: 0, forced: force } }
    for (const a of atoms) {
      if (a.type === 'br') { cur.atoms.push(a); push(true); continue }
      a.w ??= widthOf(a)
      if (a.type === 'space') { if (cur.atoms.length) { cur.atoms.push(a); cur.w += a.w } continue }
      if (cur.w + a.w > width + 0.01 && cur.atoms.some((x) => x.type !== 'space')) {
        while (cur.atoms.length && cur.atoms[cur.atoms.length - 1].type === 'space') cur.w -= cur.atoms.pop().w
        push(false)
      }
      if (a.type === 'word' && a.w > width) { // very long word: split by characters
        let piece = ''
        for (const ch of a.text) {
          const t = { ...a, text: piece + ch }
          if (widthOf(t) > width - cur.w && piece) { const p = { ...a, text: piece }; p.w = widthOf(p); cur.atoms.push(p); cur.w += p.w; push(false); piece = ch } else piece += ch
        }
        const last = { ...a, text: piece }; last.w = widthOf(last); cur.atoms.push(last); cur.w += last.w
        continue
      }
      cur.atoms.push(a)
      cur.w += a.w
    }
    if (cur.atoms.length || !lines.length) lines.push(cur)
    for (const l of lines) while (l.atoms.length && l.atoms[l.atoms.length - 1].type === 'space') l.w -= l.atoms.pop().w
    return lines
  }

  /** Lay out and draw (or measure, when dry) one text block. */
  async function paragraph(node, { x, width, align = null, size = baseSize, bold = false, italic = false, color = '#1a1a1f', fam = baseFam, lh = 1.3, after = 8, before = 0, indentFirst = 0, marker = null }) {
    const base = { fam, size, bold, italic, color }
    const atoms = await atomsOf(node, base)
    const startY = y
    y += before
    const lines = breakLines(atoms, width - indentFirst)
    let first = true
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i]
      const maxSize = Math.max(size, ...ln.atoms.map((a) => (a.type === 'img' ? a.h : a.size || size)))
      const hasImg = ln.atoms.some((a) => a.type === 'img')
      const lineH = hasImg ? maxSize + 2 : maxSize * 1.2 * lh
      ensure(lineH)
      const baseline = y + (hasImg ? lineH : (lineH - maxSize * 1.2) / 2 + maxSize * 0.95)
      let cx = x + (first ? indentFirst : 0)
      const avail = width - (first ? indentFirst : 0)
      const gaps = ln.atoms.filter((a) => a.type === 'space').length
      let extra = 0
      let off = 0
      if (align === 'center') off = (avail - ln.w) / 2
      else if (align === 'right') off = avail - ln.w
      else if (align === 'justify' && gaps && !ln.forced && i < lines.length - 1) extra = (avail - ln.w) / gaps
      cx += Math.max(0, off)
      if (first && marker && !dry) {
        marker(x, baseline, y, lineH)
      }
      if (!dry) {
        for (const a of ln.atoms) {
          if (a.type === 'br') continue
          const aw = a.w + (a.type === 'space' ? extra : 0)
          if (a.type === 'img') { pdf.addImage(a.rec.data, a.rec.fmt, cx, baseline - a.h, a.w, a.h); cx += a.w; continue }
          const by = baseline - (a.rise || 0) * (a.size / 0.7 || size)
          if (a.bg && a.type !== 'space') { pdf.setFillColor(...rgb(a.bg)); pdf.rect(cx, by - a.size * 0.95, aw, a.size * 1.2, 'F') }
          else if (a.bg && a.type === 'space') { pdf.setFillColor(...rgb(a.bg)); pdf.rect(cx, by - a.size * 0.95, aw, a.size * 1.2, 'F') }
          if (a.type === 'word') {
            fontFor(a)
            pdf.setTextColor(...rgb(a.color))
            pdf.text(a.text, cx, by)
            if (a.underline) { pdf.setDrawColor(...rgb(a.color)); pdf.setLineWidth(Math.max(0.4, a.size / 24)); pdf.line(cx, by + a.size * 0.12, cx + aw, by + a.size * 0.12) }
            if (a.strike) { pdf.setDrawColor(...rgb(a.color)); pdf.setLineWidth(Math.max(0.4, a.size / 24)); pdf.line(cx, by - a.size * 0.3, cx + aw, by - a.size * 0.3) }
          } else if (a.type === 'space' && (a.underline || a.strike) && a.href) {
            pdf.setDrawColor(...rgb(a.color)); pdf.setLineWidth(Math.max(0.4, a.size / 24)); pdf.line(cx, by + a.size * 0.12, cx + aw, by + a.size * 0.12)
          }
          if (a.href) pdf.link(cx, by - a.size, aw, a.size * 1.25, { url: a.href })
          cx += aw
        }
      }
      y += lineH
      first = false
    }
    y += after
    return y - startY
  }

  // ---------- blocks ----------
  async function blocks(parent, ctx) {
    const kids = []
    parent.forEach((c) => kids.push(c))
    for (const c of kids) await block(c, ctx)
  }

  async function block(node, ctx) {
    const t = node.type.name
    const a = node.attrs
    const ind = (a.indent || 0) * 36
    if (t === 'paragraph' || t === 'heading') {
      let o = { x: ctx.x + ind, width: ctx.width - ind, align: a.align, lh: a.lineHeight ? a.lineHeight / 1.15 : 1.2, color: ctx.color, ...(ctx.p || {}) }
      if (t === 'heading') o = { ...o, size: SIZES[`h${a.level}`], bold: a.level < 6, italic: a.level === 6, before: a.level === 1 ? 10 : 6, after: 4, color: a.level === 6 ? '#5b5b66' : '#1a1a1f' }
      else if (a.variant === 'title') o = { ...o, size: 30, bold: true, after: 6 }
      else if (a.variant === 'subtitle') o = { ...o, size: 15, color: '#5b5b66', after: 12 }
      if (t === 'heading' && !dry) ensure(o.size * 2.4) // keep a heading with the text after it
      await paragraph(node, o)
    } else if (t === 'blockquote') {
      const top = y, page0 = pdf.getNumberOfPages()
      await blocks(node, { ...ctx, x: ctx.x + 14, width: ctx.width - 14, color: '#4b4b57' })
      if (!dry && pdf.getNumberOfPages() === page0) { pdf.setDrawColor(...rgb('#c9c9d3')); pdf.setLineWidth(2); pdf.line(ctx.x + 3, top, ctx.x + 3, y - 6) }
    } else if (t === 'code_block') {
      const lines = node.textContent.split('\n')
      const size = 10, lh = size * 1.35
      const pad = 6
      if (!dry) ensure(Math.min(lh * lines.length + pad * 2, bottom() - M.t))
      for (let i = 0; i < lines.length; i++) {
        ensure(lh + (i === 0 ? pad : 0))
        if (!dry) { pdf.setFillColor(...rgb('#f4f4f7')); pdf.rect(ctx.x, y - (i === 0 ? 0 : 0), ctx.width, lh + (i === 0 || i === lines.length - 1 ? pad : 0), 'F') }
        if (i === 0) y += pad
        if (!dry) { pdf.setFont('courier', 'normal'); pdf.setFontSize(size); pdf.setTextColor(...rgb('#1a1a1f')); pdf.text(lines[i].slice(0, 400), ctx.x + pad, y + size) }
        y += lh
      }
      y += pad + 8
    } else if (t === 'horizontal_rule') {
      y += 6
      ensure(4)
      if (!dry) { pdf.setDrawColor(...rgb('#c9c9d3')); pdf.setLineWidth(0.8); pdf.line(ctx.x, y, ctx.x + ctx.width, y) }
      y += 8
    } else if (t === 'page_break') {
      if (!dry) newPage()
    } else if (t === 'bullet_list' || t === 'ordered_list' || t === 'task_list') {
      await list(node, ctx)
    } else if (t === 'table') {
      await table(node, ctx)
    }
  }

  async function list(node, ctx) {
    const t = node.type.name
    const level = ctx.level || 0
    const step = 20
    let n = node.attrs.order || 1
    const items = []
    node.forEach((c) => items.push(c))
    for (const item of items) {
      const kids = []
      item.forEach((c) => kids.push(c))
      const isTask = t === 'task_list'
      const label = t === 'ordered_list' ? `${n}.` : ''
      for (let i = 0; i < kids.length; i++) {
        const k = kids[i]
        if (i === 0 && (k.type.name === 'paragraph' || k.type.name === 'heading')) {
          const marker = (mx, baseline, top, lineH) => {
            if (isTask) {
              const s = baseSize * 0.85
              pdf.setDrawColor(...rgb('#5b5b66')); pdf.setLineWidth(0.8)
              pdf.rect(mx - step + 2, baseline - s, s, s)
              if (item.attrs.checked) { pdf.setDrawColor(...rgb('#12804a')); pdf.setLineWidth(1.2); pdf.line(mx - step + 4, baseline - s * 0.45, mx - step + 2 + s * 0.4, baseline - s * 0.15); pdf.line(mx - step + 2 + s * 0.4, baseline - s * 0.15, mx - step + s, baseline - s * 0.85) }
            } else {
              pdf.setFont(baseFam, 'normal'); pdf.setFontSize(baseSize); pdf.setTextColor(...rgb('#1a1a1f'))
              if (t === 'bullet_list') { // vector bullets: the standard fonts have no round-bullet variants for nested levels
                const r = baseSize * 0.13, cx = mx - 10, cy = baseline - baseSize * 0.32
                pdf.setFillColor(...rgb('#1a1a1f')); pdf.setDrawColor(...rgb('#1a1a1f')); pdf.setLineWidth(0.7)
                if (level % 3 === 0) pdf.circle(cx, cy, r, 'F'); else if (level % 3 === 1) pdf.circle(cx, cy, r, 'S'); else pdf.rect(cx - r, cy - r, r * 2, r * 2, 'F')
              } else {
                const w = pdf.getTextWidth(label)
                pdf.text(label, mx - 6 - w, baseline)
              }
            }
            void top; void lineH
          }
          await paragraph(k, { x: ctx.x + step, width: ctx.width - step, align: k.attrs.align, after: 3, lh: 1.2, color: item.attrs.checked ? '#8a8a98' : ctx.color, marker, ...(ctx.p || {}) })
        } else if (/_list$/.test(k.type.name)) {
          await list(k, { ...ctx, x: ctx.x + step, width: ctx.width - step, level: level + 1 })
        } else await block(k, { ...ctx, x: ctx.x + step, width: ctx.width - step })
      }
      n++
    }
    if (level === 0) y += 5
  }

  async function table(node, ctx) {
    const rows = []
    node.forEach((r) => rows.push(r))
    const firstCells = []
    rows[0].forEach((c) => firstCells.push(c))
    const grid = []
    for (const c of firstCells) for (let i = 0; i < (c.attrs.colspan || 1); i++) grid.push(c.attrs.colwidth?.[i] ? c.attrs.colwidth[i] * PX_PT : 0)
    const known = grid.reduce((s, v) => s + v, 0)
    const unknown = grid.filter((v) => !v).length
    const share = unknown ? Math.max(30, (ctx.width - known) / unknown) : 0
    let widths = grid.map((v) => v || share)
    const total = widths.reduce((s, v) => s + v, 0)
    if (total > ctx.width || (!known && total < ctx.width)) widths = widths.map((v) => (v * ctx.width) / total)
    const pad = 4
    y += 2
    for (const r of rows) {
      const cells = []
      r.forEach((c) => cells.push(c))
      // measure
      let col = 0
      const laid = []
      let rowH = 0
      const saveY = y, saveDry = dry
      for (const c of cells) {
        const span = c.attrs.colspan || 1
        const w = widths.slice(col, col + span).reduce((s, v) => s + v, 0)
        dry = true
        y = 0
        const head = c.type.name === 'table_header'
        await blocks(c, { x: 0, width: w - pad * 2, color: '#1a1a1f', p: { bold: head, after: 2 } })
        laid.push({ c, x: widths.slice(0, col).reduce((s, v) => s + v, 0), w, h: y - 2, head })
        rowH = Math.max(rowH, y - 2)
        col += span
      }
      dry = saveDry
      y = saveY
      rowH += pad * 2
      ensure(Math.min(rowH, bottom() - M.t))
      if (!dry) {
        for (const L of laid) {
          const fill = L.c.attrs.background || (L.head ? '#f1f1f6' : null)
          if (fill) { pdf.setFillColor(...rgb(fill)); pdf.rect(ctx.x + L.x, y, L.w, rowH, 'F') }
          pdf.setDrawColor(...rgb('#c4c4cf')); pdf.setLineWidth(0.6)
          pdf.rect(ctx.x + L.x, y, L.w, rowH)
        }
      }
      const top = y
      for (const L of laid) {
        y = top + pad
        const keep = dry
        dry = keep
        await blocks(L.c, { x: ctx.x + L.x + pad, width: L.w - pad * 2, color: '#1a1a1f', p: { bold: L.head, after: 2 } })
      }
      y = top + rowH
    }
    y += 8
  }

  await blocks(doc, { x: M.l, width: PW - M.l - M.r, color: '#1a1a1f' })

  // header, footer and page numbers on every page
  const pages = pdf.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.setTextColor(...rgb('#7a7a86'))
    if (settings.header) pdf.text(settings.header, PW / 2, M.t * 0.45, { align: 'center' })
    const fy = PH - M.b * 0.45
    if (settings.footer && settings.pageNumbers) { pdf.text(settings.footer, M.l, fy); pdf.text(String(i), PW - M.r, fy, { align: 'right' }) }
    else if (settings.pageNumbers) pdf.text(String(i), PW / 2, fy, { align: 'center' })
    else if (settings.footer) pdf.text(settings.footer, PW / 2, fy, { align: 'center' })
  }
  return { blob: pdf.output('blob'), notes: [...new Set(notes)] }
}
