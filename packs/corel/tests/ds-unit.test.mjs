// Node tests for the DOM-free Draw Studio modules.   node packs/corel/tests/ds-unit.test.mjs [samples dir with manifest.json]
// Covers: _tree, _ds-doc (validateDoc fuzz, immutable helpers), _ds-store (undo fuzz against a deep-clone oracle), _ds-units, _ds-colors,
// _ds-keys (command table), _ds-text-model, _ds-path, _ds-hit, _ds-open (sniff, font merge, CDR to tree), import specifiers,
// (E3 to E5) _ds-ops, _ds-gesture, _ds-sel and the new commands, (E6 to E8) page operations, text properties,
// autosave (_ds-persist with a fake key-value store) and _ds-save (toWriterDoc, cropPage, formats), and (E9 to E10) the node
// primitives and parametric shapes of _ds-path, _ds-ops-arrange (align, distribute, combine, break apart, lock, clip), _ds-xform and the key table.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const corel = join(here, '..')
const imp = (f) => import(new URL(`../${f}`, import.meta.url).href)

let n = 0
const t = async (name, fn) => { try { await fn(); n++ } catch (e) { console.error(`FAIL ${name}`); throw e } }
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o) && !(o instanceof Uint8Array)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]) } return o }
const clone = (o) => JSON.parse(JSON.stringify(o))
// deterministic random numbers so a failure can be replayed
let seed = 12345
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
const pick = (a) => a[Math.floor(rnd() * a.length)]

const tree = await imp('_tree.js')
const D = await imp('_ds-doc.js')
const S = await imp('_ds-store.js')
const U = await imp('_ds-units.js')
const C = await imp('_ds-colors.js')
const K = await imp('_ds-keys.js')
const T = await imp('_ds-text-model.js')
const P = await imp('_ds-path.js')
const H = await imp('_ds-hit.js')
const O = await imp('_ds-open.js')
const M = await imp('_model.js')

