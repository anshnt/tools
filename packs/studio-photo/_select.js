// Selection masks: a selection is { mask: Uint8Array(w*h) (0..255 coverage), x, y, w, h (bounding box) } and is treated as immutable.
import { cv, rctx, clamp } from './_util.js'

/** Wrap a mask as a selection, computing its bounding box. Returns null when nothing is selected. */
export function makeSel(mask, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let first = -1, last = -1
    for (let x = 0; x < w; x++) if (mask[row + x]) { first = x; break }
    if (first < 0) continue
    for (let x = w - 1; x >= first; x--) if (mask[row + x]) { last = x; break }
    if (first < x0) x0 = first
    if (last > x1) x1 = last
    if (y < y0) y0 = y
    y1 = y
  }
  return x1 < 0 ? null : { mask, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, _c: null }
}

/** Alpha canvas (doc size) for a selection, cached on the selection object. */
export function selCanvas(sel, w, h) {
  if (sel._c) return sel._c
  const c = cv(w, h), ctx = rctx(c)
  const img = ctx.createImageData(sel.w, sel.h), d = img.data
  for (let y = 0; y < sel.h; y++) {
    let si = (sel.y + y) * w + sel.x, di = y * sel.w * 4
    for (let x = 0; x < sel.w; x++, si++, di += 4) d[di + 3] = sel.mask[si]
  }
  ctx.putImageData(img, sel.x, sel.y)
  sel._c = c
  return c
}

/** Rasterize a path into a mask. draw(ctx) fills in doc coordinates; bounds limits the work area. */
export function pathMask(w, h, draw, bounds) {
  const b = bounds ? { x: clamp(Math.floor(bounds.x), 0, w), y: clamp(Math.floor(bounds.y), 0, h), x1: clamp(Math.ceil(bounds.x + bounds.w), 0, w), y1: clamp(Math.ceil(bounds.y + bounds.h), 0, h) } : { x: 0, y: 0, x1: w, y1: h }
  const bw = b.x1 - b.x, bh = b.y1 - b.y
  const mask = new Uint8Array(w * h)
  if (bw <= 0 || bh <= 0) return mask
  const c = cv(bw, bh), ctx = rctx(c)
  ctx.translate(-b.x, -b.y)
  ctx.fillStyle = '#000'
  draw(ctx)
  const d = ctx.getImageData(0, 0, bw, bh).data
  for (let y = 0; y < bh; y++) {
    let mi = (b.y + y) * w + b.x, di = y * bw * 4 + 3
    for (let x = 0; x < bw; x++, mi++, di += 4) mask[mi] = d[di]
  }
  return mask
}

export const rectMask = (w, h, r) => pathMask(w, h, (ctx) => ctx.fillRect(r.x, r.y, r.w, r.h), { x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 })
export const ellipseMask = (w, h, r) => pathMask(w, h, (ctx) => { ctx.beginPath(); ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.max(0.01, r.w / 2), Math.max(0.01, r.h / 2), 0, 0, Math.PI * 2); ctx.fill() }, { x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 })
export function polyMask(w, h, pts) {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
  const x0 = Math.min(...xs), y0 = Math.min(...ys)
  return pathMask(w, h, (ctx) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill() },
    { x: x0 - 1, y: y0 - 1, w: Math.max(...xs) - x0 + 2, h: Math.max(...ys) - y0 + 2 })
}
export const fullMask = (w, h) => new Uint8Array(w * h).fill(255)

/** mode: 'new' | 'add' | 'sub' | 'int'. base may be null. Returns a new mask. */
export function combineMask(base, add, w, h, mode) {
  if (!base || mode === 'new') return add
  const out = new Uint8Array(w * h)
  if (mode === 'add') for (let i = 0; i < out.length; i++) out[i] = Math.max(base[i], add[i])
  else if (mode === 'sub') for (let i = 0; i < out.length; i++) out[i] = Math.max(0, base[i] - add[i])
  else for (let i = 0; i < out.length; i++) out[i] = Math.min(base[i], add[i])
  return out
}

export function invertMask(mask) {
  const out = new Uint8Array(mask.length)
  for (let i = 0; i < out.length; i++) out[i] = 255 - mask[i]
  return out
}

// ---------- blur (shared by feather and the blur filters) ----------
function boxesForGauss(sigma, n = 3) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1)
  let wl = Math.floor(wIdeal)
  if (wl % 2 === 0) wl--
  const wu = wl + 2
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4))
  return Array.from({ length: n }, (_, i) => ((i < m ? wl : wu) - 1) / 2)
}

