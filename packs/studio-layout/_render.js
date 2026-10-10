// Canvas renderer shared by the editor, thumbnails, PNG export and the high-quality raster PDF.
import { layoutStory } from './_text.js'
import { load, loadAll, isReady, hasFailed } from './_fonts.js'
import { storyChains, paintOrder, isLayerVisible, rad, center, containers } from './_model.js'
import { loadImage, toCanvas } from '../../lib/image.js'

export function rrect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r || 0, w / 2, h / 2))
  ctx.beginPath()
  if (!r) { ctx.rect(x, y, w, h); return }
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
export const dashPattern = (it) => (it.dash === 1 ? [it.sw * 3, it.sw * 2] : it.dash === 2 ? [0.01, it.sw * 2] : [])

/** Where the image sits inside its frame (frame-local coordinates) for the fit mode, zoom and offset. */
export function imageRect(it, iw, ih) {
  const fw = it.w, fh = it.h
  let sx, sy
  if (it.fit === 'stretch') { sx = fw / iw; sy = fh / ih } else { sx = sy = (it.fit === 'fit' ? Math.min : Math.max)(fw / iw, fh / ih) }
  const z = it.zoom || 1
  const w = iw * sx * z, h = ih * sy * z
  return { x: (fw - w) / 2 + (it.ox || 0), y: (fh - h) / 2 + (it.oy || 0), w, h }
}

/** Layout cache (per document version) and image cache for one store. */
export class Scene {
  constructor(store, onChange) {
    this.store = store
    this.onChange = onChange
    this.ver = -1
    this.cache = new Map()
    this.chains = null
    this.tokStories = new Map()
    this.requested = new Set()
    this.images = new Map()
  }
  get doc() { return this.store.doc }
  sync() {
    if (this.ver !== this.store.version) {
      this.ver = this.store.version
      this.cache.clear()
      this.chains = null
      this.tokStories.clear()
    }
  }
  hasTokens(sid) {
    let v = this.tokStories.get(sid)
    if (v === undefined) {
      v = !!this.doc.stories[sid]?.paras.some((p) => p.runs.some((r) => r.t.includes('{')))
      this.tokStories.set(sid, v)
    }
    return v
  }
  /** Lines for one text frame. tokens: {'#','total','title'} for page numbers on masters. */
  layout(frame, tokens) {
    this.sync()
    this.chains ||= storyChains(this.doc)
    const sid = frame.story
    const story = this.doc.stories[sid]
    if (!story) return { lines: [], overflow: false }
    let chain = this.chains.get(sid)
    if (!chain?.includes(frame)) chain = [frame]
    const key = this.hasTokens(sid) ? `${sid}|${tokens?.['#']}|${tokens?.total}|${tokens?.title}` : sid
    let r = this.cache.get(key)
    if (!r) {
      r = layoutStory(this.doc, story, chain, { tokens })
      this.cache.set(key, r)
      for (const f of r.missing.values()) {
        if (isReady(f) || hasFailed(f) || this.requested.has(f.key)) continue
        this.requested.add(f.key)
        load(f).then(() => this.onChange?.('fonts'))
      }
    }
    const fr = r.frames.get(frame.id)
    return { lines: fr?.lines || [], overflow: !!r.overflow && chain[chain.length - 1] === frame }
  }
  /** Decoded image for an asset: {img, prev, w, h} or null while loading. `prev` is a screen-size copy for fast drawing. */
  image(id) {
    let s = this.images.get(id)
    if (s) return s.img ? s : null
    const a = this.store.assets.get(id)
    if (!a) return null
    s = { status: 'loading' }
    this.images.set(id, s)
    loadImage(a.blob).then((img) => {
      s.img = img
      s.w = img.naturalWidth
      s.h = img.naturalHeight
      const big = Math.max(s.w, s.h)
      s.prev = big > 1800 ? toCanvas(img, Math.round((s.w * 1800) / big), Math.round((s.h * 1800) / big)) : img
      this.onChange?.('image')
    }).catch(() => { s.status = 'fail' })
    return null
  }
  forget(id) { this.images.delete(id) }
  whenImage(id) {
    return new Promise((resolve) => {
      const t0 = Date.now()
      const tick = () => {
        if (this.image(id) || this.images.get(id)?.status === 'fail' || !this.store.assets.has(id) || Date.now() - t0 > 20000) resolve()
        else setTimeout(tick, 30)
      }
      tick()
    })
  }
  /** Decode every placed image and load every font in use (exports call this first). Returns the faces that failed to load. */
  async preload() {
    const doc = this.doc
    const ids = new Set(), faces = new Map()
    for (const { c } of containers(doc)) for (const it of c.items) if (it.type === 'image' && it.asset) ids.add(it.asset)
    for (const [sid, chain] of storyChains(doc)) {
      const r = layoutStory(doc, doc.stories[sid], chain, { tokens: { '#': '1', total: '1', title: '' } })
      for (const [k, f] of r.missing) faces.set(k, f)
    }
    await Promise.all([loadAll([...faces.values()]), ...[...ids].map((id) => this.whenImage(id))])
    this.cache.clear()
    this.ver = -1
    return [...faces.values()].filter((f) => hasFailed(f))
  }
}

