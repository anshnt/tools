// Image splitter: cut an image into a grid (2x2, 3x3, custom, tile size) or an Instagram 3-wide grid, with preview lines and a ZIP.
import { h, svg, icon, panel, split, field, button, busy, progress, clear, download, toast, formatBytes, yieldToMain, onCleanup, rangeField } from '../../lib/ui.js'
import { zip } from '../../lib/files.js'
import { loadImage, canvas as mkCanvas, MAX_PIXELS } from '../../lib/image.js'
import { addStyle, heroDrop, stage, pills, chipPicker, numField, formatPicker, encode, done, stem, scaled, clamp, IMG_ACCEPT } from './_shared.js'

/** Work out the crop, the grid and every tile rectangle (in source pixels). */
export function planSplit({ W, H, mode = 'grid', rows = 3, cols = 3, byTile = false, tileW = 500, tileH = 500, shape = 'square', igRows = 3, fx = 0.5, fy = 0.5 }) {
  let crop = { x: 0, y: 0, w: W, h: H }
  let xs, ys
  if (mode === 'instagram') {
    cols = 3; rows = igRows
    const tileAspect = shape === 'portrait' ? 4 / 5 : 1
    const R = (cols * tileAspect) / rows
    if (W / H > R) { const cw = Math.round(H * R); crop = { x: Math.round((W - cw) * fx), y: 0, w: cw, h: H } }
    else { const ch = Math.round(W / R); crop = { x: 0, y: Math.round((H - ch) * fy), w: W, h: ch } }
  } else if (byTile) {
    cols = Math.max(1, Math.ceil(W / tileW)); rows = Math.max(1, Math.ceil(H / tileH))
    xs = Array.from({ length: cols + 1 }, (_, i) => Math.min(W, i * tileW))
    ys = Array.from({ length: rows + 1 }, (_, i) => Math.min(H, i * tileH))
  }
  cols = clamp(Math.round(cols) || 1, 1, crop.w); rows = clamp(Math.round(rows) || 1, 1, crop.h)
  xs ||= Array.from({ length: cols + 1 }, (_, i) => crop.x + Math.round((i * crop.w) / cols))
  ys ||= Array.from({ length: rows + 1 }, (_, i) => crop.y + Math.round((i * crop.h) / rows))
  const tiles = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const idx = r * cols + c
    tiles.push({ r, c, idx, x: xs[c], y: ys[r], w: xs[c + 1] - xs[c], h: ys[r + 1] - ys[r], post: rows * cols - idx })
  }
  return { crop, cols, rows, tiles }
}

const PRESETS = [['2x2', 2, 2], ['3x3', 3, 3], ['4x4', 4, 4], ['2x1', 1, 2], ['3x1', 1, 3], ['1x3', 3, 1], ['2x3', 3, 2], ['5x5', 5, 5]]
const MAX_TILES = 400

