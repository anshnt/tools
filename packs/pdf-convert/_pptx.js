// A PowerPoint (.pptx) renderer for the browser. Reads the Open XML package with JSZip and paints each slide on a canvas: backgrounds, master and
// layout shapes, placeholders with inherited position and text styles, text (runs, bullets, spacing, autofit), preset and custom shapes, pictures
// with cropping, tables, groups, connectors, simple charts and SmartArt drawings. It is an approximation of PowerPoint's layout, not a clone.
import { jszip } from '../../lib/libs.js'

const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const EMU_PT = 12700

// ---------------------------------------------------------------- xml helpers
const parseXml = (t) => new DOMParser().parseFromString(t, 'application/xml')
const kids = (el, name) => (el ? [...el.children].filter((c) => c.localName === name) : [])
const kid = (el, name) => (el ? [...el.children].find((c) => c.localName === name) || null : null)
const at = (el, ...names) => names.reduce((e, n) => kid(e, n), el)
const attr = (el, n, d) => { const v = el?.getAttribute(n); return v == null ? d : v }
const numAttr = (el, n, d = 0) => { const v = el?.getAttribute(n); return v == null || v === '' ? d : Number(v) }
const rid = (el, n = 'embed') => el?.getAttributeNS(NS_R, n) || el?.getAttribute(`r:${n}`) || null
const deep = (el, name) => (el ? [...el.getElementsByTagName('*')].filter((c) => c.localName === name) : [])

function resolvePath(base, target) {
  if (/^https?:/i.test(target)) return null
  const parts = (target.startsWith('/') ? target.slice(1) : `${base.replace(/[^/]*$/, '')}${target}`).split('/')
  const out = []
  for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.' && p !== '') out.push(p) }
  return out.join('/')
}

// ---------------------------------------------------------------- colors
const PRST = { black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255], yellow: [255, 255, 0], gray: [128, 128, 128], grey: [128, 128, 128], orange: [255, 165, 0], purple: [128, 0, 128], cyan: [0, 255, 255], magenta: [255, 0, 255], darkBlue: [0, 0, 139], darkRed: [139, 0, 0], darkGreen: [0, 100, 0], lightGray: [211, 211, 211], dkGray: [169, 169, 169] }
const hex = (v) => { const s = String(v || '000000').padStart(6, '0'); return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)] }
function rgb2hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2
  if (mx === mn) return [0, 0, l]
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
  const hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [hh / 6, s, l]
}
function hsl2rgb([h, s, l]) {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
  const f = (t) => { t = (t + 1) % 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p }
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]
}
const clamp01 = (v) => Math.min(1, Math.max(0, v))

/** Resolve the color child of `parent` (srgbClr, schemeClr, sysClr, prstClr, ...) with its transforms. -> {r,g,b,a} or null */
function colorOf(parent, env) {
  const c = parent && [...parent.children].find((x) => /Clr$/.test(x.localName))
  if (!c) return null
  const val = c.getAttribute('val')
  let rgb = [0, 0, 0]
  switch (c.localName) {
    case 'srgbClr': rgb = hex(val); break
    case 'sysClr': rgb = hex(c.getAttribute('lastClr') || (val === 'window' ? 'FFFFFF' : '000000')); break
    case 'prstClr': rgb = PRST[val] || [0, 0, 0]; break
    case 'scrgbClr': rgb = ['r', 'g', 'b'].map((k) => Math.round((numAttr(c, k) / 100000) * 255)); break
    case 'hslClr': rgb = hsl2rgb([numAttr(c, 'hue') / 21600000, numAttr(c, 'sat') / 100000, numAttr(c, 'lum') / 100000]); break
    case 'schemeClr': {
      if (val === 'phClr') rgb = env?.phClr || [0, 0, 0]
      else { const m = env?.clrMap?.[val] || val; rgb = env?.theme?.colors?.[m] || env?.theme?.colors?.[val] || [0, 0, 0] }
      break
    }
    default: break
  }
  let a = 1
  for (const t of c.children) {
    const v = numAttr(t, 'val') / 100000
    switch (t.localName) {
      case 'alpha': a = v; break
      case 'lumMod': { const [h, s, l] = rgb2hsl(rgb); rgb = hsl2rgb([h, s, clamp01(l * v)]); break }
      case 'lumOff': { const [h, s, l] = rgb2hsl(rgb); rgb = hsl2rgb([h, s, clamp01(l + v)]); break }
      case 'lum': { const [h, s] = rgb2hsl(rgb); rgb = hsl2rgb([h, s, clamp01(v)]); break }
      case 'satMod': { const [h, s, l] = rgb2hsl(rgb); rgb = hsl2rgb([h, clamp01(s * v), l]); break }
      case 'satOff': { const [h, s, l] = rgb2hsl(rgb); rgb = hsl2rgb([h, clamp01(s + v), l]); break }
      case 'sat': { const [h, , l] = rgb2hsl(rgb); rgb = hsl2rgb([h, clamp01(v), l]); break }
      case 'hueOff': { const [h, s, l] = rgb2hsl(rgb); rgb = hsl2rgb([(h + numAttr(t, 'val') / 21600000 + 1) % 1, s, l]); break }
      case 'tint': rgb = rgb.map((x) => x * v + 255 * (1 - v)); break
      case 'shade': rgb = rgb.map((x) => x * v); break
      case 'inv': rgb = rgb.map((x) => 255 - x); break
      case 'gray': { const y = 0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2]; rgb = [y, y, y]; break }
      default: break
    }
  }
  return { r: Math.round(rgb[0]), g: Math.round(rgb[1]), b: Math.round(rgb[2]), a, rgb }
}
const css = (c, alphaMul = 1) => (c ? `rgba(${c.r},${c.g},${c.b},${(c.a ?? 1) * alphaMul})` : 'transparent')

