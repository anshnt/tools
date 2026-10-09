// Image tiler: repeat an image as a seamless pattern (grid, brick, half-drop, mirror) or tile copies onto a printable page (PDF).
import { h, panel, split, field, button, busy, clear, download, toast, formatBytes, rangeField, toggle, onCleanup, progress } from '../../lib/ui.js'
import { loadImage } from '../../lib/image.js'
import { pdfLib } from '../../lib/libs.js'
import { savePdf, PAGE_SIZES } from '../../lib/pdf.js'
import { addStyle, heroDrop, stage, pills, chipPicker, numField, newCanvas, capSize, encode, formatPicker, done, scaled, drawCover, drawContain, stem, clamp, frame, IMG_ACCEPT, yieldToMain } from './_shared.js'

// ---------- Pattern ----------
export const PATTERNS = [['grid', 'Grid'], ['brick', 'Brick'], ['drop', 'Half-drop'], ['mirror', 'Mirror']]

/** Draw a repeating pattern of `tile` (already sized tw x th) onto ctx (W x H). */
export function drawPattern(ctx, W, H, tile, { type = 'grid', gap = 0, ox = 0, oy = 0, angle = 0 } = {}) {
  const tw = tile.width, th = tile.height
  const cw = tw + gap, ch = th + gap
  const diag = Math.hypot(W, H)
  ctx.save()
  ctx.translate(W / 2, H / 2)
  if (angle) ctx.rotate((angle * Math.PI) / 180)
  const c0 = Math.floor((-diag / 2) / cw) - 2, c1 = Math.ceil((diag / 2) / cw) + 2
  const r0 = Math.floor((-diag / 2) / ch) - 2, r1 = Math.ceil((diag / 2) / ch) + 2
  const shiftX = (ox % 1) * cw, shiftY = (oy % 1) * ch
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      let x = c * cw + shiftX, y = r * ch + shiftY
      if (type === 'brick' && Math.abs(r) % 2 === 1) x += cw / 2
      if (type === 'drop' && Math.abs(c) % 2 === 1) y += ch / 2
      if (type === 'mirror' && (Math.abs(c) % 2 === 1 || Math.abs(r) % 2 === 1)) {
        ctx.save()
        ctx.translate(x + tw / 2, y + th / 2)
        ctx.scale(Math.abs(c) % 2 === 1 ? -1 : 1, Math.abs(r) % 2 === 1 ? -1 : 1)
        ctx.drawImage(tile, -tw / 2, -th / 2)
        ctx.restore()
      } else ctx.drawImage(tile, x, y)
    }
  }
  ctx.restore()
}

/** The smallest repeatable unit of a pattern as a canvas (it tiles seamlessly with CSS background-repeat). */
export function patternUnit(tile, { type = 'grid', gap = 0, bg = null } = {}) {
  const tw = tile.width, th = tile.height, cw = tw + gap, ch = th + gap
  const [uw, uh] = type === 'brick' ? [cw, ch * 2] : type === 'drop' ? [cw * 2, ch] : type === 'mirror' ? [cw * 2, ch * 2] : [cw, ch]
  const c = newCanvas(uw, uh), g = c.getContext('2d')
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, uw, uh) }
  if (type === 'brick') { g.drawImage(tile, 0, 0); for (const dx of [cw / 2, -cw / 2]) g.drawImage(tile, dx, ch) }
  else if (type === 'drop') { g.drawImage(tile, 0, 0); for (const dy of [ch / 2, -ch / 2]) g.drawImage(tile, cw, dy) }
  else if (type === 'mirror') {
    for (let r = 0; r < 2; r++) for (let q = 0; q < 2; q++) {
      g.save(); g.translate(q * cw + tw / 2, r * ch + th / 2); g.scale(q ? -1 : 1, r ? -1 : 1); g.drawImage(tile, -tw / 2, -th / 2); g.restore()
    }
  } else g.drawImage(tile, 0, 0)
  return c
}

