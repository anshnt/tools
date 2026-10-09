// Gamepad tester: shows every button, trigger and stick of a connected controller live, checks stick drift and rumble.
import { h, icon, button, svg, clear, alert, toast, formatNumber } from '../../lib/ui.js'
import { baseCss, injectCss, unsupported, clamp } from './_shared.js'

const NS_LABEL = ['A (bottom)', 'B (right)', 'X (left)', 'Y (top)', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'Home']
const AXIS_LABEL = ['Left stick X', 'Left stick Y', 'Right stick X', 'Right stick Y']

/** Verdict for how far a stick rests from the center (0 to 1). */
export function driftVerdict(mag) {
  if (mag < 0.05) return ['success', 'No drift: the stick rests at the center.']
  if (mag < 0.15) return ['warn', 'Minor drift. Most games hide this with a dead zone of 10 to 15 percent.']
  return ['error', 'Strong drift. The stick reports movement while untouched, which usually means a worn or dirty stick.']
}
/** Average and largest distance from center of x/y sample lists. */
export function driftOf(samples) {
  if (!samples.length) return { mag: 0, x: 0, y: 0 }
  const x = samples.reduce((a, s) => a + s[0], 0) / samples.length, y = samples.reduce((a, s) => a + s[1], 0) / samples.length
  return { mag: Math.max(...samples.map((s) => Math.hypot(s[0], s[1]))), x, y }
}

const CSS = `
.t-gp .pads{display:grid;gap:16px}
.t-gp .head{display:flex;gap:10px 16px;align-items:center;flex-wrap:wrap;justify-content:space-between}
.t-gp .head h2{margin:0;font-size:16px;overflow-wrap:anywhere}
.t-gp .tags{display:flex;gap:6px;flex-wrap:wrap}
.t-gp .tag{font:600 12px var(--mono);padding:3px 9px;border-radius:8px;background:var(--surface-2);border:1px solid var(--border)}
.t-gp .ctl{width:min(100%,480px);height:auto;display:block;margin:0 auto;filter:drop-shadow(0 18px 20px rgba(0,0,0,.18))}
.t-gp .ctl .body{fill:var(--surface);stroke:var(--border-strong);stroke-width:2.5}
.t-gp .ctl .k{fill:var(--surface-2);stroke:var(--border-strong);stroke-width:2;transition:fill .06s}
.t-gp .ctl .k.on{fill:var(--accent);stroke:var(--accent)}
.t-gp .ctl .ring{fill:var(--surface-2);stroke:var(--border-strong);stroke-width:2}
.t-gp .ctl .ring.on{stroke:var(--accent);stroke-width:4}
.t-gp .ctl .knob{fill:var(--text-2);stroke:var(--surface);stroke-width:2}
.t-gp .ctl .knob.on{fill:var(--accent)}
.t-gp .ctl .tf{fill:var(--accent)}
.t-gp .ctl text{font:700 12px var(--font);fill:var(--muted);text-anchor:middle;pointer-events:none}
.t-gp .ctl .k.on+text{fill:var(--accent-text)}
.t-gp .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px}
.t-gp .bt{position:relative;overflow:hidden;padding:7px 10px;border-radius:12px;border:1px solid var(--border);background:var(--surface);font:12.5px var(--mono)}
.t-gp .bt i{position:absolute;left:0;bottom:0;height:3px;width:0;background:var(--accent)}
.t-gp .bt.on{border-color:var(--accent);background:var(--accent-soft)}
.t-gp .bt b{display:block;font-size:11px;color:var(--muted);font-family:var(--font);font-weight:550;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.t-gp .axes{display:grid;gap:8px}
.t-gp .ax{display:grid;grid-template-columns:104px minmax(0,1fr) 58px;gap:10px;align-items:center;font:12.5px var(--mono)}
.t-gp .ax .track{position:relative;height:10px;border-radius:999px;background:var(--surface-3)}
.t-gp .ax .track::after{content:"";position:absolute;left:50%;top:-2px;bottom:-2px;width:2px;background:var(--border-strong)}
.t-gp .ax .fillx{position:absolute;top:0;bottom:0;background:var(--accent);border-radius:999px}
.t-gp .ax span:first-child{font-family:var(--font);color:var(--text-2);font-size:13px}
.t-gp .ax span:last-child{text-align:right}
.t-gp .cols{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:18px;align-items:start}
@media (max-width:860px){.t-gp .cols{grid-template-columns:minmax(0,1fr)}}
`

