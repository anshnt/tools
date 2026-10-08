// Shared kit for the calc-money tools: money formatting, live form controls, the animated result hero, tiles, bars,
// charts and one scoped stylesheet. Everything is namespaced `cm-` so it never leaks into other tools.
// Files starting with `_` are never tool modules.
import { h, icon, select, onCleanup, copyText, download, button } from '../../lib/ui.js'
import { chartjs } from '../../lib/libs.js'
import { load, save } from '../../lib/store.js'

const reduced = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

// ---------- Formatting ----------

const LOCALE = { INR: 'en-IN', USD: 'en-US', EUR: 'en-IE', GBP: 'en-GB', AUD: 'en-AU', CAD: 'en-CA', SGD: 'en-SG', AED: 'en-AE', CHF: 'en-CH', JPY: 'en-US', NZD: 'en-NZ', ZAR: 'en-ZA' }
const ZERO_DECIMALS = new Set(['INR', 'JPY', 'KRW', 'VND', 'IDR', 'CLP'])
export const CURRENCIES = [
  ['INR', 'Indian rupee'], ['USD', 'US dollar'], ['EUR', 'Euro'], ['GBP', 'British pound'], ['AUD', 'Australian dollar'], ['CAD', 'Canadian dollar'],
  ['SGD', 'Singapore dollar'], ['AED', 'UAE dirham'], ['CHF', 'Swiss franc'], ['JPY', 'Japanese yen'], ['NZD', 'New Zealand dollar'], ['ZAR', 'South African rand'],
]
const formatters = new Map()
const fmt = (cur, d, extra = '') => {
  const key = `${cur}|${d}|${extra}`
  if (!formatters.has(key)) {
    const opts = extra === 'compact'
      ? { style: 'currency', currency: cur, notation: 'compact', maximumFractionDigits: 2 }
      : { style: 'currency', currency: cur, minimumFractionDigits: d, maximumFractionDigits: d }
    formatters.set(key, new Intl.NumberFormat(LOCALE[cur] || 'en-US', opts))
  }
  return formatters.get(key)
}

/** Money with Intl.NumberFormat. INR gets lakh/crore grouping (en-IN). d = fraction digits (default: 0 for INR/JPY, else 2). */
export function money(n, cur = 'INR', d) {
  if (!Number.isFinite(n)) return '-'
  const digits = d ?? (ZERO_DECIMALS.has(cur) ? 0 : 2)
  const v = Math.abs(n) < 0.5 * 10 ** -digits ? 0 : n
  try { return fmt(cur, digits).format(v) } catch { return `${cur} ${v.toFixed(digits)}` }
}

export function symbol(cur) {
  try {
    return new Intl.NumberFormat(LOCALE[cur] || 'en-US', { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency').value
  } catch { return cur }
}

const trim = (x) => String(+x.toFixed(2))
/** Short money: lakh/crore for INR, K/M/B for everything else. */
export function short(n, cur = 'INR') {
  if (!Number.isFinite(n)) return '-'
  const a = Math.abs(n)
  const s = n < 0 ? '-' : ''
  if (cur === 'INR') {
    if (a >= 1e7) return `${s}${symbol(cur)}${trim(a / 1e7)} Cr`
    if (a >= 1e5) return `${s}${symbol(cur)}${trim(a / 1e5)} L`
    return money(n, cur)
  }
  if (a >= 1e4) { try { return fmt(cur, 2, 'compact').format(n) } catch { /* fall through */ } }
  return money(n, cur)
}

/** Plain number with grouping and up to `max` decimals. */
export const fnum = (n, max = 2) => (Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: max }) : '-')
export const pct = (n, max = 2) => (Number.isFinite(n) ? `${n.toLocaleString('en-US', { maximumFractionDigits: max })}%` : '-')
export const plural = (n, word) => `${fnum(n, 0)} ${word}${Math.round(n) === 1 ? '' : 's'}`
/** 75 -> "6 yr 3 mo" */
export function monthsLabel(m) {
  const mm = Math.round(m)
  const y = Math.floor(mm / 12)
  const r = mm % 12
  return [y ? `${y} yr` : '', r || !y ? `${r} mo` : ''].filter(Boolean).join(' ')
}
export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const monthName = (d) => d.toLocaleString('en-US', { month: 'short', year: 'numeric' })

