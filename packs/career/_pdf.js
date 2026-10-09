// jsPDF flow writer for real, selectable text with wrapping and page breaks (resumes, letters, notes).
// Standard PDF fonts only cover Latin text, so winAnsi() swaps a few symbols and flags what cannot be drawn.
import { jspdf } from '../../lib/libs.js'

export const PAGES = { a4: [595.28, 841.89], letter: [612, 792] }
export const hexRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '') || /^#?([0-9a-f]{3})$/i.exec(hex || '')
  if (!m) return [13, 155, 138]
  const v = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1]
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16))
}
export const tint = (rgb, t) => rgb.map((c) => Math.round(c + (255 - c) * t))

const EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–\u2014˜™š›œžŸ')
const MAP = { '₹': 'Rs.', '→': '->', '←': '<-', '✓': '', '✔': '', '★': '*', '☆': '*', '≥': '>=', '≤': '<=', ' ': ' ', ' ': ' ', '​': '', '●': '•', '▪': '•', '◦': '-', '−': '-', '′': "'", '″': '"', '│': '|', '·': '·' }
/** Text safe for the built-in PDF fonts. Returns the string with unsupported characters replaced by "?". */
export function winAnsi(s) {
  let out = ''
  for (const ch of String(s ?? '')) {
    if (MAP[ch] !== undefined) out += MAP[ch]
    else if (ch.charCodeAt(0) <= 0xff || EXTRAS.has(ch)) out += ch
    else out += '?'
  }
  return out
}
/** Distinct characters in s that the built-in fonts cannot show. */
export function unsupportedChars(s) {
  const bad = new Set()
  for (const ch of String(s ?? '')) if (MAP[ch] === undefined && ch.charCodeAt(0) > 0xff && !EXTRAS.has(ch) && !/\s/.test(ch)) bad.add(ch)
  return [...bad]
}

export async function newDoc({ page = 'a4', title = '', author = '', subject = '' } = {}) {
  const JsPDF = await jspdf()
  const [w, h] = PAGES[page] || PAGES.a4
  const doc = new JsPDF({ unit: 'pt', format: [w, h], compress: true, putOnlyUsedFonts: true })
  doc.setProperties({ title, author, subject, creator: 'Tools' })
  return doc
}

