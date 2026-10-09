// Print size calculator (pixels <-> print size <-> DPI). Also serves dpi-calculator via params.solve = 'dpi'.
import { h, panel, split, field, table, button, copyText, clear, formatNumber, onCleanup, dropzone } from '../../lib/ui.js'
import { loadImage } from '../../lib/image.js'
import { addStyle, pills, chipPicker, tiles, numField, stage, sampleCanvas, newCanvas, frame, IMG_ACCEPT, clamp } from './_shared.js'

export const UNIT_IN = { in: 1, cm: 1 / 2.54, mm: 1 / 25.4 }
export const toInches = (v, unit) => v * UNIT_IN[unit]
export const fromInches = (v, unit) => v / UNIT_IN[unit]
/** DPI when the image fills the print (the smaller of the two axes, so nothing is stretched). */
export const fillDpi = (pxW, pxH, inW, inH) => Math.min(pxW / inW, pxH / inH)
/** DPI if the whole image is fitted inside the print area with borders. */
export const fitDpi = (pxW, pxH, inW, inH) => Math.max(pxW / inW, pxH / inH)
/** Share of the image that is cropped away when it fills a print of a different shape (0 when the shapes match). */
export function cropShare(pxW, pxH, inW, inH) {
  const a = pxW / pxH, b = inW / inH
  return a > b ? 1 - b / a : 1 - a / b
}
/** Distance (inches) at which a viewer with normal eyesight can no longer separate pixels at this DPI. */
export const viewDistanceIn = (dpi) => 3438 / dpi

export const RATINGS = [
  { id: 'poor', label: 'Poor', min: 0, note: 'Pixels will show, even on a small print.' },
  { id: 'low', label: 'Low', min: 100, note: 'Fine for big posters seen from a few steps away.' },
  { id: 'fair', label: 'Fair', min: 150, note: 'Acceptable at arm\'s length. Most banners and posters.' },
  { id: 'good', label: 'Good', min: 200, note: 'Sharp for nearly all prints.' },
  { id: 'excellent', label: 'Excellent', min: 300, note: 'Photo-lab quality, sharp even up close.' },
]
export const rate = (dpi) => [...RATINGS].reverse().find((r) => dpi >= r.min) || RATINGS[0]

/** Standard sizes in inches (portrait). */
export const PAPERS = [
  ['4 x 6 in', 4, 6], ['5 x 7 in', 5, 7], ['6 x 8 in', 6, 8], ['8 x 10 in', 8, 10], ['Letter', 8.5, 11], ['11 x 14 in', 11, 14],
  ['12 x 18 in', 12, 18], ['16 x 20 in', 16, 20], ['20 x 30 in', 20, 30], ['24 x 36 in', 24, 36],
  ['A6', 105 / 25.4, 148 / 25.4], ['A5', 148 / 25.4, 210 / 25.4], ['A4', 210 / 25.4, 297 / 25.4], ['A3', 297 / 25.4, 420 / 25.4], ['A2', 420 / 25.4, 594 / 25.4], ['A1', 594 / 25.4, 841 / 25.4],
  ['Passport 35 x 45 mm', 35 / 25.4, 45 / 25.4], ['Business card', 2, 3.5],
].map(([name, w, hh]) => ({ name, w, h: hh }))

const quick = ['4 x 6 in', '5 x 7 in', '8 x 10 in', 'Letter', 'A5', 'A4', 'A3', '16 x 20 in', 'A2', '24 x 36 in']
const DPIS = [72, 150, 200, 300, 600]
const pos = (dpi) => {
  const bp = [0, 100, 150, 200, 300, 450], to = [0, 0.2, 0.4, 0.6, 0.8, 1]
  const d = clamp(dpi, 0, 450)
  for (let i = 1; i < bp.length; i++) if (d <= bp[i]) return to[i - 1] + ((d - bp[i - 1]) / (bp[i] - bp[i - 1])) * (to[i] - to[i - 1])
  return 1
}
const fmtIn = (v) => formatNumber(v, 2)
const ok = (...n) => n.every((x) => Number.isFinite(x) && x > 0)