export function toCSV(rows) {
  return rows.map((r) => r.map((c) => {
    const s = String(c ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')).join('\n')
}
export const downloadCSV = (rows, name) => download(`﻿${toCSV(rows)}`, name, 'text/csv;charset=utf-8')

// ---------- Styles ----------

/** Inject a <style> once (id guards against duplicates). Tools use this for their few custom rules. */
export function style(id, css) {
  if (document.getElementById(id)) return
  document.head.append(h('style', { id }, css))
}
export const useStyles = () => style('cm-style', CSS)

// ---------- Count-up ----------

function fit(el) {
  el.style.fontSize = ''
  let size = parseFloat(getComputedStyle(el).fontSize)
  let guard = 0
  while (el.scrollWidth > el.clientWidth + 1 && size > 22 && guard++ < 30) { size -= 2; el.style.fontSize = `${size}px` }
}

/** Animate el's text from its previous number to `to`. The exact final text is always set at the end (and when motion is reduced). */
export function tween(el, to, format, ms = 420) {
  const from = el._v
  el._v = to
  el.dataset.final = format(to)
  cancelAnimationFrame(el._raf)
  const start = Number.isFinite(from) ? from : 0
  if (reduced() || document.hidden || start === to) { el.textContent = el.dataset.final; fit(el); return }
  const t0 = performance.now()
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms)
    const e = 1 - (1 - k) ** 3
    el.textContent = k >= 1 ? el.dataset.final : format(start + (to - start) * e)
    if (k < 1) el._raf = requestAnimationFrame(step)
    else fit(el)
  }
  el._raf = requestAnimationFrame(step)
}

// ---------- Form controls ----------

let uid = 0

function inputCore(label, o = {}) {
  const pre = h('span', { class: 'pre' }, o.prefix || '')
  const suf = h('span', { class: 'suf' }, o.suffix || '')
  const inp = h('input', {
    class: 'cm-in', type: 'number', inputmode: o.int ? 'numeric' : 'decimal', min: o.min, max: o.max, step: o.step ?? (o.int ? 1 : 'any'),
    placeholder: o.placeholder ?? '0', value: o.value ?? '', 'aria-label': label, autocomplete: 'off',
    oninput: (e) => { upd(); o.onInput?.(inp.valueAsNumber, e) },
  })
  const wrap = h('div', { class: ['cm-adorn', o.small && 'sm'] }, pre, inp, suf)
  const status = () => {
    const v = inp.valueAsNumber
    if (Number.isNaN(v)) return inp.value === '' ? (o.optional ? 'ok' : 'empty') : 'bad'
    if (o.min != null && v < o.min) return 'low'
    if (o.max != null && v > o.max) return 'high'
    return 'ok'
  }
  function upd() { wrap.classList.toggle('bad', ['low', 'high', 'bad'].includes(status())) }
  const core = {
    wrap, inp, pre, suf, upd,
    val: () => (status() === 'ok' ? (Number.isNaN(inp.valueAsNumber) ? (o.fallback ?? 0) : inp.valueAsNumber) : NaN),
    raw: () => inp.valueAsNumber,
    issue() {
      const s = status()
      if (s === 'ok') return ''
      if (s === 'empty') return `${label}: enter a number`
      if (s === 'bad') return `${label}: that is not a valid number`
      const span = o.min != null && o.max != null ? `between ${fnum(o.min, 4)} and ${fnum(o.max, 4)}` : s === 'low' ? `of at least ${fnum(o.min, 4)}` : `of at most ${fnum(o.max, 4)}`
      return `${label}: use a value ${span}`
    },
    set(v) { inp.value = Number.isFinite(v) ? String(+v.toFixed(6)) : ''; upd() },
    setRange(min, max) { o.min = min; o.max = max; if (min != null) inp.min = min; if (max != null) inp.max = max; upd() },
  }
  upd()
  return core
}

const bindApi = (el, core, extra = {}) => Object.assign(el, { input: core.inp, val: core.val, raw: core.raw, issue: core.issue, set: core.set, setRange: core.setRange, setPrefix: (t) => { core.pre.textContent = t }, setSuffix: (t) => { core.suf.textContent = t }, ...extra })

/**
 * num('Loan amount', {value, min, max, step, prefix, suffix, hint, tag, int, optional, fallback, small, onInput(n)}) -> label element.
 * el.val() is NaN unless the field holds a valid number inside [min, max] (an empty optional field gives `fallback`, default 0).
 * el.issue() describes the problem in plain words; el.set(v); el.setHint(text); el.setPrefix/Suffix(text).
 */
export function num(label, o = {}) {
  const core = inputCore(label, o)
  const hint = h('small', { class: 'cm-hint' }, o.hint || '')
  const el = h('label', { class: ['cm-field', o.class] },
    label && h('span', { class: 'cm-label' }, h('span', label), o.tag && h('small', o.tag)), core.wrap, hint)
  const lab = el.querySelector('.cm-label span')
  return bindApi(el, core, { setHint: (t) => { hint.textContent = t || '' }, setLabel: (t) => { if (lab) lab.textContent = t; core.inp.setAttribute('aria-label', t) } })
}

/** inline('Percent', {value, min, max, suffix, onInput}) - a compact bare input for use inside a sentence. */
export function inline(label, o = {}) {
  const core = inputCore(label, { ...o, small: true })
  return bindApi(core.wrap, core)
}

/** slide('Loan amount', {min, max, step, value, hardMin, hardMax, prefix, suffix, tickFormat, onInput}) - number box plus a gradient range. */
export function slide(label, o) {
  let { min, max } = o
  const step = o.step ?? 1
  const logMode = !!o.log
  const core = inputCore(label, { ...o, min: o.hardMin ?? min, max: o.hardMax ?? max, small: true, onInput: (v, e) => { setP(); o.onInput?.(v, e) } })
  const tf = o.tickFormat || ((v) => fnum(v, 2))
  const niceRound = (v) => { const m = 10 ** (Math.floor(Math.log10(Math.max(v, 1))) - 2); return Math.round(v / m) * m }
  const toPos = (v) => (logMode ? (Math.log(v / min) / Math.log(max / min)) * 1000 : v)
  const toVal = (p) => (logMode ? (p >= 1000 ? max : p <= 0 ? min : niceRound(min * (max / min) ** (p / 1000))) : p)
  const range = h('input', {
    class: 'cm-range', type: 'range', min: logMode ? 0 : min, max: logMode ? 1000 : max, step: logMode ? 1 : step, 'aria-label': `${label} slider`,
    oninput: () => { core.inp.value = String(+toVal(range.valueAsNumber).toFixed(6)); core.upd(); setP(true); o.onInput?.(core.inp.valueAsNumber) },
  })
  const minT = h('span', tf(min))
  const maxT = h('span', tf(max))
  function setP(fromRange) {
    const lo = logMode ? 0 : min
    const hi = logMode ? 1000 : max
    if (fromRange) { range.style.setProperty('--p', `${((range.valueAsNumber - lo) / (hi - lo)) * 100}%`); return }
    const v = Math.min(max, Math.max(min, Number.isNaN(core.inp.valueAsNumber) ? min : core.inp.valueAsNumber))
    const pos = toPos(v)
    range.value = pos
    range.style.setProperty('--p', `${((pos - lo) / (hi - lo)) * 100}%`)
  }
  const hint = h('small', { class: 'cm-hint' }, o.hint || '')
  const el = h('div', { class: 'cm-field cm-slide' },
    h('div', { class: 'cm-slide-head' }, h('span', { class: 'cm-label' }, h('span', label)), core.wrap),
    range,
    h('div', { class: 'cm-ticks' }, minT, hint, maxT))
  setP()
  return bindApi(el, core, {
    set: (v) => { core.set(v); setP() },
    setHint: (t) => { hint.textContent = t || '' },
    /** Change the slider's visible range (and optionally the allowed typed range). */
    setBounds: (lo, hi, hardLo, hardHi) => {
      min = lo; max = hi
      core.setRange(hardLo ?? lo, hardHi ?? hi)
      if (!logMode) { range.min = lo; range.max = hi }
      minT.textContent = tf(lo); maxT.textContent = tf(hi)
      setP()
    },
  })
}

/** stepper('People', {value, min, max, onInput}) - integer with minus/plus buttons. */
export function stepper(label, o = {}) {
  const { min = 1, max = 99 } = o
  const core = inputCore(label, { ...o, min, max, int: true, onInput: (v, e) => o.onInput?.(v, e) })
  core.inp.classList.add('ctr')
  const bump = (d) => {
    const v = Number.isFinite(core.inp.valueAsNumber) ? core.inp.valueAsNumber : min
    core.set(Math.min(max, Math.max(min, Math.round(v) + d)))
    o.onInput?.(core.inp.valueAsNumber)
  }
  const minus = h('button', { type: 'button', class: 'cm-step', 'aria-label': `Fewer ${label}`, onclick: () => bump(-1) }, icon('minus'))
  const plus = h('button', { type: 'button', class: 'cm-step', 'aria-label': `More ${label}`, onclick: () => bump(1) }, icon('plus'))
  const el = h('div', { class: 'cm-field' }, h('span', { class: 'cm-label' }, h('span', label)), h('div', { class: 'cm-stepper' }, minus, core.wrap, plus))
  return bindApi(el, core)
}

/** dateField('First EMI', {type: 'month'|'date', value: '2026-11', onInput}) - el.val() is the ISO string or ''. */
export function dateField(label, o = {}) {
  const inp = h('input', { class: 'cm-date', type: o.type || 'date', value: o.value || '', min: o.min, max: o.max, 'aria-label': label, oninput: (e) => o.onInput?.(inp.value, e) })
  const hint = h('small', { class: 'cm-hint' }, o.hint || '')
  const el = h('label', { class: 'cm-field' }, h('span', { class: 'cm-label' }, h('span', label)), h('div', { class: 'cm-adorn' }, inp), hint)
  el.input = inp
  el.val = () => inp.value
  el.date = () => (inp.value ? new Date(`${inp.value}${(o.type || 'date') === 'month' ? '-01' : ''}T00:00:00`) : null)
  el.set = (v) => { inp.value = v }
  el.setHint = (t) => { hint.textContent = t || '' }
  return el
}

/** pills([['v','Label', 'icon?']], value, onChange, ariaLabel) - single-choice chips. el.set(v) (null clears), el.value. */
export function pills(options, value, onChange, ariaLabel) {
  const el = h('div', { class: 'cm-pills', role: 'group', 'aria-label': ariaLabel || null })
  const btns = options.map((o) => {
    const [v, l, ic] = Array.isArray(o) ? o : [o, o]
    const b = h('button', { type: 'button', 'aria-pressed': String(v === value), onclick: () => { el.set(v); onChange?.(v) } }, ic && icon(ic), h('span', l))
    b._v = v
    return b
  })
  el.append(...btns)
  el.value = value
  el.set = (v) => { el.value = v; for (const b of btns) b.setAttribute('aria-pressed', String(b._v === v)) }
  return el
}

/** switcher([['a','A']], 'a', onChange, ariaLabel) - equal-width segmented control with a sliding indicator. */
export function switcher(options, value, onChange, ariaLabel) {
  const idx = (v) => Math.max(0, options.findIndex((o) => (Array.isArray(o) ? o[0] : o) === v))
  const el = h('div', { class: 'cm-switch', role: 'group', 'aria-label': ariaLabel || null, style: { '--n': options.length, '--i': idx(value) } })
  const btns = options.map((o) => {
    const [v, l, ic] = Array.isArray(o) ? o : [o, o]
    const b = h('button', { type: 'button', 'aria-pressed': String(v === value), onclick: () => { el.set(v); onChange?.(v) } }, ic && icon(ic), h('span', l))
    b._v = v
    return b
  })
  el.append(...btns)
  el.value = value
  el.set = (v) => {
    el.value = v
    el.style.setProperty('--i', idx(v))
    for (const b of btns) b.setAttribute('aria-pressed', String(b._v === v))
  }
  return el
}

/** A small native <select> styled for the kit. Persists nothing; see currencyPicker for the shared currency. */
export function pick(options, value, onChange, ariaLabel) {
  const sel = select(options, value, onChange)
  sel.classList.add('cm-sel')
  if (ariaLabel) sel.setAttribute('aria-label', ariaLabel)
  return sel
}

/** A labelled select field. */
export function selectField(label, options, value, onChange, hint) {
  const sel = pick(options, value, onChange, label)
  const el = h('label', { class: 'cm-field' }, h('span', { class: 'cm-label' }, h('span', label)), sel, hint && h('small', { class: 'cm-hint' }, hint))
  el.select = sel
  Object.defineProperty(el, 'value', { get: () => sel.value, set: (v) => { sel.value = v } })
  return el
}

/** Shared currency (saved on this device). onChange(code) fires on change; el.get() returns the code. */
export function currencyPicker(onChange, o = {}) {
  const list = o.list || CURRENCIES
  let saved = load('cm:currency', o.fallback || 'INR')
  if (!list.some(([c]) => c === saved)) saved = list[0][0]
  const sel = pick(list.map(([c, n]) => [c, `${c} - ${n}`]), saved, (v) => { save('cm:currency', v); onChange?.(v) }, 'Currency')
  sel.classList.add('cm-sel-sm')
  sel.get = () => sel.value
  return sel
}

// ---------- Result hero ----------

/**
 * hero({label, tone: 'violet'|'ocean'|'mint'|'sunset'|'gold'|'rose', icon})
 * hero.set({n, fmt, text, sub, chips: [{label, value}], bar: [{label, value, color?}], copy}) animates n with fmt (or shows text).
 * hero.empty('Enter the amount') shows a calm placeholder. On phones a docked copy of the result follows you while you edit.
 */
export function hero({ label, tone = 'violet', icon: ic } = {}) {
  const labText = h('span', label)
  const val = h('div', { class: 'cm-hero-value', 'aria-hidden': 'true' }, '-')
  const sr = h('span', { class: 'sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' })
  const sub = h('div', { class: 'cm-hero-sub' })
  const chips = h('div', { class: 'cm-hero-chips' })
  const barRow = h('div', { class: 'cm-hero-bar', hidden: true })
  const legend = h('div', { class: 'cm-hero-legend' })
  let copyText_ = ''
  const copyIcon = icon('copy')
  const copyBtn = h('button', {
    type: 'button', class: 'cm-hero-copy', 'aria-label': 'Copy result', title: 'Copy result',
    onclick: async () => {
      if (!copyText_) return
      if (await copyText(copyText_)) {
        copyBtn.classList.add('ok')
        copyBtn.replaceChildren(icon('check'))
        setTimeout(() => { copyBtn.classList.remove('ok'); copyBtn.replaceChildren(copyIcon) }, 1400)
      }
    },
  }, copyIcon)
  const el = h('section', {
    class: 'cm-hero', 'data-tone': tone,
    onpointermove: (e) => {
      const r = el.getBoundingClientRect()
      el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`)
      el.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`)
    },
  },
  h('div', { class: 'cm-hero-bg', 'aria-hidden': 'true' }), h('div', { class: 'cm-hero-grain', 'aria-hidden': 'true' }), h('div', { class: 'cm-hero-sheen', 'aria-hidden': 'true' }),
  h('div', { class: 'cm-hero-top' }, h('span', { class: 'cm-hero-label' }, ic && icon(ic), labText), copyBtn),
  val, sr, sub, chips, barRow, legend)
  const api = { el, dockText: { label: '', value: '' } }
  let dock = null

  function paintBar(items) {
    const total = items.reduce((s, i) => s + Math.max(0, i.value), 0)
    barRow.hidden = !(total > 0)
    if (!(total > 0)) { legend.replaceChildren(); return }
    if (barRow.children.length !== items.length) barRow.replaceChildren(...items.map(() => h('i')))
    items.forEach((it, i) => {
      const seg = barRow.children[i]
      seg.style.width = `${(Math.max(0, it.value) / total) * 100}%`
      seg.style.background = it.color || BAR_COLORS[i % BAR_COLORS.length]
    })
    legend.replaceChildren(...items.map((it, i) => h('span', {}, h('i', { style: { background: it.color || BAR_COLORS[i % BAR_COLORS.length] } }), `${it.label} `, h('b', it.text ?? `${Math.round((Math.max(0, it.value) / total) * 100)}%`))))
  }

  api.set = ({ n, fmt: f, text, sub: s, chips: c, bar, copy, label: l }) => {
    el.classList.remove('is-empty')
    if (l) labText.textContent = l
    const final = text ?? f(n)
    if (n != null && f && text == null) tween(val, n, f)
    else { cancelAnimationFrame(val._raf); val._v = null; val.textContent = final; val.dataset.final = final; fit(val) }
    sr.textContent = `${labText.textContent}: ${final}`
    sub.textContent = s || ''
    sub.hidden = !s
    chips.replaceChildren(...(c || []).map((x) => h('span', { class: 'cm-glass' }, h('i', x.label), h('b', x.value))))
    chips.hidden = !(c && c.length)
    paintBar(bar || [])
    copyText_ = copy ?? `${labText.textContent}: ${final}${s ? ` (${s})` : ''}`
    api.dockText = { label: labText.textContent, value: final }
    paintDock()
  }
  api.empty = (msg = 'Fill in the details to see the result') => {
    el.classList.add('is-empty')
    cancelAnimationFrame(val._raf)
    val._v = null
    val.textContent = '-'
    val.dataset.final = ''
    sr.textContent = msg
    sub.textContent = msg
    sub.hidden = false
    chips.replaceChildren()
    chips.hidden = true
    paintBar([])
    copyText_ = ''
    api.dockText = { label: labText.textContent, value: '-' }
    paintDock()
  }
  api.value = () => val.dataset.final
  api.setTone = (tn) => { el.dataset.tone = tn }

  // Phone dock: a compact copy of the result that follows you while you edit inputs and the hero is off screen.
  let out = false
  let touched = false
  const sync = () => dock?.classList.toggle('show', out && touched)
  function paintDock() {
    if (!dock) return
    dock.querySelector('.l').textContent = api.dockText.label
    dock.querySelector('b').textContent = api.dockText.value
  }
  function setupDock() {
    dock = h('button', { type: 'button', class: 'cm-dock', 'aria-label': 'Scroll to the result', onclick: () => el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' }) },
      h('span', { class: 'l' }), h('b'), icon('arrow-down'))
    document.body.append(dock)
    const io = new IntersectionObserver(([e]) => { out = !e.isIntersecting; sync() }, { threshold: 0.2 })
    io.observe(el)
    const onIn = (e) => { if (e.target.closest?.('.cm')) { touched = true; sync() } }
    document.addEventListener('input', onIn, true)
    onCleanup(() => { io.disconnect(); dock.remove(); document.removeEventListener('input', onIn, true) })
    paintDock()
  }
  queueMicrotask(() => { if (typeof IntersectionObserver !== 'undefined') setupDock() })
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => fit(val))
    ro.observe(el)
    onCleanup(() => ro.disconnect())
  }
  onCleanup(() => cancelAnimationFrame(val._raf))
  return api
}
const BAR_COLORS = ['rgba(255,255,255,.95)', '#fdba74', '#f0abfc', '#67e8f9', '#bef264']

