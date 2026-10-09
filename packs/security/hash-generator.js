// Hash generator (also serves sha256-generator and md5-generator via params.algo). Text or files, streamed in chunks, compare with an expected hash.
import { h, icon, field, textarea, segmented, panel, button, dropzone, progress, alert, stats, input, toggle, formatBytes, formatDuration, debounce, clear, busy } from '../../lib/ui.js'
import { useStyles, copyBtn, chip, utf8, fromHex, fromBase64 } from './_shared.js'
import { ALGOS, FAMILIES, FORMATS, algoById, formatDigest, hashBytes, hashFile, matchChecksum, cleanChecksum, guessAlgos } from './_hash.js'

const CSS = `
.sx-hrows{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:18px;overflow:hidden;background:var(--surface)}
.sx-hfam{padding:8px 16px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:650;color:var(--muted);background:var(--surface-2);border-bottom:1px solid var(--border)}
.sx-hrow{display:grid;grid-template-columns:118px 1fr auto;gap:12px;align-items:center;padding:9px 10px 9px 16px;border-bottom:1px solid var(--border);transition:background .25s,box-shadow .25s;position:relative}
.sx-hrow:last-child{border-bottom:0}
.sx-hrow .n{font-weight:600;font-size:13.5px}.sx-hrow .n small{display:block;font-weight:500;color:var(--muted);font-size:11.5px}
.sx-hrow code{font-family:var(--mono);font-size:13px;overflow-wrap:anywhere;word-break:break-all;color:var(--text-2);user-select:all}
.sx-hrow.match{background:var(--success-soft);box-shadow:inset 3px 0 0 var(--success)}
.sx-hrow.match code{color:var(--text)}
.sx-hrow .skip{color:var(--muted);font-size:13px}
@media (max-width:640px){.sx-hrow{grid-template-columns:1fr auto}.sx-hrow .n{grid-column:1/-1}.sx-hrow .n small{display:inline;margin-left:8px}}
`

const FILE_DEFAULTS = ['md5', 'sha1', 'sha256', 'sha512']
const FAMILY_ORDER = ['sha2', 'sha3', 'blake', 'legacy', 'sum']