/** One box-blur pass along rows (horizontal) or columns, on one channel of an interleaved array. Edges repeat the border pixel. */
function boxPass(src, dst, w, h, r, ch, c, horizontal) {
  const n = horizontal ? w : h, lines = horizontal ? h : w
  const step = horizontal ? ch : w * ch
  const inv = 1 / (2 * r + 1)
  for (let l = 0; l < lines; l++) {
    const start = (horizontal ? l * w * ch : l * ch) + c
    let acc = (r + 1) * src[start]
    for (let j = 1; j <= r; j++) acc += src[start + Math.min(j, n - 1) * step]
    for (let i = 0; i < n; i++) {
      dst[start + i * step] = Math.round(acc * inv)
      acc += src[start + Math.min(i + r + 1, n - 1) * step] - src[start + Math.max(i - r, 0) * step]
    }
  }
}

/** Gaussian-like blur (3 box passes) over all `ch` channels of an interleaved Uint8 array. Returns the blurred array (new). */
export function blurArray(src, w, h, sigma, ch = 1, onlyChannels) {
  if (sigma <= 0.3) return src.slice()
  const boxes = boxesForGauss(sigma)
  let a = src.slice()
  const b = src.slice()
  const chans = onlyChannels || Array.from({ length: ch }, (_, i) => i)
  for (const r of boxes) {
    const rr = Math.max(0, Math.round(r))
    if (!rr) continue
    for (const c of chans) {
      boxPass(a, b, w, h, rr, ch, c, true)
      boxPass(b, a, w, h, rr, ch, c, false)
    }
  }
  return a
}

export function featherMask(mask, w, h, radius) {
  return radius <= 0 ? mask : blurArray(mask, w, h, radius / 2)
}

/** Grow (positive) or shrink (negative) a selection by n pixels using a square window. */
export function growMask(mask, w, h, n) {
  const r = Math.abs(Math.round(n))
  if (!r) return mask
  const grow = n > 0
  const bin = new Uint8Array(mask.length) // shrink = grow the unselected area, so work on the inverse
  for (let i = 0; i < bin.length; i++) bin[i] = (mask[i] >= 128) === grow ? 1 : 0
  const tmp = new Int32Array(mask.length), out = new Uint8Array(mask.length)
  for (let y = 0; y < h; y++) { // horizontal window sums
    let acc = 0
    const row = y * w
    for (let x = 0; x <= r && x < w; x++) acc += bin[row + x]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc
      if (x - r >= 0) acc -= bin[row + x - r]
      if (x + r + 1 < w) acc += bin[row + x + r + 1]
    }
  }
  for (let x = 0; x < w; x++) { // vertical
    let acc = 0
    for (let y = 0; y <= r && y < h; y++) acc += tmp[y * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = (acc > 0) === grow ? 255 : 0
      if (y - r >= 0) acc -= tmp[(y - r) * w + x]
      if (y + r + 1 < h) acc += tmp[(y + r + 1) * w + x]
    }
  }
  return out
}

/**
 * Flood-select from (sx, sy) on RGBA pixel data of size w x h. tol 0..255 (max channel distance incl. alpha).
 * contiguous: connected region only; otherwise every similar pixel. Returns a mask.
 */
export function floodMask(data, w, h, sx, sy, tol, contiguous = true) {
  const mask = new Uint8Array(w * h)
  sx = clamp(Math.floor(sx), 0, w - 1); sy = clamp(Math.floor(sy), 0, h - 1)
  const si = (sy * w + sx) * 4
  const tr = data[si], tg = data[si + 1], tb = data[si + 2], ta = data[si + 3]
  const near = (i) => {
    const o = i * 4
    return Math.abs(data[o] - tr) <= tol && Math.abs(data[o + 1] - tg) <= tol && Math.abs(data[o + 2] - tb) <= tol && Math.abs(data[o + 3] - ta) <= tol
  }
  if (!contiguous) {
    for (let i = 0; i < mask.length; i++) if (near(i)) mask[i] = 255
    return mask
  }
  const stack = [sx, sy]
  while (stack.length) {
    const y = stack.pop(), x0 = stack.pop()
    let x = x0
    const row = y * w
    while (x >= 0 && !mask[row + x] && near(row + x)) x--
    x++
    let up = false, down = false
    while (x < w && !mask[row + x] && near(row + x)) {
      mask[row + x] = 255
      if (y > 0) {
        const n = (y - 1) * w + x
        if (!mask[n] && near(n)) { if (!up) { stack.push(x, y - 1); up = true } } else up = false
      }
      if (y < h - 1) {
        const n = (y + 1) * w + x
        if (!mask[n] && near(n)) { if (!down) { stack.push(x, y + 1); down = true } } else down = false
      }
      x++
    }
  }
  return mask
}

/** Light smoothing of a hard-edged mask so wand and fill edges are not jagged. */
export const softenMask = (mask, w, h) => blurArray(mask, w, h, 0.6)
