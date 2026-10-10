// CorelDRAW (CDR) viewer and editor. Opens .cdr and .cdt files in the browser with a reader written from the public format description,
// shows every page, layers and objects, edits fill, outline, position and deletion with undo, and saves SVG, EPS, AI, PDF or PNG.
// When a file cannot be read, it shows the preview image stored inside the file and offers to trace it into vectors.
import { h, dropzone, button, busy, alert, field, select, toggle, segmented, number, progress, downloadButton, download, formatBytes, icon, toast, errorMessage, openToolWith, onCleanup, yieldToMain } from '../../lib/ui.js'
import { loadImage, canvas as mkCanvas, toBlob, MAX_PIXELS } from '../../lib/image.js'
import { jszip } from '../../lib/libs.js'
import { baseName, zip } from '../../lib/files.js'
import { MM, docStats } from './_model.js'
import { readCdr } from './_cdr.js'
import { buildDoc, pageModel, toModelDoc, boundsById, leaves, topOf, nodeLabel } from './_cdrdoc.js'
import { pageToSvg } from './_svgout.js'
import { epsBlob } from './_eps.js'
import { toPdf } from './_pdfout.js'
import { outlineDoc } from './_text.js'
import { traceImage, PRESETS } from './_trace.js'

const FORMATS = { svg: 'SVG (Corel-friendly)', eps: 'EPS', ai: 'AI (PDF-compatible)', pdf: 'PDF', png: 'PNG image' }
const EXT = { svg: 'svg', eps: 'eps', ai: 'ai', pdf: 'pdf', png: 'png' }
const CSS = `
.t-cd [hidden] { display:none !important; }
.t-cd { display:flex; flex-direction:column; gap:14px; }
.t-cd .cd-app { display:grid; grid-template-columns:248px minmax(0,1fr) 300px; grid-template-rows:auto minmax(0,1fr); height:max(560px, calc(100dvh - var(--header-h) - 190px)); border:1px solid var(--border); border-radius:var(--radius-lg); overflow:hidden; background:var(--surface); box-shadow:var(--shadow); }
.t-cd .cd-bar { grid-column:1 / -1; display:flex; align-items:center; gap:6px; padding:7px 10px; border-bottom:1px solid var(--border); background:var(--glass); overflow-x:auto; scrollbar-width:none; }
.t-cd .cd-bar::-webkit-scrollbar { display:none; }
.t-cd .cd-bar .sep { width:1px; height:20px; background:var(--border); margin:0 4px; flex:none; }
.t-cd .cd-bar .btn { flex:none; }
.t-cd .cd-bar .grow { flex:1; min-width:6px; }
.t-cd .cd-zoom { min-width:56px; justify-content:center; font-variant-numeric:tabular-nums; }
.t-cd .cd-side { min-width:0; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:14px; }
.t-cd .cd-left { border-right:1px solid var(--border); }
.t-cd .cd-right { border-left:1px solid var(--border); }
.t-cd .cd-side h3 { font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:0 0 8px; display:flex; align-items:center; gap:6px; }
.t-cd .cd-stage { position:relative; min-width:0; min-height:0; overflow:auto; background-color:color-mix(in srgb, var(--surface-3) 55%, var(--bg-2)); background-image:radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--text) 9%, transparent) 1px, transparent 0); background-size:22px 22px; touch-action:pan-x pan-y pinch-zoom; outline:none; }
.t-cd .cd-stage:focus-visible { box-shadow:inset 0 0 0 2px var(--accent); }
.t-cd .cd-pad { display:grid; place-items:center; min-width:100%; min-height:100%; padding:24px; width:max-content; box-sizing:border-box; }
.t-cd .cd-paper { position:relative; background:#fff; box-shadow:0 10px 30px rgba(10,10,30,.28); line-height:0; }
.t-cd .cd-paper svg { display:block; }
.t-cd .cd-ov { position:absolute; inset:0; pointer-events:none; }
.t-cd .cd-ov .box { fill:rgba(99,102,241,.07); stroke:var(--accent); stroke-width:1.5; vector-effect:non-scaling-stroke; stroke-dasharray:5 3; }
.t-cd .cd-empty { display:grid; place-items:center; height:100%; padding:20px; text-align:center; color:var(--muted); }
.t-cd .cd-pages { display:grid; grid-template-columns:repeat(auto-fill, minmax(92px, 1fr)); gap:8px; }
.t-cd .cd-pg { border:1px solid var(--border); background:var(--surface); border-radius:10px; padding:6px; cursor:pointer; text-align:center; font-size:12px; color:var(--text-2); display:flex; flex-direction:column; gap:4px; align-items:center; }
.t-cd .cd-pg:hover { border-color:var(--border-strong); }
.t-cd .cd-pg[aria-current="true"] { border-color:var(--accent); box-shadow:0 0 0 2px var(--accent-soft); color:var(--text); }
.t-cd .cd-pg img { max-width:100%; max-height:84px; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.2); }
.t-cd .cd-tree { display:flex; flex-direction:column; gap:1px; font-size:13px; }
.t-cd .cd-row { display:flex; align-items:center; gap:4px; min-height:30px; padding:0 4px; border-radius:8px; cursor:pointer; }
.t-cd .cd-row:hover { background:var(--surface-2); }
.t-cd .cd-row[aria-selected="true"] { background:var(--accent-soft); color:var(--accent); }
.t-cd .cd-row .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.t-cd .cd-row .eye { width:28px; height:28px; display:grid; place-items:center; border:0; background:transparent; border-radius:7px; cursor:pointer; color:var(--muted); flex:none; }
.t-cd .cd-row .eye:hover { background:var(--surface-3); color:var(--text); }
.t-cd .cd-row .eye .icon { width:15px; height:15px; }
.t-cd .cd-row .kind { color:var(--muted); font-size:11px; flex:none; }
.t-cd .cd-layer { font-weight:600; }
.t-cd .cd-dim { opacity:.45; }
.t-cd .cd-kv { display:grid; grid-template-columns:auto 1fr; gap:4px 10px; font-size:13px; }
.t-cd .cd-kv dt { color:var(--muted); }
.t-cd .cd-kv dd { margin:0; overflow-wrap:anywhere; }
.t-cd .cd-col { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.t-cd .cd-col input[type=color] { width:38px; height:32px; padding:0; border:1px solid var(--border); border-radius:8px; background:transparent; cursor:pointer; }
.t-cd .cd-xy { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.t-cd .cd-tabs { display:none; }
.t-cd .cd-note { font-size:12.5px; color:var(--text-2); }
.t-cd .cd-fallback { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:16px; align-items:start; }
.t-cd .cd-fallback .preview img { max-height:420px; }
.t-cd ul.cd-list { margin:6px 0 0; padding-left:18px; font-size:13px; }
@media (max-width: 980px) {
  .t-cd .cd-app { grid-template-columns:minmax(0,1fr); grid-template-rows:auto 56vh auto auto auto; height:auto; }
  .t-cd .cd-stage { min-height:320px; order:1; }
  .t-cd .cd-side { border:0; max-height:none; padding:0; order:3; overflow:visible; }
  .t-cd .cd-panel { padding:12px; }
  .t-cd .cd-tabs { display:flex; grid-column:1 / -1; padding:8px; border-top:1px solid var(--border); order:2; }
  .t-cd .cd-tabs .seg { width:100%; }
  .t-cd .cd-tabs .seg button { flex:1; padding:0 6px; }
  .t-cd .cd-panel { display:none; }
  .t-cd[data-tab="pages"] .p-pages, .t-cd[data-tab="layers"] .p-layers, .t-cd[data-tab="inspect"] .p-inspect, .t-cd[data-tab="export"] .p-export { display:block; }
  .t-cd .cd-fallback { grid-template-columns:minmax(0,1fr); }
  .t-cd .cd-hide-m { display:none; }
  .t-cd .cd-bar { flex-wrap:wrap; overflow:visible; }
}
@media (prefers-reduced-motion: reduce) { .t-cd * { transition:none !important; } }
`
let styled = false
const injectCss = () => { if (styled) return; styled = true; document.head.append(h('style', { 'data-corel-cd': '' }, CSS)) }

