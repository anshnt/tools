// Conditional formatting: evaluates a sheet's rules for visible cells. No DOM.
import { parse } from './_parse.js'
import { evaluate, settle } from './_eval.js'
import { rangeContains } from './_a1.js'
import { compare } from './_val.js'

const cache = new WeakMap()
const hex = (h) => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || ''); return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255] }
const mix = (a, b, t) => '#' + a.map((x, i) => Math.round(x + (b[i] - x) * t).toString(16).padStart(2, '0')).join('')

function stats(model, sh, rule) {
  const hit = cache.get(rule)
  if (hit && hit.ver === model.version) return hit
  const g = rule.range
  const nums = [], texts = new Map()
  const ex = model.extent(sh.id)
  for (let r = g.r1; r <= Math.min(g.r2, ex.r); r++) for (let c = g.c1; c <= Math.min(g.c2, ex.c); c++) {
    const v = model.valueAt(sh.id, r, c)
    if (typeof v === 'number') nums.push(v)
    if (v !== null) { const k = typeof v === 'string' ? 's' + v.toLowerCase() : typeof v + String(v); texts.set(k, (texts.get(k) || 0) + 1) }
  }
  nums.sort((a, b) => a - b)
  const st = { ver: model.version, nums, texts, min: nums[0], max: nums[nums.length - 1] }
  if (rule.type === 'top' || rule.type === 'bottom') {
    const n = rule.pct ? Math.max(1, Math.round((nums.length * rule.n) / 100)) : Math.max(1, rule.n | 0)
    st.thr = rule.type === 'top' ? nums[Math.max(0, nums.length - n)] : nums[Math.min(nums.length - 1, n - 1)]
  }
  if (rule.type === 'scale' && rule.c3) st.mid = nums.length ? nums[Math.floor((nums.length - 1) / 2)] : 0
  if (rule.type === 'expr') { try { st.ast = parse(rule.f) } catch { st.ast = null } }
  cache.set(rule, st)
  return st
}
const num = (x) => { const n = parseFloat(x); return Number.isNaN(n) ? null : n }

function test(model, sh, rule, r, c, v) {
  const st = stats(model, sh, rule)
  switch (rule.type) {
    case 'cell': {
      const a = num(rule.v1), b = num(rule.v2)
      if (typeof v === 'number' && a !== null) {
        switch (rule.op) {
          case 'gt': return v > a
          case 'ge': return v >= a
          case 'lt': return v < a
          case 'le': return v <= a
          case 'eq': return v === a
          case 'ne': return v !== a
          case 'between': return b !== null && v >= Math.min(a, b) && v <= Math.max(a, b)
          case 'nbetween': return b !== null && (v < Math.min(a, b) || v > Math.max(a, b))
          default: return false
        }
      }
      if (rule.op === 'eq') return v !== null && compare(v, rule.v1) === 0
      if (rule.op === 'ne') return v !== null && compare(v, rule.v1) !== 0
      return false
    }
    case 'text': {
      const t = (typeof v === 'string' ? v : v === null ? '' : String(v)).toLowerCase(), a = String(rule.v ?? '').toLowerCase()
      return rule.op === 'contains' ? t.includes(a) : rule.op === 'ncontains' ? !t.includes(a) : rule.op === 'begins' ? t.startsWith(a) : t.endsWith(a)
    }
    case 'blank': return v === null || v === ''
    case 'nblank': return v !== null && v !== ''
    case 'error': return v && typeof v === 'object' && 'code' in v
    case 'dup': case 'uniq': {
      if (v === null) return false
      const k = typeof v === 'string' ? 's' + v.toLowerCase() : typeof v + String(v)
      return rule.type === 'dup' ? st.texts.get(k) > 1 : st.texts.get(k) === 1
    }
    case 'top': return typeof v === 'number' && st.thr !== undefined && v >= st.thr
    case 'bottom': return typeof v === 'number' && st.thr !== undefined && v <= st.thr
    case 'above': case 'below': {
      if (typeof v !== 'number' || !st.nums.length) return false
      const avg = st.nums.reduce((a, b) => a + b, 0) / st.nums.length
      return rule.type === 'above' ? v > avg : v < avg
    }
    case 'expr': {
      if (!st.ast) return false
      const env = { host: model.host, sid: sh.id, r, c, dr: r - rule.range.r1, dc: c - rule.range.c1 }
      const res = settle(env, evaluate(st.ast, env))
      return res === true || (typeof res === 'number' && res !== 0)
    }
    default: return false
  }
}

/** Rules that apply to a sheet (call once per draw). */
export const rulesOf = (sh) => (sh.cf && sh.cf.length ? sh.cf : null)

/** Style overrides for one cell: {bg, fc, b, i, u, st, bar: {p, color}} or null. */
export function cfAt(model, sh, rules, r, c, v) {
  let out = null
  for (const rule of rules) {
    if (!rangeContains(rule.range, r, c)) continue
    if (rule.type === 'scale') {
      if (typeof v !== 'number') continue
      const st = stats(model, sh, rule)
      if (st.min === undefined || st.max === st.min) { out = { ...out, bg: rule.c1 }; continue }
      const t = (v - st.min) / (st.max - st.min)
      let bg
      if (rule.c3) bg = t < 0.5 ? mix(hex(rule.c1), hex(rule.c3), t * 2) : mix(hex(rule.c3), hex(rule.c2), (t - 0.5) * 2)
      else bg = mix(hex(rule.c1), hex(rule.c2), t)
      out = { ...out, bg }
      continue
    }
    if (rule.type === 'bar') {
      if (typeof v !== 'number') continue
      const st = stats(model, sh, rule)
      const lo = Math.min(0, st.min ?? 0), hi = Math.max(0, st.max ?? 0)
      out = { ...out, bar: { p: hi === lo ? 0 : (v - lo) / (hi - lo), z: hi === lo ? 0 : (0 - lo) / (hi - lo), color: rule.color || '#638ec6' } }
      continue
    }
    if (test(model, sh, rule, r, c, v)) { out = { ...out, ...rule.style }; if (rule.stop) break }
  }
  return out
}
/** Readable text color (dark or white) for a given background. */
export function textOn(bg) {
  const [r, g, b] = hex(bg)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.58 ? '#111111' : '#ffffff'
}
export const CF_PRESETS = {
  red: { bg: '#ffc7ce', fc: '#9c0006' }, yellow: { bg: '#ffeb9c', fc: '#9c5700' }, green: { bg: '#c6efce', fc: '#006100' },
  blue: { bg: '#cfe2ff', fc: '#0a3d91' }, boldred: { fc: '#d92d20', b: true }, grey: { bg: '#e5e7eb', fc: '#374151' },
}
