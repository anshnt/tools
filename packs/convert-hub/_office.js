// Word, PowerPoint, text, Markdown and HTML to PDF without the tool pages: the same engines the single-purpose tools use
// (docx-preview + page capture, the slide renderer, the HTML paginator), driven by plain function calls.
import { jszip, script, mammoth as mammothLib } from '../../lib/libs.js'
import { baseName, withExt } from '../../lib/files.js'
import { MAX_PIXELS } from '../../lib/image.js'
import { PAGE_SIZES } from '../../lib/pdf.js'
import { makeFrame, settle, measure, choosePages, renderRange, canvasSlice, createPdfBuilder, paginate, mediaRanges, hasMediaIn, PX, MM, tick } from '../pdf-convert/_paginate.js'
import { openPptx } from '../pdf-convert/_pptx.js'

const abortErr = () => Object.assign(new Error('Cancelled'), { code: 'ABORT' })
const check = (signal) => { if (signal?.aborted) throw abortErr() }
const pdfFile = (bytes, name) => new File([bytes], name, { type: 'application/pdf' })

// ---------- Word ----------
const DOCX_PREVIEW = 'https://cdn.jsdelivr.net/npm/docx-preview@0.4.0/dist/docx-preview.min.js'
const DOC_BASE = '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}section.docx{box-shadow:none!important;margin:0!important}</style></head><body></body></html>'
let docxApi
async function docxPreview() {
  if (!docxApi) { window.JSZip = await jszip(); await script(DOCX_PREVIEW); docxApi = window.docx }
  return docxApi
}

async function renderDocx(doc, data) {
  try {
    const d = await docxPreview()
    await d.renderAsync(data.slice(0), doc.body, doc.head, { className: 'docx', inWrapper: false, ignoreWidth: false, ignoreHeight: false, breakPages: true, renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true, useBase64URL: true, experimental: false })
    await settle(doc)
    return 'docx'
  } catch {
    try {
      const mm = await mammothLib()
      const r = await mm.convertToHtml({ arrayBuffer: data.slice(0) })
      doc.body.innerHTML = `<main class="flow">${r.value}</main>`
      const st = doc.createElement('style')
      st.textContent = '.flow{font:11pt/1.55 Calibri,"Segoe UI",Arial,sans-serif;color:#111;padding:0}.flow h1{font-size:22pt}.flow h2{font-size:16pt}.flow h3{font-size:13pt}.flow table{border-collapse:collapse}.flow td,.flow th{border:1px solid #bbb;padding:4px 8px}.flow img{max-width:100%}'
      doc.head.append(st)
      await settle(doc)
      return 'flow'
    } catch (e) { throw Object.assign(new Error('Could not read this Word file. It may be damaged, password protected or an old .doc file. Save it as .docx in Word and try again.'), { cause: e }) }
  }
}

