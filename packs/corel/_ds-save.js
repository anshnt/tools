// Draw Studio save and export. toWriterDoc turns the editor document into what the writers take (a tree for CDR, a flat Doc for everything else),
// exportDoc runs one format end to end and returns the files and plain-English notes. The statically imported modules are pure, so Node tests cover
// toWriterDoc; every writer (and the DOM bits) is loaded with import() only when a format needs it.
//
//   toWriterDoc(root, {assets, pages, only, flat, outline, outliner, measurer, signal}) -> {doc, notes}
//     assets: {dataUrl(id), ensureDataUrls(ids, signal)} (the Blob store); pages: page indexes; only: Set of ids (selection);
//     flat: false keeps layers and groups (CDR); outline: turn text into curves; outliner(nodes, fonts, {signal}) -> {map, kept};
//     measurer(node) -> measure(str): line widths for centre and right alignment of text that stays live.
//   exportDoc(format, opts, env) -> {files: [{name, blob}], notes, parts}   env = {store, assets, boxOf, signal, onProgress}
import { flattenDoc } from './_tree.js'
import { translate, unionBox } from './_model.js'
import { transformItem } from './_ds-ops.js'
import { BUNDLED_FAMILIES, bakeLines } from './_ds-text-model.js'

export const FORMATS = {
  cdr: { label: 'CDR', ext: 'cdr', mime: 'application/octet-stream', outline: true, text: 'A drawing file with pages, layers, groups, curves, pictures and text. Compatibility with the desktop application cannot be verified here, so keep an AI, PDF or SVG copy too.' },
  ai: { label: 'AI', ext: 'ai', mime: 'application/postscript', outline: true, text: 'A PDF-compatible file saved as .ai. Desktop vector editors open it with editable curves.' },
  pdf: { label: 'PDF', ext: 'pdf', mime: 'application/pdf', outline: true, text: 'A vector PDF with every page. Text becomes curves so the letter shapes are exact.' },
  eps: { label: 'EPS', ext: 'eps', mime: 'application/postscript', outline: true, perPage: true, text: 'Vector PostScript, one file per page (a ZIP for several pages).' },
  svg: { label: 'SVG', ext: 'svg', mime: 'image/svg+xml', outline: false, perPage: true, text: 'Millimetre-based SVG, one file per page. Text can stay live text with its fonts embedded.' },
  png: { label: 'PNG', ext: 'png', mime: 'image/png', outline: true, raster: true, perPage: true, text: 'A picture of each page at the resolution you choose, with an optional transparent background.' },
  jpg: { label: 'JPG', ext: 'jpg', mime: 'image/jpeg', outline: true, raster: true, perPage: true, text: 'A compressed picture of each page on white.' },
}
/** Options a format starts with. */
export const defaultsFor = (fmt) => ({ outline: FORMATS[fmt]?.outline ?? true, dpi: 96, transparent: fmt === 'png', quality: 0.92, split: false, compress: true, bitmapAlpha: 'rgba' })

const STRIP = ['shape', 'sm', 'nt', 'fillK', 'strokeK', 'src', 'rot', 'bad', 'pending', 'fontName']
const abort = () => Object.assign(new Error('Cancelled'), { code: 'ABORT' })
const cleanLeaf = (n) => { const o = { ...n }; for (const k of STRIP) delete o[k]; return o }
const isBundled = (f) => BUNDLED_FAMILIES.includes(f)

/** Remove nodes whose id is in map (id -> replacement node, or null) from a list of nodes (groups included). Returns new lists, never mutates. */
function replaceText(items, map) {
  const out = []
  for (const n of items) {
    if (n.t === 'group') out.push({ ...n, items: replaceText(n.items, map) })
    else if (n.t === 'text' && map.has(n.id)) { const r = map.get(n.id); if (r) out.push(r) } else out.push(n)
  }
  return out
}
/** Live text leaves become single-line, left-aligned items (centre and right alignment baked into each line). */
function bakeAll(items, measurer) {
  const out = []
  for (const n of items) {
    if (n.t === 'group') out.push({ ...n, items: bakeAll(n.items, measurer) })
    else if (n.t === 'text') out.push(...bakeLines(n, measurer ? measurer(n) : (s) => s.length * n.size * 0.55))
    else out.push(n)
  }
  return out
}
const eachLeaf = (items, fn) => { for (const n of items) { if (n.t === 'group') eachLeaf(n.items, fn); else fn(n) } }

