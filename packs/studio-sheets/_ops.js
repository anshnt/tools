// Editing operations on the model: styles, clipboard, fill, sort, structure, filter, find. Call inside model.tx(). No DOM.
import { MAXR, MAXC, ck, ckR, ckC, rangeArea, rangeContains } from './_a1.js'
import { print, mapRefs, shift } from './_parse.js'
import { makeCell } from './_model.js'
import { formatValue, isDateFormat, MONTHS, DAYS, parseInput, generalText } from './_fmt.js'
import { XErr, compare } from './_val.js'
import { toDelimited } from './_text.js'

export const rectOf = (r1, c1, r2, c2) => ({ r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) })
export const normRect = (g) => rectOf(g.r1, g.c1, g.r2, g.c2)
const MAX_CELLS = 600000

export function displayOf(model, sh, r, c) {
  const v = model.valueAt(sh.id, r, c)
  const nf = model.style(model.styleAt(sh, r, c)).nf
  const f = formatValue(v, nf)
  return { text: f.text, color: f.color, v, nf }
}
export const withStyle = (cell, s) => { const o = { ...cell }; if (s) o.s = s; else delete o.s; return o }
const isBlank = (cell) => !cell || (cell.f == null && cell.v === null)
function formulaCellFromAst(ast, s) {
  const c = makeCell(print(ast))
  if (s) c.s = s
  return c
}

/** Existing cells inside a rect as [key, cell] (safe to mutate the sheet while looping over the result). */
export function existingIn(sh, g) {
  const out = []
  const area = rangeArea(g)
  if (area <= sh.cells.size * 2) {
    for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) { const k = ck(r, c); const cell = sh.cells.get(k); if (cell) out.push([k, cell]) }
  } else {
    for (const [k, cell] of sh.cells) if (rangeContains(g, ckR(k), ckC(k))) out.push([k, cell])
  }
  return out
}

// ---------- clearing and styles ----------
export function clearRange(model, sh, g, what = 'contents') {
  for (const [k, cell] of existingIn(sh, g)) {
    if (what === 'all') model.putCell(sh, k, undefined)
    else if (what === 'formats') { if (isBlank(cell)) model.putCell(sh, k, undefined); else model.putCell(sh, k, withStyle(cell, 0)) }
    else if (cell.s) { if (!isBlank(cell)) model.putCell(sh, k, { v: null, f: null, s: cell.s }) } else model.putCell(sh, k, undefined)
  }
  if (what !== 'contents') {
    if (g.r1 === 0 && g.r2 >= MAXR - 1) for (let c = g.c1; c <= Math.min(g.c2, 2000); c++) if (sh.colS[c] !== undefined) model.setProp(sh.colS, c, undefined)
    if (g.c1 === 0 && g.c2 >= MAXC - 1) for (let r = g.r1; r <= Math.min(g.r2, 20000); r++) if (sh.rowS[r] !== undefined) model.setProp(sh.rowS, r, undefined)
  }
}

/** Apply a style patch ({b: true, fc: '#f00', nf: '0.00', b: null removes}) to a rect. */
export function applyStyle(model, sh, g, patch) {
  const fullCols = g.r1 === 0 && g.r2 >= MAXR - 1, fullRows = g.c1 === 0 && g.c2 >= MAXC - 1
  const patchCell = (k, r, c) => {
    const old = sh.cells.get(k)
    const base = old && old.s !== undefined ? old.s : sh.rowS[r] ?? sh.colS[c] ?? 0
    const s = model.mergeStyle(base, patch)
    if (old) { if (old.s !== s && !(old.s === undefined && s === 0)) model.putCell(sh, k, withStyle(old, s)) }
    else if (s) model.putCell(sh, k, { v: null, f: null, s })
  }
  if (fullCols || fullRows) {
    const c2 = fullRows ? Math.max(26, sh.maxC + 20) : g.c2
    if (fullCols) for (let c = g.c1; c <= Math.min(c2, g.c1 + 2000); c++) { const s = model.mergeStyle(sh.colS[c] || 0, patch); model.setProp(sh.colS, c, s || undefined) }
    else if (g.r2 - g.r1 <= 20000) for (let r = g.r1; r <= g.r2; r++) { const s = model.mergeStyle(sh.rowS[r] || 0, patch); model.setProp(sh.rowS, r, s || undefined) }
    for (const [k] of existingIn(sh, { r1: g.r1, c1: g.c1, r2: Math.min(g.r2, MAXR - 1), c2: Math.min(g.c2, MAXC - 1) })) patchCell(k, ckR(k), ckC(k))
    return
  }
  if (rangeArea(g) > MAX_CELLS) throw new Error('That selection is too large to format. Select whole columns instead.')
  for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) patchCell(ck(r, c), r, c)
}

