// Shared UI helpers for the India pack: number fields with Indian-format hints, a stacked bar chart, notes and one scoped stylesheet.
// Files starting with `_` are never tool modules.
import { h, icon, number, field, stats, onCleanup, download } from '../../lib/ui.js'
import { inr, lakhCrore, inrShort } from './_calc.js'

const injected = new Set()
/** Inject a <style> once (keyed). Rules are scoped under `.in-` classes so nothing leaks into other tools. */
export function style(id, css) {
  if (injected.has(id) && document.getElementById(id)) return
  injected.add(id)
  document.head.append(h('style', { id }, css))
}

const CSS = `
.in-note { display: flex; gap: 8px; align-items: flex-start; font-size: 12.5px; color: var(--muted); line-height: 1.5; margin: 0; }
.in-note .icon { width: 15px; height: 15px; flex: none; margin-top: 2px; }
.in-note a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.in-hero { padding: 18px 18px 16px; border-radius: 20px; background: linear-gradient(140deg, color-mix(in srgb, var(--accent) 14%, var(--surface)), var(--surface) 70%); border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border)); min-width: 0; }
.in-hero .k { font-size: 13px; color: var(--muted); }
.in-hero .v { font-size: clamp(28px, 6vw, 40px); font-weight: 700; letter-spacing: -.035em; color: var(--accent); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; line-height: 1.1; margin-top: 4px; }
.in-hero .s { font-size: 13px; color: var(--text-2); margin-top: 6px; overflow-wrap: anywhere; }
.in-hero.bad { background: var(--danger-soft); border-color: color-mix(in srgb, var(--danger) 30%, var(--border)); }
.in-hero.bad .v { color: var(--danger); }
.in-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.in-stats .stat { padding: 13px 14px; }
.in-stats .stat .value { font-size: clamp(18px, 5vw, 22px); overflow-wrap: break-word; }
.in-details { border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
.in-details > summary { cursor: pointer; padding: 12px 14px; font-weight: 600; font-size: 14px; list-style: none; display: flex; justify-content: space-between; gap: 8px; border-radius: 14px; }
.in-details > summary::-webkit-details-marker { display: none; }
.in-details > summary::after { content: '+'; color: var(--muted); font-weight: 400; font-size: 18px; line-height: 1; }
.in-details[open] > summary::after { content: '-'; }
.in-details > .in-body { padding: 2px 14px 14px; display: grid; gap: 12px; }
.in-chart { position: relative; min-width: 0; }
.in-chart svg { display: block; width: 100%; height: auto; overflow: visible; }
.in-chart .grid { stroke: var(--border); stroke-width: 1; }
.in-chart text { fill: var(--muted); font-size: 11px; font-family: var(--font); }
.in-chart .bar rect { transition: opacity .15s; }
.in-chart .col { fill: transparent; cursor: crosshair; }
.in-chart .col.on { fill: color-mix(in srgb, var(--text) 6%, transparent); }
.in-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 12.5px; color: var(--text-2); margin: 4px 0 8px; }
.in-legend i { display: inline-block; width: 11px; height: 11px; border-radius: 4px; margin-right: 6px; vertical-align: -1px; }
.in-readout { font-size: 13px; color: var(--text-2); min-height: 20px; margin-bottom: 4px; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.in-readout b { color: var(--text); font-weight: 650; }
.in-kv { display: grid; gap: 0; border: 1px solid var(--border); border-radius: 14px; overflow: hidden; background: var(--surface); }
.in-kv > div { display: flex; justify-content: space-between; gap: 14px; padding: 10px 14px; font-size: 14px; border-top: 1px solid var(--border); }
.in-kv > div:first-child { border-top: 0; }
.in-kv > div span:first-child { color: var(--text-2); min-width: 0; overflow-wrap: anywhere; }
.in-kv > div span:last-child { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
.in-kv > div.strong { background: var(--surface-2); font-weight: 650; }
.in-kv > div.strong span:first-child { color: var(--text); }
.in-kv > div.neg span:last-child { color: var(--success); }
.in-kv small { display: block; color: var(--muted); font-size: 12px; font-weight: 400; }
.in-check { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.in-check li { display: flex; gap: 9px; align-items: flex-start; font-size: 13.5px; padding: 8px 10px; border-radius: 11px; background: var(--surface-2); overflow-wrap: anywhere; }
.in-check li .icon { width: 17px; height: 17px; flex: none; margin-top: 1px; }
.in-check li.ok .icon { color: var(--success); }
.in-check li.bad { background: var(--danger-soft); }
.in-check li.bad .icon { color: var(--danger); }
.in-check li.warn .icon { color: var(--warning); }
.in-check li span.v { margin-left: auto; font-variant-numeric: tabular-nums; text-align: right; color: var(--muted); padding-left: 8px; }
@media (prefers-reduced-motion: reduce) { .in-chart .bar rect { transition: none; } }
`
export const useStyles = () => style('in-style', CSS)

