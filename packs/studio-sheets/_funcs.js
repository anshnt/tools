// Spreadsheet function library: 170+ functions. No DOM. Each entry: name, category, signature, description and an implementation.
//   kind 's': scalar function (arguments are dereferenced and broadcast over arrays), f(...values)
//   kind 'a': raw arguments (Ref | matrix | scalar), f(env, args)
//   kind 'l': lazy, f(env, argNodes, ev) evaluates only the arguments it needs
import { XErr, E, Ref, isErr, isMat, toNum, toStr, toBool, toInt, fin, compare, makeCriteria, wildcard, strToNum } from './_val.js'
import { formatValue, serialParts, ymdToSerial, todaySerial, nowSerial, parseInput, MONTHS, DAYS } from './_fmt.js'
import { colName } from './_a1.js'

export const FUNCS = Object.create(null)
export const VOLATILE = new Set(['TODAY', 'NOW', 'RAND', 'RANDBETWEEN', 'OFFSET', 'INDIRECT', 'RANDARRAY'])
export const CATS = ['Math', 'Statistical', 'Logical', 'Text', 'Lookup', 'Date', 'Financial', 'Information']

function reg(kind, name, cat, sig, desc, f, opts = {}) {
  const parts = sig.split(',').map((s) => s.trim()).filter(Boolean)
  const real = parts.filter((p) => p !== '...')
  FUNCS[name] = { name, kind, cat, sig, desc, min: real.filter((p) => !p.startsWith('[')).length, max: sig.includes('...') ? Infinity : real.length, f, ...opts }
}
const S = (n, c, s, d, f, o) => reg('s', n, c, s, d, f, o)
const A = (n, c, s, d, f, o) => reg('a', n, c, s, d, f, o)
const L = (n, c, s, d, f, o) => reg('l', n, c, s, d, f, o)
const alias = (name, of) => { FUNCS[name] = { ...FUNCS[of], name } }

// ---------- helpers ----------
export function matOf(env, x) {
  if (x instanceof Ref) return env.host.matrix(x)
  if (isMat(x)) return x
  return [[x === undefined ? null : x]]
}
/** Ref clipped to the used part of its sheet (safe for whole-column references). */
export function clip(env, ref) {
  const ex = env.host.extent(ref.sid)
  return ref.sub(ref.r1, ref.c1, Math.max(ref.r1, Math.min(ref.r2, ex.r)), Math.max(ref.c1, Math.min(ref.c2, ex.c)))
}
const cmat = (env, x) => (x instanceof Ref ? env.host.matrix(clip(env, x)) : matOf(env, x))
const flat = (env, x) => cmat(env, x).flat()
function eachArg(env, args, fn) {
  for (const a of args) {
    if (a instanceof Ref) env.host.iter(a, (v) => fn(v, false))
    else if (isMat(a)) for (const row of a) for (const v of row) fn(v, false)
    else if (a !== undefined) fn(a, true)
  }
}
function numsOf(env, args) {
  const out = []
  eachArg(env, args, (v, direct) => {
    if (typeof v === 'number') out.push(v)
    else if (v instanceof XErr) throw v
    else if (direct) { if (v === null) return; out.push(toNum(v)) }
  })
  return out
}
const numsStrict = (env, x) => { const o = []; for (const v of flat(env, x)) { if (v instanceof XErr) throw v; if (typeof v === 'number') o.push(v) } return o }
const mapMat = (m, f) => m.map((r) => r.map(f))
function rnd(x, d, fn) {
  const a = Math.abs(x)
  const s = a.toPrecision(15)
  const scaled = /e/.test(s) ? a * Math.pow(10, d) : +(s + 'e' + d)
  const r = fn(scaled)
  const back = +(`${r}e${-d}`)
  return Math.sign(x) * (Number.isNaN(back) ? r / Math.pow(10, d) : back)
}
const dnum = (v) => { if (typeof v === 'string') { const n = strToNum(v); if (n === null) throw E.VALUE; return n } return toNum(v) }
const serialDate = (v) => Math.floor(dnum(v))
const eqVal = (a, b) => a === b || (a == null && b === '') || (a === '' && b == null) || (typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase())

// ================= MATH =================
A('SUM', 'Math', 'number1, [number2], ...', 'Adds numbers and ranges.', (env, a) => numsOf(env, a).reduce((x, y) => x + y, 0))
A('PRODUCT', 'Math', 'number1, [number2], ...', 'Multiplies numbers and ranges.', (env, a) => { const n = numsOf(env, a); return n.length ? fin(n.reduce((x, y) => x * y, 1)) : 0 })
A('SUMSQ', 'Math', 'number1, [number2], ...', 'Sum of the squares.', (env, a) => numsOf(env, a).reduce((x, y) => x + y * y, 0))
S('ABS', 'Math', 'number', 'Absolute value.', (x) => Math.abs(toNum(x)))
S('SIGN', 'Math', 'number', 'Returns -1, 0 or 1.', (x) => Math.sign(toNum(x)))
S('ROUND', 'Math', 'number, num_digits', 'Rounds to a number of digits (half away from zero).', (x, d) => rnd(toNum(x), toInt(d), Math.round))
S('ROUNDUP', 'Math', 'number, num_digits', 'Rounds away from zero.', (x, d) => rnd(toNum(x), toInt(d), Math.ceil))
S('ROUNDDOWN', 'Math', 'number, num_digits', 'Rounds toward zero.', (x, d) => rnd(toNum(x), toInt(d), Math.floor))
S('MROUND', 'Math', 'number, multiple', 'Rounds to the nearest multiple.', (x, m) => { x = toNum(x); m = toNum(m); if (m === 0) return 0; if (x * m < 0) throw E.NUM; return Math.round(x / m) * m })
S('CEILING', 'Math', 'number, [significance]', 'Rounds up to a multiple.', (x, s) => { x = toNum(x); s = s === undefined ? (x < 0 ? -1 : 1) : toNum(s); if (s === 0) return 0; if (x > 0 && s < 0) throw E.NUM; return Math.ceil(x / s - 1e-12) * s })
S('FLOOR', 'Math', 'number, [significance]', 'Rounds down to a multiple.', (x, s) => { x = toNum(x); s = s === undefined ? (x < 0 ? -1 : 1) : toNum(s); if (s === 0) throw E.DIV0; if (x > 0 && s < 0) throw E.NUM; return Math.floor(x / s + 1e-12) * s })
S('INT', 'Math', 'number', 'Rounds down to the nearest integer.', (x) => Math.floor(toNum(x)))
S('TRUNC', 'Math', 'number, [num_digits]', 'Truncates to a number of digits.', (x, d) => rnd(toNum(x), d === undefined ? 0 : toInt(d), Math.floor))
S('MOD', 'Math', 'number, divisor', 'Remainder after division (sign of the divisor).', (n, d) => { n = toNum(n); d = toNum(d); if (d === 0) throw E.DIV0; return n - d * Math.floor(n / d) })
S('QUOTIENT', 'Math', 'numerator, denominator', 'Integer part of a division.', (n, d) => { d = toNum(d); if (d === 0) throw E.DIV0; return Math.trunc(toNum(n) / d) })
S('POWER', 'Math', 'number, power', 'Raises a number to a power.', (x, p) => fin(Math.pow(toNum(x), toNum(p))))
S('SQRT', 'Math', 'number', 'Square root.', (x) => { x = toNum(x); if (x < 0) throw E.NUM; return Math.sqrt(x) })
S('EXP', 'Math', 'number', 'e raised to a power.', (x) => fin(Math.exp(toNum(x))))
S('LN', 'Math', 'number', 'Natural logarithm.', (x) => { x = toNum(x); if (x <= 0) throw E.NUM; return Math.log(x) })
S('LOG', 'Math', 'number, [base]', 'Logarithm to a base (default 10).', (x, b) => { x = toNum(x); b = b === undefined ? 10 : toNum(b); if (x <= 0 || b <= 0 || b === 1) throw E.NUM; return Math.log(x) / Math.log(b) })
S('LOG10', 'Math', 'number', 'Base-10 logarithm.', (x) => { x = toNum(x); if (x <= 0) throw E.NUM; return Math.log10(x) })
S('PI', 'Math', '', 'The number pi.', () => Math.PI)
S('SIN', 'Math', 'number', 'Sine (radians).', (x) => Math.sin(toNum(x)))
S('COS', 'Math', 'number', 'Cosine (radians).', (x) => Math.cos(toNum(x)))
S('TAN', 'Math', 'number', 'Tangent (radians).', (x) => Math.tan(toNum(x)))
S('ASIN', 'Math', 'number', 'Arcsine.', (x) => fin(Math.asin(toNum(x))))
S('ACOS', 'Math', 'number', 'Arccosine.', (x) => fin(Math.acos(toNum(x))))
S('ATAN', 'Math', 'number', 'Arctangent.', (x) => Math.atan(toNum(x)))
S('ATAN2', 'Math', 'x_num, y_num', 'Arctangent from coordinates.', (x, y) => Math.atan2(toNum(y), toNum(x)))
S('DEGREES', 'Math', 'angle', 'Radians to degrees.', (x) => (toNum(x) * 180) / Math.PI)
S('RADIANS', 'Math', 'angle', 'Degrees to radians.', (x) => (toNum(x) * Math.PI) / 180)
S('EVEN', 'Math', 'number', 'Rounds up to the nearest even integer.', (x) => { x = toNum(x); const r = 2 * Math.ceil(Math.abs(x) / 2); return x < 0 ? -r : r })
S('ODD', 'Math', 'number', 'Rounds up to the nearest odd integer.', (x) => { x = toNum(x); let r = Math.ceil(Math.abs(x)); if (r % 2 === 0) r++; return x < 0 ? -r : r })
S('FACT', 'Math', 'number', 'Factorial.', (x) => { x = Math.trunc(toNum(x)); if (x < 0 || x > 170) throw E.NUM; let r = 1; for (let i = 2; i <= x; i++) r *= i; return r })
S('COMBIN', 'Math', 'number, number_chosen', 'Number of combinations.', (n, k) => { n = toInt(n); k = toInt(k); if (n < 0 || k < 0 || k > n) throw E.NUM; let r = 1; for (let i = 1; i <= Math.min(k, n - k); i++) r = (r * (n - i + 1)) / i; return Math.round(r) })
S('PERMUT', 'Math', 'number, number_chosen', 'Number of permutations.', (n, k) => { n = toInt(n); k = toInt(k); if (n < 0 || k < 0 || k > n) throw E.NUM; let r = 1; for (let i = 0; i < k; i++) r *= n - i; return r })
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a }
A('GCD', 'Math', 'number1, [number2], ...', 'Greatest common divisor.', (env, a) => numsOf(env, a).map(Math.trunc).reduce(gcd, 0))
A('LCM', 'Math', 'number1, [number2], ...', 'Least common multiple.', (env, a) => numsOf(env, a).map(Math.trunc).reduce((x, y) => (x && y ? Math.abs(x * y) / gcd(x, y) : 0), 1))
S('RAND', 'Math', '', 'Random number between 0 and 1 (recalculates).', () => Math.random())
S('RANDBETWEEN', 'Math', 'bottom, top', 'Random integer between two numbers.', (a, b) => { a = Math.ceil(toNum(a)); b = Math.floor(toNum(b)); if (a > b) throw E.NUM; return a + Math.floor(Math.random() * (b - a + 1)) })
A('SUMPRODUCT', 'Math', 'array1, [array2], ...', 'Multiplies arrays element by element and adds the results.', (env, args) => {
  const ms = args.map((a) => matOf(env, a))
  const R = ms[0].length, C = ms[0][0].length
  if (ms.some((m) => m.length !== R || m[0].length !== C)) throw E.VALUE
  let sum = 0
  for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
    let p = 1
    for (const m of ms) { const v = m[i][j]; if (v instanceof XErr) throw v; p *= typeof v === 'number' ? v : typeof v === 'boolean' ? 0 : 0 }
    sum += p
  }
  return sum
})
A('SUBTOTAL', 'Math', 'function_num, ref1, [ref2], ...', 'Aggregate that skips hidden and filtered rows (101-111) or only filtered ones (1-11).', (env, [fnum, ...refs]) => {
  const code = toInt(fnum), base = code > 100 ? code - 100 : code
  const vals = []
  for (const a of refs) {
    if (a instanceof Ref) env.host.iter(a, (v, r) => { if (!env.host.rowHidden(a.sid, r, code > 100) && typeof v === 'number') vals.push(v) })
    else for (const v of flat(env, a)) if (typeof v === 'number') vals.push(v)
  }
  const n = vals.length, sum = vals.reduce((x, y) => x + y, 0)
  switch (base) {
    case 1: if (!n) throw E.DIV0; return sum / n
    case 2: case 3: return n
    case 4: return n ? Math.max(...vals) : 0
    case 5: return n ? Math.min(...vals) : 0
    case 6: return vals.reduce((x, y) => x * y, 1)
    case 7: return stdev(vals, true)
    case 8: return stdev(vals, false)
    case 9: return sum
    case 10: return variance(vals, true)
    case 11: return variance(vals, false)
    default: throw E.VALUE
  }
})