// ---------------------------------------------------------------- package
export async function openPptx(buffer) {
  const JSZip = await jszip()
  let zip
  try { zip = await JSZip.loadAsync(buffer) } catch { throw new Error('This file is not a valid .pptx. Old .ppt files must be saved as .pptx in PowerPoint first.') }
  const textCache = new Map(), xmlCache = new Map(), relCache = new Map(), imgCache = new Map()
  const text = (p) => { if (!textCache.has(p)) textCache.set(p, zip.file(p) ? zip.file(p).async('string') : Promise.resolve(null)); return textCache.get(p) }
  const xml = async (p) => { if (!xmlCache.has(p)) xmlCache.set(p, text(p).then((t) => (t ? parseXml(t) : null))); return xmlCache.get(p) }
  const rels = async (p) => {
    if (!relCache.has(p)) {
      relCache.set(p, (async () => {
        const rp = p.replace(/([^/]*)$/, '_rels/$1.rels')
        const d = await xml(rp)
        const m = new Map()
        if (d) for (const r of d.getElementsByTagName('Relationship')) if (r.getAttribute('TargetMode') !== 'External') m.set(r.getAttribute('Id'), { type: r.getAttribute('Type'), path: resolvePath(p, r.getAttribute('Target')) })
        return m
      })())
    }
    return relCache.get(p)
  }
  const pres = await xml('ppt/presentation.xml')
  if (!pres) throw new Error('This does not look like a PowerPoint (.pptx) file.')
  const sz = pres.getElementsByTagNameNS('*', 'sldSz')[0]
  const width = numAttr(sz, 'cx', 9144000), height = numAttr(sz, 'cy', 6858000)
  const presRels = await rels('ppt/presentation.xml')
  const slideRefs = deep(pres, 'sldId').map((s) => presRels.get(rid(s, 'id'))?.path).filter(Boolean)
  const defaultTextStyle = at(pres.documentElement, 'defaultTextStyle')

  const themeCache = new Map()
  async function themeFor(masterPath) {
    if (themeCache.has(masterPath)) return themeCache.get(masterPath)
    const r = await rels(masterPath)
    const tp = [...r.values()].find((x) => /theme$/.test(x.type))?.path
    const d = tp ? await xml(tp) : null
    const t = { colors: { dk1: [0, 0, 0], lt1: [255, 255, 255], dk2: [68, 84, 106], lt2: [231, 230, 230], accent1: [68, 114, 196], accent2: [237, 125, 49], accent3: [165, 165, 165], accent4: [255, 192, 0], accent5: [91, 155, 213], accent6: [112, 173, 71], hlink: [5, 99, 193], folHlink: [149, 79, 114] }, major: 'Calibri Light', minor: 'Calibri', fills: [], lines: [], bgFills: [] }
    if (d) {
      const cs = deep(d, 'clrScheme')[0]
      for (const c of cs ? cs.children : []) { const x = colorOf(c, {}); if (x) t.colors[c.localName] = x.rgb.map(Math.round) }
      t.major = attr(at(deep(d, 'majorFont')[0], 'latin') || deep(d, 'majorFont')[0]?.firstElementChild, 'typeface', t.major)
      t.minor = attr(deep(d, 'minorFont')[0] && kid(deep(d, 'minorFont')[0], 'latin'), 'typeface', t.minor)
      const fmt = deep(d, 'fmtScheme')[0]
      t.fills = [...(kid(fmt, 'fillStyleLst')?.children || [])]
      t.lines = [...(kid(fmt, 'lnStyleLst')?.children || [])]
      t.bgFills = [...(kid(fmt, 'bgFillStyleLst')?.children || [])]
    }
    themeCache.set(masterPath, t)
    return t
  }

  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' }
  async function image(path) {
    if (!path) return null
    if (!imgCache.has(path)) {
      imgCache.set(path, (async () => {
        const f = zip.file(path)
        const ext = path.split('.').pop().toLowerCase()
        if (!f || !MIME[ext]) return null
        try { return await createImageBitmap(new Blob([await f.async('uint8array')], { type: MIME[ext] })) } catch { return null }
      })())
    }
    return imgCache.get(path)
  }

  const slideCache = new Map()
  async function loadSlide(i) {
    if (slideCache.has(i)) return slideCache.get(i)
    const p = (async () => {
      const path = slideRefs[i]
      const doc = await xml(path)
      const r = await rels(path)
      const layoutPath = [...r.values()].find((x) => /slideLayout$/.test(x.type))?.path
      const layout = layoutPath ? await xml(layoutPath) : null
      const lr = layoutPath ? await rels(layoutPath) : new Map()
      const masterPath = [...lr.values()].find((x) => /slideMaster$/.test(x.type))?.path
      const master = masterPath ? await xml(masterPath) : null
      const theme = masterPath ? await themeFor(masterPath) : (await themeFor('ppt/slideMasters/slideMaster1.xml'))
      const clrMap = {}
      const cm = master && at(master.documentElement, 'clrMap')
      for (const a of cm?.attributes || []) clrMap[a.name] = a.value
      return { path, doc, rels: r, layout, layoutPath, layoutRels: lr, master, masterPath, masterRels: masterPath ? await rels(masterPath) : new Map(), theme, clrMap: Object.keys(clrMap).length ? clrMap : { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' } }
    })()
    slideCache.set(i, p)
    return p
  }

  const api = {
    width, height, count: slideRefs.length,
    async info(i) {
      const s = await loadSlide(i)
      const root = s.doc.documentElement
      const titles = deep(s.doc, 'sp').map((sp) => ({ ph: attr(deep(sp, 'ph')[0], 'type', null), t: deep(sp, 't').map((x) => x.textContent).join(' ').trim() })).filter((x) => x.t)
      return { hidden: root.getAttribute('show') === '0', title: (titles.find((x) => /title/i.test(x.ph || '')) || titles[0])?.t || '' }
    },
    async notes(i) {
      const s = await loadSlide(i)
      const np = [...s.rels.values()].find((x) => /notesSlide$/.test(x.type))?.path
      const d = np ? await xml(np) : null
      if (!d) return ''
      return deep(d, 'sp').filter((sp) => attr(deep(sp, 'ph')[0], 'type', '') === 'body').map((sp) => kids(kid(sp, 'txBody'), 'p').map((p) => deep(p, 't').map((t) => t.textContent).join('')).join('\n')).join('\n').trim()
    },
    /** render(i, {widthPx}) -> {canvas, items: [{text, x, y, size, w}] (px, baseline), warnings} */
    async render(i, { widthPx = 1280 } = {}) {
      const s = await loadSlide(i)
      const k = widthPx / width
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(width * k)
      canvas.height = Math.round(height * k)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      const stats = { pictures: 0 }
      const env = { zip, ctx, k, s, stats, theme: s.theme, clrMap: s.clrMap, items: [], warnings: new Set(), image, xml, rels, text, W: width, H: height, defaultTextStyle, notesAuto: 0 }
      try { await paintSlide(env) } catch (e) { env.warnings.add(`Part of the slide could not be drawn (${e.message})`) }
      return { canvas, items: env.items, warnings: [...env.warnings], hasPictures: stats.pictures > 0 }
    },
    close() { textCache.clear(); xmlCache.clear(); relCache.clear(); for (const v of imgCache.values()) v.then((b) => b?.close?.()); imgCache.clear(); slideCache.clear() },
  }
  return api
}

// ---------------------------------------------------------------- painting a slide
async function paintSlide(env) {
  const { s, ctx } = env
  const sldEnv = { ...env, rels: s.rels, part: s.path, clrMap: s.clrMap }
  // background: slide, then layout, then master
  const bgNode = [s.doc, s.layout, s.master].map((d) => d && at(d.documentElement, 'cSld', 'bg')).find(Boolean)
  const bgEnv = { ...env, rels: bgNode && s.doc && at(s.doc.documentElement, 'cSld', 'bg') === bgNode ? s.rels : bgNode && s.layout && at(s.layout.documentElement, 'cSld', 'bg') === bgNode ? s.layoutRels : s.masterRels }
  if (bgNode) await paintBackground(bgNode, bgEnv)
  const root = s.doc.documentElement
  const showMaster = root.getAttribute('showMasterSp') !== '0' && (!s.layout || s.layout.documentElement.getAttribute('showMasterSp') !== '0')
  const tree = (d) => d && at(d.documentElement, 'cSld', 'spTree')
  const ident = { sx: env.k, sy: env.k, tx: 0, ty: 0 }
  if (showMaster && s.master) await paintTree(tree(s.master), ident, { ...env, rels: s.masterRels, part: s.masterPath, skipPh: true })
  if (s.layout) await paintTree(tree(s.layout), ident, { ...env, rels: s.layoutRels, part: s.layoutPath, skipPh: true })
  await paintTree(tree(s.doc), ident, sldEnv)
}

async function paintBackground(bg, env) {
  const { ctx } = env
  const W = ctx.canvas.width, H = ctx.canvas.height
  const pr = kid(bg, 'bgPr')
  let fill = null
  if (pr) fill = fillOf(pr, env)
  else {
    const ref = kid(bg, 'bgRef')
    if (ref) {
      const idx = numAttr(ref, 'idx')
      const phClr = colorOf(ref, env)?.rgb
      const node = idx >= 1001 ? env.theme.bgFills[idx - 1001] : env.theme.fills[idx - 1]
      if (node) fill = fillOf({ children: [node] }, { ...env, phClr })
    }
  }
  if (fill) await applyFill(env, fill, { x: 0, y: 0, w: W, h: H }, () => { ctx.beginPath(); ctx.rect(0, 0, W, H) })
}

/** Fill descriptor from the children of a spPr / bgPr: {kind: 'none'|'solid'|'grad'|'blip', ...} or undefined to inherit. */
function fillOf(spPr, env, depth = 0) {
  for (const c of spPr.children) {
    switch (c.localName) {
      case 'noFill': return { kind: 'none' }
      case 'solidFill': { const col = colorOf(c, env); return col ? { kind: 'solid', color: col } : undefined }
      case 'gradFill': {
        const stops = deep(c, 'gs').map((g) => ({ pos: numAttr(g, 'pos') / 100000, color: colorOf(g, env) })).filter((x) => x.color).sort((a, b) => a.pos - b.pos)
        const lin = kid(c, 'lin'), path = kid(c, 'path')
        return { kind: 'grad', stops, angle: lin ? numAttr(lin, 'ang') / 60000 : 90, radial: !!path }
      }
      case 'blipFill': return { kind: 'blip', rid: rid(kid(c, 'blip')), tile: !!kid(c, 'tile'), src: kid(c, 'srcRect'), alpha: numAttr(deep(c, 'alphaModFix')[0], 'amt', 100000) / 100000 }
      case 'pattFill': { const fg = colorOf(kid(c, 'fgClr'), env), bgc = colorOf(kid(c, 'bgClr'), env); return fg ? { kind: 'solid', color: { ...fg, r: Math.round((fg.r + (bgc?.r ?? 255)) / 2), g: Math.round((fg.g + (bgc?.g ?? 255)) / 2), b: Math.round((fg.b + (bgc?.b ?? 255)) / 2) } } : undefined }
      default: break
    }
  }
  return undefined
}

async function applyFill(env, fill, box, buildPath) {
  const { ctx } = env
  if (!fill || fill.kind === 'none') return
  ctx.save()
  buildPath()
  if (fill.kind === 'solid') { ctx.fillStyle = css(fill.color); ctx.fill() }
  else if (fill.kind === 'grad') {
    const st = fill.stops
    if (st.length) {
      let g
      if (fill.radial) g = ctx.createRadialGradient(box.x + box.w / 2, box.y + box.h / 2, 0, box.x + box.w / 2, box.y + box.h / 2, Math.max(box.w, box.h) / 2)
      else {
        const a = (fill.angle * Math.PI) / 180
        const dx = Math.cos(a), dy = Math.sin(a)
        const half = (Math.abs(box.w * dx) + Math.abs(box.h * dy)) / 2
        const cx = box.x + box.w / 2, cy = box.y + box.h / 2
        g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half)
      }
      for (const stp of st) g.addColorStop(Math.min(1, Math.max(0, stp.pos)), css(stp.color))
      ctx.fillStyle = g
      ctx.fill()
    }
  } else if (fill.kind === 'blip') {
    const path = env.rels?.get(fill.rid)?.path
    const bmp = await env.image(path)
    if (bmp) {
      ctx.clip()
      ctx.globalAlpha = fill.alpha
      drawBitmap(ctx, bmp, box, fill.src)
    }
  }
  ctx.restore()
}

function drawBitmap(ctx, bmp, box, src) {
  let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height
  if (src) {
    const l = numAttr(src, 'l') / 100000, t = numAttr(src, 't') / 100000, r = numAttr(src, 'r') / 100000, b = numAttr(src, 'b') / 100000
    sx = bmp.width * l; sy = bmp.height * t; sw = bmp.width * (1 - l - r); sh = bmp.height * (1 - t - b)
  }
  if (sw > 0 && sh > 0) ctx.drawImage(bmp, sx, sy, sw, sh, box.x, box.y, box.w, box.h)
}

/** Outline from spPr/ln or the style reference. -> {w (px), color, dash, head, tail} or null */
function lineOf(spPr, style, env) {
  const ln = kid(spPr, 'ln')
  const ref = kid(style, 'lnRef')
  let w = ln?.getAttribute('w') != null ? Number(ln.getAttribute('w')) : null
  let fill = ln ? fillOf(ln, env) : undefined
  let node = null
  if (ref && numAttr(ref, 'idx') > 0 && (!ln || fill === undefined)) {
    node = env.theme.lines[numAttr(ref, 'idx') - 1]
    if (node) {
      const phClr = colorOf(ref, env)?.rgb
      if (w == null) w = numAttr(node, 'w', 9525)
      if (fill === undefined) fill = fillOf(node, { ...env, phClr })
    }
  }
  if (!fill || fill.kind === 'none') return null
  const src = ln || node
  const dashName = attr(kid(src, 'prstDash'), 'val', 'solid')
  const color = fill.kind === 'solid' ? fill.color : fill.kind === 'grad' ? fill.stops[0]?.color : null
  if (!color) return null
  return { w: w ?? 9525, color, dash: dashName, head: attr(kid(src, 'headEnd'), 'type', 'none'), tail: attr(kid(src, 'tailEnd'), 'type', 'none'), cap: attr(src, 'cap', 'flat') }
}
const DASHES = { dash: [4, 3], sysDash: [3, 1], dot: [1, 2], sysDot: [1, 1], lgDash: [8, 3], dashDot: [4, 3, 1, 3], lgDashDot: [8, 3, 1, 3], lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDashDot: [3, 1, 1, 1], sysDashDotDot: [3, 1, 1, 1, 1, 1] }

// ---------------------------------------------------------------- shape tree
function xfrmOf(spPr) { return xfrmFrom(kid(spPr, 'xfrm')) }
function xfrmFrom(x) {
  if (!x) return null
  const off = kid(x, 'off'), ext = kid(x, 'ext')
  return { x: numAttr(off, 'x'), y: numAttr(off, 'y'), w: numAttr(ext, 'cx'), h: numAttr(ext, 'cy'), rot: numAttr(x, 'rot') / 60000, flipH: x.getAttribute('flipH') === '1', flipV: x.getAttribute('flipV') === '1', chOff: kid(x, 'chOff'), chExt: kid(x, 'chExt') }
}

async function paintTree(tree, m, env) {
  if (!tree) return
  for (const node of tree.children) {
    try {
      switch (node.localName) {
        case 'sp': case 'cxnSp': if (!(env.skipPh && deep(node, 'ph').length)) await paintShape(node, m, env); break
        case 'pic': await paintPicture(node, m, env); break
        case 'grpSp': await paintGroup(node, m, env); break
        case 'graphicFrame': await paintFrame(node, m, env); break
        default: break
      }
    } catch (e) { env.warnings.add(`One ${node.localName} could not be drawn`) }
  }
}

async function paintGroup(node, m, env) {
  const spPr = kid(node, 'grpSpPr')
  const x = xfrmOf(spPr)
  if (!x) return paintTree(node, m, env)
  const chOff = x.chOff ? { x: numAttr(x.chOff, 'x'), y: numAttr(x.chOff, 'y') } : { x: x.x, y: x.y }
  const chExt = x.chExt ? { w: numAttr(x.chExt, 'cx') || x.w || 1, h: numAttr(x.chExt, 'cy') || x.h || 1 } : { w: x.w || 1, h: x.h || 1 }
  const gx = m.sx * x.x + m.tx, gy = m.sy * x.y + m.ty, gw = m.sx * x.w, gh = m.sy * x.h
  const sx = gw / chExt.w, sy = gh / chExt.h
  const child = { sx, sy, tx: gx - chOff.x * sx, ty: gy - chOff.y * sy }
  const { ctx } = env
  ctx.save()
  if (x.rot || x.flipH || x.flipV) {
    ctx.translate(gx + gw / 2, gy + gh / 2)
    if (x.rot) ctx.rotate((x.rot * Math.PI) / 180)
    ctx.scale(x.flipH ? -1 : 1, x.flipV ? -1 : 1)
    ctx.translate(-(gx + gw / 2), -(gy + gh / 2))
  }
  await paintTree(node, child, env)
  ctx.restore()
}

/** Find the layout and master placeholder that a slide placeholder inherits from. */
function inheritedPh(node, env) {
  const ph = deep(node, 'ph')[0]
  if (!ph) return {}
  const type = attr(ph, 'type', 'body'), idx = ph.getAttribute('idx')
  const norm = (t) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' ? 'body' : t)
  const find = (doc) => {
    if (!doc) return null
    const sps = deep(at(doc.documentElement, 'cSld', 'spTree'), 'sp')
    return sps.find((sp) => { const p = deep(sp, 'ph')[0]; return p && idx != null && p.getAttribute('idx') === idx && (idx !== '0' || norm(attr(p, 'type', 'body')) === norm(type)) })
      || sps.find((sp) => { const p = deep(sp, 'ph')[0]; return p && norm(attr(p, 'type', 'body')) === norm(type) && (idx == null || type !== 'body') })
  }
  const layoutSp = env.part === env.s.path ? find(env.s.layout) : null
  const masterSp = find(env.s.master)
  return { type: norm(type), layoutSp, masterSp }
}

const PATHS = {}
function polyPath(pts) { const p = new Path2D(); pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); p.closePath(); return p }
function starPath(n, w, h, inner = 0.382) {
  const pts = []
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? inner : 1, a = (Math.PI * i) / n - Math.PI / 2
    pts.push([w / 2 + (Math.cos(a) * r * w) / 2, h / 2 + (Math.sin(a) * r * h) / 2])
  }
  return polyPath(pts)
}

