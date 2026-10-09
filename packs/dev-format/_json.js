// A strict JSON parser that keeps everything JSON.parse throws away (exact number text, key order, string escapes),
// reports errors with a line, a column and a plain-words explanation, and prints, measures and compares the result.
// Pure logic: no DOM, so it runs in Node for tests.
import { DevError, lineCol, loadOnce, jsd } from './_shared.js'

// Node shapes: {t:'o', k:[decoded keys], r:[raw keys], v:[nodes]}, {t:'a', i:[nodes]}, {t:'s', v: decoded, r: raw with quotes}, {t:'n', r: number text}, {t:'b', r}, {t:'z'}
export const MAX_DEPTH = 1500
const NUM = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
const isWord = (c) => /[A-Za-z_$]/.test(c || '')

/** Parse JSON text into a node tree. Throws DevError (with line, column, hint and repairable) when the text is not valid JSON. */
export function parseJson(text) {
  let i = 0
  const n = text.length
  const fail = (message, pos = i, hint, repairable = true) => {
    const { line, col } = lineCol(text, pos)
    const e = new DevError(message, { line, col, pos, hint })
    e.repairable = repairable
    throw e
  }
  const ws = () => {
    for (;;) {
      const c = text.charCodeAt(i)
      if (c === 32 || c === 10 || c === 13 || c === 9) i++
      else break
    }
  }
  const comment = () => {
    const c = text[i]
    if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) fail('Comments are not allowed in JSON.', i, 'Remove the comment, or turn on "Repair common mistakes" to strip it automatically.')
    if (c === '#') fail('Comments are not allowed in JSON.', i, 'This looks like a YAML or shell style comment. Remove it, or use the repair option.')
  }
  const str = () => {
    const start = i
    let j = i + 1
    let esc = false
    for (; j < n; j++) {
      const c = text.charCodeAt(j)
      if (c === 34) break
      if (c === 92) {
        esc = true
        const e = text[j + 1]
        if (e === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(j + 2, j + 6))) fail('Invalid \\u escape. It needs exactly four hex digits.', j)
          j += 5
        } else if (e !== undefined && '"\\/bfnrt'.includes(e)) j++
        else fail(`Invalid escape sequence \\${e ?? ''}. Inside strings a backslash must be written as \\\\.`, j)
      } else if (c < 32) {
        fail(c === 10 || c === 13 ? 'A string cannot contain a raw line break. Use \\n instead.' : 'Control characters must be escaped inside strings.', j, null, true)
      }
    }
    if (j >= n) fail('This string is never closed. A closing double quote (") is missing.', start)
    i = j + 1
    const r = text.slice(start, i)
    return { t: 's', r, v: esc ? JSON.parse(r) : r.slice(1, -1) }
  }
  const num = () => {
    NUM.lastIndex = i
    const m = NUM.exec(text)
    if (!m) {
      const c = text[i]
      if (c === '-') fail('A minus sign must be followed by a digit.', i + 1)
      fail('This is not a valid number.', i)
    }
    const end = i + m[0].length
    const nx = text[end]
    if (nx === '.') fail('A digit is required after the decimal point.', end + 1)
    if (/\d/.test(nx || '')) fail('Numbers cannot have leading zeros.', i, 'Write 7 instead of 07, or put the value in quotes if it is an ID.')
    if ((nx === 'e' || nx === 'E')) fail('An exponent needs digits, like 1e5 or 2.5E-3.', end + 1)
    i = end
    return { t: 'n', r: m[0] }
  }
  const lit = (word, node) => {
    if (text.startsWith(word, i) && !/[\w$]/.test(text[i + word.length] || '')) { i += word.length; return node }
    return null
  }
  const value = (depth) => {
    ws()
    comment()
    if (depth > MAX_DEPTH) fail(`This JSON is nested more than ${MAX_DEPTH} levels deep.`, i, null, false)
    const c = text[i]
    if (c === undefined) fail('The JSON ends too early. A value is missing here.', n, 'Check for a missing closing } or ].')
    if (c === '{') return obj(depth)
    if (c === '[') return arr(depth)
    if (c === '"') return str()
    if (c === '-' || (c >= '0' && c <= '9')) return num()
    const t = lit('true', { t: 'b', r: 'true' }) || lit('false', { t: 'b', r: 'false' }) || lit('null', { t: 'z' })
    if (t) return t
    if (c === "'") fail('Strings must use double quotes ("), not single quotes (\').', i, 'Replace the single quotes, or use the repair option.')
    if (c === '`') fail('Strings must use double quotes ("), not backticks.', i)
    if (c === '+') fail('Numbers cannot start with a plus sign.', i)
    if (c === '.') fail('Numbers must start with a digit, for example 0.5 instead of .5.', i)
    if (c === ',') fail('A value is missing before this comma.', i)
    if (c === '}' || c === ']') fail(`Unexpected "${c}". A value is missing before it.`, i, 'If the line before ends with a comma, remove that comma.')
    if (c === ':') fail('Unexpected colon (:). A property name is missing before it.', i)
    const word = text.slice(i).match(/^[A-Za-z_$][\w$]*/)?.[0]
    if (word) {
      if (['NaN', 'Infinity', 'undefined'].includes(word)) fail(`${word} is not valid JSON.`, i, 'Use null, a number or a string instead.')
      fail(`Unexpected word "${word}". Text values must be wrapped in double quotes.`, i)
    }
    fail(`Unexpected character "${c}".`, i)
  }
  const obj = (depth) => {
    const open = i
    i++
    const node = { t: 'o', k: [], r: [], v: [] }
    let comma = -1
    ws()
    if (text[i] === '}') { i++; return node }
    for (;;) {
      ws()
      comment()
      const c = text[i]
      if (c === undefined) fail('The JSON ends before this object is closed. A closing } is missing.', n, null, true)
      if (c === '}') fail('A trailing comma is not allowed before the closing brace.', comma, 'Remove the comma, or use the repair option.')
      if (c !== '"') {
        if (c === "'") fail('Property names must use double quotes ("), not single quotes (\').', i)
        if (isWord(c)) fail(`Property names must be in double quotes. Found "${text.slice(i).match(/^[\w$]*/)[0]}".`, i, 'Wrap the name in double quotes.')
        if (c === ',') fail('An extra comma. A property name is expected here.', i)
        fail('A property name in double quotes was expected here.', i)
      }
      const key = str()
      ws()
      if (text[i] !== ':') {
        if (text[i] === undefined) fail('The JSON ends before this object is closed.', n)
        fail('A colon (:) is expected after the property name.', i)
      }
      i++
      node.k.push(key.v)
      node.r.push(key.r)
      node.v.push(value(depth + 1))
      ws()
      comment()
      const d = text[i]
      if (d === ',') { comma = i; i++; continue }
      if (d === '}') { i++; return node }
      if (d === undefined) fail('The JSON ends before this object is closed. A closing } is missing.', n, `The object opened at line ${lineCol(text, open).line} is not closed.`)
      if (d === ']') fail('Found ] where a closing } was expected.', i, 'The brackets do not match up.')
      fail('A comma (,) or a closing brace (}) is expected here.', i, 'A comma is probably missing between two properties.')
    }
  }
  const arr = (depth) => {
    const open = i
    i++
    const node = { t: 'a', i: [] }
    let comma = -1
    ws()
    if (text[i] === ']') { i++; return node }
    for (;;) {
      ws()
      comment()
      if (text[i] === ']') fail('A trailing comma is not allowed before the closing bracket.', comma, 'Remove the comma, or use the repair option.')
      if (text[i] === undefined) fail('The JSON ends before this array is closed. A closing ] is missing.', n, `The array opened at line ${lineCol(text, open).line} is not closed.`)
      node.i.push(value(depth + 1))
      ws()
      comment()
      const d = text[i]
      if (d === ',') { comma = i; i++; continue }
      if (d === ']') { i++; return node }
      if (d === undefined) fail('The JSON ends before this array is closed. A closing ] is missing.', n, `The array opened at line ${lineCol(text, open).line} is not closed.`)
      if (d === '}') fail('Found } where a closing ] was expected.', i, 'The brackets do not match up.')
      fail('A comma (,) or a closing bracket (]) is expected here.', i, 'A comma is probably missing between two items.')
    }
  }
  if (text.charCodeAt(0) === 0xfeff) i = 1
  const root = value(0)
  ws()
  comment()
  if (i < n) fail('There is extra content after the end of the JSON value.', i, text[i] === '{' || text[i] === '[' ? 'This looks like several JSON documents in a row. Format them one at a time, or wrap them in an array.' : null, false)
  return root
}

