// Draw Studio store: the immutable document root, selection, view state and snapshot history. Pure (no DOM), so Node tests drive it.
// store.tx(label, fn) is the ONLY way to change the document: fn(root) returns a new root built by path copying.
// Undo and redo are a pointer swap over the stored roots (plus selection restore): there are no inverse functions to get wrong.
// Events: doc, sel, page, tool, view, fonts, prefs, status.
import { diffCost, maxId } from './_ds-doc.js'

const MERGE_MS = 600
// ceiling: 200 entries and 96 MB of estimated new nodes (about 400 bytes per node, 80 per path command). Moving 20k selected paths costs
// 20k new nodes (8 MB) so a handful of such steps fit. Oldest entries go first and the last 5 are always kept.
export const HISTORY_MAX = 200
export const HISTORY_BYTES = 96 * 1024 * 1024

/** Estimated bytes newly allocated by going from root a to root b. */
export function rootCost(a, b) {
  if (a === b) return 0
  let c = 0
  b.pages.forEach((p, i) => {
    const q = a.pages.find((x) => x.id === p.id) || a.pages[i]
    if (q === p) return
    if (!q) { c += 600 + p.layers.reduce((s, l) => s + diffCost([], l.items), 0); return }
    p.layers.forEach((l, j) => { const ql = q.layers.find((x) => x.id === l.id) || q.layers[j]; c += ql === l ? 0 : 200 + diffCost(ql ? ql.items : [], l.items) })
  })
  return c + 200
}