/** Path for a preset geometry in a w x h box (px), top-left origin. */
function presetPath(name, w, h, av) {
  const adj = (n, d) => (av[n] != null ? av[n] : d) / 100000
  const ss = Math.min(w, h)
  const p = new Path2D()
  switch (name) {
    case 'ellipse': case 'flowChartConnector': case 'flowChartOr': case 'flowChartSummingJunction': case 'cloud': case 'sun': case 'smileyFace': case 'noSmoking': case 'chord': case 'pie': case 'blockArc': case 'arc':
      p.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); return p
    case 'roundRect': case 'flowChartAlternateProcess': case 'wedgeRoundRectCallout': case 'round2SameRect': case 'round1Rect': case 'round2DiagRect': case 'snipRoundRect': case 'plaque': { const r = ss * Math.min(0.5, adj('adj', name === 'flowChartAlternateProcess' ? 16667 : name === 'plaque' ? 16667 : 16667)); p.roundRect(0, 0, w, h, r); return p }
    case 'flowChartTerminator': p.roundRect(0, 0, w, h, h / 2); return p
    case 'snip1Rect': case 'snip2SameRect': case 'snip2DiagRect': { const c = ss * Math.min(0.5, adj('adj1', 16667)); return polyPath([[0, 0], [w - c, 0], [w, c], [w, h], [0, h]]) }
    case 'triangle': return polyPath([[w * adj('adj', 50000), 0], [w, h], [0, h]])
    case 'rtTriangle': return polyPath([[0, 0], [0, h], [w, h]])
    case 'diamond': case 'flowChartDecision': return polyPath([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]])
    case 'parallelogram': case 'flowChartData': { const o = ss * adj('adj', 25000) * (w / ss > 1 ? 1 : 1); return polyPath([[o, 0], [w, 0], [w - o, h], [0, h]]) }
    case 'trapezoid': case 'flowChartManualOperation': { const o = ss * adj('adj', 25000); return polyPath([[o, 0], [w - o, 0], [w, h], [0, h]]) }
    case 'pentagon': case 'regularPentagon': return polyPath([[w / 2, 0], [w, h * 0.38], [w * 0.81, h], [w * 0.19, h], [0, h * 0.38]])
    case 'hexagon': case 'flowChartPreparation': { const o = ss * adj('adj', 25000); return polyPath([[o, 0], [w - o, 0], [w, h / 2], [w - o, h], [o, h], [0, h / 2]]) }
    case 'octagon': { const o = ss * adj('adj', 29289); return polyPath([[o, 0], [w - o, 0], [w, o], [w, h - o], [w - o, h], [o, h], [0, h - o], [0, o]]) }
    case 'star4': return starPath(4, w, h, 0.38)
    case 'star5': return starPath(5, w, h)
    case 'star6': return starPath(6, w, h, 0.5)
    case 'star8': return starPath(8, w, h, 0.7)
    case 'star10': return starPath(10, w, h, 0.7)
    case 'star12': return starPath(12, w, h, 0.8)
    case 'rightArrow': case 'leftArrow': case 'upArrow': case 'downArrow': case 'notchedRightArrow': {
      const vert = name === 'upArrow' || name === 'downArrow'
      const L = vert ? h : w, T = vert ? w : h
      const sh = T * adj('adj1', 50000), hl = Math.min(L, Math.min(L, T) * adj('adj2', 50000))
      let pts = [[0, (T - sh) / 2], [L - hl, (T - sh) / 2], [L - hl, 0], [L, T / 2], [L - hl, T], [L - hl, (T + sh) / 2], [0, (T + sh) / 2]]
      if (name === 'leftArrow' || name === 'upArrow') pts = pts.map(([x, y]) => [L - x, y])
      if (vert) pts = pts.map(([x, y]) => [y, x])
      return polyPath(pts)
    }
    case 'leftRightArrow': { const sh = h * adj('adj1', 50000), hl = Math.min(w / 2, ss * adj('adj2', 50000)); return polyPath([[0, h / 2], [hl, 0], [hl, (h - sh) / 2], [w - hl, (h - sh) / 2], [w - hl, 0], [w, h / 2], [w - hl, h], [w - hl, (h + sh) / 2], [hl, (h + sh) / 2], [hl, h]]) }
    case 'chevron': { const o = ss * adj('adj', 50000); return polyPath([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h], [o, h / 2]]) }
    case 'homePlate': { const o = ss * adj('adj', 50000); return polyPath([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h]]) }
    case 'plus': case 'mathPlus': { const t = ss * adj('adj', 25000); return polyPath([[t, 0], [w - t, 0], [w - t, t], [w, t], [w, h - t], [w - t, h - t], [w - t, h], [t, h], [t, h - t], [0, h - t], [0, t], [t, t]]) }
    case 'donut': { const t = ss * adj('adj', 25000); p.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); p.ellipse(w / 2, h / 2, Math.max(1, w / 2 - t), Math.max(1, h / 2 - t), 0, 0, Math.PI * 2, true); return p }
    case 'heart': { p.moveTo(w / 2, h); p.bezierCurveTo(-w * 0.15, h * 0.55, w * 0.1, -h * 0.1, w / 2, h * 0.28); p.bezierCurveTo(w * 0.9, -h * 0.1, w * 1.15, h * 0.55, w / 2, h); return p }
    case 'line': case 'straightConnector1': p.moveTo(0, 0); p.lineTo(w, h); return p
    case 'bentConnector2': p.moveTo(0, 0); p.lineTo(w, 0); p.lineTo(w, h); return p
    case 'bentConnector3': case 'bentConnector4': case 'bentConnector5': { const x = w * adj('adj1', 50000); p.moveTo(0, 0); p.lineTo(x, 0); p.lineTo(x, h); p.lineTo(w, h); return p }
    case 'curvedConnector2': case 'curvedConnector3': case 'curvedConnector4': case 'curvedConnector5': p.moveTo(0, 0); p.bezierCurveTo(w / 2, 0, w / 2, h, w, h); return p
    case 'flowChartDocument': p.moveTo(0, 0); p.lineTo(w, 0); p.lineTo(w, h * 0.85); p.bezierCurveTo(w * 0.7, h * 0.7, w * 0.3, h * 1.05, 0, h * 0.85); p.closePath(); return p
    case 'can': case 'flowChartMagneticDisk': { const e = h * 0.14; p.ellipse(w / 2, e, w / 2, e, 0, 0, Math.PI * 2); p.moveTo(0, e); p.lineTo(0, h - e); p.ellipse(w / 2, h - e, w / 2, e, 0, Math.PI, 0, true); p.lineTo(w, e); return p }
    default: p.rect(0, 0, w, h); return p
  }
}