// ---------- Tiles and bars (updated in place so numbers tween instead of flashing) ----------

/**
 * tiles() -> element with .set([{key?, label, value | n+fmt, hint, tone, icon}]).
 * tone: indigo | pink | orange | teal | amber | sky | violet | green | red. Existing tiles are updated in place.
 */
export function tiles() {
  const el = h('div', { class: 'cm-tiles' })
  const pool = new Map()
  el.set = (items) => {
    const seen = new Set()
    items.forEach((it, idx) => {
      const key = it.key || it.label
      seen.add(key)
      let rec = pool.get(key)
      if (!rec) {
        rec = { node: h('div', { class: 'cm-tile', style: { '--i': idx } }), v: h('div', { class: 'v' }), l: h('div', { class: 'l' }), hint: h('div', { class: 'hint' }), ic: h('span', { class: 'ic' }) }
        rec.node.append(rec.ic, h('div', { class: 'tx' }, rec.l, rec.v, rec.hint))
        pool.set(key, rec)
      }
      rec.node.dataset.t = it.tone || 'indigo'
      rec.node.classList.toggle('wide', !!it.wide)
      rec.node.classList.toggle('bad', !!it.danger)
      rec.l.textContent = it.label
      if (it.n != null && it.fmt) tween(rec.v, it.n, it.fmt, 300)
      else { cancelAnimationFrame(rec.v._raf); rec.v._v = null; rec.v.textContent = it.value ?? '-' }
      rec.hint.textContent = it.hint || ''
      rec.hint.hidden = !it.hint
      if (rec.icName !== it.icon) { rec.icName = it.icon; rec.ic.replaceChildren(icon(it.icon || 'circle')) }
      rec.ic.hidden = !it.icon
      if (el.children[idx] !== rec.node) el.insertBefore(rec.node, el.children[idx] || null)
    })
    for (const [k, rec] of pool) if (!seen.has(k)) { rec.node.remove(); pool.delete(k) }
  }
  return el
}

