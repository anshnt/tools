// Draw Studio command metadata: ids, labels, menu placement and keys. No run functions here (those are bound in _ds-cmd.js), so Node tests
// can assert: no two commands share a key, every command is in a menu, every menu exists. A feature that is cut is removed from this table,
// the menus and the toolbox together (no dead buttons).
//   {id, label, menu, path?: ['Submenu'], group?: n (a separator is drawn when it changes), keys: ['Ctrl+O'], icon?, phone?: true (shown in the phone bar),
//    keyArgs?: {'Shift+Left': {step: 10}} (arguments passed to run when that key fires; menus run with none),
//    hint?: 'Ctrl+C' (shown in the menu and the shortcut sheet, but NOT bound: the browser's own copy, cut and paste events do that work),
//    also?: ['Window'] (further menus that list the same command)}
export const MENUS = ['File', 'Edit', 'View', 'Layout', 'Object', 'Effects', 'Bitmaps', 'Text', 'Window', 'Help']

export const COMMANDS = [
  // File
  { id: 'file.new', label: 'New', menu: 'File', group: 1, keys: ['Alt+N'], icon: 'file-plus' },
  { id: 'file.open', label: 'Open...', menu: 'File', group: 1, keys: ['Ctrl+O'], icon: 'folder-open', phone: true },
  { id: 'file.import', label: 'Import...', menu: 'File', group: 1, keys: ['Ctrl+I'], icon: 'upload' },
  { id: 'file.restore', label: 'Restore autosaved drawing...', menu: 'File', group: 1, keys: [], icon: 'history' },
  { id: 'file.save', label: 'Save as CDR', menu: 'File', group: 2, keys: ['Ctrl+S'], icon: 'save', phone: true },
  { id: 'file.saveAs', label: 'Save as...', menu: 'File', group: 2, keys: ['Ctrl+Shift+S'], icon: 'file-down' },
  { id: 'file.export', label: 'Export...', menu: 'File', group: 2, keys: ['Ctrl+E'], icon: 'file-output' },
  { id: 'file.exportSel', label: 'Export selection as PNG...', menu: 'File', group: 2, keys: [], icon: 'image' },
  { id: 'file.properties', label: 'Document properties...', menu: 'File', group: 4, keys: [], icon: 'sliders-horizontal' },
  { id: 'file.notes', label: 'Notes about this file', menu: 'File', group: 4, keys: [], icon: 'info' },
  { id: 'file.exportNotes', label: 'Notes about the last save or export', menu: 'File', group: 4, keys: [], icon: 'info' },
  // Edit
  { id: 'edit.undo', label: 'Undo', menu: 'Edit', group: 1, keys: ['Ctrl+Z'], icon: 'undo-2', phone: true },
  { id: 'edit.redo', label: 'Redo', menu: 'Edit', group: 1, keys: ['Ctrl+Shift+Z', 'Ctrl+Y'], icon: 'redo-2', phone: true },
  { id: 'edit.cut', label: 'Cut', menu: 'Edit', group: 2, keys: [], hint: 'Ctrl+X', icon: 'scissors' },
  { id: 'edit.copy', label: 'Copy', menu: 'Edit', group: 2, keys: [], hint: 'Ctrl+C', icon: 'copy' },
  { id: 'edit.paste', label: 'Paste', menu: 'Edit', group: 2, keys: [], hint: 'Ctrl+V', icon: 'clipboard-paste' },
  { id: 'edit.pasteInPlace', label: 'Paste in place', menu: 'Edit', group: 2, keys: [], hint: 'Ctrl+Shift+V', icon: 'clipboard-paste' },
  { id: 'edit.duplicate', label: 'Duplicate', menu: 'Edit', group: 2, keys: ['Ctrl+D'], icon: 'copy' },
  { id: 'edit.delete', label: 'Delete', menu: 'Edit', group: 2, keys: ['Delete', 'Backspace'], icon: 'trash-2' },
  { id: 'edit.selectAll', label: 'Select all', menu: 'Edit', group: 3, keys: ['Ctrl+A'], icon: 'box-select' },
  { id: 'edit.selectNone', label: 'Select none', menu: 'Edit', group: 3, keys: ['Esc'], icon: 'square-dashed' },
  { id: 'edit.selectNext', label: 'Select next object', menu: 'Edit', group: 3, keys: ['Tab'], icon: 'chevron-right' },
  { id: 'edit.selectPrev', label: 'Select previous object', menu: 'Edit', group: 3, keys: ['Shift+Tab'], icon: 'chevron-left' },
  { id: 'edit.invertSelection', label: 'Invert selection', menu: 'Edit', group: 3, keys: [], icon: 'box-select' },
  { id: 'edit.options', label: 'Options...', menu: 'Edit', group: 4, keys: [], icon: 'settings' },
  // View
  { id: 'view.zoomIn', label: 'Zoom in', menu: 'View', group: 1, keys: ['+', '=', 'Ctrl+='], icon: 'zoom-in' },
  { id: 'view.zoomOut', label: 'Zoom out', menu: 'View', group: 1, keys: ['-', 'F3', 'Ctrl+-'], icon: 'zoom-out' },
  { id: 'view.zoomSel', label: 'Zoom to selection', menu: 'View', group: 1, keys: ['Shift+F2'], icon: 'scan-search' },
  { id: 'view.zoomAll', label: 'Zoom to all objects', menu: 'View', group: 1, keys: ['F4'], icon: 'scan-search' },
  { id: 'view.zoomPage', label: 'Zoom to page', menu: 'View', group: 1, keys: ['Shift+F4', 'Ctrl+0'], icon: 'frame' },
  { id: 'view.zoom100', label: '100 percent', menu: 'View', group: 1, keys: ['Ctrl+1'], icon: 'maximize' },
  { id: 'view.wireframe', label: 'Wireframe', menu: 'View', group: 2, keys: ['Shift+F9'], icon: 'square-dashed' },
  { id: 'view.rulers', label: 'Rulers', menu: 'View', group: 3, keys: ['Ctrl+Alt+R'], icon: 'ruler', also: ['Window'] },
  { id: 'view.guides', label: 'Guides', menu: 'View', group: 3, keys: [], icon: 'ruler' },
  { id: 'view.grid', label: 'Grid', menu: 'View', group: 3, keys: [], icon: 'grid-3x3' },
  { id: 'view.snap', label: 'Snapping', menu: 'View', group: 4, keys: ['Alt+Z'], icon: 'magnet' },
  { id: 'view.snapGuides', label: 'Snap to guides', menu: 'View', path: ['Snap to'], keys: [], icon: 'magnet' },
  { id: 'view.snapObjects', label: 'Snap to objects', menu: 'View', path: ['Snap to'], keys: [], icon: 'magnet' },
  { id: 'view.snapPage', label: 'Snap to page', menu: 'View', path: ['Snap to'], keys: [], icon: 'magnet' },
  { id: 'view.snapGrid', label: 'Snap to grid', menu: 'View', path: ['Snap to'], keys: ['Ctrl+Shift+Y'], icon: 'grid-3x3' },
  { id: 'view.fullscreen', label: 'Full screen', menu: 'View', group: 5, keys: ['F9'], icon: 'maximize' },
  // Layout
  { id: 'page.insertAfter', label: 'Insert page after', menu: 'Layout', group: 1, keys: [], icon: 'file-plus' },
  { id: 'page.insertBefore', label: 'Insert page before', menu: 'Layout', group: 1, keys: [], icon: 'file-plus' },
  { id: 'page.duplicate', label: 'Duplicate page', menu: 'Layout', group: 1, keys: [], icon: 'copy' },
  { id: 'page.delete', label: 'Delete page', menu: 'Layout', group: 1, keys: [], icon: 'trash-2' },
  { id: 'page.rename', label: 'Rename page', menu: 'Layout', group: 1, keys: [], icon: 'pencil' },
  { id: 'page.moveLeft', label: 'Move page left', menu: 'Layout', group: 1, keys: [], icon: 'chevron-left' },
  { id: 'page.moveRight', label: 'Move page right', menu: 'Layout', group: 1, keys: [], icon: 'chevron-right' },
  { id: 'page.prev', label: 'Previous page', menu: 'Layout', group: 2, keys: ['PageUp'], icon: 'chevron-left' },
  { id: 'page.next', label: 'Next page', menu: 'Layout', group: 2, keys: ['PageDown'], icon: 'chevron-right' },
  { id: 'page.setup', label: 'Page setup...', menu: 'Layout', group: 3, keys: [], icon: 'ruler' },
  { id: 'page.orientation', label: 'Switch orientation', menu: 'Layout', group: 3, keys: [], icon: 'rotate-cw' },
  { id: 'layout.guideH', label: 'Add horizontal guide...', menu: 'Layout', group: 4, keys: [], icon: 'ruler' },
  { id: 'layout.guideV', label: 'Add vertical guide...', menu: 'Layout', group: 4, keys: [], icon: 'ruler' },
  { id: 'layout.editGuide', label: 'Guide position...', menu: 'Layout', group: 4, keys: [], icon: 'pencil' },
  { id: 'layout.deleteGuide', label: 'Delete guide', menu: 'Layout', group: 4, keys: [], icon: 'trash-2' },
  { id: 'layout.clearGuides', label: 'Clear guides', menu: 'Layout', group: 4, keys: [], icon: 'circle-slash' },
  { id: 'layout.lockGuides', label: 'Lock guides', menu: 'Layout', group: 4, keys: [], icon: 'lock' },
  // Object
  { id: 'arrange.group', label: 'Group', menu: 'Object', group: 1, keys: ['Ctrl+G'], icon: 'group' },
  { id: 'arrange.ungroup', label: 'Ungroup', menu: 'Object', group: 1, keys: ['Ctrl+U'], icon: 'ungroup' },
  { id: 'arrange.ungroupAll', label: 'Ungroup all', menu: 'Object', group: 1, keys: ['Ctrl+Shift+U'], icon: 'ungroup' },
  { id: 'arrange.combine', label: 'Combine', menu: 'Object', group: 1, keys: ['Ctrl+L'], icon: 'combine' },
  { id: 'arrange.breakApart', label: 'Break apart', menu: 'Object', group: 1, keys: ['Ctrl+K'], icon: 'split' },
  { id: 'arrange.lock', label: 'Lock', menu: 'Object', group: 1, keys: ['Ctrl+Shift+L'], icon: 'lock' },
  { id: 'arrange.unlockAll', label: 'Unlock all objects', menu: 'Object', group: 1, keys: ['Ctrl+Alt+Shift+L'], icon: 'unlock' },
  { id: 'arrange.front', label: 'To front', menu: 'Object', path: ['Order'], keys: ['Shift+PageUp', 'Ctrl+Shift+]'], icon: 'bring-to-front' },
  { id: 'arrange.back', label: 'To back', menu: 'Object', path: ['Order'], keys: ['Shift+PageDown', 'Ctrl+Shift+['], icon: 'send-to-back' },
  { id: 'arrange.forward', label: 'Forward one', menu: 'Object', path: ['Order'], keys: ['Ctrl+PageUp', 'Ctrl+]'], icon: 'arrow-up-to-line' },
  { id: 'arrange.backward', label: 'Back one', menu: 'Object', path: ['Order'], keys: ['Ctrl+PageDown', 'Ctrl+['], icon: 'arrow-down-to-line' },
  { id: 'arrange.reverse', label: 'Reverse order', menu: 'Object', path: ['Order'], keys: [], icon: 'layers' },
  { id: 'object.mirrorH', label: 'Mirror horizontally', menu: 'Object', group: 3, keys: [], icon: 'flip-horizontal' },
  { id: 'object.mirrorV', label: 'Mirror vertically', menu: 'Object', group: 3, keys: [], icon: 'flip-vertical' },
  { id: 'object.rotateCw', label: 'Rotate 90 degrees clockwise', menu: 'Object', group: 3, keys: [], icon: 'rotate-cw' },
  { id: 'object.rotateCcw', label: 'Rotate 90 degrees counter-clockwise', menu: 'Object', group: 3, keys: [], icon: 'rotate-ccw' },
  { id: 'object.nudgeLeft', label: 'Nudge left', menu: 'Object', path: ['Nudge'], keys: ['Left', 'Shift+Left', 'Ctrl+Left'], keyArgs: { Left: { step: 1 }, 'Shift+Left': { step: 10 }, 'Ctrl+Left': { step: 0.1 } }, icon: 'chevron-left' },
  { id: 'object.nudgeRight', label: 'Nudge right', menu: 'Object', path: ['Nudge'], keys: ['Right', 'Shift+Right', 'Ctrl+Right'], keyArgs: { Right: { step: 1 }, 'Shift+Right': { step: 10 }, 'Ctrl+Right': { step: 0.1 } }, icon: 'chevron-right' },
  { id: 'object.nudgeUp', label: 'Nudge up', menu: 'Object', path: ['Nudge'], keys: ['Up', 'Shift+Up', 'Ctrl+Up'], keyArgs: { Up: { step: 1 }, 'Shift+Up': { step: 10 }, 'Ctrl+Up': { step: 0.1 } }, icon: 'chevron-up' },
  { id: 'object.nudgeDown', label: 'Nudge down', menu: 'Object', path: ['Nudge'], keys: ['Down', 'Shift+Down', 'Ctrl+Down'], keyArgs: { Down: { step: 1 }, 'Shift+Down': { step: 10 }, 'Ctrl+Down': { step: 0.1 } }, icon: 'chevron-down' },
  { id: 'align.left', label: 'Align left', menu: 'Object', path: ['Align'], keys: ['L'], icon: 'align-start-vertical' },
  { id: 'align.right', label: 'Align right', menu: 'Object', path: ['Align'], keys: ['R'], icon: 'align-end-vertical' },
  { id: 'align.top', label: 'Align top', menu: 'Object', path: ['Align'], keys: ['T'], icon: 'align-start-horizontal' },
  { id: 'align.bottom', label: 'Align bottom', menu: 'Object', path: ['Align'], keys: ['B'], icon: 'align-end-horizontal' },
  { id: 'align.centerH', label: 'Centre horizontally', menu: 'Object', path: ['Align'], keys: ['E'], icon: 'align-center-vertical' },
  { id: 'align.centerV', label: 'Centre vertically', menu: 'Object', path: ['Align'], keys: ['C'], icon: 'align-center-horizontal' },
  { id: 'align.page', label: 'Centre on page', menu: 'Object', path: ['Align'], keys: ['P'], icon: 'frame' },
  { id: 'distribute.left', label: 'Left edges', menu: 'Object', path: ['Distribute'], keys: [], icon: 'align-horizontal-distribute-start' },
  { id: 'distribute.centerH', label: 'Centres horizontally', menu: 'Object', path: ['Distribute'], keys: [], icon: 'align-horizontal-distribute-center' },
  { id: 'distribute.right', label: 'Right edges', menu: 'Object', path: ['Distribute'], keys: [], icon: 'align-horizontal-distribute-end' },
  { id: 'distribute.spaceH', label: 'Spacing horizontally', menu: 'Object', path: ['Distribute'], keys: [], icon: 'align-horizontal-space-between' },
  { id: 'distribute.top', label: 'Top edges', menu: 'Object', path: ['Distribute'], keys: [], icon: 'align-vertical-distribute-start' },
  { id: 'distribute.centerV', label: 'Centres vertically', menu: 'Object', path: ['Distribute'], keys: [], icon: 'align-vertical-distribute-center' },
  { id: 'distribute.bottom', label: 'Bottom edges', menu: 'Object', path: ['Distribute'], keys: [], icon: 'align-vertical-distribute-end' },
  { id: 'distribute.spaceV', label: 'Spacing vertically', menu: 'Object', path: ['Distribute'], keys: [], icon: 'align-vertical-space-between' },
  { id: 'shape.weld', label: 'Weld', menu: 'Object', path: ['Shaping'], keys: [], icon: 'merge' },
  { id: 'shape.trim', label: 'Trim', menu: 'Object', path: ['Shaping'], keys: [], icon: 'scissors' },
  { id: 'shape.intersect', label: 'Intersect', menu: 'Object', path: ['Shaping'], keys: [], icon: 'combine' },
  { id: 'shape.simplify', label: 'Simplify', menu: 'Object', path: ['Shaping'], keys: [], icon: 'layers-2' },
  { id: 'shape.frontMinusBack', label: 'Front minus back', menu: 'Object', path: ['Shaping'], keys: [], icon: 'square-minus' },
  { id: 'shape.backMinusFront', label: 'Back minus front', menu: 'Object', path: ['Shaping'], keys: [], icon: 'square-minus' },
  { id: 'node.add', label: 'Add node', menu: 'Object', path: ['Nodes'], keys: [], icon: 'plus' },
  { id: 'node.delete', label: 'Delete nodes', menu: 'Object', path: ['Nodes'], keys: [], icon: 'minus' },
  { id: 'node.toLine', label: 'To line', menu: 'Object', path: ['Nodes'], keys: [], icon: 'minus' },
  { id: 'node.toCurve', label: 'To curve', menu: 'Object', path: ['Nodes'], keys: [], icon: 'spline' },
  { id: 'node.cusp', label: 'Cusp node', menu: 'Object', path: ['Nodes'], keys: [], icon: 'square' },
  { id: 'node.smooth', label: 'Smooth node', menu: 'Object', path: ['Nodes'], keys: [], icon: 'circle' },
  { id: 'node.symmetrical', label: 'Symmetrical node', menu: 'Object', path: ['Nodes'], keys: [], icon: 'diamond' },
  { id: 'node.break', label: 'Break curve', menu: 'Object', path: ['Nodes'], keys: [], icon: 'split' },
  { id: 'node.join', label: 'Join nodes', menu: 'Object', path: ['Nodes'], keys: [], icon: 'link' },
  { id: 'node.close', label: 'Close curve', menu: 'Object', path: ['Nodes'], keys: [], icon: 'circle-dot' },
  { id: 'node.reverse', label: 'Reverse direction', menu: 'Object', path: ['Nodes'], keys: [], icon: 'arrow-left-right' },
  { id: 'object.clip', label: 'Clip to container', menu: 'Object', group: 6, keys: [], icon: 'frame' },
  { id: 'object.unclip', label: 'Release clip', menu: 'Object', group: 6, keys: [], icon: 'square-dashed' },
  { id: 'object.toCurves', label: 'Convert to curves', menu: 'Object', group: 5, keys: ['Ctrl+Q', 'Ctrl+Alt+Q'], icon: 'spline' },
  { id: 'object.newLayer', label: 'New layer', menu: 'Object', group: 4, keys: [], icon: 'plus' },
  { id: 'object.moveToLayer', label: 'Move to layer...', menu: 'Object', group: 4, keys: [], icon: 'layers' },
  // Effects
  { id: 'tool.fill', label: 'Interactive fill', menu: 'Effects', group: 1, keys: ['G'], icon: 'paint-bucket' },
  { id: 'tool.transp', label: 'Transparency', menu: 'Effects', group: 1, keys: ['Shift+T'], icon: 'blend' },
  { id: 'tool.eyedrop', label: 'Copy attributes (eyedropper)', menu: 'Effects', group: 1, keys: ['I'], icon: 'pipette' },
  { id: 'effects.fillColor', label: 'Fill colour...', menu: 'Effects', group: 2, keys: ['F11', 'Shift+F11'], icon: 'paint-bucket' },
  { id: 'effects.outlinePen', label: 'Outline pen...', menu: 'Effects', group: 2, keys: ['F12'], icon: 'pen-line' },
  { id: 'effects.outlineColor', label: 'Outline colour...', menu: 'Effects', group: 2, keys: ['Shift+F12'], icon: 'pen-line' },
  { id: 'effects.clearFill', label: 'Clear fill', menu: 'Effects', group: 3, keys: [], icon: 'circle-slash' },
  { id: 'effects.clearOutline', label: 'Clear outline', menu: 'Effects', group: 3, keys: [], icon: 'circle-slash' },
  { id: 'effects.clearTransp', label: 'Clear transparency', menu: 'Effects', group: 3, keys: [], icon: 'circle-slash' },
  // Bitmaps
  { id: 'bitmap.traceLogo', label: 'Logo or clipart...', menu: 'Bitmaps', path: ['Trace bitmap'], keys: [], icon: 'wand-sparkles' },
  { id: 'bitmap.traceLine', label: 'Line art (black and white)...', menu: 'Bitmaps', path: ['Trace bitmap'], keys: [], icon: 'wand-sparkles' },
  { id: 'bitmap.tracePoster', label: 'Poster or photo...', menu: 'Bitmaps', path: ['Trace bitmap'], keys: [], icon: 'wand-sparkles' },
  { id: 'bitmap.saveOriginal', label: 'Save original bitmap...', menu: 'Bitmaps', group: 2, keys: [], icon: 'download' },
  { id: 'bitmap.place', label: 'Place bitmap...', menu: 'Bitmaps', group: 2, keys: [], icon: 'image-plus' },
  // Text
  { id: 'text.edit', label: 'Edit text', menu: 'Text', group: 1, keys: ['Enter'], icon: 'type' },
  { id: 'text.bold', label: 'Bold', menu: 'Text', group: 2, keys: [], icon: 'bold' },
  { id: 'text.italic', label: 'Italic', menu: 'Text', group: 2, keys: [], icon: 'italic' },
  { id: 'text.alignLeft', label: 'Align left', menu: 'Text', group: 3, keys: [], icon: 'align-left' },
  { id: 'text.alignCenter', label: 'Align centre', menu: 'Text', group: 3, keys: [], icon: 'align-center' },
  { id: 'text.alignRight', label: 'Align right', menu: 'Text', group: 3, keys: [], icon: 'align-right' },
  { id: 'text.larger', label: 'Increase size', menu: 'Text', group: 4, keys: [], icon: 'a-arrow-up' },
  { id: 'text.smaller', label: 'Decrease size', menu: 'Text', group: 4, keys: [], icon: 'a-arrow-down' },
  { id: 'text.toCurves', label: 'Convert to curves', menu: 'Text', group: 5, keys: [], icon: 'spline' },
  { id: 'text.addFont', label: 'Add font file...', menu: 'Text', group: 5, keys: [], icon: 'file-up' },
  // Window
  { id: 'win.objects', label: 'Objects', menu: 'Window', group: 1, keys: ['Ctrl+F3'], icon: 'layers' },
  { id: 'win.properties', label: 'Properties', menu: 'Window', group: 1, keys: ['Alt+Enter'], icon: 'sliders-horizontal' },
  { id: 'win.align', label: 'Align and distribute', menu: 'Window', group: 1, keys: ['Ctrl+Shift+A'], icon: 'align-center' },
  { id: 'win.transform', label: 'Transform', menu: 'Window', group: 1, keys: [], icon: 'move' },
  { id: 'win.transformPos', label: 'Transform: position', menu: 'Window', path: ['Transform'], keys: ['Alt+F7'], icon: 'move' },
  { id: 'win.transformRotate', label: 'Transform: rotate', menu: 'Window', path: ['Transform'], keys: ['Alt+F8'], icon: 'rotate-cw' },
  { id: 'win.transformScale', label: 'Transform: scale', menu: 'Window', path: ['Transform'], keys: ['Alt+F9'], icon: 'scaling' },
  { id: 'win.transformSize', label: 'Transform: size', menu: 'Window', path: ['Transform'], keys: ['Alt+F10'], icon: 'scaling' },
  { id: 'win.palette', label: 'Colour palette', menu: 'Window', group: 2, keys: [], icon: 'panel-right' },
  { id: 'win.toolbox', label: 'Toolbox', menu: 'Window', group: 2, keys: [], icon: 'hammer' },
  { id: 'win.reset', label: 'Reset layout', menu: 'Window', group: 3, keys: [], icon: 'rotate-ccw' },
  // Tools (the toolbox is built from TOOL_INFO in _ds-tools.js; the keys are mirrored here so duplicates are caught)
  { id: 'tool.pick', label: 'Pick tool', menu: 'View', path: ['Tools'], keys: ['V'], icon: 'mouse-pointer-2' },
  { id: 'tool.zoom', label: 'Zoom tool', menu: 'View', path: ['Tools'], keys: ['Z', 'F2'], icon: 'zoom-in' },
  { id: 'tool.shape', label: 'Shape tool', menu: 'View', path: ['Tools'], keys: ['F10'], icon: 'spline-pointer' },
  { id: 'tool.pan', label: 'Pan tool', menu: 'View', path: ['Tools'], keys: ['H'], icon: 'hand' },
  { id: 'tool.free', label: 'Freehand tool', menu: 'View', path: ['Tools'], keys: ['F5'], icon: 'pencil' },
  { id: 'tool.pen', label: 'Bezier tool', menu: 'View', path: ['Tools'], keys: ['Shift+P', 'Shift+F5'], icon: 'pen-tool' },
  { id: 'tool.rect', label: 'Rectangle tool', menu: 'View', path: ['Tools'], keys: ['F6'], icon: 'square' },
  { id: 'tool.ellipse', label: 'Ellipse tool', menu: 'View', path: ['Tools'], keys: ['F7'], icon: 'circle' },
  { id: 'tool.polygon', label: 'Polygon tool', menu: 'View', path: ['Tools'], keys: ['Y'], icon: 'hexagon' },
  { id: 'tool.star', label: 'Star tool', menu: 'View', path: ['Tools'], keys: ['Shift+Y'], icon: 'star' },
  { id: 'tool.text', label: 'Text tool', menu: 'View', path: ['Tools'], keys: ['F8'], icon: 'type' },
  // Help
  { id: 'help.shortcuts', label: 'Keyboard shortcuts and command finder', menu: 'Help', group: 1, keys: ['F1', '?', 'Ctrl+/'], icon: 'keyboard' },
  { id: 'help.conversions', label: 'Notes on conversions', menu: 'Help', group: 2, keys: [], icon: 'info' },
  { id: 'help.formats', label: 'Supported formats', menu: 'Help', group: 2, keys: [], icon: 'files' },
  { id: 'help.about', label: 'About Draw Studio', menu: 'Help', group: 3, keys: [], icon: 'circle-help' },
]

