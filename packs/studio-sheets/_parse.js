// Formula tokenizer, parser (to a small AST), printer and reference rewriting. No DOM.
import { MAXR, MAXC, colName, colIndex } from './_a1.js'
import { numToString } from './_fmt.js'

export class ParseError extends Error {}

const ERRS = ['#N/A', '#REF!', '#DIV/0!', '#VALUE!', '#NAME?', '#NUM!', '#NULL!', '#SPILL!']
const SHEET = /^(?:'((?:[^']|'')+)'|([A-Za-z_À-￿][\w.À-￿]*))!/
const R_CELLS = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7}):(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![\w.(])/
const R_COLS = /^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![\w.(\d])/
const R_ROWS = /^(\$?)(\d{1,7}):(\$?)(\d{1,7})(?![\w.(])/
const R_CELL = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![\w.(])/
const NUM = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/
const IDENT = /^[A-Za-z_À-￿][\w.À-￿]*/

const bad = (c, r) => c >= MAXC || r >= MAXR || r < 0

function scanRef(src, i, sh) {
  const s = src.slice(i)
  let m = R_CELLS.exec(s)
  if (m) {
    const c1 = colIndex(m[2]), r1 = +m[4] - 1, c2 = colIndex(m[6]), r2 = +m[8] - 1
    if (bad(c1, r1) || bad(c2, r2)) return null
    return { len: m[0].length, node: { t: 'range', k: 'cell', sh, r1, c1, r2, c2, a: [m[3] === '$', m[1] === '$', m[7] === '$', m[5] === '$'] } } // a: [r1abs, c1abs, r2abs, c2abs]
  }
  m = R_COLS.exec(s)
  if (m) {
    const c1 = colIndex(m[2]), c2 = colIndex(m[4])
    if (c1 >= MAXC || c2 >= MAXC) return null
    return { len: m[0].length, node: { t: 'range', k: 'col', sh, r1: 0, c1, r2: MAXR - 1, c2, a: [true, m[1] === '$', true, m[3] === '$'] } }
  }
  m = R_ROWS.exec(s)
  if (m) {
    const r1 = +m[2] - 1, r2 = +m[4] - 1
    if (r1 < 0 || r2 < 0 || r1 >= MAXR || r2 >= MAXR) return null
    return { len: m[0].length, node: { t: 'range', k: 'row', sh, r1, c1: 0, r2, c2: MAXC - 1, a: [m[1] === '$', true, m[3] === '$', true] } }
  }
  m = R_CELL.exec(s)
  if (m) {
    const c = colIndex(m[2]), r = +m[4] - 1
    if (bad(c, r)) return null
    return { len: m[0].length, node: { t: 'ref', sh, r, c, ra: m[3] === '$', ca: m[1] === '$' } }
  }
  return null
}

function tokenize(src) {
  const toks = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue }
    if (ch === '"') {
      let j = i + 1, s = ''
      for (;;) {
        if (j >= src.length) throw new ParseError('Missing closing quote')
        if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue } break }
        s += src[j++]
      }
      toks.push({ t: 'str', v: s }); i = j + 1; continue
    }
    if (ch === '#') {
      const e = ERRS.find((x) => src.slice(i, i + x.length).toUpperCase() === x)
      if (e) { toks.push({ t: 'err', v: e }); i += e.length; continue }
      throw new ParseError('Unexpected #')
    }
    const sm = SHEET.exec(src.slice(i))
    if (sm) {
      const name = sm[1] != null ? sm[1].replace(/''/g, "'") : sm[2]
      const ref = scanRef(src, i + sm[0].length, name)
      if (ref) { toks.push(ref.node); i += sm[0].length + ref.len; continue }
      if (src[i + sm[0].length] === '#' && src.slice(i + sm[0].length, i + sm[0].length + 4).toUpperCase() === '#REF') { toks.push({ t: 'err', v: '#REF!' }); i += sm[0].length + 5; continue }
      throw new ParseError('Bad reference after sheet name')
    }
    const ref = scanRef(src, i, null)
    if (ref) { toks.push(ref.node); i += ref.len; continue }
    const nm = NUM.exec(src.slice(i))
    if (nm) { toks.push({ t: 'num', v: parseFloat(nm[0]), raw: nm[0] }); i += nm[0].length; continue }
    const id = IDENT.exec(src.slice(i))
    if (id) {
      const name = id[0]
      const after = src[i + name.length]
      i += name.length
      if (after === '(') toks.push({ t: 'fn', name: name.replace(/^_xlfn\.(_xlws\.)?/i, '').toUpperCase() })
      else if (/^(true|false)$/i.test(name)) toks.push({ t: 'bool', v: name.toUpperCase() === 'TRUE' })
      else toks.push({ t: 'name', name })
      continue
    }
    const two = src.slice(i, i + 2)
    if (two === '<>' || two === '<=' || two === '>=') { toks.push({ t: 'op', v: two }); i += 2; continue }
    if ('+-*/^&=<>%(),;:{}@'.includes(ch)) { toks.push({ t: 'op', v: ch }); i++; continue }
    throw new ParseError(`Unexpected character "${ch}"`)
  }
  return toks
}

