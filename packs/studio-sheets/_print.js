// PDF export: pages are painted from the model (fills, borders, wrapped text, conditional formats) and placed in a jsPDF
// document, with an invisible text layer on top so the text stays searchable and selectable.
import { jspdf } from '../../lib/libs.js'
import { ck } from './_a1.js'
import { formatValue } from './_fmt.js'
import { cfAt, rulesOf, textOn } from './_cf.js'
import { fontPx } from './_axis.js'
import { DEFAULT_COL_W, DEFAULT_ROW_H } from './_model.js'
import { chartImage } from './_charts.js'

const PAPER = { a4: [595.28, 841.89], letter: [612, 792], a3: [841.89, 1190.55], legal: [612, 1008] }
const latin1 = (s) => String(s).replace(/₹/g, 'Rs.').replace(/[^ -ÿ\n]/g, '?')

function visibleSizes(sh, from, to, def, hide, fHide, custom) {
  const out = []
  for (let i = from; i <= to; i++) { if (hide[i] || (fHide && fHide[i])) continue; out.push({ i, s: custom[i] ?? def }) }
  return out
}

/** Paint one page of cells onto a canvas context. All sizes are sheet pixels times k. */
function paint(g, model, sh, rows, cols, k, o) {
  const xs = [], ys = []
  let x = 0
  for (const c of cols) { xs.push(x); x += c.s * k }
  let y = 0
  for (const r of rows) { ys.push(y); y += r.s * k }
  const W = x, H = y
  const colAt = new Map(cols.map((c, i) => [c.i, i])), rowAt = new Map(rows.map((r, i) => [r.i, i]))
  const rules = rulesOf(sh)
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H)
  if (o.grid) {
    g.strokeStyle = '#d9d9e2'; g.lineWidth = 1; g.beginPath()
    for (let i = 0; i <= cols.length; i++) { const px = (i < cols.length ? xs[i] : W); g.moveTo(Math.round(px) + 0.5, 0); g.lineTo(Math.round(px) + 0.5, H) }
    for (let j = 0; j <= rows.length; j++) { const py = (j < rows.length ? ys[j] : H); g.moveTo(0, Math.round(py) + 0.5); g.lineTo(W, Math.round(py) + 0.5) }
    g.stroke()
  }
  const texts = []
  const inner = new Set()
  const merged = []
  for (const m of sh.merges) {
    const mc = cols.filter((c) => c.i >= m.c1 && c.i <= m.c2), mr = rows.filter((r) => r.i >= m.r1 && r.i <= m.r2)
    if (!mc.length || !mr.length) continue
    const ci = colAt.get(mc[0].i), ri = rowAt.get(mr[0].i)
    merged.push({ r: m.r1, c: m.c1, x: xs[ci], y: ys[ri], w: mc.reduce((a, c) => a + c.s * k, 0), h: mr.reduce((a, r) => a + r.s * k, 0) })
    for (const r of mr) for (const c of mc) inner.add(ck(r.i, c.i))
  }
  const items = []
  rows.forEach((r, ri) => cols.forEach((c, ci) => { if (!inner.has(ck(r.i, c.i))) items.push({ r: r.i, c: c.i, x: xs[ci], y: ys[ri], w: c.s * k, h: r.s * k }) }))
  for (const m of merged) items.push({ ...m, merged: true })
  const draw = []
  for (const it of items) {
    const v = model.valueAt(sh.id, it.r, it.c)
    const cell = sh.cells.get(ck(it.r, it.c))
    const sId = cell && cell.s !== undefined ? cell.s : sh.rowS[it.r] ?? sh.colS[it.c] ?? 0
    const cf = rules ? cfAt(model, sh, rules, it.r, it.c, v) : null
    if (v === null && !sId && !cf && !it.merged) continue
    draw.push({ ...it, v, st: cf ? { ...model.style(sId), ...cf } : model.style(sId), cf })
  }
  for (const n of draw) {
    if (n.st.bg || n.merged) { g.fillStyle = n.st.bg || '#ffffff'; g.fillRect(n.x, n.y, n.w, n.h) }
    if (n.cf?.bar) { const b = n.cf.bar; const from = Math.min(b.z, b.p), to = Math.max(b.z, b.p); g.fillStyle = b.color; g.globalAlpha = 0.55; g.fillRect(n.x + 2 + from * (n.w - 4), n.y + 3, Math.max(1, (to - from) * (n.w - 4)), n.h - 6); g.globalAlpha = 1 }
  }
  const line = (b, x1, y1, x2, y2) => {
    g.strokeStyle = b.c || '#000'; g.lineWidth = (b.s === 'thick' ? 3 : b.s === 'medium' ? 2 : 1) * Math.max(1, o.dpr / 2)
    g.setLineDash(b.s === 'dashed' ? [5, 3] : b.s === 'dotted' ? [1.5, 2] : [])
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.setLineDash([])
  }
  for (const n of draw) {
    const s = n.st
    if (s.bt) line(s.bt, n.x, n.y, n.x + n.w, n.y)
    if (s.bb) line(s.bb, n.x, n.y + n.h, n.x + n.w, n.y + n.h)
    if (s.bl) line(s.bl, n.x, n.y, n.x, n.y + n.h)
    if (s.br) line(s.br, n.x + n.w, n.y, n.x + n.w, n.y + n.h)
  }
  for (const n of draw) {
    const v = n.v
    if (v === null || v === '') continue
    const st = n.st
    const f = formatValue(v, st.nf)
    if (!f.text) continue
    const num = typeof v === 'number', isErr = typeof v === 'object'
    const ha = st.ha || (num ? 'right' : typeof v === 'boolean' || isErr ? 'center' : 'left')
    const va = st.va || 'middle'
    const fs = fontPx(st) * k
    g.font = `${st.i ? 'italic ' : ''}${st.b ? '600 ' : ''}${fs}px ${o.font}`
    g.fillStyle = f.color || st.fc || (st.bg ? textOn(st.bg) : '#111111')
    g.textBaseline = 'alphabetic'
    const pad = 5 * k + (st.ind ? st.ind * 10 * k : 0)
    let lines = [f.text]
    const inW = n.w - 10 * k
    if (st.wr && !num) {
      lines = []
      for (const para of f.text.split('\n')) {
        let cur = ''
        for (const word of para.split(/(\s+)/)) { const t = cur + word; if (cur && g.measureText(t.trimEnd()).width > inW) { lines.push(cur.trimEnd()); cur = word.trimStart() } else cur = t }
        lines.push(cur.trimEnd())
      }
    } else if (num && g.measureText(f.text).width > inW) lines = ['#'.repeat(Math.max(1, Math.floor(inW / g.measureText('#').width)))]
    const lh = fs * 1.25
    const block = lines.length * lh
    let y0 = va === 'top' ? n.y + 3 * k + lh * 0.82 : va === 'bottom' ? n.y + n.h - 3 * k - block + lh * 0.82 : n.y + (n.h - block) / 2 + lh * 0.82
    let cx = n.x, cw = n.w
    if (lines.length === 1 && !st.wr && !num && !isErr && ha === 'left') {
      const tw = g.measureText(lines[0]).width + pad * 2
      if (tw > n.w) {
        let ci = colAt.get(n.c)
        let acc = n.w
        while (acc < tw && ci !== undefined && ci + 1 < cols.length) { ci++; const c = cols[ci]; if (model.valueAt(sh.id, n.r, c.i) !== null) break; acc += c.s * k }
        cw = acc
      }
    }
    g.save(); g.beginPath(); g.rect(cx, n.y, cw, n.h); g.clip()
    for (const ln of lines) {
      const tw = g.measureText(ln).width
      const tx = ha === 'right' ? n.x + n.w - pad - tw : ha === 'center' ? n.x + (n.w - tw) / 2 : n.x + pad
      g.fillText(ln, tx, y0)
      if (st.u || st.st) { g.lineWidth = Math.max(1, fs / 14); g.strokeStyle = g.fillStyle; g.beginPath(); if (st.u) { g.moveTo(tx, y0 + fs * 0.12); g.lineTo(tx + tw, y0 + fs * 0.12) } if (st.st) { g.moveTo(tx, y0 - fs * 0.3); g.lineTo(tx + tw, y0 - fs * 0.3) } g.stroke() }
      texts.push({ text: ln, x: tx, y: y0, size: fs })
      y0 += lh
    }
    g.restore()
  }
  return { W, H, texts }
}

