// Numbers to words in the Indian system (thousand, lakh, crore, arab, kharab, neel), in English and Hindi. Pure logic, no DOM.

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
const UNITS = ['', 'Thousand', 'Lakh', 'Crore', 'Arab', 'Kharab', 'Neel']

const HI = ['शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ', 'दस', 'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह', 'अठारह', 'उन्नीस',
  'बीस', 'इक्कीस', 'बाईस', 'तेईस', 'चौबीस', 'पच्चीस', 'छब्बीस', 'सत्ताईस', 'अट्ठाईस', 'उनतीस', 'तीस', 'इकतीस', 'बत्तीस', 'तैंतीस', 'चौंतीस', 'पैंतीस', 'छत्तीस', 'सैंतीस', 'अड़तीस', 'उनतालीस',
  'चालीस', 'इकतालीस', 'बयालीस', 'तैंतालीस', 'चौवालीस', 'पैंतालीस', 'छियालीस', 'सैंतालीस', 'अड़तालीस', 'उनचास', 'पचास', 'इक्यावन', 'बावन', 'तिरपन', 'चौवन', 'पचपन', 'छप्पन', 'सत्तावन', 'अट्ठावन', 'उनसठ',
  'साठ', 'इकसठ', 'बासठ', 'तिरसठ', 'चौंसठ', 'पैंसठ', 'छियासठ', 'सड़सठ', 'अड़सठ', 'उनहत्तर', 'सत्तर', 'इकहत्तर', 'बहत्तर', 'तिहत्तर', 'चौहत्तर', 'पचहत्तर', 'छिहत्तर', 'सतहत्तर', 'अठहत्तर', 'उन्यासी',
  'अस्सी', 'इक्यासी', 'बयासी', 'तिरासी', 'चौरासी', 'पचासी', 'छियासी', 'सत्तासी', 'अट्ठासी', 'नवासी', 'नब्बे', 'इक्यानवे', 'बानवे', 'तिरानवे', 'चौरानवे', 'पचानवे', 'छियानवे', 'सत्तानवे', 'अट्ठानवे', 'निन्यानवे']
const HI_UNITS = ['', 'हज़ार', 'लाख', 'करोड़', 'अरब', 'खरब', 'नील']

export const MAX_DIGITS = 15

/** Groups of a non-negative BigInt in Indian order: [ones(0-999), thousands(0-99), lakhs(0-99), ...]. */
function groups(n) {
  const out = [Number(n % 1000n)]
  n /= 1000n
  while (n > 0n) { out.push(Number(n % 100n)); n /= 100n }
  return out
}

function below100(n, hyphen) {
  if (n < 20) return ONES[n]
  return TENS[Math.floor(n / 10)] + (n % 10 ? (hyphen ? '-' : ' ') + ONES[n % 10] : '')
}

function below1000(n, { hyphen, and }) {
  const hundreds = Math.floor(n / 100), rest = n % 100
  const parts = []
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`)
  if (rest) parts.push((hundreds && and ? 'and ' : '') + below100(rest, hyphen))
  return parts.join(' ')
}

/** English words for a non-negative integer (BigInt or digit string). */
export function intToWords(value, opts = {}) {
  const n = BigInt(value)
  if (n === 0n) return 'Zero'
  const g = groups(n)
  const parts = []
  for (let i = g.length - 1; i >= 0; i--) {
    if (!g[i]) continue
    parts.push(i === 0 ? below1000(g[0], opts) : `${below100(g[i], opts.hyphen)} ${UNITS[i]}`)
  }
  let text = parts.join(' ')
  // "and" before a final tens/ones part when there is no hundreds group: One Lakh and Five
  if (opts.and && g[0] && g[0] < 100 && g.length > 1) text = text.replace(new RegExp(`${below100(g[0], opts.hyphen)}$`), (m) => `and ${m}`)
  return text
}

export function intToHindi(value) {
  const n = BigInt(value)
  if (n === 0n) return HI[0]
  const g = groups(n)
  const parts = []
  for (let i = g.length - 1; i >= 0; i--) {
    if (!g[i]) continue
    if (i === 0) {
      const hundreds = Math.floor(g[0] / 100), rest = g[0] % 100
      if (hundreds) parts.push(`${HI[hundreds]} सौ`)
      if (rest) parts.push(HI[rest])
    } else parts.push(`${HI[g[i]]} ${HI_UNITS[i]}`)
  }
  return parts.join(' ')
}

/**
 * Parse what a person types: "₹ 1,23,456.78", "Rs. 500", "1234.5". Returns {rupees: BigInt, paise: 0..99, rounded: bool} or {error}.
 */
export function parseAmount(raw) {
  const s = String(raw).replace(/[₹\s,]/g, '').replace(/^(rs\.?|inr)/i, '')
  if (!s) return { error: 'empty' }
  if (/^-/.test(s)) return { error: 'Cheque amounts cannot be negative' }
  const m = s.match(/^(\d+)?(?:\.(\d*))?$/)
  if (!m || (m[1] === undefined && !m[2])) return { error: 'Type an amount using digits, for example 1,25,000.50' }
  const intPart = (m[1] || '0').replace(/^0+(?=\d)/, '')
  if (intPart.length > MAX_DIGITS) return { error: `That is more than ${MAX_DIGITS} digits. Amounts up to 99,99,99,99,99,99,999 are supported.` }
  const frac = (m[2] || '').padEnd(3, '0')
  let rupees = BigInt(intPart), paise = Number(frac.slice(0, 2))
  const rounded = /[1-9]/.test(frac.slice(2))
  if (rounded && Number(frac[2]) >= 5) {
    paise += 1
    if (paise === 100) { paise = 0; rupees += 1n }
  }
  return { rupees, paise, rounded }
}

/** "1,23,456.78" style grouping from a parsed amount (always two decimals when paise exist, or when forced). */
export function formatIndian(rupees, paise, forceDecimals = false) {
  const s = rupees.toString()
  const last3 = s.slice(-3), rest = s.slice(0, -3)
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3
  return paise || forceDecimals ? `${grouped}.${String(paise).padStart(2, '0')}` : grouped
}

/**
 * Full cheque wording. opts: {lang: 'en'|'hi', paise: 'words'|'fraction', hyphen, and, case: 'title'|'upper'|'lower', currency: 'Rupees'}
 */
export function amountInWords(rupees, paise, opts = {}) {
  const { lang = 'en', paise: paiseStyle = 'words', hyphen = true, and = false, case: letterCase = 'title', currency = 'Rupees' } = opts
  let text
  if (lang === 'hi') {
    const r = rupees === 1n ? 'एक रुपया' : `${intToHindi(rupees)} रुपये`
    const p = paise ? (paise === 1 ? 'एक पैसा' : `${HI[paise]} पैसे`) : ''
    text = rupees === 0n && paise ? `${p} मात्र` : `${r}${p ? ` और ${p}` : ''} मात्र`
    return text
  }
  const rw = intToWords(rupees, { hyphen, and })
  if (rupees === 0n && paise) text = `${paiseStyle === 'fraction' ? `${paise}/100` : `Paise ${intToWords(paise, { hyphen })}`} Only`
  else {
    const tail = paise ? (paiseStyle === 'fraction' ? ` and ${String(paise).padStart(2, '0')}/100` : ` and Paise ${intToWords(paise, { hyphen })}`) : ''
    text = `${currency} ${rw}${tail} Only`
  }
  if (letterCase === 'upper') return text.toUpperCase()
  if (letterCase === 'lower') return text.toLowerCase().replace(/^./, (c) => c.toUpperCase())
  return text
}
