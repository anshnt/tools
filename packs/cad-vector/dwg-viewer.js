// DWG and DXF viewer: open a drawing, pan and zoom it, switch layers, then save DXF, SVG, PDF or PNG, or carry on in CAD Studio.
// DWG files are read with LibreDWG (WebAssembly) and drawn by CAD Studio's renderer. Nothing is uploaded.
import { h, dropzone, button, busy, field, select, toggle, stats, alert, panel, formatBytes, download, openToolWith, errorMessage, onCleanup, yieldToMain } from '../../lib/ui.js'
import { baseName } from '../../lib/files.js'
import { drawScene } from '../studio-cad/_render.js'
import { PAPER_CHOICES } from './_cad.js'

const CSS = `
.t-dv .dv-main { display:grid; grid-template-columns:minmax(0,1fr) 280px; gap:16px; align-items:start; }
.t-dv .dv-stage { position:relative; height:clamp(320px, 62vh, 720px); border:1px solid var(--border); border-radius:14px; overflow:hidden; background:#fff; touch-action:none; cursor:grab; }
.t-dv .dv-stage.dark { background:#14161a; }
.t-dv .dv-stage:active { cursor:grabbing; }
.t-dv canvas { position:absolute; inset:0; width:100%; height:100%; display:block; }
.t-dv .dv-bar { position:absolute; right:10px; top:10px; display:flex; gap:6px; z-index:2; }
.t-dv .dv-side { display:flex; flex-direction:column; gap:14px; min-width:0; }
.t-dv .dv-layers { max-height:220px; overflow:auto; display:flex; flex-direction:column; gap:4px; }
.t-dv .dv-layer { display:flex; align-items:center; gap:8px; font-size:13px; min-height:28px; }
.t-dv .dv-sw { width:12px; height:12px; border-radius:3px; border:1px solid var(--border); flex:none; }
.t-dv .dv-notes { margin:6px 0 0; padding-left:18px; font-size:13px; }
.t-dv [hidden] { display:none !important; }
@media (max-width: 860px) { .t-dv .dv-main { grid-template-columns:minmax(0,1fr); } }
`
let styled = false

