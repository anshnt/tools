// Secure random numbers (range, unique, sorted, decimals) plus animated dice and coin shortcuts. Uses crypto.getRandomValues only.
import { h, icon, field, number, select, segmented, button, panel, stats, tabs, alert, formatNumber, clear } from '../../lib/ui.js'
import { useStyles, copyBtn, chip, randBelow, shuffle, reducedMotion, burst, countUp, load, save } from './_shared.js'

/**
 * Random numbers on a grid. decimals = 0 gives integers in [min, max]; decimals = 2 gives multiples of 0.01.
 * Throws a readable Error for impossible requests (e.g. unique count larger than the range).
 */
export function randomNumbers({ min, max, count, decimals = 0, unique = false, sort = 'none' }) {
  if (![min, max, count].every(Number.isFinite)) throw new Error('Enter a minimum, a maximum and how many numbers you want.')
  if (min > max) throw new Error('The minimum cannot be bigger than the maximum.')
  if (count < 1 || count > 10000 || !Number.isInteger(count)) throw new Error('Ask for between 1 and 10,000 numbers.')
  const scale = 10 ** decimals
  const lo = Math.ceil(min * scale - 1e-9)
  const hi = Math.floor(max * scale + 1e-9)
  const size = hi - lo + 1
  if (!(size >= 1)) throw new Error('There is no number between your minimum and maximum with that many decimals.')
  if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || size > 2 ** 53) throw new Error('That range is too large. Use numbers below 9 quadrillion.')
  if (unique && count > size) throw new Error(`You asked for ${count.toLocaleString()} different numbers, but the range only holds ${size.toLocaleString()}.`)
  let picks
  if (!unique) picks = Array.from({ length: count }, () => lo + randBelow(size))
  else if (size <= 2_000_000 && count * 3 > size) {
    const all = Array.from({ length: size }, (_, i) => lo + i)
    for (let i = 0; i < count; i++) { const j = i + randBelow(size - i); [all[i], all[j]] = [all[j], all[i]] }
    picks = all.slice(0, count)
  } else {
    const seen = new Set()
    while (seen.size < count) seen.add(lo + randBelow(size))
    picks = [...seen]
  }
  if (sort === 'asc') picks.sort((a, b) => a - b)
  else if (sort === 'desc') picks.sort((a, b) => b - a)
  return picks.map((n) => n / scale)
}

const fmtNum = (n, decimals) => n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: false })

