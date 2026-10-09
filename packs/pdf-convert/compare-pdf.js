// Compare two PDFs. Pages are matched by content (so an inserted page does not shift everything), then each pair gets a word-level text diff and a
// pixel diff with highlighted change boxes. Views: differences, side by side, swipe slider and blend. Everything is computed on your device.
import { h, button, busy, progress, alert, segmented, toggle, rangeField, field, clear, download, debounce, onCleanup, formatBytes, formatNumber, yieldToMain, icon, stats } from '../../lib/ui.js'
import { diff as diffLib } from '../../lib/libs.js'
import { renderPage, pageSize } from '../../lib/pdf.js'
import { baseName } from '../../lib/files.js'
import { buildLines, analyze, blocksToText, pageReader } from './_layout.js'
import { createPdfBuilder, canvasSlice } from './_paginate.js'
import { useStyles, flow, step, options, pdfSource, done, chip, note, plural, secs, beforeAfter, checkAbort } from './_shared.js'

const CSS = `
.t-cmp .pair { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 14px; align-items: center; }
.t-cmp .pair .lbl { font-size: 12.5px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; display: flex; gap: 6px; align-items: center; }
.t-cmp .pair .lbl b { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 6px; color: #fff; font-size: 11px; background: var(--accent); } .t-cmp .pair .lbl b.b { background: var(--accent-2); }
.t-cmp .swap { align-self: center; }
.t-cmp .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 10px; }
.t-cmp .tile { padding: 13px 14px; border-radius: 16px; border: 1px solid var(--border); background: var(--surface); animation: rise .5s var(--ease) both; animation-delay: calc(var(--i, 0) * 50ms); }
.t-cmp .tile .v { font-size: 26px; font-weight: 650; letter-spacing: -.03em; font-variant-numeric: tabular-nums; } .t-cmp .tile .l { font-size: 12.5px; color: var(--muted); }
.t-cmp .tile.same .v { color: var(--success); } .t-cmp .tile.chg .v { color: var(--warning); } .t-cmp .tile.add .v { color: var(--info); } .t-cmp .tile.del .v { color: var(--danger); }
.t-cmp .strip { display: flex; gap: 8px; overflow-x: auto; padding: 4px 2px 10px; scroll-snap-type: x proximity; }
.t-cmp .pg { flex: none; scroll-snap-align: start; min-width: 64px; padding: 8px 10px; border-radius: 14px; border: 1.5px solid var(--border); background: var(--surface); cursor: pointer; font: inherit; color: var(--text-2); display: flex; flex-direction: column; gap: 3px; align-items: center; font-size: 12px; transition: transform .25s var(--spring), border-color .2s; }
.t-cmp .pg:hover { transform: translateY(-3px); } .t-cmp .pg b { font-size: 15px; font-variant-numeric: tabular-nums; }
.t-cmp .pg i { width: 8px; height: 8px; border-radius: 50%; background: var(--success); } .t-cmp .pg.chg i { background: var(--warning); } .t-cmp .pg.add i { background: var(--info); } .t-cmp .pg.del i { background: var(--danger); }
.t-cmp .pg[aria-current="true"] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.t-cmp .view { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); padding: 14px; }
.t-cmp .vbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
.t-cmp .canv { background: var(--surface-2); border-radius: 12px; overflow: hidden; display: grid; place-items: center; border: 1px solid var(--border); }
.t-cmp .canv canvas { display: block; max-width: 100%; height: auto; }
.t-cmp .two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; } .t-cmp .two > div { min-width: 0; }
.t-cmp .paper { border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; background: var(--surface); font-size: 14.5px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 520px; overflow: auto; }
.t-cmp ins { background: color-mix(in srgb, var(--success) 24%, transparent); text-decoration: none; border-radius: 4px; padding: 0 2px; }
.t-cmp del { background: color-mix(in srgb, var(--danger) 22%, transparent); border-radius: 4px; padding: 0 2px; }
.t-cmp .onion { position: relative; display: grid; } .t-cmp .onion canvas { grid-area: 1 / 1; }
.t-cmp .legend { display: flex; gap: 14px; font-size: 12px; color: var(--muted); flex-wrap: wrap; } .t-cmp .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
@media (max-width: 720px) { .t-cmp .pair { grid-template-columns: minmax(0, 1fr); } .t-cmp .swap { justify-self: center; } .t-cmp .two { grid-template-columns: minmax(0, 1fr); } }
`

