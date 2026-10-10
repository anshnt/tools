// Export: PNG images, PDF and PPTX. PNG and PDF rasterise the same DOM the editor shows (SVG foreignObject -> canvas),
// so they match the screen exactly. PPTX is built from the model with PptxGenJS, then transitions are added to the XML.
import { pptxgen, pdfLib, jszip } from '../../lib/libs.js'
import { yieldToMain } from '../../lib/ui.js'
import { zip, safeName } from '../../lib/files.js'
import { renderSlide } from './_render.js'
import { colorOf, fontOf, bgOf, decorOf } from './_themes.js'
import { SLIDE_CSS } from './_styles.js'
import { isTextual } from './_model.js'

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

/** Draw one slide to a canvas `width` px wide. */
export async function slideToCanvas(store, slide, width = 1920) {
  const deck = store.deck
  const urls = new Map()
  for (const e of slide.elements) if (e.asset && !urls.has(e.asset)) urls.set(e.asset, await store.dataUrl(e.asset))
  const node = renderSlide(deck, slide, { mode: 'export', url: (id) => urls.get(id) })
  const xhtml = new XMLSerializer().serializeToString(node)
  const k = width / deck.w
  const W = Math.round(deck.w * k), H = Math.round(deck.h * k)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${deck.w} ${deck.h}"><foreignObject x="0" y="0" width="${deck.w}" height="${deck.h}"><style xmlns="http://www.w3.org/1999/xhtml">${esc(SLIDE_CSS)}</style>${xhtml}</foreignObject></svg>`
  // A data: URL keeps the canvas origin-clean in Chromium (a blob: URL would taint it and block toBlob)
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  try { await img.decode() } catch { throw new Error('This browser could not draw the slide to an image. Try Chrome, Edge or Firefox.') }
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  c.getContext('2d').drawImage(img, 0, 0, W, H)
  return c
}
const canvasBlob = (c, type = 'image/png', q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the slide image.'))), type, q))

// ---------- PNG ----------
export async function exportPngs(store, which = 'current', { width = 1920, onProgress } = {}) {
  const slides = which === 'all' ? store.deck.slides : [store.slide]
  const out = []
  for (let i = 0; i < slides.length; i++) {
    onProgress?.(i / slides.length, `Slide ${i + 1} of ${slides.length}`)
    const c = await slideToCanvas(store, slides[i], width)
    const idx = which === 'all' ? i + 1 : store.cur + 1
    out.push({ name: `${safeName(store.deck.title)}-${String(idx).padStart(2, '0')}.png`, data: await canvasBlob(c) })
    await yieldToMain()
  }
  if (out.length === 1) return { blob: out[0].data, name: out[0].name }
  return { blob: await zip(out), name: `${safeName(store.deck.title)}-slides.zip` }
}

// ---------- PDF ----------
export async function exportPdf(store, { width = 1920, onProgress } = {}) {
  const { PDFDocument, StandardFonts } = await pdfLib()
  const deck = store.deck
  const pdf = await PDFDocument.create()
  pdf.setTitle(deck.title)
  pdf.setCreator('Slides Studio')
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const allowed = new Set(font.getCharacterSet())
  const clean = (t) => [...t].map((ch) => (allowed.has(ch.codePointAt(0)) ? ch : ch === '–' || ch === '−' ? '-' : ch.charCodeAt(0) < 128 ? ch : '')).join('')
  for (let i = 0; i < deck.slides.length; i++) {
    onProgress?.(i / deck.slides.length, `Slide ${i + 1} of ${deck.slides.length}`)
    const slide = deck.slides[i]
    const c = await slideToCanvas(store, slide, width)
    const img = await pdf.embedJpg(new Uint8Array(await (await canvasBlob(c, 'image/jpeg', 0.92)).arrayBuffer()))
    const page = pdf.addPage([deck.w, deck.h])
    page.drawImage(img, { x: 0, y: 0, width: deck.w, height: deck.h })
    // invisible text on top of the image so the PDF is searchable and the text can be copied
    for (const e of slide.elements) {
      if (!isTextual(e) || !e.tx) continue
      let y = e.y + (e.tx.pad ?? 8)
      for (const p of e.tx.paras) {
        const size = Math.max(4, p.runs.find((r) => r.s)?.s || e.tx.size)
        const text = clean(p.runs.map((r) => r.t).join('').replace(/\n/g, ' '))
        const lh = size * 1.2 * (e.tx.lh || 1)
        if (text.trim()) {
          try { page.drawText(text, { x: e.x + (e.tx.pad ?? 8), y: deck.h - y - size, size, font, opacity: 0, maxWidth: Math.max(20, e.w - (e.tx.pad ?? 8) * 2), lineHeight: lh }) } catch { /* unencodable text stays image-only */ }
        }
        y += lh * Math.max(1, Math.ceil((text.length * size * 0.5) / Math.max(20, e.w - (e.tx.pad ?? 8) * 2))) + (e.tx.ps || 0)
      }
    }
    await yieldToMain()
  }
  onProgress?.(1, 'Saving')
  const bytes = await pdf.save()
  return { blob: new Blob([bytes], { type: 'application/pdf' }), name: `${safeName(deck.title)}.pdf` }
}

// ---------- PPTX ----------
const TRANSITION_XML = {
  fade: '<p:transition spd="med"><p:fade/></p:transition>',
  slide: '<p:transition spd="med"><p:push dir="l"/></p:transition>',
  zoom: '<p:transition spd="med"><p:zoom dir="in"/></p:transition>',
}

async function loadImg(blob) {
  const url = URL.createObjectURL(blob)
  try { const img = new Image(); img.src = url; await img.decode(); return img } finally { URL.revokeObjectURL(url) }
}
/** Bake cover-cropping and rounded corners into the bitmap, because PowerPoint crops differently. */
async function bakeImage(store, e) {
  const a = store.asset(e.asset)
  const needs = e.fit === 'cover' || e.rad > 0
  if (!needs) return { data: await store.dataUrl(e.asset), x: e.x, y: e.y, w: e.w, h: e.h }
  const img = await loadImg(a.blob)
  const iw = img.naturalWidth, ih = img.naturalHeight
  const boxR = e.w / e.h
  let sx = 0, sy = 0, sw = iw, sh = ih, ox = 0, oy = 0, ow = e.w, oh = e.h
  if (e.fit === 'cover') { if (iw / ih > boxR) { sw = ih * boxR; sx = (iw - sw) / 2 } else { sh = iw / boxR; sy = (ih - sh) / 2 } }
  else if (e.fit === 'contain') { const r = iw / ih; if (r > boxR) { oh = e.w / r; oy = (e.h - oh) / 2 } else { ow = e.h * r; ox = (e.w - ow) / 2 } }
  const k = Math.max(0.5, Math.min(4, sw / ow))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(ow * k)); c.height = Math.max(1, Math.round(oh * k))
  const ctx = c.getContext('2d')
  if (e.rad > 0) {
    const r = Math.min(e.rad * k, c.width / 2, c.height / 2), w = c.width, hh = c.height
    ctx.beginPath()
    ctx.moveTo(r, 0); ctx.arcTo(w, 0, w, hh, r); ctx.arcTo(w, hh, 0, hh, r); ctx.arcTo(0, hh, 0, 0, r); ctx.arcTo(0, 0, w, 0, r); ctx.closePath()
    ctx.clip()
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height)
  const blob = await canvasBlob(c, 'image/png')
  const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob) })
  return { data, x: e.x + ox, y: e.y + oy, w: ow, h: oh }
}

