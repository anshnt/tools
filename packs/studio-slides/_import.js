// Basic PPTX import: slide size, backgrounds, text boxes and shapes (with run formatting), pictures, tables,
// lines, speaker notes and transitions, with positions. Charts, SmartArt, video and animations are skipped and reported.
import { jszip } from '../../lib/libs.js'
import { uid, newDeck, textEl, shapeEl, lineEl, imageEl, tableEl, SHAPES, normalizeDeck, cssToHex, clamp } from './_model.js'
import { prepareImage } from './_state.js'

const NS = { p: 'http://schemas.openxmlformats.org/presentationml/2006/main', a: 'http://schemas.openxmlformats.org/drawingml/2006/main', r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships' }
const EMU = 12700
const SCHEME = { tx1: 'dk1', tx2: 'dk2', bg1: 'lt1', bg2: 'lt2' }
const SHAPE_IDS = new Set(SHAPES.map((s) => s[0]))
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif' }

const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml')
const kids = (n, ns, local) => (n ? [...n.children].filter((c) => c.localName === local && (!ns || c.namespaceURI === NS[ns])) : [])
const kid = (n, ns, local) => kids(n, ns, local)[0] || null
const path = (n, ...steps) => steps.reduce((cur, s) => (cur ? kid(cur, s[0], s[1]) : null), n)
const desc = (n, ns, local) => (n ? [...n.getElementsByTagNameNS(NS[ns], local)] : [])
const attr = (n, name, d = null) => (n?.getAttribute(name) ?? d)
const num = (n, name, d = 0) => { const v = parseFloat(attr(n, name)); return Number.isFinite(v) ? v : d }

async function relsOf(zip, file) {
  const dir = file.replace(/[^/]+$/, ''), name = file.split('/').pop()
  const f = zip.file(`${dir}_rels/${name}.rels`)
  const map = new Map()
  if (!f) return map
  for (const r of parse(await f.async('string')).getElementsByTagName('Relationship')) map.set(r.getAttribute('Id'), { type: r.getAttribute('Type').split('/').pop(), target: resolve(dir, r.getAttribute('Target')) })
  return map
}
function resolve(dir, target) {
  if (target.startsWith('/')) return target.slice(1)
  const parts = (dir + target).split('/')
  const out = []
  for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p) }
  return out.join('/')
}

