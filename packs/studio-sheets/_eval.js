// AST evaluator: references, operators with array broadcasting, function calls. No DOM.
//   env = { host, sid, r, c, dr, dc }  host supplies cell access (see _model.js).
import { MAXR, MAXC } from './_a1.js'
import { XErr, E, Ref, errFor, isMat, toNum, toStr, fin, compare } from './_val.js'
import { FUNCS, clip } from './_funcs.js'

const sheetOf = (n, env) => {
  if (n.sh == null) return env.sid
  const id = env.host.sheetId(n.sh)
  if (id === undefined) throw E.REF
  return id
}
const deref = (env, x) => (x instanceof Ref ? (x.single ? env.host.value(x.sid, x.r1, x.c1) : env.host.matrix(x)) : x)

function arith(op, a, b) {
  if (a instanceof XErr) return a
  if (b instanceof XErr) return b
  try {
    switch (op) {
      case '+': return fin(toNum(a) + toNum(b))
      case '-': return fin(toNum(a) - toNum(b))
      case '*': return fin(toNum(a) * toNum(b))
      case '/': { const d = toNum(b); if (d === 0) return E.DIV0; return fin(toNum(a) / d) }
      case '^': { const x = toNum(a), y = toNum(b); if (x === 0 && y === 0) return E.NUM; const r = Math.pow(x, y); if (Number.isNaN(r)) return E.NUM; return fin(r) }
      case '&': return toStr(a) + toStr(b)
      case '=': return compare(a, b) === 0
      case '<>': return compare(a, b) !== 0
      case '<': return compare(a, b) < 0
      case '>': return compare(a, b) > 0
      case '<=': return compare(a, b) <= 0
      case '>=': return compare(a, b) >= 0
      default: return E.VALUE
    }
  } catch (e) {
    if (e instanceof XErr) return e
    throw e
  }
}

/** Apply f over scalars or matrices, broadcasting singleton dimensions. */
export function broadcast(a, b, f) {
  const am = isMat(a), bm = isMat(b)
  if (!am && !bm) return f(a, b)
  const ra = am ? a.length : 1, ca = am ? a[0].length : 1, rb = bm ? b.length : 1, cb = bm ? b[0].length : 1
  const R = Math.max(ra, rb), C = Math.max(ca, cb)
  const out = []
  for (let i = 0; i < R; i++) {
    const row = []
    for (let j = 0; j < C; j++) {
      if ((ra !== 1 && ra !== R && i >= ra) || (rb !== 1 && rb !== R && i >= rb) || (ca !== 1 && j >= ca) || (cb !== 1 && j >= cb)) { row.push(E.NA); continue }
      const x = am ? a[ra === 1 ? 0 : i][ca === 1 ? 0 : j] : a
      const y = bm ? b[rb === 1 ? 0 : i][cb === 1 ? 0 : j] : b
      row.push(f(x, y))
    }
    out.push(row)
  }
  return out
}

const OUT = Symbol('out')
const pick = (v, i, j) => {
  if (!isMat(v)) return v
  const row = v.length === 1 ? v[0] : v[i]
  if (!row) return OUT
  const x = v[0].length === 1 ? row[0] : row[j]
  return x === undefined ? OUT : x
}
function callScalar(def, env, args) {
  const vals = args.map((a) => deref(env, a))
  if (!def.errOk) for (const v of vals) if (v instanceof XErr) return v
  if (!vals.some(isMat)) return def.f(...vals)
  const R = Math.max(...vals.map((v) => (isMat(v) ? v.length : 1))), C = Math.max(...vals.map((v) => (isMat(v) ? v[0].length : 1)))
  const out = []
  for (let i = 0; i < R; i++) {
    const row = []
    for (let j = 0; j < C; j++) {
      const xs = vals.map((v) => pick(v, i, j))
      if (xs.includes(OUT)) { row.push(E.NA); continue }
      const bad = !def.errOk && xs.find((x) => x instanceof XErr)
      if (bad) { row.push(bad); continue }
      try { row.push(def.f(...xs)) } catch (e) { if (e instanceof XErr) row.push(e); else throw e }
    }
    out.push(row)
  }
  return out
}