export async function exportPptx(store, { onProgress } = {}) {
  const PptxGenJS = await pptxgen()
  const deck = store.deck
  const pptx = new PptxGenJS()
  const gradients = new Map()
  pptx.defineLayout({ name: 'STUDIO', width: deck.w / 72, height: deck.h / 72 })
  pptx.layout = 'STUDIO'
  pptx.title = deck.title
  pptx.company = 'Slides Studio'
  const inch = (v) => +(v / 72).toFixed(4)
  const hex = (v, fb = '000000') => (colorOf(deck, v, '#' + fb).replace('#', '').toUpperCase())
  const shapeName = (n) => pptx.ShapeType?.[n] || n
  const dash = (d) => (d === 'dash' ? 'dash' : d === 'dot' ? 'sysDot' : 'solid')
  const transp = (op) => Math.round((1 - (op ?? 1)) * 100)

  const runsFor = (e) => {
    const tx = e.tx
    const out = []
    tx.paras.forEach((p, pi) => {
      const runs = p.runs.length ? p.runs : [{ t: '' }]
      const size = runs.find((r) => r.s)?.s || tx.size
      runs.forEach((r, ri) => {
        const o = {
          bold: r.b ?? !!tx.b, italic: r.i ?? !!tx.i, color: hex(r.c || tx.color), fontSize: r.s || tx.size, fontFace: fontOf(deck, r.f || tx.font),
          align: p.a || tx.a || 'left', paraSpaceAfter: tx.ps || 0, lineSpacingMultiple: tx.lh || 1,
        }
        if (r.u) o.underline = { style: 'sng' }
        if (r.hl) o.highlight = hex(r.hl)
        if (p.bu) { o.bullet = p.bu === 'num' ? { type: 'number', indent: Math.round(size * 1.5) } : { indent: Math.round(size * 1.1) }; if (p.lv) o.indentLevel = p.lv }
        if (ri === runs.length - 1 && pi < tx.paras.length - 1) o.breakLine = true
        out.push({ text: r.t.replace(/\n/g, ' '), options: o })
      })
    })
    return out
  }
  const hasText = (e) => e.tx && e.tx.paras.some((p) => p.runs.some((r) => r.t))

  const addShape = (s, e) => {
    const opts = {
      x: inch(e.x), y: inch(e.y), w: inch(e.w), h: inch(e.h), rotate: e.rot || 0,
      fill: e.fill ? { color: hex(e.fill), transparency: transp(e.op) } : { type: 'none' },
      line: e.stroke && e.sw ? { color: hex(e.stroke), width: e.sw, dashType: dash(e.dash), transparency: transp(e.op) } : { type: 'none' },
    }
    if (e.shape === 'roundRect') opts.rectRadius = (e.rad * Math.min(e.w, e.h)) / 72
    if (hasText(e)) {
      s.addText(runsFor(e), { ...opts, shape: shapeName(e.shape), valign: e.tx.va || 'middle', margin: e.tx.pad ?? 8, fit: 'none', wrap: true })
    } else s.addShape(shapeName(e.shape), opts)
  }

  for (let i = 0; i < deck.slides.length; i++) {
    onProgress?.(i / deck.slides.length, `Slide ${i + 1} of ${deck.slides.length}`)
    const slide = deck.slides[i]
    const s = pptx.addSlide()
    const bg = bgOf(deck, slide)
    if (bg.c2) { s.background = { data: GRADIENT_PLACEHOLDER }; gradients.set(i, bg) }
    else s.background = { color: bg.c1.replace('#', '').toUpperCase() }
    for (const d of decorOf(deck, slide)) addShape(s, d)
    for (const e of slide.elements) {
      if (e.type === 'shape') addShape(s, e)
      else if (e.type === 'text') {
        if (!hasText(e) && !e.fill && !(e.stroke && e.sw)) continue
        const o = { x: inch(e.x), y: inch(e.y), w: inch(e.w), h: inch(e.h), rotate: e.rot || 0, valign: e.tx.va || 'top', margin: e.tx.pad ?? 8, wrap: true, fit: 'none' }
        if (e.fill) o.fill = { color: hex(e.fill), transparency: transp(e.op) }
        if (e.stroke && e.sw) o.line = { color: hex(e.stroke), width: e.sw }
        s.addText(runsFor(e), o)
      } else if (e.type === 'line') {
        s.addShape(shapeName('line'), {
          x: inch(e.x), y: inch(e.y), w: inch(e.w), h: inch(e.h), flipH: !!e.fh, flipV: !!e.fv,
          line: { color: hex(e.stroke), width: e.sw, dashType: dash(e.dash), beginArrowType: e.as ? 'triangle' : undefined, endArrowType: e.ae ? 'triangle' : undefined, transparency: transp(e.op) },
        })
      } else if (e.type === 'image' && e.asset && store.asset(e.asset)) {
        const b = await bakeImage(store, e)
        s.addImage({ data: b.data.replace(/^data:/, ''), x: inch(b.x), y: inch(b.y), w: inch(b.w), h: inch(b.h), rotate: e.rot || 0, altText: e.alt || undefined, transparency: transp(e.op) })
        if (e.stroke && e.sw) s.addShape(shapeName('rect'), { x: inch(e.x), y: inch(e.y), w: inch(e.w), h: inch(e.h), rotate: e.rot || 0, fill: { type: 'none' }, line: { color: hex(e.stroke), width: e.sw } })
      } else if (e.type === 'table') {
        const rows = e.cells.map((row, r) => row.map((cell) => {
          const head = e.hdr && r === 0
          const band = e.band && !head && (r - (e.hdr ? 1 : 0)) % 2 === 1
          const o = { bold: head, color: hex(head ? '@onAccent' : '@text'), fontSize: e.size || 18, fontFace: fontOf(deck, '@body'), align: e.a || 'left', valign: 'middle' }
          if (head) o.fill = { color: hex('@accent') }
          else if (band) o.fill = { color: hex('@surface') }
          return { text: String(cell ?? ''), options: o }
        }))
        const tot = e.colw.reduce((a, b) => a + b, 0) || 1
        s.addTable(rows, { x: inch(e.x), y: inch(e.y), w: inch(e.w), h: inch(e.h), colW: e.colw.map((w) => inch((e.w * w) / tot)), rowH: Array(rows.length).fill(inch(e.h / rows.length)), border: { type: 'solid', pt: 1, color: hex('@muted') }, margin: 0.08 })
      }
    }
    if (slide.notes) s.addNotes(slide.notes)
    await yieldToMain()
  }
  onProgress?.(1, 'Packing the file')
  let blob = await pptx.write({ outputType: 'blob' })
  if (!(blob instanceof Blob)) blob = new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
  if (gradients.size || deck.slides.some((s) => TRANSITION_XML[s.tr])) blob = await postProcess(blob, deck, gradients)
  return { blob, name: `${safeName(deck.title)}.pptx` }
}

