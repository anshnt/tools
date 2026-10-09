// Face detection and landmarks with MediaPipe Tasks Vision (Apache-2.0), loaded from a pinned CDN build.
// Models are small (0.2 MB detector, 3.7 MB landmarker) and run locally in WebAssembly.
import { yieldToMain } from '../../lib/ui.js'
import { canvas as makeCanvas } from '../../lib/image.js'
import { checkAbort, friendlyError } from './_ml.js'

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35'
const GOOGLE = 'https://storage.googleapis.com/mediapipe-models'
const DETECTOR = `${GOOGLE}/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`
const LANDMARKER = `${GOOGLE}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`

let visionP = null
const vision = () => {
  if (!visionP) {
    visionP = (async () => {
      const m = await import(`${MP}/vision_bundle.mjs`)
      const fileset = await m.FilesetResolver.forVisionTasks(`${MP}/wasm`)
      return { m, fileset }
    })().catch((e) => { visionP = null; throw friendlyError(e) })
  }
  return visionP
}

let detP = null
export function faceDetector() {
  if (!detP) {
    detP = vision().then(({ m, fileset }) => m.FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: DETECTOR, delegate: 'CPU' }, runningMode: 'IMAGE', minDetectionConfidence: 0.25,
    })).catch((e) => { detP = null; throw friendlyError(e) })
  }
  return detP
}

let lmP = null
export function faceLandmarker() {
  if (!lmP) {
    lmP = vision().then(({ m, fileset }) => m.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: LANDMARKER, delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 5,
      minFaceDetectionConfidence: 0.35, minFacePresenceConfidence: 0.35,
    })).catch((e) => { lmP = null; throw friendlyError(e) })
  }
  return lmP
}

const area = (b) => b.w * b.h
function inter(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h)
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
}
/** Merge overlapping detections of the same face (union of the cluster, best score). */
export function mergeBoxes(boxes) {
  const list = boxes.map((b) => ({ ...b }))
  let changed = true
  while (changed) {
    changed = false
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j]
        const it = inter(a, b)
        const iou = it / (area(a) + area(b) - it)
        const iomin = it / Math.min(area(a), area(b))
        if (iou > 0.35 || iomin > 0.7) {
          const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h)
          list[i] = { x: x0, y: y0, w: x1 - x0, h: y1 - y0, score: Math.max(a.score, b.score), n: (a.n || 1) + (b.n || 1) }
          list.splice(j, 1)
          changed = true
          break outer
        }
      }
    }
  }
  return list
}

/**
 * Find faces in a canvas. thorough: also scan zoomed tiles so small faces in group photos are found.
 * Returns [{x, y, w, h, score}] in canvas pixels, sorted left to right.
 */
export async function detectFaces(source, { minScore = 0.5, thorough = true, signal, onProgress } = {}) {
  const det = await faceDetector()
  const W = source.width, H = source.height
  const found = []
  const add = (res, ox, oy, k, strict) => {
    for (const d of res.detections || []) {
      const s = d.categories?.[0]?.score ?? 0
      if (s < minScore + (strict ? 0.1 : 0)) continue
      const bb = d.boundingBox
      const b = { x: ox + bb.originX * k, y: oy + bb.originY * k, w: bb.width * k, h: bb.height * k, score: s }
      if (b.w < 10 || b.h < 10) continue
      found.push(b)
    }
  }
  add(det.detect(source), 0, 0, 1, false)
  if (thorough) {
    const m = Math.min(W, H)
    const scales = [0.62, 0.4, 0.26, 0.17].filter((f) => m * f >= 96)
    const jobs = []
    for (const f of scales) {
      const T = Math.round(m * f)
      const step = Math.max(1, Math.round(T * 0.5))
      const xs = [], ys = []
      for (let x = 0; x < W - T; x += step) xs.push(x)
      xs.push(Math.max(0, W - T))
      for (let y = 0; y < H - T; y += step) ys.push(y)
      ys.push(Math.max(0, H - T))
      for (const y of ys) for (const x of xs) jobs.push([x, y, Math.min(T, W), Math.min(T, H)])
    }
    const size = 512
    const tile = makeCanvas(size, size)
    const tx = tile.getContext('2d', { willReadFrequently: true })
    for (let i = 0; i < jobs.length; i++) {
      checkAbort(signal)
      const [x, y, tw, th] = jobs[i]
      tx.clearRect(0, 0, size, size)
      const k = Math.max(tw, th) / size
      tx.drawImage(source, x, y, tw, th, 0, 0, tw / k, th / k)
      add(det.detect(tile), x, y, k, true)
      if (i % 12 === 0) { onProgress?.(i / jobs.length); await yieldToMain() }
    }
  }
  // A real face shows up in several overlapping tiles; a lone weak hit is usually a texture that looks like a face.
  return mergeBoxes(found).filter((b) => !thorough || b.score >= 0.85 || (b.n || 1) >= 2).sort((a, b) => a.x - b.x)
}

/**
 * Landmarks for the most prominent face. Returns null when no face is found.
 * -> {points (pixel coords for the whole 478-point mesh), box, eyeL, eyeR, chin, forehead, tilt (radians), count}
 */
export async function faceMesh(source, { signal } = {}) {
  const lm = await faceLandmarker()
  checkAbort(signal)
  const res = lm.detect(source)
  const faces = res.faceLandmarks || []
  if (!faces.length) return null
  const W = source.width, H = source.height
  const toPx = (f) => f.map((p) => ({ x: p.x * W, y: p.y * H }))
  let best = null
  for (const f of faces) {
    const pts = toPx(f)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y) }
    const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    if (!best || area(box) > area(best.box)) best = { pts, box }
  }
  const P = best.pts
  // 468 / 473 are the iris centers when the model returns them; otherwise average the eye corners.
  const avg = (...i) => ({ x: i.reduce((s, k) => s + P[k].x, 0) / i.length, y: i.reduce((s, k) => s + P[k].y, 0) / i.length })
  const eyeR = P.length > 473 ? P[468] : avg(33, 133)   // subject's right eye (left side of the image)
  const eyeL = P.length > 473 ? P[473] : avg(362, 263)
  const tilt = Math.atan2(eyeL.y - eyeR.y, eyeL.x - eyeR.x)
  return { points: P, box: best.box, eyeL, eyeR, chin: P[152], forehead: P[10], nose: P[1], tilt, count: faces.length }
}

