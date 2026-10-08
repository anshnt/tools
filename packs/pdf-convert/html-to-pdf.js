// HTML to PDF. Paste or upload HTML, see it laid out live in a sandboxed preview, then save a paginated PDF (searchable text layer, working
// links) or use the browser's own print engine for real vector text. Scripts in the HTML are never run.
import { h, button, busy, progress, alert, segmented, select, rangeField, toggle, field, textarea, input, dropzone, split, clear, download, debounce, onCleanup, formatBytes, icon } from '../../lib/ui.js'
import { baseName } from '../../lib/files.js'
import { load, save } from '../../lib/store.js'
import { useStyles, flow, step, options, done, note, plural, secs, readTextFile } from './_shared.js'
import { makeFrame, paginate, printFrame, MM, PX } from './_paginate.js'
import { PAGE_SIZES } from '../../lib/pdf.js'

const CSS = `
.t-htp .editor { min-height: 330px; font-size: 13px; }
.t-htp .pvwrap { position: relative; border: 1px solid var(--border); border-radius: var(--radius-lg); background: #fff; overflow: hidden; box-shadow: var(--shadow-sm); }
.t-htp .pvwrap iframe { display: block; border: 0; background: #fff; transform-origin: 0 0; pointer-events: none; }
.t-htp .pvbar { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted); margin-bottom: 8px; flex-wrap: wrap; }
.t-htp .pvbar b { color: var(--text-2); }
`

