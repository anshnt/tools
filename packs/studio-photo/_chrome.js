// UI chrome: control builders for the options bar and panels, hover tooltips, popover menus and form dialogs.
import { h, icon, modal, button, toast, errorMessage } from '../../lib/ui.js'

// ---------- compact controls (all expose .set(v) so panels can sync them) ----------
export const ctl = {
  range(label, value, { min = 0, max = 100, step = 1, fmt = (v) => v, onInput, onChange, title } = {}) {
    const out = h('output', fmt(value))
    const inp = h('input', { type: 'range', min, max, step, value, 'aria-label': label, title })
    inp.addEventListener('input', () => { out.textContent = fmt(inp.valueAsNumber); onInput?.(inp.valueAsNumber) })
    inp.addEventListener('change', () => onChange?.(inp.valueAsNumber))
    const el = h('label', { class: 'ps-oc', title }, h('span', { class: 'l' }, label), inp, out)
    el.set = (v) => { if (document.activeElement !== inp) inp.value = v; out.textContent = fmt(Number(v)) }
    return el
  },
  toggle(label, value, onChange, title) {
    const inp = h('input', { type: 'checkbox', checked: !!value, onchange: () => onChange?.(inp.checked) })
    const el = h('label', { class: 'ps-chk', title }, inp, h('span', label))
    el.set = (v) => { inp.checked = !!v }
    return el
  },
  seg(options, value, onChange, label) {
    const el = h('div', { class: 'ps-seg', role: 'group', 'aria-label': label || null })
    const btns = options.map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(v === value), onclick: () => { el.set(v); onChange?.(v) } }, l))
    btns.forEach((b, i) => (b._v = options[i][0]))
    el.append(...btns)
    el.set = (v) => btns.forEach((b) => b.setAttribute('aria-pressed', String(b._v === v)))
    return el
  },
  select(options, value, onChange, label) {
    const el = h('select', { class: 'ps-sel', 'aria-label': label || null, onchange: () => onChange?.(el.value) },
      options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: String(v) === String(value) }, l) }))
    el.set = (v) => { el.value = v }
    return el
  },
  button(label, { icon: ic, primary, onClick, title } = {}) {
    return h('button', { type: 'button', class: ['ps-btn', primary && 'primary'], title, onclick: onClick }, ic && icon(ic), label)
  },
  /** Labeled field for panels: label + live value on top, control below. */
  field(label, control, valueEl) { return h('div', { class: 'ps-f' }, h('div', { class: 'l' }, h('span', label), valueEl || null), control) },
  /** Full-width slider for panels. */
  slider(label, value, { min, max, step = 1, fmt = (v) => v, onInput, onChange }) {
    const out = h('output', fmt(value))
    const inp = h('input', { type: 'range', min, max, step, value, 'aria-label': label })
    inp.addEventListener('input', () => { out.textContent = fmt(inp.valueAsNumber); onInput?.(inp.valueAsNumber) })
    inp.addEventListener('change', () => onChange?.(inp.valueAsNumber))
    const el = h('div', { class: 'ps-f' }, h('div', { class: 'l' }, h('span', label), out), inp)
    el.set = (v) => { if (document.activeElement !== inp) inp.value = v; out.textContent = fmt(Number(v)) }
    el.input = inp
    return el
  },
  num(label, value, { min, max, step = 1, onChange }) {
    const inp = h('input', { class: 'ps-in', type: 'number', min, max, step, value, 'aria-label': label })
    inp.addEventListener('change', () => { const v = inp.valueAsNumber; if (Number.isFinite(v)) onChange?.(v) })
    const el = h('div', { class: 'ps-f' }, h('div', { class: 'l' }, h('span', label)), inp)
    el.set = (v) => { if (document.activeElement !== inp) inp.value = Math.round(v * 100) / 100 }
    return el
  },
  color(label, value, onInput, onChange) {
    const inp = h('input', { type: 'color', value, 'aria-label': label })
    inp.addEventListener('input', () => onInput?.(inp.value))
    inp.addEventListener('change', () => onChange?.(inp.value))
    const el = h('div', { class: 'ps-f' }, h('div', { class: 'l' }, h('span', label)), inp)
    el.set = (v) => { inp.value = v }
    return el
  },
}

