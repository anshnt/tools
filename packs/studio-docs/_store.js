// Document storage in IndexedDB (lib/idb.js). One record per document plus a small index for the documents list.
import * as idb from '../../lib/idb.js'
import * as store from '../../lib/store.js'

const P = 'docs-studio:'
const INDEX = `${P}index`
const docKey = (id) => `${P}doc:${id}`

let chain = Promise.resolve()
const queue = (fn) => (chain = chain.then(fn, fn))

export const newId = () => (crypto.randomUUID ? crypto.randomUUID().slice(0, 12) : Math.random().toString(36).slice(2, 14))

/** Index entries, newest first: {id, title, created, updated, words, snippet, template, untouched}. */
export async function listDocs() {
  const idx = (await idb.get(INDEX)) || []
  return [...idx].sort((a, b) => b.updated - a.updated)
}

export const getDoc = (id) => idb.get(docKey(id))

/** Save a document ({id, title, json, settings, created, updated, ...}) and refresh its index entry. Resolves false if storage is blocked. */
export function putDoc(doc, meta) {
  return queue(async () => {
    const ok = await idb.set(docKey(doc.id), doc)
    if (!ok) return false
    const idx = (await idb.get(INDEX)) || []
    const entry = { id: doc.id, title: doc.title, created: doc.created, updated: doc.updated, words: meta.words, snippet: meta.snippet, template: doc.template || null, untouched: !!doc.untouched }
    const at = idx.findIndex((d) => d.id === doc.id)
    if (at >= 0) idx[at] = entry
    else idx.push(entry)
    return idb.set(INDEX, idx)
  })
}

export function removeDoc(id) {
  return queue(async () => {
    await idb.del(docKey(id))
    const idx = ((await idb.get(INDEX)) || []).filter((d) => d.id !== id)
    return idb.set(INDEX, idx)
  })
}

export const getLast = () => store.load('docs-studio.last', null)
export const setLast = (id) => store.save('docs-studio.last', id)
export const prefs = store.persisted('docs-studio.prefs', { panel: null, view: null, zoom: 1, recent: [] })
