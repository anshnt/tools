// Floating calculator: expression calculator with history, memory and scientific functions that can float above other windows.
import { h, icon, button, toast, copyText } from '../../lib/ui.js'
import { persisted } from '../../lib/store.js'
import { baseCss, injectCss } from './_shared.js'
import { floatShell } from './_float.js'

// ---------- expression engine (no eval) ----------
const FUNCS = {
  sin: (x, d) => Math.sin(d ? (x * Math.PI) / 180 : x), cos: (x, d) => Math.cos(d ? (x * Math.PI) / 180 : x), tan: (x, d) => Math.tan(d ? (x * Math.PI) / 180 : x),
  asin: (x, d) => (Math.asin(x) * (d ? 180 : 1)) / (d ? Math.PI : 1), acos: (x, d) => (Math.acos(x) * (d ? 180 : 1)) / (d ? Math.PI : 1), atan: (x, d) => (Math.atan(x) * (d ? 180 : 1)) / (d ? Math.PI : 1),
  ln: Math.log, log: Math.log10, sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, exp: Math.exp,
}
const CONSTS = { pi: Math.PI, e: Math.E }

class CalcError extends Error {}

function tokenize(src) {
  const s = src.replace(/×|·/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/π/g, ' pi ').replace(/√/g, ' sqrt ').replace(/,/g, '.')
  const out = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (/\s/.test(c)) { i++; continue }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i))
      if (!m) throw new CalcError('Bad number')
      // an "e" that is not followed by digits is the constant e, not an exponent
      out.push({ t: 'num', v: parseFloat(m[0]) })
      i += m[0].length
    } else if (/[a-z]/i.test(c)) {
      const m = /^[a-z]+/i.exec(s.slice(i))[0].toLowerCase()
      if (m in FUNCS) out.push({ t: 'fn', v: m })
      else if (m in CONSTS) out.push({ t: 'num', v: CONSTS[m] })
      else throw new CalcError(`Unknown "${m}"`)
      i += m.length
    } else if ('+-*/^%!()'.includes(c)) { out.push({ t: c }); i++ } else throw new CalcError(`Unexpected "${c}"`)
  }
  return out
}

const factorial = (n) => {
  if (n < 0 || !Number.isInteger(n)) throw new CalcError('Factorial needs a whole number')
  if (n > 170) return Infinity
  let r = 1
  for (let k = 2; k <= n; k++) r *= k
  return r
}

/** Evaluate an expression such as "12.5% * (3 + 4)^2 / sqrt(16)". Returns a number or throws a CalcError with a friendly message. */
export function evaluate(src, { deg = true } = {}) {
  const tk = tokenize(src)
  let p = 0
  const peek = () => tk[p]
  const eat = (t) => (tk[p]?.t === t ? tk[p++] : null)
  // every parse function returns {v, pct}; pct marks a bare "x%" so that "200 + 10%" means 200 + 10% of 200
  function expr() {
    let l = term()
    for (;;) {
      if (eat('+')) { const r = term(); l = { v: l.v + (r.pct ? l.v * r.v : r.v) } } else if (eat('-')) { const r = term(); l = { v: l.v - (r.pct ? l.v * r.v : r.v) } } else return l
    }
  }
  function term() {
    let l = unary()
    for (;;) {
      if (eat('*')) l = { v: l.v * unary().v }
      else if (eat('/')) { const r = unary().v; if (r === 0) throw new CalcError('Cannot divide by zero'); l = { v: l.v / r } }
      else if (peek() && (peek().t === 'num' || peek().t === 'fn' || peek().t === '(')) l = { v: l.v * unary().v } // implicit multiplication: 2pi, 3(4+1)
      else return l
    }
  }
  function unary() {
    if (eat('-')) return { v: -unary().v }
    if (eat('+')) return unary()
    return power()
  }
  function power() {
    const b = postfix()
    if (eat('^')) return { v: b.v ** unary().v } // right associative; -2^2 is -(2^2) = -4 and 2^-1 works
    return b
  }
  function postfix() {
    let x = primary()
    for (;;) {
      if (eat('!')) x = { v: factorial(x.v) }
      else if (eat('%')) x = { v: x.v / 100, pct: true }
      else return x
    }
  }
  function primary() {
    const t = tk[p]
    if (!t) throw new CalcError('Finish the expression')
    if (t.t === 'num') { p++; return { v: t.v } }
    if (t.t === 'fn') {
      p++
      const arg = eat('(') ? (() => { const a = expr(); if (!eat(')')) throw new CalcError('Missing )'); return a })() : unary()
      const v = FUNCS[t.v](arg.v, deg)
      if (Number.isNaN(v)) throw new CalcError('Not defined for that number')
      return { v }
    }
    if (t.t === '(') { p++; const a = expr(); if (!eat(')')) throw new CalcError('Missing )'); return a }
    throw new CalcError(`Unexpected "${t.t}"`)
  }
  if (!tk.length) throw new CalcError('Empty')
  const r = expr()
  if (p < tk.length) throw new CalcError(`Unexpected "${tk[p].t === 'num' ? tk[p].v : tk[p].t}"`)
  if (!Number.isFinite(r.v)) throw new CalcError(Number.isNaN(r.v) ? 'Not a number' : 'Too large')
  return r.v
}

