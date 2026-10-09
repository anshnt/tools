// Pixel art maker: pixelate a picture, map it to a retro or adaptive palette, optional ordered dithering, crisp upscaled export.
import { h, panel, split, field, button, busy, clear, download, toast, formatBytes, rangeField, toggle } from '../../lib/ui.js'
import { loadImage } from '../../lib/image.js'
import { addStyle, heroDrop, stage, pills, chipPicker, newCanvas, capSize, encode, done, scaled, stem, hexToRgb, frame, IMG_ACCEPT } from './_shared.js'
import { extractPalette, rgb2lab, deltaE } from './_color.js'

export const PALETTES = {
  original: { label: 'Original colors', colors: null },
  adaptive: { label: 'Adaptive', colors: null },
  gameboy: { label: 'Game Boy', colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'] },
  cga: { label: 'CGA', colors: ['#000000', '#55ffff', '#ff55ff', '#ffffff'] },
  pico: { label: 'PICO-8', colors: ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'] },
  sepia: { label: 'Sepia', colors: ['#2b1b0e', '#6b4a2b', '#b58b5a', '#e8d3a9'] },
  bw: { label: 'Black and white', colors: ['#000000', '#ffffff'] },
  gray: { label: '4 grays', colors: ['#000000', '#555555', '#aaaaaa', '#ffffff'] },
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

/**
 * Map RGBA pixels (w x h) to a palette (array of [r,g,b]). dither adds a 4x4 ordered-dither offset before choosing the nearest color.
 * Works in place on `data` and returns it.
 */
export function mapToPalette(data, w, hh, palette, dither = false) {
  const labs = palette.map((c) => rgb2lab(...c))
  const spread = dither ? 255 / Math.max(2, Math.sqrt(palette.length)) * 0.5 : 0
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4
    const t = dither ? (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.47) * spread : 0
    const r = Math.max(0, Math.min(255, data[o] + t)) | 0, g = Math.max(0, Math.min(255, data[o + 1] + t)) | 0, b = Math.max(0, Math.min(255, data[o + 2] + t)) | 0
    const lab = rgb2lab(r, g, b)
    let best = 0, bd = Infinity
    for (let i = 0; i < labs.length; i++) { const d = deltaE(lab, labs[i]); if (d < bd) { bd = d; best = i } }
    data[o] = palette[best][0]; data[o + 1] = palette[best][1]; data[o + 2] = palette[best][2]
  }
  return data
}

export function mount(root) {
  addStyle('is-pix', `
.t-pix .pv { display: block; margin: 0 auto; max-width: 100%; max-height: 560px; width: auto; height: auto; image-rendering: pixelated; border-radius: 6px; box-shadow: 0 24px 48px -26px rgba(10, 10, 30, .55), 0 0 0 1px rgba(0, 0, 0, .1); }
.t-pix .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.t-pix .pal { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.t-pix .pal i { width: 22px; height: 22px; border-radius: 6px; box-shadow: inset 0 0 0 1px rgba(128, 128, 128, .35); animation: isPop .4s var(--spring) both; animation-delay: calc(var(--i) * 20ms); }
`)
  const s = { size: 12, pal: 'pico', colors: 8, dither: true, out: 'orig' }
  let src = null, small = null, last = null
  const drop = heroDrop({ accept: IMG_ACCEPT, sample: 1, label: 'Drop a picture to pixelate', onFiles: ([f]) => load(f) })
  const work = h('div', { class: 'stack', hidden: true })
  const pvHost = h('div'); const caption = h('div', { class: 'is-cap' }); const palBox = h('div', { class: 'pal' }); const result = h('div')

  const sizeF = rangeField('Pixel size', { min: 2, max: 64, value: s.size, format: (v) => `${v} px blocks`, onInput: (v) => { s.size = v; soon() } })
  const palChips = chipPicker(Object.entries(PALETTES).map(([k, v]) => [k, v.label]), s.pal, (v) => { s.pal = v; colorsF.hidden = v !== 'adaptive'; update() }, 'Palette')
  const colorsF = rangeField('Number of colors', { min: 2, max: 32, value: s.colors, format: (v) => `${v}`, onInput: (v) => { s.colors = v; soon() } })
  colorsF.hidden = true
  const dithT = toggle('Dithering (retro texture)', s.dither, (v) => { s.dither = v; update() })
  const outSeg = pills([['orig', 'Original size'], ['1024', '1024 px wide'], ['tiny', 'One pixel per block']], s.out, (v) => { s.out = v }, 'Download size')
  const dlBtn = button('Download PNG', { icon: 'download', variant: 'primary', size: 'lg', block: true })
  const controls = panel(h('div', { class: 'stack' }, sizeF, field('Palette', palChips), colorsF, dithT, palBox, field('Download size', outSeg), dlBtn, result))
  const soon = frame(() => update())

  /** Returns {tiny: canvas of cols x rows}. */
  function build() {
    const cols = Math.max(1, Math.round(src.w / s.size)), rows = Math.max(1, Math.round(src.h / s.size))
    const tiny = newCanvas(cols, rows), g = tiny.getContext('2d', { willReadFrequently: true })
    g.imageSmoothingQuality = 'high'
    g.drawImage(src.img.naturalWidth > 4000 ? small : src.img, 0, 0, cols, rows)
    const d = g.getImageData(0, 0, cols, rows)
    let palette = null
    const def = PALETTES[s.pal]
    if (def.colors) palette = def.colors.map(hexToRgb)
    else if (s.pal === 'adaptive') palette = extractPalette(d.data, s.colors, { method: 'median' }).map((c) => c.rgb)
    if (palette?.length) mapToPalette(d.data, cols, rows, palette, s.dither && palette.length <= 32)
    g.putImageData(d, 0, 0)
    return { tiny, cols, rows, palette }
  }

  function update() {
    if (!src) return
    palChips.set(s.pal)
    const r = (last = build())
    const [W, H] = previewSize(r)
    const c = newCanvas(W, H), g = c.getContext('2d')
    g.imageSmoothingEnabled = false
    g.drawImage(r.tiny, 0, 0, W, H)
    c.className = 'pv'
    clear(pvHost, c)
    clear(caption, h('span', h('b', `${r.cols} x ${r.rows}`), ' blocks'), h('span', r.palette ? `${r.palette.length} colors` : 'All colors'))
    clear(palBox, r.palette ? r.palette.slice(0, 40).map((c2, i) => h('i', { style: { background: `rgb(${c2.join(',')})`, '--i': i }, title: `rgb(${c2.join(', ')})` })) : null)
  }
  function previewSize(r) {
    const k = Math.min(900 / r.cols, 640 / r.rows)
    return [Math.max(1, Math.round(r.cols * Math.max(1, Math.floor(k) || 1))), Math.max(1, Math.round(r.rows * Math.max(1, Math.floor(k) || 1)))]
  }

  dlBtn.addEventListener('click', () => busy(dlBtn, async () => {
    const r = last
    let W = r.cols, H = r.rows
    if (s.out === 'orig') { W = src.w; H = src.h } else if (s.out === '1024') { W = 1024; H = Math.round((1024 * r.rows) / r.cols) }
    const cap = capSize(W, H)
    const c = newCanvas(cap.w, cap.h), g = c.getContext('2d')
    g.imageSmoothingEnabled = false
    g.drawImage(r.tiny, 0, 0, cap.w, cap.h)
    const blob = await encode(c, 'image/png')
    download(blob, `${stem(src.name)}-pixel.png`)
    clear(result, done('Pixel art saved', `${cap.w} x ${cap.h} px, ${formatBytes(blob.size)}`))
  }, { label: 'Rendering', errorTo: result }))

  async function load(file) {
    try {
      const img = await loadImage(file)
      src = { img, w: img.naturalWidth, h: img.naturalHeight, name: file.name }
      small = scaled(img, 2000)
      drop.setCompact(true); work.hidden = false
      clear(result)
      update()
    } catch (e) { toast(e.message, 'error') }
  }
  work.append(split(stage(pvHost, caption), controls, 'wide-left'))
  root.append(h('div', { class: 't-pix stack' }, drop, work))
}
