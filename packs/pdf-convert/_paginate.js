// HTML -> paginated PDF in the browser. The HTML is laid out in a hidden same-origin iframe at the printable width, page breaks are chosen so
// lines, images and table rows are never cut in half (headings stay with the paragraph after them), every page is rendered with html2canvas
// and placed in the PDF, and an invisible text layer plus link annotations are added so the result stays searchable and clickable.
import { pdfLib, html2canvas as h2cLib } from '../../lib/libs.js'
import { MAX_PIXELS } from '../../lib/image.js'
import { PAGE_SIZES } from '../../lib/pdf.js'
import { createFontSet } from './_fonts.js'

export const PX = 96 / 72 // CSS pixels per point
export const MM = 72 / 25.4

export const abortErr = () => Object.assign(new Error('Cancelled'), { code: 'ABORT' })
export const tick = () => new Promise((r) => setTimeout(r, 0))

/**
 * Create a hidden iframe holding `html` at `widthPx` wide. Scripts never run (sandbox without allow-scripts).
 * -> {iframe, doc, win, destroy()}
 */
export async function makeFrame(html, widthPx) {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-same-origin')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.tabIndex = -1
  iframe.style.cssText = `position:fixed;left:-20000px;top:0;width:${widthPx}px;height:1200px;border:0;visibility:hidden;pointer-events:none`
  iframe.srcdoc = html
  document.body.append(iframe)
  await new Promise((res, rej) => { iframe.onload = res; iframe.onerror = () => rej(new Error('Could not lay out the document.')) })
  const frame = { iframe, doc: iframe.contentDocument, win: iframe.contentWindow, destroy: () => iframe.remove() }
  await settle(frame.doc)
  return frame
}

/** Wait for web fonts and images so measurements are final. */
export async function settle(doc) {
  const imgs = [...doc.images]
  await Promise.race([Promise.all([doc.fonts?.ready, ...imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r })))]), new Promise((r) => setTimeout(r, 8000))])
  await tick()
}

