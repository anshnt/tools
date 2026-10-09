// Excel formula explainer: tokenizes and parses the formula locally, then explains it in plain English, step by step.
// Optional: ask Claude for a deeper explanation (needs your own API key).
import { h, icon, clear, button, alert, debounce, toast, copyButton, busy } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { FUNCTIONS, CATEGORIES, lookupFn } from './_excel-fns.js'
import { parseFormula, describe, sentenceFor, describeRef, stepsOf, refsOf, lint, pretty, compact, children, EXAMPLES } from './_formula.js'
import { injectStyles, section } from './_view.js'

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const CLS = { fn: 'fn', ref: 'ref', str: 'str', num: 'num', bool: 'bool', err: 'err', name: 'name', op: 'op', sep: 'sep', array: 'str', open: 'par', close: 'par', bad: 'err' }

function highlighted(parsed) {
  let depth = 0
  const out = []
  const stack = []
  for (const t of parsed.tokens) {
    if (t.t === 'ws') { out.push(t.v); continue }
    let cls = `dt-tk dt-k-${CLS[t.t] || 'op'}`
    if (t.t === 'open') { stack.push(depth); cls += ` dt-k-p${depth % 4}`; depth++ }
    else if (t.t === 'close') { if (stack.length) { const d = stack.pop(); depth = d; cls += ` dt-k-p${d % 4}` } else cls += ' dt-k-bad' }
    out.push(h('span', { class: cls, title: t.t === 'fn' ? (lookupFn(t.v)?.desc || 'Unknown function') : t.t === 'ref' ? `Reference ${t.v}` : null }, t.v))
  }
  return out
}

function treeNode(n, src) {
  if (!n) return h('li', { class: 'dt-tr-empty' }, 'empty')
  const kids = children(n)
  if (n.type === 'fn') {
    const info = lookupFn(n.name)
    const argLis = n.args.map((a, i) => {
      const def = info?.args[Math.min(i, info.args.length - 1)]
      const label = def ? def.name : `argument ${i + 1}`
      return h('li', { class: 'dt-tr-arg' }, h('span', { class: 'dt-tr-label' }, label), a ? treeNode(a, src) : h('span', { class: 'muted' }, 'left empty'))
    })
    return h('li', h('div', { class: 'dt-tr-head' }, h('span', { class: 'dt-tk dt-k-fn' }, n.name.toUpperCase()), info ? h('span', { class: 'dt-pill' }, CATEGORIES[info.cat]) : h('span', { class: 'dt-pill' }, 'unknown')), argLis.length ? h('ul', argLis) : null)
  }
  if (n.type === 'bin') return h('li', h('div', { class: 'dt-tr-head' }, h('span', { class: 'dt-tk dt-k-op' }, n.op), h('span', { class: 'muted small' }, 'operator')), h('ul', h('li', { class: 'dt-tr-arg' }, treeNode(n.left, src)), h('li', { class: 'dt-tr-arg' }, treeNode(n.right, src))))
  if (n.type === 'paren' || n.type === 'un' || n.type === 'pct' || n.type === 'spill') return h('li', h('div', { class: 'dt-tr-head' }, h('span', { class: 'dt-tk dt-k-op' }, n.type === 'paren' ? '( )' : n.type === 'pct' ? '%' : n.type === 'spill' ? '#' : n.op), h('span', { class: 'muted small' }, n.type === 'paren' ? 'brackets' : 'operator')), kids.length ? h('ul', h('li', { class: 'dt-tr-arg' }, treeNode(n.arg, src))) : null)
  const cls = { ref: 'ref', str: 'str', num: 'num', bool: 'bool', err: 'err', name: 'name', array: 'str' }[n.type] || 'op'
  const note = n.type === 'ref' ? describeRef(n) : n.type === 'name' ? 'named range or value' : n.type === 'str' ? 'text' : n.type === 'num' ? 'number' : n.type === 'bool' ? 'logical value' : n.type === 'array' ? 'list of constants' : ''
  return h('li', h('span', { class: `dt-tk dt-k-${cls}` }, n.raw), note && h('span', { class: 'muted small', style: 'margin-left:8px' }, note))
}

