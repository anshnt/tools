// Draw Studio commands: binds run functions to the metadata in _ds-keys.js and dispatches keyboard shortcuts.
// Menus, the keyboard, buttons and tests all call commands.run(id, args). A command that is cut for time is removed from the table in
// _ds-keys.js, from the menus and from the toolbox together (no dead controls).
import { COMMANDS, buildKeymap, normalizeKey } from './_ds-keys.js'
import { PASS, createEditImpl } from './_ds-cmd-edit.js'

const TYPING = 'input, select, textarea, [contenteditable]:not([contenteditable="false"])'
// While focus is in a field only these shortcuts still reach the app (the field keeps Ctrl+Z, Ctrl+A, letters, arrows and Esc).
const ALWAYS = /^(F\d+|Ctrl\+O|Alt\+N)$/

/** env: {store, view, tools, boxOf, app: {openPicker, newDoc, showNotes, showShortcuts, fullscreen, gotoPage, colorDialog, toggleDock, dockOpen, noteColor}} */
export function createCommands({ store, view, tools, boxOf, app }) {
  const topLevelIds = () => {
    const out = []
    for (const l of store.page()?.layers || []) if (!l.hidden && !l.locked) for (const n of l.items) if (!n.hidden && !n.locked) out.push(n.id)
    return out
  }
  const gotoPage = (i) => { if (i >= 0 && i < store.root.pages.length) return app.gotoPage(i) }
  const impl = {
    'file.new': { run: () => app.newDoc() },
    'file.open': { run: () => app.openPicker() },
    'file.notes': { run: () => app.showNotes(), enabled: () => true },
    'edit.undo': { run: () => store.undo(), enabled: () => store.canUndo(), label: () => (store.canUndo() ? `Undo ${store.undoLabel()}` : 'Undo') },
    'edit.redo': { run: () => store.redo(), enabled: () => store.canRedo(), label: () => (store.canRedo() ? `Redo ${store.redoLabel()}` : 'Redo') },
    'edit.selectAll': { run: () => store.setSel(store.ctx != null ? (store.find(store.ctx)?.node?.items || []).filter((n) => !n.hidden && !n.locked).map((n) => n.id) : topLevelIds(), 'marquee') },
    'edit.selectNone': { run: () => { if (tools.cancelGesture()) return; if (store.sel.ids.length) store.setSel([]); else if (store.ctx != null) { store.ctx = null; store.emit('status') } } },
    'view.zoomIn': { run: () => view.zoomAt(1.25, view.size().w / 2, view.size().h / 2) },
    'view.zoomOut': { run: () => view.zoomAt(1 / 1.25, view.size().w / 2, view.size().h / 2) },
    'view.zoomSel': { run: () => view.zoomSel(), enabled: () => store.sel.ids.length > 0 },
    'view.zoomAll': { run: () => view.zoomAll() },
    'view.zoomPage': { run: () => view.zoomPage() },
    'view.zoom100': { run: () => view.zoom100() },
    'view.fullscreen': { run: () => app.fullscreen(), checked: () => !!document.fullscreenElement },
    'page.prev': { run: () => gotoPage(store.pageIndex - 1), enabled: () => store.pageIndex > 0 },
    'page.next': { run: () => gotoPage(store.pageIndex + 1), enabled: () => store.pageIndex < store.root.pages.length - 1 },
    'tool.pick': { run: () => tools.set('pick'), checked: () => store.tool === 'pick' },
    'tool.zoom': { run: () => tools.set('zoom'), checked: () => store.tool === 'zoom' },
    'tool.pan': { run: () => tools.set('pan'), checked: () => store.tool === 'pan' },
    'help.shortcuts': { run: () => app.showShortcuts() },
  }
  const edit = createEditImpl({ store, boxOf, tools, app })
  Object.assign(impl, edit.impl)
  const meta = new Map(COMMANDS.map((c) => [c.id, c]))
  for (const id of meta.keys()) if (!impl[id]) console.warn(`Draw Studio: command ${id} has no implementation`)
  const { map: keymap, args: keyArgs } = buildKeymap()

  const api = {
    meta, impl, paint: edit.paint,
    has: (id) => meta.has(id) && !!impl[id],
    /** Run a command (may return a promise). Disabled commands do nothing. */
    run(id, args) { const c = impl[id]; if (!c || (c.enabled && !c.enabled())) return undefined; return c.run(args) },
    enabled: (id) => !!impl[id] && (!impl[id].enabled || !!impl[id].enabled()),
    checked: (id) => !!impl[id]?.checked?.(),
    label: (id) => impl[id]?.label?.() || meta.get(id)?.label || id,
    /** Keyboard dispatcher for the app root. Returns true when the key was consumed. */
    onKeydown(e) {
      if (e.defaultPrevented || e.isComposing) return false
      const key = normalizeKey(e)
      if (!key) return false
      const typing = !!e.target.closest?.(TYPING)
      if (typing && !ALWAYS.test(key)) return false
      const id = keymap.get(key)
      if (!id || !api.has(id)) return false
      // Tab only belongs to the canvas itself, so keyboard users can still tab out of the app
      if ((key === 'Tab' || key === 'Shift+Tab') && !e.target.classList?.contains('ds-view')) return false
      const r = api.run(id, keyArgs.get(key))
      if (r === PASS) return false
      e.preventDefault(); e.stopPropagation()
      return true
    },
  }
  return api
}