function readImageSize(file) {
  return loadImage(file).then((img) => ({ img, w: img.naturalWidth, h: img.naturalHeight }))
}

export function mount(root, { params }) {
  const dpiOnly = params?.solve === 'dpi'
  addStyle('is-print', `
.t-print .gauge { position: relative; height: 12px; border-radius: 999px; display: flex; gap: 3px; margin: 44px 4px 4px; }
.t-print .gauge i { flex: 1; border-radius: 4px; opacity: .85; }
.t-print .gauge i:nth-child(1) { background: var(--danger); } .t-print .gauge i:nth-child(2) { background: var(--warning); }
.t-print .gauge i:nth-child(3) { background: var(--info); } .t-print .gauge i:nth-child(4) { background: var(--success); }
.t-print .gauge i:nth-child(5) { background: linear-gradient(90deg, var(--accent), var(--accent-2)); }
.t-print .pin { position: absolute; top: -22px; left: calc(var(--pos, 0) * 100%); width: 0; transition: left .6s var(--spring); }
.t-print .pin b { position: absolute; transform: translateX(-50%); bottom: 0; font-size: 12px; background: var(--text); color: var(--bg); padding: 1px 8px; border-radius: 999px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.t-print .pin::after { content: ""; position: absolute; left: -5px; top: 16px; border: 5px solid transparent; border-top-color: var(--text); }
.t-print .gl { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--muted); margin: 6px 4px 0; }
.t-print .viz { display: flex; gap: 18px; flex-wrap: wrap; align-items: center; justify-content: center; }
.t-print .sheet { position: relative; flex: none; display: grid; place-items: center; background: #fff; color: #333; font-size: 12px; font-weight: 600; text-align: center; padding: 4px; overflow: hidden;
  border-radius: 4px; box-shadow: 0 18px 36px -16px rgba(10, 10, 30, .5), 0 0 0 1px rgba(0, 0, 0, .08); transition: width .5s var(--spring), height .5s var(--spring); }
.t-print .sheet img, .t-print .sheet .ph { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.t-print .sheet .ph { background: linear-gradient(135deg, #818cf8, #f472b6 60%, #fdba74); }
.t-print .sheet span { position: relative; background: rgba(255, 255, 255, .85); padding: 2px 7px; border-radius: 999px; font-variant-numeric: tabular-nums; }
.t-print .loupe { display: grid; gap: 6px; justify-items: center; }
.t-print .loupe canvas { width: 300px; max-width: 100%; aspect-ratio: 3 / 2; image-rendering: pixelated; border-radius: 14px; box-shadow: 0 20px 40px -22px rgba(10, 10, 30, .6), 0 0 0 1px rgba(0, 0, 0, .1); background: #ddd; }
.t-print .loupe small { font-size: 12px; color: var(--muted); }
.t-print .inputs { display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: end; }
.t-print .sep { font-weight: 700; color: var(--muted); padding-bottom: 11px; }
.t-print .badge-q { display: inline-flex; align-items: center; height: 22px; padding: 0 9px; border-radius: 999px; font-size: 12px; font-weight: 600; color: #fff; }
.t-print .badge-q.poor { background: var(--danger); } .t-print .badge-q.low { background: var(--warning); } .t-print .badge-q.fair { background: var(--info); }
.t-print .badge-q.good { background: var(--success); } .t-print .badge-q.excellent { background: linear-gradient(90deg, var(--accent), var(--accent-2)); }
:root[data-theme="dark"] .t-print .badge-q { color: #0b0b12; }
.t-print .photo-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
`)

  const s = { mode: dpiOnly ? 'dpi' : 'size', unit: 'in', pxW: 3000, pxH: 2000, dpi: 300, sizeW: dpiOnly ? 8 : 8, sizeH: dpiOnly ? 10 : 10 }
  if (dpiOnly) { s.pxW = 4000; s.pxH = 3000; s.sizeW = 10; s.sizeH = 8 }
  let photo = null // {img, w, h, url}
  let sampleSrc = null

  const inputs = {}
  const mk = (key, label, opts = {}) => {
    inputs[key] = numField(label, s[key], (n) => { s[key] = n; render() }, { min: 0, ...opts })
    return inputs[key]
  }
  const setVal = (key, v) => { s[key] = v; inputs[key].input.value = v }
  const dpiField = mk('dpi', 'DPI (pixels per inch)')
  const dpiChips = chipPicker(DPIS.map((d) => [d, String(d)]), s.dpi, (d) => { setVal('dpi', d); render() }, 'Common DPI values')
  const unitSeg = pills([['in', 'Inches'], ['cm', 'cm'], ['mm', 'mm']], s.unit, (u) => changeUnit(u), 'Unit')
  const paperChips = chipPicker(quick.map((n) => [n, n]), null, (n) => {
    const p = PAPERS.find((x) => x.name === n)
    let [w, hh] = [p.w, p.h]
    if (s.mode === 'dpi' && ok(s.pxW, s.pxH) && (s.pxW >= s.pxH) !== (w >= hh)) [w, hh] = [hh, w]
    setVal('sizeW', round(fromInches(w, s.unit))); setVal('sizeH', round(fromInches(hh, s.unit)))
    render()
  }, 'Paper sizes')
  const round = (v) => Math.round(v * 100) / 100

  function changeUnit(u) {
    if (ok(s.sizeW, s.sizeH)) { setVal('sizeW', round(fromInches(toInches(s.sizeW, s.unit), u))); setVal('sizeH', round(fromInches(toInches(s.sizeH, s.unit), u))) }
    s.unit = u
    render()
  }

  const pxRow = h('div', { class: 'inputs' }, mk('pxW', 'Width (px)'), h('span', { class: 'sep', 'aria-hidden': 'true' }, 'x'), mk('pxH', 'Height (px)'))
  const sizeRow = h('div', { class: 'inputs' }, mk('sizeW', 'Print width'), h('span', { class: 'sep', 'aria-hidden': 'true' }, 'x'), mk('sizeH', 'Print height'))
  const dpiBox = h('div', { class: 'stack tight' }, dpiField, dpiChips)
  const swapPx = button('Swap sides', { icon: 'arrow-left-right', variant: 'ghost', size: 'sm', onClick: () => { const a = s.pxW; setVal('pxW', s.pxH); setVal('pxH', a); render() } })
  const swapSize = button('Rotate print', { icon: 'rotate-cw', variant: 'ghost', size: 'sm', onClick: () => { const a = s.sizeW; setVal('sizeW', s.sizeH); setVal('sizeH', a); render() } })

  // photo drop (dpi mode and also handy in size mode)
  const photoInfo = h('span', { class: 'small muted' })
  const zone = dropzone({ accept: IMG_ACCEPT, compact: true, label: 'Use a photo to fill in the pixels', hint: 'Optional. Nothing is uploaded.', onFiles: async ([f]) => {
    try {
      const r = await readImageSize(f)
      if (photo?.url) URL.revokeObjectURL(photo.url)
      photo = { ...r, url: URL.createObjectURL(f), name: f.name }
      setVal('pxW', r.w); setVal('pxH', r.h)
      if (s.mode === 'dpi' && ok(s.sizeW, s.sizeH) && (r.w >= r.h) !== (s.sizeW >= s.sizeH)) { const a = s.sizeW; setVal('sizeW', s.sizeH); setVal('sizeH', a) }
      photoInfo.textContent = `${f.name}: ${r.w} x ${r.h} px`
      render()
    } catch (e) { photoInfo.textContent = e.message }
  } })
  onCleanup(() => { if (photo?.url) URL.revokeObjectURL(photo.url) })

  const modes = [['size', 'Pixels to size'], ['pixels', 'Size to pixels'], ['dpi', 'Find the DPI']]
  const modeSeg = dpiOnly ? null : pills(modes, s.mode, (v) => { s.mode = v; render() }, 'What to calculate')

  // The same controls appear in several modes, so lay them out once and show or hide the groups per mode.
  const grpPx = h('div', { class: 'stack' }, pxRow, swapPx)
  const grpSize = h('div', { class: 'stack' }, field('Quick sizes', paperChips), sizeRow, swapSize)
  const grpDpi = dpiBox
  const grpUnit = field('Unit', unitSeg)
  const grpPhoto = h('div', { class: 'stack tight' }, zone, photoInfo)
  const controls = h('div', { class: 'stack' }, modeSeg, grpPhoto, grpPx, grpSize, grpUnit, grpDpi)

  // ----- visuals -----
  const sheet = h('div', { class: 'sheet' }, h('div', { class: 'ph' }), h('span'))
  const loupeCv = h('canvas', { width: 300, height: 200, 'aria-label': 'Zoomed preview of print sharpness', role: 'img' })
  const loupeCap = h('small')
  const gaugeBox = h('div')
  const viz = h('div', { class: 'viz' }, sheet, h('div', { class: 'loupe' }, loupeCv, loupeCap))
  const resultOut = h('div', { class: 'stack' })
  const tableOut = h('div', { class: 'stack tight' })

  function gauge(dpi) {
    const r = rate(dpi)
    return h('div', { style: { '--pos': pos(dpi) } },
      h('div', { class: 'gauge', role: 'img', 'aria-label': `${Math.round(dpi)} DPI, ${r.label}` }, ...RATINGS.map(() => h('i')), h('span', { class: 'pin' }, h('b', `${Math.round(dpi)} DPI`))),
      h('div', { class: 'gl' }, h('span', 'Poor'), h('span', '100'), h('span', '150'), h('span', '200'), h('span', '300+')))
  }
  const chip = (dpi) => { const r = rate(dpi); return h('span', { class: ['badge-q', r.id] }, r.label) }

  const drawLoupe = frame(() => {
    const dpi = clamp(s.effDpi || 300, 20, 1200)
    const W = 300, H = 200
    const ctx = loupeCv.getContext('2d')
    let src, sw, sh, sx, sy
    if (photo) {
      const frac = ok(s.effW) ? Math.min(1, 1 / s.effW) : 0.3
      sw = photo.w * frac; sh = sw * (2 / 3)
      if (sh > photo.h) { sh = photo.h; sw = sh * 1.5 }
      src = photo.img; sx = (photo.w - sw) / 2; sy = (photo.h - sh) / 2
    } else {
      sampleSrc ||= sampleCanvas(0, 1800, 1200)
      src = sampleSrc; sw = 420; sh = 280; sx = 800; sy = 520
    }
    const pw = clamp(Math.round(dpi), 2, 900), ph = Math.max(2, Math.round(pw / 1.5))
    const off = newCanvas(pw, ph)
    const o = off.getContext('2d')
    o.imageSmoothingQuality = 'high'
    o.drawImage(src, sx, sy, sw, sh, 0, 0, pw, ph)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(off, 0, 0, W, H)
    loupeCap.textContent = `Close-up of 1 inch of the print at ${Math.round(dpi)} DPI`
  })

  function setSheet(wIn, hIn, label) {
    const k = Math.min(170 / wIn, 190 / hIn)
    sheet.style.width = `${Math.max(46, wIn * k)}px`
    sheet.style.height = `${Math.max(46, hIn * k)}px`
    sheet.querySelector('span').textContent = label
    const ph = sheet.querySelector('.ph, img')
    if (photo && !(ph instanceof HTMLImageElement)) ph.replaceWith(h('img', { src: photo.url, alt: '' }))
    else if (!photo && ph instanceof HTMLImageElement) ph.replaceWith(h('div', { class: 'ph' }))
    else if (photo && ph.src !== photo.url) ph.src = photo.url
  }

  const cp = (t) => copyText(String(t))

  function render() {
    const m = s.mode
    modeSeg?.set(m)
    unitSeg.set(s.unit)
    dpiChips.set(DPIS.includes(s.dpi) ? s.dpi : null)
    paperChips.set(null)
    grpPhoto.hidden = !(m === 'dpi' || m === 'size')
    grpPx.hidden = m === 'pixels'
    grpSize.hidden = m === 'size'
    grpDpi.hidden = m === 'dpi'
    clear(resultOut); clear(tableOut); clear(gaugeBox)
    s.effDpi = null; s.effW = null
    if (m === 'size') size()
    else if (m === 'pixels') pixels()
    else dpi()
    if (s.effDpi) { gaugeBox.append(gauge(s.effDpi)); drawLoupe() }
    viz.hidden = !s.effDpi
    gaugeBox.hidden = !s.effDpi
  }

  const need = (txt) => clear(resultOut, h('p', { class: 'muted' }, txt))

  function size() {
    if (!ok(s.pxW, s.pxH, s.dpi)) return need('Enter the pixel width, height and a DPI to see the print size.')
    const wIn = s.pxW / s.dpi, hIn = s.pxH / s.dpi
    s.effDpi = s.dpi; s.effW = wIn
    setSheet(wIn, hIn, `${fmtIn(fromInches(wIn, s.unit))} x ${fmtIn(fromInches(hIn, s.unit))} ${s.unit}`)
    const r = rate(s.dpi)
    const biggest = PAPERS.filter((p) => Math.min(p.w, p.h) <= Math.min(wIn, hIn) + 1e-9 && Math.max(p.w, p.h) <= Math.max(wIn, hIn) + 1e-9).sort((a, b) => b.w * b.h - a.w * a.h)[0]
    const other = s.unit === 'in' ? 'cm' : 'in'
    clear(resultOut, tiles([
      { label: `Print size (${s.unit})`, value: `${fmtIn(fromInches(wIn, s.unit))} x ${fmtIn(fromInches(hIn, s.unit))}`, hint: `${s.pxW} x ${s.pxH} px at ${s.dpi} DPI`, hero: true, copy: `${fmtIn(fromInches(wIn, s.unit))} x ${fmtIn(fromInches(hIn, s.unit))} ${s.unit}` },
      { label: `Also in ${other}`, value: `${fmtIn(fromInches(wIn, other))} x ${fmtIn(fromInches(hIn, other))}`, copy: `${fmtIn(fromInches(wIn, other))} x ${fmtIn(fromInches(hIn, other))} ${other}` },
      { label: 'Quality', value: r.label, hint: r.note, good: r.id === 'excellent' || r.id === 'good', bad: r.id === 'poor' },
      { label: 'Biggest standard size', value: biggest ? biggest.name : 'Smaller than 4 x 6', hint: 'That fits at this DPI without enlarging' },
      { label: 'Pixels blend from', value: `${fmtIn(fromInches(viewDistanceIn(s.dpi), 'cm'))} cm`, hint: `${fmtIn(viewDistanceIn(s.dpi))} in away` },
    ], { copy: cp }))
    const rows = [72, 96, 150, 200, 240, 300, 600].map((d) => [`${d}`, rate(d).label, `${fmtIn(fromInches(s.pxW / d, s.unit))} x ${fmtIn(fromInches(s.pxH / d, s.unit))} ${s.unit}`])
    clear(tableOut, h('h3', { class: 'is-eyebrow' }, 'Print size at other DPI values'), table({ columns: ['DPI', 'Quality', 'Print size'], rows }))
  }

  function pixels() {
    if (!ok(s.sizeW, s.sizeH, s.dpi)) return need('Enter the print width, height and a DPI to see how many pixels you need.')
    const wIn = toInches(s.sizeW, s.unit), hIn = toInches(s.sizeH, s.unit)
    const pw = Math.round(wIn * s.dpi), ph = Math.round(hIn * s.dpi)
    s.effDpi = s.dpi; s.effW = wIn
    setSheet(wIn, hIn, `${fmtIn(s.sizeW)} x ${fmtIn(s.sizeH)} ${s.unit}`)
    clear(resultOut, tiles([
      { label: 'Pixels needed', value: `${pw.toLocaleString()} x ${ph.toLocaleString()}`, hint: `For ${fmtIn(s.sizeW)} x ${fmtIn(s.sizeH)} ${s.unit} at ${s.dpi} DPI`, hero: true, copy: `${pw} x ${ph}` },
      { label: 'Megapixels', value: ((pw * ph) / 1e6).toFixed(2), hint: 'Total pixels' },
      { label: 'Width', value: pw.toLocaleString(), hint: 'px', copy: pw },
      { label: 'Height', value: ph.toLocaleString(), hint: 'px', copy: ph },
      { label: 'Uncompressed', value: `${((pw * ph * 3) / 1048576).toFixed(1)} MB`, hint: '24-bit, before JPEG or PNG' },
    ], { copy: cp }))
    const rows = [100, 150, 200, 300, 600].map((d) => [`${d}`, rate(d).label, `${Math.round(wIn * d).toLocaleString()} x ${Math.round(hIn * d).toLocaleString()} px`, ((Math.round(wIn * d) * Math.round(hIn * d)) / 1e6).toFixed(1)])
    clear(tableOut, h('h3', { class: 'is-eyebrow' }, 'Pixels needed at other DPI values'), table({ columns: ['DPI', 'Quality', 'Pixels', { label: 'MP', num: true }], rows }))
  }

  function dpi() {
    if (!ok(s.pxW, s.pxH, s.sizeW, s.sizeH)) return need('Enter the pixels of your image and the size you want to print.')
    const wIn = toInches(s.sizeW, s.unit), hIn = toInches(s.sizeH, s.unit)
    const d = fillDpi(s.pxW, s.pxH, wIn, hIn)
    const fit = fitDpi(s.pxW, s.pxH, wIn, hIn)
    const crop = cropShare(s.pxW, s.pxH, wIn, hIn)
    s.effDpi = d; s.effW = wIn
    setSheet(wIn, hIn, `${fmtIn(s.sizeW)} x ${fmtIn(s.sizeH)} ${s.unit}`)
    const r = rate(d)
    const needW = Math.round(wIn * 300), needH = Math.round(hIn * 300)
    const have = Math.min(1, d / 300)
    clear(resultOut, tiles([
      { label: 'Print resolution', value: `${Math.round(d)} DPI`, hint: `${r.label}. ${r.note}`, hero: true, copy: Math.round(d), good: false },
      { label: 'Rating', value: r.label, good: r.id === 'excellent' || r.id === 'good', bad: r.id === 'poor' },
      { label: 'For 300 DPI you need', value: `${needW.toLocaleString()} x ${needH.toLocaleString()}`, hint: d >= 300 ? 'You have enough' : `You have ${(have * 100).toFixed(0)}% of that`, copy: `${needW} x ${needH}` },
      { label: 'Pixels blend from', value: `${fmtIn(fromInches(viewDistanceIn(d), 'cm'))} cm`, hint: `${fmtIn(viewDistanceIn(d))} in away` },
      crop > 0.01 ? { label: 'Cropped to fill', value: `${(crop * 100).toFixed(1)}%`, hint: `The image shape differs from the print. If you fit all of it with borders instead: ${Math.round(fit)} DPI` } : { label: 'Shape', value: 'Matches', hint: 'No cropping needed', good: true },
    ], { copy: cp }))
    const landscape = s.pxW >= s.pxH
    const rows = PAPERS.map((p) => {
      const [pw, ph] = landscape ? [Math.max(p.w, p.h), Math.min(p.w, p.h)] : [Math.min(p.w, p.h), Math.max(p.w, p.h)]
      const dd = fillDpi(s.pxW, s.pxH, pw, ph)
      const pick = () => { setVal('sizeW', round(fromInches(pw, s.unit))); setVal('sizeH', round(fromInches(ph, s.unit))); render(); scrollTo({ top: 0, behavior: 'smooth' }) }
      return { p, pw, ph, dd, pick }
    })
    clear(tableOut, h('h3', { class: 'is-eyebrow' }, 'What your photo gives at each print size'), table({
      columns: ['Print size', 'Size', { label: 'DPI', num: true }, 'Quality'],
      rows: rows.map(({ p, pw, ph, dd, pick }) => [
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: pick, 'aria-label': `Use ${p.name}` }, p.name),
        `${fmtIn(pw * 2.54)} x ${fmtIn(ph * 2.54)} cm`, `${Math.round(dd)}`, chip(dd)]),
    }))
  }

  const left = panel(controls)
  const right = h('div', { class: 'stack' }, stage(viz, gaugeBox), resultOut, tableOut)
  root.append(h('div', { class: 't-print' }, split(left, right, 'wide-right')))
  render()
}
