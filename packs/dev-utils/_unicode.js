// Unicode helpers for the character lookup tool: code points, UTF-8/16/32, escapes in many languages, HTML entities, blocks, categories and query parsing.
// Pure functions (no DOM); names come from the unicode-name package, loaded by the tool.

export const cps = (s) => Array.from(s, (c) => c.codePointAt(0))
export const hexUp = (n, w = 4) => n.toString(16).toUpperCase().padStart(w, '0')
export const label = (cp) => `U+${hexUp(cp)}`
const enc = new TextEncoder()
export const utf8 = (s) => enc.encode(s)
export const utf8Hex = (s, sep = ' ') => [...utf8(s)].map((b) => hexUp(b, 2)).join(sep)
export const percent = (s) => [...utf8(s)].map((b) => `%${hexUp(b, 2)}`).join('')
export const utf16Units = (s) => Array.from({ length: s.length }, (_, i) => s.charCodeAt(i))
export const utf16Hex = (s, sep = ' ') => utf16Units(s).map((u) => hexUp(u, 4)).join(sep)
export const utf32Hex = (s, sep = ' ') => cps(s).map((c) => hexUp(c, 8)).join(sep)
export function graphemes(s) {
  try { return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((x) => x.segment) } catch { return Array.from(s) }
}

// ---------- categories and scripts ----------
export const GC = { Lu: 'Uppercase letter', Ll: 'Lowercase letter', Lt: 'Titlecase letter', Lm: 'Modifier letter', Lo: 'Other letter', Mn: 'Nonspacing mark', Mc: 'Spacing mark', Me: 'Enclosing mark', Nd: 'Decimal digit', Nl: 'Letter number', No: 'Other number',
  Pc: 'Connector punctuation', Pd: 'Dash punctuation', Ps: 'Open punctuation', Pe: 'Close punctuation', Pi: 'Initial quote', Pf: 'Final quote', Po: 'Other punctuation', Sm: 'Math symbol', Sc: 'Currency symbol', Sk: 'Modifier symbol', So: 'Other symbol',
  Zs: 'Space separator', Zl: 'Line separator', Zp: 'Paragraph separator', Cc: 'Control', Cf: 'Format', Cs: 'Surrogate', Co: 'Private use', Cn: 'Unassigned' }
const gcRe = Object.keys(GC).map((k) => [k, new RegExp(`^\\p{${k}}$`, 'u')])
export const categoryOf = (cp) => {
  if (cp >= 0xd800 && cp <= 0xdfff) return 'Cs'
  const ch = String.fromCodePoint(cp)
  return gcRe.find(([, re]) => re.test(ch))?.[0] || 'Cn'
}
const SCRIPTS = 'Latin Greek Cyrillic Armenian Hebrew Arabic Syriac Thaana Devanagari Bengali Gurmukhi Gujarati Oriya Tamil Telugu Kannada Malayalam Sinhala Thai Lao Tibetan Myanmar Georgian Hangul Ethiopic Cherokee Canadian_Aboriginal Ogham Runic Khmer Mongolian Hiragana Katakana Bopomofo Han Yi Braille Coptic Gothic Glagolitic Tifinagh Nko Adlam Anatolian_Hieroglyphs Avestan Balinese Bamum Batak Brahmi Buginese Buhid Carian Chakma Cham Cuneiform Cypriot Deseret Egyptian_Hieroglyphs Hanunoo Imperial_Aramaic Javanese Kaithi Kayah_Li Kharoshthi Lepcha Limbu Linear_A Linear_B Lisu Lycian Lydian Mandaic Meetei_Mayek Miao Ol_Chiki Old_Italic Old_Persian Old_Turkic Osmanya Phags_Pa Phoenician Rejang Samaritan Saurashtra Shavian Sundanese Syloti_Nagri Tagalog Tagbanwa Tai_Le Tai_Tham Tai_Viet Ugaritic Vai Common Inherited'.split(' ')
let scriptRe = null
export function scriptOf(cp) {
  if (cp >= 0xd800 && cp <= 0xdfff) return null
  scriptRe ||= SCRIPTS.map((s) => { try { return [s, new RegExp(`^\\p{Script=${s}}$`, 'u')] } catch { return null } }).filter(Boolean)
  const ch = String.fromCodePoint(cp)
  const hit = scriptRe.find(([, re]) => re.test(ch))
  return hit ? hit[0].replace(/_/g, ' ') : null
}