/** bars() -> element with .set([{key?, label, value, text, color?}]) - proportional bars that animate their width. */
export function bars() {
  const el = h('div', { class: 'cm-bars' })
  const pool = new Map()
  el.set = (items, total) => {
    const sum = total ?? Math.max(...items.map((i) => i.value), 0)
    const seen = new Set()
    items.forEach((it, idx) => {
      const key = it.key || it.label
      seen.add(key)
      let rec = pool.get(key)
      if (!rec) {
        rec = { node: h('div', { class: 'cm-bar-row' }), name: h('span'), val: h('b'), dot: h('i', { class: 'cm-dot' }), fill: h('i') }
        rec.node.append(h('div', { class: 'cm-bar-top' }, rec.dot, rec.name, rec.val), h('div', { class: 'cm-bar-track' }, rec.fill))
        pool.set(key, rec)
      }
      const color = it.color || chartColor(idx)
      rec.dot.style.background = color
      rec.fill.style.background = color
      rec.name.textContent = it.label
      rec.val.textContent = it.text ?? fnum(it.value)
      rec.fill.style.width = `${sum > 0 ? Math.max(0, Math.min(100, (it.value / sum) * 100)) : 0}%`
      if (el.children[idx] !== rec.node) el.insertBefore(rec.node, el.children[idx] || null)
    })
    for (const [k, rec] of pool) if (!seen.has(k)) { rec.node.remove(); pool.delete(k) }
  }
  return el
}

/**
 * listEditor({items, render(item, i) -> Node, newItem() -> item (or add() to insert it yourself), onChange, addLabel, min, max}) - rows you can add and remove.
 * Row inputs should update `item` and call onChange themselves; adding or removing redraws the rows.
 */
export function listEditor({ items, render, newItem, add, onChange, addLabel = 'Add', min = 0, max = 12 }) {
  const rows = h('div', { class: 'cm-list-rows' })
  const addBtn = button(addLabel, { icon: 'plus', variant: 'secondary', size: 'sm', onClick: () => { if (add) add(); else items.push(newItem()); draw(items.length - 1); onChange?.() } })
  function draw(fresh = -1) {
    rows.replaceChildren(...items.map((it, i) => h('div', { class: ['cm-list-row', i === fresh && 'fresh'] },
      h('div', { class: 'cm-list-body' }, render(it, i)),
      button('', { icon: 'trash-2', variant: 'ghost', size: 'sm', ariaLabel: 'Remove this row', disabled: items.length <= min, onClick: () => { items.splice(i, 1); draw(); onChange?.() } }))))
    addBtn.disabled = items.length >= max
  }
  draw()
  const el = h('div', { class: 'cm-list' }, rows, addBtn)
  el.items = items
  el.redraw = () => draw()
  return el
}

// ---------- Cards, layout, notes ----------

/** card('Title', {right: node, icon}, ...children) - a panel with a header row. */
export function card(title, opts = {}, ...kids) {
  return h('section', { class: ['panel', 'cm-card', opts.class] },
    (title || opts.right) && h('div', { class: 'cm-card-head' }, h('h2', {}, opts.icon && icon(opts.icon), title), opts.right || null), kids)
}
/** layout(leftNodes, rightNodes, belowNodes?) - inputs on the left, a sticky result column on the right (stacked on phones). */
export function layout(left, right, below) {
  const col = h('div', { class: 'cm-col cm-right' }, right)
  const el = h('div', { class: 'cm-layout' }, h('div', { class: 'cm-col' }, left), col)
  const pin = () => col.classList.toggle('cm-pin', col.offsetHeight < innerHeight - 120)
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(pin)
    ro.observe(col)
    addEventListener('resize', pin)
    onCleanup(() => { ro.disconnect(); removeEventListener('resize', pin) })
  }
  return below ? h('div', { class: 'cm-stack' }, el, below) : el
}
/** block('Label', node) - a labelled group for controls that are not a single input. */
export const block = (label, ...kids) => h('div', { class: 'cm-field' }, h('span', { class: 'cm-label' }, h('span', label)), kids)
export const note = (...kids) => h('p', { class: 'cm-note' }, icon('info'), h('span', kids))
export const grid2 = (...kids) => h('div', { class: 'cm-grid2' }, kids)
export const grid3 = (...kids) => h('div', { class: 'cm-grid3' }, kids)
export const stack = (...kids) => h('div', { class: 'cm-stack' }, kids)

