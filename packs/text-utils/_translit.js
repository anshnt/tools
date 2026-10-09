// Rough transliteration to plain Latin letters: accents, special Latin letters, Cyrillic, Greek and Devanagari (Hindi, Marathi, Nepali).
// Meant for slugs and file names, not for linguistic accuracy. Pure functions, no DOM.

const LATIN = { 'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE', 'ø': 'o', 'Ø': 'O', 'đ': 'd', 'Đ': 'D', 'ð': 'd', 'Ð': 'D', 'þ': 'th', 'Þ': 'Th', 'ł': 'l', 'Ł': 'L', 'ı': 'i', 'İ': 'I', 'ħ': 'h', 'Ħ': 'H', 'ĳ': 'ij', 'Ĳ': 'IJ', 'ŉ': 'n', 'ſ': 's', 'ŋ': 'ng', 'Ŋ': 'Ng', 'ƒ': 'f', 'ə': 'e', 'Ə': 'E' }

const CYR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', є: 'ye', і: 'i', ї: 'yi', ґ: 'g', ј: 'j', љ: 'lj', њ: 'nj', ћ: 'c', ђ: 'dj', џ: 'dz' }
const GRK = { α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o' }

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
function mapCased(ch, table) {
  const low = ch.toLowerCase()
  const r = table[low]
  if (r === undefined) return null
  return ch === low ? r : (r.length > 1 ? cap(r) : r.toUpperCase())
}

// ----- Devanagari -----
const CONS = { क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'ng', च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ञ: 'ny', ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n', त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n', प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm', य: 'y', र: 'r', ल: 'l', ळ: 'l', व: 'v', श: 'sh', ष: 'sh', स: 's', ह: 'h' }
const NUKTA_CONS = { क: 'q', ख: 'kh', ग: 'g', ज: 'z', ड: 'r', ढ: 'rh', फ: 'f', य: 'y' }
const INDEP = { अ: 'a', आ: 'a', इ: 'i', ई: 'i', उ: 'u', ऊ: 'u', ऋ: 'ri', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au', ऑ: 'o', ऍ: 'e' }
const MATRA = { 'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o', 'ॅ': 'e' }
const DIGITS = { '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9' }
const VIRAMA = '्', NUKTA = '़', ANUSVARA = 'ं', CHANDRA = 'ँ', VISARGA = 'ः'
const LABIAL = new Set(['प', 'फ', 'ब', 'भ', 'म'])
const isDeva = (ch) => ch >= 'ऀ' && ch <= 'ॿ'

function devaWord(w) {
  // 1. parse into syllables {cs: consonant tokens, v: vowel | null (inherent a) | '' (none), coda}
  const syl = []
  const chars = [...w]
  let i = 0
  while (i < chars.length) {
    const ch = chars[i]
    if (CONS[ch]) {
      const cs = []
      for (;;) {
        const nuk = chars[i + 1] === NUKTA
        cs.push((nuk && NUKTA_CONS[chars[i]]) || CONS[chars[i]])
        i += nuk ? 2 : 1
        if (chars[i] === VIRAMA && CONS[chars[i + 1]]) { i++; continue }
        break
      }
      let v = null
      if (MATRA[chars[i]]) { v = MATRA[chars[i]]; i++ } else if (chars[i] === VIRAMA) { v = ''; i++ }
      syl.push({ cs, v, coda: '' })
    } else if (INDEP[ch]) { syl.push({ cs: [], v: INDEP[ch], coda: '' }); i++ } else if (ch === ANUSVARA || ch === CHANDRA || ch === VISARGA) {
      if (syl.length) syl[syl.length - 1].coda += ch === VISARGA ? 'h' : 'n'
      i++
    } else if (DIGITS[ch]) { syl.push({ raw: DIGITS[ch] }); i++ } else if (ch === 'ॐ') { syl.push({ raw: 'om' }); i++ } else if (ch === '।' || ch === '॥') { syl.push({ raw: ' ' }); i++ } else { i++ }
  }
  // 2. schwa deletion: the final one, then medial V C(schwa) C V from the right (never before a consonant cluster)
  const vowelled = (s) => !!s && !s.raw && s.v !== ''
  const last = syl.length - 1
  if (last > 0 && syl[last].cs && syl[last].cs.length && syl[last].v === null && !syl[last].coda) syl[last].v = ''
  for (let k = syl.length - 2; k >= 1; k--) {
    const s = syl[k], prev = syl[k - 1], next = syl[k + 1]
    if (s.raw || s.v !== null || !s.cs.length) continue
    if (!vowelled(prev) || prev.coda || !vowelled(next) || next.cs.length > 1) continue
    s.v = ''
  }
  // 3. join; an anusvara sounds like m before a labial consonant, otherwise n
  return syl.map((s, k) => {
    if (s.raw) return s.raw
    const nextFirst = syl[k + 1] && syl[k + 1].cs && syl[k + 1].cs[0]
    const coda = s.coda.replace(/n/g, /^(p|ph|b|bh|m)$/.test(nextFirst || '') ? 'm' : 'n')
    return s.cs.join('') + (s.v === null ? 'a' : s.v) + coda
  }).join('')
}

/** Latin accents, special letters, Cyrillic, Greek and Devanagari to plain Latin. Other scripts pass through unchanged. */
export function transliterate(input) {
  let s = input.normalize('NFD')
  let out = ''
  const chars = [...s]
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    if (isDeva(ch)) {
      let j = i
      while (j < chars.length && isDeva(chars[j])) j++
      out += devaWord(chars.slice(i, j).join(''))
      i = j - 1
    } else if (LATIN[ch] !== undefined) {
      const r = LATIN[ch]
      out += r.length > 1 && r === r.toUpperCase() && /\p{Ll}/u.test(chars[i + 1] || '') ? cap(r.toLowerCase()) : r
    }
    else if (ch >= '\u{300}' && ch <= '\u{36f}') continue
    else out += mapCased(ch, CYR) ?? mapCased(ch, GRK) ?? ch
  }
  return out.normalize('NFC')
}

/**
 * Strip accents from Latin and Greek letters (e-acute becomes e). With special = true, letters like ss, ae, o-slash, d-stroke and l-stroke are
 * spelled out too. Cyrillic, Devanagari and every other script is left exactly as it was.
 * Returns {text, changed: Map(original character -> {to, count})}.
 */
export function removeAccents(input, special = true) {
  const changed = new Map()
  const note = (from, to) => { const e = changed.get(from) || { to, count: 0 }; e.count++; changed.set(from, e) }
  const out = []
  const chars = [...input.normalize('NFD')]
  chars.forEach((ch, i) => {
    if (/[\u{300}-\u{36f}]/u.test(ch)) {
      // a combining mark: drop it only when it belongs to a Latin or Greek letter
      const base = out[out.length - 1]
      if (base && /^[\p{Script=Latin}\p{Script=Greek}]$/u.test(base)) note((base + ch).normalize('NFC'), base)
      else out.push(ch)
    } else if (special && LATIN[ch] !== undefined) {
      const r = LATIN[ch]
      const to = r.length > 1 && r === r.toUpperCase() && /\p{Ll}/u.test(chars[i + 1] || '') ? cap(r.toLowerCase()) : r
      note(ch, to)
      out.push(to)
    } else out.push(ch)
  })
  return { text: out.join('').normalize('NFC'), changed }
}
