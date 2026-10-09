// Page numbers (params.mode = 'numbers') and header & footer text (params.mode = 'headerfooter'): one stamping engine, two focused tools.
import { h, icon, busy, progress, input, number, field, button, select, toggle, rangeField, formatBytes } from '../../lib/ui.js'
import { savePdf } from '../../lib/pdf.js'
import { baseName } from '../../lib/files.js'
import { pdfLib } from '../../lib/libs.js'
import { pdfWorkspace, showResult, outName, css, heading, pageRange, plural, dock, pageGeom } from './_shared.js'
import { createStage, pageNav } from './_overlay.js'
import { stamper, previewLayer, cssFont, canvasWidth, FAMILIES } from './_stamp.js'

const CSS = `
.pe-pos6 { display: grid; grid-template-columns: repeat(3, 44px); gap: 5px; }
.pe-pos6 button { height: 34px; border-radius: 9px; border: 1.5px solid var(--border); background: var(--surface); cursor: pointer; display: grid; place-items: center; padding: 0; transition: all .2s var(--spring); }
.pe-pos6 button::after { content: ""; width: 14px; height: 4px; border-radius: 3px; background: var(--border-strong); transition: all .2s; }
.pe-pos6 button:hover { border-color: var(--accent); transform: translateY(-1px); }
.pe-pos6 button[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); }
.pe-pos6 button[aria-pressed="true"]::after { background: var(--accent); width: 18px; }
.pe-pos6 .pe-sheet { grid-column: 1 / -1; height: 0; }
.pe-tokens { display: flex; flex-wrap: wrap; gap: 6px; }
.pe-tokens button { height: 32px; padding: 0 10px; border-radius: 99px; border: 1px dashed var(--border-strong); background: var(--surface); font: 12.5px var(--mono); cursor: pointer; color: var(--text-2); transition: all .2s; }
.pe-tokens button:hover { border-style: solid; border-color: var(--accent); color: var(--accent); }
.pe-hf { display: grid; gap: 10px; }
.pe-hf-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
@media (max-width: 560px) { .pe-hf-row { grid-template-columns: minmax(0, 1fr); } }
.pe-prevwrap { display: flex; flex-direction: column; gap: 10px; align-items: center; min-width: 0; }
@media (min-width: 901px) { .pe-prevwrap.pe-sticky { position: sticky; top: calc(var(--header-h) + 16px); } }
`

const ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
/** 4 -> 'iv' (lower case). 0 or less gives the plain number. */
export function roman(n) { if (n < 1 || n > 3999) return String(n); let s = ''; for (const [v, r] of ROMAN) while (n >= v) { s += r; n -= v } return s }
/** 1 -> A, 26 -> Z, 27 -> AA */
export function alpha(n) { let s = ''; while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) } return s || String(n) }

