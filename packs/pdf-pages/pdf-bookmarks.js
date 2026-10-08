// PDF bookmark editor: shows the existing outline as an editable tree (rename, change page, nest, reorder, delete, undo),
// imports a pasted table of contents, and writes a fresh /Outlines tree with pdf-lib low-level objects.
import { h, icon, button, busy, progress, field, input, number, toggle, stats, empty, clear, formatBytes, downloadButton, toast, alert } from '../../lib/ui.js'
import { suffixName } from '../../lib/files.js'
import { savePdf } from '../../lib/pdf.js'
import { pdfLib } from '../../lib/libs.js'
import { pdfSource, ppRoot, doneCard, useStyle, readOutline, whenVisible } from './_shared.js'

let nextId = 1
export const makeNode = (title, page, items = [], extra = {}) => ({ id: nextId++, title, page, open: true, bold: false, italic: false, ...extra, items })

/** Outline tree from pdf.js (0-based pages) to editor nodes (1-based pages). */
export function nodesFromOutline(tree, pageCount) {
  return tree.map((n) => makeNode(n.title, n.page == null ? null : Math.min(pageCount, n.page + 1), nodesFromOutline(n.items || [], pageCount), { bold: n.bold, italic: n.italic, open: !(n.items?.length > 6) }))
}

/**
 * Parse a pasted table of contents. One bookmark per line: "Title ..... 12", "Title, 12" or "Title 12".
 * Nesting comes from indentation, or from numbering like 1.2.3 when nothing is indented. offset is added to every page number.
 * -> {nodes, noPage: count of lines without a page, clamped: count of pages moved into range}
 */
export function parseOutlineText(text, { offset = 0, pageCount = 9999 } = {}) {
  const raw = text.split(/\r?\n/).filter((l) => l.trim())
  const lines = raw.map((l) => {
    const ind = l.match(/^[ \t]*/)[0]
    const body = l.trim()
    const m = body.match(/^(.*?)(?:\s*(?:\.{2,}|…+|[\s,.·_-]*\t+|,)\s*|\s+)(?:p\.?\s*)?(\d{1,5})$/i)
    const title = (m ? m[1] : body).replace(/[\s.…·_-]+$/, '').trim()
    return { ind, tabs: (ind.match(/\t/g) || []).length, spaces: ind.replace(/\t/g, '').length, title: title || body, page: m ? +m[2] : null }
  })
  const unit = Math.min(...lines.map((l) => l.spaces).filter((x) => x > 0), Infinity)
  const numbered = lines.filter((l) => /^\d+(\.\d+)*[.)]?\s/.test(l.title)).length
  const anyIndent = lines.some((l) => l.tabs || l.spaces)
  const levelOf = (l) => (anyIndent ? l.tabs + (Number.isFinite(unit) ? Math.floor(l.spaces / unit) : 0)
    : numbered >= lines.length / 2 ? ((l.title.match(/^(\d+(?:\.\d+)*)/)?.[1].split('.').length || 1) - 1) : 0)
  const root = { items: [] }
  const stack = [{ level: -1, node: root }]
  let noPage = 0, clamped = 0, lastPage = 1
  for (const l of lines) {
    let level = Math.max(0, levelOf(l))
    level = Math.min(level, stack.length - 1) // never skip a level
    while (stack.at(-1).level >= level) stack.pop()
    let page = l.page == null ? lastPage : l.page + offset
    if (l.page == null) noPage++
    const c = Math.min(pageCount, Math.max(1, page))
    if (c !== page) clamped++
    page = c
    lastPage = page
    const node = makeNode(l.title, page)
    stack.at(-1).node.items.push(node)
    stack.push({ level, node })
  }
  return { nodes: root.items, noPage, clamped }
}

/** Number of items visible below a node (children, plus the children of open children, ...). */
export const visibleBelow = (items) => items.reduce((n, it) => n + 1 + (it.open ? visibleBelow(it.items) : 0), 0)
export const countAll = (items) => items.reduce((n, it) => n + 1 + countAll(it.items), 0)

