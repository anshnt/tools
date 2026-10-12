// Draw Studio: open files. Sniffs by CONTENT (a PDF saved as .ai is a PDF), runs the matching reader through a dynamic import, and turns the
// reader's flat or tree document into an editor document: whitelisted copy (validateDoc), fresh ids, images moved into the Blob asset store,
// fonts merged under unique keys. Nothing here touches the DOM tree of the app; the shell shows progress, errors and the password prompt.
//
//   openFile(file, env) -> {doc, rest?, kind}     doc is a validated EditorDoc (not yet in the store); rest(ctx) fills pending PDF pages
//   env = {assets, signal, progress(text, fraction), askPassword(message) -> Promise<string|null>}
//   OpenError carries {code, warnings, preview} so the shell can offer "Open the preview image only" for unreadable CDR files.
import { isTree, treeFromFlat, walkTree } from './_tree.js'
import { LIMITS, newDoc, newLayer, validateDoc, walkNodes } from './_ds-doc.js'
import { yieldToMain } from '../../lib/ui.js'
import { baseName } from '../../lib/files.js'

export class OpenError extends Error {
  constructor(message, extra = {}) { super(message); this.name = 'OpenError'; Object.assign(this, extra) }
}
const abort = () => Object.assign(new Error('Cancelled'), { code: 'ABORT' })
const ascii = (b, at, n) => String.fromCharCode(...b.subarray(at, at + n))

export const ACCEPT = '.cdr,.cdt,.ai,.eps,.ps,.pdf,.svg,.svgz,image/*,.heic,.heif'
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'])
const BITMAPS = new Set(['png', 'jpeg', 'gif', 'bmp', 'webp', 'heic'])

/** File kind from the first bytes (and the name only to tell a CDR zip from other zips): 'pdf' | 'ps' | 'cdr' | 'svg' | 'svgz' | 'png' | 'jpeg' | 'gif' | 'bmp' | 'webp' | 'heic' | null. */
export function sniff(b, name = '') {
  const named = /\.(cdr|cdt)$/i.test(name) // a damaged or mislabelled .cdr still goes to the CDR reader, which explains what is wrong
  if (!b || b.length < 4) return named ? 'cdr' : null
  const head = ascii(b, 0, Math.min(1024, b.length))
  if (head.includes('%PDF-')) return 'pdf'
  if ((b[0] === 0x25 && b[1] === 0x21) || (b[0] === 0xc5 && b[1] === 0xd0 && b[2] === 0xd3 && b[3] === 0xc6)) return 'ps'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) {
    if (/^cdr/i.test(ascii(b, 8, 3))) return 'cdr'
    if (ascii(b, 8, 4) === 'WEBP') return 'webp'
    return null
  }
  if (b[0] === 0x50 && b[1] === 0x4b && /\.(cdr|cdt)$/i.test(name)) return 'cdr'
  if (b[0] === 0x1f && b[1] === 0x8b) return 'svgz'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif'
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp'
  if (ascii(b, 4, 4) === 'ftyp' && HEIC_BRANDS.has(ascii(b, 8, 4))) return 'heic'
  const text = new TextDecoder('utf-8').decode(b.subarray(0, Math.min(4096, b.length))).replace(/^﻿/, '')
  if (/^\s*<\?xml/i.test(text) || /<svg[\s>]/i.test(text)) return 'svg'
  return named ? 'cdr' : null
}

// ---------- fonts: merge the font tables of several reader calls ----------
/** Several reader calls (PDF pages come in chunks) may return the same font under different keys. Keys get a call prefix and records with the same name and size are one font. */
export function createFontMerger() {
  const all = {}
  const byIdentity = new Map() // name|bytes -> key
  let calls = 0
  return {
    all,
    /** -> {map: {readerKey: editorKey}} and registers new records in `all`. */
    merge(fonts) {
      const call = calls++
      const map = {}
      for (const rk of Object.keys(fonts || {})) {
        const rec = fonts[rk]
        if (!rec || typeof rec !== 'object') continue
        const ident = `${rec.name}|${rec.data ? rec.data.length : -1}`
        let key = byIdentity.get(ident)
        if (!key || !rec.data) {
          const base = `f${call}:${String(rk).replace(/[^\w.-]/g, '_').slice(0, 40)}`
          key = base
          for (let i = 2; key in all; i++) key = `${base}_${i}`
          all[key] = rec
          if (rec.data) byIdentity.set(ident, key)
        }
        map[rk] = key
      }
      return { map }
    },
  }
}

