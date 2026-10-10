// Workbook model: sheets, cells, styles, dependency graph, recalculation (with spilled arrays), and an undo journal.
// Every mutation goes through begin()/commit() so it can be undone. No DOM.
import { MAXR, MAXC, gk, ck, ckR, ckC, parseRange, isCellRef } from './_a1.js'
import { parse, print, ParseError, refsOf, hasVolatile, walk } from './_parse.js'
import { XErr, E, Ref, errFor } from './_val.js'
import { VOLATILE } from './_funcs.js'
import { evaluate, settle } from './_eval.js'
import { parseInput, isPercentFormat, FMT } from './_fmt.js'

const SPAN = 34359738368
export const DEFAULT_COL_W = 88
export const DEFAULT_ROW_H = 24
const MAX_PASTE = 600000
const DATE_FN = { TODAY: FMT.dmy, DATE: FMT.dmy, EDATE: FMT.dmy, EOMONTH: FMT.dmy, WORKDAY: FMT.dmy, DATEVALUE: FMT.dmy, NOW: FMT.dmyhm, TIME: FMT.hm, TIMEVALUE: FMT.hm }

export const newSheet = (id, name) => ({
  id, name, cells: new Map(), spill: new Map(), spillOwner: new Map(), spillBlocked: new Set(),
  colW: {}, rowH: {}, hideR: {}, hideC: {}, fHide: {}, colS: {}, rowS: {}, freeze: { r: 0, c: 0 }, filter: null, cf: [], charts: [], merges: [], dv: [],
  color: null, grid: true, maxR: -1, maxC: -1, extDirty: false,
})

export function makeCell(f) {
  let ast = null
  try { ast = parse(f) } catch (e) { if (!(e instanceof ParseError)) throw e }
  return { v: null, f, ast, vol: ast ? hasVolatile(ast, VOLATILE) : false, c: null, dirty: false, busy: false, deps: null, sp: null }
}
const hasContent = (cell) => !!(cell && (cell.f != null || cell.v !== null))

export class Model {
  constructor() {
    this.nextSid = 1
    this.wb = { name: 'Untitled', sheets: [], opts: { dateOrder: 'dmy' }, active: 0, names: {} }
    this.styles = [{}]
    this._sk = new Map([['{}', 0]])
    this.depCells = new Map()
    this.depRanges = new Map()
    this.vol = new Set()
    this.undoStack = []
    this.redoStack = []
    this.depth = 0
    this.journal = null
    this.changed = new Set()
    this._touched = new Set()
    this.listeners = new Set()
    this.layoutVer = 0
    this.version = 0
    this.byId = new Map()
    this.host = this._host()
    this.addSheetRaw('Sheet1')
  }

  // ---------- sheets ----------
  get sheets() { return this.wb.sheets }
  sheet(id) { return this.byId.get(id) }
  sheetByName(name) { const n = String(name).toLowerCase(); return this.wb.sheets.find((s) => s.name.toLowerCase() === n) }
  uniqueName(base) {
    let n = base, i = 2
    while (this.sheetByName(n)) n = `${base.replace(/ \(\d+\)$/, '')} (${i++})`
    return n
  }
  addSheetRaw(name) {
    const sh = newSheet(this.nextSid++, name)
    this.wb.sheets.push(sh)
    this.byId.set(sh.id, sh)
    return sh
  }
  _reindex() {
    this.byId = new Map(this.wb.sheets.map((s) => [s.id, s]))
  }