// ================= STATISTICAL =================
const variance = (v, sample) => { const n = v.length; if (n < (sample ? 2 : 1)) throw E.DIV0; const m = v.reduce((a, b) => a + b, 0) / n; return v.reduce((a, b) => a + (b - m) ** 2, 0) / (sample ? n - 1 : n) }
const stdev = (v, sample) => Math.sqrt(variance(v, sample))
A('AVERAGE', 'Statistical', 'number1, [number2], ...', 'Average of numbers.', (env, a) => { const n = numsOf(env, a); if (!n.length) throw E.DIV0; return n.reduce((x, y) => x + y, 0) / n.length })
A('MIN', 'Statistical', 'number1, [number2], ...', 'Smallest number.', (env, a) => { const n = numsOf(env, a); return n.length ? n.reduce((x, y) => (y < x ? y : x)) : 0 })
A('MAX', 'Statistical', 'number1, [number2], ...', 'Largest number.', (env, a) => { const n = numsOf(env, a); return n.length ? n.reduce((x, y) => (y > x ? y : x)) : 0 })
A('COUNT', 'Statistical', 'value1, [value2], ...', 'Counts cells that contain numbers.', (env, a) => { let c = 0; eachArg(env, a, (v, d) => { if (typeof v === 'number' || (d && typeof v === 'string' && strToNum(v) !== null)) c++ }); return c })
A('COUNTA', 'Statistical', 'value1, [value2], ...', 'Counts cells that are not empty.', (env, a) => { let c = 0; eachArg(env, a, (v) => { if (v !== null && v !== undefined) c++ }); return c })
A('COUNTBLANK', 'Statistical', 'range', 'Counts empty cells.', (env, [r]) => { if (!(r instanceof Ref)) return matOf(env, r).flat().filter((v) => v == null || v === '').length; let filled = 0; env.host.iter(r, (v) => { if (v !== '') filled++ }); return r.rows * r.cols - filled })
A('MEDIAN', 'Statistical', 'number1, [number2], ...', 'Middle value.', (env, a) => { const n = numsOf(env, a).sort((x, y) => x - y); if (!n.length) throw E.NUM; const m = n.length >> 1; return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2 })
A('MODE', 'Statistical', 'number1, [number2], ...', 'Most frequent value.', (env, a) => { const n = numsOf(env, a); const c = new Map(); let best = null, bc = 1; for (const v of n) { const k = (c.get(v) || 0) + 1; c.set(v, k); if (k > bc) { bc = k; best = v } } if (best === null) throw E.NA; return best })
alias('MODE.SNGL', 'MODE')
A('LARGE', 'Statistical', 'array, k', 'k-th largest value.', (env, [r, k]) => { const n = numsStrict(env, r).sort((a, b) => b - a); k = toInt(k); if (k < 1 || k > n.length) throw E.NUM; return n[k - 1] })
A('SMALL', 'Statistical', 'array, k', 'k-th smallest value.', (env, [r, k]) => { const n = numsStrict(env, r).sort((a, b) => a - b); k = toInt(k); if (k < 1 || k > n.length) throw E.NUM; return n[k - 1] })
A('RANK', 'Statistical', 'number, ref, [order]', 'Rank of a number in a list.', (env, [x, r, o]) => { x = toNum(x); const n = numsStrict(env, r); if (!n.includes(x)) throw E.NA; const asc = o !== undefined && toNum(o) !== 0; return 1 + n.filter((v) => (asc ? v < x : v > x)).length })
alias('RANK.EQ', 'RANK')
A('STDEV', 'Statistical', 'number1, [number2], ...', 'Sample standard deviation.', (env, a) => stdev(numsOf(env, a), true))
alias('STDEV.S', 'STDEV')
A('STDEVP', 'Statistical', 'number1, [number2], ...', 'Population standard deviation.', (env, a) => stdev(numsOf(env, a), false))
alias('STDEV.P', 'STDEVP')
A('VAR', 'Statistical', 'number1, [number2], ...', 'Sample variance.', (env, a) => variance(numsOf(env, a), true))
alias('VAR.S', 'VAR')
A('VARP', 'Statistical', 'number1, [number2], ...', 'Population variance.', (env, a) => variance(numsOf(env, a), false))
alias('VAR.P', 'VARP')
const percentile = (n, k) => { n = n.slice().sort((a, b) => a - b); if (!n.length || k < 0 || k > 1) throw E.NUM; const p = k * (n.length - 1), lo = Math.floor(p), hi = Math.ceil(p); return n[lo] + (n[hi] - n[lo]) * (p - lo) }
A('PERCENTILE', 'Statistical', 'array, k', 'k-th percentile (0 to 1).', (env, [r, k]) => percentile(numsStrict(env, r), toNum(k)))
alias('PERCENTILE.INC', 'PERCENTILE')
A('QUARTILE', 'Statistical', 'array, quart', 'Quartile of a data set (0 to 4).', (env, [r, q]) => { q = toInt(q); if (q < 0 || q > 4) throw E.NUM; return percentile(numsStrict(env, r), q / 4) })
alias('QUARTILE.INC', 'QUARTILE')
A('GEOMEAN', 'Statistical', 'number1, [number2], ...', 'Geometric mean.', (env, a) => { const n = numsOf(env, a); if (!n.length || n.some((x) => x <= 0)) throw E.NUM; return Math.exp(n.reduce((s, x) => s + Math.log(x), 0) / n.length) })
const pairs = (env, ys, xs) => { const y = flat(env, ys), x = flat(env, xs); if (y.length !== x.length) throw E.NA; const px = [], py = []; for (let i = 0; i < y.length; i++) if (typeof y[i] === 'number' && typeof x[i] === 'number') { py.push(y[i]); px.push(x[i]) } if (px.length < 2) throw E.DIV0; return [py, px] }
const reg2 = (py, px) => { const n = px.length, mx = px.reduce((a, b) => a + b, 0) / n, my = py.reduce((a, b) => a + b, 0) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (px[i] - mx) * (py[i] - my); sxx += (px[i] - mx) ** 2; syy += (py[i] - my) ** 2 } if (!sxx) throw E.DIV0; return { slope: sxy / sxx, mx, my, sxy, sxx, syy } }
A('CORREL', 'Statistical', 'array1, array2', 'Correlation coefficient.', (env, [a, b]) => { const [y, x] = pairs(env, a, b); const g = reg2(y, x); if (!g.syy) throw E.DIV0; return g.sxy / Math.sqrt(g.sxx * g.syy) })
A('SLOPE', 'Statistical', 'known_y, known_x', 'Slope of the regression line.', (env, [a, b]) => { const [y, x] = pairs(env, a, b); return reg2(y, x).slope })
A('INTERCEPT', 'Statistical', 'known_y, known_x', 'Intercept of the regression line.', (env, [a, b]) => { const [y, x] = pairs(env, a, b); const g = reg2(y, x); return g.my - g.slope * g.mx })
A('RSQ', 'Statistical', 'known_y, known_x', 'R squared of the regression.', (env, [a, b]) => { const [y, x] = pairs(env, a, b); const g = reg2(y, x); if (!g.syy) throw E.DIV0; return (g.sxy * g.sxy) / (g.sxx * g.syy) })
A('FORECAST', 'Statistical', 'x, known_y, known_x', 'Predicts a value along a linear trend.', (env, [x, a, b]) => { const [y, xs] = pairs(env, a, b); const g = reg2(y, xs); return g.my + g.slope * (toNum(x) - g.mx) })
alias('FORECAST.LINEAR', 'FORECAST')