/** Measure the document: text lines and other unbreakable boxes (atoms), words with positions, links and forced page breaks. All y values are CSS px from the top of the root element. */
export function measure(root) {
  const doc = root.ownerDocument, win = doc.defaultView
  const base = root.getBoundingClientRect()
  const top0 = base.top, left0 = base.left
  const atoms = [], words = [], links = [], forced = []
  let maxBottom = 0
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (n.nodeType === 1) {
        const cs = win.getComputedStyle(n)
        if (cs.display === 'none' || /^(SCRIPT|STYLE|HEAD|TEMPLATE|NOSCRIPT)$/.test(n.tagName)) return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  const hiddenCache = new WeakMap()
  const hidden = (el) => {
    if (!el) return false
    if (!hiddenCache.has(el)) { const cs = win.getComputedStyle(el); hiddenCache.set(el, cs.visibility === 'hidden' || cs.opacity === '0') }
    return hiddenCache.get(el)
  }
  let node
  while ((node = walker.nextNode())) {
    if (node.nodeType === 1) {
      const cs = win.getComputedStyle(node)
      const tag = node.tagName
      const r = node.getBoundingClientRect()
      if (node !== root && node.tagName !== 'BODY' && cs.position !== 'fixed' && r.height > 0) maxBottom = Math.max(maxBottom, r.bottom - top0)
      if (/^(IMG|SVG|CANVAS|VIDEO|HR|TR|FIGURE|PRE|BLOCKQUOTE)$/.test(tag) || cs.breakInside === 'avoid' || cs.pageBreakInside === 'avoid') {
        if (r.height > 0 && !(tag === 'PRE' && r.height > 520) && !(tag === 'BLOCKQUOTE' && r.height > 300)) atoms.push({ top: r.top - top0, bottom: r.bottom - top0, heading: false })
      }
      if (cs.breakBefore === 'page' || cs.breakBefore === 'always' || cs.pageBreakBefore === 'always') { if (r.top - top0 > 2) forced.push(r.top - top0) }
      if (tag === 'A' && node.getAttribute('href')) {
        const href = node.href
        if (/^(https?:|mailto:|tel:)/i.test(href)) for (const rc of node.getClientRects()) if (rc.width > 1) links.push({ x: rc.left - left0, top: rc.top - top0, w: rc.width, h: rc.height, href })
      }
      continue
    }
    const text = node.nodeValue
    if (!text || !text.trim()) continue
    const el = node.parentElement
    if (!el || hidden(el)) continue
    const heading = !!el.closest('h1,h2,h3,h4,h5,h6')
    const range = doc.createRange()
    range.selectNodeContents(node)
    const seen = new Set()
    for (const rc of range.getClientRects()) {
      if (rc.height < 1) continue
      const k = `${Math.round(rc.top)}:${Math.round(rc.bottom)}`
      if (seen.has(k)) continue
      seen.add(k)
      atoms.push({ top: rc.top - top0, bottom: rc.bottom - top0, heading })
    }
    const size = parseFloat(win.getComputedStyle(el).fontSize) || 16
    const re = /\S+/g
    let m
    while ((m = re.exec(text))) {
      range.setStart(node, m.index)
      range.setEnd(node, m.index + m[0].length)
      const rects = range.getClientRects()
      if (rects.length !== 1) continue
      const rc = rects[0]
      if (rc.width < 0.5 || rc.height < 1) continue
      words.push({ text: m[0], x: rc.left - left0, top: rc.top - top0, w: rc.width, h: rc.height, size, heading })
    }
  }
  atoms.sort((a, b) => a.top - b.top)
  forced.sort((a, b) => a - b)
  let wordsBottom = 0
  for (const w of words) wordsBottom = Math.max(wordsBottom, w.top + w.h)
  const contentBottom = Math.max(maxBottom, wordsBottom) + (parseFloat(win.getComputedStyle(doc.body || root).paddingBottom) || 0)
  return { atoms, words, links, forced, height: Math.max(40, Math.ceil(contentBottom)) }
}

/** Choose page boundaries (CSS px) so no atom is cut. `firstH` lets the first page be shorter or longer than the rest. */
export function choosePages(m, pageH, firstH = pageH) {
  const pages = []
  let start = 0
  const total = m.height
  let guard = 0
  while (start < total - 1 && guard++ < 5000) {
    const ph = pages.length ? pageH : firstH
    const limit = start + ph
    if (total - start <= ph + 0.5) { pages.push([start, total]); break }
    const forced = m.forced.find((f) => f > start + 4 && f <= limit)
    let end
    if (forced) end = forced
    else {
      let cut = limit
      for (let i = 0; i < 8; i++) {
        const straddle = m.atoms.filter((a) => a.top < cut - 0.5 && a.bottom > cut + 0.5 && a.top > start + 2)
        if (!straddle.length) break
        cut = Math.min(cut, ...straddle.map((a) => a.top))
      }
      // keep a heading with the text that follows it
      const above = m.atoms.filter((a) => a.bottom <= cut + 0.5 && a.bottom > start + 2)
      const last = above[above.length - 1]
      if (last?.heading && last.top > start + ph * 0.25) {
        const group = above.filter((a) => a.heading && a.bottom > last.top - 4)
        cut = Math.min(cut, ...group.map((a) => a.top))
      }
      end = cut - start < ph * 0.3 ? limit : cut
    }
    pages.push([start, end])
    start = end
  }
  // a last page with nothing on it (only bottom padding) is dropped
  while (pages.length > 1) {
    const [s0] = pages[pages.length - 1]
    if (m.atoms.some((a) => a.top >= s0 - 1) || m.forced.some((f) => f >= s0 - 1)) break
    pages.pop()
  }
  return pages.length ? pages : [[0, total || pageH]]
}

/** Vertical ranges (CSS px from the root's top) of pictures, so photo pages can be stored as JPEG and text pages as PNG. */
export function mediaRanges(root) {
  const top0 = root.getBoundingClientRect().top
  return [...root.querySelectorAll('img,svg,canvas,video')].map((el) => { const r = el.getBoundingClientRect(); return [r.top - top0, r.bottom - top0] }).filter(([a, b]) => b > a)
}
export const hasMediaIn = (ranges, s, e) => ranges.some(([a, b]) => b > s && a < e)

const toU8 = async (canvas, type, q) => {
  const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode a page image.'))), type, q))
  return new Uint8Array(await blob.arrayBuffer())
}

/** html2canvas a vertical slice [y0, y1) (CSS px) of `root`, `width` px wide, at `scale`. */
export async function renderRange(root, y0, y1, { width, scale, windowHeight }) {
  const h2c = await h2cLib()
  const rb = root.getBoundingClientRect(), win = root.ownerDocument.defaultView
  return h2c(root, { x: rb.left + win.scrollX, y: rb.top + win.scrollY + y0, width: Math.ceil(width), height: Math.max(1, Math.ceil(y1 - y0)), scale, windowWidth: Math.ceil(width), windowHeight: Math.ceil(windowHeight), backgroundColor: '#ffffff', logging: false, useCORS: true, imageTimeout: 8000 })
}

/** Cut a canvas into a page image and encode it (JPEG when the page has pictures, PNG otherwise because flat text compresses better). */
export async function canvasSlice(chunk, sy, sh, { jpeg }) {
  const c = document.createElement('canvas')
  c.width = chunk.width; c.height = sh
  const g = c.getContext('2d')
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height)
  g.drawImage(chunk, 0, sy, chunk.width, sh, 0, 0, chunk.width, sh)
  const bytes = await toU8(c, jpeg ? 'image/jpeg' : 'image/png', 0.9)
  c.width = c.height = 0
  return { bytes, jpeg }
}