function ev(n, env) {
  switch (n.t) {
    case 'num': case 'str': case 'bool': return n.v
    case 'err': return errFor(n.v)
    case 'empty': return undefined
    case 'par': return ev(n.e, env)
    case 'ref': {
      const sid = sheetOf(n, env)
      const r = n.ra ? n.r : n.r + env.dr, c = n.ca ? n.c : n.c + env.dc
      if (r < 0 || c < 0 || r >= MAXR || c >= MAXC) return E.REF
      return new Ref(sid, r, c, r, c)
    }
    case 'range': {
      const sid = sheetOf(n, env)
      const r1 = n.k === 'col' || n.a[0] ? n.r1 : n.r1 + env.dr, r2 = n.k === 'col' || n.a[2] ? n.r2 : n.r2 + env.dr
      const c1 = n.k === 'row' || n.a[1] ? n.c1 : n.c1 + env.dc, c2 = n.k === 'row' || n.a[3] ? n.c2 : n.c2 + env.dc
      if (r1 < 0 || c1 < 0 || r2 >= MAXR || c2 >= MAXC) return E.REF
      return new Ref(sid, Math.min(r1, r2), Math.min(c1, c2), Math.max(r1, r2), Math.max(c1, c2))
    }
    case 'rng': {
      const a = ev(n.a, env), b = ev(n.b, env)
      if (a instanceof XErr) return a
      if (b instanceof XErr) return b
      if (!(a instanceof Ref) || !(b instanceof Ref) || a.sid !== b.sid) return E.VALUE
      return new Ref(a.sid, Math.min(a.r1, b.r1), Math.min(a.c1, b.c1), Math.max(a.r2, b.r2), Math.max(a.c2, b.c2))
    }
    case 'name': return E.NAME
    case 'arr': return n.rows.map((row) => row.map((x) => { const v = deref(env, ev(x, env)); return v === undefined ? null : v }))
    case 'un': {
      const v = deref(env, ev(n.e, env))
      if (n.op === '+') return v
      return broadcast(v, 0, (x) => { if (x instanceof XErr) return x; try { const r = -toNum(x); return r === 0 ? 0 : r } catch (e) { if (e instanceof XErr) return e; throw e } })
    }
    case 'pct': {
      const v = deref(env, ev(n.e, env))
      return broadcast(v, 0, (x) => { if (x instanceof XErr) return x; try { return toNum(x) / 100 } catch (e) { if (e instanceof XErr) return e; throw e } })
    }
    case 'bin': {
      const a = deref(env, ev(n.l, env)), b = deref(env, ev(n.r, env))
      return broadcast(a, b, (x, y) => arith(n.op, x, y))
    }
    case 'fn': {
      const def = FUNCS[n.name]
      if (!def) return E.NAME
      const argc = n.args.length
      if (argc < def.min || argc > def.max) return E.VALUE
      if (def.kind === 'l') return def.f(env, n.args, (x) => ev(x, env))
      const args = n.args.map((x) => ev(x, env))
      if (def.kind === 'a') { try { return def.f(env, args) } catch (e) { if (e instanceof XErr) return e; throw e } }
      try { return callScalar(def, env, args) } catch (e) { if (e instanceof XErr) return e; throw e }
    }
    default: return E.VALUE
  }
}

/** Evaluate an AST; never throws. */
export function evaluate(ast, env) {
  try {
    return ev(ast, env)
  } catch (e) {
    if (e instanceof XErr) return e
    if (e instanceof RangeError) return E.VALUE
    console.error('formula error', e)
    return E.VALUE
  }
}

/** Turn an evaluation result into a final cell result: a scalar, or a matrix to spill. */
export function settle(env, v) {
  if (v instanceof Ref) {
    if (v.single) v = env.host.value(v.sid, v.r1, v.c1)
    else v = env.host.matrix(v.rows * v.cols > 400000 ? clip(env, v) : v)
  }
  if (isMat(v)) {
    if (!v.length || !v[0].length) return E.VALUE
    if (v.length === 1 && v[0].length === 1) v = v[0][0]
    else return v.map((r) => r.map((x) => (x == null ? 0 : x)))
  }
  return v == null ? 0 : v
}
