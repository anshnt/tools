// Scientific calculator: safe parser (no eval), degrees or radians, memory, history, variables and keyboard input.
import { h, button, copyText, toast, clear } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { compile, formatNum, ExprError, FUNCTION_NAMES } from './_expr.js'
import { stage, tile, toolStyle, pill } from './_kit.js'

const CSS = `
.t-calc .calc-wrap { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 12px; align-items: start; }
@media (max-width: 900px) { .t-calc .calc-wrap { grid-template-columns: minmax(0, 1fr); } }
.t-calc .screen { position: relative; overflow: hidden; border-radius: 22px; padding: 14px 16px 12px; color: #f4f4ff; margin-bottom: 12px;
  background: radial-gradient(120% 140% at 100% 0%, rgba(168, 85, 247, .35), transparent 55%), radial-gradient(90% 120% at 0% 100%, rgba(236, 72, 153, .22), transparent 60%), linear-gradient(160deg, #15152b, #20203f);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 18px 40px -22px rgba(30, 20, 80, .7); }
.t-calc .screen-top { display: flex; gap: 8px; align-items: center; font: 600 11px var(--mono); letter-spacing: .08em; color: rgba(244, 244, 255, .62); min-height: 20px; }
.t-calc .screen-top .tag { padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,.1); transition: background .2s, color .2s; }
.t-calc .screen-top .tag.on { background: #fbbf24; color: #2b1d00; }
.t-calc .expr { width: 100%; background: transparent; border: 0; outline: 0; color: #fff; font: 500 22px var(--mono); text-align: right; padding: 6px 0 2px; min-width: 0; caret-color: #fbbf24; }
.t-calc .expr::placeholder { color: rgba(255,255,255,.28); }
.t-calc .result { text-align: right; font: 650 clamp(30px, 6vw, 46px) var(--font); letter-spacing: -.04em; min-height: 1.2em; line-height: 1.2; overflow-wrap: anywhere; font-variant-numeric: tabular-nums;
  background: linear-gradient(100deg, #fff 30%, #fbcfe8); -webkit-background-clip: text; background-clip: text; color: transparent; }
.t-calc .result.err { font-size: 15px; letter-spacing: 0; background: none; color: #fda4af; -webkit-text-fill-color: #fda4af; padding-top: 10px; }
.t-calc .result.ghost { opacity: .5; }
.t-calc .result.flash { animation: calc-flash .5s var(--ease); }
@keyframes calc-flash { from { transform: scale(.96); opacity: .3; filter: blur(3px); } }
.t-calc .approx { text-align: right; font: 500 13px var(--mono); color: rgba(244, 244, 255, .6); min-height: 18px; }
.t-calc .keys { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
.t-calc .k { height: 52px; border-radius: 16px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font: 600 16px var(--font); cursor: pointer; position: relative; overflow: hidden;
  box-shadow: 0 1px 0 rgba(255,255,255,.5) inset, 0 3px 0 -1px var(--border-strong); transition: transform .14s var(--pop), background .2s, box-shadow .2s, color .2s; display: grid; place-items: center; padding: 0; }
.t-calc .k:hover { background: var(--surface-2); }
.t-calc .k:active { transform: translateY(2px) scale(.94); box-shadow: none; }
.t-calc .k:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.t-calc .k.fn { background: color-mix(in srgb, var(--c) 13%, var(--surface)); border-color: color-mix(in srgb, var(--c) 28%, var(--border)); font-size: 14.5px; }
.t-calc .k.op { background: var(--accent-soft); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 22%, var(--border)); font-size: 20px; }
.t-calc .k.mem { background: var(--surface-2); color: var(--muted); font-size: 13px; height: 40px; }
.t-calc .k.mem[aria-pressed="true"], .t-calc .k.mode[aria-pressed="true"] { background: var(--text); color: var(--bg); }
.t-calc .k.mode { background: var(--surface-2); font-size: 12.5px; height: 40px; letter-spacing: .04em; }
.t-calc .k.clear { background: var(--danger-soft); color: var(--danger); border-color: color-mix(in srgb, var(--danger) 25%, transparent); }
.t-calc .k.eq { background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff; border: 0; font-size: 24px; box-shadow: 0 10px 22px -10px var(--accent); }
.t-calc .k.eq:hover { filter: brightness(1.08); }
.t-calc .k sup { font-size: .62em; position: relative; top: -.1em; }
.t-calc .hist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; max-height: 470px; overflow: auto; }
.t-calc .hist li { border: 1px solid var(--border); border-radius: 14px; padding: 10px 12px; background: var(--surface); cursor: pointer; text-align: right; transition: transform .2s var(--ease), border-color .2s, background .2s; animation: stu-pop .4s var(--ease) both; }
.t-calc .hist li:hover { border-color: var(--accent); transform: translateX(-3px); background: var(--accent-soft); }
.t-calc .hist .e { font: 500 13px var(--mono); color: var(--muted); overflow-wrap: anywhere; }
.t-calc .hist .r { font: 650 20px var(--font); letter-spacing: -.02em; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.t-calc .vars { display: flex; flex-wrap: wrap; gap: 6px; }
.t-calc .tips { font-size: 12.5px; color: var(--muted); line-height: 1.6; margin-top: 10px; }
.t-calc .tips code { background: var(--surface-2); padding: 1px 5px; border-radius: 5px; font-size: 12px; }
@media (max-width: 420px) { .t-calc .k { height: 48px; border-radius: 14px; font-size: 15px; } .t-calc .keys { gap: 6px; } .t-calc .expr { font-size: 19px; } }
`

