// Image resolution checker: dimensions, DPI (JFIF, Exif, pHYs), megapixels, file size, format, color facts and print sizes.
import { table } from '../../lib/ui.js'
import {
  shell, h, icon, button, note, tiles, stage, batchSlot, readSource, previewCanvas, clear, toast, errorMessage, formatBytes, formatNumber, copyText,
} from './_kit.js'
import { sniff, readDensity, jpegInfo, jpegOrientation, pngInfo, webpInfo, gifInfo, bmpInfo } from './_meta.js'

const gcd = (a, b) => (b ? gcd(b, a % b) : a)
const NAMES = { jpeg: 'JPEG', png: 'PNG', gif: 'GIF', webp: 'WebP', bmp: 'BMP', ico: 'ICO', tiff: 'TIFF', avif: 'AVIF', heic: 'HEIC', svg: 'SVG' }
const PAPER = [['A6', 105, 148], ['A5', 148, 210], ['A4', 210, 297], ['A3', 297, 420], ['A2', 420, 594], ['Poster 24x36 in', 609.6, 914.4]]

export function aspect(w, hh) {
  const g = gcd(w, hh), a = w / g, b = hh / g
  if (a <= 50 && b <= 50) return `${a}:${b}`
  const r = w / hh
  return [[1, 1], [4, 3], [3, 2], [16, 9], [16, 10], [5, 4], [21, 9], [2, 1], [3, 4], [2, 3], [9, 16], [4, 5]].map(([x, y]) => [x, y, Math.abs(r - x / y)]).sort((p, q) => p[2] - q[2]).map(([x, y]) => `about ${x}:${y}`)[0]
}

/** Everything we can read from the file's bytes plus the decoded size. */
export async function inspectFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const kind = sniff(bytes)
  const src = await readSource(file)
  const info = { name: file.name, size: file.size, w: src.w, h: src.h, kind, modified: file.lastModified ? new Date(file.lastModified) : null, dens: readDensity(bytes), facts: [], img: src.img }
  const f = info.facts
  const add = (label, value) => f.push([label, value])
  let alpha = null, icc = null
  if (kind === 'jpeg') {
    const j = jpegInfo(bytes)
    alpha = false; icc = j.icc
    add('Color model', j.components === 1 ? 'Grayscale' : j.components === 4 ? 'CMYK' : `YCbCr color${j.subsampling ? `, ${j.subsampling} chroma` : ''}`)
    add('Bit depth', `${j.bitDepth} bits per channel`)
    add('Encoding', j.progressive ? 'Progressive' : 'Baseline')
    const o = jpegOrientation(bytes)
    if (o !== 1) add('Orientation (Exif)', `${o} (the photo is stored rotated and shown upright)`)
    add('Metadata', [j.exif && 'Exif', j.xmp && 'XMP', j.iptc && 'IPTC', j.comment && 'Comment'].filter(Boolean).join(', ') || 'None')
  } else if (kind === 'png') {
    const p = pngInfo(bytes)
    alpha = p.alpha; icc = p.icc || p.srgb
    add('Color model', p.color); add('Bit depth', `${p.bitDepth} bits per channel`); add('Interlaced', p.interlaced ? 'Yes (Adam7)' : 'No')
    if (p.animated) add('Animation', 'Animated PNG')
    add('Metadata', [p.hasText && 'Text chunks', p.hasExif && 'Exif'].filter(Boolean).join(', ') || 'None')
  } else if (kind === 'webp') {
    const w = webpInfo(bytes)
    alpha = w.alpha; icc = w.icc
    add('Compression', w.lossless ? 'Lossless' : 'Lossy'); if (w.animated) add('Animation', 'Animated WebP')
    add('Metadata', [w.exif && 'Exif', w.xmp && 'XMP'].filter(Boolean).join(', ') || 'None')
  } else if (kind === 'gif') {
    const g = gifInfo(bytes)
    alpha = g.transparent; add('Palette', 'Up to 256 colors'); add('Frames', g.frames > 1 ? `${g.frames} (animated)` : '1')
  } else if (kind === 'bmp') { const b = bmpInfo(bytes); add('Bit depth', `${b.bitDepth} bits per pixel`); alpha = b.bitDepth === 32 }
  if (alpha !== null) add('Transparency', alpha ? 'Yes' : 'No')
  if (icc !== null) add('Color profile', icc ? 'Embedded (or sRGB tagged)' : 'None (assumed sRGB)')
  return info
}

function reportText(i) {
  const mp = (i.w * i.h) / 1e6
  const lines = [`File: ${i.name}`, `Format: ${NAMES[i.kind] || 'Unknown'}`, `Dimensions: ${i.w} x ${i.h} px (${formatNumber(mp, 2)} MP, ${aspect(i.w, i.h)})`, `File size: ${formatBytes(i.size)} (${i.size.toLocaleString()} bytes)`,
    `DPI: ${i.dens.dpi ? i.dens.dpi.join(' x ') : 'not set'}`, ...i.facts.map(([k, v]) => `${k}: ${v}`)]
  for (const d of [72, 150, 300]) lines.push(`Print at ${d} DPI: ${formatNumber((i.w / d) * 2.54, 1)} x ${formatNumber((i.h / d) * 2.54, 1)} cm (${formatNumber(i.w / d, 1)} x ${formatNumber(i.h / d, 1)} in)`)
  return lines.join('\n')
}

