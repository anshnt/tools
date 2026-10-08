// Sprite sheet generator: pack images with MaxRects, shelf or grid packing, optional trimming, then export PNG + CSS + JSON.
import { h, panel, split, field, input, button, busy, clear, download, toast, formatBytes, rangeField, toggle, fileList, tabs, copyButton, onCleanup } from '../../lib/ui.js'
import { zip } from '../../lib/files.js'
import { addStyle, heroDrop, stage, pills, chipPicker, numField, newCanvas, encode, done, stem, clamp, readImages, frame, IMG_ACCEPT, MAX_PIXELS } from './_shared.js'

const nextPow2 = (n) => { let p = 1; while (p < n) p *= 2; return p }

// ---------- Packing (pure) ----------
/** MaxRects, best short side fit. items: [{w,h}]. Packs into a bin of width W (height grows). Returns {pos: [{x,y}|null], height} */
export function packMaxRects(items, W, maxH = 16384) {
  const free = [{ x: 0, y: 0, w: W, h: maxH }]
  const pos = new Array(items.length).fill(null)
  const order = items.map((_, i) => i).sort((a, b) => Math.max(items[b].w, items[b].h) - Math.max(items[a].w, items[a].h) || items[b].w * items[b].h - items[a].w * items[a].h)
  let height = 0
  for (const i of order) {
    const { w, h: hh } = items[i]
    let best = null, bs = Infinity, bl = Infinity
    for (const f of free) {
      if (f.w < w || f.h < hh) continue
      const short = Math.min(f.w - w, f.h - hh), long = Math.max(f.w - w, f.h - hh)
      // prefer low placement (small y) to keep the sheet short, then the tightest fit
      const score = f.y * 4 + short
      if (score < bs || (score === bs && long < bl)) { best = f; bs = score; bl = long }
    }
    if (!best) return { pos, height, failed: true }
    const r = { x: best.x, y: best.y, w, h: hh }
    pos[i] = { x: r.x, y: r.y }
    height = Math.max(height, r.y + hh)
    for (let k = free.length - 1; k >= 0; k--) {
      const f = free[k]
      if (r.x >= f.x + f.w || r.x + r.w <= f.x || r.y >= f.y + f.h || r.y + r.h <= f.y) continue
      free.splice(k, 1)
      if (r.x > f.x) free.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h })
      if (r.x + r.w < f.x + f.w) free.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - r.x - r.w, h: f.h })
      if (r.y > f.y) free.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y })
      if (r.y + r.h < f.y + f.h) free.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - r.y - r.h })
    }
    for (let a = free.length - 1; a >= 0; a--) {
      for (let b = 0; b < free.length; b++) {
        if (a !== b && free[a] && free[b] && free[a].x >= free[b].x && free[a].y >= free[b].y && free[a].x + free[a].w <= free[b].x + free[b].w && free[a].y + free[a].h <= free[b].y + free[b].h) { free.splice(a, 1); break }
      }
    }
  }
  return { pos, height }
}

/** Simple shelf packing: tallest first, left to right, a new shelf when the row is full. */
export function packShelf(items, W) {
  const order = items.map((_, i) => i).sort((a, b) => items[b].h - items[a].h || items[b].w - items[a].w)
  const pos = new Array(items.length).fill(null)
  let x = 0, y = 0, rowH = 0
  for (const i of order) {
    const { w, h: hh } = items[i]
    if (w > W) return { pos, height: y + rowH, failed: true }
    if (x + w > W) { y += rowH; x = 0; rowH = 0 }
    pos[i] = { x, y }
    x += w; rowH = Math.max(rowH, hh)
  }
  return { pos, height: y + rowH }
}

/** Equal cells in reading order. */
export function packGrid(items, cols) {
  const cw = Math.max(...items.map((i) => i.w)), ch = Math.max(...items.map((i) => i.h))
  const pos = items.map((_, i) => ({ x: (i % cols) * cw, y: Math.floor(i / cols) * ch }))
  return { pos, height: Math.ceil(items.length / cols) * ch, width: cols * cw, cell: [cw, ch] }
}

/**
 * Pack sprites (sizes already include padding). algo: 'maxrects' | 'shelf' | 'grid'. maxW = 0 for automatic.
 * Returns {width, height, pos} with the smallest area found over several candidate widths.
 */
