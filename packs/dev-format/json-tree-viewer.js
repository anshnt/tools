// JSON tree viewer: explore JSON as a collapsible tree. Rows are created lazily (a node's children only exist once it is opened,
// and long lists show 100 at a time), so documents with hundreds of thousands of nodes stay fast. Search keys and values,
// copy a node's path or value, and expand to a chosen depth.
import { editor, samples, seg, select, h, icon, button, chip, aurora, focusOnDesktop, injectStyles, errorCard, DevError } from './_shared.js'
import { parseJson, repairJson, printJson, TYPE_NAME } from './_json.js'
import { USERS_JSON, PACKAGE_JSON, EVENTS_JSON } from './_samples.js'
import { input, debounce, formatNumber, formatBytes, copyText, toast, yieldToMain, clear } from '../../lib/ui.js'

const PAGE = 100
const IDENT = /^[A-Za-z_$][\w$]*$/
const isCont = (n) => n.t === 'o' || n.t === 'a'
const countOf = (n) => (n.t === 'o' ? n.v.length : n.t === 'a' ? n.i.length : 0)
const childOf = (n, i) => (n.t === 'o' ? [n.k[i], n.v[i]] : [i, n.i[i]])

/** Path text for a list of keys and indexes. style: 'jsonpath' ($.a[0]) | 'js' (data.a[0]) | 'jq' (.a[0]). */
export function fmtPath(parts, style = 'jsonpath') {
  let p = style === 'js' ? 'data' : style === 'jq' ? '' : '$'
  for (const k of parts) {
    if (typeof k === 'number') p += `[${k}]`
    else if (IDENT.test(k)) p += `.${k}`
    else p += style === 'jq' && !p ? `.[${JSON.stringify(k)}]` : `[${JSON.stringify(k)}]`
  }
  return p || '.'
}
/** Number of nodes in a tree. */
export function countNodes(n) { let c = 1; if (n.t === 'o') for (const v of n.v) c += countNodes(v); else if (n.t === 'a') for (const v of n.i) c += countNodes(v); return c }
const valueText = (n) => (n.t === 's' ? n.v : n.t === 'z' ? 'null' : n.t === 'n' || n.t === 'b' ? n.r : printJson(n, { indent: '  ' }))

/**
 * Search a tree. Returns {hits: [{idxs, parts, key, node, byKey}], capped}. mode: 'all' | 'keys' | 'values'.
 * idxs is the child-index route from the root (used to reveal the node).
 */
export function searchTree(root, query, mode = 'all', limit = 500) {
  const q = query.toLowerCase()
  const hits = []
  let capped = false
  const go = (node, idxs, parts, key) => {
    if (capped) return
    if (key != null && typeof key === 'string' && mode !== 'values' && key.toLowerCase().includes(q)) {
      if (hits.length >= limit) { capped = true; return }
      hits.push({ idxs, parts, key, node, byKey: true })
    } else if (!isCont(node) && mode !== 'keys') {
      const t = node.t === 's' ? node.v : node.t === 'z' ? 'null' : node.r
      if (t.toLowerCase().includes(q)) {
        if (hits.length >= limit) { capped = true; return }
        hits.push({ idxs, parts, key, node, byKey: false })
      }
    }
    const n = countOf(node)
    for (let i = 0; i < n; i++) {
      const [k, v] = childOf(node, i)
      go(v, [...idxs, i], [...parts, k], k)
    }
  }
  go(root, [], [], null)
  return { hits, capped }
}

