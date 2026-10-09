// Panels: options bar, layers, properties (per layer type), history and color.
import { h, icon } from '../../lib/ui.js'
import { ctl, openMenu, parseHex } from './_chrome.js'
import { BLENDS } from './_doc.js'
import { layerThumb, maskThumb, FONTS } from './_render.js'
import { ADJUSTMENTS, curveLut, GRADIENT_PRESETS } from './_adjust.js'
import { toolById } from './_tools.js'
import { clamp } from './_util.js'

const HINTS = {
  move: 'Drag to move the layer. Shift locks the axis. With a selection, the selected pixels lift onto their own layer.',
  marquee: 'Drag to select. Shift adds, Alt subtracts, click to deselect.',
  ellipse: 'Drag to select. Shift for a circle, Alt from the center.',
  lasso: 'Draw freely around an area, release to close the selection.',
  wand: 'Click a color to select similar pixels.',
  crop: 'Drag the box or its handles, then press Enter or Apply.',
  brush: '[ and ] change the size, X swaps colors. On a mask: white reveals, black hides.',
  eraser: '[ and ] change the size. Erases to transparency (hides on a mask).',
  clone: 'Alt-click to set the source, then paint over what you want to cover.',
  bucket: 'Click to fill a similar-color area with the foreground color.',
  gradient: 'Drag from start to end. Shift snaps the angle.',
  text: 'Click the image to add text, click existing text to edit it.',
  shapes: 'Drag to draw. Shift keeps it square. Edit it later in Properties.',
  eyedropper: 'Click to pick a color. Alt-click sets the background.',
  zoom: 'Click to zoom in, Alt-click to zoom out. Ctrl+scroll also zooms.',
  hand: 'Drag to pan. Hold Space with any tool to pan.',
}

export function optionsBar(app) {
  const el = h('div', { class: 'ps-opts', role: 'toolbar', 'aria-label': 'Tool options' })
  let controls = {}
  function render() {
    const t = toolById(app.tool)
    controls = {}
    const parts = [h('span', { class: 'ps-toolname' }, icon(t.icon), t.name)]
    for (const s of t.opts) {
      const read = () => (s.shared ? app.opts[s.k] : app.toolOpts()[s.k])
      const write = (v) => app.setOpt(s.k, v, s.shared)
      let c
      if (s.type === 'range') c = ctl.range(s.label, read(), { min: s.min, max: s.max, step: s.step, fmt: s.fmt, onInput: write, title: s.title })
      else if (s.type === 'toggle') c = ctl.toggle(s.label, read(), write, s.title)
      else if (s.type === 'seg') c = ctl.seg(s.options, read(), write, s.label)
      else if (s.type === 'select') {
        c = ctl.select(s.options === 'fonts' ? FONTS.map((f) => [f, f]) : s.options, read(), write, s.label)
        c = h('span', { class: 'ps-oc' }, h('span', { class: 'l' }, s.label), c); c.set = (v) => c.querySelector('select').set(v)
      } else if (s.type === 'button') c = ctl.button(s.label, { icon: s.icon, primary: s.primary, title: s.title, onClick: () => app.optAction(s.k) })
      if (c) { controls[s.k] = c; parts.push(c) }
    }
    parts.push(h('span', { class: 'ps-sp' }), h('span', { class: 'ps-hint' }, HINTS[t.id] || ''))
    el.replaceChildren(...parts)
  }
  function sync() {
    const t = toolById(app.tool)
    for (const s of t.opts) if (controls[s.k]?.set && s.type !== 'button') controls[s.k].set(s.shared ? app.opts[s.k] : app.toolOpts()[s.k])
  }
  return { el, render, sync }
}