export const pageTokens = (doc, index, master) => ({ '#': master ? 'A' : String(index + 1), total: String(doc.pages.length), title: doc.name })

/**
 * Draw one page or master in page coordinates (0,0 = trim top-left). The caller sets the transform and clips.
 * opts: {tokens, exporting (no placeholders), full (use original images), skipStory (story id hidden while editing), master: container}
 */
export function drawPage(ctx, scene, container, opts = {}) {
  const doc = scene.doc
  const list = []
  const m = !opts.isMaster && container.master ? doc.masters.find((x) => x.id === container.master) : null
  if (m) list.push(...paintOrder(doc, m))
  list.push(...paintOrder(doc, container))
  for (const it of list) if (isLayerVisible(doc, it)) drawItem(ctx, scene, it, opts)
}

export function drawItem(ctx, scene, it, opts = {}) {
  ctx.save()
  if (it.opacity != null && it.opacity < 1) ctx.globalAlpha *= it.opacity
  if (it.rot) {
    const c = center(it)
    ctx.translate(c.x, c.y)
    ctx.rotate(rad(it.rot))
    ctx.translate(-c.x, -c.y)
  }
  const strokeIt = () => {
    if (it.stroke && it.sw > 0) {
      ctx.lineWidth = it.sw
      ctx.strokeStyle = it.stroke
      ctx.setLineDash(dashPattern(it))
      ctx.lineCap = it.dash === 2 ? 'round' : 'butt'
      ctx.stroke()
      ctx.setLineDash([])
    }
  }
  if (it.type === 'rect' || it.type === 'text' || it.type === 'image') {
    if (it.type === 'rect' || it.fill) {
      rrect(ctx, it.x, it.y, it.w, it.h, it.radius)
      if (it.fill) { ctx.fillStyle = it.fill; ctx.fill() }
      if (it.type === 'rect') strokeIt()
    }
  }
  if (it.type === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse(it.x + it.w / 2, it.y + it.h / 2, Math.abs(it.w / 2), Math.abs(it.h / 2), 0, 0, Math.PI * 2)
    if (it.fill) { ctx.fillStyle = it.fill; ctx.fill() }
    strokeIt()
  } else if (it.type === 'line') {
    ctx.beginPath()
    ctx.moveTo(it.x, it.y + it.h / 2)
    ctx.lineTo(it.x + it.w, it.y + it.h / 2)
    strokeIt()
  } else if (it.type === 'image') drawImageFrame(ctx, scene, it, opts)
  else if (it.type === 'text') {
    if (it.stroke && it.sw > 0) { rrect(ctx, it.x, it.y, it.w, it.h, it.radius); strokeIt() }
    if (!(opts.skipStory && opts.skipStory === it.story)) drawText(ctx, scene, it, opts)
  }
  ctx.restore()
}

