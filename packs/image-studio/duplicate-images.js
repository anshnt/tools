// Find duplicate images: exact copies (SHA-256) and near-duplicates (dHash and pHash perceptual hashes) with a similarity slider.
import { h, panel, split, field, button, busy, clear, download, toast, formatBytes, rangeField, progress, onCleanup, yieldToMain } from '../../lib/ui.js'
import { zip, pickFolder } from '../../lib/files.js'
import { loadImage } from '../../lib/image.js'
import { addStyle, heroDrop, pills, tiles, newCanvas, done, isImage, frame, IMG_ACCEPT, sampleCanvas, encode } from './_shared.js'

// ---------- Hashing ----------
const N = 32
const COS = Array.from({ length: 8 }, (_, u) => Float64Array.from({ length: N }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N))))

const gray = (data, n) => { const g = new Float64Array(n); for (let i = 0; i < n; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]; return g }
const pack = (bits) => { let hi = 0, lo = 0; for (let i = 0; i < 32; i++) { if (bits[i]) hi |= 1 << i; if (bits[32 + i]) lo |= 1 << i } return [hi >>> 0, lo >>> 0] }

/** Difference hash from a 9 x 8 grayscale grid: 1 when a pixel is brighter than its right neighbour (64 bits). */
export function dHash(g /* Float64Array 72 */) {
  const bits = new Uint8Array(64)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits[y * 8 + x] = g[y * 9 + x] > g[y * 9 + x + 1] ? 1 : 0
  return pack(bits)
}
/** Perceptual hash from a 32 x 32 grayscale grid: the 8 x 8 lowest DCT frequencies against their median (64 bits). */
export function pHash(g /* Float64Array 1024 */) {
  const tmp = new Float64Array(N * 8)
  for (let y = 0; y < N; y++) for (let u = 0; u < 8; u++) { let sum = 0; for (let x = 0; x < N; x++) sum += g[y * N + x] * COS[u][x]; tmp[y * 8 + u] = sum }
  const dct = new Float64Array(64)
  for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) { let sum = 0; for (let y = 0; y < N; y++) sum += tmp[y * 8 + u] * COS[v][y]; dct[v * 8 + u] = sum }
  const sorted = Array.from(dct.slice(1)).sort((a, b) => a - b)
  const med = sorted[31]
  const bits = new Uint8Array(64)
  for (let i = 0; i < 64; i++) bits[i] = dct[i] > med ? 1 : 0
  return pack(bits)
}
const pop = (x) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24 }
/** Hamming distance between two [hi, lo] hashes. */
export const hamming = (a, b) => pop(a[0] ^ b[0]) + pop(a[1] ^ b[1])
/** 0..1, where 1 is identical. */
export const similarity = (a, b) => 1 - hamming(a, b) / 64

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

/** Hash one file: size, SHA-256, dHash, pHash and a small thumbnail. */
async function analyse(file) {
  const buf = await file.arrayBuffer()
  const sha = hex(await crypto.subtle.digest('SHA-256', buf))
  let src, w, hh
  try { src = await createImageBitmap(new Blob([buf], { type: file.type })); w = src.width; hh = src.height } catch { src = await loadImage(file); w = src.naturalWidth; hh = src.naturalHeight }
  const k = Math.min(1, 256 / Math.max(w, hh))
  const c256 = newCanvas(w * k, hh * k)
  const g = c256.getContext('2d')
  g.imageSmoothingQuality = 'high'
  g.drawImage(src, 0, 0, c256.width, c256.height)
  src.close?.()
  const grid = (cw, ch) => { const c = newCanvas(cw, ch), x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.fillStyle = '#fff'; x.fillRect(0, 0, cw, ch); x.drawImage(c256, 0, 0, cw, ch); return gray(x.getImageData(0, 0, cw, ch).data, cw * ch) }
  const t = newCanvas(Math.max(1, c256.width * Math.min(1, 150 / Math.max(c256.width, c256.height))), Math.max(1, c256.height * Math.min(1, 150 / Math.max(c256.width, c256.height))))
  t.getContext('2d').drawImage(c256, 0, 0, t.width, t.height)
  return { file, path: file.webkitRelativePath || file.name, name: file.name, size: file.size, w, h: hh, sha, dh: dHash(grid(9, 8)), ph: pHash(grid(N, N)), thumb: t.toDataURL('image/jpeg', 0.72) }
}

