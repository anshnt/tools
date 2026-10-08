// Excel formula tokenizer, parser and plain-English explainer. Pure functions (no DOM), so they are easy to test.
import { lookupFn, FUNCTIONS, VOLATILE } from './_excel-fns.js'

export const colNum = (letters) => [...letters.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0)
export const colLetters = (n) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }

const SHEET = "(?:(?:'(?:[^']|'')+'|[A-Za-z_][\\w.]*)!)?"
const CELL = '\\$?[A-Za-z]{1,3}\\$?\\d+'
const REF_RE = new RegExp(`^${SHEET}(?:${CELL}(?::${CELL})?|\\$?[A-Za-z]{1,3}:\\$?[A-Za-z]{1,3}|\\$?\\d+:\\$?\\d+)(?![\\w(.])`)
const ERR_RE = /^#(?:N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!|SPILL!|CALC!|GETTING_DATA)/i
const NUM_RE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/
const IDENT_RE = /^[A-Za-z_\\][A-Za-z0-9_.\\]*/

const validRef = (raw) => {
  const body = raw.slice(raw.lastIndexOf('!') + 1)
  return body.split(':').every((p) => {
    const m = /^\$?([A-Za-z]{1,3})(?:\$?\d+)?$/.exec(p)
    return !m || colNum(m[1]) <= 16384
  })
}

/** Split a formula into tokens. Each token: { t, v, i }. t is ws | str | num | bool | err | fn | ref | name | op | open | close | sep | array | bad. */
export function tokenize(src) {
  const tokens = []
  const errors = []
  let i = 0
  const push = (t, v) => { tokens.push({ t, v, i }); i += v.length }
  while (i < src.length) {
    const c = src[i]
    const rest = src.slice(i)
    if (/\s/.test(c)) { push('ws', /^\s+/.exec(rest)[0]); continue }
    if (c === '"') {
      let j = i + 1
      for (; j < src.length; j++) { if (src[j] === '"') { if (src[j + 1] === '"') j++; else break } }
      if (j >= src.length) { errors.push({ msg: 'A text in quotes is never closed (missing ").', at: i }); push('str', rest) } else push('str', src.slice(i, j + 1))
      continue
    }
    if (c === '{') {
      const end = src.indexOf('}', i)
      if (end < 0) { errors.push({ msg: 'A { is never closed with }.', at: i }); push('array', rest) } else push('array', src.slice(i, end + 1))
      continue
    }
    if (c === '#') {
      const m = ERR_RE.exec(rest)
      if (m) { push('err', m[0].toUpperCase()); continue }
      push('op', '#'); continue
    }
    const refm = (/[A-Za-z_'$\d]/.test(c)) && REF_RE.exec(rest)
    if (refm && validRef(refm[0])) { push('ref', refm[0]); continue }
    if (/\d|\./.test(c) && NUM_RE.test(rest)) { push('num', NUM_RE.exec(rest)[0]); continue }
    if (c === "'") {
      const m = /^'(?:[^']|'')+'!?/.exec(rest)
      if (m) { push('name', m[0]); continue }
    }
    if (IDENT_RE.test(rest)) {
      const id = IDENT_RE.exec(rest)[0]
      const after = rest.slice(id.length)
      if (/^\s*\(/.test(after)) { push('fn', id); continue }
      if (after[0] === '[') {
        let depth = 0, j = 0
        for (; j < after.length; j++) { if (after[j] === '[') depth++; else if (after[j] === ']') { depth--; if (!depth) break } }
        push('ref', id + after.slice(0, j + 1))
        continue
      }
      if (after[0] === '!') {
        const m = new RegExp(`^${CELL}(?::${CELL})?|^\\$?[A-Za-z]{1,3}:\\$?[A-Za-z]{1,3}`).exec(after.slice(1))
        if (m) { push('ref', id + '!' + m[0]); continue }
      }
      if (/^(true|false)$/i.test(id)) { push('bool', id); continue }
      push('name', id); continue
    }
    const two = rest.slice(0, 2)
    if (['<>', '<=', '>='].includes(two)) { push('op', two); continue }
    if ('+-*/^&=<>%:@'.includes(c)) { push('op', c); continue }
    if (c === '(') { push('open', c); continue }
    if (c === ')') { push('close', c); continue }
    if (c === ',' || c === ';') { push('sep', c); continue }
    errors.push({ msg: `The character "${c}" is not allowed in a formula.`, at: i })
    push('bad', c)
  }
  return { tokens, errors }
}

const BIN = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5, ':': 6 }

