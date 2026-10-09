// Compare two files: size and SHA-256 identity, first differing offset, how many bytes differ, and a side-by-side hex view of
// every differing region. One streaming pass reads both files in lockstep, so big files do not freeze the tab.
import { h, icon, clear, dropzone, button, alert, stats, number, progress, formatBytes, errorMessage, table, download, onCleanup, yieldToMain } from '../../lib/ui.js'
import { makeHasher, readRange, hex, throwIfAborted } from './_core.js'
import { useFx, card, chip, chips, tile, hashRow, celebrate, checkRing, injectStyle } from './_ui.js'

const CH = 4 << 20

/**
 * Stream two Blobs side by side. Resolves {identical, sameSize, sizeA, sizeB, firstDiff, diffBytes, regionCount, regions: [{start, len, tail?}],
 * truncated, sha: {a, b}, percent}. percent counts differing bytes plus the length difference, over the longer file.
 */
export async function compareBlobs(a, b, { onProgress, signal, maxRegions = 5000 } = {}) {
  const [hA, hB] = await Promise.all([makeHasher('sha256'), makeHasher('sha256')])
  const total = Math.max(a.size, b.size)
  let firstDiff = -1, diffBytes = 0, regionCount = 0, cur = null, truncated = false
  const regions = []
  for (let off = 0; off < total; off += CH) {
    throwIfAborted(signal)
    const [x, y] = await Promise.all([readRange(a, off, off + CH), readRange(b, off, off + CH)])
    if (x.length) hA.update(x)
    if (y.length) hB.update(y)
    const m = Math.min(x.length, y.length)
    for (let i = 0; i < m; i++) {
      if (x[i] === y[i]) continue
      diffBytes++
      const at = off + i
      if (firstDiff < 0) firstDiff = at
      if (cur && cur.start + cur.len === at) cur.len++
      else {
        regionCount++
        cur = { start: at, len: 1 }
        if (regions.length < maxRegions) regions.push(cur)
        else truncated = true
      }
    }
    onProgress?.(Math.min(1, (off + CH) / (total || 1)))
    await yieldToMain()
  }
  const shortest = Math.min(a.size, b.size)
  if (a.size !== b.size) {
    if (firstDiff < 0) firstDiff = shortest
    regionCount++
    const tail = { start: shortest, len: Math.abs(a.size - b.size), tail: true }
    if (regions.length < maxRegions + 1) regions.push(tail)
  }
  const sha = { a: hA.digest(), b: hB.digest() }
  const extra = Math.abs(a.size - b.size)
  return {
    identical: a.size === b.size && sha.a === sha.b, sameSize: a.size === b.size, sizeA: a.size, sizeB: b.size, firstDiff, diffBytes, regionCount, regions,
    truncated, sha, extra, percent: total ? ((diffBytes + extra) / total) * 100 : 0,
  }
}

const CSS = `
.fx-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
@media (max-width: 700px) { .fx-pair { grid-template-columns: minmax(0, 1fr); } }
.fx-slot { position: relative; min-width: 0; }
.fx-slot .fx-picked { display: flex; align-items: center; gap: 12px; padding: 14px; border-radius: var(--radius-lg); border: 1px solid var(--border); background: var(--surface); box-shadow: var(--shadow-sm); min-width: 0; }
.fx-slot .fx-picked .grow { flex: 1; min-width: 0; }
.fx-slot .fx-picked b { display: block; overflow-wrap: anywhere; font-size: 14px; }
.fx-slot .fx-picked span.s { font-size: 12.5px; color: var(--muted); }
.fx-slot .fx-tag { position: absolute; top: -9px; left: 14px; z-index: 1; font: 700 11px var(--mono); letter-spacing: .08em; padding: 2px 9px; border-radius: 99px; background: var(--accent); color: #fff; }
.fx-slot.b .fx-tag { background: var(--accent-2); }
.fx-hexpair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 900px) { .fx-hexpair { grid-template-columns: minmax(0, 1fr); } }
.fx-hx { font: 12.5px/1.75 var(--mono); background: var(--surface-2); border: 1px solid var(--border); border-radius: 14px; overflow-x: auto; padding: 6px 0; }
.fx-hx .cap { padding: 2px 12px 6px; font: 600 12px var(--font, inherit); color: var(--muted); }
.fx-hx .r { display: flex; gap: 14px; padding: 0 12px; white-space: pre; width: max-content; min-width: 100%; }
.fx-hx .o { color: var(--muted); }
.fx-hx .d { background: color-mix(in srgb, var(--danger) 20%, transparent); color: var(--danger); font-weight: 700; border-radius: 3px; }
.fx-hx .g { color: var(--muted); opacity: .45; }
.fx-hx .r.hit { background: color-mix(in srgb, var(--danger) 6%, transparent); }
.fx-nav { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.fx-nav .num { width: 130px; }
`