export function mount(root, { signal }) {
  addStyle('is-split', `
.t-split .pv { position: relative; display: inline-block; max-width: 100%; line-height: 0; }
.t-split .pv canvas { display: block; max-width: 100%; height: auto; max-height: 560px; width: auto; }
.t-split .pv svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
.t-split .pv .ln { stroke: #fff; stroke-width: 2; vector-effect: non-scaling-stroke; stroke-dasharray: 1; stroke-dashoffset: 1; animation: isDraw .7s var(--ease) forwards;
  filter: drop-shadow(0 0 2px rgba(0, 0, 0, .75)); }
.t-split .pv .shade { fill: rgba(8, 8, 20, .6); fill-rule: evenodd; }
.t-split .pv .hl { fill: color-mix(in srgb, var(--accent) 30%, transparent); stroke: var(--accent); stroke-width: 3; vector-effect: non-scaling-stroke; opacity: 0; transition: opacity .15s; }
.t-split .pv .num { position: absolute; transform: translate(-50%, -50%); min-width: 24px; height: 24px; padding: 0 6px; border-radius: 999px; display: grid; place-items: center; line-height: 1;
  font-size: 12px; font-weight: 700; color: #fff; background: rgba(10, 10, 25, .62); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); font-variant-numeric: tabular-nums; animation: isPop .5s var(--spring) both; }
.t-split .sp-tiles { display: grid; gap: 6px; }
.t-split .sp-tile { position: relative; padding: 0; border: 0; background: var(--surface-2); border-radius: 8px; overflow: hidden; cursor: pointer; line-height: 0; animation: isPop .5s var(--spring) both; animation-delay: calc(var(--i, 0) * 25ms);
  transition: transform .25s var(--spring), box-shadow .25s; }
.t-split .sp-tile:hover, .t-split .sp-tile:focus-visible { transform: scale(1.04); z-index: 2; box-shadow: var(--shadow); }
.t-split .sp-tile canvas { width: 100%; height: auto; display: block; }
.t-split .sp-tile .tn { position: absolute; left: 6px; top: 6px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; display: grid; place-items: center; font-size: 11px; font-weight: 700; color: #fff; background: rgba(10, 10, 25, .62); line-height: 1; }
.t-split .sp-tile .dl { position: absolute; right: 6px; bottom: 6px; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: var(--accent); opacity: 0; transform: scale(.7); transition: all .25s var(--spring); }
.t-split .sp-tile:hover .dl, .t-split .sp-tile:focus-visible .dl { opacity: 1; transform: none; }
@media (hover: none) { .t-split .sp-tile .dl { opacity: .95; transform: none; } }
.t-split .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
`)
  let src = null // {img, w, h, name}
  let base = null // scaled preview canvas
  const s = { mode: 'grid', rows: 3, cols: 3, byTile: false, tileW: 500, tileH: 500, shape: 'square', igRows: 3, fx: 0.5, fy: 0.5, igSize: '1080', order: true }

  const drop = heroDrop({ accept: IMG_ACCEPT, sample: 1, label: 'Drop an image to split', onFiles: ([f]) => load(f) })
  const work = h('div', { class: 'stack', hidden: true })
  const pvHost = h('div', { style: 'text-align:center' })
  const caption = h('div', { class: 'is-cap' })
  const gallery = h('div')
  const result = h('div')
  const prog = progress()

  // ---- controls ----
  const modeSeg = pills([['grid', 'Grid'], ['instagram', 'Instagram grid']], s.mode, (v) => { s.mode = v; update() }, 'Split mode')
  const presetChips = chipPicker(PRESETS.map(([l]) => [l, l.replace('x', ' x ')]), null, (l) => {
    const p = PRESETS.find((x) => x[0] === l)
    s.cols = p[1]; s.rows = p[2]; s.byTile = false; colsF.input.value = s.cols; rowsF.input.value = s.rows; update()
  }, 'Grid presets')
  const colsF = numField('Columns', s.cols, (n) => { s.cols = n; s.byTile = false; update() }, { min: 1, max: 20, step: 1 })
  const rowsF = numField('Rows', s.rows, (n) => { s.rows = n; s.byTile = false; update() }, { min: 1, max: 20, step: 1 })
  const byTileSeg = pills([[false, 'Rows and columns'], [true, 'Tile size']], false, (v) => { s.byTile = v; update() }, 'Split by')
  const twF = numField('Tile width (px)', s.tileW, (n) => { s.tileW = n; update() }, { min: 1, step: 1 })
  const thF = numField('Tile height (px)', s.tileH, (n) => { s.tileH = n; update() }, { min: 1, step: 1 })
  const shapeSeg = pills([['square', 'Square 1:1'], ['portrait', 'Portrait 4:5']], s.shape, (v) => { s.shape = v; update() }, 'Tile shape')
  const igRowsSeg = pills([1, 2, 3, 4, 5, 6].map((n) => [n, `${n}`]), s.igRows, (v) => { s.igRows = v; update() }, 'Rows')
  const igSizeSeg = pills([['1080', '1080 px wide'], ['orig', 'Original size']], s.igSize, (v) => { s.igSize = v; update() }, 'Tile output size')
  const focus = rangeField('Crop position', { min: 0, max: 100, value: 50, format: (v) => `${v}%`, onInput: (v) => { s.fx = s.fy = v / 100; update() } })
  const orderToggle = h('label', { class: 'switch' }, h('input', { type: 'checkbox', role: 'switch', checked: true, onchange: (e) => { s.order = e.target.checked; update() } }), h('span', 'Number tiles in posting order'))
  const fmt = formatPicker({ value: 'image/png', onChange: () => {} })
  const dlBtn = button('Download all tiles (ZIP)', { icon: 'archive', variant: 'primary', size: 'lg', block: true })

  const gridBlock = h('div', { class: 'stack' }, field('Presets', presetChips), byTileSeg,
    h('div', { class: 'row2' }, colsF, rowsF), h('div', { class: 'row2', hidden: true }, twF, thF))
  const igBlock = h('div', { class: 'stack' }, field('Tile shape', shapeSeg), field('Rows (always 3 columns)', igRowsSeg), field('Tile size', igSizeSeg), focus, orderToggle,
    h('p', { class: 'small muted' }, 'Instagram shows the newest post top-left. Post the tiles in numbered order (1 first) so the grid lines up on your profile.'))
  const tileRow = gridBlock.lastChild, rcRow = gridBlock.children[2]

  const controls = panel(h('div', { class: 'stack' }, modeSeg, gridBlock, igBlock, fmt.el, dlBtn, prog.el, result))

  let plan = null
  function update() {
    if (!src) return
    modeSeg.set(s.mode); byTileSeg.set(s.byTile); shapeSeg.set(s.shape); igRowsSeg.set(s.igRows); igSizeSeg.set(s.igSize)
    gridBlock.hidden = s.mode !== 'grid'; igBlock.hidden = s.mode !== 'instagram'
    rcRow.hidden = s.byTile; tileRow.hidden = !s.byTile
    presetChips.set((PRESETS.find((p) => p[1] === s.cols && p[2] === s.rows && !s.byTile) || [])[0] || null)
    plan = planSplit({ W: src.w, H: src.h, ...s })
    const n = plan.tiles.length
    clear(result)
    if (n > MAX_TILES) { clear(pvHost); clear(gallery); clear(caption, `That makes ${n} tiles. The limit is ${MAX_TILES}; use fewer rows or columns.`); dlBtn.disabled = true; return }
    dlBtn.disabled = false
    const cropped = plan.crop.w !== src.w || plan.crop.h !== src.h
    const tw = plan.tiles[0].w, th = plan.tiles[0].h
    const ig = s.mode === 'instagram'
    const out = ig && s.igSize === '1080' ? [1080, Math.round(1080 / (s.shape === 'portrait' ? 4 / 5 : 1))] : [tw, th]
    clear(caption, h('span', h('b', `${plan.cols} x ${plan.rows}`), ` = ${n} tile${n === 1 ? '' : 's'}`), h('span', 'each about ', h('b', `${out[0]} x ${out[1]} px`)), cropped ? h('span', `Crop ${plan.crop.w} x ${plan.crop.h}`) : null)
    focus.hidden = !(ig && cropped)
    drawPreview(ig)
    drawGallery(ig)
  }

  function drawPreview(ig) {
    const { crop, tiles: ts, cols, rows } = plan
    const W = src.w, H = src.h
    const pv = h('div', { class: 'pv' }, base)
    const lines = []
    for (let c = 1; c < cols; c++) { const x = ts[c].x; lines.push(h('line', { class: 'ln', x1: x, y1: crop.y, x2: x, y2: crop.y + crop.h, pathLength: 1 })) }
    for (let r = 1; r < rows; r++) { const y = ts[r * cols].y; lines.push(h('line', { class: 'ln', x1: crop.x, y1: y, x2: crop.x + crop.w, y2: y, pathLength: 1 })) }
    const shade = (crop.w !== W || crop.h !== H) ? h('path', { class: 'shade', d: `M0 0H${W}V${H}H0Z M${crop.x} ${crop.y}H${crop.x + crop.w}V${crop.y + crop.h}H${crop.x}Z` }) : null
    const hl = h('rect', { class: 'hl' })
    pv.append(svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' }, shade, hl, ...lines))
    pv._hl = hl
    if (ts.length <= 36) for (const t of ts) pv.append(h('span', { class: 'num', style: { left: `${((t.x + t.w / 2) / W) * 100}%`, top: `${((t.y + t.h / 2) / H) * 100}%`, animationDelay: `${t.idx * 25}ms` } }, ig && s.order ? t.post : t.idx + 1))
    clear(pvHost, pv)
    drawPreview.pv = pv
  }

  function thumb(t) {
    const k = Math.min(1, 240 / Math.max(t.w, t.h))
    const c = mkCanvas(Math.max(1, t.w * k), Math.max(1, t.h * k))
    const g = c.getContext('2d')
    g.imageSmoothingQuality = 'high'
    g.drawImage(src.img, t.x, t.y, t.w, t.h, 0, 0, c.width, c.height)
    return c
  }

  function drawGallery(ig) {
    const { tiles: ts, cols } = plan
    const shown = ts.slice(0, 100)
    const grid = h('div', { class: 'sp-tiles', style: { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } },
      shown.map((t, i) => {
        const b = h('button', { type: 'button', class: 'sp-tile', style: { '--i': Math.min(i, 20) }, 'aria-label': `Download tile ${ig && s.order ? t.post : t.idx + 1}`, title: 'Download this tile',
          onclick: () => saveOne(t),
          onmouseenter: () => hilite(t), onmouseleave: () => hilite(null), onfocus: () => hilite(t), onblur: () => hilite(null) },
        thumb(t), h('span', { class: 'tn' }, ig && s.order ? t.post : t.idx + 1), h('span', { class: 'dl' }, icon('download')))
        return b
      }))
    clear(gallery, h('div', { class: 'stack tight' }, h('h3', { class: 'is-eyebrow' }, 'Your tiles (click one to download it)'), grid, ts.length > 100 ? h('p', { class: 'small muted' }, `Showing the first 100 of ${ts.length}. The ZIP has them all.`) : null))
  }

  function hilite(t) {
    const hl = drawPreview.pv?._hl
    if (!hl) return
    if (!t) { hl.style.opacity = 0; return }
    hl.setAttribute('x', t.x); hl.setAttribute('y', t.y); hl.setAttribute('width', t.w); hl.setAttribute('height', t.h)
    hl.style.opacity = 1
  }

  function render(t) {
    const ig = s.mode === 'instagram'
    let ow = t.w, oh = t.h
    if (ig && s.igSize === '1080') { ow = 1080; oh = Math.round(1080 / (s.shape === 'portrait' ? 4 / 5 : 1)) }
    const c = mkCanvas(ow, oh)
    const g = c.getContext('2d')
    g.imageSmoothingQuality = 'high'
    g.drawImage(src.img, t.x, t.y, t.w, t.h, 0, 0, ow, oh)
    return c
  }
  const nameOf = (t) => {
    const ig = s.mode === 'instagram'
    const pad = (n) => String(n).padStart(2, '0')
    return `${stem(src.name)}-${ig ? `post${pad(t.post)}-` : ''}r${t.r + 1}c${t.c + 1}.${fmt.ext}`
  }
  async function saveOne(t) {
    try { download(await encode(render(t), fmt.type, fmt.quality), nameOf(t)) } catch (e) { toast(e.message, 'error') }
  }

  dlBtn.addEventListener('click', () => busy(dlBtn, async () => {
    const ts = [...plan.tiles], snapshot = { type: fmt.type, quality: fmt.quality, ext: fmt.ext }
    clear(result)
    const entries = []
    for (let i = 0; i < ts.length; i++) {
      if (signal.aborted) return
      prog.set(i / ts.length, `Cutting tile ${i + 1} of ${ts.length}`)
      const blob = await encode(render(ts[i]), snapshot.type, snapshot.quality)
      entries.push({ name: nameOf(ts[i]), data: blob })
      await yieldToMain()
    }
    prog.set(1, 'Zipping')
    const blob = await zip(entries)
    const file = `${stem(src.name)}-${plan.cols}x${plan.rows}-tiles.zip`
    download(blob, file)
    clear(result, done(`${ts.length} tiles saved`, `${file} (${formatBytes(blob.size)})`, button('Download again', { icon: 'download', variant: 'secondary', size: 'sm', onClick: () => download(blob, file) })))
  }, { label: 'Cutting', errorTo: result, progress: prog }))

  async function load(file) {
    try {
      const img = await loadImage(file)
      src = { img, w: img.naturalWidth, h: img.naturalHeight, name: file.name }
      if (src.w * src.h > MAX_PIXELS * 2) throw new Error('That image is very large. Try one under about 100 megapixels.')
      base = scaled(img, 1400)
      base.classList.add('is-frame')
      s.fx = s.fy = 0.5; focus.set(50)
      drop.setCompact(true)
      work.hidden = false
      update()
    } catch (e) { toast(e.message, 'error') }
  }

  work.append(split(
    h('div', { class: 'stack' }, stage(pvHost, caption), gallery),
    controls, 'wide-left'))
  root.append(h('div', { class: 't-split stack' }, drop, work))
}
