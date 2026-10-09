// Format and checksum checks for Indian IDs. Pure logic, nothing is sent anywhere.
import { stateByCode } from './_rto.js'

export const PAN_TYPES = {
  P: 'Individual', C: 'Company', H: 'Hindu Undivided Family (HUF)', F: 'Firm or LLP', A: 'Association of Persons (AOP)', T: 'Trust',
  B: 'Body of Individuals (BOI)', L: 'Local authority', J: 'Artificial juridical person', G: 'Government',
}

export const GST_STATES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
  '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra', '28': 'Andhra Pradesh (before 2014)', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other territory', '99': 'Centre jurisdiction',
}

export const BANKS = {
  SBIN: 'State Bank of India', HDFC: 'HDFC Bank', ICIC: 'ICICI Bank', UTIB: 'Axis Bank', KKBK: 'Kotak Mahindra Bank', PUNB: 'Punjab National Bank', BARB: 'Bank of Baroda',
  CNRB: 'Canara Bank', UBIN: 'Union Bank of India', IDIB: 'Indian Bank', BKID: 'Bank of India', MAHB: 'Bank of Maharashtra', CBIN: 'Central Bank of India', IOBA: 'Indian Overseas Bank',
  UCBA: 'UCO Bank', PSIB: 'Punjab and Sind Bank', YESB: 'Yes Bank', INDB: 'IndusInd Bank', IDFB: 'IDFC FIRST Bank', FDRL: 'Federal Bank', SIBL: 'South Indian Bank', KARB: 'Karnataka Bank',
  KVBL: 'Karur Vysya Bank', CIUB: 'City Union Bank', TMBL: 'Tamilnad Mercantile Bank', DLXB: 'Dhanlaxmi Bank', JAKA: 'Jammu and Kashmir Bank', RATN: 'RBL Bank', BDBL: 'Bandhan Bank',
  AUBL: 'AU Small Finance Bank', ESFB: 'Equitas Small Finance Bank', USFB: 'Ujjivan Small Finance Bank', CSBK: 'CSB Bank', IBKL: 'IDBI Bank', DCBL: 'DCB Bank', DBSS: 'DBS Bank India',
  SCBL: 'Standard Chartered Bank', HSBC: 'HSBC', CITI: 'Citibank', DEUT: 'Deutsche Bank', IPOS: 'India Post Payments Bank', PYTM: 'Paytm Payments Bank', AIRP: 'Airtel Payments Bank',
  FINO: 'Fino Payments Bank', JIOP: 'Jio Payments Bank', SRCB: 'Saraswat Co-operative Bank', COSB: 'Cosmos Co-operative Bank', TJSB: 'TJSB Sahakari Bank', KJSB: 'Kalyan Janata Sahakari Bank',
  ANDB: 'Andhra Bank (merged into Union Bank)', ALLA: 'Allahabad Bank (merged into Indian Bank)', ORBC: 'Oriental Bank of Commerce (merged into PNB)', SYNB: 'Syndicate Bank (merged into Canara)',
  CORP: 'Corporation Bank (merged into Union Bank)', UTBI: 'United Bank of India (merged into PNB)', VIJB: 'Vijaya Bank (merged into Bank of Baroda)', DENA: 'Dena Bank (merged into Bank of Baroda)',
  LAVB: 'Lakshmi Vilas Bank (merged into DBS)',
}

const C36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
export const gstChecksum = (first14) => {
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const p = C36.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(p / 36) + (p % 36)
  }
  return C36[(36 - (sum % 36)) % 36]
}

// Verhoeff tables
const D = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]]
const P = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]]
const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9]
/** True when the digit string (with its check digit) passes the Verhoeff checksum. */
export function verhoeffValid(digits) {
  let c = 0
  const rev = digits.split('').reverse().map(Number)
  for (let i = 0; i < rev.length; i++) c = D[c][P[i % 8][rev[i]]]
  return c === 0
}
export function verhoeffCheckDigit(digits) {
  let c = 0
  const rev = digits.split('').reverse().map(Number)
  for (let i = 0; i < rev.length; i++) c = D[c][P[(i + 1) % 8][rev[i]]]
  return INV[c]
}

const row = (k, v) => [k, v]
const clean = (s) => String(s).trim().toUpperCase().replace(/[\s-]+/g, '')

export const mask = (s, keep = 4) => (s.length > keep ? `${'X'.repeat(s.length - keep)}${s.slice(-keep)}` : s)

