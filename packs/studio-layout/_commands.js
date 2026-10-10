// Undoable document operations used by the canvas, the panels and the keyboard shortcuts. Every function goes through store.exec.
import { uid, findItem, containers, aabb, unionBox, cloneMany, newPage, para, newItem, layerIndex, getPage, getMaster, columnWidth, round } from './_model.js'

const itemsOf = (doc, ids) => ids.map((id) => findItem(doc, id)).filter(Boolean)

export function updateItems(store, ids, patch, key) {
  store.exec('Edit', (doc) => {
    for (const { item } of itemsOf(doc, ids)) Object.assign(item, typeof patch === 'function' ? patch(item) : patch)
  }, { key: key ? `${key}:${ids.join(',')}` : undefined })
}

/** Remove frames: unlinks text threads cleanly and drops stories nobody shows any more. */
export function deleteItems(store, ids) {
  store.exec('Delete', (doc) => {
    for (const id of ids) {
      const f = findItem(doc, id)
      if (!f) continue
      if (f.item.type === 'text') {
        const prev = containers(doc).flatMap(({ c }) => c.items).find((i) => i.type === 'text' && i.next === id)
        if (prev) prev.next = f.item.next
      }
      f.container.items.splice(f.index, 1)
    }
    gcStories(doc)
  })
}
export function gcStories(doc) {
  const used = new Set()
  for (const { c } of containers(doc)) for (const it of c.items) if (it.type === 'text') used.add(it.story)
  for (const sid of Object.keys(doc.stories)) if (!used.has(sid)) delete doc.stories[sid]
  const ids = new Set(containers(doc).flatMap(({ c }) => c.items.map((i) => i.id)))
  for (const { c } of containers(doc)) for (const it of c.items) if (it.type === 'text' && it.next && !ids.has(it.next)) it.next = null
}

export function duplicateItems(store, ids, dx = 12, dy = 12) {
  const out = []
  store.exec('Duplicate', (doc) => {
    const list = itemsOf(doc, ids)
    for (const container of new Set(list.map((l) => l.container))) {
      for (const c of cloneMany(doc, list.filter((l) => l.container === container).map((l) => l.item), dx, dy)) { container.items.push(c); out.push(c.id) }
    }
  })
  return out
}

/** Group frames so they select and move as one. Ungrouping removes the group id. */
export function groupItems(store, ids) {
  store.exec('Group', (doc) => {
    const list = itemsOf(doc, ids)
    if (list.length < 2) return
    const g = uid('g')
    for (const { item } of list) item.grp = g
  })
}
export function ungroupItems(store, ids) {
  store.exec('Ungroup', (doc) => { for (const { item } of itemsOf(doc, ids)) delete item.grp })
}

export function reorder(store, ids, how) {
  store.exec('Arrange', (doc) => {
    for (const container of new Set(itemsOf(doc, ids).map((l) => l.container))) {
      const sel = container.items.filter((i) => ids.includes(i.id))
      const rest = container.items.filter((i) => !ids.includes(i.id))
      if (how === 'front') container.items = [...rest, ...sel]
      else if (how === 'back') container.items = [...sel, ...rest]
      else {
        const items = container.items
        const order = how === 'forward' ? [...items.keys()].reverse() : [...items.keys()]
        for (const i of order) {
          if (!ids.includes(items[i].id)) continue
          const j = how === 'forward' ? i + 1 : i - 1
          if (j < 0 || j >= items.length || ids.includes(items[j].id)) continue;
          [items[i], items[j]] = [items[j], items[i]]
        }
      }
    }
  })
}