// ---------- image hrefs -> assets ----------
const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) } return (h >>> 0).toString(36) }
const hrefKey = (href) => (href.length < 200 ? href : `${fnv(href)}:${href.length}`)

/** Rasterise an image/svg+xml href once (an SVG image cannot be kept as SVG), to a blob: URL. */
async function rasterSvg(href, w, h) {
  const img = new Image()
  img.src = href
  await img.decode()
  const k = Math.min(1, 2048 / Math.max(w || img.naturalWidth || 300, h || img.naturalHeight || 150))
  const cw = Math.max(1, Math.round((w || img.naturalWidth || 300) * k)), ch = Math.max(1, Math.round((h || img.naturalHeight || 150) * k))
  const c = document.createElement('canvas')
  c.width = cw; c.height = ch
  c.getContext('2d').drawImage(img, 0, 0, cw, ch)
  const blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not draw an embedded SVG picture.'))), 'image/png'))
  c.width = c.height = 0
  return URL.createObjectURL(blob)
}

/** Default href resolver: data: and blob: URLs become Blob assets (native fetch, no re-encode). */
function defaultResolve(assets) {
  const cache = new Map()
  return (href) => {
    const key = hrefKey(href)
    if (!cache.has(key)) cache.set(key, (async () => { const blob = await (await fetch(href)).blob(); return assets.addBlob(blob, '', { key }) })())
    return cache.get(key)
  }
}

/**
 * Reader result (flat or tree) -> validated EditorDoc plus notes. Runs on every reader result.
 * o: {assets, signal, resolve(href) -> {id, w, h} (optional), merger (font merger), freshIds (id factory), title, source, name, units}
 */
export async function normalizeDoc(raw, o) {
  const { assets, signal, merger = createFontMerger(), freshIds = true } = o
  const tree = isTree(raw) ? { ...raw } : treeFromFlat(raw)
  const made = []
  try {
    walkTree(tree, (n) => { if (n.t === 'image' && typeof n.href === 'string' && n.href.startsWith('blob:')) made.push(n.href) })
    // fonts: unique keys; text that names an unknown font loses it (and its glyphs)
    const { map } = merger.merge(raw.fonts)
    walkTree(tree, (n) => {
      if (n.t !== 'text' || n.font == null) return
      if (Object.hasOwn(map, n.font)) n.font = map[n.font]
      else { delete n.font; delete n.glyphs }
    })
    tree.fonts = merger.all
    // SVG pictures inside a drawing are rasterised once
    const svgs = []
    walkTree(tree, (n) => { if (n.t === 'image' && typeof n.href === 'string' && /^data:image\/svg\+xml/i.test(n.href)) svgs.push(n) })
    for (const n of svgs) {
      if (signal?.aborted) throw abort()
      try { n.href = await rasterSvg(n.href, n.w, n.h); made.push(n.href) } catch { n.href = '' }
    }
    const { doc, notes } = validateDoc(tree, { freshIds })
    if (o.title) doc.title = o.title
    doc.meta = { source: o.source || 'import', name: String(o.name || '').slice(0, LIMITS.name) }
    if (o.units) doc.units = o.units

    // images: href -> asset
    const imgs = []
    walkNodes(doc, (n) => { if (n.t === 'image' && n.href) imgs.push(n) })
    const resolve = o.resolve || defaultResolve(assets)
    let bad = 0, why = ''
    for (let i = 0; i < imgs.length; i += 3) {
      if (signal?.aborted) throw abort()
      await Promise.all(imgs.slice(i, i + 3).map(async (n) => {
        const href = n.href
        delete n.href
        try { const a = await resolve(href); n.asset = a.id; n.w = a.w; n.h = a.h } catch (e) { n.bad = true; bad++; why ||= e?.message || '' }
      }))
      if (i && i % 12 === 0) await yieldToMain()
    }
    if (bad) {
      const prune = (items) => items.filter((n) => !n.bad).map((n) => { if (n.t === 'group') n.items = prune(n.items); return n }).filter((n) => n.t !== 'group' || n.items.length)
      for (const p of doc.pages) for (const l of p.layers) l.items = prune(l.items)
      notes.push(`${bad} picture${bad === 1 ? '' : 's'} could not be read and ${bad === 1 ? 'was' : 'were'} skipped${why ? ` (${why})` : ''}.`)
    }
    // fonts a reader returned but no text uses stay out of the document
    const used = new Set()
    walkNodes(doc, (n) => { if (n.t === 'text' && n.font != null) used.add(n.font) })
    for (const k of Object.keys(doc.fonts)) if (!used.has(k)) delete doc.fonts[k]
    doc.warnings = [...doc.warnings, ...notes]
    return { doc, notes }
  } finally {
    for (const u of made) URL.revokeObjectURL(u)
  }
}
export const normalizeFlatDoc = normalizeDoc

