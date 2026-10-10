// The dope-sheet timeline: layer rows with in/out bars, expandable property rows, draggable keyframes, ruler and playhead.
import { h, icon } from '../../lib/ui.js'
import { valueAt, isAnimated, enableAnim, disableAnim, clamp, normalizeKeys } from './_anim.js'
import { walk, findLayer, resolveProp, allProps, pathTo } from './_model.js'
import { tip, round } from './_ui.js'

const STEPS = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60]
const PAD = 10
const TYPE_ICON = { text: 'type', shape: 'shapes', image: 'image', solid: 'square', group: 'folder' }

export function createTimeline({ store, isPlaying }) {
  const open = new Set()
  let zoom = 1, basePps = 100, raf = 0, headW = 240
  const scroller = h('div', { class: 'tl-scroll', tabindex: -1 })
  const grid = h('div', { class: 'tl-grid' })
  const playhead = h('div', { class: 'tl-ph' })
  const phHead = h('i', { class: 'tl-ph-head' })
  scroller.append(grid)
  const el = h('div', { class: 'tl' }, scroller)
  let valueCells = []

  const pps = () => basePps * zoom
  const trackX = (t) => t * pps()

  function measure() {
    headW = el.clientWidth < 520 ? 150 : 240
    const avail = scroller.clientWidth - headW - PAD - 28
    const next = Math.max(40, avail / Math.max(0.5, store.comp.duration))
    if (Math.abs(next - basePps) > 0.5) { basePps = next; return true }
    return false
  }
  const ro = new ResizeObserver(() => queueBuild())
  ro.observe(scroller)

  function queueBuild() { if (!raf) raf = requestAnimationFrame(build) }

  function setZoom(z, clientX) {
    const old = pps(), rect = scroller.getBoundingClientRect()
    const cx = clientX ?? rect.left + headW + (rect.width - headW) / 2
    const tAt = (scroller.scrollLeft + cx - rect.left - headW - PAD) / old
    zoom = clamp(z, 0.25, 16)
    build()
    scroller.scrollLeft = tAt * pps() - (cx - rect.left - headW - PAD)
    api.onZoom?.(zoom)
  }
  scroller.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    setZoom(zoom * Math.exp(-e.deltaY * 0.002), e.clientX)
  }, { passive: false })

  // ---------- build ----------
  function build() {
    raf = 0
    const doc = store.doc, fps = doc.comp.fps, d = doc.comp.duration, W = Math.round(d * pps())
    measure()
    grid.style.setProperty('--head', `${headW}px`)
    grid.style.setProperty('--pps', `${pps()}px`)
    grid.style.setProperty('--pad', `${PAD}px`)
    grid.style.width = `${headW + PAD + W + 28}px`
    valueCells = []
    const rows = [ruler(d, fps, W)]
    const t = store.time
    walk(doc.layers, (L, parent, depth) => {
      // skip rows of collapsed groups
      let p = parent, hidden = false
      while (p) { if (!open.has(p.id)) hidden = true; p = findLayer(doc, p.id)?.parent }
      if (hidden) return
      rows.push(layerRow(L, depth, W, fps))
      if (open.has(L.id)) {
        let lastGroup = null
        for (const pr of allProps(L)) {
          if (pr.group !== lastGroup && pr.group !== 'Transform') rows.push(groupRow(pr.group, depth, W))
          lastGroup = pr.group
          rows.push(propRow(L, pr, depth, W, t))
        }
      }
    })
    if (!doc.layers.length) rows.push(h('div', { class: 'tl-empty' }, icon('layers'), h('div', 'No layers yet. Add text, a shape or an image from the toolbar.')))
    grid.replaceChildren(...rows, playhead)
    placePlayhead()
  }

  function ruler(d, fps, W) {
    const p = pps()
    const step = STEPS.find((s) => s * p >= 72) || 60
    const ticks = []
    const minor = step / 5
    if (minor * p >= 9) for (let t = 0; t <= d + 1e-6; t += minor) ticks.push(h('i', { class: 'tick', style: { left: `${t * p}px` } }))
    for (let t = 0; t <= d + 1e-6; t += step) {
      const label = step < 1 ? `${round(t, 2)}s` : t >= 60 ? `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}` : `${round(t, 1)}s`
      ticks.push(h('i', { class: 'tick major', style: { left: `${t * p}px` } }, h('span', label)))
    }
    if (p >= fps * 7) for (let f = 0; f <= d * fps; f++) if (f % fps) ticks.push(h('i', { class: 'tick frame', style: { left: `${(f / fps) * p}px` } }))
    const area = h('div', { class: 'tl-ruler-area', style: { width: `${W}px` } }, ticks, phHead)
    area.addEventListener('pointerdown', (e) => scrub(e, area))
    return h('div', { class: 'tl-row tl-ruler' }, h('div', { class: 'tl-head tl-corner' }, h('span', 'Layers')), area)
  }

  function scrub(e, area) {
    if (e.button !== 0) return
    const move = (ev) => {
      const r = area.getBoundingClientRect()
      store.setTime((ev.clientX - r.left) / pps())
    }
    move(e)
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up) }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }

  const iconToggle = (name, label, on, onClick) => {
    const b = h('button', { type: 'button', class: ['tl-ic', on && 'on'], 'aria-pressed': String(!!on), onclick: (e) => { e.stopPropagation(); onClick() } }, icon(name))
    return tip(b, label)
  }

  function layerRow(L, depth, W, fps) {
    const sel = store.sel.includes(L.id)
    const isOpen = open.has(L.id)
    const rename = (nameEl) => {
      const inp = h('input', { class: 'tl-rename', value: L.name, 'aria-label': 'Layer name' })
      const done = (ok) => {
        const v = inp.value.trim()
        if (ok && v && v !== L.name) store.edit('Rename layer', (doc) => { findLayer(doc, L.id).layer.name = v.slice(0, 80) })
        else queueBuild()
      }
      inp.addEventListener('blur', () => done(true))
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); else if (e.key === 'Escape') { inp.value = L.name; inp.blur() } e.stopPropagation() })
      nameEl.replaceWith(inp)
      inp.focus(); inp.select()
    }
    const nameEl = h('span', { class: 'tl-name', ondblclick: () => rename(nameEl) }, L.name)
    const pick = (e) => { if (e.shiftKey) store.select([L.id], true); else if (e.ctrlKey || e.metaKey) store.toggle(L.id); else store.select([L.id]) }
    const head = h('div', {
      class: 'tl-head', style: { paddingLeft: `${6 + depth * 14}px` }, tabindex: 0, role: 'button', 'aria-pressed': String(sel), 'aria-label': `Select layer ${L.name}`,
      onclick: pick,
      onkeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === head) { e.preventDefault(); e.stopPropagation(); pick(e) } },
    },
    h('button', { type: 'button', class: ['tl-twirl', isOpen && 'open'], 'aria-expanded': String(isOpen), 'aria-label': `${isOpen ? 'Collapse' : 'Expand'} ${L.name}`, onclick: (e) => { e.stopPropagation(); isOpen ? open.delete(L.id) : open.add(L.id); build() } }, icon('chevron-right')),
    h('span', { class: 'tl-type' }, icon(TYPE_ICON[L.type])),
    nameEl,
    iconToggle(L.visible ? 'eye' : 'eye-off', L.visible ? 'Hide layer' : 'Show layer', L.visible, () => store.edit('Toggle visibility', (doc) => { const l = findLayer(doc, L.id).layer; l.visible = !l.visible })),
    iconToggle(L.locked ? 'lock' : 'lock-open', L.locked ? 'Unlock layer' : 'Lock layer', L.locked, () => store.edit('Toggle lock', (doc) => { const l = findLayer(doc, L.id).layer; l.locked = !l.locked })))
    const bar = h('div', { class: ['tl-bar', L.type, !L.visible && 'off'], style: { left: `${trackX(L.inPoint)}px`, width: `${Math.max(6, trackX(L.outPoint - L.inPoint))}px` }, dataset: { id: L.id } },
      h('i', { class: 'h h-l', dataset: { edge: 'in' } }), h('i', { class: 'h h-r', dataset: { edge: 'out' } }))
    const track = h('div', { class: 'tl-track', style: { width: `${W}px` } }, bar)
    if (!isOpen) {
      const times = new Set()
      for (const { prop } of allProps(L)) for (const k of prop.k || []) times.add(Math.round(k.t * 1000))
      for (const ms of times) track.append(h('i', { class: 'kf sum', style: { left: `${trackX(ms / 1000)}px` } }))
    }
    return h('div', { class: ['tl-row', 'layer', sel && 'sel', L.locked && 'locked'], dataset: { id: L.id } }, head, track)
  }

  function groupRow(name, depth, W) {
    return h('div', { class: 'tl-row grp' }, h('div', { class: 'tl-head', style: { paddingLeft: `${22 + depth * 14}px` } }, h('span', { class: 'tl-gname' }, name)), h('div', { class: 'tl-track', style: { width: `${W}px` } }))
  }

  const fmtVal = (v, def) => {
    const u = { px: '', '%': '%', deg: '°' }[def.unit] ?? ''
    return Array.isArray(v) ? v.map((n) => round(n, 1)).join(', ') + u : `${round(v, 1)}${u}`
  }
  function propRow(L, pr, depth, W, t) {
    const { prop, key, def, label } = pr
    const anim = isAnimated(prop)
    const val = h('span', { class: 'tl-val' }, fmtVal(valueAt(prop, t), def))
    valueCells.push({ el: val, prop, def })
    const sw = h('button', {
      type: 'button', class: ['tl-sw', anim && 'on'], 'aria-pressed': String(anim), 'aria-label': `Animate ${label}`,
      onclick: (e) => {
        e.stopPropagation()
        store.select([L.id])
        store.edit(anim ? 'Remove animation' : 'Start animation', (doc) => {
          const p = resolveProp(findLayer(doc, L.id).layer, key)
          if (anim) disableAnim(p, store.time); else enableAnim(p, store.time)
        })
      },
    }, icon('timer'))
    tip(sw, anim ? 'Stop animating (removes keyframes)' : 'Animate: add a keyframe here')
    const track = h('div', { class: 'tl-track', style: { width: `${W}px` } },
      (prop.k || []).map((k) => h('i', { class: ['kf', store.kfSel.has(k.id) && 'sel', k.e === 'hold' && 'hold'], style: { left: `${trackX(k.t)}px` }, dataset: { id: k.id, layer: L.id, key } })))
    return h('div', { class: ['tl-row', 'prop', store.sel.includes(L.id) && 'sel'], dataset: { id: L.id } },
      h('div', { class: 'tl-head', style: { paddingLeft: `${22 + depth * 14}px` }, onclick: () => store.select([L.id]) }, sw, h('span', { class: 'tl-pname' }, label), val), track)
  }

  function updateValues() {
    const t = store.time
    for (const c of valueCells) c.el.textContent = fmtVal(valueAt(c.prop, t), c.def)
  }
  function placePlayhead() {
    playhead.style.left = `${headW + PAD + trackX(store.time)}px`
    phHead.style.left = `${trackX(store.time)}px`
  }

  // ---------- drag handling (event delegation) ----------
  const locateKeys = (ids) => {
    const out = []
    walk(store.doc.layers, (L) => { for (const { prop } of allProps(L)) for (const k of prop.k || []) if (ids.has(k.id)) out.push({ prop, k }) })
    return out
  }
  function drag(e, onMove, onEnd) {
    const x0 = e.clientX
    const move = (ev) => onMove((ev.clientX - x0) / pps(), ev)
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); onEnd?.() }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }
  const snap = (dt) => Math.round(dt * store.comp.fps) / store.comp.fps

  grid.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    const kf = e.target.closest('.kf:not(.sum)')
    if (kf) {
      const id = kf.dataset.id, additive = e.shiftKey || e.ctrlKey || e.metaKey
      if (additive) { store.selectKeys([id], true); return }
      if (!store.kfSel.has(id)) { store.select([kf.dataset.layer]); store.selectKeys([id]) }
      const items = locateKeys(store.kfSel).map(({ prop, k }) => ({ prop, k, t0: k.t }))
      store.begin('Move keyframes')
      drag(e, (dt) => {
        const d = snap(dt), min = Math.min(...items.map((i) => i.t0)), max = Math.max(...items.map((i) => i.t0))
        const use = clamp(d, -min, store.comp.duration - max)
        store.mutate(() => { for (const i of items) { i.k.t = Math.round((i.t0 + use) * 10000) / 10000; i.prop.k.sort((a, b) => a.t - b.t) } })
        build()
      }, () => { store.mutate(() => { for (const i of new Set(items.map((x) => x.prop))) normalizeKeys(i) }); store.end(); store.prune() })
      return
    }
    const bar = e.target.closest('.tl-bar')
    if (bar) {
      const id = bar.dataset.id, edge = e.target.dataset?.edge
      if (!store.sel.includes(id)) store.select([id], e.shiftKey)
      const L0 = findLayer(store.doc, id).layer
      if (L0.locked) return
      const ids = edge ? [id] : store.sel
      const items = ids.map((i) => findLayer(store.doc, i)?.layer).filter(Boolean).map((L) => ({ id: L.id, in0: L.inPoint, out0: L.outPoint }))
      const dur = store.comp.duration, step = 1 / store.comp.fps
      store.begin('Edit layer time')
      drag(e, (dt) => {
        let d = snap(dt)
        if (!edge) d = clamp(d, -Math.min(...items.map((i) => i.in0)), dur - Math.max(...items.map((i) => i.out0)))
        store.mutate((doc) => {
          for (const i of items) {
            const L = findLayer(doc, i.id).layer
            if (edge === 'in') L.inPoint = clamp(i.in0 + d, 0, i.out0 - step)
            else if (edge === 'out') L.outPoint = clamp(i.out0 + d, i.in0 + step, dur)
            else { L.inPoint = i.in0 + d; L.outPoint = i.out0 + d }
          }
        })
        build()
      }, () => store.end())
      return
    }
    const track = e.target.closest('.tl-track')
    if (track && !e.target.closest('.kf')) {
      if (!e.shiftKey) { store.selectKeys([]); }
      scrub(e, track)
    }
  })
  grid.addEventListener('dblclick', (e) => {
    const kf = e.target.closest('.kf:not(.sum)')
    if (!kf) return
    const k = locateKeys(new Set([kf.dataset.id]))[0]
    if (k) store.setTime(k.k.t)
  })

  const off = store.on((type) => {
    if (type === 'doc' && store.txn) updateValues()
    else if (type === 'doc' || type === 'select' || type === 'keys' || type === 'assets') {
      if (type === 'select') for (const id of store.sel) for (const a of pathTo(store.doc, id).slice(0, -1)) open.add(a.id) // reveal layers picked on the canvas
      queueBuild()
    }
    else if (type === 'time') {
      placePlayhead(); updateValues()
      if (isPlaying()) {
        const x = headW + PAD + trackX(store.time) - scroller.scrollLeft
        if (x > scroller.clientWidth - 24) scroller.scrollLeft = PAD + trackX(store.time) - 24
        else if (x < headW) scroller.scrollLeft = Math.max(0, trackX(store.time) - 24)
      }
    }
  })

  queueBuild()
  const api = {
    el, build: queueBuild, open, onZoom: null,
    get zoom() { return zoom },
    setZoom: (z) => setZoom(z),
    fit: () => { zoom = 1; build(); scroller.scrollLeft = 0 },
    destroy() { off(); ro.disconnect(); cancelAnimationFrame(raf) },
    expand(id) { open.add(id); queueBuild() },
  }
  return api
}
