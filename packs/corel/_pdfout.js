// Model -> vector PDF (also used for the AI output, which is a PDF-compatible file saved with the .ai extension).
// Written by hand: paths, fills, strokes, dashes, caps, joins, even-odd, clips, opacity, linear and radial gradients (real PDF shadings),
// images (JPEG passes through untouched, everything else is Flate RGB with a soft mask) and standard-font text.
import { n4, rgbOf, dataUrlBytes, imagePixels, baseFont, winAnsi, onWhite } from './_model.js'

const enc = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b }
const cat = (parts) => { const n = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length } return out }
const rgb = (c) => rgbOf(c).map((v) => n4(v / 255)).join(' ')

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null
  const cs = new CompressionStream('deflate')
  const w = cs.writable.getWriter()
  w.write(bytes); w.close()
  return new Uint8Array(await new Response(cs.readable).arrayBuffer())
}

/** {w, h, comps} of a baseline/progressive JPEG, or null. */
export function jpegInfo(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue }
    const m = b[i + 1]
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue }
    const len = (b[i + 2] << 8) | b[i + 3]
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8], comps: b[i + 9] }
    i += 2 + len
  }
  return null
}

const pathPDF = (d) => d.map((c) => {
  switch (c[0]) {
    case 'M': return `${n4(c[1])} ${n4(c[2])} m`
    case 'L': return `${n4(c[1])} ${n4(c[2])} l`
    case 'C': return `${n4(c[1])} ${n4(c[2])} ${n4(c[3])} ${n4(c[4])} ${n4(c[5])} ${n4(c[6])} c`
    default: return 'h'
  }
}).join('\n')

