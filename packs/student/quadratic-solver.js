// Quadratic equation solver: ax^2 + bx + c = 0 with step-by-step working, exact roots (surds and fractions), vertex form and a graph.
import { h, button, field, alert, clear, copyText, number, formatNumber, svg } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { stage, tile, toolStyle, pill, emptyState, TINTS } from './_kit.js'
import { katexReady, tex } from './_pages.js'

const CSS = `
.t-quad .finput { font: 600 20px var(--mono); height: 54px; }
.t-quad .abc { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.t-quad .abc .input { font: 600 18px var(--mono); height: 48px; text-align: center; }
.t-quad .step { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 12px; padding: 12px 0; border-bottom: 1px dashed var(--border); animation: stu-pop .45s var(--ease) both; animation-delay: calc(var(--i, 0) * 70ms); }
.t-quad .step:last-child { border-bottom: 0; }
.t-quad .step .n { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 700; background: color-mix(in srgb, var(--accent) 16%, var(--surface)); color: var(--accent); }
.t-quad .step .t { font-size: 14px; color: var(--text-2); margin-bottom: 4px; }
.t-quad .step .m { overflow-x: auto; padding: 2px 0; font-size: 17px; }
.t-quad .answer { font-size: clamp(20px, 4vw, 28px); overflow-x: auto; padding: 4px 0; }
.t-quad .plot { width: 100%; height: auto; border-radius: 16px; background: var(--surface); border: 1px solid var(--border); display: block; }
.t-quad .chips { display: flex; flex-wrap: wrap; gap: 6px; }
`
const EX = ['x^2 - 5x + 6 = 0', '2x^2 + 3x - 2 = 0', 'x^2 - 2x - 1 = 0', 'x^2 + 4x + 4 = 0', 'x^2 + 2x + 5 = 0', '3x^2 = 12x']

const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a))
const isInt = (x) => Number.isInteger(x) && Math.abs(x) < 1e12

/** Parse "2x^2 - 3x + 1 = 0" (also x2, x², fractions like 1/2x, and terms on both sides) -> {a, b, c}. Throws a readable error. */
export function parseQuadratic(text) {
  const clean = String(text).toLowerCase().replace(/[−–]/g, '-').replace(/\s+/g, '').replace(/²/g, '^2').replace(/\*/g, '').replace(/x\^?2/g, 'x^2')
  if (!clean) throw new Error('Type an equation like x^2 - 5x + 6 = 0.')
  const sides = clean.split('=')
  if (sides.length > 2) throw new Error('Use a single "=" sign.')
  const side = (s) => {
    const out = { a: 0, b: 0, c: 0 }
    if (/[()]/.test(s)) throw new Error('Brackets are not supported here. Expand the equation first, for example (x+1)^2 becomes x^2 + 2x + 1.')
    if (!s) return out
    const re = /([+-]?)((?:\d+(?:\.\d+)?)(?:\/\d+(?:\.\d+)?)?)?(x\^2|x)?/g
    let m, used = 0
    while ((m = re.exec(s)) && m[0] !== '') {
      used += m[0].length
      const sign = m[1] === '-' ? -1 : 1
      let k = 1
      if (m[2]) { const [n, d] = m[2].split('/'); k = parseFloat(n) / (d ? parseFloat(d) : 1) }
      else if (!m[3]) throw new Error('Could not read the equation near "' + s.slice(m.index) + '".')
      if (m[3] === 'x^2') out.a += sign * k
      else if (m[3] === 'x') out.b += sign * k
      else out.c += sign * k
    }
    if (used !== s.length) throw new Error('Could not read the equation. Use only numbers, x, x^2, + and -.')
    return out
  }
  const l = side(sides[0]), r = side(sides[1] ?? '')
  const res = { a: l.a - r.a, b: l.b - r.b, c: l.c - r.c }
  if (sides.length === 1) { /* "x^2-5x+6" with no "=" means = 0 */ }
  if (/x\^[3-9]|x\^1\d/.test(clean)) throw new Error('Only quadratic equations (highest power x^2) are supported.')
  return res
}