// ---------- CDR -> tree (layers and groups kept) ----------
/**
 * Parsed CDR (readCdr result) -> tree doc {pages:[{w,h,name,layers:[{name,hidden,locked,printable,items}]}], warnings, bitmaps}.
 * Bitmaps arrive as the tokens ds-asset:<n> (resolved by the caller from `bitmaps`: token -> {w,h,rgba}), so this runs without a DOM.
 */
export async function cdrToTree(cdr) {
  const { buildDoc, pageModel } = await import('./_cdrdoc.js')
  const doc = buildDoc(cdr)
  const bitmaps = new Map(), tokens = new WeakMap()
  const bitmapHref = (bmp) => { let t = tokens.get(bmp); if (!t) { t = `ds-asset:${bitmaps.size + 1}`; tokens.set(bmp, t); bitmaps.set(t, bmp) } return t }
  const warnings = [...doc.warnings]
  let idxs = doc.pages.map((_, i) => i).filter((i) => !doc.pages[i].master)
  if (!idxs.length) idxs = doc.pages.map((_, i) => i)
  const pages = []
  let placeholders = 0
  for (const i of idxs) {
    const r = pageModel(doc.pages[i], { showHidden: true, bitmapHref })
    for (const w of r.warnings) if (!warnings.includes(w)) warnings.push(w)
    const layers = [], layerOut = new Map(), groupOut = new Map()
    const layerFor = (l) => {
      let L = layerOut.get(l)
      if (!L) {
        const real = l.type === 0 // guide, grid and desktop layers stay in the file but hidden, locked and off the print
        L = { name: l.name, hidden: !l.visible || !real, locked: !real, printable: real, items: [] }
        layerOut.set(l, L); layers.push(L)
      }
      return L
    }
    for (const it of r.page.items) {
      if (it.placeholder) { placeholders++; continue }
      const node = doc.index.get(it.id)
      let into = node ? layerFor(node.layer).items : (layerFor({ name: 'Layer 1', type: 0, visible: true }).items)
      const chain = []
      for (let p = node?.parent; p; p = p.parent) chain.unshift(p)
      for (const g of chain) {
        let G = groupOut.get(g)
        if (!G) { G = { t: 'group', name: g.name || 'Group', items: [] }; groupOut.set(g, G); into.push(G) }
        into = G.items
      }
      const leaf = { ...it }
      if (node?.name && leaf.name == null) leaf.name = node.name
      into.push(leaf)
    }
    pages.push({ w: r.page.w, h: r.page.h, name: r.page.name || `Page ${pages.length + 1}`, layers })
  }
  if (placeholders) warnings.push(`${placeholders} object${placeholders === 1 ? '' : 's'} could not be read and ${placeholders === 1 ? 'is' : 'are'} not shown.`)
  if (doc.pages.some((p) => p.master && p.layers.some((l) => l.type === 0 && l.objects.length))) warnings.push('Master page objects are not shown.')
  return { pages, warnings, bitmaps }
}

// ---------- readers ----------
const baseTitle = (name) => baseName(name || '') || 'Untitled'

