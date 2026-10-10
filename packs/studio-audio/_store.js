// Persistence: autosave to IndexedDB (project JSON plus the audio blobs) and project files (ZIP with the audio inside).
import * as idb from '../../lib/idb.js'
import { jszip } from '../../lib/libs.js'
import { zip } from '../../lib/files.js'
import { usedAssets } from './_model.js'

const key = (ns, k) => `audio-studio:${ns}:${k}`
const FORMAT = 'audio-studio-project'

/** Save the project and any audio not stored yet. Returns false when storage is blocked or full. */
export async function saveAuto(ns, project, assets, stored) {
  const used = usedAssets(project)
  for (const id of used) {
    if (stored.has(id)) continue
    const a = assets.get(id)
    if (!a?.blob) continue
    if (!(await idb.set(key(ns, `a:${id}`), { name: a.name, blob: a.blob }))) return false
    stored.add(id)
  }
  const ok = await idb.set(key(ns, 'project'), { project, savedAt: Date.now(), assets: [...used] })
  const prefix = key(ns, 'a:')
  for (const k of await idb.keys(prefix)) {
    const id = String(k).slice(prefix.length)
    if (!used.has(id)) { await idb.del(k); stored.delete(id) }
  }
  return ok
}

/** Last autosaved project and its audio blobs, or null. */
export async function loadAuto(ns) {
  const rec = await idb.get(key(ns, 'project'))
  if (!rec?.project) return null
  const assets = []
  for (const id of rec.assets || []) {
    const a = await idb.get(key(ns, `a:${id}`))
    if (a?.blob) assets.push({ id, name: a.name, blob: a.blob })
  }
  return { project: rec.project, assets, savedAt: rec.savedAt }
}

export async function clearAuto(ns) {
  await idb.del(key(ns, 'project'))
  for (const k of await idb.keys(key(ns, 'a:'))) await idb.del(k)
}

/** Project as a ZIP: project.json plus assets/<id>.<ext>. */
export async function projectToZip(project, assets) {
  const entries = []
  const meta = []
  for (const id of usedAssets(project)) {
    const a = assets.get(id)
    if (!a?.blob) continue
    const file = `assets/${id}.${a.blobExt || 'bin'}`
    entries.push({ name: file, data: a.blob })
    meta.push({ id, name: a.name, file })
  }
  entries.unshift({ name: 'project.json', data: JSON.stringify({ format: FORMAT, version: 1, project, assets: meta }, null, 1) })
  return zip(entries)
}

export async function projectFromZip(file) {
  const JSZip = await jszip()
  let z
  try { z = await JSZip.loadAsync(file) } catch { throw new Error('That file is not an Audio Studio project (it is not a ZIP).') }
  const entry = z.file('project.json')
  if (!entry) throw new Error('That ZIP does not contain an Audio Studio project.')
  let doc
  try { doc = JSON.parse(await entry.async('string')) } catch { throw new Error('The project file is damaged.') }
  if (doc.format !== FORMAT || !doc.project) throw new Error('That ZIP does not contain an Audio Studio project.')
  const assets = []
  for (const m of doc.assets || []) {
    const f = z.file(m.file)
    if (f) assets.push({ id: m.id, name: m.name, blob: await f.async('blob') })
  }
  return { project: doc.project, assets }
}