export function pack(items, { algo = 'maxrects', maxW = 0, pow2 = false, cols = 0 } = {}) {
  if (algo === 'grid') {
    const n = items.length
    const cw = Math.max(...items.map((i) => i.w)), ch = Math.max(...items.map((i) => i.h))
    let c = cols > 0 ? cols : Math.max(1, Math.round(Math.sqrt((n * ch) / cw)))
    if (maxW) c = Math.max(1, Math.min(c, Math.floor(maxW / cw)))
    const r = packGrid(items, Math.min(c, n))
    return { width: pow2 ? nextPow2(r.width) : r.width, height: pow2 ? nextPow2(r.height) : r.height, pos: r.pos }
  }
  const minW = Math.max(...items.map((i) => i.w))
  const area = items.reduce((a, i) => a + i.w * i.h, 0)
  const fn = algo === 'shelf' ? packShelf : packMaxRects
  const candidates = new Set()
  if (maxW) candidates.add(Math.max(minW, maxW))
  else {
    const base = Math.ceil(Math.sqrt(area * 1.1))
    for (let k = 0.6; k <= 1.8; k += 0.1) candidates.add(Math.max(minW, Math.round(base * k)))
    for (let p = 64; p <= 8192; p *= 2) if (p >= minW && p <= base * 2.2) candidates.add(p)
  }
  let best = null
  for (const W of candidates) {
    const r = fn(items, W)
    if (r.failed) continue
    let width = Math.max(...r.pos.map((p, i) => p.x + items[i].w)), height = r.height
    if (pow2) { width = nextPow2(width); height = nextPow2(height) }
    const a = width * height
    if (!best || a < best.a - 1 || (Math.abs(a - best.a) <= 1 && Math.abs(width - height) < Math.abs(best.width - best.height))) best = { a, width, height, pos: r.pos }
  }
  return best
}

const slug = (n) => n.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sprite'
const uniqueNames = (names) => { const used = new Map(); return names.map((n) => { const k = slug(n); const c = (used.get(k) || 0) + 1; used.set(k, c); return c > 1 ? `${k}-${c}` : k }) }