const CSS = `
.sx-nums{display:flex;flex-wrap:wrap;gap:9px;align-content:flex-start}
.sx-num{min-width:58px;padding:9px 16px;border-radius:16px;text-align:center;font-family:var(--mono);font-size:clamp(18px,3vw,26px);font-weight:600;letter-spacing:-.01em;
  background:linear-gradient(155deg,color-mix(in srgb,var(--accent) 11%,var(--surface)),var(--surface));border:1px solid color-mix(in srgb,var(--accent) 22%,var(--border));box-shadow:var(--shadow-sm);
  animation:sx-popnum .5s var(--spring) both;animation-delay:calc(min(var(--i),40)*28ms)}
.sx-nums.big .sx-num{font-size:clamp(34px,6vw,64px);padding:16px 28px;border-radius:24px}
@keyframes sx-popnum{from{opacity:0;transform:scale(.4) rotate(-8deg)}}
.sx-stage{position:relative;overflow:hidden;border-radius:24px;padding:22px;border:1px solid var(--border);min-height:180px;
  background:radial-gradient(520px 200px at 50% 0%,color-mix(in srgb,var(--accent) 13%,transparent),transparent 70%),var(--surface);box-shadow:var(--shadow-sm)}
.sx-dice{display:flex;flex-wrap:wrap;gap:16px;justify-content:center;perspective:800px;min-height:96px;align-items:center}
.sx-die{position:relative;width:78px;height:78px;border-radius:20px;display:grid;place-items:center;color:#fff;
  background:linear-gradient(145deg,var(--accent),var(--accent-2));box-shadow:0 14px 26px -14px var(--accent),inset 0 2px 0 rgba(255,255,255,.35),inset 0 -6px 12px rgba(0,0,0,.18)}
.sx-die b{font-size:30px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.03em;text-shadow:0 2px 6px rgba(0,0,0,.25)}
.sx-die small{position:absolute;bottom:5px;right:9px;font-size:9.5px;opacity:.7;font-family:var(--mono)}
.sx-die.d6{background:linear-gradient(145deg,#fff,#eceaf8);color:#1d1b3a}
:root[data-theme="dark"] .sx-die.d6{background:linear-gradient(145deg,#f1efff,#c9c4f5)}
.sx-die.d6 .pips{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);width:58px;height:58px;padding:2px}
.sx-die.d6 .pips i{width:11px;height:11px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#6a5cf6,#2b1f9e);align-self:center;justify-self:center;box-shadow:0 1px 2px rgba(0,0,0,.4)}
.sx-die.rolling{animation:sx-tumble .42s ease-in-out infinite}
.sx-die.landed{animation:sx-land .55s var(--spring)}
@keyframes sx-tumble{0%{transform:rotate(0) translateY(0)}25%{transform:rotate(90deg) translateY(-14px) scale(.94)}50%{transform:rotate(180deg) translateY(0)}75%{transform:rotate(270deg) translateY(-10px) scale(.96)}100%{transform:rotate(360deg) translateY(0)}}
@keyframes sx-land{0%{transform:scale(1.25) rotate(-8deg)}60%{transform:scale(.94) rotate(2deg)}}
.sx-total{display:flex;align-items:baseline;gap:12px;justify-content:center;margin-top:18px;flex-wrap:wrap}
.sx-total b{font-size:clamp(40px,8vw,68px);font-weight:700;letter-spacing:-.05em;line-height:1;background:var(--brand);-webkit-background-clip:text;background-clip:text;color:transparent;font-variant-numeric:tabular-nums}
.sx-total span{color:var(--muted);font-size:14px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;max-width:100%}
.sx-coinwrap{display:grid;place-items:center;perspective:900px;min-height:170px}
.sx-coin{position:relative;width:130px;height:130px;transform-style:preserve-3d;transition:transform 1.25s cubic-bezier(.2,.7,.2,1)}
.sx-coin .face{position:absolute;inset:0;border-radius:50%;display:grid;place-items:center;backface-visibility:hidden;-webkit-backface-visibility:hidden;font-weight:800;font-size:46px;color:#5a3a00;
  background:radial-gradient(circle at 32% 28%,#fff3b8,#f7c948 45%,#d99a14 100%);box-shadow:inset 0 0 0 6px rgba(255,255,255,.25),inset 0 0 0 9px rgba(120,70,0,.22),0 18px 30px -16px rgba(120,70,0,.7)}
.sx-coin .face.t{transform:rotateY(180deg);background:radial-gradient(circle at 32% 28%,#f4f6fb,#c3cad8 45%,#8e97aa 100%);color:#2f3647;box-shadow:inset 0 0 0 6px rgba(255,255,255,.3),inset 0 0 0 9px rgba(40,50,70,.2),0 18px 30px -16px rgba(30,40,60,.7)}
.sx-coin .face small{position:absolute;bottom:20px;font-size:11px;letter-spacing:.18em;font-weight:700;opacity:.65}
.sx-coin .face .icon{position:absolute;top:19px;width:22px;height:22px;opacity:.7}
.sx-tally{display:grid;gap:8px;max-width:560px;margin:14px auto 0}
.sx-tally .bar{display:flex;height:16px;border-radius:99px;overflow:hidden;background:var(--surface-3)}
.sx-tally .bar i{display:block;height:100%;transition:width .7s var(--ease)}
.sx-tally .h{background:linear-gradient(90deg,#f7c948,#d99a14)}.sx-tally .t{background:linear-gradient(90deg,#c3cad8,#8e97aa)}
.sx-tally .lab{display:flex;justify-content:space-between;font-size:13.5px;font-variant-numeric:tabular-nums}
.sx-dots{display:flex;flex-wrap:wrap;gap:4px;justify-content:center;margin-top:12px}
.sx-dots i{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font-style:normal;font-size:10px;font-weight:800;animation:sx-popnum .4s var(--spring) both;animation-delay:calc(min(var(--i),60)*10ms)}
.sx-dots i.h{background:#f7c948;color:#5a3a00}.sx-dots i.t{background:#c3cad8;color:#2f3647}
.sx-hist{display:flex;gap:6px;flex-wrap:wrap}
.sx-hist span{padding:3px 10px;border-radius:99px;background:var(--surface-2);font-family:var(--mono);font-size:12.5px;border:1px solid var(--border)}
@media (max-width:560px){.sx-die{width:64px;height:64px;border-radius:17px}.sx-die b{font-size:25px}.sx-die.d6 .pips{width:46px;height:46px}.sx-die.d6 .pips i{width:9px;height:9px}.sx-coin{width:112px;height:112px}}
`

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }
const dieFace = (faces, v, rolling) => {
  const el = h('div', { class: ['sx-die', `d${faces}`, rolling && 'rolling'], role: 'img', 'aria-label': `d${faces}: ${v}` })
  setDie(el, faces, v)
  return el
}
function setDie(el, faces, v) {
  if (faces === 6) el.replaceChildren(h('div', { class: 'pips', 'aria-hidden': 'true' }, Array.from({ length: 9 }, (_, i) => (PIPS[v].includes(i) ? h('i', { style: { gridArea: `${Math.floor(i / 3) + 1} / ${(i % 3) + 1}` } }) : h('span')))))
  else el.replaceChildren(h('b', v), h('small', `d${faces}`))
  el.setAttribute('aria-label', `d${faces}: ${v}`)
}

