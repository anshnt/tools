// Editing commands and selection queries. A command is (state, dispatch?, view?) => boolean, like ProseMirror's own.
import { state as S, transform as TR, commands as C, schemaList as L, tables as T } from './vendor/prosemirror.js'
import { schema, safeHref, MAX_INDENT, DEFAULT_SIZE } from './_schema.js'

const { TextSelection, NodeSelection } = S
const N = schema.nodes
const M = schema.marks
const LIST_TYPES = new Set([N.bullet_list, N.ordered_list, N.task_list])
const itemFor = (listType) => (listType === N.task_list ? N.task_item : N.list_item)

// ---------- selection queries ----------
export function markIn(st, type) {
  const { from, to, empty, $from } = st.selection
  if (empty) return type.isInSet(st.storedMarks || $from.marks()) || null
  let found = null
  st.doc.nodesBetween(from, to, (n) => { if (!found && n.isInline) found = type.isInSet(n.marks) || null })
  return found
}
export function markActive(st, type) {
  const { from, to, empty, $from } = st.selection
  if (empty) return !!type.isInSet(st.storedMarks || $from.marks())
  return st.doc.rangeHasMark(from, to, type)
}

/** The current word range when the cursor sits strictly inside a word, else null. */
export function wordRange(st) {
  const { $from, empty } = st.selection
  if (!empty || !$from.parent.isTextblock) return null
  const text = $from.parent.textBetween(0, $from.parent.content.size, '\0', '\0')
  const off = $from.parentOffset
  const isW = (c) => !!c && /[\p{L}\p{N}_'-]/u.test(c)
  if (!isW(text[off - 1]) || !isW(text[off])) return null
  let a = off, b = off
  while (a > 0 && isW(text[a - 1])) a--
  while (b < text.length && isW(text[b])) b++
  const start = $from.start()
  return { from: start + a, to: start + b }
}

export function blockStyle(st) {
  if (st.selection instanceof NodeSelection) return 'p'
  const { $from } = st.selection
  const node = $from.parent
  if (node.type === N.heading) return `h${node.attrs.level}`
  if (node.type === N.code_block) return 'code'
  if (node.type === N.paragraph && node.attrs.variant) return node.attrs.variant
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === N.blockquote) return 'quote'
  return 'p'
}

export function blockAttr(st, name) {
  const { $from } = st.selection
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d)
    if (n.isTextblock && n.type.spec.attrs?.[name]) return n.attrs[name]
  }
  return null
}

export function activeList(st) {
  const { $from } = st.selection
  for (let d = $from.depth; d > 0; d--) if (LIST_TYPES.has($from.node(d).type)) return { node: $from.node(d), depth: d, pos: $from.before(d) }
  return null
}

export const inTable = (st) => { const { $from } = st.selection; for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === N.table) return true; return false }
export const selectedImage = (st) => (st.selection instanceof NodeSelection && st.selection.node.type === N.image ? st.selection : null)
export const linkAt = (st) => markIn(st, M.link)
export const fontSizeAt = (st, fallback = DEFAULT_SIZE) => markIn(st, M.fontSize)?.attrs.size ?? fallback

// ---------- marks ----------
function applyToRange(tr, type, from, to, on, attrs) {
  if (on) tr.addMark(from, to, type.create(attrs))
  else tr.removeMark(from, to, type)
}

/** Toggle a mark (bold etc.). Cursor inside a word formats that word; at a word edge it sets the typing style. */
export const toggleMark = (type, attrs) => (st, dispatch) => {
  const word = wordRange(st)
  if (!word) return C.toggleMark(type, attrs)(st, dispatch)
  if (dispatch) {
    const on = !st.doc.rangeHasMark(word.from, word.to, type)
    const tr = st.tr
    applyToRange(tr, type, word.from, word.to, on, attrs)
    dispatch(tr)
  }
  return true
}

