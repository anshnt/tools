// Right-hand panels for Vector Studio: Design (appearance, transform, type, align, pathfinder), Layers and Document.
import { h, svg, icon, tabs, segmented, toggle, select } from '../../lib/ui.js'
import { paintEditor, swatchCss } from './_paint.js'
import { FONTS, label, leaves } from './_model.js'
import { clamp } from './_geom.js'

export const PRESETS = [
  ['Web 1200 x 800', 1200, 800], ['HD 1920 x 1080', 1920, 1080], ['Square 1080 x 1080', 1080, 1080], ['Portrait 1080 x 1350', 1080, 1350], ['Story 1080 x 1920', 1080, 1920],
  ['Open Graph 1200 x 630', 1200, 630], ['A4 portrait 794 x 1123', 794, 1123], ['A4 landscape 1123 x 794', 1123, 794], ['A3 portrait 1123 x 1587', 1123, 1587],
  ['A5 portrait 559 x 794', 559, 794], ['US Letter 816 x 1056', 816, 1056], ['Business card 336 x 192', 336, 192], ['App icon 1024 x 1024', 1024, 1024],
  ['Icon 512 x 512', 512, 512], ['Icon 64 x 64', 64, 64], ['Favicon 32 x 32', 32, 32],
]

export const ib = (name, tip, onClick, opts = {}) => h('button', { type: 'button', class: ['vs-ib', opts.on && 'on'], title: tip, 'aria-label': tip, onclick: onClick, disabled: opts.disabled }, typeof name === 'string' ? icon(name) : name)
const num = (value, opts, onChange) => {
  const i = h('input', { type: 'number', class: 'vs-num', value, min: opts.min, max: opts.max, step: opts.step ?? 1, 'aria-label': opts.label, onchange: () => { const v = i.valueAsNumber; if (Number.isFinite(v)) onChange(opts.min != null || opts.max != null ? clamp(v, opts.min ?? -1e9, opts.max ?? 1e9) : v); else i.value = i._last } })
  i.set = (v) => { i._last = v; if (document.activeElement !== i) i.value = Number.isFinite(v) ? Math.round(v * 100) / 100 : '' }
  return i
}
const mini = (label, control, suffix) => h('label', { class: 'vs-mini' }, h('span', label), control, suffix && h('em', suffix))
const section = (title, ...kids) => { const d = h('details', { class: 'vs-sec', open: true }, h('summary', title), h('div', { class: 'vs-sec-body' }, kids)); return d }

