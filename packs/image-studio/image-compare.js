// Image diff: highlight pixel differences with a threshold, plus slider, side-by-side and onion-skin comparison.
import { h, panel, split, field, button, clear, download, toast, rangeField, toggle, onCleanup, formatNumber } from '../../lib/ui.js'
import { loadImage } from '../../lib/image.js'
import { addStyle, heroDrop, stage, pills, chipPicker, tiles, compareSlider, newCanvas, scaled, encode, stem, sampleCanvas, frame, hexToRgb, rgbToHex, IMG_ACCEPT, yieldToMain } from './_shared.js'

const MAX_EDGE = 3000

/**
 * Compare two same-size RGBA buffers. threshold is 0..255 (largest channel difference that still counts as "same").
 * Returns {changed, total, bbox, mae, psnr, delta (Uint8Array per pixel, largest channel difference)}.
 */
export function diffPixels(a, b, w, hh, threshold = 20) {
  const total = w * hh
  const delta = new Uint8Array(total)
  let changed = 0, sum = 0, sq = 0, x0 = w, y0 = hh, x1 = -1, y1 = -1
  for (let i = 0; i < total; i++) {
    const o = i * 4
    const aa = a[o + 3] / 255, ba = b[o + 3] / 255
    const dr = Math.abs(a[o] * aa + 255 * (1 - aa) - (b[o] * ba + 255 * (1 - ba)))
    const dg = Math.abs(a[o + 1] * aa + 255 * (1 - aa) - (b[o + 1] * ba + 255 * (1 - ba)))
    const db = Math.abs(a[o + 2] * aa + 255 * (1 - aa) - (b[o + 2] * ba + 255 * (1 - ba)))
    const d = Math.max(dr, dg, db)
    delta[i] = d
    sum += dr + dg + db
    sq += dr * dr + dg * dg + db * db
    if (d > threshold) {
      changed++
      const x = i % w, y = (i / w) | 0
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
    }
  }
  const mse = sq / (total * 3)
  return { changed, total, bbox: changed ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null, mae: sum / (total * 3), psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse), delta }
}

const HEAT = [[0, 12, 12, 40], [0.25, 40, 60, 200], [0.5, 30, 200, 200], [0.75, 250, 220, 40], [1, 230, 40, 40]]
const heat = (t) => {
  for (let i = 1; i < HEAT.length; i++) if (t <= HEAT[i][0]) { const [t0, ...c0] = HEAT[i - 1], [t1, ...c1] = HEAT[i]; const k = (t - t0) / (t1 - t0); return c0.map((v, j) => v + (c1[j] - v) * k) }
  return HEAT.at(-1).slice(1)
}

const COLORS = [['#ff2d55', 'Red'], ['#ff00ff', 'Magenta'], ['#ffd60a', 'Yellow'], ['#00e5ff', 'Cyan']]

