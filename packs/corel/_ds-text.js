// Draw Studio fonts: registers the font files embedded in a document as FontFace objects under generated family names, so text that came
// from a PDF draws with its own letter shapes (glyph mode, contract C2). Family names are generated (ds<uid>-<key>), never taken from the file.
// Only the browser's own font sanitiser ever parses the bytes. A face that fails to load is marked broken and its text falls back to the
// family stack. Also here: the three bundled families (loaded lazily, the same files the curves export draws), Add font file, and the
// helper behind Convert to curves.
import { LIMITS, walkNodes } from './_ds-doc.js'
import { BUNDLED_FAMILIES, faceFamily, readFontNames } from './_ds-text-model.js'
import { VERSIONS } from './_libs.js'
import { yieldToMain } from '../../lib/ui.js'

const LOAD_MS = 3000, BUNDLED_MS = 8000
const withCap = (p, ms) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('Font load timed out')), ms); p.then((v) => { clearTimeout(t); res(v) }, (e) => { clearTimeout(t); rej(e) }) })

// Free fonts (OFL) served by Fontsource: the same files _libs.js loads for outlines, so what you see equals what a curves export draws.
const jsd = (path) => `https://cdn.jsdelivr.net/npm/${path}`
const SLUG = { Inter: 'inter', 'Noto Serif': 'noto-serif', 'Roboto Mono': 'roboto-mono' }
const bundledUrl = (family, w) => jsd(`@fontsource/${SLUG[family]}@${VERSIONS.fontsource}/files/${SLUG[family]}-latin-${w}-normal.woff`)