/** Parse a formula (a leading = is optional). Returns { ast, tokens, errors, src, offset }. */
export function parseFormula(input) {
  let src = input.replace(/^\s+/, '')
  let offset = input.length - src.length
  if (src.startsWith('=')) { src = src.slice(1); offset += 1 }
  const { tokens, errors } = tokenize(src)
  const sig = tokens.filter((t) => t.t !== 'ws')
  let p = 0
  const peek = () => sig[p]
  const err = (msg, at) => errors.push({ msg, at })
  const end = (n) => (n ? n.i + n.v.length : src.length)

  function primary() {
    const t = peek()
    if (!t) { err('The formula ends too early. Something is missing after the last operator.', src.length); return null }
    if (t.t === 'num' || t.t === 'str' || t.t === 'bool' || t.t === 'err' || t.t === 'array') { p++; return { type: t.t, raw: t.v, start: t.i, end: end(t) } }
    if (t.t === 'ref') { p++; return { type: 'ref', raw: t.v, start: t.i, end: end(t), ...refKind(t.v) } }
    if (t.t === 'name') { p++; return { type: 'name', raw: t.v, start: t.i, end: end(t) } }
    if (t.t === 'fn') {
      p++
      const open = peek()
      if (open?.t !== 'open') { err(`${t.v} needs an opening bracket.`, t.i); return { type: 'fn', raw: t.v, name: t.v, args: [], start: t.i, end: end(t), closed: false } }
      p++
      const args = []
      let closed = false
      if (peek()?.t === 'close') { p++; closed = true } else {
        for (;;) {
          const n = peek()
          if (!n) { err(`The bracket after ${t.v} is never closed. Add a ) at the end.`, open.i); break }
          if (n.t === 'sep' || n.t === 'close') args.push(null)
          else {
            const before = p
            args.push(expr(1))
            if (p === before) p++
          }
          const nx = peek()
          if (nx?.t === 'sep') { p++; if (peek()?.t === 'close') { args.push(null); p++; closed = true; break } continue }
          if (nx?.t === 'close') { p++; closed = true; break }
          if (!nx) { err(`The bracket after ${t.v} is never closed. Add a ) at the end.`, open.i); break }
          err(`Expected a comma or ) but found "${nx.v}".`, nx.i)
          p++
        }
      }
      return { type: 'fn', raw: t.v, name: t.v, args, start: t.i, end: closed ? end(sig[p - 1]) : end(sig[p - 1]), closed }
    }
    if (t.t === 'open') {
      p++
      const inner = expr(1)
      if (peek()?.t === 'close') { p++; return { type: 'paren', arg: inner, start: t.i, end: end(sig[p - 1]) } }
      err('A ( is never closed. Add a ).', t.i)
      return { type: 'paren', arg: inner, start: t.i, end: end(sig[p - 1]) }
    }
    if (t.t === 'close') { err('There is a ) with no matching (.', t.i); p++; return null }
    if (t.t === 'op' || t.t === 'sep' || t.t === 'bad') { err(`Unexpected "${t.v}" here.`, t.i); p++; return null }
    p++
    return null
  }
  function unary() {
    const t = peek()
    if (t?.t === 'op' && (t.v === '-' || t.v === '+' || t.v === '@')) { p++; const a = unary(); return { type: 'un', op: t.v, arg: a, start: t.i, end: a?.end ?? end(t) } }
    let n = primary()
    for (;;) {
      const x = peek()
      if (n && x?.t === 'op' && x.v === '%') { p++; n = { type: 'pct', arg: n, start: n.start, end: end(x) } } else if (n && x?.t === 'op' && x.v === '#') { p++; n = { type: 'spill', arg: n, start: n.start, end: end(x) } } else break
    }
    return n
  }
  function expr(min) {
    let left = unary()
    for (;;) {
      const t = peek()
      if (t?.t !== 'op' || !(t.v in BIN) || BIN[t.v] < min) break
      p++
      const right = expr(BIN[t.v] + 1)
      left = { type: 'bin', op: t.v, left, right, start: left?.start ?? t.i, end: right?.end ?? end(t) }
    }
    return left
  }
  const ast = expr(1)
  if (p < sig.length) {
    const t = sig[p]
    err(t.t === 'close' ? 'There is a ) with no matching (.' : `Unexpected "${t.v}" after the end of the formula.`, t.i)
  }
  return { ast, tokens, errors, src, offset }
}

