// Value types and coercion shared by the evaluator and the function library. No DOM.
import { numToString, parseInput } from './_fmt.js'

export class XErr {
  constructor(code) { this.code = code }
  toString() { return this.code }
}
export const E = {
  NA: new XErr('#N/A'), REF: new XErr('#REF!'), DIV0: new XErr('#DIV/0!'), VALUE: new XErr('#VALUE!'), NAME: new XErr('#NAME?'),
  NUM: new XErr('#NUM!'), NULL: new XErr('#NULL!'), SPILL: new XErr('#SPILL!'), CIRC: new XErr('#CIRC!'),
}
export const errFor = (code) => Object.values(E).find((e) => e.code === code) || new XErr(code)
export const isErr = (v) => v instanceof XErr

/** A reference to a rectangle of cells on a sheet (0-based, inclusive). */
export class Ref {
  constructor(sid, r1, c1, r2, c2, host) { this.sid = sid; this.r1 = r1; this.c1 = c1; this.r2 = r2; this.c2 = c2; this.host = host }
  get rows() { return this.r2 - this.r1 + 1 }
  get cols() { return this.c2 - this.c1 + 1 }
  get single() { return this.r1 === this.r2 && this.c1 === this.c2 }
  /** Same sheet, another rectangle. */
  sub(r1, c1, r2, c2) { return new Ref(this.sid, r1, c1, r2, c2, this.host) }
  /** The value of a single-cell reference (so functions can use a cell reference as a plain argument). */
  scalar() {
    if (!this.single || !this.host) throw E.VALUE
    const v = this.host.value(this.sid, this.r1, this.c1)
    if (v instanceof XErr) throw v
    return v
  }
}
export const isMat = (v) => Array.isArray(v)

export function strToNum(s) {
  const t = s.trim()
  if (t === '') return null
  const p = parseInput(t)
  return p.kind === 'value' && typeof p.v === 'number' ? p.v : null
}
export function toNum(v) {
  if (v instanceof Ref) v = v.scalar()
  if (typeof v === 'number') return v
  if (v == null) return 0
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string') { const n = strToNum(v); if (n === null) throw E.VALUE; return n }
  if (v instanceof XErr) throw v
  throw E.VALUE
}
export function toStr(v) {
  if (v instanceof Ref) v = v.scalar()
  if (typeof v === 'string') return v
  if (v == null) return ''
  if (typeof v === 'number') return numToString(v)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (v instanceof XErr) throw v
  throw E.VALUE
}
export function toBool(v) {
  if (v instanceof Ref) v = v.scalar()
  if (typeof v === 'boolean') return v
  if (v == null) return false
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') { const u = v.trim().toUpperCase(); if (u === 'TRUE') return true; if (u === 'FALSE') return false; throw E.VALUE }
  if (v instanceof XErr) throw v
  throw E.VALUE
}
export const toInt = (v) => Math.trunc(toNum(v))
/** Finite check: turns NaN/Infinity results into #NUM!. */
export const fin = (n) => { if (!Number.isFinite(n)) throw E.NUM; return n }

const typeRank = (v) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 3)
/** Excel ordering: numbers < text < logicals; text compares case-insensitively; empty acts like 0 or "". */
export function compare(a, b) {
  if (a == null && b == null) return 0
  if (a == null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0
  if (b == null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0
  const ra = typeRank(a), rb = typeRank(b)
  if (ra !== rb) return ra < rb ? -1 : 1
  if (ra === 1) { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0 }
  if (ra === 2) return a === b ? 0 : a ? 1 : -1
  if (a !== b && Number.isFinite(a) && Number.isFinite(b) && +a.toPrecision(15) === +b.toPrecision(15)) return 0 // 15 significant digits, like a spreadsheet
  return a < b ? -1 : a > b ? 1 : 0
}

const escRe = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')
/** Wildcard (* ? ~) pattern to RegExp, case-insensitive. */
export function wildcard(p, anchored = true) {
  let re = ''
  for (let i = 0; i < p.length; i++) {
    const ch = p[i]
    if (ch === '~' && i + 1 < p.length) { re += escRe(p[++i]); continue }
    re += ch === '*' ? '[\\s\\S]*' : ch === '?' ? '[\\s\\S]' : escRe(ch)
  }
  return new RegExp(anchored ? `^${re}$` : re, 'i')
}
/** Criteria as used by SUMIF/COUNTIF: 5, ">5", "<>x", "a*", "=" -> predicate(value). */
export function makeCriteria(c) {
  if (c instanceof XErr) return (v) => v instanceof XErr && v.code === c.code
  if (typeof c === 'boolean') return (v) => v === c
  if (typeof c === 'number') return (v) => (typeof v === 'number' ? v === c : typeof v === 'string' && strToNum(v) === c)
  if (c == null) return (v) => v === 0
  let s = String(c), op = '='
  const m = /^(<=|>=|<>|<|>|=)/.exec(s)
  if (m) { op = m[1]; s = s.slice(op.length) }
  if (s === '') return op === '=' ? (v) => v == null || v === '' : op === '<>' ? (v) => !(v == null || v === '') : () => false
  const n = strToNum(s)
  const bl = /^(true|false)$/i.test(s) ? s.toLowerCase() === 'true' : undefined
  if (n !== null && bl === undefined) {
    return (v) => {
      const x = typeof v === 'number' ? v : typeof v === 'string' && op !== '=' && op !== '<>' ? null : typeof v === 'string' ? strToNum(v) : null
      if (x === null) return op === '<>'
      return op === '=' ? x === n : op === '<>' ? x !== n : op === '>' ? x > n : op === '<' ? x < n : op === '>=' ? x >= n : x <= n
    }
  }
  if (bl !== undefined) return (v) => (op === '<>' ? v !== bl : v === bl)
  const hasWild = /[*?~]/.test(s)
  const re = hasWild ? wildcard(s) : null
  const low = s.toLowerCase()
  if (op === '=' || op === '<>') {
    return (v) => {
      const hit = typeof v === 'string' ? (re ? re.test(v) : v.toLowerCase() === low) : false
      return op === '=' ? hit : !hit
    }
  }
  return (v) => {
    if (typeof v !== 'string') return false
    const k = compare(v, s)
    return op === '>' ? k > 0 : op === '<' ? k < 0 : op === '>=' ? k >= 0 : k <= 0
  }
}