// conditional aggregation
function alignedMats(env, refs) {
  const clipped = refs.map((r) => (r instanceof Ref ? clip(env, r) : null))
  const rows = Math.max(...refs.map((r, i) => (r instanceof Ref ? clipped[i].rows : matOf(env, r).length)))
  const cols = Math.max(...refs.map((r, i) => (r instanceof Ref ? clipped[i].cols : matOf(env, r)[0].length)))
  return refs.map((r) => {
    if (!(r instanceof Ref)) return matOf(env, r)
    const rr = r.sub(r.r1, r.c1, Math.min(r.r2, r.r1 + rows - 1), Math.min(r.c2, r.c1 + cols - 1))
    return env.host.matrix(rr)
  })
}
function ifs(env, sumArg, pairsArr) {
  for (let i = 0; i < pairsArr.length; i += 2) if (!(pairsArr[i] instanceof Ref) && !isMat(pairsArr[i])) throw E.VALUE
  const critRanges = pairsArr.filter((_, i) => i % 2 === 0)
  const preds = pairsArr.filter((_, i) => i % 2 === 1).map((c) => makeCriteria(c instanceof Ref ? env.host.value(c.sid, c.r1, c.c1) : isMat(c) ? c[0][0] : c))
  const all = alignedMats(env, sumArg !== null ? [...critRanges, sumArg] : critRanges)
  const mats = all.slice(0, critRanges.length)
  let sm = sumArg !== null ? all[all.length - 1] : null
  const R = mats[0].length, C = mats[0][0].length
  for (const m of mats) if (m.length !== R || m[0].length !== C) throw E.VALUE
  if (sm && (sm.length !== R || sm[0].length !== C)) {
    if (sumArg instanceof Ref) sm = env.host.matrix(sumArg.sub(sumArg.r1, sumArg.c1, sumArg.r1 + R - 1, sumArg.c1 + C - 1))
    else throw E.VALUE
  }
  const hits = []
  for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
    let ok = true
    for (let k = 0; k < mats.length; k++) if (!preds[k](mats[k][i][j])) { ok = false; break }
    if (ok) hits.push(sm ? sm[i][j] : 1)
  }
  return hits
}
A('SUMIF', 'Math', 'range, criteria, [sum_range]', 'Adds cells that meet a condition.', (env, [r, c, s]) => ifs(env, s === undefined ? r : s, [r, c]).reduce((a, v) => { if (v instanceof XErr) throw v; return typeof v === 'number' ? a + v : a }, 0))
A('SUMIFS', 'Math', 'sum_range, criteria_range1, criteria1, ...', 'Adds cells that meet several conditions.', (env, [s, ...p]) => ifs(env, s, p).reduce((a, v) => { if (v instanceof XErr) throw v; return typeof v === 'number' ? a + v : a }, 0))
A('COUNTIF', 'Statistical', 'range, criteria', 'Counts cells that meet a condition.', (env, [r, c]) => ifs(env, null, [r, c]).length)
A('COUNTIFS', 'Statistical', 'criteria_range1, criteria1, ...', 'Counts cells that meet several conditions.', (env, p) => ifs(env, null, p).length)
const avgOf = (h) => { const n = h.filter((v) => typeof v === 'number'); if (!n.length) throw E.DIV0; return n.reduce((a, b) => a + b, 0) / n.length }
A('AVERAGEIF', 'Statistical', 'range, criteria, [average_range]', 'Average of cells that meet a condition.', (env, [r, c, s]) => avgOf(ifs(env, s === undefined ? r : s, [r, c])))
A('AVERAGEIFS', 'Statistical', 'average_range, criteria_range1, criteria1, ...', 'Average of cells that meet several conditions.', (env, [s, ...p]) => avgOf(ifs(env, s, p)))
A('MAXIFS', 'Statistical', 'max_range, criteria_range1, criteria1, ...', 'Largest value that meets conditions.', (env, [s, ...p]) => { const n = ifs(env, s, p).filter((v) => typeof v === 'number'); return n.length ? Math.max(...n) : 0 })
A('MINIFS', 'Statistical', 'min_range, criteria_range1, criteria1, ...', 'Smallest value that meets conditions.', (env, [s, ...p]) => { const n = ifs(env, s, p).filter((v) => typeof v === 'number'); return n.length ? Math.min(...n) : 0 })

// ================= LOGICAL =================
const scalar1 = (env, x) => (x instanceof Ref ? (x.single ? env.host.value(x.sid, x.r1, x.c1) : env.host.matrix(x)) : x)
L('IF', 'Logical', 'logical_test, value_if_true, [value_if_false]', 'Returns one value if a condition is true and another if false.', (env, args, ev) => {
  const c = scalar1(env, ev(args[0]))
  const pick = (b) => { const n = b ? args[1] : args[2]; if (!n) return b ? 0 : false; const v = ev(n); return v === undefined ? 0 : v }
  if (isMat(c)) {
    const t = scalar1(env, pick(true)), f = scalar1(env, pick(false))
    return c.map((row, i) => row.map((x, j) => { if (x instanceof XErr) return x; const v = toBool(x) ? t : f; return isMat(v) ? v[i % v.length][j % v[0].length] : v }))
  }
  if (c instanceof XErr) return c
  return pick(toBool(c))
})
L('IFS', 'Logical', 'logical_test1, value_if_true1, ...', 'Checks several conditions and returns the first match.', (env, args, ev) => {
  for (let i = 0; i + 1 < args.length; i += 2) { const c = scalar1(env, ev(args[i])); if (c instanceof XErr) return c; if (toBool(c)) return ev(args[i + 1]) }
  return E.NA
})
L('IFERROR', 'Logical', 'value, value_if_error', 'Returns a fallback when a value is an error.', (env, args, ev) => {
  const v = scalar1(env, ev(args[0]))
  if (isMat(v)) return v.map((r) => r.map((x) => (x instanceof XErr ? scalar1(env, ev(args[1])) : x)))
  return v instanceof XErr ? ev(args[1]) : v
})
L('IFNA', 'Logical', 'value, value_if_na', 'Returns a fallback when a value is #N/A.', (env, args, ev) => { const v = scalar1(env, ev(args[0])); return v instanceof XErr && v.code === '#N/A' ? ev(args[1]) : v })
L('SWITCH', 'Logical', 'expression, value1, result1, [default_or_value2], ...', 'Matches a value against a list and returns the result.', (env, args, ev) => {
  const x = scalar1(env, ev(args[0]))
  if (x instanceof XErr) return x
  let i = 1
  for (; i + 1 < args.length; i += 2) { const v = scalar1(env, ev(args[i])); if (v instanceof XErr) return v; if (compare(x, v) === 0) return ev(args[i + 1]) }
  return i < args.length ? ev(args[i]) : E.NA
})
L('CHOOSE', 'Lookup', 'index_num, value1, [value2], ...', 'Picks a value from a list by position.', (env, args, ev) => {
  const i = toInt(scalar1(env, ev(args[0])))
  if (i < 1 || i >= args.length) return E.VALUE
  return ev(args[i])
})
const boolsOf = (env, args) => {
  const out = []
  eachArg(env, args, (v, d) => { if (v instanceof XErr) throw v; if (typeof v === 'boolean') out.push(v); else if (typeof v === 'number') out.push(v !== 0); else if (d && v !== null) out.push(toBool(v)) })
  if (!out.length) throw E.VALUE
  return out
}
A('AND', 'Logical', 'logical1, [logical2], ...', 'TRUE when all arguments are TRUE.', (env, a) => boolsOf(env, a).every(Boolean))
A('OR', 'Logical', 'logical1, [logical2], ...', 'TRUE when any argument is TRUE.', (env, a) => boolsOf(env, a).some(Boolean))
A('XOR', 'Logical', 'logical1, [logical2], ...', 'TRUE when an odd number of arguments are TRUE.', (env, a) => boolsOf(env, a).filter(Boolean).length % 2 === 1)
S('NOT', 'Logical', 'logical', 'Reverses TRUE and FALSE.', (x) => !toBool(x))
S('TRUE', 'Logical', '', 'The logical value TRUE.', () => true)
S('FALSE', 'Logical', '', 'The logical value FALSE.', () => false)

