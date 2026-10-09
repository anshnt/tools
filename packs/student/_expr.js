// Safe maths expression compiler (no eval, no Function). Used by the scientific calculator and the graph plotter.
//   const { fn, vars } = compile('2sin(x)^2 + 3', { angle: 'deg' })
//   fn({ x: 30 })  ->  3.5
// Supports + - * / ^ ! % mod, implicit multiplication (2x, 2(3+1), (a)(b)), degrees (30°), unicode (× ÷ π √ ² ³),
// functions with or without brackets (sin x, sqrt(9), log(8, 2)), constants and caller-supplied variables.

export class ExprError extends Error {
  constructor(message, pos) {
    super(message)
    this.name = 'ExprError'
    this.pos = pos
  }
}

const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' }

// ---- number helpers ----
const FACT_CACHE = [1]
function gamma(z) {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z))
  z -= 1
  const g = 7
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]
  let x = c[0]
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i)
  const t = z + g + 0.5
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x
}
export function factorial(n) {
  if (n < 0 && Number.isInteger(n)) return NaN
  if (Number.isInteger(n)) {
    if (n > 170) return Infinity
    for (let i = FACT_CACHE.length; i <= n; i++) FACT_CACHE[i] = FACT_CACHE[i - 1] * i
    return FACT_CACHE[n]
  }
  return gamma(n + 1)
}
const isInt = (n) => Number.isInteger(n)
function nCr(n, r) {
  if (!isInt(n) || !isInt(r) || n < 0 || r < 0 || r > n) return NaN
  r = Math.min(r, n - r)
  let v = 1
  for (let i = 1; i <= r; i++) v = (v * (n - r + i)) / i
  return Math.round(v)
}
function nPr(n, r) {
  if (!isInt(n) || !isInt(r) || n < 0 || r < 0 || r > n) return NaN
  let v = 1
  for (let i = 0; i < r; i++) v *= n - i
  return v
}
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a }
const snap = (v) => (Math.abs(v) < 1e-15 ? 0 : v)
const mod = (a, b) => (b === 0 ? NaN : a - b * Math.floor(a / b))

const CONSTS = { pi: Math.PI, tau: 2 * Math.PI, e: Math.E, phi: (1 + Math.sqrt(5)) / 2 }

function makeFuncs(angle) {
  const toRad = angle === 'deg' ? (x) => (x * Math.PI) / 180 : (x) => x
  const fromRad = angle === 'deg' ? (x) => (x * 180) / Math.PI : (x) => x
  const tan = (x) => {
    if (angle === 'deg') {
      const m = mod(x, 180)
      if (m === 90) return NaN
    }
    const v = Math.tan(toRad(x))
    return Math.abs(v) > 1e15 ? NaN : snap(v)
  }
  return {
    sin: (x) => (angle === 'deg' && mod(x, 180) === 0 ? 0 : snap(Math.sin(toRad(x)))),
    cos: (x) => (angle === 'deg' && mod(x - 90, 180) === 0 ? 0 : snap(Math.cos(toRad(x)))),
    tan,
    sec: (x) => { const c = Math.cos(toRad(x)); return Math.abs(c) < 1e-15 ? NaN : 1 / c },
    csc: (x) => { const s = Math.sin(toRad(x)); return Math.abs(s) < 1e-15 ? NaN : 1 / s },
    cot: (x) => { const t = tan(x); return t === 0 ? NaN : 1 / t },
    asin: (x) => fromRad(Math.asin(x)),
    acos: (x) => fromRad(Math.acos(x)),
    atan: (x) => fromRad(Math.atan(x)),
    atan2: (y, x) => fromRad(Math.atan2(y, x)),
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
    sqrt: Math.sqrt, cbrt: Math.cbrt,
    root: (x, n) => (x < 0 && n % 2 !== 0 && isInt(n) ? -Math.pow(-x, 1 / n) : Math.pow(x, 1 / n)),
    ln: Math.log, log10: Math.log10, log2: Math.log2,
    log: (x, b) => (b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b)),
    exp: Math.exp, expm1: Math.expm1,
    abs: Math.abs, sign: Math.sign, floor: Math.floor, ceil: Math.ceil, trunc: Math.trunc,
    round: (x, d = 0) => { const k = Math.pow(10, d); return Math.round((x + Number.EPSILON * Math.sign(x)) * k) / k },
    fract: (x) => x - Math.trunc(x),
    fact: factorial, factorial, gamma: (x) => (isInt(x) && x > 0 ? factorial(x - 1) : gamma(x)),
    ncr: nCr, comb: nCr, npr: nPr, perm: nPr,
    min: Math.min, max: Math.max, hypot: Math.hypot, pow: Math.pow, mod,
    gcd: (a, b) => (isInt(a) && isInt(b) ? gcd(a, b) : NaN),
    lcm: (a, b) => (isInt(a) && isInt(b) ? (a && b ? Math.abs(a * b) / gcd(a, b) : 0) : NaN),
    deg: (x) => (x * 180) / Math.PI,
    rad: (x) => (x * Math.PI) / 180,
  }
}
/** Names a user can type as functions (for autocomplete and docs). */
export const FUNCTION_NAMES = Object.keys(makeFuncs('rad')).filter((n) => !n.startsWith('_'))
const FUNCS = makeFuncs('rad')
const FN_BY_LEN = [...FUNCTION_NAMES].sort((a, b) => b.length - a.length)

