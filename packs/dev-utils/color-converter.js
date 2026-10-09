// Colour converter: HEX / RGB / HSL / HSV / HWB / CMYK / LAB / LCH / OKLAB / OKLCH, picker, alpha, WCAG contrast checker and palettes.
import { h, icon, button, input, segmented, rangeField, tabs, alert, clear, copyText } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { useKit, css, copyRow, eyebrow, pill, hashParams } from './_kit.js'
import * as C from './_color.js'

const STYLE = `
.t-cc .cc-top { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 16px; align-items: start; }
@media (max-width: 820px) { .t-cc .cc-top { grid-template-columns: 1fr; } }
.t-cc .cc-swatch { position: relative; border-radius: 22px; overflow: hidden; min-height: 200px; border: 1px solid var(--border); background: var(--checker); display: grid; align-items: end; }
.t-cc .cc-fill { position: absolute; inset: 0; transition: background-color .25s var(--ease); }
.t-cc .cc-sample { position: relative; padding: 18px; display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
.t-cc .cc-aa { font-size: 52px; font-weight: 700; letter-spacing: -.04em; line-height: 1; }
.t-cc .cc-name { font-size: 13px; font-weight: 600; padding: 4px 10px; border-radius: 999px; background: rgba(255, 255, 255, .85); color: #111; backdrop-filter: blur(6px); }
.t-cc .cc-pick { position: absolute; top: 12px; right: 12px; width: 44px; height: 44px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, .9); box-shadow: 0 4px 14px rgba(0, 0, 0, .25); padding: 0; cursor: pointer; background: none; overflow: hidden; }
.t-cc .cc-pick::-webkit-color-swatch-wrapper { padding: 0; }
.t-cc .cc-pick::-webkit-color-swatch { border: 0; border-radius: 50%; }
.t-cc .cc-rows { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
@media (max-width: 1000px) { .t-cc .cc-rows { grid-template-columns: 1fr; } }
.t-cc .cc-rows .dv-copy .k { min-width: 48px; }
.t-cc .cc-sw { display: grid; gap: 4px; justify-items: stretch; min-width: 0; }
.t-cc .cc-sw button { height: 56px; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--text) 14%, transparent); cursor: pointer; transition: transform .2s var(--spring), box-shadow .2s; padding: 0; position: relative; }
.t-cc .cc-sw button:hover { transform: translateY(-2px) scale(1.03); box-shadow: var(--shadow); }
.t-cc .cc-sw button.base::after { content: ""; position: absolute; inset: 5px; border-radius: 8px; border: 2px solid #fff; mix-blend-mode: difference; }
.t-cc .cc-sw span { font-family: var(--mono); font-size: 11px; color: var(--muted); text-align: center; overflow: hidden; text-overflow: ellipsis; }
.t-cc .cc-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(54px, 1fr)); gap: 8px; }
.t-cc .cc-ratio { font-size: clamp(34px, 7vw, 56px); font-weight: 700; letter-spacing: -.04em; font-variant-numeric: tabular-nums; line-height: 1; }
.t-cc .cc-prev { border-radius: 16px; padding: 22px; border: 1px solid var(--border); display: grid; gap: 6px; background-image: none; }
.t-cc .cc-badges { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
.t-cc .cc-badge { border: 1px solid var(--border); border-radius: 14px; padding: 10px 12px; display: grid; gap: 4px; background: var(--surface); }
.t-cc .cc-badge small { color: var(--muted); font-size: 12px; }
.t-cc .cc-two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 720px) { .t-cc .cc-two { grid-template-columns: 1fr; } }
.t-cc .cc-bgrow { display: flex; gap: 8px; align-items: center; }
.t-cc .cc-bgrow input[type=color] { width: 46px; height: 42px; padding: 2px; border-radius: 12px; border: 1px solid var(--border-strong); background: var(--surface); cursor: pointer; flex: none; }
`