function simplifySqrt(n) { // n positive integer -> [k, m] with sqrt(n) = k sqrt(m)
  let k = 1, m = n
  for (let f = 2; f * f <= m; f++) while (m % (f * f) === 0) { m /= f * f; k *= f }
  return [k, m]
}
const fracTex = (n, d) => { const g = gcd(n, d) || 1; n /= g; d /= g; if (d < 0) { n = -n; d = -d } return d === 1 ? String(n) : n < 0 ? `-\\frac{${-n}}{${d}}` : `\\frac{${n}}{${d}}` }
const num = (x) => (Number.isInteger(x) ? String(x) : String(+x.toPrecision(8)))
const numTex = (x) => (x < 0 ? `-${num(-x)}` : num(x))
const paren = (x) => (x < 0 ? `(${num(x)})` : num(x))

/** Full solution of ax^2+bx+c=0. -> {kind: 'two'|'one'|'complex'|'linear'|'none'|'all', D, roots: [number|{re,im}], tex: {...}} */
export function solveQuadratic(a, b, c) {
  const out = { a, b, c }
  if (![a, b, c].every(Number.isFinite)) throw new Error('Enter numbers for a, b and c.')
  if (a === 0) {
    if (b === 0) { out.kind = c === 0 ? 'all' : 'none'; return out }
    out.kind = 'linear'; out.roots = [-c / b]; return out
  }
  const D = b * b - 4 * a * c
  out.D = D
  out.vertex = { x: -b / (2 * a), y: c - (b * b) / (4 * a) }
  out.kind = D > 0 ? 'two' : D === 0 ? 'one' : 'complex'
  const sq = Math.sqrt(Math.abs(D))
  if (D > 0) out.roots = [(-b + sq) / (2 * a), (-b - sq) / (2 * a)].sort((p, q) => p - q)
  else if (D === 0) out.roots = [-b / (2 * a)]
  else out.roots = [{ re: -b / (2 * a), im: sq / (2 * a) }, { re: -b / (2 * a), im: -sq / (2 * a) }]
  // exact form for integer coefficients
  if ([a, b, c].every(isInt)) {
    if (D >= 0) {
      const r = Math.round(Math.sqrt(D))
      if (r * r === D) out.exact = { rational: true, roots: D === 0 ? [fracTex(-b, 2 * a)] : [fracTex(-b - r, 2 * a), fracTex(-b + r, 2 * a)].sort() }
      else out.exact = { rational: false, tex: surdTex(a, b, D, false) }
    } else out.exact = { rational: false, tex: surdTex(a, b, -D, true) }
  }
  return out
}

/** x = (-b ± sqrt(n)) / 2a in lowest terms; imag adds the i for negative discriminants. */
function surdTex(a, b, n, imag) {
  const [k, m] = simplifySqrt(n)
  const g = gcd(gcd(b, k), 2 * a)
  let sn = -b / g
  const kk = k / g
  let dd = (2 * a) / g
  if (dd < 0) { dd = -dd; sn = -sn }
  const root = `${kk === 1 ? '' : kk}${m === 1 ? '' : `\\sqrt{${m}}`}` || '1'
  const part = imag ? (root === '1' ? 'i' : `${root}i`) : root
  const numer = sn === 0 ? `\\pm ${part}` : `${sn}\\pm ${part}`
  return dd === 1 ? `x=${numer}` : `x=\\frac{${numer}}{${dd}}`
}

