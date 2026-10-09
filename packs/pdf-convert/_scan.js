// Document-scan filters for photos of paper: shadow and colour-cast removal (background flattening), grayscale, and black and white.
// Pure canvas work, no libraries. Used by Photo to PDF.

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v)

/** Max filter then box blur on one channel of a small image: a smooth map of the "paper colour" under the text. */
function paperMap(chan, w, h, r) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h)
  // dilate (local max) horizontally then vertically
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.max(m, chan[y * w + k])
      tmp[y * w + x] = m
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 0
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.max(m, tmp[k * w + x])
      out[y * w + x] = m
    }
  }
  return out
}

/** Blur a channel with a few box passes (cheap gaussian). */
function boxBlur(chan, w, h, r, passes = 2) {
  let a = Float32Array.from(chan), b = new Float32Array(w * h)
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      let sum = 0, n = 0
      for (let x = -r; x < w; x++) {
        const add = x + r, rem = x - r - 1
        if (add < w) { sum += a[y * w + add]; n++ }
        if (rem >= 0) { sum -= a[y * w + rem]; n-- }
        if (x >= 0) b[y * w + x] = sum / n
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0, n = 0
      for (let y = -r; y < h; y++) {
        const add = y + r, rem = y - r - 1
        if (add < h) { sum += b[add * w + x]; n++ }
        if (rem >= 0) { sum -= b[rem * w + x]; n-- }
        if (y >= 0) a[y * w + x] = sum / n
      }
    }
  }
  return a
}

/**
 * Apply a scan filter. mode: 'none' | 'enhance' | 'gray' | 'bw'. Returns a NEW canvas (the input is untouched).
 * opts: {contrast: -1..1 (default 0.3), brightness: -1..1 (default 0), threshold: 80..220 (bw, default 150)}
 */
