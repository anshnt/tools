// Object removal: MI-GAN (MIT) and LaMa (Apache-2.0) through ONNX Runtime Web, plus an instant push-pull fill that
// needs no download. Works on crops around each painted area so large photos keep their full resolution.
import { canvas as makeCanvas } from '../../lib/image.js'
import { yieldToMain } from '../../lib/ui.js'
import { ortSession, checkAbort, morph, gaussU8, markGpuBroken } from './_ml.js'

export const MODELS = {
  fast: {
    id: 'inpaint-migan', key: 'fast', name: 'Fast', sub: 'MI-GAN', size: 28079181, mb: 28,
    desc: 'Great for people, signs, wires and other objects on simple backgrounds.',
    urls: 'https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx',
  },
  best: {
    id: 'inpaint-lama', key: 'best', name: 'Best quality', sub: 'LaMa', mb: 92,
    size: { webgpu: 208044816, wasm: 92591623 },
    desc: 'Rebuilds large areas, patterns and textures. Slower, bigger download.',
    urls: {
      webgpu: 'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx',
      wasm: 'https://huggingface.co/opencv/inpainting_lama/resolve/main/inpainting_lama_2025jan.onnx',
    },
  },
  instant: {
    id: 'inpaint-instant', key: 'instant', name: 'Instant', sub: 'No download', mb: 0,
    desc: 'Smooth fill for small spots, dust and blemishes. Works offline.',
  },
}

const SIDE = 512

/** Connected clusters of painted pixels as boxes {x, y, w, h} in pixels. mask: Uint8 (w*h), non-zero = painted. */
export function maskBoxes(mask, w, h, { cell = 16, merge = 0.35 } = {}) {
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell)
  const grid = new Uint8Array(gw * gh)
  for (let y = 0; y < h; y++) {
    const o = y * w, go = Math.floor(y / cell) * gw
    for (let x = 0; x < w; x++) if (mask[o + x]) grid[go + Math.floor(x / cell)] = 1
  }
  // join cells that are close (one cell gap)
  const dil = new Uint8Array(grid.length)
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    if (!grid[y * gw + x]) continue
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy
      if (nx >= 0 && ny >= 0 && nx < gw && ny < gh) dil[ny * gw + nx] = 1
    }
  }
  const seen = new Uint8Array(grid.length)
  let boxes = []
  for (let i = 0; i < dil.length; i++) {
    if (!dil[i] || seen[i]) continue
    const stack = [i]
    seen[i] = 1
    let x0 = gw, y0 = gh, x1 = -1, y1 = -1
    while (stack.length) {
      const c = stack.pop()
      const cx = c % gw, cy = (c / gw) | 0
      if (grid[c]) { x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy) }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue
        const n = ny * gw + nx
        if (dil[n] && !seen[n]) { seen[n] = 1; stack.push(n) }
      }
    }
    if (x1 >= 0) boxes.push({ x: x0 * cell, y: y0 * cell, w: Math.min(w, (x1 + 1) * cell) - x0 * cell, h: Math.min(h, (y1 + 1) * cell) - y0 * cell })
  }
  // merge boxes whose context windows overlap
  let changed = true
  while (changed && boxes.length > 1) {
    changed = false
    outer: for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j]
        const pa = Math.max(a.w, a.h) * merge, pb = Math.max(b.w, b.h) * merge
        if (a.x - pa < b.x + b.w + pb && b.x - pb < a.x + a.w + pa && a.y - pa < b.y + b.h + pb && b.y - pb < a.y + a.h + pa) {
          const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y)
          boxes[i] = { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 }
          boxes.splice(j, 1)
          changed = true
          break outer
        }
      }
    }
  }
  return boxes
}

/** Square crop window (side `s`) around a box, kept inside the image. */
export function cropWindow(box, W, H, minSide = SIDE, scale = 2.0) {
  const s = Math.round(Math.min(Math.min(W, H), Math.max(minSide, Math.max(box.w, box.h) * scale)))
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2
  const x = Math.round(Math.max(0, Math.min(W - s, cx - s / 2)))
  const y = Math.round(Math.max(0, Math.min(H - s, cy - s / 2)))
  return { x, y, s }
}

// ---------------------------------------------------------------- instant fill (push-pull)