function steps(s) {
  const { a, b, c, D } = s
  const st = []
  st.push(['Write the equation in the form ax² + bx + c = 0 and read off the coefficients.', `a=${num(a)},\\quad b=${num(b)},\\quad c=${num(c)}`])
  st.push(['Work out the discriminant D = b² − 4ac. Its sign tells us how many real roots there are.', `D=${paren(b)}^{2}-4(${num(a)})(${num(c)})=${num(b * b)}-${paren(4 * a * c)}=${numTex(D)}`])
  st.push([D > 0 ? 'D is positive, so there are two different real roots.' : D === 0 ? 'D is zero, so there is one repeated real root.' : 'D is negative, so there are no real roots. The roots are a pair of complex numbers.', D > 0 ? 'D>0' : D === 0 ? 'D=0' : 'D<0'])
  st.push(['Substitute into the quadratic formula.', `x=\\frac{-b\\pm\\sqrt{D}}{2a}=\\frac{${b === 0 ? '0' : numTex(-b)}\\pm\\sqrt{${numTex(D)}}}{${numTex(2 * a)}}`])
  if (s.exact?.rational === false) st.push(['Simplify the root, taking out perfect squares.', s.exact.tex])
  if (s.kind === 'two') st.push(['The two solutions are', `x_1=${num(+s.roots[0].toPrecision(8))},\\qquad x_2=${num(+s.roots[1].toPrecision(8))}`])
  else if (s.kind === 'one') st.push(['The repeated solution is', `x=${num(+s.roots[0].toPrecision(8))}`])
  else st.push(['The complex solutions are', `x=${num(+s.roots[0].re.toPrecision(6))}\\pm ${num(+Math.abs(s.roots[0].im).toPrecision(6))}i`])
  if (s.kind !== 'complex') {
    const sum = -b / a, prod = c / a
    st.push(['Check with Vieta: the roots add up to −b/a and multiply to c/a.', s.kind === 'two' ? `x_1+x_2=${num(+(s.roots[0] + s.roots[1]).toPrecision(8))}=${num(+sum.toPrecision(8))},\\quad x_1x_2=${num(+(s.roots[0] * s.roots[1]).toPrecision(8))}=${num(+prod.toPrecision(8))}` : `2x=${num(+(2 * s.roots[0]).toPrecision(8))}=${num(+sum.toPrecision(8))},\\quad x^2=${num(+(s.roots[0] ** 2).toPrecision(8))}=${num(+prod.toPrecision(8))}`])
  }
  return st
}

