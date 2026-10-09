// Keyboard tester: a full-size on-screen keyboard that lights up as you type, with key codes and a rollover (ghosting) test.
import { h, icon, button, segmented, clear, table, copyText, toast } from '../../lib/ui.js'
import { baseCss, injectCss, listen } from './_shared.js'

// ---------- layout (ANSI, 104 keys). x, y, w, h are in key units; matched by physical position (event.code), so any language layout works ----------
const letters = (codes, x0, y) => [...codes].map((c, i) => ({ c: `Key${c}`, l: c, x: x0 + i, y }))
const nums = [...'1234567890'].map((c, i) => ({ c: `Digit${c}`, l: c, x: 1 + i, y: 1.5 }))
const fkeys = (from, n, x0) => Array.from({ length: n }, (_, i) => ({ c: `F${from + i}`, l: `F${from + i}`, x: x0 + i, y: 0 }))
export const LAYOUT = [
  { c: 'Escape', l: 'Esc', x: 0, y: 0 }, ...fkeys(1, 4, 2), ...fkeys(5, 4, 6.5), ...fkeys(9, 4, 11),
  { c: 'PrintScreen', l: 'PrtSc', x: 15.25, y: 0, g: 'nav' }, { c: 'ScrollLock', l: 'ScrLk', x: 16.25, y: 0, g: 'nav' }, { c: 'Pause', l: 'Pause', x: 17.25, y: 0, g: 'nav' },
  { c: 'Backquote', l: '`', x: 0, y: 1.5 }, ...nums, { c: 'Minus', l: '-', x: 11, y: 1.5 }, { c: 'Equal', l: '=', x: 12, y: 1.5 }, { c: 'Backspace', l: 'Backspace', x: 13, y: 1.5, w: 2 },
  { c: 'Insert', l: 'Ins', x: 15.25, y: 1.5, g: 'nav' }, { c: 'Home', l: 'Home', x: 16.25, y: 1.5, g: 'nav' }, { c: 'PageUp', l: 'PgUp', x: 17.25, y: 1.5, g: 'nav' },
  { c: 'NumLock', l: 'Num', x: 18.5, y: 1.5, g: 'num' }, { c: 'NumpadDivide', l: '/', x: 19.5, y: 1.5, g: 'num' }, { c: 'NumpadMultiply', l: '*', x: 20.5, y: 1.5, g: 'num' }, { c: 'NumpadSubtract', l: '-', x: 21.5, y: 1.5, g: 'num' },
  { c: 'Tab', l: 'Tab', x: 0, y: 2.5, w: 1.5 }, ...letters('QWERTYUIOP', 1.5, 2.5), { c: 'BracketLeft', l: '[', x: 11.5, y: 2.5 }, { c: 'BracketRight', l: ']', x: 12.5, y: 2.5 }, { c: 'Backslash', l: '\\', x: 13.5, y: 2.5, w: 1.5 },
  { c: 'Delete', l: 'Del', x: 15.25, y: 2.5, g: 'nav' }, { c: 'End', l: 'End', x: 16.25, y: 2.5, g: 'nav' }, { c: 'PageDown', l: 'PgDn', x: 17.25, y: 2.5, g: 'nav' },
  { c: 'Numpad7', l: '7', x: 18.5, y: 2.5, g: 'num' }, { c: 'Numpad8', l: '8', x: 19.5, y: 2.5, g: 'num' }, { c: 'Numpad9', l: '9', x: 20.5, y: 2.5, g: 'num' }, { c: 'NumpadAdd', l: '+', x: 21.5, y: 2.5, h: 2, g: 'num' },
  { c: 'CapsLock', l: 'Caps', x: 0, y: 3.5, w: 1.75 }, ...letters('ASDFGHJKL', 1.75, 3.5), { c: 'Semicolon', l: ';', x: 10.75, y: 3.5 }, { c: 'Quote', l: "'", x: 11.75, y: 3.5 }, { c: 'Enter', l: 'Enter', x: 12.75, y: 3.5, w: 2.25 },
  { c: 'Numpad4', l: '4', x: 18.5, y: 3.5, g: 'num' }, { c: 'Numpad5', l: '5', x: 19.5, y: 3.5, g: 'num' }, { c: 'Numpad6', l: '6', x: 20.5, y: 3.5, g: 'num' },
  { c: 'ShiftLeft', l: 'Shift', x: 0, y: 4.5, w: 2.25 }, ...letters('ZXCVBNM', 2.25, 4.5), { c: 'Comma', l: ',', x: 9.25, y: 4.5 }, { c: 'Period', l: '.', x: 10.25, y: 4.5 }, { c: 'Slash', l: '/', x: 11.25, y: 4.5 }, { c: 'ShiftRight', l: 'Shift', x: 12.25, y: 4.5, w: 2.75 },
  { c: 'ArrowUp', l: '↑', x: 16.25, y: 4.5, g: 'nav' },
  { c: 'Numpad1', l: '1', x: 18.5, y: 4.5, g: 'num' }, { c: 'Numpad2', l: '2', x: 19.5, y: 4.5, g: 'num' }, { c: 'Numpad3', l: '3', x: 20.5, y: 4.5, g: 'num' }, { c: 'NumpadEnter', l: 'Ent', x: 21.5, y: 4.5, h: 2, g: 'num' },
  { c: 'ControlLeft', l: 'Ctrl', x: 0, y: 5.5, w: 1.25 }, { c: 'MetaLeft', l: 'Win', x: 1.25, y: 5.5, w: 1.25 }, { c: 'AltLeft', l: 'Alt', x: 2.5, y: 5.5, w: 1.25 }, { c: 'Space', l: '', x: 3.75, y: 5.5, w: 6.25 },
  { c: 'AltRight', l: 'Alt', x: 10, y: 5.5, w: 1.25 }, { c: 'MetaRight', l: 'Win', x: 11.25, y: 5.5, w: 1.25 }, { c: 'ContextMenu', l: 'Menu', x: 12.5, y: 5.5, w: 1.25 }, { c: 'ControlRight', l: 'Ctrl', x: 13.75, y: 5.5, w: 1.25 },
  { c: 'ArrowLeft', l: '←', x: 15.25, y: 5.5, g: 'nav' }, { c: 'ArrowDown', l: '↓', x: 16.25, y: 5.5, g: 'nav' }, { c: 'ArrowRight', l: '→', x: 17.25, y: 5.5, g: 'nav' },
  { c: 'Numpad0', l: '0', x: 18.5, y: 5.5, w: 2, g: 'num' }, { c: 'NumpadDecimal', l: '.', x: 20.5, y: 5.5, g: 'num' },
]
const SIZES = { full: { w: 22.5, keep: () => true }, tkl: { w: 18.25, keep: (k) => k.g !== 'num' }, compact: { w: 15, keep: (k) => !k.g && k.y >= 1.5 } }
const LOCATION = ['Standard', 'Left', 'Right', 'Numpad']
const labelOf = Object.fromEntries(LAYOUT.map((k) => [k.c, k.l || 'Space']))

