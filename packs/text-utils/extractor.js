// Extractor: pull emails, phone numbers, links, hashtags, numbers or text between delimiters out of any text.
// params.kind picks the tool. extract(kind, text, options) is pure and exported for tests.
import { h, stats } from '../../lib/ui.js'
import { studio, createOptions, group, chips, formatList, OUT_FORMATS, tokenCard, highlightCard, plural, copyBtn } from './_shared.js'

// ---------- shared ----------
const uniqueBy = (items, keyOf) => {
  const seen = new Set()
  return items.filter((it) => { const k = keyOf(it); if (seen.has(k)) return false; seen.add(k); return true })
}
const countBy = (arr) => {
  const m = new Map()
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
}
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
const sortItems = (items, mode, valueOf = (x) => x.value) => {
  if (mode === 'az') return [...items].sort((a, b) => collator.compare(valueOf(a), valueOf(b)))
  if (mode === 'za') return [...items].sort((a, b) => collator.compare(valueOf(b), valueOf(a)))
  return items
}

// ---------- emails ----------
const NOT_EMAIL_TLD = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'css', 'js', 'ico', 'bmp', 'mp4', 'pdf'])
const EMAIL_LOCAL = /[\p{L}\p{N}._%+-]/u
const EMAIL_DOMAIN = /[\p{L}\p{N}.-]/u
const EMAIL_OK = /^[\p{L}\p{N}_%+](?:[\p{L}\p{N}._%+-]*[\p{L}\p{N}_%+])?@(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+\p{L}{2,}$/u

/** Walk the text around every "@" instead of one big regex, so huge pasted blobs stay fast. */
function findEmails(text, o) {
  let items = []
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    let s = at
    while (s > 0 && at - s < 64 && EMAIL_LOCAL.test(text[s - 1])) s--
    while (s < at && /[.-]/.test(text[s])) s++
    let e = at + 1
    while (e < text.length && e - at < 255 && EMAIL_DOMAIN.test(text[e])) e++
    while (e > at + 1 && /[.-]/.test(text[e - 1])) e--
    const cand = text.slice(s, e)
    if (!EMAIL_OK.test(cand)) continue
    const tld = cand.split('.').pop().toLowerCase()
    if (NOT_EMAIL_TLD.has(tld)) continue
    items.push({ value: o.lower ? cand.toLowerCase() : cand, start: s, end: e, domain: cand.split('@')[1].toLowerCase() })
  }
  const f = o.domain.trim().toLowerCase().replace(/^@/, '')
  if (f) items = items.filter((it) => it.domain === f || it.domain.endsWith('.' + f) || it.domain.includes(f))
  return { items, key: (it) => it.value.toLowerCase(), groups: [['Domains', countBy(items.map((i) => i.domain))]] }
}

// ---------- phones ----------
const COUNTRIES = { 1: 'US / Canada', 7: 'Russia / Kazakhstan', 20: 'Egypt', 27: 'South Africa', 31: 'Netherlands', 33: 'France', 34: 'Spain', 39: 'Italy', 44: 'United Kingdom', 49: 'Germany', 52: 'Mexico', 55: 'Brazil', 60: 'Malaysia', 61: 'Australia', 62: 'Indonesia', 64: 'New Zealand', 65: 'Singapore', 81: 'Japan', 82: 'South Korea', 84: 'Vietnam', 86: 'China', 90: 'Turkey', 91: 'India', 92: 'Pakistan', 94: 'Sri Lanka', 353: 'Ireland', 880: 'Bangladesh', 966: 'Saudi Arabia', 971: 'UAE', 974: 'Qatar', 977: 'Nepal' }
function countryOf(digits) {
  for (const len of [3, 2, 1]) { const c = COUNTRIES[Number(digits.slice(0, len))]; if (c && String(Number(digits.slice(0, len))).length === len) return c }
  return 'Other'
}
const PHONE_RUN = /(?<![\p{L}\p{N}_])[+(]?\d(?:[\d \t().-]*\d)?(?![\p{L}\p{N}_])/gu
const STARTS_DATE = [/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?!\d)/, /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}(?!\d)/]
const DATEY = [/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/, /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/, /^\d{1,3}(\.\d{1,3}){3}$/, /^\d+\.\d+$/]

