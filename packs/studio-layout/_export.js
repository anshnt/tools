// Exports: vector PDF with real selectable text (pdf-lib + embedded fonts), high-quality raster PDF, PNG pages, print, project files.
import { pdfLib, script, jszip } from '../../lib/libs.js'
import { savePdf } from '../../lib/pdf.js'
import { MAX_PIXELS, toBlob } from '../../lib/image.js'
import { zip, safeName, baseName } from '../../lib/files.js'
import { yieldToMain } from '../../lib/ui.js'
import { paintOrder, isLayerVisible, rad, containers, normalizeDoc } from './_model.js'
import { renderToCanvas, pageTokens, imageRect } from './_render.js'
import { faceBytes } from './_fonts.js'
import { embeddable } from './_assets.js'

const FONTKIT = 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js'
const SLUG = 21

const hexRgb = (lib, c) => {
  let s = (c || '#000000').replace('#', '')
  if (s.length === 3) s = [...s].map((x) => x + x).join('')
  const n = parseInt(s, 16) || 0
  return lib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}
const roundedPath = (w, h, r) => {
  r = Math.max(0, Math.min(r, w / 2, h / 2))
  return `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`
}

/** Resolve a page range like "1-3, 5" (or empty for all). */
export function pageList(spec, n) {
  if (!spec || !spec.trim()) return Array.from({ length: n }, (_, i) => i)
  const out = new Set()
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*(?:-\s*(\d*))?$/)
    if (!m) throw new Error(`"${part}" is not a page number or range.`)
    const a = +m[1], b = part.includes('-') ? (m[2] ? +m[2] : n) : a
    if (a < 1 || b > n || a > b) throw new Error(`"${part}" is outside pages 1-${n}.`)
    for (let i = a; i <= b; i++) out.add(i - 1)
  }
  return [...out].sort((x, y) => x - y)
}

