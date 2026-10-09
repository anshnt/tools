// Vehicle registration decoder: number plate -> state, RTO office, series; BH series; search RTO codes; links to the official Vahan service.
import { h, card, panel, stack, split, input, field, select, alert, table, button, clear, debounce, icon, copyButton } from '../../lib/ui.js'
import { parsePlate, STATES, rtosOf, stateByCode } from './_rto.js'
import { useStyles, style, note, link, kv, query } from './_shared.js'

const CSS = `
.in-plate { display: inline-flex; align-items: center; gap: 0; border: 2.5px solid #111; border-radius: 10px; background: #fcd835; color: #111; font-family: var(--mono); font-weight: 700; font-size: clamp(20px, 6vw, 32px); letter-spacing: .06em; padding: 8px 16px 8px 8px; max-width: 100%; overflow-wrap: anywhere; box-shadow: 0 6px 18px -10px rgba(0,0,0,.5); }
.in-plate.bh { background: #fff; }
.in-plate .ind { display: grid; place-items: center; background: #1d4ed8; color: #fff; font-size: 10px; letter-spacing: 0; border-radius: 5px; padding: 8px 5px; margin-right: 12px; line-height: 1.1; text-align: center; }
.in-search-list { display: grid; gap: 6px; }
`

export function mount(root) {
  useStyles()
  style('in-rto', CSS)
  const plate = input({ placeholder: 'MH12AB1234 or 22BH1234AA', autocomplete: 'off', spellcheck: false, 'aria-label': 'Vehicle number', style: 'text-transform:uppercase;font-family:var(--mono);font-size:18px;letter-spacing:.04em' })
  const out = h('div', { class: 'stack' })
  const q = input({ type: 'search', placeholder: 'Type a city or district, e.g. Pune, Whitefield, Noida', 'aria-label': 'Search RTO offices' })
  const stateSel = select([['', 'All states and UTs'], ...STATES.filter((s) => !s.legacy && s.rtos).map((s) => [s.code, `${s.name} (${s.code})`])], '', () => renderList())
  const listBox = h('div')
  const initial = query().get('plate')

  function render() {
    const raw = plate.value
    const p = parsePlate(raw)
    if (p.error === 'empty') return clear(out, h('div', { class: 'empty' }, icon('car'), h('div', 'Type a number plate to see its state and RTO office.')))
    if (p.error) return clear(out, alert('warn', p.error))
    const links = h('div', { class: 'row' },
      h('a', { class: 'btn btn-primary', href: 'https://vahan.parivahan.gov.in/nrservices/faces/user/citizen/citizenlogin.xhtml', target: '_blank', rel: 'noopener noreferrer' }, icon('external-link'), h('span', 'Official Vahan service')),
      h('a', { class: 'btn btn-secondary', href: 'https://parivahan.gov.in/', target: '_blank', rel: 'noopener noreferrer' }, h('span', 'Parivahan Sewa')),
      copyButton(() => p.plate, 'Copy plate'))
    if (p.kind === 'bh') {
      return clear(out,
        h('div', { class: 'in-plate bh' }, h('span', { class: 'ind' }, 'IND'), p.plate),
        alert('success', h('strong', 'Bharat (BH) series. '), `First registered in ${p.year}. BH plates are not tied to one state or RTO: they stay valid when the owner moves between states.`),
        kv([{ label: 'Series', value: 'Bharat (BH)' }, { label: 'Registration year', value: String(p.year) }, { label: 'Number', value: p.number }, { label: 'Letters', value: p.series }]),
        note('Owner and registration details are not public here. Use the official service to check a vehicle.'), links)
    }
    const st = p.state
    const rows = [
      { label: 'State or UT', value: `${st.name} (${st.code})`, note: st.kind },
      { label: 'RTO number', value: p.rto.padStart(2, '0') },
      { label: 'RTO office', value: p.office || 'Not in this list' },
      { label: 'Series letters', value: p.series || 'None' },
      { label: 'Vehicle number', value: p.number },
    ]
    clear(out,
      h('div', { class: 'in-plate' }, h('span', { class: 'ind' }, 'IND'), p.plate),
      p.office ? alert('success', h('strong', `${st.code}-${p.rto.padStart(2, '0')}: ${p.office}. `), `Registered in ${st.name}.`)
        : alert('info', h('strong', `${st.name} confirmed. `), `The RTO code ${st.code}-${p.rto.padStart(2, '0')} is not in this tool's list. ${st.note || 'Check the Vahan service for the exact office.'}`),
      kv(rows),
      note('Owner name, address and insurance are private and cannot be looked up here. The official Vahan service and the mParivahan app can show registration status for a plate. Your number is never sent anywhere by this page.'),
      links)
  }

  function renderList() {
    const term = q.value.trim().toLowerCase()
    const states = stateSel.value ? [stateByCode(stateSel.value)] : STATES.filter((s) => !s.legacy && s.rtos)
    const rows = []
    for (const s of states) for (const r of rtosOf(s.code)) {
      if (!term || r.office.toLowerCase().includes(term) || `${s.code}${r.rto}`.toLowerCase() === term.replace(/[\s-]/g, '') || s.name.toLowerCase().includes(term)) rows.push([`${s.code}-${r.rto}`, r.office, s.name])
    }
    clear(listBox, rows.length ? table({ columns: ['Code', 'RTO office', 'State'], rows, max: 300 }) : h('div', { class: 'empty' }, icon('search'), h('div', 'No RTO matches. Try a nearby city or another spelling.')))
  }

  plate.addEventListener('input', debounce(render, 40))
  q.addEventListener('input', debounce(renderList, 80))
  if (initial) plate.value = initial

  const states = table({ columns: ['Code', 'State or union territory', 'Type'], rows: STATES.filter((s) => !s.legacy).map((s) => [s.code, s.name, s.kind]), max: 80 })
  root.append(stack(
    card('Number plate', h('div', { class: 'stack' }, field('Vehicle number', plate, 'Spaces and dashes are fine'), out)),
    card('Find an RTO code', h('div', { class: 'stack' }, h('div', { class: 'grid-2' }, field('Search', q), field('State', stateSel)), listBox,
      note('This list covers the larger states and is not complete. Codes that are missing still decode to the state. Compiled from state transport department lists and public RTO tables; check the Vahan service for the final word.'))),
    card('State and UT codes', states, note('Plates before 2012 used UA (Uttarakhand), OR (Odisha) and DN (Dadra and Nagar Haveli); Telangana moved from TS to TG in 2024. Source: ', link('https://parivahan.gov.in/', 'Parivahan Sewa'), '.'))))
  render()
  renderList()
}