/** mode: all | outer | inner | top | bottom | left | right | none. spec: {s, c} or null. */
export function applyBorders(model, sh, g, mode, spec) {
  const patches = new Map()
  const add = (r, c, key, val) => { if (r < 0 || c < 0) return; const k = ck(r, c); const p = patches.get(k) || { r, c }; p[key] = val; patches.set(k, p) }
  const v = mode === 'none' ? null : spec
  const opp = { bt: 'bb', bb: 'bt', bl: 'br', br: 'bl' }
  const edge = (r, c, key) => {
    add(r, c, key, v)
    const nr = key === 'bt' ? r - 1 : key === 'bb' ? r + 1 : r, nc = key === 'bl' ? c - 1 : key === 'br' ? c + 1 : c
    add(nr, nc, opp[key], v)
  }
  for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
    if (mode === 'all' || mode === 'none') { edge(r, c, 'bt'); edge(r, c, 'bb'); edge(r, c, 'bl'); edge(r, c, 'br') }
    if (mode === 'outer') { if (r === g.r1) edge(r, c, 'bt'); if (r === g.r2) edge(r, c, 'bb'); if (c === g.c1) edge(r, c, 'bl'); if (c === g.c2) edge(r, c, 'br') }
    if (mode === 'inner') { if (r > g.r1) edge(r, c, 'bt'); if (c > g.c1) edge(r, c, 'bl') }
    if (mode === 'top' && r === g.r1) edge(r, c, 'bt')
    if (mode === 'bottom' && r === g.r2) edge(r, c, 'bb')
    if (mode === 'left' && c === g.c1) edge(r, c, 'bl')
    if (mode === 'right' && c === g.c2) edge(r, c, 'br')
  }
  for (const [k, p] of patches) {
    const { r, c, ...patch } = p
    const old = sh.cells.get(k)
    const base = old && old.s !== undefined ? old.s : sh.rowS[r] ?? sh.colS[c] ?? 0
    const s = model.mergeStyle(base, patch)
    if (old) { if (old.s !== s) model.putCell(sh, k, withStyle(old, s)) } else if (s) model.putCell(sh, k, { v: null, f: null, s })
  }
}

