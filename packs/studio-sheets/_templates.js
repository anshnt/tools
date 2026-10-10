// Ready-made workbooks (budget, EMI, GST invoice, grade book). Each builds a plain description that modelFromDesc() turns into a model.
import { parseCell } from './_a1.js'
import { FMT } from './_fmt.js'
import { CF_PRESETS } from './_cf.js'

const INK = '#1f2937', ACCENT = '#5b4cf0', SOFT = '#eef0ff', LINE = '#d6d9e4'
const border = { bt: { s: 'thin', c: LINE }, bb: { s: 'thin', c: LINE }, bl: { s: 'thin', c: LINE }, br: { s: 'thin', c: LINE } }
const head = { b: true, fc: '#ffffff', bg: ACCENT, ha: 'center', va: 'middle' }
const title = { b: true, fs: 18, fc: INK }
const label = { b: true, fc: '#4b5563' }
const note = { i: true, fc: '#6b7280' }
const inr = { nf: FMT.inr0 }
const inr2 = { nf: FMT.inr }

function sheet(name) {
  const s = {
    name, cells: [], colW: {}, rowH: {}, merges: [], freeze: { r: 0, c: 0 }, cf: [], charts: [], grid: false,
    set(a, v, st = {}) {
      const p = parseCell(a)
      if (typeof v === 'string' && v[0] === '=') s.cells.push([p.r, p.c, null, v.slice(1), st])
      else s.cells.push([p.r, p.c, v, null, st])
      return s
    },
    cols(map) { Object.assign(s.colW, map); return s },
  }
  return s
}
let n = 0
const id = () => 'tpl' + ++n
const rule = (range, o) => ({ id: id(), range, ...o })
const rng = (a, b) => { const x = parseCell(a), y = parseCell(b); return { r1: x.r, c1: x.c, r2: y.r, c2: y.c } }

function budget() {
  const s = sheet('Budget')
  s.cols({ 0: 190, 1: 104, 2: 112, 3: 88, 4: 88, 5: 88, 6: 88, 7: 88, 8: 88, 9: 110 })
  s.set('A1', 'Monthly budget', title)
  s.set('A2', 'Type over the blue numbers. Totals, remaining and the chart update by themselves.', note)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
  ;['Category', 'Total', 'Monthly budget', ...months, 'Remaining'].forEach((t, i) => s.set(String.fromCharCode(65 + i) + '4', t, head))
  const income = [['Salary', 90000, [90000, 90000, 90000, 90000, 92000, 92000]], ['Freelance', 15000, [12000, 18000, 9000, 15000, 21000, 14000]], ['Other income', 3000, [2500, 0, 4000, 3000, 1000, 3500]]]
  const exp = [['Rent', 28000, [28000, 28000, 28000, 28000, 28000, 28000]], ['Groceries', 12000, [11200, 12800, 10900, 13400, 11800, 12100]], ['Utilities', 4500, [4100, 4600, 4300, 4900, 5200, 4400]], ['Transport', 5000, [4200, 5300, 4800, 5600, 4900, 5100]],
    ['Dining out', 6000, [5200, 7400, 6800, 5100, 6300, 8200]], ['Insurance', 3500, [3500, 3500, 3500, 3500, 3500, 3500]], ['Subscriptions', 1500, [1400, 1400, 1500, 1500, 1500, 1700]], ['Savings', 25000, [25000, 25000, 25000, 25000, 25000, 25000]]]
  const blue = { fc: '#1d4ed8', ...inr, ...border }
  const row = (r, name, b, vals, remaining) => {
    s.set('A' + r, name, border).set('C' + r, b, blue)
    vals.forEach((v, j) => s.set(String.fromCharCode(68 + j) + r, v, blue))
    s.set('B' + r, `=SUM(D${r}:I${r})`, { ...inr, ...border, b: true }).set('J' + r, remaining(r), { ...inr, ...border })
  }
  const total = (r, name, a, z) => {
    s.set('A' + r, name, { b: true, bg: SOFT })
    'BCDEFGHIJ'.split('').forEach((c) => s.set(c + r, `=SUM(${c}${a}:${c}${z})`, { ...inr, b: true, bg: SOFT }))
  }
  s.set('A5', 'INCOME', { b: true, fc: ACCENT })
  income.forEach(([name, b, vals], i) => row(6 + i, name, b, vals, (r) => `=B${r}-C${r}*6`))
  total(9, 'Total income', 6, 8)
  s.set('A11', 'EXPENSES', { b: true, fc: ACCENT })
  exp.forEach(([name, b, vals], i) => row(12 + i, name, b, vals, (r) => `=C${r}*6-B${r}`))
  total(20, 'Total expenses', 12, 19)
  s.set('A22', 'Net (income minus expenses)', { b: true }).set('B22', '=B9-B20', { ...inr, b: true })
  s.set('A23', 'Savings rate', { b: true }).set('B23', '=IF(B9=0,0,B22/B9)', { nf: FMT.pct0, b: true })
  s.set('A24', 'Average monthly spend', { b: true }).set('B24', '=B20/COUNT(D20:I20)', { ...inr, b: true })
  s.set('A25', 'Highest spending category', { b: true }).set('B25', '=INDEX(A12:A19,MATCH(MAX(B12:B19),B12:B19,0))', { b: true, ha: 'right' })
  s.freeze = { r: 4, c: 0 }
  s.cf = [rule(rng('J12', 'J19'), { type: 'cell', op: 'lt', v1: '0', style: CF_PRESETS.red }), rule(rng('J12', 'J19'), { type: 'cell', op: 'ge', v1: '0', style: CF_PRESETS.green }), rule(rng('B12', 'B19'), { type: 'bar', color: '#8b7dff' })]
  s.charts = [{ id: id(), type: 'bar', title: 'Spend by category', src: { r1: 11, c1: 0, r2: 18, c2: 1 }, by: 'cols', headers: false, labels: true, legend: false, x: 20, y: 700, w: 600, h: 300 }]
  return { name: 'Budget planner', sheets: [s] }
}