/** Write the outline into a pdf-lib document, replacing any existing one. */
export async function writeOutline(doc, nodes, { showPanel = true } = {}) {
  const { PDFName, PDFHexString, PDFNumber, PDFRef, PDFDict, PDFArray } = await pdfLib()
  const ctx = doc.context
  const N = (n) => PDFName.of(n)
  const cat = doc.catalog
  // remember the old outline objects so they do not stay behind as dead weight
  const old = []
  const collect = (ref, depth = 0) => {
    for (let r = ref; r instanceof PDFRef && depth < 50;) {
      const d = ctx.lookup(r)
      if (!(d instanceof PDFDict)) break
      old.push(r)
      const first = d.get(N('First'))
      if (first instanceof PDFRef) collect(first, depth + 1)
      r = d.get(N('Next'))
      if (old.includes(r)) break
    }
  }
  const oldRoot = cat.get(N('Outlines'))
  if (oldRoot instanceof PDFRef) { old.push(oldRoot); const d = ctx.lookup(oldRoot); if (d instanceof PDFDict && d.get(N('First')) instanceof PDFRef) collect(d.get(N('First'))) }
  const pages = doc.getPages()
  const build = (items, parent) => {
    const refs = items.map(() => ctx.nextRef())
    items.forEach((it, i) => {
      const d = ctx.obj({})
      d.set(N('Title'), PDFHexString.fromText(it.title || 'Untitled'))
      d.set(N('Parent'), parent)
      if (i > 0) d.set(N('Prev'), refs[i - 1])
      if (i < items.length - 1) d.set(N('Next'), refs[i + 1])
      const pg = pages[Math.min(pages.length, Math.max(1, it.page || 1)) - 1]
      d.set(N('Dest'), ctx.obj([pg.ref, N('XYZ'), null, null, null]))
      const flags = (it.italic ? 1 : 0) | (it.bold ? 2 : 0)
      if (flags) d.set(N('F'), PDFNumber.of(flags))
      if (it.items.length) {
        const c = build(it.items, refs[i])
        d.set(N('First'), c.first); d.set(N('Last'), c.last)
        const vis = visibleBelow(it.items)
        d.set(N('Count'), PDFNumber.of(it.open ? vis : -vis))
      }
      ctx.assign(refs[i], d)
    })
    return { first: refs[0], last: refs.at(-1) }
  }
  if (!nodes.length) {
    cat.delete(N('Outlines'))
  } else {
    const rootRef = ctx.nextRef()
    const c = build(nodes, rootRef)
    const rootDict = ctx.obj({})
    rootDict.set(N('Type'), N('Outlines'))
    rootDict.set(N('First'), c.first); rootDict.set(N('Last'), c.last)
    rootDict.set(N('Count'), PDFNumber.of(visibleBelow(nodes)))
    ctx.assign(rootRef, rootDict)
    cat.set(N('Outlines'), rootRef)
    if (showPanel) cat.set(N('PageMode'), N('UseOutlines'))
  }
  for (const r of old) ctx.delete(r)
}

