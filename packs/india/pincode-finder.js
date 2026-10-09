// PIN code finder: post offices for a PIN, or the PIN for a place, from https://api.postalpincode.in (free public API, no key).
import { h, panel, stack, input, field, segmented, button, busy, alert, table, clear, icon, copyButton, debounce } from '../../lib/ui.js'
import { useStyles, statTiles, note, link, query, downloadCsv } from './_shared.js'

const API = 'https://api.postalpincode.in'

/** Returns an array of post offices, [] when none, or throws a readable error. */
export async function search(mode, term, signal) {
  const res = await fetch(`${API}/${mode === 'pin' ? 'pincode' : 'postoffice'}/${encodeURIComponent(term)}`, { signal })
  if (!res.ok) throw new Error(`The PIN code service replied with an error (${res.status}). Try again in a moment.`)
  const data = await res.json()
  const first = Array.isArray(data) ? data[0] : data
  if (!first || first.Status === 'Error' || first.Status === '404') return []
  return first.PostOffice || []
}

export function mount(root, { signal }) {
  useStyles()
  const mode = segmented([['pin', 'PIN code to places'], ['place', 'Place to PIN code']], 'pin', () => relabel(), 'Search type')
  const term = input({ inputmode: 'numeric', maxlength: 6, autocomplete: 'off', 'aria-label': 'PIN code', placeholder: 'e.g. 110001', style: 'font-size:18px;letter-spacing:.04em' })
  const label = h('span', 'PIN code')
  const lab = field(label, term)
  const go = button('Search', { icon: 'search', variant: 'primary', size: 'lg' })
  const summary = h('div'), listBox = h('div'), msg = h('div')
  const filter = input({ type: 'search', placeholder: 'Filter these results', 'aria-label': 'Filter results' })
  let rows = [], all = []

  function relabel() {
    const pin = mode.value === 'pin'
    label.textContent = pin ? 'PIN code' : 'Post office or area name'
    term.setAttribute('aria-label', label.textContent)
    term.placeholder = pin ? 'e.g. 110001' : 'e.g. Koramangala'
    term.inputMode = pin ? 'numeric' : 'text'
    term.maxLength = pin ? 6 : 60
    term.value = ''
    clear(summary); clear(listBox); clear(msg); filter.value = ''
    listPanel.hidden = true
  }

  function draw() {
    const f = filter.value.trim().toLowerCase()
    rows = all.filter((p) => !f || `${p.Name} ${p.District} ${p.State} ${p.Pincode} ${p.Block || ''} ${p.Division || ''}`.toLowerCase().includes(f))
    clear(listBox, rows.length ? table({
      columns: ['Post office', 'PIN', 'Type', 'Delivery', 'District', 'State'],
      rows: rows.map((p) => [p.Name, h('strong', p.Pincode), p.BranchType, p.DeliveryStatus, p.District, p.State]), max: 300,
    }) : h('div', { class: 'empty' }, icon('search'), h('div', 'Nothing matches that filter.')))
  }

  async function run() {
    const v = term.value.trim()
    const pin = mode.value === 'pin'
    clear(summary); clear(listBox); clear(msg)
    listPanel.hidden = true
    if (pin && !/^[1-9]\d{5}$/.test(v)) return clear(msg, alert('warn', 'A PIN code has 6 digits and does not start with 0, for example 110001.'))
    if (!pin && v.length < 3) return clear(msg, alert('warn', 'Type at least 3 letters of the post office or area name.'))
    await busy(go, async () => {
      try {
        all = await search(mode.value, v, signal)
      } catch (e) {
        if (e.name === 'AbortError') return
        return clear(msg, alert('error', e instanceof TypeError ? 'Could not reach the PIN code service. Check your connection and try again.' : e.message))
      }
      if (!all.length) return clear(msg, alert('warn', pin ? `No post office found for ${v}. Check the PIN.` : `No post office found for "${v}". Try a shorter name or another spelling.`))
      const uniq = (k) => [...new Set(all.map((p) => p[k]).filter(Boolean))]
      const delivering = all.filter((p) => /^Delivery/i.test(p.DeliveryStatus)).length
      const pins = uniq('Pincode')
      clear(summary, statTiles([
        { label: pin ? 'District' : 'Places found', value: pin ? uniq('District').join(', ') : String(all.length), accent: true, hint: pin ? uniq('Region').join(', ') : `${pins.length} PIN code${pins.length > 1 ? 's' : ''}` },
        { label: 'State', value: uniq('State').slice(0, 3).join(', ') + (uniq('State').length > 3 ? ' ...' : '') },
        { label: 'Post offices', value: String(all.length), hint: `${delivering} deliver mail` },
        { label: pin ? 'Circle' : 'First PIN', value: pin ? uniq('Circle').join(', ') : pins[0] },
      ]))
      filter.value = ''
      listPanel.hidden = false
      draw()
    }, { label: 'Searching' })
  }

  const listPanel = panel(h('div', { class: 'stack' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', { style: 'margin:0' }, 'Post offices'),
    h('div', { class: 'row' }, copyButton(() => rows.map((p) => `${p.Name}, ${p.District}, ${p.State} - ${p.Pincode}`).join('\n'), 'Copy list'),
      button('CSV', { icon: 'download', size: 'sm', onClick: () => rows.length && downloadCsv([['Post office', 'PIN', 'Type', 'Delivery', 'District', 'State'], ...rows.map((p) => [p.Name, p.Pincode, p.BranchType, p.DeliveryStatus, p.District, p.State])], 'pincodes.csv') }))),
  filter, listBox))
  listPanel.hidden = true
  term.addEventListener('keydown', (e) => { if (e.key === 'Enter') run() })
  filter.addEventListener('input', debounce(draw, 100))
  go.addEventListener('click', run)
  root.append(stack(
    panel(h('div', { class: 'stack' }, mode, lab, h('div', { class: 'row' }, go), msg)),
    summary,
    listPanel,
    note('Data from the free ', link('https://api.postalpincode.in/', 'postalpincode.in API'), ', which republishes India Post records. Only what you type is sent. Confirm on ', link('https://www.indiapost.gov.in/', 'India Post'), ' for anything important.')))
  const first = query().get('pin')
  if (first && /^\d{6}$/.test(first)) { term.value = first; run() }
}
