// Invoice maths: GST split (CGST + SGST within a state, IGST between states), totals in whole paise, GSTIN check,
// Indian and international amount in words. Pure logic (no DOM).

export const STATES = [['01', 'Jammu & Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'], ['05', 'Uttarakhand'], ['06', 'Haryana'], ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'], ['10', 'Bihar'], ['11', 'Sikkim'], ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'], ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'], ['18', 'Assam'], ['19', 'West Bengal'], ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'], ['24', 'Gujarat'], ['26', 'Dadra & Nagar Haveli and Daman & Diu'], ['27', 'Maharashtra'], ['29', 'Karnataka'], ['30', 'Goa'], ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'], ['35', 'Andaman & Nicobar Islands'], ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'], ['97', 'Other Territory']]
export const stateName = (code) => STATES.find(([c]) => c === code)?.[1] || ''
export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28]
export const UNITS = ['nos', 'pcs', 'hrs', 'days', 'kg', 'm', 'sqft', 'ltr', 'set', 'box', 'month', 'service']

export const CURRENCIES = {
  INR: { sym: '₹', ascii: 'Rs.', locale: 'en-IN', major: 'Rupees', minor: 'Paise', indian: true },
  USD: { sym: '$', ascii: '$', locale: 'en-US', major: 'US Dollars', minor: 'Cents' },
  EUR: { sym: '€', ascii: 'EUR ', locale: 'en-IE', major: 'Euros', minor: 'Cents' },
  GBP: { sym: '£', ascii: '£', locale: 'en-GB', major: 'Pounds', minor: 'Pence' },
  AED: { sym: 'AED ', ascii: 'AED ', locale: 'en-AE', major: 'Dirhams', minor: 'Fils' },
  SGD: { sym: 'S$', ascii: 'S$', locale: 'en-SG', major: 'Singapore Dollars', minor: 'Cents' },
  AUD: { sym: 'A$', ascii: 'A$', locale: 'en-AU', major: 'Australian Dollars', minor: 'Cents' },
  CAD: { sym: 'C$', ascii: 'C$', locale: 'en-CA', major: 'Canadian Dollars', minor: 'Cents' },
}

// ---------- GSTIN ----------
const GCH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
export function gstinCheckChar(g15) {
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const v = GCH.indexOf(g15[i]) * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(v / 36) + (v % 36)
  }
  return GCH[(36 - (sum % 36)) % 36]
}
export function gstinStatus(raw) {
  const g = String(raw || '').trim().toUpperCase()
  if (!g) return { state: 'empty' }
  if (g.length < 15) return { state: 'partial', msg: `${15 - g.length} more character${15 - g.length > 1 ? 's' : ''}` }
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return { state: 'bad', msg: 'Format looks wrong' }
  if (gstinCheckChar(g) !== g[14]) return { state: 'bad', msg: 'Check digit does not match. Please re-check.' }
  return { state: 'ok', stateCode: g.slice(0, 2), pan: g.slice(2, 12) }
}

// ---------- numbers ----------
const P = (x) => Math.round((Number(x) || 0) * 100 + (x < 0 ? -1e-7 : 1e-7))
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
const clamp = (n, a, b) => Math.min(b, Math.max(a, n))

