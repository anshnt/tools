// Before / after: interactive slider preview, plus side-by-side and stacked comparison images with labels.
import { h, panel, split, field, input, button, clear, download, toast, formatBytes, rangeField, toggle, busy } from '../../lib/ui.js'
import { loadImage } from '../../lib/image.js'
import { addStyle, heroDrop, stage, pills, chipPicker, compareSlider, drawCover, drawContain, newCanvas, capSize, encode, formatPicker, done, stem, clamp, frame, IMG_ACCEPT, sampleCanvas, scaled } from './_shared.js'
import { readDataURL } from '../../lib/files.js'

const MODES = [['slider', 'Slider'], ['side', 'Side by side'], ['stacked', 'Stacked']]
const SIZES = [['orig', 'Original'], ['2048', '2048 px'], ['1280', '1280 px']]

/** Layout of the output image for a mode: total size and the rectangles of both cells. */
export function layout(mode, cw, ch, gap) {
  if (mode === 'side') return { W: cw * 2 + gap, H: ch, cells: [{ x: 0, y: 0 }, { x: cw + gap, y: 0 }] }
  if (mode === 'stacked') return { W: cw, H: ch * 2 + gap, cells: [{ x: 0, y: 0 }, { x: 0, y: ch + gap }] }
  return { W: cw, H: ch, cells: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }
}

function label(g, text, x, y, size, align) {
  g.font = `700 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`
  const w = g.measureText(text).width + size * 1.2, hh = size * 1.9
  const px = align === 'right' ? x - w : x
  g.fillStyle = 'rgba(10, 10, 20, .62)'
  g.beginPath(); g.roundRect(px, y, w, hh, hh / 2); g.fill()
  g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.textAlign = 'left'
  g.fillText(text, px + size * 0.6, y + hh / 2 + size * 0.04)
}

