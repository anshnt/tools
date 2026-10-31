// Text encodings for DBF files: pick a decoder from a .cpg name or the language driver byte, and build an encoder for writing
// (UTF-8 natively; CP949, GBK, Big5, Shift-JIS and the single-byte code pages by inverting the browser's decoder).

export const ENCODINGS = [
  ['auto', 'Detect (cpg file, then UTF-8)'],
  ['utf-8', 'UTF-8'],
  ['euc-kr', 'Korean (CP949)'],
  ['windows-1252', 'Western (Windows-1252)'],
  ['gbk', 'Chinese (GBK)'],
  ['big5', 'Chinese (Big5)'],
  ['shift_jis', 'Japanese (Shift-JIS)'],
  ['windows-1251', 'Cyrillic (Windows-1251)'],
  ['windows-1250', 'Central European (Windows-1250)'],
]

const LDID = {
  0x03: 'windows-1252', 0x57: 'windows-1252', 0x58: 'windows-1252', 0x59: 'windows-1252', 0x4d: 'gbk', 0x7a: 'gbk', 0x4e: 'euc-kr', 0x79: 'euc-kr', 0x4f: 'big5',
  0x78: 'big5', 0x50: 'windows-874', 0x7c: 'windows-874', 0x7b: 'shift_jis', 0x7d: 'windows-1255', 0x7e: 'windows-1256', 0xc8: 'windows-1250', 0xc9: 'windows-1251',
  0xca: 'windows-1254', 0xcb: 'windows-1253', 0xcc: 'windows-1257', 0x26: 'ibm866', 0x65: 'ibm866', 0x01: 'windows-1252', 0x02: 'windows-1252',
}
const works = (l) => { try { new TextDecoder(l); return true } catch { return false } }

/** Name from a .cpg file ("UTF-8", "CP949", "1252", "ISO-8859-1", "EUC-KR" ...) to a TextDecoder label, or null. */
export function labelFromCpg(text) {
  const s = String(text || '').trim().toLowerCase().replace(/^\uFEFF/, '')
  if (!s) return null
  let m
  if (/^(utf-?8|65001)$/.test(s)) return 'utf-8'
  if (/^(cp|ms|windows-?|ibm)?-?949$|euc-?kr|uhc|ks_?c_?5601/.test(s)) return 'euc-kr'
  if (/^(cp|ms|windows-?)?-?936$|^gbk$|gb2312|gb18030/.test(s)) return 'gbk'
  if (/^(cp|ms|windows-?)?-?950$|big-?5/.test(s)) return 'big5'
  if (/^(cp|ms|windows-?)?-?932$|shift.?jis|^sjis$/.test(s)) return 'shift_jis'
  if (/^(cp|ms|windows-?|ibm)?-?866$/.test(s)) return 'ibm866'
  if ((m = s.match(/^(?:cp|ms|windows-?|ansi_?)?-?(125[0-8]|874)$/))) return `windows-${m[1]}`
  if ((m = s.match(/^(?:iso)?[-_]?8859[-_]?(\d+)$/))) return m[1] === '1' ? 'windows-1252' : works(`iso-8859-${m[1]}`) ? `iso-8859-${m[1]}` : null
  if (/^(latin-?1|ascii|us-ascii|ansi.*)$/.test(s)) return 'windows-1252'
  return works(s) ? s : null
}
export const labelFromLdid = (b) => LDID[b] || null

/** Decode bytes with a label; returns null if `strict` and the bytes are not valid in that encoding. */
export function decodeWith(label, bytes, strict = false) {
  try { return new TextDecoder(label, { fatal: strict }).decode(bytes) } catch { return null }
}

// ---------- encoders ----------
const encCache = new Map()
/** makeEncoder('euc-kr') -> (string) => Uint8Array. Characters the code page cannot hold become '?'. */
export function makeEncoder(label) {
  if (label === 'utf-8') { const te = new TextEncoder(); return (s) => te.encode(s) }
  if (!encCache.has(label)) {
    const dec = new TextDecoder(label)
    const map = new Map()
    for (let b = 0x80; b < 0x100; b++) { const s = dec.decode(new Uint8Array([b])); if (s.length === 1 && s !== '\ufffd') map.set(s, [b]) }
    const doubleByte = ['euc-kr', 'gbk', 'big5', 'shift_jis', 'gb18030'].includes(label)
    if (doubleByte) {
      const two = new Uint8Array(2)
      for (let a = 0x81; a <= 0xfe; a++) for (let b = 0x40; b <= 0xfe; b++) {
        two[0] = a; two[1] = b
        const s = dec.decode(two)
        if ([...s].length === 1 && s !== '\ufffd' && !map.has(s)) map.set(s, [a, b])
      }
    }
    encCache.set(label, map)
  }
  const map = encCache.get(label)
  return (str) => {
    const out = []
    for (const ch of str) {
      const c = ch.codePointAt(0)
      if (c < 0x80) out.push(c)
      else out.push(...(map.get(ch) || [0x3f]))
    }
    return Uint8Array.from(out)
  }
}
export const cpgName = (label) => ({ 'utf-8': 'UTF-8', 'euc-kr': 'CP949', gbk: 'GBK', big5: 'Big5', shift_jis: 'Shift_JIS', 'windows-1252': 'CP1252' }[label] || label.replace('windows-', 'CP').toUpperCase())
export const ldidFor = (label) => ({ 'euc-kr': 0x4e, gbk: 0x4d, big5: 0x4f, shift_jis: 0x7b, 'windows-1252': 0x03, 'windows-1251': 0xc9, 'windows-1250': 0xc8 }[label] ?? 0)

/**
 * Best guess for bytes that are not valid UTF-8 and carry no encoding hint: Korean (CP949) when it decodes cleanly and is mostly Hangul,
 * otherwise Windows-1252.
 */
export function guessLegacyEncoding(bytes) {
  const k = decodeWith('euc-kr', bytes, true)
  if (k) {
    const hangul = (k.match(/[\uac00-\ud7a3]/g) || []).length
    const other = (k.match(/[^\x00-\x7f]/g) || []).length
    if (hangul && hangul >= other * 0.6) return 'euc-kr'
  }
  return 'windows-1252'
}
