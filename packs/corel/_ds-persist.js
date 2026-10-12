// Draw Studio autosave: the drawing is kept in IndexedDB (lib/idb.js) while it has unsaved changes, so a closed tab or a crash loses nothing.
//   ds:autosave:doc      {v, savedAt, title, pages, root (fonts without their bytes), assetIds}
//   ds:autosave:a:<id>   one picture Blob per asset, written once
//   ds:autosave:fonts    the embedded font files, rewritten only when the set changes
// Saving is throttled (one write every 3 s at most), skipped while PDF pages are still being read, never runs during a gesture (documents change only at
// commit) and is flushed when the tab is hidden. Restoring treats the record like an untrusted file: it goes through validateDoc (whitelist copy).
import * as idb from '../../lib/idb.js'
import { LIMITS, cost, validateDoc, walkNodes } from './_ds-doc.js'

export const PREFIX = 'ds:autosave:'
export const AUTOSAVE_MS = 3000
export const MAX_BYTES = 80 * 1024 * 1024 // est. size of the document data (nodes and fonts); pictures are stored apart
const ID = /^[\w.-]{1,64}$/

/** Rough size in bytes of what the document record holds: nodes (see _ds-doc cost) plus embedded font files. */
export function estimateBytes(root) {
  let c = 2000
  walkNodes(root, (n) => { if (n.t !== 'group') c += cost(n) })
  for (const f of Object.values(root.fonts || {})) c += f.data?.length || 0
  return c
}
export function assetIdsOf(root) {
  const s = new Set()
  walkNodes(root, (n) => { if (n.t === 'image' && n.asset) s.add(n.asset) })
  return s
}
/** The document record written to storage: the root with font bytes taken out (they are stored under their own key). */
export function packRoot(root) {
  const fonts = {}
  for (const [k, f] of Object.entries(root.fonts || {})) fonts[k] = { name: f.name, family: f.family, bold: f.bold, italic: f.italic, data: null }
  return { ...root, fonts }
}

