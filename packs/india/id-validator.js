// PAN, GSTIN, Aadhaar, IFSC and more: format and checksum checks that run entirely in the browser.
import { h, card, panel, stack, textarea, field, select, alert, table, button, clear, debounce, icon } from '../../lib/ui.js'
import { identify, CHECKERS, ID_TYPES, verhoeffCheckDigit, mask } from './_ids.js'
import { useStyles, style, note, kv } from './_shared.js'

const CSS = `
.in-id-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.in-id-chips button { border: 1px solid var(--border); background: var(--surface-2); color: var(--text-2); border-radius: 99px; padding: 6px 12px; font-size: 13px; cursor: pointer; min-height: 32px; }
.in-id-chips button:hover { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
.in-id-res { display: grid; gap: 12px; }
.in-id-res .tag { display: inline-block; font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 99px; background: var(--accent-soft); color: var(--accent); margin-left: 8px; vertical-align: 2px; }
.in-id-res ul { margin: 0; padding-left: 18px; color: var(--muted); font-size: 13px; }
.in-pass, .in-fail { display: inline-flex; gap: 6px; align-items: center; font-weight: 600; }
.in-pass { color: var(--success); } .in-fail { color: var(--danger); }
.in-pass .icon, .in-fail .icon { width: 16px; height: 16px; }
`
const sampleAadhaar = () => { const b = '23412341234'; return b + verhoeffCheckDigit(b) }
const EXAMPLES = [['PAN', 'ABCPK1234D'], ['GSTIN', '27AAPFU0939F1ZV'], ['Aadhaar (sample)', sampleAadhaar()], ['IFSC', 'HDFC0000001'], ['Vehicle', 'MH12AB1234']]

export function mount(root) {
  useStyles()
  style('in-ids', CSS)
  const box = textarea({ rows: 3, mono: true, spellcheck: false, autocomplete: 'off', placeholder: 'Paste a PAN, GSTIN, Aadhaar, IFSC or vehicle number. One per line to check many.', 'aria-label': 'IDs to check' })
  const type = select([['auto', 'Detect automatically'], ...ID_TYPES.map((t) => [t, CHECKERS[t].label])], 'auto', () => render())
  const out = h('div', { class: 'in-id-res' })

  const status = (ok) => (ok ? h('span', { class: 'in-pass' }, icon('circle-check'), 'Valid') : h('span', { class: 'in-fail' }, icon('circle-x'), 'Invalid'))
  const label = (r) => (r.type ? CHECKERS[r.type].label : 'Unknown')

  function detail(value, r) {
    const shown = r.type === 'aadhaar' && r.ok ? mask(value.replace(/\s/g, '')) : value
    return h('div', { class: 'stack' },
      alert(r.ok ? 'success' : 'error', h('strong', shown), h('span', { class: 'tag' }, label(r)), h('div', { style: 'margin-top:4px' }, r.summary)),
      r.rows ? kv(r.rows.map(([k, v]) => ({ label: k, value: v }))) : null,
      r.notes?.length ? h('ul', r.notes.map((n) => h('li', n))) : null,
      r.link ? h('a', { class: 'link', href: r.link.href }, r.link.text) : null)
  }

  function render() {
    const lines = box.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (!lines.length) return clear(out, h('div', { class: 'empty' }, icon('badge-check'), h('div', 'Type or paste an ID above. It is checked on your device and never sent anywhere.')))
    if (lines.length === 1) {
      const results = identify(lines[0], type.value)
      return clear(out, results.map((r) => detail(lines[0], r)))
    }
    const rows = lines.slice(0, 500).map((l) => {
      const rs = identify(l, type.value)
      const r = rs[0]
      return [l, label(r), status(r.ok), r.summary]
    })
    const good = rows.filter((r) => r[2].classList.contains('in-pass')).length
    clear(out,
      alert(good === rows.length ? 'success' : 'info', `${good} of ${rows.length} look valid.`),
      table({ columns: ['Value', 'Type', 'Result', 'Details'], rows }),
      lines.length > 500 ? note('Only the first 500 lines are checked.') : null)
  }
  box.addEventListener('input', debounce(render, 80))

  root.append(stack(
    panel(h('div', { class: 'stack' },
      field('IDs to check', box),
      h('div', { class: 'grid-2' }, field('Type', type)),
      h('div', { class: 'in-id-chips', role: 'group', 'aria-label': 'Examples' }, EXAMPLES.map(([n, v]) => h('button', { type: 'button', onclick: () => { box.value = v; render(); box.focus() } }, `Try ${n}`))),
      button('Clear', { icon: 'eraser', size: 'sm', onClick: () => { box.value = ''; render(); box.focus() } }))),
    out,
    note('What is checked: PAN structure and holder type, GSTIN structure, state code, embedded PAN and its mod-36 check character, Aadhaar length, first digit and Verhoeff checksum, IFSC and vehicle number format. A passing check means the number is well formed, not that it is issued or active: confirm that on the Income Tax, GST or UIDAI portals. Everything runs on your device and nothing is stored.')))
  render()
}
