// Pure calculation helpers shared by the calc-money tools. No DOM access, so every function can be unit tested in Node.

export const isNum = Number.isFinite
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

// ---------- Loans ----------

/** Payment per period for a fully amortising loan. ratePct is the nominal annual rate, ppy the payments per year. */
export function pmt(principal, ratePct, n, ppy = 12) {
  if (!(n > 0)) return NaN
  const r = ratePct / 100 / ppy
  if (r === 0) return principal / n
  const f = Math.pow(1 + r, n)
  return (principal * r * f) / (f - 1)
}

/** Loan amount a given payment can repay over n periods. */
export function loanFromPayment(payment, ratePct, n, ppy = 12) {
  const r = ratePct / 100 / ppy
  if (r === 0) return payment * n
  return (payment * (1 - Math.pow(1 + r, -n))) / r
}

/** Number of (fractional) periods needed to repay principal with a fixed payment. Infinity when the payment never covers the interest. */
export function periodsToPayOff(principal, ratePct, payment, ppy = 12) {
  const r = ratePct / 100 / ppy
  if (r === 0) return principal / payment
  const interest = principal * r
  if (payment <= interest) return Infinity
  return -Math.log(1 - interest / payment) / Math.log(1 + r)
}

/**
 * Amortisation schedule.
 *  payment      fixed payment per period (defaults to the standard EMI for principal/ratePct/n)
 *  extra        extra principal paid every period
 *  lump, lumpAt one-time prepayment of `lump` made together with payment number `lumpAt`
 *  lumpMode     'tenure': keep the payment, finish sooner. 'emi': keep the end date, lower the payment after the lump sum
 * Returns { rows: [{k, payment, interest, principal, prepay, balance}], emi, totalInterest, totalPaid, totalPrepaid, periods, neverPaysOff }
 */
export function amortize({ principal, ratePct, n, ppy = 12, payment, extra = 0, lump = 0, lumpAt = 0, lumpMode = 'tenure', maxPeriods = 1200 }) {
  const r = ratePct / 100 / ppy
  const base = payment ?? pmt(principal, ratePct, n, ppy)
  let pay = base
  let bal = principal
  let totalInterest = 0
  let totalPaid = 0
  let totalPrepaid = 0
  let neverPaysOff = false
  const rows = []
  for (let k = 1; k <= maxPeriods && bal > 0.005; k++) {
    const interest = bal * r
    const due = Math.min(pay, bal + interest)
    const prin = due - interest
    if (prin <= 1e-9 && r > 0) { neverPaysOff = true; break }
    let pre = extra + (k === lumpAt ? lump : 0)
    pre = Math.max(0, Math.min(pre, bal - prin))
    bal = bal - prin - pre
    if (bal < 0.005) bal = 0
    rows.push({ k, payment: due, interest, principal: prin, prepay: pre, balance: bal })
    totalInterest += interest
    totalPaid += due + pre
    totalPrepaid += pre
    if (lumpMode === 'emi' && k === lumpAt && lump > 0 && bal > 0 && n - k > 0) pay = pmt(bal, ratePct, n - k, ppy)
  }
  if (bal > 0.005 && !neverPaysOff) neverPaysOff = true
  return { rows, emi: base, totalInterest, totalPaid, totalPrepaid, periods: rows.length, neverPaysOff }
}

/** Group schedule rows into loan years (or `perYear` periods each). */
export function yearly(rows, perYear = 12) {
  const out = []
  for (const r of rows) {
    const y = Math.ceil(r.k / perYear)
    const o = out[y - 1] || (out[y - 1] = { year: y, payment: 0, interest: 0, principal: 0, prepay: 0, balance: 0 })
    o.payment += r.payment
    o.interest += r.interest
    o.principal += r.principal
    o.prepay += r.prepay
    o.balance = r.balance
  }
  return out
}

/** Annualised cost (APR, nominal) of a loan when `fee` is deducted up front. Solves for the periodic rate by bisection. */
export function effectiveApr(principal, fee, payment, n, ppy = 12) {
  const net = principal - fee
  if (!(net > 0) || !(payment > 0) || !(n > 0)) return NaN
  const value = (r) => (r === 0 ? payment * n : (payment * (1 - Math.pow(1 + r, -n))) / r)
  if (value(0) < net) return NaN
  let lo = 0
  let hi = 1
  while (value(hi) > net && hi < 1e3) hi *= 2
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (value(mid) > net) lo = mid
    else hi = mid
  }
  return ((lo + hi) / 2) * ppy * 100
}

