// Train timetable helper: train number check, station code search and one-tap handoff to the official NTES and IRCTC pages (no scraping).
import { h, panel, stack, input, field, tabs, alert, table, button, clear, icon, copyText, copyButton, debounce } from '../../lib/ui.js'
import { checkTrain, searchStations, STATIONS } from './_trains.js'
import { useStyles, style, note, link } from './_shared.js'

const NTES = 'https://enquiry.indianrail.gov.in/mntes/'
const IRCTC = 'https://www.irctc.co.in/nget/train-search'

const open = (label, href, onclick) => h('a', { class: 'btn btn-secondary', href, target: '_blank', rel: 'noopener noreferrer', onclick }, icon('external-link'), h('span', label))

function stationPicker(label, id) {
  const dl = h('datalist', { id }, STATIONS.map((s) => h('option', { value: `${s.code} - ${s.name}` })))
  const inp = input({ list: id, placeholder: 'Type a city or station code', autocomplete: 'off', 'aria-label': label })
  const info = h('small', { class: 'field-hint', 'aria-live': 'polite' })
  const el = h('label', { class: 'field' }, h('span', { class: 'field-label' }, h('span', label)), inp, dl, info)
  const resolve = () => {
    const v = inp.value.trim()
    if (!v) return null
    const code = v.split(' - ')[0].trim().toUpperCase()
    return STATIONS.find((s) => s.code === code) || searchStations(v, 1)[0] || null
  }
  inp.addEventListener('input', () => { const s = resolve(); info.textContent = s ? `${s.name} (${s.code}), ${s.state}` : inp.value.trim() ? 'No match in the list of major stations. Use the code from NTES.' : '' })
  return { el, inp, resolve }
}

export function mount(root) {
  useStyles()
  style('in-trn', '.in-trn-codes td:first-child{font-family:var(--mono);font-weight:650}')

  // ----- train number -----
  const num = input({ inputmode: 'numeric', maxlength: 5, placeholder: 'e.g. 12951', autocomplete: 'off', 'aria-label': 'Train number', style: 'font-size:22px;letter-spacing:.1em;font-family:var(--mono);font-weight:600' })
  const numOut = h('div', { class: 'stack', 'aria-live': 'polite' })
  const renderNum = () => {
    const r = checkTrain(num.value)
    if (r.empty) return clear(numOut, h('div', { class: 'small muted' }, 'Every train has a 5-digit number, for example 12951 or 22222.'))
    if (!r.ok) return clear(numOut, alert('info', r.message))
    clear(numOut,
      alert('success', h('strong', `Train ${r.train}. `), r.kind ? `Series suggests: ${r.kind}.` : 'Valid format.'),
      h('div', { class: 'row' }, open('Schedule and live status on NTES', NTES, () => copyText(r.train)), open('Book on IRCTC', IRCTC), copyButton(() => r.train, 'Copy number')),
      h('div', { class: 'small muted' }, 'On NTES choose "Train Schedule" for the timetable or "Spot Your Train" for where it is now. The number is copied so you can paste it.'))
  }
  num.addEventListener('input', debounce(renderNum, 30))

  // ----- between stations -----
  const from = stationPicker('From', 'in-st-from'), to = stationPicker('To', 'in-st-to')
  const date = input({ type: 'date', 'aria-label': 'Journey date', value: new Date().toISOString().slice(0, 10) })
  const swap = button('Swap', { icon: 'arrow-left-right', size: 'sm', onClick: () => { const a = from.inp.value; from.inp.value = to.inp.value; to.inp.value = a; from.inp.dispatchEvent(new Event('input')); to.inp.dispatchEvent(new Event('input')) } })
  const route = h('div', { class: 'stack' })
  const renderRoute = () => {
    const a = from.resolve(), b = to.resolve()
    if (!a || !b) return clear(route, h('div', { class: 'small muted' }, 'Pick both stations to get the codes and a ready link.'))
    if (a.code === b.code) return clear(route, alert('warn', 'From and To are the same station.'))
    const text = `${a.name} (${a.code}) to ${b.name} (${b.code}) on ${date.value}`
    clear(route,
      alert('success', h('strong', `${a.code} to ${b.code}. `), `${a.name}, ${a.state} to ${b.name}, ${b.state}.`),
      h('div', { class: 'row' }, open('Find trains on IRCTC', IRCTC, () => copyText(`${a.code} ${b.code}`)), open('NTES: trains between stations', NTES), copyButton(() => text, 'Copy route')),
      h('div', { class: 'small muted' }, `On IRCTC type ${a.code} in From, ${b.code} in To and pick ${date.value}. The codes are copied for you.`))
  }
  for (const x of [from.inp, to.inp, date]) x.addEventListener('input', debounce(renderRoute, 60))
  swap.addEventListener('click', renderRoute)

  // ----- station codes -----
  const q = input({ type: 'search', placeholder: 'Search a city, station name or code', 'aria-label': 'Search stations' })
  const list = h('div')
  const renderList = () => {
    const rows = (q.value.trim() ? searchStations(q.value, 60) : STATIONS.slice(0, 40)).map((s) => [s.code, s.name, s.state])
    clear(list, rows.length ? h('div', { class: 'in-trn-codes' }, table({ columns: ['Code', 'Station', 'State'], rows, max: 60 })) : h('div', { class: 'empty' }, icon('search'), h('div', 'No station matches. Try the city name or the code from your ticket.')))
  }
  q.addEventListener('input', debounce(renderList, 80))

  const t = tabs([
    { id: 'train', label: 'Train', render: () => h('div', { class: 'stack' }, field('Train number', num), numOut) },
    { id: 'route', label: 'Route', render: () => h('div', { class: 'stack' }, h('div', { class: 'grid-2' }, from.el, to.el), h('div', { class: 'row' }, field('Date', date), swap), route) },
    { id: 'codes', label: 'Stations', render: () => h('div', { class: 'stack' }, field('Search', q), list) },
  ], 'train')
  root.append(stack(
    panel(t),
    alert('info', h('strong', 'Live train data comes from Indian Railways. '), 'Timetables and running status are published only by the Railways (NTES) and IRCTC, so this page prepares your search and opens the official page instead of scraping it. Railway helpline: 139.'),
    note('The station list covers about 170 major stations; use NTES for any other code. Official sites: ', link('https://enquiry.indianrail.gov.in/mntes/', 'NTES'), ', ', link('https://www.irctc.co.in/', 'IRCTC'), '. Nothing you type here leaves your device.')))
  renderNum(); renderRoute(); renderList()
}
