// Countdown generator: make a countdown to a date, pick a theme, share a link that opens straight into the live countdown.
// Link format: #/countdown-generator?to=2027-01-01T00:00&tz=Asia/Kolkata|local&title=New%20Year&theme=aurora&e=emoji
import { h, icon, button, field, input, select, clear, copyText, alert, onCleanup } from '../../lib/ui.js'
import { useStyles, addStyles, burst, chips, hashParams, reducedMotion } from './_kit.js'
import { today, toDayNum, ymd, isoDate, parseISO } from './_dates.js'
import { zonedToMs, localZone, isValidZone, fmtZoneDate, fmtTime, tzAbbr, fmtOffset, offsetMin } from './_zones.js'

const THEMES = {
  aurora: ['Aurora', '#6366f1', '#22d3ee', '#a855f7'],
  sunset: ['Sunset', '#f97316', '#ec4899', '#8b5cf6'],
  ocean: ['Ocean', '#0ea5e9', '#14b8a6', '#3b82f6'],
  candy: ['Candy', '#f472b6', '#fb923c', '#a78bfa'],
  forest: ['Forest', '#16a34a', '#0d9488', '#84cc16'],
  midnight: ['Midnight', '#4338ca', '#7c3aed', '#0ea5e9'],
}
const EMOJI = ['\u{1F389}', '\u{1F382}', '\u{1F384}', '\u{1FA94}', '\u{1F680}', '✈️', '\u{1F48D}', '\u{1F393}', '\u{1F3C6}', '\u{1F3D6}️', '❤️']

/** The instant a countdown points at. tz is an IANA zone (a fixed moment) or 'local' (each viewer's own wall clock). NaN when invalid. */
export function targetMs(to, tz) {
  const m = /^(\d{4,6})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(to || '')
  if (!m) return NaN
  const d = parseISO(`${m[1]}-${m[2]}-${m[3]}`)
  if (!Number.isFinite(d)) return NaN
  const [hh, mm] = [+m[4], +m[5]]
  if (hh > 23 || mm > 59) return NaN
  if (!tz || tz === 'local' || !isValidZone(tz)) return new Date(+m[1], +m[2] - 1, +m[3], hh, mm).getTime()
  const { y, m: mo, d: dd } = ymd(d)
  return zonedToMs(y, mo, dd, hh, mm, tz).ms
}
/** Split a millisecond span into days, hours, minutes, seconds. */
export function split(ms) {
  const s = Math.floor(Math.abs(ms) / 1000)
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 }
}

