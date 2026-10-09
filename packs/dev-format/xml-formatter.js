// XML formatter: pretty-print, minify and validate. Validation uses the browser's own XML parser (DOMParser) so the
// error line and column are real; formatting works on the source text so entities, CDATA, quotes and comments survive exactly.
import { studio, opt, seg, toggle, INDENTS, indentUnit, DevError, focusOnDesktop } from './_shared.js'
import { baseName } from '../../lib/files.js'
import { formatBytes, formatNumber } from '../../lib/ui.js'

/** Throws a DevError (with line and column) when the text is not well-formed XML. Returns the parsed Document. */
export function validateXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const bad = doc.getElementsByTagName('parsererror')[0]
  if (!bad) return doc
  const raw = (bad.textContent || '').replace(/\s+/g, ' ').trim()
  let line, col, msg
  let m = raw.match(/error on line (\d+) at column (\d+):\s*(.*?)(?: Below is a rendering.*)?$/i)
  if (m) { line = +m[1]; col = +m[2]; msg = m[3] } else {
    m = raw.match(/Line Number (\d+), Column (\d+)/i)
    line = m ? +m[1] : 1
    col = m ? +m[2] : 1
    msg = raw.replace(/^XML Parsing Error:\s*/i, '').replace(/\s*Location:.*$/i, '')
  }
  msg = msg.replace(/^error:\s*/i, '').trim()
  throw new DevError(`${msg.charAt(0).toUpperCase()}${msg.slice(1)}${/[.!?]$/.test(msg) ? '' : '.'}`, { line, col, hint: hintFor(msg) })
}
function hintFor(msg) {
  if (/opening and ending tag mismatch|mismatched tag/i.test(msg)) return 'A start tag and its end tag must use the same name, and tags must close in the reverse order they were opened.'
  if (/entity/i.test(msg)) return 'Use &amp; for an ampersand, or numeric references like &#160; instead of HTML names like &nbsp;.'
  if (/attribute/i.test(msg)) return 'Attribute values must be in quotes, and the same attribute cannot appear twice on one tag.'
  if (/extra content|junk|at the end/i.test(msg)) return 'An XML document has exactly one root element.'
  return null
}

