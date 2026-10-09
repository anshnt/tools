// Marks percentage calculator: subject marks to total, percentage, grade and division, with a target planner.
import { h, button, select, number, clear, copyText, formatNumber } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { stage, tile, toolStyle, ring, pill, confetti, confirmModal } from './_kit.js'

export const SCHEMES = {
  cbse: { label: 'CBSE grades (A1 to E)', bands: [[91, 'A1', 'Outstanding'], [81, 'A2', 'Excellent'], [71, 'B1', 'Very good'], [61, 'B2', 'Good'], [51, 'C1', 'Fair'], [41, 'C2', 'Average'], [33, 'D', 'Pass'], [0, 'E', 'Needs improvement']] },
  india: { label: 'Indian university division', bands: [[75, 'Distinction', 'First class with distinction'], [60, 'First', 'First class'], [50, 'Second', 'Second class'], [40, 'Pass', 'Pass class'], [0, 'Fail', 'Below pass marks']] },
  ten: { label: '10-point letter grades (O to F)', bands: [[90, 'O', 'Outstanding'], [80, 'A+', 'Excellent'], [70, 'A', 'Very good'], [60, 'B+', 'Good'], [55, 'B', 'Above average'], [50, 'C', 'Average'], [40, 'P', 'Pass'], [0, 'F', 'Fail']] },
  us: { label: 'US letter grades (A to F)', bands: [[90, 'A', 'Excellent'], [80, 'B', 'Good'], [70, 'C', 'Satisfactory'], [60, 'D', 'Passing'], [0, 'F', 'Failing']] },
  uk: { label: 'UK degree classes', bands: [[70, 'First', 'First-class honours'], [60, '2:1', 'Upper second'], [50, '2:2', 'Lower second'], [40, 'Third', 'Third-class'], [0, 'Fail', 'Below pass']] },
}

const TEMPLATES = {
  cbse10: ['English', 'Hindi', 'Mathematics', 'Science', 'Social Science'],
  pcm: ['English', 'Physics', 'Chemistry', 'Mathematics', 'Computer Science'],
  six: ['Subject 1', 'Subject 2', 'Subject 3', 'Subject 4', 'Subject 5', 'Subject 6'],
}

/** Band for a percentage: first band whose threshold the percentage meets. */
export function bandFor(pct, scheme) {
  const bands = (SCHEMES[scheme] || SCHEMES.cbse).bands
  return bands.find(([min]) => pct + 1e-9 >= min) || bands.at(-1)
}

/**
 * subjects: [{name, got, max}]. bestN > 0 counts only the best N subjects (by percentage).
 * -> {got, max, pct, rows: [{name, got, max, pct, counted, failed}], failedCount, highest, lowest, valid}
 */
export function summarize(subjects, { passPct = 0, bestN = 0 } = {}) {
  const rows = subjects.map((s, idx) => ({ ...s, idx })).filter((s) => Number.isFinite(s.got) && s.max > 0).map((s) => ({ ...s, pct: (s.got / s.max) * 100, counted: true, failed: false, over: s.got > s.max }))
  let pool = rows
  if (bestN > 0 && bestN < rows.length) {
    const keep = new Set([...rows].sort((a, b) => b.pct - a.pct).slice(0, bestN))
    for (const r of rows) r.counted = keep.has(r)
    pool = rows.filter((r) => r.counted)
  }
  for (const r of rows) r.failed = passPct > 0 && r.pct + 1e-9 < passPct
  const got = pool.reduce((t, r) => t + r.got, 0), max = pool.reduce((t, r) => t + r.max, 0)
  const sorted = [...rows].sort((a, b) => b.pct - a.pct)
  return { got, max, pct: max ? (got / max) * 100 : NaN, rows, failedCount: rows.filter((r) => r.failed).length, highest: sorted[0], lowest: sorted.at(-1), valid: rows.length > 0 }
}

/** Marks needed in the remaining papers (out of `remainingMax`) to finish on `targetPct` overall. */
export function marksNeeded(got, max, targetPct, remainingMax) {
  if (!(remainingMax > 0)) return NaN
  return (targetPct / 100) * (max + remainingMax) - got
}

