// Gratuity calculator: 15/26 x last drawn wages x years of service, the 6-month rounding rule, the Rs 20 lakh limit and the tax split.
import { h, card, split, stack, segmented, toggle, alert, input, field, clear } from '../../lib/ui.js'
import { inr, lakhCrore, gratuity, serviceBetween, GRATUITY_CAP } from './_calc.js'
import { useStyles, liveHero, statTiles, numField, selectField, hero, kv, note, link } from './_shared.js'

const today = () => new Date().toISOString().slice(0, 10)

export function mount(root) {
  useStyles()
  const wage = numField('Last drawn basic + DA (₹ a month)', 50000, { min: 1000, max: 10_000_000, step: 1000, money: true })
  const years = numField('Years of service', 8, { min: 0, max: 60, step: 1, integer: true })
  const months = numField('Extra months', 7, { min: 0, max: 11, step: 1, integer: true })
  const from = input({ type: 'date', 'aria-label': 'Date of joining', value: '2016-06-01' })
  const to = input({ type: 'date', 'aria-label': 'Last working day', value: today() })
  const how = segmented([['ym', 'Years and months'], ['dates', 'Dates']], 'ym', () => sync(), 'How to enter service')
  const kind = selectField('Employment', [['perm', 'Permanent employee'], ['fixed', 'Fixed-term contract'], ['death', 'Death or disablement']], 'perm', () => render())
  const sector = selectField('Employer', [['private', 'Private company, PSU or other'], ['govt', 'Central or state government']], 'private', () => render())
  const covered = toggle('Covered by the Payment of Gratuity Act (10 or more employees)', true, () => render())
  const code = toggle('Apply the labour code wage rule (wages at least 50% of pay)', false, () => { codeBox.hidden = !code.input.checked; render() })
  const gross = numField('Total monthly pay (₹)', 90000, { min: 1000, max: 10_000_000, step: 1000, money: true, hint: 'Basic + DA + allowances, before deductions' })
  const received = numField('Gratuity your employer pays (₹, optional)', '', { min: 0, max: 1e10, step: 1000, money: true, hint: 'Fill in to split it into tax-free and taxable' })
  const codeBox = h('div', { hidden: true }, gross.el)
  const ymBox = h('div', { class: 'grid-2' }, years.el, months.el)
  const dateBox = h('div', { class: 'grid-2', hidden: true }, field('Date of joining', from), field('Last working day', to))
  const top = hero('Gratuity'), tiles = h('div'), calc = h('div'), msg = h('div')

  function sync() {
    ymBox.hidden = how.value !== 'ym'
    dateBox.hidden = how.value !== 'dates'
    render()
  }

  function render() {
    let svc
    if (how.value === 'ym') {
      const bad = years.issue() || months.issue()
      if (bad) { clear(msg, alert('info', bad)); return top.set('Gratuity', '-', bad) }
      svc = { years: years.get(), months: months.get(), days: 0 }
    } else {
      if (!from.value || !to.value || to.value < from.value) { clear(msg, alert('info', 'Enter a joining date before the last working day')); return top.set('Gratuity', '-', 'Check the dates') }
      svc = serviceBetween(from.value, to.value)
    }
    if (wage.issue()) { clear(msg, alert('info', wage.issue())); return top.set('Gratuity', '-', wage.issue()) }
    if (code.input.checked && gross.issue()) { clear(msg, alert('info', gross.issue())); return top.set('Gratuity', '-', gross.issue()) }
    const base = wage.get()
    const w = code.input.checked ? Math.max(base, 0.5 * gross.get()) : base
    const isGovt = sector.get() === 'govt'
    const g = gratuity({ wage: w, years: svc.years, months: svc.months, days: svc.days, covered: covered.input.checked, govt: isGovt, received: Number.isFinite(received.get()) ? received.get() : undefined })
    const totalYears = svc.years + svc.months / 12
    const k = kind.get()
    const eligible = k === 'death' || (k === 'fixed' ? totalYears >= 1 : totalYears >= 5)
    const msgs = []
    if (!eligible) msgs.push(alert('warn', h('strong', 'Usually not payable yet. '), k === 'fixed' ? 'Fixed-term employees qualify after one year of continuous service under the labour codes.' : 'Permanent employees qualify after 5 years of continuous service (courts have accepted 4 years and 240 days in some cases; check with your HR). There is no minimum for death or disablement.'))
    if (code.input.checked && w > base) msgs.push(alert('info', `Wage rule applied: wages are counted as ${inr(w)} (50% of total pay) instead of ${inr(base)}.`))
    clear(msg, msgs)
    const payable = isGovt ? g.formula : g.payable
    top.set(eligible ? 'Gratuity payable' : 'Gratuity if eligible', inr(payable), `${lakhCrore(payable)}. Service counted as ${g.rounded} years${covered.input.checked ? ` (${svc.years} yr ${svc.months} mo${svc.days ? ` ${svc.days} d` : ''} rounded${g.rounded > svc.years ? ' up' : ''})` : ' (completed years only)'}.`, !eligible)
    clear(tiles, statTiles([
      { label: 'By the formula', value: inr(g.formula), hint: covered.input.checked ? '15/26 x wages x years' : '15/30 x wages x years' },
      { label: 'Tax-free part', value: inr(g.exempt), accent: true, hint: isGovt ? 'No limit for government staff' : `Up to ${inr(GRATUITY_CAP)}` },
      { label: 'Taxable part', value: inr(g.taxable), hint: Number.isFinite(received.get()) ? 'on what you receive' : 'enter the amount you receive' },
      { label: 'Per year of service', value: inr(covered.input.checked ? (w * 15) / 26 : (w * 15) / 30) },
    ]))
    clear(calc, kv([
      { label: 'Last drawn wages (a month)', value: inr(w) },
      { label: covered.input.checked ? 'Wages x 15 / 26 (one year)' : 'Wages x 15 / 30 (one year)', value: inr(covered.input.checked ? (w * 15) / 26 : (w * 15) / 30), note: covered.input.checked ? 'A month is taken as 26 working days' : 'A month is taken as 30 days' },
      { label: 'x Years counted', value: String(covered.input.checked ? g.rounded : svc.years) },
      { label: 'Gratuity by formula', value: inr(g.formula), strong: true },
      ...(g.capped && !isGovt ? [{ label: `Statutory limit of ${inr(GRATUITY_CAP)} applies`, value: inr(g.payable), strong: true }] : []),
    ]))
  }
  for (const x of [wage, years, months, gross, received]) x.input.addEventListener('input', render)
  from.addEventListener('input', render)
  to.addEventListener('input', render)
  liveHero(top)
  sync()

  root.append(split(
    card('Your service', h('div', { class: 'stack' }, wage.el, how, ymBox, dateBox, h('div', { class: 'grid-2' }, kind.el, sector.el), covered, code, codeBox, received.el, msg,
      note('Gratuity is 15 days of wages for each year of service. Under the Payment of Gratuity Act the amount you can be paid is limited to ₹20 lakh, and the same limit applies to the tax exemption for private employees. The four labour codes took effect on 21 November 2025 and widen "wages" to at least half of total pay; how that is applied is still being settled, so confirm with your HR. Sources: ', link('https://labour.gov.in/', 'Ministry of Labour'), ', ', link('https://www.incometax.gov.in/', 'incometax.gov.in'), '.'))),
    stack(top, tiles, calc), 'wide-left'))
}
