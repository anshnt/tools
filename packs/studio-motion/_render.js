// Canvas renderer: draws a document at time t into any 2D context (live preview, video frames, GIF, PNG). Pure: no UI, no global state except scratch canvases.
import { valueAt, clamp } from './_anim.js'

export const HAS_FILTER = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype

// ---------- 2D matrices as [a, b, c, d, e, f] (canvas order) ----------
export const IDENT = [1, 0, 0, 1, 0, 0]
export const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]
export function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2]
  if (Math.abs(det) < 1e-12) return null
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det]
}
export const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

/** T(position) R(rotation) S(scale) T(-anchor) for a layer at time t. */
export function localMatrix(L, t) {
  const p = valueAt(L.props.position, t), a = valueAt(L.props.anchor, t), s = valueAt(L.props.scale, t)
  const r = valueAt(L.props.rotation, t) * Math.PI / 180
  const c = Math.cos(r), sn = Math.sin(r), sx = s[0] / 100, sy = s[1] / 100
  const m = [c * sx, sn * sx, -sn * sy, c * sy, 0, 0]
  m[4] = p[0] - (m[0] * a[0] + m[2] * a[1])
  m[5] = p[1] - (m[1] * a[0] + m[3] * a[1])
  return m
}
/** World matrix of a layer given the chain [rootGroup, ..., layer] from pathTo(). */
export const chainMatrix = (chain, t, base = IDENT) => chain.reduce((m, L) => mul(m, localMatrix(L, t)), base)

export function hexRgb(hex) {
  let h = String(hex || '#000').replace('#', '')
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  const n = parseInt(h, 16) || 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// ---------- scratch canvases (layers with effects, groups with opacity) ----------
const pool = []
function acquire(w, h) {
  let c = pool.find((x) => !x._busy && x.width === w && x.height === h)
  if (!c) {
    for (let i = pool.length - 1; i >= 0 && pool.length > 6; i--) if (!pool[i]._busy) pool.splice(i, 1)
    c = document.createElement('canvas')
    c.width = w; c.height = h
    pool.push(c)
  }
  c._busy = true
  const x = c.getContext('2d')
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'
  if (HAS_FILTER) x.filter = 'none'
  x.clearRect(0, 0, w, h)
  return c
}
const release = (c) => { c._busy = false }
export function releaseScratch() { pool.length = 0 }

// ---------- text layout ----------
const mctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
const layoutCache = new Map()
let fontVer = 0
if (typeof document !== 'undefined') document.fonts?.addEventListener?.('loadingdone', () => { fontVer++; layoutCache.clear() })

export function fontString(d) {
  const fam = /\s/.test(d.font) && !/^["']/.test(d.font) ? `"${d.font}"` : d.font
  return `${d.italic ? 'italic ' : ''}${d.weight} ${Math.max(1, d.size)}px ${fam}, sans-serif`
}
/** Per-character layout of a text layer, centred on (0, 0): {lines: [{x0, y, w, chars: [{ch, x, w, ci, wi, li}]}], width, height, nChars, nWords, nLines}. */
export function layoutText(d) {
  const key = `${fontVer}|${fontString(d)}|${d.text}|${d.tracking}|${d.lineHeight}|${d.align}`
  const hit = layoutCache.get(key)
  if (hit) return hit
  mctx.font = fontString(d)
  const lh = d.size * d.lineHeight, tr = d.tracking || 0
  const raw = String(d.text).split('\n')
  let ci = 0, wi = -1, inWord = false
  const lines = raw.map((txt, li) => {
    const chars = Array.from(txt)
    const cum = [0]
    let acc = ''
    for (const ch of chars) { acc += ch; cum.push(mctx.measureText(acc).width) }
    const out = chars.map((ch, i) => {
      const space = /\s/.test(ch)
      if (!space && !inWord) { wi++; inWord = true } else if (space) inWord = false
      return { ch, x: cum[i] + i * tr, w: cum[i + 1] - cum[i], ci: ci++, wi: Math.max(0, wi), li }
    })
    inWord = false
    return { text: txt, w: cum[chars.length] + Math.max(0, chars.length - 1) * tr, chars: out, x0: 0, y: 0 }
  })
  const width = Math.max(1, ...lines.map((l) => l.w)), height = lines.length * lh
  lines.forEach((l, i) => {
    l.y = -height / 2 + (i + 0.5) * lh
    l.x0 = d.align === 'left' ? -width / 2 : d.align === 'right' ? width / 2 - l.w : -l.w / 2
  })
  const res = { lines, width, height, nChars: Math.max(1, ci), nWords: Math.max(1, wi + 1), nLines: lines.length }
  if (layoutCache.size > 300) layoutCache.clear()
  layoutCache.set(key, res)
  return res
}

/** Wait for the web fonts used by text layers so exports never fall back to a default font. */
export async function preloadFonts(doc) {
  const jobs = []
  const walkL = (list) => { for (const L of list) { if (L.type === 'text') jobs.push(document.fonts.load(fontString(L.data), L.data.text || 'A').catch(() => {})); if (L.children) walkL(L.children) } }
  walkL(doc.layers)
  await Promise.all(jobs)
}

/** Selector amount (0..1) of a unit at x percent for a range [S, E]. */
export function selAmount(shape, x, S, E) {
  if (shape === 'square') return x >= S && x <= E ? 1 : 0
  const w = E - S
  if (w < 1e-6) return x >= S ? 1 : 0
  if (shape === 'ramp') return clamp((x - S) / w, 0, 1)
  const d = Math.abs(x - (S + E) / 2) / (w / 2)
  return d >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * d))
}
function animatorState(a, t, lay) {
  const n = a.unit === 'words' ? lay.nWords : a.unit === 'lines' ? lay.nLines : lay.nChars
  const g = (k) => valueAt(a.props[k], t)
  const off = g('offset')
  let S = g('start') + off, E = g('end') + off
  if (E < S) [S, E] = [E, S]
  const amounts = new Float32Array(n)
  for (let i = 0; i < n; i++) amounts[i] = selAmount(a.shape, (i + 0.5) / n * 100, S, E)
  return { unit: a.unit, amounts, opacity: g('opacity') / 100, position: g('position'), scale: g('scale'), rotation: g('rotation') }
}

