// Barcode generator: Code 128, EAN-13, UPC-A, EAN-8, Code 39, ITF, ITF-14, Codabar, Pharmacode. JsBarcode (MIT) draws the bars.
import { h, icon, button, field, input, textarea, toggle, rangeField, split, panel, alert, clear, download, downloadButton, copyText, debounce, busy, progress } from '../../lib/ui.js'
import { script } from '../../lib/libs.js'
import { zip } from '../../lib/files.js'
import { load, save } from '../../lib/store.js'
import { ensureStyle, pill, chipGroup, note, copyImage, slug } from './_shared.js'
import { svgToCanvas } from './_qr.js'

const JSBARCODE = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.12.3/dist/JsBarcode.all.min.js'
const loadJsBarcode = () => script(JSBARCODE).then(() => window.JsBarcode)

/** GTIN / EAN / UPC check digit for the data digits (without the check digit). */
export function gtinCheck(digits) {
  let sum = 0
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = 4 - w) sum += Number(digits[i]) * w
  return (10 - (sum % 10)) % 10
}

const onlyDigits = (s) => /^\d+$/.test(s)
function gtin(len, name) {
  return (raw) => {
    const s = raw.replace(/[\s-]/g, '')
    if (!s) return { empty: true }
    if (!onlyDigits(s)) return { error: `${name} uses digits only.` }
    if (s.length !== len - 1 && s.length !== len) return { error: `${name} needs ${len - 1} digits (the check digit is added for you) or all ${len}. You typed ${s.length}.` }
    const cd = gtinCheck(s.slice(0, len - 1))
    if (s.length === len && Number(s[len - 1]) !== cd) return { error: `The last digit (check digit) should be ${cd} for these numbers, not ${s[len - 1]}.`, fix: s.slice(0, len - 1) + cd }
    return { value: s.slice(0, len - 1) + cd, added: s.length === len - 1 ? cd : null }
  }
}

/** Per-format rules. check(raw) -> {value} | {error, fix?} | {empty: true}. */
export const FORMATS = {
  CODE128: { label: 'Code 128', sub: 'Any text or numbers', example: 'ORDER-2026-0417', use: 'Shipping labels, inventory, serial numbers. Handles letters, digits and symbols.',
    check: (raw) => (!raw ? { empty: true } : /^[\x00-\x7f]+$/.test(raw) ? { value: raw } : { error: 'Code 128 supports plain English characters only (no accents or emoji).' }) },
  EAN13: { label: 'EAN-13', sub: '13 digits', example: '590123412345', use: 'Retail products worldwide. Type 12 digits and the 13th is calculated.', check: gtin(13, 'EAN-13') },
  UPC: { label: 'UPC-A', sub: '12 digits', example: '03600029145', use: 'Retail products in the US and Canada. Type 11 digits and the 12th is calculated.', check: gtin(12, 'UPC-A') },
  EAN8: { label: 'EAN-8', sub: '8 digits', example: '9638507', use: 'Small packages. Type 7 digits and the 8th is calculated.', check: gtin(8, 'EAN-8') },
  CODE39: { label: 'Code 39', sub: 'A-Z, 0-9, - . $ / + %', example: 'PART-4821', use: 'Asset tags, ID badges and industrial labels. Capital letters, digits and a few symbols.',
    check: (raw) => { const s = raw.toUpperCase(); return !s ? { empty: true } : /^[A-Z0-9 \-.$/+%]+$/.test(s) ? { value: s } : { error: 'Code 39 allows capital letters, digits, space and - . $ / + % only.' } } },
  ITF: { label: 'ITF', sub: 'Digits, even count', example: '12345670', use: 'Cartons and logistics. Digits only, in pairs.',
    check: (raw) => { const s = raw.replace(/\s/g, ''); return !s ? { empty: true } : !onlyDigits(s) ? { error: 'ITF uses digits only.' } : s.length % 2 ? { error: 'ITF needs an even number of digits. Add a leading 0?', fix: `0${s}` } : { value: s } } },
  ITF14: { label: 'ITF-14', sub: '14 digits', example: '1234567890123', use: 'Shipping cartons (GTIN-14). Type 13 digits and the 14th is calculated.', check: gtin(14, 'ITF-14') },
  codabar: { label: 'Codabar', sub: 'Digits - $ : / . +', example: '40156', use: 'Libraries, blood banks and parcels. Start and stop letters (A) are added for you.',
    check: (raw) => { const s = raw.toUpperCase().replace(/\s/g, ''); const body = s.replace(/^[A-D]/, '').replace(/[A-D]$/, ''); return !s ? { empty: true } : /^[0-9\-$:/.+]+$/.test(body) ? { value: /^[A-D].*[A-D]$/.test(s) ? s : `A${body}A` } : { error: 'Codabar allows digits and - $ : / . + only.' } } },
  pharmacode: { label: 'Pharmacode', sub: 'Number 3 to 131070', example: '1234', use: 'Pharmaceutical packaging. A whole number between 3 and 131070.',
    check: (raw) => { const s = raw.trim(); return !s ? { empty: true } : !onlyDigits(s) || +s < 3 || +s > 131070 ? { error: 'Pharmacode is a whole number from 3 to 131070.' } : { value: s } } },
}