// ---------- Align and distribute ----------
/** mode: left|hcenter|right|top|vcenter|bottom. to: selection | page | margins (uses each page's own box for page-relative modes). */
export function alignItems(store, ids, mode, to = 'selection') {
  store.exec('Align', (doc) => {
    const list = itemsOf(doc, ids)
    if (!list.length) return
    let box
    if (to === 'page') box = { x: 0, y: 0, w: doc.w, h: doc.h }
    else if (to === 'margins') box = { x: doc.margins.l, y: doc.margins.t, w: doc.w - doc.margins.l - doc.margins.r, h: doc.h - doc.margins.t - doc.margins.b }
    else box = unionBox(list.map((l) => l.item))
    for (const { item } of list) {
      const b = aabb(item)
      let dx = 0, dy = 0
      if (mode === 'left') dx = box.x - b.x
      else if (mode === 'right') dx = box.x + box.w - (b.x + b.w)
      else if (mode === 'hcenter') dx = box.x + box.w / 2 - (b.x + b.w / 2)
      else if (mode === 'top') dy = box.y - b.y
      else if (mode === 'bottom') dy = box.y + box.h - (b.y + b.h)
      else if (mode === 'vcenter') dy = box.y + box.h / 2 - (b.y + b.h / 2)
      item.x = round(item.x + dx, 3)
      item.y = round(item.y + dy, 3)
    }
  })
}
/** axis: h|v. how: spacing (equal gaps) | centers (equal distance between centers). Needs 3 or more items. */
export function distributeItems(store, ids, axis, how = 'spacing') {
  store.exec('Distribute', (doc) => {
    const list = itemsOf(doc, ids).map((l) => ({ item: l.item, b: aabb(l.item) }))
    if (list.length < 3) return
    const pos = axis === 'h' ? 'x' : 'y', size = axis === 'h' ? 'w' : 'h'
    list.sort((a, b) => a.b[pos] - b.b[pos])
    const first = list[0].b, last = list[list.length - 1].b
    if (how === 'centers') {
      const c0 = first[pos] + first[size] / 2, c1 = last[pos] + last[size] / 2
      list.forEach((l, i) => { const want = c0 + ((c1 - c0) * i) / (list.length - 1); l.item[pos] = round(l.item[pos] + want - (l.b[pos] + l.b[size] / 2), 3) })
    } else {
      const total = last[pos] + last[size] - first[pos]
      const gap = (total - list.reduce((a, l) => a + l.b[size], 0)) / (list.length - 1)
      let cur = first[pos]
      for (const l of list) { l.item[pos] = round(l.item[pos] + cur - l.b[pos], 3); cur += l.b[size] + gap }
    }
  })
}

// ---------- Text threading ----------
const chainFrom = (doc, head) => {
  const all = new Map(containers(doc).flatMap(({ c }) => c.items).map((i) => [i.id, i]))
  const out = []
  for (let f = head; f && !out.includes(f) && out.length < 500; f = all.get(f.next)) out.push(f)
  return out
}
export function canLink(doc, fromId, toId) {
  const from = findItem(doc, fromId)?.item, to = findItem(doc, toId)?.item
  if (!from || !to || from.type !== 'text' || to.type !== 'text' || from === to) return 'Pick a different text frame.'
  if (from.next) return 'This frame is already linked to another one.'
  const hasPrev = containers(doc).some(({ c }) => c.items.some((i) => i.next === toId))
  if (hasPrev) return 'That frame already receives text from another frame.'
  if (chainFrom(doc, to).includes(from)) return 'That would create a loop.'
  return null
}
export function linkFrames(store, fromId, toId) {
  const err = canLink(store.doc, fromId, toId)
  if (err) return err
  store.exec('Thread text', (doc) => {
    const from = findItem(doc, fromId).item, to = findItem(doc, toId).item
    if (to.story !== from.story) {
      const old = doc.stories[to.story]
      const has = old && old.paras.some((p) => p.runs.some((r) => r.t))
      if (has) doc.stories[from.story].paras.push(...old.paras)
      for (const f of chainFrom(doc, to)) f.story = from.story
    }
    from.next = to.id
    gcStories(doc)
  })
  return null
}
export function breakThread(store, frameId) {
  store.exec('Break thread', (doc) => {
    const f = findItem(doc, frameId)?.item
    if (!f?.next) return
    const rest = chainFrom(doc, findItem(doc, f.next).item)
    f.next = null
    const sid = uid('s')
    doc.stories[sid] = { paras: [para('')] }
    for (const r of rest) r.story = sid
  })
}
/** Add pages (with threaded frames covering the margin box) until the story fits or a limit is reached. Returns pages added. */
export function flowStory(store, frameId, scene) {
  let added = 0
  store.exec('Flow text into new pages', (doc) => {
    const found = findItem(doc, frameId)
    if (!found || found.kind !== 'page') return
    for (let guard = 0; guard < 60; guard++) {
      store.bump()
      let last = found.item
      while (last.next) last = findItem(doc, last.next).item
      if (!scene.layout(last).overflow) break
      const pi = doc.pages.findIndex((p) => p.items.some((i) => i.id === last.id))
      const base = doc.pages[pi]
      const pg = newPage(doc, base.master)
      doc.pages.splice(pi + 1, 0, pg)
      const m = doc.margins
      const fr = newItem(doc, 'text', { x: m.l, y: m.t, w: doc.w - m.l - m.r, h: doc.h - m.t - m.b }, { story: last.story, next: null, cols: doc.cols, gap: doc.gutter, layer: last.layer })
      pg.items.push(fr)
      last.next = fr.id
      added++
    }
    store.bump()
  })
  return added
}

