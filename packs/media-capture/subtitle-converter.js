// Subtitle converter and sync fixer (also srt-to-vtt, smi-to-srt, lrc-converter and friends via params): convert between SRT, WebVTT, ASS, SAMI,
// LRC, TTML, MicroDVD, SCC and plain text (always saved as UTF-8; old Korean, Japanese, Chinese and Western encodings are read correctly), shift every time by milliseconds, stretch for frame-rate mismatches (23.976 vs 25 fps) or resync from two anchor lines.
import { h, icon, button, alert, dropzone, textarea, split, panel, segmented, number, select, field, copyButton, download, clear, debounce, table } from '../../lib/ui.js'
import { baseName } from '../../lib/files.js'
import * as K from './_kit.js'
import { SUB_ACCEPT, SUB_FORMATS, FORMAT_NAMES, FPS_PRESETS, parseSubtitles, parseTime, formatTime, format, shiftCues, stretchCues, resyncCues } from './_subs.js'
import { ENCODINGS, SAMI_LANGS, decodeBytes } from './_subformats.js'

const MODES = [['off', 'No timing change'], ['shift', 'Shift'], ['fps', 'Frame rate'], ['sync', 'Two-point sync']]
const NUDGES = [-1000, -500, -100, 100, 500, 1000]
const SAMPLE = `1
00:00:01,000 --> 00:00:03,500
Welcome to the show.

2
00:00:04,000 --> 00:00:07,200
Today we are fixing subtitle timing,
one line at a time.

3
00:01:10,000 --> 00:01:13,000
And that is how it is done.
`
const FILE_EXT = { srt: 'srt', vtt: 'vtt', ass: 'ass', smi: 'smi', lrc: 'lrc', ttml: 'ttml', sub: 'sub', scc: 'scc', txt: 'txt' }
const DEFAULT_OUT = { srt: 'vtt', vtt: 'srt' }
const ENC_NAME = Object.fromEntries(ENCODINGS)
const MIME = { srt: 'application/x-subrip', vtt: 'text/vtt', ttml: 'application/ttml+xml', smi: 'application/smil+xml' }
/** One line about what a target format cannot hold. */
const OUT_NOTE = {
  scc: 'SCC is the US TV caption format: pop-on captions of up to 4 lines of 32 letters, Latin characters only. Other letters become plain letters or ?.',
  lrc: 'LRC keeps one line of text per start time (lines are joined). Where a gap follows, an empty line marks when the text should clear.',
  sub: 'MicroDVD counts frames, so the frame rate below must match your video. Only whole-line italics are kept.',
  smi: 'SAMI is saved with one language class. Pick the language below so players can tell it apart.',
  ass: 'ASS output uses one plain default style.',
}
const sec = (t) => (Number.isFinite(t) ? `${Math.abs(t) >= 10 ? t.toFixed(1) : t.toFixed(2)}`.replace(/\.?0+$/, '') : '-')

/** Two lanes of cue blocks (before and after) that glide when the timing changes. */
function timeline() {
  const lane = (cls) => h('div', { class: ['mc-tl-lane', cls] })
  const before = lane(''), after = lane('after')
  const endLabel = h('span'), midLabel = h('span')
  const el = h('div', { class: 'mc-tl', role: 'img', 'aria-label': 'Timeline of the subtitles before and after the change', hidden: true },
    h('b', 'Before'), before, h('b', 'After'), after, h('div', { class: 'mc-tl-ruler' }, h('span', '0:00'), midLabel, endLabel))
  const MAX = 500
  const sync = (laneEl, list) => {
    const step = Math.max(1, Math.ceil(list.length / MAX))
    const n = Math.ceil(list.length / step)
    while (laneEl.children.length < n) laneEl.append(h('i'))
    while (laneEl.children.length > n) laneEl.lastChild.remove()
    return step
  }
  return {
    el,
    update(a, b) {
      el.hidden = !a.length
      if (!a.length) return
      const total = Math.max(1, a.at(-1).end, ...b.slice(-3).map((c) => c.end))
      const place = (laneEl, list) => {
        const step = sync(laneEl, list)
        for (let i = 0, k = 0; i < list.length; i += step, k++) {
          const c = list[i]
          const s = laneEl.children[k].style
          s.left = `${Math.max(0, c.start) / total * 100}%`
          s.width = `${Math.max(0.15, (c.end - c.start) / total * 100)}%`
        }
      }
      place(before, a)
      place(after, b)
      midLabel.textContent = formatTime(total / 2, 'short').replace(/\.\d$/, '')
      endLabel.textContent = formatTime(total, 'short').replace(/\.\d$/, '')
    },
  }
}

