// Draw Studio commands for views, guides, effects, bitmaps, windows and help (milestones E11 to E13). Run functions for the metadata in
// _ds-keys.js. Every document change is one store.tx. Dialogs and file work live in the shell and in _ds-ui-dlg.js, reached through `app`.
import { download } from '../../lib/ui.js'
import { baseName } from '../../lib/files.js'
import { addGuide, clearGuides, deleteGuide } from './_ds-guides.js'
import { leavesOf, setStyle } from './_ds-ops.js'
import { mapItems } from './_ds-doc.js'
import { editableIds, tabOrder } from './_ds-sel.js'
import { setFillType, setOpacity } from './_ds-fill.js'
import { mapPath, mul, scale } from './_model.js'

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp' }
const TRACE_PRESET = { traceLogo: 'logo', traceLine: 'lineart', tracePoster: 'poster' }

/** env: {store, tools, app, assets} -> {impl, fx: {fillType, outline, opacity, trace, imageTarget, hasPath, addGuideAt, deleteSelGuide, saveOriginal}} */
export function createFxImpl({ store, tools, app, assets }) {
  const say = (t) => store.setStatus(t)
  const hasSel = () => store.sel.ids.length > 0
  const page = () => store.page()
  const selLeaves = () => leavesOf(editableIds(store).map((id) => store.find(id)?.node).filter(Boolean))
  const hasPath = () => selLeaves().some((l) => l.t === 'path')
  const imageTarget = () => selLeaves().find((l) => l.t === 'image') || null
  const toggle = (key, dflt = true) => ({ run: () => app.keepPref(key, !(store.prefs[key] ?? dflt)), checked: () => !!(store.prefs[key] ?? dflt) })
  const toolCmd = (id) => ({ run: () => tools.set(id), checked: () => store.tool === id })

  // ---------- effects ----------
  /** Set the fill type of the selection: 'none' | 'uniform' | 'linear' | 'radial'. */
  function fillType(kind) {
    const ids = editableIds(store)
    if (!ids.length) { say(hasSel() ? 'Locked objects cannot be changed. Unlock them in the Objects docker.' : 'Select an object first.'); return false }
    if (!selLeaves().some((l) => l.t === 'path')) { say('Pictures and text have no gradient to edit. Select a shape.'); return false }
    const label = { none: 'No fill', uniform: 'Uniform fill', linear: 'Linear fill', radial: 'Radial fill' }[kind]
    const ok = store.tx(label, (r) => setFillType(r, ids, kind))
    if (ok && (kind === 'linear' || kind === 'radial') && store.tool !== 'fill') say('Switch to the Interactive fill tool (G) to drag the handles.')
    return ok
  }
  /** Outline attributes (strokeWidth, stroke, cap, join, miter, dash, dashOffset) on the selected shapes, one undo step. */
  function outline(patch, label = 'Outline', merge) {
    const ids = editableIds(store)
    if (!ids.length || !hasPath()) { say(hasSel() ? 'Only drawn shapes have an outline.' : 'Select an object first.'); return false }
    return store.tx(label, (r) => setStyle(r, ids, patch), merge ? { merge } : {})
  }
  /** Opacity 0 to 1 on everything selected (fill, outline, pictures and text together). */
  function opacity(a, merge = 'opacity') {
    const ids = editableIds(store)
    if (!ids.length) { say(hasSel() ? 'Locked objects cannot be changed. Unlock them in the Objects docker.' : 'Select an object first.'); return false }
    return store.tx(a >= 1 ? 'Clear transparency' : 'Transparency', (r) => setOpacity(r, ids, a), merge ? { merge } : {})
  }

  // ---------- bitmaps ----------
  /**
   * Trace the selected bitmap: the vector result becomes a group just above it and the bitmap stays. o: {preset, colors, detail, smooth, removeBg, signal}.
   * Resolves {paths, nodes, colors} (paths 0 = nothing was made).
   */
  async function trace(o) {
    const node = imageTarget()
    if (!node) throw new Error('Select a bitmap first.')
    const { traceImage, PRESETS } = await import('./_trace.js')
    const P = PRESETS[o.preset] || PRESETS.logo
    const img = new Image()
    img.src = assets.url(node.asset)
    await img.decode()
    if (o.signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
    const res = await traceImage(img, { ...P, colors: o.colors ?? P.colors, detail: o.detail ?? P.detail, smooth: o.smooth ?? P.smooth, removeBg: o.removeBg ?? P.removeBg })
    if (o.signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
    if (!res.paths) return { paths: 0, nodes: 0, colors: 0 }
    // the trace lives in a page of res.page.w x res.page.h; the bitmap's m maps the unit square to the page
    const M = mul(node.m, scale(1 / res.page.w, 1 / res.page.h))
    const items = res.page.items.map((it) => ({
      id: store.newId(), t: 'path', d: mapPath(it.d, M), fill: it.fill, fillOpacity: it.fillOpacity ?? 1, rule: it.rule || 'nonzero', stroke: null, strokeWidth: 0, strokeOpacity: 1, cap: 0, join: 0, miter: 4, dash: null, dashOffset: 0,
      ...(node.clip ? { clip: node.clip } : {}),
    }))
    const group = { id: store.newId(), t: 'group', name: `Traced ${node.name || 'bitmap'}`, items }
    if (!store.root.pages.length || !store.find(node.id)) throw new Error('The drawing changed while tracing. Try again.')
    store.tx('Trace bitmap', (r) => mapItems(r, new Set([node.id]), (n) => [n, group]), { sel: [group.id] })
    return { paths: res.paths, nodes: res.nodes, colors: res.colors }
  }
  function saveOriginal() {
    const node = imageTarget()
    const blob = node && assets.blob(node.asset)
    if (!blob) { say('Select a bitmap first.'); return }
    download(blob, `${(baseName(node.name || '') || 'bitmap').replace(/[\\/:*?"<>|]+/g, '_')}.${EXT[assets.mime(node.asset)] || 'png'}`)
    say('Saved the original bitmap exactly as it is stored in the drawing.')
  }

  // ---------- guides ----------
  const guidesOf = () => page()?.guides || []
  const deleteSelGuide = () => {
    const id = store.guideSel, p = page()
    if (id == null || !p) return
    store.tx('Delete guide', (r) => deleteGuide(r, p.id, id))
    store.guideSel = null; store.emit('guides')
  }
  const addGuideAt = (axis, pos) => { const p = page(); const out = {}; if (p && store.tx('Add guide', (r) => addGuide(r, p.id, axis, pos, store.newId, { out }))) { store.guideSel = out.id; store.emit('guides'); return out.id } return null }

  const impl = {
    'view.wireframe': { run: () => { store.setPref('wire', !store.prefs.wire); say(store.prefs.wire ? 'Wireframe view: outlines only' : '') }, checked: () => !!store.prefs.wire },
    'view.rulers': { run: () => app.keepPref('rulers', !app.rulersShown()), checked: () => app.rulersShown() },
    'view.guides': toggle('showGuides'),
    'view.grid': toggle('showGrid', false),
    'view.snapGuides': toggle('snapGuides'), 'view.snapObjects': toggle('snapObjects'), 'view.snapPage': toggle('snapPage'), 'view.snapGrid': toggle('snapGrid', false),
    'layout.guideH': { run: () => app.guideDialog(null, 'h'), enabled: () => !!page() && !page().pending },
    'layout.guideV': { run: () => app.guideDialog(null, 'v'), enabled: () => !!page() && !page().pending },
    'layout.editGuide': { run: () => app.guideDialog(store.guideSel), enabled: () => store.guideSel != null },
    'layout.deleteGuide': { run: deleteSelGuide, enabled: () => store.guideSel != null },
    'layout.clearGuides': { run: () => { const p = page(); if (p) store.tx('Clear guides', (r) => clearGuides(r, p.id)); store.guideSel = null }, enabled: () => guidesOf().length > 0 },
    'layout.lockGuides': toggle('lockGuides', false),
    'tool.fill': toolCmd('fill'), 'tool.transp': toolCmd('transp'), 'tool.eyedrop': toolCmd('eyedrop'),
    'effects.outlinePen': { run: () => app.outlineDialog(), enabled: hasPath },
    'effects.clearTransp': { run: () => opacity(1, null), enabled: hasSel },
    'bitmap.saveOriginal': { run: saveOriginal, enabled: () => !!imageTarget() },
    'bitmap.place': { run: () => app.placeBitmap(), enabled: () => app.hasDoc() },
    'file.import': { run: () => app.importFiles() },
    'file.properties': { run: () => app.docProps(), enabled: () => app.hasDoc() },
    'edit.options': { run: () => app.optionsDialog() },
    'edit.invertSelection': { run: () => { const cur = new Set(store.sel.ids); store.setSel(tabOrder(store).filter((id) => !cur.has(id)), 'marquee') }, enabled: () => !!page() },
    'win.properties': { run: () => app.showDock('properties') },
    'win.palette': { run: () => app.togglePanel('palette'), checked: () => app.panelShown('palette') },
    'win.toolbox': { run: () => app.togglePanel('toolbox'), checked: () => app.panelShown('toolbox') },
    'win.reset': { run: () => app.resetLayout() },
    'help.conversions': { run: () => app.showConversions() },
    'help.formats': { run: () => app.showFormats() },
    'help.about': { run: () => app.showAbout() },
  }
  for (const [id, preset] of Object.entries(TRACE_PRESET)) impl[`bitmap.${id}`] = { run: () => app.traceDialog(preset), enabled: () => !!imageTarget() }
  return { impl, fx: { fillType, outline, opacity, trace, imageTarget, hasPath, addGuideAt, deleteSelGuide, saveOriginal } }
}