/** Set (attrs) or clear (attrs === null) a mark with attributes: colour, highlight, font size, font family, link. */
export const setMark = (type, attrs) => (st, dispatch) => {
  if (dispatch) {
    const tr = st.tr
    const { empty, ranges } = st.selection
    const word = empty ? wordRange(st) : null
    if (word) applyToRange(tr, type, word.from, word.to, !!attrs, attrs)
    else if (empty) {
      const base = (st.storedMarks || st.selection.$from.marks()).filter((m) => m.type !== type)
      tr.setStoredMarks(attrs ? type.create(attrs).addToSet(base) : base)
    } else for (const { $from, $to } of ranges) applyToRange(tr, type, $from.pos, $to.pos, !!attrs, attrs)
    dispatch(tr.scrollIntoView())
  }
  return true
}

export const clearFormatting = (st, dispatch) => {
  if (dispatch) {
    const tr = st.tr
    const { from, to, empty } = st.selection
    if (empty) tr.setStoredMarks([])
    else for (const t of Object.values(M)) tr.removeMark(from, to, t)
    st.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true
      if (node.type === N.heading || node.type === N.code_block) tr.setBlockType(pos, pos + node.nodeSize, N.paragraph)
      else if (node.type === N.paragraph) tr.setNodeMarkup(pos, undefined, { align: null, indent: 0, variant: null, lineHeight: null })
      return false
    })
    dispatch(tr.scrollIntoView())
  }
  return true
}

// ---------- links ----------
export const setLink = (href, title) => (st, dispatch) => {
  const url = safeHref(href)
  if (!url) return false
  return setMark(M.link, { href: url, title: title || null })(st, dispatch)
}

/** The range covered by the link under the cursor (or the selection when it is not empty). */
export function linkRange(st) {
  const { $from, empty, from, to } = st.selection
  if (!empty) return { from, to }
  const mark = M.link.isInSet($from.marks())
  if (!mark) return null
  const base = $from.start()
  const runs = []
  let cur = null
  $from.parent.forEach((child, off) => {
    const a = base + off, b = a + child.nodeSize
    if (child.marks.some((m) => m.eq(mark))) { if (cur) cur[1] = b; else cur = [a, b] } else if (cur) { runs.push(cur); cur = null }
  })
  if (cur) runs.push(cur)
  const r = runs.find(([a, b]) => $from.pos >= a && $from.pos <= b)
  return r ? { from: r[0], to: r[1] } : null
}

// ---------- blocks ----------
function eachTextblock(st, fn) {
  const { from, to } = st.selection
  st.doc.nodesBetween(from, to, (node, pos) => { if (node.isTextblock) { fn(node, pos); return false } return true })
}

export const setBlockAttr = (name, value) => (st, dispatch) => {
  let any = false
  const tr = st.tr
  eachTextblock(st, (node, pos) => {
    if (!node.type.spec.attrs?.[name]) return
    any = true
    if (node.attrs[name] !== value) tr.setNodeMarkup(pos, undefined, { ...node.attrs, [name]: value })
  })
  if (any && dispatch) dispatch(tr.scrollIntoView())
  return any
}

const unwrapQuote = (st, dispatch) => {
  const { $from, $to } = st.selection
  const range = $from.blockRange($to, (n) => n.type === N.blockquote)
  const target = range && TR.liftTarget(range)
  if (target == null) return false
  if (dispatch) dispatch(st.tr.lift(range, target).scrollIntoView())
  return true
}

/** style: 'p' | 'title' | 'subtitle' | 'h1'..'h6' | 'quote' | 'code' */
export const setBlockStyle = (style) => (st, dispatch) => {
  if (style === 'quote') return blockStyle(st) === 'quote' ? unwrapQuote(st, dispatch) : C.wrapIn(N.blockquote)(st, dispatch)
  if (style === 'code') return C.setBlockType(N.code_block)(st, dispatch)
  let any = false
  const tr = st.tr
  eachTextblock(st, (node, pos) => {
    any = true
    const keep = { align: node.attrs.align ?? null, indent: node.attrs.indent ?? 0 }
    if (/^h[1-6]$/.test(style)) tr.setNodeMarkup(pos, N.heading, { ...keep, level: +style[1] })
    else tr.setNodeMarkup(pos, N.paragraph, { ...keep, variant: style === 'title' || style === 'subtitle' ? style : null, lineHeight: node.attrs.lineHeight ?? null })
  })
  if (any && dispatch) dispatch(tr.scrollIntoView())
  return any
}

