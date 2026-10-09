// Vector Studio: a browser vector editor (pen, shapes, paths, gradients, text, boolean ops; SVG, PNG and PDF export).
// This is the entry module: it assembles the app shell and wires the editor, canvas, panels and keyboard together.
// The other files in this folder (_*.js) are helpers: geometry, model, renderer, tools, panels, import/export.
import { h, icon, button, toast, select, errorMessage, download } from '../../lib/ui.js'
import * as idb from '../../lib/idb.js'
import { pickFiles, baseName } from '../../lib/files.js'
import { loadImage, canvas as makeCanvas } from '../../lib/image.js'
import { ensureStyle } from './_style.js'
import { Editor } from './_editor.js'
import { Canvas } from './_canvas.js'
import { buildSide } from './_panels.js'
import { exportDialog, newDialog, shortcutsDialog } from './_dialogs.js'
import { parseSvg } from './_import.js'
import { readProject, projectBlob, cleanDoc } from './_io.js'
import { exportSvg } from './_svg.js'
import { newDoc, mk, applyMatrix, bboxOf, bboxOfAll, FONTS, solid, DEFAULT_STYLE } from './_model.js'
import { tr, sc, about } from './_geom.js'
import { TEMPLATES } from './_templates.js'
import { swatchCss } from './_paint.js'

const TOOLS = [
  ['select', 'mouse-pointer-2', 'Selection', 'V', 'Click to select. Drag to move, drag a handle to resize, drag just outside a corner to rotate. Shift adds to the selection.'],
  ['direct', 'mouse-pointer', 'Direct selection', 'A', 'Click a shape, then drag its points and handles. Double-click a segment to add a point, or a point to switch smooth and corner.'],
  null,
  ['pen', 'pen-tool', 'Pen', 'P', 'Click for corner points, drag for curves. Click the first point to close, Enter to finish an open path.'],
  ['pencil', 'pencil', 'Pencil', 'N', 'Drag to draw freehand. The line is smoothed when you let go; finish near the start to close the shape.'],
  null,
  ['rect', 'square', 'Rectangle', 'M', 'Drag to draw. Shift makes a square, Alt draws from the centre. Click once for a default size.'],
  ['ellipse', 'circle', 'Ellipse', 'L', 'Drag to draw. Shift makes a circle, Alt draws from the centre.'],
  ['polygon', 'hexagon', 'Polygon', 'G', 'Drag from the centre outwards. Set the number of sides in the bar above.'],
  ['star', 'star', 'Star', 'S', 'Drag from the centre outwards. Set the points and inner radius in the bar above.'],
  ['line', 'slash', 'Line', '\\', 'Drag to draw a line. Shift snaps to 45 degree steps.'],
  null,
  ['text', 'type', 'Text', 'T', 'Click to add text, or click existing text to edit it. Esc finishes.'],
  ['eyedrop', 'pipette', 'Eyedropper', 'I', 'Click an object to copy its fill and stroke onto the selection (or onto new shapes).'],
  ['hand', 'hand', 'Hand', 'H', 'Drag to pan. Pinch or Ctrl+wheel to zoom.'],
]
const KEYMAP = Object.fromEntries(TOOLS.filter(Boolean).map((t) => [t[3].toLowerCase(), t[0]]))
const TOOL_NAME = Object.fromEntries(TOOLS.filter(Boolean).map((t) => [t[0], t[2]]))
const HINT = Object.fromEntries(TOOLS.filter(Boolean).map((t) => [t[0], t[4]]))
const isTyping = (t) => t && (t.closest?.('input, textarea, select, [contenteditable="true"]') || false)