const norm = (t, o) => { let s = t; if (o.ignoreCase) s = s.toLowerCase(); if (o.ignoreSpace) s = s.replace(/\s+/g, ' ').trim(); return s }
const words = (t) => t.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []
function jaccard(wa, wb) {
  if (!wa.size && !wb.size) return 1
  let inter = 0
  for (const w of wa) if (wb.has(w)) inter++
  return inter / (wa.size + wb.size - inter)
}

/** Match pages of A to pages of B by content (monotonic, like a diff of pages). -> [[aIndex|null, bIndex|null], ...] */
export function alignPages(ta, tb, { threshold = 0.4, band = 40 } = {}) {
  const n = ta.length, m = tb.length
  const sa = ta.map((t) => new Set(words(t))), sb = tb.map((t) => new Set(words(t)))
  const sim = (i, j) => (Math.abs(i - j) > band + Math.abs(n - m) ? 0 : jaccard(sa[i], sb[j]))
  const dp = Array.from({ length: n + 1 }, () => new Float32Array(m + 1))
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const s = sim(i - 1, j - 1)
    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1], s >= threshold || (sa[i - 1].size === 0 && sb[j - 1].size === 0 && i === j) ? dp[i - 1][j - 1] + Math.max(s, 0.01) : -1)
  }
  const out = []
  let i = n, j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const s = sim(i - 1, j - 1)
      if ((s >= threshold || (sa[i - 1].size === 0 && sb[j - 1].size === 0 && i === j)) && Math.abs(dp[i][j] - (dp[i - 1][j - 1] + Math.max(s, 0.01))) < 1e-5) { out.push([i - 1, j - 1]); i--; j--; continue }
    }
    if (i > 0 && (j === 0 || dp[i - 1][j] >= dp[i][j - 1])) { out.push([i - 1, null]); i-- } else { out.push([null, j - 1]); j-- }
  }
  return out.reverse()
}

/** Pixel diff of two canvases (B is fitted into A's size). -> {canvas, pct, boxes, b} */
export function diffCanvases(ca, cb, { threshold = 40 } = {}) {
  const W = ca.width, H = ca.height
  const b2 = document.createElement('canvas')
  b2.width = W; b2.height = H
  const g2 = b2.getContext('2d', { willReadFrequently: true })
  g2.fillStyle = '#fff'; g2.fillRect(0, 0, W, H)
  const k = Math.min(W / cb.width, H / cb.height)
  g2.drawImage(cb, (W - cb.width * k) / 2, (H - cb.height * k) / 2, cb.width * k, cb.height * k)
  const A = ca.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H), B = g2.getImageData(0, 0, W, H)
  const out = new ImageData(W, H)
  const bs = 20, gw = Math.ceil(W / bs), gh = Math.ceil(H / bs)
  const grid = new Uint16Array(gw * gh)
  let changed = 0
  for (let p = 0, o = 0; p < W * H; p++, o += 4) {
    const ar = A.data[o], ag = A.data[o + 1], ab = A.data[o + 2], br = B.data[o], bg = B.data[o + 1], bb = B.data[o + 2]
    const la = 0.299 * ar + 0.587 * ag + 0.114 * ab, lb = 0.299 * br + 0.587 * bg + 0.114 * bb
    const d = Math.max(Math.abs(ar - br), Math.abs(ag - bg), Math.abs(ab - bb))
    const base = 255 - (255 - la) * 0.4
    if (d > threshold) {
      changed++
      grid[Math.floor(p / W / bs) * gw + Math.floor((p % W) / bs)]++
      const [r, gg, bl] = la < lb - threshold * 0.5 ? [239, 68, 68] : lb < la - threshold * 0.5 ? [34, 197, 94] : [245, 158, 11]
      out.data[o] = r; out.data[o + 1] = gg; out.data[o + 2] = bl
    } else { out.data[o] = out.data[o + 1] = out.data[o + 2] = base }
    out.data[o + 3] = 255
  }
  // group changed blocks into boxes
  const seen = new Uint8Array(gw * gh), boxes = []
  for (let s = 0; s < gw * gh; s++) {
    if (seen[s] || grid[s] < 6) continue
    const stack = [s]
    seen[s] = 1
    let x0 = gw, y0 = gh, x1 = 0, y1 = 0
    while (stack.length) {
      const c = stack.pop(), cx = c % gw, cy = Math.floor(c / gw)
      x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue
        const ni = ny * gw + nx
        if (!seen[ni] && grid[ni] >= 3) { seen[ni] = 1; stack.push(ni) }
      }
    }
    boxes.push({ x: x0 * bs - 4, y: y0 * bs - 4, w: (x1 - x0 + 1) * bs + 8, h: (y1 - y0 + 1) * bs + 8 })
  }
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  canvas.getContext('2d').putImageData(out, 0, 0)
  return { canvas, pct: (changed / (W * H)) * 100, boxes, b: b2 }
}