/** Format a result: 12 significant digits, no 0.1 + 0.2 noise, exponent form for huge or tiny numbers. */
export function formatResult(v) {
  if (v === 0) return '0'
  const a = Math.abs(v)
  if (a >= 1e15 || a < 1e-9) return v.toExponential(9).replace(/\.?0+e/, 'e').replace('e+', 'e')
  return String(parseFloat(v.toPrecision(12)))
}

const CSS = `
.t-fc{display:flex;flex-direction:column;gap:10px;outline:none;max-width:380px;margin:0 auto}
.t-fc .fc-card{padding:14px;border-radius:26px;border:1px solid var(--border);background:var(--surface);box-shadow:var(--shadow-lg);display:flex;flex-direction:column;gap:12px}
.t-fc .fc-screen{border-radius:18px;padding:12px 16px 10px;background:linear-gradient(160deg,color-mix(in srgb,var(--accent) 9%,var(--surface-2)),var(--surface-2));border:1px solid var(--border);min-height:98px;display:flex;flex-direction:column;justify-content:flex-end;align-items:flex-end;gap:2px;text-align:right;overflow:hidden}
.t-fc .fc-expr{font-family:var(--mono);font-size:15px;color:var(--muted);min-height:22px;max-width:100%;overflow-x:auto;white-space:nowrap;scrollbar-width:none}
.t-fc .fc-expr::-webkit-scrollbar{display:none}
.t-fc .fc-res{font-family:var(--mono);font-size:clamp(28px,8vw,40px);font-weight:600;letter-spacing:-.03em;max-width:100%;overflow-x:auto;white-space:nowrap;scrollbar-width:none;min-height:1.2em}
.t-fc .fc-res.err{font-size:15px;color:var(--danger);font-family:var(--font);font-weight:550;letter-spacing:0}
.t-fc .fc-res.pop{animation:sc-pop .3s var(--spring)}
.t-fc .fc-tools{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.t-fc .fc-tools .sp{flex:1}
.t-fc .fc-mem{font-family:var(--mono);font-size:11.5px;color:var(--accent);min-width:2ch}
.t-fc .pad{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.t-fc .sci{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}
.t-fc .sci[hidden]{display:none}
.t-fc .k{height:50px;border-radius:15px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:600 18px var(--font);cursor:pointer;transition:transform .15s var(--spring),background .15s,box-shadow .15s;box-shadow:var(--shadow-sm);padding:0;display:grid;place-items:center}
.t-fc .k:hover{background:var(--surface-2)}
.t-fc .k:active{transform:scale(.93)}
.t-fc .k.op{background:var(--accent-soft);color:var(--accent);border-color:transparent}
.t-fc .k.fn{height:38px;font-size:13px;font-weight:550;color:var(--text-2);background:var(--surface-2);box-shadow:none}
.t-fc .k.mem{height:32px;font-size:12px;border-radius:10px;font-weight:600;color:var(--muted);background:transparent;box-shadow:none;border-color:transparent}
.t-fc .k.mem:hover{color:var(--text)}
.t-fc .k.eq{background:linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 55%,var(--accent-2)));color:var(--accent-text);border:0;box-shadow:0 10px 22px -10px var(--accent)}
.t-fc .k.clr{color:var(--danger)}
.t-fc .k .icon{width:19px;height:19px}
.t-fc .hist{display:flex;flex-direction:column;gap:2px;max-height:190px;overflow:auto;margin:0;padding:0;list-style:none}
.t-fc .hist button{display:flex;justify-content:space-between;gap:14px;width:100%;border:0;background:transparent;padding:7px 10px;border-radius:10px;cursor:pointer;color:var(--text);font:13px var(--mono);text-align:left}
.t-fc .hist button:hover{background:var(--surface-2)}
.t-fc .hist button span:first-child{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.t-fc .hist button b{font-weight:600;white-space:nowrap}
.t-fc .fc-empty{font-size:13px;color:var(--muted);text-align:center;padding:8px}
body.sc-pip .t-fc{max-width:none;margin:0}
body.sc-pip .t-fc .fc-card{border:0;box-shadow:none;padding:0;background:transparent}
`