export function calcInvoice(inv) {
  const gst = !!inv.gst
  const intra = gst && !!inv.seller.state && !!inv.placeOfSupply && inv.seller.state === inv.placeOfSupply
  const lines = []
  for (const it of inv.items) {
    const qty = num(it.qty), rate = num(it.rate)
    if (!String(it.desc || '').trim() && !qty && !rate) continue
    const disc = clamp(num(it.disc), 0, 100)
    const g = gst ? clamp(num(it.gst), 0, 100) : 0
    const gross = P(qty * rate)
    const discount = Math.round((gross * disc) / 100)
    const taxable = gross - discount
    const cgst = intra ? Math.round((taxable * g) / 200) : 0
    const sgst = cgst
    const igst = gst && !intra ? Math.round((taxable * g) / 100) : 0
    const tax = cgst + sgst + igst
    lines.push({ ...it, qty, rate, disc, rateGst: g, gross, discount, taxable, cgst, sgst, igst, tax, total: taxable + tax })
  }
  const sum = (k) => lines.reduce((n, l) => n + l[k], 0)
  const t = { gross: sum('gross'), discount: sum('discount'), taxable: sum('taxable'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), tax: sum('tax') }
  t.grand = t.taxable + t.tax
  t.round = inv.roundOff ? Math.round(t.grand / 100) * 100 - t.grand : 0
  t.payable = t.grand + t.round
  const groups = new Map()
  for (const l of lines) {
    const key = `${(l.hsn || '').trim()}|${l.rateGst}`
    const r = groups.get(key) || { hsn: (l.hsn || '').trim(), rate: l.rateGst, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 }
    r.taxable += l.taxable; r.cgst += l.cgst; r.sgst += l.sgst; r.igst += l.igst; r.tax += l.tax
    groups.set(key, r)
  }
  return { lines, totals: t, taxRows: [...groups.values()].sort((a, b) => a.rate - b.rate), intra, gst }
}

export function money(paise, cur = 'INR', { symbol = false, ascii = false } = {}) {
  const c = CURRENCIES[cur] || CURRENCIES.USD
  const s = (paise / 100).toLocaleString(c.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return symbol ? `${ascii ? c.ascii : c.sym}${s}` : s
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
const below100 = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`)
const below1000 = (n) => (n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${below100(n % 100)}` : ''}` : below100(n))
/** Whole number in words: Indian grouping (lakh, crore) or international (million, billion). */
export function wordsOf(n, indian = true) {
  n = Math.floor(n)
  if (n === 0) return 'Zero'
  const parts = []
  if (indian) {
    const units = [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']]
    for (const [v, name] of units) {
      const q = Math.floor(n / v)
      if (q) { parts.push(`${wordsOf(q, true)} ${name}`); n %= v }
    }
  } else {
    const units = [[1e12, 'Trillion'], [1e9, 'Billion'], [1e6, 'Million'], [1000, 'Thousand']]
    for (const [v, name] of units) {
      const q = Math.floor(n / v)
      if (q) { parts.push(`${wordsOf(q, false)} ${name}`); n %= v }
    }
  }
  if (n) parts.push(below1000(n))
  return parts.join(' ')
}
export function amountInWords(paise, cur = 'INR') {
  const c = CURRENCIES[cur] || CURRENCIES.USD
  const neg = paise < 0
  const a = Math.abs(paise)
  const major = Math.floor(a / 100), minor = a % 100
  const text = `${wordsOf(major, !!c.indian)} ${c.major}${minor ? ` and ${wordsOf(minor, false)} ${c.minor}` : ''} Only`
  return neg ? `Minus ${text}` : text
}

export function nextNumber(n) {
  const m = String(n || '').match(/^(.*?)(\d+)(\D*)$/)
  if (!m) return `${n || 'INV'}-1`
  return `${m[1]}${String(+m[2] + 1).padStart(m[2].length, '0')}${m[3]}`
}

export const blankInvoice = () => {
  const d = new Date()
  const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  const due = new Date(d.getTime() + 15 * 86400000)
  return {
    look: 'clean', accent: '#0d9b8a', currency: 'INR', gst: true, roundOff: true, number: 'INV-0001', date: iso(d), due: iso(due), po: '', placeOfSupply: '',
    seller: { name: '', address: '', gstin: '', pan: '', state: '', email: '', phone: '', logo: '', bankName: '', holder: '', account: '', ifsc: '', branch: '', upi: '' },
    buyer: { name: '', address: '', gstin: '', state: '', email: '', phone: '' },
    items: [{ id: Math.random().toString(36).slice(2, 8), desc: '', hsn: '', qty: '1', unit: 'nos', rate: '', disc: '', gst: '18' }],
    notes: '', terms: 'Payment due within 15 days. Late payments may attract interest.', signatory: '',
  }
}