// ---------- layers ----------
export function layersPanel(app) {
  const blend = ctl.select(BLENDS, 'source-over', (v) => { const L = app.doc?.active; if (L) app.doc.setProps(L.id, { blend: v }, 'Blend mode') }, 'Blend mode')
  const opacity = ctl.range('Opacity', 100, { min: 0, max: 100, fmt: (v) => `${Math.round(v)}%`, onInput: (v) => { const L = app.doc?.active; if (L) app.doc.setProps(L.id, { opacity: v / 100 }, 'Opacity', 'opacity') } })
  opacity.classList.add('ps-rng'); opacity.style.width = '100%'
  const head = h('div', { class: 'ps-lhead' }, blend, h('span'), opacity)
  const list = h('div', { class: 'ps-layers', role: 'listbox', 'aria-label': 'Layers' })
  const cache = new WeakMap()
  const thumb = (d, L) => {
    const key = `${L.v}|${L.canvas?.width}|${d.w}x${d.h}|${L.text?.text}`
    const c = cache.get(L)
    if (c && c.key === key) return c.el
    const el = layerThumb(d, L, 38)
    cache.set(L, { key, el })
    return el
  }
  const mcache = new WeakMap()
  const mthumb = (d, L) => {
    const key = `${L.v}|${d.w}x${d.h}|${L.mask.canvas.width}`
    const c = mcache.get(L)
    if (c && c.key === key) return c.el
    const el = maskThumb(d, L, 38)
    mcache.set(L, { key, el })
    return el
  }

  const addAdj = h('button', { type: 'button', class: 'ps-ib sm', 'data-tip': 'New adjustment layer', 'aria-label': 'New adjustment layer', 'aria-haspopup': 'menu', onclick: (e) => openMenu(app.root, e.currentTarget, adjustmentItems(app)) }, icon('sliders-horizontal'))
  const maskBtn = h('button', { type: 'button', class: 'ps-ib sm', 'data-tip': 'Layer mask', 'aria-label': 'Layer mask', 'aria-haspopup': 'menu', onclick: (e) => openMenu(app.root, e.currentTarget, maskItems(app)) }, icon('venetian-mask'))
  const btn = (ic, tip, fn, extra) => h('button', { type: 'button', class: 'ps-ib sm', 'data-tip': tip, 'aria-label': tip, onclick: fn, ...extra }, icon(ic))
  const foot = h('div', { class: 'ps-lfoot' },
    btn('plus', 'New layer|Ctrl+Shift+N', () => app.doc && app.ops.newLayer()), addAdj, maskBtn,
    btn('copy', 'Duplicate layer|Ctrl+J', () => app.doc?.active && app.doc.duplicate(app.doc.activeId)),
    btn('arrow-up', 'Move layer up|Ctrl+]', () => app.moveLayer(1)), btn('arrow-down', 'Move layer down|Ctrl+[', () => app.moveLayer(-1)),
    btn('merge', 'Merge down|Ctrl+E', () => app.mergeDown()), h('span', { class: 'ps-sp' }), btn('trash-2', 'Delete layer', () => app.doc?.active && app.doc.deleteLayer(app.doc.activeId)))
  const el = h('div', { class: 'ps-sec layers-sec', style: 'min-height:0' }, head, list, foot)
  el.style.display = 'flex'

  let dragId = null
  function rename(nameEl, L) {
    const inp = h('input', { value: L.name, 'aria-label': 'Layer name' })
    nameEl.replaceChildren(inp)
    inp.focus(); inp.select()
    const done = (ok) => { if (!inp.isConnected) return; const v = inp.value.trim(); if (ok && v && v !== L.name) app.doc.setProps(L.id, { name: v }, 'Rename layer'); else refresh() }
    inp.onblur = () => done(true)
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false) }
  }

  function refresh() {
    const d = app.doc
    if (!d) { list.replaceChildren(); return }
    const A = d.active
    blend.set(A?.blend || 'source-over'); blend.disabled = !A || A.type === 'adjust'
    opacity.set(Math.round((A?.opacity ?? 1) * 100))
    const rows = [...d.layers].reverse().map((L) => {
      const sel = L.id === d.activeId
      const nameEl = h('span', { class: 'ps-name', title: 'Double-click to rename', ondblclick: () => rename(nameEl, L) }, L.name)
      const t = L.type === 'adjust' ? h('div', { class: 'ps-thumb' }, icon(ADJUSTMENTS[L.adjust.kind].icon)) : h('div', { class: 'ps-thumb' }, thumb(d, L))
      const m = L.mask ? h('div', { class: ['ps-thumb', 'mask', sel && d.editMask && 'on'], title: 'Layer mask. Click to paint it, Shift-click to disable.', style: L.maskOn ? '' : 'opacity:.4',
        onclick: (e) => { e.stopPropagation(); e.shiftKey ? d.setProps(L.id, { maskOn: !L.maskOn }, 'Toggle mask') : d.select(L.id, true) } }, mthumb(d, L)) : null
      const row = h('div', {
        class: ['ps-layer', sel && 'sel', !L.visible && 'dim'], role: 'option', tabindex: 0, 'aria-selected': String(sel), draggable: true, 'data-id': L.id,
        onclick: () => d.select(L.id),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); d.select(L.id) } },
        ondragstart: (e) => { dragId = L.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', L.id) },
        ondragover: (e) => { if (dragId && dragId !== L.id) { e.preventDefault(); row.classList.add('over') } },
        ondragleave: () => row.classList.remove('over'),
        ondrop: (e) => {
          row.classList.remove('over')
          if (!dragId || dragId === L.id) return
          e.preventDefault(); e.stopPropagation()
          const s = d.index(dragId), r = d.index(L.id)
          d.moveTo(dragId, r - (s < r ? 1 : 0) + 1)
          dragId = null
        },
        ondragend: () => { dragId = null },
      },
      h('button', { type: 'button', class: 'ps-ib sm', 'aria-label': L.visible ? `Hide ${L.name}` : `Show ${L.name}`, 'aria-pressed': String(L.visible), onclick: (e) => { e.stopPropagation(); d.setProps(L.id, { visible: !L.visible }, L.visible ? 'Hide layer' : 'Show layer') } }, icon(L.visible ? 'eye' : 'eye-off')),
      t, m, nameEl,
      h('button', { type: 'button', class: 'ps-ib sm', 'aria-label': L.locked ? `Unlock ${L.name}` : `Lock ${L.name}`, 'aria-pressed': String(L.locked), style: L.locked ? '' : 'opacity:.45', onclick: (e) => { e.stopPropagation(); d.setProps(L.id, { locked: !L.locked }, L.locked ? 'Unlock layer' : 'Lock layer') } }, icon(L.locked ? 'lock' : 'lock-open')))
      return row
    })
    list.replaceChildren(...rows)
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' })
  }
  return { el, refresh }
}