// ---------- shapes ----------
/** Builds the shape path centred on (0, 0) starting at the top, and returns its length (for trim paths). */
export function shapePath(ctx, d) {
  const w = Math.max(0, d.w), h = Math.max(0, d.h)
  ctx.beginPath()
  if (d.kind === 'ellipse') {
    const a = Math.max(w / 2, 0.01), b = Math.max(h / 2, 0.01)
    ctx.ellipse(0, 0, a, b, 0, -Math.PI / 2, Math.PI * 1.5)
    ctx.closePath()
    return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))
  }
  if (d.kind === 'polygon' || d.kind === 'star') {
    const n = clamp(Math.round(d.sides) || 5, 3, 40), count = d.kind === 'star' ? n * 2 : n
    const pts = []
    for (let i = 0; i < count; i++) {
      const ang = -Math.PI / 2 + i * 2 * Math.PI / count, r = d.kind === 'star' && i % 2 ? clamp(d.inner, 1, 100) / 100 : 1
      pts.push([Math.cos(ang) * w / 2 * r, Math.sin(ang) * h / 2 * r])
    }
    let len = 0
    pts.forEach((p, i) => { i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); const q = pts[(i + 1) % count]; len += Math.hypot(q[0] - p[0], q[1] - p[1]) })
    ctx.closePath()
    return len
  }
  if (d.kind === 'line') {
    ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0)
    return w
  }
  const r = clamp(d.radius || 0, 0, Math.min(w, h) / 2), x = w / 2, y = h / 2, P = Math.PI
  ctx.moveTo(0, -y)
  ctx.lineTo(x - r, -y); if (r) ctx.arc(x - r, -y + r, r, -P / 2, 0)
  ctx.lineTo(x, y - r); if (r) ctx.arc(x - r, y - r, r, 0, P / 2)
  ctx.lineTo(-x + r, y); if (r) ctx.arc(-x + r, y - r, r, P / 2, P)
  ctx.lineTo(-x, -y + r); if (r) ctx.arc(-x + r, -y + r, r, P, P * 1.5)
  ctx.closePath()
  return 2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * P * r
}

function drawShape(ctx, L, t) {
  const d = L.data
  const len = shapePath(ctx, d)
  if (d.fillOn && d.kind !== 'line') { ctx.fillStyle = d.fill; ctx.fill() }
  if (!(d.strokeWidth > 0)) return
  ctx.lineWidth = d.strokeWidth; ctx.strokeStyle = d.stroke; ctx.lineCap = d.cap || 'round'; ctx.lineJoin = 'round'
  const s = valueAt(L.props.trimStart, t), e = valueAt(L.props.trimEnd, t), off = valueAt(L.props.trimOffset, t)
  const span = clamp(Math.max(s, e) - Math.min(s, e), 0, 100)
  if (span <= 0.001) return
  if (span < 99.999 && len > 0) {
    const vis = span / 100 * len
    const start = ((((Math.min(s, e) + off) % 100) + 100) % 100) / 100 * len
    ctx.setLineDash([vis, Math.max(len - vis, 0.001)])
    ctx.lineDashOffset = -start
  }
  ctx.stroke()
  ctx.setLineDash([])
}