  // ---------- styles ----------
  styleId(obj) {
    const clean = {}
    for (const k of Object.keys(obj).sort()) { const v = obj[k]; if (v !== undefined && v !== null && v !== false && v !== '' && !(k === 'nf' && v === 'General') && !(k === 'fs' && v === 11)) clean[k] = v }
    const key = JSON.stringify(clean)
    let id = this._sk.get(key)
    if (id === undefined) { id = this.styles.length; this.styles.push(clean); this._sk.set(key, id) }
    return id
  }
  style(id) { return this.styles[id || 0] || this.styles[0] }
  mergeStyle(id, patch) {
    const base = { ...this.style(id) }
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === undefined || v === false) delete base[k]; else base[k] = v }
    return this.styleId(base)
  }
  /** Style of a cell including row/column defaults. */
  styleAt(sh, r, c) {
    const cell = sh.cells.get(ck(r, c))
    const s = cell && cell.s !== undefined ? cell.s : sh.rowS[r] ?? sh.colS[c] ?? 0
    return s
  }

  // ---------- reading ----------
  valueAt(sid, r, c) {
    const sh = this.byId.get(sid)
    if (!sh) return E.REF
    const k = ck(r, c)
    const cell = sh.cells.get(k)
    if (cell && cell.f != null) {
      if (cell.busy) return E.CIRC
      if (cell.dirty) this.evalCell(sh, r, c, cell)
      return cell.c
    }
    if (cell && cell.v !== null) return cell.v
    const sp = sh.spill.get(k)
    return sp === undefined ? null : sp
  }
  extent(sid) {
    const sh = this.byId.get(sid)
    if (!sh) return { r: -1, c: -1 }
    if (sh.extDirty) this._recomputeExtent(sh)
    return { r: sh.maxR, c: sh.maxC }
  }
  _recomputeExtent(sh) {
    let mr = -1, mc = -1
    for (const [k, cell] of sh.cells) if (hasContent(cell)) { const r = ckR(k), c = ckC(k); if (r > mr) mr = r; if (c > mc) mc = c }
    for (const k of sh.spill.keys()) { const r = ckR(k), c = ckC(k); if (r > mr) mr = r; if (c > mc) mc = c }
    sh.maxR = mr; sh.maxC = mc; sh.extDirty = false
  }
  matrix(ref) {
    if (ref.rows * ref.cols > 5e6) throw E.VALUE
    const out = []
    for (let r = ref.r1; r <= ref.r2; r++) {
      const row = []
      for (let c = ref.c1; c <= ref.c2; c++) row.push(this.valueAt(ref.sid, r, c))
      out.push(row)
    }
    return out
  }
  iterRange(ref, cb) {
    const sh = this.byId.get(ref.sid)
    if (!sh) return
    const ex = this.extent(ref.sid)
    const r2 = Math.min(ref.r2, ex.r), c2 = Math.min(ref.c2, ex.c)
    if (r2 < ref.r1 || c2 < ref.c1) return
    const area = (r2 - ref.r1 + 1) * (c2 - ref.c1 + 1)
    if (area <= 2 * (sh.cells.size + sh.spill.size) + 64) {
      for (let r = ref.r1; r <= r2; r++) for (let c = ref.c1; c <= c2; c++) { const v = this.valueAt(ref.sid, r, c); if (v !== null) cb(v, r, c) }
      return
    }
    for (const [k, cell] of sh.cells) {
      const r = ckR(k), c = ckC(k)
      if (r < ref.r1 || r > r2 || c < ref.c1 || c > c2) continue
      const v = cell.f != null ? this.valueAt(ref.sid, r, c) : cell.v
      if (v !== null) cb(v, r, c)
    }
    for (const [k, v] of sh.spill) {
      const r = ckR(k), c = ckC(k)
      if (r >= ref.r1 && r <= r2 && c >= ref.c1 && c <= c2 && !hasContent(sh.cells.get(k))) cb(v, r, c)
    }
  }
  _host() {
    return {
      sheetId: (name) => this.sheetByName(name)?.id,
      value: (sid, r, c) => this.valueAt(sid, r, c),
      matrix: (ref) => this.matrix(ref),
      iter: (ref, cb) => this.iterRange(ref, cb),
      extent: (sid) => this.extent(sid),
      rowHidden: (sid, r, manual) => { const sh = this.byId.get(sid); return !!(sh && (sh.fHide[r] || (manual && sh.hideR[r]))) },
      parseRef: (text, sid) => this.parseRefText(text, sid),
      name: (n) => { const d = this.wb.names[n.toUpperCase()]; return d ? this.parseRefText(d.ref, null) : null },
    }
  }
  parseRefText(text, sid) {
    let t = text.trim(), sh = sid
    const m = /^(?:'((?:[^']|'')+)'|([^!']+))!(.*)$/.exec(t)
    if (m) { const s = this.sheetByName(m[1] != null ? m[1].replace(/''/g, "'") : m[2]); if (!s) return null; sh = s.id; t = m[3] }
    const g = parseRange(t)
    return g ? new Ref(sh, g.r1, g.c1, g.r2, g.c2, this.host) : null
  }

  // ---------- dependency graph ----------
  _register(g, cell, sh) {
    this._unregister(g, cell)
    if (cell.f == null || !cell.ast) return
    const deps = []
    for (const ref of refsOf(cell.ast)) {
      const sid = ref.sh == null ? sh.id : this.sheetByName(ref.sh)?.id
      if (sid === undefined) continue
      deps.push({ sid, r1: ref.r1, c1: ref.c1, r2: ref.r2, c2: ref.c2 })
    }
    walk(cell.ast, (n) => {
      if (n.t !== 'name') return
      const r = this.host.name(n.name)
      if (r) deps.push({ sid: r.sid, r1: r.r1, c1: r.c1, r2: r.r2, c2: r.c2 })
    })
    cell.deps = deps
    for (const d of deps) {
      if (d.r1 === d.r2 && d.c1 === d.c2) {
        const key = gk(d.sid, d.r1, d.c1)
        let s = this.depCells.get(key)
        if (!s) this.depCells.set(key, (s = new Set()))
        s.add(g)
      } else {
        let m = this.depRanges.get(d.sid)
        if (!m) this.depRanges.set(d.sid, (m = new Map()))
        const key = `${d.r1},${d.c1},${d.r2},${d.c2}`
        let e = m.get(key)
        if (!e) m.set(key, (e = { r1: d.r1, c1: d.c1, r2: d.r2, c2: d.c2, set: new Set() }))
        e.set.add(g)
      }
    }
    if (cell.vol) this.vol.add(g)
  }
  _unregister(g, cell) {
    this.vol.delete(g)
    if (!cell.deps) return
    for (const d of cell.deps) {
      if (d.r1 === d.r2 && d.c1 === d.c2) {
        const key = gk(d.sid, d.r1, d.c1)
        const s = this.depCells.get(key)
        if (s) { s.delete(g); if (!s.size) this.depCells.delete(key) }
      } else {
        const m = this.depRanges.get(d.sid)
        const key = `${d.r1},${d.c1},${d.r2},${d.c2}`
        const e = m?.get(key)
        if (e) { e.set.delete(g); if (!e.set.size) m.delete(key) }
      }
    }
    cell.deps = null
  }
  dependentsOf(sid, r, c, out = new Set()) {
    const s1 = this.depCells.get(gk(sid, r, c))
    if (s1) for (const d of s1) out.add(d)
    const m = this.depRanges.get(sid)
    if (m) for (const e of m.values()) if (r >= e.r1 && r <= e.r2 && c >= e.c1 && c <= e.c2) for (const d of e.set) out.add(d)
    return out
  }
  dependentsOfMany(keys) {
    const out = new Set()
    if (keys.size <= 64) {
      for (const g of keys) { const [sid, r, c] = this._dec(g); this.dependentsOf(sid, r, c, out) }
      return out
    }
    const box = new Map()
    for (const g of keys) {
      const [sid, r, c] = this._dec(g)
      const s1 = this.depCells.get(g)
      if (s1) for (const d of s1) out.add(d)
      const b = box.get(sid)
      if (!b) box.set(sid, { r1: r, c1: c, r2: r, c2: c })
      else { if (r < b.r1) b.r1 = r; if (r > b.r2) b.r2 = r; if (c < b.c1) b.c1 = c; if (c > b.c2) b.c2 = c }
    }
    for (const [sid, b] of box) {
      const m = this.depRanges.get(sid)
      if (m) for (const e of m.values()) if (e.r1 <= b.r2 && e.r2 >= b.r1 && e.c1 <= b.c2 && e.c2 >= b.c1) for (const d of e.set) out.add(d)
    }
    return out
  }
  _dec(g) {
    const sid = Math.floor(g / SPAN), rem = g - sid * SPAN
    return [sid, Math.floor(rem / MAXC), rem % MAXC]
  }
  rebuildDeps() {
    this.depCells.clear(); this.depRanges.clear(); this.vol.clear()
    for (const sh of this.wb.sheets) for (const [k, cell] of sh.cells) if (cell.f != null) { cell.deps = null; this._register(gk(sh.id, ckR(k), ckC(k)), cell, sh) }
  }

  // ---------- recalculation ----------
  evalCell(sh, r, c, cell) {
    if (cell.busy) return
    cell.busy = true
    let res
    try {
      if (!cell.ast) res = E.NAME
      else {
        const env = { host: this.host, sid: sh.id, r, c, dr: 0, dc: 0 }
        res = settle(env, evaluate(cell.ast, env))
      }
    } finally { cell.busy = false; cell.dirty = false }
    this._applySpill(sh, r, c, cell, res)
  }
  _touch(sh, k) { this._touched.add(gk(sh.id, ckR(k), ckC(k))) }
  _clearSpill(sh, k, cell) {
    const sp = cell.sp
    if (!sp) return
    const r0 = ckR(k), c0 = ckC(k)
    for (let i = 0; i < sp.rows; i++) for (let j = 0; j < sp.cols; j++) {
      if (!i && !j) continue
      const kk = ck(r0 + i, c0 + j)
      if (sh.spillOwner.get(kk) === k) { sh.spillOwner.delete(kk); sh.spill.delete(kk); this._touch(sh, kk) }
    }
    cell.sp = null
    sh.extDirty = true
  }
  _applySpill(sh, r, c, cell, res) {
    const k = ck(r, c)
    if (!Array.isArray(res)) {
      cell.c = res
      if (cell.sp) this._clearSpill(sh, k, cell)
      sh.spillBlocked.delete(k)
      return
    }
    const rows = res.length, cols = res[0].length
    let blocked = r + rows > MAXR || c + cols > MAXC
    if (!blocked) {
      outer: for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
        if (!i && !j) continue
        const kk = ck(r + i, c + j)
        if (hasContent(sh.cells.get(kk))) { blocked = true; break outer }
        const ow = sh.spillOwner.get(kk)
        if (ow !== undefined && ow !== k) { blocked = true; break outer }
      }
    }
    if (blocked) {
      cell.c = E.SPILL
      if (cell.sp) this._clearSpill(sh, k, cell)
      sh.spillBlocked.add(k)
      return
    }
    sh.spillBlocked.delete(k)
    const old = cell.sp
    if (old) {
      for (let i = 0; i < old.rows; i++) for (let j = 0; j < old.cols; j++) {
        if ((!i && !j) || (i < rows && j < cols)) continue
        const kk = ck(r + i, c + j)
        if (sh.spillOwner.get(kk) === k) { sh.spillOwner.delete(kk); sh.spill.delete(kk); this._touch(sh, kk) }
      }
    }
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      if (!i && !j) continue
      const kk = ck(r + i, c + j)
      const prev = sh.spill.get(kk)
      if (prev !== res[i][j] || !sh.spillOwner.has(kk)) this._touch(sh, kk)
      sh.spill.set(kk, res[i][j]); sh.spillOwner.set(kk, k)
    }
    cell.c = res[0][0]
    cell.sp = { rows, cols }
    if (r + rows - 1 > sh.maxR) sh.maxR = r + rows - 1
    if (c + cols - 1 > sh.maxC) sh.maxC = c + cols - 1
  }
  _cellByG(g) {
    const [sid, r, c] = this._dec(g)
    const sh = this.byId.get(sid)
    return sh ? [sh, r, c, sh.cells.get(ck(r, c))] : null
  }
  _pass(seeds) {
    const nodes = new Map()
    const queue = []
    for (const g of seeds) {
      if (nodes.has(g)) continue
      const x = this._cellByG(g)
      if (x && x[3] && x[3].f != null) { nodes.set(g, { n: 0, out: null }); queue.push(g) }
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const g = queue[qi]
      const [sh, r, c, cell] = this._cellByG(g)
      const succ = this.dependentsOf(sh.id, r, c)
      if (cell.sp) for (let i = 0; i < cell.sp.rows; i++) for (let j = 0; j < cell.sp.cols; j++) if (i || j) this.dependentsOf(sh.id, r + i, c + j, succ)
      nodes.get(g).out = succ
      for (const d of succ) {
        if (d === g) continue
        let nd = nodes.get(d)
        if (!nd) { if (!this._cellByG(d)?.[3]) continue; nd = { n: 0, out: null }; nodes.set(d, nd); queue.push(d) }
        nd.n++
      }
    }
    for (const g of nodes.keys()) this._cellByG(g)[3].dirty = true
    const ready = []
    for (const [g, nd] of nodes) if (nd.n === 0) ready.push(g)
    let done = 0
    while (ready.length) {
      const g = ready.pop()
      const [sh, r, c, cell] = this._cellByG(g)
      if (cell.dirty) this.evalCell(sh, r, c, cell)
      done++
      const out = nodes.get(g).out
      if (out) for (const d of out) { if (d === g) continue; const nd = nodes.get(d); if (nd && --nd.n === 0) ready.push(d) }
    }
    if (done < nodes.size) {
      for (const g of nodes.keys()) {
        const [sh, r, c, cell] = this._cellByG(g)
        if (!cell.dirty) continue
        try { this.evalCell(sh, r, c, cell) } catch (e) { if (e instanceof RangeError) { cell.c = E.CIRC; cell.dirty = false } else throw e }
      }
    }
  }
  recalc(changed, all = false) {
    const seeds = new Set(this.vol)
    if (all) {
      for (const sh of this.wb.sheets) for (const [k, cell] of sh.cells) if (cell.f != null) seeds.add(gk(sh.id, ckR(k), ckC(k)))
    } else {
      for (const g of changed) { const x = this._cellByG(g); if (x && x[3] && x[3].f != null) seeds.add(g) }
      for (const d of this.dependentsOfMany(changed)) seeds.add(d)
      for (const sh of this.wb.sheets) for (const k of sh.spillBlocked) seeds.add(gk(sh.id, ckR(k), ckC(k)))
    }
    this._touched = new Set()
    this._pass(seeds)
    for (let i = 0; i < 4 && this._touched.size; i++) {
      const t = this._touched
      this._touched = new Set()
      const nxt = this.dependentsOfMany(t)
      if (!nxt.size) break
      this._pass(nxt)
    }
    this._touched = new Set()
    this.version++
  }
  recalcAll() { this.recalc(new Set(), true) }

  // ---------- transactions ----------
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  _emit(info) { for (const fn of this.listeners) fn(info) }
  begin(label, meta) {
    if (this.depth++ === 0) { this.journal = { label, meta: meta || {}, entries: [] }; this.changed = new Set(); this._layout = false; this._struct = false }
  }
  commit(metaAfter) {
    if (--this.depth > 0) return
    const j = this.journal
    this.journal = null
    if (!j.entries.length) return
    if (metaAfter) j.metaAfter = metaAfter
    this.undoStack.push(j)
    // keep history bounded by step count and by total journaled cells
    let total = 0
    for (const u of this.undoStack) total += u.entries.length
    while (this.undoStack.length > 1 && (this.undoStack.length > 200 || total > 1500000)) total -= this.undoStack.shift().entries.length
    this.redoStack.length = 0
    this._finish()
  }
  /** Run fn inside one undoable transaction. */
  tx(label, fn, meta) {
    this.begin(label, meta)
    try { const r = fn(); this.commit(); return r } catch (e) { this.depth = 0; this._rollback(); throw e }
  }
  _rollback() {
    const j = this.journal
    this.journal = null
    if (!j) return
    for (let i = j.entries.length - 1; i >= 0; i--) this._apply(j.entries[i], true)
    this._finish(true)
  }
  _finish(silent) {
    const struct = this._struct
    if (struct) { this.rebuildDeps(); this.recalc(new Set(), true) } else this.recalc(this.changed)
    this._emit({ keys: this.changed, layout: this._layout, struct, silent: !!silent })
    this.changed = new Set()
  }
  _log(e) { if (!this.journal) throw new Error('mutation outside a transaction'); this.journal.entries.push(e) }

  _apply(e, undo) {
    if (e.k === 'cell') this._rawPut(this.byId.get(e.sid), e.key, undo ? e.old : e.new)
    else if (e.k === 'prop') {
      const v = undo ? e.old : e.new
      if (v === undefined) delete e.obj[e.key]; else e.obj[e.key] = v
      if (e.layout) { this._layout = true; this.layoutVer++ }
      if ((e.key === 'name' && e.obj.cells) || e.struct) this._struct = true // formulas name sheets and ranges: rebuild the dependency graph
    }
    else if (e.k === 'sheets') { this.wb.sheets = undo ? e.old : e.new; this._reindex(); this._struct = true; this._layout = true; this.layoutVer++ }
    else if (e.k === 'wb') { Object.assign(this.wb, undo ? e.old : e.new); this._layout = true }
  }
  undo() {
    const j = this.undoStack.pop()
    if (!j) return null
    this.changed = new Set(); this._layout = false; this._struct = false
    for (let i = j.entries.length - 1; i >= 0; i--) this._apply(j.entries[i], true)
    this.redoStack.push(j)
    this._finish()
    return j
  }
  redo() {
    const j = this.redoStack.pop()
    if (!j) return null
    this.changed = new Set(); this._layout = false; this._struct = false
    for (const e of j.entries) this._apply(e, false)
    this.undoStack.push(j)
    this._finish()
    return j
  }
  clearHistory() { this.undoStack.length = 0; this.redoStack.length = 0 }

  // ---------- primitives (journaled) ----------
  _rawPut(sh, key, cell) {
    const g = gk(sh.id, ckR(key), ckC(key))
    const old = sh.cells.get(key)
    if (old) { this._unregister(g, old); if (old.sp) this._clearSpill(sh, key, old) }
    if (cell) sh.cells.set(key, cell); else sh.cells.delete(key)
    if (cell && cell.f != null) { cell.dirty = false; this._register(g, cell, sh) }
    this.changed.add(g)
    const had = hasContent(old), has = hasContent(cell)
    if (had !== has || (had && has && ((old.f != null) !== (cell.f != null)))) {
      if (has) { const r = ckR(key), c = ckC(key); if (r > sh.maxR) sh.maxR = r; if (c > sh.maxC) sh.maxC = c } else sh.extDirty = true
    }
    // a cell that now holds content may block a spill; a freed one may unblock it (blocked origins are always re-evaluated)
    const ow = sh.spillOwner.get(key)
    if (ow !== undefined && has) this.changed.add(gk(sh.id, ckR(ow), ckC(ow)))
  }
  putCell(sh, key, cell) {
    const old = sh.cells.get(key)
    if (old === cell) return
    this._log({ k: 'cell', sid: sh.id, key, old, new: cell })
    this._rawPut(sh, key, cell)
  }
  setProp(obj, key, val, layout = false, struct = false) {
    const old = obj[key]
    if (old === val) return
    this._log({ k: 'prop', obj, key, old, new: val, layout, struct })
    if (struct) this._struct = true
    if (val === undefined) delete obj[key]; else obj[key] = val
    if (layout) { this._layout = true; this.layoutVer++ }
    if (key === 'name' && obj.cells) this._struct = true
  }
  setSheets(arr) {
    const old = this.wb.sheets
    this._log({ k: 'sheets', old, new: arr })
    this.wb.sheets = arr
    this._reindex()
    this._struct = true; this._layout = true; this.layoutVer++
  }
  setWb(patch) {
    const old = {}
    for (const k of Object.keys(patch)) old[k] = this.wb[k]
    this._log({ k: 'wb', old, new: patch })
    Object.assign(this.wb, patch)
    this._layout = true
  }

  // ---------- defined names ----------
  static validName(n) { return /^[A-Za-z_][A-Za-z0-9_.]{0,63}$/.test(n) && !isCellRef(n) && !/^(true|false)$/i.test(n) && !/^[rc]\d*$/i.test(n) }
  /** Define or change a name for a range such as Sheet1!$A$1:$B$5 (undoable; pass null to remove). */
  setName(name, ref) {
    const key = name.toUpperCase()
    this.setProp(this.wb.names, key, ref == null ? undefined : { n: name, ref }, false, true)
  }

  // ---------- cell-level editing helpers ----------
  /** Set a cell from typed text (formula, number, date, text...). Throws ParseError for invalid formulas. */
  setInput(sh, r, c, text) {
    const k = ck(r, c)
    const old = sh.cells.get(k)
    let s = old && old.s !== undefined ? old.s : sh.rowS[r] ?? sh.colS[c] ?? 0
    const nfNow = this.style(s).nf
    const keep = (cell) => { if (s) cell.s = s; return cell }
    if (nfNow === '@' && typeof text === 'string' && text[0] !== '=') return this.putCell(sh, k, keep({ v: text, f: null }))
    const p = parseInput(text, this.wb.opts)
    if (p.kind === 'empty') return this.putCell(sh, k, s ? { v: null, s } : undefined)
    if (p.kind === 'formula') {
      let f = p.f
      const cell0 = makeCell(f)
      if (!cell0.ast) parse(f) // throws a readable ParseError
      // tidy lower-case function and cell names (outside of text) the way a spreadsheet does
      if (/[a-z]/.test(f.replace(/"(?:[^"]|"")*"/g, '').replace(/'[^']*'!/g, ''))) f = print(cell0.ast)
      const cell = f === p.f ? cell0 : makeCell(f)
      const top = cell.ast && cell.ast.t === 'fn' ? cell.ast.name : null
      if (top && DATE_FN[top] && (!nfNow || nfNow === 'General')) s = this.mergeStyle(s, { nf: DATE_FN[top] })
      keep(cell)
      return this.putCell(sh, k, cell)
    }
    let v = p.v
    if (typeof v === 'number') {
      if (p.nf) { if (!nfNow || nfNow === 'General') s = this.mergeStyle(s, { nf: p.nf }) }
      else if (nfNow && isPercentFormat(nfNow) && !/%/.test(text)) v /= 100
    }
    this.putCell(sh, k, keep({ v, f: null }))
  }
  getCellText(sh, r, c) {
    const cell = sh.cells.get(ck(r, c))
    if (!cell) return ''
    if (cell.f != null) return '=' + cell.f
    const v = cell.v
    if (v === null) return ''
    if (typeof v === 'object') return v.code
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
    if (typeof v === 'string') {
      // text that would be read as a number, date or formula keeps a leading apostrophe so editing does not change its type
      if (v !== '' && (v[0] === '=' || v[0] === "'")) return "'" + v
      const p = parseInput(v, this.wb.opts)
      return p.kind === 'value' && typeof p.v === 'string' ? v : "'" + v
    }
    return String(v)
  }
  usedRange(sh) {
    if (sh.extDirty) this._recomputeExtent(sh)
    return sh.maxR < 0 ? null : { r1: 0, c1: 0, r2: sh.maxR, c2: sh.maxC }
  }

  // ---------- serialization ----------
  toJSON() {
    const enc = (v) => (v instanceof XErr ? { e: v.code } : v)
    return {
      v: 1, name: this.wb.name, opts: this.wb.opts, active: this.wb.active, nextSid: this.nextSid, styles: this.styles, names: this.wb.names,
      sheets: this.wb.sheets.map((sh) => {
        const cells = []
        for (const [k, cell] of sh.cells) {
          const row = [ckR(k), ckC(k)]
          row.push(cell.f != null ? null : enc(cell.v), cell.f != null ? cell.f : null, cell.s || 0)
          cells.push(row)
        }
        return {
          id: sh.id, name: sh.name, color: sh.color, grid: sh.grid, cells, colW: sh.colW, rowH: sh.rowH, hideR: sh.hideR, hideC: sh.hideC, fHide: sh.fHide,
          colS: sh.colS, rowS: sh.rowS, freeze: sh.freeze, filter: sh.filter, cf: sh.cf, charts: sh.charts, merges: sh.merges, dv: sh.dv,
        }
      }),
    }
  }
  static fromJSON(j) {
    const m = new Model()
    m.loadJSON(j)
    return m
  }
  loadJSON(j) {
    this.wb = { name: j.name || 'Untitled', opts: { dateOrder: 'dmy', ...(j.opts || {}) }, active: j.active || 0, sheets: [], names: j.names || {} }
    this.styles = j.styles && j.styles.length ? j.styles : [{}]
    this._sk = new Map(this.styles.map((s, i) => [JSON.stringify(s), i]))
    this.byId = new Map()
    this.nextSid = j.nextSid || 1
    for (const js of j.sheets) {
      const sh = newSheet(js.id, js.name)
      for (const k of ['color', 'grid', 'colW', 'rowH', 'hideR', 'hideC', 'fHide', 'colS', 'rowS', 'freeze', 'filter', 'cf', 'charts', 'merges', 'dv']) if (js[k] !== undefined) sh[k] = js[k]
      for (const [r, c, v, f, s] of js.cells) {
        const cell = f != null ? makeCell(f) : { v: v && typeof v === 'object' && v.e ? errFor(v.e) : v ?? null, f: null }
        if (s) cell.s = s
        sh.cells.set(ck(r, c), cell)
      }
      sh.extDirty = true
      this.wb.sheets.push(sh)
      this.byId.set(sh.id, sh)
      this.nextSid = Math.max(this.nextSid, sh.id + 1)
    }
    if (!this.wb.sheets.length) this.addSheetRaw('Sheet1')
    this.wb.active = Math.min(this.wb.active, this.wb.sheets.length - 1)
    this.undoStack.length = 0; this.redoStack.length = 0
    this.rebuildDeps()
    this.recalcAll()
    this.layoutVer++
  }
}

export { MAX_PASTE }
