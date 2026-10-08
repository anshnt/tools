// Time and duration calculator: hours between times (overnight too), add or subtract a duration, sum a list of durations, convert units.
import { h, svg, tabs, number, field, segmented, select, toggle, clear, button, copyText, alert, icon, textarea } from '../../lib/ui.js'
import { useStyles, addStyles, hero, liveTiles, chips, counter, settleOnce } from './_kit.js'
import { load, save } from '../../lib/store.js'
import { today, parseISO, isoDate, fmtDate } from './_dates.js'

const pad = (n) => String(n).padStart(2, '0')
const DAY = 86400

/** "9:30", "09:30 pm", "9pm", "2130", "21:15:30" -> seconds since midnight (NaN when it is not a time). */
export function parseClock(s) {
  const m = /^\s*(\d{1,2})(?::?(\d{2}))?(?::(\d{2}))?\s*(a|p)?\.?m?\.?\s*$/i.exec(String(s))
  if (!m) return NaN
  let hh = +m[1]
  const mm = m[2] ? +m[2] : 0, ss = m[3] ? +m[3] : 0, ap = m[4]?.toLowerCase()
  if (mm > 59 || ss > 59) return NaN
  if (ap) { if (hh < 1 || hh > 12) return NaN; hh = (hh % 12) + (ap === 'p' ? 12 : 0) } else if (hh > 23) return NaN
  return hh * 3600 + mm * 60 + ss
}

const UNIT = { d: 86400, day: 86400, days: 86400, h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600, m: 60, min: 60, mins: 60, minute: 60, minutes: 60, s: 1, sec: 1, secs: 1, second: 1, seconds: 1 }
/**
 * Duration text -> seconds (NaN when unreadable). Understands 1:30, 1:30:15, 90m, 1h 30m, 1h30, 2 hrs 15 mins, 1.5h, 45 min, 1d 2h.
 * A bare number such as 1.5 means hours. A leading minus makes it negative.
 */
export function parseDuration(str) {
  let s = String(str).trim().toLowerCase().replace(/[,]|\band\b/g, ' ').replace(/\s+/g, ' ')
  if (!s) return NaN
  let sign = 1
  if (s[0] === '-' || s[0] === '−') { sign = -1; s = s.slice(1).trim() }
  let m
  if ((m = /^(\d+):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?$/.exec(s))) return sign * (+m[1] * 3600 + +m[2] * 60 + (m[3] ? +m[3] : 0))
  if (/^\d+(\.\d+)?$/.test(s)) return sign * parseFloat(s) * 3600
  const re = /(\d+(?:\.\d+)?)\s*([a-z]*)/g
  let total = 0, last = '', any = false, end = 0
  while ((m = re.exec(s))) {
    if (s.slice(end, m.index).trim()) return NaN
    end = re.lastIndex
    let u = m[2]
    if (!u) { if (last === 'h' || last === 'hr' || last === 'hrs' || last === 'hour' || last === 'hours') u = 'm'; else if (/^(m|min|mins|minute|minutes)$/.test(last)) u = 's'; else return NaN }
    if (!(u in UNIT)) return NaN
    total += parseFloat(m[1]) * UNIT[u]
    last = u
    any = true
  }
  return any && s.slice(end).trim() === '' ? sign * total : NaN
}

/** A list line -> {sec, kind: 'duration' | 'range', overnight}. "9:00-17:30" and "10pm to 6am" are ranges (overnight adds a day). */
export function parseLine(line) {
  const tryParse = (s) => {
    const r = /^(.+?)\s*(?:-|\u2013|\u2014|\bto\b|\buntil\b)\s*(.+)$/i.exec(s)
    if (r) {
      const a = parseClock(r[1]), b = parseClock(r[2])
      if (Number.isFinite(a) && Number.isFinite(b)) return { sec: (b - a + DAY) % DAY, kind: 'range', overnight: b <= a && b !== a }
    }
    const d = parseDuration(s)
    return Number.isFinite(d) ? { sec: d, kind: 'duration' } : null
  }
  const s = String(line).trim()
  if (!s) return null
  return tryParse(s) || tryParse(s.replace(/^[^\d\-−]*/, '')) || { error: true }
}