const DEFAULTS = { width: 2, height: 90, margin: 12, displayValue: true, fontSize: 18, fg: '#0b0b10', bg: '#ffffff', transparent: false }
const CSS = `
.t-bc .formats { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr)); gap: 8px; }
.t-bc .fmt { text-align: left; padding: 10px 12px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; display: grid; gap: 1px; transition: transform .25s var(--spring), border-color .2s, box-shadow .2s; min-width: 0; }
.t-bc .fmt:hover { transform: translateY(-2px); border-color: var(--border-strong); }
.t-bc .fmt b { font-size: 14px; font-weight: 600; }
.t-bc .fmt span { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.t-bc .fmt[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); box-shadow: 0 0 0 3px var(--ring); }
.t-bc .stage { padding: 26px 18px; display: grid; place-items: center; --wt-c1: #0ea5e9; --wt-c2: #a855f7; min-height: 250px; }
.t-bc .label { background: var(--lbl, #fff); border-radius: 14px; padding: 8px; max-width: 100%; box-shadow: 0 26px 50px -26px rgba(15,15,40,.55), 0 2px 5px rgba(15,15,40,.08); overflow: hidden; }
.t-bc .label.checker { background: var(--checker); }
.t-bc .label svg { display: block; max-width: 100%; height: auto; animation: bc-wipe .55s var(--ease) both; }
@keyframes bc-wipe { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
.t-bc .sticky { position: sticky; top: calc(var(--header-h) + 16px); }
.t-bc .ghost { color: var(--muted); text-align: center; display: grid; gap: 10px; place-items: center; }
.t-bc .ghost .icon { width: 44px; height: 44px; opacity: .6; }
.t-bc input[type="color"] { width: 100%; height: 42px; padding: 3px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; }
.t-bc .actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; align-items: center; }
@media (max-width: 900px) { .t-bc .sticky { position: static; } }
@media (prefers-reduced-motion: reduce) { .t-bc .label svg { animation: none; } }
`

