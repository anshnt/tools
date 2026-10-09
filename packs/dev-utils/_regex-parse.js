// Small JavaScript regex parser: pattern text -> AST with source positions, plus plain-English explanations.
// Pure (no DOM). Used by the regex tester (explain), the generator and the railroad-diagram visualizer.

const CLASS_NAMES = {
  d: 'a digit (0-9)', D: 'anything except a digit', w: 'a word character (letter, digit or underscore)', W: 'anything except a word character',
  s: 'whitespace (space, tab, line break...)', S: 'anything except whitespace',
}
const CONTROL = { n: ['\n', 'a new line'], r: ['\r', 'a carriage return'], t: ['\t', 'a tab'], v: ['\v', 'a vertical tab'], f: ['\f', 'a form feed'], 0: ['\0', 'the NUL character'] }
const HEX = /^[0-9a-fA-F]+$/

export const charName = (c) => {
  const cp = c.codePointAt(0)
  if (c === ' ') return 'a space'
  if (c === '\n') return 'a new line'
  if (c === '\r') return 'a carriage return'
  if (c === '\t') return 'a tab'
  if (cp < 32 || cp === 127) return `control character U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
  if (cp === 0xa0) return 'a non-breaking space'
  return `"${c}"`
}

/** Parse a pattern. Throws SyntaxError with a `.pos` property when the pattern is invalid. */
export function parseRegex(src, flags = '') {
  let pos = 0
  const unicode = /[uv]/.test(flags)
  let capIndex = 0
  const err = (msg, at = pos) => { throw Object.assign(new SyntaxError(msg), { pos: at }) }

  function disjunction() {
    const start = pos
    const alts = [seq()]
    while (src[pos] === '|') { pos++; alts.push(seq()) }
    return alts.length === 1 ? alts[0] : { type: 'alt', alts, start, end: pos }
  }
  function seq() {
    const start = pos
    const items = []
    while (pos < src.length && src[pos] !== '|' && src[pos] !== ')') items.push(term())
    return { type: 'seq', items, start, end: pos }
  }
  function term() {
    const start = pos
    let atom = atomNode()
    const q = quantifierAt()
    if (q) {
      if (atom.type === 'anchor' || atom.type === 'boundary' || (atom.type === 'look' && (unicode || !atom.ahead))) err('Nothing to repeat', start)
      pos = q.end
      atom = { type: 'quant', min: q.min, max: q.max, lazy: q.lazy, body: atom, start, end: pos }
    }
    return atom
  }
  function quantifierAt() {
    const c = src[pos]
    let min, max, end
    if (c === '*') { min = 0; max = Infinity; end = pos + 1 } else if (c === '+') { min = 1; max = Infinity; end = pos + 1 } else if (c === '?') { min = 0; max = 1; end = pos + 1 } else if (c === '{') {
      const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(src.slice(pos))
      if (!m) return null
      min = +m[1]
      max = m[2] ? (m[3] === '' ? Infinity : +m[3]) : min
      if (max < min) err('Numbers out of order in {} quantifier')
      end = pos + m[0].length
    } else return null
    const lazy = src[end] === '?'
    return { min, max, lazy, end: lazy ? end + 1 : end }
  }
  function atomNode() {
    const start = pos
    const c = src[pos]
    if (c === '(') return group()
    if (c === '[') return charClass()
    if (c === '.') { pos++; return { type: 'any', start, end: pos } }
    if (c === '^' || c === '$') { pos++; return { type: 'anchor', kind: c, start, end: pos } }
    if (c === '\\') return escape(false)
    if (c === '*' || c === '+' || c === '?') err('Nothing to repeat')
    if (c === '{') {
      if (quantifierAt() || unicode) err(unicode ? 'Lone "{" is not allowed in unicode mode' : 'Nothing to repeat')
    }
    if (c === '}' && unicode) err('Lone "}" is not allowed in unicode mode')
    if (c === ']' && unicode) err('Lone "]" is not allowed in unicode mode')
    const ch = String.fromCodePoint(src.codePointAt(pos))
    pos += ch.length
    return { type: 'lit', value: ch, raw: ch, start, end: pos }
  }
  function group() {
    const start = pos
    pos++ // (
    let node
    if (src[pos] === '?') {
      const rest = src.slice(pos)
      let m
      if (rest.startsWith('?:')) { pos += 2; node = { type: 'group', capture: false } } else if (rest.startsWith('?=') || rest.startsWith('?!')) {
        node = { type: 'look', ahead: true, negate: rest[1] === '!' }; pos += 2
      } else if (rest.startsWith('?<=') || rest.startsWith('?<!')) {
        node = { type: 'look', ahead: false, negate: rest[2] === '!' }; pos += 3
      } else if ((m = /^\?<([A-Za-z_$][\w$]*)>/.exec(rest))) {
        node = { type: 'group', capture: true, name: m[1], index: ++capIndex }; pos += m[0].length
      } else if ((m = /^\?([ims]*)(?:-([ims]+))?:/.exec(rest))) {
        node = { type: 'group', capture: false, add: m[1], remove: m[2] || '' }; pos += m[0].length
      } else err('Invalid group syntax after "(?"')
    } else node = { type: 'group', capture: true, index: ++capIndex }
    node.body = disjunction()
    if (src[pos] !== ')') err('Unterminated group: missing ")"', start)
    pos++
    node.start = start
    node.end = pos
    return node
  }
  function charClass() {
    const start = pos
    pos++ // [
    let negate = false
    if (src[pos] === '^') { negate = true; pos++ }
    const items = []
    while (pos < src.length && src[pos] !== ']') {
      const a = classAtom()
      if (src[pos] === '-' && pos + 1 < src.length && src[pos + 1] !== ']' && a.type === 'lit') {
        const dash = pos
        pos++
        const b = classAtom()
        if (b.type !== 'lit') { items.push(a, { type: 'lit', value: '-', raw: '-', start: dash, end: dash + 1 }, b) } else {
          if (a.value.codePointAt(0) > b.value.codePointAt(0)) err('Range out of order in character class', a.start)
          items.push({ type: 'range', from: a, to: b, start: a.start, end: b.end })
        }
      } else items.push(a)
    }
    if (src[pos] !== ']') err('Unterminated character class: missing "]"', start)
    pos++
    return { type: 'set', negate, items, start, end: pos }
  }
  function classAtom() {
    if (src[pos] === '\\') return escape(true)
    const start = pos
    const ch = String.fromCodePoint(src.codePointAt(pos))
    pos += ch.length
    return { type: 'lit', value: ch, raw: ch, start, end: pos }
  }
  function escape(inClass) {
    const start = pos
    pos++ // backslash
    if (pos >= src.length) err('A pattern cannot end with a backslash', start)
    const c = src[pos]
    const done = (node) => ({ ...node, start, end: pos })
    pos++
    if ('dDwWsS'.includes(c)) return done({ type: 'cls', name: c, raw: '\\' + c })
    if (!inClass && (c === 'b' || c === 'B')) return done({ type: 'boundary', negate: c === 'B', raw: '\\' + c })
    if (inClass && c === 'b') return done({ type: 'lit', value: '\b', raw: '\\b', desc: 'a backspace' })
    if ((c === 'p' || c === 'P') && unicode) {
      const m = /^\{([^}]*)\}/.exec(src.slice(pos))
      if (!m) err('Invalid property escape: expected \\p{Name}', start)
      pos += m[0].length
      return done({ type: 'prop', negate: c === 'P', name: m[1], raw: src.slice(start, pos) })
    }
    if (c === 'k' && !inClass && src[pos] === '<') {
      const m = /^<([^>]+)>/.exec(src.slice(pos))
      if (m) { pos += m[0].length; return done({ type: 'backref', name: m[1], raw: src.slice(start, pos) }) }
    }
    if (!inClass && /[1-9]/.test(c)) {
      const m = /^\d*/.exec(src.slice(pos))
      pos += m[0].length
      return done({ type: 'backref', index: +(c + m[0]), raw: src.slice(start, pos) })
    }
    if (c in CONTROL && !(c === '0' && /\d/.test(src[pos] || ''))) return done({ type: 'lit', value: CONTROL[c][0], raw: '\\' + c, desc: CONTROL[c][1] })
    if (c === 'c' && /[A-Za-z]/.test(src[pos] || '')) { const l = src[pos++]; return done({ type: 'lit', value: String.fromCharCode(l.charCodeAt(0) % 32), raw: '\\c' + l, desc: `Ctrl+${l.toUpperCase()}` }) }
    if (c === 'x' && HEX.test(src.slice(pos, pos + 2)) && src.slice(pos, pos + 2).length === 2) { const v = src.slice(pos, pos + 2); pos += 2; return done({ type: 'lit', value: String.fromCharCode(parseInt(v, 16)), raw: '\\x' + v }) }
    if (c === 'u') {
      if (src[pos] === '{' && unicode) {
        const m = /^\{([0-9a-fA-F]+)\}/.exec(src.slice(pos))
        if (m) { pos += m[0].length; return done({ type: 'lit', value: String.fromCodePoint(parseInt(m[1], 16)), raw: src.slice(start, pos) }) }
      } else if (HEX.test(src.slice(pos, pos + 4)) && src.slice(pos, pos + 4).length === 4) {
        let v = src.slice(pos, pos + 4)
        pos += 4
        let ch = String.fromCharCode(parseInt(v, 16))
        if (unicode && /^\\u[dD][89abAB]/.test('\\u' + v) && /^\\u[dD][c-fC-F]/.test(src.slice(pos, pos + 6))) { const lo = src.slice(pos + 2, pos + 6); pos += 6; ch += String.fromCharCode(parseInt(lo, 16)); v += '\\u' + lo }
        return done({ type: 'lit', value: ch, raw: '\\u' + v })
      }
    }
    if (c === '-' && inClass) return done({ type: 'lit', value: '-', raw: '\\-' })
    // identity escape, e.g. \. \/ \- \\
    const ch = String.fromCodePoint(src.codePointAt(pos - 1))
    pos += ch.length - 1
    return done({ type: 'lit', value: ch, raw: src.slice(start, pos) })
  }

  const ast = disjunction()
  if (pos < src.length) err(src[pos] === ')' ? 'Unmatched ")"' : 'Unexpected character', pos)
  return { ast, groups: capIndex, source: src, flags }
}

// ---------- Plain-English descriptions ----------
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

export function quantText(min, max, lazy) {
  let t
  if (min === 0 && max === Infinity) t = 'zero or more times'
  else if (min === 1 && max === Infinity) t = 'one or more times'
  else if (min === 0 && max === 1) t = 'optionally (zero or one time)'
  else if (min === max) t = min === 1 ? 'exactly once' : `exactly ${plural(min, 'time')}`
  else if (max === Infinity) t = `${min} or more times`
  else t = `between ${min} and ${max} times`
  return t + (lazy ? ', as few as possible (lazy)' : '')
}

const lit = (n) => n.desc || charName(n.value)
export function setItemText(it) {
  if (it.type === 'range') return `${it.from.raw}-${it.to.raw}`
  return it.raw
}

/** One-line description of a single node (without its children). */
export function describe(n, flags = '') {
  switch (n.type) {
    case 'lit': return `Matches ${lit(n)}`
    case 'any': return flags.includes('s') ? 'Matches any character, including line breaks' : 'Matches any character except a line break'
    case 'cls': return `Matches ${CLASS_NAMES[n.name]}`
    case 'prop': return `Matches a character ${n.negate ? 'without' : 'with'} the Unicode property ${n.name}`
    case 'anchor': return n.kind === '^' ? (flags.includes('m') ? 'Start of a line' : 'Start of the text') : (flags.includes('m') ? 'End of a line' : 'End of the text')
    case 'boundary': return n.negate ? 'A position that is not a word boundary' : 'A word boundary (between a word character and a non-word character)'
    case 'backref': return n.name ? `Matches the same text as the group named "${n.name}"` : `Matches the same text as capture group ${n.index}`
    case 'set': {
      const parts = n.items.map((it) => (it.type === 'range' ? `${lit(it.from).replace(/^"|"$/g, '')} to ${lit(it.to).replace(/^"|"$/g, '')}` : it.type === 'cls' ? CLASS_NAMES[it.name] : it.type === 'prop' ? `Unicode ${it.name}` : lit(it).replace(/^"(.*)"$/, '$1')))
      return `Matches ${n.negate ? 'any character except' : 'one of'}: ${parts.join(', ')}`
    }
    case 'group':
      if (n.capture) return n.name ? `Capture group ${n.index} named "${n.name}"` : `Capture group ${n.index}`
      if (n.add != null) return `Non-capturing group with flags${n.add ? ' +' + n.add : ''}${n.remove ? ' -' + n.remove : ''}`
      return 'Non-capturing group'
    case 'look': return `${n.ahead ? 'Lookahead' : 'Lookbehind'}: ${n.negate ? 'must NOT be ' + (n.ahead ? 'followed' : 'preceded') + ' by' : 'must be ' + (n.ahead ? 'followed' : 'preceded') + ' by'}`
    case 'alt': return 'Either of these alternatives'
    case 'quant': return `Repeat ${quantText(n.min, n.max, n.lazy)}`
    case 'seq': return 'In order'
    default: return ''
  }
}

/** Nested explanation rows: [{src, text, children}] for the whole pattern. */
export function explain(parsed) {
  const { ast, source, flags } = parsed
  const rows = (n) => {
    if (n.type === 'seq') return n.items.flatMap(rows)
    if (n.type === 'alt') return [{ src: source.slice(n.start, n.end), text: describe(n, flags), start: n.start, end: n.end, children: n.alts.map((a, i) => ({ src: source.slice(a.start, a.end) || '(empty)', text: `Option ${i + 1}`, start: a.start, end: a.end, children: rows(a) })) }]
    if (n.type === 'quant') {
      const inner = rows(n.body)
      const head = inner[0]
      const simple = n.body.type !== 'group' && n.body.type !== 'look'
      return [{ src: source.slice(n.start, n.end), text: `${head.text}, ${quantText(n.min, n.max, n.lazy)}`, start: n.start, end: n.end, children: simple ? [] : head.children }]
    }
    if (n.type === 'group' || n.type === 'look') return [{ src: source.slice(n.start, n.end), text: describe(n, flags), start: n.start, end: n.end, children: rows(n.body) }]
    return [{ src: source.slice(n.start, n.end), text: describe(n, flags), start: n.start, end: n.end, children: [] }]
  }
  return rows(ast)
}