function adjustmentItems(app) {
  return [{ heading: 'Adjustment layer' }, ...Object.entries(ADJUSTMENTS).map(([k, a]) => ({ label: a.name, icon: a.icon, run: () => app.doc && app.ops.addAdjustment(k) }))]
}
function maskItems(app) {
  const d = app.doc, L = d?.active
  if (!L) return [{ label: 'No layer selected', disabled: true }]
  if (!L.mask) {
    return [{ label: 'Reveal all', icon: 'square', run: () => d.addMask(L.id, 'reveal') }, { label: 'Hide all', icon: 'square-dashed', run: () => d.addMask(L.id, 'hide') },
      { label: 'From selection', icon: 'lasso', disabled: !d.sel, run: () => d.addMask(L.id, 'sel') }, { label: 'Hide selection', icon: 'circle-slash', disabled: !d.sel, run: () => d.addMask(L.id, 'hidesel') }]
  }
  return [{ label: L.maskOn ? 'Disable mask' : 'Enable mask', icon: 'eye-off', run: () => d.setProps(L.id, { maskOn: !L.maskOn }, 'Toggle mask') }, { label: 'Invert mask', icon: 'flip-horizontal-2', run: () => d.invertMask(L.id) },
    { label: 'Apply mask', icon: 'check', disabled: L.type === 'adjust', run: () => d.removeMask(L.id, true) }, { label: 'Delete mask', icon: 'trash-2', run: () => d.removeMask(L.id, false) }]
}