export const changeIndent = (dir) => (st, dispatch) => {
  const list = activeList(st)
  if (list) {
    const it = itemFor(list.node.type)
    const ok = (dir > 0 ? L.sinkListItem(it) : L.liftListItem(it))(st, dispatch)
    return ok || dir > 0 // keep Tab inside the editor even on the first item
  }
  let any = false
  const tr = st.tr
  eachTextblock(st, (node, pos) => {
    if (!node.type.spec.attrs?.indent) return
    const next = Math.min(MAX_INDENT, Math.max(0, (node.attrs.indent || 0) + dir))
    any = true
    if (next !== node.attrs.indent) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next })
  })
  if (any && dispatch) dispatch(tr.scrollIntoView())
  return any
}

/** The innermost list around each text block in the selection, outermost position first. */
function listsInSelection(st) {
  const { from, to } = st.selection
  const found = new Map()
  st.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true
    const $p = st.doc.resolve(pos)
    for (let d = $p.depth; d > 0; d--) {
      if (LIST_TYPES.has($p.node(d).type)) { found.set($p.before(d), { node: $p.node(d), pos: $p.before(d) }); break }
    }
    return false
  })
  return [...found.values()].sort((x, y) => x.pos - y.pos)
}

export const listActive = (st, listType) => {
  const lists = listsInSelection(st)
  return lists.length > 0 && lists.every((l) => l.node.type === listType)
}

export const toggleList = (listType) => (st, dispatch) => {
  const lists = listsInSelection(st)
  if (!lists.length) return L.wrapInList(listType)(st, dispatch)
  const tr = st.tr
  if (!lists.every((l) => l.node.type === listType)) { // some other kind of list: convert every list in the selection
    const newItem = itemFor(listType)
    for (const l of lists) {
      if (l.node.type === listType) continue
      tr.setNodeMarkup(l.pos, listType, listType === N.ordered_list ? { order: 1 } : null)
      l.node.forEach((child, off) => tr.setNodeMarkup(l.pos + 1 + off, newItem, newItem === N.task_item ? { checked: false } : null))
    }
    if (dispatch) dispatch(tr.scrollIntoView())
    return true
  }
  // same kind: take the selected items out of their lists, last list first so earlier positions stay valid
  const { from, to } = st.selection
  const it = itemFor(listType)
  let s = st
  const steps = []
  for (const l of [...lists].reverse()) {
    const a = Math.max(from, l.pos + 2), b = Math.min(to, l.pos + l.node.nodeSize - 2)
    const sel = TextSelection.between(s.doc.resolve(Math.min(a, b)), s.doc.resolve(Math.max(a, b)))
    s = s.apply(s.tr.setSelection(sel))
    for (let guard = 0; guard < 12 && listsInSelection(s).some((x) => x.node.type === listType); guard++) {
      if (!L.liftListItem(it)(s, (t) => { steps.push(...t.steps); s = s.apply(t) })) break
    }
  }
  if (!steps.length) return false
  if (dispatch) { for (const step of steps) tr.step(step); dispatch(tr.scrollIntoView()) }
  return true
}

// ---------- inserts ----------
export const insertHR = (st, dispatch) => {
  if (dispatch) dispatch(st.tr.replaceSelectionWith(N.horizontal_rule.create()).scrollIntoView())
  return true
}

