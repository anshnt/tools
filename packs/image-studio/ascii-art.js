// ASCII art: images to text (charset, width, invert, color HTML) and text to banner lettering (fonts built from an embedded 5x7 bitmap font).
import { h, panel, split, field, input, textarea, button, copyButton, clear, download, toast, rangeField, toggle, onCleanup, formatNumber } from '../../lib/ui.js'
import { loadImage } from '../../lib/image.js'
import { addStyle, heroDrop, stage, pills, chipPicker, frame, newCanvas, encode, stem, clamp, IMG_ACCEPT } from './_shared.js'

// ---------- Image to ASCII ----------
export const CHARSETS = {
  classic: { label: 'Classic', chars: ' .:-=+*#%@' },
  detailed: { label: 'Detailed', chars: ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$' },
  blocks: { label: 'Blocks', chars: ' ░▒▓█' },
  simple: { label: 'Simple', chars: ' .:oO@' },
  binary: { label: 'Binary', chars: '01' },
  custom: { label: 'Custom', chars: '' },
}

/**
 * Convert RGBA pixels (cols x rows) to ASCII cells.
 * chars run from empty (index 0) to dense (last). dense = 'bright' maps bright pixels to dense chars (for light text on a dark page).
 */
export function toAscii(data, cols, rows, { chars = CHARSETS.classic.chars, dense = 'dark', invert = false, brightness = 0, contrast = 0, bg = [255, 255, 255] } = {}) {
  const n = chars.length
  const set = [...chars]
  const f = (259 * (contrast * 2.55 + 255)) / (255 * (259 - contrast * 2.55))
  const lines = [], colors = new Uint8ClampedArray(cols * rows * 3)
  for (let y = 0; y < rows; y++) {
    let line = ''
    for (let x = 0; x < cols; x++) {
      const o = (y * cols + x) * 4, a = data[o + 3] / 255
      const r = data[o] * a + bg[0] * (1 - a), g = data[o + 1] * a + bg[1] * (1 - a), b = data[o + 2] * a + bg[2] * (1 - a)
      let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      lum = clamp((lum - 128) * f + 128 + brightness * 2.55, 0, 255)
      let t = lum / 255
      if ((dense === 'dark') !== invert) t = 1 - t
      line += set[Math.min(n - 1, Math.floor(t * n))]
      const c = (y * cols + x) * 3
      colors[c] = r; colors[c + 1] = g; colors[c + 2] = b
    }
    lines.push(line)
  }
  return { lines, colors, cols, rows }
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** Cells with per-character colors to HTML spans (runs of equal color are merged). */
export function coloredHtml({ lines, colors, cols }) {
  let out = ''
  lines.forEach((line, y) => {
    const chars = [...line]
    let run = '', cur = ''
    const q = (x) => { const c = (y * cols + x) * 3; return `#${[0, 1, 2].map((j) => (Math.round(colors[c + j] / 17) * 17).toString(16).padStart(2, '0')).join('')}` }
    chars.forEach((ch, x) => {
      const col = q(x)
      if (col !== cur) { if (run) out += `<span style="color:${cur}">${esc(run)}</span>`; run = ''; cur = col }
      run += ch
    })
    if (run) out += `<span style="color:${cur}">${esc(run)}</span>`
    out += '\n'
  })
  return out
}

// ---------- Text to ASCII ----------
// Classic 5x7 bitmap font, ASCII 32..95 (space to underscore). Each glyph is 5 column bytes, bit 0 = top row.
const FONT = [
  [0, 0, 0, 0, 0], [0, 0, 0x5f, 0, 0], [0, 7, 0, 7, 0], [0x14, 0x7f, 0x14, 0x7f, 0x14], [0x24, 0x2a, 0x7f, 0x2a, 0x12], [0x23, 0x13, 8, 0x64, 0x62], [0x36, 0x49, 0x56, 0x20, 0x50], [0, 8, 7, 3, 0],
  [0, 0x1c, 0x22, 0x41, 0], [0, 0x41, 0x22, 0x1c, 0], [0x2a, 0x1c, 0x7f, 0x1c, 0x2a], [8, 8, 0x3e, 8, 8], [0, 0x40, 0x30, 0, 0], [8, 8, 8, 8, 8], [0, 0, 0x60, 0x60, 0], [0x20, 0x10, 8, 4, 2],
  [0x3e, 0x51, 0x49, 0x45, 0x3e], [0, 0x42, 0x7f, 0x40, 0], [0x72, 0x49, 0x49, 0x49, 0x46], [0x21, 0x41, 0x49, 0x4d, 0x33], [0x18, 0x14, 0x12, 0x7f, 0x10], [0x27, 0x45, 0x45, 0x45, 0x39], [0x3c, 0x4a, 0x49, 0x49, 0x31], [0x41, 0x21, 0x11, 9, 7],
  [0x36, 0x49, 0x49, 0x49, 0x36], [0x46, 0x49, 0x49, 0x29, 0x1e], [0, 0, 0x14, 0, 0], [0, 0x40, 0x34, 0, 0], [0, 8, 0x14, 0x22, 0x41], [0x14, 0x14, 0x14, 0x14, 0x14], [0, 0x41, 0x22, 0x14, 8], [2, 1, 0x59, 9, 6],
  [0x3e, 0x41, 0x5d, 0x59, 0x4e], [0x7c, 0x12, 0x11, 0x12, 0x7c], [0x7f, 0x49, 0x49, 0x49, 0x36], [0x3e, 0x41, 0x41, 0x41, 0x22], [0x7f, 0x41, 0x41, 0x41, 0x3e], [0x7f, 0x49, 0x49, 0x49, 0x41], [0x7f, 9, 9, 9, 1], [0x3e, 0x41, 0x41, 0x51, 0x73],
  [0x7f, 8, 8, 8, 0x7f], [0, 0x41, 0x7f, 0x41, 0], [0x20, 0x40, 0x41, 0x3f, 1], [0x7f, 8, 0x14, 0x22, 0x41], [0x7f, 0x40, 0x40, 0x40, 0x40], [0x7f, 2, 0x1c, 2, 0x7f], [0x7f, 4, 8, 0x10, 0x7f], [0x3e, 0x41, 0x41, 0x41, 0x3e],
  [0x7f, 9, 9, 9, 6], [0x3e, 0x41, 0x51, 0x21, 0x5e], [0x7f, 9, 0x19, 0x29, 0x46], [0x26, 0x49, 0x49, 0x49, 0x32], [3, 1, 0x7f, 1, 3], [0x3f, 0x40, 0x40, 0x40, 0x3f], [0x1f, 0x20, 0x40, 0x20, 0x1f], [0x3f, 0x40, 0x38, 0x40, 0x3f],
  [0x63, 0x14, 8, 0x14, 0x63], [3, 4, 0x78, 4, 3], [0x61, 0x59, 0x49, 0x4d, 0x43], [0, 0x7f, 0x41, 0x41, 0x41], [2, 4, 8, 0x10, 0x20], [0, 0x41, 0x41, 0x41, 0x7f], [4, 2, 1, 2, 4], [0x40, 0x40, 0x40, 0x40, 0x40],
]
const ALIAS = { '{': '(', '}': ')', '|': '!', '~': '-', '`': "'" }

/** One text line as a 7-row bitmap (array of 7 arrays of 0/1). Unknown characters become '?'. Lowercase letters use the capital forms. */
export function bitmapLine(text, gap = 1) {
  const rows = Array.from({ length: 7 }, () => [])
  const chars = [...text]
  chars.forEach((chRaw, i) => {
    let ch = ALIAS[chRaw] || chRaw.toUpperCase()
    let code = ch.codePointAt(0)
    if (code === 9) { ch = ' '; code = 32 }
    const g = FONT[code - 32] || FONT['?'.charCodeAt(0) - 32]
    for (let c = 0; c < 5; c++) for (let r = 0; r < 7; r++) rows[r].push((g[c] >> r) & 1)
    if (i < chars.length - 1) for (let k = 0; k < gap; k++) for (let r = 0; r < 7; r++) rows[r].push(0)
  })
  return rows
}

export const FIGS = {
  block: { label: 'Block', render: (b, o) => b.map((r) => r.map((p) => (p ? '██' : '  ')).join('')) },
  half: { label: 'Half blocks', render: (b) => { const rows = [...b, new Array(b[0].length).fill(0)]; const out = []; for (let y = 0; y < rows.length; y += 2) out.push(rows[y].map((t, x) => (t && rows[y + 1][x] ? '█' : t ? '▀' : rows[y + 1][x] ? '▄' : ' ')).join('')); return out } },
  shadow: { label: 'Shadow', render: (b) => {
    const H = b.length + 1, W = b[0].length + 1, out = []
    for (let y = 0; y < H; y++) { let line = ''; for (let x = 0; x < W; x++) { const on = b[y]?.[x], sh = b[y - 1]?.[x - 1]; line += on ? '██' : sh ? '░░' : '  ' } out.push(line) }
    return out } },
  hash: { label: 'Hash', render: (b, o) => b.map((r) => r.map((p) => (p ? o.fill.repeat(2) : '  ')).join('')) },
  slant: { label: 'Slant', render: (b, o) => b.map((r, y) => ' '.repeat(Math.floor((6 - y) * 0.9)) + r.map((p) => (p ? o.fill : ' ')).join('')) },
  big: { label: 'Big', render: (b) => b.flatMap((r) => { const l = r.map((p) => (p ? '████' : '    ')).join(''); return [l, l] }) },
}

/** Render text (several lines allowed) in a figure style. align: left | center | right. */
export function figText(text, style = 'block', { gap = 1, fill = '#', align = 'left' } = {}) {
  const f = FIGS[style] || FIGS.block
  const blocks = text.split(/\r?\n/).map((line) => (line.length ? f.render(bitmapLine(line, gap), { fill }) : ['']))
  const width = Math.max(0, ...blocks.flat().map((l) => [...l].length))
  const out = []
  blocks.forEach((rows, bi) => {
    for (const l of rows) {
      const pad = width - [...l].length
      const lead = align === 'center' ? Math.floor(pad / 2) : align === 'right' ? pad : 0
      out.push(' '.repeat(lead) + l)
    }
    if (bi < blocks.length - 1) out.push('')
  })
  return out.map((l) => l.replace(/\s+$/, '')).join('\n')
}

// ---------- UI ----------
const MONO = 'ui-monospace, "Geist Mono", Menlo, Consolas, monospace'

/** Draw text cells to a PNG-ready canvas. colors: optional Uint8ClampedArray rgb per cell (image mode). */
function textCanvas(lines, { fg, bg, colors, cols }) {
  const size = 14, lh = size * 1.2
  const m = newCanvas(8, 8).getContext('2d')
  m.font = `${size}px ${MONO}`
  const cw = m.measureText('M').width
  const width = Math.max(1, Math.ceil(Math.max(...lines.map((l) => [...l].length), 1) * cw))
  const c = newCanvas(width + 24, Math.ceil(lines.length * lh) + 24)
  const g = c.getContext('2d')
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height)
  g.font = `${size}px ${MONO}`; g.textBaseline = 'top'
  lines.forEach((line, y) => {
    ;[...line].forEach((ch, x) => {
      if (ch === ' ') return
      if (colors) { const o = (y * cols + x) * 3; g.fillStyle = `rgb(${colors[o]},${colors[o + 1]},${colors[o + 2]})` } else g.fillStyle = fg
      g.fillText(ch, 12 + x * cw, 12 + y * lh)
    })
  })
  return c
}

export function mount(root) {
  addStyle('is-ascii', `
.t-ascii .out { margin: 0; padding: 16px; border-radius: 16px; overflow: auto; max-height: 640px; font-family: ${MONO}; white-space: pre; tab-size: 4; font-variant-ligatures: none; border: 1px solid var(--border); transition: background .3s, color .3s; }
.t-ascii .out.dark { background: #0b0b10; color: #e8e8f0; }
.t-ascii .out.light { background: #ffffff; color: #111; }
.t-ascii .out.fit { overflow: hidden; }
.t-ascii .out.reveal { animation: asciiIn .7s var(--ease) both; }
@keyframes asciiIn { from { clip-path: inset(0 0 100% 0); opacity: .4; } }
.t-ascii .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
`)
  const s = { tab: 'image', cols: 100, set: 'classic', custom: ' .:-=+*#%@', theme: 'dark', invert: false, brightness: 0, contrast: 0, color: false, text: 'Hello', style: 'block', gap: 1, fill: '#', align: 'left' }
  let src = null, last = null // last: {text, html, lines, colors, cols}

  // shared output
  const out = h('pre', { class: 'out dark fit', tabindex: 0, 'aria-label': 'ASCII art' })
  const info = h('div', { class: 'is-cap' })
  const outStage = stage(out, info)
  const actions = h('div', { class: 'row' },
    copyButton(() => last?.text || '', 'Copy text'),
    button('Download .txt', { icon: 'file-text', size: 'sm', onClick: () => last && download(last.text, `${last.name}.txt`, 'text/plain') }),
    button('Download .html', { icon: 'code', size: 'sm', onClick: () => last && download(htmlDoc(), `${last.name}.html`, 'text/html') }),
    button('Download PNG', { icon: 'image-down', size: 'sm', onClick: async () => { if (!last) return; const dark = s.theme === 'dark'; download(await encode(textCanvas(last.lines, { fg: dark ? '#e8e8f0' : '#111111', bg: dark ? '#0b0b10' : '#ffffff', colors: s.tab === 'image' && s.color ? last.colors : null, cols: last.cols }), 'image/png'), `${last.name}.png`) } }))
  function htmlDoc() {
    const dark = s.theme === 'dark'
    const body = last.html ?? esc(last.text)
    return `<!doctype html>\n<html><head><meta charset="utf-8"><title>${esc(last.name)}</title></head>\n<body style="margin:0;background:${dark ? '#0b0b10' : '#fff'}">\n<pre style="margin:0;padding:16px;font:12px/1.2 ${MONO.replace(/"/g, "'")};color:${dark ? '#e8e8f0' : '#111'}">${body}</pre>\n</body></html>\n`
  }

  const themeSegs = []
  const mkTheme = () => {
    const seg = pills([['dark', 'Light text on dark'], ['light', 'Dark text on light']], s.theme, (v) => { s.theme = v; themeSegs.forEach((t) => t.set(v)); if (s.tab === 'image') run(); else runText() }, 'Page colors')
    themeSegs.push(seg)
    return seg
  }

  function fitFont(cols, min = 2.5, max = 16) {
    if (!out.isConnected) return
    const w = out.clientWidth - 32
    const m = newCanvas(8, 8).getContext('2d')
    m.font = `100px ${getComputedStyle(out).fontFamily}`
    const ratio = m.measureText('0').width / 100 || 0.6
    const px = clamp(w / (cols * ratio), min, max)
    out.style.fontSize = `${px}px`
    out.style.lineHeight = `${px * ratio * 2}px`
  }
  let ro
  if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => { if (last) s.tab === 'image' ? fitFont(last.cols) : fitFont(last.cols, 5, 14) }); ro.observe(out); onCleanup(() => ro.disconnect()) }

  // ----- image tab -----
  const drop = heroDrop({ accept: IMG_ACCEPT, sample: 1, label: 'Drop a picture to turn it into text', onFiles: ([f]) => load(f) })
  const setChips = chipPicker(Object.entries(CHARSETS).map(([k, v]) => [k, v.label]), s.set, (v) => { s.set = v; customF.hidden = v !== 'custom'; run() }, 'Character set')
  const customIn = input({ value: s.custom, 'aria-label': 'Custom characters', mono: true, oninput: () => { s.custom = customIn.value; run() } })
  const customF = field('Characters, from lightest to darkest', customIn)
  customF.hidden = true
  const widthF = rangeField('Width', { min: 20, max: 240, value: s.cols, format: (v) => `${v} characters`, onInput: (v) => { s.cols = v; runSoon() } })
  const brF = rangeField('Brightness', { min: -100, max: 100, value: 0, format: (v) => `${v}`, onInput: (v) => { s.brightness = v; runSoon() } })
  const coF = rangeField('Contrast', { min: -100, max: 100, value: 0, format: (v) => `${v}`, onInput: (v) => { s.contrast = v; runSoon() } })
  const invT = toggle('Invert', false, (v) => { s.invert = v; run() })
  const colT = toggle('Color (HTML and PNG output)', false, (v) => { s.color = v; run() })
  const imgControls = h('div', { class: 'stack' }, drop, panel(h('div', { class: 'stack' }, field('Character set', setChips), customF, widthF, h('div', { class: 'row2' }, brF, coF), h('div', { class: 'row' }, invT, colT), field('Preview colors', mkTheme()))))
  const runSoon = frame(() => run())

  function run() {
    if (!src) return
    outStage.hidden = false; actionRow.hidden = false
    const cols = s.cols
    const rows = Math.max(1, Math.round(cols * (src.h / src.w) * 0.5))
    const c = newCanvas(cols, rows)
    const g = c.getContext('2d', { willReadFrequently: true })
    g.imageSmoothingQuality = 'high'
    g.drawImage(src.img, 0, 0, cols, rows)
    const chars = s.set === 'custom' ? (s.custom || ' @') : CHARSETS[s.set].chars
    const r = toAscii(g.getImageData(0, 0, cols, rows).data, cols, rows, { chars, dense: s.theme === 'dark' ? 'bright' : 'dark', invert: s.invert, brightness: s.brightness, contrast: s.contrast, bg: s.theme === 'dark' ? [11, 11, 16] : [255, 255, 255] })
    const text = r.lines.join('\n')
    last = { text, lines: r.lines, colors: r.colors, cols, html: s.color ? coloredHtml(r) : null, name: `${stem(src.name)}-ascii` }
    refresh()
    clear(info, h('span', h('b', `${cols} x ${rows}`), ' characters'), h('span', `${formatNumber(text.length, 0)} total`))
  }

  async function load(file) {
    try {
      const img = await loadImage(file)
      src = { img, w: img.naturalWidth, h: img.naturalHeight, name: file.name }
      drop.setCompact(true)
      run()
      out.classList.remove('reveal'); void out.offsetWidth; out.classList.add('reveal')
    } catch (e) { toast(e.message, 'error') }
  }

  // ----- text tab -----
  const textIn = textarea({ rows: 3, value: s.text, placeholder: 'Type something...', 'aria-label': 'Text to turn into ASCII art', oninput: () => { s.text = textIn.value; runText() } })
  const styleChips = chipPicker(Object.entries(FIGS).map(([k, v]) => [k, v.label]), s.style, (v) => { s.style = v; fillF.hidden = !(v === 'hash' || v === 'slant'); runText() }, 'Lettering style')
  const fillIn = input({ value: s.fill, maxlength: 1, 'aria-label': 'Fill character', mono: true, oninput: () => { s.fill = fillIn.value || '#'; runText() } })
  const fillF = field('Fill character', fillIn)
  fillF.hidden = true
  const gapF = rangeField('Letter spacing', { min: 0, max: 4, value: s.gap, format: (v) => `${v}`, onInput: (v) => { s.gap = v; runText() } })
  const alignSeg = pills([['left', 'Left'], ['center', 'Center'], ['right', 'Right']], s.align, (v) => { s.align = v; runText() }, 'Alignment')
  const textControls = h('div', { class: 'stack' }, panel(h('div', { class: 'stack' }, field('Your text', textIn), field('Style', styleChips), fillF, gapF, field('Align lines', alignSeg), field('Preview colors', mkTheme()),
    h('p', { class: 'small muted' }, 'Lettering is built from a 5x7 bitmap font, so letters, digits and common punctuation work. Lowercase shows as capitals.'))))

  function runText() {
    const text = figText(s.text, s.style, { gap: s.gap, fill: s.fill || '#', align: s.align })
    const lines = text.split('\n')
    last = { text, lines, colors: null, cols: Math.max(...lines.map((l) => [...l].length), 1), html: null, name: `${(s.text.split('\n')[0] || 'text').trim().slice(0, 24).replace(/[^\w-]+/g, '-') || 'text'}-ascii` }
    refresh()
    clear(info, h('span', h('b', `${last.cols} x ${lines.length}`), ' characters'))
  }

  function refresh() {
    out.className = `out ${s.theme}${s.tab === 'image' ? ' fit' : ''}`
    if (!last) { out.textContent = ''; return }
    if (s.tab === 'image') { if (s.color && last.html) out.innerHTML = last.html; else out.textContent = last.text; fitFont(last.cols) }
    else { out.textContent = last.text; fitFont(last.cols, 5, 14) }
  }

  const modeSeg = pills([['image', 'Image to ASCII'], ['text', 'Text to ASCII']], s.tab, (v) => { s.tab = v; sync() }, 'What to convert')
  function sync() {
    imgControls.hidden = s.tab !== 'image'
    textControls.hidden = s.tab !== 'text'
    if (s.tab === 'text') runText(); else if (src) run(); else { last = null; refresh(); clear(info, 'Add a picture to see it here.') }
    outStage.hidden = s.tab === 'image' && !src
    actionRow.hidden = outStage.hidden
  }
  const actionRow = h('div', { class: 'stack' }, actions)
  root.append(h('div', { class: 't-ascii stack' }, h('div', modeSeg), split(h('div', { class: 'stack' }, imgControls, textControls), h('div', { class: 'stack' }, outStage, actionRow), 'wide-right')))
  sync()
}