// ---------- clipboard ----------
export function copyPayload(model, sh, g) {
  const cells = []
  for (let r = g.r1; r <= g.r2; r++) {
    const row = []
    for (let c = g.c1; c <= g.c2; c++) {
      const cell = sh.cells.get(ck(r, c))
      const val = model.valueAt(sh.id, r, c)
      const st = model.style(model.styleAt(sh, r, c))
      if (!cell && val === null && !Object.keys(st).length) { row.push(null); continue }
      row.push({ v: cell ? cell.v : val, f: cell && cell.f != null ? cell.f : null, st, val })
    }
    cells.push(row)
  }
  return { sid: sh.id, r1: g.r1, c1: g.c1, r2: g.r2, c2: g.c2, rows: g.r2 - g.r1 + 1, cols: g.c2 - g.c1 + 1, cells }
}
export function toTSV(model, sh, g) {
  const rows = []
  for (let r = g.r1; r <= g.r2; r++) { const row = []; for (let c = g.c1; c <= g.c2; c++) row.push(displayOf(model, sh, r, c).text); rows.push(row) }
  return toDelimited(rows, '\t')
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export function toHTML(model, sh, g) {
  let out = '<table>'
  for (let r = g.r1; r <= g.r2; r++) {
    out += '<tr>'
    for (let c = g.c1; c <= g.c2; c++) {
      const d = displayOf(model, sh, r, c), st = model.style(model.styleAt(sh, r, c))
      const css = [st.b && 'font-weight:bold', st.i && 'font-style:italic', (st.u || st.st) && `text-decoration:${[st.u && 'underline', st.st && 'line-through'].filter(Boolean).join(' ')}`,
        st.fc && `color:${st.fc}`, st.bg && `background:${st.bg}`, st.ha && `text-align:${st.ha}`, typeof d.v === 'number' && !st.ha && 'text-align:right'].filter(Boolean).join(';')
      out += `<td${css ? ` style="${css}"` : ''}>${esc(d.text)}</td>`
    }
    out += '</tr>'
  }
  return out + '</table>'
}
/** mode: all | values | formulas | formats */
export function pasteCells(model, sh, r0, c0, p, mode = 'all') {
  for (let i = 0; i < p.rows; i++) for (let j = 0; j < p.cols; j++) {
    const r = r0 + i, c = c0 + j
    if (r >= MAXR || c >= MAXC) continue
    const k = ck(r, c)
    const src = p.cells[i][j]
    const old = sh.cells.get(k)
    const oldS = old && old.s !== undefined ? old.s : sh.rowS[r] ?? sh.colS[c] ?? 0
    if (mode === 'formats') {
      const s = src ? model.styleId(src.st) : 0
      if (old) { if ((old.s || 0) !== s) model.putCell(sh, k, withStyle(old, s)) } else if (s) model.putCell(sh, k, { v: null, f: null, s })
      continue
    }
    const s = mode === 'all' ? (src ? model.styleId(src.st) : 0) : oldS
    if (!src || (src.f == null && src.v === null && src.val === null)) {
      if (mode === 'all' || mode === 'values' || mode === 'formulas') model.putCell(sh, k, s ? { v: null, f: null, s } : undefined)
      continue
    }
    if (src.f != null && mode !== 'values') {
      const dr = r - (p.r1 + i), dc = c - (p.c1 + j)
      const base = makeCell(src.f)
      const cell = base.ast ? (dr || dc ? formulaCellFromAst(shift(base.ast, dr, dc), s) : withStyle(base, s)) : withStyle(base, s)
      model.putCell(sh, k, cell)
    } else {
      const v = src.f != null ? src.val : src.v
      model.putCell(sh, k, withStyle({ v: v instanceof XErr ? v : v, f: null }, s))
    }
  }
}
/** Pasted text from outside (TSV matrix of strings) typed as if entered by the user. */
export function pasteText(model, sh, r0, c0, matrix) {
  let n = 0
  for (let i = 0; i < matrix.length; i++) for (let j = 0; j < matrix[i].length; j++) {
    const r = r0 + i, c = c0 + j
    if (r >= MAXR || c >= MAXC) continue
    try { model.setInput(sh, r, c, matrix[i][j]) } catch { model.putCell(sh, ck(r, c), { v: matrix[i][j], f: null, ...(sh.cells.get(ck(r, c))?.s ? { s: sh.cells.get(ck(r, c)).s } : {}) }) }
    n++
  }
  return n
}

// ---------- reference rewriting ----------
export function rewriteAll(model, fn) {
  for (const sh of model.sheets) {
    for (const [k, cell] of [...sh.cells]) {
      if (cell.f == null || !cell.ast) continue
      let changed = false
      const ast = mapRefs(cell.ast, (n) => { const o = fn(n, sh); if (o !== n) changed = true; return o })
      if (changed) model.putCell(sh, k, formulaCellFromAst(ast, cell.s))
    }
  }
}
const REF_ERR = { t: 'err', v: '#REF!' }
const targetOf = (model, n, owner) => (n.sh == null ? owner : model.sheetByName(n.sh))
function adjustSpan(a, b, index, count, del) {
  if (!del) return [a >= index ? a + count : a, b >= index ? b + count : b]
  const end = index + count
  const na = a < index ? a : a >= end ? a - count : index
  const nb = b < index ? b : b >= end ? b - count : index - 1
  return nb < na ? null : [na, nb]
}
/** Rect adjusted for inserting/deleting rows or columns; null when it disappears. */
export function adjustRect(g, axis, index, count, del) {
  if (axis === 'row') { const s = adjustSpan(g.r1, g.r2, index, count, del); return s && { ...g, r1: s[0], r2: s[1] } }
  const s = adjustSpan(g.c1, g.c2, index, count, del)
  return s && { ...g, c1: s[0], c2: s[1] }
}
function shiftKeys(obj, axis, index, count, del) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    const i = +k
    if (del && i >= index && i < index + count) continue
    out[i >= index ? i + (del ? -count : count) : i] = v
  }
  return out
}
/** axis: 'row' | 'col'; inserts count rows/columns before index, or deletes them. */
export function structural(model, sh, axis, index, count, del) {
  // formulas everywhere
  rewriteAll(model, (n, owner) => {
    const t = targetOf(model, n, owner)
    if (t !== sh) return n
    if (n.t === 'ref') {
      const v = axis === 'row' ? n.r : n.c
      if (del && v >= index && v < index + count) return REF_ERR
      const nv = v >= index + (del ? count : 0) ? v + (del ? -count : count) : v
      return nv === v ? n : axis === 'row' ? { ...n, r: nv } : { ...n, c: nv }
    }
    if ((axis === 'row' && n.k === 'col') || (axis === 'col' && n.k === 'row')) return n
    const g = adjustRect({ r1: n.r1, c1: n.c1, r2: n.r2, c2: n.c2 }, axis, index, count, del)
    if (!g) return REF_ERR
    return g.r1 === n.r1 && g.r2 === n.r2 && g.c1 === n.c1 && g.c2 === n.c2 ? n : { ...n, ...g }
  })
  // move cells
  const moves = []
  for (const [k, cell] of sh.cells) {
    const r = ckR(k), c = ckC(k), v = axis === 'row' ? r : c
    if (del && v >= index && v < index + count) moves.push([k, null, cell])
    else if (v >= index + (del ? count : 0)) moves.push([k, axis === 'row' ? ck(r + (del ? -count : count), c) : ck(r, c + (del ? -count : count)), cell])
  }
  moves.sort((a, b) => (del ? a[0] - b[0] : b[0] - a[0]))
  for (const [from, to, cell] of moves) {
    if (to === null) { model.putCell(sh, from, undefined); continue }
    model.putCell(sh, from, undefined)
    model.putCell(sh, to, cell)
  }
  // layout
  if (axis === 'row') {
    model.setProp(sh, 'rowH', shiftKeys(sh.rowH, 'row', index, count, del), true)
    model.setProp(sh, 'hideR', shiftKeys(sh.hideR, 'row', index, count, del), true)
    model.setProp(sh, 'fHide', shiftKeys(sh.fHide, 'row', index, count, del), true)
    model.setProp(sh, 'rowS', shiftKeys(sh.rowS, 'row', index, count, del))
  } else {
    model.setProp(sh, 'colW', shiftKeys(sh.colW, 'col', index, count, del), true)
    model.setProp(sh, 'hideC', shiftKeys(sh.hideC, 'col', index, count, del), true)
    model.setProp(sh, 'colS', shiftKeys(sh.colS, 'col', index, count, del))
  }
  const adj = (g) => adjustRect(g, axis, index, count, del)
  model.setProp(sh, 'merges', sh.merges.map(adj).filter((g) => g && (g.r1 !== g.r2 || g.c1 !== g.c2)), true)
  model.setProp(sh, 'cf', sh.cf.map((x) => { const g = adj(x.range); return g ? { ...x, range: g } : null }).filter(Boolean))
  if (sh.filter) { const g = adj(sh.filter); model.setProp(sh, 'filter', g ? { ...sh.filter, ...g } : null, true) }
  for (const s of model.sheets) {
    const ch = s.charts.map((x) => (x.src && x.src.sid === sh.id ? (adj(x.src) ? { ...x, src: { ...x.src, ...adj(x.src) } } : null) : x)).filter(Boolean)
    if (ch.length !== s.charts.length || ch.some((x, i) => x !== s.charts[i])) model.setProp(s, 'charts', ch)
  }
  const fr = { ...sh.freeze }
  if (axis === 'row' && index < fr.r) fr.r = Math.max(0, fr.r + (del ? -Math.min(count, fr.r - index) : count))
  if (axis === 'col' && index < fr.c) fr.c = Math.max(0, fr.c + (del ? -Math.min(count, fr.c - index) : count))
  if (fr.r !== sh.freeze.r || fr.c !== sh.freeze.c) model.setProp(sh, 'freeze', fr, true)
}