function argTable(info, n) {
  const rows = n.args.map((a, k) => {
    const d = info.args[Math.min(k, info.args.length - 1)]
    const name = d ? `${d.name}${d.optional ? ' (optional)' : ''}` : `argument ${k + 1}`
    return h('tr', h('td', h('code', name)), h('td', d?.desc || ''), h('td', h('code', a ? compact(a) : '(empty)')))
  })
  return h('table', { class: 'table dt-argt' }, h('thead', h('tr', h('th', 'Argument'), h('th', 'What it means'), h('th', 'In your formula'))), h('tbody', rows))
}
function stepCard(n, i) {
  const info = lookupFn(n.name)
  const more = info
    ? h('details', { class: 'dt-det' }, h('summary', `${info.name}: ${info.desc}`), h('div', { class: 'dt-det-body' }, argTable(info, n)))
    : h('p', { class: 'small muted' }, 'This function is not in the built-in dictionary.')
  return h('li', { class: 'dt-stp', style: { '--i': Math.min(i, 10) } },
    h('div', { class: 'n' }, String(i + 1)),
    h('div', { class: 'b' }, h('code', { class: 'dt-stp-code' }, compact(n)), h('p', sentenceFor(n)), more))
}

export function mount(root) {
  injectStyles()
  const q = new URLSearchParams(location.hash.split('?')[1] || '')
  const input = h('textarea', { class: 'textarea mono dt-fin', rows: 3, spellcheck: false, placeholder: '=IF(A2>=50,"Pass","Fail")', 'aria-label': 'Excel formula', value: q.get('f') || '' })
  const out = h('div', { class: 'dt-fx-out' })
  const aiOut = h('div', { class: 'dt-ai-out', 'aria-live': 'polite' })
  const aiQ = h('input', { class: 'input', placeholder: 'Optional: what are you trying to do, or what goes wrong?', 'aria-label': 'Your question' })
  let current = ''
  let controller = null

  function render() {
    const raw = input.value
    current = raw
    if (!raw.trim()) {
      clear(out, h('div', { class: 'empty' }, icon('square-function'), 'Paste a formula above, or try one of the examples. Nothing is sent anywhere.'))
      return
    }
    const parsed = parseFormula(raw)
    const issues = lint(parsed)
    const ast = parsed.ast
    const fnSteps = stepsOf(ast)
    const refs = refsOf(ast)
    const used = [...new Map(fnSteps.map((n) => [n.name.toUpperCase().replace(/^_XLFN\./, ''), n])).values()]
    const hasErrors = issues.some((i) => i.level === 'error')
    const summary = ast ? sentenceFor(ast) : ''
    const nodes = []
    nodes.push(h('div', { class: 'dt-fx-hero' }, h('div', { class: 'dt-fx-code', tabindex: 0 }, '=', highlighted(parsed)),
      h('div', { class: 'row' }, copyButton(() => `=${parsed.src}`, 'Copy formula'), button('Format it', { icon: 'wand-sparkles', size: 'sm', onClick: () => { input.value = `=${pretty(ast)}`; render() } }), button('Make it compact', { icon: 'minimize-2', size: 'sm', variant: 'ghost', onClick: () => { input.value = `=${compact(ast)}`; render() } }))))
    if (summary && !hasErrors) nodes.push(h('div', { class: 'dt-fx-sum' }, h('div', { class: 'k' }, icon('message-square-text'), 'In plain English'), h('p', summary)))
    else if (summary) nodes.push(h('div', { class: 'dt-fx-sum bad' }, h('div', { class: 'k' }, icon('triangle-alert'), 'Best guess (the formula has problems)'), h('p', summary)))
    if (issues.length) nodes.push(h('div', { class: 'stack tight' }, issues.map((i) => alert(i.level === 'error' ? 'error' : i.level === 'warn' ? 'warn' : 'info', i.msg))))
    if (fnSteps.length) {
      nodes.push(section('Step by step, in the order Excel works it out', 'list-ordered', h('ol', { class: 'dt-steps' }, fnSteps.slice(0, 40).map((n, i) => stepCard(n, i)))))
      if (fnSteps.length > 40) nodes.push(h('p', { class: 'small muted' }, `Showing the first 40 of ${fnSteps.length} functions.`))
    }
    if (ast && (ast.type === 'fn' || ast.type === 'bin')) nodes.push(section('How it is built', 'git-fork', h('div', { class: 'dt-tree' }, h('ul', treeNode(ast, parsed.src)))))
    if (used.length) nodes.push(section('Functions used', 'square-function', h('div', { class: 'dt-grid' }, used.map((n) => {
      const info = lookupFn(n.name)
      return h('div', { class: 'dt-fncard dt-glow' }, h('div', { class: 'dt-fncard-top' }, h('b', info ? info.name : n.name.toUpperCase()), info && h('span', { class: 'dt-pill' }, CATEGORIES[info.cat])), h('code', { class: 'dt-fncard-syn' }, info ? info.syntax : `${n.name.toUpperCase()}(...)`), h('p', info ? info.desc : 'Not in the built-in dictionary of about 170 common functions.'))
    }))))
    if (refs.length) nodes.push(section('Cells and names it uses', 'table-cells-split', h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', h('tr', h('th', 'Reference'), h('th', 'Meaning'))), h('tbody', refs.map((r) => h('tr', h('td', h('code', r.raw)), h('td', r.type === 'name' ? 'A named range or value (see Formulas > Name Manager)' : describeRef(r)))))))))
    clear(out, nodes)
  }

  async function explainWithAi(btn) {
    if (!current.trim()) { toast('Type a formula first', 'error'); return }
    if (!(await ai.ensureKey())) return
    controller?.abort()
    controller = new AbortController()
    clear(aiOut)
    const text = h('div', { class: 'dt-ai-text' })
    aiOut.append(text)
    await busy(btn, async () => {
      await ai.ask({
        system: 'You are a patient Excel teacher. Explain formulas to someone who uses Excel at work but is not an expert. Use short paragraphs and a numbered list of steps. Mention likely pitfalls and a simpler or more modern alternative when there is one. Never invent function behavior. Do not use em dashes.',
        prompt: `Explain this Excel formula in depth.\n\nFormula: ${current.trim()}\n${aiQ.value.trim() ? `\nMy question: ${aiQ.value.trim()}\n` : ''}\nCover: what it does overall, how each part works, an example with sample values and the result, common mistakes and error causes, and a better alternative if one exists.`,
        effort: 'low', onText: (t) => { text.textContent = t }, signal: controller.signal,
      })
    }, { label: 'Thinking', errorTo: aiOut })
  }

  const aiBtn = button('Explain in more depth with AI', { icon: 'sparkles', variant: 'secondary' })
  aiBtn.addEventListener('click', () => explainWithAi(aiBtn))
  input.addEventListener('input', debounce(render, 160))
  const examples = h('div', { class: 'dt-feat' }, EXAMPLES.map(([label, f]) => h('button', { type: 'button', class: 'dt-chip', title: f, onclick: () => { input.value = f; render(); input.focus({ preventScroll: true }) } }, h('span', label))))
  root.append(h('style', {}, CSS), h('div', { class: 'stack' },
    h('div', { class: 'panel stack' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Your formula'), input), examples,
      h('div', { class: 'row small muted' }, icon('shield-check'), 'The formula is read in your browser. It is only sent to AI if you press the AI button.')),
    out,
    h('div', { class: 'panel stack' }, h('h2', icon('sparkles'), 'Want a deeper explanation?'), ai.notice('Optional AI explanation uses AI'), aiQ, h('div', { class: 'row' }, aiBtn), aiOut)))
  render()
  return () => controller?.abort()
}

const CSS = `
.dt-fin { font-size: 15px; min-height: 90px; }
.dt-fx-out { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.dt-fx-out > * { animation: dtIn .45s var(--ease) both; }
.dt-fx-hero { display: flex; flex-direction: column; gap: 12px; padding: 18px; border-radius: var(--radius-lg); border: 1px solid var(--border); background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 7%, var(--surface)), var(--surface)); box-shadow: var(--shadow-sm); }
.dt-fx-code { font-family: var(--mono); font-size: 16.5px; line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere; outline: none; }
.dt-tk { border-radius: 5px; padding: 0 1px; transition: background .15s; }
.dt-tk:hover { background: var(--surface-3); }
.dt-k-fn { color: var(--accent); font-weight: 650; } .dt-k-ref { color: #0e7490; } .dt-k-str { color: #15803d; } .dt-k-num { color: #c2410c; } .dt-k-bool { color: #a21caf; } .dt-k-err { color: var(--danger); font-weight: 650; }
.dt-k-name { color: #7c3aed; } .dt-k-op { color: var(--muted); font-weight: 600; } .dt-k-sep { color: var(--muted); }
:root[data-theme="dark"] .dt-k-ref { color: #67e8f9; } :root[data-theme="dark"] .dt-k-str { color: #86efac; } :root[data-theme="dark"] .dt-k-num { color: #fdba74; } :root[data-theme="dark"] .dt-k-bool { color: #f0abfc; } :root[data-theme="dark"] .dt-k-name { color: #c4b5fd; }
.dt-k-p0 { color: #6366f1; font-weight: 700; } .dt-k-p1 { color: #ec4899; font-weight: 700; } .dt-k-p2 { color: #f59e0b; font-weight: 700; } .dt-k-p3 { color: #10b981; font-weight: 700; } .dt-k-bad { color: var(--danger); background: var(--danger-soft); font-weight: 700; }
.dt-fx-sum { padding: 16px 18px; border-radius: var(--radius-lg); background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--accent); box-shadow: var(--shadow-sm); }
.dt-fx-sum.bad { border-left-color: var(--warning); }
.dt-fx-sum .k { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: 6px; }
.dt-fx-sum p { font-size: 17px; line-height: 1.5; letter-spacing: -.01em; overflow-wrap: anywhere; }
.dt-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.dt-stp { display: flex; gap: 12px; padding: 12px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--border); animation: dtIn .45s calc(var(--i, 0) * 50ms) var(--ease) both; min-width: 0; }
.dt-stp .n { flex: none; width: 30px; height: 30px; border-radius: 10px; display: grid; place-items: center; font-weight: 700; font-size: 13px; color: #fff; background: var(--dt-g, linear-gradient(135deg, var(--accent), var(--accent-2))); }
.dt-stp .b { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 6px; }
.dt-stp-code { font-family: var(--mono); font-size: 13px; background: var(--surface-2); padding: 4px 8px; border-radius: 8px; overflow-wrap: anywhere; align-self: flex-start; max-width: 100%; }
.dt-stp p { font-size: 14.5px; }
.dt-argt td, .dt-argt th { white-space: normal; vertical-align: top; }
.dt-tree ul { list-style: none; margin: 0; padding-left: 20px; border-left: 1px dashed var(--border-strong); }
.dt-tree > ul { padding-left: 0; border: 0; }
.dt-tree li { padding: 4px 0 4px 2px; font-size: 14px; position: relative; }
.dt-tr-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dt-tr-arg { display: flex; flex-direction: column; gap: 2px; }
.dt-tr-label { font-size: 11.5px; color: var(--muted); font-family: var(--mono); }
.dt-fncard { padding: 14px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface); display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dt-fncard-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dt-fncard-syn { font-family: var(--mono); font-size: 12px; color: var(--accent); overflow-wrap: anywhere; }
.dt-fncard p { font-size: 13.5px; color: var(--text-2); }
.dt-ai-text { white-space: pre-wrap; font-size: 14.5px; line-height: 1.65; padding: 14px; border-radius: var(--radius); background: var(--surface-2); border: 1px solid var(--border); overflow-wrap: anywhere; }
.dt-feat .dt-chip { min-height: 32px; font-size: 13px; }
`