const GRADIENT_PLACEHOLDER = 'image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const hex6 = (c) => c.replace('#', '').toUpperCase()
const gradientXml = (bg) => `<p:bg><p:bgPr><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="${hex6(bg.c1)}"/></a:gs><a:gs pos="100000"><a:srgbClr val="${hex6(bg.c2)}"/></a:gs></a:gsLst><a:lin ang="${Math.round((((bg.ang - 90) % 360) + 360) % 360 * 60000)}" scaled="0"/></a:gradFill><a:effectLst/></p:bgPr></p:bg>`

/** PptxGenJS has no transitions or gradient backgrounds, so add them to the slide XML afterwards. */
async function postProcess(blob, deck, gradients) {
  const JSZip = await jszip()
  const z = await JSZip.loadAsync(blob)
  for (let i = 0; i < deck.slides.length; i++) {
    const f = z.file(`ppt/slides/slide${i + 1}.xml`)
    if (!f) continue
    let src = await f.async('string')
    const grad = gradients.get(i), tr = TRANSITION_XML[deck.slides[i].tr]
    if (!grad && !tr) continue
    if (grad) src = /<p:bg>[\s\S]*?<\/p:bg>/.test(src) ? src.replace(/<p:bg>[\s\S]*?<\/p:bg>/, gradientXml(grad)) : src.replace('<p:cSld>', `<p:cSld>${gradientXml(grad)}`)
    if (tr && !src.includes('<p:transition')) src = src.includes('<p:timing') ? src.replace('<p:timing', `${tr}<p:timing`) : src.replace('</p:sld>', `${tr}</p:sld>`)
    z.file(`ppt/slides/slide${i + 1}.xml`, src)
  }
  return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', compression: 'DEFLATE' })
}
