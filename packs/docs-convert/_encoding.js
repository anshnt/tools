// Text encoding detection and conversion: BOMs, UTF-16 without a BOM, ISO-2022-JP, strict UTF-8, then scored candidates for Korean (EUC-KR / CP949),
// Japanese (Shift_JIS, EUC-JP), Chinese (GBK, Big5) and the Windows / KOI8 single-byte code pages. Decoding uses the browser's TextDecoder.
import { concat, utf8 } from './_util.js'

export const ENCODINGS = [
  ['utf-8', 'Unicode (UTF-8)'], ['utf-16le', 'Unicode (UTF-16 LE)'], ['utf-16be', 'Unicode (UTF-16 BE)'],
  ['euc-kr', 'Korean (EUC-KR / CP949)'], ['shift_jis', 'Japanese (Shift_JIS)'], ['euc-jp', 'Japanese (EUC-JP)'], ['iso-2022-jp', 'Japanese (ISO-2022-JP)'],
  ['gbk', 'Chinese Simplified (GBK)'], ['gb18030', 'Chinese (GB18030)'], ['big5', 'Chinese Traditional (Big5)'],
  ['windows-1252', 'Western European (Windows-1252)'], ['windows-1250', 'Central European (Windows-1250)'], ['windows-1251', 'Cyrillic (Windows-1251)'], ['windows-1253', 'Greek (Windows-1253)'],
  ['windows-1254', 'Turkish (Windows-1254)'], ['windows-1255', 'Hebrew (Windows-1255)'], ['windows-1256', 'Arabic (Windows-1256)'], ['windows-1257', 'Baltic (Windows-1257)'], ['windows-1258', 'Vietnamese (Windows-1258)'],
  ['windows-874', 'Thai (Windows-874)'], ['iso-8859-1', 'Latin-1 (ISO-8859-1)'], ['iso-8859-2', 'Latin-2 (ISO-8859-2)'], ['iso-8859-5', 'Cyrillic (ISO-8859-5)'], ['iso-8859-7', 'Greek (ISO-8859-7)'], ['iso-8859-9', 'Turkish (ISO-8859-9)'], ['iso-8859-15', 'Latin-9 (ISO-8859-15)'],
  ['koi8-r', 'Russian (KOI8-R)'], ['koi8-u', 'Ukrainian (KOI8-U)'], ['macintosh', 'Mac Roman'],
]
export const labelName = (label) => ENCODINGS.find(([l]) => l === label)?.[1] || label

const dec = (label, bytes, fatal = false) => new TextDecoder(label, { fatal }).decode(bytes)
const tryDecode = (label, bytes) => { try { return dec(label, bytes, true) } catch { return null } }
const count = (s, re) => (s.match(re) || []).length

// very frequent characters in Simplified and Traditional Chinese, used to tell GBK from Big5
const ZH = new Set([...'的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法此实回二理美点月明其种声全工话儿者向情部正名定女问力机给等几很业最间新什打便位因重被走电四第门相次东政海口使教西再平真聽世氣信北少關並內加化由卻代軍產入先山無們為這個來國說會對時學後發開關東車見現門問間聞專業習際應該經頭長電氣馬鳥魚'])
const KO_FREQ = new Set([...'이다는은의가를에하고지한서도로으리기사대자인세시어요니아수그들게나여해된않있없며면제과부공전상생들일같중정리말이것에서하는한다고'])
const JA_FREQ = new Set([...'のはにをたがでてとしれさあいもすなかるまこうよりラスントイクルッタ日本人年大中一出会事'])
const HIRA_KATA = /[぀-ヿㇰ-ㇿｦ-ﾟ]/g
const HANGUL = /[가-힣ㄱ-ㆎ]/g
const HAN = /[一-鿿]/g