export async function toWriterDoc(root, o = {}) {
  const { assets, only = null, flat = true, outline = true, signal, measurer = null } = o
  const idx = (o.pages ?? root.pages.map((_, i) => i)).filter((i) => root.pages[i])
  const notes = []
  let hidden = 0
  // the pictures the chosen pages use become data: URLs (read one at a time), kept only until the export ends
  const want = new Set()
  const build = (items, inOnly) => {
    const out = []
    for (const n of items) {
      if (n.hidden) { hidden++; continue }
      const sel = !only || inOnly || only.has(n.id)
      if (n.t === 'group') {
        const kids = build(n.items, sel)
        if (kids.length) out.push({ ...cleanLeaf(n), items: kids })
      } else if (sel) {
        if (n.t === 'image') want.add(n.asset)
        out.push(cleanLeaf(n))
      }
    }
    return out
  }
  const pages = []
  for (const i of idx) {
    const p = root.pages[i]
    if (p.pending) throw new Error('A page is still being read. Try again in a moment.')
    const layers = []
    for (const l of p.layers) {
      if (flat && (l.hidden || l.printable === false)) continue
      layers.push({ name: l.name, hidden: !!l.hidden, locked: !!l.locked, printable: l.printable !== false, items: build(l.items, false) })
    }
    pages.push({ w: p.w, h: p.h, name: p.name, guides: (p.guides || []).map(({ axis, pos }) => ({ axis, pos })), layers })
  }
  if (assets && want.size) await assets.ensureDataUrls([...want], signal)
  const fixImages = (items) => {
    const out = []
    for (const n of items) {
      if (n.t === 'group') out.push({ ...n, items: fixImages(n.items) })
      else if (n.t === 'image') {
        const href = assets?.dataUrl(n.asset)
        const { asset: _a, ...rest } = n
        if (href) out.push({ ...rest, href }); else notes.push('A picture could not be read and was left out.')
      } else out.push(n)
    }
    return out
  }
  for (const p of pages) for (const l of p.layers) l.items = fixImages(l.items)

  // text: outline it (exact letter shapes from embedded fonts, a bundled font otherwise), the rest becomes single-line items
  let kept = 0
  if (outline) {
    const texts = []
    for (const p of pages) for (const l of p.layers) eachLeaf(l.items, (n) => { if (n.t === 'text' && n.str) texts.push(n) })
    if (texts.length) {
      const outliner = o.outliner || (await import('./_ds-text.js')).outlineNodes
      const r = await outliner(texts, root.fonts, { signal, onProgress: o.onProgress })
      kept = r.kept
      const subst = new Map()
      for (const n of texts) if (r.map.has(n.id) && n.font == null && !isBundled(n.family)) subst.set(n.family, (subst.get(n.family) || 0) + 1)
      if (subst.size) notes.push(`Text set in ${[...subst.keys()].slice(0, 4).join(', ')}${subst.size > 4 ? ' and others' : ''} was drawn with a similar bundled font, because the font file is not part of the drawing.`)
      for (const p of pages) for (const l of p.layers) l.items = replaceText(l.items, r.map)
    }
    if (kept) notes.push(`${kept} text object${kept === 1 ? ' uses' : 's use'} characters the outline fonts do not have, for example Devanagari, and ${kept === 1 ? 'stays' : 'stay'} as live text.`)
  }
  for (const p of pages) for (const l of p.layers) l.items = bakeAll(l.items, measurer)

  const used = new Set()
  for (const p of pages) for (const l of p.layers) eachLeaf(l.items, (n) => { if (n.t === 'text' && n.font != null) used.add(n.font) })
  const fonts = {}
  for (const k of used) if (root.fonts?.[k]) fonts[k] = root.fonts[k]
  let doc = { pages, warnings: [], fonts }
  if (flat) doc = flattenDoc(doc, { pruneFonts: true })
  if (hidden) notes.push(`${hidden} hidden object${hidden === 1 ? ' was' : 's were'} left out.`)
  return { doc, notes, liveText: kept }
}