export function mount(root, { params }) {
  K.useStyle()
  const accept = params?.accept || SUB_ACCEPT
  const prefer = params?.prefer || null
  let userFmt = params?.to && params.to !== 'auto' ? params.to : null
  let mode = params?.tab || 'off'
  let fileName = ''
  let rawBytes = null
  let cues = []
  let parsedFormat = 'unknown'
  let parsed = { format: 'unknown', cues: [] }
  let anchorKey = ''
  let fpsUser = false // true once the visitor types a frame rate; until then a MicroDVD file's own rate is used

  const input = textarea({ rows: 13, mono: true, placeholder: 'Paste subtitles here, or drop a file above...', 'aria-label': 'Subtitle text', spellcheck: false })
  const output = textarea({ rows: 13, mono: true, readonly: true, placeholder: 'The converted subtitles appear here.', 'aria-label': 'Converted subtitles' })
  const info = h('div')
  const chips = h('div', { class: 'mc-meta' })
  const summary = h('div', { 'aria-live': 'polite' })
  const tl = timeline()
  const outFmt = segmented(SUB_FORMATS, 'vtt', (v) => { userFmt = v; render() }, 'Output format')
  const zone = dropzone({
    accept, compact: true, label: 'Drop a subtitle file here or click to browse', hint: 'SRT, VTT, ASS, SAMI, LRC, TTML, MicroDVD and SCC. Old Korean, Japanese, Chinese and Western encodings are fine.', icon: 'captions',
    onFiles: async ([f]) => { fileName = f.name; rawBytes = new Uint8Array(await f.arrayBuffer()); langSel.value = ''; encSel.value = 'auto'; fpsUser = false; decodeRaw() },
  })

  // ---- reading and writing options ----
  const encSel = select(ENCODINGS, 'auto', () => { if (rawBytes) decodeRaw() })
  const encHint = h('small', { class: 'field-hint' }, '')
  const encField = field('Text encoding of the file', encSel)
  encField.append(encHint)
  const langSel = select([['', 'First language']], '', () => render())
  const langField = field('Language to convert', langSel)
  const fpsRate = number(23.976, { step: 'any', min: 1, ariaLabel: 'Frame rate for MicroDVD', onInput: () => { fpsUser = true; render() } })
  const fpsField = field('Frame rate (MicroDVD)', fpsRate)
  const samiSel = select(SAMI_LANGS.map(([c, n, l]) => [c, `${n} (${l})`]), 'ENCC', () => render())
  const samiField = field('SAMI language', samiSel)
  const outNote = h('p', { class: 'small muted', 'aria-live': 'polite' })
  const optRow = h('div', { class: 'grid-auto' }, encField, langField, fpsField, samiField)
  function decodeRaw() {
    const r = decodeBytes(rawBytes, encSel.value)
    input.value = r.text
    encHint.textContent = encSel.value === 'auto' ? `Detected: ${ENC_NAME[r.encoding] || r.encoding}. Saved as UTF-8.` : 'Saved as UTF-8.'
    render()
  }

  // ---- timing controls ----
  const shiftIn = number(0, { step: 50, ariaLabel: 'Shift in milliseconds', placeholder: '0', onInput: () => render() })
  const nudge = (d) => { shiftIn.value = String((Number.isFinite(shiftIn.valueAsNumber) ? shiftIn.valueAsNumber : 0) + d); render() }
  const shiftPane = h('div', { class: 'stack tight' },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Shift every subtitle by (milliseconds)'), shiftIn, h('small', { class: 'field-hint' }, 'Positive numbers show subtitles later, negative ones earlier. 1000 ms is one second.')),
    h('div', { class: 'mc-chipbar' }, NUDGES.map((d) => h('button', { type: 'button', class: 'mc-pill-btn', onclick: () => nudge(d), 'aria-label': `${d > 0 ? 'Later' : 'Earlier'} by ${Math.abs(d)} milliseconds` }, `${d > 0 ? '+' : ''}${d}`)),
      h('button', { type: 'button', class: 'mc-pill-btn', onclick: () => { shiftIn.value = '0'; render() } }, 'reset')))

  const fromIn = number(23.976, { step: 'any', min: 1, ariaLabel: 'Frame rate the subtitles were made for', onInput: () => render() })
  const toIn = number(25, { step: 'any', min: 1, ariaLabel: 'Frame rate of your video', onInput: () => render() })
  const presets = (inp) => h('div', { class: 'mc-chipbar' }, FPS_PRESETS.map((f) => h('button', { type: 'button', class: 'mc-pill-btn', onclick: () => { inp.value = String(f); render() } }, String(f))))
  const factorOut = h('p', { class: 'small muted', role: 'status' })
  const fpsPane = h('div', { class: 'stack tight' },
    h('div', { class: 'grid-2' },
      h('div', { class: 'stack tight' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Subtitles were made for (fps)'), fromIn), presets(fromIn)),
      h('div', { class: 'stack tight' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Your video runs at (fps)'), toIn), presets(toIn))),
    h('div', { class: 'row' }, button('Swap', { icon: 'arrow-left-right', variant: 'ghost', size: 'sm', onClick: () => { const a = fromIn.value; fromIn.value = toIn.value; toIn.value = a; render() } }), factorOut))

  const mkAnchor = (label) => {
    const sel = h('select', { class: 'select', 'aria-label': `${label}: which subtitle`, onchange: () => { const c = cues[+sel.value]; if (c) { should.value = formatTime(c.start); } render() } })
    const was = h('output', { class: 'mono small muted' })
    const should = h('input', { class: 'input mono', 'aria-label': `${label}: should show at`, inputmode: 'decimal', placeholder: '0:01:23.500', spellcheck: false, oninput: () => render() })
    const el = h('div', { class: 'stack tight' }, h('strong', { class: 'small' }, label),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'This subtitle'), sel),
      h('div', { class: 'grid-2' },
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Now shows at'), was),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Should show at'), should)))
    return { el, sel, was, should }
  }
  const a1 = mkAnchor('Sync point 1 (early in the video)'), a2 = mkAnchor('Sync point 2 (near the end)')
  const syncOut = h('p', { class: 'small muted', role: 'status' })
  const syncPane = h('div', { class: 'stack tight' },
    h('p', { class: 'small muted' }, 'Pick one subtitle near the start and one near the end. Play your video to find when each is actually spoken and enter those times. Every other line is stretched to fit.'),
    h('div', { class: 'grid-2' }, a1.el, a2.el), syncOut)
  const panes = { shift: shiftPane, fps: fpsPane, sync: syncPane }
  const modeSeg = segmented(MODES, mode, (v) => { mode = v; render() }, 'Timing change')
  const paneHost = h('div')

  function fillAnchors() {
    const key = `${cues.length}:${cues[0]?.start}:${cues.at(-1)?.start}`
    if (anchorKey === key) return
    anchorKey = key
    const opts = cues.map((c, i) => h('option', { value: i }, `#${i + 1}  ${formatTime(c.start, 'short').replace(/\.\d$/, '')}  ${c.text.replace(/\s+/g, ' ').slice(0, 32)}`))
    for (const [a, idx] of [[a1, 0], [a2, Math.max(0, cues.length - 1)]]) {
      a.sel.replaceChildren(...opts.map((o) => o.cloneNode(true)))
      a.sel.value = String(idx)
      a.should.value = cues[idx] ? formatTime(cues[idx].start) : ''
    }
  }

  // ---- transform + render ----
  function transformed() {
    if (mode === 'off' || !cues.length) return { cues, note: '' }
    if (mode === 'shift') {
      const ms = shiftIn.valueAsNumber
      if (!Number.isFinite(ms) || ms === 0) return { cues, note: 'Enter a number of milliseconds to shift by.' }
      const r = shiftCues(cues, ms)
      return { ...r, note: `Every subtitle is ${Math.abs(ms) >= 1000 ? `${sec(Math.abs(ms) / 1000)} seconds` : `${Math.abs(ms)} ms`} ${ms > 0 ? 'later' : 'earlier'}.` }
    }
    if (mode === 'fps') {
      const f = fromIn.valueAsNumber, t = toIn.valueAsNumber
      if (!(f > 0 && t > 0)) return { cues, note: 'Enter both frame rates.' }
      const factor = f / t
      factorOut.textContent = factor === 1 ? 'Same frame rate, so nothing changes.' : `Every time is multiplied by ${factor.toFixed(5)} (a ${(factor > 1 ? 'slower' : 'faster')} timeline).`
      return { ...stretchCues(cues, factor), note: '' }
    }
    // sync
    const c1 = cues[+a1.sel.value], c2 = cues[+a2.sel.value]
    const b1 = parseTime(a1.should.value), b2 = parseTime(a2.should.value)
    a1.was.textContent = c1 ? formatTime(c1.start) : '-'
    a2.was.textContent = c2 ? formatTime(c2.start) : '-'
    if (!c1 || !c2 || !Number.isFinite(b1) || !Number.isFinite(b2)) { syncOut.textContent = 'Enter the two times you want, like 0:01:23.500 or 83.5.'; return { cues, note: '' } }
    try {
      const r = resyncCues(cues, c1.start, b1, c2.start, b2)
      syncOut.textContent = `Result: ${r.offsetMs >= 0 ? '+' : ''}${r.offsetMs} ms offset, speed x${r.scale.toFixed(5)}.`
      return r
    } catch (e) {
      syncOut.textContent = e.message
      return { cues, note: '' }
    }
  }

  function render() {
    modeSeg.set(mode)
    clear(paneHost, panes[mode] || null)
    const text = input.value
    parsed = text.trim() ? parseSubtitles(text, { fps: looksMicroDvd(text) && fpsUser && fpsRate.valueAsNumber > 0 ? fpsRate.valueAsNumber : undefined, lang: langSel.value }) : { format: 'unknown', cues: [] }
    cues = parsed.cues
    parsedFormat = parsed.format
    fillAnchors()
    const fmt = userFmt || (prefer && parsedFormat !== prefer ? prefer : DEFAULT_OUT[parsedFormat] || 'srt')
    outFmt.set(fmt)
    // option fields that only matter for some formats
    const langs = parsed.languages || []
    if (langs.length > 1 && langSel.options.length !== langs.length + 1) {
      const keep = langSel.value
      langSel.replaceChildren(...[['', `First language (${langs[0].name || langs[0].id})`], ...langs.map((l) => [l.id, `${l.name || l.id}${l.lang ? ` (${l.lang})` : ''}`])].map(([v, l]) => h('option', { value: v }, l)))
      langSel.value = keep
    }
    langField.hidden = langs.length < 2
    if (parsed.format === 'sub' && !fpsUser && Math.abs(fpsRate.valueAsNumber - parsed.fps) > 1e-6) fpsRate.value = String(parsed.fps)
    fpsField.hidden = !(parsed.format === 'sub' || fmt === 'sub')
    samiField.hidden = fmt !== 'smi'
    encField.hidden = !rawBytes
    optRow.hidden = encField.hidden && langField.hidden && fpsField.hidden && samiField.hidden
    outNote.textContent = OUT_NOTE[fmt] || ''
    clear(chips, parsed.cues.length ? [h('span', { class: 'badge local' }, icon('file-check'), `${FORMAT_NAMES[parsedFormat] || parsedFormat} detected`), h('span', { class: 'badge' }, icon('captions'), `${cues.length} lines`), h('span', { class: 'badge' }, icon('clock'), formatTime(cues.at(-1).end, 'short').replace(/\.\d$/, ''))] : null)
    clear(info, !text.trim() ? null : cues.length ? (parsed.enhanced ? alert('info', 'Word-by-word timing was found. Each line keeps its start time; the word timing is not carried over.') : null) : alert('warn', h('strong', 'No subtitle lines found. '), parsed.error || 'Check that the timing lines (00:00:01,000 --> 00:00:03,000) are present. If the text looks scrambled, pick the file encoding above.'))
    const r = transformed()
    tl.update(cues, r.cues)
    clear(summary)
    if (cues.length && mode !== 'off') {
      const notes = [r.note].filter(Boolean)
      if (r.dropped) notes.push(`${r.dropped} line${r.dropped === 1 ? '' : 's'} would start before 0:00 and ${r.dropped === 1 ? 'was' : 'were'} removed.`)
      if (r.clamped) notes.push(`${r.clamped} line${r.clamped === 1 ? '' : 's'} started before 0:00 and now start at 0:00.`)
      const idx = [...new Set([0, 1, 2, cues.length - 3, cues.length - 2, cues.length - 1].filter((i) => i >= 0 && i < cues.length))]
      const after = r.cues
      const sameLen = after.length === cues.length
      if (sameLen) {
        summary.append(h('div', { class: 'stack tight' },
          notes.length ? alert(r.dropped || r.clamped ? 'warn' : 'info', notes.join(' ')) : null,
          table({ columns: ['#', 'Before', 'After', 'Text'], rows: idx.map((i) => [String(i + 1), formatTime(cues[i].start), formatTime(after[i].start), cues[i].text.replace(/\s+/g, ' ').slice(0, 40)]) })))
      } else summary.append(notes.length ? alert('warn', notes.join(' ')) : null)
    }
    const sam = SAMI_LANGS.find((l) => l[0] === samiSel.value) || SAMI_LANGS[0]
    const out = cues.length ? format(r.cues, fmt, { title: baseName(fileName) || 'Subtitles', fps: fpsRate.valueAsNumber > 0 ? fpsRate.valueAsNumber : 23.976, sami: { className: sam[0], name: sam[1], lang: sam[2] }, ttmlLang: sam[2].split('-')[0] }) : ''
    output.value = out
    saveBtn.disabled = !out
    return r
  }

  const outName = () => {
    const f = userFmt || outFmt.value
    const base = baseName(fileName) || 'subtitles'
    return `${base}${mode !== 'off' ? '-synced' : ''}.${FILE_EXT[f] || f}`
  }
  const saveBtn = button('Download', { icon: 'download', variant: 'primary', size: 'sm', disabled: true, onClick: () => download(output.value, outName(), MIME[userFmt || outFmt.value] || 'text/plain') })
  input.addEventListener('input', debounce(() => { rawBytes = null; render() }, 120))
  const looksMicroDvd = (text) => /^\s*\{\d+\}\s*\{\d+\}/m.test(text.slice(0, 4000))

  const modeIntro = params?.tab === 'shift' ? 'Subtitles late or early? Use Shift for a constant delay, Frame rate when the drift grows over time, or Two-point sync to fix both at once.' : null
  root.append(h('div', { class: 'mc stack' },
    zone,
    split(
      panel(h('h2', 'Subtitles in'), h('div', { class: 'stack tight' }, input, chips, info, optRow,
        h('div', { class: 'row' }, button('Try an example', { icon: 'sparkles', variant: 'ghost', size: 'sm', onClick: () => { fileName = ''; input.value = SAMPLE; render() } }),
          button('Clear', { icon: 'eraser', variant: 'ghost', size: 'sm', onClick: () => { input.value = ''; fileName = ''; render(); input.focus() } })))),
      panel(h('h2', 'Result'), h('div', { class: 'stack tight' }, outFmt, outNote, output, h('div', { class: 'row' }, copyButton(() => output.value, 'Copy'), saveBtn)))),
    panel(h('h2', h('span', { class: 'row', style: 'gap:8px;flex-wrap:nowrap' }, icon('timer'), 'Fix the timing')),
      h('div', { class: 'stack' }, modeIntro ? h('p', { class: 'small muted' }, modeIntro) : null, tl.el, modeSeg, paneHost, summary)),
    h('p', { class: 'small muted' }, icon('shield-check'), ' Converted in your browser, nothing is uploaded, and the result is always UTF-8. Positions are kept to the millisecond where the format allows it.')))
  render()
}