/** After moving a block (cut and paste), formulas that pointed into it follow it. */
export function moveRefs(model, srcSh, g, dstSh, dr, dc) {
  const inside = (r, c) => r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2
  rewriteAll(model, (n, owner) => {
    if (targetOf(model, n, owner) !== srcSh) return n
    const rename = dstSh !== srcSh ? { sh: dstSh === owner && n.sh == null ? null : dstSh.name } : {}
    if (n.t === 'ref') return inside(n.r, n.c) ? { ...n, ...rename, r: n.r + dr, c: n.c + dc } : n
    if (n.k !== 'cell') return n
    return inside(n.r1, n.c1) && inside(n.r2, n.c2) ? { ...n, ...rename, r1: n.r1 + dr, r2: n.r2 + dr, c1: n.c1 + dc, c2: n.c2 + dc } : n
  })
}

// ---------- merge ----------
export function mergeCells(model, sh, g) {
  if (g.r1 === g.r2 && g.c1 === g.c2) return
  const keep = sh.merges.filter((m) => !(m.r1 <= g.r2 && g.r1 <= m.r2 && m.c1 <= g.c2 && g.c1 <= m.c2))
  for (const [k, cell] of existingIn(sh, g)) {
    if (ckR(k) === g.r1 && ckC(k) === g.c1) continue
    if (!isBlank(cell)) model.putCell(sh, k, cell.s ? { v: null, f: null, s: cell.s } : undefined)
  }
  model.setProp(sh, 'merges', [...keep, { ...g }], true)
}
export function unmergeCells(model, sh, g) {
  model.setProp(sh, 'merges', sh.merges.filter((m) => !(m.r1 <= g.r2 && g.r1 <= m.r2 && m.c1 <= g.c2 && g.c1 <= m.c2)), true)
}
export const mergeAt = (sh, r, c) => sh.merges.find((m) => rangeContains(m, r, c))
export function expandToMerges(sh, g) {
  let out = { ...g }, grew = true
  while (grew) {
    grew = false
    for (const m of sh.merges) {
      if (m.r1 <= out.r2 && out.r1 <= m.r2 && m.c1 <= out.c2 && out.c1 <= m.c2) {
        const n = { r1: Math.min(out.r1, m.r1), c1: Math.min(out.c1, m.c1), r2: Math.max(out.r2, m.r2), c2: Math.max(out.c2, m.c2) }
        if (n.r1 !== out.r1 || n.c1 !== out.c1 || n.r2 !== out.r2 || n.c2 !== out.c2) { out = n; grew = true }
      }
    }
  }
  return out
}