async function openCdr(bytes, file, env) {
  const { jszip } = await import('../../lib/libs.js')
  const { readCdr } = await import('./_cdr.js')
  const { leaves } = await import('./_cdrdoc.js')
  let cdr
  env.progress?.('Reading the drawing', null)
  try { cdr = await readCdr(bytes, { JSZip: bytes[0] === 0x50 ? await jszip() : null }) } catch (e) { console.warn('Draw Studio: CDR reader failed', e); cdr = { failed: true, warnings: ['The file could not be read.'], pages: [], preview: null } }
  const usable = cdr.pages.some((p) => !p.master && p.layers.some((l) => [...leaves(l.objects)].length))
  if (cdr.failed || !usable) throw new OpenError('This drawing could not be opened.', { code: 'UNREADABLE', warnings: cdr.warnings?.length ? cdr.warnings : ['The drawing could not be read.'], preview: cdr.preview || null })
  const tree = await cdrToTree(cdr)
  const pending = new Map()
  const resolve = (token) => {
    if (!pending.has(token)) { const b = tree.bitmaps.get(token); pending.set(token, b ? env.assets.addRgba(b.rgba, b.w, b.h) : Promise.reject(new Error('A bitmap was missing.'))) }
    return pending.get(token)
  }
  env.progress?.('Building the pages', null)
  const { doc } = await normalizeDoc(tree, { assets: env.assets, signal: env.signal, resolve, title: baseTitle(file.name), source: 'cdr', name: file.name })
  if (cdr.versionName) doc.meta.ver = cdr.version
  return { doc, kind: 'cdr' }
}

async function openPdf(bytes, file, env) {
  const { pdfToDoc } = await import('./_pdfin.js')
  let password
  const call = async (pages, label) => {
    for (;;) {
      try { return await pdfToDoc(bytes, { pages, password, images: 'blob', signal: env.signal, onProgress: (f, t) => env.progress?.(t || label, f ?? null) }) } catch (e) {
        if (e?.code !== 'PASSWORD') throw e
        const p = await env.askPassword?.(e.message)
        if (p == null) throw abort()
        password = p
      }
    }
  }
  env.progress?.('Reading page 1', null)
  const first = await call([1], 'Reading page 1')
  const numPages = Math.max(1, first.numPages || first.pages.length)
  const merger = createFontMerger()
  const ids = { n: 1 }
  const fresh = () => ids.n++
  const { doc } = await normalizeDoc(first, { assets: env.assets, signal: env.signal, merger, freshIds: fresh, title: baseTitle(file.name), source: file.name.toLowerCase().endsWith('.ai') ? 'ai' : 'pdf', name: file.name })
  const keep = Math.min(numPages, LIMITS.pages)
  if (numPages > keep) doc.warnings.push(`Only the first ${LIMITS.pages} pages were opened.`)
  const first1 = doc.pages[0]
  const placeholders = []
  for (let n = 2; n <= keep; n++) {
    const pg = { id: fresh(), name: `Page ${n}`, w: first1.w, h: first1.h, layers: [newLayer(fresh())], guides: [], pending: { n } }
    placeholders.push(pg); doc.pages.push(pg)
  }
  doc.nextId = ids.n
  /** Fill the pending pages in chunks of 6, one at a time, with a yield in between. ctx: {store, fonts, signal, onPage(n)} */
  const rest = async (ctx) => {
    try {
      for (let at = 0; at < placeholders.length; at += 6) {
        const slice = placeholders.slice(at, at + 6)
        const nums = slice.map((p) => p.pending.n)
        const r = await call(nums, `Reading page ${nums[0]} of ${keep}`)
        if (ctx.signal?.aborted) throw abort()
        const { doc: part } = await normalizeDoc({ pages: r.pages, warnings: [], fonts: r.fonts }, { assets: env.assets, signal: ctx.signal, merger, freshIds: ctx.store.newId, source: 'pdf', name: file.name })
        if (ctx.signal?.aborted || ctx.store.root.fonts !== doc.fonts) throw abort() // another file was opened meanwhile
        const newFonts = Object.fromEntries(Object.entries(part.fonts).filter(([k]) => !(k in ctx.store.root.fonts)))
        // the single sanctioned in-place edit: the placeholder objects are shared by every history snapshot
        ctx.store.silent((root) => {
          Object.assign(root.fonts, newFonts)
          slice.forEach((ph, i) => {
            const src = part.pages[i]
            if (src) Object.assign(ph, { w: src.w, h: src.h, layers: src.layers })
            delete ph.pending
          })
        })
        await ctx.fonts?.add(newFonts)
        for (const ph of slice) ctx.onPage?.(ph)
        await yieldToMain()
      }
    } finally { /* the closure over the file bytes ends here */ }
  }
  return { doc, rest: placeholders.length ? rest : null, kind: 'pdf' }
}