/** Close any open brackets so "sin(30" still evaluates while typing. */
export function autoClose(expr) {
  let open = 0
  for (const ch of expr) { if (ch === '(' || ch === '[' || ch === '{') open++; else if (ch === ')' || ch === ']' || ch === '}') open = Math.max(0, open - 1) }
  return expr + ')'.repeat(open)
}

/** Best simple fraction for x (denominator up to maxDen) or null. */
export function toFraction(x, maxDen = 1000, tol = 1e-9) {
  if (!Number.isFinite(x) || Number.isInteger(x) || Math.abs(x) > 1e9) return null
  const sign = x < 0 ? -1 : 1, v = Math.abs(x)
  let h0 = 1, h1 = Math.floor(v), k0 = 0, k1 = 1, r = v - h1
  while (Math.abs(v - h1 / k1) > tol) {
    if (r < 1e-12) break
    const inv = 1 / r, a = Math.floor(inv)
    r = inv - a
    const h2 = a * h1 + h0, k2 = a * k1 + k0
    if (k2 > maxDen) return null
    h0 = h1; h1 = h2; k0 = k1; k1 = k2
  }
  return Math.abs(v - h1 / k1) <= tol ? [sign * h1, k1] : null
}

const ASSIGN = /^\s*([A-Za-z_][A-Za-z_0-9]*)\s*=(?!=)\s*(.+)$/

/**
 * Evaluate one calculator line.
 * state: {angle: 'deg'|'rad', ans: number, mem: number, vars: {name: number}}
 * -> {value, text, assign?: name}
 */
export function runLine(expr, state) {
  let src = expr.trim()
  let assign = null
  const m = ASSIGN.exec(src)
  if (m) {
    const low = m[1].toLowerCase()
    if (FUNCTION_NAMES.includes(low) || ['pi', 'e', 'tau', 'phi'].includes(low) || low === 'ans') throw new ExprError(`"${m[1]}" is reserved and cannot be a variable`, 0)
    assign = m[1]
    src = m[2]
  }
  const scope = { ...state.vars, Ans: state.ans, ans: state.ans, M: state.mem }
  const { fn } = compile(autoClose(src), { angle: state.angle, known: (n) => Object.hasOwn(scope, n) })
  const value = fn(scope)
  if (typeof value !== 'number') throw new ExprError('That did not give a number', 0)
  return { value, text: formatNum(value), assign }
}

const errText = (e) => (e instanceof ExprError ? e.message : 'Could not calculate that')