/** Build a PDF Blob from all pages of a doc (or the listed page indexes). */
export async function toPdf(doc, { pages, title = 'Drawing', creator = 'Tools' } = {}) {
  const list = pages || doc.pages.map((_, i) => i)
  const objs = [] // each entry: Uint8Array of the object body (without "n 0 obj")
  const add = (body) => { objs.push(typeof body === 'string' ? enc(body) : body); return objs.length }
  const reserve = () => { objs.push(null); return objs.length }
  const put = (id, body) => { objs[id - 1] = typeof body === 'string' ? enc(body) : body }
  const stream = async (dict, bytes, { compress = true, filter = '' } = {}) => {
    const z = compress && !filter ? await deflate(bytes) : null
    const data = z && z.length < bytes.length ? z : bytes
    const f = filter ? `/Filter /${filter} ` : data !== bytes ? '/Filter /FlateDecode ' : ''
    return add(cat([enc(`<< ${dict} ${f}/Length ${data.length} >>\nstream\n`), data, enc('\nendstream')]))
  }
  const catalog = reserve(), pagesId = reserve()
  const fonts = new Map(), gstates = new Map(), shadings = new Map(), xobjs = new Map()
  const notes = new Set()
  const fontName = (f) => { if (!fonts.has(f)) fonts.set(f, `F${fonts.size + 1}`); return fonts.get(f) }
  const gsName = (ca, CA) => { const k = `${n4(ca)}|${n4(CA)}`; if (!gstates.has(k)) gstates.set(k, { name: `GS${gstates.size + 1}`, ca, CA }); return gstates.get(k).name }

  const shadingFor = (g) => {
    const stops = [...g.stops].sort((a, b) => a.o - b.o).map((s) => ({ o: s.o, c: onWhite(s.c, s.a ?? 1) }))
    if (g.stops.some((x) => (x.a ?? 1) < 1)) notes.add('Transparent gradient stops were blended with white.')
    const fns = []
    for (let i = 0; i + 1 < stops.length; i++) fns.push(`<< /FunctionType 2 /Domain [0 1] /C0 [${rgb(stops[i].c)}] /C1 [${rgb(stops[i + 1].c)}] /N 1 >>`)
    const fn = stops.length === 1 ? `<< /FunctionType 2 /Domain [0 1] /C0 [${rgb(stops[0].c)}] /C1 [${rgb(stops[0].c)}] /N 1 >>`
      : `<< /FunctionType 3 /Domain [0 1] /Functions [${fns.join(' ')}] /Bounds [${stops.slice(1, -1).map((s) => n4(Math.min(1, Math.max(0, s.o)))).join(' ')}] /Encode [${fns.map(() => '0 1').join(' ')}] >>`
    const ext = '[true true]'
    const coords = g.g === 'radial' ? `${n4(g.fx ?? g.cx)} ${n4(g.fy ?? g.cy)} 0 ${n4(g.cx)} ${n4(g.cy)} ${n4(g.r)}` : `${n4(g.x1)} ${n4(g.y1)} ${n4(g.x2)} ${n4(g.y2)}`
    const key = `${g.g}|${coords}|${fn}`
    if (!shadings.has(key)) shadings.set(key, { name: `Sh${shadings.size + 1}`, dict: `<< /ShadingType ${g.g === 'radial' ? 3 : 2} /ColorSpace /DeviceRGB /Coords [${coords}] /Function ${fn} /Extend ${ext} >>` })
    if (g.spread === 'reflect' || g.spread === 'repeat') notes.add('Repeating gradients were written as plain gradients.')
    return shadings.get(key).name
  }

  const imageFor = async (it) => {
    const key = it.href
    if (xobjs.has(key)) return xobjs.get(key)
    let id
    const { mime, bytes } = dataUrlBytes(it.href)
    const info = mime === 'image/jpeg' ? jpegInfo(bytes) : null
    if (info && (info.comps === 3 || info.comps === 1)) {
      id = await stream(`/Type /XObject /Subtype /Image /Width ${info.w} /Height ${info.h} /ColorSpace ${info.comps === 1 ? '/DeviceGray' : '/DeviceRGB'} /BitsPerComponent 8`, bytes, { filter: 'DCTDecode' })
    } else {
      const px = await imagePixels(it, 4096)
      const rgbData = new Uint8Array(px.w * px.h * 3), alpha = new Uint8Array(px.w * px.h)
      let hasAlpha = false
      for (let i = 0, j = 0, k = 0; i < px.data.length; i += 4, j += 3, k++) {
        rgbData[j] = px.data[i]; rgbData[j + 1] = px.data[i + 1]; rgbData[j + 2] = px.data[i + 2]
        alpha[k] = px.data[i + 3]
        if (alpha[k] < 255) hasAlpha = true
      }
      const mask = hasAlpha ? await stream(`/Type /XObject /Subtype /Image /Width ${px.w} /Height ${px.h} /ColorSpace /DeviceGray /BitsPerComponent 8`, alpha) : 0
      id = await stream(`/Type /XObject /Subtype /Image /Width ${px.w} /Height ${px.h} /ColorSpace /DeviceRGB /BitsPerComponent 8${mask ? ` /SMask ${mask} 0 R` : ''}`, rgbData)
    }
    xobjs.set(key, { name: `Im${xobjs.size + 1}`, id })
    return xobjs.get(key)
  }

  const pageIds = []
  const contents = []
  for (const pi of list) {
    const page = doc.pages[pi]
    const ops = [`1 0 0 -1 0 ${n4(page.h)} cm`]
    for (const it of page.items) {
      ops.push('q')
      for (const c of it.clip || []) ops.push(pathPDF(c.d), c.rule === 'evenodd' ? 'W* n' : 'W n')
      if (it.t === 'path') {
        const path = pathPDF(it.d), evenodd = it.rule === 'evenodd'
        const hasStroke = it.stroke && it.strokeWidth > 0
        if (it.fill && typeof it.fill === 'object') {
          const sh = shadingFor(it.fill)
          ops.push('q', path, evenodd ? 'W* n' : 'W n', `${(it.fill.m || [1, 0, 0, 1, 0, 0]).map(n4).join(' ')} cm`)
          if (it.fillOpacity != null && it.fillOpacity < 1) ops.push(`/${gsName(it.fillOpacity, 1)} gs`)
          ops.push(`/${sh} sh`, 'Q')
        } else if (it.fill) {
          if (it.fillOpacity != null && it.fillOpacity < 1) ops.push(`/${gsName(it.fillOpacity, 1)} gs`)
          ops.push(`${rgb(it.fill)} rg`, path, evenodd ? 'f*' : 'f')
        }
        if (hasStroke) {
          ops.push('q', `${rgb(it.stroke)} RG ${n4(it.strokeWidth)} w ${it.cap || 0} J ${it.join || 0} j ${n4(it.miter || 4)} M`)
          if (it.dash?.length) ops.push(`[${it.dash.map(n4).join(' ')}] ${n4(it.dashOffset || 0)} d`)
          if (it.strokeOpacity != null && it.strokeOpacity < 1) ops.push(`/${gsName(1, it.strokeOpacity)} gs`)
          ops.push(path, 'S', 'Q')
        }
      } else if (it.t === 'image') {
        const x = await imageFor(it)
        if (it.opacity != null && it.opacity < 1) ops.push(`/${gsName(it.opacity, it.opacity)} gs`)
        ops.push(`${it.m.map(n4).join(' ')} cm 1 0 0 -1 0 1 cm /${x.name} Do`)
      } else if (it.t === 'text') {
        const f = fontName(baseFont(it.family, it.bold, it.italic))
        if (it.opacity != null && it.opacity < 1) ops.push(`/${gsName(it.opacity, it.opacity)} gs`)
        const bytes = winAnsi(it.str)
        const lit = '(' + [...bytes].map((b) => (b === 40 || b === 41 || b === 92 ? '\\' + String.fromCharCode(b) : b >= 32 && b < 127 ? String.fromCharCode(b) : '\\' + b.toString(8).padStart(3, '0'))).join('') + ')'
        ops.push(`${it.m.map(n4).join(' ')} cm 1 0 0 -1 0 0 cm ${rgb(it.fill || '#000000')} rg BT /${f} ${n4(it.size)} Tf 0 0 Td ${lit} Tj ET`)
        notes.add('Text uses standard PDF fonts (Helvetica, Times, Courier). Use "Convert text to outlines" for the exact letter shapes.')
      }
      ops.push('Q')
    }
    contents.push({ page, id: await stream('', enc(ops.join('\n') + '\n')) })
  }

  // shared resources
  const fontIds = new Map()
  for (const [f] of fonts) fontIds.set(f, add(`<< /Type /Font /Subtype /Type1 /BaseFont /${f} /Encoding /WinAnsiEncoding >>`))
  const shIds = new Map()
  for (const [, s] of shadings) shIds.set(s.name, add(s.dict))
  const res = `<< /ProcSet [/PDF /Text /ImageB /ImageC /ImageI]`
    + (fonts.size ? ` /Font << ${[...fonts].map(([f, n]) => `/${n} ${fontIds.get(f)} 0 R`).join(' ')} >>` : '')
    + (gstates.size ? ` /ExtGState << ${[...gstates.values()].map((g) => `/${g.name} << /Type /ExtGState /ca ${n4(g.ca)} /CA ${n4(g.CA)} >>`).join(' ')} >>` : '')
    + (shadings.size ? ` /Shading << ${[...shIds].map(([n, id]) => `/${n} ${id} 0 R`).join(' ')} >>` : '')
    + (xobjs.size ? ` /XObject << ${[...xobjs.values()].map((x) => `/${x.name} ${x.id} 0 R`).join(' ')} >>` : '') + ' >>'
  const resId = add(res)
  for (const { page, id } of contents) {
    const w = n4(page.w), h = n4(page.h)
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${w} ${h}] /CropBox [0 0 ${w} ${h}] /Resources ${resId} 0 R /Contents ${id} 0 R >>`))
  }
  put(pagesId, `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`)
  put(catalog, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`)
  const safe = (s) => String(s).replace(/[^\x20-\x7e]/g, '_').replace(/[()\\]/g, '_')
  const info = add(`<< /Title (${safe(title)}) /Creator (${safe(creator)}) /Producer (${safe(creator)}) >>`)

  const parts = [enc('%PDF-1.6\n%\xe2\xe3\xcf\xd3\n')]
  const offsets = []
  let pos = parts[0].length
  objs.forEach((body, i) => {
    offsets.push(pos)
    const head = enc(`${i + 1} 0 obj\n`), tail = enc('\nendobj\n')
    parts.push(head, body, tail)
    pos += head.length + body.length + tail.length
  })
  const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`), `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`]
  parts.push(enc(xref.join('')))
  return { blob: new Blob([cat(parts)], { type: 'application/pdf' }), notes: [...notes] }
}