export async function mount(root, { tool, params = {}, signal }) {
  ensureStyle()
  const ed = new Editor()
  const cv = new Canvas(ed)
  const KEY = `vector-studio:${tool.id}`
  const cleanups = []
  const on = (target, ev, fn, opts) => { target.addEventListener(ev, fn, opts); cleanups.push(() => target.removeEventListener(ev, fn, opts)) }
  let fileName = 'vector-art'

  // ---------- chrome ----------
  const tb = (iconName, label, tip, onClick, opts = {}) => h('button', { type: 'button', class: ['vs-tb', opts.primary && 'primary', opts.cls], 'data-tip': tip, 'data-key': opts.key || '', 'aria-label': tip, onclick: onClick, disabled: opts.disabled }, icon(iconName), label && h('span', { class: 'vs-hide-m' }, label))
  const undoBtn = tb('undo-2', '', 'Undo', () => doUndo(), { key: 'Ctrl+Z' })
  const redoBtn = tb('redo-2', '', 'Redo', () => doRedo(), { key: 'Ctrl+Shift+Z' })
  const zoomBtn = h('button', { type: 'button', class: 'vs-tb vs-zoom', 'data-tip': 'Zoom: click to toggle fit and 100%', 'aria-label': 'Zoom level, click to toggle fit and actual size', onclick: () => { Math.abs(ed.view.z - 1) < 0.01 ? ed.fit() : ed.zoomTo(1) } }, '100%')
  const gridBtn = tb('grid-3x3', '', 'Show grid', () => { ed.grid.on = !ed.grid.on; ed.emit('view'); ed.emit('grid') }, { key: "Ctrl+'", cls: 'vs-hide-m' })
  const snapBtn = tb('magnet', '', 'Snap to grid and guides', () => { ed.grid.snap = !ed.grid.snap; ed.emit('grid') }, { cls: 'vs-hide-m' })
  const panelsBtn = tb('sliders-horizontal', 'Panels', 'Show or hide panels', () => side.classList.toggle('open'), { cls: 'vs-only-m' })
  const bar = h('div', { class: 'vs-bar', role: 'toolbar', 'aria-label': 'Main toolbar' },
    tb('file-plus', 'New', 'New document', () => newDialog(ed, (d) => { ed.loadDoc(d, 'New document'); ed.fit(); ed.emit('grid') })),
    tb('folder-open', 'Open', 'Open or import an SVG, image or project', () => openFiles(), { key: 'Ctrl+O' }),
    tb('save', 'Save', 'Save project file', () => saveProject(), { key: 'Ctrl+S', cls: 'vs-hide-m' }),
    h('span', { class: 'vs-sepv' }), undoBtn, redoBtn, h('span', { class: 'vs-sepv' }),
    tb('zoom-out', '', 'Zoom out', () => ed.zoomAt(1 / 1.25), { key: 'Ctrl+-', cls: 'vs-hide-m' }), zoomBtn, tb('zoom-in', '', 'Zoom in', () => ed.zoomAt(1.25), { key: 'Ctrl++', cls: 'vs-hide-m' }), tb('scan', '', 'Fit artboard', () => ed.fit(), { key: 'Ctrl+0' }),
    h('span', { class: 'vs-sepv vs-hide-m' }), gridBtn, snapBtn, h('span', { class: 'vs-grow' }),
    tb('keyboard', '', 'Keyboard shortcuts', () => shortcutsDialog(), { cls: 'vs-hide-m' }), panelsBtn,
    tb('download', 'Export', 'Export SVG, PNG or PDF', () => exportDialog(ed, fileName), { primary: true, key: 'Ctrl+E' }))

  const opts = h('div', { class: 'vs-opts' })
  const railBtns = new Map()
  const rail = h('div', { class: 'vs-rail', role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' })
  for (const t of TOOLS) {
    if (!t) { rail.append(h('span', { class: 'vs-rule' })); continue }
    const b = h('button', { type: 'button', class: 'vs-tool', 'data-tip': t[2], 'data-key': t[3], 'aria-label': `${t[2]} (${t[3]})`, 'aria-pressed': 'false', onclick: () => ed.setTool(t[0]) }, icon(t[1]))
    railBtns.set(t[0], b)
    rail.append(b)
  }
  // current fill and stroke
  const fillIn = h('input', { type: 'color', 'aria-label': 'Fill colour', oninput: () => ed.setStyle({ fill: solid(fillIn.value, ed.style.fill?.t === 'solid' ? ed.style.fill.a : 1) }, 'fill') })
  const strokeIn = h('input', { type: 'color', 'aria-label': 'Stroke colour', oninput: () => ed.setStyle({ stroke: solid(strokeIn.value, ed.style.stroke?.t === 'solid' ? ed.style.stroke.a : 1) }, 'stroke') })
  const fillSw = h('span', { class: 'sw fill', 'data-tip': 'Fill colour', title: 'Fill colour' }, fillIn)
  const strokeSw = h('span', { class: 'sw stroke', 'data-tip': 'Stroke colour', title: 'Stroke colour' }, strokeIn)
  const fsBtns = h('div', { class: 'vs-fsb' },
    h('button', { type: 'button', 'data-tip': 'Default colours', 'aria-label': 'Default fill and stroke', onclick: () => ed.setStyle({ fill: DEFAULT_STYLE.fill, stroke: DEFAULT_STYLE.stroke, sw: 2 }, null) }, icon('rotate-ccw')),
    h('button', { type: 'button', 'data-tip': 'Swap fill and stroke', 'aria-label': 'Swap fill and stroke', onclick: () => ed.swapFillStroke() }, icon('arrow-left-right')))
  rail.append(h('div', { class: 'vs-fs' }, strokeSw, fillSw), fsBtns)

  const statusMsg = h('span', { class: 'grow' })
  const coords = h('span', { class: 'num hide-m' })
  const selInfo = h('span', { class: 'num hide-m' })
  const saved = h('span', { class: 'vs-saved', 'aria-live': 'polite' }, h('i'), h('span', 'Saved on this device'))
  const status = h('div', { class: 'vs-status' }, statusMsg, selInfo, coords, saved)
  const main = h('div', { class: 'vs-main' }, cv.root, status)
  const api = { toast: (m) => toast(m), boolean: (op) => ed.boolean(op).catch((e) => toast(errorMessage(e), 'error')), exportDialog: () => exportDialog(ed, fileName), open: () => openFiles(), save: () => saveProject() }
  const sidePanel = buildSide(ed, api)
  const side = h('aside', { class: 'vs-side', 'aria-label': 'Properties panels' }, sidePanel.el)
  const body = h('div', { class: 'vs-body' }, rail, main, side)
  const credit = h('div', { class: 'vs-credit' },
    h('span', 'Prefer a native app? ', h('a', { href: 'https://github.com/storytold/vectorcraft', target: '_blank', rel: 'noopener' }, 'VectorCraft by ArtCraft'), ' is free and open source.'),
    h('span', 'A clean-room browser editor. Your files never leave your device.'))
  const wrap = h('div', { class: 't-vs', 'aria-label': 'Vector Studio editor' }, bar, opts, body, credit)
  wrap.__vs = { ed, cv }
  // lets the site's page-wide file drop hand files to the editor (drops outside the canvas, e.g. on the panels)
  const dz = h('div', { class: 'dropzone', hidden: true, 'aria-hidden': 'true' })
  dz._accept = '.svg,.json,image/*'
  dz.addEventListener('drop', (e) => { e.preventDefault(); importFiles([...(e.dataTransfer?.files || [])]) })
  wrap.append(dz)
  root.append(wrap)

  // empty-state card
  const empty = h('div', { class: 'vs-empty-card' }, icon('pen-tool'),
    h('h3', params.start === 'import' ? 'Open an SVG to edit it' : 'Start drawing'),
    h('p', params.start === 'import' ? 'Drop an SVG here or choose a file. You can then edit points, colours and text, and export a clean SVG, PNG or PDF.' : 'Pick a tool on the left, drop an SVG or image here, or start from an example.'),
    h('div', { class: 'vs-row2', style: 'width:100%;gap:8px' },
      button('Open file', { icon: 'folder-open', variant: 'secondary', size: 'sm', onClick: () => openFiles() }),
      button('Load an example', { icon: 'sparkles', variant: 'primary', size: 'sm', onClick: () => loadTemplate('logo', 'Load example') })))
  cv.hint.append(empty)

  on(cv.root, 'pointerdown', () => side.classList.remove('open'))

  // ---------- tooltip ----------
  const tip = h('div', { class: 'vs-tip', role: 'tooltip' })
  document.body.append(tip)
  cleanups.push(() => tip.remove())
  if (matchMedia('(hover: hover)').matches) {
    const hide = () => tip.classList.remove('on')
    on(wrap, 'mouseover', (e) => {
      const el = e.target.closest?.('[data-tip]')
      if (!el) return hide()
      tip.replaceChildren(el.dataset.tip, ...(el.dataset.key ? [h('kbd', el.dataset.key)] : []))
      const r = el.getBoundingClientRect(), inRail = !!el.closest('.vs-rail') && getComputedStyle(rail).display === 'grid'
      tip.style.left = '0px'; tip.style.top = '0px'
      const tw = tip.offsetWidth
      tip.style.left = inRail ? `${r.right + 8}px` : `${Math.max(6, Math.min(innerWidth - tw - 6, r.left + r.width / 2 - tw / 2))}px`
      tip.style.top = inRail ? `${r.top + r.height / 2 - tip.offsetHeight / 2}px` : `${r.bottom + 8}px`
      tip.classList.add('on')
    })
    on(wrap, 'mouseleave', hide)
    on(wrap, 'pointerdown', hide)
  }

  // ---------- state to UI ----------
  function setStatus(msg, ms = 2400) {
    statusMsg.textContent = msg
    clearTimeout(setStatus.t)
    if (ms) setStatus.t = setTimeout(() => { statusMsg.textContent = HINT[ed.tool] || '' }, ms)
  }
  function renderOpts() {
    const t = ed.tool
    const nf = (labelText, get, set, o = {}) => {
      const i = h('input', { type: 'number', class: 'vs-num', min: o.min, max: o.max, step: o.step ?? 1, value: get(), 'aria-label': labelText, onchange: () => { const v = i.valueAsNumber; if (Number.isFinite(v)) set(Math.min(o.max ?? 1e9, Math.max(o.min ?? -1e9, v))); else i.value = get() } })
      return h('label', {}, labelText, i)
    }
    const items = [h('strong', TOOL_NAME[t])]
    if (t === 'rect') items.push(nf('Corner radius', () => ed.tp.radius, (v) => ed.setRadius(v), { min: 0, max: 1000 }))
    if (t === 'polygon') items.push(nf('Sides', () => ed.tp.sides, (v) => { ed.tp.sides = Math.round(v) }, { min: 3, max: 60 }))
    if (t === 'star') items.push(nf('Points', () => ed.tp.points, (v) => { ed.tp.points = Math.round(v) }, { min: 3, max: 60 }), nf('Inner radius %', () => Math.round(ed.tp.inner * 100), (v) => { ed.tp.inner = v / 100 }, { min: 5, max: 95 }))
    if (t === 'pencil') items.push(nf('Smoothing', () => ed.tp.smooth, (v) => { ed.tp.smooth = v }, { min: 0.5, max: 30, step: 0.5 }))
    if (t === 'text') {
      const ff = select(FONTS, ed.tp.ff, (v) => ed.setText({ ff: v })); ff.setAttribute('aria-label', 'Font family')
      const fw = select([[300, 'Light'], [400, 'Regular'], [600, 'Semibold'], [700, 'Bold'], [900, 'Black']], ed.tp.fw, (v) => ed.setText({ fw: +v })); fw.setAttribute('aria-label', 'Font weight')
      items.push(ff, nf('Size', () => ed.tp.fs, (v) => ed.setText({ fs: v }, 'fs'), { min: 1, max: 2000 }), fw)
    }
    opts.replaceChildren(...items)
    opts.classList.toggle('plain', items.length === 1)
  }
  const syncTool = () => {
    for (const [id, b] of railBtns) { b.classList.toggle('on', id === ed.tool); b.setAttribute('aria-pressed', String(id === ed.tool)) }
    renderOpts()
    statusMsg.textContent = HINT[ed.tool] || ''
  }
  const syncStyle = () => {
    const f = ed.style.fill, s = ed.style.stroke
    fillSw.style.background = swatchCss(f)
    strokeSw.style.borderColor = s?.t === 'solid' ? s.c : s ? 'var(--accent)' : 'var(--border-strong)'
    if (f?.t === 'solid') fillIn.value = f.c
    if (s?.t === 'solid') strokeIn.value = s.c
    strokeSw.style.background = s ? 'var(--surface)' : 'linear-gradient(135deg, transparent 44%, #e5484d 44% 56%, transparent 56%), var(--surface)'
  }
  const syncHist = () => {
    undoBtn.disabled = !ed.undoStack.length; redoBtn.disabled = !ed.redoStack.length
    undoBtn.dataset.tip = ed.undoLabel ? `Undo ${ed.undoLabel}` : 'Undo'
    redoBtn.dataset.tip = ed.redoLabel ? `Redo ${ed.redoLabel}` : 'Redo'
  }
  const syncView = () => {
    zoomBtn.textContent = `${Math.round(ed.view.z * 100)}%`
    gridBtn.classList.toggle('on', ed.grid.on); snapBtn.classList.toggle('on', ed.grid.snap)
  }
  const syncSel = () => {
    const b = ed.box()
    selInfo.textContent = b ? `${Math.round(b.w)} x ${Math.round(b.h)} px` : ''
  }
  const offs = [
    ed.on('tool', syncTool), ed.on('sel', () => { if (ed.tool === 'text') renderOpts() }), ed.on('style', syncStyle), ed.on('hist', syncHist), ed.on('view', syncView), ed.on('grid', syncView), ed.on('sel', syncSel), ed.on('doc', syncSel),
    ed.on('pointer', (p) => { coords.textContent = p ? `X ${Math.round(p.x)}  Y ${Math.round(p.y)}` : '' }),
    ed.on('status', (m) => setStatus(m, 1500)),
  ]
  cleanups.push(() => offs.forEach((o) => o()), () => sidePanel.destroy(), () => cv.destroy())
  cv.setTool(); syncTool(); syncStyle(); syncHist(); syncView(); syncSel()

  // ---------- history helpers ----------
  const doUndo = () => { if (cv.tool.undo?.()) return; const l = ed.undo(); if (l) setStatus(`Undid ${l.toLowerCase()}`) }
  const doRedo = () => { const l = ed.redo(); if (l) setStatus(`Redid ${l.toLowerCase()}`) }

  // ---------- autosave ----------
  let timer = 0, dirty = false
  const setSaved = (busy, text) => { saved.classList.toggle('busy', busy); saved.lastChild.textContent = text }
  async function save() {
    clearTimeout(timer)
    if (!dirty) return
    dirty = false
    const ok = await idb.set(KEY, { doc: ed.doc, grid: ed.grid, savedAt: Date.now() })
    setSaved(false, ok ? 'Saved on this device' : 'Not saved: browser storage is blocked')
  }
  const queueSave = () => { dirty = true; setSaved(true, 'Saving...'); clearTimeout(timer); timer = setTimeout(save, 700) }
  offs.push(ed.on('commit', queueSave))
  const flush = () => { if (dirty) save() }
  on(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
  on(window, 'pagehide', flush)
  cleanups.push(flush)

  // ---------- files ----------
  async function placeImage(file, at) {
    if (file.size > 25 * 1024 * 1024) throw new Error('That image is over 25 MB. Resize it first.')
    const img = await loadImage(file)
    let w = img.naturalWidth, hh = img.naturalHeight
    const k = Math.min(1, 2400 / Math.max(w, hh))
    const c = makeCanvas(w * k, hh * k)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    const jpeg = /jpe?g/.test(file.type)
    const href = c.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.9)
    const { ab } = ed.doc, fit = Math.min(1, (ab.w * 0.8) / w, (ab.h * 0.8) / hh)
    w *= fit; hh *= fit
    const cx = at ? at.x : ab.w / 2, cy = at ? at.y : ab.h / 2
    ed.tx('Place image', () => ed.add(mk(ed.doc, 'image', { x: cx - w / 2, y: cy - hh / 2, w, h: hh, href, name: baseName(file.name) })))
  }
  function importSvg(text, name, at) {
    const empty = !ed.doc.nodes.length
    const target = empty ? newDoc(1200, 800) : ed.doc
    const res = parseSvg(text, target)
    if (!res.nodes.length) throw new Error('Nothing could be imported from this SVG. It may only use clip paths, filters or other features Vector Studio skips.')
    const warn = res.warnings.length ? ` Skipped: ${res.warnings.join(', ')}.` : ''
    if (empty) {
      const box = bboxOfAll(res.nodes)
      if (!res.w || !res.h) { const pad = 24; target.ab.w = Math.max(1, Math.ceil(box.x + box.w + pad)); target.ab.h = Math.max(1, Math.ceil(box.y + box.h + pad)) } else { target.ab.w = Math.round(res.w); target.ab.h = Math.round(res.h) }
      target.nodes = res.nodes
      ed.loadDoc(target, 'Open SVG')
      ed.fit()
      fileName = baseName(name)
    } else {
      const group = mk(ed.doc, 'group', { kids: res.nodes, name: baseName(name) })
      const b = bboxOf(group), { ab } = ed.doc
      ed.tx('Import SVG', () => {
        const fit = Math.min(1, (ab.w * 0.9) / (b.w || 1), (ab.h * 0.9) / (b.h || 1))
        const cx = at ? at.x : ab.w / 2, cy = at ? at.y : ab.h / 2
        applyMatrix(group, about(sc(fit), b.x, b.y))
        const nb = bboxOf(group)
        applyMatrix(group, tr(cx - (nb.x + nb.w / 2), cy - (nb.y + nb.h / 2)))
        ed.add(group)
      })
    }
    toast(`Imported ${baseName(name)}.${warn}`, warn ? 'info' : 'success')
  }
  async function importFiles(files, at) {
    for (const f of files) {
      try {
        const ext = (f.name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase()
        if (ext === 'svg' || f.type === 'image/svg+xml') {
          if (f.size > 12 * 1024 * 1024) throw new Error('That SVG is over 12 MB, which is too large to edit comfortably here.')
          importSvg(await f.text(), f.name, at)
        } else if (ext === 'json') {
          const d = await readProject(f)
          ed.loadDoc(d, 'Open project'); ed.fit(); fileName = baseName(f.name).replace(/\.vstudio$/, '')
          toast(`Opened ${f.name}`, 'success')
        } else if (/^image\//.test(f.type) || /^(png|jpe?g|webp|gif|avif|bmp|heic|heif)$/.test(ext)) await placeImage(f, at)
        else toast(`${f.name}: unsupported file. Use SVG, PNG, JPG, WebP, GIF or a Vector Studio project.`, 'error')
      } catch (e) { toast(errorMessage(e), 'error') }
    }
  }
  cv.onFiles = importFiles
  async function openFiles() { const files = await pickFiles({ accept: '.svg,image/*,.json,application/json', multiple: true }); if (files.length) importFiles(files) }
  function saveProject() {
    download(projectBlob(ed.doc), `${fileName}.vstudio.json`)
    toast('Project saved as a file. Your work is also kept in this browser automatically.', 'success')
  }
  function loadTemplate(name, label) {
    const t = TEMPLATES[name]()
    ed.loadDoc(t.doc, label)
    if (t.grid) Object.assign(ed.grid, t.grid)
    ed.emit('grid'); ed.emit('view')
    ed.fit()
  }
  // paste: images, SVG text, or our own copied objects
  const MARK = '<!--vector-studio-->'
  on(document, 'paste', async (e) => {
    if (!wrap.isConnected || isTyping(e.target) || document.querySelector('dialog[open]')) return
    const files = [...(e.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type))
    const text = e.clipboardData?.getData('text/plain') || ''
    if (text.includes(MARK) && ed.clip) { e.preventDefault(); ed.paste(); return }
    if (/^\s*(<\?xml|<svg)/i.test(text)) { e.preventDefault(); try { importSvg(text, 'Pasted SVG') } catch (err) { toast(errorMessage(err), 'error') } return }
    if (files.length) { e.preventDefault(); importFiles(files); return }
    if (ed.clip) { e.preventDefault(); ed.paste() }
  })
  const clipOut = () => {
    if (!ed.copy()) return
    try { navigator.clipboard?.writeText(MARK + exportSvg({ ...ed.doc, nodes: ed.top }, { transparent: true })).catch(() => {}) } catch { /* clipboard blocked */ }
  }

  // ---------- keyboard ----------
  on(document, 'keydown', (e) => {
    if (!wrap.isConnected || e.defaultPrevented) return
    const t = e.target
    if (isTyping(t) || document.querySelector('dialog[open]') || cv.editing) return
    if (t !== document.body && !wrap.contains(t) && !t.closest?.('main')) return
    const k = e.key, ctrl = e.ctrlKey || e.metaKey, sh = e.shiftKey, lk = k.toLowerCase()
    const stop = () => { e.preventDefault(); e.stopPropagation() }
    if (cv.tool.key?.(e)) { stop(); return }
    if (k === ' ') { if (t.closest?.('button, a, summary, select, [role="tab"], [role="treeitem"]')) return; if (!cv.space) { cv.space = true; cv.updateCursor() } stop(); return }
    if (ctrl) {
      if (lk === 'z') { stop(); sh ? doRedo() : doUndo() } else if (lk === 'y') { stop(); doRedo() }
      else if (lk === 'a') { stop(); ed.selectAll() }
      else if (lk === 'c') { if (ed.sel.length) { clipOut(); setStatus('Copied') } }
      else if (lk === 'x') { if (ed.sel.length) { clipOut(); ed.deleteSelection() } }
      else if (lk === 'v') { if (sh) { stop(); ed.paste(true) } /* plain Ctrl+V is handled by the paste event */ }
      else if (lk === 'd') { stop(); ed.duplicate() }
      else if (lk === 'g') { stop(); sh ? ed.ungroup() : ed.group() }
      else if (k === ']' || k === '}') { stop(); ed.order(sh ? 'front' : 'forward') }
      else if (k === '[' || k === '{') { stop(); ed.order(sh ? 'back' : 'backward') }
      else if (k === '0') { stop(); ed.fit() }
      else if (k === '1') { stop(); ed.zoomTo(1) }
      else if (k === '+' || k === '=') { stop(); ed.zoomAt(1.25) }
      else if (k === '-' || k === '_') { stop(); ed.zoomAt(1 / 1.25) }
      else if (lk === 's') { stop(); saveProject() }
      else if (lk === 'o') { stop(); openFiles() }
      else if (lk === 'e') { stop(); exportDialog(ed, fileName) }
      else if (k === "'") { stop(); ed.grid.on = !ed.grid.on; ed.emit('view'); ed.emit('grid') }
      return
    }
    if (e.altKey) return
    if (k === 'Delete' || k === 'Backspace') { stop(); ed.anchors.size ? ed.deleteAnchors() : ed.deleteSelection() }
    else if (k.startsWith('Arrow')) { if (!ed.sel.length) return; stop(); const d = sh ? 10 : 1; ed.nudge(k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0, k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0) }
    else if (k === 'Escape') { if (ed.ctx) { ed.ctx = null; ed.clearSel(); cv.scheduleOv() } else if (ed.anchors.size) { ed.anchors.clear(); ed.emit('sel') } else ed.clearSel() }
    else if (k === 'Enter') { const n = ed.nodes; if (n.length === 1 && n[0].type === 'text') { stop(); cv.editText(n[0]) } }
    else if (lk === 'x' && !sh) { stop(); ed.swapFillStroke() }
    else if (lk === 'd' && !sh) { stop(); ed.setStyle({ fill: DEFAULT_STYLE.fill, stroke: DEFAULT_STYLE.stroke, sw: 2 }, null) }
    else if (k === '\\' || (KEYMAP[lk] && !sh) || (lk === 's' && sh)) { stop(); ed.setTool(k === '\\' ? 'line' : KEYMAP[lk]) }
  })
  on(document, 'keyup', (e) => { if (e.key === ' ' && cv.space) { cv.space = false; cv.updateCursor() } })
  on(window, 'blur', () => { cv.space = false })

  // ---------- start ----------
  const saved0 = await idb.get(KEY)
  if (signal?.aborted) return () => cleanups.forEach((fn) => { try { fn() } catch { /* ignore */ } })
  let restored = false
  if (saved0?.doc?.nodes) {
    try { ed.resetDoc(cleanDoc(saved0.doc)); if (saved0.grid) Object.assign(ed.grid, { on: !!saved0.grid.on, size: +saved0.grid.size || 20, snap: !!saved0.grid.snap }); restored = true } catch { /* ignore a corrupt autosave */ }
  }
  if (!restored && params.template && TEMPLATES[params.template]) {
    const t = TEMPLATES[params.template]()
    ed.resetDoc(t.doc)
    if (t.grid) Object.assign(ed.grid, t.grid)
  }
  ed.emit('grid'); ed.emit('view')
  requestAnimationFrame(() => { cv.resize(); ed.fit(); cv.render() })
  if (restored && ed.doc.nodes.length) setStatus('Restored your last session', 3000)
  setSaved(false, 'Saved on this device')
  dirty = false

  return () => { for (const fn of cleanups.reverse()) { try { fn() } catch { /* ignore */ } } }
}

