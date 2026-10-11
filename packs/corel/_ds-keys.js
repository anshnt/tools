// Draw Studio command metadata: ids, labels, menu placement and keys. No run functions here (those are bound in _ds-cmd.js), so Node tests
// can assert: no two commands share a key, every command is in a menu, every menu exists. A feature that is cut is removed from this table,
// the menus and the toolbox together (no dead buttons).
//   {id, label, menu, path?: ['Submenu'], group?: n (a separator is drawn when it changes), keys: ['Ctrl+O'], icon?, phone?: true (shown in the phone bar)}
export const MENUS = ['File', 'Edit', 'View', 'Layout', 'Object', 'Effects', 'Bitmaps', 'Text', 'Window', 'Help']

export const COMMANDS = [
  // File
  { id: 'file.new', label: 'New', menu: 'File', group: 1, keys: ['Alt+N'], icon: 'file-plus' },
  { id: 'file.open', label: 'Open...', menu: 'File', group: 1, keys: ['Ctrl+O'], icon: 'folder-open', phone: true },
  { id: 'file.notes', label: 'Notes about this file', menu: 'File', group: 4, keys: [], icon: 'info' },
  // Edit
  { id: 'edit.undo', label: 'Undo', menu: 'Edit', group: 1, keys: ['Ctrl+Z'], icon: 'undo-2', phone: true },
  { id: 'edit.redo', label: 'Redo', menu: 'Edit', group: 1, keys: ['Ctrl+Shift+Z', 'Ctrl+Y'], icon: 'redo-2', phone: true },
  { id: 'edit.selectAll', label: 'Select all', menu: 'Edit', group: 3, keys: ['Ctrl+A'], icon: 'box-select' },
  { id: 'edit.selectNone', label: 'Select none', menu: 'Edit', group: 3, keys: ['Esc'], icon: 'square-dashed' },
  // View
  { id: 'view.zoomIn', label: 'Zoom in', menu: 'View', group: 1, keys: ['+', '=', 'Ctrl+='], icon: 'zoom-in' },
  { id: 'view.zoomOut', label: 'Zoom out', menu: 'View', group: 1, keys: ['-', 'F3', 'Ctrl+-'], icon: 'zoom-out' },
  { id: 'view.zoomSel', label: 'Zoom to selection', menu: 'View', group: 1, keys: ['Shift+F2'], icon: 'scan-search' },
  { id: 'view.zoomAll', label: 'Zoom to all objects', menu: 'View', group: 1, keys: ['F4'], icon: 'scan-search' },
  { id: 'view.zoomPage', label: 'Zoom to page', menu: 'View', group: 1, keys: ['Shift+F4', 'Ctrl+0'], icon: 'frame' },
  { id: 'view.zoom100', label: '100 percent', menu: 'View', group: 1, keys: ['Ctrl+1'], icon: 'maximize' },
  { id: 'view.fullscreen', label: 'Full screen', menu: 'View', group: 5, keys: ['F9'], icon: 'maximize' },
  // Layout
  { id: 'page.prev', label: 'Previous page', menu: 'Layout', group: 1, keys: ['PageUp'], icon: 'chevron-left' },
  { id: 'page.next', label: 'Next page', menu: 'Layout', group: 1, keys: ['PageDown'], icon: 'chevron-right' },
  // Tools (the toolbox is built from TOOL_INFO in _ds-tools.js; the keys are mirrored here so duplicates are caught)
  { id: 'tool.pick', label: 'Pick tool', menu: 'View', path: ['Tools'], keys: ['V'], icon: 'mouse-pointer-2' },
  { id: 'tool.zoom', label: 'Zoom tool', menu: 'View', path: ['Tools'], keys: ['Z', 'F2'], icon: 'zoom-in' },
  { id: 'tool.pan', label: 'Pan tool', menu: 'View', path: ['Tools'], keys: ['H'], icon: 'hand' },
  // Help
  { id: 'help.shortcuts', label: 'Keyboard shortcuts', menu: 'Help', group: 1, keys: ['F1', '?'], icon: 'keyboard' },
]

export const commandById = (id) => COMMANDS.find((c) => c.id === id)

/** Menu structure for the menubar: [{menu, items: [{id,label,...} | {sep:true} | {label, items:[...]}]}]. Empty menus are left out. */
export function menuTree(commands = COMMANDS) {
  return MENUS.map((menu) => {
    const items = []
    let lastGroup = null
    for (const c of commands.filter((x) => x.menu === menu)) {
      if (lastGroup != null && c.group != null && c.group !== lastGroup && !c.path) items.push({ sep: true })
      if (!c.path) lastGroup = c.group ?? lastGroup
      let list = items
      for (const name of c.path || []) {
        let sub = list.find((i) => i.items && i.label === name)
        if (!sub) { sub = { label: name, items: [] }; list.push(sub) }
        list = sub.items
      }
      list.push(c)
    }
    return { menu, items }
  }).filter((m) => m.items.length)
}

const NAMED = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc', Del: 'Delete' }
/**
 * KeyboardEvent -> 'Ctrl+Shift+PageDown'. Modifier order Ctrl, Alt, Shift (Cmd counts as Ctrl). With Ctrl held, letters, digits, brackets,
 * plus and minus come from e.code so the shortcut does not depend on the keyboard layout. Shift is dropped for symbol keys without Ctrl
 * because the character already carries it ('?' is '?', not 'Shift+?').
 */
export function normalizeKey(e) {
  const mods = []
  const ctrl = e.ctrlKey || e.metaKey
  let key = e.key
  if (ctrl && e.code) {
    if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
    else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5)
    else if (e.code === 'BracketLeft') key = '['
    else if (e.code === 'BracketRight') key = ']'
    else if (e.code === 'Equal') key = '='
    else if (e.code === 'Minus') key = '-'
  }
  key = NAMED[key] || (key.length === 1 ? key.toUpperCase() : key)
  if (ctrl) mods.push('Ctrl')
  if (e.altKey) mods.push('Alt')
  const symbol = key.length === 1 && !/[A-Z0-9]/.test(key)
  if (e.shiftKey && !(symbol && !ctrl)) mods.push('Shift')
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return ''
  return [...mods, key].join('+')
}

/** Map key string -> command id, plus any keys claimed twice: {map, dupes:[[key, idA, idB]]}. */
export function buildKeymap(commands = COMMANDS) {
  const map = new Map(), dupes = []
  for (const c of commands) for (const k of c.keys || []) { if (map.has(k)) dupes.push([k, map.get(k), c.id]); else map.set(k, c.id) }
  return { map, dupes }
}
/** Rows for the shortcuts sheet: [{id, label, menu, keys}] for commands that have keys. */
export const shortcutRows = (commands = COMMANDS) => commands.filter((c) => c.keys?.length).map((c) => ({ id: c.id, label: (c.path ? c.path.join(' > ') + ' > ' : '') + c.label, menu: c.menu, keys: c.keys }))
