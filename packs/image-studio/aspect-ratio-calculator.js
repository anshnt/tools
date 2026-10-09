// Aspect ratio calculator: find the ratio of a size, solve the missing side, or work out a crop / pad to a target ratio.
import { h, panel, split, field, table, button, copyText, clear, formatNumber } from '../../lib/ui.js'
import { addStyle, pills, chipPicker, tiles, numField, gcd, stage } from './_shared.js'

export const COMMON = [
  { r: [1, 1], label: '1:1', name: 'Square', use: 'Instagram post, profile photos' },
  { r: [5, 4], label: '5:4', name: 'Large format', use: '8 x 10 in prints, old monitors' },
  { r: [4, 3], label: '4:3', name: 'Standard', use: 'iPad, compact cameras, classic TV' },
  { r: [3, 2], label: '3:2', name: 'DSLR', use: '35 mm film, 4 x 6 in prints' },
  { r: [16, 10], label: '16:10', name: 'Laptop', use: 'MacBook and many monitors' },
  { r: [16, 9], label: '16:9', name: 'Widescreen', use: 'HD video, YouTube, TVs' },
  { r: [2, 1], label: '2:1', name: 'Univisium', use: 'Netflix originals, tall phones' },
  { r: [21, 9], label: '21:9', name: 'Ultrawide', use: 'Cinema monitors' },
  { r: [2.39, 1], label: '2.39:1', name: 'Cinemascope', use: 'Anamorphic film' },
  { r: [4, 5], label: '4:5', name: 'Portrait', use: 'Instagram portrait post' },
  { r: [3, 4], label: '3:4', name: 'Portrait', use: 'Phone and portrait photos' },
  { r: [2, 3], label: '2:3', name: 'Portrait DSLR', use: 'Portrait 4 x 6 in prints' },
  { r: [9, 16], label: '9:16', name: 'Vertical video', use: 'Stories, Reels, Shorts, TikTok' },
  { r: [1.91, 1], label: '1.91:1', name: 'Link preview', use: 'Open Graph and Facebook share images' },
  { r: [3, 1], label: '3:1', name: 'Banner', use: 'X (Twitter) header' },
  { r: [1, Math.SQRT2], label: 'A4', name: 'ISO paper', use: 'A3, A4, A5 sheets (1 : 1.414)' },
]

/** Reduce a size to its smallest whole-number ratio. */
export function reduceRatio(w, hh) {
  const g = gcd(w, hh)
  return [Math.round(w) / g, Math.round(hh) / g]
}

/** The common ratio closest to w/h and how far off it is (as a fraction). */
export function closestCommon(w, hh) {
  const v = w / hh
  let best = null
  for (const c of COMMON) {
    const diff = Math.abs(Math.log(v / (c.r[0] / c.r[1])))
    if (!best || diff < best.diff) best = { ...c, diff }
  }
  best.off = Math.abs(v / (best.r[0] / best.r[1]) - 1)
  return best
}

/** Given a ratio rw:rh and one known side, return the other side (unrounded). */
export const solveSide = (rw, rh, known, value) => (known === 'w' ? (value * rh) / rw : (value * rw) / rh)

/**
 * Largest centered crop of an W x H image to the ratio tw:th, and the padded canvas that would contain it instead.
 * Returns whole pixels.
 */
export function cropPad(W, H, tw, th) {
  const t = tw / th
  const o = W / H
  let cw = W, ch = H, pw = W, ph = H
  if (o > t) { cw = Math.round(H * t); pw = Math.round(W); ph = Math.round(W / t) } else { ch = Math.round(W / t); ph = Math.round(H); pw = Math.round(H * t) }
  cw = Math.min(cw, W); ch = Math.min(ch, H)
  if (o > t) ch = H; else cw = W
  return {
    crop: { w: cw, h: ch, left: Math.floor((W - cw) / 2), top: Math.floor((H - ch) / 2), lost: 1 - (cw * ch) / (W * H) },
    pad: { w: Math.max(pw, W), h: Math.max(ph, H), addW: Math.max(pw, W) - W, addH: Math.max(ph, H) - H },
  }
}

const WIDTHS = [320, 480, 640, 800, 1024, 1280, 1600, 1920, 2560, 3840]
const orient = (w, hh) => (Math.abs(w - hh) < 1e-9 ? 'Square' : w > hh ? 'Landscape' : 'Portrait')
const ok = (...n) => n.every((x) => Number.isFinite(x) && x > 0)

