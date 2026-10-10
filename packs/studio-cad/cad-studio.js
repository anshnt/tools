// CAD Studio: a 2D drafting app in the browser. Entry module (mount) wires the document, canvas, commands and panels.
import { h, icon, clear, button, toast, modal, debounce, dropzone } from '../../lib/ui.js'
import { pickFiles, baseName, safeName, download } from '../../lib/files.js'
import * as idb from '../../lib/idb.js'
import * as store from '../../lib/store.js'
import { pt, dist, add, angle, mid, norm, boxHit, boxPad, unionBox, clamp, Tf, R2D } from './_vec.js'
import { bbox, hitDist, inRect, transform } from './_ent.js'
import { gripsOf, HATCH_PATTERNS } from './_edit.js'
import { Doc, blankState, stateFromJSON, UNITS } from './_doc.js'
import { fmtNum } from './_dim.js'
import { findSnap, constrain, snapToGrid } from './_snap.js'
import { createCommands, CANCEL } from './_cmds.js'
import { drawScene, drawGrips, drawSnapMarker, drawTrack, drawCursor, drawWindow, drawUcs, toScreen, toWorld } from './_render.js'
import { importDxf } from './_dxf.js'
import { TEMPLATES } from './_templates.js'
import { injectStyle } from './_style.js'
import { layersPanel, propsPanel, drawingPanel, exportDialog, helpDialog, popover, menuItems } from './_ui.js'

const RAIL = [
  { id: 'select', icon: 'mouse-pointer-2', tip: 'Select (Esc)' },
  { sep: true },
  { cmd: 'LINE', icon: 'slash', tip: 'Line', key: 'L' },
  { cmd: 'PLINE', icon: 'route', tip: 'Polyline', key: 'PL' },
  { cmd: 'RECTANG', icon: 'rectangle-horizontal', tip: 'Rectangle', key: 'REC' },
  { cmd: 'CIRCLE', icon: 'circle', tip: 'Circle', key: 'C', menu: [['Centre, radius', 'CIRCLE'], ['Two points', 'CIRCLE', ['2P']], ['Three points', 'CIRCLE', ['3P']]] },
  { cmd: 'ARC', icon: 'rainbow', tip: 'Arc', key: 'A', menu: [['Three points', 'ARC'], ['Centre, start, end', 'ARC', ['Center']]] },
  { cmd: 'ELLIPSE', icon: 'egg', tip: 'Ellipse', key: 'EL', menu: [['Axis, end', 'ELLIPSE'], ['Centre', 'ELLIPSE', ['Center']]] },
  { cmd: 'TEXT', icon: 'type', tip: 'Text', key: 'T' },
  { cmd: 'HATCH', icon: 'brick-wall', tip: 'Hatch', key: 'H', menu: Object.entries(HATCH_PATTERNS).map(([k, v]) => [v.name, 'HATCH', [], (app) => { app.last.hatch.pattern = k }]) },
  { sep: true },
  { cmd: 'MOVE', icon: 'move', tip: 'Move', key: 'M' },
  { cmd: 'COPY', icon: 'copy', tip: 'Copy', key: 'CO', menu: [['Copy', 'COPY'], ['Array', 'ARRAY']] },
  { cmd: 'ROTATE', icon: 'rotate-cw', tip: 'Rotate', key: 'RO' },
  { cmd: 'SCALE', icon: 'scaling', tip: 'Scale', key: 'SC' },
  { cmd: 'MIRROR', icon: 'flip-horizontal-2', tip: 'Mirror', key: 'MI' },
  { cmd: 'OFFSET', icon: 'copy-plus', tip: 'Offset', key: 'O' },
  { cmd: 'TRIM', icon: 'scissors', tip: 'Trim (Shift extends)', key: 'TR' },
  { cmd: 'EXTEND', icon: 'arrow-right-to-line', tip: 'Extend (Shift trims)', key: 'EX' },
  { cmd: 'FILLET', icon: 'corner-up-left', tip: 'Fillet', key: 'F', menu: [['Fillet', 'FILLET'], ['Chamfer', 'CHAMFER']] },
  { cmd: 'ERASE', icon: 'eraser', tip: 'Erase (Delete)', key: 'E', menu: [['Erase', 'ERASE'], ['Explode polyline or dimension', 'EXPLODE']] },
  { sep: true },
  { cmd: 'DIM', icon: 'ruler-dimension-line', tip: 'Dimension', key: 'DIM', menu: [['Auto (pick object or points)', 'DIM'], ['Linear', 'DIMLINEAR'], ['Aligned', 'DIMALIGNED'], ['Radius', 'DIMRADIUS'], ['Diameter', 'DIMDIAMETER'], ['Angular', 'DIMANGULAR']] },
  { cmd: 'DIST', icon: 'ruler', tip: 'Measure distance', key: 'DI' },
  { cmd: 'AREA', icon: 'square-dashed', tip: 'Measure area', key: 'AREA' },
]

const TOGGLES = [
  ['snap', 'SNAP', 'Snap to grid (F9)'], ['grid', 'GRID', 'Show grid (F7)'], ['ortho', 'ORTHO', 'Ortho: straight lines only (F8)'],
  ['polar', 'POLAR', 'Polar tracking (F10)'], ['osnap', 'OSNAP', 'Object snap (F3)'], ['lwt', 'LWT', 'Show lineweights'],
]

const niceNum = (x) => {
  if (!(x > 0)) return 1
  const e = Math.pow(10, Math.floor(Math.log10(x)))
  return [1, 2, 2.5, 5, 10].map((m) => m * e).reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a))
}

