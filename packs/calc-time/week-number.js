// ISO 8601 week number of a date, and the dates of any week, with a year-at-a-glance grid.
import { h, number, field, button, clear, copyText, icon, alert } from '../../lib/ui.js'
import { useStyles, addStyles, hero, liveTiles, dateField, settleOnce } from './_kit.js'
import { today, ymd, weekday, isoWeek, isoWeekStart, weeksInIsoYear, usWeek, dayOfYear, quarter, fmtDate, WEEKDAYS, MONTHS } from './_dates.js'

/** ISO week-date text: 2026-W41-5 (year, week, weekday 1 = Monday). */
export const isoWeekDate = (n) => { const w = isoWeek(n); return `${w.year}-W${String(w.week).padStart(2, '0')}-${weekday(n) + 1}` }

export function mount(root) {
  useStyles()
  const t = today()
  let sel = t
  const dateF = dateField('Date', t, () => { sel = dateF.get(); Number.isFinite(sel) ? sync() : render() })
  const yearIn = number(isoWeek(t).year, { min: 1, max: 9999, step: 1, onInput: () => fromWeek(), ariaLabel: 'ISO year' })
  const weekIn = number(isoWeek(t).week, { min: 1, max: 53, step: 1, onInput: () => fromWeek(), ariaLabel: 'ISO week' })
  const prev = button('', { icon: 'chevron-left', variant: 'secondary', ariaLabel: 'Previous week', onClick: () => { sel -= 7; sync() } })
  const next = button('', { icon: 'chevron-right', variant: 'secondary', ariaLabel: 'Next week', onClick: () => { sel += 7; sync() } })

  function fromWeek() {
    const y = yearIn.valueAsNumber, w = weekIn.valueAsNumber
    if (!Number.isInteger(y) || !Number.isInteger(w) || y < 1 || y > 9999 || w < 1) return render()
    if (w > weeksInIsoYear(y)) { clear(warn, alert('warn', `${y} only has ${weeksInIsoYear(y)} ISO weeks.`)); results.hidden = true; return }
    sel = isoWeekStart(y, w) + (Number.isFinite(sel) ? weekday(sel) : 0)
    dateF.set(sel)
    render()
  }
  function sync() {
    dateF.set(sel)
    const w = isoWeek(sel)
    yearIn.value = w.year
    weekIn.value = w.week
    render()
  }

  const hr = hero()
  hr.big.classList.add('ct-grad')
  let summary = ''
  hr.actions.append(button('Copy', { icon: 'copy', size: 'sm', onClick: () => copyText(summary) }))
  const T = liveTiles([
    { key: 'iso', icon: 'hash', label: 'ISO week date', accent: true },
    { key: 'year', icon: 'calendar', label: 'ISO week-year', color: '#3e63dd' },
    { key: 'of', icon: 'layers', label: 'Weeks in that year', color: '#8e4ec6' },
    { key: 'left', icon: 'hourglass', label: 'Weeks remaining', color: '#d6409f' },
    { key: 'wd', icon: 'calendar-check', label: 'Day of the week', color: '#0d9b8a' },
    { key: 'doy', icon: 'sun', label: 'Day of the year', color: '#e2a336' },
    { key: 'us', icon: 'flag', label: 'US week number', color: '#e5484d' },
    { key: 'q', icon: 'chart-pie', label: 'Quarter', color: '#f76b15' },
  ], 4)
  const strip = h('div', { class: 'ct-wk' })
  const grid = h('div', { class: 'ct-hm-wrap' })
  const gridPanel = h('section', { class: 'panel stack' }, h('div', { class: 'ct-h' }, icon('layout-grid'), 'The year at a glance'), grid,
    h('div', { class: 'small muted' }, 'Each column is an ISO week (Monday at the top). Click any day to jump to it.'))
  const warn = h('div')
  const results = h('div', { class: 'ct' }, hr.el, strip, T.el, gridPanel)

  function render() {
    if (!Number.isFinite(sel)) { results.hidden = true; clear(warn, alert('info', 'Pick a date to find its ISO week.')); return }
    clear(warn)
    results.hidden = false
    settleOnce(results)
    const w = isoWeek(sel)
    const mon = isoWeekStart(w.year, w.week), sun = mon + 6
    const total = weeksInIsoYear(w.year)
    hr.kicker.textContent = `ISO 8601 week of ${fmtDate(sel, { day: 'numeric', month: 'long', year: 'numeric' })}`
    hr.big.textContent = `Week ${w.week}`
    hr.lede.textContent = `${fmtDate(mon, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} to ${fmtDate(sun, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`
    T.set('iso', isoWeekDate(sel), 'year, week, weekday')
    T.set('year', w.year, w.year !== ymd(sel).y ? `differs from calendar year ${ymd(sel).y}` : 'same as calendar year', { fmt: (v) => String(Math.round(v)) })
    T.set('of', total, total === 53 ? 'a long year' : 'a regular year')
    T.set('left', total - w.week, `after week ${w.week}`)
    T.set('wd', WEEKDAYS[weekday(sel)], `day ${weekday(sel) + 1} of the ISO week`)
    T.set('doy', dayOfYear(sel), 'of the calendar year')
    T.set('us', usWeek(sel), 'Sunday start, week 1 has 1 Jan')
    T.set('q', `Q${quarter(sel)}`, MONTHS[ymd(sel).m - 1])
    clear(strip, [0, 1, 2, 3, 4, 5, 6].map((i) => {
      const d = mon + i
      return h('button', { type: 'button', class: ['ct-wk-d', d === sel && 'on', i >= 5 && 'we', d === t && 'today'], onclick: () => { sel = d; sync() }, 'aria-label': fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' }) },
        h('span', WEEKDAYS[i].slice(0, 3)), h('b', String(ymd(d).d)), h('small', MONTHS[ymd(d).m - 1].slice(0, 3)))
    }))
    drawGrid(w.year, total, w.week)
    summary = `${fmtDate(sel)} is in ISO week ${w.week} of ${w.year} (${isoWeekDate(sel)}). That week runs ${fmtDate(mon)} to ${fmtDate(sun)}.`
  }

  function drawGrid(year, total, week) {
    const first = isoWeekStart(year, 1)
    const cols = []
    for (let wk = 1; wk <= total; wk++) {
      const start = first + (wk - 1) * 7
      cols.push(h('div', { class: ['ct-hm-col', wk === week && 'on'] },
        h('span', { class: 'wn' }, wk === 1 || wk % 4 === 0 || wk === week ? String(wk) : ''),
        [0, 1, 2, 3, 4, 5, 6].map((i) => {
          const d = start + i, p = ymd(d)
          return h('button', {
            type: 'button', tabindex: -1, class: ['c', `m${p.m % 2}`, i >= 5 && 'we', d === sel && 'sel', d === t && 'today', p.y !== year && 'out'], 'aria-label': fmtDate(d),
            title: fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), onclick: () => { sel = d; sync() },
          })
        })))
    }
    clear(grid, h('div', { class: 'ct-hm' }, h('div', { class: 'dl' }, h('span'), ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map((d) => h('span', d))), cols),
      h('div', { class: 'ct-hm-months' }, MONTHS.map((m) => h('span', m.slice(0, 3)))))
  }

  addStyles('ct-weeknum', `
.ct-wk { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
.ct-wk-d { display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 10px 2px; border-radius: 16px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; transition: transform .25s var(--spring), border-color .2s, box-shadow .2s; min-height: 76px; }
.ct-wk-d span { font-size: 11.5px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .06em; }
.ct-wk-d b { font-size: 22px; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.ct-wk-d small { font-size: 11px; color: var(--muted); }
.ct-wk-d.we { background: var(--surface-2); }
.ct-wk-d:hover { transform: translateY(-3px); border-color: color-mix(in srgb, var(--c) 45%, var(--border)); }
.ct-wk-d.today:not(.on) { box-shadow: inset 0 0 0 1.5px var(--c); }
.ct-wk-d.on { background: linear-gradient(145deg, var(--c), color-mix(in srgb, var(--c) 55%, var(--accent-2))); color: #fff; border-color: transparent; box-shadow: 0 12px 24px -12px var(--c); transform: translateY(-3px); }
.ct-wk-d.on span, .ct-wk-d.on small { color: rgba(255, 255, 255, .85); }
.ct-hm-wrap { overflow-x: auto; padding-bottom: 4px; }
.ct-hm { display: flex; gap: 3px; min-width: 640px; }
.ct-hm .dl { display: flex; flex-direction: column; gap: 3px; padding-top: 18px; font-size: 10px; color: var(--muted); width: 26px; flex: none; }
.ct-hm .dl span { height: 14px; line-height: 14px; }
.ct-hm-col { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; border-radius: 8px; transition: background .3s, box-shadow .3s; }
.ct-hm-col .wn { height: 15px; font-size: 10px; line-height: 15px; text-align: center; color: var(--muted); font-variant-numeric: tabular-nums; }
.ct-hm-col.on { background: color-mix(in srgb, var(--c) 14%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 14%, transparent); }
.ct-hm-col.on .wn { color: var(--c); font-weight: 700; }
.ct-hm .c { height: 14px; border: 0; padding: 0; border-radius: 4px; cursor: pointer; background: color-mix(in srgb, var(--c) 22%, var(--surface-2)); transition: transform .15s var(--spring), background .2s; }
.ct-hm .c.m1 { background: color-mix(in srgb, var(--accent) 22%, var(--surface-2)); }
.ct-hm .c.we { opacity: .55; }
.ct-hm .c.out { opacity: .25; }
.ct-hm .c:hover { transform: scale(1.35); }
.ct-hm .c.today { box-shadow: inset 0 0 0 1.5px var(--text); }
.ct-hm .c.sel { background: var(--c); opacity: 1; transform: scale(1.3); box-shadow: 0 4px 10px -3px var(--c); }
.ct-hm-months { display: flex; justify-content: space-between; margin: 6px 0 0 29px; min-width: 611px; font-size: 10.5px; color: var(--muted); }
`)

  root.append(h('div', { class: 'ct' },
    h('section', { class: 'panel stack' }, h('div', { class: 'ct-fields f3' },
      dateF.el, field('ISO year', yearIn), field('Week (1 to 53)', weekIn)),
    h('div', { class: 'row' }, prev, next, h('span', { class: 'small muted' }, 'Type a date, or a year and week: the other side follows.'))),
    warn, results))
  sync()
}