const CSS = `
.ct-cd { --g1: #6366f1; --g2: #22d3ee; --g3: #a855f7; position: relative; isolation: isolate; overflow: hidden; border-radius: 30px; color: #fff; text-align: center; padding: clamp(24px, 6vw, 56px) clamp(14px, 4vw, 40px);
  min-height: 360px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--g1) 62%, #05050a), color-mix(in srgb, var(--g3) 52%, #05050a)); box-shadow: 0 30px 70px -34px var(--g1); }
.ct-cd::before, .ct-cd::after { content: ""; position: absolute; z-index: -1; border-radius: 50%; filter: blur(46px); opacity: .75; pointer-events: none; }
.ct-cd::before { width: 340px; height: 340px; left: -90px; top: -110px; background: var(--g2); animation: ctCdA 14s ease-in-out infinite alternate; }
.ct-cd::after { width: 380px; height: 380px; right: -110px; bottom: -150px; background: var(--g3); animation: ctCdA 18s ease-in-out infinite alternate-reverse; }
.ct-cd .grain { position: absolute; inset: 0; z-index: -1; opacity: .35; pointer-events: none; background-image: radial-gradient(rgba(255,255,255,.55) 1px, transparent 1.3px); background-size: 18px 18px;
  mask-image: radial-gradient(70% 70% at 50% 40%, #000, transparent); -webkit-mask-image: radial-gradient(70% 70% at 50% 40%, #000, transparent); }
.ct-cd .emo { font-size: clamp(34px, 7vw, 54px); line-height: 1; animation: ctBob 3.6s ease-in-out infinite; filter: drop-shadow(0 8px 14px rgba(0,0,0,.35)); }
.ct-cd h2 { font-size: clamp(24px, 5.5vw, 46px); letter-spacing: -.04em; line-height: 1.08; max-width: 18ch; overflow-wrap: anywhere; text-wrap: balance; text-shadow: 0 2px 18px rgba(0,0,0,.28); }
.ct-cd .kick { font-size: 12px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; opacity: .8; }
.ct-cd .units { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: clamp(8px, 2vw, 16px); width: min(100%, 640px); }
.ct-cd .u { padding: clamp(12px, 3vw, 22px) 4px clamp(10px, 2.4vw, 16px); border-radius: 22px; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.26); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: inset 0 1px 0 rgba(255,255,255,.3), 0 14px 30px -18px rgba(0,0,0,.6); }
.ct-cd .u b { display: block; font-size: clamp(30px, 8.4vw, 76px); line-height: 1; letter-spacing: -.05em; font-weight: 700; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.ct-cd .u span { display: block; margin-top: 8px; font-size: clamp(10px, 2vw, 13px); letter-spacing: .12em; text-transform: uppercase; opacity: .8; }
.ct-cd .when { font-size: 14px; opacity: .88; max-width: 38ch; overflow-wrap: anywhere; }
.ct-cd .done { font-size: clamp(30px, 8vw, 64px); font-weight: 750; letter-spacing: -.05em; line-height: 1.05; animation: ctRise .6s var(--spring) both; }
.ct-cd[data-theme="midnight"], .ct-cd[data-theme="forest"] { background: linear-gradient(135deg, color-mix(in srgb, var(--g1) 45%, #020207), color-mix(in srgb, var(--g3) 36%, #020207)); }
.ct-cd:fullscreen { border-radius: 0; min-height: 100vh; }
.ct-cd .fs { position: absolute; top: 12px; right: 12px; }
.ct-cd .fs .btn { color: #fff; background: rgba(255,255,255,.12); }
.ct-cd .fs .btn:hover { background: rgba(255,255,255,.22); }
.ct-sw { display: flex; flex-wrap: wrap; gap: 10px; }
.ct-sw button { width: 44px; height: 44px; border-radius: 14px; border: 2px solid transparent; cursor: pointer; background: linear-gradient(135deg, var(--a), var(--b)); box-shadow: var(--shadow-sm); transition: transform .25s var(--spring), border-color .2s; position: relative; }
.ct-sw button:hover { transform: translateY(-2px) scale(1.06); }
.ct-sw button[aria-pressed="true"] { border-color: var(--text); transform: scale(1.08); }
.ct-sw button[aria-pressed="true"]::after { content: ""; position: absolute; inset: 0; margin: auto; width: 10px; height: 10px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 2px rgba(0,0,0,.25); }
.ct-emoji { font-size: 20px; padding: 0; width: 40px; justify-content: center; }
.ct-link { display: flex; gap: 8px; }
.ct-link .input { font-family: var(--mono); font-size: 12.5px; flex: 1; min-width: 0; }
.ct-link .btn { flex: none; }
@keyframes ctCdA { 0% { transform: translate(0, 0) scale(1); } 100% { transform: translate(60px, 40px) scale(1.2); } }
@keyframes ctBob { 0%, 100% { transform: translateY(0) rotate(-4deg); } 50% { transform: translateY(-8px) rotate(4deg); } }
`

