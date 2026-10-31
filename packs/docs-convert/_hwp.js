// Korean word processor documents. Readers: HWPX (a zip of OWPML XML) and HWP 5 (an OLE compound file with zlib-deflated record streams) -> blocks
// (see _ast.js). Writer: blocks -> a minimal HWPX package. HWP 5 support covers text with bold / italic / size / colour, headings, alignment,
// tables and embedded pictures; password-protected and distribution-locked files are refused with a clear message.
import { jszip, xlsx } from '../../lib/libs.js'
import { fail, parseXml, kids, kid, deep, attrNS, normalizeImage, sniffImage, xesc, hex6 } from './_util.js'

// ------------------------------------------------------------------ HWPX reader
const A = (el, n) => attrNS(el, n)
const hu2px = (v) => Math.round((Number(v) / 7200) * 96)

export const isHwpx = (bytes) => bytes[0] === 0x50 && bytes[1] === 0x4b
export const isHwp5 = (bytes) => bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0

/** HWPX bytes -> {blocks, title}. */
export async function hwpxToBlocks(bytes) {
  const JSZip = await jszip()
  let zip
  try { zip = await JSZip.loadAsync(bytes) } catch { throw fail('This is not a valid HWPX file (it should be a zip package).') }
  const names = Object.keys(zip.files)
  const hpf = names.find((n) => /(^|\/)content\.hpf$/i.test(n))
  if (!names.some((n) => /^Contents\/section\d+\.xml$/i.test(n)) && !hpf) throw fail('This does not look like an HWPX document (no Contents/section XML found). Old .hwp files use a different format.')
  if (names.some((n) => /^Contents\/.*\.xml$/i.test(n)) && (await zip.file('mimetype')?.async('string'))?.includes('hwp') === false) { /* tolerate odd mimetypes */ }
  // manifest + spine
  let sections = []
  const hrefById = new Map()
  let title = ''
  if (hpf) {
    const d = parseXml(await zip.file(hpf).async('string'), 'package')
    for (const it of deep(d, 'item')) hrefById.set(A(it, 'id'), A(it, 'href'))
    sections = deep(d, 'itemref').map((r) => hrefById.get(A(r, 'idref'))).filter((p) => p && /section\d*\.xml$/i.test(p))
    title = deep(d, 'title')[0]?.textContent?.trim() || ''
  }
  if (!sections.length) sections = names.filter((n) => /^Contents\/section\d+\.xml$/i.test(n)).sort((a, b) => parseInt(a.match(/(\d+)\.xml/)[1], 10) - parseInt(b.match(/(\d+)\.xml/)[1], 10))
  // styles from header.xml
  const charPr = new Map(), paraPr = new Map(), styleName = new Map(), fontFace = new Map()
  const headerPath = names.find((n) => /(^|\/)header\.xml$/i.test(n))
  if (headerPath) {
    const h = parseXml(await zip.file(headerPath).async('string'), 'styles')
    for (const f of deep(h, 'fontface')) { const lang = A(f, 'lang'); for (const ft of kids(f, 'font')) fontFace.set(`${lang}:${A(ft, 'id')}`, A(ft, 'face')) }
    for (const c of deep(h, 'charPr')) {
      const st = { size: Number(A(c, 'height')) / 100 || 0, color: hex6(A(c, 'textColor')) }
      if (st.color === '000000') st.color = null
      if (kid(c, 'bold')) st.b = true
      if (kid(c, 'italic')) st.i = true
      const u = kid(c, 'underline'); if (u && A(u, 'type') && A(u, 'type') !== 'NONE') st.u = true
      const so = kid(c, 'strikeout'); if (so && A(so, 'shape') && A(so, 'shape') !== 'NONE') st.s = true
      if (kid(c, 'supscript')) st.sup = true
      if (kid(c, 'subscript')) st.sub = true
      const fr = kid(c, 'fontRef'); if (fr) st.font = fontFace.get(`LATIN:${A(fr, 'latin')}`) || fontFace.get(`HANGUL:${A(fr, 'hangul')}`)
      if (st.font && /^(굴림체|바탕체|돋움체|궁서체|Courier|Consolas|D2Coding)/i.test(st.font) && false) st.mono = true
      charPr.set(A(c, 'id'), st)
    }
    for (const p of deep(h, 'paraPr')) {
      const al = A(kid(p, 'align'), 'horizontal')
      const hd = kid(p, 'heading')
      paraPr.set(A(p, 'id'), { align: { LEFT: 'left', RIGHT: 'right', CENTER: 'center', JUSTIFY: 'justify' }[al] || null, heading: hd && A(hd, 'type') === 'OUTLINE' ? (Number(A(hd, 'level')) || 0) + 1 : 0, listType: hd ? A(hd, 'type') : 'NONE' })
    }
    for (const s of deep(h, 'style')) styleName.set(A(s, 'id'), A(s, 'name') || '')
  }
  const bin = async (id) => {
    const href = hrefById.get(id)
    const path = href || names.find((n) => new RegExp(`^BinData/${id}(\\.|$)`, 'i').test(n))
    const f = path && zip.file(path)
    return f ? new Uint8Array(await f.async('uint8array')) : null
  }
  const jobs = []

  function runStyle(id) {
    const c = charPr.get(id) || {}
    const o = {}
    for (const k of ['b', 'i', 'u', 's', 'sup', 'sub', 'color', 'font']) if (c[k]) o[k] = c[k]
    if (c.size && c.size !== 10) o.size = c.size
    return o
  }

  function paragraphs(container, out) {
    for (const p of kids(container, 'p')) paragraph(p, out)
  }
  function paragraph(p, out) {
    const runs = []
    const after = []
    let link = null
    const pp = paraPr.get(A(p, 'paraPrIDRef')) || {}
    const sname = styleName.get(A(p, 'styleIDRef')) || ''
    const push = (text, style) => {
      if (!text) return
      const run = { text, ...style }
      if (link) run.href = link
      const prev = runs[runs.length - 1]
      const keys = ['b', 'i', 'u', 's', 'sup', 'sub', 'color', 'font', 'size', 'href']
      if (prev && prev.text !== undefined && keys.every((k) => prev[k] === run[k])) prev.text += text
      else runs.push(run)
    }
    for (const run of kids(p, 'run')) {
      const style = runStyle(A(run, 'charPrIDRef'))
      for (const c of run.children) {
        switch (c.localName) {
          case 't': {
            const walk = (n) => {
              for (const x of n.childNodes) {
                if (x.nodeType === 3) push(x.data, style)
                else if (x.nodeType === 1) {
                  const ln = x.localName
                  if (ln === 'tab') runs.push({ tab: true })
                  else if (ln === 'lineBreak') runs.push({ br: true })
                  else if (ln === 'nbSpace' || ln === 'fwSpace') push(' ', style)
                  else if (ln === 'hyphen') push('-', style)
                  else if (ln === 'markpenBegin' || ln === 'markpenEnd' || ln === 'titleMark' || ln === 'insertBegin' || ln === 'insertEnd' || ln === 'deleteBegin' || ln === 'deleteEnd') continue
                  else walk(x)
                }
              }
            }
            walk(c)
            break
          }
          case 'tbl': after.push({ t: 'table-el', el: c }); break
          case 'pic': { const r = picture(c); if (r) runs.push(r.run); break }
          case 'ctrl': {
            for (const cc of c.children) {
              if (cc.localName === 'fieldBegin' && /HYPERLINK/i.test(A(cc, 'type') || '')) {
                const cmd = deep(cc, 'stringParam').find((s) => A(s, 'name') === 'Command')?.textContent || ''
                const m = /^([^;]*?)(?:;|$)/.exec(cmd.replace(/\\:/g, ':'))
                link = m && /^(https?:|mailto:)/i.test(m[1]) ? m[1] : null
              } else if (cc.localName === 'fieldEnd') link = null
            }
            break
          }
          case 'rect': case 'ellipse': case 'line': case 'polygon': case 'curve': case 'arc': case 'container': case 'connectLine': case 'textart': case 'ole': {
            for (const dt of deep(c, 'drawText')) for (const sub of deep(dt, 'subList')) after.push({ t: 'sub', el: sub })
            const pic = deep(c, 'pic')[0]; if (pic) { const r = picture(pic); if (r) runs.push(r.run) }
            break
          }
          default: break
        }
      }
    }
    const base = { t: 'p', runs }
    let level = pp.heading || 0
    const m = /^(?:개요|제목|Outline|Heading)\s*(\d)/i.exec(sname)
    if (!level && m) level = +m[1]
    if (level) base.level = Math.min(6, level)
    if (pp.align) base.align = pp.align
    if (/^(?:글머리표|bullet)/i.test(sname)) base.list = { ordered: false, level: 0, n: 1 }
    const hasContent = runs.some((r) => r.text?.trim() || r.img || r.br || r.tab)
    if (hasContent || !after.length) out.push(hasContent || out.length ? base : { ...base, runs: [{ text: '' }] })
    for (const a of after) {
      if (a.t === 'table-el') { const t = table(a.el); if (t) out.push(t) }
      else paragraphs(a.el, out)
    }
  }
  function picture(pic) {
    const img = deep(pic, 'img')[0]
    const id = img && (A(img, 'binaryItemIDRef') || '')
    if (!id) return null
    const cur = deep(pic, 'curSz')[0] || deep(pic, 'sz')[0] || deep(pic, 'orgSz')[0]
    const run = { img: { raw: null, alt: deep(pic, 'shapeComment')[0]?.textContent?.trim() || '', w: cur ? hu2px(A(cur, 'width')) : 0, h: cur ? hu2px(A(cur, 'height')) : 0, _id: id } }
    jobs.push(run)
    return { run }
  }
  function table(tbl) {
    const rows = []
    let border = false
    for (const tr of kids(tbl, 'tr')) {
      const cells = []
      for (const tc of kids(tr, 'tc')) {
        const sub = kid(tc, 'subList')
        const blocks = []
        if (sub) paragraphs(sub, blocks)
        const span = kid(tc, 'cellSpan')
        if (A(tc, 'borderFillIDRef') && A(tc, 'borderFillIDRef') !== '1') border = true
        cells.push({ blocks: blocks.length ? blocks : [{ t: 'p', runs: [{ text: '' }] }], th: false, colspan: Number(A(span, 'colSpan')) || 1, rowspan: Number(A(span, 'rowSpan')) || 1, bg: null })
      }
      if (cells.length) rows.push(cells)
    }
    return rows.length ? { t: 'table', rows, border: true } : null
  }

  const blocks = []
  for (const path of sections) {
    const f = zip.file(path)
    if (!f) continue
    const doc = parseXml(await f.async('string'), 'section')
    paragraphs(doc.documentElement, blocks)
  }
  // pictures
  await Promise.all(jobs.map(async (run) => {
    const im = run.img
    const bytes = await bin(im._id)
    delete im._id
    const norm = bytes ? await normalizeImage(bytes, sniffImage(bytes)) : null
    if (!norm) { delete run.img; run.text = ''; return }
    let w = im.w || norm.w, h = im.h || norm.h
    run.img = { bytes: norm.bytes, mime: norm.mime, w, h, alt: im.alt }
  }))
  const prune = (list) => { for (const b of list) { if (b.t === 'p') b.runs = b.runs.filter((r) => !(r.text === '' && !r.br && !r.img && !r.tab)); else if (b.t === 'table') for (const row of b.rows) for (const c of row) prune(c.blocks) } }
  prune(blocks)
  while (blocks.length && blocks[blocks.length - 1].t === 'p' && !blocks[blocks.length - 1].runs.length) blocks.pop()
  if (!blocks.length) throw fail('No text was found in this HWPX file.')
  return { blocks, title }
}

