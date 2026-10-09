// Imaging helpers for the government photo and signature tools: framing, white background, signature cleaning,
// exact-size JPEG encoding (quality search, minimum-size padding, DPI tag) and output inspection. Canvas only, nothing leaves the device.
import { canvas as newCanvas, toBlob, compressToTarget, canEncode } from '../../lib/image.js'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

// ---------- JPEG bytes ----------

/** Position just after the SOI and any leading APPn segments (JFIF, Exif), where a COM segment can safely go. */
function afterApp(b) {
  let i = 2
  while (i + 4 < b.length && b[i] === 0xff && b[i + 1] >= 0xe0 && b[i + 1] <= 0xef) i += 2 + ((b[i + 2] << 8) | b[i + 3])
  return i
}

/** Grow a JPEG to at least minBytes with harmless comment segments (many portals reject files below a minimum size). */
export function padJpeg(bytes, minBytes) {
  const need = minBytes - bytes.length
  if (need <= 0) return bytes
  const segs = []
  let left = need
  while (left > 0) {
    const total = Math.min(Math.max(left, 4), 65535 + 2) // marker (2) + length field (2) + payload
    const len = total - 2
    const seg = new Uint8Array(total).fill(0x20)
    seg[0] = 0xff; seg[1] = 0xfe; seg[2] = len >> 8; seg[3] = len & 255
    segs.push(seg)
    left -= total
  }
  const at = afterApp(bytes)
  const out = new Uint8Array(bytes.length + segs.reduce((n, s) => n + s.length, 0))
  out.set(bytes.subarray(0, at), 0)
  let o = at
  for (const s of segs) { out.set(s, o); o += s.length }
  out.set(bytes.subarray(at), o)
  return out
}

/** Write the pixel density (dots per inch) into the JFIF header, adding the header when the encoder did not write one. */
export function setJpegDpi(bytes, dpi) {
  const jfif = bytes[2] === 0xff && bytes[3] === 0xe0 && bytes[6] === 0x4a && bytes[7] === 0x46 && bytes[8] === 0x49 && bytes[9] === 0x46
  if (jfif) {
    const out = bytes.slice()
    out[13] = 1; out[14] = dpi >> 8; out[15] = dpi & 255; out[16] = dpi >> 8; out[17] = dpi & 255
    return out
  }
  const head = Uint8Array.from([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, dpi >> 8, dpi & 255, dpi >> 8, dpi & 255, 0, 0])
  const out = new Uint8Array(bytes.length + head.length)
  out.set(bytes.subarray(0, 2), 0); out.set(head, 2); out.set(bytes.subarray(2), 2 + head.length)
  return out
}

export function readJpegDpi(bytes) {
  if (bytes[2] === 0xff && bytes[3] === 0xe0 && bytes[6] === 0x4a && bytes[7] === 0x46) {
    const units = bytes[13], x = (bytes[14] << 8) | bytes[15]
    if (units === 1) return x
    if (units === 2) return Math.round(x * 2.54)
  }
  return null
}

// ---------- Framing ----------

/** Crop rectangle in source pixels for a target aspect (w/h). zoom 1 = the biggest box that fits; cx, cy are the box centre as fractions of the image. */
export function cropRect(iw, ih, aspect, zoom = 1, cx = 0.5, cy = 0.5) {
  let cw, ch
  if (iw / ih > aspect) { ch = ih; cw = ih * aspect } else { cw = iw; ch = iw / aspect }
  cw /= zoom; ch /= zoom
  return { x: clamp(cx * iw - cw / 2, 0, iw - cw), y: clamp(cy * ih - ch / 2, 0, ih - ch), w: cw, h: ch }
}

/** Draw a crop of the source onto a fresh w x h canvas filled with bg. */
export function drawCrop(src, rect, w, h, bg = '#ffffff') {
  const c = newCanvas(w, h)
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height)
  return c
}

/** Fit the whole source inside w x h on a bg-coloured canvas (no cropping), keeping the aspect ratio. */
export function drawContain(src, w, h, bg = '#ffffff', pad = 0) {
  const c = newCanvas(w, h)
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, c.width, c.height)
  const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height
  const s = Math.min((c.width - pad * 2) / sw, (c.height - pad * 2) / sh)
  const dw = sw * s, dh = sh * s
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh)
  return c
}

