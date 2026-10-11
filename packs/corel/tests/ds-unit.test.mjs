// Node tests for the DOM-free Draw Studio modules.   node packs/corel/tests/ds-unit.test.mjs [samples dir with manifest.json]
// Covers: _tree, _ds-doc (validateDoc fuzz, immutable helpers), _ds-store (undo fuzz against a deep-clone oracle), _ds-units, _ds-colors,
// _ds-keys (command table), _ds-text-model, _ds-path, _ds-hit, _ds-open (sniff, font merge, CDR to tree), import specifiers.
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