// ---------- fill ----------
const SERIES = [MONTHS, MONTHS.map((m) => m.slice(0, 3)), DAYS, DAYS.map((d) => d.slice(0, 3))]
const roundN = (x) => +x.toFixed(10)
function listMatch(v) {
  if (typeof v !== 'string') return null
  const t = v.trim().toLowerCase()
  for (const list of SERIES) { const i = list.findIndex((x) => x.toLowerCase() === t); if (i >= 0) return { list, i } }
  return null
}
const applyCase = (sample, s) => (sample === sample.toUpperCase() && sample.length > 1 ? s.toUpperCase() : sample === sample.toLowerCase() ? s.toLowerCase() : s)

/** items: [{v, f, ast, nf, r, c}] in fill order, dst: [{r, c}]. Returns [{v} | {ast}] per destination. */
export function extendLane(items, dst, isDate) {
  const n = items.length
  const hasF = items.some((x) => x.f != null)
  if (hasF) return dst.map((d, k) => { const s = items[k % n]; return s.f != null && s.ast ? { ast: shift(s.ast, d.r - s.r, d.c - s.c) } : { v: s.v } })
  const vals = items.map((x) => x.v)
  if (vals.every((v) => typeof v === 'number')) {
    if (n === 1) return dst.map((_, k) => ({ v: isDate ? vals[0] + k + 1 : vals[0] }))
    let sx = 0, sy = 0, sxy = 0, sxx = 0
    vals.forEach((y, x) => { sx += x; sy += y; sxy += x * y; sxx += x * x })
    const den = n * sxx - sx * sx
    const slope = den ? (n * sxy - sx * sy) / den : 0
    const icpt = (sy - slope * sx) / n
    return dst.map((_, k) => ({ v: roundN(icpt + slope * (n + k)) }))
  }
  if (vals.every((v) => typeof v === 'string')) {
    const pats = vals.map((v) => /^(.*?)(\d+)$/.exec(v))
    if (pats.every(Boolean) && pats.every((p) => p[1] === pats[0][1])) {
      const nums = pats.map((p) => parseInt(p[2], 10))
      const step = n >= 2 ? nums[n - 1] - nums[n - 2] : 1
      const w = pats[n - 1][2].length, pad = pats[n - 1][2].startsWith('0') ? w : 0
      return dst.map((_, k) => ({ v: pats[0][1] + String(nums[n - 1] + step * (k + 1)).padStart(pad, '0') }))
    }
    const ms = vals.map(listMatch)
    if (ms.every(Boolean) && ms.every((m) => m.list === ms[0].list)) {
      const L = ms[0].list.length
      const idx = ms.map((m) => m.i)
      const step = n >= 2 ? ((idx[n - 1] - idx[n - 2]) % L + L) % L || 1 : 1
      return dst.map((_, k) => ({ v: applyCase(vals[n - 1], ms[0].list[(((idx[n - 1] + step * (k + 1)) % L) + L) % L]) }))
    }
  }
  return dst.map((_, k) => ({ v: items[k % n].v }))
}
/** Extend `src` to `end` (a rect that contains src and grows it in one direction). */
export function fillExtend(model, sh, src, end) {
  const down = end.r2 > src.r2, up = end.r1 < src.r1, right = end.c2 > src.c2, left = end.c1 < src.c1
  const vertical = down || up
  if (!vertical && !right && !left) return
  const lanes = vertical ? src.c2 - src.c1 + 1 : src.r2 - src.r1 + 1
  for (let ln = 0; ln < lanes; ln++) {
    const items = [], dst = []
    const along = vertical ? src.r2 - src.r1 + 1 : src.c2 - src.c1 + 1
    for (let t = 0; t < along; t++) {
      const idx = (down || right) ? t : along - 1 - t
      const r = vertical ? src.r1 + idx : src.r1 + ln, c = vertical ? src.c1 + ln : src.c1 + idx
      const cell = sh.cells.get(ck(r, c))
      const val = cell ? cell.v : null
      items.push({ v: cell && cell.f != null ? model.valueAt(sh.id, r, c) : val, f: cell && cell.f != null ? cell.f : null, ast: cell?.ast, r, c, s: cell?.s ?? sh.rowS[r] ?? sh.colS[c] ?? 0 })
    }
    const count = down ? end.r2 - src.r2 : up ? src.r1 - end.r1 : right ? end.c2 - src.c2 : src.c1 - end.c1
    for (let k = 1; k <= count; k++) dst.push(vertical ? { r: down ? src.r2 + k : src.r1 - k, c: src.c1 + ln } : { r: src.r1 + ln, c: right ? src.c2 + k : src.c1 - k })
    const date = items.length === 1 && items[0].v !== null && isDateFormat(model.style(items[0].s).nf)
    const out = extendLane(items, dst, date)
    out.forEach((o, k) => {
      const d = dst[k], key = ck(d.r, d.c), s = items[k % items.length].s
      if (d.r < 0 || d.c < 0 || d.r >= MAXR || d.c >= MAXC) return
      if (o.ast) model.putCell(sh, key, formulaCellFromAst(o.ast, s))
      else if (o.v === null || o.v === undefined) model.putCell(sh, key, s ? { v: null, f: null, s } : undefined)
      else model.putCell(sh, key, withStyle({ v: o.v, f: null }, s))
    })
  }
}
/** Ctrl+D / Ctrl+R: copy the first row/column of the rect over the rest. */
export function fillDown(model, sh, g, right = false) {
  const p = copyPayload(model, sh, right ? { ...g, c2: g.c1 } : { ...g, r2: g.r1 })
  if (right) for (let c = g.c1 + 1; c <= g.c2; c++) pasteCells(model, sh, g.r1, c, p, 'all')
  else for (let r = g.r1 + 1; r <= g.r2; r++) pasteCells(model, sh, r, g.c1, p, 'all')
}

