// Opening and saving: CSV/TSV, Excel and ODS (SheetJS), the project JSON, and CSV export.
import { ext } from '../../lib/files.js'
import { Model, makeCell } from './_model.js'
import { ck, ckR } from './_a1.js'
import { DEFAULT_ROW_H } from './_model.js'
import { parseInput } from './_fmt.js'
import { fontPx } from './_axis.js'
import { parseDelimited, sniffDelimiter, toDelimited } from './_text.js'
import { readWorkbook } from './_xlsx.js'
import { displayOf } from './_ops.js'

export const OPEN_ACCEPT = '.xlsx,.xlsm,.xls,.xltx,.ods,.csv,.tsv,.txt,.json,.sheets'
const MAX_FILE = 80 * 1024 * 1024

/** Estimate column widths (px) from the text in the first rows. */
function fitWidths(cells, cols = 60, rows = 300) {
  const w = {}
  for (const [r, c, v, f] of cells) {
    if (r > rows || f != null || v == null) continue
    const len = typeof v === 'number' ? String(v).length + 1 : String(v).length
    const px = Math.min(320, Math.max(64, Math.round(len * 7.4 + 18)))
    if (!w[c] || px > w[c]) w[c] = px
  }
  void cols
  return w
}

/** Rows holding larger fonts grow to fit them (like a spreadsheet does when no height was set). */
export function fitFontRows(m, sh) {
  const need = {}
  for (const [k, cell] of sh.cells) {
    const st = m.style(cell.s || 0)
    if (!st.fs || st.fs <= 11) continue
    const r = ckR(k)
    const h = Math.ceil(fontPx(st) * 1.25 + 8)
    if (h > DEFAULT_ROW_H && (!need[r] || h > need[r])) need[r] = h
  }
  for (const [r, h] of Object.entries(need)) if (sh.rowH[r] === undefined) sh.rowH[r] = h
  m.layoutVer++
}

/** Turn a plain description (from import) into a Model. */
export function modelFromDesc(desc, opts = {}) {
  const m = new Model()
  m.wb.name = desc.name || 'Untitled'
  if (opts.dateOrder) m.wb.opts.dateOrder = opts.dateOrder
  m.wb.sheets.length = 0
  m.byId.clear()
  m.nextSid = 1
  const used = new Set()
  for (const d of desc.sheets) {
    let name = (d.name || 'Sheet').slice(0, 60), i = 2
    while (used.has(name.toLowerCase())) name = `${d.name} (${i++})`
    used.add(name.toLowerCase())
    const sh = m.addSheetRaw(name)
    sh.color = d.color || null
    sh.grid = d.grid !== false
    sh.freeze = d.freeze || { r: 0, c: 0 }
    sh.merges = d.merges || []
    sh.filter = d.filter || null
    sh.cf = d.cf || []
    sh.charts = (d.charts || []).map((ch) => ({ ...ch, src: { ...ch.src, sid: sh.id } }))
    sh.colW = d.colW || {}
    sh.rowH = d.rowH || {}
    sh.hideC = d.hideC || {}
    sh.hideR = d.hideR || {}
    for (const [c, st] of Object.entries(d.colS || {})) { const id = m.styleId(st); if (id) sh.colS[c] = id }
    for (const [r, st] of Object.entries(d.rowS || {})) { const id = m.styleId(st); if (id) sh.rowS[r] = id }
    if (!Object.keys(sh.colW).length) sh.colW = fitWidths(d.cells)
    for (const [r, c, v, f, st] of d.cells) {
      const cell = f != null ? makeCell(f) : { v: v === undefined ? null : v, f: null }
      const s = st && Object.keys(st).length ? m.styleId(st) : 0
      if (s) cell.s = s
      sh.cells.set(ck(r, c), cell)
    }
    sh.extDirty = true
  }
  if (!m.wb.sheets.length) m.addSheetRaw('Sheet1')
  m.wb.active = 0
  m.rebuildDeps()
  m.recalcAll()
  m.layoutVer++
  for (const sh of m.wb.sheets) fitFontRows(m, sh)
  return m
}

export function descFromText(text, name, dateOrder = 'dmy') {
  const delim = sniffDelimiter(text)
  const rows = parseDelimited(text, delim)
  const cells = []
  rows.forEach((row, r) => row.forEach((t, c) => {
    if (t === '') return
    const p = parseInput(t, { dateOrder, noGroupFormat: false })
    if (p.kind === 'formula') cells.push([r, c, null, p.f, {}])
    else cells.push([r, c, p.v, null, p.nf ? { nf: p.nf } : {}])
  }))
  return { name: name.replace(/\.[^.]+$/, ''), sheets: [{ name: 'Sheet1', cells }] }
}

/** Read any supported file into a Model. */
export async function openFile(file, dateOrder = 'dmy') {
  if (file.size > MAX_FILE) throw new Error('That file is larger than 80 MB, which is too much for the browser to open comfortably.')
  const e = ext(file.name)
  if (e === 'json' || e === 'sheets') {
    const j = JSON.parse(await file.text())
    if (!j || !Array.isArray(j.sheets)) throw new Error('That JSON file is not a Sheets project.')
    const m = new Model()
    m.loadJSON(j)
    return { model: m, kind: 'project' }
  }
  if (e === 'csv' || e === 'tsv' || e === 'txt') {
    const text = await file.text()
    return { model: modelFromDesc(descFromText(text, file.name, dateOrder), { dateOrder }), kind: 'text' }
  }
  const buf = await file.arrayBuffer()
  let desc
  try { desc = await readWorkbook(buf, file.name) } catch (err) {
    if (/password|encrypt/i.test(String(err?.message))) throw new Error('That workbook is password protected. Remove the password in Excel first, then open it here.')
    throw new Error(`Could not read ${file.name}. Is it a valid spreadsheet file? (${err?.message || err})`)
  }
  return { model: modelFromDesc(desc, { dateOrder }), kind: 'workbook' }
}

/** CSV of one sheet. opts: {delimiter, displayed, bom, range}. */
export function toCsv(model, sh, opts = {}) {
  const { delimiter = ',', displayed = true, range } = opts
  const u = range || model.usedRange(sh)
  if (!u) return ''
  const rows = []
  for (let r = u.r1; r <= u.r2; r++) {
    if (sh.hideR[r] || sh.fHide[r]) continue
    const row = []
    for (let c = u.c1; c <= u.c2; c++) {
      const d = displayed ? displayOf(model, sh, r, c).text : (() => { const v = model.valueAt(sh.id, r, c); return v === null ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : typeof v === 'object' ? v.code : String(v) })()
      row.push(d)
    }
    rows.push(row)
  }
  return (opts.bom ? '﻿' : '') + toDelimited(rows, delimiter)
}
