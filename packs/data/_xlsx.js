// Small .xlsx writer (Office Open XML) with real formatting: bold header, frozen header row, filter buttons,
// column widths and typed cells (numbers, dates, percentages, currency, booleans). SheetJS Community cannot
// write styles or freeze panes, so this builds the package directly with JSZip.
import { jszip } from '../../lib/libs.js'
import { yieldToMain } from '../../lib/ui.js'
import { inferTypes, parseNumberEx, parseDate, dateSerial, inferDateOrder, localeDateOrder, str } from './_table.js'

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const MAX_ROWS = 1048576
export const MAX_COLS = 16384
const MAX_CELL = 32767
const BAD_XML = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]', 'g')

const esc = (s) => s.replace(BAD_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const colRef = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }
const BUILTIN = { General: 0, '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10 }

class Styles {
  constructor() { this.xfs = [{ fmt: null, header: false, wrap: false }]; this.index = new Map([['|0|0', 0]]) }
  get({ fmt = null, header = false, wrap = false } = {}) {
    const key = `${fmt || ''}|${header ? 1 : 0}|${wrap ? 1 : 0}`
    let i = this.index.get(key)
    if (i == null) { i = this.xfs.length; this.xfs.push({ fmt, header, wrap }); this.index.set(key, i) }
    return i
  }
  xml() {
    const custom = [...new Set(this.xfs.map((x) => x.fmt).filter((f) => f && !(f in BUILTIN)))]
    const id = (f) => (!f ? 0 : f in BUILTIN ? BUILTIN[f] : 164 + custom.indexOf(f))
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${custom.length ? `<numFmts count="${custom.length}">${custom.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(f)}"/>`).join('')}</numFmts>` : ''}<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FF1F2A44"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE4E9F7"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF8A97C0"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${this.xfs.length}">${this.xfs.map((x) => {
    const attrs = `numFmtId="${id(x.fmt)}" fontId="${x.header ? 1 : 0}" fillId="${x.header ? 2 : 0}" borderId="${x.header ? 1 : 0}" xfId="0"${x.fmt ? ' applyNumberFormat="1"' : ''}${x.header ? ' applyFont="1" applyFill="1" applyBorder="1"' : ''}`
    return x.wrap || x.header ? `<xf ${attrs} applyAlignment="1"><alignment vertical="${x.header ? 'center' : 'top'}"${x.wrap ? ' wrapText="1"' : ''}/></xf>` : `<xf ${attrs}/>`
  }).join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
  }
}

/** Excel-safe, unique sheet name (max 31 characters, no []:*?/\). */
export function sheetName(name, used = new Set()) {
  let n = str(name).replace(/[\[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Sheet1'
  let k = n, i = 2
  while (used.has(k.toLowerCase())) { const suf = ` (${i++})`; k = n.slice(0, 31 - suf.length) + suf }
  used.add(k.toLowerCase())
  return k
}

const CUR_FMT = { $: '"$"#,##0.00', '€': '"€"#,##0.00', '£': '"£"#,##0.00', '¥': '"¥"#,##0.00', '₹': '"₹"#,##0.00' }
const FMT_DATE = 'yyyy\\-mm\\-dd', FMT_DT = 'yyyy\\-mm\\-dd\\ hh:mm:ss'

/**
 * buildXlsx([{ name, headers, rows, types?, widths?, freeze?, filter?, header? }], { typed, onProgress }) -> Blob
 * typed: convert text that looks like numbers, dates, percentages, currency and booleans into real Excel types.
 * types: per column override ('text' | 'integer' | 'number' | 'percent' | 'currency' | 'boolean' | 'date' | 'datetime').
 * Cells that are already JS numbers or booleans always stay numbers or booleans.
 */
export async function buildXlsx(sheets, { typed = true, onProgress, dateOrder } = {}) {
  const JSZip = await jszip()
  const styles = new Styles()
  const hdrStyle = styles.get({ header: true })
  const sst = new Map(), sstList = []
  const sIndex = (s) => {
    let i = sst.get(s)
    if (i == null) { i = sstList.length; sst.set(s, i); sstList.push(s) }
    return i
  }
  const used = new Set()
  const parts = []
  let total = 0
  for (const sh of sheets) total += sh.rows.length
  let done = 0

  for (const sh of sheets) {
    const width = sh.headers.length
    if (width > MAX_COLS) throw new Error(`Excel supports up to ${MAX_COLS.toLocaleString()} columns, but this data has ${width.toLocaleString()}.`)
    const types = sh.types || (typed ? inferTypes(sh) : sh.headers.map(() => 'text'))
    const orders = sh.headers.map((_, c) => (types[c] === 'date' || types[c] === 'datetime' ? inferDateOrder(sh.rows.slice(0, 3000).map((r) => r[c])) || dateOrder || localeDateOrder() : null))
    const rowsPer = MAX_ROWS - 1
    const chunks = Math.max(1, Math.ceil(sh.rows.length / rowsPer))
    const baseName = sheetName(sh.name || 'Sheet1')
    for (let k = 0; k < chunks; k++) {
      const name = sheetName(chunks === 1 ? baseName : `${baseName.slice(0, 26)} ${k + 1}`, used)
      const slice = chunks === 1 ? sh.rows : sh.rows.slice(k * rowsPer, (k + 1) * rowsPer)
      const out = []
      const widths = sh.headers.map((h) => Math.min(60, Math.max(8, str(h).length * 1.15 + (sh.filter === false ? 2 : 5))))
      const withHeader = sh.header !== false
      const firstDataRow = withHeader ? 2 : 1
      if (withHeader) {
        out.push(`<row r="1" ht="22" customHeight="1">${sh.headers.map((h, c) => `<c r="${colRef(c)}1" s="${hdrStyle}" t="s"><v>${sIndex(str(h).slice(0, MAX_CELL))}</v></c>`).join('')}</row>`)
      }
      for (let i = 0; i < slice.length; i++) {
        const r = slice[i]
        const rn = i + firstDataRow
        let cells = ''
        for (let c = 0; c < width; c++) {
          const v = r[c]
          if (v == null || v === '') continue
          let t = 's', val, s = 0, len
          if (typeof v === 'number') { if (Number.isFinite(v)) { t = 'n'; val = String(v) } else val = String(v); len = String(v).length }
          else if (typeof v === 'boolean') { t = 'b'; val = v ? '1' : '0'; len = 5 }
          else {
            const text = v
            const ty = types[c]
            if (ty === 'integer' || ty === 'number') {
              const p = parseNumberEx(text)
              if (p) { t = 'n'; val = String(p.n); len = val.length }
            } else if (ty === 'percent') {
              const p = parseNumberEx(text)
              if (p) { t = 'n'; val = String(p.pct ? p.n : p.n / 100); s = styles.get({ fmt: '0.00%' }); len = 8 }
            } else if (ty === 'currency') {
              const p = parseNumberEx(text)
              if (p) { t = 'n'; val = String(p.n); s = styles.get({ fmt: CUR_FMT[p.cur || '$'] }); len = text.length + 1 }
            } else if (ty === 'boolean') {
              if (/^(true|false)$/i.test(text.trim())) { t = 'b'; val = /^true$/i.test(text.trim()) ? '1' : '0'; len = 5 }
            } else if (ty === 'date' || ty === 'datetime') {
              const d = parseDate(text, orders[c] || 'mdy')
              if (d) { t = 'n'; val = String(dateSerial(d)); s = styles.get({ fmt: d.hasTime || ty === 'datetime' ? FMT_DT : FMT_DATE }); len = d.hasTime ? 19 : 10 }
            }
            if (t === 's') {
              const clipped = text.length > MAX_CELL ? text.slice(0, MAX_CELL) : text
              val = String(sIndex(clipped))
              len = Math.max(...clipped.split('\n').slice(0, 5).map((x) => x.length), 1)
              if (clipped.includes('\n')) s = styles.get({ wrap: true })
            }
          }
          if (i < 400 && len > 0) widths[c] = Math.min(60, Math.max(widths[c], len * 1.1 + 2))
          cells += `<c r="${colRef(c)}${rn}"${s ? ` s="${s}"` : ''}${t === 's' ? ' t="s"' : t === 'b' ? ' t="b"' : ''}><v>${val}</v></c>`
        }
        if (cells) out.push(`<row r="${rn}">${cells}</row>`)
        if (i % 20000 === 19999) { onProgress?.((done + i) / Math.max(total, 1)); await yieldToMain() }
      }
      done += slice.length
      const lastRow = Math.max(1, slice.length + (withHeader ? 1 : 0))
      const lastCol = colRef(Math.max(0, width - 1))
      const freeze = sh.freeze !== false && withHeader && slice.length > 0
      const widthXml = sh.widths || widths
      const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${lastCol}${lastRow}"/><sheetViews><sheetView workbookViewId="0"${parts.length === 0 ? ' tabSelected="1"' : ''}>${freeze ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' : ''}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${widthXml.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${Math.round(w * 100) / 100}" customWidth="1"/>`).join('')}</cols><sheetData>${out.join('')}</sheetData>${sh.filter !== false && withHeader && slice.length > 0 ? `<autoFilter ref="A1:${lastCol}${lastRow}"/>` : ''}</worksheet>`
      parts.push({ name, xml })
      onProgress?.(done / Math.max(total, 1))
      await yieldToMain()
    }
  }
  if (!parts.length) parts.push({ name: 'Sheet1', xml: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>' })

  const zip = new JSZip()
  const n = parts.length
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${parts.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`)
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews><sheets>${parts.map((p, i) => `<sheet name="${esc(p.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${parts.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`)
  parts.forEach((p, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, p.xml))
  zip.file('xl/styles.xml', styles.xml())
  zip.file('xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sstList.length}" uniqueCount="${sstList.length}">${sstList.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`)
  return zip.generateAsync({ type: 'blob', mimeType: XLSX_MIME, compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

/** One table to an .xlsx Blob. */
export const tableToXlsx = (table, opts = {}) => buildXlsx([{ name: opts.name || 'Sheet1', headers: table.headers, rows: table.rows, types: opts.types, freeze: opts.freeze, filter: opts.filter }], opts)