export function mount(root, { signal }) {
  useStyles({ id: 'cmp', css: CSS })
  const S = { align: true, ignoreCase: false, ignoreSpace: true, sens: 40, mode: 'diff', textMode: 'inline' }
  const fl = flow('pdf', 'diff', 'Compare')
  const prog = progress()
  const out = h('div', { class: 'stack' })
  const readers = { a: pageReader(() => A.doc), b: pageReader(() => B.doc) }
  let pairs = [], sel = 0, texts = { a: [], b: [] }, token = 0
  const coarse = new Map()
  const A = pdfSource({ label: 'Drop the original PDF', hint: 'The earlier version', onLoad: () => { readers.a.clear(); coarse.clear(); ready() }, onClear: () => { reset() } })
  const B = pdfSource({ label: 'Drop the revised PDF', hint: 'The newer version', onLoad: () => { readers.b.clear(); coarse.clear(); ready() }, onClear: () => { reset() } })
  A.el.querySelector('.dropzone')?.setAttribute('aria-label', 'Choose the original PDF')
  B.el.querySelector('.dropzone')?.setAttribute('aria-label', 'Choose the revised PDF')
  function reset() { s2.lock(); s3.lock(); clear(out); pairs = []; fl.state('idle') }
  function ready() { if (A.doc && B.doc) { s2.unlock(); s3.unlock(); run() } else reset() }

  const swapBtn = button('', { icon: 'arrow-left-right', variant: 'secondary', ariaLabel: 'Swap original and revised', onClick: async () => { const fa = A.file, fb = B.file; if (!fa || !fb) return; await Promise.all([A.load(fb), B.load(fa)]) } })
  swapBtn.classList.add('swap')
  const alignTog = toggle('Match pages by content (handles inserted or removed pages)', S.align, (v) => { S.align = v; re() })
  const caseTog = toggle('Ignore upper and lower case', S.ignoreCase, (v) => { S.ignoreCase = v; re() })
  const spaceTog = toggle('Ignore spacing and line breaks', S.ignoreSpace, (v) => { S.ignoreSpace = v; re() })
  const sensR = rangeField('Visual sensitivity', { min: 15, max: 100, step: 5, value: 100 - S.sens + 15, format: (v) => (v > 75 ? 'High' : v > 45 ? 'Normal' : 'Low'), onInput: (v) => { S.sens = 115 - v; re() }, hint: 'High also marks faint colour changes.' })
  const re = debounce(() => { if (A.doc && B.doc) run() }, 350)

  async function pageTexts(side) {
    const src = side === 'a' ? A : B
    const nums = Array.from({ length: src.numPages }, (_, i) => i + 1)
    const data = await readers[side].pages(nums, { signal, onProgress: (f) => prog.set((side === 'a' ? 0 : 0.15) + f * 0.15, `Reading text of the ${side === 'a' ? 'original' : 'revised'} PDF`) })
    const a = analyze(data, { removeHeaders: false, joinPages: false, headings: false, boldHeadings: false })
    return a.pages.map((p) => blocksToText([p]))
  }

  async function coarseImage(side, n) {
    const key = `${side}${n}`
    if (!coarse.has(key)) {
      const src = side === 'a' ? A : B
      const c = await renderPage(src.doc, n, { scale: 0.7 })
      coarse.set(key, c)
    }
    return coarse.get(key)
  }

  async function run() {
    const t = ++token
    fl.state('working')
    clear(out)
    try {
      const D = await diffLib()
      const [ta, tb] = [await pageTexts('a'), await pageTexts('b')]
      if (t !== token) return
      texts = { a: ta, b: tb }
      const al = S.align ? alignPages(ta, tb) : Array.from({ length: Math.max(ta.length, tb.length) }, (_, i) => [i < ta.length ? i : null, i < tb.length ? i : null])
      pairs = []
      for (let i = 0; i < al.length; i++) {
        checkAbort(signal)
        prog.set(0.3 + 0.7 * (i / al.length), `Comparing pages (${i + 1} of ${al.length})`)
        const [ai, bi] = al[i]
        const p = { a: ai, b: bi, status: ai == null ? 'add' : bi == null ? 'del' : 'same', vis: 0, added: 0, removed: 0, parts: null }
        if (ai != null && bi != null) {
          const parts = D.diffWords(norm(ta[ai], S), norm(tb[bi], S))
          p.parts = parts
          for (const x of parts) { const n = (x.value.match(/\S+/g) || []).length; if (x.added) p.added += n; else if (x.removed) p.removed += n }
          const [ca, cb] = [await coarseImage('a', ai + 1), await coarseImage('b', bi + 1)]
          p.vis = diffCanvases(ca, cb, { threshold: S.sens }).pct
          p.status = p.added || p.removed ? 'chg' : p.vis > 0.05 ? 'vis' : 'same'
        } else if (ai != null) p.removed = (ta[ai].match(/\S+/g) || []).length
        else p.added = (tb[bi].match(/\S+/g) || []).length
        pairs.push(p)
        if (i % 3 === 2) await yieldToMain()
      }
      prog.hide()
      sel = Math.max(0, pairs.findIndex((p) => p.status !== 'same'))
      await render()
      fl.state('done')
    } catch (e) { if (t === token) { fl.state('idle'); prog.hide(); clear(out, alert('error', e.message)) } }
  }

  const label = (p) => (p.a != null && p.b != null ? (p.a === p.b ? `${p.a + 1}` : `${p.a + 1}/${p.b + 1}`) : p.a != null ? `${p.a + 1}` : `${p.b + 1}`)
  async function render() {
    const same = pairs.filter((p) => p.status === 'same').length
    const chg = pairs.filter((p) => p.status === 'chg' || p.status === 'vis').length
    const add = pairs.filter((p) => p.status === 'add').length, del = pairs.filter((p) => p.status === 'del').length
    const wAdd = pairs.reduce((a, p) => a + p.added, 0), wDel = pairs.reduce((a, p) => a + p.removed, 0)
    const totalWords = texts.a.reduce((a, t) => a + (t.match(/\S+/g) || []).length, 0) || 1
    const similarity = Math.max(0, Math.round(100 - ((wAdd + wDel) / (totalWords + wAdd)) * 100))
    const tile = (v, l, cls, i) => h('div', { class: ['tile', cls], style: { '--i': i } }, h('div', { class: 'v' }, v), h('div', { class: 'l' }, l))
    const identical = pairs.every((p) => p.status === 'same')
    const tiles = h('div', { class: 'tiles' }, tile(`${similarity}%`, 'text similarity', 'same', 0), tile(same, 'identical pages', 'same', 1), tile(chg, 'changed pages', 'chg', 2), tile(add, 'pages added', 'add', 3), tile(del, 'pages removed', 'del', 4), tile(`+${formatNumber(wAdd, 0)} / -${formatNumber(wDel, 0)}`, 'words added / removed', '', 5))
    const strip = h('div', { class: 'strip', role: 'listbox', 'aria-label': 'Pages', onkeydown: (e) => { if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1) } }, pairs.map((p, i) => h('button', { type: 'button', role: 'option', class: ['pg', p.status === 'chg' || p.status === 'vis' ? 'chg' : p.status], 'aria-current': String(i === sel), 'aria-selected': String(i === sel), onclick: () => { sel = i; show() }, title: ({ same: 'Identical', chg: 'Text changed', vis: 'Looks different', add: 'Only in the revised PDF', del: 'Only in the original PDF' })[p.status] }, h('b', label(p)), h('i'), h('span', p.status === 'same' ? 'same' : p.status === 'add' ? 'added' : p.status === 'del' ? 'removed' : p.status === 'vis' ? `${p.vis.toFixed(1)}%` : `${p.added + p.removed} words`))))
    const nextChange = (dir) => { for (let k = 1; k <= pairs.length; k++) { const j = (sel + dir * k + pairs.length * 2) % pairs.length; if (pairs[j].status !== 'same') { sel = j; show(); return } } }
    const detail = h('div', { class: 'view' })
    const exportBtn = button('Download comparison PDF', { icon: 'file-down', variant: 'primary', disabled: identical, onClick: (e) => busy(e.currentTarget, exportPdf, { label: 'Building', errorTo: out }) })
    clear(out,
      identical ? alert('success', h('strong', 'No differences found. '), 'The text and the page images match.') : null, tiles,
      h('div', { class: 'row' }, button('Previous change', { icon: 'chevron-left', size: 'sm', disabled: identical, onClick: () => nextChange(-1) }), button('Next change', { icon: 'chevron-right', size: 'sm', disabled: identical, onClick: () => nextChange(1) }), exportBtn), strip, detail)
    out._detail = detail; out._strip = strip
    await show()
  }
  const go = (d) => { sel = Math.max(0, Math.min(pairs.length - 1, sel + d)); show() }

  let viewToken = 0
  async function show() {
    const detail = out._detail
    if (!detail) return
    const t = ++viewToken
    ;[...out._strip.children].forEach((b, i) => { b.setAttribute('aria-current', String(i === sel)); b.setAttribute('aria-selected', String(i === sel)) })
    out._strip.children[sel]?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' })
    const p = pairs[sel]
    const modes = [['diff', 'Differences'], ['side', 'Side by side'], ['swipe', 'Swipe'], ['blend', 'Blend'], ['text', 'Text changes']]
    const bar = h('div', { class: 'vbar' }, segmented(modes, S.mode, (v) => { S.mode = v; show() }, 'View'),
      h('div', { class: 'cv-chips' }, p.status === 'same' ? chip('Identical', 'good', 'check') : p.status === 'add' ? chip('Only in revised', '', 'plus') : p.status === 'del' ? chip('Only in original', 'warn', 'minus') : [chip(`+${p.added} / -${p.removed} words`, 'warn', 'text'), chip(`${p.vis.toFixed(2)}% of pixels differ`, '', 'image')]))
    clear(detail, bar, h('div', { class: 'cv-sub' }, h('span', { class: 'spinner' }), ' Rendering the pages...'))
    if (S.mode === 'text') { if (t === viewToken) clear(detail, bar, textView(p)); return }
    const scale = 1.4
    const ca = p.a != null ? await renderPage(A.doc, p.a + 1, { scale }) : null
    const cbRaw = p.b != null ? await renderPage(B.doc, p.b + 1, { scale }) : null
    if (t !== viewToken) return
    let body
    if (ca && cbRaw) {
      const d = diffCanvases(ca, cbRaw, { threshold: S.sens })
      const boxes = document.createElement('canvas')
      boxes.width = d.canvas.width; boxes.height = d.canvas.height
      boxes.getContext('2d').drawImage(d.canvas, 0, 0)
      const g = boxes.getContext('2d')
      g.lineWidth = 2.5; g.strokeStyle = 'rgba(91,76,240,.9)'; g.fillStyle = 'rgba(91,76,240,.08)'
      for (const b of d.boxes) { g.fillRect(b.x, b.y, b.w, b.h); g.strokeRect(b.x, b.y, b.w, b.h) }
      if (S.mode === 'diff') body = h('div', h('div', { class: 'canv' }, boxes), h('div', { class: 'legend', style: 'margin-top:8px' }, h('span', h('i', { style: 'background:#ef4444' }), 'Only in the original'), h('span', h('i', { style: 'background:#22c55e' }), 'Only in the revised'), h('span', h('i', { style: 'background:#f59e0b' }), 'Changed colour'), h('span', h('i', { style: 'background:#5b4cf0' }), `${d.boxes.length} changed area${d.boxes.length === 1 ? '' : 's'}`)))
      else if (S.mode === 'side') body = h('div', { class: 'two' }, h('div', h('div', { class: 'cv-sub' }, 'Original'), h('div', { class: 'canv' }, ca)), h('div', h('div', { class: 'cv-sub' }, 'Revised'), h('div', { class: 'canv' }, d.b)))
      else if (S.mode === 'swipe') body = beforeAfter(ca, d.b, ['Original', 'Revised'])
      else {
        const op = rangeField('Blend', { min: 0, max: 100, value: 50, format: (v) => `${100 - v}% original / ${v}% revised`, onInput: (v) => { d.b.style.opacity = v / 100 } })
        d.b.style.opacity = 0.5
        body = h('div', { class: 'stack' }, op, h('div', { class: 'canv' }, h('div', { class: 'onion' }, ca, d.b)))
      }
    } else {
      const only = ca || cbRaw
      body = h('div', h('div', { class: 'cv-sub', style: 'margin-bottom:8px' }, ca ? 'This page is only in the original PDF.' : 'This page is only in the revised PDF.'), h('div', { class: 'canv' }, only))
    }
    clear(detail, bar, body)
  }

  function textView(p) {
    if (p.a == null || p.b == null) { const t = p.a != null ? texts.a[p.a] : texts.b[p.b]; return h('div', { class: 'paper' }, p.a != null ? h('del', t || '(no text)') : h('ins', t || '(no text)')) }
    const parts = p.parts || []
    const side = h('div', { class: 'cv-chips', style: 'margin-bottom:10px' }, button(S.textMode === 'inline' ? 'Show side by side' : 'Show inline', { size: 'sm', icon: 'columns-2', onClick: () => { S.textMode = S.textMode === 'inline' ? 'two' : 'inline'; show() } }))
    if (!parts.some((x) => x.added || x.removed)) return h('div', side, h('div', { class: 'paper' }, texts.a[p.a] || '(no text on this page)'), h('div', { class: 'cv-sub', style: 'margin-top:8px' }, 'No text changes on this page.'))
    if (S.textMode === 'two') {
      return h('div', side, h('div', { class: 'two' }, h('div', h('div', { class: 'cv-sub' }, 'Original'), h('div', { class: 'paper' }, parts.filter((x) => !x.added).map((x) => (x.removed ? h('del', x.value) : x.value)))), h('div', h('div', { class: 'cv-sub' }, 'Revised'), h('div', { class: 'paper' }, parts.filter((x) => !x.removed).map((x) => (x.added ? h('ins', x.value) : x.value))))))
    }
    return h('div', side, h('div', { class: 'paper' }, parts.map((x) => (x.added ? h('ins', x.value) : x.removed ? h('del', x.value) : x.value))))
  }

  async function exportPdf() {
    const builder = await createPdfBuilder({ title: `Comparison of ${baseName(A.file.name)} and ${baseName(B.file.name)}`, textLayer: false })
    const changed = pairs.filter((p) => p.status !== 'same')
    for (let i = 0; i < changed.length; i++) {
      checkAbort(signal)
      const p = changed[i]
      const ca = p.a != null ? await renderPage(A.doc, p.a + 1, { scale: 1.6 }) : null
      const cb = p.b != null ? await renderPage(B.doc, p.b + 1, { scale: 1.6 }) : null
      let canvas
      if (ca && cb) canvas = diffCanvases(ca, cb, { threshold: S.sens }).canvas
      else canvas = ca || cb
      const W = 595, H = Math.round((W * canvas.height) / canvas.width)
      const image = await canvasSlice(canvas, 0, canvas.height, { jpeg: true })
      await builder.addPage({ W, H, image, x: 0, y: 0, w: W, h: H, label: `Page ${label(p)}: ${p.status === 'add' ? 'only in revised' : p.status === 'del' ? 'only in original' : 'differences'}` })
    }
    download(new Blob([await builder.save()], { type: 'application/pdf' }), `${baseName(A.file.name)}-vs-${baseName(B.file.name)}.pdf`)
  }

  const s1 = step(1, 'Choose the two versions', h('div', { class: 'pair' }, h('div', h('div', { class: 'lbl' }, h('b', 'A'), 'Original'), A.el), swapBtn, h('div', h('div', { class: 'lbl' }, h('b', { class: 'b' }, 'B'), 'Revised'), B.el)))
  const s2 = step(2, 'Comparison settings', options(h('div', { class: 'stack tight' }, alignTog, caseTog, spaceTog), sensR), { locked: true })
  const s3 = step(3, 'What changed', h('div', { class: 'stack' }, prog.el, out, note('Both files are compared on your device and never uploaded. Scanned PDFs without a text layer are compared visually only.', 'shield-check')), { locked: true })
  root.append(h('div', { class: 'cv t-cmp' }, fl, s1, s2, s3))
  onCleanup(() => { for (const c of coarse.values()) c.width = c.height = 0 })
}
