// Slides model -> .pptx with pptxgenjs (real text boxes, bullets, speaker notes, theme backgrounds).
import { pptxgen } from '../../lib/libs.js'
import { THEMES, runs, bodySize, titleSize } from './_deck.js'

function gradientPng(colors, w = 480, h = 270) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d')
  const grad = g.createLinearGradient(0, 0, w, h)
  grad.addColorStop(0, colors[0]); grad.addColorStop(1, colors[1])
  g.fillStyle = grad
  g.fillRect(0, 0, w, h)
  return c.toDataURL('image/png').replace(/^data:/, '')
}

/** Build the deck. Resolves a Blob. */
export async function buildPptx(slides, { theme = 'aurora', footer = '', numbers = true, notes = true, title = 'Presentation', author = '' } = {}) {
  const P = await pptxgen()
  const T = THEMES[theme] || THEMES.aurora
  const pptx = new P()
  pptx.layout = 'LAYOUT_WIDE' // 13.33 x 7.5 in
  pptx.title = title
  if (author) pptx.author = author
  pptx.company = ''
  const bgData = gradientPng(T.bg)
  const solid = T.bg[0] === T.bg[1]

  pptx.defineSlideMaster({ title: 'DECK_BG', background: solid ? { color: T.bg[0].replace('#', '') } : { data: bgData } })
  const base = (s, kind) => {
    if (kind === 'title') {
      s.addShape(pptx.ShapeType.ellipse, { x: 9.0, y: -1.8, w: 6.6, h: 6.6, fill: { color: T.accent, transparency: 82 }, line: { type: 'none' } })
      s.addShape(pptx.ShapeType.ellipse, { x: 10.6, y: 3.9, w: 4.4, h: 4.4, fill: { color: T.accent2, transparency: 86 }, line: { type: 'none' } })
    } else if (kind === 'section') {
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: T.accent, transparency: T.dark ? 88 : 80 }, line: { type: 'none' } })
      s.addShape(pptx.ShapeType.ellipse, { x: -1.6, y: 3.8, w: 5.4, h: 5.4, fill: { color: T.accent2, transparency: 80 }, line: { type: 'none' } })
    } else {
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.22, h: 7.5, fill: { color: T.accent }, line: { type: 'none' } })
    }
  }

  for (const [i, sl] of slides.entries()) {
    const s = pptx.addSlide({ masterName: 'DECK_BG' })
    base(s, sl.type)
    if (sl.type === 'title') {
      s.addShape(pptx.ShapeType.rect, { x: 0.9, y: 2.35, w: 1.1, h: 0.09, fill: { color: T.accent }, line: { type: 'none' } })
      s.addText(runs(sl.title).map((r) => ({ text: r.text, options: { bold: true } })), { x: 0.9, y: 2.6, w: 10.4, h: 2.3, fontSize: sl.title.length > 50 ? 38 : 48, fontFace: T.head, color: T.text, valign: 'top', margin: 0, fit: 'shrink' })
      if (sl.subtitle) s.addText(sl.subtitle, { x: 0.9, y: 5.0, w: 10.4, h: 1.2, fontSize: 22, fontFace: T.body, color: T.muted, valign: 'top', margin: 0 })
    } else if (sl.type === 'section') {
      s.addText(runs(sl.title).map((r) => ({ text: r.text, options: { bold: true } })), { x: 1.2, y: 2.6, w: 10.9, h: 2.0, fontSize: 44, fontFace: T.head, color: T.text, valign: 'middle', margin: 0, fit: 'shrink' })
      if (sl.subtitle) s.addText(sl.subtitle, { x: 1.2, y: 4.7, w: 10.9, h: 1.0, fontSize: 20, fontFace: T.body, color: T.muted, valign: 'top', margin: 0 })
    } else {
      if (sl.title) {
        s.addText(runs(sl.title).map((r) => ({ text: r.text, options: { bold: true } })), { x: 0.8, y: 0.4, w: 11.8, h: 1.0, fontSize: titleSize(sl.title), fontFace: T.head, color: T.text, valign: 'middle', margin: 0, fit: 'shrink' })
        s.addShape(pptx.ShapeType.rect, { x: 0.8, y: 1.5, w: 0.9, h: 0.06, fill: { color: T.accent }, line: { type: 'none' } })
      }
      const size = bodySize(sl)
      const body = []
      sl.items.forEach((it, k) => {
        const lvlSize = Math.max(12, size - it.level * 3)
        const last = k === sl.items.length - 1
        const para = { fontSize: lvlSize, fontFace: T.body, color: it.label ? T.accent : T.text, paraSpaceAfter: it.label ? 4 : 8, indentLevel: it.level }
        if (it.label) { Object.assign(para, { bold: true, fontSize: Math.max(14, size - 4) }) }
        else if (it.plain) { /* plain paragraph: no bullet */ }
        else if (it.num != null) {
          const prev = sl.items[k - 1]
          const cont = prev && prev.num != null && prev.level === it.level
          Object.assign(para, { bullet: cont ? { type: 'number' } : { type: 'number', numberStartAt: it.num } })
        } else Object.assign(para, { bullet: { indent: 22 } })
        const rs = runs(it.text)
        rs.forEach((r, j) => body.push({ text: r.text, options: { ...para, bold: para.bold || r.bold, italic: r.italic, ...(r.code ? { fontFace: 'Consolas' } : {}), breakLine: j === rs.length - 1 && !last ? true : false, ...(j ? { bullet: undefined } : {}) } }))
      })
      if (body.length) s.addText(body, { x: 0.8, y: 1.85, w: 11.7, h: 4.9, valign: 'top', margin: [0, 0, 0, 0], lineSpacingMultiple: 1.05, fit: 'shrink' })
    }
    if (footer && sl.type !== 'title') s.addText(footer, { x: 0.8, y: 6.95, w: 8, h: 0.3, fontSize: 11, fontFace: T.body, color: T.muted, margin: 0 })
    if (numbers && sl.type !== 'title') s.slideNumber = { x: 12.0, y: 6.95, w: 0.8, h: 0.3, fontSize: 11, fontFace: T.body, color: T.muted, align: 'right' }
    if (notes && sl.notes) s.addNotes(sl.notes)
    void i
  }
  return pptx.write({ outputType: 'blob' })
}