function drawImageFrame(ctx, scene, it, opts) {
  const s = it.asset ? scene.image(it.asset) : null
  ctx.save()
  rrect(ctx, it.x, it.y, it.w, it.h, it.radius)
  ctx.clip()
  if (s) {
    const src = opts.full ? s.img : s.prev
    const r = imageRect(it, s.w, s.h)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(src, it.x + r.x, it.y + r.y, r.w, r.h)
  } else if (!opts.exporting) {
    ctx.fillStyle = it.fill ? 'rgba(0,0,0,0)' : 'rgba(120,120,140,.14)'
    ctx.fillRect(it.x, it.y, it.w, it.h)
    ctx.strokeStyle = 'rgba(120,120,140,.5)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(it.x, it.y); ctx.lineTo(it.x + it.w, it.y + it.h)
    ctx.moveTo(it.x + it.w, it.y); ctx.lineTo(it.x, it.y + it.h)
    ctx.stroke()
    const fs = Math.max(8, Math.min(14, it.w / 10))
    ctx.font = `600 ${fs}px sans-serif`
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(100,100,120,.9)'
    const label = it.asset ? 'Loading image' : 'Image frame'
    const tw = ctx.measureText(label).width
    ctx.save()
    ctx.fillStyle = 'rgba(255,255,255,.85)'
    ctx.fillRect(it.x + it.w / 2 - tw / 2 - 6, it.y + it.h / 2 - fs, tw + 12, fs * 1.9)
    ctx.restore()
    ctx.fillStyle = 'rgba(80,80,100,.95)'
    ctx.fillText(label, it.x + it.w / 2, it.y + it.h / 2 + fs * 0.35)
    ctx.textAlign = 'start'
  }
  ctx.restore()
  if (it.stroke && it.sw > 0) {
    rrect(ctx, it.x, it.y, it.w, it.h, it.radius)
    ctx.lineWidth = it.sw
    ctx.strokeStyle = it.stroke
    ctx.stroke()
  }
}

function drawLineText(ctx, f, line) {
  const ox = f.x + line.x, oy = f.y + line.y
  const paint = (text, st, x) => {
    ctx.font = st.font
    ctx.fillStyle = st.color
    if (st.tracking) {
      let cx = x
      for (const ch of text) { ctx.fillText(ch, cx, oy); cx += ctx.measureText(ch).width + (st.tracking * st.size) / 1000 }
    } else ctx.fillText(text, x, oy)
    if (st.u) {
      const w = (text.length ? ctx.measureText(text).width : 0) + (st.tracking * st.size * text.length) / 1000
      ctx.fillRect(x, oy + st.size * 0.1, w, Math.max(0.5, st.size / 18))
    }
  }
  if (line.marker) {
    const m = line.marker
    paint(m.text, m.st, f.x + m.x)
  }
  if (line.just) { for (const p of line.parts) if (!p.sp) paint(p.text, p.st, ox + p.x); return }
  // merge neighbours with the same style into one fillText
  let i = 0
  while (i < line.parts.length) {
    const p = line.parts[i]
    let text = p.text
    let j = i + 1
    while (j < line.parts.length && line.parts[j].st === p.st) { text += line.parts[j].text; j++ }
    if (!(p.sp && j === i + 1 && !p.st.u)) paint(text, p.st, ox + p.x)
    i = j
  }
}

function drawText(ctx, scene, it, opts) {
  const { lines } = scene.layout(it, opts.tokens)
  if (!lines.length) return
  ctx.save()
  rrect(ctx, it.x, it.y, it.w, it.h, it.radius)
  ctx.clip()
  ctx.fontKerning = 'none'
  ctx.textRendering = 'optimizeSpeed'
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'start'
  for (const line of lines) drawLineText(ctx, it, line)
  ctx.restore()
}

/** Render a page (or master) to a fresh canvas at `scale` px per point; bleed adds that margin on all sides. */
export function renderToCanvas(scene, container, { scale = 1, bleed = 0, index = 0, isMaster = false, background = '#ffffff', full = false } = {}) {
  const doc = scene.doc
  const W = Math.round((doc.w + 2 * bleed) * scale), H = Math.round((doc.h + 2 * bleed) * scale)
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, W, H)
  ctx.scale(scale, scale)
  ctx.translate(bleed, bleed)
  ctx.beginPath()
  ctx.rect(-bleed, -bleed, doc.w + 2 * bleed, doc.h + 2 * bleed)
  ctx.clip()
  drawPage(ctx, scene, container, { tokens: pageTokens(doc, index, isMaster), exporting: true, full, isMaster })
  return c
}
