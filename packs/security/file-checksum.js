// File checksum: hash several files with several algorithms in one pass, verify against a pasted checksum or a .sha256 / .md5 file.
import { h, icon, field, textarea, panel, button, dropzone, fileList, progress, alert, stats, select, formatBytes, formatDuration, clear, busy, download } from '../../lib/ui.js'
import { pickFiles } from '../../lib/files.js'
import { useStyles, copyBtn, chip, burst, toHex } from './_shared.js'
import { ALGOS, algoById, hashFile, parseChecksumFile, cleanChecksum, guessAlgos } from './_hash.js'

const CSS = `
.sx-fc{border:1px solid var(--border);border-radius:18px;background:var(--surface);overflow:hidden;box-shadow:var(--shadow-sm);animation:sx-in .4s var(--ease) both;animation-delay:calc(var(--i,0)*60ms)}
.sx-fc-head{display:flex;gap:12px;align-items:center;padding:12px 14px;border-bottom:1px solid var(--border);background:var(--surface-2)}
.sx-fc-head .ic{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);flex:none}
.sx-fc-head .meta{flex:1;min-width:0}.sx-fc-head .name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sx-fc-head .size{font-size:12.5px;color:var(--muted)}
.sx-fc.ok{border-color:color-mix(in srgb,var(--success) 45%,var(--border))}.sx-fc.ok .sx-fc-head{background:var(--success-soft)}
.sx-fc.bad{border-color:color-mix(in srgb,var(--danger) 45%,var(--border))}.sx-fc.bad .sx-fc-head{background:var(--danger-soft)}
.sx-fc-row{display:grid;grid-template-columns:100px 1fr auto;gap:12px;align-items:center;padding:8px 10px 8px 16px;border-bottom:1px solid var(--border)}
.sx-fc-row:last-child{border-bottom:0}.sx-fc-row .n{font-size:13px;font-weight:600}
.sx-fc-row code{font-family:var(--mono);font-size:12.5px;overflow-wrap:anywhere;word-break:break-all;color:var(--text-2);user-select:all}
.sx-fc-row.hit{background:var(--success-soft)}.sx-fc-row.hit code{color:var(--text)}
@media (max-width:640px){.sx-fc-row{grid-template-columns:1fr auto}.sx-fc-row .n{grid-column:1/-1}}
`
const MAIN = ['md5', 'sha1', 'sha256', 'sha384', 'sha512', 'sha3-256', 'blake3', 'crc32']
const SUM_FILE = /\.(sha256|sha1|sha512|sha384|sha224|md5|sha256sum|sha1sum|sha512sum|md5sum)$|^(sha\d*sums?|md5sums?|checksums?)(\.txt)?$/i
const EXT_ALGO = { sha256: 'sha256', sha256sum: 'sha256', sha1: 'sha1', sha1sum: 'sha1', sha512: 'sha512', sha512sum: 'sha512', sha384: 'sha384', sha224: 'sha224', md5: 'md5', md5sum: 'md5' }
const CHIP_ALGOS = ALGOS.filter((a) => MAIN.includes(a.id)).sort((a, b) => MAIN.indexOf(a.id) - MAIN.indexOf(b.id))
const baseOf = (n) => n.replace(/^.*[\\/]/, '').toLowerCase()
const hintToId = (hint = '') => ALGOS.find((a) => a.label.replace(/[-\s]/g, '').toLowerCase() === hint.replace(/[-\s]/g, '').toLowerCase())?.id