/** Crop a flat doc's page to a box {x, y, w, h}: items are shifted so the box becomes the page. */
export function cropPage(page, b, pad = 0) {
  const M = translate(-(b.x - pad), -(b.y - pad)), memo = new Map()
  return { ...page, w: Math.max(1, b.w + 2 * pad), h: Math.max(1, b.h + 2 * pad), items: page.items.map((n) => transformItem(n, M, { memo })) }
}

/**
 * Reduce pictures that carry more than maxDpi pixels per inch of their placed size (EPS stores pictures as plain text, so a photo can cost
 * hundreds of megabytes). Returns the number of pictures reduced. Browser only (canvas); data URLs in, data URLs out.
 */
export async function capImages(doc, maxDpi = 200, signal) {
  const done = new Map()
  let reduced = 0
  for (const page of doc.pages) {
    for (let i = 0; i < page.items.length; i++) {
      const n = page.items[i]
      if (n.t !== 'image' || !n.href) continue
      const inches = Math.max(Math.hypot(n.m[0], n.m[1]), Math.hypot(n.m[2], n.m[3])) / 72
      const dpi = inches > 0 ? Math.max(n.w, n.h) / inches : 0
      if (!(dpi > maxDpi * 1.05)) continue
      if (signal?.aborted) throw abort()
      const k = maxDpi / dpi, w = Math.max(1, Math.round(n.w * k)), h = Math.max(1, Math.round(n.h * k))
      const key = `${n.href.length}:${n.href.slice(-64)}:${w}x${h}`
      if (!done.has(key)) {
        done.set(key, (async () => {
          const blob = await (await fetch(n.href)).blob()
          const bmp = await createImageBitmap(blob)
          const c = document.createElement('canvas')
          c.width = w; c.height = h
          const g = c.getContext('2d')
          g.imageSmoothingQuality = 'high'
          g.drawImage(bmp, 0, 0, w, h)
          bmp.close?.()
          const jpeg = blob.type === 'image/jpeg'
          const out = await new Promise((res) => c.toBlob(res, jpeg ? 'image/jpeg' : 'image/png', 0.92))
          c.width = c.height = 0
          return out ? await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(out) }) : null
        })())
      }
      const href = await done.get(key)
      if (href) { page.items[i] = { ...n, href, w, h }; reduced++ }
    }
  }
  return reduced
}

const stemOf = (name) => String(name || 'Drawing').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 80) || 'Drawing'
const pad2 = (n, total) => String(n).padStart(String(total).length, '0')

/** Raster of one flat page: -> {blob, w, h, capped}. Text must already be outlined (an SVG picture cannot see the page's fonts). */
export async function rasterPage(page, { dpi = 96, jpg = false, transparent = false, quality = 0.92, fonts = null, signal } = {}) {
  const { pageToSvg } = await import('./_svgout.js')
  const { MAX_PIXELS } = await import('../../lib/image.js')
  const k = Math.max(0.05, Math.min(20, dpi / 72))
  let w = Math.max(1, Math.round(page.w * k)), h = Math.max(1, Math.round(page.h * k)), capped = false
  if (w * h > MAX_PIXELS) { const s = Math.sqrt(MAX_PIXELS / (w * h)); w = Math.max(1, Math.floor(w * s)); h = Math.max(1, Math.floor(h * s)); capped = true }
  const svg = pageToSvg(page, { unit: 'pt', background: jpg || !transparent ? '#ffffff' : null, fonts })
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  const canvas = document.createElement('canvas')
  try {
    const img = new Image()
    img.src = url
    await img.decode().catch(() => { throw new Error('This page could not be drawn as a picture.') })
    if (signal?.aborted) throw abort()
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (jpg || !transparent) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h) }
    ctx.drawImage(img, 0, 0, w, h)
    const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('The picture could not be saved.'))), jpg ? 'image/jpeg' : 'image/png', quality))
    return { blob, w, h, capped }
  } finally { URL.revokeObjectURL(url); canvas.width = canvas.height = 0 }
}

