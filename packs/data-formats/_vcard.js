// vCard (.vcf 2.1, 3.0, 4.0) reader and writer, plus contact <-> table presets (Google Contacts, Outlook, simple).
// DOM-free. A contact is a plain object:
//   { fn, prefix, first, middle, last, suffix, nickname, org, department, title, role, birthday, anniversary, note, uid, rev,
//     emails: [{ label, types, value }], phones: [...], urls: [{ label, value }], addresses: [{ label, types, street, extended, city, region, postal, country, pobox }],
//     categories: [], photo: { mime, base64 } | { url } | null }

const enc = new TextEncoder()
const CRLF = '\r\n'

// ---------- Decoding helpers ----------
function qpDecode(s, charset = 'utf-8') {
  const bytes = []
  const t = s.replace(/=\r?\n/g, '')
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '=' && /^[0-9a-fA-F]{2}$/.test(t.slice(i + 1, i + 3))) { bytes.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2 } else {
      const e = enc.encode(t[i]); for (const b of e) bytes.push(b)
    }
  }
  const u8 = new Uint8Array(bytes)
  const cs = String(charset || 'utf-8').toLowerCase()
  for (const c of [cs, 'utf-8', 'windows-1252']) { try { return new TextDecoder(c, { fatal: c === cs && cs === 'utf-8' }).decode(u8) } catch { /* try next */ } }
  return ''
}
const unescapeText = (s) => s.replace(/\\([nN,;\\:])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c))
/** Split on an unescaped separator (a backslash protects the next character). */
function splitUnescaped(s, sep) {
  const out = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length) { cur += c + s[i + 1]; i++ } else if (c === sep) { out.push(cur); cur = '' } else cur += c
  }
  out.push(cur)
  return out
}

/** Parse .vcf text into raw cards: [{ props: [{ group, name, params, raw, qp, charset }] }]. */
export function parseVcfRaw(text) {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n').split('\n')
  const lines = []
  for (const l of src) {
    const prev = lines.length ? lines[lines.length - 1] : null
    if (prev !== null && /^[ \t]/.test(l)) { lines[lines.length - 1] = prev + l.slice(1); continue }
    if (prev !== null && prev.endsWith('=') && /encoding=quoted-printable|;quoted-printable/i.test(prev.slice(0, Math.max(0, prev.indexOf(':')) || prev.length))) { lines[lines.length - 1] = prev.slice(0, -1) + l; continue }
    lines.push(l)
  }
  const cards = []
  let cur = null
  for (const line of lines) {
    if (!line.trim()) continue
    const up = line.trim().toUpperCase()
    if (up === 'BEGIN:VCARD') { cur = { props: [] }; continue }
    if (up === 'END:VCARD') { if (cur) cards.push(cur); cur = null; continue }
    if (!cur) continue
    // find the first colon outside quotes
    let q = false, colon = -1
    for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"') q = !q; else if (c === ':' && !q) { colon = i; break } }
    if (colon < 0) continue
    const head = line.slice(0, colon)
    const raw = line.slice(colon + 1)
    const segs = []
    q = false
    let seg = ''
    for (const c of head) { if (c === '"') { q = !q; seg += c } else if (c === ';' && !q) { segs.push(seg); seg = '' } else seg += c }
    segs.push(seg)
    const nm = segs.shift().trim()
    const dot = nm.indexOf('.')
    const group = dot > 0 ? nm.slice(0, dot) : ''
    const name = (dot > 0 ? nm.slice(dot + 1) : nm).toUpperCase()
    const params = {}
    const add = (k, v) => { (params[k] ||= []).push(...String(v).split(',').map((x) => x.replace(/^"|"$/g, '').trim()).filter(Boolean)) }
    for (const s of segs) {
      const eq = s.indexOf('=')
      if (eq > 0) add(s.slice(0, eq).trim().toUpperCase(), s.slice(eq + 1))
      else if (/^(QUOTED-PRINTABLE|BASE64|B|7BIT|8BIT)$/i.test(s.trim())) add('ENCODING', s.trim().toUpperCase())
      else if (s.trim()) add('TYPE', s.trim())
    }
    const encoding = (params.ENCODING?.[0] || '').toUpperCase()
    cur.props.push({ group, name, params, raw, qp: encoding === 'QUOTED-PRINTABLE', b64: encoding === 'BASE64' || encoding === 'B', charset: params.CHARSET?.[0] })
  }
  return cards
}
const dec = (p, s) => unescapeText(p.qp ? qpDecode(s, p.charset) : s)
const textOf = (p) => dec(p, p.raw)
const partsOf = (p) => splitUnescaped(p.raw, ';').map((x) => dec(p, x))
const listOf = (p) => splitUnescaped(p.raw, ',').map((x) => dec(p, x)).filter(Boolean)

