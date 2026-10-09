// Subtitle to text: parse SRT, WebVTT and ASS, strip timing and markup, optionally merge lines into paragraphs.
// Drop several files for a batch; copy the result or download it as TXT (or all as a ZIP).
import { h, icon, button, alert, dropzone, stats, textarea, split, panel, copyButton, download, clear, debounce, formatNumber, toast } from '../../lib/ui.js'
import { zip, baseName } from '../../lib/files.js'
import { load, save } from '../../lib/store.js'
import * as K from './_kit.js'
import { SUB_ACCEPT, parseSubtitles, toPlain, decodeText, formatTime } from './_subs.js'

const GAPS = [['1', '1 second'], ['2.5', '2.5 seconds'], ['4', '4 seconds'], ['8', '8 seconds']]
const SAMPLE = `WEBVTT

00:00:01.000 --> 00:00:03.000
[Music]

00:00:03.500 --> 00:00:06.000
JOHN: Welcome back to the show.
Today we are <i>cleaning up</i> subtitles.

00:00:06.000 --> 00:00:08.000
Today we are <i>cleaning up</i> subtitles.

00:00:08.200 --> 00:00:10.500
- Is it that easy?
- Yes, it is.

00:00:20.000 --> 00:00:22.500
Ten seconds later, a new paragraph begins.
`
const FORMAT_NAME = { srt: 'SRT', vtt: 'WebVTT', ass: 'ASS', unknown: 'Unknown' }