/**
 * A PDF being assembled from page images. addPage({W, H, image: {bytes, jpeg}, x, y, w, h, words, links, label}) places the image at (x, y from the
 * page top) and adds invisible text (words: {text, x, y baseline, size, w} in points from the top-left) and link annotations.
 */
export async function createPdfBuilder({ title = '', allText = '', textLayer = true } = {}) {
  const lib = await pdfLib()
  const { PDFDocument, rgb, StandardFonts, PDFString, PDFOperator, PDFNumber, beginText, endText, setFontAndSize, moveText, showText, setTextRenderingMode, pushGraphicsState, popGraphicsState } = lib
  const doc = await PDFDocument.create()
  if (title) doc.setTitle(title)
  doc.setProducer('Tools (browser)')
  const helv = await doc.embedFont(StandardFonts.Helvetica)
  let layerRuns = null
  if (textLayer && allText) {
    const set = new Set(helv.getCharacterSet())
    if ([...allText].every((ch) => set.has(ch.codePointAt(0)) || /\s/.test(ch))) layerRuns = (t) => [{ text: t, font: helv }]
    else {
      const fs = await createFontSet(doc, { family: 'sans', text: allText })
      layerRuns = (t) => { const rs = fs.runs(t); return rs.some((r) => r.font.complex) || (rs.some((r) => r.text.includes('?')) && !t.includes('?')) ? null : rs }
    }
  }
  let words = 0, linkCount = 0
  return {
    doc,
    get pageCount() { return doc.getPageCount() },
    stats: () => ({ words, links: linkCount }),
    async addPage({ W, H, image, x, y, w, h, words: ws = [], links = [], label }) {
      const page = doc.addPage([W, H])
      const img = image.jpeg ? await doc.embedJpg(image.bytes) : await doc.embedPng(image.bytes)
      page.drawImage(img, { x, y: H - y - h, width: w, height: h })
      if (layerRuns) {
        for (const wd of ws) {
          const runs = layerRuns(wd.text)
          if (!runs) continue
          const sz = Math.max(1, wd.size)
          let cx = wd.x
          const natural = runs.reduce((a, r) => a + r.font.widthOfTextAtSize(r.text, sz), 0) || 1
          const tz = Math.max(20, Math.min(400, (wd.w / natural) * 100))
          for (let ri = 0; ri < runs.length; ri++) {
            const r = runs[ri]
            const shown = ri === runs.length - 1 ? `${r.text} ` : r.text // a trailing space keeps copied text from running words together
            try {
              const rf = page.node.newFontDictionary(r.font.name, r.font.ref)
              page.pushOperators(pushGraphicsState(), beginText(), setFontAndSize(rf, sz), PDFOperator.of('Tz', [PDFNumber.of(tz)]), setTextRenderingMode(3), moveText(cx, H - wd.y), showText(r.font.encodeText(shown)), endText(), popGraphicsState())
              words++
            } catch { /* glyph not encodable: skip */ }
            cx += r.font.widthOfTextAtSize(r.text, sz) * (tz / 100)
          }
        }
      }
      for (const l of links) {
        const annot = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [l.x, H - l.y - l.h, l.x + l.w, H - l.y], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(l.href) } })
        page.node.addAnnot(doc.context.register(annot))
        linkCount++
      }
      if (label) {
        const wl = helv.widthOfTextAtSize(label, 9)
        page.drawText(label, { x: (W - wl) / 2, y: 16, size: 9, font: helv, color: rgb(0.5, 0.5, 0.55) })
      }
    },
    save: () => doc.save({ useObjectStreams: true }),
  }
}