/** Fill hole pixels (hole[i] = 1) with smoothly interpolated surrounding color plus matching grain. Mutates `data` (RGBA). */
export function pushPullFill(data, hole, w, h) {
  const levels = []
  let cw = w, ch = h
  let col = new Float32Array(w * h * 3), wt = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    if (!hole[i]) { wt[i] = 1; col[i * 3] = data[i * 4]; col[i * 3 + 1] = data[i * 4 + 1]; col[i * 3 + 2] = data[i * 4 + 2] }
  }
  levels.push({ w: cw, h: ch, col, wt })
  while (cw > 1 || ch > 1) {
    const nw = Math.max(1, cw >> 1), nh = Math.max(1, ch >> 1)
    const ncol = new Float32Array(nw * nh * 3), nwt = new Float32Array(nw * nh)
    for (let y = 0; y < ch; y++) {
      const ty = Math.min(nh - 1, y >> 1)
      for (let x = 0; x < cw; x++) {
        const tx = Math.min(nw - 1, x >> 1)
        const i = y * cw + x, t = ty * nw + tx
        const k = wt[i]
        nwt[t] += k
        ncol[t * 3] += col[i * 3] * k; ncol[t * 3 + 1] += col[i * 3 + 1] * k; ncol[t * 3 + 2] += col[i * 3 + 2] * k
      }
    }
    for (let t = 0; t < nw * nh; t++) {
      if (nwt[t] > 0) { ncol[t * 3] /= nwt[t]; ncol[t * 3 + 1] /= nwt[t]; ncol[t * 3 + 2] /= nwt[t]; nwt[t] = Math.min(1, nwt[t] / 4) }
    }
    levels.push({ w: nw, h: nh, col: ncol, wt: nwt })
    col = ncol; wt = nwt; cw = nw; ch = nh
  }
  // pull: fill each level from the coarser one
  let up = null
  for (let l = levels.length - 1; l >= 0; l--) {
    const { w: lw, h: lh, col: lc, wt: lwt } = levels[l]
    const res = new Float32Array(lw * lh * 3)
    for (let y = 0; y < lh; y++) {
      for (let x = 0; x < lw; x++) {
        const i = y * lw + x
        let r = 0, g = 0, b = 0
        if (up) {
          const sx = Math.min(up.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5)), sy = Math.min(up.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5))
          const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(up.w - 1, x0 + 1), y1 = Math.min(up.h - 1, y0 + 1), tx = sx - x0, ty = sy - y0
          for (let c = 0; c < 3; c++) {
            const v = up.res[(y0 * up.w + x0) * 3 + c] * (1 - tx) * (1 - ty) + up.res[(y0 * up.w + x1) * 3 + c] * tx * (1 - ty) + up.res[(y1 * up.w + x0) * 3 + c] * (1 - tx) * ty + up.res[(y1 * up.w + x1) * 3 + c] * tx * ty
            if (c === 0) r = v; else if (c === 1) g = v; else b = v
          }
        }
        const k = lwt[i]
        res[i * 3] = k * lc[i * 3] + (1 - k) * r
        res[i * 3 + 1] = k * lc[i * 3 + 1] + (1 - k) * g
        res[i * 3 + 2] = k * lc[i * 3 + 2] + (1 - k) * b
      }
    }
    up = { w: lw, h: lh, res }
  }
  // grain: match the noise level of the known pixels around the hole
  let sum = 0, n = 0
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const i = y * w + x
      if (hole[i] || hole[i - 1] || hole[i + 1] || hole[i - w] || hole[i + w]) continue
      const m = (data[(i - 1) * 4 + 1] + data[(i + 1) * 4 + 1] + data[(i - w) * 4 + 1] + data[(i + w) * 4 + 1]) / 4
      sum += Math.abs(data[i * 4 + 1] - m); n++
    }
  }
  const sigma = Math.min(6, n ? (sum / n) * 1.25 : 0)
  const res = up.res
  let seed = 1234567
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5 }
  for (let i = 0; i < w * h; i++) {
    if (!hole[i]) continue
    const g = (rnd() + rnd() + rnd()) * 2 * sigma
    data[i * 4] = res[i * 3] + g; data[i * 4 + 1] = res[i * 3 + 1] + g; data[i * 4 + 2] = res[i * 3 + 2] + g; data[i * 4 + 3] = 255
  }
}

// ---------------------------------------------------------------- models

