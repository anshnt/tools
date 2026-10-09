// HTML character references: a curated name table (the ones people actually write), an encoder and a decoder.
// Decoding is done by the browser's own HTML parser, so every one of the 2,000+ HTML5 names, numeric references and the
// legacy semicolon-less forms behave exactly as they do on a real page. Encoding to names uses the table below.

// Latin-1 names in code point order from U+00A0 (160) to U+00FF (255).
const LATIN1 = ('nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest '
  + 'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig '
  + 'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml').split(' ')
const GREEK_CAP = 'Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho'.split(' ') // U+0391..U+03A1
const GREEK_CAP2 = 'Sigma Tau Upsilon Phi Chi Psi Omega'.split(' ') // U+03A3..U+03A9
const GREEK_LOW = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau upsilon phi chi psi omega'.split(' ') // U+03B1..U+03C9
const EXTRA = ('OElig:338 oelig:339 Scaron:352 scaron:353 Yuml:376 fnof:402 circ:710 tilde:732 thetasym:977 upsih:978 piv:982 ensp:8194 emsp:8195 thinsp:8201 zwnj:8204 zwj:8205 lrm:8206 rlm:8207 '
  + 'ndash:8211 mdash:8212 lsquo:8216 rsquo:8217 sbquo:8218 ldquo:8220 rdquo:8221 bdquo:8222 dagger:8224 Dagger:8225 bull:8226 hellip:8230 permil:8240 prime:8242 Prime:8243 lsaquo:8249 rsaquo:8250 '
  + 'oline:8254 frasl:8260 euro:8364 image:8465 weierp:8472 real:8476 trade:8482 alefsym:8501 larr:8592 uarr:8593 rarr:8594 darr:8595 harr:8596 crarr:8629 lArr:8656 uArr:8657 rArr:8658 dArr:8659 hArr:8660 '
  + 'forall:8704 part:8706 exist:8707 empty:8709 nabla:8711 isin:8712 notin:8713 ni:8715 prod:8719 sum:8721 minus:8722 lowast:8727 radic:8730 prop:8733 infin:8734 ang:8736 and:8743 or:8744 cap:8745 cup:8746 '
  + 'int:8747 there4:8756 sim:8764 cong:8773 asymp:8776 ne:8800 equiv:8801 le:8804 ge:8805 sub:8834 sup:8835 nsub:8836 sube:8838 supe:8839 oplus:8853 otimes:8855 perp:8869 sdot:8901 lceil:8968 rceil:8969 '
  + 'lfloor:8970 rfloor:8971 loz:9674 spades:9824 clubs:9827 hearts:9829 diams:9830 star:9734 starf:9733 phone:9742 check:10003 cross:10007').split(' ')

/** Every named entity we can encode to: [name, code point]. */
export const ENTITIES = [
  ['quot', 34], ['amp', 38], ['lt', 60], ['gt', 62],
  ...LATIN1.map((n, i) => [n, 160 + i]),
  ...GREEK_CAP.map((n, i) => [n, 913 + i]), ...GREEK_CAP2.map((n, i) => [n, 931 + i]), ...GREEK_LOW.map((n, i) => [n, 945 + i]),
  ...EXTRA.map((e) => { const [n, c] = e.split(':'); return [n, +c] }),
]
const BY_CP = new Map(ENTITIES.map(([n, c]) => [c, n]))

const BASIC = { 38: 'amp', 60: 'lt', 62: 'gt', 34: 'quot' }
/**
 * Encode text as character references.
 * o: {scope: 'basic' (& < > " ') | 'non-ascii' (plus everything outside printable ASCII) | 'all' (every character but line breaks),
 *     format: 'named' | 'dec' | 'hex'}
 * Returns {out, count} where count is the number of references written.
 */
export function encodeEntities(text, o = {}) {
  const { scope = 'basic', format = 'named' } = o
  let out = '', count = 0
  const num = (cp) => (format === 'hex' ? `&#x${cp.toString(16).toUpperCase()};` : `&#${cp};`)
  for (const ch of text) {
    const cp = ch.codePointAt(0)
    let ref = null
    if (cp === 38 || cp === 60 || cp === 62 || cp === 34) ref = format === 'named' ? `&${BASIC[cp]};` : num(cp)
    else if (cp === 39) ref = '&#39;' // &apos; is not valid in HTML 4, the numeric form works everywhere
    else if (scope === 'non-ascii' && (cp > 126 || (cp < 32 && cp !== 9 && cp !== 10 && cp !== 13) || cp === 127)) ref = format === 'named' && BY_CP.has(cp) ? `&${BY_CP.get(cp)};` : num(cp)
    else if (scope === 'all' && cp !== 10 && cp !== 13) ref = format === 'named' && BY_CP.has(cp) ? `&${BY_CP.get(cp)};` : num(cp)
    if (ref) { out += ref; count++ } else out += ch
  }
  return { out, count }
}

const REF = /&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);?/g
let scratch
const cache = new Map()
function decodeOne(ref) {
  let v = cache.get(ref)
  if (v === undefined) {
    scratch ||= document.createElement('textarea')
    scratch.innerHTML = ref
    v = scratch.value
    if (cache.size > 5000) cache.clear()
    cache.set(ref, v)
  }
  return v
}
/**
 * Decode character references (named, decimal, hex) the way a browser does.
 * Returns {out, count, unknown: [refs that look like entities but are not known, kept as written]}.
 */
export function decodeEntities(text) {
  if (!text.includes('&')) return { out: text, count: 0, unknown: [] }
  let count = 0
  const unknown = new Set()
  const out = text.replace(REF, (m) => {
    const d = decodeOne(m)
    if (d === m) { if (m.endsWith(';')) unknown.add(m); return m }
    count++
    return d
  })
  return { out, count, unknown: [...unknown] }
}

/** Reference groups for the cheat sheet. */
export function groupOf(name, cp) {
  if (cp === 34 || cp === 38 || cp === 60 || cp === 62) return 'markup'
  if (['cent', 'pound', 'curren', 'yen', 'euro', 'fnof'].includes(name)) return 'currency'
  if ((cp >= 192 && cp <= 255 && cp !== 215 && cp !== 247) || (cp >= 338 && cp <= 376)) return 'letters'
  if (cp >= 913 && cp <= 982) return 'greek'
  if (cp >= 8592 && cp <= 8660) return 'arrows'
  if ((cp >= 8704 && cp <= 8901) || [177, 215, 247, 172, 188, 189, 190, 185, 178, 179, 176, 181].includes(cp)) return 'math'
  return 'symbols'
}
