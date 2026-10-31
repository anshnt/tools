// Rich Text Format reader (-> blocks, see _ast.js) and writer (blocks -> RTF). The reader handles groups, destinations, font and color tables,
// character and paragraph formatting, Unicode escapes (\uN with fallback skipping), legacy code pages through \ansicpg / \fcharset / \cpg
// (Korean 949, Japanese 932, Chinese 936 / 950, Windows-125x ...), lists, hyperlinks, tables (merged cells) and embedded PNG / JPEG pictures.
import { fail, sniffImage, imageSizeSync, concat } from './_util.js'

const CHARSET_CP = { 0: null, 1: null, 77: 10000, 128: 932, 129: 949, 130: 1361, 134: 936, 136: 950, 161: 1253, 162: 1254, 163: 1258, 177: 1255, 178: 1256, 186: 1257, 204: 1251, 222: 874, 238: 1250 }
const CP_LABEL = { 874: 'windows-874', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 1250: 'windows-1250', 1251: 'windows-1251', 1252: 'windows-1252', 1253: 'windows-1253', 1254: 'windows-1254', 1255: 'windows-1255', 1256: 'windows-1256', 1257: 'windows-1257', 1258: 'windows-1258', 1361: 'euc-kr', 10000: 'macintosh', 65001: 'utf-8', 20127: 'ascii', 28591: 'iso-8859-1' }
const decoders = new Map()
function decodeBytes(bytes, cp) {
  const label = CP_LABEL[cp] || 'windows-1252'
  if (!decoders.has(label)) { try { decoders.set(label, new TextDecoder(label)) } catch { decoders.set(label, new TextDecoder('windows-1252')) } }
  return decoders.get(label).decode(Uint8Array.from(bytes), { stream: false })
}
/** Decode bytes in a Windows code page (949, 932, 936, 950, 125x ...). */
export const decodeCodepage = (bytes, cp) => decodeBytes(bytes, cp)
const SKIP_DEST = new Set(['stylesheet', 'info', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf', 'footnote', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'xmlnstbl', 'pgdsctbl', 'revtbl', 'userprops', 'private', 'object', 'nonshppict', 'bkmkstart', 'bkmkend', 'xe', 'tc', 'fldinst_', 'mmathPr', 'wgrffmtfilter', 'factoidname', 'protusertbl', 'filetbl', 'template', 'comment', 'annotation', 'atnid', 'atnauthor', 'ftnsep', 'ftnsepc', 'aftnsep', 'aftnsepc', 'falt', 'panose', 'fname', 'fontemb', 'fontfile', 'pn', 'pnseclvl', 'shpinst', 'shprslt', 'sp', 'sn', 'sv', 'upr', 'ud'])
const SPECIAL = { emdash: '\u2014', endash: '\u2013', bullet: '\u2022', lquote: '\u2018', rquote: '\u2019', ldblquote: '\u201c', rdblquote: '\u201d', emspace: '\u2003', enspace: '\u2002', qmspace: '\u2005', zwj: '\u200d', zwnj: '\u200c', ltrmark: '\u200e', rtlmark: '\u200f', tilde: '\u00a0' }

/** Does this look like RTF? */
export const isRtf = (bytes) => bytes[0] === 0x7b && bytes[1] === 0x5c && bytes[2] === 0x72 && bytes[3] === 0x74 && bytes[4] === 0x66

/** RTF bytes -> {blocks, title}. */
export function rtfToBlocks(bytes) {
  if (!isRtf(bytes)) throw fail('This does not look like an RTF file (it should start with {\\rtf).')
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  const n = s.length

  const blocks = []
  let ansicpg = 1252, deff = 0
  const fonts = new Map() // idx -> {name, cp}
  const colors = [] // index 0 (automatic) is the empty entry before the first semicolon
  const styleNames = new Map()
  const listKinds = new Map() // ls -> ordered?
  let title = ''

  // parser state
  const base = () => ({ b: false, i: false, u: false, s: false, sup: false, sub: false, fs: 0, cf: 0, hl: 0, f: -1, uc: 1, hidden: false })
  let st = { ...base(), dest: 'doc' }
  const stack = []
  let skipDepth = 0 // >0: ignoring a destination
  let para = { align: null, level: 0, style: -1, ls: -1, ilvl: 0, intbl: false, outline: -1 }
  let runs = []
  let bytesPending = []
  let ucSkip = 0
  let curCell = null // blocks for the table cell being filled
  let tbl = null // {rows, cellDefs, row: []}
  let fieldUrl = null
  let listText = ''
  let capture = null // {kind, text} for fonttbl / colortbl / stylesheet entries and pictures
  let pict = null
  let fieldStack = []

  const curBlocks = () => (curCell ? curCell : blocks)
  const cp = () => fonts.get(st.f >= 0 ? st.f : deff)?.cp || ansicpg
  const flushBytes = () => {
    if (!bytesPending.length) return
    const f = st.f >= 0 ? fonts.get(st.f) : null
    const bs = bytesPending
    bytesPending = []
    if (f && /^(symbol|wingdings|webdings)/i.test(f.name || '')) { addText(bs.map((b) => (b === 0xb7 || b === 0xa7 || b === 0x6c || b === 0x6e ? '\u2022' : '')).join('')); return }
    addText(decodeBytes(bs, cp()))
  }
  const addText = (t) => {
    if (!t) return
    if (capture?.kind === 'font') { capture.text += t; return }
    if (capture?.kind === 'style') { capture.text += t; return }
    if (capture?.kind === 'listtext') { listText += t; return }
    if (capture?.kind === 'info') { capture.text += t; return }
    if (capture?.kind === 'fldinst') { capture.text += t; return }
    if (capture?.kind === 'pict' || skipDepth > 0 || st.hidden) return
    const run = { text: t }
    if (st.b) run.b = true
    if (st.i) run.i = true
    if (st.u) run.u = true
    if (st.s) run.s = true
    if (st.sup) run.sup = true
    if (st.sub) run.sub = true
    if (st.fs) run.size = st.fs / 2
    const color = st.cf > 0 ? colors[st.cf] : null
    if (color) run.color = color
    const hl = st.hl > 0 ? colors[st.hl] : null
    if (hl) run.bg = hl
    const font = st.f >= 0 ? fonts.get(st.f)?.name : null
    if (font && !/^(symbol|wingdings|webdings)/i.test(font)) run.font = font
    if (fieldUrl && st.dest === 'fldrslt') run.href = fieldUrl
    const prev = runs[runs.length - 1]
    const keys = ['b', 'i', 'u', 's', 'sup', 'sub', 'size', 'color', 'bg', 'font', 'href']
    if (prev && prev.text !== undefined && keys.every((k) => prev[k] === run[k])) prev.text += t
    else runs.push(run)
  }
  const endPara = (force) => {
    flushBytes()
    const r = runs
    runs = []
    const lt = listText
    listText = ''
    if (!r.length && !force) { return }
    const p = { t: 'p', runs: r.length ? r : [{ text: '' }] }
    if (para.align) p.align = para.align
    const sname = styleNames.get(para.style) || ''
    let level = 0
    const hm = /^heading\s*(\d)/i.exec(sname)
    if (hm) level = +hm[1]
    else if (/^title$/i.test(sname)) level = 1
    else if (para.outline >= 0 && para.outline < 6) level = para.outline + 1
    if (level) p.level = Math.min(6, level)
    if (!level && (para.ls >= 0 || lt.trim())) {
      const mark = lt.replace(/[\s\t]+/g, '')
      const ordered = mark ? /^(\(?\d+[.)]?|\(?[a-zA-Z][.)]|\(?[ivxlcdmIVXLCDM]+[.)])$/.test(mark) : listKinds.get(para.ls) === true
      p.list = { ordered, level: Math.max(0, para.ilvl), n: 1, type: 'decimal', ls: para.ls }
    }
    curBlocks().push(p)
  }
  const countList = () => {
    // number ordered items per level in a run of consecutive list paragraphs
    let prev = null
    const counters = []
    for (const b of blocks) {
      if (b.t === 'p' && b.list) {
        const lv = b.list.level
        if (prev && prev.list.ls !== b.list.ls) counters.length = 0
        counters.length = lv + 1
        counters[lv] = (counters[lv] || 0) + 1
        b.list.n = counters[lv]
        prev = b
      } else { counters.length = 0; prev = null }
    }
    void prev
  }

  const endCell = () => {
    endPara(false)
    if (!tbl) tbl = { rows: [], defs: [], row: [], pendingDef: {} }
    const cell = { blocks: curCell && curCell.length ? curCell : [{ t: 'p', runs: [{ text: '' }] }], th: false, colspan: 1, rowspan: 1, bg: null }
    tbl.row.push(cell)
    curCell = []
  }
  const endRow = () => {
    if (!tbl) return
    if (curCell && curCell.length) endCell()
    const defs = tbl.defs
    const row = []
    tbl.row.forEach((c, i) => {
      const d = defs[i] || {}
      c.bg = d.bg || null
      if (d.merge && row.length) { row[row.length - 1].colspan++; return }
      if (d.vmerge && tbl.rows.length) {
        // continue the cell above (same start column)
        let col = 0
        for (const x of row) col += x.colspan
        const above = tbl.rows[tbl.rows.length - 1]
        let ac = 0
        for (const x of above) { if (ac === col) { x.rowspan = (x.rowspan || 1) + 1; break } ac += x.colspan }
        return
      }
      row.push(c)
    })
    if (row.length) tbl.rows.push(row)
    tbl.row = []
    tbl.defs = []
    tbl.pendingDef = {}
    curCell = null
  }
  const flushTable = () => {
    if (tbl && tbl.rows.length) blocks.push({ t: 'table', rows: tbl.rows, border: true })
    tbl = null
    curCell = null
  }

  const readFontEntry = (cap) => {
    const m = cap.text.replace(/;+\s*$/, '').trim()
    if (cap.idx != null) fonts.set(cap.idx, { name: m.replace(/^["']|["']$/g, ''), cp: cap.cp ?? CHARSET_CP[cap.charset] ?? null })
  }

  let i = 0
  const hexv = (c) => parseInt(c, 16)
  while (i < n) {
    const ch = s[i]
    if (ch === '{') {
      flushBytes()
      stack.push({ st, capture, skip: skipDepth, fieldUrl })
      st = { ...st }
      if (skipDepth > 0) skipDepth++
      i++
      const depthBefore = capture
      // peek the destination
      let j = i
      let star = false
      if (s[j] === '\\' && s[j + 1] === '*') { star = true; j += 2; while (s[j] === ' ') j++ }
      if (s[j] === '\\') {
        const m = /^\\([a-zA-Z]+)(-?\d+)?/.exec(s.slice(j, j + 40))
        const name = m ? m[1] : ''
        if (skipDepth === 0) {
          if (name === 'fonttbl') { st.dest = 'fonttbl' }
          else if (name === 'colortbl') { st.dest = 'colortbl'; capture = { kind: 'color', r: 0, g: 0, b: 0, has: false } }
          else if (name === 'stylesheet') { st.dest = 'stylesheet' }
          else if (name === 'pict') { st.dest = 'pict'; pict = { hex: '', type: null, w: 0, h: 0, gw: 0, gh: 0, sx: 100, sy: 100 }; capture = { kind: 'pict' } }
          else if (name === 'shppict') { st.dest = 'shppict' }
          else if (name === 'field') { st.dest = 'field'; fieldStack.push({ url: null }) }
          else if (name === 'fldinst') { st.dest = 'fldinst'; capture = { kind: 'fldinst', text: '' } }
          else if (name === 'fldrslt') { st.dest = 'fldrslt'; fieldUrl = fieldStack[fieldStack.length - 1]?.url || null }
          else if (name === 'listtext' || name === 'pntext') { st.dest = 'listtext'; capture = { kind: 'listtext' } }
          else if (name === 'title' || name === 'info') { if (name === 'title') capture = { kind: 'info', text: '', which: 'title' }; st.dest = name === 'info' ? 'info' : 'title'; if (name === 'info') { /* children handled below */ } }
          else if (name === 'author' || name === 'subject' || name === 'keywords' || name === 'operator' || name === 'company' || name === 'category' || name === 'manager' || name === 'doccomm' || name === 'hlinkbase') { skipDepth = 1 }
          else if (star || SKIP_DEST.has(name)) { if (!(name === 'pntext' || name === 'listtext')) skipDepth = 1 }
          else if (st.dest === 'fonttbl' && /^f$/.test(name)) { /* font entry group */ }
          // a font entry: {\f0\fnil\fcharset129 Name;}
          if (st.dest === 'fonttbl' && name === 'f' && m && skipDepth === 0) capture = { kind: 'font', text: '', idx: +m[2], charset: undefined, cp: undefined }
          if (st.dest === 'stylesheet' && skipDepth === 0 && (name === 's' || name === 'cs' || name === 'ds')) capture = { kind: 'style', text: '', id: name === 's' ? +m[2] : -1 }
        }
      }
      if (capture && capture !== depthBefore) capture.depth = stack.length
      continue
    }
    if (ch === '}') {
      flushBytes()
      // finish captures that belong to this group
      if (capture && skipDepth === 0 && capture.depth === stack.length) {
        if (capture.kind === 'font') readFontEntry(capture)
        else if (capture.kind === 'style' && capture.id >= 0) styleNames.set(capture.id, capture.text.replace(/;+\s*$/, '').trim())
        else if (capture.kind === 'info' && capture.which === 'title') title = capture.text.trim()
        else if (capture.kind === 'fldinst') {
          const m = /HYPERLINK\s+(?:\\[a-z]\s+"[^"]*"\s+)*"([^"]+)"/i.exec(capture.text) || /HYPERLINK\s+(\S+)/i.exec(capture.text)
          if (m && fieldStack.length) fieldStack[fieldStack.length - 1].url = m[1]
        } else if (capture.kind === 'pict' && pict) {
          const hex = pict.hex
          const bs = new Uint8Array(hex.length >> 1)
          for (let k = 0; k < bs.length; k++) bs[k] = parseInt(hex.substr(k * 2, 2), 16)
          const mime = pict.type || sniffImage(bs)
          if (/^image\/(png|jpeg)$/.test(mime || '')) {
            const dim = imageSizeSync(bs, mime) || { w: 100, h: 100 }
            const w = Math.round(((pict.gw ? pict.gw / 15 : dim.w) * pict.sx) / 100), h = Math.round(((pict.gh ? pict.gh / 15 : dim.h) * pict.sy) / 100)
            if (st.dest === 'pict' || true) runs.push({ img: { bytes: bs, mime, w: w || dim.w, h: h || dim.h, alt: '' } })
          }
          pict = null
        }
      }
      const top = stack.pop()
      if (st.dest === 'field' && fieldStack.length) fieldStack.pop()
      if (top) {
        capture = top.capture
        st = top.st
        skipDepth = top.skip
        fieldUrl = top.fieldUrl
      }
      i++
      continue
    }
    if (ch === '\\') {
      const c1 = s[i + 1]
      if (c1 === "'") {
        const v = hexv(s.substr(i + 2, 2))
        i += 4
        if (ucSkip > 0) { ucSkip--; continue }
        if (skipDepth > 0) continue
        if (capture?.kind === 'pict') continue
        bytesPending.push(Number.isNaN(v) ? 0x3f : v)
        continue
      }
      if (c1 === '\\' || c1 === '{' || c1 === '}') { i += 2; if (ucSkip > 0) { ucSkip--; continue } if (skipDepth === 0) { flushBytes(); addText(c1) } continue }
      if (c1 === '~') { i += 2; flushBytes(); if (skipDepth === 0) addText('\u00a0'); continue }
      if (c1 === '-') { i += 2; continue }
      if (c1 === '_') { i += 2; flushBytes(); if (skipDepth === 0) addText('\u2011'); continue }
      if (c1 === '\n' || c1 === '\r') { i += 2; if (skipDepth === 0 && st.dest !== 'pict') { flushBytes(); endPara(true) } continue }
      if (c1 === '*') { i += 2; continue }
      if (c1 === '|' || c1 === ':') { i += 2; continue }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(s.slice(i, i + 60))
      if (!m) { i++; continue }
      i += m[0].length
      const w = m[1], p = m[2] !== undefined ? parseInt(m[2], 10) : undefined
      // unicode fallback characters are consumed first
      if (w === 'u' && p !== undefined) {
        flushBytes()
        if (skipDepth === 0) addText(String.fromCharCode(p < 0 ? p + 65536 : p))
        ucSkip = st.uc
        continue
      }
      if (ucSkip > 0 && w !== 'uc') { /* control words do not count as characters */ }
      if (skipDepth > 0) continue
      switch (w) {
        case 'ansicpg': ansicpg = p || 1252; break
        case 'deff': deff = p || 0; break
        case 'uc': st.uc = p ?? 1; break
        case 'f': flushBytes(); st.f = p ?? -1; if (st.dest === 'fonttbl' && !capture) capture = { kind: 'font', text: '', idx: p, loose: true, depth: -1 }; break
        case 'fcharset': if (capture?.kind === 'font') capture.charset = p; break
        case 'cpg': if (capture?.kind === 'font') capture.cp = p; break
        case 'fs': st.fs = p || 0; break
        case 'b': st.b = p !== 0; break
        case 'i': st.i = p !== 0; break
        case 'ul': case 'uld': case 'uldb': case 'ulw': case 'ulth': case 'uldash': case 'ulwave': st.u = p !== 0; break
        case 'ulnone': st.u = false; break
        case 'strike': case 'striked': st.s = p !== 0; break
        case 'super': st.sup = true; st.sub = false; break
        case 'sub': st.sub = true; st.sup = false; break
        case 'nosupersub': st.sup = st.sub = false; break
        case 'cf': st.cf = p || 0; break
        case 'highlight': case 'chcbpat': st.hl = p || 0; break
        case 'v': st.hidden = p !== 0; break
        case 'plain': { const keep = { dest: st.dest, uc: st.uc }; st = { ...base(), ...keep }; break }
        case 'red': if (capture?.kind === 'color') { capture.r = p; capture.has = true } break
        case 'green': if (capture?.kind === 'color') capture.g = p; break
        case 'blue': if (capture?.kind === 'color') capture.b = p; break
        // pictures
        case 'pngblip': if (pict) pict.type = 'image/png'; break
        case 'jpegblip': if (pict) pict.type = 'image/jpeg'; break
        case 'picw': break
        case 'picwgoal': if (pict) pict.gw = p; break
        case 'pichgoal': if (pict) pict.gh = p; break
        case 'picscalex': if (pict) pict.sx = p || 100; break
        case 'picscaley': if (pict) pict.sy = p || 100; break
        // paragraph
        case 'pard': para = { align: null, level: 0, style: -1, ls: -1, ilvl: 0, intbl: false, outline: -1 }; break
        case 'qc': para.align = 'center'; break
        case 'qr': para.align = 'right'; break
        case 'qj': para.align = 'justify'; break
        case 'ql': para.align = 'left'; break
        case 's': para.style = p ?? -1; break
        case 'ls': para.ls = p ?? -1; break
        case 'ilvl': para.ilvl = p ?? 0; break
        case 'outlinelevel': para.outline = p ?? -1; break
        case 'intbl': para.intbl = true; if (!curCell) { curCell = [] } break
        case 'par': case 'sect': if (st.dest !== 'pict') { flushBytes(); if (para.intbl || curCell) endPara(true); else { if (tbl) flushTable(); endPara(true) } } break
        case 'line': flushBytes(); if (skipDepth === 0 && st.dest !== 'pict') runs.push({ br: true }); break
        case 'tab': flushBytes(); if (skipDepth === 0 && st.dest !== 'pict') { if (capture?.kind === 'listtext') listText += '\t'; else runs.push({ tab: true }) } break
        case 'page': flushBytes(); endPara(false); curBlocks().push({ t: 'pagebreak' }); break
        case 'trowd': flushBytes(); if (runs.length && !curCell) endPara(false); if (!tbl) tbl = { rows: [], defs: [], row: [], pendingDef: {} }; tbl.defs = []; tbl.pendingDef = {}; curCell = curCell || []; break
        case 'clmgf': if (tbl) tbl.pendingDef.mgf = true; break
        case 'clmrg': if (tbl) tbl.pendingDef.merge = true; break
        case 'clvmgf': if (tbl) tbl.pendingDef.vmgf = true; break
        case 'clvmrg': if (tbl) tbl.pendingDef.vmerge = true; break
        case 'clcbpat': if (tbl) { const c = colors[p]; if (c) tbl.pendingDef.bg = c } break
        case 'cellx': if (tbl) { tbl.defs.push(tbl.pendingDef); tbl.pendingDef = {} } break
        case 'cell': case 'nestcell': flushBytes(); if (w === 'cell') endCell(); break
        case 'row': case 'nestrow': if (w === 'row') { flushBytes(); endRow() } break
        default:
          if (SPECIAL[w] && skipDepth === 0) { flushBytes(); addText(SPECIAL[w]) }
          break
      }
      continue
    }
    if (ch === '\r' || ch === '\n') { i++; continue }
    // plain character
    if (ucSkip > 0) { ucSkip--; i++; continue }
    if (skipDepth > 0) { i++; continue }
    if (capture?.kind === 'pict') { if (st.dest === 'pict' && /[0-9a-fA-F]/.test(ch)) pict.hex += ch; i++; continue }
    if (st.dest === 'colortbl') {
      if (ch === ';') { const c = capture; colors.push(c.has ? [c.r, c.g, c.b].map((v) => (v || 0).toString(16).padStart(2, '0')).join('') : null); capture.r = capture.g = capture.b = 0; capture.has = false }
      i++
      continue
    }
    if (st.dest === 'fonttbl' && ch === ';' && capture?.loose) { readFontEntry(capture); capture = null; i++; continue }
    if (st.dest === 'fonttbl' && !capture) { i++; continue }
    const code = ch.charCodeAt(0)
    if (code >= 0x80) { bytesPending.push(code); i++; continue }
    flushBytes()
    // gather a run of plain ASCII text
    let j = i
    while (j < n && s.charCodeAt(j) < 0x80 && !'{}\\\r\n'.includes(s[j]) && !(s[j] === ';' && j > i && st.dest === 'fonttbl')) j++
    let chunk = s.slice(i, j)
    if (ucSkip > 0) { const take = Math.min(ucSkip, chunk.length); ucSkip -= take; chunk = chunk.slice(take) }
    if (chunk) {
      if (st.dest === 'stylesheet' || st.dest === 'fonttbl') { if (capture) capture.text += chunk }
      else addText(chunk)
    }
    i = j
  }
  flushBytes()
  if (tbl) { flushTable() }
  endPara(false)
  countList()
  // drop empty trailing paragraphs
  while (blocks.length && blocks[blocks.length - 1].t === 'p' && !blocks[blocks.length - 1].runs.some((r) => r.img || (r.text && r.text.trim()))) blocks.pop()
  void deff
  return { blocks, title }
}

// ------------------------------------------------------------------ writer
const hexOf = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i++) { s += bytes[i].toString(16).padStart(2, '0'); if (i % 64 === 63) s += '\n' } return s }

function rtfEscape(t) {
  let out = ''
  for (const chr of t) {
    const c = chr.codePointAt(0)
    if (chr === '\\' || chr === '{' || chr === '}') out += '\\' + chr
    else if (chr === '\t') out += '\\tab '
    else if (chr === '\n') out += '\\line '
    else if (c < 0x20) continue
    else if (c < 0x80) out += chr
    else if (c > 0xffff) { const v = c - 0x10000; for (const u of [0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)]) out += `\\u${u > 32767 ? u - 65536 : u}?` }
    else out += `\\u${c > 32767 ? c - 65536 : c}?`
  }
  return out
}

/** Blocks -> RTF text (ASCII only, all other characters as \uN). Returns a string. */
export function astToRtf(blocks, { title = '' } = {}) {
  const fontList = ['Calibri', 'Consolas']
  const colorList = ['bbbbbb']
  const fontIdx = (f) => { let i = fontList.indexOf(f); if (i < 0) { fontList.push(f); i = fontList.length - 1 } return i }
  const colorIdx = (c) => { let i = colorList.indexOf(c); if (i < 0) { colorList.push(c); i = colorList.length - 1 } return i + 1 }
  const HSIZE = [0, 36, 30, 26, 24, 22, 22]
  const runRtf = (r) => {
    if (r.br) return '\\line '
    if (r.tab) return '\\tab '
    if (r.img) {
      const type = r.img.mime === 'image/png' ? '\\pngblip' : r.img.mime === 'image/jpeg' ? '\\jpegblip' : null
      if (!type) return rtfEscape(r.img.alt ? `[${r.img.alt}]` : '')
      let w = r.img.w || 200, hh = r.img.h || 150
      if (w > 600) { hh = (hh * 600) / w; w = 600 }
      return `{\\pict${type}\\picw${r.img.w || 200}\\pich${r.img.h || 150}\\picwgoal${Math.round(w * 15)}\\pichgoal${Math.round(hh * 15)}\n${hexOf(r.img.bytes)}}`
    }
    const ctl = []
    if (r.b) ctl.push('\\b')
    if (r.i) ctl.push('\\i')
    if (r.u || r.href) ctl.push('\\ul')
    if (r.s) ctl.push('\\strike')
    if (r.sup) ctl.push('\\super')
    if (r.sub) ctl.push('\\sub')
    if (r.color || r.href) ctl.push(`\\cf${colorIdx(r.color || '0563c1')}`)
    if (r.bg) ctl.push(`\\highlight${colorIdx(r.bg)}`)
    if (r.size) ctl.push(`\\fs${Math.round(r.size * 2)}`)
    if (r.font || r.mono) ctl.push(`\\f${fontIdx(r.font || 'Consolas')}`)
    let body = rtfEscape(r.text || '')
    if (r.href) body = `{\\field{\\*\\fldinst{HYPERLINK "${r.href.replace(/[\\{}"]/g, '')}"}}{\\fldrslt{${ctl.join('')} ${body}}}}`
    else if (ctl.length) body = `{${ctl.join('')} ${body}}`
    return body
  }
  const marker = (b) => {
    if (b.task !== undefined) return b.task ? '\\u9745?\\tab ' : '\\u9744?\\tab '
    if (!b.list.ordered) return '\\u8226?\\tab '
    return rtfEscape(`${b.list.n}.`) + '\\tab '
  }
  const paraRtf = (b, inCell) => {
    const al = { center: '\\qc', right: '\\qr', justify: '\\qj', left: '\\ql' }[b.align] || ''
    let pre = '\\pard' + (inCell ? '\\intbl' : '') + al
    let inner = b.runs.map(runRtf).join('')
    if (b.level) {
      pre += `\\sb240\\sa120\\keepn\\outlinelevel${b.level - 1}`
      inner = `{\\b\\fs${HSIZE[b.level]} ${inner}}`
    } else if (b.list) pre += `\\li${720 + b.list.level * 360}\\fi-360\\sa60`, inner = marker(b) + inner
    else if (b.cont != null) pre += `\\li${720 + (b.cont + 1) * 360}\\sa60`
    else if (b.code) { pre += '\\sa0\\cbpat0'; inner = `{\\f1\\fs19 ${inner}}` }
    else if (b.quote) pre += `\\li${567 * b.quote}\\sa120`
    else pre += '\\sa120\\sl276\\slmult1'
    return `${pre} ${inner}${inCell ? '\\cell' : ''}\\par\n`.replace(/\\par\n$/, inCell ? '\n' : '\\par\n')
  }
  const tableRtf = (t) => {
    const ncols = Math.max(...t.rows.map((r) => r.reduce((s, c) => s + c.colspan, 0)), 1)
    const total = 9000
    const colW = Math.floor(total / ncols)
    let out = ''
    const occ = []
    t.rows.forEach((row, ri) => {
      occ[ri] ||= []
      // cell layout for this row
      const cells = []
      let ci = 0
      const skipOcc = () => { while (occ[ri][ci]) { cells.push({ vmrg: true, span: 1 }); ci++ } }
      for (const c of row) {
        skipOcc()
        cells.push({ c, span: c.colspan })
        for (let rr = 0; rr < c.rowspan; rr++) for (let cc = 0; cc < c.colspan; cc++) { if (rr || cc) (occ[ri + rr] ||= [])[ci + cc] = true }
        ci += c.colspan
      }
      skipOcc()
      let def = '\\trowd\\trgaph80\\trleft0'
      let x = 0
      const bord = t.border ? '\\clbrdrt\\brdrs\\brdrw10\\brdrcf1\\clbrdrl\\brdrs\\brdrw10\\brdrcf1\\clbrdrb\\brdrs\\brdrw10\\brdrcf1\\clbrdrr\\brdrs\\brdrw10\\brdrcf1' : ''
      const parts = []
      for (const cell of cells) {
        for (let k = 0; k < (cell.span || 1); k++) {
          x += colW
          const flags = (cell.vmrg ? '\\clvmrg' : cell.c?.rowspan > 1 ? '\\clvmgf' : '') + (cell.span > 1 ? (k === 0 ? '\\clmgf' : '\\clmrg') : '')
          def += flags + bord + (cell.c?.bg ? `\\clcbpat${colorIdx(cell.c.bg)}` : '') + `\\cellx${x}`
        }
        const content = cell.c ? cell.c.blocks.map((b) => (b.t === 'p' ? paraRtf(b, true).replace(/\\par\n?$/, '').replace(/\\cell\n?$/, '') : '')).filter(Boolean).join('\\line ') : ''
        parts.push(`\\pard\\intbl ${content}\\cell`)
        for (let k = 1; k < (cell.span || 1); k++) parts.push('\\pard\\intbl\\cell')
      }
      out += `${def}\n${parts.join('\n')}\n\\row\n`
    })
    return out + '\\pard\\sa120\\par\n'
  }
  let body = ''
  for (const b of blocks) {
    if (b.t === 'p') body += paraRtf(b, false)
    else if (b.t === 'table') body += tableRtf(b)
    else if (b.t === 'hr') body += '\\pard\\brdrb\\brdrs\\brdrw10\\brsp20 \\par\n'
    else if (b.t === 'pagebreak') body += '\\page\n'
  }
  const fonttbl = fontList.map((f, i) => `{\\f${i}\\fnil\\fcharset0 ${rtfEscape(f)};}`).join('')
  const colortbl = ';' + colorList.map((c) => `\\red${parseInt(c.slice(0, 2), 16)}\\green${parseInt(c.slice(2, 4), 16)}\\blue${parseInt(c.slice(4, 6), 16)};`).join('')
  return `{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1\n{\\fonttbl${fonttbl}}\n{\\colortbl${colortbl}}\n${title ? `{\\info{\\title ${rtfEscape(title)}}}\n` : ''}\\paperw11906\\paperh16838\\margl1440\\margr1440\\margt1440\\margb1440\\viewkind1\\f0\\fs22\n${body}}`
}
void concat