// ---------- sorting ----------
const rank = (v) => (v === null || v === undefined || v === '' ? 3 : v instanceof XErr ? 2 : 0)
export function sortRect(model, sh, g, keys, hasHeader) {
  if (sh.merges.some((m) => m.r1 <= g.r2 && g.r1 <= m.r2 && m.c1 <= g.c2 && g.c1 <= m.c2)) throw new Error('Unmerge cells before sorting.')
  const r0 = g.r1 + (hasHeader ? 1 : 0)
  if (r0 >= g.r2) return
  const rows = []
  for (let r = r0; r <= g.r2; r++) {
    const cells = []
    for (let c = g.c1; c <= g.c2; c++) cells.push(sh.cells.get(ck(r, c)))
    rows.push({ r, cells, vals: keys.map((k) => model.valueAt(sh.id, r, k.col)) })
  }
  const sorted = rows.slice().sort((a, b) => {
    for (let i = 0; i < keys.length; i++) {
      const x = a.vals[i], y = b.vals[i], rx = rank(x), ry = rank(y)
      if (rx !== ry) return rx - ry
      if (rx) continue
      const c = compare(x, y)
      if (c) return keys[i].desc ? -c : c
    }
    return a.r - b.r
  })
  sorted.forEach((row, idx) => {
    const r = r0 + idx
    row.cells.forEach((cell, j) => {
      const c = g.c1 + j, k = ck(r, c)
      if (!cell) { if (sh.cells.has(k)) model.putCell(sh, k, undefined); return }
      if (cell.f != null && cell.ast && row.r !== r) model.putCell(sh, k, formulaCellFromAst(shift(cell.ast, r - row.r, 0), cell.s))
      else model.putCell(sh, k, cell)
    })
  })
}
export function removeDuplicates(model, sh, g, cols, hasHeader) {
  const r0 = g.r1 + (hasHeader ? 1 : 0)
  const seen = new Set(), keep = []
  for (let r = r0; r <= g.r2; r++) {
    const key = cols.map((c) => { const v = model.valueAt(sh.id, r, c); return typeof v === 'string' ? 's' + v.toLowerCase() : typeof v + String(v) }).join('\u0001')
    if (seen.has(key)) continue
    seen.add(key); keep.push(r)
  }
  const removed = (g.r2 - r0 + 1) - keep.length
  if (!removed) return 0
  const snap = keep.map((r) => { const o = []; for (let c = g.c1; c <= g.c2; c++) o.push(sh.cells.get(ck(r, c))); return o })
  for (let r = r0; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
    const i = r - r0, cell = i < snap.length ? snap[i][c - g.c1] : undefined
    const k = ck(r, c)
    if (cell) { if (sh.cells.get(k) !== cell) model.putCell(sh, k, cell) } else if (sh.cells.has(k)) model.putCell(sh, k, undefined)
  }
  return removed
}