const CSS = `
.t-marks .m-wrap { display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, 400px); gap: 12px; align-items: start; }
@media (max-width: 960px) { .t-marks .m-wrap { grid-template-columns: minmax(0, 1fr); } }
.t-marks .m-side { position: sticky; top: calc(var(--header-h) + 12px); display: flex; flex-direction: column; gap: 12px; }
@media (max-width: 960px) { .t-marks .m-side { position: static; } }
.t-marks .s-row { display: grid; grid-template-columns: minmax(0, 1fr) 88px 22px 88px 34px; gap: 8px; align-items: center; margin-bottom: 8px; animation: stu-pop .35s var(--ease) both; }
.t-marks .s-row .input { height: 40px; }
.t-marks .s-row .of { text-align: center; color: var(--muted); font-weight: 600; }
.t-marks .s-head { display: grid; grid-template-columns: minmax(0, 1fr) 88px 22px 88px 34px; gap: 8px; font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-bottom: 6px; }
@media (max-width: 520px) {
  .t-marks .s-head { display: none; }
  .t-marks .s-row { grid-template-columns: minmax(0, 1fr) 20px minmax(0, 1fr) 34px; padding-bottom: 10px; border-bottom: 1px dashed var(--border); }
  .t-marks .s-row > :first-child { grid-column: 1 / -1; }
}
.t-marks .s-row.fail .input:first-child { border-color: var(--danger); }
.t-marks .hero { display: flex; align-items: center; gap: 16px; }
.t-marks .gradebox { display: grid; place-items: center; min-width: 88px; padding: 10px 14px; border-radius: 20px; text-align: center; background: linear-gradient(145deg, color-mix(in srgb, var(--g, var(--accent)) 24%, var(--surface)), var(--surface)); border: 1px solid color-mix(in srgb, var(--g, var(--accent)) 40%, var(--border)); }
.t-marks .gradebox b { font-size: 34px; letter-spacing: -.04em; line-height: 1; color: var(--g, var(--accent)); }
.t-marks .gradebox span { font-size: 12px; color: var(--muted); margin-top: 4px; }
.t-marks .bars { display: flex; flex-direction: column; gap: 9px; }
.t-marks .bar-row { display: grid; grid-template-columns: 96px minmax(0, 1fr) 54px; gap: 8px; align-items: center; font-size: 13px; }
.t-marks .bar-row .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-2); }
.t-marks .track { height: 12px; border-radius: 99px; background: var(--surface-3); overflow: hidden; }
.t-marks .fill { display: block; height: 100%; width: 0; border-radius: inherit; background: var(--bc); transition: width .9s var(--ease); }
.t-marks .bar-row .pc { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
.t-marks .bar-row.dim { opacity: .45; }
.t-marks .chips-t { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
`

const newRow = (name = '') => ({ name, got: NaN, max: 100 })
const bandColor = (pct) => (pct >= 75 ? '#10b981' : pct >= 60 ? '#6366f1' : pct >= 40 ? '#f59e0b' : '#ef4444')

