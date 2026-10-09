// Editable name / value table shared by the cURL builder and the API tester.
import { h, button, input, clear } from '../../lib/ui.js'
import { css } from './_kit.js'

const STYLE = `
.kv-wrap { display: grid; gap: 8px; }
.kv-wrap .cg-row { display: grid; grid-template-columns: 22px minmax(0, 1fr) minmax(0, 1.4fr) 36px; gap: 8px; align-items: center; }
.kv-wrap .cg-row input[type=checkbox] { width: 18px; height: 18px; accent-color: var(--accent); }
@media (max-width: 520px) { .kv-wrap .cg-row { grid-template-columns: 22px minmax(0, 1fr) 36px; } .kv-wrap .cg-row .v { grid-column: 2 / 3; } .kv-wrap .cg-row .x { grid-row: 1; grid-column: 3; } }
`

/** kvEditor({keyPlaceholder, valuePlaceholder, listId, onChange}) -> {el, rows, add(k, v, on, focus), get() -> [[k, v]] (enabled, named rows), set(list)} */
export function kvEditor({ keyPlaceholder = 'Name', valuePlaceholder = 'Value', listId, onChange }) {
  const rows = []
  css('kv-css', STYLE)
  const wrap = h('div', { class: 'kv-wrap' })
  const api = { el: wrap, rows }
  const emit = () => onChange?.()
  function addRow(k = '', v = '', on = true, focus = false) {
    const r = { on, k, v }
    rows.push(r)
    const kin = input({ value: k, placeholder: keyPlaceholder, 'aria-label': keyPlaceholder, spellcheck: false, autocomplete: 'off', list: listId, oninput: (e) => { r.k = e.target.value; emit() } })
    const vin = input({ value: v, placeholder: valuePlaceholder, 'aria-label': valuePlaceholder, spellcheck: false, autocomplete: 'off', class: 'v', oninput: (e) => { r.v = e.target.value; emit() } })
    const cb = h('input', { type: 'checkbox', checked: on, 'aria-label': 'Enabled', onchange: (e) => { r.on = e.target.checked; emit() } })
    const rm = button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: 'Remove row', class: 'x', onClick: () => { rows.splice(rows.indexOf(r), 1); row.remove(); emit() } })
    const row = h('div', { class: 'cg-row' }, cb, kin, vin, rm)
    wrap.append(row)
    if (focus) kin.focus()
  }
  api.add = addRow
  api.get = () => rows.filter((r) => r.on && r.k.trim()).map((r) => [r.k.trim(), r.v])
  api.set = (list) => { rows.length = 0; clear(wrap); for (const [k, v] of list) addRow(k, v); }
  return api
}

