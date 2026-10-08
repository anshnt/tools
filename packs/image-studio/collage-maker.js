// Collage & montage maker: grid, mosaic, strips and hero layouts with spacing, corner radius and backgrounds. Drag photos between cells.
import { h, icon, panel, split, field, button, busy, clear, download, toast, formatBytes, rangeField, toggle, dropzone, onCleanup } from '../../lib/ui.js'
import { addStyle, heroDrop, stage, pills, chipPicker, numField, newCanvas, capSize, encode, formatPicker, done, scaled, drawCover, rng, clamp, readImages, frame, IMG_ACCEPT, MAX_PIXELS } from './_shared.js'

const RATIOS = [['1:1', 1], ['4:5', 4 / 5], ['3:2', 3 / 2], ['16:9', 16 / 9], ['9:16', 9 / 16], ['A4', 1 / Math.SQRT2], ['A4 wide', Math.SQRT2]]
const BGS = [
  { id: 'white', name: 'White', css: '#ffffff' }, { id: 'black', name: 'Black', css: '#111111' }, { id: 'cream', name: 'Cream', css: '#f6efe0' }, { id: 'slate', name: 'Slate', css: '#243044' },
  { id: 'sunset', name: 'Sunset', grad: ['#fb923c', '#ec4899', '#6366f1'] }, { id: 'ocean', name: 'Ocean', grad: ['#22d3ee', '#3b82f6', '#7c3aed'] }, { id: 'mint', name: 'Mint', grad: ['#a7f3d0', '#fde68a'] },
  { id: 'clear', name: 'Transparent (PNG)', css: null },
]
const EDGES = [['1080', '1080 px'], ['2048', '2048 px'], ['3000', '3000 px'], ['4096', '4096 px']]

// ---------- Layout (pure) ----------
/** Split the unit square into n rectangles. aspect = canvas width / height. Returns [{x,y,w,h}] with every value in 0..1. */
export function layoutCells(kind, n, aspect, { cols = 0, dir = 'rows', seed = 1 } = {}) {
  if (n <= 0) return []
  if (n === 1) return [{ x: 0, y: 0, w: 1, h: 1 }]
  const gridIn = (count, r, asp) => {
    let c = cols > 0 ? Math.min(cols, count) : clamp(Math.round(Math.sqrt(count * asp * (r.w / r.h))), 1, count)
    const rows = Math.ceil(count / c)
    const out = []
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / c), inRow = row === rows - 1 ? count - (rows - 1) * c : c, k = i - row * c
      out.push({ x: r.x + (k / inRow) * r.w, y: r.y + (row / rows) * r.h, w: r.w / inRow, h: r.h / rows })
    }
    return out
  }
  if (kind === 'strips') return Array.from({ length: n }, (_, i) => (dir === 'cols' ? { x: i / n, y: 0, w: 1 / n, h: 1 } : { x: 0, y: i / n, w: 1, h: 1 / n }))
  if (kind === 'hero') {
    const w = n === 2 ? 0.58 : 0.6
    return [{ x: 0, y: 0, w, h: 1 }, ...gridIn(n - 1, { x: w, y: 0, w: 1 - w, h: 1 }, aspect)]
  }
  if (kind === 'mosaic') {
    const rand = rng(seed * 7919 + 13), out = []
    const split2 = (count, r) => {
      if (count === 1) { out.push(r); return }
      const a = clamp(Math.round(count * (0.35 + rand() * 0.3)), 1, count - 1)
      const ratio = clamp((a / count) * (0.88 + rand() * 0.24), 0.2, 0.8)
      if (r.w * aspect >= r.h) { split2(a, { x: r.x, y: r.y, w: r.w * ratio, h: r.h }); split2(count - a, { x: r.x + r.w * ratio, y: r.y, w: r.w * (1 - ratio), h: r.h }) }
      else { split2(a, { x: r.x, y: r.y, w: r.w, h: r.h * ratio }); split2(count - a, { x: r.x, y: r.y + r.h * ratio, w: r.w, h: r.h * (1 - ratio) }) }
    }
    split2(n, { x: 0, y: 0, w: 1, h: 1 })
    return out
  }
  return gridIn(n, { x: 0, y: 0, w: 1, h: 1 }, aspect)
}