export async function docxToPdf(f, o = {}, { signal, onProgress } = {}) {
  const buf = await f.arrayBuffer()
  const head = new Uint8Array(buf.slice(0, 2))
  if (!(head[0] === 0x50 && head[1] === 0x4b)) throw new Error('This does not look like a .docx file. Old .doc files must be saved as .docx in Word first.')
  const scale = Number(o.scale) || 2
  const frame = await makeFrame(DOC_BASE, 900)
  try {
    const mode = await renderDocx(frame.doc, buf)
    const title = baseName(f.name)
    if (mode === 'flow') {
      const out = await paginate(frame.doc.querySelector('.flow'), { size: 'A4', margin: { t: 56, r: 56, b: 56, l: 56 }, scale, title, onProgress: (p) => onProgress?.(p), signal })
      return pdfFile(out.bytes, withExt(f.name, 'pdf'))
    }
    const doc = frame.doc, win = frame.win, rootEl = doc.body
    const sections = [...doc.querySelectorAll('section.docx')]
    if (!sections.length) throw new Error('This document has no pages to convert.')
    onProgress?.(0.03)
    await tick()
    const m = measure(rootEl)
    const rootTop = rootEl.getBoundingClientRect().top
    const plan = []
    for (const sec of sections) {
      const r = sec.getBoundingClientRect(), cs = win.getComputedStyle(sec)
      const top = r.top - rootTop, hh = Math.max(r.height, sec.scrollHeight)
      const secW = r.width, minH = parseFloat(cs.minHeight) || r.height
      const padT = parseFloat(cs.paddingTop) || 0, padB = parseFloat(cs.paddingBottom) || 0
      const W = secW / PX, H = minH / PX
      if (hh <= minH + 8) { plan.push({ s: top, e: top + hh, W, H, secW, y: 0 }); continue }
      const sub = { atoms: m.atoms.filter((a) => a.top >= top - 1 && a.bottom <= top + hh + 1).map((a) => ({ ...a, top: a.top - top, bottom: a.bottom - top })), forced: [], height: hh }
      choosePages(sub, minH - padT - padB, minH - padB).forEach(([s, e], i) => plan.push({ s: top + s, e: top + e, W, H, secW, y: i === 0 ? 0 : padT / PX }))
    }
    const media = mediaRanges(rootEl)
    const builder = await createPdfBuilder({ title, allText: m.words.map((w) => w.text).join(' '), textLayer: true })
    const widest = Math.max(...plan.map((p) => p.secW))
    const maxChunk = Math.max(1, Math.floor((MAX_PIXELS * 0.7) / (widest * scale * scale)))
    const totalH = Math.max(m.height, ...plan.map((p) => p.e)) + 40
    let i = 0
    while (i < plan.length) {
      check(signal)
      let j = i
      while (j + 1 < plan.length && plan[j + 1].e - plan[i].s <= maxChunk) j++
      onProgress?.(0.08 + 0.86 * (i / plan.length))
      const chunk = await renderRange(rootEl, plan[i].s, plan[j].e, { width: widest, scale, windowHeight: totalH })
      for (let p = i; p <= j; p++) {
        const pg = plan[p]
        const sy = Math.round((pg.s - plan[i].s) * scale), sh = Math.max(1, Math.min(chunk.height - sy, Math.round((pg.e - pg.s) * scale)))
        const sw = Math.round(pg.secW * scale)
        const c = document.createElement('canvas')
        c.width = sw; c.height = sh
        const g = c.getContext('2d')
        g.fillStyle = '#fff'; g.fillRect(0, 0, sw, sh)
        g.drawImage(chunk, 0, sy, sw, sh, 0, 0, sw, sh)
        const image = await canvasSlice(c, 0, sh, { jpeg: hasMediaIn(media, pg.s, pg.e) })
        c.width = c.height = 0
        const inPage = (t) => t >= pg.s - 1 && t < pg.e - 1
        await builder.addPage({
          W: pg.W, H: pg.H, image, x: 0, y: pg.y, w: pg.W, h: (pg.e - pg.s) / PX,
          words: m.words.filter((w) => inPage(w.top)).map((w) => ({ text: w.text, x: w.x / PX, y: pg.y + (w.top + w.h * 0.8 - pg.s) / PX, size: w.size / PX, w: w.w / PX })),
          links: m.links.filter((l) => inPage(l.top)).map((l) => ({ x: l.x / PX, y: pg.y + (l.top - pg.s) / PX, w: l.w / PX, h: l.h / PX, href: l.href })),
        })
      }
      chunk.width = chunk.height = 0
      i = j + 1
      await tick()
    }
    onProgress?.(0.97)
    return pdfFile(await builder.save(), withExt(f.name, 'pdf'))
  } finally { frame.destroy() }
}