// ----- source-preserving tokenizer and tree -----
function tokenize(src) {
  const out = []
  const n = src.length
  let i = 0
  while (i < n) {
    if (src[i] !== '<') {
      const j = src.indexOf('<', i)
      const end = j === -1 ? n : j
      out.push({ k: 'text', s: src.slice(i, end) })
      i = end
      continue
    }
    let end, k
    if (src.startsWith('<!--', i)) { end = src.indexOf('-->', i + 4); end = end === -1 ? n : end + 3; k = 'comment' } else if (src.startsWith('<![CDATA[', i)) { end = src.indexOf(']]>', i + 9); end = end === -1 ? n : end + 3; k = 'cdata' } else if (src.startsWith('<?', i)) { end = src.indexOf('?>', i + 2); end = end === -1 ? n : end + 2; k = 'pi' } else if (src.startsWith('<!', i)) {
      let j = i + 2, depth = 0
      for (; j < n; j++) { const c = src[j]; if (c === '[') depth++; else if (c === ']') depth--; else if (c === '>' && depth <= 0) break }
      end = Math.min(n, j + 1)
      k = 'doctype'
    } else {
      let j = i + 1, q = ''
      for (; j < n; j++) { const c = src[j]; if (q) { if (c === q) q = '' } else if (c === '"' || c === "'") q = c; else if (c === '>') break }
      end = Math.min(n, j + 1)
      const s = src.slice(i, end)
      k = s[1] === '/' ? 'close' : /\/\s*>$/.test(s) ? 'selfclose' : 'open'
    }
    out.push({ k, s: src.slice(i, end), a: i, b: end })
    i = end
  }
  return out
}
function parseTag(s) {
  const m = s.match(/^<\/?\s*([^\s/>]+)/)
  const rest = s.slice(m ? m[0].length : 1).replace(/\/?\s*>$/, '')
  const attrs = []
  for (const a of rest.matchAll(/([^\s=]+)(?:\s*=\s*("[^"]*"|'[^']*'))?/g)) attrs.push({ name: a[1], value: a[2] ?? null })
  return { name: m ? m[1] : '', attrs }
}
function build(src) {
  const root = { children: [] }
  const stack = [root]
  for (const t of tokenize(src)) {
    const top = stack[stack.length - 1]
    if (t.k === 'open' || t.k === 'selfclose') {
      const { name, attrs } = parseTag(t.s)
      const el = { k: 'el', name, attrs, children: [], self: t.k === 'selfclose', openEnd: t.b }
      top.children.push(el)
      if (t.k === 'open') stack.push(el)
    } else if (t.k === 'close') {
      if (stack.length > 1) stack.pop().innerEnd = t.a
    } else top.children.push(t)
  }
  return root
}
const isWs = (c) => c.k === 'text' && !c.s.trim()
const isText = (c) => (c.k === 'text' && !!c.s.trim()) || c.k === 'cdata'
const attrText = (a) => (a.value == null ? a.name : `${a.name}=${a.value}`)
const keepsSpace = (el) => el.attrs.some((a) => a.name === 'xml:space' && /preserve/.test(a.value || ''))

/** Pretty-print or minify XML text (the input must be well-formed). o: {indent, minify, comments, selfClose, wrap, trim} */
export function formatXml(src, o = {}) {
  const { indent = '  ', minify = false, comments = true, selfClose = false, wrap = 100, trim = true } = o
  const root = build(src)
  const head = (el, pad, canWrap) => {
    const parts = el.attrs.map(attrText)
    const flat = `<${el.name}${parts.map((a) => ` ${a}`).join('')}`
    if (canWrap && wrap && parts.length > 1 && pad.length + flat.length > wrap) return `<${el.name}\n${parts.map((a) => `${pad}${indent}${a}`).join('\n')}`
    return flat
  }
  const empty = (el, h) => (el.self || selfClose ? `${h}/>` : `${h}></${el.name}>`)
  const rawInner = (el, h) => `${h}>${src.slice(el.openEnd, el.innerEnd)}</${el.name}>`
  const keepSpace = (el) => keepsSpace(el) && !el.self && el.innerEnd != null
  // exact content with normalised tag syntax: used for mixed content, where whitespace matters
  const inline = (el) => {
    const h = head(el, '', false)
    if (keepSpace(el)) return rawInner(el, h)
    if (!el.children.length) return empty(el, h)
    return `${h}>${el.children.map((c) => (c.k === 'el' ? inline(c) : c.k === 'comment' ? (comments ? c.s : '') : c.s)).join('')}</${el.name}>`
  }
  const compact = (el) => {
    const h = head(el, '', false)
    if (keepSpace(el)) return rawInner(el, h)
    if (!el.children.length) return empty(el, h)
    const text = el.children.some(isText), hasEl = el.children.some((c) => c.k === 'el')
    if (text && hasEl) return inline(el)
    const parts = []
    for (const c of el.children) {
      if (c.k === 'el') parts.push(compact(c))
      else if (c.k === 'comment') { if (comments) parts.push(c.s) } else if (c.k === 'text') { if (!isWs(c)) parts.push(trim ? c.s.trim() : c.s) } else parts.push(c.s)
    }
    return `${h}>${parts.join('')}</${el.name}>`
  }
  const block = (el, depth) => {
    const pad = indent.repeat(depth)
    const h = head(el, pad, true)
    if (keepSpace(el)) return pad + rawInner(el, h)
    if (!el.children.length) return pad + empty(el, h)
    const text = el.children.some(isText), hasEl = el.children.some((c) => c.k === 'el')
    if (text && hasEl) return pad + inline(el)
    if (text) return `${pad}${h}>${el.children.map((c) => (c.k === 'text' ? (trim ? c.s.trim() : c.s) : c.s)).join('')}</${el.name}>`
    const lines = []
    for (const c of el.children) {
      if (isWs(c)) continue
      if (c.k === 'el') lines.push(block(c, depth + 1))
      else if (c.k === 'comment') { if (comments) lines.push(indent.repeat(depth + 1) + c.s) } else lines.push(indent.repeat(depth + 1) + c.s.trim())
    }
    return lines.length ? `${pad}${h}>\n${lines.join('\n')}\n${pad}</${el.name}>` : pad + empty(el, h)
  }
  const out = []
  for (const c of root.children) {
    if (c.k === 'text') continue
    if (c.k === 'el') out.push(minify ? compact(c) : block(c, 0))
    else if (c.k === 'comment') { if (comments) out.push(c.s) } else out.push(c.s.trim())
  }
  return out.join(minify ? '' : '\n') + (minify ? '' : '\n')
}

/** Counts for the stat tiles. */
export function xmlStats(doc) {
  const s = { elements: 0, attributes: 0, depth: 0, comments: 0 }
  const go = (n, d) => {
    if (n.nodeType === 1) { s.elements++; s.attributes += n.attributes.length; s.depth = Math.max(s.depth, d) } else if (n.nodeType === 8) s.comments++
    for (const c of n.childNodes) go(c, d + 1)
  }
  go(doc.documentElement, 1)
  return s
}

const RSS = '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Dev Notes</title><link>https://example.com</link><description>Short posts</description><item><title>Hello &amp; welcome</title><link>https://example.com/hello</link><pubDate>Mon, 06 Oct 2025 09:00:00 GMT</pubDate><category>news</category></item><item><title>Second post</title><link>https://example.com/second</link><description><![CDATA[<p>Some <b>bold</b> text</p>]]></description></item></channel></rss>'
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><!-- badge --><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#ec4899"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#g)"/><path d="M20 34l8 8 16-18" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/></svg>'
const POM = '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>com.example</groupId><artifactId>demo</artifactId><version>1.0.0</version><dependencies><dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>test</scope></dependency></dependencies></project>'
const BROKEN = '<?xml version="1.0"?>\n<library>\n  <book id="1">\n    <title>Clean Code</title>\n    <author>Robert Martin</author>\n  </book>\n  <book id="2">\n    <title>Refactoring</title>\n    <author>Martin Fowler</title>\n  </book>\n</library>'

export function mount(root, { params = {} } = {}) {
  const validate = params.mode === 'validate'
  const state = { mode: 'pretty', indent: '2', comments: true, selfClose: false }
  const rerun = () => s.run(true)
  const s = studio({
    inputTitle: validate ? 'XML to check' : 'XML input', outputTitle: 'Formatted XML', inputIcon: 'code-xml', outputIcon: 'sparkles', runLabel: validate ? 'Validate' : 'Format', runIcon: validate ? 'circle-check' : 'wand-sparkles',
    accept: '.xml,.svg,.rss,.atom,.xsd,.xsl,.xslt,.plist,.csproj,.kml,.gpx,.wsdl,text/xml,application/xml,text/plain',
    placeholder: 'Paste XML here, drop an .xml file, or pick an example below...',
    empty: ['code-xml', validate ? 'Paste XML to see if it is well-formed' : 'Your formatted XML shows up here'], mime: 'application/xml', outLang: 'xml',
    filename: (name) => (name ? `${baseName(name)}${state.mode === 'minify' ? '.min' : '.formatted'}.xml` : state.mode === 'minify' ? 'data.min.xml' : 'formatted.xml'),
    indent: () => indentUnit(state.indent),
    samples: [{ label: 'RSS feed', icon: 'rss', text: RSS }, { label: 'SVG icon', icon: 'shapes', text: SVG }, { label: 'Maven POM', icon: 'package', text: POM }, { label: 'Broken XML', icon: 'bug', text: BROKEN }],
    options: [
      opt('Output', seg([['pretty', 'Pretty'], ['minify', 'Minify']], 'pretty', (v) => { state.mode = v; s.view.setTitle(v === 'minify' ? 'Minified XML' : 'Formatted XML'); rerun() }, 'Output style')),
      opt('Indent', seg(INDENTS, '2', (v) => { state.indent = v; rerun() }, 'Indentation')),
      toggle('Keep comments', true, (v) => { state.comments = v; rerun() }),
      toggle('Self-close empty tags', false, (v) => { state.selfClose = v; rerun() }),
    ],
    async process(text) {
      const doc = validateXml(text)
      const out = formatXml(text, { indent: indentUnit(state.indent), minify: state.mode === 'minify', comments: state.comments, selfClose: state.selfClose })
      const st = xmlStats(doc)
      const before = new Blob([text]).size, after = new Blob([out]).size
      return {
        output: out, chip: 'Well-formed',
        verdict: { title: 'Well-formed XML', text: `Root element <${doc.documentElement.nodeName}> with ${formatNumber(st.elements)} elements, ${formatNumber(st.attributes)} attributes, ${st.depth} levels deep.` },
        stats: [
          { label: 'Output size', value: formatBytes(after), accent: true, hint: state.mode === 'minify' ? `${before > after ? 'saved' : 'added'} ${formatNumber(Math.abs(1 - after / before) * 100, 1)}%` : `${formatBytes(before)} before` },
          { label: 'Elements', value: st.elements }, { label: 'Attributes', value: st.attributes }, { label: 'Depth', value: st.depth }, { label: 'Comments', value: st.comments },
        ],
      }
    },
  })
  root.append(s.el)
  focusOnDesktop(s.ed)
}
