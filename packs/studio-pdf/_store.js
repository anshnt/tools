// Document model + undo/redo. State is plain JSON (pages, annotations, form values); every edit goes through commit()
// (or begin()/record() for gestures), which snapshots for Ctrl+Z / Ctrl+Y. Images live in app.assets and are referenced by id.
import { uid } from './_geom.js'

export function createStore() {
  const listeners = new Set()
  const st = {
    state: { pages: [], annots: [], fields: {} },
    tool: 'select',
    sel: null, // selected annotation id
    thumbSel: new Set(), // selected page ids in the thumbnail panel
    editing: null, // annotation id being edited in place
    dirty: false,
    undoStack: [],
    redoStack: [],
    on(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    emit(type, detail = {}) { for (const fn of [...listeners]) fn(type, detail) },

    reset(state) {
      st.state = state
      st.undoStack = []; st.redoStack = []
      st.sel = null; st.editing = null; st.thumbSel = new Set()
      st.dirty = false
      st.emit('change', { reset: true })
    },
    snap: () => JSON.stringify(st.state),
    /** Apply fn to the state as one undoable step. opts.coalesce merges rapid edits with the same key. */
    commit(label, fn, opts = {}) {
      const before = st.snap()
      fn(st.state)
      st.push(label, before, opts)
      st.emit('change', { label, pids: opts.pids })
    },
    /** Gesture API: const b = store.begin(); mutate state live; store.record('Move', b). */
    begin: () => st.snap(),
    record(label, before, opts = {}) {
      if (before === st.snap()) return
      st.push(label, before, opts)
      st.emit('change', { label, pids: opts.pids })
    },
    push(label, before, opts = {}) {
      const now = Date.now()
      const last = st.undoStack.at(-1)
      if (opts.coalesce && last?.coalesce === opts.coalesce && now - last.t < 1500) last.t = now
      else {
        st.undoStack.push({ label, before, t: now, coalesce: opts.coalesce })
        if (st.undoStack.length > 120) st.undoStack.shift()
      }
      st.redoStack.length = 0
      st.dirty = true
    },
    undo() {
      const e = st.undoStack.pop()
      if (!e) return
      st.redoStack.push({ label: e.label, before: st.snap() })
      st.restore(e.before, `Undo ${e.label}`)
    },
    redo() {
      const e = st.redoStack.pop()
      if (!e) return
      st.undoStack.push({ label: e.label, before: st.snap(), t: Date.now() })
      st.restore(e.before, `Redo ${e.label}`)
    },
    restore(json, label) {
      st.state = JSON.parse(json)
      if (st.sel && !st.annot(st.sel)) st.sel = null
      st.editing = null
      st.thumbSel = new Set([...st.thumbSel].filter((id) => st.state.pages.some((p) => p.id === id)))
      st.dirty = true
      st.emit('change', { label, restore: true })
    },

    annot: (id) => st.state.annots.find((a) => a.id === id),
    page: (pid) => st.state.pages.find((p) => p.id === pid),
    pageIndex: (pid) => st.state.pages.findIndex((p) => p.id === pid),
    annotsOf: (pid) => st.state.annots.filter((a) => a.pid === pid),
    select(id) {
      if (st.sel === id) return
      const old = st.sel
      st.sel = id
      st.emit('sel', { old, id })
    },
    setTool(t) {
      if (st.tool === t) return
      st.tool = t
      if (t !== 'select') st.select(null)
      st.emit('tool', { tool: t })
    },
    newPage: (p) => ({ id: uid('p'), rot: 0, ...p }),
  }
  return st
}
