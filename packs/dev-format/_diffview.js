// Diff rendering shared by the diff checker and the JSON diff: line rows (aligned old/new lines with word-level marks inside
// changed lines), side-by-side and unified views with collapsible unchanged runs, and an inline word/character view.
// Uses jsdiff from lib/libs.js. Row building is pure (no DOM) so it can be tested in Node.
import { h } from '../../lib/ui.js'
import { diff as loadDiff } from '../../lib/libs.js'

const splitLines = (t) => {
  if (t === '') return []
  const l = t.split('\n')
  if (l[l.length - 1] === '') l.pop()
  return l.map((x) => x.replace(/\r$/, ''))
}

/** jsdiff comparator for the 'ignore whitespace' and 'ignore case' options (null when neither is on). Runs of whitespace count as one space, like diff -b. */
export function lineComparator(o = {}) {
  if (!o.ignoreWhitespace && !o.ignoreCase) return null
  const norm = (t) => {
    let x = t.replace(/\r?\n$/, '')
    if (o.ignoreWhitespace) x = x.replace(/\s+/g, ' ').trim()
    return o.ignoreCase ? x.toLowerCase() : x
  }
  return (x, y) => norm(x) === norm(y)
}

/**
 * Align two texts line by line. o: {ignoreWhitespace, ignoreCase}
 * Returns {rows, stats, D, approximate}. A row is {t: 'eq' | 'chg' | 'rem' | 'add', l, r (1-based line numbers or null), lt, rt (text)}.
 */
export async function diffLineRows(a, b, o = {}) {
  const D = await loadDiff()
  const A = splitLines(a), B = splitLines(b)
  const cmp = lineComparator(o)
  let parts = D.diffLines(a, b, { stripTrailingCr: true, ignoreNewlineAtEof: true, timeout: o.timeout ?? 8000, ...(cmp ? { comparator: cmp } : {}) })
  let approximate = false
  if (!parts) {
    // too many differences for the exact algorithm: fall back to comparing line N with line N
    approximate = true
    parts = []
    const n = Math.max(A.length, B.length)
    const same = (x, y) => (cmp ? cmp(x, y) : x === y)
    for (let k = 0; k < n; k++) {
      const eq = k < A.length && k < B.length && same(A[k], B[k])
      if (eq) parts.push({ count: 1 })
      else {
        if (k < A.length) parts.push({ count: 1, removed: true })
        if (k < B.length) parts.push({ count: 1, added: true })
      }
    }
  }
  const rows = []
  let i = 0, j = 0
  const stats = { added: 0, removed: 0, changed: 0, same: 0 }
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p]
    const n = part.count ?? 1
    if (!part.added && !part.removed) {
      for (let k = 0; k < n; k++) rows.push({ t: 'eq', l: i + k + 1, r: j + k + 1, lt: A[i + k] ?? '', rt: B[j + k] ?? '' })
      stats.same += n; i += n; j += n
    } else if (part.removed) {
      const next = parts[p + 1]
      const m2 = next && next.added ? next.count ?? 1 : 0
      const pair = Math.min(n, m2)
      for (let k = 0; k < pair; k++) rows.push({ t: 'chg', l: i + k + 1, r: j + k + 1, lt: A[i + k], rt: B[j + k] })
      for (let k = pair; k < n; k++) rows.push({ t: 'rem', l: i + k + 1, r: null, lt: A[i + k], rt: '' })
      for (let k = pair; k < m2; k++) rows.push({ t: 'add', l: null, r: j + k + 1, lt: '', rt: B[j + k] })
      stats.changed += pair; stats.removed += n - pair; stats.added += m2 - pair
      i += n; j += m2
      if (m2) p++
    } else {
      for (let k = 0; k < n; k++) rows.push({ t: 'add', l: null, r: j + k + 1, lt: '', rt: B[j + k] })
      stats.added += n; j += n
    }
  }
  stats.total = Math.max(A.length, B.length)
  stats.similarity = stats.total ? Math.round((stats.same / stats.total) * 100) : 100
  stats.identical = rows.every((r) => r.t === 'eq')
  return { rows, stats, D, approximate }
}

/** Word-level segments for a changed line: {left: [[text, marked]], right: [[text, marked]]} or null when the lines are too different to be useful. */
export function intraLine(D, a, b, o = {}) {
  if (a.length + b.length > 4000) return null
  const parts = (o.ignoreWhitespace ? D.diffWords : D.diffWordsWithSpace)(a, b, { ignoreCase: !!o.ignoreCase })
  let same = 0
  const left = [], right = []
  for (const p of parts) {
    if (p.added) right.push([p.value, true])
    else if (p.removed) left.push([p.value, true])
    else { left.push([p.value, false]); right.push([p.value, false]); same += p.value.length }
  }
  if (same < Math.max(a.length, b.length) * 0.25) return null
  return { left, right }
}
const marks = (segs, cls) => segs.map(([t, m]) => (m ? h('mark', { class: cls }, t) : t))