/** seconds -> 8:30 or 8:30:15 (with sign). */
export function fmtHMS(sec, showSec = false) {
  const neg = sec < 0
  let s = Math.round(Math.abs(sec))
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60
  return `${neg ? '-' : ''}${hh}:${pad(mm)}${showSec || ss ? ':' + pad(ss) : ''}`
}
/** seconds -> "2 days 3 hours 5 minutes". */
export function fmtLong(sec) {
  const neg = sec < 0
  let s = Math.round(Math.abs(sec))
  const parts = [[86400, 'day'], [3600, 'hour'], [60, 'minute'], [1, 'second']].map(([n, w]) => { const v = Math.floor(s / n); s %= n; return v ? `${v} ${w}${v === 1 ? '' : 's'}` : '' }).filter(Boolean)
  return (neg ? '-' : '') + (parts.length ? parts.join(' ') : '0 minutes')
}
/** Seconds of the day -> 17:30 or 5:30 PM. */
export function fmtClock(sec, h24, showSec = false) {
  const s = ((Math.round(sec) % DAY) + DAY) % DAY
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60
  const tail = showSec ? ':' + pad(ss) : ''
  return h24 ? `${pad(hh)}:${pad(mm)}${tail}` : `${hh % 12 || 12}:${pad(mm)}${tail} ${hh < 12 ? 'AM' : 'PM'}`
}

const nowSec = () => { const d = new Date(); return d.getHours() * 3600 + d.getMinutes() * 60 }
const timeVal = (sec) => `${pad(Math.floor(sec / 3600) % 24)}:${pad(Math.floor((sec % 3600) / 60))}`
const parseTimeInput = (v) => (v ? parseClock(v) : NaN)
const numOr0 = (v) => (Number.isFinite(v) ? v : 0)

function dial() {
  const S = 176, R = 68, C = 2 * Math.PI * R, cx = S / 2
  const gid = 'tdd' + Math.random().toString(36).slice(2, 7)
  const arc = svg('circle', { cx, cy: cx, r: R, fill: 'none', stroke: `url(#${gid})`, 'stroke-width': 14, 'stroke-linecap': 'round', 'stroke-dasharray': `0 ${C}`, class: 'arc' })
  const k1 = svg('circle', { r: 8, class: 'knob' }), k2 = svg('circle', { r: 8, class: 'knob end' })
  const ticks = [0, 6, 12, 18].map((hr) => { const a = (hr / 24) * 2 * Math.PI; return svg('text', { x: cx + (R + 24) * Math.sin(a), y: cx - (R + 24) * Math.cos(a) + 4, 'text-anchor': 'middle', class: 'tick' }, String(hr)) })
  const center = h('div', { class: 'mid' })
  const el = h('div', { class: 'ct-dial', role: 'img', 'aria-label': 'A 24 hour dial showing the time span' },
    svg('svg', { viewBox: `0 0 ${S} ${S}`, width: S, height: S, 'aria-hidden': 'true' },
      svg('defs', svg('linearGradient', { id: gid, x1: 0, y1: 0, x2: 1, y2: 1 }, svg('stop', { offset: '0%', 'stop-color': '#6366f1' }), svg('stop', { offset: '60%', 'stop-color': '#ec4899' }), svg('stop', { offset: '100%', 'stop-color': '#f97316' }))),
      svg('circle', { cx, cy: cx, r: R, fill: 'none', 'stroke-width': 14, class: 'track' }), arc, k1, k2, ticks), center)
  const at = (sec) => { const a = ((sec % DAY) / DAY) * 2 * Math.PI; return [cx + R * Math.sin(a), cx - R * Math.cos(a)] }
  return {
    el, center,
    set(startSec, durSec, label) {
      const frac = Math.min(1, Math.max(0, durSec / DAY))
      arc.style.transform = `rotate(${(startSec / DAY) * 360 - 90}deg)`
      arc.setAttribute('stroke-dasharray', `${C * frac} ${C}`)
      const [x1, y1] = at(startSec), [x2, y2] = at(startSec + durSec)
      k1.setAttribute('cx', x1); k1.setAttribute('cy', y1); k2.setAttribute('cx', x2); k2.setAttribute('cy', y2)
      center.replaceChildren(h('b', label), h('span', '24 hour dial'))
    },
  }
}