/** Detect the most likely encoding. -> {label, confidence: 'bom' | 'certain' | 'high' | 'medium' | 'low', reason, bom, candidates: [{label, score}]} */
export function detectEncoding(bytes) {
  const n = bytes.length
  const res = (label, confidence, reason, extra = {}) => ({ label, confidence, reason, bom: false, candidates: [], ...extra })
  if (n >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return res('utf-8', 'bom', 'UTF-8 byte order mark', { bom: true })
  if (n >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return res('utf-16le', 'bom', 'UTF-16 LE byte order mark', { bom: true })
  if (n >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return res('utf-16be', 'bom', 'UTF-16 BE byte order mark', { bom: true })
  const sample = bytes.subarray(0, Math.min(n, 200000))
  // UTF-16 without a BOM: every other byte is zero for mostly-ASCII text
  if (sample.length >= 4) {
    let even = 0, odd = 0
    for (let i = 0; i + 1 < sample.length; i += 2) { if (sample[i] === 0) even++; if (sample[i + 1] === 0) odd++ }
    const pairs = Math.floor(sample.length / 2)
    if (odd / pairs > 0.3 && even / pairs < 0.05) return res('utf-16le', 'high', 'every other byte is zero (UTF-16 LE)')
    if (even / pairs > 0.3 && odd / pairs < 0.05) return res('utf-16be', 'high', 'every other byte is zero (UTF-16 BE)')
  }
  let ascii = true, esc = false
  for (let i = 0; i < sample.length; i++) { if (sample[i] >= 0x80) { ascii = false; break } if (sample[i] === 0x1b) esc = true }
  if (ascii) return esc && /\x1b[$(][BJ@]/.test(String.fromCharCode(...sample.subarray(0, 4000))) ? res('iso-2022-jp', 'high', 'ISO-2022-JP escape sequences') : res('utf-8', 'certain', 'plain ASCII (same in every encoding)')
  const u = tryDecode('utf-8', sample.subarray(0, sample.length - (sample.length < n ? 3 : 0)))
  if (u !== null) return res('utf-8', 'high', 'valid UTF-8')
  // candidate scoring: how much of the decoded text looks like real writing in that script
  const cands = []
  const text = (label) => { try { return dec(label, sample) } catch { return null } }
  const nonAscii = (s) => s.replace(/[\x00-\x7f]/g, '')
  const letterCount = (s) => (s.match(/\p{L}/gu) || []).length || 1
  const freq = (str, set) => { let h = 0; for (const ch of str) if (set.has(ch)) h++; return h }
  for (const label of ['euc-kr', 'shift_jis', 'euc-jp', 'gbk', 'big5']) {
    const strict = tryDecode(label, sample.subarray(0, sample.length - (sample.length < n ? 2 : 0)))
    if (strict === null) continue
    const na = nonAscii(strict)
    if (!na.length) continue
    const L = letterCount(strict)
    let score = 0
    if (label === 'euc-kr') {
      const hg = count(na, HANGUL)
      score = hg ? (hg / L) * Math.min(1, freq(na, KO_FREQ) / hg / 0.12) : 0
    } else if (label === 'shift_jis' || label === 'euc-jp') {
      const kana = count(na, HIRA_KATA), han = count(na, HAN)
      score = ((kana + han * 0.5) / L) * (kana ? Math.min(1, 0.4 + freq(na, JA_FREQ) / Math.max(1, kana) / 0.1) : 0.35)
    } else {
      const han = count(na, HAN)
      score = han ? (han / L) * Math.min(1, freq(na, ZH) / han / 0.15) : 0
    }
    if (count(na, /[-�]/g)) score *= 0.3
    cands.push({ label, score })
  }
  const bestCjk = Math.max(0, ...cands.map((c) => c.score))
  const single = [
    ['windows-1251', /(?=\p{L})\p{Script=Cyrillic}/gu, /[а-яё]/g, 0.92], ['koi8-r', /(?=\p{L})\p{Script=Cyrillic}/gu, /[а-яё]/g, 0.92],
    ['windows-1253', /(?=\p{L})\p{Script=Greek}/gu, null, 0.7], ['windows-1255', /(?=\p{L})\p{Script=Hebrew}/gu, null, 0.7],
    ['windows-1256', /(?=\p{L})\p{Script=Arabic}/gu, null, 0.7], ['windows-874', /(?=\p{L})\p{Script=Thai}/gu, null, 0.7],
  ]
  for (const [label, re, lower, weight] of single) {
    if (weight < 0.9 && bestCjk >= 0.25) continue // a valid multi-byte reading with plausible text beats an exotic single-byte guess
    const s = text(label)
    if (!s) continue
    const hits = count(s, re)
    if (!hits) continue
    let score = Math.min(1, hits / letterCount(s)) * weight
    if (lower) score *= 0.3 + 0.7 * (count(s, lower) / hits)
    cands.push({ label, score })
  }
  const west = text('windows-1252')
  if (west) {
    const na = nonAscii(west)
    const ctrl = count(na, /[\u0080-\u009f�]/g)
    cands.push({ label: 'windows-1252', score: Math.max(0.3, 0.5 - ctrl / Math.max(1, na.length)) })
  }
  cands.sort((a, b) => b.score - a.score)
  const top = cands[0] || { label: 'windows-1252', score: 0 }
  const second = cands[1]
  const margin = second ? top.score - second.score : top.score
  const confidence = top.score > 0.6 && margin > 0.15 ? 'high' : top.score > 0.35 ? 'medium' : 'low'
  return res(top.label, confidence, `looks like ${labelName(top.label)}`, { candidates: cands.slice(0, 5) })
}

/** Bytes -> text in the given encoding (a byte order mark is removed). */
export function decodeAs(bytes, label) {
  let b = bytes
  if (label === 'utf-8' && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3)
  if (label === 'utf-16le' && b[0] === 0xff && b[1] === 0xfe) b = b.subarray(2)
  if (label === 'utf-16be' && b[0] === 0xfe && b[1] === 0xff) b = b.subarray(2)
  try { return dec(label, b) } catch { return dec('utf-8', b) }
}

/** Convert bytes in any supported encoding to UTF-8 bytes. opts: {from (label, default detect), bom, eol: 'keep' | 'lf' | 'crlf'} -> {bytes, text, from, detected} */
export function toUtf8(bytes, { from, bom = false, eol = 'keep' } = {}) {
  const det = from && from !== 'auto' ? null : detectEncoding(bytes)
  const label = from && from !== 'auto' ? from : det.label
  let text = decodeAs(bytes, label)
  if (eol === 'lf') text = text.replace(/\r\n?/g, '\n')
  else if (eol === 'crlf') text = text.replace(/\r\n?|\n/g, '\r\n')
  return { bytes: bom ? concat([Uint8Array.of(0xef, 0xbb, 0xbf), utf8(text)]) : utf8(text), text, from: label, detected: det }
}