/** Best-effort face finder: the browser FaceDetector when present, otherwise the biggest skin-coloured blob near the top centre. -> {x, y, w, h, source} in source pixels, or null. */
export async function detectFace(img) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height
  if ('FaceDetector' in window) {
    try {
      const faces = await new window.FaceDetector({ fastMode: true, maxDetectedFaces: 3 }).detect(img)
      const f = faces.sort((a, b) => b.boundingBox.width * b.boundingBox.height - a.boundingBox.width * a.boundingBox.height)[0]
      if (f) return { x: f.boundingBox.x, y: f.boundingBox.y, w: f.boundingBox.width, h: f.boundingBox.height, source: 'detector' }
    } catch { /* fall through to the colour heuristic */ }
  }
  const s = Math.min(1, 180 / Math.max(iw, ih))
  const w = Math.max(8, Math.round(iw * s)), h = Math.max(8, Math.round(ih * s))
  const c = newCanvas(w, h)
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h).data
  const cell = 4, gw = Math.ceil(w / cell), gh = Math.ceil(h / cell)
  const score = new Float32Array(gw * gh)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r = d[i], g = d[i + 1], b = d[i + 2]
      const Y = 0.299 * r + 0.587 * g + 0.114 * b
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
      if (Y > 35 && cb > 77 && cb < 130 && cr > 133 && cr < 178 && r > b) score[Math.floor(y / cell) * gw + Math.floor(x / cell)] += 1 / (cell * cell)
    }
  }
  const on = (k) => score[k] > 0.45
  const seen = new Uint8Array(gw * gh)
  let best = null
  for (let k0 = 0; k0 < gw * gh; k0++) {
    if (seen[k0] || !on(k0)) continue
    const stack = [k0]
    seen[k0] = 1
    let n = 0, x0 = gw, x1 = 0, y0 = gh, y1 = 0
    while (stack.length) {
      const k = stack.pop()
      const x = k % gw, y = (k / gw) | 0
      n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue
        const nk = ny * gw + nx
        if (!seen[nk] && on(nk)) { seen[nk] = 1; stack.push(nk) }
      }
    }
    const cxn = (x0 + x1 + 1) / 2 / gw, cyn = (y0 + y1 + 1) / 2 / gh
    const weight = n * (1 - Math.min(0.8, Math.abs(cxn - 0.5))) * (1 - Math.min(0.7, Math.max(0, cyn - 0.35)))
    if (!best || weight > best.weight) best = { weight, n, x0, x1, y0, y1 }
  }
  if (!best || best.n * cell * cell < w * h * 0.012) return null
  const bw = (best.x1 - best.x0 + 1) * cell, bh = (best.y1 - best.y0 + 1) * cell
  const fh = Math.min(bh, bw * 1.35) // a skin blob often includes the neck: a face is about 1.3 times as tall as wide
  return { x: (best.x0 * cell) / s, y: (best.y0 * cell) / s, w: bw / s, h: fh / s, source: 'colour' }
}

/** Framing (zoom, cx, cy) that puts the face at `frac` of the crop height with the face centre a little above the middle. */
export function frameForFace(face, iw, ih, aspect, frac = 0.6) {
  const base = iw / ih > aspect ? ih : iw / aspect
  const ch = Math.min(base, Math.max(face.h / frac, base / 6))
  return { zoom: clamp(base / ch, 1, 6), cx: (face.x + face.w / 2) / iw, cy: (face.y + face.h / 2 + 0.06 * ch) / ih }
}

// ---------- Background ----------

/**
 * Find the plain wall behind a person. The wall colour is modelled as a gentle gradient fitted to the top and side edges of the whole picture
 * (lighting falloff is fine); pixels close to that model and connected to the border are background. tol is a colour distance (0-100).
 * Works on a small copy for speed. -> {canvas, fraction} where canvas is white with alpha 255 on background pixels, or null when no plain wall was found.
 */