/** Bounding box of non-transparent pixels (alpha > 0) of a canvas. */
export function opaqueBounds(c) {
  const g = c.getContext('2d', { willReadFrequently: true })
  const d = g.getImageData(0, 0, c.width, c.height).data
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  return x1 < 0 ? { x: 0, y: 0, w: 1, h: 1 } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

export function buildCss(frames, { sheet, prefix, size }) {
  const lines = [`/* ${sheet}.png is ${size.w} x ${size.h}px */`, `.${prefix} { display: inline-block; background-image: url("${sheet}.png"); background-repeat: no-repeat; }`]
  for (const f of frames) lines.push(`.${prefix}-${f.name} { width: ${f.w}px; height: ${f.h}px; background-position: ${f.x ? `-${f.x}px` : '0'} ${f.y ? `-${f.y}px` : '0'};${f.trimmed ? ` /* trimmed, offset ${f.ox}px ${f.oy}px in the ${f.sw} x ${f.sh} original */` : ''} }`)
  return lines.join('\n') + '\n'
}
export function buildJson(frames, { sheet, size }) {
  const out = { frames: {}, meta: { app: 'Tools sprite sheet generator', image: `${sheet}.png`, format: 'RGBA8888', size: { w: size.w, h: size.h }, scale: '1' } }
  for (const f of frames) out.frames[f.file] = { frame: { x: f.x, y: f.y, w: f.w, h: f.h }, rotated: false, trimmed: f.trimmed, spriteSourceSize: { x: f.ox, y: f.oy, w: f.w, h: f.h }, sourceSize: { w: f.sw, h: f.sh } }
  return JSON.stringify(out, null, 2) + '\n'
}

export function mount(root, { signal }) {
  addStyle('is-sprite', `
.t-sprite .pvbox { position: relative; width: fit-content; max-width: 100%; margin: 0 auto; line-height: 0; }
.t-sprite .pvbox canvas { display: block; max-width: 100%; max-height: 560px; width: auto; height: auto; background: var(--checker); border-radius: 6px; box-shadow: 0 20px 44px -26px rgba(10, 10, 30, .55), 0 0 0 1px rgba(0, 0, 0, .1); }
.t-sprite .hit { position: absolute; border-radius: 2px; transition: background .15s, box-shadow .15s; }
.t-sprite .hit:hover, .t-sprite .hit:focus-visible { background: color-mix(in srgb, var(--accent) 28%, transparent); box-shadow: 0 0 0 2px var(--accent); outline: none; z-index: 2; }
.t-sprite .pvbox.lines .hit { box-shadow: 0 0 0 1px rgba(236, 72, 153, .75); }
.t-sprite .tip { position: absolute; z-index: 5; pointer-events: none; transform: translate(-50%, -110%); background: var(--text); color: var(--bg); padding: 4px 9px; border-radius: 8px; font: 12px var(--mono); line-height: 1.3; white-space: nowrap; }
.t-sprite .list { max-height: 260px; overflow: auto; padding-right: 4px; }
.t-sprite .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.t-sprite .anim { display: grid; gap: 8px; justify-items: center; }
.t-sprite .anim canvas { background: var(--checker); border-radius: 10px; max-width: 100%; max-height: 300px; width: auto; height: auto; box-shadow: 0 0 0 1px rgba(0, 0, 0, .1); image-rendering: pixelated; }
`)
  const s = { algo: 'maxrects', pad: 2, border: 0, maxW: 0, pow2: false, trim: false, cols: 0, name: 'spritesheet', prefix: 'sprite', lines: false, fps: 8 }
  let sprites = [] // {file, name, img, w, h, trim}
  let sheet = null // {canvas, frames, size, eff}
  let animTimer = 0
  onCleanup(() => clearInterval(animTimer))

  const drop = heroDrop({ accept: IMG_ACCEPT, multiple: true, sample: 0, label: 'Drop your sprite images here', hint: 'Icons, game sprites, UI pieces. PNG with transparency works best.', onFiles: (f) => addFiles(f) })
  const work = h('div', { class: 'stack', hidden: true })
  const list = fileList({ onChange: (files) => { sprites = files.map((f) => byFile.get(f)).filter(Boolean); rebuild() } })
  const byFile = new Map()
  const pvHost = h('div'); const caption = h('div', { class: 'is-cap' })
  const outBox = h('div'); const animBox = h('div'); const result = h('div')

  const algoSeg = pills([['maxrects', 'MaxRects (tightest)'], ['shelf', 'Shelf (rows)'], ['grid', 'Grid (equal cells)']], s.algo, (v) => { s.algo = v; rebuild() }, 'Packing')
  const padF = rangeField('Space between sprites', { min: 0, max: 32, value: s.pad, format: (v) => `${v} px`, onInput: (v) => { s.pad = v; soon() } })
  const borderF = rangeField('Sheet border', { min: 0, max: 32, value: 0, format: (v) => `${v} px`, onInput: (v) => { s.border = v; soon() } })
  const maxChips = chipPicker([['0', 'Auto'], ['512', '512'], ['1024', '1024'], ['2048', '2048'], ['4096', '4096']], '0', (v) => { s.maxW = +v; rebuild() }, 'Maximum sheet width')
  const colsF = numField('Columns (0 = auto)', 0, (n) => { s.cols = Number.isFinite(n) ? clamp(Math.round(n), 0, 64) : 0; rebuild() }, { min: 0, max: 64, step: 1 })
  const powT = toggle('Power-of-two sheet size', false, (v) => { s.pow2 = v; rebuild() })
  const trimT = toggle('Trim transparent edges', false, (v) => { s.trim = v; rebuild() })
  const linesT = toggle('Show outlines', false, (v) => { s.lines = v; pvHost.firstChild?.classList.toggle('lines', v) })
  const nameIn = input({ value: s.name, 'aria-label': 'Sheet file name', oninput: () => { s.name = nameIn.value.trim() || 'spritesheet'; renderOutputs() } })
  const prefIn = input({ value: s.prefix, 'aria-label': 'CSS class prefix', oninput: () => { s.prefix = slug(prefIn.value) || 'sprite'; renderOutputs() } })
  const zipBtn = button('Download ZIP (PNG + CSS + JSON)', { icon: 'archive', variant: 'primary', size: 'lg', block: true })
  const pngBtn = button('PNG only', { icon: 'image-down', size: 'sm' })
  const gridBlock = h('div', { class: 'stack' }, colsF)
  const controls = panel(h('div', { class: 'stack' }, field('Packing', algoSeg), padF, borderF, field('Maximum sheet width (px)', maxChips), gridBlock, h('div', { class: 'row' }, powT), trimT, linesT,
    h('div', { class: 'row2' }, field('Sheet name', nameIn), field('CSS class prefix', prefIn)), zipBtn, h('div', { class: 'row' }, pngBtn), result))
  const soon = frame(() => rebuild())

  function rebuild() {
    if (!sprites.length) { work.hidden = true; return }
    work.hidden = false
    algoSeg.set(s.algo); maxChips.set(String(s.maxW))
    gridBlock.hidden = s.algo !== 'grid'
    clear(result)
    const names = uniqueNames(sprites.map((p) => p.file.name))
    const trims = sprites.map((p) => (s.trim ? p.trim ||= opaqueBounds(p.canvas) : { x: 0, y: 0, w: p.w, h: p.h }))
    const items = sprites.map((p, i) => ({ w: trims[i].w + s.pad, h: trims[i].h + s.pad }))
    const inner = s.maxW ? Math.max(1, s.maxW - s.border * 2 + s.pad) : 0
    const packed = pack(items, { algo: s.algo, maxW: inner, pow2: false, cols: s.cols })
    if (!packed) { clear(pvHost, h('p', { class: 'muted', style: 'text-align:center;padding:30px' }, 'A sprite is wider than the maximum sheet width. Pick a bigger width or Auto.')); sheet = null; return }
    let width = packed.width - s.pad + s.border * 2, height = packed.height - s.pad + s.border * 2
    if (s.pow2) { width = nextPow2(width); height = nextPow2(height) }
    if (width * height > MAX_PIXELS || width > 16384 || height > 16384) { clear(pvHost, h('p', { class: 'muted', style: 'text-align:center;padding:30px' }, `That sheet would be ${width} x ${height} px, which is too big for this device. Use smaller sprites or a bigger packing width.`)); sheet = null; return }
    const c = newCanvas(width, height), g = c.getContext('2d')
    const fr = sprites.map((p, i) => {
      const t = trims[i], x = packed.pos[i].x + s.border, y = packed.pos[i].y + s.border
      g.drawImage(p.img, t.x, t.y, t.w, t.h, x, y, t.w, t.h)
      return { name: names[i], file: p.file.name, x, y, w: t.w, h: t.h, ox: t.x, oy: t.y, sw: p.w, sh: p.h, trimmed: s.trim && (t.w !== p.w || t.h !== p.h) }
    })
    const used = fr.reduce((a, f) => a + f.w * f.h, 0)
    sheet = { canvas: c, frames: fr, size: { w: width, h: height }, eff: used / (width * height) }
    c.setAttribute('aria-label', 'Sprite sheet')
    const box = h('div', { class: ['pvbox', s.lines && 'lines'] }, c)
    const tip = h('div', { class: 'tip', hidden: true })
    box.append(tip, ...fr.map((f) => {
      const hit = h('div', { class: 'hit', tabindex: 0, title: `${f.file} - ${f.w} x ${f.h} at ${f.x}, ${f.y}`, 'aria-label': `${f.file}, ${f.w} by ${f.h} pixels at ${f.x}, ${f.y}`,
        style: { left: `${(f.x / width) * 100}%`, top: `${(f.y / height) * 100}%`, width: `${(f.w / width) * 100}%`, height: `${(f.h / height) * 100}%` } })
      const show = () => { tip.hidden = false; tip.textContent = `${f.name}  ${f.w}x${f.h}  @${f.x},${f.y}`; tip.style.left = `${((f.x + f.w / 2) / width) * 100}%`; tip.style.top = `${(f.y / height) * 100}%` }
      hit.addEventListener('pointerenter', show); hit.addEventListener('focus', show); hit.addEventListener('pointerleave', () => { tip.hidden = true }); hit.addEventListener('blur', () => { tip.hidden = true })
      return hit
    }))
    clear(pvHost, box)
    clear(caption, h('span', h('b', `${width} x ${height}`), ' px'), h('span', h('b', sprites.length), ' sprites'), h('span', 'Packing ', h('b', `${Math.round(sheet.eff * 100)}%`), ' full'))
    renderOutputs()
    renderAnim()
  }

  function renderOutputs() {
    if (!sheet) return
    const sheetName = s.name.replace(/\.png$/i, '')
    const css = buildCss(sheet.frames, { sheet: sheetName, prefix: s.prefix, size: sheet.size })
    const json = buildJson(sheet.frames, { sheet: sheetName, size: sheet.size })
    sheet.css = css; sheet.json = json
    const pane = (text, ext, mime) => () => h('div', { class: 'stack tight' }, h('pre', { class: 'code-out', style: 'max-height:300px' }, text),
      h('div', { class: 'row' }, copyButton(() => text, 'Copy'), button('Download', { icon: 'download', size: 'sm', onClick: () => download(text, `${sheetName}.${ext}`, mime) })))
    clear(outBox, tabs([{ id: 'css', label: 'CSS', render: pane(css, 'css', 'text/css') }, { id: 'json', label: 'JSON (frames)', render: pane(json, 'json', 'application/json') }]))
  }

  function renderAnim() {
    clearInterval(animTimer)
    if (!sheet || sheet.frames.length < 2) return clear(animBox)
    const fr = sheet.frames
    const W = Math.max(...fr.map((f) => f.sw)), H = Math.max(...fr.map((f) => f.sh))
    const k = Math.min(4, Math.max(1, Math.floor(160 / Math.max(W, H))))
    const cv = newCanvas(W * k, H * k), g = cv.getContext('2d')
    g.imageSmoothingEnabled = false
    let i = 0, playing = true
    const draw = () => { const f = fr[i % fr.length]; g.clearRect(0, 0, cv.width, cv.height); g.drawImage(sheet.canvas, f.x, f.y, f.w, f.h, (f.ox + (W - f.sw) / 2) * k, (f.oy + (H - f.sh) / 2) * k, f.w * k, f.h * k) }
    const start = () => { clearInterval(animTimer); animTimer = setInterval(() => { if (playing) { i++; draw() } }, 1000 / s.fps) }
    const playBtn = button('Pause', { icon: 'pause', size: 'sm', onClick: () => { playing = !playing; playBtn.replaceChildren(...button(playing ? 'Pause' : 'Play', { icon: playing ? 'pause' : 'play', size: 'sm' }).childNodes) } })
    const fps = rangeField('Speed', { min: 1, max: 30, value: s.fps, format: (v) => `${v} fps`, onInput: (v) => { s.fps = v; start() } })
    draw(); start()
    clear(animBox, panel(h('div', { class: 'panel-title' }, h('span', 'Play it as an animation'), playBtn), h('div', { class: 'anim' }, cv, h('div', { style: 'width:min(100%,320px)' }, fps))))
  }

  const baseName = () => s.name.replace(/\.png$/i, '')
  zipBtn.addEventListener('click', () => busy(zipBtn, async () => {
    if (!sheet) throw new Error('Add some sprites first.')
    const png = await encode(sheet.canvas, 'image/png')
    const blob = await zip([{ name: `${baseName()}.png`, data: png }, { name: `${baseName()}.css`, data: sheet.css }, { name: `${baseName()}.json`, data: sheet.json }])
    download(blob, `${baseName()}.zip`)
    clear(result, done('Sprite sheet saved', `${sheet.size.w} x ${sheet.size.h} px, ${sheet.frames.length} sprites, ${formatBytes(blob.size)} zipped`))
  }, { label: 'Packing', errorTo: result }))
  pngBtn.addEventListener('click', () => busy(pngBtn, async () => { if (sheet) download(await encode(sheet.canvas, 'image/png'), `${baseName()}.png`) }, { errorTo: result }))

  async function addFiles(files) {
    const loaded = await readImages(files, { signal })
    const added = []
    for (const l of loaded) {
      if (l.w * l.h > 4_000_000) { toast(`${l.name} is very large for a sprite (${l.w} x ${l.h}). It was skipped.`, 'error'); continue }
      const canvas = newCanvas(l.w, l.h); canvas.getContext('2d', { willReadFrequently: true }).drawImage(l.img, 0, 0)
      const p = { file: l.file, img: l.img, w: l.w, h: l.h, canvas }
      byFile.set(l.file, p); added.push(l.file)
    }
    if (!added.length) return
    list.add(added)
    drop.setCompact(true)
  }

  work.append(split(h('div', { class: 'stack' }, stage(pvHost, caption), outBox, animBox), h('div', { class: 'stack' }, controls, panel(h('div', { class: 'panel-title' }, h('span', 'Sprites (drag to reorder)')), h('div', { class: 'list' }, list.el))), 'wide-left'))
  root.append(h('div', { class: 't-sprite stack' }, drop, work))
}