// Small custom icons for the four pathfinder operations
const B = (name) => {
  const a = 'M3 3h11v11H3z', b = 'M10 10h11v11H10z'
  const k = { fill: 'currentColor', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }
  const none = { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }
  const kids = {
    unite: [svg('path', { d: a, ...k }), svg('path', { d: b, ...k })],
    subtract: [svg('path', { d: a, ...k }), svg('path', { d: b, fill: 'var(--surface)', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linejoin': 'round' })],
    intersect: [svg('path', { d: a, ...none }), svg('path', { d: b, ...none }), svg('path', { d: 'M10 10h4v4h-4z', fill: 'currentColor' })],
    exclude: [svg('path', { d: a + b, 'fill-rule': 'evenodd', ...k })],
  }[name]
  return svg('svg', { viewBox: '0 0 24 24', class: 'icon', 'aria-hidden': 'true' }, ...kids)
}

export function buildSide(ed, api) {
  const design = designTab(ed, api), layers = layersTab(ed), docTab = documentTab(ed, api)
  let active = 'design', ready = false, pending = false
  const update = () => { if (ready) ({ design, layers, doc: docTab })[active].update() }
  const t = tabs([
    { id: 'design', label: 'Design', render: () => design.el },
    { id: 'layers', label: 'Layers', render: () => layers.el },
    { id: 'doc', label: 'Document', render: () => docTab.el },
  ], 'design', (id) => { active = id; update() })
  t.classList.add('vs-tabs')
  ready = true
  const run = () => { if (!pending) return; pending = false; update() }
  const schedule = () => {
    if (pending) return
    pending = true
    if (active === 'layers' && ed.doc.nodes.length > 200) { setTimeout(run, 300); return } // big drawings: do not rebuild the list on every drag frame
    requestAnimationFrame(run); setTimeout(run, 120)
  }
  const offs = ['doc', 'sel', 'style', 'hist', 'tool', 'grid'].map((e) => ed.on(e, schedule))
  design.update(); layers.update(); docTab.update()
  return { el: t, update: schedule, show: (id) => t.show(id), destroy: () => offs.forEach((o) => o()) }
}

// ============================ Design ============================
function designTab(ed, api) {
  const el = h('div', { class: 'vs-design' })
  const summary = h('div', { class: 'vs-summary' })

  // ----- appearance -----
  const fillEd = paintEditor({ apply: (p, m) => ed.setStyle({ fill: p }, m || 'fill') })
  const strokeEd = paintEditor({ apply: (p, m) => ed.setStyle({ stroke: p }, m || 'stroke') })
  const sw = num(2, { min: 0, max: 400, step: 0.5, label: 'Stroke width' }, (v) => ed.setStyle({ sw: v }, 'sw'))
  const cap = segmented([['butt', 'Butt'], ['round', 'Round'], ['square', 'Square']], 'butt', (v) => ed.setStyle({ cap: v }, 'cap'), 'Line cap')
  const join = segmented([['miter', 'Miter'], ['round', 'Round'], ['bevel', 'Bevel']], 'miter', (v) => ed.setStyle({ join: v }, 'join'), 'Line join')
  const dash = select([['', 'Solid line'], ['10 6', 'Dashed'], ['2 5', 'Dotted'], ['14 5 2 5', 'Dash dot'], ['24 8', 'Long dashes']], '', (v) => ed.setStyle({ dash: v }, 'dash'))
  dash.setAttribute('aria-label', 'Dash pattern')
  const opacity = num(100, { min: 0, max: 100, label: 'Object opacity' }, (v) => ed.setOpacity(v / 100))
  const evenodd = toggle('Even-odd fill rule', false, (c) => ed.setStyle({ rule: c ? 'evenodd' : 'nonzero' }, 'rule'))
  const paintBox = (title, editor, open) => {
    const chip = h('i', { class: 'vs-chip' }), what = h('span', { class: 'vs-what' })
    const box = h('details', { class: 'vs-paintbox', open }, h('summary', h('span', { class: 'vs-ptitle' }, title), chip, what), editor.el)
    box.sync = (p) => { chip.style.background = swatchCss(p); what.textContent = !p ? 'None' : p.t === 'solid' ? p.c : p.t === 'linear' ? 'Linear gradient' : 'Radial gradient' }
    return box
  }
  const fillBox = paintBox('Fill', fillEd, true), strokeBox = paintBox('Stroke', strokeEd, true)
  const strokeDetails = h('div', { class: 'vs-sec-body' },
    h('div', { class: 'vs-row2' }, mini('Weight', sw, 'px')),
    h('div', { class: 'vs-label' }, 'Line cap'), cap, h('div', { class: 'vs-label' }, 'Line join'), join,
    h('div', { class: 'vs-label' }, 'Dashes'), dash)
  const appearance = section('Appearance', fillBox, strokeBox, h('div', { class: 'vs-row2' }, mini('Opacity', opacity, '%')), strokeDetails, evenodd)

  // ----- transform -----
  const X = num(0, { label: 'X' }, (v) => ed.setBox({ x: v })), Y = num(0, { label: 'Y' }, (v) => ed.setBox({ y: v }))
  let lock = true
  const W = num(0, { min: 0.01, label: 'Width' }, (v) => { const b = ed.box(); if (!b) return; ed.setBox(lock && b.w ? { w: v, h: b.h * (v / b.w) } : { w: v }) })
  const H = num(0, { min: 0.01, label: 'Height' }, (v) => { const b = ed.box(); if (!b) return; ed.setBox(lock && b.h ? { h: v, w: b.w * (v / b.h) } : { h: v }) })
  const lockBtn = ib('link', 'Keep proportions', () => { lock = !lock; lockBtn.classList.toggle('on', lock); lockBtn.replaceChildren(icon(lock ? 'link' : 'unlink')) }, { on: true })
  const angle = num(0, { min: -360, max: 360, label: 'Rotate by' }, (v) => { if (v) ed.rotateBy(v); angle.value = 0 })
  const radius = num(0, { min: 0, label: 'Corner radius' }, (v) => ed.setRadius(v))
  const radiusRow = h('div', { class: 'vs-row2' }, mini('Corner radius', radius, 'px'))
  const transform = section('Transform',
    h('div', { class: 'vs-row2' }, mini('X', X), mini('Y', Y)),
    h('div', { class: 'vs-row2' }, mini('W', W), lockBtn, mini('H', H)),
    radiusRow,
    h('div', { class: 'vs-row2' }, mini('Rotate', angle, 'deg'),
      h('div', { class: 'vs-ibs' }, ib('rotate-ccw', 'Rotate 90 degrees left', () => ed.rotateBy(-90)), ib('rotate-cw', 'Rotate 90 degrees right', () => ed.rotateBy(90)),
        ib('flip-horizontal', 'Flip horizontally', () => ed.flip('h')), ib('flip-vertical', 'Flip vertically', () => ed.flip('v')))))

  // ----- type -----
  const texts = () => ed.nodes.flatMap((n) => leaves(n)).filter((n) => n.type === 'text')
  const editText = (patch, merge) => ed.setText(patch, merge)
  const content = h('textarea', { class: 'vs-textarea', rows: 2, 'aria-label': 'Text content', oninput: () => { const t = texts(); if (t.length) ed.tx('Edit text', () => { for (const n of t) n.text = content.value }, 'textcontent') } })
  const font = select(FONTS, FONTS[0][0], (v) => editText({ ff: v }))
  font.setAttribute('aria-label', 'Font family')
  const fsz = num(48, { min: 1, max: 2000, label: 'Font size' }, (v) => editText({ fs: v }, 'fs'))
  const fw = select([[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black']], 400, (v) => editText({ fw: +v }))
  fw.setAttribute('aria-label', 'Font weight')
  const ital = toggle('Italic', false, (c) => editText({ fi: c }))
  const talign = segmented([['start', 'Left'], ['middle', 'Center'], ['end', 'Right']], 'start', (v) => editText({ ta: v }), 'Text alignment')
  const lh = num(1.2, { min: 0.5, max: 4, step: 0.05, label: 'Line height' }, (v) => editText({ lh: v }, 'lh'))
  const ls = num(0, { min: -50, max: 200, step: 0.5, label: 'Letter spacing' }, (v) => editText({ ls: v }, 'ls'))
  const typeSec = section('Type', content, font, h('div', { class: 'vs-row2' }, mini('Size', fsz, 'px'), fw), talign, h('div', { class: 'vs-row2' }, mini('Line', lh), mini('Spacing', ls)), ital)

  // ----- align / pathfinder / arrange -----
  const alignTo = segmented([['auto', 'Auto'], ['selection', 'Selection'], ['artboard', 'Artboard']], ed.alignTo, (v) => { ed.alignTo = v }, 'Align to')
  const alignSec = section('Align',
    h('div', { class: 'vs-ibs wrap' },
      ib('align-start-vertical', 'Align left', () => ed.align('left')), ib('align-center-vertical', 'Align horizontal centres', () => ed.align('hcenter')), ib('align-end-vertical', 'Align right', () => ed.align('right')),
      ib('align-start-horizontal', 'Align top', () => ed.align('top')), ib('align-center-horizontal', 'Align vertical centres', () => ed.align('vcenter')), ib('align-end-horizontal', 'Align bottom', () => ed.align('bottom')),
      ib('align-horizontal-space-between', 'Distribute horizontally (3 or more)', () => ed.distribute('hspace') || api.toast('Select three or more objects to distribute.')),
      ib('align-vertical-space-between', 'Distribute vertically (3 or more)', () => ed.distribute('vspace') || api.toast('Select three or more objects to distribute.'))),
    h('div', { class: 'vs-label' }, 'Align to'), alignTo)

  const bool = (op, tip) => h('button', { type: 'button', class: 'vs-bool', title: tip, onclick: () => api.boolean(op) }, B(op), h('span', op[0].toUpperCase() + op.slice(1)))
  const anchorsRow = h('div', { class: 'vs-ibs wrap' }, ib('spline', 'Make selected points smooth', () => ed.setSmooth(true)), ib('square', 'Make selected points corners', () => ed.setSmooth(false)), ib('trash-2', 'Delete selected points', () => ed.deleteAnchors()))
  const pathSec = section('Pathfinder',
    h('div', { class: 'vs-bools' }, bool('unite', 'Unite: merge the shapes into one'), bool('subtract', 'Subtract: cut the front shapes out of the back shape'), bool('intersect', 'Intersect: keep only the overlap'), bool('exclude', 'Exclude: keep everything except the overlap')),
    h('div', { class: 'vs-ibs wrap' }, ib('vector-square', 'Convert rectangles and ellipses to editable paths', () => { if (!ed.convertSelectionToPath()) api.toast('Select a rectangle or ellipse to convert.') }), ib('minus', 'Close open paths', () => ed.closeOpenPaths())),
    anchorsRow)

  const arrange = section('Arrange',
    h('div', { class: 'vs-ibs wrap' },
      ib('bring-to-front', 'Bring to front', () => ed.order('front')), ib('arrow-up', 'Bring forward', () => ed.order('forward')), ib('arrow-down', 'Send backward', () => ed.order('backward')), ib('send-to-back', 'Send to back', () => ed.order('back')),
      ib('group', 'Group (Ctrl+G)', () => ed.group()), ib('ungroup', 'Ungroup or release a clipping mask (Ctrl+Shift+G)', () => ed.ungroup()), ib('crop', 'Make clipping mask (Ctrl+7): the top object masks the others', () => api.clip()), ib('copy', 'Duplicate (Ctrl+D)', () => ed.duplicate()), ib('trash-2', 'Delete', () => ed.deleteSelection())))

  el.append(summary, transform, appearance, typeSec, alignSec, pathSec, arrange)

  function update() {
    const nodes = ed.nodes, ls_ = nodes.flatMap((n) => leaves(n)), top = ed.top
    summary.textContent = !nodes.length ? 'Nothing selected. Pick a tool and draw, or click an object.' : top.length > 1 ? `${top.length} objects selected` : `${label(top[0])}${top[0].type === 'group' ? ' (group)' : ''}`
    const styleSrc = ed.style
    fillEd.set(styleSrc.fill); strokeEd.set(styleSrc.stroke)
    fillBox.sync(styleSrc.fill); strokeBox.sync(styleSrc.stroke)
    if (document.activeElement !== sw) sw.set(styleSrc.sw)
    cap.set(styleSrc.cap); join.set(styleSrc.join)
    dash.value = styleSrc.dash || ''
    const op = top.length ? top[0].op : styleSrc.op
    opacity.set(Math.round(op * 100))
    evenodd.input.checked = styleSrc.rule === 'evenodd'
    strokeDetails.hidden = !styleSrc.stroke
    evenodd.hidden = !ls_.some((n) => n.type === 'path') && ed.nodes.length > 0
    const bx = ed.box()
    for (const [i, k] of [[X, 'x'], [Y, 'y'], [W, 'w'], [H, 'h']]) { i.disabled = !bx; i.set(bx ? bx[k] : NaN) }
    const rects = ls_.filter((n) => n.type === 'rect')
    radiusRow.hidden = !rects.length && ed.tool !== 'rect'
    radius.set(rects.length ? rects[0].rx || 0 : ed.tp.radius)
    const tx = ls_.filter((n) => n.type === 'text')
    typeSec.hidden = !tx.length && ed.tool !== 'text'
    const src = tx[0] || ed.tp
    if (document.activeElement !== content) content.value = tx[0]?.text ?? ''
    content.disabled = !tx.length
    font.value = FONTS.find((f) => f[0] === src.ff) ? src.ff : FONTS[0][0]
    fsz.set(src.fs); fw.value = String(src.fw); ital.input.checked = !!src.fi; talign.set(src.ta)
    lh.set(tx[0]?.lh ?? 1.2); ls.set(tx[0]?.ls ?? 0)
    anchorsRow.hidden = !ed.anchors.size
    alignTo.set(ed.alignTo)
  }
  return { el, update }
}

// ============================ Layers ============================
function layersTab(ed) {
  const el = h('div', { class: 'vs-layers-wrap' })
  const list = h('ul', { class: 'vs-layers', role: 'tree', 'aria-label': 'Layers' })
  const open = new Set()
  let dragId = null, renaming = false
  const bar = h('div', { class: 'vs-ibs' },
    ib('bring-to-front', 'Bring to front', () => ed.order('front')), ib('arrow-up', 'Bring forward', () => ed.order('forward')), ib('arrow-down', 'Send backward', () => ed.order('backward')), ib('send-to-back', 'Send to back', () => ed.order('back')),
    ib('group', 'Group', () => ed.group()), ib('ungroup', 'Ungroup', () => ed.ungroup()), ib('trash-2', 'Delete', () => ed.deleteSelection()))
  el.append(bar, list)

  const ICONS = { rect: 'square', ellipse: 'circle', path: 'spline', text: 'type', group: 'folder', image: 'image' }
  function row(n, depth, isMask = false) {
    const sel = ed.sel.includes(n.id)
    const name = h('span', { class: 'vs-lname', title: 'Double-click to rename' }, label(n), isMask && h('em', { class: 'vs-mask' }, ' (mask)'))
    const li = h('li', {
      class: ['vs-layer', sel && 'sel', !n.vis && 'off', n.lock && 'locked', ed.ctx === n.id && 'ctx'], role: 'treeitem', 'aria-selected': String(sel), draggable: true, tabindex: -1, 'data-id': n.id,
      style: { '--d': depth },
      onclick: (e) => { if (e.target.closest('button,input')) return; if (e.shiftKey || e.ctrlKey || e.metaKey) ed.toggleSel(n.id); else ed.setSel([n.id]) },
      ondblclick: (e) => {
        if (e.target.closest('button')) return
        const inp = h('input', { class: 'vs-rename', value: n.name || label(n), 'aria-label': 'Layer name' })
        let finished = false
        renaming = true
        const done = (ok) => { if (finished) return; finished = true; renaming = false; const v = inp.value.trim(); if (ok && v && v !== label(n)) ed.rename(n.id, v); render() }
        inp.addEventListener('keydown', (k) => { k.stopPropagation(); if (k.key === 'Enter') done(true); if (k.key === 'Escape') done(false) })
        inp.addEventListener('blur', () => done(true))
        name.replaceWith(inp); inp.focus(); inp.select()
      },
      ondragstart: (e) => { dragId = n.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', n.id) },
      ondragend: () => { dragId = null; list.querySelectorAll('.drop-above,.drop-below,.drop-into').forEach((x) => x.classList.remove('drop-above', 'drop-below', 'drop-into')) },
      ondragover: (e) => {
        if (!dragId || dragId === n.id) return
        e.preventDefault()
        const r = li.getBoundingClientRect(), y = (e.clientY - r.top) / r.height
        li.classList.remove('drop-above', 'drop-below', 'drop-into')
        li.classList.add(n.type === 'group' && y > 0.3 && y < 0.7 ? 'drop-into' : y < 0.5 ? 'drop-above' : 'drop-below')
      },
      ondragleave: () => li.classList.remove('drop-above', 'drop-below', 'drop-into'),
      ondrop: (e) => {
        if (!dragId) return
        e.preventDefault()
        const where = li.classList.contains('drop-into') ? 'into' : li.classList.contains('drop-above') ? 'after' : 'before'
        li.classList.remove('drop-above', 'drop-below', 'drop-into')
        const id = dragId; dragId = null
        ed.moveNode(id, n.id, where)
      },
    },
    n.type === 'group' ? h('button', { type: 'button', class: 'vs-lbtn', 'aria-label': open.has(n.id) ? 'Collapse group' : 'Expand group', 'aria-expanded': String(open.has(n.id)), onclick: () => { open.has(n.id) ? open.delete(n.id) : open.add(n.id); render() } }, icon(open.has(n.id) ? 'chevron-down' : 'chevron-right')) : h('span', { class: 'vs-lgap' }),
    h('span', { class: 'vs-licon' }, icon(ICONS[n.type] || 'square')), name,
    h('button', { type: 'button', class: 'vs-lbtn', title: n.vis ? 'Hide' : 'Show', 'aria-label': n.vis ? `Hide ${label(n)}` : `Show ${label(n)}`, onclick: () => ed.toggle(n.id, 'vis') }, icon(n.vis ? 'eye' : 'eye-off')),
    h('button', { type: 'button', class: 'vs-lbtn', title: n.lock ? 'Unlock' : 'Lock', 'aria-label': n.lock ? `Unlock ${label(n)}` : `Lock ${label(n)}`, onclick: () => ed.toggle(n.id, 'lock') }, icon(n.lock ? 'lock' : 'lock-open')))
    return li
  }
  function render() {
    const rows = []
    const MAX = 400
    const walkList = (nodes, depth, parent = null) => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        if (rows.length >= MAX) return
        const n = nodes[i]
        rows.push(row(n, depth, !!parent?.clip && i === nodes.length - 1 && nodes.length > 1))
        if (n.kids && open.has(n.id)) walkList(n.kids, depth + 1, n)
      }
    }
    walkList(ed.doc.nodes, 0)
    if (rows.length >= MAX) rows.push(h('li', { class: 'vs-lempty' }, `Showing the top ${MAX} layers. Use groups to organise large drawings.`))
    list.replaceChildren(...(rows.length ? rows : [h('li', { class: 'vs-lempty' }, 'No objects yet. Draw something and it shows up here.')]))
  }
  function update() {
    if (renaming) return
    // open the parents of selected nodes so the selection is visible
    for (const id of ed.sel) { const chain = []; const rec = (nodes, trail) => { for (const n of nodes) { if (n.id === id) { trail.forEach((t) => open.add(t.id)); return true } if (n.kids && rec(n.kids, [...trail, n])) return true } return false }; rec(ed.doc.nodes, chain) }
    render()
  }
  return { el, update }
}

// ============================ Document ============================
function documentTab(ed, api) {
  const el = h('div', { class: 'vs-doc' })
  const preset = select([['custom', 'Custom size'], ...PRESETS.map(([n, w, ht]) => [`${w}x${ht}`, n])], 'custom', (v) => { if (v !== 'custom') { const [w, ht] = v.split('x').map(Number); ed.setArtboard({ w, h: ht }, null); ed.fit() } })
  preset.setAttribute('aria-label', 'Artboard size preset')
  const W = num(1200, { min: 1, max: 20000, label: 'Artboard width' }, (v) => { ed.setArtboard({ w: Math.round(v) }, 'abw'); ed.fit() })
  const Ht = num(800, { min: 1, max: 20000, label: 'Artboard height' }, (v) => { ed.setArtboard({ h: Math.round(v) }, 'abh'); ed.fit() })
  const swap = ib('arrow-left-right', 'Swap width and height', () => { ed.setArtboard({ w: ed.doc.ab.h, h: ed.doc.ab.w }, null); ed.fit() })
  const bg = h('input', { type: 'color', class: 'vs-color', value: '#ffffff', 'aria-label': 'Artboard background', oninput: () => ed.setArtboard({ bg: bg.value }, 'bg') })
  const transp = toggle('Transparent background', false, (c) => ed.setArtboard({ transparent: c }, null))
  const gridOn = toggle('Show grid', false, (c) => { ed.grid.on = c; ed.emit('view'); ed.emit('grid') })
  const gridSnap = toggle('Snap to grid', false, (c) => { ed.grid.snap = c; ed.emit('grid') })
  const gridSize = num(20, { min: 1, max: 500, label: 'Grid size' }, (v) => { ed.grid.size = v; ed.emit('view'); ed.emit('grid') })
  const smart = toggle('Smart guides', true, (c) => { ed.smart = c; ed.emit('grid') })
  const histList = h('ol', { class: 'vs-hist' })
  const historySec = section('History', histList)
  historySec.open = false
  function renderHistory() {
    const u = ed.undoStack, r = ed.redoStack
    const rows = []
    r.slice().reverse().forEach((x, i) => rows.push(h('li', { class: 'redo', onclick: () => ed.jump(-(r.length - i)) }, x.label)))
    rows.push(h('li', { class: 'now' }, u.length ? 'Now' : 'Start'))
    for (let i = u.length - 1; i >= Math.max(0, u.length - 40); i--) rows.push(h('li', { onclick: () => ed.jump(u.length - i) }, u[i].label))
    histList.replaceChildren(...rows)
  }
  el.append(
    section('Artboard', h('div', { class: 'vs-label' }, 'Size'), preset, h('div', { class: 'vs-row2' }, mini('W', W, 'px'), swap, mini('H', Ht, 'px')),
      h('div', { class: 'vs-row2' }, h('label', { class: 'vs-mini' }, h('span', 'Background'), bg), transp),
      h('button', { type: 'button', class: 'vs-wide', onclick: () => ed.fitArtboardToContent() }, icon('scan'), h('span', 'Fit artboard to artwork'))),
    section('Grid and guides', gridOn, gridSnap, h('div', { class: 'vs-row2' }, mini('Grid every', gridSize, 'px')), smart),
    historySec,
    section('Files', h('p', { class: 'vs-hint' }, 'Export SVG, PNG at any scale, or a vector PDF. Your work is saved in this browser automatically.'),
      h('button', { type: 'button', class: 'vs-wide primary', onclick: () => api.exportDialog() }, icon('download'), h('span', 'Export...')),
      h('div', { class: 'vs-row2' },
        h('button', { type: 'button', class: 'vs-wide', onclick: () => api.new() }, icon('file-plus'), h('span', 'New')),
        h('button', { type: 'button', class: 'vs-wide', onclick: () => api.open() }, icon('folder-open'), h('span', 'Open'))),
      h('div', { class: 'vs-row2' },
        h('button', { type: 'button', class: 'vs-wide', onclick: () => api.save() }, icon('save'), h('span', 'Save project')))))
  function update() {
    const { ab } = ed.doc
    if (document.activeElement !== W) W.set(ab.w)
    if (document.activeElement !== Ht) Ht.set(ab.h)
    preset.value = PRESETS.some(([, w, ht]) => w === ab.w && ht === ab.h) ? `${ab.w}x${ab.h}` : 'custom'
    bg.value = ab.bg; transp.input.checked = !!ab.transparent
    gridOn.input.checked = ed.grid.on; gridSnap.input.checked = ed.grid.snap; gridSize.set(ed.grid.size); smart.input.checked = ed.smart
    if (historySec.open) renderHistory()
  }
  historySec.addEventListener('toggle', () => { if (historySec.open) renderHistory() })
  return { el, update }
}
