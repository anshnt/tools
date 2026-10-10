// Text layer: per-page text items in base space, character rectangles (for markup, search hits and redaction),
// full-text search and the selectable (invisible) text layer drawn over each rendered page.
import { mul, bbox, toDisp } from './_geom.js'

const ASC = 0.84, DESC = 0.22
let mctx
const measureFor = (font, size) => {
  mctx ??= document.createElement('canvas').getContext('2d')
  mctx.font = `${Math.max(1, size)}px ${font}`
  return (s) => mctx.measureText(s).width
}

/** Items for a source page (0-based) in base space. Cached on app.doc.textCache. */
export function loadItems(doc, src) {
  if (!doc.textCache.has(src)) {
    doc.textCache.set(src, (async () => {
      const page = await doc.page(src)
      const vp = page.getViewport({ scale: 1 })
      const tc = await page.getTextContent()
      const items = []
      for (const it of tc.items) {
        if (!('str' in it)) continue
        if (it.str === '') { if (it.hasEOL && items.length) items.at(-1).eol = true; continue }
        const t = mul(vp.transform, it.transform)
        const size = Math.hypot(t[2], t[3])
        const dirLen = Math.hypot(t[0], t[1])
        if (!size || !dirLen) continue
        const font = tc.styles[it.fontName]?.fontFamily || 'sans-serif'
        const str = it.str.replace(/ /g, ' ')
        items.push({ str, x: t[4], y: t[5], size, ux: t[0] / dirLen, uy: t[1] / dirLen, nx: t[2] / size, ny: t[3] / size, w: it.width || measureFor(font, size)(str), font, eol: !!it.hasEOL })
      }
      return { items, w: vp.width, h: vp.height }
    })())
  }
  return doc.textCache.get(src)
}

/** Bounding rectangle {x,y,w,h} (base space) of characters c0..c1 of an item. */
export function charRect(it, c0, c1) {
  const len = it.str.length
  let f0 = c0 / len, f1 = c1 / len
  if (c0 > 0 || c1 < len) {
    const m = measureFor(it.font, it.size)
    const tot = m(it.str)
    if (tot > 0) { f0 = m(it.str.slice(0, c0)) / tot; f1 = m(it.str.slice(0, c1)) / tot }
  }
  const a = it.w * f0, b = it.w * f1
  const pt = (s, t) => [it.x + it.ux * s + it.nx * t, it.y + it.uy * s + it.ny * t]
  return bbox([pt(a, ASC * it.size), pt(b, ASC * it.size), pt(b, -DESC * it.size), pt(a, -DESC * it.size)])
}

/** Merge rectangles that sit on the same line into one, return [[x,y,w,h]]. */
export function mergeLines(rects) {
  const rs = rects.filter((r) => r.w > 0.2 && r.h > 0.2).sort((p, q) => (Math.abs(p.y - q.y) < Math.min(p.h, q.h) * 0.5 ? p.x - q.x : p.y - q.y))
  const out = []
  for (const r of rs) {
    const l = out.at(-1)
    const overlapY = l && Math.min(l.y + l.h, r.y + r.h) - Math.max(l.y, r.y)
    if (l && overlapY > Math.min(l.h, r.h) * 0.55 && r.x - (l.x + l.w) < Math.max(l.h, r.h) * 0.9) {
      const x2 = Math.max(l.x + l.w, r.x + r.w), y1 = Math.min(l.y, r.y), y2 = Math.max(l.y + l.h, r.y + r.h)
      l.w = x2 - l.x; l.y = y1; l.h = y2 - y1
    } else out.push({ ...r })
  }
  return out.map((r) => [r.x, r.y, r.w, r.h])
}

