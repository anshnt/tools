// Photo Studio: a layered photo editor in the browser. Entry module: mount(root, ctx) builds the app shell and returns a cleanup function.
// A clean-room take on the same category as the open-source PhotoCraft by ArtCraft (https://github.com/storytold/photocraft); no code is shared.
import { h, icon, dropzone, toast, modal, button, errorMessage, download, onCleanup } from '../../lib/ui.js'
import { pickFiles } from '../../lib/files.js'
import { persisted } from '../../lib/store.js'
import { clamp, rctx, stem } from './_util.js'
import { injectStyle } from './_style.js'
import { Viewport } from './_view.js'
import { TOOLS, toolById } from './_tools.js'
import { createOps } from './_ops.js'
import { createDialogs, PRESETS } from './_dialogs.js'
import { ctl, tooltips, openMenu, closeMenus } from './_chrome.js'
import { optionsBar, layersPanel, propsPanel, historyPanel, colorPanel } from './_panels.js'
import { ADJUSTMENTS } from './_adjust.js'
import { blankDoc, docFromImage, docFromPsd, docFromProject, imageToCanvas, isPsd, isProject, projectBlob, saveAuto, loadAuto, clearAuto } from './_io.js'
import { shapeLayer, textLayer } from './_doc.js'

const ACCEPT = 'image/*,.heic,.heif,.psd,.zip,.photostudio'
const RAIL = [['move'], ['marquee', 'ellipse', 'lasso', 'wand', 'crop'], ['brush', 'eraser', 'clone', 'bucket', 'gradient'], ['text', 'shapes'], ['eyedropper', 'zoom', 'hand']]
const TEMPLATES = {
  social: { name: 'Social post', w: 1080, h: 1350, from: '#6366f1', to: '#ec4899', title: 'Your headline here', sub: 'Add a short line of supporting text' },
  thumbnail: { name: 'Video thumbnail', w: 1280, h: 720, from: '#0f172a', to: '#7c3aed', title: 'CATCHY TITLE', sub: 'Subtitle goes here' },
  quote: { name: 'Quote card', w: 1080, h: 1080, from: '#f59e0b', to: '#ef4444', title: '"A great quote worth sharing"', sub: 'Author name' },
}