export const modifiersOf = (e) => [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean)
const pad = (n, l = 2) => String(n).padStart(l, '0')
const stamp = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` }

const CSS = `
.t-kt .board-wrap{border-radius:var(--radius-xl);border:1px solid var(--border);background:var(--surface-2);padding:clamp(10px,2vw,22px);overflow-x:auto;position:relative;outline:none;transition:box-shadow .25s,border-color .25s}
.t-kt .board-wrap:focus-visible,.t-kt .board-wrap.on{border-color:var(--accent);box-shadow:0 0 0 4px var(--ring)}
.t-kt .board{position:relative;margin:0 auto;--u:40px}
.t-kt .key{position:absolute;display:grid;place-items:center;border-radius:calc(var(--u)*.16);background:var(--surface);color:var(--text-2);border:1px solid var(--border-strong);border-bottom-width:calc(var(--u)*.08);font:600 calc(var(--u)*.3)/1 var(--mono);box-shadow:var(--shadow-sm);transition:background .12s,color .12s,transform .08s,border-color .2s,box-shadow .2s;user-select:none;overflow:hidden;white-space:nowrap}
.t-kt .key.tested{background:color-mix(in srgb,var(--success) 20%,var(--surface));border-color:color-mix(in srgb,var(--success) 55%,var(--border-strong));color:var(--text)}
.t-kt .key.down{background:linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 55%,var(--accent-2)));color:var(--accent-text);border-color:var(--accent);transform:translateY(calc(var(--u)*.05));box-shadow:0 0 0 3px var(--ring),0 6px 16px -6px var(--accent)}
.t-kt .key.flash{animation:kt-flash .45s var(--ease)}
@keyframes kt-flash{0%{box-shadow:0 0 0 0 var(--accent)}100%{box-shadow:0 0 0 14px transparent}}
.t-kt .status{display:inline-flex;align-items:center;gap:8px;padding:5px 12px;border-radius:999px;font-size:13px;font-weight:550;background:var(--surface-2);border:1px solid var(--border)}
.t-kt .status .dot{width:9px;height:9px;border-radius:50%;background:var(--muted)}
.t-kt .status.live{background:var(--success-soft);border-color:color-mix(in srgb,var(--success) 35%,transparent);color:var(--success)}
.t-kt .status.live .dot{background:var(--success);animation:kt-pulse 1.6s infinite}
@keyframes kt-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--success) 55%,transparent)}100%{box-shadow:0 0 0 8px transparent}}
.t-kt .bar{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center}
.t-kt .bar .grow{flex:1}
.t-kt .info{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:16px;align-items:start}
.t-kt .big{display:grid;place-items:center;min-height:132px;border-radius:var(--radius-lg);background:linear-gradient(160deg,color-mix(in srgb,var(--accent) 10%,var(--surface-2)),var(--surface-2));border:1px solid var(--border);font:600 clamp(34px,7vw,56px)/1 var(--mono);letter-spacing:-.03em;text-align:center;padding:12px;overflow:hidden}
.t-kt .big small{display:block;font:500 13px var(--font);letter-spacing:0;color:var(--muted);margin-top:8px}
.t-kt .kv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px 16px;font-size:14px;margin:0}
.t-kt .kv dt{color:var(--muted)}
.t-kt .kv dd{margin:0;font-family:var(--mono);overflow-wrap:anywhere}
.t-kt .chips{display:flex;gap:6px;flex-wrap:wrap}
.t-kt .chip{font:600 12px var(--mono);padding:3px 9px;border-radius:8px;background:var(--surface-2);border:1px solid var(--border)}
.t-kt .chip.hot{background:var(--accent-soft);border-color:color-mix(in srgb,var(--accent) 40%,transparent);color:var(--accent)}
.t-kt .meter{height:8px;border-radius:999px;background:var(--surface-3);overflow:hidden}
.t-kt .meter i{display:block;height:100%;width:0;border-radius:inherit;background:var(--brand);transition:width .3s var(--ease)}
@media (max-width:760px){.t-kt .info{grid-template-columns:minmax(0,1fr)}}
`

export function mount(root) {
  baseCss()
  injectCss('kt', CSS)
  let size = 'full', active = false
  const tested = new Set(), down = new Map(), extra = new Set()
  let maxDown = 0, total = 0, escHits = []
  const log = []

  // ----- board -----
  const board = h('div', { class: 'board' })
  const wrap = h('div', { class: 'board-wrap', tabindex: 0, role: 'application', 'aria-label': 'Keyboard test area. Press any key to test it. Press Escape three times quickly to leave.' }, board)
  const keyEls = new Map()
  function buildBoard() {
    const { w, keep } = SIZES[size]
    keyEls.clear()
    board.replaceChildren()
    const keys = LAYOUT.filter(keep)
    const top = size === 'compact' ? 1.5 : 0
    board.dataset.w = w
    board.style.height = `calc(var(--u) * ${size === 'compact' ? 5 : 6.5})`
    for (const k of keys) {
      const el = h('div', { class: ['key', tested.has(k.c) && 'tested', down.has(k.c) && 'down'], 'data-code': k.c, style: {
        left: `calc(var(--u) * ${k.x})`, top: `calc(var(--u) * ${k.y - top})`, width: `calc(var(--u) * ${k.w || 1} - 4px)`, height: `calc(var(--u) * ${k.h || 1} - 4px)`, margin: '2px' } }, k.l)
      keyEls.set(k.c, el)
      board.append(el)
    }
    fit()
    updateProgress()
  }
  function fit() {
    const w = SIZES[size].w
    const avail = wrap.clientWidth - 2 * 22
    const u = Math.max(26, Math.min(46, avail / w))
    board.style.setProperty('--u', `${u}px`)
    board.style.width = `calc(var(--u) * ${w})`
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(wrap)

  // ----- readouts -----
  const big = h('div', { class: 'big', 'aria-live': 'polite' }, h('span', { style: 'color:var(--muted);font-size:20px;font-family:var(--font);font-weight:550' }, 'Press any key'))
  const kv = h('dl', { class: 'kv' })
  const heldChips = h('div', { class: 'chips' })
  const rolloverEl = h('div', { class: 'small muted' })
  const meter = h('i')
  const progressText = h('span', { class: 'small muted' })
  const untestedEl = h('div')
  const logHost = h('div')
  const status = h('span', { class: 'status' }, h('span', { class: 'dot' }), h('span'))
  const count = h('span', { class: 'sc-mono small muted' })

  function setActive(on) {
    active = on
    wrap.classList.toggle('on', on)
    status.classList.toggle('live', on)
    status.lastChild.textContent = on ? 'Listening: every key is captured' : 'Click the keyboard to start testing'
  }
  function updateProgress() {
    const keys = LAYOUT.filter(SIZES[size].keep)
    const done = keys.filter((k) => tested.has(k.c)).length
    meter.style.width = `${(done / keys.length) * 100}%`
    progressText.textContent = `${done} of ${keys.length} keys tested`
    const rest = keys.filter((k) => !tested.has(k.c))
    clear(untestedEl, done && rest.length ? h('details', h('summary', { class: 'small muted', style: 'cursor:pointer' }, `Show the ${rest.length} keys not tested yet`), h('div', { class: 'chips', style: 'margin-top:8px' }, rest.map((k) => h('span', { class: 'chip' }, k.l || 'Space')))) : null)
    count.textContent = total ? `${total} key presses` : ''
  }
  function showLast(e) {
    const mods = modifiersOf(e)
    const k = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key : e.key
    clear(big, h('div', k, h('small', labelOf[e.code] ? `${labelOf[e.code]} key` : 'Key outside the standard layout')))
    const row = (a, b) => [h('dt', a), h('dd', String(b))]
    clear(kv, [...row('key', JSON.stringify(e.key)), ...row('code', e.code || '(empty)'), ...row('keyCode', e.keyCode), ...row('which', e.which), ...row('location', `${e.location} (${LOCATION[e.location] || '?'})`),
      ...row('modifiers', mods.length ? mods.join(' + ') : 'none'), ...row('repeat', e.repeat ? 'yes (held down)' : 'no'), ...row('event', e.type)])
  }
  function paintHeld() {
    clear(heldChips, down.size ? [...down.keys()].map((c) => h('span', { class: 'chip hot' }, labelOf[c] || c)) : h('span', { class: 'small muted' }, 'No keys held'))
    rolloverEl.textContent = `Held now: ${down.size} · Most at once: ${maxDown}`
  }
  function paintLog() {
    clear(logHost, log.length ? table({ columns: ['Time', 'Event', 'key', 'code', { label: 'keyCode', num: true }], rows: log.map((l) => [l.t, l.type === 'keydown' ? 'down' : 'up', l.key === ' ' ? 'Space' : l.key, l.code, l.keyCode]) })
      : h('div', { class: 'empty' }, icon('keyboard'), h('div', 'Key events show up here as you type.')))
  }

  function flash(code) {
    const el = keyEls.get(code)
    if (!el) return
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash')
  }
  function onKey(e) {
    if (!active) return
    e.preventDefault()
    e.stopPropagation()
    const code = e.code || `Unidentified-${e.keyCode}`
    const isDown = e.type === 'keydown'
    if (isDown) {
      if (code === 'Escape') { // three quick Escapes hand the keyboard back to the page
        const now = performance.now()
        escHits = [...escHits.filter((t) => now - t < 1200), now]
        if (escHits.length >= 3) { escHits = []; wrap.blur(); setActive(false); toast('Stopped listening. Tab and shortcuts work normally again.'); return }
      }
      if (!down.has(code)) { down.set(code, { key: e.key }); if (!e.repeat) total++ }
      maxDown = Math.max(maxDown, down.size)
      if (!tested.has(code)) { tested.add(code); if (!keyEls.has(code) && !LAYOUT.some((k) => k.c === code)) extra.add(code) }
      keyEls.get(code)?.classList.add('down', 'tested')
      if (!e.repeat) flash(code)
    } else {
      // keys such as Print Screen only report keyup on some systems, so a keyup also counts as tested
      if (!tested.has(code)) { tested.add(code); if (!LAYOUT.some((k) => k.c === code)) extra.add(code); keyEls.get(code)?.classList.add('tested'); total++; flash(code) }
      down.delete(code)
      keyEls.get(code)?.classList.remove('down')
    }
    if (!e.repeat) { log.unshift({ t: stamp(Date.now()), type: e.type, key: e.key, code, keyCode: e.keyCode }); log.length = Math.min(log.length, 10); paintLog() }
    showLast(e)
    paintHeld()
    updateProgress()
    paintExtra()
  }
  const extraEl = h('div', { class: 'stack tight' })
  function paintExtra() {
    clear(extraEl, extra.size ? [h('div', { class: 'field-label' }, 'Other keys detected (not on the standard layout)'), h('div', { class: 'chips' }, [...extra].map((c) => h('span', { class: 'chip hot' }, c)))] : null)
  }
  wrap.addEventListener('keydown', onKey)
  wrap.addEventListener('keyup', onKey)
  wrap.addEventListener('keypress', (e) => { if (active) e.preventDefault() })
  wrap.addEventListener('focus', () => setActive(true))
  wrap.addEventListener('blur', () => {
    setActive(false)
    for (const c of down.keys()) keyEls.get(c)?.classList.remove('down')
    down.clear()
    paintHeld()
  })
  listen(window, 'blur', () => { for (const c of down.keys()) keyEls.get(c)?.classList.remove('down'); down.clear(); paintHeld() })
  wrap.addEventListener('pointerdown', () => { if (document.activeElement !== wrap) wrap.focus() })

  const reset = () => {
    tested.clear(); down.clear(); extra.clear(); log.length = 0; maxDown = 0; total = 0
    for (const el of keyEls.values()) el.classList.remove('tested', 'down')
    clear(big, h('span', { style: 'color:var(--muted);font-size:20px;font-family:var(--font);font-weight:550' }, 'Press any key')); kv.replaceChildren()
    paintHeld(); paintLog(); updateProgress(); paintExtra()
    wrap.focus()
  }
  const sizeSeg = segmented([['full', 'Full size'], ['tkl', 'No numpad'], ['compact', 'Compact']], size, (v) => { size = v; buildBoard() }, 'Keyboard layout')

  root.append(h('div', { class: 't-kt stack' },
    h('div', { class: 'bar' }, status, h('div', { class: 'grow' }), sizeSeg, button('Reset', { icon: 'rotate-ccw', size: 'sm', onClick: reset })),
    wrap,
    h('div', { class: 'stack tight' }, h('div', { class: 'row between' }, progressText, count), h('div', { class: 'meter', role: 'progressbar', 'aria-label': 'Keys tested' }, meter), untestedEl),
    extraEl,
    h('div', { class: 'info' },
      h('section', { class: 'panel stack' }, h('h2', 'Last key'), big, kv),
      h('section', { class: 'panel stack' }, h('h2', 'Rollover and ghosting test'),
        h('p', { class: 'small muted' }, 'Hold several keys at once. If a key stops lighting up when you add another, your keyboard cannot report that combination (ghosting). Most gaming keyboards report every key at once; many office ones stop at 6 or fewer.'),
        h('div', { class: 'field-label' }, 'Keys held down'), heldChips, rolloverEl,
        h('div', { class: 'field-label', style: 'margin-top:6px' }, 'Recent events'), logHost,
        h('div', { class: 'row' }, button('Copy last code', { icon: 'copy', size: 'sm', onClick: () => (log[0] ? copyText(log[0].code) : toast('Press a key first')) })))),
    h('p', { class: 'small muted' }, 'Keys are matched by their physical position, so this works with any language or layout. Some combinations (Ctrl+W, Alt+F4, the Windows key, Fn on laptops) are handled by the browser or the system and cannot be seen by any web page. Press Escape three times quickly to leave the keyboard area.')))
  buildBoard(); paintHeld(); paintLog(); setActive(false)
  requestAnimationFrame(() => { fit(); wrap.focus({ preventScroll: true }) })
}