export function mount(root) {
  useStyles('sx-random-number', CSS)
  const timers = new Set()
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn() }, ms); timers.add(t); return t }

  // ---------- Numbers ----------
  function numbersView() {
    const s = { min: 1, max: 100, count: 5, mode: 'int', decimals: 2, unique: true, sort: 'none', sep: ', ', ...load('random-number:opts', {}) }
    const out = h('div')
    const warn = h('div')
    const statsHost = h('div')
    let last = []
    const min = number(s.min, { ariaLabel: 'From', onInput: (n) => { s.min = n; run() } })
    const max = number(s.max, { ariaLabel: 'To (inclusive)', onInput: (n) => { s.max = n; run() } })
    const count = number(s.count, { min: 1, max: 10000, step: 1, ariaLabel: 'How many', onInput: (n) => { s.count = n; run() } })
    const decimals = number(s.decimals, { min: 1, max: 8, step: 1, ariaLabel: 'Decimal places', onInput: (n) => { s.decimals = Math.min(8, Math.max(1, Math.round(n) || 1)); run() } })
    const mode = segmented([['int', 'Whole numbers'], ['dec', 'Decimals']], s.mode, (v) => { s.mode = v; sync(); run(true) }, 'Number type')
    const sort = segmented([['none', 'As drawn'], ['asc', 'Low to high'], ['desc', 'High to low']], s.sort, (v) => { s.sort = v; run() }, 'Sort order')
    const unique = chip('No repeats', s.unique, (v) => { s.unique = v; run(true) }, { title: 'Every number appears at most once' })
    const sep = select([[', ', 'Comma'], ['\n', 'New line'], [' ', 'Space'], ['; ', 'Semicolon'], ['\t', 'Tab']], s.sep, (v) => { s.sep = v })
    const decField = field('Decimal places', decimals)
    function sync() { decField.hidden = s.mode !== 'dec' }
    function run(animate = true) {
      save('random-number:opts', s)
      warn.replaceChildren()
      try {
        const d = s.mode === 'dec' ? s.decimals : 0
        last = randomNumbers({ min: s.min, max: s.max, count: s.count, decimals: d, unique: s.unique, sort: s.sort })
        const shown = last.slice(0, 300)
        const nums = h('div', { class: ['sx-nums', last.length <= 3 && 'big'], 'aria-live': 'polite' },
          shown.map((n, i) => h('div', { class: 'sx-num', style: { '--i': animate ? i : 0, animation: animate ? null : 'none' } }, fmtNum(n, d))))
        clear(out, nums, last.length > 300 ? h('div', { class: 'sx-hint', style: 'margin-top:10px' }, `Showing the first 300 of ${last.length.toLocaleString()}. Copy includes all of them.`) : null)
        const sum = last.reduce((a, b) => a + b, 0)
        clear(statsHost, last.length > 1 ? stats([
          { label: 'Numbers', value: last.length.toLocaleString() },
          { label: 'Smallest', value: fmtNum(Math.min(...last), d) },
          { label: 'Largest', value: fmtNum(Math.max(...last), d) },
          { label: 'Sum', value: formatNumber(sum, d) },
          { label: 'Average', value: formatNumber(sum / last.length, Math.max(d, 2)) },
        ]) : null)
      } catch (e) {
        last = []
        out.replaceChildren(h('div', { class: 'sx-hint' }, 'No numbers yet.'))
        statsHost.replaceChildren()
        warn.replaceChildren(alert('warn', e.message))
      }
    }
    const presets = [['1 to 10', { min: 1, max: 10, count: 1, unique: false }], ['1 to 100', { min: 1, max: 100, count: 1, unique: false }], ['Lotto 6 of 49', { min: 1, max: 49, count: 6, unique: true, sort: 'asc' }],
      ['5 of 50', { min: 1, max: 50, count: 5, unique: true, sort: 'asc' }], ['Pick a winner (1 to 20)', { min: 1, max: 20, count: 1, unique: true }], ['4-digit PIN', { min: 0, max: 9999, count: 1, unique: false }]]
    const applyPreset = (p) => {
      Object.assign(s, { mode: 'int', sort: 'none' }, p)
      min.value = s.min; max.value = s.max; count.value = s.count; unique.input.checked = s.unique; sort.set(s.sort); mode.set('int'); sync(); run(true)
    }
    sync()
    const el = h('div', { class: 'stack' },
      h('div', { class: 'sx-stage' }, out),
      warn,
      h('div', { class: 'row' }, button('Draw again', { icon: 'refresh-cw', variant: 'primary', onClick: () => run(true) }), copyBtn(() => last.map((n) => fmtNum(n, s.mode === 'dec' ? s.decimals : 0)).join(s.sep), 'Copy numbers'), h('div', { style: 'width:130px' }, sep)),
      statsHost,
      h('div', { class: 'sx-presets', role: 'group', 'aria-label': 'Presets' }, presets.map(([l, p]) => h('button', { type: 'button', class: 'sx-preset', onclick: () => applyPreset(p) }, l))),
      panel(h('div', { class: 'sx-cols' },
        h('div', { class: 'stack' }, h('div', { class: 'grid-2' }, field('From', min), field('To (inclusive)', max)), field('How many', count), h('div', { class: 'stack tight' }, h('div', { class: 'field-label' }, 'Number type'), mode), decField),
        h('div', { class: 'stack' }, h('div', { class: 'stack tight' }, h('div', { class: 'field-label' }, 'Order'), sort), unique, h('div', { class: 'sx-hint' }, 'Each number is drawn with crypto.getRandomValues and rejection sampling, so every value in the range is equally likely.')))))
    run(true)
    return el
  }

  // ---------- Dice ----------
  function diceView() {
    const s = { faces: 6, n: 2, mod: 0, ...load('random-number:dice', {}) }
    const stage = h('div', { class: 'sx-dice' })
    const totalEl = h('div', { class: 'sx-total', 'aria-live': 'polite' })
    const hist = h('div', { class: 'sx-hist' })
    const history = []
    let rolling = false
    const rollBtn = button('Roll the dice', { icon: 'dices', variant: 'primary', size: 'lg' })
    const nIn = number(s.n, { min: 1, max: 20, step: 1, ariaLabel: 'How many dice', onInput: (v) => { if (v >= 1) { s.n = Math.min(20, Math.round(v)); save('random-number:dice', s); draw(Array(s.n).fill(1), true) } } })
    const modIn = number(s.mod, { step: 1, ariaLabel: 'Modifier (+ or -)', onInput: (v) => { s.mod = Number.isFinite(v) ? Math.round(v) : 0; save('random-number:dice', s) } })
    const types = h('div', { class: 'sx-chips', role: 'group', 'aria-label': 'Die type' }, [4, 6, 8, 10, 12, 20, 100].map((f) => h('button', {
      type: 'button', class: 'sx-preset', 'aria-pressed': String(f === s.faces), onclick: (e) => { s.faces = f; [...types.children].forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); save('random-number:dice', s); draw(Array(s.n).fill(1), true) },
    }, `d${f}`)))
    function draw(values, idle) {
      const dice = values.map((v) => dieFace(s.faces, Math.min(v, s.faces), false))
      stage.replaceChildren(...dice)
      if (idle) totalEl.replaceChildren(h('span', `${s.n} x d${s.faces}${s.mod ? (s.mod > 0 ? ' + ' : ' - ') + Math.abs(s.mod) : ''} - press Roll`))
      return dice
    }
    function roll() {
      if (rolling) return
      rolling = true
      const final = Array.from({ length: s.n }, () => 1 + randBelow(s.faces))
      const dice = draw(final, false)
      const done = () => {
        dice.forEach((d, i) => { d.classList.remove('rolling'); setDie(d, s.faces, final[i]); d.classList.add('landed') })
        const sum = final.reduce((a, b) => a + b, 0) + s.mod
        totalEl.replaceChildren(h('b', '0'), h('span', `${final.join(' + ')}${s.mod ? (s.mod > 0 ? ` + ${s.mod}` : ` - ${Math.abs(s.mod)}`) : ''}`))
        countUp(totalEl.firstChild, sum, (n) => String(Math.round(n)), 380)
        history.unshift(sum)
        hist.replaceChildren(...history.slice(0, 12).map((v) => h('span', String(v))))
        if (s.faces === 20 && s.n === 1 && final[0] === 20) burst(stage)
        rolling = false
      }
      if (reducedMotion()) return done()
      dice.forEach((d) => d.classList.add('rolling'))
      const flick = setInterval(() => dice.forEach((d) => setDie(d, s.faces, 1 + Math.floor(Math.random() * s.faces))), 70)
      later(() => { clearInterval(flick); done() }, 760)
      timers.add(flick)
    }
    rollBtn.addEventListener('click', roll)
    draw(Array(s.n).fill(1), true)
    return h('div', { class: 'stack' },
      h('div', { class: 'sx-stage' }, stage, totalEl),
      h('div', { class: 'row' }, rollBtn, hist),
      panel(h('div', { class: 'sx-cols' },
        h('div', { class: 'stack' }, h('div', { class: 'stack tight' }, h('div', { class: 'field-label' }, 'Die'), types)),
        h('div', { class: 'grid-2' }, field('How many dice', nIn), field('Modifier (+ or -)', modIn)))))
  }

  // ---------- Coin ----------
  function coinView() {
    const s = { n: 1, ...load('random-number:coin', {}) }
    const coin = h('div', { class: 'sx-coin', role: 'img', 'aria-label': 'Coin' }, h('div', { class: 'face h' }, icon('crown'), 'H', h('small', 'HEADS')), h('div', { class: 'face t' }, icon('feather'), 'T', h('small', 'TAILS')))
    const wrap = h('div', { class: 'sx-coinwrap' }, coin)
    const result = h('div', { class: 'sx-total', 'aria-live': 'polite' }, h('span', 'Flip the coin'))
    const tallyHost = h('div')
    let turns = 0, heads = 0, tails = 0, flipping = false
    const flipBtn = button('Flip', { icon: 'coins', variant: 'primary', size: 'lg' })
    const nSel = segmented([[1, '1 coin'], [10, '10 coins'], [100, '100 coins'], [1000, '1,000 coins']], s.n, (v) => { s.n = v; save('random-number:coin', s) }, 'Number of coins')
    function flip() {
      if (flipping) return
      flipping = true
      const n = s.n
      const flips = Array.from({ length: n }, () => randBelow(2))
      const h1 = flips.filter((f) => f === 0).length
      const first = flips[0]
      turns += 6 // three full spins, then settle on a parity: an even number of half turns shows heads
      if (turns % 2 !== first) turns += 1
      coin.style.transform = `rotateY(${turns * 180}deg)`
      const finish = () => {
        flipping = false
        heads += h1; tails += n - h1
        result.replaceChildren(h('b', n === 1 ? (first === 0 ? 'Heads' : 'Tails') : `${h1} : ${n - h1}`), h('span', n === 1 ? 'The coin has spoken' : `${h1} heads, ${n - h1} tails`))
        if (n === 1) burst(coin)
        const total = heads + tails
        clear(tallyHost, h('div', { class: 'sx-tally' },
          h('div', { class: 'bar', role: 'img', 'aria-label': `${heads} heads and ${tails} tails so far` }, h('i', { class: 'h', style: { width: `${(heads / total) * 100}%` } }), h('i', { class: 't', style: { width: `${(tails / total) * 100}%` } })),
          h('div', { class: 'lab' }, h('span', `Heads ${heads.toLocaleString()} (${((heads / total) * 100).toFixed(1)}%)`), h('span', `Tails ${tails.toLocaleString()} (${((tails / total) * 100).toFixed(1)}%)`))),
        n > 1 && n <= 100 ? h('div', { class: 'sx-dots', 'aria-hidden': 'true' }, flips.map((f, i) => h('i', { class: f === 0 ? 'h' : 't', style: { '--i': i } }, f === 0 ? 'H' : 'T'))) : null)
      }
      if (reducedMotion()) { coin.style.transition = 'none'; finish() } else later(finish, 1250)
    }
    flipBtn.addEventListener('click', flip)
    return h('div', { class: 'stack' },
      h('div', { class: 'sx-stage' }, wrap, result, tallyHost),
      h('div', { class: 'row' }, flipBtn, nSel, button('Reset tally', { icon: 'rotate-ccw', variant: 'ghost', size: 'sm', onClick: () => { heads = 0; tails = 0; tallyHost.replaceChildren(); result.replaceChildren(h('span', 'Flip the coin')) } })),
      h('div', { class: 'sx-hint' }, 'Each flip is one random bit from crypto.getRandomValues. The tally is kept only while this page is open.'))
  }

  root.append(h('div', { class: 'sx stack' }, tabs([
    { id: 'numbers', label: 'Numbers', render: numbersView },
    { id: 'dice', label: 'Dice', render: diceView },
    { id: 'coin', label: 'Coin', render: coinView },
  ], 'numbers')))
  return () => { for (const t of timers) { clearTimeout(t); clearInterval(t) } timers.clear() }
}