// ================= INFORMATION =================
const isNA = (v) => v instanceof XErr && v.code === '#N/A'
S('ISBLANK', 'Information', 'value', 'TRUE if the cell is empty.', (v) => v === null || v === undefined, { errOk: true })
S('ISNUMBER', 'Information', 'value', 'TRUE if the value is a number.', (v) => typeof v === 'number', { errOk: true })
S('ISTEXT', 'Information', 'value', 'TRUE if the value is text.', (v) => typeof v === 'string', { errOk: true })
S('ISNONTEXT', 'Information', 'value', 'TRUE if the value is not text.', (v) => typeof v !== 'string', { errOk: true })
S('ISLOGICAL', 'Information', 'value', 'TRUE if the value is TRUE or FALSE.', (v) => typeof v === 'boolean', { errOk: true })
S('ISERROR', 'Information', 'value', 'TRUE if the value is any error.', (v) => v instanceof XErr, { errOk: true })
S('ISERR', 'Information', 'value', 'TRUE if the value is an error other than #N/A.', (v) => v instanceof XErr && !isNA(v), { errOk: true })
S('ISNA', 'Information', 'value', 'TRUE if the value is #N/A.', (v) => isNA(v), { errOk: true })
S('ISEVEN', 'Information', 'number', 'TRUE if the number is even.', (v) => Math.trunc(toNum(v)) % 2 === 0)
S('ISODD', 'Information', 'number', 'TRUE if the number is odd.', (v) => Math.abs(Math.trunc(toNum(v))) % 2 === 1)
S('N', 'Information', 'value', 'Converts a value to a number.', (v) => (typeof v === 'number' ? v : typeof v === 'boolean' ? +v : 0))
S('T', 'Information', 'value', 'Returns the text of a value, or empty text.', (v) => (typeof v === 'string' ? v : ''))
S('NA', 'Information', '', 'Returns the #N/A error.', () => E.NA)
S('TYPE', 'Information', 'value', 'Type of a value: 1 number, 2 text, 4 logical, 16 error.', (v) => (typeof v === 'number' || v == null ? 1 : typeof v === 'string' ? 2 : typeof v === 'boolean' ? 4 : 16), { errOk: true })

// ================= TEXT =================
const joinFlat = (env, args, delim = '', skipEmpty = false) => { const o = []; eachArg(env, args, (v) => { const s = toStr(v); if (!(skipEmpty && s === '')) o.push(s) }); return o.join(delim) }
A('CONCAT', 'Text', 'text1, [text2], ...', 'Joins text from several cells and ranges.', (env, a) => joinFlat(env, a))
alias('CONCATENATE', 'CONCAT')
A('TEXTJOIN', 'Text', 'delimiter, ignore_empty, text1, [text2], ...', 'Joins text with a delimiter.', (env, [d, ig, ...a]) => joinFlat(env, a, toStr(scalar1(env, d)), toBool(scalar1(env, ig))))
S('LEFT', 'Text', 'text, [num_chars]', 'First characters of text.', (t, n) => { n = n === undefined ? 1 : toInt(n); if (n < 0) throw E.VALUE; return toStr(t).slice(0, n) })
S('RIGHT', 'Text', 'text, [num_chars]', 'Last characters of text.', (t, n) => { n = n === undefined ? 1 : toInt(n); if (n < 0) throw E.VALUE; t = toStr(t); return n ? t.slice(-n) : '' })
S('MID', 'Text', 'text, start_num, num_chars', 'Characters from the middle of text.', (t, s, n) => { s = toInt(s); n = toInt(n); if (s < 1 || n < 0) throw E.VALUE; return toStr(t).substr(s - 1, n) })
S('LEN', 'Text', 'text', 'Number of characters.', (t) => toStr(t).length)
S('TRIM', 'Text', 'text', 'Removes extra spaces.', (t) => toStr(t).replace(/ +/g, ' ').trim())
S('CLEAN', 'Text', 'text', 'Removes non-printing characters.', (t) => toStr(t).replace(/[\u0000-\u001f]/g, ''))
S('UPPER', 'Text', 'text', 'Converts text to upper case.', (t) => toStr(t).toUpperCase())
S('LOWER', 'Text', 'text', 'Converts text to lower case.', (t) => toStr(t).toLowerCase())
S('PROPER', 'Text', 'text', 'Capitalizes the first letter of each word.', (t) => toStr(t).toLowerCase().replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()))
S('EXACT', 'Text', 'text1, text2', 'TRUE if two texts are identical (case-sensitive).', (a, b) => toStr(a) === toStr(b))
S('REPT', 'Text', 'text, number_times', 'Repeats text.', (t, n) => { n = toInt(n); if (n < 0 || n > 32767) throw E.VALUE; return toStr(t).repeat(n) })
S('CHAR', 'Text', 'number', 'Character for a code number.', (n) => { n = toInt(n); if (n < 1 || n > 65535) throw E.VALUE; return String.fromCharCode(n) })
S('CODE', 'Text', 'text', 'Code of the first character.', (t) => { t = toStr(t); if (!t) throw E.VALUE; return t.charCodeAt(0) })
alias('UNICODE', 'CODE'); alias('UNICHAR', 'CHAR')
S('FIND', 'Text', 'find_text, within_text, [start_num]', 'Position of text inside text (case-sensitive).', (f, t, s) => { const i = toStr(t).indexOf(toStr(f), s === undefined ? 0 : toInt(s) - 1); if (i < 0) throw E.VALUE; return i + 1 })
S('SEARCH', 'Text', 'find_text, within_text, [start_num]', 'Position of text inside text (wildcards, not case-sensitive).', (f, t, s) => { t = toStr(t); const st = s === undefined ? 0 : toInt(s) - 1; const m = wildcard(toStr(f), false).exec(t.slice(st)); if (!m) throw E.VALUE; return st + m.index + 1 })
S('SUBSTITUTE', 'Text', 'text, old_text, new_text, [instance_num]', 'Replaces text by matching.', (t, o, n, k) => {
  t = toStr(t); o = toStr(o); n = toStr(n)
  if (!o) return t
  if (k === undefined) return t.split(o).join(n)
  k = toInt(k); let idx = -1
  for (let i = 0; i < k; i++) { idx = t.indexOf(o, idx + 1); if (idx < 0) return t }
  return t.slice(0, idx) + n + t.slice(idx + o.length)
})
S('REPLACE', 'Text', 'old_text, start_num, num_chars, new_text', 'Replaces part of text by position.', (t, s, n, r) => { t = toStr(t); s = toInt(s); n = toInt(n); if (s < 1 || n < 0) throw E.VALUE; return t.slice(0, s - 1) + toStr(r) + t.slice(s - 1 + n) })
S('TEXT', 'Text', 'value, format_text', 'Formats a number or date with a format code.', (v, f) => { if (typeof v === 'string' && strToNum(v) !== null) v = strToNum(v); return formatValue(v, toStr(f)).text })
S('VALUE', 'Text', 'text', 'Converts text to a number.', (t) => { if (typeof t === 'number') return t; const n = strToNum(toStr(t)); if (n === null) throw E.VALUE; return n })
S('NUMBERVALUE', 'Text', 'text, [decimal_separator], [group_separator]', 'Converts text to a number with chosen separators.', (t, d, g) => { t = toStr(t).replace(/\s/g, ''); const ds = d === undefined ? '.' : toStr(d), gs = g === undefined ? ',' : toStr(g); let s = t.split(gs).join('').replace(ds, '.'); let pct = 0; while (s.endsWith('%')) { s = s.slice(0, -1); pct++ } const n = Number(s); if (s === '' ? false : Number.isNaN(n)) throw E.VALUE; return (s === '' ? 0 : n) / Math.pow(100, pct) })
S('FIXED', 'Text', 'number, [decimals], [no_commas]', 'Formats a number with a fixed number of decimals.', (n, d, nc) => { d = d === undefined ? 2 : toInt(d); return formatValue(rnd(toNum(n), d, Math.round), (nc !== undefined && toBool(nc) ? '0' : '#,##0') + (d > 0 ? '.' + '0'.repeat(d) : '')).text })
S('TEXTBEFORE', 'Text', 'text, delimiter, [instance_num]', 'Text before a delimiter.', (t, d, k) => { t = toStr(t); d = toStr(d); k = k === undefined ? 1 : toInt(k); let idx = -1; for (let i = 0; i < k; i++) { idx = t.indexOf(d, idx + 1); if (idx < 0) throw E.NA } return t.slice(0, idx) })
S('TEXTAFTER', 'Text', 'text, delimiter, [instance_num]', 'Text after a delimiter.', (t, d, k) => { t = toStr(t); d = toStr(d); k = k === undefined ? 1 : toInt(k); let idx = -d.length; for (let i = 0; i < k; i++) { idx = t.indexOf(d, idx + d.length); if (idx < 0) throw E.NA } return t.slice(idx + d.length) })
S('TEXTSPLIT', 'Text', 'text, col_delimiter, [row_delimiter]', 'Splits text into columns (and rows).', (t, c, r) => { t = toStr(t); const rows = r === undefined || r === null ? [t] : t.split(toStr(r)); return rows.map((x) => x.split(toStr(c))) })