export function mount(root, { signal }) {
  const body = h('div', { class: 'stack' })
  let s
  const src = pdfSource({ onLoad: (source) => { s = source; return load(source) }, onClear: () => { s = null; clear(body) } })

  async function load(source) {
    await source.pageSizes()
    const tree = await readOutline(source.doc)
    if (source.dead) return
    show(tree ? nodesFromOutline(tree, source.pages) : [], source)
  }

  function show(initial, source) {
    const n = source.pages
    let tree = initial
    let selected = null
    const history = []
    const o = { panel: true }
    const info = h('div')
    const list = h('div', { class: 'pp-tree', role: 'tree', 'aria-label': 'Bookmarks' })
    const previewBox = h('div', { class: 'pp-bm-preview' })
    const strip = h('div', { class: 'pp-strip' })
    const prog = progress(), result = h('div')
    const undoBtn = button('Undo', { icon: 'undo-2', variant: 'ghost', size: 'sm', onClick: () => undo() })
    const go = button('Save bookmarks', { icon: 'bookmark-plus', variant: 'primary', size: 'lg' })
    function countNoPage(items) { return items.reduce((a, it) => a + (it.page == null ? 1 : 0) + countNoPage(it.items), 0) }
    const find = (items, id, parent = null) => {
      for (let i = 0; i < items.length; i++) {
        if (items[i].id === id) return { list: items, i, parent, node: items[i] }
        const r = find(items[i].items, id, items[i]); if (r) return r
      }
      return null
    }
    const snapshot = () => { history.push(JSON.stringify(tree)); if (history.length > 40) history.shift(); undoBtn.disabled = false }
    function undo() {
      const prev = history.pop()
      if (prev == null) return
      tree = JSON.parse(prev)
      if (selected != null && !find(tree, selected)) selected = null
      undoBtn.disabled = history.length === 0
      render()
    }
    const mutate = (fn) => { snapshot(); fn(); render() }

    function setPreview() {
      const f = selected != null ? find(tree, selected) : null
      const page = f?.node.page
      clear(previewBox)
      if (!page) { previewBox.append(empty(f ? 'This bookmark has no page in this file. Pick one below.' : 'Select a bookmark to see the page it opens.', 'bookmark')); return }
      const paper = h('div', { class: 'pp-paper', style: { aspectRatio: `${source.sizeOf(page).w} / ${source.sizeOf(page).h}` } })
      source.thumbURL(page, 520).then((u) => paper.append(h('img', { src: u, alt: `Page ${page}`, draggable: false })), () => {})
      previewBox.append(paper, h('div', { class: 'pp-hint', style: 'text-align:center' }, `Page ${page} of ${n}`))
    }

    function row(node, depth) {
      const hasKids = node.items.length > 0
      const f = find(tree, node.id)
      const title = input({ value: node.title, 'aria-label': 'Bookmark title', oninput: (e) => { node.title = e.target.value }, onfocus: () => select(node.id, false) })
      const page = number(node.page ?? '', { min: 1, max: n, step: 1, ariaLabel: 'Page number', onInput: (v) => { node.page = Number.isFinite(v) ? Math.min(n, Math.max(1, Math.round(v))) : null; if (selected === node.id) setPreview() } })
      page.addEventListener('focus', () => select(node.id, false))
      const btn = (ic, label, fn, disabled) => button('', { icon: ic, variant: 'ghost', size: 'sm', ariaLabel: label, title: label, disabled, onClick: (e) => { e.stopPropagation(); fn() } })
      const prevSib = f.i > 0 ? f.list[f.i - 1] : null
      const el = h('div', { class: ['pp-tree-row', selected === node.id && 'sel', node.page == null && 'nopage'], role: 'treeitem', 'aria-level': depth + 1, 'aria-expanded': hasKids ? String(node.open) : null, style: { '--d': depth }, onclick: () => select(node.id, true) },
        hasKids ? btn(node.open ? 'chevron-down' : 'chevron-right', node.open ? 'Collapse' : 'Expand', () => { node.open = !node.open; render() }) : h('span', { class: 'pp-tree-dot' }),
        h('div', { class: 'pp-tree-title' }, title),
        h('div', { class: 'pp-tree-page' }, page),
        h('div', { class: 'pp-tree-actions' },
          btn('arrow-up', 'Move up', () => mutate(() => { [f.list[f.i - 1], f.list[f.i]] = [f.list[f.i], f.list[f.i - 1]] }), f.i === 0),
          btn('arrow-down', 'Move down', () => mutate(() => { [f.list[f.i + 1], f.list[f.i]] = [f.list[f.i], f.list[f.i + 1]] }), f.i === f.list.length - 1),
          btn('indent-increase', 'Nest under the bookmark above', () => mutate(() => { f.list.splice(f.i, 1); prevSib.items.push(node); prevSib.open = true }), !prevSib),
          btn('indent-decrease', 'Move out one level', () => mutate(() => { const g = find(tree, f.parent.id); f.list.splice(f.i, 1); g.list.splice(g.i + 1, 0, node) }), !f.parent),
          btn('corner-down-right', 'Add a sub-bookmark', () => mutate(() => { const nn = makeNode('New bookmark', node.page || 1); node.items.push(nn); node.open = true; selected = nn.id })),
          btn('trash-2', 'Delete', () => mutate(() => { f.list.splice(f.i, 1); if (selected === node.id) selected = null }))))
      return el
    }
    function select(id, rerender) {
      if (selected === id) return
      selected = id
      if (rerender) { list.querySelectorAll('.pp-tree-row').forEach((r) => r.classList.remove('sel')); }
      list.querySelectorAll('.pp-tree-row').forEach((r, i) => r.classList.toggle('sel', r.dataset.id === String(id)))
      setPreview()
    }

    function render() {
      clear(list)
      const walk = (items, depth) => items.forEach((it) => { const r = row(it, depth); r.dataset.id = it.id; if (selected === it.id) r.classList.add('sel'); list.append(r); if (it.open) walk(it.items, depth + 1) })
      if (!tree.length) list.append(empty('No bookmarks yet. Add one, or paste a table of contents below.', 'bookmark-plus'))
      else walk(tree, 0)
      const total = countAll(tree)
      const st = stats([{ label: 'Pages', value: String(n) }, { label: 'Bookmarks', value: String(total), accent: total > 0 }, { label: 'Top level', value: String(tree.length) }])
      const noPage = countNoPage(tree)
      clear(info, st, noPage ? h('div', { style: 'margin-top:10px' }, alert('warn', `${noPage} existing bookmark${noPage > 1 ? 's' : ''} did not point to a page in this PDF (for example a web link). Give ${noPage > 1 ? 'them' : 'it'} a page, or they will go to page 1.`)) : null)
      go.disabled = false
      setPreview()
    }

    // quick page strip: click a page to point the selected bookmark at it
    for (let p = 1; p <= n; p++) {
      const t = h('button', { type: 'button', class: 'pp-strip-item', 'aria-label': `Use page ${p}`, title: `Use page ${p}`, onclick: () => {
        const f = selected != null ? find(tree, selected) : null
        if (!f) { toast('Select a bookmark first, or press Add bookmark.'); return }
        f.node.page = p; render()
      } }, h('div', { class: 'pp-paper', style: { aspectRatio: `${source.sizeOf(p).w} / ${source.sizeOf(p).h}` } }), h('span', p))
      const paper = t.firstChild
      whenVisible(paper, () => source.thumbURL(p, 140).then((u) => paper.append(h('img', { src: u, alt: '', draggable: false })), () => {}))
      strip.append(t)
    }

    const addTop = button('Add bookmark', { icon: 'plus', variant: 'secondary', size: 'sm', onClick: () => mutate(() => { const f = selected != null ? find(tree, selected) : null; const nn = makeNode('New bookmark', f?.node.page || 1); if (f) f.list.splice(f.i + 1, 0, nn); else tree.push(nn); selected = nn.id }) })
    const clearBtn = button('Remove all', { icon: 'trash-2', variant: 'ghost', size: 'sm', onClick: () => { if (!tree.length) return; mutate(() => { tree = []; selected = null }) } })
    const collapse = button('Collapse all', { icon: 'chevrons-down-up', variant: 'ghost', size: 'sm', onClick: () => { const f = (a) => a.forEach((x) => { x.open = false; f(x.items) }); f(tree); render() } })
    const expand = button('Expand all', { icon: 'chevrons-up-down', variant: 'ghost', size: 'sm', onClick: () => { const f = (a) => a.forEach((x) => { x.open = true; f(x.items) }); f(tree); render() } })

    // paste a table of contents
    const paste = h('textarea', { class: 'textarea mono', rows: 6, placeholder: 'Introduction .......... 1\n  Background .......... 2\n  Aims .......... 4\nMethods .......... 7\n1. Results, 12', 'aria-label': 'Table of contents text', spellcheck: false })
    const offsetEl = number(0, { step: 1, ariaLabel: 'Page offset' })
    const importBtn = button('Add to bookmarks', { icon: 'list-plus', variant: 'secondary', onClick: () => {
      const r = parseOutlineText(paste.value, { offset: Number.isFinite(offsetEl.valueAsNumber) ? offsetEl.valueAsNumber : 0, pageCount: n })
      if (!r.nodes.length) { toast('Nothing to add yet. Type or paste some lines first.', 'error'); return }
      mutate(() => { tree.push(...r.nodes); selected = r.nodes[0].id })
      toast(`Added ${countAll(r.nodes)} bookmarks${r.noPage ? `, ${r.noPage} without a page (set to the page before)` : ''}${r.clamped ? `, ${r.clamped} page numbers moved into range` : ''}.`, r.noPage || r.clamped ? 'info' : 'success')
      paste.value = ''
    } })
    const pasteBox = h('details', { class: 'pp-paste' }, h('summary', icon('clipboard-paste'), 'Paste a table of contents'),
      h('div', { class: 'stack', style: 'margin-top:12px' }, paste,
        h('div', { class: 'grid-2' }, field('Page offset', offsetEl, 'Printed page 1 is PDF page 5? Enter 4.'), h('div', { style: 'align-self:end' }, importBtn)),
        h('div', { class: 'pp-hint' }, 'One bookmark per line. Page numbers go at the end. Indent a line, or number it like 1.2, to nest it.')))

    go.addEventListener('click', () => busy(go, async () => {
      clear(result)
      const doc = await s.edit()
      const bad = []
      const clean = (items) => items.map((it) => { if (it.page == null) bad.push(it); return { ...it, page: it.page || 1, items: clean(it.items) } })
      await writeOutline(doc, clean(tree), { showPanel: o.panel })
      const blob = await savePdf(doc)
      const total = countAll(tree)
      clear(result, doneCard({
        title: total ? `${total} bookmarks saved` : 'Bookmarks removed', detail: total ? `They show in the bookmarks panel of any PDF viewer.${bad.length ? ` ${bad.length} without a page now go to page 1.` : ''} ${formatBytes(blob.size)}.` : `The outline was removed. ${formatBytes(blob.size)}.`,
        actions: [downloadButton(blob, suffixName(s.name, 'bookmarks'), 'Download PDF', { size: 'lg' })],
      }))
    }, { label: 'Writing', errorTo: result, progress: prog }))

    const editor = h('div', { class: 'panel' }, h('div', { class: 'stack' },
      h('div', { class: 'pp-toolbar' }, addTop, undoBtn, h('span', { class: 'grow' }), expand, collapse, clearBtn),
      list))
    const side = h('div', { class: 'stack pp-bm-side' }, h('div', { class: 'panel' }, h('div', { class: 'pp-section-title', style: 'margin-bottom:10px' }, icon('eye'), 'Opens this page'), previewBox))
    undoBtn.disabled = true
    clear(body, info,
      h('div', { class: 'tool-split wide-left' }, editor, side),
      h('div', { class: 'panel' }, h('div', { class: 'stack tight' }, h('div', { class: 'pp-section-title' }, icon('mouse-pointer-click'), 'Pick a page for the selected bookmark'), strip)),
      pasteBox,
      toggle('Open the bookmarks panel when the PDF opens', true, (c) => { o.panel = c }),
      h('div', { class: 'row' }, go), prog.el, result)
    if (tree.length) selected = tree[0].id
    render()
  }

  useStyle('pp-style-bookmarks', CSS)
  root.append(ppRoot(src.el, body))
}

