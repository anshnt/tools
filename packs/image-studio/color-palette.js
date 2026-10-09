// Color palette extractor. Also serves dominant-color via params.dominant.
import { h, panel, split, field, button, copyText, copyButton, clear, download, tabs, toast, rangeField, toggle, onCleanup } from '../../lib/ui.js'
import { loadImage } from '../../lib/image.js'
import { addStyle, heroDrop, stage, pills, tiles, scaled, readPixels, newCanvas, frame, done, textOn, contrast, rgbToHex, rgbToHsl, hexToRgb, IMG_ACCEPT, stem, tilt, canHover } from './_shared.js'
import { extractPalette, averageColor, nameOf, paletteFormats } from './_color.js'
import { encode } from './_shared.js'

const wcag = (r) => (r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'AA large text only' : 'Fails')
const rgbStr = (c) => `rgb(${c.join(', ')})`
const hslStr = (c) => `hsl(${c[0]}, ${c[1]}%, ${c[2]}%)`
const entry = (rgb, share = 0) => ({ rgb, hex: rgbToHex(rgb), hsl: rgbToHsl(rgb), share, name: nameOf(rgb) })

export function mount(root, { params }) {
  const dominant = !!params?.dominant
  addStyle('is-pal', `
.t-pal .pv { position: relative; display: block; width: fit-content; max-width: 100%; margin: 0 auto; line-height: 0; cursor: crosshair; }
.t-pal .pv canvas { max-width: 100%; max-height: 420px; width: auto; height: auto; }
.t-pal .cp-chip { position: absolute; z-index: 3; pointer-events: none; display: flex; align-items: center; gap: 8px; padding: 4px 10px 4px 4px; border-radius: 999px; background: var(--surface); color: var(--text); line-height: 1.2;
  box-shadow: var(--shadow); border: 1px solid var(--border); font-size: 12px; font-family: var(--mono); transform: translate(12px, 12px); white-space: nowrap; }
.t-pal .cp-chip i { width: 22px; height: 22px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .15); }
.t-pal .strip { display: flex; height: 76px; border-radius: 20px; overflow: hidden; box-shadow: var(--shadow); gap: 2px; background: var(--surface); }
.t-pal .strip button { flex: var(--s) 1 0; min-width: 6px; border: 0; padding: 0; cursor: pointer; position: relative; background: var(--c); color: var(--fg); animation: cpGrow .7s var(--ease) both; animation-delay: calc(var(--i) * 60ms);
  transition: flex-grow .35s var(--ease), filter .2s; font: 600 12px var(--mono); }
.t-pal .strip button:hover, .t-pal .strip button:focus-visible { flex-grow: calc(var(--s) * 1.6 + .05); filter: saturate(1.1); }
.t-pal .strip button span { opacity: 0; transition: opacity .2s; }
.t-pal .strip button:hover span, .t-pal .strip button:focus-visible span { opacity: 1; }
@keyframes cpGrow { from { flex-grow: .0001; opacity: 0; } }
.t-pal .wall { columns: 3 190px; column-gap: 14px; }
.t-pal .sw { break-inside: avoid; margin: 0 0 14px; border-radius: 22px; overflow: hidden; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow-sm);
  animation: isPop .55s var(--spring) both; animation-delay: calc(var(--i) * 55ms); transition: box-shadow .3s; }
.t-pal .sw:hover { box-shadow: var(--shadow); }
.t-pal .sw .blk { display: flex; flex-direction: column; justify-content: flex-end; align-items: flex-start; gap: 2px; width: 100%; height: var(--h); padding: 14px 16px; border: 0; cursor: pointer; text-align: left;
  background: var(--c); color: var(--fg); position: relative; overflow: hidden; transition: height .4s var(--ease); }
.t-pal .sw .blk::after { content: ""; position: absolute; inset: 0; background: radial-gradient(160px circle at var(--mx, 50%) var(--my, 0%), rgba(255, 255, 255, .28), transparent 60%); opacity: 0; transition: opacity .25s; }
.t-pal .sw .blk:hover::after { opacity: 1; }
.t-pal .sw .blk b { font-size: 22px; letter-spacing: -.02em; font-family: var(--mono); font-weight: 600; position: relative; z-index: 1; }
.t-pal .sw .blk small { font-size: 12.5px; opacity: .85; position: relative; z-index: 1; }
.t-pal .sw .blk .ok { position: absolute; right: 12px; top: 12px; opacity: 0; transform: scale(.6); transition: all .3s var(--spring); z-index: 1; }
.t-pal .sw .blk.copied .ok { opacity: 1; transform: none; }
.t-pal .sw .meta { padding: 10px 12px 12px; display: grid; gap: 4px; font-size: 12.5px; color: var(--text-2); }
.t-pal .sw .meta button { all: unset; cursor: pointer; font-family: var(--mono); font-size: 12px; padding: 2px 6px; margin: 0 -6px; border-radius: 6px; color: var(--text-2); }
.t-pal .sw .meta button:hover, .t-pal .sw .meta button:focus-visible { background: var(--surface-2); color: var(--text); outline: none; }
.t-pal .hero-c { position: relative; overflow: hidden; border-radius: 26px; min-height: 230px; padding: 24px; display: flex; flex-direction: column; justify-content: flex-end; background: var(--c); color: var(--fg);
  box-shadow: 0 30px 60px -30px var(--c); animation: isPop .6s var(--spring) both; }
.t-pal .hero-c::before { content: ""; position: absolute; width: 320px; height: 320px; right: -80px; top: -120px; border-radius: 50%; background: radial-gradient(circle, rgba(255, 255, 255, .35), transparent 65%); }
.t-pal .hero-c small { opacity: .85; font-size: 13px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; position: relative; }
.t-pal .hero-c b { font-size: clamp(36px, 8vw, 64px); letter-spacing: -.04em; line-height: 1.05; font-family: var(--mono); font-weight: 600; position: relative; }
.t-pal .hero-c span { font-size: 16px; position: relative; }
.t-pal .pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr)); gap: 10px; }
.t-pal .demo { display: grid; place-items: center; border-radius: 18px; min-height: 96px; padding: 12px; background: var(--c); text-align: center; animation: isPop .55s var(--spring) both; }
.t-pal .demo > div { display: grid; gap: 3px; justify-items: center; } .t-pal .demo b { font-size: 26px; line-height: 1.1; font-family: var(--mono); font-weight: 600; } .t-pal .demo small { font-size: 12px; font-weight: 600; opacity: .95; }
.t-pal .acts { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; position: relative; }
.t-pal .acts .btn { background: rgba(255, 255, 255, .22); border-color: rgba(255, 255, 255, .35); color: var(--fg); backdrop-filter: blur(6px); box-shadow: none; }
.t-pal .acts .btn:hover { background: rgba(255, 255, 255, .34); }
`)

  let src = null, small = null, pal = [], extras = []
  const s = { k: dominant ? 6 : 6, method: 'kmeans', skip: dominant }
  const drop = heroDrop({ accept: IMG_ACCEPT, sample: 1, label: dominant ? 'Drop an image to find its main color' : 'Drop an image to get its palette', onFiles: ([f]) => load(f) })
  const work = h('div', { class: 'stack', hidden: true })
  const pvHost = h('div')
  const caption = h('div', { class: 'is-cap' })
  const output = h('div', { class: 'stack' })
  const exportBox = h('div')

  const methodSeg = pills([['kmeans', 'K-means (accurate)'], ['median', 'Median cut (vivid)']], s.method, (v) => { s.method = v; run() }, 'Extraction method')
  const count = rangeField('Number of colors', { min: 2, max: 16, value: s.k, onInput: (v) => { s.k = v; runSoon() } })
  const skipT = toggle('Ignore white and black pixels', s.skip, (v) => { s.skip = v; run() })
  const controls = panel(h('div', { class: 'stack' },
    dominant ? null : field('Method', methodSeg), dominant ? null : count, skipT,
    h('p', { class: 'small muted' }, dominant ? 'Skipping near-white and near-black ignores plain backgrounds, so the answer is the main color of the subject.' : 'Click anywhere on the picture to pick an exact color and add it to the palette.')))

  const runSoon = frame(() => run())

  function showPicker(pv, cv) {
    const chip = h('div', { class: 'cp-chip', hidden: true }, h('i'), h('span'))
    pv.append(chip)
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    const at = (e) => {
      const r = cv.getBoundingClientRect()
      const x = Math.floor(((e.clientX - r.left) / r.width) * cv.width), y = Math.floor(((e.clientY - r.top) / r.height) * cv.height)
      if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) return null
      const d = ctx.getImageData(x, y, 1, 1).data
      return d[3] < 10 ? null : [d[0], d[1], d[2]]
    }
    cv.addEventListener('pointermove', (e) => {
      const c = at(e)
      chip.hidden = !c
      if (!c) return
      chip.firstChild.style.background = rgbToHex(c)
      chip.lastChild.textContent = rgbToHex(c)
      const r = pv.getBoundingClientRect()
      chip.style.left = `${Math.min(e.clientX - r.left, r.width - 110)}px`
      chip.style.top = `${Math.min(e.clientY - r.top, r.height - 40)}px`
    })
    cv.addEventListener('pointerleave', () => { chip.hidden = true })
    cv.addEventListener('click', (e) => {
      const c = at(e)
      if (!c) return
      const hex = rgbToHex(c)
      copyText(hex)
      if (!dominant && !extras.some((x) => x.hex === hex) && extras.length < 12) { extras.push(entry(c)); render() }
    })
  }

  function run() {
    if (!small) return
    const px = small.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, small.width, small.height).data
    pal = extractPalette(px, dominant ? 6 : s.k, { method: dominant ? 'kmeans' : s.method, skipNeutral: s.skip })
    s.avg = averageColor(px, s.skip)
    render()
  }

  const swatchCard = (c, i, total) => {
    const fg = textOn(c.rgb)
    const heightPx = Math.round(96 + Math.min(1, c.share * 2.2) * 170)
    const blk = h('button', { type: 'button', class: 'blk', style: { '--c': c.hex, '--fg': fg, '--h': `${c.share ? heightPx : 120}px` }, 'aria-label': `Copy ${c.hex}, ${c.name}`,
      onclick: async () => { if (await copyText(c.hex)) { blk.classList.add('copied'); setTimeout(() => blk.classList.remove('copied'), 1200) } } },
    h('span', { class: 'ok' }, '✓ Copied'), h('b', c.hex), h('small', c.share ? `${c.name} - ${(c.share * 100).toFixed(c.share < 0.1 ? 1 : 0)}%` : `${c.name} - picked`))
    if (canHover) blk.addEventListener('pointermove', (e) => { const r = blk.getBoundingClientRect(); blk.style.setProperty('--mx', `${e.clientX - r.left}px`); blk.style.setProperty('--my', `${e.clientY - r.top}px`) })
    return h('article', { class: 'sw', style: { '--i': Math.min(i, 12) } }, blk,
      h('div', { class: 'meta' },
        h('button', { type: 'button', title: 'Copy RGB', onclick: () => copyText(rgbStr(c.rgb)) }, rgbStr(c.rgb)),
        h('button', { type: 'button', title: 'Copy HSL', onclick: () => copyText(hslStr(c.hsl)) }, hslStr(c.hsl))))
  }

  function render() {
    const all = [...pal, ...extras]
    if (!all.length) { clear(output, h('p', { class: 'muted' }, 'No visible colors found. Try turning off "Ignore white and black".')); clear(exportBox); return }
    clear(caption, h('span', `Found `, h('b', `${pal.length}`), ` color${pal.length === 1 ? '' : 's'}`), extras.length ? h('span', h('b', extras.length), ' picked') : null)
    if (dominant) renderDominant(); else renderPalette(all)
  }

  function renderPalette(all) {
    const strip = h('div', { class: 'strip', role: 'list', 'aria-label': 'Palette strip' }, all.map((c, i) => h('button', {
      type: 'button', role: 'listitem', style: { '--c': c.hex, '--fg': textOn(c.rgb), '--s': Math.max(c.share, 0.05), '--i': i }, 'aria-label': `Copy ${c.hex}`, onclick: () => copyText(c.hex) }, h('span', c.hex))))
    clear(output, strip, h('div', { class: 'wall' }, all.map((c, i) => swatchCard(c, i))),
      extras.length ? h('div', { class: 'row' }, button('Clear picked colors', { icon: 'eraser', variant: 'ghost', size: 'sm', onClick: () => { extras = []; render() } })) : null)
    const fmts = paletteFormats(all)
    const pane = (key, file, mime) => () => h('div', { class: 'stack tight' }, h('pre', { class: 'code-out' }, fmts[key]),
      h('div', { class: 'row' }, copyButton(() => fmts[key], 'Copy'), button('Download', { icon: 'download', variant: 'secondary', size: 'sm', onClick: () => download(fmts[key], `${stem(src.name)}-palette.${file}`, mime) })))
    const tb = tabs([{ id: 'css', label: 'CSS variables', render: pane('css', 'css', 'text/css') }, { id: 'scss', label: 'SCSS', render: pane('scss', 'scss', 'text/plain') },
      { id: 'json', label: 'JSON', render: pane('json', 'json', 'application/json') }, { id: 'tailwind', label: 'Tailwind', render: pane('tailwind', 'js', 'text/javascript') }, { id: 'hex', label: 'HEX list', render: pane('hex', 'txt', 'text/plain') }])
    clear(exportBox, panel(h('div', { class: 'panel-title' }, h('span', 'Export palette'), button('Save as image', { icon: 'image-down', variant: 'secondary', size: 'sm', onClick: () => saveImage(all) })), tb))
  }

  async function saveImage(all) {
    const W = 1200, H = 630, c = newCanvas(W, H), g = c.getContext('2d')
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H)
    const pad = 36, gap = 10, n = all.length, bw = (W - pad * 2 - gap * (n - 1)) / n
    all.forEach((col, i) => {
      const x = pad + i * (bw + gap)
      g.fillStyle = col.hex; g.beginPath(); g.roundRect(x, pad, bw, H - pad * 2 - 90, 22); g.fill()
      g.fillStyle = '#111'; g.textAlign = 'center'
      g.font = `600 ${Math.min(30, bw / 4.4)}px ui-monospace, Menlo, Consolas, monospace`; g.fillText(col.hex, x + bw / 2, H - pad - 44)
      g.fillStyle = '#666'; g.font = `${Math.min(20, bw / 6)}px system-ui, sans-serif`; g.fillText(col.name, x + bw / 2, H - pad - 14)
    })
    download(await encode(c, 'image/png'), `${stem(src.name)}-palette.png`)
  }

  function renderDominant() {
    const d = pal[0]
    const avg = entry(s.avg || d.rgb)
    const vib = [...pal].filter((c) => c.share >= 0.04).sort((a, b) => vibrancy(b) - vibrancy(a))[0] || d
    const onW = contrast(d.rgb, [255, 255, 255]), onB = contrast(d.rgb, [0, 0, 0])
    const acts = h('div', { class: 'acts' },
      button('Copy HEX', { icon: 'copy', size: 'sm', onClick: () => copyText(d.hex) }), button('Copy RGB', { icon: 'copy', size: 'sm', onClick: () => copyText(rgbStr(d.rgb)) }), button('Copy HSL', { icon: 'copy', size: 'sm', onClick: () => copyText(hslStr(d.hsl)) }))
    const hero = h('div', { class: 'hero-c', style: { '--c': d.hex, '--fg': textOn(d.rgb) } }, h('small', `Dominant color - ${(d.share * 100).toFixed(0)}% of the picture`), h('b', d.hex), h('span', `${d.name} - ${rgbStr(d.rgb)} - ${hslStr(d.hsl)}`), acts)
    const mini = (label, c, note) => h('button', { type: 'button', class: 'demo', style: { '--c': c.hex, color: textOn(c.rgb), border: 0, cursor: 'pointer' }, onclick: () => copyText(c.hex), 'aria-label': `Copy ${label} ${c.hex}` },
      h('div', h('small', label), h('b', c.hex), h('small', note || c.name)))
    const demo = (label, fg, ratio) => h('div', { class: 'demo', style: { '--c': d.hex, color: fg } }, h('div', h('b', 'Aa'), h('small', `${label}: ${ratio.toFixed(1)}:1 ${wcag(ratio)}`)))
    clear(output, hero,
      h('div', { class: 'pair' }, mini('Average color', avg, 'Mean of every pixel'), mini('Most vibrant', vib, vib.name), demo('White text', '#ffffff', onW), demo('Black text', '#000000', onB)),
      h('div', { class: 'strip', role: 'list', 'aria-label': 'Other main colors' }, pal.filter((c) => c.share >= 0.01).map((c, i) => h('button', { type: 'button', role: 'listitem', style: { '--c': c.hex, '--fg': textOn(c.rgb), '--s': Math.max(c.share, 0.03), '--i': i }, 'aria-label': `Copy ${c.hex}`, onclick: () => copyText(c.hex) }, h('span', c.hex)))))
    clear(exportBox)
  }
  const vibrancy = (c) => { const [, sat, l] = c.hsl; return sat * (1 - Math.abs(l - 50) / 50) }

  async function load(file) {
    try {
      const img = await loadImage(file)
      src = { img, name: file.name, w: img.naturalWidth, h: img.naturalHeight }
      small = scaled(img, 160)
      const big = scaled(img, 900)
      const pv = h('div', { class: 'pv' }, big)
      big.classList.add('is-frame')
      showPicker(pv, big)
      clear(pvHost, pv)
      extras = []
      drop.setCompact(true)
      work.hidden = false
      run()
    } catch (e) { toast(e.message, 'error') }
  }

  work.append(split(stage(pvHost, caption), controls, 'wide-left'), output, exportBox)
  root.append(h('div', { class: 't-pal stack' }, drop, work))
}
