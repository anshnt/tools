// Draw Studio fonts: registers the font files embedded in a document as FontFace objects under generated family names, so text that came
// from a PDF draws with its own letter shapes (glyph mode, contract C2). Family names are generated (ds<uid>-<key>), never taken from the file.
// Only the browser's own font sanitiser ever parses the bytes. A face that fails to load is marked broken and its text falls back to the
// family stack. Later milestones add the font list, Add font file, in-place editing and Convert to curves to this module.
import { LIMITS } from './_ds-doc.js'
import { faceFamily } from './_ds-text-model.js'

const LOAD_MS = 3000
const withCap = (p, ms) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('Font load timed out')), ms); p.then((v) => { clearTimeout(t); res(v) }, (e) => { clearTimeout(t); rej(e) }) })

/** Font registry for the open document. `faces` (this object) is what the renderer asks: ok(key) and family(key). */
export function createFonts({ store }) {
  const state = new Map() // key -> {family, face, status: 'loading' | 'ok' | 'broken'}
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
  /** Replace the registry with the fonts of a newly opened document. */
  async function use(fonts, uid) { clear(); await add(fonts, uid, { emit: false }) } // the document load that follows draws the text
  function clear() {
    for (const e of state.values()) if (e.face) { try { document.fonts.delete(e.face) } catch { /* gone already */ } }
    state.clear()
    broken = 0
  }
  return {
    add, use, clear,
    ok: (key) => state.get(key)?.status === 'ok',
    family: (key) => state.get(key)?.family,
    status: (key) => state.get(key)?.status || 'none',
    get broken() { return broken },
    get size() { return state.size },
    dispose: clear,
  }
}