// ================= LOOKUP & REFERENCE =================
const refOrMat = (env, x) => (x instanceof Ref ? clip(env, x) : x)
function findIn(vals, key, mode, search = 1) {
  const n = vals.length
  const idx = (i) => (search < 0 ? n - 1 - i : i)
  if (mode === 0 || mode === 2) {
    const pred = mode === 2 && typeof key === 'string' && /[*?~]/.test(key) ? ((re) => (v) => typeof v === 'string' && re.test(v))(wildcard(key)) : (v) => (typeof key === 'string' ? (typeof v === 'string' && v.toLowerCase() === key.toLowerCase()) : key === null ? v === null : v === key)
    for (let i = 0; i < n; i++) if (pred(vals[idx(i)])) return idx(i)
    return -1
  }
  let best = -1
  for (let i = 0; i < n; i++) {
    const v = vals[i]
    if (v === null || typeof v !== typeof key) continue
    const c = compare(v, key)
    if (c === 0) return i
    if (mode === -1 && c < 0 && (best < 0 || compare(v, vals[best]) > 0)) best = i
    if (mode === 1 && c > 0 && (best < 0 || compare(v, vals[best]) < 0)) best = i
  }
  return best
}
function approx(vals, key, asc = true) {
  let best = -1
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i]
    if (v === null || typeof v !== typeof key) continue
    const c = compare(v, key)
    if (asc ? c <= 0 : c >= 0) best = i
    else if (best >= 0 || (asc && c > 0)) break
  }
  return best
}
function lookup(env, [key, table, col, ex], byRow) {
  key = scalar1(env, key)
  if (key instanceof XErr) return key
  const m = cmat(env, table)
  const ci = toInt(col)
  if (ci < 1 || ci > (byRow ? m.length : m[0].length)) throw E.REF
  const exact = ex !== undefined && ex !== null && !toBool(ex)
  const axis = byRow ? m[0] : m.map((r) => r[0])
  const i = exact ? findIn(axis, key, 2) : approx(axis, key)
  if (i < 0) return E.NA
  return byRow ? m[ci - 1][i] : m[i][ci - 1]
}
A('VLOOKUP', 'Lookup', 'lookup_value, table_array, col_index_num, [range_lookup]', 'Looks up a value in the first column and returns a value from another column.', (env, a) => lookup(env, a, false))
A('HLOOKUP', 'Lookup', 'lookup_value, table_array, row_index_num, [range_lookup]', 'Looks up a value in the first row and returns a value from another row.', (env, a) => lookup(env, a, true))
A('LOOKUP', 'Lookup', 'lookup_value, lookup_vector, [result_vector]', 'Approximate lookup in a sorted vector.', (env, [k, lv, rv]) => { k = scalar1(env, k); const a = flat(env, lv); const i = approx(a, k); if (i < 0) return E.NA; const r = rv === undefined ? a : flat(env, rv); return r[i] ?? E.NA })
A('MATCH', 'Lookup', 'lookup_value, lookup_array, [match_type]', 'Position of a value in a list.', (env, [k, arr, t]) => {
  k = scalar1(env, k); if (k instanceof XErr) return k
  const a = flat(env, arr); const mt = t === undefined ? 1 : toNum(t)
  const i = mt === 0 ? findIn(a, k, 2) : approx(a, k, mt > 0)
  return i < 0 ? E.NA : i + 1
})
A('XMATCH', 'Lookup', 'lookup_value, lookup_array, [match_mode], [search_mode]', 'Position of a value with flexible matching.', (env, [k, arr, mm, sm]) => {
  k = scalar1(env, k); const i = findIn(flat(env, arr), k, mm === undefined ? 0 : toInt(mm), sm === undefined ? 1 : Math.sign(toInt(sm)) || 1)
  return i < 0 ? E.NA : i + 1
})
A('XLOOKUP', 'Lookup', 'lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode]', 'Finds a value in one range and returns the match from another.', (env, [k, la, ra, nf, mm, sm]) => {
  k = scalar1(env, k); if (k instanceof XErr) return k
  const lm = cmat(env, la)
  const vertical = lm[0].length === 1 || lm.length > 1
  const vals = vertical && lm[0].length === 1 ? lm.map((r) => r[0]) : lm.length === 1 ? lm[0] : lm.map((r) => r[0])
  const i = findIn(vals, k, mm === undefined ? 0 : toInt(mm), sm === undefined ? 1 : Math.sign(toInt(sm)) || 1)
  if (i < 0) return nf !== undefined ? nf : E.NA
  const rm = cmat(env, ra)
  if (lm.length === 1 && lm[0].length > 1) return rm.map((r) => [r[i]])
  const row = rm[i]
  return row.length === 1 ? row[0] : [row]
})
A('INDEX', 'Lookup', 'array, row_num, [column_num]', 'Value at a row and column of a range.', (env, [arr, rn, cn]) => {
  const rows = arr instanceof Ref ? arr.rows : matOf(env, arr).length, cols = arr instanceof Ref ? arr.cols : matOf(env, arr)[0].length
  let r = rn === undefined || rn === null ? 0 : toInt(scalar1(env, rn)), c = cn === undefined || cn === null ? 0 : toInt(scalar1(env, cn))
  if (cn === undefined && rows === 1 && cols > 1) { c = r; r = 1 } else if (cn === undefined && cols === 1) c = 1
  if (r < 0 || c < 0 || r > rows || c > cols) return E.REF
  if (arr instanceof Ref) {
    const r1 = r ? arr.r1 + r - 1 : arr.r1, r2 = r ? r1 : arr.r2, c1 = c ? arr.c1 + c - 1 : arr.c1, c2 = c ? c1 : arr.c2
    return arr.sub(r1, c1, r2, c2)
  }
  const m = matOf(env, arr)
  const sub = (r ? [m[r - 1]] : m).map((row) => (c ? [row[c - 1]] : row))
  return sub.length === 1 && sub[0].length === 1 ? sub[0][0] : sub
})
A('OFFSET', 'Lookup', 'reference, rows, cols, [height], [width]', 'A reference shifted from a starting cell.', (env, [ref, rs, cs, h, w]) => {
  if (!(ref instanceof Ref)) throw E.VALUE
  const r = ref.r1 + toInt(scalar1(env, rs)), c = ref.c1 + toInt(scalar1(env, cs))
  const hh = h === undefined || h === null ? ref.rows : toInt(h), ww = w === undefined || w === null ? ref.cols : toInt(w)
  if (r < 0 || c < 0 || hh < 1 || ww < 1) return E.REF
  return ref.sub(r, c, r + hh - 1, c + ww - 1)
})
A('INDIRECT', 'Lookup', 'ref_text, [a1]', 'Reference from text such as "A1" or "Sheet2!B3".', (env, [t]) => env.host.parseRef(toStr(scalar1(env, t)), env.sid) || E.REF)
A('ROW', 'Lookup', '[reference]', 'Row number of a reference.', (env, [r]) => { if (r === undefined) return env.r + 1; if (!(r instanceof Ref)) throw E.VALUE; return r.rows === 1 ? r.r1 + 1 : Array.from({ length: r.rows }, (_, i) => [r.r1 + i + 1]) })
A('COLUMN', 'Lookup', '[reference]', 'Column number of a reference.', (env, [r]) => { if (r === undefined) return env.c + 1; if (!(r instanceof Ref)) throw E.VALUE; return r.cols === 1 ? r.c1 + 1 : [Array.from({ length: r.cols }, (_, i) => r.c1 + i + 1)] })
A('ROWS', 'Lookup', 'array', 'Number of rows.', (env, [r]) => (r instanceof Ref ? r.rows : matOf(env, r).length))
A('COLUMNS', 'Lookup', 'array', 'Number of columns.', (env, [r]) => (r instanceof Ref ? r.cols : matOf(env, r)[0].length))
S('ADDRESS', 'Lookup', 'row_num, column_num, [abs_num], [a1], [sheet_text]', 'Cell address as text.', (r, c, abs, a1, sh) => {
  r = toInt(r); c = toInt(c); abs = abs === undefined ? 1 : toInt(abs)
  if (r < 1 || c < 1) throw E.VALUE
  return (sh !== undefined ? `${toStr(sh)}!` : '') + (abs === 1 || abs === 3 ? '$' : '') + colName(c - 1) + (abs === 1 || abs === 2 ? '$' : '') + r
})
A('TRANSPOSE', 'Lookup', 'array', 'Swaps rows and columns.', (env, [a]) => { const m = cmat(env, a); return m[0].map((_, j) => m.map((r) => r[j])) })
const uniqKey = (row) => row.map((v) => (typeof v === 'string' ? 's' + v.toLowerCase() : typeof v + String(v))).join('\u0001')
A('UNIQUE', 'Lookup', 'array, [by_col], [exactly_once]', 'Unique rows of a range.', (env, [a, bc, once]) => {
  let m = cmat(env, a); const byCol = bc !== undefined && toBool(bc)
  if (byCol) m = m[0].map((_, j) => m.map((r) => r[j]))
  const seen = new Map()
  for (const row of m) { const k = uniqKey(row); seen.set(k, seen.has(k) ? { row, n: seen.get(k).n + 1 } : { row, n: 1 }) }
  let out = [...seen.values()]
  if (once !== undefined && toBool(once)) out = out.filter((x) => x.n === 1)
  out = out.map((x) => x.row)
  if (!out.length) throw E.NA
  return byCol ? out[0].map((_, j) => out.map((r) => r[j])) : out
})
A('SORT', 'Lookup', 'array, [sort_index], [sort_order], [by_col]', 'Sorts a range.', (env, [a, si, so, bc]) => {
  let m = cmat(env, a); const byCol = bc !== undefined && toBool(bc)
  if (byCol) m = m[0].map((_, j) => m.map((r) => r[j]))
  const idx = (si === undefined ? 1 : toInt(si)) - 1, dir = so !== undefined && toInt(so) === -1 ? -1 : 1
  if (idx < 0 || idx >= m[0].length) throw E.VALUE
  const out = m.map((r, i) => [r, i]).sort((x, y) => (compare(x[0][idx], y[0][idx]) || x[1] - y[1]) * dir).map((x) => x[0])
  return byCol ? out[0].map((_, j) => out.map((r) => r[j])) : out
})
A('SORTBY', 'Lookup', 'array, by_array1, [sort_order1], ...', 'Sorts a range by another range.', (env, [a, ...rest]) => {
  const m = cmat(env, a); const keys = []
  for (let i = 0; i < rest.length; i += 2) keys.push({ v: flat(env, rest[i]), d: rest[i + 1] !== undefined && toInt(rest[i + 1]) === -1 ? -1 : 1 })
  if (keys.some((k) => k.v.length !== m.length)) throw E.VALUE
  return m.map((r, i) => [r, i]).sort((x, y) => { for (const k of keys) { const c = compare(k.v[x[1]], k.v[y[1]]); if (c) return c * k.d } return x[1] - y[1] }).map((x) => x[0])
})
A('FILTER', 'Lookup', 'array, include, [if_empty]', 'Keeps the rows that meet a condition.', (env, [a, inc, empty]) => {
  const m = cmat(env, a), im = cmat(env, inc)
  let out
  if (im.length === m.length && im[0].length === 1) out = m.filter((_, i) => { const v = im[i][0]; if (v instanceof XErr) throw v; return typeof v === 'number' ? v !== 0 : v === true })
  else if (im.length === 1 && im[0].length === m[0].length) { const keep = im[0].map((v) => (typeof v === 'number' ? v !== 0 : v === true)); out = m.map((r) => r.filter((_, j) => keep[j])); if (!out[0].length) out = [] }
  else throw E.VALUE
  if (!out.length) return empty !== undefined ? empty : E.NA
  return out
})
A('SEQUENCE', 'Lookup', 'rows, [columns], [start], [step]', 'A grid of sequential numbers.', (env, [r, c, s, st]) => {
  r = toInt(r); c = c === undefined ? 1 : toInt(c); s = s === undefined ? 1 : toNum(s); st = st === undefined ? 1 : toNum(st)
  if (r < 1 || c < 1 || r * c > 1e6) throw E.VALUE
  return Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => s + (i * c + j) * st))
})
A('VSTACK', 'Lookup', 'array1, [array2], ...', 'Stacks ranges vertically.', (env, a) => { const ms = a.map((x) => cmat(env, x)); const w = Math.max(...ms.map((m) => m[0].length)); return ms.flatMap((m) => m.map((r) => Array.from({ length: w }, (_, j) => (j < r.length ? r[j] : E.NA)))) })
A('HSTACK', 'Lookup', 'array1, [array2], ...', 'Joins ranges side by side.', (env, a) => { const ms = a.map((x) => cmat(env, x)); const h = Math.max(...ms.map((m) => m.length)); return Array.from({ length: h }, (_, i) => ms.flatMap((m) => (i < m.length ? m[i] : m[0].map(() => E.NA)))) })

