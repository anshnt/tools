// Canvas compositor shared by the preview monitor and the exporter, so what you see is what you export.
// Everything is sized relative to the frame (percent of width or height), so any output resolution looks the same.

export function hexA(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  const n = m ? parseInt(m[1], 16) : 0
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
}

function wrap(g, text, maxW) {
  const lines = []
  for (const para of String(text).split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word
      if (line && g.measureText(test).width > maxW) { lines.push(line); line = word } else line = test
    }
    lines.push(line)
  }
  return lines
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath()
  if (g.roundRect) g.roundRect(x, y, w, h, r)
  else g.rect(x, y, w, h)
}

export function titleFont(c, H) {
  const px = Math.max(4, (c.size / 100) * H * (c.scale / 100))
  return { px, font: `${c.italic ? 'italic ' : ''}${c.bold ? 700 : 400} ${px}px ${c.font}` }
}

function drawTitle(g, W, H, c, alpha) {
  if (!c.text || alpha <= 0) return
  const { px, font } = titleFont(c, H)
  g.save()
  g.globalAlpha = alpha
  g.font = font
  g.textBaseline = 'middle'
  g.textAlign = 'center'
  const lines = wrap(g, c.text, W * 0.9)
  const lh = px * 1.22
  const total = lines.length * lh
  const bw = Math.max(...lines.map((l) => g.measureText(l).width), 1)
  g.translate(W / 2 + (c.x / 100) * W, H / 2 + (c.y / 100) * H)
  if (c.rot) g.rotate((c.rot * Math.PI) / 180)
  if (c.bgOpacity > 0) {
    const pad = px * 0.35
    g.fillStyle = hexA(c.bg, c.bgOpacity / 100)
    roundRect(g, -bw / 2 - pad, -total / 2 - pad * 0.5, bw + pad * 2, total + pad, px * 0.22)
    g.fill()
  }
  const ax = c.align === 'left' ? -bw / 2 : c.align === 'right' ? bw / 2 : 0
  g.textAlign = c.align === 'left' ? 'left' : c.align === 'right' ? 'right' : 'center'
  g.lineJoin = 'round'
  lines.forEach((l, i) => {
    const y = -total / 2 + lh * (i + 0.5)
    if (c.shadow) { g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = px * 0.14; g.shadowOffsetY = px * 0.04 }
    if (c.strokeW > 0) {
      g.lineWidth = (c.strokeW / 100) * px * 1.2
      g.strokeStyle = c.strokeColor
      g.strokeText(l, ax, y)
      g.shadowColor = 'transparent'
    }
    g.fillStyle = c.color
    g.fillText(l, ax, y)
    g.shadowColor = 'transparent'
  })
  g.restore()
}

function drawSource(g, W, H, s, c, alpha) {
  const k = (c.fit === 'cover' ? Math.max : Math.min)(W / s.w, H / s.h) * (c.scale / 100)
  const dw = s.w * k, dh = s.h * k
  g.save()
  g.globalAlpha = alpha
  if (c.bright !== 100 || c.contrast !== 100 || c.sat !== 100) g.filter = `brightness(${c.bright}%) contrast(${c.contrast}%) saturate(${c.sat}%)`
  g.translate(W / 2 + (c.x / 100) * W, H / 2 + (c.y / 100) * H)
  if (c.rot) g.rotate((c.rot * Math.PI) / 180)
  g.drawImage(s.src, -dw / 2, -dh / 2, dw, dh)
  g.restore()
}

/** Bounding box of a layer in frame pixels (used for the selection outline in the monitor). */
export function layerBox(g, W, H, c, src) {
  if (c.kind === 'title') {
    const { px, font } = titleFont(c, H)
    g.save(); g.font = font
    const lines = wrap(g, c.text || ' ', W * 0.9)
    const bw = Math.max(...lines.map((l) => g.measureText(l).width), 1) + px * 0.7
    g.restore()
    return { cx: W / 2 + (c.x / 100) * W, cy: H / 2 + (c.y / 100) * H, w: bw, h: lines.length * px * 1.22 + px * 0.35, rot: c.rot }
  }
  if (!src) return { cx: W / 2 + (c.x / 100) * W, cy: H / 2 + (c.y / 100) * H, w: W * 0.4, h: H * 0.4, rot: c.rot }
  const k = (c.fit === 'cover' ? Math.max : Math.min)(W / src.w, H / src.h) * (c.scale / 100)
  return { cx: W / 2 + (c.x / 100) * W, cy: H / 2 + (c.y / 100) * H, w: src.w * k, h: src.h * k, rot: c.rot }
}

/**
 * Paint one frame. `layers` come from layersAt(); getSource(layer) returns {src, w, h} (an image, canvas or video element) or null.
 */
export function drawFrame(g, W, H, project, layers, getSource) {
  g.save()
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.globalAlpha = 1
  g.filter = 'none'
  g.fillStyle = project.bg || '#000'
  g.fillRect(0, 0, W, H)
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  for (const L of layers) {
    const c = L.clip
    if (c.kind === 'title') drawTitle(g, W, H, c, L.alpha)
    else {
      const s = getSource(L)
      if (s && L.alpha > 0) drawSource(g, W, H, s, c, L.alpha)
    }
    if (L.dip > 0) {
      g.globalAlpha = Math.min(1, L.dip)
      g.fillStyle = '#000'
      g.fillRect(0, 0, W, H)
      g.globalAlpha = 1
    }
  }
  g.restore()
}