/**
 * opts: {sel, range: 'sheet'|'selection', paper, orientation: 'auto'|'portrait'|'landscape', fit: bool, grid: bool, charts: bool, title: bool, allSheets: bool, font}
 */
export async function buildPdf(model, activeSheet, opts, onProgress) {
  const jsPDF = await jspdf()
  const [pw0, ph0] = PAPER[opts.paper] || PAPER.a4
  const sheets = opts.allSheets ? model.sheets : [activeSheet]
  let doc = null
  const dpr = 2.2
  let pageNo = 0
  const pages = []
  for (const sh of sheets) {
    let rect = opts.range === 'selection' && sh === activeSheet ? opts.sel : model.usedRange(sh)
    if (!rect) { if (sheets.length > 1) continue; rect = { r1: 0, c1: 0, r2: 0, c2: 0 } }
    const cols = visibleSizes(sh, rect.c1, rect.c2, DEFAULT_COL_W, sh.hideC, null, sh.colW)
    const rowsAll = visibleSizes(sh, rect.r1, rect.r2, DEFAULT_ROW_H, sh.hideR, sh.fHide, sh.rowH)
    if (!cols.length || !rowsAll.length) continue
    const totalW = cols.reduce((a, c) => a + c.s, 0), totalH = rowsAll.reduce((a, r) => a + r.s, 0)
    const orient = opts.orientation === 'auto' ? (totalW > totalH * 0.9 ? 'l' : 'p') : opts.orientation === 'landscape' ? 'l' : 'p'
    const [pw, ph] = orient === 'l' ? [ph0, pw0] : [pw0, ph0]
    const margin = 30, footer = 22
    const cw = pw - margin * 2, chh = ph - margin * 2 - footer
    const k = opts.fit ? Math.min(0.95, cw / totalW) : 0.75
    // column pages (only when not fitting) and row pages
    const colPages = []
    let cur = [], acc = 0
    for (const c of cols) { if (cur.length && acc + c.s * k > cw) { colPages.push(cur); cur = []; acc = 0 } cur.push(c); acc += c.s * k }
    if (cur.length) colPages.push(cur)
    const frozen = sh.freeze.r > 0 ? rowsAll.filter((r) => r.i < sh.freeze.r) : []
    const rowPages = []
    let page = [], used = 0
    for (const r of rowsAll) {
      const rh = r.s * k
      if (page.length && used + rh > chh) { rowPages.push(page); page = frozen.filter((f) => f !== r); used = page.reduce((a, x) => a + x.s * k, 0) }
      if (!page.includes(r)) { page.push(r); used += rh }
    }
    if (page.length) rowPages.push(page)
    for (const rp of rowPages) for (const cp of colPages) pages.push({ sh, rows: rp, cols: cp, k, pw, ph, orient, margin })
    if (opts.charts) for (const ch of sh.charts) pages.push({ sh, chart: ch, pw: pw0 > ph0 ? pw0 : ph0, ph: pw0 > ph0 ? ph0 : pw0, orient: 'l', margin })
  }
  if (!pages.length) throw new Error('There is nothing to print on this sheet.')
  const total = pages.length
  for (const p of pages) {
    pageNo++
    onProgress?.(pageNo / total, `Page ${pageNo} of ${total}`)
    if (!doc) doc = new jsPDF({ unit: 'pt', format: [p.pw, p.ph], orientation: p.orient === 'l' ? 'landscape' : 'portrait', compress: true })
    else doc.addPage([p.pw, p.ph], p.orient === 'l' ? 'landscape' : 'portrait')
    if (p.chart) {
      const url = await chartImage(model, p.chart, 960, 540)
      const w = p.pw - p.margin * 2, hh = Math.min(p.ph - p.margin * 2 - 30, (w * 540) / 960)
      doc.addImage(url, 'PNG', p.margin, p.margin + 20, w, hh)
      doc.setFontSize(9); doc.setTextColor(110)
      doc.text(latin1(`${p.sh.name}${p.chart.title ? ' - ' + p.chart.title : ''}`), p.margin, p.margin + 10)
    } else {
      const cv = document.createElement('canvas')
      const pageW = p.cols.reduce((a, c) => a + c.s * p.k, 0), pageH = p.rows.reduce((a, r) => a + r.s * p.k, 0)
      cv.width = Math.max(1, Math.round(pageW * dpr)); cv.height = Math.max(1, Math.round(pageH * dpr))
      const g = cv.getContext('2d')
      g.scale(dpr, dpr)
      const res = paint(g, model, p.sh, p.rows, p.cols, p.k, { grid: opts.grid, font: opts.font || 'Geist, Helvetica, Arial, sans-serif', dpr })
      doc.addImage(cv.toDataURL('image/png'), 'PNG', p.margin, p.margin, pageW, pageH, undefined, 'FAST')
      doc.setFontSize(8)
      for (const t of res.texts) {
        doc.setFontSize(Math.max(2, t.size))
        doc.text(latin1(t.text), p.margin + t.x, p.margin + t.y, { renderingMode: 'invisible' })
      }
    }
    if (opts.title !== false) {
      doc.setFontSize(8); doc.setTextColor(120)
      doc.text(latin1(`${model.wb.name}${p.sh ? ' | ' + p.sh.name : ''}`), p.margin, p.ph - p.margin + 4)
      doc.text(`Page ${pageNo} of ${total}`, p.pw - p.margin, p.ph - p.margin + 4, { align: 'right' })
      doc.setTextColor(0)
    }
    await new Promise((r) => setTimeout(r, 0))
  }
  return doc.output('blob')
}
