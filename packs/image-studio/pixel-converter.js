// Pixel, inch & cm converter: px, in, cm, mm, pt and pc at any DPI, for a width and an optional height.
import { h, panel, split, field, table, button, copyText, clear } from '../../lib/ui.js'
import { addStyle, chipPicker, tiles, numField, stage, spot } from './_shared.js'
import { PAPERS } from './print-size.js'

export const UNITS = ['px', 'in', 'cm', 'mm', 'pt', 'pc']
const UNIT_NAME = { px: 'pixels', in: 'inches', cm: 'centimetres', mm: 'millimetres', pt: 'points', pc: 'picas' }
const IN_PER = (unit, dpi) => ({ px: 1 / dpi, in: 1, cm: 1 / 2.54, mm: 1 / 25.4, pt: 1 / 72, pc: 1 / 6 })[unit]

/** Convert v from one unit to another at the given DPI (DPI only matters when px is involved). */
export const convert = (v, from, to, dpi = 96) => (v * IN_PER(from, dpi)) / IN_PER(to, dpi)

export function fmt(v, unit) {
  if (!Number.isFinite(v)) return '-'
  const r = unit === 'px' ? 2 : 4
  return v.toLocaleString(undefined, { maximumFractionDigits: r })
}

const DPIS = [72, 96, 150, 300, 600]

export function mount(root) {
  addStyle('is-pxc', `
.t-pxc .inputs { display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: end; }
.t-pxc .sep { font-weight: 700; color: var(--muted); padding-bottom: 11px; }
.t-pxc .formula { text-align: center; font-size: 15px; color: var(--text-2); padding: 6px 0 2px; overflow-wrap: anywhere; }
.t-pxc .formula b { color: var(--text); font-variant-numeric: tabular-nums; }
.t-pxc .big { text-align: center; padding: 10px 6px 4px; }
.t-pxc .big .num { font-size: clamp(34px, 7vw, 58px); font-weight: 700; letter-spacing: -.04em; font-variant-numeric: tabular-nums; line-height: 1.1; overflow-wrap: anywhere;
  background: var(--brand); -webkit-background-clip: text; background-clip: text; color: transparent; padding-bottom: .06em; }
:root[data-theme="dark"] .t-pxc .big .num { background-image: linear-gradient(120deg, #a5b4fc, #d8b4fe 40%, #f9a8d4 75%, #fdba74); }
.t-pxc .big .u { font-size: 14px; color: var(--muted); font-weight: 600; margin-top: 2px; }
`)
  const s = { w: 210, h: 297, from: 'mm', to: 'px', dpi: 300 }
  const ok = (n) => Number.isFinite(n) && n >= 0
  const bigNum = h('div', { class: 'num' })
  const bigUnit = h('div', { class: 'u' })
  const formula = h('div', { class: 'formula' })
  const out = h('div', { class: 'stack' })
  const refOut = h('div', { class: 'stack tight' })

  const fieldW = numField('Width', s.w, (n) => { s.w = n; render() }, { min: 0 })
  const fieldH = numField('Height (optional)', s.h, (n) => { s.h = n; render() }, { min: 0 })
  const fieldDpi = numField('DPI', s.dpi, (n) => { s.dpi = n; render() }, { min: 1, hint: 'Pixels per inch. Screens are 96 (CSS), print is usually 300.' })
  const dpiChips = chipPicker(DPIS.map((d) => [d, String(d)]), s.dpi, (d) => { s.dpi = d; fieldDpi.input.value = d; render() }, 'Common DPI values')
  const fromChips = chipPicker(UNITS.map((u) => [u, u]), s.from, (u) => { s.from = u; render() }, 'Convert from')
  const toChips = chipPicker(UNITS.map((u) => [u, u]), s.to, (u) => { s.to = u; render() }, 'Convert to')
  const swap = button('Swap units', { icon: 'arrow-left-right', variant: 'ghost', size: 'sm', onClick: () => { [s.from, s.to] = [s.to, s.from]; render() } })

  function render() {
    fromChips.set(s.from); toChips.set(s.to); dpiChips.set(DPIS.includes(s.dpi) ? s.dpi : null)
    const dpi = s.dpi > 0 ? s.dpi : NaN
    const hasH = Number.isFinite(s.h) && s.h > 0
    if (!ok(s.w) || !Number.isFinite(dpi)) {
      bigNum.textContent = '-'; bigUnit.textContent = ''
      formula.textContent = 'Enter a width and a DPI to convert.'
      clear(out); return
    }
    const conv = (v, to) => convert(v, s.from, to, dpi)
    const rw = conv(s.w, s.to), rh = hasH ? conv(s.h, s.to) : null
    bigNum.textContent = hasH ? `${fmt(rw, s.to)} x ${fmt(rh, s.to)}` : fmt(rw, s.to)
    bigUnit.textContent = UNIT_NAME[s.to]
    formula.replaceChildren(h('b', hasH ? `${fmt(s.w, s.from)} x ${fmt(s.h, s.from)} ${s.from}` : `${fmt(s.w, s.from)} ${s.from}`), ' = ', h('b', `${bigNum.textContent} ${s.to}`), ` at ${dpi} DPI`)
    const items = UNITS.filter((u) => u !== s.to).map((u) => {
      const a = conv(s.w, u), b = hasH ? conv(s.h, u) : null
      const t = hasH ? `${fmt(a, u)} x ${fmt(b, u)}` : fmt(a, u)
      return { label: UNIT_NAME[u], value: t, hint: u, copy: t }
    })
    clear(out, tiles(items, { copy: (t) => copyText(t) }))
    // reference table: print sizes in pixels at this DPI
    const rows = PAPERS.filter((p) => ['4 x 6 in', '5 x 7 in', '8 x 10 in', 'Letter', 'A5', 'A4', 'A3', 'A2', '24 x 36 in', 'Passport 35 x 45 mm'].includes(p.name)).map((p) =>
      [p.name, `${(p.w * 25.4).toFixed(0)} x ${(p.h * 25.4).toFixed(0)} mm`, `${Math.round(p.w * dpi).toLocaleString()} x ${Math.round(p.h * dpi).toLocaleString()}`])
    clear(refOut, h('h3', { class: 'is-eyebrow' }, `Common print sizes in pixels at ${dpi} DPI`), table({ columns: ['Size', 'In mm', 'Pixels'], rows }))
  }

  const hero = spot(stage(h('div', { class: 'big', 'aria-live': 'polite' }, bigNum, bigUnit), formula))
  root.append(h('div', { class: 't-pxc' }, split(
    panel(h('div', { class: 'stack' },
      h('div', { class: 'inputs' }, fieldW, h('span', { class: 'sep', 'aria-hidden': 'true' }, 'x'), fieldH),
      field('From', fromChips),
      field('To', toChips), swap,
      fieldDpi, dpiChips)),
    h('div', { class: 'stack' }, hero, out, refOut),
    'wide-right')))
  render()
}
