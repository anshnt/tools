// Time zone converter: one moment, many cities. All IANA zones, city search, DST aware, draggable day timeline.
import { h, icon, button, segmented, field, clear, copyText, alert, toast } from '../../lib/ui.js'
import { useStyles, addStyles, settleOnce, hashParams, setHashParams } from './_kit.js'
import { load, save } from '../../lib/store.js'
import { isoDate, parseISO, toDayNum, ymd } from './_dates.js'
import {
  localParts, localZone, offsetMin, zonedToMs, isDst, fmtOffset, tzAbbr, localDay, fmtTime, fmtZoneDate, cleanZones, cityOf, zonePicker, zoneStrip, timelineKey,
} from './_zones.js'

const MIN = 60_000
const PHASE = { night: ['moon-star', '#4f46e5'], dawn: ['sunrise', '#f97316'], day: ['sun', '#0ea5e9'], dusk: ['sunset', '#ec4899'] }
const phaseOf = (hh) => (hh >= 5 && hh < 8 ? 'dawn' : hh >= 8 && hh < 17 ? 'day' : hh >= 17 && hh < 20 ? 'dusk' : 'night')

const CSS = `
.ct-zgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr)); gap: 12px; }
.ct-zc { --pc: #0ea5e9; position: relative; overflow: hidden; isolation: isolate; border-radius: 22px; padding: 16px; border: 1px solid color-mix(in srgb, var(--pc) 24%, var(--border));
  background: linear-gradient(160deg, color-mix(in srgb, var(--pc) 15%, var(--surface)), var(--surface) 62%); box-shadow: var(--shadow-sm); transition: transform .3s var(--ease), box-shadow .3s, border-color .6s, background .6s; animation: ctPop .5s var(--spring) both; }
.ct-zc::after { content: ""; position: absolute; z-index: -1; width: 150px; height: 150px; right: -50px; top: -60px; border-radius: 50%; background: radial-gradient(circle, color-mix(in srgb, var(--pc) 32%, transparent), transparent 70%); transition: background .6s; }
.ct-zc:hover { transform: translateY(-3px); box-shadow: var(--shadow); }
.ct-zc.src { border-color: color-mix(in srgb, var(--c) 55%, var(--border)); box-shadow: 0 14px 34px -18px var(--c); }
.ct-zc-top { display: flex; align-items: center; gap: 10px; }
.ct-zc-ico { width: 34px; height: 34px; border-radius: 12px; display: grid; place-items: center; flex: none; color: var(--pc); background: color-mix(in srgb, var(--pc) 16%, var(--surface)); transition: color .6s, background .6s; }
.ct-zc-ico .icon { width: 18px; height: 18px; }
.ct-zc-names { flex: 1; min-width: 0; line-height: 1.2; }
.ct-zc-names b { display: block; font-size: 15.5px; font-weight: 650; letter-spacing: -.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ct-zc-names span { font-size: 11.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
.ct-zc-btns { display: flex; gap: 2px; flex: none; margin-right: -6px; }
.ct-zc-time { margin: 14px 0 2px; font-size: clamp(34px, 5vw, 44px); font-weight: 700; letter-spacing: -.045em; font-variant-numeric: tabular-nums; line-height: 1; }
.ct-zc-time small { font-size: .38em; letter-spacing: 0; font-weight: 600; color: var(--muted); margin-left: 6px; }
.ct-zc-date { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13.5px; color: var(--text-2); }
.ct-zc-date .tag { font-size: 11.5px; font-weight: 600; padding: 2px 9px; border-radius: 999px; color: var(--pc); background: color-mix(in srgb, var(--pc) 13%, transparent); }
.ct-zc-meta { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 10px; font-size: 12px; color: var(--muted); }
.ct-zc-meta .dst { color: var(--warning); font-weight: 600; }
.ct-src-tag { font-style: normal; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; padding: 2px 7px; border-radius: 6px; color: #fff; background: var(--c); margin-left: 6px; vertical-align: middle; }
.ct-slide { display: flex; flex-direction: column; gap: 8px; }
.ct-slide input[type=range] { width: 100%; }
`

