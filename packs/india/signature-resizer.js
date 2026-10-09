// Signature resizer: exact width and height plus a KB range, with one-tap sizes used by common forms.
import { h, stack, panel, button, toast } from '../../lib/ui.js'
import { createSlot } from './_slot.js'
import { presetById } from './_presets.js'
import { style, note } from './_shared.js'

// One-tap sizes taken from the preset database so the numbers live in one place.
const QUICK = [['ibps', 'IBPS / SBI'], ['ssc', 'SSC'], ['pan-nsdl', 'PAN (NSDL)'], ['pan-utiitsl', 'PAN (UTIITSL)'], ['sarathi-dl', 'Driving licence'], ['neet', 'NEET'], ['jee-main', 'JEE Main'], ['upsc', 'UPSC'], ['gate', 'GATE'], ['cat', 'CAT']]

export function mount(root) {
  style('in-sigres', '.in-sizes{display:flex;flex-wrap:wrap;gap:8px}.in-sizes button{border:1px solid var(--border);background:var(--surface-2);color:var(--text-2);border-radius:99px;padding:6px 13px;font-size:13px;cursor:pointer;min-height:32px;font-variant-numeric:tabular-nums}.in-sizes button:hover,.in-sizes button[aria-pressed="true"]{border-color:var(--accent);background:var(--accent-soft);color:var(--text)}')
  const slot = createSlot({
    spec: { key: 'signature', kind: 'signature', label: 'Signature', w: 140, h: 60, minKB: 10, maxKB: 20, dpi: 0 },
    paste: true, prefix: 'signature', defaults: { clean: false, trim: false },
  })
  const buttons = QUICK.map(([id, label]) => {
    const sp = presetById(id).slots.find((s) => s.kind === 'signature')
    const text = sp.range ? `${label}` : `${label} ${sp.w}x${sp.h}`
    const b = h('button', { type: 'button', 'aria-pressed': 'false', title: `${sp.w} x ${sp.h} px, ${sp.minKB ? sp.minKB + ' to ' : 'up to '}${sp.maxKB} KB`, onclick: () => {
      buttons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
      slot.setSpec({ ...sp, key: 'signature', kind: 'signature', label: 'Signature' })
    } }, text)
    return b
  })
  const keep = button('Keep my image size', { icon: 'maximize', size: 'sm', onClick: () => {
    const s = slot.sourceSize()
    if (!s) return toast('Add your signature image first', 'info')
    buttons.forEach((x) => x.setAttribute('aria-pressed', 'false'))
    slot.setSpec({ ...slot.spec(), w: Math.min(4000, s.w), h: Math.min(4000, s.h), range: undefined })
  } })
  root.append(stack(
    panel(h('div', { class: 'stack' }, h('div', { class: 'small muted' }, 'Pick the size your form asks for, or type your own under "Adjust the size rules" once you add the image.'), h('div', { class: 'in-sizes', role: 'group', 'aria-label': 'Common signature sizes' }, buttons, keep))),
    slot.el,
    note('The picture is fitted inside the exact size without distortion (or stretched if you choose that). To remove the paper and darken a weak pen stroke, switch on "Make paper white and ink dark", or use the Signature background remover for a transparent PNG.')))
}