const KIND = { rect: 'Rectangle', ellipse: 'Ellipse', path: 'Curve', text: 'Text', bitmap: 'Bitmap', group: 'Group', unknown: 'Object' }
const mm1 = (pt) => (pt / MM).toFixed(1)
const bitmapCache = new WeakMap()
function bitmapHref(bmp) {
  if (bitmapCache.has(bmp)) return bitmapCache.get(bmp)
  const c = document.createElement('canvas')
  c.width = bmp.w; c.height = bmp.h
  c.getContext('2d').putImageData(new ImageData(bmp.rgba, bmp.w, bmp.h), 0, 0)
  const url = c.toDataURL('image/png')
  bitmapCache.set(bmp, url)
  return url
}
const blobUrl = (data, type) => URL.createObjectURL(new Blob([data], { type }))

/** Render a page SVG string to a PNG blob at `px` pixels wide. */
async function svgToPng(svg, w, hgt, px) {
  const url = blobUrl(svg, 'image/svg+xml')
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const k = Math.min(1, Math.sqrt(MAX_PIXELS / (px * (px * hgt / w))))
    const cw = Math.max(1, Math.round(px * k)), ch = Math.max(1, Math.round(((px * k) * hgt) / w))
    const c = mkCanvas(cw, ch)
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch)
    ctx.drawImage(img, 0, 0, cw, ch)
    return { blob: await toBlob(c, 'image/png'), shrunk: k < 1 }
  } finally { URL.revokeObjectURL(url) }
}