export class Writer {
  constructor(doc, { margin = [48, 48, 48, 48], font = 'helvetica', unicode = false } = {}) {
    this.doc = doc
    this.uni = unicode
    this.font = font
    const [t, r, b, l] = margin
    this.m = { t, r, b, l }
    this.W = doc.internal.pageSize.getWidth()
    this.H = doc.internal.pageSize.getHeight()
    this.x = l
    this.cw = this.W - l - r
    this.y = t
    this.pages = 1
  }
  clean(s) { return this.uni ? String(s ?? '') : winAnsi(s) }
  style({ size = 10, bold = false, italic = false, color = [20, 20, 20], font } = {}) {
    const d = this.doc
    d.setFont(font || this.font, bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal')
    d.setFontSize(size)
    d.setTextColor(...color)
  }
  width(text, st) { this.style(st); return this.doc.getTextWidth(this.clean(text)) }
  newPage() { this.doc.addPage(); this.pages++; this.y = this.m.t }
  /** Make sure h points fit on this page, otherwise start a new one. */
  keep(h) { if (this.y + h > this.H - this.m.b && this.y > this.m.t + 1) this.newPage() }
  space(pt) { this.y += pt; if (this.y > this.H - this.m.b) this.newPage() }
  wrap(text, st, w) {
    this.style(st)
    return this.doc.splitTextToSize(this.clean(text), w)
  }
  base(lh, size) { return this.y + (lh - size) / 2 + size * 0.78 }
  /** Wrapped paragraph. opts: {indent, align, link, lh (factor), maxW, gapAfter} */
  para(text, st = {}, opts = {}) {
    const size = st.size || 10
    const lh = size * (opts.lh || 1.3)
    const indent = opts.indent || 0
    const w = (opts.maxW || this.cw) - indent
    const lines = this.wrap(text, st, w)
    for (const ln of lines) {
      this.keep(lh)
      this.style(st)
      const y = this.base(lh, size)
      const tw = this.doc.getTextWidth(ln)
      let x = this.x + indent
      if (opts.align === 'center') x = this.x + (this.cw - tw) / 2
      else if (opts.align === 'right') x = this.x + this.cw - tw
      if (opts.link) this.doc.textWithLink(ln, x, y, { url: opts.link })
      else this.doc.text(ln, x, y)
      this.y += lh
    }
    if (opts.gapAfter) this.space(opts.gapAfter)
    return lines.length
  }
  /** Left text (wraps) with a right-aligned part on the first line. */
  lr(left, right, stL = {}, stR = {}, opts = {}) {
    const size = Math.max(stL.size || 10, stR.size || 10)
    const lh = size * (opts.lh || 1.3)
    const rw = right ? this.width(right, stR) + 10 : 0
    const lines = this.wrap(left, stL, this.cw - rw - (opts.indent || 0))
    lines.forEach((ln, i) => {
      this.keep(lh)
      const y = this.base(lh, size)
      this.style(stL)
      if (opts.link && i === 0) this.doc.textWithLink(ln, this.x + (opts.indent || 0), y, { url: opts.link })
      else this.doc.text(ln, this.x + (opts.indent || 0), y)
      if (i === 0 && right) {
        this.style(stR)
        const tw = this.doc.getTextWidth(this.clean(right))
        if (opts.rightLink) this.doc.textWithLink(this.clean(right), this.x + this.cw - tw, y, { url: opts.rightLink })
        else this.doc.text(this.clean(right), this.x + this.cw - tw, y)
      }
      this.y += lh
    })
    return lines.length
  }
  /** One line made of differently styled pieces [{text, st}] plus an optional right-aligned part. Wraps with the first style when too long. */
  runs(parts, { right = '', stR = {}, lh = 1.3, link = '', rightLink = '' } = {}) {
    const size = Math.max(...parts.map((p) => p.st.size || 10), stR.size || 10)
    const h = size * lh
    const rw = right ? this.width(right, stR) + 10 : 0
    const widths = parts.map((p) => this.width(p.text, p.st))
    if (widths.reduce((a, b) => a + b, 0) > this.cw - rw) {
      return this.lr(parts.map((p) => p.text).join(''), right, parts[0].st, stR, { lh, link, rightLink })
    }
    this.keep(h)
    const y = this.base(h, size)
    let x = this.x
    parts.forEach((p, i) => {
      this.style(p.st)
      if (link && i === 0) this.doc.textWithLink(this.clean(p.text), x, y, { url: link })
      else this.doc.text(this.clean(p.text), x, y)
      x += widths[i]
    })
    if (right) {
      this.style(stR)
      const tw = this.doc.getTextWidth(this.clean(right))
      if (rightLink) this.doc.textWithLink(this.clean(right), this.x + this.cw - tw, y, { url: rightLink })
      else this.doc.text(this.clean(right), this.x + this.cw - tw, y)
    }
    this.y += h
    return 1
  }
  /** "Label: text" paragraph where the label is styled differently and the text wraps under it. */
  labelPara(label, text, stL, stT, { lh = 1.3 } = {}) {
    const size = Math.max(stL.size || 10, stT.size || 10)
    const h = size * lh
    const lw = this.width(label, stL)
    const words = this.clean(text).split(/\s+/).filter(Boolean)
    this.style(stT)
    const sp = this.doc.getTextWidth(' ')
    const lines = []
    let cur = '', used = lw
    for (const wd of words) {
      const ww = this.doc.getTextWidth(wd)
      if (cur && used + sp + ww > this.cw) { lines.push(cur); cur = wd; used = ww } else { used += (cur ? sp : 0) + ww; cur = cur ? `${cur} ${wd}` : wd }
    }
    if (cur || !lines.length) lines.push(cur)
    lines.forEach((ln, i) => {
      this.keep(h)
      const y = this.base(h, size)
      if (i === 0) { this.style(stL); this.doc.text(this.clean(label), this.x, y) }
      this.style(stT)
      this.doc.text(ln, this.x + (i === 0 ? lw : 0), y)
      this.y += h
    })
  }
  /** Hanging bullet. */
  bullet(text, st = {}, opts = {}) {
    const size = st.size || 10
    const lh = size * (opts.lh || 1.3)
    const ind = opts.indent ?? 14
    const lines = this.wrap(text, st, this.cw - ind - (opts.left || 0))
    lines.forEach((ln, i) => {
      this.keep(lh)
      this.style(st)
      const y = this.base(lh, size)
      if (i === 0) this.doc.text('•', this.x + (opts.left || 0) + 2, y)
      this.doc.text(ln, this.x + (opts.left || 0) + ind, y)
      this.y += lh
    })
  }
  rule(color = [200, 200, 200], width = 0.6, x0, x1) {
    this.keep(2)
    this.doc.setDrawColor(...color)
    this.doc.setLineWidth(width)
    this.doc.line(x0 ?? this.x, this.y, x1 ?? this.x + this.cw, this.y)
  }
  rect(x, y, w, h, fill) {
    this.doc.setFillColor(...fill)
    this.doc.rect(x, y, w, h, 'F')
  }
  /** Inline items [{text, url}] separated by sep, wrapped across lines. */
  inline(items, st, { sep = '  |  ', sepColor = [150, 150, 150], align = 'left', lh = 1.4 } = {}) {
    const size = st.size || 10
    const h = size * lh
    const lines = [[]]
    let used = 0
    const sw = this.width(sep, { ...st, color: sepColor })
    for (const it of items) {
      const tw = this.width(it.text, st)
      if (lines.at(-1).length && used + sw + tw > this.cw) { lines.push([]); used = 0 }
      used += (lines.at(-1).length ? sw : 0) + tw
      lines.at(-1).push({ ...it, tw })
    }
    for (const line of lines) {
      this.keep(h)
      const total = line.reduce((n, it, i) => n + it.tw + (i ? sw : 0), 0)
      let x = align === 'center' ? this.x + (this.cw - total) / 2 : align === 'right' ? this.x + this.cw - total : this.x
      const y = this.base(h, size)
      line.forEach((it, i) => {
        if (i) { this.style({ ...st, color: sepColor }); this.doc.text(this.clean(sep), x, y); x += sw }
        this.style(st)
        if (it.url) this.doc.textWithLink(this.clean(it.text), x, y, { url: it.url })
        else this.doc.text(this.clean(it.text), x, y)
        x += it.tw
      })
      this.y += h
    }
  }
}
