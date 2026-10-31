// Routes this pack can convert (for the File Converter hub) and the functions the tools call. Nothing here needs the DOM.
import { ext as extOf, baseName, safeName } from '../../lib/files.js'
import { convertData, FORMATS, EXT_TO_FORMAT, DataError, decodeText, readRows, writeRows } from './_formats.js'
import { parseVcf, writeVcf, contactsToTable, tableToContacts, contactsToJson } from './_vcard.js'
import { parseIcs, writeIcs, itemsToTable, tableToItems, itemsToJson } from './_ical.js'

const MIME = { vcf: 'text/vcard', ics: 'text/calendar', json: 'application/json', csv: 'text/csv', tsv: 'text/tab-separated-values', xlsx: FORMATS.xlsx.mime }

// ---------- Contacts ----------
/** vCard <-> CSV / TSV / XLSX / JSON. Returns { outputs, warnings, info }. */
export async function convertContacts(input, from, to, o = {}, ctx = {}) {
  const warnings = []
  const warn = (m) => { if (!warnings.includes(m)) warnings.push(m) }
  let contacts
  if (from === 'vcf') {
    contacts = parseVcf(decodeText(input))
  } else if (from === 'json') {
    let v
    try { v = JSON.parse(decodeText(input)) } catch (e) { throw new DataError(`That is not valid JSON: ${e.message}`) }
    contacts = (Array.isArray(v) ? v : [v]).map((c) => ({ fn: '', prefix: '', first: '', middle: '', last: '', suffix: '', nickname: '', org: '', department: '', title: '', role: '', birthday: '', anniversary: '', note: '', uid: '', rev: '', emails: [], phones: [], urls: [], addresses: [], categories: [], photo: null, ...c }))
  } else {
    const { headers, rows } = await readRows(input, from, o)
    contacts = tableToContacts(headers, rows, 'auto')
  }
  if (!contacts.length) throw new DataError(from === 'vcf' ? 'No contacts found. A .vcf file has cards that start with BEGIN:VCARD.' : 'No contacts found. The table needs a header row with names such as First Name, Last Name, Email and Phone.')
  ctx.onProgress?.(0.5)
  const photos = contacts.filter((c) => c.photo?.base64).length
  const summary = `${contacts.length} contact${contacts.length === 1 ? '' : 's'}`
  let out
  if (to === 'vcf') out = { text: writeVcf(contacts, { version: o.version || '3.0', photos: o.photos !== false }) }
  else if (to === 'json') out = { text: JSON.stringify(contactsToJson(contacts, { includePhotos: o.photos !== false }), null, 2) + '\n' }
  else {
    out = await writeRows(contactsToTable(contacts, o.preset || 'google', { includePhotos: !!o.photos }), to, { ...o, typed: false })
    if (photos && !o.photos) warn(`${photos} embedded photo${photos === 1 ? ' is' : 's are'} not included in the table. Turn on "Include photos" to write them as data links (this makes the file big).`)
  }
  ctx.onProgress?.(1)
  return { outputs: [{ suffix: '', ...out, ext: to, mime: MIME[to] }], warnings, info: { count: contacts.length, summary } }
}

// ---------- Calendar ----------
/** iCalendar <-> CSV / TSV / XLSX / JSON. Returns { outputs, warnings, info }. */
export async function convertCalendar(input, from, to, o = {}, ctx = {}) {
  const warnings = []
  const warn = (m) => { if (!warnings.includes(m)) warnings.push(m) }
  let items, calendar = { name: '' }
  if (from === 'ics') {
    ;({ items, calendar } = parseIcs(decodeText(input)))
    if (!items.length) throw new DataError('No events found. A .ics file has events that start with BEGIN:VEVENT.')
  } else {
    const { headers, rows } = await readRows(input, from, o)
    items = tableToItems(headers, rows, o, warn)
    if (!items.length) throw new DataError('No events were found. Each row needs a title and a start date.')
  }
  ctx.onProgress?.(0.5)
  const events = items.filter((i) => i.type === 'VEVENT').length
  const todos = items.length - events
  const summary = `${events} event${events === 1 ? '' : 's'}${todos ? `, ${todos} to-do${todos === 1 ? '' : 's'}` : ''}`
  let out
  if (to === 'ics') out = { text: writeIcs(items, { calName: o.calName || calendar.name || '', tzOut: o.tzOut || 'tzid' }, warn) }
  else if (to === 'json') out = { text: JSON.stringify(itemsToJson(items), null, 2) + '\n' }
  else {
    const t = itemsToTable(items, o.preset || 'full', o, warn)
    if (!t.rows.length) throw new DataError('Nothing to write: none of the items could be placed in that layout.')
    out = await writeRows(t, to, { ...o, typed: o.preset !== 'google' && o.typedXlsx !== false })
  }
  ctx.onProgress?.(1)
  return { outputs: [{ suffix: '', ...out, ext: to, mime: MIME[to] }], warnings, info: { count: items.length, summary } }
}

// ---------- Files ----------
const toFile = (o, name) => new File([o.text ?? o.bytes], name, { type: o.mime || 'application/octet-stream' })
const bytesOf = async (file) => new Uint8Array(await file.arrayBuffer())
const nameFor = (file, o) => `${baseName(file.name) || 'file'}${o.suffix ? `-${safeName(o.suffix)}` : ''}${!o.suffix && extOf(file.name) === o.ext ? '-converted' : ''}.${o.ext}`
async function viaEngine(fn, file, from, to, opts, ctx) {
  const r = await fn(await bytesOf(file), from, to, opts, ctx)
  const files = r.outputs.map((o) => toFile(o, nameFor(file, o)))
  return files.length === 1 ? files[0] : files
}