const CSS = `
.pp .pp-tree { display: flex; flex-direction: column; gap: 6px; max-height: 620px; overflow: auto; padding: 2px; }
.pp .pp-tree-row { display: flex; align-items: center; gap: 6px; padding: 5px 6px 5px calc(6px + var(--d, 0) * 22px); border-radius: 12px; border: 1px solid transparent; background: var(--surface-2); transition: background .2s, border-color .2s; animation: pp-pop .35s var(--ease) both; }
.pp .pp-tree-row:hover { border-color: var(--border-strong); }
.pp .pp-tree-row.sel { border-color: var(--accent); background: var(--accent-soft); box-shadow: 0 0 0 3px var(--ring); }
.pp .pp-tree-row.nopage .pp-tree-page input { border-color: var(--danger); }
.pp .pp-tree-dot { width: 34px; height: 34px; flex: none; display: grid; place-items: center; }
.pp .pp-tree-dot::after { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--border-strong); }
.pp .pp-tree-title { flex: 1; min-width: 120px; }
.pp .pp-tree-title input { height: 34px; }
.pp .pp-tree-page { width: 78px; flex: none; }
.pp .pp-tree-page input { height: 34px; padding: 0 8px; }
.pp .pp-tree-actions { display: flex; flex-wrap: wrap; gap: 0; flex: none; }
.pp .pp-bm-side { position: sticky; top: calc(var(--header-h) + 14px); }
.pp .pp-bm-preview .pp-paper { max-width: 360px; margin: 0 auto 8px; }
.pp .pp-strip { display: flex; gap: 10px; overflow-x: auto; padding: 4px 2px 10px; scroll-snap-type: x proximity; }
.pp .pp-strip-item { all: unset; box-sizing: border-box; flex: none; width: 70px; display: flex; flex-direction: column; align-items: center; gap: 4px; cursor: pointer; scroll-snap-align: start; border-radius: 8px; transition: transform .25s var(--spring); }
.pp .pp-strip-item:hover { transform: translateY(-4px); }
.pp .pp-strip-item:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.pp .pp-strip-item span { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.pp .pp-paste { border: 1px solid var(--border); border-radius: 18px; padding: 14px 18px; background: var(--surface); }
.pp .pp-paste summary { cursor: pointer; display: flex; align-items: center; gap: 8px; font-weight: 600; list-style: none; min-height: 32px; }
.pp .pp-paste summary::-webkit-details-marker { display: none; }
@media (max-width: 900px) { .pp .pp-bm-side { position: static; } .pp .pp-tree-actions { width: 100%; justify-content: flex-end; } .pp .pp-tree-title { flex-basis: 50%; } }
`
