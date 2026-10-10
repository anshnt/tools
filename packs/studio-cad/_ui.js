// Side panels and dialogs for CAD Studio: layers, properties, drawing settings, export and help.
import { h, icon, clear, modal, toast, download, tabs, busy, button, formatBytes, formatNumber } from '../../lib/ui.js'
import { safeName } from '../../lib/files.js'
import { UNITS, LTYPES, LINEWEIGHTS, PALETTE, defaultsFor, newLayer } from './_doc.js'
import { R2D, D2R, norm, dist, angle, polar } from './_vec.js'
import { measure } from './_ent.js'
import { SNAP_KINDS } from './_snap.js'
import { HATCH_PATTERNS } from './_edit.js'
import { dimLabel } from './_dim.js'
import { exportDxf } from './_dxf.js'
import { PAPERS, SCALES, layout, scaleLabel, toSvg, toPdf, toPngBlob, renderCanvas } from './_export.js'

const round = (v, d = 4) => (Number.isFinite(v) ? +v.toFixed(d) : '')

/** Small floating menu or palette anchored to a button, inside the app root. Click the anchor again or outside to close. */
export function popover(app, anchor, content, { side = 'bottom', cls = '' } = {}) {
  if (app.pop && app.pop.anchor === anchor) { app.pop.close(); return null }
  app.pop?.close()
  const root = app.root
  const pop = h('div', { class: ['cad-pop', cls] }, content)
  root.append(pop)
  const rr = root.getBoundingClientRect(), ar = anchor.getBoundingClientRect()
  let left = side === 'right' ? ar.right - rr.left + 8 : ar.left - rr.left
  let top = side === 'right' ? ar.top - rr.top : ar.bottom - rr.top + 6
  left = Math.max(6, Math.min(left, rr.width - pop.offsetWidth - 6))
  top = Math.max(6, Math.min(top, rr.height - pop.offsetHeight - 6))
  pop.style.left = left + 'px'
  pop.style.top = top + 'px'
  const onDown = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close() }
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
  function close() {
    pop.remove()
    document.removeEventListener('pointerdown', onDown, true)
    document.removeEventListener('keydown', onKey, true)
    if (app.pop === handle) app.pop = null
  }
  const handle = { close, anchor, el: pop }
  app.pop = handle
  setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0)
  document.addEventListener('keydown', onKey, true)
  return handle
}

/** A list of menu items: [{ label, icon, kbd, run }]. */
export function menuItems(app, items, close) {
  return items.map((it) => h('button', { type: 'button', class: 'cad-menu-item', onclick: () => { close?.(); it.run() } }, it.icon && icon(it.icon), h('span', it.label), it.kbd && h('kbd', it.kbd)))
}

const swatch = (hex, label, on, pressed) => h('button', { type: 'button', class: ['cad-sw', hex === '#ffffff' && 'auto'], style: hex === '#ffffff' ? '' : `background:${hex}`, 'aria-label': label, 'aria-pressed': String(!!pressed), onclick: () => on(hex) })