/** Classify one candidate string. Returns {type, e164, country, tidy} or null. */
export function classifyPhone(raw) {
  raw = raw.trim().replace(/^\(+(?=\+)/, '')
  if (DATEY.some((r) => r.test(raw)) || STARTS_DATE.some((r) => r.test(raw))) return null
  let digits = raw.replace(/\D/g, '')
  const hasSep = /[ \t().-]/.test(raw)
  let plus = raw.startsWith('+')
  if (!plus && digits.startsWith('00') && digits.length > 9) { digits = digits.slice(2); plus = true }
  if (digits.length < 7 || digits.length > 15) return null
  if (!plus && /^1[89]00[ .-]?\d/.test(raw) && (/^1[89]00\d{6,7}$/.test(digits) || /^1860\d{6,7}$/.test(digits))) return { type: 'India toll-free', e164: digits, country: 'India', tidy: digits.replace(/^(\d{4})(\d+)$/, '$1 $2') }
  if (!plus && /^(?:1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}$/.test(raw) && (digits.length === 10 || (digits.length === 11 && digits[0] === '1'))) {
    const n = digits.slice(-10)
    return { type: 'US / Canada', e164: `+1${n}`, country: 'US / Canada', tidy: `+1 (${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` }
  }
  const mob = (n) => /^[6-9]\d{9}$/.test(n)
  const tidyIn = (n) => `+91 ${n.slice(0, 5)} ${n.slice(5)}`
  // India mobile: 10 digits, optionally with 0, 91 or +91 in front
  if (plus || digits.startsWith('91') || digits.startsWith('0') || digits.length === 10) {
    let n = null
    if (plus && digits.startsWith('91') && digits.length === 12) n = digits.slice(2)
    else if (!plus && digits.length === 12 && digits.startsWith('91')) n = digits.slice(2)
    else if (!plus && digits.length === 11 && digits.startsWith('0')) n = digits.slice(1)
    else if (!plus && digits.length === 10) n = digits
    if (n && mob(n)) return { type: 'India mobile', e164: `+91${n}`, country: 'India', tidy: tidyIn(n) }
    if (n && /^[1-5]\d{9}$/.test(n) && (plus || digits.length === 11 || hasSep)) return { type: 'India landline', e164: `+91${n}`, country: 'India', tidy: `+91 ${n.slice(0, 2)} ${n.slice(2, 6)} ${n.slice(6)}` }
  }
  if (!plus && digits.length === 11 && digits.startsWith('0') && /^0[1-8]\d{9}$/.test(digits)) return { type: 'India landline', e164: `+91${digits.slice(1)}`, country: 'India', tidy: `+91 ${digits.slice(1, 3)} ${digits.slice(3)}` }
  if (plus) {
    if (digits.length < 8) return null
    const c = countryOf(digits)
    return { type: c === 'India' ? 'India' : 'International', e164: `+${digits}`, country: c, tidy: `+${digits}` }
  }
  if (hasSep && digits.length >= 8 && digits.length <= 13 && /^[\d(][\d ().-]*\d$/.test(raw) && (raw.match(/[ .-]/g) || []).length >= 1 && !/^\d{1,2}[-.]\d+$/.test(raw)) {
    return { type: 'Local number', e164: digits, country: 'Unknown', tidy: raw.replace(/\s+/g, ' ') }
  }
  return null
}

function findPhones(text, o) {
  const items = []
  for (const m of text.matchAll(PHONE_RUN)) {
    const base = m.index
    const run = m[0]
    // a run may hold several numbers separated by 2+ spaces or tabs
    let offset = 0
    for (const chunk of run.split(/ {2,}|\t/)) {
      const at = run.indexOf(chunk, offset)
      offset = at + chunk.length
      if (!chunk.trim()) continue
      const push = (str, from) => {
        const c = classifyPhone(str)
        if (c) items.push({ ...c, raw: str.trim(), start: base + at + from + (str.length - str.trimStart().length), end: base + at + from + str.trimEnd().length })
      }
      const digits = chunk.replace(/\D/g, '').length
      if (digits <= 15 && classifyPhone(chunk)) { push(chunk, 0); continue }
      // otherwise try to split on single spaces and grab the longest valid groups
      const toks = []
      for (const t of chunk.matchAll(/\S+/g)) toks.push({ s: t[0], i: t.index })
      let i = 0
      while (i < toks.length) {
        let took = false
        for (let j = Math.min(toks.length, i + 5); j > i; j--) {
          const str = chunk.slice(toks[i].i, toks[j - 1].i + toks[j - 1].s.length)
          if (classifyPhone(str)) { push(str, toks[i].i); i = j; took = true; break }
        }
        if (!took) i++
      }
    }
  }
  const scope = o.scope
  const list = items.filter((it) => scope === 'all' || (scope === 'india' ? it.country === 'India' : it.country !== 'India'))
  const shown = (it) => (o.format === 'e164' ? it.e164 : o.format === 'digits' ? it.e164.replace(/\D/g, '') : o.format === 'tidy' ? it.tidy : it.raw)
  return { items: list.map((it) => ({ ...it, value: shown(it) })), key: (it) => it.e164, groups: [['Where they are from', countBy(list.map((i) => i.country))], ['Types', countBy(list.map((i) => i.type))]] }
}

// ---------- URLs ----------
const URL_RE = /(?:\b(?:https?|ftp):\/\/|\bwww\.)[^\s<>"{}|\\^`]+/giu
const BARE_RE = /(?<![\p{L}\p{N}@./:-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|org|net|io|co|in|dev|app|edu|gov|info|biz|me|ai|uk|us|ca|au|de|fr|xyz|online|site|tech|store|blog|news|tv|ly|gl|shop|cloud)(?:\/[^\s<>"{}|\\^`]*)?(?![\p{L}\p{N}@-])/giu
function trimUrl(u) {
  for (;;) {
    const last = u.at(-1)
    if (/[.,;:!?'"\u{2019}\u{201d}*]/u.test(last)) u = u.slice(0, -1)
    else if (last === ')' && (u.match(/\(/g) || []).length < (u.match(/\)/g) || []).length) u = u.slice(0, -1)
    else if (last === ']' && (u.match(/\[/g) || []).length < (u.match(/\]/g) || []).length) u = u.slice(0, -1)
    else return u
  }
}
function findUrls(text, o) {
  const raw = []
  for (const m of text.matchAll(URL_RE)) raw.push({ u: trimUrl(m[0]), start: m.index })
  if (o.bare) {
    for (const m of text.matchAll(BARE_RE)) {
      if (raw.some((r) => m.index >= r.start && m.index < r.start + r.u.length)) continue
      raw.push({ u: trimUrl(m[0]), start: m.index })
    }
    raw.sort((a, b) => a.start - b.start)
  }
  const items = []
  for (const r of raw) {
    if (r.u.length < 4) continue
    let host = ''
    try { host = new URL(/^[a-z]+:\/\//i.test(r.u) ? r.u : `https://${r.u}`).hostname.replace(/^www\./, '') } catch { continue }
    let value = r.u
    if (o.show === 'domain') value = host
    else if (o.show === 'clean') value = r.u.replace(/[?#].*$/, '')
    items.push({ value, start: r.start, end: r.start + r.u.length, host })
  }
  return { items, key: (it) => it.value.toLowerCase(), groups: [['Domains', countBy(items.map((i) => i.host))]] }
}

// ---------- hashtags and mentions ----------
const TAG_RE = /(?<![\p{L}\p{M}\p{N}_&#/])#([\p{L}\p{M}\p{N}_]*\p{L}[\p{L}\p{M}\p{N}_]*)/gu
const MENTION_RE = /(?<![\p{L}\p{N}_.@/])@([A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?)/gu
function findTags(text, o) {
  const items = []
  const add = (re, sym, kind) => {
    for (const m of text.matchAll(re)) {
      const name = o.lower ? m[1].toLowerCase() : m[1]
      items.push({ value: o.keep ? sym + name : name, start: m.index, end: m.index + m[0].length, kind })
    }
  }
  if (o.tags) add(TAG_RE, '#', 'tag')
  if (o.mentions) add(MENTION_RE, '@', 'mention')
  items.sort((a, b) => a.start - b.start)
  const byKind = (k) => countBy(items.filter((i) => i.kind === k).map((i) => i.value.toLowerCase()))
  return { items, key: (it) => `${it.kind}:${it.value.toLowerCase()}`, groups: [['Top hashtags', byKind('tag')], ['Top mentions', byKind('mention')]] }
}

// ---------- numbers ----------
const NUM_DOT = /(?<![\p{L}\p{M}\p{N}_])(?<!\d\.)(?:\d{1,2}(?:,\d{2})+,\d{3}|\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/gu
const NUM_COMMA = /(?<![\p{L}\p{M}\p{N}_])(?<!\d,)(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?/gu
function findNumbers(text, o) {
  const re = o.decimal === 'comma' ? NUM_COMMA : NUM_DOT
  const items = []
  for (const m of text.matchAll(re)) {
    let s = m[0]
    let start = m.index
    s = o.decimal === 'comma' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
    if (o.negatives) {
      const prev = text[m.index - 1]
      const before = text[m.index - 2]
      if ((prev === '-' || prev === '−') && !(before && /[\p{L}\p{N}_)\]]/u.test(before))) { s = `-${s}`; start -= 1 }
    }
    items.push({ value: s, start, end: m.index + m[0].length, num: Number(s) })
  }
  return { items, key: (it) => it.value, groups: [] }
}
/** Exact decimal sum of plain number strings, returned as a string. */
export function decimalSum(values) {
  let places = 0
  for (const v of values) { const f = v.split('.')[1]; if (f && f.length > places) places = f.length }
  places = Math.min(places, 12)
  let total = 0n
  for (const v of values) {
    const neg = v.startsWith('-')
    const [i, f = ''] = v.replace('-', '').split('.')
    const n = BigInt(i + f.padEnd(places, '0').slice(0, places))
    total += neg ? -n : n
  }
  const neg = total < 0n
  let s = (neg ? -total : total).toString().padStart(places + 1, '0')
  if (places) s = `${s.slice(0, -places)}.${s.slice(-places)}`.replace(/\.?0+$/, '')
  return (neg && s !== '0' ? '-' : '') + s
}
const fmtNum = (n, style) => {
  if (!Number.isFinite(n)) return '-'
  if (style === 'plain') return String(Math.round(n * 1e10) / 1e10)
  return n.toLocaleString(style === 'in' ? 'en-IN' : 'en-US', { maximumFractionDigits: 8 })
}

// ---------- between delimiters ----------
export const PAIRS = { paren: ['(', ')'], square: ['[', ']'], curly: ['{', '}'], angle: ['<', '>'], dq: ['"', '"'], sq: ["'", "'"], curlydq: ['\u{201c}', '\u{201d}'], guil: ['\u{ab}', '\u{bb}'], bt: ['`', '`'], pipe: ['|', '|'] }
export function between(text, a, b, { nesting = 'outer', include = false, oneLine = true } = {}) {
  if (!a || !b) return []
  const out = []
  if (a === b) {
    let idx = 0
    for (;;) {
      // apostrophes inside words (it's, Bob's) are not quotes
      const apos = a === "'"
      const isWord = (ch) => !!ch && /[\p{L}\p{N}]/u.test(ch)
      let s = text.indexOf(a, idx)
      while (apos && s >= 0 && isWord(text[s - 1])) s = text.indexOf(a, s + 1)
      if (s < 0) break
      let e = text.indexOf(b, s + a.length)
      while (apos && e >= 0 && isWord(text[e + 1])) e = text.indexOf(b, e + 1)
      if (e < 0) break
      const nl = oneLine ? text.indexOf('\n', s) : -1
      if (nl >= 0 && nl < e) { idx = s + a.length; continue }
      out.push({ start: s, end: e + b.length, value: include ? text.slice(s, e + b.length) : text.slice(s + a.length, e) })
      idx = e + b.length
    }
    return out
  }
  const stack = []
  for (let i = 0; i < text.length;) {
    if (oneLine && text[i] === '\n') { stack.length = 0; i++; continue }
    if (text.startsWith(a, i)) { stack.push({ pos: i, child: false }); i += a.length; continue }
    if (text.startsWith(b, i) && stack.length) {
      const s = stack.pop()
      if (stack.length) stack[stack.length - 1].child = true
      const keep = nesting === 'all' || (nesting === 'outer' && !stack.length) || (nesting === 'inner' && !s.child)
      if (keep) out.push({ start: s.pos, end: i + b.length, value: include ? text.slice(s.pos, i + b.length) : text.slice(s.pos + a.length, i) })
      i += b.length
      continue
    }
    i++
  }
  return out.sort((x, y) => x.start - y.start)
}
function findBetween(text, o) {
  const [a, b] = o.pair === 'custom' ? [o.start, o.end] : PAIRS[o.pair]
  let items = between(text, a, b, { nesting: o.nesting, include: o.include, oneLine: !o.multiline })
  if (o.trim) items = items.map((it) => ({ ...it, value: it.value.trim() }))
  items = items.filter((it) => it.value !== '')
  return { items, key: (it) => it.value, groups: [] }
}

const FINDERS = { emails: findEmails, phones: findPhones, urls: findUrls, hashtags: findTags, numbers: findNumbers, between: findBetween }

/** Run an extractor. Returns {items (final list), found, unique, groups, list: string[]} */
export function extract(kind, text, o) {
  const r = FINDERS[kind](text, o)
  const found = r.items
  let items = o.unique ? uniqueBy(found, r.key) : found
  items = sortItems(items, o.sort)
  return { ...r, found, items, list: items.map((i) => i.value) }
}

// ---------- tool configs ----------
const CONFIG = {
  emails: {
    title: ['Text with email addresses', 'Email addresses'], file: 'emails.txt', noun: ['email', 'emails'],
    placeholder: 'Paste any text: a webpage, a document, an email thread...',
    sample: 'Contact: Asha Rao <asha.rao@example.com>, support@acme.in\nBilling questions to billing@acme.in or call +91 98765 43210.\nCC: Rahul.K@Example.com; priya_sharma+news@mail.example.co.uk\nAsha again: asha.rao@example.com\nImage: logo@2x.png is not an email.',
    defaults: { unique: true, lower: false, domain: '', sort: 'none', out: 'lines' },
  },
  phones: {
    title: ['Text with phone numbers', 'Phone numbers'], file: 'phone-numbers.txt', noun: ['number', 'numbers'],
    placeholder: 'Paste any text with phone numbers in it...',
    sample: 'Reach us on +91 98765 43210 or 098765-43211.\nMumbai office: (022) 2345 6789, Delhi: 011-4567 8901\nToll free 1800 123 4567\nUS team: +1 (415) 555-2671, UK: +44 20 7946 0958\nSame number again: 9876543210 and +91-98765-43210\nInvoice 1234567 dated 2024-01-15 for 12.50 is not a phone number.',
    defaults: { unique: true, scope: 'all', format: 'raw', sort: 'none', out: 'lines' },
  },
  urls: {
    title: ['Text with links', 'Links'], file: 'links.txt', noun: ['link', 'links'],
    placeholder: 'Paste any text, HTML source or Markdown...',
    sample: 'Docs: https://docs.example.com/guide?id=42&utm_source=news, see also www.example.org/path.\nRead more (https://en.wikipedia.org/wiki/Delhi_(disambiguation)). Mirror: http://example.net/a#top!\nVisit example.com/pricing for plans.\nSame again: https://docs.example.com/guide?id=42&utm_source=news',
    defaults: { unique: true, show: 'full', bare: false, sort: 'none', out: 'lines' },
  },
  hashtags: {
    title: ['Social posts', 'Hashtags and mentions'], file: 'hashtags-mentions.txt', noun: ['item', 'items'],
    placeholder: 'Paste posts, captions or comments...',
    sample: 'Loving the new #Nova release with @ansh_jain and @priya.s! #BI #analytics #nova\nThanks @Priya.S - great #Analytics tips. Email me@example.com (not a mention). #2024 is not a tag.\n#\u{92d}\u{93e}\u{930}\u{924} works too.',
    defaults: { tags: true, mentions: true, keep: true, lower: false, unique: true, sort: 'none', out: 'lines' },
  },
  numbers: {
    title: ['Text with numbers', 'Numbers found'], file: 'numbers.txt', noun: ['number', 'numbers'],
    placeholder: 'Paste any text: invoices, reports, receipts...',
    sample: 'Invoice #1042: 3 items at Rs 1,250.50 each = 3,751.50, plus 18% GST (675.27).\nStock: 12,34,567 units (-45 returned). Temperature fell to -3.5 degrees.\nOrder A4 has 2 boxes, code v1.2.3 is ignored.',
    defaults: { decimal: 'dot', negatives: true, unique: false, sort: 'none', out: 'lines', show: 'intl' },
  },
  between: {
    title: ['Your text', 'Text between delimiters'], file: 'extracted.txt', noun: ['match', 'matches'],
    placeholder: 'Paste any text...',
    sample: 'Call Asha (sales) or Ravi (support, EMEA). Notes: [urgent] [follow up (twice)].\nShe said "ship it on Friday" and then "hold on".',
    defaults: { pair: 'paren', start: '', end: '', nesting: 'outer', include: false, trim: true, multiline: false, unique: false, sort: 'none', out: 'lines' },
  },
}

function controlsFor(kind, o) {
  const bool = (k, label, title) => o.bool(k, label, title)
  const out = group('Output as', o.select('out', OUT_FORMATS, 'Output format'))
  const sort = group('Order', o.pills('sort', [['none', 'As found'], ['az', 'A to Z'], ['za', 'Z to A']], 'Order'))
  switch (kind) {
    case 'emails':
      return [group('Options', chips(bool('unique', 'Unique only'), bool('lower', 'Lowercase'))), group('Only from domain', o.text('domain', { placeholder: 'example.com', cls: 'mid', mono: false })), sort, out]
    case 'phones':
      return [
        group('Show', o.pills('scope', [['all', 'All numbers'], ['india', 'India'], ['intl', 'Outside India']], 'Which numbers')),
        group('Write as', o.select('format', [['raw', 'As written'], ['tidy', 'Tidy (+91 98765 43210)'], ['e164', 'International (+919876543210)'], ['digits', 'Digits only']], 'Number format')),
        group('Options', chips(bool('unique', 'Unique only', 'Different spellings of the same number count once'))), sort, out]
    case 'urls':
      return [
        group('Show', o.pills('show', [['full', 'Full link'], ['clean', 'Without ?query'], ['domain', 'Domain only']], 'What to show')),
        group('Options', chips(bool('unique', 'Unique only'), bool('bare', 'Also example.com/page', 'Find links that do not start with http or www'))), sort, out]
    case 'hashtags':
      return [group('Find', chips(bool('tags', '#hashtags'), bool('mentions', '@mentions'))), group('Options', chips(bool('keep', 'Keep # and @'), bool('lower', 'Lowercase'), bool('unique', 'Unique only'))), sort, out]
    case 'numbers':
      return [
        group('Decimal mark', o.pills('decimal', [['dot', '1,234.56'], ['comma', '1.234,56']], 'Decimal mark')),
        group('Show totals as', o.select('show', [['intl', 'International (1,234,567)'], ['in', 'Indian (12,34,567)'], ['plain', 'Plain']], 'Totals style')),
        group('Options', chips(bool('negatives', 'Negative numbers'), bool('unique', 'Unique only'))), sort, out]
    case 'between': {
      const custom = [group('Starts with', o.text('start', { placeholder: '<<', cls: 'narrow' })), group('Ends with', o.text('end', { placeholder: '>>', cls: 'narrow' }))]
      custom.forEach((g) => o.show(g, () => o.v.pair === 'custom'))
      const nest = group('Nested groups', o.select('nesting', [['outer', 'Outermost only'], ['inner', 'Innermost only'], ['all', 'Every pair']], 'Nested groups'))
      o.show(nest, () => o.v.pair !== 'custom' ? PAIRS[o.v.pair][0] !== PAIRS[o.v.pair][1] : o.v.start !== o.v.end)
      return [
        group('Between', o.select('pair', [['paren', '( )  parentheses'], ['square', '[ ]  square brackets'], ['curly', '{ }  curly braces'], ['angle', '< >  angle brackets'], ['dq', '" "  double quotes'], ['sq', "' '  single quotes"], ['curlydq', '\u{201c} \u{201d}  curly quotes'], ['guil', '\u{ab} \u{bb}  guillemets'], ['bt', '` `  backticks'], ['pipe', '| |  pipes'], ['custom', 'Custom...']], 'Delimiters')),
        ...custom, nest,
        group('Options', chips(bool('include', 'Keep the delimiters'), bool('trim', 'Trim spaces'), bool('multiline', 'Allow across lines'), bool('unique', 'Unique only'))), sort, out]
    }
    default: return []
  }
}

export function mount(root, { tool, params }) {
  const kind = params.kind
  const cfg = CONFIG[kind]
  if (!cfg) throw new Error(`Unknown extractor "${kind}"`)
  const o = createOptions(tool.id, cfg.defaults)
  const run = (text) => {
    if (!text.trim()) return { text: '', badges: [] }
    let r
    try { r = extract(kind, text, o.v) } catch (err) { return { error: err.message } }
    const total = r.found.length
    const badges = [{ label: total === 1 ? cfg.noun[0] + ' found' : cfg.noun[1] + ' found', value: total, tone: total ? 'accent' : 'warn' }]
    if (total && o.v.unique && r.items.length !== total) badges.push({ label: 'unique', value: r.items.length, tone: 'good' })
    const out = formatList(r.list, o.v.out)
    const extras = []
    if (kind === 'numbers' && r.items.length) extras.push(numberStats(r.items, o.v))
    for (const [title, g] of r.groups) { const c = tokenCard(title, g, { max: 16 }); if (c) extras.push(c) }
    const hl = highlightCard(text, r.items.length ? mergeRanges(r.found) : [])
    if (hl) extras.push(hl)
    return {
      text: out, badges,
      note: !total ? emptyNote(kind) : '',
      extra: extras.length ? h('div', { class: 'stack' }, extras) : null,
    }
  }
  const st = studio({ id: tool.id, inputTitle: cfg.title[0], outputTitle: cfg.title[1], placeholder: cfg.placeholder, sample: cfg.sample, controls: controlsFor(kind, o), run, filename: cfg.file, mono: kind !== 'between', short: true, emptyText: 'Matches show up here as you type' })
  o.onChange = () => st.refresh()
  root.append(st.el)
  st.input.focus({ preventScroll: true })
}

function mergeRanges(items) {
  const rs = items.map((i) => ({ start: i.start, end: i.end })).sort((a, b) => a.start - b.start)
  const out = []
  for (const r of rs) {
    const last = out[out.length - 1]
    if (last && r.start < last.end) last.end = Math.max(last.end, r.end)
    else out.push({ ...r })
  }
  return out
}

function emptyNote(kind) {
  return ({
    emails: 'No email addresses found.', phones: 'No phone numbers found. Plain digit runs need 10 digits (or a + sign, brackets or dashes) to count.',
    urls: 'No links found. Turn on "Also example.com/page" to catch links without http.', hashtags: 'No hashtags or mentions found.',
    numbers: 'No numbers found.', between: 'Nothing found between those delimiters. Check the pair above.',
  })[kind]
}

function numberStats(items, o) {
  const nums = items.map((i) => i.num).filter(Number.isFinite)
  const sum = decimalSum(items.map((i) => i.value))
  const sorted = [...nums].sort((a, b) => a - b)
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
  const avg = Number(sum) / nums.length
  const f = (n) => fmtNum(n, o.show)
  return h('div', { class: 'stack' },
    stats([
      { label: 'Sum', value: f(Number(sum)), accent: true, hint: sum.length > 15 ? 'Rounded for display' : undefined },
      { label: 'Average', value: f(avg) },
      { label: 'Count', value: nums.length.toLocaleString() },
      { label: 'Smallest', value: f(sorted[0]) },
      { label: 'Largest', value: f(sorted[sorted.length - 1]) },
      { label: 'Median', value: f(median) },
    ]),
    h('div', { class: 'row' }, copyBtn(() => `Sum: ${f(Number(sum))}\nAverage: ${f(avg)}\nCount: ${nums.length}\nMin: ${f(sorted[0])}\nMax: ${f(sorted[sorted.length - 1])}\nMedian: ${f(median)}`, 'Copy totals'), h('span', { class: 'tu-hint' }, plural(nums.length, 'number') + ' added with exact decimal arithmetic.')))
}
