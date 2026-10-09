// Mouse tester: every button, the wheel, double clicks, double-click chatter, pointer speed and polling rate, and a click speed test.
import { h, icon, button, clear, stats, formatNumber } from '../../lib/ui.js'
import { baseCss, injectCss, clamp } from './_shared.js'

const BUTTONS = [[0, 'Left'], [2, 'Right'], [1, 'Middle'], [3, 'Back'], [4, 'Forward']]
/** Flags clicks of the same button that arrive faster than a person can click (switch chatter / double-click fault). */
export const isChatter = (gapMs) => gapMs > 0 && gapMs < 40
export const cpsOf = (clicks, seconds) => (seconds > 0 ? clicks / seconds : 0)
const TEST_SECONDS = 5

const CSS = `
.t-mt .pad{position:relative;display:grid;place-items:center;min-height:clamp(280px,52vh,460px);border-radius:var(--radius-xl);border:1px solid var(--border);background:radial-gradient(circle at 1px 1px,color-mix(in srgb,var(--text) 14%,transparent) 1px,transparent 0) 0 0/20px 20px,var(--surface-2);cursor:crosshair;touch-action:none;outline:none;overflow:hidden;user-select:none;-webkit-user-select:none}
.t-mt .pad:focus-visible{box-shadow:0 0 0 4px var(--ring)}
.t-mt .mouse{width:min(190px,46vw);height:auto;filter:drop-shadow(0 22px 26px rgba(0,0,0,.22))}
.t-mt .mouse .body{fill:var(--surface);stroke:var(--border-strong);stroke-width:3}
.t-mt .mouse .part{fill:var(--surface-2);stroke:var(--border-strong);stroke-width:2;transition:fill .12s,transform .12s}
.t-mt .mouse .part.on{fill:var(--accent)}
.t-mt .mouse .wheel{fill:var(--surface-3);stroke:var(--border-strong);stroke-width:2}
.t-mt .mouse .wheel.up{fill:var(--success)}.t-mt .mouse .wheel.down{fill:var(--warning)}
.t-mt .pad .hint{position:absolute;left:0;right:0;top:12px;text-align:center;font-size:13px;color:var(--muted);pointer-events:none}
.t-mt .pad .dot{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 5px var(--ring);pointer-events:none;opacity:0;transition:opacity .2s}
.t-mt .ripple{position:absolute;width:12px;height:12px;margin:-6px;border-radius:50%;border:2px solid var(--c,var(--accent));pointer-events:none;animation:mt-rip .6s var(--ease) forwards}
@keyframes mt-rip{to{transform:scale(6);opacity:0}}
.t-mt .cols{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:16px;align-items:start}
.t-mt .btns{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
.t-mt .bt{padding:10px 8px;border-radius:14px;border:1px solid var(--border);background:var(--surface);text-align:center;transition:background .15s,border-color .15s,transform .15s var(--spring)}
.t-mt .bt b{display:block;font:600 22px var(--mono)}
.t-mt .bt small{font-size:12px;color:var(--muted)}
.t-mt .bt.on{background:var(--accent-soft);border-color:var(--accent);transform:translateY(-3px)}
.t-mt .cps{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.t-mt .cps .big{font:600 34px var(--mono);letter-spacing:-.03em}
@media (max-width:860px){.t-mt .cols{grid-template-columns:minmax(0,1fr)}.t-mt .btns{grid-template-columns:repeat(3,minmax(0,1fr))}}
`

