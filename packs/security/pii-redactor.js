// PII detector and redactor: finds emails, phones, Aadhaar, PAN, GSTIN, cards, IFSC, UPI, IPs, SSN, passports and dates of birth in text, then masks them. All local.
import { h, icon, field, textarea, segmented, select, toggle, panel, button, dropzone, alert, stats, toast, formatBytes, download, debounce } from '../../lib/ui.js'
import { baseName } from '../../lib/files.js'
import { useStyles, copyBtn, load, save } from './_shared.js'

// ---------- Checksums ----------
const VD = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]]
const VP = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]]
/** Verhoeff check for a digit string (the last digit is the check digit). Used by Aadhaar. */
export function verhoeff(digits) {
  let c = 0
  ;[...digits].reverse().forEach((ch, i) => { c = VD[c][VP[i % 8][+ch]] })
  return c === 0
}
/** Luhn check for a digit string. Used by payment cards. */
export function luhn(digits) {
  let sum = 0, alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = +digits[i]
    if (alt) { n *= 2; if (n > 9) n -= 9 }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}
const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
/** GSTIN check character (mod 36). */
export function gstinCheck(g) {
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const p = B36.indexOf(g[i]) * (i % 2 ? 2 : 1)
    sum += Math.floor(p / 36) + (p % 36)
  }
  return B36[(36 - (sum % 36)) % 36] === g[14]
}
const cardBrand = (d) => (/^4/.test(d) ? 'Visa' : /^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(d) ? 'Mastercard' : /^3[47]/.test(d) ? 'American Express' : /^(6011|65|64[4-9])/.test(d) ? 'Discover' : /^(60|65|81|82|508)/.test(d) ? 'RuPay' : /^(36|38|30[0-5])/.test(d) ? 'Diners Club' : /^35/.test(d) ? 'JCB' : /^62/.test(d) ? 'UnionPay' : 'Card')

// ---------- Detectors ----------
const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const DATE_SRC = `(?:\\d{1,2}[/\\-.]\\d{1,2}[/\\-.](?:19|20)?\\d{2}|(?:19|20)\\d{2}[/\\-.]\\d{1,2}[/\\-.]\\d{1,2}|\\d{1,2}(?:st|nd|rd|th)?[ \\-]${MONTH}\\.?,?[ \\-](?:19|20)?\\d{2}|${MONTH}\\.? \\d{1,2}(?:st|nd|rd|th)?,? (?:19|20)\\d{2})`
const UPI_HANDLES = 'ok(?:hdfcbank|icici|axis|sbi)|ybl|ibl|axl|paytm|apl|upi|sbi|icici|hdfcbank|axisbank|pnb|boi|cnrb|idfcbank|idfcfirst|kotak|federal|aubank|yesbank|rbl|indus|airtel|jio|fbl|ikwik|postbank|freecharge|waicici|wahdfcbank|waaxis|wasbi|ptyes|ptaxis|pthdfc|ptsbi|abfspay|dbs|cub|kvb|barodampay|uboi|jupiteraxis|fam|yapl|axb|naviaxis|slc'