// ------------------------------------------------------------------ HWP 5 reader
const TAG = { BIN_DATA: 18, CHAR_SHAPE: 21, PARA_SHAPE: 25, STYLE: 26, PARA_HEADER: 66, PARA_TEXT: 67, PARA_CHAR_SHAPE: 68, CTRL_HEADER: 71, LIST_HEADER: 72, TABLE: 77, SHAPE_COMPONENT: 76, PICTURE: 85 }
const ctrlId = (dv) => String.fromCharCode(dv.getUint8(3), dv.getUint8(2), dv.getUint8(1), dv.getUint8(0))

async function inflateRaw(data) {
  const ds = new DecompressionStream('deflate-raw')
  const stream = new Blob([data]).stream().pipeThrough(ds)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Split a decompressed stream into record nodes: {tag, level, data: Uint8Array, kids: []} (a tree by level). */
function parseRecords(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const roots = []
  const stack = []
  let o = 0
  while (o + 4 <= buf.length) {
    const h = dv.getUint32(o, true); o += 4
    const tag = h & 0x3ff, level = (h >> 10) & 0x3ff
    let size = h >>> 20
    if (size === 0xfff) { if (o + 4 > buf.length) break; size = dv.getUint32(o, true); o += 4 }
    if (o + size > buf.length) size = buf.length - o
    const node = { tag, level, data: buf.subarray(o, o + size), kids: [] }
    o += size
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
    if (stack.length) stack[stack.length - 1].kids.push(node); else roots.push(node)
    stack.push(node)
  }
  return roots
}

/** HWP 5 bytes -> {blocks, title}. */
export async function hwp5ToBlocks(bytes) {
  const X = await xlsx()
  let cfb
  try { cfb = X.CFB.read(bytes, { type: 'array' }) } catch { throw fail('Could not read this .hwp file. It may be damaged.') }
  const get = (path) => { const e = X.CFB.find(cfb, path); return e?.content ? Uint8Array.from(e.content) : null }
  const fh = get('/FileHeader')
  if (!fh) throw fail('This is not an HWP 5 document (no FileHeader found).')
  const sig = new TextDecoder().decode(fh.subarray(0, 17))
  if (!/^HWP Document File/.test(sig)) throw fail('This is not an HWP 5 document.')
  const flags = new DataView(fh.buffer, fh.byteOffset, fh.byteLength).getUint32(36, true)
  const compressed = !!(flags & 1), encrypted = !!(flags & 2), distribution = !!(flags & 4)
  if (encrypted) throw fail('This HWP document is password protected. Remove the password in the word processor and try again.')
  if (distribution) throw fail('This is a distribution-protected HWP document (read-only copy). Its text is locked and cannot be converted.')
  const inflate = async (data) => { if (!compressed) return data; try { return await inflateRaw(data) } catch { return data } }

  // DocInfo: pictures, character shapes, paragraph shapes, styles
  const bins = [], charShapes = [], paraShapes = [], styles = []
  const di = get('/DocInfo')
  if (di) {
    const recs = parseRecords(await inflate(di))
    for (const r of recs) {
      const dv = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength)
      if (r.tag === TAG.BIN_DATA && r.data.length >= 4) {
        const props = dv.getUint16(0, true)
        if ((props & 0xf) === 1 || (props & 0xf) === 2) {
          const id = dv.getUint16(2, true)
          const len = r.data.length >= 6 ? dv.getUint16(4, true) : 0
          const ext = len && r.data.length >= 6 + len * 2 ? new TextDecoder('utf-16le').decode(r.data.subarray(6, 6 + len * 2)) : ''
          bins.push({ id, ext })
        } else bins.push(null)
      } else if (r.tag === TAG.CHAR_SHAPE && r.data.length >= 56) {
        const attr = dv.getUint32(46, true)
        const c = dv.getUint32(52, true)
        const col = [(c >> 0) & 255, (c >> 8) & 255, (c >> 16) & 255].map((v) => v.toString(16).padStart(2, '0')).join('')
        charShapes.push({ size: dv.getInt32(42, true) / 100, i: !!(attr & 1), b: !!(attr & 2), u: ((attr >> 2) & 3) === 1, s: ((attr >> 18) & 7) > 0 && ((attr >> 18) & 7) !== 0, color: col === '000000' ? null : col })
      } else if (r.tag === TAG.CHAR_SHAPE) charShapes.push({})
      else if (r.tag === TAG.PARA_SHAPE && r.data.length >= 4) {
        const attr = dv.getUint32(0, true)
        paraShapes.push({ align: ['justify', 'left', 'right', 'center', null, null][(attr >> 2) & 7] ?? null, headType: (attr >> 23) & 3, headLevel: (attr >> 25) & 7 })
      } else if (r.tag === TAG.STYLE && r.data.length >= 2) {
        const n = dv.getUint16(0, true)
        styles.push({ name: r.data.length >= 2 + n * 2 ? new TextDecoder('utf-16le').decode(r.data.subarray(2, 2 + n * 2)) : '' })
      }
    }
  }

  const jobs = []
  const decodePara = (node) => {
    const hd = new DataView(node.data.buffer, node.data.byteOffset, node.data.byteLength)
    const paraShapeId = node.data.length >= 10 ? hd.getUint16(8, true) : 0
    const styleId = node.data.length >= 11 ? node.data[10] : 0
    const textRec = node.kids.find((k) => k.tag === TAG.PARA_TEXT)
    const csRec = node.kids.find((k) => k.tag === TAG.PARA_CHAR_SHAPE)
    const ctrls = node.kids.filter((k) => k.tag === TAG.CTRL_HEADER)
    const shapeAt = []
    if (csRec) { const dv = new DataView(csRec.data.buffer, csRec.data.byteOffset, csRec.data.byteLength); for (let o = 0; o + 8 <= csRec.data.length; o += 8) shapeAt.push([dv.getUint32(o, true), dv.getUint32(o + 4, true)]) }
    const styleFor = (pos) => { let id = shapeAt.length ? shapeAt[0][1] : 0; for (const [p, s] of shapeAt) { if (p <= pos) id = s; else break } return charShapes[id] || {} }
    const runs = []
    const tables = []
    let ci = 0
    const addText = (text, style) => {
      if (!text) return
      const run = { text }
      if (style.b) run.b = true
      if (style.i) run.i = true
      if (style.u) run.u = true
      if (style.s) run.s = true
      if (style.color) run.color = style.color
      if (style.size && style.size !== 10 && style.size > 0 && style.size < 200) run.size = style.size
      const prev = runs[runs.length - 1]
      const keys = ['b', 'i', 'u', 's', 'color', 'size']
      if (prev && prev.text !== undefined && keys.every((k) => prev[k] === run[k])) prev.text += text
      else runs.push(run)
    }
    if (textRec) {
      const d = textRec.data
      const dv = new DataView(d.buffer, d.byteOffset, d.byteLength)
      const n = d.length >> 1
      let buf = '', bufStyle = null, bufShape = null
      const flush = () => { if (buf) { addText(buf, bufStyle || {}); buf = '' } }
      for (let i = 0; i < n; i++) {
        const c = dv.getUint16(i * 2, true)
        const st = styleFor(i)
        if (c >= 32) { if (buf && st !== bufShape) flush(); bufShape = st; bufStyle = st; buf += String.fromCharCode(c); continue }
        flush()
        if (c === 13) break
        if (c === 10) { runs.push({ br: true }); continue }
        if (c === 24) { addText('-', st); continue }
        if (c === 30 || c === 31) { addText(' ', st); continue }
        const ext = [1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23].includes(c)
        const inline = [4, 5, 6, 7, 8, 9, 19, 20].includes(c)
        if (c === 9) runs.push({ tab: true })
        if (ext) {
          const ctrl = ctrls[ci++]
          if (ctrl && ctrl.data.length >= 4) {
            const id = ctrlId(new DataView(ctrl.data.buffer, ctrl.data.byteOffset, 4))
            if (id === 'tbl ') tables.push(ctrl)
            else if (id === 'gso ') { const pic = findPicture(ctrl); if (pic) { const run = { img: { raw: null, alt: '', w: pic.w, h: pic.h, _bin: pic.bin } }; jobs.push(run); runs.push(run) } }
          }
        }
        if (ext || inline) i += 7
      }
      flush()
    } else for (const c of ctrls) { void c }
    const out = { t: 'p', runs }
    const ps = paraShapes[paraShapeId]
    if (ps?.align && ps.align !== 'justify') out.align = ps.align
    const sname = styles[styleId]?.name || ''
    let level = 0
    const m = /^(?:개요|제목|Outline|Heading|Title)\s*(\d)?/i.exec(sname)
    if (m) level = m[1] ? +m[1] : 1
    else if (ps?.headType === 1) level = (ps.headLevel || 0) + 1
    if (level) out.level = Math.min(6, level)
    else if (ps?.headType === 3) out.list = { ordered: false, level: Math.min(ps.headLevel || 0, 5), n: 1 }
    else if (ps?.headType === 2) out.list = { ordered: true, level: Math.min(ps.headLevel || 0, 5), n: 1, type: 'decimal' }
    return { para: out, tables }
  }
  function findPicture(ctrl) {
    const dv = new DataView(ctrl.data.buffer, ctrl.data.byteOffset, ctrl.data.byteLength)
    const w = ctrl.data.length >= 24 ? hu2px(dv.getUint32(16, true)) : 0, h = ctrl.data.length >= 24 ? hu2px(dv.getUint32(20, true)) : 0
    const stack = [ctrl]
    while (stack.length) {
      const n = stack.pop()
      if (n.tag === TAG.PICTURE && n.data.length >= 73) return { bin: new DataView(n.data.buffer, n.data.byteOffset, n.data.byteLength).getUint16(71, true), w, h }
      stack.push(...n.kids)
    }
    return null
  }
  function tableOf(ctrl) {
    const tRec = ctrl.kids.find((k) => k.tag === TAG.TABLE)
    const dvT = tRec ? new DataView(tRec.data.buffer, tRec.data.byteOffset, tRec.data.byteLength) : null
    const rowCnt = dvT && tRec.data.length >= 8 ? dvT.getUint16(4, true) : 0, colCnt = dvT && tRec.data.length >= 8 ? dvT.getUint16(6, true) : 0
    const cells = []
    let cur = null
    const startCell = (rec) => {
      const dv = new DataView(rec.data.buffer, rec.data.byteOffset, rec.data.byteLength)
      const read = (off) => (rec.data.length >= off + 8 ? { col: dv.getUint16(off, true), row: dv.getUint16(off + 2, true), cs: dv.getUint16(off + 4, true), rs: dv.getUint16(off + 6, true) } : null)
      let c = read(8)
      const sane = (x) => x && x.cs >= 1 && x.rs >= 1 && x.cs <= Math.max(colCnt, 1) && x.rs <= Math.max(rowCnt, 1) && (!colCnt || x.col < colCnt) && (!rowCnt || x.row < rowCnt)
      if (!sane(c)) { const alt = read(6); if (sane(alt)) c = alt }
      cur = { ...(sane(c) ? c : { col: cells.length % Math.max(colCnt, 1), row: Math.floor(cells.length / Math.max(colCnt, 1)), cs: 1, rs: 1 }), blocks: [] }
      cells.push(cur)
    }
    const takeParas = (nodes) => {
      for (const k of nodes) {
        if (k.tag === TAG.LIST_HEADER) { startCell(k); takeParas(k.kids) }
        else if (k.tag === TAG.PARA_HEADER && cur) emitPara(k, cur.blocks)
      }
    }
    takeParas(ctrl.kids)
    if (!cells.length) return null
    // lay out by row
    const byRow = new Map()
    for (const c of cells) { if (!byRow.has(c.row)) byRow.set(c.row, []); byRow.get(c.row).push(c) }
    const rows = [...byRow.keys()].sort((a, b) => a - b).map((r) => byRow.get(r).sort((a, b) => a.col - b.col).map((c) => ({ blocks: c.blocks.length ? c.blocks : [{ t: 'p', runs: [{ text: '' }] }], th: false, colspan: c.cs, rowspan: c.rs, bg: null })))
    return { t: 'table', rows, border: true }
  }
  function emitPara(node, out) {
    const { para, tables } = decodePara(node)
    const has = para.runs.some((r) => r.text?.trim() || r.img || r.br)
    if (has || !tables.length) out.push(para)
    for (const t of tables) { const tb = tableOf(t); if (tb) out.push(tb) }
  }

  const blocks = []
  const sectionNames = (cfb.FullPaths || []).map((p, i) => ({ p, e: cfb.FileIndex[i] })).filter((x) => /(^|\/)BodyText\/Section\d+$/i.test(x.p.replace(/\/$/, ''))).sort((a, b) => parseInt(a.p.match(/(\d+)$/)[1], 10) - parseInt(b.p.match(/(\d+)$/)[1], 10))
  if (!sectionNames.length) throw fail('No document text was found in this HWP file.')
  for (const s of sectionNames) {
    const data = await inflate(Uint8Array.from(s.e.content))
    const recs = parseRecords(data)
    for (const r of recs) if (r.tag === TAG.PARA_HEADER) emitPara(r, blocks)
  }
  // pictures
  await Promise.all(jobs.map(async (run) => {
    const im = run.img
    const info = bins[im._bin - 1]
    delete im._bin
    let bytes = null
    if (info) {
      const name = `BIN${info.id.toString(16).toUpperCase().padStart(4, '0')}.${info.ext}`
      const e = X.CFB.find(cfb, `/BinData/${name}`) || (cfb.FullPaths || []).map((p, i) => ({ p, e: cfb.FileIndex[i] })).find((x) => new RegExp(`BIN${info.id.toString(16).padStart(4, '0')}\\.`, 'i').test(x.p))?.e
      if (e?.content) { bytes = Uint8Array.from(e.content); if (compressed) { try { bytes = await inflateRaw(bytes) } catch { /* stored */ } } }
    }
    const norm = bytes ? await normalizeImage(bytes, sniffImage(bytes)) : null
    if (!norm) { delete run.img; run.text = ''; return }
    run.img = { bytes: norm.bytes, mime: norm.mime, w: im.w || norm.w, h: im.h || norm.h, alt: '' }
  }))
  const prune = (list) => { for (const b of list) { if (b.t === 'p') b.runs = b.runs.filter((r) => !(r.text === '' && !r.br && !r.img && !r.tab)); else if (b.t === 'table') for (const row of b.rows) for (const c of row) prune(c.blocks) } }
  prune(blocks)
  while (blocks.length && blocks[blocks.length - 1].t === 'p' && !blocks[blocks.length - 1].runs.length) blocks.pop()
  if (!blocks.length) throw fail('No text was found in this HWP file.')
  return { blocks, title: '' }
}