async function openPs(bytes, file, env) {
  let mod
  try { mod = await import('./_psin.js') } catch { throw new OpenError('EPS, PS and older AI files are not supported in this build yet. Save the drawing as a PDF-compatible AI, PDF or SVG file and open that.', { code: 'NOREADER' }) }
  if (mod.isPostScript && !mod.isPostScript(bytes)) throw new OpenError('This file starts like PostScript but could not be recognised.', { code: 'UNREADABLE' })
  env.progress?.('Reading PostScript', null)
  const r = await mod.psToDoc(bytes, { signal: env.signal, onProgress: (f, t) => env.progress?.(t || 'Reading PostScript', f) })
  const { doc } = await normalizeDoc(r, { assets: env.assets, signal: env.signal, title: baseTitle(file.name), source: /\.eps$/i.test(file.name) ? 'eps' : 'ps', name: file.name })
  return { doc, kind: 'ps' }
}

async function openSvg(bytes, file, env, gz) {
  let text
  if (gz) {
    if (typeof DecompressionStream === 'undefined') throw new OpenError('This browser cannot unpack compressed SVG (.svgz) files.')
    let buf
    try { buf = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() } catch { throw new OpenError('This compressed SVG file could not be unpacked.') }
    if (buf.byteLength > 120 * 1024 * 1024) throw new OpenError('This SVG is too large to open here.')
    text = new TextDecoder('utf-8').decode(buf)
  } else text = new TextDecoder('utf-8').decode(bytes)
  env.progress?.('Reading the SVG', null)
  const { svgToDoc } = await import('./_svgin.js')
  const r = await svgToDoc(text)
  const { doc } = await normalizeDoc(r, { assets: env.assets, signal: env.signal, title: baseTitle(file.name), source: 'svg', name: file.name })
  return { doc, kind: 'svg' }
}

/** A bitmap becomes one page at 96 dpi (px * 0.75 pt, scaled down to the page limit) holding one Image object. */
export async function openBitmap(blob, name, env) {
  const a = await env.assets.addBlob(blob, name)
  const k = Math.min(1, LIMITS.pageSize / Math.max(a.w * 0.75, a.h * 0.75))
  const w = Math.max(1, a.w * 0.75 * k), h = Math.max(1, a.h * 0.75 * k)
  const doc = newDoc({ title: baseTitle(name), w, h, source: 'bitmap' })
  doc.meta.name = name
  const layer = doc.pages[0].layers[0]
  const img = { id: doc.nextId, t: 'image', name: 'Bitmap', asset: a.id, w: a.w, h: a.h, m: [w, 0, 0, h, 0, 0], opacity: 1 }
  doc.nextId++
  doc.pages[0] = { ...doc.pages[0], name: 'Page 1', layers: [{ ...layer, items: [img] }] }
  return { doc, kind: 'bitmap' }
}

/** Read one file into an editor document. Throws OpenError (readable message) or an Error with code 'ABORT'. */
export async function openFile(file, env) {
  if (file.size > LIMITS.fileBytes) throw new OpenError('That file is very large (over 250 MB). Try a smaller one.', { code: 'TOOBIG' })
  env.progress?.('Reading the file', null)
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (env.signal?.aborted) throw abort()
  const kind = sniff(bytes, file.name)
  try {
    if (kind === 'pdf') return await openPdf(bytes, file, env)
    if (kind === 'cdr') return await openCdr(bytes, file, env)
    if (kind === 'ps') return await openPs(bytes, file, env)
    if (kind === 'svg' || kind === 'svgz') return await openSvg(bytes, file, env, kind === 'svgz')
    if (kind === 'heic') {
      env.progress?.('Converting the photo', null)
      const { heicToBlob } = await import('../../lib/image.js')
      return await openBitmap(await heicToBlob(file), file.name, env)
    }
    if (BITMAPS.has(kind)) return await openBitmap(file, file.name, env)
  } catch (e) {
    if (e instanceof OpenError || e?.code === 'ABORT' || e?.name === 'AbortError') throw e
    console.warn('Draw Studio: could not open', file.name, e)
    throw new OpenError(e?.message || 'This file could not be opened.', { code: 'FAILED' })
  }
  throw new OpenError('This file type is not recognised. Draw Studio opens CDR, AI, PDF, EPS, SVG and picture files (PNG, JPG, WebP, GIF, BMP, HEIC).', { code: 'UNKNOWN' })
}

/** The ids of image assets a document uses. */
export function assetIds(doc) {
  const s = new Set()
  walkNodes(doc, (n) => { if (n.t === 'image' && n.asset) s.add(n.asset) })
  return s
}