function loan() {
  const s = sheet('EMI')
  s.cols({ 0: 170, 1: 140, 2: 120, 3: 120, 4: 120, 5: 140 })
  s.set('A1', 'Loan EMI calculator', title)
  s.set('A2', 'Change the blue cells. The schedule below follows the tenure you choose (up to 30 years).', note)
  s.set('A4', 'Loan amount', label).set('B4', 2500000, { ...inr, fc: '#1d4ed8', bg: '#eff6ff', ...border })
  s.set('A5', 'Annual interest rate', label).set('B5', 0.085, { nf: '0.00%', fc: '#1d4ed8', bg: '#eff6ff', ...border })
  s.set('A6', 'Tenure (years)', label).set('B6', 20, { nf: '0', fc: '#1d4ed8', bg: '#eff6ff', ...border })
  s.set('A8', 'Monthly EMI', label).set('B8', '=-PMT(B5/12,B6*12,B4)', { ...inr2, b: true, fs: 14, fc: ACCENT })
  s.set('A9', 'Total payment', label).set('B9', '=B8*B6*12', inr)
  s.set('A10', 'Total interest', label).set('B10', '=B9-B4', inr)
  s.set('A11', 'Interest share', label).set('B11', '=B10/B9', { nf: FMT.pct0 })
  const H = ['Month', 'Opening balance', 'EMI', 'Interest', 'Principal', 'Closing balance']
  H.forEach((t, i) => s.set(String.fromCharCode(65 + i) + '13', t, head))
  const first = 14, last = first + 359
  for (let r = first; r <= last; r++) {
    s.set('A' + r, `=IF(ROW()-${first - 1}<=$B$6*12,ROW()-${first - 1},"")`, { nf: '0', ha: 'center' })
    s.set('B' + r, r === first ? `=IF(A${r}="","",$B$4)` : `=IF(A${r}="","",F${r - 1})`, inr2)
    s.set('C' + r, `=IF(A${r}="","",$B$8)`, inr2)
    s.set('D' + r, `=IF(A${r}="","",B${r}*$B$5/12)`, inr2)
    s.set('E' + r, `=IF(A${r}="","",C${r}-D${r})`, inr2)
    s.set('F' + r, `=IF(A${r}="","",MAX(0,B${r}-E${r}))`, inr2)
  }
  s.freeze = { r: 13, c: 0 }
  s.cf = [rule({ r1: first - 1, c1: 3, r2: last - 1, c2: 3 }, { type: 'bar', color: '#f59e0b' }), rule({ r1: first - 1, c1: 4, r2: last - 1, c2: 4 }, { type: 'bar', color: '#10b981' })]
  s.charts = [{ id: id(), type: 'area', title: 'Outstanding balance', src: { r1: 12, c1: 5, r2: 12 + 360, c2: 5 }, by: 'cols', headers: true, labels: false, legend: false, x: 560, y: 12, w: 600, h: 262 }]
  return { name: 'Loan EMI calculator', sheets: [s] }
}

