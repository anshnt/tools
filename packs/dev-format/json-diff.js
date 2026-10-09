// JSON diff: compare two JSON documents by structure, ignoring key order. Lists every added, removed and changed path, and shows
// both documents side by side (keys sorted so equal data lines up). Arrays can be compared by position, as unordered sets, or matched by an id key.
import { editor, samples, seg, toggle, button, aurora, h, icon, chip, statTiles, focusOnDesktop, injectStyles, copyBtn, spacer, errorCard, DevError } from './_shared.js'
import { parseJson, printJson, canon, normNumber } from './_json.js'
import { diffLineRows, sideBySide } from './_diffview.js'
import { ORDER_JSON, ORDER_JSON_B } from './_samples.js'
import { input, debounce, formatNumber } from '../../lib/ui.js'

const PATH_KEY = /^[A-Za-z_$][\w$]*$/
/** Human path: $.items[2].name, $.items[id=7].qty */
export function fmtPath(parts) {
  let p = '$'
  for (const k of parts) {
    if (typeof k === 'number') p += `[${k}]`
    else if (typeof k === 'object') p += `[${k.k}=${k.v}]`
    else p += PATH_KEY.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`
  }
  return p
}
const leafEq = (a, b) => a.t === b.t && (a.t === 'z' || (a.t === 's' ? a.v === b.v : a.t === 'n' ? normNumber(a.r) === normNumber(b.r) : a.r === b.r))
const isCont = (x) => x.t === 'o' || x.t === 'a'

/**
 * Structural differences between two nodes (see parseJson).
 * o: {arrays: 'index' | 'unordered' | 'key', key: 'id', ignore: ['updatedAt', ...]}
 * Returns [{kind: 'added' | 'removed' | 'changed' | 'type', path: [...parts], a?: node, b?: node}]
 */
export function diffJson(a, b, o = {}) {
  const { arrays = 'index', key = 'id' } = o
  const ignore = new Set(o.ignore || [])
  const out = []
  const eqFast = (x, y) => !ignore.size && canon(x) === canon(y)
  const keyOf = (item) => {
    if (item.t !== 'o') return null
    const i = item.k.indexOf(key)
    return i === -1 ? null : canon(item.v[i])
  }
  const go = (x, y, path) => {
    if (x.t !== y.t) { out.push({ kind: 'type', path, a: x, b: y }); return }
    if (!isCont(x)) { if (!leafEq(x, y)) out.push({ kind: 'changed', path, a: x, b: y }); return }
    if (eqFast(x, y)) return
    if (x.t === 'o') {
      const seen = new Set()
      x.k.forEach((k, i) => {
        if (ignore.has(k) || seen.has(k)) return
        seen.add(k)
        const j = y.k.lastIndexOf(k)
        const xv = x.v[x.k.lastIndexOf(k)]
        if (j === -1) out.push({ kind: 'removed', path: [...path, k], a: xv })
        else go(xv, y.v[j], [...path, k])
      })
      const done = new Set()
      y.k.forEach((k, j) => { if (!ignore.has(k) && !seen.has(k) && !done.has(k)) { done.add(k); out.push({ kind: 'added', path: [...path, k], b: y.v[y.k.lastIndexOf(k)] }) } })
      return
    }
    // arrays
    const byIndex = () => {
      const n = Math.max(x.i.length, y.i.length)
      for (let i = 0; i < n; i++) {
        if (i >= y.i.length) out.push({ kind: 'removed', path: [...path, i], a: x.i[i] })
        else if (i >= x.i.length) out.push({ kind: 'added', path: [...path, i], b: y.i[i] })
        else go(x.i[i], y.i[i], [...path, i])
      }
    }
    // a list that has no objects with the key (a list of strings, say) is compared by position
    if (arrays === 'index' || (arrays === 'key' && !x.i.some((it) => keyOf(it) != null) && !y.i.some((it) => keyOf(it) != null))) {
      byIndex()
    } else if (arrays === 'key') {
      const pool = new Map()
      y.i.forEach((it, j) => { const k = keyOf(it); if (k != null) { if (!pool.has(k)) pool.set(k, []); pool.get(k).push(j) } })
      const used = new Set()
      x.i.forEach((it, i) => {
        const k = keyOf(it)
        const list = k != null ? pool.get(k) : null
        if (list && list.length) {
          const j = list.shift(); used.add(j)
          go(it, y.i[j], [...path, { k: key, v: k.replace(/^"|"$/g, '') }])
        } else out.push({ kind: 'removed', path: [...path, k != null ? { k: key, v: k.replace(/^"|"$/g, '') } : i], a: it })
      })
      y.i.forEach((it, j) => { if (!used.has(j)) { const k = keyOf(it); out.push({ kind: 'added', path: [...path, k != null ? { k: key, v: k.replace(/^"|"$/g, '') } : j], b: it }) } })
    } else {
      // unordered: match equal items, report the rest
      const pool = new Map()
      y.i.forEach((it, j) => { const c = canon(it, true); if (!pool.has(c)) pool.set(c, []); pool.get(c).push(j) })
      const used = new Set()
      x.i.forEach((it, i) => {
        const list = pool.get(canon(it, true))
        if (list && list.length) used.add(list.shift())
        else out.push({ kind: 'removed', path: [...path, i], a: it })
      })
      y.i.forEach((it, j) => { if (!used.has(j)) out.push({ kind: 'added', path: [...path, j], b: it }) })
    }
  }
  go(a, b, [])
  return out
}

/** Copy of a node with keys sorted (and arrays sorted when asked), minus ignored keys: used for the side-by-side text. */
export function normalizeNode(x, o = {}) {
  const ignore = new Set(o.ignore || [])
  const go = (n) => {
    if (n.t === 'o') {
      const idx = n.k.map((_, i) => i).filter((i) => !ignore.has(n.k[i])).sort((p, q) => (n.k[p] < n.k[q] ? -1 : n.k[p] > n.k[q] ? 1 : p - q))
      return { t: 'o', k: idx.map((i) => n.k[i]), r: idx.map((i) => n.r[i]), v: idx.map((i) => go(n.v[i])) }
    }
    if (n.t === 'a') {
      let items = n.i.map(go)
      if (o.arrays === 'unordered') items = items.map((it) => [canon(it, true), it]).sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0)).map((p) => p[1])
      else if (o.arrays === 'key') {
        const kv = (it) => { if (it.t !== 'o') return ''; const i = it.k.indexOf(o.key || 'id'); return i === -1 ? '' : canon(it.v[i]) }
        items = items.map((it) => [kv(it), it]).sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0)).map((p) => p[1])
      }
      return { t: 'a', i: items }
    }
    return n
  }
  return go(x)
}

const short = (node) => { const s = printJson(node, { indent: '' }); return s.length > 160 ? `${s.slice(0, 157)}...` : s }
const KIND = { added: ['add', 'Added'], removed: ['rem', 'Removed'], changed: ['chg', 'Changed'], type: ['chg', 'Type'] }
const TYPE_NAME = { o: 'object', a: 'array', s: 'string', n: 'number', b: 'boolean', z: 'null' }

const USERS_A = `{"users":[{"id":1,"name":"Asha","role":"admin","tags":["a","b"],"updatedAt":"2025-01-01"},{"id":2,"name":"Liam","role":"viewer","tags":[],"updatedAt":"2025-01-02"},{"id":3,"name":"Mei","role":"editor","tags":["x"],"updatedAt":"2025-01-03"}]}`
const USERS_B = `{"users":[{"id":3,"name":"Mei","role":"admin","tags":["x"],"updatedAt":"2025-02-10"},{"id":1,"name":"Asha","role":"admin","tags":["b","a"],"updatedAt":"2025-02-11"},{"id":4,"name":"Omar","role":"viewer","tags":[],"updatedAt":"2025-02-12"}]}`

export function mount(root) {
  injectStyles()
  const state = { arrays: 'index', key: 'id', ignore: '', view: 'changes' }
  let seq = 0
  const resultHost = h('div'), statHost = h('div'), errHost = h('div')
  const schedule = debounce(() => compute(), 220)
  const onInput = () => { sampleRow.hidden = !!(left.value || right.value); schedule() }
  const left = editor({ title: 'Original JSON', ic: 'braces', placeholder: 'Paste the original JSON...', accept: '.json,application/json,text/plain', onInput, onRun: () => compute(), actions: ['upload', 'paste', 'clear'], indent: () => '  ', autoIndent: true })
  const right = editor({ title: 'Changed JSON', ic: 'braces', placeholder: 'Paste the changed JSON...', accept: '.json,application/json,text/plain', onInput, onRun: () => compute(), actions: ['upload', 'paste', 'clear'], indent: () => '  ', autoIndent: true })
  for (const e of [left, right]) e.el.style.setProperty('--df-h', 'clamp(200px, 32vh, 340px)')

  const keyInput = input({ value: 'id', 'aria-label': 'Key that identifies an array item', placeholder: 'id', oninput: (e) => { state.key = e.target.value.trim() || 'id'; schedule() } })
  const keyOpt = h('div', { class: 'df-opt', hidden: true }, h('span', { class: 'df-ol' }, 'Match on'), keyInput)
  const arraySeg = seg([['index', 'By position'], ['unordered', 'Ignore order'], ['key', 'Match by key']], 'index', (v) => { state.arrays = v; keyOpt.hidden = v !== 'key'; compute() }, 'How to compare arrays')
  const ignoreInput = input({ placeholder: 'e.g. updatedAt, id', 'aria-label': 'Keys to ignore', style: 'width:170px', oninput: (e) => { state.ignore = e.target.value; schedule() } })
  const swap = button('Swap', { icon: 'arrow-left-right', size: 'sm', ariaLabel: 'Swap the two sides', title: 'Swap the two sides', onClick: () => { const a = left.value; left.set(right.value); right.set(a); compute() } })
  const bar = h('div', { class: ['df-bar', 'df-sticky'] }, h('div', { class: 'df-opt' }, h('span', { class: 'df-ol' }, 'Arrays'), arraySeg), keyOpt, h('div', { class: 'df-opt' }, h('span', { class: 'df-ol' }, 'Ignore keys'), ignoreInput), spacer(), swap)
  const sampleRow = samples([
    { label: 'Order changes', icon: 'shopping-cart', a: ORDER_JSON, b: ORDER_JSON_B }, { label: 'Users by id', icon: 'users', a: USERS_A, b: USERS_B, arrays: 'key', ignore: 'updatedAt' },
  ], (smp) => {
    left.set(smp.a); right.set(smp.b); sampleRow.hidden = true
    state.arrays = smp.arrays || 'index'; arraySeg.set(state.arrays); keyOpt.hidden = state.arrays !== 'key'
    state.ignore = smp.ignore || ''; ignoreInput.value = state.ignore
    compute()
  })

  function fail(side, ed, e) {
    ed.mark(e.line)
    errHost.replaceChildren(errorCard(ed, e, { prefix: `${side} JSON: ` }))
    resultHost.replaceChildren(); statHost.replaceChildren()
  }

  async function compute() {
    const my = ++seq
    errHost.replaceChildren(); left.clearMark(); right.clearMark()
    const A = left.value, B = right.value
    if (!A.trim() && !B.trim()) { resultHost.replaceChildren(); statHost.replaceChildren(); return }
    if (!A.trim() || !B.trim()) { resultHost.replaceChildren(h('div', { class: 'alert info' }, icon('info'), h('div', `Add JSON to the ${A.trim() ? 'right' : 'left'} side too, and the differences appear here.`))); statHost.replaceChildren(); return }
    let a, b
    try { a = parseJson(A) } catch (e) { if (e instanceof DevError) return fail('Original', left, e); throw e }
    try { b = parseJson(B) } catch (e) { if (e instanceof DevError) return fail('Changed', right, e); throw e }
    const opts = { arrays: state.arrays, key: state.key, ignore: state.ignore.split(',').map((s) => s.trim()).filter(Boolean) }
    const changes = diffJson(a, b, opts)
    const counts = { added: 0, removed: 0, changed: 0 }
    for (const c of changes) counts[c.kind === 'type' ? 'changed' : c.kind]++
    statHost.replaceChildren(statTiles([{ label: 'Differences', value: changes.length, accent: true }, { label: 'Added', value: counts.added }, { label: 'Removed', value: counts.removed }, { label: 'Changed', value: counts.changed }]))
    if (!changes.length) {
      resultHost.replaceChildren(h('div', { class: 'df-verdict ok' }, h('div', { class: 'df-vi' }, icon('check')), h('div', h('h3', 'The JSON is identical'), h('p', `Same data${opts.ignore.length ? ` (ignoring ${opts.ignore.join(', ')})` : ''}. Key order${state.arrays === 'index' ? '' : ' and array order'} does not matter.`))))
      return
    }
    const list = h('div', { class: 'df-chg-list', role: 'list', 'aria-label': 'Differences' }, changes.slice(0, 1500).map((c, i) => {
      const [cls, label] = KIND[c.kind]
      const before = c.a ? short(c.a) : null, after = c.b ? short(c.b) : null
      const typeNote = c.kind === 'type' ? ` (${TYPE_NAME[c.a.t]} to ${TYPE_NAME[c.b.t]})` : ''
      return h('div', { class: 'df-chg-row', role: 'listitem', style: { animationDelay: `${Math.min(i, 12) * 25}ms` } },
        h('span', { class: ['df-tag', cls] }, label), h('span', { class: 'path' }, fmtPath(c.path), typeNote),
        h('span', { class: ['val', before == null ? 'none' : 'rem'] }, before ?? '-'), h('span', { class: ['val', after == null ? 'none' : 'add'] }, after ?? '-'))
    }))
    const more = changes.length > 1500 ? h('div', { class: 'small muted', style: 'padding:10px 14px' }, `Showing the first 1,500 of ${formatNumber(changes.length, 0)} differences. The side by side view shows everything.`) : null
    const report = () => changes.map((c) => `${KIND[c.kind][1].toUpperCase()} ${fmtPath(c.path)}${c.a ? ` ${short(c.a)}` : ''}${c.a && c.b ? ' ->' : ''}${c.b ? ` ${short(c.b)}` : ''}`).join('\n')
    const sbsHost = h('div', { class: 'df-sbs-wrap', hidden: true })
    let sbsDone = false
    async function buildSbs() {
      if (sbsDone) return
      sbsDone = true
      const na = normalizeNode(a, opts), nb = normalizeNode(b, opts)
      const res = await diffLineRows(printJson(na, { indent: '  ' }), printJson(nb, { indent: '  ' }), {})
      if (my === seq) sbsHost.replaceChildren(sideBySide(res, { context: 3, ignoreWhitespace: false }))
    }
    const body = h('div', null, h('div', { class: 'df-chg-wrap' }, list, more), sbsHost)
    const views = seg([['changes', 'Changes list'], ['sbs', 'Side by side']], state.view, (v) => { state.view = v; show() }, 'Result view')
    const show = () => { body.firstChild.hidden = state.view !== 'changes'; sbsHost.hidden = state.view !== 'sbs'; if (state.view === 'sbs') buildSbs() }
    resultHost.replaceChildren(h('section', { class: 'df-frame', 'aria-label': 'Differences' },
      h('div', { class: 'df-head' }, h('div', { class: 'df-title' }, icon('git-compare'), h('span', 'Differences'), chip('warn', `${formatNumber(changes.length, 0)} found`)), h('div', { class: 'df-actions' }, views, copyBtn(report, 'Copy list', { ariaLabel: 'Copy the list of differences' }))), body))
    show()
  }

  root.append(h('div', { class: 't-df' }, aurora(), bar, sampleRow, h('div', { class: 'df-grid' }, left.el, right.el), errHost, statHost, resultHost))
  focusOnDesktop(left)
}