/** JSON text for a node. opts: {indent: '  ' | '\t' | 0/'' (minified), sort: boolean, ascii: boolean} */
export function printJson(node, { indent = '  ', sort = false, ascii = false } = {}) {
  const pretty = !!indent
  const fix = ascii ? (s) => s.replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`) : (s) => s
  const out = []
  const nl = (d) => (pretty ? `\n${indent.repeat(d)}` : '')
  const colon = pretty ? ': ' : ':'
  const go = (x, d) => {
    switch (x.t) {
      case 'o': {
        if (!x.v.length) return out.push('{}')
        let order = x.v.map((_, j) => j)
        if (sort) order = order.sort((a, b) => (x.k[a] < x.k[b] ? -1 : x.k[a] > x.k[b] ? 1 : a - b))
        out.push('{')
        order.forEach((j, idx) => {
          out.push((idx ? ',' : '') + nl(d + 1), fix(x.r[j]), colon)
          go(x.v[j], d + 1)
        })
        return out.push(nl(d) + '}')
      }
      case 'a': {
        if (!x.i.length) return out.push('[]')
        out.push('[')
        x.i.forEach((c, idx) => {
          out.push((idx ? ',' : '') + nl(d + 1))
          go(c, d + 1)
        })
        return out.push(nl(d) + ']')
      }
      case 's': return out.push(fix(x.r))
      case 'z': return out.push('null')
      default: return out.push(x.r)
    }
  }
  go(node, 0)
  return out.join('')
}

/** Counts for the stat tiles. */
export function jsonStats(root) {
  const s = { objects: 0, arrays: 0, strings: 0, numbers: 0, booleans: 0, nulls: 0, keys: 0, depth: 0, duplicates: [] }
  const go = (x, d) => {
    if (d > s.depth) s.depth = d
    if (x.t === 'o') {
      s.objects++
      s.keys += x.k.length
      if (x.k.length > 1) { const seen = new Set(); for (const k of x.k) { if (seen.has(k) && s.duplicates.length < 5) s.duplicates.push(k); seen.add(k) } }
      for (const v of x.v) go(v, d + 1)
    } else if (x.t === 'a') { s.arrays++; for (const v of x.i) go(v, d + 1) } else if (x.t === 's') s.strings++
    else if (x.t === 'n') s.numbers++
    else if (x.t === 'b') s.booleans++
    else s.nulls++
  }
  go(root, 1)
  return s
}

export const TYPE_NAME = { o: 'object', a: 'array', s: 'string', n: 'number', b: 'boolean', z: 'null' }
const IDENT = /^[A-Za-z_$][\w$]*$/
/** JSONPath-style path from parts (strings are keys, numbers are indexes): $.users[0].name */
export function jsonPath(parts) {
  let p = '$'
  for (const k of parts) p += typeof k === 'number' ? `[${k}]` : IDENT.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`
  return p
}
/** Plain JS value of a node (numbers lose precision beyond 2^53). */
export function toValue(x) {
  switch (x.t) {
    case 'o': { const o = {}; x.k.forEach((k, j) => { o[k] = toValue(x.v[j]) }); return o }
    case 'a': return x.i.map(toValue)
    case 's': return x.v
    case 'n': return Number(x.r)
    case 'b': return x.r === 'true'
    default: return null
  }
}
/** Node from any plain JS value (used by the generators that start from JSON.parse output). */
export function fromValue(v) {
  if (v === null || v === undefined) return { t: 'z' }
  if (Array.isArray(v)) return { t: 'a', i: v.map(fromValue) }
  switch (typeof v) {
    case 'object': { const k = Object.keys(v); return { t: 'o', k, r: k.map((x) => JSON.stringify(x)), v: k.map((x) => fromValue(v[x])) } }
    case 'string': return { t: 's', v, r: JSON.stringify(v) }
    case 'number': return { t: 'n', r: String(v) }
    default: return { t: 'b', r: String(v) }
  }
}