/**
 * Run one export. opts: {pages: 'all' | 'current' | [indexes], selection: bool, outline, dpi, transparent, quality, split, compress, bitmapAlpha, title}.
 * Resolves {files: [{name, blob}], notes, parts} (several parts are packed into one ZIP). Always drops the picture data URLs afterwards.
 */
let running = false // one save or export at a time: the picture data URLs are shared and dropped when a run ends
export async function exportDoc(fmt, opts = {}, env) {
  const F = FORMATS[fmt]
  if (!F) throw new Error('This format is not available.')
  if (running) throw new Error('Another save or export is still running. Wait for it to finish.')
  running = true
  try { return await runExport(fmt, F, opts, env) } finally { running = false }
}

async function runExport(fmt, F, opts, env) {
  const { store, assets, signal, onProgress } = env
  const o = { ...defaultsFor(fmt), ...opts }
  const progress = (f, t) => onProgress?.(Math.max(0, Math.min(1, f)), t)
  await store.whenReady()
  const root = store.root
  const title = o.title || root.title || 'Untitled'
  const stem = stemOf(title)
  let idx = o.pages === 'current' ? [store.pageIndex] : Array.isArray(o.pages) ? o.pages : root.pages.map((_, i) => i)
  let only = null, crop = null
  if (o.selection) {
    if (!['png', 'jpg', 'svg'].includes(fmt)) throw new Error('Only PNG, JPG and SVG can save just the selection.')
    const ids = store.sel.ids.filter((id) => store.find(id)?.node)
    if (!ids.length) throw new Error('Select something first, then save the selection.')
    only = new Set(ids)
    idx = [store.pageIndex]
    const nodes = ids.map((id) => store.find(id).node)
    crop = nodes.reduce((u, n) => unionBox(u, env.boxOf ? env.boxOf(n) : null), null)
    if (!crop) throw new Error('The selection has no size to save.')
  }
  progress(0, 'Preparing')
  try {
    const flat = fmt !== 'cdr'
    const outline = F.raster ? true : !!o.outline
    // live text that is centred or right aligned needs real line widths, so a measuring element is made once (browser only)
    const m = typeof document !== 'undefined' ? (await import('./_ds-text.js')).createMeasurer(env.fonts, root.uid) : null
    let r
    try {
      r = await toWriterDoc(root, { assets, pages: idx, only, flat, outline, signal, measurer: m ? (n) => m.forNode(n) : null, outliner: env.outliner, onProgress: (f) => progress(0.05 + 0.3 * f, 'Converting text to curves') })
    } finally { m?.dispose() }
    const { doc } = r
    const notes = [...r.notes]
    if (fmt !== 'svg' && !F.raster) notes.push('Colours are stored as RGB. There is no colour profile or CMYK conversion.')
    const count = (items) => items.reduce((n, it) => n + (it.t === 'group' ? count(it.items) : 1), 0)
    if (!doc.pages.some((p) => count(p.items || (p.layers || []).flatMap((l) => l.items)) > 0)) notes.push('The saved pages have no objects on them.')
    if (F.raster && r.liveText) notes.push('Some text could not be turned into curves and was drawn with a system font.')
    if (signal?.aborted) throw abort()
    progress(0.35, `Writing ${F.label}`)
    const parts = []
    const nameFor = (i, n, total) => (total > 1 ? `${stem}-${pad2(i + 1, total)}-${stemOf(doc.pages[i]?.name || `page ${i + 1}`)}.${F.ext}` : `${stem}${o.selection ? '-selection' : ''}.${F.ext}`)
    if (fmt === 'cdr') {
      let mod
      try { mod = await import('./_cdrout.js') } catch { throw new Error('Saving CDR is not available in this build. Save as AI, PDF, EPS or SVG instead.') }
      const w = await mod.writeCdr(doc, { title, textToCurves: false, signal, compress: !!o.compress, bitmapAlpha: o.bitmapAlpha === 'flatten' ? 'flatten' : 'rgba', onProgress: (f, t) => progress(0.35 + f * 0.65, t || 'Writing CDR') })
      parts.push({ name: `${stem}.cdr`, blob: w.blob })
      notes.push(...w.notes)
    } else if (fmt === 'pdf' || fmt === 'ai') {
      const { toPdf } = await import('./_pdfout.js')
      const per = o.split && doc.pages.length > 1
      const groups = per ? doc.pages.map((_, i) => [i]) : [null]
      for (const g of groups) {
        const w = await toPdf(doc, { title, ...(g ? { pages: g } : {}) })
        parts.push({ name: per ? nameFor(g[0], 0, doc.pages.length) : `${stem}.${F.ext}`, blob: w.blob })
        notes.push(...w.notes)
        progress(0.35 + 0.65 * (parts.length / groups.length), `Writing ${F.label}`)
      }
    } else if (fmt === 'eps') {
      const { epsBlob } = await import('./_eps.js')
      if (await capImages(doc, 200, signal)) notes.push('Pictures with more than 200 pixels per inch were reduced, because EPS stores pictures as plain text and would otherwise be very large.')
      for (let i = 0; i < doc.pages.length; i++) {
        if (signal?.aborted) throw abort()
        const w = await epsBlob(doc, i, { title })
        parts.push({ name: nameFor(i, 0, doc.pages.length), blob: w.blob })
        notes.push(...w.notes)
        progress(0.35 + 0.65 * ((i + 1) / doc.pages.length), 'Writing EPS')
      }
    } else if (fmt === 'svg') {
      const { pageToSvg } = await import('./_svgout.js')
      for (let i = 0; i < doc.pages.length; i++) {
        if (signal?.aborted) throw abort()
        const page = crop ? cropPage(doc.pages[i], crop, 1) : doc.pages[i]
        parts.push({ name: nameFor(i, 0, doc.pages.length), blob: new Blob([pageToSvg(page, { unit: 'mm', title, fonts: doc.fonts })], { type: 'image/svg+xml' }) })
        progress(0.35 + 0.65 * ((i + 1) / doc.pages.length), 'Writing SVG')
      }
    } else {
      for (let i = 0; i < doc.pages.length; i++) {
        if (signal?.aborted) throw abort()
        let page = doc.pages[i]
        if (crop) {
          let ink = 0
          for (const n of page.items) if (n.t === 'path' && n.stroke && n.strokeWidth > 0) ink = Math.max(ink, n.strokeWidth / 2)
          page = cropPage(page, crop, Math.ceil(ink))
        }
        const rp = await rasterPage(page, { dpi: +o.dpi || 96, jpg: fmt === 'jpg', transparent: !!o.transparent && fmt === 'png', quality: +o.quality || 0.92, fonts: doc.fonts, signal })
        if (rp.capped) notes.push(`Page ${i + 1} is too large at ${o.dpi} dpi, so it was saved smaller (${rp.w} x ${rp.h} pixels).`)
        parts.push({ name: nameFor(i, 0, doc.pages.length), blob: rp.blob, w: rp.w, h: rp.h })
        progress(0.35 + 0.65 * ((i + 1) / doc.pages.length), `Drawing page ${i + 1} of ${doc.pages.length}`)
      }
    }
    let files = parts
    if (parts.length > 1) {
      const { zip } = await import('../../lib/files.js')
      files = [{ name: `${stem}.zip`, blob: await zip(parts.map((p) => ({ name: p.name, data: p.blob }))) }]
    }
    progress(1, 'Done')
    return { files, notes: [...new Set(notes)], parts }
  } finally { assets?.dropDataUrls?.() }
}