// ---------- Interest ----------

export const FREQUENCIES = { daily: 365, weekly: 52, monthly: 12, quarterly: 4, half: 2, yearly: 1, continuous: Infinity }

/** Growth factor of 1 unit over `years` at nominal rate ratePct compounded m times a year (Infinity = continuous). */
export function growth(ratePct, m, years) {
  const r = ratePct / 100
  return m === Infinity ? Math.exp(r * years) : Math.pow(1 + r / m, m * years)
}

export const simpleInterest = (principal, ratePct, years) => (principal * ratePct * years) / 100

/**
 * Compound growth with optional regular contributions, simulated month by month.
 * contrib is added every `every` months (1 = monthly, 3 = quarterly, 12 = yearly), at the end (default) or the start of that period.
 * Returns { balance, invested, interest, ear, rows: [{year, deposits, interest, balance}] } with one row per started year.
 */
export function compound({ principal, ratePct, years, m = 12, contrib = 0, every = 1, atStart = false }) {
  const totalMonths = years * 12
  const gm = growth(ratePct, m, 1 / 12)
  const rows = []
  let bal = principal
  let deposits = principal
  let yearStartBal = principal
  let yearStartDeposits = principal
  const steps = Math.ceil(totalMonths - 1e-9)
  for (let i = 1; i <= steps; i++) {
    const dt = i === steps ? totalMonths - (steps - 1) : 1
    const f = dt === 1 ? gm : growth(ratePct, m, dt / 12)
    const due = contrib > 0 && (i - 1) % every === (atStart ? 0 : every - 1)
    if (due && atStart) { bal += contrib; deposits += contrib }
    bal *= f
    if (due && !atStart) { bal += contrib; deposits += contrib }
    if (i % 12 === 0 || i === steps) {
      rows.push({ year: Math.ceil(i / 12), deposits: deposits - yearStartDeposits, interest: bal - yearStartBal - (deposits - yearStartDeposits), balance: bal, invested: deposits })
      yearStartBal = bal
      yearStartDeposits = deposits
    }
  }
  const interest = bal - deposits
  const ear = m === Infinity ? Math.exp(ratePct / 100) - 1 : Math.pow(1 + ratePct / 100 / m, m) - 1
  return { balance: bal, invested: deposits, interest, ear: ear * 100, rows }
}

// ---------- Returns ----------

export const DAY_MS = 86_400_000
/** Years between two dates (days / 365.25). */
export const yearsBetween = (a, b) => (b - a) / DAY_MS / 365.25
export const cagr = (start, end, years) => (start > 0 && end > 0 && years > 0 ? (Math.pow(end / start, 1 / years) - 1) * 100 : NaN)
export const roi = (cost, value) => (cost > 0 ? ((value - cost) / cost) * 100 : NaN)

// ---------- Prices ----------

/** Apply a list of percent discounts one after another. Returns the price after each step. */
export function stackDiscounts(price, discounts) {
  const steps = []
  let p = price
  for (const d of discounts) {
    const off = (p * d) / 100
    p -= off
    steps.push({ pct: d, off, price: p })
  }
  return steps
}

/** Margin, markup, cost, price and profit from any two known values. known is { cost?, price?, profit?, margin?, markup? } (percents as plain numbers). */
export function pricing(known) {
  let { cost, price, profit, margin, markup } = known
  const has = (v) => Number.isFinite(v)
  for (let pass = 0; pass < 3; pass++) {
    if (!has(profit) && has(price) && has(cost)) profit = price - cost
    if (!has(price) && has(cost) && has(profit)) price = cost + profit
    if (!has(cost) && has(price) && has(profit)) cost = price - profit
    if (!has(margin) && has(profit) && has(price) && price !== 0) margin = (profit / price) * 100
    if (!has(markup) && has(profit) && has(cost) && cost !== 0) markup = (profit / cost) * 100
    if (!has(profit) && has(margin) && has(price)) profit = (price * margin) / 100
    if (!has(profit) && has(markup) && has(cost)) profit = (cost * markup) / 100
    if (!has(price) && has(margin) && has(cost) && margin < 100) price = cost / (1 - margin / 100)
    if (!has(cost) && has(margin) && has(price)) cost = price * (1 - margin / 100)
    if (!has(price) && has(markup) && has(cost)) price = cost * (1 + markup / 100)
    if (!has(cost) && has(markup) && has(price)) cost = price / (1 + markup / 100)
    if (!has(price) && has(profit) && has(margin) && margin !== 0) price = (profit * 100) / margin
    if (!has(cost) && has(profit) && has(markup) && markup !== 0) cost = (profit * 100) / markup
    if (!has(margin) && has(markup) && markup > -100) margin = (markup / (100 + markup)) * 100
    if (!has(markup) && has(margin) && margin < 100) markup = (margin / (100 - margin)) * 100
  }
  return { cost, price, profit, margin, markup }
}