// ---------- filter ----------
export function filterMatches(spec, text, v) {
  if (spec.hide && spec.hide.includes(text)) return false
  const c = spec.cond
  if (c) {
    const n = typeof v === 'number' ? v : null, t = text.toLowerCase(), a = (c.v1 ?? '').toString().toLowerCase()
    const num1 = parseFloat(c.v1), num2 = parseFloat(c.v2)
    switch (c.op) {
      case 'eq': return n !== null && !Number.isNaN(num1) ? n === num1 : t === a
      case 'ne': return n !== null && !Number.isNaN(num1) ? n !== num1 : t !== a
      case 'gt': return n !== null && n > num1
      case 'ge': return n !== null && n >= num1
      case 'lt': return n !== null && n < num1
      case 'le': return n !== null && n <= num1
      case 'between': return n !== null && n >= Math.min(num1, num2) && n <= Math.max(num1, num2)
      case 'contains': return t.includes(a)
      case 'notcontains': return !t.includes(a)
      case 'begins': return t.startsWith(a)
      case 'ends': return t.endsWith(a)
      case 'blank': return text === ''
      case 'notblank': return text !== ''
      default: return true
    }
  }
  return true
}
/** Recompute hidden rows from sh.filter. */
export function applyFilter(model, sh) {
  const f = sh.filter
  const hidden = {}
  if (f) {
    for (let r = f.r1 + 1; r <= f.r2; r++) {
      for (const [col, spec] of Object.entries(f.cols || {})) {
        const d = displayOf(model, sh, r, +col)
        if (!filterMatches(spec, d.text, d.v)) { hidden[r] = 1; break }
      }
    }
  }
  model.setProp(sh, 'fHide', hidden, true)
}
export function distinctValues(model, sh, f, col, limit = 2000) {
  const m = new Map()
  for (let r = f.r1 + 1; r <= f.r2; r++) {
    const d = displayOf(model, sh, r, col)
    const e = m.get(d.text)
    if (e) e.n++; else if (m.size < limit) m.set(d.text, { text: d.text, v: d.v, n: 1 })
  }
  return [...m.values()].sort((a, b) => { const x = a.v, y = b.v; if (x === null || x === '') return 1; if (y === null || y === '') return -1; return compare(x, y) })
}