/** Vector PDF. Throws {code: 'FONTS'} when a font could not be loaded (the caller can fall back to the raster PDF). */
export async function exportPdf(scene, { bleed = false, marks = false, pages, onProgress, signal } = {}) {
  const doc = scene.doc
  onProgress?.(0, 'Loading fonts and images')
  const failed = await scene.preload()
  if (failed.length) throw Object.assign(new Error(`Could not load ${failed.map((f) => f.fam.name).join(', ')}. Check your connection, or use the image-based PDF.`), { code: 'FONTS' })
  const lib = await pdfLib()
  await script(FONTKIT)
  const fk = window.fontkit
  const pdf = await lib.PDFDocument.create()
  pdf.registerFontkit(fk)
  const fonts = new Map(), images = new Map()
  const getFont = async (face) => {
    let f = fonts.get(face.key)
    if (!f) {
      const bytes = faceBytes(face)
      // fontkit cannot subset these latin-only WOFF families, but each face is already small (15-130 KB), so embed it whole
      const font = await pdf.embedFont(bytes, { subset: false, features: { liga: false, clig: false, calt: false, kern: false } })
      f = { font, fk: fk.create(bytes) }
      fonts.set(face.key, f)
    }
    return f
  }
  const getImage = async (asset) => {
    let im = images.get(asset.id)
    if (!im) {
      const e = await embeddable(asset)
      im = e.kind === 'jpg' ? await pdf.embedJpg(e.bytes) : await pdf.embedPng(e.bytes)
      images.set(asset.id, im)
    }
    return im
  }
  const b = bleed ? doc.bleed : 0
  const slug = marks ? SLUG : 0
  const off = b + slug
  const PW = doc.w + 2 * off, PH = doc.h + 2 * off
  const X = (x) => off + x, Y = (y) => PH - off - y
  const list = pageList(pages, doc.pages.length)
  const op = (v) => (v != null && v < 1 ? { opacity: v } : {})
  let replaced = 0

  for (let n = 0; n < list.length; n++) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
    const index = list[n]
    const container = doc.pages[index]
    const page = pdf.addPage([PW, PH])
    page.setTrimBox(off, off, doc.w, doc.h)
    page.setBleedBox(slug, slug, doc.w + 2 * b, doc.h + 2 * b)
    page.pushOperators(lib.pushGraphicsState(), lib.rectangle(slug, slug, doc.w + 2 * b, doc.h + 2 * b), lib.clip(), lib.endPath())
    page.drawRectangle({ x: slug, y: slug, width: doc.w + 2 * b, height: doc.h + 2 * b, color: lib.rgb(1, 1, 1) })
    const tokens = pageTokens(doc, index, false)
    const master = container.master ? doc.masters.find((m) => m.id === container.master) : null
    const items = [...(master ? paintOrder(doc, master) : []), ...paintOrder(doc, container)].filter((it) => isLayerVisible(doc, it))

    const drawBox = (it) => {
      const hasFill = !!it.fill, hasStroke = !!(it.stroke && it.sw > 0)
      if (!hasFill && !hasStroke) return
      const o = {}
      if (hasFill) o.color = hexRgb(lib, it.fill)
      if (hasStroke) { o.borderColor = hexRgb(lib, it.stroke); o.borderWidth = it.sw; if (it.dash) o.borderDashArray = it.dash === 1 ? [it.sw * 3, it.sw * 2] : [0.01, it.sw * 2]; if (it.dash === 2) o.borderLineCap = lib.LineCapStyle.Round }
      Object.assign(o, op(it.opacity))
      if (it.opacity < 1 && hasStroke) o.borderOpacity = it.opacity
      if (it.radius > 0) page.drawSvgPath(roundedPath(it.w, it.h, it.radius), { x: X(it.x), y: Y(it.y), ...o })
      else page.drawRectangle({ x: X(it.x), y: Y(it.y + it.h), width: it.w, height: it.h, ...o })
    }
    const clipRounded = (it) => {
      const x = X(it.x), y = Y(it.y + it.h), w = it.w, h = it.h
      const r = Math.max(0, Math.min(it.radius || 0, w / 2, h / 2))
      if (!r) { page.pushOperators(lib.rectangle(x, y, w, h), lib.clip(), lib.endPath()); return }
      const k = r * 0.5523
      page.pushOperators(lib.moveTo(x + r, y), lib.lineTo(x + w - r, y), lib.appendBezierCurve(x + w - r + k, y, x + w, y + r - k, x + w, y + r), lib.lineTo(x + w, y + h - r),
        lib.appendBezierCurve(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h), lib.lineTo(x + r, y + h), lib.appendBezierCurve(x + r - k, y + h, x, y + h - r + k, x, y + h - r),
        lib.lineTo(x, y + r), lib.appendBezierCurve(x, y + r - k, x + r - k, y, x + r, y), lib.closePath(), lib.clip(), lib.endPath())
    }

    for (const it of items) {
      page.pushOperators(lib.pushGraphicsState())
      if (it.rot) {
        const cx = X(it.x + it.w / 2), cy = Y(it.y + it.h / 2)
        const phi = -rad(it.rot), c = Math.cos(phi), s = Math.sin(phi)
        page.pushOperators(lib.concatTransformationMatrix(c, s, -s, c, cx - cx * c + cy * s, cy - cx * s - cy * c))
      }
      if (it.type === 'rect') drawBox(it)
      else if (it.type === 'ellipse') {
        const o = {}
        if (it.fill) o.color = hexRgb(lib, it.fill)
        if (it.stroke && it.sw > 0) { o.borderColor = hexRgb(lib, it.stroke); o.borderWidth = it.sw; if (it.dash) o.borderDashArray = it.dash === 1 ? [it.sw * 3, it.sw * 2] : [0.01, it.sw * 2] }
        if (o.color || o.borderColor) page.drawEllipse({ x: X(it.x + it.w / 2), y: Y(it.y + it.h / 2), xScale: it.w / 2, yScale: it.h / 2, ...o, ...op(it.opacity), ...(it.opacity < 1 && o.borderColor ? { borderOpacity: it.opacity } : {}) })
      } else if (it.type === 'line') {
        if (it.stroke && it.sw > 0) page.drawLine({ start: { x: X(it.x), y: Y(it.y + it.h / 2) }, end: { x: X(it.x + it.w), y: Y(it.y + it.h / 2) }, thickness: it.sw, color: hexRgb(lib, it.stroke), ...(it.dash ? { dashArray: it.dash === 1 ? [it.sw * 3, it.sw * 2] : [0.01, it.sw * 2], lineCap: it.dash === 2 ? lib.LineCapStyle.Round : undefined } : {}), ...op(it.opacity) })
      } else if (it.type === 'image') {
        if (it.fill) drawBox({ ...it, stroke: null, sw: 0 })
        const asset = it.asset && scene.store.assets.get(it.asset)
        if (asset) {
          const img = await getImage(asset)
          const r = imageRect(it, asset.w, asset.h)
          page.pushOperators(lib.pushGraphicsState())
          clipRounded(it)
          page.drawImage(img, { x: X(it.x + r.x), y: Y(it.y + r.y + r.h), width: r.w, height: r.h, ...op(it.opacity) })
          page.pushOperators(lib.popGraphicsState())
        }
        if (it.stroke && it.sw > 0) drawBox({ ...it, fill: null })
      } else if (it.type === 'text') {
        if (it.fill || (it.stroke && it.sw > 0)) drawBox(it)
        const { lines } = scene.layout(it, tokens)
        for (const line of lines) {
          const by = Y(it.y + line.y)
          const run = async (text, st, x) => {
            if (!text) return
            const f = await getFont(st.f)
            const safe = [...text].map((ch) => (f.fk.hasGlyphForCodePoint(ch.codePointAt(0)) ? ch : (replaced++, '?'))).join('')
            if (st.tracking) page.pushOperators(lib.setCharacterSpacing((st.tracking * st.size) / 1000))
            page.drawText(safe, { x: X(it.x + x), y: by, size: st.size, font: f.font, color: hexRgb(lib, st.color), ...op(it.opacity) })
            if (st.tracking) page.pushOperators(lib.setCharacterSpacing(0))
            if (st.u) {
              const w = f.font.widthOfTextAtSize(safe, st.size) + (st.tracking * st.size * safe.length) / 1000
              page.drawLine({ start: { x: X(it.x + x), y: by - st.size * 0.1 }, end: { x: X(it.x + x) + w, y: by - st.size * 0.1 }, thickness: Math.max(0.5, st.size / 18), color: hexRgb(lib, st.color), ...op(it.opacity) })
            }
          }
          if (line.marker) await run(line.marker.text, line.marker.st, line.marker.x)
          if (line.just) {
            for (let i = 0; i < line.parts.length; i++) {
              const p = line.parts[i]
              if (p.sp) continue
              await run(line.parts[i + 1]?.sp ? `${p.text} ` : p.text, p.st, line.x + p.x)
            }
          } else {
            let i = 0
            while (i < line.parts.length) {
              const p = line.parts[i]
              let text = p.text, j = i + 1
              while (j < line.parts.length && line.parts[j].st === p.st) { text += line.parts[j].text; j++ }
              await run(text, p.st, line.x + p.x)
              i = j
            }
          }
        }
      }
      page.pushOperators(lib.popGraphicsState())
    }
    page.pushOperators(lib.popGraphicsState())
    if (marks) {
      const L = 14, gap = b + 3
      const tx0 = off, ty0 = off, tx1 = off + doc.w, ty1 = off + doc.h
      for (const [cx, dx] of [[tx0, -1], [tx1, 1]]) for (const [cy, dy] of [[ty0, -1], [ty1, 1]]) {
        page.drawLine({ start: { x: cx + dx * gap, y: cy }, end: { x: cx + dx * (gap + L), y: cy }, thickness: 0.5, color: lib.rgb(0, 0, 0) })
        page.drawLine({ start: { x: cx, y: cy + dy * gap }, end: { x: cx, y: cy + dy * (gap + L) }, thickness: 0.5, color: lib.rgb(0, 0, 0) })
      }
    }
    onProgress?.((n + 1) / list.length, `Page ${n + 1} of ${list.length}`)
    await yieldToMain()
  }
  pdf.setTitle(doc.name)
  pdf.setCreator('Layout Studio')
  pdf.setProducer('Layout Studio with pdf-lib')
  pdf.setCreationDate(new Date())
  const blob = await savePdf(pdf)
  blob.replaced = replaced // characters the loaded Latin font files could not draw (shown as ? in the file)
  return blob
}