// ---------- India: income tax (new regime) and payroll ----------

export const NEW_REGIME = {
  label: 'FY 2026-27 (AY 2027-28), new regime',
  standardDeduction: 75_000,
  rebateLimit: 1_200_000,
  rebateMax: 60_000,
  cess: 0.04,
  slabs: [[400_000, 0], [800_000, 0.05], [1_200_000, 0.1], [1_600_000, 0.15], [2_000_000, 0.2], [2_400_000, 0.25], [Infinity, 0.3]],
}

/** Tax on taxable income by slab, before rebate, surcharge and cess. */
export function slabTax(taxable) {
  let tax = 0
  let prev = 0
  for (const [upTo, rate] of NEW_REGIME.slabs) {
    if (taxable > prev) tax += (Math.min(taxable, upTo) - prev) * rate
    prev = upTo
    if (taxable <= upTo) break
  }
  return tax
}

function taxWithSurcharge(income) {
  const { rebateLimit, rebateMax } = NEW_REGIME
  let tax = slabTax(income)
  if (income <= rebateLimit) tax -= Math.min(tax, rebateMax)
  else tax = Math.min(tax, income - rebateLimit) // marginal relief just above the rebate limit
  const rate = income > 20_000_000 ? 0.25 : income > 10_000_000 ? 0.15 : income > 5_000_000 ? 0.1 : 0
  let total = tax * (1 + rate)
  if (rate) {
    const th = income > 20_000_000 ? 20_000_000 : income > 10_000_000 ? 10_000_000 : 5_000_000
    total = Math.min(total, taxWithSurcharge(th) + (income - th)) // marginal relief on surcharge
  }
  return total
}

/** Income tax under the new regime for a given taxable income (after the standard deduction). Includes 87A rebate, surcharge and 4% cess. */
export function newRegimeTax(taxable) {
  if (!(taxable > 0)) return { slab: 0, rebate: 0, surcharge: 0, cess: 0, total: 0 }
  const slab = slabTax(taxable)
  const before = taxWithSurcharge(taxable)
  const afterRebate = taxable <= NEW_REGIME.rebateLimit ? slab - Math.min(slab, NEW_REGIME.rebateMax) : Math.min(slab, taxable - NEW_REGIME.rebateLimit)
  const rebate = slab - afterRebate
  const surcharge = Math.max(0, before - afterRebate)
  const cess = before * NEW_REGIME.cess
  return { slab, rebate, surcharge, cess, total: before + cess }
}

/** Professional tax per year for a monthly gross salary. Approximate: state rules change, so the tool labels it an estimate. */
export const PT_STATES = {
  none: { label: 'No professional tax (Delhi, Haryana, UP, Rajasthan and others)', annual: () => 0 },
  mh: { label: 'Maharashtra', annual: (m) => (m <= 7500 ? 0 : m <= 10000 ? 175 * 12 : 200 * 11 + 300) },
  ka: { label: 'Karnataka', annual: (m) => (m < 25000 ? 0 : 200 * 11 + 300) },
  tn: { label: 'Tamil Nadu (Chennai slabs)', annual: (m) => { const h = m * 6; return 2 * (h <= 21000 ? 0 : h <= 30000 ? 180 : h <= 45000 ? 425 : h <= 60000 ? 930 : h <= 75000 ? 1025 : 1250) } },
  wb: { label: 'West Bengal', annual: (m) => 12 * (m <= 10000 ? 0 : m <= 15000 ? 110 : m <= 25000 ? 130 : m <= 40000 ? 150 : 200) },
  gj: { label: 'Gujarat', annual: (m) => (m <= 12000 ? 0 : 200 * 12) },
  ts: { label: 'Telangana', annual: (m) => 12 * (m <= 15000 ? 0 : m <= 20000 ? 150 : 200) },
  ap: { label: 'Andhra Pradesh', annual: (m) => 12 * (m <= 15000 ? 0 : m <= 20000 ? 150 : 200) },
}