/** Custom geometry (a:custGeom) -> Path2D scaled to w x h. */
function customPath(cg, w, h) {
  const p = new Path2D()
  for (const path of kids(kid(cg, 'pathLst'), 'path')) {
    const pw = numAttr(path, 'w') || w, ph = numAttr(path, 'h') || h
    const sx = w / pw, sy = h / ph
    const pt = (n) => [numAttr(n, 'x') * sx, numAttr(n, 'y') * sy]
    let cur = [0, 0]
    for (const c of path.children) {
      switch (c.localName) {
        case 'moveTo': { cur = pt(kid(c, 'pt')); p.moveTo(...cur); break }
        case 'lnTo': { cur = pt(kid(c, 'pt')); p.lineTo(...cur); break }
        case 'cubicBezTo': { const q = kids(c, 'pt').map(pt); p.bezierCurveTo(...q[0], ...q[1], ...q[2]); cur = q[2]; break }
        case 'quadBezTo': { const q = kids(c, 'pt').map(pt); p.quadraticCurveTo(...q[0], ...q[1]); cur = q[1]; break }
        case 'arcTo': {
          const wR = numAttr(c, 'wR') * sx, hR = numAttr(c, 'hR') * sy, st = (numAttr(c, 'stAng') / 60000) * Math.PI / 180, sw = (numAttr(c, 'swAng') / 60000) * Math.PI / 180
          const cx = cur[0] - wR * Math.cos(st), cy = cur[1] - hR * Math.sin(st)
          p.ellipse(cx, cy, wR, hR, 0, st, st + sw, sw < 0)
          cur = [cx + wR * Math.cos(st + sw), cy + hR * Math.sin(st + sw)]
          break
        }
        case 'close': p.closePath(); break
        default: break
      }
    }
  }
  return p
}

async function paintShape(node, m, env) {
  const { ctx } = env
  const spPr = kid(node, 'spPr')
  const style = kid(node, 'style')
  const inh = inheritedPh(node, env)
  let x = xfrmOf(spPr)
  if (!x && inh.layoutSp) x = xfrmOf(kid(inh.layoutSp, 'spPr'))
  if (!x && inh.masterSp) x = xfrmOf(kid(inh.masterSp, 'spPr'))
  if (!x) return
  const bx = m.sx * x.x + m.tx, by = m.sy * x.y + m.ty, bw = m.sx * x.w, bh = m.sy * x.h
  const geomNode = kid(spPr, 'prstGeom'), cust = kid(spPr, 'custGeom')
  const isLine = node.localName === 'cxnSp' || /^(line|straightConnector1|bentConnector\d|curvedConnector\d)$/.test(attr(geomNode, 'prst', ''))
  const av = {}
  for (const gd of deep(geomNode, 'gd')) av[gd.getAttribute('name')] = Number((gd.getAttribute('fmla') || '').replace(/^val\s+/, ''))
  const prst = attr(geomNode, 'prst', cust ? '' : 'rect')

  ctx.save()
  ctx.translate(bx + bw / 2, by + bh / 2)
  if (x.rot) ctx.rotate((x.rot * Math.PI) / 180)
  ctx.scale(x.flipH ? -1 : 1, x.flipV ? -1 : 1)
  ctx.translate(-bw / 2, -bh / 2)
  const path = cust ? customPath(cust, bw, bh) : presetPath(prst, bw, bh, av)

  // fill: own, then placeholder inheritance, then the style reference
  let fill = spPr ? fillOf(spPr, env) : undefined
  if (fill === undefined && inh.layoutSp) fill = fillOf(kid(inh.layoutSp, 'spPr'), env)
  if (fill === undefined && inh.masterSp) fill = fillOf(kid(inh.masterSp, 'spPr'), env)
  if (fill === undefined) {
    const ref = kid(style, 'fillRef')
    const idx = numAttr(ref, 'idx')
    if (ref && idx > 0) { const nd = idx >= 1001 ? env.theme.bgFills[idx - 1001] : env.theme.fills[idx - 1]; if (nd) fill = fillOf({ children: [nd] }, { ...env, phClr: colorOf(ref, env)?.rgb }) }
  }
  if (isLine) fill = { kind: 'none' }
  const eff = spPr && kid(spPr, 'effectLst')
  const sh = eff && kid(eff, 'outerShdw')
  if (fill && fill.kind !== 'none') await fillPath(env, fill, path, { x: 0, y: 0, w: bw, h: bh }, sh ? { c: colorOf(sh, env), blur: numAttr(sh, 'blurRad') * env.k, dist: numAttr(sh, 'dist') * env.k, dir: (numAttr(sh, 'dir') / 60000) * Math.PI / 180 } : null)
  const ln = lineOf(spPr, style, env)
  if (ln) {
    ctx.lineWidth = Math.max(0.6, (ln.w * env.k * m.sx) / env.k)
    ctx.strokeStyle = css(ln.color)
    ctx.lineJoin = 'round'
    ctx.lineCap = ln.cap === 'rnd' ? 'round' : ln.cap === 'sq' ? 'square' : 'butt'
    const d = DASHES[ln.dash]
    if (d) ctx.setLineDash(d.map((v) => v * Math.max(1, ctx.lineWidth)))
    ctx.stroke(path)
    ctx.setLineDash([])
    if (isLine) arrowHeads(ctx, ln, bw, bh, prst)
  }
  // text
  const tb = kid(node, 'txBody')
  if (tb && !isLine) {
    await paintText(tb, { x: 0, y: 0, w: bw, h: bh }, { m, env, node, inh, shapeFill: fill, rotated: !!x.rot, abs: { x: bx, y: by } })
  }
  ctx.restore()
}