function refKind(raw) {
  const m = /^(?:('(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(.*)$/.exec(raw)
  const sheet = m[1] ? m[1].replace(/^'|'$/g, '').replace(/''/g, "'") : null
  const body = m[2]
  if (body.includes('[')) return { kind: 'structured', sheet }
  if (/^\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}$/.test(body)) return { kind: 'cols', sheet, body }
  if (/^\$?\d+:\$?\d+$/.test(body)) return { kind: 'rows', sheet, body }
  if (body.includes(':')) return { kind: 'range', sheet, body }
  return { kind: 'cell', sheet, body }
}

/** Size of a reference in plain words. */
export function describeRef(n) {
  const strip = (s) => s.replace(/\$/g, '')
  const sh = n.sheet ? ` on the sheet "${n.sheet}"` : ''
  if (n.kind === 'structured') return `the table part ${n.raw}${sh}`
  if (n.kind === 'cell') return `cell ${strip(n.body)}${sh}`
  if (n.kind === 'cols') { const [a, b] = strip(n.body).split(':'); return a.toUpperCase() === b.toUpperCase() ? `the whole of column ${a.toUpperCase()}${sh}` : `columns ${a.toUpperCase()} to ${b.toUpperCase()}${sh}` }
  if (n.kind === 'rows') { const [a, b] = strip(n.body).split(':'); return a === b ? `the whole of row ${a}${sh}` : `rows ${a} to ${b}${sh}` }
  const [a, b] = strip(n.body).split(':')
  const pa = /^([A-Za-z]+)(\d+)$/.exec(a), pb = /^([A-Za-z]+)(\d+)$/.exec(b)
  if (pa && pb) {
    const cols = Math.abs(colNum(pb[1]) - colNum(pa[1])) + 1, rows = Math.abs(+pb[2] - +pa[2]) + 1
    return `the range ${a.toUpperCase()}:${b.toUpperCase()} (${cols} column${cols > 1 ? 's' : ''} by ${rows} row${rows > 1 ? 's' : ''}, ${(cols * rows).toLocaleString()} cells)${sh}`
  }
  return `the range ${strip(n.body)}${sh}`
}

function shortRef(n) {
  const raw = n.raw.replace(/\$/g, '')
  if (n.kind === 'cols') { const [a, b] = n.body.replace(/\$/g, '').toUpperCase().split(':'); return a === b ? `column ${a}` : `columns ${a} to ${b}` }
  if (n.kind === 'rows') { const [a, b] = n.body.replace(/\$/g, '').split(':'); return a === b ? `row ${a}` : `rows ${a} to ${b}` }
  return raw
}
const OPS = { '+': 'plus', '-': 'minus', '*': 'times', '/': 'divided by', '^': 'to the power of', '&': 'joined to', '=': 'equals', '<>': 'is not equal to', '<': 'is less than', '>': 'is greater than', '<=': 'is at most', '>=': 'is at least', ':': 'through' }
const list = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`)

/** Plain-English reading of a node. */
export function describe(n) {
  if (!n) return 'nothing (left empty)'
  switch (n.type) {
    case 'num': return n.raw
    case 'str': return n.raw.length <= 2 ? 'an empty text' : n.raw
    case 'bool': return n.raw.toUpperCase()
    case 'err': return `the error ${n.raw}`
    case 'array': return `the list ${n.raw}`
    case 'ref': return shortRef(n)
    case 'name': return `${n.raw} (a named value or range)`
    case 'paren': return describe(n.arg)
    case 'pct': return `${describe(n.arg)} percent`
    case 'spill': return `the spilled results of ${describe(n.arg)}`
    case 'un': return n.op === '-' ? `minus ${describe(n.arg)}` : n.op === '@' ? `the single value of ${describe(n.arg)}` : describe(n.arg)
    case 'bin': {
      const side = (c) => (c?.type === 'bin' && c.op !== n.op ? `(${describe(c)})` : c?.type === 'paren' && c.arg?.type === 'bin' ? `(${describe(c.arg)})` : describe(c))
      return `${side(n.left)} ${OPS[n.op]} ${side(n.right)}`
    }
    case 'fn': return describeFn(n)
    default: return ''
  }
}
const BOOL_FNS = new Set(['AND', 'OR', 'NOT', 'XOR', 'EXACT', 'ISBLANK', 'ISNUMBER', 'ISTEXT', 'ISERROR', 'ISNA', 'ISLOGICAL', 'ISEVEN', 'ISODD'])
const WRAPPERS = new Set(['IFERROR', 'IFNA', 'IF', 'IFS', 'SWITCH', 'AND', 'OR', 'NOT', 'XOR', 'LET', 'CHOOSE'])
const COMPARE = new Set(['=', '<>', '<', '>', '<=', '>='])

/** One sentence for a node: "Gives ...", "Checks whether ..." or "Calculates ...". */
export function sentenceFor(n) {
  if (!n) return ''
  const p = describe(n)
  const lead = n.type === 'fn' ? (BOOL_FNS.has(lookupFn(n.name)?.name) ? 'Checks whether' : 'Gives') : n.type === 'bin' ? (COMPARE.has(n.op) ? 'Checks whether' : 'Calculates') : n.type === 'ref' ? 'Shows the value of' : 'Gives'
  return `${lead} ${p}.`
}

function describeFn(n) {
  const info = lookupFn(n.name)
  const wrapper = WRAPPERS.has(info?.name)
  const parts = n.args.map((a) => { if (!a) return null; const d = describe(a); return a.type === 'fn' && !wrapper && d.includes(' ') ? `(${d})` : d })
  if (!info || !info.phrase) return `the result of ${n.name.toUpperCase()}(${parts.map((x) => x ?? '').join(', ')})`
  const has = (i) => i >= 1 && i <= parts.length && parts[i - 1] != null
  const fill = (tpl) => tpl
    .replace(/\[\[(.*?)\]\]/g, (_, seg) => {
      const need = [...seg.matchAll(/\{(p?)(\d+|\*)(\.\.)?\}/g)]
      const ok = need.every((m) => (m[2] === '*' ? parts.length > 0 : m[1] ? parts.length > +m[2] : m[3] ? parts.slice(+m[2] - 1).some((x) => x != null) : has(+m[2])))
      return ok ? fill(seg) : ''
    })
    .replace(/\{\*\}/g, () => list(parts.map((x) => x ?? 'nothing')))
    .replace(/\{p(\d+)\}/g, (_, k) => { const out = []; for (let i = +k - 1; i + 1 < parts.length; i += 2) out.push(`${parts[i]} matches ${parts[i + 1]}`); return list(out) })
    .replace(/\{(\d+)\.\.\}/g, (_, k) => list(parts.slice(+k - 1).filter((x) => x != null)))
    .replace(/\{(\d+)\}/g, (_, k) => (has(+k) ? parts[+k - 1] : 'nothing'))
  return fill(info.phrase).replace(/\s+/g, ' ').trim()
}

// ---------- Walkers ----------
export function children(n) {
  if (!n) return []
  if (n.type === 'fn') return n.args.filter(Boolean)
  if (n.type === 'bin') return [n.left, n.right].filter(Boolean)
  if (n.arg) return [n.arg]
  return []
}
export function walk(n, fn, depth = 0, parent = null) {
  if (!n) return
  fn(n, depth, parent)
  for (const c of children(n)) walk(c, fn, depth + 1, n)
}
/** Function calls in the order Excel works them out (innermost first). */
export function stepsOf(ast) {
  const out = []
  const visit = (n) => { if (!n) return; for (const c of children(n)) visit(c); if (n.type === 'fn') out.push(n) }
  visit(ast)
  return out
}
export function refsOf(ast) {
  const seen = new Map()
  walk(ast, (n) => { if (n.type === 'ref' || n.type === 'name') { const k = n.raw; if (!seen.has(k)) seen.set(k, n) } })
  return [...seen.values()]
}

const lev = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}
export function suggestFn(name) {
  const n = name.toUpperCase()
  let best = null, bd = 3
  for (const k of FUNCTIONS.keys()) { const d = lev(n, k); if (d < bd) { bd = d; best = k } }
  return best
}

/** Problems and tips: [{ level: 'error' | 'warn' | 'tip', msg }]. */
export function lint(parsed) {
  const out = []
  for (const e of parsed.errors) out.push({ level: 'error', msg: e.msg, at: e.at })
  const seps = new Set(parsed.tokens.filter((t) => t.t === 'sep').map((t) => t.v))
  if (seps.size > 1) out.push({ level: 'warn', msg: 'Both commas and semicolons separate arguments here. Excel uses one or the other, depending on your region settings.' })
  let ifDepth = 0
  const volatile = new Set()
  const unknown = new Set()
  walk(parsed.ast, (n) => {
    if (n.type !== 'fn') return
    const name = n.name.toUpperCase().replace(/^_XLFN\./, '')
    const info = lookupFn(n.name)
    if (!info) {
      if (!unknown.has(name)) { unknown.add(name); const s = suggestFn(name); out.push({ level: 'warn', msg: `${name} is not in the built-in dictionary${s ? `. Did you mean ${s}?` : '. It may be a newer, custom or add-in function.'}`, at: n.start }) }
      return
    }
    const argc = n.args.length
    if (n.closed && argc < info.min) out.push({ level: 'error', msg: `${info.name} needs at least ${info.min} argument${info.min > 1 ? 's' : ''} but has ${argc}.`, at: n.start })
    if (n.closed && argc > info.max) out.push({ level: 'error', msg: `${info.name} accepts at most ${info.max} argument${info.max > 1 ? 's' : ''} but has ${argc}.`, at: n.start })
    if (VOLATILE.has(info.name)) volatile.add(info.name)
    if ((info.name === 'VLOOKUP' || info.name === 'HLOOKUP') && argc === 3) out.push({ level: 'tip', msg: `${info.name} without a 4th argument finds the closest match, and expects a sorted first column. Add FALSE as the 4th argument to match exactly.` })
    if (info.name === 'MATCH' && argc === 2) out.push({ level: 'tip', msg: 'MATCH without a 3rd argument finds the largest value not above the lookup value and expects sorted data. Use 0 to match exactly.' })
    if (info.name === 'IFERROR') out.push({ level: 'tip', msg: 'IFERROR hides every kind of error, including mistakes in your formula. Use IFNA if you only expect "not found".' })
    for (const a of n.args) if (a?.type === 'ref' && a.kind === 'cols' && ['SUMPRODUCT', 'FILTER', 'INDEX', 'MATCH'].includes(info.name) && info.name === 'SUMPRODUCT') out.push({ level: 'tip', msg: 'Whole-column references inside SUMPRODUCT can make the workbook slow. Use an exact range like A2:A1000.' })
  })
  const depth = (n) => (n?.type === 'fn' && lookupFn(n.name)?.name === 'IF' ? 1 + Math.max(0, ...n.args.slice(1).map(depth)) : n ? Math.max(0, ...children(n).map(depth)) : 0)
  ifDepth = depth(parsed.ast)
  if (ifDepth >= 4) out.push({ level: 'tip', msg: `${ifDepth} IFs are nested inside each other. IFS or SWITCH (or a lookup table) is easier to read and maintain.` })
  if (volatile.size) out.push({ level: 'tip', msg: `${[...volatile].join(', ')} recalculate every time anything changes in the workbook, which can slow big files down.` })
  return out
}

// ---------- Printing ----------
export function compact(n) {
  if (!n) return ''
  switch (n.type) {
    case 'fn': return `${n.name}(${n.args.map(compact).join(',')})`
    case 'bin': return `${compact(n.left)}${n.op}${compact(n.right)}`
    case 'un': return `${n.op}${compact(n.arg)}`
    case 'pct': return `${compact(n.arg)}%`
    case 'spill': return `${compact(n.arg)}#`
    case 'paren': return `(${compact(n.arg)})`
    default: return n.raw
  }
}
/** Indented, readable version of a formula. */
export function pretty(n, level = 0, width = 64) {
  const pad = (k) => '  '.repeat(k)
  const one = compact(n)
  if (!n || one.length <= width) return one
  if (n.type === 'fn' && n.args.length) return `${n.name}(\n${n.args.map((a) => `${pad(level + 1)}${pretty(a, level + 1, width)}`).join(',\n')}\n${pad(level)})`
  if (n.type === 'paren') return `(${pretty(n.arg, level, width)})`
  if (n.type === 'bin') return `${pretty(n.left, level, width)} ${n.op} ${pretty(n.right, level, width)}`
  return one
}

export const EXAMPLES = [
  ['Look up a price', '=VLOOKUP(E2,A2:C100,3,FALSE)'],
  ['Grade with nested IFs', '=IF(B2>=90,"A",IF(B2>=80,"B",IF(B2>=70,"C","F")))'],
  ['INDEX and MATCH', '=IFERROR(INDEX(C2:C100,MATCH(E2,A2:A100,0)),"Not found")'],
  ['Sum with two conditions', '=SUMIFS(D2:D500,A2:A500,"North",B2:B500,">="&DATE(2024,1,1))'],
  ['Modern lookup', '=XLOOKUP(G2,A2:A100,C2:C100,"No match")'],
  ['Names with LET', '=LET(total,SUM(B2:B10),share,B2/total,TEXT(share,"0.0%"))'],
  ['Filter and sort', '=SORT(FILTER(A2:D100,C2:C100>100,"None"),4,-1)'],
  ['Age from birthday', '=DATEDIF(B2,TODAY(),"Y")&" years"'],
]
