// Pure calculation logic for the India money tools. No DOM here, so every function is easy to test.
// Rules sources: incometax.gov.in (Income-tax Act 2025, in force from 1 April 2026; Budget 2026 kept the slabs), EPFO (CBT rate for 2025-26),
// India Post / Finance Ministry quarterly small savings notification (PPF), Payment of Gratuity Act and the Code on Social Security 2020.

// ---------- Formatting ----------

const trim = (n) => String(Math.round(n * 100) / 100)

/** Indian grouping with the rupee sign: inr(1234567) -> "₹12,34,567". */
export const inr = (n, d = 0) => (Number.isFinite(n)
  ? (n < 0 ? '-' : '') + '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })
  : '-')

/** "12.5 lakh", "3.2 crore" (empty below 1,000). */
export function lakhCrore(n) {
  const a = Math.abs(n)
  if (!Number.isFinite(a)) return ''
  const s = n < 0 ? '-' : ''
  if (a >= 1e7) return `${s}${trim(a / 1e7)} crore`
  if (a >= 1e5) return `${s}${trim(a / 1e5)} lakh`
  if (a >= 1e3) return `${s}${trim(a / 1e3)} thousand`
  return ''
}

/** Compact label for chart axes: ₹50K, ₹12.5L, ₹3.2Cr. */
export function inrShort(n) {
  const a = Math.abs(n)
  if (a >= 1e7) return `₹${trim(a / 1e7)}Cr`
  if (a >= 1e5) return `₹${trim(a / 1e5)}L`
  if (a >= 1e3) return `₹${trim(a / 1e3)}K`
  return `₹${Math.round(a)}`
}

export const pct = (n, d = 2) => (Number.isFinite(n) ? `${n.toLocaleString('en-IN', { maximumFractionDigits: d })}%` : '-')

// ---------- HRA ----------

/** Cities that get the 50% of salary limit. The four metros always; Bengaluru, Hyderabad, Pune and Ahmedabad from FY 2026-27 (Income-tax Rules 2026). */
export const HRA_METROS = ['Delhi', 'Mumbai', 'Kolkata', 'Chennai']
export const HRA_NEW_METROS = ['Bengaluru', 'Hyderabad', 'Pune', 'Ahmedabad']
export const hraRate = (city, fy) => (HRA_METROS.includes(city) || (fy >= '2026-27' && HRA_NEW_METROS.includes(city)) ? 50 : 40)

/** Section 10(13A) rule (old regime): the least of actual HRA, rent paid minus 10% of salary, and 50% / 40% of salary. All values annual. */
export function hraExemption({ salary, hra, rent, ratePct }) {
  const actual = Math.max(0, hra)
  const rentExcess = Math.max(0, rent - 0.1 * salary)
  const cityLimit = (ratePct / 100) * salary
  const exempt = Math.min(actual, rentExcess, cityLimit)
  const rule = exempt === actual ? 'actual' : exempt === rentExcess ? 'rent' : 'city'
  return { actual, rentExcess, cityLimit, exempt, taxable: Math.max(0, hra - exempt), rule }
}

// ---------- Income tax ----------

export const TAX_YEARS = {
  '2026-27': { label: 'FY 2026-27 (Tax Year 2026-27)', ay: 'AY 2027-28' },
  '2025-26': { label: 'FY 2025-26 (AY 2026-27)', ay: 'AY 2026-27' },
}
// Budget 2026 left the slabs, standard deduction and rebate unchanged, so both years share them. Keep the table keyed by year so a later change is one edit.
const NEW_REGIME = {
  slabs: [[400000, 0], [800000, 0.05], [1200000, 0.1], [1600000, 0.15], [2000000, 0.2], [2400000, 0.25], [Infinity, 0.3]],
  std: 75000, rebateLimit: 1200000, rebateMax: 60000, surchargeCap: 0.25, npsEmployerPct: 14,
}
const OLD_REGIME = {
  slabs: {
    under60: [[250000, 0], [500000, 0.05], [1000000, 0.2], [Infinity, 0.3]],
    senior: [[300000, 0], [500000, 0.05], [1000000, 0.2], [Infinity, 0.3]],
    super: [[500000, 0], [1000000, 0.2], [Infinity, 0.3]],
  },
  std: 50000, rebateLimit: 500000, rebateMax: 12500, npsEmployerPct: 10,
}
const SURCHARGE = [[5000000, 0.1], [10000000, 0.15], [20000000, 0.25], [50000000, 0.37]]
export const RULES = { newRegime: NEW_REGIME, oldRegime: OLD_REGIME }