const typesOf = (p) => (p.params.TYPE || []).map((t) => t.toLowerCase()).filter((t) => !['internet', 'voice', 'pref', 'x-inet', 'text'].includes(t))
const TYPE_LABELS = { cell: 'Mobile', mobile: 'Mobile', home: 'Home', work: 'Work', fax: 'Fax', pager: 'Pager', main: 'Main', other: 'Other', car: 'Car', isdn: 'ISDN', video: 'Video', text: 'Mobile' }
/** ['home', 'fax'] -> "Home Fax" */
export function typesToLabel(types = []) {
  const t = types.map((x) => x.toLowerCase())
  if (t.includes('fax')) return t.includes('home') ? 'Home Fax' : t.includes('work') ? 'Work Fax' : 'Fax'
  for (const k of ['cell', 'mobile', 'home', 'work', 'pager', 'main', 'car', 'isdn', 'video', 'other']) if (t.includes(k)) return TYPE_LABELS[k]
  return t[0] ? t[0][0].toUpperCase() + t[0].slice(1) : ''
}
/** "Home Fax" -> ['home', 'fax']; unknown text -> [] (the label is kept separately). */
export function labelToTypes(label = '') {
  const l = label.toLowerCase().replace(/^\*\s*/, '')
  const t = []
  if (/home/.test(l)) t.push('home')
  if (/work|business|office/.test(l)) t.push('work')
  if (/mobile|cell/.test(l)) t.push('cell')
  if (/fax/.test(l)) t.push('fax')
  if (/pager/.test(l)) t.push('pager')
  if (/main|primary/.test(l)) t.push('main')
  return t
}
const normDate = (s) => {
  const t = String(s || '').trim()
  let m = /^(\d{4})-?(\d{2})-?(\d{2})(?:T.*)?$/.exec(t)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^--(\d{2})-?(\d{2})$/.exec(t)
  return m ? `--${m[1]}-${m[2]}` : t
}

