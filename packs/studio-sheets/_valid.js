// Data validation rules: which values a cell accepts, and the list choices for dropdown cells. No DOM.
import { rangeContains, parseRange } from './_a1.js'
import { strToNum, compare, XErr } from './_val.js'
import { parseInput } from './_fmt.js'

export const DV_TYPES = [['list', 'List (dropdown)'], ['whole', 'Whole number'], ['decimal', 'Decimal number'], ['textlen', 'Text length']]
export const DV_OPS = [['between', 'between'], ['notbetween', 'not between'], ['eq', 'equal to'], ['ne', 'not equal to'], ['gt', 'greater than'], ['ge', 'at least'], ['lt', 'less than'], ['le', 'at most']]

export const dvAt = (sh, r, c) => (sh.dv || []).find((d) => rangeContains(d.range, r, c))

/** Choices of a list rule as display values. */
export function dvItems(model, sh, rule) {
  if (rule.items) return rule.items
  const g = parseRange(rule.src || '')
  if (!g) return []
  const out = []
  for (let r = g.r1; r <= Math.min(g.r2, g.r1 + 2000); r++) for (let c = g.c1; c <= g.c2; c++) {
    const v = model.valueAt(sh.id, r, c)
    if (v !== null && v !== '' && !(v instanceof XErr)) out.push(String(v))
  }
  return out
}

/** null when the typed text is allowed, otherwise a message. */
export function dvCheck(model, sh, rule, text, dateOrder) {
  if (text === '' || text == null) return rule.blank === false ? 'This cell cannot be empty.' : null
  if (text[0] === '=') return null
  if (rule.type === 'list') {
    const items = dvItems(model, sh, rule)
    const t = text.trim().toLowerCase()
    return items.some((x) => String(x).trim().toLowerCase() === t) ? null : `Choose one of the listed values: ${items.slice(0, 6).join(', ')}${items.length > 6 ? ', ...' : ''}`
  }
  const p = parseInput(text, { dateOrder })
  let n
  if (rule.type === 'textlen') n = text.length
  else {
    n = p.kind === 'value' && typeof p.v === 'number' ? p.v : strToNum(text)
    if (n === null || n === undefined) return 'Enter a number.'
    if (rule.type === 'whole' && !Number.isInteger(n)) return 'Enter a whole number.'
  }
  const a = parseFloat(rule.v1), b = parseFloat(rule.v2)
  const ok = { between: n >= Math.min(a, b) && n <= Math.max(a, b), notbetween: n < Math.min(a, b) || n > Math.max(a, b), eq: n === a, ne: n !== a, gt: n > a, ge: n >= a, lt: n < a, le: n <= a }[rule.op || 'between']
  if (ok) return null
  const word = DV_OPS.find((o) => o[0] === (rule.op || 'between'))?.[1] || 'between'
  return `The value must be ${word} ${rule.v1}${(rule.op || 'between').includes('between') ? ' and ' + rule.v2 : ''}.`
}
export { compare }
