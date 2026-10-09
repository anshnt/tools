// Government photo resizer: the hub for Aadhaar, PAN, passport, visa, licence and exam form photos and signatures.
// params.preset limits the list for the focused entries: aadhaar | passport | pan | exam. No param shows every preset.
import { h, stack, button } from '../../lib/ui.js'
import { createWorkbench } from './_workbench.js'
import { style } from './_shared.js'

const START = { aadhaar: 'aadhaar-upload', passport: 'passport-seva', pan: 'pan-nsdl', exam: 'ssc' }
const QUICK = [['passport-seva', 'Passport'], ['pan-nsdl', 'PAN'], ['ssc', 'SSC'], ['upsc', 'UPSC'], ['ibps', 'IBPS'], ['sbi', 'SBI'], ['neet', 'NEET'], ['jee-main', 'JEE Main'], ['rrb', 'RRB']]

export function mount(root, { params }) {
  style('in-hub', '.in-quick{display:flex;flex-wrap:wrap;gap:8px}.in-quick button{border:1px solid var(--border);background:var(--surface-2);color:var(--text-2);border-radius:99px;padding:6px 13px;font-size:13px;cursor:pointer;min-height:32px}.in-quick button:hover{border-color:var(--accent);background:var(--accent-soft);color:var(--text)}')
  const focus = params?.preset
  const wb = createWorkbench({ focus, initial: START[focus] })
  const quick = !focus ? h('div', { class: 'in-quick', role: 'group', 'aria-label': 'Popular forms' }, QUICK.map(([id, name]) => h('button', { type: 'button', onclick: () => wb.setPreset(id) }, name))) : null
  root.append(stack(quick, wb.el))
}