// ================= DATE & TIME =================
S('TODAY', 'Date', '', 'Today\'s date.', () => todaySerial())
S('NOW', 'Date', '', 'The current date and time.', () => nowSerial())
S('DATE', 'Date', 'year, month, day', 'Builds a date.', (y, m, d) => { y = toInt(y); m = toInt(m); d = toInt(d); if (y < 0 || y > 9999) throw E.NUM; if (y < 1900) y += 1900; return ymdToSerial(y, m, d) })
S('TIME', 'Date', 'hour, minute, second', 'Builds a time of day.', (h, m, s) => { const t = (toInt(h) * 3600 + toInt(m) * 60 + toInt(s)) / 86400; if (t < 0) throw E.NUM; return t - Math.floor(t) })
S('DATEVALUE', 'Date', 'date_text', 'Converts a date in text to a serial number.', (t) => { const p = parseInput(toStr(t).trim()); if (p.kind !== 'value' || typeof p.v !== 'number') throw E.VALUE; return Math.floor(p.v) })
S('TIMEVALUE', 'Date', 'time_text', 'Converts a time in text to a fraction of a day.', (t) => { const p = parseInput(toStr(t).trim()); if (p.kind !== 'value' || typeof p.v !== 'number') throw E.VALUE; return p.v - Math.floor(p.v) })
S('YEAR', 'Date', 'serial_number', 'Year of a date.', (v) => serialParts(dnum(v)).y)
S('MONTH', 'Date', 'serial_number', 'Month of a date (1-12).', (v) => serialParts(dnum(v)).m)
S('DAY', 'Date', 'serial_number', 'Day of the month.', (v) => serialParts(dnum(v)).d)
S('HOUR', 'Date', 'serial_number', 'Hour (0-23).', (v) => serialParts(dnum(v)).hh)
S('MINUTE', 'Date', 'serial_number', 'Minute (0-59).', (v) => serialParts(dnum(v)).mm)
S('SECOND', 'Date', 'serial_number', 'Second (0-59).', (v) => serialParts(dnum(v)).ss)
S('WEEKDAY', 'Date', 'serial_number, [return_type]', 'Day of the week as a number.', (v, t) => { const dow = serialParts(dnum(v)).dow; t = t === undefined ? 1 : toInt(t); return t === 1 ? dow + 1 : t === 2 ? ((dow + 6) % 7) + 1 : t === 3 ? (dow + 6) % 7 : E.NUM })
S('WEEKNUM', 'Date', 'serial_number, [return_type]', 'Week number of the year.', (v, t) => { const s = serialDate(v), p = serialParts(s); const jan1 = ymdToSerial(p.y, 1, 1); const start = t !== undefined && toInt(t) === 2 ? 1 : 0; const j = serialParts(jan1).dow; const off = (j - start + 7) % 7; return Math.floor((s - jan1 + off) / 7) + 1 })
S('ISOWEEKNUM', 'Date', 'date', 'ISO week number.', (v) => { const s = serialDate(v); const p = serialParts(s); const dow = (p.dow + 6) % 7; const thu = s - dow + 3; const ty = serialParts(thu).y; return Math.floor((thu - ymdToSerial(ty, 1, 1)) / 7) + 1 })
const addMonths = (s, n) => { const p = serialParts(s); const t = p.y * 12 + (p.m - 1) + n; const y = Math.floor(t / 12), m = (t % 12) + 1; const dim = new Date(Date.UTC(y, m, 0)).getUTCDate(); return ymdToSerial(y, m, Math.min(p.d, dim)) }
S('EDATE', 'Date', 'start_date, months', 'Date a number of months away.', (s, n) => addMonths(serialDate(s), toInt(n)))
S('EOMONTH', 'Date', 'start_date, months', 'Last day of a month.', (s, n) => { const x = addMonths(serialDate(s), toInt(n)); const p = serialParts(x); return ymdToSerial(p.y, p.m, new Date(Date.UTC(p.y, p.m, 0)).getUTCDate()) })
S('DAYS', 'Date', 'end_date, start_date', 'Days between two dates.', (e, s) => serialDate(e) - serialDate(s))
S('DATEDIF', 'Date', 'start_date, end_date, unit', 'Difference between dates in years, months or days.', (a, b, u) => {
  a = serialDate(a); b = serialDate(b); if (a > b) throw E.NUM
  const pa = serialParts(a), pb = serialParts(b)
  let months = (pb.y - pa.y) * 12 + (pb.m - pa.m); if (pb.d < pa.d) months--
  switch (toStr(u).toUpperCase()) {
    case 'Y': return Math.floor(months / 12)
    case 'M': return months
    case 'D': return b - a
    case 'MD': { let d = pb.d - pa.d; if (d < 0) d += new Date(Date.UTC(pb.y, pb.m - 1, 0)).getUTCDate(); return d }
    case 'YM': return months % 12
    case 'YD': { const y2 = pb.m > pa.m || (pb.m === pa.m && pb.d >= pa.d) ? pb.y : pb.y - 1; return b - ymdToSerial(y2, pa.m, pa.d) }
    default: throw E.NUM
  }
})
const holidaySet = (env, h) => new Set(h === undefined ? [] : flat(env, h).filter((v) => typeof v === 'number').map(Math.floor))
const isWeekend = (s) => { const d = serialParts(s).dow; return d === 0 || d === 6 }
A('NETWORKDAYS', 'Date', 'start_date, end_date, [holidays]', 'Working days between two dates.', (env, [a, b, h]) => {
  a = serialDate(scalar1(env, a)); b = serialDate(scalar1(env, b)); const hs = holidaySet(env, h); const sg = a <= b ? 1 : -1; let n = 0
  for (let d = a; sg > 0 ? d <= b : d >= b; d += sg) if (!isWeekend(d) && !hs.has(d)) n++
  return n * sg
})
A('WORKDAY', 'Date', 'start_date, days, [holidays]', 'Date a number of working days away.', (env, [a, n, h]) => {
  let d = serialDate(scalar1(env, a)); n = toInt(scalar1(env, n)); const hs = holidaySet(env, h); const sg = n < 0 ? -1 : 1
  for (let k = Math.abs(n); k > 0;) { d += sg; if (!isWeekend(d) && !hs.has(d)) k-- }
  return d
})