export function createStore(initial, { prefs = {} } = {}) {
  let root = initial
  let hist = [], pos = 0, histBytes = 0
  let index = null
  let nextId = Math.max(maxId(root) + 1, root.nextId || 1)
  let savedRoot = root
  let pageIndex = 0
  const pending = new Set()
  const subs = new Map()
  const S = { page: root.pages[0]?.id ?? null, ids: [] }
  const store = {
    sel: S, selMode: 'click', ctx: null, view: { x: 0, y: 0, z: 1 }, tool: 'pick', activeLayer: {}, prefs: { ...prefs },
    get root() { return root },
    get pageIndex() { return pageIndex },
    get dirty() { return root !== savedRoot },
    get historyLength() { return hist.length },
    get historyPos() { return pos },
    get historyBytes() { return histBytes },
  }

  const emit = (ev, arg) => { for (const fn of [...(subs.get(ev) || [])]) { try { fn(arg) } catch (e) { console.error(e) } } }
  const on = (ev, fn) => { if (!subs.has(ev)) subs.set(ev, new Set()); subs.get(ev).add(fn); return () => subs.get(ev)?.delete(fn) }

  // ---------- id index (lazy, rebuilt when the root changed) ----------
  function buildIndex() {
    index = new Map()
    root.pages.forEach((page, pi) => {
      index.set(page.id, { page, pageIndex: pi })
      page.layers.forEach((layer, li) => {
        index.set(layer.id, { layer, layerIndex: li, page, pageIndex: pi })
        const rec = (items, parent) => {
          for (let i = 0; i < items.length; i++) {
            const n = items[i]
            index.set(n.id, { node: n, parent, layer, page, index: i, pageIndex: pi, layerIndex: li })
            if (n.t === 'group') rec(n.items, n)
          }
        }
        rec(layer.items, null)
      })
    })
  }
  const find = (id) => { if (!index) buildIndex(); return index.get(id) || null }

  // ---------- selection ----------
  const sameIds = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
  const snapSel = () => ({ page: S.page, ids: S.ids.slice() })
  function setSel(ids, mode = 'click') {
    const next = []
    const seen = new Set()
    const pid = root.pages[pageIndex]?.id ?? null
    for (const id of ids || []) {
      if (seen.has(id)) continue
      const f = find(id)
      if (!f?.node || f.page.id !== pid) continue
      seen.add(id)
      next.push(id)
    }
    const changed = !sameIds(next, S.ids) || S.page !== pid
    S.ids = next
    S.page = pid
    store.selMode = mode
    if (store.ctx != null && !find(store.ctx)) store.ctx = null
    if (changed) emit('sel', S)
    return changed
  }
  /** Drop selected ids that no longer exist (after undo, redo or load). */
  function clean() {
    const keep = S.ids.filter((id) => find(id)?.node)
    if (keep.length !== S.ids.length || (S.page != null && !find(S.page))) { S.ids = keep; if (!find(S.page)) S.page = root.pages[pageIndex]?.id ?? null; emit('sel', S) }
    if (store.ctx != null && !find(store.ctx)) store.ctx = null
  }

  function setPage(i) {
    i = Math.max(0, Math.min(root.pages.length - 1, i | 0))
    if (i === pageIndex && S.page === root.pages[i].id) return false
    pageIndex = i
    S.page = root.pages[i].id
    S.ids = []
    store.ctx = null
    emit('sel', S)
    emit('page', root.pages[i])
    return true
  }
  const setPageById = (id) => { const i = root.pages.findIndex((p) => p.id === id); return i < 0 ? false : setPage(i) }

  // ---------- history ----------
  function evict() {
    while (hist.length > HISTORY_MAX || (histBytes > HISTORY_BYTES && hist.length > 5)) {
      if (pos <= 5 && hist.length <= 5) break
      const e = hist.shift()
      histBytes -= e.cost
      pos = Math.max(0, pos - 1)
    }
  }
  function tx(label, fn, o = {}) {
    const before = root
    const after = fn(root)
    if (!after || after === before) return false
    const selBefore = snapSel()
    root = after
    index = null
    // the current page follows its id (pages added or removed before it do not move the user to another page); o.page asks for a page to show
    const want = o.page != null ? root.pages.findIndex((p) => p.id === o.page) : -1
    const keep = want >= 0 ? want : root.pages.findIndex((p) => p.id === S.page)
    pageIndex = keep >= 0 ? keep : Math.max(0, Math.min(pageIndex, root.pages.length - 1))
    const switched = root.pages[pageIndex].id !== S.page
    if (switched) { S.page = root.pages[pageIndex].id; S.ids = []; store.ctx = null }
    if (o.sel) setSel(Array.isArray(o.sel) ? o.sel : o.sel.ids, o.selMode || 'click'); else clean()
    const selAfter = snapSel()
    const now = Date.now()
    const top = pos ? hist[pos - 1] : null
    const c = rootCost(before, after)
    if (o.merge && top && pos === hist.length && top.key === o.merge && now - top.t < MERGE_MS) {
      histBytes += c
      Object.assign(top, { after, selAfter, t: now, cost: top.cost + c, label })
    } else {
      hist.length = pos
      histBytes = hist.reduce((s, e) => s + e.cost, 0)
      hist.push({ label, before, after, selBefore, selAfter, pageId: root.pages[pageIndex]?.id, cost: c, t: now, key: o.merge || null })
      histBytes += c
      pos = hist.length
      evict()
    }
    if (switched) emit('page', root.pages[pageIndex])
    emit('doc', { label, tx: true })
    return true
  }
  function restore(root2, sel, pageId, label) {
    root = root2
    index = null
    const pi = root.pages.findIndex((p) => p.id === pageId)
    pageIndex = pi >= 0 ? pi : Math.min(pageIndex, root.pages.length - 1)
    S.page = root.pages[pageIndex].id
    S.ids = sel.page === S.page ? sel.ids.slice() : []
    clean()
    emit('page', root.pages[pageIndex])
    emit('doc', { label, history: true })
    emit('sel', S)
  }
  function undo() {
    if (pos <= 0) return false
    const e = hist[--pos]
    restore(e.before, e.selBefore, e.pageId, `Undo ${e.label}`)
    return true
  }
  function redo() {
    if (pos >= hist.length) return false
    const e = hist[pos++]
    restore(e.after, e.selAfter, e.pageId, `Redo ${e.label}`)
    return true
  }
  /** Move to the state with n entries applied. */
  function jump(n) { while (pos > n && undo()); while (pos < n && redo()); }

  /** The one sanctioned in-place edit: fill a pending PDF page placeholder (shared by every snapshot). fn(root) must not return a new root. */
  function silent(fn) {
    fn(root)
    index = null
    emit('doc', { silent: true })
  }

  function load(newRoot, meta = {}) {
    root = newRoot
    index = null
    hist = []; pos = 0; histBytes = 0
    nextId = Math.max(maxId(root) + 1, root.nextId || 1, nextId)
    pageIndex = 0
    S.page = root.pages[0].id
    S.ids = []
    store.ctx = null
    store.activeLayer = {}
    savedRoot = meta.dirty ? null : root
    emit('doc', { load: true, ...meta })
    emit('page', root.pages[0])
    emit('sel', S)
  }

  function track(promise) {
    pending.add(promise)
    const done = () => pending.delete(promise)
    promise.then(done, done)
    return promise
  }
  async function whenReady() { while (pending.size) await Promise.allSettled([...pending]) }

  Object.assign(store, {
    on, emit, find, setSel, clean, setPage, setPageById, tx, undo, redo, jump, silent, load, track, whenReady,
    page: () => root.pages[pageIndex],
    newId: () => nextId++,
    reserveIds: (n) => { const s = nextId; nextId += n; return s },
    canUndo: () => pos > 0,
    canRedo: () => pos < hist.length,
    undoLabel: () => (pos ? hist[pos - 1].label : ''),
    redoLabel: () => (pos < hist.length ? hist[pos].label : ''),
    markSaved: () => { savedRoot = root; emit('status') },
    setTool: (t) => { if (store.tool !== t) { store.tool = t; emit('tool', t) } },
    setView: (v) => { Object.assign(store.view, v); emit('view', store.view) },
    setPref: (k, v) => { store.prefs[k] = v; emit('prefs', { [k]: v }) },
    setStatus: (text) => emit('status', text),
    setActiveLayer: (pageId, layerId) => { store.activeLayer[pageId] = layerId },
    /** The layer new objects go to: the remembered one when usable, else the first unlocked visible layer, else null (the caller adds a layer). */
    activeLayerOf(page = root.pages[pageIndex]) {
      const ok = (l) => l && !l.hidden && !l.locked
      const mine = page.layers.find((l) => l.id === store.activeLayer[page.id])
      return ok(mine) ? mine : page.layers.find(ok) || null
    },
  })
  return store
}