export function mount(root, { params = {}, signal }) {
  if (!styled) { styled = true; document.head.append(h('style', { 'data-dv': '' }, CSS)) }
  const st = { doc: null, res: null, name: 'drawing', dxf: null, view: null, dark: false, version: '', notes: [], opts: { paper: 'A4', px: '2000' } }
  const canvas = h('canvas', { 'aria-label': 'Drawing view. Drag to pan, scroll to zoom.', role: 'img' })
  const stage = h('div', { class: 'dv-stage' }, canvas)
  const bar = h('div', { class: 'dv-bar' },
    button('', { icon: 'plus', size: 'sm', ariaLabel: 'Zoom in', onClick: () => zoomBy(1.4) }),
    button('', { icon: 'minus', size: 'sm', ariaLabel: 'Zoom out', onClick: () => zoomBy(1 / 1.4) }),
    button('', { icon: 'maximize', size: 'sm', ariaLabel: 'Fit to window', onClick: () => fit() }))
  stage.append(bar)
  const layersBox = h('div', { class: 'dv-layers' })
  const infoBox = h('div')
  const dlBox = h('div', { class: 'stack' })
  const notesBox = h('div')
  const dark = toggle('Dark background', false, (c) => { st.dark = c; stage.classList.toggle('dark', c); draw() })
  const side = h('div', { class: 'dv-side' }, panel(h('h2', 'Drawing'), infoBox, dark), panel(h('h2', 'Layers'), layersBox), panel(h('h2', 'Save as'), dlBox), notesBox)
  const main = h('div', { class: 'dv-main', hidden: true }, h('div', { class: 'stack' }, stage), side)
  const err = h('div')
  const dz = dropzone({
    accept: '.dwg,.dxf', label: 'Drop a DWG or DXF file here or click to browse', hint: 'Your file never leaves this device.',
    onFiles: async ([f]) => {
      err.replaceChildren(h('p', { class: 'muted', role: 'status' }, `Opening ${f.name}...`))
      try { await open(f); err.replaceChildren() } catch (e) { console.error(e); err.replaceChildren(alert('error', errorMessage(e))) }
    },
  })
  root.append(h('div', { class: 't-dv stack' }, dz, err, main))

  // ----- view -----
  const dims = () => ({ w: stage.clientWidth || 600, h: stage.clientHeight || 400 })
  function fit() {
    const e = st.doc?.extents()
    const { w, h: hh } = dims()
    if (!e) return
    const bw = Math.max(e.x1 - e.x0, 1e-9), bh = Math.max(e.y1 - e.y0, 1e-9)
    st.view = { cx: (e.x0 + e.x1) / 2, cy: (e.y0 + e.y1) / 2, scale: Math.min((w - 40) / bw, (hh - 40) / bh), w, h: hh }
    draw()
  }
  let raf = 0
  function draw() {
    if (!st.doc || !st.view) return
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      const { w, h: hh } = dims()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hh * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr) }
      st.view.w = w; st.view.h = hh
      drawScene(canvas.getContext('2d'), st.doc, st.view, dpr, { bg: st.dark ? '#14161a' : '#ffffff', dark: st.dark, lwPx: (lw) => Math.max(1, 0.4 + lw * 2.4) })
    })
  }
  function zoomBy(k, px, py) {
    const v = st.view
    if (!v) return
    const { w, h: hh } = dims()
    px ??= w / 2; py ??= hh / 2
    const wx = (px - w / 2) / v.scale + v.cx, wy = (hh / 2 - py) / v.scale + v.cy
    v.scale *= k
    v.cx = wx - (px - w / 2) / v.scale; v.cy = wy - (hh / 2 - py) / v.scale
    draw()
  }
  stage.addEventListener('wheel', (e) => { e.preventDefault(); const r = stage.getBoundingClientRect(); zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top) }, { passive: false })
  const ptrs = new Map()
  let pinch = 0
  stage.addEventListener('pointerdown', (e) => { if (e.target.closest('.dv-bar')) return; stage.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); pinch = 0 })
  stage.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId)
    if (!p || !st.view) return
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()]
      const d0 = Math.hypot(a[0] - b[0], a[1] - b[1])
      ptrs.set(e.pointerId, [e.clientX, e.clientY])
      const [c, dd] = [...ptrs.values()]
      const d1 = Math.hypot(c[0] - dd[0], c[1] - dd[1])
      if (d0 > 0 && d1 > 0) { const r = stage.getBoundingClientRect(); zoomBy(d1 / d0, (c[0] + dd[0]) / 2 - r.left, (c[1] + dd[1]) / 2 - r.top) }
      return
    }
    st.view.cx -= (e.clientX - p[0]) / st.view.scale
    st.view.cy += (e.clientY - p[1]) / st.view.scale
    ptrs.set(e.pointerId, [e.clientX, e.clientY])
    draw()
  })
  const up = (e) => { ptrs.delete(e.pointerId) }
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up)
  stage.setAttribute('tabindex', '0')
  stage.addEventListener('keydown', (e) => {
    if (!st.view) return
    const step = 40 / st.view.scale
    if (e.key === '+' || e.key === '=') zoomBy(1.25); else if (e.key === '-') zoomBy(0.8); else if (e.key === '0') fit()
    else if (e.key === 'ArrowLeft') { st.view.cx -= step; draw() } else if (e.key === 'ArrowRight') { st.view.cx += step; draw() } else if (e.key === 'ArrowUp') { st.view.cy += step; draw() } else if (e.key === 'ArrowDown') { st.view.cy -= step; draw() } else return
    e.preventDefault()
  })
  const ro = new ResizeObserver(() => { if (st.view) draw() })
  ro.observe(stage)
  onCleanup(() => { ro.disconnect(); cancelAnimationFrame(raf) })

  // ----- opening -----
  async function open(file) {
    err.replaceChildren(); main.hidden = true
    const bytes = new Uint8Array(await file.arrayBuffer())
    const { kindOfFile } = await import('./_convert.js')
    const kind = kindOfFile(file.name, bytes)
    if (kind !== 'dwg' && kind !== 'dxf') throw new Error('Choose a DWG or DXF file.')
    let dxf = bytes
    st.notes = []
    st.version = ''
    if (kind === 'dwg') {
      const r = await (await import('./_dwg.js')).dwgToDxf(bytes, { signal })
      dxf = r.dxf; st.version = `DWG ${r.version}`
    } else st.version = 'DXF'
    await yieldToMain()
    const { dxfToCad, skippedNote } = await import('./_cad.js')
    const { doc, res } = await dxfToCad(dxf, baseName(file.name))
    st.doc = doc; st.res = res; st.name = baseName(file.name); st.dxf = dxf; st.kind = kind
    const s = skippedNote(res)
    if (s) st.notes.push(s)
    main.hidden = false
    renderSide(file)
    st.view = null
    requestAnimationFrame(() => { fit() })
  }

  function renderSide(file) {
    const d = st.doc
    infoBox.replaceChildren(stats([{ label: 'Objects', value: String(d.ents.length), accent: true }, { label: 'Layers', value: String(d.layers.length) }, { label: 'Units', value: st.res.units }, { label: 'Format', value: st.version }]),
      h('p', { class: 'small muted', style: 'margin:8px 0 0' }, `${file.name} (${formatBytes(file.size)})`))
    layersBox.replaceChildren(...d.layers.map((l, i) => h('label', { class: 'dv-layer' },
      h('input', { type: 'checkbox', checked: l.visible, onchange: (e) => { const ls = d.layers.map((x, j) => (j === i ? { ...x, visible: e.target.checked } : x)); d.commit('Layers', (tx) => tx.setLayers(ls)); draw() } }),
      h('span', { class: 'dv-sw', style: `background:${l.color === '#ffffff' ? '#888' : l.color}` }), h('span', l.name))))
    const paper = field('Paper', select(PAPER_CHOICES, st.opts.paper, (v) => { st.opts.paper = v }))
    const px = field('PNG width', select([['1000', '1000 px'], ['2000', '2000 px'], ['4000', '4000 px'], ['8000', '8000 px']], st.opts.px, (v) => { st.opts.px = v }))
    const make = async (to) => {
      const { cadExport } = await import('./_cad.js')
      return cadExport(st.doc, to, { paper: st.opts.paper, px: +st.opts.px })
    }
    const dl = (label, to) => { const b = button(label, { icon: 'download', block: true }); b.addEventListener('click', () => busy(b, async () => { const blob = await make(to); download(blob, `${st.name}.${to}`) }, { label: 'Preparing' })); return b }
    dlBox.replaceChildren(paper, px,
      button('DXF', { icon: 'download', block: true, onClick: () => download(new Blob([st.dxf], { type: 'application/dxf' }), `${st.name}.dxf`) }),
      dl('PDF', 'pdf'), dl('SVG', 'svg'), dl('PNG', 'png'),
      button('Edit in CAD Studio', { icon: 'drafting-compass', variant: 'primary', block: true, onClick: () => openToolWith('cad-studio', [new File([st.dxf], `${st.name}.dxf`, { type: 'application/dxf' })]) }))
    notesBox.replaceChildren(...(st.notes.length ? [alert('info', h('strong', 'Notes'), h('ul', { class: 'dv-notes' }, st.notes.map((n) => h('li', n))))] : []))
  }
}
