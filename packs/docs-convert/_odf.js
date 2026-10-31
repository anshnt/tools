// OpenDocument text reader (.odt, .ott and flat .fodt) -> blocks (see _ast.js). Resolves named and automatic styles (character, paragraph, table cell),
// headings, lists with their numbering style, tables with spans and shading, footnotes (as end notes), links and embedded pictures.
import { jszip } from '../../lib/libs.js'
import { fail, parseXml, kids, kid, deep, attrNS, sniffImage, base64ToBytes, hex6 } from './_util.js'

const A = (el, name) => attrNS(el, name)
const lenPx = (v) => {
  const m = /^(-?[\d.]+)\s*(cm|mm|in|pt|px|pc)?$/.exec(String(v || '').trim())
  if (!m) return 0
  const n = parseFloat(m[1])
  return { cm: n * 37.795, mm: n * 3.7795, in: n * 96, pt: n * 1.3333, px: n, pc: n * 16 }[m[2] || 'px']
}

/** Open an ODF text document: {zip, content, styles, meta} (zip is null for flat XML). Throws a readable error. */
export async function openOdf(bytes) {
  const head = new TextDecoder().decode(bytes.subarray(0, 200))
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const JSZip = await jszip()
    let zip
    try { zip = await JSZip.loadAsync(bytes) } catch { throw fail('This file is not a valid OpenDocument file.') }
    if (!zip.file('content.xml')) throw fail('This file does not contain OpenDocument content (content.xml is missing).')
    const mt = zip.file('mimetype') ? (await zip.file('mimetype').async('string')).trim() : ''
    return {
      zip, mimetype: mt, content: parseXml(await zip.file('content.xml').async('string'), 'document'),
      styles: zip.file('styles.xml') ? parseXml(await zip.file('styles.xml').async('string'), 'styles') : null,
      meta: zip.file('meta.xml') ? parseXml(await zip.file('meta.xml').async('string'), 'metadata') : null,
    }
  }
  if (/<office:document[\s>]/.test(head) || (/<\?xml/.test(head) && /office:document/.test(new TextDecoder().decode(bytes.subarray(0, 4000))))) {
    const doc = parseXml(new TextDecoder().decode(bytes), 'document')
    return { zip: null, mimetype: doc.documentElement.getAttribute('office:mimetype') || '', content: doc, styles: doc, meta: doc }
  }
  throw fail('This does not look like an OpenDocument file. If it is an old .doc or .sxw file, save it as .odt first.')
}

