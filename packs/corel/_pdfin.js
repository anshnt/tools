// PDF -> model, page by page, by replaying the pdf.js operator list: paths (fill, stroke, even-odd, dashes, caps, joins), clips,
// colours (any colour space arrives as RGB), opacity, axial and radial gradients, images, and text re-created as live text with the
// font name pdf.js reports. Best effort: soft masks, tiling patterns, stencil masks and exotic blend modes are noted and skipped.
import { pdfjs } from '../../lib/libs.js'
import { openPdf } from '../../lib/pdf.js'
import { I, mul, translate, meanScale, pathBBox, rectPath, mapPath } from './_model.js'

const FLIP = [1, 0, 0, -1, 0, 0]
const clone = (s) => ({ ...s, clips: [...s.clips] })

async function bitmapToHref(obj, maxSide = 4096) {
  const w = obj.width, h = obj.height
  const k = Math.min(1, maxSide / Math.max(w, h))
  const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k))
  const c = document.createElement('canvas')
  c.width = cw; c.height = ch
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (obj.bitmap) ctx.drawImage(obj.bitmap, 0, 0, cw, ch)
  else if (obj.data) {
    const rgba = new Uint8ClampedArray(w * h * 4), n = w * h, d = obj.data
    const kind = obj.kind ?? (d.length === n * 4 ? 3 : d.length === n * 3 ? 2 : 1)
    if (kind === 3) rgba.set(d.subarray(0, n * 4))
    else if (kind === 2) for (let i = 0, j = 0; i < n; i++, j += 3) { rgba[i * 4] = d[j]; rgba[i * 4 + 1] = d[j + 1]; rgba[i * 4 + 2] = d[j + 2]; rgba[i * 4 + 3] = 255 }
    else { const rowBytes = (w + 7) >> 3; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = d[y * rowBytes + (x >> 3)] & (128 >> (x & 7)) ? 255 : 0; const o = (y * w + x) * 4; rgba[o] = rgba[o + 1] = rgba[o + 2] = v; rgba[o + 3] = 255 } }
    const tmp = document.createElement('canvas')
    tmp.width = w; tmp.height = h
    tmp.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0)
    ctx.drawImage(tmp, 0, 0, cw, ch)
  } else return null
  return { href: c.toDataURL('image/png'), w: cw, h: ch }
}

const wait = (fn, ms = 4000) => new Promise((res) => { let done = false; const t = setTimeout(() => { if (!done) { done = true; res(null) } }, ms); try { fn((v) => { if (!done) { done = true; clearTimeout(t); res(v) } }) } catch { res(null) } })

/**
 * Convert PDF data (File, Blob or bytes). opts: {password, pages: [1-based], onProgress(fraction, text), signal}
 * Returns {pages: [{w, h, items}], warnings}.
 */