export function mount(root, { params }) {
  injectCss()
  const urls = []
  const track = (u) => { urls.push(u); return u }
  onCleanup(() => urls.forEach((u) => URL.revokeObjectURL(u)))
  const S = { cdr: null, doc: null, file: null, pageIdx: 0, zoom: 1, fit: true, sel: null, undo: [], redo: [], model: null, bounds: new Map(), fmt: params.to || 'svg', scope: 'page', dpi: 150, outline: true, traced: null, tab: 'pages', expanded: new Set(), more: new Map() }

  const wrap = h('div', { class: 't-cd', 'data-tab': S.tab })
  const intro = h('div', { class: 'stack' })
  const dz = dropzone({ accept: '.cdr,.cdt', onFiles: ([f]) => openFile(f), label: 'Drop a .cdr file here or click to browse', hint: 'CorelDRAW 7 to X3, X4 and newer. Your file never leaves this device.' })
  const app = h('div', { class: 'cd-app', hidden: true })
  const fallback = h('div', { class: 'stack', hidden: true })
  const exportResult = h('div', { class: 'stack' })
  root.append(wrap)
  wrap.append(dz, intro, app, fallback)

  // ---------- toolbar ----------
  const nameEl = h('span', { class: 'small cd-hide-m', style: 'font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', title: '' })
  const pageSel = h('select', { class: 'select', 'aria-label': 'Page', style: 'height:32px;min-height:32px;max-width:160px;min-width:104px;flex:none', onchange: (e) => gotoPage(+e.target.value) })
  const tb = (label, ic, fn, opts = {}) => button(label, { icon: ic, variant: opts.variant || 'ghost', size: 'sm', onClick: fn, ariaLabel: opts.aria || label, title: opts.title, disabled: opts.disabled })
  const prevB = tb('', 'chevron-left', () => gotoPage(S.pageIdx - 1), { aria: 'Previous page' })
  const nextB = tb('', 'chevron-right', () => gotoPage(S.pageIdx + 1), { aria: 'Next page' })
  const zoomOut = tb('', 'zoom-out', () => setZoom(S.zoom / 1.25), { aria: 'Zoom out', title: 'Zoom out (-)' })
  const zoomIn = tb('', 'zoom-in', () => setZoom(S.zoom * 1.25), { aria: 'Zoom in', title: 'Zoom in (+)' })
  const zoomLbl = button('100%', { variant: 'ghost', size: 'sm', onClick: () => fitPage(), title: 'Fit page (Ctrl+0)', ariaLabel: 'Fit page to window' })
  zoomLbl.classList.add('cd-zoom')
  const undoB = tb('', 'undo-2', () => undo(), { aria: 'Undo', title: 'Undo (Ctrl+Z)' })
  const redoB = tb('', 'redo-2', () => redo(), { aria: 'Redo', title: 'Redo (Ctrl+Y)' })
  const delB = tb('Delete', 'trash-2', () => deleteSel(), { aria: 'Delete selected object', title: 'Delete (Del)' })
  const vsB = tb('Edit in Vector Studio', 'pen-tool', () => editInVectorStudio(), { variant: 'secondary', aria: 'Edit in Vector Studio', title: 'Open this page in Vector Studio for full vector editing' })
  const openB = tb('Open', 'folder-open', () => dz.open(), { aria: 'Open another CDR file' })
  const bar = h('div', { class: 'cd-bar' }, openB, nameEl, h('span', { class: 'sep' }), prevB, pageSel, nextB, h('span', { class: 'sep' }), zoomOut, zoomLbl, zoomIn, h('span', { class: 'sep cd-hide-m' }), undoB, redoB, delB, h('span', { class: 'grow' }), vsB)

  // ---------- stage ----------
  const paper = h('div', { class: 'cd-paper' })
  const ov = h('svg', { class: 'cd-ov', 'aria-hidden': 'true' })
  paper.append(ov)
  const pad = h('div', { class: 'cd-pad' }, paper)
  const stage = h('div', { class: 'cd-stage', tabindex: 0, role: 'application', 'aria-label': 'Drawing canvas. Arrow keys move the selected object.' }, pad)

  // ---------- side panels ----------
  const pagesBox = h('div', { class: 'cd-pages' })
  const layersBox = h('div', { class: 'cd-tree', role: 'tree', 'aria-label': 'Layers and objects' })
  const inspectBox = h('div', { class: 'stack' })
  const notesBox = h('div', { class: 'stack' })
  const left = h('div', { class: 'cd-side cd-left' }, h('section', { class: 'cd-panel p-pages' }, h('h3', icon('files'), 'Pages'), pagesBox), h('section', { class: 'cd-panel p-layers' }, h('h3', icon('layers'), 'Layers and objects'), layersBox))
  // export controls
  const fmtSel = select(Object.entries(FORMATS), S.fmt, (v) => { S.fmt = v; refreshExport() })
  const scopeSeg = segmented([['page', 'This page'], ['all', 'All pages']], S.scope, (v) => { S.scope = v }, 'Pages to export')
  const dpiSel = select([[96, '96 dpi (screen)'], [150, '150 dpi'], [300, '300 dpi (print)']], S.dpi, (v) => { S.dpi = +v })
  const outlineT = toggle('Convert text to outlines', true, (c) => { S.outline = c })
  const dpiField = field('PNG resolution', dpiSel)
  const prog = progress('Exporting')
  const exportBtn = button('Export', { icon: 'download', variant: 'primary', block: true, onClick: () => busy(exportBtn, doExport, { label: 'Exporting', errorTo: exportResult, progress: prog }) })
  const exportBox = h('section', { class: 'cd-panel p-export stack' }, h('h3', icon('file-output'), 'Save as'), field('Format', fmtSel), scopeSeg, dpiField, outlineT,
    h('p', { class: 'cd-note', style: 'margin:0' }, 'EPS, AI, PDF and SVG open in CorelDRAW with File > Open; then File > Save As > CDR.'), exportBtn, prog.el, exportResult)
  const right = h('div', { class: 'cd-side cd-right' }, h('section', { class: 'cd-panel p-inspect' }, h('h3', icon('sliders-horizontal'), 'Selected object'), inspectBox, notesBox), exportBox)
  const tabs = h('div', { class: 'cd-tabs' }, segmented([['pages', 'Pages'], ['layers', 'Layers'], ['inspect', 'Object'], ['export', 'Save']], S.tab, (v) => { S.tab = v; wrap.dataset.tab = v }, 'Panels'))
  app.append(bar, left, stage, right, tabs)

  function refreshExport() {
    dpiField.hidden = S.fmt !== 'png'
    outlineT.hidden = !(S.fmt === 'eps' || S.fmt === 'ai' || S.fmt === 'pdf')
    scopeSeg.parentElement.hidden = false
    const multi = S.traced ? false : S.doc?.pages.filter((p) => !p.master).length > 1
    scopeSeg.hidden = !multi
  }

  // ---------- state helpers ----------
  const page = () => S.doc.pages[S.pageIdx]
  const selNode = () => (S.sel != null ? S.doc?.index.get(S.sel) : null)
  const leafIds = (n) => (n.children ? [...leaves(n.children)].map((x) => x.id) : [n.id])

  // ---------- rendering ----------
  function render() {
    if (S.traced) return renderTraced()
    const pg = page()
    S.model = pageModel(pg, { bitmapHref })
    S.bounds = boundsById(S.doc, S.model)
    const svg = pageToSvg(S.model.page, { unit: 'pt', ids: true, background: '#ffffff' })
    paper.querySelector('svg:not(.cd-ov)')?.remove()
    paper.insertAdjacentHTML('afterbegin', svg)
    applyZoom()
    drawOverlay()
    drawInspector()
    drawLayers()
    refreshHistoryButtons()
    pageSel.value = S.pageIdx
    prevB.disabled = S.pageIdx <= 0
    nextB.disabled = S.pageIdx >= S.doc.pages.length - 1
    renderNotes()
  }
  function renderTraced() {
    paper.querySelector('svg:not(.cd-ov)')?.remove()
    paper.insertAdjacentHTML('afterbegin', pageToSvg(S.traced.doc.pages[0], { unit: 'pt', background: '#ffffff' }))
    S.model = { page: S.traced.doc.pages[0], origin: 'traced', warnings: [] }
    applyZoom(); ov.replaceChildren()
  }
  function applyZoom() {
    const p = S.model.page
    const svg = paper.querySelector('svg:not(.cd-ov)')
    if (!svg) return
    const w = p.w * S.zoom, hh = p.h * S.zoom
    svg.setAttribute('width', w); svg.setAttribute('height', hh)
    ov.setAttribute('viewBox', `0 0 ${p.w} ${p.h}`); ov.setAttribute('width', w); ov.setAttribute('height', hh)
    zoomLbl.firstChild && (zoomLbl.querySelector('span').textContent = `${Math.round((S.zoom * 72) / 96 * 100)}%`)
  }
  function fitPage() {
    if (!S.model) return
    const p = S.model.page
    const r = stage.getBoundingClientRect()
    if (!r.width) return
    S.fit = true
    S.zoom = Math.max(0.05, Math.min((r.width - 48) / p.w, (r.height - 48) / p.h, 8))
    applyZoom()
  }
  function setZoom(z) {
    S.fit = false
    const before = { x: stage.scrollLeft + stage.clientWidth / 2, y: stage.scrollTop + stage.clientHeight / 2, z: S.zoom }
    S.zoom = Math.min(16, Math.max(0.05, z))
    applyZoom()
    const k = S.zoom / before.z
    stage.scrollLeft = before.x * k - stage.clientWidth / 2
    stage.scrollTop = before.y * k - stage.clientHeight / 2
  }
  function drawOverlay() {
    ov.replaceChildren()
    const b = S.sel != null ? S.bounds.get(S.sel) : null
    if (!b) return
    ov.append(h('rect', { class: 'box', x: b.x, y: b.y, width: b.w, height: b.h }))
  }
  function gotoPage(i) {
    if (!S.doc || i < 0 || i >= S.doc.pages.length) return
    S.pageIdx = i; S.sel = null
    render(); fitPage(); drawOverlay()
    stage.scrollTo(0, 0)
  }

  // ---------- selection and dragging ----------
  function selectNode(id) {
    S.sel = id
    drawOverlay(); drawInspector(); drawLayers()
  }
  const idFrom = (el) => { const e = el?.closest?.('[data-id]'); return e ? +e.dataset.id : null }
  let drag = null
  stage.addEventListener('pointerdown', (e) => {
    if (S.traced || e.button > 1) return
    const id = idFrom(e.target)
    const pan = id == null || e.button === 1
    if (!pan) {
      const n = S.doc.index.get(id)
      const target = e.detail > 1 ? n : topOf(n)
      selectNode(target.id)
      if (e.pointerType === 'mouse') drag = { kind: 'move', x: e.clientX, y: e.clientY, node: target, moved: false }
    } else {
      if (e.button === 0 && e.pointerType === 'mouse') { drag = { kind: 'pan', x: e.clientX, y: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop, moved: false } }
      if (id == null) selectNode(null)
    }
    if (drag) { stage.setPointerCapture?.(e.pointerId); stage.style.cursor = drag.kind === 'pan' ? 'grabbing' : 'move' }
  })
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y
    if (!drag.moved && Math.hypot(dx, dy) < 3) return
    drag.moved = true
    if (drag.kind === 'pan') { stage.scrollLeft = drag.sl - dx; stage.scrollTop = drag.st - dy; return }
    const b = S.bounds.get(drag.node.id)
    if (b) { ov.replaceChildren(h('rect', { class: 'box', x: b.x + dx / S.zoom, y: b.y + dy / S.zoom, width: b.w, height: b.h })) }
  })
  const endDrag = (e) => {
    if (!drag) return
    const d = drag
    drag = null
    stage.style.cursor = ''
    if (d.kind === 'move' && d.moved) moveNode(d.node, (e.clientX - d.x) / S.zoom, (e.clientY - d.y) / S.zoom)
    else drawOverlay()
  }
  stage.addEventListener('pointerup', endDrag)
  stage.addEventListener('pointercancel', () => { drag = null; drawOverlay() })
  stage.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    const r = stage.getBoundingClientRect()
    const px = e.clientX - r.left + stage.scrollLeft, py = e.clientY - r.top + stage.scrollTop, z0 = S.zoom
    S.fit = false
    S.zoom = Math.min(16, Math.max(0.05, S.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
    applyZoom()
    const k = S.zoom / z0
    stage.scrollLeft = px * k - (e.clientX - r.left); stage.scrollTop = py * k - (e.clientY - r.top)
  }, { passive: false })
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (S.fit && S.model) fitPage() }) : null
  ro?.observe(stage)
  onCleanup(() => ro?.disconnect())
  stage.addEventListener('keydown', (e) => {
    if (!S.doc) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo() }
    else if (mod && e.key === '0') { e.preventDefault(); fitPage() }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(S.zoom * 1.25) }
    else if (e.key === '-') { e.preventDefault(); setZoom(S.zoom / 1.25) }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel() }
    else if (e.key === 'Escape') selectNode(null)
    else if (e.key.startsWith('Arrow') && selNode()) {
      e.preventDefault()
      const step = (e.shiftKey ? 10 : 1) / S.zoom
      moveNode(selNode(), e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0)
    }
  })

  // ---------- editing with undo ----------
  const snap = (l) => ({ fill: l.fill, line: l.line, dx: l.dx, dy: l.dy, deleted: l.deleted })
  function edit(label, leafList, mutate) {
    const before = leafList.map(snap)
    leafList.forEach(mutate)
    const after = leafList.map(snap)
    S.undo.push({ label, leaves: leafList, before, after })
    S.redo = []
    render()
  }
  const leavesOf = (n) => (n.children ? [...leaves(n.children)] : [n])
  function undo() { const op = S.undo.pop(); if (!op) return; op.leaves.forEach((l, i) => Object.assign(l, op.before[i])); S.redo.push(op); render(); toast(`Undid: ${op.label}`) }
  function redo() { const op = S.redo.pop(); if (!op) return; op.leaves.forEach((l, i) => Object.assign(l, op.after[i])); S.undo.push(op); render() }
  function refreshHistoryButtons() { undoB.disabled = !S.undo.length; redoB.disabled = !S.redo.length; delB.disabled = !selNode() }
  function moveNode(n, dxPt, dyPt) {
    if (!dxPt && !dyPt) return
    edit('Move', leavesOf(n), (l) => { l.dx += dxPt / 72; l.dy -= dyPt / 72 })
  }
  function deleteSel() {
    const n = selNode()
    if (!n) return
    S.sel = null
    edit('Delete', leavesOf(n), (l) => { l.deleted = true })
  }
  const solidFill = (color) => ({ type: 'solid', color })
  const lineWith = (old, patch) => ({ width: 0.0139, cap: 0, join: 0, dash: null, color: '#000000', ...(old || {}), none: false, ...patch })
  function setFill(n, color) { edit('Fill colour', leavesOf(n).filter((l) => l.kind !== 'unknown' && l.kind !== 'bitmap'), (l) => { l.fill = color ? solidFill(color) : { type: 'none' } }) }
  function setLine(n, patch) { edit('Outline', leavesOf(n).filter((l) => l.kind !== 'unknown' && l.kind !== 'bitmap' && l.kind !== 'text'), (l) => { l.line = patch.none ? lineWith(l.line, { none: true }) : lineWith(l.line, patch) }) }

  // ---------- panels ----------
  const eyeBtn = (on, label, fn) => h('button', { class: 'eye', type: 'button', 'aria-label': label, 'aria-pressed': String(on), onclick: (e) => { e.stopPropagation(); fn() } }, icon(on ? 'eye' : 'eye-off'))
  function drawLayers() {
    const pg = page()
    layersBox.replaceChildren()
    pg.layers.forEach((layer, li) => {
      const count = [...leaves(layer.objects)].filter((o) => !o.deleted).length
      layersBox.append(h('div', { class: ['cd-row', 'cd-layer', !layer.visible && 'cd-dim'], role: 'treeitem' },
        eyeBtn(layer.visible, `${layer.visible ? 'Hide' : 'Show'} layer ${layer.name}`, () => { layer.visible = !layer.visible; render() }),
        icon('layers'), h('span', { class: 'nm', title: layer.name }, layer.name), h('span', { class: 'kind' }, count)))
      const key = `${S.pageIdx}:${li}`
      const limit = S.more.get(key) || 120
      let shown = 0
      const addNodes = (nodes, depth) => {
        for (const n of nodes) {
          if (n.deleted) continue
          if (shown >= limit) return
          shown++
          layersBox.append(h('div', { class: ['cd-row', (!n.visible || !layer.visible) && 'cd-dim'], role: 'treeitem', 'aria-selected': String(S.sel === n.id), style: `padding-left:${8 + depth * 14}px`, onclick: () => selectNode(n.id) },
            eyeBtn(n.visible, `${n.visible ? 'Hide' : 'Show'} ${nodeLabel(n)}`, () => { n.visible = !n.visible; render() }),
            icon(n.kind === 'group' ? 'group' : n.kind === 'text' ? 'type' : n.kind === 'bitmap' ? 'image' : n.kind === 'ellipse' ? 'circle' : n.kind === 'rect' ? 'square' : 'spline'),
            h('span', { class: 'nm', title: nodeLabel(n) }, nodeLabel(n)), h('span', { class: 'kind' }, n.name ? KIND[n.kind] || '' : '')))
          if (n.children) addNodes(n.children, depth + 1)
        }
      }
      addNodes(layer.objects, 1)
      if (shown >= limit && [...leaves(layer.objects)].length > shown) layersBox.append(button('Show more', { size: 'sm', variant: 'ghost', onClick: () => { S.more.set(key, limit + 200); drawLayers() } }))
    })
  }
  function drawPages() {
    pagesBox.replaceChildren()
    S.doc.pages.slice(0, 60).forEach((pg, i) => {
      let url = ''
      try { const r = pageModel(pg, { bitmapHref }); url = track(blobUrl(pageToSvg(r.page, { unit: 'pt', background: '#ffffff' }), 'image/svg+xml')) } catch { /* no thumbnail */ }
      pagesBox.append(h('button', { type: 'button', class: 'cd-pg', 'aria-current': String(i === S.pageIdx), onclick: () => gotoPage(i), 'aria-label': `Page ${i + 1}: ${pg.name}` },
        url ? h('img', { src: url, alt: '' }) : null, h('span', pg.name)))
    })
    if (S.doc.pages.length > 60) pagesBox.append(h('div', { class: 'small muted' }, `${S.doc.pages.length - 60} more pages in the page list above`))
  }
  function refreshPagesCurrent() { [...pagesBox.children].forEach((b, i) => b.setAttribute?.('aria-current', String(i === S.pageIdx))) }
  function drawInspector() {
    inspectBox.replaceChildren()
    const n = selNode()
    refreshHistoryButtons()
    refreshPagesCurrent()
    if (!n) { inspectBox.append(h('p', { class: 'cd-note', style: 'margin:0' }, 'Click an object to select it. Double-click to select inside a group. Drag to move, or use the arrow keys.')); return }
    const b = S.bounds.get(n.id)
    const ls = leavesOf(n)
    const editable = ls.some((l) => l.kind !== 'unknown' && l.kind !== 'bitmap')
    const fillC = n.fill?.type === 'solid' ? n.fill.color : ls.find((l) => l.fill?.type === 'solid')?.fill.color
    const lineL = ls.find((l) => l.line && !l.line.none)
    const kv = h('dl', { class: 'cd-kv' },
      h('dt', 'Type'), h('dd', KIND[n.kind] || 'Object'),
      n.name ? [h('dt', 'Name'), h('dd', n.name)] : null,
      b ? [h('dt', 'Size'), h('dd', `${mm1(b.w)} x ${mm1(b.h)} mm`)] : null,
      n.children ? [h('dt', 'Contains'), h('dd', `${ls.length} object${ls.length === 1 ? '' : 's'}`)] : null,
      n.kind === 'text' && n.geom?.text ? [h('dt', 'Text'), h('dd', n.geom.text)] : null,
      n.fill?.type === 'gradient' ? [h('dt', 'Fill'), h('dd', 'Gradient (shown approximately)')] : null,
      n.kind === 'unknown' ? [h('dt', 'Note'), h('dd', `Not supported (${n.geom?.note || 'unknown'}); shown as a box.`)] : null)
    inspectBox.append(kv)
    if (b) {
      const x = number(+mm1(b.x), { step: 0.1, ariaLabel: 'X position in millimetres' }), y = number(+mm1(b.y), { step: 0.1, ariaLabel: 'Y position in millimetres' })
      const apply = () => { const dx = (x.valueAsNumber - +mm1(b.x)) * MM, dy = (y.valueAsNumber - +mm1(b.y)) * MM; if (Number.isFinite(dx + dy) && (dx || dy)) moveNode(n, dx, dy) }
      x.addEventListener('change', apply); y.addEventListener('change', apply)
      inspectBox.append(h('div', { class: 'cd-xy' }, field('X (mm)', x), field('Y (mm)', y)))
    }
    if (editable) {
      const fc = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(fillC || '') ? fillC : '#cccccc', 'aria-label': 'Fill colour', onchange: (e) => setFill(n, e.target.value) })
      const lc = h('input', { type: 'color', value: lineL?.line.color || '#000000', 'aria-label': 'Outline colour', onchange: (e) => setLine(n, { color: e.target.value }) })
      const lw = number(lineL ? +(lineL.line.width * 72).toFixed(2) : 0, { min: 0, step: 0.25, ariaLabel: 'Outline width in points', onInput: () => {} })
      lw.addEventListener('change', () => { const v = lw.valueAsNumber; if (Number.isFinite(v)) setLine(n, v <= 0 ? { none: true } : { width: v / 72 }) })
      inspectBox.append(
        field('Fill', h('div', { class: 'cd-col' }, fc, button('No fill', { size: 'sm', variant: 'secondary', onClick: () => setFill(n, null) }))),
        field('Outline', h('div', { class: 'cd-col' }, lc, h('span', { class: 'small muted' }, 'width (pt)'), lw, button('None', { size: 'sm', variant: 'secondary', onClick: () => setLine(n, { none: true }) }))))
    }
    inspectBox.append(h('div', { class: 'row' }, button('Delete', { icon: 'trash-2', size: 'sm', variant: 'secondary', onClick: deleteSel }), button('Select none', { size: 'sm', variant: 'ghost', onClick: () => selectNode(null) })))
  }
  function renderNotes() {
    notesBox.replaceChildren()
    const w = [...new Set([...S.doc.warnings, ...S.model.warnings])]
    notesBox.append(h('div', { class: 'cd-note' }, `${S.doc.versionName} file (${S.doc.container === 'riff' ? 'RIFF' : S.doc.container === 'zip' ? 'ZIP container' : 'ZIP container with data streams'}). Origin of coordinates: ${S.model.origin === 'center' ? 'page centre' : S.model.origin === 'corner' ? 'page corner' : 'drawing extent'}.`))
    if (w.length) notesBox.append(h('details', null, h('summary', { class: 'small', style: 'cursor:pointer' }, `${w.length} note${w.length === 1 ? '' : 's'} about this file`), h('ul', { class: 'cd-list' }, w.map((x) => h('li', x)))))
    notesBox.append(h('div', { class: 'cd-note' }, 'Compare with your original in CorelDRAW: patterns, effects and PowerClip contents are not drawn.'))
  }

  // ---------- opening ----------
  async function openFile(file) {
    if (file.size > 250e6) return toast('That file is very large (over 250 MB). Try a smaller one.', 'error')
    S.file = file; S.traced = null
    intro.replaceChildren(h('div', { class: 'empty loading' }, h('span', { class: 'spinner' }), 'Reading the file...'))
    fallback.hidden = true; app.hidden = true
    let cdr
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const needZip = bytes[0] === 0x50 && bytes[1] === 0x4b
      cdr = await readCdr(bytes, { JSZip: needZip ? await jszip() : null })
    } catch (e) {
      console.error(e)
      cdr = { failed: true, warnings: [errorMessage(e)], pages: [], preview: null }
    }
    intro.replaceChildren()
    S.cdr = cdr
    const usable = cdr.pages.some((p) => !p.master && p.layers.some((l) => [...leaves(l.objects)].length))
    if (cdr.failed || !usable) return showFallback(cdr)
    S.doc = buildDoc(cdr)
    S.pageIdx = Math.max(0, S.doc.pages.findIndex((p) => !p.master))
    S.sel = null; S.undo = []; S.redo = []; S.more.clear()
    dz.hidden = true
    app.hidden = false; fallback.hidden = true
    pageSel.replaceChildren(...S.doc.pages.map((p, i) => h('option', { value: i }, p.master ? `${p.name} (master)` : p.name)))
    nameEl.textContent = file.name; nameEl.title = file.name
    vsB.hidden = false; delB.hidden = false; undoB.hidden = false; redoB.hidden = false
    render(); fitPage(); drawPages(); drawLayers(); drawInspector(); refreshExport()
    const total = S.doc.pages.reduce((a, p) => a + p.layers.reduce((b, l) => b + [...leaves(l.objects)].length, 0), 0)
    toast(`Opened ${file.name}: ${S.doc.pages.filter((p) => !p.master).length} page(s), ${total} object(s)`, 'success')
    stage.focus({ preventScroll: true })
  }

  function showFallback(cdr) {
    app.hidden = true; fallback.hidden = false; dz.hidden = false
    S.doc = null
    const reasons = cdr.warnings?.length ? cdr.warnings : ['The drawing could not be read.']
    const info = h('div', { class: 'stack' },
      alert('warn', h('strong', 'This drawing could not be opened.'), h('ul', { class: 'cd-list' }, reasons.map((r) => h('li', r)))),
      h('p', { class: 'cd-note', style: 'margin:0' }, 'This reader was written from public format notes and handles CorelDRAW 7 to X3 files and the ZIP container of X4 and newer. Files from some versions and special features may not open. Opening the file in CorelDRAW and saving it as an older version (X3 or earlier) can help.'))
    const side = h('div', { class: 'stack' })
    if (cdr.preview) {
      const url = track(blobUrl(cdr.preview.bytes, cdr.preview.mime))
      const img = h('img', { src: url, alt: 'Preview image saved inside the file' })
      const holder = h('div', { class: 'preview' }, img)
      img.addEventListener('error', () => { holder.replaceChildren(h('div', { class: 'empty' }, icon('image-off'), h('div', 'The preview inside this file could not be shown either.'))); traceBtn.disabled = true })
      const traceBtn = button('Trace the preview into vectors', { icon: 'wand-sparkles', variant: 'primary', onClick: () => busy(traceBtn, () => traceThePreview(url), { label: 'Tracing', errorTo: side }) })
      side.append(h('div', null, h('div', { class: 'small', style: 'font-weight:600;margin-bottom:6px' }, 'Preview image saved inside the file'), holder),
        h('p', { class: 'cd-note', style: 'margin:0' }, 'This is only the small preview picture CorelDRAW stored with the file, not your full drawing. It can be traced into rough vector shapes that open in CorelDRAW.'), traceBtn)
    } else side.append(alert('info', 'No preview image was found in this file either.'))
    fallback.replaceChildren(h('div', { class: 'cd-fallback' }, info, side))
  }

  async function traceThePreview(url) {
    const img = await loadImage(url)
    const r = await traceImage(img, { ...PRESETS.poster, colors: 16, removeBg: false, widthPt: Math.min(600, img.naturalWidth * 0.75) })
    S.traced = { doc: { pages: [r.page], warnings: [] }, r }
    app.hidden = false; fallback.hidden = true
    ;[...app.children].forEach((c) => { if (c !== bar && c !== stage && c !== right) c.hidden = true })
    right.hidden = false
    ;[...right.querySelectorAll('.p-inspect')].forEach((x) => { x.hidden = true })
    left.hidden = true; tabs.hidden = true
    ;[undoB, redoB, delB, vsB].forEach((b) => { b.hidden = true })
    vsB.hidden = false
    pageSel.hidden = prevB.hidden = nextB.hidden = true
    nameEl.textContent = `${baseName(S.file.name)} (traced preview)`
    scopeSeg.hidden = true
    render(); fitPage(); refreshExport()
    exportResult.replaceChildren(alert('info', `Traced ${r.paths} paths in ${r.colors} colours from the preview. Save it with the formats above.`))
  }

  // ---------- export ----------
  const hasText = (d) => d.pages.some((p) => p.items.some((i) => i.t === 'text'))
  async function doExport() {
    if (!S.doc && !S.traced) throw new Error('Open a CDR file first.')
    exportResult.replaceChildren()
    const fmt = S.fmt, name = baseName(S.file?.name || 'drawing')
    const notes = new Set()
    let mdoc
    if (S.traced) mdoc = structuredClone(S.traced.doc)
    else {
      const idx = S.scope === 'page' ? [S.pageIdx] : S.doc.pages.map((_, i) => i).filter((i) => !S.doc.pages[i].master)
      if (!idx.length) throw new Error('There is no page to export.')
      mdoc = toModelDoc(S.doc, idx, { bitmapHref })
      mdoc.warnings.forEach((w) => notes.add(w))
    }
    for (const p of mdoc.pages) p.items = p.items.filter((it) => !it.placeholder)
    if (S.outline && ['eps', 'ai', 'pdf'].includes(fmt) && hasText(mdoc)) {
      prog.set(null, 'Converting text to outlines')
      const r = await outlineDoc(mdoc)
      if (r.kept) notes.add(`${r.kept} text item(s) use characters the bundled fonts do not have and stay as live text.`)
    }
    prog.set(null, 'Writing the file')
    const multi = mdoc.pages.length > 1
    const sfx = (i) => (multi ? `-p${i + 1}` : '')
    let files = []
    if (fmt === 'svg') files = mdoc.pages.map((p, i) => ({ name: `${name}${sfx(i)}.svg`, blob: new Blob([pageToSvg(p, { unit: 'mm', title: name })], { type: 'image/svg+xml' }) }))
    else if (fmt === 'eps') for (let i = 0; i < mdoc.pages.length; i++) { const r = await epsBlob(mdoc, i, { title: name }); r.notes.forEach((x) => notes.add(x)); files.push({ name: `${name}${sfx(i)}.eps`, blob: r.blob }); await yieldToMain(); prog.set((i + 1) / mdoc.pages.length) }
    else if (fmt === 'pdf' || fmt === 'ai') { const r = await toPdf(mdoc, { title: name }); r.notes.forEach((x) => notes.add(x)); files = [{ name: `${name}.${EXT[fmt]}`, blob: r.blob }] }
    else if (fmt === 'png') {
      for (let i = 0; i < mdoc.pages.length; i++) {
        const p = mdoc.pages[i]
        const r = await svgToPng(pageToSvg(p, { unit: 'pt', background: '#ffffff' }), p.w, p.h, Math.round((p.w / 72) * S.dpi))
        if (r.shrunk) notes.add('Large pages were saved at a lower resolution to fit the browser limits.')
        files.push({ name: `${name}${sfx(i)}.png`, blob: r.blob }); await yieldToMain(); prog.set((i + 1) / mdoc.pages.length)
      }
    }
    const total = files.reduce((a, f) => a + f.blob.size, 0)
    const s = docStats(mdoc)
    exportResult.replaceChildren(alert('success', h('strong', files.length > 1 ? `${files.length} files are ready` : 'Your file is ready'), ` (${formatBytes(total)}${fmt !== 'png' ? `, ${s.paths} paths` : ''}).`),
      ...files.map((f) => h('div', { class: 'row' }, h('span', { class: 'small', style: 'flex:1;min-width:0;overflow-wrap:anywhere' }, f.name), downloadButton(f.blob, f.name, 'Download', { size: 'sm' }))),
      files.length > 1 ? button('Download all as ZIP', { icon: 'download', variant: 'secondary', size: 'sm', onClick: async () => download(await zip(files.map((f) => ({ name: f.name, data: f.blob }))), `${name}-${fmt}.zip`) }) : null,
      notes.size ? h('ul', { class: 'cd-list' }, [...notes].map((x) => h('li', x))) : null)
    prog.hide()
  }

  async function editInVectorStudio() {
    const idx = S.traced ? null : [S.pageIdx]
    const mdoc = S.traced ? structuredClone(S.traced.doc) : toModelDoc(S.doc, idx, { bitmapHref })
    const pg = mdoc.pages[0]
    pg.items = pg.items.filter((it) => !it.placeholder)
    const text = pageToSvg(pg, { unit: 'mm', title: baseName(S.file?.name || 'drawing') })
    openToolWith('vector-studio', [new File([text], `${baseName(S.file?.name || 'drawing')}.svg`, { type: 'image/svg+xml' })])
  }

  refreshExport()
}