function invoice() {
  const s = sheet('Invoice')
  s.cols({ 0: 54, 1: 250, 2: 90, 3: 70, 4: 110, 5: 80, 6: 130, 7: 120, 8: 140 })
  s.set('A1', 'TAX INVOICE', { b: true, fs: 20, fc: ACCENT })
  s.set('A3', 'Seller', label).set('B3', 'Your business name', { b: true }).set('B4', 'Address line, City, State').set('B5', 'GSTIN: 00AAAAA0000A1Z5')
  s.set('F3', 'Invoice no.', label).set('G3', 'INV-001').set('F4', 'Date', label).set('G4', '=TODAY()', { nf: FMT.dmy, ha: 'left' }).set('F5', 'Place of supply', label).set('G5', 'Maharashtra')
  s.set('A7', 'Bill to', label).set('B7', 'Customer name', { b: true }).set('B8', 'Customer address').set('B9', 'GSTIN: 00BBBBB0000B1Z5')
  const H = ['#', 'Description', 'HSN/SAC', 'Qty', 'Rate', 'GST %', 'Taxable value', 'GST amount', 'Line total']
  H.forEach((t, i) => s.set(String.fromCharCode(65 + i) + '11', t, head))
  const items = [['Website design', '998314', 1, 45000, 0.18], ['Hosting (annual)', '998315', 1, 6000, 0.18], ['Logo pack', '998391', 2, 3500, 0.18], ['Printed brochures', '4911', 100, 38, 0.12]]
  for (let i = 0; i < 8; i++) {
    const r = 12 + i, it = items[i]
    s.set('A' + r, i + 1, { ...border, ha: 'center' })
    s.set('B' + r, it ? it[0] : '', border).set('C' + r, it ? it[1] : '', { ...border, ha: 'center' }).set('D' + r, it ? it[2] : '', { ...border, nf: '0' }).set('E' + r, it ? it[3] : '', { ...border, ...inr2 }).set('F' + r, it ? it[4] : '', { ...border, nf: '0%' })
    s.set('G' + r, `=IF(OR(D${r}="",E${r}=""),"",D${r}*E${r})`, { ...border, ...inr2 })
    s.set('H' + r, `=IF(G${r}="","",G${r}*F${r})`, { ...border, ...inr2 })
    s.set('I' + r, `=IF(G${r}="","",G${r}+H${r})`, { ...border, ...inr2, b: true })
  }
  s.set('F21', 'Subtotal', label).set('I21', '=SUM(G12:G19)', inr2)
  s.set('F22', 'CGST', label).set('I22', '=SUM(H12:H19)/2', inr2)
  s.set('F23', 'SGST', label).set('I23', '=SUM(H12:H19)/2', inr2)
  s.set('F24', 'Round off', label).set('I24', '=ROUND(I21+I22+I23,0)-(I21+I22+I23)', inr2)
  s.set('F25', 'Grand total', { b: true, fs: 13, fc: ACCENT }).set('I25', '=I21+I22+I23+I24', { ...inr2, b: true, fs: 13, fc: ACCENT, bt: { s: 'medium', c: ACCENT } })
  s.set('A27', 'Amounts are in Indian rupees. For an interstate sale replace CGST and SGST with IGST at the full rate.', note)
  s.set('A28', 'Print or save as PDF from the Save menu.', note)
  return { name: 'GST invoice', sheets: [s] }
}