export function mount(root, { signal }) {
  ensureStyle()
  if (!document.getElementById('t-bc-style')) document.head.append(h('style', { id: 't-bc-style' }, CSS))
  const st = { ...DEFAULTS, ...load('barcode:style', {}) }
  let format = load('barcode:format', 'CODE128')
  if (!FORMATS[format]) format = 'CODE128'
  let current = null // {svg (string), w, h, value, format}
  let token = 0

  const stage = h('div', { class: 'wt-mesh stage' })
  const status = h('div', { class: 'stack tight', style: 'width:100%' })
  const meta = h('div', { class: 'row', style: 'justify-content:center' })
  const value = input({ placeholder: 'Type the number or text', value: '', 'aria-label': 'Barcode value', autocomplete: 'off', spellcheck: false, oninput: () => renderSoon() })
  const hint = h('div', { class: 'small muted' })
  const scaleSel = chipGroup([['1', '1x'], ['2', '2x'], ['3', '3x'], ['4', '4x']], '3', null, { label: 'PNG scale' })
  const pngBtn = downloadButton(() => toPng(+scaleSel.value), () => `barcode-${slug(current.value)}.png`, 'Download PNG', { size: 'lg' })
  const svgBtn = button('SVG', { icon: 'download', onClick: () => download(current.svg, `barcode-${slug(current.value)}.svg`, 'image/svg+xml') })
  const copyBtn = button('', { icon: 'image', ariaLabel: 'Copy image', title: 'Copy image', onClick: async () => copyImage(await toPng(3)) })
  const valBtn = button('', { icon: 'copy', ariaLabel: 'Copy value', title: 'Copy value', onClick: () => copyText(current.value) })
  const acts = [pngBtn, svgBtn, copyBtn, valBtn]
  const setActs = (on) => { for (const b of acts) b.disabled = !on }

  async function makeSvg(val, fmt, o = st) {
    const JsBarcode = await loadJsBarcode()
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    JsBarcode(svg, val, { format: fmt, width: o.width, height: o.height, margin: o.margin, displayValue: o.displayValue, fontSize: o.fontSize, lineColor: o.fg, background: o.transparent ? null : o.bg, font: 'monospace', textMargin: 4 })
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    return svg
  }
  async function toPng(scale) {
    const svg = await makeSvg(current.value, current.format)
    const w = parseFloat(svg.getAttribute('width')), hh = parseFloat(svg.getAttribute('height'))
    const text = new XMLSerializer().serializeToString(svg)
    const c = await svgToCanvas(text, w * scale, hh * scale)
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not create the PNG.'))), 'image/png'))
  }

  async function render() {
    const my = ++token
    const f = FORMATS[format]
    const raw = value.value
    const r = f.check(raw)
    clear(status)
    if (r.empty || r.error) {
      current = null
      setActs(false)
      clear(meta)
      clear(stage, h('div', { class: 'ghost' }, icon('barcode'), h('div', r.error ? '' : 'Type a value to see the barcode appear.'), r.error ? alert('warn', h('div', r.error, r.fix ? [' ', button(`Use ${r.fix}`, { size: 'sm', variant: 'secondary', onClick: () => { value.value = r.fix; render() } })] : null)) : null))
      return
    }
    try {
      const svg = await makeSvg(r.value, format)
      if (my !== token) return
      const w = parseFloat(svg.getAttribute('width')), hh = parseFloat(svg.getAttribute('height'))
      current = { svg: new XMLSerializer().serializeToString(svg), value: r.value, format, w, h: hh }
      const label = h('div', { class: ['label', st.transparent && 'checker'], style: { '--lbl': st.bg } })
      label.append(svg)
      svg.removeAttribute('width'); svg.removeAttribute('height')
      svg.style.width = `${Math.min(w, 520)}px`
      svg.style.aspectRatio = `${w} / ${hh}`
      clear(stage, label)
      setActs(true)
      clear(meta, pill(f.label, 'accent'), pill(`${r.value.length} characters`), r.added != null ? pill(`Check digit ${r.added} added`, 'ok', 'circle-check') : null)
    } catch (e) {
      if (my !== token) return
      current = null
      setActs(false)
      clear(stage, alert('error', `Could not draw this barcode. ${e.message || ''}`))
    }
  }
  const renderSoon = debounce(render, 60)

  const fmtBox = h('div', { class: 'formats', role: 'group', 'aria-label': 'Barcode type' })
  function renderFormats() {
    clear(fmtBox, Object.entries(FORMATS).map(([k, f]) => h('button', { type: 'button', class: 'fmt', 'aria-pressed': String(k === format), onclick: () => {
      format = k; save('barcode:format', k)
      renderFormats(); hint.textContent = FORMATS[k].use; value.placeholder = FORMATS[k].sub; render()
    } }, h('b', f.label), h('span', f.sub))))
  }

  const upd = (patch) => { Object.assign(st, patch); save('barcode:style', st); renderSoon() }
  const style = h('div', { class: 'stack' },
    h('div', { class: 'grid-2' },
      rangeField('Bar width', { min: 1, max: 5, step: 1, value: st.width, format: (v) => `${v} px`, onInput: (v) => upd({ width: v }) }),
      rangeField('Height', { min: 30, max: 220, step: 5, value: st.height, format: (v) => `${v} px`, onInput: (v) => upd({ height: v }) })),
    h('div', { class: 'grid-2' },
      rangeField('Quiet zone', { min: 0, max: 40, step: 2, value: st.margin, format: (v) => `${v} px`, onInput: (v) => upd({ margin: v }), hint: 'Blank space around the bars. Scanners need some.' }),
      rangeField('Text size', { min: 10, max: 32, step: 1, value: st.fontSize, format: (v) => `${v} px`, onInput: (v) => upd({ fontSize: v }) })),
    h('div', { class: 'grid-2' },
      field('Bars', h('input', { type: 'color', value: st.fg, 'aria-label': 'Bar color', oninput: (e) => upd({ fg: e.target.value }) })),
      field('Background', h('input', { type: 'color', value: st.bg, 'aria-label': 'Background color', oninput: (e) => upd({ bg: e.target.value }) }))),
    h('div', { class: 'row' }, toggle('Show the number under the bars', st.displayValue, (c) => upd({ displayValue: c })), toggle('Transparent background', st.transparent, (c) => upd({ transparent: c }))),
    note('Keep strong contrast (dark bars on a light background) so scanners can read it. Print at least 80% of the original size.'))

  // Batch
  const batchText = textarea({ rows: 5, placeholder: 'One value per line', 'aria-label': 'Values for batch', spellcheck: false })
  const batchOut = h('div')
  const batchProg = progress()
  const batchBtn = button('Download all as ZIP', { icon: 'archive', onClick: () => busy(batchBtn, async () => {
    clear(batchOut)
    const lines = batchText.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 200)
    if (!lines.length) throw new Error('Add at least one value, one per line.')
    const f = FORMATS[format]
    const entries = [], bad = []
    for (let i = 0; i < lines.length; i++) {
      const r = f.check(lines[i])
      if (!r.value) { bad.push(`${lines[i]}: ${r.error || 'empty'}`); continue }
      const svg = await makeSvg(r.value, format)
      const w = parseFloat(svg.getAttribute('width')), hh = parseFloat(svg.getAttribute('height'))
      const c = await svgToCanvas(new XMLSerializer().serializeToString(svg), w * 3, hh * 3)
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'))
      entries.push({ name: `${String(i + 1).padStart(3, '0')}-${slug(r.value)}.png`, data: blob })
      batchProg.set((i + 1) / lines.length, `Drawing ${i + 1} of ${lines.length}`)
    }
    if (!entries.length) throw new Error(`None of the values are valid ${f.label} codes. ${bad[0] || ''}`)
    const blob = await zip(entries)
    download(blob, `barcodes-${f.label.toLowerCase().replace(/\W+/g, '')}.zip`)
    clear(batchOut, alert(bad.length ? 'warn' : 'success', `${entries.length} barcodes saved.`, bad.length ? [` Skipped ${bad.length}: `, bad.slice(0, 3).join('; ')] : ''))
  }, { label: 'Building', errorTo: batchOut, progress: batchProg }) })

  const left = h('div', { class: 'stack' },
    h('section', { class: 'panel stack' }, h('div', { class: 'wt-kicker' }, 'Barcode type'), fmtBox,
      field('Value', value, null), hint,
      h('div', { class: 'row' }, button('Fill an example', { icon: 'wand-sparkles', variant: 'ghost', size: 'sm', onClick: () => { value.value = FORMATS[format].example; render() } }), button('Clear', { icon: 'eraser', variant: 'ghost', size: 'sm', onClick: () => { value.value = ''; render(); value.focus() } }))),
    h('section', { class: 'panel' }, h('h2', h('span', { class: 'row', style: 'gap:8px' }, icon('sliders-horizontal'), 'Look')), style),
    h('details', { class: 'panel' }, h('summary', { style: 'cursor:pointer;font-weight:600;min-height:32px;display:flex;align-items:center' }, 'Make many at once'),
      h('div', { class: 'stack', style: 'margin-top:12px' }, batchText, h('div', { class: 'row' }, batchBtn), batchProg.el, batchOut)))
  const right = h('div', { class: 'stack sticky' }, h('div', { class: 'panel flush' }, stage),
    h('div', { class: 'panel stack' }, meta, h('div', { class: 'actions' }, pngBtn, svgBtn, copyBtn, valBtn), h('div', { class: 'row', style: 'justify-content:center' }, h('span', { class: 'small muted' }, 'PNG size'), scaleSel), status))
  root.append(h('div', { class: 't-bc' }, split(left, right, 'wide-left')))
  renderFormats()
  hint.textContent = FORMATS[format].use
  value.placeholder = FORMATS[format].sub
  setActs(false)
  render()
  signal?.addEventListener('abort', () => { token++ })
}