export function mount(root) {
  useFx()
  injectStyle('fx-compare', CSS)
  let A = null, B = null, res = null, ctl = null, bpr = 8, cursor = 0
  const out = h('div', { class: 'stack' })
  const prog = progress('Comparing')
  const slotA = makeSlot('A', (f) => { A = f; go() })
  const slotB = makeSlot('B', (f) => { B = f; go() }, false)

  function makeSlot(tag, onPick, paste = true) {
    const holder = h('div', { class: ['fx-slot', tag === 'B' && 'b'] })
    const zone = dropzone({ multiple: false, compact: true, paste, label: `Drop file ${tag} here or click`, hint: tag === 'A' ? 'Any type of file' : 'The one to compare against', onFiles: ([f]) => { onPick(f); show(f) } })
    const tagEl = () => h('span', { class: 'fx-tag' }, tag)
    function show(f) {
      clear(holder, tagEl(),
        h('div', { class: 'fx-picked' }, tile(f.name), h('div', { class: 'grow' }, h('b', f.name), h('span', { class: 's' }, `${formatBytes(f.size)} · ${f.size.toLocaleString()} bytes`)),
          button('Change', { size: 'sm', variant: 'ghost', onClick: () => zone.open() })),
        h('div', { hidden: true }, zone))
    }
    holder.append(tagEl(), zone)
    return { el: holder, zone, show, set: (f) => { if (f) show(f); else { clear(holder, tagEl(), zone) } } }
  }

  const swap = button('Swap A and B', { icon: 'arrow-left-right', size: 'sm', onClick: () => { [A, B] = [B, A]; slotA.set(A); slotB.set(B); go() } })
  const reset = button('Clear', { icon: 'x', size: 'sm', variant: 'ghost', onClick: () => { ctl?.abort(); A = B = res = null; slotA.set(null); slotB.set(null); clear(out); bar.hidden = true } })
  const bar = h('div', { class: 'row' }, swap, reset)
  bar.hidden = true
  root.append(h('div', { class: 'stack fx' }, h('div', { class: 'fx-pair' }, slotA.el, slotB.el), bar, prog.el, out))
  onCleanup(() => ctl?.abort())

  async function go() {
    ctl?.abort()
    if (!A || !B) { bar.hidden = !(A || B); return }
    bar.hidden = false
    const mine = (ctl = new AbortController())
    clear(out)
    try {
      prog.set(0, 'Comparing byte by byte')
      res = await compareBlobs(A, B, { signal: mine.signal, onProgress: (f) => prog.set(f, `Comparing ${Math.round(f * 100)}%`) })
      if (mine.signal.aborted) return
      prog.hide()
      cursor = Math.max(0, res.firstDiff)
      await render()
    } catch (e) {
      prog.hide()
      if (e?.code === 'ABORT') return
      console.error(e)
      clear(out, alert('error', errorMessage(e)))
    }
  }

  const shaA = hashRow('A'), shaB = hashRow('B')
  let regionIdx = 0

  async function render() {
    const r = res
    const hero = h('div', { class: 'fx-hero fx-in', style: { '--k': r.identical ? 'var(--success)' : 'var(--warning)' } },
      r.identical ? checkRing('fx-pop') : h('div', { class: 'fx-tile lg fx-pop', style: { '--k': 'var(--warning)' } }, icon('git-compare')),
      h('div', { class: 'fx-body' },
        h('div', { class: 'fx-title' }, r.identical ? 'The files are identical' : 'The files are different'),
        h('div', { class: 'fx-sub' }, r.identical
          ? `Same size and the same SHA-256, so every one of the ${r.sizeA.toLocaleString()} bytes matches.`
          : r.sameSize ? `Same size, but ${r.diffBytes.toLocaleString()} ${r.diffBytes === 1 ? 'byte differs' : 'bytes differ'} (${fmtPct(r.percent)}).` : `The sizes differ by ${r.extra.toLocaleString()} bytes (${r.sizeA > r.sizeB ? 'A is larger' : 'B is larger'}).`),
        chips(chip(r.sameSize ? 'Same size' : 'Different size', r.sameSize ? 'ok' : 'warn', r.sameSize ? 'equal' : 'ruler'), chip(r.sha.a === r.sha.b ? 'Same SHA-256' : 'Different SHA-256', r.sha.a === r.sha.b ? 'ok' : 'warn', 'fingerprint'))))
    shaA.setValue(r.sha.a); shaB.setValue(r.sha.b)
    shaA.classList.toggle('match', r.identical); shaB.classList.toggle('match', r.identical)
    const items = [
      { label: 'File A', value: formatBytes(r.sizeA), hint: `${r.sizeA.toLocaleString()} bytes` },
      { label: 'File B', value: formatBytes(r.sizeB), hint: `${r.sizeB.toLocaleString()} bytes` },
    ]
    if (!r.identical) items.push(
      { label: 'First difference', value: `0x${hex(r.firstDiff, 4)}`, hint: `offset ${r.firstDiff.toLocaleString()}`, accent: true },
      { label: 'Different bytes', value: (r.diffBytes + r.extra).toLocaleString(), hint: `${fmtPct(r.percent)} of the larger file`, danger: true },
      { label: 'Regions', value: r.regionCount.toLocaleString(), hint: 'separate stretches' })
    const fp = card('Fingerprints (SHA-256)', 'fingerprint', '#6e56cf', h('div', { class: 'stack tight' }, shaA, shaB))
    clear(out, hero, stats(items), fp)
    if (!r.identical) {
      viewer = h('div', { class: 'stack' })
      out.append(card('Side by side', 'columns-2', '#e5484d', viewer), card('Differences', 'list', '#d99a1e', regionsCard()),
        h('div', { class: 'small muted' }, 'This is a byte-by-byte comparison. If one byte is inserted or deleted, everything after it shifts and looks different. For text, the ',
          h('a', { href: '#/diff-checker', style: 'color:var(--accent);font-weight:600' }, 'Diff checker'), ' shows changes line by line.'))
      regionIdx = 0
      await drawWindow()
    } else celebrate(hero.querySelector('.fx-check'), 18)
  }

  let viewer = null
  const fmtPct = (p) => (p === 0 ? '0%' : p < 0.01 ? '<0.01%' : p < 10 ? `${p.toFixed(2)}%` : `${p.toFixed(1)}%`)

  async function drawWindow() {
    const rows = 16
    const startRow = Math.max(0, Math.floor(cursor / bpr) - 3)
    const start = startRow * bpr
    const len = rows * bpr
    const [x, y] = await Promise.all([readRange(A, start, start + len), readRange(B, start, start + len)])
    const panel = (cap, mine, other, size) => h('div', { class: 'fx-hx', role: 'region', tabindex: 0, 'aria-label': `Hex of ${cap}` }, h('div', { class: 'cap' }, cap),
      Array.from({ length: rows }, (_, k) => {
        const base = start + k * bpr
        if (base >= Math.max(res.sizeA, res.sizeB)) return null
        const hexCells = [], ascii = []
        let hit = false
        for (let i = 0; i < bpr; i++) {
          const idx = k * bpr + i
          const here = idx < mine.length ? mine[idx] : null
          const there = idx < other.length ? other[idx] : null
          const differs = here !== there
          if (differs) hit = true
          if (here == null) { hexCells.push(h('span', { class: 'g' }, '..'), ' '); ascii.push(h('span', { class: 'g' }, ' ')); continue }
          hexCells.push(h('span', { class: differs ? 'd' : null }, hex(here)), ' ')
          ascii.push(h('span', { class: differs ? 'd' : null }, here >= 32 && here < 127 ? String.fromCharCode(here) : '.'))
        }
        return h('div', { class: ['r', hit && 'hit'] }, h('span', { class: 'o' }, hex(base, 8)), h('span', hexCells), h('span', { class: 'o' }, '|'), h('span', ascii))
      }))
    const nav = h('div', { class: 'fx-nav' },
      button('', { icon: 'chevrons-left', size: 'sm', ariaLabel: 'First difference', onClick: () => jump(0) }),
      button('Previous', { icon: 'chevron-left', size: 'sm', onClick: () => jump(regionIdx - 1) }),
      button('Next difference', { icon: 'chevron-right', size: 'sm', variant: 'primary', onClick: () => jump(regionIdx + 1) }),
      button('', { icon: 'chevrons-right', size: 'sm', ariaLabel: 'Last difference', onClick: () => jump(res.regions.length - 1) }),
      h('span', { class: 'small muted' }, `Region ${Math.min(regionIdx + 1, res.regionCount).toLocaleString()} of ${res.regionCount.toLocaleString()}`),
      h('span', { style: 'flex:1' }),
      h('label', { class: 'small muted', for: 'fx-go' }, 'Go to offset'),
      Object.assign(number('', { min: 0, step: 1, placeholder: `0x${hex(cursor, 4)}`, ariaLabel: 'Go to offset (decimal)' }), { id: 'fx-go', className: 'input num', onkeydown: (e) => { if (e.key === 'Enter' && Number.isFinite(e.target.valueAsNumber)) { cursor = Math.max(0, Math.floor(e.target.valueAsNumber)); drawWindow() } } }),
      button(bpr === 8 ? '16 per row' : '8 per row', { size: 'sm', variant: 'ghost', onClick: () => { bpr = bpr === 8 ? 16 : 8; drawWindow() } }))
    clear(viewer, nav, h('div', { class: 'fx-hexpair' }, panel(`A · ${A.name}`, x, y), panel(`B · ${B.name}`, y, x)))
  }

  function jump(i) {
    if (!res.regions.length) return
    regionIdx = Math.max(0, Math.min(res.regions.length - 1, i))
    cursor = res.regions[regionIdx].start
    drawWindow()
  }

  function regionsCard() {
    const rs = res.regions
    const shown = rs.slice(0, 200)
    const rows = shown.map((g, i) => [
      h('button', { type: 'button', class: 'fx-link', onclick: () => { jump(i); viewer.scrollIntoView({ behavior: 'smooth', block: 'center' }) } }, `0x${hex(g.start, 4)}`),
      g.start.toLocaleString(), g.len.toLocaleString(), g.tail ? `Only in ${res.sizeA > res.sizeB ? 'A' : 'B'} (extra bytes)` : 'Bytes differ'])
    return h('div', { class: 'stack' },
      table({ columns: ['Offset (hex)', { label: 'Offset', num: true }, { label: 'Length (bytes)', num: true }, 'What'], rows, max: 200 }),
      res.regionCount > 200 || res.truncated ? h('div', { class: 'small muted' }, `Showing the first 200 of ${res.regionCount.toLocaleString()} regions.`) : null,
      h('div', { class: 'row' }, button('Download as CSV', { icon: 'download', size: 'sm', onClick: () => download('offset_hex,offset,length,kind\r\n' + rs.map((g) => `0x${hex(g.start, 4)},${g.start},${g.len},${g.tail ? 'extra bytes' : 'differ'}`).join('\r\n') + '\r\n', 'differences.csv', 'text/csv') })))
  }
}