function controllerSvg() {
  const els = { btn: {}, axes: {} }
  const key = (i, tag, props, label, lx, ly) => {
    const e = svg(tag, { class: 'k', ...props })
    els.btn[i] = e
    return [e, label ? svg('text', { x: lx, y: ly + 4 }, label) : null]
  }
  const stick = (cx, cy, id, press) => {
    const ring = svg('circle', { class: 'ring', cx, cy, r: 30 }), knob = svg('circle', { class: 'knob', cx, cy, r: 14 })
    els.axes[id] = { knob, ring, cx, cy, press }
    return [ring, knob]
  }
  const trig = (i, x) => {
    const bg = svg('rect', { class: 'k', x, y: 8, width: 62, height: 26, rx: 8 }), fillR = svg('rect', { class: 'tf', x, y: 34, width: 62, height: 0, rx: 8 })
    els.btn[i] = { trig: fillR, box: bg, base: 34, h: 26 }
    return [bg, fillR, svg('text', { x: x + 31, y: 25 }, i === 6 ? 'LT' : 'RT')]
  }
  const root = svg('svg', { class: 'ctl', viewBox: '0 0 400 250', role: 'img', 'aria-label': 'Controller with live button and stick state' },
    svg('path', { class: 'body', d: 'M80 62 Q110 42 150 46 H250 Q290 42 320 62 Q372 92 382 172 Q388 224 352 228 Q320 231 300 192 Q285 168 260 168 H140 Q115 168 100 192 Q80 231 48 228 Q12 224 18 172 Q28 92 80 62Z' }),
    trig(6, 68), trig(7, 270),
    key(4, 'rect', { x: 66, y: 38, width: 72, height: 14, rx: 6 }, 'LB', 102, 42), key(5, 'rect', { x: 262, y: 38, width: 72, height: 14, rx: 6 }, 'RB', 298, 42),
    stick(120, 104, 'l', 10), stick(268, 160, 'r', 11),
    key(12, 'rect', { x: 126, y: 142, width: 16, height: 18, rx: 4 }), key(13, 'rect', { x: 126, y: 178, width: 16, height: 18, rx: 4 }),
    key(14, 'rect', { x: 106, y: 160, width: 18, height: 18, rx: 4 }), key(15, 'rect', { x: 144, y: 160, width: 18, height: 18, rx: 4 }),
    key(0, 'circle', { cx: 308, cy: 122, r: 12 }, 'A', 308, 122), key(1, 'circle', { cx: 332, cy: 98, r: 12 }, 'B', 332, 98),
    key(2, 'circle', { cx: 284, cy: 98, r: 12 }, 'X', 284, 98), key(3, 'circle', { cx: 308, cy: 74, r: 12 }, 'Y', 308, 74),
    key(8, 'circle', { cx: 178, cy: 104, r: 8 }), key(9, 'circle', { cx: 222, cy: 104, r: 8 }), key(16, 'circle', { cx: 200, cy: 78, r: 11 }))
  return { root, els }
}