export async function mount(root, ctx) {
  injectStyle()
  const params = ctx?.params || {}
  const slot = params.slot || 'main'
  const saved = persisted('photo-studio:opts', null)
  const defaults = Object.fromEntries(TOOLS.map((t) => [t.id, { ...t.defaults }]))
  const stored = saved.get() || {}
  const subs = {}

  const app = {
    root, slot, params, doc: null, tool: 'move', spaceDown: false, clip: null, live: null, preview: null, crop: null, armClone: false, recent: stored.recent || [],
    fg: stored.fg || '#111111', bg: stored.bg || '#ffffff',
    opts: { selMode: 'new', cloneSource: null, cloneOffset: null, tools: Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, { ...v, ...(stored.tools?.[k] || {}) }])) },
    on(ev, fn) { (subs[ev] ||= new Set()).add(fn); return () => subs[ev].delete(fn) },
    emit(ev, d) { for (const fn of subs[ev] || []) fn(d) },
    toolOpts() { return this.opts.tools[this.tool] },
    toast(m, t) { toast(m, t) },
    warn(m) { toast(m, 'info') },
    renderOpts() { return { live: this.live, override: this.preview } },
  }
  app.ops = createOps(app)
  app.dialogs = createDialogs(app)
  app.vp = new Viewport(app)
  const vp = app.vp

  // ---------- persistence of options and colors ----------
  let persistTimer
  const persist = () => { clearTimeout(persistTimer); persistTimer = setTimeout(() => saved.set({ tools: app.opts.tools, fg: app.fg, bg: app.bg, recent: app.recent }), 400) }
  app.setOpt = (k, v, shared) => {
    if (shared) app.opts[k] = v; else app.toolOpts()[k] = v
    persist()
    if (k === 'size' || k === 'hardness') bar.sync()
  }

  // ---------- colors ----------
  const pushRecent = (c) => { app.recent = [c, ...app.recent.filter((x) => x !== c)].slice(0, 14) }
  app.setColor = (which, c) => { app[which] = c; if (which === 'fg') pushRecent(c); refreshColors(); persist() }
  app.setFg = (c) => app.setColor('fg', c)
  app.setBg = (c) => app.setColor('bg', c)
  app.swapColors = () => { [app.fg, app.bg] = [app.bg, app.fg]; refreshColors(); persist() }
  app.resetColors = () => { app.fg = '#000000'; app.bg = '#ffffff'; refreshColors(); persist() }

  // ---------- panels ----------
  const bar = optionsBar(app)
  const layers = layersPanel(app)
  const props = propsPanel(app)
  const history = historyPanel(app)
  const colorsP = colorPanel(app)
  app.focusText = (select) => { showTab('props'); if (mobile.matches) openDock(true); setTimeout(() => props.focusText(select), 40) }

  // ---------- DOM ----------
  const rail = h('div', { class: 'ps-rail', role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' })
  const toolBtns = {}
  RAIL.forEach((group, gi) => {
    if (gi) rail.append(h('div', { class: 'ps-gap' }))
    for (const id of group) {
      const t = toolById(id)
      const b = h('button', { type: 'button', class: 'ps-tool', 'aria-pressed': 'false', 'aria-label': t.name, 'data-tip': `${t.name}|${t.key.toUpperCase()}`, 'data-tip-pos': 'right', onclick: () => app.setTool(id) }, icon(t.icon))
      toolBtns[id] = b
      rail.append(b)
    }
  })
  const fgSw = h('span', { class: 'sw' }), bgSw = h('span', { class: 'sw' })
  const fgInp = h('input', { type: 'color', 'aria-label': 'Foreground color', oninput: (e) => app.setColor('fg', e.target.value) })
  const bgInp = h('input', { type: 'color', 'aria-label': 'Background color', oninput: (e) => app.setColor('bg', e.target.value) })
  rail.append(h('div', { class: 'ps-colors' },
    h('label', { class: 'bg', 'data-tip': 'Background color', 'data-tip-pos': 'right' }, bgSw, bgInp), h('label', { class: 'fg', 'data-tip': 'Foreground color|X swaps', 'data-tip-pos': 'right' }, fgSw, fgInp),
    h('button', { type: 'button', class: 'swap', 'aria-label': 'Swap colors', onclick: () => app.swapColors() }, icon('arrow-left-right')),
    h('button', { type: 'button', class: 'reset', 'aria-label': 'Default colors', onclick: () => app.resetColors() }, icon('rotate-ccw'))))
  function refreshColors() {
    fgSw.style.background = app.fg; bgSw.style.background = app.bg; fgInp.value = app.fg; bgInp.value = app.bg
    colorsP.refresh()
  }

  const ring = h('div', { class: 'ps-ring' })
  const center = h('div', { class: 'ps-center' }, vp.el, ring)
  app.setRing = (sx, sy, d) => { const s = Math.max(4, d); Object.assign(ring.style, { display: 'block', left: `${sx}px`, top: `${sy}px`, width: `${s}px`, height: `${s}px` }) }
  app.hoverOut = () => { ring.style.display = 'none' }

  // dock
  const tabDefs = [['layers', 'Layers'], ['props', 'Properties'], ['color', 'Color'], ['history', 'History']]
  const tabBtns = {}
  const tabBar = h('div', { class: 'ps-tabs', role: 'tablist' })
  const bodies = { layers: h('div', { class: 'ps-body', style: 'padding:0;display:flex;flex-direction:column' }), props: h('div', { class: 'ps-body' }, props.el), color: h('div', { class: 'ps-body' }, colorsP.el), history: h('div', { class: 'ps-body' }, history.el) }
  for (const [id, label] of tabDefs) {
    const b = h('button', { type: 'button', role: 'tab', class: 'ps-tab', 'aria-selected': 'false', 'data-id': id, onclick: () => showTab(id) }, label)
    if (id === 'layers') b.style.display = 'none'
    tabBtns[id] = b; tabBar.append(b)
  }
  const topSec = h('div', { class: 'ps-sec' }, tabBar, ...Object.values(bodies))
  const layerSec = layers.el
  const dock = h('div', { class: 'ps-dock', 'aria-label': 'Panels' }, topSec, layerSec)
  let activeTab = 'props'
  function showTab(id) {
    if (id === 'layers' && !mobile.matches) id = 'props'
    activeTab = id
    for (const [k, b] of Object.entries(bodies)) b.hidden = k !== id
    for (const [k, b] of Object.entries(tabBtns)) b.setAttribute('aria-selected', String(k === id))
  }
  const mobile = matchMedia('(max-width: 860px)')
  function layoutDock() {
    if (mobile.matches) { bodies.layers.append(layerSec); layerSec.style.display = 'flex'; tabBtns.layers.style.display = '' ; layerSec.classList.remove('layers-sec') }
    else { dock.append(layerSec); tabBtns.layers.style.display = 'none'; layerSec.classList.add('layers-sec'); if (activeTab === 'layers') showTab('props') }
    layerSec.style.flex = '1'
    showTab(activeTab)
  }

  // top bar
  const undoBtn = h('button', { type: 'button', class: 'ps-ib', 'aria-label': 'Undo', 'data-tip': 'Undo|Ctrl+Z', onclick: () => app.undo() }, icon('undo-2'))
  const redoBtn = h('button', { type: 'button', class: 'ps-ib', 'aria-label': 'Redo', 'data-tip': 'Redo|Ctrl+Shift+Z', onclick: () => app.redo() }, icon('redo-2'))
  const zoomTxt = h('button', { type: 'button', class: 'ps-ib ps-zoomtxt', style: 'width:auto;padding:0 6px', 'aria-label': 'Zoom, click for 100%', 'data-tip': 'Actual size|Ctrl+1', onclick: () => app.doc && vp.setZoom(1) }, '100%')
  const dockBtn = h('button', { type: 'button', class: 'ps-ib ps-dock-btn', 'aria-label': 'Panels', 'aria-pressed': 'false', 'data-tip': 'Layers and panels', onclick: () => openDock(root_ps.dataset.dock !== 'open') }, icon('layers'))
  function openDock(on) { root_ps.dataset.dock = on ? 'open' : 'closed'; dockBtn.setAttribute('aria-pressed', String(on)) }
  const menuBtns = []
  const mbtn = (label, build) => { const b = h('button', { type: 'button', class: 'ps-mb', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: (e) => openMenu(root_ps, e.currentTarget, build()) }, label); menuBtns.push(b); return b }
  const exportBtn = h('button', { type: 'button', class: 'ps-go', 'aria-label': 'Export', onclick: () => app.doc ? app.dialogs.export() : app.warn('Open or create an image first.') }, icon('download'), h('span', 'Export'))
  const top = h('div', { class: 'ps-top', role: 'toolbar', 'aria-label': 'Menu' },
    mbtn('File', fileMenu), mbtn('Edit', editMenu), mbtn('Image', imageMenu), mbtn('Layer', layerMenu), mbtn('Select', selectMenu), mbtn('Filter', filterMenu), mbtn('View', viewMenu),
    h('span', { class: 'ps-sp' }), undoBtn, redoBtn, h('span', { class: 'ps-sep' }),
    h('button', { type: 'button', class: 'ps-ib', 'aria-label': 'Zoom out', 'data-tip': 'Zoom out|Ctrl+-', onclick: () => app.doc && vp.zoomBy(1 / 1.25) }, icon('zoom-out')), zoomTxt,
    h('button', { type: 'button', class: 'ps-ib', 'aria-label': 'Zoom in', 'data-tip': 'Zoom in|Ctrl++', onclick: () => app.doc && vp.zoomBy(1.25) }, icon('zoom-in')),
    h('button', { type: 'button', class: 'ps-ib', 'aria-label': 'Fit on screen', 'data-tip': 'Fit on screen|Ctrl+0', onclick: () => app.doc && vp.fit() }, icon('scan')),
    dockBtn, h('span', { class: 'ps-sep' }), exportBtn)

  const status = { zoom: h('b', '100%'), size: h('b', '-'), cursor: h('b', ''), sel: h('b', ''), saved: h('span', '') }
  const statusBar = h('div', { class: 'ps-status', 'aria-live': 'off' }, h('span', 'Zoom ', status.zoom), h('span', 'Size ', status.size), h('span', status.cursor), h('span', status.sel), h('span', { class: 'ps-sp' }), status.saved)
  const root_ps = h('div', { class: 'ps', 'data-dock': 'closed' }, top, bar.el, h('div', { class: 'ps-main' }, rail, center, dock), statusBar)
  const credit = h('p', { class: 'small muted', style: 'margin:10px 4px 0' }, 'Prefer a native app? ', h('a', { class: 'link', href: 'https://github.com/storytold/photocraft', target: '_blank', rel: 'noopener' }, 'PhotoCraft by ArtCraft'), ' is free and open source. Photo Studio runs fully on your device; nothing is uploaded.')
  // hidden drop target so files dropped anywhere on the page reach the editor
  const sink = h('div', { class: 'dropzone', hidden: true, 'aria-hidden': 'true' })
  sink._accept = ACCEPT
  sink._take = (files) => app.openFiles(files)
  root.append(root_ps, credit, sink)
  const hideTip = tooltips(root_ps)

  // ---------- menus ----------
  function needDoc() { return !app.doc }
  function fileMenu() {
    return [
      { label: 'New document...', icon: 'file-plus', run: () => app.dialogs.newDoc() },
      { label: 'Open image, PSD or project...', icon: 'folder-open', run: () => app.pick(true) },
      { label: 'Place image as layer...', icon: 'image-plus', disabled: needDoc, run: () => app.pick(false) },
      { heading: 'Templates' }, ...Object.entries(TEMPLATES).map(([k, t]) => ({ label: `${t.name} (${t.w} x ${t.h})`, icon: 'layout-template', run: () => app.newFromTemplate(k) })),
      { sep: true },
      { label: 'Save project file', icon: 'save', key: 'Ctrl+S', disabled: needDoc, run: () => app.saveProject() },
      { label: 'Export image or PSD...', icon: 'download', key: 'Ctrl+Shift+E', disabled: needDoc, run: () => app.dialogs.export() },
      { sep: true }, { label: 'Close document', icon: 'x', disabled: needDoc, run: () => app.closeDoc() },
    ]
  }
  function editMenu() {
    const d = app.doc
    return [
      { label: 'Undo', icon: 'undo-2', key: 'Ctrl+Z', disabled: () => !d?.hist.canUndo, run: () => app.undo() }, { label: 'Redo', icon: 'redo-2', key: 'Ctrl+Shift+Z', disabled: () => !d?.hist.canRedo, run: () => app.redo() }, { sep: true },
      { label: 'Cut', icon: 'scissors', key: 'Ctrl+X', disabled: needDoc, run: () => app.ops.copy(true) }, { label: 'Copy', icon: 'copy', key: 'Ctrl+C', disabled: needDoc, run: () => app.ops.copy(false) },
      { label: 'Copy merged', key: 'Ctrl+Shift+C', disabled: needDoc, run: () => app.ops.copy(false, true) }, { label: 'Paste as new layer', icon: 'clipboard-paste', key: 'Ctrl+V', disabled: needDoc, run: () => app.pasteFromMenu() }, { sep: true },
      { label: 'Fill...', icon: 'paint-bucket', disabled: needDoc, run: () => app.dialogs.fill() }, { label: 'Clear selection', icon: 'eraser', key: 'Delete', disabled: () => !d?.sel, run: () => app.ops.clearSelection() },
      { label: 'Transform layer...', icon: 'scaling', disabled: needDoc, run: () => app.dialogs.transformLayer() }, { sep: true },
      { label: 'Keyboard shortcuts', icon: 'keyboard', run: () => app.dialogs.shortcuts() },
    ]
  }
  function imageMenu() {
    const d = app.doc
    return [
      { label: 'Image size...', icon: 'scaling', disabled: needDoc, run: () => app.dialogs.imageSize() }, { label: 'Canvas size...', icon: 'maximize-2', disabled: needDoc, run: () => app.dialogs.canvasSize() }, { sep: true },
      { label: 'Rotate 90° clockwise', icon: 'rotate-cw', disabled: needDoc, run: () => app.docOp('cw') }, { label: 'Rotate 90° counter-clockwise', icon: 'rotate-ccw', disabled: needDoc, run: () => app.docOp('ccw') },
      { label: 'Rotate 180°', disabled: needDoc, run: () => app.docOp('180') }, { label: 'Flip horizontal', icon: 'flip-horizontal', disabled: needDoc, run: () => app.docOp('fh') }, { label: 'Flip vertical', icon: 'flip-vertical', disabled: needDoc, run: () => app.docOp('fv') }, { sep: true },
      { label: 'Crop to selection', icon: 'crop', disabled: () => !d?.sel, run: () => app.ops.cropToSelection() }, { label: 'Flatten image', icon: 'layers-2', disabled: () => !d || d.layers.length < 2, run: () => d.flatten() },
    ]
  }
  function layerMenu() {
    const d = app.doc, L = d?.active
    return [
      { label: 'New layer', icon: 'plus', key: 'Ctrl+Shift+N', disabled: needDoc, run: () => app.ops.newLayer() }, { label: 'Duplicate layer', icon: 'copy', key: 'Ctrl+J', disabled: () => !L, run: () => d.duplicate(L.id) },
      { label: 'Delete layer', icon: 'trash-2', disabled: () => !L, run: () => d.deleteLayer(L.id) }, { label: 'Merge down', icon: 'merge', key: 'Ctrl+E', disabled: () => !L, run: () => app.mergeDown() },
      { label: 'Rasterize text or shape', icon: 'image', disabled: () => !L || (L.type !== 'text' && L.type !== 'shape'), run: () => d.rasterize(L.id) }, { sep: true },
      { label: 'Add mask (reveal all)', icon: 'venetian-mask', disabled: () => !L || !!L.mask, run: () => d.addMask(L.id, 'reveal') }, { label: 'Add mask from selection', disabled: () => !L || !!L.mask || !d.sel, run: () => d.addMask(L.id, 'sel') },
      { label: 'Apply mask', disabled: () => !L?.mask || L.type === 'adjust', run: () => d.removeMask(L.id, true) }, { label: 'Delete mask', disabled: () => !L?.mask, run: () => d.removeMask(L.id, false) }, { sep: true },
      { label: 'Flip layer horizontally', icon: 'flip-horizontal', disabled: () => !L, run: () => d.flipLayer(L.id, 'fh') }, { label: 'Flip layer vertically', icon: 'flip-vertical', disabled: () => !L, run: () => d.flipLayer(L.id, 'fv') },
      { label: 'Move layer up', icon: 'arrow-up', key: 'Ctrl+]', disabled: () => !L, run: () => app.moveLayer(1) }, { label: 'Move layer down', icon: 'arrow-down', key: 'Ctrl+[', disabled: () => !L, run: () => app.moveLayer(-1) }, { sep: true },
      { heading: 'New adjustment layer' }, ...Object.entries(ADJUSTMENTS).map(([k, a]) => ({ label: a.name, icon: a.icon, disabled: needDoc, run: () => app.ops.addAdjustment(k) })),
    ]
  }
  function selectMenu() {
    const d = app.doc
    return [
      { label: 'All', key: 'Ctrl+A', disabled: needDoc, run: () => app.ops.selectAll() }, { label: 'Deselect', key: 'Ctrl+D', disabled: () => !d?.sel, run: () => app.ops.deselect() }, { label: 'Invert', key: 'Ctrl+Shift+I', disabled: needDoc, run: () => app.ops.invertSelection() }, { sep: true },
      { label: 'Feather...', disabled: () => !d?.sel, run: () => app.dialogs.feather() }, { label: 'Expand or contract...', disabled: () => !d?.sel, run: () => app.dialogs.grow() }, { sep: true },
      { label: 'Layer via copy', key: 'Ctrl+J', disabled: () => !d?.sel, run: () => app.ops.layerViaCopy() }, { label: 'Layer via cut', key: 'Ctrl+Shift+J', disabled: () => !d?.sel, run: () => app.ops.layerViaCut() },
    ]
  }
  function filterMenu() {
    return [{ label: 'Gaussian blur...', icon: 'droplet', run: () => app.dialogs.filter('blur') }, { label: 'Sharpen...', icon: 'triangle', run: () => app.dialogs.filter('sharpen') },
      { label: 'Add noise...', icon: 'dices', run: () => app.dialogs.filter('noise') }, { label: 'Pixelate...', icon: 'grid-3x3', run: () => app.dialogs.filter('pixelate') }].map((i) => ({ ...i, disabled: needDoc }))
  }
  function viewMenu() {
    return [{ label: 'Zoom in', key: 'Ctrl++', run: () => vp.zoomBy(1.25) }, { label: 'Zoom out', key: 'Ctrl+-', run: () => vp.zoomBy(1 / 1.25) }, { label: 'Fit on screen', key: 'Ctrl+0', run: () => vp.fit() }, { label: 'Actual pixels (100%)', key: 'Ctrl+1', run: () => vp.setZoom(1) },
      { sep: true }, { label: 'Keyboard shortcuts', icon: 'keyboard', run: () => app.dialogs.shortcuts() }].map((i) => (i.sep ? i : { ...i, disabled: needDoc && i.label !== 'Keyboard shortcuts' }))
  }

  // ---------- tools ----------
  app.setTool = (id) => {
    const old = toolById(app.tool)
    app.cancelTool()
    old.deactivate?.(app)
    app.tool = id
    const t = toolById(id)
    for (const [k, b] of Object.entries(toolBtns)) b.setAttribute('aria-pressed', String(k === id))
    vp.el.style.cursor = t.cursor || 'default'
    ring.style.display = 'none'
    bar.render()
    if (app.doc) t.activate?.(app)
    vp.invalidateOverlay()
    updateStatus()
  }
  app.cancelTool = () => { toolById(app.tool).cancel?.(app); app.live = null; vp.invalidate() }
  app.toolDown = (e, p) => {
    if (!app.doc) return
    const t = toolById(app.tool)
    if (!app.doc.layers.length && !['text', 'zoom', 'hand', 'crop', 'eyedropper'].includes(t.id)) return app.warn('Add a layer first.')
    t.down?.(app, e, p)
  }
  app.toolMove = (e, p) => { toolById(app.tool).move?.(app, e, p); trackCursor(p) }
  app.toolUp = (e, p) => { toolById(app.tool).up?.(app, e, p) }
  app.hover = (e, p) => { toolById(app.tool).hover?.(app, e, p); if (!toolById(app.tool).hover) ring.style.display = 'none'; trackCursor(p) }
  app.drawToolOverlay = (c, v) => { toolById(app.tool).overlay?.(app, c, v) }
  app.optAction = (k) => {
    if (k === 'applyCrop') return app.applyCrop()
    if (k === 'cancelCrop') { app.crop = app.doc ? { x: 0, y: 0, w: app.doc.w, h: app.doc.h } : null; vp.invalidateOverlay(); updateStatus() }
    if (k === 'zoomFit') vp.fit()
    if (k === 'zoom100') vp.setZoom(1)
    if (k === 'setSource') { app.armClone = true; app.toast('Tap or click the image to choose the clone source.') }
  }
  app.applyCrop = () => {
    const r = app.crop, d = app.doc
    if (!r || !d || r.w < 1 || r.h < 1) return
    if (r.w === d.w && r.h === d.h && r.x === 0 && r.y === 0) return app.warn('Drag the crop box first, then apply.')
    d.crop(r); app.crop = { x: 0, y: 0, w: d.w, h: d.h }; vp.fit()
  }
  app.paintTarget = () => {
    const d = app.doc, L = d?.active
    if (!L) { app.warn('Add or select a layer first.'); return null }
    if (L.locked) { app.warn('This layer is locked. Click its lock icon to unlock it.'); return null }
    if (d.editMask && L.mask) return { L, target: 'mask' }
    if (L.type === 'adjust') {
      if (L.mask) { d.select(L.id, true); return { L, target: 'mask' } }
      app.warn('Adjustment layers hold settings, not pixels. Add a layer mask to paint where it applies.'); return null
    }
    if (L.type !== 'raster') { app.warn(`This is a ${L.type} layer. Rasterize it (Layer menu) to paint on it, or add a mask.`); return null }
    if (!L.visible) { app.warn('This layer is hidden. Show it to paint on it.'); return null }
    return { L, target: 'layer' }
  }

  // ---------- document plumbing ----------
  let layersTimer
  const refreshLayersSoon = () => { clearTimeout(layersTimer); layersTimer = setTimeout(() => layers.refresh(), 60) }
  function onDocEvent(ev) {
    switch (ev.what) {
      case 'pixels': vp.invalidate(ev.rect); refreshLayersSoon(); break
      case 'sel': vp.updateAnts(); updateStatus(); break
      case 'active': layers.refresh(); props.refresh(); vp.invalidateOverlay(); break
      case 'history': history.refresh(); updateTop(); scheduleSave(); break
      case 'size': app.crop = toolById(app.tool).activate && app.tool === 'crop' ? { x: 0, y: 0, w: app.doc.w, h: app.doc.h } : null; vp.fit(); updateStatus(); break
      default: vp.invalidate(); layers.refresh(); props.refresh(); vp.updateAnts(); vp.invalidateOverlay(); updateStatus(); updateTop()
    }
  }
  let unsub = null
  const startEl = h('div', { class: 'ps-start' })
  center.append(startEl)
  app.setDoc = (doc) => {
    unsub?.()
    app.doc = doc
    unsub = doc.on(onDocEvent)
    app.crop = null; app.preview = null; app.live = null; app.opts.cloneSource = null; app.opts.cloneOffset = null
    startEl.hidden = true
    vp.setDoc()
    layers.refresh(); props.refresh(); history.refresh(); updateStatus(); updateTop()
    toolById(app.tool).activate?.(app)
    scheduleSave(true)
  }
  app.newDoc = (w, h2, bg) => app.setDoc(blankDoc(w, h2, bg))
  app.closeDoc = async () => {
    if (!app.doc) return
    if (app.doc.hist.list.length && !(await confirmBox('Close this document?', 'Your autosaved copy in this browser will be deleted. Save the project file or export first if you want to keep it.', 'Close document'))) return
    unsub?.(); unsub = null
    app.doc = null
    await clearAuto(slot)
    vp.invalidate(); vp.invalidateOverlay(); vp.updateAnts()
    layers.refresh(); props.refresh(); history.refresh(); updateStatus(); updateTop()
    showStart()
  }
  app.undo = () => app.doc?.hist.undo()
  app.redo = () => app.doc?.hist.redo()
  app.docOp = (op) => app.doc?.transform(op)
  app.moveLayer = (dir) => { const d = app.doc; if (d?.active) d.moveTo(d.activeId, d.index(d.activeId) + dir) }
  app.mergeDown = () => { const d = app.doc; if (d?.active && !d.mergeDown(d.activeId)) app.warn('Merge down needs a pixel, text or shape layer below the selected layer.') }

  function confirmBox(title, text, okLabel) {
    return new Promise((resolve) => {
      let ok = false
      const m = modal({ title, body: h('p', text), actions: [button('Cancel', { variant: 'ghost', onClick: () => m.close() }), button(okLabel, { variant: 'primary', onClick: () => { ok = true; m.close() } })], onClose: () => resolve(ok) })
    })
  }
  const confirmReplace = async () => !app.doc || !app.doc.hist.list.length || confirmBox('Replace the current project?', 'Opening a new file replaces what is on the canvas. Save the project file or export first if you need it.', 'Replace')

  function busy(text) {
    const el = h('div', { class: 'ps-start', style: 'z-index:30' }, h('div', { class: 'ps-start-card', style: 'width:auto;grid-auto-flow:column;align-items:center' }, h('span', { class: 'spinner' }), h('span', text)))
    center.append(el)
    return () => el.remove()
  }

  app.openFiles = async (files, { replace = false } = {}) => {
    const list = [...files]
    if (!list.length) return
    const first = list[0]
    const done = busy(`Opening ${first.name}...`)
    try {
      if (isPsd(first) || isProject(first)) {
        if (!(await confirmReplace())) return
        if (isPsd(first)) {
          const { doc, stats } = await docFromPsd(first)
          app.setDoc(doc)
          toast(`Opened ${stats.layers} layer${stats.layers === 1 ? '' : 's'}${stats.skipped ? `. ${stats.skipped} layer(s) without pixels were skipped` : ''}. Text layers arrive as pixels.`, 'success')
        } else { app.setDoc(await docFromProject(first)); toast('Project opened', 'success') }
        return
      }
      for (const f of list) {
        if (isPsd(f) || isProject(f)) continue
        if (!app.doc || (replace && f === first)) {
          if (app.doc && !(await confirmReplace())) return
          const { doc, scaled, original } = await docFromImage(f)
          app.setDoc(doc)
          if (scaled) toast(`Scaled down from ${original.w} x ${original.h} px to fit this device.`)
        } else {
          const { canvas } = await imageToCanvas(f)
          app.ops.placeCanvas(canvas, stem(f.name))
        }
      }
    } catch (e) { console.error(e); toast(errorMessage(e), 'error') } finally { done() }
  }
  app.pick = async (replace) => {
    const files = await pickFiles({ accept: ACCEPT, multiple: !replace })
    if (files.length) app.openFiles(files, { replace })
  }
  app.saveProject = async () => {
    if (!app.doc) return
    const done = busy('Saving project...')
    try { download(await projectBlob(app.doc), `${app.doc.name || 'project'}.photostudio.zip`); toast('Project saved. Open it again with File > Open.', 'success') } catch (e) { toast(errorMessage(e), 'error') } finally { done() }
  }
  app.pasteFromMenu = async () => {
    try {
      const items = await navigator.clipboard.read()
      for (const it of items) { const t = it.types.find((x) => x.startsWith('image/')); if (t) return placeBlob(await it.getType(t), 'Pasted image') }
    } catch { /* fall back to the internal clipboard */ }
    app.ops.paste()
  }
  async function placeBlob(blob, name) {
    const file = new File([blob], `${name}.png`, { type: blob.type || 'image/png' })
    if (!app.doc) return app.openFiles([file])
    const { canvas } = await imageToCanvas(file)
    app.ops.placeCanvas(canvas, name)
  }

  app.newFromTemplate = (kind) => {
    const T = TEMPLATES[kind]
    const doc = blankDoc(T.w, T.h, '#ffffff', T.name)
    const ctx = rctx(doc.layers[0].canvas)
    const g = ctx.createLinearGradient(0, 0, T.w, T.h)
    g.addColorStop(0, T.from); g.addColorStop(1, T.to)
    ctx.fillStyle = g; ctx.fillRect(0, 0, T.w, T.h)
    const pad = Math.round(T.w * 0.08)
    const card = shapeLayer({ kind: 'rect', x: pad, y: Math.round(T.h * 0.3), w: T.w - pad * 2, h: Math.round(T.h * 0.4), fill: '#ffffff', hasFill: true, radius: 36, strokeW: 0 }, 'Card')
    card.opacity = 0.16
    const title = textLayer({ text: T.title, x: Math.round(T.w / 2), y: Math.round(T.h * 0.38), size: Math.round(T.w * 0.068), bold: true, align: 'center', color: '#ffffff', shadow: true, font: 'Geist' }, 'Headline')
    const sub = textLayer({ text: T.sub, x: Math.round(T.w / 2), y: Math.round(T.h * 0.38 + T.w * 0.068 * 1.6), size: Math.round(T.w * 0.03), align: 'center', color: '#ffffff', font: 'Geist' }, 'Subtitle')
    doc.layers.push(card, title, sub)
    doc.activeId = title.id
    app.setDoc(doc)
    app.setTool('move')
  }

  // ---------- start screen ----------
  function showStart() {
    const psd = params.mode === 'psd'
    const zone = dropzone({ accept: ACCEPT, multiple: true, paste: false, label: psd ? 'Drop a PSD file here or click to choose' : 'Drop a photo or PSD here, or click to choose', hint: 'JPG, PNG, WebP, HEIC, PSD or a saved project. It never leaves your device.', onFiles: (f) => app.openFiles(f) })
    startEl.replaceChildren(h('div', { class: 'ps-start-card' },
      h('div', h('h2', psd ? 'Open a PSD and edit its layers' : 'Start with a photo or a blank canvas'), h('p', psd ? 'Layers, masks, blend modes and opacity come through. Edit, then export a PSD, PNG, JPG or WebP.' : 'Layers, masks, selections, brushes, adjustments and text, right in your browser.')),
      zone,
      h('div', h('div', { class: 'ps-mh', style: 'padding-left:0' }, 'Blank canvas'), h('div', { class: 'ps-presets' }, PRESETS.slice(0, 4).map((p) => h('button', { type: 'button', class: 'ps-preset', onclick: () => app.newDoc(p[1], p[2], '#ffffff') }, h('b', p[0]), h('span', `${p[1]} x ${p[2]}`))),
        h('button', { type: 'button', class: 'ps-preset', onclick: () => app.dialogs.newDoc() }, h('b', 'Custom size...'), h('span', 'Any width and height')))),
      h('div', h('div', { class: 'ps-mh', style: 'padding-left:0' }, 'Quick-start templates'), h('div', { class: 'ps-presets' }, Object.entries(TEMPLATES).map(([k, t]) => h('button', { type: 'button', class: 'ps-preset', onclick: () => app.newFromTemplate(k) }, h('b', t.name), h('span', `${t.w} x ${t.h}, editable text`)))))))
    startEl.hidden = false
  }

  // ---------- status ----------
  function updateStatus() {
    const d = app.doc
    status.zoom.textContent = `${Math.round(vp.zoom * 100)}%`
    zoomTxt.textContent = `${Math.round(vp.zoom * 100)}%`
    status.size.textContent = d ? `${d.w} x ${d.h} px` : '-'
    status.sel.textContent = app.crop && app.tool === 'crop' ? `Crop ${app.crop.w} x ${app.crop.h}` : d?.sel ? `Selection ${d.sel.w} x ${d.sel.h}` : ''
  }
  function trackCursor(p) { const d = app.doc; if (d) status.cursor.textContent = p.x >= 0 && p.y >= 0 && p.x < d.w && p.y < d.h ? `${Math.floor(p.x)}, ${Math.floor(p.y)}` : '' }
  app.updateStatus = updateStatus
  function updateTop() {
    const d = app.doc
    undoBtn.disabled = !d?.hist.canUndo; redoBtn.disabled = !d?.hist.canRedo
    exportBtn.disabled = !d
  }
  const offView = app.on('view', updateStatus)

  // ---------- autosave ----------
  let saveTimer, saving = false, again = false
  function scheduleSave(first) {
    clearTimeout(saveTimer)
    status.saved.textContent = ''
    saveTimer = setTimeout(doSave, first ? 600 : 2500)
  }
  async function doSave() {
    const d = app.doc
    if (!d) return
    if (saving) { again = true; return }
    saving = true
    try {
      const ok = await saveAuto(d, slot)
      status.saved.textContent = ok ? `Autosaved in this browser at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Autosave unavailable (storage blocked)'
    } catch (e) { console.warn('Autosave failed', e); status.saved.textContent = 'Autosave failed (not enough storage?)' }
    saving = false
    if (again) { again = false; scheduleSave() }
  }

  // ---------- keyboard and clipboard ----------
  const toolKeys = {}
  for (const t of TOOLS) (toolKeys[t.key] ||= []).push(t.id)
  const typing = (t) => t?.closest?.('input:not([type=range]):not([type=color]):not([type=checkbox]), textarea, select, [contenteditable="true"]')
  const inApp = () => root_ps.contains(document.activeElement) || document.activeElement === document.body || document.activeElement === null
  function onKey(e) {
    if (typing(e.target) || document.querySelector('dialog[open]') || !inApp()) return
    const d = app.doc, mod = e.ctrlKey || e.metaKey, k = e.key
    if (k === ' ' && !mod) { if (!app.spaceDown && d) { app.spaceDown = true; vp.el.dataset.grab = '1'; e.preventDefault() } else if (d) e.preventDefault(); return }
    if (!d) return
    if (mod) {
      const lk = k.toLowerCase()
      const run = (fn) => { e.preventDefault(); fn() }
      if (lk === 'z') return run(() => (e.shiftKey ? app.redo() : app.undo()))
      if (lk === 'y') return run(() => app.redo())
      if (lk === 'a') return run(() => app.ops.selectAll())
      if (lk === 'd') return run(() => app.ops.deselect())
      if (lk === 'i' && e.shiftKey) return run(() => app.ops.invertSelection())
      if (lk === 'c') return run(() => app.ops.copy(false, e.shiftKey))
      if (lk === 'x') return run(() => app.ops.copy(true))
      if (lk === 'j') return run(() => (e.shiftKey ? app.ops.layerViaCut() : app.ops.layerViaCopy()))
      if (lk === 'e') return run(() => (e.shiftKey ? app.dialogs.export() : app.mergeDown()))
      if (lk === 's') return run(() => app.saveProject())
      if (lk === 'n' && e.shiftKey) return run(() => app.ops.newLayer())
      if (lk === '0') return run(() => vp.fit())
      if (lk === '1') return run(() => vp.setZoom(1))
      if (k === '+' || k === '=') return run(() => vp.zoomBy(1.25))
      if (k === '-' || k === '_') return run(() => vp.zoomBy(1 / 1.25))
      if (k === ']') return run(() => app.moveLayer(1))
      if (k === '[') return run(() => app.moveLayer(-1))
      if (k === 'Delete' || k === 'Backspace') return run(() => app.ops.fillSelection(e.altKey ? app.fg : app.bg))
      return
    }
    if (e.altKey && (k === 'Delete' || k === 'Backspace')) { e.preventDefault(); return app.ops.fillSelection(app.fg) }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); return app.ops.deleteOrClear() }
    if (k === 'Enter' && app.tool === 'crop') { e.preventDefault(); return app.applyCrop() }
    if (k === 'Escape') { app.cancelTool(); if (app.tool === 'crop') app.optAction('cancelCrop'); return }
    if (k.startsWith('Arrow')) {
      const L = d.active
      if (!L || L.locked || L.type === 'adjust' || app.tool !== 'move') return
      e.preventDefault()
      const n = e.shiftKey ? 10 : 1, dx = k === 'ArrowLeft' ? -n : k === 'ArrowRight' ? n : 0, dy = k === 'ArrowUp' ? -n : k === 'ArrowDown' ? n : 0
      if (L.type === 'raster') d.setProps(L.id, { x: L.x + dx, y: L.y + dy }, 'Nudge layer', 'nudge')
      else if (L.type === 'text') d.setProps(L.id, { text: { ...L.text, x: L.text.x + dx, y: L.text.y + dy } }, 'Nudge layer', 'nudge')
      else d.setProps(L.id, { shape: { ...L.shape, x: L.shape.x + dx, y: L.shape.y + dy } }, 'Nudge layer', 'nudge')
      return
    }
    const lk = k.toLowerCase()
    if (k === '[' || k === ']') {
      const o = app.toolOpts()
      if (o.size) { const f = k === ']' ? 1.15 : 1 / 1.15; app.setOpt('size', clamp(Math.round(o.size * f) + (k === ']' ? 1 : -1) * (o.size < 12 ? 1 : 0), 1, 400)); bar.sync(); vp.invalidateOverlay() }
      return
    }
    if (lk === 'x') return app.swapColors()
    if (lk === 'd') return app.resetColors()
    if (/^[0-9]$/.test(k)) {
      const v = k === '0' ? 100 : Number(k) * 10
      const o = app.toolOpts()
      if ('opacity' in o) { app.setOpt('opacity', v); bar.sync() } else if (d.active && d.active.type !== 'adjust') d.setProps(d.active.id, { opacity: v / 100 }, 'Opacity', 'opacity')
      return
    }
    if (toolKeys[lk] && !e.altKey) {
      const ids = toolKeys[lk], i = ids.indexOf(app.tool)
      app.setTool(ids[(i + 1) % ids.length])
    }
  }
  function onKeyUp(e) { if (e.key === ' ' && app.spaceDown) { e.preventDefault(); app.spaceDown = false; delete vp.el.dataset.grab } }
  const blurReset = () => { app.spaceDown = false; delete vp.el.dataset.grab }
  function onPaste(e) {
    if (typing(e.target) || document.querySelector('dialog[open]')) return
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'))
    if (files.length) { e.preventDefault(); e.stopImmediatePropagation(); placeBlob(files[0], 'Pasted image').catch((er) => toast(errorMessage(er), 'error')); return }
    if (app.doc && app.clip) { e.preventDefault(); app.ops.paste() }
  }
  document.addEventListener('keydown', onKey)
  document.addEventListener('keyup', onKeyUp)
  document.addEventListener('paste', onPaste, true)
  window.addEventListener('blur', blurReset)
  mobile.addEventListener('change', layoutDock)
  const themeObs = new MutationObserver(() => vp.invalidate())
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  // bar tweaks that need the DOM in place
  layoutDock()
  showTab(mobile.matches ? 'layers' : 'props')
  refreshColors()
  app.setTool('move')
  updateTop()
  updateStatus()
  vp.resize()

  // ---------- start: restore the last session, a template, or the start screen ----------
  const restored = await loadAuto(slot)
  if (restored) { app.setDoc(restored.doc); toast('Restored your last session', 'success') }
  else if (params.template && TEMPLATES[params.template]) app.newFromTemplate(params.template)
  else showStart()

  if (mobile.matches) requestAnimationFrame(() => root_ps.scrollIntoView({ block: 'start' })) // on phones, bring the editor into view

  // test hook (used by the automated tests; harmless in production)
  root_ps.__app = app

  return () => {
    clearTimeout(saveTimer); clearTimeout(persistTimer); clearTimeout(layersTimer)
    if (app.doc && !saving) saveAuto(app.doc, slot)
    document.removeEventListener('keydown', onKey)
    document.removeEventListener('keyup', onKeyUp)
    document.removeEventListener('paste', onPaste, true)
    window.removeEventListener('blur', blurReset)
    mobile.removeEventListener('change', layoutDock)
    themeObs.disconnect(); offView(); unsub?.(); hideTip(); closeMenus()
    vp.destroy()
  }
}