// ---------- find and replace ----------
export function findAll(model, opts) {
  const { text, matchCase, wholeCell, formulas, allSheets, sheet } = opts
  if (!text) return []
  const needle = matchCase ? text : text.toLowerCase()
  const out = []
  for (const sh of allSheets ? model.sheets : [sheet]) {
    for (const [k, cell] of sh.cells) {
      if (isBlank(cell)) continue
      const r = ckR(k), c = ckC(k)
      const hay0 = formulas ? model.getCellText(sh, r, c) : displayOf(model, sh, r, c).text
      const hay = matchCase ? hay0 : hay0.toLowerCase()
      if (wholeCell ? hay === needle : hay.includes(needle)) out.push({ sid: sh.id, r, c, text: hay0 })
    }
  }
  out.sort((a, b) => a.sid - b.sid || a.r - b.r || a.c - b.c)
  return out
}
export function replaceIn(model, hit, opts) {
  const sh = model.sheet(hit.sid)
  const raw = model.getCellText(sh, hit.r, hit.c)
  const re = new RegExp(opts.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), opts.matchCase ? 'g' : 'gi')
  const next = opts.wholeCell ? opts.replace : raw.replace(re, () => opts.replace)
  if (next === raw) return false
  try { model.setInput(sh, hit.r, hit.c, next) } catch { return false }
  return true
}

/** Auto-sum suggestion: range of numbers directly above (or to the left of) a cell. */
export function autoSumRange(model, sh, r, c) {
  let r1 = r - 1
  while (r1 >= 0 && typeof model.valueAt(sh.id, r1, c) === 'number') r1--
  if (r1 < r - 1) return { r1: r1 + 1, c1: c, r2: r - 1, c2: c, dir: 'col' }
  let c1 = c - 1
  while (c1 >= 0 && typeof model.valueAt(sh.id, r, c1) === 'number') c1--
  if (c1 < c - 1) return { r1: r, c1: c1 + 1, r2: r, c2: c - 1, dir: 'row' }
  return null
}
export { generalText, parseInput }