/** Group indices whose similarity is at least `min` (0..1) by union-find. algo: 'phash' | 'dhash' | 'both'. Identical files always group. */
export function groupImages(list, min, algo = 'phash') {
  const n = list.length
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a }
  const bySha = new Map()
  list.forEach((it, i) => { if (bySha.has(it.sha)) union(bySha.get(it.sha), i); else bySha.set(it.sha, i) })
  const sim = (a, b) => (algo === 'phash' ? similarity(a.ph, b.ph) : algo === 'dhash' ? similarity(a.dh, b.dh) : Math.min(similarity(a.ph, b.ph), similarity(a.dh, b.dh)))
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (find(i) !== find(j) && sim(list[i], list[j]) >= min - 1e-9) union(i, j)
  const groups = new Map()
  for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i) }
  return { groups: [...groups.values()].filter((g) => g.length > 1), sim }
}

/** Best copy to keep: most pixels, then biggest file, then first by name. */
export const betterFirst = (a, b) => b.w * b.h - a.w * a.h || b.size - a.size || a.path.length - b.path.length || a.path.localeCompare(b.path)

export function mount(root, { signal }) {
  addStyle('is-dup', `
.t-dup .grp { padding: 14px; border-radius: 22px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow-sm); animation: isPop .5s var(--spring) both; animation-delay: calc(var(--i, 0) * 50ms); }
.t-dup .grp h3 { font-size: 14px; display: flex; gap: 8px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
.t-dup .grp h3 .badge { font-weight: 500; }
.t-dup .gl { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr)); gap: 10px; }
.t-dup .it { position: relative; display: grid; gap: 6px; padding: 8px; border-radius: 16px; border: 2px solid var(--border); background: var(--surface-2); text-align: left; cursor: pointer; font: inherit; color: inherit; transition: border-color .2s, transform .25s var(--spring), opacity .2s; min-width: 0; }
.t-dup .it:hover { transform: translateY(-3px); }
.t-dup .it img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 10px; display: block; background: var(--checker); }
.t-dup .it.keep { border-color: var(--success); background: color-mix(in srgb, var(--success) 8%, var(--surface)); }
.t-dup .it.drop { opacity: .62; }
.t-dup .it.drop img { filter: grayscale(.7); }
.t-dup .it b { font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t-dup .it small { font-size: 11.5px; color: var(--muted); }
.t-dup .it .tag { position: absolute; left: 14px; top: 14px; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 650; color: #fff; background: var(--danger); }
.t-dup .it.keep .tag { background: var(--success); }
.t-dup .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
`)
  const s = { algo: 'phash', min: 90 }
  let all = [], failed = 0, groups = [], keep = new Map(), sim = null, running = null

  const drop = heroDrop({ accept: IMG_ACCEPT, multiple: true, sample: 0, label: 'Drop photos here to scan them', hint: 'Hundreds at once is fine. Nothing is uploaded and nothing is deleted.', onFiles: (f) => scan(f) })
  const folderBtn = button('Choose a folder', { icon: 'folder-open', size: 'sm', onClick: async () => { const files = (await pickFolder()).filter(isImage); if (files.length) scan(files); else toast('No images found in that folder.') } })
  const sampleBtn = button('Try sample photos', { icon: 'wand-sparkles', variant: 'ghost', size: 'sm', onClick: async () => {
    const mk = async (cv, name, q) => new File([await encode(cv, 'image/jpeg', q)], name, { type: 'image/jpeg' })
    const a = sampleCanvas(0, 1200, 800), b = sampleCanvas(1, 1200, 800), c = sampleCanvas(2, 1200, 800)
    const half = (cv) => { const o = newCanvas(cv.width / 2, cv.height / 2); o.getContext('2d').drawImage(cv, 0, 0, o.width, o.height); return o }
    const files = [await mk(a, 'sunset.jpg', 0.92), await mk(half(a), 'sunset-small.jpg', 0.8), await mk(a, 'sunset-copy.jpg', 0.92), await mk(b, 'ocean.jpg', 0.9), await mk(half(b), 'ocean-small.jpg', 0.7), await mk(c, 'forest.jpg', 0.9)]
    scan(files)
  } })
  const prog = progress()
  const cancelBtn = button('Stop', { icon: 'square', variant: 'ghost', size: 'sm', onClick: () => running?.abort() })
  const status = h('div')
  const work = h('div', { class: 'stack', hidden: true })
  const stats = h('div'); const list = h('div', { class: 'stack' }); const result = h('div')

  const algoSeg = pills([['phash', 'Look-alike (pHash)'], ['dhash', 'Edges (dHash)'], ['both', 'Both must agree']], s.algo, (v) => { s.algo = v; regroup() }, 'Comparison method')
  const simF = rangeField('Similarity needed', { min: 60, max: 100, step: 1, value: s.min, format: (v) => `${v}%`, hint: 'Higher is stricter. Identical files are always grouped.', onInput: (v) => { s.min = v; soonGroup() } })
  const zipBtn = button('Download the cleaned set (ZIP)', { icon: 'archive', variant: 'primary', size: 'lg', block: true })
  const csvBtn = button('Download the list of extras (CSV)', { icon: 'file-spreadsheet', variant: 'secondary', block: true })
  const controls = panel(h('div', { class: 'stack' }, field('How to compare', algoSeg), simF, zipBtn, csvBtn, result,
    h('p', { class: 'small muted' }, 'Websites cannot delete your files. The ZIP holds one copy of each picture, and the CSV lists the extras so you can remove them yourself.')))
  const soonGroup = frame(() => regroup())

  async function scan(files) {
    running?.abort()
    const ctl = new AbortController(); running = ctl
    const onAbort = () => ctl.abort()
    signal.addEventListener('abort', onAbort)
    files = files.filter(isImage).slice(0, 4000)
    const known = new Set(all.map((a) => a.path + a.size))
    files = files.filter((f) => !known.has((f.webkitRelativePath || f.name) + f.size))
    if (!files.length) return toast('Those pictures are already in the list.')
    clear(result)
    work.hidden = false
    clear(status, h('div', { class: 'row' }, h('div', { class: 'grow' }, prog.el), cancelBtn))
    drop.setCompact(true); sampleBtn.hidden = true
    let doneN = 0, next = 0
    const worker = async () => {
      while (next < files.length && !ctl.signal.aborted) {
        const f = files[next++]
        try { all.push(await analyse(f)) } catch { failed++ }
        doneN++
        prog.set(doneN / files.length, `Scanned ${doneN} of ${files.length}: ${f.name}`)
        if (doneN % 3 === 0) await yieldToMain()
      }
    }
    await Promise.all([worker(), worker(), worker()])
    signal.removeEventListener('abort', onAbort)
    prog.hide(); clear(status)
    if (running === ctl) running = null
    if (failed) toast(`${failed} file${failed === 1 ? '' : 's'} could not be read and ${failed === 1 ? 'was' : 'were'} skipped.`, 'error')
    if (!all.length) { work.hidden = true; drop.setCompact(false); sampleBtn.hidden = false; return }
    regroup()
  }

  function regroup() {
    algoSeg.set(s.algo)
    if (!all.length) return
    const r = groupImages(all, s.min / 100, s.algo)
    sim = r.sim
    groups = r.groups.map((g) => g.map((i) => all[i]).sort(betterFirst))
    keep = new Map()
    for (const g of groups) g.forEach((it, i) => keep.set(it, i === 0))
    render()
  }

  const extras = () => groups.flatMap((g) => g.filter((it) => !keep.get(it)))
  function render() {
    clear(result)
    const ex = extras()
    const dupGroups = groups.length
    refreshStats()
    zipBtn.disabled = !all.length
    clear(list, dupGroups ? groups.map((g, gi) => {
      const top = g[0]
      const minSim = Math.min(...g.slice(1).map((it) => (it.sha === top.sha ? 1 : sim(top, it))))
      return h('section', { class: 'grp', style: { '--i': Math.min(gi, 10) } },
        h('h3', `Group ${gi + 1}`, h('span', { class: 'badge' }, `${g.length} pictures`), h('span', { class: 'badge' }, g.every((it) => it.sha === top.sha) ? 'Identical files' : minSim >= 0.9999 ? '100% alike' : `${Math.round(minSim * 100)}%+ alike`)),
        h('div', { class: 'gl' }, g.map((it) => {
          const el = h('button', { type: 'button', class: ['it', keep.get(it) ? 'keep' : 'drop'], 'aria-pressed': String(keep.get(it)), title: it.path,
            onclick: () => { keep.set(it, !keep.get(it)); el.className = `it ${keep.get(it) ? 'keep' : 'drop'}`; el.setAttribute('aria-pressed', String(keep.get(it))); el.querySelector('.tag').textContent = keep.get(it) ? 'Keep' : 'Extra'; refreshStats() } },
          h('img', { src: it.thumb, alt: '' }), h('span', { class: 'tag' }, keep.get(it) ? 'Keep' : 'Extra'), h('b', it.name), h('small', `${it.w} x ${it.h} - ${formatBytes(it.size)}`),
          h('small', it.sha === top.sha && it !== top ? 'Identical to the first' : it === top ? 'Largest copy' : `${Math.round(sim(top, it) * 100)}% like the first`))
          return el
        })))
    }) : h('div', { class: 'empty' }, h('div', all.length ? 'No duplicates at this similarity. Try lowering the slider.' : 'Add some pictures to scan.')))
  }
  function refreshStats() {
    const ex = extras()
    clear(stats, tiles([
      { label: 'Pictures scanned', value: all.length.toLocaleString(), hint: failed ? `${failed} unreadable` : 'All readable' },
      { label: 'Duplicate groups', value: groups.length.toLocaleString(), hero: true, good: !groups.length, hint: groups.length ? 'Sets that look the same' : 'No duplicates found' },
      { label: 'Extra copies', value: ex.length.toLocaleString(), hint: 'Marked to remove' },
      { label: 'Space to free', value: formatBytes(ex.reduce((a, it) => a + it.size, 0)), hint: 'If you delete the extras' },
    ]))
    csvBtn.disabled = !ex.length
  }

  zipBtn.addEventListener('click', () => busy(zipBtn, async () => {
    const drop_ = new Set(extras())
    const keepers = all.filter((it) => !drop_.has(it))
    const total = keepers.reduce((a, it) => a + it.size, 0)
    if (total > 1.5 * 1024 ** 3) throw new Error(`The cleaned set is ${formatBytes(total)}, too large to zip in the browser. Use the CSV list instead.`)
    prog.set(0.05, 'Zipping')
    const blob = await zip(keepers.map((it) => ({ name: it.path, data: it.file })), (f) => prog.set(f, 'Zipping'))
    download(blob, 'cleaned-photos.zip')
    clear(result, done(`${keepers.length} pictures saved`, `${drop_.size} extra cop${drop_.size === 1 ? 'y' : 'ies'} left out, ${formatBytes(blob.size)}`))
  }, { label: 'Zipping', errorTo: result, progress: prog }))

  csvBtn.addEventListener('click', () => {
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`
    const rows = [['file', 'size_bytes', 'width', 'height', 'keeper', 'similarity_percent']]
    groups.forEach((g) => g.forEach((it) => { if (!keep.get(it)) { const k = g.find((x) => keep.get(x)) || g[0]; rows.push([it.path, it.size, it.w, it.h, k.path, Math.round((it.sha === k.sha ? 1 : sim(k, it)) * 100)]) } }))
    download('﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n', 'duplicate-images-to-remove.csv', 'text/csv')
    toast(`Saved a list of ${rows.length - 1} extra files`, 'success')
  })

  work.append(h('div', { class: 'stack' }, status, stats, split(list, controls, 'wide-left')))
  root.append(h('div', { class: 't-dup stack' }, drop, h('div', { class: 'row' }, folderBtn, sampleBtn), work))
  onCleanup(() => running?.abort())
}