function collectStyles(docs) {
  const styles = new Map(), lists = new Map(), fonts = new Map()
  for (const d of docs.filter(Boolean)) {
    for (const f of deep(d, 'font-face')) fonts.set(A(f, 'name'), A(f, 'font-family')?.replace(/['"]/g, ''))
    for (const s of deep(d, 'style')) {
      if (s.parentNode?.localName === 'default-style') continue
      const fam = A(s, 'family'), name = A(s, 'name')
      if (!fam || !name) continue
      const tp = kid(s, 'text-properties'), pp = kid(s, 'paragraph-properties'), cp = kid(s, 'table-cell-properties')
      styles.set(`${fam}:${name}`, { parent: A(s, 'parent-style-name'), display: A(s, 'display-name') || name, outline: A(s, 'default-outline-level'), tp, pp, cp, list: A(s, 'list-style-name') })
    }
    for (const ls of deep(d, 'list-style')) lists.set(A(ls, 'name'), ls)
    for (const ds of deep(d, 'default-style')) {
      const fam = A(ds, 'family')
      styles.set(`default:${fam}`, { tp: kid(ds, 'text-properties'), pp: kid(ds, 'paragraph-properties') })
    }
  }
  return { styles, lists, fonts }
}

/** ODF text document -> {blocks, title}. */
export function odfToBlocks(odf, rootEl = null) {
  const { styles, lists, fonts } = collectStyles([odf.styles, odf.content])
  const imgCache = new Map()
  const notes = []
  const blocks = []

  // ---- style helpers
  const chain = (fam, name) => {
    const out = []
    let n = name, guard = 0
    while (n && guard++ < 10) { const s = styles.get(`${fam}:${n}`); if (!s) break; out.unshift(s); n = s.parent }
    return out
  }
  const textProps = (fam, name) => {
    const p = {}
    const apply = (tp) => {
      if (!tp) return
      const g = (k) => tp.getAttribute(k)
      const w = g('fo:font-weight'); if (w) p.b = w === 'bold' || +w >= 600
      const it = g('fo:font-style'); if (it) p.i = it === 'italic' || it === 'oblique'
      const u = g('style:text-underline-style'); if (u) p.u = u !== 'none'
      const s = g('style:text-line-through-style'); if (s) p.s = s !== 'none'
      const c = g('fo:color'); if (c) p.color = hex6(c)
      const bg = g('fo:background-color'); if (bg) p.bg = bg === 'transparent' ? null : hex6(bg)
      const fs = g('fo:font-size'); if (fs && /pt$/.test(fs)) p.size = parseFloat(fs)
      const ff = g('fo:font-family') || fonts.get(g('style:font-name')) || fonts.get(g('style:font-name-asian')); if (ff) { p.font = ff.replace(/['"]/g, '').split(',')[0].trim(); if (/mono|courier|consolas/i.test(ff)) p.mono = true }
      const pos = g('style:text-position'); if (pos) { const v = parseFloat(pos); p.sup = /^super/.test(pos) || (!/^sub/.test(pos) && v > 0 && /^[\d.]/.test(pos)); p.sub = /^sub/.test(pos) || (/^-/.test(pos)) }
      if (g('text:display') === 'none') p.hidden = true
    }
    for (const s of chain(fam, name)) apply(s.tp)
    return p
  }
  const paraInfo = (name) => {
    const info = { align: null, level: 0, code: false, quote: false }
    for (const s of chain('paragraph', name)) {
      const a = s.pp?.getAttribute('fo:text-align')
      if (a) info.align = { start: 'left', left: 'left', end: 'right', right: 'right', center: 'center', justify: 'justify' }[a] || null
      const d = s.display || ''
      const m = /^heading[ _]?(\d)/i.exec(d)
      if (m) info.level = +m[1]
      else if (/^title$/i.test(d)) info.level = 1
      else if (/^subtitle$/i.test(d)) info.level = 2
      if (/preformatted|source|code|verbatim/i.test(d)) info.code = true
      if (/quotation|block quote/i.test(d)) info.quote = true
    }
    return info
  }
  const cellStyle = (name) => {
    let bg = null, border = false
    for (const s of chain('table-cell', name)) {
      const b = s.cp?.getAttribute('fo:background-color'); if (b) bg = b === 'transparent' ? null : hex6(b)
      for (const k of ['fo:border', 'fo:border-top', 'fo:border-left', 'fo:border-bottom', 'fo:border-right']) { const v = s.cp?.getAttribute(k); if (v && v !== 'none' && !/^0/.test(v)) border = true }
    }
    return { bg: bg && bg !== 'ffffff' ? bg : null, border }
  }
  const listKind = (styleName, level) => {
    const ls = lists.get(styleName)
    if (!ls) return { ordered: false }
    const lv = [...ls.children].find((c) => A(c, 'level') === String(level + 1)) || ls.children[0]
    if (!lv) return { ordered: false }
    if (lv.localName === 'list-level-style-number') {
      const fmt = A(lv, 'num-format')
      return { ordered: true, type: { 1: 'decimal', a: 'lower-alpha', A: 'upper-alpha', i: 'lower-roman', I: 'upper-roman' }[fmt] || 'decimal' }
    }
    return { ordered: false }
  }

  // ---- images
  const loadImage = async () => {}
  void loadImage
  const imageOf = (frame, imgEl) => {
    const href = A(imgEl, 'href')
    let bytes = null
    const bin = kid(imgEl, 'binary-data')
    if (bin) { try { bytes = base64ToBytes(bin.textContent) } catch { /* ignore */ } }
    else if (href && odf.zip) {
      const path = href.replace(/^\.\//, '')
      if (imgCache.has(path)) bytes = imgCache.get(path)
      else { imgCache.set(path, null); pendingImages.push(path) }
    }
    return { href, bytes }
  }
  const pendingImages = []

  // ---- inline content
  function inline(node, base, runs, ctx) {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        const t = n.data.replace(/[ \t\r\n]+/g, ' ')
        if (t) pushText(runs, t, base)
        continue
      }
      if (n.nodeType !== 1) continue
      const ln = n.localName
      switch (ln) {
        case 's': pushText(runs, ' '.repeat(parseInt(A(n, 'c') || '1', 10)), base); break
        case 'tab': runs.push({ tab: true }); break
        case 'line-break': runs.push({ br: true }); break
        case 'span': {
          const tp = textProps('text', A(n, 'style-name'))
          if (tp.hidden) break
          inline(n, { ...base, ...pick(tp) }, runs, ctx)
          break
        }
        case 'a': inline(n, { ...base, href: A(n, 'href') || undefined, ...(base.href ? {} : {}) }, runs, ctx); break
        case 'note': {
          const body = kid(n, 'note-body')
          const cit = kid(n, 'note-citation')
          const label = cit?.textContent || String(notes.length + 1)
          runs.push({ text: `[${label}]`, sup: true, ...pickBase(base) })
          if (body) { const nb = []; blocksOf(body, nb, ctx); notes.push({ label, blocks: nb }) }
          break
        }
        case 'frame': {
          const img = deep(n, 'image')[0]
          const tb = deep(n, 'text-box')[0]
          if (img) {
            const w = lenPx(A(n, 'width')), hgt = lenPx(A(n, 'height'))
            const r = imageOf(n, img)
            const run = { img: { raw: null, alt: kid(n, 'desc')?.textContent || A(n, 'name') || '', w: Math.round(w) || 0, h: Math.round(hgt) || 0, _path: r.href, _bytes: r.bytes } }
            runs.push(run)
          } else if (tb) { runs.frames = runs.frames || []; runs.frames.push(tb) }
          break
        }
        case 'image': { const r = imageOf(n, n); runs.push({ img: { raw: null, alt: '', w: 0, h: 0, _path: r.href, _bytes: r.bytes } }); break }
        case 'annotation': case 'annotation-end': case 'bookmark': case 'bookmark-start': case 'bookmark-end': case 'tracked-changes': case 'change': case 'change-start': case 'change-end': break
        case 'soft-page-break': break
        case 'title': case 'desc': break
        default: inline(n, base, runs, ctx)
      }
    }
  }
  const pick = (tp) => {
    const o = {}
    for (const k of ['b', 'i', 'u', 's', 'sup', 'sub', 'mono', 'color', 'bg', 'size', 'font']) if (tp[k] !== undefined && tp[k] !== null && tp[k] !== false) o[k] = tp[k]; else if (tp[k] === false) o[k] = false
    return o
  }
  const pickBase = (b) => { const o = {}; for (const k of ['b', 'i', 'u', 's', 'mono', 'color', 'bg', 'size', 'font']) if (b[k]) o[k] = b[k]; return o }
  function pushText(runs, t, base) {
    const run = { text: t }
    for (const k of ['b', 'i', 'u', 's', 'sup', 'sub', 'mono', 'color', 'bg', 'size', 'font', 'href']) if (base[k]) run[k] = base[k]
    const prev = runs[runs.length - 1]
    const keys = ['b', 'i', 'u', 's', 'sup', 'sub', 'mono', 'color', 'bg', 'size', 'font', 'href']
    if (prev && prev.text !== undefined && keys.every((k) => prev[k] === run[k])) prev.text += t
    else runs.push(run)
  }

  // ---- blocks
  function paragraph(el, out, ctx, listInfo) {
    const sname = A(el, 'style-name')
    const info = paraInfo(sname)
    const base = pick(textProps('paragraph', sname))
    const runs = []
    runs.frames = null
    inline(el, base, runs, ctx)
    // trim edge whitespace
    while (runs.length && runs[0].text !== undefined && !/\S/.test(runs[0].text)) runs.shift()
    if (runs[0]?.text !== undefined) runs[0].text = runs[0].text.replace(/^ +/, '')
    while (runs.length && runs[runs.length - 1].text !== undefined && !/\S/.test(runs[runs.length - 1].text)) runs.pop()
    const last = runs[runs.length - 1]
    if (last?.text !== undefined) last.text = last.text.replace(/ +$/, '')
    const frames = runs.frames
    const p = { t: 'p', runs: runs.length ? runs : [{ text: '' }] }
    if (el.localName === 'h') p.level = Math.min(6, parseInt(A(el, 'outline-level') || '1', 10) || 1)
    else if (info.level) p.level = info.level
    if (info.align) p.align = info.align
    if (info.code) p.code = true
    if (info.quote) p.quote = 1
    if (listInfo && !p.level) p.list = listInfo
    // an empty paragraph is kept only when it is not the lone filler of a table cell
    if (runs.length || ctx.keepEmpty !== false) out.push(p)
    if (frames) for (const f of frames) blocksOf(f, out, ctx)
  }

  function list(el, out, ctx, depth = 0, parentStyle = null) {
    const style = A(el, 'style-name') || parentStyle
    let n = (parseInt(A(el, 'start-value') || '1', 10) || 1) - 1
    for (const item of el.children) {
      if (item.localName !== 'list-item' && item.localName !== 'list-header') continue
      if (item.localName === 'list-item') { const sv = A(item, 'start-value'); n = sv ? parseInt(sv, 10) : n + 1 }
      let first = true
      for (const c of item.children) {
        if (c.localName === 'list') list(c, out, ctx, depth + 1, style)
        else if (c.localName === 'p' || c.localName === 'h') {
          const kind = listKind(style, depth)
          paragraph(c, out, ctx, first && item.localName === 'list-item' ? { ordered: kind.ordered, level: depth, n, type: kind.type || 'decimal' } : null)
          if (!first || item.localName !== 'list-item') out[out.length - 1].cont = out[out.length - 1].cont ?? depth
          first = false
        } else blocksOf(c, out, ctx)
      }
    }
  }

  function table(el, out, ctx) {
    const rows = []
    let border = false
    const occ = []
    const rowEls = []
    const gather = (e) => { for (const c of e.children) { if (c.localName === 'table-row') rowEls.push(c); else if (['table-header-rows', 'table-rows', 'table-row-group'].includes(c.localName)) gather(c) } }
    gather(el)
    let ri = 0
    for (const re of rowEls) {
      const repRow = Math.min(parseInt(A(re, 'number-rows-repeated') || '1', 10) || 1, 200)
      const cells = []
      let ci = 0
      occ[ri] ||= []
      for (const ce of re.children) {
        if (ce.localName !== 'table-cell' && ce.localName !== 'covered-table-cell') continue
        const rep = Math.min(parseInt(A(ce, 'number-columns-repeated') || '1', 10) || 1, 100)
        if (ce.localName === 'covered-table-cell') { ci += rep; continue }
        const sub = []
        blocksOf(ce, sub, { ...ctx, keepEmpty: false })
        const cs = cellStyle(A(ce, 'style-name'))
        if (cs.border) border = true
        const cell = { blocks: sub.length ? sub : [{ t: 'p', runs: [{ text: '' }] }], th: false, colspan: parseInt(A(ce, 'number-columns-spanned') || '1', 10) || 1, rowspan: parseInt(A(ce, 'number-rows-spanned') || '1', 10) || 1, bg: cs.bg, _empty: !sub.length }
        for (let k = 0; k < rep; k++) cells.push({ ...cell, blocks: k ? JSON.parse(JSON.stringify(sub.length ? sub : [{ t: 'p', runs: [{ text: '' }] }])) : cell.blocks })
        ci += rep
      }
      // trim trailing empty cells (spreadsheet-like padding)
      while (cells.length && cells[cells.length - 1]._empty && cells[cells.length - 1].colspan === 1) cells.pop()
      const isEmptyRow = !cells.length
      for (let k = 0; k < repRow; k++) { if (!(isEmptyRow && repRow > 1)) rows.push(cells.map((c) => ({ ...c }))) }
      ri += repRow
    }
    for (const r of rows) for (const c of r) delete c._empty
    if (rows.length) out.push({ t: 'table', rows, border: border || true })
  }

  function blocksOf(parent, out, ctx) {
    for (const c of parent.children) {
      switch (c.localName) {
        case 'p': case 'h': {
          if (c.localName === 'h' || c.localName === 'p') { const sn = A(c, 'style-name'); if (textProps('paragraph', sn).hidden) break }
          paragraph(c, out, ctx, null)
          break
        }
        case 'list': list(c, out, ctx); break
        case 'table': table(c, out, ctx); break
        case 'section': case 'index-body': case 'table-of-content': case 'illustration-index': case 'alphabetical-index': case 'user-index': case 'index-title': case 'text-box': case 'table-of-content-source': {
          if (c.localName === 'table-of-content-source') break
          blocksOf(c, out, ctx)
          break
        }
        case 'soft-page-break': case 'tracked-changes': case 'sequence-decls': case 'variable-decls': case 'user-field-decls': case 'forms': break
        default: break
      }
    }
  }

  const body = rootEl || deep(odf.content, 'text').find((e) => e.parentNode?.localName === 'body')
  if (!body) throw fail('This OpenDocument file is not a text document (no .odt content found).')
  const ctx = {}
  blocksOf(body, blocks, ctx)
  // end notes
  if (notes.length) {
    blocks.push({ t: 'hr' })
    for (const n of notes) {
      const first = n.blocks.find((b) => b.t === 'p')
      if (first) first.runs.unshift({ text: `[${n.label}] `, sup: false })
      blocks.push(...n.blocks)
    }
  }
  const title = kid(kid(odf.meta?.documentElement, 'meta'), 'title')?.textContent || deep(odf.meta || odf.content, 'title').find((e) => e.namespaceURI?.includes('purl.org/dc'))?.textContent || ''
  return { blocks, title: title.trim(), needsImages: pendingImages }
}

/** Fill in picture bytes (reads the files from the package), then size them. Drops pictures that cannot be read. */
export async function odfLoadImages(odf, blocks) {
  const { normalizeImage } = await import('./_util.js')
  const jobs = []
  const visit = (list) => {
    for (const b of list) {
      if (b.t === 'p') for (const r of b.runs) if (r.img && (r.img._path || r.img._bytes)) jobs.push(r)
      if (b.t === 'table') for (const row of b.rows) for (const c of row) visit(c.blocks)
    }
  }
  visit(blocks)
  await Promise.all(jobs.map(async (r) => {
    const im = r.img
    let bytes = im._bytes
    if (!bytes && im._path && odf.zip) { const f = odf.zip.file(im._path.replace(/^\.\//, '')); if (f) bytes = await f.async('uint8array') }
    delete im._bytes; delete im._path
    const norm = bytes ? await normalizeImage(bytes, sniffImage(bytes)) : null
    if (!norm) { delete r.img; r.text = im.alt ? `[${im.alt}]` : ''; return }
    let w = im.w || norm.w, h = im.h || norm.h
    if (im.w && !im.h) h = Math.round((im.w * norm.h) / norm.w)
    r.img = { bytes: norm.bytes, mime: norm.mime, w: Math.max(1, w), h: Math.max(1, h), alt: im.alt }
  }))
  const prune = (list) => { for (const b of list) { if (b.t === 'p') b.runs = b.runs.filter((r) => !(r.text === '' && !r.br && !r.img && !r.tab)); else if (b.t === 'table') for (const row of b.rows) for (const c of row) prune(c.blocks) } }
  prune(blocks)
  return blocks
}

/** Convenience: bytes -> {blocks, title}. */
export async function odtToBlocks(bytes) {
  const odf = await openOdf(bytes)
  const r = odfToBlocks(odf)
  await odfLoadImages(odf, r.blocks)
  return r
}
void kids
