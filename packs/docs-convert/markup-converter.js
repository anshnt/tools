// Markup converter: paste text or open a file, pick the formats, convert. Markdown <-> HTML and notebooks are instant; the other pairs load a converter
// engine once (about 60 MB, then cached by the browser).
import { h, button, busy, progress, select, field, panel, textarea, dropzone, clear, download, copyButton, alert, toast, formatBytes } from '../../lib/ui.js'
import { baseName } from '../../lib/files.js'
import { FORMATS, formatByExt, formatById, convertMarkup, readable, writable } from './_markup.js'

const SAMPLES = {
  markdown: '# Trip notes\n\nA **short** list with a [link](https://example.com):\n\n- Pack the *camera*\n- Charge `battery`\n\n1. First stop\n2. Second stop\n\n| Day | Place |\n| --- | --- |\n| 1 | Seoul |\n| 2 | Busan |\n\n> Travel light.\n',
  html: '<h1>Trip notes</h1>\n<p>A <b>short</b> list with a <a href="https://example.com">link</a>:</p>\n<ul><li>Pack the <i>camera</i></li><li>Charge <code>battery</code></li></ul>\n<table><tr><th>Day</th><th>Place</th></tr><tr><td>1</td><td>Seoul</td></tr></table>\n',
  rst: 'Trip notes\n==========\n\nA **short** list with a `link <https://example.com>`__:\n\n- Pack the *camera*\n- Charge ``battery``\n',
  asciidoc: '= Trip notes\n\nA *short* list with a https://example.com[link]:\n\n* Pack the _camera_\n* Charge `battery`\n\n== Stops\n\n. First stop\n. Second stop\n',
  org: '* Trip notes\nA *short* list with a [[https://example.com][link]]:\n- Pack the /camera/\n- Charge =battery=\n',
  latex: '\\section{Trip notes}\nA \\textbf{short} list with a \\href{https://example.com}{link}:\n\\begin{itemize}\n\\item Pack the \\emph{camera}\n\\item Charge \\texttt{battery}\n\\end{itemize}\n',
  mediawiki: '= Trip notes =\nA \'\'\'short\'\'\' list with a [https://example.com link]:\n* Pack the \'\'camera\'\'\n* Charge <code>battery</code>\n',
  textile: 'h1. Trip notes\n\nA *short* list with a "link":https://example.com:\n\n* Pack the _camera_\n* Charge @battery@\n',
}

export function mount(root, { signal }) {
  const S = { from: 'markdown', to: 'html', auto: true, name: 'document' }
  const prog = progress()
  const input = textarea({ rows: 14, mono: true, placeholder: 'Paste your text here, or open a file above.', 'aria-label': 'Input text', spellcheck: false })
  const output = textarea({ rows: 14, mono: true, readonly: true, placeholder: 'The result appears here.', 'aria-label': 'Converted text' })
  const result = h('div', { class: 'stack' })
  const fromSel = select(readable().map((f) => [f.id, f.label]), S.from, (v) => { S.from = v; S.auto = false })
  const toSel = select(writable().map((f) => [f.id, f.label]), S.to, (v) => { S.to = v })
  const go = button('Convert', { icon: 'arrow-right-left', variant: 'primary', size: 'lg' })
  const swap = button('Swap', { icon: 'arrow-left-right', ariaLabel: 'Swap the two formats and move the result into the input', onClick: () => {
    const f = formatById(S.to)
    if (!f?.read && f?.id !== 'asciidoc') return toast(`${f?.label || 'That format'} can only be written, not read.`)
    const prev = S.from
    S.from = S.to; S.to = prev; fromSel.value = S.from; toSel.value = S.to
    if (output.value) input.value = output.value
    output.value = ''
  } })
  const sample = button('Sample', { icon: 'file-text', variant: 'ghost', onClick: () => { input.value = SAMPLES[S.from] || SAMPLES.markdown; if (!SAMPLES[S.from]) { S.from = 'markdown'; fromSel.value = 'markdown' } } })
  const zone = dropzone({
    accept: FORMATS.flatMap((f) => f.exts.map((e) => `.${e}`)).join(','), label: 'Open a file (or paste text below)', hint: '.md .html .rst .adoc .org .tex .wiki .textile .dbk .ipynb .opml .man', paste: false, compact: true,
    onFiles: async ([f]) => {
      const text = await f.text()
      input.value = text
      S.name = baseName(f.name)
      const fmt = formatByExt(f.name.split('.').pop())
      if (fmt && (fmt.read || fmt.id === 'asciidoc')) { S.from = fmt.id; fromSel.value = fmt.id; S.auto = true }
      toast(`Opened ${f.name} (${formatBytes(f.size)})`)
    },
  })
  const dlBtn = button('Download', { icon: 'download', disabled: true, onClick: () => {
    const f = formatById(S.to)
    download(new Blob([output.value], { type: f.id === 'html' ? 'text/html' : 'text/plain;charset=utf-8' }), `${S.name}.${f.ext}`)
  } })
  const copyBtn = copyButton(() => output.value)
  go.addEventListener('click', () => busy(go, async () => {
    clear(result)
    if (S.from === S.to) throw new Error('Pick two different formats.')
    const heavy = !((S.from === 'markdown' && S.to === 'html') || (S.from === 'html' && S.to === 'markdown') || (S.from === 'ipynb' && ['html', 'markdown'].includes(S.to)) || (S.from === 'asciidoc' && S.to === 'html'))
    if (heavy) prog.set(null, 'Preparing')
    const text = await convertMarkup(input.value, S.from, S.to, { onProgress: (p, t) => prog.set(p, t), title: S.name })
    output.value = text
    dlBtn.disabled = !text
    clear(result, alert('success', `Converted ${formatById(S.from).label} to ${formatById(S.to).label} (${formatBytes(new Blob([text]).size)}).`))
  }, { label: 'Converting', errorTo: result, progress: prog }))
  void signal

  root.append(h('div', { class: 'stack' }, zone,
    panel(h('div', { class: 'stack' },
      h('div', { class: 'grid-2' }, field('From', fromSel), field('To', toSel)),
      h('div', { class: 'row', style: 'flex-wrap:wrap' }, go, swap, sample),
      h('small', { class: 'muted' }, 'Markdown to HTML and notebooks convert instantly. Other pairs load a converter engine once (about 60 MB, then cached). Nothing is uploaded.'),
      prog.el, result)),
    h('div', { class: 'tool-split' }, field('Input', input), h('div', { class: 'stack' }, field('Result', output), h('div', { class: 'row' }, copyBtn, dlBtn)))))
}