export async function importPptx(file) {
  if (/\.ppt$/i.test(file.name)) throw new Error('This is the old .ppt format. Open it in PowerPoint and save it as .pptx first.')
  if (file.size > 250 * 1024 * 1024) throw new Error('This presentation is larger than 250 MB, which is too big to open in the browser.')
  const JSZip = await jszip()
  let zip
  try { zip = await JSZip.loadAsync(file) } catch { throw new Error('This file is not a valid .pptx (it could not be opened as a ZIP).') }
  const presFile = zip.file('ppt/presentation.xml')
  if (!presFile) throw new Error('This file is not a PowerPoint presentation (ppt/presentation.xml is missing).')
  const pres = parse(await presFile.async('string')).documentElement
  const sz = desc(pres, 'p', 'sldSz')[0]
  const W = clamp(num(sz, 'cx', 12192000) / EMU, 240, 4000), H = clamp(num(sz, 'cy', 6858000) / EMU, 240, 4000)
  const presRels = await relsOf(zip, 'ppt/presentation.xml')
  const slidePaths = desc(pres, 'p', 'sldId').map((s) => presRels.get(s.getAttributeNS(NS.r, 'id'))?.target).filter(Boolean)
  if (!slidePaths.length) throw new Error('This presentation has no slides.')

  // theme colours and fonts
  const theme = { colors: {}, major: 'Calibri', minor: 'Calibri' }
  const themeFile = [...Object.keys(zip.files)].find((f) => /^ppt\/theme\/theme\d+\.xml$/.test(f))
  if (themeFile) {
    const t = parse(await zip.file(themeFile).async('string')).documentElement
    for (const c of desc(t, 'a', 'clrScheme')[0]?.children || []) {
      const v = c.firstElementChild
      theme.colors[c.localName] = v ? (attr(v, 'val') && v.localName === 'srgbClr' ? `#${v.getAttribute('val')}` : attr(v, 'lastClr') ? `#${v.getAttribute('lastClr')}` : '') : ''
    }
    theme.major = attr(path(desc(t, 'a', 'majorFont')[0], ['a', 'latin']), 'typeface') || theme.major
    theme.minor = attr(path(desc(t, 'a', 'minorFont')[0], ['a', 'latin']), 'typeface') || theme.minor
  }
  const colorOf = (node) => {
    const c = node && [...node.children].find((k) => ['srgbClr', 'schemeClr', 'sysClr', 'prstClr'].includes(k.localName))
    if (!c) return ''
    if (c.localName === 'srgbClr') return `#${c.getAttribute('val')}`.toLowerCase()
    if (c.localName === 'sysClr') return `#${c.getAttribute('lastClr') || '000000'}`.toLowerCase()
    if (c.localName === 'prstClr') return cssToHex(c.getAttribute('val')) || '#000000'
    const v = c.getAttribute('val')
    return (theme.colors[SCHEME[v] || v] || (v === 'phClr' ? '' : '#444444')).toLowerCase()
  }
  const fillOf = (spPr) => {
    if (!spPr) return undefined
    if (kid(spPr, 'a', 'noFill')) return ''
    const sf = kid(spPr, 'a', 'solidFill')
    return sf ? colorOf(sf) : undefined
  }
  const fontName = (f) => (!f ? '' : f === '+mj-lt' ? theme.major : f === '+mn-lt' ? theme.minor : f)

  // master text defaults for placeholders
  const masterFile = [...Object.keys(zip.files)].find((f) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(f))
  const defaults = { title: { size: 44, bu: false }, body: { size: 24, bu: true }, sub: { size: 24, bu: false }, other: { size: 18, bu: false } }
  if (masterFile) {
    const m = parse(await zip.file(masterFile).async('string')).documentElement
    const style = (name) => path(desc(m, 'p', 'txStyles')[0], ['p', name], ['a', 'lvl1pPr'], ['a', 'defRPr'])
    const ts = style('titleStyle'), bs = style('bodyStyle')
    if (ts) Object.assign(defaults.title, { size: num(ts, 'sz', 4400) / 100, color: colorOf(kid(ts, 'a', 'solidFill')), b: attr(ts, 'b') === '1', font: fontName(attr(kid(ts, 'a', 'latin'), 'typeface')) })
    if (bs) for (const k of ['body', 'sub']) Object.assign(defaults[k], { size: num(bs, 'sz', 2400) / 100, color: colorOf(kid(bs, 'a', 'solidFill')), font: fontName(attr(kid(bs, 'a', 'latin'), 'typeface')) })
  }

  const assets = []
  const warnings = { skipped: 0, images: 0 }
  const deck = newDeck({ w: W, h: H, title: file.name.replace(/\.pptx$/i, '') })

  // ----- helpers for one slide -----
  const xfrmOf = (spPr) => {
    const x = kid(spPr, 'a', 'xfrm')
    if (!x) return null
    const off = kid(x, 'a', 'off'), ext = kid(x, 'a', 'ext')
    return { x: num(off, 'x') / EMU, y: num(off, 'y') / EMU, w: num(ext, 'cx') / EMU, h: num(ext, 'cy') / EMU, rot: num(x, 'rot') / 60000, fh: attr(x, 'flipH') === '1', fv: attr(x, 'flipV') === '1' }
  }
  const phKey = (sp) => { const ph = path(sp, ['p', 'nvSpPr'], ['p', 'nvPr'], ['p', 'ph']); return ph ? { type: attr(ph, 'type', 'body'), idx: attr(ph, 'idx', '') } : null }

  const boxCache = new Map()
  async function layoutBoxes(layoutPath) {
    const files = [layoutPath, masterFile].filter(Boolean)
    const out = []
    for (const f of files) {
      if (!boxCache.has(f)) {
        const doc = parse(await zip.file(f).async('string')).documentElement
        const boxes = []
        for (const sp of desc(doc, 'p', 'sp')) { const k = phKey(sp), x = xfrmOf(kid(sp, 'p', 'spPr')); if (k && x) boxes.push({ ...k, ...x }) }
        boxCache.set(f, boxes)
      }
      out.push(...boxCache.get(f))
    }
    return out
  }
  const phType = (t) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' ? 'body' : t)

  function readText(txBody, kind, ph, isShape, fontRefColor) {
    if (!txBody) return null
    const bodyPr = kid(txBody, 'a', 'bodyPr')
    const lst = path(txBody, ['a', 'lstStyle'], ['a', 'lvl1pPr'], ['a', 'defRPr'])
    const dflt = { ...defaults[kind], ...(fontRefColor ? { color: fontRefColor } : {}) }
    const paras = []
    for (const p of kids(txBody, 'a', 'p')) {
      const pPr = kid(p, 'a', 'pPr')
      const runs = []
      for (const n of p.children) {
        if (n.localName === 'br') { runs.push({ t: '\n' }); continue }
        if (n.localName !== 'r' && n.localName !== 'fld') continue
        const rPr = kid(n, 'a', 'rPr')
        const t = kid(n, 'a', 't')?.textContent ?? ''
        const run = { t }
        const sz = num(rPr, 'sz', 0) || num(lst, 'sz', 0)
        if (sz) run.s = sz / 100
        if (attr(rPr, 'b') !== null) run.b = attr(rPr, 'b') === '1'
        if (attr(rPr, 'i') !== null) run.i = attr(rPr, 'i') === '1'
        if (attr(rPr, 'u') && attr(rPr, 'u') !== 'none') run.u = true
        const c = colorOf(kid(rPr, 'a', 'solidFill')) || colorOf(kid(lst, 'a', 'solidFill'))
        if (c) run.c = c
        const f = fontName(attr(kid(rPr, 'a', 'latin'), 'typeface'))
        if (f) run.f = f
        runs.push(run)
      }
      const q = { runs: runs.length ? runs : [{ t: '' }] }
      const al = attr(pPr, 'algn')
      if (al) q.a = { l: 'left', ctr: 'center', r: 'right', just: 'justify' }[al] || 'left'
      const lv = num(pPr, 'lvl')
      if (kid(pPr, 'a', 'buAutoNum')) q.bu = 'num'
      else if (kid(pPr, 'a', 'buChar')) q.bu = 'dot'
      else if (dflt.bu && ph && !kid(pPr, 'a', 'buNone') && kind === 'body') q.bu = 'dot'
      if (lv && (q.bu || kind === 'body')) q.lv = Math.min(4, lv)
      paras.push(q)
    }
    if (!paras.length) return null
    // box-level base style: a value shared by every run (or paragraph), else the placeholder default; runs that match it lose their override
    const flat = paras.flatMap((q) => q.runs).filter((r) => r.t)
    const shared = (k, list) => (list.length && list.every((r) => r[k] !== undefined) && list.every((r) => r[k] === list[0][k]) ? list[0][k] : undefined)
    const base = {
      size: shared('s', flat) ?? dflt.size, b: shared('b', flat) ?? !!dflt.b, i: shared('i', flat) ?? false, color: shared('c', flat) ?? dflt.color ?? '#000000', font: shared('f', flat) ?? dflt.font ?? theme.minor,
      a: shared('a', paras) ?? (isShape ? 'center' : 'left'), va: { ctr: 'middle', b: 'bottom', t: 'top' }[attr(bodyPr, 'anchor', isShape ? 'ctr' : 't')] || 'top',
      pad: Math.round((num(bodyPr, 'lIns', 91440) / EMU) * 10) / 10, lh: 1, ps: 0,
    }
    for (const q of paras) {
      for (const r of q.runs) {
        if (r.s === base.size) delete r.s
        if (r.b === base.b) delete r.b
        if (r.i === base.i) delete r.i
        if (r.c === base.color) delete r.c
        if (r.f === base.font) delete r.f
        if (!r.u) delete r.u
      }
      if (q.a === base.a) delete q.a
    }
    return { paras, ...base }
  }

  async function readPic(pic, rels) {
    const blip = desc(pic, 'a', 'blip')[0]
    const rel = rels.get(blip?.getAttributeNS(NS.r, 'embed'))
    const f = rel && zip.file(rel.target)
    if (!f) return null
    const ext = rel.target.split('.').pop().toLowerCase()
    if (!MIME[ext]) { warnings.images++; return null }
    let blob = new Blob([await f.async('arraybuffer')], { type: MIME[ext] })
    const src = kid(kid(pic, 'p', 'blipFill'), 'a', 'srcRect')
    try {
      let a = await prepareImage(new File([blob], rel.target.split('/').pop(), { type: MIME[ext] }))
      if (src && ['l', 't', 'r', 'b'].some((k) => num(src, k))) { // bake the crop
        const [l, t, r, b] = ['l', 't', 'r', 'b'].map((k) => num(src, k) / 100000)
        const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(a.blob) })
        const sw = img.naturalWidth * (1 - l - r), sh = img.naturalHeight * (1 - t - b)
        const c = document.createElement('canvas')
        c.width = Math.max(1, Math.round(sw)); c.height = Math.max(1, Math.round(sh))
        c.getContext('2d').drawImage(img, img.naturalWidth * l, img.naturalHeight * t, sw, sh, 0, 0, c.width, c.height)
        URL.revokeObjectURL(img.src)
        const type = a.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
        blob = await new Promise((res) => c.toBlob(res, type, 0.92))
        a = { ...a, blob, type, w: c.width, h: c.height }
      }
      assets.push(a)
      return a
    } catch { warnings.images++; return null }
  }

  const els = []
  async function walk(parent, rels, boxes, tf) {
    for (const n of parent.children) {
      const name = n.localName
      if (name === 'grpSp') {
        const gx = kid(kid(n, 'p', 'grpSpPr'), 'a', 'xfrm')
        const off = kid(gx, 'a', 'off'), ext = kid(gx, 'a', 'ext'), cOff = kid(gx, 'a', 'chOff'), cExt = kid(gx, 'a', 'chExt')
        const sx = num(cExt, 'cx') ? num(ext, 'cx') / num(cExt, 'cx') : 1, sy = num(cExt, 'cy') ? num(ext, 'cy') / num(cExt, 'cy') : 1
        const child = { ox: (v) => tf.ox(num(off, 'x') / EMU + (v - num(cOff, 'x') / EMU) * sx), oy: (v) => tf.oy(num(off, 'y') / EMU + (v - num(cOff, 'y') / EMU) * sy), sx: tf.sx * sx, sy: tf.sy * sy }
        await walk(n, rels, boxes, { ox: child.ox, oy: child.oy, sx: child.sx, sy: child.sy })
        continue
      }
      const spPr = kid(n, 'p', 'spPr')
      let x = xfrmOf(spPr)
      if (name === 'graphicFrame') { const fx = kid(n, 'p', 'xfrm'); const off = kid(fx, 'a', 'off'), ext = kid(fx, 'a', 'ext'); x = fx ? { x: num(off, 'x') / EMU, y: num(off, 'y') / EMU, w: num(ext, 'cx') / EMU, h: num(ext, 'cy') / EMU, rot: 0 } : null }
      const key = name === 'sp' ? phKey(n) : null
      if (!x && key) { const b = boxes.find((q) => key.idx && q.idx === key.idx && phType(q.type) === phType(key.type)) || boxes.find((q) => phType(q.type) === phType(key.type)); if (b) x = b }
      if (!x) { if (['sp', 'pic', 'graphicFrame', 'cxnSp'].includes(name)) warnings.skipped++; continue }
      const before = els.length
      const g = { x: tf.ox(x.x), y: tf.oy(x.y), w: x.w * tf.sx, h: x.h * tf.sy, rot: x.rot || 0 }
      if (name === 'pic') {
        const a = await readPic(n, rels)
        if (a) els.push(imageEl(a.id, { ...g, fit: 'fill', alt: attr(path(n, ['p', 'nvPicPr'], ['p', 'cNvPr']), 'descr', '') }))
      } else if (name === 'graphicFrame') {
        const tbl = desc(n, 'a', 'tbl')[0]
        if (!tbl) { warnings.skipped++; continue }
        const grid = desc(tbl, 'a', 'gridCol').map((c) => num(c, 'w'))
        const rows = kids(tbl, 'a', 'tr')
        const cells = rows.map((r) => kids(r, 'a', 'tc').map((c) => desc(c, 'a', 'p').map((p) => desc(p, 'a', 't').map((t) => t.textContent).join('')).join('\n')))
        if (!cells.length || !cells[0].length) continue
        const tp = kid(tbl, 'a', 'tblPr')
        const firstSz = num(desc(tbl, 'a', 'rPr')[0], 'sz', 1800) / 100
        const t = tableEl(cells.length, cells[0].length, { ...g, cells, size: firstSz, hdr: attr(tp, 'firstRow') === '1', band: attr(tp, 'bandRow') === '1' })
        const tot = grid.reduce((a, b) => a + b, 0)
        if (tot && grid.length === cells[0].length) t.colw = grid.map((v) => v / tot)
        els.push(t)
      } else if (name === 'cxnSp' || (name === 'sp' && /line|Connector/.test(attr(kid(spPr, 'a', 'prstGeom'), 'prst', '')) && !kid(n, 'p', 'txBody'))) {
        const ln = kid(spPr, 'a', 'ln')
        els.push(lineEl({
          x: g.x, y: g.y, w: g.w, h: g.h, fh: !!x.fh, fv: !!x.fv, stroke: colorOf(kid(ln, 'a', 'solidFill')) || '#444444', sw: num(ln, 'w', 12700) / EMU || 1,
          dash: /dash/i.test(attr(kid(ln, 'a', 'prstDash'), 'val', '')) ? 'dash' : /dot/i.test(attr(kid(ln, 'a', 'prstDash'), 'val', '')) ? 'dot' : '',
          as: !!attr(kid(ln, 'a', 'headEnd'), 'type') && attr(kid(ln, 'a', 'headEnd'), 'type') !== 'none', ae: !!attr(kid(ln, 'a', 'tailEnd'), 'type') && attr(kid(ln, 'a', 'tailEnd'), 'type') !== 'none',
        }))
      } else if (name === 'sp') {
        const prst = attr(kid(spPr, 'a', 'prstGeom'), 'prst', 'rect')
        const fill = fillOf(spPr)
        const ln = kid(spPr, 'a', 'ln')
        const hasLine = ln && !kid(ln, 'a', 'noFill') && !!kid(ln, 'a', 'solidFill')
        const kind = key ? (/^(title|ctrTitle)$/.test(key.type) ? 'title' : key.type === 'subTitle' ? 'sub' : /body|obj/i.test(key.type) ? 'body' : 'other') : 'other'
        const txBox = attr(path(n, ['p', 'nvSpPr'], ['p', 'cNvSpPr']), 'txBox') === '1'
        const styled = !!kid(n, 'p', 'style') && !txBox && !key
        const noGeom = !kid(spPr, 'a', 'prstGeom')
        const asText = !fill && !hasLine && !styled && (txBox || key || prst === 'rect' || noGeom)
        const tx = readText(kid(n, 'p', 'txBody'), kind, key, !asText, !asText && !key ? colorOf(path(n, ['p', 'style'], ['a', 'fontRef'])) : '')
        if (asText) {
          if (tx) { const t = textEl({ ...g, tx }); t.tx.auto = false; els.push(t) } else warnings.skipped++
        } else if (fill || hasLine || styled || prst !== 'rect' || tx) {
          const shape = SHAPE_IDS.has(prst) ? prst : 'rect'
          const refFill = fill === undefined ? colorOf(path(n, ['p', 'style'], ['a', 'fillRef'])) : ''
          const dashVal = attr(kid(ln, 'a', 'prstDash'), 'val', '')
          const e = shapeEl(shape, {
            ...g, fill: fill === undefined ? refFill : fill, stroke: hasLine ? colorOf(kid(ln, 'a', 'solidFill')) : '', sw: hasLine ? num(ln, 'w', 12700) / EMU || 1 : 0,
            dash: /dash/i.test(dashVal) ? 'dash' : /dot/i.test(dashVal) ? 'dot' : '',
          })
          if (tx) e.tx = { ...e.tx, ...tx }
          els.push(e)
        } else warnings.skipped++
      }
      if (g.rot && els.length > before) els.at(-1).rot = ((g.rot % 360) + 360) % 360
    }
  }

  for (const sp of slidePaths) {
    const doc = parse(await zip.file(sp).async('string')).documentElement
    const rels = await relsOf(zip, sp)
    const layoutPath = [...rels.values()].find((r) => r.type === 'slideLayout')?.target
    const boxes = await layoutBoxes(layoutPath)
    els.length = 0
    const tree = path(doc, ['p', 'cSld'], ['p', 'spTree'])
    await walk(tree, rels, boxes, { ox: (v) => v, oy: (v) => v, sx: 1, sy: 1 })
    const slide = { id: uid('s'), layout: 'blank', plain: true, bg: null, notes: '', tr: 'none', elements: [...els] }
    // background: slide, else layout, else white
    const bgOf = (root) => {
      const bgPr = path(root, ['p', 'cSld'], ['p', 'bg'], ['p', 'bgPr'])
      if (bgPr) {
        const sf = kid(bgPr, 'a', 'solidFill')
        if (sf) return { c1: colorOf(sf) }
        const gf = kid(bgPr, 'a', 'gradFill')
        if (gf) { const stops = desc(gf, 'a', 'gs'); if (stops.length >= 2) return { c1: colorOf(stops[0]), c2: colorOf(stops.at(-1)), ang: (num(kid(gf, 'a', 'lin'), 'ang', 0) / 60000 + 90) % 360 } }
      }
      const ref = path(root, ['p', 'cSld'], ['p', 'bg'], ['p', 'bgRef'])
      return ref ? { c1: colorOf(ref) || '#ffffff' } : null
    }
    slide.bg = bgOf(doc)
    const bgPic = path(doc, ['p', 'cSld'], ['p', 'bg'], ['p', 'bgPr'])
    if (bgPic && desc(bgPic, 'a', 'blip').length) { // a picture background becomes a full-slide image at the back
      const a = await readPic(bgPic, rels)
      if (a) slide.elements.unshift(imageEl(a.id, { x: 0, y: 0, w: W, h: H, fit: 'fill', alt: 'Background' }))
    }
    if (!slide.bg && layoutPath) slide.bg = bgOf(parse(await zip.file(layoutPath).async('string')).documentElement)
    slide.bg ||= { c1: theme.colors.lt1 || '#ffffff' }
    const trn = kid(doc, 'p', 'transition') || desc(doc, 'p', 'transition')[0]
    const tk = trn?.firstElementChild?.localName
    if (tk) slide.tr = tk === 'fade' ? 'fade' : tk === 'zoom' ? 'zoom' : ['push', 'cover', 'pull', 'wipe', 'split', 'uncover'].includes(tk) ? 'slide' : 'none'
    const notesPath = [...rels.values()].find((r) => r.type === 'notesSlide')?.target
    if (notesPath && zip.file(notesPath)) {
      const nd = parse(await zip.file(notesPath).async('string')).documentElement
      const body = desc(nd, 'p', 'sp').find((s) => /body/.test(attr(path(s, ['p', 'nvSpPr'], ['p', 'nvPr'], ['p', 'ph']), 'type', '')))
      if (body) slide.notes = desc(body, 'a', 'p').map((p) => desc(p, 'a', 't').map((t) => t.textContent).join('')).join('\n').trim()
    }
    deck.slides.push(slide)
  }
  const out = normalizeDeck(deck)
  return { deck: out, assets, warnings }
}
