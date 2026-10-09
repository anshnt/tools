// Health calculators (params.kind): BMI (WHO and Asian cut-offs), calories (Mifflin-St Jeor BMR, activity, goals, macros) and
// daily water intake with a small tracker. Body details are shared between the three, so you type them once.
import { h, icon, button, input, field, select, segmented, toggle, toast, clear } from '../../lib/ui.js'
import { app, css, makeStore, today, addDays, fmtDate, stat, tween, bar, ring, ib, num, clamp, confirmBox, emptyState, plural } from './_shared.js'

// ---------------------------------------------------------------- pure logic
export const kgToLb = (kg) => kg * 2.20462262185
export const lbToKg = (lb) => lb / 2.20462262185
export const cmToIn = (cm) => cm / 2.54

export const bmiOf = (kg, cm) => kg / (cm / 100) ** 2

export const WHO = [
  { max: 16, id: 'sev', label: 'Severe thinness', tone: 'bad' },
  { max: 17, id: 'mod', label: 'Moderate thinness', tone: 'warn' },
  { max: 18.5, id: 'mild', label: 'Mild thinness', tone: 'warn' },
  { max: 25, id: 'normal', label: 'Normal weight', tone: 'ok' },
  { max: 30, id: 'over', label: 'Overweight', tone: 'warn' },
  { max: 35, id: 'ob1', label: 'Obese class I', tone: 'bad' },
  { max: 40, id: 'ob2', label: 'Obese class II', tone: 'bad' },
  { max: Infinity, id: 'ob3', label: 'Obese class III', tone: 'bad' },
]
export const ASIAN = [
  { max: 18.5, id: 'under', label: 'Underweight', tone: 'warn' },
  { max: 23, id: 'normal', label: 'Normal weight', tone: 'ok' },
  { max: 25, id: 'over', label: 'Overweight (at risk)', tone: 'warn' },
  { max: 30, id: 'ob1', label: 'Obese class I', tone: 'bad' },
  { max: Infinity, id: 'ob2', label: 'Obese class II', tone: 'bad' },
]
export const bmiCategory = (bmi, asian = false) => (asian ? ASIAN : WHO).find((c) => bmi < c.max)
/** Healthy weight range in kg for a height: BMI 18.5 up to 24.9 (WHO) or 22.9 (Asian cut-offs). */
export const healthyRange = (cm, asian = false) => { const m2 = (cm / 100) ** 2; return [18.5 * m2, (asian ? 22.9 : 24.9) * m2] }

export const ACTIVITY = [
  [1.2, 'Sedentary', 'Desk job, little or no exercise'],
  [1.375, 'Lightly active', 'Light exercise 1-3 days a week'],
  [1.55, 'Moderately active', 'Moderate exercise 3-5 days a week'],
  [1.725, 'Very active', 'Hard exercise 6-7 days a week'],
  [1.9, 'Extra active', 'Physical job or twice-a-day training'],
]
/** Mifflin-St Jeor resting energy expenditure in kcal/day. */
export const bmrOf = ({ sex, kg, cm, age }) => 10 * kg + 6.25 * cm - 5 * age + (sex === 'male' ? 5 : -161)
export const tdeeOf = (bmr, factor) => bmr * factor
export const KCAL_PER_KG = 7700
/** kg per week (negative loses) to daily calorie change. */
export const dailyDelta = (kgPerWeek) => (kgPerWeek * KCAL_PER_KG) / 7
export const GOALS = [[-1, 'Lose 1 kg a week'], [-0.75, 'Lose 0.75 kg a week'], [-0.5, 'Lose 0.5 kg a week'], [-0.25, 'Lose 0.25 kg a week'], [0, 'Maintain weight'], [0.25, 'Gain 0.25 kg a week'], [0.5, 'Gain 0.5 kg a week']]
export const MACROS = { balanced: ['Balanced', 50, 20, 30], protein: ['High protein', 35, 30, 35], lowcarb: ['Lower carb', 25, 30, 45], keto: ['Keto', 5, 20, 75] }
/** kcal -> grams of carbs, protein, fat for a preset ([name, carb%, protein%, fat%]). */
export function macroGrams(kcal, preset) {
  const [, c, p, f] = MACROS[preset] || MACROS.balanced
  return { carb: (kcal * c) / 100 / 4, protein: (kcal * p) / 100 / 4, fat: (kcal * f) / 100 / 9, pct: { carb: c, protein: p, fat: f } }
}
/** Daily water goal in litres: weight-based baseline plus exercise, heat and life stage. */
export function waterGoal({ kg, age = 30, exerciseMin = 0, climate = 'mild', stage = 'none' }) {
  const per = age < 55 ? 0.035 : age < 66 ? 0.03 : 0.025
  const base = kg * per
  const ex = (exerciseMin / 30) * 0.35
  const heat = climate === 'hot' ? 0.5 : climate === 'warm' ? 0.25 : 0
  const st = stage === 'pregnant' ? 0.3 : stage === 'nursing' ? 0.7 : 0
  return { total: base + ex + heat + st, base, ex, heat, st }
}