// ---------- Small building blocks ----------

export const note = (...kids) => h('p', { class: 'in-note' }, icon('info'), h('span', kids))
export const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text)

/** Two-column stat tiles with a slightly smaller value font so Indian-grouped rupee amounts stay on one line. */
export function statTiles(items) {
  const el = stats(items)
  el.classList.add('in-stats')
  return el
}

/** Collapsible section: details('Old regime deductions', [fields], open) */
export const details = (title, body, open = false) => h('details', { class: 'in-details', open }, h('summary', title), h('div', { class: 'in-body' }, body))

/** Big accent number with a label and a sub line. el.set(label, value, sub, bad) */
export function hero(label = '') {
  const k = h('div', { class: 'k' }, label), v = h('div', { class: 'v' }), s = h('div', { class: 's' })
  const el = h('div', { class: 'in-hero', 'aria-live': 'polite' }, k, v, s)
  el.set = (l, val, sub, bad) => { k.textContent = l; v.textContent = val; s.textContent = sub || ''; el.classList.toggle('bad', !!bad) }
  return el
}

/** Key/value rows: kv([{label, value, note, strong, neg}]) */
export function kv(rows) {
  return h('div', { class: 'in-kv' }, rows.map((r) => h('div', { class: [r.strong && 'strong', r.neg && 'neg'] },
    h('span', r.label, r.note ? h('small', r.note) : null), h('span', r.value))))
}

/** Pass/fail list. items: [{ok: true|false|'warn', label, value}] - never colour alone: each row has an icon and the words. */
export function checklist(items) {
  return h('ul', { class: 'in-check' }, items.map((it) => h('li', { class: it.ok === true ? 'ok' : it.ok === 'warn' ? 'warn' : 'bad' },
    icon(it.ok === true ? 'circle-check' : it.ok === 'warn' ? 'triangle-alert' : 'circle-x'),
    h('span', it.label), it.value ? h('span', { class: 'v' }, it.value) : null)))
}

/**
 * numField(label, value, {min, max, step, money, hint, onChange}) -> {el, input, get(), set(v), val(fallback), issue()}
 * money shows a live Indian-format line under the field (₹12,50,000 and 12.5 lakh).
 */
export function numField(label, value, opts = {}) {
  const { min = 0, max, step = 1, money = false, hint = '', onChange, placeholder } = opts
  const hintEl = h('small', { class: 'field-hint' })
  const inp = number(value, {
    min, max, step, placeholder, ariaLabel: label,
    onInput: () => { sync(); onChange?.(get()) },
  })
  if (opts.integer) inp.inputMode = 'numeric'
  const el = h('label', { class: 'field' }, h('span', { class: 'field-label' }, h('span', label)), inp, hintEl)
  const get = () => inp.valueAsNumber
  function sync() {
    const v = get()
    if (money && Number.isFinite(v)) hintEl.textContent = `${inr(v)}${lakhCrore(v) ? ` · ${lakhCrore(v)}` : ''}`
    else hintEl.textContent = hint
  }
  sync()
  return {
    el, input: inp, get,
    set: (v) => { inp.value = v; sync() },
    val: (fallback = 0) => (Number.isFinite(get()) ? get() : fallback),
    issue: () => {
      const v = get()
      if (!Number.isFinite(v)) return `Enter ${label.toLowerCase()}`
      if (v < min) return `${label} must be at least ${min}`
      if (max != null && v > max) return `${label} must be at most ${max}`
      return ''
    },
  }
}