async function fillPath(env, fill, path, box, shadow) {
  const { ctx } = env
  ctx.save()
  if (shadow) { ctx.shadowColor = css(shadow.c); ctx.shadowBlur = shadow.blur; ctx.shadowOffsetX = Math.cos(shadow.dir) * shadow.dist; ctx.shadowOffsetY = Math.sin(shadow.dir) * shadow.dist }
  if (fill.kind === 'solid') { ctx.fillStyle = css(fill.color); ctx.fill(path) }
  else if (fill.kind === 'grad' && fill.stops.length) {
    let g
    if (fill.radial) g = ctx.createRadialGradient(box.w / 2, box.h / 2, 0, box.w / 2, box.h / 2, Math.max(box.w, box.h) / 2)
    else {
      const a = (fill.angle * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a)
      const half = (Math.abs(box.w * dx) + Math.abs(box.h * dy)) / 2
      g = ctx.createLinearGradient(box.w / 2 - dx * half, box.h / 2 - dy * half, box.w / 2 + dx * half, box.h / 2 + dy * half)
    }
    for (const stp of fill.stops) g.addColorStop(Math.min(1, Math.max(0, stp.pos)), css(stp.color))
    ctx.fillStyle = g
    ctx.fill(path)
  } else if (fill.kind === 'blip') {
    const bmp = await env.image(env.rels?.get(fill.rid)?.path)
    env.stats.pictures++
    if (bmp) { ctx.clip(path); ctx.globalAlpha = fill.alpha; drawBitmap(ctx, bmp, box, fill.src) }
  }
  ctx.restore()
}

function arrowHeads(ctx, ln, w, h, prst) {
  const size = Math.max(6, ctx.lineWidth * 3.2)
  const head = (x, y, ang) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.fillStyle = css(ln.color)
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-size, size / 2.2); ctx.lineTo(-size, -size / 2.2); ctx.closePath(); ctx.fill(); ctx.restore()
  }
  const a = Math.atan2(h, w || 0.001)
  if (ln.tail && ln.tail !== 'none') head(w, h, a)
  if (ln.head && ln.head !== 'none') head(0, 0, a + Math.PI)
}

async function paintPicture(node, m, env) {
  const { ctx } = env
  const spPr = kid(node, 'spPr')
  const x = xfrmOf(spPr)
  if (!x) return
  const blipFill = kid(node, 'blipFill')
  const blip = kid(blipFill, 'blip')
  const bmp = await env.image(env.rels?.get(rid(blip))?.path)
  env.stats.pictures++
  const bx = m.sx * x.x + m.tx, by = m.sy * x.y + m.ty, bw = m.sx * x.w, bh = m.sy * x.h
  ctx.save()
  ctx.translate(bx + bw / 2, by + bh / 2)
  if (x.rot) ctx.rotate((x.rot * Math.PI) / 180)
  ctx.scale(x.flipH ? -1 : 1, x.flipV ? -1 : 1)
  ctx.translate(-bw / 2, -bh / 2)
  const prst = attr(kid(spPr, 'prstGeom'), 'prst', 'rect')
  const path = kid(spPr, 'custGeom') ? customPath(kid(spPr, 'custGeom'), bw, bh) : presetPath(prst, bw, bh, {})
  if (bmp) {
    ctx.save()
    if (prst !== 'rect') ctx.clip(path)
    const amt = numAttr(deep(blip, 'alphaModFix')[0], 'amt', 100000) / 100000
    ctx.globalAlpha = amt
    drawBitmap(ctx, bmp, { x: 0, y: 0, w: bw, h: bh }, kid(blipFill, 'srcRect'))
    ctx.restore()
  } else {
    ctx.fillStyle = 'rgba(128,128,140,.12)'; ctx.fillRect(0, 0, bw, bh)
    ctx.strokeStyle = 'rgba(128,128,140,.5)'; ctx.strokeRect(0, 0, bw, bh)
    env.warnings.add('A picture in a format browsers cannot show (such as EMF or WMF) was left blank')
  }
  const ln = lineOf(spPr, kid(node, 'style'), env)
  if (ln) { ctx.lineWidth = Math.max(0.6, ln.w * env.k * m.sx / env.k); ctx.strokeStyle = css(ln.color); ctx.stroke(path) }
  ctx.restore()
}

// ---------------------------------------------------------------- text
const SIZE_DEFAULT = 1800
const FONT_FALLBACK = (name) => (/times|georgia|garamond|cambria|palatino|serif(?!.*sans)|book|century|minion|baskerville/i.test(name) ? 'serif' : /mono|courier|consolas|code/i.test(name) ? 'monospace' : 'sans-serif')

function lstChain(node, inh, env, isPh, type) {
  // lowest precedence first: presentation default, master text style, master ph lstStyle, layout ph lstStyle, own lstStyle
  const chain = []
  if (env.defaultTextStyle) chain.push(env.defaultTextStyle)
  const ts = env.s.master && at(env.s.master.documentElement, 'txStyles')
  if (ts) {
    if (isPh) chain.push(kid(ts, type === 'title' ? 'titleStyle' : 'bodyStyle'))
    else chain.push(kid(ts, 'otherStyle'))
  }
  if (inh.masterSp) chain.push(at(inh.masterSp, 'txBody', 'lstStyle'))
  if (inh.layoutSp) chain.push(at(inh.layoutSp, 'txBody', 'lstStyle'))
  chain.push(at(node, 'txBody', 'lstStyle'))
  return chain.filter(Boolean)
}

function pPrChain(chain, lvl) { return chain.map((c) => kid(c, `lvl${lvl + 1}pPr`)).filter(Boolean) }
const firstAttr = (list, name) => { for (let i = list.length - 1; i >= 0; i--) { const v = list[i].getAttribute(name); if (v != null) return v } return null }
const firstKid = (list, name) => { for (let i = list.length - 1; i >= 0; i--) { const v = kid(list[i], name); if (v) return v } return null }

