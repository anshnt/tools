// Random picker: spin wheel (canvas, smooth physics, confetti), pick N names without repeats or split into teams,
// coin flip and dice roller. All randomness comes from crypto.getRandomValues.
import { h, icon, button, input, field, textarea, segmented, toggle, toast, clear, copyText } from '../../lib/ui.js'
import { app, css, makeStore, rand, randFloat, shuffle, tone, audio, confetti, chip, ib, stat, emptyState, reduceMotion, PALETTE, plural, clamp, sum } from './_shared.js'

const SAMPLE = ['Pizza', 'Biryani', 'Sushi', 'Tacos', 'Burgers', 'Pasta', 'Dosa', 'Thai curry']
const SIDES = [4, 6, 8, 10, 12, 20, 100]
export const parseItems = (text) => text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)

/** Index of the wheel slice under a pointer at the top, for a wheel rotated by `rot` radians (slice 0 starts at 3 o'clock). */
export function winnerIndex(rot, n) {
  const a = (2 * Math.PI) / n
  const at = (((-Math.PI / 2 - rot) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  return Math.min(n - 1, Math.floor(at / a))
}
/** Pick `k` distinct entries uniformly. */
export const pickN = (items, k) => shuffle(items).slice(0, clamp(k, 0, items.length))
/** Deal shuffled items into `k` teams as evenly as possible. */
export function teams(items, k) {
  const out = Array.from({ length: k }, () => [])
  shuffle(items).forEach((x, i) => out[i % k].push(x))
  return out
}
/** Roll `count` dice with `sides` faces. */
export const rollDice = (count, sides) => Array.from({ length: count }, () => 1 + rand(sides))

const CSS = `
.t-picker .tabs-bar{display:flex;gap:8px;flex-wrap:wrap}
.t-picker .wheelbox{position:relative;width:min(100%,460px);margin:0 auto;aspect-ratio:1}
.t-picker .wheelbox canvas{width:100%;height:100%;display:block;cursor:pointer;touch-action:manipulation;border-radius:50%;filter:drop-shadow(0 10px 24px rgba(0,0,0,.18))}
.t-picker .pointer{position:absolute;left:50%;top:-6px;width:0;height:0;transform:translateX(-50%);border-left:15px solid transparent;border-right:15px solid transparent;border-top:30px solid var(--text);filter:drop-shadow(0 3px 3px rgba(0,0,0,.3));z-index:2;pointer-events:none}
.t-picker .winner{display:grid;gap:4px;justify-items:center;text-align:center;padding:14px;border-radius:20px;background:color-mix(in srgb,var(--tc) 12%,var(--surface));border:1px solid color-mix(in srgb,var(--tc) 28%,var(--border));min-height:84px;align-content:center}
.t-picker .winner b{font-size:clamp(24px,6vw,34px);letter-spacing:-.03em;overflow-wrap:anywhere}
.t-picker .winner.pop{animation:pz-pop .55s var(--spring)}
.t-picker .names{display:flex;flex-wrap:wrap;gap:10px}
.t-picker .nm{padding:10px 16px;border-radius:14px;background:var(--surface);border:1px solid var(--border);font-weight:600;animation:pz-rise .4s var(--ease) both;animation-delay:calc(var(--i,0)*90ms)}
.t-picker .nm small{color:var(--muted);font-weight:500;margin-right:6px}
.t-picker .team{flex:1 1 180px;min-width:0}
.t-picker .team h3{margin:0 0 8px;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
.t-picker .coins{display:flex;flex-wrap:wrap;gap:18px;justify-content:center;perspective:700px;padding:10px 0}
.t-picker .coin{width:var(--cs,120px);height:var(--cs,120px);position:relative;transform-style:preserve-3d;transition:transform 1.3s cubic-bezier(.2,.7,.2,1)}
.t-picker .coin span{position:absolute;inset:0;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:calc(var(--cs,120px)*.2);backface-visibility:hidden;-webkit-backface-visibility:hidden;border:4px solid rgba(0,0,0,.12);box-shadow:inset 0 0 0 5px rgba(255,255,255,.35),0 6px 16px rgba(0,0,0,.18)}
.t-picker .coin .hd{background:linear-gradient(145deg,#fde68a,#f59e0b);color:#7c4a03}
.t-picker .coin .tl{background:linear-gradient(145deg,#e5e7eb,#9ca3af);color:#374151;transform:rotateY(180deg)}
.t-picker .die{--ds:68px;width:var(--ds);height:var(--ds);border-radius:18px;background:var(--surface);border:2px solid var(--border-strong);display:grid;place-items:center;font-size:26px;font-weight:750;font-variant-numeric:tabular-nums;box-shadow:0 4px 0 var(--border),var(--shadow-sm);position:relative}
.t-picker .die.rolling{animation:pk-shake .5s linear infinite}
.t-picker .die.max{border-color:var(--success);color:var(--success)}.t-picker .die.min{border-color:var(--danger);color:var(--danger)}
.t-picker .pips{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);width:70%;height:70%;gap:2px}
.t-picker .pips i{border-radius:50%;background:var(--text)}
.t-picker .dice{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;padding:10px 0}
.t-picker .hist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;font-size:13.5px;color:var(--text-2)}
.t-picker .hist li{padding:7px 10px;border-radius:10px;background:var(--surface-2);overflow-wrap:anywhere}
@keyframes pk-shake{0%{transform:rotate(0)}25%{transform:rotate(-12deg) translateY(-4px)}75%{transform:rotate(12deg) translateY(-4px)}100%{transform:rotate(0)}}
@media (prefers-reduced-motion:reduce){.t-picker .coin{transition:none}.t-picker .die.rolling{animation:none}}
`

export function mount(root) {
  const el = app(root, 'picker', '#a855f7')
  css('t-picker', CSS)
  const store = makeStore('picker', { tab: 'wheel', items: SAMPLE.join('\n'), remove: false, sound: true, hist: [], coins: 1, flips: { h: 0, t: 0 }, sides: 6, count: 2, mod: 0, rolls: [], pick: 1, mode: 'pick', teams: 2 })
  const S = store.get()
  const items = () => parseItems(S.items)
  const sec = h('div', { class: 'stack' })
  const bar = h('div', { class: 'tabs-bar', role: 'group', 'aria-label': 'Picker type' })
  const TABS = [['wheel', 'Spin wheel', 'circle-dot'], ['names', 'Pick names', 'users'], ['coin', 'Coin flip', 'coins'], ['dice', 'Dice', 'dices']]
  const cleanups = []
  const timers = new Set()
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn() }, ms); timers.add(t); return t }
  let rafId = 0

  function show(tab) {
    S.tab = tab; store.save()
    cancelAnimationFrame(rafId); rafId = 0
    cleanups.splice(0).forEach((f) => f())
    clear(bar, TABS.map(([id, l, ic]) => chip(l, { ic, pressed: id === tab, onClick: () => show(id) })))
    clear(sec, { wheel: wheelTab, names: namesTab, coin: coinTab, dice: diceTab }[tab]())
  }

  // ---------------------------------------------------------------- shared list card
  function listCard(onChange, title = 'Your list') {
    const ta = textarea({ rows: 8, value: S.items, placeholder: 'One option per line', 'aria-label': 'Options, one per line', oninput: () => { S.items = ta.value; store.save(); cnt.textContent = plural(items().length, 'option'); onChange?.() } })
    const cnt = h('span', { class: 'pz-note' }, plural(items().length, 'option'))
    const set = (arr) => { ta.value = arr.join('\n'); S.items = ta.value; store.save(); cnt.textContent = plural(items().length, 'option'); onChange?.() }
    const card = h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('list'), h('span', { class: 'grow' }, title), cnt),
      h('div', { class: 'stack' }, ta, h('div', { class: 'pz-chips' },
        button('Shuffle', { icon: 'shuffle', size: 'sm', onClick: () => set(shuffle(items())) }),
        button('Sort A-Z', { icon: 'arrow-down-a-z', size: 'sm', onClick: () => set(items().sort((a, b) => a.localeCompare(b))) }),
        button('1 to 10', { size: 'sm', onClick: () => set(Array.from({ length: 10 }, (_, i) => String(i + 1))) }),
        button('Sample', { size: 'sm', onClick: () => set(SAMPLE) }),
        button('Clear', { icon: 'trash-2', size: 'sm', variant: 'ghost', onClick: () => set([]) }))))
    card.set = set
    return card
  }

  // ---------------------------------------------------------------- wheel
  function wheelTab() {
    const cv = h('canvas', { role: 'img', 'aria-label': 'Spin wheel. Press the spin button.' })
    const box = h('div', { class: 'wheelbox' }, h('div', { class: 'pointer' }), cv)
    const winner = h('div', { class: 'winner', 'aria-live': 'polite' }, h('span', { class: 'pz-note' }, 'Ready to spin'))
    let rot = Math.random() * Math.PI * 2, spinning = false
    const ctx = cv.getContext('2d')
    const size = () => { const r = box.getBoundingClientRect(); const d = Math.min(devicePixelRatio || 1, 2); const px = Math.max(200, Math.round(r.width * d)); if (cv.width !== px) { cv.width = px; cv.height = px } return px }
    function draw() {
      const px = size(), c = px / 2, R = c - 6
      const list = items()
      ctx.clearRect(0, 0, px, px)
      const cs = getComputedStyle(document.documentElement)
      if (list.length < 2) {
        ctx.fillStyle = cs.getPropertyValue('--surface-2') || '#eee'; ctx.beginPath(); ctx.arc(c, c, R, 0, 7); ctx.fill()
        ctx.fillStyle = cs.getPropertyValue('--muted') || '#888'; ctx.font = `600 ${px / 24}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('Add at least 2 options', c, c); return
      }
      const a = (2 * Math.PI) / list.length
      list.forEach((t, i) => {
        const col = PALETTE[i % PALETTE.length]
        ctx.beginPath(); ctx.moveTo(c, c); ctx.arc(c, c, R, rot + i * a, rot + (i + 1) * a); ctx.closePath()
        ctx.fillStyle = col; ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,.65)'; ctx.lineWidth = Math.max(1.5, px / 260); ctx.stroke()
        ctx.save(); ctx.translate(c, c); ctx.rotate(rot + (i + 0.5) * a)
        const fs = clamp(Math.min(px / 17, (R * a) / 1.9), px / 46, px / 17)
        ctx.font = `650 ${fs}px sans-serif`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'
        ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 3
        let s = t; const maxW = R * 0.66
        while (s.length > 1 && ctx.measureText(s).width > maxW) s = s.slice(0, -1)
        ctx.fillText(s === t ? s : s.trimEnd() + '...', R - px / 30, 0)
        ctx.restore()
      })
      ctx.beginPath(); ctx.arc(c, c, px / 15, 0, 7); ctx.fillStyle = cs.getPropertyValue('--surface') || '#fff'; ctx.fill()
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.stroke()
      ctx.fillStyle = cs.getPropertyValue('--text') || '#000'; ctx.font = `700 ${px / 36}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('SPIN', c, c)
    }
    const spinBtn = button('Spin the wheel', { icon: 'rotate-cw', variant: 'primary', size: 'lg', onClick: spin })
    function finish(i) {
      spinning = false; spinBtn.disabled = false
      const list = items(), w = list[i]
      clear(winner, h('span', { class: 'pz-note' }, 'The wheel says'), h('b', w))
      winner.classList.remove('pop'); void winner.offsetWidth; winner.classList.add('pop')
      const r = cv.getBoundingClientRect(); confetti({ x: r.left + r.width / 2, y: r.top + r.height / 3, count: 110 })
      if (S.sound) [523, 659, 784, 1047].forEach((f, k) => tone(f, { at: k * 0.1, dur: 0.25, gain: 0.15 }))
      S.hist.unshift({ w, t: Date.now() }); S.hist = S.hist.slice(0, 12)
      if (S.remove) later(() => { const l = items(); l.splice(i, 1); listEl.set(l); draw(); toast(`Removed "${w}" from the wheel`) }, 1500)
      store.save(); renderHist()
    }
    function spin() {
      if (spinning) return
      const list = items()
      if (list.length < 2) { toast('Add at least two options first', 'error'); return }
      audio()
      spinning = true; spinBtn.disabled = true
      const n = list.length, a = (2 * Math.PI) / n
      if (reduceMotion()) { rot = randFloat() * Math.PI * 2; draw(); finish(winnerIndex(rot, n)); return }
      let w = 14 + randFloat() * 10 // rad/s
      const k = 0.85 // exponential drag: total travel is w / k, about 3 to 4.5 turns, over 6 to 7 seconds
      let last = performance.now(), lastSlice = winnerIndex(rot, n)
      const step = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000); last = now
        rot += w * dt; w *= Math.exp(-k * dt)
        const idx = winnerIndex(rot, n)
        if (idx !== lastSlice) { lastSlice = idx; if (S.sound && w > 0.6) tone(700 + 120 * Math.min(6, w / 3), { dur: 0.03, type: 'triangle', gain: 0.07 }) }
        draw()
        if (w > 0.08) rafId = requestAnimationFrame(step)
        else { rafId = 0; finish(idx) }
      }
      rafId = requestAnimationFrame(step)
    }
    cv.addEventListener('click', spin)
    const histHost = h('div')
    function renderHist() {
      clear(histHost, S.hist.length ? h('ul', { class: 'hist' }, S.hist.map((x) => h('li', x.w))) : h('p', { class: 'pz-note' }, 'Past results show up here.'))
    }
    const listEl = listCard(() => { if (!spinning) draw() }, 'Wheel options')
    const ro = new ResizeObserver(() => draw()); ro.observe(box); cleanups.push(() => ro.disconnect())
    const mo = new MutationObserver(draw); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); cleanups.push(() => mo.disconnect())
    renderHist()
    later(draw, 30)
    return h('div', { class: 'pz-cols' },
      h('section', { class: 'pz-card' }, h('div', { class: 'stack' }, box, h('div', { class: 'pz-row', style: 'justify-content:center' }, spinBtn), winner)),
      h('div', { class: 'stack' }, listEl,
        h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('history'), h('span', { class: 'grow' }, 'History'), ib('trash-2', 'Clear history', () => { S.hist = []; store.save(); renderHist() }, 'danger')),
          h('div', { class: 'stack' }, histHost, toggle('Remove the winner after each spin', S.remove, (v) => { S.remove = v; store.save() }), toggle('Tick and fanfare sounds', S.sound, (v) => { S.sound = v; store.save() })))))
  }

  // ---------------------------------------------------------------- pick names / teams
  function namesTab() {
    const out = h('div', { class: 'stack', 'aria-live': 'polite' }, emptyState('Nothing picked yet', 'Choose how many names to draw, then press Pick.', 'users'))
    const listEl = listCard()
    const kIn = input({ type: 'number', min: 1, max: 200, value: S.pick, 'aria-label': 'How many to pick', style: 'width:96px', oninput: () => { S.pick = kIn.valueAsNumber || 1; store.save() } })
    const tIn = input({ type: 'number', min: 2, max: 50, value: S.teams, 'aria-label': 'Number of teams', style: 'width:96px', oninput: () => { S.teams = tIn.valueAsNumber || 2; store.save() } })
    const mode = segmented([['pick', 'Pick names'], ['teams', 'Make teams']], S.mode, (v) => { S.mode = v; store.save(); sync() }, 'Mode')
    const pickRow = h('div', { class: 'pz-row' }, field('How many names', kIn), button('Pick', { icon: 'sparkles', variant: 'primary', onClick: doPick }))
    const teamRow = h('div', { class: 'pz-row' }, field('Number of teams', tIn), button('Make teams', { icon: 'users', variant: 'primary', onClick: doTeams }))
    const sync = () => { pickRow.hidden = S.mode !== 'pick'; teamRow.hidden = S.mode !== 'teams' }
    let lastText = ''
    function doPick() {
      const l = items(), k = clamp(Math.floor(S.pick) || 1, 1, 200)
      if (!l.length) { toast('Add some names first', 'error'); return }
      if (k > l.length) toast(`Only ${plural(l.length, 'name')} available, so all of them are picked`)
      const picked = pickN(l, k)
      lastText = picked.map((x, i) => `${i + 1}. ${x}`).join('\n')
      clear(out, h('div', { class: 'names' }, picked.map((x, i) => h('div', { class: 'nm', style: { '--i': i } }, h('small', `#${i + 1}`), x))), h('div', { class: 'pz-row' }, copyBtn()))
      if (picked.length) confetti({ x: innerWidth / 2, y: innerHeight / 3, count: 60, power: 0.8 })
      if (S.sound) tone(784, { dur: 0.2, gain: 0.12 })
    }
    function doTeams() {
      const l = items(), k = clamp(Math.floor(S.teams) || 2, 2, 50)
      if (l.length < 2) { toast('Add at least two names first', 'error'); return }
      const t = teams(l, Math.min(k, l.length))
      lastText = t.map((m, i) => `Team ${i + 1}: ${m.join(', ')}`).join('\n')
      clear(out, h('div', { class: 'names' }, t.map((m, i) => h('div', { class: 'pz-card team pz-pop-in', style: { '--i': i } }, h('h3', `Team ${i + 1} (${m.length})`), h('div', { class: 'stack', style: 'gap:6px' }, m.map((x) => h('div', x)))))), h('div', { class: 'pz-row' }, copyBtn()))
    }
    const copyBtn = () => button('Copy result', { icon: 'copy', size: 'sm', onClick: () => copyText(lastText) })
    sync()
    return h('div', { class: 'pz-cols' }, listEl, h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('wand-sparkles'), 'Draw'), h('div', { class: 'stack' }, mode, pickRow, teamRow, out)))
  }

  // ---------------------------------------------------------------- coin
  function coinTab() {
    const coinsHost = h('div', { class: 'coins', 'aria-live': 'polite' })
    const info = h('div', { class: 'pz-bento' })
    const nIn = segmented([[1, '1 coin'], [2, '2'], [5, '5'], [10, '10']], S.coins, (v) => { S.coins = Number(v); store.save(); build() }, 'Number of coins')
    const turns = []
    let flipping = false
    function build() {
      turns.length = 0
      const size = S.coins === 1 ? 140 : S.coins <= 2 ? 110 : S.coins <= 5 ? 76 : 56
      clear(coinsHost, Array.from({ length: S.coins }, () => { const c = h('div', { class: 'coin', style: { '--cs': `${size}px` } }, h('span', { class: 'hd' }, 'H'), h('span', { class: 'tl' }, 'T')); turns.push(0); return c }))
      renderInfo()
    }
    function renderInfo(msg) {
      const t = S.flips.h + S.flips.t
      clear(info, stat({ label: 'Heads', value: String(S.flips.h), hint: t ? `${Math.round((S.flips.h / t) * 100)}%` : '', tone: 'warn' }), stat({ label: 'Tails', value: String(S.flips.t), hint: t ? `${Math.round((S.flips.t / t) * 100)}%` : '', tone: 'info' }), stat({ label: 'Last flip', value: msg || '-' }))
    }
    function flip() {
      if (flipping) return
      flipping = true; audio()
      const res = turns.map(() => rand(2))
      const coins = [...coinsHost.children]
      coins.forEach((c, i) => {
        turns[i] += 4 + rand(3) // full turns, always even so the face is decided by the extra half turn below
        const base = Math.ceil(turns[i] / 2) * 2
        turns[i] = base
        c.style.transitionDelay = `${i * 60}ms`
        c.style.transform = `rotateY(${(base * 180) + (res[i] ? 180 : 0)}deg)`
        if (reduceMotion()) c.style.transition = 'none'
      })
      const h2 = res.filter((x) => x === 0).length, t2 = res.length - h2
      later(() => {
        S.flips.h += h2; S.flips.t += t2; store.save()
        renderInfo(res.length === 1 ? (h2 ? 'Heads' : 'Tails') : `${h2}H ${t2}T`)
        if (S.sound) tone(res.length === 1 && h2 ? 880 : 660, { dur: 0.15, gain: 0.12 })
        flipping = false
      }, reduceMotion() ? 0 : 1300 + coins.length * 60)
    }
    build()
    return h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('coins'), 'Flip a coin'),
      h('div', { class: 'stack' }, h('div', { class: 'pz-row', style: 'justify-content:center' }, nIn), coinsHost, h('div', { class: 'pz-row', style: 'justify-content:center' }, button('Flip', { icon: 'coins', variant: 'primary', size: 'lg', onClick: flip }), button('Reset counts', { variant: 'ghost', onClick: () => { S.flips = { h: 0, t: 0 }; store.save(); renderInfo() } })), info))
  }

  // ---------------------------------------------------------------- dice
  function pipsFor(n) {
    const map = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }
    return h('div', { class: 'pips' }, Array.from({ length: 9 }, (_, i) => (map[n].includes(i) ? h('i') : h('span'))))
  }
  function diceTab() {
    const diceHost = h('div', { class: 'dice', 'aria-live': 'polite' })
    const totalEl = h('div', { class: 'pz-bento' })
    const histHost = h('div')
    const cIn = input({ type: 'number', min: 1, max: 20, value: S.count, 'aria-label': 'Number of dice', style: 'width:84px', oninput: () => { S.count = clamp(Math.floor(cIn.valueAsNumber) || 1, 1, 20); store.save() } })
    const mIn = input({ type: 'number', min: -999, max: 999, value: S.mod, 'aria-label': 'Modifier', style: 'width:84px', oninput: () => { S.mod = Math.floor(mIn.valueAsNumber) || 0; store.save() } })
    const sidesSeg = segmented(SIDES.map((s) => [s, `d${s}`]), S.sides, (v) => { S.sides = Number(v); store.save() }, 'Sides')
    let rolling = false
    const showDie = (v, sides, cls = '') => h('div', { class: ['die', cls] }, sides === 6 && v ? pipsFor(v) : String(v))
    function paintIdle() { clear(diceHost, Array.from({ length: clamp(S.count, 1, 20) }, () => showDie(S.sides === 6 ? 6 : '?', S.sides))) }
    function roll() {
      if (rolling) return
      const count = clamp(Math.floor(cIn.valueAsNumber) || 1, 1, 20), sides = S.sides, mod = Math.floor(mIn.valueAsNumber) || 0
      S.count = count; S.mod = mod
      audio(); rolling = true
      const final = rollDice(count, sides)
      const dur = reduceMotion() ? 0 : 700
      let n = 0
      const iv = dur ? setInterval(() => { clear(diceHost, Array.from({ length: count }, () => showDie(1 + rand(sides), sides, 'rolling'))); if (S.sound && n++ % 2 === 0) tone(300 + rand(300), { dur: 0.03, type: 'square', gain: 0.04 }) }, 90) : 0
      later(() => {
        clearInterval(iv)
        const total = sum(final) + mod
        clear(diceHost, final.map((v) => showDie(v, sides, sides > 1 && v === sides ? 'max' : v === 1 ? 'min' : '')))
        clear(totalEl, stat({ label: 'Total', value: String(total), hint: `${count}d${sides}${mod ? (mod > 0 ? '+' : '') + mod : ''}`, icon: 'sigma', hero: true }), stat({ label: 'Highest', value: String(Math.max(...final)), tone: 'ok' }), stat({ label: 'Lowest', value: String(Math.min(...final)), tone: 'bad' }))
        S.rolls.unshift(`${count}d${sides}${mod ? (mod > 0 ? '+' : '') + mod : ''} = ${total}${count > 1 || mod ? ` (${final.join(' + ')}${mod ? ` ${mod > 0 ? '+' : '-'} ${Math.abs(mod)}` : ''})` : ''}`); S.rolls = S.rolls.slice(0, 15)
        store.save(); renderHist(); rolling = false
      }, dur)
      timers.add(iv)
    }
    function renderHist() { clear(histHost, S.rolls.length ? h('ul', { class: 'hist' }, S.rolls.map((r) => h('li', r))) : h('p', { class: 'pz-note' }, 'Your rolls show up here.')) }
    paintIdle(); renderHist()
    cleanups.push(() => timers.forEach((t) => { clearTimeout(t); clearInterval(t) }))
    return h('div', { class: 'pz-cols wide-l' },
      h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('dices'), 'Roll the dice'),
        h('div', { class: 'stack' }, diceHost, totalEl,
          h('div', { class: 'pz-row', style: 'justify-content:center' }, button('Roll', { icon: 'dices', variant: 'primary', size: 'lg', onClick: roll }), chip('d6', { onClick: () => { S.count = 1; S.sides = 6; cIn.value = 1; sidesSeg.set(6); store.save(); paintIdle() } }), chip('2d6', { onClick: () => { S.count = 2; S.sides = 6; cIn.value = 2; sidesSeg.set(6); store.save(); paintIdle() } }), chip('d20', { onClick: () => { S.count = 1; S.sides = 20; cIn.value = 1; sidesSeg.set(20); store.save(); paintIdle() } })))),
      h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('sliders-horizontal'), h('span', { class: 'grow' }, 'Options'), ib('trash-2', 'Clear roll history', () => { S.rolls = []; store.save(); renderHist() }, 'danger')),
        h('div', { class: 'stack' }, sidesSeg, h('div', { class: 'pz-row' }, field('Dice', cIn), field('Modifier', mIn)), histHost)))
  }

  el.append(bar, sec)
  show(S.tab in { wheel: 1, names: 1, coin: 1, dice: 1 } ? S.tab : 'wheel')
  return () => { cancelAnimationFrame(rafId); cleanups.forEach((f) => f()); timers.forEach((t) => { clearTimeout(t); clearInterval(t) }) }
}