/** Each checker: (value) -> {ok, summary, rows: [[label, value]], notes: []}. */
export const CHECKERS = {
  pan: {
    label: 'PAN',
    shape: (s) => s.length === 10,
    check(raw) {
      const s = clean(raw)
      const m = s.match(/^([A-Z]{3})([A-Z])([A-Z])(\d{4})([A-Z])$/)
      if (!m) return { ok: false, summary: 'Not a valid PAN format', notes: ['A PAN is 10 characters: 5 letters, 4 digits, 1 letter (for example ABCPK1234D).'] }
      const type = PAN_TYPES[m[2]]
      if (!type) return { ok: false, summary: `Fourth letter "${m[2]}" is not a valid holder type`, notes: [`Valid holder types: ${Object.keys(PAN_TYPES).join(', ')}.`] }
      return {
        ok: true, summary: `Valid PAN format. Holder type: ${type}`,
        rows: [row('Holder type', `${m[2]} - ${type}`), row('Series', m[1]), row('Fifth letter', m[2] === 'P' ? `${m[3]} (first letter of the surname)` : `${m[3]} (first letter of the name)`), row('Sequence number', m[4]), row('Check letter', m[5])],
        notes: ['The last letter is a check character whose formula is not public, so only the format can be verified here. Verify a PAN with the Income Tax portal.'],
      }
    },
  },
  gstin: {
    label: 'GSTIN',
    shape: (s) => s.length === 15,
    check(raw) {
      const s = clean(raw)
      const m = s.match(/^(\d{2})([A-Z]{5}\d{4}[A-Z])([1-9A-Z])(Z)([0-9A-Z])$/)
      if (!m) return { ok: false, summary: 'Not a valid GSTIN format', notes: ['A GSTIN is 15 characters: 2-digit state code, 10-character PAN, 1 entity number, the letter Z, and 1 check character.'] }
      const state = GST_STATES[m[1]]
      const expected = gstChecksum(s.slice(0, 14))
      const pan = CHECKERS.pan.check(m[2])
      const rows = [row('State', state ? `${m[1]} - ${state}` : `${m[1]} (unknown state code)`), row('PAN inside', m[2]), row('PAN holder type', pan.ok ? PAN_TYPES[m[2][3]] : 'Invalid PAN part'),
        row('Entity number', `${m[3]} (registration number of this PAN in the state)`), row('Check character', `${m[5]} (expected ${expected})`)]
      if (!state) return { ok: false, summary: `State code ${m[1]} does not exist`, rows }
      if (!pan.ok) return { ok: false, summary: 'The PAN inside this GSTIN is not valid', rows }
      if (expected !== m[5]) return { ok: false, summary: `Checksum fails: the last character should be ${expected}`, rows }
      return { ok: true, summary: `Valid GSTIN. State: ${state}`, rows, notes: ['Format and checksum only. Use the GST portal to confirm the registration is active.'] }
    },
  },
  aadhaar: {
    label: 'Aadhaar',
    shape: (s) => /^\d{12}$/.test(s),
    check(raw) {
      const s = clean(raw)
      if (!/^\d{12}$/.test(s)) return { ok: false, summary: 'An Aadhaar number has exactly 12 digits', notes: ['Spaces are fine, letters are not.'] }
      if (/^[01]/.test(s)) return { ok: false, summary: 'Aadhaar numbers never start with 0 or 1' }
      if (!verhoeffValid(s)) return { ok: false, summary: 'Checksum fails (Verhoeff): a digit is wrong or swapped', rows: [row('Expected last digit', String(verhoeffCheckDigit(s.slice(0, 11))))] }
      return { ok: true, summary: 'Valid Aadhaar format and checksum', rows: [row('Masked', mask(s).replace(/(.{4})/g, '$1 ').trim())], notes: ['This does not say the number was issued to anyone. Only UIDAI can confirm that.'] }
    },
  },
  ifsc: {
    label: 'IFSC',
    shape: (s) => s.length === 11,
    check(raw) {
      const s = clean(raw)
      const m = s.match(/^([A-Z]{4})0([A-Z0-9]{6})$/)
      if (!m) return { ok: false, summary: 'Not a valid IFSC format', notes: ['An IFSC is 11 characters: 4 letters (bank), the digit 0, and 6 letters or digits (branch).'] }
      const bank = BANKS[m[1]]
      return { ok: true, summary: `Valid IFSC format${bank ? `. Bank: ${bank}` : ''}`, rows: [row('Bank code', m[1]), row('Bank', bank || 'Not in the built-in list, use the IFSC finder'), row('Branch code', m[2])], notes: ['Open the IFSC finder to see the branch address and MICR.'], link: { href: `#/ifsc-finder?code=${s}`, text: 'Look up this IFSC' } }
    },
  },
  vehicle: {
    label: 'Vehicle number',
    shape: (s) => /^(\d{2}BH|[A-Z]{2}\d)/.test(s),
    check(raw) {
      const s = clean(raw)
      const bh = s.match(/^(\d{2})BH(\d{4})([A-Z]{2})$/)
      if (bh) {
        const ok = !/[IO]/.test(bh[3])
        return { ok, summary: ok ? 'Valid Bharat (BH) series format' : 'BH series letters never use I or O', rows: [row('Registered in year', `20${bh[1]}`), row('Number', bh[2]), row('Series', bh[3])] }
      }
      const m = s.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/)
      if (!m) return { ok: false, summary: 'Not a valid vehicle number format', notes: ['Format: state code, 1-2 digit RTO number, up to 3 series letters, then up to 4 digits (for example MH12AB1234).'] }
      const st = stateByCode(m[1])
      return { ok: !!st, summary: st ? `Valid format. State: ${st.name}` : `"${m[1]}" is not a state or UT code`, rows: [row('State', st?.name || '-'), row('RTO number', m[2]), row('Series', m[3] || '(none)'), row('Number', m[4])], link: st ? { href: `#/vehicle-registration?plate=${s}`, text: 'Decode the RTO' } : null }
    },
  },
  tan: {
    label: 'TAN',
    shape: (s) => s.length === 10,
    check(raw) {
      const s = clean(raw)
      const ok = /^[A-Z]{4}\d{5}[A-Z]$/.test(s)
      return { ok, summary: ok ? 'Valid TAN format' : 'Not a valid TAN format', rows: ok ? [row('Name letter', s[3]), row('Sequence', s.slice(4, 9))] : undefined, notes: ok ? [] : ['A TAN is 4 letters, 5 digits and 1 letter (for example PDES03028F).'] }
    },
  },
  voter: {
    label: 'Voter ID (EPIC)',
    shape: (s) => /^[A-Z]{3}\d/.test(s) && s.length === 10,
    check(raw) {
      const s = clean(raw)
      const ok = /^[A-Z]{3}\d{7}$/.test(s)
      return { ok, summary: ok ? 'Valid EPIC number format' : 'Not a valid EPIC format', notes: ok ? ['Format only. Search the Election Commission voter portal to confirm.'] : ['An EPIC number is 3 letters followed by 7 digits.'] }
    },
  },
  passport: {
    label: 'Passport',
    shape: (s) => /^[A-Z]\d{7}$/.test(s),
    check(raw) {
      const s = clean(raw)
      const ok = /^[A-PR-WY][1-9]\d{5}[1-9]$/.test(s)
      return { ok, summary: ok ? 'Valid Indian passport number format' : 'Not a valid Indian passport format', notes: ok ? ['Format only.'] : ['One letter (not Q, X or Z), then 7 digits.'] }
    },
  },
  dl: {
    label: 'Driving licence',
    shape: (s) => /^[A-Z]{2}\d{2}/.test(s) && s.length >= 15,
    check(raw) {
      const s = clean(raw)
      const m = s.match(/^([A-Z]{2})(\d{2})((?:19|20)\d{2})(\d{7})$/)
      if (!m) return { ok: false, summary: 'Not a valid licence number format', notes: ['Format: state code, 2-digit RTO code, 4-digit year of issue, 7-digit serial (for example MH1220110062821).'] }
      const st = stateByCode(m[1])
      return { ok: !!st, summary: st ? `Valid format. Issued in ${st.name}, ${m[3]}` : `"${m[1]}" is not a state or UT code`, rows: [row('State', st?.name || '-'), row('RTO code', m[2]), row('Year of issue', m[3]), row('Serial', m[4])] }
    },
  },
  upi: {
    label: 'UPI ID',
    shape: (s) => s.includes('@'),
    check(raw) {
      const s = String(raw).trim()
      const ok = /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}$/.test(s)
      return { ok, summary: ok ? 'Valid UPI ID format' : 'Not a valid UPI ID format', notes: ['A UPI ID looks like name@bank. Only the app can confirm that the account exists.'] }
    },
  },
}

export const ID_TYPES = Object.keys(CHECKERS)

/** Check one value. type 'auto' tries every checker whose shape matches and returns the best one(s). */
export function identify(value, type = 'auto') {
  const v = String(value).trim()
  if (!v) return null
  if (type !== 'auto') return [{ type, ...CHECKERS[type].check(v) }]
  const s = clean(v)
  const hits = ID_TYPES.filter((t) => CHECKERS[t].shape(t === 'upi' ? v : s)).map((t) => ({ type: t, ...CHECKERS[t].check(v) }))
  const good = hits.filter((x) => x.ok)
  if (good.length) return good
  return hits.length ? hits : [{ type: null, ok: false, summary: 'Does not look like a supported ID', notes: [`Got ${s.length} characters. PAN and TAN have 10, GSTIN 15, Aadhaar 12 digits, IFSC 11.`] }]
}
