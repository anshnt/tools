// Motion Studio: a browser motion-graphics editor (keyframes, easing, text and shape layers, effects) with video, GIF and PNG export.
// A clean-room take on the same category as the open-source EffectCraft by ArtCraft (https://github.com/storytold/effectcraft).
import { h, icon, button, select, toggle, segmented, modal, toast, alert, progress, busy, download, formatBytes, clear, dropzone } from '../../lib/ui.js'
import { pickFiles, safeName, baseName } from '../../lib/files.js'
import * as persist from '../../lib/store.js'
import { createStore } from './_store.js'
import { createStage } from './_stage.js'
import { createTimeline } from './_timeline.js'
import { createInspector } from './_inspector.js'
import * as ops from './_ops.js'
import { buildTemplate, TEMPLATES, showTime } from './_presets.js'
import { SIZE_PRESETS, makeDoc } from './_model.js'
import { preloadFonts, releaseScratch } from './_render.js'
import { CAN, exportMP4, exportWebM, exportGIF, exportPNGSequence, exportFrame, outSize, frameCount } from './_export.js'
import { injectStyles } from './_styles.js'
import { tip, iconBtn, timecode } from './_ui.js'

const TOOLS = [
  ['select', 'mouse-pointer-2', 'Select and move', 'V'], ['hand', 'hand', 'Hand: pan the canvas', 'H'], ['text', 'type', 'Text: click to add', 'T'],
  ['rect', 'square', 'Rectangle: drag to draw', 'R'], ['ellipse', 'circle', 'Ellipse: drag to draw', 'E'], ['polygon', 'hexagon', 'Polygon: drag to draw', 'P'],
  ['star', 'star', 'Star: drag to draw', 'S'], ['line', 'minus', 'Line: drag to draw', 'L'], ['anchor', 'crosshair', 'Anchor point: drag to move the pivot', 'Y'],
]
const KEYS = [
  ['Space', 'Play or pause'], [', and .', 'Step one frame back or forward'], ['Home / End', 'Jump to the first or last frame'], ['V H T R E P S L Y', 'Select, hand, text, rectangle, ellipse, polygon, star, line and anchor point tools'],
  ['Arrow keys', 'Nudge the selected layer 1 px (Shift: 10 px)'], ['Delete', 'Delete selected keyframes, or layers'], ['Ctrl Z / Ctrl Shift Z', 'Undo / redo (Ctrl Y also redoes)'],
  ['Ctrl C / V / X / D', 'Copy, paste, cut, duplicate layers'], ['Ctrl A', 'Select all layers'], ['Ctrl G / Ctrl Shift G', 'Group / ungroup'], ['Ctrl [ / Ctrl ]', 'Send layer backward / forward'],
  ['[ and ]', 'Set the selected layer\'s in and out point to the playhead'], ['Ctrl S', 'Save the project file'], ['Ctrl E', 'Export'], ['Ctrl 0 / Ctrl + / Ctrl -', 'Fit / zoom in / zoom out the canvas'],
  ['Ctrl + scroll', 'Zoom the canvas or the timeline'], ['Alt + drag or Hand tool', 'Pan the canvas'], ['Shift + drag', 'Constrain a move, draw a square, snap rotation to 15 degrees'],
  ['Double-click a keyframe', 'Jump the playhead to it'], ['Drag a property label', 'Scrub its number'],
]