export const insertPageBreak = (st, dispatch) => {
  if (!dispatch) return true
  const tr = st.tr
  if (!tr.selection.empty) tr.deleteSelection()
  const $p = tr.doc.resolve(tr.selection.from)
  if (!$p.parent.isTextblock) { dispatch(tr.replaceSelectionWith(N.page_break.create()).scrollIntoView()); return true }
  const size = $p.parent.content.size, off = $p.parentOffset
  const firstInItem = $p.depth > 1 && /_item$/.test($p.node($p.depth - 1).type.name) && $p.index($p.depth - 1) === 0
  let at
  if (off === 0 && size > 0 && !firstInItem) at = $p.before()
  else if (off === size || firstInItem) at = $p.after()
  else { tr.split($p.pos); at = $p.pos + 1 }
  tr.insert(at, N.page_break.create())
  const after = at + 1
  if (!tr.doc.resolve(after).nodeAfter) tr.insert(after, N.paragraph.create())
  tr.setSelection(TextSelection.near(tr.doc.resolve(after), 1))
  dispatch(tr.scrollIntoView())
  return true
}

export const insertImage = (attrs) => (st, dispatch) => {
  if (dispatch) dispatch(st.tr.replaceSelectionWith(N.image.create(attrs)).scrollIntoView())
  return true
}

export const insertTable = (rows, cols, header = true) => (st, dispatch) => {
  if (inTable(st)) return false
  if (dispatch) {
    const makeRow = (type) => N.table_row.create(null, Array.from({ length: cols }, () => type.createAndFill()))
    const body = Array.from({ length: rows }, (_, r) => makeRow(header && r === 0 ? N.table_header : N.table_cell))
    const table = N.table.create(null, body)
    const { $from } = st.selection
    const tr = st.tr
    let at
    if ($from.depth === 1 && $from.parent.isTextblock && $from.parent.content.size === 0) {
      const start = $from.before(), end = $from.after()
      tr.replaceWith(start, end, table)
      at = start
    } else {
      at = $from.depth >= 1 ? $from.after(1) : $from.pos
      tr.insert(at, table)
    }
    const afterTable = at + table.nodeSize
    if (!tr.doc.resolve(afterTable).nodeAfter) tr.insert(afterTable, N.paragraph.create())
    tr.setSelection(TextSelection.near(tr.doc.resolve(at + 3)))
    dispatch(tr.scrollIntoView())
  }
  return true
}

export const setCellBackground = (color) => (st, dispatch) => (inTable(st) ? T.setCellAttr('background', color || null)(st, dispatch) : false)

/** Run a table command that removes cells, then put the cursor back into the nearest remaining cell. */
const keepInTable = (command) => (st, dispatch) => {
  if (!dispatch || !inTable(st)) return command(st, dispatch)
  const rect = T.selectedRect(st)
  return command(st, (tr) => {
    const table = tr.doc.nodeAt(rect.tableStart - 1)
    if (table?.type === N.table) {
      const map = T.TableMap.get(table)
      const at = rect.tableStart + map.positionAt(Math.min(rect.top, map.height - 1), Math.min(rect.left, map.width - 1), table)
      tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)))
    }
    dispatch(tr)
  })
}

export const tableCmd = {
  addRowBefore: T.addRowBefore, addRowAfter: T.addRowAfter, deleteRow: keepInTable(T.deleteRow),
  addColBefore: T.addColumnBefore, addColAfter: T.addColumnAfter, deleteCol: keepInTable(T.deleteColumn),
  deleteTable: T.deleteTable, merge: T.mergeCells, split: T.splitCell, toggleHeaderRow: T.toggleHeaderRow,
}

export const setImageAttrs = (patch) => (st, dispatch) => {
  const sel = selectedImage(st)
  if (!sel) return false
  if (dispatch) {
    const tr = st.tr.setNodeMarkup(sel.from, undefined, { ...sel.node.attrs, ...patch })
    dispatch(tr.setSelection(NodeSelection.create(tr.doc, sel.from)))
  }
  return true
}

const SIZE_STEPS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 48, 56, 64, 72, 96]
export const stepFontSize = (dir) => (st, dispatch) => {
  const cur = fontSizeAt(st)
  const next = dir > 0 ? SIZE_STEPS.find((s) => s > cur) ?? cur : [...SIZE_STEPS].reverse().find((s) => s < cur) ?? cur
  return setMark(M.fontSize, { size: next })(st, dispatch)
}