/** Group rows into visible runs and collapsed hunks. context: lines of unchanged text kept around changes. */
function plan(rows, context, expandAll) {
  if (expandAll) return rows.map((r) => ({ row: r }))
  const keep = new Uint8Array(rows.length)
  rows.forEach((r, i) => { if (r.t !== 'eq') for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) keep[k] = 1 })
  const out = []
  for (let i = 0; i < rows.length; i++) {
    if (keep[i]) { out.push({ row: rows[i] }); continue }
    let j = i
    while (j < rows.length && !keep[j]) j++
    if (j - i < 3) { for (let k = i; k < j; k++) out.push({ row: rows[k] }); i = j - 1; continue }
    out.push({ hunk: rows.slice(i, j) })
    i = j - 1
  }
  return out
}
const MAX_ROWS = 2500

/** Shared renderer: turns a plan into DOM with click-to-expand hunks and a cap on rendered rows. */
function view(cls, label, res, o, emit) {
  const root = h('div', { class: cls, role: 'table', 'aria-label': label })
  let shown = 0
  const hunkBtn = (text, onclick) => h('div', { class: 'hunk', role: 'button', tabindex: 0, onclick, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onclick(e) } } }, text)
  const render = (items) => {
    const frag = document.createDocumentFragment()
    for (let k = 0; k < items.length; k++) {
      const it = items[k]
      if (it.row) {
        if (shown >= MAX_ROWS) {
          const rest = items.slice(k)
          const el = hunkBtn('Large diff: click to render the rest', () => { shown = 0; el.replaceWith(render(rest)) })
          frag.append(el)
          break
        }
        shown++
        frag.append(...emit(it.row))
      } else {
        const el = hunkBtn(`${it.hunk.length} unchanged lines - click to show`, () => el.replaceWith(render(it.hunk.map((row) => ({ row })))))
        frag.append(el)
      }
    }
    return frag
  }
  root.append(render(plan(res.rows, o.context ?? 3, o.expandAll)))
  return root
}

/** Side-by-side view. o: {context, expandAll, ignoreCase, ignoreWhitespace}. Returns an element (.df-sbs). */
export function sideBySide(res, o = {}) {
  const num = (n) => h('div', { class: 'ln', 'aria-hidden': 'true' }, n ?? '')
  return view('df-sbs', 'Side by side comparison', res, o, (r) => {
    let L = r.lt, R = r.rt
    if (r.t === 'chg') {
      const seg = intraLine(res.D, r.lt, r.rt, o)
      if (seg) { L = marks(seg.left, 'r'); R = marks(seg.right, 'a') }
    }
    const cls = { eq: ['', ''], chg: ['chg', 'chg'], rem: ['rem', 'nil'], add: ['nil', 'add'] }[r.t]
    return [num(r.l), h('div', { class: cls[0] }, L), num(r.r), h('div', { class: cls[1] }, R)]
  })
}

/** Unified view with line numbers on both sides. */
export function unified(res, o = {}) {
  const line = (cls, l, r, sign, text) => h('div', { class: cls }, h('span', { class: 'ln', 'aria-hidden': 'true' }, l ?? ''), h('span', { class: 'ln', 'aria-hidden': 'true' }, r ?? ''), h('span', { class: 'sg', 'aria-hidden': 'true' }, sign), h('span', { class: 'tx' }, text))
  return view('df-uni', 'Unified comparison', res, o, (r) => {
    if (r.t === 'eq') return [line('', r.l, r.r, ' ', r.lt)]
    if (r.t === 'rem') return [line('rem', r.l, '', '-', r.lt)]
    if (r.t === 'add') return [line('add', '', r.r, '+', r.rt)]
    const seg = intraLine(res.D, r.lt, r.rt, o)
    return [line('rem', r.l, '', '-', seg ? marks(seg.left, 'r') : r.lt), line('add', '', r.r, '+', seg ? marks(seg.right, 'a') : r.rt)]
  })
}

/** Inline view for word and character diffs. parts: jsdiff change objects. */
export function inlineDiff(parts) {
  return h('div', { class: 'df-inline', role: 'region', 'aria-label': 'Inline comparison', tabindex: 0 },
    parts.map((p) => (p.added ? h('mark', { class: 'a' }, p.value) : p.removed ? h('mark', { class: 'r' }, p.value) : p.value)))
}

/** A unified patch (the text `git diff` or `patch` understands). */
export function makePatch(D, a, b, nameA = 'a.txt', nameB = 'b.txt', o = {}) {
  return D.createTwoFilesPatch(nameA, nameB, a, b, '', '', { context: o.context ?? 3, stripTrailingCr: true, ...(lineComparator(o) ? { comparator: lineComparator(o) } : {}) })
}