// ---------- Page ----------
/** How many w x h copies (mm) fit on a page with margin and gap. */
export function gridFit(pageW, pageH, margin, gap, w, hh) {
  const aw = pageW - margin * 2, ah = pageH - margin * 2
  const cols = Math.max(0, Math.floor((aw + gap + 1e-6) / (w + gap))), rows = Math.max(0, Math.floor((ah + gap + 1e-6) / (hh + gap)))
  return { cols, rows, x0: margin + (aw - (cols * w + (cols - 1) * gap)) / 2, y0: margin + (ah - (rows * hh + (rows - 1) * gap)) / 2 }
}

const MM = 25.4
const PAPERS = [['A4', ...PAGE_SIZES.A4.map((p) => (p / 72) * MM)], ['A3', ...PAGE_SIZES.A3.map((p) => (p / 72) * MM)], ['A5', ...PAGE_SIZES.A5.map((p) => (p / 72) * MM)], ['Letter', 215.9, 279.4], ['Legal', 215.9, 355.6], ['4 x 6 in', 101.6, 152.4], ['5 x 7 in', 127, 177.8]]
const QUICK = [['Passport 35 x 45 mm', 35, 45], ['US passport 2 x 2 in', 50.8, 50.8], ['Stamp 25 x 30 mm', 25, 30], ['Sticker 50 x 50 mm', 50, 50], ['Wallet 2.5 x 3.5 in', 63.5, 88.9], ['Badge 90 x 55 mm', 90, 55]]
const SIZES = [['1080 x 1080', 1080, 1080], ['1920 x 1080', 1920, 1080], ['2560 x 1440', 2560, 1440], ['3840 x 2160', 3840, 2160], ['Phone 1170 x 2532', 1170, 2532], ['A4 at 300 DPI', 2480, 3508]]

/** A cheerful sample motif so the pattern tools can be tried without a file. */
function sampleMotif() {
  const c = newCanvas(240, 240), g = c.getContext('2d')
  g.fillStyle = '#fff4e0'; g.fillRect(0, 0, 240, 240)
  const petal = (x, y, r, col) => { g.fillStyle = col; for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(x + Math.cos((i * Math.PI) / 3) * r * 0.62, y + Math.sin((i * Math.PI) / 3) * r * 0.62, r * 0.4, r * 0.28, (i * Math.PI) / 3, 0, Math.PI * 2); g.fill() } g.fillStyle = '#ffd166'; g.beginPath(); g.arc(x, y, r * 0.3, 0, Math.PI * 2); g.fill() }
  petal(70, 70, 48, '#ef476f'); petal(170, 150, 52, '#118ab2'); petal(190, 40, 26, '#06d6a0'); petal(40, 190, 28, '#8338ec')
  g.fillStyle = '#073b4c'; for (const [x, y] of [[120, 120], [20, 120], [220, 220], [120, 10], [120, 232]]) { g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill() }
  return c
}

