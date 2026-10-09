// XML to JSON (and back): attributes, text, repeated elements as arrays, CDATA, namespaces. Uses the browser's DOMParser.
import { h, icon, clear, field, select, toggle, segmented, input, alert, button, copyButton, download, dropzone, debounce, formatBytes, toast } from '../../lib/ui.js'
import { statTiles, injectStyles } from './_view.js'

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:dc="http://purl.org/dc/elements/1.1/" updated="2025-01-15">
  <book id="bk101" available="true">
    <title>XML Developer's Guide</title>
    <dc:creator>Gambardella, Matthew</dc:creator>
    <price currency="USD">44.95</price>
    <genre>Computer</genre>
    <genre>Reference</genre>
    <description><![CDATA[An in-depth look at <b>XML</b> & its tools.]]></description>
  </book>
  <book id="bk102" available="false">
    <title>Midnight Rain</title>
    <dc:creator>Ralls, Kim</dc:creator>
    <price currency="USD">5.95</price>
    <genre>Fantasy</genre>
    <description/>
  </book>
</catalog>`
const SAMPLE_JSON = `{
  "order": {
    "@id": "A-1001",
    "@paid": true,
    "customer": { "name": "Asha Verma", "email": "asha@example.com" },
    "item": [
      { "@sku": "KB-1", "qty": 2, "price": 49.5 },
      { "@sku": "MS-9", "qty": 1, "price": 25 }
    ],
    "note": null,
    "tags": ["gift", "express"]
  }
}`

const PREFIX = { '@': '@', _: '_', $: '$', '-': '-' }

/** XML text -> JSON value. o: { attrs: '@' | '_' | '$' | 'merge' | 'ignore', textKey, alwaysArray, collapse, numbers, trim, empty: 'string' | 'null', root } */
export function xmlToJson(xml, o) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const bad = doc.querySelector('parsererror')
  if (bad) {
    const msg = (bad.textContent || '').replace(/\s+/g, ' ')
    const m = /error on line (\d+) at column (\d+): ([^.]*)/i.exec(msg) || /line (\d+)[^\d]+(\d+)[^:]*:?\s*(.*)/i.exec(msg)
    throw new Error(m ? `That XML is not valid (line ${m[1]}, column ${m[2]}): ${m[3].trim()}.` : `That XML is not valid: ${msg.slice(0, 160)}`)
  }
  const conv = (s) => {
    if (!o.numbers) return s
    if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true'
    if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(s) && s.length < 16) return Number(s)
    return s
  }
  const node = (el) => {
    const obj = {}
    let hasAttr = false
    if (o.attrs !== 'ignore') for (const a of el.attributes) { if (/^xmlns(:|$)/.test(a.name) && o.dropNs) continue; hasAttr = true; obj[(o.attrs === 'merge' ? '' : o.attrs) + a.name] = conv(a.value) }
    let text = ''
    let elems = 0
    for (const c of el.childNodes) {
      if (c.nodeType === 3 || c.nodeType === 4) text += c.nodeValue
      else if (c.nodeType === 1) {
        elems++
        const v = node(c)
        const k = c.nodeName
        if (k in obj) { if (!Array.isArray(obj[k])) obj[k] = [obj[k]]; obj[k].push(v) } else obj[k] = o.alwaysArray ? [v] : v
      }
    }
    if (o.trim) text = text.trim()
    if (!hasAttr && !elems) return text === '' ? (o.empty === 'null' ? null : '') : o.collapse ? conv(text) : { [o.textKey]: conv(text) }
    if (text !== '') obj[o.textKey] = conv(text)
    return obj
  }
  const root = doc.documentElement
  const v = node(root)
  return o.root ? { [root.nodeName]: v } : v
}

const validName = (n) => {
  let s = String(n).replace(/[^\w.\-:·À-￿]/g, '_')
  if (!/^[A-Za-z_À-￿]/.test(s)) s = `_${s}`
  return s
}
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (s) => escText(s).replace(/"/g, '&quot;').replace(/\n/g, '&#10;')

/** JSON value -> XML text. o: { attrs, textKey, rootName, useSingle, itemName, indent, declaration } */
export function jsonToXml(value, o) {
  const nl = o.indent === 'min' ? '' : '\n'
  const ind = o.indent === 'min' ? '' : o.indent === 'tab' ? '\t' : ' '.repeat(+o.indent)
  const renamed = new Set()
  const nm = (n) => { const v = validName(n); if (v !== n) renamed.add(`${n} -> ${v}`); return v }
  const pre = o.attrs === 'merge' || o.attrs === 'ignore' ? null : o.attrs
  const el = (name, val, depth) => {
    const pad = ind.repeat(depth)
    const tag = nm(name)
    if (Array.isArray(val)) return val.map((x) => el(name, x, depth)).join(nl)
    if (val === null || val === undefined) return `${pad}<${tag}/>`
    if (typeof val !== 'object') return `${pad}<${tag}>${escText(val)}</${tag}>`
    const attrs = []
    const kids = []
    let text = null
    for (const [k, v] of Object.entries(val)) {
      if (k === o.textKey) { text = v; continue }
      if (pre && k.startsWith(pre) && k.length > pre.length && (v === null || typeof v !== 'object')) { attrs.push(` ${nm(k.slice(pre.length))}="${escAttr(v ?? '')}"`); continue }
      kids.push([k, v])
    }
    const open = `${pad}<${tag}${attrs.join('')}`
    if (!kids.length && (text === null || text === '')) return `${open}/>`
    if (!kids.length) return `${open}>${escText(text)}</${tag}>`
    const inner = kids.map(([k, v]) => (Array.isArray(v) && !v.length ? '' : (Array.isArray(v) ? v.map((x) => el(k, x, depth + 1)).join(nl) : el(k, v, depth + 1)))).filter(Boolean).join(nl)
    return `${open}>${text !== null && text !== '' ? escText(text) : ''}${nl}${inner}${nl}${pad}</${tag}>`
  }
  let rootName = o.rootName || 'root'
  let body = value
  if (o.useSingle && value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1) {
    rootName = Object.keys(value)[0]; body = value[rootName]
  }
  let xml
  if (Array.isArray(body)) xml = `<${nm(rootName)}>${nl}${body.map((x) => el(o.itemName || 'item', x, 1)).join(nl)}${nl}</${nm(rootName)}>`
  else xml = el(rootName, body, 0)
  return { xml: (o.declaration ? `<?xml version="1.0" encoding="UTF-8"?>${nl || '\n'}` : '') + xml + (nl ? '\n' : ''), renamed: [...renamed] }
}

export function mount(root) {
  injectStyles()
  const o = { mode: 'x2j', attrs: '@', textKey: '#text', alwaysArray: false, collapse: true, numbers: false, trim: true, empty: 'string', root: true, indent: 2, rootName: 'root', itemName: 'item', declaration: true, useSingle: true, dropNs: false }
  const inEl = h('textarea', { class: 'textarea mono dt-xin', rows: 16, spellcheck: false, value: '', placeholder: 'Paste XML here...', 'aria-label': 'Input' })
  const output = h('pre', { class: 'dt-code dt-xout', tabindex: 0 })
  const statusHost = h('div'), statsHost = h('div'), optHost = h('div'), noteHost = h('div')
  let outText = ''
  const swap = button('Use output as input', { icon: 'arrow-left-right', variant: 'ghost', size: 'sm', onClick: () => { if (!outText) return; o.mode = o.mode === 'x2j' ? 'j2x' : 'x2j'; modeSeg.set(o.mode); inEl.value = outText; buildOpts(); run() } })
  const modeSeg = segmented([['x2j', 'XML to JSON'], ['j2x', 'JSON to XML']], o.mode, (v) => { o.mode = v; inEl.value = ''; inEl.placeholder = v === 'x2j' ? 'Paste XML here...' : 'Paste JSON here...'; buildOpts(); run() }, 'Direction')
  const T = (label, key) => toggle(label, o[key], (v) => { o[key] = v; run() })
  const indentSel = field('Indent', select([[2, '2 spaces'], [4, '4 spaces'], ['tab', 'Tab'], ['min', 'Minified']], o.indent, (v) => { o.indent = v === 'tab' || v === 'min' ? v : +v; run() }))
  function buildOpts() {
    const attrSel = field('Attributes', select(o.mode === 'x2j'
      ? [['@', '"@name" keys'], ['_', '"_name" keys'], ['$', '"$name" keys'], ['merge', 'Plain keys, merged with child elements'], ['ignore', 'Leave attributes out']]
      : [['@', 'Keys starting with @ become attributes'], ['_', 'Keys starting with _ become attributes'], ['$', 'Keys starting with $ become attributes'], ['merge', 'Treat every key as an element']], o.attrs, (v) => { o.attrs = v; run() }))
    clear(optHost, h('div', { class: 'dt-grid' }, attrSel,
      field('Text key', select([['#text', '"#text"'], ['_text', '"_text"'], ['$', '"$"'], ['text', '"text"']], o.textKey, (v) => { o.textKey = v; run() }), o.mode === 'x2j' ? 'Used when an element has both text and attributes or children.' : 'Text inside an element that also has attributes or children.'),
      ...(o.mode === 'x2j' ? [indentSel, h('div', { class: 'stack tight' }, T('Always use arrays for children', 'alwaysArray'), T('Plain value for text-only elements', 'collapse'), T('Convert numbers and true/false', 'numbers'), T('Include the root element name', 'root'), T('Trim whitespace', 'trim'))]
        : [field('Root element', input({ value: o.rootName, oninput: (e) => { o.rootName = e.target.value || 'root'; run() } }), 'Used unless the JSON has a single top-level key.'), field('Name for list items', input({ value: o.itemName, oninput: (e) => { o.itemName = e.target.value || 'item'; run() } }), 'For lists at the top level.'), indentSel, h('div', { class: 'stack tight' }, T('Use the single top-level key as root', 'useSingle'), T('Add the <?xml ?> declaration', 'declaration'))])))
  }
  function run() {
    clear(statusHost); clear(noteHost)
    const txt = inEl.value
    if (!txt.trim()) { outText = ''; output.textContent = ''; clear(statsHost); return }
    try {
      if (o.mode === 'x2j') {
        const v = xmlToJson(txt, o)
        outText = JSON.stringify(v, null, o.indent === 'tab' ? '\t' : o.indent === 'min' ? 0 : o.indent)
      } else {
        let v
        try { v = JSON.parse(txt) } catch (e) { throw new Error(`That is not valid JSON: ${String(e.message).replace(/^JSON\.parse: /, '')}`) }
        const r = jsonToXml(v, o)
        outText = r.xml
        if (r.renamed.length) clear(noteHost, alert('info', `Some names are not valid in XML and were fixed: ${r.renamed.slice(0, 5).join(', ')}${r.renamed.length > 5 ? ', ...' : ''}`))
      }
      output.textContent = outText.length > 600_000 ? `${outText.slice(0, 600_000)}\n... cut off in the preview` : outText
      clear(statsHost, statTiles([{ label: 'Input', value: formatBytes(new Blob([txt]).size) }, { label: 'Output', value: formatBytes(new Blob([outText]).size), accent: true }, { label: 'Lines', value: outText.split('\n').length }]))
    } catch (err) {
      outText = ''; output.textContent = ''; clear(statsHost); clear(statusHost, alert('error', err.message))
    }
  }
  inEl.addEventListener('input', debounce(run, 200))
  const zone = dropzone({ accept: '.xml,.json,.txt,.svg,.rss,.atom,.xhtml,text/xml,application/json', compact: true, label: 'Drop a file here, or click to choose', hint: '.xml, .json or .txt. Or type and paste below.', onFiles: async ([file]) => {
    const text = await file.text()
    const isJson = /\.json$/i.test(file.name) || /^\s*[[{]/.test(text)
    o.mode = isJson ? 'j2x' : 'x2j'; modeSeg.set(o.mode); buildOpts()
    inEl.value = text; run(); toast(`Loaded ${file.name}`, 'success')
  } })
  const example = button('Try an example', { icon: 'sparkles', variant: 'secondary', size: 'sm', onClick: () => { inEl.value = o.mode === 'x2j' ? SAMPLE_XML : SAMPLE_JSON; if (o.mode === 'j2x') o.attrs = '@'; buildOpts(); run() } })
  buildOpts()
  root.append(h('style', {}, `.dt-xin { min-height: 360px; white-space: pre; overflow: auto; font-size: 13px; } .dt-xout { min-height: 360px; max-height: 560px; white-space: pre; }
.dt-xbox { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; } @media (max-width: 900px) { .dt-xbox { grid-template-columns: minmax(0, 1fr); } }`),
  h('div', { class: 'stack' },
    h('div', { class: 'row between' }, modeSeg, h('span', { class: 'dt-priv' }, icon('shield-check'), 'Runs in your browser. Nothing is uploaded.')),
    zone,
    h('div', { class: 'panel stack' }, optHost),
    statusHost, noteHost,
    h('div', { class: 'dt-xbox' },
      h('div', { class: 'stack tight' }, h('div', { class: 'row between' }, h('b', 'Input'), example), inEl),
      h('div', { class: 'stack tight' }, h('div', { class: 'row between' }, h('b', 'Output'), h('div', { class: 'row' }, copyButton(() => outText, 'Copy'), button('Download', { icon: 'download', variant: 'primary', size: 'sm', onClick: () => { if (!outText) return toast('Nothing to download yet', 'error'); download(new Blob([outText], { type: o.mode === 'x2j' ? 'application/json' : 'application/xml' }), `converted.${o.mode === 'x2j' ? 'json' : 'xml'}`) } }), swap)), output)),
    statsHost))
}