const PAD = [
  [['C', 'AC', 'clr'], ['(', '(', 'op'], [')', ')', 'op'], ['÷', '÷', 'op']],
  [['7'], ['8'], ['9'], ['×', '×', 'op']],
  [['4'], ['5'], ['6'], ['−', '−', 'op']],
  [['1'], ['2'], ['3'], ['+', '+', 'op']],
  [['0'], ['.'], ['⌫', 'BS', 'op'], ['=', '=', 'eq']],
]
const SCI = [['sin', 'sin('], ['cos', 'cos('], ['tan', 'tan('], ['ln', 'ln('], ['log', 'log('], ['√', '√('], ['x²', '^2'], ['xʸ', '^'], ['π', 'π'], ['e', 'e'], ['%', '%'], ['x!', '!'], ['1/x', 'INV'], ['|x|', 'abs('], ['Ans', 'ANS']]

export function mount(root) {
  baseCss()
  injectCss('fc', CSS)
  const store = persisted('floating-calculator', { history: [], mem: 0, deg: true, sci: false })
  const st = () => store.get()
  let expr = '', ans = null, justEvaluated = false

  const exprEl = h('div', { class: 'fc-expr', 'aria-label': 'Expression' })
  const resEl = h('div', { class: 'fc-res', role: 'status', 'aria-live': 'polite' })
  const memEl = h('span', { class: 'fc-mem', title: 'Memory' })
  const histEl = h('ul', { class: 'hist' })
  const histWrap = h('div', { class: 'stack tight', hidden: true })
  const sciEl = h('div', { class: 'sci', hidden: !st().sci })
  const degBtn = button('', { size: 'sm', variant: 'ghost', title: 'Degrees or radians for sin, cos, tan', onClick: () => { store.update((s) => ({ ...s, deg: !s.deg })); render() } })

  const live = () => {
    if (!expr) return null
    try { return evaluate(expr, { deg: st().deg }) } catch (e) { return e instanceof CalcError ? e : null }
  }
  function render(popped) {
    exprEl.textContent = expr || ' '
    exprEl.scrollLeft = exprEl.scrollWidth
    const r = live()
    resEl.classList.remove('err')
    if (typeof r === 'number') resEl.textContent = formatResult(r)
    else resEl.textContent = expr ? '' : '0'
    if (popped) { resEl.classList.remove('pop'); void resEl.offsetWidth; resEl.classList.add('pop') }
    memEl.textContent = st().mem ? `M ${formatResult(st().mem)}` : ''
    degBtn.replaceChildren(h('span', st().deg ? 'DEG' : 'RAD'))
    sciEl.hidden = !st().sci
    renderHistory()
  }
  function renderHistory() {
    const hs = st().history
    histEl.replaceChildren(...(hs.length ? hs.map((x) => h('li', h('button', { type: 'button', title: 'Use this result', onclick: () => { expr = x.r; justEvaluated = true; render() } }, h('span', x.e), h('b', `= ${x.r}`))))
      : [h('li', { class: 'fc-empty' }, 'Your calculations show up here.')]))
  }

  function equals() {
    if (!expr) return
    try {
      const v = evaluate(expr, { deg: st().deg })
      const r = formatResult(v)
      store.update((s) => ({ ...s, history: [{ e: expr, r }, ...s.history.filter((x) => !(x.e === expr && x.r === r))].slice(0, 40) }))
      ans = v
      expr = r
      justEvaluated = true
      render(true)
    } catch (e) {
      resEl.textContent = e instanceof CalcError ? e.message : 'Check the expression'
      resEl.classList.add('err')
    }
  }
  function press(tok) {
    if (tok === '=') return equals()
    if (tok === 'AC') { expr = ''; justEvaluated = false; return render() }
    if (tok === 'BS') { expr = expr.replace(/(sin|cos|tan|asin|acos|atan|ln|log|abs|√)\($|.$/u, ''); justEvaluated = false; return render() }
    if (tok === 'INV') { expr = expr ? `1÷(${expr})` : expr; return render() }
    if (tok === 'ANS') { if (ans == null) return toast('Nothing to reuse yet. Press = first.'); tok = formatResult(ans) }
    const isOp = /^[+−×÷^%!)]|^\^/.test(tok) && tok !== '('
    if (justEvaluated && !isOp) expr = '' // typing a number or function after "=" starts a new calculation; an operator continues from the result
    justEvaluated = false
    if (tok === '.' && /(^|[^\d.])$/.test(expr)) tok = '0.'
    expr += tok
    render()
  }
  const keyBtn = (label, tok, cls = '') => {
    const b = h('button', { type: 'button', class: ['k', cls], 'aria-label': { '÷': 'divide', '×': 'multiply', '−': 'minus', '+': 'plus', '⌫': 'backspace', '=': 'equals', 'AC': 'clear all', '.': 'decimal point' }[label] || null, dataset: { tok },
      onclick: (e) => { press(tok); if (e.detail > 0) node.focus({ preventScroll: true }) } }, label === '⌫' ? icon('delete') : label)
    return b
  }
  sciEl.append(...SCI.map(([l, t]) => keyBtn(l, t, 'fn')))

  const mem = (label, fn) => h('button', { type: 'button', class: 'k mem', onclick: (e) => { fn(); render(); if (e.detail > 0) node.focus({ preventScroll: true }) } }, label)
  const currentValue = () => { const r = live(); return typeof r === 'number' ? r : null }
  const memRow = h('div', { class: 'fc-tools' },
    mem('MC', () => store.update((s) => ({ ...s, mem: 0 }))),
    mem('MR', () => { if (st().mem) { if (justEvaluated) expr = ''; expr += formatResult(st().mem); justEvaluated = false } }),
    mem('M+', () => { const v = currentValue(); if (v != null) store.update((s) => ({ ...s, mem: s.mem + v })) }),
    mem('M−', () => { const v = currentValue(); if (v != null) store.update((s) => ({ ...s, mem: s.mem - v })) }),
    memEl, h('span', { class: 'sp' }), degBtn,
    button('', { icon: 'function-square', size: 'sm', variant: 'ghost', ariaLabel: 'Scientific keys', title: 'Scientific keys', onClick: () => { store.update((s) => ({ ...s, sci: !s.sci })); render() } }),
    button('', { icon: 'history', size: 'sm', variant: 'ghost', ariaLabel: 'History', title: 'History', onClick: () => { histWrap.hidden = !histWrap.hidden } }),
    button('', { icon: 'copy', size: 'sm', variant: 'ghost', ariaLabel: 'Copy result', title: 'Copy result', onClick: () => { const v = currentValue(); if (v == null) return toast('Nothing to copy yet'); copyText(formatResult(v)) } }))
  histWrap.append(h('div', { class: 'row between' }, h('strong', { class: 'small' }, 'History'), button('Clear', { size: 'sm', variant: 'ghost', icon: 'trash-2', onClick: () => { store.update((s) => ({ ...s, history: [] })); renderHistory() } })), histEl)

  const node = h('div', { class: 't-fc', tabindex: 0, role: 'group', 'aria-label': 'Calculator' },
    h('div', { class: 'fc-card' },
      h('div', { class: 'fc-screen' }, exprEl, resEl),
      memRow, sciEl,
      h('div', { class: 'pad' }, PAD.flat().map(([l, t, c]) => keyBtn(l, t || l, c || ''))),
      histWrap))

  // keyboard works on the widget itself so it also works inside the floating window
  const MAP = { '*': '×', '/': '÷', '-': '−', 'x': '×', 'X': '×', 'p': 'π' }
  node.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key
    if (e.target.closest?.('button') && (k === 'Enter' || k === ' ')) return // let a focused key activate itself
    let tok = null
    if (/^[0-9]$/.test(k) || k === '.' || k === ',') tok = k === ',' ? '.' : k
    else if (['+', '*', '/', '-', '^', '(', ')', '%', '!', 'x', 'X'].includes(k)) tok = MAP[k] || k
    else if (k === 'Enter' || k === '=') tok = '='
    else if (k === 'Backspace') tok = 'BS'
    else if (k === 'Escape' || k === 'Delete') tok = 'AC'
    else if (k === 'p' || k === 'P') tok = 'π'
    else if (k === 'e' || k === 'E') tok = 'e'
    if (tok == null) return
    e.preventDefault()
    e.stopPropagation() // keep the site's own "/" search shortcut from firing
    press(tok)
  })
  render()
  root.append(floatShell({ node, title: 'Calculator', width: 340, height: 560, noun: 'calculator', onFloat: () => setTimeout(() => node.focus(), 80) }))
}