export function mount(root, { signal }) {
  addStyle('is-tiler', `
.t-tile .pv { display: block; margin: 0 auto; max-width: 100%; height: auto; max-height: 620px; width: auto; border-radius: 6px; box-shadow: 0 24px 48px -26px rgba(10, 10, 30, .55), 0 0 0 1px rgba(0, 0, 0, .08); }
.t-tile .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.t-tile .bgs { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.t-tile .bgs button { width: 34px; height: 34px; border-radius: 50%; border: 2px solid var(--border); cursor: pointer; padding: 0; transition: transform .2s var(--spring), box-shadow .2s; }
.t-tile .bgs button:hover { transform: scale(1.12); }
.t-tile .bgs button[aria-pressed="true"] { box-shadow: 0 0 0 3px var(--surface), 0 0 0 5px var(--accent); }
.t-tile .bgs input[type=color] { width: 34px; height: 34px; padding: 0; border: 2px solid var(--border); border-radius: 50%; background: none; cursor: pointer; overflow: hidden; }
.t-tile .unit { display: grid; gap: 8px; text-align: center; justify-items: center; }
`)
  const s = { mode: 'pattern', type: 'grid', size: 14, gapPct: 0, ox: 0, oy: 0, angle: 0, bg: '#ffffff', clear: false, square: false, W: 1920, H: 1080,
    paper: 'A4', orient: 'auto', unit: 'mm', w: 35, h: 45, lock: true, fit: 'cover', margin: 10, gap: 4, marks: true, fill: true, copies: 8 }
  let src = null // {img, name, w, h, small, alpha}

  const drop = heroDrop({ accept: IMG_ACCEPT, sample: 0, label: 'Drop an image to repeat', onFiles: ([f]) => load(f) })
  const sampleBtn = button('Try a sample motif', { icon: 'wand-sparkles', variant: 'ghost', size: 'sm', onClick: async () => { const c = sampleMotif(); await load(new File([await encode(c, 'image/png')], 'sample-motif.png', { type: 'image/png' })) } })
  const work = h('div', { class: 'stack', hidden: true })
  const pvHost = h('div')
  const caption = h('div', { class: 'is-cap' })
  const result = h('div')
  const prog = progress()

  const modeSeg = pills([['pattern', 'Seamless pattern'], ['page', 'Print on a page']], s.mode, (v) => { s.mode = v; update() }, 'What to make')

  // ----- pattern controls -----
  const typeSeg = pills(PATTERNS, s.type, (v) => { s.type = v; update() }, 'Pattern')
  const sizeF = rangeField('Tile size', { min: 3, max: 100, value: s.size, format: (v) => `${v}% of width`, onInput: (v) => { s.size = v; soon() } })
  const gapF = rangeField('Space between tiles', { min: 0, max: 60, value: 0, format: (v) => `${v}%`, onInput: (v) => { s.gapPct = v; soon() } })
  const oxF = rangeField('Shift sideways', { min: 0, max: 100, value: 0, format: (v) => `${v}%`, onInput: (v) => { s.ox = v / 100; soon() } })
  const oyF = rangeField('Shift up / down', { min: 0, max: 100, value: 0, format: (v) => `${v}%`, onInput: (v) => { s.oy = v / 100; soon() } })
  const angF = rangeField('Rotate pattern', { min: -90, max: 90, value: 0, format: (v) => `${v} deg`, onInput: (v) => { s.angle = v; soon() } })
  const sqT = toggle('Crop the tile to a square', false, (v) => { s.square = v; update() })
  const colorIn = h('input', { type: 'color', value: s.bg, 'aria-label': 'Background color', oninput: () => { s.bg = colorIn.value; s.clear = false; update() } })
  const bgBox = h('div', { class: 'bgs' })
  const drawBgs = () => clear(bgBox, [['#ffffff', 'White'], ['#111111', 'Black'], ['#f6efe0', 'Cream'], ['#243044', 'Slate']].map(([c, n]) => h('button', { type: 'button', style: `background:${c}`, 'aria-label': n, title: n, 'aria-pressed': String(!s.clear && s.bg === c), onclick: () => { s.bg = c; s.clear = false; colorIn.value = c; update() } })),
    h('button', { type: 'button', style: 'background:var(--checker)', 'aria-label': 'Transparent', title: 'Transparent (PNG)', 'aria-pressed': String(s.clear), onclick: () => { s.clear = true; update() } }), colorIn)
  const sizeChips = chipPicker(SIZES.map(([l]) => [l, l]), '1920 x 1080', (l) => { const z = SIZES.find((x) => x[0] === l); s.W = z[1]; s.H = z[2]; wF.input.value = s.W; hF.input.value = s.H; update() }, 'Output size')
  const wF = numField('Width (px)', s.W, (n) => { if (n > 0) { s.W = Math.round(n); update() } }, { min: 16, max: 8000, step: 1 })
  const hF = numField('Height (px)', s.H, (n) => { if (n > 0) { s.H = Math.round(n); update() } }, { min: 16, max: 8000, step: 1 })
  const fmt = formatPicker({ value: 'image/png' })
  const dlPattern = button('Download pattern', { icon: 'download', variant: 'primary', size: 'lg', block: true })
  const dlUnit = button('Download repeatable tile', { icon: 'square-dashed', variant: 'secondary', block: true })
  const patternBlock = h('div', { class: 'stack' }, field('Pattern', typeSeg), sizeF, gapF, h('div', { class: 'row2' }, oxF, oyF), angF, sqT, field('Background', bgBox), field('Output size', sizeChips), h('div', { class: 'row2' }, wF, hF), fmt.el, dlPattern, dlUnit,
    h('p', { class: 'small muted' }, 'The repeatable tile is the smallest unit of your pattern. Use it as a CSS background-image with background-repeat, or in any design tool.'))

  // ----- page controls -----
  const paperChips = chipPicker(PAPERS.map(([n]) => [n, n]), s.paper, (v) => { s.paper = v; update() }, 'Paper')
  const orientSeg = pills([['auto', 'Best fit'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], s.orient, (v) => { s.orient = v; update() }, 'Orientation')
  const unitSeg = pills([['mm', 'mm'], ['in', 'inches']], s.unit, (v) => { s.unit = v; syncUnit(); update() }, 'Unit')
  const quickChips = chipPicker(QUICK.map(([n]) => [n, n]), null, (n) => { const q = QUICK.find((x) => x[0] === n); s.w = q[1]; s.h = q[2]; s.lock = false; lockT.input.checked = false; syncUnit(); update() }, 'Common sizes')
  const pw = numField('Copy width', 35, (n) => { if (n > 0) { s.w = toMm(n); if (s.lock && src) s.h = s.w * (src.h / src.w); syncUnit(pw.input); update() } }, { min: 1, step: 'any' })
  const ph = numField('Copy height', 45, (n) => { if (n > 0) { s.h = toMm(n); if (s.lock && src) s.w = s.h * (src.w / src.h); syncUnit(ph.input); update() } }, { min: 1, step: 'any' })
  const lockT = toggle('Keep the picture\'s shape', true, (v) => { s.lock = v; if (v && src) { s.h = s.w * (src.h / src.w); syncUnit() } update() })
  const fitSeg = pills([['cover', 'Fill (crop)'], ['contain', 'Fit (borders)'], ['stretch', 'Stretch']], s.fit, (v) => { s.fit = v; update() }, 'Fit')
  const mF = numField('Page margin', 10, (n) => { if (n >= 0) { s.margin = toMm(n); update() } }, { min: 0, step: 'any' })
  const gF = numField('Gap between copies', 4, (n) => { if (n >= 0) { s.gap = toMm(n); update() } }, { min: 0, step: 'any' })
  const marksT = toggle('Draw crop marks', true, (v) => { s.marks = v; update() })
  const fillT = toggle('Fill the page', true, (v) => { s.fill = v; copiesF.hidden = v; update() })
  const copiesF = numField('Number of copies', 8, (n) => { if (n >= 1) { s.copies = Math.min(500, Math.round(n)); update() } }, { min: 1, max: 500, step: 1 })
  copiesF.hidden = true
  const toMm = (v) => (s.unit === 'in' ? v * MM : v)
  const fromMm = (v) => (s.unit === 'in' ? v / MM : v)
  const r2 = (v) => Math.round(v * 100) / 100
  function syncUnit(skip) {
    for (const [f, v] of [[pw, s.w], [ph, s.h], [mF, s.margin], [gF, s.gap]]) if (f.input !== skip) f.input.value = r2(fromMm(v))
  }
  const dlPdf = button('Download PDF', { icon: 'file-down', variant: 'primary', size: 'lg', block: true })
  const dlPng = button('Download page as PNG (300 DPI)', { icon: 'image-down', variant: 'secondary', block: true })
  const pageBlock = h('div', { class: 'stack' }, field('Paper', paperChips), field('Orientation', orientSeg), field('Unit', unitSeg), field('Common sizes', quickChips), h('div', { class: 'row2' }, pw, ph), lockT, field('When the shape differs', fitSeg),
    h('div', { class: 'row2' }, mF, gF), marksT, fillT, copiesF, dlPdf, dlPng)

  const controls = panel(h('div', { class: 'stack' }, field('Make', modeSeg), patternBlock, pageBlock, prog.el, result))
  const soon = frame(() => update())

  // ---------- rendering ----------
  function tileCanvas(w) {
    const sw = src.small.width, sh = src.small.height
    const [cw, chh, sx, sy] = s.square ? [Math.min(sw, sh), Math.min(sw, sh), (sw - Math.min(sw, sh)) / 2, (sh - Math.min(sw, sh)) / 2] : [sw, sh, 0, 0]
    const tw = Math.max(2, Math.round(w)), th = Math.max(2, Math.round((w * chh) / cw))
    const c = newCanvas(tw, th), g = c.getContext('2d')
    g.imageSmoothingQuality = 'high'
    g.drawImage(src.small, sx, sy, cw, chh, 0, 0, tw, th)
    return c
  }

  function renderPattern(W, H) {
    const w = Math.max(2, (s.size / 100) * W)
    const tile = tileCanvas(w)
    const gap = Math.round((s.gapPct / 100) * tile.width)
    const c = newCanvas(W, H), g = c.getContext('2d')
    if (!s.clear) { g.fillStyle = s.bg; g.fillRect(0, 0, W, H) }
    drawPattern(g, W, H, tile, { type: s.type, gap, ox: s.ox, oy: s.oy, angle: s.angle })
    return c
  }

  // Page geometry
  function pageGeom() {
    const base = PAPERS.find((p) => p[0] === s.paper)
    const [a, b] = [base[1], base[2]]
    const opts = s.orient === 'portrait' ? [[a, b]] : s.orient === 'landscape' ? [[b, a]] : [[a, b], [b, a]]
    let best = null
    for (const [W, H] of opts) {
      const fit = gridFit(W, H, s.margin, s.gap, s.w, s.h)
      if (!best || fit.cols * fit.rows > best.cols * best.rows) best = { W, H, ...fit }
    }
    return best
  }

  function pageCells(geom) {
    const per = geom.cols * geom.rows
    const total = s.fill ? per : s.copies
    const pages = per ? Math.max(1, Math.ceil(total / per)) : 1
    return { per, total, pages }
  }

  function paintCell(g, x, y, w, hh) {
    g.save()
    g.beginPath(); g.rect(x, y, w, hh); g.clip()
    g.imageSmoothingQuality = 'high'
    const sm = src.small
    if (s.fit === 'cover' || s.lock) drawCover(g, sm, sm.width, sm.height, x, y, w, hh)
    else if (s.fit === 'contain') { g.fillStyle = '#fff'; g.fillRect(x, y, w, hh); drawContain(g, sm, sm.width, sm.height, x, y, w, hh) }
    else g.drawImage(sm, x, y, w, hh)
    g.restore()
  }

  function drawMarks(g, x, y, w, hh, k) {
    const len = 3 * k, off = 1 * k
    g.save(); g.strokeStyle = '#000'; g.lineWidth = Math.max(1, 0.18 * k); g.beginPath()
    for (const [cx, cy, dx, dy] of [[x, y, -1, -1], [x + w, y, 1, -1], [x, y + hh, -1, 1], [x + w, y + hh, 1, 1]]) {
      g.moveTo(cx + dx * off, cy); g.lineTo(cx + dx * (off + len), cy)
      g.moveTo(cx, cy + dy * off); g.lineTo(cx, cy + dy * (off + len))
    }
    g.stroke(); g.restore()
  }

  /** Render page number `p` (0-based) at k pixels per mm. */
  function renderPage(geom, p, k) {
    const c = newCanvas(Math.round(geom.W * k), Math.round(geom.H * k)), g = c.getContext('2d')
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height)
    const { per, total } = pageCells(geom)
    const from = p * per, to = Math.min(total, from + per)
    for (let i = from; i < to; i++) {
      const j = i - from, col = j % geom.cols, row = Math.floor(j / geom.cols)
      const x = (geom.x0 + col * (s.w + s.gap)) * k, y = (geom.y0 + row * (s.h + s.gap)) * k
      paintCell(g, x, y, s.w * k, s.h * k)
      if (s.marks) drawMarks(g, x, y, s.w * k, s.h * k, k)
    }
    return c
  }

  function update() {
    if (!src) return
    modeSeg.set(s.mode)
    patternBlock.hidden = s.mode !== 'pattern'; pageBlock.hidden = s.mode !== 'page'
    clear(result)
    if (s.mode === 'pattern') {
      typeSeg.set(s.type); drawBgs(); sizeChips.set(SIZES.find((z) => z[1] === s.W && z[2] === s.H)?.[0] || null)
      const P = Math.min(1, 900 / s.W, 700 / s.H)
      const c = renderPattern(Math.round(s.W * P), Math.round(s.H * P))
      c.className = 'pv'
      if (s.clear) c.style.background = 'var(--checker)'
      clear(pvHost, c)
      clear(caption, h('span', h('b', `${s.W} x ${s.H}`), ' px'), h('span', 'Tile about ', h('b', `${Math.round((s.size / 100) * s.W)} px`)))
    } else {
      paperChips.set(s.paper); orientSeg.set(s.orient); unitSeg.set(s.unit); fitSeg.set(s.fit); fitSeg.parentElement.hidden = s.lock
      const geom = pageGeom()
      if (!geom.cols || !geom.rows) {
        clear(pvHost, h('p', { class: 'muted', style: 'text-align:center;padding:40px 0' }, 'One copy is bigger than the page. Make it smaller or reduce the margin.'))
        clear(caption); dlPdf.disabled = dlPng.disabled = true
        return
      }
      dlPdf.disabled = dlPng.disabled = false
      const { per, total, pages } = pageCells(geom)
      const k = Math.min(620 / geom.W, 700 / geom.H)
      const c = renderPage(geom, 0, k)
      c.className = 'pv'
      clear(pvHost, c)
      const unitName = s.unit === 'in' ? 'in' : 'mm'
      clear(caption, h('span', h('b', `${geom.cols} x ${geom.rows}`), ` = ${per} per page`), h('span', h('b', total), ` copies on ${pages} page${pages === 1 ? '' : 's'}`),
        h('span', `${s.paper} ${geom.W > geom.H ? 'landscape' : 'portrait'} (${r2(fromMm(geom.W))} x ${r2(fromMm(geom.H))} ${unitName})`))
    }
  }

  // ---------- downloads ----------
  dlPattern.addEventListener('click', () => busy(dlPattern, async () => {
    const cap = capSize(s.W, s.H)
    const c = renderPattern(cap.w, cap.h)
    const blob = await encode(c, fmt.type, fmt.quality, s.bg)
    download(blob, `${stem(src.name)}-pattern.${fmt.ext}`)
    clear(result, done('Pattern saved', `${cap.w} x ${cap.h} px, ${formatBytes(blob.size)}${cap.capped ? ' (scaled down to fit this device)' : ''}`))
  }, { label: 'Rendering', errorTo: result }))

  dlUnit.addEventListener('click', () => busy(dlUnit, async () => {
    const tile = tileCanvas(clamp(Math.round((s.size / 100) * s.W), 64, 512))
    const u = patternUnit(tile, { type: s.type, gap: Math.round((s.gapPct / 100) * tile.width), bg: s.clear ? null : s.bg })
    const blob = await encode(u, s.clear ? 'image/png' : fmt.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', fmt.quality, s.bg)
    const ext = blob.type === 'image/jpeg' ? 'jpg' : 'png'
    download(blob, `${stem(src.name)}-repeat-tile.${ext}`)
    clear(result, done('Repeatable tile saved', `${u.width} x ${u.height} px. It repeats seamlessly in both directions.`))
  }, { label: 'Building', errorTo: result }))

  dlPng.addEventListener('click', () => busy(dlPng, async () => {
    const geom = pageGeom()
    const c = renderPage(geom, 0, 300 / MM)
    const blob = await encode(c, 'image/png')
    download(blob, `${stem(src.name)}-${s.paper}-page.png`)
    clear(result, done('Page saved as PNG', `First page, ${c.width} x ${c.height} px (${formatBytes(blob.size)}). The PDF has every page.`))
  }, { label: 'Rendering', errorTo: result }))

  dlPdf.addEventListener('click', () => busy(dlPdf, async () => {
    const geom = pageGeom()
    const { per, total, pages } = pageCells(geom)
    const { PDFDocument, rgb } = await pdfLib()
    const doc = await PDFDocument.create()
    // one embedded picture shared by every copy, rendered at up to 300 DPI
    const px = Math.max(8, Math.min(Math.round((s.w / MM) * 300), 2400)), py = Math.max(8, Math.round(px * (s.h / s.w)))
    const cell = newCanvas(px, py), cg = cell.getContext('2d')
    cg.fillStyle = '#fff'; cg.fillRect(0, 0, px, py)
    const keepAlpha = src.alpha
    if (keepAlpha) cg.clearRect(0, 0, px, py)
    const big = { width: src.img.naturalWidth, height: src.img.naturalHeight }
    cg.save(); cg.beginPath(); cg.rect(0, 0, px, py); cg.clip(); cg.imageSmoothingQuality = 'high'
    if (s.fit === 'cover' || s.lock) drawCover(cg, src.img, big.width, big.height, 0, 0, px, py)
    else if (s.fit === 'contain') drawContain(cg, src.img, big.width, big.height, 0, 0, px, py)
    else cg.drawImage(src.img, 0, 0, px, py)
    cg.restore()
    const blob = await encode(cell, keepAlpha ? 'image/png' : 'image/jpeg', 0.93)
    const emb = keepAlpha ? await doc.embedPng(await blob.arrayBuffer()) : await doc.embedJpg(await blob.arrayBuffer())
    const pt = 72 / MM
    for (let p = 0; p < pages; p++) {
      if (signal.aborted) return
      prog.set(p / pages, `Page ${p + 1} of ${pages}`)
      const page = doc.addPage([geom.W * pt, geom.H * pt])
      const from = p * per, to = Math.min(total, from + per)
      for (let i = from; i < to; i++) {
        const j = i - from, col = j % geom.cols, row = Math.floor(j / geom.cols)
        const x = (geom.x0 + col * (s.w + s.gap)) * pt, y = (geom.H - (geom.y0 + row * (s.h + s.gap)) - s.h) * pt
        page.drawImage(emb, { x, y, width: s.w * pt, height: s.h * pt })
        if (s.marks) {
          const len = 3 * pt, off = 1 * pt, w = s.w * pt, hh = s.h * pt
          for (const [cx, cy, dx, dy] of [[x, y, -1, -1], [x + w, y, 1, -1], [x, y + hh, -1, 1], [x + w, y + hh, 1, 1]]) {
            page.drawLine({ start: { x: cx + dx * off, y: cy }, end: { x: cx + dx * (off + len), y: cy }, thickness: 0.5, color: rgb(0, 0, 0) })
            page.drawLine({ start: { x: cx, y: cy + dy * off }, end: { x: cx, y: cy + dy * (off + len) }, thickness: 0.5, color: rgb(0, 0, 0) })
          }
        }
      }
      await yieldToMain()
    }
    const out = await savePdf(doc)
    download(out, `${stem(src.name)}-${s.paper}-${total}x.pdf`)
    clear(result, done('PDF saved', `${total} copies on ${pages} page${pages === 1 ? '' : 's'}, ${formatBytes(out.size)}. Print at 100% / "Actual size".`))
  }, { label: 'Building PDF', errorTo: result, progress: prog }))

  async function load(file) {
    try {
      const img = await loadImage(file)
      const small = scaled(img, 1024)
      const probe = newCanvas(32, 32).getContext('2d', { willReadFrequently: true })
      probe.drawImage(img, 0, 0, 32, 32)
      const d = probe.getImageData(0, 0, 32, 32).data
      let alpha = false
      for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { alpha = true; break }
      src = { img, name: file.name, w: img.naturalWidth, h: img.naturalHeight, small, alpha }
      if (s.lock) s.h = s.w * (src.h / src.w)
      syncUnit()
      drop.setCompact(true)
      sampleBtn.hidden = true
      work.hidden = false
      update()
    } catch (e) { toast(e.message, 'error') }
  }

  work.append(split(stage(pvHost, caption), controls, 'wide-left'))
  root.append(h('div', { class: 't-tile stack' }, drop, h('div', { class: 'row' }, sampleBtn), work))
}
