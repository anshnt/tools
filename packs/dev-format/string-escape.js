// String escaper: type or paste text once and see it escaped (or unescaped) for nine formats side by side, each ready to copy.
// The escape and unescape functions are pure and exported so they can be tested in Node.
import { editor, samples, seg, toggle, select, h, DevError, lineCol, copyBtn, aurora, focusOnDesktop, injectStyles } from './_shared.js'
import { encodeEntities, decodeEntities } from './_entities.js'
import { debounce, formatNumber } from '../../lib/ui.js'

const hex = (n, w) => n.toString(16).toUpperCase().padStart(w, '0')
const err = (text, pos, message, hint) => { const { line, col } = lineCol(text, pos); return new DevError(message, { line, col, hint }) }

// ---------- JavaScript and JSON ----------
const SHORT = { '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' }
/** Escape for a JavaScript or JSON string. o: {quote: '"' | "'" | '`', ascii, wrap, json} */
export function escapeJs(text, o = {}) {
  const { quote = '"', ascii = false, wrap = true, json = false } = o
  let out = ''
  const chars = [...text]
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    const cp = ch.codePointAt(0)
    if (ch === '\\') out += '\\\\'
    else if (ch === quote) out += `\\${ch}`
    else if (SHORT[ch]) out += SHORT[ch]
    else if (ch === '$' && quote === '`' && chars[i + 1] === '{') out += '\\$'
    else if (cp < 32 || cp === 127) out += json ? `\\u${hex(cp, 4)}` : cp === 11 ? '\\v' : cp === 0 && !/\d/.test(chars[i + 1] || '') ? '\\0' : `\\x${hex(cp, 2)}`
    else if (cp === 0x2028 || cp === 0x2029) out += `\\u${hex(cp, 4)}`
    else if (ascii && cp > 126) out += cp > 0xffff ? `\\u${hex(0xd800 + ((cp - 0x10000) >> 10), 4)}\\u${hex(0xdc00 + ((cp - 0x10000) & 0x3ff), 4)}` : `\\u${hex(cp, 4)}`
    else out += ch
  }
  return wrap ? quote + out + quote : out
}
/** Unescape a JavaScript or JSON string literal (the surrounding quotes are optional). Throws DevError at the bad escape. */
export function unescapeJs(text, o = {}) {
  const { json = false } = o
  let s = text
  let off = 0
  const t = text.trim()
  const q = t[0]
  if (t.length >= 2 && t[t.length - 1] === q && (q === '"' || (!json && (q === "'" || q === '`')))) { off = text.indexOf(q) + 1; s = t.slice(1, -1) }
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c !== '\\') { out += c; continue }
    const e = s[i + 1]
    const bad = (m, h) => { throw err(text, off + i, m, h) }
    if (e === undefined) bad('The text ends with a lone backslash.', 'A backslash must be followed by the character it escapes, or written as \\\\.')
    i++
    if (e === 'n') out += '\n'
    else if (e === 't') out += '\t'
    else if (e === 'r') out += '\r'
    else if (e === 'b') out += '\b'
    else if (e === 'f') out += '\f'
    else if (e === '"' || e === '\\' || e === '/') out += e
    else if (e === 'u') {
      if (s[i + 1] === '{' && !json) {
        const end = s.indexOf('}', i)
        const h = end === -1 ? '' : s.slice(i + 2, end)
        if (!/^[0-9a-fA-F]{1,6}$/.test(h) || parseInt(h, 16) > 0x10ffff) bad('Invalid \\u{...} escape.')
        out += String.fromCodePoint(parseInt(h, 16)); i = end
      } else {
        const h = s.slice(i + 1, i + 5)
        if (!/^[0-9a-fA-F]{4}$/.test(h)) bad('A \\u escape needs exactly four hex digits.', 'For example \\u00e9 is the letter e with an acute accent.')
        out += String.fromCharCode(parseInt(h, 16)); i += 4
      }
    } else if (json) bad(`\\${e} is not a valid JSON escape.`, 'JSON only allows \\" \\\\ \\/ \\b \\f \\n \\r \\t and \\uXXXX.')
    else if (e === 'x') {
      const h = s.slice(i + 1, i + 3)
      if (!/^[0-9a-fA-F]{2}$/.test(h)) bad('A \\x escape needs exactly two hex digits.')
      out += String.fromCharCode(parseInt(h, 16)); i += 2
    } else if (e === 'v') out += '\v'
    else if (e === '0' && !/\d/.test(s[i + 1] || '')) out += '\0'
    else if (e === '\n') { /* line continuation */ } else if (e === '\r') { if (s[i + 1] === '\n') i++ } else out += e
  }
  return out
}