const PREC = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 }

/** parse('SUM(A1:A3)*2') -> AST. Throws ParseError. */
export function parse(src) {
  const toks = tokenize(src)
  let p = 0
  const peek = () => toks[p]
  const isOp = (v) => toks[p]?.t === 'op' && toks[p].v === v
  const expect = (v) => { if (!isOp(v)) throw new ParseError(`Expected "${v}"`); p++ }

  function expr(min) {
    let left = unary()
    for (;;) {
      const t = peek()
      if (!t || t.t !== 'op') break
      const pr = PREC[t.v]
      if (pr === undefined || pr < min) break
      p++
      const right = expr(pr + 1)
      left = { t: 'bin', op: t.v, l: left, r: right }
    }
    return left
  }
  function unary() {
    if (isOp('-') || isOp('+')) { const op = toks[p++].v; return { t: 'un', op, e: unary() } }
    if (isOp('@')) { p++; return unary() }
    let e = primary()
    while (isOp('%')) { p++; e = { t: 'pct', e } }
    return e
  }
  function primary() {
    const t = toks[p]
    if (!t) throw new ParseError('Unexpected end of formula')
    let node
    if (t.t === 'num' || t.t === 'str' || t.t === 'bool' || t.t === 'err') { p++; node = t }
    else if (t.t === 'ref' || t.t === 'range') { p++; node = t }
    else if (t.t === 'name') { p++; node = t }
    else if (t.t === 'fn') {
      p++; expect('(')
      const args = []
      if (isOp(')')) p++
      else {
        for (;;) {
          args.push(isOp(',') || isOp(';') || isOp(')') ? { t: 'empty' } : expr(0))
          if (isOp(',') || isOp(';')) { p++; continue }
          expect(')'); break
        }
      }
      node = { t: 'fn', name: t.name, args }
    }
    else if (t.t === 'op' && t.v === '(') { p++; const e = expr(0); expect(')'); node = { t: 'par', e } }
    else if (t.t === 'op' && t.v === '{') {
      p++
      const rows = [[]]
      for (;;) {
        rows.at(-1).push(expr(0))
        if (isOp(',')) { p++; continue }
        if (isOp(';')) { p++; rows.push([]); continue }
        expect('}'); break
      }
      node = { t: 'arr', rows }
    }
    else throw new ParseError(`Unexpected "${t.v ?? t.t}"`)
    // range operator between general terms, e.g. A1:INDEX(...)
    while (isOp(':') && (node.t === 'ref' || node.t === 'fn' || node.t === 'rng')) {
      p++
      const b = primary()
      node = { t: 'rng', a: node, b }
    }
    return node
  }
  if (!toks.length) throw new ParseError('Empty formula')
  const ast = expr(0)
  if (p < toks.length) throw new ParseError(`Unexpected "${toks[p].v ?? toks[p].t}"`)
  return ast
}

// ---------- Printing ----------
const needsQuote = (n) => !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(n) || /^[A-Za-z]{1,3}\d+$/.test(n) || /^(true|false)$/i.test(n)
export const sheetPrefix = (n) => (n == null ? '' : (needsQuote(n) ? `'${n.replace(/'/g, "''")}'` : n) + '!')
const cellText = (r, c, ra, ca) => (ca ? '$' : '') + colName(c) + (ra ? '$' : '') + (r + 1)

