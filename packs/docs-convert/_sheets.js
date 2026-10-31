// Spreadsheet conversions with SheetJS: XLSX / XLSM / XLS / XLT / ODS / FODS / OTS / CSV / TSV in, XLSX / XLS / ODS / FODS / CSV / TSV / JSON / HTML out.
import { xlsx } from '../../lib/libs.js'
import { esc, fail, u8, decodeText } from './_util.js'
import { DOC_CSS, wrapDoc } from './_html.js'
import { detectEncoding } from './_encoding.js'

/** Read any supported spreadsheet file into a SheetJS workbook. */
export async function readWorkbook(file, { password } = {}) {
  const X = await xlsx()
  const bytes = await u8(file)
  const name = (file.name || '').toLowerCase()
  try {
    if (/\.(csv|tsv|txt|tab)$/.test(name)) {
      const enc = detectEncoding(bytes)
      const text = decodeText(bytes, enc.label)
      const delim = /\.tsv$|\.tab$/.test(name) ? '\t' : guessDelimiter(text)
      return X.read(text, { type: 'string', FS: delim, cellDates: true, raw: false })
    }
    return X.read(bytes, { type: 'array', cellDates: true, password })
  } catch (e) {
    if (/password|encrypt/i.test(e?.message || '')) throw fail('This spreadsheet is password protected. Remove the password in your spreadsheet app and try again.')
    throw fail('Could not read this spreadsheet. It may be damaged or in an unsupported format.', e)
  }
}
function guessDelimiter(text) {
  const head = text.split(/\r?\n/, 5).join('\n')
  const count = (c) => (head.match(new RegExp(c === '|' ? '\\|' : c, 'g')) || []).length
  const best = [[',', count(',')], [';', count(';')], ['\t', count('\t')], ['|', count('|')]].sort((a, b) => b[1] - a[1])[0]
  return best[1] ? best[0] : ','
}

const safeSheet = (n, i) => (String(n || `Sheet${i + 1}`).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || `Sheet${i + 1}`)

/**
 * Convert a workbook to a target format. -> [{name, data (Uint8Array | string), type}] (one entry, or one per sheet for csv / tsv).
 * opts: {header (json: first row holds the names), jsonShape: 'objects' | 'arrays', bom (csv/tsv), sheets: 'all' | 'first'}
 */
export async function convertWorkbook(wb, to, baseName, { header = true, jsonShape = 'objects', bom = true, sheets = 'all' } = {}) {
  const X = await xlsx()
  const names = sheets === 'first' ? wb.SheetNames.slice(0, 1) : wb.SheetNames
  if (!names.length) throw fail('This spreadsheet has no sheets.')
  const out = []
  if (to === 'xlsx' || to === 'xls' || to === 'ods' || to === 'fods') {
    const book = sheets === 'first' && wb.SheetNames.length > 1 ? { ...wb, SheetNames: names, Sheets: { [names[0]]: wb.Sheets[names[0]] } } : wb
    const bookType = { xlsx: 'xlsx', xls: 'biff8', ods: 'ods', fods: 'fods' }[to]
    const data = X.write(book, { bookType, type: to === 'fods' ? 'string' : 'array', cellDates: true })
    out.push({ name: `${baseName}.${to}`, data: to === 'fods' ? data : new Uint8Array(data), type: 'application/octet-stream' })
  } else if (to === 'csv' || to === 'tsv') {
    names.forEach((n, i) => {
      const csv = X.utils.sheet_to_csv(wb.Sheets[n], { FS: to === 'tsv' ? '\t' : ',', blankrows: false })
      const sfx = names.length > 1 ? `-${safeSheet(n, i)}` : ''
      out.push({ name: `${baseName}${sfx}.${to}`, data: (bom ? '﻿' : '') + csv, type: to === 'csv' ? 'text/csv' : 'text/tab-separated-values' })
    })
  } else if (to === 'json') {
    const conv = (ws) => (jsonShape === 'arrays' || !header
      ? X.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false, raw: true })
      : X.utils.sheet_to_json(ws, { defval: null, blankrows: false, raw: true }))
    const p2 = (n) => String(n).padStart(2, '0')
    const fmtDate = (d) => (d.getHours() || d.getMinutes() || d.getSeconds() ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}` : `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`)
    const fix = (v) => (v instanceof Date ? fmtDate(v) : Array.isArray(v) ? v.map(fix) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)])) : v)
    const obj = fix(names.length === 1 ? conv(wb.Sheets[names[0]]) : Object.fromEntries(names.map((n) => [n, conv(wb.Sheets[n])])))
    out.push({ name: `${baseName}.json`, data: JSON.stringify(obj, null, 2), type: 'application/json' })
  } else if (to === 'html') {
    const parts = names.map((n) => `${names.length > 1 ? `<h2>${esc(n)}</h2>\n` : ''}${X.utils.sheet_to_html(wb.Sheets[n], { header: '', footer: '' })}`)
    const css = `${DOC_CSS} body { max-width: none; } table { font-size: .92em; } td, th { border: 1px solid #c9c9d3; padding: .25em .55em; } table tr:first-child td { background: #f6f6f9; font-weight: 600; }`
    out.push({ name: `${baseName}.html`, data: wrapDoc(parts.join('\n'), { title: baseName, css }), type: 'text/html' })
  } else throw fail(`Cannot write ${to}.`)
  return out
}