// ---------- tooltips (positioned in the page, so scroll containers never clip them) ----------
export function tooltips(root) {
  const tip = h('div', { class: 'ps-tip', role: 'tooltip' })
  root.append(tip)
  let timer
  const hide = () => { clearTimeout(timer); tip.classList.remove('on') }
  const show = (el) => {
    const text = el.dataset.tip
    if (!text) return
    const [label, key] = text.split('|')
    tip.replaceChildren(label, ...(key ? [h('kbd', key)] : []))
    const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect()
    const right = el.dataset.tipPos === 'right'
    let x = right ? r.right + 8 : r.left + r.width / 2 - t.width / 2
    let y = right ? r.top + r.height / 2 - t.height / 2 : r.bottom + 8
    x = Math.max(6, Math.min(innerWidth - t.width - 6, x))
    if (y + t.height > innerHeight - 6) y = r.top - t.height - 8
    tip.style.left = `${x}px`; tip.style.top = `${y}px`
    tip.classList.add('on')
  }
  root.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return
    const el = e.target.closest?.('[data-tip]')
    clearTimeout(timer)
    if (el) timer = setTimeout(() => show(el), 350); else hide()
  })
  root.addEventListener('pointerleave', hide)
  root.addEventListener('pointerdown', hide)
  root.addEventListener('focusin', (e) => { const el = e.target.closest?.('[data-tip]'); if (el && e.target.matches(':focus-visible')) show(el) })
  root.addEventListener('focusout', hide)
  return hide
}

// ---------- popover menu ----------
let openClose = null
/** items: [{label, icon, key, run, disabled, sep, heading}]. Anchored under `anchor` inside `root`. Returns close(). */
export function openMenu(root, anchor, items, { onClose } = {}) {
  openClose?.()
  const menu = h('div', { class: 'ps-menu', role: 'menu' })
  const close = () => {
    menu.remove()
    anchor.setAttribute('aria-expanded', 'false')
    document.removeEventListener('pointerdown', away, true)
    document.removeEventListener('keydown', onKey, true)
    if (openClose === close) openClose = null
    onClose?.()
  }
  const away = (e) => { if (!menu.contains(e.target) && !anchor.contains(e.target)) close() }
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); anchor.focus() }
    const btns = [...menu.querySelectorAll('button:not(:disabled)')]
    const i = btns.indexOf(document.activeElement)
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length]?.focus() }
    if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus() }
  }
  for (const it of items) {
    if (it.sep) { menu.append(h('div', { class: 'ps-ms' })); continue }
    if (it.heading) { menu.append(h('div', { class: 'ps-mh' }, it.heading)); continue }
    const off = typeof it.disabled === 'function' ? it.disabled() : it.disabled
    menu.append(h('button', { type: 'button', class: 'ps-mi', role: 'menuitem', disabled: !!off, onclick: () => { close(); it.run?.() } },
      it.icon ? icon(it.icon) : h('span', { style: 'width:15px' }), h('span', it.label), it.key ? h('kbd', it.key) : null))
  }
  root.append(menu)
  const rr = root.getBoundingClientRect(), ar = anchor.getBoundingClientRect()
  menu.style.left = `${Math.max(4, Math.min(rr.width - menu.offsetWidth - 4, ar.left - rr.left))}px`
  menu.style.top = `${ar.bottom - rr.top + 4}px`
  if (menu.offsetTop + menu.offsetHeight > rr.height - 4) { menu.style.top = 'auto'; menu.style.bottom = `${Math.max(4, rr.bottom - ar.top + 4)}px` }
  anchor.setAttribute('aria-expanded', 'true')
  document.addEventListener('pointerdown', away, true)
  document.addEventListener('keydown', onKey, true)
  openClose = close
  menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true })
  return close
}
export const closeMenus = () => openClose?.()

// ---------- form dialog ----------
/**
 * formDialog({title, fields, ok, onOk(values), onChange(values), onClose(applied), note})
 * fields: {k, label, type: 'number'|'range'|'select'|'toggle'|'color'|'text'|'seg'|'anchor'|'note', value, min, max, step, options, unit, fmt}
 */