/** env: {store, assets, delay, idb (a key-value store with get, set, del, keys; tests pass a fake)}. -> {start, stop, flush, saved, peek, restore, clear, dispose, get failed} */
export function createPersist({ store, assets, delay = AUTOSAVE_MS, idb: kv = idb }) {
  let on = false, timer = 0, running = null, again = false, failed = false, warned = false
  let lastRoot = null, fontSig = ''
  const written = new Set()
  const say = (t) => store.setStatus(t)

  async function save() {
    timer = 0
    const root = store.root
    if (!on || root === lastRoot || !store.dirty) return
    if (root.pages.some((p) => p.pending)) { schedule(); return } // wait until every PDF page has been read
    if (estimateBytes(root) > MAX_BYTES) { if (!warned) { warned = true; say('This drawing is too big to autosave, so save it to a file now and then.') } return }
    const ids = assetIdsOf(root)
    for (const id of ids) {
      if (written.has(id) || !assets.has(id)) continue
      const a = assets.serialize([id])[0]
      if (!(await kv.set(`${PREFIX}a:${id}`, { id, blob: a.blob, w: a.w, h: a.h, name: a.name }))) return fail()
      written.add(id)
    }
    const sig = Object.entries(root.fonts || {}).map(([k, f]) => `${k}:${f.data?.length || 0}`).join('|')
    if (sig !== fontSig) {
      const list = Object.entries(root.fonts || {}).filter(([, f]) => f.data).map(([key, f]) => ({ key, data: f.data }))
      if (!(await kv.set(`${PREFIX}fonts`, list))) return fail()
      fontSig = sig
    }
    const rec = { v: 1, savedAt: Date.now(), title: root.title, pages: root.pages.length, root: packRoot(root), assetIds: [...ids] }
    if (!(await kv.set(`${PREFIX}doc`, rec))) return fail()
    lastRoot = root
    for (const k of await kv.keys(`${PREFIX}a:`)) if (!ids.has(k.slice(`${PREFIX}a:`.length))) { await kv.del(k); written.delete(k.slice(`${PREFIX}a:`.length)) }
  }
  function fail() { failed = true; if (!warned) { warned = true; say('Autosave is not available in this browser, so save the drawing to a file now and then.') } }
  function run() {
    if (running) { again = true; return running }
    running = save().catch((e) => { console.warn('Draw Studio: autosave failed', e); fail() }).finally(() => { running = null; if (again) { again = false; schedule() } })
    return running
  }
  function schedule() { if (on && !timer) timer = setTimeout(run, delay) }

  const offs = [store.on('doc', (e) => { if (on && !e?.load && !e?.silent && store.dirty) schedule() })]
  const onHide = () => { if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { clearTimeout(timer); timer = 0; run() } }
  const hasDom = typeof document !== 'undefined'
  if (hasDom) { document.addEventListener('visibilitychange', onHide); window.addEventListener('pagehide', onHide) }

  async function clear() {
    clearTimeout(timer); timer = 0
    for (const k of await kv.keys(PREFIX)) await kv.del(k)
    written.clear(); fontSig = ''; lastRoot = null
  }
  return {
    start() { on = true },
    stop() { on = false; clearTimeout(timer); timer = 0 },
    /** Write now (resolves when the write finished). */
    async flush() { clearTimeout(timer); timer = 0; if (running) await running; await run() },
    /** The drawing was saved to a file: the autosaved copy is no longer needed. */
    saved() { return clear() },
    clear,
    /** What is stored, without reading it all: {title, savedAt, pages} | {bad: true} | null. */
    async peek() {
      const rec = await kv.get(`${PREFIX}doc`)
      if (rec == null) return null
      if (typeof rec !== 'object' || rec.v !== 1 || !rec.root || typeof rec.root !== 'object') return { bad: true }
      return { title: String(rec.title || 'Untitled').slice(0, LIMITS.name), savedAt: Number.isFinite(rec.savedAt) ? rec.savedAt : 0, pages: Number.isInteger(rec.pages) ? rec.pages : 0 }
    },
    /**
     * Read the stored drawing back: -> {doc, notes}. The pictures go into the asset store, the record is whitelisted by validateDoc.
     * Throws a readable Error (and the caller discards the record) when it cannot be used.
     */
    async restore() {
      const rec = await kv.get(`${PREFIX}doc`)
      if (!rec || typeof rec !== 'object' || rec.v !== 1 || !rec.root || typeof rec.root !== 'object' || !Array.isArray(rec.root.pages)) throw new Error('The autosaved drawing could not be read, so it was discarded.')
      const list = []
      for (const id of (Array.isArray(rec.assetIds) ? rec.assetIds : []).slice(0, LIMITS.images)) {
        if (typeof id !== 'string' || !ID.test(id)) continue
        const a = await kv.get(`${PREFIX}a:${id}`)
        if (a && typeof a === 'object' && a.id === id) list.push(a)
      }
      const assetMap = (await assets.restore(list)) || new Map()
      const fontRows = await kv.get(`${PREFIX}fonts`)
      const fonts = {}
      for (const [k, f] of Object.entries(rec.root.fonts && typeof rec.root.fonts === 'object' ? rec.root.fonts : {})) fonts[k] = f
      for (const f of Array.isArray(fontRows) ? fontRows : []) if (f && typeof f.key === 'string' && fonts[f.key] && typeof fonts[f.key] === 'object') fonts[f.key] = { ...fonts[f.key], data: f.data }
      const { doc, notes } = validateDoc({ ...rec.root, fonts }, { assets, assetMap })
      for (const a of list) if (assetMap.get(a.id) === a.id || !assetMap.size) written.add(a.id)
      for (const n of notes) doc.warnings.push(n)
      lastRoot = null
      return { doc, notes }
    },
    get failed() { return failed },
    dispose() { on = false; clearTimeout(timer); offs.forEach((o) => o()); if (hasDom) { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onHide) } },
  }
}
