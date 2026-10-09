// Citation formatting for APA 7, MLA 9, Chicago (author-date), Harvard (Cite Them Right) and IEEE. Pure functions, no DOM.
// A source: {type: 'book'|'article'|'website'|'video'|'report', authors: [{first, last, org}], year, month, day, title, container, publisher, city,
//            edition, volume, issue, pages, doi, url, accessed: 'YYYY-MM-DD', reportNo, platform}
// format(source, style, {index}) -> {html, text}. html only ever contains <i> for italics.

export const TYPES = [['book', 'Book'], ['article', 'Journal article'], ['website', 'Website'], ['video', 'Video'], ['report', 'Report']]
export const STYLES = [['apa', 'APA 7th'], ['mla', 'MLA 9th'], ['chicago', 'Chicago (author-date)'], ['harvard', 'Harvard'], ['ieee', 'IEEE']]

export const emptySource = (type = 'book') => ({ type, authors: [{ first: '', last: '', org: false }], year: '', month: '', day: '', title: '', container: '', publisher: '', city: '', edition: '', volume: '', issue: '', pages: '', doi: '', url: '', accessed: '', reportNo: '', platform: 'YouTube' })

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MLA_MON = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.']
const IEEE_MON = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.']

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const I = (s) => (s ? `<i>${esc(s)}</i>` : '')
const T = (s) => esc(s)
const endWith = (s, p = '.') => (!s ? '' : /[.?!]$|[.?!]<\/i>$|[.?!]["'”’]$/.test(s) ? s : s + p)
const has = (...v) => v.every((x) => x !== undefined && x !== null && String(x).trim() !== '')
const num = (v) => (Number.isFinite(+v) && String(v).trim() !== '' ? +v : NaN)
const dash = (p) => String(p).replace(/\s*[-\u2013\u2014]+\s*/g, '\u2013')
const dashPlain = (p) => String(p).replace(/\s*[-\u2013\u2014]+\s*/g, '-')

export const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]) }
/** "2" -> "2nd"; "Second edition" -> "Second"; "2nd ed." -> "2nd". */
export function editionText(e) {
  const t = String(e || '').trim().replace(/\s*(?:ed\.?|edn\.?|edition)$/i, '')
  return /^\d+$/.test(t) ? ordinal(+t) : t
}
const isFirstEdition = (e) => /^(?:1|1st|first)$/i.test(editionText(e))

