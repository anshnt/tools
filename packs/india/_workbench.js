// Preset workbench: pick a form or exam, then one slot per upload it asks for (photo, signature, thumb, declaration).
// Shared by the government photo resizer and the photo + signature package tool.
import { h, icon, panel, stack, field, button, busy, clear, number, select, onCleanup, download, debounce } from '../../lib/ui.js'
import { zip } from '../../lib/files.js'
import { PRESETS, GROUPS, presetById, customPreset } from './_presets.js'
import { createSlot } from './_slot.js'
import { useStyles, note, link } from './_shared.js'

/**
 * createWorkbench({focus, initial, onChange}) -> {el, slots(), preset(), prefix(), zipBlob(), results()}
 * focus: limits the list to presets tagged with that focus ('aadhaar' | 'passport' | 'pan' | 'exam'); Custom is always offered.
 */
export function createWorkbench({ focus, initial, onChange, withZip = true, custom: allowCustom = true, filter } = {}) {
  useStyles()
  const list = PRESETS.filter((p) => (!focus || p.focus?.includes(focus)) && (!filter || filter(p)))
  const groups = GROUPS.filter((g) => list.some((p) => p.group === g))
  const pick = h('select', { class: 'select', 'aria-label': 'Form or exam', onchange: (e) => setPreset(e.target.value) },
    groups.map((g) => h('optgroup', { label: g }, list.filter((p) => p.group === g).map((p) => h('option', { value: p.id }, p.name)))),
    allowCustom ? h('optgroup', { label: 'Custom' }, h('option', { value: 'custom' }, 'Custom size')) : null)
  const prefixIn = h('input', { class: 'input', type: 'text', placeholder: 'optional, e.g. ravi-kumar', maxlength: 40, 'aria-label': 'File name prefix', oninput: () => applyPrefix() })
  const info = h('div', { class: 'stack' })
  const custom = h('div', { class: 'stack', hidden: true })
  const slotsBox = h('div', { class: 'grid-2' })
  const zipBox = h('div')
  const files = new Map() // slot key -> File, kept when the preset changes
  let preset = null, slots = [], cu = { kind: 'photo', unit: 'px', w: 200, h: 230, dpi: 300, minKB: 20, maxKB: 50 }

  const safePrefix = () => prefixIn.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

  function applyPrefix() {
    for (const s of slots) s.setPrefix(safePrefix() ? `${safePrefix()}` : preset.id === 'custom' ? '' : preset.id)
    updateZip()
  }

  function drawCustom() {
    const mk = (key, label, opts) => field(label, number(cu[key], { min: opts.min ?? 0, step: opts.step ?? 1, ariaLabel: label, onInput: (v) => { if (Number.isFinite(v)) { cu[key] = v; rebuildCustom() } } }))
    clear(custom,
      h('h2', { style: 'margin:0;font-size:16px' }, 'Custom size'),
      h('div', { class: 'grid-2' },
        field('Type', select([['photo', 'Photograph (face framing)'], ['signature', 'Signature or document']], cu.kind, (v) => { cu.kind = v; rebuildCustom() })),
        field('Unit', select([['px', 'Pixels'], ['cm', 'Centimetres'], ['mm', 'Millimetres'], ['in', 'Inches']], cu.unit, (v) => { cu.unit = v; rebuildCustom() }))),
      h('div', { class: 'grid-2' }, mk('w', 'Width', { min: 1, step: 'any' }), mk('h', 'Height', { min: 1, step: 'any' }), mk('dpi', 'DPI (for cm, mm and inches)', { min: 0 }), mk('minKB', 'Minimum KB (0 = none)', { min: 0 }), mk('maxKB', 'Maximum KB (0 = none)', { min: 0 })))
  }
  const rebuildCustom = debounce(() => { if (pick.value === 'custom') build(customPreset(cu)) }, 300)

  function updateInfo() {
    clear(info, preset.id === 'custom' ? null : [
      h('p', { style: 'margin:0;color:var(--text-2);font-size:14px' }, preset.note),
      h('div', { class: 'row small' }, preset.source ? [icon('external-link'), link(preset.source.url, `Official site: ${preset.source.label}`)] : null),
    ])
  }

  function build(p) {
    preset = p
    slots.forEach((s) => s.destroy?.())
    slots = p.slots.map((spec, i) => {
      const s = createSlot({
        spec, paste: i === 0, prefix: safePrefix() || (p.id === 'custom' ? '' : p.id),
        onChange: () => { updateZip(); onChange?.(api) },
        onFile: (f) => files.set(spec.key, f),
      })
      return s
    })
    clear(slotsBox, slots.map((s) => s.el))
    slotsBox.classList.toggle('grid-2', slots.length > 1)
    // reuse images already chosen for the same slot (e.g. switching IBPS to SBI keeps your photo)
    p.slots.forEach((spec, i) => { const f = files.get(spec.key); if (f) slots[i].setFile(f) })
    updateInfo()
    updateZip()
    onChange?.(api)
  }

  function setPreset(id) {
    pick.value = id
    custom.hidden = id !== 'custom'
    if (id === 'custom') { drawCustom(); build(customPreset(cu)) } else build(presetById(id))
  }

  const results = () => slots.map((s) => ({ slot: s, result: s.result })).filter((x) => x.result)
  async function zipBlob() {
    const ok = results()
    return zip(await Promise.all(ok.map(async ({ slot, result }) => ({ name: slot.filename(), data: await result.blob.arrayBuffer() }))))
  }

  function updateZip() {
    if (!withZip) return
    const ok = results()
    const prefix = safePrefix() || (preset.id === 'custom' ? 'files' : preset.id)
    clear(zipBox, slots.length > 1 ? h('div', { class: 'row' },
      (() => {
        const b = button(`Download all as ZIP${ok.length ? ` (${ok.length} of ${slots.length})` : ''}`, { icon: 'package', variant: 'primary', size: 'lg', disabled: !ok.length })
        b.addEventListener('click', () => busy(b, async () => {
          download(await zipBlob(), `${prefix}-upload-files.zip`)
        }, { label: 'Zipping' }))
        return b
      })(),
      ok.length && ok.length < slots.length ? h('span', { class: 'small muted' }, 'Add the remaining images to include them.') : null) : null)
  }

  const api = {
    slots: () => slots, preset: () => preset, prefix: safePrefix, results, zipBlob,
    setPreset, update: updateZip,
    el: stack(
      panel(h('div', { class: 'stack' },
        h('div', { class: 'grid-2' }, field('Form or exam', pick), field('File name prefix', prefixIn, 'Added to every file name')),
        info, custom,
        note('Exam and portal rules change with every notice. These numbers come from published notices and guides, and the tool checks your result against them. Always compare with your own form, and use "Adjust the size rules" if it asks for something different. Photos are processed on your device and never uploaded.'))),
      slotsBox, zipBox),
  }
  setPreset(initial && (initial === 'custom' || presetById(initial)) ? initial : list[0].id)
  onCleanup(() => slots.forEach((s) => s.destroy?.()))
  return api
}