export const SAMPLE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Invoice</title>
<style>
  body { font-family: "Segoe UI", Helvetica, Arial, sans-serif; color: #1c2430; }
  .hero { background: linear-gradient(120deg, #4f46e5, #c026d3); color: #fff; padding: 28px 32px; border-radius: 14px; }
  .hero h1 { margin: 0 0 4px; font-size: 30px; letter-spacing: -.02em; } .hero p { margin: 0; opacity: .85; }
  .grid { display: flex; gap: 24px; margin: 22px 0; } .grid div { flex: 1; }
  .label { text-transform: uppercase; font-size: 11px; letter-spacing: .08em; color: #6b7280; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; background: #f3f4f6; padding: 10px; font-size: 13px; } td { padding: 10px; border-bottom: 1px solid #e5e7eb; }
  td.num, th.num { text-align: right; } .total { font-size: 20px; font-weight: 700; text-align: right; margin-top: 16px; }
  .pill { display: inline-block; background: #dcfce7; color: #166534; padding: 3px 10px; border-radius: 99px; font-size: 12px; font-weight: 600; }
  a { color: #4f46e5; }
</style></head>
<body>
  <div class="hero"><h1>Invoice #2025-0142</h1><p>Acme Studio, Pune · <span class="pill">Paid</span></p></div>
  <div class="grid">
    <div><div class="label">Billed to</div><strong>Priya Shah</strong><br>12 MG Road, Bengaluru</div>
    <div><div class="label">Issued</div>12 March 2025</div>
    <div><div class="label">Due</div>26 March 2025</div>
  </div>
  <table>
    <tr><th>Item</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr>
    <tr><td>Brand identity design</td><td class="num">1</td><td class="num">45,000</td><td class="num">45,000</td></tr>
    <tr><td>Website, 5 pages</td><td class="num">1</td><td class="num">60,000</td><td class="num">60,000</td></tr>
    <tr><td>Monthly hosting</td><td class="num">12</td><td class="num">800</td><td class="num">9,600</td></tr>
  </table>
  <div class="total">Total: Rs 1,14,600</div>
  <p>Questions? Write to <a href="https://example.com/contact">example.com/contact</a>. Thank you for your business.</p>
</body></html>`

const LAYOUTS = [['fit', 'Fit the page'], ['1280', 'Desktop 1280'], ['820', 'Tablet 820'], ['390', 'Phone 390']]
const SIZES = [['A4', 'A4'], ['Letter', 'US Letter'], ['Legal', 'US Legal'], ['A3', 'A3'], ['A5', 'A5'], ['long', 'One long page']]

/** Wrap a fragment or inject the margin reset into a full document. */
export function wrapHtml(src) {
  const reset = '<style data-cv>html,body{margin:0}</style>'
  if (/<html[\s>]|<!doctype/i.test(src)) {
    if (/<head[^>]*>/i.test(src)) return src.replace(/<head[^>]*>/i, (m) => `${m}${reset}`)
    return src.replace(/<html[^>]*>/i, (m) => `${m}<head>${reset}</head>`)
  }
  return `<!doctype html><html><head><meta charset="utf-8">${reset}<style>body{font:16px/1.55 "Segoe UI",Helvetica,Arial,sans-serif;color:#1c2430;background:#fff}img{max-width:100%}</style></head><body>${src}</body></html>`
}

export function mount(root, { signal }) {
  useStyles({ id: 'htp', css: CSS })
  const S = { size: 'A4', orient: 'portrait', margin: 12, layout: 'fit', scale: 2, pageNumbers: false, title: '' }
  const fl = flow('html', 'pdf')
  const prog = progress()
  const result = h('div', { class: 'stack' })
  let fileName = 'page'

  const ta = textarea({ class: 'editor', mono: true, rows: 14, placeholder: '<h1>Paste your HTML here</h1>\n<p>Styles in a <style> tag, inline styles and embedded images all work.</p>', value: load('html-to-pdf:src', ''), 'aria-label': 'HTML source', spellcheck: false })
  const zone = dropzone({ accept: '.html,.htm,.xhtml,.svg,text/html', compact: true, label: 'Or drop an .html file here', hint: 'Single-file HTML works best. Relative images and CSS next to the file cannot be read.', onFiles: async ([f]) => { ta.value = await readTextFile(f); fileName = baseName(f.name); onChange() } })
  const sampleBtn = button('Try an example', { icon: 'wand-sparkles', variant: 'secondary', size: 'sm', onClick: () => { ta.value = SAMPLE; fileName = 'invoice'; onChange() } })
  const clearBtn = button('Clear', { icon: 'eraser', variant: 'ghost', size: 'sm', onClick: () => { ta.value = ''; onChange(); ta.focus() } })

  const sizeSel = select(SIZES, S.size, (v) => { S.size = v; sync(); updatePreview() })
  const orientSeg = segmented([['portrait', 'Portrait'], ['landscape', 'Landscape']], S.orient, (v) => { S.orient = v; updatePreview() }, 'Orientation')
  const marginR = rangeField('Margins', { min: 0, max: 30, step: 1, value: S.margin, format: (v) => `${v} mm`, onInput: (v) => { S.margin = v; updatePreview() } })
  const layoutSel = select(LAYOUTS, S.layout, (v) => { S.layout = v; updatePreview() })
  const qualSeg = segmented([[2, 'Standard'], [3, 'Sharp']], S.scale, (v) => { S.scale = +v }, 'Quality')
  const numTog = toggle('Page numbers', S.pageNumbers, (v) => { S.pageNumbers = v })
  const titleIn = input({ placeholder: 'Optional PDF title', 'aria-label': 'PDF title', oninput: (e) => { S.title = e.target.value } })
  function sync() { orientSeg.closest('.field').hidden = S.size === 'long'; numTog.hidden = S.size === 'long' }

  // ----- live preview (sandboxed iframe scaled to fit)
  const prevFrame = h('iframe', { sandbox: 'allow-same-origin', title: 'HTML preview', tabindex: -1 })
  const wrap = h('div', { class: 'pvwrap' }, prevFrame)
  const pvInfo = h('div', { class: 'pvbar' })
  const dims = () => {
    const [bw, bh] = PAGE_SIZES[S.size === 'long' ? 'A4' : S.size]
    const [W, Hh] = S.orient === 'landscape' && S.size !== 'long' ? [bh, bw] : [bw, bh]
    const m = S.margin * MM
    const pxW = Math.ceil((W - 2 * m) * PX)
    const L = S.layout === 'fit' ? pxW : +S.layout
    return { W, H: Hh, m, pxW, L }
  }
  const updatePreview = debounce(() => {
    const d = dims()
    const L = d.L
    const w = wrap.clientWidth || 600
    const k = Math.min(1.5, w / (L + 2 * d.m * PX))
    prevFrame.style.width = `${L}px`
    prevFrame.style.height = `${Math.round(Math.max(260, 520 / k))}px`
    prevFrame.style.transform = `scale(${k})`
    const pad = Math.round(d.m * PX * k)
    wrap.style.padding = `${pad}px`
    wrap.style.height = `${Math.round(Math.max(260, 520 / k) * k) + 2 * pad}px`
    prevFrame.srcdoc = ta.value.trim() ? wrapHtml(ta.value) : '<!doctype html><body style="font:14px system-ui;color:#888;display:grid;place-items:center;height:90vh">Your page appears here</body>'
    clear(pvInfo, h('b', 'Live preview'), `${L}px wide layout`, h('span', { class: 'cv-sub' }, '· scripts are not run'))
  }, 250)
  const onChange = () => { save('html-to-pdf:src', ta.value.length < 300_000 ? ta.value : ''); downloadBtn.disabled = printBtn.disabled = !ta.value.trim(); updatePreview() }
  ta.addEventListener('input', onChange)
  addEventListener('resize', updatePreview)
  onCleanup(() => removeEventListener('resize', updatePreview))

  const downloadBtn = button('Download PDF', { icon: 'download', variant: 'primary', size: 'lg', disabled: true })
  const printBtn = button('Print or save with the browser', { icon: 'printer', size: 'lg', disabled: true })
  downloadBtn.addEventListener('click', () => busy(downloadBtn, convert, { label: 'Building PDF', errorTo: result, progress: prog }))
  printBtn.addEventListener('click', async () => {
    const d = dims()
    const frame = await makeFrame(wrapHtml(ta.value), d.L)
    printFrame(frame, { size: S.size === 'long' ? 'A4' : S.size, orient: S.orient, marginMm: S.margin })
    frame.win.addEventListener('afterprint', () => frame.destroy(), { once: true })
    setTimeout(() => frame.destroy(), 120_000)
  })

  async function convert() {
    clear(result)
    fl.state('working')
    const t0 = performance.now()
    const d = dims()
    const frame = await makeFrame(wrapHtml(ta.value), d.L)
    try {
      const r = await paginate(frame.doc.documentElement, {
        size: S.size === 'long' ? 'A4' : S.size, orient: S.orient, margin: { t: d.m, r: d.m, b: d.m, l: d.m }, scale: S.scale, layoutPx: d.L, singlePage: S.size === 'long',
        pageNumbers: S.pageNumbers, title: S.title || fileName, onProgress: (f, t) => prog.set(f, t), signal,
      })
      const blob = new Blob([r.bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      onCleanup(() => URL.revokeObjectURL(url))
      done(result, {
        flowEl: fl, title: 'Your PDF is ready', text: 'Pages are images with an invisible text layer, so you can search and select text. Use the browser print option for pure vector text.',
        stats: [plural(r.pages, 'page'), `${r.words.toLocaleString()} words searchable`, r.links ? plural(r.links, 'link') : null, formatBytes(blob.size), secs(performance.now() - t0)].filter(Boolean),
        actions: [button('Download PDF', { icon: 'download', variant: 'primary', size: 'lg', onClick: () => download(blob, `${fileName}.pdf`) }), button('Preview', { icon: 'external-link', onClick: () => window.open(url, '_blank', 'noopener') })],
      })
    } catch (e) { fl.state('idle'); throw e } finally { frame.destroy() }
  }

  const s1 = step(1, 'Your HTML', h('div', { class: 'stack' }, ta, h('div', { class: 'row between' }, h('div', { class: 'row' }, sampleBtn, clearBtn), h('span', { class: 'cv-sub' }, 'Saved in this browser only')), zone))
  const s2 = step(2, 'Page and preview', split(h('div', { class: 'stack' }, options(field('Page size', sizeSel), field('Orientation', orientSeg), marginR, field('Layout width', layoutSel, 'Desktop widths are scaled down to fit the page.'), field('Quality', qualSeg), field('Title', titleIn)), numTog),
    h('div', pvInfo, wrap), 'wide-left'))
  const s3 = step(3, 'Create the PDF', h('div', { class: 'stack' }, h('div', { class: 'row' }, downloadBtn, printBtn), note('Your HTML is not uploaded and scripts in it never run. Anything it links to (images, fonts, styles) is fetched from that site and may be blocked, so embedded resources work best.', 'shield-check'), prog.el, result))
  sync()
  root.append(h('div', { class: 'cv t-htp' }, fl, s1, s2, s3))
  onChange()
}