/** Everything the cards show for one zone at one instant. Pure and testable. */
export function zoneView(zone, ms, srcZone) {
  const p = localParts(zone, ms)
  const off = offsetMin(zone, ms)
  const dayDiff = localDay(zone, ms) - localDay(srcZone, ms)
  return { ...p, offset: off, diffMin: off - offsetMin(srcZone, ms), dayDiff, dst: isDst(zone, ms), abbr: tzAbbr(zone, ms), phase: phaseOf(p.hh) }
}
export const diffText = (min) => {
  if (min === 0) return 'same time as the source'
  const a = Math.abs(min), hh = Math.floor(a / 60), mm = a % 60
  return `${hh ? `${hh}h` : ''}${hh && mm ? ' ' : ''}${mm ? `${mm}m` : ''} ${min > 0 ? 'ahead of' : 'behind'} the source`
}
const dayTag = (n) => (n === 0 ? 'Same day' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : `${n > 0 ? '+' : ''}${n} days`)

const DEFAULT_TARGETS = ['America/Los_Angeles', 'America/New_York', 'Europe/London', 'UTC', 'Asia/Dubai', 'Asia/Tokyo']

export function mount(root) {
  useStyles()
  addStyles('ct-tzconv', CSS)
  const q = hashParams()
  const tokens = (s) => (s ? s.split(',').map((t) => { const [zone, label] = t.split('|'); return { zone, label } }) : null)
  let h24 = load('tz:h24', true)
  let from = cleanZones([tokens(q.get('from'))?.[0] || load('tz:from', null) || localZone()])[0] || { zone: 'UTC', label: 'UTC' }
  let targets = cleanZones(tokens(q.get('to')) || load('tz:targets', null) || DEFAULT_TARGETS.filter((z) => z !== from.zone))
  let ms = Math.floor(Date.now() / MIN) * MIN
  let note = null
  const at = q.get('at')
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at || '')) {
    const d = parseISO(at.slice(0, 10))
    if (Number.isFinite(d)) { const { y, m, d: dd } = ymd(d); ms = zonedToMs(y, m, dd, +at.slice(11, 13), +at.slice(14, 16), from.zone).ms }
  }

  const dateIn = h('input', { class: 'input', type: 'date', 'aria-label': 'Date in the source time zone', oninput: () => fromInputs() })
  const timeIn = h('input', { class: 'input', type: 'time', 'aria-label': 'Time in the source time zone', oninput: () => fromInputs() })
  const slider = h('input', { type: 'range', min: 0, max: 1435, step: 5, 'aria-label': 'Drag to change the time of day', oninput: () => { ms = axisStart + slider.valueAsNumber * MIN; update({ slider: false }) } })
  const sliderOut = h('output')
  const srcPick = zonePicker({ placeholder: `${from.label} (${from.zone.replace(/_/g, ' ')})`, ariaLabel: 'Source city or time zone', onPick: (it) => {
    const p = localParts(from.zone, ms)
    from = it
    ms = zonedToMs(p.y, p.m, p.d, p.hh, p.mm, from.zone).ms
    targets = targets.filter((t) => t.zone !== from.zone)
    update({ rebuild: true })
  } })
  const addPick = zonePicker({ placeholder: 'Add a city or time zone (Tokyo, PST, Berlin...)', ariaLabel: 'Add a city or time zone', onPick: (it) => {
    if (it.zone === from.zone || targets.some((t) => t.zone === it.zone)) return toast(`${it.label} is already on the list.`)
    if (targets.length >= 12) return toast('That is plenty. Remove one to add another.', 'error')
    targets.push(it)
    update({ rebuild: true })
  } })
  const fmtSeg = segmented([['24', '24 hour'], ['12', '12 hour']], h24 ? '24' : '12', (v) => { h24 = v === '24'; save('tz:h24', h24); update({ rebuild: true }) }, 'Clock format')
  const nowBtn = button('Now', { icon: 'locate-fixed', onClick: () => { ms = Math.floor(Date.now() / MIN) * MIN; update({ rebuild: true }) } })
  const warn = h('div')
  const srcNote = h('div', { class: 'small muted' })
  const grid = h('div', { class: 'ct-zgrid' })
  const tlHost = h('div')
  const play = h('i', { class: 'ct-play' })
  let axisStart = 0
  const cards = new Map()
  let rowRefs = []

  function fromInputs() {
    const d = parseISO(dateIn.value)
    const t = /^(\d{2}):(\d{2})/.exec(timeIn.value)
    if (!Number.isFinite(d) || !t) return
    const { y, m, d: dd } = ymd(d)
    const r = zonedToMs(y, m, dd, +t[1], +t[2], from.zone)
    ms = r.ms
    note = r.gap ? alert('warn', `${timeIn.value} does not exist in ${from.label} on that date (clocks jump forward), so the next valid time is used.`)
      : r.overlap ? alert('info', `${timeIn.value} happens twice in ${from.label} that day (clocks go back). The first one is used.`) : null
    update({ inputs: false, rebuild: true })
  }

  function makeCard(e) {
    const ico = h('div', { class: 'ct-zc-ico' }), name = h('b'), sub = h('span'), time = h('div', { class: 'ct-zc-time' }), date = h('div', { class: 'ct-zc-date' }), meta = h('div', { class: 'ct-zc-meta' })
    const useBtn = button('', { icon: 'locate-fixed', variant: 'ghost', size: 'sm', ariaLabel: `Use ${e.label} as the source`, title: 'Use as the source' })
    const rm = button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: `Remove ${e.label}`, title: 'Remove' })
    const el = h('article', { class: 'ct-zc', 'aria-label': e.label }, h('div', { class: 'ct-zc-top' }, ico, h('div', { class: 'ct-zc-names' }, name, sub), h('div', { class: 'ct-zc-btns' }, useBtn, rm)), time, date, meta)
    const c = { el, ico, name, sub, time, date, meta, useBtn, rm, phase: '' }
    c.useBtn.addEventListener('click', () => { const old = from; from = c.entry; targets = targets.filter((t) => t.zone !== from.zone); targets.unshift(old); update({ rebuild: true }) })
    c.rm.addEventListener('click', () => { targets = targets.filter((t) => t.zone !== c.entry.zone); update({ rebuild: true }) })
    return c
  }

  function drawCard(c, e, isSrc) {
    c.entry = e
    const v = zoneView(e.zone, ms, from.zone)
    const [ic, col] = PHASE[v.phase]
    if (c.phase !== v.phase) { c.ico.replaceChildren(icon(ic)); c.phase = v.phase }
    c.el.style.setProperty('--pc', col)
    c.el.classList.toggle('src', isSrc)
    c.name.replaceChildren(e.label, ...(isSrc ? [h('em', { class: 'ct-src-tag' }, 'Source')] : []))
    c.sub.textContent = e.zone.replace(/_/g, ' ')
    const t = fmtTime(ms, e.zone, h24).split(' ')
    c.time.replaceChildren(...[t[0], t[1] && h('small', t[1])].filter(Boolean))
    c.date.replaceChildren(...[fmtZoneDate(ms, e.zone, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), !isSrc && h('span', { class: 'tag' }, dayTag(v.dayDiff))].filter(Boolean))
    c.meta.replaceChildren(...[h('span', `${v.abbr ? v.abbr + ' · ' : ''}${fmtOffset(v.offset)}`), v.dst && h('span', { class: 'dst' }, 'Daylight saving'), !isSrc && h('span', diffText(v.diffMin).replace('the source', from.label))].filter(Boolean))
    c.useBtn.hidden = isSrc
    c.rm.hidden = isSrc
    c.useBtn.style.display = c.rm.style.display = isSrc ? 'none' : ''
  }

  function buildTimeline() {
    rowRefs = []
    const rows = [from, ...targets].map((e) => {
      const strip = zoneStrip({ zone: e.zone, startMs: axisStart, h24 })
      const span = h('span')
      rowRefs.push({ zone: e.zone, span })
      return h('div', { class: 'ct-zr' }, h('div', { class: 'ct-zl' }, h('b', e.label), span), strip.el)
    })
    const inner = h('div', { class: 'ct-zt-in' }, rows, play)
    const scrub = (e) => {
      const strip = inner.querySelector('.ct-zs')
      const r = strip.getBoundingClientRect()
      const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
      slider.value = Math.round((f * 1440) / 5) * 5
      ms = axisStart + slider.valueAsNumber * MIN
      update({ slider: false })
    }
    inner.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.ct-zs')) return
      inner.setPointerCapture?.(e.pointerId)
      scrub(e)
      const move = (ev) => scrub(ev)
      const up = () => { inner.removeEventListener('pointermove', move); inner.removeEventListener('pointerup', up); inner.removeEventListener('pointercancel', up) }
      inner.addEventListener('pointermove', move); inner.addEventListener('pointerup', up); inner.addEventListener('pointercancel', up)
    })
    clear(tlHost, h('div', { class: 'ct-zt' }, h('div', { class: 'ct-zt-scroll' }, inner)))
  }

  /** opts: inputs (refresh the date/time boxes), slider (refresh the slider), rebuild (rebuild the timeline and cards). */
  function update(opts = {}) {
    const p = localParts(from.zone, ms)
    axisStart = zonedToMs(p.y, p.m, p.d, 0, 0, from.zone).ms
    if (opts.inputs !== false) { dateIn.value = isoDate(toDayNum(p.y, p.m, p.d)); timeIn.value = `${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}` }
    const mins = Math.max(0, Math.min(1435, Math.round((ms - axisStart) / MIN)))
    if (opts.slider !== false) slider.value = mins
    sliderOut.textContent = fmtTime(ms, from.zone, h24)
    play.style.setProperty('--p', String(Math.max(0, Math.min(1, (ms - axisStart) / (24 * 60 * MIN)))))
    srcPick.input.placeholder = `${from.label} (${from.zone.replace(/_/g, ' ')})`
    if (opts.rebuild) buildTimeline()
    for (const r of rowRefs) r.span.textContent = `${fmtTime(ms, r.zone, h24)} ${zoneView(r.zone, ms, from.zone).abbr}`.trim()
    const all = [from, ...targets]
    for (const [z, c] of cards) if (!all.some((e) => e.zone === z)) { c.el.remove(); cards.delete(z) }
    all.forEach((e, i) => {
      let c = cards.get(e.zone)
      if (!c) { c = makeCard(e); cards.set(e.zone, c) }
      drawCard(c, e, i === 0)
      if (grid.children[i] !== c.el) grid.insertBefore(c.el, grid.children[i] || null)
    })
    clear(warn, note)
    srcNote.textContent = ''
    save('tz:from', from); save('tz:targets', targets); save('tz:h24', h24)
    setHashParams({ from: tok(from), to: targets.map(tok).join(','), at: `${isoDate(toDayNum(p.y, p.m, p.d))}T${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}` })
    settleOnce(root.firstChild)
  }
  const tok = (e) => (e.label && e.label !== cityOf(e.zone) ? `${e.zone}|${e.label}` : e.zone)

  const summary = () => [from, ...targets].map((e) => { const v = zoneView(e.zone, ms, from.zone); return `${e.label} (${v.abbr || fmtOffset(v.offset)}): ${fmtZoneDate(ms, e.zone, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}, ${fmtTime(ms, e.zone, h24)}` }).join('\n')

  root.append(h('div', { class: 'ct' },
    h('section', { class: 'panel stack' },
      h('div', { class: 'ct-fields' }, field('Convert from', srcPick.el), field('Date', dateIn), field('Time', timeIn)),
      h('div', { class: 'row between' }, h('div', { class: 'row' }, nowBtn), fmtSeg),
      h('div', { class: 'ct-slide' }, h('div', { class: 'ct-h' }, icon('sliders-horizontal'), 'Slide through the day', h('span', { style: 'margin-left:auto;font-variant-numeric:tabular-nums;font-family:var(--mono)' }, sliderOut)), slider)),
    warn,
    tlHost, timelineKey(),
    grid,
    h('section', { class: 'panel stack' }, field('Add a city or time zone', addPick.el, 'All IANA time zones. Try Mumbai, PST, New York, Asia/Tokyo or a country.'),
      h('div', { class: 'row' }, button('Copy all times', { icon: 'copy', size: 'sm', onClick: () => copyText(summary()) }), button('Copy link', { icon: 'link', size: 'sm', onClick: () => copyText(location.href) }),
        button('Reset', { icon: 'rotate-ccw', size: 'sm', variant: 'ghost', onClick: () => { from = cleanZones([localZone()])[0]; targets = cleanZones(DEFAULT_TARGETS.filter((z) => z !== from.zone)); ms = Math.floor(Date.now() / MIN) * MIN; note = null; update({ rebuild: true }) } })))))
  update({ rebuild: true })
}