/** Colour choices as a popover. current: hex | null (ByLayer). */
export function colorMenu(app, anchor, current, onPick, { byLayer = true } = {}) {
  let handle
  const pick = (v) => { handle?.close(); onPick(v) }
  const custom = h('input', { type: 'color', class: 'cad-in', value: current && /^#[0-9a-f]{6}$/i.test(current) ? current : '#3e63dd', style: 'height:34px;padding:2px', 'aria-label': 'Custom colour', onchange: (e) => pick(e.target.value) })
  handle = popover(app, anchor, h('div', { class: 'cad-sec', style: 'margin:0' },
    h('div', { class: 'cad-swatches' },
      byLayer && h('button', { type: 'button', class: 'cad-sw bylayer', 'aria-pressed': String(current == null), onclick: () => pick(null) }, 'ByLayer'),
      PALETTE.map(([hex, name]) => swatch(hex, name, pick, current === hex))),
    h('div', { class: 'cad-f', style: 'margin-top:10px' }, h('span', 'Custom colour'), custom)))
}

const field = (label, control, wide) => h('label', { class: ['cad-f', wide && 'wide'] }, h('span', label), control)
function numIn(value, onChange, o = {}) {
  const el = h('input', { class: 'cad-in', type: 'number', step: 'any', value: round(value, o.dp ?? 4), readOnly: !!o.readonly, min: o.min })
  if (!o.readonly) el.addEventListener('change', () => { const n = el.valueAsNumber; if (Number.isFinite(n) && (o.min == null || n >= o.min)) onChange(n); else el.value = round(value, o.dp ?? 4) })
  return el
}
function selIn(options, value, onChange) {
  const el = h('select', { class: 'cad-sel', onchange: (e) => onChange(e.target.value) })
  for (const [v, l] of options) el.append(h('option', { value: v, selected: String(v) === String(value) }, l))
  return el
}

// ---------- Layers ----------
export function layersPanel(app) {
  const el = h('div')
  const doc = () => app.doc
  const setLayers = (label, fn) => doc().commit(label, (tx) => tx.setLayers(fn(doc().layers)))
  const patch = (name, p, label = 'Layer change') => setLayers(label, (ls) => ls.map((l) => (l.name === name ? { ...l, ...p } : l)))
  function render() {
    const counts = new Map()
    for (const e of doc().ents) counts.set(e.layer, (counts.get(e.layer) || 0) + 1)
    const cur = doc().layer(app.cur.layer)
    const rows = doc().layers.map((l) => {
      const row = h('div', { class: ['cad-layer', l.name === app.cur.layer && 'cur', !l.visible && 'off'] },
        h('button', { type: 'button', class: ['cad-btn', !l.visible && 'dim'], 'aria-label': `${l.visible ? 'Hide' : 'Show'} layer ${l.name}`, 'data-tip': l.visible ? 'Hide' : 'Show', onclick: () => patch(l.name, { visible: !l.visible }, l.visible ? 'Hide layer' : 'Show layer') }, icon(l.visible ? 'eye' : 'eye-off')),
        h('button', { type: 'button', class: ['cad-btn', !l.locked && 'dim'], 'aria-label': `${l.locked ? 'Unlock' : 'Lock'} layer ${l.name}`, 'data-tip': l.locked ? 'Unlock' : 'Lock', onclick: () => patch(l.name, { locked: !l.locked }, l.locked ? 'Unlock layer' : 'Lock layer') }, icon(l.locked ? 'lock' : 'lock-open')),
        h('button', { type: 'button', class: 'chip', 'aria-label': `Colour of layer ${l.name}`, style: `background:${l.color === '#ffffff' ? 'linear-gradient(135deg,#fff 50%,#111 50%)' : l.color}`, onclick: (e) => colorMenu(app, e.currentTarget, l.color, (hex) => patch(l.name, { color: hex || '#ffffff' }, 'Layer colour'), { byLayer: false }) }),
        h('button', { type: 'button', class: 'nm', title: `${l.name} (${counts.get(l.name) || 0} objects)`, onclick: () => { app.setCurrentLayer(l.name) } }, l.name),
        h('span', { class: 'small muted', style: 'text-align:right;padding-right:4px;font-size:11px' }, counts.get(l.name) || ''))
      return row
    })
    const name = h('input', { class: 'cad-in', value: cur.name, 'aria-label': 'Layer name', disabled: cur.name === '0', onchange: (e) => rename(cur.name, e.target.value.trim()) })
    const ltype = selIn(Object.entries(LTYPES).map(([k, v]) => [k, v.name]), cur.ltype, (v) => patch(cur.name, { ltype: v }, 'Layer linetype'))
    const lw = selIn(LINEWEIGHTS.map((v) => [v, `${v} mm`]), cur.lw, (v) => patch(cur.name, { lw: +v }, 'Layer lineweight'))
    const addName = h('input', { class: 'cad-in', placeholder: 'New layer name', 'aria-label': 'New layer name', onkeydown: (e) => { if (e.key === 'Enter') add() } })
    function add() {
      const n = addName.value.trim()
      if (!n) return
      if (/[<>/\\":;?*|=`]/.test(n)) return toast('Layer names cannot contain < > / \\ " : ; ? * | = `', 'error')
      if (doc().layers.some((l) => l.name.toLowerCase() === n.toLowerCase())) return toast('A layer with that name already exists.', 'error')
      const color = PALETTE[1 + (doc().layers.length % (PALETTE.length - 1))][0]
      setLayers('New layer', (ls) => [...ls, newLayer(n, { color })])
      app.setCurrentLayer(n)
    }
    function rename(old, next) {
      if (!next || next === old) return
      if (/[<>/\\":;?*|=`]/.test(next) || doc().layers.some((l) => l.name.toLowerCase() === next.toLowerCase())) { toast('Pick a different name: it is empty, already used, or has a character CAD does not allow.', 'error'); return render() }
      const wasCur = app.cur.layer === old
      if (wasCur) app.cur.layer = next
      doc().commit('Rename layer', (tx) => {
        tx.setLayers(doc().layers.map((l) => (l.name === old ? { ...l, name: next } : l)))
        for (const e of doc().ents) if (e.layer === old) tx.replace(e.id, { ...e, layer: next })
      })
      if (wasCur) app.setCurrentLayer(next)
    }
    function remove() {
      const n = counts.get(cur.name) || 0
      if (n) return toast(`Layer "${cur.name}" still has ${n} object${n === 1 ? '' : 's'}. Move or erase them first.`, 'error')
      setLayers('Delete layer', (ls) => ls.filter((l) => l.name !== cur.name))
      app.setCurrentLayer('0')
    }
    clear(el,
      h('p', { class: 'cad-hint' }, 'New objects go on the highlighted layer. Click a layer name to make it current.'),
      h('div', { class: 'cad-layers' }, rows),
      h('div', { class: 'cad-sec', style: 'margin-top:14px' }, h('h4', `Layer: ${cur.name}`),
        h('div', { class: 'cad-grid2' }, field('Name', name, true), field('Linetype', ltype), field('Lineweight', lw)),
        h('div', { style: 'margin-top:8px' }, button('Delete layer', { variant: 'ghost', size: 'sm', icon: 'trash-2', disabled: cur.name === '0', onClick: remove }))),
      h('div', { class: 'cad-add' }, addName, button('Add', { variant: 'secondary', size: 'sm', icon: 'plus', onClick: add })))
  }
  return { el, render }
}

// ---------- Properties ----------
export function propsPanel(app) {
  const el = h('div')
  function render() {
    const ents = app.selected()
    const doc = app.doc
    if (!ents.length) {
      const l = doc.layer(app.cur.layer)
      clear(el,
        h('p', { class: 'cad-hint' }, 'Nothing is selected. These settings apply to the next objects you draw. Click an object to edit it.'),
        h('div', { class: 'cad-sec' }, h('h4', 'New objects'),
          h('div', { class: 'cad-grid2' },
            field('Layer', selIn(doc.layers.map((x) => [x.name, x.name]), l.name, (v) => app.setCurrentLayer(v))),
            field('Colour', colorButton(app.cur.color, doc.layer(app.cur.layer).color, (hex) => { app.cur.color = hex; app.bus.emit('cur') })),
            field('Linetype', selIn([['', `ByLayer (${LTYPES[l.ltype]?.name})`], ...Object.entries(LTYPES).map(([k, v]) => [k, v.name])], app.cur.ltype || '', (v) => { app.cur.ltype = v || null; app.bus.emit('cur') })))))
      return
    }
    const apply = (fn, label = 'Change properties') => doc.commit(label, (tx) => ents.forEach((e) => tx.replace(e.id, fn(e))))
    const same = (get) => { const v = get(ents[0]); return ents.every((e) => get(e) === v) ? v : undefined }
    const layerV = same((e) => e.layer)
    const colorV = same((e) => e.color ?? '')
    const ltV = same((e) => e.ltype ?? '')
    const lwV = same((e) => (e.lw ?? ''))
    const kinds = new Map()
    for (const e of ents) kinds.set(e.type, (kinds.get(e.type) || 0) + 1)
    const title = ents.length === 1 ? `${TYPE_NAMES[ents[0].type]}${ents[0].kind ? ` (${ents[0].kind})` : ''}` : `${ents.length} objects`
    const sub = ents.length > 1 ? [...kinds].map(([k, n]) => `${n} ${TYPE_NAMES[k].toLowerCase()}${n === 1 ? '' : 's'}`).join(', ') : ''
    const general = h('div', { class: 'cad-sec' }, h('h4', title), sub && h('p', { class: 'cad-hint', style: 'margin-top:-4px' }, sub),
      h('div', { class: 'cad-grid2' },
        field('Layer', selIn([...(layerV === undefined ? [['', '*Varies*']] : []), ...doc.layers.map((x) => [x.name, x.name])], layerV ?? '', (v) => v && apply((e) => ({ ...e, layer: v }), 'Change layer'))),
        field('Colour', colorButton(colorV === undefined ? undefined : colorV || null, doc.layer(layerV ?? '0').color, (hex) => apply((e) => ({ ...e, color: hex || undefined })), colorV === undefined)),
        field('Linetype', selIn([...(ltV === undefined ? [['__v', '*Varies*']] : []), ['', 'ByLayer'], ...Object.entries(LTYPES).map(([k, v]) => [k, v.name])], ltV ?? '__v', (v) => v !== '__v' && apply((e) => ({ ...e, ltype: v || undefined })))),
        field('Lineweight', selIn([...(lwV === undefined ? [['__v', '*Varies*']] : []), ['', 'ByLayer'], ...LINEWEIGHTS.map((v) => [v, `${v} mm`])], lwV ?? '__v', (v) => v !== '__v' && apply((e) => ({ ...e, lw: v === '' ? undefined : +v }))))))
    clear(el, general, ents.length === 1 ? geometry(ents[0], (fn) => apply(fn)) : multi(ents, apply), stats(ents))
  }
  function multi(ents, apply) {
    const all = (t) => ents.every((e) => e.type === t)
    const same = (get) => { const v = get(ents[0]); return ents.every((e) => get(e) === v) ? round(v) : '' }
    if (all('dim')) {
      return h('div', { class: 'cad-sec' }, h('h4', 'All dimensions'), h('div', { class: 'cad-grid2' },
        field('Text height', numIn(same((e) => e.th), (v) => apply((e) => ({ ...e, th: v }), 'Dimension text height'), { min: 1e-9 })),
        field('Arrow size', numIn(same((e) => e.as ?? e.th), (v) => apply((e) => ({ ...e, as: v }), 'Dimension arrow size'), { min: 0 })),
        field('Decimals', selIn([0, 1, 2, 3, 4, 5].map((n) => [n, String(n)]), same((e) => e.pr ?? 2), (v) => apply((e) => ({ ...e, pr: +v }), 'Dimension decimals')))))
    }
    if (all('text')) {
      return h('div', { class: 'cad-sec' }, h('h4', 'All text'), h('div', { class: 'cad-grid2' },
        field('Height', numIn(same((e) => e.h), (v) => apply((e) => ({ ...e, h: v }), 'Text height'), { min: 1e-9 })),
        field('Justify', selIn([['l', 'Left'], ['c', 'Centre'], ['r', 'Right']], same((e) => e.align || 'l'), (v) => apply((e) => ({ ...e, align: v }), 'Text justify')))))
    }
    return null
  }
  function stats(ents) {
    let len = 0, area = 0, hasLen = false, hasArea = false
    for (const e of ents) { const m = measure(e); if (m?.length != null) { len += m.length; hasLen = true } if (m?.area != null) { area += m.area; hasArea = true } }
    if (!hasLen && !hasArea) return null
    const u = UNITS[app.doc.settings.units].short
    return h('div', { class: 'cad-sec' }, h('h4', 'Measurements'),
      hasLen && h('div', { class: 'cad-kv' }, 'Length', h('b', `${formatNumber(len, 4)} ${u}`)),
      hasArea && h('div', { class: 'cad-kv' }, 'Area', h('b', `${formatNumber(area, 4)} ${u}²`)))
  }
  function colorButton(value, layerColor, on, varies) {
    const shown = value === undefined ? null : value || layerColor
    const b = h('button', { type: 'button', class: 'cad-in', style: 'display:flex;align-items:center;gap:8px;text-align:left;cursor:pointer', onclick: (e) => colorMenu(app, e.currentTarget, value, on) },
      h('span', { style: `width:16px;height:16px;border-radius:5px;border:1px solid var(--border-strong);flex:none;background:${varies ? 'repeating-linear-gradient(45deg,#bbb,#bbb 3px,#eee 3px,#eee 6px)' : shown === '#ffffff' ? 'linear-gradient(135deg,#fff 50%,#111 50%)' : shown}` }),
      h('span', varies ? '*Varies*' : value ? 'Custom' : 'ByLayer'))
    return b
  }
  function geometry(e, apply) {
    const set = (p, label) => apply((x) => ({ ...x, ...p }), label)
    const g = []
    const u = UNITS[app.doc.settings.units].short
    switch (e.type) {
      case 'line': {
        const L = dist({ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }), A = norm(angle({ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 })) * R2D
        g.push(field('Start X', numIn(e.x1, (v) => set({ x1: v }))), field('Start Y', numIn(e.y1, (v) => set({ y1: v }))), field('End X', numIn(e.x2, (v) => set({ x2: v }))), field('End Y', numIn(e.y2, (v) => set({ y2: v }))),
          field(`Length (${u})`, numIn(L, (v) => { const p = polar({ x: e.x1, y: e.y1 }, A * D2R, v); set({ x2: p.x, y2: p.y }) }, { min: 0 })),
          field('Angle (deg)', numIn(A, (v) => { const p = polar({ x: e.x1, y: e.y1 }, v * D2R, L); set({ x2: p.x, y2: p.y }) })))
        break
      }
      case 'circle':
        g.push(field('Center X', numIn(e.cx, (v) => set({ cx: v }))), field('Center Y', numIn(e.cy, (v) => set({ cy: v }))), field('Radius', numIn(e.r, (v) => set({ r: v }), { min: 1e-9 })), field('Diameter', numIn(e.r * 2, (v) => set({ r: v / 2 }), { min: 1e-9 })))
        break
      case 'arc':
        g.push(field('Center X', numIn(e.cx, (v) => set({ cx: v }))), field('Center Y', numIn(e.cy, (v) => set({ cy: v }))), field('Radius', numIn(e.r, (v) => set({ r: v }), { min: 1e-9 })),
          field('Start angle', numIn(e.a0 * R2D, (v) => set({ a0: norm(v * D2R) }))), field('End angle', numIn(e.a1 * R2D, (v) => set({ a1: norm(v * D2R) }))))
        break
      case 'ellipse': {
        const a = Math.hypot(e.mx, e.my)
        g.push(field('Center X', numIn(e.cx, (v) => set({ cx: v }))), field('Center Y', numIn(e.cy, (v) => set({ cy: v }))),
          field('Major radius', numIn(a, (v) => set({ mx: (e.mx / a) * v, my: (e.my / a) * v }), { min: 1e-9 })),
          field('Minor radius', numIn(a * e.ratio, (v) => set({ ratio: Math.min(1, v / a) }), { min: 1e-9 })),
          field('Rotation', numIn(Math.atan2(e.my, e.mx) * R2D, (v) => set({ mx: Math.cos(v * D2R) * a, my: Math.sin(v * D2R) * a }))))
        break
      }
      case 'polyline': {
        g.push(h('label', { class: 'cad-f wide', style: 'display:flex;flex-direction:row;align-items:center;gap:8px' }, h('input', { type: 'checkbox', checked: !!e.closed, onchange: (ev) => set({ closed: ev.target.checked }, 'Open or close polyline') }), h('span', { style: 'font-size:13px;color:var(--text)' }, 'Closed')))
        if (e.pts.length <= 40) g.push(h('div', { class: 'cad-f wide' }, h('span', `Vertices (${e.pts.length})`), h('div', { class: 'cad-verts' }, e.pts.map((p, i) => h('div', { class: 'cad-grid2' }, h('small', i + 1),
          numIn(p.x, (v) => set({ pts: e.pts.map((q, k) => (k === i ? { ...q, x: v } : q)) })), numIn(p.y, (v) => set({ pts: e.pts.map((q, k) => (k === i ? { ...q, y: v } : q)) })))))))
        else g.push(h('p', { class: 'cad-hint wide' }, `${e.pts.length} vertices. Drag the grips on the canvas to edit.`))
        break
      }
      case 'text':
        g.push(field('Text', h('textarea', { class: 'cad-ta', value: e.text, onchange: (ev) => ev.target.value.trim() && set({ text: ev.target.value }, 'Edit text') }), true),
          field('Height', numIn(e.h, (v) => set({ h: v }), { min: 1e-9 })), field('Rotation', numIn((e.rot || 0) * R2D, (v) => set({ rot: v * D2R }))),
          field('Justify', selIn([['l', 'Left'], ['c', 'Centre'], ['r', 'Right']], e.align || 'l', (v) => set({ align: v }))),
          field('X', numIn(e.x, (v) => set({ x: v }))), field('Y', numIn(e.y, (v) => set({ y: v }))))
        break
      case 'dim':
        g.push(field('Text override', h('input', { class: 'cad-in', value: e.tx || '', placeholder: dimLabel(e), onchange: (ev) => set({ tx: ev.target.value.trim() || undefined }, 'Dimension text') }), true),
          field('Text height', numIn(e.th, (v) => set({ th: v }), { min: 1e-9 })), field('Arrow size', numIn(e.as ?? e.th, (v) => set({ as: v }), { min: 0 })),
          field('Decimals', selIn([0, 1, 2, 3, 4, 5].map((n) => [n, String(n)]), e.pr ?? 2, (v) => set({ pr: +v }))))
        g.push(h('p', { class: 'cad-hint wide' }, 'Drag the grips to move the dimension line or its points. Use <> in the override to keep the measured value (for example "<> typ").'))
        break
      case 'hatch':
        g.push(field('Pattern', selIn(Object.entries(HATCH_PATTERNS).map(([k, v]) => [k, v.name]), e.pattern, (v) => set({ pattern: v }, 'Hatch pattern')), true),
          field('Scale', numIn(e.scale, (v) => set({ scale: v }), { min: 1e-9 })), field('Angle', numIn(e.angle, (v) => set({ angle: v }))))
        break
      default: break
    }
    return h('div', { class: 'cad-sec' }, h('h4', 'Geometry'), h('div', { class: 'cad-grid2' }, g))
  }
  return { el, render }
}

const TYPE_NAMES = { line: 'Line', circle: 'Circle', arc: 'Arc', ellipse: 'Ellipse', polyline: 'Polyline', text: 'Text', dim: 'Dimension', hatch: 'Hatch' }

// ---------- Drawing settings ----------
export function drawingPanel(app) {
  const el = h('div')
  function render() {
    const doc = app.doc, s = doc.settings
    const set = (p) => doc.commit('Drawing settings', (tx) => tx.setSettings(p))
    const units = selIn(Object.entries(UNITS).map(([k, v]) => [k, v.name]), s.units, (v) => {
      if (!doc.ents.length) set({ units: v, ...defaultsFor(v) })
      else set({ units: v })
      app.last.hatch.scale = doc.settings.hatchScale
      app.bus.emit('view')
    })
    const ext = doc.extents()
    const u = UNITS[s.units].short
    const polar = selIn([15, 22.5, 30, 45, 90].map((v) => [v, `${v}°`]), app.modes.polarInc, (v) => { app.modes.polarInc = +v; app.savePrefs() })
    clear(el,
      h('div', { class: 'cad-sec' }, h('h4', 'Units and grid'),
        h('div', { class: 'cad-grid2' },
          field('Drawing units', units, true),
          field(`Grid spacing (${u})`, numIn(s.gridStep, (v) => set({ gridStep: v }), { min: 1e-9 })),
          field('Decimals shown', selIn([0, 1, 2, 3, 4].map((n) => [n, String(n)]), s.prec, (v) => set({ prec: +v }))),
          field('Polar step', polar),
          field('Linetype scale', numIn(s.ltscale, (v) => set({ ltscale: v }), { min: 1e-9 })))),
      h('div', { class: 'cad-sec' }, h('h4', 'New text and dimensions'),
        h('div', { class: 'cad-grid2' },
          field(`Text height (${u})`, numIn(s.textH, (v) => set({ textH: v }), { min: 1e-9 })),
          field(`Dim text height`, numIn(s.dimTh, (v) => set({ dimTh: v }), { min: 1e-9 })),
          field('Dim arrow size', numIn(s.dimAs, (v) => set({ dimAs: v }), { min: 0 })),
          field('Dim decimals', selIn([0, 1, 2, 3, 4].map((n) => [n, String(n)]), s.dimPr, (v) => set({ dimPr: +v }))),
          field('Hatch scale', numIn(s.hatchScale, (v) => { set({ hatchScale: v }); app.last.hatch.scale = v }, { min: 1e-9 })))),
      h('div', { class: 'cad-sec' }, h('h4', 'Cursor'), h('label', { style: 'display:flex;align-items:center;gap:8px;font-size:13px' }, h('input', { type: 'checkbox', checked: !!app.modes.crosshair, onchange: (e) => { app.modes.crosshair = e.target.checked; app.savePrefs(); app.render() } }), 'Crosshair across the whole canvas while drawing')),
      h('div', { class: 'cad-sec' }, h('h4', 'Object snaps'),
        h('div', { class: 'cad-grid2' }, SNAP_KINDS.map(([k, label]) => h('label', { style: 'display:flex;align-items:center;gap:8px;font-size:13px' },
          h('input', { type: 'checkbox', checked: !!app.modes.kinds[k], onchange: (e) => { app.modes.kinds[k] = e.target.checked; app.savePrefs(); app.render() } }), label)))),
      h('div', { class: 'cad-sec' }, h('h4', 'This drawing'),
        h('div', { class: 'cad-kv' }, 'Objects', h('b', formatNumber(doc.ents.length, 0))),
        h('div', { class: 'cad-kv' }, 'Layers', h('b', doc.layers.length)),
        ext && h('div', { class: 'cad-kv' }, 'Extents', h('b', `${formatNumber(ext.x1 - ext.x0, 2)} x ${formatNumber(ext.y1 - ext.y0, 2)} ${u}`))),
      button('Keyboard shortcuts and commands', { icon: 'keyboard', variant: 'secondary', size: 'sm', onClick: () => helpDialog() }))
  }
  return { el, render }
}

// ---------- Dialogs ----------
export function helpDialog() {
  const row = (k, d) => h('tr', h('td', h('kbd', k)), h('td', d))
  const body = h('div', { class: 'prose t-cad-dlg', style: 'font-size:14px' },
    h('h3', 'Commands'),
    h('p', 'Click a tool or type its name in the command line, then press Enter or Space. Enter or Space on an empty line repeats the last command. Esc cancels.'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('tbody',
      row('L  PL  REC', 'Line, polyline (Arc option), rectangle'), row('C  A  EL', 'Circle (2P, 3P), arc (Center option), ellipse'), row('T  H', 'Text, hatch (click inside a closed shape)'),
      row('M  CO  RO  SC  MI', 'Move, copy, rotate, scale, mirror'), row('O  TR  EX  F  CHA', 'Offset, trim, extend, fillet, chamfer'), row('E  X  AR', 'Erase, explode, array'),
      row('DIM  DLI  DAL  DRA  DDI  DAN', 'Dimensions: auto, linear, aligned, radius, diameter, angular'), row('DI  AREA  ID', 'Measure distance, area, point'), row('Z  ZE  P', 'Zoom, zoom extents, pan')))),
    h('h3', 'Typing points'),
    h('p', 'Absolute ', h('code', '10,20'), '. Relative to the last point ', h('code', '@5,3'), '. Polar ', h('code', '@10<45'), ' (distance, angle in degrees). Or just a number: the point is that far from the last one in the cursor direction (direct distance entry).'),
    h('h3', 'Keys'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('tbody',
      row('Ctrl+Z / Ctrl+Y', 'Undo / redo'), row('Ctrl+C / X / V / D', 'Copy, cut, paste, duplicate'), row('Ctrl+A', 'Select all'), row('Delete', 'Erase selection'), row('Arrow keys', 'Nudge selection'),
      row('F3 F7 F8 F9 F10', 'Object snap, grid, ortho, snap to grid, polar'), row('Wheel / pinch', 'Zoom at the cursor'), row('Middle drag or Space+drag', 'Pan'), row('Drag left to right', 'Window select (inside)'), row('Drag right to left', 'Crossing select (touching)'),
      row('Shift+click', 'Add or remove from the selection (Shift in Trim extends)'), row('Right click / Enter', 'Finish or repeat')))))
  modal({ title: 'Keyboard shortcuts and commands', icon: 'keyboard', body })
}