export function slabTax(income, slabs) {
  let prev = 0, tax = 0
  const rows = []
  for (const [upto, rate] of slabs) {
    if (income <= prev) break
    const amount = Math.min(income, upto) - prev
    rows.push({ from: prev, to: upto, rate, amount, tax: amount * rate })
    tax += amount * rate
    prev = upto
  }
  return { tax, rows }
}

const round10 = (n) => Math.round(n / 10) * 10

/** Surcharge with marginal relief. taxFn(income) gives the tax before surcharge for any income. Returns the surcharge amount only. */
export function surchargeOn(income, tax, taxFn, cap = Infinity) {
  let rate = 0, threshold = 0, below = 0
  for (const [t, r] of SURCHARGE) {
    if (income > t) { below = rate; rate = Math.min(r, cap); threshold = t }
  }
  if (!rate) return 0
  const full = tax * (1 + rate)
  const relief = taxFn(threshold) * (1 + below) + (income - threshold)
  return Math.max(0, Math.min(full, relief) - tax)
}

/**
 * One regime, one year. Everything is annual rupees.
 * in: {fy, age: 'under60'|'senior'|'super', salary, other, salaried, basic, hra (exempt amount), lta, profTax, employerNps, govt,
 *      c80, d80self, d80parents, parentsSenior, nps1b, homeLoan, e80, otherDed}
 * -> {regime, lines: [{label, value, note, strong}], slabs, taxable, taxBefore, rebate, relief, surcharge, cess, total, monthly, effective}
 */
export function computeRegime(regime, i) {
  const isNew = regime === 'new'
  const R = isNew ? NEW_REGIME : OLD_REGIME
  const salary = num(i.salary), other = num(i.other)
  const lines = []
  const add = (label, value, extra = {}) => lines.push({ label, value, ...extra })
  add('Salary income', salary)
  const std = i.salaried ? Math.min(R.std, salary) : 0
  if (std) add('Standard deduction', -std, { note: isNew ? 'Salaried and pensioners' : 'Salaried and pensioners' })
  let afterSalary = salary - std
  if (!isNew) {
    const hra = Math.min(num(i.hra), afterSalary)
    const lta = Math.min(num(i.lta), afterSalary - hra)
    const pt = Math.min(num(i.profTax), 2500, afterSalary - hra - lta)
    if (hra) add('HRA exemption', -hra, { note: 'Section 10(13A)' })
    if (lta) add('LTA exemption', -lta, { note: 'Actual travel cost, two journeys in four years' })
    if (pt) add('Professional tax', -pt)
    afterSalary -= hra + lta + pt
  }
  if (other) add('Income from other sources', other, { note: 'Interest, rent after 30%, business profit' })
  let gross = afterSalary + other
  if (!isNew) {
    const loan = Math.min(num(i.homeLoan), 200000, Math.max(0, gross))
    if (loan) add('Home loan interest (self-occupied)', -loan, { note: 'Capped at ₹2,00,000' })
    gross -= loan
  }
  add('Gross total income', Math.max(0, gross), { strong: true })

  const ded = []
  const npsCap = ((i.govt ? 14 : R.npsEmployerPct) / 100) * num(i.basic)
  const nps2 = Math.min(num(i.employerNps), npsCap)
  if (nps2) ded.push(['Employer NPS, 80CCD(2)', nps2, `Up to ${i.govt ? 14 : R.npsEmployerPct}% of basic + DA`])
  if (!isNew) {
    const c80 = Math.min(num(i.c80), 150000)
    if (c80) ded.push(['80C (PF, ELSS, LIC, PPF ...)', c80, 'Capped at ₹1,50,000'])
    const nps1b = Math.min(num(i.nps1b), 50000)
    if (nps1b) ded.push(['NPS self, 80CCD(1B)', nps1b, 'Capped at ₹50,000'])
    const selfCap = i.age === 'under60' ? 25000 : 50000
    const d1 = Math.min(num(i.d80self), selfCap), d2 = Math.min(num(i.d80parents), i.parentsSenior ? 50000 : 25000)
    if (d1 + d2) ded.push(['Health insurance, 80D', d1 + d2, `Self up to ₹${selfCap.toLocaleString('en-IN')}, parents up to ₹${i.parentsSenior ? '50,000' : '25,000'}`])
    const e80 = num(i.e80)
    if (e80) ded.push(['Education loan interest, 80E', e80, 'No upper limit, 8 years'])
    const od = num(i.otherDed)
    if (od) ded.push(['Other Chapter VI-A deductions', od, '80TTA/80TTB, 80G, 80U ...'])
  }
  let dedTotal = 0
  for (const [label, value, note] of ded) { add(label, -value, { note }); dedTotal += value }
  const taxable = round10(Math.max(0, gross - dedTotal))
  add('Taxable income', taxable, { strong: true })

  const slabs = isNew ? R.slabs : R.slabs[i.age] || R.slabs.under60
  const taxFn = (inc) => slabTax(inc, slabs).tax
  const { tax: taxBefore, rows } = slabTax(taxable, slabs)
  let tax = taxBefore, rebate = 0, relief = 0
  if (taxable <= R.rebateLimit) {
    rebate = Math.min(tax, R.rebateMax)
    tax -= rebate
  } else if (isNew) {
    const excess = taxable - R.rebateLimit
    if (tax > excess) { relief = tax - excess; tax = excess }
  }
  const surcharge = surchargeOn(taxable, tax, taxFn, isNew ? R.surchargeCap : Infinity)
  const cess = (tax + surcharge) * 0.04
  const total = round10(tax + surcharge + cess)
  return {
    regime, lines, slabs: rows, taxable, taxBefore, rebate, relief, surcharge, cess, total,
    monthly: total / 12, effective: gross > 0 ? (total / gross) * 100 : 0,
  }
}
const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0)

