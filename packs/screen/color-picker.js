// Screen color picker: EyeDropper API (Chromium) to sample any pixel on screen, or a loupe over a captured / uploaded image.
import { h, icon, button, busy, toast, copyText, toggle, input, clear, split, isAbort, segmented } from '../../lib/ui.js'
import { persisted } from '../../lib/store.js'
import { baseCss, injectCss, sourceHero, sourceActions, loupe, pointerToImage, pixelAt, rgbToHex, parseColor, fmt, contrastRatio, readableOn, rgbToHsl, hslToRgb, unsupported, clamp } from './_shared.js'

const CSS = `
.t-cp .big{position:relative;height:clamp(120px,22vw,168px);border-radius:var(--radius-lg);border:1px solid var(--border-strong);display:flex;align-items:flex-end;justify-content:space-between;padding:14px 16px;overflow:hidden;transition:background .35s var(--ease);background-image:var(--checker)}
.t-cp .big .fill{position:absolute;inset:0;background:var(--c);transition:background .35s var(--ease)}
.t-cp .big .hex{position:relative;font-family:var(--mono);font-size:clamp(22px,4vw,30px);font-weight:600;letter-spacing:-.02em;color:var(--on)}
.t-cp .big label{position:relative;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:550;padding:6px 11px;border-radius:999px;background:rgba(255,255,255,.2);color:var(--on);backdrop-filter:blur(6px);border:1px solid color-mix(in srgb,var(--on) 30%,transparent)}
.t-cp .big label input{position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer}
.t-cp .big.pop .hex{animation:sc-pop .4s var(--spring)}
.t-cp .fmt{display:grid;grid-template-columns:62px minmax(0,1fr) auto;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)}
.t-cp .fmt:last-child{border-bottom:0}
.t-cp .fmt b{font-size:12px;letter-spacing:.06em;color:var(--muted);font-weight:600}
.t-cp .fmt code{font-family:var(--mono);font-size:13.5px;overflow-wrap:anywhere}
.t-cp .shades{display:grid;grid-template-columns:repeat(11,minmax(0,1fr));gap:4px}
.t-cp .shade{aspect-ratio:1;min-height:26px;border-radius:8px;border:2px solid transparent;background:var(--c);box-shadow:0 0 0 1px var(--border-strong);cursor:pointer;padding:0;transition:transform .2s var(--spring)}
.t-cp .shade:hover{transform:translateY(-3px)}
.t-cp .shade[aria-current="true"]{border-color:var(--surface);box-shadow:0 0 0 2px var(--accent)}
.t-cp .contrast{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.t-cp .cbox{border-radius:12px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;gap:8px;border:1px solid var(--border-strong);font-weight:600}
.t-cp .cbox small{font-weight:550;font-size:12px;opacity:.9;font-family:var(--mono)}
.t-cp .hist{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:10px}
.t-cp .hs{position:relative;border:0;padding:0;background:transparent;text-align:center;cursor:pointer;font-family:var(--mono);font-size:11px;color:var(--muted)}
.t-cp .hs i{display:block;aspect-ratio:1;border-radius:14px;background:var(--c);box-shadow:0 0 0 1px var(--border-strong),0 8px 16px -10px var(--c);margin-bottom:5px;transition:transform .25s var(--spring)}
.t-cp .hs:hover i{transform:translateY(-4px) scale(1.04)}
.t-cp .hs[aria-current="true"] i{box-shadow:0 0 0 2px var(--accent),0 8px 16px -10px var(--c)}
.t-cp .stage{position:relative;line-height:0;border-radius:var(--radius);overflow:hidden;border:1px solid var(--border);background:var(--checker);touch-action:none}
.t-cp .stage>canvas{display:block;width:100%;height:auto;cursor:crosshair;touch-action:none;outline-offset:-3px}
.t-cp .lp{position:absolute;z-index:2;pointer-events:none;display:none;padding:4px;border-radius:50%;background:#fff;box-shadow:0 14px 30px -8px rgba(0,0,0,.5),0 0 0 1px rgba(0,0,0,.15)}
.t-cp .lp-tag{position:absolute;left:50%;bottom:-30px;transform:translateX(-50%);line-height:1;padding:5px 9px;border-radius:999px;background:#111;color:#fff;font-family:var(--mono);font-size:12px;white-space:nowrap}
.t-cp .readout{font-family:var(--mono);font-size:12.5px;color:var(--muted);display:flex;gap:14px;flex-wrap:wrap;align-items:center;min-height:22px}
.t-cp .readout i{display:inline-block;width:14px;height:14px;border-radius:4px;vertical-align:-2px;margin-right:6px;box-shadow:0 0 0 1px var(--border-strong)}
.t-cp .pickbtn{height:64px;font-size:16px;border-radius:18px}
@media (max-width:560px){.t-cp .shades{grid-template-columns:repeat(6,minmax(0,1fr))}.t-cp .fmt{grid-template-columns:52px minmax(0,1fr) auto}}
`

