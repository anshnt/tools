// The inspector: composition settings, layer properties with keyframe controls, content, effects, text animators, presets and keyframe easing.
import { h, svg, icon, button, select, toggle, segmented, toast } from '../../lib/ui.js'
import { pickFiles } from '../../lib/files.js'
import { valueAt, setValue, setKey, removeKey, enableAnim, disableAnim, isAnimated, keyAt, prevKey, nextKey, clamp, clone, EASES, EASE, easeName } from './_anim.js'
import { BLENDS, FONTS, SHAPES, SIZE_PRESETS, EFFECTS, PROP_DEFS, COMP_LIMITS, makeEffect, findLayer, resolveProp, walk } from './_model.js'
import { HAS_FILTER } from './_render.js'
import { PRESETS, applyPreset } from './_presets.js'
import { tip, numField, section, round } from './_ui.js'
import * as ops from './_ops.js'

const SHORT = { anchor: 'Anchor', position: 'Position', scale: 'Scale', rotation: 'Rotation', opacity: 'Opacity', trimStart: 'Start', trimEnd: 'End', trimOffset: 'Offset' }
const WEIGHTS = [[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black']]

export function createInspector({ store, onKeyed }) {
  const el = h('div', { class: 'ms-insp-body' })
  let syncers = [], lastSig = '', lastId = '', linkScale = true, wantText = false

  const live = (id) => findLayer(store.doc, id)?.layer

  function signature() {
    const sel = store.selected
    if (sel.length !== 1) return `${sel.length ? 'multi' : 'none'}:${store.sel.join(',')}`
    const L = sel[0]
    return [L.id, L.type, L.data?.kind, L.data?.fillOn, L.effects.map((e) => e.id).join(), (L.animators || []).map((a) => a.id).join(), [...store.kfSel].join(), HAS_FILTER].join('|')
  }

  // ---------- generic rows ----------
  const frow = (label, ...kids) => h('div', { class: 'ms-field' }, h('span', { class: 'ms-fl' }, label), h('div', { class: 'ms-fc' }, kids))
  const reg = (fn) => { syncers.push(fn); fn() }

  // ---------- animatable property row ----------
  function propRow(id, key, def, label) {
    const getP = () => { const L = live(id); return L && resolveProp(L, key) }
    const dim = def.dim
    const t = () => store.time
    const edit = (fn, merge) => store.edit(`Set ${label}`, (doc) => { const p = resolveProp(findLayer(doc, id).layer, key); if (p) fn(p) }, merge)
    const inputs = (dim === 2 ? ['X', 'Y'] : ['']).map((lab, i) => numField({
      label: lab, value: 0, step: def.step || 1, min: def.min, max: def.max, ariaLabel: `${label} ${lab}`.trim(),
      onInput: (v) => edit((p) => {
        if (dim === 1) return setValue(p, t(), v)
        const cur = clone(valueAt(p, t()))
        if (key === 'scale' && linkScale && cur[i]) { const r = v / cur[i]; cur[0] *= r; cur[1] *= r } else cur[i] = v
        setValue(p, t(), cur)
      }, `${id}:${key}:${i}`),
    }))
    const sw = h('button', { type: 'button', class: 'ms-sw', 'aria-label': `Animate ${label}`, onclick: () => edit((p) => (isAnimated(p) ? disableAnim(p, t()) : enableAnim(p, t()))) }, icon('timer'))
    const prev = h('button', { type: 'button', class: 'ms-kn', onclick: () => { const k = prevKey(getP(), t()); if (k) store.setTime(k.t) } }, icon('chevron-left'))
    const next = h('button', { type: 'button', class: 'ms-kn', onclick: () => { const k = nextKey(getP(), t()); if (k) store.setTime(k.t) } }, icon('chevron-right'))
    const diamond = h('button', {
      type: 'button', class: 'ms-kn dia', 'aria-label': `Add or remove a keyframe for ${label}`,
      onclick: () => { edit((p) => { const k = keyAt(p, t()); if (k) removeKey(p, k.id); else if (isAnimated(p)) setKey(p, t(), valueAt(p, t())); else enableAnim(p, t()) }); onKeyed?.(id) },
    }, icon('diamond'))
    tip(sw, 'Stopwatch: animate this property'); tip(prev, 'Previous keyframe'); tip(next, 'Next keyframe'); tip(diamond, 'Add or remove a keyframe at the playhead')
    const row = h('div', { class: ['ms-prop', dim === 2 && 'two'], dataset: { key } },
      sw, h('span', { class: 'ms-pl', title: label }, SHORT[key] || label), h('div', { class: 'ms-pv' }, inputs), h('div', { class: 'ms-nav' }, prev, diamond, next))
    if (key === 'scale') {
      const link = h('button', { type: 'button', class: 'ms-kn link', 'aria-pressed': String(linkScale), onclick: () => { linkScale = !linkScale; link.setAttribute('aria-pressed', String(linkScale)) } }, icon('link'))
      tip(link, 'Keep proportions')
      row.querySelector('.ms-pv').append(link)
    }
    reg(() => {
      const p = getP()
      if (!p) return
      const v = valueAt(p, t())
      ;(dim === 2 ? v : [v]).forEach((n, i) => inputs[i].setValue(n))
      const anim = isAnimated(p)
      sw.classList.toggle('on', anim); sw.setAttribute('aria-pressed', String(anim))
      diamond.classList.toggle('on', !!keyAt(p, t()))
      prev.disabled = !prevKey(p, t()); next.disabled = !nextKey(p, t())
      diamond.disabled = false
    })
    return row
  }

  // ---------- static data rows ----------
  function dataSetter(id, label) {
    return (key, v) => store.edit(`Edit ${label}`, (doc) => { findLayer(doc, id).layer.data[key] = v }, `${id}:d:${key}`)
  }
  function dNum(id, label, key, o = {}) {
    const set = dataSetter(id, label)
    const nf = numField({ label: o.unit || '', value: 0, step: o.step || 1, min: o.min, max: o.max, ariaLabel: label, onInput: (v) => set(key, v) })
    reg(() => nf.setValue(live(id)?.data[key]))
    return frow(label, nf)
  }
  function dColor(id, label, key) {
    const set = dataSetter(id, label)
    const inp = h('input', { type: 'color', class: 'ms-color', 'aria-label': label, oninput: () => set(key, inp.value) })
    reg(() => { const v = live(id)?.data[key]; if (v && /^#[0-9a-f]{6}$/i.test(v)) inp.value = v })
    return frow(label, inp)
  }
  function dSelect(id, label, key, options, parse = (v) => v) {
    const set = dataSetter(id, label)
    const s = select(options, '', (v) => set(key, parse(v)))
    reg(() => { const v = live(id)?.data[key]; if (v != null) s.value = String(v) })
    return frow(label, s)
  }
  function dToggle(id, label, key) {
    const set = dataSetter(id, label)
    const t = toggle(label, false, (c) => set(key, c))
    reg(() => { t.input.checked = !!live(id)?.data[key] })
    return h('div', { class: 'ms-field wide' }, t)
  }

  // ---------- sections ----------
  function compSection() {
    const c = () => store.comp
    const edit = (label, fn, merge) => store.edit(label, (doc) => fn(doc.comp, doc), merge)
    const name = h('input', { class: 'input', 'aria-label': 'Composition name', oninput: (e) => edit('Rename composition', (cp) => { cp.name = e.target.value.slice(0, 80) }, 'comp:name') })
    const sizeSel = select([...SIZE_PRESETS, ['custom', 'Custom']], 'custom', (v) => {
      if (v === 'custom') return
      const [w, hh] = v.split('x').map(Number)
      edit('Composition size', (cp) => { cp.width = w; cp.height = hh })
    })
    const dim = (key, lab) => numField({ label: lab, value: 0, step: 1, min: COMP_LIMITS.minSize, max: COMP_LIMITS.maxSize, ariaLabel: lab === 'W' ? 'Width' : 'Height', onInput: (v) => edit('Composition size', (cp) => { cp[key] = Math.round(v) }, `comp:${key}`) })
    const w = dim('width', 'W'), hh = dim('height', 'H')
    const fps = select([12, 15, 24, 25, 30, 50, 60].map((n) => [n, `${n} fps`]), 30, (v) => edit('Frame rate', (cp) => { cp.fps = +v }))
    const dur = numField({ label: 's', value: 5, step: 0.5, min: 0.1, max: COMP_LIMITS.maxDuration, ariaLabel: 'Duration in seconds', onInput: (v) => edit('Composition duration', (cp, doc) => {
      const old = cp.duration
      cp.duration = v
      walk(doc.layers, (L) => { if (L.outPoint >= old - 1e-6 || L.outPoint > v) L.outPoint = v; if (L.inPoint >= v) L.inPoint = Math.max(0, v - 1 / cp.fps) })
    }, 'comp:duration') })
    const bg = h('input', { type: 'color', class: 'ms-color', 'aria-label': 'Background colour', oninput: (e) => edit('Background colour', (cp) => { cp.bg = e.target.value }, 'comp:bg') })
    const tr = toggle('Transparent background (PNG sequence and GIF keep it)', false, (v) => edit('Transparent background', (cp) => { cp.transparent = v }))
    reg(() => {
      const cp = c()
      if (document.activeElement !== name) name.value = cp.name
      sizeSel.value = SIZE_PRESETS.some((p) => p[0] === `${cp.width}x${cp.height}`) ? `${cp.width}x${cp.height}` : 'custom'
      w.setValue(cp.width); hh.setValue(cp.height); fps.value = String(cp.fps); dur.setValue(cp.duration); bg.value = cp.bg; tr.input.checked = cp.transparent
    })
    return section('Composition', [frow('Name', name), frow('Size', sizeSel), frow('Pixels', w, hh), frow('Frame rate', fps), frow('Duration', dur), frow('Background', bg), h('div', { class: 'ms-field wide' }, tr)])
  }

  function layerSection(id) {
    const L = live(id)
    const edit = (label, fn, merge) => store.edit(label, (doc) => fn(findLayer(doc, id).layer, doc), merge)
    const name = h('input', { class: 'input', 'aria-label': 'Layer name', oninput: (e) => edit('Rename layer', (l) => { l.name = e.target.value.slice(0, 80) || l.name }, `${id}:name`) })
    const blend = select(BLENDS, 'source-over', (v) => edit('Blend mode', (l) => { l.blend = v }))
    const inN = numField({ label: 'In', value: 0, step: 0.1, min: 0, ariaLabel: 'In point in seconds', onInput: (v) => ops.setRange(store, id, v, null) })
    const outN = numField({ label: 'Out', value: 0, step: 0.1, min: 0, ariaLabel: 'Out point in seconds', onInput: (v) => ops.setRange(store, id, null, v) })
    reg(() => {
      const l = live(id)
      if (!l) return
      if (document.activeElement !== name) name.value = l.name
      blend.value = l.blend; inN.setValue(round(l.inPoint, 3)); outN.setValue(round(l.outPoint, 3))
    })
    const acts = h('div', { class: 'ms-acts' },
      tip(button('', { icon: 'arrow-up', variant: 'ghost', size: 'sm', ariaLabel: 'Move layer up', onClick: () => ops.moveLayer(store, id, 'up') }), 'Move up', 'Ctrl ]'),
      tip(button('', { icon: 'arrow-down', variant: 'ghost', size: 'sm', ariaLabel: 'Move layer down', onClick: () => ops.moveLayer(store, id, 'down') }), 'Move down', 'Ctrl ['),
      tip(button('', { icon: 'copy', variant: 'ghost', size: 'sm', ariaLabel: 'Duplicate layer', onClick: () => ops.duplicateLayers(store) }), 'Duplicate', 'Ctrl D'),
      tip(button('', { icon: 'folder', variant: 'ghost', size: 'sm', ariaLabel: 'Group layer', onClick: () => ops.groupLayers(store) }), 'Group', 'Ctrl G'),
      L.type === 'group' ? tip(button('', { icon: 'folder-open', variant: 'ghost', size: 'sm', ariaLabel: 'Ungroup', onClick: () => ops.ungroupLayer(store, id) }), 'Ungroup', 'Ctrl Shift G') : null,
      tip(button('', { icon: 'trash-2', variant: 'ghost', size: 'sm', ariaLabel: 'Delete layer', onClick: () => ops.deleteLayers(store) }), 'Delete', 'Del'))
    return section('Layer', [frow('Name', name), acts, frow('Blend', blend), frow('Time', inN, outN)])
  }

  function transformSection(id) {
    return section('Transform', ['anchor', 'position', 'scale', 'rotation', 'opacity'].map((k) => propRow(id, k, PROP_DEFS[k], PROP_DEFS[k].label)))
  }

  function contentSection(id, L) {
    const d = L.data
    if (L.type === 'text') {
      const text = h('textarea', { class: 'textarea ms-text', rows: 3, 'aria-label': 'Text', spellcheck: false, oninput: () => dataSetter(id, 'text')('text', text.value) })
      reg(() => { if (document.activeElement !== text) text.value = live(id)?.data.text ?? '' })
      const align = segmented([['left', 'Left'], ['center', 'Center'], ['right', 'Right']], d.align, (v) => dataSetter(id, 'alignment')('align', v), 'Text alignment')
      reg(() => align.set(live(id)?.data.align))
      if (wantText) { wantText = false; setTimeout(() => { text.focus(); text.select() }, 30) }
      return section('Text', [
        h('div', { class: 'ms-field wide' }, text),
        dSelect(id, 'Font', 'font', FONTS),
        dNum(id, 'Size', 'size', { min: 1, max: 2000, unit: 'px' }),
        dSelect(id, 'Weight', 'weight', WEIGHTS, Number),
        dToggle(id, 'Italic', 'italic'),
        frow('Align', align),
        dNum(id, 'Tracking', 'tracking', { min: -50, max: 500, unit: 'px' }),
        dNum(id, 'Line height', 'lineHeight', { min: 0.5, max: 4, step: 0.05 }),
        dColor(id, 'Fill', 'fill'), dColor(id, 'Outline', 'stroke'), dNum(id, 'Outline width', 'strokeWidth', { min: 0, max: 200, unit: 'px' }),
      ])
    }
    if (L.type === 'shape') {
      const k = d.kind
      return section('Shape', [
        dSelect(id, 'Kind', 'kind', SHAPES),
        dNum(id, k === 'line' ? 'Length' : 'Width', 'w', { min: 1, max: 20000, unit: 'px' }),
        k === 'line' ? null : dNum(id, 'Height', 'h', { min: 1, max: 20000, unit: 'px' }),
        k === 'rect' ? dNum(id, 'Corner radius', 'radius', { min: 0, max: 5000, unit: 'px' }) : null,
        k === 'polygon' || k === 'star' ? dNum(id, k === 'star' ? 'Points' : 'Sides', 'sides', { min: 3, max: 40 }) : null,
        k === 'star' ? dNum(id, 'Inner radius', 'inner', { min: 1, max: 100, unit: '%' }) : null,
        k === 'line' ? null : dToggle(id, 'Fill', 'fillOn'),
        k === 'line' ? null : dColor(id, 'Fill colour', 'fill'),
        dColor(id, 'Stroke colour', 'stroke'), dNum(id, 'Stroke width', 'strokeWidth', { min: 0, max: 500, unit: 'px' }),
        dSelect(id, 'Line caps', 'cap', [['round', 'Round'], ['butt', 'Flat'], ['square', 'Square']]),
      ])
    }
    if (L.type === 'solid') return section('Solid', [dColor(id, 'Colour', 'color'), dNum(id, 'Width', 'w', { min: 1, max: 20000, unit: 'px' }), dNum(id, 'Height', 'h', { min: 1, max: 20000, unit: 'px' })])
    if (L.type === 'image') {
      const asset = store.assets.get(d.asset)
      const swap = button('Replace image', { icon: 'image', size: 'sm', onClick: async () => {
        const [f] = await pickFiles({ accept: 'image/*' })
        if (!f) return
        try {
          const a = await store.addAsset(f)
          store.edit('Replace image', (doc) => { const l = findLayer(doc, id).layer; l.data.asset = a.id; l.data.w = a.w; l.data.h = a.h })
        } catch (e) { toast(e.message, 'error') }
      } })
      const reset = button('Original size', { icon: 'maximize', size: 'sm', onClick: () => { if (asset) store.edit('Original size', (doc) => { const l = findLayer(doc, id).layer; l.data.w = asset.w; l.data.h = asset.h }) } })
      return section('Image', [h('div', { class: 'ms-note' }, asset ? `${asset.name} (${asset.w} x ${asset.h})` : 'Image data is missing.'),
        dNum(id, 'Width', 'w', { min: 1, max: 20000, unit: 'px' }), dNum(id, 'Height', 'h', { min: 1, max: 20000, unit: 'px' }), h('div', { class: 'ms-acts' }, swap, reset)])
    }
    return section('Group', [h('div', { class: 'ms-note' }, 'Layers inside a group move, scale, rotate and fade together. Expand the group in the timeline to edit its layers.')])
  }

  function trimSection(id) {
    return section('Trim paths', [h('div', { class: 'ms-note' }, 'Draws the stroke on or off. Animate End from 0 to 100 for a draw-on. Needs a stroke width above 0.'),
      ...['trimStart', 'trimEnd', 'trimOffset'].map((k) => propRow(id, k, PROP_DEFS[k], PROP_DEFS[k].label))])
  }

  function animatorsSection(id, L) {
    const items = L.animators.map((a) => {
      const set = (fn, label) => store.edit(label, (doc) => fn(findLayer(doc, id).layer.animators.find((x) => x.id === a.id)))
      const unit = select([['chars', 'Characters'], ['words', 'Words'], ['lines', 'Lines']], a.unit, (v) => set((x) => { x.unit = v }, 'Animator unit'))
      const shape = select([['square', 'Hard edge'], ['ramp', 'Ramp'], ['smooth', 'Smooth bell']], a.shape, (v) => set((x) => { x.shape = v }, 'Animator shape'))
      const en = toggle('On', a.enabled, (v) => set((x) => { x.enabled = v }, 'Toggle animator'))
      return h('div', { class: 'ms-card' },
        h('div', { class: 'ms-card-h' }, h('strong', a.name), en, tip(button('', { icon: 'trash-2', variant: 'ghost', size: 'sm', ariaLabel: `Remove ${a.name}`, onClick: () => store.edit('Remove animator', (doc) => { const l = findLayer(doc, id).layer; l.animators = l.animators.filter((x) => x.id !== a.id) }) }), 'Remove')),
        frow('Per', unit), frow('Range', shape),
        ...Object.keys(a.props).map((k) => propRow(id, `an:${a.id}:${k}`, { dim: k === 'position' || k === 'scale' ? 2 : 1, step: 1, ...(k === 'opacity' ? { min: 0, max: 100 } : {}) }, k[0].toUpperCase() + k.slice(1))))
    })
    const picker = select([['', 'Add animator...'], ...PRESETS.filter((p) => p.group === 'Text').map((p) => [p.id, p.label])], '', (v) => {
      if (!v) return
      runPreset(PRESETS.find((p) => p.id === v))
      picker.value = ''
    })
    return section('Text animators', [h('div', { class: 'ms-note' }, 'Each animator moves, fades or scales characters, words or lines inside a range. Animate the range to sweep the effect across the text.'), ...items, frow('', picker)])
  }

  function effectsSection(id, L) {
    const items = L.effects.map((fx) => {
      const def = EFFECTS[fx.type]
      const set = (fn, label) => store.edit(label, (doc) => fn(findLayer(doc, id).layer.effects.find((x) => x.id === fx.id)), `${fx.id}:opt`)
      const en = toggle('On', fx.enabled, (v) => set((x) => { x.enabled = v }, 'Toggle effect'))
      const color = fx.type === 'shadow' || fx.type === 'glow' ? (() => {
        const inp = h('input', { type: 'color', class: 'ms-color', 'aria-label': `${def.label} colour`, value: fx.opts.color || '#ffffff', oninput: () => set((x) => { x.opts.color = inp.value }, 'Effect colour') })
        const own = fx.type === 'glow' ? tip(button('Layer colours', { size: 'sm', variant: 'ghost', onClick: () => set((x) => { x.opts.color = '' }, 'Glow colour') }), 'Glow in the layer\'s own colours') : null
        return frow('Colour', inp, own)
      })() : null
      return h('div', { class: 'ms-card' },
        h('div', { class: 'ms-card-h' }, h('strong', def.label), en, tip(button('', { icon: 'trash-2', variant: 'ghost', size: 'sm', ariaLabel: `Remove ${def.label}`, onClick: () => store.edit('Remove effect', (doc) => { const l = findLayer(doc, id).layer; l.effects = l.effects.filter((x) => x.id !== fx.id) }) }), 'Remove')),
        color, ...Object.entries(def.params).map(([k, d]) => propRow(id, `fx:${fx.id}:${k}`, { dim: 1, step: 1, ...d }, d.label)))
    })
    const picker = select([['', 'Add effect...'], ...Object.entries(EFFECTS).map(([k, d]) => [k, d.label])], '', (v) => {
      if (!v) return
      store.edit('Add effect', (doc) => { findLayer(doc, id).layer.effects.push(makeEffect(v)) })
      picker.value = ''
    })
    return section('Effects', [HAS_FILTER ? null : h('div', { class: 'ms-note warn' }, 'This browser cannot draw canvas filters, so effects are skipped. Use Chrome, Edge or Firefox.'), ...items, frow('', picker)])
  }

  function presetsSection() {
    const groups = {}
    for (const p of PRESETS) (groups[p.group] ||= []).push(p)
    return section('Animation presets', [h('div', { class: 'ms-note' }, 'Presets start at the playhead and add keyframes you can edit.'),
      ...Object.entries(groups).map(([g, list]) => h('div', { class: 'ms-pg' }, h('span', g), h('div', list.map((p) => h('button', { type: 'button', class: 'ms-chip', onclick: () => runPreset(p) }, p.label)))))], { open: false })
  }
  function runPreset(p) {
    const ids = [...store.sel]
    let n = 0
    store.edit(`Preset: ${p.label}`, (doc) => { n = applyPreset(p, ids.map((i) => findLayer(doc, i)?.layer).filter(Boolean), doc, store.time) })
    if (!n) toast(`${p.label} works on ${p.types ? p.types.join(' and ') : 'any'} layers. Select one first.`, 'error')
    else onKeyed?.(...ids)
  }

  // ---------- keyframe easing ----------
  function keyframeSection() {
    const ids = new Set(store.kfSel)
    const find = () => { const out = []; walk(store.doc.layers, (L) => { for (const p of [...Object.values(L.props), ...L.effects.flatMap((e) => Object.values(e.params)), ...(L.animators || []).flatMap((a) => Object.values(a.props))]) for (const k of p.k || []) if (ids.has(k.id)) out.push({ p, k }) }); return out }
    const first = find()[0]
    if (!first) return null
    const setEase = (e) => store.edit('Keyframe easing', () => { for (const { k } of find()) { if (e) k.e = clone(e); else delete k.e } })
    const names = [...EASES.map(([k, l]) => [k, l]), ['custom', 'Custom curve']]
    const sel = select(names, easeName(first.k.e), (v) => { if (v !== 'custom') setEase(EASE[v]); else setEase(Array.isArray(first.k.e) ? first.k.e : [0.25, 0.1, 0.25, 1]) })
    const time = numField({ label: 's', value: first.k.t, step: 0.05, min: 0, ariaLabel: 'Keyframe time in seconds', onInput: (v) => store.edit('Move keyframe', () => {
      const f = find()
      if (f.length !== 1) return
      f[0].k.t = clamp(Math.round(v * store.comp.fps) / store.comp.fps, 0, store.comp.duration)
      f[0].p.k.sort((a, b) => a.t - b.t)
    }, 'kftime') })
    const editor = bezierEditor({
      get: () => { const f = find()[0]; return Array.isArray(f?.k.e) ? f.k.e : f?.k.e === 'hold' ? null : [0, 0, 1, 1] },
      start: () => store.begin('Edit easing curve'),
      change: (b) => store.mutate(() => { for (const { k } of find()) k.e = b.map((n) => round(n, 3)) }),
      end: () => store.end(),
    })
    reg(() => {
      const f = find()[0]
      if (!f) return
      sel.value = easeName(f.k.e); time.setValue(round(f.k.t, 3)); editor.sync()
    })
    return section('Keyframe', [h('div', { class: 'ms-note' }, `${ids.size} keyframe${ids.size > 1 ? 's' : ''} selected. The curve controls how the value travels to the next keyframe.`),
      ids.size === 1 ? frow('Time', time) : null, frow('Easing', sel), editor.el,
      h('div', { class: 'ms-acts' }, button('Delete keyframes', { icon: 'trash-2', size: 'sm', onClick: () => deleteKeys() }))])
  }
  function deleteKeys() {
    const ids = new Set(store.kfSel)
    if (!ids.size) return false
    store.edit('Delete keyframes', (doc) => {
      walk(doc.layers, (L) => {
        for (const p of [...Object.values(L.props), ...L.effects.flatMap((e) => Object.values(e.params)), ...(L.animators || []).flatMap((a) => Object.values(a.props))]) {
          for (const k of [...(p.k || [])]) if (ids.has(k.id)) removeKey(p, k.id)
        }
      })
    })
    store.kfSel.clear(); store.emit('keys')
    return true
  }

  // ---------- build ----------
  function rebuild() {
    syncers = []
    lastSig = signature()
    const sel = store.selected
    const parts = []
    if (!sel.length) {
      parts.push(compSection())
      parts.push(h('div', { class: 'ms-help' }, h('strong', 'Quick start'),
        h('ol', h('li', 'Add text, a shape or an image from the toolbar or tool rail.'), h('li', 'Select a layer, move the playhead, then press the stopwatch next to a property to start keyframing.'),
          h('li', 'Drag diamonds in the timeline to retime, and pick an easing curve in the Keyframe panel.'), h('li', 'Open Export for MP4, WebM, GIF or a PNG sequence.'))))
    } else if (sel.length > 1) {
      parts.push(section('Selection', [h('div', { class: 'ms-note' }, `${sel.length} layers selected.`),
        h('div', { class: 'ms-acts' }, button('Group', { icon: 'folder', size: 'sm', onClick: () => ops.groupLayers(store) }), button('Duplicate', { icon: 'copy', size: 'sm', onClick: () => ops.duplicateLayers(store) }), button('Delete', { icon: 'trash-2', size: 'sm', onClick: () => ops.deleteLayers(store) }))]))
      const ks = keyframeSection(); if (ks) parts.unshift(ks)
      parts.push(presetsSection())
    } else {
      const L = sel[0], id = L.id
      const ks = keyframeSection(); if (ks) parts.push(ks)
      parts.push(layerSection(id), transformSection(id), contentSection(id, L))
      if (L.type === 'shape') parts.push(trimSection(id))
      if (L.type === 'text') parts.push(animatorsSection(id, L))
      parts.push(effectsSection(id, L))
      parts.push(presetsSection())
    }
    el.replaceChildren(...parts)
    const id = sel.length === 1 ? sel[0].id : sel.length ? 'multi' : ''
    if (id !== lastId) { lastId = id; el.parentElement?.scrollTo?.(0, 0) }
    sync()
  }
  function sync() { for (const f of syncers) f() }

  store.on((type) => {
    if (type === 'time') return sync()
    if (type === 'select' || type === 'keys' || type === 'doc' || type === 'assets') signature() !== lastSig ? rebuild() : sync()
  })
  rebuild()

  return { el, rebuild, sync, deleteKeys, focusText() { wantText = true; rebuild() } }
}

// ---------- cubic-bezier editor ----------
function bezierEditor({ get, start, change, end }) {
  const S = 150, P = 18
  const X = (u) => P + u * S, Y = (v) => P + (1.4 - v) / 1.8 * S
  const curve = svg('path', { class: 'bz-curve', fill: 'none' })
  const l1 = svg('line', { class: 'bz-line' }), l2 = svg('line', { class: 'bz-line' })
  const c1 = svg('circle', { class: 'bz-pt', r: 6, tabindex: 0 }), c2 = svg('circle', { class: 'bz-pt', r: 6, tabindex: 0 })
  const box = svg('rect', { class: 'bz-box', x: X(0), y: Y(1), width: S, height: Y(0) - Y(1) })
  const diag = svg('line', { class: 'bz-diag', x1: X(0), y1: Y(0), x2: X(1), y2: Y(1) })
  const hold = svg('text', { class: 'bz-hold', x: P + S / 2, y: P + S / 2 + 6, 'text-anchor': 'middle' }, 'Hold: jumps at the next keyframe')
  const root = svg('svg', { class: 'bz', viewBox: `0 0 ${S + 2 * P} ${S + 2 * P}`, role: 'img', 'aria-label': 'Easing curve editor' }, box, diag, curve, l1, l2, c1, c2, hold)
  const el = h('div', { class: 'ms-bz' }, root)
  const draw = () => {
    const b = get()
    hold.style.display = b ? 'none' : ''
    for (const n of [curve, l1, l2, c1, c2]) n.style.display = b ? '' : 'none'
    if (!b) return
    curve.setAttribute('d', `M${X(0)} ${Y(0)} C${X(b[0])} ${Y(b[1])} ${X(b[2])} ${Y(b[3])} ${X(1)} ${Y(1)}`)
    l1.setAttribute('x1', X(0)); l1.setAttribute('y1', Y(0)); l1.setAttribute('x2', X(b[0])); l1.setAttribute('y2', Y(b[1]))
    l2.setAttribute('x1', X(1)); l2.setAttribute('y1', Y(1)); l2.setAttribute('x2', X(b[2])); l2.setAttribute('y2', Y(b[3]))
    c1.setAttribute('cx', X(b[0])); c1.setAttribute('cy', Y(b[1])); c2.setAttribute('cx', X(b[2])); c2.setAttribute('cy', Y(b[3]))
  }
  const dragPt = (which) => (e) => {
    e.preventDefault()
    const node = e.currentTarget
    node.setPointerCapture(e.pointerId)
    start()
    const rect = root.getBoundingClientRect(), k = (S + 2 * P) / rect.width
    const move = (ev) => {
      const px = (ev.clientX - rect.left) * k, py = (ev.clientY - rect.top) * k
      const u = clamp((px - P) / S, 0, 1), v = clamp(1.4 - (py - P) / S * 1.8, -0.4, 1.4)
      const b = [...(get() || [0, 0, 1, 1])]
      if (which === 1) { b[0] = u; b[1] = v } else { b[2] = u; b[3] = v }
      change(b); draw()
    }
    const up = () => { node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', up); end() }
    node.addEventListener('pointermove', move)
    node.addEventListener('pointerup', up)
  }
  c1.addEventListener('pointerdown', dragPt(1))
  c2.addEventListener('pointerdown', dragPt(2))
  draw()
  return { el, sync: draw }
}
