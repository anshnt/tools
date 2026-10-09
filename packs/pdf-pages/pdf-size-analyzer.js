// PDF size analyzer: walks the pdf-lib object tree, adds up the stream bytes of images, fonts, page content, metadata and everything
// else, draws a donut and bars, lists the biggest images and fonts, and gives tips based on what it found.
import { h, icon, stats, table, clear, formatBytes, progress, yieldToMain } from '../../lib/ui.js'
import { pdfLib } from '../../lib/libs.js'
import { pdfSource, ppRoot, useStyle, bars, countUp, compressRanges, toCSV } from './_shared.js'

export const CATS = [
  { id: 'images', label: 'Images', color: '#e5484d' },
  { id: 'fonts', label: 'Fonts', color: '#3e63dd' },
  { id: 'content', label: 'Page content', color: '#30a46c' },
  { id: 'metadata', label: 'Metadata', color: '#f76b15' },
  { id: 'other', label: 'Other', color: '#8e4ec6' },
]

const FILTER_NAMES = { DCTDecode: 'JPEG', FlateDecode: 'Flate (lossless)', JPXDecode: 'JPEG 2000', CCITTFaxDecode: 'Fax (1-bit)', JBIG2Decode: 'JBIG2', LZWDecode: 'LZW', RunLengthDecode: 'Run length', ASCII85Decode: 'ASCII85', ASCIIHexDecode: 'ASCIIHex' }