// ================= FINANCIAL =================
const fvOf = (r, n, p, pv, t) => (r === 0 ? -(pv + p * n) : -(pv * Math.pow(1 + r, n) + (p * (1 + r * t) * (Math.pow(1 + r, n) - 1)) / r))
const pmtOf = (r, n, pv, fv, t) => { if (n === 0) throw E.NUM; return r === 0 ? -(pv + fv) / n : -(r * (pv * Math.pow(1 + r, n) + fv)) / ((1 + r * t) * (Math.pow(1 + r, n) - 1)) }
const T0 = (x) => (x === undefined ? 0 : toNum(x))
const T01 = (x) => (x === undefined || toNum(x) === 0 ? 0 : 1)
S('PMT', 'Financial', 'rate, nper, pv, [fv], [type]', 'Loan payment per period.', (r, n, pv, fv, t) => fin(pmtOf(toNum(r), toNum(n), toNum(pv), T0(fv), T01(t))))
S('FV', 'Financial', 'rate, nper, pmt, [pv], [type]', 'Future value of an investment.', (r, n, p, pv, t) => fin(fvOf(toNum(r), toNum(n), toNum(p), T0(pv), T01(t))))
S('PV', 'Financial', 'rate, nper, pmt, [fv], [type]', 'Present value of an investment.', (r, n, p, fv, t) => { r = toNum(r); n = toNum(n); p = toNum(p); fv = T0(fv); t = T01(t); return fin(r === 0 ? -(fv + p * n) : -(fv + (p * (1 + r * t) * (Math.pow(1 + r, n) - 1)) / r) / Math.pow(1 + r, n)) })
S('NPER', 'Financial', 'rate, pmt, pv, [fv], [type]', 'Number of periods for an investment.', (r, p, pv, fv, t) => { r = toNum(r); p = toNum(p); pv = toNum(pv); fv = T0(fv); t = T01(t); if (r === 0) { if (p === 0) throw E.NUM; return -(pv + fv) / p } const a = p * (1 + r * t) - fv * r, b = p * (1 + r * t) + pv * r; if (a / b <= 0) throw E.NUM; return fin(Math.log(a / b) / Math.log(1 + r)) })
function rateOf(n, p, pv, fv, t, guess) {
  let r = guess
  for (let i = 0; i < 100; i++) {
    const g = Math.pow(1 + r, n)
    const f = r === 0 ? pv + p * n + fv : pv * g + (p * (1 + r * t) * (g - 1)) / r + fv
    const h = 1e-6, g2 = Math.pow(1 + r + h, n)
    const f2 = pv * g2 + (p * (1 + (r + h) * t) * (g2 - 1)) / (r + h) + fv
    const d = (f2 - f) / h
    if (!d) break
    const nr = r - f / d
    if (Math.abs(nr - r) < 1e-10) return nr
    r = nr
  }
  throw E.NUM
}
S('RATE', 'Financial', 'nper, pmt, pv, [fv], [type], [guess]', 'Interest rate per period.', (n, p, pv, fv, t, g) => fin(rateOf(toNum(n), toNum(p), toNum(pv), T0(fv), T01(t), g === undefined ? 0.1 : toNum(g))))
const ipmtOf = (r, per, n, pv, fv, t) => {
  const pmt = pmtOf(r, n, pv, fv, t)
  let z
  if (per === 1) z = t > 0 ? 0 : -pv
  else if (t > 0) z = fvOf(r, per - 2, pmt, pv, 1) - pmt
  else z = fvOf(r, per - 1, pmt, pv, 0)
  return z * r
}
S('IPMT', 'Financial', 'rate, per, nper, pv, [fv], [type]', 'Interest part of a payment.', (r, per, n, pv, fv, t) => { per = toInt(per); n = toNum(n); if (per < 1 || per > n) throw E.NUM; return fin(ipmtOf(toNum(r), per, n, toNum(pv), T0(fv), T01(t))) })
S('PPMT', 'Financial', 'rate, per, nper, pv, [fv], [type]', 'Principal part of a payment.', (r, per, n, pv, fv, t) => { per = toInt(per); n = toNum(n); r = toNum(r); pv = toNum(pv); fv = T0(fv); t = T01(t); if (per < 1 || per > n) throw E.NUM; return fin(pmtOf(r, n, pv, fv, t) - ipmtOf(r, per, n, pv, fv, t)) })
S('CUMIPMT', 'Financial', 'rate, nper, pv, start_period, end_period, type', 'Total interest paid between two periods.', (r, n, pv, s, e, t) => { r = toNum(r); n = toNum(n); pv = toNum(pv); s = toInt(s); e = toInt(e); t = T01(t); if (r <= 0 || n <= 0 || pv <= 0 || s < 1 || e < s || e > n) throw E.NUM; let sum = 0; for (let k = s; k <= e; k++) sum += ipmtOf(r, k, n, pv, 0, t); return sum })
S('CUMPRINC', 'Financial', 'rate, nper, pv, start_period, end_period, type', 'Total principal paid between two periods.', (r, n, pv, s, e, t) => { r = toNum(r); n = toNum(n); pv = toNum(pv); s = toInt(s); e = toInt(e); t = T01(t); if (r <= 0 || n <= 0 || pv <= 0 || s < 1 || e < s || e > n) throw E.NUM; let sum = 0; const pm = pmtOf(r, n, pv, 0, t); for (let k = s; k <= e; k++) sum += pm - ipmtOf(r, k, n, pv, 0, t); return sum })
S('SLN', 'Financial', 'cost, salvage, life', 'Straight-line depreciation per period.', (c, s, l) => { l = toNum(l); if (l === 0) throw E.DIV0; return (toNum(c) - toNum(s)) / l })
A('NPV', 'Financial', 'rate, value1, [value2], ...', 'Net present value of cash flows.', (env, [r, ...v]) => { r = toNum(scalar1(env, r)); return numsOf(env, v).reduce((a, x, i) => a + x / Math.pow(1 + r, i + 1), 0) })
const irrOf = (cf, guess = 0.1) => {
  if (!cf.some((x) => x > 0) || !cf.some((x) => x < 0)) throw E.NUM
  const npv = (r) => cf.reduce((a, x, i) => a + x / Math.pow(1 + r, i), 0)
  let r = guess
  for (let i = 0; i < 100; i++) { const f = npv(r), h = 1e-7, d = (npv(r + h) - f) / h; if (!d) break; const nr = r - f / d; if (Math.abs(nr - r) < 1e-10) return nr; r = nr }
  let lo = -0.9999, hi = 10; if (npv(lo) * npv(hi) > 0) throw E.NUM
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid }
  return (lo + hi) / 2
}
A('IRR', 'Financial', 'values, [guess]', 'Internal rate of return.', (env, [v, g]) => irrOf(numsStrict(env, v), g === undefined ? 0.1 : toNum(g)))
const datedFlows = (env, v, d) => { const a = flat(env, v).map(toNum), b = flat(env, d).map(toNum); if (a.length !== b.length) throw E.NUM; return [a, b] }
A('XNPV', 'Financial', 'rate, values, dates', 'Net present value of dated cash flows.', (env, [r, v, d]) => { r = toNum(r); const [a, b] = datedFlows(env, v, d); return a.reduce((s, x, i) => s + x / Math.pow(1 + r, (b[i] - b[0]) / 365), 0) })
A('XIRR', 'Financial', 'values, dates, [guess]', 'Internal rate of return for dated cash flows.', (env, [v, d, g]) => {
  const [a, b] = datedFlows(env, v, d)
  if (!a.some((x) => x > 0) || !a.some((x) => x < 0)) throw E.NUM
  const npv = (r) => a.reduce((s, x, i) => s + x / Math.pow(1 + r, (b[i] - b[0]) / 365), 0)
  let r = g === undefined ? 0.1 : toNum(g)
  for (let i = 0; i < 100; i++) { const f = npv(r), h = 1e-7, dd = (npv(r + h) - f) / h; if (!dd) break; const nr = r - f / dd; if (Math.abs(nr - r) < 1e-10) return nr; r = nr }
  throw E.NUM
})