export function mount(root) {
  baseCss()
  injectCss('gp', CSS)
  const cards = new Map()
  let raf = 0, alive = true
  const supported = typeof navigator.getGamepads === 'function'

  function build(pad) {
    const std = pad.mapping === 'standard'
    const pic = std ? controllerSvg() : null
    const btnEls = pad.buttons.map((_, i) => {
      const fill = h('i'), b = h('div', { class: 'bt' }, h('b', std && NS_LABEL[i] ? NS_LABEL[i] : `Button ${i}`), h('span', '0.00'), fill)
      return { el: b, fill, val: b.querySelector('span') }
    })
    const axEls = pad.axes.map((_, i) => {
      const fx = h('span', { class: 'fillx' }), val = h('span', '0.00')
      return { el: h('div', { class: 'ax' }, h('span', std && AXIS_LABEL[i] ? AXIS_LABEL[i] : `Axis ${i}`), h('span', { class: 'track' }, fx), val), fx, val }
    })
    const drift = h('div')
    const rumbleBtn = button('Test vibration', { icon: 'vibrate', size: 'sm', onClick: () => doRumble() })
    const cur = { pad }
    const hasRumble = () => !!(cur.pad.vibrationActuator?.playEffect || cur.pad.hapticActuators?.[0]?.pulse)
    async function doRumble() {
      const p = cur.pad
      try {
        if (p.vibrationActuator?.playEffect) await p.vibrationActuator.playEffect('dual-rumble', { startDelay: 0, duration: 600, weakMagnitude: 1, strongMagnitude: 1 })
        else await p.hapticActuators[0].pulse(1, 600)
        toast('Rumble sent', 'success', 1200)
      } catch { toast('This controller did not accept the vibration command.', 'error') }
    }
    const driftBtn = button('Check stick drift', { icon: 'crosshair', size: 'sm', onClick: () => {
      if (pad.axes.length < 2) return
      driftBtn.disabled = true
      const a = [], b = []
      clear(drift, h('div', { class: 'small muted' }, 'Let go of the sticks and keep them still for a second...'))
      let n = 0
      const t = setInterval(() => {
        const p = cur.pad
        a.push([p.axes[0] || 0, p.axes[1] || 0]); if (p.axes.length >= 4) b.push([p.axes[2] || 0, p.axes[3] || 0])
        if (++n >= 45 || !alive) {
          clearInterval(t); driftBtn.disabled = false
          const l = driftOf(a), r = driftOf(b)
          const row = (name, d, has) => has ? alert(driftVerdict(d.mag)[0], h('strong', `${name}: `), `rests ${formatNumber(d.mag * 100, 1)}% from center (x ${d.x.toFixed(3)}, y ${d.y.toFixed(3)}). ${driftVerdict(d.mag)[1]}`) : null
          clear(drift, h('div', { class: 'stack tight' }, row('Left stick', l, true), row('Right stick', r, b.length > 0)))
        }
      }, 22)
    } })
    const info = [pad.mapping || 'non-standard mapping', `${pad.buttons.length} buttons`, `${pad.axes.length} axes`]
    const el = h('section', { class: 'panel stack' },
      h('div', { class: 'head' }, h('h2', pad.id), h('div', { class: 'tags' }, h('span', { class: 'tag' }, `Controller ${pad.index + 1}`), info.map((t) => h('span', { class: 'tag' }, t)))),
      h('div', { class: 'cols' },
        h('div', { class: 'stack' }, pic ? pic.root : h('div', { class: 'small muted' }, 'This controller does not use the standard layout, so here are its raw buttons and axes.'),
          h('div', { class: 'row' }, hasRumble() ? rumbleBtn : null, pad.axes.length >= 2 ? driftBtn : null), drift),
        h('div', { class: 'stack' }, h('div', { class: 'axes' }, axEls.map((a) => a.el)), h('div', { class: 'grid' }, btnEls.map((b) => b.el)))))
    return {
      el, cur,
      update(p) {
        cur.pad = p
        p.buttons.forEach((b, i) => {
          const v = typeof b === 'number' ? b : b.value, pr = typeof b === 'number' ? b > 0.5 : b.pressed
          const be = btnEls[i]
          if (!be) return
          be.el.classList.toggle('on', pr || v > 0.05)
          be.val.textContent = v.toFixed(2)
          be.fill.style.width = `${clamp(v, 0, 1) * 100}%`
          const m = pic?.els.btn[i]
          if (m?.trig) { m.trig.setAttribute('height', String(v * m.h)); m.trig.setAttribute('y', String(m.base - v * m.h)); m.box.classList.toggle('on', pr) } else if (m) m.classList.toggle('on', pr)
        })
        p.axes.forEach((v, i) => {
          const ae = axEls[i]
          if (!ae) return
          ae.val.textContent = v.toFixed(2)
          const w = Math.abs(v) * 50
          ae.fx.style.left = v < 0 ? `${50 - w}%` : '50%'
          ae.fx.style.width = `${w}%`
        })
        if (pic) {
          for (const [id, s] of Object.entries(pic.els.axes)) {
            const x = id === 'l' ? p.axes[0] || 0 : p.axes[2] || 0, y = id === 'l' ? p.axes[1] || 0 : p.axes[3] || 0
            const m = Math.hypot(x, y) || 1, k = Math.min(1, m)
            s.knob.setAttribute('cx', String(s.cx + (x / m) * k * 16)); s.knob.setAttribute('cy', String(s.cy + (y / m) * k * 16))
            const pressed = !!p.buttons[s.press]?.pressed
            s.ring.classList.toggle('on', pressed); s.knob.classList.toggle('on', pressed || k > 0.1)
          }
        }
      },
    }
  }

  const empty = h('div', { class: 'empty' }, icon('gamepad-2'), h('div', 'No controller detected yet. Connect one with USB or Bluetooth, then press any button on it. Browsers only reveal a controller after its first input.'))
  const host = h('div', { class: 'pads' })
  function poll() {
    if (!alive) return
    const list = [...(navigator.getGamepads?.() || [])].filter((p) => p && p.connected)
    const seen = new Set()
    for (const p of list) {
      seen.add(p.index)
      let c = cards.get(p.index)
      if (c && (c.sig !== `${p.id}|${p.buttons.length}|${p.axes.length}|${p.mapping}`)) { c.el.remove(); cards.delete(p.index); c = null }
      if (!c) { c = build(p); c.sig = `${p.id}|${p.buttons.length}|${p.axes.length}|${p.mapping}`; cards.set(p.index, c); host.append(c.el) }
      c.update(p)
    }
    for (const [i, c] of cards) if (!seen.has(i)) { c.el.remove(); cards.delete(i) }
    empty.hidden = cards.size > 0
    raf = requestAnimationFrame(poll)
  }
  root.append(h('div', { class: 't-gp stack' },
    supported ? null : unsupported('The Gamepad API', 'Try a recent Chrome, Edge, Firefox or Safari on a computer.'),
    empty, host,
    h('p', { class: 'small muted' }, 'Xbox, PlayStation and Switch controllers work. If buttons look wrong, your system may be translating the controller; the raw list on the right always shows what the browser receives. Nothing leaves this page.')))
  if (supported) raf = requestAnimationFrame(poll)
  return () => { alive = false; cancelAnimationFrame(raf) }
}