export function mount(root) {
  addStyle('is-arc', `
.t-arc .scene { position: relative; height: 300px; display: grid; place-items: center; }
.t-arc .box { position: absolute; display: grid; place-items: center; border-radius: 14px; transition: width .5s var(--spring), height .5s var(--spring), border-radius .3s; }
.t-arc .box.a { background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 88%, #fff), color-mix(in srgb, var(--c, var(--accent-2)) 85%, var(--accent))); box-shadow: 0 24px 50px -22px var(--accent); color: #fff; }
.t-arc .box.b { background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 88%, #fff), color-mix(in srgb, var(--c, var(--accent-2)) 85%, var(--accent))); box-shadow: 0 18px 40px -18px var(--accent); color: #fff; z-index: 1; }
.t-arc .box.b[hidden] { display: none; }
.t-arc .big { font-size: clamp(18px, 4vw, 30px); font-weight: 700; letter-spacing: -.03em; text-shadow: 0 2px 12px rgba(0, 0, 0, .25); white-space: nowrap; }
.t-arc .dim { position: absolute; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text-2); white-space: nowrap; background: var(--surface); border: 1px solid var(--border); padding: 1px 8px; border-radius: 999px; }
.t-arc .dim.w { left: 50%; top: -12px; transform: translateX(-50%); }
.t-arc .dim.h { left: -12px; top: 50%; transform: translate(-50%, -50%) rotate(-90deg); }
.t-arc .inputs { display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: end; }
.t-arc .sep { font-weight: 700; color: var(--muted); padding-bottom: 11px; }
`)
  const s = { mode: 'find', fw: 1920, fh: 1080, rw: 16, rh: 9, known: 'w', kv: 1280, cw: 4000, ch: 3000, tw: 16, th: 9 }

  const sceneBoxA = h('div', { class: 'box a' }, h('span', { class: 'big' }), h('span', { class: 'dim w' }), h('span', { class: 'dim h' }))
  const sceneBoxB = h('div', { class: 'box b', hidden: true }, h('span', { class: 'big' }))
  const scene = h('div', { class: 'scene', 'aria-hidden': 'true' }, sceneBoxA, sceneBoxB)
  const caption = h('div', { class: 'is-cap' })
  const out = h('div', { class: 'stack' })
  const tableOut = h('div')

  const setBox = (el, w, hh, scale) => {
    el.style.width = `${Math.max(10, w * scale)}px`
    el.style.height = `${Math.max(10, hh * scale)}px`
  }
  const fit = (w, hh, maxW = 300, maxH = 250) => Math.min(maxW / w, maxH / hh)

  // ----- inputs -----
  const mkW = (key, label) => numField(label, s[key], (n) => { s[key] = n; render() }, { min: 0 })
  const fw = mkW('fw', 'Width'), fh = mkW('fh', 'Height')
  const rw = mkW('rw', 'Ratio width'), rh = mkW('rh', 'Ratio height')
  const kv = numField('Value', s.kv, (n) => { s.kv = n; render() }, { min: 0 })
  const cw = mkW('cw', 'Original width'), ch = mkW('ch', 'Original height')
  const tw = mkW('tw', 'Target ratio width'), th = mkW('th', 'Target ratio height')
  const known = pills([['w', 'I know the width'], ['h', 'I know the height']], s.known, (v) => { s.known = v; render() }, 'Known side')

  const setRatio = (key, r) => {
    const [a, b] = key === 'r' ? [rw, rh] : [tw, th]
    s[`${key}w`] = r[0]; s[`${key}h`] = r[1]
    a.input.value = r[0]; b.input.value = r[1]
    render()
  }
  const presetChips = (key) => {
    const el = chipPicker(COMMON.map((c) => [c.label, c.label]), null, (v) => setRatio(key, COMMON.find((c) => c.label === v).r), 'Common ratios')
    el.refresh = () => {
      const c = COMMON.find((x) => Math.abs(x.r[0] / x.r[1] - s[`${key}w`] / s[`${key}h`]) < 1e-6)
      el.set(c ? c.label : null)
    }
    return el
  }
  const chipsR = presetChips('r'), chipsT = presetChips('t')

  const pairRow = (a, b) => h('div', { class: 'inputs' }, a, h('span', { class: 'sep', 'aria-hidden': 'true' }, 'x'), b)
  const ratioRow = (a, b) => h('div', { class: 'inputs' }, a, h('span', { class: 'sep', 'aria-hidden': 'true' }, ':'), b)

  const panels = {
    find: h('div', { class: 'stack' }, pairRow(fw, fh), h('p', { class: 'small muted' }, 'Pixels, inches, centimetres: any unit works because a ratio has no unit.')),
    solve: h('div', { class: 'stack' }, field('Ratio', chipsR), ratioRow(rw, rh), known, kv),
    crop: h('div', { class: 'stack' }, pairRow(cw, ch), field('Target ratio', chipsT), ratioRow(tw, th)),
  }

  const modeSeg = pills([['find', 'Find ratio'], ['solve', 'Solve a size'], ['crop', 'Crop or pad']], s.mode, (v) => { s.mode = v; render() }, 'Calculator mode')

  const swapBtn = (a, b, keys) => button('Swap', { icon: 'arrow-left-right', variant: 'ghost', size: 'sm', onClick: () => {
    ;[s[keys[0]], s[keys[1]]] = [s[keys[1]], s[keys[0]]]
    a.input.value = s[keys[0]]; b.input.value = s[keys[1]]
    render()
  } })
  panels.find.append(swapBtn(fw, fh, ['fw', 'fh']))
  panels.solve.append(swapBtn(rw, rh, ['rw', 'rh']))

  function render() {
    sceneBoxA.style.opacity = ''
    sceneBoxB.hidden = true
    for (const k of Object.keys(panels)) panels[k].hidden = k !== s.mode
    modeSeg.set(s.mode)
    known.set(s.known)
    chipsR.refresh(); chipsT.refresh()
    clear(tableOut)
    if (s.mode === 'find') renderFind()
    else if (s.mode === 'solve') renderSolve()
    else renderCrop()
  }

  const setScene = () => clear(caption)

  function renderFind() {
    if (!ok(s.fw, s.fh)) {
      clear(out, h('p', { class: 'muted' }, 'Enter a width and a height to see the ratio.'))
      sceneBoxA.querySelector('.big').textContent = '?'
      setBox(sceneBoxA, 16, 9, 18); setScene(); return
    }
    const [a, b] = reduceRatio(s.fw, s.fh)
    const common = closestCommon(s.fw, s.fh)
    const exact = Math.max(a, b) <= 99 && Number.isInteger(s.fw) && Number.isInteger(s.fh)
    const approx = common.off < 0.015
    const heroText = exact ? `${a}:${b}` : approx ? `${common.label}` : `${(s.fw / s.fh).toFixed(3)}:1`
    const heroHint = exact ? (approx && common.label !== `${a}:${b}` ? `Close to ${common.label}` : common.name) : approx ? `Closest common ratio (${(common.off * 100).toFixed(2)}% off). Exactly ${a}:${b}.` : 'No common ratio is close'
    sceneBoxA.querySelector('.big').textContent = heroText
    sceneBoxA.querySelector('.dim.w').textContent = formatNumber(s.fw, 2)
    sceneBoxA.querySelector('.dim.h').textContent = formatNumber(s.fh, 2)
    const sc = fit(s.fw, s.fh)
    setBox(sceneBoxA, s.fw, s.fh, sc)
    setScene()
    caption.append(h('span', orient(s.fw, s.fh)), h('span', 'Decimal ', h('b', (s.fw / s.fh).toFixed(4))))
    clear(out, tiles([
      { label: 'Aspect ratio', value: heroText, hint: heroHint, hero: true, copy: heroText },
      { label: 'Decimal', value: (s.fw / s.fh).toFixed(4), hint: `${(s.fh / s.fw).toFixed(4)} if flipped`, copy: (s.fw / s.fh).toFixed(4) },
      { label: 'Orientation', value: orient(s.fw, s.fh), hint: approx ? `${common.name}: ${common.use}` : undefined },
      { label: 'Exact ratio', value: `${a}:${b}`, hint: 'Smallest whole numbers', copy: `${a}:${b}` },
      { label: 'Megapixels', value: Number.isInteger(s.fw) ? ((s.fw * s.fh) / 1e6).toFixed(2) : '-', hint: 'If these are pixels' },
    ], { copy: copyText }), h('div', { class: 'row' }, button('Solve a new size for this ratio', { icon: 'arrow-right', variant: 'secondary', size: 'sm', onClick: () => {
      s.mode = 'solve'; s.rw = a; s.rh = b; rw.input.value = a; rh.input.value = b; render()
    } })))
    clear(tableOut, ratioTable(s.fw, s.fh))
  }

  function ratioTable(w, hh) {
    const rows = WIDTHS.map((x) => {
      const y = (x * hh) / w
      return [`${x}`, Number.isInteger(y) ? `${y}` : `${y.toFixed(1)} (${Math.round(y)})`, ((x * Math.round(y)) / 1e6).toFixed(2)]
    })
    return h('div', { class: 'stack tight' }, h('h3', { class: 'is-eyebrow' }, 'Same ratio at common widths'), table({ columns: ['Width', 'Height', { label: 'MP', num: true }], rows }))
  }

  function renderSolve() {
    if (!ok(s.rw, s.rh)) { clear(out, h('p', { class: 'muted' }, 'Enter both numbers of the ratio, for example 16 and 9.')); setScene(); return }
    const label = `${formatNumber(s.rw, 3)}:${formatNumber(s.rh, 3)}`
    sceneBoxA.querySelector('.big').textContent = label
    const val = s.kv
    if (!ok(val)) {
      setBox(sceneBoxA, s.rw, s.rh, fit(s.rw, s.rh)); setScene()
      sceneBoxA.querySelector('.dim.w').textContent = ''; sceneBoxA.querySelector('.dim.h').textContent = ''
      clear(out, h('p', { class: 'muted' }, `Enter the ${s.known === 'w' ? 'width' : 'height'} to get the other side.`))
      clear(tableOut, ratioTable(s.rw, s.rh))
      return
    }
    const other = solveSide(s.rw, s.rh, s.known, val)
    const W = s.known === 'w' ? val : other, H = s.known === 'h' ? val : other
    sceneBoxA.querySelector('.dim.w').textContent = formatNumber(W, 1)
    sceneBoxA.querySelector('.dim.h').textContent = formatNumber(H, 1)
    setBox(sceneBoxA, W, H, fit(W, H)); setScene()
    const rounded = Math.round(other * 100) / 100
    const whole = Math.abs(other - Math.round(other)) < 1e-6
    clear(out, tiles([
      { label: s.known === 'w' ? 'Height' : 'Width', value: formatNumber(rounded, 2), hint: whole ? 'Whole number' : `Rounds to ${Math.round(other)}`, hero: true, copy: String(rounded) },
      { label: 'Full size', value: `${formatNumber(Math.round(W), 0)} x ${formatNumber(Math.round(H), 0)}`, hint: 'Rounded', copy: `${Math.round(W)}x${Math.round(H)}` },
      { label: 'Ratio', value: label, hint: orient(s.rw, s.rh) },
      { label: 'Decimal', value: (s.rw / s.rh).toFixed(4) },
    ], { copy: copyText }))
    clear(tableOut, ratioTable(s.rw, s.rh))
  }

  function renderCrop() {
    if (!ok(s.cw, s.ch, s.tw, s.th)) { clear(out, h('p', { class: 'muted' }, 'Enter the original size and a target ratio.')); setScene(); return }
    const r = cropPad(s.cw, s.ch, s.tw, s.th)
    const label = `${formatNumber(s.tw, 3)}:${formatNumber(s.th, 3)}`
    const same = Math.abs(s.cw / s.ch - s.tw / s.th) < 1e-6
    // Scene: original (outer, solid) and the crop (inner). Pad is explained in the tiles.
    const sc = fit(Math.max(s.cw, r.pad.w), Math.max(s.ch, r.pad.h), 300, 250)
    setBox(sceneBoxA, s.cw, s.ch, sc)
    sceneBoxA.style.opacity = '.55'
    sceneBoxA.querySelector('.big').textContent = ''
    sceneBoxA.querySelector('.dim.w').textContent = formatNumber(s.cw, 0)
    sceneBoxA.querySelector('.dim.h').textContent = formatNumber(s.ch, 0)
    sceneBoxB.hidden = false
    setBox(sceneBoxB, r.crop.w, r.crop.h, sc)
    sceneBoxB.querySelector('.big').textContent = label
    clear(caption, h('span', 'Faded: your image'), h('span', 'Solid: the crop'))
    clear(out, same ? h('p', { class: 'muted' }, 'The image already has this ratio. Nothing to crop or pad.') : tiles([
      { label: 'Crop to', value: `${r.crop.w} x ${r.crop.h}`, hint: `Offset ${r.crop.left}, ${r.crop.top} px. Loses ${(r.crop.lost * 100).toFixed(1)}% of the picture`, hero: true, copy: `${r.crop.w}x${r.crop.h}` },
      { label: 'Or pad to', value: `${r.pad.w} x ${r.pad.h}`, hint: `Adds ${r.pad.addW} px wide, ${r.pad.addH} px tall. Keeps the whole picture`, copy: `${r.pad.w}x${r.pad.h}` },
      { label: 'Crop offset', value: `${r.crop.left}, ${r.crop.top}`, hint: 'Left, top for a centered crop' },
      { label: 'Target ratio', value: label, hint: orient(s.tw, s.th) },
    ], { copy: copyText }))
    clear(tableOut)
  }

  root.append(h('div', { class: 't-arc stack' },
    split(
      h('div', { class: 'stack' }, panel(h('div', { class: 'stack' }, modeSeg, ...Object.values(panels)))),
      h('div', { class: 'stack' }, stage(scene, caption), out, tableOut),
      'wide-right')))
  render()
}
