// XLSX reading (SheetJS for cells and formulas, plus our own pass over the XML for styles and layout) and a writer that keeps
// formulas, formats, widths, merges, filters, freeze panes and conditional formatting.
import { jszip, xlsx as sheetjs } from '../../lib/libs.js'
import { ck, colName, parseRange, MAXC, rangeText } from './_a1.js'
import { print } from './_parse.js'
import { errFor, XErr } from './_val.js'

const THEME_DEFAULT = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47']
const INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF', '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99', '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696', '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333']
const BUILTIN_NF = { 0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 14: 'dd/mm/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'dd/mm/yyyy hh:mm', 37: '#,##0;(#,##0)', 38: '#,##0;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mm:ss.0', 49: '@' }

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
const attr = (el, n) => el?.getAttribute(n)
const parseXml = (s) => new DOMParser().parseFromString(s, 'application/xml')
const kids = (el, tag) => [...(el?.children || [])].filter((c) => c.localName === tag)
const first = (el, tag) => kids(el, tag)[0]
const hexOf = (rgb) => '#' + rgb.slice(-6).toLowerCase()

function tint(hex, t) {
  const n = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const f = (c) => Math.round(t < 0 ? c * (1 + t) : c + (255 - c) * t)
  return '#' + n.map((c) => f(c).toString(16).padStart(2, '0')).join('')
}

// ================= reading =================
async function readStyleBook(zip) {
  const sx = await zip.file('xl/styles.xml')?.async('string')
  const tx = await zip.file('xl/theme/theme1.xml')?.async('string')
  const theme = [...THEME_DEFAULT]
  if (tx) {
    const doc = parseXml(tx)
    const names = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']
    names.forEach((n, i) => {
      const el = doc.getElementsByTagNameNS('*', n)[0]
      const c = el?.firstElementChild
      const v = c && (attr(c, 'val') && c.localName === 'srgbClr' ? attr(c, 'val') : attr(c, 'lastClr'))
      if (v) theme[i] = v
    })
  }
  const color = (el) => {
    if (!el) return null
    const rgb = attr(el, 'rgb'), th = attr(el, 'theme'), ix = attr(el, 'indexed'), t = parseFloat(attr(el, 'tint') || '0')
    let hex = null
    if (rgb) hex = '#' + rgb.slice(-6).toLowerCase()
    else if (th != null && theme[+th]) hex = '#' + theme[+th].toLowerCase()
    else if (ix != null && INDEXED[+ix]) hex = '#' + INDEXED[+ix].toLowerCase()
    return hex && t ? tint(hex, t) : hex
  }
  const out = { xfs: [], dxfs: [], color }
  if (!sx) return out
  const doc = parseXml(sx)
  const root = doc.documentElement
  const numFmts = new Map()
  for (const n of kids(first(root, 'numFmts'), 'numFmt')) numFmts.set(+attr(n, 'numFmtId'), attr(n, 'formatCode'))
  const fonts = kids(first(root, 'fonts'), 'font').map((f) => {
    const o = {}
    if (first(f, 'b') && attr(first(f, 'b'), 'val') !== '0') o.b = true
    if (first(f, 'i') && attr(first(f, 'i'), 'val') !== '0') o.i = true
    if (first(f, 'strike') && attr(first(f, 'strike'), 'val') !== '0') o.st = true
    const u = first(f, 'u'); if (u && attr(u, 'val') !== 'none') o.u = true
    const sz = first(f, 'sz'); if (sz) o.fs = Math.round(parseFloat(attr(sz, 'val')) * 10) / 10
    const c = color(first(f, 'color')); if (c && c !== '#000000') o.fc = c
    const nm = attr(first(f, 'name'), 'val') || ''
    o.ff = /times|georgia|serif|cambria|garamond/i.test(nm) ? 'serif' : /courier|consolas|mono|menlo/i.test(nm) ? 'mono' : undefined
    return o
  })
  const fills = kids(first(root, 'fills'), 'fill').map((f) => {
    const p = first(f, 'patternFill')
    if (!p || attr(p, 'patternType') !== 'solid') return null
    return color(first(p, 'fgColor')) || null
  })
  const sideOf = (b, name) => {
    const s = first(b, name)
    const style = attr(s, 'style')
    if (!style) return null
    const map = { thin: 'thin', hair: 'thin', medium: 'medium', thick: 'thick', dashed: 'dashed', mediumDashed: 'dashed', dotted: 'dotted', double: 'double' }
    return { s: map[style] || 'thin', c: color(first(s, 'color')) || '#000000' }
  }
  const borders = kids(first(root, 'borders'), 'border').map((b) => ({ bl: sideOf(b, 'left'), br: sideOf(b, 'right'), bt: sideOf(b, 'top'), bb: sideOf(b, 'bottom') }))
  for (const xf of kids(first(root, 'cellXfs'), 'xf')) {
    const st = {}
    const nid = +attr(xf, 'numFmtId')
    const code = numFmts.get(nid) ?? BUILTIN_NF[nid]
    if (code && code !== 'General') st.nf = code
    Object.assign(st, fonts[+attr(xf, 'fontId')] || {})
    const bg = fills[+attr(xf, 'fillId')]; if (bg) st.bg = bg
    const b = borders[+attr(xf, 'borderId')]; if (b) for (const k of ['bl', 'br', 'bt', 'bb']) if (b[k]) st[k] = b[k]
    const al = first(xf, 'alignment')
    if (al) {
      const h = attr(al, 'horizontal'), v = attr(al, 'vertical')
      if (h === 'left' || h === 'center' || h === 'right') st.ha = h
      if (v === 'top' || v === 'bottom') st.va = v; else if (v === 'center') st.va = 'middle'
      if (attr(al, 'wrapText') === '1' || attr(al, 'wrapText') === 'true') st.wr = true
      if (attr(al, 'indent')) st.ind = +attr(al, 'indent')
    }
    for (const k of Object.keys(st)) if (st[k] === undefined) delete st[k]
    out.xfs.push(st)
  }
  for (const d of kids(first(root, 'dxfs'), 'dxf')) {
    const st = {}
    const f = first(d, 'font')
    if (f) { if (first(f, 'b')) st.b = true; if (first(f, 'i')) st.i = true; const c = color(first(f, 'color')); if (c) st.fc = c }
    const fl = first(first(d, 'fill'), 'patternFill')
    if (fl) { const c = color(first(fl, 'bgColor')) || color(first(fl, 'fgColor')); if (c) st.bg = c }
    out.dxfs.push(st)
  }
  return out
}

function cfFromXml(el, dxfs) {
  const sq = attr(el, 'sqref')
  const range = sq && parseRange(sq.split(' ')[0])
  if (!range) return []
  const rules = []
  for (const r of kids(el, 'cfRule')) {
    const t = attr(r, 'type'), op = attr(r, 'operator')
    const f = kids(r, 'formula').map((x) => x.textContent)
    const style = dxfs[+attr(r, 'dxfId')] || {}
    const base = { id: 'cf' + Math.random().toString(36).slice(2, 8), range, style }
    if (t === 'cellIs') {
      const ops = { greaterThan: 'gt', greaterThanOrEqual: 'ge', lessThan: 'lt', lessThanOrEqual: 'le', equal: 'eq', notEqual: 'ne', between: 'between', notBetween: 'nbetween' }
      if (ops[op]) rules.push({ ...base, type: 'cell', op: ops[op], v1: f[0]?.replace(/^"|"$/g, ''), v2: f[1] })
    } else if (t === 'containsText' || t === 'beginsWith' || t === 'endsWith' || t === 'notContainsText') {
      rules.push({ ...base, type: 'text', op: t === 'containsText' ? 'contains' : t === 'beginsWith' ? 'begins' : t === 'endsWith' ? 'ends' : 'ncontains', v: attr(r, 'text') || '' })
    } else if (t === 'expression') rules.push({ ...base, type: 'expr', f: f[0] || 'FALSE' })
    else if (t === 'duplicateValues') rules.push({ ...base, type: 'dup' })
    else if (t === 'uniqueValues') rules.push({ ...base, type: 'uniq' })
    else if (t === 'containsBlanks') rules.push({ ...base, type: 'blank' })
    else if (t === 'notContainsBlanks') rules.push({ ...base, type: 'nblank' })
    else if (t === 'top10') rules.push({ ...base, type: attr(r, 'bottom') === '1' ? 'bottom' : 'top', n: +attr(r, 'rank') || 10, pct: attr(r, 'percent') === '1' })
    else if (t === 'aboveAverage') rules.push({ ...base, type: attr(r, 'aboveAverage') === '0' ? 'below' : 'above' })
    else if (t === 'colorScale') {
      const cs = kids(first(r, 'colorScale'), 'color').map((c) => { const rgb = attr(c, 'rgb'); return rgb ? '#' + rgb.slice(-6).toLowerCase() : '#ffffff' })
      if (cs.length >= 2) rules.push({ ...base, type: 'scale', c1: cs[0], c2: cs[cs.length - 1], c3: cs.length === 3 ? cs[1] : undefined, style: undefined })
    } else if (t === 'dataBar') {
      const c = attr(first(first(r, 'dataBar'), 'color'), 'rgb')
      rules.push({ ...base, type: 'bar', color: c ? '#' + c.slice(-6).toLowerCase() : '#638ec6', style: undefined })
    }
  }
  return rules
}

/** Layout and style information SheetJS does not give us, per sheet name. */
async function readSheetXml(buf) {
  const JSZip = await jszip()
  const zip = await JSZip.loadAsync(buf)
  const book = await readStyleBook(zip)
  const wbx = await zip.file('xl/workbook.xml')?.async('string')
  const rels = await zip.file('xl/_rels/workbook.xml.rels')?.async('string')
  const out = new Map()
  if (!wbx || !rels) return { book, sheets: out }
  const wdoc = parseXml(wbx), rdoc = parseXml(rels)
  const target = new Map([...rdoc.getElementsByTagNameNS('*', 'Relationship')].map((r) => [attr(r, 'Id'), attr(r, 'Target')]))
  for (const s of wdoc.getElementsByTagNameNS('*', 'sheet')) {
    const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || attr(s, 'r:id')
    let t = target.get(rid)
    if (!t) continue
    t = t.replace(/^\//, '')
    const path = t.startsWith('xl/') ? t : 'xl/' + t
    const xml = await zip.file(path)?.async('string')
    if (!xml) continue
    const info = { styles: new Map(), freeze: null, grid: true, color: null, colS: {}, rowS: {}, cf: [], hiddenCols: new Set(), hiddenRows: new Set(), colW: {}, rowH: {} }
    const re = /<c\b([^>]*?)\/?>/g
    let m
    while ((m = re.exec(xml))) {
      const a = m[1]
      const rm = /\br="([A-Z]+\d+)"/.exec(a), sm = /\bs="(\d+)"/.exec(a)
      if (rm && sm && sm[1] !== '0') info.styles.set(rm[1], +sm[1])
    }
    const pane = /<pane\b([^>]*)>/.exec(xml)
    if (pane && /state="frozen(?:Split)?"/.test(pane[1])) {
      const xs = /xSplit="(\d+(?:\.\d+)?)"/.exec(pane[1]), ys = /ySplit="(\d+(?:\.\d+)?)"/.exec(pane[1])
      info.freeze = { c: xs ? Math.round(+xs[1]) : 0, r: ys ? Math.round(+ys[1]) : 0 }
    }
    if (/<sheetView\b[^>]*showGridLines="(0|false)"/.test(xml)) info.grid = false
    const tc = /<tabColor\b[^>]*rgb="([0-9A-Fa-f]{6,8})"/.exec(xml)
    if (tc) info.color = hexOf(tc[1])
    for (const cm of xml.matchAll(/<col\b([^>]*?)\/?>/g)) {
      const a = cm[1]
      const mn = +/\bmin="(\d+)"/.exec(a)?.[1], mx = +/\bmax="(\d+)"/.exec(a)?.[1]
      if (!mn || !mx) continue
      const w = /\bwidth="([\d.]+)"/.exec(a), hid = /\bhidden="(1|true)"/.test(a), st = /\bstyle="(\d+)"/.exec(a)
      for (let c = mn; c <= Math.min(mx, mn + 400); c++) {
        if (w) info.colW[c - 1] = Math.round(parseFloat(w[1]) * 7)
        if (hid) info.hiddenCols.add(c - 1)
        if (st && st[1] !== '0') info.colS[c - 1] = +st[1]
      }
    }
    for (const rm2 of xml.matchAll(/<row\b([^>]*?)>/g)) {
      const a = rm2[1]
      const r = +/\br="(\d+)"/.exec(a)?.[1]
      if (!r) continue
      const ht = /\bht="([\d.]+)"/.exec(a), custom = /\bcustomHeight="(1|true)"/.test(a), hid = /\bhidden="(1|true)"/.test(a), st = /\bs="(\d+)"/.exec(a), cf = /\bcustomFormat="(1|true)"/.test(a)
      if (ht && custom) info.rowH[r - 1] = Math.round((parseFloat(ht[1]) * 4) / 3)
      if (hid) info.hiddenRows.add(r - 1)
      if (st && cf && st[1] !== '0') info.rowS[r - 1] = +st[1]
    }
    const sdoc = xml.includes('<conditionalFormatting') || xml.includes('<dataValidation') ? parseXml(xml) : null
    if (sdoc) for (const el of sdoc.getElementsByTagNameNS('*', 'conditionalFormatting')) info.cf.push(...cfFromXml(el, book.dxfs))
    info.dv = []
    if (sdoc) {
      for (const el of sdoc.getElementsByTagNameNS('*', 'dataValidation')) {
        const range = parseRange((attr(el, 'sqref') || '').split(' ')[0])
        const type = attr(el, 'type')
        if (!range || !['list', 'whole', 'decimal', 'textLength'].includes(type)) continue
        const f1 = first(el, 'formula1')?.textContent || '', f2 = first(el, 'formula2')?.textContent || ''
        const rule = { id: 'dv' + Math.random().toString(36).slice(2, 8), range, type: type === 'textLength' ? 'textlen' : type, blank: attr(el, 'allowBlank') !== '0' }
        if (type === 'list') { if (/^"/.test(f1)) rule.items = f1.replace(/^"|"$/g, '').split(','); else rule.src = f1.replace(/^.*!/, '').replace(/\$/g, '') } else {
          const opm = { between: 'between', notBetween: 'notbetween', equal: 'eq', notEqual: 'ne', greaterThan: 'gt', greaterThanOrEqual: 'ge', lessThan: 'lt', lessThanOrEqual: 'le' }
          rule.op = opm[attr(el, 'operator') || 'between'] || 'between'; rule.v1 = f1; rule.v2 = f2
        }
        info.dv.push(rule)
      }
    }
    out.set(attr(s, 'name'), info)
  }
  return { book, sheets: out }
}

const ERR_BY_CODE = { 0: '#NULL!', 7: '#DIV/0!', 15: '#VALUE!', 23: '#REF!', 29: '#NAME?', 36: '#NUM!', 42: '#N/A' }

/** Read any workbook SheetJS understands (xlsx, xls, ods...) into a plain description. */
export async function readWorkbook(buf, name) {
  const X = await sheetjs()
  const isZip = new Uint8Array(buf, 0, 2)[0] === 0x50
  const wb = X.read(buf, { type: 'array', cellFormula: true, cellNF: true, cellText: false, cellDates: false, cellStyles: true })
  let extra = { book: { xfs: [], dxfs: [] }, sheets: new Map() }
  if (isZip && /\.(xlsx|xlsm|xltx|xltm)$/i.test(name)) { try { extra = await readSheetXml(buf) } catch (e) { console.warn('style pass failed', e) } }
  const out = { name: name.replace(/\.[^.]+$/, ''), sheets: [], names: {} }
  for (const n of wb.Workbook?.Names || []) {
    if (n.Sheet != null || !n.Name || !/^(?:'[^']+'|[^!']+)!\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?$/i.test(n.Ref || '')) continue
    out.names[n.Name.toUpperCase()] = { n: n.Name, ref: n.Ref }
  }
  wb.SheetNames.forEach((sn, idx) => {
    const ws = wb.Sheets[sn]
    const info = extra.sheets.get(sn)
    const sheet = { name: sn, cells: [], colW: {}, rowH: {}, hideC: {}, hideR: {}, merges: [], freeze: info?.freeze || { r: 0, c: 0 }, filter: null, cf: info?.cf || [], dv: info?.dv || [], grid: info ? info.grid : true, color: info?.color || null, colS: {}, rowS: {}, hidden: !!wb.Workbook?.Sheets?.[idx]?.Hidden }
    const xf = (i) => (i != null ? extra.book.xfs[i] : null)
    const spillSkip = new Set()
    const ref = ws['!ref']
    if (ref) {
      for (const key of Object.keys(ws)) {
        if (key[0] === '!') continue
        const c = ws[key]
        if (c.F) { const g = parseRange(c.F); if (g) for (let r = g.r1; r <= g.r2; r++) for (let cc = g.c1; cc <= g.c2; cc++) if (r !== g.r1 || cc !== g.c1) spillSkip.add(ck(r, cc)) }
      }
      for (const key of Object.keys(ws)) {
        if (key[0] === '!') continue
        const cell = ws[key]
        const pos = X.utils.decode_cell(key)
        if (spillSkip.has(ck(pos.r, pos.c))) continue
        let v = null
        if (cell.t === 'n') v = cell.v
        else if (cell.t === 's') v = String(cell.v)
        else if (cell.t === 'b') v = !!cell.v
        else if (cell.t === 'e') v = errFor(ERR_BY_CODE[cell.v] || cell.w || '#VALUE!')
        else if (cell.t === 'd') v = cell.v instanceof Date ? (cell.v.getTime() / 86400000) + 25569 : cell.v
        let st = xf(info?.styles.get(key)) ? { ...xf(info.styles.get(key)) } : {}
        if (cell.z && cell.z !== 'General' && !st.nf) st.nf = cell.z
        if (v === null && cell.f == null && !Object.keys(st).length) continue
        sheet.cells.push([pos.r, pos.c, cell.f != null ? null : v, cell.f != null ? String(cell.f).replace(/^=/, '') : null, st, cell.F ? 1 : 0])
      }
    }
    for (const m of ws['!merges'] || []) sheet.merges.push({ r1: m.s.r, c1: m.s.c, r2: m.e.r, c2: m.e.c })
    ;(ws['!cols'] || []).forEach((c, i) => { if (!c) return; if (c.wpx) sheet.colW[i] = Math.round(c.wpx); else if (c.wch) sheet.colW[i] = Math.round(c.wch * 7); if (c.hidden) sheet.hideC[i] = 1 })
    ;(ws['!rows'] || []).forEach((r, i) => { if (!r) return; if (r.hpx) sheet.rowH[i] = Math.round(r.hpx); if (r.hidden) sheet.hideR[i] = 1 })
    if (info) {
      for (const [c, w] of Object.entries(info.colW)) sheet.colW[c] = w
      for (const c of info.hiddenCols) sheet.hideC[c] = 1
      for (const [r, h] of Object.entries(info.rowH)) sheet.rowH[r] = h
      for (const r of info.hiddenRows) sheet.hideR[r] = 1
      for (const [c, i] of Object.entries(info.colS)) if (xf(i)) sheet.colS[c] = xf(i)
      for (const [r, i] of Object.entries(info.rowS)) if (xf(i)) sheet.rowS[r] = xf(i)
    }
    const af = ws['!autofilter']?.ref && parseRange(ws['!autofilter'].ref)
    if (af) sheet.filter = { ...af, cols: {} }
    out.sheets.push(sheet)
  })
  return out
}

// ================= writing =================
const XLFN = new Set(['IFS', 'SWITCH', 'MAXIFS', 'MINIFS', 'CONCAT', 'TEXTJOIN', 'XLOOKUP', 'XMATCH', 'IFNA', 'DAYS', 'ISOWEEKNUM', 'NUMBERVALUE', 'UNICODE', 'UNICHAR', 'STDEV.S', 'STDEV.P', 'VAR.S', 'VAR.P', 'RANK.EQ', 'PERCENTILE.INC', 'QUARTILE.INC', 'MODE.SNGL', 'FORECAST.LINEAR', 'TEXTBEFORE', 'TEXTAFTER', 'TEXTSPLIT', 'VSTACK', 'HSTACK', 'UNIQUE', 'SEQUENCE', 'SORTBY', 'XOR', 'CONCATENATE_'])
const XLWS = new Set(['FILTER', 'SORT'])
const fnOut = (n) => (XLWS.has(n) ? `_xlfn._xlws.${n}` : XLFN.has(n) ? `_xlfn.${n}` : n)
const argb = (hex) => 'FF' + hex.replace('#', '').toUpperCase().padStart(6, '0').slice(-6)
const FONT_NAME = { serif: 'Times New Roman', mono: 'Consolas' }
const BORDER_STYLE = { thin: 'thin', medium: 'medium', thick: 'thick', dashed: 'dashed', dotted: 'dotted', double: 'double' }
const BUILTIN_BY_CODE = { General: 0, 0: 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10, '@': 49 }

class StyleBook {
  constructor(model) {
    this.model = model
    this.fonts = ['<font><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/><family val="2"/></font>']
    this.fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>']
    this.borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>']
    this.numFmts = new Map()
    this.xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>']
    this.cache = new Map([[0, 0]])
    this.keys = new Map()
    this.dxfs = []
  }
  idx(list, xml) { const i = list.indexOf(xml); if (i >= 0) return i; list.push(xml); return list.length - 1 }
  xf(sid) {
    if (this.cache.has(sid)) return this.cache.get(sid)
    const st = this.model.style(sid)
    const font = `<font>${st.b ? '<b/>' : ''}${st.i ? '<i/>' : ''}${st.st ? '<strike/>' : ''}${st.u ? '<u/>' : ''}<sz val="${st.fs || 11}"/><color rgb="${st.fc ? argb(st.fc) : 'FF000000'}"/><name val="${FONT_NAME[st.ff] || 'Calibri'}"/><family val="2"/></font>`
    const fontId = this.idx(this.fonts, font)
    const fillId = st.bg ? this.idx(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="${argb(st.bg)}"/><bgColor indexed="64"/></patternFill></fill>`) : 0
    const side = (n, b) => (b ? `<${n} style="${BORDER_STYLE[b.s] || 'thin'}"><color rgb="${argb(b.c || '#000000')}"/></${n}>` : `<${n}/>`)
    const bxml = st.bl || st.br || st.bt || st.bb ? `<border>${side('left', st.bl)}${side('right', st.br)}${side('top', st.bt)}${side('bottom', st.bb)}<diagonal/></border>` : null
    const borderId = bxml ? this.idx(this.borders, bxml) : 0
    let nid = 0
    if (st.nf && st.nf !== 'General') {
      if (BUILTIN_BY_CODE[st.nf] !== undefined) nid = BUILTIN_BY_CODE[st.nf]
      else { if (!this.numFmts.has(st.nf)) this.numFmts.set(st.nf, 164 + this.numFmts.size); nid = this.numFmts.get(st.nf) }
    }
    const al = st.ha || st.va || st.wr || st.ind ? `<alignment${st.ha ? ` horizontal="${st.ha}"` : ''}${st.va ? ` vertical="${st.va === 'middle' ? 'center' : st.va}"` : ''}${st.wr ? ' wrapText="1"' : ''}${st.ind ? ` indent="${st.ind}"` : ''}/>` : ''
    const xf = `<xf numFmtId="${nid}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"${nid ? ' applyNumberFormat="1"' : ''} applyFont="1"${fillId ? ' applyFill="1"' : ''}${borderId ? ' applyBorder="1"' : ''}${al ? ' applyAlignment="1">' + al + '</xf>' : '/>'}`
    const i = this.idx(this.xfs, xf)
    this.cache.set(sid, i)
    return i
  }
  dxf(st) {
    const x = `<dxf>${st.b || st.i || st.fc ? `<font>${st.b ? '<b/>' : ''}${st.i ? '<i/>' : ''}${st.fc ? `<color rgb="${argb(st.fc)}"/>` : ''}</font>` : ''}${st.bg ? `<fill><patternFill patternType="solid"><fgColor rgb="${argb(st.bg)}"/><bgColor rgb="${argb(st.bg)}"/></patternFill></fill>` : ''}</dxf>`
    return this.idx(this.dxfs, x)
  }
  xml() {
    const nf = [...this.numFmts].map(([c, id]) => `<numFmt numFmtId="${id}" formatCode="${xmlEsc(c)}"/>`).join('')
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${nf ? `<numFmts count="${this.numFmts.size}">${nf}</numFmts>` : ''}<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts><fills count="${this.fills.length}">${this.fills.join('')}</fills><borders count="${this.borders.length}">${this.borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="${this.dxfs.length}">${this.dxfs.join('')}</dxfs><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`
  }
}

function cfXml(model, sh, sb, prio) {
  const byRange = new Map()
  for (const rule of sh.cf) {
    const key = rangeText(rule.range)
    if (!byRange.has(key)) byRange.set(key, [])
    byRange.get(key).push(rule)
  }
  let out = ''
  for (const [sq, rules] of byRange) {
    out += `<conditionalFormatting sqref="${sq}">`
    const tl = colName(rules[0].range.c1) + (rules[0].range.r1 + 1)
    for (const r of rules) {
      const dxf = r.style && Object.keys(r.style).length ? ` dxfId="${sb.dxf(r.style)}"` : ''
      const p = prio.n++
      const stop = r.stop ? ' stopIfTrue="1"' : ''
      if (r.type === 'cell') {
        const ops = { gt: 'greaterThan', ge: 'greaterThanOrEqual', lt: 'lessThan', le: 'lessThanOrEqual', eq: 'equal', ne: 'notEqual', between: 'between', nbetween: 'notBetween' }
        const q = (v) => (Number.isFinite(parseFloat(v)) ? String(parseFloat(v)) : `"${String(v).replace(/"/g, '""')}"`)
        out += `<cfRule type="cellIs"${dxf} priority="${p}"${stop} operator="${ops[r.op]}"><formula>${xmlEsc(q(r.v1))}</formula>${r.op.includes('between') ? `<formula>${xmlEsc(q(r.v2))}</formula>` : ''}</cfRule>`
      } else if (r.type === 'text') {
        const t = String(r.v || '').replace(/"/g, '""')
        const tp = { contains: ['containsText', `ISNUMBER(SEARCH("${t}",${tl}))`], ncontains: ['notContainsText', `ISERROR(SEARCH("${t}",${tl}))`], begins: ['beginsWith', `LEFT(${tl},${t.length})="${t}"`], ends: ['endsWith', `RIGHT(${tl},${t.length})="${t}"`] }[r.op]
        out += `<cfRule type="${tp[0]}"${dxf} priority="${p}"${stop} operator="${r.op === 'contains' ? 'containsText' : r.op === 'ncontains' ? 'notContains' : r.op === 'begins' ? 'beginsWith' : 'endsWith'}" text="${xmlEsc(r.v || '')}"><formula>${xmlEsc(tp[1])}</formula></cfRule>`
      } else if (r.type === 'expr') out += `<cfRule type="expression"${dxf} priority="${p}"${stop}><formula>${xmlEsc(r.f)}</formula></cfRule>`
      else if (r.type === 'dup') out += `<cfRule type="duplicateValues"${dxf} priority="${p}"${stop}/>`
      else if (r.type === 'uniq') out += `<cfRule type="uniqueValues"${dxf} priority="${p}"${stop}/>`
      else if (r.type === 'blank') out += `<cfRule type="containsBlanks"${dxf} priority="${p}"${stop}><formula>LEN(TRIM(${tl}))=0</formula></cfRule>`
      else if (r.type === 'nblank') out += `<cfRule type="notContainsBlanks"${dxf} priority="${p}"${stop}><formula>LEN(TRIM(${tl}))&gt;0</formula></cfRule>`
      else if (r.type === 'top' || r.type === 'bottom') out += `<cfRule type="top10"${dxf} priority="${p}"${stop}${r.type === 'bottom' ? ' bottom="1"' : ''}${r.pct ? ' percent="1"' : ''} rank="${r.n || 10}"/>`
      else if (r.type === 'above' || r.type === 'below') out += `<cfRule type="aboveAverage"${dxf} priority="${p}"${stop}${r.type === 'below' ? ' aboveAverage="0"' : ''}/>`
      else if (r.type === 'scale') {
        const three = !!r.c3
        out += `<cfRule type="colorScale" priority="${p}"><colorScale><cfvo type="min"/>${three ? '<cfvo type="percentile" val="50"/>' : ''}<cfvo type="max"/><color rgb="${argb(r.c1)}"/>${three ? `<color rgb="${argb(r.c3)}"/>` : ''}<color rgb="${argb(r.c2)}"/></colorScale></cfRule>`
      } else if (r.type === 'bar') out += `<cfRule type="dataBar" priority="${p}"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="${argb(r.color || '#638ec6')}"/></dataBar></cfRule>`
    }
    out += '</conditionalFormatting>'
  }
  return out
}

function dvXml(sh) {
  if (!sh.dv || !sh.dv.length) return ''
  const opx = { between: 'between', notbetween: 'notBetween', eq: 'equal', ne: 'notEqual', gt: 'greaterThan', ge: 'greaterThanOrEqual', lt: 'lessThan', le: 'lessThanOrEqual' }
  const items = sh.dv.map((d) => {
    const base = `<dataValidation type="${d.type === 'textlen' ? 'textLength' : d.type}"${d.type !== 'list' ? ` operator="${opx[d.op || 'between']}"` : ''} allowBlank="${d.blank === false ? 0 : 1}" showErrorMessage="1" sqref="${rangeText(d.range)}">`
    if (d.type === 'list') return `${base}<formula1>${d.items ? xmlEsc(`"${d.items.join(',')}"`) : xmlEsc(d.src || '')}</formula1></dataValidation>`
    return `${base}<formula1>${xmlEsc(d.v1)}</formula1>${(d.op || 'between').includes('between') ? `<formula2>${xmlEsc(d.v2)}</formula2>` : ''}</dataValidation>`
  })
  return `<dataValidations count="${items.length}">${items.join('')}</dataValidations>`
}

/** Build an .xlsx Blob from the model. */
export async function writeXlsx(model) {
  const JSZip = await jszip()
  const zip = new JSZip()
  const sb = new StyleBook(model)
  const sst = new Map()
  const sstList = []
  const sstIdx = (s) => { let i = sst.get(s); if (i === undefined) { i = sstList.length; sst.set(s, i); sstList.push(s) } return i }
  const sheets = model.sheets
  const prio = { n: 1 }
  const sheetXml = sheets.map((sh, si) => {
    const rows = new Map()
    const put = (r, c, xml) => { let a = rows.get(r); if (!a) rows.set(r, (a = [])); a.push([c, xml]) }
    const cellXml = (r, c, cell, spillVal, spillOwned) => {
      const ref = colName(c) + (r + 1)
      const s = cell && cell.s !== undefined ? cell.s : sh.rowS[r] ?? sh.colS[c] ?? 0
      const sx = s ? ` s="${sb.xf(s)}"` : ''
      const val = cell ? (cell.f != null ? model.valueAt(sh.id, r, c) : cell.v) : spillVal
      const vx = (v) => {
        if (v === null || v === undefined) return ['', '']
        if (typeof v === 'number') return Number.isFinite(v) ? ['', `<v>${v}</v>`] : ['t="e"', '<v>#NUM!</v>']
        if (typeof v === 'boolean') return ['t="b"', `<v>${v ? 1 : 0}</v>`]
        if (v instanceof XErr) return ['t="e"', `<v>${v.code === '#SPILL!' || v.code === '#CIRC!' ? '#VALUE!' : xmlEsc(v.code)}</v>`] // codes other spreadsheets do not know
        return null
      }
      if (cell && cell.f != null) {
        const ast = cell.ast
        const ftext = ast ? print(ast, fnOut) : cell.f
        const arr = cell.sp ? ` t="array" ref="${ref}:${colName(c + cell.sp.cols - 1)}${r + cell.sp.rows}"` : ''
        const f = `<f${arr}>${xmlEsc(ftext)}</f>`
        const x = vx(val)
        if (x) return `<c r="${ref}"${sx}${x[0] ? ' ' + x[0] : ''}>${f}${x[1]}</c>`
        return `<c r="${ref}"${sx} t="str">${f}<v>${xmlEsc(val)}</v></c>`
      }
      const x = vx(val)
      if (x) return x[1] || x[0] ? `<c r="${ref}"${sx}${x[0] ? ' ' + x[0] : ''}>${x[1]}</c>` : `<c r="${ref}"${sx}/>`
      return `<c r="${ref}"${sx} t="s"><v>${sstIdx(String(val))}</v></c>`
    }
    for (const [k, cell] of sh.cells) {
      const r = Math.floor(k / MAXC), c = k % MAXC
      if (cell.f == null && cell.v === null && !cell.s) continue
      put(r, c, cellXml(r, c, cell))
    }
    for (const [k, v] of sh.spill) {
      const r = Math.floor(k / MAXC), c = k % MAXC
      if (sh.cells.has(k) && sh.cells.get(k).f != null) continue
      put(r, c, cellXml(r, c, null, v))
    }
    const rowNums = new Set([...rows.keys(), ...Object.keys(sh.rowH).map(Number), ...Object.keys(sh.hideR).map(Number), ...Object.keys(sh.fHide).map(Number)])
    let data = ''
    for (const r of [...rowNums].sort((a, b) => a - b)) {
      const cells = (rows.get(r) || []).sort((a, b) => a[0] - b[0]).map((x) => x[1]).join('')
      const ht = sh.rowH[r] ? ` ht="${(sh.rowH[r] * 0.75).toFixed(2)}" customHeight="1"` : ''
      const hid = sh.hideR[r] || sh.fHide[r] ? ' hidden="1"' : ''
      data += `<row r="${r + 1}"${ht}${hid}>${cells}</row>`
    }
    let maxR = -1, maxC = -1
    for (const [r, cs] of rows) { maxR = Math.max(maxR, r); for (const [c] of cs) maxC = Math.max(maxC, c) }
    const colNums = [...new Set([...Object.keys(sh.colW), ...Object.keys(sh.hideC), ...Object.keys(sh.colS)].map(Number))].sort((a, b) => a - b)
    const cols = colNums.map((c) => `<col min="${c + 1}" max="${c + 1}" width="${((sh.colW[c] ?? 88) / 7).toFixed(2)}" customWidth="1"${sh.hideC[c] ? ' hidden="1"' : ''}${sh.colS[c] ? ` style="${sb.xf(sh.colS[c])}"` : ''}/>`).join('')
    const fr = sh.freeze
    const pane = fr.r || fr.c ? `<pane${fr.c ? ` xSplit="${fr.c}"` : ''}${fr.r ? ` ySplit="${fr.r}"` : ''} topLeftCell="${colName(fr.c)}${fr.r + 1}" activePane="${fr.r && fr.c ? 'bottomRight' : fr.r ? 'bottomLeft' : 'topRight'}" state="frozen"/>` : ''
    const merges = sh.merges.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${rangeText(m)}"/>`).join('')}</mergeCells>` : ''
    const filter = sh.filter ? `<autoFilter ref="${rangeText(sh.filter)}"/>` : ''
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${sh.color ? `<sheetPr><tabColor rgb="${argb(sh.color)}"/></sheetPr>` : ''}<dimension ref="A1${maxR >= 0 ? ':' + colName(maxC) + (maxR + 1) : ''}"/><sheetViews><sheetView workbookViewId="0"${sh.grid ? '' : ' showGridLines="0"'}${si === model.wb.active ? ' tabSelected="1"' : ''}>${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${data}</sheetData>${filter}${merges}${cfXml(model, sh, sb, prio)}${dvXml(sh)}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`
  })
  const names = Object.values(model.wb.names || {})
  const wbXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="${model.wb.active}"/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${names.length ? `<definedNames>${names.map((d) => `<definedName name="${xmlEsc(d.n)}">${xmlEsc(d.ref)}</definedName>`).join('')}</definedNames>` : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`)
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(model.wb.name)}</dc:title><dc:creator>Sheets</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`)
  zip.file('xl/workbook.xml', wbXml)
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`)
  sheetXml.forEach((x, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, x))
  zip.file('xl/styles.xml', sb.xml())
  zip.file('xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sstList.length}" uniqueCount="${sstList.length}">${sstList.map((s) => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join('')}</sst>`)
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' })
}

/** ODS (values, formulas and number formats; styling is not written). */
export async function writeOds(model) {
  const X = await sheetjs()
  const wb = X.utils.book_new()
  for (const sh of model.sheets) {
    const ws = {}
    let maxR = 0, maxC = 0
    const put = (r, c, cell, val) => {
      const nf = model.style(model.styleAt(sh, r, c)).nf
      const o = {}
      if (cell && cell.f != null) { o.f = print(cell.ast || { t: 'str', v: cell.f }); o.v = val }
      else o.v = val
      if (typeof val === 'number') o.t = 'n'; else if (typeof val === 'boolean') o.t = 'b'; else if (val instanceof XErr) { o.t = 'e'; o.v = 0x2a } else o.t = 's'
      if (val === null || val === undefined) return
      if (nf && nf !== 'General') o.z = nf
      ws[X.utils.encode_cell({ r, c })] = o
      maxR = Math.max(maxR, r); maxC = Math.max(maxC, c)
    }
    for (const [k, cell] of sh.cells) { const r = Math.floor(k / MAXC), c = k % MAXC; put(r, c, cell, cell.f != null ? model.valueAt(sh.id, r, c) : cell.v) }
    for (const [k, v] of sh.spill) { const r = Math.floor(k / MAXC), c = k % MAXC; if (!sh.cells.has(k)) put(r, c, null, v) }
    ws['!ref'] = X.utils.encode_range({ r: 0, c: 0 }, { r: maxR, c: maxC })
    if (sh.merges.length) ws['!merges'] = sh.merges.map((m) => ({ s: { r: m.r1, c: m.c1 }, e: { r: m.r2, c: m.c2 } }))
    X.utils.book_append_sheet(wb, ws, sh.name.slice(0, 31))
  }
  const quiet = console.error
  console.error = () => {} // SheetJS logs a warning for date formats such as dd-mmm-yyyy
  let out
  try { out = X.write(wb, { bookType: 'ods', type: 'array' }) } finally { console.error = quiet }
  return new Blob([out], { type: 'application/vnd.oasis.opendocument.spreadsheet' })
}
