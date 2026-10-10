// Soft pagination for the page view. The document stays one continuous flow; where a page ends we insert a spacer widget
// (rest of the page + footer + visible gap + next header) so text, headings and tables start on the next sheet, like a word
// processor. Spacers are decorations only: they never enter the document, the print output or any export.
import { state as S, view as V } from './vendor/prosemirror.js'

const { Plugin, PluginKey } = S
const { Decoration, DecorationSet } = V

export const pageKey = new PluginKey('docs-pages')
const EMPTY = { cuts: [], deco: DecorationSet.empty, pages: 1 }

function gapElement(cut, p) {
  const el = document.createElement('div')
  el.className = 'dc-pgap'
  el.contentEditable = 'false'
  el.setAttribute('aria-hidden', 'true')
  const part = (cls, h, text) => {
    const i = document.createElement('i')
    i.className = cls
    i.style.height = `${h}px`
    if (text) { const s = document.createElement('span'); s.textContent = text; i.append(s) }
    return i
  }
  const footer = [p.footer, p.pageNumbers ? String(cut.page) : ''].filter(Boolean).join('   ')
  el.append(part('w', cut.wasted), part('f', p.mb, footer), part('b', p.band), part('h', p.mt, p.header))
  return el
}

function build(doc, cuts, p) {
  if (!cuts.length) return DecorationSet.empty
  return DecorationSet.create(doc, cuts.map((c) => Decoration.widget(c.pos, () => gapElement(c, p), {
    side: -1, ignoreSelection: true, stopEvent: () => true, key: `pg${c.page}:${Math.round(c.wasted)}:${p.mb}:${p.mt}:${p.band}:${p.footer}:${p.header}:${p.pageNumbers}`,
  })))
}

export function paginationPlugin() {
  return new Plugin({
    key: pageKey,
    state: {
      init: () => EMPTY,
      apply(tr, prev) {
        const meta = tr.getMeta(pageKey)
        if (meta) return { cuts: meta.cuts, pages: meta.pages, params: meta.params, deco: build(tr.doc, meta.cuts, meta.params) }
        if (tr.docChanged && prev.cuts.length) return { ...prev, deco: prev.deco.map(tr.mapping, tr.doc) }
        return prev
      },
    },
    props: { decorations: (st) => pageKey.getState(st)?.deco || DecorationSet.empty },
  })
}

export const pageState = (st) => pageKey.getState(st) || EMPTY

/** Natural line boxes (css px, relative to origin) of a text block, plus a document position for the start of each line. */
function lineBoxes(view, dom, origin, zoom) {
  const range = document.createRange()
  range.selectNodeContents(dom)
  const rects = [...range.getClientRects()].filter((r) => r.height > 1)
  rects.sort((a, b) => a.top - b.top || a.left - b.left)
  const lines = []
  for (const r of rects) {
    const last = lines[lines.length - 1]
    if (last && r.top < last.bottomV - (r.height * 0.5)) { last.bottomV = Math.max(last.bottomV, r.bottom); last.leftV = Math.min(last.leftV, r.left); continue }
    lines.push({ topV: r.top, bottomV: r.bottom, leftV: r.left })
  }
  return lines.map((l) => ({ top: (l.topV - origin) / zoom, bottom: (l.bottomV - origin) / zoom, leftV: l.leftV, midV: (l.topV + l.bottomV) / 2 }))
}

/**
 * Work out where pages end. p: {H (content height per page, css px), zoom}. Returns {cuts: [{pos, wasted, page}], pages}.
 * Must run with spacers hidden (the caller adds .dc-nopage to view.dom) so every measurement is in natural flow coordinates.
 */