export function backgroundMask(src, tol = 28) {
  const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height
  const k = Math.min(1, 640 / Math.max(sw, sh))
  const w = Math.max(8, Math.round(sw * k)), h = Math.max(8, Math.round(sh * k))
  const c = newCanvas(w, h)
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(src, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h).data
  // sample the top band and the upper two thirds of the side edges, where the wall is visible (shoulders fill the bottom corners)
  const t = Math.max(3, Math.round(Math.min(w, h) * 0.03))
  let samples = []
  for (let y = 0; y < h * 0.66; y++) for (let x = 0; x < w; x++) if (y < t || x < t || x >= w - t) samples.push([x / w, y / h, (y * w + x) * 4])
  const fit = (pts, ch) => {
    // least squares plane v = a + b*x + c*y
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0, sv = 0, sxv = 0, syv = 0
    for (const [x, y, i] of pts) { const v = d[i + ch]; n++; sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y; sv += v; sxv += x * v; syv += y * v }
    const m = [[n, sx, sy, sv], [sx, sxx, sxy, sxv], [sy, sxy, syy, syv]]
    for (let i = 0; i < 3; i++) {
      let p = i
      for (let r = i + 1; r < 3; r++) if (Math.abs(m[r][i]) > Math.abs(m[p][i])) p = r
      const tmp = m[i]; m[i] = m[p]; m[p] = tmp
      if (Math.abs(m[i][i]) < 1e-9) return [sv / n, 0, 0]
      for (let r = i + 1; r < 3; r++) { const f = m[r][i] / m[i][i]; for (let q = i; q < 4; q++) m[r][q] -= f * m[i][q] }
    }
    const cc = m[2][3] / m[2][2], bb = (m[1][3] - m[1][2] * cc) / m[1][1], aa = (m[0][3] - m[0][1] * bb - m[0][2] * cc) / m[0][0]
    return [aa, bb, cc]
  }
  if (samples.length < 30) return null
  // start from the most common edge colour (the wall), then refit on the samples that agree with it
  const bins = new Map()
  for (const [, , i] of samples) { const key = (d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4); bins.set(key, (bins.get(key) || 0) + 1) }
  const top = [...bins].sort((a, b) => b[1] - a[1])[0][0]
  const seed = [(top >> 8) * 16 + 8, ((top >> 4) & 15) * 16 + 8, (top & 15) * 16 + 8]
  let plane = [0, 1, 2].map((ch) => [seed[ch], 0, 0])
  const pred = (pl, x, y) => [pl[0][0] + pl[0][1] * x + pl[0][2] * y, pl[1][0] + pl[1][1] * x + pl[1][2] * y, pl[2][0] + pl[2][1] * x + pl[2][2] * y]
  const resid = (pl, [x, y, i]) => { const p = pred(pl, x, y); return Math.hypot(d[i] - p[0], d[i + 1] - p[1], d[i + 2] - p[2]) / 1.732 }
  let inliers = samples.filter((s) => resid(plane, s) < tol + 10)
  for (let pass = 0; pass < 3 && inliers.length >= 30; pass++) {
    plane = [0, 1, 2].map((ch) => fit(inliers, ch))
    inliers = samples.filter((s) => resid(plane, s) < tol + 6)
  }
  if (inliers.length < samples.length * 0.35) return null // no plain wall along the edges
  const dist = (p, x, y) => { const q = pred(plane, x / w, y / h); return Math.hypot(d[p * 4] - q[0], d[p * 4 + 1] - q[1], d[p * 4 + 2] - q[2]) / 1.732 }
  const mask = new Uint8Array(w * h)
  const queue = new Int32Array(w * h)
  let qh = 0, qt = 0
  const push = (p, x, y) => { if (!mask[p] && dist(p, x, y) < tol) { mask[p] = 1; queue[qt++] = p } }
  for (let x = 0; x < w; x++) { push(x, x, 0); push((h - 1) * w + x, x, h - 1) }
  for (let y = 0; y < h; y++) { push(y * w, 0, y); push(y * w + w - 1, w - 1, y) }
  while (qh < qt) {
    const p = queue[qh++]
    const x = p % w, y = (p / w) | 0
    if (x > 0) push(p - 1, x - 1, y)
    if (x < w - 1) push(p + 1, x + 1, y)
    if (y > 0) push(p - w, x, y - 1)
    if (y < h - 1) push(p + w, x, y + 1)
  }
  const fraction = qt / (w * h)
  if (fraction < 0.03 || fraction > 0.95) return null
  // grow the mask by one pixel so the thin halo around hair and shoulders is whitened too
  const out = ctx.createImageData(w, h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x
    const on = mask[p] || (x > 0 && mask[p - 1]) || (x < w - 1 && mask[p + 1]) || (y > 0 && mask[p - w]) || (y < h - 1 && mask[p + w])
    if (on) { out.data[p * 4] = out.data[p * 4 + 1] = out.data[p * 4 + 2] = 255; out.data[p * 4 + 3] = 255 }
  }
  ctx.putImageData(out, 0, 0)
  return { canvas: c, fraction, scale: k }
}