/** The detector catalogue. `re` must be global; `check(match, strict)` returns false to reject, or {weak, note}. `group` picks a capture group. */
export const TYPES = [
  { id: 'card', label: 'Payment card', tag: 'CARD', color: '#e11d48', re: /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g, sample: '4111 1111 1111 1111',
    check: (t, strict) => { const d = t.replace(/\D/g, ''); if (d.length < 13 || d.length > 19) return false; const ok = luhn(d); return ok || !strict ? { weak: !ok, note: ok ? cardBrand(d) : 'Fails the Luhn check' } : false } },
  { id: 'aadhaar', label: 'Aadhaar', tag: 'AADHAAR', color: '#ea580c', re: /(?<!\d)[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?![\d-])/g, sample: '2345 6789 0123',
    check: (t, strict) => { const d = t.replace(/\D/g, ''); const ok = verhoeff(d); return ok || !strict ? { weak: !ok, note: ok ? 'Verhoeff check passed' : 'Fails the Verhoeff check' } : false } },
  { id: 'gstin', label: 'GSTIN', tag: 'GSTIN', color: '#d97706', re: /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/gi, sample: '27AAPFU0939F1ZV',
    check: (t, strict) => { const g = t.toUpperCase(); const st = +g.slice(0, 2); if (!((st >= 1 && st <= 38) || st === 97 || st === 99)) return false; const ok = gstinCheck(g); return ok || !strict ? { weak: !ok, note: ok ? 'Check character is valid' : 'Fails the check character' } : false } },
  { id: 'pan', label: 'PAN', tag: 'PAN', color: '#ca8a04', re: /\b[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]\b/gi, sample: 'ABCPE1234F', check: () => ({}) },
  { id: 'ifsc', label: 'IFSC', tag: 'IFSC', color: '#65a30d', re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi, sample: 'HDFC0001234', check: (t) => (/\d/.test(t.slice(5)) || t === t.toUpperCase() ? {} : false) },
  { id: 'ssn', label: 'US SSN', tag: 'SSN', color: '#16a34a', re: /(?<![\d-])(?!000|666|9\d\d)\d{3}[- ](?!00)\d{2}[- ](?!0000)\d{4}(?![\d-])/g, sample: '123-45-6789', check: () => ({}) },
  { id: 'email', label: 'Email', tag: 'EMAIL', color: '#2563eb', re: /[A-Za-z0-9._%+-]+(?:'[A-Za-z0-9._%+-]+)*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, sample: 'jane.doe@example.com', check: () => ({}) },
  { id: 'upi', label: 'UPI ID', tag: 'UPI', color: '#0891b2', re: new RegExp(`(?<![\\w.-])[\\w.-]{2,}@(?:${UPI_HANDLES})\\b`, 'gi'), sample: 'jane@okhdfcbank', check: () => ({}) },
  { id: 'ipv6', label: 'IPv6', tag: 'IPV6', color: '#0d9488', re: /(?<![\w:.])[A-Fa-f0-9:]{2,39}(?![\w:])/g, sample: '2001:db8::8a2e:370:7334',
    check: (t) => { if ((t.match(/:/g) || []).length < 2 || !/[0-9a-f]/i.test(t)) return false; try { new URL(`http://[${t}]/`); return {} } catch { return false } } },
  { id: 'ipv4', label: 'IPv4', tag: 'IPV4', color: '#0891b2', re: /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d]|\.\d)/g, sample: '192.168.1.25', check: (t) => (t.split('.').every((o) => +o <= 255 && String(+o) === o) ? {} : false) },
  { id: 'passport', label: 'Passport', tag: 'PASSPORT', color: '#7c3aed', re: /(?<![A-Za-z0-9])[A-PR-WY][1-9]\d{2}\s?\d{4}[1-9](?![A-Za-z0-9])|(?<=passport(?:\s*(?:no|number|num|#)\.?)?\s*[:#-]?\s*)[A-Z0-9]{6,9}(?![A-Za-z0-9])/gi, sample: 'J8369854',
    check: (t) => (/^[A-PR-WY][1-9]\d{2}\s?\d{4}[1-9]$/i.test(t) || (/\d/.test(t) && /[A-Za-z0-9]/.test(t)) ? {} : false) },
  { id: 'dob', label: 'Date of birth', tag: 'DOB', color: '#c026d3', re: new RegExp(`(?:\\bd\\.?o\\.?b\\b\\.?|date\\s+of\\s+birth|birth\\s*date|birthday|born(?:\\s+on)?)\\s*[:\\-]?\\s*(${DATE_SRC})`, 'gi'), group: 1, sample: 'DOB: 14/03/1990', check: () => ({}) },
  { id: 'phone_in', label: 'Phone (India)', tag: 'PHONE', color: '#db2777', re: /(?<![\w+])(?:(?:\+|00)\s?91[\s-]?|91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)|(?<![\w+])0\d{2,4}[\s-](?:\d{6,8}|\d{3,4}[\s-]\d{4})(?!\d)/g, sample: '+91 98765 43210', check: () => ({}) },
  { id: 'phone_intl', label: 'Phone (international)', tag: 'PHONE', color: '#e11d48', re: /(?<![\w+])\+\d[\d\s().-]{6,18}\d(?!\d)|(?<!\d)(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?!\d)/g, sample: '+1 (415) 555-0132',
    check: (t) => { const n = t.replace(/\D/g, '').length; return n >= 8 && n <= 15 ? {} : false } },
  { id: 'date', label: 'Any date', tag: 'DATE', color: '#9333ea', re: new RegExp(`\\b${DATE_SRC}\\b`, 'gi'), sample: '2024-05-17', off: true, check: () => ({}) },
]
const PRIORITY = ['card', 'aadhaar', 'gstin', 'pan', 'ifsc', 'ssn', 'email', 'upi', 'ipv6', 'ipv4', 'passport', 'dob', 'phone_in', 'phone_intl', 'date']

/** Find PII. enabled: Set of type ids; strict: require valid check digits for cards, Aadhaar and GSTIN. Returns non-overlapping hits sorted by position. */
export function detect(text, enabled, strict = true) {
  const hits = []
  const taken = []
  const overlaps = (s, e) => taken.some(([a, b]) => s < b && e > a)
  for (const id of PRIORITY) {
    if (!enabled.has(id)) continue
    const t = TYPES.find((x) => x.id === id)
    t.re.lastIndex = 0
    const re = t.group ? new RegExp(t.re.source, t.re.flags.includes('d') ? t.re.flags : t.re.flags + 'd') : t.re
    for (const m of text.matchAll(re)) {
      let start = m.index, str = m[0]
      if (t.group) { const ix = m.indices[t.group]; if (!ix) continue; start = ix[0]; str = m[t.group] }
      const end = start + str.length
      const r = t.check(str, strict)
      if (r === false || overlaps(start, end)) continue
      taken.push([start, end])
      hits.push({ start, end, type: id, text: str, weak: !!r.weak, note: r.note || '' })
    }
  }
  return hits.sort((a, b) => a.start - b.start)
}

// ---------- Masking ----------
const alnum = /[\p{L}\p{N}]/gu
const maskAll = (s, ch) => s.replace(alnum, ch)
function keepLast(s, n, ch) {
  const total = (s.match(alnum) || []).length
  let seen = 0
  return s.replace(alnum, (c) => (++seen > total - n ? c : ch))
}
/** Partial mask that keeps just enough to recognise the value. */
export function partial(hit, ch) {
  const s = hit.text
  switch (hit.type) {
    case 'email': { const [u, d] = s.split(/@(.+)/); const i = d.lastIndexOf('.'); return `${u[0]}${ch.repeat(Math.max(2, u.length - 1))}@${d[0]}${ch.repeat(Math.max(2, i - 1))}${d.slice(i)}` }
    case 'upi': { const [u, d] = s.split(/@(.+)/); return `${u.slice(0, 2)}${ch.repeat(Math.max(2, u.length - 2))}@${d}` }
    case 'ipv4': { const p = s.split('.'); return `${p[0]}.${p[1]}.${ch}.${ch}` }
    case 'ipv6': return `${s.split(':')[0]}:${ch.repeat(4)}:...`
    case 'dob': case 'date': {
      if (/^(?:19|20)\d{2}/.test(s)) return s.slice(0, 4) + s.slice(4).replace(/\d/g, ch)
      const m = /(?:19|20)\d{2}\s*$/.exec(s)
      const k = m ? m.index : Math.max(0, s.length - 2)
      return s.slice(0, k).replace(/\d/g, ch) + s.slice(k)
    }
    default: return keepLast(s, 4, ch)
  }
}
/** Replacement for one hit. labels is a Map used to number identical values. */
export function replacement(hit, { style, ch, number, labels }) {
  const t = TYPES.find((x) => x.id === hit.type)
  if (style === 'full') return maskAll(hit.text, ch)
  if (style === 'partial') return partial(hit, ch)
  if (!number) return `[${t.tag}]`
  const key = `${t.tag}:${hit.text.toLowerCase()}`
  if (!labels.has(key)) labels.set(key, [...labels.keys()].filter((k) => k.startsWith(t.tag + ':')).length + 1)
  return `[${t.tag}_${labels.get(key)}]`
}
export function redact(text, hits, o, keep = new Set()) {
  const labels = new Map()
  let out = '', at = 0, n = 0
  for (const hit of hits) {
    out += text.slice(at, hit.start)
    if (keep.has(`${hit.type}:${hit.text}`)) out += hit.text
    else { out += replacement(hit, { ...o, labels }); n++ }
    at = hit.end
  }
  return { text: out + text.slice(at), count: n }
}

const SAMPLE = `Hi team, please onboard Priya Sharma (DOB: 14/03/1990).
Email: priya.sharma@example.com, mobile +91 98765 43210, alt 98765-43211.
Aadhaar 2345 6789 0124 (do not share), PAN ABCPE1234F, passport J8369854.
Company GSTIN 27AAPFU0939F1ZV, bank IFSC HDFC0001234, UPI priya@okhdfcbank.
Corporate card 4111 1111 1111 1111 exp 09/29. US contact: SSN 123-45-6789, phone (415) 555-0132.
Login came from 192.168.1.25 and 2001:db8::8a2e:370:7334.`

const CSS = `
.sx-pii-text{font-family:var(--mono);font-size:13.5px;line-height:1.75;white-space:pre-wrap;overflow-wrap:anywhere;padding:14px 16px;border-radius:16px;border:1px solid var(--border);background:var(--surface-2);max-height:360px;overflow:auto}
.sx-pii-hit{--tc:var(--accent);background:color-mix(in srgb,var(--tc) 18%,transparent);color:inherit;border-bottom:2px solid var(--tc);border-radius:4px;padding:1px 2px;cursor:pointer;transition:background .2s,opacity .2s}
.sx-pii-hit:hover{background:color-mix(in srgb,var(--tc) 32%,transparent)}
.sx-pii-hit.weak{border-bottom-style:dashed}
.sx-pii-hit.kept{background:transparent;border-bottom-style:dotted;opacity:.6;text-decoration:line-through;text-decoration-color:var(--muted)}
.sx-pii-types{display:flex;flex-wrap:wrap;gap:8px}
.sx-pii-types .sx-chip b{font-size:11.5px;min-width:18px;text-align:center;padding:1px 6px;border-radius:99px;background:var(--surface-3);color:var(--muted);font-variant-numeric:tabular-nums}
.sx-pii-types .sx-chip.has b{background:var(--tc);color:#fff}
.sx-pii-types .sx-chip .dot{width:9px;height:9px;border-radius:50%;background:var(--tc);flex:none}
.sx-pii-out{font-family:var(--mono);font-size:13.5px;min-height:140px}
.sx-pii-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;color:var(--muted)}
`

export function mount(root) {
  useStyles('sx-pii', CSS)
  const saved = load('pii-redactor:opts', {})
  const s = { style: 'label', ch: '*', number: true, strict: true, ...saved }
  const enabled = new Set(TYPES.filter((t) => (saved.types ? saved.types.includes(t.id) : !t.off)).map((t) => t.id))
  const keep = new Set()
  let fileName = 'redacted'

  const input = textarea({ rows: 9, mono: true, placeholder: 'Paste text here: an email, a CSV, chat logs, a letter...', 'aria-label': 'Text to scan', oninput: () => { keep.clear(); run() } })
  const out = textarea({ rows: 9, mono: true, readonly: true, class: 'sx-pii-out', placeholder: 'The redacted text appears here', 'aria-label': 'Redacted text' })
  const preview = h('div', { class: 'sx-pii-text', 'aria-label': 'Detected personal data' })
  const summary = h('div')
  const typeHost = h('div', { class: 'sx-pii-types' })
  const chipEls = new Map()
  for (const t of TYPES) {
    const count = h('b', '0')
    const el = h('label', { class: 'sx-chip', style: { '--tc': t.color }, title: `Example: ${t.sample}` },
      h('input', { type: 'checkbox', checked: enabled.has(t.id), onchange: (e) => { e.target.checked ? enabled.add(t.id) : enabled.delete(t.id); keep.clear(); run() } }), h('span', { class: 'dot' }), h('span', t.label), count)
    chipEls.set(t.id, { el, count })
    typeHost.append(el)
  }
  const style = segmented([['label', 'Label'], ['partial', 'Partial'], ['full', 'Full mask']], s.style, (v) => { s.style = v; sync(); run() }, 'Mask style')
  const chSel = select([['*', '* asterisk'], ['•', '• bullet'], ['X', 'X letter'], ['█', '█ block']], s.ch, (v) => { s.ch = v; run() })
  const chField = field('Mask character', chSel)
  const numTog = toggle('Number the labels ([EMAIL_1], [EMAIL_2])', s.number, (v) => { s.number = v; run() })
  const strictTog = toggle('Only flag cards, Aadhaar and GSTIN with valid check digits', s.strict, (v) => { s.strict = v; keep.clear(); run() })
  function sync() { chField.hidden = s.style === 'label'; numTog.hidden = s.style !== 'label' }

  let last = { text: '', hits: [] }
  const run = debounce(() => {
    save('pii-redactor:opts', { style: s.style, ch: s.ch, number: s.number, strict: s.strict, types: [...enabled] })
    const text = input.value
    const hits = detect(text, enabled, s.strict)
    last = { text, hits }
    const counts = new Map()
    for (const x of hits) counts.set(x.type, (counts.get(x.type) || 0) + 1)
    for (const [id, c] of chipEls) { c.count.textContent = counts.get(id) || 0; c.el.classList.toggle('has', counts.has(id)) }
    const r = redact(text, hits, { style: s.style, ch: s.ch, number: s.number }, keep)
    out.value = r.text
    // highlighted preview (capped so huge pastes stay fast)
    const LIMIT = 40000
    const frag = document.createDocumentFragment()
    let at = 0
    for (const x of hits) {
      if (x.start > LIMIT) break
      frag.append(text.slice(at, x.start))
      const t = TYPES.find((y) => y.id === x.type)
      const k = `${x.type}:${x.text}`
      frag.append(h('mark', { class: ['sx-pii-hit', x.weak && 'weak', keep.has(k) && 'kept'], style: { '--tc': t.color }, tabindex: 0, role: 'button', title: `${t.label}${x.note ? ' - ' + x.note : ''}. Click to ${keep.has(k) ? 'redact' : 'keep'} this value.`,
        onclick: () => { keep.has(k) ? keep.delete(k) : keep.add(k); run() }, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); keep.has(k) ? keep.delete(k) : keep.add(k); run() } } }, x.text))
      at = x.end
    }
    frag.append(text.slice(at, Math.min(text.length, LIMIT)))
    if (text.length > LIMIT) frag.append(h('div', { class: 'sx-hint', style: 'margin-top:8px' }, `Preview shows the first ${LIMIT.toLocaleString()} characters. The redacted text on the right covers everything.`))
    preview.replaceChildren(frag)
    const kinds = counts.size
    summary.replaceChildren(!text.trim() ? alert('info', 'Paste some text, or load the sample, to see what gets found.') : stats([
      { label: 'Found', value: String(hits.length), hint: hits.length ? `${kinds} type${kinds === 1 ? '' : 's'} of personal data` : 'nothing matched the selected types', accent: hits.length > 0, danger: false },
      { label: 'Redacted', value: String(r.count), hint: keep.size ? `${keep.size} value${keep.size === 1 ? '' : 's'} kept by you` : 'in the output' },
      { label: 'Characters', value: text.length.toLocaleString(), hint: 'scanned on this device' }]))
  }, 140)

  const dz = dropzone({ accept: '.txt,.csv,.tsv,.json,.md,.log,.xml,.html,.yaml,.yml,text/*', multiple: false, compact: true, icon: 'file-text', label: 'Open a text file', hint: 'TXT, CSV, JSON, MD, LOG', paste: false, onFiles: async ([f]) => {
    if (f.size > 5 * 1024 * 1024) return toast(`That file is ${formatBytes(f.size)}. Files up to 5 MB are supported.`, 'error')
    input.value = await f.text(); fileName = baseName(f.name) || 'redacted'; keep.clear(); run(); toast(`Loaded ${f.name}`, 'success')
  } })

  root.append(h('div', { class: 'sx stack' },
    panel(h('div', { class: 'stack' },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('div', { class: 'sx-k' }, icon('scan-eye'), 'Text to scan'),
        h('div', { class: 'row' }, button('Load sample', { icon: 'sparkles', size: 'sm', onClick: () => { input.value = SAMPLE; keep.clear(); run() } }), button('Clear', { icon: 'eraser', size: 'sm', variant: 'ghost', onClick: () => { input.value = ''; keep.clear(); run() } }))),
      input, dz)),
    panel(h('div', { class: 'stack' }, h('div', { class: 'sx-k' }, icon('list-checks'), 'What to look for'), typeHost,
      h('div', { class: 'sx-cols' },
        h('div', { class: 'stack tight' }, h('div', { class: 'field-label' }, 'How to hide it'), style, numTog, chField),
        h('div', { class: 'stack tight' }, strictTog, h('div', { class: 'sx-hint' }, 'Turn this off to also flag numbers that look like a card or Aadhaar but fail the checksum (typos, test data).'))))),
    summary,
    h('div', { class: 'sx-cols' },
      panel(h('div', { class: 'stack' }, h('div', { class: 'sx-k' }, icon('highlighter'), 'What was found'), preview,
        h('div', { class: 'sx-pii-legend' }, h('span', 'Click a highlight to keep that value.'), h('span', 'Dashed underline: failed its check digit.')))),
      panel(h('div', { class: 'stack' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('div', { class: 'sx-k' }, icon('shield-check'), 'Redacted text'),
        h('div', { class: 'row' }, copyBtn(() => out.value, 'Copy'), button('Download', { icon: 'download', size: 'sm', onClick: () => out.value ? download(out.value, `${fileName}-redacted.txt`, 'text/plain') : toast('Nothing to download yet', 'info') }))), out))),
    h('div', { class: 'sx-hint' }, 'Pattern matching finds common formats, not every secret: names, addresses and free-text details are not detected. Always read the result before sharing. Nothing is uploaded.')))
  sync()
  run()
}