const CSS = `
.ct-dial { position: relative; flex: none; width: 176px; height: 176px; }
.ct-dial svg { display: block; overflow: visible; }
.ct-dial .track { stroke: color-mix(in srgb, var(--text) 9%, transparent); }
.ct-dial .arc { transform-origin: 50% 50%; transition: transform .7s var(--ease), stroke-dasharray .7s var(--ease); }
.ct-dial .knob { fill: var(--surface); stroke: var(--c, var(--accent)); stroke-width: 3.5; }
.ct-dial .knob.end { stroke: #ec4899; }
.ct-dial .tick { font-size: 10px; fill: var(--muted); font-variant-numeric: tabular-nums; }
.ct-dial .mid { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; line-height: 1.15; }
.ct-dial .mid b { font-size: 21px; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.ct-dial .mid span { font-size: 11px; color: var(--muted); }
.ct-line { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 8px 12px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); font-size: 13.5px; }
.ct-line code { overflow-wrap: anywhere; }
.ct-line.bad { border-color: color-mix(in srgb, var(--danger) 40%, var(--border)); background: var(--danger-soft); }
.ct-line b { font-variant-numeric: tabular-nums; white-space: nowrap; }
.ct-line small { color: var(--muted); margin-left: 6px; }
`

export function mount(root) {
  useStyles()
  addStyles('ct-timediff', CSS)
  let h24 = load('timediff:h24', true)
  const fmtT = (sec, showSec) => fmtClock(sec, h24, showSec)
  const redraw = new Set()
  const fmtSeg = segmented([['24', '24 hour'], ['12', '12 hour']], h24 ? '24' : '12', (v) => { h24 = v === '24'; save('timediff:h24', h24); for (const f of redraw) f() }, 'Clock format')

  const t = tabs([
    { id: 'between', label: 'Between two times', render: tabBetween },
    { id: 'addsub', label: 'Add or subtract', render: tabAddSub },
    { id: 'sum', label: 'Add up durations', render: tabSum },
    { id: 'convert', label: 'Convert', render: tabConvert },
  ], load('timediff:tab', 'between'), (id) => save('timediff:tab', id))
  root.append(h('div', { class: 'ct' }, h('div', { class: 'row between' }, h('span', { class: 'small muted' }, 'Everything updates as you type.'), fmtSeg), h('section', { class: 'panel' }, t)))

  // ---------- 1. Between two times ----------
  function tabBetween() {
    const count = counter()
    const startT = h('input', { class: 'input', type: 'time', value: '09:00', 'aria-label': 'Start time', oninput: () => render() })
    const endT = h('input', { class: 'input', type: 'time', value: '17:30', 'aria-label': 'End time', oninput: () => render() })
    const startD = h('input', { class: 'input', type: 'date', value: isoDate(today()), 'aria-label': 'Start date', oninput: () => render() })
    const endD = h('input', { class: 'input', type: 'date', value: isoDate(today()), 'aria-label': 'End date', oninput: () => render() })
    const brk = number(0, { min: 0, step: 5, onInput: () => render(), ariaLabel: 'Break in minutes' })
    const dates = toggle('The times are on different dates', false, (on) => { dateRow.hidden = !on; render() })
    const dateRow = h('div', { class: 'ct-fields', hidden: true }, field('Start date', startD), field('End date', endD))
    const dl = dial()
    const hr = hero({ side: dl.el })
    const hEl = h('span'), mEl = h('span')
    hr.big.classList.add('ct-grad')
    hr.big.append(hEl, h('span', { class: 'u' }, 'hours'), mEl, h('span', { class: 'u' }, 'min'))
    let summary = ''
    hr.actions.append(button('Copy result', { icon: 'copy', size: 'sm', onClick: () => copyText(summary) }))
    const T = liveTiles([
      { key: 'dec', icon: 'hash', label: 'Decimal hours', accent: true },
      { key: 'min', icon: 'timer', label: 'Total minutes', color: '#3e63dd' },
      { key: 'sec', icon: 'zap', label: 'Total seconds', color: '#8e4ec6' },
      { key: 'net', icon: 'coffee', label: 'After the break', color: '#0d9b8a' },
    ], 4)
    const warn = h('div')
    const results = h('div', { class: 'ct' }, hr.el, T.el)

    function render() {
      const a = parseTimeInput(startT.value), b = parseTimeInput(endT.value)
      let total, overnight = false
      if (!Number.isFinite(a) || !Number.isFinite(b)) { results.hidden = true; clear(warn, alert('info', 'Enter a start and an end time.')); return }
      if (dates.input.checked) {
        const da = parseISO(startD.value), db = parseISO(endD.value)
        if (!Number.isFinite(da) || !Number.isFinite(db)) { results.hidden = true; clear(warn, alert('info', 'Pick both dates.')); return }
        total = (db * DAY + b) - (da * DAY + a)
        if (total < 0) { results.hidden = true; clear(warn, alert('warn', 'The end is before the start. Check the dates and times.')); return }
      } else {
        overnight = b <= a
        total = overnight ? b - a + DAY : b - a
      }
      clear(warn)
      results.hidden = false
      settleOnce(results)
      const breakSec = Math.max(0, numOr0(brk.valueAsNumber)) * 60
      const net = Math.max(0, total - breakSec)
      hr.kicker.textContent = overnight ? 'Overnight: ends the next day' : 'Time between'
      const shown = breakSec ? net : total
      count(hEl, 'h', Math.floor(shown / 3600))
      count(mEl, 'm', Math.floor((shown % 3600) / 60))
      hr.lede.textContent = `${fmtT(a)} to ${fmtT(b)}${dates.input.checked ? ` (${fmtDate(parseISO(startD.value), { day: 'numeric', month: 'short' })} to ${fmtDate(parseISO(endD.value), { day: 'numeric', month: 'short' })})` : ''}${breakSec ? `, minus a ${numOr0(brk.valueAsNumber)} minute break` : ''}. That is ${fmtLong(shown)}.`
      T.set('dec', shown / 3600, 'hours as a decimal', { fmt: (v) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })
      T.set('min', shown / 60, 'minutes', { fmt: (v) => Math.round(v).toLocaleString() })
      T.set('sec', shown, 'seconds')
      T.set('net', breakSec ? fmtHMS(net) : 'No break', breakSec ? `${fmtHMS(total)} before the break` : 'add one above', { hide: false })
      dl.set(a, total, fmtHMS(total))
      summary = `${fmtT(a)} to ${fmtT(b)}: ${fmtHMS(shown)} hours (${(shown / 3600).toFixed(2)} decimal)${breakSec ? ` after a ${numOr0(brk.valueAsNumber)} minute break` : ''}.`
    }
    redraw.add(render)
    const el = h('div', { class: 'stack' },
      h('div', { class: 'ct-fields' }, field('Start time', startT), field('End time', endT), field('Break (minutes)', brk)),
      dates, dateRow, warn, results)
    render()
    return el
  }

  // ---------- 2. Add or subtract ----------
  function tabAddSub() {
    let sign = 1
    const start = h('input', { class: 'input', type: 'time', value: timeVal(nowSec()), 'aria-label': 'Starting time', oninput: () => render() })
    const op = segmented([['add', 'Add'], ['sub', 'Subtract']], 'add', (v) => { sign = v === 'add' ? 1 : -1; render() }, 'Add or subtract')
    const fh = number(1, { min: 0, step: 1, onInput: () => render(), ariaLabel: 'Hours' }), fm = number(30, { min: 0, step: 1, onInput: () => render(), ariaLabel: 'Minutes' }), fs = number(0, { min: 0, step: 1, onInput: () => render(), ariaLabel: 'Seconds' })
    const hr = hero()
    hr.big.classList.add('ct-grad')
    let summary = ''
    hr.actions.append(button('Copy time', { icon: 'copy', size: 'sm', onClick: () => copyText(summary) }))
    const pick = (hh, mm) => { fh.value = hh; fm.value = mm; fs.value = 0; render() }
    const q = chips([[0, 15], [0, 30], [0, 45], [1, 0], [1, 30], [2, 0], [4, 0], [8, 0]].map(([hh, mm]) => ({ label: hh && mm ? `${hh}h ${mm}m` : hh ? `${hh} h` : `${mm} min`, onClick: () => pick(hh, mm) })))
    const warn = h('div')
    const results = h('div', { class: 'ct' }, hr.el)
    function render() {
      const s = parseTimeInput(start.value)
      if (!Number.isFinite(s)) { results.hidden = true; clear(warn, alert('info', 'Enter a starting time.')); return }
      clear(warn); results.hidden = false
      const d = Math.max(0, numOr0(fh.valueAsNumber)) * 3600 + Math.max(0, numOr0(fm.valueAsNumber)) * 60 + Math.max(0, numOr0(fs.valueAsNumber))
      const raw = s + sign * d
      const days = Math.floor(raw / DAY)
      const res = ((raw % DAY) + DAY) % DAY
      hr.kicker.textContent = `${fmtT(s)} ${sign > 0 ? 'plus' : 'minus'} ${fmtLong(d)}`
      hr.big.textContent = fmtT(res, res % 60 !== 0)
      hr.lede.textContent = `${fmtClock(res, !h24, res % 60 !== 0)} in the other format. ${days === 0 ? 'Same day.' : days > 0 ? `${days === 1 ? 'The next day' : `${days} days later`}.` : `${days === -1 ? 'The previous day' : `${-days} days earlier`}.`}`
      summary = `${fmtT(s)} ${sign > 0 ? '+' : '-'} ${fmtLong(d)} = ${fmtT(res)}${days ? ` (${days > 0 ? '+' : ''}${days} day${Math.abs(days) === 1 ? '' : 's'})` : ''}`
    }
    redraw.add(render)
    const el = h('div', { class: 'stack' },
      h('div', { class: 'ct-fields' }, field('Starting time', start), field('Operation', op)),
      h('div', { class: 'ct-fields', style: 'grid-template-columns:repeat(3,minmax(0,1fr))' }, field('Hours', fh), field('Minutes', fm), field('Seconds', fs)),
      q, warn, results)
    render()
    return el
  }

  // ---------- 3. Add up durations ----------
  function tabSum() {
    const ta = textarea({ rows: 8, mono: true, 'aria-label': 'Durations, one per line', placeholder: '1:30\n2h 15m\n45 min\n9:00-17:30\n22:00 to 06:00\n1.5\n-0:20', value: load('timediff:list', '') })
    const hr = hero()
    hr.big.classList.add('ct-grad')
    let summary = ''
    hr.actions.append(button('Copy total', { icon: 'copy', size: 'sm', onClick: () => copyText(summary) }))
    const T = liveTiles([
      { key: 'dec', icon: 'hash', label: 'Decimal hours', accent: true },
      { key: 'min', icon: 'timer', label: 'Total minutes', color: '#3e63dd' },
      { key: 'days', icon: 'calendar-days', label: 'Days and hours', color: '#8e4ec6' },
      { key: 'avg', icon: 'chart-no-axes-column', label: 'Average per line', color: '#0d9b8a' },
    ], 4)
    const lines = h('div', { class: 'stack tight' })
    const warn = h('div')
    const results = h('div', { class: 'ct' }, hr.el, T.el, h('section', { class: 'stack' }, h('div', { class: 'ct-h' }, icon('list'), 'Line by line'), lines))
    function render() {
      save('timediff:list', ta.value.length < 20000 ? ta.value : '')
      const rows = ta.value.split(/\r?\n/).map((l) => ({ line: l, r: parseLine(l) })).filter((x) => x.r)
      const good = rows.filter((x) => !x.r.error)
      if (!rows.length) { results.hidden = true; clear(warn, alert('info', 'Type one duration per line. Try 1:30, 2h 15m, 45 min, or a range like 9:00-17:30.')); return }
      clear(warn); results.hidden = false; settleOnce(results)
      const total = good.reduce((s, x) => s + x.r.sec, 0)
      hr.kicker.textContent = `Total of ${good.length} line${good.length === 1 ? '' : 's'}${rows.length > good.length ? `, ${rows.length - good.length} not understood` : ''}`
      hr.big.textContent = `${fmtHMS(total)}`
      hr.lede.textContent = `${fmtLong(total)}.`
      T.set('dec', total / 3600, 'hours as a decimal', { fmt: (v) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })
      T.set('min', total / 60, 'minutes', { fmt: (v) => Math.round(v).toLocaleString() })
      const d = Math.trunc(total / 86400)
      T.set('days', `${d}d ${fmtHMS(total - d * 86400)}`, 'if you count 24 hour days')
      T.set('avg', good.length ? fmtHMS(total / good.length) : '-', 'hours and minutes')
      clear(lines, rows.slice(0, 200).map((x) => h('div', { class: ['ct-line', x.r.error && 'bad'] },
        h('code', x.line.trim()),
        x.r.error ? h('b', 'not understood') : h('b', fmtHMS(x.r.sec), h('small', x.r.kind === 'range' ? (x.r.overnight ? 'range, overnight' : 'range') : 'duration')))))
      summary = `Total: ${fmtHMS(total)} (${(total / 3600).toFixed(2)} hours) from ${good.length} entries.`
    }
    ta.addEventListener('input', render)
    const el = h('div', { class: 'stack' }, field('Durations (one per line)', ta, 'Formats: 1:30, 1h 30m, 90 min, 1.5 (hours), 9:00-17:30 (a range), 22:00 to 06:00 (overnight), -0:20 (subtract).'), warn, results)
    render()
    return el
  }

  // ---------- 4. Convert ----------
  function tabConvert() {
    const U = [['Seconds', 1], ['Minutes', 60], ['Hours', 3600], ['Days', 86400], ['Weeks', 604800], ['Months (30.44 days)', 2629746], ['Years (365.25 days)', 31557600]]
    const val = number(90, { onInput: () => render(), ariaLabel: 'Value' })
    const unit = select(U.map(([n], i) => [i, n]), 1, () => render())
    const dec = number(7.75, { onInput: () => fromDec(), ariaLabel: 'Decimal hours' })
    const hmH = number(7, { min: 0, step: 1, onInput: () => fromHM(), ariaLabel: 'Hours' }), hmM = number(45, { min: 0, step: 1, onInput: () => fromHM(), ariaLabel: 'Minutes' })
    const grid = h('div')
    const T = liveTiles(U.map(([n], i) => ({ key: String(i), icon: ['zap', 'timer', 'clock', 'sun', 'calendar-days', 'calendar', 'hourglass'][i], label: n, accent: i === 2 })), 4)
    function render() {
      const v = val.valueAsNumber
      const sec = v * U[+unit.value][1]
      U.forEach(([n, f], i) => T.set(String(i), Number.isFinite(sec) ? sec / f : '-', i === +unit.value ? 'your value' : '', Number.isFinite(sec) ? { fmt: (x) => (Math.abs(x) >= 1e6 ? x.toExponential(4) : Number(x.toPrecision(10)).toLocaleString(undefined, { maximumFractionDigits: 6 })) } : {}))
      clear(grid, Number.isFinite(sec) ? h('div', { class: 'ct-sub', style: 'margin-top:4px' }, `${fmtLong(sec)} (${fmtHMS(sec)} as hours and minutes)`) : alert('info', 'Enter a number to convert.'))
    }
    function fromDec() { const d = dec.valueAsNumber; if (!Number.isFinite(d)) return; const m = Math.round(d * 60); hmH.value = Math.floor(m / 60); hmM.value = m % 60 }
    function fromHM() { dec.value = Number((numOr0(hmH.valueAsNumber) + numOr0(hmM.valueAsNumber) / 60).toFixed(4)) }
    const el = h('div', { class: 'stack' },
      h('div', { class: 'ct-fields' }, field('Value', val), field('Unit', unit)), grid, T.el,
      h('div', { class: 'ct-h', style: 'margin-top:8px' }, icon('arrow-left-right'), 'Decimal hours and hours:minutes'),
      h('div', { class: 'ct-fields', style: 'grid-template-columns:repeat(auto-fit,minmax(min(100%,120px),1fr))' }, field('Decimal hours', dec), field('Hours', hmH), field('Minutes', hmM)),
      h('div', { class: 'small muted' }, 'Type in either side. 7.75 hours is 7 hours 45 minutes. Handy for timesheets and payroll.'))
    render()
    return el
  }
}