// ---------- HTML named entities (the common ones) ----------
const ENT = 'amp:38 lt:60 gt:62 quot:34 apos:39 nbsp:160 iexcl:161 cent:162 pound:163 curren:164 yen:165 brvbar:166 sect:167 uml:168 copy:169 ordf:170 laquo:171 not:172 shy:173 reg:174 macr:175 deg:176 plusmn:177 sup2:178 sup3:179 acute:180 micro:181 para:182 middot:183 cedil:184 sup1:185 ordm:186 raquo:187 frac14:188 frac12:189 frac34:190 iquest:191 Agrave:192 Aacute:193 Acirc:194 Atilde:195 Auml:196 Aring:197 AElig:198 Ccedil:199 Egrave:200 Eacute:201 Ecirc:202 Euml:203 Igrave:204 Iacute:205 Icirc:206 Iuml:207 ETH:208 Ntilde:209 Ograve:210 Oacute:211 Ocirc:212 Otilde:213 Ouml:214 times:215 Oslash:216 Ugrave:217 Uacute:218 Ucirc:219 Uuml:220 Yacute:221 THORN:222 szlig:223 agrave:224 aacute:225 acirc:226 atilde:227 auml:228 aring:229 aelig:230 ccedil:231 egrave:232 eacute:233 ecirc:234 euml:235 igrave:236 iacute:237 icirc:238 iuml:239 eth:240 ntilde:241 ograve:242 oacute:243 ocirc:244 otilde:245 ouml:246 divide:247 oslash:248 ugrave:249 uacute:250 ucirc:251 uuml:252 yacute:253 thorn:254 yuml:255 OElig:338 oelig:339 Scaron:352 scaron:353 fnof:402 circ:710 tilde:732 Alpha:913 Beta:914 Gamma:915 Delta:916 Omega:937 alpha:945 beta:946 gamma:947 delta:948 epsilon:949 theta:952 lambda:955 mu:956 pi:960 sigma:963 tau:964 phi:966 omega:969 ensp:8194 emsp:8195 thinsp:8201 zwnj:8204 zwj:8205 ndash:8211 mdash:8212 lsquo:8216 rsquo:8217 sbquo:8218 ldquo:8220 rdquo:8221 bdquo:8222 dagger:8224 Dagger:8225 bull:8226 hellip:8230 permil:8240 prime:8242 Prime:8243 lsaquo:8249 rsaquo:8250 euro:8364 trade:8482 larr:8592 uarr:8593 rarr:8594 darr:8595 harr:8596 crarr:8629 lArr:8656 uArr:8657 rArr:8658 dArr:8659 hArr:8660 forall:8704 part:8706 exist:8707 empty:8709 nabla:8711 isin:8712 notin:8713 ni:8715 prod:8719 sum:8721 minus:8722 radic:8730 prop:8733 infin:8734 ang:8736 and:8743 or:8744 cap:8745 cup:8746 int:8747 there4:8756 sim:8764 cong:8773 asymp:8776 ne:8800 equiv:8801 le:8804 ge:8805 sub:8834 sup:8835 oplus:8853 otimes:8855 perp:8869 loz:9674 spades:9824 clubs:9827 hearts:9829 diams:9830 check:10003 star:9734 starf:9733 phone:9742'
export const ENTITIES = Object.fromEntries(ENT.split(' ').map((x) => x.split(':')).map(([n, c]) => [n, +c]))
const ENT_BY_CP = new Map(Object.entries(ENTITIES).map(([n, c]) => [c, n]))
export const entityFor = (cp) => ENT_BY_CP.get(cp)

