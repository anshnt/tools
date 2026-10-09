// A small PDF content-stream engine: tokenise page drawing operators, decode text with a font's ToUnicode map,
// and cut out text, images and layers. Used by Remove PDF watermark. Pure functions, no DOM.

const WS = ' \t\r\n\f\0'
const DELIM = '()<>[]{}/%'
const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)$/

export function bytesToStr(u8) {
  let s = ''
  for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192))
  return s
}
export function strToBytes(s) {
  const u = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255
  return u
}

/** Read a literal string starting at s[i] === '('. Returns [bytesAsString, nextIndex]. */
function readLiteral(s, i) {
  let depth = 0, out = ''
  for (; i < s.length; i++) {
    const c = s[i]
    if (c === '\\') {
      const d = s[++i]
      if (d === 'n') out += '\n'; else if (d === 'r') out += '\r'; else if (d === 't') out += '\t'; else if (d === 'b') out += '\b'; else if (d === 'f') out += '\f'
      else if (d >= '0' && d <= '7') { let o = d; while (o.length < 3 && s[i + 1] >= '0' && s[i + 1] <= '7') o += s[++i]; out += String.fromCharCode(parseInt(o, 8) & 255) }
      else if (d === '\r') { if (s[i + 1] === '\n') i++ } else if (d === '\n') { /* line continuation */ } else out += d ?? ''
    } else if (c === '(') { if (depth++ > 0) out += c } else if (c === ')') { if (--depth === 0) return [out, i + 1]; out += c } else out += c
  }
  return [out, i]
}

/** Tokenise a content stream into statements: {op, operands: [{t, v}], start, end} with string offsets. */
export function parse(s) {
  const out = []
  let operands = [], first = -1, i = 0
  const n = s.length
  while (i < n) {
    const c = s[i]
    if (WS.includes(c)) { i++; continue }
    if (c === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue }
    const start = i
    let tok
    if (c === '(') { const [v, e] = readLiteral(s, i); i = e; tok = { t: 'str', v } }
    else if (c === '<' && s[i + 1] === '<') { i += 2; tok = { t: 'p', v: '<<' } }
    else if (c === '<') {
      const e = s.indexOf('>', i)
      const hex = s.slice(i + 1, e < 0 ? n : e).replace(/\s+/g, '')
      let v = ''
      for (let k = 0; k < hex.length; k += 2) v += String.fromCharCode(parseInt((hex.slice(k, k + 2) + '0').slice(0, 2), 16))
      i = e < 0 ? n : e + 1
      tok = { t: 'str', v }
    } else if (c === '>' && s[i + 1] === '>') { i += 2; tok = { t: 'p', v: '>>' } }
    else if (c === '[' || c === ']') { i++; tok = { t: 'p', v: c } }
    else if (c === '/') { i++; while (i < n && !WS.includes(s[i]) && !DELIM.includes(s[i])) i++; tok = { t: 'name', v: s.slice(start + 1, i) } }
    else if ('(){}>'.includes(c)) { i++; continue }
    else {
      while (i < n && !WS.includes(s[i]) && !DELIM.includes(s[i])) i++
      const w = s.slice(start, i)
      tok = NUM.test(w) ? { t: 'num', v: parseFloat(w) } : { t: 'op', v: w }
    }
    if (tok.t !== 'op') { operands.push(tok); if (first < 0) first = start; continue }
    let end = i
    if (tok.v === 'BI') {
      const id = /[\s]ID[\s]/.exec(s.slice(i))
      if (id) {
        const dataStart = i + id.index + id[0].length
        const ei = /[\s]EI(?=[\s]|$)/.exec(s.slice(dataStart))
        end = ei ? dataStart + ei.index + ei[0].length : n
        i = end
      }
    }
    out.push({ op: tok.v, operands, start: first < 0 ? start : first, end })
    operands = []; first = -1
  }
  return out
}

/** Parse a ToUnicode CMap into {map: Map<code, string>, codeLen}. */
export function parseToUnicode(text) {
  const map = new Map()
  let codeLen = 0
  const u = (hex) => { const h = hex.padStart(Math.ceil(hex.length / 4) * 4, '0'); let r = ''; for (let k = 0; k < h.length; k += 4) r += String.fromCharCode(parseInt(h.slice(k, k + 4), 16)); return r }
  for (const sec of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of sec[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) { codeLen ||= m[1].length / 2; map.set(parseInt(m[1], 16), u(m[2])) }
  }
  for (const sec of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of sec[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)) {
      codeLen ||= m[1].length / 2
      const lo = parseInt(m[1], 16), hi = Math.min(parseInt(m[2], 16), lo + 65535)
      if (m[3]) { const base = u(m[3]); for (let c = lo; c <= hi; c++) map.set(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (c - lo))) }
      else { const parts = [...m[4].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => u(x[1])); for (let c = lo; c <= hi && c - lo < parts.length; c++) map.set(c, parts[c - lo]) }
    }
  }
  return { map, codeLen: codeLen || 1 }
}

