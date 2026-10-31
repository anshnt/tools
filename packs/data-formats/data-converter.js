// Data converter: JSON, JSON Lines, YAML, TOML, XML, CSV, TSV, Excel, INI, .properties, .env, plist, JSON5, HJSON, MessagePack and CBOR,
// each to any other. One module serves the all-in-one tool and the focused pages (params: from, to, fixed, swappable, only).
import { h, field, select, toggle, input } from '../../lib/ui.js'
import { mountConverter, optGroup } from './_shell.js'
import { FORMATS, WRITE_FORMATS, EXT_TO_FORMAT, SAMPLES, isBinaryFormat, sniffText, formatOfName, convertData, bytesToText } from './_formats.js'

const TABLE = new Set(['csv', 'tsv', 'xlsx'])
const INDENTS = [[2, '2 spaces'], [4, '4 spaces'], ['tab', 'Tabs'], [0, 'Minified']]

const accept = (from) => {
  const keys = from === 'auto' ? Object.keys(FORMATS) : [from]
  return keys.flatMap((k) => FORMATS[k].exts.map((e) => `.${e}`)).join(',') + (from === 'auto' ? ',.txt' : '')
}
export function config(params = {}) {
  const only = params.only
  const formats = Object.entries(FORMATS).filter(([k]) => !only || only.includes(k)).map(([k, f]) => [k, f.label])
  const outFormats = WRITE_FORMATS.filter((k) => !only || only.includes(k)).map((k) => [k, FORMATS[k].label])
  const same = params.from && params.from === params.to
  return {
    formats, outFormats, from: params.from || 'auto', to: params.to || 'yaml', fixed: !!params.fixed, swappable: !!params.swappable && !same, autoFrom: !params.fixed && !params.from,
    defaults: { indent: 2, flatten: 'dotted', nest: true, infer: true, parseJson: true, empty: 'empty', header: true, records: '', delimiter: ',', bom: false, sheet: 'first', sheetName: 'Sheet1', typedXlsx: true, attrPrefix: '@', textKey: '#text', ignoreAttrs: false, rootName: 'root', yamlDocs: false, expand: true, upper: false, unicodeEscape: false, binText: 'base64', skipBad: false, sortKeys: false },
    accept,
    isBinary: isBinaryFormat,
    textBinary: (k) => k === 'msgpack' || k === 'cbor',
    sniff: sniffText,
    detectName: formatOfName,
    sniffBytes: (b) => (b[0] === 0x50 && b[1] === 0x4b ? 'xlsx' : b[0] === 0x62 && b[1] === 0x70 ? 'plist' : null),
    sample: (k) => SAMPLES[k] ?? SAMPLES.json,
    dropHint: (st) => (st.from === 'auto' ? 'JSON, YAML, TOML, XML, CSV, Excel, INI, .env, plist, MessagePack, CBOR and more' : undefined),
    display: (o, st) => (o.text !== undefined ? o.text : st.to === 'msgpack' || st.to === 'cbor' ? bytesToText(o.bytes, st.opts.binText) : ''),
    convert: async (input, from, to, opts, ctx) => {
      const r = await convertData(input, from, to, opts, ctx)
      r.info = { summary: from === to ? `Valid ${FORMATS[from].label}` : to === 'xlsx' ? 'Excel workbook ready: use Download' : '' }
      return r
    },
    options: (st, changed) => {
      const f = st.from, t = st.to, o = st.opts
      const any = f === 'auto'
      const set = (k, conv) => (v) => { o[k] = conv ? conv(v) : v; changed() }
      const tog = (k, label) => toggle(label, o[k], set(k))
      const sel = (k, label, opts2, conv) => field(label, select(opts2, o[k], set(k, conv)))
      const txt = (k, label, ph, hint) => field(label, input({ value: o[k], placeholder: ph, oninput: (e) => { o[k] = e.target.value; changed() } }), hint)
      const groups = []
      const style = []
      if (['json', 'json5', 'yaml', 'xml'].includes(t)) style.push(sel('indent', 'Indent', INDENTS, (v) => (v === 'tab' ? 'tab' : Number(v))))
      if (t === 'yaml') style.push(tog('yamlDocs', 'Write a list as separate YAML documents'))
      if (t === 'toml') style.push(tog('sortKeys', 'Sort keys A to Z'))
      if (t === 'env') style.push(tog('upper', 'UPPER_CASE keys'))
      if (t === 'properties') style.push(tog('unicodeEscape', 'Write non-ASCII as \\uXXXX'))
      if (t === 'msgpack' || t === 'cbor' || f === 'msgpack' || f === 'cbor') style.push(sel('binText', 'Show bytes as', [['base64', 'Base64'], ['hex', 'Hex']]))
      if (style.length) groups.push(optGroup('Output', ...style))
      if (TABLE.has(t)) {
        const w = [sel('flatten', 'Nested data', [['dotted', 'Columns like address.city'], ['json', 'Keep as JSON text']])]
        if (t === 'csv') w.push(sel('delimiter', 'Separator', [[',', 'Comma'], [';', 'Semicolon'], ['tab', 'Tab'], ['|', 'Pipe']]))
        if (t === 'csv' || t === 'tsv') w.push(tog('bom', 'UTF-8 byte order mark (for older Excel)'))
        if (t === 'xlsx') w.push(txt('sheetName', 'Sheet name', 'Sheet1'), tog('typedXlsx', 'Real numbers and dates in cells'))
        w.push(txt('records', 'Rows come from (optional)', 'e.g. data.items', 'Leave blank to find the list of records automatically.'))
        groups.push(optGroup('Table output', ...w))
      }
      if (any || TABLE.has(f)) {
        const r = [tog('nest', 'Rebuild nested data from headers like a.b.c'), tog('infer', 'Turn text like 12 or true into numbers and booleans'), tog('parseJson', 'Read cells holding JSON as data'), sel('empty', 'Empty cells become', [['empty', 'Empty text'], ['null', 'null'], ['omit', 'Left out']]), tog('header', 'First row has the column names')]
        if (f === 'xlsx' || any) r.push(sel('sheet', 'Excel sheets', [['first', 'First sheet'], ['all', 'All sheets']]))
        if (any) r.push(tog('expand', 'Build nested data from dotted keys in .properties files'))
        groups.push(optGroup('Table input', ...r))
      }
      if (any || f === 'xml' || t === 'xml') {
        const x = [sel('attrPrefix', 'Attribute marker', [['@', '@name'], ['_', '_name'], ['$', '$name'], ['-', '-name']]), sel('textKey', 'Text marker', [['#text', '#text'], ['_text', '_text'], ['$t', '$t'], ['value', 'value']])]
        if (any || f === 'xml') x.push(tog('ignoreAttrs', 'Ignore attributes'))
        if (f === 'xml') x.push(tog('infer', 'Turn text like 12 or true into numbers and booleans'))
        if (any || t === 'xml') x.push(txt('rootName', 'Wrapper element', 'root', 'Used when the data has no single top element.'))
        groups.push(optGroup('XML', ...x))
      }
      if (['ini', 'properties', 'env'].includes(f)) groups.push(optGroup('Settings file input', tog('infer', 'Turn text like 12 or true into numbers and booleans'), f === 'properties' ? tog('expand', 'Build nested data from dotted keys') : null))
      if (f === 'jsonl') groups.push(optGroup('JSON Lines input', tog('skipBad', 'Skip invalid lines')))
      return groups.length ? groups : null
    },
    hint: 'Runs in your browser. Your files and text are never uploaded.',
  }
}

export function mount(root, { params = {}, signal }) {
  return mountConverter(root, { signal, cfg: config(params) })
}