// ---------- Blocks (the ones people look for) ----------
export const BLOCKS = [
  ['Basic Latin (ASCII)', 0x0, 0x7f], ['Latin-1 Supplement', 0x80, 0xff], ['Latin Extended-A', 0x100, 0x17f], ['Latin Extended-B', 0x180, 0x24f], ['IPA Extensions', 0x250, 0x2af], ['Spacing Modifier Letters', 0x2b0, 0x2ff],
  ['Combining Diacritical Marks', 0x300, 0x36f], ['Greek and Coptic', 0x370, 0x3ff], ['Cyrillic', 0x400, 0x4ff], ['Armenian', 0x530, 0x58f], ['Hebrew', 0x590, 0x5ff], ['Arabic', 0x600, 0x6ff], ['Devanagari', 0x900, 0x97f],
  ['Bengali', 0x980, 0x9ff], ['Gurmukhi', 0xa00, 0xa7f], ['Gujarati', 0xa80, 0xaff], ['Tamil', 0xb80, 0xbff], ['Telugu', 0xc00, 0xc7f], ['Kannada', 0xc80, 0xcff], ['Malayalam', 0xd00, 0xd7f], ['Thai', 0xe00, 0xe7f],
  ['Tibetan', 0xf00, 0xfff], ['Georgian', 0x10a0, 0x10ff], ['Hangul Jamo', 0x1100, 0x11ff], ['Latin Extended Additional', 0x1e00, 0x1eff], ['Greek Extended', 0x1f00, 0x1fff], ['General Punctuation', 0x2000, 0x206f],
  ['Superscripts and Subscripts', 0x2070, 0x209f], ['Currency Symbols', 0x20a0, 0x20cf], ['Combining Diacritical Marks for Symbols', 0x20d0, 0x20ff], ['Letterlike Symbols', 0x2100, 0x214f], ['Number Forms', 0x2150, 0x218f],
  ['Arrows', 0x2190, 0x21ff], ['Mathematical Operators', 0x2200, 0x22ff], ['Miscellaneous Technical', 0x2300, 0x23ff], ['Control Pictures', 0x2400, 0x243f], ['Enclosed Alphanumerics', 0x2460, 0x24ff], ['Box Drawing', 0x2500, 0x257f],
  ['Block Elements', 0x2580, 0x259f], ['Geometric Shapes', 0x25a0, 0x25ff], ['Miscellaneous Symbols', 0x2600, 0x26ff], ['Dingbats', 0x2700, 0x27bf], ['Supplemental Arrows-A', 0x27f0, 0x27ff], ['Braille Patterns', 0x2800, 0x28ff],
  ['Supplemental Arrows-B', 0x2900, 0x297f], ['Miscellaneous Symbols and Arrows', 0x2b00, 0x2bff], ['CJK Symbols and Punctuation', 0x3000, 0x303f], ['Hiragana', 0x3040, 0x309f], ['Katakana', 0x30a0, 0x30ff], ['Bopomofo', 0x3100, 0x312f],
  ['Enclosed CJK Letters and Months', 0x3200, 0x32ff], ['CJK Unified Ideographs (first 512)', 0x4e00, 0x4fff], ['Hangul Syllables (first 512)', 0xac00, 0xadff], ['Private Use Area (first 256)', 0xe000, 0xe0ff],
  ['Alphabetic Presentation Forms', 0xfb00, 0xfb4f], ['Variation Selectors', 0xfe00, 0xfe0f], ['Halfwidth and Fullwidth Forms', 0xff00, 0xffef], ['Specials', 0xfff0, 0xffff], ['Mathematical Alphanumeric Symbols', 0x1d400, 0x1d7ff],
  ['Mahjong Tiles', 0x1f000, 0x1f02f], ['Playing Cards', 0x1f0a0, 0x1f0ff], ['Enclosed Alphanumeric Supplement', 0x1f100, 0x1f1ff], ['Miscellaneous Symbols and Pictographs', 0x1f300, 0x1f5ff], ['Emoticons', 0x1f600, 0x1f64f],
  ['Transport and Map Symbols', 0x1f680, 0x1f6ff], ['Geometric Shapes Extended', 0x1f780, 0x1f7ff], ['Supplemental Symbols and Pictographs', 0x1f900, 0x1f9ff], ['Chess Symbols', 0x1fa00, 0x1fa6f], ['Symbols and Pictographs Extended-A', 0x1fa70, 0x1faff],
  ['Tags', 0xe0000, 0xe007f],
]