/** Parse .vcf text into contacts. */
export function parseVcf(text) {
  const raw = parseVcfRaw(text)
  return raw.map((card) => {
    const c = { fn: '', prefix: '', first: '', middle: '', last: '', suffix: '', nickname: '', org: '', department: '', title: '', role: '', birthday: '', anniversary: '', note: '', uid: '', rev: '', version: '', emails: [], phones: [], urls: [], addresses: [], categories: [], photo: null }
    const labels = {}
    for (const p of card.props) if (p.name === 'X-ABLABEL' && p.group) labels[p.group] = textOf(p).replace(/^_\$!<|>!\$_$/g, '')
    const lab = (p, types) => (p.group && labels[p.group]) || typesToLabel(types)
    for (const p of card.props) {
      switch (p.name) {
        case 'VERSION': c.version = textOf(p); break
        case 'FN': c.fn = textOf(p); break
        case 'N': { const [last = '', first = '', middle = '', prefix = '', suffix = ''] = partsOf(p); Object.assign(c, { last, first, middle, prefix, suffix }); break }
        case 'NICKNAME': c.nickname = listOf(p).join(', '); break
        case 'ORG': { const [org = '', ...rest] = partsOf(p); c.org = org; c.department = rest.filter(Boolean).join(' / '); break }
        case 'TITLE': c.title = textOf(p); break
        case 'ROLE': c.role = textOf(p); break
        case 'BDAY': c.birthday = normDate(textOf(p)); break
        case 'ANNIVERSARY': c.anniversary = normDate(textOf(p)); break
        case 'NOTE': c.note = textOf(p); break
        case 'UID': c.uid = textOf(p); break
        case 'REV': c.rev = textOf(p); break
        case 'EMAIL': { const t = typesOf(p); c.emails.push({ label: lab(p, t), types: t, value: textOf(p).replace(/^mailto:/i, '') }); break }
        case 'TEL': { const t = typesOf(p); c.phones.push({ label: lab(p, t), types: t, value: textOf(p).replace(/^tel:/i, '') }); break }
        case 'URL': { const t = typesOf(p); c.urls.push({ label: lab(p, t), value: textOf(p) }); break }
        case 'ADR': {
          const [pobox = '', extended = '', street = '', city = '', region = '', postal = '', country = ''] = partsOf(p)
          const t = typesOf(p)
          c.addresses.push({ label: lab(p, t), types: t, pobox, extended, street, city, region, postal, country })
          break
        }
        case 'CATEGORIES': c.categories.push(...listOf(p)); break
        case 'PHOTO': case 'LOGO': {
          if (p.name === 'LOGO' || c.photo) break
          const v = p.raw.trim()
          const uri = /^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/is.exec(v)
          if (uri) c.photo = { mime: uri[1], base64: uri[2].replace(/\s+/g, '') }
          else if (p.b64 || (!/^https?:|^[a-z]+:\/\//i.test(v) && /^[A-Za-z0-9+/=\s]{16,}$/.test(v))) {
            const ty = (p.params.TYPE?.[0] || p.params.MEDIATYPE?.[0] || 'jpeg').toLowerCase()
            c.photo = { mime: ty.includes('/') ? ty : `image/${ty === 'jpg' ? 'jpeg' : ty}`, base64: v.replace(/\s+/g, '') }
          } else if (v) c.photo = { url: v }
          break
        }
        default:
      }
    }
    if (!c.fn) c.fn = [c.prefix, c.first, c.middle, c.last, c.suffix].filter(Boolean).join(' ') || c.org || c.emails[0]?.value || ''
    if (!c.first && !c.last && c.fn && c.fn !== c.org) {
      const parts = c.fn.trim().split(/\s+/)
      if (parts.length > 1) { c.last = parts.pop(); c.first = parts.join(' ') } else if (c.fn !== c.org) c.first = c.fn
    }
    return c
  })
}

// ---------- Writing ----------
const esc3 = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,')
function fold(line) {
  if (enc.encode(line).length <= 75) return line
  const out = []
  let cur = '', len = 0, limit = 75
  for (const ch of line) {
    const l = enc.encode(ch).length
    if (len + l > limit) { out.push(cur); cur = ''; len = 0; limit = 74 }
    cur += ch
    len += l
  }
  out.push(cur)
  return out.join(CRLF + ' ')
}
/** Quoted-printable with soft line breaks so no line passes 76 characters. `first` is how much of the first line is already used by the property name. */
function qpEncode(s, first = 0) {
  let out = '', line = '', used = first
  const push = (t) => { if (used + t.length > 75) { out += line + '=' + CRLF; line = ''; used = 0 } line += t; used += t.length }
  for (const b of enc.encode(s)) {
    if (b === 10) push('=0A'); else if (b === 13) push('=0D'); else if (b >= 32 && b <= 126 && b !== 61) push(String.fromCharCode(b)); else push('=' + b.toString(16).toUpperCase().padStart(2, '0'))
  }
  return out + line
}
const typeTokens = (types, v) => {
  const map = { cell: 'CELL', mobile: 'CELL', home: 'HOME', work: 'WORK', fax: 'FAX', pager: 'PAGER', main: 'PREF', car: 'CAR', isdn: 'ISDN', video: 'VIDEO' }
  const t = [...new Set((types || []).map((x) => map[x.toLowerCase()]).filter(Boolean))]
  return v === '4.0' ? t.map((x) => x.toLowerCase()) : t
}
/**
 * writeVcf(contacts, { version: '3.0' | '4.0' | '2.1', photos: true }) -> string.
 */
export function writeVcf(contacts, { version = '3.0', photos = true } = {}) {
  const v21 = version === '2.1', v4 = version === '4.0'
  const cards = []
  for (const c of contacts) {
    const L = []
    // text(name, params, value): write one text property, quoted-printable in 2.1 when it is not plain ASCII
    const text = (name, value, params = []) => {
      if (value === '' || value == null) return
      const s = String(value)
      if (v21 && /[^\x20-\x7e]/.test(s)) { const head = `${[name, 'CHARSET=UTF-8', 'ENCODING=QUOTED-PRINTABLE', ...params].join(';')}:`; L.push(head + qpEncode(s, head.length)) }
      else L.push(fold(`${[name, ...params].join(';')}:${v21 ? s.replace(/\r?\n/g, ' ') : esc3(s)}`))
    }
    const structured = (name, parts, params = []) => {
      if (!parts.some(Boolean)) return
      const s = parts.map((x) => (v21 ? String(x ?? '').replace(/;/g, ',') : esc3(x))).join(';')
      if (v21 && /[^\x20-\x7e]/.test(s)) { const head = `${[name, 'CHARSET=UTF-8', 'ENCODING=QUOTED-PRINTABLE', ...params].join(';')}:`; L.push(head + qpEncode(s, head.length)) }
      else L.push(fold(`${[name, ...params].join(';')}:${s}`))
    }
    L.push('BEGIN:VCARD', `VERSION:${version}`)
    const fn = c.fn || [c.first, c.last].filter(Boolean).join(' ') || c.org || c.emails?.[0]?.value || 'Unnamed'
    structured('N', [c.last, c.first, c.middle, c.prefix, c.suffix])
    if (!(c.last || c.first || c.middle || c.prefix || c.suffix) && !v21) L.push('N:;;;;')
    text('FN', fn)
    text('NICKNAME', c.nickname)
    if (c.org || c.department) structured('ORG', [c.org, c.department])
    text('TITLE', c.title)
    text('ROLE', c.role)
    for (const e of c.emails || []) {
      const ty = typeTokens(e.types?.length ? e.types : labelToTypes(e.label), version)
      if (v21) text('EMAIL', e.value, ['INTERNET', ...ty])
      else { const all = v4 ? ty : ['INTERNET', ...ty]; text('EMAIL', e.value, all.length ? [`TYPE=${all.join(',')}`] : []) }
    }
    for (const t of c.phones || []) {
      const ty = typeTokens(t.types?.length ? t.types : labelToTypes(t.label), version)
      text('TEL', t.value, v21 ? ty : ty.length ? [`TYPE=${ty.join(',')}`] : [])
    }
    for (const a of c.addresses || []) {
      const ty = typeTokens(a.types?.length ? a.types : labelToTypes(a.label), version)
      structured('ADR', [a.pobox, a.extended, a.street, a.city, a.region, a.postal, a.country], v21 ? ty : ty.length ? [`TYPE=${ty.join(',')}`] : [])
    }
    for (const u of c.urls || []) text('URL', u.value)
    if (c.categories?.length) L.push(fold(`CATEGORIES:${c.categories.map(esc3).join(',')}`))
    if (c.birthday) text('BDAY', c.birthday)
    if (c.anniversary) text('ANNIVERSARY', c.anniversary)
    text('NOTE', c.note)
    if (c.uid) text('UID', c.uid)
    if (c.rev) text('REV', c.rev)
    if (photos && c.photo) {
      if (c.photo.base64) {
        const ty = (c.photo.mime || 'image/jpeg').replace('image/', '').toUpperCase().replace('JPG', 'JPEG')
        if (v4) L.push(fold(`PHOTO:data:${c.photo.mime || 'image/jpeg'};base64,${c.photo.base64}`))
        else if (v21) {
          // 2.1: wrapped lines of at most 76 characters, continuation lines start with a space, and a blank line ends the data
          const b64 = c.photo.base64, head = `PHOTO;ENCODING=BASE64;${ty}:`
          const parts = [head + b64.slice(0, 76 - head.length)]
          for (let i = 76 - head.length; i < b64.length; i += 75) parts.push(` ${b64.slice(i, i + 75)}`)
          L.push(parts.join(CRLF) + CRLF)
        }
        else L.push(fold(`PHOTO;ENCODING=b;TYPE=${ty}:${c.photo.base64}`))
      } else if (c.photo.url) L.push(fold(`PHOTO${v4 ? '' : v21 ? ';VALUE=URL' : ';VALUE=uri'}:${c.photo.url}`))
    }
    L.push('END:VCARD')
    cards.push(L.join(CRLF))
  }
  return cards.join(CRLF) + (cards.length ? CRLF : '')
}

// ---------- Contacts <-> tables ----------
export const CONTACT_PRESETS = [['google', 'Google Contacts'], ['outlook', 'Outlook'], ['simple', 'Simple list']]
const SEP = ' ::: '
const trim = (v) => String(v ?? '').trim()
const maxOf = (contacts, k) => Math.max(1, ...contacts.map((c) => (c[k] || []).length))
const rep = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1)).flat()
const addrFormatted = (a) => [a.street, a.extended, [a.city, a.region, a.postal].filter(Boolean).join(' '), a.country].filter(Boolean).join('\n')