export function mount(root) {
  addStyle('is-cmpx', `
.t-cmp .slots { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.t-cmp .slot { display: grid; gap: 8px; min-width: 0; }
.t-cmp .slot .nm { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted); min-height: 28px; }
.t-cmp .slot .nm canvas { width: 28px; height: 28px; border-radius: 8px; object-fit: cover; flex: none; }
.t-cmp .slot .nm span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.t-cmp .slot .tagline { font-size: 12px; font-weight: 650; text-transform: uppercase; letter-spacing: .1em; color: var(--accent); }
.t-cmp .pvbox { position: relative; }
.t-cmp .pvbox canvas.diff { display: block; max-width: 100%; max-height: 560px; width: auto; height: auto; margin: 0 auto; cursor: crosshair; }
.t-cmp .sbs { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.t-cmp .sbs figure { margin: 0; display: grid; gap: 6px; text-align: center; font-size: 12.5px; color: var(--muted); min-width: 0; }
.t-cmp .sbs canvas { width: 100%; height: auto; display: block; border-radius: 12px; box-shadow: 0 18px 36px -22px rgba(10, 10, 30, .5), 0 0 0 1px rgba(0, 0, 0, .08); }
.t-cmp .onion { position: relative; width: fit-content; max-width: 100%; margin: 0 auto; }
.t-cmp .onion canvas { display: block; max-width: 100%; max-height: 560px; width: auto; height: auto; }
.t-cmp .onion canvas + canvas { position: absolute; inset: 0; width: 100%; height: 100%; transition: opacity .35s; }
.t-cmp .probe { min-height: 22px; font: 12px var(--mono); color: var(--muted); text-align: center; margin-top: 8px; display: flex; gap: 8px; justify-content: center; align-items: center; flex-wrap: wrap; }
.t-cmp .probe i { display: inline-block; width: 14px; height: 14px; border-radius: 4px; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .2); vertical-align: -2px; }
@media (max-width: 560px) { .t-cmp .slots { grid-template-columns: minmax(0, 1fr); } }
`)
  const s = { mode: 'diff', view: 'highlight', threshold: 8, color: '#ff2d55', box: true, size: 'stretch', opacity: 50, blink: false }
  const items = [null, null]
  let ca = null, cb = null, res = null, dataA = null, dataB = null, blinkTimer = 0
  onCleanup(() => clearInterval(blinkTimer))

  const thumbOf = (it) => { const c = newCanvas(it.thumb.width, it.thumb.height); c.getContext('2d').drawImage(it.thumb, 0, 0); return c }
  const mkSlot = (i, text) => {
    const nm = h('div', { class: 'nm' })
    const drop = heroDrop({ accept: IMG_ACCEPT, paste: i === 0, label: `Drop image ${text}`, hint: 'Click, drop or paste', onFiles: ([f]) => load(i, f) })
    const el = h('div', { class: 'slot' }, h('span', { class: 'tagline' }, `Image ${text}`), drop, nm)
    el.drop = drop; el.nm = nm
    return el
  }
  const slots = [mkSlot(0, 'A'), mkSlot(1, 'B')]
  const sampleBtn = button('Try a sample pair', { icon: 'wand-sparkles', variant: 'ghost', size: 'sm', onClick: async () => {
    const c = sampleCanvas(1, 1000, 700)
    const c2 = newCanvas(1000, 700); const g = c2.getContext('2d'); g.drawImage(c, 0, 0)
    g.fillStyle = '#ffd60a'; g.fillRect(180, 120, 150, 90); g.fillStyle = '#111'; g.beginPath(); g.arc(720, 430, 60, 0, Math.PI * 2); g.fill()
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(0, 560, 1000, 14)
    const mk = async (cv, name) => new File([await encode(cv, 'image/png')], name, { type: 'image/png' })
    await load(0, await mk(c, 'sample-a.png')); await load(1, await mk(c2, 'sample-b.png'))
  } })

  const work = h('div', { class: 'stack', hidden: true })
  const pvHost = h('div', { class: 'pvbox' })
  const caption = h('div', { class: 'is-cap' })
  const probe = h('div', { class: 'probe' })
  const resultTiles = h('div')
  const note = h('div')

  const modeSeg = pills([['diff', 'Pixel diff'], ['slider', 'Slider'], ['side', 'Side by side'], ['onion', 'Onion skin']], s.mode, (v) => { s.mode = v; update() }, 'View')
  const viewSeg = pills([['highlight', 'Highlight'], ['heat', 'Heatmap'], ['mask', 'Mask']], s.view, (v) => { s.view = v; update() }, 'Diff style')
  const thr = rangeField('Sensitivity threshold', { min: 0, max: 60, value: s.threshold, format: (v) => (v === 0 ? 'Any change' : `Ignore changes under ${v}%`), hint: 'Raise it to ignore JPEG noise and tiny shifts.', onInput: (v) => { s.threshold = v; soon() } })
  const colorChips = chipPicker(COLORS.map(([c, l]) => [c, l]), s.color, (v) => { s.color = v; update() }, 'Highlight color')
  const boxT = toggle('Draw a box around the changes', true, (v) => { s.box = v; update() })
  const sizeSeg = pills([['stretch', 'Stretch B to A'], ['align', 'Align top-left']], s.size, (v) => { s.size = v; prepare() }, 'When sizes differ')
  const opF = rangeField('Image B opacity', { min: 0, max: 100, value: s.opacity, format: (v) => `${v}%`, onInput: (v) => { s.opacity = v; applyOpacity() } })
  const blinkT = toggle('Blink between A and B', false, (v) => { s.blink = v; blink() })
  const saveBtn = button('Download diff image', { icon: 'download', variant: 'primary', block: true })
  const diffBlock = h('div', { class: 'stack' }, field('Diff style', viewSeg), thr, field('Highlight color', colorChips), boxT)
  const onionBlock = h('div', { class: 'stack' }, opF, blinkT)
  const sizeField = field('The images are different sizes', sizeSeg)
  const controls = panel(h('div', { class: 'stack' }, field('View', modeSeg), sizeField, diffBlock, onionBlock, saveBtn))
  const soon = frame(() => update())

  function prepare() {
    if (!(items[0] && items[1])) return
    const A = items[0], B = items[1]
    const k = Math.min(1, MAX_EDGE / Math.max(A.w, A.h))
    const w = Math.max(1, Math.round(A.w * k)), hh = Math.max(1, Math.round(A.h * k))
    ca = newCanvas(w, hh); cb = newCanvas(w, hh)
    const ga = ca.getContext('2d', { willReadFrequently: true }), gb = cb.getContext('2d', { willReadFrequently: true })
    ga.imageSmoothingQuality = gb.imageSmoothingQuality = 'high'
    ga.drawImage(A.img, 0, 0, w, hh)
    const differ = A.w !== B.w || A.h !== B.h
    sizeField.hidden = !differ
    if (differ && s.size === 'align') gb.drawImage(B.img, 0, 0, B.w * k, B.h * k)
    else gb.drawImage(B.img, 0, 0, w, hh)
    dataA = ga.getImageData(0, 0, w, hh); dataB = gb.getImageData(0, 0, w, hh)
    clear(note, differ ? h('p', { class: 'small muted' }, `A is ${A.w} x ${A.h} and B is ${B.w} x ${B.h}. ${s.size === 'stretch' ? 'B is stretched to A\'s size, so shifted content will show as changes.' : 'B is placed at the top-left without scaling.'}`) : null)
    update()
  }

  function runDiff() {
    res = diffPixels(dataA.data, dataB.data, ca.width, ca.height, s.threshold * 2.55)
  }

  function renderDiffCanvas() {
    const { width: w, height: hh } = ca
    const c = newCanvas(w, hh), g = c.getContext('2d')
    const out = g.createImageData(w, hh), o = out.data, d = res.delta, a = dataA.data
    const [hr, hg, hb] = hexToRgb(s.color), th = s.threshold * 2.55
    for (let i = 0; i < d.length; i++) {
      const p = i * 4
      if (s.view === 'highlight') {
        if (d[i] > th) { o[p] = hr; o[p + 1] = hg; o[p + 2] = hb; o[p + 3] = 255 }
        else { const y = 0.3 * a[p] + 0.59 * a[p + 1] + 0.11 * a[p + 2]; const v = 255 - (255 - y) * 0.35; o[p] = o[p + 1] = o[p + 2] = v; o[p + 3] = 255 }
      } else if (s.view === 'heat') {
        const col = d[i] > th ? heat(d[i] / 255) : [12, 12, 28]
        o[p] = col[0]; o[p + 1] = col[1]; o[p + 2] = col[2]; o[p + 3] = 255
      } else { const v = d[i] > th ? 255 : 0; o[p] = o[p + 1] = o[p + 2] = v; o[p + 3] = 255 }
    }
    g.putImageData(out, 0, 0)
    if (s.box && res.bbox && res.changed) {
      g.strokeStyle = s.view === 'highlight' ? '#111' : '#ffffff'; g.lineWidth = Math.max(2, w / 400); g.setLineDash([g.lineWidth * 4, g.lineWidth * 3])
      const m = g.lineWidth * 2
      g.strokeRect(res.bbox.x - m, res.bbox.y - m, res.bbox.w + m * 2, res.bbox.h + m * 2)
    }
    c.classList.add('diff', 'is-frame')
    return c
  }

  function update() {
    if (!(dataA && dataB)) return
    modeSeg.set(s.mode); viewSeg.set(s.view); sizeSeg.set(s.size); colorChips.set(s.color)
    diffBlock.hidden = s.mode !== 'diff'; onionBlock.hidden = s.mode !== 'onion'; saveBtn.hidden = s.mode !== 'diff'
    clearInterval(blinkTimer)
    runDiff()
    const pct = (res.changed / res.total) * 100
    const same = res.changed === 0
    clear(resultTiles, tiles([
      { label: 'Changed pixels', value: same ? 'None' : `${pct < 0.01 ? '<0.01' : pct.toFixed(pct < 1 ? 2 : 1)}%`, hint: same ? 'The images match at this sensitivity' : `${formatNumber(res.changed, 0)} of ${formatNumber(res.total, 0)}`, hero: true, good: same },
      { label: 'Similarity', value: `${(100 - pct).toFixed(pct < 1 ? 2 : 1)}%`, hint: 'Pixels within the threshold' },
      { label: 'Average difference', value: `${((res.mae / 255) * 100).toFixed(2)}%`, hint: 'Mean error across all channels' },
      { label: 'PSNR', value: Number.isFinite(res.psnr) ? `${res.psnr.toFixed(1)} dB` : 'Identical', hint: 'Higher is closer (above 40 dB is near-invisible)' },
      res.bbox ? { label: 'Changes lie within', value: `${res.bbox.w} x ${res.bbox.h}`, hint: `Starting at ${res.bbox.x}, ${res.bbox.y}` } : null,
    ]))
    clear(caption, h('span', h('b', `${ca.width} x ${ca.height}`), ' px compared'))
    clear(probe)
    if (s.mode === 'diff') {
      const c = renderDiffCanvas()
      c.addEventListener('pointermove', (e) => {
        const r = c.getBoundingClientRect()
        const x = Math.min(c.width - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * c.width))), y = Math.min(c.height - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * c.height)))
        const p = (y * c.width + x) * 4
        const A = [dataA.data[p], dataA.data[p + 1], dataA.data[p + 2]], B = [dataB.data[p], dataB.data[p + 1], dataB.data[p + 2]]
        clear(probe, `${x}, ${y}`, h('i', { style: { background: rgbToHex(A) } }), `A ${rgbToHex(A)}`, h('i', { style: { background: rgbToHex(B) } }), `B ${rgbToHex(B)}`, `diff ${res.delta[y * c.width + x]}`)
      })
      c.addEventListener('pointerleave', () => clear(probe))
      clear(pvHost, c)
    } else if (s.mode === 'slider') {
      const sl = compareSlider({ a: copy(ca), b: copy(cb), labelA: 'A', labelB: 'B', width: ca.width, height: ca.height })
      clear(pvHost, sl)
      if (!update.swept) { update.swept = true; sl.sweep() }
    } else if (s.mode === 'side') {
      clear(pvHost, h('div', { class: 'sbs' }, h('figure', copy(ca), h('figcaption', 'A')), h('figure', copy(cb), h('figcaption', 'B'))))
    } else {
      const top = copy(cb)
      clear(pvHost, h('div', { class: 'onion' }, copy(ca), top))
      applyOpacity(); blink()
    }
  }
  const copy = (c) => { const n = newCanvas(c.width, c.height); n.getContext('2d').drawImage(c, 0, 0); return n }
  function applyOpacity() { const top = pvHost.querySelector('.onion canvas + canvas'); if (top) top.style.opacity = s.opacity / 100 }
  function blink() {
    clearInterval(blinkTimer)
    const top = pvHost.querySelector('.onion canvas + canvas')
    if (!top || !s.blink) { applyOpacity(); return }
    let on = false
    blinkTimer = setInterval(() => { on = !on; top.style.opacity = on ? 1 : 0 }, 700)
  }

  saveBtn.addEventListener('click', async () => {
    try { download(await encode(renderDiffCanvas(), 'image/png'), `${stem(items[0].name)}-vs-${stem(items[1].name)}-diff.png`) } catch (e) { toast(e.message, 'error') }
  })

  function refreshSlots() {
    slots.forEach((slot, i) => {
      const it = items[i]
      clear(slot.nm, it ? [thumbOf(it), h('span', `${it.name} (${it.w} x ${it.h})`)] : '')
      slot.drop.setCompact(!!it)
    })
    work.hidden = !(items[0] && items[1])
  }
  async function load(i, file) {
    try {
      const img = await loadImage(file)
      items[i] = { img, w: img.naturalWidth, h: img.naturalHeight, name: file.name, thumb: scaled(img, 56) }
      update.swept = false
      refreshSlots()
      prepare()
      await yieldToMain()
    } catch (e) { toast(e.message, 'error') }
  }

  work.append(split(h('div', { class: 'stack' }, stage(pvHost, probe, caption), note), h('div', { class: 'stack' }, resultTiles, controls), 'wide-left'))
  root.append(h('div', { class: 't-cmp stack' }, h('div', { class: 'slots' }, ...slots), h('div', { class: 'row' }, sampleBtn), work))
}