function romanOf(n) { const t = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let s = ''; for (const [v, r] of t) while (n >= v) { s += r; n -= v } return s }
function autoNum(type, n) {
  const al = (k) => { let s = ''; for (let i = k; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(97 + ((i - 1) % 26)) + s; return s }
  const base = { arabic: String(n), alphaLc: al(n), alphaUc: al(n).toUpperCase(), romanLc: romanOf(n), romanUc: romanOf(n).toUpperCase() }
  const k = Object.keys(base).find((x) => type.startsWith(x)) || 'arabic'
  const suffix = /ParenBoth/.test(type) ? ')' : /ParenR/.test(type) ? ')' : /Period/.test(type) ? '.' : ''
  return (/ParenBoth/.test(type) ? '(' : '') + base[k] + suffix
}

/**
 * Lay out and draw a txBody inside `box` (px, current transform). opts.measure returns the needed height without drawing.
 */
async function paintText(tb, box, o) {
  const { env, node, inh, m } = o
  const { ctx } = env
  const ph = deep(node, 'ph')[0]
  const isPh = !!ph
  const type = inh.type || 'body'
  const bodyPr = kid(tb, 'bodyPr')
  const inhBody = [inh.masterSp && at(inh.masterSp, 'txBody', 'bodyPr'), inh.layoutSp && at(inh.layoutSp, 'txBody', 'bodyPr'), bodyPr].filter(Boolean)
  const bp = (n, d) => { const v = firstAttr(inhBody, n); return v == null ? d : v }
  const k = env.k * m.sx / env.k
  const insL = Number(bp('lIns', 91440)) * k, insR = Number(bp('rIns', 91440)) * k, insT = Number(bp('tIns', 45720)) * k, insB = Number(bp('bIns', 45720)) * k
  const anchor = bp('anchor', isPh && type === 'title' ? 'ctr' : 't')
  const wrap = bp('wrap', 'square') !== 'none'
  const vert = bp('vert', 'horz')
  const norm = firstKid(inhBody, 'normAutofit')
  let fontScale = norm ? numAttr(norm, 'fontScale', 100000) / 100000 : 1
  let lnReduce = norm ? numAttr(norm, 'lnSpcReduction', 0) / 100000 : 0
  const chain = lstChain(node, inh, env, isPh, type)
  const paras = kids(tb, 'p')
  const theme = env.theme
  const fontName = (f) => (f === '+mj-lt' ? theme.major : f === '+mn-lt' ? theme.minor : f)

  let bw = box.w, bh = box.h
  ctx.save()
  if (vert === 'vert' || vert === 'vert270' || vert === 'eaVert') {
    ctx.translate(box.w / 2, box.h / 2); ctx.rotate(vert === 'vert270' ? -Math.PI / 2 : Math.PI / 2); ctx.translate(-box.h / 2, -box.w / 2); bw = box.h; bh = box.w
  }
  const availW = Math.max(1, bw - insL - insR), availH = Math.max(1, bh - insT - insB)

  const build = (scale, reduce) => {
    const lines = []
    let totalH = 0
    const counters = []
    let first = true
    for (const p of paras) {
      const pPr = kid(p, 'pPr')
      const lvl = Math.min(8, numAttr(pPr, 'lvl', 0))
      const pl = [...pPrChain(chain, lvl), ...(pPr ? [pPr] : [])]
      const algn = firstAttr(pl, 'algn') || 'l'
      const marL = Number(firstAttr(pl, 'marL') ?? (isPh && type !== 'title' ? 0 : 0)) * k
      const indent = Number(firstAttr(pl, 'indent') ?? 0) * k
      const buNone = firstKid(pl, 'buNone'), buChar = firstKid(pl, 'buChar'), buAuto = firstKid(pl, 'buAutoNum')
      const lnSpc = firstKid(pl, 'lnSpc'), spcBef = firstKid(pl, 'spcBef'), spcAft = firstKid(pl, 'spcAft')
      const defR = pl.map((x) => kid(x, 'defRPr')).filter(Boolean)
      const endR = kid(p, 'endParaRPr')
      // runs
      const toks = []
      const runStyle = (rPr) => {
        const rl = [...defR, ...(rPr ? [rPr] : [])]
        const sz = Number(firstAttr(rl, 'sz') ?? SIZE_DEFAULT) / 100
        const base = firstAttr(rl, 'baseline')
        const size = sz * 12700 * env.k * scale * (base && Number(base) !== 0 ? 0.66 : 1) * (m.sx / env.k)
        const latin = firstKid(rl, 'latin')
        const family = fontName(latin?.getAttribute('typeface') || theme.minor)
        const bAttr = firstAttr(rl, 'b')
        const b = bAttr == null ? !!o.defBold : bAttr === '1', it = firstAttr(rl, 'i') === '1'
        let fillNode = null
        for (let i = rl.length - 1; i >= 0 && !fillNode; i--) fillNode = kid(rl[i], 'solidFill')
        const hl = firstKid(rl, 'hlinkClick')
        let color = fillNode ? colorOf(fillNode, env) : null
        if (!color && hl) color = { r: theme.colors.hlink[0], g: theme.colors.hlink[1], b: theme.colors.hlink[2], a: 1 }
        if (!color) color = (o.defColor) || fillFromMaster(env, o) || { r: 0, g: 0, b: 0, a: 1 }
        const u = firstAttr(rl, 'u'), strike = firstAttr(rl, 'strike')
        const hi = firstKid(rl, 'highlight')
        return { size, family, b, it, color, u: u && u !== 'none' || !!hl, strike: strike && strike !== 'noStrike', cap: firstAttr(rl, 'cap'), raise: base ? Number(base) / 100000 : 0, hi: hi ? colorOf(hi, env) : null, url: hl ? env.rels?.get(rid(hl, 'id'))?.path : null }
      }
      for (const r of p.children) {
        if (r.localName === 'r' || r.localName === 'fld') {
          const rPr = kid(r, 'rPr')
          let t = kid(r, 't')?.textContent ?? ''
          if (r.localName === 'fld' && attr(r, 'type', '') === 'slidenum') t = String(env.slideNumber || t || '')
          const st = runStyle(rPr)
          if (st.cap === 'all') t = t.toUpperCase()
          for (const part of t.split(/(\s+)/)) if (part) toks.push({ text: part, st, space: /^\s+$/.test(part) })
        } else if (r.localName === 'br') toks.push({ br: true, st: runStyle(kid(r, 'rPr')) })
      }
      const endSt = runStyle(endR)
      const lead = (st) => st.size * 1.2
      // bullet
      let bullet = null
      const hasText = toks.some((t) => !t.space && !t.br)
      if (!buNone && (buChar || buAuto) && hasText) {
        if (buAuto) {
          const type2 = attr(buAuto, 'type', 'arabicPeriod')
          counters.length = Math.max(counters.length, lvl + 1)
          for (let i = lvl + 1; i < counters.length; i++) counters[i] = 0
          counters[lvl] = (counters[lvl] || (numAttr(buAuto, 'startAt', 1) - 1)) + 1
          bullet = { text: autoNum(type2, counters[lvl]), auto: true }
        } else bullet = { text: attr(buChar, 'char', '•'), font: attr(firstKid(pl, 'buFont'), 'typeface', null) }
        const bc = firstKid(pl, 'buClr'); bullet.color = bc ? colorOf(bc, env) : null
        const bs = firstKid(pl, 'buSzPct'); bullet.scale = bs ? numAttr(bs, 'val', 100000) / 100000 : 1
      } else if (!buAuto) { for (let i = lvl; i < counters.length; i++) counters[i] = 0 }
      // wrap into lines
      const lineMaxW = (isFirst) => availW - Math.max(0, marL + (isFirst && !bullet ? indent : 0))
      const plines = []
      let cur = { toks: [], w: 0, first: true }
      const flush = (forced) => { plines.push(cur); cur = { toks: [], w: 0, first: false, forced } }
      for (const t of toks) {
        if (t.br) { flush(); continue }
        ctx.font = fontStr(t.st)
        t.w = ctx.measureText(t.text).width
        if (wrap && !t.space && cur.w + t.w > lineMaxW(cur.first) + 0.5 && cur.toks.some((x) => !x.space)) {
          while (cur.toks.length && cur.toks[cur.toks.length - 1].space) { cur.w -= cur.toks.pop().w }
          flush()
        }
        if (t.space && !cur.toks.length) continue
        cur.toks.push(t); cur.w += t.w
      }
      plines.push(cur)
      const spcPct = lnSpc && kid(lnSpc, 'spcPct') ? numAttr(kid(lnSpc, 'spcPct'), 'val', 100000) / 100000 : 1
      const spcPts = lnSpc && kid(lnSpc, 'spcPts') ? numAttr(kid(lnSpc, 'spcPts'), 'val') / 100 * 12700 * env.k * scale * (m.sx / env.k) : null
      const lsMul = Math.max(0.5, spcPct - reduce)
      const spacing = (n, ref) => { const pc = n && kid(n, 'spcPct'), pt = n && kid(n, 'spcPts'); return pc ? (numAttr(pc, 'val') / 100000) * ref * 1.2 : pt ? (numAttr(pt, 'val') / 100) * 12700 * env.k * scale * (m.sx / env.k) : 0 }
      const refSize = Math.max(...toks.filter((t) => !t.br).map((t) => t.st.size), endSt.size)
      const bef = first ? 0 : spacing(spcBef, refSize), aft = spacing(spcAft, refSize)
      first = false
      totalH += bef
      plines.forEach((pl2, li) => {
        const real = pl2.toks.filter((t) => !t.space || true)
        const sz = Math.max(...real.map((t) => t.st.size), li === 0 && !real.length ? endSt.size : 0, 1)
        const h2 = spcPts ?? sz * 1.2 * lsMul
        pl2.h = h2; pl2.size = sz; pl2.asc = sz * 0.95 * (spcPts ? 1 : Math.max(lsMul, 0.8) > 1 ? 1 : 1)
        pl2.algn = algn; pl2.marL = marL; pl2.indent = indent; pl2.bullet = li === 0 ? bullet : null; pl2.bef = li === 0 ? bef : 0
        totalH += h2
        lines.push(pl2)
      })
      totalH += aft
      lines[lines.length - 1].aft = aft
    }
    return { lines, totalH }
  }
  let res = build(fontScale, lnReduce)
  if (norm && res.totalH > availH) {
    // shrink to fit, like PowerPoint's "Shrink text on overflow"
    for (let i = 0; i < 10 && res.totalH > availH; i++) { fontScale *= 0.92; lnReduce = Math.min(0.2, lnReduce + 0.02); res = build(fontScale, lnReduce) }
  }
  if (o.measure) { ctx.restore(); return res.totalH + insT + insB }
  let y = insT + (anchor === 'ctr' ? (availH - res.totalH) / 2 : anchor === 'b' ? availH - res.totalH : 0)
  if (res.totalH > availH && anchor !== 't') y = Math.max(insT, y)
  const mt = ctx.getTransform()
  for (const ln of res.lines) {
    y += ln.bef || 0
    const lead = ln.first && !ln.bullet ? ln.indent : 0
    const avail = availW - Math.max(0, ln.marL + lead)
    let x = insL + Math.max(0, ln.marL + lead)
    const real = ln.toks.filter((t, i, arr) => !(t.space && i === arr.length - 1))
    const lw = real.reduce((a, t) => a + t.w, 0)
    if (ln.algn === 'ctr') x += (avail - lw) / 2
    else if (ln.algn === 'r') x += avail - lw
    const base = y + ln.h * 0.5 + ln.size * 0.35 + (ln.h - ln.size * 1.2) * 0.0
    const baseline = y + (ln.h - ln.size * 1.2) + ln.size * 1.0
    void base
    if (ln.bullet) {
      const b = ln.bullet
      ctx.save()
      const st = { ...(real[0]?.st || { size: ln.size, family: env.theme.minor, b: false, it: false, color: { r: 0, g: 0, b: 0, a: 1 } }) }
      st.size *= b.scale
      ctx.font = fontStr({ ...st, family: b.font && !/wingdings|symbol/i.test(b.font) ? b.font : st.family })
      ctx.fillStyle = css(b.color || real[0]?.st.color || { r: 0, g: 0, b: 0, a: 1 })
      const bx = insL + Math.max(0, ln.marL + ln.indent)
      ctx.fillText(/wingdings|symbol/i.test(b.font || '') ? (b.text === '§' ? '▪' : '•') : b.text, bx, baseline)
      ctx.restore()
    }
    for (const t of ln.toks) {
      if (!t.space || t.st.u || t.st.hi) {
        ctx.font = fontStr(t.st)
        ctx.textBaseline = 'alphabetic'
        const yy = baseline - t.st.raise * ln.size * 1.4
        if (t.st.hi) { ctx.fillStyle = css(t.st.hi); ctx.fillRect(x, yy - t.st.size, t.w, t.st.size * 1.25) }
        if (!t.space) {
          ctx.fillStyle = css(t.st.color)
          ctx.fillText(t.text, x, yy)
          if (!o.rotated && !/vert/.test(vert)) {
            const p0 = mt.transformPoint({ x, y: yy })
            env.items.push({ text: t.text, x: p0.x, y: p0.y, size: t.st.size * mt.a, w: t.w * mt.a })
          }
        }
        if (t.st.u) { ctx.fillStyle = css(t.st.color); ctx.fillRect(x, yy + t.st.size * 0.1, t.w, Math.max(1, t.st.size / 16)) }
        if (t.st.strike) { ctx.fillStyle = css(t.st.color); ctx.fillRect(x, yy - t.st.size * 0.3, t.w, Math.max(1, t.st.size / 16)) }
      }
      x += t.w
    }
    y += ln.h + (ln.aft || 0)
  }
  ctx.restore()
  return res.totalH + insT + insB
}

function fontStr(st) {
  const fam = st.family || 'Calibri'
  return `${st.it ? 'italic ' : ''}${st.b ? 'bold ' : ''}${Math.max(1, st.size).toFixed(2)}px "${fam}", ${FONT_FALLBACK(fam)}`
}

/** Text color inherited from placeholder styles when a run sets none: tx1 normally, bg1 on dark shapes. */
function fillFromMaster(env, o) {
  const dark = o.shapeFill && o.shapeFill.kind === 'solid' && 0.299 * o.shapeFill.color.r + 0.587 * o.shapeFill.color.g + 0.114 * o.shapeFill.color.b < 110
  const key = env.clrMap?.[dark ? 'bg1' : 'tx1'] || (dark ? 'lt1' : 'dk1')
  const c = env.theme.colors[key] || (dark ? [255, 255, 255] : [0, 0, 0])
  return { r: c[0], g: c[1], b: c[2], a: 1 }
}

// ---------------------------------------------------------------- graphic frames: tables, charts, SmartArt
async function paintFrame(node, m, env) {
  const x = xfrmFrom(kid(node, 'xfrm'))
  if (!x) return
  const data = deep(node, 'graphicData')[0]
  const uri = attr(data, 'uri', '')
  const box = { x: m.sx * x.x + m.tx, y: m.sy * x.y + m.ty, w: m.sx * x.w, h: m.sy * x.h }
  if (/table/.test(uri)) return paintTable(kid(data, 'tbl'), box, m, env)
  if (/chart/.test(uri)) return paintChart(node, data, box, m, env)
  if (/diagram/.test(uri)) return paintDiagram(node, box, m, env)
  env.warnings.add('An embedded object (video, audio or OLE) is shown as an empty box')
  env.ctx.save(); env.ctx.strokeStyle = 'rgba(128,128,140,.5)'; env.ctx.strokeRect(box.x, box.y, box.w, box.h); env.ctx.restore()
}

async function tableStyleFor(tbl, env) {
  const id = kid(kid(tbl, 'tblPr'), 'tableStyleId')?.textContent
  const d = await env.xml('ppt/tableStyles.xml')
  const style = d && deep(d, 'tblStyle').find((s) => s.getAttribute('styleId') === id)
  const out = { first: null, band: null, whole: null, firstText: null, borders: null }
  const fillOfPart = (part) => { const tc = part && kid(part, 'tcStyle'); const f = tc && kid(tc, 'fill'); return f ? fillOf(f, env) : null }
  if (style) {
    out.whole = fillOfPart(kid(style, 'wholeTbl')); out.first = fillOfPart(kid(style, 'firstRow')); out.band = fillOfPart(kid(style, 'band1H'))
    const ft = kid(style, 'firstRow') && kid(kid(kid(style, 'firstRow'), 'tcTxStyle') || kid(style, 'firstRow'), 'fontRef')
    out.firstText = ft ? colorOf(ft, env) : null
    out.firstBold = kid(kid(style, 'firstRow'), 'tcTxStyle')?.getAttribute('b') === 'on'
  } else if (id) {
    const a1 = { kind: 'solid', color: { r: env.theme.colors.accent1[0], g: env.theme.colors.accent1[1], b: env.theme.colors.accent1[2], a: 1 } }
    const tint = (f) => ({ kind: 'solid', color: { ...a1.color, r: Math.round(a1.color.r * f + 255 * (1 - f)), g: Math.round(a1.color.g * f + 255 * (1 - f)), b: Math.round(a1.color.b * f + 255 * (1 - f)) } })
    out.first = a1; out.band = tint(0.2); out.whole = tint(0.1); out.firstText = { r: 255, g: 255, b: 255, a: 1 }; out.firstBold = true
  }
  return out
}

async function paintTable(tbl, box, m, env) {
  if (!tbl) return
  const { ctx } = env
  const pr = kid(tbl, 'tblPr')
  const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => numAttr(g, 'w') * m.sx)
  const trs = kids(tbl, 'tr')
  const style = await tableStyleFor(tbl, env)
  const firstRow = pr?.getAttribute('firstRow') === '1', bandRow = pr?.getAttribute('bandRow') === '1'
  const heights = trs.map((tr) => numAttr(tr, 'h') * m.sy)
  // measure text to grow rows
  const cells = trs.map((tr) => { let c = 0; return kids(tr, 'tc').map((tc) => { const info = { tc, col: c, span: numAttr(tc, 'gridSpan', 1), hm: tc.getAttribute('hMerge') === '1', vm: tc.getAttribute('vMerge') === '1', rs: numAttr(tc, 'rowSpan', 1) }; c += 1; return info }) })
  for (let r = 0; r < trs.length; r++) {
    for (const ci of cells[r]) {
      if (ci.hm || ci.vm || ci.rs > 1) continue
      const tb = kid(ci.tc, 'txBody')
      if (!tb) continue
      const w = cols.slice(ci.col, ci.col + ci.span).reduce((a, b) => a + b, 0)
      const need = await paintText(tb, { x: 0, y: 0, w, h: 1e6 }, { m: { sx: m.sx, sy: m.sy }, env, node: ci.tc, inh: {}, measure: true, shapeFill: null, tableCell: true })
      heights[r] = Math.max(heights[r], need)
    }
  }
  let y = box.y
  for (let r = 0; r < trs.length; r++) {
    for (const ci of cells[r]) {
      if (ci.hm || ci.vm) continue
      const x0 = box.x + cols.slice(0, ci.col).reduce((a, b) => a + b, 0)
      const w = cols.slice(ci.col, ci.col + ci.span).reduce((a, b) => a + b, 0)
      const h = heights.slice(r, r + ci.rs).reduce((a, b) => a + b, 0)
      const tcPr = kid(ci.tc, 'tcPr')
      let fill = tcPr ? fillOf(tcPr, env) : undefined
      const head = firstRow && r === 0
      if (fill === undefined) fill = head ? style.first : bandRow && (r - (firstRow ? 1 : 0)) % 2 === 0 ? style.band : style.whole
      ctx.save()
      if (fill && fill.kind === 'solid') { ctx.fillStyle = css(fill.color); ctx.fillRect(x0, y, w, h) }
      // borders
      for (const [side, x1, y1, x2, y2] of [['lnL', x0, y, x0, y + h], ['lnR', x0 + w, y, x0 + w, y + h], ['lnT', x0, y, x0 + w, y], ['lnB', x0, y + h, x0 + w, y + h]]) {
        const ln = tcPr && kid(tcPr, side)
        const lf = ln && fillOf(ln, env)
        if (lf && lf.kind === 'solid') { ctx.strokeStyle = css(lf.color); ctx.lineWidth = Math.max(0.6, numAttr(ln, 'w', 12700) * env.k); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke() }
        else if (!ln && style) { ctx.strokeStyle = 'rgba(160,160,170,.55)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke() }
      }
      ctx.translate(x0, y)
      const tb = kid(ci.tc, 'txBody')
      if (tb) {
        // header text inherits white bold from the style when runs set no color
        const hdrFill = head ? { kind: 'solid', color: style.first?.color || { r: 0, g: 0, b: 0, a: 1 } } : fill
        await paintText(tb, { x: 0, y: 0, w, h }, { m: { sx: m.sx, sy: m.sy }, env, node: ci.tc, inh: {}, shapeFill: hdrFill, tableCell: true, defColor: head ? style.firstText : null, defBold: head && style.firstBold })
      }
      ctx.restore()
    }
    y += heights[r]
  }
}

// charts: bars, lines, areas and pies from the cached values in the chart part
const SERIES_COLORS = (env) => ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].map((k) => env.theme.colors[k])
async function paintChart(node, data, box, m, env) {
  const { ctx } = env
  const rId = rid(deep(data, 'chart')[0], 'id')
  const path = env.rels?.get(rId)?.path
  const d = path ? await env.xml(path) : null
  if (!d) { env.warnings.add('A chart could not be read'); return }
  const plot = deep(d, 'plotArea')[0]
  const kinds = [...plot.children].filter((c) => /Chart$/.test(c.localName))
  const first = kinds[0]
  if (!first) return
  const ty = first.localName
  const sers = kids(first, 'ser').map((s, i) => ({
    name: deep(kid(s, 'tx'), 'v')[0]?.textContent || `Series ${i + 1}`,
    cats: deep(kid(s, 'cat'), 'pt').sort((a, b) => numAttr(a, 'idx') - numAttr(b, 'idx')).map((p) => kid(p, 'v')?.textContent ?? ''),
    vals: deep(kid(s, 'val') || kid(s, 'yVal'), 'pt').sort((a, b) => numAttr(a, 'idx') - numAttr(b, 'idx')).map((p) => parseFloat(kid(p, 'v')?.textContent ?? '0')),
    color: (() => { const f = kid(kid(s, 'spPr'), 'solidFill'); const c = f && colorOf(f, env); return c || null })(),
  }))
  const title = deep(kid(d.documentElement && deep(d, 'chart')[0], 'title'), 't').map((t) => t.textContent).join('')
  const pal = SERIES_COLORS(env)
  const col = (i) => { const c = sers[i]?.color; if (c) return css(c); const p = pal[i % pal.length]; return `rgb(${p[0]},${p[1]},${p[2]})` }
  const fs = Math.max(9, Math.min(box.h / 18, 16 * (env.k * 12700 / 12700) * 1.2))
  ctx.save()
  ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip()
  ctx.font = `${fs}px sans-serif`; ctx.fillStyle = '#444'; ctx.textBaseline = 'alphabetic'
  let top = box.y + 6
  if (title) { ctx.font = `bold ${fs * 1.25}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText(title, box.x + box.w / 2, top + fs * 1.2); top += fs * 2; ctx.textAlign = 'left'; ctx.font = `${fs}px sans-serif` }
  const legendOn = !!deep(d, 'legend')[0]
  const legendH = legendOn ? fs * 2 : 0
  const inner = { x: box.x + fs * 3.2, y: top + 4, w: box.w - fs * 4, h: box.y + box.h - top - legendH - fs * 2.4 }
  const cats = sers[0]?.cats.length ? sers[0].cats : (sers[0]?.vals || []).map((_, i) => String(i + 1))
  const nCat = cats.length || 1
  if (/pie|doughnut/i.test(ty)) {
    const vals = sers[0]?.vals || []
    const total = vals.reduce((a, b) => a + Math.max(0, b), 0) || 1
    const r = Math.min(inner.w, inner.h) / 2 - 4, cx = inner.x + inner.w / 2, cy = inner.y + inner.h / 2
    let a0 = -Math.PI / 2
    vals.forEach((v, i) => {
      const a1 = a0 + (Math.max(0, v) / total) * Math.PI * 2
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a0, a1); ctx.closePath()
      const p = pal[i % pal.length]; ctx.fillStyle = `rgb(${p[0]},${p[1]},${p[2]})`; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke()
      if (v / total > 0.05) { const am = (a0 + a1) / 2; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(`${Math.round((v / total) * 100)}%`, cx + Math.cos(am) * r * 0.62, cy + Math.sin(am) * r * 0.62 + fs / 3) }
      a0 = a1
    })
    if (/doughnut/i.test(ty)) { ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2); ctx.fill(); ctx.globalCompositeOperation = 'source-over' }
    ctx.textAlign = 'left'
    if (legendOn) legend(ctx, cats.map((c, i) => [c, `rgb(${pal[i % pal.length].join(',')})`]), box, fs)
  } else {
    const grouping = attr(kid(first, 'grouping'), 'val', 'clustered')
    const stacked = /stacked/i.test(grouping), pct = /percent/i.test(grouping)
    const horizontal = attr(kid(first, 'barDir'), 'val', 'col') === 'bar' && /bar/i.test(ty)
    const isLine = /line|scatter/i.test(ty), isArea = /area/i.test(ty)
    let maxV = 0, minV = 0
    for (let c = 0; c < nCat; c++) {
      let pos = 0, neg = 0
      sers.forEach((s) => { const v = s.vals[c] || 0; if (stacked || pct) { if (v >= 0) pos += v; else neg += v } else { maxV = Math.max(maxV, v); minV = Math.min(minV, v) } })
      if (stacked) { maxV = Math.max(maxV, pos); minV = Math.min(minV, neg) }
    }
    if (pct) { maxV = 1; minV = 0 }
    const nice = (v) => { if (v === 0) return 1; const e = Math.pow(10, Math.floor(Math.log10(v))); const f = v / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e }
    const step = nice((maxV - minV) / 5 || 1)
    const top2 = Math.ceil(maxV / step) * step, bot = Math.floor(minV / step) * step
    const rng = top2 - bot || 1
    const vx = (v) => (horizontal ? inner.x + ((v - bot) / rng) * inner.w : 0)
    const vy = (v) => inner.y + inner.h - ((v - bot) / rng) * inner.h
    ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 1; ctx.fillStyle = '#666'; ctx.textAlign = 'right'
    for (let v = bot; v <= top2 + step / 2; v += step) {
      const lab = pct ? `${Math.round(v * 100)}%` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : String(+v.toFixed(2))
      if (horizontal) { const x2 = vx(v); ctx.beginPath(); ctx.moveTo(x2, inner.y); ctx.lineTo(x2, inner.y + inner.h); ctx.stroke(); ctx.textAlign = 'center'; ctx.fillText(lab, x2, inner.y + inner.h + fs * 1.3) }
      else { const y2 = vy(v); ctx.beginPath(); ctx.moveTo(inner.x, y2); ctx.lineTo(inner.x + inner.w, y2); ctx.stroke(); ctx.fillText(lab, inner.x - 5, y2 + fs / 3) }
    }
    ctx.textAlign = 'center'
    const band = (horizontal ? inner.h : inner.w) / nCat
    cats.forEach((c, i) => { if (horizontal) { ctx.textAlign = 'right'; ctx.fillText(String(c).slice(0, 14), inner.x - 5, inner.y + band * (i + 0.5) + fs / 3) } else ctx.fillText(String(c).slice(0, 14), inner.x + band * (i + 0.5), inner.y + inner.h + fs * 1.3) })
    const n = sers.length
    if (isLine || isArea) {
      sers.forEach((s, si) => {
        ctx.beginPath()
        const pts = s.vals.map((v, i) => [inner.x + band * (i + 0.5), vy(v)])
        pts.forEach(([x2, y2], i) => (i ? ctx.lineTo(x2, y2) : ctx.moveTo(x2, y2)))
        if (isArea && pts.length) { ctx.lineTo(pts.at(-1)[0], vy(Math.max(0, bot))); ctx.lineTo(pts[0][0], vy(Math.max(0, bot))); ctx.closePath(); ctx.globalAlpha = 0.5; ctx.fillStyle = col(si); ctx.fill(); ctx.globalAlpha = 1 }
        else { ctx.strokeStyle = col(si); ctx.lineWidth = Math.max(2, fs / 5); ctx.lineJoin = 'round'; ctx.stroke(); pts.forEach(([x2, y2]) => { ctx.beginPath(); ctx.arc(x2, y2, Math.max(2.5, fs / 4), 0, Math.PI * 2); ctx.fillStyle = col(si); ctx.fill() }) }
      })
    } else {
      const gap = band * 0.2
      for (let c = 0; c < nCat; c++) {
        let acc = 0
        sers.forEach((s, si) => {
          const v = s.vals[c] || 0
          const tot = pct ? sers.reduce((a, q) => a + Math.max(0, q.vals[c] || 0), 0) || 1 : 1
          const vv = v / tot
          ctx.fillStyle = col(si)
          if (horizontal) {
            const bh2 = stacked || pct ? band - gap : (band - gap) / n, y2 = inner.y + band * c + gap / 2 + (stacked || pct ? 0 : bh2 * si)
            const x1 = vx(stacked || pct ? acc : Math.max(bot, 0)), x2 = vx(stacked || pct ? acc + vv : v)
            ctx.fillRect(Math.min(x1, x2), y2, Math.abs(x2 - x1), bh2)
          } else {
            const bw2 = stacked || pct ? band - gap : (band - gap) / n, x1 = inner.x + band * c + gap / 2 + (stacked || pct ? 0 : bw2 * si)
            const y1 = vy(stacked || pct ? acc : Math.max(bot, 0)), y2 = vy(stacked || pct ? acc + vv : v)
            ctx.fillRect(x1, Math.min(y1, y2), bw2, Math.abs(y2 - y1))
          }
          if (stacked || pct) acc += vv
        })
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); if (horizontal) { ctx.moveTo(vx(Math.max(bot, 0)), inner.y); ctx.lineTo(vx(Math.max(bot, 0)), inner.y + inner.h) } else { ctx.moveTo(inner.x, vy(Math.max(bot, 0))); ctx.lineTo(inner.x + inner.w, vy(Math.max(bot, 0))) } ctx.stroke()
    ctx.textAlign = 'left'
    if (legendOn) legend(ctx, sers.map((s, i) => [s.name, col(i)]), box, fs)
  }
  ctx.restore()
}
function legend(ctx, items, box, fs) {
  ctx.save(); ctx.font = `${fs}px sans-serif`
  const widths = items.map(([t]) => ctx.measureText(String(t)).width + fs * 2)
  let x = box.x + (box.w - widths.reduce((a, b) => a + b, 0)) / 2
  const y = box.y + box.h - fs * 0.8
  items.forEach(([t, c], i) => { ctx.fillStyle = c; ctx.fillRect(x, y - fs * 0.7, fs * 0.8, fs * 0.8); ctx.fillStyle = '#444'; ctx.textAlign = 'left'; ctx.fillText(String(t), x + fs, y); x += widths[i] })
  ctx.restore()
}

async function paintDiagram(node, box, m, env) {
  // SmartArt keeps a pre-drawn copy of its shapes in a drawing part
  const rel = [...(env.rels?.values() || [])].find((r) => /diagramDrawing$/.test(r.type))
  const d = rel ? await env.xml(rel.path) : null
  if (!d) { env.warnings.add('A SmartArt graphic has no drawing to show'); return }
  const tree = deep(d, 'spTree')[0]
  const child = { sx: m.sx, sy: m.sy, tx: box.x, ty: box.y }
  for (const sp of kids(tree, 'sp')) {
    const spPr = kid(sp, 'spPr')
    const tx = kid(sp, 'txXfrm')
    await paintShape(sp, child, { ...env, skipPh: false })
    void tx
    void spPr
  }
}