// ---------- Escapes ----------
const SHORT = { 8: '\\b', 9: '\\t', 10: '\\n', 12: '\\f', 13: '\\r', 34: '\\"', 92: '\\\\' }
export const ESCAPES = [
  ['js', 'JavaScript'], ['jsu', 'JS (\\u{...})'], ['json', 'JSON'], ['python', 'Python'], ['java', 'Java'], ['c', 'C / C++'], ['go', 'Go'], ['rust', 'Rust'], ['swift', 'Swift'],
  ['php', 'PHP'], ['html', 'HTML (&#N;)'], ['htmlx', 'HTML (&#xH;)'], ['css', 'CSS'], ['url', 'URL (UTF-8)'], ['utf8', 'UTF-8 bytes'], ['utf16', 'UTF-16 units'], ['cp', 'Code points'],
]
const surr = (cp) => (cp > 0xffff ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)] : [cp])
const u4 = (n) => `\\u${hexUp(n, 4)}`
/** Escape every non-ASCII character (and control characters) so the text survives plain-ASCII transport. */
export function escapeText(s, kind) {
  if (kind === 'url') return percent(s)
  if (kind === 'utf8') return utf8Hex(s)
  if (kind === 'utf16') return utf16Hex(s)
  if (kind === 'cp') return cps(s).map(label).join(' ')
  const literal = ['js', 'jsu', 'json', 'python', 'java', 'c', 'go', 'rust', 'swift', 'php'].includes(kind)
  let out = ''
  for (const cp of cps(s)) {
    const ch = String.fromCodePoint(cp)
    if (kind === 'html' || kind === 'htmlx') {
      if (cp === 38) out += '&amp;'; else if (cp === 60) out += '&lt;'; else if (cp === 62) out += '&gt;'; else if (cp === 34) out += '&quot;'
      else if (cp >= 32 && cp < 127) out += ch
      else out += kind === 'html' ? `&#${cp};` : `&#x${hexUp(cp, 1)};`
      continue
    }
    if (kind === 'css') { out += cp >= 32 && cp < 127 && cp !== 92 && cp !== 34 ? ch : `\\${hexUp(cp, 1)} `; continue }
    if (cp >= 32 && cp < 127 && cp !== 92 && cp !== 34) { out += ch; continue }
    if (literal && SHORT[cp]) { out += SHORT[cp]; continue }
    if (cp > 0xffff) {
      out += ({
        js: surr(cp).map(u4).join(''), json: surr(cp).map(u4).join(''), java: surr(cp).map(u4).join(''),
        jsu: `\\u{${hexUp(cp, 1)}}`, rust: `\\u{${hexUp(cp, 1)}}`, swift: `\\u{${hexUp(cp, 1)}}`, php: `\\u{${hexUp(cp, 1)}}`,
        python: `\\U${hexUp(cp, 8)}`, c: `\\U${hexUp(cp, 8)}`, go: `\\U${hexUp(cp, 8)}`,
      })[kind]
    } else if (kind === 'jsu' || kind === 'rust' || kind === 'swift' || kind === 'php') out += `\\u{${hexUp(cp, 1)}}`
    else if (kind === 'python' && cp < 0x100) out += `\\x${hexUp(cp, 2)}`
    else out += u4(cp)
  }
  return out
}