// ---------- PowerPoint ----------
export async function pptxToPdf(f, o = {}, { signal, onProgress } = {}) {
  const buf = await f.arrayBuffer()
  if (new Uint8Array(buf.slice(0, 2))[0] !== 0x50) throw new Error('This does not look like a .pptx file. Old .ppt files must be saved as .pptx in PowerPoint first.')
  const pp = await openPptx(buf)
  try {
    if (!pp.count) throw new Error('This presentation has no slides.')
    const list = []
    for (let i = 0; i < pp.count; i++) {
      const info = await pp.info(i).catch(() => ({ hidden: false }))
      if (o.hidden || !info.hidden) list.push(i)
    }
    if (!list.length) throw new Error('Every slide in this presentation is hidden. Turn on "Include hidden slides".')
    const builder = await createPdfBuilder({ title: baseName(f.name), allText: 'x', textLayer: true })
    const Wpt = pp.width / 12700, Hpt = pp.height / 12700
    const widthPx = Math.round((Wpt * (Number(o.dpi) || 150)) / 72)
    for (let i = 0; i < list.length; i++) {
      check(signal)
      onProgress?.(i / list.length)
      const r = await pp.render(list[i], { widthPx })
      const k = Wpt / r.canvas.width
      const image = await canvasSlice(r.canvas, 0, r.canvas.height, { jpeg: r.hasPictures })
      await builder.addPage({
        W: Wpt, H: Hpt, image, x: 0, y: 0, w: Wpt, h: Hpt,
        words: r.items.filter((it) => /^[\x20-\x7e -ÿ]+$/.test(it.text)).map((it) => ({ text: it.text, x: it.x * k, y: it.y * k, size: Math.max(2, it.size * k), w: it.w * k })),
      })
      r.canvas.width = r.canvas.height = 0
      await tick()
    }
    onProgress?.(0.97)
    return pdfFile(await builder.save(), withExt(f.name, 'pdf'))
  } finally { pp.close?.() }
}

// ---------- Text, Markdown, HTML ----------
export async function textToPdf(f, to, o = {}, { signal, onProgress } = {}) {
  const kind = (f.name.match(/\.([^.]+)$/)?.[1] || 'txt').toLowerCase()
  const size = o.pageSize === 'Letter' ? 'Letter' : 'A4'
  const text = await f.text()
  const title = baseName(f.name)
  onProgress?.(0.05)
  if (kind === 'html' || kind === 'htm' || kind === 'xhtml') {
    const { wrapHtml } = await import('../pdf-convert/html-to-pdf.js')
    const [bw] = PAGE_SIZES[size]
    const m = 12 * MM
    const L = Math.ceil((bw - 2 * m) * PX)
    const frame = await makeFrame(wrapHtml(text), L)
    try {
      const r = await paginate(frame.doc.documentElement, { size, margin: { t: m, r: m, b: m, l: m }, scale: 2, layoutPx: L, title, onProgress: (p) => onProgress?.(p), signal })
      return pdfFile(r.bytes, withExt(f.name, 'pdf'))
    } finally { frame.destroy() }
  }
  if (kind === 'md' || kind === 'markdown') {
    const { renderBody, docHtml } = await import('../pdf-convert/markdown-to-pdf.js')
    const [bw] = PAGE_SIZES[size]
    const m = 18 * MM
    const L = Math.ceil((bw - 2 * m) * PX)
    const { html, title: t } = await renderBody(text, { highlight: true })
    const frame = await makeFrame(await docHtml(html, { theme: 'clean', size: 11, text }), L)
    try {
      const r = await paginate(frame.doc.querySelector('.md'), { size, margin: { t: m, r: m, b: m, l: m }, scale: 2, layoutPx: L, pageNumbers: true, title: t || title, onProgress: (p) => onProgress?.(p), signal })
      return pdfFile(r.bytes, withExt(f.name, 'pdf'))
    } finally { frame.destroy() }
  }
  const { buildTextPdf } = await import('../pdf-convert/text-to-pdf.js')
  const r = await buildTextPdf(text, { title, page: size, orient: 'portrait', margin: 20, size: 11, spacing: 1.45, font: 'sans', tab: 4, wrap: true, lineNumbers: false, pageNumbers: true, numAlign: 'center' })
  return pdfFile(r.pdfBytes, withExt(f.name, 'pdf'))
}