// ================= MORE: modern array helpers, extra math, finance and dates =================
L('LET', 'Logical', 'name1, value1, ..., calculation', 'Names intermediate results so a formula can reuse them.', (env, args, ev) => {
  if (args.length < 3 || args.length % 2 === 0) return E.VALUE
  const e = { ...env, vars: { ...(env.vars || {}) } }
  for (let i = 0; i < args.length - 1; i += 2) {
    if (args[i].t !== 'name') return E.VALUE
    e.vars[args[i].name.toUpperCase()] = ev(args[i + 1], e)
  }
  return ev(args[args.length - 1], e)
})
A('TOCOL', 'Lookup', 'array', 'Turns a range into a single column.', (env, [a]) => flat(env, a).map((v) => [v]))
A('TOROW', 'Lookup', 'array', 'Turns a range into a single row.', (env, [a]) => [flat(env, a)])
A('TAKE', 'Lookup', 'array, rows, [columns]', 'First (or last, when negative) rows and columns of a range.', (env, [a, r, c]) => {
  let m = cmat(env, a); r = toInt(r)
  m = r >= 0 ? m.slice(0, r) : m.slice(r)
  if (c !== undefined) { c = toInt(c); m = m.map((row) => (c >= 0 ? row.slice(0, c) : row.slice(c))) }
  return m.length && m[0].length ? m : E.VALUE
})
A('DROP', 'Lookup', 'array, rows, [columns]', 'Removes rows and columns from the start (or end, when negative).', (env, [a, r, c]) => {
  let m = cmat(env, a); r = toInt(r)
  m = r >= 0 ? m.slice(r) : m.slice(0, r)
  if (c !== undefined) { c = toInt(c); m = m.map((row) => (c >= 0 ? row.slice(c) : row.slice(0, c))) }
  return m.length && m[0].length ? m : E.VALUE
})
A('CHOOSECOLS', 'Lookup', 'array, col_num1, [col_num2], ...', 'Picks columns from a range.', (env, [a, ...cs]) => { const m = cmat(env, a); const ix = cs.map((c) => toInt(scalar1(env, c))); if (ix.some((i) => i === 0 || Math.abs(i) > m[0].length)) throw E.VALUE; return m.map((row) => ix.map((i) => row[i > 0 ? i - 1 : row.length + i])) })
A('CHOOSEROWS', 'Lookup', 'array, row_num1, [row_num2], ...', 'Picks rows from a range.', (env, [a, ...rs]) => { const m = cmat(env, a); const ix = rs.map((r) => toInt(scalar1(env, r))); if (ix.some((i) => i === 0 || Math.abs(i) > m.length)) throw E.VALUE; return ix.map((i) => m[i > 0 ? i - 1 : m.length + i]) })
S('RANDARRAY', 'Math', '[rows], [columns], [min], [max], [whole_number]', 'A grid of random numbers.', (r, c, lo, hi, w) => {
  r = r === undefined ? 1 : toInt(r); c = c === undefined ? 1 : toInt(c); lo = lo === undefined ? 0 : toNum(lo); hi = hi === undefined ? 1 : toNum(hi)
  if (r < 1 || c < 1 || r * c > 1e6) throw E.VALUE
  const whole = w !== undefined && toBool(w)
  return Array.from({ length: r }, () => Array.from({ length: c }, () => (whole ? lo + Math.floor(Math.random() * (hi - lo + 1)) : lo + Math.random() * (hi - lo))))
})
A('FORMULATEXT', 'Information', 'reference', 'The formula in a cell, as text.', (env, [r]) => { if (!(r instanceof Ref)) throw E.NA; const t = env.host.formulaText(r.sid, r.r1, r.c1); if (t == null) throw E.NA; return t })
A('ISFORMULA', 'Information', 'reference', 'TRUE if the cell holds a formula.', (env, [r]) => { if (!(r instanceof Ref)) throw E.VALUE; return env.host.formulaText(r.sid, r.r1, r.c1) != null })
S('HYPERLINK', 'Lookup', 'link_location, [friendly_name]', 'Shows a link as text (Ctrl+click a URL cell to open it).', (l, n) => (n === undefined ? toStr(l) : n))
S('CEILING.MATH', 'Math', 'number, [significance], [mode]', 'Rounds up to a multiple (negative numbers go toward zero unless mode is set).', (x, s, m) => { x = toNum(x); s = s === undefined ? 1 : Math.abs(toNum(s)); if (s === 0) return 0; return x < 0 && m !== undefined && toNum(m) !== 0 ? -Math.ceil(-x / s - 1e-12) * s : Math.ceil(x / s - 1e-12) * s })
S('FLOOR.MATH', 'Math', 'number, [significance], [mode]', 'Rounds down to a multiple (negative numbers go away from zero unless mode is set).', (x, s, m) => { x = toNum(x); s = s === undefined ? 1 : Math.abs(toNum(s)); if (s === 0) return 0; return x < 0 && m !== undefined && toNum(m) !== 0 ? -Math.floor(-x / s + 1e-12) * s : Math.floor(x / s + 1e-12) * s })
S('SINH', 'Math', 'number', 'Hyperbolic sine.', (x) => fin(Math.sinh(toNum(x))))
S('COSH', 'Math', 'number', 'Hyperbolic cosine.', (x) => fin(Math.cosh(toNum(x))))
S('TANH', 'Math', 'number', 'Hyperbolic tangent.', (x) => Math.tanh(toNum(x)))
S('DOLLAR', 'Text', 'number, [decimals]', 'Formats a number as currency text with a $ sign.', (n, d) => { d = d === undefined ? 2 : toInt(d); const f = `#,##0${d > 0 ? '.' + '0'.repeat(d) : ''}`; return formatValue(rnd(toNum(n), d, Math.round), `"$"${f};-"$"${f}`).text })
S('EFFECT', 'Financial', 'nominal_rate, npery', 'Effective annual interest rate.', (r, n) => { r = toNum(r); n = Math.trunc(toNum(n)); if (r <= 0 || n < 1) throw E.NUM; return fin(Math.pow(1 + r / n, n) - 1) })
S('NOMINAL', 'Financial', 'effect_rate, npery', 'Nominal annual interest rate.', (r, n) => { r = toNum(r); n = Math.trunc(toNum(n)); if (r <= 0 || n < 1) throw E.NUM; return fin(n * (Math.pow(1 + r, 1 / n) - 1)) })
S('RRI', 'Financial', 'nper, pv, fv', 'Interest rate for the growth of an investment.', (n, pv, fv) => { n = toNum(n); pv = toNum(pv); fv = toNum(fv); if (n <= 0 || pv === 0) throw E.NUM; return fin(Math.pow(fv / pv, 1 / n) - 1) })
S('PDURATION', 'Financial', 'rate, pv, fv', 'Periods needed for an investment to reach a value.', (r, pv, fv) => { r = toNum(r); pv = toNum(pv); fv = toNum(fv); if (r <= 0 || pv <= 0 || fv <= 0) throw E.NUM; return fin(Math.log(fv / pv) / Math.log(1 + r)) })
S('SYD', 'Financial', 'cost, salvage, life, per', 'Sum-of-years-digits depreciation.', (c, s, l, p) => { c = toNum(c); s = toNum(s); l = toNum(l); p = toNum(p); if (l <= 0 || p < 1 || p > l) throw E.NUM; return ((c - s) * (l - p + 1) * 2) / (l * (l + 1)) })
S('DDB', 'Financial', 'cost, salvage, life, period, [factor]', 'Declining-balance depreciation.', (c, s, l, p, f) => { c = toNum(c); s = toNum(s); l = toNum(l); p = toNum(p); f = f === undefined ? 2 : toNum(f); if (l <= 0 || p < 1 || p > l) throw E.NUM; let book = c, dep = 0; for (let i = 1; i <= p; i++) { dep = Math.min((book * f) / l, Math.max(0, book - s)); book -= dep } return dep })
A('MIRR', 'Financial', 'values, finance_rate, reinvest_rate', 'Modified internal rate of return.', (env, [v, fr, rr]) => {
  const cf = numsStrict(env, v), f = toNum(scalar1(env, fr)), r = toNum(scalar1(env, rr)), n = cf.length
  let pos = 0, neg = 0
  cf.forEach((x, i) => { if (x > 0) pos += x * Math.pow(1 + r, n - 1 - i); else neg += x / Math.pow(1 + f, i) })
  if (!pos || !neg) throw E.DIV0
  return fin(Math.pow(pos / -neg, 1 / (n - 1)) - 1)
})
S('DAYS360', 'Date', 'start_date, end_date, [method]', 'Days between dates on a 360-day year.', (a, b, m) => {
  const p = serialParts(serialDate(a)), q = serialParts(serialDate(b))
  let d1 = p.d, d2 = q.d
  if (m !== undefined && toBool(m)) { if (d1 === 31) d1 = 30; if (d2 === 31) d2 = 30 } else {
    const eom = (s) => new Date(Date.UTC(s.y, s.m, 0)).getUTCDate()
    if (d1 === eom(p) && p.m === 2) d1 = 30
    if (d2 === 31 && d1 >= 30) d2 = 30
    if (d1 === 31) d1 = 30
  }
  return (q.y - p.y) * 360 + (q.m - p.m) * 30 + (d2 - d1)
})
S('YEARFRAC', 'Date', 'start_date, end_date, [basis]', 'Fraction of a year between two dates.', (a, b, bs) => {
  let s = serialDate(a), e = serialDate(b); if (s > e) [s, e] = [e, s]
  const basis = bs === undefined ? 0 : toInt(bs)
  const p = serialParts(s), q = serialParts(e)
  if (basis === 0 || basis === 4) {
    let d1 = p.d, d2 = q.d
    if (basis === 0) { const eom = (x) => new Date(Date.UTC(x.y, x.m, 0)).getUTCDate(); if (p.m === 2 && d1 === eom(p)) d1 = 30; if (d2 === 31 && d1 >= 30) d2 = 30; if (d1 === 31) d1 = 30 } else { if (d1 === 31) d1 = 30; if (d2 === 31) d2 = 30 }
    return ((q.y - p.y) * 360 + (q.m - p.m) * 30 + (d2 - d1)) / 360
  }
  if (basis === 2) return (e - s) / 360
  if (basis === 3) return (e - s) / 365
  if (basis !== 1) throw E.NUM
  const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  if (p.y === q.y) return (e - s) / (leap(p.y) ? 366 : 365)
  let days = 0
  for (let y = p.y; y <= q.y; y++) days += leap(y) ? 366 : 365
  return (e - s) / (days / (q.y - p.y + 1))
})

// ---------- helpers for the editor ----------
export const functionNames = () => Object.keys(FUNCS).sort()