// ---------- EPF ----------

export const EPF_RATE = 8.25 // CBT decision for 2025-26 (March 2026), ratified by the government in June 2026
export const EPF_WAGE_CEILING = 15000

/**
 * Project the EPF balance. basic is monthly basic + DA. Interest is worked out monthly on the running balance and added once a year, as EPFO does.
 * -> {rows, balance, employee, employer, interest, eps, months, pension}
 */
export function epfProject({ age, retireAge, basic, balance = 0, employeePct = 12, vpfPct = 0, growth = 0, rate = EPF_RATE, onCeiling = false, ceiling = EPF_WAGE_CEILING }) {
  const years = Math.max(0, Math.floor(retireAge - age))
  let bal = balance, tEmp = 0, tEr = 0, tInt = 0, tEps = 0, last = basic
  const rows = []
  for (let y = 1; y <= years; y++) {
    const b = basic * (1 + growth / 100) ** (y - 1)
    last = b
    const wage = onCeiling ? Math.min(b, ceiling) : b
    const emp = ((employeePct + vpfPct) / 100) * wage
    const eps = 0.0833 * Math.min(wage, ceiling)
    const erEpf = Math.max(0, 0.12 * wage - eps)
    let interest = 0
    const open = bal
    for (let m = 0; m < 12; m++) {
      bal += emp + erEpf
      interest += (bal * rate) / 1200
    }
    bal += interest
    tEmp += emp * 12; tEr += erEpf * 12; tInt += interest; tEps += eps * 12
    rows.push({ year: y, age: age + y, basic: b, employee: emp * 12, employer: erEpf * 12, eps: eps * 12, interest, open, close: bal, cumEmployee: tEmp + balance, cumEmployer: tEr, cumInterest: tInt })
  }
  const pension = years >= 10 ? (Math.min(last, ceiling) * years) / 70 : 0
  return { rows, balance: bal, employee: tEmp, employer: tEr, interest: tInt, eps: tEps, years, pension, opening: balance }
}

// ---------- Gratuity ----------

export const GRATUITY_CAP = 2000000

/** Service rounding for covered employees: a part year of more than six months counts as a full year. */
export function roundService(years, months, days = 0) {
  return years + (months > 6 || (months === 6 && days > 0) ? 1 : 0)
}

export function gratuity({ wage, years, months = 0, days = 0, covered = true, govt = false, received }) {
  const rounded = roundService(years, months, days)
  const formula = covered ? (wage * 15 * rounded) / 26 : (wage * 15 * years) / 30
  const payable = Math.min(formula, GRATUITY_CAP)
  const actual = received != null && Number.isFinite(received) ? received : formula
  const exempt = govt ? actual : Math.min(GRATUITY_CAP, actual, formula)
  return { rounded, formula, payable, actual, exempt, taxable: Math.max(0, actual - exempt), capped: formula > GRATUITY_CAP }
}