export async function mount(root, { params = {}, signal }) {
  injectStyles()
  const template = params.template || ''
  const store = createStore({ key: `motion-studio:${template || 'main'}`, makeInitial: () => buildTemplate(template || 'title-reveal') })
  const restored = await store.restore()
  if (!restored) store.setTime(showTime(template || 'title-reveal'))
  const cleanups = []
  let tool = 'select', playing = false, loop = true, rafId = 0, playFrom = 0, playStart = 0, exportCtl = null

  // ---------- project actions ----------
  const confirmReplace = (what, go) => {
    const m = modal({
      title: what, icon: 'triangle-alert',
      body: h('p', 'Your current project will be replaced and cannot be brought back. Choose Save first if you want a copy as a file.'),
      actions: [button('Cancel', { onClick: () => m.close() }), button('Continue', { variant: 'primary', onClick: () => { m.close(); go() } })],
    })
  }
  function newProject() {
    let tpl = template || 'blank', size = '1920x1080'
    const grid = h('div', { class: 'ms-tpl-grid' }, TEMPLATES.map(([id, label]) => h('button', {
      type: 'button', class: 'ms-tpl', 'aria-pressed': String(id === tpl), onclick: (e) => { tpl = id; for (const b of grid.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)) },
    }, icon(id === 'blank' ? 'file' : id === 'lower-third' ? 'rectangle-horizontal' : id === 'logo-reveal' ? 'hexagon' : 'type'), label)))
    const sizeSel = select(SIZE_PRESETS, size, (v) => { size = v })
    const m = modal({
      title: 'New project', icon: 'file-plus',
      body: h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'Start blank or from a template. Templates keep their own size. Your current project is replaced, so save it first if you need it.'), grid,
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Size (blank project only)'), sizeSel)),
      actions: [button('Cancel', { onClick: () => m.close() }), button('Create', { variant: 'primary', icon: 'plus', onClick: () => {
        m.close()
        const doc = tpl === 'blank' ? (() => { const [w, hh] = size.split('x').map(Number); return makeDoc({ width: w, height: hh }) })() : buildTemplate(tpl)
        store.load(doc, [])
        store.setTime(tpl === 'blank' ? 0 : showTime(tpl))
        toast('New project created', 'success')
      } })],
    })
  }
  async function openProject(file) {
    try {
      await store.fromProjectText(await file.text())
      toast(`Opened ${file.name}`, 'success')
    } catch (e) { toast(e.message, 'error') }
  }
  async function saveProject() {
    try {
      download(await store.toProjectBlob(), `${safeName(store.comp.name)}.motion.json`)
      toast('Project saved as a file', 'success')
    } catch (e) { toast(e.message, 'error') }
  }
  async function addImages(files) {
    const imgs = files.filter((f) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|avif|bmp|svg|heic|heif)$/i.test(f.name))
    const proj = files.find((f) => /\.json$/i.test(f.name))
    if (proj && !imgs.length) return confirmReplace('Open project', () => openProject(proj))
    if (!imgs.length) return toast('Add images (PNG, JPG, WebP, GIF, SVG) or a Motion Studio project (.json).', 'error')
    for (const f of imgs) {
      try {
        const a = await store.addAsset(f)
        const k = Math.min(1, store.comp.width / a.w, store.comp.height / a.h)
        ops.addLayer(store, 'image', { name: baseName(f.name) || 'Image', data: { asset: a.id, w: Math.max(1, Math.round(a.w * k)), h: Math.max(1, Math.round(a.h * k)) } })
      } catch (e) { toast(e.message, 'error') }
    }
  }
  const pickImages = async () => addImages(await pickFiles({ accept: 'image/*', multiple: true }))

  // ---------- playback ----------
  function tick(now) {
    if (!playing) return
    let t = playFrom + (now - playStart) / 1000
    if (t >= store.comp.duration) {
      if (loop) { playFrom = 0; playStart = now; t = 0 } else { store.setTime(store.endTime); return pause() }
    }
    store.setTime(t)
    rafId = requestAnimationFrame(tick)
  }
  function play() {
    if (playing) return
    if (store.time >= store.endTime - 1e-6) store.setTime(0)
    playing = true
    playFrom = store.time
    playStart = performance.now()
    rafId = requestAnimationFrame(tick)
    syncTransport()
  }
  function pause() { playing = false; cancelAnimationFrame(rafId); syncTransport() }
  const toggle_ = () => (playing ? pause() : play())
  const seek = (t) => { if (playing) pause(); store.setTime(t) }
  const step = (n) => seek(store.time + n / store.comp.fps)

  // ---------- panels ----------
  const stage = createStage({
    store, getTool: () => tool, setTool: (t) => setTool(t), onFiles: addImages,
    onEditText: () => { inspector.focusText(); setTab('inspector') },
  })
  const timeline = createTimeline({ store, isPlaying: () => playing })
  const inspector = createInspector({ store, onKeyed: (...ids) => { for (const id of ids) timeline.expand(id) } })

  // ---------- toolbar ----------
  const undoBtn = iconBtn('undo-2', 'Undo', () => doUndo(), { key: 'Ctrl Z' })
  const redoBtn = iconBtn('redo-2', 'Redo', () => doRedo(), { key: 'Ctrl Shift Z' })
  const saved = h('span', { class: 'ms-saved', 'aria-live': 'polite' }, icon('circle-check'), h('span', 'Autosave on'))
  store.onSaved = (ok) => { saved.lastChild.textContent = ok ? `Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Autosave unavailable'; saved.classList.toggle('bad', !ok) }
  const doUndo = () => { const l = store.undo(); if (l) toast(`Undo: ${l}`); }
  const doRedo = () => { const l = store.redo(); if (l) toast(`Redo: ${l}`) }
  const sep = () => h('i', { class: 'ms-sep' })
  const bar = h('div', { class: 'ms-bar' },
    h('div', { class: 'ms-group' },
      iconBtn('file-plus', 'New project', () => newProject(), { text: 'New', cls: 'txt' }),
      iconBtn('folder-open', 'Open a project file', async () => { const [f] = await pickFiles({ accept: '.json,application/json' }); if (f) confirmReplace('Open project', () => openProject(f)) }, { text: 'Open', cls: 'txt' }),
      iconBtn('save', 'Save the project as a file', saveProject, { text: 'Save', key: 'Ctrl S', cls: 'txt' })),
    sep(), h('div', { class: 'ms-group' }, undoBtn, redoBtn),
    sep(), h('div', { class: 'ms-group' },
      iconBtn('type', 'Add a text layer', () => { ops.addLayer(store, 'text'); inspector.focusText(); setTab('inspector') }, { text: 'Text', cls: 'txt' }),
      iconBtn('shapes', 'Add a shape layer', () => ops.addLayer(store, 'shape'), { text: 'Shape', cls: 'txt' }),
      iconBtn('image', 'Add images', pickImages, { text: 'Image', cls: 'txt' }),
      iconBtn('square-dashed', 'Add a solid colour layer', () => ops.addLayer(store, 'solid'), { text: 'Solid', cls: 'txt' }),
      iconBtn('folder', 'Group the selected layers', () => ops.groupLayers(store), { text: 'Group', key: 'Ctrl G', cls: 'txt' })),
    h('div', { class: 'ms-grow' }),
    saved,
    iconBtn('keyboard', 'Keyboard shortcuts', () => showKeys()),
    iconBtn('download', 'Export video, GIF or PNG frames', () => openExport(), { text: 'Export', cls: 'primary', key: 'Ctrl E' }))

  const rail = h('div', { class: 'ms-rail', role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' },
    TOOLS.map(([id, ic, label, key]) => { const b = iconBtn(ic, label, () => setTool(id), { key, pressed: id === tool }); b.dataset.tool = id; return b }))
  function setTool(t) {
    tool = t
    for (const b of rail.children) b.setAttribute('aria-pressed', String(b.dataset.tool === t))
    stage.el.dataset.cursor = t === 'hand' ? 'grab' : t === 'select' ? '' : 'crosshair'
  }

  // ---------- transport ----------
  const tc = h('span', { class: 'ms-tc-main' }), tf = h('span', { class: 'ms-tc-frame' })
  const playBtn = iconBtn('play', 'Play', toggle_, { key: 'Space', cls: 'play' })
  const loopBtn = iconBtn('repeat', 'Loop playback', () => { loop = !loop; loopBtn.setAttribute('aria-pressed', String(loop)) }, { pressed: true })
  const zoomR = h('input', { type: 'range', min: -2, max: 4, step: 0.05, value: 0, class: 'ms-zoomr', 'aria-label': 'Timeline zoom', oninput: () => timeline.setZoom(2 ** zoomR.valueAsNumber) })
  timeline.onZoom = (z) => { zoomR.value = Math.log2(z) }
  const transport = h('div', { class: 'ms-transport' },
    iconBtn('skip-back', 'First frame', () => seek(0), { sm: true, key: 'Home' }), iconBtn('step-back', 'Previous frame', () => step(-1), { sm: true, key: ',' }), playBtn,
    iconBtn('step-forward', 'Next frame', () => step(1), { sm: true, key: '.' }), iconBtn('skip-forward', 'Last frame', () => seek(store.endTime), { sm: true, key: 'End' }), loopBtn,
    h('div', { class: 'ms-tc' }, tc, tf), h('div', { class: 'ms-grow' }),
    iconBtn('zoom-out', 'Zoom timeline out', () => timeline.setZoom(timeline.zoom / 1.4), { sm: true }), zoomR,
    iconBtn('zoom-in', 'Zoom timeline in', () => timeline.setZoom(timeline.zoom * 1.4), { sm: true }), iconBtn('scan', 'Fit timeline', () => timeline.fit(), { sm: true }))
  function syncTransport() {
    const fps = store.comp.fps
    tc.textContent = timecode(store.time, fps)
    tf.textContent = `${Math.round(store.time * fps)} / ${store.frames - 1}`
    playBtn.replaceChildren(icon(playing ? 'pause' : 'play'))
    tip(playBtn, playing ? 'Pause' : 'Play', 'Space', true)
  }

  // ---------- layout ----------
  const tlh = persist.load('motion-studio:tlh', 270)
  const split = h('div', { class: 'ms-split', role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Resize timeline' })
  const tabs = h('div', { class: 'ms-tabs', role: 'tablist' },
    ['timeline', 'inspector'].map((id) => h('button', { type: 'button', role: 'tab', class: 'ms-tab', dataset: { tab: id }, onclick: () => setTab(id) }, id === 'timeline' ? icon('gantt-chart') : icon('sliders-horizontal'), id === 'timeline' ? 'Timeline' : 'Inspector')))
  const foot = h('div', { class: 'ms-foot' },
    h('span', 'Prefer a native app? ', h('a', { href: 'https://github.com/storytold/effectcraft', target: '_blank', rel: 'noopener' }, 'EffectCraft by ArtCraft'), ' is free and open source.'),
    h('span', { class: 'ms-foot-r' }, 'Everything stays on this device.'))
  const hiddenZone = h('div', { hidden: true })
  const app = h('div', { class: 'ms-app', dataset: { size: 'l', tab: 'timeline' }, style: { '--tl-h': `${tlh}px` } },
    bar, rail, h('div', { class: 'ms-stagewrap' }, stage.el), h('aside', { class: 'ms-insp', 'aria-label': 'Inspector' }, inspector.el), split, tabs,
    h('section', { class: 'ms-tl', 'aria-label': 'Timeline' }, transport, timeline.el), foot, hiddenZone)
  root.append(app)
  // Lets the site's smart file drop hand dropped images or a project file to this editor.
  hiddenZone.append(dropzone({ accept: 'image/*,.json,application/json', multiple: true, onFiles: addImages, label: 'Add images' }))

  function setTab(id) { app.dataset.tab = id; for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === id)) }
  setTab('timeline')
  const ro = new ResizeObserver(() => { const w = app.clientWidth; app.dataset.size = w < 760 ? 's' : w < 1080 ? 'm' : 'l'; stage.queue() })
  ro.observe(app)
  split.addEventListener('pointerdown', (e) => {
    split.setPointerCapture(e.pointerId)
    const y0 = e.clientY, h0 = app.querySelector('.ms-tl').getBoundingClientRect().height
    const move = (ev) => app.style.setProperty('--tl-h', `${Math.round(Math.min(Math.max(170, h0 + y0 - ev.clientY), app.clientHeight - 260))}px`)
    const up = () => { split.removeEventListener('pointermove', move); split.removeEventListener('pointerup', up); persist.save('motion-studio:tlh', parseInt(app.style.getPropertyValue('--tl-h'), 10) || 300) }
    split.addEventListener('pointermove', move); split.addEventListener('pointerup', up)
  })

  // ---------- keyboard ----------
  function onKey(e) {
    if (document.querySelector('dialog[open]')) return
    const t = e.target
    const typing = t.closest?.('input, textarea, select, [contenteditable="true"]') && !(t.type === 'range' || t.type === 'checkbox' || t.type === 'color')
    if (typing) { if (e.key === 'Escape') t.blur(); return }
    const inApp = app.contains(t) || !t.closest?.('input, textarea, select, button, a, summary, dialog, [contenteditable="true"]')
    if (!inApp) return
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase()
    const eat = () => { e.preventDefault(); e.stopPropagation() }
    if (mod) {
      if (k === 'z') { eat(); e.shiftKey ? doRedo() : doUndo() } else if (k === 'y') { eat(); doRedo() }
      else if (k === 's') { eat(); saveProject() } else if (k === 'e') { eat(); openExport() }
      else if (k === 'a') { eat(); store.select(ops.allLayers(store.doc).map((l) => l.id)) }
      else if (k === 'c') { eat(); ops.copyLayers(store) } else if (k === 'x') { eat(); ops.copyLayers(store); ops.deleteLayers(store) } else if (k === 'v') { if (store.clip.length) { eat(); ops.pasteLayers(store) } }
      else if (k === 'd') { eat(); ops.duplicateLayers(store) } else if (k === 'g') { eat(); e.shiftKey ? ops.ungroupLayer(store) : ops.groupLayers(store) }
      else if (k === ']' && store.sel[0]) { eat(); ops.moveLayer(store, store.sel[0], e.shiftKey ? 'top' : 'up') } else if (k === '[' && store.sel[0]) { eat(); ops.moveLayer(store, store.sel[0], e.shiftKey ? 'bottom' : 'down') }
      else if (k === '0') { eat(); stage.fit() } else if (k === '=' || k === '+') { eat(); stage.setZoom(stage.zoom * 1.25) } else if (k === '-') { eat(); stage.setZoom(stage.zoom / 1.25) }
      return
    }
    if (e.altKey) return
    const nudgeBy = e.shiftKey ? 10 : 1
    if (e.key === ' ' && !t.closest('button, a, summary')) { eat(); toggle_() }
    else if (e.key === ',') { eat(); step(e.shiftKey ? -10 : -1) } else if (e.key === '.') { eat(); step(e.shiftKey ? 10 : 1) }
    else if (e.key === 'Home') { eat(); seek(0) } else if (e.key === 'End') { eat(); seek(store.endTime) }
    else if (e.key === 'Delete' || e.key === 'Backspace') { eat(); if (!inspector.deleteKeys()) ops.deleteLayers(store) }
    else if (e.key === 'ArrowLeft') { eat(); ops.nudge(store, -nudgeBy, 0) } else if (e.key === 'ArrowRight') { eat(); ops.nudge(store, nudgeBy, 0) }
    else if (e.key === 'ArrowUp') { eat(); ops.nudge(store, 0, -nudgeBy) } else if (e.key === 'ArrowDown') { eat(); ops.nudge(store, 0, nudgeBy) }
    else if (e.key === 'Escape') { setTool('select'); store.select([]) }
    else if (e.key === '[' || e.key === ']') { for (const id of store.sel) e.key === '[' ? ops.setRange(store, id, store.time, null) : ops.setRange(store, id, null, store.time + 1 / store.comp.fps) }
    else if (!e.shiftKey && !e.ctrlKey) { const hit = TOOLS.find((x) => x[3].toLowerCase() === k); if (hit) { eat(); setTool(hit[0]) } }
  }
  document.addEventListener('keydown', onKey)
  cleanups.push(() => document.removeEventListener('keydown', onKey))
  const flush = () => { if (document.visibilityState === 'hidden') store.saveNow() }
  document.addEventListener('visibilitychange', flush)
  cleanups.push(() => document.removeEventListener('visibilitychange', flush))

  // ---------- state sync ----------
  const offStore = store.on((type) => {
    if (type === 'time') syncTransport()
    else if (type === 'doc') {
      if (store.time > store.endTime) store.setTime(store.endTime)
      syncTransport()
    } else if (type === 'history') {
      undoBtn.disabled = !store.undoStack.length; redoBtn.disabled = !store.redoStack.length
      tip(undoBtn, store.undoStack.length ? `Undo: ${store.undoStack.at(-1).label}` : 'Undo', 'Ctrl Z', true)
      tip(redoBtn, store.redoStack.length ? `Redo: ${store.redoStack.at(-1).label}` : 'Redo', 'Ctrl Shift Z', true)
    }
  })
  store.emit('history')
  syncTransport()
  if (restored) toast('Restored your last project from this browser.')
  inspector.rebuild()

  // ---------- dialogs ----------
  function showKeys() {
    modal({ title: 'Keyboard shortcuts', icon: 'keyboard', body: h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('tbody', KEYS.map(([k, d]) => h('tr', h('td', h('kbd', k)), h('td', d)))))) })
  }

  function openExport() {
    pause()
    const doc = store.doc
    const formats = [['mp4', 'MP4'], ['webm', 'WebM'], ['gif', 'GIF'], ['png', 'PNG sequence'], ['frame', 'This frame']]
    const s = { fmt: CAN.mp4 ? 'mp4' : CAN.webm ? 'webm' : 'gif', scale: 1, gifFps: Math.min(15, doc.comp.fps), colors: 256, quality: 1, loop: true }
    const info = h('div', { class: 'small muted' })
    const note = h('div')
    const result = h('div')
    const prog = progress('Exporting')
    const fmtSeg = segmented(formats, s.fmt, (v) => { s.fmt = v; refresh() }, 'Export format')
    const scaleSel = select([[1, '100%'], [0.75, '75%'], [0.5, '50%'], [0.25, '25%']], 1, (v) => { s.scale = +v; refresh() })
    const gifFps = select([8, 10, 12, 15, 20, 25].map((n) => [n, `${n} fps`]), s.gifFps, (v) => { s.gifFps = +v; refresh() })
    const colors = select([[256, '256 colours'], [128, '128 colours'], [64, '64 colours']], 256, (v) => { s.colors = +v })
    const quality = select([[0.5, 'Smaller file'], [1, 'Balanced'], [1.8, 'Best quality']], 1, (v) => { s.quality = +v })
    const loopT = toggle('Loop forever', true, (v) => { s.loop = v })
    const fld = (label, c) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), c)
    const fScale = fld('Size', scaleSel), fGif = fld('GIF frame rate', gifFps), fCol = fld('Palette', colors), fQ = fld('Quality', quality)
    const runBtn = button('Export', { icon: 'download', variant: 'primary', size: 'lg' })
    const cancelBtn = button('Cancel', { variant: 'ghost', size: 'sm' }); cancelBtn.hidden = true
    let url = null
    function refresh() {
      const fps = s.fmt === 'gif' ? s.gifFps : doc.comp.fps, even = s.fmt === 'mp4' || s.fmt === 'webm'
      const { w, h: hh } = outSize(doc, s.scale, even), n = s.fmt === 'frame' ? 1 : frameCount(doc, fps)
      info.textContent = s.fmt === 'frame' ? `One PNG at ${w} x ${hh} px from the playhead (${timecode(store.time, doc.comp.fps)}).` : `${w} x ${hh} px, ${n} frame${n > 1 ? 's' : ''} at ${fps} fps, ${doc.comp.duration} s.`
      fGif.hidden = s.fmt !== 'gif'; fCol.hidden = s.fmt !== 'gif'; fQ.hidden = !(s.fmt === 'mp4' || s.fmt === 'webm'); loopT.hidden = s.fmt !== 'gif'; fScale.hidden = false
      const msg = []
      if (s.fmt === 'mp4' && !CAN.mp4) msg.push(alert('warn', 'This browser cannot encode MP4 (it needs WebCodecs). Use Chrome or Edge, or pick WebM or GIF.'))
      if (s.fmt === 'webm' && !CAN.webm) msg.push(alert('warn', 'This browser cannot record WebM from a canvas.'))
      if (s.fmt === 'webm' && CAN.webm) msg.push(alert('info', `WebM is recorded in real time, so it takes about ${Math.ceil(doc.comp.duration)} seconds. Keep this tab visible while it runs.`))
      if ((s.fmt === 'mp4' || s.fmt === 'webm') && doc.comp.transparent) msg.push(alert('info', 'Video cannot hold transparency, so the background colour is filled in. Use PNG sequence or GIF to keep it.'))
      if (s.fmt === 'png' && n * w * hh > 1.6e9) msg.push(alert('warn', 'That many large frames may run out of memory. Lower the size or shorten the composition.'))
      clear(note, msg)
      runBtn.disabled = (s.fmt === 'mp4' && !CAN.mp4) || (s.fmt === 'webm' && !CAN.webm)
    }
    const m = modal({
      title: 'Export', icon: 'download',
      onClose: () => { exportCtl?.abort(); if (url) URL.revokeObjectURL(url) },
      body: h('div', { class: 'stack' }, fmtSeg, h('div', { class: 'grid-2' }, fScale, fGif, fCol, fQ), loopT, info, note,
        h('div', { class: 'row' }, runBtn, cancelBtn), prog.el, result),
    })
    refresh()
    runBtn.addEventListener('click', () => busy(runBtn, async () => {
      clear(result)
      if (url) { URL.revokeObjectURL(url); url = null }
      exportCtl = new AbortController()
      cancelBtn.hidden = false
      cancelBtn.onclick = () => exportCtl.abort()
      const snap = JSON.parse(JSON.stringify(store.doc)), assets = store.assets, t0 = performance.now()
      await preloadFonts(snap)
      const o = { scale: s.scale }, cb = { onProgress: (f, t) => prog.set(f, t), signal: exportCtl.signal }
      const fmt = s.fmt
      const bitrate = (w, hh, fps) => Math.round(Math.min(40e6, Math.max(1.5e6, w * hh * fps * 0.12 * s.quality)))
      let blob, ext, name = safeName(snap.comp.name)
      prog.set(0, 'Starting')
      if (fmt === 'mp4' || fmt === 'webm') {
        const { w, h: hh } = outSize(snap, s.scale, true)
        o.bitrate = bitrate(w, hh, snap.comp.fps)
        blob = await (fmt === 'mp4' ? exportMP4 : exportWebM)(snap, assets, o, cb); ext = fmt
      } else if (fmt === 'gif') { blob = await exportGIF(snap, assets, { ...o, fps: s.gifFps, colors: s.colors, loop: s.loop }, cb); ext = 'gif' }
      else if (fmt === 'png') { blob = await exportPNGSequence(snap, assets, { ...o, name }, cb); ext = 'zip'; name += '-frames' }
      else { blob = await exportFrame(snap, assets, store.time, s.scale); ext = 'png'; name += `-frame-${Math.round(store.time * snap.comp.fps)}` }
      url = URL.createObjectURL(blob)
      const media = fmt === 'mp4' || fmt === 'webm' ? h('video', { src: url, controls: true, muted: true, loop: true, playsinline: true, class: 'ms-result-media' })
        : fmt === 'gif' || fmt === 'frame' ? h('img', { src: url, alt: 'Export preview', class: 'ms-result-media' }) : null
      const dl = button(`Download .${ext}`, { icon: 'download', variant: 'primary', onClick: () => download(blob, `${name}.${ext}`) })
      clear(result, alert('success', h('strong', 'Done. '), `${formatBytes(blob.size)} in ${((performance.now() - t0) / 1000).toFixed(1)} s.`), media, h('div', { class: 'row', style: 'margin-top:10px' }, dl))
      media?.play?.().catch(() => {})
    }, { label: 'Exporting', errorTo: result, progress: prog }).finally(() => { cancelBtn.hidden = true; exportCtl = null }))
    void m
  }

  // first paint
  stage.fit()
  setTool('select')
  return () => {
    pause()
    exportCtl?.abort()
    store.saveNow()
    offStore()
    ro.disconnect()
    stage.destroy(); timeline.destroy(); releaseScratch()
    for (const c of cleanups) c()
  }
}
