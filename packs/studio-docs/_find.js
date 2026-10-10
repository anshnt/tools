// Find and replace: a ProseMirror plugin that tracks matches and decorates them, plus the commands the find bar uses.
import { state as S, view as V } from './vendor/prosemirror.js'

const { Plugin, PluginKey, TextSelection } = S
const { Decoration, DecorationSet } = V

export const findKey = new PluginKey('docs-find')
const EMPTY = { q: { text: '', matchCase: false, whole: false }, matches: [], current: -1, deco: DecorationSet.empty }

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** All matches of q in doc as [{from, to}]. Matches stay inside one textblock; images and breaks count as one character. */
export function findMatches(doc, q) {
  if (!q.text) return []
  const re = new RegExp(q.whole ? `(?<![\\p{L}\\p{N}_])${esc(q.text)}(?![\\p{L}\\p{N}_])` : esc(q.text), q.matchCase ? 'gu' : 'giu')
  const out = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = ''
    node.forEach((child) => { text += child.isText ? child.text : '￼' })
    re.lastIndex = 0
    for (let m; (m = re.exec(text)) && out.length < 5000;) {
      out.push({ from: pos + 1 + m.index, to: pos + 1 + m.index + m[0].length })
      if (!m[0].length) re.lastIndex++
    }
    return false
  })
  return out
}

function decorate(doc, matches, current) {
  if (!matches.length) return DecorationSet.empty
  return DecorationSet.create(doc, matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === current ? 'dc-find dc-find-cur' : 'dc-find' })))
}

export function findPlugin() {
  return new Plugin({
    key: findKey,
    state: {
      init: () => EMPTY,
      apply(tr, prev) {
        const meta = tr.getMeta(findKey)
        if (!meta && !tr.docChanged) return prev
        const q = meta?.q ?? prev.q
        const matches = findMatches(tr.doc, q)
        let current = meta && 'current' in meta ? meta.current : prev.current
        if (!matches.length) current = -1
        else if (meta?.q && !('current' in meta)) current = nearest(matches, tr.selection.from)
        else current = Math.min(Math.max(current, 0), matches.length - 1)
        return { q, matches, current, deco: decorate(tr.doc, matches, current) }
      },
    },
    props: { decorations: (st) => findKey.getState(st)?.deco || DecorationSet.empty },
  })
}

const nearest = (matches, pos) => {
  const i = matches.findIndex((m) => m.from >= pos)
  return i < 0 ? 0 : i
}

export const findState = (st) => findKey.getState(st) || EMPTY

export function setQuery(view, q) {
  view.dispatch(view.state.tr.setMeta(findKey, { q: { ...findState(view.state).q, ...q } }))
  const s = findState(view.state)
  if (s.current >= 0) reveal(view, s.matches[s.current])
  return s
}

function reveal(view, m) {
  // scroll the match into view without moving focus out of the find bar
  const dom = view.domAtPos(m.from)
  const el = dom.node.nodeType === 1 ? dom.node : dom.node.parentElement
  el?.scrollIntoView({ block: 'center', behavior: 'instant' })
}

export function stepMatch(view, dir) {
  const s = findState(view.state)
  if (!s.matches.length) return s
  const next = (s.current + dir + s.matches.length) % s.matches.length
  view.dispatch(view.state.tr.setMeta(findKey, { current: next }))
  reveal(view, s.matches[next])
  return findState(view.state)
}

export function selectMatch(view) {
  const s = findState(view.state)
  const m = s.matches[s.current]
  if (!m) return false
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to)).scrollIntoView())
  return true
}

export function replaceCurrent(view, text) {
  const s = findState(view.state)
  const m = s.matches[s.current]
  if (!m) return 0
  const tr = view.state.tr.insertText(text, m.from, m.to)
  view.dispatch(tr)
  const after = findState(view.state)
  if (after.matches.length) {
    const idx = after.matches.findIndex((x) => x.from >= m.from + text.length)
    view.dispatch(view.state.tr.setMeta(findKey, { current: idx < 0 ? 0 : idx }))
    reveal(view, after.matches[idx < 0 ? 0 : idx])
  }
  return 1
}

export function replaceAll(view, text) {
  const s = findState(view.state)
  if (!s.matches.length) return 0
  const tr = view.state.tr
  for (const m of [...s.matches].reverse()) tr.insertText(text, m.from, m.to)
  view.dispatch(tr)
  return s.matches.length
}