export function formDialog({ title, icon: ic, fields, ok = 'Apply', onOk, onChange, onClose, note }) {
  const values = {}
  const els = {}
  let applied = false
  const emit = () => onChange?.({ ...values })
  const rows = fields.map((f) => {
    if (f.type === 'note') return h('p', { class: 'ps-note' }, f.label)
    values[f.k] = f.value
    const fmt = f.fmt || ((v) => v)
    if (f.type === 'range') {
      const out = h('output', fmt(f.value))
      const inp = h('input', { type: 'range', min: f.min, max: f.max, step: f.step ?? 1, value: f.value, 'aria-label': f.label })
      inp.addEventListener('input', () => { values[f.k] = inp.valueAsNumber; out.textContent = fmt(inp.valueAsNumber); emit() })
      return h('div', { class: 'ps-f' }, h('div', { class: 'l' }, h('span', f.label), out), inp)
    }
    if (f.type === 'number') {
      const inp = h('input', { class: 'ps-in', type: 'number', min: f.min, max: f.max, step: f.step ?? 1, value: f.value, 'aria-label': f.label })
      inp.addEventListener('input', () => { values[f.k] = inp.valueAsNumber; f.onInput?.(inp.valueAsNumber, values, els); emit() })
      els[f.k] = inp
      return h('div', { class: 'ps-f' }, h('div', { class: 'l' }, h('span', f.label), f.unit ? h('output', f.unit) : null), inp)
    }
    if (f.type === 'select') {
      const sel = h('select', { class: 'ps-sel', 'aria-label': f.label, onchange: () => { values[f.k] = sel.value; f.onInput?.(sel.value, values, els); emit() } },
        f.options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: String(v) === String(f.value) }, l) }))
      els[f.k] = sel
      return h('div', { class: 'ps-f' }, h('div', { class: 'l' }, h('span', f.label)), sel)
    }
    if (f.type === 'toggle') return h('div', { class: 'ps-f' }, ctl.toggle(f.label, f.value, (v) => { values[f.k] = v; emit() }))
    if (f.type === 'color') return ctl.color(f.label, f.value, (v) => { values[f.k] = v; emit() })
    if (f.type === 'seg') return h('div', { class: 'ps-f' }, h('div', { class: 'l' }, h('span', f.label)), ctl.seg(f.options, f.value, (v) => { values[f.k] = v; f.onInput?.(v, values, els); emit() }))
    if (f.type === 'anchor') {
      const grid = h('div', { class: 'ps-anchor', role: 'group', 'aria-label': f.label })
      const cells = []
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
          const b = h('button', { type: 'button', 'aria-label': `Anchor ${x},${y}`, 'aria-pressed': String(x === 1 && y === 1), onclick: () => { values[f.k] = [x / 2, y / 2]; cells.forEach((c) => c.setAttribute('aria-pressed', String(c === b))); emit() } })
          cells.push(b)
        }
      }
      grid.append(...cells)
      return h('div', { class: 'ps-f' }, h('div', { class: 'l' }, h('span', f.label)), grid)
    }
    const inp = h('input', { class: 'ps-in', type: 'text', value: f.value, 'aria-label': f.label, oninput: () => { values[f.k] = inp.value; emit() } })
    els[f.k] = inp
    return h('div', { class: 'ps-f' }, h('div', { class: 'l' }, h('span', f.label)), inp)
  })
  const okBtn = button(ok, { variant: 'primary' })
  const m = modal({
    title, icon: ic,
    body: h('div', { class: 'ps-form' }, note ? h('p', { class: 'ps-note' }, note) : null, ...rows),
    actions: [button('Cancel', { variant: 'ghost', onClick: () => m.close() }), okBtn],
    onClose: () => onClose?.(applied),
  })
  okBtn.addEventListener('click', async () => {
    okBtn.disabled = true
    try { await onOk?.({ ...values }); applied = true; m.close() } catch (e) { okBtn.disabled = false; toast(errorMessage(e), 'error') }
  })
  m.values = values; m.els = els
  emit()
  m.el.querySelector('input, select')?.focus({ preventScroll: true })
  return m
}

export const parseHex = (s) => {
  const t = String(s).trim().replace(/^#/, '')
  return /^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t) ? '#' + (t.length === 3 ? t.split('').map((c) => c + c).join('') : t).toLowerCase() : null
}