export function mount(root) {
  const state = { angle: load('calc:angle', 'deg'), ans: 0, mem: load('calc:mem', 0), vars: load('calc:vars', {}), inv: false, fresh: false }
  let history = load('calc:history', [])
  toolStyle('calc', CSS)

  const exprIn = h('input', { class: 'expr', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, 'aria-label': 'Expression', placeholder: '0', enterkeyhint: 'done' })
  if (!matchMedia('(hover: hover)').matches) exprIn.setAttribute('inputmode', 'none')
  const resultEl = h('div', { class: 'result ghost', 'aria-live': 'polite' }, '0')
  const approxEl = h('div', { class: 'approx' })
  const tagAngle = h('span', { class: 'tag on' }), tagInv = h('span', { class: 'tag' }, 'INV'), tagMem = h('span', { class: 'tag' }, 'M')
  const screen = h('div', { class: 'screen' }, h('div', { class: 'screen-top' }, tagAngle, tagInv, tagMem, h('span', { style: 'flex:1' }), h('span', 'SCIENTIFIC')), exprIn, resultEl, approxEl)
  const varsEl = h('div', { class: 'vars' })
  const histEl = h('ul', { class: 'hist', 'aria-label': 'History' })

  const keyMap = {}
  function mk(label, cls, action, aria) {
    const b = h('button', { type: 'button', class: ['k', cls], 'aria-label': aria || null, onmousedown: (e) => e.preventDefault(), onclick: () => { action(); if (matchMedia('(hover: hover)').matches) exprIn.focus() } }, label)
    return b
  }
  const ins = (t) => () => insert(t)
  const sup = (a, b) => h('span', a, h('sup', b))
  const invPair = (norm, alt, nIns, aIns, nAria, aAria) => {
    const b = mk(norm, 'fn', () => insert(state.inv ? aIns : nIns), nAria)
    keyMap[norm] = { b, norm, alt, nAria, aAria }
    return b
  }
  const keys = [
    mk('', 'mode', toggleAngle, 'Toggle degrees and radians'), mk('MC', 'mem', () => memory('c'), 'Memory clear'), mk('MR', 'mem', () => memory('r'), 'Memory recall'), mk('M+', 'mem', () => memory('+'), 'Add to memory'), mk('M−', 'mem', () => memory('-'), 'Subtract from memory'),
    mk('INV', 'mode', toggleInv, 'Inverse functions'), invPair('sin', 'sin⁻¹', 'sin(', 'asin(', 'sine', 'inverse sine'), invPair('cos', 'cos⁻¹', 'cos(', 'acos(', 'cosine', 'inverse cosine'), invPair('tan', 'tan⁻¹', 'tan(', 'atan(', 'tangent', 'inverse tangent'), invPair('√', '∛', '√(', 'cbrt(', 'square root', 'cube root'),
    invPair('x²', 'x³', '^2', '^3', 'square', 'cube'), invPair('xʸ', 'ʸ√x', '^', 'root(', 'power', 'root'), invPair('ln', 'eˣ', 'ln(', 'exp(', 'natural log', 'e to the power'), invPair('log', '10ˣ', 'log(', '10^', 'log base 10', 'ten to the power'), mk('n!', 'fn', ins('!'), 'factorial'),
    mk('π', 'fn', ins('π'), 'pi'), mk('e', 'fn', ins('e'), 'Euler number'), mk('(', 'fn', ins('('), 'open bracket'), mk(')', 'fn', ins(')'), 'close bracket'), mk('⌫', 'clear', backspace, 'Backspace'),
    mk('7', '', ins('7')), mk('8', '', ins('8')), mk('9', '', ins('9')), mk('÷', 'op', ins('÷'), 'divide'), mk('AC', 'clear', allClear, 'All clear'),
    mk('4', '', ins('4')), mk('5', '', ins('5')), mk('6', '', ins('6')), mk('×', 'op', ins('×'), 'multiply'), mk('Ans', 'fn', ins('Ans'), 'Previous answer'),
    mk('1', '', ins('1')), mk('2', '', ins('2')), mk('3', '', ins('3')), mk('−', 'op', ins('−'), 'minus'), mk('%', 'fn', ins('%'), 'percent'),
    mk('0', '', ins('0')), mk('.', '', ins('.')), mk('EXP', 'fn', ins('e'), 'times ten to the power'), mk('+', 'op', ins('+'), 'plus'), mk('=', 'eq', equals, 'Equals'),
  ]
  // label the toggle keys & fix the "xʸ"/"x²" display with real superscripts
  keyMap['x²'].b.replaceChildren(sup('x', '2')); keyMap['xʸ'].b.replaceChildren(sup('x', 'y'))
  const angleKey = keys[0], invKey = keys[5], memKeys = { c: keys[1], r: keys[2] }
  const kbd = h('div', { class: 'keys', role: 'group', 'aria-label': 'Calculator keys' }, keys)

  // ---- state helpers ----
  function insert(t) {
    const isBinary = /^[+\-×÷^−]|^\^/.test(t) && t !== '(' 
    if (state.fresh) {
      state.fresh = false
      exprIn.value = isBinary || t === '^2' || t === '^3' || t === '!' || t === '%' ? 'Ans' : ''
    }
    const s = exprIn.selectionStart ?? exprIn.value.length, e = exprIn.selectionEnd ?? s
    exprIn.value = exprIn.value.slice(0, s) + t + exprIn.value.slice(e)
    const pos = s + t.length
    try { exprIn.setSelectionRange(pos, pos) } catch { /* input type does not support selection */ }
    preview()
  }
  function backspace() {
    if (state.fresh) { exprIn.value = ''; state.fresh = false; preview(); return }
    const s = exprIn.selectionStart ?? exprIn.value.length, e = exprIn.selectionEnd ?? s
    if (s !== e) exprIn.value = exprIn.value.slice(0, s) + exprIn.value.slice(e)
    else if (s > 0) {
      // delete a whole function name like "sin(" in one go
      const m = /(?:[a-z]+\()$/i.exec(exprIn.value.slice(0, s))
      const n = m ? m[0].length : 1
      exprIn.value = exprIn.value.slice(0, s - n) + exprIn.value.slice(s)
      try { exprIn.setSelectionRange(s - n, s - n) } catch { /* ignore */ }
    }
    preview()
  }
  function allClear() { exprIn.value = ''; state.fresh = false; setResult('0', 'ghost'); approxEl.textContent = '' }
  function toggleAngle() { state.angle = state.angle === 'deg' ? 'rad' : 'deg'; save('calc:angle', state.angle); syncModes(); preview() }
  function toggleInv() { state.inv = !state.inv; syncModes() }
  function syncModes() {
    tagAngle.textContent = state.angle === 'deg' ? 'DEG' : 'RAD'
    angleKey.replaceChildren(state.angle === 'deg' ? 'DEG' : 'RAD'); angleKey.setAttribute('aria-pressed', 'false')
    tagInv.classList.toggle('on', state.inv); invKey.setAttribute('aria-pressed', String(state.inv))
    tagMem.classList.toggle('on', !!state.mem); memKeys.r.setAttribute('aria-pressed', String(!!state.mem))
    for (const k of Object.values(keyMap)) {
      const label = state.inv ? k.alt : k.norm
      if (k.norm === 'x²') k.b.replaceChildren(sup('x', state.inv ? '3' : '2'))
      else if (k.norm === 'xʸ') k.b.replaceChildren(state.inv ? sup('ʸ√', 'x') : sup('x', 'y'))
      else k.b.textContent = label
      k.b.setAttribute('aria-label', state.inv ? k.aAria : k.nAria)
    }
  }
  function setResult(text, cls = '') {
    resultEl.className = `result ${cls}`.trim()
    resultEl.textContent = text
  }
  function currentValue() {
    // The value a memory key should use: the live result of what is typed, else the last answer
    const src = exprIn.value.trim()
    if (!src) return state.ans
    return runLine(src, state).value
  }
  function preview() {
    const src = exprIn.value
    if (!src.trim()) { setResult(state.fresh ? resultEl.textContent : '0', 'ghost'); approxEl.textContent = ''; return }
    try {
      const r = runLine(src, state)
      if (!Number.isFinite(r.value)) throw new ExprError('not a number')
      setResult(r.text, 'ghost')
      const f = toFraction(r.value)
      approxEl.textContent = f ? `≈ ${f[0]}/${f[1]}` : ''
    } catch {
      setResult(' ', 'ghost') // incomplete or invalid while typing: stay quiet until Enter
      approxEl.textContent = ''
    }
  }
  function equals() {
    const src = exprIn.value.trim()
    if (!src) return
    try {
      const r = runLine(src, state)
      if (Number.isNaN(r.value) || !Number.isFinite(r.value)) {
        setResult(Number.isNaN(r.value) ? 'Undefined: check the values you used' : r.value > 0 ? 'Result is infinite (division by zero?)' : 'Result is minus infinity', 'err')
        resultEl.classList.add('stu-shake')
        setTimeout(() => resultEl.classList.remove('stu-shake'), 450)
        return
      }
      state.ans = r.value
      if (r.assign) { state.vars[r.assign] = r.value; save('calc:vars', state.vars); renderVars() }
      history = [{ expr: src, result: r.text, assign: r.assign || null }, ...history].slice(0, 60)
      save('calc:history', history)
      renderHistory(true)
      setResult(r.text, 'flash')
      const f = toFraction(r.value)
      approxEl.textContent = f ? `≈ ${f[0]}/${f[1]}` : ''
      exprIn.value = src
      state.fresh = true
    } catch (e) {
      setResult(errText(e), 'err')
      resultEl.classList.add('stu-shake')
      setTimeout(() => resultEl.classList.remove('stu-shake'), 450)
    }
  }
  function memory(kind) {
    if (kind === 'c') state.mem = 0
    else if (kind === 'r') { insert(formatNum(state.mem)); }
    else {
      try {
        const v = currentValue()
        if (!Number.isFinite(v)) throw new ExprError('Nothing to store')
        state.mem = kind === '+' ? state.mem + v : state.mem - v
      } catch (e) { toast(errText(e), 'error'); return }
    }
    save('calc:mem', state.mem)
    syncModes()
    if (kind !== 'r') toast(state.mem ? `Memory: ${formatNum(state.mem)}` : 'Memory cleared')
  }
  function renderHistory(animate) {
    clear(histEl)
    if (!history.length) { histEl.append(h('li', { style: 'cursor:default;text-align:center;border-style:dashed;animation:none' }, h('span', { class: 'e' }, 'Your calculations appear here'))); return }
    history.forEach((it, i) => {
      const li = h('li', { tabindex: 0, role: 'button', 'aria-label': `${it.expr} equals ${it.result}. Use result`, style: animate && i > 0 ? 'animation:none' : '',
        onclick: () => { state.fresh = false; exprIn.value = it.expr; preview(); exprIn.focus() },
        onkeydown: (e) => { if (e.key === 'Enter') li.click() },
        oncontextmenu: (e) => { e.preventDefault(); copyText(it.result) } },
      h('div', { class: 'e' }, it.expr.replace(/\*/g, '×')), h('div', { class: 'r' }, '= ', it.result))
      histEl.append(li)
    })
  }
  function renderVars() {
    clear(varsEl)
    const entries = Object.entries(state.vars)
    if (!entries.length) { varsEl.append(h('span', { class: 'stu-hint' }, 'Store a value with a name, e.g. type r = 5 then use r in later sums.')); return }
    for (const [k, v] of entries) varsEl.append(h('button', { type: 'button', class: 'stu-chip-btn', title: 'Click to insert, shift-click to remove', onclick: (e) => {
      if (e.shiftKey) { delete state.vars[k]; save('calc:vars', state.vars); renderVars(); return }
      insert(k)
    } }, `${k} = ${formatNum(v)}`))
  }

  exprIn.addEventListener('input', () => { state.fresh = false; preview() })
  exprIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); equals() }
    else if (e.key === 'Escape') { e.preventDefault(); allClear() }
    else if (state.fresh && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      // typing after "=": an operator continues from the answer, anything else starts fresh
      e.preventDefault()
      insert(e.key)
    }
  })

  const clearHist = button('Clear', { icon: 'trash-2', variant: 'ghost', size: 'sm', onClick: () => { history = []; save('calc:history', history); renderHistory() } })
  const copyRes = button('Copy result', { icon: 'copy', variant: 'secondary', size: 'sm', onClick: () => copyText(resultEl.classList.contains('err') ? '' : resultEl.textContent) })
  syncModes(); renderHistory(); renderVars(); preview()
  root.append(stage('t-calc',
    h('div', { class: 'calc-wrap' },
      tile({ tint: '#a855f7', cls: 'stu-pop' }, screen, kbd, h('div', { class: 'row', style: 'margin-top:12px' }, copyRes, pill('Keyboard works: type, Enter for =, Esc to clear', '', 'keyboard'))),
      h('div', { class: 'stack' },
        tile({ tint: '#f59e0b', title: 'History', icon: 'history', actions: clearHist, i: 1 }, histEl),
        tile({ tint: '#10b981', title: 'Variables', icon: 'variable', i: 2 }, varsEl,
          h('div', { class: 'tips' }, 'Try ', h('code', '2(3+4)'), ', ', h('code', 'sin 30'), ', ', h('code', '5!'), ', ', h('code', '200+10%'), ', ', h('code', 'nCr(10,3)'), ', ', h('code', 'log(8,2)'), '. Right-click a history line to copy its answer.')))))
  )
  exprIn.focus({ preventScroll: true })
}
