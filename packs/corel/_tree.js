// Tree documents for Draw Studio: page > layer > group > item. Pure (no DOM), so Node tests cover it.
//
//   Tree doc  { pages: [{ w, h, name?, layers: [{ name, hidden, locked, printable, items }], guides? }], warnings, fonts? }
//   items may hold groups { t:'group', name, id?, items } recursively. Flat docs (the shared model) keep items on the page.
// flattenDoc(treeFromFlat(flat)) deep-equals flat. Nothing here mutates its input.

export const isTree = (doc) => Array.isArray(doc?.pages?.[0]?.layers)

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/** One layer "Layer 1" per page; items move into it. Ids, names, fonts and warnings are untouched. */
export function treeFromFlat(doc) {
  const out = { ...doc, pages: doc.pages.map((p) => {
    const { items, ...rest } = p
    return { ...rest, layers: [{ name: 'Layer 1', hidden: false, locked: false, printable: true, items: items || [] }] }
  }) }
  if (!has(doc, 'warnings')) out.warnings = []
  return out
}

/** Call fn(node, ctx) for every group and leaf, back to front. ctx = {page, pageIndex, layer, parent, depth}. Return false to skip a group's children. */
export function walkTree(doc, fn) {
  const rec = (items, ctx) => {
    for (const node of items) {
      const r = fn(node, ctx)
      if (node.t === 'group' && r !== false && node.items) rec(node.items, { ...ctx, parent: node, depth: ctx.depth + 1 })
    }
  }
  doc.pages.forEach((page, pageIndex) => {
    for (const layer of page.layers || [{ items: page.items || [] }]) rec(layer.items, { page, pageIndex, layer, parent: null, depth: 0 })
  })
}

/**
 * Tree (or flat) doc -> flat doc {pages:[{w,h,name?,items}], warnings, fonts?}. Depth first, back to front, groups dissolved.
 * opts: {pages: indexes, only: Set of ids (a leaf is kept when its id or an ancestor group id is in the set), keepHidden, pruneFonts = true}
 * Hidden items and hidden or non-printable layers are dropped unless keepHidden.
 */
export function flattenDoc(doc, opts = {}) {
  const { pages, only, keepHidden = false, pruneFonts = true } = opts
  const used = new Set()
  const take = (items, out, inOnly) => {
    for (const it of items) {
      if (!keepHidden && it.hidden) continue
      const sel = !only || inOnly || only.has(it.id)
      if (it.t === 'group') take(it.items || [], out, sel)
      else if (sel) { out.push(it); if (it.t === 'text' && it.font != null) used.add(it.font) }
    }
  }
  const idx = pages || doc.pages.map((_, i) => i)
  const outPages = []
  for (const i of idx) {
    const p = doc.pages[i]
    if (!p) continue
    const items = []
    if (Array.isArray(p.layers)) {
      for (const layer of p.layers) {
        if (!keepHidden && (layer.hidden || layer.printable === false)) continue
        take(layer.items || [], items, false)
      }
    } else take(p.items || [], items, false)
    const { layers, guides, pending, bg, id, ...rest } = p
    outPages.push({ ...rest, items })
  }
  const out = { pages: outPages, warnings: doc.warnings ? [...doc.warnings] : [] }
  if (doc.fonts) {
    if (pruneFonts) { out.fonts = {}; for (const k of used) if (doc.fonts[k]) out.fonts[k] = doc.fonts[k] }
    else out.fonts = { ...doc.fonts }
  }
  return out
}