/** Paint white over the background of a cropped output. rect is the crop in source pixels, bg comes from backgroundMask(src). */
export function applyBackground(c, bg, rect) {
  const w = c.width, h = c.height
  const m = newCanvas(w, h)
  const mctx = m.getContext('2d', { willReadFrequently: true })
  mctx.imageSmoothingQuality = 'high'
  mctx.drawImage(bg.canvas, rect.x * bg.scale, rect.y * bg.scale, rect.w * bg.scale, rect.h * bg.scale, 0, 0, w, h)
  const md = mctx.getImageData(0, 0, w, h).data
  const ctx = c.getContext('2d', { willReadFrequently: true })
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const a = md[i + 3] / 255
    if (a > 0) { d[i] += (255 - d[i]) * a; d[i + 1] += (255 - d[i + 1]) * a; d[i + 2] += (255 - d[i + 2]) * a }
  }
  ctx.putImageData(img, 0, 0)
}

// ---------- Signatures ----------

const INK = { black: [12, 12, 16], blue: [16, 42, 166] }
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }

/**
 * Remove paper from a signature photo. Estimates the paper brightness block by block (so shadows and uneven light are ignored),
 * turns darker-than-paper pixels into ink, and returns a canvas with a transparent background.
 * opts: {threshold 0-100 (higher removes more paper), strength 0.5-2 (ink darkness), ink: 'original'|'black'|'blue', maxSide, trim, pad}
 */
export function cleanSignature(src, { threshold = 50, strength = 1.2, ink = 'black', maxSide = 1800, trim = true, pad = 8 } = {}) {
  const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height
  const s = Math.min(1, maxSide / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * s)), h = Math.max(1, Math.round(sh * s))
  const c = newCanvas(w, h)
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, w, h)
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const lum = new Float32Array(w * h)
  for (let p = 0; p < w * h; p++) lum[p] = 0.299 * d[p * 4] + 0.587 * d[p * 4 + 1] + 0.114 * d[p * 4 + 2]
  // paper level per block: the 80th percentile of brightness in the block
  const B = Math.max(10, Math.round(Math.max(w, h) / 36))
  const gw = Math.ceil(w / B), gh = Math.ceil(h / B)
  let grid = new Float32Array(gw * gh)
  const hist = new Uint16Array(64)
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    hist.fill(0)
    let n = 0
    for (let y = gy * B; y < Math.min(h, gy * B + B); y++) for (let x = gx * B; x < Math.min(w, gx * B + B); x++) { hist[lum[y * w + x] >> 2]++; n++ }
    let acc = 0, k = 63
    for (; k > 0; k--) { acc += hist[k]; if (acc >= n * 0.2) break }
    grid[gy * gw + gx] = k * 4 + 2
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(grid.length)
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      let sum = 0, n = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = gx + dx, y = gy + dy
        if (x >= 0 && y >= 0 && x < gw && y < gh) { sum += grid[y * gw + x]; n++ }
      }
      next[gy * gw + gx] = sum / n
    }
    grid = next
  }
  const t0 = 0.05 + 0.2 * (threshold / 100), t1 = t0 + 0.22
  const col = INK[ink]
  for (let y = 0; y < h; y++) {
    const fy = clamp((y + 0.5) / B - 0.5, 0, gh - 1), y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0
    for (let x = 0; x < w; x++) {
      const fx = clamp((x + 0.5) / B - 0.5, 0, gw - 1), x0 = Math.floor(fx), x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0
      const bg = (grid[y0 * gw + x0] * (1 - tx) + grid[y0 * gw + x1] * tx) * (1 - ty) + (grid[y1 * gw + x0] * (1 - tx) + grid[y1 * gw + x1] * tx) * ty
      const p = y * w + x
      const dark = 1 - lum[p] / Math.max(40, bg)
      const a = clamp(smooth(t0, t1, dark) * strength, 0, 1)
      const o = p * 4
      if (ink === 'original') { d[o] *= 0.55; d[o + 1] *= 0.55; d[o + 2] *= 0.55 } else { d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2] }
      d[o + 3] = Math.round(a * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  return trim ? trimToInk(c, pad) : c
}

/** Crop to the ink: the bounding box of opaque pixels (or, with opaque = false, of non-white pixels), plus padding. */
export function trimToInk(c, pad = 8, opaque = true) {
  const w = c.width, h = c.height
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4
    const ink = opaque ? d[o + 3] > 40 : (d[o + 3] > 40 && d[o] + d[o + 1] + d[o + 2] < 690)
    if (ink) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  }
  if (x1 < 0) return c
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad)
  const out = newCanvas(x1 - x0 + 1, y1 - y0 + 1)
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
  return out
}