// ---------- text ----------
function drawText(ctx, L, t) {
  const d = L.data, lay = layoutText(d)
  ctx.font = fontString(d); ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.lineJoin = 'round'
  ctx.fillStyle = d.fill; ctx.strokeStyle = d.stroke; ctx.lineWidth = d.strokeWidth
  const ans = (L.animators || []).filter((a) => a.enabled).map((a) => animatorState(a, t, lay))
  const base = ctx.globalAlpha
  const stroke = d.strokeWidth > 0
  if (!ans.length && !d.tracking) {
    for (const ln of lay.lines) { if (stroke) ctx.strokeText(ln.text, ln.x0, ln.y); ctx.fillText(ln.text, ln.x0, ln.y) }
    return
  }
  for (const ln of lay.lines) {
    for (const c of ln.chars) {
      if (/\s/.test(c.ch)) continue
      let op = 1, dx = 0, dy = 0, sx = 1, sy = 1, rot = 0
      for (const a of ans) {
        const i = a.unit === 'words' ? c.wi : a.unit === 'lines' ? c.li : c.ci
        const k = a.amounts[Math.min(i, a.amounts.length - 1)]
        if (!k) continue
        op *= 1 + (a.opacity - 1) * k
        dx += a.position[0] * k; dy += a.position[1] * k
        sx *= 1 + (a.scale[0] / 100 - 1) * k; sy *= 1 + (a.scale[1] / 100 - 1) * k
        rot += a.rotation * k
      }
      if (op * base < 0.002 || (!sx && !sy)) continue
      ctx.save()
      ctx.translate(ln.x0 + c.x + c.w / 2 + dx, ln.y + dy)
      if (rot) ctx.rotate(rot * Math.PI / 180)
      ctx.scale(sx, sy)
      ctx.globalAlpha = base * clamp(op, 0, 1)
      if (stroke) ctx.strokeText(c.ch, -c.w / 2, 0)
      ctx.fillText(c.ch, -c.w / 2, 0)
      ctx.restore()
    }
  }
}

// ---------- effects ----------
function applyEffect(e, src, t, env) {
  const v = (k) => valueAt(e.params[k], t)
  const dst = acquire(env.W, env.H), d = dst.getContext('2d'), S = env.S
  if (e.type === 'blur') {
    const r = Math.max(0, v('radius')) * S
    d.filter = r > 0.05 ? `blur(${r}px)` : 'none'
    d.drawImage(src, 0, 0)
  } else if (e.type === 'shadow') {
    const a = v('angle') * Math.PI / 180, dist = v('distance') * S, [r, g, b] = hexRgb(e.opts.color)
    d.filter = `drop-shadow(${Math.cos(a) * dist}px ${Math.sin(a) * dist}px ${Math.max(0, v('blur')) * S}px rgba(${r},${g},${b},${clamp(v('opacity') / 100, 0, 1)}))`
    d.drawImage(src, 0, 0)
  } else if (e.type === 'color') {
    d.filter = `brightness(${v('brightness')}%) contrast(${v('contrast')}%) saturate(${v('saturation')}%) hue-rotate(${v('hue')}deg)`
    d.drawImage(src, 0, 0)
  } else if (e.type === 'glow') {
    const r = Math.max(0, v('radius')) * S, k = Math.max(0, v('intensity')) / 100
    let g = src, tint = null
    if (e.opts.color) {
      tint = acquire(env.W, env.H)
      const tc = tint.getContext('2d')
      tc.drawImage(src, 0, 0); tc.globalCompositeOperation = 'source-in'; tc.fillStyle = e.opts.color; tc.fillRect(0, 0, env.W, env.H)
      g = tint
    }
    d.filter = r > 0.05 ? `blur(${r}px)` : 'none'
    d.globalCompositeOperation = tint ? 'source-over' : 'lighter'
    for (let i = 0, n = Math.ceil(k); i < n; i++) { d.globalAlpha = clamp(k - i, 0, 1); d.drawImage(g, 0, 0) }
    d.globalAlpha = 1; d.filter = 'none'; d.globalCompositeOperation = 'source-over'
    d.drawImage(src, 0, 0)
    if (tint) release(tint)
  } else d.drawImage(src, 0, 0)
  return dst
}

