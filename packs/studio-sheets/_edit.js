// In-cell editor and formula bar editing: reference pointing, colored reference highlights, function autocomplete and hints.
import { h } from '../../lib/ui.js'
import { FUNCS } from './_funcs.js'
import { addr, colName, parseRange, rangeText } from './_a1.js'
import { sheetPrefix, cycleAbs } from './_parse.js'
import { fontPx } from './_axis.js'

export const REF_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#be185d']
const OPERATOR_BEFORE = /[=(,+\-*/^&<>;:{\s]$/
const POPULAR = ['SUM', 'IF', 'AVERAGE', 'COUNT', 'COUNTA', 'MAX', 'MIN', 'VLOOKUP', 'XLOOKUP', 'SUMIF', 'SUMIFS', 'COUNTIF', 'COUNTIFS', 'AVERAGEIF', 'INDEX', 'MATCH', 'ROUND', 'TEXT', 'CONCAT', 'TODAY', 'NOW', 'AND', 'OR', 'IFERROR', 'LEFT', 'RIGHT', 'MID', 'LEN', 'TRIM', 'UPPER', 'LOWER', 'DATE', 'PMT', 'ABS', 'IFS']
const rankOf = (n) => { const i = POPULAR.indexOf(n); return i < 0 ? 999 : i }

/** Reference-looking pieces of a formula: [{start, end, text, sheet, g}] */
export function refsInText(text) {
  const out = []
  if (text[0] !== '=') return out
  const re = /(?:(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!)?(\$?[A-Za-z]{1,3}\$?\d{1,7}(?::\$?[A-Za-z]{1,3}\$?\d{1,7})?|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?\d{1,7}:\$?\d{1,7})(?![\w(.])/g
  let m
  while ((m = re.exec(text))) {
    const before = text[m.index - 1]
    if (before && /[\w."']/.test(before) && !m[1] && !m[2]) continue
    // skip text inside string literals
    const quotes = (text.slice(0, m.index).match(/"/g) || []).length
    if (quotes % 2) continue
    const g = parseRange(m[3])
    if (g) out.push({ start: m.index, end: m.index + m[0].length, text: m[0], sheet: m[1] != null ? m[1].replace(/''/g, "'") : m[2] || null, g })
  }
  return out
}

export class Editor {
  constructor(grid, fbar) {
    this.grid = grid
    this.fbar = fbar
    this.active = false
    this.pt = null
    this.ta = h('textarea', { class: 'sx-ed', rows: 1, spellcheck: false, autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'Cell editor', hidden: true })
    this.ac = h('div', { class: 'sx-ac', role: 'listbox', hidden: true })
    this.hint = h('div', { class: 'sx-hint', hidden: true })
    grid.ov.append(this.ta, this.ac, this.hint)
    this.ta.addEventListener('input', () => this.changed(this.ta.value, 'cell'))
    this.ta.addEventListener('keydown', (e) => this.key(e))
    this.ta.addEventListener('blur', () => { if (this.active && !this.keepFocus) setTimeout(() => { if (this.active && document.activeElement !== this.ta && document.activeElement !== this.fbar && !this.grid.root.contains(document.activeElement)) this.commit() }, 0) })
    this.ta.addEventListener('keyup', () => this.updateHint())
    this.ta.addEventListener('click', () => { this.pt = null; this.updateHint() })
    fbar.addEventListener('focus', () => { if (!this.active && !fbar.readOnly) this.start(grid.act.r, grid.act.c, { from: 'bar' }) })
    fbar.addEventListener('input', () => { if (this.active) this.changed(fbar.value, 'bar') })
    fbar.addEventListener('keydown', (e) => { if (this.active) this.key(e, true) })
    this.acItems = []
    this.acIdx = 0
  }

  get text() { return this.ta.value }
  get isFormula() { return this.ta.value[0] === '=' }

  start(r, c, { text, mode = 'edit', from = 'cell', caret } = {}) {
    const g = this.grid
    if (g.model.sheet(g.sh.id) == null) return
    if (this.active) this.stop()
    this.active = true
    this.r = r; this.c = c; this.sid = g.sh.id
    this.mode = mode
    this.from = from
    this.pt = null
    const initial = text ?? g.cb.rawText(r, c)
    this.ta.value = initial
    this.fbar.value = initial
    this.ta.hidden = false
    this.position()
    if (from === 'cell') {
      this.ta.focus()
      const p = caret ?? initial.length
      this.ta.setSelectionRange(p, p)
    }
    g.cb.onEditStart?.()
    this.refresh()
  }
  position() {
    if (!this.active) return
    const g = this.grid
    const sh = g.model.sheet(this.sid)
    const rect = g.sh === sh ? g.cellRect(this.r, this.c, true) : null
    if (!rect) { this.ta.style.opacity = '0'; this.ta.style.pointerEvents = 'none'; return }
    const st = g.model.style(g.model.styleAt(sh, this.r, this.c))
    const lines = this.ta.value.split('\n')
    const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), '')
    const w = Math.max(rect.w, g.measure(longest, st) + 24)
    const maxW = g.sc.clientWidth - rect.x - 4
    const hgt = Math.max(rect.h, lines.length * 19 * g.zoom + 6)
    Object.assign(this.ta.style, {
      opacity: '1', pointerEvents: 'auto', left: rect.x - 1 + 'px', top: rect.y - 1 + 'px', width: Math.max(rect.w, Math.min(w, maxW)) + 2 + 'px', height: hgt + 2 + 'px',
      font: `${st.i ? 'italic ' : ''}${st.b ? '600 ' : ''}${fontPx(st) * g.zoom}px ${g.fontFamily}`, textAlign: st.ha || (typeof g.model.valueAt(sh.id, this.r, this.c) === 'number' ? 'right' : 'left'),
    })
    this.placePopups(rect)
  }
  placePopups(rect) {
    const top = rect.y + this.ta.offsetHeight + 2
    for (const el of [this.ac, this.hint]) { el.style.left = Math.max(0, rect.x) + 'px'; el.style.top = top + 'px' }
  }
  changed(text, source) {
    if (source === 'cell') this.fbar.value = text; else this.ta.value = text
    this.pt = null
    this.pp = null
    this.position()
    this.refresh()
  }
  setText(text, caret) {
    this.ta.value = text
    this.fbar.value = text
    if (caret != null) { this.ta.setSelectionRange(caret, caret); if (this.from === 'bar') this.fbar.setSelectionRange(caret, caret) }
    this.position()
    this.refresh()
  }
  caret() { return (this.from === 'bar' ? this.fbar : this.ta).selectionStart ?? this.ta.value.length }
  refresh() {
    this.grid.setRefBoxes(this.isFormula ? refsInText(this.text).map((x, i) => ({ g: x.g, sheet: x.sheet, color: REF_COLORS[i % REF_COLORS.length] })) : [])
    this.updateAutocomplete()
    this.updateHint()
  }

  // ----- pointing -----
  canPoint() {
    if (!this.active || !this.isFormula) return false
    if (this.pt) return true
    const t = this.text.slice(0, this.caret())
    return OPERATOR_BEFORE.test(t)
  }
  refText(g) {
    const sh = this.grid.model.sheet(this.sid)
    const pre = this.grid.sh !== sh ? sheetPrefix(this.grid.sh.name) : ''
    return pre + rangeText(g)
  }
  /** Insert or replace the pointed reference with a rect. */
  point(g) {
    const text = this.text
    const start = this.pt ? this.pt.start : this.caret()
    const end = this.pt ? this.pt.end : start
    const ref = this.refText(g)
    const next = text.slice(0, start) + ref + text.slice(end)
    this.pt = { start, end: start + ref.length }
    this.ta.value = next
    this.fbar.value = next
    this.ta.setSelectionRange(this.pt.end, this.pt.end)
    if (this.from === 'bar') this.fbar.setSelectionRange(this.pt.end, this.pt.end)
    this.position()
    this.grid.setRefBoxes(refsInText(next).map((x, i) => ({ g: x.g, sheet: x.sheet, color: REF_COLORS[i % REF_COLORS.length] })))
    this.hideAc()
  }
  /** Point at a cell or range between two cells (the anchor stays put while the head moves). */
  pointCells(anchor, head) {
    const g = { r1: Math.min(anchor.r, head.r), c1: Math.min(anchor.c, head.c), r2: Math.max(anchor.r, head.r), c2: Math.max(anchor.c, head.c) }
    this.point(g)
    this.pp = { anchor, head, g }
  }

  refocus() {
    if (!this.active) return
    const el = this.from === 'bar' ? this.fbar : this.ta
    const p = this.pt ? this.pt.end : this.caret()
    el.focus({ preventScroll: true })
    el.setSelectionRange(p, p)
  }

  // ----- autocomplete and hints -----
  updateAutocomplete() {
    this.acItems = []
    if (!this.active || !this.isFormula || this.pt) return this.hideAc()
    const t = this.text.slice(0, this.caret())
    const m = /([A-Za-z][A-Za-z0-9.]*)$/.exec(t)
    if (!m) return this.hideAc()
    const before = t.slice(0, m.index)
    if (before && !OPERATOR_BEFORE.test(before)) return this.hideAc()
    const q = m[1].toUpperCase()
    const items = Object.values(FUNCS).filter((f) => f.name.startsWith(q)).sort((a, b) => rankOf(a.name) - rankOf(b.name) || a.name.localeCompare(b.name)).slice(0, 8)
    if (!items.length || (items.length === 1 && items[0].name === q && this.text[this.caret()] === '(')) return this.hideAc()
    this.acItems = items
    this.acIdx = Math.min(this.acIdx, items.length - 1)
    this.acStart = m.index
    this.renderAc()
  }
  renderAc() {
    this.ac.replaceChildren(...this.acItems.map((f, i) => h('div', {
      class: ['sx-ac-i', i === this.acIdx && 'on'], role: 'option', 'aria-selected': String(i === this.acIdx),
      onmousedown: (e) => { e.preventDefault(); this.acIdx = i; this.acceptAc() },
    }, h('b', f.name), h('span', `(${f.sig})`), h('small', f.desc))))
    this.ac.hidden = false
  }
  hideAc() { this.acItems = []; this.ac.hidden = true }
  acceptAc() {
    const f = this.acItems[this.acIdx]
    if (!f) return false
    const caret = this.caret()
    const next = this.text.slice(0, this.acStart) + f.name + '(' + this.text.slice(caret)
    this.setText(next, this.acStart + f.name.length + 1)
    this.hideAc()
    return true
  }
  updateHint() {
    if (!this.active || !this.isFormula) { this.hint.hidden = true; return }
    const t = this.text.slice(0, this.caret())
    let depth = 0, idx = 0, q = false, start = -1
    for (let i = t.length - 1; i >= 0; i--) {
      const ch = t[i]
      if (ch === '"') q = !q
      if (q) continue
      if (ch === ')') depth++
      else if (ch === '(') { if (depth === 0) { start = i; break } depth-- }
      else if ((ch === ',' || ch === ';') && depth === 0) idx++
    }
    const nm = start >= 0 ? /([A-Za-z][A-Za-z0-9.]*)$/.exec(t.slice(0, start)) : null
    const f = nm && FUNCS[nm[1].toUpperCase()]
    if (!f || !this.ac.hidden) { this.hint.hidden = true; return }
    const parts = f.sig.split(',').map((s) => s.trim())
    const rep = parts.findIndex((p) => p === '...')
    const cur = rep >= 0 && idx >= rep ? Math.max(0, rep - 1) : idx
    this.hint.replaceChildren(h('b', f.name), '(', ...parts.flatMap((p, i) => [i ? ', ' : '', i === cur ? h('u', p) : p]), ')')
    this.hint.hidden = false
  }

  // ----- keys -----
  key(e, fromBar = false) {
    const nav = this.acItems.length && !this.ac.hidden
    if (nav && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); this.acIdx = (this.acIdx + (e.key === 'ArrowDown' ? 1 : -1) + this.acItems.length) % this.acItems.length; this.renderAc(); return }
    if (nav && (e.key === 'Tab' || (e.key === 'Enter' && !e.altKey))) { e.preventDefault(); this.acceptAc(); return }
    if (e.key === 'Escape') { e.preventDefault(); if (nav) this.hideAc(); else this.cancel(); return }
    if (e.key === 'Enter' && e.altKey) { e.preventDefault(); const ta = this.ta, p = ta.selectionStart; this.setText(ta.value.slice(0, p) + '\n' + ta.value.slice(ta.selectionEnd), p + 1); return }
    if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey)) { e.preventDefault(); this.commit(e.shiftKey ? 'up' : 'down'); return }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.commit('stay', true); return }
    if (e.key === 'Tab') { e.preventDefault(); this.commit(e.shiftKey ? 'left' : 'right'); return }
    if (e.key === 'F4') {
      e.preventDefault()
      const r = cycleAbs(this.text, this.caret())
      this.setText(r.text, r.caret)
      return
    }
    if (e.key.startsWith('Arrow') && !e.altKey && !fromBar) {
      const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]
      if (this.canPoint() && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        const base = this.pt && this.pp ? this.pp : { anchor: { r: this.r, c: this.c }, head: { r: this.r, c: this.c } }
        const head = { r: Math.max(0, base.head.r + d[0]), c: Math.max(0, base.head.c + d[1]) }
        this.pointCells(e.shiftKey && this.pt && this.pp ? base.anchor : head, head)
        this.grid.scrollIntoView(head.r, head.c)
        return
      }
      if (this.mode === 'enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); this.commit({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key]) }
    }
  }

  commit(dir = 'stay', fill = false) {
    if (!this.active) return true
    const text = this.text
    const { r, c, sid } = this
    const ok = this.grid.cb.onCommit(r, c, text, sid, fill)
    if (ok === false) { this.ta.focus(); return false }
    this.stop()
    this.grid.cb.afterCommit?.(dir)
    return true
  }
  cancel() {
    if (!this.active) return
    this.stop()
    this.grid.cb.onEditCancel?.()
  }
  stop() {
    this.active = false
    this.pt = null
    this.ta.hidden = true
    this.ta.blur?.()
    this.hideAc()
    this.hint.hidden = true
    this.grid.setRefBoxes([])
    this.fbar.value = this.grid.cb.rawText(this.grid.act.r, this.grid.act.c) ?? ''
    this.grid.cb.onEditEnd?.()
    this.grid.focus()
  }
}
export { colName, addr }
