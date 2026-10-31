// Unicode blocks (the ones fonts commonly cover), used by the viewer and the subsetter. DOM-free.
const RAW = `0000 007F Basic Latin;0080 00FF Latin-1 Supplement;0100 017F Latin Extended-A;0180 024F Latin Extended-B;0250 02AF IPA Extensions;02B0 02FF Spacing Modifier Letters;0300 036F Combining Diacritical Marks;0370 03FF Greek and Coptic;0400 04FF Cyrillic;0500 052F Cyrillic Supplement;0530 058F Armenian;0590 05FF Hebrew;0600 06FF Arabic;0700 074F Syriac;0750 077F Arabic Supplement;0780 07BF Thaana;07C0 07FF NKo;0900 097F Devanagari;0980 09FF Bengali;0A00 0A7F Gurmukhi;0A80 0AFF Gujarati;0B00 0B7F Oriya;0B80 0BFF Tamil;0C00 0C7F Telugu;0C80 0CFF Kannada;0D00 0D7F Malayalam;0D80 0DFF Sinhala;0E00 0E7F Thai;0E80 0EFF Lao;0F00 0FFF Tibetan;1000 109F Myanmar;10A0 10FF Georgian;1100 11FF Hangul Jamo;1200 137F Ethiopic;13A0 13FF Cherokee;1400 167F Canadian Syllabics;1680 169F Ogham;16A0 16FF Runic;1780 17FF Khmer;1800 18AF Mongolian;1D00 1D7F Phonetic Extensions;1E00 1EFF Latin Extended Additional;1F00 1FFF Greek Extended;2000 206F General Punctuation;2070 209F Superscripts and Subscripts;20A0 20CF Currency Symbols;20D0 20FF Combining Marks for Symbols;2100 214F Letterlike Symbols;2150 218F Number Forms;2190 21FF Arrows;2200 22FF Mathematical Operators;2300 23FF Miscellaneous Technical;2400 243F Control Pictures;2460 24FF Enclosed Alphanumerics;2500 257F Box Drawing;2580 259F Block Elements;25A0 25FF Geometric Shapes;2600 26FF Miscellaneous Symbols;2700 27BF Dingbats;27C0 27EF Misc Mathematical Symbols-A;27F0 27FF Supplemental Arrows-A;2800 28FF Braille Patterns;2900 297F Supplemental Arrows-B;2980 29FF Misc Mathematical Symbols-B;2A00 2AFF Supplemental Math Operators;2B00 2BFF Misc Symbols and Arrows;2C00 2C5F Glagolitic;2C60 2C7F Latin Extended-C;2C80 2CFF Coptic;2D30 2D7F Tifinagh;2DE0 2DFF Cyrillic Extended-A;2E00 2E7F Supplemental Punctuation;2E80 2EFF CJK Radicals Supplement;2F00 2FDF Kangxi Radicals;3000 303F CJK Symbols and Punctuation;3040 309F Hiragana;30A0 30FF Katakana;3100 312F Bopomofo;3130 318F Hangul Compatibility Jamo;31F0 31FF Katakana Phonetic Extensions;3200 32FF Enclosed CJK Letters and Months;3300 33FF CJK Compatibility;3400 4DBF CJK Extension A;4DC0 4DFF Yijing Hexagram Symbols;4E00 9FFF CJK Unified Ideographs;A000 A48F Yi Syllables;A640 A69F Cyrillic Extended-B;A720 A7FF Latin Extended-D;AC00 D7AF Hangul Syllables;E000 F8FF Private Use Area;F900 FAFF CJK Compatibility Ideographs;FB00 FB4F Alphabetic Presentation Forms;FB50 FDFF Arabic Presentation Forms-A;FE00 FE0F Variation Selectors;FE20 FE2F Combining Half Marks;FE30 FE4F CJK Compatibility Forms;FE70 FEFF Arabic Presentation Forms-B;FF00 FFEF Halfwidth and Fullwidth Forms;FFF0 FFFF Specials;1D400 1D7FF Mathematical Alphanumeric Symbols;1F000 1F02F Mahjong Tiles;1F300 1F5FF Symbols and Pictographs;1F600 1F64F Emoticons;1F680 1F6FF Transport and Map Symbols;1F900 1F9FF Supplemental Symbols and Pictographs;20000 2A6DF CJK Extension B`

export const BLOCKS = RAW.split(';').map((s) => {
  const [a, b, ...n] = s.split(' ')
  return { start: parseInt(a, 16), end: parseInt(b, 16), name: n.join(' ') }
})

export const blockOf = (cp) => BLOCKS.find((b) => cp >= b.start && cp <= b.end) || null
export const hex = (cp, min = 4) => cp.toString(16).toUpperCase().padStart(min, '0')
export const uplus = (cp) => `U+${hex(cp)}`

/** Group a set of code points by block: [{block, cps: number[]}] in block order, with "Other" last. */
export function groupByBlock(cps) {
  const map = new Map()
  const other = []
  for (const cp of [...cps].sort((a, b) => a - b)) {
    const b = blockOf(cp)
    if (!b) { other.push(cp); continue }
    if (!map.has(b)) map.set(b, [])
    map.get(b).push(cp)
  }
  const out = [...map].map(([block, list]) => ({ block, cps: list }))
  if (other.length) out.push({ block: { start: other[0], end: other[other.length - 1], name: 'Other' }, cps: other })
  return out
}

/** Quick ranges for the subsetter: [label, [[start, end], ...]]. */
export const PRESETS = [
  ['Basic Latin', [[0x20, 0x7e]]],
  ['Latin-1 Supplement', [[0xa0, 0xff]]],
  ['Latin Extended-A', [[0x100, 0x17f]]],
  ['Digits only', [[0x30, 0x39]]],
  ['Punctuation', [[0x2000, 0x206f]]],
  ['Currency', [[0x20a0, 0x20cf]]],
  ['Greek', [[0x370, 0x3ff]]],
  ['Cyrillic', [[0x400, 0x4ff]]],
  ['Arabic', [[0x600, 0x6ff]]],
  ['Hebrew', [[0x590, 0x5ff]]],
  ['Devanagari', [[0x900, 0x97f]]],
  ['Thai', [[0xe00, 0xe7f]]],
  ['Arrows', [[0x2190, 0x21ff]]],
  ['Math operators', [[0x2200, 0x22ff]]],
]

/** Parse hex lists such as "U+0041-005A, 0x20, 2022" into code points. Throws on junk. */
export function parseRanges(text) {
  const out = new Set()
  for (const part of text.split(/[\s,;]+/).filter(Boolean)) {
    const m = part.match(/^(?:u\+|0x|\u)?([0-9a-f]{1,6})(?:-(?:u\+|0x|\u)?([0-9a-f]{1,6}))?$/i)
    if (!m) throw new Error(`"${part}" is not a code point or range. Use U+0041 or U+0041-005A.`)
    const a = parseInt(m[1], 16), b = m[2] ? parseInt(m[2], 16) : a
    if (a > 0x10ffff || b > 0x10ffff || b < a) throw new Error(`"${part}" is out of range.`)
    if (b - a > 0x20000) throw new Error(`"${part}" covers too many characters.`)
    for (let c = a; c <= b; c++) out.add(c)
  }
  return out
}