// ---------- Pages and masters ----------
export function addPage(store, afterIndex, master) {
  let id
  store.exec('Add page', (doc) => {
    const pg = newPage(doc, master === undefined ? doc.pages[Math.max(0, afterIndex)]?.master ?? doc.masters[0]?.id : master)
    doc.pages.splice(afterIndex + 1, 0, pg)
    id = pg.id
  })
  return id
}
export function duplicatePage(store, index) {
  let id
  store.exec('Duplicate page', (doc) => {
    const src = doc.pages[index]
    const pg = newPage(doc, src.master)
    pg.guides = JSON.parse(JSON.stringify(src.guides))
    pg.items = cloneMany(doc, src.items)
    doc.pages.splice(index + 1, 0, pg)
    id = pg.id
  })
  return id
}
export function deletePage(store, index) {
  store.exec('Delete page', (doc) => {
    if (doc.pages.length < 2) return
    const [pg] = doc.pages.splice(index, 1)
    for (const it of pg.items) {
      if (it.type !== 'text') continue
      const prev = containers(doc).flatMap(({ c }) => c.items).find((i) => i.next === it.id)
      if (prev) prev.next = it.next
    }
    gcStories(doc)
  })
}
export function movePage(store, from, to) {
  if (from === to) return
  store.exec('Move page', (doc) => { const [pg] = doc.pages.splice(from, 1); doc.pages.splice(to, 0, pg) })
}
export const setPageMaster = (store, pageId, masterId) => store.exec('Apply master', (doc) => { const p = getPage(doc, pageId); if (p) p.master = masterId || null })
export function addMaster(store, name) {
  let id
  store.exec('Add master', (doc) => {
    id = uid('m')
    doc.masters.push({ id, name: name || `${String.fromCharCode(65 + doc.masters.length)}-Master`, items: [] })
  })
  return id
}
export function duplicateMaster(store, mid) {
  let id
  store.exec('Duplicate master', (doc) => {
    const m = getMaster(doc, mid)
    if (!m) return
    id = uid('m')
    doc.masters.push({ id, name: `${m.name} copy`, items: cloneMany(doc, m.items) })
  })
  return id
}
export function deleteMaster(store, mid) {
  store.exec('Delete master', (doc) => {
    if (doc.masters.length < 2) return
    const i = doc.masters.findIndex((m) => m.id === mid)
    if (i < 0) return
    doc.masters.splice(i, 1)
    for (const p of doc.pages) if (p.master === mid) p.master = null
    gcStories(doc)
  })
}