// ---- tokenizer ----
function tokenize(src) {
  const toks = []
  let i = 0
  const s = String(src)
  const push = (type, value, pos) => toks.push({ type, value, pos })
  while (i < s.length) {
    const ch = s[i]
    if (/\s/.test(ch)) { i++; continue }
    if (/[0-9.]/.test(ch)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i))
      if (!m) throw new ExprError(`Unexpected "${ch}"`, i)
      push('num', parseFloat(m[0]), i)
      i += m[0].length
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(s.slice(i))
      push('id', m[0], i)
      i += m[0].length
      continue
    }
    if (SUP[ch] !== undefined) {
      let d = ''
      const start = i
      while (SUP[s[i]] !== undefined) d += SUP[s[i++]]
      push('op', '^', start); push('num', +d, start)
      continue
    }
    if (ch === '*' && s[i + 1] === '*') { push('op', '^', i); i += 2; continue }
    const map = { '×': '*', '·': '*', '⋅': '*', '÷': '/', '−': '-', '–': '-', 'π': 'pi', '√': 'sqrt', '°': 'deg_post' }
    const c = map[ch] || ch
    if (c === 'pi' || c === 'sqrt') { push('id', c, i); i++; continue }
    if (c === 'deg_post') { push('post', '°', i); i++; continue }
    if ('+-*/^!%(),'.includes(c)) { push(c === '!' || c === '%' ? 'post' : 'op', c, i); i++; continue }
    if (c === '[' || c === '{') { push('op', '(', i); i++; continue }
    if (c === ']' || c === '}') { push('op', ')', i); i++; continue }
    throw new ExprError(`Unexpected "${ch}"`, i)
  }
  return toks
}

// Split a run of letters like "sinx" or "ax" into function and variable tokens when it is not a known name.
function splitIdent(id, known, nextIsParen) {
  if (!/^[A-Za-z]+$/.test(id)) return null
  const lower = id.toLowerCase()
  if (Object.hasOwn(FUNCS, lower) || Object.hasOwn(CONSTS, lower) || known(id)) return null
  const out = []
  let rest = id
  let found = false
  while (rest) {
    const f = FN_BY_LEN.find((n) => rest.toLowerCase().startsWith(n))
    if (f) { out.push(f); rest = rest.slice(f.length); found = true; continue }
    const k = ['pi', 'tau', 'phi'].find((n) => rest.toLowerCase().startsWith(n))
    if (k) { out.push(k); rest = rest.slice(k.length); found = true; continue }
    out.push(rest[0]); rest = rest.slice(1)
  }
  if (out.length < 2) return null
  if (!found && (id.length > 3 || nextIsParen)) return null
  return out
}