// ---------- layers ----------
function drawContent(ctx, L, t, env, m) {
  ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5])
  const d = L.data
  if (L.type === 'solid') { ctx.fillStyle = d.color; ctx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h) }
  else if (L.type === 'shape') drawShape(ctx, L, t)
  else if (L.type === 'text') drawText(ctx, L, t)
  else if (L.type === 'image') {
    const img = env.assets.get(d.asset)?.img
    if (img) ctx.drawImage(img, -d.w / 2, -d.h / 2, d.w, d.h)
    else {
      ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 4; ctx.setLineDash([12, 8]); ctx.strokeRect(-d.w / 2, -d.h / 2, d.w, d.h); ctx.setLineDash([])
      ctx.beginPath(); ctx.moveTo(-d.w / 2, -d.h / 2); ctx.lineTo(d.w / 2, d.h / 2); ctx.moveTo(d.w / 2, -d.h / 2); ctx.lineTo(-d.w / 2, d.h / 2); ctx.stroke()
    }
  }
}

const visibleAt = (L, t) => L.visible && t >= L.inPoint - 1e-6 && t < L.outPoint - 1e-9

function drawList(ctx, layers, t, env, pm) {
  for (let i = layers.length - 1; i >= 0; i--) {
    const L = layers[i]
    if (visibleAt(L, t)) drawLayer(ctx, L, t, env, pm)
  }
}

function drawLayer(ctx, L, t, env, pm) {
  const op = clamp(valueAt(L.props.opacity, t) / 100, 0, 1)
  if (op <= 0) return
  const m = mul(pm, localMatrix(L, t))
  const fx = env.filters ? L.effects.filter((e) => e.enabled) : []
  const group = L.type === 'group'
  if (!fx.length && !(group && (op < 1 || L.blend !== 'source-over'))) {
    if (group) return drawList(ctx, L.children, t, env, m)
    ctx.save()
    ctx.globalAlpha = op
    ctx.globalCompositeOperation = L.blend
    drawContent(ctx, L, t, env, m)
    ctx.restore()
    return
  }
  let src = acquire(env.W, env.H)
  const actx = src.getContext('2d')
  if (group) drawList(actx, L.children, t, env, m)
  else drawContent(actx, L, t, env, m)
  actx.setTransform(1, 0, 0, 1, 0, 0)
  for (const e of fx) {
    const out = applyEffect(e, src, t, env)
    release(src)
    src = out
  }
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = op
  ctx.globalCompositeOperation = L.blend
  ctx.drawImage(src, 0, 0)
  ctx.restore()
  release(src)
}

/**
 * Render the composition at time t into ctx. The canvas size defines the output; scale = canvas width / comp width.
 * opts: {assets: Map(id -> {img}), flatten: '#000' (fill transparent background with this colour)}
 */
export function renderFrame(ctx, doc, t, opts = {}) {
  const { assets = new Map(), flatten } = opts
  const w = ctx.canvas.width, h = ctx.canvas.height, scale = w / doc.comp.width
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
  if (HAS_FILTER) ctx.filter = 'none'
  ctx.clearRect(0, 0, w, h)
  if (!doc.comp.transparent || flatten) { ctx.fillStyle = doc.comp.transparent ? flatten : doc.comp.bg; ctx.fillRect(0, 0, w, h) }
  drawList(ctx, doc.layers, t, { S: scale, W: w, H: h, assets, filters: HAS_FILTER }, [scale, 0, 0, scale, 0, 0])
  ctx.restore()
}

// ---------- bounds (selection, hit testing) ----------
/** Bounds of a layer in its own local space: {x, y, w, h}. Groups are the union of their visible children. */
export function localBounds(L, t) {
  const d = L.data
  if (L.type === 'text') { const l = layoutText(d); return { x: -l.width / 2, y: -l.height / 2, w: l.width, h: l.height } }
  if (L.type === 'group') {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const c of L.children) {
      if (!visibleAt(c, t)) continue
      const b = localBounds(c, t), m = localMatrix(c, t)
      for (const [px, py] of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]) {
        const [qx, qy] = apply(m, px, py)
        x0 = Math.min(x0, qx); y0 = Math.min(y0, qy); x1 = Math.max(x1, qx); y1 = Math.max(y1, qy)
      }
    }
    return x0 === Infinity ? { x: -50, y: -50, w: 100, h: 100 } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  }
  const pad = L.type === 'shape' ? (d.strokeWidth || 0) / 2 : 0
  const h = L.type === 'shape' && d.kind === 'line' ? 0 : d.h
  return { x: -d.w / 2 - pad, y: -h / 2 - pad, w: d.w + pad * 2, h: h + pad * 2 }
}
export { visibleAt }