async function runModel(key, imgData512, maskHole512, { onProgress, signal }) {
  const spec = MODELS[key]
  const n = SIDE * SIDE
  for (let attempt = 0; attempt < 2; attempt++) {
    const { ort, session, ep } = await ortSession({ id: spec.id, urls: spec.urls, size: spec.size }, { onProgress, signal })
    checkAbort(signal)
    let feeds
    if (key === 'fast') {
      const a = new Uint8Array(3 * n), m = new Uint8Array(n)
      for (let i = 0; i < n; i++) { a[i] = imgData512[i * 4]; a[n + i] = imgData512[i * 4 + 1]; a[2 * n + i] = imgData512[i * 4 + 2]; m[i] = maskHole512[i] ? 0 : 255 }
      feeds = { image: new ort.Tensor('uint8', a, [1, 3, SIDE, SIDE]), mask: new ort.Tensor('uint8', m, [1, 1, SIDE, SIDE]) }
    } else {
      const a = new Float32Array(3 * n), m = new Float32Array(n)
      for (let i = 0; i < n; i++) { a[i] = imgData512[i * 4] / 255; a[n + i] = imgData512[i * 4 + 1] / 255; a[2 * n + i] = imgData512[i * 4 + 2] / 255; m[i] = maskHole512[i] ? 1 : 0 }
      feeds = { image: new ort.Tensor('float32', a, [1, 3, SIDE, SIDE]), mask: new ort.Tensor('float32', m, [1, 1, SIDE, SIDE]) }
    }
    onProgress?.(null, 'Filling it in')
    await yieldToMain()
    const out = await session.run(feeds)
    const d = Object.values(out)[0].data
    // Sanity check: the model must leave known pixels alone. A broken GPU path returns garbage there.
    let diff = 0, cnt = 0
    for (let i = 0; i < n; i += 7) {
      if (maskHole512[i]) continue
      diff += Math.abs(d[i] - imgData512[i * 4]) + Math.abs(d[n + i] - imgData512[i * 4 + 1]) + Math.abs(d[2 * n + i] - imgData512[i * 4 + 2]); cnt += 3
    }
    if (cnt && diff / cnt > 14 && ep === 'webgpu' && attempt === 0) { console.warn('WebGPU output looked wrong, retrying on WebAssembly'); markGpuBroken(); continue }
    const rgba = new Uint8ClampedArray(n * 4)
    for (let i = 0; i < n; i++) { rgba[i * 4] = d[i]; rgba[i * 4 + 1] = d[n + i]; rgba[i * 4 + 2] = d[2 * n + i]; rgba[i * 4 + 3] = 255 }
    return { rgba, ep }
  }
  throw new Error('The AI model returned an unexpected result on this device. Try the Instant fill instead.')
}

/**
 * Fill the painted area of `base` (canvas, modified in place).
 * maskFull: Uint8 (base.width * base.height), non-zero = remove. Returns patches for undo: [{x, y, w, h, before, after}].
 * opts: {model: 'fast'|'best'|'instant', grow (px at 1000 px long edge), onProgress(f, label), signal}
 */