/** Normalised number text so 1, 1.0 and 1e0 compare equal while very long digit strings keep their exact text. */
export function normNumber(raw) {
  const digits = raw.replace(/^-/, '').replace(/[eE].*$/, '').replace('.', '').replace(/^0+/, '').replace(/0+$/, '')
  return digits.length <= 15 && Number.isFinite(Number(raw)) ? String(Number(raw)) : raw
}
const canonCache = new WeakMap()
/** A canonical string for a node: same data gives the same string, whatever the key order (and array order if asked). */
export function canon(x, ignoreArrayOrder = false) {
  const cache = ignoreArrayOrder ? canonCache : null
  if (cache && cache.has(x)) return cache.get(x)
  let s
  switch (x.t) {
    case 'o': {
      const idx = x.k.map((_, j) => j).sort((a, b) => (x.k[a] < x.k[b] ? -1 : x.k[a] > x.k[b] ? 1 : 0))
      s = `{${idx.map((j) => `${JSON.stringify(x.k[j])}:${canon(x.v[j], ignoreArrayOrder)}`).join(',')}}`
      break
    }
    case 'a': {
      const parts = x.i.map((c) => canon(c, ignoreArrayOrder))
      s = `[${(ignoreArrayOrder ? parts.sort() : parts).join(',')}]`
      break
    }
    case 's': s = JSON.stringify(x.v); break
    case 'n': s = normNumber(x.r); break
    case 'b': s = x.r; break
    default: s = 'null'
  }
  if (cache) cache.set(x, s)
  return s
}

/** Repair common mistakes (trailing commas, single quotes, comments, unquoted keys, Python constants, missing brackets) with jsonrepair. */
export async function repairJson(text) {
  const { jsonrepair } = await loadOnce('jsonrepair', () => import(jsd('jsonrepair@3.15.0/+esm')))
  return jsonrepair(text)
}

/** Parse, and when it fails and repair is on, try to fix it. Returns {node, repaired: DevError | null, text}. */
export async function parseOrRepair(text, repair) {
  try {
    return { node: parseJson(text), repaired: null, text }
  } catch (e) {
    if (!repair || !(e instanceof DevError)) throw e
    let fixed
    try { fixed = await repairJson(text) } catch { throw e }
    try { return { node: parseJson(fixed), repaired: e, text: fixed } } catch { throw e }
  }
}
