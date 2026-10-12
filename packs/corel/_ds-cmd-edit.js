// Draw Studio editing commands (run functions for the metadata in _ds-keys.js): delete, duplicate, group, order, mirror, rotate, nudge,
// layers, selection cycling and painting. Every one is a single store.tx, so each is one undo step.
import { fromUnit } from './_ds-units.js'
import { addLayer, arrange, deleteIds, duplicate, group, leavesOf, mirror, moveNodes, rotate90, setStyle, transformIds, ungroup } from './_ds-ops.js'
import { editableIds, selectionBox, tabOrder, topIds } from './_ds-sel.js'
import { deleteGuide } from './_ds-guides.js'
import { translate } from './_model.js'

/** A command that returns PASS did not use the key: the dispatcher leaves the event alone (Tab leaves the canvas after the last object). */
export const PASS = Symbol('pass')

/** env: {store, boxOf, tools, app: {paint hooks, colorDialog, toggleDock, dockOpen}} -> {impl: {commandId: {run, enabled?, checked?}}, paint} */
export function createEditImpl({ store, boxOf, tools, app }) {
  const sel = () => store.sel.ids
  const live = () => editableIds(store)
  const say = (t) => store.setStatus(t)
  const hasSel = () => sel().length > 0
  /** Editable top-level selected ids, or [] after telling the user why not. */
  function targets(what = 'edited') {
    if (!sel().length) { say('Select an object first.'); return [] }
    const ids = topIds(store, live())
    if (!ids.length) say(`Locked objects cannot be ${what}. Unlock them in the Objects docker.`)
    return ids
  }
  const withBox = (label, fn) => () => {
    const ids = targets()
    if (!ids.length) return
    const box = selectionBox(store, boxOf, ids)
    if (box) store.tx(label, (r) => fn(r, ids, box))
  }

  const mode = (label, m) => ({ run: () => { const ids = targets(); if (ids.length) store.tx(label, (r) => arrange(r, ids, m)) }, enabled: hasSel })
  const nudge = (dx, dy) => ({
    run: (a) => {
      const ids = targets('moved')
      if (!ids.length) return
      const d = fromUnit((a?.step ?? 1) * (store.prefs.nudge ?? 1), 'mm')
      store.tx('Nudge', (r) => transformIds(r, ids, translate(dx * d, dy * d)), { merge: 'nudge' })
    },
    enabled: hasSel,
  })

  /** Apply a colour (hex) or none (null) as the fill or outline of the selection, groups included. K is the CMYK hint the dialog shows again. */
  function paint(kind, hex, K) {
    if (kind === 'fill' && hex && tools.current?.paintStop?.(hex)) { app.noteColor?.(hex); return true } // the Interactive fill tool with a colour stop selected recolours that stop
    if (!sel().length) { say('Select an object first.'); return false }
    const ids = live()
    if (!ids.length) { say('Locked objects cannot be recoloured.'); return false }
    const leaves = leavesOf(ids.map((id) => store.find(id).node))
    if (!leaves.some((l) => l.t === 'path' || (l.t === 'text' && kind === 'fill' && hex))) { say(kind === 'fill' ? 'Pictures and empty groups have no fill to change.' : 'Only drawn shapes have an outline.'); return false }
    const patch = kind === 'fill' ? { fill: hex, fillK: K || null } : { stroke: hex, strokeK: K || null }
    store.tx(kind === 'fill' ? (hex ? 'Fill colour' : 'Clear fill') : (hex ? 'Outline colour' : 'Clear outline'), (r) => setStyle(r, ids, patch))
    if (hex) app.noteColor?.(hex)
    return true
  }

  function select(dir) {
    const order = tabOrder(store)
    if (!order.length) return PASS
    const cur = sel().length ? order.indexOf(sel()[sel().length - 1]) : -1
    if (cur < 0 && !sel().length) { if (dir < 0) return PASS; store.setSel([order[0]]); return undefined }
    const next = cur < 0 ? (dir > 0 ? 0 : order.length - 1) : cur + dir
    if (next < 0 || next >= order.length) { store.setSel([]); return PASS } // past the ends: let Tab leave the canvas
    store.setSel([order[next]])
    return undefined
  }

  const impl = {
    'edit.delete': {
      run: () => {
        if (!sel().length && store.guideSel != null) { const p = store.page(), id = store.guideSel; store.tx('Delete guide', (r) => deleteGuide(r, p.id, id)); store.guideSel = null; store.emit('guides'); return }
        const ids = targets('deleted')
        if (ids.length) store.tx('Delete', (r) => deleteIds(r, ids), { sel: [] })
      },
      enabled: () => hasSel() || store.guideSel != null,
    },
    'edit.duplicate': {
      run: () => {
        const ids = targets('duplicated')
        if (!ids.length) return
        const out = { ids: [] }, d = fromUnit(store.prefs.dupOffset ?? 5, 'mm')
        store.tx('Duplicate', (r) => duplicate(r, ids, store.newId, { dx: d, dy: d, out }), { get sel() { return out.ids } })
      },
      enabled: hasSel,
    },
    'arrange.group': {
      run: () => {
        const ids = targets()
        if (ids.length < 2) { if (ids.length) say('Select two or more objects to group.'); return }
        const out = {}
        store.tx('Group', (r) => group(r, ids, store.newId, { out }), { get sel() { return out.id != null ? [out.id] : sel() } })
      },
      enabled: () => sel().length > 1,
    },
    'arrange.ungroup': { run: () => ungroupRun(false), enabled: () => sel().some((id) => store.find(id)?.node?.t === 'group') },
    'arrange.ungroupAll': { run: () => ungroupRun(true), enabled: () => sel().some((id) => store.find(id)?.node?.t === 'group') },
    'arrange.front': mode('To front', 'front'),
    'arrange.back': mode('To back', 'back'),
    'arrange.forward': mode('Forward one', 'forward'),
    'arrange.backward': mode('Back one', 'backward'),
    'arrange.reverse': { ...mode('Reverse order', 'reverse'), enabled: () => sel().length > 1 },
    'object.mirrorH': { run: withBox('Mirror horizontally', (r, ids, box) => mirror(r, ids, 'h', box)), enabled: hasSel },
    'object.mirrorV': { run: withBox('Mirror vertically', (r, ids, box) => mirror(r, ids, 'v', box)), enabled: hasSel },
    'object.rotateCw': { run: withBox('Rotate 90 degrees', (r, ids, box) => rotate90(r, ids, true, box)), enabled: hasSel },
    'object.rotateCcw': { run: withBox('Rotate 90 degrees', (r, ids, box) => rotate90(r, ids, false, box)), enabled: hasSel },
    'object.nudgeLeft': nudge(-1, 0), 'object.nudgeRight': nudge(1, 0), 'object.nudgeUp': nudge(0, -1), 'object.nudgeDown': nudge(0, 1),
    'object.newLayer': {
      run: () => {
        const page = store.page(), out = {}
        const above = store.activeLayerOf(page)?.id
        if (store.tx('New layer', (r) => addLayer(r, page.id, store.newId, { aboveId: above, out }))) { store.setActiveLayer(page.id, out.id); say(`Added ${store.find(out.id)?.layer?.name || 'a layer'}`) }
      },
    },
    'object.moveToLayer': {
      run: (a) => {
        if (a?.layerId == null) { if (hasSel()) app.moveToLayerDialog?.(); else say('Select an object first.'); return }
        const ids = targets('moved')
        if (ids.length) store.tx('Move to layer', (r) => moveNodes(r, ids, { into: a.layerId }))
      },
      enabled: hasSel,
    },
    'edit.selectNext': { run: () => select(1) },
    'edit.selectPrev': { run: () => select(-1) },
    'view.snap': { run: () => { app.keepPref('snap', store.prefs.snap === false); say(store.prefs.snap === false ? 'Snapping is off' : 'Snapping is on') }, checked: () => store.prefs.snap !== false },
    'win.objects': { run: () => app.toggleDock(), checked: () => app.dockOpen() },
    'effects.fillColor': { run: () => app.colorDialog('fill'), enabled: hasSel },
    'effects.outlineColor': { run: () => app.colorDialog('stroke'), enabled: hasSel },
    'effects.clearFill': { run: () => paint('fill', null), enabled: hasSel },
    'effects.clearOutline': { run: () => paint('stroke', null), enabled: hasSel },
  }
  return { impl, paint }

  function ungroupRun(all) {
    const ids = targets().filter((id) => store.find(id)?.node?.t === 'group')
    if (!ids.length) { say('Select a group first.'); return }
    const out = { ids: [] }
    store.tx(all ? 'Ungroup all' : 'Ungroup', (r) => ungroup(r, ids, { all, out }), { get sel() { return out.ids } })
  }
}