/** contacts -> { headers, rows } for a preset. includePhoto writes embedded photos as data URLs (large). */
export function contactsToTable(contacts, preset = 'google', { includePhotos = false } = {}) {
  const photoCell = (c) => (c.photo?.url ? c.photo.url : includePhotos && c.photo?.base64 ? `data:${c.photo.mime};base64,${c.photo.base64}` : '')
  if (preset === 'outlook') return outlookTable(contacts, photoCell)
  if (preset === 'simple') return simpleTable(contacts, photoCell)
  const ne = maxOf(contacts, 'emails'), np = maxOf(contacts, 'phones'), na = maxOf(contacts, 'addresses'), nu = maxOf(contacts, 'urls')
  const headers = ['First Name', 'Middle Name', 'Last Name', 'Phonetic First Name', 'Phonetic Middle Name', 'Phonetic Last Name', 'Name Prefix', 'Name Suffix', 'Nickname', 'File As',
    'Organization Name', 'Organization Title', 'Organization Department', 'Birthday', 'Notes', 'Photo', 'Labels',
    ...rep(ne, (i) => [`E-mail ${i} - Label`, `E-mail ${i} - Value`]), ...rep(np, (i) => [`Phone ${i} - Label`, `Phone ${i} - Value`]),
    ...rep(na, (i) => [`Address ${i} - Label`, `Address ${i} - Formatted`, `Address ${i} - Street`, `Address ${i} - City`, `Address ${i} - PO Box`, `Address ${i} - Region`, `Address ${i} - Postal Code`, `Address ${i} - Country`, `Address ${i} - Extended Address`]),
    ...rep(nu, (i) => [`Website ${i} - Label`, `Website ${i} - Value`])]
  const rows = contacts.map((c) => [
    c.first, c.middle, c.last, '', '', '', c.prefix, c.suffix, c.nickname, c.fn, c.org, c.title, c.department, c.birthday, c.note, photoCell(c), (c.categories || []).join(SEP),
    ...rep(ne, (i) => { const e = c.emails?.[i - 1]; return [e?.label || '', e?.value || ''] }),
    ...rep(np, (i) => { const p = c.phones?.[i - 1]; return [p?.label || '', p?.value || ''] }),
    ...rep(na, (i) => { const a = c.addresses?.[i - 1]; return a ? [a.label, addrFormatted(a), a.street, a.city, a.pobox, a.region, a.postal, a.country, a.extended] : Array(9).fill('') }),
    ...rep(nu, (i) => { const u = c.urls?.[i - 1]; return [u?.label || '', u?.value || ''] }),
  ].map((x) => x ?? ''))
  return { headers, rows }
}
function outlookTable(contacts, photoCell) {
  const headers = ['Title', 'First Name', 'Middle Name', 'Last Name', 'Suffix', 'Nickname', 'Company', 'Department', 'Job Title', 'Birthday', 'Anniversary', 'Notes', 'Categories', 'Web Page',
    'E-mail Address', 'E-mail 2 Address', 'E-mail 3 Address',
    'Primary Phone', 'Home Phone', 'Home Phone 2', 'Mobile Phone', 'Business Phone', 'Business Phone 2', 'Home Fax', 'Business Fax', 'Pager', 'Other Phone',
    'Home Street', 'Home City', 'Home State', 'Home Postal Code', 'Home Country', 'Business Street', 'Business City', 'Business State', 'Business Postal Code', 'Business Country',
    'Other Street', 'Other City', 'Other State', 'Other Postal Code', 'Other Country']
  const rows = contacts.map((c) => {
    const r = Object.fromEntries(headers.map((h) => [h, '']))
    Object.assign(r, { Title: c.prefix, 'First Name': c.first, 'Middle Name': c.middle, 'Last Name': c.last, Suffix: c.suffix, Nickname: c.nickname, Company: c.org, Department: c.department, 'Job Title': c.title, Birthday: c.birthday, Anniversary: c.anniversary, Notes: c.note, Categories: (c.categories || []).join(';'), 'Web Page': c.urls?.[0]?.value || '' })
    ;(c.emails || []).slice(0, 3).forEach((e, i) => { r[i ? `E-mail ${i + 1} Address` : 'E-mail Address'] = e.value })
    for (const p of c.phones || []) {
      const t = (p.types?.length ? p.types : labelToTypes(p.label)).map((x) => x.toLowerCase())
      const order = t.includes('fax') ? (t.includes('work') ? ['Business Fax'] : ['Home Fax']) : t.includes('cell') || t.includes('mobile') ? ['Mobile Phone'] : t.includes('work') ? ['Business Phone', 'Business Phone 2'] : t.includes('home') ? ['Home Phone', 'Home Phone 2'] : t.includes('pager') ? ['Pager'] : ['Primary Phone']
      const slot = [...order, 'Other Phone', 'Primary Phone'].find((k) => !r[k])
      if (slot) r[slot] = p.value
    }
    for (const a of c.addresses || []) {
      const t = (a.types?.length ? a.types : labelToTypes(a.label)).map((x) => x.toLowerCase())
      const pre = t.includes('work') ? 'Business' : t.includes('home') ? 'Home' : 'Other'
      if (r[`${pre} Street`] || r[`${pre} City`]) continue
      Object.assign(r, { [`${pre} Street`]: [a.street, a.extended].filter(Boolean).join(', '), [`${pre} City`]: a.city, [`${pre} State`]: a.region, [`${pre} Postal Code`]: a.postal, [`${pre} Country`]: a.country })
    }
    return headers.map((h) => r[h] ?? '')
  })
  return { headers, rows }
}
function simpleTable(contacts, photoCell) {
  const ne = maxOf(contacts, 'emails'), np = maxOf(contacts, 'phones'), na = maxOf(contacts, 'addresses')
  const headers = ['Full name', 'First name', 'Middle name', 'Last name', 'Prefix', 'Suffix', 'Nickname', 'Organization', 'Department', 'Job title',
    ...rep(ne, (i) => [`Email ${i}`, `Email ${i} type`]), ...rep(np, (i) => [`Phone ${i}`, `Phone ${i} type`]),
    ...rep(na, (i) => [`Address ${i}`, `Street ${i}`, `City ${i}`, `State ${i}`, `Postal code ${i}`, `Country ${i}`, `Address ${i} type`]),
    'Website', 'Birthday', 'Anniversary', 'Notes', 'Categories', 'Photo']
  const rows = contacts.map((c) => [
    c.fn, c.first, c.middle, c.last, c.prefix, c.suffix, c.nickname, c.org, c.department, c.title,
    ...rep(ne, (i) => [c.emails?.[i - 1]?.value || '', c.emails?.[i - 1]?.label || '']),
    ...rep(np, (i) => [c.phones?.[i - 1]?.value || '', c.phones?.[i - 1]?.label || '']),
    ...rep(na, (i) => { const a = c.addresses?.[i - 1]; return a ? [addrFormatted(a).replace(/\n/g, ', '), a.street, a.city, a.region, a.postal, a.country, a.label] : Array(7).fill('') }),
    (c.urls || []).map((u) => u.value).join(' '), c.birthday, c.anniversary, c.note, (c.categories || []).join('; '), photoCell(c),
  ].map((x) => x ?? ''))
  return { headers, rows }
}