/**
 * Indian CTC to in-hand estimate (new tax regime).
 *  basicPct        basic as % of CTC; hraPct HRA as % of basic
 *  pfCap           true: employee/employer PF on a wage capped at 15,000 a month (1,800); false: 12% of basic
 *  gratuity        include gratuity (15/26 of a month's basic per year, about 4.81% of basic) inside CTC
 *  insurance       employer-paid health insurance per year (part of CTC, not paid to you)
 *  ptAnnual        professional tax per year (computed by the caller from monthly gross)
 */
export function ctcBreakup({ ctc, basicPct = 40, hraPct = 50, pfCap = true, employerPf = true, gratuity = true, insurance = 0, ptState = 'none', ptCustom = 0 }) {
  const basic = (ctc * basicPct) / 100
  const hra = (basic * hraPct) / 100
  const pfBase = pfCap ? Math.min(basic / 12, 15000) * 12 : basic
  const pf = employerPf ? pfBase * 0.12 : 0
  const grat = gratuity ? (basic * 15) / 26 / 12 : 0
  const gross = ctc - pf - grat - insurance
  const special = gross - basic - hra
  const empPf = employerPf ? pfBase * 0.12 : 0
  const ptAnnual = ptState === 'custom' ? ptCustom : (PT_STATES[ptState] || PT_STATES.none).annual(gross / 12)
  const taxable = Math.max(0, gross - NEW_REGIME.standardDeduction)
  const tax = newRegimeTax(taxable)
  const net = gross - empPf - ptAnnual - tax.total
  return { ctc, basic, hra, special, employerPf: pf, gratuity: grat, insurance, gross, employeePf: empPf, professionalTax: ptAnnual, taxable, tax, net, negativeSpecial: special < 0 }
}

// ---------- Electricity ----------

/** Progressive slab bill. slabs: [{upTo: units or Infinity, rate}] in ascending order. Returns the energy charge and a per-slab breakdown. */
export function slabBill(units, slabs) {
  let left = units
  let prev = 0
  let energy = 0
  const parts = []
  for (const s of slabs) {
    if (left <= 0) break
    const span = Math.min(left, s.upTo - prev)
    if (span > 0) {
      parts.push({ from: prev, to: prev + span, units: span, rate: s.rate, cost: span * s.rate })
      energy += span * s.rate
      left -= span
    }
    prev = s.upTo
  }
  return { energy, parts }
}

// ---------- Fuel ----------

export const MILE_KM = 1.609344
export const US_GALLON_L = 3.785411784
export const UK_GALLON_L = 4.54609
/** Distance units: km and miles, converted to km. */
export const toKm = (distance, unit) => (unit === 'mi' ? distance * MILE_KM : distance)
/** Efficiency units converted to kilometres per litre: 'kml' (km/l), 'l100' (litres per 100 km), 'mpg' (US), 'mpguk' (imperial). */
export function kmPerLitre(value, unit) {
  if (unit === 'l100') return 100 / value
  if (unit === 'mpg') return (value * MILE_KM) / US_GALLON_L
  if (unit === 'mpguk') return (value * MILE_KM) / UK_GALLON_L
  return value
}
/** Litres in one price unit: price is quoted per litre, per US gallon or per UK gallon. */
export const priceUnitLitres = (unit) => (unit === 'mpg' ? US_GALLON_L : unit === 'mpguk' ? UK_GALLON_L : 1)
/** Fuel needed (litres) and cost for a distance. pricePerUnit is per litre, US gallon or UK gallon matching the efficiency unit. */
export function fuelTrip({ distance, distanceUnit = 'km', efficiency, efficiencyUnit = 'kml', pricePerUnit, roundTrip = false }) {
  const km = toKm(distance, distanceUnit) * (roundTrip ? 2 : 1)
  const kpl = kmPerLitre(efficiency, efficiencyUnit)
  const litres = km / kpl
  const cost = (litres / priceUnitLitres(efficiencyUnit)) * pricePerUnit
  return { km, litres, cost, perKm: km > 0 ? cost / km : 0 }
}