export function measure(view, p) {
  const { H, zoom } = p
  const dom = view.dom
  const origin = dom.getBoundingClientRect().top
  const units = []
  view.state.doc.descendants((node, pos) => {
    const name = node.type.name
    if (node.isTextblock) {
      // the first paragraph of a list item cuts before the whole item, so the bullet or number stays with its text
      const $p = view.state.doc.resolve(pos)
      const cutPos = /_item$/.test($p.parent.type.name) && $p.index() === 0 ? $p.before() : pos
      units.push({ kind: 'text', node, pos, cutPos, heading: name === 'heading' })
      return false
    }
    if (name === 'table' || name === 'horizontal_rule') { units.push({ kind: 'block', node, pos, cutPos: pos }); return false }
    if (name === 'page_break') { units.push({ kind: 'break', node, pos, cutPos: pos }); return false }
    return true
  })
  for (const u of units) {
    const el = view.nodeDOM(u.pos)
    if (!(el instanceof Element)) { u.top = u.bottom = 0; u.skip = true; continue }
    const r = el.getBoundingClientRect()
    u.el = el
    u.top = (r.top - origin) / zoom
    u.bottom = (r.bottom - origin) / zoom
  }
  const cuts = []
  let boundary = H
  let force = false
  const lines = (u) => (u.lines ??= lineBoxes(view, u.el, origin, zoom))
  const cutBefore = (u, ix) => {
    cuts.push({ pos: u.cutPos, wasted: Math.max(0, boundary - u.top), page: cuts.length + 1 })
    boundary = u.top + H
    void ix
  }
  for (let i = 0; i < units.length; i++) {
    const u = units[i]
    if (u.skip) continue
    if (force) { force = false; cutBefore(u, i) }
    if (u.kind === 'break') { force = true; continue }
    const pageStart = () => boundary - H
    // keep a heading with the paragraph that follows it
    if (u.heading && u.bottom <= boundary && u.top > pageStart() + 1) {
      const n = units[i + 1]
      if (n && !n.skip && n.kind !== 'break') {
        const fits = n.kind === 'text' ? (lines(n)[0]?.bottom ?? n.bottom) <= boundary : n.bottom <= boundary
        if (!fits) { cutBefore(u, i); continue }
      }
    }
    for (let guard = 0; u.bottom > boundary + 0.5 && guard < 200; guard++) {
      if (u.top >= boundary - 0.5) { cutBefore(u, i); continue }
      if (u.kind === 'text') {
        const ls = lines(u)
        const at = ls.findIndex((l) => l.bottom > boundary + 0.5)
        if (at <= 0) { if (u.top > pageStart() + 1) cutBefore(u, i); else boundary += H; continue }
        const hit = view.posAtCoords({ left: ls[at].leftV + 1, top: ls[at].midV })
        if (!hit || hit.pos <= u.pos + 1) { cutBefore(u, i); continue }
        cuts.push({ pos: hit.pos, wasted: Math.max(0, boundary - ls[at].top), page: cuts.length + 1 })
        boundary = ls[at].top + H
      } else if (u.top > pageStart() + 1 && u.bottom - u.top <= H) cutBefore(u, i)
      else boundary = pageStart() + Math.ceil((u.bottom - pageStart()) / H) * H // taller than a page: let it overflow
    }
  }
  // the last page ends at the next boundary after the last unit
  const last = units.filter((u) => !u.skip).pop()
  let pages = cuts.length + 1
  if (last) while (last.bottom > boundary + 0.5 && pages < 5000) { boundary += H; pages++ }
  return { cuts, pages }
}

/**
 * createPaginator({view, params: () => ({H, zoom, mt, mb, band, header, footer, pageNumbers}), onPages(n)})
 * -> {refresh(), enable(bool)}. refresh() is debounced; changes only reach the document view when the layout really changed.
 */
export function createPaginator({ view, params, onPages }) {
  let on = false
  let timer = 0
  let dead = false
  const same = (a, b) => a.length === b.length && a.every((c, i) => c.pos === b[i].pos && Math.abs(c.wasted - b[i].wasted) < 1.5)

  function run() {
    timer = 0
    if (dead) return
    const p = params()
    const cur = pageState(view.state)
    if (!on) {
      if (cur.cuts.length) view.dispatch(view.state.tr.setMeta(pageKey, { cuts: [], pages: 1, params: null }).setMeta('addToHistory', false))
      onPages?.(1)
      return
    }
    view.dom.classList.add('dc-nopage')
    let res
    try { res = measure(view, p) } catch (e) { console.error(e); res = { cuts: [], pages: 1 } } finally { view.dom.classList.remove('dc-nopage') }
    const { zoom: _z, ...stable } = p
    const paramsChanged = cur.params ? JSON.stringify(cur.params) !== JSON.stringify(stable) : true
    if (!same(cur.cuts, res.cuts) || paramsChanged || cur.pages !== res.pages) {
      view.dispatch(view.state.tr.setMeta(pageKey, { cuts: res.cuts, pages: res.pages, params: stable }).setMeta('addToHistory', false))
    }
    onPages?.(res.pages)
  }
  return {
    refresh(delay = 90) { if (dead) return; clearTimeout(timer); timer = setTimeout(run, delay) },
    enable(v) { on = !!v; clearTimeout(timer); timer = setTimeout(run, 0) },
    destroy() { dead = true; clearTimeout(timer) },
  }
}
