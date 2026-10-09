// A small sample PDF built in the browser so every tool can be tried without a file of your own.
// kinds: 'general' (12 pages: chapters, blank pages, a repeated page, a landscape page, an image, links),
//        'scrambled' (8 pages out of order with printed numbers), 'duplex' (4 fronts then 4 backs, backs reversed).
import { pdfLib } from '../../lib/libs.js'
import { savePdf } from '../../lib/pdf.js'

const LOREM = [
  'Every tool on this site works on your own device, so your files stay private.',
  'This sample page only exists to give the tools something real to work on.',
  'Try changing the options and watch the preview update as you go.',
  'Pages, text, shapes and an image are all drawn with plain PDF operators.',
  'When you are done, drop in one of your own PDFs to use the real thing.',
]
const BANDS = [[0.39, 0.4, 0.95], [0.66, 0.33, 0.97], [0.93, 0.28, 0.6], [0.98, 0.45, 0.09]]

async function makePicture() {
  const c = document.createElement('canvas')
  c.width = 720; c.height = 440
  const x = c.getContext('2d')
  const g = x.createLinearGradient(0, 0, 720, 440)
  g.addColorStop(0, '#6366f1'); g.addColorStop(0.45, '#a855f7'); g.addColorStop(0.75, '#ec4899'); g.addColorStop(1, '#f97316')
  x.fillStyle = g; x.fillRect(0, 0, 720, 440)
  x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = 8
  for (let i = 0; i < 4; i++) { x.beginPath(); x.arc(360, 220, 50 + i * 42, 0, Math.PI * 2); x.stroke() }
  x.fillStyle = 'rgba(255,255,255,.9)'; x.font = '700 40px system-ui, sans-serif'; x.fillText('Sample picture', 36, 70)
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

export async function samplePdf(kind = 'general') {
  const { PDFDocument, StandardFonts, rgb, PDFName, PDFString, PDFNumber, PDFHexString } = await pdfLib()
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const A4 = [595.28, 841.89]
  const png = kind === 'general' ? await doc.embedPng(await makePicture()) : null
  const ctx = doc.context
  const N = (s) => PDFName.of(s)

  const addLink = (page, rect, action) => {
    const a = ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0] })
    a.set(N('A'), ctx.obj(action))
    const ref = ctx.register(a)
    const prev = page.node.get(N('Annots'))
    if (prev) ctx.lookup(prev).push(ref)
    else page.node.set(N('Annots'), ctx.obj([ref]))
  }

  const draw = (spec, n) => {
    const size = spec.landscape ? [A4[1], A4[0]] : A4
    const page = doc.addPage(size)
    const [w, h] = size
    if (spec.blank) return page
    const band = BANDS[(spec.band ?? 0) % BANDS.length]
    page.drawRectangle({ x: 0, y: h - 110, width: w, height: 110, color: rgb(...band) })
    page.drawText(spec.title, { x: 40, y: h - 68, size: spec.big ? 36 : 26, font: bold, color: rgb(1, 1, 1) })
    if (spec.sub) page.drawText(spec.sub, { x: 40, y: h - 92, size: 12, font, color: rgb(1, 1, 1), opacity: 0.85 })
    let y = h - 150
    for (const line of spec.lines || LOREM) { page.drawText(line, { x: 40, y, size: 12, font, color: rgb(0.15, 0.15, 0.2) }); y -= 22 }
    if (spec.bars) spec.bars.forEach((v, i) => {
      page.drawRectangle({ x: 60 + i * 70, y: 140, width: 44, height: v * 3.2, color: rgb(...BANDS[i % 4]) })
      page.drawText(String(v), { x: 70 + i * 70, y: 146 + v * 3.2, size: 11, font: bold, color: rgb(0.2, 0.2, 0.25) })
    })
    if (spec.picture) page.drawImage(png, { x: 40, y: 70, width: 360, height: 220 })
    if (spec.links) {
      const base = y - 10
      page.drawText('Visit https://example.com/tools for more.', { x: 40, y: base, size: 12, font, color: rgb(0.1, 0.3, 0.9) })
      addLink(page, [40, base - 3, 290, base + 12], { S: 'URI', URI: PDFString.of('https://example.com/tools') })
      page.drawText('Write to hello@example.com with questions.', { x: 40, y: base - 24, size: 12, font, color: rgb(0.1, 0.3, 0.9) })
      addLink(page, [40, base - 27, 300, base - 12], { S: 'URI', URI: PDFString.of('mailto:hello@example.com') })
      page.drawText('A web address that is only text: https://example.org/not-clickable', { x: 40, y: base - 48, size: 12, font, color: rgb(0.15, 0.15, 0.2) })
    }
    page.drawText(String(spec.printed ?? n), { x: w / 2 - 4, y: 28, size: 10, font, color: rgb(0.45, 0.45, 0.5) })
    return page
  }

  let specs, outline = null
  if (kind === 'scrambled') {
    const order = [3, 1, 4, 2, 6, 5, 8, 7]
    specs = order.map((p) => ({ title: `Chapter page ${p}`, band: p, printed: p, sub: `This page is number ${p}`, lines: LOREM }))
  } else if (kind === 'duplex') {
    specs = [1, 2, 3, 4].map((p) => ({ title: `Front ${p}`, band: p, printed: '', sub: 'Scanned side: front', lines: LOREM }))
      .concat([4, 3, 2, 1].map((p) => ({ title: `Back ${p}`, band: p + 1, printed: '', sub: 'Scanned side: back (stack flipped over)', lines: LOREM })))
  } else {
    const same = { title: 'Quarterly numbers', band: 1, lines: ['Revenue grew in every region this quarter.', 'Costs stayed flat while headcount held steady.', 'The chart below shows the four regions.'], bars: [64, 82, 47, 90] }
    specs = [
      { title: 'Sample document', sub: 'A made-up PDF to try the tools with', band: 0, big: true },
      { title: 'Welcome', band: 0 },
      same,
      { title: 'Page sizes', band: 1, sub: 'Chapter 2' },
      { blank: true },
      same,
      { title: 'Images and links', band: 2, landscape: true, picture: true, sub: 'Chapter 3 (a landscape page)' },
      { title: 'Links', band: 2, links: true },
      { title: 'More detail', band: 2 },
      { title: 'Wrap up', band: 3, sub: 'Chapter 4' },
      { blank: true },
      { title: 'The end', band: 3 },
    ]
    outline = [[0, 'Welcome', [[2, 'Quarterly numbers', []]]], [3, 'Page sizes', []], [6, 'Images and links', [[7, 'Links', []]]], [9, 'Wrap up', []]]
  }
  specs.forEach((s, i) => draw(s, i + 1))

  if (outline) {
    const pages = doc.getPages()
    const build = (items, parent) => {
      const refs = items.map(() => ctx.nextRef())
      items.forEach(([pg, title, kids], i) => {
        const d = ctx.obj({})
        d.set(N('Title'), PDFHexString.fromText(title)); d.set(N('Parent'), parent)
        if (i > 0) d.set(N('Prev'), refs[i - 1])
        if (i < items.length - 1) d.set(N('Next'), refs[i + 1])
        d.set(N('Dest'), ctx.obj([pages[pg].ref, N('XYZ'), null, null, null]))
        if (kids.length) { const c = build(kids, refs[i]); d.set(N('First'), c.first); d.set(N('Last'), c.last); d.set(N('Count'), PDFNumber.of(kids.length)) }
        ctx.assign(refs[i], d)
      })
      return { first: refs[0], last: refs.at(-1) }
    }
    const root = ctx.nextRef()
    const c = build(outline, root)
    const rd = ctx.obj({ Type: 'Outlines' })
    rd.set(N('First'), c.first); rd.set(N('Last'), c.last); rd.set(N('Count'), PDFNumber.of(outline.reduce((a, o) => a + 1 + o[2].length, 0)))
    ctx.assign(root, rd)
    doc.catalog.set(N('Outlines'), root)
  }
  doc.setTitle(kind === 'general' ? 'Sample document' : 'Sample pages')
  const blob = await savePdf(doc)
  return new File([blob], kind === 'general' ? 'sample.pdf' : `sample-${kind}.pdf`, { type: 'application/pdf' })
}