const DATA_IN = ['json', 'jsonl', 'ndjson', 'yaml', 'yml', 'toml', 'xml', 'csv', 'tsv', 'xlsx', 'ini', 'cfg', 'properties', 'env', 'plist', 'json5', 'hjson', 'msgpack', 'mpk', 'cbor']
const DATA_OUT = ['json', 'jsonl', 'yaml', 'toml', 'xml', 'csv', 'tsv', 'xlsx', 'ini', 'properties', 'env', 'plist', 'json5', 'msgpack', 'cbor']
const indentOpt = { key: 'indent', label: 'Indent', type: 'select', choices: [[2, '2 spaces'], [4, '4 spaces'], ['tab', 'Tab'], [0, 'Minified']], default: 2 }

export const CONVERTERS = [
  {
    from: DATA_IN, to: DATA_OUT, group: 'Data formats',
    options: [
      indentOpt,
      { key: 'flatten', label: 'Nested data in tables', type: 'select', choices: [['dotted', 'Columns like address.city'], ['json', 'Keep as JSON text']], default: 'dotted' },
      { key: 'infer', label: 'Turn text like 12 and true into numbers and booleans', type: 'toggle', default: true },
      { key: 'sheet', label: 'Excel sheets', type: 'select', choices: [['first', 'First sheet'], ['all', 'All sheets']], default: 'first' },
    ],
    run: async (file, to, opts, ctx = {}) => {
      const from = EXT_TO_FORMAT[extOf(file.name)]
      if (!from) throw new Error('This file type is not one of the data formats.')
      return viaEngine(convertData, file, from, to, { ...opts, indent: opts?.indent === 'tab' ? 'tab' : Number(opts?.indent ?? 2) }, ctx)
    },
  },
  {
    from: ['vcf'], to: ['csv', 'tsv', 'xlsx', 'json'], group: 'Contacts',
    options: [
      { key: 'preset', label: 'Column layout', type: 'select', choices: [['google', 'Google Contacts'], ['outlook', 'Outlook'], ['simple', 'Simple list']], default: 'google' },
      { key: 'photos', label: 'Include photos', type: 'toggle', default: false },
    ],
    run: (file, to, opts, ctx = {}) => viaEngine(convertContacts, file, 'vcf', to, opts || {}, ctx),
  },
  {
    from: ['csv', 'tsv', 'xlsx'], to: ['vcf'], group: 'Contacts',
    options: [{ key: 'version', label: 'vCard version', type: 'select', choices: [['3.0', '3.0 (widest support)'], ['4.0', '4.0'], ['2.1', '2.1 (old phones)']], default: '3.0' }],
    run: (file, to, opts, ctx = {}) => viaEngine(convertContacts, file, extOf(file.name) === 'tsv' ? 'tsv' : extOf(file.name) === 'xlsx' ? 'xlsx' : 'csv', 'vcf', opts || {}, ctx),
  },
  {
    from: ['ics', 'ical'], to: ['csv', 'tsv', 'xlsx', 'json'], group: 'Calendar',
    options: [
      { key: 'preset', label: 'Column layout', type: 'select', choices: [['full', 'Full detail'], ['google', 'Google Calendar import']], default: 'full' },
      { key: 'tzMode', label: 'UTC times', type: 'select', choices: [['keep', 'Keep as UTC'], ['local', 'Convert to my time zone']], default: 'keep' },
    ],
    run: (file, to, opts, ctx = {}) => viaEngine(convertCalendar, file, 'ics', to, opts || {}, ctx),
  },
  {
    from: ['csv', 'tsv', 'xlsx'], to: ['ics'], group: 'Calendar',
    options: [
      { key: 'timeZone', label: 'Time zone for times without one (e.g. America/New_York)', type: 'text', default: '' },
      { key: 'dateOrder', label: 'Dates like 03/04/2024', type: 'select', choices: [['auto', 'Detect'], ['mdy', 'Month first'], ['dmy', 'Day first']], default: 'auto' },
    ],
    run: (file, to, opts, ctx = {}) => viaEngine(convertCalendar, file, extOf(file.name) === 'tsv' ? 'tsv' : extOf(file.name) === 'xlsx' ? 'xlsx' : 'csv', 'ics', opts || {}, ctx),
  },
]

const startsWith = (bytes, text) => {
  let i = 0
  while (i < 8 && (bytes[i] === 0xef || bytes[i] === 0xbb || bytes[i] === 0xbf || bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++
  for (let k = 0; k < text.length; k++) if ((bytes[i + k] | 0x20) !== (text.charCodeAt(k) | 0x20)) return false
  return true
}
export const SNIFF = [
  { ext: 'vcf', test: (b) => startsWith(b, 'BEGIN:VCARD') },
  { ext: 'ics', test: (b) => startsWith(b, 'BEGIN:VCALENDAR') },
  { ext: 'plist', test: (b) => b[0] === 0x62 && b[1] === 0x70 && b[2] === 0x6c && b[3] === 0x69 && b[4] === 0x73 && b[5] === 0x74 },
]