export async function mount(root, { tool, params = {}, signal } = {}) {
  injectStyle()
  const KEY = `cad-studio:${tool?.id || 'cad-studio'}`
  const doc = new Doc(blankState('mm'))
  const prefs = store.load('cad:prefs', {})
  const modes = {
    ortho: !!prefs.ortho, polar: !!prefs.polar, grid: prefs.grid ?? true, snap: !!prefs.snap, osnap: prefs.osnap ?? true, lwt: prefs.lwt ?? true,
    polarInc: prefs.polarInc || 45, crosshair: !!prefs.crosshair, kinds: { end: true, mid: true, cen: true, int: true, quad: false, per: false, nea: false, ...(prefs.kinds || {}) },
  }
  const view = { cx: 0, cy: 0, scale: 3, w: 800, h: 600 }
  const sel = new Set()
  const listeners = new Map()
  const bus = { on(t, fn) { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(fn) }, emit(t) { for (const fn of listeners.get(t) || []) fn() } }
  const disposers = []
  const app = {
    root: null, doc, view, sel, modes, bus, prompt: null, cursor: pt(0, 0), raw: pt(0, 0), lastPoint: pt(0, 0), snap: null, track: null,
    cur: { layer: '0', color: null, ltype: null },
    last: { filletR: 0, cd1: 0, cd2: 0, offset: undefined, radius: undefined, hatch: { pattern: 'ansi31', scale: 1, angle: 0 } },
    pop: null, clip: null,
  }
  let ghostEnts = [], hoverId = null, hotGrip = null, measureInfo = null, windowSel = null, dark = false, canvasBg = '#ffffff', raf = 0, firstFit = true, spaceDown = false, spaceUsed = false
  let touchMode = false, oneShot = null, prevViews = [], textEd = null, dirty = false, panMode = false

  // ---------- DOM ----------
  const canvas = h('canvas', { tabindex: 0, role: 'application', 'aria-label': 'Drawing canvas. Use the tools, or type a command such as L, C or REC.' })
  const ctx2d = canvas.getContext('2d')
  const logEl = h('div', { class: 'cad-log', role: 'log', 'aria-live': 'polite' })
  const promptLabel = h('label', { for: 'cad-cmd-input' }, 'Command:')
  const cmdInput = h('input', { id: 'cad-cmd-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, 'aria-label': 'Command line', placeholder: 'Type a command, e.g. L, C, REC, M, DIM' })
  const coordEl = h('span', { class: 'cad-coord', 'aria-live': 'off' }, 'X 0.00  Y 0.00')
  const zoomEl = h('span', { class: 'small muted', style: 'padding:0 8px;white-space:nowrap' })
  const savedEl = h('span', { class: 'cad-saved' }, h('i'), h('span', 'Saved'))
  const nameInput = h('input', { class: 'cad-name', value: doc.name, 'aria-label': 'Drawing name', onchange: (e) => { doc.name = e.target.value.trim() || 'Untitled'; markDirty() } })
  const layerSel = h('select', { class: 'cad-sel cad-hide-sm', style: 'width:150px;height:30px', 'aria-label': 'Current layer', onchange: (e) => setCurrentLayer(e.target.value) })
  const hud = h('div', { class: 'cad-hud' })
  const welcome = h('div', { class: 'cad-welcome' })
  const stage = h('div', { class: 'cad-stage' }, canvas, hud, welcome)
  const undoBtn = tbtn('undo-2', 'Undo (Ctrl+Z)', () => undo())
  const redoBtn = tbtn('redo-2', 'Redo (Ctrl+Y)', () => redo())
  const panelToggle = tbtn('panel-right', 'Layers and properties', () => rootEl.classList.toggle('panel-open'), 'cad-panel-toggle')
  const railBtns = new Map()

  function tbtn(ic, tip, run, cls = '', label = '') {
    return h('button', { type: 'button', class: ['cad-btn', label && 'lbl', cls], 'aria-label': tip, 'data-tip': tip, onclick: run }, icon(ic), label && h('span', label))
  }

  const rail = h('div', { class: 'cad-rail', role: 'toolbar', 'aria-label': 'Drawing tools', 'aria-orientation': 'vertical' })
  for (const it of RAIL) {
    if (it.sep) { rail.append(h('div', { class: 'cad-hr' })); continue }
    const b = h('button', { type: 'button', class: 'cad-btn', 'aria-label': it.tip, 'aria-pressed': 'false', 'data-tip': it.key ? `${it.tip} (${it.key})` : it.tip, onclick: () => (it.cmd ? startCmd(it.cmd) : escape()) }, icon(it.icon))
    const wrap = h('div', { class: 'cad-ri' }, b)
    if (it.menu) {
      const corner = h('button', { type: 'button', class: 'cad-corner', 'aria-label': `${it.tip} options`, onclick: (e) => { e.stopPropagation(); openRailMenu(b, it) } })
      wrap.append(corner)
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); openRailMenu(b, it) })
    }
    railBtns.set(it.cmd || it.id, b)
    rail.append(wrap)
  }
  function openRailMenu(anchor, it) {
    const handle = popover(app, anchor, null, { side: touchMode ? 'bottom' : 'right', cls: 'menu' })
    if (!handle) return
    handle.el.append(...menuItems(app, it.menu.map(([label, cmd, inputs, pre]) => ({ label, run: () => startCmd(cmd, inputs || [], pre) })), handle.close))
  }

  const toggleBtns = {}
  const status = h('div', { class: 'cad-status' }, coordEl)
  for (const [k, label, tip] of TOGGLES) {
    const b = h('button', { type: 'button', class: 'cad-tog', 'aria-pressed': String(modes[k]), 'data-tip': tip, onclick: () => setMode(k) }, label)
    toggleBtns[k] = b
    status.append(b)
    if (k === 'osnap') status.append(h('button', { type: 'button', class: 'cad-tog', 'aria-label': 'Choose object snap types', 'data-tip': 'Choose which points to snap to', style: 'padding:0 5px', onclick: (e) => osnapMenu(e.currentTarget) }, icon('chevron-down')))
  }
  status.append(h('span', { class: 'cad-grow' }), zoomEl)
  function osnapMenu(anchor) {
    const handle = popover(app, anchor, null, { side: 'bottom' })
    if (!handle) return
    handle.el.style.minWidth = '170px'
    handle.el.append(h('div', { class: 'cad-sec', style: 'margin:0' }, h('h4', 'Snap to'), ...[['end', 'Endpoint'], ['mid', 'Midpoint'], ['cen', 'Centre'], ['quad', 'Quadrant'], ['int', 'Intersection'], ['per', 'Perpendicular'], ['nea', 'Nearest']].map(([k, l]) =>
      h('label', { style: 'display:flex;gap:8px;align-items:center;padding:4px 0' }, h('input', { type: 'checkbox', checked: !!modes.kinds[k], onchange: (e) => { modes.kinds[k] = e.target.checked; savePrefs() } }), l))))
    const r = anchor.getBoundingClientRect(), rr = rootEl.getBoundingClientRect()
    handle.el.style.top = Math.max(6, r.top - rr.top - handle.el.offsetHeight - 6) + 'px'
  }

  const enterBtn = h('button', { type: 'button', class: 'cad-btn', 'aria-label': 'Enter', 'data-tip': 'Enter (finish or repeat)', onclick: () => cmds.enter() }, icon('corner-down-left'))
  const escBtn = h('button', { type: 'button', class: 'cad-btn', 'aria-label': 'Cancel', 'data-tip': 'Cancel (Esc)', onclick: () => escape() }, icon('x'))
  const cmdBar = h('div', { class: 'cad-cmd' }, logEl, h('div', { class: 'cad-cmdline' }, promptLabel, cmdInput, enterBtn, escBtn))

  const panelTabs = [['layers', 'Layers'], ['props', 'Properties'], ['drawing', 'Drawing']]
  let panelTab = prefs.tab || 'layers'
  const layers = layersPanel(app), props = propsPanel(app), drawing = drawingPanel(app)
  const panelBody = h('div', { class: 'cad-body' })
  const tabBtns = panelTabs.map(([id, label]) => h('button', { type: 'button', class: 'cad-tab', role: 'tab', 'aria-selected': String(id === panelTab), onclick: () => openPanel(id) }, label))
  const panel = h('aside', { class: 'cad-panel', 'aria-label': 'Layers, properties and drawing settings' }, h('div', { class: 'cad-tabs', role: 'tablist' }, tabBtns, tbtn('x', 'Close panel', () => rootEl.classList.remove('panel-open'), 'cad-panel-close')), panelBody)

  const top = h('div', { class: 'cad-top', role: 'toolbar', 'aria-label': 'File and view' },
    nameInput, savedEl, h('span', { class: 'cad-sep' }),
    tbtn('file-plus', 'New drawing', () => fileAction('new')), tbtn('folder-open', 'Open DXF or project', () => fileAction('open')), tbtn('save', 'Save project file (Ctrl+S)', () => fileAction('save')),
    tbtn('download', 'Export DXF, PDF, SVG or PNG', () => fileAction('export'), '', 'Export'),
    h('span', { class: 'cad-sep' }), undoBtn, redoBtn, h('span', { class: 'cad-sep' }),
    tbtn('scan-search', 'Zoom to fit the drawing (ZE)', () => zoomExtents()),
    h('span', { class: 'cad-grow' }), layerSel, panelToggle, tbtn('circle-help', 'Shortcuts and commands', () => helpDialog()))

  const panBtn = tbtn('hand', 'Pan (or hold Space and drag)', () => { panMode = !panMode; panBtn.setAttribute('aria-pressed', String(panMode)) })
  panBtn.setAttribute('aria-pressed', 'false')
  const zoomCtl = h('div', { class: 'cad-zoomctl' },
    tbtn('plus', 'Zoom in', () => zoomBy(1.6)), tbtn('minus', 'Zoom out', () => zoomBy(1 / 1.6)), tbtn('maximize', 'Zoom to fit', () => zoomExtents()), panBtn)
  stage.append(zoomCtl)
  const rootEl = h('div', { class: 't-cad' }, top, h('div', { class: 'cad-main' }, rail, stage, panel), cmdBar, status)
  app.root = rootEl
  rootEl.__cad = app // handle for tests and debugging
  root.append(rootEl)

  // ---------- Commands ----------
  const cmds = createCommands(app)
  app.cmds = cmds
  Object.assign(app, {
    log(msg, kind = 'info') {
      logEl.append(h('div', { class: kind }, msg))
      while (logEl.childElementCount > 250) logEl.firstChild.remove()
      logEl.scrollTop = logEl.scrollHeight
    },
    toast: (m, t) => toast(m, t),
    ghost(list) { ghostEnts = list || []; render() },
    promptChanged,
    commandChanged(name) {
      for (const [k, b] of railBtns) b.setAttribute('aria-pressed', String(name ? k === name || (k === 'DIM' && name.startsWith('DIM')) : k === 'select'))
      if (name) { measureInfo = null; renderHud() }
      render()
    },
    render: () => render(),
    selected, selectable, setSelection, clearSelection: () => setSelection([]),
    selectAll: () => setSelection(doc.visible().filter(selectable).map((e) => e.id)),
    editText, zoomExtents, zoomBy, zoomWindow, zoomPrevious,
    setMode, openPanel, fileAction, setCurrentLayer, savePrefs,
    onDispose: (fn) => disposers.push(fn),
    measured(info) { measureInfo = info; renderHud(); render() },
  })

  function startCmd(name, inputs = [], pre) {
    pre?.(app)
    cmds.run(name, { preselect: sel.size > 0 })
    if (inputs.length) setTimeout(() => { for (const t of inputs) if (app.prompt) cmds.text(t) }, 0)
    canvas.focus({ preventScroll: true })
  }
  function escape() {
    if (textEd) return textEd.cancel()
    if (app.prompt) return cmds.cancel()
    app.pop?.close()
    if (measureInfo) { measureInfo = null; renderHud() }
    setSelection([])
  }
  function undo() {
    if (cmds.wantsUndo()) return
    if (app.prompt) cmds.cancel()
    const l = doc.undo()
    l ? app.log(`Undo: ${l}`, 'muted') : toast('Nothing to undo', 'info')
  }
  function redo() { const l = doc.redo(); l ? app.log(`Redo: ${l}`, 'muted') : toast('Nothing to redo', 'info') }

  // ---------- Selection and picking ----------
  function selectable(e) { const l = doc.layer(e.layer); return l.visible && !l.locked }
  function selected() { return [...sel].map((id) => doc.byId(id)).filter(Boolean) }
  function setSelection(ids) {
    sel.clear()
    for (const id of ids) sel.add(id)
    bus.emit('sel')
    render()
  }
  function pickAt(raw, px = touchMode ? 16 : 9) {
    const tol = px / view.scale
    let best = null
    const probe = { x0: raw.x, y0: raw.y, x1: raw.x, y1: raw.y }
    for (const e of doc.visible()) {
      if (!selectable(e) || !boxHit(boxPad(bbox(e), tol), probe)) continue
      const d = hitDist(e, raw, tol)
      if (d <= tol && (!best || d <= best.d)) best = { e, d }
    }
    return best?.e || null
  }
  function selectClick(info) {
    const hit = info.hit
    if (hit) {
      if (info.shift) { sel.has(hit.id) ? sel.delete(hit.id) : sel.add(hit.id); bus.emit('sel'); render() } else setSelection([hit.id])
    } else if (!info.shift) setSelection([])
  }
  function selectRect(a, b, shift) {
    const crossing = b.x < a.x
    const p0 = toWorld(view, Math.min(a.x, b.x), Math.max(a.y, b.y)), p1 = toWorld(view, Math.max(a.x, b.x), Math.min(a.y, b.y))
    const rect = { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y }
    const ids = doc.visible().filter((e) => selectable(e) && inRect(e, rect, crossing)).map((e) => e.id)
    if (shift) { for (const id of ids) sel.has(id) ? sel.delete(id) : sel.add(id); bus.emit('sel'); render() } else setSelection(ids)
    if (ids.length) app.log(`${ids.length} found (${crossing ? 'crossing' : 'window'}).`, 'muted')
  }

  // ---------- View ----------
  const unitMm = () => UNITS[doc.settings.units]?.mm || 1
  function setView(v) { prevViews.push({ cx: view.cx, cy: view.cy, scale: view.scale }); if (prevViews.length > 20) prevViews.shift(); Object.assign(view, v); onView() }
  function onView() { bus.emit('view'); updateCursor(lastScreen.x, lastScreen.y); render(); updateZoomText() }
  function zoomExtents() {
    const b = doc.extents()
    if (!b) return defaultView()
    const bw = Math.max(b.x1 - b.x0, 1e-9), bh = Math.max(b.y1 - b.y0, 1e-9)
    const s = Math.min((view.w * 0.88) / bw, (view.h * 0.88) / bh)
    setView({ cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, scale: clamp(s, 1e-6, 1e7) })
  }
  function defaultView() {
    const s = view.w / (260 / unitMm())
    setView({ scale: s, cx: (view.w * 0.42) / s, cy: (view.h * 0.4) / s })
  }
  function zoomBy(f, sx = view.w / 2, sy = view.h / 2) {
    const before = toWorld(view, sx, sy)
    view.scale = clamp(view.scale * f, 1e-6, 1e7)
    const after = toWorld(view, sx, sy)
    view.cx += before.x - after.x
    view.cy += before.y - after.y
    onView()
  }
  function zoomWindow(a, b) {
    const w = Math.max(Math.abs(a.x - b.x), 1e-9), hh = Math.max(Math.abs(a.y - b.y), 1e-9)
    setView({ cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, scale: clamp(Math.min(view.w / w, view.h / hh) * 0.95, 1e-6, 1e7) })
  }
  function zoomPrevious() { const v = prevViews.pop(); if (v) { Object.assign(view, v); onView() } else toast('No previous view', 'info') }
  function updateZoomText() { zoomEl.textContent = `${fmtNum(view.w / view.scale, 1)} ${UNITS[doc.settings.units].short} wide` }

  // ---------- Cursor, snapping and previews ----------
  const lastScreen = { x: 0, y: 0 }
  function updateCursor(sx, sy, touch = false) {
    lastScreen.x = sx; lastScreen.y = sy
    const raw = toWorld(view, sx, sy)
    app.raw = raw
    const p = app.prompt
    const wantsPoint = p && (p.type === 'point' || p.type === 'dist' || p.type === 'angle')
    let w = raw, snap = null, track = null
    if (wantsPoint) {
      const base = p.base || null
      const g = doc.settings.gridStep
      const src = modes.snap && g > 0 ? snapToGrid(raw, g) : raw
      const con = constrain(src, base, { ortho: modes.ortho, polar: modes.polar, polarInc: modes.polarInc, scale: view.scale })
      w = con.pt; track = con.track ? { base, label: con.track } : null
      if (modes.osnap || oneShot) {
        const s = findSnap(doc, raw, view.scale, oneShot ? { [oneShot]: true } : modes.kinds, base, touch ? 26 : 14)
        if (s) { w = s.pt; snap = s }
      }
    }
    app.cursor = w; app.snap = snap; app.track = track
    if (!p || p.type === 'select' || p.type === 'pick') hoverId = pickAt(raw, touch ? 18 : 9)?.id ?? null
    else hoverId = null
    hotGrip = null
    if (!p && sel.size && sel.size <= 60) {
      let bestD = 9 / 1
      for (const e of selected()) for (const gr of gripsOf(e)) { const s = toScreen(view, gr); const d = Math.hypot(s.x - sx, s.y - sy); if (d < bestD) { bestD = d; hotGrip = { ...gr, ent: e } } }
    }
    updateGhost()
    updateCoords()
  }
  function updateGhost() {
    const p = app.prompt
    if (!p?.preview) { if (ghostEnts.length && !p) ghostEnts = []; return }
    try {
      let arg = app.cursor
      if (p.type === 'dist') arg = p.base ? dist(p.base, app.cursor) : 0
      else if (p.type === 'angle') arg = p.base ? angle(p.base, app.cursor) : 0
      ghostEnts = p.preview(arg) || []
    } catch { ghostEnts = [] }
  }
  function updateCoords() {
    const p = app.prompt
    const c = app.cursor
    let s = `X ${fmtNum(c.x, doc.settings.prec)}  Y ${fmtNum(c.y, doc.settings.prec)}`
    if (p?.base && (p.type === 'point' || p.type === 'dist' || p.type === 'angle')) s += `   Δ ${fmtNum(dist(p.base, c), doc.settings.prec)} < ${fmtNum(norm(angle(p.base, c)) * R2D, 1)}°`
    coordEl.textContent = s
  }
  function promptChanged() {
    const p = app.prompt
    renderHud()
    promptLabel.textContent = p ? p.line : cmds.isActive() ? `${cmds.activeName()}:` : 'Command:'
    cmdInput.placeholder = p ? '' : 'Type a command, e.g. L, C, REC, M, DIM'
    canvas.classList.toggle('prompting', !!p)
    updateCursor(lastScreen.x, lastScreen.y)
    render()
  }

  // ---------- Painting ----------
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2)
  function render() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint() }) }
  function themeColors() {
    dark = document.documentElement.dataset.theme === 'dark'
    canvasBg = getComputedStyle(rootEl).getPropertyValue('--cad-bg').trim() || (dark ? '#0b0c11' : '#ffffff')
  }
  function paint() {
    if (!rootEl.isConnected) return
    const r = dpr()
    drawScene(ctx2d, doc, view, r, {
      dark, bg: canvasBg, selection: sel, hover: hoverId, ghosts: ghostEnts, axes: true, grid: modes.grid ? { step: doc.settings.gridStep } : null,
      lwPx: (lw) => (modes.lwt ? 0.6 + lw * 2.6 : 1),
    })
    const c = ctx2d
    c.setTransform(r, 0, 0, r, 0, 0)
    if (measureInfo) drawMeasure(c)
    if (!app.prompt && sel.size && sel.size <= 60) {
      const gs = []
      for (const e of selected()) for (const g of gripsOf(e)) gs.push(g)
      drawGrips(c, view, gs, hotGrip && gs.find((g) => g.x === hotGrip.x && g.y === hotGrip.y))
    }
    if (windowSel) drawWindow(c, windowSel.a, windowSel.b)
    drawUcs(c, view, dark)
    const p = app.prompt
    const wantsPoint = p && (p.type === 'point' || p.type === 'dist' || p.type === 'angle')
    if (wantsPoint && app.track?.base) drawTrack(c, view, app.track.base, app.cursor, app.track.label)
    else if (wantsPoint && p.base && !touchMode) drawTrack(c, view, p.base, app.cursor, `${fmtNum(dist(p.base, app.cursor), doc.settings.prec)} < ${fmtNum(norm(angle(p.base, app.cursor)) * R2D, 1)}°`)
    if (wantsPoint && app.snap) drawSnapMarker(c, view, app.snap)
    if (!touchMode || wantsPoint) drawCursor(c, view, wantsPoint ? app.cursor : app.raw, dark, !wantsPoint, wantsPoint && modes.crosshair)
  }
  function drawMeasure(c) {
    c.save()
    c.strokeStyle = '#ffb020'; c.fillStyle = 'rgba(255,176,32,.14)'; c.lineWidth = 2; c.setLineDash([6, 4])
    if (measureInfo.line) { const a = toScreen(view, measureInfo.line[0]), b = toScreen(view, measureInfo.line[1]); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.setLineDash([]); for (const q of [a, b]) { c.beginPath(); c.arc(q.x, q.y, 4, 0, 7); c.fillStyle = '#ffb020'; c.fill() } }
    if (measureInfo.poly) { c.beginPath(); measureInfo.poly.forEach((p, i) => { const s = toScreen(view, p); i ? c.lineTo(s.x, s.y) : c.moveTo(s.x, s.y) }); c.closePath(); c.fill(); c.stroke() }
    if (measureInfo.mark) { const s = toScreen(view, measureInfo.mark); c.beginPath(); c.arc(s.x, s.y, 6, 0, 7); c.stroke() }
    c.restore()
  }
  function renderHud() {
    clear(hud)
    const p = app.prompt
    if (p) {
      const kws = (p.kws || []).filter((k) => k !== 'All' || p.type === 'select')
      hud.append(h('div', { class: 'cad-chip cad-prompt' }, h('b', cmds.activeName() || ''), h('span', p.msg),
        ...kws.map((k) => h('button', { type: 'button', class: 'cad-kw', onclick: () => cmds.text(k) }, k)),
        (p.enter || p.type === 'select') && h('button', { type: 'button', class: 'cad-kw done', onclick: () => cmds.enter() }, p.type === 'select' ? 'Done selecting' : 'Done')))
    }
    if (measureInfo) hud.append(h('div', { class: 'cad-chip cad-measure' }, h('small', { style: 'margin:0' }, measureInfo.title), h('b', measureInfo.main), ...measureInfo.lines.map((l) => h('div', l)),
      h('button', { type: 'button', class: 'cad-btn', 'aria-label': 'Close measurement', onclick: () => { measureInfo = null; renderHud(); render() } }, icon('x'))))
  }

  // ---------- Pointer input ----------
  const ptrs = new Map()
  let drag = null, pinch = null
  const posOf = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  const wantsWindow = () => !app.prompt || app.prompt.type === 'select'
  canvas.addEventListener('pointerdown', (e) => {
    if (textEd) textEd.commit()
    app.pop?.close()
    canvas.setPointerCapture(e.pointerId)
    const sp = posOf(e)
    ptrs.set(e.pointerId, { ...sp, type: e.pointerType })
    touchMode = e.pointerType === 'touch'
    canvas.classList.toggle('touch', touchMode)
    canvas.focus({ preventScroll: true })
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; drag = null; windowSel = null; return }
    if (e.button === 1 || (e.button === 0 && (spaceDown || panMode))) { drag = { kind: 'pan', last: sp, start: sp, moved: false, viaMode: e.button === 0 && panMode && !spaceDown, shift: e.shiftKey }; spaceUsed = true; canvas.classList.add('pan'); e.preventDefault(); return }
    if (e.button === 2) { drag = { kind: 'right' }; return }
    if (e.button !== 0) return
    updateCursor(sp.x, sp.y, touchMode)
    if (!app.prompt && hotGrip) { startGrip(hotGrip); drag = { kind: 'grip', start: sp }; return }
    drag = { kind: 'click', start: sp, moved: false, shift: e.shiftKey }
  })
  canvas.addEventListener('pointermove', (e) => {
    const sp = posOf(e)
    const rec = ptrs.get(e.pointerId)
    if (rec) { rec.x = sp.x; rec.y = sp.y }
    if (pinch && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y), c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      view.cx -= (c.x - pinch.c.x) / view.scale; view.cy += (c.y - pinch.c.y) / view.scale
      zoomBy(d / pinch.d, c.x, c.y)
      pinch = { d, c }
      return
    }
    if (drag?.kind === 'pan') { if (Math.hypot(sp.x - drag.start.x, sp.y - drag.start.y) > 4) drag.moved = true; view.cx -= (sp.x - drag.last.x) / view.scale; view.cy += (sp.y - drag.last.y) / view.scale; drag.last = sp; onView(); return }
    if (drag?.kind === 'click' && !drag.moved && Math.hypot(sp.x - drag.start.x, sp.y - drag.start.y) > (touchMode ? 8 : 5)) {
      drag.moved = true
      if (touchMode) { drag = { kind: 'pan', last: drag.start, start: drag.start, moved: true }; canvas.classList.add('pan') } else if (wantsWindow()) windowSel = { a: drag.start, b: sp }
    }
    if (drag?.kind === 'pan') { view.cx -= (sp.x - drag.last.x) / view.scale; view.cy += (sp.y - drag.last.y) / view.scale; drag.last = sp; onView(); return }
    if (windowSel) windowSel.b = sp
    updateCursor(sp.x, sp.y, touchMode)
    render()
  })
  const endPointer = (e) => {
    const sp = posOf(e)
    ptrs.delete(e.pointerId)
    if (ptrs.size < 2) pinch = null
    canvas.classList.remove('pan')
    const d = drag
    drag = null
    if (!d || e.type === 'pointercancel') { windowSel = null; render(); return }
    if (d.kind === 'right') { if (app.prompt) cmds.enter(); return }
    if (d.kind === 'pan') { if (d.viaMode && !d.moved) clickAt(sp, e); return }
    if (d.kind === 'grip') { if (Math.hypot(sp.x - d.start.x, sp.y - d.start.y) > 4) clickAt(sp, e); return }
    if (d.kind !== 'click') return
    if (windowSel) { const w = windowSel; windowSel = null; selectRect(w.a, w.b, e.shiftKey); return }
    clickAt(sp, e)
  }
  canvas.addEventListener('pointerup', endPointer)
  canvas.addEventListener('pointercancel', endPointer)
  canvas.addEventListener('pointerleave', () => { if (!drag) { hoverId = null; render() } })
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault()
    const k = e.deltaMode === 1 ? 16 : 1
    const sp = posOf(e)
    zoomBy(Math.exp(-e.deltaY * k * (e.ctrlKey ? 0.01 : 0.0016)), sp.x, sp.y)
  }, { passive: false })
  canvas.addEventListener('dblclick', (e) => {
    if (app.prompt) return
    const hit = pickAt(toWorld(view, posOf(e).x, posOf(e).y))
    if (!hit) return
    if (hit.type === 'text') editExisting(hit)
    else { setSelection([hit.id]); openPanel('props') }
  })

  function clickAt(sp, e) {
    updateCursor(sp.x, sp.y, touchMode)
    const info = { pt: app.cursor, raw: app.raw, hit: pickAt(app.raw, touchMode ? 18 : 9), snapKind: app.snap?.kind, shift: e.shiftKey }
    oneShot = null
    if (app.prompt && app.prompt.type !== 'select') { cmds.click(info); return }
    if (!app.prompt && cmds.isActive()) return
    selectClick(info)
  }

  // ---------- Grip editing ----------
  function startGrip(g) {
    const ent = g.ent
    cmds.runFn('STRETCH', async (c) => {
      const base = pt(g.x, g.y)
      const r = await c.point('Specify new position', { base, preview: (q) => [g.apply(q)] })
      if (!r) return
      const next = g.apply(r)
      c.commit('Edit with grip', (tx) => tx.replace(ent.id, next))
    })
  }

  // ---------- Text editing ----------
  function editText(o, initial) {
    return new Promise((resolve) => {
      const sp = toScreen(view, o)
      const fs = Math.max(14, o.h * view.scale)
      const ta = h('textarea', { class: 'cad-textbox', rows: 1, value: initial || '', placeholder: 'Type text', 'aria-label': 'Text', style: { left: sp.x + 'px', top: Math.max(4, sp.y - fs) + 'px', fontSize: fs + 'px', transform: o.rot ? `rotate(${-o.rot}rad)` : '', transformOrigin: 'left bottom' } })
      let done = false
      const finish = (v) => { if (done) return; done = true; textEd = null; ta.remove(); canvas.focus({ preventScroll: true }); resolve(v) }
      textEd = { cancel: () => finish(null), commit: () => finish(ta.value) }
      ta.addEventListener('keydown', (e) => {
        e.stopPropagation()
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(ta.value) }
        else if (e.key === 'Escape') { e.preventDefault(); finish(null) }
      })
      ta.addEventListener('blur', () => setTimeout(() => finish(ta.value), 0))
      stage.append(ta)
      requestAnimationFrame(() => { ta.focus(); ta.select() })
    })
  }
  async function editExisting(ent) {
    const str = await editText({ x: ent.x, y: ent.y, h: ent.h, rot: ent.rot || 0 }, ent.text)
    if (str != null && str.trim() && str !== ent.text) doc.commit('Edit text', (tx) => tx.replace(ent.id, { ...ent, text: str }))
  }

  // ---------- Modes, layers, panels ----------
  function savePrefs() { store.save('cad:prefs', { ortho: modes.ortho, polar: modes.polar, grid: modes.grid, snap: modes.snap, osnap: modes.osnap, lwt: modes.lwt, polarInc: modes.polarInc, kinds: modes.kinds, tab: panelTab, crosshair: modes.crosshair }) }
  function setMode(name, arg) {
    if (!(name in modes)) return
    const next = arg === 'on' || arg === 'ON' ? true : arg === 'off' || arg === 'OFF' ? false : !modes[name]
    modes[name] = next
    if (next && name === 'ortho') modes.polar = false
    if (next && name === 'polar') modes.ortho = false
    for (const k of Object.keys(toggleBtns)) toggleBtns[k].setAttribute('aria-pressed', String(modes[k]))
    savePrefs()
    app.log(`<${name.charAt(0).toUpperCase() + name.slice(1)} ${next ? 'on' : 'off'}>`, 'muted')
    updateCursor(lastScreen.x, lastScreen.y)
    render()
  }
  function setCurrentLayer(name) {
    app.cur.layer = doc.layers.some((l) => l.name === name) ? name : '0'
    refreshLayerSel()
    bus.emit('cur')
  }
  function refreshLayerSel() {
    clear(layerSel, doc.layers.map((l) => h('option', { value: l.name, selected: l.name === app.cur.layer }, l.name)))
    layerSel.value = app.cur.layer
  }
  function openPanel(id) {
    panelTab = id
    tabBtns.forEach((b, i) => b.setAttribute('aria-selected', String(panelTabs[i][0] === id)))
    rootEl.classList.add('panel-open')
    renderPanel()
    savePrefs()
  }
  function renderPanel() {
    const p = { layers, props, drawing }[panelTab]
    p.render()
    if (panelBody.firstChild !== p.el) clear(panelBody, p.el)
  }

  // ---------- Document events and autosave ----------
  const saveNow = async () => {
    const ok = await idb.set(KEY, { version: 1, json: doc.toJSON(), view: { cx: view.cx, cy: view.cy, scale: view.scale }, cur: app.cur, last: { filletR: app.last.filletR, cd1: app.last.cd1, cd2: app.last.cd2, offset: app.last.offset } })
    dirty = false
    savedEl.classList.toggle('dirty', !ok)
    savedEl.lastChild.textContent = ok ? 'Saved on this device' : 'Not saved (storage blocked)'
  }
  const saveSoon = debounce(saveNow, 700)
  function markDirty() { dirty = true; savedEl.classList.add('dirty'); savedEl.lastChild.textContent = 'Saving...'; saveSoon() }
  doc.on((kind) => {
    for (const id of [...sel]) if (!doc.byId(id)) sel.delete(id)
    if (!doc.layers.some((l) => l.name === app.cur.layer)) app.cur.layer = '0'
    nameInput.value = doc.name
    refreshLayerSel()
    undoBtn.disabled = !doc.canUndo(); redoBtn.disabled = !doc.canRedo()
    bus.emit('doc'); bus.emit('sel')
    renderPanel()
    welcome.hidden = doc.ents.length > 0 || welcomeDismissed
    updateZoomText()
    updateCursor(lastScreen.x, lastScreen.y)
    markDirty()
    render()
  })
  bus.on('cur', () => { renderPanel(); render() })
  bus.on('sel', () => { if (panelTab === 'props') renderPanel() })

  // ---------- Files ----------
  const confirmDialog = ({ title, body, actions }) => {
    let m
    const acts = actions.map((a) => button(a.label, { variant: a.variant || 'secondary', onClick: () => { m.close(); a.run?.() } }))
    m = modal({ title, body: h('p', { style: 'margin:0;line-height:1.55' }, body), actions: acts })
  }
  function applyState(state, name) {
    doc.load(state, name)
    sel.clear()
    app.cur.layer = '0'
    app.last.hatch.scale = doc.settings.hatchScale
    app.last.filletR = niceNum(doc.settings.gridStep / 2)
    app.last.cd1 = app.last.cd2 = app.last.filletR
    welcomeDismissed = false
    welcome.hidden = doc.ents.length > 0
    zoomExtents()
  }
  function newDrawing() {
    const go = () => { applyState(blankState('mm'), 'Untitled'); defaultView(); app.log('New drawing.', 'muted') }
    if (!doc.ents.length) return go()
    confirmDialog({ title: 'Start a new drawing?', body: 'The current drawing will be replaced. Save it as a project file first if you want to keep it.', actions: [{ label: 'Cancel' }, { label: 'Save project first', run: () => { saveProject(); } }, { label: 'Replace', variant: 'danger', run: go }] })
  }
  const saveProject = () => { download(new Blob([JSON.stringify(doc.toJSON())], { type: 'application/json' }), `${safeName(doc.name)}.cad.json`); toast('Project file saved', 'success') }
  async function openFile(file, mode) {
    const ext = (file.name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase()
    try {
      if (ext === 'json') {
        const data = JSON.parse(await file.text())
        const st = stateFromJSON(data)
        const j = () => { applyState(st, data.name || baseName(file.name).replace(/\.cad$/, '')); toast(`Opened ${file.name}`, 'success') }
        return doc.ents.length && mode !== 'replace' ? confirmDialog({ title: 'Replace the current drawing?', body: `Opening ${file.name} replaces what is on the canvas.`, actions: [{ label: 'Cancel' }, { label: 'Replace', variant: 'primary', run: j }] }) : j()
      }
      if (ext !== 'dxf') return toast('Open a .dxf file, or a .cad.json project saved from CAD Studio.', 'error')
      const chip = h('div', { class: 'cad-chip' }, `Reading ${file.name}...`)
      hud.append(chip)
      let res
      try { res = await importDxf(await file.arrayBuffer()) } finally { chip.remove() }
      if (!res.count) throw Object.assign(new Error('No drawable objects were found in that DXF.'), { userMessage: 'No drawable objects were found in that DXF. It may only contain 3D solids, images or unsupported entities.' })
      const go = (m) => applyImport(res, m, file.name)
      if (!doc.ents.length || mode) return go(mode || 'replace')
      confirmDialog({ title: 'Open DXF', body: `${file.name} has ${res.count} objects. Replace the drawing on the canvas, or add them to it?`, actions: [{ label: 'Cancel' }, { label: 'Add to drawing', run: () => go('add') }, { label: 'Replace', variant: 'primary', run: () => go('replace') }] })
    } catch (err) {
      console.error(err)
      toast(err.userMessage || err.message || 'Could not open that file.', 'error')
    }
  }
  function applyImport(res, mode, fileName) {
    const name = baseName(fileName)
    if (mode === 'add') {
      doc.commit('Import DXF', (tx) => {
        const have = new Set(doc.layers.map((l) => l.name))
        const extra = res.layers.filter((l) => !have.has(l.name))
        if (extra.length) tx.setLayers([...doc.layers, ...extra])
        for (const e of res.ents) tx.add(e)
      })
      zoomExtents()
    } else {
      const st = blankState(res.units)
      let id = 1
      st.ents = res.ents.map((e) => ({ ...e, id: id++ }))
      st.nextId = id
      st.layers = res.layers
      const ext = st.ents.reduce((b, e) => unionBox(b, bbox(e)), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity })
      const size = Math.max(ext.x1 - ext.x0, ext.y1 - ext.y0)
      if (Number.isFinite(size) && size > 0) {
        const th = niceNum(size / 140)
        Object.assign(st.settings, { textH: th, dimTh: th, dimAs: th, gridStep: niceNum(size / 40), hatchScale: niceNum(size / 300), ltscale: res.ltscale ?? niceNum(size / 300) })
      }
      applyState(st, name)
    }
    const skipped = Object.entries(res.skipped)
    app.log(`Imported ${res.count} object${res.count === 1 ? '' : 's'} from ${fileName}.`, 'result')
    if (skipped.length) app.log(`Not imported (unsupported): ${skipped.map(([k, n]) => `${k} x${n}`).join(', ')}.`, 'warn')
    toast(`Imported ${res.count} objects${skipped.length ? ` (${skipped.reduce((s, [, n]) => s + n, 0)} unsupported skipped)` : ''}`, skipped.length ? 'info' : 'success')
    if (params.export) exportDialog(app, params.export)
  }
  async function fileAction(name) {
    if (name === 'new') return newDrawing()
    if (name === 'save') return saveProject()
    if (name === 'export') return exportDialog(app)
    if (name === 'open' || name === 'import') {
      const [f] = await pickFiles({ accept: '.dxf,.json,application/json' })
      if (f) openFile(f, name === 'import' ? 'add' : undefined)
    }
  }

  // ---------- Clipboard, delete, nudge ----------
  function copySel() { const s = selected(); if (!s.length) return false; app.clip = s.map((e) => ({ ...e })); app.log(`${s.length} copied.`, 'muted'); return true }
  function eraseSel() { const s = selected(); if (s.length) { doc.commit('Erase', (tx) => tx.remove(s.map((e) => e.id))); app.log(`${s.length} erased.`, 'muted') } }
  function pasteClip() {
    if (!app.clip?.length) return toast('Nothing to paste. Copy something first (Ctrl+C).', 'info')
    const items = app.clip
    const b = items.reduce((a, e) => unionBox(a, bbox(e)), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity })
    const base = pt(b.x0, b.y0)
    cmds.runFn('PASTE', async (c) => {
      const r = await c.point('Specify insertion point', { base, enter: false, preview: (q) => c.ghosts(items, Tf.move(q.x - base.x, q.y - base.y)) })
      if (!r) return
      const tf = Tf.move(r.x - base.x, r.y - base.y)
      const added = c.add('Paste', items.map((e) => transform(e, tf)))
      if (added) setSelection(added.map((e) => e.id))
    })
  }
  function duplicate() {
    const s = selected(); if (!s.length) return
    const g = doc.settings.gridStep
    const added = doc.commit('Duplicate', (tx) => s.forEach((e) => tx.add(transform(e, Tf.move(g, -g)))))
    if (added) setSelection(added.map((e) => e.id))
  }
  function nudge(dx, dy) {
    const s = selected(); if (!s.length) return
    doc.commit('Nudge', (tx) => s.forEach((e) => tx.replace(e.id, transform(e, Tf.move(dx, dy)))))
  }

  // ---------- Keyboard ----------
  const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
  function onKey(e) {
    if (!rootEl.isConnected || document.querySelector('dialog[open]')) return
    const t = e.target
    const inCmd = t === cmdInput
    if (!inCmd && isTyping(t)) { if (e.key === 'Escape') t.blur?.(); return }
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    if (e.key === 'Escape') { e.preventDefault(); if (inCmd) cmdInput.value = ''; escape(); return }
    if (mod) {
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return }
      if (inCmd && ['c', 'x', 'v', 'a'].includes(k) && (cmdInput.value !== '' || (k === 'v' && !app.clip))) return
      if (k === 'a') { e.preventDefault(); app.selectAll(); return }
      if (k === 'c') { e.preventDefault(); copySel(); return }
      if (k === 'x') { e.preventDefault(); if (copySel()) eraseSel(); return }
      if (k === 'v') { e.preventDefault(); pasteClip(); return }
      if (k === 'd') { e.preventDefault(); duplicate(); return }
      if (k === 's') { e.preventDefault(); saveProject(); return }
      if (k === 'o') { e.preventDefault(); fileAction('open'); return }
      return
    }
    if (e.key === 'F3') { e.preventDefault(); return setMode('osnap') }
    if (e.key === 'F7') { e.preventDefault(); return setMode('grid') }
    if (e.key === 'F8') { e.preventDefault(); return setMode('ortho') }
    if (e.key === 'F9') { e.preventDefault(); return setMode('snap') }
    if (e.key === 'F10') { e.preventDefault(); return setMode('polar') }
    if (inCmd) return
    const free = document.activeElement === canvas || document.activeElement === document.body || !document.activeElement
    if (!free) return
    if (e.key === ' ' && !e.repeat) { spaceDown = true; spaceUsed = false; if (document.activeElement === canvas || document.activeElement === document.body) e.preventDefault(); return }
    if (e.key === 'Enter') { e.preventDefault(); cmds.enter(); return }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !app.prompt && sel.size) { e.preventDefault(); eraseSel(); return }
    if (e.key.startsWith('Arrow') && !app.prompt && sel.size) {
      e.preventDefault()
      const st = doc.settings.gridStep / (e.shiftKey ? 1 : 10)
      nudge(e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, e.key === 'ArrowDown' ? -st : e.key === 'ArrowUp' ? st : 0)
      return
    }
    if (e.key.length === 1 && !e.altKey) { cmdInput.focus({ preventScroll: true }) }
  }
  function onKeyUp(e) {
    if (e.key === ' ' && spaceDown) { spaceDown = false; const ae = document.activeElement; if (!spaceUsed && rootEl.isConnected && (ae === canvas || ae === document.body || !ae)) cmds.enter() }
  }
  document.addEventListener('keydown', onKey)
  const onBlur = () => { spaceDown = false }
  window.addEventListener('blur', onBlur)
  document.addEventListener('keyup', onKeyUp)
  const cmdHist = []
  let histIdx = -1
  cmdInput.addEventListener('keydown', (e) => {
    if (oneShot && !cmdInput.value.trim() && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); return }
    if (e.key === 'Enter' || (e.key === ' ' && app.prompt?.type !== 'text' && /^[a-z]*$/i.test(cmdInput.value.trim()))) {
      if (e.key === ' ' && !cmdInput.value.trim()) { e.preventDefault(); cmds.enter(); return }
      e.preventDefault()
      const v = cmdInput.value
      cmdInput.value = ''
      if (v.trim()) { cmdHist.unshift(v.trim()); histIdx = -1 }
      oneShot = null
      cmds.text(v)
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      histIdx = clamp(histIdx + (e.key === 'ArrowUp' ? 1 : -1), -1, cmdHist.length - 1)
      cmdInput.value = histIdx >= 0 ? cmdHist[histIdx] : ''
    } else if (e.key === 'Tab') {
      const v = cmdInput.value.trim().toUpperCase()
      if (v) { e.preventDefault(); const m = ['LINE', 'PLINE', 'CIRCLE', 'ARC', 'RECTANG', 'ELLIPSE', 'TEXT', 'HATCH', 'MOVE', 'COPY', 'ROTATE', 'SCALE', 'MIRROR', 'OFFSET', 'TRIM', 'EXTEND', 'FILLET', 'CHAMFER', 'ERASE', 'EXPLODE', 'ARRAY', 'DIM', 'DIST', 'AREA', 'ZOOM', 'LAYER'].find((c) => c.startsWith(v)); if (m) cmdInput.value = m }
    }
  })
  cmdInput.addEventListener('input', () => {
    const v = cmdInput.value.trim().toLowerCase()
    if (app.prompt?.type === 'point' && ['end', 'mid', 'cen', 'int', 'per', 'nea', 'qua', 'quad'].includes(v)) {
      oneShot = v === 'qua' ? 'quad' : v; cmdInput.value = ''; app.log(`Snap override: ${oneShot}`, 'muted'); updateCursor(lastScreen.x, lastScreen.y); render()
    }
  })
  logEl.addEventListener('click', () => logEl.classList.toggle('big'))

  // ---------- Welcome ----------
  let welcomeDismissed = false
  const dz = dropzone({ accept: '.dxf,.json,application/json', compact: true, paste: false, label: 'Open a DXF or CAD Studio project', hint: 'Drop it here or click to browse', onFiles: (files) => openFile(files[0]) })
  welcome.append(h('div', { class: 'cad-welcome-card' },
    h('div', h('h3', params.export ? 'Convert a DXF drawing' : params.start === 'open' ? 'Open a drawing' : 'Start drawing'),
      params.export ? h('p', 'Drop a DXF below, check the preview, then save it as a to-scale PDF, SVG or PNG. Everything stays on your device.') : h('p', 'Pick a tool on the left or type a command like ', h('kbd', 'L'), ' (line), ', h('kbd', 'C'), ' (circle) or ', h('kbd', 'REC'), '. Points can be typed too: ', h('kbd', '10,20'), ' or ', h('kbd', '@50<30'), '.')),
    dz,
    h('div', { class: 'cad-welcome-actions' },
      button('Sample part', { size: 'sm', icon: 'cog', onClick: () => { applyState(TEMPLATES.plate(), 'Base plate'); app.log('Loaded a sample part. Try Trim, Offset or Dimension on it.', 'muted') } }),
      button('Sample floor plan', { size: 'sm', icon: 'house', onClick: () => { applyState(TEMPLATES.floorplan(), 'Floor plan'); app.log('Loaded a sample floor plan.', 'muted') } }),
      button('Start blank', { size: 'sm', variant: 'ghost', onClick: () => { welcomeDismissed = true; welcome.hidden = true; canvas.focus() } }))))

  // ---------- Resize, theme, boot ----------
  const ro = new ResizeObserver(() => {
    const r = stage.getBoundingClientRect()
    if (r.width < 10) return
    view.w = r.width; view.h = r.height
    const d = dpr()
    canvas.width = Math.round(r.width * d); canvas.height = Math.round(r.height * d)
    if (firstFit) { firstFit = false; boot() } else onView()
  })
  ro.observe(stage)
  const mo = new MutationObserver(() => { themeColors(); render() })
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  themeColors()

  let booted = false
  async function boot() {
    if (booted) return
    booted = true
    let restored = false
    const saved = await idb.get(KEY)
    if (saved?.json && !signal?.aborted) {
      try {
        const st = stateFromJSON(saved.json)
        if (st.ents.length || st.layers.length > 4) {
          doc.load(st, saved.json.name || 'Untitled')
          Object.assign(view, saved.view || {})
          Object.assign(app.cur, { layer: doc.layers.some((l) => l.name === saved.cur?.layer) ? saved.cur.layer : '0', color: saved.cur?.color ?? null, ltype: saved.cur?.ltype ?? null })
          Object.assign(app.last, saved.last || {})
          restored = st.ents.length > 0
        }
      } catch (e) { console.warn('Could not restore the last drawing', e) }
    }
    if (!restored && params.template && TEMPLATES[params.template]) { doc.load(TEMPLATES[params.template](), params.template === 'plate' ? 'Base plate' : 'Floor plan'); zoomExtents() }
    else if (restored) { if (!saved.view) zoomExtents(); toast('Restored your last drawing from this device', 'info') }
    else defaultView()
    if (!app.last.filletR) app.last.filletR = niceNum(doc.settings.gridStep / 2)
    if (!app.last.cd1) app.last.cd1 = app.last.cd2 = app.last.filletR
    app.last.hatch.scale = doc.settings.hatchScale
    nameInput.value = doc.name
    refreshLayerSel(); renderHud(); renderPanel(); updateZoomText()
    undoBtn.disabled = !doc.canUndo(); redoBtn.disabled = !doc.canRedo()
    welcome.hidden = doc.ents.length > 0
    for (const b of railBtns.values()) b.setAttribute('aria-pressed', 'false')
    railBtns.get('select').setAttribute('aria-pressed', 'true')
    savedEl.lastChild.textContent = 'Saved on this device'
    app.log('CAD Studio ready. Pick a tool or type a command (L, C, REC, M, DIM). Type HELP for the list.', 'muted')
    promptChanged()
    try { if (matchMedia('(max-width: 640px)').matches && rootEl.getBoundingClientRect().top > 120) rootEl.scrollIntoView({ block: 'start' }) } catch { /* ignore */ }
  }

  return () => {
    ro.disconnect(); mo.disconnect()
    document.removeEventListener('keydown', onKey)
    document.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
    cancelAnimationFrame(raf)
    app.pop?.close()
    for (const fn of disposers) { try { fn() } catch { /* ignore */ } }
    if (app.prompt) app.prompt.reject(CANCEL)
    if (dirty && booted) saveNow()
  }
}
