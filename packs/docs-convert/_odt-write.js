// Blocks (see _ast.js) -> an OpenDocument Text (.odt) package: mimetype stored first, manifest, meta, styles, content and Pictures/.
import { jszip } from '../../lib/libs.js'
import { xesc } from './_util.js'

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"'
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp' }
const cm = (px) => `${((px / 96) * 2.54).toFixed(3)}cm`

/** ODF text with spaces, tabs and line breaks. */
function odfText(s) {
  return xesc(s).replace(/\t/g, '<text:tab/>').replace(/\n/g, '<text:line-break/>').replace(/ {2,}/g, (m) => ` <text:s text:c="${m.length - 1}"/>`)
}

const STYLES = (title) => `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${NS} office:version="1.2">
<office:font-face-decls><style:font-face style:name="Liberation Serif" svg:font-family="'Liberation Serif'" style:font-family-generic="roman"/><style:font-face style:name="Liberation Sans" svg:font-family="'Liberation Sans'" style:font-family-generic="swiss"/><style:font-face style:name="Liberation Mono" svg:font-family="'Liberation Mono'" style:font-family-generic="modern" style:font-pitch="fixed"/></office:font-face-decls>
<office:styles>
<style:default-style style:family="paragraph"><style:paragraph-properties fo:hyphenation-ladder-count="no-limit" style:text-autospace="ideograph-alpha" style:punctuation-wrap="hanging" style:line-break="strict" style:writing-mode="page"/><style:text-properties style:use-window-font-color="true" style:font-name="Liberation Serif" fo:font-size="11pt" fo:language="en" fo:country="US" style:language-asian="ko" style:country-asian="KR" fo:hyphenate="false"/></style:default-style>
<style:style style:name="Standard" style:family="paragraph" style:class="text"/>
<style:style style:name="Text_20_body" style:display-name="Text body" style:family="paragraph" style:parent-style-name="Standard" style:class="text"><style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.212cm" fo:line-height="115%"/></style:style>
<style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Text_20_body" style:class="text"><style:paragraph-properties fo:margin-top="0.423cm" fo:margin-bottom="0.212cm" fo:keep-with-next="always"/><style:text-properties style:font-name="Liberation Sans" fo:font-size="14pt"/></style:style>
${[[1, 20], [2, 16], [3, 14], [4, 12], [5, 11], [6, 11]].map(([n, sz]) => `<style:style style:name="Heading_20_${n}" style:display-name="Heading ${n}" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Text_20_body" style:default-outline-level="${n}" style:class="text"><style:text-properties fo:font-size="${sz}pt" fo:font-weight="bold"/></style:style>`).join('\n')}
<style:style style:name="Preformatted_20_Text" style:display-name="Preformatted Text" style:family="paragraph" style:parent-style-name="Standard" style:class="html"><style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0cm" fo:background-color="#f3f3f5"/><style:text-properties style:font-name="Liberation Mono" fo:font-size="10pt"/></style:style>
<style:style style:name="Quotations" style:family="paragraph" style:parent-style-name="Standard" style:class="html"><style:paragraph-properties fo:margin-left="1cm" fo:margin-top="0cm" fo:margin-bottom="0.212cm" fo:border-left="1.5pt solid #b8b8c4" fo:padding-left="0.25cm"/></style:style>
<style:style style:name="List_20_Paragraph" style:display-name="List Paragraph" style:family="paragraph" style:parent-style-name="Standard" style:class="list"><style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.1cm"/></style:style>
<style:style style:name="Internet_20_link" style:display-name="Internet link" style:family="text"><style:text-properties fo:color="#0563c1" style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/></style:style>
<text:list-style style:name="LBullet">${Array.from({ length: 6 }, (_, i) => `<text:list-level-style-bullet text:level="${i + 1}" text:bullet-char="${['•', '◦', '▪'][i % 3]}"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${0.635 * (i + 1)}cm" fo:text-indent="-0.635cm" fo:margin-left="${0.635 * (i + 1)}cm"/></style:list-level-properties></text:list-level-style-bullet>`).join('')}</text:list-style>
<text:list-style style:name="LNum">${Array.from({ length: 6 }, (_, i) => `<text:list-level-style-number text:level="${i + 1}" style:num-suffix="." style:num-format="${['1', 'a', 'i'][i % 3]}"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${0.635 * (i + 1)}cm" fo:text-indent="-0.635cm" fo:margin-left="${0.635 * (i + 1)}cm"/></style:list-level-properties></text:list-level-style-number>`).join('')}</text:list-style>
</office:styles>
<office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="21.001cm" fo:page-height="29.7cm" style:print-orientation="portrait" fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="2cm" fo:margin-right="2cm"/></style:page-layout></office:automatic-styles>
<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles>
</office:document-styles>`

export async function astToOdt(blocks, { title = '', creator = 'Toolverse' } = {}) {
  const JSZip = await jszip()
  const textStyles = new Map(), paraStyles = new Map(), pics = [], tableStyles = []
  let tableN = 0

  const textStyle = (r) => {
    const a = []
    if (r.b) a.push('fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"')
    if (r.i) a.push('fo:font-style="italic" style:font-style-asian="italic" style:font-style-complex="italic"')
    if (r.u) a.push('style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"')
    if (r.s) a.push('style:text-line-through-style="solid"')
    if (r.color) a.push(`fo:color="#${r.color}"`)
    if (r.bg) a.push(`fo:background-color="#${r.bg}"`)
    if (r.size) a.push(`fo:font-size="${r.size}pt" style:font-size-asian="${r.size}pt"`)
    if (r.font || r.mono) { const f = xesc(r.font || 'Liberation Mono'); a.push(`fo:font-family="${f}" style:font-family-asian="${f}"`) }
    if (r.sup) a.push('style:text-position="super 58%"')
    else if (r.sub) a.push('style:text-position="sub 58%"')
    if (!a.length) return null
    const key = a.join(' ')
    if (!textStyles.has(key)) textStyles.set(key, `T${textStyles.size + 1}`)
    return textStyles.get(key)
  }
  const paraStyle = (b, base) => {
    const a = []
    if (b.align) a.push(`fo:text-align="${{ left: 'start', right: 'end', center: 'center', justify: 'justify' }[b.align]}"`)
    if (b.cont != null) a.push(`fo:margin-left="${0.635 * (b.cont + 2)}cm"`)
    if (!a.length) return base
    const key = `${base}|${a.join(' ')}`
    if (!paraStyles.has(key)) paraStyles.set(key, { name: `P${paraStyles.size + 1}`, base, attrs: a.join(' ') })
    return paraStyles.get(key).name
  }

  const inline = (runs) => runs.map((r) => {
    if (r.br) return '<text:line-break/>'
    if (r.tab) return '<text:tab/>'
    if (r.img) {
      const ext = EXT[r.img.mime]
      if (!ext) return xesc(r.img.alt ? `[${r.img.alt}]` : '')
      const name = `Pictures/img${pics.length + 1}.${ext}`
      pics.push({ name, bytes: r.img.bytes, mime: r.img.mime })
      let w = r.img.w || 200, hgt = r.img.h || 150
      if (w > 600) { hgt = (hgt * 600) / w; w = 600 }
      return `<draw:frame draw:name="img${pics.length}" text:anchor-type="as-char" svg:width="${cm(w)}" svg:height="${cm(hgt)}" style:rel-width="scale"><draw:image xlink:href="${name}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`
    }
    let t = odfText(r.text || '')
    const sn = textStyle(r)
    if (sn) t = `<text:span text:style-name="${sn}">${t}</text:span>`
    if (r.href) t = `<text:a xlink:type="simple" xlink:href="${xesc(r.href)}" text:style-name="Internet_20_link">${t}</text:a>`
    return t
  }).join('')

  const paraXml = (b) => {
    const inner = inline(b.runs)
    if (b.level) return `<text:h text:style-name="${paraStyle(b, `Heading_20_${b.level}`)}" text:outline-level="${b.level}">${inner}</text:h>`
    const base = b.code ? 'Preformatted_20_Text' : b.quote ? 'Quotations' : b.list || b.cont != null ? 'List_20_Paragraph' : 'Text_20_body'
    return `<text:p text:style-name="${paraStyle(b, base)}">${b.task !== undefined ? (b.task ? '☑ ' : '☐ ') : ''}${inner}</text:p>`
  }

  const tableXml = (t) => {
    const n = ++tableN
    const ncols = Math.max(...t.rows.map((r) => r.reduce((s, c) => s + c.colspan, 0)), 1)
    const weights = new Array(ncols).fill(4)
    for (const row of t.rows) { let ci = 0; for (const c of row) { if (c.colspan === 1) weights[ci] = Math.max(weights[ci], Math.min(40, c.blocks.map((b) => (b.runs || []).map((r) => r.text || '').join('')).join(' ').length)); ci += c.colspan } }
    const wsum = weights.reduce((a, b) => a + b, 0)
    const total = 17
    const cellStyles = new Map()
    const cellStyle = (c) => {
      const key = `${t.border}|${c.bg || ''}`
      if (!cellStyles.has(key)) {
        const name = `Tbl${n}.C${cellStyles.size + 1}`
        cellStyles.set(key, name)
        tableStyles.push(`<style:style style:name="${name}" style:family="table-cell"><style:table-cell-properties fo:padding="0.1cm" fo:border="${t.border ? '0.5pt solid #bbbbbb' : 'none'}"${c.bg ? ` fo:background-color="#${c.bg}"` : ''}/></style:style>`)
      }
      return cellStyles.get(key)
    }
    tableStyles.push(`<style:style style:name="Tbl${n}" style:family="table"><style:table-properties style:width="${total}cm" table:align="left"/></style:style>`)
    weights.forEach((w, i) => tableStyles.push(`<style:style style:name="Tbl${n}.Col${i + 1}" style:family="table-column"><style:table-column-properties style:column-width="${((w / wsum) * total).toFixed(3)}cm"/></style:style>`))
    const occ = [] // rowspan occupancy: occ[row][col]
    let xml = `<table:table table:name="Table${n}" table:style-name="Tbl${n}">`
    for (let i = 0; i < ncols; i++) xml += `<table:table-column table:style-name="Tbl${n}.Col${i + 1}"/>`
    t.rows.forEach((row, ri) => {
      occ[ri] ||= []
      xml += '<table:table-row>'
      let ci = 0
      const skip = () => { while (occ[ri][ci]) { xml += '<table:covered-table-cell/>'; ci++ } }
      for (const c of row) {
        skip()
        const body = blocksXml(c.blocks) || '<text:p text:style-name="Text_20_body"/>'
        xml += `<table:table-cell table:style-name="${cellStyle(c)}" office:value-type="string"${c.colspan > 1 ? ` table:number-columns-spanned="${c.colspan}"` : ''}${c.rowspan > 1 ? ` table:number-rows-spanned="${c.rowspan}"` : ''}>${body}</table:table-cell>`
        for (let k = 1; k < c.colspan; k++) xml += '<table:covered-table-cell/>'
        for (let rr = 0; rr < c.rowspan; rr++) for (let cc = 0; cc < c.colspan; cc++) { if (rr === 0 && cc === 0) continue; (occ[ri + rr] ||= [])[ci + cc] = true }
        ci += c.colspan
      }
      skip()
      while (ci < ncols) { xml += '<table:table-cell office:value-type="string"><text:p/></table:table-cell>'; ci++ }
      xml += '</table:table-row>'
    })
    return xml + '</table:table>'
  }

  function blocksXml(list) {
    let xml = ''
    const stack = [] // open lists: {ordered}
    const closeTo = (depth) => { while (stack.length > depth) { xml += '</text:list-item></text:list>'; stack.pop() } }
    for (const b of list) {
      if (b.t === 'p' && b.list) {
        const want = b.list.level + 1
        closeTo(want)
        if (stack.length === want && stack[want - 1].ordered !== !!b.list.ordered) closeTo(want - 1)
        if (stack.length === want) xml += '</text:list-item><text:list-item>'
        else while (stack.length < want) { xml += `<text:list text:style-name="${b.list.ordered ? 'LNum' : 'LBullet'}"><text:list-item>`; stack.push({ ordered: !!b.list.ordered }) }
        xml += paraXml(b)
        continue
      }
      if (b.t === 'p' && b.cont != null && stack.length) { xml += paraXml(b); continue }
      closeTo(0)
      if (b.t === 'p') xml += paraXml(b)
      else if (b.t === 'table') xml += tableXml(b) + '<text:p text:style-name="Text_20_body"/>'
      else if (b.t === 'hr') xml += '<text:p text:style-name="Text_20_body">──────────</text:p>'
      else if (b.t === 'pagebreak') xml += '<text:p text:style-name="PBreak"/>'
    }
    closeTo(0)
    return xml
  }

  const body = blocksXml(blocks) || '<text:p text:style-name="Text_20_body"/>'
  const autoText = [...textStyles].map(([attrs, name]) => `<style:style style:name="${name}" style:family="text"><style:text-properties ${attrs}/></style:style>`).join('')
  const autoPara = [...paraStyles.values()].map((p) => `<style:style style:name="${p.name}" style:family="paragraph" style:parent-style-name="${p.base}"><style:paragraph-properties ${p.attrs}/></style:style>`).join('')
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${NS} office:version="1.2"><office:font-face-decls/><office:automatic-styles>${autoText}${autoPara}<style:style style:name="PBreak" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:break-before="page"/></style:style>${tableStyles.join('')}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>${pics.map((p) => `<manifest:file-entry manifest:full-path="${p.name}" manifest:media-type="${p.mime}"/>`).join('')}</manifest:manifest>`
  const meta = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta ${NS} office:version="1.2"><office:meta><meta:generator>Toolverse</meta:generator>${title ? `<dc:title>${xesc(title)}</dc:title>` : ''}<meta:initial-creator>${xesc(creator)}</meta:initial-creator><meta:creation-date>${new Date().toISOString().slice(0, 19)}</meta:creation-date></office:meta></office:document-meta>`
  const zip = new JSZip()
  const opt = { createFolders: false }
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE', ...opt })
  zip.file('META-INF/manifest.xml', manifest, opt)
  zip.file('meta.xml', meta, opt)
  zip.file('styles.xml', STYLES(title), opt)
  zip.file('content.xml', content, opt)
  for (const p of pics) zip.file(p.name, p.bytes, opt)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.oasis.opendocument.text' })
}