export async function inpaint(base, maskFull, { model = 'fast', grow = 5, onProgress, signal } = {}) {
  const W = base.width, H = base.height
  const bctx = base.getContext('2d', { willReadFrequently: true })
  const boxes = maskBoxes(maskFull, W, H)
  const patches = []
  const g = Math.max(2, Math.round(grow * Math.max(W, H) / 1000))
  for (let bi = 0; bi < boxes.length; bi++) {
    checkAbort(signal)
    const box = boxes[bi]
    const label = boxes.length > 1 ? `Removing object ${bi + 1} of ${boxes.length}` : 'Removing the object'
    onProgress?.(null, label)
    const win = model === 'instant'
      ? cropWindow(box, W, H, 64, 1.6)
      : cropWindow(box, W, H, SIDE, 2.0)
    const { x, y, s } = win
    // crop mask, grown so the fill covers the object's edges and shadow
    const crop = new Uint8ClampedArray(s * s)
    for (let yy = 0; yy < s; yy++) {
      const src = (y + yy) * W + x
      for (let xx = 0; xx < s; xx++) crop[yy * s + xx] = maskFull[src + xx] ? 255 : 0
    }
    const hole = morph(crop, s, s, g, 'max')
    // bounding box of the grown hole, for the undo patch
    let hx0 = s, hy0 = s, hx1 = -1, hy1 = -1
    for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) if (hole[yy * s + xx]) { if (xx < hx0) hx0 = xx; if (xx > hx1) hx1 = xx; if (yy < hy0) hy0 = yy; if (yy > hy1) hy1 = yy }
    if (hx1 < 0) continue
    const feather = Math.max(1.2, g * 0.45)
    const soft = gaussU8(hole, s, s, feather)
    const before = bctx.getImageData(x, y, s, s)
    const result = new Uint8ClampedArray(before.data)

    if (model === 'instant') {
      const holeBin = new Uint8Array(s * s)
      for (let i = 0; i < holeBin.length; i++) holeBin[i] = hole[i] > 127 ? 1 : 0
      pushPullFill(result, holeBin, s, s)
    } else {
      // resize crop and mask to the 512 px the models expect
      const cc = makeCanvas(SIDE, SIDE), cx = cc.getContext('2d', { willReadFrequently: true })
      cx.imageSmoothingQuality = 'high'
      cx.drawImage(base, x, y, s, s, 0, 0, SIDE, SIDE)
      const img512 = cx.getImageData(0, 0, SIDE, SIDE).data
      const mc = makeCanvas(SIDE, SIDE), mx = mc.getContext('2d', { willReadFrequently: true })
      const mid = new ImageData(s, s)
      for (let i = 0; i < hole.length; i++) { const v = hole[i]; mid.data[i * 4] = mid.data[i * 4 + 1] = mid.data[i * 4 + 2] = v; mid.data[i * 4 + 3] = 255 }
      const tmp = makeCanvas(s, s); tmp.getContext('2d').putImageData(mid, 0, 0)
      mx.imageSmoothingQuality = 'high'
      mx.drawImage(tmp, 0, 0, SIDE, SIDE)
      const m512d = mx.getImageData(0, 0, SIDE, SIDE).data
      const hole512 = new Uint8Array(SIDE * SIDE)
      for (let i = 0; i < hole512.length; i++) hole512[i] = m512d[i * 4] > 100 ? 1 : 0
      const { rgba } = await runModel(model, img512, hole512, { onProgress: (f, l) => onProgress?.(f, l), signal })
      // back to the crop size
      const oc = makeCanvas(SIDE, SIDE); oc.getContext('2d').putImageData(new ImageData(rgba, SIDE, SIDE), 0, 0)
      const fc = makeCanvas(s, s), fx = fc.getContext('2d', { willReadFrequently: true })
      fx.imageSmoothingQuality = 'high'
      fx.drawImage(oc, 0, 0, s, s)
      const filled = fx.getImageData(0, 0, s, s).data
      for (let i = 0; i < s * s; i++) {
        if (!hole[i] && !soft[i]) continue
        result[i * 4] = filled[i * 4]; result[i * 4 + 1] = filled[i * 4 + 1]; result[i * 4 + 2] = filled[i * 4 + 2]
      }
    }
    // blend only where the soft mask says so, leaving every other pixel untouched
    const after = new ImageData(new Uint8ClampedArray(before.data), s, s)
    for (let i = 0; i < s * s; i++) {
      const a = Math.max(soft[i], hole[i]) / 255
      if (a <= 0) continue
      const k = hole[i] > 127 ? Math.max(a, 0.92) : a
      for (let c = 0; c < 3; c++) after.data[i * 4 + c] = before.data[i * 4 + c] + (result[i * 4 + c] - before.data[i * 4 + c]) * k
    }
    // keep patches small: only the bounding box of what changed
    const m = Math.ceil(feather * 3) + 2
    const px0 = Math.max(0, hx0 - m), py0 = Math.max(0, hy0 - m), px1 = Math.min(s - 1, hx1 + m), py1 = Math.min(s - 1, hy1 + m)
    const pw = px1 - px0 + 1, ph = py1 - py0 + 1
    const cut = (img) => {
      const o = new ImageData(pw, ph)
      for (let yy = 0; yy < ph; yy++) o.data.set(img.data.subarray(((py0 + yy) * s + px0) * 4, ((py0 + yy) * s + px0 + pw) * 4), yy * pw * 4)
      return o
    }
    const patch = { x: x + px0, y: y + py0, w: pw, h: ph, before: cut(before), after: cut(after) }
    bctx.putImageData(patch.after, patch.x, patch.y)
    patches.push(patch)
    await yieldToMain()
  }
  return patches
}