// ---------- properties ----------
export function propsPanel(app) {
  const el = h('div')
  let cur = null, sig = ''

  function refresh() {
    const d = app.doc, L = d?.active
    const s = !L ? 'none' : `${L.id}|${L.type}|${L.adjust?.kind || ''}|${L.shape?.kind || ''}|${!!L.mask}|${d.editMask}`
    if (s !== sig) {
      sig = s
      cur = L ? build(d, L) : null
      el.replaceChildren(cur ? cur.el : h('p', { class: 'ps-note' }, 'Select a layer to see its properties.'))
    } else cur?.sync()
  }

  function build(d, L) {
    const syncs = []
    const reg = (c, fn) => { syncs.push(() => c.set(fn(L))); return c }
    const set = (patch, label, key) => d.setProps(L.id, patch, label, key)
    const nested = (field, patch, label) => set({ [field]: { ...L[field], ...patch } }, label, `${field}.${Object.keys(patch).join(',')}`)
    const parts = []

    const nameInp = h('input', { class: 'ps-in', value: L.name, 'aria-label': 'Layer name', onchange: () => { const v = nameInp.value.trim(); if (v) set({ name: v }, 'Rename layer') } })
    nameInp.set = (v) => { if (document.activeElement !== nameInp) nameInp.value = v }
    syncs.push(() => nameInp.set(L.name))
    parts.push(ctl.field('Name', nameInp))
    if (d.editMask && L.mask) parts.push(h('p', { class: 'ps-note' }, 'Editing the layer mask: paint white to reveal, black to hide. Select the layer thumbnail to edit its pixels again.'))

    if (L.type === 'raster') {
      parts.push(h('div', { class: 'ps-f2' }, reg(ctl.num('X', L.x, { onChange: (v) => set({ x: Math.round(v) }, 'Move layer') }), (l) => l.x), reg(ctl.num('Y', L.y, { onChange: (v) => set({ y: Math.round(v) }, 'Move layer') }), (l) => l.y)))
      parts.push(h('p', { class: 'ps-note' }, `${L.canvas.width} x ${L.canvas.height} px`))
      parts.push(h('div', { class: 'ps-row' }, ctl.button('Flip H', { icon: 'flip-horizontal', onClick: () => d.flipLayer(L.id, 'fh') }), ctl.button('Flip V', { icon: 'flip-vertical', onClick: () => d.flipLayer(L.id, 'fv') }), ctl.button('Transform', { icon: 'scaling', onClick: () => app.dialogs.transformLayer() })))
    }

    if (L.type === 'text') {
      const ta = h('textarea', { class: 'ps-in', rows: 3, value: L.text.text, 'aria-label': 'Text', spellcheck: false, oninput: () => nested('text', { text: ta.value }, 'Edit text') })
      ta.set = (v) => { if (ta.value !== v) ta.value = v }
      syncs.push(() => ta.set(L.text.text))
      app.textArea = ta
      parts.push(ctl.field('Text', ta))
      parts.push(ctl.field('Font', reg(ctl.select(FONTS, L.text.font, (v) => nested('text', { font: v }, 'Text font'), 'Font'), (l) => l.text.font)))
      parts.push(reg(ctl.slider('Size', L.text.size, { min: 6, max: 600, fmt: (v) => `${Math.round(v)} px`, onInput: (v) => nested('text', { size: v }, 'Text size') }), (l) => l.text.size))
      parts.push(h('div', { class: 'ps-row', style: 'margin-bottom:10px' }, reg(ctl.color('Color', L.text.color, (v) => nested('text', { color: v }, 'Text color')), (l) => l.text.color),
        reg(ctl.toggle('Bold', L.text.bold, (v) => nested('text', { bold: v }, 'Bold')), (l) => l.text.bold), reg(ctl.toggle('Italic', L.text.italic, (v) => nested('text', { italic: v }, 'Italic')), (l) => l.text.italic)))
      parts.push(ctl.field('Align', reg(ctl.seg([['left', 'Left'], ['center', 'Center'], ['right', 'Right']], L.text.align, (v) => nested('text', { align: v }, 'Text align'), 'Align'), (l) => l.text.align)))
      parts.push(reg(ctl.slider('Line height', L.text.lineHeight, { min: 0.8, max: 2.5, step: 0.05, fmt: (v) => v.toFixed(2), onInput: (v) => nested('text', { lineHeight: v }, 'Line height') }), (l) => l.text.lineHeight))
      parts.push(reg(ctl.slider('Outline', L.text.strokeW, { min: 0, max: 40, fmt: (v) => `${v} px`, onInput: (v) => nested('text', { strokeW: v }, 'Text outline') }), (l) => l.text.strokeW))
      parts.push(h('div', { class: 'ps-row', style: 'margin-bottom:10px' }, reg(ctl.color('Outline color', L.text.strokeColor, (v) => nested('text', { strokeColor: v }, 'Outline color')), (l) => l.text.strokeColor),
        reg(ctl.toggle('Shadow', L.text.shadow, (v) => nested('text', { shadow: v }, 'Text shadow')), (l) => l.text.shadow)))
      parts.push(h('div', { class: 'ps-f2' }, reg(ctl.num('X', L.text.x, { onChange: (v) => nested('text', { x: Math.round(v) }, 'Move text') }), (l) => l.text.x), reg(ctl.num('Y', L.text.y, { onChange: (v) => nested('text', { y: Math.round(v) }, 'Move text') }), (l) => l.text.y)))
      parts.push(h('div', { class: 'ps-row' }, ctl.button('Rasterize', { icon: 'image', title: 'Turn the text into pixels so you can paint and filter it', onClick: () => d.rasterize(L.id) })))
    }

    if (L.type === 'shape') {
      const S = () => L.shape
      parts.push(ctl.field('Shape', reg(ctl.select([['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['line', 'Line'], ['triangle', 'Triangle'], ['polygon', 'Polygon'], ['star', 'Star']], S().kind, (v) => nested('shape', { kind: v }, 'Shape type'), 'Shape'), (l) => l.shape.kind)))
      parts.push(h('div', { class: 'ps-row', style: 'margin-bottom:10px' }, reg(ctl.color('Fill', S().fill, (v) => nested('shape', { fill: v }, 'Shape fill')), (l) => l.shape.fill),
        reg(ctl.toggle('Filled', S().hasFill, (v) => nested('shape', { hasFill: v }, 'Shape fill')), (l) => l.shape.hasFill), reg(ctl.color('Outline', S().stroke, (v) => nested('shape', { stroke: v }, 'Shape outline')), (l) => l.shape.stroke)))
      parts.push(reg(ctl.slider('Outline width', S().strokeW, { min: 0, max: 80, fmt: (v) => `${v} px`, onInput: (v) => nested('shape', { strokeW: v }, 'Outline width') }), (l) => l.shape.strokeW))
      if (S().kind === 'rect') parts.push(reg(ctl.slider('Corner radius', S().radius, { min: 0, max: 400, fmt: (v) => `${v} px`, onInput: (v) => nested('shape', { radius: v }, 'Corner radius') }), (l) => l.shape.radius))
      if (S().kind === 'polygon' || S().kind === 'star') parts.push(reg(ctl.slider('Sides', S().sides, { min: 3, max: 16, onInput: (v) => nested('shape', { sides: v }, 'Shape sides') }), (l) => l.shape.sides))
      parts.push(h('div', { class: 'ps-f2' }, ...['x', 'y', 'w', 'h'].map((k) => reg(ctl.num(k.toUpperCase(), S()[k], { onChange: (v) => nested('shape', { [k]: Math.round(v) }, 'Edit shape') }), (l) => l.shape[k]))))
      parts.push(h('div', { class: 'ps-row' }, ctl.button('Rasterize', { icon: 'image', onClick: () => d.rasterize(L.id) })))
    }

    if (L.type === 'adjust') parts.push(adjustEditor(L, set, reg, syncs))

    parts.push(h('hr', { style: 'border:0;border-top:1px solid var(--border);margin:6px 0 12px' }))
    parts.push(h('div', { class: 'ps-f' }, h('div', { class: 'l' }, h('span', 'Layer mask')),
      h('div', { class: 'ps-row' }, L.mask
        ? [ctl.button(L.maskOn ? 'Disable' : 'Enable', { onClick: () => set({ maskOn: !L.maskOn }, 'Toggle mask') }), ctl.button('Invert', { onClick: () => d.invertMask(L.id) }), L.type !== 'adjust' && ctl.button('Apply', { onClick: () => d.removeMask(L.id, true) }), ctl.button('Delete', { onClick: () => d.removeMask(L.id, false) })]
        : [ctl.button('Add mask', { icon: 'venetian-mask', onClick: () => d.addMask(L.id, d.sel ? 'sel' : 'reveal') })]),
      h('p', { class: 'ps-note', style: 'margin-top:6px' }, L.mask ? 'Click the mask thumbnail in Layers to paint on it.' : d.sel ? 'The mask will start from your selection.' : 'Paint with black to hide parts of the layer and white to show them.')))
    return { el: h('div', parts), sync: () => syncs.forEach((f) => f()) }
  }

  function adjustEditor(L, set, reg, syncs) {
    const kind = L.adjust.kind, def = ADJUSTMENTS[kind]
    const P = () => L.adjust.params
    const setP = (patch, label, key) => set({ adjust: { kind, params: { ...P(), ...patch } } }, label, key)
    const wrap = h('div')
    for (const c of def.controls) {
      wrap.append(reg(ctl.slider(c.label, P()[c.k], { min: c.min, max: c.max, step: c.step ?? 1, fmt: (v) => (c.step && c.step < 1 ? v.toFixed(2) : Math.round(v)), onInput: (v) => setP({ [c.k]: v }, def.name, `adj.${c.k}`) }), (l) => l.adjust.params[c.k]))
    }
    if (kind === 'curves') wrap.append(curveEditor(L, setP, syncs))
    if (kind === 'gradmap') wrap.append(gradientEditor(L, setP, syncs))
    if (kind === 'invert') wrap.append(h('p', { class: 'ps-note' }, 'Inverts every color below this layer. Use the mask to limit where it applies.'))
    wrap.append(h('div', { class: 'ps-row', style: 'margin-bottom:10px' }, ctl.button('Reset', { icon: 'rotate-ccw', onClick: () => set({ adjust: { kind, params: JSON.parse(JSON.stringify(def.defaults)) } }, `Reset ${def.name}`) })))
    return wrap
  }

  function curveEditor(L, setP, syncs) {
    const S = 300
    const canvas = h('canvas', { class: 'ps-curve', width: S, height: S, role: 'img', 'aria-label': 'Curve editor. Click to add points, drag to move, double-click a point to remove it.' })
    const ctx = canvas.getContext('2d')
    let ch = 'rgb', drag = -1
    const cols = { rgb: '#8b7dff', r: '#ef4444', g: '#22c55e', b: '#3b82f6' }
    const pts = () => L.adjust.params[ch]
    const toXY = ([x, y]) => [(x / 255) * S, S - (y / 255) * S]
    const draw = () => {
      ctx.clearRect(0, 0, S, S)
      const css = getComputedStyle(canvas)
      ctx.strokeStyle = css.getPropertyValue('--border-strong') || '#999'; ctx.lineWidth = 1
      for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo((S * i) / 4, 0); ctx.lineTo((S * i) / 4, S); ctx.moveTo(0, (S * i) / 4); ctx.lineTo(S, (S * i) / 4); ctx.stroke() }
      ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(0, S); ctx.lineTo(S, 0); ctx.stroke(); ctx.setLineDash([])
      const lut = curveLut(pts())
      ctx.strokeStyle = cols[ch]; ctx.lineWidth = 2.5; ctx.beginPath()
      for (let i = 0; i < 256; i++) { const [x, y] = toXY([i, lut[i]]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y) }
      ctx.stroke()
      for (const p of pts()) { const [x, y] = toXY(p); ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = cols[ch]; ctx.lineWidth = 2; ctx.stroke() }
    }
    const at = (e) => { const r = canvas.getBoundingClientRect(); return [clamp(((e.clientX - r.left) / r.width) * 255, 0, 255), clamp(255 - ((e.clientY - r.top) / r.height) * 255, 0, 255)] }
    const commit = (list) => setP({ [ch]: list.map((p) => [Math.round(p[0]), Math.round(p[1])]) }, 'Edit curves', 'curve')
    canvas.addEventListener('pointerdown', (e) => {
      const [x, y] = at(e), list = pts().map((p) => [...p])
      const k = list.findIndex((p) => Math.hypot(((p[0] - x) / 255) * S, ((p[1] - y) / 255) * S) < 12)
      canvas.setPointerCapture(e.pointerId)
      if (k >= 0) drag = k
      else { list.push([x, y]); list.sort((a, b) => a[0] - b[0]); drag = list.findIndex((p) => p[0] === x && p[1] === y); commit(list) }
    })
    canvas.addEventListener('pointermove', (e) => {
      if (drag < 0) return
      const list = pts().map((p) => [...p]), [x, y] = at(e)
      const lo = drag > 0 ? list[drag - 1][0] + 1 : 0, hi = drag < list.length - 1 ? list[drag + 1][0] - 1 : 255
      list[drag] = [drag === 0 ? Math.min(x, hi) : drag === list.length - 1 ? Math.max(x, lo) : clamp(x, lo, hi), y]
      commit(list)
    })
    canvas.addEventListener('pointerup', () => { drag = -1 })
    canvas.addEventListener('dblclick', (e) => {
      const [x, y] = at(e), list = pts().map((p) => [...p])
      const k = list.findIndex((p, i) => i > 0 && i < list.length - 1 && Math.hypot(((p[0] - x) / 255) * S, ((p[1] - y) / 255) * S) < 12)
      if (k > 0) { list.splice(k, 1); commit(list) }
    })
    syncs.push(draw)
    const chans = ctl.seg([['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']], ch, (v) => { ch = v; draw() }, 'Channel')
    queueMicrotask(draw)
    return h('div', { class: 'ps-f' }, h('div', { class: 'l' }, h('span', 'Curve')), chans, canvas, h('p', { class: 'ps-note' }, 'Click to add a point, drag to shape the curve, double-click a point to remove it.'))
  }

  function gradientEditor(L, setP) {
    const stops = () => L.adjust.params.stops
    const wrap = h('div', { class: 'ps-f' })
    const render = () => {
      const rows = stops().map(([pos, col], i) => h('div', { class: 'ps-stop' },
        h('input', { type: 'color', value: col, 'aria-label': `Stop ${i + 1} color`, oninput: (e) => setP({ stops: stops().map((s, j) => (j === i ? [s[0], e.target.value] : s)) }, 'Gradient map', `stop.${i}`) }),
        h('input', { type: 'range', min: 0, max: 100, value: Math.round(pos * 100), 'aria-label': `Stop ${i + 1} position`, oninput: (e) => setP({ stops: stops().map((s, j) => (j === i ? [e.target.valueAsNumber / 100, s[1]] : s)) }, 'Gradient map', `stoppos.${i}`) }),
        h('button', { type: 'button', class: 'ps-ib sm', 'aria-label': 'Remove stop', disabled: stops().length <= 2, onclick: () => { setP({ stops: stops().filter((_, j) => j !== i) }, 'Gradient map'); render() } }, icon('x'))))
      wrap.replaceChildren(h('div', { class: 'l' }, h('span', 'Gradient stops (dark to light)')),
        ctl.select(GRADIENT_PRESETS.map(([n], i) => [i, n]), '', (v) => { setP({ stops: GRADIENT_PRESETS[v][1].map((s) => [...s]) }, 'Gradient map'); render() }, 'Preset'),
        h('div', { class: 'ps-stops', style: 'margin-top:8px' }, rows),
        h('div', { class: 'ps-row', style: 'margin-top:8px' }, ctl.button('Add stop', { icon: 'plus', onClick: () => { if (stops().length < 6) { setP({ stops: [...stops(), [0.5, '#888888']] }, 'Gradient map'); render() } } }),
          ctl.button('Reverse', { icon: 'arrow-left-right', onClick: () => { setP({ stops: stops().map(([p, c]) => [1 - p, c]) }, 'Gradient map'); render() } })))
    }
    render()
    return wrap
  }

  return { el, refresh, focusText(select) { const ta = app.textArea; if (ta?.isConnected) { ta.focus(); if (select) ta.select() } } }
}

// ---------- history ----------
export function historyPanel(app) {
  const el = h('div', { class: 'ps-hist' })
  function refresh() {
    const d = app.doc
    if (!d) { el.replaceChildren(); return }
    const H = d.hist
    const item = (label, n, i) => h('button', { type: 'button', class: ['ps-h', H.i === n && 'cur', H.i < n && 'redo'], 'aria-current': H.i === n ? 'step' : null, onclick: () => H.jump(n) }, h('span', label), h('small', n === 0 ? '' : `${n}`))
    el.replaceChildren(
      item(H.dropped ? 'Oldest kept state' : 'Original', 0),
      ...H.list.map((e, i) => item(e.label, i + 1)),
      h('p', { class: 'ps-note', style: 'margin-top:8px' }, H.dropped ? `${H.dropped} older steps were dropped to save memory.` : 'Click a step to go back to it. Ctrl+Z / Ctrl+Shift+Z also work.'))
    el.querySelector('.cur')?.scrollIntoView({ block: 'nearest' })
  }
  return { el, refresh }
}

// ---------- color ----------
const SWATCHES = ['#000000', '#ffffff', '#6b7280', '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899', '#f43f5e',
  '#7f1d1d', '#9a3412', '#854d0e', '#3f6212', '#166534', '#115e59', '#164e63', '#1e3a8a', '#4c1d95', '#831843', '#fecaca', '#fed7aa', '#fef08a', '#bbf7d0', '#bfdbfe', '#e9d5ff']
export function colorPanel(app) {
  let target = 'fg'
  const mk = (which) => {
    const inp = h('input', { type: 'color', value: app[which], 'aria-label': which === 'fg' ? 'Foreground color' : 'Background color', oninput: () => app.setColor(which, inp.value) })
    const hex = h('input', { class: 'ps-in', value: app[which], 'aria-label': `${which === 'fg' ? 'Foreground' : 'Background'} hex`, maxlength: 7, style: 'width:92px', onchange: () => { const v = parseHex(hex.value); if (v) app.setColor(which, v); else hex.value = app[which] } })
    return { inp, hex, row: h('div', { class: 'ps-row' }, inp, hex, h('span', { class: 'ps-note' }, which === 'fg' ? 'Foreground' : 'Background')) }
  }
  const fg = mk('fg'), bg = mk('bg')
  const sw = h('div', { class: 'ps-sw' })
  const recent = h('div', { class: 'ps-sw' })
  const seg = ctl.seg([['fg', 'Set foreground'], ['bg', 'Set background']], target, (v) => { target = v })
  const swatch = (c) => h('button', { type: 'button', style: `background:${c}`, 'aria-label': c, title: c, onclick: (e) => app.setColor(e.altKey || target === 'bg' ? 'bg' : 'fg', c) })
  sw.append(...SWATCHES.map(swatch))
  const el = h('div', fg.row, bg.row, h('div', { class: 'ps-row', style: 'margin:8px 0' }, ctl.button('Swap', { icon: 'arrow-left-right', onClick: () => app.swapColors() }), ctl.button('Default', { icon: 'rotate-ccw', onClick: () => app.resetColors() })),
    seg, sw, h('div', { class: 'ps-note', style: 'margin-top:12px' }, 'Recent'), recent)
  function refresh() {
    fg.inp.value = app.fg; fg.hex.value = app.fg; bg.inp.value = app.bg; bg.hex.value = app.bg
    recent.replaceChildren(...app.recent.map(swatch))
  }
  return { el, refresh }
}