const EXPORT_NOTES = {
  dxf: 'ASCII DXF (R2000) with layers, colours, linetypes and lineweights. Dimensions are written as lines, arrowheads and text so every CAD program shows them the same way.',
  svg: 'Scalable vector graphics, one group per layer. Line weights are in millimetres on the chosen paper size.',
  pdf: 'A true vector PDF, to scale. Pick a paper size and scale, or fit the drawing to the page.',
  png: 'A raster image on a white background (or transparent).',
}

export function exportDialog(app, initial = 'pdf') {
  const doc = app.doc
  if (!doc.ents.length) return toast('The drawing is empty. Draw something first.', 'info')
  const base = () => safeName(doc.name || 'drawing')
  const opts = { paper: 'A4', orient: 'auto', scale: 'fit', margin: 10, mono: false, px: 2000, transparent: false }
  const preview = h('canvas', { style: 'width:100%;height:200px;border:1px solid var(--border);border-radius:10px;background:#fff;object-fit:contain', 'aria-label': 'Preview of the drawing' })
  const drawPreview = () => {
    const c = renderCanvas(doc, { px: 900, maxPx: 400, mono: opts.mono })
    preview.width = c.width; preview.height = c.height
    preview.getContext('2d').drawImage(c, 0, 0)
  }
  const info = h('p', { class: 'cad-hint', style: 'margin:0' })
  const plotOpts = () => ({ paper: opts.paper, orient: opts.orient, scale: opts.scale === 'fit' ? 'fit' : +opts.scale, margin: opts.margin, mono: opts.mono, background: '#ffffff' })
  const updateInfo = () => {
    const L = layout(doc, plotOpts())
    info.textContent = `${opts.paper === 'drawing' ? 'Custom page' : opts.paper} ${formatNumber(L.pw, 0)} x ${formatNumber(L.ph, 0)} mm, scale ${scaleLabel(L)}.${L.overflow ? ' The drawing is larger than the page at this scale.' : ''}`
  }
  const f = (label, control) => h('label', { class: 'cad-f' }, h('span', label), control)
  const plotControls = () => h('div', { class: 'cad-grid2' },
    f('Paper', selIn([...Object.keys(PAPERS).map((k) => [k, k]), ['drawing', 'Drawing size']], opts.paper, (v) => { opts.paper = v; updateInfo() })),
    f('Orientation', selIn([['auto', 'Automatic'], ['landscape', 'Landscape'], ['portrait', 'Portrait']], opts.orient, (v) => { opts.orient = v; updateInfo() })),
    f('Scale', selIn(SCALES.map(([v, l]) => [v, l]), opts.scale, (v) => { opts.scale = v; updateInfo() })),
    f('Margin (mm)', numIn(opts.margin, (v) => { opts.margin = Math.max(0, v); updateInfo() }, { dp: 1 })),
    h('label', { class: 'cad-f wide', style: 'flex-direction:row;display:flex;align-items:center;gap:8px' }, h('input', { type: 'checkbox', onchange: (e) => { opts.mono = e.target.checked; drawPreview() } }), h('span', { style: 'font-size:13px;color:var(--text)' }, 'Print everything in black')))
  const dl = (label, fn, name, ext) => {
    const b = button(label, { icon: 'download', variant: 'primary', block: true })
    b.addEventListener('click', () => busy(b, async () => { const blob = await fn(); download(blob, `${base()}.${ext}`); toast(`Saved ${base()}.${ext} (${formatBytes(blob.size)})`, 'success') }, { label: 'Preparing' }))
    return b
  }
  const pane = (kind, ...rest) => h('div', { class: 'stack', style: 'gap:12px' }, h('p', { class: 'cad-hint', style: 'margin:0' }, EXPORT_NOTES[kind]), ...rest)
  const t = tabs([
    { id: 'pdf', label: 'PDF', render: () => pane('pdf', plotControls(), info, dl('Download PDF', () => toPdf(doc, plotOpts()), base(), 'pdf')) },
    { id: 'dxf', label: 'DXF', render: () => pane('dxf', h('div', { class: 'cad-kv' }, 'Objects', h('b', doc.ents.length)), h('div', { class: 'cad-kv' }, 'Layers', h('b', doc.layers.length)), dl('Download DXF', () => new Blob([exportDxf(doc)], { type: 'application/dxf' }), base(), 'dxf')) },
    { id: 'svg', label: 'SVG', render: () => pane('svg', plotControls(), info, dl('Download SVG', () => new Blob([toSvg(doc, plotOpts())], { type: 'image/svg+xml' }), base(), 'svg')) },
    { id: 'png', label: 'PNG', render: () => pane('png', h('div', { class: 'cad-grid2' },
      f('Width', selIn([[1000, '1000 px'], [2000, '2000 px'], [4000, '4000 px'], [8000, '8000 px']], opts.px, (v) => { opts.px = +v })),
      h('label', { class: 'cad-f', style: 'flex-direction:row;display:flex;align-items:center;gap:8px;align-self:end;height:32px' }, h('input', { type: 'checkbox', onchange: (e) => { opts.transparent = e.target.checked } }), h('span', { style: 'font-size:13px;color:var(--text)' }, 'Transparent background'))),
      dl('Download PNG', () => toPngBlob(doc, { px: opts.px, transparent: opts.transparent, mono: opts.mono }), base(), 'png')) },
  ], initial, () => { updateInfo() })
  const body = h('div', { class: 'stack t-cad-dlg', style: 'gap:12px;min-width:min(520px,100%)' }, preview, t)
  const m = modal({ title: 'Export drawing', icon: 'download', body })
  requestAnimationFrame(() => { drawPreview(); updateInfo() })
  return m
}

