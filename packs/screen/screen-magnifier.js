// Screen magnifier: capture the screen (or open an image) and inspect it with a pixel-perfect zoom lens.
import { h, icon, button, toast, copyText, toggle, segmented, rangeField, clear, download } from '../../lib/ui.js'
import { toBlob } from '../../lib/image.js'
import { baseCss, injectCss, sourceHero, sourceActions, pointerToImage, pixelAt, rgbToHex, fmt, listen, isTyping, clamp } from './_shared.js'

export const ZOOMS = [2, 3, 4, 6, 8, 12, 16, 24, 32]
const FILTERS = { normal: 'none', invert: 'invert(1)', gray: 'grayscale(1) contrast(1.15)', boost: 'contrast(1.9) saturate(1.3)' }

/**
 * Draw the area around pixel (x, y) of `src` into `dst`, magnified `zoom` times with crisp square pixels.
 * The centre cell is exactly pixel (x, y). Returns {cells, cell, rgb}.
 */
export function renderLens(dst, src, x, y, zoom, sizeCss, { grid = true, dpr = window.devicePixelRatio || 1 } = {}) {
  const cell = Math.max(1, Math.round(zoom * dpr))
  let n = Math.max(3, Math.floor((sizeCss * dpr) / cell))
  if (n % 2 === 0) n--
  const side = n * cell
  if (dst.width !== side) { dst.width = side; dst.height = side }
  dst.style.width = dst.style.height = `${side / dpr}px`
  const ctx = dst.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#7774'
  ctx.fillRect(0, 0, side, side)
  const half = (n - 1) / 2
  const sx = x - half, sy = y - half
  const ix0 = Math.max(0, sx), iy0 = Math.max(0, sy), ix1 = Math.min(src.width, sx + n), iy1 = Math.min(src.height, sy + n)
  if (ix1 > ix0 && iy1 > iy0) ctx.drawImage(src, ix0, iy0, ix1 - ix0, iy1 - iy0, (ix0 - sx) * cell, (iy0 - sy) * cell, (ix1 - ix0) * cell, (iy1 - iy0) * cell)
  if (grid && cell >= 8) {
    ctx.strokeStyle = 'rgba(0,0,0,.3)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 1; i < n; i++) { ctx.moveTo(i * cell + 0.5, 0); ctx.lineTo(i * cell + 0.5, side); ctx.moveTo(0, i * cell + 0.5); ctx.lineTo(side, i * cell + 0.5) }
    ctx.stroke()
  }
  const m = half * cell
  ctx.lineWidth = Math.max(2, dpr * 1.5); ctx.strokeStyle = '#000'; ctx.strokeRect(m + 1, m + 1, cell - 2, cell - 2)
  ctx.lineWidth = Math.max(1, dpr * 0.8); ctx.strokeStyle = '#fff'; ctx.strokeRect(m + 1, m + 1, cell - 2, cell - 2)
  return { cells: n, cell, rgb: pixelAt(src, x, y) }
}

const CSS = `
.t-mg .bar{display:flex;flex-wrap:wrap;gap:12px 18px;align-items:center}
.t-mg .bar .grow{flex:1}
.t-mg .opts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:14px 22px;align-items:end;padding:14px 16px;border-radius:20px}
.t-mg .main{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;align-items:start}
.t-mg .main.side{grid-template-columns:minmax(0,1fr) auto}
.t-mg .stage{position:relative;line-height:0;border-radius:var(--radius-xl);border:1px solid var(--border);overflow:hidden;background:var(--checker);box-shadow:var(--shadow)}
.t-mg .stage canvas.src{display:block;width:100%;height:auto;cursor:crosshair;touch-action:none;outline-offset:-3px}
.t-mg .lens{position:absolute;z-index:2;display:none;pointer-events:none;padding:5px;background:#fff;box-shadow:0 22px 44px -12px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.18)}
.t-mg .lens canvas,.t-mg .pane canvas{display:block}
.t-mg .lens.round,.t-mg .lens.round canvas{border-radius:50%}
.t-mg .lens:not(.round),.t-mg .lens:not(.round) canvas{border-radius:14px}
.t-mg .lens.pinned{box-shadow:0 22px 44px -12px rgba(0,0,0,.55),0 0 0 3px var(--accent)}
.t-mg .pane{display:none;position:sticky;top:calc(var(--header-h) + 12px);padding:12px;border-radius:24px;max-width:100%}
.t-mg .main.side .pane{display:block}
.t-mg .pane canvas{border-radius:14px;max-width:100%;height:auto!important;aspect-ratio:1}
.t-mg .pane{width:min(100%,392px)}
.t-mg .readout{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:10px;font-family:var(--mono);font-size:12.5px;color:var(--text-2);line-height:1.4}
.t-mg .readout i{display:inline-block;width:14px;height:14px;border-radius:4px;vertical-align:-2px;margin-right:6px;box-shadow:0 0 0 1px var(--border-strong)}
.t-mg .hint{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:13px}
.t-mg .hint .icon{width:15px;height:15px;color:var(--accent);flex:none}
@media (max-width:860px){.t-mg .main.side{grid-template-columns:minmax(0,1fr)}.t-mg .main.side .pane{order:-1;position:static;justify-self:center}}
`