/** Flatten a canvas with transparency onto a solid colour. */
export function flatten(c, bg = '#ffffff') {
  const out = newCanvas(c.width, c.height)
  const ctx = out.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(c, 0, 0)
  return out
}

// ---------- Encoding to a spec ----------

const blobBytes = async (b) => new Uint8Array(await b.arrayBuffer())

/**
 * Encode as JPEG inside [minKB, maxKB] at exactly the canvas size. Searches the highest quality that fits; if even the lowest quality is too big it
 * softens fine detail (the pixel size never changes). Below the minimum the file is padded with comment bytes. Sizes are kept safe for both
 * 1 KB = 1000 and 1 KB = 1024 bytes. -> {blob, quality, softened, padded}
 */
export async function encodeToSpec(c, { minKB = 0, maxKB = 0, dpi = 0, type = 'image/jpeg' } = {}) {
  if (!canEncode(type)) throw new Error('This browser cannot save that image type. Use JPEG.')
  const maxBytes = maxKB ? Math.floor(maxKB * 1000) - 64 : Infinity
  let work = c, softened = false, res
  if (maxBytes === Infinity) res = { blob: await toBlob(c, type, 0.92), quality: 0.92 }
  else {
    res = await compressToTarget(work, { maxBytes, type, allowResize: false, minQuality: 0.02 })
    for (const f of [0.85, 0.7, 0.55, 0.42, 0.3]) {
      if (res.blob.size <= maxBytes) break
      softened = true
      const small = newCanvas(Math.max(8, Math.round(c.width * f)), Math.max(8, Math.round(c.height * f)))
      small.getContext('2d').drawImage(c, 0, 0, small.width, small.height)
      work = newCanvas(c.width, c.height)
      const ctx = work.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(small, 0, 0, work.width, work.height)
      res = await compressToTarget(work, { maxBytes, type, allowResize: false, minQuality: 0.02 })
    }
  }
  let bytes = await blobBytes(res.blob)
  if (type === 'image/jpeg') {
    if (dpi) bytes = setJpegDpi(bytes, dpi)
    const min = minKB ? minKB * 1024 + 64 : 0
    const padded = bytes.length < min
    if (padded) bytes = padJpeg(bytes, min)
    return { blob: new Blob([bytes], { type }), quality: res.quality, softened, padded }
  }
  return { blob: res.blob, quality: res.quality, softened, padded: false }
}

/** Decode a produced blob again and report what a portal would see. */
export async function inspectBlob(blob) {
  const bytes = await blobBytes(blob)
  const bmp = await createImageBitmap(blob)
  const info = { width: bmp.width, height: bmp.height, size: blob.size, type: blob.type, dpi: blob.type === 'image/jpeg' ? readJpegDpi(bytes) : null }
  bmp.close?.()
  return info
}