/** Either flavour: bytes -> {blocks, title}. */
export async function hwpToBlocks(bytes) {
  if (isHwp5(bytes)) return hwp5ToBlocks(bytes)
  if (isHwpx(bytes)) return hwpxToBlocks(bytes)
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 30))
  if (/HWP Document File V3/.test(head)) throw fail('This is an HWP 3.x file (very old format). Open it in a current word processor and save it as HWPX or HWP 5 first.')
  throw fail('This does not look like an HWP or HWPX document.')
}

// ------------------------------------------------------------------ HWPX writer
const NS = 'xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"'
const PAGE_W = 59528, PAGE_H = 84188, MARGIN_LR = 8504, TEXT_W = PAGE_W - 2 * MARGIN_LR

/** Blocks -> minimal HWPX package. Text, bold / italic / underline / strikeout, sizes and colours, headings, alignment, lists (as text markers) and tables. -> Uint8Array */
export async function astToHwpx(blocks, { title = '' } = {}) {
  const JSZip = await jszip()
  const chars = [] // charPr definitions
  const charKey = new Map()
  const charId = (st) => {
    const key = JSON.stringify([!!st.b, !!st.i, !!st.u, !!st.s, st.size || 10, st.color || ''])
    if (!charKey.has(key)) { charKey.set(key, chars.length); chars.push({ b: !!st.b, i: !!st.i, u: !!st.u, s: !!st.s, size: st.size || 10, color: st.color || '000000' }) }
    return charKey.get(key)
  }
  charId({})
  const paras = [] // paraPr definitions
  const paraKey = new Map()
  const paraId = (align, left = 0) => {
    const key = `${align || 'justify'}|${left}`
    if (!paraKey.has(key)) { paraKey.set(key, paras.length); paras.push({ align: { left: 'LEFT', right: 'RIGHT', center: 'CENTER', justify: 'JUSTIFY' }[align || 'justify'], left }) }
    return paraKey.get(key)
  }
  paraId(null)
  let nextId = 1000
  let first = true
  const HEAD_SIZE = [10, 20, 16, 14, 12, 11, 10]

  const secPr = `<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="1" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0"><hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/><hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/><hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/><hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/><hp:pagePr landscape="WIDELY" width="${PAGE_W}" height="${PAGE_H}" gutterType="LEFT_ONLY"><hp:margin header="4252" footer="4252" gutter="0" left="${MARGIN_LR}" right="${MARGIN_LR}" top="5668" bottom="4252"/></hp:pagePr><hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr><hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/></hp:endNotePr><hp:pageBorderFill type="BOTH" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill></hp:secPr><hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>`

  const runXml = (r) => {
    if (r.br) return '<hp:run charPrIDRef="0"><hp:t><hp:lineBreak/></hp:t></hp:run>'
    if (r.tab) return '<hp:run charPrIDRef="0"><hp:t><hp:tab width="4000" leader="0" type="1"/></hp:t></hp:run>'
    if (r.img) return `<hp:run charPrIDRef="0"><hp:t>${xesc(r.img.alt ? `[${r.img.alt}]` : '')}</hp:t></hp:run>`
    return `<hp:run charPrIDRef="${charId(r)}"><hp:t>${xesc(r.text || '')}</hp:t></hp:run>`
  }
  const paraXml = (runs, { align, left = 0, style = 0, size } = {}) => {
    const pid = paraId(align, left)
    let inner = runs.map(runXml).join('') || '<hp:run charPrIDRef="0"><hp:t></hp:t></hp:run>'
    if (first) { first = false; inner = `<hp:run charPrIDRef="0">${secPr}</hp:run>` + inner }
    void size
    return `<hp:p id="${nextId++}" paraPrIDRef="${pid}" styleIDRef="${style}" pageBreak="0" columnBreak="0" merged="0">${inner}</hp:p>`
  }
  const listPrefix = (b) => (b.list.ordered ? `${b.list.n}. ` : '• ')
  const tableXml = (t) => {
    const ncols = Math.max(...t.rows.map((r) => r.reduce((n, c) => n + c.colspan, 0)), 1)
    const colW = Math.floor(TEXT_W / ncols)
    const rowH = 1700
    const id = nextId++
    const occ = []
    let rowsXml = ''
    t.rows.forEach((row, ri) => {
      occ[ri] ||= []
      let ci = 0
      let cellsXml = ''
      for (const c of row) {
        while (occ[ri][ci]) ci++
        const sub = c.blocks.map((b) => (b.t === 'p' ? paraXml(b.runs.length ? (b.list ? [{ text: listPrefix(b) }, ...b.runs] : b.runs) : [{ text: '' }], { align: b.align }) : '')).filter(Boolean).join('') || paraXml([{ text: '' }])
        cellsXml += `<hp:tc name="" header="${c.th ? 1 : 0}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="2"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${sub}</hp:subList><hp:cellAddr colAddr="${ci}" rowAddr="${ri}"/><hp:cellSpan colSpan="${c.colspan}" rowSpan="${c.rowspan}"/><hp:cellSz width="${colW * c.colspan}" height="${rowH * c.rowspan}"/><hp:cellMargin left="510" right="510" top="141" bottom="141"/></hp:tc>`
        for (let rr = 0; rr < c.rowspan; rr++) for (let cc = 0; cc < c.colspan; cc++) { if (rr || cc) (occ[ri + rr] ||= [])[ci + cc] = true }
        ci += c.colspan
      }
      rowsXml += `<hp:tr>${cellsXml}</hp:tr>`
    })
    const tbl = `<hp:tbl id="${id}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="0" rowCnt="${t.rows.length}" colCnt="${ncols}" cellSpacing="0" borderFillIDRef="2" noAdjust="0"><hp:sz width="${colW * ncols}" widthRelTo="ABSOLUTE" height="${rowH * t.rows.length}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="510" right="510" top="141" bottom="141"/>${rowsXml}</hp:tbl>`
    let inner = `<hp:run charPrIDRef="0">${tbl}<hp:t></hp:t></hp:run>`
    if (first) { first = false; inner = `<hp:run charPrIDRef="0">${secPr}</hp:run>` + inner }
    return `<hp:p id="${nextId++}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${inner}</hp:p>`
  }

  let body = ''
  for (const b of blocks) {
    if (b.t === 'p') {
      let runs = b.runs
      if (b.level) runs = runs.map((r) => (r.text !== undefined ? { ...r, b: true, size: HEAD_SIZE[b.level] } : r))
      if (b.code) runs = runs.map((r) => (r.text !== undefined ? { ...r, size: 9 } : r))
      if (b.list) runs = [{ text: listPrefix(b) }, ...runs]
      if (b.task !== undefined) runs = [{ text: b.task ? '☑ ' : '☐ ' }, ...runs]
      body += paraXml(runs, { style: b.level ? Math.min(6, b.level) : 0, align: b.align, left: b.list ? 1500 * (b.list.level + 1) : b.cont != null ? 1500 * (b.cont + 2) : b.quote ? 1500 * b.quote : 0 })
    } else if (b.t === 'table') body += tableXml(b)
    else if (b.t === 'hr') body += paraXml([{ text: '─'.repeat(30) }])
  }
  if (first) body = paraXml([{ text: '' }])

  const charPr = (c, i) => `<hh:charPr id="${i}" height="${Math.round(c.size * 100)}" textColor="#${c.color.toUpperCase()}" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1"><hh:fontRef hangul="0" latin="1" hanja="0" japanese="0" other="1" symbol="1" user="1"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>${c.i ? '<hh:italic/>' : ''}${c.b ? '<hh:bold/>' : ''}<hh:underline type="${c.u ? 'BOTTOM' : 'NONE'}" shape="SOLID" color="#000000"/><hh:strikeout shape="${c.s ? 'SOLID' : 'NONE'}" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr>`
  const paraPr = (p, i) => `<hh:paraPr id="${i}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0"><hh:align horizontal="${p.align}" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/><hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/><hh:autoSpacing eAsianEng="0" eAsianNum="0"/><hh:margin><hc:intent value="0" unit="HWPUNIT"/><hc:left value="${p.left}" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="400" unit="HWPUNIT"/></hh:margin><hh:lineSpacing type="PERCENT" value="160" unit="HWPUNIT"/><hh:border borderFillIDRef="1" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/></hh:paraPr>`
  const font = (id, face) => `<hh:font id="${id}" face="${face}" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>`
  const fontface = (lang) => `<hh:fontface lang="${lang}" fontCnt="2">${font(0, '맑은 고딕')}${font(1, 'Arial')}</hh:fontface>`
  const border = (kind) => ['left', 'right', 'top', 'bottom'].map((s) => `<hh:${s}Border type="${kind}" width="0.12 mm" color="#000000"/>`).join('')
  const borderFill = (id, kind) => `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>${border(kind)}<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/></hh:borderFill>`
  for (let n = 1; n <= 6; n++) charId({ b: true, size: HEAD_SIZE[n] })
  const header = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<hh:head ${NS} version="1.4" secCnt="1"><hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/><hh:refList><hh:fontfaces itemCnt="7">${['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER'].map(fontface).join('')}</hh:fontfaces><hh:borderFills itemCnt="2">${borderFill(1, 'NONE')}${borderFill(2, 'SOLID')}</hh:borderFills><hh:charProperties itemCnt="${chars.length}">${chars.map(charPr).join('')}</hh:charProperties><hh:tabProperties itemCnt="1"><hh:tabPr id="0" autoTabLeft="0" autoTabRight="0"/></hh:tabProperties><hh:paraProperties itemCnt="${paras.length}">${paras.map(paraPr).join('')}</hh:paraProperties><hh:styles itemCnt="7"><hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/>${[1, 2, 3, 4, 5, 6].map((n) => `<hh:style id="${n}" type="PARA" name="개요 ${n}" engName="Outline ${n}" paraPrIDRef="0" charPrIDRef="${charId({ b: true, size: HEAD_SIZE[n] })}" nextStyleIDRef="0" langID="1042" lockForm="0"/>`).join("")}</hh:styles></hh:refList><hh:compatibleDocument targetProgram="HWP201X"><hh:layoutCompatibility/></hh:compatibleDocument><hh:docOption><hh:linkinfo path="" pageInherit="0" footnoteInherit="0"/></hh:docOption><hh:trackchageConfig flags="56"/></hh:head>`
  const section = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<hs:sec ${NS}>${body}</hs:sec>`
  const hpf = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<opf:package ${NS} version="" unique-identifier="" id=""><opf:metadata><opf:title>${xesc(title)}</opf:title><opf:language>ko</opf:language></opf:metadata><opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/><opf:item id="settings" href="settings.xml" media-type="application/xml"/></opf:manifest><opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>`
  const zip = new JSZip()
  const opt = { createFolders: false }
  zip.file('mimetype', 'application/hwp+zip', { compression: 'STORE', ...opt })
  zip.file('version.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="0" micro="5" buildNumber="0" os="1" xmlVersion="1.4" application="Toolverse" appVersion="1"/>', opt)
  zip.file('settings.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>', opt)
  zip.file('META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/><ocf:rootfile full-path="Preview/PrvText.txt" media-type="text/plain"/></ocf:rootfiles></ocf:container>', opt)
  zip.file('META-INF/manifest.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>', opt)
  zip.file('Contents/content.hpf', hpf, opt)
  zip.file('Contents/header.xml', header, opt)
  zip.file('Contents/section0.xml', section, opt)
  const { astToText } = await import('./_ast.js')
  zip.file('Preview/PrvText.txt', astToText(blocks).slice(0, 2000), opt)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/hwp+zip' })
}
void kids