/** Turn common escape syntaxes back into characters: é, \u{1F600}, \U0001F600, \xE9, &#233;, &#xE9;, &copy;, U+00E9, %C3%A9. */
export function unescapeText(s) {
  let out = s
  out = out.replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (m, h) => safe(parseInt(h, 16), m))
  out = out.replace(/\\U([0-9a-fA-F]{8})/g, (m, h) => safe(parseInt(h, 16), m))
  out = out.replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
  out = out.replace(/\\x([0-9a-fA-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (m, h) => safe(parseInt(h, 16), m)).replace(/&#(\d+);/g, (m, d) => safe(+d, m))
  out = out.replace(/&([A-Za-z][A-Za-z0-9]*);/g, (m, n) => (n in ENTITIES ? String.fromCodePoint(ENTITIES[n]) : m))
  out = out.replace(/U\+([0-9a-fA-F]{4,6})/g, (m, h) => safe(parseInt(h, 16), m))
  out = out.replace(/(?:%[0-9a-fA-F]{2})+/g, (m) => { try { return decodeURIComponent(m) } catch { return m } })
  return out
}
const safe = (cp, orig) => (cp >= 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : orig)

/** Interpret what the user typed in the search box. */
export function parseQuery(raw) {
  const q = raw.trim()
  if (!q) return { type: 'empty' }
  let m
  if ((m = /^(?:U\+|0x|\\u\{?|&#x)([0-9a-f]{1,6})\}?;?\s*(?:[-–]|\.\.|to)\s*(?:U\+|0x|\\u\{?|&#x)?([0-9a-f]{1,6})\}?;?$/i.exec(q))) {
    const a = parseInt(m[1], 16), b = parseInt(m[2], 16)
    if (a <= b && b <= 0x10ffff) return { type: 'range', from: a, to: Math.min(b, a + 1023), clipped: b > a + 1023 }
  }
  const list = q.split(/[\s,]+/).filter(Boolean).map((t) => {
    let h
    if ((h = /^(?:U\+|0x|\\u\{?|\\U|&#x|u\+)([0-9a-f]{1,8})\}?;?$/i.exec(t))) { const n = parseInt(h[1], 16); return n <= 0x10ffff ? n : NaN }
    if ((h = /^&#(\d+);$/.exec(t))) return +h[1] <= 0x10ffff ? +h[1] : NaN
    return NaN
  })
  if (list.length && list.every((n) => Number.isFinite(n))) return { type: 'cps', list }
  if ((m = /^&?([A-Za-z][A-Za-z0-9]*);?$/.exec(q)) && m[1] in ENTITIES && /^&|;$/.test(q)) return { type: 'cps', list: [ENTITIES[m[1]]] }
  const chars = Array.from(q)
  if (chars.length === 1 || (chars.length <= 8 && chars.some((c) => c.codePointAt(0) > 127))) return { type: 'chars', list: cps(q) }
  return { type: 'name', q }
}

/** Glyph to draw for a code point: combining marks get a dotted circle, controls and spaces get visible stand-ins. */
export function glyphFor(cp, gc = null) {
  const g = gc || categoryOf(cp)
  if (cp < 0x20) return String.fromCodePoint(0x2400 + cp)
  if (cp === 0x7f) return '␡'
  if (cp === 0x20) return '␣'
  if (g === 'Mn' || g === 'Me' || g === 'Mc') return `◌${String.fromCodePoint(cp)}`
  if (['Cc', 'Cf', 'Cs', 'Co', 'Cn', 'Zl', 'Zp'].includes(g) || g === 'Zs') return g === 'Zs' ? '␣' : g === 'Co' ? '□' : '⌀'
  return String.fromCodePoint(cp)
}
