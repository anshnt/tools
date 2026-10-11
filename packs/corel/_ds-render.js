// Draw Studio renderer: draws the CURRENT page of the immutable document as an SVG DOM, keyed by node identity.
// Built only with createElementNS and setAttribute (never innerHTML), so nothing from a file can inject markup.
//   svg.ds-art > defs, g.ds-world (zoom and pan = one transform) > rect.ds-shadow, rect.ds-paper, g.ds-page > g.ds-layer[data-layer] > nodes
// Every node element carries data-id on its OUTERMOST element, so a gesture preview (CSS transform) moves node and clip together.
import { pathBBox } from './_model.js'
import { yieldToMain } from '../../lib/ui.js'
import { fontStack, glyphXList, glyphString, DEFAULT_LH } from './_ds-text-model.js'
import { createBoxer } from './_ds-hit.js'

const NS = 'http://www.w3.org/2000/svg'
const mk = (tag, attrs) => {
  const el = document.createElementNS(NS, tag)
  if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k])
  return el
}
const r3 = (v) => Math.round(v * 1000) / 1000
const mstr = (m) => `matrix(${m.map(r3).join(' ')})`
export function dStr(d) {
  let s = ''
  for (let i = 0; i < d.length; i++) {
    const c = d[i]
    s += c[0]
    for (let j = 1; j < c.length; j++) s += (j > 1 ? ' ' : '') + r3(c[j])
  }
  return s
}
const CAP = ['butt', 'round', 'square'], JOIN = ['miter', 'round', 'bevel']
const GLYPH_STYLE = "font-kerning:none;font-variant-ligatures:none;font-feature-settings:'liga' 0,'clig' 0,'calt' 0;text-rendering:geometricPrecision;white-space:pre"
const SLICE = 500, BIG = 3000