export const commandById = (id) => COMMANDS.find((c) => c.id === id)

/** Menu structure for the menubar: [{menu, items: [{id,label,...} | {sep:true} | {label, items:[...]}]}]. Empty menus are left out. */
export function menuTree(commands = COMMANDS) {
  // a command that also appears in another menu (its `also`) is merged by group, so the groups stay together
  const listFor = (menu) => {
    const own = commands.filter((x) => x.menu === menu), extra = commands.filter((x) => x.menu !== menu && x.also?.includes(menu))
    return extra.length ? [...own, ...extra].map((c, i) => [c, i]).sort((a, b) => (a[0].group ?? 0) - (b[0].group ?? 0) || a[1] - b[1]).map(([c]) => c) : own
  }
  return MENUS.map((menu) => {
    const items = []
    let lastGroup = null
    for (const c of listFor(menu)) {
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

/** Map key string -> command id, plus any keys claimed twice: {map, dupes:[[key, idA, idB]], args: key -> arguments for run}. */
export function buildKeymap(commands = COMMANDS) {
  const map = new Map(), dupes = [], args = new Map()
  for (const c of commands) for (const k of c.keys || []) { if (map.has(k)) dupes.push([k, map.get(k), c.id]); else map.set(k, c.id); if (c.keyArgs?.[k]) args.set(k, c.keyArgs[k]) }
  return { map, dupes, args }
}
/** Rows for the shortcuts sheet: [{id, label, menu, keys}] for commands that have keys. */
export const shortcutRows = (commands = COMMANDS) => commands.filter((c) => c.keys?.length || c.hint).map((c) => ({ id: c.id, label: (c.path ? c.path.join(' > ') + ' > ' : '') + c.label, menu: c.menu, keys: c.keys?.length ? c.keys : [c.hint] }))
