// GPA / SGPA / CGPA calculator: credit-weighted, 10-point (India) and 4.0 scales, CGPA to percentage, and a target planner.
import { h, button, segmented, select, number, clear, copyText, formatNumber, icon } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { stage, tile, toolStyle, ring, pill, confetti, confirmModal } from './_kit.js'

export const SCALES = {
  10: { max: 10, label: '10-point (India)', grades: [['O', 10], ['A+', 9], ['A', 8], ['B+', 7], ['B', 6], ['C', 5], ['P', 4], ['F', 0]] },
  4: { max: 4, label: '4.0 (US style)', grades: [['A', 4], ['A-', 3.7], ['B+', 3.3], ['B', 3], ['B-', 2.7], ['C+', 2.3], ['C', 2], ['C-', 1.7], ['D+', 1.3], ['D', 1], ['F', 0]] },
}

/** CGPA -> percentage rules. Always check the rule your own university publishes. */
export const PERCENT_RULES = [
  { id: 'cbse', label: 'CBSE (CGPA x 9.5)', f: (c) => c * 9.5 },
  { id: 'x10', label: 'Simple (CGPA x 10)', f: (c) => c * 10 },
  { id: 'vtu', label: 'VTU ((CGPA - 0.75) x 10)', f: (c) => (c - 0.75) * 10 },
  { id: 'jntuh', label: 'JNTUH ((CGPA - 0.5) x 10)', f: (c) => (c - 0.5) * 10 },
  { id: 'mu', label: 'Mumbai University (7.1 x CGPA + 11)', f: (c) => 7.1 * c + 11 },
  { id: 'custom', label: 'Custom (a x CGPA + b)', f: (c, a, b) => a * c + b },
]

/** Weighted grade point average of courses [{credits, pts}] (rows with no credits or no grade are ignored). */
export function gpa(courses) {
  let credits = 0, points = 0
  for (const c of courses) {
    if (!(c.credits > 0) || !Number.isFinite(c.pts)) continue
    credits += c.credits
    points += c.credits * c.pts
  }
  return { credits, points, gpa: credits ? points / credits : NaN }
}

/** Overall CGPA from semesters (each a list of courses): total grade points / total credits. */
export function cgpa(semesters) {
  const all = semesters.flatMap((s) => s.courses)
  return gpa(all)
}

/** SGPA needed next semester to reach `target` overall, given current CGPA/credits and next credits. */
export function requiredSgpa(current, creditsDone, target, nextCredits) {
  if (!(nextCredits > 0)) return NaN
  return (target * (creditsDone + nextCredits) - current * creditsDone) / nextCredits
}

export function toPercent(value, ruleId, a = 9.5, b = 0) {
  const r = PERCENT_RULES.find((x) => x.id === ruleId) || PERCENT_RULES[0]
  return Math.max(0, r.f(value, a, b))
}

export function classify(c, scale) {
  const p = scale === 10 ? c : (c / 4) * 10
  if (!Number.isFinite(p)) return ''
  return p >= 7.5 ? 'Distinction range' : p >= 6 ? 'First class range' : p >= 5 ? 'Second class range' : p >= 4 ? 'Pass range' : 'Below pass'
}

const CSS = `
.t-gpa .g-wrap { display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, 380px); gap: 12px; align-items: start; }
@media (max-width: 960px) { .t-gpa .g-wrap { grid-template-columns: minmax(0, 1fr); } }
.t-gpa .g-side { position: sticky; top: calc(var(--header-h) + 12px); display: flex; flex-direction: column; gap: 12px; }
@media (max-width: 960px) { .t-gpa .g-side { position: static; } }
.t-gpa .sem-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.t-gpa .sem-head .input { font-weight: 600; max-width: 220px; }
.t-gpa .c-row { display: grid; grid-template-columns: minmax(0, 1fr) 76px 128px 34px; gap: 8px; align-items: center; margin-bottom: 8px; animation: stu-pop .35s var(--ease) both; }
.t-gpa .c-row .input, .t-gpa .c-row .select { height: 40px; }
.t-gpa .g-cell { display: flex; gap: 6px; }
.t-gpa .g-cell .select { flex: 1; min-width: 0; }
.t-gpa .g-cell .input { width: 64px; padding: 0 8px; }
.t-gpa .c-head { display: grid; grid-template-columns: minmax(0, 1fr) 76px 128px 34px; gap: 8px; font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-bottom: 6px; }
@media (max-width: 560px) {
  .t-gpa .c-head { display: none; }
  .t-gpa .c-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 34px; padding-bottom: 10px; border-bottom: 1px dashed var(--border); }
  .t-gpa .c-row > :first-child { grid-column: 1 / -1; }
  .t-gpa .c-row .g-cell { grid-column: 2; }
}
.t-gpa .sgpa { margin-left: auto; text-align: right; }
.t-gpa .sgpa b { font-size: 24px; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.t-gpa .sgpa small { display: block; font-size: 11.5px; color: var(--muted); }
.t-gpa .hero-row { display: flex; align-items: center; gap: 16px; }
.t-gpa .mini-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
.t-gpa .mini { padding: 10px 12px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border); }
.t-gpa .mini small { display: block; color: var(--muted); font-size: 12px; }
.t-gpa .mini b { font-size: 18px; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.t-gpa .pct { font-size: 38px; font-weight: 700; letter-spacing: -.04em; }
`