/** Fill {n}, {n:6}, {total}, {roman}, {ROMAN}, {alpha}, {date}, {time}, {filename}, {title} in a template. */
export function expand(tpl, ctx) {
  return tpl.replace(/\{(n|total|roman|ROMAN|alpha|date|time|filename|title)(?::(\d+))?\}/g, (_, k, pad) => {
    const num = k === 'total' ? ctx.total : ctx.n
    switch (k) {
      case 'n': case 'total': return pad ? String(num).padStart(+pad, '0') : String(num)
      case 'roman': return roman(ctx.n)
      case 'ROMAN': return roman(ctx.n).toUpperCase()
      case 'alpha': return alpha(ctx.n)
      case 'date': return ctx.date
      case 'time': return ctx.time
      case 'filename': return ctx.filename
      default: return ctx.title
    }
  })
}
const DATE_FORMATS = {
  medium: (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
  long: (d) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
  dmy: (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`,
  iso: (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
}
const PRESETS = [['{n}', '1'], ['Page {n}', 'Page 1'], ['Page {n} of {total}', 'Page 1 of 10'], ['{n} / {total}', '1 / 10'], ['- {n} -', '- 1 -'], ['{roman}', 'i, ii, iii'], ['{ROMAN}', 'I, II, III'], ['{alpha}', 'A, B, C'], ['bates', 'Bates (prefix + 000001)'], ['custom', 'Custom...']]

export function mount(root, { params }) {
  const numbers = params.mode !== 'headerfooter'
  css('pe-pagestamp', CSS)
  pdfWorkspace(root, {
    label: numbers ? 'Drop a PDF to number' : 'Drop a PDF to add a header or footer',
    icon: numbers ? 'list-ordered' : 'panel-top',
    async onLoad(src, ws) {
      const total = src.numPages
      const result = h('div'), prog = progress()
      const meta = await src.pdf.getMetadata().catch(() => ({ info: {} }))
      const fixed = { filename: baseName(src.name), title: meta.info?.Title || baseName(src.name) }
      let pos = 'bc'

      const family = select(Object.keys(FAMILIES), 'Helvetica', () => redraw())
      const size = rangeField('Text size', { min: 6, max: 36, value: numbers ? 11 : 10, format: (v) => `${v} pt`, onInput: () => redraw() })
      const margin = rangeField('Distance from the edge', { min: 8, max: 90, value: 30, format: (v) => `${v} pt`, onInput: () => redraw() })
      const color = h('input', { type: 'color', class: 'input', value: '#333333', 'aria-label': 'Text colour', oninput: () => redraw() })
      const mirror = toggle(numbers ? 'Alternate left and right on even pages (double-sided printing)' : 'Swap left and right on even pages (double-sided printing)', false, () => redraw())
      const range = pageRange(total, { label: 'Pages', onChange: () => redraw() })
      const btn = button(numbers ? 'Add page numbers' : 'Add header and footer', { icon: numbers ? 'list-ordered' : 'panel-top', variant: 'primary', onClick: () => run() })
      const bar = dock({ actions: [btn] })

      // ---- numbers-only controls ----
      const fmt = select(PRESETS.map(([v, l]) => [v, l]), '{n}', () => { syncUi(); redraw() })
      const custom = input({ value: 'Page {n} of {total}', 'aria-label': 'Custom format', oninput: () => redraw() })
      const prefix = input({ value: 'DOC-', 'aria-label': 'Prefix', oninput: () => redraw() })
      const digits = number(6, { min: 1, max: 12, step: 1, ariaLabel: 'Digits', onInput: () => redraw() })
      const first = number(1, { min: 1, max: total, step: 1, ariaLabel: 'First page to number', onInput: () => redraw() })
      const last = number(total, { min: 1, max: total, step: 1, ariaLabel: 'Last page to number', onInput: () => redraw() })
      const startAt = number(1, { step: 1, ariaLabel: 'Start numbering at', onInput: () => redraw() })
      const customBox = field('Format', custom, 'Use {n}, {total}, {roman}, {ROMAN}, {alpha}. Example: Page {n} of {total}.')
      const batesBox = h('div', { class: 'grid-2' }, field('Prefix', prefix), field('Digits', digits))
      const posNames = [['tl', 'Top left'], ['tc', 'Top centre'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['bc', 'Bottom centre'], ['br', 'Bottom right']]
      const posBtns = posNames.map(([p, label]) => h('button', { type: 'button', 'aria-label': label, title: label, 'aria-pressed': String(p === pos), onclick: () => { pos = p; posBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(posNames[i][0] === pos))); redraw() } }))
      const posBox = field('Position', h('div', { class: 'pe-pos6', role: 'group', 'aria-label': 'Position on the page' }, posBtns))

      // ---- header/footer-only controls ----
      const cells = ['hl', 'hc', 'hr', 'fl', 'fc', 'fr'].map((k) => input({ 'aria-label': { hl: 'Header left', hc: 'Header centre', hr: 'Header right', fl: 'Footer left', fc: 'Footer centre', fr: 'Footer right' }[k], placeholder: { hl: 'Left', hc: 'Centre', hr: 'Right', fl: 'Left', fc: 'Centre', fr: 'Right' }[k], oninput: () => redraw(), onfocus: (e) => { lastCell = e.target } }))
      cells[1].value = '{title}'; cells[4].value = 'Page {n} of {total}'; cells[5].value = '{date}'
      let lastCell = cells[4]
      const dateFmt = select([['medium', '9 Oct 2026'], ['long', 'October 9, 2026'], ['dmy', '09/10/2026'], ['iso', '2026-10-09']], 'medium', () => redraw())
      const skipFirst = toggle('Leave the first page clean (cover page)', false, () => redraw())
      const rule = toggle('Draw a thin line under the header and above the footer', false, () => redraw())
      const tokens = h('div', { class: 'pe-tokens' }, ['{n}', '{total}', '{date}', '{time}', '{title}', '{filename}'].map((t) => h('button', { type: 'button', onclick: () => { const el = lastCell; const s = el.selectionStart ?? el.value.length; el.value = el.value.slice(0, s) + t + el.value.slice(el.selectionEnd ?? s); el.focus(); el.setSelectionRange(s + t.length, s + t.length); redraw() } }, t)))
      const hfBox = h('div', { class: 'pe-hf' }, h('div', { class: 'pe-sub-h' }, 'Header'), h('div', { class: 'pe-hf-row' }, cells.slice(0, 3)), h('div', { class: 'pe-sub-h' }, 'Footer'), h('div', { class: 'pe-hf-row' }, cells.slice(3)), tokens)

      const stage = createStage({ pdf: src.pdf, maxWidth: 520 })
      let page = 1
      const nav = pageNav(total, async (n) => { page = n; await stage.show(n) })

      const read = () => ({ family: family.value, bold: false, italic: false, size: size.input.valueAsNumber, color: color.value, margin: margin.input.valueAsNumber })
      const fmtString = () => (fmt.value === 'custom' ? custom.value : fmt.value === 'bates' ? `${prefix.value}{n:${Math.max(1, Math.min(12, digits.valueAsNumber || 6))}}` : fmt.value)
      /** The text lines for page p (1-based): [{text, align, u, v}] in displayed points, or [] when the page is skipped. */
      function lines(p, pw, ph) {
        const o = read()
        let pages
        try { pages = range.pages() } catch { return [] }
        const now = new Date()
        const base = { date: DATE_FORMATS[dateFmt.value](now), time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), ...fixed }
        const out = []
        const even = p % 2 === 0
        const flip = mirror.input.checked && even
        const sideOf = (c) => (flip && c !== 'c' ? (c === 'l' ? 'r' : 'l') : c)
        const place = (c, text, vtop) => { const side = sideOf(c); const u = side === 'l' ? o.margin : side === 'r' ? pw - o.margin : pw / 2; out.push({ text, align: side === 'l' ? 'left' : side === 'r' ? 'right' : 'center', u, v: vtop }) }
        if (numbers) {
          const f = Math.max(1, Math.min(total, Math.round(first.valueAsNumber) || 1)), l = Math.max(f, Math.min(total, Math.round(last.valueAsNumber) || total))
          if (!pages.includes(p) || p < f || p > l) return []
          const s = Number.isFinite(startAt.valueAsNumber) ? Math.round(startAt.valueAsNumber) : 1
          const n = s + (p - f)
          const text = expand(fmtString(), { n, total: s + (l - f), ...base })
          place(pos[1], text, pos[0] === 't' ? o.margin : ph - o.margin - o.size)
        } else {
          if (!pages.includes(p) || (skipFirst.input.checked && p === 1)) return []
          const ctx = { n: p, total, ...base }
          ;[['hl', 'l', o.margin], ['hc', 'c', o.margin], ['hr', 'r', o.margin], ['fl', 'l', ph - o.margin - o.size], ['fc', 'c', ph - o.margin - o.size], ['fr', 'r', ph - o.margin - o.size]].forEach(([k, c, v], i) => { const t = cells[i].value; if (t.trim()) place(c, expand(t, ctx), v) })
        }
        return out
      }
      const preview = previewLayer(stage, (ctx, st) => {
        const o = read()
        const ls = lines(st.page, st.pw, st.ph)
        ctx.fillStyle = o.color; ctx.font = cssFont(o, o.size); ctx.textBaseline = 'alphabetic'
        for (const l of ls) { ctx.textAlign = l.align; ctx.fillText(l.text, l.u, l.v + o.size * 0.8) }
        if (!numbers && rule.input.checked && ls.length) {
          ctx.strokeStyle = o.color; ctx.globalAlpha = 0.5; ctx.lineWidth = 0.6
          if (ls.some((l) => l.v < st.ph / 2)) { const y = o.margin + o.size + 4; ctx.beginPath(); ctx.moveTo(o.margin, y); ctx.lineTo(st.pw - o.margin, y); ctx.stroke() }
          if (ls.some((l) => l.v >= st.ph / 2)) { const y = st.ph - o.margin - o.size - 4; ctx.beginPath(); ctx.moveTo(o.margin, y); ctx.lineTo(st.pw - o.margin, y); ctx.stroke() }
          ctx.globalAlpha = 1
        }
      })
      function redraw() { preview.redraw(); update() }
      function syncUi() { if (numbers) { customBox.hidden = fmt.value !== 'custom'; batesBox.hidden = fmt.value !== 'bates' } }
      function update() {
        const err = range.error()
        let n = 0
        try { for (let p = 1; p <= total; p++) if (lines(p, 600, 800).length) n++ } catch { /* ignore */ }
        btn.disabled = !!err || n === 0
        bar.text(err || (n === 0 ? (numbers ? 'No pages to number with these settings.' : 'Type some header or footer text.') : h('span', numbers ? 'Numbers go on ' : 'Text goes on ', h('b', plural(n, 'page')), '.')))
      }

      async function run() {
        await busy(btn, async () => {
          prog.set(0, 'Stamping')
          const o = read()
          const doc = await src.edit()
          const st = await stamper(doc, o)
          const pages = doc.getPages()
          let done = 0
          for (let p = 1; p <= total; p++) {
            const g = pageGeom(pages[p - 1])
            const ls = lines(p, g.width, g.height)
            if (!ls.length) continue
            for (const l of ls) await st.drawText(pages[p - 1], l.text, { u: l.u, v: l.v, size: o.size, align: l.align, color: o.color })
            if (!numbers && rule.input.checked) {
              const { rgb } = await pdfLib()
              const pg = pages[p - 1]
              const line = (v) => { const a = g.toPdf(o.margin, v), b = g.toPdf(g.width - o.margin, v); pg.drawLine({ start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, thickness: 0.6, color: rgb(0.2, 0.2, 0.2), opacity: 0.5 }) }
              if (ls.some((l) => l.v < g.height / 2)) line(o.margin + o.size + 4)
              if (ls.some((l) => l.v >= g.height / 2)) line(g.height - o.margin - o.size - 4)
            }
            done++
            prog.set(p / total, `Page ${p} of ${total}`)
            if (p % 5 === 0) await new Promise((r) => setTimeout(r, 0))
          }
          const blob = await savePdf(doc)
          await showResult(result, {
            blob, name: outName(src.file, numbers ? 'numbered' : 'header-footer'), title: numbers ? 'Page numbers added' : 'Header and footer added', lead: `${plural(done, 'page')} stamped. The new text is real, selectable text.`,
            facts: [{ label: 'Pages stamped', value: done }, { label: 'Pages', value: total }, { label: 'File size', value: formatBytes(blob.size) }], again: ws.reset,
          })
        }, { label: 'Stamping', errorTo: result, progress: prog })
      }

      stage.show(1).then(() => redraw())
      syncUi(); update()
      const common = h('div', { class: 'stack' }, h('div', { class: 'grid-2' }, field('Font', family), field('Colour', color)), size, margin, mirror, range)
      const panel = numbers
        ? h('section', { class: 'panel stack' }, heading('hash', 'Numbering'), field('Format', fmt), customBox, batesBox, h('div', { class: 'grid-3' }, field('First page', first), field('Last page', last), field('Start at', startAt)), posBox, common)
        : h('section', { class: 'panel stack' }, heading('panel-top', 'Header and footer'), hfBox, field('Date style', dateFmt), skipFirst, rule, common)
      return [h('div', { class: 'tool-split wide-right' }, panel, h('div', { class: 'pe-prevwrap pe-sticky' }, nav, stage.el)), prog.el, result, bar]
    },
  })
}