/** root wrapper: injects styles and returns the `.cm` container to append everything to. */
export function shell(root, ...kids) {
  useStyles()
  const el = h('div', { class: 'cm' }, kids)
  root.append(el)
  return el
}

/** Ledger-style slip: slip().set({title, rows:[{label, value, strong, sub, tone}], total:{label, value}}) */
export function slip() {
  const el = h('div', { class: 'cm-slip' })
  el.set = ({ title, rows, total, foot }) => {
    el.replaceChildren(...[
      title && h('div', { class: 'cm-slip-title' }, icon('receipt'), title),
      h('div', { class: 'cm-slip-rows' }, rows.map((r) => h('div', { class: ['cm-slip-row', r.strong && 'strong', r.tone, r.sub && 'has-sub'] },
        h('span', { class: 'k' }, r.label, r.sub && h('small', r.sub)), h('i', { class: 'lead' }), h('span', { class: 'v' }, r.value)))),
      total && h('div', { class: 'cm-slip-total' }, h('span', total.label), h('b', total.value)),
      foot && h('div', { class: 'cm-slip-foot' }, foot),
    ].filter(Boolean))
  }
  return el
}

/** Show the first problem among fields (plain-words) or null. */
export const firstIssue = (...fields) => fields.map((f) => f?.issue?.()).find(Boolean) || ''

// ---------- Charts (Chart.js, loaded on demand) ----------