const newCourse = () => ({ name: '', credits: 3, grade: '', pts: NaN })
const newSem = (n) => ({ name: `Semester ${n}`, courses: Array.from({ length: 5 }, newCourse) })

export function mount(root) {
  toolStyle('gpa', CSS)
  const saved = load('gpa:state', null)
  const st = saved && saved.semesters?.length ? saved : { scale: 10, semesters: [newSem(1)], rule: 'cbse', a: 9.5, b: 0, nextCredits: 20, target: 8 }
  // JSON turns NaN into null, so restore it
  for (const s of st.semesters) for (const c of s.courses) if (c.pts == null) c.pts = NaN
  const persist = () => save('gpa:state', st)

  const semBox = h('div', { class: 'stack' })
  const side = h('div', { class: 'g-side' })
  let prevCgpa = NaN

  function gradePts(scale, g) { return SCALES[scale].grades.find((x) => x[0] === g)?.[1] ?? NaN }

  function semRows(s, si) {
    const scale = st.scale
    const rows = h('div')
    rows.append(h('div', { class: 'c-head' }, h('span', 'Course'), h('span', 'Credits'), h('span', 'Grade'), h('span')))
    s.courses.forEach((c, ci) => {
      const gradeSel = h('select', { class: 'select', 'aria-label': `Grade for course ${ci + 1}`, onchange: (e) => {
        c.grade = e.target.value
        c.pts = c.grade === 'custom' ? (Number.isFinite(c.pts) ? c.pts : NaN) : c.grade ? gradePts(scale, c.grade) : NaN
        persist(); render(false)
      } }, h('option', { value: '' }, 'Grade'), SCALES[scale].grades.map(([g, p]) => h('option', { value: g, selected: c.grade === g }, `${g}  (${p})`)), h('option', { value: 'custom', selected: c.grade === 'custom' }, 'Points...'))
      const cell = h('div', { class: 'g-cell' }, gradeSel)
      if (c.grade === 'custom') cell.append(h('input', { class: 'input', type: 'number', min: 0, max: SCALES[scale].max, step: 'any', placeholder: 'pts', value: Number.isFinite(c.pts) ? c.pts : '', 'aria-label': `Grade points for course ${ci + 1}`,
        oninput: (e) => { c.pts = e.target.valueAsNumber; persist(); render(false) } }))
      rows.append(h('div', { class: 'c-row' },
        h('input', { class: 'input', type: 'text', placeholder: `Course ${ci + 1} (optional)`, value: c.name, 'aria-label': `Name of course ${ci + 1}`, oninput: (e) => { c.name = e.target.value; persist() } }),
        h('input', { class: 'input', type: 'number', min: 0, step: 'any', inputmode: 'decimal', value: c.credits, 'aria-label': `Credits for course ${ci + 1}`, oninput: (e) => { c.credits = e.target.valueAsNumber; persist(); render(false) } }),
        cell,
        button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: `Remove course ${ci + 1}`, onClick: () => { s.courses.splice(ci, 1); persist(); render(true) } })))
    })
    return rows
  }

  const sgpaEls = []
  function renderSems() {
    clear(semBox)
    sgpaEls.length = 0
    st.semesters.forEach((s, si) => {
      const sg = h('div', { class: 'sgpa' })
      sgpaEls.push({ el: sg, s })
      const nameIn = h('input', { class: 'input', type: 'text', value: s.name, 'aria-label': 'Semester name', oninput: (e) => { s.name = e.target.value; persist(); renderSide() } })
      semBox.append(tile({ tint: ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#0ea5e9', '#a855f7'][si % 6], i: si },
        h('div', { class: 'sem-head' }, icon('book-open'), nameIn, sg, st.semesters.length > 1 ? button('', { icon: 'trash-2', variant: 'ghost', size: 'sm', ariaLabel: `Remove ${s.name}`, onClick: () => { st.semesters.splice(si, 1); persist(); render(true) } }) : null),
        semRows(s, si),
        h('div', { class: 'row' }, button('Add course', { icon: 'plus', size: 'sm', onClick: () => { s.courses.push(newCourse()); persist(); render(true) } }),
          button('Copy', { icon: 'copy', variant: 'ghost', size: 'sm', onClick: () => copyText(semText(s)) }))))
    })
    semBox.append(button('Add another semester', { icon: 'plus', variant: 'secondary', onClick: () => { st.semesters.push(newSem(st.semesters.length + 1)); persist(); render(true) } }))
    updateSgpa()
  }
  const semText = (s) => {
    const r = gpa(s.courses)
    return `${s.name}\n` + s.courses.filter((c) => c.credits > 0 && Number.isFinite(c.pts)).map((c) => `${c.name || 'Course'}: ${c.credits} credits, ${c.grade === 'custom' ? c.pts : c.grade} (${c.pts})`).join('\n') + `\nSGPA/GPA: ${Number.isFinite(r.gpa) ? r.gpa.toFixed(2) : '-'} over ${r.credits} credits`
  }
  function updateSgpa() {
    for (const { el, s } of sgpaEls) {
      const r = gpa(s.courses)
      clear(el, h('b', Number.isFinite(r.gpa) ? r.gpa.toFixed(2) : '-'), h('small', `${r.credits ? formatNumber(r.credits, 2) : 0} credits`))
    }
  }

  // ---------- side summary ----------
  const ringEl = ring({ value: 0, max: SCALES[st.scale].max, size: 150, stroke: 13, color: 'var(--accent)', label: 'CGPA', fmt: (v) => v.toFixed(2) })
  const classEl = h('div', { class: 'stu-hint', style: 'margin-top:4px' })
  const miniEl = h('div', { class: 'mini-stats' })
  // static inputs are built once so typing in them never loses focus; only the result areas re-render
  const ruleSel = select(PERCENT_RULES.map((r) => [r.id, r.label]), st.rule, (v) => { st.rule = v; persist(); renderPct(cgpa(st.semesters)) })
  const aIn = number(st.a, { onInput: (n) => { st.a = n; persist(); renderPct(cgpa(st.semesters)) } })
  const bIn = number(st.b, { onInput: (n) => { st.b = n; persist(); renderPct(cgpa(st.semesters)) } })
  const customRow = h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'a (multiplier)'), aIn), h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'b (add)'), bIn))
  const pctOut = h('div', { class: 'pct stu-gradient-text', style: 'margin-top:10px' })
  const pctNote = h('div', { class: 'stu-hint' })
  const pctBox = h('div', { class: 'stack tight' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'University rule'), ruleSel), customRow, pctOut, pctNote)
  const tgtIn = number(st.target, { min: 0, onInput: (n) => { st.target = n; persist(); renderPlan(cgpa(st.semesters)) } })
  const ncIn = number(st.nextCredits, { min: 0, onInput: (n) => { st.nextCredits = n; persist(); renderPlan(cgpa(st.semesters)) } })
  const planOut = h('div')
  const planBox = h('div', { class: 'stack' }, h('div', { class: 'grid-2' },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Target CGPA'), tgtIn),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Next semester credits'), ncIn)), planOut)

  function renderSide() {
    const all = cgpa(st.semesters)
    const max = SCALES[st.scale].max
    const val = Number.isFinite(all.gpa) ? all.gpa : 0
    ringEl.setMax(max)
    ringEl.update(val, 'CGPA')
    ringEl.setColor(val >= max * 0.75 ? 'var(--success)' : val >= max * 0.5 ? 'var(--accent)' : 'var(--warning)')
    clear(classEl, Number.isFinite(all.gpa) ? classify(all.gpa, st.scale) : 'Pick grades to see your CGPA')
    clear(miniEl,
      h('div', { class: 'mini' }, h('small', 'Total credits'), h('b', formatNumber(all.credits, 2))),
      h('div', { class: 'mini' }, h('small', 'Grade points'), h('b', formatNumber(all.points, 2))),
      ...st.semesters.slice(0, 4).map((s) => { const r = gpa(s.courses); return h('div', { class: 'mini' }, h('small', s.name), h('b', Number.isFinite(r.gpa) ? r.gpa.toFixed(2) : '-')) }))
    renderPct(all); renderPlan(all)
    if (Number.isFinite(all.gpa) && all.gpa >= max * 0.9 && !(prevCgpa >= max * 0.9)) confetti(ringEl, { count: 70 })
    prevCgpa = all.gpa
  }
  function renderPct(all) {
    const ten = st.scale === 10
    ruleSel.parentElement.hidden = !ten
    customRow.hidden = !ten || st.rule !== 'custom'
    const v = Number.isFinite(all.gpa) && ten ? toPercent(all.gpa, st.rule, st.a, st.b) : NaN
    pctOut.hidden = !ten
    pctOut.textContent = Number.isFinite(v) ? `${v.toFixed(2)}%` : '-'
    pctNote.textContent = ten ? 'Formulas differ between universities. Treat this as an estimate and confirm with your official rule.'
      : 'Percentage conversion applies to the 10-point scale. US-style 4.0 GPAs have no single standard formula.'
  }
  function renderPlan(all) {
    const max = SCALES[st.scale].max
    tgtIn.max = max
    const need = requiredSgpa(all.gpa, all.credits, st.target, st.nextCredits)
    const feasible = Number.isFinite(need) && need <= max + 1e-9
    clear(planOut,
      !Number.isFinite(all.gpa) ? h('div', { class: 'stu-hint' }, 'Add your grades first, then see what you need next.')
        : !Number.isFinite(need) ? h('div', { class: 'stu-hint' }, 'Enter your target and next semester credits.')
          : h('div', { class: feasible ? '' : 'stu-shake' }, pill(feasible ? `You need an SGPA of ${Math.max(0, need).toFixed(2)}` : `Needs ${need.toFixed(2)}, above the maximum of ${max}`, feasible ? (need > max * 0.9 ? 'warn' : 'ok') : 'bad', feasible ? 'target' : 'triangle-alert'),
            feasible && need <= 0 ? h('div', { class: 'stu-hint', style: 'margin-top:6px' }, 'You already meet this target, even with the lowest grades.') : null))
  }

  function render(full) {
    if (full) renderSems(); else updateSgpa()
    renderSide()
  }

  const scaleSeg = segmented(Object.entries(SCALES).map(([k, v]) => [k, v.label]), String(st.scale), (v) => {
    st.scale = +v
    // re-map letter grades to the new scale, dropping ones that do not exist there
    for (const s of st.semesters) for (const c of s.courses) if (c.grade && c.grade !== 'custom') { c.pts = gradePts(st.scale, c.grade); if (!Number.isFinite(c.pts)) c.grade = '' }
    persist(); render(true)
  }, 'Grading scale')

  side.append(
    tile({ tint: '#6366f1', i: 0 }, h('div', { class: 'hero-row' }, ringEl, h('div', { style: 'min-width:0' }, h('div', { class: 'stu-title', style: 'margin:0' }, 'Overall CGPA'), classEl)), miniEl),
    tile({ tint: '#10b981', title: 'CGPA to percentage', icon: 'percent', i: 1 }, pctBox),
    tile({ tint: '#f59e0b', title: 'What do I need next?', icon: 'target', i: 2 }, planBox))

  root.append(stage('t-gpa', h('div', { class: 'stu-toolbar', style: 'margin-bottom:12px' }, scaleSeg, h('span', { class: 'grow' }),
    h('span', { class: 'stu-hint' }, 'Saved on this device. Rows without a grade are ignored.'),
    button('Reset', { icon: 'rotate-ccw', variant: 'ghost', size: 'sm', onClick: () => confirmModal({ title: 'Clear everything?', text: 'This removes all semesters and grades saved on this device.', yes: 'Clear', danger: true }, () => { st.semesters = [newSem(1)]; persist(); render(true) }) })),
  h('div', { class: 'g-wrap' }, semBox, side)))
  render(true)
}