export function doiUrl(doi) {
  const d = String(doi || '').trim().replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '')
  return d ? `https://doi.org/${d}` : ''
}
export const doiOnly = (doi) => doiUrl(doi).replace('https://doi.org/', '')
const link = (s) => esc(s)
const stripProto = (u) => String(u).replace(/^https?:\/\//i, '').replace(/\/$/, '')

// ---------- names ----------
const clean = (a) => ({ first: (a.first || '').trim(), last: (a.last || '').trim(), org: !!a.org })
const named = (list) => (list || []).map(clean).filter((a) => a.last || a.first)
const initials = (first, mark = '.') => first.split(/\s+/).filter(Boolean).map((p) => p.split('-').map((x) => (x[0] ? x[0].toUpperCase() + mark : '')).join('-')).join(' ')
const orgOrName = (a, fn) => (a.org ? a.last || a.first : fn(a))

const apaOne = (a) => orgOrName(a, (x) => (x.first ? `${x.last}, ${initials(x.first)}` : x.last))
const fullInv = (a) => orgOrName(a, (x) => (x.first ? `${x.last}, ${x.first}` : x.last))
const fullNorm = (a) => orgOrName(a, (x) => `${x.first} ${x.last}`.trim())
const ieeeOne = (a) => orgOrName(a, (x) => `${x.first ? initials(x.first) + ' ' : ''}${x.last}`)

function apaAuthors(l) {
  const n = l.length
  if (n === 0) return ''
  if (n === 1) return apaOne(l[0])
  if (n === 2) return `${apaOne(l[0])}, & ${apaOne(l[1])}`
  if (n <= 20) return `${l.slice(0, -1).map(apaOne).join(', ')}, & ${apaOne(l.at(-1))}`
  return `${l.slice(0, 19).map(apaOne).join(', ')}, . . . ${apaOne(l.at(-1))}`
}
function mlaAuthors(l) {
  const n = l.length
  if (n === 0) return ''
  if (n === 1) return fullInv(l[0])
  if (n === 2) return `${fullInv(l[0])}, and ${fullNorm(l[1])}`
  return `${fullInv(l[0])}, et al.`
}
function chicagoAuthors(l) {
  const n = l.length
  if (n === 0) return ''
  const list = n > 10 ? l.slice(0, 7) : l
  const parts = list.map((a, i) => (i === 0 ? fullInv(a) : fullNorm(a)))
  if (n > 10) return `${parts.join(', ')}, et al.`
  if (n === 1) return parts[0]
  if (n === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`
}
function harvardAuthors(l) {
  const n = l.length
  if (n === 0) return ''
  const one = (a) => orgOrName(a, (x) => (x.first ? `${x.last}, ${initials(x.first)}` : x.last))
  if (n >= 4) return `${one(l[0])} et al.`
  if (n === 1) return one(l[0])
  if (n === 2) return `${one(l[0])} and ${one(l[1])}`
  return `${l.slice(0, -1).map(one).join(', ')} and ${one(l.at(-1))}`
}
function ieeeAuthors(l) {
  const n = l.length
  if (n === 0) return ''
  if (n >= 7) return `${ieeeOne(l[0])} et al.`
  if (n === 1) return ieeeOne(l[0])
  if (n === 2) return `${ieeeOne(l[0])} and ${ieeeOne(l[1])}`
  return `${l.slice(0, -1).map(ieeeOne).join(', ')}, and ${ieeeOne(l.at(-1))}`
}

// ---------- dates ----------
const mNum = (m) => { const n = num(m); return n >= 1 && n <= 12 ? n : NaN }
const dNum = (d) => { const n = num(d); return n >= 1 && n <= 31 ? n : NaN }
function accessed(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '')
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null
}
const apaDate = (s) => { const y = s.year || 'n.d.'; const m = mNum(s.month), d = dNum(s.day); return !s.year ? 'n.d.' : isNaN(m) ? `${y}` : isNaN(d) ? `${y}, ${MONTHS[m - 1]}` : `${y}, ${MONTHS[m - 1]} ${d}` }
const mlaDate = (s) => { const m = mNum(s.month), d = dNum(s.day); return !s.year ? '' : isNaN(m) ? `${s.year}` : `${isNaN(d) ? '' : d + ' '}${MLA_MON[m - 1]} ${s.year}` }
const mlaAcc = (a) => (a ? `${a.d} ${MLA_MON[a.m - 1]} ${a.y}` : '')
const chiDate = (s) => { const m = mNum(s.month), d = dNum(s.day); return !s.year ? '' : isNaN(m) ? '' : `${MONTHS[m - 1]} ${isNaN(d) ? '' : d + ', '}${s.year}`.replace(' ,', ',') }
const harvAcc = (a) => (a ? `${a.d} ${MONTHS[a.m - 1]} ${a.y}` : '')
const ieeeDate = (s) => { const m = mNum(s.month); return !s.year ? '' : isNaN(m) ? `${s.year}` : `${IEEE_MON[m - 1]} ${s.year}` }
const ieeeAcc = (a) => (a ? `${IEEE_MON[a.m - 1]} ${a.d}, ${a.y}` : '')

const sameOrg = (authors, name) => authors.length === 1 && authors[0].org && name && authors[0].last.trim().toLowerCase() === name.trim().toLowerCase()

// ---------- APA ----------
function apa(s) {
  const A = named(s.authors)
  const au = apaAuthors(A)
  const date = `(${s.type === 'website' || s.type === 'video' ? apaDate(s) : s.year || 'n.d.'})`
  const url = s.doi ? doiUrl(s.doi) : s.url
  const tail = url ? ` ${link(url)}` : ''
  let title
  switch (s.type) {
    case 'article': {
      title = T(endWith(s.title))
      const loc = [I(s.container), has(s.volume) ? I(s.volume) + (has(s.issue) ? `(${T(s.issue)})` : '') : '', has(s.pages) ? T(dash(s.pages)) : ''].filter(Boolean).join(', ')
      return A.length ? `${T(endWith(au))} ${date}. ${title} ${endWith(loc)}${tail}` : `${title} ${date}. ${endWith(loc)}${tail}`
    }
    case 'book': {
      const ed = has(s.edition) && !isFirstEdition(s.edition) ? ` (${T(editionText(s.edition))} ed.)` : ''
      const pub = sameOrg(A, s.publisher) ? '' : ` ${T(endWith(s.publisher))}`
      return A.length ? `${T(endWith(au))} ${date}. ${I(s.title)}${ed}.${pub}${tail}` : `${I(s.title)}${ed}. ${date}.${pub}${tail}`
    }
    case 'website': {
      const site = sameOrg(A, s.container) ? '' : ` ${T(endWith(s.container))}`
      return A.length ? `${T(endWith(au))} ${date}. ${I(endWith(s.title))}${site}${tail}` : `${I(endWith(s.title))} ${date}.${site}${tail}`
    }
    case 'video': {
      const plat = has(s.platform) ? ` ${T(endWith(s.platform))}` : ''
      return A.length ? `${T(endWith(au))} ${date}. ${I(s.title)} [Video].${plat}${tail}` : `${I(s.title)} [Video]. ${date}.${plat}${tail}`
    }
    default: {
      const rep = has(s.reportNo) ? ` (Report No. ${T(s.reportNo)})` : ''
      const pub = has(s.publisher) && !sameOrg(A, s.publisher) ? ` ${T(endWith(s.publisher))}` : ''
      return A.length ? `${T(endWith(au))} ${date}. ${I(s.title)}${rep}.${pub}${tail}` : `${I(s.title)}${rep}. ${date}.${pub}${tail}`
    }
  }
}

// ---------- MLA ----------
function mla(s) {
  const A = named(s.authors)
  const au = mlaAuthors(A)
  const lead = A.length && !(s.type === 'website' && sameOrg(A, s.container)) ? `${T(endWith(au))} ` : ''
  const url = s.doi ? doiUrl(s.doi) : s.url
  const u = url ? `${link(s.doi || /doi.org/i.test(url) ? url : stripProto(url))}` : ''
  const acc = accessed(s.accessed)
  switch (s.type) {
    case 'article': {
      const parts = [I(s.container), has(s.volume) ? `vol. ${T(s.volume)}` : '', has(s.issue) ? `no. ${T(s.issue)}` : '', mlaDate(s), has(s.pages) ? `pp. ${T(dash(s.pages))}` : '', u].filter(Boolean)
      return `${lead}“${T(endWith(s.title))}” ${endWith(parts.join(', '))}`
    }
    case 'book': {
      const parts = [has(s.edition) && !isFirstEdition(s.edition) ? `${T(editionText(s.edition))} ed.` : '', T(s.publisher), T(s.year)].filter(Boolean)
      return `${lead}${I(endWith(s.title))} ${endWith(parts.join(', '))}${u ? ' ' + endWith(u) : ''}`
    }
    case 'website': {
      const parts = [I(s.container), has(s.publisher) && s.publisher !== s.container ? T(s.publisher) : '', mlaDate(s), u].filter(Boolean)
      return `${lead}“${T(endWith(s.title))}” ${endWith(parts.join(', '))}${acc ? ` Accessed ${mlaAcc(acc)}.` : ''}`
    }
    case 'video': {
      const up = A.length ? `uploaded by ${fullNorm(A[0])}` : ''
      const parts = [I(s.platform), T(up), mlaDate(s), u].filter(Boolean)
      return `“${T(endWith(s.title))}” ${endWith(parts.join(', '))}${acc ? ` Accessed ${mlaAcc(acc)}.` : ''}`
    }
    default: {
      const parts = [has(s.reportNo) ? T(s.reportNo) : '', T(s.publisher), T(s.year), u].filter(Boolean)
      return `${lead}${I(endWith(s.title))} ${endWith(parts.join(', '))}`
    }
  }
}

// ---------- Chicago author-date ----------
function chicago(s) {
  const A = named(s.authors)
  const au = chicagoAuthors(A)
  const y = s.year || 'n.d.'
  const url = s.doi ? doiUrl(s.doi) : s.url
  const u = url ? ` ${endWith(link(url))}` : ''
  const pub = [has(s.city) ? `${T(s.city)}: ` : '', T(s.publisher)].join('')
  const date = chiDate(s)
  // body = title and publication details; the author and year go in front, or (without an author) the title comes first
  let title, rest
  switch (s.type) {
    case 'article': {
      title = `“${T(endWith(s.title))}”`
      rest = endWith(`${I(s.container)}${has(s.volume) ? ' ' + T(s.volume) : ''}${has(s.issue) ? ` (${T(s.issue)})` : ''}${has(s.pages) ? `: ${T(dash(s.pages))}` : ''}`)
      break
    }
    case 'book': {
      title = I(endWith(s.title))
      rest = `${has(s.edition) && !isFirstEdition(s.edition) ? T(editionText(s.edition)) + ' ed. ' : ''}${endWith(pub)}`
      break
    }
    case 'website': {
      title = `“${T(endWith(s.title))}”`
      rest = `${has(s.container) ? T(endWith(s.container)) + ' ' : ''}${date ? endWith(date) : ''}`
      break
    }
    case 'video': {
      title = `“${T(endWith(s.title))}”`
      rest = `${has(s.platform) ? T(s.platform) + ' video. ' : 'Video. '}${date ? endWith(date) : ''}`
      break
    }
    default: {
      title = I(endWith(s.title))
      rest = `${has(s.reportNo) ? T(endWith(s.reportNo)) + ' ' : ''}${endWith(pub)}`
    }
  }
  return (A.length ? `${T(endWith(au))} ${T(y)}. ${title}` : `${title} ${T(y)}.`) + (rest.trim() ? ' ' + rest.trim() : '') + u
}

// ---------- Harvard (Cite Them Right) ----------
function harvard(s) {
  const A = named(s.authors)
  const au = harvardAuthors(A)
  const y = s.year || 'no date'
  const acc = accessed(s.accessed)
  const lead = A.length ? `${T(au)} (${T(y)})` : null
  const avail = (u, accNote = true) => (u ? ` Available at: ${link(u)}${acc && accNote ? ` (Accessed: ${harvAcc(acc)}).` : ''}` : '')
  const url = s.doi ? doiUrl(s.doi) : s.url
  switch (s.type) {
    case 'article': {
      const loc = [I(s.container), has(s.volume) ? `${T(s.volume)}${has(s.issue) ? `(${T(s.issue)})` : ''}` : '', has(s.pages) ? `pp. ${T(dash(s.pages))}` : ''].filter(Boolean).join(', ')
      const head = lead ? `${lead} ‘${T(s.title)}’, ${loc}.` : `‘${T(s.title)}’ (${T(y)}) ${loc}.`
      return `${head}${avail(url)}`
    }
    case 'book': {
      const ed = has(s.edition) && !isFirstEdition(s.edition) ? ` ${T(editionText(s.edition))} edn.` : ''
      const pub = [has(s.city) ? `${T(s.city)}: ` : '', T(s.publisher)].join('')
      const head = lead ? `${lead} ${I(endWith(s.title))}` : `${I(s.title)} (${T(y)})`
      return `${head}${ed} ${endWith(pub)}${avail(s.doi ? doiUrl(s.doi) : s.url)}`.replace(/\s+\./g, '.')
    }
    case 'website': {
      const head = lead ? `${lead} ${I(endWith(s.title))}` : `${I(s.title)} (${T(y)})`
      return `${head}${avail(url)}`
    }
    case 'video': {
      const head = lead ? `${lead} ${I(s.title)} [Video].` : `${I(s.title)} (${T(y)}) [Video].`
      return `${head}${has(s.platform) ? ' ' + T(endWith(s.platform)) : ''}${avail(url)}`
    }
    default: {
      const pub = [has(s.city) ? `${T(s.city)}: ` : '', T(s.publisher)].join('')
      const head = lead ? `${lead} ${I(endWith(s.title))}` : `${I(s.title)} (${T(y)})`
      return `${head} ${has(s.reportNo) ? T(endWith(s.reportNo)) + ' ' : ''}${endWith(pub)}${avail(url)}`
    }
  }
}

// ---------- IEEE ----------
function ieee(s) {
  const A = named(s.authors)
  const au = ieeeAuthors(A)
  const lead = A.length ? `${T(au)}, ` : ''
  const acc = accessed(s.accessed)
  const online = (u) => (u ? ` [Online]. Available: ${link(u)}${acc ? ` (accessed ${ieeeAcc(acc)}).` : ''}` : '')
  switch (s.type) {
    case 'article': {
      const parts = [I(s.container), has(s.volume) ? `vol. ${T(s.volume)}` : '', has(s.issue) ? `no. ${T(s.issue)}` : '', has(s.pages) ? `pp. ${T(dash(s.pages))}` : '', ieeeDate(s), s.doi ? `doi: ${T(doiOnly(s.doi))}` : ''].filter(Boolean)
      return `${lead}“${T(s.title)},” ${endWith(parts.join(', '))}${!s.doi ? online(s.url) : ''}`
    }
    case 'book': {
      const ed = has(s.edition) && !isFirstEdition(s.edition) ? `${T(editionText(s.edition))} ed. ` : ''
      const pub = [has(s.city) ? `${T(s.city)}: ` : '', T(s.publisher), s.year ? `, ${T(s.year)}` : ''].join('')
      return `${lead}${I(s.title)}, ${ed}${endWith(pub)}${online(s.doi ? doiUrl(s.doi) : s.url)}`.replace(/,\s*,/g, ',')
    }
    case 'website': {
      return `${lead}“${T(s.title)},” ${has(s.container) ? T(s.container) + (s.year ? `, ${T(s.year)}` : '') + '.' : s.year ? T(s.year) + '.' : ''}${online(s.url)}`
    }
    case 'video': {
      return `${lead}“${T(s.title)},” ${has(s.platform) ? T(s.platform) + ', ' : ''}${T(ieeeDate(s))}. [Video].${s.url ? ` Available: ${link(s.url)}${acc ? ` (accessed ${ieeeAcc(acc)}).` : ''}` : ''}`
    }
    default: {
      const parts = [T(s.publisher), has(s.city) ? T(s.city) : '', has(s.reportNo) ? `Rep. ${T(s.reportNo)}` : '', ieeeDate(s)].filter(Boolean)
      return `${lead}“${T(s.title)},” ${endWith(parts.join(', '))}${online(s.doi ? doiUrl(s.doi) : s.url)}`
    }
  }
}

const tidy = (h) => h
  .replace(/\s+/g, ' ')
  .replace(/\.\.(?!\.)/g, '.')
  .replace(/\.(<\/i>)\./g, '.$1')
  .replace(/([?!])\./g, '$1')
  .replace(/,\./g, '.')
  .replace(/ ,/g, ',')
  .replace(/,\s*,/g, ',')
  .replace(/”\s*,/g, ',”')
  .replace(/\s+\.$/g, '.')
  .trim()

const FORMATTERS = { apa, mla, chicago, harvard, ieee }

/** Strip our simple html to plain text. */
export const htmlText = (h) => h.replace(/<\/?i>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

/** Format one source. index (1-based) prefixes IEEE entries with [n]. -> {html, text} */
export function format(src, style = 'apa', { index } = {}) {
  const html0 = tidy((FORMATTERS[style] || apa)({ ...emptySource(src.type), ...src }))
  const html = style === 'ieee' && index ? `[${index}] ${html0}` : html0
  return { html, text: htmlText(html) }
}

/** Is the source complete enough to cite? -> list of missing field labels (empty when fine). */
export function missing(s) {
  const out = []
  if (!has(s.title)) out.push('title')
  if (s.type === 'article' && !has(s.container)) out.push('journal name')
  if (s.type === 'book' && !has(s.publisher)) out.push('publisher')
  if (s.type === 'website' && !has(s.url)) out.push('URL')
  if (s.type === 'video' && !has(s.url)) out.push('URL')
  return out
}

// ---------- in-text ----------
const lastNames = (s) => named(s.authors).map((a) => (a.org ? a.last || a.first : a.last))
const shortTitle = (s, n = 4) => String(s.title || '').split(/\s+/).slice(0, n).join(' ').replace(/[,:;.]+$/, '')
/** In-text citation. opts: {page, index}. -> {paren, narrative} (html) */
export function inText(src, style = 'apa', { page, index } = {}) {
  const s = { ...emptySource(src.type), ...src }
  const L = lastNames(s)
  const y = s.year || 'n.d.'
  const pg = String(page || '').trim()
  const italicTitle = s.type === 'book' || s.type === 'report' || (style !== 'mla' && style !== 'chicago' && s.type !== 'article')
  const titleRef = italicTitle ? I(shortTitle(s)) : `“${T(shortTitle(s))}”`
  if (style === 'ieee') { const t = `[${index || 1}]`; return { paren: t, narrative: `Ref. ${t}` } }
  const who = (sep, amp, etal) => (L.length === 0 ? null : L.length === 1 ? T(L[0]) : L.length === 2 ? `${T(L[0])} ${amp} ${T(L[1])}` : style === 'chicago' && L.length === 3 ? `${T(L[0])}, ${T(L[1])}, and ${T(L[2])}` : style === 'harvard' && L.length === 3 ? `${T(L[0])}, ${T(L[1])} and ${T(L[2])}` : `${T(L[0])} ${etal}`)
  switch (style) {
    case 'mla': {
      const w = who(' ', 'and', 'et al.') || titleRef
      return { paren: `(${w}${pg ? ' ' + T(pg) : ''})`, narrative: `${w}${pg ? ` (${T(pg)})` : ''}` }
    }
    case 'chicago': {
      const w = L.length > 3 ? `${T(L[0])} et al.` : who(' ', 'and', 'et al.') || titleRef
      return { paren: `(${w} ${T(y)}${pg ? ', ' + T(pg) : ''})`, narrative: `${w} (${T(y)}${pg ? ', ' + T(pg) : ''})` }
    }
    case 'harvard': {
      const w = who(' ', 'and', 'et al.') || titleRef
      return { paren: `(${w}, ${T(y === 'n.d.' ? 'no date' : y)}${pg ? `, p. ${T(pg)}` : ''})`, narrative: `${w} (${T(y === 'n.d.' ? 'no date' : y)}${pg ? `, p. ${T(pg)}` : ''})` }
    }
    default: {
      const wp = L.length === 0 ? titleRef : L.length === 1 ? T(L[0]) : L.length === 2 ? `${T(L[0])} &amp; ${T(L[1])}` : `${T(L[0])} et al.`
      const wn = L.length === 0 ? titleRef : L.length === 1 ? T(L[0]) : L.length === 2 ? `${T(L[0])} and ${T(L[1])}` : `${T(L[0])} et al.`
      return { paren: `(${wp}, ${T(y)}${pg ? `, p. ${T(pg)}` : ''})`, narrative: `${wn} (${T(y)}${pg ? `, p. ${T(pg)}` : ''})` }
    }
  }
}

/** Sort key: first author's surname (or the title), then year. */
export function sortKey(s) {
  const a = named(s.authors)[0]
  const k = (a ? (a.org ? a.last || a.first : a.last) : String(s.title || '').replace(/^(?:the|a|an)\s+/i, '')) || ''
  return `${k.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}\u0000${s.year || '9999'}\u0000${String(s.title || '').toLowerCase()}`
}
export const sortSources = (list) => [...list].sort((a, b) => (sortKey(a.src ?? a) < sortKey(b.src ?? b) ? -1 : 1))

// ---------- title case helpers ----------
const MINOR = new Set('a an and as at but by for from in into nor of on onto or over per the to up via vs with'.split(' '))
export function sentenceCase(t) {
  let first = true, afterColon = false
  return String(t).replace(/[A-Za-z][A-Za-z'’-]*/g, (w, i, all) => {
    const keep = /^[A-Z]{2,}s?$/.test(w) || /[a-z][A-Z]/.test(w) || /^[IVX]+$/.test(w)
    const up = first || afterColon
    first = false
    const before = all.slice(Math.max(0, i - 2), i)
    afterColon = false
    if (keep) return w
    return up ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()
  }).replace(/:\s+([a-z])/g, (m, c) => m.slice(0, -1) + c.toUpperCase())
}
export function titleCase(t) {
  const words = String(t).split(/(\s+)/)
  const idx = words.map((w, i) => (/\S/.test(w) ? i : -1)).filter((i) => i >= 0)
  return words.map((w, i) => {
    if (!/\S/.test(w)) return w
    const first = i === idx[0], last = i === idx.at(-1)
    const prev = words[idx[idx.indexOf(i) - 1]] || ''
    const lower = w.toLowerCase()
    if (/^[A-Z]{2,}s?$/.test(w) || /[a-z][A-Z]/.test(w)) return w
    if (!first && !last && MINOR.has(lower) && !/[:]$/.test(prev)) return lower
    return w[0].toUpperCase() + w.slice(1).toLowerCase()
  }).join('')
}

// ---------- name parsing and lookups ----------
const PARTICLES = new Set(['van', 'von', 'de', 'der', 'den', 'del', 'della', 'di', 'da', 'la', 'le', 'bin', 'al', 'ibn', 'st.'])
/** "Robert C. Martin" -> {first: 'Robert C.', last: 'Martin'}; "Martin, Robert" -> same. */
export function parseName(full) {
  const s = String(full || '').trim().replace(/\s+/g, ' ')
  if (!s) return { first: '', last: '', org: false }
  if (s.includes(',')) { const [l, ...f] = s.split(','); return { first: f.join(',').trim(), last: l.trim(), org: false } }
  const p = s.split(' ')
  if (p.length === 1) return { first: '', last: s, org: false }
  let i = p.length - 1
  while (i > 1 && PARTICLES.has(p[i - 1].toLowerCase())) i--
  return { first: p.slice(0, i).join(' '), last: p.slice(i).join(' '), org: false }
}

const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()

/** Crossref /works/<doi> "message" -> source */
export function fromCrossref(m) {
  const type = /book|monograph|reference-book|edited-book/.test(m.type || '') ? 'book' : /report/.test(m.type || '') ? 'report' : m['container-title']?.[0] ? 'article' : 'website'
  const dp = (m.issued || m['published-print'] || m['published-online'] || m.created || {})['date-parts']?.[0] || []
  const authors = (m.author || m.editor || []).map((a) => (a.name ? { first: '', last: a.name, org: true } : { first: a.given || '', last: a.family || '', org: false }))
  const s = emptySource(type)
  return Object.assign(s, {
    authors: authors.length ? authors : s.authors,
    year: dp[0] ? String(dp[0]) : '', month: type === 'article' && dp[1] ? String(dp[1]) : '', day: '',
    title: stripTags([m.title?.[0], m.subtitle?.[0]].filter(Boolean).join(': ')),
    container: stripTags(m['container-title']?.[0] || ''),
    publisher: stripTags(m.publisher || ''), volume: m.volume || '', issue: m.issue || '', pages: m.page || m['article-number'] || '',
    doi: m.DOI || '', url: type === 'article' ? '' : m.URL || '', edition: m['edition-number'] || '',
  })
}

/** Open Library edition json (+ resolved author names and place) -> source */
export function fromOpenLibrary(ed, authorNames = []) {
  const s = emptySource('book')
  const year = (String(ed.publish_date || '').match(/\b(1[5-9]\d{2}|20\d{2})\b/) || [])[1] || ''
  return Object.assign(s, {
    authors: authorNames.length ? authorNames.map(parseName) : s.authors,
    year, title: [ed.title, ed.subtitle].filter(Boolean).join(': '),
    publisher: (ed.publishers || [])[0] || '', city: ((ed.publish_places || [])[0] || '').replace(/\s*[,;].*$/, ''),
    edition: ed.edition_name || '',
  })
}

/** What kind of lookup is this text? -> {kind: 'doi'|'isbn'|'url'|'none', value} */
export function detectLookup(text) {
  const t = String(text || '').trim()
  const doi = /(10\.\d{4,9}\/[^\s"<>]+)/i.exec(t)
  if (doi) return { kind: 'doi', value: doi[1].replace(/[.,;)]+$/, '') }
  const digits = t.replace(/[\s-]/g, '')
  if (/^(?:97[89]\d{10}|\d{9}[\dXx])$/.test(digits)) return { kind: 'isbn', value: digits.toUpperCase() }
  if (/^https?:\/\//i.test(t) || /^[\w-]+(\.[\w-]+)+(\/|$)/.test(t)) return { kind: 'url', value: /^https?:\/\//i.test(t) ? t : `https://${t}` }
  return { kind: 'none', value: t }
}

/** Website guess from a URL: site name from the host. */
export function siteFromUrl(u) {
  try {
    const host = new URL(u).hostname.replace(/^www\./, '')
    const base = host.split('.').slice(-2, -1)[0] || host
    return base.charAt(0).toUpperCase() + base.slice(1)
  } catch { return '' }
}

export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export const _dashPlain = dashPlain