export function scanFilter(src, mode, { contrast = 0.3, brightness = 0, threshold = 150 } = {}) {
  const W = src.width, H = src.height
  const out = document.createElement('canvas')
  out.width = W; out.height = H
  const ctx = out.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(src, 0, 0)
  if (mode === 'none') return out
  const img = ctx.getImageData(0, 0, W, H)
  const px = img.data

  // 1. paper colour map on a small copy, upscaled with smoothing
  const k = Math.min(1, 220 / Math.max(W, H))
  const sw = Math.max(2, Math.round(W * k)), sh = Math.max(2, Math.round(H * k))
  const small = document.createElement('canvas')
  small.width = sw; small.height = sh
  const sctx = small.getContext('2d', { willReadFrequently: true })
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(src, 0, 0, sw, sh)
  const sd = sctx.getImageData(0, 0, sw, sh).data
  const r = Math.max(2, Math.round(Math.max(sw, sh) * 0.045))
  const chans = [0, 1, 2].map((c) => {
    const ch = new Uint8Array(sw * sh)
    for (let i = 0; i < sw * sh; i++) ch[i] = sd[i * 4 + c]
    return boxBlur(paperMap(ch, sw, sh, r), sw, sh, Math.max(1, Math.round(r / 2)))
  })
  const bgSmall = sctx.createImageData(sw, sh)
  for (let i = 0; i < sw * sh; i++) { bgSmall.data[i * 4] = chans[0][i]; bgSmall.data[i * 4 + 1] = chans[1][i]; bgSmall.data[i * 4 + 2] = chans[2][i]; bgSmall.data[i * 4 + 3] = 255 }
  sctx.putImageData(bgSmall, 0, 0)
  const big = document.createElement('canvas')
  big.width = W; big.height = H
  const bctx = big.getContext('2d', { willReadFrequently: true })
  bctx.imageSmoothingEnabled = true
  bctx.imageSmoothingQuality = 'high'
  bctx.drawImage(small, 0, 0, W, H)
  const bg = bctx.getImageData(0, 0, W, H).data

  // 2. divide by the paper colour (removes shadow gradients and the colour cast), then a levels curve
  const lo = 14 + brightness * -30 + (contrast > 0 ? contrast * 26 : 0)
  const hi = 236 + brightness * 20 - (contrast > 0 ? contrast * 10 : 0)
  const span = Math.max(40, hi - lo)
  const gray = mode === 'gray' || mode === 'bw'
  const thr = threshold + brightness * -40
  for (let i = 0; i < px.length; i += 4) {
    let rr = (px[i] * 255) / Math.max(40, bg[i]), gg = (px[i + 1] * 255) / Math.max(40, bg[i + 1]), bb = (px[i + 2] * 255) / Math.max(40, bg[i + 2])
    if (gray) { rr = gg = bb = 0.299 * rr + 0.587 * gg + 0.114 * bb }
    if (mode === 'bw') {
      const v = rr
      const t = (v - (thr - 22)) / 44
      const o = t <= 0 ? 0 : t >= 1 ? 255 : 255 * t * t * (3 - 2 * t)
      px[i] = px[i + 1] = px[i + 2] = o
      continue
    }
    for (let c = 0; c < 3; c++) {
      let v = c === 0 ? rr : c === 1 ? gg : bb
      let t = (v - lo) / span
      t = t < 0 ? 0 : t > 1 ? 1 : t
      if (contrast !== 0) { const s = t * t * (3 - 2 * t); t = t + (s - t) * Math.min(1, Math.abs(contrast)) * (contrast > 0 ? 1 : -0.5) }
      px[i + c] = clamp(t * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  big.width = big.height = small.width = small.height = 0
  return out
}

/**
 * Find the sheet of paper in a photo (a big bright block on a darker desk). Returns {x, y, w, h} in src pixels, or null when the
 * whole frame already looks like the page. Rectangle only: it does not straighten tilted pages.
 */
export function documentBounds(src) {
  const W = src.width, H = src.height
  const k = Math.min(1, 160 / Math.max(W, H))
  const w = Math.max(8, Math.round(W * k)), h = Math.max(8, Math.round(H * k))
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d', { willReadFrequently: true })
  g.imageSmoothingQuality = 'high'
  g.drawImage(src, 0, 0, w, h)
  const d = g.getImageData(0, 0, w, h).data
  const lum = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
  const blur = boxBlur(lum, w, h, 1, 2)
  // Otsu threshold
  const hist = new Float64Array(256)
  for (const v of blur) hist[Math.min(255, Math.max(0, Math.round(v)))]++
  let sumAll = 0
  for (let i = 0; i < 256; i++) sumAll += i * hist[i]
  let wB = 0, sumB = 0, best = 0, thr = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = w * h - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB, mF = (sumAll - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) { best = between; thr = t }
  }
  const rows = new Float32Array(h), cols = new Float32Array(w)
  let on = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (blur[y * w + x] > thr) { rows[y]++; cols[x]++; on++ }
  const rmax = Math.max(...rows), cmax = Math.max(...cols)
  if (!rmax || !cmax) return null
  const first = (arr, t) => arr.findIndex((v) => v >= t)
  const last = (arr, t) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] >= t) return i; return -1 }
  const y0 = first(rows, rmax * 0.4), y1 = last(rows, rmax * 0.4), x0 = first(cols, cmax * 0.4), x1 = last(cols, cmax * 0.4)
  if (y0 < 0 || x0 < 0 || y1 <= y0 || x1 <= x0) return null
  const area = ((x1 - x0 + 1) * (y1 - y0 + 1)) / (w * h)
  if (area < 0.22 || area > 0.94 || on / ((x1 - x0 + 1) * (y1 - y0 + 1)) < 0.55) return null
  const inset = 0.012
  const rx = Math.max(0, (x0 / w) + inset), ry = Math.max(0, (y0 / h) + inset)
  const rw = Math.min(1, ((x1 + 1) / w) - inset) - rx, rh = Math.min(1, ((y1 + 1) / h) - inset) - ry
  return { x: Math.round(rx * W), y: Math.round(ry * H), w: Math.round(rw * W), h: Math.round(rh * H) }
}

/** Crop a canvas to a rectangle (returns a new canvas). */
export function cropCanvas(src, r) {
  const c = document.createElement('canvas')
  c.width = r.w; c.height = r.h
  c.getContext('2d').drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
  return c
}