const PALETTE_L = ['#5b4cf0', '#f97316', '#ec4899', '#0d9488', '#ca8a04', '#0284c7', '#9333ea', '#65a30d']
const PALETTE_D = ['#8b7dff', '#fb923c', '#f472b6', '#2dd4bf', '#facc15', '#38bdf8', '#c084fc', '#a3e635']
const isDark = () => document.documentElement.dataset.theme === 'dark'
export const chartColor = (i) => (isDark() ? PALETTE_D : PALETTE_L)[i % PALETTE_L.length]
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
function withAlpha(color, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(color)
  if (!m) return color
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

const centerPlugin = {
  id: 'cmCenter',
  afterDraw(chart, _args, opts) {
    if (!opts || !opts.title) return
    const { ctx, chartArea: { left, right, top, bottom } } = chart
    const x = (left + right) / 2
    const y = (top + bottom) / 2
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = opts.color
    ctx.font = `650 ${opts.size || 22}px ${opts.family}`
    ctx.fillText(opts.title, x, y - 8)
    ctx.fillStyle = opts.sub
    ctx.font = `500 12px ${opts.family}`
    ctx.fillText(opts.caption || '', x, y + 14)
    ctx.restore()
  },
}

/**
 * chartBox({height}) -> element with .render(cfg), cfg = {type: 'doughnut'|'line'|'bar', labels, datasets: [{label, data, color}], format, axisFormat,
 * stacked, legend, center: {title, caption}}. color is a palette index or a CSS color. Re-themes itself when dark mode toggles.
 */
export function chartBox({ height = 250, ariaLabel = 'Chart' } = {}) {
  const canvas = h('canvas', { role: 'img', 'aria-label': ariaLabel })
  const el = h('div', { class: 'cm-chart', style: { height: `${height}px` } }, canvas)
  let chart = null
  let last = null
  let token = 0
  let dead = false

  async function paint() {
    if (!last) return
    const mine = ++token
    let Chart
    try { Chart = await chartjs() } catch {
      el.replaceChildren(h('div', { class: 'cm-chart-fail' }, icon('chart-no-axes-column'), 'The chart could not load (no connection?). Your numbers are not affected.'))
      return
    }
    if (dead || mine !== token) return
    const cfg = last
    const family = getComputedStyle(document.body).fontFamily
    const muted = cssVar('--muted')
    const grid = cssVar('--border')
    const dark = isDark()
    const colorOf = (c, i) => (typeof c === 'number' ? chartColor(c) : c || chartColor(i))
    const f = cfg.format || ((v) => fnum(v))
    const af = cfg.axisFormat || f
    const data = { labels: cfg.labels, datasets: cfg.datasets.map((ds, i) => {
      const c = colorOf(ds.color, i)
      if (cfg.type === 'doughnut') return { label: ds.label, data: ds.data, backgroundColor: ds.data.map((_, j) => colorOf(ds.colors?.[j], j)), borderWidth: 0, borderRadius: 7, spacing: 3, hoverOffset: 6 }
      if (cfg.type === 'bar') return { label: ds.label, data: ds.data, backgroundColor: c, borderRadius: 6, borderSkipped: false, maxBarThickness: 44 }
      return { label: ds.label, data: ds.data, borderColor: c, backgroundColor: withAlpha(c, ds.fill === false ? 0 : 0.16), fill: ds.fill !== false, tension: 0.32, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, stepped: ds.stepped || false }
    }) }
    const scales = cfg.type === 'doughnut' ? {} : {
      x: { stacked: !!cfg.stacked, grid: { display: false }, border: { display: false }, ticks: { color: muted, maxRotation: 0, autoSkipPadding: 14, font: { family, size: 11 } } },
      y: { stacked: !!cfg.stacked, beginAtZero: cfg.beginAtZero !== false, grid: { color: grid }, border: { display: false }, ticks: { color: muted, maxTicksLimit: 6, font: { family, size: 11 }, callback: (v) => af(v) } },
    }
    const options = {
      responsive: true, maintainAspectRatio: false, cutout: cfg.type === 'doughnut' ? '72%' : undefined,
      animation: { duration: reduced() ? 0 : 650, easing: 'easeOutQuart' },
      interaction: cfg.type === 'line' ? { mode: 'index', intersect: false } : undefined,
      layout: { padding: cfg.type === 'doughnut' ? 6 : 0 },
      scales,
      plugins: {
        legend: { display: cfg.legend !== false, position: 'bottom', labels: { color: cssVar('--text-2'), usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 14, font: { family, size: 12 } } },
        tooltip: {
          backgroundColor: dark ? '#2a2a38' : '#0b0b10', titleColor: '#fff', bodyColor: '#fff', padding: 10, cornerRadius: 10, boxPadding: 4, titleFont: { family }, bodyFont: { family },
          callbacks: { label: (ctx) => ` ${ctx.dataset.label ? `${ctx.dataset.label}: ` : `${ctx.label}: `}${f(ctx.parsed?.y ?? ctx.parsed)}` },
        },
        cmCenter: cfg.center ? { ...cfg.center, color: cssVar('--text'), sub: muted, family } : undefined,
      },
    }
    if (chart && chart.config.type === cfg.type) {
      chart.data = data
      chart.options = options
      chart.update()
    } else {
      chart?.destroy()
      if (!canvas.isConnected) el.replaceChildren(canvas)
      chart = new Chart(canvas, { type: cfg.type, data, options, plugins: [centerPlugin] })
    }
  }
  el.render = (cfg) => { last = cfg; return paint() }
  const mo = new MutationObserver(() => paint())
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  onCleanup(() => { dead = true; mo.disconnect(); chart?.destroy(); chart = null })
  return el
}

// ---------- Stylesheet ----------

const CSS = `
.cm { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.cm-stack { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.cm-stack > div:empty, .cm > div:empty { display: none; }
.cm-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.cm-col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.cm-col.cm-pin { position: sticky; top: calc(var(--header-h) + 14px); }
.cm-grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.cm-grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.cm .panel { border-radius: 24px; padding: 20px; background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 3.5%, var(--surface)), var(--surface) 90px); }
.cm-card-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 16px; min-height: 34px; }
.cm-card-head h2 { font-size: 15.5px; display: flex; align-items: center; gap: 9px; margin: 0; }
.cm-card-head h2 .icon { color: var(--accent); width: 18px; height: 18px; }
.cm .panel > .cm-stack, .cm .panel > .cm-grid2, .cm .panel > .cm-grid3 { margin-top: 0; }

/* Fields */
.cm-field { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.cm-label { font-size: 13px; font-weight: 600; color: var(--text-2); display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.cm-label small { font-weight: 500; color: var(--muted); font-size: 12px; }
.cm-hint { font-size: 12.5px; color: var(--muted); min-height: 0; overflow-wrap: anywhere; }
.cm-hint:empty { display: none; }
.cm-adorn { display: flex; align-items: center; gap: 8px; height: 50px; padding: 0 14px; min-width: 0; border: 1px solid var(--border); background: var(--surface); border-radius: 15px; transition: border-color .2s, box-shadow .2s, transform .2s var(--spring); }
.cm-adorn:hover { border-color: var(--border-strong); }
.cm-adorn:focus-within { border-color: var(--accent); box-shadow: 0 0 0 4px var(--ring); }
.cm-adorn.bad { border-color: var(--danger); box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 18%, transparent); }
.cm-adorn.sm { height: 42px; padding: 0 12px; border-radius: 12px; }
.cm-adorn .pre, .cm-adorn .suf { color: var(--muted); font-weight: 600; font-size: 15px; flex: none; }
.cm-adorn .pre:empty, .cm-adorn .suf:empty { display: none; }
.cm-in { flex: 1; min-width: 0; width: 100%; height: 100%; border: 0; outline: 0; background: transparent; font: inherit; font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -.01em; color: var(--text); -moz-appearance: textfield; appearance: textfield; }
.cm-adorn.sm .cm-in { font-size: 16px; }
.cm-date { flex: 1; min-width: 0; width: 100%; height: 100%; border: 0; outline: 0; background: transparent; font: inherit; font-size: 16px; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
.cm-in.ctr { text-align: center; }
.cm-in::-webkit-inner-spin-button, .cm-in::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.cm .select.cm-sel { height: 50px; border-radius: 15px; font-weight: 600; padding-left: 14px; }
.cm .select.cm-sel-sm { height: 38px; border-radius: 11px; font-size: 13px; font-weight: 600; width: auto; max-width: 100%; padding-left: 12px; }
.cm-slide { gap: 6px; }
.cm-slide-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.cm-slide-head .cm-adorn { width: min(200px, 54%); flex: none; }
.cm-range { -webkit-appearance: none; appearance: none; width: 100%; height: 8px; margin: 12px 0 8px; border-radius: 99px; outline: none; cursor: pointer;
  background: linear-gradient(90deg, var(--accent), var(--accent-2)) left / var(--p, 0%) 100% no-repeat, var(--surface-3); }
.cm-range::-webkit-slider-thumb { -webkit-appearance: none; width: 26px; height: 26px; border-radius: 50%; background: #fff; border: 7px solid var(--accent); box-shadow: 0 6px 14px -4px color-mix(in srgb, var(--accent) 70%, transparent); transition: transform .25s var(--spring), box-shadow .2s; }
.cm-range::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: #fff; border: 7px solid var(--accent); box-shadow: 0 6px 14px -4px color-mix(in srgb, var(--accent) 70%, transparent); }
.cm-range::-moz-range-track { height: 8px; border-radius: 99px; background: var(--surface-3); }
.cm-range::-moz-range-progress { height: 8px; border-radius: 99px; background: linear-gradient(90deg, var(--accent), var(--accent-2)); }
.cm-range:hover::-webkit-slider-thumb { transform: scale(1.08); }
.cm-range:active::-webkit-slider-thumb { transform: scale(1.2); box-shadow: 0 0 0 8px var(--ring); }
.cm-range:focus-visible { box-shadow: 0 0 0 4px var(--ring); }
.cm-ticks { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.cm-ticks .cm-hint { flex: 1; text-align: center; font-size: 12px; }
.cm-stepper { display: grid; grid-template-columns: 50px minmax(0, 1fr) 50px; gap: 8px; align-items: center; }
.cm-step { height: 50px; border-radius: 15px; border: 1px solid var(--border); background: var(--surface); color: var(--text-2); cursor: pointer; display: grid; place-items: center; transition: transform .2s var(--spring), background .2s, border-color .2s; }
.cm-step:hover { background: var(--surface-2); border-color: var(--border-strong); }
.cm-step:active { transform: scale(.92); }

/* Pills and switcher */
.cm-pills { display: flex; flex-wrap: wrap; gap: 8px; }
.cm-pills button { display: inline-flex; align-items: center; gap: 6px; height: 38px; padding: 0 15px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--text-2); font-weight: 600; font-size: 13.5px; cursor: pointer; transition: transform .25s var(--spring), background .2s, color .2s, border-color .2s, box-shadow .25s; }
.cm-pills button .icon { width: 15px; height: 15px; }
.cm-pills button:hover { border-color: var(--border-strong); transform: translateY(-1px); }
.cm-pills button:active { transform: scale(.94); }
.cm-pills button[aria-pressed="true"] { color: var(--accent-text); border-color: transparent; background: linear-gradient(135deg, var(--accent), var(--accent-2)); box-shadow: 0 10px 20px -10px var(--accent); }
.cm-switch { position: relative; display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); padding: 4px; border-radius: 17px; background: var(--surface-2); border: 1px solid var(--border); isolation: isolate; }
.cm-switch::before { content: ""; position: absolute; z-index: -1; top: 4px; bottom: 4px; left: 4px; width: calc((100% - 8px) / var(--n)); border-radius: 13px; background: var(--surface); box-shadow: var(--shadow); transform: translateX(calc(var(--i) * 100%)); transition: transform .5s var(--spring); }
:root[data-theme="dark"] .cm-switch::before { background: var(--surface-3); }
.cm-switch button { display: flex; align-items: center; justify-content: center; gap: 7px; min-height: 42px; padding: 6px 8px; border: 0; border-radius: 13px; background: transparent; color: var(--muted); font-weight: 600; font-size: 13.5px; line-height: 1.15; text-align: center; cursor: pointer; transition: color .2s; }
.cm-switch button .icon { width: 16px; height: 16px; }
.cm-switch button:hover { color: var(--text); }
.cm-switch button[aria-pressed="true"] { color: var(--text); }
.cm-note { display: flex; gap: 9px; align-items: flex-start; font-size: 12.5px; color: var(--muted); line-height: 1.5; }
.cm-note .icon { width: 15px; height: 15px; margin-top: 2px; }
.cm-note a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }

.cm-list { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
.cm-list-rows { display: flex; flex-direction: column; gap: 10px; width: 100%; }
.cm-list-row { display: flex; align-items: center; gap: 8px; }
.cm-list-row.fresh { animation: cm-pop .45s var(--spring) both; }
.cm-list-body { flex: 1; min-width: 0; }

.cm-details { border: 1px solid var(--border); border-radius: 20px; background: var(--surface); padding: 0 16px; }
.cm-details summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px; min-height: 48px; font-weight: 600; font-size: 14px; }
.cm-details summary::-webkit-details-marker { display: none; }
.cm-details summary .icon { color: var(--accent); }
.cm-details summary::after { content: ""; margin-left: auto; width: 8px; height: 8px; border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted); transform: rotate(45deg); transition: transform .3s var(--spring); }
.cm-details[open] summary::after { transform: rotate(-135deg); }
.cm-details[open] summary { border-bottom: 1px solid var(--border); }
.cm-details-body { padding: 14px 0 16px; display: flex; flex-direction: column; gap: 10px; }
.cm-info-row { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 10px; font-size: 13.5px; color: var(--text-2); }
.cm-info-row b { color: var(--accent); font-variant-numeric: tabular-nums; }

/* Result hero */
.cm-hero { --h1: #4f46e5; --h2: #9333ea; --h3: #ec4899; --h4: #f97316; --mx: 80%; --my: 0%;
  position: relative; isolation: isolate; overflow: hidden; color: #fff; border-radius: 28px; padding: 22px 22px 20px; min-width: 0;
  background: color-mix(in srgb, var(--h1) 55%, #0a0a14); box-shadow: 0 32px 60px -34px color-mix(in srgb, var(--h2) 80%, transparent), inset 0 1px 0 rgba(255, 255, 255, .22); animation: cm-rise .45s var(--ease) both; }
.cm-hero[data-tone="ocean"] { --h1: #0284c7; --h2: #4f46e5; --h3: #06b6d4; --h4: #14b8a6; }
.cm-hero[data-tone="mint"] { --h1: #047857; --h2: #0d9488; --h3: #65a30d; --h4: #0891b2; }
.cm-hero[data-tone="sunset"] { --h1: #ea580c; --h2: #db2777; --h3: #e11d48; --h4: #f59e0b; }
.cm-hero[data-tone="gold"] { --h1: #b45309; --h2: #ea580c; --h3: #be123c; --h4: #ca8a04; }
.cm-hero[data-tone="rose"] { --h1: #be185d; --h2: #7c3aed; --h3: #e11d48; --h4: #f97316; }
.cm-hero-bg { position: absolute; inset: -35%; z-index: -3; filter: blur(34px) saturate(1.25); animation: cm-aurora 18s ease-in-out infinite alternate;
  background: radial-gradient(38% 38% at 22% 30%, var(--h1), transparent 70%), radial-gradient(34% 44% at 80% 18%, var(--h2), transparent 70%), radial-gradient(40% 40% at 72% 86%, var(--h3), transparent 70%), radial-gradient(30% 30% at 14% 92%, var(--h4), transparent 72%); }
.cm-hero::after { content: ""; position: absolute; inset: 0; z-index: -2; background: linear-gradient(180deg, rgba(6, 4, 20, .08), rgba(6, 4, 20, .42)); pointer-events: none; }
.cm-hero-grain { position: absolute; inset: 0; z-index: -1; opacity: .22; mix-blend-mode: overlay; pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
.cm-hero-sheen { position: absolute; inset: 0; z-index: -1; pointer-events: none; opacity: 0; transition: opacity .3s; background: radial-gradient(300px circle at var(--mx) var(--my), rgba(255, 255, 255, .2), transparent 60%); }
.cm-hero:hover .cm-hero-sheen { opacity: 1; }
.cm-hero-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.cm-hero-label { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; color: rgba(255, 255, 255, .82); }
.cm-hero-label .icon { width: 16px; height: 16px; }
.cm-hero-copy { width: 34px; height: 34px; flex: none; display: grid; place-items: center; border-radius: 11px; border: 1px solid rgba(255, 255, 255, .26); background: rgba(255, 255, 255, .14); color: #fff; cursor: pointer; backdrop-filter: blur(8px); transition: transform .25s var(--spring), background .2s; }
.cm-hero-copy:hover { background: rgba(255, 255, 255, .26); transform: translateY(-1px); }
.cm-hero-copy:active { transform: scale(.9); }
.cm-hero-copy.ok { background: rgba(74, 222, 128, .3); }
.cm-hero-copy .icon { width: 16px; height: 16px; }
.cm-hero-value { margin: 14px 0 4px; font-size: clamp(34px, 8.5vw, 58px); line-height: 1.05; font-weight: 650; letter-spacing: -.045em; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: clip; text-shadow: 0 2px 24px rgba(0, 0, 0, .25); }
.cm-hero.is-empty .cm-hero-value { opacity: .55; }
.cm-hero-sub { font-size: 14px; color: rgba(255, 255, 255, .86); line-height: 1.45; min-height: 20px; overflow-wrap: anywhere; }
.cm-hero-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
/* tables that should show every row instead of scrolling */
.cm-flat .table-wrap { max-height: none; }
.cm-glass { display: inline-flex; flex-direction: column; gap: 1px; padding: 8px 13px; border-radius: 15px; background: rgba(255, 255, 255, .13); border: 1px solid rgba(255, 255, 255, .22); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); min-width: 0; flex: 1 1 120px; animation: cm-pop .35s var(--spring) both; }
.cm-glass i { font-style: normal; font-size: 11.5px; letter-spacing: .02em; color: rgba(255, 255, 255, .72); }
.cm-glass b { font-size: 16px; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: -.02em; overflow-wrap: anywhere; }
.cm-hero-bar { display: flex; gap: 3px; height: 10px; margin-top: 16px; border-radius: 99px; overflow: hidden; }
.cm-hero-bar i { display: block; height: 100%; min-width: 3px; border-radius: 99px; transition: width .7s var(--ease), background .3s; }
.cm-hero-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 10px; font-size: 12.5px; color: rgba(255, 255, 255, .8); }
.cm-hero-legend:empty { display: none; }
.cm-hero-legend span { display: inline-flex; align-items: center; gap: 6px; }
.cm-hero-legend i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.cm-hero-legend b { color: #fff; font-weight: 650; }
@keyframes cm-aurora { 0% { transform: translate(-4%, 2%) rotate(0deg) scale(1); } 100% { transform: translate(5%, -4%) rotate(14deg) scale(1.12); } }
@keyframes cm-rise { from { opacity: 0; transform: translateY(14px) scale(.985); } }
@keyframes cm-pop { from { opacity: 0; transform: translateY(8px) scale(.94); } }

/* Phone dock */
.cm-dock { display: none; position: fixed; z-index: 45; left: 12px; right: 12px; bottom: calc(12px + var(--safe-b)); max-width: 460px; margin: 0 auto; align-items: center; gap: 10px; height: 54px; padding: 0 16px; border-radius: 18px; cursor: pointer; text-align: left;
  color: #fff; border: 1px solid rgba(255, 255, 255, .22); background: linear-gradient(120deg, rgba(40, 30, 110, .94), rgba(120, 40, 140, .94)); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); box-shadow: 0 18px 40px -14px rgba(20, 10, 60, .7);
  transform: translateY(160%); opacity: 0; transition: transform .5s var(--spring), opacity .3s; }
.cm-dock .l { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: rgba(255, 255, 255, .75); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.cm-dock b { margin-left: auto; font-size: 20px; font-weight: 650; letter-spacing: -.03em; font-variant-numeric: tabular-nums; white-space: nowrap; }
.cm-dock .icon { width: 18px; height: 18px; flex: none; }
.cm-dock.show { transform: none; opacity: 1; }
@media (max-width: 900px) { .cm-dock { display: flex; } }

/* Tiles */
.cm-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 170px), 1fr)); gap: 10px; }
.cm-tile { --t: #5b4cf0; position: relative; display: flex; gap: 11px; align-items: flex-start; padding: 14px; border-radius: 20px; min-width: 0; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow-sm); overflow: hidden; animation: cm-pop .36s var(--spring) both; animation-delay: calc(min(var(--i, 0), 3) * 30ms); transition: transform .3s var(--spring), box-shadow .3s, border-color .3s; }
.cm-tile::before { content: ""; position: absolute; inset: 0; background: radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, var(--t) 11%, transparent), transparent 60%); pointer-events: none; }
.cm-tile:hover { transform: translateY(-3px); box-shadow: var(--shadow); border-color: color-mix(in srgb, var(--t) 35%, var(--border)); }
.cm-tile.wide { grid-column: 1 / -1; }
.cm-tile.bad { border-color: color-mix(in srgb, var(--danger) 40%, var(--border)); }
.cm-tile[data-t="indigo"] { --t: #5b4cf0; } .cm-tile[data-t="pink"] { --t: #db2777; } .cm-tile[data-t="orange"] { --t: #ea580c; } .cm-tile[data-t="teal"] { --t: #0d9488; }
.cm-tile[data-t="amber"] { --t: #ca8a04; } .cm-tile[data-t="sky"] { --t: #0284c7; } .cm-tile[data-t="violet"] { --t: #9333ea; } .cm-tile[data-t="green"] { --t: #16a34a; } .cm-tile[data-t="red"] { --t: #dc2626; }
:root[data-theme="dark"] .cm-tile[data-t="indigo"] { --t: #8b7dff; } :root[data-theme="dark"] .cm-tile[data-t="pink"] { --t: #f472b6; } :root[data-theme="dark"] .cm-tile[data-t="orange"] { --t: #fb923c; } :root[data-theme="dark"] .cm-tile[data-t="teal"] { --t: #2dd4bf; }
:root[data-theme="dark"] .cm-tile[data-t="amber"] { --t: #facc15; } :root[data-theme="dark"] .cm-tile[data-t="sky"] { --t: #38bdf8; } :root[data-theme="dark"] .cm-tile[data-t="violet"] { --t: #c084fc; } :root[data-theme="dark"] .cm-tile[data-t="green"] { --t: #4ade80; } :root[data-theme="dark"] .cm-tile[data-t="red"] { --t: #ff7a6b; }
.cm-tile .ic { position: relative; width: 36px; height: 36px; flex: none; border-radius: 12px; display: grid; place-items: center; color: var(--t); background: color-mix(in srgb, var(--t) 14%, transparent); border: 1px solid color-mix(in srgb, var(--t) 24%, transparent); }
.cm-tile .ic .icon { width: 18px; height: 18px; }
.cm-tile .tx { position: relative; min-width: 0; flex: 1; }
.cm-tile .l { font-size: 12.5px; color: var(--muted); }
.cm-tile .v { font-size: 20px; font-weight: 650; letter-spacing: -.03em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; line-height: 1.2; margin-top: 1px; }
.cm-tile.bad .v { color: var(--danger); }
.cm-tile .hint { font-size: 12px; color: var(--muted); margin-top: 2px; overflow-wrap: anywhere; }

/* Bars */
.cm-bars { display: flex; flex-direction: column; gap: 13px; }
.cm-bar-top { display: flex; align-items: center; gap: 8px; font-size: 13.5px; margin-bottom: 6px; }
.cm-bar-top span { flex: 1; min-width: 0; color: var(--text-2); overflow-wrap: anywhere; }
.cm-bar-top b { font-variant-numeric: tabular-nums; font-weight: 650; white-space: nowrap; }
.cm-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.cm-bar-track { height: 9px; border-radius: 99px; background: var(--surface-2); overflow: hidden; border: 1px solid var(--border); }
.cm-bar-track i { display: block; height: 100%; border-radius: 99px; width: 0; transition: width .7s var(--ease), background .3s; }

/* Charts */
.cm-chart { position: relative; width: 100%; min-width: 0; }
.cm-chart canvas { max-width: 100%; }
.cm-chart-fail { height: 100%; display: grid; place-items: center; align-content: center; gap: 8px; text-align: center; color: var(--muted); font-size: 13px; padding: 12px; border: 1px dashed var(--border); border-radius: 16px; }

/* Slip */
.cm-slip { position: relative; padding: 18px 20px 16px; border-radius: 22px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow); }
.cm-slip::before, .cm-slip::after { content: ""; position: absolute; left: 14px; right: 14px; height: 7px; background: radial-gradient(circle at 5px 0, transparent 4px, var(--border) 4.5px, var(--border) 5.5px, transparent 6px) 0 0 / 14px 7px repeat-x; opacity: .7; }
.cm-slip::before { top: -1px; transform: scaleY(-1); } .cm-slip::after { bottom: -1px; }
.cm-slip-title { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin-bottom: 12px; }
.cm-slip-title .icon { width: 15px; height: 15px; }
.cm-slip-rows { display: flex; flex-direction: column; gap: 9px; }
.cm-slip-row { display: flex; align-items: baseline; gap: 8px; font-size: 14.5px; }
.cm-slip-row .k { color: var(--text-2); display: flex; flex-direction: column; min-width: 0; overflow-wrap: anywhere; }
.cm-slip-row .k small { color: var(--muted); font-size: 12px; }
.cm-slip-row .lead { flex: 1; min-width: 12px; border-bottom: 1.5px dotted var(--border-strong); transform: translateY(-4px); }
.cm-slip-row .v { font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
.cm-slip-row.strong .k, .cm-slip-row.strong .v { color: var(--text); font-weight: 650; }
.cm-slip-row.neg .v { color: var(--success); }
.cm-slip-total { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-top: 14px; padding-top: 14px; border-top: 2px dashed var(--border-strong); }
.cm-slip-total span { font-weight: 600; color: var(--text-2); }
.cm-slip-total b { font-size: 24px; letter-spacing: -.035em; font-variant-numeric: tabular-nums; color: var(--accent); }
.cm-slip-foot { margin-top: 10px; font-size: 12.5px; color: var(--muted); }

@media (max-width: 900px) {
  .cm-layout { grid-template-columns: minmax(0, 1fr); }
  .cm-col.cm-pin { position: static; }
}
@media (max-width: 720px) {
  .cm .panel { padding: 16px; border-radius: 20px; }
  .cm-grid2, .cm-grid3 { grid-template-columns: minmax(0, 1fr); }
  .cm-grid3.keep { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .cm-grid3.keep .cm-adorn { padding: 0 10px; }
  .cm-grid3.keep .suf { display: none; }
  .cm-hero { padding: 18px 16px 16px; border-radius: 24px; }
  .cm-tile { padding: 12px; flex-direction: column; gap: 8px; }
  .cm-tile .ic { width: 30px; height: 30px; border-radius: 10px; }
  .cm-tile .ic .icon { width: 16px; height: 16px; }
  .cm-tile .v { font-size: 18px; }
  .cm-slide-head .cm-adorn { width: min(170px, 50%); }
  .cm-in { font-size: 16px; }
  .cm-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (prefers-reduced-motion: reduce) {
  .cm-hero-bg { animation: none; }
}
`