const LABELS = [['hex', 'HEX'], ['rgb', 'RGB'], ['hsl', 'HSL'], ['hwb', 'HWB'], ['hsv', 'HSV'], ['cmyk', 'CMYK'], ['lab', 'LAB'], ['lch', 'LCH'], ['oklab', 'OKLAB'], ['oklch', 'OKLCH']]
const MORE = [['hex8', 'HEX8'], ['rgbLegacy', 'RGB (legacy)'], ['int', 'Integer'], ['css', 'CSS var'], ['flutter', 'Flutter'], ['android', 'Android'], ['swift', 'UIColor'], ['swiftui', 'SwiftUI']]

const bgCss = (c) => `rgb(${Math.round(c.r * 255)} ${Math.round(c.g * 255)} ${Math.round(c.b * 255)} / ${c.a})`
const onColor = (c) => (C.contrast(C.over(c, C.rgb(1, 1, 1)), C.rgb(0, 0, 0)) > 7 ? '#000' : '#fff')

export function mount(root) {
  useKit()
  css('t-cc-css', STYLE)
  const q = hashParams()
  let color = C.parseColor(q.get('c') || '') || C.parseColor(load('color-converter', '#5b4cf0')) || C.rgb(0.357, 0.298, 0.941)
  let bg = C.parseColor('#ffffff')

  // ----- main input -----
  const text = input({ mono: true, value: C.toHex(color), placeholder: '#5b4cf0, rgb(91 76 240), hsl(246 85% 61%), oklch(54% 0.23 279), tomato...', 'aria-label': 'Colour value', spellcheck: false, autocapitalize: 'off', autocomplete: 'off' })
  text.style.cssText = 'font-size:15px;height:46px'
  const picker = h('input', { class: 'cc-pick', type: 'color', 'aria-label': 'Pick a colour', value: C.toHex(color).slice(0, 7), oninput: (e) => { const p = C.parseColor(e.target.value); if (p) set({ ...p, a: color.a }, 'picker') } })
  const fill = h('div', { class: 'cc-fill' })
  const aa = h('div', { class: 'cc-aa', 'aria-hidden': 'true' }, 'Aa')
  const nameTag = h('div', { class: 'cc-name' })
  const swatch = h('div', { class: 'cc-swatch' }, fill, picker, h('div', { class: 'cc-sample' }, aa, nameTag))
  const status = h('div', { class: 'row', style: 'min-height:28px' })
  const rows = Object.fromEntries([...LABELS, ...MORE].map(([k, l]) => [k, copyRow(l, '', { initial: '' })]))
  const gamutNote = h('div')

  // ----- adjust tab -----
  let model = 'hsl'
  const sl = {}
  const mk = (id, label, o) => { sl[id] = rangeField(label, { ...o, onInput: (v) => fromSliders(id, v) }); return sl[id] }
  mk('r', 'Red', { min: 0, max: 255, step: 1, value: 0 }); mk('g', 'Green', { min: 0, max: 255, step: 1, value: 0 }); mk('b', 'Blue', { min: 0, max: 255, step: 1, value: 0 })
  mk('h', 'Hue', { min: 0, max: 360, step: 1, value: 0, format: (v) => `${v}°` }); mk('s', 'Saturation', { min: 0, max: 100, step: 1, value: 0, format: (v) => `${v}%` }); mk('l', 'Lightness', { min: 0, max: 100, step: 1, value: 0, format: (v) => `${v}%` })
  mk('ol', 'Lightness', { min: 0, max: 100, step: 0.5, value: 0, format: (v) => `${v}%` }); mk('oc', 'Chroma', { min: 0, max: 0.37, step: 0.002, value: 0, format: (v) => v.toFixed(3) }); mk('oh', 'Hue', { min: 0, max: 360, step: 1, value: 0, format: (v) => `${v}°` })
  mk('a', 'Opacity', { min: 0, max: 100, step: 1, value: 100, format: (v) => `${v}%` })
  const groups = { rgb: ['r', 'g', 'b'], hsl: ['h', 's', 'l'], oklch: ['ol', 'oc', 'oh'] }
  const modelSeg = segmented([['rgb', 'RGB'], ['hsl', 'HSL'], ['oklch', 'OKLCH']], model, (v) => { model = v; showModel() }, 'Colour model')
  const sliderBox = h('div', { class: 'stack' })
  function showModel() { clear(sliderBox, ...groups[model].map((id) => sl[id]), sl.a) }
  function fromSliders(id, v) {
    const a = sl.a.input.valueAsNumber / 100
    let c
    if (id === 'a') c = { ...color, a }
    else if (model === 'rgb') c = C.rgb(sl.r.input.valueAsNumber / 255, sl.g.input.valueAsNumber / 255, sl.b.input.valueAsNumber / 255, a)
    else if (model === 'hsl') c = C.fromHsl({ h: sl.h.input.valueAsNumber, s: sl.s.input.valueAsNumber / 100, l: sl.l.input.valueAsNumber / 100 }, a)
    else c = C.oklchInGamut({ l: sl.ol.input.valueAsNumber / 100, c: sl.oc.input.valueAsNumber, h: sl.oh.input.valueAsNumber }, a)
    set(c, 'slider')
  }
  function syncSliders(skipModel) {
    const hsl = C.toHsl(color), ok = C.toOklch(color)
    const vals = { r: color.r * 255, g: color.g * 255, b: color.b * 255, h: hsl.h, s: hsl.s * 100, l: hsl.l * 100, ol: ok.l * 100, oc: ok.c, oh: ok.h, a: color.a * 100 }
    for (const id of Object.keys(sl)) {
      if (skipModel && groups[model].includes(id)) continue
      sl[id].set(Math.round(vals[id] * 1000) / 1000)
    }
  }

  // ----- contrast tab -----
  const bgText = input({ mono: true, value: '#ffffff', placeholder: 'Background colour', 'aria-label': 'Background colour', spellcheck: false, oninput: (e) => { const p = C.parseColor(e.target.value); if (p) { bg = { ...p, a: 1 }; bgPicker.value = C.toHex(bg).slice(0, 7); renderContrast() } } })
  const bgPicker = h('input', { type: 'color', value: '#ffffff', 'aria-label': 'Pick background colour', oninput: (e) => { bg = C.parseColor(e.target.value); bgText.value = e.target.value; renderContrast() } })
  const contrastOut = h('div', { class: 'stack' })
  const setBg = (c) => { bg = { ...c, a: 1 }; bgText.value = C.toHex(bg); bgPicker.value = C.toHex(bg).slice(0, 7); renderContrast() }
  function renderContrast() {
    const ratio = C.contrast(color, bg)
    const w = C.wcag(ratio)
    const badge = (label, sub, ok) => h('div', { class: 'cc-badge' }, h('div', { class: 'row', style: 'gap:8px' }, pill(ok ? 'ok' : 'bad', ok ? 'check' : 'x', ok ? 'Pass' : 'Fail'), h('b', { style: 'font-size:14px' }, label)), h('small', sub))
    const fg = C.over(color, bg)
    const need = !w.aa ? 4.5 : !w.aaa ? 7 : null
    const sugg = !w.aa ? C.accessibleVariant(color, bg, 4.5) : !w.aaa ? C.accessibleVariant(color, bg, 7) : null
    clear(contrastOut,
      h('div', { class: 'row between', style: 'align-items:flex-end' },
        h('div', h('div', { class: 'small muted' }, 'Contrast ratio'), h('div', { class: 'cc-ratio' }, `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`)),
        h('div', { class: 'row', style: 'gap:6px' }, button('Swap', { icon: 'arrow-left-right', size: 'sm', onClick: () => { const fgOld = color, bgOld = bg; bg = { ...fgOld, a: 1 }; bgText.value = C.toHex(bg); bgPicker.value = C.toHex(bg).slice(0, 7); set(bgOld) } }), button('White', { size: 'sm', variant: 'ghost', onClick: () => setBg(C.rgb(1, 1, 1)) }), button('Black', { size: 'sm', variant: 'ghost', onClick: () => setBg(C.rgb(0, 0, 0)) }))),
      h('div', { class: 'cc-badges' }, badge('Normal text AA', 'needs 4.5:1', w.aa), badge('Normal text AAA', 'needs 7:1', w.aaa), badge('Large text AA', '18pt / 14pt bold, 3:1', w.aaLarge), badge('Large text AAA', 'needs 4.5:1', w.aaaLarge), badge('UI parts and icons', 'needs 3:1', w.ui)),
      h('div', { class: 'cc-prev', style: { background: C.toHex(bg), color: C.toHex(fg) } },
        h('div', { style: 'font-size:26px;font-weight:700;letter-spacing:-.02em' }, 'Large heading sample'),
        h('div', { style: 'font-size:15px;line-height:1.5' }, 'The quick brown fox jumps over the lazy dog. This is how normal body text looks in your two colours.'),
        h('div', { style: 'font-size:13px;opacity:.9' }, 'Small caption text, 13px')),
      sugg ? h('div', { class: 'row', style: 'gap:12px' },
        h('span', { style: `width:40px;height:40px;border-radius:12px;background:${C.toHex(sugg)};border:1px solid var(--border);flex:none` }),
        h('div', { style: 'flex:1;min-width:180px' }, h('div', { style: 'font-size:14px;font-weight:600' }, `Closest ${need === 4.5 ? 'AA' : 'AAA'} text colour: ${C.toHex(sugg)}`), h('div', { class: 'small muted' }, `${C.contrast(sugg, bg).toFixed(2)}:1, same hue, lightness adjusted.`)),
        button('Use it', { size: 'sm', variant: 'primary', onClick: () => set(sugg) })) : (w.aaa ? alert('success', 'Excellent: this pair passes every WCAG level for text.') : null))
  }

  // ----- palettes tab -----
  const palEl = h('div', { class: 'stack' })
  const swatches = (list, withBase) => h('div', { class: 'cc-strip' }, list.map((c, i) => {
    const hx = C.toHex(C.rgb(c.r, c.g, c.b))
    return h('div', { class: 'cc-sw' }, h('button', { type: 'button', class: withBase?.[i] ? 'base' : '', style: { background: hx }, title: `Copy ${hx}`, 'aria-label': `Copy ${hx}`, onclick: () => copyText(hx) }), h('span', hx))
  }))
  function renderPalette() {
    const sc = C.scale(color)
    const cssVars = sc.map(([s, c]) => `  --color-${s}: ${C.toHex(c)};`).join('\n')
    clear(palEl,
      h('div', { class: 'stack tight' }, h('div', { class: 'row between' }, eyebrow('layers', 'Scale (50 to 950)'), h('div', { class: 'row', style: 'gap:6px' },
        button('CSS variables', { icon: 'copy', size: 'sm', onClick: () => copyText(`:root {\n${cssVars}\n}`) }),
        button('Tailwind', { icon: 'copy', size: 'sm', onClick: () => copyText(`colors: {\n  brand: {\n${sc.map(([s, c]) => `    ${s}: '${C.toHex(c)}',`).join('\n')}\n  },\n},`) }))),
      h('div', { class: 'cc-strip' }, sc.map(([s, c, base]) => { const hx = C.toHex(c); return h('div', { class: 'cc-sw' }, h('button', { type: 'button', class: base ? 'base' : '', style: { background: hx }, title: `Copy ${hx}`, 'aria-label': `Copy ${s}: ${hx}`, onclick: () => copyText(hx) }), h('span', `${s}`), h('span', hx)) }))),
      ...C.harmonies(color).map((g) => h('div', { class: 'stack tight' }, eyebrow('orbit', g.name), swatches(g.colors, g.colors.map((c) => c === color)))),
      h('div', { class: 'stack tight' }, eyebrow('sun', 'Tints (toward white)'), swatches(C.tints(color))),
      h('div', { class: 'stack tight' }, eyebrow('moon', 'Shades (toward black)'), swatches(C.shades(color))))
  }

  // ----- core update -----
  function set(c, src) {
    color = C.clampRgb({ ...c })
    const f = C.formats(color)
    if (src !== 'text') text.value = f.hex
    text.classList.remove('invalid')
    picker.value = C.toHex(color).slice(0, 7)
    fill.style.background = bgCss(color)
    const ink = onColor(color)
    aa.style.color = ink
    for (const [k, r] of Object.entries(rows)) r.set(f[k])
    const near = C.nearestName(color)
    nameTag.textContent = near ? (near.exact ? near.name : `≈ ${near.name}`) : ''
    clear(status, pill('ok', 'check', 'Valid colour'), color.a < 1 ? pill('info', 'blend', `${Math.round(color.a * 100)}% opaque`) : null)
    syncSliders(src === 'slider')
    renderContrast()
    renderPalette()
    save('color-converter', f.hex8)
  }

  text.addEventListener('input', () => {
    const p = C.parseColor(text.value)
    if (!p) {
      text.classList.toggle('invalid', !!text.value.trim())
      clear(status, text.value.trim() ? pill('bad', 'circle-alert', 'Not recognised') : pill('', 'info', 'Type a colour'), text.value.trim() ? h('span', { class: 'small muted' }, 'Try #5b4cf0, rgb(91 76 240), hsl(246 85% 61%), oklch(54% 0.23 279) or a name like tomato') : null)
      return
    }
    set(p, 'text')
  })

  const examples = ['#5b4cf0', 'tomato', 'rgb(16 185 129)', 'hsl(199 89% 48%)', 'oklch(70% 0.19 50)', '#f59e0b80']
  const tabsEl = tabs([
    { id: 'adjust', label: 'Adjust', render: () => h('div', { class: 'stack' }, h('div', { class: 'row between' }, eyebrow('sliders-horizontal', 'Fine-tune'), modelSeg), sliderBox) },
    { id: 'contrast', label: 'Contrast checker', render: () => h('div', { class: 'stack' },
      h('div', { class: 'cc-two' }, h('div', { class: 'stack tight' }, eyebrow('type', 'Text colour'), h('div', { class: 'small muted' }, 'Uses the colour you picked above.')),
        h('div', { class: 'stack tight' }, eyebrow('square', 'Background'), h('div', { class: 'cc-bgrow' }, bgPicker, bgText))), contrastOut) },
    { id: 'palette', label: 'Palettes', render: () => palEl },
  ], 'adjust')

  root.append(h('div', { class: 'dv t-cc stack' },
    h('div', { class: 'cc-top' },
      h('div', { class: 'stack tight' }, swatch, text, status,
        h('div', { class: 'dv-chips' }, examples.map((x) => h('button', { type: 'button', class: 'dv-chip mono', onclick: () => { text.value = x; text.dispatchEvent(new Event('input')) } }, x)))),
      h('div', { class: 'stack tight' }, h('div', { class: 'cc-rows' }, LABELS.map(([k]) => rows[k])),
        h('details', h('summary', { style: 'cursor:pointer;font-weight:600;font-size:13.5px;min-height:34px;display:flex;align-items:center;gap:8px' }, icon('code'), 'More formats for developers'),
          h('div', { class: 'cc-rows', style: 'padding-top:8px' }, MORE.map(([k]) => rows[k]))))),
    h('div', { class: 'panel' }, tabsEl),
    h('p', { class: 'small muted' }, 'Lab and LCH use the D50 white point and OKLab/OKLCH use sRGB as in CSS Color 4. Out-of-gamut OKLCH or Lab values are mapped into sRGB by reducing chroma. Everything runs in your browser.')))
  showModel()
  set(color)
}