const hasEyeDropper = () => typeof window.EyeDropper === 'function'
const wcag = (r) => (r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'AA large' : 'Fail')

export function mount(root) {
  baseCss()
  injectCss('cp', CSS)
  const hist = persisted('color-picker:history', [])
  const prefs = persisted('color-picker:prefs', { copy: true, mode: hasEyeDropper() ? 'screen' : 'image' })
  let cur = null, mode = hasEyeDropper() ? prefs.get().mode : 'image', srcCanvas = null, abort = null

  // ----- current color panel -----
  const swatch = h('div', { class: 'big' }, h('div', { class: 'fill' }))
  const hexOut = h('span', { class: 'hex' }, 'Pick a color')
  const nativeIn = h('input', { type: 'color', 'aria-label': 'Fine tune with the system color picker', oninput: (e) => { const c = parseColor(e.target.value); if (c) setColor(c, { record: true, silent: true }) } })
  swatch.append(hexOut, h('label', icon('sliders-horizontal'), 'Fine tune', nativeIn))
  const typed = input({ placeholder: 'Type or paste any color: #5b4cf0, rgb(91 76 240), hsl(...), oklch(...), red', 'aria-label': 'Type a color', mono: true,
    oninput: (e) => { const c = parseColor(e.target.value); e.target.classList.toggle('invalid', !!e.target.value.trim() && !c); if (c) setColor(c, { record: false, from: 'typed' }) },
    onchange: (e) => { const c = parseColor(e.target.value); if (c) setColor(c, { record: true, from: 'typed' }) } })
  const fmtRows = h('div')
  const contrast = h('div', { class: 'contrast' })
  const shades = h('div', { class: 'shades', role: 'group', 'aria-label': 'Shades of this color' })
  const colorPanel = h('section', { class: 'panel stack' }, h('h2', 'Color'), swatch, typed, fmtRows,
    h('div', { class: 'field-label' }, 'Text contrast'), contrast,
    h('div', { class: 'field-label' }, 'Shades (click to use)'), shades)

  const FORMATS = [['HEX', 'hex'], ['RGB', 'rgb'], ['HSL', 'hsl'], ['OKLCH', 'oklch']]
  function setColor(rgb, { record = false, silent = false, from } = {}) {
    cur = rgb.slice(0, 3)
    const hex = rgbToHex(cur), on = readableOn(cur)
    swatch.style.setProperty('--c', hex)
    swatch.style.setProperty('--on', on)
    hexOut.textContent = hex
    nativeIn.value = hex.toLowerCase()
    if (from !== 'typed') typed.value = ''
    swatch.classList.remove('pop'); void swatch.offsetWidth; swatch.classList.add('pop')
    clear(fmtRows, FORMATS.map(([label, k]) => h('div', { class: 'fmt' }, h('b', label), h('code', fmt[k](cur)),
      button('', { icon: 'copy', variant: 'ghost', size: 'sm', ariaLabel: `Copy ${label}`, onClick: () => copyText(fmt[k](cur)) }))))
    clear(contrast, [['#ffffff', [255, 255, 255], 'White text'], ['#000000', [0, 0, 0], 'Black text']].map(([bg, rgb, label]) => {
      const r = contrastRatio(cur, rgb)
      return h('div', { class: 'cbox', style: { background: hex, color: bg } }, h('span', 'Aa ' + label.split(' ')[0]), h('small', `${r.toFixed(1)}:1 ${wcag(r)}`))
    }))
    const [hh, s, l] = rgbToHsl(cur)
    const steps = [95, 88, 78, 68, 58, 50, 42, 34, 26, 18, 10]
    const nearest = steps.reduce((b, v) => (Math.abs(v - l) < Math.abs(b - l) ? v : b), steps[0])
    clear(shades, steps.map((v) => {
      const c = hslToRgb([hh, s, v])
      return h('button', { type: 'button', class: 'shade', style: { '--c': rgbToHex(c) }, title: rgbToHex(c), 'aria-label': `Shade ${rgbToHex(c)}`, 'aria-current': String(v === nearest && Math.abs(v - l) < 3), onclick: () => setColor(c, { record: true }) })
    }))
    if (record) addHistory(hex)
    if (!silent && record && prefs.get().copy && from !== 'history') copyText(hex)
    drawHistory()
  }

  // ----- history -----
  const histBox = h('div', { class: 'hist' })
  const histPanel = h('section', { class: 'panel stack' })
  function addHistory(hex) {
    hist.update((a) => [hex, ...a.filter((x) => x !== hex)].slice(0, 60))
  }
  function drawHistory() {
    const a = hist.get()
    clear(histPanel, h('div', { class: 'row between' }, h('h2', { style: 'margin:0' }, `History${a.length ? ` (${a.length})` : ''}`),
      h('div', { class: 'row' },
        button('Copy all', { icon: 'copy', size: 'sm', disabled: !a.length, onClick: () => copyText(a.join('\n')) }),
        button('Clear', { icon: 'trash-2', size: 'sm', variant: 'ghost', disabled: !a.length, onClick: () => { hist.set([]); drawHistory() } }))),
    a.length
      ? h('div', { class: 'hist' }, a.map((hx) => h('button', { type: 'button', class: 'hs', title: `Use ${hx}`, 'aria-label': `Use ${hx}`, 'aria-current': String(cur && rgbToHex(cur) === hx), style: { '--c': hx },
        onclick: () => setColor(parseColor(hx), { from: 'history' }) }, h('i'), hx)))
      : h('div', { class: 'empty' }, icon('palette'), h('div', 'Colors you pick show up here and are remembered on this device.')),
    h('p', { class: 'small muted' }, 'Your color history is saved only in this browser.'))
  }

  // ----- screen eyedropper -----
  const pickBtn = button('Pick a color from the screen', { icon: 'pipette', variant: 'primary', block: true })
  pickBtn.classList.add('pickbtn')
  pickBtn.addEventListener('click', () => busy(pickBtn, async () => {
    abort = new AbortController()
    try {
      const r = await new window.EyeDropper().open({ signal: abort.signal })
      const c = parseColor(r.sRGBHex)
      if (c) setColor(c, { record: true })
    } catch (e) {
      if (isAbort(e)) return
      throw new Error(`The eyedropper could not start (${e.message || e}).`)
    } finally { abort = null }
  }, { label: 'Click anywhere on screen...' }))
  const screenPane = h('div', { class: 'stack' },
    hasEyeDropper() ? pickBtn : unsupported('The screen eyedropper', 'It needs Chrome, Edge or Opera on a computer. Use the Image tab to pick from a screenshot, a photo or a captured screen instead.'),
    h('p', { class: 'small muted' }, 'After you click, the cursor becomes a magnifier. Click any pixel, even in other windows or apps. Press Esc to cancel.'),
    toggle('Copy the HEX code as soon as I pick', prefs.get().copy, (v) => prefs.update((p) => ({ ...p, copy: v }))))

  // ----- image mode with loupe -----
  const imgHost = h('div', { class: 'stack' })
  const lp = loupe({ size: 124, cells: 11 })
  const lpTag = h('div', { class: 'lp-tag' })
  const lpBox = h('div', { class: 'lp' }, lp.el, lpTag)
  const readout = h('div', { class: 'readout' }, 'Move over the image, then click to pick.')
  let cursor = { x: 0, y: 0 }
  function showImage(c) {
    srcCanvas = c
    const cv = h('canvas', { width: c.width, height: c.height, tabindex: 0, role: 'img', 'aria-label': 'Image to pick from. Use arrow keys to move the pointer and Enter to pick.' })
    cv.getContext('2d').drawImage(c, 0, 0)
    const stage = h('div', { class: 'stage' }, cv, lpBox)
    cursor = { x: Math.floor(c.width / 2), y: Math.floor(c.height / 2) }
    const hover = (x, y, clientX, clientY) => {
      const px = lp.update(c, x, y)
      if (!px) return
      const hx = rgbToHex(px)
      lpTag.textContent = hx
      readout.replaceChildren(h('span', h('i', { style: { background: hx } }), hx), h('span', `x ${x}  y ${y}`), h('span', fmt.rgb(px)))
      const r = stage.getBoundingClientRect()
      const lx = clamp(clientX - r.left, 70, r.width - 70), ly = clientY - r.top
      lpBox.style.display = 'block'
      lpBox.style.left = `${lx - 66}px`
      lpBox.style.top = `${ly < 190 ? ly + 26 : ly - 156}px`
    }
    const move = (e) => { const p = pointerToImage(e, cv, c.width, c.height); cursor = { x: p.x, y: p.y }; hover(p.x, p.y, e.clientX, e.clientY) }
    cv.addEventListener('pointermove', move)
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); move(e) })
    cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') lpBox.style.display = 'none' })
    cv.addEventListener('pointerup', (e) => {
      const p = pointerToImage(e, cv, c.width, c.height)
      if (!p.inside) { lpBox.style.display = 'none'; return }
      const px = pixelAt(c, p.x, p.y)
      if (px) setColor(px, { record: true })
      if (e.pointerType !== 'mouse') lpBox.style.display = 'none'
    })
    cv.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
      if (d) {
        e.preventDefault()
        const s = e.shiftKey ? 10 : 1
        cursor = { x: clamp(cursor.x + d[0] * s, 0, c.width - 1), y: clamp(cursor.y + d[1] * s, 0, c.height - 1) }
        const r = cv.getBoundingClientRect()
        hover(cursor.x, cursor.y, r.left + ((cursor.x + 0.5) / c.width) * r.width, r.top + ((cursor.y + 0.5) / c.height) * r.height)
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        const px = pixelAt(c, cursor.x, cursor.y)
        if (px) setColor(px, { record: true })
      }
    })
    clear(imgHost, h('div', { class: 'row between' }, h('span', { class: 'small muted sc-mono' }, `${c.width} × ${c.height} px`), sourceActions({ onCanvas: (cc) => showImage(cc) })), stage, readout)
  }
  const imagePane = h('div', { class: 'stack' }, imgHost)
  imgHost.append(sourceHero({ title: 'Pick colors from a picture', text: 'Capture your screen or open an image, then hover for a magnifier and click to pick any pixel.', cta: 'Capture screen', onCanvas: (c) => showImage(c), art: 'pipette' }))

  // ----- layout -----
  const body = h('div')
  const modeSeg = segmented([['screen', 'Screen eyedropper'], ['image', 'From an image']], mode, (v) => setMode(v), 'Picking source')
  function setMode(v) {
    mode = v
    modeSeg.set(v)
    prefs.update((p) => ({ ...p, mode: v }))
    clear(body, v === 'screen' ? screenPane : imagePane)
  }
  swatch.style.setProperty('--c', 'transparent')
  swatch.style.setProperty('--on', 'var(--muted)')
  fmtRows.replaceChildren(h('p', { class: 'small muted' }, 'HEX, RGB, HSL and OKLCH codes appear here once you pick a color.'))
  const last = hist.get()[0]
  if (last) setColor(parseColor(last), { from: 'history' })
  drawHistory()
  setMode(mode)
  root.append(h('div', { class: 't-cp stack' }, h('div', modeSeg), split(h('section', { class: 'panel' }, body), colorPanel, 'wide-left'), histPanel))

  return () => { abort?.abort() }
}