// ---------- XML ----------
const XML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }
export function escapeXml(text, o = {}) {
  if (o.cdata) return `<![CDATA[${text.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`
  return text.replace(/[&<>"']/g, (c) => XML_ESC[c])
}
export function unescapeXml(text) {
  const parts = text.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/)
  return parts.map((p) => (p.startsWith('<![CDATA[') ? p.slice(9, -3) : p.replace(/&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9a-fA-F]+));/g, (m, n, d, x) => {
    if (n) return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[n]
    const cp = d ? +d : parseInt(x, 16)
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m
  }))).join('')
}

// ---------- CSV ----------
export function escapeCsv(text, o = {}) {
  const { delimiter = ',', always = false } = o
  const need = always || text.includes(delimiter) || /["\r\n]/.test(text) || /^\s|\s$/.test(text)
  return need ? `"${text.replace(/"/g, '""')}"` : text
}
export function unescapeCsv(text) {
  const t = text.replace(/\r?\n$/, '')
  if (!t.startsWith('"')) return t
  if (t.length < 2 || !t.endsWith('"')) throw err(text, 0, 'The quoted field is never closed.', 'A field that starts with a quote must end with one.')
  const body = t.slice(1, -1)
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '"') continue
    if (body[i + 1] === '"') i++
    else throw err(text, i + 1, 'A quote inside the field is not doubled.', 'Inside a quoted CSV field, every quote must be written twice ("").')
  }
  return body.replace(/""/g, '"')
}

// ---------- SQL ----------
const MYSQL = { '\0': '\\0', '\n': '\\n', '\r': '\\r', '\\': '\\\\', "'": "\\'", '"': '\\"', '\x1a': '\\Z' }
export function escapeSql(text, o = {}) {
  const { style = 'standard', wrap = true } = o
  const body = style === 'mysql' ? text.replace(/[\0\n\r\\'"\x1a]/g, (c) => MYSQL[c]) : text.replace(/'/g, "''")
  return wrap ? `'${body}'` : body
}
export function unescapeSql(text, o = {}) {
  const { style = 'standard' } = o
  let s = text.trim()
  let off = text.indexOf(s)
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") { s = s.slice(1, -1); off++ }
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === "'") {
      if (s[i + 1] !== "'") throw err(text, off + i, 'A single quote is not doubled.', "Inside an SQL string a quote is written twice (''). Pick the MySQL style if the text uses backslash escapes.")
      out += "'"; i++
    } else if (c === '\\' && style === 'mysql') {
      const e = s[++i]
      const map = { 0: '\0', n: '\n', r: '\r', t: '\t', b: '\b', Z: '\x1a', "'": "'", '"': '"', '\\': '\\' }
      if (e === undefined) throw err(text, off + i - 1, 'The text ends with a lone backslash.')
      out += e in map ? map[e] : e === '%' || e === '_' ? `\\${e}` : e
    } else out += c
  }
  return out
}

// ---------- regex ----------
export const escapeRegex = (text) => text.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')
export const unescapeRegex = (text) => text.replace(/\\([\\^$.*+?()[\]{}|/-])/g, '$1')

// ---------- URL ----------
export function escapeUrl(text, o = {}) {
  const { mode = 'component' } = o
  if (mode === 'uri') return encodeURI(text)
  const e = encodeURIComponent(text)
  return mode === 'form' ? e.replace(/%20/g, '+') : e
}
export function unescapeUrl(text, o = {}) {
  const { mode = 'component' } = o
  const src = mode === 'form' ? text.replace(/\+/g, ' ') : text
  try {
    return mode === 'uri' ? decodeURI(src) : decodeURIComponent(src)
  } catch {
    const m = /%(?![0-9a-fA-F]{2})/.exec(src)
    if (m) throw err(text, m.index, 'A percent sign must be followed by two hex digits.', 'Write a literal percent sign as %25.')
    const u = /(%[0-9a-fA-F]{2})+/.exec(src)
    throw err(text, u ? u.index : 0, 'These %XX codes are not valid UTF-8 text.', 'The bytes may use another encoding such as Latin-1.')
  }
}