export function mount(root) {
  addStyle('is-ba', `
.t-ba .slots { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.t-ba .slot { display: grid; gap: 8px; min-width: 0; }
.t-ba .slot .nm { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted); min-height: 28px; }
.t-ba .slot .nm canvas { width: 28px; height: 28px; border-radius: 8px; object-fit: cover; flex: none; }
.t-ba .slot .nm span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.t-ba .slot .tagline { font-size: 12px; font-weight: 650; text-transform: uppercase; letter-spacing: .1em; color: var(--accent); }
.t-ba .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.t-ba .pvbox canvas { display: block; max-width: 100%; height: auto; margin: 0 auto; }
@media (max-width: 560px) { .t-ba .slots { grid-template-columns: minmax(0, 1fr); } }
`)
  const s = { mode: 'slider', fit: 'cover', gap: 12, gapColor: '#ffffff', labels: true, labelA: 'Before', labelB: 'After', size: 'orig', pos: 50 }
  const items = [null, null] // {img, w, h, name, url}
  let slider = null

  const mkSlot = (i, text) => {
    const nm = h('div', { class: 'nm' })
    const drop = heroDrop({ accept: IMG_ACCEPT, paste: i === 0, label: `Drop the ${text.toLowerCase()} image`, hint: 'Click, drop or paste', onFiles: ([f]) => load(i, f) })
    const el = h('div', { class: 'slot' }, h('span', { class: 'tagline' }, text), drop, nm)
    el.drop = drop; el.nm = nm
    return el
  }
  const slots = [mkSlot(0, 'Before'), mkSlot(1, 'After')]
  const sampleBtn = button('Try a sample pair', { icon: 'wand-sparkles', variant: 'ghost', size: 'sm', onClick: async () => {
    const c = sampleCanvas(0, 1200, 800)
    const c2 = newCanvas(1200, 800); const g = c2.getContext('2d'); g.filter = 'saturate(1.7) contrast(1.15) hue-rotate(-18deg)'; g.drawImage(c, 0, 0)
    const mk = async (cv, name) => new File([await encode(cv, 'image/jpeg', 0.9)], name, { type: 'image/jpeg' })
    await load(0, await mk(c, 'sample-before.jpg')); await load(1, await mk(c2, 'sample-after.jpg'))
  } })

  const work = h('div', { class: 'stack', hidden: true })
  const pvHost = h('div', { class: 'pvbox' })
  const caption = h('div', { class: 'is-cap' })
  const result = h('div')

  const modeSeg = pills(MODES, s.mode, (v) => { s.mode = v; update() }, 'Layout')
  const fitSeg = pills([['cover', 'Fill (crop)'], ['contain', 'Fit (borders)']], s.fit, (v) => { s.fit = v; update() }, 'Fit')
  const gapF = rangeField('Gap', { min: 0, max: 60, value: s.gap, format: (v) => `${v}px`, onInput: (v) => { s.gap = v; soon() } })
  const gapC = chipPicker([['#ffffff', 'White'], ['#111111', 'Black'], ['#6d5dfc', 'Violet']], s.gapColor, (v) => { s.gapColor = v; update() }, 'Gap color')
  const labT = toggle('Show labels', true, (v) => { s.labels = v; update() })
  const labA = input({ value: s.labelA, maxlength: 24, 'aria-label': 'Before label', oninput: () => { s.labelA = labA.value; soon() } })
  const labB = input({ value: s.labelB, maxlength: 24, 'aria-label': 'After label', oninput: () => { s.labelB = labB.value; soon() } })
  const sizeSeg = pills(SIZES, s.size, (v) => { s.size = v; update() }, 'Output size')
  const fmt = formatPicker({ value: 'image/png' })
  const swapBtn = button('Swap before and after', { icon: 'arrow-left-right', variant: 'ghost', size: 'sm', onClick: () => { [items[0], items[1]] = [items[1], items[0]]; refreshSlots(); update() } })
  const saveBtn = button('Download image', { icon: 'download', variant: 'primary', size: 'lg', block: true })
  const htmlBtn = button('Download interactive slider (.html)', { icon: 'code', variant: 'secondary', block: true })
  const gapBox = h('div', { class: 'stack' }, gapF, field('Gap color', gapC))
  const controls = panel(h('div', { class: 'stack' }, field('Layout', modeSeg), field('When the shapes differ', fitSeg), gapBox, labT,
    h('div', { class: 'row2' }, field('Before label', labA), field('After label', labB)), field('Output size', sizeSeg), fmt.el, saveBtn, htmlBtn, swapBtn, result))
  const soon = frame(() => update())

  const cell = () => {
    const a = items[0]
    const k = s.size === 'orig' ? 1 : Math.min(1, +s.size / Math.max(a.w, a.h))
    return { cw: Math.max(1, Math.round(a.w * k)), ch: Math.max(1, Math.round(a.h * k)) }
  }

  function drawInto(g, it, x, y, cw, ch) {
    g.save()
    g.beginPath(); g.rect(x, y, cw, ch); g.clip()
    g.imageSmoothingQuality = 'high'
    if (s.fit === 'cover') drawCover(g, it.img, it.w, it.h, x, y, cw, ch)
    else { g.fillStyle = s.gapColor; g.fillRect(x, y, cw, ch); drawContain(g, it.img, it.w, it.h, x, y, cw, ch) }
    g.restore()
  }

  const gapAt = (bw) => (s.mode === 'slider' ? 0 : Math.round(s.gap * Math.max(1, bw / 1000)))

  /** Render the comparison at a size. scale scales everything (used for fast previews). */
  function compose(scale, pos = s.pos) {
    const { cw: bw, ch: bh } = cell()
    const cw = Math.max(1, Math.round(bw * scale)), ch = Math.max(1, Math.round(bh * scale)), gap = Math.round(gapAt(bw) * scale)
    const L = layout(s.mode, cw, ch, gap)
    const c = newCanvas(L.W, L.H)
    const g = c.getContext('2d')
    if (s.mode !== 'slider') { g.fillStyle = s.gapColor; g.fillRect(0, 0, L.W, L.H) }
    if (s.mode === 'slider') {
      drawInto(g, items[0], 0, 0, cw, ch)
      const x = Math.round((cw * pos) / 100)
      g.save(); g.beginPath(); g.rect(x, 0, cw - x, ch); g.clip(); drawInto(g, items[1], 0, 0, cw, ch); g.restore()
      const lw = Math.max(2, Math.round(ch / 300))
      g.fillStyle = '#fff'; g.shadowColor = 'rgba(0,0,0,.4)'; g.shadowBlur = lw * 3
      g.fillRect(x - lw / 2, 0, lw, ch)
      const r = Math.max(14, Math.round(ch / 22))
      g.beginPath(); g.arc(x, ch / 2, r, 0, Math.PI * 2); g.fill()
      g.shadowBlur = 0; g.strokeStyle = '#222'; g.lineWidth = Math.max(2, r / 6); g.lineCap = 'round'; g.lineJoin = 'round'
      g.beginPath(); g.moveTo(x - r * 0.28, ch / 2 - r * 0.38); g.lineTo(x - r * 0.62, ch / 2); g.lineTo(x - r * 0.28, ch / 2 + r * 0.38)
      g.moveTo(x + r * 0.28, ch / 2 - r * 0.38); g.lineTo(x + r * 0.62, ch / 2); g.lineTo(x + r * 0.28, ch / 2 + r * 0.38); g.stroke()
    } else {
      drawInto(g, items[0], L.cells[0].x, L.cells[0].y, cw, ch)
      drawInto(g, items[1], L.cells[1].x, L.cells[1].y, cw, ch)
    }
    if (s.labels) {
      const size = clamp(ch * 0.04, 12 * scale, 64), m = size * 0.7
      if (s.labelA) label(g, s.labelA, L.cells[0].x + m, L.cells[0].y + m, size, 'left')
      if (s.labelB) s.mode === 'slider' ? label(g, s.labelB, cw - m, m, size, 'right') : label(g, s.labelB, L.cells[1].x + m, L.cells[1].y + m, size, 'left')
    }
    return c
  }

  function update() {
    if (!(items[0] && items[1])) return
    modeSeg.set(s.mode); fitSeg.set(s.fit); sizeSeg.set(s.size); gapC.set(s.gapColor)
    gapBox.hidden = s.mode === 'slider' && s.fit === 'cover'
    gapF.hidden = s.mode === 'slider'
    const { cw, ch } = cell()
    const L = layout(s.mode, cw, ch, gapAt(cw))
    const cap = capSize(L.W, L.H)
    clear(caption, h('span', h('b', `${L.W} x ${L.H}`), ' px'), cap.capped ? h('span', 'Large images are scaled down to fit this device') : null)
    htmlBtn.hidden = s.mode !== 'slider'
    if (s.mode === 'slider') {
      const pw = Math.min(1, 1000 / cw)
      const mk = (it) => { const c = newCanvas(Math.round(cw * pw), Math.round(ch * pw)); drawInto(c.getContext('2d'), it, 0, 0, c.width, c.height); return c }
      const prevPos = slider?.position ?? 50
      slider = compareSlider({ a: mk(items[0]), b: mk(items[1]), labelA: s.labels ? s.labelA : '', labelB: s.labels ? s.labelB : '', width: cw, height: ch, position: prevPos })
      slider.onchange = (p) => { s.pos = p }
      s.pos = prevPos
      clear(pvHost, slider)
      if (!update.swept) { update.swept = true; slider.sweep() }
    } else {
      const pw = Math.min(1, 1100 / L.W)
      const c = compose(pw)
      c.className = 'is-frame'
      clear(pvHost, c)
    }
  }

  saveBtn.addEventListener('click', () => busy(saveBtn, async () => {
    const { cw, ch } = cell(), L = layout(s.mode, cw, ch, gapAt(cw))
    const cap = capSize(L.W, L.H)
    const c = compose(cap.capped ? cap.w / L.W : 1, slider ? slider.position : 50)
    const blob = await encode(c, fmt.type, fmt.quality, s.gapColor)
    const name = `${stem(items[0].name)}-vs-${stem(items[1].name)}.${fmt.ext}`
    download(blob, name)
    clear(result, done('Image saved', `${c.width} x ${c.height} px, ${formatBytes(blob.size)}`))
  }, { label: 'Rendering', errorTo: result }))

  htmlBtn.addEventListener('click', () => busy(htmlBtn, async () => {
    const small = async (it) => {
      const k = Math.min(1, 1600 / Math.max(it.w, it.h))
      const c = newCanvas(it.w * k, it.h * k); c.getContext('2d').drawImage(it.img, 0, 0, c.width, c.height)
      return readDataURL(await encode(c, 'image/jpeg', 0.86))
    }
    const [a, b] = [await small(items[0]), await small(items[1])]
    const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(s.labelA)} / ${esc(s.labelB)}</title>
<style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#0b0b10;font-family:system-ui,sans-serif}
.c{position:relative;width:min(100vw,calc(100vh*${items[0].w}/${items[0].h}));aspect-ratio:${items[0].w}/${items[0].h};overflow:hidden;cursor:ew-resize;user-select:none;touch-action:pan-y}
.c img{position:absolute;inset:0;width:100%;height:100%;object-fit:${s.fit};pointer-events:none}.c .t{clip-path:inset(0 calc(100% - var(--p,50%)) 0 0)}
.c i{position:absolute;top:0;bottom:0;left:var(--p,50%);width:3px;margin-left:-1.5px;background:#fff;box-shadow:0 0 12px rgba(0,0,0,.5)}
.c b{position:absolute;top:50%;left:var(--p,50%);width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:#fff;display:grid;place-items:center;font-size:18px}
.c u{position:absolute;top:12px;padding:5px 12px;border-radius:99px;background:rgba(10,10,20,.6);color:#fff;font:700 13px system-ui;text-decoration:none}</style></head>
<body><div class="c" id="c" tabindex="0" role="slider" aria-label="Comparison" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">
<img src="${b}" alt="${esc(s.labelB)}"><img class="t" src="${a}" alt="${esc(s.labelA)}"><i></i><b>&#8596;</b>
${s.labels ? `<u style="left:12px">${esc(s.labelA)}</u><u style="right:12px">${esc(s.labelB)}</u>` : ''}</div>
<script>var c=document.getElementById('c'),d=false;function set(p){p=Math.max(0,Math.min(100,p));c.style.setProperty('--p',p+'%');c.setAttribute('aria-valuenow',Math.round(p))}
function at(e){var r=c.getBoundingClientRect();set((e.clientX-r.left)/r.width*100)}
c.onpointerdown=function(e){d=true;c.setPointerCapture(e.pointerId);at(e)};c.onpointermove=function(e){if(d)at(e)};c.onpointerup=function(){d=false};
c.onkeydown=function(e){var v=+c.getAttribute('aria-valuenow');if(e.key==='ArrowLeft')set(v-3);if(e.key==='ArrowRight')set(v+3)}</script></body></html>`
    download(page, `${stem(items[0].name)}-vs-${stem(items[1].name)}.html`, 'text/html')
    clear(result, done('Slider page saved', `One file with both images inside (${formatBytes(new Blob([page]).size)}). Open it in any browser.`))
  }, { label: 'Building', errorTo: result }))

  const thumbOf = (it) => { const c = newCanvas(it.thumb.width, it.thumb.height); c.getContext('2d').drawImage(it.thumb, 0, 0); return c }
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
      update()
    } catch (e) { toast(e.message, 'error') }
  }

  work.append(split(stage(pvHost, caption), controls, 'wide-left'))
  root.append(h('div', { class: 't-ba stack' }, h('div', { class: 'slots' }, ...slots), h('div', { class: 'row' }, sampleBtn), work))
}