export function print(n, fnName) {
  const p = (x) => print(x, fnName)
  switch (n.t) {
    case 'num': return n.raw ?? numToString(n.v)
    case 'str': return '"' + n.v.replace(/"/g, '""') + '"'
    case 'bool': return n.v ? 'TRUE' : 'FALSE'
    case 'err': return n.v
    case 'name': return n.name
    case 'empty': return ''
    case 'ref': return sheetPrefix(n.sh) + cellText(n.r, n.c, n.ra, n.ca)
    case 'range': {
      const sp = sheetPrefix(n.sh)
      if (n.k === 'col') return `${sp}${n.a[1] ? '$' : ''}${colName(n.c1)}:${n.a[3] ? '$' : ''}${colName(n.c2)}`
      if (n.k === 'row') return `${sp}${n.a[0] ? '$' : ''}${n.r1 + 1}:${n.a[2] ? '$' : ''}${n.r2 + 1}`
      return `${sp}${cellText(n.r1, n.c1, n.a[0], n.a[1])}:${cellText(n.r2, n.c2, n.a[2], n.a[3])}`
    }
    case 'fn': return `${fnName ? fnName(n.name) : n.name}(${n.args.map(p).join(',')})`
    case 'un': return n.op + p(n.e)
    case 'pct': return p(n.e) + '%'
    case 'par': return `(${p(n.e)})`
    case 'bin': return `${p(n.l)}${n.op}${p(n.r)}`
    case 'rng': return `${p(n.a)}:${p(n.b)}`
    case 'arr': return `{${n.rows.map((r) => r.map(p).join(',')).join(';')}}`
    default: return ''
  }
}

// ---------- Walking and rewriting ----------
/** Rebuild the tree, replacing ref/range nodes with fn(node) (return the node itself to keep it). */
export function mapRefs(n, fn) {
  switch (n.t) {
    case 'ref': case 'range': return fn(n)
    case 'fn': return { ...n, args: n.args.map((a) => mapRefs(a, fn)) }
    case 'un': case 'pct': case 'par': return { ...n, e: mapRefs(n.e, fn) }
    case 'bin': return { ...n, l: mapRefs(n.l, fn), r: mapRefs(n.r, fn) }
    case 'rng': return { ...n, a: mapRefs(n.a, fn), b: mapRefs(n.b, fn) }
    case 'arr': return { ...n, rows: n.rows.map((r) => r.map((x) => mapRefs(x, fn))) }
    default: return n
  }
}
export function walk(n, fn) {
  fn(n)
  switch (n.t) {
    case 'fn': n.args.forEach((a) => walk(a, fn)); break
    case 'un': case 'pct': case 'par': walk(n.e, fn); break
    case 'bin': walk(n.l, fn); walk(n.r, fn); break
    case 'rng': walk(n.a, fn); walk(n.b, fn); break
    case 'arr': n.rows.forEach((r) => r.forEach((x) => walk(x, fn))); break
    default:
  }
}
const REF_ERR = { t: 'err', v: '#REF!' }
/** Shift relative references by (dr, dc), as when a formula is copied. */
export function shift(ast, dr, dc) {
  if (!dr && !dc) return ast
  return mapRefs(ast, (n) => {
    if (n.t === 'ref') {
      const r = n.ra ? n.r : n.r + dr, c = n.ca ? n.c : n.c + dc
      return bad(c, r) ? REF_ERR : { ...n, r, c }
    }
    const r1 = n.k === 'col' || n.a[0] ? n.r1 : n.r1 + dr, r2 = n.k === 'col' || n.a[2] ? n.r2 : n.r2 + dr
    const c1 = n.k === 'row' || n.a[1] ? n.c1 : n.c1 + dc, c2 = n.k === 'row' || n.a[3] ? n.c2 : n.c2 + dc
    return bad(c1, r1) || bad(c2, r2) ? REF_ERR : { ...n, r1, c1, r2, c2 }
  })
}
/** Static references of a formula: [{sh, r1, c1, r2, c2}]. */
export function refsOf(ast) {
  const out = []
  walk(ast, (n) => {
    if (n.t === 'ref') out.push({ sh: n.sh, r1: n.r, c1: n.c, r2: n.r, c2: n.c })
    else if (n.t === 'range') out.push({ sh: n.sh, r1: n.r1, c1: n.c1, r2: n.r2, c2: n.c2 })
  })
  return out
}
export const hasVolatile = (ast, vol) => { let v = false; walk(ast, (n) => { if (n.t === 'fn' && vol.has(n.name)) v = true }); return v }

/** Toggle $ absolute marks on the reference at/around a text caret (F4). Returns {text, caret}. */
export function cycleAbs(text, caret) {
  const re = /(?:(?:'[^']+'|[A-Za-z_][\w.]*)!)?\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?/g
  let m
  while ((m = re.exec(text))) {
    if (caret >= m.index && caret <= m.index + m[0].length) {
      const bangAt = m[0].lastIndexOf('!')
      const pre = bangAt >= 0 ? m[0].slice(0, bangAt + 1) : ''
      const body = m[0].slice(pre.length)
      const out = body.split(':').map((part) => {
        const mm = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(part)
        const st = (mm[1] ? 2 : 0) + (mm[3] ? 1 : 0) // 0 none, 3 both, 1 row, 2 col
        const nx = st === 0 ? 3 : st === 3 ? 1 : st === 1 ? 2 : 0
        return (nx & 2 ? '$' : '') + mm[2] + (nx & 1 ? '$' : '') + mm[4]
      }).join(':')
      const rep = pre + out
      return { text: text.slice(0, m.index) + rep + text.slice(m.index + m[0].length), caret: m.index + rep.length }
    }
  }
  return { text, caret }
}