/** Analyse a pdf-lib document. fileSize is the size of the file in bytes. */
export async function analyze(doc, fileSize, onProgress) {
  const { PDFName, PDFRef, PDFDict, PDFArray, PDFNumber, PDFStream } = await pdfLib()
  const ctx = doc.context
  const N = (s) => PDFName.of(s)
  const nameOf = (v) => (v instanceof PDFName ? v.asString().replace(/^\//, '') : null)
  const get = (d, k) => { try { return d.lookup(N(k)) } catch { return undefined } }
  const num = (d, k) => { const v = get(d, k); return v instanceof PDFNumber ? v.asNumber() : null }
  const nm = (d, k) => nameOf(get(d, k))
  const filterOf = (d) => {
    const f = get(d, 'Filter')
    if (f instanceof PDFName) return [nameOf(f)]
    if (f instanceof PDFArray) return f.asArray().map((x) => nameOf(ctx.lookup(x))).filter(Boolean)
    return []
  }
  const refKey = (r) => `${r.objectNumber}`

  // ---- pass 1: collect what points where
  const fontStream = new Map() // stream ref -> {font, kind}
  const fontExtra = new Map()
  const fonts = new Map() // descriptor key -> info
  const contentRefs = new Set()
  const imageUse = new Map() // image ref -> Set(pages)
  const all = []
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) all.push([ref, obj])
  for (let i = 0; i < all.length; i++) {
    const [ref, obj] = all[i]
    const dict = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null
    if (!dict) continue
    if (!(obj instanceof PDFStream) && nm(dict, 'Type') === 'FontDescriptor') {
      const name = nm(dict, 'FontName') || 'Unnamed font'
      for (const [k, kind] of [['FontFile', 'Type 1'], ['FontFile2', 'TrueType'], ['FontFile3', 'CFF / OpenType']]) {
        const r = dict.get(N(k))
        if (r instanceof PDFRef) { fontStream.set(refKey(r), { name, kind }); fonts.set(refKey(r), { name, kind, embedded: true, subset: /^[A-Z]{6}\+/.test(name), bytes: 0 }) }
      }
    } else if (!(obj instanceof PDFStream) && nm(dict, 'Type') === 'Font') {
      const base = nm(dict, 'BaseFont') || 'Font'
      for (const k of ['ToUnicode', 'CIDToGIDMap']) { const r = dict.get(N(k)); if (r instanceof PDFRef) fontExtra.set(refKey(r), base) }
      const sub = nm(dict, 'Subtype')
      if (sub && sub !== 'Type0' && sub !== 'CIDFontType0' && sub !== 'CIDFontType2' && !dict.get(N('FontDescriptor')) && !fonts.has(`std:${base}`)) fonts.set(`std:${base}`, { name: base, kind: sub, embedded: false, subset: false, bytes: 0 })
    }
    if (i % 4000 === 0) { onProgress?.(i / all.length * 0.4); await yieldToMain() }
  }
  const pages = doc.getPages()
  const seenForm = new Set()
  const walkResources = (res, pageNo, depth) => {
    if (!(res instanceof PDFDict)) return
    const xo = get(res, 'XObject')
    if (!(xo instanceof PDFDict)) return
    for (const [, v] of xo.entries()) {
      if (!(v instanceof PDFRef)) continue
      const o = ctx.lookup(v)
      if (!(o instanceof PDFStream)) continue
      const sub = nm(o.dict, 'Subtype')
      if (sub === 'Image') { if (!imageUse.has(refKey(v))) imageUse.set(refKey(v), new Set()); imageUse.get(refKey(v)).add(pageNo) }
      else if (sub === 'Form' && depth < 4 && !seenForm.has(`${refKey(v)}:${pageNo}`)) { seenForm.add(`${refKey(v)}:${pageNo}`); walkResources(get(o.dict, 'Resources'), pageNo, depth + 1) }
    }
  }
  pages.forEach((p, idx) => {
    const c = p.node.get(N('Contents'))
    const add = (r) => { if (r instanceof PDFRef) contentRefs.add(refKey(r)) }
    if (c instanceof PDFRef) { const t = ctx.lookup(c); if (t instanceof PDFArray) t.asArray().forEach(add); else add(c) } else if (c instanceof PDFArray) c.asArray().forEach(add)
    try { walkResources(p.node.Resources(), idx + 1, 0) } catch { /* page without resources */ }
  })

  // ---- pass 2: classify every stream
  const bytes = { images: 0, fonts: 0, content: 0, metadata: 0, other: 0 }
  const otherParts = { attachments: 0, profiles: 0, structure: 0, misc: 0, overhead: 0 }
  const images = [], streams = []
  let uncompressed = 0, streamTotal = 0
  const dupKeys = new Map()
  for (let i = 0; i < all.length; i++) {
    const [ref, obj] = all[i]
    if (!(obj instanceof PDFStream)) continue
    const size = obj.getContentsSize?.() ?? obj.contents?.length ?? 0
    streamTotal += size
    const d = obj.dict
    const type = nm(d, 'Type'), sub = nm(d, 'Subtype')
    const key = refKey(ref)
    const filters = filterOf(d)
    let cat = 'other', part = 'misc'
    if (sub === 'Image') {
      cat = 'images'
      const w = num(d, 'Width'), hh = num(d, 'Height')
      const cs = get(d, 'ColorSpace')
      const csName = cs instanceof PDFName ? nameOf(cs) : cs instanceof PDFArray ? nameOf(ctx.lookup(cs.get(0))) : (get(d, 'ImageMask')?.toString() === 'true' ? 'Mask' : null)
      const info = { ref: key, w, h: hh, cs: csName, filter: filters.at(-1) || 'none', bytes: size, pages: [...(imageUse.get(key) || [])].sort((a, b) => a - b), isMask: !!get(d, 'SMaskInData') || type === 'Mask' }
      images.push(info)
      const first = obj.contents ? Array.from(obj.contents.subarray(0, 48)).join(',') : ''
      const dk = `${w}x${hh}:${size}:${first}`
      const prev = dupKeys.get(dk)
      if (prev) { prev.count++; prev.waste += size } else dupKeys.set(dk, { count: 1, waste: 0 })
    } else if (fontStream.has(key)) { cat = 'fonts'; fonts.get(key).bytes += size }
    else if (fontExtra.has(key)) cat = 'fonts'
    else if (type === 'Metadata' || sub === 'XML') cat = 'metadata'
    else if (type === 'EmbeddedFile') { part = 'attachments' }
    else if (contentRefs.has(key) || sub === 'Form' || type === 'Pattern' || get(d, 'PatternType') != null) cat = 'content'
    else if (type === 'ObjStm' || type === 'XRef') part = 'structure'
    else if (get(d, 'N') != null && (get(d, 'Alternate') != null || (!type && !sub && filters.includes('FlateDecode')))) part = 'profiles'
    bytes[cat] += size
    if (cat === 'other') otherParts[part] += size
    if (!filters.length && size > 4096 && cat !== 'images' && cat !== 'fonts') uncompressed += size
    streams.push({ ref: key, cat, part, size, type, sub })
    if (i % 4000 === 0) { onProgress?.(0.4 + (i / all.length) * 0.6); await yieldToMain() }
  }
  // document info dictionary counts as metadata
  try {
    const info = ctx.lookup(ctx.trailerInfo.Info)
    if (info instanceof PDFDict) bytes.metadata += info.sizeInBytes()
  } catch { /* no Info */ }
  const accounted = bytes.images + bytes.fonts + bytes.content + bytes.metadata + bytes.other
  const overhead = Math.max(0, fileSize - accounted)
  bytes.other += overhead
  otherParts.overhead = overhead
  const dupWaste = [...dupKeys.values()].reduce((a, d) => a + d.waste, 0)
  return { bytes, otherParts, images: images.sort((a, b) => b.bytes - a.bytes), fonts: [...fonts.values()].sort((a, b) => b.bytes - a.bytes), streams, fileSize, pages: pages.length, uncompressed, dupWaste, streamTotal }
}

/** Tips that follow from an analysis. -> [{icon, title, text}] */
export function tipsFor(r) {
  const tips = []
  const total = r.fileSize || 1
  const pct = (b) => Math.round((b / total) * 100)
  const big = r.images.filter((i) => i.bytes > 1_000_000)
  if (r.bytes.images / total > 0.5) tips.push({ icon: 'image', title: `Images are ${pct(r.bytes.images)}% of the file`, text: big.length ? `${big.length} image${big.length > 1 ? 's are' : ' is'} over 1 MB. Compress PDF can downsample them with little visible loss.` : 'Many mid-sized images add up. Compress PDF can downsample them.' })
  const lossless = r.images.filter((i) => i.filter === 'FlateDecode' && i.bytes > 300_000 && i.cs !== 'Mask')
  if (lossless.length) tips.push({ icon: 'file-image', title: `${lossless.length} large lossless image${lossless.length > 1 ? 's' : ''}`, text: `Photos stored as lossless (Flate) data are much bigger than JPEG. They use ${formatBytes(lossless.reduce((a, i) => a + i.bytes, 0))} now.` })
  if (r.dupWaste > 50_000) tips.push({ icon: 'copy', title: 'The same image is stored more than once', text: `Repeated copies waste about ${formatBytes(r.dupWaste)}. Re-exporting the document so a logo or background is shared would remove them.` })
  const full = r.fonts.filter((f) => f.embedded && !f.subset && f.bytes > 150_000)
  if (r.bytes.fonts / total > 0.2 || full.length) tips.push({ icon: 'type', title: `Fonts take ${formatBytes(r.bytes.fonts)}`, text: full.length ? `${full.length} font${full.length > 1 ? 's are' : ' is'} embedded in full instead of only the letters used. Re-save with "subset fonts" switched on.` : 'Many embedded fonts add up. Using fewer font families or subsetting them helps.' })
  if (r.bytes.metadata > 100_000) tips.push({ icon: 'tags', title: 'Large metadata', text: `Metadata is ${formatBytes(r.bytes.metadata)}. Strip it with the PDF metadata remover.` })
  if (r.otherParts.attachments > 100_000) tips.push({ icon: 'paperclip', title: 'File attachments', text: `Attached files take ${formatBytes(r.otherParts.attachments)}. Remove them if the recipient does not need them.` })
  if (r.uncompressed > 200_000) tips.push({ icon: 'file-archive', title: 'Uncompressed data', text: `${formatBytes(r.uncompressed)} of content is stored without compression. Saving the PDF again with compression on shrinks it.` })
  if (r.bytes.content / total > 0.5) tips.push({ icon: 'pen-tool', title: 'Heavy drawing data', text: 'Most of the file is page drawing instructions, typical of maps, CAD and charts exported as vectors. Flattening to images can be smaller but loses sharpness.' })
  if (!tips.length) tips.push({ icon: 'circle-check', title: 'Nothing stands out', text: 'This PDF has no obvious waste. It is already compact for what it contains.' })
  return tips
}

function donut(items, total) {
  const R = 68, C = 2 * Math.PI * R
  const svgEl = h('svg', { viewBox: '0 0 180 180', class: 'pp-donut', role: 'img', 'aria-label': 'Size breakdown' })
  svgEl.append(h('circle', { cx: 90, cy: 90, r: R, fill: 'none', 'stroke-width': 26, class: 'pp-donut-bg' }))
  let off = 0
  const segs = items.filter((i) => i.value > 0).map((it, k) => {
    const len = (it.value / total) * C
    const c = h('circle', { cx: 90, cy: 90, r: R, fill: 'none', stroke: it.color, 'stroke-width': 26, 'stroke-dasharray': `0 ${C}`, 'stroke-dashoffset': -off, transform: 'rotate(-90 90 90)', class: 'pp-donut-seg' })
    const gap = len > 4 ? 1.5 : 0
    off += len
    requestAnimationFrame(() => setTimeout(() => { c.setAttribute('stroke-dasharray', `${Math.max(0, len - gap)} ${C}`) }, 90 * k + 80))
    return c
  })
  svgEl.append(...segs)
  return svgEl
}

export function mount(root, { signal }) {
  const body = h('div', { class: 'stack' })
  let s
  let gen = 0
  const src = pdfSource({ onLoad: (source) => { s = source; return run(source) }, onClear: () => { s = null; gen++; clear(body) } })

  async function run(source) {
    const my = ++gen
    const prog = progress()
    clear(body, h('div', { class: 'row' }, h('span', { class: 'spinner' }), h('strong', 'Measuring what is inside...')), prog.el)
    const doc = await source.inspect()
    const r = await analyze(doc, source.size, (f) => prog.set(f, 'Reading objects'))
    if (my !== gen || source.dead || signal.aborted) return
    show(r, source)
  }

  function show(r, source) {
    const total = r.fileSize
    const items = CATS.map((c) => ({ ...c, value: r.bytes[c.id] }))
    const biggest = items.slice().sort((a, b) => b.value - a.value)[0]
    const centre = h('div', { class: 'pp-donut-centre' }, h('b', { 'data-size': total }, '0'), h('span', 'total'))
    const chart = h('div', { class: 'pp-donut-wrap' }, donut(items, total), centre)
    countUp(centre.firstChild, total, { format: (n) => formatBytes(n), ms: 900 })
    const pctOf = (v) => `${v / total >= 0.1 ? Math.round((v / total) * 100) : (v / total * 100).toFixed(1)}%`
    const legend = bars(items.map((it) => ({ label: it.label, value: it.value, text: formatBytes(it.value), hint: pctOf(it.value), swatch: it.color })), { max: Math.max(...items.map((i) => i.value)) })
    const top = r.images.slice(0, 12)
    const imgTable = r.images.length ? table({
      columns: ['#', 'Pixels', 'Colour', 'Format', 'Pages', { label: 'Size', num: true }, { label: 'Share', num: true }],
      rows: top.map((im, i) => [i + 1, im.w && im.h ? `${im.w} x ${im.h}` : '-', im.cs || '-', FILTER_NAMES[im.filter] || im.filter, im.pages.length ? compressRanges(im.pages).slice(0, 24) : 'not on a page', formatBytes(im.bytes), `${((im.bytes / total) * 100).toFixed(1)}%`]),
    }) : null
    const fontTable = r.fonts.length ? table({
      columns: ['Font', 'Type', 'Embedded', { label: 'Size', num: true }],
      rows: r.fonts.slice(0, 20).map((f) => [f.name.replace(/^[A-Z]{6}\+/, ''), f.kind, f.embedded ? (f.subset ? 'Subset' : 'Full font') : 'No (built in)', f.embedded ? formatBytes(f.bytes) : '-']),
    }) : null
    const tips = tipsFor(r)
    const csv = () => toCSV([['Category', 'Bytes', 'Share'], ...items.map((i) => [i.label, i.value, ((i.value / total) * 100).toFixed(2) + '%']), [], ['Largest streams', 'Object', 'Category', 'Bytes'], ...r.streams.slice().sort((a, b) => b.size - a.size).slice(0, 25).map((x, i) => [i + 1, x.ref, x.cat, x.size])])
    const o = r.otherParts
    const otherNote = [['Structure and cross references', o.overhead + o.structure], ['Attachments', o.attachments], ['Colour profiles', o.profiles], ['Other streams', o.misc]].filter(([, v]) => v > 1024).map(([l, v]) => `${l} ${formatBytes(v)}`).join(' · ')

    clear(body,
      stats([
        { label: 'File size', value: formatBytes(total), accent: true, hint: `${r.pages} ${r.pages === 1 ? 'page' : 'pages'}` },
        { label: 'Biggest part', value: biggest.label, hint: `${formatBytes(biggest.value)} (${pctOf(biggest.value)})` },
        { label: 'Per page', value: formatBytes(total / Math.max(1, r.pages)), hint: 'on average' },
        { label: 'Images', value: String(r.images.length), hint: r.images.length ? `${formatBytes(r.bytes.images)}` : 'none' },
      ]),
      h('div', { class: 'panel' }, h('div', { class: 'pp-size-hero' }, chart, h('div', { class: 'pp-size-legend' }, legend, otherNote ? h('div', { class: 'pp-hint', style: 'margin-top:8px' }, `Other includes: ${otherNote}.`) : null))),
      h('div', { class: 'pp-section-title' }, icon('lightbulb'), 'What you can do'),
      h('div', { class: 'pp-tips' }, tips.map((t, i) => h('div', { class: 'pp-tip pp-in', style: { '--i': i } }, h('div', { class: 'pp-tip-icon' }, icon(t.icon)), h('div', h('strong', t.title), h('p', t.text))))),
      imgTable ? h('div', { class: 'stack tight' }, h('div', { class: 'pp-section-title' }, icon('images'), `Biggest images${r.images.length > top.length ? ` (top ${top.length} of ${r.images.length})` : ''}`), imgTable) : null,
      fontTable ? h('div', { class: 'stack tight' }, h('div', { class: 'pp-section-title' }, icon('type'), 'Fonts'), fontTable) : null,
      h('div', { class: 'pp-hint' }, 'Sizes are the stored (compressed) bytes inside the file, so they add up to the file size.'))
  }

  useStyle('pp-style-analyzer', CSS)
  root.append(ppRoot(src.el, body))
}

const CSS = `
.pp .pp-size-hero { display: grid; grid-template-columns: 220px 1fr; gap: 28px; align-items: center; }
.pp .pp-donut-wrap { position: relative; width: 200px; height: 200px; margin: 0 auto; }
.pp .pp-donut { width: 100%; height: 100%; display: block; }
.pp .pp-donut-bg { stroke: var(--surface-2); }
.pp .pp-donut-seg { transition: stroke-dasharray 1s var(--ease); stroke-linecap: butt; }
.pp .pp-donut-centre { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; pointer-events: none; }
.pp .pp-donut-centre b { font-size: 22px; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.pp .pp-donut-centre span { font-size: 12px; color: var(--muted); }
.pp .pp-tips { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 12px; }
.pp .pp-tip { display: flex; gap: 14px; padding: 14px 16px; border-radius: 18px; background: var(--surface); border: 1px solid var(--border); transition: transform .3s var(--spring), border-color .2s; }
.pp .pp-tip:hover { transform: translateY(-3px); border-color: var(--border-strong); }
.pp .pp-tip-icon { width: 38px; height: 38px; border-radius: 12px; flex: none; display: grid; place-items: center; color: var(--accent); background: var(--accent-soft); }
.pp .pp-tip strong { font-size: 14.5px; }
.pp .pp-tip p { margin: 3px 0 0; font-size: 13.5px; color: var(--muted); }
@media (max-width: 720px) { .pp .pp-size-hero { grid-template-columns: 1fr; gap: 16px; } }
`