function clampScale(doc, scale, bleed) {
  const area = (doc.w + 2 * bleed) * (doc.h + 2 * bleed) * scale * scale
  return area > MAX_PIXELS ? scale * Math.sqrt(MAX_PIXELS / area) * 0.98 : scale
}

/** Image-based PDF (text is not selectable) rendered at the chosen resolution. */
export async function exportRasterPdf(scene, { dpi = 300, bleed = false, pages, quality = 0.92, onProgress, signal } = {}) {
  const doc = scene.doc
  await scene.preload()
  const lib = await pdfLib()
  const pdf = await lib.PDFDocument.create()
  const b = bleed ? doc.bleed : 0
  const list = pageList(pages, doc.pages.length)
  for (let n = 0; n < list.length; n++) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
    const scale = clampScale(doc, dpi / 72, b)
    const c = renderToCanvas(scene, doc.pages[list[n]], { scale, bleed: b, index: list[n], full: true })
    const jpg = await pdf.embedJpg(await (await toBlob(c, 'image/jpeg', quality)).arrayBuffer())
    c.width = c.height = 0
    const w = doc.w + 2 * b, h = doc.h + 2 * b
    const pg = pdf.addPage([w, h])
    pg.drawImage(jpg, { x: 0, y: 0, width: w, height: h })
    if (b) { pg.setTrimBox(b, b, doc.w, doc.h) }
    onProgress?.((n + 1) / list.length, `Page ${n + 1} of ${list.length}`)
    await yieldToMain()
  }
  pdf.setTitle(doc.name)
  pdf.setCreator('Layout Studio')
  return savePdf(pdf)
}