export function mount(root, { params, signal }) {
  useStyles('sx-hash', CSS)
  const focus = params.algo ? algoById(params.algo) : null
  const state = { mode: 'text', inType: 'text', fmt: 'hex', newline: false, digests: null, ids: ALGOS.map((a) => a.id), selected: new Set(focus ? [focus.id] : FILE_DEFAULTS), file: null }
  let seq = 0

  const results = h('div', { class: 'stack' })
  const status = h('div')
  const compareOut = h('div', { class: 'sx-cmp', 'aria-live': 'polite' })
  const expected = input({ mono: true, placeholder: 'Paste the hash you expect (hex or Base64)', 'aria-label': 'Expected hash', spellcheck: false, oninput: () => compare(true) })

  // ---------- results ----------
  function row(a, bytes) {
    const text = bytes ? formatDigest(bytes, state.fmt) : null
    return h('div', { class: 'sx-hrow', dataset: { id: a.id } },
      h('div', { class: 'n' }, a.label, h('small', `${a.bits} bit`)),
      text ? h('code', text) : h('span', { class: 'skip' }, 'Not selected'),
      text ? copyBtn(() => text, '', { ariaLabel: `Copy ${a.label}`, variant: 'ghost' }) : h('span'))
  }
  function renderResults() {
    const d = state.digests
    if (!d) return clear(results)
    const ids = Object.keys(d)
    const list = ALGOS.filter((a) => state.mode === 'text' || ids.includes(a.id))
    const nodes = []
    if (focus && d[focus.id]) {
      const text = formatDigest(d[focus.id], state.fmt)
      nodes.push(h('div', { class: 'sx-hero', dataset: { id: focus.id } },
        h('div', { class: 'lab' }, h('div', { class: 'sx-k' }, icon('fingerprint'), `${focus.label} hash`), copyBtn(() => text, 'Copy hash')),
        h('div', { class: 'dig', 'aria-label': text }, [...text].map((c, i) => h('span', { style: { '--i': i } }, c))),
        focus.note ? h('div', { class: 'note' }, focus.note) : null))
    }
    const rest = focus ? list.filter((a) => a.id !== focus.id) : list
    const body = h('div', { class: 'sx-hrows' }, FAMILY_ORDER.flatMap((f) => {
      const items = rest.filter((a) => a.family === f)
      return items.length ? [h('div', { class: 'sx-hfam' }, FAMILIES[f]), ...items.map((a) => row(a, d[a.id]))] : []
    }))
    nodes.push(focus && rest.length ? h('details', { class: 'sx-more' }, h('summary', { style: 'cursor:pointer;font-weight:600;padding:6px 2px' }, `Other hash functions (${rest.length})`), h('div', { style: 'margin-top:10px' }, body)) : body)
    clear(results, ...nodes)
    compare(false)
  }

  // ---------- compare ----------
  function compare(allowAdd) {
    const text = expected.value
    clear(compareOut)
    results.querySelectorAll('.match').forEach((e) => e.classList.remove('match'))
    if (!text.trim() || !state.digests) return
    const { clean, isHex } = cleanChecksum(text)
    const hits = matchChecksum(text, state.digests)
    if (hits.length) {
      for (const id of hits) results.querySelectorAll(`[data-id="${id}"]`).forEach((e) => e.classList.add('match'))
      compareOut.append(h('span', { class: 'sx-stamp ok' }, icon('badge-check'), 'Match'), h('span', { class: 'small' }, `It is the ${hits.map((i) => algoById(i).label).join(' / ')} of your input.`))
      return
    }
    if (state.mode === 'file' && allowAdd && isHex) {
      const need = guessAlgos(clean.length).filter((id) => !state.selected.has(id))
      if (need.length && state.file) { need.forEach((id) => state.selected.add(id)); syncChips(); runFile(); return }
    }
    const g = isHex ? guessAlgos(clean.length) : []
    compareOut.append(h('span', { class: 'sx-stamp bad' }, icon('circle-x'), 'No match'),
      h('span', { class: 'small muted' }, g.length
        ? `That is ${clean.length} hex characters, the size of ${g.map((i) => algoById(i).label).join(' or ')}, but the digest differs. ${state.mode === 'text' ? 'A trailing newline or space in the text changes the hash.' : 'Check that this is the same file and that the download finished.'}`
        : 'It does not match any digest here and its length is not a standard hash size.'))
  }

  // ---------- text mode ----------
  const textIn = textarea({ rows: 6, mono: true, placeholder: 'Type or paste text to hash...', 'aria-label': 'Text to hash', oninput: () => runText() })
  const inType = segmented([['text', 'Text (UTF-8)'], ['hex', 'Hex bytes'], ['base64', 'Base64 bytes']], 'text', (v) => { state.inType = v; runText() }, 'Input type')
  const newline = toggle('Add a trailing newline (like echo does)', false, (v) => { state.newline = v; runText() })
  const runText = debounce(async () => {
    const mine = ++seq
    let bytes
    try {
      const v = textIn.value
      bytes = state.inType === 'text' ? utf8(v + (state.newline ? '\n' : '')) : state.inType === 'hex' ? fromHex(v) : fromBase64(v)
    } catch (e) { clear(status, alert('warn', e.message)); return }
    clear(status)
    try {
      const d = await hashBytes(bytes)
      if (mine !== seq) return
      state.digests = d
      renderResults()
    } catch (e) { clear(status, alert('error', e.message)) }
  }, 120)

  // ---------- file mode ----------
  const prog = progress('Hashing')
  const cancel = button('Cancel', { variant: 'ghost', size: 'sm' })
  let ctl
  cancel.hidden = true
  cancel.addEventListener('click', () => ctl?.abort())
  const fileHost = h('div', { class: 'stack' })
  const algoChips = ALGOS.map((a) => chip(a.label, state.selected.has(a.id), (v) => { v ? state.selected.add(a.id) : state.selected.delete(a.id); if (state.file) (state.file.size < 64e6 ? runFile() : clear(status, alert('info', 'Press Calculate to hash with the new selection.'))) }))
  function syncChips() { algoChips.forEach((c, i) => { c.input.checked = state.selected.has(ALGOS[i].id) }) }
  const calcBtn = button('Calculate', { icon: 'play', variant: 'primary' })
  calcBtn.addEventListener('click', () => runFile())
  async function runFile() {
    const file = state.file
    if (!file) return
    const ids = ALGOS.map((a) => a.id).filter((id) => state.selected.has(id))
    if (!ids.length) return clear(status, alert('warn', 'Select at least one algorithm.'))
    clear(status)
    const mine = ++seq
    ctl?.abort()
    ctl = new AbortController()
    const onAbort = () => ctl.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    cancel.hidden = false
    const t0 = performance.now()
    await busy(calcBtn, async () => {
      prog.set(0, `Hashing ${file.name}`)
      const d = await hashFile(file, ids, { signal: ctl.signal, onProgress: (f) => prog.set(f) })
      if (mine !== seq) return
      state.digests = d
      renderResults()
      const dt = (performance.now() - t0) / 1000
      clear(status, stats([{ label: 'File size', value: formatBytes(file.size) }, { label: 'Time', value: dt < 1 ? `${Math.round(dt * 1000)} ms` : formatDuration(dt) }, { label: 'Speed', value: `${formatBytes(file.size / Math.max(dt, 0.001))}/s`, hint: `${ids.length} algorithm${ids.length > 1 ? 's' : ''} at once` }]))
    }, { label: 'Hashing', errorTo: status, progress: prog })
    cancel.hidden = true
    signal?.removeEventListener('abort', onAbort)
  }
  const zone = dropzone({ multiple: false, compact: false, label: 'Drop a file to hash', hint: 'Any file type, any size. It is read in chunks and never uploaded.', onFiles: ([f]) => {
    state.file = f
    clear(fileHost, h('div', { class: 'sx-file' }, h('div', { class: 'ic' }, icon('file')), h('div', { class: 'meta' }, h('div', { class: 'name', title: f.name }, f.name), h('div', { class: 'size' }, `${formatBytes(f.size)} - ${f.type || 'unknown type'}`)), button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: 'Remove file', onClick: () => { state.file = null; state.digests = null; clear(fileHost); clear(status); renderResults(); zone.hidden = false } })))
    zone.classList.add('compact')
    runFile()
  } })

  const fmt = segmented(FORMATS, state.fmt, (v) => { state.fmt = v; renderResults() }, 'Output format')
  const textPane = h('div', { class: 'stack' }, textIn, h('div', { class: 'row between' }, h('div', { class: 'row' }, inType, newline), h('span', { class: 'sx-hint' }, 'Hashes update as you type.')))
  const filePane = h('div', { class: 'stack' }, zone, fileHost, h('div', { class: 'stack tight' }, h('div', { class: 'row between' }, h('div', { class: 'field-label' }, 'Algorithms'),
    h('div', { class: 'row', style: 'gap:6px' }, button('Common', { variant: 'ghost', size: 'sm', onClick: () => { state.selected = new Set(FILE_DEFAULTS); syncChips(); state.file && runFile() } }), button('All', { variant: 'ghost', size: 'sm', onClick: () => { state.selected = new Set(ALGOS.map((a) => a.id)); syncChips(); state.file && runFile() } }))),
  h('div', { class: 'sx-chips' }, algoChips)), h('div', { class: 'row' }, calcBtn, cancel), prog.el)
  filePane.hidden = true

  const mode = segmented([['text', 'Text'], ['file', 'File']], 'text', (v) => {
    state.mode = v
    textPane.hidden = v !== 'text'
    filePane.hidden = v !== 'file'
    clear(status)
    state.digests = null
    clear(results)
    if (v === 'text') runText()
    else if (state.file) runFile()
  }, 'Input')

  root.append(h('div', { class: 'sx stack' },
    panel(h('div', { class: 'stack' }, h('div', { class: 'row between' }, mode, h('div', { class: 'row' }, h('span', { class: 'sx-hint' }, 'Show as'), fmt)), textPane, filePane)),
    status,
    results,
    panel(h('div', { class: 'stack' }, h('div', { class: 'sx-k' }, icon('git-compare'), 'Compare with an expected hash'), expected, compareOut))))
  runText()
}