function plot(s) {
  const W = 560, H = 340, pad = 30
  const { a, b, c } = s
  const xs = s.kind === 'two' ? s.roots : s.kind === 'one' ? [s.roots[0]] : []
  const vx = s.vertex.x
  const span = Math.max(4, ...xs.map((x) => Math.abs(x - vx)), 2) * 1.5
  const x0 = vx - span, x1 = vx + span
  const f = (x) => a * x * x + b * x + c
  const samples = Array.from({ length: 121 }, (_, i) => { const x = x0 + ((x1 - x0) * i) / 120; return [x, f(x)] })
  const ys = samples.map((p) => p[1])
  let y0 = Math.min(...ys, 0), y1 = Math.max(...ys, 0)
  const lim = Math.max(Math.abs(s.vertex.y) * 2.2, span * span * 0.4, 4)
  if (a > 0) y1 = Math.min(y1, s.vertex.y + lim); else y0 = Math.max(y0, s.vertex.y - lim)
  if (y1 - y0 < 1) { y0 -= 1; y1 += 1 }
  const sx = (x) => pad + ((x - x0) / (x1 - x0)) * (W - 2 * pad), sy = (y) => H - pad - ((y - y0) / (y1 - y0)) * (H - 2 * pad)
  const pts = samples.filter((p) => p[1] >= y0 - (y1 - y0) && p[1] <= y1 + (y1 - y0)).map((p) => `${sx(p[0]).toFixed(1)},${Math.max(-50, Math.min(H + 50, sy(p[1]))).toFixed(1)}`).join(' ')
  const axisY = Math.min(H - pad, Math.max(pad, sy(0))), axisX = Math.min(W - pad, Math.max(pad, sx(0)))
  return svg('svg', { class: 'plot', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Graph of the parabola' },
    svg('line', { x1: pad, y1: axisY, x2: W - pad, y2: axisY, stroke: 'var(--border-strong)', 'stroke-width': 1.5 }),
    svg('line', { x1: axisX, y1: pad, x2: axisX, y2: H - pad, stroke: 'var(--border-strong)', 'stroke-width': 1.5 }),
    svg('line', { x1: sx(vx), y1: pad, x2: sx(vx), y2: H - pad, stroke: 'var(--muted)', 'stroke-dasharray': '4 5', 'stroke-width': 1 }),
    svg('clipPath', { id: 'qclip' }, svg('rect', { x: pad - 6, y: pad - 6, width: W - 2 * pad + 12, height: H - 2 * pad + 12 })),
    svg('polyline', { points: pts, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 3, 'stroke-linejoin': 'round', 'clip-path': 'url(#qclip)' }),
    ...xs.map((x, i) => svg('g', null, svg('circle', { cx: sx(x), cy: axisY, r: 6, fill: 'var(--success)', stroke: 'var(--surface)', 'stroke-width': 2 }),
      svg('text', { x: sx(x) + (xs.length === 1 ? 0 : i === 0 ? -10 : 10), y: axisY + (a > 0 ? 18 : -10), 'text-anchor': xs.length === 1 ? 'middle' : i === 0 ? 'end' : 'start', fill: 'var(--text-2)', 'font-size': 12 }, `x = ${+x.toFixed(3)}`))),
    svg('circle', { cx: sx(vx), cy: Math.max(pad, Math.min(H - pad, sy(s.vertex.y))), r: 6, fill: 'var(--warning)', stroke: 'var(--surface)', 'stroke-width': 2 }),
    svg('text', { x: Math.max(70, Math.min(W - 70, sx(vx))), y: Math.max(14, Math.min(H - 8, sy(s.vertex.y) + (a > 0 ? 24 : -14))), 'text-anchor': 'middle', fill: 'var(--text-2)', 'font-size': 12 }, `vertex (${+vx.toFixed(3)}, ${+s.vertex.y.toFixed(3)})`))
}

export function mount(root) {
  toolStyle('quad', CSS)
  const st = load('quad:state', { a: 1, b: -5, c: 6 })
  const eq = h('input', { class: 'input finput', type: 'text', spellcheck: false, autocomplete: 'off', 'aria-label': 'Equation', placeholder: 'x^2 - 5x + 6 = 0', oninput: (e) => { fromText(e.target.value) } })
  const A = number(st.a, { onInput: (n) => { st.a = n; fromNums() }, ariaLabel: 'Coefficient a' }), B = number(st.b, { onInput: (n) => { st.b = n; fromNums() }, ariaLabel: 'Coefficient b' }), Cc = number(st.c, { onInput: (n) => { st.c = n; fromNums() }, ariaLabel: 'Coefficient c' })
  const status = h('div')
  const out = h('div', { class: 'stack' })
  let k = null
  const textOf = () => { const t = (v, s, first) => (v === 0 ? '' : `${first ? (v < 0 ? '-' : '') : v < 0 ? ' - ' : ' + '}${Math.abs(v) === 1 && s ? '' : num(Math.abs(v))}${s}`); return (t(st.a, 'x^2', true) + t(st.b, 'x', !st.a) + t(st.c, '', !st.a && !st.b) || '0') + ' = 0' }
  eq.value = textOf()
  function fromText(v) {
    try { const r = parseQuadratic(v); Object.assign(st, r); A.value = st.a; B.value = st.b; Cc.value = st.c; clear(status); paint() } catch (e) { clear(status, alert('warn', e.message)) }
  }
  function fromNums() { eq.value = textOf(); clear(status); paint() }

  async function paint() {
    k ||= await katexReady()
    save('quad:state', { a: st.a, b: st.b, c: st.c })
    const m = (t, d = false) => h('span', { html: tex(k, t, d) })
    let s
    try { s = solveQuadratic(st.a, st.b, st.c) } catch (e) { clear(out, emptyState('variable', 'Enter the coefficients', e.message)); return }
    if (s.kind === 'all') { clear(out, alert('info', 'Every x is a solution (0 = 0).')); return }
    if (s.kind === 'none') { clear(out, alert('warn', 'No solution: the equation reduces to a false statement.')); return }
    if (s.kind === 'linear') { clear(out, tile({ tint: TINTS[3], title: 'Solution', icon: 'check' }, h('div', { class: 'answer' }, m(`a=0\\text{, so it is linear: } x=${num(+s.roots[0].toPrecision(8))}`, true)), h('div', { class: 'stu-hint' }, 'With a = 0 this is not a quadratic equation.'))); return }
    const dec = s.kind === 'complex' ? `x=${num(+s.roots[0].re.toPrecision(6))}\\pm ${num(+Math.abs(s.roots[0].im).toPrecision(6))}i` : s.kind === 'one' ? `x=${num(+s.roots[0].toPrecision(8))}` : `x_1=${num(+s.roots[0].toPrecision(8))},\\; x_2=${num(+s.roots[1].toPrecision(8))}`
    const exactTex = s.exact ? (s.exact.rational ? (s.roots.length === 1 ? `x=${s.exact.roots[0]}` : `x_1=${s.exact.roots[0]},\\; x_2=${s.exact.roots[1]}`) : s.exact.tex) : null
    const rootsOnly = s.kind === 'complex' ? [] : s.roots
    const factor = s.kind !== 'complex' && s.exact?.rational ? `${st.a === 1 ? '' : num(st.a)}${s.roots.map((r) => `(x${r === 0 ? '' : r < 0 ? '+' + num(-r) : '-' + num(r)})`).join('')}` : null
    const vtx = s.vertex
    clear(out,
      tile({ tint: s.kind === 'complex' ? TINTS[6] : TINTS[3], title: 'Solution', icon: 'check', actions: pill(s.kind === 'two' ? 'Two real roots' : s.kind === 'one' ? 'One repeated root' : 'Complex roots', s.kind === 'complex' ? 'warn' : 'ok') },
        h('div', { class: 'stack' }, h('div', { class: 'answer' }, m(exactTex || dec, true)), exactTex && !s.exact.rational || (s.kind !== 'one' && s.kind !== 'two') ? h('div', { class: 'answer', style: 'font-size:17px;color:var(--text-2)' }, m(dec, true)) : null,
          h('div', { class: 'row' }, button('Copy roots', { size: 'sm', icon: 'copy', onClick: () => copyText(dec.replace(/\\pm/g, '+-').replace(/[\\{}]/g, '').replace(/;/g, ',')) })))),
      tile({ tint: TINTS[4], title: 'Step by step', icon: 'list-ordered' }, h('div', steps(s).map(([t, f], i) => h('div', { class: 'step', style: { '--i': i } }, h('span', { class: 'n' }, i + 1), h('div', null, h('div', { class: 't' }, t), h('div', { class: 'm' }, m(f, true))))))),
      tile({ tint: TINTS[2], title: 'More about this parabola', icon: 'chart-spline' }, h('div', { class: 'stack' }, plot(s),
        h('div', { class: 'row' }, pill(`Vertex (${+vtx.x.toFixed(4)}, ${+vtx.y.toFixed(4)})`, '', 'target'), pill(`Axis x = ${+vtx.x.toFixed(4)}`), pill(`y-intercept ${num(st.c)}`), pill(st.a > 0 ? 'Opens upward' : 'Opens downward')),
        h('div', { class: 'stack', style: 'gap:2px' }, h('div', { class: 'm' }, m(`y=${num(st.a)}\\left(x-${paren(+vtx.x.toPrecision(8))}\\right)^{2}${vtx.y < 0 ? '-' : '+'}${num(Math.abs(+vtx.y.toPrecision(8)))}`.replace('--', '+').replace('-(-', '+(').replace(/\^\{2\}([+-])0$/, '^{2}'), true)), factor ? h('div', { class: 'm' }, m(`${num(st.a)}x^{2}${st.b < 0 ? '' : '+'}${num(st.b)}x${st.c < 0 ? '' : '+'}${num(st.c)}=${factor}`.replace(/^1x/, 'x').replace(/\+0x/, '').replace(/\+0=/, '='), true)) : null))))
  }
  const chips = h('div', { class: 'chips' }, EX.map((e) => h('button', { type: 'button', class: 'stu-chip-btn', onclick: () => { eq.value = e; fromText(e) } }, e)))
  root.append(stage('t-quad', h('div', { class: 'stu-bento' },
    h('div', { class: 's5', style: 'min-width:0' }, tile({ tint: TINTS[5], title: 'Your equation', icon: 'variable' }, h('div', { class: 'stack' }, field('Type the equation', eq), status, h('div', { class: 'stu-hint' }, 'or enter the coefficients of ax² + bx + c = 0'), h('div', { class: 'abc' }, field('a', A), field('b', B), field('c', Cc)), h('div', { class: 'stu-hint' }, 'Try an example:'), chips))),
    h('div', { class: 's7', style: 'min-width:0' }, out))))
  paint()
}