export function mount(root) {
  injectStyles()
  const state = { style: 'jsonpath', mode: 'all', query: '' }
  let tree = null, rootCtl = null, selected = null, seq = 0
  const rowCtl = new WeakMap()
  const errHost = h('div')

  // ---------- tree building ----------
  function keyEl(key, parent) {
    if (parent == null) return [h('span', { class: 'tk-p' }, 'root'), ' ']
    if (typeof key === 'number') return [h('span', { class: 'tk-p' }, key), h('span', { class: 'tk-p' }, ': ')]
    return [h('span', { class: 'tk-k' }, JSON.stringify(key)), h('span', { class: 'tk-p' }, ': ')]
  }
  function valueEl(node) {
    switch (node.t) {
      case 's': { const long = node.v.length > 240; return h('span', { class: 'tk-s', title: long ? 'Select the row to see the whole value' : null }, JSON.stringify(long ? `${node.v.slice(0, 240)}...` : node.v)) }
      case 'n': return h('span', { class: 'tk-n' }, node.r)
      case 'b': return h('span', { class: 'tk-b' }, node.r)
      case 'z': return h('span', { class: 'tk-nl' }, 'null')
      default: {
        const o = node.t === 'o'
        const n = countOf(node)
        const names = o ? node.k.slice(0, 4).join(', ') + (n > 4 ? ', ...' : '') : ''
        return [h('span', { class: 'tk-p' }, o ? '{}' : '[]'), h('span', { class: 'df-sum' }, o ? (n ? `${formatNumber(n, 0)} key${n === 1 ? '' : 's'}: ${names}` : 'empty') : n ? `${formatNumber(n, 0)} item${n === 1 ? '' : 's'}` : 'empty')]
      }
    }
  }
  function isHit(ctl) {
    const q = state.query.toLowerCase()
    if (!q || ctl.parent == null) return false
    if (typeof ctl.key === 'string' && state.mode !== 'values' && ctl.key.toLowerCase().includes(q)) return true
    if (!isCont(ctl.node) && state.mode !== 'keys') return (ctl.node.t === 's' ? ctl.node.v : ctl.node.t === 'z' ? 'null' : ctl.node.r).toLowerCase().includes(q)
    return false
  }
  function makeItem(node, key, parts, parent) {
    const cont = isCont(node)
    const ctl = { node, key, parts, parent, depth: parent ? parent.depth + 1 : 0, children: [], shown: 0, open: false, built: false }
    const acts = h('span', { class: 'df-rowact' },
      h('button', { type: 'button', title: 'Copy the path to this value', 'aria-label': 'Copy path', onclick: (e) => { e.stopPropagation(); copyText(fmtPath(parts, state.style)) } }, 'Path'),
      h('button', { type: 'button', title: 'Copy this value', 'aria-label': 'Copy value', onclick: (e) => { e.stopPropagation(); copyText(valueText(node)) } }, 'Value'))
    ctl.row = h('div', {
      class: ['df-r', isHit(ctl) && 'hit'], role: 'treeitem', tabindex: -1, 'aria-level': ctl.depth + 1, 'aria-selected': 'false', 'aria-expanded': cont ? 'false' : null,
      onclick: (e) => { selectRow(ctl); if (cont && !e.target.closest('.df-rowact')) setOpen(ctl, !ctl.open, true) },
    }, cont ? icon('chevron-right', 'df-chev') : h('span', { class: 'df-leaf' }), h('span', { class: 'df-kv' }, keyEl(key, parent), valueEl(node)), acts)
    rowCtl.set(ctl.row, ctl)
    ctl.li = h('li', { class: 'df-n', role: 'none' }, ctl.row)
    return ctl
  }
  function more(ctl, upTo) {
    const total = countOf(ctl.node)
    const to = Math.min(total, Math.max(upTo ?? 0, ctl.shown + (upTo ? 0 : PAGE)))
    for (let i = ctl.shown; i < to; i++) {
      const [k, v] = childOf(ctl.node, i)
      const c = makeItem(v, k, [...ctl.parts, k], ctl)
      ctl.children[i] = c
      ctl.ul.insertBefore(c.li, ctl.moreEl || null)
    }
    ctl.shown = to
    if (ctl.moreEl) { ctl.moreEl.remove(); ctl.moreEl = null }
    if (to < total) {
      const left = total - to
      ctl.moreEl = h('li', { class: 'df-more', role: 'none' }, button(`Show ${formatNumber(Math.min(PAGE, left), 0)} more (${formatNumber(left, 0)} left)`, { size: 'sm', icon: 'chevrons-down', onClick: () => more(ctl) }),
        button('Show all', { size: 'sm', variant: 'ghost', onClick: () => { more(ctl, left > 5000 ? to + 5000 : total) } }))
      ctl.ul.append(ctl.moreEl)
    }
  }
  function build(ctl) {
    if (ctl.built) return
    ctl.built = true
    ctl.ul = h('ul', { role: 'group' })
    ctl.kids = h('div', { class: 'df-kids' }, ctl.ul)
    ctl.li.append(ctl.kids)
    more(ctl)
  }
  function setOpen(ctl, on, animate) {
    if (!isCont(ctl.node) || ctl.open === on) return
    if (on) { build(ctl); if (animate) void ctl.kids.offsetHeight }
    ctl.open = on
    ctl.li.classList.toggle('df-open', on)
    ctl.row.setAttribute('aria-expanded', String(on))
  }
  function selectRow(ctl) {
    if (selected) { selected.row.classList.remove('sel'); selected.row.setAttribute('aria-selected', 'false'); selected.row.tabIndex = -1 }
    selected = ctl
    ctl.row.classList.add('sel'); ctl.row.setAttribute('aria-selected', 'true'); ctl.row.tabIndex = 0
    showDetail()
  }

  // ---------- detail strip ----------
  const detail = h('div', { class: 'df-detail', 'aria-live': 'polite' })
  function showDetail() {
    const c = selected
    if (!c) { clear(detail, h('span', { class: 'muted' }, 'Select a row to see its path and copy it.')); return }
    const n = c.node
    const what = isCont(n) ? `${TYPE_NAME[n.t]} with ${formatNumber(countOf(n), 0)} ${n.t === 'o' ? 'key' : 'item'}${countOf(n) === 1 ? '' : 's'}` : n.t === 's' ? `string, ${formatNumber([...n.v].length, 0)} characters` : TYPE_NAME[n.t]
    clear(detail,
      h('code', { title: 'Path to this value' }, fmtPath(c.parts, state.style)), h('span', { class: 'muted small' }, what),
      h('span', { style: 'margin-left:auto;display:flex;gap:6px' },
        button('Copy path', { size: 'sm', icon: 'copy', onClick: () => copyText(fmtPath(c.parts, state.style)) }),
        button('Copy value', { size: 'sm', icon: 'clipboard', onClick: () => copyText(valueText(n)) })),
      !isCont(n) && n.t === 's' && n.v.length > 120 ? h('div', { style: 'flex-basis:100%;color:var(--text-2);white-space:pre-wrap;overflow-wrap:anywhere;max-height:130px;overflow:auto' }, n.v.length > 4000 ? `${n.v.slice(0, 4000)}...` : n.v) : null)
  }

  // ---------- visible rows and keyboard ----------
  function visible() {
    const out = []
    const go = (c) => { out.push(c); if (c.open) for (const k of c.children) if (k) go(k) }
    if (rootCtl) go(rootCtl)
    return out
  }
  function onKey(e) {
    const c = rowCtl.get(e.target.closest?.('.df-r'))
    if (!c) return
    const list = visible()
    const i = list.indexOf(c)
    const go = (t) => { if (t) { selectRow(t); t.row.focus(); t.row.scrollIntoView({ block: 'nearest' }) } }
    const k = e.key
    if (k === 'ArrowDown') go(list[i + 1])
    else if (k === 'ArrowUp') go(list[i - 1])
    else if (k === 'Home') go(list[0])
    else if (k === 'End') go(list[list.length - 1])
    else if (k === 'ArrowRight') { if (isCont(c.node) && !c.open) setOpen(c, true, true); else go(c.children[0]) }
    else if (k === 'ArrowLeft') { if (c.open) setOpen(c, false, true); else go(c.parent) }
    else if (k === 'Enter' || k === ' ') { if (isCont(c.node)) setOpen(c, !c.open, true) } else return
    e.preventDefault()
  }

  // ---------- expand to depth ----------
  async function expandTo(depth) {
    if (!rootCtl) return
    treeEl.classList.add('df-noanim')
    let budget = 4000, stopped = false
    const walk = (c) => {
      if (!isCont(c.node)) return
      if (c.depth < depth) {
        if (budget <= 0) { stopped = true; return }
        setOpen(c, true, false)
        budget -= c.children.length
        for (const k of c.children) if (k) walk(k)
      } else { setOpen(c, false, false); for (const k of c.children) if (k) walk(k) }
    }
    walk(rootCtl)
    if (stopped) toast('Expanded as far as fits on screen. Open the rest by clicking, or use search.', 'info')
    requestAnimationFrame(() => treeEl.classList.remove('df-noanim'))
    if (selected) selected.row.scrollIntoView({ block: 'nearest' })
  }
  function reveal(idxs) {
    treeEl.classList.add('df-noanim')
    let c = rootCtl
    for (const i of idxs) {
      setOpen(c, true, false)
      if (i >= c.shown) more(c, i + 1)
      c = c.children[i]
    }
    selectRow(c)
    c.row.scrollIntoView({ block: 'center' })
    c.row.focus({ preventScroll: true })
    requestAnimationFrame(() => treeEl.classList.remove('df-noanim'))
  }

  // ---------- search ----------
  const resultsEl = h('div', { class: 'df-results', hidden: true, role: 'list', 'aria-label': 'Search results' })
  const countEl = h('span', { class: 'muted small', 'aria-live': 'polite' })
  function runSearch() {
    state.query = searchEl.value.trim()
    for (const row of treeEl.querySelectorAll('.df-r')) { const c = rowCtl.get(row); row.classList.toggle('hit', !!c && isHit(c)) }
    if (!tree || !state.query) { resultsEl.hidden = true; resultsEl.replaceChildren(); countEl.textContent = ''; return }
    const { hits, capped } = searchTree(tree, state.query, state.mode)
    countEl.textContent = hits.length ? `${capped ? `${hits.length}+` : formatNumber(hits.length, 0)} match${hits.length === 1 ? '' : 'es'}` : 'No matches'
    resultsEl.hidden = !hits.length
    resultsEl.replaceChildren(...hits.map((x) => h('button', { type: 'button', role: 'listitem', onclick: () => reveal(x.idxs) },
      h('span', { class: 'p' }, fmtPath(x.parts, state.style)), h('span', { class: 'v' }, isCont(x.node) ? (x.node.t === 'o' ? '{...}' : '[...]') : valueText(x.node).slice(0, 120)))))
  }
  const searchEl = input({ type: 'search', placeholder: 'Search keys and values...', 'aria-label': 'Search keys and values', oninput: debounce(runSearch, 160), onkeydown: (e) => { if (e.key === 'Enter' && resultsEl.firstChild) { e.preventDefault(); resultsEl.firstChild.click() } } })

  // ---------- load ----------
  const treeEl = h('div', { class: 'df-tree', role: 'tree', 'aria-label': 'JSON tree', tabindex: -1, onkeydown: onKey })
  const chipHost = h('span')
  const emptyEl = () => h('div', { class: 'empty' }, icon('list-tree'), h('div', 'Paste JSON on the left and explore it here'))
  treeEl.append(emptyEl())

  async function load(text) {
    const my = ++seq
    errHost.replaceChildren(); ed.clearMark()
    if (!text.trim()) { tree = rootCtl = selected = null; treeEl.replaceChildren(emptyEl()); chipHost.replaceChildren(); showDetail(); runSearch(); return }
    if (text.length > 1_000_000) { chipHost.replaceChildren(chip('warn', 'Parsing...')); await yieldToMain() }
    if (my !== seq) return
    let node
    try { node = parseJson(text) } catch (e) {
      if (!(e instanceof DevError)) throw e
      tree = rootCtl = selected = null
      treeEl.replaceChildren(emptyEl()); chipHost.replaceChildren(chip('err', 'Error')); showDetail()
      ed.mark(e.line)
      errHost.replaceChildren(errorCard(ed, e, { actions: e.repairable ? [{ label: 'Repair and open', icon: 'wrench', primary: true, onClick: async () => {
        try { const fixed = printJson(parseJson(await repairJson(text)), { indent: '  ' }); ed.set(fixed, { emit: false }); sampleRow.hidden = true; load(fixed); toast('Repaired. Check the result before you rely on it.', 'success') } catch { toast('That JSON could not be repaired automatically.', 'error') }
      } }] : [] }))
      return
    }
    tree = node
    rootCtl = makeItem(node, null, [], null)
    treeEl.replaceChildren(h('ul', { role: 'none', class: 'df-n' }, rootCtl.li))
    rootCtl.row.tabIndex = 0
    selected = null
    const total = countNodes(node)
    chipHost.replaceChildren(chip('ok', `${formatNumber(total, 0)} nodes`))
    selectRow(rootCtl)
    const lvl = total < 150 ? 3 : total < 1500 ? 2 : 1 // small documents open further so there is something to see
    expandSeg.set(String(lvl))
    expandTo(lvl)
    sizeEl.textContent = `${formatBytes(new Blob([text]).size)} · ${formatNumber(total, 0)} nodes · ${formatNumber(depthOf(node), 0)} levels deep`
    runSearch()
  }
  const depthOf = (n) => { let d = 1; const go = (x, k) => { if (k > d) d = k; if (x.t === 'o') for (const v of x.v) go(v, k + 1); else if (x.t === 'a') for (const v of x.i) go(v, k + 1) }; go(n, 1); return d }

  const ed = editor({ title: 'JSON', ic: 'braces', placeholder: 'Paste JSON here, drop a .json file, or pick an example below...', accept: '.json,.geojson,.har,.jsonc,application/json,text/plain', maxBytes: 30_000_000,
    onInput: (v) => { sampleRow.hidden = !!v; schedule() }, onRun: () => load(ed.value), actions: ['upload', 'paste', 'clear'], autoIndent: true })
  const schedule = debounce(() => load(ed.value), 250)
  const sizeEl = h('b', '')
  const sampleRow = samples([{ label: 'API response', icon: 'server', text: USERS_JSON }, { label: 'package.json', icon: 'package', text: PACKAGE_JSON }, { label: 'Event log', icon: 'activity', text: EVENTS_JSON }],
    (smp) => { ed.set(smp.text, { emit: false }); sampleRow.hidden = true; load(smp.text) })

  const expandSeg = seg([['0', 'Collapse'], ['1', '1'], ['2', '2'], ['3', '3'], ['all', 'All']], '1', (v) => expandTo(v === 'all' ? Infinity : +v), 'Expand to level')
  const bar = h('div', { class: ['df-bar', 'df-sticky'] },
    h('div', { class: 'df-search' }, icon('search'), searchEl, countEl),
    h('div', { class: 'df-opt' }, h('span', { class: 'df-ol' }, 'Match'), seg([['all', 'Both'], ['keys', 'Keys'], ['values', 'Values']], 'all', (v) => { state.mode = v; runSearch() }, 'What to search')),
    h('div', { class: 'df-opt' }, h('span', { class: 'df-ol' }, 'Levels'), expandSeg),
    h('div', { class: 'df-opt' }, select([['jsonpath', 'Path: JSONPath'], ['js', 'Path: JavaScript'], ['jq', 'Path: jq']], 'jsonpath', (v) => { state.style = v; showDetail(); runSearch() })))

  const treeFrame = h('section', { class: 'df-frame', 'aria-label': 'Tree view' },
    h('div', { class: 'df-head' }, h('div', { class: 'df-title' }, icon('list-tree'), h('span', 'Tree'), chipHost)), treeEl, resultsEl, detail, h('div', { class: 'df-foot' }, sizeEl))
  showDetail()
  root.append(h('div', { class: 't-df' }, aurora(), bar, sampleRow, errHost, h('div', { class: 'df-grid', style: 'align-items:start' }, ed.el, treeFrame)))
  focusOnDesktop(ed)
}