export function mount(root) {
  toolStyle('marks', CSS)
  const saved = load('marks:state', null)
  const st = saved?.rows?.length ? saved : { rows: Array.from({ length: 5 }, () => newRow()), scheme: 'cbse', passPct: 33, bestN: 0, target: 75, remaining: 100 }
  for (const r of st.rows) { if (r.got == null) r.got = NaN; if (r.max == null) r.max = 100 }
  const persist = () => save('marks:state', st)

  const rowsBox = h('div')
  const barsBox = h('div', { class: 'bars' })
  const ringEl = ring({ value: 0, max: 100, size: 150, stroke: 13, label: 'percent', fmt: (v) => v.toFixed(1) + '%' })
  const gradeBox = h('div', { class: 'gradebox' })
  const statsBox = h('div', { class: 'mini-stats', style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px' })
  const statusBox = h('div', { style: 'margin-top:10px' })
  const planOut = h('div')
  let lastGrade = ''

  function renderRows() {
    clear(rowsBox)
    rowsBox.append(h('div', { class: 's-head' }, h('span', 'Subject'), h('span', 'Obtained'), h('span'), h('span', 'Out of'), h('span')))
    st.rows.forEach((r, i) => {
      rowsBox.append(h('div', { class: 's-row', dataset: { i } },
        h('input', { class: 'input', type: 'text', placeholder: `Subject ${i + 1}`, value: r.name, 'aria-label': `Name of subject ${i + 1}`, oninput: (e) => { r.name = e.target.value; persist(); update() } }),
        h('input', { class: 'input', type: 'number', min: 0, step: 'any', inputmode: 'decimal', value: r.got, placeholder: '0', 'aria-label': `Marks obtained in subject ${i + 1}`, oninput: (e) => { r.got = e.target.valueAsNumber; persist(); update() } }),
        h('span', { class: 'of' }, '/'),
        h('input', { class: 'input', type: 'number', min: 0, step: 'any', inputmode: 'decimal', value: r.max, 'aria-label': `Maximum marks of subject ${i + 1}`, oninput: (e) => { r.max = e.target.valueAsNumber; persist(); update() } }),
        button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: `Remove subject ${i + 1}`, onClick: () => { st.rows.splice(i, 1); persist(); renderRows(); update() } })))
    })
  }

  function update() {
    const sum = summarize(st.rows, { passPct: st.passPct, bestN: st.bestN })
    // flag failing subjects and over-max entries
    rowsBox.querySelectorAll('.s-row').forEach((el) => {
      const r = st.rows[+el.dataset.i]
      const bad = Number.isFinite(r.got) && r.max > 0 && (r.got / r.max) * 100 + 1e-9 < st.passPct
      el.classList.toggle('fail', !!bad)
    })
    const pct = Number.isFinite(sum.pct) ? sum.pct : 0
    ringEl.update(pct, 'percent')
    ringEl.setColor(bandColor(pct))
    const band = Number.isFinite(sum.pct) ? bandFor(sum.pct, st.scheme) : null
    clear(gradeBox, band ? [h('b', band[1]), h('span', band[2])] : [h('b', '-'), h('span', 'Add marks')])
    gradeBox.style.setProperty('--g', band ? bandColor(pct) : 'var(--muted)')
    if (band && band[1] !== lastGrade) { gradeBox.classList.remove('stu-bounce'); void gradeBox.offsetWidth; gradeBox.classList.add('stu-bounce'); if (band[1] === SCHEMES[st.scheme].bands[0][1] && lastGrade) confetti(gradeBox, { count: 70 }) }
    lastGrade = band ? band[1] : ''
    clear(statsBox,
      mini('Total', sum.valid ? `${formatNumber(sum.got, 2)} / ${formatNumber(sum.max, 2)}` : '-'),
      mini('Subjects counted', sum.valid ? String(sum.rows.filter((r) => r.counted).length) : '-'),
      mini('Best subject', sum.highest ? `${sum.highest.name || 'Subject'} ${sum.highest.pct.toFixed(0)}%` : '-'),
      mini('Weakest', sum.lowest ? `${sum.lowest.name || 'Subject'} ${sum.lowest.pct.toFixed(0)}%` : '-'))
    const over = sum.rows.filter((r) => r.over)
    clear(statusBox,
      !sum.valid ? null
        : over.length ? pill(`${over[0].name || 'A subject'} has more marks than its maximum`, 'warn', 'triangle-alert')
          : st.passPct > 0 ? (sum.failedCount ? pill(`Below pass mark in ${sum.failedCount} subject${sum.failedCount > 1 ? 's' : ''}`, 'bad', 'circle-x') : pill(`Passed every subject (pass mark ${st.passPct}%)`, 'ok', 'circle-check')) : null,
      st.scheme === 'cbse' && Number.isFinite(sum.pct) ? h('div', { class: 'stu-hint', style: 'margin-top:8px' }, `Equivalent CBSE CGPA is about ${(sum.pct / 9.5).toFixed(1)} (percentage / 9.5).`) : null)
    // bars
    clear(barsBox)
    if (!sum.valid) barsBox.append(h('div', { class: 'stu-hint' }, 'Enter marks to see how each subject compares.'))
    sum.rows.forEach((r, i) => {
      const fill = h('span', { class: 'fill', style: { '--bc': bandColor(r.pct) } })
      barsBox.append(h('div', { class: ['bar-row', !r.counted && 'dim'], title: r.counted ? '' : 'Not counted (outside your best subjects)' }, h('span', { class: 'nm' }, r.name || `Subject ${r.idx + 1}`),
        h('span', { class: 'track' }, fill), h('span', { class: 'pc' }, `${r.pct.toFixed(1)}%`)))
      requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = `${Math.min(100, r.pct)}%` }))
    })
    // planner
    const need = marksNeeded(sum.got, sum.max, st.target, st.remaining)
    clear(planOut,
      !sum.valid ? h('div', { class: 'stu-hint' }, 'Add some marks first.')
        : !Number.isFinite(need) ? h('div', { class: 'stu-hint' }, 'Enter the marks still to come.')
          : need > st.remaining + 1e-9 ? pill(`Out of reach: you would need ${formatNumber(need, 1)} of ${st.remaining}`, 'bad', 'triangle-alert')
            : need <= 0 ? pill('You already have enough for this target', 'ok', 'circle-check')
              : pill(`Score ${formatNumber(Math.ceil(need * 100) / 100, 2)} of ${st.remaining} (${((need / st.remaining) * 100).toFixed(1)}%)`, need / st.remaining > 0.85 ? 'warn' : 'ok', 'target'))
  }
  const mini = (k, v) => h('div', { class: 'mini', style: 'padding:10px 12px;border-radius:14px;background:var(--surface);border:1px solid var(--border);min-width:0' }, h('small', { style: 'display:block;color:var(--muted);font-size:12px' }, k), h('b', { style: 'font-size:16px;letter-spacing:-.02em;overflow-wrap:anywhere' }, v))

  const templateChips = h('div', { class: 'chips-t' }, h('span', { class: 'stu-hint', style: 'align-self:center' }, 'Quick start:'),
    ...[['cbse10', 'CBSE Class 10'], ['pcm', 'Class 12 PCM'], ['six', '6 subjects']].map(([k, l]) => h('button', { type: 'button', class: 'stu-chip-btn', onclick: () => {
      st.rows = TEMPLATES[k].map((n) => newRow(n)); persist(); renderRows(); update()
    } }, l)))

  const schemeSel = select(Object.entries(SCHEMES).map(([k, v]) => [k, v.label]), st.scheme, (v) => { st.scheme = v; persist(); update() })
  const passIn = number(st.passPct, { min: 0, max: 100, onInput: (n) => { st.passPct = Number.isFinite(n) ? n : 0; persist(); update() } })
  const bestIn = number(st.bestN || '', { min: 0, step: 1, placeholder: 'All', onInput: (n) => { st.bestN = Number.isFinite(n) ? Math.floor(n) : 0; persist(); update() } })
  const tgtIn = number(st.target, { min: 0, max: 100, onInput: (n) => { st.target = n; persist(); update() } })
  const remIn = number(st.remaining, { min: 0, onInput: (n) => { st.remaining = n; persist(); update() } })

  const copy = () => {
    const sum = summarize(st.rows, { passPct: st.passPct, bestN: st.bestN })
    const band = Number.isFinite(sum.pct) ? bandFor(sum.pct, st.scheme) : null
    copyText(sum.rows.map((r) => `${r.name || 'Subject'}: ${r.got}/${r.max} (${r.pct.toFixed(1)}%)`).join('\n') + `\nTotal: ${sum.got}/${sum.max}\nPercentage: ${Number.isFinite(sum.pct) ? sum.pct.toFixed(2) : '-'}%${band ? `\nGrade: ${band[1]} (${band[2]})` : ''}`)
  }

  renderRows()
  root.append(stage('t-marks', h('div', { class: 'm-wrap' },
    h('div', { class: 'stack' },
      tile({ tint: '#6366f1', i: 0 }, templateChips, rowsBox,
        h('div', { class: 'row', style: 'margin-top:4px' }, button('Add subject', { icon: 'plus', size: 'sm', onClick: () => { st.rows.push(newRow()); persist(); renderRows(); update(); rowsBox.querySelector('.s-row:last-child input')?.focus() } }),
          button('Copy result', { icon: 'copy', size: 'sm', variant: 'ghost', onClick: copy }),
          button('Clear', { icon: 'eraser', size: 'sm', variant: 'ghost', onClick: () => confirmModal({ title: 'Clear all marks?', text: 'Subjects and marks saved on this device will be removed.', yes: 'Clear', danger: true }, () => { st.rows = Array.from({ length: 5 }, () => newRow()); persist(); renderRows(); update() }) }))),
      tile({ tint: '#ec4899', title: 'How each subject did', icon: 'bar-chart-3', i: 1 }, barsBox)),
    h('div', { class: 'm-side' },
      tile({ tint: '#10b981', i: 0 }, h('div', { class: 'hero' }, ringEl, gradeBox), statsBox, statusBox),
      tile({ tint: '#f59e0b', title: 'Settings', icon: 'sliders-horizontal', i: 1 },
        h('div', { class: 'stack' },
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Grading scheme'), schemeSel),
          h('div', { class: 'grid-2' },
            h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Pass mark per subject (%)'), passIn),
            h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Count best N subjects'), bestIn)))),
      tile({ tint: '#0ea5e9', title: 'Marks needed in the next exam', icon: 'target', i: 2 },
        h('div', { class: 'stack' }, h('div', { class: 'grid-2' },
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Target overall %'), tgtIn),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Marks still to come'), remIn)), planOut))))))
  update()
}