/** Font registry for the open document. `faces` (this object) is what the renderer asks: ok(key) and family(key). */
export function createFonts({ store }) {
  const state = new Map() // key -> {family, face, status: 'loading' | 'ok' | 'broken'}
  const bundled = new Map() // family -> Promise (loaded once per page load; these faces are shared by every document)
  const bundledFaces = []
  let broken = 0

  /** Register the records of `fonts` ({key: {name, family, bold, italic, data}}) that are not registered yet. Resolves when every load settled (3 s cap each). */
  async function add(fonts, uid = store.root.uid, { emit = true } = {}) {
    const jobs = []
    let bytes = 0
    for (const key of Object.keys(fonts || {})) {
      const rec = fonts[key]
      if (state.has(key) || !rec?.data || !(rec.data instanceof Uint8Array)) continue
      const family = faceFamily(uid, key)
      bytes += rec.data.length
      if (rec.data.length > LIMITS.fontBytes || typeof FontFace === 'undefined') { state.set(key, { family, face: null, status: 'broken' }); broken++; continue }
      let face
      try { face = new FontFace(family, rec.data, { weight: rec.bold ? '700' : '400', style: rec.italic ? 'italic' : 'normal' }) } catch { state.set(key, { family, face: null, status: 'broken' }); broken++; continue }
      const entry = { family, face, status: 'loading' }
      state.set(key, entry)
      jobs.push(withCap(face.load(), LOAD_MS).then(() => { document.fonts.add(face); entry.status = 'ok' }, () => { entry.status = 'broken'; entry.face = null; broken++ }))
    }
    if (jobs.length) { await Promise.all(jobs); if (emit) store.emit('fonts') }
    return bytes
  }

  /** Load the bundled faces (regular and bold) of the given families, once. Redraws text when they arrive. Never throws (offline keeps the system font). */
  function needBundled(families) {
    const jobs = []
    for (const f of new Set(families)) {
      if (!SLUG[f] || bundled.has(f) || typeof FontFace === 'undefined') continue
      const job = Promise.all(['400', '700'].map(async (w) => {
        const face = new FontFace(f, `url(${bundledUrl(f, w)})`, { weight: w, style: 'normal' })
        await withCap(face.load(), BUNDLED_MS)
        document.fonts.add(face)
        bundledFaces.push(face)
      })).then(() => true, () => false)
      bundled.set(f, job)
      jobs.push(job)
    }
    if (!jobs.length) return Promise.resolve(false)
    return Promise.all(jobs).then((r) => { if (r.some(Boolean)) store.emit('fonts'); return r.some(Boolean) })
  }
  /** Which bundled families a document's text uses (a walk over every node, once per load). */
  function scanBundled(root) {
    const used = new Set()
    walkNodes(root, (n) => { if (n.t === 'text' && BUNDLED_FAMILIES.includes(n.family)) used.add(n.family) })
    return needBundled(used)
  }

  /** Replace the registry with the fonts of a newly opened document. */
  async function use(fonts, uid) { clear(); await add(fonts, uid, { emit: false }) } // the document load that follows draws the text
  function clear() {
    for (const e of state.values()) if (e.face) { try { document.fonts.delete(e.face) } catch { /* gone already */ } }
    state.clear()
    broken = 0
  }

  /**
   * Add a font file the user picked (TrueType, OpenType, WOFF or WOFF2) to the document's fonts. The shared fonts object is extended in place
   * (never replaced, the reader's pending pages and history share it). Resolves {key, rec}; throws a readable Error when the font cannot be used.
   */
  async function addFile(file) {
    if (file.size > LIMITS.fontBytes) throw new Error('That font file is larger than 20 MB, which is too big to use here.')
    const data = new Uint8Array(await file.arrayBuffer())
    const root = store.root
    if (Object.values(root.fonts).reduce((s, f) => s + (f.data?.length || 0), 0) + data.length > LIMITS.fontsBytes) throw new Error('This drawing already holds 64 MB of fonts, which is the most it can keep.')
    const info = readFontNames(data)
    const fromName = String(file.name || 'Font').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/[<>{};"\\]/g, '').trim().slice(0, 80) || 'Font'
    const rec = { name: info?.postscript || fromName, family: info?.family || fromName, bold: !!info?.bold, italic: !!info?.italic, data }
    const stem = rec.name.replace(/[^\w.-]/g, '_').slice(0, 40) || 'font'
    let key = `u:${stem}`
    for (let i = 2; key in root.fonts; i++) key = `u:${stem}_${i}`
    root.fonts[key] = rec
    await add({ [key]: rec }, root.uid, { emit: false })
    if (!state.has(key) || state.get(key).status !== 'ok') {
      delete root.fonts[key]
      state.delete(key)
      throw new Error('This font file could not be used. It may be damaged or not a font.')
    }
    store.emit('fonts')
    return { key, rec }
  }

  return {
    add, use, clear, addFile, needBundled, scanBundled,
    ok: (key) => state.get(key)?.status === 'ok',
    family: (key) => state.get(key)?.family,
    status: (key) => state.get(key)?.status || 'none',
    get broken() { return broken },
    get size() { return state.size },
    dispose() { clear(); for (const f of bundledFaces) { try { document.fonts.delete(f) } catch { /* gone */ } } bundledFaces.length = 0; bundled.clear() },
  }
}

const PATH_DEFAULTS = { fillOpacity: 1, rule: 'nonzero', stroke: null, strokeWidth: 0, strokeOpacity: 1, cap: 0, join: 0, miter: 4, dash: null, dashOffset: 0 }
/**
 * Outline text nodes (outlineDoc from _text.js: exact outlines from an embedded font when there is one, else a bundled font). Resolves
 * {map: Map(id -> path node, or null when nothing was drawn), kept: number of nodes it could not outline (they stay text)}. One node per
 * call, so every result maps back to its source. fonts = the document's fonts object.
 */
export async function outlineNodes(nodes, fonts, { signal } = {}) {
  const { outlineDoc } = await import('./_text.js')
  const map = new Map()
  let kept = 0
  for (let i = 0; i < nodes.length; i++) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
    const n = nodes[i]
    const pseudo = { pages: [{ items: [n] }], fonts }
    const r = await outlineDoc(pseudo)
    const out = pseudo.pages[0].items
    if (r.kept || (out[0] && out[0].t === 'text')) { kept++; continue }
    map.set(n.id, out[0] ? { ...PATH_DEFAULTS, ...out[0], id: n.id } : null)
    if (i % 25 === 24) await yieldToMain()
  }
  return { map, kept }
}