// ---------- shell ----------
export function escapeShell(text, o = {}) {
  const { style = 'posix-single' } = o
  if (style === 'powershell') return `'${text.replace(/'/g, "''")}'`
  if (style === 'posix-double') return `"${text.replace(/[\\"$`]/g, '\\$&')}"`
  return `'${text.replace(/'/g, "'\\''")}'`
}
/** Decode one shell word: handles 'single', "double" and \backslash quoting, and joins adjacent pieces. */
export function unescapeShell(text, o = {}) {
  const s = text.trim()
  if (o.style === 'powershell') {
    if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") return s.slice(1, -1).replace(/''/g, "'")
    if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') return s.slice(1, -1).replace(/`(.)/g, '$1').replace(/""/g, '"')
    return s
  }
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === "'") {
      const end = s.indexOf("'", i + 1)
      if (end === -1) throw err(text, text.indexOf(s) + i, "This single quote is never closed.", "Every ' needs a matching ' (inside single quotes nothing can be escaped).")
      out += s.slice(i + 1, end); i = end
    } else if (c === '"') {
      let j = i + 1
      for (; j < s.length && s[j] !== '"'; j++) {
        if (s[j] === '\\' && /[$`"\\\n]/.test(s[j + 1] || '')) { if (s[j + 1] !== '\n') out += s[j + 1]; j++ } else out += s[j]
      }
      if (j >= s.length) throw err(text, text.indexOf(s) + i, 'This double quote is never closed.')
      i = j
    } else if (c === '\\') { if (i + 1 < s.length) { if (s[i + 1] !== '\n') out += s[i + 1]; i++ } } else out += c
  }
  return out
}

/** The nine formats. v: variant choices; wrap and ascii are the shared toggles. */
export const FORMATS = [
  { id: 'json', name: 'JSON', hint: 'string value', tile: '{}', color: '#f59e0b', esc: (t, s) => escapeJs(t, { json: true, quote: '"', ascii: s.ascii, wrap: s.wrap }), un: (t) => unescapeJs(t, { json: true }) },
  { id: 'js', name: 'JavaScript', hint: 'string literal', tile: 'JS', color: '#eab308', variant: ['quote', [['"', 'Double "'], ["'", "Single '"], ['`', 'Template `']]], esc: (t, s) => escapeJs(t, { quote: s.v.quote, ascii: s.ascii, wrap: s.wrap }), un: (t) => unescapeJs(t) },
  { id: 'html', name: 'HTML', hint: 'entities', tile: '</>', color: '#ef4444', esc: (t, s) => encodeEntities(t, { scope: s.ascii ? 'non-ascii' : 'basic', format: 'named' }).out, un: (t) => decodeEntities(t).out },
  { id: 'xml', name: 'XML', hint: 'text or attribute', tile: 'XML', color: '#f97316', variant: ['xml', [['entities', 'Entities'], ['cdata', 'CDATA']]], esc: (t, s) => escapeXml(t, { cdata: s.v.xml === 'cdata' }), un: (t) => unescapeXml(t) },
  { id: 'csv', name: 'CSV', hint: 'one field', tile: ',', color: '#10b981', variant: ['csv', [[',', 'Comma'], [';', 'Semicolon'], ['\t', 'Tab'], ['|', 'Pipe']]], esc: (t, s) => escapeCsv(t, { delimiter: s.v.csv, always: s.wrap }), un: (t) => unescapeCsv(t) },
  { id: 'sql', name: 'SQL', hint: 'string literal', tile: 'SQL', color: '#3b82f6', variant: ['sql', [['standard', "Standard ''"], ['mysql', 'MySQL \\']]], esc: (t, s) => escapeSql(t, { style: s.v.sql, wrap: s.wrap }), un: (t, s) => unescapeSql(t, { style: s.v.sql }) },
  { id: 'regex', name: 'Regex', hint: 'literal text', tile: '.*', color: '#8b5cf6', esc: (t) => escapeRegex(t), un: (t) => unescapeRegex(t) },
  { id: 'url', name: 'URL', hint: 'percent-encoding', tile: '%', color: '#06b6d4', variant: ['url', [['component', 'Component'], ['uri', 'Full URL'], ['form', 'Form (+)']]], esc: (t, s) => escapeUrl(t, { mode: s.v.url }), un: (t, s) => unescapeUrl(t, { mode: s.v.url }) },
  { id: 'shell', name: 'Shell', hint: 'one argument', tile: '$', color: '#64748b', variant: ['shell', [['posix-single', "Bash '...'"], ['posix-double', 'Bash "..."'], ['powershell', 'PowerShell']]], esc: (t, s) => escapeShell(t, { style: s.v.shell }), un: (t, s) => unescapeShell(t, { style: s.v.shell }) },
]

const SAMPLES = [
  { label: 'Quotes and newlines', icon: 'quote', text: 'He said "hello" and left.\nPath: C:\\temp\\new folder\tTab\nPrice: $5 <b>sale</b> & more', dir: 'escape' },
  { label: "SQL name O'Brien", icon: 'database', text: "Robert O'Brien; DROP TABLE users; --", dir: 'escape' },
  { label: 'Regex special chars', icon: 'asterisk', text: 'report (final) [v2].pdf costs $5.00 + tax?', dir: 'escape' },
  { label: 'URL parameter', icon: 'link', text: 'name=José & café/q?x=1#top', dir: 'escape' },
  { label: 'Escaped JSON string', icon: 'braces', text: '"Line one\\nLine \\"two\\"\\tTabbed \\u00e9 \\ud83d\\ude00"', dir: 'unescape' },
]
const MAX_SHOW = 20000

export function mount(root) {
  injectStyles()
  const state = { dir: 'escape', wrap: true, ascii: false, v: { quote: '"', xml: 'entities', csv: ',', sql: 'standard', url: 'component', shell: 'posix-single' } }
  const cardEls = new Map()
  const render = () => {
    const text = ed.value
    for (const f of FORMATS) {
      const c = cardEls.get(f.id)
      let out = null, bad = null
      if (!text) bad = state.dir === 'escape' ? 'Type something above' : 'Paste an escaped string above'
      else {
        try { out = (state.dir === 'escape' ? f.esc : f.un)(text, state) } catch (e) { bad = e instanceof DevError ? `${e.message}${e.line ? ` (line ${e.line}, column ${e.col})` : ''}` : String(e.message || e) }
      }
      c.pre.classList.toggle('na', out === null)
      c.pre.textContent = out === null ? bad : out.length > MAX_SHOW ? `${out.slice(0, MAX_SHOW)}\n... ${formatNumber(out.length - MAX_SHOW, 0)} more characters (Copy has them all)` : out
      c.out = out ?? ''
      c.copy.disabled = out === null
      c.copy.hidden = false
      c.size.textContent = out === null ? '' : `${formatNumber([...out].length, 0)} chars`
    }
  }
  const schedule = debounce(render, 90)
  const ed = editor({ title: 'Text', ic: 'quote', placeholder: 'Type or paste text, or an escaped string, and every format below updates live...', accept: '.txt,.json,.csv,.sql,text/plain', actions: ['upload', 'paste', 'clear'], onInput: () => { sampleRow.hidden = !!ed.value; schedule() }, onRun: render })
  ed.el.style.setProperty('--df-h', 'clamp(150px, 26vh, 230px)')
  const dirSeg = seg([['escape', 'Escape'], ['unescape', 'Unescape']], 'escape', (v) => setDir(v), 'Direction')
  function setDir(v) {
    state.dir = v
    dirSeg.set(v)
    for (const f of FORMATS) cardEls.get(f.id).sub.textContent = v === 'escape' ? f.hint : `reads a ${f.hint}`
    render()
  }
  const sampleRow = samples(SAMPLES, (smp) => { ed.set(smp.text, { emit: false }); sampleRow.hidden = true; setDir(smp.dir) })
  const wrapOpt = toggle('Wrap in quotes', true, (v) => { state.wrap = v; render() })
  const asciiOpt = toggle('Escape non-ASCII', false, (v) => { state.ascii = v; render() })
  const bar = h('div', { class: ['df-bar', 'df-sticky'] }, h('div', { class: 'df-opt' }, h('span', { class: 'df-ol' }, 'Mode'), dirSeg), wrapOpt, asciiOpt)

  const cards = h('div', { class: 'df-cards' }, FORMATS.map((f, i) => {
    const c = {}
    c.pre = h('pre', { class: 'na', tabindex: 0 }, 'Type something above')
    c.copy = copyBtn(() => c.out || '', '', { ariaLabel: `Copy the ${f.name} result` })
    c.copy.hidden = true
    c.size = h('small')
    c.sub = h('small', f.hint)
    const variant = f.variant ? select(f.variant[1], state.v[f.variant[0]], (val) => { state.v[f.variant[0]] = val; render() }) : null
    if (variant) { variant.setAttribute('aria-label', `${f.name} style`); variant.style.cssText = 'height:30px;min-width:0;width:auto;font-size:12.5px;border-radius:9px;margin-left:auto'; c.copy.style.marginLeft = '0' }
    cardEls.set(f.id, c)
    return h('section', { class: 'df-card', style: { '--cc': f.color, '--i': i }, 'aria-label': `${f.name} result` },
      h('div', { class: 'df-card-h' }, h('span', { class: 'tile', 'aria-hidden': 'true' }, f.tile), h('div', h('b', f.name), c.sub), variant, c.copy),
      c.pre, h('div', { class: 'df-card-f', style: 'padding:0 14px 10px;color:var(--muted);font-size:11.5px' }, c.size))
  }))
  root.append(h('div', { class: 't-df' }, aurora(), bar, ed.el, sampleRow, cards))
  render()
  focusOnDesktop(ed)
}