export function selectField(label, options, value, onChange, hint) {
  const sel = h('select', { class: 'select', onchange: (e) => onChange?.(e.target.value) },
    options.map((o) => {
      const [v, l] = Array.isArray(o) ? o : [o, o]
      return h('option', { value: v, selected: String(v) === String(value) }, l)
    }))
  const el = field(label, sel, hint)
  el.select = sel
  return { el, select: sel, get: () => sel.value, set: (v) => { sel.value = v } }
}

// ---------- Chart ----------

function niceScale(max) {
  const raw = max / 4
  const pow = 10 ** Math.floor(Math.log10(raw || 1))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) || pow * 10
  return { step, top: Math.ceil(max / step) * step }
}

export const SERIES_COLORS = ['color-mix(in srgb, var(--accent) 36%, var(--surface-3))', 'var(--accent)', 'var(--accent-2)']

/**
 * stackedChart({series: [{label, fill}], format}) -> {el, update(rows)}; rows: [{label, parts: [n, n], text?}].
 * Redraws at its real pixel width (so text stays readable on phones). Hover or tap a bar for the numbers.
 */
export function stackedChart({ series, ariaLabel = 'Chart', format = inr }) {
  const readout = h('div', { class: 'in-readout', 'aria-live': 'off' })
  const legend = h('div', { class: 'in-legend' }, series.map((s) => h('span', h('i', { style: { background: s.fill } }), s.label)))
  const holder = h('div')
  const el = h('div', { class: 'in-chart', role: 'img', 'aria-label': ariaLabel }, legend, readout, holder)
  let rows = [], active = -1
  const show = (i) => {
    active = i
    const r = rows[i]
    if (!r) return readout.replaceChildren()
    readout.replaceChildren(h('b', r.label), ` ${series.map((s, k) => `${s.label} ${format(r.parts[k] || 0)}`).join(' · ')} · Total ${format(r.parts.reduce((a, b) => a + b, 0))}`)
    holder.querySelectorAll('.col').forEach((c, k) => c.classList.toggle('on', k === i))
  }
  function draw() {
    const W = Math.max(240, Math.floor(holder.clientWidth || 320)), H = 230, L = W < 420 ? 46 : 54, R = 6, T = 8, B = 24
    const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' })
    if (!rows.length) { holder.replaceChildren(svg); return }
    const totals = rows.map((r) => r.parts.reduce((a, b) => a + Math.max(0, b), 0))
    const { step, top } = niceScale(Math.max(...totals, 1))
    const y = (v) => T + (H - T - B) * (1 - v / top)
    for (let v = 0; v <= top + 1e-6; v += step) {
      svg.append(h('line', { class: 'grid', x1: L, x2: W - R, y1: y(v), y2: y(v) }), h('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, inrShort(v)))
    }
    const bw = (W - L - R) / rows.length
    const every = Math.max(1, Math.ceil(26 / bw))
    rows.forEach((r, i) => {
      const g = h('g', { class: 'bar' })
      let acc = 0
      r.parts.forEach((p, k) => {
        if (p <= 0) return
        const y0 = y(acc), y1 = y(acc + p)
        g.append(h('rect', { x: L + i * bw + bw * 0.14, y: y1, width: Math.max(1, bw * 0.72), height: Math.max(0, y0 - y1), rx: 2, style: { fill: series[k].fill } }))
        acc += p
      })
      svg.append(g)
      if (i % every === 0 || i === rows.length - 1) svg.append(h('text', { x: L + i * bw + bw / 2, y: H - 7, 'text-anchor': 'middle' }, r.short ?? r.label))
      svg.append(h('rect', { class: ['col', i === active && 'on'], x: L + i * bw, y: T, width: bw, height: H - T - B, onpointerenter: () => show(i), onpointerdown: () => show(i) }))
    })
    holder.replaceChildren(svg)
  }
  let raf = 0
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { clearTimeout(raf); raf = setTimeout(draw, 60) }) : null
  ro?.observe(holder)
  onCleanup(() => ro?.disconnect())
  return {
    el,
    update(next) {
      rows = next
      if (active >= rows.length || active < 0) active = rows.length - 1
      draw()
      show(active)
    },
  }
}

// ---------- Export ----------

export function csv(rows) {
  return rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\n')
}
export const downloadCsv = (rows, name) => download(`﻿${csv(rows)}`, name, 'text/csv;charset=utf-8')

/** Parse #/tool?x=1 query params. */
export const query = () => new URLSearchParams(location.hash.split('?')[1] || '')