export function createRenderer({ store, svgRoot, assets, faces }) {
  const uidNow = () => store.root.uid
  const defs = mk('defs')
  const world = mk('g', { class: 'ds-world' })
  const shadow = mk('rect', { class: 'ds-shadow' })
  const paper = mk('rect', { class: 'ds-paper' })
  const pageG = mk('g', { class: 'ds-page' })
  world.append(shadow, paper, pageG)
  svgRoot.append(defs, world)

  const els = new WeakMap() // node -> outermost element
  const byId = new Map()
  const layerEls = new Map() // layer id -> g
  const gradients = new WeakMap(), clipDefs = new WeakMap()
  const boxes = new WeakMap() // text node -> {x,y,w,h}
  let defSeq = 0, lastSweep = 0, token = 0, pageId = null
  const previewed = new Set()
  let epoch = 0 // bumped when fonts load so cached boxes of groups holding text are recomputed
  const boxer = createBoxer((n) => textBox(n), () => epoch)

  const defId = (p) => `ds${uidNow()}-${p}${++defSeq}`
  const addDef = (el) => { defs.append(el); return el }

  // ---------- paint ----------
  function gradientRef(g) {
    let rec = gradients.get(g)
    if (!rec) {
      const id = defId('g')
      const stops = [...g.stops].sort((a, b) => a.o - b.o).map((s) => mk('stop', { offset: r3(s.o), 'stop-color': s.c, ...(s.a < 1 ? { 'stop-opacity': r3(s.a) } : {}) }))
      const base = { id, gradientUnits: 'userSpaceOnUse', gradientTransform: mstr(g.m || [1, 0, 0, 1, 0, 0]), ...(g.spread && g.spread !== 'pad' ? { spreadMethod: g.spread } : {}) }
      const el = g.g === 'radial'
        ? mk('radialGradient', { ...base, cx: r3(g.cx), cy: r3(g.cy), r: r3(g.r), fx: r3(g.fx ?? g.cx), fy: r3(g.fy ?? g.cy) })
        : mk('linearGradient', { ...base, x1: r3(g.x1), y1: r3(g.y1), x2: r3(g.x2), y2: r3(g.y2) })
      el.append(...stops)
      rec = { id, el }
      gradients.set(g, rec)
    }
    if (!rec.el.isConnected) defs.append(rec.el)
    return `url(#${rec.id})`
  }
  function clipRef(clip) {
    let rec = clipDefs.get(clip)
    if (!rec) {
      const id = defId('c')
      const el = mk('clipPath', { id })
      el.append(mk('path', { d: dStr(clip.d), ...(clip.rule === 'evenodd' ? { 'clip-rule': 'evenodd' } : {}) }))
      rec = { id, el }
      clipDefs.set(clip, rec)
    }
    if (!rec.el.isConnected) defs.append(rec.el)
    return `url(#${rec.id})`
  }

  // ---------- node elements ----------
  function pathEl(n) {
    const a = { d: dStr(n.d) }
    a.fill = n.fill ? (typeof n.fill === 'object' ? gradientRef(n.fill) : n.fill) : 'none'
    if (n.fill && n.fillOpacity < 1) a['fill-opacity'] = r3(n.fillOpacity)
    if (n.rule === 'evenodd') a['fill-rule'] = 'evenodd'
    if (n.stroke && n.strokeWidth > 0) {
      a.stroke = n.stroke
      a['stroke-width'] = r3(n.strokeWidth)
      if (n.strokeOpacity < 1) a['stroke-opacity'] = r3(n.strokeOpacity)
      if (n.cap) a['stroke-linecap'] = CAP[n.cap]
      if (n.join) a['stroke-linejoin'] = JOIN[n.join]
      if (n.join === 0 && n.miter && n.miter !== 4) a['stroke-miterlimit'] = r3(n.miter)
      if (n.dash?.length) { a['stroke-dasharray'] = n.dash.map(r3).join(' '); if (n.dashOffset) a['stroke-dashoffset'] = r3(n.dashOffset) }
    }
    return mk('path', a)
  }
  function imageEl(n) {
    const el = mk('image', { href: assets.url(n.asset), width: 1, height: 1, preserveAspectRatio: 'none', transform: mstr(n.m), decoding: 'async' })
    if (n.opacity < 1) el.setAttribute('opacity', r3(n.opacity))
    return el
  }
  /** Fill a <text> element for a node: glyph-exact when the embedded font loaded, else from str with the family stack. */
  function fillText(t, n) {
    t.replaceChildren()
    for (const k of ['x', 'y', 'style', 'text-anchor']) t.removeAttribute(k)
    t.setAttribute('transform', mstr(n.m))
    t.setAttribute('xml:space', 'preserve')
    t.setAttribute('font-family', fontStack(n, faces, uidNow()))
    t.setAttribute('font-size', r3(n.size))
    t.setAttribute('font-weight', n.bold ? '700' : '400')
    t.setAttribute('font-style', n.italic ? 'italic' : 'normal')
    t.setAttribute('fill', n.fill || '#000000')
    if (n.opacity < 1) t.setAttribute('opacity', r3(n.opacity)); else t.removeAttribute('opacity')
    if (n.glyphs?.length && n.font != null && faces?.ok?.(n.font) && (n.align || 'left') === 'left' && !n.str.includes('\n')) {
      t.setAttribute('x', glyphXList(n).map(r3).join(' '))
      t.setAttribute('y', '0')
      t.setAttribute('style', GLYPH_STYLE)
      t.textContent = glyphString(n)
      t.setAttribute('data-glyphs', '1')
      return
    }
    t.removeAttribute('data-glyphs')
    t.setAttribute('style', 'white-space:pre')
    if (n.align === 'center') t.setAttribute('text-anchor', 'middle'); else if (n.align === 'right') t.setAttribute('text-anchor', 'end')
    const lh = (n.lh || DEFAULT_LH) * n.size
    n.str.split('\n').forEach((line, k) => {
      const ts = mk('tspan', { x: 0, dy: k ? r3(lh) : 0 })
      ts.textContent = line || '​'
      t.append(ts)
    })
  }
  function textEl(n) { const t = mk('text'); fillText(t, n); return t }

  function build(n, locked) {
    let el
    if (n.t === 'group') {
      el = mk('g')
      syncChildren(el, n.items, locked)
    } else {
      const core = n.t === 'path' ? pathEl(n) : n.t === 'image' ? imageEl(n) : textEl(n)
      el = core
      if (n.t !== 'path' || n.clip?.length) { el = mk('g'); el.append(core) }
      if (n.clip?.length) {
        // several clips nest (all apply); the outermost wrapper is the registered element
        let inner = el
        const wraps = n.clip.map((c) => { const g = mk('g', { 'clip-path': clipRef(c) }); return g })
        if (wraps.length) {
          el = wraps[0]
          for (let i = 1; i < wraps.length; i++) wraps[i - 1].append(wraps[i])
          wraps[wraps.length - 1].append(inner)
        }
      }
    }
    el.setAttribute('data-id', String(n.id))
    if (locked || n.locked) el.setAttribute('data-lock', '1')
    byId.set(n.id, el)
    return el
  }

  function syncChildren(parent, nodes, locked) {
    // `prev` is the last element placed, so the insertion point survives building a group whose members were children of this very parent
    let prev = null
    for (const n of nodes) {
      if (n.hidden) continue
      let el = els.get(n)
      const lockWanted = !!(locked || n.locked)
      if (!el) { el = build(n, locked); els.set(n, el) }
      else {
        if (el.hasAttribute('data-lock') !== lockWanted) el.toggleAttribute('data-lock', lockWanted)
        // a cached group element may have lost children to another parent (a member dragged out, then undo): put its members back
        if (n.t === 'group') syncChildren(el, n.items, locked)
      }
      const at = prev ? prev.nextSibling : parent.firstChild
      if (el !== at) parent.insertBefore(el, at)
      prev = el
    }
    let rest = prev ? prev.nextSibling : parent.firstChild
    while (rest) { const next = rest.nextSibling; parent.removeChild(rest); rest = next }
  }

  // ---------- page and layers ----------
  function setPaper(page) {
    for (const el of [paper, shadow]) { el.setAttribute('width', page.w); el.setAttribute('height', page.h) }
    shadow.setAttribute('x', 3); shadow.setAttribute('y', 3)
  }
  function layerEl(layer) {
    let g = layerEls.get(layer.id)
    if (!g) { g = mk('g', { class: 'ds-layer', 'data-layer': String(layer.id) }); layerEls.set(layer.id, g) }
    g.classList.toggle('ds-locked', !!layer.locked)
    return g
  }
  /** Bring the DOM in line with the current page (keyed diff; unchanged layers are skipped). */
  function patch() {
    const page = store.page()
    if (!page) return
    if (page.id !== pageId) return renderPage()
    setPaper(page)
    const want = new Set()
    const order = []
    for (const layer of page.layers) {
      if (layer.hidden) continue
      const g = layerEl(layer)
      want.add(layer.id)
      order.push(g)
      if (g.__items !== layer.items || g.__locked !== layer.locked) { syncChildren(g, layer.items, layer.locked); g.__items = layer.items; g.__locked = layer.locked }
    }
    for (const [id, g] of layerEls) if (!want.has(id)) { g.remove(); layerEls.delete(id) }
    let cur = pageG.firstChild
    for (const g of order) { if (g === cur) cur = cur.nextSibling; else pageG.insertBefore(g, cur) }
    sweepDefs()
  }
  /** Rebuild for the current page (page switch or load). Large layers are built in slices so the page stays responsive. */
  async function renderPage() {
    const my = ++token
    const page = store.page()
    pageG.replaceChildren(); byId.clear(); layerEls.clear()
    if (!page) return
    pageId = page.id
    setPaper(page)
    for (const layer of page.layers) {
      if (layer.hidden) continue
      const g = layerEl(layer)
      pageG.append(g)
      if (layer.items.length <= BIG) { syncChildren(g, layer.items, layer.locked); g.__items = layer.items; g.__locked = layer.locked; continue }
      for (let i = 0; i < layer.items.length; i += SLICE) {
        for (const n of layer.items.slice(i, i + SLICE)) {
          if (n.hidden) continue
          let el = els.get(n)
          if (!el) { el = build(n, layer.locked); els.set(n, el) }
          g.append(el)
        }
        store.setStatus(`Drawing ${Math.min(i + SLICE, layer.items.length).toLocaleString()} of ${layer.items.length.toLocaleString()} objects`)
        await yieldToMain()
        if (my !== token) return
      }
      g.__items = layer.items; g.__locked = layer.locked
      store.setStatus('')
    }
    sweepDefs()
  }
  function sweepDefs() {
    const n = defs.childElementCount
    if (n < 300 || n < lastSweep * 2) return
    const used = new Set()
    for (const el of world.querySelectorAll('[fill^="url("],[stroke^="url("],[clip-path]')) for (const a of ['fill', 'stroke', 'clip-path']) { const v = el.getAttribute(a); const m = v && /^url\(#([^)]+)\)$/.exec(v); if (m) used.add(m[1]) }
    for (const d of [...defs.children]) if (!used.has(d.id)) d.remove()
    lastSweep = defs.childElementCount
  }

  // ---------- lookups, boxes, previews ----------
  function elOf(id) {
    const el = byId.get(id)
    if (el && !el.isConnected) { byId.delete(id); return null }
    return el || null
  }
  function textBox(n) {
    let b = boxes.get(n)
    if (b) return b
    const el = els.get(n)
    const t = el?.isConnected && el.querySelector('text')
    let box = null
    if (t) {
      try {
        const bb = t.getBBox()
        if (bb.width || bb.height) box = pathBBox([['M', bb.x, bb.y], ['L', bb.x + bb.width, bb.y], ['L', bb.x + bb.width, bb.y + bb.height], ['L', bb.x, bb.y + bb.height], ['Z']].map((c) => (c[0] === 'Z' ? c : [c[0], ...applyM(n.m, c[1], c[2])])))
      } catch { /* not rendered */ }
    }
    if (!box) { // approximate until the element is rendered (not cached)
      const w = (n.str.split('\n').reduce((a, s) => Math.max(a, s.length), 0)) * n.size * 0.55
      const x0 = n.align === 'center' ? -w / 2 : n.align === 'right' ? -w : 0
      const h = n.size * 1.2 * (n.str.split('\n').length)
      return pathBBox([[x0, -n.size * 0.8], [x0 + w, -n.size * 0.8], [x0 + w, h], [x0, h]].map((p, i) => [i ? 'L' : 'M', ...applyM(n.m, p[0], p[1])]))
    }
    boxes.set(n, box)
    return box
  }
  const applyM = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

  function preview(ids, M) {
    const css = `matrix(${M.map((v) => +v.toFixed(6)).join(',')})`
    for (const id of ids) {
      const el = elOf(id)
      if (!el) continue
      el.style.transform = css
      el.style.transformOrigin = '0 0'
      previewed.add(id)
    }
  }
  function clearPreview() {
    for (const id of previewed) { const el = byId.get(id); if (el) { el.style.transform = ''; el.style.transformOrigin = '' } }
    previewed.clear()
  }
  /** Show a draft path (Shape tool node drag) without touching the store. */
  function previewPath(id, d) {
    const el = elOf(id)
    const p = el && (el.localName === 'path' ? el : el.querySelector('path'))
    p?.setAttribute('d', typeof d === 'string' ? d : dStr(d))
  }
  const applyView = (v) => world.setAttribute('transform', `matrix(${v.z} 0 0 ${v.z} ${v.x} ${v.y})`)
  const setWire = (on) => world.classList.toggle('ds-wire', !!on)
  const resetBoxes = () => { /* WeakMap entries cannot be cleared; replace by clearing live ones */ for (const n of textNodes()) boxes.delete(n) }
  function* textNodes() { for (const [id] of byId) { const f = store.find(id); if (f?.node?.t === 'text') yield f.node } }

  const offDoc = store.on('doc', (e) => { if (e?.load) { defs.replaceChildren(); lastSweep = 0; previewed.clear(); return } patch() })
  const offPage = store.on('page', () => renderPage())
  const offFonts = store.on('fonts', () => {
    epoch++
    resetBoxes()
    for (const [id, el] of byId) { const f = store.find(id); if (f?.node?.t === 'text') { const t = el.querySelector('text'); if (t) fillText(t, f.node) } }
    store.emit('boxes')
  })

  return {
    world, defs, paper, patch, renderPage, elOf, textBox, nodeBox: (n) => boxer(n), preview, clearPreview, previewPath, applyView, setWire, resetBoxes, dStr,
    dispose() { offDoc(); offPage(); offFonts(); world.remove(); defs.remove() },
  }
}
