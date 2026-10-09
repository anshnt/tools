// Application state for Photo Develop: the library, selection, per-photo undo history, copy/paste, presets and autosave.
// UI modules subscribe with app.on(event, fn); nothing here touches the DOM except object URLs for thumbnails.
import { toast, yieldToMain, errorMessage } from '../../lib/ui.js'
import * as store from './_store.js'
import { GROUPS, LOOK_GROUPS, clone, defaults, merge, pick, same } from './_model.js'
import { applyLook, cleanLook } from './_presets.js'

const HISTORY_MAX = 120

export function createApp() {
  const handlers = new Map()
  const app = {
    photos: new Map(), order: [], selection: new Set(), anchor: null, activeId: null,
    view: 'library', sort: 'added', filter: { rating: 0, flag: 'all', edited: false, text: '' },
    clipboard: null, presets: [], busy: null, ready: false,
    compare: 'off', clip: false, cropMode: false, aspect: 'free',
  }
  const history = new Map() // id -> {stack: [{s, label, t}], i}
  const timers = new Map()
  const thumbs = new Map() // id -> object URL
  const pendingThumb = new Map()
  let disposed = false

  app.on = (type, fn) => {
    if (!handlers.has(type)) handlers.set(type, new Set())
    handlers.get(type).add(fn)
    return () => handlers.get(type)?.delete(fn)
  }
  app.emit = (type, data) => { for (const fn of [...(handlers.get(type) || [])]) { try { fn(data) } catch (e) { console.error(e) } } }

  // ---------- Library ----------
  app.get = (id) => app.photos.get(id)
  app.active = () => app.photos.get(app.activeId) || null
  app.settings = () => app.active()?.edits || null
  app.visible = () => {
    const f = app.filter, q = f.text.trim().toLowerCase()
    let ids = app.order.filter((id) => {
      const m = app.photos.get(id)
      if (!m) return false
      if (m.rating < f.rating) return false
      if (f.flag === 'pick' && m.flag !== 'pick') return false
      if (f.flag === 'reject' && m.flag !== 'reject') return false
      if (f.flag === 'unflagged' && m.flag) return false
      if (f.flag === 'hide-rejected' && m.flag === 'reject') return false
      if (f.edited && same(m.edits, defaults())) return false
      if (q && !m.name.toLowerCase().includes(q)) return false
      return true
    })
    if (app.sort === 'name') ids = ids.sort((a, b) => app.photos.get(a).name.localeCompare(app.photos.get(b).name, undefined, { numeric: true }))
    else if (app.sort === 'rating') ids = ids.sort((a, b) => app.photos.get(b).rating - app.photos.get(a).rating)
    else if (app.sort === 'taken') ids = ids.sort((a, b) => app.photos.get(a).taken - app.photos.get(b).taken)
    return ids
  }
  app.setFilter = (patch) => { Object.assign(app.filter, patch); app.emit('library', { filter: true }) }
  app.setSort = (s) => { app.sort = s; app.emit('library', { filter: true }) }

  app.load = async () => {
    const { photos, presets } = await store.loadLibrary()
    for (const m of photos) { app.photos.set(m.id, m); app.order.push(m.id) }
    app.presets = presets
    app.ready = true
    app.emit('library', {})
    app.emit('presets', {})
  }

  app.import = async (files) => {
    const list = [...files].filter(store.isImageFile)
    const skipped = files.length - list.length
    if (skipped) toast(`Skipped ${skipped} file(s) that are not images`)
    if (!list.length) return []
    const added = []
    const errors = []
    for (let i = 0; i < list.length; i++) {
      if (disposed) break
      app.busy = { label: `Importing ${i + 1} of ${list.length}`, fraction: i / list.length }
      app.emit('busy', app.busy)
      try {
        const { meta, thumb } = await store.importFile(list[i])
        app.photos.set(meta.id, meta)
        app.order.push(meta.id)
        thumbs.set(meta.id, URL.createObjectURL(thumb))
        added.push(meta.id)
        await store.saveOrder(app.order) // saved per photo so an interrupted import keeps what was added
        app.emit('library', { added: [meta.id] })
      } catch (e) {
        console.error(e)
        errors.push(errorMessage(e))
      }
      await yieldToMain()
    }
    app.busy = null
    app.emit('busy', null)
    if (added.length) {
      app.selection = new Set([added[0]])
      app.anchor = added[0]
      if (!app.activeId || !app.photos.has(app.activeId)) app.activeId = added[0]
      app.emit('selection', {})
      toast(`Added ${added.length} photo${added.length > 1 ? 's' : ''}`, 'success')
    }
    if (errors.length) toast(errors.length === 1 ? errors[0] : `${errors.length} files could not be added. ${errors[0]}`, 'error')
    return added
  }

  /** Add photos restored from a backup (already stored) to the library. */
  app.adopt = async (metas, presets = []) => {
    for (const m of metas) { if (!app.photos.has(m.id)) app.order.push(m.id); app.photos.set(m.id, m) }
    await store.saveOrder(app.order)
    if (presets.length) await app.addPresets(presets)
    if (metas.length) { app.selection = new Set([metas[0].id]); app.anchor = metas[0].id; app.activeId = app.activeId || metas[0].id }
    app.emit('library', { added: metas.map((m) => m.id) })
    app.emit('selection', {})
  }

  app.remove = async (ids) => {
    for (const id of ids) {
      clearTimeout(timers.get(id)); timers.delete(id)
      app.photos.delete(id); history.delete(id)
      const u = thumbs.get(id); if (u) URL.revokeObjectURL(u); thumbs.delete(id)
      await store.deletePhoto(id)
    }
    app.order = app.order.filter((id) => app.photos.has(id))
    await store.saveOrder(app.order)
    app.selection = new Set([...app.selection].filter((id) => app.photos.has(id)))
    if (!app.photos.has(app.activeId)) {
      app.activeId = app.visible()[0] || null
      if (app.activeId) app.selection = new Set([app.activeId])
      if (!app.activeId) app.view = 'library'
    }
    app.emit('library', { removed: ids })
    app.emit('selection', {})
    if (!app.activeId) app.emit('view', app.view)
  }

  // ---------- Selection and navigation ----------
  app.select = (id, mode = 'single') => {
    const ids = app.visible()
    if (mode === 'toggle') {
      if (app.selection.has(id) && app.selection.size > 1) app.selection.delete(id)
      else app.selection.add(id)
      app.anchor = id
    } else if (mode === 'range' && app.anchor && ids.includes(app.anchor)) {
      const a = ids.indexOf(app.anchor), b = ids.indexOf(id)
      app.selection = new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1))
    } else {
      app.selection = new Set([id]); app.anchor = id
    }
    const changed = app.activeId !== id
    if (changed && app.cropMode) app.setCropMode(false)
    app.activeId = id
    app.emit('selection', {})
    if (changed) app.emit('active', id)
  }
  app.selectAll = () => {
    app.selection = new Set(app.visible())
    app.emit('selection', {})
  }
  app.selectedIds = () => {
    const ids = app.visible().filter((id) => app.selection.has(id))
    return ids.length ? ids : app.activeId ? [app.activeId] : []
  }
  app.setView = (v) => {
    if (v === 'develop' && !app.activeId) return
    if (app.view === v) return
    if (app.cropMode && v !== 'develop') app.setCropMode(false)
    app.view = v
    app.emit('view', v)
  }
  app.open = (id) => {
    if (id && id !== app.activeId) app.select(id)
    app.setView('develop')
  }
  app.step = (dir) => {
    const ids = app.visible()
    if (!ids.length) return
    const i = ids.indexOf(app.activeId)
    const n = ids[Math.min(ids.length - 1, Math.max(0, (i < 0 ? 0 : i + dir)))]
    if (n && n !== app.activeId) app.select(n)
  }

  // ---------- Rating and flags ----------
  app.setRating = (ids, n) => {
    for (const id of ids) { const m = app.photos.get(id); if (m) { m.rating = n; saveSoon(id) } }
    app.emit('meta', { ids })
  }
  app.setFlag = (ids, flag) => {
    for (const id of ids) { const m = app.photos.get(id); if (m) { m.flag = flag; saveSoon(id) } }
    app.emit('meta', { ids })
  }

  // ---------- Edits and history ----------
  function hist(id) {
    let h = history.get(id)
    if (!h) { h = { stack: [{ s: clone(app.photos.get(id).edits), label: 'Open', t: 0 }], i: 0 }; history.set(id, h) }
    return h
  }
  /** Replace a photo's settings. Same-label commits within 800 ms merge into one history step (slider drags). */
  app.commit = (id, label, next, { coalesce = true } = {}) => {
    const m = app.photos.get(id)
    if (!m) return
    const h = hist(id)
    const now = performance.now()
    if (same(m.edits, next)) return
    m.edits = next
    const top = h.stack[h.i]
    if (coalesce && h.i > 0 && top.label === label && now - top.t < 800) { top.s = clone(next); top.t = now }
    else {
      h.stack.length = h.i + 1
      h.stack.push({ s: clone(next), label, t: now })
      if (h.stack.length > HISTORY_MAX) h.stack.shift()
      h.i = h.stack.length - 1
    }
    saveSoon(id)
    app.emit('edit', { id, label })
    app.emit('history', { id })
  }
  /** Patch top-level keys of the active photo, e.g. app.set({ exposure: 0.5 }, 'Exposure'). */
  app.set = (patch, label) => {
    const m = app.active()
    if (!m) return
    app.commit(m.id, label || Object.keys(patch)[0], { ...m.edits, ...clone(patch) })
  }
  /** Run fn(clone of settings) -> new settings on the active photo. */
  app.update = (label, fn, opts) => {
    const m = app.active()
    if (!m) return
    app.commit(m.id, label, fn(clone(m.edits)), opts)
  }
  app.history = () => { const m = app.active(); return m ? (({ stack, i }) => ({ items: stack.map((x) => x.label), i }))(hist(m.id)) : { items: [], i: 0 } }
  const goto = (id, i) => {
    const h = hist(id)
    if (i < 0 || i >= h.stack.length) return
    h.i = i
    app.photos.get(id).edits = clone(h.stack[i].s)
    saveSoon(id)
    app.emit('edit', { id, label: 'History', jump: true })
    app.emit('history', { id })
  }
  app.undo = () => { const m = app.active(); if (m) goto(m.id, hist(m.id).i - 1) }
  app.redo = () => { const m = app.active(); if (m) goto(m.id, hist(m.id).i + 1) }
  app.jump = (i) => { const m = app.active(); if (m) goto(m.id, i) }
  app.canUndo = () => { const m = app.active(); return !!m && hist(m.id).i > 0 }
  app.canRedo = () => { const m = app.active(); return !!m && hist(m.id).i < hist(m.id).stack.length - 1 }
  app.isEdited = (id) => { const m = app.photos.get(id); return !!m && !same(m.edits, defaults()) }

  app.resetLook = (ids = [app.activeId]) => {
    for (const id of ids) { const m = app.photos.get(id); if (m) app.commit(id, 'Reset settings', { ...defaults(), ...pick(m.edits, ['geometry']) }, { coalesce: false }) }
  }
  app.resetAll = (ids = [app.activeId]) => { for (const id of ids) if (app.photos.has(id)) app.commit(id, 'Reset all', defaults(), { coalesce: false }) }

  // ---------- Copy, paste, presets ----------
  app.copy = (groups = LOOK_GROUPS) => {
    const m = app.active()
    if (!m) return false
    app.clipboard = { settings: clone(m.edits), groups: [...groups], from: m.name }
    app.emit('clipboard', app.clipboard)
    return true
  }
  app.paste = (ids = app.selectedIds(), groups = app.clipboard?.groups) => {
    if (!app.clipboard) return 0
    const part = pick(app.clipboard.settings, groups || LOOK_GROUPS)
    let n = 0
    for (const id of ids) {
      const m = app.photos.get(id)
      if (!m) continue
      app.commit(id, 'Paste settings', merge(m.edits, part), { coalesce: false })
      n++
    }
    return n
  }
  /** replace = true for built-in looks (whole look), false for saved presets that only hold some groups. */
  app.applyPreset = (look, label = 'Preset', ids = [app.activeId], replace = true) => {
    for (const id of ids) { const m = app.photos.get(id); if (m) app.commit(id, label, applyLook(m.edits, look, replace), { coalesce: false }) }
  }
  app.savePreset = async (name, groups = LOOK_GROUPS) => {
    const m = app.active()
    if (!m) return null
    const p = { id: `u${Date.now().toString(36)}`, name: name.trim().slice(0, 60) || 'My preset', look: pick(m.edits, groups), created: Date.now() }
    app.presets = [...app.presets, p]
    await store.savePresets(app.presets)
    app.emit('presets', {})
    return p
  }
  app.deletePreset = async (id) => {
    app.presets = app.presets.filter((p) => p.id !== id)
    await store.savePresets(app.presets)
    app.emit('presets', {})
  }
  app.addPresets = async (list) => {
    const have = new Set(app.presets.map((p) => p.id))
    const fresh = list.filter((p) => p && p.name && p.look && !have.has(p.id)).map((p) => ({ id: p.id || `u${Math.random().toString(36).slice(2, 8)}`, name: String(p.name).slice(0, 60), look: cleanLook(p.look), created: p.created || Date.now() }))
    if (!fresh.length) return 0
    app.presets = [...app.presets, ...fresh]
    await store.savePresets(app.presets)
    app.emit('presets', {})
    return fresh.length
  }

  // ---------- Compare, clipping, crop mode ----------
  app.setCompare = (mode) => { app.compare = mode; app.emit('compare', mode) }
  app.toggleCompare = (mode) => app.setCompare(app.compare === mode ? 'off' : mode)
  app.setClip = (on) => { app.clip = on; app.emit('clip', on) }
  app.setCropMode = (on) => {
    if (on && (!app.activeId || app.view !== 'develop')) return
    if (app.cropMode === on) return
    app.cropMode = on
    app.emit('crop', on)
  }

  // ---------- Thumbnails ----------
  /** Object URL of a stored thumbnail (cached). */
  app.thumbUrl = (id) => {
    if (thumbs.has(id)) return Promise.resolve(thumbs.get(id))
    if (!pendingThumb.has(id)) {
      pendingThumb.set(id, store.getThumb(id).then((b) => {
        pendingThumb.delete(id)
        if (!b || disposed) return null
        const u = URL.createObjectURL(b)
        thumbs.set(id, u)
        if (thumbs.size > 600) { const first = thumbs.keys().next().value; URL.revokeObjectURL(thumbs.get(first)); thumbs.delete(first) }
        return u
      }))
    }
    return pendingThumb.get(id)
  }

  // ---------- Persistence ----------
  function saveSoon(id) {
    clearTimeout(timers.get(id))
    timers.set(id, setTimeout(() => { timers.delete(id); const m = app.photos.get(id); if (m) store.saveMeta(m) }, 400))
  }
  app.flush = async () => {
    for (const [id, t] of timers) { clearTimeout(t); const m = app.photos.get(id); if (m) await store.saveMeta(m) }
    timers.clear()
  }
  app.dispose = () => {
    disposed = true
    app.flush()
    for (const u of thumbs.values()) URL.revokeObjectURL(u)
    thumbs.clear(); handlers.clear()
  }
  app.GROUPS = GROUPS
  return app
}
