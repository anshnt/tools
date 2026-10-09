// Meeting time planner: 2 to 6 time zones, working hours highlighted, overlap shown, pick a slot, copy a summary.
import { h, icon, button, select, segmented, field, clear, copyText, alert, toast } from '../../lib/ui.js'
import { useStyles, addStyles, dateField, chips, settleOnce } from './_kit.js'
import { load, save } from '../../lib/store.js'
import { today, ymd, fmtDate } from './_dates.js'
import { localParts, localZone, zonedToMs, tzAbbr, fmtOffset, offsetMin, fmtTime, fmtZoneDate, cleanZones, zonePicker, zoneStrip, cellClass, timelineKey } from './_zones.js'

const MIN = 60_000

/** Which half-hour start slots (0..47 from local midnight of the first zone) fit a meeting of `dur` minutes inside everyone's working hours [ws, we) minutes. */
export function overlapSlots(zones, axisStart, ws, we, dur) {
  const ok = [], score = []
  for (let i = 0; i < 48; i++) {
    const ms = axisStart + i * 30 * MIN
    let inHours = 0, asleep = 0
    for (const z of zones) {
      const p = localParts(z.zone, ms)
      const m = p.hh * 60 + p.mm
      if (m >= ws && m + dur <= we) inHours++
      else if (m < 360 || m >= 1320) asleep++
    }
    ok.push(inHours === zones.length)
    score.push(inHours * 10 - asleep)
  }
  return { ok, score }
}
/** Contiguous runs of true in a boolean array -> [[first, last]]. */
export const runs = (arr) => {
  const out = []
  for (let i = 0; i < arr.length; i++) if (arr[i]) { let j = i; while (arr[j + 1]) j++; out.push([i, j]); i = j }
  return out
}

const CSS = `
.ct-bare { border: 0; background: none; padding: 0; font: inherit; color: inherit; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
.ct-mp-zones { display: flex; flex-wrap: wrap; gap: 8px; }
.ct-mp-zones .ct-chip { padding-right: 6px; }
.ct-mp-zones .ct-chip .home { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: var(--c); }
.ct-mp-zones .ct-chip .btn { height: 22px; width: 22px; border-radius: 99px; }
.ct-mp-pick { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr)); gap: 12px; align-items: end; }
.ct-mp-status { font-size: 11.5px; font-weight: 700; padding: 3px 10px; border-radius: 999px; white-space: nowrap; }
.ct-mp-status.ok { color: var(--success); background: var(--success-soft); }
.ct-mp-status.edge { color: var(--warning); background: var(--warning-soft); }
.ct-mp-status.night { color: #6366f1; background: color-mix(in srgb, #6366f1 12%, transparent); }
.ct-mp-slot { display: flex; flex-direction: column; gap: 8px; }
.ct-mp-slot output { font-family: var(--mono); font-size: 13px; color: var(--text-2); }
`

const stateOf = (m, dur, ws, we) => (m >= ws && m + dur <= we ? 'ok' : m < 360 || m >= 1320 || m + dur > 1380 ? 'night' : 'edge')
const LABEL = { ok: 'In working hours', edge: 'Outside working hours', night: 'Sleeping hours' }

