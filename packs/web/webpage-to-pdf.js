// Webpage to PDF: an exact print of the page (Microlink), or a readable text-only PDF built here from the page text (r.jina.ai + jsPDF).
import { h, icon, button, alert, clear, toggle, select, segmented, download, toast, onCleanup, formatBytes, field } from '../../lib/ui.js'
import { jspdf } from '../../lib/libs.js'
import { openPdf, thumbnail } from '../../lib/pdf.js'
import { load, save } from '../../lib/store.js'
import { ensureStyle, pill, note, chipGroup, omnibar, microlink, quotaNote, getText, parseWebUrl, recents, recentChips, hashParam, setHashParams, slug, fixMojibake } from './_shared.js'
import { parseJina, mdToText } from './website-to-text.js'

const FORMATS = ['A4', 'Letter', 'Legal', 'A3', 'A5', 'Tabloid']
const MARGINS = { none: ['No margin', '0mm'], narrow: ['Narrow', '10mm'], normal: ['Normal', '20mm'], wide: ['Wide', '30mm'] }

/** Build the Microlink query for the exact-page PDF. Pure. */
export function pdfParams(url, o) {
  return { url, pdf: true, meta: false, 'pdf.format': o.format, 'pdf.landscape': o.landscape ? 'true' : 'false', 'pdf.margin': MARGINS[o.margin][1], 'pdf.printBackground': o.backgrounds ? 'true' : 'false', media: o.media }
}

/** jsPDF's built-in fonts only cover Latin-1. Replace common punctuation and report how many other characters were lost. */
export function toLatin1(s) {
  let lost = 0
  const out = String(s)
    .replace(/[\u2018\u2019\u201a\u2032]/g, "'").replace(/[\u201c\u201d\u201e\u2033]/g, '"').replace(/[\u2013\u2014\u2212]/g, '-').replace(/\u2026/g, '...').replace(/[\u2022\u25cf\u25aa\u00b7]/g, '-')
    .replace(/[\u00a0\u2002\u2003\u2009\u200a\u202f]/g, ' ').replace(/[\u200b\u200c\u200d\ufeff]/g, '').replace(/\u20ac/g, 'EUR').replace(/\u2192/g, '->').replace(/\u2190/g, '<-')
    .replace(/[^\x09\x0a\x20-\x7e\xa0-\xff]/g, () => { lost++; return '?' })
  return { text: out, lost }
}

