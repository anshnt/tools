// FON / FNT to TTF: reads Windows bitmap fonts and writes one TrueType font per size (every pixel is a square in the outline), with a pixel preview.
import { h, dropzone, button, busy, alert, clear, input, field, segmented, panel, progress, download } from '../../lib/ui.js'
import { zip, baseName } from '../../lib/files.js'
import { readFonFile, fntToTtf, fntLabel, unicodeFor } from './_fon.js'
import { FONT_MIME } from './_convert.js'
import { injectStyle, COMMON_CSS } from './_ui.js'

const CSS = `
.t-fon .size { border: 1px solid var(--border); border-radius: 16px; background: var(--surface); padding: 14px; display: grid; gap: 10px; min-width: 0; }
.t-fon .size-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.t-fon .size-head .ttl { font-weight: 650; flex: 1 1 180px; min-width: 0; overflow-wrap: anywhere; }
.t-fon .cv-wrap { overflow-x: auto; border-radius: 10px; background: var(--surface-2); padding: 8px; }
.t-fon canvas { display: block; image-rendering: pixelated; max-width: none; }
.t-fon .hintline { font-size: 12.5px; color: var(--muted); }
`

/** Draw text (and optionally every character) of one bitmap font onto a canvas, scaled up with hard pixel edges. */
export function drawFnt(canvas, f, text, scale, { grid = false, fg = '#111', bg = '#fff' } = {}) {
  const h0 = f.pixHeight, pad = 4
  const advance = (code) => (f.glyphs.get(code)?.width ?? f.glyphs.get(f.defaultChar)?.width ?? f.avgWidth)
  const codesOf = (s) => [...s].map((ch) => {
    const cp = ch.codePointAt(0)
    for (const [code] of f.glyphs) if (unicodeFor(code, f.charset) === cp) return code
    return f.defaultChar
  })
  const lines = []
  for (const ln of text.split('\n')) lines.push(codesOf(ln))
  if (grid) for (let r = 0; r < 16; r++) { const l = []; for (let c = 0; c < 16; c++) { const code = r * 16 + c; l.push(code >= f.first && code <= f.last && f.glyphs.has(code) ? code : -1) } lines.push(l) }
  const maxW = Math.max(1, ...lines.map((l) => l.reduce((a, c) => a + (c < 0 ? f.avgWidth || 8 : advance(c)), 0)))
  canvas.width = (maxW + pad * 2) * scale
  canvas.height = (lines.length * h0 + pad * 2 + (grid ? 4 : 0)) * scale
  const g = canvas.getContext('2d')
  g.fillStyle = bg; g.fillRect(0, 0, canvas.width, canvas.height)
  g.fillStyle = fg
  let y = pad
  lines.forEach((l, li) => {
    if (grid && li === lines.length - 16) y += 4
    let x = pad
    for (const c of l) {
      const gl = c < 0 ? null : f.glyphs.get(c)
      if (gl) gl.rows.forEach((row, r) => { for (let i = 0; i < row.length; i++) if (row[i]) g.fillRect((x + i) * scale, (y + r) * scale, scale, scale) })
      x += c < 0 ? f.avgWidth || 8 : advance(c)
    }
    y += h0
  })
}

export function mount(root) {
  injectStyle('t-font-common', COMMON_CSS)
  injectStyle('t-fon', CSS)
  const status = h('div', { class: 'stack' })
  const out = h('div', { class: 'stack' })
  const zone = dropzone({
    accept: '.fon,.fnt', multiple: false, icon: 'grid-3x3', label: 'Drop a .fon or .fnt file here or click to choose',
    hint: 'Windows bitmap fonts such as Terminal, Fixedsys, System and Courier (raster sizes)', onFiles: ([f]) => open(f),
  })
  root.append(h('div', { class: 't-fon t-font stack' }, zone, status, out, h('p', { class: 'small muted' }, 'Everything is converted on your device. Fonts are never uploaded.')))

  async function open(file) {
    clear(out); clear(status)
    let parsed
    try { parsed = readFonFile(new Uint8Array(await file.arrayBuffer())) } catch (e) { return clear(status, alert('error', e.userMessage || e.message)) }
    const { fonts, vector } = parsed
    const base = baseName(file.name)
    const sampleBox = input({ value: 'The quick brown fox jumps over the lazy dog 0123456789', 'aria-label': 'Preview text' })
    let scale = 2, showGrid = false
    const cards = []
    const files = []
    const used = new Set()
    const zipBtn = button('Download all sizes (ZIP)', { icon: 'file-archive', variant: 'primary' })
    const prog = progress('Building fonts')
    const colors = () => { const s = getComputedStyle(root); return { fg: s.getPropertyValue('--text').trim() || '#111', bg: s.getPropertyValue('--surface-2').trim() || '#fff' } }
    const redraw = () => cards.forEach((c) => drawFnt(c.canvas, c.f, sampleBox.value || ' ', scale, { grid: showGrid, ...colors() }))
    const scaleSeg = segmented([[1, '1x'], [2, '2x'], [3, '3x'], [4, '4x']], scale, (v) => { scale = +v; redraw() }, 'Preview size')
    const gridSeg = segmented([[0, 'Sample text'], [1, 'Sample and all characters']], 0, (v) => { showGrid = !!+v; redraw() }, 'Preview content')
    sampleBox.addEventListener('input', redraw)

    fonts.forEach((f) => {
      let name = `${base}-${f.fixed ? `${f.pixWidth}x${f.pixHeight}` : `${f.pixHeight}px`}`
      for (let n = 2; used.has(name); n++) name = `${base}-${f.pixHeight}px-${n}`
      used.add(name)
      const canvas = h('canvas', { 'aria-label': `Preview of ${f.face} at ${fntLabel(f)}` })
      const dl = button('Download TTF', { icon: 'download', variant: 'secondary', size: 'sm' })
      let built
      const build = () => (built ||= new File([fntToTtf(f)], `${name}.ttf`, { type: FONT_MIME.ttf }))
      dl.addEventListener('click', () => busy(dl, async () => { download(build(), build().name) }, 'Building'))
      files.push(build)
      const sharp = f.pixHeight
      cards.push({ f, canvas })
      out.append(h('div', { class: 'size' },
        h('div', { class: 'size-head' }, h('div', { class: 'ttl' }, `${f.face}, ${fntLabel(f)}`), h('span', { class: 'small muted' }, `${f.glyphs.size} characters`), dl),
        h('div', { class: 'cv-wrap' }, canvas),
        h('div', { class: 'hintline' }, `Sharpest at ${sharp} px font size (or a multiple of it). File: ${name}.ttf`)))
    })
    clear(status,
      alert('success', `Found ${fonts.length} bitmap size${fonts.length === 1 ? '' : 's'} in ${file.name}.`, vector ? ` ${vector} vector (stroke) font${vector === 1 ? ' was' : 's were'} skipped.` : ''),
      panel(h('div', { class: 'stack' }, field('Preview text', sampleBox), h('div', { class: 'row' }, scaleSeg, gridSeg))),
      h('div', { class: 'row' }, zipBtn), prog.el)
    redraw()
    zipBtn.addEventListener('click', () => busy(zipBtn, async () => {
      const list = []
      for (let i = 0; i < files.length; i++) { prog.set(i / files.length); list.push({ name: files[i]().name, data: files[i]() }); await new Promise((r) => setTimeout(r, 0)) }
      download(await zip(list), `${base}-ttf.zip`)
    }, { label: 'Building', progress: prog }))
  }
}