/** Which preset do these headers look like? */
export function detectContactPreset(headers) {
  const h = headers.map((x) => trim(x).toLowerCase())
  if (h.some((x) => /^(e-mail|phone|address) \d+ - /.test(x) || x === 'given name' || x === 'organization name')) return 'google'
  if (h.some((x) => x === 'e-mail address' || x === 'business phone' || x === 'mobile phone' || x === 'home street')) return 'outlook'
  return 'simple'
}

const OL_PHONES = { 'primary phone': 'Main', 'home phone': 'Home', 'home phone 2': 'Home', 'mobile phone': 'Mobile', 'business phone': 'Work', 'business phone 2': 'Work', 'home fax': 'Home Fax', 'business fax': 'Work Fax', pager: 'Pager', 'other phone': 'Other', 'company main phone': 'Main', "assistant's phone": 'Other', 'car phone': 'Car', 'mobile': 'Mobile' }
/** Read table rows (headers + rows of cells) into contacts. preset: 'auto' | 'google' | 'outlook' | 'simple'. */
export function tableToContacts(headers, rows, preset = 'auto') {
  const p = preset === 'auto' ? detectContactPreset(headers) : preset
  const hs = headers.map((x) => trim(x).toLowerCase().replace(/\s+/g, ' '))
  const out = []
  for (const row of rows) {
    const c = { fn: '', prefix: '', first: '', middle: '', last: '', suffix: '', nickname: '', org: '', department: '', title: '', role: '', birthday: '', anniversary: '', note: '', uid: '', rev: '', emails: [], phones: [], urls: [], addresses: [], categories: [], photo: null }
    const idx = { email: {}, phone: {}, url: {}, adr: {} }
    const slot = (kind, n) => (idx[kind][n || '1'] ||= {})
    hs.forEach((k, i) => {
      const v = trim(row[i])
      if (!v) return
      let m
      if (/^(first name|given name|first)$/.test(k)) c.first = v
      else if (/^(middle name|additional name|middle)$/.test(k)) c.middle = v
      else if (/^(last name|family name|surname|last)$/.test(k)) c.last = v
      else if (k === 'name prefix' || k === 'prefix' || (k === 'title' && p === 'outlook')) c.prefix = v
      else if (k === 'name suffix' || k === 'suffix') c.suffix = v
      else if (/^(nickname|short name)$/.test(k)) c.nickname = v
      else if (/^(full name|name|display name|file as|fn)$/.test(k)) { if (!c.fn || k !== 'file as') c.fn = v }
      else if (/^(organization name|organization 1 - name|company|organization|org|company name)$/.test(k)) c.org = v
      else if (/^(organization title|organization 1 - title|job title|position|title)$/.test(k)) c.title = v
      else if (/^(organization department|organization 1 - department|department)$/.test(k)) c.department = v
      else if (/^(birthday|bday|birth date|date of birth|dob)$/.test(k)) c.birthday = v.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')
      else if (k === 'anniversary') c.anniversary = v
      else if (/^(notes|note|comments|comment)$/.test(k)) c.note = v
      else if (/^(photo|picture)$/.test(k)) c.photo = /^data:/i.test(v) ? { mime: /^data:([^;,]+)/.exec(v)?.[1] || 'image/jpeg', base64: v.replace(/^[^,]*,/, '') } : { url: v }
      else if (/^(labels|group membership|categories|category|groups)$/.test(k)) c.categories.push(...v.split(/ ::: |;/).map((x) => x.replace(/^\* /, '').trim()).filter((x) => x && x !== 'myContacts'))
      else if ((m = /^e-?mail\s*(\d*)\s*-?\s*(address|value|label|type|display name)?$/.exec(k))) { if (m[2] === 'display name') return; slot('email', m[1])[/label|type/.test(m[2] || '') ? 'label' : 'value'] = v }
      else if ((m = /^(?:phone|tel|telephone)\s*(\d*)\s*-?\s*(value|label|type)?$/.exec(k))) slot('phone', m[1])[/label|type/.test(m[2] || '') ? 'label' : 'value'] = v
      else if (OL_PHONES[k] && p !== 'google') { const s = slot('phone', `ol:${k}`); s.value = v; s.label = OL_PHONES[k] }
      else if ((m = /^(?:website|web page|url|web|homepage)\s*(\d*)\s*-?\s*(value|label|type)?$/.exec(k))) slot('url', m[1])[/label|type/.test(m[2] || '') ? 'label' : 'value'] = v
      else if ((m = /^address\s*(\d*)\s*-?\s*(label|type|formatted|street|city|po box|region|state|postal code|zip|country|extended address)?$/.exec(k))) {
        const f = { label: 'label', type: 'label', formatted: 'formatted', street: 'street', city: 'city', 'po box': 'pobox', region: 'region', state: 'region', 'postal code': 'postal', zip: 'postal', country: 'country', 'extended address': 'extended' }[m[2] || 'formatted']
        slot('adr', m[1])[f] = v
      } else if ((m = /^(street|city|state|region|postal code|zip|zip code|country)\s*(\d*)$/.exec(k))) slot('adr', m[2])[{ street: 'street', city: 'city', state: 'region', region: 'region', 'postal code': 'postal', zip: 'postal', 'zip code': 'postal', country: 'country' }[m[1]]] = v
      else if ((m = /^(home|business|other) (street|street 2|city|state|postal code|country)$/.exec(k))) {
        const a = slot('adr', `ol:${m[1]}`)
        a.label = m[1] === 'business' ? 'Work' : m[1][0].toUpperCase() + m[1].slice(1)
        if (m[2] === 'street') a.street = v; else if (m[2] === 'street 2') a.extended = v; else a[{ city: 'city', state: 'region', 'postal code': 'postal', country: 'country' }[m[2]]] = v
      }
    })
    for (const e of Object.values(idx.email)) if (e.value) c.emails.push({ label: e.label || '', types: labelToTypes(e.label), value: e.value })
    for (const t of Object.values(idx.phone)) if (t.value) for (const val of t.value.split(SEP)) c.phones.push({ label: t.label || '', types: labelToTypes(t.label), value: val.trim() })
    for (const u of Object.values(idx.url)) if (u.value) for (const val of u.value.split(SEP)) c.urls.push({ label: u.label || '', value: val.trim() })
    for (const a of Object.values(idx.adr)) {
      if (!(a.street || a.city || a.region || a.postal || a.country || a.formatted || a.pobox || a.extended)) continue
      if (!a.street && !a.city && a.formatted) a.street = a.formatted.replace(/\n/g, ', ')
      c.addresses.push({ label: a.label || '', types: labelToTypes(a.label), pobox: a.pobox || '', extended: a.extended || '', street: a.street || '', city: a.city || '', region: a.region || '', postal: a.postal || '', country: a.country || '' })
    }
    if (!c.fn) c.fn = [c.prefix, c.first, c.middle, c.last, c.suffix].filter(Boolean).join(' ') || c.org || c.emails[0]?.value || ''
    if (!c.first && !c.last && c.fn && c.fn !== c.org) {
      const parts = c.fn.split(/\s+/)
      if (parts.length > 1) { c.last = parts.pop(); c.first = parts.join(' ') } else c.first = c.fn
    }
    if (c.fn || c.emails.length || c.phones.length || c.org) out.push(c)
  }
  return out
}