/** Whole years, months and days between two dates (end inclusive of the last working day). */
export function serviceBetween(from, to) {
  const a = new Date(from), b = new Date(to)
  b.setDate(b.getDate() + 1)
  let y = b.getFullYear() - a.getFullYear(), m = b.getMonth() - a.getMonth(), d = b.getDate() - a.getDate()
  if (d < 0) { m -= 1; d += new Date(b.getFullYear(), b.getMonth(), 0).getDate() }
  if (m < 0) { y -= 1; m += 12 }
  return { years: y, months: m, days: d }
}

// ---------- SIP ----------

/** Monthly SIP with an optional yearly step-up. Rate is the nominal annual rate; each month earns rate/12 and the SIP goes in at the start of the month. */
export function sipProject({ monthly, rate, years, step = 0, lump = 0, inflation = 0 }) {
  const i = rate / 1200
  let bal = lump, invested = lump
  const rows = []
  for (let y = 1; y <= years; y++) {
    const sip = monthly * (1 + step / 100) ** (y - 1)
    for (let m = 0; m < 12; m++) { bal = (bal + sip) * (1 + i); invested += sip }
    rows.push({ year: y, sip, invested, value: bal, gains: bal - invested })
  }
  return { rows, invested, value: bal, gains: bal - invested, real: inflation ? bal / (1 + inflation / 100) ** years : bal }
}

// ---------- FD and RD ----------

/** comp = compounding periods per year (4 = quarterly); 0 = simple interest paid at maturity. */
export function fdMaturity(principal, rate, months, comp = 4) {
  const t = months / 12
  return comp > 0 ? principal * (1 + rate / 100 / comp) ** (comp * t) : principal * (1 + (rate / 100) * t)
}

/** Interest paid out every `every` months (1, 3, 6, 12) on the principal, which comes back at the end. */
export function fdPayout(principal, rate, months, every) {
  const per = (principal * rate) / 100 / (12 / every)
  const n = months / every
  return { per, count: n, total: per * n }
}

export function fdYearly(principal, rate, months, comp) {
  const rows = []
  let prev = principal
  for (let m = 12; m < months + 12; m += 12) {
    const upto = Math.min(m, months)
    const v = fdMaturity(principal, rate, upto, comp)
    rows.push({ year: rows.length + 1, months: upto, open: prev, interest: v - prev, close: v })
    prev = v
    if (upto >= months) break
  }
  return rows
}

/** Recurring deposit, quarterly compounding: each instalment (start of month) grows for its remaining months. */
export function rdMaturity(monthly, rate, months) {
  const q = 1 + rate / 400
  let total = 0
  for (let k = 1; k <= months; k++) total += monthly * q ** ((months - k + 1) / 3)
  return total
}

export function rdYearly(monthly, rate, months) {
  const rows = []
  for (let m = 12; m < months + 12; m += 12) {
    const upto = Math.min(m, months)
    const v = rdMaturity(monthly, rate, upto)
    rows.push({ year: rows.length + 1, deposited: monthly * upto, value: v, interest: v - monthly * upto })
    if (upto >= months) break
  }
  return rows
}

// ---------- PPF ----------

export const PPF_RATE = 7.1 // Oct-Dec 2026 quarter, unchanged for several quarters
export const PPF_MAX = 150000
export const PPF_MIN = 500

/**
 * mode: 'lump' (whole year's deposit by 5 April), 'monthly' (1/12th by the 5th of each month), 'end' (all on 31 March).
 * ext: extension blocks of 5 years after year 15; extContribute: keep depositing during them.
 */
export function ppfProject({ yearly, rate, mode = 'lump', years = 15, extension = 0, extContribute = true }) {
  const total = years + extension * 5
  let bal = 0, dep = 0, tInt = 0
  const rows = []
  for (let y = 1; y <= total; y++) {
    const pays = y <= years || extContribute
    const d = pays ? Math.min(Math.max(yearly, 0), PPF_MAX) : 0
    const open = bal
    let interest = 0
    if (mode === 'lump') { bal += d; interest = (bal * rate) / 100 }
    else if (mode === 'end') { interest = (bal * rate) / 100; bal += d }
    else for (let m = 0; m < 12; m++) { bal += d / 12; interest += (bal * rate) / 1200 }
    bal += interest
    dep += d; tInt += interest
    rows.push({ year: y, open, deposit: d, interest, close: bal, invested: dep, gains: tInt })
  }
  return { rows, balance: bal, invested: dep, interest: tInt }
}
