// Invoice -> PDF with jsPDF: header, bill-to, item table with GST columns, totals, tax summary, amount in words, bank + UPI QR,
// notes, signature, page numbers. Real text (selectable). The rupee sign needs a Unicode font, loaded on demand.
import { newDoc, hexRgb, tint, winAnsi, unsupportedChars } from './_pdf.js'
import { addRoboto } from './_fonts.js'
import { qrModel, pdfQr } from './_qr.js'
import { calcInvoice, money, amountInWords, CURRENCIES, stateName } from './_invoice.js'

const INK = [24, 24, 27], MUTED = [102, 106, 116], LINE = [226, 229, 234]
const loadImg = (src) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = src })
const fmtDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? new Date(`${v}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : v || '')
const trimNum = (n) => String(Math.round(n * 1000) / 1000)

export async function buildInvoicePdf(inv) {
  const calc = calcInvoice(inv)
  const { lines, totals: T, taxRows, intra, gst } = calc
  const cur = inv.currency
  const C = CURRENCIES[cur] || CURRENCIES.USD
  const needUni = cur === 'INR' || unsupportedChars(JSON.stringify([inv.seller, inv.buyer, inv.items, inv.notes, inv.terms, inv.signatory])).length > 0
  const doc = await newDoc({ page: 'a4', title: `Invoice ${inv.number}`, author: inv.seller.name, subject: gst ? 'Tax invoice' : 'Invoice' })
  const uni = needUni ? await addRoboto(doc) : false
  const font = uni ? 'Roboto' : 'helvetica'
  const clean = (s) => (uni ? String(s ?? '') : winAnsi(s))
  const sym = uni ? C.sym : C.ascii
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 36, CW = W - M * 2, BOTTOM = H - 58
  const accent = hexRgb(inv.accent)
  const bold = inv.look === 'bold'
  const set = (size = 9, style = 'normal', color = INK) => { doc.setFont(font, style); doc.setFontSize(size); doc.setTextColor(...color) }
  const text = (s, x, yy, o) => doc.text(clean(s), x, yy, o)
  const wrap = (s, w, size, style) => { set(size, style); return doc.splitTextToSize(clean(s), w) }
  const para = (s, x, yy, w, size, style, color, lh = 1.35) => { const ls = wrap(s, w, size, style); set(size, style, color); ls.forEach((l, i) => doc.text(l, x, yy + i * size * lh)); return yy + ls.length * size * lh }
  const fmt = (p) => money(p, cur)
  const withSym = (p) => `${sym}${money(p, cur)}`
  const title = gst ? 'TAX INVOICE' : 'INVOICE'
  let y = 0

  // ---------- header ----------
  if (bold) { doc.setFillColor(...accent); doc.rect(0, 0, W, 112, 'F') } else { doc.setFillColor(...accent); doc.rect(0, 0, W, 7, 'F') }
  y = bold ? 30 : 34
  let leftX = M
  const logo = inv.seller.logo ? await loadImg(inv.seller.logo) : null
  if (logo) {
    const maxW = 120, maxH = 52
    const k = Math.min(maxW / logo.naturalWidth, maxH / logo.naturalHeight)
    const w = logo.naturalWidth * k, hh = logo.naturalHeight * k
    try { doc.addImage(inv.seller.logo, /^data:image\/png/.test(inv.seller.logo) ? 'PNG' : 'JPEG', M, y - 6, w, hh) ; leftX = M + w + 14 } catch { /* unsupported image */ }
  }
  const nameCol = bold ? [255, 255, 255] : INK
  const subCol = bold ? [236, 244, 243] : MUTED
  set(15, 'bold', nameCol)
  let ly = y + 8
  const nameLines = wrap(inv.seller.name || 'Your business name', 250, 15, 'bold')
  set(15, 'bold', nameCol); nameLines.forEach((l, i) => doc.text(l, leftX, ly + i * 18)); ly += nameLines.length * 18 - 4
  const sellerInfo = [inv.seller.address, inv.seller.gstin && `GSTIN: ${inv.seller.gstin.toUpperCase()}`, inv.seller.pan && `PAN: ${inv.seller.pan.toUpperCase()}`, [inv.seller.email, inv.seller.phone].filter(Boolean).join('  |  ')].filter(Boolean).join('\n')
  if (sellerInfo) ly = para(sellerInfo, leftX, ly + 8, 250, 8.5, 'normal', subCol, 1.4)
  // title and meta on the right
  set(bold ? 24 : 22, 'bold', bold ? [255, 255, 255] : accent)
  text(title, W - M, y + 14, { align: 'right' })
  const meta = [['Invoice no.', inv.number], ['Date', fmtDate(inv.date)], ['Due date', fmtDate(inv.due)], inv.po && ['PO number', inv.po], gst && inv.placeOfSupply && ['Place of supply', `${inv.placeOfSupply} - ${stateName(inv.placeOfSupply)}`]].filter(Boolean)
  let my = y + 34
  for (const [k, v] of meta) { set(8.5, 'normal', subCol); text(k, W - M - 150, my); set(9, 'bold', nameCol); text(String(v), W - M, my, { align: 'right' }); my += 13 }
  y = Math.max(ly, my, bold ? 112 : 0) + 18

  // ---------- bill to ----------
  const boxTop = y
  set(8, 'bold', accent); text('BILL TO', M, y); y += 13
  set(11, 'bold'); text(inv.buyer.name || 'Customer name', M, y); y += 5
  const buyerInfo = [inv.buyer.address, inv.buyer.gstin && `GSTIN: ${inv.buyer.gstin.toUpperCase()}`, inv.buyer.state && gst && `State: ${inv.buyer.state} - ${stateName(inv.buyer.state)}`, [inv.buyer.email, inv.buyer.phone].filter(Boolean).join('  |  ')].filter(Boolean).join('\n')
  if (buyerInfo) y = para(buyerInfo, M, y + 8, 270, 9, 'normal', MUTED, 1.4) - 4
  if (gst) {
    const bx = W - M - 230
    doc.setFillColor(...tint(accent, 0.9)); doc.roundedRect(bx, boxTop - 4, 230, 44, 6, 6, 'F')
    set(8, 'bold', accent); text('SUPPLY', bx + 12, boxTop + 10)
    set(9, 'normal'); text(intra ? 'Within state: CGST + SGST' : 'Between states: IGST', bx + 12, boxTop + 24)
    set(8, 'normal', MUTED); text(inv.placeOfSupply ? `Place of supply: ${stateName(inv.placeOfSupply)}` : 'Place of supply not set', bx + 12, boxTop + 35)
  }
  y = Math.max(y, boxTop + 48) + 12

  // ---------- items table ----------
  const cols = gst
    ? [['#', 20, 'c'], ['Description', 156, 'l'], ['HSN/SAC', 50, 'l'], ['Qty', 38, 'r'], ['Rate', 56, 'r'], ['Taxable', 62, 'r'], ['GST %', 32, 'r'], ['Tax', 50, 'r'], ['Amount', 59, 'r']]
    : [['#', 24, 'c'], ['Description', 245, 'l'], ['Qty', 52, 'r'], ['Rate', 70, 'r'], ['Disc %', 46, 'r'], ['Amount', 86, 'r']]
  const colX = []; { let x = M; for (const c of cols) { colX.push(x); x += c[1] } }
  const cell = (i, s, yy, { style = 'normal', color = INK, size = 8.5 } = {}) => {
    const [, w, a] = cols[i]
    set(size, style, color)
    const x = a === 'r' ? colX[i] + w - 5 : a === 'c' ? colX[i] + w / 2 : colX[i] + 5
    doc.text(clean(s), x, yy, { align: a === 'r' ? 'right' : a === 'c' ? 'center' : 'left' })
  }
  const header = () => {
    const hh = 20
    if (bold) { doc.setFillColor(...accent); doc.rect(M, y, CW, hh, 'F') } else { doc.setFillColor(...tint(accent, 0.88)); doc.rect(M, y, CW, hh, 'F') }
    cols.forEach((c, i) => cell(i, c[0], y + 13.5, { style: 'bold', color: bold ? [255, 255, 255] : accent, size: 8 }))
    y += hh
  }
  const newPage = () => {
    footer(); doc.addPage(); y = M
    doc.setFillColor(...accent); doc.rect(0, 0, W, 5, 'F'); y = 30
    set(9, 'bold', MUTED); text(`${title} ${inv.number} (continued)`, M, y); y += 16
  }
  const footer = () => {
    doc.setDrawColor(...LINE); doc.setLineWidth(0.6); doc.line(M, H - 40, W - M, H - 40)
    set(7.5, 'normal', MUTED); text('This is a computer generated invoice.', M, H - 27)
  }
  header()
  lines.forEach((l, idx) => {
    const descLines = wrap(l.desc || 'Item', cols[1][1] - 10, 8.5, 'normal')
    const extra = l.disc > 0 ? 1 : 0
    const rh = Math.max(22, (descLines.length + extra) * 11 + 9)
    if (y + rh > BOTTOM) { newPage(); header() }
    const ty = y + 14
    cell(0, String(idx + 1), ty, { color: MUTED })
    set(8.5, 'normal'); descLines.forEach((s, k) => doc.text(s, colX[1] + 5, ty + k * 11))
    if (l.disc > 0) { set(7.5, 'normal', MUTED); text(`Discount ${trimNum(l.disc)}%`, colX[1] + 5, ty + descLines.length * 11) }
    if (gst) {
      cell(2, l.hsn || '-', ty, { color: MUTED })
      cell(3, `${trimNum(l.qty)}${l.unit ? ` ${l.unit}` : ''}`, ty)
      cell(4, fmt(P100(l.rate)), ty)
      cell(5, fmt(l.taxable), ty)
      cell(6, trimNum(l.rateGst), ty, { color: MUTED })
      cell(7, fmt(l.tax), ty)
      cell(8, fmt(l.total), ty, { style: 'bold' })
    } else {
      cell(2, `${trimNum(l.qty)}${l.unit ? ` ${l.unit}` : ''}`, ty)
      cell(3, fmt(P100(l.rate)), ty)
      cell(4, l.disc ? trimNum(l.disc) : '-', ty, { color: MUTED })
      cell(5, fmt(l.taxable), ty, { style: 'bold' })
    }
    y += rh
    doc.setDrawColor(...LINE); doc.setLineWidth(0.5); doc.line(M, y, W - M, y)
  })
  if (!lines.length) { set(9, 'normal', MUTED); text('Add at least one item to see it here.', M + 6, y + 18); y += 30 }
  y += 14

  // ---------- totals + words ----------
  const trows = []
  trows.push(['Subtotal', fmt(T.gross)])
  if (T.discount) trows.push(['Discount', `- ${fmt(T.discount)}`])
  if (gst) {
    trows.push(['Taxable value', fmt(T.taxable)])
    if (intra) for (const r of taxRows.filter((x) => x.rate > 0)) { trows.push([`CGST @ ${trimNum(r.rate / 2)}%`, fmt(r.cgst)]); trows.push([`SGST @ ${trimNum(r.rate / 2)}%`, fmt(r.sgst)]) }
    else for (const r of taxRows.filter((x) => x.rate > 0)) trows.push([`IGST @ ${trimNum(r.rate)}%`, fmt(r.igst)])
  }
  if (T.round) trows.push(['Round off', `${T.round < 0 ? '- ' : ''}${fmt(Math.abs(T.round))}`])
  const mergedRows = trows
  const boxW = 230, bx = W - M - boxW
  const totalsH = mergedRows.length * 15 + 34
  if (y + Math.max(totalsH, 70) > BOTTOM) newPage()
  const topY = y
  let ty = y + 4
  for (const [k, v] of mergedRows) { set(9, 'normal', MUTED); text(k, bx, ty + 8); set(9, 'normal'); text(v, W - M, ty + 8, { align: 'right' }); ty += 15 }
  doc.setFillColor(...accent); doc.roundedRect(bx - 8, ty + 2, boxW + 8, 26, 5, 5, 'F')
  set(10, 'bold', [255, 255, 255]); text(gst ? 'Total payable' : 'Total', bx, ty + 19)
  set(12, 'bold', [255, 255, 255]); text(withSym(T.payable), W - M - 8, ty + 19, { align: 'right' })
  ty += 34
  // words on the left
  set(8, 'bold', accent); text('AMOUNT IN WORDS', M, topY + 12)
  let wy = para(amountInWords(T.payable, cur), M, topY + 26, 270, 9.5, 'bold', INK, 1.4)
  y = Math.max(ty, wy) + 10

  // ---------- tax summary ----------
  if (gst && taxRows.length) {
    const rowH = 15
    const need = 22 + (taxRows.length + 1) * rowH
    if (y + need > BOTTOM) newPage()
    set(8, 'bold', accent); text('TAX SUMMARY', M, y + 8); y += 14
    const tcols = intra ? [['HSN/SAC', 78], ['Taxable value', 92], ['CGST %', 44], ['CGST', 70], ['SGST %', 44], ['SGST', 70], ['Total tax', 125]] : [['HSN/SAC', 110], ['Taxable value', 130], ['IGST %', 70], ['IGST', 100], ['Total tax', 113]]
    let x0 = M
    doc.setFillColor(...tint(accent, 0.9)); doc.rect(M, y, CW, rowH, 'F')
    tcols.forEach((c, i) => { set(7.5, 'bold', accent); const right = i > 0; text(c[0], right ? x0 + c[1] - 5 : x0 + 5, y + 10.5, { align: right ? 'right' : 'left' }); x0 += c[1] })
    y += rowH
    for (const r of taxRows) {
      const vals = intra ? [r.hsn || '-', fmt(r.taxable), trimNum(r.rate / 2), fmt(r.cgst), trimNum(r.rate / 2), fmt(r.sgst), fmt(r.tax)] : [r.hsn || '-', fmt(r.taxable), trimNum(r.rate), fmt(r.igst), fmt(r.tax)]
      let x = M
      tcols.forEach((c, i) => { set(8, 'normal'); const right = i > 0; text(String(vals[i]), right ? x + c[1] - 5 : x + 5, y + 10.5, { align: right ? 'right' : 'left' }); x += c[1] })
      y += rowH
      doc.setDrawColor(...LINE); doc.setLineWidth(0.4); doc.line(M, y, W - M, y)
    }
    y += 14
  }

  // ---------- bank, UPI, notes, signature ----------
  const bank = [inv.seller.holder && ['Account name', inv.seller.holder], inv.seller.bankName && ['Bank', inv.seller.bankName], inv.seller.account && ['Account no.', inv.seller.account], inv.seller.ifsc && ['IFSC', inv.seller.ifsc.toUpperCase()], inv.seller.branch && ['Branch', inv.seller.branch], inv.seller.upi && ['UPI ID', inv.seller.upi]].filter(Boolean)
  const showQr = cur === 'INR' && !!inv.seller.upi
  const notes = [inv.notes && `Notes: ${inv.notes}`, inv.terms && `Terms: ${inv.terms}`].filter(Boolean).join('\n')
  const blockH = Math.max(bank.length * 12 + 20, showQr ? 92 : 0, notes ? wrap(notes, 300, 8.5, 'normal').length * 12 + 20 : 0, 70)
  if (y + blockH + 50 > BOTTOM + 30) newPage()
  const by = y
  let leftY = by
  if (bank.length) {
    set(8, 'bold', accent); text('PAYMENT DETAILS', M, leftY + 8); leftY += 20
    for (const [k, v] of bank) { set(8.5, 'normal', MUTED); text(k, M, leftY); set(8.5, 'bold'); text(String(v), M + 74, leftY); leftY += 12 }
  }
  if (showQr) {
    try {
      const amt = (T.payable / 100).toFixed(2)
      const upi = `upi://pay?pa=${encodeURIComponent(inv.seller.upi).replace(/%40/g, '@')}&pn=${encodeURIComponent(inv.seller.name || '')}&am=${amt}&cu=INR&tn=${encodeURIComponent(`Invoice ${inv.number}`)}`
      const model = await qrModel(upi, 'M')
      const qs = 74, qx = M + 232
      doc.setDrawColor(...LINE); doc.roundedRect(qx - 4, by + 4, qs + 8, qs + 22, 5, 5, 'S')
      pdfQr(doc, model, qx, by + 8, qs, { fg: [20, 20, 24], margin: 0 })
      set(7.5, 'normal', MUTED); text('Scan to pay with any UPI app', qx + qs / 2, by + qs + 20, { align: 'center' })
    } catch (e) { console.warn('UPI QR skipped', e) }
  }
  if (notes) { leftY = Math.max(leftY, by + (showQr ? 100 : 0)) + (bank.length ? 8 : 0); leftY = para(notes, M, leftY + 6, 330, 8.5, 'normal', MUTED, 1.4) }
  // signature right
  const sx = W - M - 170
  const sy = Math.max(by, y) + 12
  set(8.5, 'normal', MUTED); text(`For ${inv.seller.name || 'your business'}`, W - M, by + 14, { align: 'right' })
  doc.setDrawColor(...LINE); doc.setLineWidth(0.8); doc.line(sx, by + 62, W - M, by + 62)
  set(8.5, 'bold'); text(inv.signatory || 'Authorised signatory', W - M, by + 75, { align: 'right' })
  void sy
  footer()

  const total = doc.getNumberOfPages()
  for (let i = 1; i <= total; i++) { doc.setPage(i); set(7.5, 'normal', MUTED); text(`Page ${i} of ${total}`, W - M, H - 27, { align: 'right' }) }
  return { blob: doc.output('blob'), pages: total, unicode: uni }
}

const P100 = (rate) => Math.round(rate * 100 + 1e-7)