/** Markdown -> simple blocks for the PDF writer. Pure. */
export function toBlocks(md) {
  const blocks = []
  let para = []
  let fence = null
  const flush = () => { if (para.length) { blocks.push({ t: 'p', text: mdToText(para.join(' ')) }); para = [] } }
  for (const raw of String(md).replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (/^\s*```/.test(line)) { flush(); fence = fence ? (blocks.push({ t: 'code', text: fence.join('\n') }), null) : []; continue }
    if (fence) { fence.push(line); continue }
    if (!line.trim()) { flush(); continue }
    const hd = /^(#{1,6})\s+(.*)$/.exec(line)
    if (hd) { flush(); blocks.push({ t: 'h', level: hd[1].length, text: mdToText(hd[2]) }); continue }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (li) { flush(); blocks.push({ t: 'li', indent: Math.min(3, Math.floor(li[1].length / 2)), mark: /\d/.test(li[2]) ? li[2] : '-', text: mdToText(li[3]) }); continue }
    if (/^\s*>/.test(line)) { flush(); blocks.push({ t: 'quote', text: mdToText(line.replace(/^\s*>\s?/, '')) }); continue }
    if (/^\s*\|/.test(line)) { flush(); if (!/^[\s|:-]+$/.test(line)) blocks.push({ t: 'p', text: line.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => mdToText(c.trim())).join('   |   ') }); continue }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); continue }
    para.push(line.trim())
  }
  flush()
  return blocks.filter((b) => b.text !== '')
}

/** Write blocks into a PDF with jsPDF. Returns {blob, pages, lost}. */
export async function textPdf({ title, url, blocks }, { format = 'a4', landscape = false, margin = 18 } = {}) {
  const JsPDF = await jspdf()
  const doc = new JsPDF({ unit: 'mm', format: format.toLowerCase(), orientation: landscape ? 'landscape' : 'portrait' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  const maxW = W - margin * 2
  let y = margin
  let lost = 0
  const fix = (s) => { const r = toLatin1(s); lost += r.lost; return r.text }
  const need = (hgt) => { if (y + hgt > H - margin) { doc.addPage(); y = margin } }
  const write = (text, { size = 11, style = 'normal', font = 'helvetica', x = margin, width = maxW, gap = 1.6, color = 0, lh = 1.38 } = {}) => {
    doc.setFont(font, style); doc.setFontSize(size); doc.setTextColor(color)
    const lines = doc.splitTextToSize(fix(text), width)
    const step = (size * 0.3528) * lh
    for (const l of lines) { need(step); doc.text(l, x, y + size * 0.3528 * 0.85); y += step }
    y += gap
  }
  write(title || url || 'Web page', { size: 20, style: 'bold', gap: 2 })
  if (url) write(url, { size: 9, color: 110, gap: 6 })
  for (const b of blocks) {
    if (b.t === 'h') { y += b.level <= 2 ? 3 : 1.5; write(b.text, { size: [0, 17, 14.5, 12.5, 11.5, 11, 11][b.level], style: 'bold', gap: 1.8 }) }
    else if (b.t === 'li') write(`${b.mark}  ${b.text}`, { x: margin + 4 + b.indent * 5, width: maxW - 4 - b.indent * 5, gap: 0.9 })
    else if (b.t === 'quote') write(b.text, { x: margin + 6, width: maxW - 6, style: 'italic', color: 90 })
    else if (b.t === 'code') write(b.text, { font: 'courier', size: 8.5, gap: 3, lh: 1.25 })
    else write(b.text)
  }
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(140); doc.text(`${i} / ${pages}`, W - margin, H - 8, { align: 'right' }) }
  return { blob: doc.output('blob'), pages, lost }
}

const CSS = `
.t-w2p .res { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 20px; align-items: center; padding: 20px; text-align: left; }
.t-w2p .res canvas { max-width: 150px; height: auto; border-radius: 6px; box-shadow: var(--shadow); background: #fff; }
.t-w2p .res .ph { width: 130px; height: 170px; border-radius: 8px; display: grid; place-items: center; background: var(--surface-2); color: var(--muted); }
.t-w2p .res .ph .icon { width: 36px; height: 36px; }
@media (max-width: 520px) { .t-w2p .res { grid-template-columns: 1fr; justify-items: center; text-align: center; } }
`

export function mount(root, { signal }) {
  ensureStyle()
  if (!document.getElementById('t-w2p-style')) document.head.append(h('style', { id: 't-w2p-style' }, CSS))
  const rec = recents('w2p', 8)
  const o = { mode: 'exact', format: 'A4', landscape: false, margin: 'narrow', backgrounds: true, media: 'screen', ...load('w2p:opts', {}) }
  const persist = () => save('w2p:opts', o)
  const err = h('div'), out = h('div', { class: 'stack' })
  let chipsRecent, blobUrl = null, lastUrl = ''
  onCleanup(() => { if (blobUrl) URL.revokeObjectURL(blobUrl) })

  const modeChips = chipGroup([['exact', 'Exact copy of the page', 'file-down'], ['text', 'Readable text only', 'align-left']], o.mode, (v) => { o.mode = v; persist(); sync() }, { label: 'What to save', soft: true })
  const exactOpts = h('div', { class: 'stack' },
    h('div', { class: 'grid-3' }, field('Paper size', select(FORMATS, o.format, (v) => { o.format = v; persist() })),
      field('Margins', select(Object.entries(MARGINS).map(([k, [l, v]]) => [k, `${l} (${v})`]), o.margin, (v) => { o.margin = v; persist() })),
      field('Layout', select([['screen', 'As it looks on screen'], ['print', 'Print version (if the site has one)']], o.media, (v) => { o.media = v; persist() }))),
    h('div', { class: 'row' }, toggle('Landscape', o.landscape, (c) => { o.landscape = c; persist() }), toggle('Include background colors and images', o.backgrounds, (c) => { o.backgrounds = c; persist() })))
  const textOpts = h('div', { class: 'stack' }, h('div', { class: 'grid-3' }, field('Paper size', select(['A4', 'Letter', 'Legal', 'A5'], FORMATS.includes(o.format) && o.format !== 'A3' && o.format !== 'Tabloid' ? o.format : 'A4', (v) => { o.format = v; persist() }))),
    note('Builds a clean document from the page text: headings, paragraphs and lists, without images or site design. Fonts cover Latin letters only, so other scripts show as "?". Choose the exact copy for those pages.'))
  const optsBox = h('section', { class: 'panel stack' }, h('div', { class: 'wt-kicker' }, 'What to save'), modeChips, exactOpts, textOpts)
  function sync() { exactOpts.hidden = o.mode !== 'exact'; textOpts.hidden = o.mode !== 'text' }

  async function show(blob, { name, quota, kind, extra }) {
    if (blobUrl) URL.revokeObjectURL(blobUrl)
    blobUrl = URL.createObjectURL(blob)
    let pages = '', thumb = h('div', { class: 'ph' }, icon('file-text'))
    try {
      const doc = await openPdf(blob)
      pages = doc.numPages
      thumb = await thumbnail(doc, 1, 300)
    } catch { /* preview is optional */ }
    clear(out, h('section', { class: 'panel res wt-mesh' }, thumb,
      h('div', { class: 'stack', style: 'gap:10px;min-width:0' }, h('div', { class: 'wt-kicker' }, 'Your PDF is ready'), h('div', { style: 'font-weight:650;overflow-wrap:anywhere' }, name),
        h('div', { class: 'wt-chips' }, pages ? pill(`${pages} page${pages === 1 ? '' : 's'}`, 'accent', 'file-text') : null, pill(formatBytes(blob.size)), pill(kind), quotaNote(quota)),
        h('div', { class: 'row' }, button('Download PDF', { icon: 'download', variant: 'primary', size: 'lg', onClick: () => download(blob, name) }), h('a', { class: 'btn btn-secondary', href: blobUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('external-link'), h('span', 'Open'))))),
      extra || null)
  }

  async function exact(u) {
    clear(out, h('div', { class: 'panel stack' }, h('div', { class: 'wt-skel', style: 'height:120px' }), h('div', { class: 'small muted' }, `Loading ${u.hostname} in a real browser and printing it to PDF. This takes 5 to 30 seconds.`)))
    const r = await microlink(pdfParams(u.href, o), { signal })
    const pdf = r.data.pdf
    if (!pdf?.url) throw new Error('The service did not return a PDF for that page. It may block automated visitors.')
    const res = await fetch(pdf.url, { signal })
    if (!res.ok) throw new Error('The PDF was created but could not be downloaded. Try again.')
    const blob = await res.blob()
    await show(blob, { name: `${slug(u.hostname + u.pathname, 50)}.pdf`, quota: r.quota, kind: `${o.format}${o.landscape ? ' landscape' : ''}` })
  }
  async function text(u) {
    clear(out, h('div', { class: 'panel stack' }, h('div', { class: 'wt-skel', style: 'height:120px' }), h('div', { class: 'small muted' }, 'Reading the page text...')))
    const raw = await getText(`https://r.jina.ai/${u.href}`, { signal, timeout: 45000, service: 'The page reader (r.jina.ai)' })
    const p = parseJina(raw)
    const body = fixMojibake(p.body)
    if (!body.trim()) throw new Error('The reader found no text on that page. It may need a login or build its content with JavaScript.')
    const fmt = ['A4', 'Letter', 'Legal', 'A5'].includes(o.format) ? o.format : 'A4'
    const { blob, lost } = await textPdf({ title: fixMojibake(p.title) || u.hostname, url: p.source || u.href, blocks: toBlocks(body) }, { format: fmt })
    await show(blob, { name: `${slug(u.hostname + u.pathname, 50)}-text.pdf`, kind: `Text only, ${fmt}`, extra: lost ? alert('warn', `${lost} character${lost === 1 ? '' : 's'} (non-Latin letters or symbols) could not be written and show as "?". Use "Exact copy of the page" if you need them.`) : null })
  }

  const omni = omnibar({ icon: 'file-down', placeholder: 'https://example.com/article', label: 'Make PDF', buttonIcon: 'file-down', busyLabel: 'Making PDF', errorTo: err, onSubmit: async (v) => {
    clear(err)
    const u = parseWebUrl(v)
    lastUrl = u.href
    try { await (o.mode === 'exact' ? exact(u) : text(u)) } catch (e) {
      clear(out)
      if (o.mode === 'exact' && e.code !== 'ABORT') {
        clear(err, alert('error', e.message, h('div', { style: 'margin-top:8px' }, button('Make a text-only PDF instead', { icon: 'align-left', size: 'sm', onClick: () => { o.mode = 'text'; persist(); modeChips.set('text'); sync(); omni.run() } }))))
        return
      }
      throw e
    }
    rec.add(u.href); chipsRecent.refresh(); setHashParams({ q: u.href })
  } })
  chipsRecent = recentChips(rec, (v) => { omni.set(v); omni.run() }, { label: 'Recent', fmt: (v) => v.replace(/^https?:\/\//, '') })
  root.append(h('div', { class: 't-w2p stack' }, omni.el, err, optsBox, chipsRecent, out,
    note('"Exact copy" uses the free Microlink service (about 25 to 50 PDFs a day per network): it opens the page in a real browser and prints it. "Readable text" uses the free r.jina.ai reader and builds the PDF in your browser. Either way the page address is sent to that service and the page must be public.')))
  sync()
  const q = hashParam('q')
  if (q) { omni.set(q); omni.run() }
}