export function mount(root) {
  baseCss()
  injectCss('mg', CSS)
  let src = null, zoomIdx = 4, size = 200, round = true, grid = true, filter = 'normal', mode = 'float'
  let pos = null, pinned = false, ptype = 'mouse'

  const cv = h('canvas', { class: 'src', tabindex: 0, role: 'img', 'aria-label': 'Picture to magnify. Move the pointer, or use the arrow keys. Press Enter to pin the lens.' })
  const lensCv = h('canvas'), paneCv = h('canvas')
  const lens = h('div', { class: 'lens round' }, lensCv)
  const stage = h('div', { class: 'stage' }, cv, lens)
  const readout = h('div', { class: 'readout' })
  const paneInfo = h('div', { class: 'readout' })
  const pane = h('div', { class: 'pane sc-glass' }, paneCv, paneInfo)
  const main = h('div', { class: 'main' }, h('div', { class: 'stack' }, stage, readout), pane)
  const editor = h('div', { class: 'stack', hidden: true })
  const heroHost = h('div')
  const dims = h('span', { class: 'small muted sc-mono' })
  const hint = h('div', { class: 'hint' }, icon('info'), h('span'))
  const zoom = () => ZOOMS[zoomIdx]
  const HINT = {
    float: 'Move over the picture to magnify. Click to pin the lens, then use the arrow keys to nudge it one pixel. Ctrl + scroll changes the zoom.',
    side: 'Move over the picture and watch the large view next to it. Click to pin it, arrow keys nudge one pixel.',
  }

  const applyFilter = () => { lensCv.style.filter = paneCv.style.filter = FILTERS[filter] }

  function update() {
    if (!src || !pos) return
    const x = clamp(pos.x, 0, src.width - 1), y = clamp(pos.y, 0, src.height - 1)
    const side = mode === 'side'
    const r = renderLens(side ? paneCv : lensCv, src, x, y, zoom(), side ? 360 : size, { grid })
    const hex = r.rgb ? rgbToHex(r.rgb) : ''
    const info = [h('span', h('i', { style: { background: hex } }), hex), h('span', `x ${x}  y ${y}`), h('span', fmt.rgb(r.rgb || [0, 0, 0])), h('span', { class: 'muted' }, `${zoom()}x · ${r.cells}×${r.cells} px`)]
    clear(side ? paneInfo : readout, info)
    ;(side ? readout : paneInfo).replaceChildren()
    lens.style.display = side ? 'none' : 'block'
    lens.classList.toggle('round', round)
    lens.classList.toggle('pinned', pinned)
    if (!side) place()
  }
  function place() {
    const r = cv.getBoundingClientRect(), sr = stage.getBoundingClientRect()
    const cx = ((pos.x + 0.5) / src.width) * r.width, cy = ((pos.y + 0.5) / src.height) * r.height
    const lw = lens.offsetWidth || size + 10, lh = lens.offsetHeight || size + 10
    const above = ptype !== 'mouse'
    let top = above ? cy - lh - 34 : cy + 24
    if (!above && top + lh > sr.height - 4) top = cy - lh - 24
    if (above && top < 4) top = cy + 34
    lens.style.left = `${clamp(cx - lw / 2, 4, Math.max(4, sr.width - lw - 4))}px`
    lens.style.top = `${clamp(top, 4, Math.max(4, sr.height - lh - 4))}px`
  }

  const at = (e) => { const p = pointerToImage(e, cv, src.width, src.height); return { x: p.x, y: p.y } }
  cv.addEventListener('pointermove', (e) => { ptype = e.pointerType; if (!src || pinned) return; pos = at(e); update() })
  cv.addEventListener('pointerdown', (e) => {
    ptype = e.pointerType
    if (e.pointerType !== 'mouse') { cv.setPointerCapture(e.pointerId); pinned = false; pos = at(e); update() }
  })
  cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !pinned && mode === 'float') lens.style.display = 'none' })
  cv.addEventListener('click', (e) => {
    if (!src || (e.pointerType && e.pointerType !== 'mouse')) return
    pinned = !pinned
    if (!pinned) pos = at(e)
    update()
    toast(pinned ? 'Lens pinned. Click again to release, or use the arrow keys to nudge it.' : 'Lens released', 'info', 1800)
  })
  cv.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
    if (d) {
      e.preventDefault()
      const s = e.shiftKey ? 10 : 1
      pos = { x: clamp((pos?.x ?? Math.floor(src.width / 2)) + d[0] * s, 0, src.width - 1), y: clamp((pos?.y ?? Math.floor(src.height / 2)) + d[1] * s, 0, src.height - 1) }
      update()
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pinned = !pinned
      pos ??= { x: Math.floor(src.width / 2), y: Math.floor(src.height / 2) }
      update()
    }
  })
  cv.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    setZoom(zoomIdx + (e.deltaY < 0 ? 1 : -1))
  }, { passive: false })

  function setZoom(i) {
    zoomIdx = clamp(i, 0, ZOOMS.length - 1)
    zoomRange.set(zoomIdx)
    update()
  }
  const zoomRange = rangeField('Zoom', { min: 0, max: ZOOMS.length - 1, step: 1, value: zoomIdx, format: (v) => `${ZOOMS[v]}x`, onInput: (v) => { zoomIdx = v; update() } })
  const sizeRange = rangeField('Lens size', { min: 100, max: 320, step: 10, value: size, format: (v) => `${v}px`, onInput: (v) => { size = v; update() } })
  const shapeSeg = segmented([['round', 'Round'], ['square', 'Square']], 'round', (v) => { round = v === 'round'; update() }, 'Lens shape')
  const filterSeg = segmented([['normal', 'Normal'], ['invert', 'Invert'], ['gray', 'Gray'], ['boost', 'Boost']], filter, (v) => { filter = v; applyFilter() }, 'Color filter')
  const modeSeg = segmented([['float', 'Floating lens'], ['side', 'Side view']], mode, (v) => {
    mode = v
    main.classList.toggle('side', v === 'side')
    hint.lastChild.textContent = HINT[v]
    update()
  }, 'View')
  const gridToggle = toggle('Pixel grid (at high zoom)', grid, (v) => { grid = v; update() })
  const saveBtn = button('Save zoomed view', { icon: 'download', size: 'sm', onClick: async () => {
    if (!pos) return toast('Move the lens over the picture first', 'error')
    const c = mode === 'side' ? paneCv : lensCv
    const out = document.createElement('canvas')
    out.width = c.width; out.height = c.height
    const x = out.getContext('2d')
    if (FILTERS[filter] !== 'none' && 'filter' in x) x.filter = FILTERS[filter]
    x.drawImage(c, 0, 0)
    download(await toBlob(out, 'image/png'), `magnified-${zoom()}x.png`)
  } })
  const copyBtn = button('Copy color', { icon: 'pipette', size: 'sm', onClick: () => { const px = pos && pixelAt(src, pos.x, pos.y); px ? copyText(rgbToHex(px)) : toast('Move the lens over the picture first', 'error') } })

  function load(c) {
    src = c
    cv.width = c.width; cv.height = c.height
    cv.getContext('2d').drawImage(c, 0, 0)
    pos = { x: Math.floor(c.width / 2), y: Math.floor(c.height / 2) }
    pinned = false
    dims.textContent = `${c.width} × ${c.height} px`
    heroHost.hidden = true
    editor.hidden = false
    requestAnimationFrame(() => update())
  }

  editor.append(
    h('div', { class: 'bar' }, modeSeg, h('div', { class: 'grow' }), sourceActions({ onCanvas: (c) => load(c) }), gridToggle, dims),
    h('div', { class: 'opts sc-glass' }, zoomRange, sizeRange,
      h('div', { class: 'stack tight' }, h('div', { class: 'field-label' }, 'Lens shape'), shapeSeg),
      h('div', { class: 'stack tight' }, h('div', { class: 'field-label' }, 'Color filter'), filterSeg)),
    hint, main,
    h('div', { class: 'row' }, saveBtn, copyBtn))
  heroHost.append(sourceHero({
    title: 'Look closer at anything on your screen',
    text: 'Capture a window or your whole screen, then move a zoom lens over it. Zoom up to 32x and see every pixel.',
    onCanvas: (c) => load(c), cta: 'Capture screen', art: 'zoom-in',
  }))
  hint.lastChild.textContent = HINT.float
  root.append(h('div', { class: 't-mg stack' }, heroHost, editor))
  applyFilter()
  listen(document, 'keydown', (e) => {
    if (!src || editor.hidden || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === '+' || e.key === '=') setZoom(zoomIdx + 1)
    else if (e.key === '-') setZoom(zoomIdx - 1)
    else if (e.key === 'Escape' && pinned) { pinned = false; update() }
  })
  listen(window, 'resize', () => update())
}
