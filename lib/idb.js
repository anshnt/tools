// Tiny IndexedDB key-value store for big local data (studio projects, images, audio) that would not fit in localStorage.
// Values can be anything structured-cloneable: objects, Blobs, ArrayBuffers. Never throws: blocked storage resolves to undefined/false.
//   import * as idb from '../../lib/idb.js'
//   await idb.set('photo-studio:last', { layers, blob }); const project = await idb.get('photo-studio:last')
const DB = 'tools', STORE = 'kv'
let dbp = null
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }).catch((e) => { dbp = null; throw e })
  return dbp
}
async function run(mode, fn) {
  const d = await db()
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(req?.result)
    tx.onerror = tx.onabort = () => reject(tx.error)
  })
}
export const get = (key) => run('readonly', (s) => s.get(key)).catch(() => undefined)
export const set = (key, value) => run('readwrite', (s) => s.put(value, key)).then(() => true, () => false)
export const del = (key) => run('readwrite', (s) => s.delete(key)).then(() => true, () => false)
/** keys('photo-studio:') lists keys with that prefix. */
export const keys = (prefix = '') => run('readonly', (s) => s.getAllKeys()).then((k) => (k || []).filter((x) => String(x).startsWith(prefix)), () => [])