// ---------------------------------------------------------------- UI
const KINDS = {
  bmi: { tone: '#ec4899' },
  calorie: { tone: '#f97316' },
  water: { tone: '#0ea5e9' },
}
const CSS = `
.t-health .gauge{position:relative;margin:34px 4px 8px}
.t-health .gauge .segs{display:flex;height:14px;border-radius:999px;overflow:hidden;gap:2px}
.t-health .gauge .segs i{height:100%;background:var(--sc);opacity:.85}
.t-health .gauge .mk{position:absolute;top:-26px;transform:translateX(-50%);transition:left .6s var(--ease);display:grid;justify-items:center;font-size:12px;font-weight:650;color:var(--text)}
.t-health .gauge .mk::after{content:"";width:0;height:0;border:6px solid transparent;border-top-color:var(--text);margin-top:1px}
.t-health .gauge .ticks{position:relative;height:16px;font-size:11px;color:var(--muted);margin-top:6px;font-variant-numeric:tabular-nums}
.t-health .gauge .ticks span{position:absolute;transform:translateX(-50%)}
.t-health .gauge .ticks span:first-child{transform:none}.t-health .gauge .ticks span:last-child{transform:translateX(-100%)}
.t-health .cat{display:inline-flex;align-items:center;gap:8px;font-weight:650;font-size:18px}
.t-health .cat i{width:12px;height:12px;border-radius:50%;background:var(--ct)}
.t-health .big{font-size:clamp(48px,12vw,68px);font-weight:720;letter-spacing:-.05em;line-height:1;font-variant-numeric:tabular-nums}
.t-health .ctab td,.t-health .ctab th{padding:8px 10px;font-size:13.5px;text-align:left}
.t-health .ctab tr.on{background:color-mix(in srgb,var(--tc) 12%,transparent);font-weight:650}
.t-health .ctab tr.on td:first-child{box-shadow:inset 3px 0 var(--tc)}
.t-health .hw{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.t-health .macro{display:flex;height:16px;border-radius:999px;overflow:hidden;gap:2px;margin:6px 0 10px}
.t-health .macro i{display:block;height:100%}
.t-health .lg{display:flex;gap:10px 18px;flex-wrap:wrap;font-size:13px;color:var(--text-2)}
.t-health .lg span{display:inline-flex;align-items:center;gap:6px}
.t-health .lg i{width:10px;height:10px;border-radius:3px;background:var(--mc)}
.t-health .water{display:grid;place-items:center;gap:10px;text-align:center}
.t-health .water .dial{position:relative;width:min(100%,190px);aspect-ratio:1}
.t-health .water .dial .pz-ring{width:100%;height:100%}
.t-health .water .dial .mid{position:absolute;inset:0;display:grid;place-content:center;font-size:26px;font-weight:700;letter-spacing:-.03em}
.t-health .water .dial .mid small{display:block;font-size:12px;color:var(--muted);font-weight:500;letter-spacing:0}
.t-health .week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;align-items:end;height:90px}
.t-health .week div{display:grid;gap:4px;justify-items:center;align-content:end;height:100%;font-size:11px;color:var(--muted)}
.t-health .week b{display:block;width:100%;max-width:28px;border-radius:8px 8px 4px 4px;background:var(--tc);opacity:.85;min-height:3px;transition:height .5s var(--ease)}
.t-health .week .hit b{background:var(--success)}
`
const ACTIVE_TONES = { ok: 'var(--success)', warn: 'var(--warning)', bad: 'var(--danger)', info: 'var(--info)' }