const path = (id, x, y, w = 10, h = 10, extra = {}) => ({ id, t: 'path', d: [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']], fill: '#ff0000', fillOpacity: 1, rule: 'nonzero', stroke: null, strokeWidth: 0, strokeOpacity: 1, cap: 0, join: 0, miter: 4, dash: null, dashOffset: 0, ...extra })
const flatDoc = () => ({
  pages: [{ w: 200, h: 100, name: 'P1', items: [path(1, 0, 0), { id: 2, t: 'text', str: 'Hi', family: 'Arial', size: 12, bold: false, italic: false, fill: '#000000', opacity: 1, m: [1, 0, 0, 1, 5, 20], font: 'f1', glyphs: [{ c: 'H', x: 0 }, { c: 'i', x: 8 }] }, { id: 3, t: 'image', href: 'data:image/png;base64,AA==', w: 4, h: 4, m: [10, 0, 0, 10, 0, 0], opacity: 1 }] },
    { w: 50, h: 50, items: [path(4, 1, 1)] }],
  warnings: ['a note'], fonts: { f1: { name: 'Foo', family: 'Foo', bold: false, italic: false, data: new Uint8Array([1, 2, 3]) }, f2: { name: 'Unused', family: 'Unused', bold: false, italic: false, data: null } },
})

// ---------- _tree ----------
await t('tree: flatten(treeFromFlat(x)) equals x (without unused fonts)', () => {
  const flat = flatDoc()
  delete flat.fonts.f2
  const before = clone({ ...flat, fonts: undefined })
  deepFreeze(flat)
  const back = tree.flattenDoc(tree.treeFromFlat(flat))
  assert.deepEqual(clone({ ...back, fonts: undefined }), before)
  assert.deepEqual(Object.keys(back.fonts), ['f1'])
  assert.equal(tree.isTree(tree.treeFromFlat(flat)), true)
  assert.equal(tree.isTree(flat), false)
})
await t('tree: hidden, non-printable layers, only, pages, keepHidden', () => {
  const doc = tree.treeFromFlat(flatDoc())
  const p = doc.pages[0]
  const items = p.layers[0].items
  const t2 = { ...doc, pages: [{ ...p, layers: [
    { name: 'A', hidden: false, locked: false, printable: true, items: [items[0], { t: 'group', id: 9, name: 'G', items: [{ ...items[1], hidden: true }, path(10, 3, 3)] }] },
    { name: 'B', hidden: true, locked: false, printable: true, items: [path(11, 0, 0)] },
    { name: 'C', hidden: false, locked: false, printable: false, items: [path(12, 0, 0)] }] }, doc.pages[1]] }
  deepFreeze(t2)
  const f = tree.flattenDoc(t2)
  assert.deepEqual(f.pages[0].items.map((i) => i.id), [1, 10])
  assert.deepEqual(tree.flattenDoc(t2, { keepHidden: true }).pages[0].items.map((i) => i.id), [1, 2, 10, 11, 12])
  assert.deepEqual(tree.flattenDoc(t2, { pages: [1] }).pages.length, 1)
  assert.deepEqual(tree.flattenDoc(t2, { only: new Set([9]) }).pages[0].items.map((i) => i.id), [10])
  assert.deepEqual(tree.flattenDoc(t2, { only: new Set([1]) }).pages[0].items.map((i) => i.id), [1])
  assert.equal(f.fonts && Object.keys(f.fonts).length, 0) // the hidden text was the only user of f1
})

// ---------- _ds-doc ----------
const validDoc = () => { const { doc } = D.validateDoc(tree.treeFromFlat(flatDoc()), { freshIds: true }); return doc }
await t('doc: validateDoc on reader output assigns fresh unique ids and keeps src', () => {
  const doc = validDoc()
  const ids = []
  D.walkNodes(doc, (n) => ids.push(n.id))
  for (const p of doc.pages) { ids.push(p.id); for (const l of p.layers) ids.push(l.id) }
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.every((i) => Number.isInteger(i) && i > 0))
  assert.equal(doc.pages[0].layers[0].items[0].src, 1)
  assert.equal(doc.pages[0].layers[0].items[1].glyphs.length, 2)
  assert.ok(doc.nextId > Math.max(...ids))
})
await t('doc: hostile values are rejected or neutralised', () => {
  const evil = { pages: [{ id: 1, w: 1e12, h: NaN, name: '<img onerror=alert(1)>', layers: [{ id: 2, name: '<script>', items: [
    { id: 3, t: 'path', d: [['M', 0, 0], ['L', NaN, 1], ['Q', 1, 1], ['L', Infinity, 2], ['L', 1, 1]], fill: 'red;background:url(x)', stroke: '#12345', strokeWidth: -5, cap: 99, join: -1, dash: 'x', __proto__: { polluted: true } },
    { id: 4, t: 'image', href: 'javascript:alert(1)', w: 1, h: 1, m: [1, 2] },
    { id: 5, t: 'image', asset: '__proto__', w: 1, h: 1 },
    { id: 6, t: 'text', str: 'x'.repeat(50000), family: 'A"};body{x:y', size: -3, m: [NaN, 0, 0, 1, 0, 0], font: 'nope', glyphs: [{ c: 'ab', x: 0 }] },
    { id: 7, t: 'script' }, null, 5, 'x'] }] }], fonts: { __proto__: { x: 1 }, constructor: {}, 'bad key!': { data: new Uint8Array(2) } }, units: 'furlongs', palette: ['#fff', 'x', '#a1b2c3'] }
  const { doc, notes } = D.validateDoc(evil, { freshIds: true })
  const items = doc.pages[0].layers[0].items
  assert.equal(items.length, 2) // the bad path loses its bad commands but keeps M and one valid L; text kept; the rest dropped
  const tx = items.find((i) => i.t === 'text')
  assert.equal(tx.str.length, 20000)
  assert.ok(!/["};]/.test(tx.family))
  assert.equal(tx.font, undefined)
  assert.equal(tx.glyphs, undefined)
  assert.equal(doc.units, 'mm')
  assert.deepEqual(doc.palette, ['#a1b2c3'])
  assert.ok(doc.pages[0].w <= 20000 && Number.isFinite(doc.pages[0].h))
  assert.equal(({}).polluted, undefined)
  assert.ok(notes.length > 0)
  const p0 = items.find((i) => i.t === 'path')
  assert.equal(p0.fill, null); assert.equal(p0.stroke, null); assert.equal(p0.strokeWidth, 0); assert.ok(p0.cap <= 2 && p0.join >= 0)
})
// structural invariants every validated doc must satisfy
function assertValid(doc) {
  const ids = new Set()
  const hex = /^#[0-9a-f]{6}$/
  const fin = (v) => typeof v === 'number' && Number.isFinite(v)
  const add = (id) => { assert.ok(Number.isInteger(id) && id > 0, `bad id ${id}`); assert.ok(!ids.has(id), `duplicate id ${id}`); ids.add(id) }
  assert.ok(doc.pages.length >= 1)
  for (const p of doc.pages) {
    add(p.id); assert.ok(p.w >= 1 && p.w <= 20000 && p.h >= 1 && p.h <= 20000)
    assert.ok(p.layers.length >= 1)
    for (const l of p.layers) {
      add(l.id)
      const rec = (items) => { for (const n of items) {
        add(n.id)
        if (n.t === 'group') rec(n.items)
        else if (n.t === 'path') { assert.ok(n.d.every((c) => c.slice(1).every(fin))); assert.ok(n.fill === null || typeof n.fill === 'object' || hex.test(n.fill)); assert.ok(n.stroke === null || hex.test(n.stroke)); assert.ok(n.cap >= 0 && n.cap <= 2) }
        else if (n.t === 'text') { assert.ok(n.m.length === 6 && n.m.every(fin)); assert.ok(n.size > 0 && n.size <= 10000); assert.ok(n.font == null || doc.fonts[n.font]); assert.ok(!/[<>{};"\\]/.test(n.family)) }
        else if (n.t === 'image') { assert.ok(n.m.length === 6 && n.m.every(fin)); assert.ok(n.asset || n.href) }
        else assert.fail(`unknown node ${n.t}`)
      } }
      rec(l.items)
    }
  }
}
await t('doc: fuzz 2000 random mutations never throw (but refusals) and always give a valid doc', () => {
  const junk = [NaN, Infinity, -Infinity, 1e300, -1, 0, '', 'x', '#zzzzzz', '<b>', null, undefined, true, [], {}, [1, 2], { __proto__: { a: 1 } }, 'a'.repeat(300), '../../x', 'javascript:1']
  const mutate = (o, depth = 0) => {
    if (!o || typeof o !== 'object' || ArrayBuffer.isView(o) || depth > 7) return
    const keys = Object.keys(o)
    if (!keys.length) return
    const k = pick(keys)
    const r = rnd()
    if (r < 0.45) o[k] = pick(junk)
    else if (r < 0.55) delete o[k]
    else if (r < 0.6 && Array.isArray(o)) o.length = Math.floor(rnd() * o.length)
    else mutate(o[k], depth + 1)
  }
  let refused = 0
  for (let i = 0; i < 2000; i++) {
    const raw = tree.treeFromFlat(flatDoc())
    for (let m = 0, c = 1 + Math.floor(rnd() * 4); m < c; m++) mutate(raw)
    try { const { doc } = D.validateDoc(raw, { freshIds: true }); assertValid(doc) } catch (e) { if (!/could not be read|no pages|too many|more than/.test(e.message)) throw e; refused++ }
  }
  assert.ok(refused < 1500)
})
await t('doc: limits (node count refusal, pages cap, depth flatten)', () => {
  const many = { pages: [{ w: 10, h: 10, items: Array.from({ length: 300001 }, (_, i) => path(i + 1, 0, 0, 1, 1)) }] }
  assert.throws(() => D.validateDoc(tree.treeFromFlat(many), { freshIds: true }), /more than 300,000/)
  const pages = { pages: Array.from({ length: 305 }, () => ({ w: 10, h: 10, items: [] })) }
  const { doc, notes } = D.validateDoc(tree.treeFromFlat(pages), { freshIds: true })
  assert.equal(doc.pages.length, 300); assert.ok(notes.some((x) => /first 300 pages/.test(x)))
  let g = path(1, 0, 0)
  for (let i = 0; i < 60; i++) g = { t: 'group', id: i + 2, items: [g] }
  const r = D.validateDoc(tree.treeFromFlat({ pages: [{ w: 5, h: 5, items: [g] }] }), { freshIds: true })
  let depth = 0
  const walk = (n, d) => { depth = Math.max(depth, d); if (n.t === 'group') n.items.forEach((k) => walk(k, d + 1)) }
  r.doc.pages[0].layers[0].items.forEach((k) => walk(k, 1))
  assert.ok(depth <= 41)
})
await t('doc: mapItems path-copies only ancestors, input untouched, structural sharing', () => {
  const doc = deepFreeze(validDoc())
  const first = doc.pages[0].layers[0].items[0]
  const text = doc.pages[0].layers[0].items[1]
  const out = D.mapItems(doc, [first.id], (nd) => ({ ...nd, fill: '#00ff00' }))
  assert.notEqual(out, doc)
  assert.equal(out.pages[0].layers[0].items[1], text) // untouched sibling keeps identity
  assert.equal(out.pages[1], doc.pages[1]) // untouched page keeps identity
  assert.equal(out.fonts, doc.fonts)
  assert.equal(D.mapItems(doc, [99999], (nd) => nd), doc) // nothing matched: same root
  const gone = D.removeIds(doc, [first.id])
  assert.equal(gone.pages[0].layers[0].items.length, 2)
  const ins = D.insertAt(doc, doc.pages[0].layers[0].id, 1, [{ id: 777, t: 'group', items: [] }])
  assert.equal(ins.pages[0].layers[0].items[1].id, 777)
})
await t('doc: describeNode, cost, countNodes, maxId', () => {
  const doc = validDoc()
  const [a, b, c] = doc.pages[0].layers[0].items
  assert.equal(D.describeNode(a), 'Curve'); assert.equal(D.describeNode(b), 'Artistic text'); assert.equal(D.describeNode({ t: 'path', shape: { k: 'rect' } }), 'Rectangle')
  assert.equal(D.describeNode({ t: 'group', items: [a, b] }), 'Group of 2 objects')
  assert.ok(D.cost(a) > 400 && D.cost(c) === 400)
  assert.equal(D.countNodes([a, { t: 'group', items: [b, c] }]), 4)
  assert.equal(D.maxId(doc), 8)
  assert.equal(D.newDoc().pages[0].layers.length, 1)
})

// ---------- _ds-store ----------
await t('store: undo, redo, labels, selection restore, merge window', () => {
  const doc = D.newDoc()
  const layerId = doc.pages[0].layers[0].id
  const s = S.createStore(doc)
  const add = (x, label = 'Add', o) => s.tx(label, (r) => D.insertAt(r, layerId, null, [{ ...path(s.newId(), x, 0), }]), o)
  assert.equal(s.canUndo(), false)
  add(0, 'Add one'); add(20, 'Add two')
  assert.equal(s.root.pages[0].layers[0].items.length, 2)
  s.setSel([s.root.pages[0].layers[0].items[1].id])
  assert.equal(s.undoLabel(), 'Add two')
  s.undo()
  assert.equal(s.root.pages[0].layers[0].items.length, 1)
  assert.deepEqual(s.sel.ids, []) // the selected object no longer exists
  assert.equal(s.redoLabel(), 'Add two')
  s.redo()
  assert.equal(s.root.pages[0].layers[0].items.length, 2)
  // merge: same key inside the window is one history entry
  const len = s.historyLength
  s.tx('Nudge', (r) => D.mapItems(r, [s.root.pages[0].layers[0].items[0].id], (nd) => ({ ...nd, name: 'a' })), { merge: 'nudge' })
  s.tx('Nudge', (r) => D.mapItems(r, [s.root.pages[0].layers[0].items[0].id], (nd) => ({ ...nd, name: 'b' })), { merge: 'nudge' })
  assert.equal(s.historyLength, len + 1)
  s.undo()
  assert.equal(s.root.pages[0].layers[0].items[0].name, undefined)
  assert.equal(s.tx('No change', (r) => r), false)
  s.jump(0)
  assert.equal(s.root.pages[0].layers[0].items.length, 0)
  assert.equal(s.dirty, false)
})
await t('store: new ids never repeat, find() sees every node, page index follows deletions', () => {
  const doc = validDoc()
  const s = S.createStore(doc)
  const a = s.newId(), b = s.newId()
  assert.ok(b > a && a > D.maxId(doc))
  for (const p of doc.pages) for (const l of p.layers) { assert.ok(s.find(l.id).layer); D.walkNodes({ pages: [{ ...p, layers: [l] }] }, (nd) => assert.equal(s.find(nd.id).node, nd)) }
  s.setPage(1)
  assert.equal(s.page(), doc.pages[1])
  s.tx('Drop page 2', (r) => ({ ...r, pages: r.pages.slice(0, 1) }))
  assert.equal(s.pageIndex, 0)
  s.undo()
  assert.equal(s.root.pages.length, 2)
})
await t('store: 200-step random edit/undo/redo fuzz matches a deep-clone oracle', () => {
  const doc = D.newDoc()
  const layerId = doc.pages[0].layers[0].id
  const s = S.createStore(doc)
  const snaps = [clone(s.root)]
  let at = 0
  const items = () => s.root.pages[0].layers[0].items
  for (let i = 0; i < 200; i++) {
    const r = rnd()
    if (r < 0.5) {
      const kind = rnd()
      const ok = s.tx('Edit', (root) => {
        const list = D.walkNodesList ? [] : items()
        if (kind < 0.4 || !list.length) return D.insertAt(root, layerId, rnd() < 0.5 ? null : 0, [path(s.newId(), Math.floor(rnd() * 100), 0)])
        const target = pick(list)
        if (kind < 0.7) return D.mapItems(root, [target.id], (nd) => ({ ...nd, fill: pick(['#ff0000', '#00ff00', '#0000ff']) }))
        if (kind < 0.85) return D.removeIds(root, [target.id])
        return D.mapItems(root, [target.id], (nd) => ({ t: 'group', id: s.newId(), name: 'G', items: [nd] }))
      })
      if (ok) { snaps.length = at + 1; snaps.push(clone(s.root)); at++ }
    } else if (r < 0.75) { if (s.undo()) at-- } else if (s.redo()) at++
    assert.equal(JSON.stringify(s.root), JSON.stringify(snaps[at]), `step ${i}`)
  }
})
await t('store: cost cap evicts the oldest entries but keeps the last five', () => {
  const doc = D.newDoc()
  const layerId = doc.pages[0].layers[0].id
  const s = S.createStore(doc)
  const big = (id) => ({ ...path(id, 0, 0), d: Array.from({ length: 200000 }, (_, i) => (i ? ['L', i, i] : ['M', 0, 0])) })
  for (let i = 0; i < 12; i++) s.tx('Big', (r) => D.insertAt(r, layerId, null, [big(s.newId())]))
  assert.ok(s.historyBytes <= S.HISTORY_BYTES + 200000 * 80 * 2, `bytes ${s.historyBytes}`)
  assert.ok(s.historyLength >= 5 && s.historyLength < 12)
})

// ---------- units, colours ----------
await t('units: conversions, the y flip, nice steps', () => {
  assert.ok(Math.abs(U.toUnit(72, 'in') - 1) < 1e-9)
  assert.ok(Math.abs(U.fromUnit(25.4, 'mm') - 72) < 1e-9)
  assert.equal(U.fmt(72, 'in'), '1'); assert.equal(U.fmt(595.28, 'mm'), '210')
  const page = { w: 200, h: 100 }
  assert.deepEqual(U.pageToUi(page, 10, 90, { unit: 'pt' }), [10, 10])
  assert.deepEqual(U.uiToPage(page, 10, 10, { unit: 'pt' }), [10, 90])
  assert.deepEqual(U.pageToUi(page, 10, 90, { unit: 'pt', yUp: false }), [10, 90])
  for (const z of [0.05, 0.3, 1, 4, 20]) { const st = U.niceStep(z, 'mm'); const mant = +(st / 10 ** Math.floor(Math.log10(st))).toFixed(6); assert.ok([1, 2, 5, 10].includes(mant), `step ${st}`); assert.ok(st * z * U.PT_PER.mm >= 50 - 1e-6) }
})
await t('colors: hex, CMYK round trip within 1, HSL, palette, usedColors', () => {
  assert.equal(C.normHex('#ABC'), '#aabbcc'); assert.equal(C.normHex('nope'), null)
  assert.deepEqual(C.hexToRgb('#102030'), [16, 32, 48])
  for (let i = 0; i < 300; i++) {
    const rgb = [Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 256)]
    const back = C.rgbFromCmyk(...C.cmykFromRgb(...rgb))
    rgb.forEach((v, k) => assert.ok(Math.abs(v - back[k]) <= 1, `${rgb} -> ${back}`))
    const [h, s, l] = C.hslFromRgb(...rgb)
    C.rgbFromHsl(h, s, l).forEach((v, k) => assert.ok(Math.abs(v - rgb[k]) <= 1))
  }
  assert.ok(C.DEFAULT_PALETTE.length >= 90 && C.DEFAULT_PALETTE.every((c) => /^#[0-9a-f]{6}$/.test(c)))
  const doc = validDoc()
  const used = C.usedColors(doc, doc.pages[0].id)
  assert.deepEqual(used.map((u) => u.hex).sort(), ['#000000', '#ff0000'])
})

// ---------- command table ----------
await t('keys: no duplicate keys, every command in a menu, every menu exists, normaliser', () => {
  const { dupes, map } = K.buildKeymap()
  assert.deepEqual(dupes, [])
  const tr = K.menuTree()
  const inMenu = new Set()
  const rec = (items) => items.forEach((i) => (i.items ? rec(i.items) : i.id && inMenu.add(i.id)))
  tr.forEach((m) => { assert.ok(K.MENUS.includes(m.menu)); rec(m.items) })
  for (const c of K.COMMANDS) { assert.ok(K.MENUS.includes(c.menu), c.id); assert.ok(inMenu.has(c.id), `${c.id} is in no menu`) }
  assert.equal(new Set(K.COMMANDS.map((c) => c.id)).size, K.COMMANDS.length)
  const ev = (o) => ({ key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o })
  assert.equal(K.normalizeKey(ev({ key: 'o', code: 'KeyO', ctrlKey: true })), 'Ctrl+O')
  assert.equal(K.normalizeKey(ev({ key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true })), 'Ctrl+Shift+Z')
  assert.equal(K.normalizeKey(ev({ key: 'PageDown', shiftKey: true })), 'Shift+PageDown')
  assert.equal(K.normalizeKey(ev({ key: '?', shiftKey: true })), '?')
  assert.equal(K.normalizeKey(ev({ key: ' ' })), 'Space'); assert.equal(K.normalizeKey(ev({ key: 'Escape' })), 'Esc')
  assert.equal(K.normalizeKey(ev({ key: 'F4', shiftKey: true })), 'Shift+F4'); assert.equal(K.normalizeKey(ev({ key: 'Shift', shiftKey: true })), '')
  assert.equal(K.normalizeKey(ev({ key: 'z', metaKey: true, code: 'KeyZ' })), 'Ctrl+Z')
  assert.equal(map.get('Ctrl+O'), 'file.open'); assert.equal(map.get('?'), 'help.shortcuts')
  assert.ok(K.shortcutRows().length > 5)
})

// ---------- text model ----------
await t('text-model: family quoting, stacks, lines, align, scale folding, glyph x list', () => {
  assert.equal(T.quoteFamily('Arial'), '"Arial"'); assert.equal(T.quoteFamily('SANS-SERIF'), 'sans-serif')
  const evil = T.quoteFamily('A"};body{x:y}\\<b>')
  assert.ok(!/[<>{};]/.test(evil)); assert.ok(evil.startsWith('"') && evil.endsWith('"')); assert.ok(!/[^\\]"[^$]/.test(evil.slice(1, -1).replace(/\\./g, '')))
  const node = { str: 'a\nbb', size: 10, lh: 1.5, family: 'Arial', m: [1, 0, 0, 1, 10, 20], align: 'center', t: 'text', id: 5 }
  const lines = T.lineSplit(node, (s) => s.length * 5)
  assert.deepEqual(lines.map((l) => l.y), [0, 15]); assert.deepEqual(lines.map((l) => l.width), [5, 10])
  assert.equal(T.bakeAlign('center', 10), -5); assert.equal(T.bakeAlign('right', 10), -10); assert.equal(T.bakeAlign('left', 10), 0)
  const baked = T.bakeLines(node, (s) => s.length * 5)
  assert.equal(baked.length, 2); assert.ok(baked.every((b) => !('lh' in b) && !('align' in b) && !b.str.includes('\n')))
  assert.deepEqual(baked[1].m, M.mul(node.m, M.translate(-5, 15)))
  assert.equal(baked[1].id, undefined)
  const fs = T.fontStack({ font: 'f0:x', family: 'Arial' }, { ok: () => true, family: () => 'ds1-f0_x' }, 'abc')
  assert.ok(fs.startsWith('"ds1-f0_x","Arial"')); assert.ok(fs.endsWith('sans-serif'))
  assert.ok(!T.fontStack({ font: 'k', family: 'Arial' }, { ok: () => false }, 'abc').includes('ds'))
  const sc = T.normalizeText({ str: 'a', size: 10, m: [2, 0, 0, 2, 5, 6], glyphs: [{ c: 'a', x: 3 }] })
  assert.equal(sc.size, 20); assert.deepEqual(sc.m, [1, 0, 0, 1, 5, 6]); assert.equal(sc.glyphs[0].x, 6)
  const rot = { str: 'a', size: 10, m: [0, 1, -1, 0, 0, 0] }; assert.equal(T.normalizeText(rot), rot)
  assert.deepEqual(T.glyphXList({ glyphs: [{ c: 'a', x: 1 }, { c: '\u{1F600}', x: 2 }] }), [1, 2, 2])
  assert.equal(T.fontList({ a: { family: 'Foo' } }).filter((f) => f.group === 'In this document').length, 1)
})

// ---------- path, hit, snapping ----------
await t('path: pathDistance on lines, curves and closed shapes', () => {
  const sq = path(1, 0, 0, 10, 10).d
  assert.equal(P.pathDistance(sq, { x: 5, y: -3 }), 3)
  assert.equal(P.pathDistance(sq, { x: 5, y: 0 }), 0)
  assert.ok(P.pathDistance(sq, { x: 5, y: 5 }) === 5)
  const c = [['M', 0, 0], ['C', 0, 10, 10, 10, 10, 0]]
  assert.ok(P.pathDistance(c, { x: 5, y: 7.5 }) < 0.1)
})
await t('hit: boxes, marquee, snapping maths, pickables skip hidden and locked', () => {
  const doc = validDoc()
  const layer = doc.pages[0].layers[0]
  const hidden = { ...layer.items[0], id: 900, hidden: true, d: layer.items[0].d }
  const locked = { ...layer.items[0], id: 901, locked: true }
  const root = { ...doc, pages: [{ ...doc.pages[0], layers: [{ ...layer, items: [...layer.items, hidden, locked] }], guides: [{ id: 800, axis: 'v', pos: 55 }] }, doc.pages[1]] }
  const s = S.createStore(root)
  const boxOf = H.createBoxer((nd) => ({ x: nd.m[4], y: nd.m[5] - 12, w: 16, h: 14 }))
  const ids = H.pickables(s).map((x) => x.id)
  assert.ok(!ids.includes(900) && !ids.includes(901))
  assert.deepEqual(H.marquee(s, boxOf, { x: -1, y: -1, w: 12, h: 12 }).sort(), [layer.items[0].id, layer.items[2].id].sort()) // the square and the image, not the wider text
  assert.ok(H.marquee(s, boxOf, { x: 5, y: 5, w: 3, h: 3 }, true).includes(layer.items[0].id))
  const T2 = H.collectTargets(s, boxOf)
  assert.ok(T2.xs.includes(55) && T2.xs.includes(100) && T2.ys.includes(50))
  const sb = H.snapBox({ x: 53, y: 3, w: 10, h: 10 }, T2, 3)
  assert.equal(sb.dx, 2); assert.deepEqual(sb.lines.x, [55])
  assert.equal(H.snapBox({ x: 53, y: 3, w: 10, h: 10 }, T2, 3, true).dx, 0) // Alt bypasses
  const sp = H.snapPoint({ x: 99, y: 49.5 }, T2, 2)
  assert.deepEqual([sp.x, sp.y], [100, 50])
})

// ---------- open: sniff, fonts, CDR ----------
await t('open: sniff by content, not extension', () => {
  const b = (...v) => Uint8Array.from(v)
  const txt = (s) => new TextEncoder().encode(s)
  assert.equal(O.sniff(txt('%PDF-1.7\n'), 'x.ai'), 'pdf')
  assert.equal(O.sniff(txt('junk junk\n%PDF-1.4'), 'x.png'), 'pdf')
  assert.equal(O.sniff(txt('%!PS-Adobe-3.0 EPSF'), 'x.eps'), 'ps'); assert.equal(O.sniff(b(0xc5, 0xd0, 0xd3, 0xc6, 0, 0), 'a.eps'), 'ps')
  assert.equal(O.sniff(Uint8Array.from([...txt('RIFF'), 0, 0, 0, 0, ...txt('CDR9')]), 'a.cdr'), 'cdr')
  assert.equal(O.sniff(Uint8Array.from([...txt('RIFF'), 0, 0, 0, 0, ...txt('WEBP')]), 'a.bin'), 'webp')
  assert.equal(O.sniff(b(0x50, 0x4b, 3, 4), 'a.cdr'), 'cdr'); assert.equal(O.sniff(b(0x50, 0x4b, 3, 4), 'a.docx'), null)
  assert.equal(O.sniff(b(0x1f, 0x8b, 8, 0), 'a.svgz'), 'svgz')
  assert.equal(O.sniff(b(0x89, 0x50, 0x4e, 0x47, 1), 'a'), 'png'); assert.equal(O.sniff(b(0xff, 0xd8, 0xff, 0xe0), 'a'), 'jpeg')
  assert.equal(O.sniff(txt('GIF89a'), 'a'), 'gif'); assert.equal(O.sniff(txt('BM\0\0\0'), 'a'), 'bmp')
  assert.equal(O.sniff(Uint8Array.from([0, 0, 0, 24, ...txt('ftypheic')]), 'a'), 'heic')
  assert.equal(O.sniff(txt('\uFEFF<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'), 'a.txt'), 'svg')
  assert.equal(O.sniff(txt('  <svg width="1"/>'), 'a'), 'svg')
  assert.equal(O.sniff(txt('hello world'), 'a.svg'), null)
  assert.equal(O.sniff(b(1, 2), 'a'), null)
})
await t('open: font merger prefixes keys and merges equal fonts across calls', () => {
  const m = O.createFontMerger()
  const rec = (name, len) => ({ name, family: name, bold: false, italic: false, data: len ? new Uint8Array(len) : null })
  const a = m.merge({ g_d0_f1: rec('Foo', 10), g_d0_f2: rec('Bar', 5), nodata: rec('T3', 0) })
  const b = m.merge({ g_d0_f1: rec('Foo', 10), other: rec('Foo', 11) })
  assert.equal(a.map.g_d0_f1, b.map.g_d0_f1) // same name and size: one font
  assert.notEqual(b.map.other, b.map.g_d0_f1)
  assert.ok(Object.keys(m.all).length === 4)
  assert.ok(Object.keys(m.all).every((k) => /^[\w.:-]{1,64}$/.test(k)))
})
await t('open: normalizeDoc turns reader output into an editor doc with assets, merged fonts and notes', async () => {
  const made = []
  const assets = { addBlob: async (b, nm, o) => { made.push(o?.key); return { id: `a${made.length}`, w: 4, h: 4 } } }
  const flat = flatDoc()
  flat.pages[0].items.push({ id: 8, t: 'image', href: 'data:image/png;base64,AA==', w: 9, h: 9, m: [1, 0, 0, 1, 0, 0], opacity: 1 }, { id: 9, t: 'image', href: 'data:image/png;base64,BB==', w: 9, h: 9, m: [1, 0, 0, 1, 0, 0], opacity: 1 })
  const globalFetch = globalThis.fetch
  globalThis.fetch = async (href) => (href.endsWith('BB==') ? Promise.reject(new Error('boom')) : { blob: async () => new Blob([new Uint8Array(8)]) })
  try {
    const { doc, notes } = await O.normalizeDoc(flat, { assets, title: 'T', source: 'pdf', name: 'f.pdf' })
    const imgs = []; D.walkNodes(doc, (nd) => { if (nd.t === 'image') imgs.push(nd) })
    assert.equal(imgs.length, 2) // the unreadable one was dropped
    assert.ok(imgs.every((i) => i.asset && !i.href))
    assert.ok(notes.some((x) => /1 picture could not be read/.test(x)))
    assert.deepEqual(Object.keys(doc.fonts), ['f0:f1']) // unused font removed, key prefixed
    assert.equal(doc.pages[0].layers[0].items[1].font, 'f0:f1')
    assert.equal(doc.title, 'T'); assert.equal(doc.meta.source, 'pdf'); assert.ok(doc.warnings.includes('a note'))
    assertValid(doc)
  } finally { globalThis.fetch = globalFetch }
})
const samples = process.argv[2] || process.env.DS_SAMPLES || 'C:/Projects/tools-packs/draw-studio-samples'
if (existsSync(join(samples, 'manifest.json'))) {
  await t('open: cdrToTree keeps layers and groups, never throws on damaged files (RIFF samples)', async () => {
    const { readCdr } = await imp('_cdr.js')
    const manifest = JSON.parse(readFileSync(join(samples, 'manifest.json'), 'utf8'))
    let k = 0
    for (const [name, m] of Object.entries(manifest)) {
      if (m.container !== 'riff') continue
      const cdr = await readCdr(readFileSync(join(samples, name)))
      const tr = await O.cdrToTree(cdr)
      assert.equal(cdr.pages.length, m.pages, name)
      assert.equal(tr.pages.length, cdr.pages.filter((p) => !p.master).length, name) // master pages are not shown
      assert.ok(tr.pages.every((p) => p.layers.length >= 1 && p.w > 0 && p.h > 0), name)
      let leaves = 0, groups = 0
      tree.walkTree(tr, (nd) => { if (nd.t === 'group') groups++; else leaves++ })
      assert.ok(leaves >= m.objects, `${name}: ${leaves} < ${m.objects}`)
      const { doc } = D.validateDoc(tr, { freshIds: true })
      assertValid(doc)
      k++
    }
    assert.ok(k >= 4)
    for (const f of readdirSync(samples).filter((x) => x.startsWith('bad-') || x.startsWith('old-'))) {
      const cdr = await readCdr(readFileSync(join(samples, f)), {})
      assert.ok(cdr.warnings.length > 0, f)
      await O.cdrToTree(cdr) // must not throw
    }
  })
} else console.log(`(skipping CDR sample test: no manifest.json in ${samples})`)


// ---------- E3 to E5: operations, gesture maths, selection helpers, new commands ----------
const Ops = await imp('_ds-ops.js')
const G = await imp('_ds-gesture.js')
const Sel = await imp('_ds-sel.js')
const near = (a, b, e = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= e, `${msg} ${a} vs ${b}`)
const boxNear = (b, x, y, w, h, e = 1e-6) => { near(b.x, x, e, 'x'); near(b.y, y, e, 'y'); near(b.w, w, e, 'w'); near(b.h, h, e, 'h') }
const bbox = (n) => M.pathBBox(n.d)
/** A frozen test root: Layer A [r1 (0,0,10,10), grp{g1 (20,0,10,10), g2 (40,0,10,10)}, r2 (60,0,10,10)], Layer B [top (5,5,10,10)]. */
function opsRoot() {
  const d = D.newDoc({ w: 200, h: 100 })
  const [la] = d.pages[0].layers
  const lb = D.newLayer(900, 'Layer B')
  const A = { ...la, items: [path(10, 0, 0), { id: 13, t: 'group', name: 'Grp', items: [path(11, 20, 0), path(12, 40, 0)] }, path(14, 60, 0)] }
  const B = { ...lb, items: [path(15, 5, 5)] }
  return deepFreeze({ ...d, nextId: 1000, pages: [{ ...d.pages[0], layers: [A, B] }] })
}
const listIds = (items) => items.map((n) => (n.t === 'group' ? [n.id, listIds(n.items)] : n.id))
let nid = 5000
const newId = () => nid++

await t('ops: transformItem for every item type (path, shape, gradient, clip memo, text, image mirror, group)', () => {
  const grad = { g: 'linear', x1: 0, y1: 0, x2: 10, y2: 0, m: [1, 0, 0, 1, 0, 0], stops: [{ o: 0, c: '#000000', a: 1 }, { o: 1, c: '#ffffff', a: 1 }], spread: 'pad' }
  const clip = { d: [['M', 0, 0], ['L', 10, 0], ['L', 10, 10], ['Z']], rule: 'nonzero' }
  const a = deepFreeze({ ...path(1, 0, 0), fill: grad, clip: [clip], shape: { k: 'rect', w: 10, h: 10, rx: 0, ry: 0 }, sm: [1, 0, 0, 1, 0, 0], stroke: '#000000', strokeWidth: 2, dash: [2, 1], dashOffset: 1 })
  const b = deepFreeze({ ...path(2, 20, 0), clip: [clip] })
  const R = M.rotate(Math.PI / 6)
  const memo = new Map()
  const ta = Ops.transformItem(a, R, { memo }), tb = Ops.transformItem(b, R, { memo })
  assert.deepEqual(ta.d, M.mapPath(a.d, R))
  // gradient endpoints equal apply(M, p) of the originals
  const p1 = M.apply(R, ...M.apply(grad.m, grad.x1, grad.y1)), q1 = M.apply(ta.fill.m, ta.fill.x1, ta.fill.y1)
  near(p1[0], q1[0]); near(p1[1], q1[1])
  const p2 = M.apply(R, ...M.apply(grad.m, grad.x2, grad.y2)), q2 = M.apply(ta.fill.m, ta.fill.x2, ta.fill.y2)
  near(p2[0], q2[0]); near(p2[1], q2[1])
  assert.deepEqual(ta.sm, M.mul(R, [1, 0, 0, 1, 0, 0]))
  assert.equal(ta.clip[0], tb.clip[0], 'items that shared a clip keep sharing the mapped copy')
  assert.deepEqual(ta.clip[0].d, M.mapPath(clip.d, R))
  assert.equal(ta.strokeWidth, 2, 'outline width is not scaled by default')
  const ts = Ops.transformItem(a, M.scale(3), { scaleStroke: true })
  near(ts.strokeWidth, 6); assert.deepEqual(ts.dash, [6, 3]); near(ts.dashOffset, 3)
  near(ta.rot, -30, 1e-6) // rotate(+30 degrees) turns clockwise on screen, so the counter-clockwise angle is -30
  // image: a mirror is exact
  const im = deepFreeze({ id: 3, t: 'image', asset: 'a1', w: 4, h: 4, m: [10, 0, 0, 10, 5, 5], opacity: 1 })
  const fl = Ops.transformItem(im, [-1, 0, 0, 1, 100, 0])
  assert.deepEqual(fl.m, [-10, 0, 0, 10, 95, 5])
  // text: uniform scale folds into size and glyph x, rotation does not
  const tx = deepFreeze({ id: 4, t: 'text', str: 'Hi', family: 'Arial', size: 12, bold: false, italic: false, fill: '#000000', opacity: 1, m: [1, 0, 0, 1, 5, 20], glyphs: [{ c: 'H', x: 0 }, { c: 'i', x: 8 }], font: 'f1' })
  const sc = Ops.transformItem(tx, M.mul(M.translate(10, 0), M.scale(2)))
  near(sc.size, 24); assert.deepEqual(sc.glyphs.map((g) => g.x), [0, 16]); assert.deepEqual(sc.m, [1, 0, 0, 1, 20, 40])
  const rt = Ops.transformItem(tx, M.rotate(0.5))
  assert.equal(rt.size, 12); assert.ok(Math.abs(rt.m[1]) > 0.1)
  // group recurses and keeps ids and names
  const g = deepFreeze({ id: 9, t: 'group', name: 'G', items: [a, b] })
  const tg = Ops.transformItem(g, M.translate(5, 5))
  assert.equal(tg.name, 'G'); assert.equal(tg.id, 9); assert.deepEqual(bbox(tg.items[1]), { x: 25, y: 5, w: 10, h: 10 })
})
await t('ops: transformIds moves a group once, keeps untouched nodes identical, ignores identity and bad matrices', () => {
  const root = opsRoot()
  const out = Ops.transformIds(root, [13, 11], M.translate(10, 5)) // 11 is inside 13: moved with the group, never twice
  const grp = out.pages[0].layers[0].items[1]
  boxNear(bbox(grp.items[0]), 30, 5, 10, 10)
  assert.equal(out.pages[0].layers[0].items[0], root.pages[0].layers[0].items[0])
  assert.equal(out.pages[0].layers[1], root.pages[0].layers[1])
  assert.equal(Ops.transformIds(root, [10], [1, 0, 0, 1, 0, 0]), root)
  assert.equal(Ops.transformIds(root, [10], [NaN, 0, 0, 1, 0, 0]), root)
  const m = Ops.mirror(root, [10], 'h', { x: 0, y: 0, w: 10, h: 10 })
  boxNear(bbox(m.pages[0].layers[0].items[0]), 0, 0, 10, 10)
  const r90 = Ops.rotate90(root, [10], true, { x: 0, y: 0, w: 20, h: 10 })
  boxNear(bbox(r90.pages[0].layers[0].items[0]), 5, -5, 10, 10, 1e-6)
})
await t('ops: duplicate, group, ungroup, delete, arrange', () => {
  const root = opsRoot()
  const out = {}
  const dup = Ops.duplicate(root, [10, 13], newId, { dx: 5, dy: 5, out })
  const items = dup.pages[0].layers[0].items
  assert.equal(items.length, 5); assert.equal(out.ids.length, 2)
  assert.equal(items[0], root.pages[0].layers[0].items[0]); assert.equal(items[1].t, 'path'); assert.notEqual(items[1].id, 10)
  boxNear(bbox(items[1]), 5, 5, 10, 10)
  assert.equal(items[3].t, 'group'); assert.notEqual(items[3].items[0].id, 11); boxNear(bbox(items[3].items[0]), 25, 5, 10, 10)
  const ids = new Set(); D.walkNodes(dup, (n) => { assert.ok(!ids.has(n.id), 'ids stay unique'); ids.add(n.id) })
  // group two nodes of one layer: placed where the top-most was, others removed
  const go = {}
  const g = Ops.group(root, [10, 14], newId, { out: go })
  const gl = g.pages[0].layers[0].items
  assert.equal(gl.length, 2); assert.equal(gl[1].t, 'group'); assert.deepEqual(gl[1].items.map((n) => n.id), [10, 14]); assert.equal(gl[1].id, go.id)
  assert.equal(Ops.group(root, [10], newId), root, 'one object is not a group')
  // group across layers goes where the top-most object (Layer B) is
  const gx = Ops.group(root, [10, 15], newId, {})
  assert.equal(gx.pages[0].layers[1].items[0].t, 'group'); assert.equal(gx.pages[0].layers[0].items.length, 2)
  // ungroup restores the children in place; ungroup all goes through nested groups
  const uo = {}
  const u = Ops.ungroup(root, [13], { out: uo })
  assert.deepEqual(u.pages[0].layers[0].items.map((n) => n.id), [10, 11, 12, 14]); assert.deepEqual(uo.ids, [11, 12])
  const outerId = {}
  const w = Ops.group(root, [13, 14], newId, { out: outerId })
  assert.equal(Ops.ungroup(w, [outerId.id]).pages[0].layers[0].items.some((n) => n.t === 'group' && n.id !== 13), false)
  const flat = Ops.ungroup(w, [outerId.id], { all: true })
  assert.deepEqual(flat.pages[0].layers[0].items.map((n) => n.id), [10, 11, 12, 14])
  // delete removes and prunes emptied groups
  const del = Ops.deleteIds(root, [11, 12])
  assert.deepEqual(del.pages[0].layers[0].items.map((n) => n.id), [10, 14])
  // arrange
  const order = (r) => r.pages[0].layers[0].items.map((n) => n.id)
  assert.deepEqual(order(Ops.arrange(root, [10], 'front')), [13, 14, 10]); assert.deepEqual(order(Ops.arrange(root, [14], 'back')), [14, 10, 13])
  assert.deepEqual(order(Ops.arrange(root, [10], 'forward')), [13, 10, 14]); assert.deepEqual(order(Ops.arrange(root, [14], 'backward')), [10, 14, 13])
  assert.deepEqual(order(Ops.arrange(root, [10, 14], 'reverse')), [14, 13, 10])
  assert.equal(Ops.arrange(root, [14], 'front'), root, 'already in front: same root, no history step')
  assert.deepEqual(Ops.arrange(root, [11], 'front').pages[0].layers[0].items[1].items.map((n) => n.id), [12, 11])
})
await t('ops: moveNodes (layer, group, above, below), flags, names, layers', () => {
  const root = opsRoot()
  const inB = Ops.moveNodes(root, [10, 14], { into: 900 })
  assert.deepEqual(inB.pages[0].layers[0].items.map((n) => n.id), [13]); assert.deepEqual(inB.pages[0].layers[1].items.map((n) => n.id), [15, 10, 14])
  const inG = Ops.moveNodes(root, [10], { into: 13 })
  assert.deepEqual(listIds(inG.pages[0].layers[0].items), [[13, [11, 12, 10]], 14])
  const above = Ops.moveNodes(root, [10], { above: 14 }), below = Ops.moveNodes(root, [14], { below: 10 })
  assert.deepEqual(above.pages[0].layers[0].items.map((n) => n.id), [13, 14, 10]); assert.deepEqual(below.pages[0].layers[0].items.map((n) => n.id), [14, 10, 13])
  assert.equal(Ops.moveNodes(root, [13], { into: 13 }), root, 'a group cannot move into itself')
  assert.equal(Ops.moveNodes(root, [13], { above: 11 }), root, 'nor next to its own child')
  const emptied = Ops.moveNodes(root, [11, 12], { into: 900 })
  assert.deepEqual(emptied.pages[0].layers[0].items.map((n) => n.id), [10, 14], 'a group left empty is removed')
  const hid = Ops.setFlag(root, [10], 'hidden', true); assert.equal(hid.pages[0].layers[0].items[0].hidden, true)
  assert.equal(Ops.setFlag(hid, [10], 'hidden', false).pages[0].layers[0].items[0].hidden, undefined); assert.equal(Ops.setFlag(root, [10], 'locked', false), root)
  assert.equal(Ops.renameNode(root, 10, '  My box ').pages[0].layers[0].items[0].name, 'My box')
  assert.equal(Ops.renameNode(Ops.renameNode(root, 10, 'x'), 10, '').pages[0].layers[0].items[0].name, undefined)
  const nl = {}; const added = Ops.addLayer(root, root.pages[0].id, newId, { aboveId: 2, out: nl })
  assert.deepEqual(added.pages[0].layers.map((l) => l.id), [2, nl.id, 900]); assert.match(added.pages[0].layers[1].name, /^Layer \d+$/)
  assert.equal(Ops.deleteLayer(Ops.deleteLayer(root, 900), 2).pages[0].layers.length, 1, 'the last layer cannot be deleted')
  assert.deepEqual(Ops.moveLayer(root, 2, 1).pages[0].layers.map((l) => l.id), [900, 2]); assert.equal(Ops.moveLayer(root, 900, 1), root)
  assert.equal(Ops.setLayerFlag(root, 900, 'hidden', true).pages[0].layers[1].hidden, true)
  assert.equal(Ops.renameLayer(root, 900, 'Top').pages[0].layers[1].name, 'Top'); assert.equal(Ops.renamePage(root, root.pages[0].id, 'Cover').pages[0].name, 'Cover')
})
await t('ops: setStyle colours every leaf of a group, text takes fill only, K hints, outline rules, styleSummary', () => {
  const root = opsRoot()
  const red = Ops.setStyle(root, [13], { fill: '#00ff00', fillK: [0, 0, 0, 0] })
  const kids = red.pages[0].layers[0].items[1].items
  assert.ok(kids.every((k) => k.fill === '#00ff00' && k.fillK))
  const noK = Ops.setStyle(red, [13], { fill: '#112233' })
  assert.ok(noK.pages[0].layers[0].items[1].items.every((k) => k.fill === '#112233' && !('fillK' in k)), 'a colour set without CMYK drops the old hint')
  assert.equal(Ops.setStyle(root, [10], { fill: '#ff0000' }), root, 'same colour: same root')
  const out = Ops.setStyle(root, [10], { stroke: '#000000' })
  assert.equal(out.pages[0].layers[0].items[0].strokeWidth, Ops.DEFAULT_OUTLINE, 'an outline colour on a shape with no outline gives it a thin one')
  const w = Ops.setStyle(root, [10], { strokeWidth: 3 }); assert.equal(w.pages[0].layers[0].items[0].stroke, '#000000')
  const none = Ops.setStyle(root, [10], { fill: null }); assert.equal(none.pages[0].layers[0].items[0].fill, null)
  const text = { id: 77, t: 'text', str: 'A', family: 'Arial', size: 10, bold: false, italic: false, fill: '#000000', opacity: 1, m: [1, 0, 0, 1, 0, 0] }
  const withText = D.insertAt(root, 2, null, [text])
  const tt = Ops.setStyle(withText, [77], { fill: '#ff00ff', stroke: '#00ff00', strokeWidth: 4 })
  const tn = tt.pages[0].layers[0].items.at(-1); assert.equal(tn.fill, '#ff00ff'); assert.equal(tn.stroke, undefined)
  assert.equal(Ops.setStyle(withText, [77], { fill: null }).pages[0].layers[0].items.at(-1).fill, '#000000', 'text cannot lose its fill')
  const sum = Ops.styleSummary([root.pages[0].layers[0].items[0], root.pages[0].layers[0].items[2]])
  assert.equal(sum.fill.kind, 'color'); assert.equal(sum.fill.hex, '#ff0000'); assert.equal(sum.stroke.kind, 'none'); assert.equal(sum.width, null)
  const mixed = Ops.styleSummary([root.pages[0].layers[0].items[0], { ...path(99, 0, 0), fill: '#0000ff', stroke: '#000000', strokeWidth: 2 }])
  assert.equal(mixed.fill.kind, 'mixed'); assert.equal(mixed.width, 2)
})
await t('ops: structural sharing on every operation (inputs are deep-frozen, so any mutation would throw)', () => {
  const root = opsRoot()
  const ops = [(r) => Ops.transformIds(r, [10], M.translate(1, 1)), (r) => Ops.deleteIds(r, [14]), (r) => Ops.group(r, [10, 14], newId, {}), (r) => Ops.arrange(r, [10], 'front'), (r) => Ops.setStyle(r, [10], { fill: '#00ff00' }), (r) => Ops.duplicate(r, [10], newId, { dx: 1 }), (r) => Ops.moveNodes(r, [10], { into: 900 })]
  for (const op of ops) { const out = op(root); assert.notEqual(out, root); assert.equal(out.pages[0].layers[1] === root.pages[0].layers[1] || op === ops[6] || op === ops[2], true, 'a layer an operation does not touch keeps its identity') }
})
await t('gesture: handle points, scale (ratio, from centre, mirror, clamp), rotate (steps), skew, hit', () => {
  const box = { x: 10, y: 20, w: 100, h: 50 }
  assert.deepEqual(G.handlePoint(box, 'nw'), { x: 10, y: 20 }); assert.deepEqual(G.handlePoint(box, 'se'), { x: 110, y: 70 }); assert.deepEqual(G.handlePoint(box, 'n'), { x: 60, y: 20 })
  const corner = (r) => M.apply(r.M, 110, 70)
  // dragging the south-east handle scales about the north-west corner
  let r = G.scaleFromHandle(box, 'se', { x: 100, y: 25 }); near(r.sx, 2); near(r.sy, 1.5); assert.deepEqual(M.apply(r.M, 10, 20), [10, 20]); near(corner(r)[0], 210); near(corner(r)[1], 95)
  // shift keeps the ratio (the larger factor wins), alt scales about the centre
  r = G.scaleFromHandle(box, 'se', { x: 100, y: 25 }, { shift: true }); near(r.sx, 2); near(r.sy, 2)
  r = G.scaleFromHandle(box, 'se', { x: 50, y: 0 }, { alt: true }); assert.deepEqual(M.apply(r.M, 60, 45), [60, 45]); near(r.sx, (50 + 50) / 50)
  // an edge handle scales one axis, with shift both
  r = G.scaleFromHandle(box, 'e', { x: 50, y: 99 }); near(r.sx, 1.5); near(r.sy, 1)
  r = G.scaleFromHandle(box, 's', { x: 0, y: 25 }, { shift: true }); near(r.sy, 1.5); near(r.sx, 1.5)
  // past the opposite edge mirrors; never collapses to zero
  r = G.scaleFromHandle(box, 'e', { x: -150, y: 0 }); assert.ok(r.sx < 0)
  r = G.scaleFromHandle(box, 'e', { x: -100, y: 0 }); assert.ok(Math.abs(r.sx) >= 1e-3 && Number.isFinite(r.M[0]))
  // rotate carries the pointer round the pivot; Ctrl steps are 15 degrees
  const piv = { x: 0, y: 0 }
  r = G.rotateFrom(piv, { x: 10, y: 0 }, { x: 0, y: 10 }); near(r.angle, Math.PI / 2); const q = M.apply(r.M, 10, 0); near(q[0], 0, 1e-9); near(q[1], 10, 1e-9)
  r = G.rotateFrom(piv, { x: 10, y: 0 }, { x: 10, y: 1 }, { step: G.DEG15 }); near(r.angle, 0)
  r = G.rotateFrom(piv, { x: 10, y: 0 }, { x: 10, y: 8 }, { step: G.DEG15 }); near(r.angle / G.DEG15, Math.round(r.angle / G.DEG15))
  // skew: the dragged edge moves by exactly the pointer distance, the pivot line stays put
  const c = { x: 60, y: 45 }
  let s = G.skewFromHandle(box, 'n', c, { x: 25, y: 0 }); const top = M.apply(s.M, 60, 20); near(top[0], 85); near(top[1], 20); assert.deepEqual(M.apply(s.M, 60, 45).map((v) => +v.toFixed(9)), [60, 45])
  s = G.skewFromHandle(box, 'e', c, { x: 0, y: -10 }); const right = M.apply(s.M, 110, 45); near(right[0], 110); near(right[1], 35)
  assert.equal(G.skewFromHandle(box, 'n', { x: 60, y: 20 }, { x: 5, y: 0 }), null)
  assert.deepEqual(G.constrainMove(10, 3), { dx: 10, dy: 0 }); assert.deepEqual(G.constrainMove(2, -9), { dx: 0, dy: -9 })
  assert.equal(G.hitHandle({ x: 0, y: 0, w: 100, h: 100 }, G.HANDLE_IDS, { x: 3, y: 4 }, 8), 'nw'); assert.equal(G.hitHandle({ x: 0, y: 0, w: 100, h: 100 }, G.HANDLE_IDS, { x: 50, y: 50 }, 8), null)
  const quad = Ops.boxQuad(box, M.translate(5, 5)); assert.deepEqual(quad[0], [15, 25]); assert.deepEqual(quad[2], [115, 75])
})
await t('sel: locked (node, layer, parent group), editable and top ids, selection box, tab order', () => {
  const s0 = S.createStore(opsRoot())
  const boxOf = H.createBoxer(() => null)
  s0.setSel([10, 11, 13])
  assert.deepEqual(Sel.topIds(s0, [10, 11, 13]), [10, 13])
  boxNear(Sel.selectionBox(s0, boxOf, [10, 13]), 0, 0, 50, 10)
  assert.deepEqual(Sel.tabOrder(s0), [10, 13, 14, 15])
  s0.tx('lock', (r) => Ops.setFlag(r, [13], 'locked', true))
  assert.equal(Sel.isLocked(s0, 11), true, 'a child of a locked group is locked'); assert.equal(Sel.isLocked(s0, 10), false)
  assert.deepEqual(Sel.editableIds(s0, [10, 11, 13]), [10])
  s0.tx('lock layer', (r) => Ops.setLayerFlag(r, 900, 'locked', true))
  assert.equal(Sel.isLocked(s0, 15), true); assert.deepEqual(Sel.tabOrder(s0), [10, 14])
  const st = Sel.selectionStyle(s0); assert.ok(st === Sel.selectionStyle(s0), 'the summary is cached per root and selection')
})
await t('keys: new commands are unique, keyArgs only name keys the command owns, arrows carry their step', () => {
  const { dupes, map, args } = K.buildKeymap()
  assert.deepEqual(dupes, [])
  for (const c of K.COMMANDS) for (const k of Object.keys(c.keyArgs || {})) assert.ok(c.keys.includes(k), `${c.id}: keyArgs for ${k} but the key is not bound`)
  assert.equal(map.get('Left'), 'object.nudgeLeft'); assert.deepEqual(args.get('Shift+Left'), { step: 10 }); assert.deepEqual(args.get('Ctrl+Up'), { step: 0.1 })
  for (const k of ['Ctrl+G', 'Ctrl+U', 'Ctrl+Shift+U', 'Ctrl+D', 'Delete', 'Backspace', 'Tab', 'Shift+Tab', 'Ctrl+]', 'Ctrl+Shift+]', 'Shift+PageUp', 'Ctrl+PageUp', 'F11', 'Shift+F12', 'Ctrl+F3', 'Alt+Z']) assert.ok(map.has(k), `${k} is bound`)
  assert.equal(K.normalizeKey({ key: ']', code: 'BracketRight', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+]'); assert.equal(K.normalizeKey({ key: 'ArrowLeft', shiftKey: true }), 'Shift+Left'); assert.equal(K.normalizeKey({ key: 'Tab', shiftKey: true }), 'Shift+Tab')
})
await t('palette data: default swatches, used colours counted, hex validation for style values', () => {
  assert.ok(C.DEFAULT_PALETTE.length >= 90)
  const root = opsRoot()
  const used = C.usedColors(root, root.pages[0].id)
  assert.equal(used.find((u) => u.hex === '#ff0000').count, 5)
  assert.equal(C.normHex('red;background:url(x)'), null)
})

// ---------- E6 to E8: page operations, text properties, convert to curves, autosave, save and export ----------
const Pers = await imp('_ds-persist.js')
const Save = await imp('_ds-save.js')
const textNode = (id, extra = {}) => ({ id, t: 'text', str: 'Hello', family: 'Inter', size: 20, bold: false, italic: false, fill: '#000000', opacity: 1, m: [1, 0, 0, 1, 10, 30], lh: 1.2, align: 'left', ...extra })

await t('pages: add, duplicate, delete, move, rename, resize, presets (frozen input, sharing, guards)', () => {
  const root = opsRoot()
  const out = {}
  const a = Ops.addPage(root, newId, { afterId: root.pages[0].id, out })
  assert.equal(a.pages.length, 2); assert.equal(a.pages[0], root.pages[0]); assert.equal(a.pages[1].id, out.id)
  assert.equal(a.pages[1].name, 'Page 2'); assert.equal(a.pages[1].w, 200); assert.equal(a.pages[1].h, 100); assert.equal(a.pages[1].layers.length, 1)
  assert.equal(Ops.addPage(root, newId, { beforeId: root.pages[0].id }).pages[1], root.pages[0], 'before puts the new page first')
  const big = Ops.addPage(root, newId, { w: 1e9, h: -5 })
  assert.ok(big.pages[1].w <= D.LIMITS.pageSize && big.pages[1].h >= 1)
  let many = root
  for (let i = 0; i < D.LIMITS.pages + 5; i++) many = Ops.addPage(many, newId)
  assert.equal(many.pages.length, D.LIMITS.pages, 'a drawing holds at most 300 pages')
  assert.equal(Ops.addPage(many, newId), many)
  // duplicate: fresh ids everywhere, pictures share assets, name gets "copy"
  const withImg = { ...root, pages: [{ ...root.pages[0], guides: [{ id: 77, axis: 'h', pos: 10 }], layers: [{ ...root.pages[0].layers[0], items: [...root.pages[0].layers[0].items, { id: 99, t: 'image', asset: 'a1', w: 2, h: 2, m: [5, 0, 0, 5, 0, 0], opacity: 1 }] }, root.pages[0].layers[1]] }] }
  const d = Ops.duplicatePage(withImg, withImg.pages[0].id, newId, { out })
  assert.equal(d.pages.length, 2); assert.equal(d.pages[1].name, 'Page 1 copy')
  const idsOf = (p) => { const s = []; D.walkNodes({ pages: [p] }, (n) => s.push(n.id)); return s }
  const a1 = idsOf(d.pages[0]), a2 = idsOf(d.pages[1])
  assert.equal(a1.length, a2.length); assert.ok(a2.every((i) => !a1.includes(i)), 'fresh node ids'); assert.notEqual(d.pages[1].layers[0].id, d.pages[0].layers[0].id)
  assert.equal(d.pages[1].layers[0].items.at(-1).asset, 'a1'); assert.notEqual(d.pages[1].guides[0].id, 77)
  const pend = { ...root, pages: [{ ...root.pages[0], pending: { n: 2 } }, { ...root.pages[0], id: 50 }] }
  assert.equal(Ops.duplicatePage(pend, pend.pages[0].id, newId), pend, 'a page still being read is never copied')
  assert.equal(Ops.deletePage(pend, pend.pages[0].id), pend); assert.equal(Ops.setPageSize(pend, null, 10, 10).pages[0], pend.pages[0])
  assert.equal(Ops.renamePage(pend, pend.pages[0].id, 'x'), pend)
  // delete and move
  assert.equal(Ops.deletePage(root, root.pages[0].id), root, 'the last page stays')
  const three = Ops.addPage(Ops.addPage(root, newId), newId)
  const del = Ops.deletePage(three, three.pages[1].id)
  assert.equal(del.pages.length, 2); assert.equal(del.pages[0], three.pages[0]); assert.equal(del.pages[1], three.pages[2])
  const mv = Ops.movePage(three, three.pages[0].id, 2)
  assert.deepEqual(mv.pages.map((p) => p.id), [three.pages[1].id, three.pages[2].id, three.pages[0].id])
  assert.equal(Ops.movePage(three, three.pages[0].id, 0), three); assert.equal(Ops.movePage(three, three.pages[0].id, NaN), three)
  assert.equal(Ops.movePage(three, three.pages[0].id, 99).pages[2], three.pages[0], 'clamped to the end')
  // rename
  assert.equal(Ops.renamePage(root, root.pages[0].id, '  Cover\u0000 ').pages[0].name, 'Cover'); assert.equal(Ops.renamePage(root, root.pages[0].id, '   '), root)
  assert.equal(Ops.renamePage(root, root.pages[0].id, 'x'.repeat(500)).pages[0].name.length, 200); assert.equal(Ops.renamePage(root, root.pages[0].id, 'Page 1'), root)
  // page size: objects keep their distance from the BOTTOM edge, horizontal guides move with them
  const g = { ...root, pages: [{ ...root.pages[0], guides: [{ id: 5, axis: 'h', pos: 20 }, { id: 6, axis: 'v', pos: 20 }] }] }
  const tall = Ops.setPageSize(g, [g.pages[0].id], 200, 300)
  assert.equal(tall.pages[0].h, 300); boxNear(bbox(tall.pages[0].layers[0].items[0]), 0, 200, 10, 10)
  assert.deepEqual(tall.pages[0].guides.map((x) => x.pos), [220, 20])
  assert.equal(Ops.setPageSize(root, null, 200, 100), root); assert.equal(Ops.setPageSize(root, null, NaN, 5), root)
  const wide = Ops.setPageSize(root, null, 400, 100); assert.equal(wide.pages[0].w, 400); assert.equal(wide.pages[0].layers[0], root.pages[0].layers[0], 'same height: nothing moves')
  assert.equal(Ops.setPageSize(root, null, 1e9, 1e9).pages[0].w, D.LIMITS.pageSize)
  const other = Ops.setPageSize({ ...three }, [three.pages[1].id], 10, 10)
  assert.equal(other.pages[0], three.pages[0]); assert.equal(other.pages[1].w, 10)
  // presets
  assert.deepEqual(D.pagePreset(595.28, 841.89), { name: 'A4', landscape: false }); assert.deepEqual(D.pagePreset(841.89, 595.28), { name: 'A4', landscape: true })
  assert.deepEqual(D.pagePreset(612, 792), { name: 'Letter', landscape: false }); assert.equal(D.pagePreset(500, 500), null)
  assert.deepEqual(D.presetSize('A3', true), [1190.55, 841.89]); assert.equal(D.presetSize('Nope'), null)
  for (const name of ['A3', 'A4', 'A5', 'Letter', 'Legal', 'Tabloid']) for (const l of [false, true]) assert.deepEqual(D.pagePreset(...D.presetSize(name, l)), { name, landscape: l })
})

await t('store: page operations undo and redo exactly, and the current page follows its id', () => {
  const store = S.createStore(opsRoot())
  const r0 = store.root
  const out = {}
  store.tx('Insert page', (r) => Ops.addPage(r, store.newId, { afterId: r.pages[0].id, out }), { get page() { return out.id } })
  assert.equal(store.root.pages.length, 2); assert.equal(store.pageIndex, 1, 'the new page is shown')
  store.tx('Move page', (r) => Ops.movePage(r, out.id, 0))
  assert.equal(store.pageIndex, 0, 'the page being shown moved with its id')
  store.tx('Rename page', (r) => Ops.renamePage(r, out.id, 'Back'))
  store.tx('Page size', (r) => Ops.setPageSize(r, [out.id], 100, 100), { merge: 'page-size' })
  store.tx('Page size', (r) => Ops.setPageSize(r, [out.id], 120, 100), { merge: 'page-size' })
  assert.equal(store.historyLength, 4, 'typing a size twice is one undo step')
  store.tx('Delete page', (r) => Ops.deletePage(r, out.id))
  assert.equal(store.root.pages.length, 1)
  for (let i = 0; i < 5; i++) assert.ok(store.undo())
  assert.equal(store.root, r0); assert.equal(store.undo(), false)
  for (let i = 0; i < 5; i++) store.redo()
  assert.equal(store.root.pages.length, 1)
})

await t('text ops: setTextProps (size scales glyphs, bold drops them, font keys, alignment keeps the text in place), toCurves', () => {
  const g = textNode(2, { font: 'f1', glyphs: [{ c: 'H', x: 0 }, { c: 'i', x: 10 }] })
  const root0 = opsRoot()
  const root = deepFreeze({ ...root0, fonts: { f1: { name: 'F', family: 'Foo', bold: false, italic: false, data: null } }, pages: [{ ...root0.pages[0], layers: [{ ...root0.pages[0].layers[0], items: [textNode(1), g, { id: 3, t: 'group', name: 'G', items: [textNode(4), path(5, 0, 0)] }] }, root0.pages[0].layers[1]] }] })
  const all = [1, 2, 3]
  const f = (r, id) => D.findNode(r, id).node
  const big = Ops.setTextProps(root, all, { size: 40 })
  assert.equal(f(big, 1).size, 40); assert.equal(f(big, 4).size, 40, 'groups are searched'); assert.deepEqual(f(big, 2).glyphs.map((x) => x.x), [0, 20], 'exact glyph positions scale with the size')
  assert.equal(f(big, 5), f(root, 5), 'paths are untouched')
  assert.equal(Ops.setTextProps(root, all, { size: 20 }), root, 'nothing changed means the same root'); assert.equal(Ops.setTextProps(root, all, { size: -3 }), root)
  assert.equal(f(Ops.setTextProps(root, all, { size: 1e9 }), 1).size, D.LIMITS.size)
  const bold = Ops.setTextProps(root, [2], { bold: true })
  assert.equal(f(bold, 2).bold, true); assert.equal(f(bold, 2).glyphs, undefined, 'a letter-shape change turns exact positions into plain text'); assert.equal(f(bold, 2).font, 'f1', 'the embedded font stays the first choice')
  const fam = Ops.setTextProps(root, [2], { family: 'Noto Serif', font: undefined })
  assert.equal(f(fam, 2).family, 'Noto Serif'); assert.ok(!('font' in f(fam, 2)))
  const emb = Ops.setTextProps(root, [1], { family: 'Foo', font: 'f1' })
  assert.equal(f(emb, 1).font, 'f1')
  assert.equal(f(Ops.setTextProps(root, [1], { lh: 99 }), 1).lh, 10); assert.equal(f(Ops.setTextProps(root, [1], { lh: 0.1 }), 1).lh, 0.5)
  const al = Ops.setTextProps(root, [1], { align: 'center' }, { widthOf: () => 40 })
  assert.equal(f(al, 1).align, 'center'); near(f(al, 1).m[4], 30, 1e-9, 'the origin moves to the centre of the line, so the text stays where it was')
  const back = Ops.setTextProps(al, [1], { align: 'left' }, { widthOf: () => 40 }); near(f(back, 1).m[4], 10, 1e-9)
  const right = Ops.setTextProps(root, [1], { align: 'right' }, { widthOf: () => 40 }); near(f(right, 1).m[4], 50, 1e-9)
  assert.equal(Ops.setTextProps(root, [1], { align: 'sideways' }), root)
  // convert to curves
  const made = new Map([[1, path(1, 10, 10, 5, 5)], [4, path(4, 0, 0, 2, 2)]])
  const curved = Ops.toCurves(root, all, made)
  assert.equal(f(curved, 1).t, 'path'); assert.equal(f(curved, 4).t, 'path'); assert.equal(f(curved, 2).t, 'text', 'text with no outline stays text')
  assert.equal(f(curved, 5), f(root, 5)); assert.equal(Ops.toCurves(root, [5]), root)
  const shaped = deepFreeze({ ...root, pages: [{ ...root.pages[0], layers: [{ ...root.pages[0].layers[0], items: [path(7, 0, 0, 10, 10, { shape: { k: 'rect', w: 10, h: 10, rx: 0, ry: 0 }, sm: [1, 0, 0, 1, 0, 0] })] }] }] })
  const sc = Ops.toCurves(shaped, [7], new Map())
  assert.ok(!('shape' in f(sc, 7)) && !('sm' in f(sc, 7))); assert.deepEqual(f(sc, 7).d, f(shaped, 7).d, 'the curve itself is unchanged')
})

/** A tiny in-memory stand-in for lib/idb.js. */
const fakeKv = () => { const m = new Map(); return { m, get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); return true }, del: async (k) => m.delete(k), keys: async (p = '') => [...m.keys()].filter((k) => k.startsWith(p)) } }
const fakeAssets = () => { const items = new Map([['a1', { blob: { size: 3 }, w: 2, h: 2, name: 'x.png' }]]); return { items, has: (id) => items.has(id), serialize: (ids) => ids.filter((i) => items.has(i)).map((id) => ({ id, ...items.get(id) })), restored: [], async restore(list) { this.restored.push(...list.map((a) => a.id)) } } }
const imgRoot = () => { const r = opsRoot(); return { ...r, title: 'Saved', pages: [{ ...r.pages[0], layers: [{ ...r.pages[0].layers[0], items: [...r.pages[0].layers[0].items, { id: 90, t: 'image', asset: 'a1', w: 2, h: 2, m: [5, 0, 0, 5, 0, 0], opacity: 1 }, textNode(91, { font: 'f9', glyphs: [{ c: 'H', x: 0 }] })] }, r.pages[0].layers[1]] }], fonts: { f9: { name: 'F9', family: 'Nine', bold: false, italic: false, data: new Uint8Array([1, 2, 3, 4]) } } } }

await t('autosave: only dirty drawings are written, pictures and fonts once, restore goes through validateDoc', async () => {
  const kv = fakeKv(), assets = fakeAssets()
  const store = S.createStore(imgRoot())
  const persist = Pers.createPersist({ store, assets, delay: 5, idb: kv })
  persist.start()
  await persist.flush()
  assert.equal(kv.m.size, 0, 'a drawing with no changes is not written')
  store.tx('Move', (r) => Ops.transformIds(r, [10], M.translate(5, 5)))
  await persist.flush()
  assert.deepEqual([...kv.m.keys()].sort(), ['ds:autosave:a:a1', 'ds:autosave:doc', 'ds:autosave:fonts'])
  const rec = kv.m.get('ds:autosave:doc')
  assert.equal(rec.v, 1); assert.equal(rec.title, 'Saved'); assert.deepEqual(rec.assetIds, ['a1']); assert.equal(rec.root.fonts.f9.data, null, 'font bytes live under their own key')
  assert.equal(kv.m.get('ds:autosave:fonts')[0].data.length, 4)
  const picWrites = []; const set0 = kv.set; kv.set = async (k, v) => { picWrites.push(k); return set0(k, v) }
  store.tx('Move again', (r) => Ops.transformIds(r, [10], M.translate(1, 1)))
  await persist.flush()
  assert.deepEqual(picWrites, ['ds:autosave:doc'], 'pictures and fonts are not rewritten')
  const info = await persist.peek(); assert.equal(info.title, 'Saved'); assert.equal(info.pages, 1)
  const { doc, notes } = await persist.restore()
  assert.deepEqual(assets.restored, ['a1']); assert.deepEqual(notes, [])
  assert.equal(doc.pages.length, 1); assert.deepEqual(D.findNode(doc, 10).node.d, D.findNode(store.root, 10).node.d, 'the edit came back')
  assert.equal(D.findNode(doc, 90).node.asset, 'a1'); assert.equal(doc.fonts.f9.data.length, 4); assert.equal(D.findNode(doc, 91).node.glyphs.length, 1)
  assert.equal(doc.uid, store.root.uid)
  // while a PDF page is still being read nothing is written
  const kv2 = fakeKv(), s2 = S.createStore(imgRoot())
  const p2 = Pers.createPersist({ store: s2, assets: fakeAssets(), delay: 5, idb: kv2 }); p2.start()
  s2.tx('Move', (r) => Ops.transformIds(r, [10], M.translate(5, 5)))
  s2.silent((r) => { r.pages[0].pending = { n: 2 } })
  await p2.flush(); assert.equal(kv2.m.size, 0)
  delete s2.root.pages[0].pending
  await p2.flush(); assert.ok(kv2.m.has('ds:autosave:doc'))
  // a saved file needs no autosave copy
  await p2.saved(); assert.equal(kv2.m.size, 0)
  assert.ok(Pers.estimateBytes(imgRoot()) > 1000); assert.deepEqual([...Pers.assetIdsOf(imgRoot())], ['a1'])
  persist.dispose(); p2.dispose()
})

await t('autosave: restoring next to pictures already in use gives the restored ones new ids and maps the document through them', async () => {
  const A = await imp('_ds-assets.js')
  const png = (n) => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])])
  const kv = fakeKv()
  await kv.set('ds:autosave:doc', { v: 1, savedAt: 1, title: 'Saved', pages: 1, assetIds: ['a1'], root: { ...Pers.packRoot(imgRoot()), nextId: 2000 } })
  await kv.set('ds:autosave:a:a1', { id: 'a1', blob: png(7), w: 2, h: 2, name: 'stored.png' })
  const assets = A.createAssets()
  const used = await assets.restore([{ id: 'a1', blob: png(1), w: 9, h: 9, name: 'in use' }]) // a picture of the drawing that is open now
  assert.deepEqual([...used], [['a1', 'a1']])
  const persist = Pers.createPersist({ store: S.createStore(opsRoot()), assets, idb: kv })
  const { doc } = await persist.restore()
  const img = D.findNode(doc, 90).node
  assert.equal(img.asset, 'a2', 'the stored picture got a fresh id'); assert.deepEqual(assets.dims('a1'), { w: 9, h: 9 }, 'the picture in use was not overwritten'); assert.deepEqual(assets.dims('a2'), { w: 2, h: 2 })
  const again = await assets.restore([{ id: 'a7', blob: png(3), w: 1, h: 1 }, { id: 'zz', blob: new Blob(['not an image']), w: 1, h: 1 }])
  assert.deepEqual([...again], [['a7', 'a7']], 'a stored file that is not a picture is ignored')
})

await t('autosave: a poisoned or damaged record is cleaned or refused with a plain message', async () => {
  const kv = fakeKv(), assets = fakeAssets(), store = S.createStore(opsRoot())
  const persist = Pers.createPersist({ store, assets, idb: kv })
  assert.equal(await persist.peek(), null)
  await kv.set('ds:autosave:doc', 'hello'); assert.deepEqual(await persist.peek(), { bad: true })
  await assert.rejects(() => persist.restore(), /could not be read/)
  await kv.set('ds:autosave:doc', { v: 2, root: {} }); assert.deepEqual(await persist.peek(), { bad: true })
  await kv.set('ds:autosave:doc', { v: 1, root: { pages: 'nope' } }); await assert.rejects(() => persist.restore(), /could not be read/)
  const evil = JSON.parse('{"v":1,"savedAt":1,"title":"<img src=x onerror=alert(1)>","pages":1,"assetIds":["../x",5,"a1","__proto__"],"root":{"title":"<b>x</b>","units":"furlongs","uid":"A B","fonts":{"__proto__":{"data":null},"bad key!":{},"f1":{"family":"A\\"};x","name":5}},"pages":[{"id":1,"name":"<img onerror=alert(1)>","w":"wide","h":1e99,"layers":[{"id":2,"name":"L","items":[{"t":"path","d":"<svg onload=alert(1)>","fill":"red;background:url(x)"},{"t":"path","d":[["M",0,0],["L",5,"NaN"],["L",9,9],["Z"]],"fill":"red;background:url(x)","stroke":"javascript:alert(1)","strokeWidth":1e99},{"t":"text","str":"ok","family":"<b>x</b>","fill":"url(javascript:alert(1))","font":"__proto__","glyphs":[{"c":"ab","x":1}]},{"t":"image","asset":"../../etc","w":1,"h":1,"m":[1,0,0,1,0,0]},{"t":"script","src":"x"}]}]}]}}')
  await kv.set('ds:autosave:doc', evil)
  const { doc, notes } = await persist.restore()
  assert.ok(notes.length >= 1 && notes.some((n) => /skipped/.test(n)), `a note says items were skipped: ${notes}`)
  assert.equal(doc.units, 'mm'); assert.ok(/^[a-z0-9]{4,16}$/.test(doc.uid)); assert.ok(doc.pages[0].w <= D.LIMITS.pageSize && doc.pages[0].h <= D.LIMITS.pageSize)
  const items = doc.pages[0].layers[0].items
  assert.ok(items.every((n) => ['path', 'text'].includes(n.t)), 'unknown types and bad pictures are gone')
  const p = items.find((n) => n.t === 'path'); assert.ok(p.fill === null && p.stroke === null, 'colours are validated'); assert.ok(p.d.every((c) => c.slice(1).every(Number.isFinite)))
  const tx = items.find((n) => n.t === 'text'); assert.ok(!/[<>]/.test(tx.family) && tx.fill === '#000000' && !('font' in tx) && !('glyphs' in tx))
  assert.deepEqual(Object.keys(doc.fonts), ['f1']); assert.ok(!/["\\;]/.test(doc.fonts.f1.family))
  assert.equal(Object.getPrototypeOf(doc.fonts), Object.prototype)
  assert.deepEqual(assets.restored, [], 'asset ids that are not plain keys are never read')
})

await t('save: toWriterDoc builds a flat doc for most formats and a tree for CDR (hidden dropped, editor fields stripped, text outlined or baked)', async () => {
  const r0 = imgRoot()
  const L0 = r0.pages[0].layers[0]
  const items = [
    path(20, 0, 0, 10, 10, { shape: { k: 'rect', w: 10, h: 10, rx: 0, ry: 0 }, sm: [1, 0, 0, 1, 0, 0], fillK: [0, 1, 1, 0], rot: 10, src: 4 }),
    path(21, 20, 0, 10, 10, { hidden: true }),
    { id: 22, t: 'group', name: 'Grp', items: [path(23, 40, 0), textNode(24, { str: 'one\ntwo', align: 'center', size: 10 })] },
    { id: 25, t: 'image', asset: 'a1', w: 2, h: 2, m: [5, 0, 0, 5, 0, 0], opacity: 1 },
    textNode(26, { str: 'plain' }),
    textNode(27, { str: 'g', font: 'f9', glyphs: [{ c: 'g', x: 0 }] }),
  ]
  const root = deepFreeze({ ...r0, pages: [{ ...r0.pages[0], guides: [{ id: 8, axis: 'v', pos: 30 }], layers: [{ ...L0, items }, { ...r0.pages[0].layers[1], hidden: true, items: [path(30, 1, 1)] }, { id: 901, name: 'Guides', hidden: false, locked: true, printable: false, items: [path(31, 2, 2)] }] }, { ...r0.pages[0], id: 60, name: 'Second', layers: [{ id: 61, name: 'L', hidden: false, locked: false, printable: true, items: [path(62, 0, 0)] }] }], fonts: { ...r0.fonts, f2: { name: 'Unused', family: 'U', bold: false, italic: false, data: null } } })
  let urlsAsked = null
  const assets = { ensureDataUrls: async (ids) => { urlsAsked = [...ids] }, dataUrl: (id) => (id === 'a1' ? 'data:image/png;base64,AAAA' : null) }
  const measurer = (n) => (s) => s.length * n.size * 0.5
  // flat, text stays text (outline off): lines baked, alignment baked into m
  const flat = await Save.toWriterDoc(root, { assets, outline: false, measurer })
  assert.deepEqual(urlsAsked, ['a1']); assert.equal(flat.doc.pages.length, 2)
  const fi = flat.doc.pages[0].items
  assert.deepEqual(fi.map((n) => n.id), [20, 23, 24, undefined, 25, 26, 27], 'hidden objects, hidden and non-printable layers are gone, groups dissolved, the second line of a text has no id')
  for (const k of ['shape', 'sm', 'fillK', 'rot', 'src', 'asset']) assert.ok(fi.every((n) => !(k in n)), `${k} is stripped`)
  assert.equal(fi.find((n) => n.t === 'image').href, 'data:image/png;base64,AAAA')
  const lines = fi.filter((n) => n.t === 'text' && n.str !== 'plain' && n.str !== 'g')
  assert.deepEqual(lines.map((n) => n.str), ['one', 'two']); assert.ok(lines.every((n) => !('lh' in n) && !('align' in n)))
  assert.deepEqual(lines[0].m, M.mul([1, 0, 0, 1, 10, 30], M.translate(-7.5, 0)), 'a centred line starts half its width to the left of the origin (3 letters x 5 pt)')
  assert.deepEqual(lines[1].m, M.mul([1, 0, 0, 1, 10, 30], M.translate(-7.5, 12)), 'the second line sits one line height lower')
  assert.deepEqual(Object.keys(flat.doc.fonts), ['f9'], 'only fonts that text still uses are kept'); assert.ok(flat.notes.some((n) => /hidden/.test(n)))
  assert.ok(!('layers' in flat.doc.pages[0]) && !('guides' in flat.doc.pages[0]))
  // outline on: every text becomes a path through the outliner; kept text is reported
  const outliner = async (nodes) => ({ map: new Map(nodes.filter((n) => n.str !== 'plain').map((n) => [n.id, path(n.id, 0, 0, 3, 3)])), kept: 1 })
  const out = await Save.toWriterDoc(root, { assets, outline: true, outliner, measurer })
  const oi = out.doc.pages[0].items
  assert.equal(oi.filter((n) => n.t === 'text').length, 1, 'only the text the outliner kept stays text'); assert.ok(out.notes.some((n) => /1 text object uses characters/.test(n)))
  assert.ok(oi.some((n) => n.id === 24 && n.t === 'path'))
  // tree for CDR: layers, flags, groups and ids kept, hidden objects dropped, guides passed on
  const tr = await Save.toWriterDoc(root, { assets, outline: false, flat: false, pages: [0], measurer })
  const p = tr.doc.pages[0]
  assert.equal(tr.doc.pages.length, 1); assert.deepEqual(p.layers.map((l) => [l.name, l.hidden, l.locked, l.printable]), [[L0.name, false, false, true], ['Layer B', true, false, true], ['Guides', false, true, false]])
  assert.equal(p.layers[0].items.find((n) => n.t === 'group').name, 'Grp'); assert.ok(p.layers[0].items.every((n) => n.id !== 21)); assert.deepEqual(p.guides, [{ axis: 'v', pos: 30 }])
  // selection only: a leaf, or everything inside a selected group
  const sel = await Save.toWriterDoc(root, { assets, outline: false, only: new Set([20, 22]), measurer })
  assert.deepEqual(sel.doc.pages[0].items.map((n) => n.id).filter((x) => x != null), [20, 23, 24])
  // pending pages and missing pictures
  await assert.rejects(() => Save.toWriterDoc({ ...root, pages: [{ ...root.pages[0], pending: { n: 1 } }] }, { assets }), /still being read/)
  const noPic = await Save.toWriterDoc(root, { assets: { ensureDataUrls: async () => {}, dataUrl: () => null }, outline: false, measurer })
  assert.ok(noPic.notes.some((n) => /picture/.test(n)) && noPic.doc.pages[0].items.every((n) => n.t !== 'image'))
  // the input was frozen: nothing was mutated, nothing shared mutably
})

await t('save: cropPage, formats table, option defaults, selection guards', async () => {
  const page = { w: 100, h: 100, name: 'P', items: [path(1, 30, 40, 10, 10)] }
  const c = Save.cropPage(page, { x: 30, y: 40, w: 10, h: 10 }, 2)
  assert.equal(c.w, 14); assert.equal(c.h, 14); boxNear(M.pathBBox(c.items[0].d), 2, 2, 10, 10)
  assert.equal(page.items[0].d[0][1], 30, 'the input page is untouched')
  assert.deepEqual(Object.keys(Save.FORMATS), ['cdr', 'ai', 'pdf', 'eps', 'svg', 'png', 'jpg'])
  assert.equal(Save.defaultsFor('svg').outline, false); assert.equal(Save.defaultsFor('cdr').outline, true); assert.equal(Save.defaultsFor('png').transparent, true); assert.equal(Save.defaultsFor('jpg').transparent, false)
  assert.equal(Save.defaultsFor('cdr').bitmapAlpha, 'rgba', 'CDR keeps picture transparency by default (the writer default of flatten gives white boxes)')
  const store = { whenReady: async () => {}, root: opsRoot(), pageIndex: 0, sel: { ids: [] }, find: () => null }
  await assert.rejects(() => Save.exportDoc('nope', {}, { store, assets: null }), /not available/)
  await assert.rejects(() => Save.exportDoc('png', { selection: true }, { store, assets: null }), /Select something first/)
  await assert.rejects(() => Save.exportDoc('pdf', { selection: true }, { store, assets: null }), /Only PNG, JPG and SVG/)
  // one export at a time (the picture data URLs are shared)
  let release
  const slow = { ...store, whenReady: () => new Promise((r) => { release = r }) }
  const first = Save.exportDoc('png', { selection: true }, { store: slow, assets: null }).catch((e) => e)
  await assert.rejects(() => Save.exportDoc('png', {}, { store, assets: null }), /Another save or export is still running/)
  release(); assert.match(String((await first).message), /Select something first/)
  await assert.rejects(() => Save.exportDoc('png', { selection: true }, { store, assets: null }), /Select something first/, 'the lock is released afterwards')
})

await t('text model: the bundled stand-in family and the font stack that uses it (screen and curves export agree on a missing letter)', () => {
  assert.equal(T.bundledFor('Times New Roman'), 'Noto Serif'); assert.equal(T.bundledFor('Courier New'), 'Roboto Mono'); assert.equal(T.bundledFor('Arial'), 'Inter'); assert.equal(T.bundledFor(undefined), 'Inter')
  assert.equal(T.bundledFor('DejaVu Sans'), 'Inter', 'a name with "sans" is a sans family even when it says serif elsewhere')
  const st = T.fontStack({ font: 'f1', family: 'Georgia' }, { ok: () => true, family: () => 'ds9-f1' }, 'abc').split(',')
  assert.deepEqual(st.slice(0, 3), ['"ds9-f1"', '"Georgia"', '"Noto Serif"']); assert.equal(st.at(-1), 'serif')
  assert.ok(!T.fontStack({ family: 'A"};x{' }, null, 'u').includes('};'), 'hostile names stay quoted')
})

await t('keys: save, export, curves, text keys are bound and unique', () => {
  const { map } = K.buildKeymap()
  for (const [k, id] of [['Ctrl+S', 'file.save'], ['Ctrl+Shift+S', 'file.saveAs'], ['Ctrl+E', 'file.export'], ['Ctrl+Q', 'object.toCurves'], ['Ctrl+Alt+Q', 'object.toCurves'], ['F8', 'tool.text'], ['Enter', 'text.edit']]) assert.equal(map.get(k), id, k)
  assert.equal(K.normalizeKey({ key: 'q', code: 'KeyQ', ctrlKey: true, altKey: true }), 'Ctrl+Alt+Q'); assert.equal(K.normalizeKey({ key: 'Enter' }), 'Enter')
  const layout = K.menuTree().find((m) => m.menu === 'Layout').items.filter((i) => i.id).map((i) => i.id)
  for (const id of ['page.insertAfter', 'page.insertBefore', 'page.duplicate', 'page.delete', 'page.rename', 'page.moveLeft', 'page.moveRight', 'page.setup', 'page.orientation']) assert.ok(layout.includes(id), id)
})

// ---------- E9 and E10: path primitives, shapes, arrange operations, transform maths ----------
const OA = await imp('_ds-ops-arrange.js')
const XF = await imp('_ds-xform.js')
const BL = await imp('_ds-bool.js')
const bb = (d) => M.pathBBox(d)
/** Area of a path (curves sampled), for analytic checks. */
const areaOf = (d) => {
  let a = 0, cx = 0, cy = 0, sx = 0, sy = 0
  const edge = (x0, y0, x1, y1) => { a += x0 * y1 - x1 * y0 }
  for (const c of d) {
    if (c[0] === 'M') { cx = sx = c[1]; cy = sy = c[2] } else if (c[0] === 'L') { edge(cx, cy, c[1], c[2]); cx = c[1]; cy = c[2] }
    else if (c[0] === 'C') { let px = cx, py = cy; for (let i = 1; i <= 64; i++) { const t = i / 64, u = 1 - t; const x = u * u * u * cx + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5], y = u * u * u * cy + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6]; edge(px, py, x, y); px = x; py = y } cx = c[5]; cy = c[6] }
    else if (c[0] === 'Z') { edge(cx, cy, sx, sy); cx = sx; cy = sy }
  }
  return Math.abs(a / 2)
}
const draft = (pts, closed = false, nt) => ({ subs: [{ closed, pts: pts.map(([x, y, ix = 0, iy = 0, ox = 0, oy = 0]) => ({ x, y, ix, iy, ox, oy })) }], nt: [nt || pts.map(() => 'c')] })
const cross = (p) => Math.abs(p.ix * p.oy - p.iy * p.ox)

await t('path: dToSubs and subsToD round trip rectangles, rounded rectangles and ellipses (a closing curve is folded and written out again)', () => {
  const sq = M.rectPath(0, 0, 10, 20)
  assert.deepEqual(P.subsToD(P.dToSubs(sq)), sq)
  const rr = M.rectPath(0, 0, 100, 50, 10), el = M.ellipsePath(5, 5, 10, 6)
  for (const d of [rr, el]) { const back = P.subsToD(P.dToSubs(d)); assert.deepEqual(bb(back), bb(d)); near(areaOf(back), areaOf(d), 1e-6) }
  assert.equal(P.dToSubs(el)[0].pts.length, 4); assert.equal(P.dToSubs(el)[0].closed, true)
  assert.equal(P.dToSubs([['M', 1, 1]]).length, 0, 'a lone move is dropped')
  assert.deepEqual(P.subsToD(P.dToSubs([['M', 0, 0], ['L', 5, 5], ['M', 9, 9], ['L', 1, 9]])).map((c) => c[0]).join(''), 'MLML')
})
await t('path: inferType and makeDraft (stored node types are used only when they still fit the points)', () => {
  const d = P.dToSubs(M.ellipsePath(0, 0, 10, 10))[0].pts
  assert.equal(P.inferType(d[0]), 'y'); assert.equal(P.inferType({ x: 0, y: 0, ix: 0, iy: 0, ox: 0, oy: 0 }), 'c')
  assert.equal(P.inferType({ x: 0, y: 0, ix: -3, iy: 0, ox: 6, oy: 0 }), 's'); assert.equal(P.inferType({ x: 0, y: 0, ix: -3, iy: 0, ox: 3, oy: 3 }), 'c')
  const rect = { d: M.rectPath(0, 0, 10, 10) }
  assert.deepEqual(P.makeDraft(rect).nt, [['c', 'c', 'c', 'c']])
  assert.deepEqual(P.makeDraft({ ...rect, nt: [['s', 'y', 'c', 'c']] }).nt, [['s', 'y', 'c', 'c']])
  assert.deepEqual(P.makeDraft({ ...rect, nt: [['s']] }).nt, [['c', 'c', 'c', 'c']], 'a stale nt is ignored')
})
await t('path: add, delete, to line, to curve (counts, closed state, handles)', () => {
  let dr = draft([[0, 0], [10, 0], [10, 10]])
  const np = P.addNodes(dr, [[0, 0], [0, 1]])
  assert.deepEqual(np, [[0, 1]]); assert.equal(dr.subs[0].pts.length, 4); near(dr.subs[0].pts[1].x, 5); assert.equal(dr.nt[0].length, 4)
  dr = draft([[0, 0], [10, 0], [10, 10]])
  assert.equal(P.addNodes(dr, [[0, 2]]).length, 1, 'the last point of an open path has no segment after it, so the one before is used')
  assert.equal(dr.subs[0].pts.length, 4)
  dr = draft([[0, 0], [10, 0], [10, 10], [0, 10]], true)
  P.addNodes(dr, [[0, 3]]); assert.equal(dr.subs[0].pts.length, 5); assert.equal(dr.subs[0].closed, true, 'a node on the closing segment')
  assert.equal(P.deleteNodes(dr, [[0, 1], [0, 2]]), 2); assert.equal(dr.subs[0].pts.length, 3)
  P.deleteNodes(dr, [[0, 0], [0, 1]]); assert.equal(dr.subs.length, 0, 'fewer than two points: the sub-path goes away')
  const c = draft([[0, 0, 0, 0, 3, 3], [10, 0, -3, 3, 0, 0], [10, 10]])
  assert.equal(P.toLine(c, [[0, 0], [0, 1]]), 1); assert.equal(c.subs[0].pts[0].ox, 0); assert.equal(c.subs[0].pts[1].ix, 0)
  assert.equal(P.toLine(c, [[0, 0], [0, 1]]), 0, 'already straight')
  assert.equal(P.toCurve(c, [[0, 1]]), 1); near(c.subs[0].pts[1].ox, 0); near(c.subs[0].pts[2].ix, 0); near(c.subs[0].pts[1].oy, 10 / 3); near(c.subs[0].pts[2].iy, -10 / 3)
  assert.equal(P.toCurve(c, [[0, 1]]), 0)
})
await t('path: cusp, smooth and symmetrical (collinear, then equal length) and the handle partner rules', () => {
  const mk = () => draft([[0, 0], [10, 5, -3, -1, 4, 0], [20, 0]])
  let dr = mk()
  P.setNodeType(dr, [[0, 1]], 's')
  let p = dr.subs[0].pts[1]
  assert.ok(cross(p) < 1e-9 && p.ix * p.ox + p.iy * p.oy < 0, 'smooth: handles on one line, opposite sides')
  near(Math.hypot(p.ox, p.oy), 4, 1e-9); near(Math.hypot(p.ix, p.iy), Math.hypot(3, 1), 1e-9); assert.equal(dr.nt[0][1], 's')
  P.setNodeType(dr, [[0, 1]], 'y'); p = dr.subs[0].pts[1]
  assert.ok(cross(p) < 1e-9); near(Math.hypot(p.ox, p.oy), Math.hypot(p.ix, p.iy), 1e-9); near(Math.hypot(p.ox, p.oy), (4 + Math.hypot(3, 1)) / 2, 1e-9); assert.equal(dr.nt[0][1], 'y')
  P.setNodeType(dr, [[0, 1]], 'c'); assert.equal(dr.nt[0][1], 'c')
  // partner rules
  dr = mk(); P.moveHandle(dr, 0, 1, 'out', 10 + 0, 5 + 8)
  p = dr.subs[0].pts[1]; near(p.ox, 0); near(p.oy, 8); near(p.ix, -3); near(p.iy, -1) // cusp: only the dragged handle moves
  dr.nt[0][1] = 's'; P.moveHandle(dr, 0, 1, 'out', 10 + 6, 5 + 8); p = dr.subs[0].pts[1]
  near(Math.hypot(p.ix, p.iy), Math.hypot(3, 1), 1e-9); assert.ok(cross(p) < 1e-9 && p.ix * p.ox + p.iy * p.oy < 0, 'smooth keeps the other handle on the line and its length')
  dr.nt[0][1] = 'y'; P.moveHandle(dr, 0, 1, 'in', 10 - 2, 5 - 7); p = dr.subs[0].pts[1]
  near(p.ox, 2); near(p.oy, 7); near(p.ix, -2); near(p.iy, -7)
  P.moveNode(dr, 0, 1, 5, -5); assert.deepEqual([dr.subs[0].pts[1].x, dr.subs[0].pts[1].y], [15, 0]); near(dr.subs[0].pts[1].ox, 2)
})
await t('path: break, join, close, reverse (counts, closed state)', () => {
  let dr = draft([[0, 0], [10, 0], [20, 0], [30, 0]])
  assert.deepEqual(P.breakAt(dr, [[0, 0]]), [], 'an end cannot be broken')
  const out = P.breakAt(dr, [[0, 1]])
  assert.equal(dr.subs.length, 2); assert.deepEqual(dr.subs.map((s) => s.pts.length), [2, 3]); assert.deepEqual(out, [[0, 1], [1, 0]])
  assert.deepEqual(dr.nt.map((r) => r.length), [2, 3])
  // join the two halves again: the two end nodes meet in the middle
  const j = P.joinEnds(dr, [[0, 1], [1, 0]])
  assert.equal(dr.subs.length, 1); assert.equal(dr.subs[0].pts.length, 4); assert.deepEqual(j, [0, 1])
  // closed: break turns it into an open path with the node doubled
  dr = draft([[0, 0], [10, 0], [10, 10], [0, 10]], true)
  P.breakAt(dr, [[0, 2]])
  assert.equal(dr.subs[0].closed, false); assert.equal(dr.subs[0].pts.length, 5)
  assert.deepEqual([dr.subs[0].pts[0].x, dr.subs[0].pts[0].y], [dr.subs[0].pts[4].x, dr.subs[0].pts[4].y])
  // joining the two ends of one open path closes it
  dr = draft([[0, 0], [10, 0], [10, 10]])
  assert.equal(P.joinEnds(dr, [[0, 0], [0, 2]]) != null, true); assert.equal(dr.subs[0].closed, true); assert.equal(dr.subs[0].pts.length, 2)
  assert.equal(P.joinEnds(draft([[0, 0], [1, 1], [2, 2]]), [[0, 1], [0, 0]]), null, 'a middle node cannot be joined')
  // close
  dr = draft([[0, 0], [10, 0], [10, 10]])
  assert.equal(P.closeSub(dr, [[0, 1]]), 1); assert.equal(dr.subs[0].closed, true); assert.equal(P.closeSub(dr, []), 0)
  dr = draft([[0, 0], [10, 0], [10, 10], [0, 0]]); P.closeSub(dr); assert.equal(dr.subs[0].pts.length, 3, 'an end that already meets the start is folded')
  // reverse
  dr = draft([[0, 0, 0, 0, 5, 0], [10, 0, -5, 0, 0, 0], [10, 10]], false, ['c', 's', 'c'])
  const rp = P.reverseSub(dr, [[0, 0]])
  assert.deepEqual(dr.subs[0].pts.map((p) => [p.x, p.y]), [[10, 10], [10, 0], [0, 0]]); assert.deepEqual(rp, [[0, 2]]); assert.deepEqual(dr.nt[0], ['c', 's', 'c'])
  near(dr.subs[0].pts[1].ox, -5); near(dr.subs[0].pts[2].ix, 5)
})
await t('path: simplifyFreehand turns a noisy stroke into a few smooth curves', () => {
  const pts = Array.from({ length: 80 }, (_, i) => ({ x: i * 2, y: Math.sin(i / 12) * 20 + (i % 2) * 0.3 }))
  const d = P.simplifyFreehand(pts, 1.5)
  assert.ok(d.length >= 3 && d.length < 25 && d[0][0] === 'M' && d.slice(1).every((c) => c[0] === 'C' || c[0] === 'L'), `got ${d.length} commands`)
  assert.equal(d.at(-1)[0] === 'Z', false); assert.deepEqual(P.simplifyFreehand([{ x: 0, y: 0 }], 1), [])
  assert.equal(P.simplifyFreehand(pts, 1.5, true).at(-1)[0], 'Z')
})
await t('shapes: local paths, the parametric invariant after rotate, skew and scale, radius and sides edits, pie and arc', () => {
  const rect = { k: 'rect', w: 100, h: 50, rx: 10, ry: 10 }
  boxNear(bb(P.localPath(rect)), 0, 0, 100, 50)
  boxNear(bb(P.localPath({ k: 'ellipse', rx: 10, ry: 6 })), -10, -6, 20, 12)
  const hex = bb(P.localPath({ k: 'poly', n: 6, r: 10, rot: -Math.PI / 2 })); near(hex.h, 20, 1e-9); near(hex.w, 2 * 10 * Math.cos(Math.PI / 6), 1e-9)
  assert.equal(P.localPath({ k: 'star', n: 5, r1: 10, r2: 4 }).filter((c) => c[0] === 'L').length, 9)
  near(P.starSharpness({ r1: 10, r2: 4 }), 60, 0.5)
  const sm0 = M.translate(30, 40), node = { id: 1, t: 'path', d: P.shapeD(rect, sm0), shape: rect, sm: sm0, fill: '#ff0000', stroke: null, strokeWidth: 0 }
  const R = Ops.rotateAbout(Math.PI / 6, 50, 50), Sk = Ops.skewXAbout(0.4, 50), Sc = Ops.scaleAbout(1.5, 0.7, 10, 10)
  let cur = node
  for (const m of [R, Sk, Sc]) {
    cur = Ops.transformItem(cur, m)
    const want = P.shapeD(cur.shape, cur.sm)
    assert.equal(want.length, cur.d.length)
    cur.d.forEach((c, i) => c.slice(1).forEach((v, j) => near(v, want[i][j + 1], 1e-6)))
  }
  const edited = P.applyShape(cur, { ...cur.shape, rx: 0, ry: 0 })
  assert.equal(edited.d.length, 5); assert.deepEqual(edited.d.map((c) => c[0]).join(''), 'MLLLZ')
  const corners = [[0, 0], [100, 0], [100, 50], [0, 50]].map(([x, y]) => M.apply(cur.sm, x, y))
  edited.d.slice(0, 4).forEach((c, i) => { near(c[1], corners[i][0], 1e-6); near(c[2], corners[i][1], 1e-6) })
  assert.ok(!('nt' in edited)); assert.equal(P.shapeToCurves(cur).shape, undefined); assert.equal(P.shapeToCurves(cur).sm, undefined); assert.equal(P.shapeToCurves(cur).d, cur.d)
  // sides edit
  const poly = { k: 'poly', n: 5, r: 10, rot: -Math.PI / 2 }
  assert.equal(P.localPath({ ...poly, n: 8 }).length, 9)
  // pie and arc areas against the analytic values
  const circ = { k: 'ellipse', rx: 10, ry: 10 }
  near(areaOf(P.localPath(circ)) / (Math.PI * 100), 1, 1e-3)
  near(areaOf(P.localPath({ ...circ, a1: 0, a2: 90, pie: true })) / (Math.PI * 100 / 4), 1, 2e-3)
  near(areaOf(P.localPath({ ...circ, a1: 30, a2: 300, pie: true })) / (Math.PI * 100 * 270 / 360), 1, 2e-3)
  const arc = P.localPath({ ...circ, a1: 0, a2: 90 }); assert.equal(arc.at(-1)[0], 'C'); assert.equal(arc.some((c) => c[0] === 'Z'), false)
  near(arc[0][1], 10, 1e-9); near(arc[0][2], 0, 1e-9); near(arc.at(-1)[5], 0, 1e-6); near(arc.at(-1)[6], -10, 1e-6) // counter-clockwise on screen: from the right to the top
})

const miniRoot = (items) => { const doc = D.newDoc({ title: 't' }); return deepFreeze(D.insertAt(doc, doc.pages[0].layers[0].id, null, items)) }
const boxOfFn = H.createBoxer(() => null)
const nodeBox = (root, id) => boxOfFn(D.findNode(root, id).node)
await t('arrange: align left, right, top, bottom, centres and centre on page match hand-computed boxes', () => {
  const root = miniRoot([path(1, 0, 0, 10, 10), path(2, 30, 20, 20, 20), path(3, 100, 50, 10, 30)])
  const ids = [1, 2, 3], ref = { x: 0, y: 0, w: 110, h: 80 }
  const got = (mode, r = ref) => { const o = OA.align(root, ids, mode, r, boxOfFn); return ids.map((i) => { const b = nodeBox(o, i); return [b.x, b.y] }) }
  assert.deepEqual(got('left'), [[0, 0], [0, 20], [0, 50]])
  assert.deepEqual(got('right'), [[100, 0], [90, 20], [100, 50]])
  assert.deepEqual(got('top'), [[0, 0], [30, 0], [100, 0]])
  assert.deepEqual(got('bottom'), [[0, 70], [30, 60], [100, 50]])
  assert.deepEqual(got('centerH'), [[50, 0], [45, 20], [50, 50]])
  assert.deepEqual(got('centerV'), [[0, 35], [30, 30], [100, 25]])
  assert.deepEqual(got('center', { x: 0, y: 0, w: 200, h: 100 }), [[45, 10], [75, 30], [145, 60]])
  assert.equal(OA.align(root, [1], 'left', { x: 0, y: 0, w: 5, h: 5 }, boxOfFn), root, 'nothing to move returns the same root')
})
await t('arrange: distribute edges, centres and spacing over the selection or the page', () => {
  const root = miniRoot([path(1, 0, 0, 10, 10), path(2, 30, 20, 20, 20), path(3, 100, 50, 10, 30)])
  const xs = (o) => [1, 2, 3].map((i) => nodeBox(o, i).x), ys = (o) => [1, 2, 3].map((i) => nodeBox(o, i).y)
  assert.deepEqual(xs(OA.distribute(root, [1, 2, 3], 'left', boxOfFn)), [0, 50, 100])
  assert.deepEqual(xs(OA.distribute(root, [1, 2, 3], 'centerH', boxOfFn)), [0, 45, 100])
  assert.deepEqual(xs(OA.distribute(root, [1, 2, 3], 'right', boxOfFn)), [0, 40, 100])
  assert.deepEqual(xs(OA.distribute(root, [1, 2, 3], 'spaceH', boxOfFn)), [0, 45, 100])
  assert.deepEqual(xs(OA.distribute(root, [1, 2, 3], 'spaceH', boxOfFn, { x: 0, y: 0, w: 200, h: 100 })), [0, 90, 190])
  assert.deepEqual(ys(OA.distribute(root, [1, 2, 3], 'spaceV', boxOfFn)), [0, 20, 50])
  assert.equal(OA.distribute(root, [1, 2], 'spaceH', boxOfFn), root, 'two objects need a page to spread over')
  assert.notEqual(OA.distribute(root, [1, 2], 'spaceH', boxOfFn, { x: 0, y: 0, w: 100, h: 100 }), root)
})
await t('arrange: combine (even-odd, top-most look, group members), break apart, lock, clip', () => {
  const g = { id: 9, t: 'group', name: 'G', items: [path(10, 40, 0, 5, 5), path(11, 50, 0, 5, 5)] }
  const root = miniRoot([path(1, 0, 0, 10, 10, { fill: '#111111' }), path(2, 20, 0, 10, 10, { fill: '#222222', name: 'Two' }), g, { id: 20, t: 'text', str: 'x', family: 'A', size: 5, bold: false, italic: false, fill: '#000000', opacity: 1, m: [1, 0, 0, 1, 0, 0] }])
  const out = {}; let nextId = 100
  const r = OA.combine(root, [1, 2, 9], () => nextId++, { out })
  const items = r.pages[0].layers[0].items
  assert.equal(items.length, 2, 'three selected objects became one curve, the text is untouched'); assert.equal(out.id, 100)
  const c = items[0]; assert.equal(c.rule, 'evenodd'); assert.equal(c.fill, '#ff0000', 'the look of the top-most shape')
  assert.equal(c.d.filter((x) => x[0] === 'M').length, 4); assert.ok(!('name' in c))
  assert.equal(OA.combine(root, [1, 20], () => nextId++), root, 'text cannot be combined'); assert.equal(OA.combine(root, [1], () => nextId++), root)
  assert.equal(OA.combineBlocker([{ t: 'text' }]).includes('curves'), true); assert.equal(OA.combineBlocker([{ t: 'image' }]).includes('Pictures'), true); assert.equal(OA.combineBlocker([{ t: 'path' }]), '')
  // break apart
  const bo = { ids: [] }
  const b = OA.breakApart(r, [100], () => nextId++, { out: bo })
  const bitems = b.pages[0].layers[0].items
  assert.equal(bitems.length, 5); assert.equal(bo.ids.length, 4); assert.equal(bo.ids[0], 100, 'the first piece keeps the id')
  assert.ok(bitems.slice(0, 4).every((n) => n.d.filter((x) => x[0] === 'M').length === 1 && n.t === 'path'))
  assert.equal(OA.breakApart(root, [1], () => nextId++), root, 'a single contour has nothing to break')
  // unlock all
  const locked = deepFreeze(Ops.setFlag(Ops.setFlag(root, [1], 'locked', true), [10], 'locked', true))
  assert.equal(OA.countLocked(locked.pages[0]), 2)
  const un = OA.unlockAll(locked, locked.pages[0].id); assert.equal(OA.countLocked(un.pages[0]), 0); assert.equal(OA.unlockAll(un, un.pages[0].id), un)
  // clip: the contents share ONE clip object, the container stays, release removes it
  const cont = D.findNode(root, 1).node
  const cl = OA.clipInside(root, [1, 2, 9], cont)
  const leaves = Ops.leavesOf(cl.pages[0].layers[0].items)
  assert.equal(leaves.find((l) => l.id === 1).clip, undefined, 'the container itself is not clipped')
  const clipped = leaves.filter((l) => l.clip); assert.equal(clipped.length, 3); assert.ok(clipped.every((l) => l.clip[0] === clipped[0].clip[0]), 'one shared clip object')
  const rel = OA.releaseClip(cl, [2, 9]); assert.equal(Ops.leavesOf(rel.pages[0].layers[0].items).filter((l) => l.clip).length, 0); assert.equal(OA.hasClip([D.findNode(cl, 2).node]), true)
  assert.equal(OA.clipInside(root, [1, 2], { t: 'text' }), root)
})
await t('arrange: setShape changes radius, sides and star points through sm and returns the same node when nothing changes', () => {
  const rect = { k: 'rect', w: 100, h: 50, rx: 0, ry: 0 }, sm = M.translate(10, 10)
  const node = { id: 1, t: 'path', d: P.shapeD(rect, sm), shape: rect, sm, fill: '#ff0000', stroke: null, strokeWidth: 0 }
  const root = miniRoot([node])
  const r = OA.setShape(root, [1], 'rect', { rx: 8, ry: 8 })
  const n = r.pages[0].layers[0].items[0]; assert.equal(n.shape.rx, 8); assert.ok(n.d.some((c) => c[0] === 'C')); boxNear(bb(n.d), 10, 10, 100, 50)
  assert.equal(OA.setShape(r, [1], 'rect', { rx: 8, ry: 8 }), r); assert.equal(OA.setShape(root, [1], 'ellipse', { rx: 3 }), root, 'a different kind is left alone')
  const fn = OA.setShape(root, [1], 'rect', (s, m) => ({ rx: 5 / m[0], ry: 5 / m[0] })); assert.equal(fn.pages[0].layers[0].items[0].shape.rx, 5)
  const el = miniRoot([{ id: 2, t: 'path', d: P.shapeD({ k: 'ellipse', rx: 5, ry: 5, a1: 0, a2: 90 }, sm), shape: { k: 'ellipse', rx: 5, ry: 5, a1: 0, a2: 90, pie: true }, sm, fill: null, stroke: '#000000', strokeWidth: 1 }])
  const full = OA.setShape(el, [2], 'ellipse', { a1: undefined, a2: undefined, pie: undefined }).pages[0].layers[0].items[0]
  assert.deepEqual(full.shape, { k: 'ellipse', rx: 5, ry: 5 }); assert.equal(full.d.filter((c) => c[0] === 'C').length, 4)
})
await t('doc: parametric shapes and node types survive validateDoc (autosave restore), hostile shape data is neutralised', () => {
  const sm = M.translate(5, 6)
  const mk = (shape, extra = {}) => ({ id: 0, t: 'path', d: P.shapeD(shape, sm), shape, sm, fill: '#ff0000', stroke: null, ...extra })
  const raw = { pages: [{ w: 100, h: 100, layers: [{ name: 'L', items: [
    mk({ k: 'rect', w: 10, h: 5, rx: 2, ry: 2 }), mk({ k: 'ellipse', rx: 4, ry: 3, a1: 10, a2: 80, pie: true }), mk({ k: 'poly', n: 6, r: 5, rot: -1.5 }), mk({ k: 'star', n: 7, r1: 5, r2: 2, rot: -1.5 }),
    { id: 0, t: 'path', d: M.rectPath(0, 0, 4, 4), nt: [['s', 'y', 'c', 'x']] }, mk({ k: 'rect', w: 10, h: 5 }, { sm: 'bad' }), mk({ k: 'bogus' })] }] }] }
  const { doc } = D.validateDoc(raw)
  const it = doc.pages[0].layers[0].items
  assert.deepEqual(it[0].shape, { k: 'rect', w: 10, h: 5, rx: 2, ry: 2 }); assert.deepEqual(it[0].sm, sm)
  assert.deepEqual(it[1].shape, { k: 'ellipse', rx: 4, ry: 3, a1: 10, a2: 80, pie: true })
  assert.equal(it[2].shape.n, 6); assert.equal(it[3].shape.r2, 2)
  assert.deepEqual(it[4].nt, [['s', 'y', 'c', 'c']], 'an unknown node type letter becomes a cusp')
  assert.equal(it[5].shape, undefined, 'a shape with a broken matrix is dropped'); assert.equal(it.length, 6, 'an unknown shape kind draws nothing, so no path is left')
  assert.ok(it.every((n) => n.t === 'path' && n.d.length > 1), 'the paths themselves always survive')
})
await t('transform docker maths: position, rotate, scale, size and skew about the chosen reference point', () => {
  const box = { x: 0, y: 0, w: 10, h: 20 }
  const at = (m, x, y) => M.apply(m, x, y).map((v) => Math.round(v * 1e6) / 1e6)
  assert.deepEqual(XF.refPoint(box, 'c'), { x: 5, y: 10 }); assert.deepEqual(XF.refPoint(box, 'nw'), { x: 0, y: 0 }); assert.deepEqual(XF.refPoint(box, 'se'), { x: 10, y: 20 })
  assert.equal(XF.REFS.length, 9)
  assert.deepEqual(at(XF.transformMatrix('position', { x: 50, y: 60 }, box, 'c'), 5, 10), [50, 60])
  assert.deepEqual(at(XF.transformMatrix('position', { x: 50, y: 60 }, box, 'nw'), 0, 0), [50, 60])
  assert.deepEqual(at(XF.transformMatrix('position', { relative: true, dx: 3, dy: -4 }, box), 5, 10), [8, 6])
  assert.deepEqual(at(XF.transformMatrix('rotate', { angle: 90 }, box, 'c'), 10, 10), [5, 5], 'counter-clockwise on screen: the right-hand point goes to the top')
  assert.deepEqual(at(XF.transformMatrix('scale', { sx: 2, sy: 0.5 }, box, 'nw'), 10, 20), [20, 10])
  assert.deepEqual(at(XF.transformMatrix('scale', { sx: 2, sy: 0.5 }, box, 'c'), 5, 10), [5, 10])
  assert.deepEqual(at(XF.transformMatrix('size', { w: 20, h: 20, prop: true, changed: 'w' }, box, 'nw'), 10, 20), [20, 40])
  assert.deepEqual(at(XF.transformMatrix('size', { w: 20, h: 10, prop: false }, box, 'se'), 0, 0), [-10, 10])
  assert.deepEqual(at(XF.transformMatrix('skew', { kx: 45, ky: 0 }, box, 'c'), 5, 0), [-5, 0])
  assert.deepEqual(at(XF.transformMatrix('skew', { kx: 0, ky: 45 }, box, 'c'), 10, 10), [10, 15])
  for (const bad of [XF.transformMatrix('rotate', { angle: 0 }, box), XF.transformMatrix('rotate', { angle: NaN }, box), XF.transformMatrix('scale', { sx: 0, sy: 1 }, box), XF.transformMatrix('size', { w: -1, h: 1 }, box), XF.transformMatrix('skew', { kx: 90, ky: 0 }, box), XF.transformMatrix('position', { x: 1, y: 1 }, null)]) assert.equal(bad, null)
  assert.equal(XF.transformMatrix('position', { x: 5, y: 10 }, box, 'c'), null, 'moving to where it already is does nothing')
})
await t('shaping: limits and refusals are plain words (the engine itself runs in the browser tests)', () => {
  const p = (n) => ({ t: 'path', d: new Array(n).fill(['L', 0, 0]) })
  assert.ok(BL.shapeBlocker([p(2), { t: 'text' }]).includes('curves')); assert.ok(BL.shapeBlocker([p(2), { t: 'image' }]).includes('Pictures'))
  assert.ok(BL.shapeBlocker([p(2)], 2).includes('two')); assert.equal(BL.shapeBlocker([p(2), p(2)]), '')
  assert.ok(BL.shapeBlocker(Array.from({ length: 201 }, () => p(2))).includes('200')); assert.ok(BL.shapeBlocker([p(40000), p(30000)]).includes('too many'))
  assert.deepEqual(BL.OPS, ['weld', 'trim', 'intersect', 'simplify', 'frontMinusBack', 'backMinusFront']); assert.equal(BL.segmentCount({ t: 'text' }), 0)
  assert.ok(!BL.FAIL_TEXT.includes(String.fromCharCode(0x2014)))
})
await t('keys: align letters, order aliases, combine, lock, tools, shaping and docker keys are bound; clipboard keys are hints, not bindings', () => {
  const { map, dupes } = K.buildKeymap()
  assert.deepEqual(dupes, [])
  for (const [k, id] of [['L', 'align.left'], ['R', 'align.right'], ['T', 'align.top'], ['B', 'align.bottom'], ['E', 'align.centerH'], ['C', 'align.centerV'], ['P', 'align.page'], ['Ctrl+L', 'arrange.combine'], ['Ctrl+K', 'arrange.breakApart'], ['Ctrl+Shift+L', 'arrange.lock'], ['Ctrl+Alt+Shift+L', 'arrange.unlockAll'],
    ['F10', 'tool.shape'], ['F5', 'tool.free'], ['Shift+P', 'tool.pen'], ['Shift+F5', 'tool.pen'], ['F6', 'tool.rect'], ['F7', 'tool.ellipse'], ['Y', 'tool.polygon'], ['Shift+Y', 'tool.star'], ['Ctrl+Shift+A', 'win.align'], ['Alt+F7', 'win.transformPos'], ['Alt+F8', 'win.transformRotate'], ['Alt+F9', 'win.transformScale'], ['Alt+F10', 'win.transformSize'],
    ['Ctrl+PageUp', 'arrange.forward'], ['Ctrl+]', 'arrange.forward'], ['Ctrl+[', 'arrange.backward'], ['Shift+PageDown', 'arrange.back']]) assert.equal(map.get(k), id, k)
  for (const k of ['Ctrl+C', 'Ctrl+X', 'Ctrl+V', 'Ctrl+Shift+V']) assert.ok(!map.has(k), `${k} must stay unbound so the browser's own copy and paste events fire`)
  const rows = K.shortcutRows()
  for (const id of ['edit.cut', 'edit.copy', 'edit.paste', 'edit.pasteInPlace']) assert.ok(rows.find((r) => r.id === id)?.keys[0].startsWith('Ctrl+'), id)
  const menus = K.menuTree().find((m) => m.menu === 'Object').items
  const sub = (label) => menus.find((i) => i.label === label)?.items.map((i) => i.id)
  assert.equal(sub('Align').length, 7); assert.equal(sub('Distribute').length, 8); assert.equal(sub('Shaping').length, 6); assert.equal(sub('Nodes').length, 11)
  for (const c of K.COMMANDS) assert.ok(!(c.id.startsWith('node.') && c.keys.length), 'node commands have no keys of their own')
})

// ---------- every import specifier resolves (check.mjs only validates static imports) ----------
const LATE = ['./_psin.js', './_cdrout.js']
await t('imports: every static and dynamic relative import in the editor files exists', () => {
  const files = readdirSync(corel).filter((f) => /^(_ds-.*|_tree|draw-studio)\.js$/.test(f))
  assert.ok(files.length >= 15)
  for (const f of files) {
    const src = readFileSync(join(corel, f), 'utf8')
    for (const m of src.matchAll(/(from\s*|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = join(corel, m[2])
      const lateDynamic = /^import/.test(m[1]) && LATE.includes(m[2]) // written by other builders, loaded only through import() and tolerated when absent
      assert.ok(existsSync(target) || lateDynamic, `${f}: ${m[2]} does not exist`)
    }
    assert.ok(!src.includes(String.fromCharCode(0x2014)), `${f} has an em dash`)
  }
})

console.log(`ok - ${n} test groups`)