function grades() {
  const s = sheet('Grades')
  s.cols({ 0: 150, 1: 84, 2: 84, 3: 84, 4: 84, 5: 84, 6: 90, 7: 84, 8: 70 })
  s.set('A1', 'Class grade book', title)
  s.set('A2', 'Enter marks out of 100. Total, average, grade and rank are calculated for you.', note)
  const H = ['Student', 'Maths', 'Science', 'English', 'History', 'Total', 'Average', 'Grade', 'Rank']
  H.forEach((t, i) => s.set(String.fromCharCode(65 + i) + '4', t, head))
  const names = ['Aarav Mehta', 'Diya Sharma', 'Kabir Nair', 'Isha Verma', 'Rohan Iyer', 'Anaya Gupta', 'Vihaan Rao', 'Meera Das', 'Arjun Pillai', 'Sara Khan']
  const marks = [[92, 88, 79, 85], [76, 81, 90, 72], [58, 64, 70, 61], [97, 94, 91, 89], [43, 39, 55, 48], [83, 77, 86, 90], [66, 72, 61, 58], [88, 92, 84, 79], [71, 69, 75, 80], [90, 85, 93, 96]]
  names.forEach((nm, i) => {
    const r = 5 + i
    s.set('A' + r, nm, border)
    marks[i].forEach((m, j) => s.set(String.fromCharCode(66 + j) + r, m, { ...border, nf: '0', fc: '#1d4ed8', ha: 'center' }))
    s.set('F' + r, `=SUM(B${r}:E${r})`, { ...border, nf: '0', ha: 'center', b: true })
    s.set('G' + r, `=ROUND(AVERAGE(B${r}:E${r}),1)`, { ...border, nf: '0.0', ha: 'center' })
    s.set('H' + r, `=IFS(G${r}>=90,"A+",G${r}>=80,"A",G${r}>=70,"B",G${r}>=60,"C",G${r}>=50,"D",TRUE,"F")`, { ...border, ha: 'center', b: true })
    s.set('I' + r, `=RANK(F${r},$F$5:$F$14)`, { ...border, nf: '0', ha: 'center' })
  })
  s.set('A16', 'Class average', label)
  'BCDEFG'.split('').forEach((c) => s.set(c + '16', `=ROUND(AVERAGE(${c}5:${c}14),1)`, { nf: '0.0', ha: 'center', b: true }))
  s.set('A17', 'Highest', label)
  'BCDEF'.split('').forEach((c) => s.set(c + '17', `=MAX(${c}5:${c}14)`, { nf: '0', ha: 'center' }))
  s.set('A18', 'Lowest', label)
  'BCDEF'.split('').forEach((c) => s.set(c + '18', `=MIN(${c}5:${c}14)`, { nf: '0', ha: 'center' }))
  s.set('A19', 'Students below 50 average', label).set('G19', '=COUNTIF(G5:G14,"<50")', { nf: '0', ha: 'center' })
  s.set('A20', 'Top student', label).set('G20', '=INDEX(A5:A14,MATCH(1,I5:I14,0))', { b: true, ha: 'center' })
  s.freeze = { r: 4, c: 0 }
  s.cf = [rule(rng('B5', 'E14'), { type: 'cell', op: 'lt', v1: '50', style: CF_PRESETS.red }), rule(rng('F5', 'F14'), { type: 'scale', c1: '#fde2e2', c2: '#bbf7d0' }), rule(rng('H5', 'H14'), { type: 'text', op: 'begins', v: 'A', style: CF_PRESETS.green })]
  s.charts = [{ id: id(), type: 'bar', title: 'Average by student', src: { r1: 3, c1: 6, r2: 13, c2: 6 }, by: 'cols', headers: true, labels: false, legend: false, x: 20, y: 520, w: 640, h: 300 }]
  return { name: 'Grade book', sheets: [s] }
}

function blank() {
  const s = sheet('Sheet1')
  s.grid = true
  return { name: 'Untitled', sheets: [s] }
}

export const TEMPLATES = {
  blank: { label: 'Blank workbook', desc: 'An empty sheet.', icon: 'file-plus', build: blank },
  budget: { label: 'Monthly budget', desc: 'Income, expenses, totals, savings rate and a chart.', icon: 'piggy-bank', build: budget },
  loan: { label: 'Loan EMI calculator', desc: 'EMI, total interest and a full amortization schedule.', icon: 'landmark', build: loan },
  invoice: { label: 'GST invoice', desc: 'Line items with GST, CGST and SGST totals in rupees.', icon: 'receipt-indian-rupee', build: invoice },
  grades: { label: 'Class grade book', desc: 'Totals, averages, grades and ranks with highlights.', icon: 'graduation-cap', build: grades },
}
