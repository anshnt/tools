// OpenDocument presentations (.odp, .fodp, .otp) -> slide pictures and PDF. A basic renderer: slide size and background colour, text boxes (through the
// text reader in _odf.js), pictures, tables and filled shapes with their text, each placed at its position. Animations, gradients and master-page
// decorations are not drawn.
import { fail, deep, kid, attrNS, sniffImage, normalizeImage, dataUrl, esc, checkAbort, hex6 } from './_util.js'
import { openOdf, odfToBlocks, odfLoadImages } from './_odf.js'

const A = (el, n) => attrNS(el, n)
const lenPx = (v) => {
  const m = /^(-?[\d.]+)\s*(cm|mm|in|pt|px|pc)?$/.exec(String(v || '').trim())
  if (!m) return 0
  const n = parseFloat(m[1])
  return { cm: n * 37.795, mm: n * 3.7795, in: n * 96, pt: n * 1.3333, px: n, pc: n * 16 }[m[2] || 'px']
}

/** Slides of an ODP as a list of {w, h, bg, shapes: [{x, y, w, h, html, kind, fill, stroke}]} (px at 96 dpi). */
export async function odpToSlides(bytes) {
  const odf = await openOdf(bytes)
  const pres = deep(odf.content, 'presentation').find((e) => e.parentNode?.localName === 'body')
  if (!pres) throw fail('This OpenDocument file is not a presentation (no .odp slides found).')
  const { astToHtml } = await import('./_ast.js')
  // style lookup for shapes and pages
  const styles = new Map()
  for (const d of [odf.styles, odf.content]) for (const s of deep(d, 'style')) styles.set(`${A(s, 'family')}:${A(s, 'name')}`, s)
  const prop = (family, name, tag) => {
    const out = {}
    let n = name, guard = 0
    const chain = []
    while (n && guard++ < 8) { const s = styles.get(`${family}:${n}`); if (!s) break; chain.unshift(s); n = A(s, 'parent-style-name') }
    for (const s of chain) { const p = kid(s, tag); if (p) for (const a of p.attributes) out[a.localName] = a.value }
    return out
  }
  // page size from the master page layout
  const layouts = new Map(deep(odf.styles, 'page-layout').map((l) => [A(l, 'name'), kid(l, 'page-layout-properties')]))
  const masters = new Map(deep(odf.styles, 'master-page').map((m) => [A(m, 'name'), m]))
  const pages = deep(pres, 'page')
  if (!pages.length) throw fail('This presentation has no slides.')
  const out = []
  for (const pg of pages) {
    const master = masters.get(A(pg, 'master-page-name'))
    const lp = layouts.get(A(master, 'page-layout-name')) || [...layouts.values()][0]
    const w = lenPx(A(lp, 'page-width')) || 1058, h = lenPx(A(lp, 'page-height')) || 595
    const pp = prop('drawing-page', A(pg, 'style-name'), 'drawing-page-properties')
    const mp = master ? prop('drawing-page', A(master, 'style-name'), 'drawing-page-properties') : {}
    const bgc = (pp.fill === 'solid' && hex6(pp['fill-color'])) || (mp.fill === 'solid' && hex6(mp['fill-color'])) || null
    const slide = { w: Math.round(w), h: Math.round(h), bg: bgc, shapes: [] }
    const addShape = async (el, ox = 0, oy = 0) => {
      const ln = el.localName
      if (ln === 'g') { for (const c of el.children) await addShape(c, ox, oy); return }
      if (!['frame', 'custom-shape', 'rect', 'ellipse', 'polygon', 'text-box', 'circle'].includes(ln)) return
      const x = lenPx(A(el, 'x')) + ox, y = lenPx(A(el, 'y')) + oy
      const sw = lenPx(A(el, 'width')), sh = lenPx(A(el, 'height'))
      const gp = prop('graphic', A(el, 'style-name'), 'graphic-properties')
      const cls = A(el, 'class')
      const fill = gp.fill === 'solid' ? hex6(gp['fill-color']) : null
      const stroke = gp.stroke && gp.stroke !== 'none' ? hex6(gp['stroke-color']) || '000000' : null
      let html = ''
      let kind = ln
      if (ln === 'frame') {
        const img = deep(el, 'image')[0]
        if (img && odf.zip) {
          const href = (A(img, 'href') || '').replace(/^\.\//, '')
          const f = href && odf.zip.file(href)
          const binEl = kid(img, 'binary-data')
          let b = f ? await f.async('uint8array') : null
          if (!b && binEl) { try { const { base64ToBytes } = await import('./_util.js'); b = base64ToBytes(binEl.textContent) } catch { /* ignore */ } }
          const norm = b ? await normalizeImage(b, sniffImage(b)) : null
          if (norm) html = `<img src="${dataUrl(norm.bytes, norm.mime)}" style="width:100%;height:100%;object-fit:contain" alt="">`
          kind = 'image'
        } else {
          const tb = deep(el, 'text-box')[0] || el
          const { blocks } = odfToBlocks(odf, tb)
          await odfLoadImages(odf, blocks)
          html = astToHtml(blocks)
        }
      } else {
        const { blocks } = odfToBlocks(odf, el)
        html = astToHtml(blocks)
      }
      if (html || fill || stroke) slide.shapes.push({ x, y, w: sw, h: sh, html, kind, cls, fill, stroke, ellipse: ln === 'ellipse' || ln === 'circle' || /ellipse/.test(A(deep(el, 'enhanced-geometry')[0], 'type') || '') })
    }
    for (const c of pg.children) await addShape(c)
    out.push(slide)
  }
  return { slides: out, title: deep(odf.meta || odf.content, 'title')[0]?.textContent || '' }
}

const SLIDE_CSS = `body { margin: 0; background: #fff; font: 18pt/1.25 "Liberation Sans", Arial, "Segoe UI", "Noto Sans KR", "Malgun Gothic", sans-serif; color: #111; }
.slide { position: relative; overflow: hidden; background: #fff; } .shp { position: absolute; box-sizing: border-box; padding: 4px 8px; overflow: hidden; }
.shp p, .shp h1, .shp h2, .shp h3 { margin: 0 0 .25em; } .shp ul, .shp ol { margin: 0 0 .25em; padding-left: 1.2em; } .shp h1, .shp h2 { font-size: 1.5em; } .shp.title { font-size: 32pt; font-weight: 700; } .shp img { display: block; }
.shp table { border-collapse: collapse; font-size: .7em; } .shp td, .shp th { border: 1px solid #999; padding: 2px 6px; }`

/** HTML with every slide as a fixed-size section (one after another, no gaps). */
export function slidesHtml(slides) {
  const body = slides.map((s) => `<section class="slide" style="width:${s.w}px;height:${s.h}px;${s.bg ? `background:#${s.bg};` : ''}">${s.shapes.map((sh) => `<div class="shp${sh.cls === 'title' ? ' title' : ''}" style="left:${Math.round(sh.x)}px;top:${Math.round(sh.y)}px;width:${Math.round(sh.w)}px;height:${Math.round(sh.h)}px;${sh.fill ? `background:#${sh.fill};` : ''}${sh.stroke ? `border:1px solid #${sh.stroke};` : ''}${sh.ellipse ? 'border-radius:50%;' : ''}">${sh.html}</div>`).join('')}</section>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>${SLIDE_CSS}</style></head><body>${body}</body></html>`
}

/** Render every slide with the browser. -> {pages: [{w, h, png: Uint8Array | jpeg bytes, jpeg}], title} */
export async function renderOdp(bytes, { scale = 2, onProgress, signal } = {}) {
  const { slides, title } = await odpToSlides(bytes)
  const { makeFrame, renderRange, canvasSlice, tick } = await import('../pdf-convert/_paginate.js')
  const W = Math.max(...slides.map((s) => s.w))
  const frame = await makeFrame(slidesHtml(slides), W)
  const pages = []
  try {
    const root = frame.doc.body
    const secs = [...root.querySelectorAll('section.slide')]
    const total = secs.reduce((n, s) => n + s.offsetHeight, 0) + 40
    const rootTop = root.getBoundingClientRect().top
    for (let i = 0; i < secs.length; i++) {
      checkAbort(signal)
      const r = secs[i].getBoundingClientRect()
      const chunk = await renderRange(root, r.top - rootTop, r.top - rootTop + slides[i].h, { width: W, scale, windowHeight: total })
      const hasPic = slides[i].shapes.some((s) => s.kind === 'image')
      const sw = Math.round(slides[i].w * scale)
      const c = document.createElement('canvas')
      c.width = sw; c.height = chunk.height
      c.getContext('2d').drawImage(chunk, 0, 0, sw, chunk.height, 0, 0, sw, chunk.height)
      const img = await canvasSlice(c, 0, c.height, { jpeg: hasPic })
      pages.push({ w: slides[i].w, h: slides[i].h, bytes: img.bytes, jpeg: img.jpeg })
      chunk.width = chunk.height = 0; c.width = c.height = 0
      onProgress?.((i + 1) / secs.length, `Slide ${i + 1} of ${secs.length}`)
      await tick()
    }
  } finally { frame.destroy() }
  return { pages, title }
}

/** ODP -> PDF (one page per slide, drawn as pictures). -> Uint8Array */
export async function odpToPdf(bytes, opts = {}) {
  const { pages, title } = await renderOdp(bytes, { ...opts, onProgress: (p, t) => opts.onProgress?.(p * 0.9, t) })
  const { createPdfBuilder } = await import('../pdf-convert/_paginate.js')
  const b = await createPdfBuilder({ title, allText: '', textLayer: false })
  for (const p of pages) {
    const W = p.w * 0.75, H = p.h * 0.75
    await b.addPage({ W, H, image: { bytes: p.bytes, jpeg: p.jpeg }, x: 0, y: 0, w: W, h: H })
  }
  return b.save()
}
void esc