/** One PNG per page. Returns [{name, blob, width, height}]. */
export async function exportPngs(scene, { dpi = 150, bleed = false, pages, onProgress, signal } = {}) {
  const doc = scene.doc
  await scene.preload()
  const b = bleed ? doc.bleed : 0
  const list = pageList(pages, doc.pages.length)
  const out = []
  for (let n = 0; n < list.length; n++) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
    const scale = clampScale(doc, dpi / 72, b)
    const c = renderToCanvas(scene, doc.pages[list[n]], { scale, bleed: b, index: list[n], full: true })
    out.push({ name: `${safeName(doc.name)}-page-${list[n] + 1}.png`, blob: await toBlob(c, 'image/png'), width: c.width, height: c.height })
    c.width = c.height = 0
    onProgress?.((n + 1) / list.length, `Page ${n + 1} of ${list.length}`)
    await yieldToMain()
  }
  return out
}
export const zipPngs = (files) => zip(files.map((f) => ({ name: f.name, data: f.blob })))

/** Print through a hidden frame with one image per page at the exact page size. */
export async function printDoc(scene, { dpi = 150, bleed = false } = {}) {
  const doc = scene.doc
  const files = await exportPngs(scene, { dpi, bleed })
  const b = bleed ? doc.bleed : 0
  const w = doc.w + 2 * b, h = doc.h + 2 * b
  const urls = files.map((f) => URL.createObjectURL(f.blob))
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  frame.srcdoc = `<!doctype html><html><head><title>${safeName(doc.name)}</title><style>@page{size:${w}pt ${h}pt;margin:0}html,body{margin:0;padding:0}img{display:block;width:${w}pt;height:${h}pt;page-break-after:always;break-after:page}img:last-child{page-break-after:auto;break-after:auto}</style></head><body>${urls.map((u) => `<img src="${u}">`).join('')}</body></html>`
  const cleanup = () => { frame.remove(); for (const u of urls) URL.revokeObjectURL(u) }
  await new Promise((resolve) => {
    frame.onload = async () => {
      const win = frame.contentWindow
      await Promise.all([...win.document.images].map((im) => im.decode().catch(() => {})))
      win.addEventListener('afterprint', () => setTimeout(cleanup, 500))
      win.focus()
      win.print()
      setTimeout(cleanup, 120000)
      resolve()
    }
    document.body.append(frame)
  })
}

// ---------- Project files ----------
const extOf = (type) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' }[type] || 'bin')
/** Save the document and its images as one ZIP. */
export async function saveProjectZip(store) {
  const doc = store.doc
  const used = new Set(containers(doc).flatMap(({ c }) => c.items.map((i) => i.asset).filter(Boolean)))
  const entries = [{ name: 'project.json', data: JSON.stringify({ app: 'layout-studio', version: 1, doc, assets: [...used].map((id) => { const a = store.assets.get(id); return a && { id, name: a.name, type: a.type, w: a.w, h: a.h, file: `assets/${id}.${extOf(a.type)}` } }).filter(Boolean) }) }]
  for (const id of used) { const a = store.assets.get(id); if (a) entries.push({ name: `assets/${id}.${extOf(a.type)}`, data: a.blob }) }
  return zip(entries)
}
export async function openProjectZip(file) {
  const JSZip = await jszip()
  let z
  try { z = await JSZip.loadAsync(file) } catch { throw new Error('That file is not a Layout Studio project (a ZIP made by Save project).') }
  const meta = z.file('project.json')
  if (!meta) throw new Error('This ZIP has no project.json, so it is not a Layout Studio project.')
  const json = JSON.parse(await meta.async('string'))
  if (json.app !== 'layout-studio' || !json.doc?.pages) throw new Error('This file is not a Layout Studio project.')
  const assets = new Map()
  for (const a of json.assets || []) {
    const f = z.file(a.file)
    if (f) assets.set(a.id, { id: a.id, name: a.name, type: a.type, w: a.w, h: a.h, blob: new Blob([await f.async('arraybuffer')], { type: a.type }) })
  }
  return { doc: normalizeDoc(json.doc), assets }
}
export { baseName }