export function mount(root) {
  baseCss()
  injectCss('mt', CSS)
  const counts = Object.fromEntries(BUTTONS.map(([b]) => [b, 0]))
  const lastAt = {}
  let dbl = 0, chatter = 0, lastGap = 0, up = 0, down = 0, wheelX = 0, lastDelta = 0, rawX = 0, rawY = 0
  let moves = [], maxHz = 0, speed = 0, lastPos = null, lastT = 0, cps = null

  // ----- test pad -----
  const part = (cls, d) => h('path', { class: ['part', cls], d })
  const svgMouse = h('svg', { class: 'mouse', viewBox: '0 0 120 190', 'aria-hidden': 'true' },
    h('rect', { class: 'body', x: 8, y: 6, width: 104, height: 178, rx: 52 }),
    part('b0', 'M12 62 V56 C12 28 32 10 58 8 V62 Z'), part('b2', 'M62 8 C88 10 108 28 108 56 V62 H62 Z'),
    h('rect', { class: 'wheel', x: 53, y: 22, width: 14, height: 30, rx: 7 }),
    part('b3', 'M8 86 H21 V108 H8 Z'), part('b4', 'M8 112 H21 V134 H8 Z'),
    h('text', { x: 60, y: 118, 'text-anchor': 'middle', style: 'font:600 11px var(--mono);fill:var(--muted)' }, 'TEST'))
  const wheelEl = svgMouse.querySelector('.wheel')
  const hint = h('div', { class: 'hint' }, 'Click, double-click, scroll and move over this area')
  const dot = h('div', { class: 'dot' })
  const pad = h('div', { class: 'pad', tabindex: 0, role: 'application', 'aria-label': 'Mouse test area' }, hint, svgMouse, dot)
  const partEl = (b) => svgMouse.querySelector(`.b${b}`)

  const tiles = Object.fromEntries(BUTTONS.map(([b, l]) => [b, h('div', { class: 'bt' }, h('b', '0'), h('small', l))]))
  const btnRow = h('div', { class: 'btns' }, BUTTONS.map(([b]) => tiles[b]))
  const statHost = h('div')
  const note = h('div')

  const ripple = (e, c) => {
    const r = pad.getBoundingClientRect()
    const rp = h('span', { class: 'ripple', style: { left: `${e.clientX - r.left}px`, top: `${e.clientY - r.top}px`, '--c': c } })
    pad.append(rp)
    setTimeout(() => rp.remove(), 650)
  }
  function paint() {
    for (const [b] of BUTTONS) tiles[b].firstChild.textContent = String(counts[b])
    clear(statHost, stats([
      { label: 'Wheel', value: `↑ ${up}  ↓ ${down}`, hint: wheelX ? `${wheelX} sideways ticks` : lastDelta ? `last step ${lastDelta}` : 'Scroll over the pad', accent: true },
      { label: 'Double clicks', value: String(dbl), hint: lastGap ? `last gap ${Math.round(lastGap)} ms` : 'Double-click the pad' },
      { label: 'Pointer speed', value: `${formatNumber(speed, 0)} px/s`, hint: `x ${rawX}  y ${rawY}` },
      { label: 'Update rate', value: maxHz ? `${formatNumber(maxHz, 0)} Hz` : '-', hint: 'Move quickly for a second to measure' },
    ]))
    clear(note, chatter ? h('div', { class: 'alert warn' }, icon('triangle-alert'), h('div', `${chatter} click${chatter > 1 ? 's' : ''} came in under 40 ms after the previous click of the same button. People cannot click that fast, so a worn switch may be double-registering (chatter).`)) : null)
  }

  pad.addEventListener('contextmenu', (e) => e.preventDefault())
  pad.addEventListener('auxclick', (e) => e.preventDefault())
  pad.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') { counts[0]++; paint(); return }
    pad.focus({ preventScroll: true })
    const b = e.button
    if (!(b in counts)) return
    const now = performance.now()
    if (lastAt[b] && isChatter(now - lastAt[b])) chatter++
    lastAt[b] = now
    counts[b]++
    partEl(b)?.classList.add('on')
    tiles[b].classList.add('on')
    ripple(e, b === 0 ? 'var(--accent)' : b === 2 ? 'var(--danger)' : 'var(--success)')
    if (cps) cps.hit()
    paint()
  })
  const release = (e) => {
    const b = e.button
    partEl(b)?.classList.remove('on')
    tiles[b]?.classList.remove('on')
  }
  pad.addEventListener('pointerup', (e) => { release(e); if (e.button > 2) e.preventDefault() })
  // the Back and Forward buttons would otherwise navigate away from this page; middle click would start auto-scroll
  pad.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault() })
  pad.addEventListener('mouseup', (e) => { if (e.button > 2) e.preventDefault() })
  pad.addEventListener('pointercancel', () => { for (const [b] of BUTTONS) { partEl(b)?.classList.remove('on'); tiles[b].classList.remove('on') } })
  let prevClick = 0
  pad.addEventListener('dblclick', () => { dbl++; paint() })
  pad.addEventListener('click', () => { const n = performance.now(); lastGap = n - prevClick; prevClick = n })
  pad.addEventListener('wheel', (e) => {
    e.preventDefault()
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) wheelX++
    else if (e.deltaY < 0) { up++; flashWheel('up') } else if (e.deltaY > 0) { down++; flashWheel('down') }
    lastDelta = Math.round(e.deltaY || e.deltaX)
    paint()
  }, { passive: false })
  let wheelTimer = 0
  function flashWheel(dir) {
    wheelEl.classList.remove('up', 'down'); wheelEl.classList.add(dir)
    clearTimeout(wheelTimer); wheelTimer = setTimeout(() => wheelEl.classList.remove('up', 'down'), 160)
  }
  let moveRaf = 0
  pad.addEventListener('pointermove', (e) => {
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]
    const now = performance.now()
    for (let i = 0; i < Math.max(1, evs.length); i++) moves.push(now)
    moves = moves.filter((t) => now - t < 1000)
    maxHz = Math.max(maxHz, moves.length)
    rawX = Math.round(e.clientX); rawY = Math.round(e.clientY)
    if (lastPos && now - lastT > 0) speed = clamp((Math.hypot(e.clientX - lastPos.x, e.clientY - lastPos.y) / (now - lastT)) * 1000, 0, 99999)
    lastPos = { x: e.clientX, y: e.clientY }; lastT = now
    const r = pad.getBoundingClientRect()
    dot.style.opacity = '1'; dot.style.left = `${e.clientX - r.left}px`; dot.style.top = `${e.clientY - r.top}px`
    if (!moveRaf) moveRaf = requestAnimationFrame(() => { moveRaf = 0; paint() })
  })
  pad.addEventListener('pointerleave', () => { dot.style.opacity = '0'; speed = 0; lastPos = null; paint() })

  // ----- click speed test -----
  const cpsBig = h('div', { class: 'big' }, '0.0')
  const cpsMsg = h('div', { class: 'small muted' }, `Press Start, then click the pad as fast as you can for ${TEST_SECONDS} seconds.`)
  const cpsBtn = button('Start click test', { icon: 'timer', variant: 'primary' })
  let cpsTimer = 0
  cpsBtn.addEventListener('click', () => {
    if (cps) return
    let clicks = 0, t0 = 0
    cpsBig.textContent = '0.0'
    cpsBtn.disabled = true
    cps = {
      hit() {
        if (!t0) { t0 = performance.now(); cpsTimer = setInterval(tick, 50) }
        clicks++
        cpsBig.textContent = formatNumber(cpsOf(clicks, Math.max(0.2, (performance.now() - t0) / 1000)), 1)
      },
    }
    function tick() {
      const el = (performance.now() - t0) / 1000
      cpsMsg.textContent = `${Math.max(0, TEST_SECONDS - el).toFixed(1)} s left, ${clicks} clicks`
      if (el >= TEST_SECONDS) {
        clearInterval(cpsTimer); cps = null
        cpsBig.textContent = formatNumber(cpsOf(clicks, TEST_SECONDS), 1)
        cpsMsg.textContent = `Done: ${clicks} clicks in ${TEST_SECONDS} seconds (${formatNumber(cpsOf(clicks, TEST_SECONDS), 1)} per second).`
        cpsBtn.disabled = false
      }
    }
    cpsMsg.textContent = 'Go! The timer starts with your first click.'
  })
  const reset = () => {
    for (const k of Object.keys(counts)) counts[k] = 0
    dbl = chatter = up = down = wheelX = lastDelta = 0; maxHz = 0; moves = []; lastGap = 0
    paint()
  }

  root.append(h('div', { class: 't-mt stack' },
    h('div', { class: 'cols' },
      h('div', { class: 'stack' }, pad, btnRow),
      h('div', { class: 'stack' }, statHost, note,
        h('section', { class: 'panel stack' }, h('h2', 'Click speed test'), h('div', { class: 'cps' }, cpsBig, cpsBtn), cpsMsg),
        h('div', { class: 'row' }, button('Reset counters', { icon: 'rotate-ccw', size: 'sm', onClick: reset })))),
    h('p', { class: 'small muted' }, 'Back and Forward are the side buttons. If a button never lights up, it is not reaching the browser (some mouse drivers remap them). The update rate is how often your pointer reports its position, so it shows roughly the polling rate of the mouse or the screen refresh, whichever is lower.')))
  paint()
  return () => { clearInterval(cpsTimer); clearTimeout(wheelTimer); cancelAnimationFrame(moveRaf) }
}