export function mount(root) {
  useStyles()
  addStyles('ct-meet', CSS)
  const local = localZone()
  let zones = cleanZones(load('mp:zones', null) || [local, 'Europe/London', local === 'America/New_York' ? 'America/Los_Angeles' : 'America/New_York'])
  if (zones.length < 2) zones = cleanZones([local, 'Europe/London'])
  let h24 = load('mp:h24', true)
  let ws = load('mp:ws', 540), we = load('mp:we', 1080), dur = load('mp:dur', 60)
  let sel = -1, date = today()

  const dateF = dateField('Meeting date (in the first time zone)', date, () => { date = dateF.get(); if (Number.isFinite(date)) { sel = -1; update() } })
  const halfHours = (from, to) => { const o = []; for (let m = from; m <= to; m += 30) o.push([m, h24 ? `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` : `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, '0')} ${Math.floor(m / 60) % 24 < 12 ? 'AM' : 'PM'}`]); return o }
  const wsSel = h('div'), weSel = h('div')
  const durSel = select([[30, '30 minutes'], [45, '45 minutes'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours']], dur, (v) => { dur = +v; sel = -1; update() })
  const fmtSeg = segmented([['24', '24 hour'], ['12', '12 hour']], h24 ? '24' : '12', (v) => { h24 = v === '24'; save('mp:h24', h24); drawHours(); update() }, 'Clock format')
  function drawHours() {
    const mk = (cur, from, to, set, label) => { const s = select(halfHours(from, to), cur, (v) => { set(+v); sel = -1; update() }); s.setAttribute('aria-label', label); return s }
    clear(wsSel, mk(ws, 0, 1410, (v) => { ws = v; if (we <= ws) we = Math.min(1440, ws + 60); drawHours() }, 'Working day starts'))
    clear(weSel, mk(we, 30, 1440, (v) => { we = v; if (we <= ws) ws = Math.max(0, we - 60); drawHours() }, 'Working day ends'))
  }

  const picker = zonePicker({ placeholder: 'Add a city or time zone', ariaLabel: 'Add a city or time zone to the meeting', onPick: (it) => {
    if (zones.some((z) => z.zone === it.zone)) return toast(`${it.label} is already in the meeting.`)
    if (zones.length >= 6) return toast('A meeting planner for 6 zones is the limit. Remove one first.', 'error')
    zones.push(it); sel = -1; update()
  } })
  const zoneChips = h('div', { class: 'ct-mp-zones' })
  const tlHost = h('div')
  const bestHost = h('div', { class: 'stack tight' })
  const slotIn = h('input', { type: 'range', min: 0, max: 47, step: 1, 'aria-label': 'Meeting start, in half hour steps', oninput: () => { sel = slotIn.valueAsNumber; update({ keepStrips: true }) } })
  const slotOut = h('output')
  const summaryHost = h('section', { class: 'panel stack' })
  const play = h('i', { class: 'ct-sel' })
  let axisStart = 0, ok = [], score = []
  let text = ''

  function stripsFor() {
    const rows = zones.map((z, idx) => {
      const strip = zoneStrip({ zone: z.zone, startMs: axisStart, h24, work: [ws, we], classify: (m, i) => (ok[i] && m >= ws && m < we ? 'best' : cellClass(m, ws, we)) })
      const v = (ms) => fmtTime(ms, z.zone, h24)
      return h('div', { class: 'ct-zr' }, h('div', { class: 'ct-zl' }, h('b', z.label), h('span', `${tzAbbr(z.zone, axisStart) || fmtOffset(offsetMin(z.zone, axisStart))}${idx === 0 ? ' · home' : ''}`)), strip.el)
    })
    const inner = h('div', { class: 'ct-zt-in' }, rows, play)
    const pick = (e) => {
      const r = inner.querySelector('.ct-zs').getBoundingClientRect()
      sel = Math.min(47, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * 48)))
      update({ keepStrips: true })
    }
    inner.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.ct-zs')) return
      inner.setPointerCapture?.(e.pointerId)
      pick(e)
      const mv = (ev) => pick(ev)
      const up = () => { inner.removeEventListener('pointermove', mv); inner.removeEventListener('pointerup', up); inner.removeEventListener('pointercancel', up) }
      inner.addEventListener('pointermove', mv); inner.addEventListener('pointerup', up); inner.addEventListener('pointercancel', up)
    })
    clear(tlHost, h('div', { class: 'ct-zt' }, h('div', { class: 'ct-zt-scroll' }, inner)))
  }

  function update(opts = {}) {
    save('mp:zones', zones); save('mp:ws', ws); save('mp:we', we); save('mp:dur', dur)
    const base = zones[0].zone
    const { y, m, d } = ymd(date)
    axisStart = zonedToMs(y, m, d, 0, 0, base).ms
    ;({ ok, score } = overlapSlots(zones, axisStart, ws, we, dur))
    const wins = runs(ok)
    if (sel < 0) sel = wins.length ? wins[0][0] : score.indexOf(Math.max(...score))

    clear(zoneChips, zones.map((z, i) => h('span', { class: 'ct-chip', title: i === 0 ? 'Home time zone' : `Make ${z.label} the home time zone` },
      h('button', { type: 'button', class: 'ct-bare', onclick: () => { if (i) { zones = [z, ...zones.filter((x) => x !== z)]; sel = -1; update() } } },
        z.label, i === 0 ? h('span', { class: 'home' }, 'home') : null),
      button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: `Remove ${z.label}`, disabled: zones.length <= 2, onClick: () => { zones = zones.filter((x) => x !== z); sel = -1; update() } }))))

    if (!opts.keepStrips) stripsFor()
    const bandW = dur / 1440
    play.style.setProperty('--sp', String(sel / 48))
    play.style.setProperty('--sw', String(bandW))
    slotIn.value = sel
    const selMs = axisStart + sel * 30 * MIN
    slotOut.textContent = `${fmtTime(selMs, base, h24)} ${zones[0].label}`

    clear(bestHost, wins.length
      ? [h('div', { class: 'ct-h' }, icon('sparkles'), `Everyone is in working hours for a ${dur === 60 ? '1 hour' : dur + ' minute'} meeting:`),
        chips(wins.map(([a, b]) => ({ label: `${fmtTime(axisStart + a * 30 * MIN, base, h24)} to ${fmtTime(axisStart + (b * 30 + dur) * MIN, base, h24)} ${zones[0].label}`, icon: 'clock', pressed: sel >= a && sel <= b, onClick: () => { sel = a; update({ keepStrips: true }) } })))]
      : alert('warn', 'No time fits everyone\'s working hours that day. The highlighted slot is the closest fit; try shorter working hours, a shorter meeting or fewer zones.'))

    // summary of the selected slot
    const lines = zones.map((z) => {
      const s = localParts(z.zone, selMs), e = localParts(z.zone, selMs + dur * MIN)
      const mins = s.hh * 60 + s.mm
      const st = stateOf(mins, dur, ws, we)
      return { z, st, when: `${fmtZoneDate(selMs, z.zone, { weekday: 'short', day: 'numeric', month: 'short' })}, ${fmtTime(selMs, z.zone, h24)} to ${fmtTime(selMs + dur * MIN, z.zone, h24)}`, abbr: tzAbbr(z.zone, selMs) || fmtOffset(offsetMin(z.zone, selMs)) }
    })
    text = `Meeting: ${fmtDate(date)}, ${dur} minutes\n` + lines.map((l) => `${l.z.label} (${l.abbr}): ${l.when}`).join('\n')
    clear(summaryHost, h('div', { class: 'ct-h' }, icon('calendar-clock'), 'Selected slot, in each time zone'),
      h('ul', { class: 'ct-list' }, lines.map((l, i) => h('li', { class: 'ct-li', style: { '--i': i, '--c': l.st === 'ok' ? 'var(--success)' : l.st === 'edge' ? 'var(--warning)' : '#6366f1' } },
        h('span', { class: 'dot' }, icon(l.st === 'night' ? 'moon-star' : l.st === 'edge' ? 'sunset' : 'briefcase')),
        h('div', { class: 'tx' }, h('b', `${l.z.label} (${l.abbr})`), h('span', l.when)),
        h('span', { class: ['ct-mp-status', l.st] }, LABEL[l.st])))),
      h('div', { class: 'row' }, button('Copy summary', { icon: 'copy', size: 'sm', onClick: () => copyText(text) })))
    settleOnce(root.firstChild)
  }

  root.append(h('div', { class: 'ct' },
    h('section', { class: 'panel stack' },
      h('div', { class: 'ct-fields' }, field('Add a zone (2 to 6)', picker.el), dateF.el),
      zoneChips,
      h('div', { class: 'ct-mp-pick' }, field('Workday starts', wsSel), field('Workday ends', weSel), field('Meeting length', durSel), h('div', { class: 'row', style: 'justify-content:flex-end' }, fmtSeg))),
    tlHost, timelineKey(),
    h('section', { class: 'panel ct-mp-slot' }, h('div', { class: 'ct-h' }, icon('sliders-horizontal'), 'Meeting start', h('span', { style: 'margin-left:auto' }, slotOut)), slotIn,
      h('div', { class: 'small muted' }, 'Click or drag on the grid, or use this slider. Bright green means everyone is within working hours.')),
    bestHost, summaryHost))
  drawHours()
  update()
}