/**
 * paginate(root, {size, orient, margin: {t,r,b,l} in pt, scale, layoutPx, singlePage, pageNumbers, textLayer, title, onProgress, signal}) -> {bytes, pages, words, links}
 * root is an element inside an iframe made by makeFrame(). layoutPx is the width the document was laid out at (defaults to the printable width;
 * a larger value shrinks the page to fit, like printing a desktop page).
 */
export async function paginate(root, { size = 'A4', orient = 'portrait', margin = { t: 56, r: 56, b: 56, l: 56 }, scale = 2, layoutPx, singlePage = false, pageNumbers = false, textLayer = true, title = '', onProgress, signal, jpeg = false } = {}) {
  let [W, H] = PAGE_SIZES[size] || PAGE_SIZES.A4
  if (orient === 'landscape') [W, H] = [H, W]
  const contentWpt = W - margin.l - margin.r
  const pxW = Math.ceil(contentWpt * PX)
  const L = layoutPx || pxW
  const k = pxW / L // layout px -> printable px
  onProgress?.(0.02, 'Measuring the layout')
  await tick()
  const m = measure(root)
  let pages
  if (singlePage) {
    const hPt = margin.t + margin.b + (m.height * k) / PX
    if (hPt <= 14400) { H = Math.max(hPt, 100); pages = [[0, m.height]] }
  }
  if (!pages) pages = choosePages(m, ((H - margin.t - margin.b) * PX) / k)
  if (signal?.aborted) throw abortErr()
  const media = mediaRanges(root)
  const builder = await createPdfBuilder({ title, allText: m.words.map((w) => w.text).join(' '), textLayer })
  const sr = scale * k // html2canvas scale
  const maxChunk = Math.max(1, Math.floor((MAX_PIXELS * 0.7) / (L * sr * sr)))
  const toPt = (v) => (v * k) / PX
  let i = 0
  while (i < pages.length) {
    let j = i
    while (j + 1 < pages.length && pages[j + 1][1] - pages[i][0] <= maxChunk) j++
    const cStart = pages[i][0], cEnd = pages[j][1]
    onProgress?.(0.05 + 0.85 * (i / pages.length), `Rendering page ${i + 1} of ${pages.length}`)
    const chunk = await renderRange(root, cStart, cEnd, { width: L, scale: sr, windowHeight: m.height + 40 })
    for (let p = i; p <= j; p++) {
      if (signal?.aborted) throw abortErr()
      const [s, e] = pages[p]
      const sy = Math.round((s - cStart) * sr), sh = Math.max(1, Math.min(chunk.height - sy, Math.round((e - s) * sr)))
      const image = await canvasSlice(chunk, sy, sh, { jpeg: jpeg || hasMediaIn(media, s, e) })
      const inPage = (top) => top >= s - 1 && top < e - 1
      await builder.addPage({
        W, H, image, x: margin.l, y: margin.t, w: contentWpt, h: ((sh / sr) * k) / PX,
        words: m.words.filter((w) => inPage(w.top)).map((w) => ({ text: w.text, x: margin.l + toPt(w.x), y: margin.t + toPt(w.top + w.h * 0.8 - s), size: toPt(w.size), w: toPt(w.w) })),
        links: m.links.filter((l) => inPage(l.top)).map((l) => ({ x: margin.l + toPt(l.x), y: margin.t + toPt(l.top - s), w: toPt(l.w), h: toPt(l.h), href: l.href })),
        label: pageNumbers && !singlePage ? `${p + 1} / ${pages.length}` : null,
      })
    }
    chunk.width = chunk.height = 0
    i = j + 1
    await tick()
  }
  onProgress?.(0.96, 'Saving')
  const bytes = await builder.save()
  return { bytes, pages: pages.length, ...builder.stats() }
}

/** Print a frame's document with the browser's own engine (real vector text; the person picks "Save as PDF" in the print dialog). */
export function printFrame(frame, { size = 'A4', orient = 'portrait', marginMm = 15, css } = {}) {
  const doc = frame.doc
  let st = doc.getElementById('cv-print')
  if (!st) { st = doc.createElement('style'); st.id = 'cv-print'; doc.head.append(st) }
  const paper = { Letter: 'letter', Legal: 'legal' }[size] || size
  st.textContent = css || `@page { size: ${paper} ${orient}; margin: ${marginMm}mm; } html, body { width: auto !important; max-width: none !important; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }`
  frame.win.focus()
  frame.win.print()
}