/** Contacts as clean JSON (embedded photos only when asked, because they are large). */
export function contactsToJson(contacts, { includePhotos = true } = {}) {
  return contacts.map((c) => {
    const o = { ...c }
    delete o.version
    if (!includePhotos && o.photo?.base64) o.photo = { mime: o.photo.mime, omitted: true }
    for (const k of Object.keys(o)) if (o[k] === '' || (Array.isArray(o[k]) && !o[k].length) || o[k] === null) delete o[k]
    return o
  })
}

export const VCARD_SAMPLE = [
  'BEGIN:VCARD', 'VERSION:3.0', 'N:Verma;Asha;;Dr.;', 'FN:Dr. Asha Verma', 'ORG:Northwind Traders;Sales', 'TITLE:Regional Manager',
  'TEL;TYPE=CELL:+91 98200 11111', 'TEL;TYPE=WORK,VOICE:+91 20 5555 0100', 'EMAIL;TYPE=INTERNET,WORK:asha@northwind.example', 'EMAIL;TYPE=INTERNET,HOME:asha.verma@example.com',
  'ADR;TYPE=WORK:;;12 Park Road;Pune;MH;411001;India', 'URL:https://northwind.example/asha', 'BDAY:1988-04-12', 'NOTE:Met at the 2024 expo.\\nPrefers email.', 'CATEGORIES:Clients,VIP', 'END:VCARD',
  'BEGIN:VCARD', 'VERSION:2.1', 'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Sj=C3=B8berg;S=C3=B8ren;;;', 'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:S=C3=B8ren Sj=C3=B8berg', 'TEL;CELL:+47 900 00 000', 'EMAIL;INTERNET:soren@example.no', 'END:VCARD', '',
].join('\r\n')