export function mount(root, { signal }) {
  useStyles('sx-filesum', CSS)
  const state = { selected: new Set(['md5', 'sha1', 'sha256']), results: new Map(), hintAlgo: null, running: false }
  let zone
  const list = fileList({ sortable: false, onChange: () => { zone?.classList.toggle('compact', list.files.length > 0); if (list.files.length) calc(); else { state.results.clear(); render() } } })
  const prog = progress('Hashing')
  const status = h('div')
  const out = h('div', { class: 'stack' })
  const verifyBox = textarea({ rows: 3, mono: true, placeholder: 'Paste a checksum, or lines like "hash  filename", or load a .sha256 / .md5 file', 'aria-label': 'Expected checksum', oninput: () => { ensureAlgos(); render() } })
  const cancel = button('Cancel', { variant: 'ghost', size: 'sm' })
  cancel.hidden = true
  let ctl

  const chips = CHIP_ALGOS.map((a) => chip(a.label, state.selected.has(a.id), (v) => { v ? state.selected.add(a.id) : state.selected.delete(a.id); if (list.files.length) calc() }))

  function entries() {
    const t = verifyBox.value.trim()
    if (!t) return []
    const parsed = parseChecksumFile(t)
    if (parsed.length) return parsed
    const { clean, isHex } = cleanChecksum(t)
    return isHex && clean.length >= 8 ? [{ hash: clean, name: null }] : []
  }
  function algosFor(e) {
    const h1 = hintToId(e.algoHint)
    if (h1) return [h1]
    if (state.hintAlgo && guessAlgos(e.hash.length).includes(state.hintAlgo)) return [state.hintAlgo]
    return guessAlgos(e.hash.length)
  }
  /** Make sure the algorithm each expected checksum needs is selected (first guess only; more on request). */
  function ensureAlgos() {
    const need = new Set()
    for (const e of entries()) { const g = algosFor(e); if (g.length && !g.some((id) => state.selected.has(id))) need.add(g[0]) }
    if (need.size && list.files.length) {
      need.forEach((id) => state.selected.add(id))
      refreshChips()
      calc()
    }
  }
  // algorithms outside MAIN (e.g. blake2s) have no chip; the selected set still drives hashing
  const refreshChips = () => chips.forEach((c, i) => { c.input.checked = state.selected.has(CHIP_ALGOS[i].id) })

  function verdict(file, digests) {
    const es = entries()
    if (!es.length) return null
    const nm = baseOf(file.name)
    let mine = es.filter((e) => e.name && baseOf(e.name) === nm)
    if (!mine.length && list.files.length === 1) mine = es.filter((e) => !e.name)
    if (!mine.length && list.files.length === 1 && es.length === 1) mine = es
    if (!mine.length) return { status: 'none' }
    for (const e of mine) for (const [id, bytes] of Object.entries(digests)) if (toHex(bytes) === e.hash) return { status: 'ok', algo: id, hash: e.hash }
    return { status: 'bad', expected: mine[0].hash, guesses: guessAlgos(mine[0].hash.length) }
  }

  function render() {
    const files = list.files.filter((f) => state.results.has(f))
    if (!files.length) return clear(out)
    const verdicts = files.map((f) => verdict(f, state.results.get(f).digests))
    const summary = []
    if (verdicts.some(Boolean)) {
      const ok = verdicts.filter((v) => v?.status === 'ok').length
      const bad = verdicts.filter((v) => v?.status === 'bad').length
      const none = verdicts.filter((v) => v?.status === 'none').length
      summary.push(h('div', { class: 'row' },
        bad ? h('span', { class: 'sx-stamp bad' }, icon('shield-alert'), `${bad} do not match`) : null,
        ok ? h('span', { class: 'sx-stamp ok' }, icon('shield-check'), `${ok} verified`) : null,
        none ? h('span', { class: 'sx-hint' }, `${none} without a checksum`) : null))
    }
    const cards = files.map((f, i) => {
      const r = state.results.get(f)
      const v = verdicts[i]
      const ids = ALGOS.map((a) => a.id).filter((id) => r.digests[id])
      return h('div', { class: ['sx-fc', v?.status === 'ok' && 'ok', v?.status === 'bad' && 'bad'], style: { '--i': i } },
        h('div', { class: 'sx-fc-head' }, h('div', { class: 'ic' }, icon('file-check')),
          h('div', { class: 'meta' }, h('div', { class: 'name', title: f.name }, f.name), h('div', { class: 'size' }, `${formatBytes(f.size)} - ${r.ms < 1000 ? Math.round(r.ms) + ' ms' : formatDuration(r.ms / 1000)}`)),
          v?.status === 'ok' ? h('span', { class: 'sx-stamp ok' }, icon('badge-check'), `Verified (${algoById(v.algo).label})`)
            : v?.status === 'bad' ? h('span', { class: 'sx-stamp bad' }, icon('circle-x'), 'Does not match') : null),
        ...ids.map((id) => { const hex = toHex(r.digests[id]); return h('div', { class: ['sx-fc-row', v?.status === 'ok' && v.algo === id && 'hit'] }, h('div', { class: 'n' }, algoById(id).label), h('code', hex), copyBtn(() => hex, '', { ariaLabel: `Copy ${algoById(id).label} of ${f.name}`, variant: 'ghost' })) }),
        v?.status === 'bad' ? h('div', { class: 'sx-fc-row', style: 'display:block;font-size:13px' },
          h('div', { class: 'muted' }, 'Expected ', h('code', { style: 'font-family:var(--mono);overflow-wrap:anywhere' }, v.expected)),
          v.guesses.length > 1 && !v.guesses.every((g) => state.selected.has(g))
            ? h('div', { style: 'margin-top:8px' }, button(`Also try ${v.guesses.filter((g) => !state.selected.has(g)).map((g) => algoById(g).label).join(', ')}`, { size: 'sm', onClick: () => { v.guesses.forEach((g) => state.selected.add(g)); refreshChips(); calc() } })) : null,
          h('div', { class: 'muted', style: 'margin-top:6px' }, 'The file differs from the one the checksum was made for, or the download is incomplete or tampered with. Download it again from the original source.')) : null)
    })
    const dl = files.length ? h('div', { class: 'row' }, h('span', { class: 'sx-hint' }, 'Save as a checksum file'),
      ...ALGOS.filter((a) => state.selected.has(a.id) && ['md5', 'sha1', 'sha256', 'sha512'].includes(a.id)).map((a) => button(`${a.label}SUMS`, {
        icon: 'download', size: 'sm', onClick: () => download(files.map((f) => `${toHex(state.results.get(f).digests[a.id])}  ${f.name}`).join('\n') + '\n', `${a.id.toUpperCase()}SUMS.txt`, 'text/plain'),
      }))) : null
    clear(out, ...summary, ...cards, dl)
    const allOk = verdicts.length && verdicts.every((v) => v?.status === 'ok')
    if (allOk && !out._burst) { out._burst = 1; burst(out.querySelector('.sx-stamp')) } else if (!allOk) out._burst = 0
  }

  let seq = 0
  async function calc() {
    const files = [...list.files]
    const ids = ALGOS.map((a) => a.id).filter((id) => state.selected.has(id))
    if (!files.length) return
    if (!ids.length) return clear(status, alert('warn', 'Select at least one algorithm.'))
    const mine = ++seq
    ctl?.abort()
    ctl = new AbortController()
    const onAbort = () => ctl.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    clear(status)
    cancel.hidden = false
    list.setDisabled(true)
    const total = files.reduce((a, f) => a + f.size, 0) || 1
    let before = 0
    const myCtl = ctl
    try {
      for (const f of files) {
        if (mine !== seq) return
        const have = state.results.get(f)
        if (have && ids.every((id) => have.digests[id])) { before += f.size; continue }
        const t0 = performance.now()
        prog.set(before / total, `Hashing ${f.name}`)
        const digests = await hashFile(f, ids, { signal: myCtl.signal, onProgress: (x) => prog.set((before + x * f.size) / total, `Hashing ${f.name}`) })
        if (mine !== seq) return
        state.results.set(f, { digests, ms: performance.now() - t0 })
        before += f.size
      }
      prog.hide()
      render()
    } catch (e) {
      if (e.code !== 'ABORT') { console.error(e); clear(status, alert('error', e.message)) }
      prog.hide()
    } finally {
      if (mine === seq) { cancel.hidden = true; list.setDisabled(false) }
      signal?.removeEventListener('abort', onAbort)
    }
  }
  cancel.addEventListener('click', () => { ctl?.abort(); seq++; cancel.hidden = true; list.setDisabled(false); prog.hide() })

  async function takeFiles(files) {
    const sums = files.filter((f) => SUM_FILE.test(f.name))
    const normal = files.filter((f) => !sums.includes(f))
    if (sums.length) {
      verifyBox.value = (await Promise.all(sums.map((f) => f.text()))).join('\n')
      state.hintAlgo = EXT_ALGO[sums[0].name.split('.').pop().toLowerCase()] || null
      status.replaceChildren(alert('info', `Loaded checksums from ${sums.map((f) => f.name).join(', ')}.`))
    }
    if (normal.length) list.add(normal)
    else { ensureAlgos(); render() }
  }
  zone = dropzone({ multiple: true, label: 'Drop files to checksum', hint: 'Drop several files at once. Include a .sha256 or .md5 file to verify them automatically.', onFiles: takeFiles })
  const loadBtn = button('Load a checksum file', { icon: 'file-input', size: 'sm', onClick: async () => { const f = await pickFiles({ accept: '.sha256,.sha1,.sha512,.sha384,.md5,.txt,.sha256sum,.md5sum' }); if (f.length) { verifyBox.value = await f[0].text(); state.hintAlgo = EXT_ALGO[f[0].name.split('.').pop().toLowerCase()] || null; ensureAlgos(); render() } } })

  root.append(h('div', { class: 'sx stack' },
    zone, list.el,
    panel(h('div', { class: 'stack' },
      h('div', { class: 'stack tight' }, h('div', { class: 'sx-k' }, icon('fingerprint'), 'Algorithms'), h('div', { class: 'sx-chips' }, chips)),
      h('div', { class: 'stack tight' }, h('div', { class: 'row between' }, h('div', { class: 'sx-k' }, icon('badge-check'), 'Verify (optional)'), loadBtn), verifyBox,
        h('div', { class: 'sx-hint' }, 'The algorithm is picked from the length of the checksum. Files are read in chunks, so very large files work.')))),
    prog.el, h('div', { class: 'row' }, cancel), status, out))
}