export function mount(root, { params }) {
  const kind = KINDS[params.kind] ? params.kind : 'bmi'
  const el = app(root, 'health', KINDS[kind].tone)
  css('t-health', CSS)
  const store = makeStore('health', { units: 'metric', sex: 'female', age: 30, cm: 165, kg: 65, activity: 1.375, goal: 0, macro: 'balanced', asian: false, target: '', exercise: 30, climate: 'mild', stage: 'none', log: {} })
  const S = store.get()
  const metric = () => S.units === 'metric'

  // ----- body fields (canonical cm / kg in state)
  const num2 = (props) => input({ type: 'number', inputmode: 'decimal', step: 'any', min: 0, ...props })
  function bodyFields({ age = true, sex = true, onUnits } = {}) {
    const host = h('div', { class: 'stack' })
    const out = { el: host }
    const redraw = () => {
      const m = metric()
      const cmIn = num2({ value: m ? round(S.cm, 1) : '', 'aria-label': 'Height in centimetres', oninput: (e) => { const v = e.target.valueAsNumber; S.cm = v; changed() } })
      const ftIn = num2({ value: Math.floor(cmToIn(S.cm) / 12) || '', step: 1, 'aria-label': 'Height feet', oninput: () => imp() })
      const inIn = num2({ value: round(cmToIn(S.cm) % 12, 1), 'aria-label': 'Height inches', oninput: () => imp() })
      function imp() { const f = ftIn.valueAsNumber || 0, i = inIn.valueAsNumber || 0; S.cm = (f * 12 + i) * 2.54 || NaN; changed() }
      const kgIn = num2({ value: m ? round(S.kg, 1) : round(kgToLb(S.kg), 1), 'aria-label': m ? 'Weight in kilograms' : 'Weight in pounds', oninput: (e) => { const v = e.target.valueAsNumber; S.kg = m ? v : lbToKg(v); changed() } })
      const ageIn = num2({ value: S.age, step: 1, min: 1, max: 110, 'aria-label': 'Age in years', oninput: (e) => { S.age = e.target.valueAsNumber; changed() } })
      clear(host,
        segmented([['metric', 'Metric (cm, kg)'], ['imperial', 'Imperial (ft, lb)']], S.units, (v) => { S.units = v; store.save(); redraw(); changed() }, 'Units'),
        sex ? field('Sex', segmented([['female', 'Female'], ['male', 'Male']], S.sex, (v) => { S.sex = v; changed() }, 'Sex'), kind === 'bmi' ? null : 'Used by the Mifflin-St Jeor equation.') : null,
        h('div', { class: 'hw' },
          m ? field('Height (cm)', cmIn) : field('Height', h('div', { class: 'pz-row nowrap' }, ftIn, h('span', { class: 'pz-note' }, 'ft'), inIn, h('span', { class: 'pz-note' }, 'in'))),
          field(m ? 'Weight (kg)' : 'Weight (lb)', kgIn)),
        age ? field('Age', ageIn) : null)
      onUnits?.()
    }
    redraw()
    return out
  }
  const round = (n, d) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : '')
  const valid = () => S.cm >= 50 && S.cm <= 272 && S.kg >= 10 && S.kg <= 650
  const showW = (kg) => (metric() ? `${num(kg, 1)} kg` : `${num(kgToLb(kg), 1)} lb`)
  const results = h('div', { style: 'display:flex;flex-direction:column;gap:16px;min-width:0' })
  let changed = () => {}

  // ---------------------------------------------------------------- BMI
  function mountBmi() {
    const body = bodyFields({ age: false, sex: false })
    const asian = toggle('Use Asian cut-offs (23 and 25)', S.asian, (v) => { S.asian = v; changed() })
    const note = h('p', { class: 'pz-note' }, 'BMI is a screening number for adults. It does not separate muscle from fat, so athletes, older adults and children need other measures. Not medical advice.')
    el.append(h('div', { class: 'pz-cols' }, h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('ruler'), 'Your details'), h('div', { class: 'stack' }, body.el, asian, note)), results))
    const big = h('div', { class: 'big' })
    changed = () => {
      store.save()
      if (!valid()) { clear(results, h('section', { class: 'pz-card' }, emptyState('Enter your height and weight', 'Your BMI appears here as you type.', 'heart-pulse'))); big._v = 0; return }
      const bmi = bmiOf(S.kg, S.cm)
      const cat = bmiCategory(bmi, S.asian)
      const scale = S.asian ? ASIAN : WHO
      const [lo, hi] = healthyRange(S.cm, S.asian)
      const MIN = 14, MAX = 40
      const pos = clamp(((bmi - MIN) / (MAX - MIN)) * 100, 1, 99)
      const segs = []
      let prev = MIN
      for (const c of scale) { const to = Math.min(c.max, MAX); if (to > prev) { segs.push(h('i', { style: { flex: String(to - prev), '--sc': ACTIVE_TONES[c.tone] }, title: c.label })); prev = to } }
      const gap = S.kg < lo ? `Gain about ${showW(lo - S.kg)} to reach the healthy range.` : S.kg > hi ? `Losing about ${showW(S.kg - hi)} would bring you to the top of the healthy range.` : 'You are inside the healthy range for your height.'
      const mk = h('div', { class: 'mk', style: { left: `${pos}%` } }, num(bmi, 1))
      const rows = scale.map((c, i) => { const from = i ? scale[i - 1].max : 0; return h('tr', { class: c === cat ? 'on' : '' }, h('td', c.label), h('td', i === 0 ? `below ${c.max}` : c.max === Infinity ? `${from} and above` : `${from} to ${(c.max - 0.1).toFixed(1)}`)) })
      clear(results, h('section', { class: 'pz-card tint', style: { '--tc': ACTIVE_TONES[cat.tone] } },
        h('h2', { class: 'pz-title' }, icon('heart-pulse'), 'Your BMI'),
        h('div', { class: 'stack' }, big, h('div', { class: 'cat', style: { '--ct': ACTIVE_TONES[cat.tone] } }, h('i'), cat.label),
          h('div', { class: 'gauge' }, mk, h('div', { class: 'segs' }, segs), h('div', { class: 'ticks' }, [14, 18.5, S.asian ? 23 : 25, S.asian ? 25 : 30, 40].map((v) => h('span', { style: { left: `${((v - MIN) / (MAX - MIN)) * 100}%` } }, String(v))))),
          h('div', { class: 'pz-bento' }, stat({ label: 'Healthy range', value: `${showW(lo).replace(/ (kg|lb)$/, '')} to ${showW(hi)}`, hint: `at ${metric() ? `${num(S.cm, 0)} cm` : `${Math.floor(cmToIn(S.cm) / 12)} ft ${num(cmToIn(S.cm) % 12, 0)} in`}`, icon: 'scale', tone: 'ok' }), stat({ label: 'Next step', value: S.kg < lo ? 'Gain' : S.kg > hi ? 'Lose' : 'Maintain', hint: gap, icon: 'target', tone: cat.tone })))),
        h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('table'), S.asian ? 'Asian cut-offs' : 'WHO categories'), h('div', { class: 'table-wrap' }, h('table', { class: 'table ctab' }, h('thead', h('tr', h('th', 'Category'), h('th', 'BMI'))), h('tbody', rows)))))
      tween(big, bmi, (x) => x.toFixed(1))
    }
    changed()
  }

  // ---------------------------------------------------------------- calories
  function mountCalorie() {
    const targetHost = h('div')
    const drawTarget = () => clear(targetHost, field(`Target weight (${metric() ? 'kg' : 'lb'}, optional)`, num2({ value: S.target === '' ? '' : round(metric() ? S.target : kgToLb(S.target), 1), placeholder: 'Optional', 'aria-label': 'Target weight', oninput: (e) => { const v = e.target.valueAsNumber; S.target = Number.isFinite(v) ? (metric() ? v : lbToKg(v)) : ''; changed() } }), 'Shows roughly how long your goal takes.'))
    const body = bodyFields({ onUnits: drawTarget })
    const act = select(ACTIVITY.map(([f, l, d]) => [f, `${l} - ${d}`]), S.activity, (v) => { S.activity = Number(v); changed() })
    const goal = select(GOALS.map(([v, l]) => [v, l]), S.goal, (v) => { S.goal = Number(v); changed() })
    const macro = select(Object.entries(MACROS).map(([k, v]) => [k, `${v[0]} (${v[1]}C / ${v[2]}P / ${v[3]}F)`]), S.macro, (v) => { S.macro = v; changed() })
    el.append(h('div', { class: 'pz-cols' }, h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('calculator'), 'Your details'),
      h('div', { class: 'stack' }, body.el, field('Activity level', act), field('Goal', goal), field('Macro split', macro), targetHost)), results))
    const kc = h('div', { class: 'big' })
    changed = () => {
      store.save()
      if (!valid() || !(S.age >= 10 && S.age <= 110)) { clear(results, h('section', { class: 'pz-card' }, emptyState('Fill in your details', 'Height, weight and age are needed for the calculation.', 'flame'))); kc._v = 0; return }
      const bmr = bmrOf({ sex: S.sex, kg: S.kg, cm: S.cm, age: S.age })
      const tdee = tdeeOf(bmr, S.activity)
      const target = tdee + dailyDelta(S.goal)
      const floor = S.sex === 'male' ? 1500 : 1200
      const low = S.goal < 0 && target < floor
      const g = macroGrams(target, S.macro)
      const t = Number(S.target)
      let eta = ''
      if (S.goal !== 0 && Number.isFinite(t) && t > 0 && S.target !== '') {
        const diff = t - S.kg
        if (Math.sign(diff) !== Math.sign(S.goal)) eta = 'Your target is in the opposite direction to this goal.'
        else { const w = Math.abs(diff) / Math.abs(S.goal); eta = `About ${plural(Math.round(w), 'week')} (${num(w / 4.345, 1)} months) to go from ${showW(S.kg)} to ${showW(t)}.` }
      }
      const colors = { carb: '#f59e0b', protein: '#ef4444', fat: '#6366f1' }
      const lvl = GOALS.map(([v, l]) => [l, tdee + dailyDelta(v), v])
      clear(results,
        h('section', { class: 'pz-card tint' }, h('h2', { class: 'pz-title' }, icon('flame'), S.goal === 0 ? 'Daily calories to maintain' : 'Daily calories for your goal'),
          h('div', { class: 'stack' }, h('div', null, kc, h('div', { class: 'pz-note', style: 'margin-top:6px' }, 'kcal per day')),
            low ? h('div', { class: 'alert warn', role: 'status' }, icon('triangle-alert'), h('div', `That is below the usual minimum of ${floor} kcal a day. Pick a gentler goal, or talk to a doctor or dietitian first.`)) : null,
            eta ? h('p', { class: 'pz-note' }, eta) : null,
            h('div', { class: 'pz-bento' }, stat({ label: 'BMR', value: `${num(bmr, 0)}`, hint: 'kcal at complete rest', icon: 'bed', tone: 'info' }), stat({ label: 'Maintenance (TDEE)', value: `${num(tdee, 0)}`, hint: 'kcal with your activity', icon: 'activity', tone: 'ok' }), stat({ label: 'Protein target', value: `${num(g.protein / S.kg, 1)} g/kg`, hint: `${num(g.protein, 0)} g a day`, icon: 'beef', tone: 'warn' })))),
        h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('chart-pie'), 'Macros per day'),
          h('div', { class: 'macro' }, ['carb', 'protein', 'fat'].map((k) => h('i', { style: { flex: String(g.pct[k]), background: colors[k] }, title: k }))),
          h('div', { class: 'lg', style: 'margin-bottom:10px' }, [['carb', 'Carbs'], ['protein', 'Protein'], ['fat', 'Fat']].map(([k, l]) => h('span', { style: { '--mc': colors[k] } }, h('i'), `${l} ${g.pct[k]}%`))),
          h('div', { class: 'pz-bento' }, [['carb', 'Carbs', 4], ['protein', 'Protein', 4], ['fat', 'Fat', 9]].map(([k, l]) => stat({ label: l, value: `${num(g[k], 0)} g`, hint: `${num(g[k] * (k === 'fat' ? 9 : 4), 0)} kcal` })))),
        h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('table'), 'Every goal at a glance'), h('div', { class: 'table-wrap' }, h('table', { class: 'table ctab' }, h('thead', h('tr', h('th', 'Goal'), h('th', 'kcal / day'))), h('tbody', lvl.map(([l, k, v]) => h('tr', { class: v === S.goal ? 'on' : '' }, h('td', l), h('td', num(k, 0)))))))),
        h('p', { class: 'pz-note' }, 'Estimates use the Mifflin-St Jeor equation and 7,700 kcal per kg of body weight. Real results vary. This is not medical advice.'))
      tween(kc, target, (x) => num(Math.round(x), 0))
    }
    changed()
  }

  // ---------------------------------------------------------------- water
  function mountWater() {
    const body = bodyFields({ sex: false })
    const ex = num2({ value: S.exercise, step: 5, min: 0, max: 600, 'aria-label': 'Exercise minutes per day', oninput: (e) => { S.exercise = e.target.valueAsNumber || 0; changed() } })
    const climate = select([['mild', 'Cool or mild'], ['warm', 'Warm'], ['hot', 'Hot and humid']], S.climate, (v) => { S.climate = v; changed() })
    const stage = select([['none', 'None'], ['pregnant', 'Pregnant'], ['nursing', 'Breastfeeding']], S.stage, (v) => { S.stage = v; changed() })
    const tracker = h('section', { class: 'pz-card' })
    el.append(h('div', { class: 'pz-cols' }, h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('droplet'), 'Your details'),
      h('div', { class: 'stack' }, body.el, field('Exercise per day (minutes)', ex), field('Climate', climate), field('Pregnancy or nursing', stage))), results), tracker)
    const lit = h('div', { class: 'big' })
    let goalMl = 0
    changed = () => {
      store.save()
      if (!valid()) { clear(results, h('section', { class: 'pz-card' }, emptyState('Enter your weight', 'Your daily water goal appears here.', 'droplet'))); lit._v = 0; goalMl = 0; renderTracker(); return }
      const w = waterGoal({ kg: S.kg, age: S.age || 30, exerciseMin: S.exercise || 0, climate: S.climate, stage: S.stage })
      goalMl = Math.round(w.total * 10) * 100
      const l = goalMl / 1000
      const parts = [['Base from body weight', w.base], ['Exercise', w.ex], ['Warm weather', w.heat], ['Pregnancy or nursing', w.st]].filter(([, v]) => v > 0)
      clear(results, h('section', { class: 'pz-card tint' }, h('h2', { class: 'pz-title' }, icon('droplet'), 'Daily water goal'),
        h('div', { class: 'stack' }, h('div', null, lit, h('div', { class: 'pz-note', style: 'margin-top:6px' }, 'litres per day')),
          h('div', { class: 'pz-bento' }, stat({ label: 'Glasses (250 ml)', value: String(Math.ceil(goalMl / 250)), icon: 'cup-soda', tone: 'info' }), stat({ label: 'Bottles (500 ml)', value: num(goalMl / 500, 1), icon: 'glass-water', tone: 'ok' }), stat({ label: 'Ounces', value: num(goalMl / 29.5735, 0), hint: 'US fl oz', icon: 'ruler' })),
          h('ul', { class: 'pz-note', style: 'margin:0;padding-left:18px' }, parts.map(([n, v]) => h('li', `${n}: ${num(v, 2)} L`))),
          h('p', { class: 'pz-note' }, 'This is total fluid. About a fifth normally comes from food, and tea, coffee and milk count too. Drink to thirst and check with a doctor if you have a kidney, heart or liver condition.'))))
      tween(lit, l, (x) => x.toFixed(1))
      renderTracker()
    }
    function renderTracker() {
      const day = today()
      const ml = S.log[day] || 0
      const add = (n) => { S.log[day] = Math.max(0, (S.log[day] || 0) + n); store.save(); renderTracker() }
      const rg = ring({ size: 190, stroke: 14, color: '#0ea5e9' })
      setTimeout(() => rg.set(goalMl ? ml / goalMl : 0), 20)
      const cust = num2({ placeholder: 'ml', 'aria-label': 'Custom amount in millilitres', style: 'width:92px' })
      const days = Array.from({ length: 7 }, (_, i) => addDays(day, i - 6))
      const peak = Math.max(goalMl, ...days.map((d) => S.log[d] || 0), 1)
      clear(tracker, h('h2', { class: 'pz-title' }, icon('glass-water'), h('span', { class: 'grow' }, "Today's log"), h('span', { class: 'pz-note' }, 'Saved on this device')),
        h('div', { class: 'pz-cols' },
          h('div', { class: 'water' }, h('div', { class: 'dial' }, rg, h('div', { class: 'mid' }, h('span', `${num(ml / 1000, 2)} L`, h('small', goalMl ? `of ${num(goalMl / 1000, 1)} L` : 'set your weight')))),
            goalMl && ml >= goalMl ? h('div', { class: 'cat', style: { '--ct': 'var(--success)' } }, h('i'), 'Goal reached') : goalMl ? h('div', { class: 'pz-note' }, `${num((goalMl - ml) / 1000, 2)} L to go`) : null),
          h('div', { class: 'stack' },
            h('div', { class: 'pz-chips' }, [100, 250, 500, 750].map((n) => button(`+${n} ml`, { icon: 'plus', size: 'sm', onClick: () => add(n) }))),
            h('div', { class: 'pz-row nowrap' }, cust, button('Add', { size: 'sm', onClick: () => { const v = cust.valueAsNumber; if (v > 0 && v <= 5000) add(Math.round(v)); else toast('Enter an amount between 1 and 5000 ml', 'error') } }), button('Undo / clear', { size: 'sm', variant: 'ghost', onClick: () => { S.log[day] = 0; store.save(); renderTracker() } })),
            h('div', { class: 'week', role: 'img', 'aria-label': 'Last 7 days of water intake' }, days.map((d) => { const v = S.log[d] || 0; return h('div', { class: goalMl && v >= goalMl ? 'hit' : '', title: `${fmtDate(d)}: ${num(v / 1000, 2)} L` }, h('b', { style: { height: `${Math.max(3, (v / peak) * 64)}px` } }), fmtDate(d, { weekday: 'narrow' })) })))))
    }
    changed()
  }

  ;({ bmi: mountBmi, calorie: mountCalorie, water: mountWater })[kind]()
}