/** The live countdown card. Returns {el, stop()}. */
export function countdownCard({ title, ms, tz, theme = 'aurora', emoji = '' }) {
  const [, g1, g2, g3] = THEMES[theme] || THEMES.aurora
  const nums = {}
  const unit = (k, label) => { const b = h('b', '00'); nums[k] = b; return h('div', { class: 'u' }, b, h('span', label)) }
  const units = h('div', { class: 'units', role: 'timer', 'aria-label': `Countdown to ${title}` }, unit('d', 'Days'), unit('h', 'Hours'), unit('m', 'Minutes'), unit('s', 'Seconds'))
  const kick = h('div', { class: 'kick' }), headline = h('h2', title || 'Your countdown')
  const when = h('div', { class: 'when' })
  const fsBtn = document.fullscreenEnabled ? h('div', { class: 'fs' }, button('', { icon: 'maximize', variant: 'ghost', size: 'sm', ariaLabel: 'Full screen', onClick: () => { document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.() } })) : null
  const el = h('section', { class: 'ct-cd', 'data-theme': theme, style: { '--g1': g1, '--g2': g2, '--g3': g3 } }, h('i', { class: 'grain' }), fsBtn,
    emoji ? h('div', { class: 'emo', 'aria-hidden': 'true' }, emoji) : null, kick, headline, units, when)
  const last = {}
  let celebrated = ms - Date.now() <= -60_000 // opened long after the moment: no fanfare
  const zoneName = tz && tz !== 'local' && isValidZone(tz) ? tz : localZone()
  when.textContent = `${fmtZoneDate(ms, zoneName, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${fmtTime(ms, zoneName, true)} ${tzAbbr(zoneName, ms) || fmtOffset(offsetMin(zoneName, ms))}${tz === 'local' || !tz ? ' (your local time)' : ''}`
  function tick() {
    const diff = ms - Date.now()
    const t = split(diff)
    kick.textContent = diff > 0 ? 'Counting down to' : 'Time since'
    if (diff <= 0 && !celebrated) {
      celebrated = true
      headline.replaceChildren(h('span', { class: 'done' }, 'It is time!'), h('br'), title || '')
      burst(el, 70)
    }
    for (const k of ['d', 'h', 'm', 's']) {
      const v = String(t[k]).padStart(2, '0')
      if (last[k] === v) continue
      nums[k].textContent = v
      if (last[k] !== undefined && !reducedMotion() && nums[k].animate) nums[k].animate([{ transform: 'translateY(-14%)', opacity: 0.35 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' })
      last[k] = v
    }
  }
  tick()
  const timer = setInterval(tick, 250)
  return { el, stop: () => clearInterval(timer), tick }
}

const defaultTarget = () => { const y = ymd(today()).y + 1; return `${y}-01-01T00:00` }

export function mount(root) {
  useStyles()
  addStyles('ct-countdown', CSS)
  const q = hashParams()
  const cleanup = []
  onCleanup(() => cleanup.forEach((f) => f()))
  const base = `${location.origin}${location.pathname}#/countdown-generator`

  const viewTo = q.get('to')
  const ms = targetMs(viewTo, q.get('tz'))
  if (viewTo && Number.isFinite(ms) && !q.get('edit')) return view()
  return create(viewTo && !Number.isFinite(ms) ? 'That countdown link has a date we cannot read, so here is a fresh one.' : null)

  function view() {
    const title = (q.get('title') || '').slice(0, 80)
    const card = countdownCard({ title, ms, tz: q.get('tz'), theme: q.get('theme') || 'aurora', emoji: (q.get('e') || '').slice(0, 8), big: true })
    cleanup.push(card.stop)
    const edit = new URLSearchParams(q); edit.set('edit', '1')
    root.append(h('div', { class: 'ct' }, card.el,
      h('div', { class: 'row' },
        button('Make your own', { icon: 'plus', variant: 'primary', onClick: () => { location.hash = '#/countdown-generator' } }),
        button('Edit this one', { icon: 'pencil', onClick: () => { location.hash = `#/countdown-generator?${edit}` } }),
        button('Copy link', { icon: 'link', onClick: () => copyText(location.href) }),
        navigator.share ? button('Share', { icon: 'share-2', onClick: () => navigator.share({ title: title || 'Countdown', url: location.href }).catch(() => {}) }) : null)))
  }

  function create(msg) {
    const seed = q.get('to') && Number.isFinite(targetMs(q.get('to'), q.get('tz'))) ? q : null
    const state = {
      title: seed ? (q.get('title') || '') : 'New Year',
      to: seed ? q.get('to') : defaultTarget(),
      tz: seed ? (q.get('tz') || 'local') : localZone(),
      theme: THEMES[q.get('theme')] ? q.get('theme') : 'aurora',
      emoji: seed ? (q.get('e') || '') : EMOJI[0],
    }
    const titleIn = input({ placeholder: 'Diwali, Launch day, Trip to Goa...', value: state.title, maxLength: 80, 'aria-label': 'Countdown title', oninput: () => { state.title = titleIn.value; update() } })
    const dateIn = h('input', { class: 'input', type: 'date', value: state.to.slice(0, 10), 'aria-label': 'Target date', oninput: () => { state.to = `${dateIn.value}T${timeIn.value || '00:00'}`; update() } })
    const timeIn = h('input', { class: 'input', type: 'time', value: state.to.slice(11, 16), 'aria-label': 'Target time', oninput: () => { state.to = `${dateIn.value}T${timeIn.value || '00:00'}`; update() } })
    const fixedLabel = `Same moment for everyone (${localZone().replace(/_/g, ' ')})`
    const tzSel = select([[localZone(), fixedLabel], ['local', "Each viewer's own local time (like midnight New Year)"]], state.tz === 'local' ? 'local' : localZone(), (v) => { state.tz = v; update() })
    const swatches = h('div', { class: 'ct-sw', role: 'group', 'aria-label': 'Theme' }, Object.entries(THEMES).map(([k, [name, a, , b]]) => h('button', {
      type: 'button', title: name, 'aria-label': `${name} theme`, 'aria-pressed': String(state.theme === k), dataset: { k }, style: { '--a': a, '--b': b },
      onclick: () => { state.theme = k; for (const s of swatches.children) s.setAttribute('aria-pressed', String(s.dataset.k === k)); update() },
    })))
    const emojiRow = h('div', { class: 'ct-chips' }, ['', ...EMOJI].map((e) => h('button', { type: 'button', class: 'ct-chip ct-emoji', 'aria-pressed': String(state.emoji === e), 'aria-label': e ? `Emoji ${e}` : 'No emoji', onclick: () => { state.emoji = e; for (const b of emojiRow.children) b.setAttribute('aria-pressed', String(b.dataset.e === e)); update() }, dataset: { e } }, e || icon('ban'))))
    const linkOut = h('input', { class: 'input', readOnly: true, 'aria-label': 'Shareable link', onfocus: () => linkOut.select() })
    const previewHost = h('div')
    const warn = h('div')
    let card = null

    const preset = (title, mmdd) => { const t = today(), y = ymd(t).y; const [mo, d] = mmdd; let dn = toDayNum(y, mo, d); if (dn <= t) dn = toDayNum(y + 1, mo, d); state.title = title; titleIn.value = title; setDate(dn) }
    const setDate = (dn, time = '00:00') => { dateIn.value = isoDate(dn); timeIn.value = time; state.to = `${dateIn.value}T${time}`; update() }
    const quick = chips([
      { label: 'New Year', onClick: () => preset('New Year', [1, 1]) }, { label: 'Republic Day', onClick: () => preset('Republic Day', [1, 26]) },
      { label: 'Independence Day', onClick: () => preset('Independence Day', [8, 15]) }, { label: 'Christmas', onClick: () => preset('Christmas', [12, 25]) },
      { label: 'Tomorrow', onClick: () => setDate(today() + 1, '09:00') }, { label: 'In 1 week', onClick: () => setDate(today() + 7, '09:00') }, { label: 'In 30 days', onClick: () => setDate(today() + 30, '09:00') },
    ])

    function linkFor() {
      const p = new URLSearchParams({ to: state.to, tz: state.tz })
      if (state.title.trim()) p.set('title', state.title.trim())
      p.set('theme', state.theme)
      if (state.emoji) p.set('e', state.emoji)
      return `${base}?${p}`
    }
    function update() {
      const ms2 = targetMs(state.to, state.tz)
      const valid = Number.isFinite(ms2)
      clear(warn, valid ? (ms2 < Date.now() ? alert('info', 'That moment has already passed. The preview counts how long ago it was; pick a later date for a real countdown.') : null) : alert('warn', 'Pick a valid date and time.'))
      linkOut.value = valid ? linkFor() : ''
      if (!valid) { card?.stop(); clear(previewHost); card = null; return }
      card?.stop()
      card = countdownCard({ title: state.title.trim(), ms: ms2, tz: state.tz, theme: state.theme, emoji: state.emoji })
      clear(previewHost, card.el)
    }
    cleanup.push(() => card?.stop())

    root.append(h('div', { class: 'ct' },
      msg ? alert('info', msg) : null,
      h('section', { class: 'panel stack' },
        h('div', { class: 'ct-fields' }, field('Title', titleIn), field('Date', dateIn), field('Time', timeIn)),
        quick,
        field('Time zone', tzSel, 'A fixed moment shows the same instant to everyone. Pick "each viewer" for things like midnight on New Year.'),
        h('div', { class: 'ct-fields' }, field('Theme', swatches), field('Emoji', emojiRow))),
      warn, previewHost,
      h('section', { class: 'panel stack' },
        h('div', { class: 'ct-h' }, icon('link'), 'Share it'),
        h('div', { class: 'ct-link' }, linkOut, button('Copy', { icon: 'copy', variant: 'primary', onClick: () => linkOut.value && copyText(linkOut.value) })),
        h('div', { class: 'row' },
          button('Open the link', { icon: 'external-link', onClick: () => { if (linkOut.value) location.hash = linkOut.value.slice(linkOut.value.indexOf('#')) } }),
          navigator.share ? button('Share', { icon: 'share-2', onClick: () => linkOut.value && navigator.share({ title: state.title || 'Countdown', url: linkOut.value }).catch(() => {}) }) : null),
        h('div', { class: 'small muted' }, 'The link holds the date, title and theme. Nothing is uploaded or stored anywhere.'))))
    update()
  }
}