/**
 * compile(src, {angle: 'rad'|'deg', known: (name) => bool}) -> {fn(scope) -> number, vars: Set<string>, usesFunctions: Set<string>}
 * Unknown names become variables looked up in scope at call time (missing ones throw ExprError).
 */
export function compile(src, { angle = 'rad', known = () => false } = {}) {
  if (!String(src).trim()) throw new ExprError('Type an expression', 0)
  let toks = tokenize(src)
  // expand run-together identifiers (sinx -> sin x)
  const expanded = []
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]
    const nextIsParen = toks[k + 1]?.type === 'op' && toks[k + 1].value === '('
    const parts = t.type === 'id' ? splitIdent(t.value, known, nextIsParen) : null
    if (parts) parts.forEach((p) => expanded.push({ type: 'id', value: p, pos: t.pos })); else expanded.push(t)
  }
  toks = expanded
  const F = makeFuncs(angle)
  const vars = new Set()
  const usesFunctions = new Set()
  let p = 0
  const peek = () => toks[p]
  const next = () => toks[p++]
  const isOp = (v) => peek() && peek().type === 'op' && peek().value === v
  const isFn = (t) => t && t.type === 'id' && Object.hasOwn(F, t.value.toLowerCase())
  const startsOperand = (t) => t && (t.type === 'num' || t.type === 'id' || (t.type === 'op' && t.value === '('))

  function parseAddSub() {
    let left = parseMulDiv()
    while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = next().value
      const right = parseMulDiv()
      const a = left
      if (right.pct) {
        // 100 + 10% means 100 + 10% of 100
        const r = right.fn
        left = { fn: (sc) => { const x = a.fn(sc); return op === '+' ? x + x * r(sc) : x - x * r(sc) } }
      } else {
        const b = right
        left = { fn: op === '+' ? (sc) => a.fn(sc) + b.fn(sc) : (sc) => a.fn(sc) - b.fn(sc) }
      }
    }
    return left
  }
  function parseMulDiv() {
    let left = parseUnary()
    for (;;) {
      const t = peek()
      if (!t) break
      let op = null
      if (t.type === 'op' && (t.value === '*' || t.value === '/')) { op = t.value; next() }
      else if (t.type === 'id' && t.value.toLowerCase() === 'mod') { op = 'mod'; next() }
      else if (startsOperand(t) && !(t.type === 'op' && t.value === ')')) op = 'imp'
      else break
      const right = op === 'imp' ? parsePowerChain() : parseUnary()
      const a = left, b = right
      if (op === '/') left = { fn: (sc) => a.fn(sc) / b.fn(sc) }
      else if (op === 'mod') left = { fn: (sc) => mod(a.fn(sc), b.fn(sc)) }
      else left = { fn: (sc) => a.fn(sc) * b.fn(sc) }
    }
    return left
  }
  // implicit multiplication operand: a power-level factor (so 2x^2 is 2*(x^2))
  function parsePowerChain() { return parsePower() }
  function parseUnary() {
    const t = peek()
    if (t && t.type === 'op' && (t.value === '-' || t.value === '+')) {
      next()
      const v = parseUnary()
      return t.value === '-' ? { fn: (sc) => -v.fn(sc) } : v
    }
    return parsePower()
  }
  function parsePower() {
    const base = parsePostfix()
    if (isOp('^')) {
      next()
      const exp = parseUnary() // right associative, allows 2^-3
      return { fn: (sc) => Math.pow(base.fn(sc), exp.fn(sc)) }
    }
    return base
  }
  function parsePostfix() {
    let v = parsePrimary()
    while (peek() && peek().type === 'post') {
      const t = next()
      const a = v
      if (t.value === '!') v = { fn: (sc) => factorial(a.fn(sc)) }
      else if (t.value === '%') v = { fn: (sc) => a.fn(sc) / 100, pct: true }
      else v = { fn: angle === 'deg' ? (sc) => a.fn(sc) : (sc) => (a.fn(sc) * Math.PI) / 180 }
    }
    return v
  }
  function parseArgs() {
    const args = []
    if (isOp(')')) { next(); return args }
    for (;;) {
      args.push(parseAddSub())
      if (isOp(',')) { next(); continue }
      if (isOp(')')) { next(); return args }
      throw new ExprError(peek() ? `Expected ")" or "," but found "${peek().value}"` : 'Missing closing bracket', peek()?.pos ?? src.length)
    }
  }
  function parsePrimary() {
    const t = next()
    if (!t) throw new ExprError('The expression ends too early', String(src).length)
    if (t.type === 'num') { const n = t.value; return { fn: () => n } }
    if (t.type === 'op' && t.value === '(') {
      const v = parseAddSub()
      if (!isOp(')')) throw new ExprError('Missing closing bracket', peek()?.pos ?? String(src).length)
      next()
      return v
    }
    if (t.type === 'id') {
      const name = t.value
      const low = name.toLowerCase()
      if (isFn(t)) {
        usesFunctions.add(low)
        const f = F[low]
        let args
        if (isOp('(')) { next(); args = parseArgs() }
        else if (startsOperand(peek())) args = [parseFnOperand()]
        else throw new ExprError(`${name} needs a value, like ${name}(2)`, t.pos)
        const fa = args.map((a) => a.fn)
        if (fa.length === 1) { const a0 = fa[0]; return { fn: (sc) => f(a0(sc)) } }
        return { fn: (sc) => f(...fa.map((g) => g(sc))) }
      }
      if (Object.hasOwn(CONSTS, low) && !known(name)) { const c = CONSTS[low]; return { fn: () => c } }
      if (name.length > 1 && !known(name) && peek() && peek().type === 'op' && peek().value === '(') throw new ExprError(`Unknown function "${name}"`, t.pos)
      vars.add(name)
      return { fn: (sc) => {
        const v = sc?.[name]
        if (v === undefined) throw new ExprError(`"${name}" has no value yet`, t.pos)
        return v
      } }
    }
    if (t.type === 'op' && (t.value === ')' || t.value === ',')) throw new ExprError(`Unexpected "${t.value}"`, t.pos)
    throw new ExprError(`Unexpected "${t.value}"`, t.pos)
  }
  // sin 2x, sqrt 9: the operand of a bracket-less function is a run of juxtaposed power-level factors
  function parseFnOperand() {
    let v = parseUnary()
    while (startsOperand(peek()) && !(peek().type === 'id' && peek().value.toLowerCase() === 'mod')) {
      const a = v
      const b = parsePower()
      v = { fn: (sc) => a.fn(sc) * b.fn(sc) }
    }
    return v
  }

  const tree = parseAddSub()
  if (p < toks.length) {
    const t = toks[p]
    throw new ExprError(t.type === 'op' && t.value === ')' ? 'Unmatched closing bracket' : `Unexpected "${t.value}"`, t.pos)
  }
  return { fn: tree.fn, vars, usesFunctions }
}

/** One-shot evaluate. Throws ExprError for bad input. */
export function evaluate(src, scope = {}, opts) {
  return compile(src, opts).fn(scope)
}

/** Display a number the way a calculator would: 12 significant digits, no 0.30000000000000004, sensible scientific notation. */
export function formatNum(n, { digits = 12, grouping = false } = {}) {
  if (Number.isNaN(n)) return 'Undefined'
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '-∞'
  if (n === 0) return '0'
  const abs = Math.abs(n)
  if (Number.isInteger(n) && abs < 1e15) return grouping ? n.toLocaleString('en-US') : String(n)
  if (abs >= 1e15 || abs < 1e-9) {
    const [m, e] = n.toExponential(digits - 1).split('e')
    return `${trimZeros(m)}e${e.replace('+', '')}`
  }
  let s = Number(n.toPrecision(digits)).toString()
  if (/e/i.test(s)) s = Number(n.toPrecision(digits)).toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 })
  if (grouping) {
    const [i, f] = s.split('.')
    s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? `.${f}` : '')
  }
  return s
}
const trimZeros = (m) => (m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m)