export function mount(root) {
  K.useStyle()
  const prefs = { merge: true, gap: '2.5', dedupe: true, noSounds: false, noSpeakers: false, dashes: false, ...load('mc:sub2txt', {}) }
  const keep = () => save('mc:sub2txt', prefs)
  /** @type {{name: string, text: string}[]} */
  let docs = []
  let active = 0

  const input = textarea({ rows: 14, mono: true, placeholder: 'Paste SRT, VTT or ASS text here, or drop files above...', 'aria-label': 'Subtitle text', spellcheck: false })
  const output = textarea({ rows: 14, readonly: true, placeholder: 'The clean text appears here.', 'aria-label': 'Clean text' })
  const info = h('div')
  const statsHost = h('div')
  const picker = h('select', { class: 'select', 'aria-label': 'Which file', onchange: () => { active = +picker.value; input.value = docs[active].text; render() } })
  const pickerWrap = h('div', { class: 'row', hidden: true }, icon('files'), h('div', { class: 'grow' }, picker))
  const zone = dropzone({
    accept: SUB_ACCEPT, multiple: true, compact: true, label: 'Drop subtitle files here or click to browse', hint: 'SRT, VTT, ASS and SSA. Several files at once is fine.', icon: 'captions',
    onFiles: async (files) => {
      const read = await Promise.all(files.map(async (f) => ({ name: f.name, text: decodeText(await f.arrayBuffer()) })))
      docs = read
      active = 0
      input.value = docs[0].text
      fillPicker()
      render()
    },
  })

  const opt = (key, ic, title, desc) => K.optToggle({ icon: ic, title, desc, checked: prefs[key], onChange: (v) => { prefs[key] = v; keep(); render() } })
  const merge = opt('merge', 'wrap-text', 'Make paragraphs', 'Join the lines into flowing text')
  const gap = K.optSelect({ icon: 'timer', title: 'New paragraph after', desc: 'A pause this long starts a paragraph', options: GAPS, value: prefs.gap, onChange: (v) => { prefs.gap = v; keep(); render() } })
  const opts = h('div', { class: 'mc-opts' }, merge, gap,
    opt('dedupe', 'copy-minus', 'Remove repeats', 'Drop a line that repeats the one before'),
    opt('noSounds', 'volume-x', 'Remove [sounds]', 'Drop [Music], (applause) and notes'),
    opt('noSpeakers', 'user-round-x', 'Remove speaker names', 'Drop labels like JOHN:'),
    opt('dashes', 'minus', 'Remove dialogue dashes', 'Drop "- " at the start of lines'))

  function fillPicker() {
    picker.replaceChildren(...docs.map((d, i) => h('option', { value: i }, d.name)))
    picker.value = String(active)
    pickerWrap.hidden = docs.length < 2
  }

  const convert = (text) => {
    const parsed = parseSubtitles(text)
    return { parsed, text: toPlain(parsed.cues, { merge: prefs.merge, gap: +prefs.gap, dedupe: prefs.dedupe, noSounds: prefs.noSounds, noSpeakers: prefs.noSpeakers, dashes: prefs.dashes }) }
  }

  function render() {
    gap.classList.toggle('off', !prefs.merge)
    const text = input.value
    if (!docs.length && text.trim()) docs = [{ name: 'pasted-subtitles.txt', text }]
    if (docs[active]) docs[active].text = text
    if (!text.trim()) {
      output.value = ''
      clear(info, null)
      clear(statsHost)
      return
    }
    const { parsed, text: out } = convert(text)
    output.value = out
    const words = (out.match(/\S+/g) || []).length
    clear(info, parsed.cues.length ? null : alert('warn', h('strong', 'No subtitle lines found. '), 'This does not look like SRT, VTT or ASS, so there is nothing to clean. Check that the timing lines (00:00:01,000 --> 00:00:03,000) are there.'))
    clear(statsHost, parsed.cues.length ? stats([
      { label: 'Format', value: FORMAT_NAME[parsed.format], accent: true },
      { label: 'Subtitle lines', value: formatNumber(parsed.cues.length, 0) },
      { label: 'Words', value: formatNumber(words, 0) },
      { label: 'Characters', value: formatNumber(out.length, 0) },
      { label: 'Runs for', value: formatTime(parsed.cues.at(-1).end, 'short').replace(/\.\d$/, '') },
    ]) : null)
  }
  input.addEventListener('input', debounce(render, 120))

  const dlOne = () => download(output.value, `${baseName(docs[active]?.name || 'subtitles')}.txt`, 'text/plain')
  const dlAll = async (btn) => {
    btn.disabled = true
    try {
      const z = await zip(docs.map((d) => ({ name: `${baseName(d.name)}.txt`, data: convert(d.text).text })))
      download(z, 'subtitles-text.zip')
    } catch (e) { toast(e.message || 'Could not make the zip', 'error') } finally { btn.disabled = false }
  }
  const dlAllBtn = button('Download all as ZIP', { icon: 'archive', variant: 'secondary', size: 'sm', onClick: (e) => dlAll(e.currentTarget) })
  const sync = new MutationObserver(() => { dlAllBtn.hidden = docs.length < 2 })
  sync.observe(pickerWrap, { attributes: true, attributeFilter: ['hidden'] })
  dlAllBtn.hidden = true

  root.append(h('div', { class: 'mc stack' },
    zone,
    split(
      panel(h('h2', 'Subtitles in'), h('div', { class: 'stack tight' }, pickerWrap, input, h('div', { class: 'row' }, button('Try an example', { icon: 'sparkles', variant: 'ghost', size: 'sm', onClick: () => { docs = []; active = 0; input.value = SAMPLE; fillPicker(); render() } }), button('Clear', { icon: 'eraser', variant: 'ghost', size: 'sm', onClick: () => { docs = []; active = 0; input.value = ''; fillPicker(); render(); input.focus() } })))),
      panel(h('h2', 'Clean text'), h('div', { class: 'stack tight' }, output,
        h('div', { class: 'row' }, copyButton(() => output.value, 'Copy text'), button('Download TXT', { icon: 'download', variant: 'primary', size: 'sm', onClick: () => (output.value ? dlOne() : toast('Nothing to download yet.', 'info')) }), dlAllBtn)))),
    info, opts, statsHost,
    h('p', { class: 'small muted' }, icon('shield-check'), ' Everything happens in this tab. Timing codes, HTML tags like <i>, ASS overrides like {\\an8} and music notes are removed. Files in old Windows encodings and UTF-16 are read correctly.')))
  render()
}