export async function pdfToDoc(data, { password, pages, onProgress, signal } = {}) {
  const lib = await pdfjs()
  const OPS = lib.OPS
  const doc = await openPdf(data, { password })
  const list = pages || Array.from({ length: doc.numPages }, (_, i) => i + 1)
  const warnings = new Set()
  const out = []
  for (let pi = 0; pi < list.length; pi++) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
    const page = await doc.getPage(list[pi])
    const vp = page.getViewport({ scale: 1 })
    const V = vp.transform
    const W = vp.width, H = vp.height
    const ol = await page.getOperatorList()
    const fonts = new Map()
    for (let i = 0; i < ol.fnArray.length; i++) {
      if (ol.fnArray[i] === OPS.setFont) {
        const id = ol.argsArray[i][0]
        if (!fonts.has(id)) fonts.set(id, await wait((cb) => page.commonObjs.get(id, cb)))
      }
    }
    const items = []
    let st = { ctm: I, fill: '#000000', stroke: '#000000', fillA: 1, strokeA: 1, lw: 1, cap: 0, join: 0, miter: 10, dash: [], dashPhase: 0, clips: [], fillGrad: null,
      font: null, fontId: null, fs: 12, tc: 0, tw: 0, th: 1, tl: 0, rise: 0, render: 0, tm: I, tlm: I }
    const stack = []
    const formStack = []
    let pendingClip = null
    const note = (s) => warnings.add(s)
    const M = () => mul(V, st.ctm)
    const pathFrom = (data) => {
      const d = []
      let cx = 0, cy = 0, sx = 0, sy = 0
      const m = M()
      const P = (x, y) => { const q = [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; return q }
      for (let i = 0; i < data.length;) {
        const op = data[i++]
        if (op === 0) { const q = P(data[i], data[i + 1]); i += 2; d.push(['M', q[0], q[1]]); cx = q[0]; cy = q[1]; sx = cx; sy = cy }
        else if (op === 1) { const q = P(data[i], data[i + 1]); i += 2; d.push(['L', q[0], q[1]]); cx = q[0]; cy = q[1] }
        else if (op === 2) { const a = P(data[i], data[i + 1]), b = P(data[i + 2], data[i + 3]), c = P(data[i + 4], data[i + 5]); i += 6; d.push(['C', a[0], a[1], b[0], b[1], c[0], c[1]]); cx = c[0]; cy = c[1] }
        else if (op === 3) { const q = P(data[i], data[i + 1]), e = P(data[i + 2], data[i + 3]); i += 4; d.push(['C', cx + (2 / 3) * (q[0] - cx), cy + (2 / 3) * (q[1] - cy), e[0] + (2 / 3) * (q[0] - e[0]), e[1] + (2 / 3) * (q[1] - e[1]), e[0], e[1]]); cx = e[0]; cy = e[1] }
        else if (op === 4) { d.push(['Z']); cx = sx; cy = sy }
        else break
      }
      return d
    }
    const covers = (d) => { const b = pathBBox(d); return b && b.x <= 0.5 && b.y <= 0.5 && b.x + b.w >= W - 0.5 && b.y + b.h >= H - 0.5 && d.length <= 6 }
    const addClip = (d, rule) => { if (d.length && !covers(d)) st.clips = [...st.clips, { d, rule }] }
    const withClip = (it) => (st.clips.length ? { ...it, clip: st.clips } : it)
    const strokeScale = () => meanScale(M())

    const paintPath = (d, opn) => {
      const doFill = [OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].includes(opn)
      const doStroke = [OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].includes(opn)
      const closes = [OPS.closeStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].includes(opn)
      const even = [OPS.eoFill, OPS.eoFillStroke, OPS.closeEOFillStroke].includes(opn)
      if (closes && d.length && d[d.length - 1][0] !== 'Z') d = [...d, ['Z']]
      const k = strokeScale()
      const fill = doFill ? st.fillGrad || st.fill : null
      const stroke = doStroke ? st.stroke : null
      if (!fill && !stroke) return
      items.push(withClip({ t: 'path', d, fill, fillOpacity: st.fillA, rule: even ? 'evenodd' : 'nonzero', stroke, strokeWidth: stroke ? Math.max(st.lw, 0) * k : 0, strokeOpacity: st.strokeA,
        cap: st.cap, join: st.join, miter: st.miter, dash: stroke && st.dash.length ? st.dash.map((v) => v * k) : null, dashOffset: st.dashPhase * k }))
    }

    const gradientOf = (pat, m) => {
      if (!Array.isArray(pat) || pat[0] !== 'RadialAxial') return null
      const stops = (pat[3] || []).map(([o, c]) => ({ o, c, a: 1 }))
      if (!stops.length) return null
      if (pat[1] === 'axial') return { g: 'linear', x1: pat[4][0], y1: pat[4][1], x2: pat[5][0], y2: pat[5][1], m, stops, spread: 'pad' }
      const [x0, y0] = pat[4], [x1, y1] = pat[5], r1 = pat[7] || pat[6] || 1
      return { g: 'radial', cx: x1, cy: y1, r: r1, fx: x0, fy: y0, m, stops, spread: 'pad' }
    }

    const showText = async (glyphs) => {
      if (st.render === 3 || !st.fontId) return
      const f = fonts.get(st.fontId) || {}
      let str = '', adv = 0
      for (const g of glyphs) {
        if (typeof g === 'number') { adv += (-g / 1000) * st.fs * st.th; continue }
        str += g.unicode || g.fontChar || ''
        adv += ((g.width || 0) / 1000 * st.fs + st.tc + (g.isSpace ? st.tw : 0)) * st.th
      }
      if (str.trim() && st.render !== 7) {
        const base = mul(V, mul(st.ctm, mul(st.tm, translate(0, st.rise))))
        const m = mul(mul(base, [st.th, 0, 0, 1, 0, 0]), FLIP)
        const name = f.name || ''
        items.push(withClip({ t: 'text', str, family: f.fallbackName || (/times|serif|georgia/i.test(name) ? 'serif' : /mono|courier/i.test(name) ? 'monospace' : 'sans-serif'), fontName: name,
          size: st.fs, bold: !!f.bold || /bold|black|heavy/i.test(name), italic: !!f.italic || /italic|oblique/i.test(name), fill: typeof st.fill === 'string' ? st.fill : '#000000', opacity: st.fillA, m }))
      }
      st.tm = mul(st.tm, translate(adv, 0))
    }

    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i], a = ol.argsArray[i]
      switch (fn) {
        case OPS.save: stack.push(clone(st)); break
        case OPS.restore: if (stack.length) st = stack.pop(); break
        case OPS.transform: st.ctm = mul(st.ctm, a); break
        case OPS.paintFormXObjectBegin:
          stack.push(clone(st)); formStack.push(stack.length)
          if (a[0]) st.ctm = mul(st.ctm, a[0])
          if (a[1]) addClip(pathFrom([0, a[1][0], a[1][1], 1, a[1][2], a[1][1], 1, a[1][2], a[1][3], 1, a[1][0], a[1][3], 4]), 'nonzero')
          break
        case OPS.paintFormXObjectEnd: if (formStack.pop() && stack.length) st = stack.pop(); break
        case OPS.setLineWidth: st.lw = a[0]; break
        case OPS.setLineCap: st.cap = a[0]; break
        case OPS.setLineJoin: st.join = a[0]; break
        case OPS.setMiterLimit: st.miter = a[0]; break
        case OPS.setDash: st.dash = (a[0] || []).length % 2 ? [...a[0], ...a[0]] : [...(a[0] || [])]; st.dashPhase = a[1] || 0; if (st.dash.every((v) => !v)) st.dash = []; break
        case OPS.setGState:
          for (const [k, v] of a[0]) {
            if (k === 'LW') st.lw = v; else if (k === 'LC') st.cap = v; else if (k === 'LJ') st.join = v; else if (k === 'ML') st.miter = v
            else if (k === 'D') { st.dash = (v[0] || []).length % 2 ? [...v[0], ...v[0]] : [...(v[0] || [])]; st.dashPhase = v[1] || 0 }
            else if (k === 'CA') st.strokeA = v; else if (k === 'ca') st.fillA = v
            else if (k === 'SMask' && v) note('Soft masks (fades and some shadows) were not carried over.')
            else if (k === 'BM' && v && v !== 'Normal') note('Blend modes were not carried over.')
          }
          break
        case OPS.setFillRGBColor: st.fill = a[0]; st.fillGrad = null; break
        case OPS.setStrokeRGBColor: st.stroke = a[0]; break
        case OPS.setFillTransparent: st.fill = null; st.fillGrad = null; break
        case OPS.setStrokeTransparent: st.stroke = null; break
        case OPS.setFillColorN:
          if (Array.isArray(a) && a[0] === 'RadialAxial') { st.fillGrad = gradientOf(a, V); st.fill = st.fillGrad?.stops?.[0]?.c || '#808080' }
          else if (Array.isArray(a) && a[0] === 'TilingPattern') { st.fill = '#cccccc'; st.fillGrad = null; note('Tiling pattern fills were replaced by a plain light grey.') }
          break
        case OPS.setStrokeColorN:
          if (Array.isArray(a) && a[0] === 'RadialAxial') st.stroke = a[3]?.[0]?.[1] || '#808080'
          else if (Array.isArray(a) && a[0] === 'TilingPattern') { st.stroke = '#808080'; note('Tiling pattern strokes were replaced by grey.') }
          break
        case OPS.shadingFill: {
          const pat = await wait((cb) => page.objs.get(a[0], cb))
          const g = gradientOf(pat, M())
          if (g) {
            const clipBox = st.clips.length ? st.clips.map((c) => pathBBox(c.d)).filter(Boolean).reduce((p, b) => (p ? { x: Math.max(p.x, b.x), y: Math.max(p.y, b.y), w: Math.min(p.x + p.w, b.x + b.w) - Math.max(p.x, b.x), h: Math.min(p.y + p.h, b.y + b.h) - Math.max(p.y, b.y) } : b), null) : { x: 0, y: 0, w: W, h: H }
            if (clipBox && clipBox.w > 0 && clipBox.h > 0) items.push(withClip({ t: 'path', d: rectPath(clipBox.x, clipBox.y, clipBox.w, clipBox.h), fill: g, fillOpacity: st.fillA, rule: 'nonzero', stroke: null, strokeWidth: 0 }))
          } else note('A shading fill could not be read and was skipped.')
          break
        }
        case OPS.constructPath: {
          const [op, args] = a
          const data = args?.[0]
          const d = data && data.length ? pathFrom(data) : []
          if (op === OPS.endPath) {
            if (pendingClip && d.length) addClip(d, pendingClip)
            pendingClip = null
          } else {
            if (d.length) paintPath(d, op)
            if (pendingClip && d.length) { addClip(d, pendingClip); pendingClip = null }
          }
          break
        }
        case OPS.clip: pendingClip = 'nonzero'; break
        case OPS.eoClip: pendingClip = 'evenodd'; break
        case OPS.paintImageXObject: case OPS.paintInlineImageXObject: case OPS.paintImageXObjectRepeat: {
          const img = fn === OPS.paintInlineImageXObject ? a[0] : await wait((cb) => (page.objs.has(a[0]) ? cb(page.objs.get(a[0])) : page.objs.get(a[0], cb)))
          const r = img && (await bitmapToHref(img))
          if (r) items.push(withClip({ t: 'image', href: r.href, w: r.w, h: r.h, opacity: st.fillA, m: mul(M(), [1, 0, 0, -1, 0, 1]) }))
          else note('An image could not be read and was skipped.')
          break
        }
        case OPS.paintSolidColorImageMask:
          items.push(withClip({ t: 'path', d: mapPath(rectPath(0, 0, 1, 1), M()), fill: st.fill, fillOpacity: st.fillA, rule: 'nonzero', stroke: null, strokeWidth: 0 }))
          break
        case OPS.paintImageMaskXObject: case OPS.paintImageMaskXObjectGroup: case OPS.paintImageMaskXObjectRepeat: note('Stencil image masks were skipped.'); break
        // text
        case OPS.beginText: st.tm = I; st.tlm = I; break
        case OPS.setFont: st.fontId = a[0]; st.fs = a[1]; break
        case OPS.setCharSpacing: st.tc = a[0]; break
        case OPS.setWordSpacing: st.tw = a[0]; break
        case OPS.setHScale: st.th = a[0] > 5 ? a[0] / 100 : a[0]; break
        case OPS.setLeading: st.tl = a[0]; break
        case OPS.setTextRise: st.rise = a[0]; break
        case OPS.setTextRenderingMode: st.render = a[0]; break
        case OPS.setTextMatrix: st.tm = st.tlm = a.length === 1 ? a[0] : a; break
        case OPS.moveText: st.tlm = mul(st.tlm, translate(a[0], a[1])); st.tm = st.tlm; break
        case OPS.setLeadingMoveText: st.tl = -a[1]; st.tlm = mul(st.tlm, translate(a[0], a[1])); st.tm = st.tlm; break
        case OPS.nextLine: st.tlm = mul(st.tlm, translate(0, -st.tl)); st.tm = st.tlm; break
        case OPS.showText: await showText(a[0]); break
        case OPS.showSpacedText: await showText(a[0]); break
        case OPS.nextLineShowText: st.tlm = mul(st.tlm, translate(0, -st.tl)); st.tm = st.tlm; await showText(a[0]); break
        case OPS.nextLineSetSpacingShowText: st.tw = a[0]; st.tc = a[1]; st.tlm = mul(st.tlm, translate(0, -st.tl)); st.tm = st.tlm; await showText(a[2]); break
        default: break
      }
      if (i % 400 === 399) { onProgress?.((pi + i / ol.fnArray.length) / list.length, `Reading page ${list[pi]} of ${doc.numPages}`); await new Promise((r) => setTimeout(r, 0)) }
    }
    out.push({ w: W, h: H, name: `Page ${list[pi]}`, items })
    page.cleanup()
    onProgress?.((pi + 1) / list.length, `Read page ${list[pi]}`)
  }
  warnings.add('Text was re-created as live text. Fonts that are not standard may look different; use "Convert text to outlines" for the exact letter shapes, or keep the original PDF.')
  return { pages: out, warnings: [...warnings], numPages: doc.numPages }
}