// ---------- Layers ----------
export const addLayer = (store) => { let id; store.exec('Add layer', (d) => { id = uid('l'); d.layers.push({ id, name: `Layer ${d.layers.length + 1}`, visible: true, locked: false }) }); return id }
export const updateLayer = (store, id, patch, key) => store.exec('Layer', (d) => { const l = d.layers.find((x) => x.id === id); if (l) Object.assign(l, patch) }, { key: key ? `layer:${id}:${key}` : undefined })
export function deleteLayer(store, id) {
  store.exec('Delete layer', (doc) => {
    if (doc.layers.length < 2) return
    const i = doc.layers.findIndex((l) => l.id === id)
    const target = doc.layers[i === 0 ? 1 : i - 1].id
    for (const { c } of containers(doc)) for (const it of c.items) if (it.layer === id) it.layer = target
    doc.layers.splice(i, 1)
  })
}
export function moveLayer(store, id, dir) {
  store.exec('Reorder layer', (doc) => {
    const i = doc.layers.findIndex((l) => l.id === id), j = i + dir
    if (i < 0 || j < 0 || j >= doc.layers.length) return;
    [doc.layers[i], doc.layers[j]] = [doc.layers[j], doc.layers[i]]
  })
}
export const moveToLayer = (store, ids, layerId) => updateItems(store, ids, { layer: layerId })

// ---------- Styles ----------
export function addStyle(store, kind, copyFrom) {
  let id
  store.exec('Add style', (doc) => {
    const list = doc.styles[kind]
    const src = list.find((s) => s.id === copyFrom)
    id = uid('s')
    list.push(src ? { ...src, id, name: `${src.name} copy` } : kind === 'para' ? { ...doc.styles.para[0], id, name: 'New style' } : { id, name: 'New character style' })
  })
  return id
}
export const updateStyle = (store, kind, id, patch) => store.exec('Edit style', (doc) => {
  const s = doc.styles[kind].find((x) => x.id === id)
  if (!s) return
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete s[k]; else s[k] = v }
}, { key: `style:${kind}:${id}:${Object.keys(patch).join()}` })
export function deleteStyle(store, kind, id) {
  store.exec('Delete style', (doc) => {
    const list = doc.styles[kind]
    if (kind === 'para' && list.length < 2) return
    const i = list.findIndex((s) => s.id === id)
    if (i < 0) return
    list.splice(i, 1)
    for (const st of Object.values(doc.stories)) for (const p of st.paras) {
      if (kind === 'para' && p.ps === id) p.ps = doc.styles.para[0].id
      if (kind === 'char') for (const r of p.runs) if (r.cs === id) delete r.cs
    }
  })
}

// ---------- Story-level text formatting (frame selected, not editing) ----------
export function setStoryParas(store, storyId, fn, key) {
  store.exec('Format text', (doc) => { const st = doc.stories[storyId]; if (st) for (const p of st.paras) fn(p) }, { key: key ? `story:${storyId}:${key}` : undefined })
}
export function toggleStoryFlag(store, storyId, flag) {
  store.exec('Format text', (doc) => {
    const st = doc.stories[storyId]
    if (!st) return
    const runs = st.paras.flatMap((p) => p.runs)
    const on = !runs.every((r) => r[flag])
    for (const r of runs) { if (on) r[flag] = true; else delete r[flag] }
  })
}
export function setStoryText(store, storyId, paras) {
  store.exec('Edit text', (doc) => { if (doc.stories[storyId]) doc.stories[storyId].paras = paras.length ? paras : [para('')] }, { key: `text:${storyId}` })
}

// ---------- Document setup ----------
export function setDocSetup(store, patch) {
  store.exec('Document setup', (doc) => {
    const { margins, grid, view, ...rest } = patch
    Object.assign(doc, rest)
    if (margins) Object.assign(doc.margins, margins)
    if (grid) Object.assign(doc.grid, grid)
    if (view) Object.assign(doc.view, view)
  }, { key: `setup:${Object.keys(patch).join()}` })
}
export function addGuide(store, pageId, axis, pos) {
  store.exec('Add guide', (doc) => { const p = getPage(doc, pageId); if (p) p.guides[axis].push(round(pos, 2)) })
}
export { columnWidth, layerIndex }