const AGL = { space: ' ', period: '.', comma: ',', hyphen: '-', minus: '-', underscore: '_', colon: ':', semicolon: ';', slash: '/', parenleft: '(', parenright: ')', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', exclam: '!', question: '?', at: '@', ampersand: '&', percent: '%', numbersign: '#', dollar: '$', quotesingle: "'", quotedbl: '"', plus: '+', equal: '=', bracketleft: '[', bracketright: ']' }
export const glyphChar = (name) => (name.length === 1 ? name : AGL[name] ?? (/^uni([0-9A-Fa-f]{4})$/.test(name) ? String.fromCharCode(parseInt(name.slice(3), 16)) : ''))

/**
 * Make a decoder from font facts: {toUnicode: string|null, differences: {code: glyphName}, composite: bool}.
 * decode(rawString) -> text. Composite fonts without a ToUnicode map cannot be decoded (returns '').
 */
export function makeDecoder({ toUnicode, differences = {}, composite = false }) {
  if (toUnicode) {
    const { map, codeLen } = parseToUnicode(toUnicode)
    return (raw) => { let t = ''; for (let i = 0; i < raw.length; i += codeLen) { let code = 0; for (let k = 0; k < codeLen; k++) code = code * 256 + (raw.charCodeAt(i + k) || 0); t += map.get(code) ?? '' } return t }
  }
  if (composite) return () => ''
  return (raw) => { let t = ''; for (let i = 0; i < raw.length; i++) { const c = raw.charCodeAt(i); t += differences[c] !== undefined ? glyphChar(differences[c]) : String.fromCharCode(c) } return t }
}

const norm = (t) => t.toLowerCase().replace(/\s+/g, ' ').trim()
const squash = (t) => t.toLowerCase().replace(/\s+/g, '')

/**
 * Cut watermark pieces out of one content stream (as a latin1 string).
 * opts: {needles: string[], decoderFor(fontName) -> fn|null, wmProps: Set<string> (names of watermark layers in /Properties), wmXObjects: Set<string> (names to drop when drawn)}
 * Returns {text, removed: {text, layers, images}, hits: string[]}.
 */
export function cleanContent(s, opts) {
  const { needles = [], decoderFor = () => null, wmProps = new Set(), wmXObjects = new Set() } = opts
  const stmts = parse(s)
  const cuts = []
  const removed = { text: 0, layers: 0, images: 0 }
  const hits = new Set()
  const ns = needles.map((n) => norm(n)).filter(Boolean)
  const nsq = ns.map((n) => n.replace(/\s+/g, ''))
  let font = null, bt = null
  const mc = []
  const showText = (st) => {
    const dec = font ? decoderFor(font) : null
    const raw = (op) => (op === 'TJ' ? st.operands.filter((x) => x.t === 'str') : [st.operands.at(-1)].filter((x) => x?.t === 'str'))
    return raw(st.op).map((x) => (dec ? dec(x.v) : x.v)).join('')
  }
  for (const st of stmts) {
    switch (st.op) {
      case 'Tf': font = st.operands[0]?.t === 'name' ? st.operands[0].v : font; break
      case 'BT': bt = { start: st.start, shows: [] }; break
      case 'ET':
        if (bt && ns.length) {
          // a needle inside one show operator: cut just that operator
          const hit = bt.shows.map((sh) => { const t = norm(sh.text); return t ? ns.findIndex((n, k) => t.includes(n) || squash(t).includes(nsq[k])) : -1 })
          bt.shows.forEach((sh, i) => { if (hit[i] >= 0) { cuts.push([sh.st.start, sh.st.end]); removed.text++; hits.add(needles[hit[i]]) } })
          // a needle spread over several operators (for example one letter each): cut the whole text object when it holds little else
          if (hit.every((x) => x < 0)) {
            const all = squash(bt.shows.map((x) => x.text).join(''))
            const j = all ? nsq.findIndex((n) => all.includes(n) && all.length <= n.length + 4) : -1
            if (j >= 0) { cuts.push([bt.start, st.end]); removed.text++; hits.add(needles[j]) }
          }
        }
        bt = null
        break
      case 'Tj': case 'TJ': case "'": case '"':
        if (bt) bt.shows.push({ st, text: showText(st) })
        break
      case 'BDC': {
        const tag = st.operands[0]?.v, prop = st.operands[1]
        mc.push({ wm: tag === 'OC' && prop?.t === 'name' && wmProps.has(prop.v), start: st.start })
        break
      }
      case 'BMC': mc.push({ wm: false, start: st.start }); break
      case 'EMC': { const m = mc.pop(); if (m?.wm) { cuts.push([m.start, st.end]); removed.layers++ } break }
      case 'Do': if (st.operands[0]?.t === 'name' && wmXObjects.has(st.operands[0].v)) { cuts.push([st.start, st.end]); removed.images++ } break
      default:
    }
  }
  if (!cuts.length) return { text: s, removed, hits: [...hits] }
  cuts.sort((a, b) => a[0] - b[0])
  let out = '', pos = 0
  for (const [a, b] of cuts) { if (a >= pos) { out += s.slice(pos, a) + '\n'; pos = b } else if (b > pos) pos = b }
  out += s.slice(pos)
  return { text: out, removed, hits: [...hits] }
}