export function mount(root) {
  const infos = new Map()
  const host = h('div', { class: 'stack' })
  const summary = h('div')
  async function show(file) {
    if (!file) { clear(host); return }
    try {
      let i = infos.get(file)
      if (!i) { clear(host, h('div', { class: 'empty loading' }, h('span', { class: 'spinner' }), 'Reading image...')); i = await inspectFile(file); infos.set(file, i) }
      render(i)
    } catch (e) { toast(errorMessage(e), 'error') }
  }
  function render(i) {
    const mp = (i.w * i.h) / 1e6
    const dpiText = i.dens.dpi ? `${i.dens.dpi[0]}${i.dens.dpi[1] !== i.dens.dpi[0] ? ` x ${i.dens.dpi[1]}` : ''}` : 'Not set'
    const preview = previewCanvas(i.img, 640)
    const rows = [72, 96, 150, 300].map((d) => [`${d} DPI`, `${formatNumber((i.w / d) * 2.54, 1)} x ${formatNumber((i.h / d) * 2.54, 1)} cm`, `${formatNumber(i.w / d, 1)} x ${formatNumber(i.h / d, 1)} in`])
    const paper = PAPER.map(([n, wm, hm]) => {
      const [long, short] = i.w >= i.h ? [i.w, i.h] : [i.h, i.w]
      const dpi = Math.min(long / (Math.max(wm, hm) / 25.4), short / (Math.min(wm, hm) / 25.4))
      return [n, `${Math.round(dpi)} DPI`, dpi >= 300 ? 'Sharp' : dpi >= 200 ? 'Good' : dpi >= 150 ? 'Fine for posters' : 'Soft']
    })
    clear(host,
      h('div', { class: 'ie-work' },
        h('div', { class: 'ie-main' }, stage(preview), h('div', { class: 'row' }, button('Copy report', { icon: 'copy', onClick: () => copyText(reportText(i)) }))),
        h('div', { class: 'stack' },
          tiles([
            { label: 'Dimensions', value: `${i.w} x ${i.h}`, sub: 'pixels', hot: true },
            { label: 'Megapixels', value: `${formatNumber(mp, 2)} MP`, sub: aspect(i.w, i.h) },
            { label: 'File size', value: formatBytes(i.size), sub: `${i.size.toLocaleString()} bytes` },
            { label: 'Format', value: NAMES[i.kind] || 'Unknown' },
            { label: 'DPI', value: dpiText, sub: i.dens.source ? `from ${i.dens.source}` : 'No resolution saved' },
            { label: 'Bytes per pixel', value: formatNumber(i.size / (i.w * i.h), 2), sub: 'lower means more compressed' },
          ]),
          i.facts.length ? h('div', { class: 'panel ie-glass' }, h('div', { class: 'ie-sec-title' }, icon('scan-search'), h('span', 'Details')), table({ columns: ['Property', 'Value'], rows: i.facts })) : null)),
      h('div', { class: 'ie-work' },
        h('div', { class: 'panel ie-glass' }, h('div', { class: 'ie-sec-title' }, icon('printer'), h('span', 'Print size by DPI')), table({ columns: ['Resolution', 'Centimeters', 'Inches'], rows })),
        h('div', { class: 'panel ie-glass' }, h('div', { class: 'ie-sec-title' }, icon('file'), h('span', 'How sharp is it on paper?')), table({ columns: ['Paper', 'Resolution', 'Quality'], rows: paper }), note('Dots per inch if you stretch this image over the whole sheet. 300 is sharp, 150 is fine from a distance.'))))
  }
  const slot = batchSlot({ ic: 'info', onChange: (fs) => { if (!fs.length) clear(host); renderSummary() }, onSelect: show })
  async function renderSummary() {
    const fs = slot.files
    if (fs.length < 2) { clear(summary); return }
    const rows = []
    for (const f of fs) {
      try { let i = infos.get(f); if (!i) { i = await inspectFile(f); infos.set(f, i) }
        rows.push([f.name, `${i.w} x ${i.h}`, `${formatNumber((i.w * i.h) / 1e6, 2)} MP`, formatBytes(i.size), NAMES[i.kind] || '?', i.dens.dpi ? i.dens.dpi[0] : '-']) } catch { rows.push([f.name, 'unreadable', '', formatBytes(f.size), '', '']) }
    }
    clear(summary, h('div', { class: 'panel ie-glass' }, h('div', { class: 'ie-sec-title' }, icon('list'), h('span', `All ${fs.length} images`)), table({ columns: ['File', 'Pixels', 'Megapixels', 'Size', 'Format', 'DPI'], rows })))
  }
  root.append(shell(slot.el, host, summary))
}