// ---------- search ----------
const needsSpace = (p, c) => {
  if (p.eol) return true
  const along = (c.x - p.x) * p.ux + (c.y - p.y) * p.uy - p.w
  const across = Math.abs((c.x - p.x) * p.nx + (c.y - p.y) * p.ny)
  return across > p.size * 0.5 || along > p.size * 0.15
}
/** Flatten items to one string with a map from string offsets back to items. */
export function flatten(items) {
  let text = ''
  const starts = []
  items.forEach((it, i) => {
    if (i && needsSpace(items[i - 1], it)) text += ' '
    starts.push(text.length)
    text += it.str
  })
  return { text, starts }
}
const isWord = (c) => !!c && /[\p{L}\p{N}_]/u.test(c)
export function findAll(text, q, { matchCase = false, whole = false } = {}) {
  if (!q) return []
  const hay = matchCase ? text : text.toLowerCase()
  const needle = matchCase ? q : q.toLowerCase()
  const out = []
  for (let i = hay.indexOf(needle); i !== -1 && out.length < 5000; i = hay.indexOf(needle, i + Math.max(1, needle.length))) {
    if (whole && (isWord(hay[i - 1]) || isWord(hay[i + needle.length]))) continue
    out.push([i, i + needle.length])
  }
  return out
}
/** Rectangles [[x,y,w,h]] covering text[start,end) of a flattened page. */
export function rangeRects(items, flat, start, end) {
  const rs = []
  for (let i = 0; i < items.length; i++) {
    const s = flat.starts[i], e = s + items[i].str.length
    if (e <= start) continue
    if (s >= end) break
    rs.push(charRect(items[i], Math.max(start, s) - s, Math.min(end, e) - s))
  }
  return mergeLines(rs)
}

// ---------- text layer ----------
/** Fill `container` with transparent, selectable spans for one page at the given user rotation and zoom. */
export function buildTextLayer(container, items, { rot, w, h, zoom }) {
  const frag = document.createDocumentFragment()
  items.forEach((it, i) => {
    const [ox, oy] = toDisp(rot, w, h, it.x, it.y)
    const [ex, ey] = toDisp(rot, w, h, it.x + it.ux, it.y + it.uy)
    const ang = Math.atan2(ey - oy, ex - ox)
    const fs = it.size * zoom
    const upx = Math.sin(ang), upy = -Math.cos(ang)
    const span = document.createElement('span')
    span.textContent = it.str
    span.dataset.i = i
    const s = span.style
    s.fontSize = `${fs}px`
    s.fontFamily = it.font
    s.left = `${ox * zoom + upx * ASC * fs}px`
    s.top = `${oy * zoom + upy * ASC * fs}px`
    const natural = measureFor(it.font, fs)(it.str)
    const sx = natural > 0 ? (it.w * zoom) / natural : 1
    s.transform = `rotate(${ang}rad)${Number.isFinite(sx) && Math.abs(sx - 1) > 0.01 ? ` scaleX(${sx})` : ''}`
    frag.append(span)
    if (it.eol) frag.append(document.createElement('br'))
  })
  container.replaceChildren(frag)
}

/** Rectangles for the current DOM selection, grouped per page: [{pid, rects: [[x,y,w,h]], text}] */
export function selectionRects(pagesEl, getItems) {
  const sel = getSelection()
  if (!sel || !sel.rangeCount || sel.isCollapsed) return []
  const range = sel.getRangeAt(0)
  const els = [...pagesEl.querySelectorAll('.pg')].filter((pg) => range.intersectsNode(pg))
  const out = []
  for (const pg of els) {
    const items = getItems(pg.dataset.pid)
    if (!items) continue
    const rects = []
    let text = ''
    for (const span of pg.querySelectorAll('.textlayer span[data-i]')) {
      if (!range.intersectsNode(span)) continue
      const tn = span.firstChild
      if (!tn) continue
      const len = tn.length
      const c0 = range.startContainer === tn ? range.startOffset : 0
      const c1 = range.endContainer === tn ? range.endOffset : len
      if (c1 <= c0) continue
      const it = items[+span.dataset.i]
      if (!it) continue
      rects.push(charRect(it, c0, c1))
      text += it.str.slice(c0, c1) + ' '
    }
    const merged = mergeLines(rects)
    if (merged.length) out.push({ pid: pg.dataset.pid, rects: merged, text: text.trim() })
  }
  return out
}