/** Pixel rectangles for the cells: layout inside the padded area, shrunk by half the gap where cells touch. */
export function cellRects(W, H, kind, n, opts, gap, pad) {
  const cw = W - pad * 2, ch = H - pad * 2
  const unit = layoutCells(kind, n, cw / ch, opts)
  const eps = 1e-6
  return unit.map((u) => {
    const l = u.x > eps ? gap / 2 : 0, t = u.y > eps ? gap / 2 : 0, r = u.x + u.w < 1 - eps ? gap / 2 : 0, b = u.y + u.h < 1 - eps ? gap / 2 : 0
    return { x: pad + u.x * cw + l, y: pad + u.y * ch + t, w: Math.max(2, u.w * cw - l - r), h: Math.max(2, u.h * ch - t - b) }
  })
}

export function mount(root, { signal }) {
  addStyle('is-collage', `
.t-col .ov { position: absolute; inset: 0; touch-action: pan-y; }
.t-col .ov .cell { position: absolute; border-radius: 8px; cursor: grab; outline: 0; transition: box-shadow .2s, background .2s; }
.t-col .ov .cell:hover { box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 70%, transparent); }
.t-col .ov .cell:focus-visible { box-shadow: inset 0 0 0 3px var(--accent); }
.t-col .ov .cell.sel { box-shadow: inset 0 0 0 3px var(--accent), inset 0 0 0 6px rgba(255, 255, 255, .85); }
.t-col .ov .cell.over { background: color-mix(in srgb, var(--accent) 35%, transparent); box-shadow: inset 0 0 0 3px #fff, inset 0 0 0 6px var(--accent); }
.t-col .ov .cell.drag { opacity: .45; }
.t-col .ov .cell .no { position: absolute; left: 8px; top: 8px; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 999px; display: grid; place-items: center; font-size: 11.5px; font-weight: 700; color: #fff; background: rgba(10, 10, 25, .6); opacity: 0; transition: opacity .2s; }
.t-col .ov .cell:hover .no, .t-col .ov .cell.sel .no { opacity: 1; }
.col-ghost { position: fixed; z-index: 600; pointer-events: none; width: 88px; border-radius: 10px; box-shadow: 0 18px 40px -10px rgba(0, 0, 0, .55); transform: translate(-50%, -50%) rotate(-4deg) scale(1.05); overflow: hidden; border: 2px solid #fff; line-height: 0; }
.col-ghost canvas { width: 100%; height: auto; display: block; }
.t-col .pvwrap { position: relative; width: fit-content; max-width: 100%; margin: 0 auto; line-height: 0; user-select: none; -webkit-user-select: none; }
.t-col .pvwrap canvas.pv { display: block; max-width: 100%; max-height: 640px; width: auto; height: auto; border-radius: 6px; box-shadow: 0 24px 48px -26px rgba(10, 10, 30, .55), 0 0 0 1px rgba(0, 0, 0, .08); }
.t-col .strip { display: flex; gap: 8px; overflow-x: auto; padding: 4px 2px 8px; scrollbar-width: thin; }
.t-col .strip .dropzone { flex: none; min-width: 210px; }
.t-col .strip button { position: relative; flex: none; width: 56px; height: 56px; padding: 0; border-radius: 12px; border: 2px solid transparent; background: var(--surface-2); overflow: hidden; cursor: pointer; transition: transform .2s var(--spring), border-color .2s; animation: isPop .45s var(--spring) both; animation-delay: calc(var(--i, 0) * 30ms); }
.t-col .strip button:hover { transform: translateY(-3px); }
.t-col .strip button[aria-pressed="true"] { border-color: var(--accent); }
.t-col .strip button canvas { width: 100%; height: 100%; object-fit: cover; display: block; }
.t-col .strip button span { position: absolute; left: 3px; bottom: 3px; min-width: 18px; height: 18px; border-radius: 999px; background: rgba(10, 10, 25, .65); color: #fff; font-size: 10.5px; font-weight: 700; display: grid; place-items: center; }
.t-col .bgs { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.t-col .bgs button { width: 34px; height: 34px; border-radius: 50%; border: 2px solid var(--border); cursor: pointer; padding: 0; transition: transform .2s var(--spring), box-shadow .2s; }
.t-col .bgs button:hover { transform: scale(1.12); }
.t-col .bgs button[aria-pressed="true"] { box-shadow: 0 0 0 3px var(--surface), 0 0 0 5px var(--accent); }
.t-col .bgs input[type=color] { width: 34px; height: 34px; padding: 0; border: 2px solid var(--border); border-radius: 50%; background: none; cursor: pointer; overflow: hidden; }
.t-col .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.t-col .swapchips { display: flex; flex-wrap: wrap; gap: 6px; }
.t-col .swapchips button { min-width: 34px; }
`)
  const s = { kind: 'grid', cols: 0, dir: 'rows', seed: 1, ratio: 1, gap: 12, pad: 12, radius: 14, bg: 'white', custom: '#8b5cf6', edge: '2048', sel: 0 }
  let photos = []
  let idc = 0

  const drop = heroDrop({ accept: IMG_ACCEPT, multiple: true, sample: 5, label: 'Drop your photos to start a collage', hint: 'Choose 2 to 20 images. Drag them around afterwards.', onFiles: (files) => addFiles(files) })
  const work = h('div', { class: 'stack', hidden: true })
  const wrap = h('div', { class: 'pvwrap' })
  const cv = h('canvas', { class: 'pv', role: 'img', 'aria-label': 'Collage preview' })
  const ov = h('div', { class: 'ov' })
  wrap.append(cv, ov)
  const caption = h('div', { class: 'is-cap' })
  const strip = h('div', { class: 'strip' })
  const cellPanel = h('div', { class: 'stack' })
  const result = h('div')

  // ---- controls ----
  const kindSeg = pills([['grid', 'Grid'], ['mosaic', 'Mosaic'], ['strips', 'Strips'], ['hero', 'Feature']], s.kind, (v) => { s.kind = v; update() }, 'Layout')
  const colsF = numField('Columns (0 = auto)', s.cols, (n) => { s.cols = Number.isFinite(n) ? clamp(Math.round(n), 0, 12) : 0; update() }, { min: 0, max: 12, step: 1 })
  const dirSeg = pills([['rows', 'Rows'], ['cols', 'Columns']], s.dir, (v) => { s.dir = v; update() }, 'Strip direction')
  const shuffleBtn = button('New mosaic', { icon: 'shuffle', size: 'sm', onClick: () => { s.seed++; update() } })
  const ratioChips = chipPicker(RATIOS.map(([l]) => [l, l]), '1:1', (l) => { s.ratio = RATIOS.find((r) => r[0] === l)[1]; update() }, 'Canvas shape')
  const gapF = rangeField('Spacing', { min: 0, max: 60, value: s.gap, format: (v) => `${v}`, onInput: (v) => { s.gap = v; soon() } })
  const padF = rangeField('Outer margin', { min: 0, max: 80, value: s.pad, format: (v) => `${v}`, onInput: (v) => { s.pad = v; soon() } })
  const radF = rangeField('Corner radius', { min: 0, max: 80, value: s.radius, format: (v) => `${v}`, onInput: (v) => { s.radius = v; soon() } })
  const bgBox = h('div', { class: 'bgs', role: 'group', 'aria-label': 'Background' })
  const colorIn = h('input', { type: 'color', value: s.custom, 'aria-label': 'Custom background color', oninput: () => { s.custom = colorIn.value; s.bg = 'custom'; update() } })
  const edgeSeg = pills(EDGES, s.edge, (v) => { s.edge = v; update() }, 'Export size')
  const fmt = formatPicker({ value: 'image/png' })
  const dlBtn = button('Download collage', { icon: 'download', variant: 'primary', size: 'lg', block: true })
  const addMore = dropzone({ accept: IMG_ACCEPT, multiple: true, compact: true, label: 'Add more photos', hint: 'Drop or click', paste: false, onFiles: (f) => addFiles(f) })
  const randomBtn = button('Shuffle photos', { icon: 'dices', size: 'sm', onClick: () => { for (let i = photos.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [photos[i], photos[j]] = [photos[j], photos[i]] } s.seed++; update() } })
  const clearBtn = button('Start over', { icon: 'trash-2', variant: 'ghost', size: 'sm', onClick: () => { photos = []; s.sel = 0; refreshWork() } })

  const kindOpts = h('div', { class: 'stack tight' })
  function drawBgs() {
    clear(bgBox, BGS.map((b) => {
      const style = b.grad ? `background:linear-gradient(135deg,${b.grad.join(',')})` : b.css ? `background:${b.css}` : 'background:var(--checker)'
      return h('button', { type: 'button', style, 'aria-label': b.name, title: b.name, 'aria-pressed': String(s.bg === b.id), onclick: () => { s.bg = b.id; update() } })
    }), colorIn)
  }
  const controls = panel(h('div', { class: 'stack' },
    field('Layout', kindSeg), kindOpts, field('Canvas shape', ratioChips),
    h('div', { class: 'row2' }, gapF, padF), radF, field('Background', bgBox), field('Export size (long edge)', edgeSeg), fmt.el, dlBtn, result))

  const soon = frame(() => update())

  // ---- geometry ----
  const previewSize = () => {
    const long = 1100
    return s.ratio >= 1 ? [long, Math.round(long / s.ratio)] : [Math.round(long * s.ratio), long]
  }
  const scaleOf = (W, H) => Math.max(W, H) / 1000
  const rectsFor = (W, H) => { const k = scaleOf(W, H); return cellRects(W, H, s.kind, photos.length, { cols: s.cols, dir: s.dir, seed: s.seed }, s.gap * k, s.pad * k) }

  function paint(ctx, W, H, rects, { useSmall }) {
    const bg = s.bg === 'custom' ? { css: s.custom } : BGS.find((b) => b.id === s.bg)
    ctx.clearRect(0, 0, W, H)
    if (bg.grad) { const g = ctx.createLinearGradient(0, 0, W, H); bg.grad.forEach((c, i) => g.addColorStop(i / (bg.grad.length - 1), c)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H) }
    else if (bg.css) { ctx.fillStyle = bg.css; ctx.fillRect(0, 0, W, H) }
    const k = scaleOf(W, H)
    rects.forEach((r, i) => {
      const p = photos[i]
      if (!p) return
      ctx.save()
      ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(s.radius * k, r.w / 2, r.h / 2)); ctx.clip()
      ctx.imageSmoothingQuality = 'high'
      const [src, sw, sh] = useSmall ? [p.small, p.small.width, p.small.height] : [p.img, p.w, p.h]
      drawCover(ctx, src, sw, sh, r.x, r.y, r.w, r.h, { zoom: p.zoom, fx: p.fx, fy: p.fy })
      ctx.restore()
    })
  }

  // ---- render ----
  function render() {
    const [W, H] = previewSize()
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H }
    const rects = rectsFor(W, H)
    paint(cv.getContext('2d'), W, H, rects, { useSmall: true })
    // overlay cells
    clear(ov, rects.map((r, i) => {
      const el = h('div', { class: ['cell', i === s.sel && 'sel'], role: 'button', tabindex: 0, 'aria-label': `Photo ${i + 1}: ${photos[i].name}. Drag to swap, press Enter to select`, 'aria-pressed': String(i === s.sel),
        style: { left: `${(r.x / W) * 100}%`, top: `${(r.y / H) * 100}%`, width: `${(r.w / W) * 100}%`, height: `${(r.h / H) * 100}%` }, dataset: { i },
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(i) } else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeAt(i) } } },
      h('span', { class: 'no' }, i + 1))
      return el
    }))
  }

  function update() {
    if (!photos.length) return
    s.sel = clamp(s.sel, 0, photos.length - 1)
    kindSeg.set(s.kind); ratioChips.set(RATIOS.find((r) => Math.abs(r[1] - s.ratio) < 1e-6)?.[0] || null); edgeSeg.set(s.edge)
    clear(kindOpts, s.kind === 'grid' ? colsF : s.kind === 'strips' ? field('Direction', dirSeg) : s.kind === 'mosaic' ? h('div', { class: 'row' }, shuffleBtn) : null)
    drawBgs()
    render()
    renderStrip()
    renderCell()
    const [W, H] = outSize()
    clear(caption, h('span', `${photos.length} photo${photos.length === 1 ? '' : 's'}`), h('span', 'Exports at ', h('b', `${W} x ${H} px`)), h('span', 'Drag a photo onto another to swap'))
  }

  function outSize() {
    const long = +s.edge
    let W = s.ratio >= 1 ? long : Math.round(long * s.ratio), H = s.ratio >= 1 ? Math.round(long / s.ratio) : long
    const c = capSize(W, H)
    return [c.w, c.h]
  }

  function renderStrip() {
    clear(strip, photos.map((p, i) => {
      const t = newCanvas(p.small.width, p.small.height); t.getContext('2d').drawImage(p.small, 0, 0)
      return h('button', { type: 'button', style: { '--i': Math.min(i, 14) }, 'aria-pressed': String(i === s.sel), 'aria-label': `Select photo ${i + 1}, ${p.name}`, onclick: () => select(i) }, t, h('span', i + 1))
    }), addMore)
  }

  function renderCell() {
    const p = photos[s.sel]
    if (!p) return clear(cellPanel)
    const zoom = rangeField('Zoom', { min: 100, max: 300, value: Math.round(p.zoom * 100), format: (v) => `${v}%`, onInput: (v) => { p.zoom = v / 100; render() } })
    const px = rangeField('Move left / right', { min: 0, max: 100, value: Math.round(p.fx * 100), format: (v) => `${v}%`, onInput: (v) => { p.fx = v / 100; render() } })
    const py = rangeField('Move up / down', { min: 0, max: 100, value: Math.round(p.fy * 100), format: (v) => `${v}%`, onInput: (v) => { p.fy = v / 100; render() } })
    const swaps = photos.length > 1 ? field('Swap with photo', h('div', { class: 'swapchips' }, photos.map((_, j) => j === s.sel ? null : h('button', { type: 'button', class: 'is-chip', 'aria-label': `Swap with photo ${j + 1}`, onclick: () => swap(s.sel, j) }, j + 1)))) : null
    clear(cellPanel, h('div', { class: 'stack' }, h('div', { class: 'row between' }, h('strong', `Photo ${s.sel + 1}`), h('span', { class: 'small muted' }, p.name)), zoom, px, py, swaps,
      h('div', { class: 'row' }, button('Remove photo', { icon: 'x', variant: 'danger', size: 'sm', onClick: () => removeAt(s.sel) }), button('Reset crop', { icon: 'rotate-ccw', variant: 'ghost', size: 'sm', onClick: () => { p.zoom = 1; p.fx = p.fy = 0.5; renderCell(); render() } }))))
  }

  function select(i) { s.sel = i; renderStrip(); renderCell(); ov.querySelectorAll('.cell').forEach((c, k) => { c.classList.toggle('sel', k === i); c.setAttribute('aria-pressed', String(k === i)) }) }
  function swap(a, b) { [photos[a], photos[b]] = [photos[b], photos[a]]; s.sel = b; update() }
  function removeAt(i) { photos.splice(i, 1); s.sel = Math.max(0, Math.min(s.sel, photos.length - 1)); refreshWork() }
  function refreshWork() {
    work.hidden = !photos.length
    drop.hidden = !!photos.length
    if (photos.length) update()
  }

  // ---- drag between cells ----
  let dragging = null
  ov.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.cell')
    if (!cell || e.button > 0) return
    dragging = { from: +cell.dataset.i, x: e.clientX, y: e.clientY, active: false, ghost: null, over: -1, pid: e.pointerId }
    ov.setPointerCapture(e.pointerId)
  })
  ov.addEventListener('pointermove', (e) => {
    if (!dragging) return
    if (!dragging.active && Math.hypot(e.clientX - dragging.x, e.clientY - dragging.y) > 8) {
      dragging.active = true
      const p = photos[dragging.from]
      const t = newCanvas(p.small.width, p.small.height); t.getContext('2d').drawImage(p.small, 0, 0)
      dragging.ghost = h('div', { class: 'col-ghost' }, t)
      document.body.append(dragging.ghost)
      ov.children[dragging.from]?.classList.add('drag')
      ov.style.cursor = 'grabbing'
    }
    if (!dragging.active) return
    dragging.ghost.style.left = `${e.clientX}px`; dragging.ghost.style.top = `${e.clientY}px`
    const r = ov.getBoundingClientRect()
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height
    const [W, H] = [cv.width, cv.height]
    const rects = rectsFor(W, H)
    let over = rects.findIndex((q) => fx * W >= q.x && fx * W <= q.x + q.w && fy * H >= q.y && fy * H <= q.y + q.h)
    if (over === dragging.from) over = -1
    if (over !== dragging.over) { ov.children[dragging.over]?.classList.remove('over'); ov.children[over]?.classList.add('over'); dragging.over = over }
  })
  const endDrag = (e, cancel) => {
    if (!dragging) return
    const d = dragging
    dragging = null
    d.ghost?.remove()
    ov.style.cursor = ''
    if (d.active) {
      if (!cancel && d.over >= 0) swap(d.from, d.over)
      else { ov.children[d.from]?.classList.remove('drag'); ov.children[d.over]?.classList.remove('over') }
    } else if (!cancel) select(d.from)
  }
  ov.addEventListener('pointerup', (e) => endDrag(e, false))
  ov.addEventListener('pointercancel', (e) => endDrag(e, true))
  onCleanup(() => dragging?.ghost?.remove())

  // ---- export ----
  dlBtn.addEventListener('click', () => busy(dlBtn, async () => {
    clear(result)
    const [W, H] = outSize()
    const c = newCanvas(W, H)
    paint(c.getContext('2d'), W, H, rectsFor(W, H), { useSmall: false })
    const bg = s.bg === 'custom' ? s.custom : BGS.find((b) => b.id === s.bg)?.css || '#ffffff'
    const blob = await encode(c, fmt.type, fmt.quality, bg)
    download(blob, `collage-${photos.length}-photos.${fmt.ext}`)
    clear(result, done('Collage saved', `${W} x ${H} px, ${formatBytes(blob.size)}`, button('Download again', { icon: 'download', size: 'sm', onClick: () => download(blob, `collage-${photos.length}-photos.${fmt.ext}`) })))
  }, { label: 'Rendering', errorTo: result }))

  async function addFiles(files) {
    const room = 20 - photos.length
    if (room <= 0) return toast('A collage can hold up to 20 photos.', 'error')
    const take = files.slice(0, room)
    if (take.length < files.length) toast(`Only the first ${take.length} photos were added (limit 20).`)
    const loaded = await readImages(take, { signal })
    for (const l of loaded) {
      if (l.w * l.h > MAX_PIXELS * 2) { toast(`${l.name} is very large and was skipped.`, 'error'); continue }
      photos.push({ id: ++idc, name: l.name, img: l.img, w: l.w, h: l.h, small: scaled(l.img, 900), zoom: 1, fx: 0.5, fy: 0.5 })
    }
    if (photos.length === 1 && loaded.length) toast('Add at least one more photo to make a collage.')
    refreshWork()
  }

  work.append(split(h('div', { class: 'stack' }, stage(wrap, caption), strip), h('div', { class: 'stack' }, controls, panel(h('div', { class: 'panel-title' }, h('span', 'Selected photo'), h('div', { class: 'row' }, randomBtn, clearBtn)), cellPanel)), 'wide-left'))
  root.append(h('div', { class: 't-col stack' }, drop, work))
}
