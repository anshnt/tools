// Word to TXT: extract plain text from .docx files on the device (mammoth), one or many at a time.
import { h, dropzone, button, alert, empty, segmented, toggle, field, textarea, stats, progress, copyButton, downloadButton, download, formatBytes, formatNumber, clear, yieldToMain, toast } from '../../lib/ui.js'
import { mammoth as loadMammoth } from '../../lib/libs.js'
import { withExt, zip } from '../../lib/files.js'
import { toolRoot, kicker, note, celebrate, wordCount } from './_shared.js'

/** Apply the output options to text. */
export function tidy(raw, { spacing = 'blank', collapse = true } = {}) {
  let t = raw.replace(/\r\n?/g, '\n').replace(/ /g, ' ')
  if (collapse) t = t.split('\n').map((l) => l.replace(/[ \t]{2,}/g, (m) => (/^\t/.test(m) ? m : ' ')).replace(/[ \t]+$/g, '')).join('\n')
  t = t.replace(/\n{3,}/g, '\n\n').trim()
  if (spacing === 'tight') t = t.replace(/\n{2,}/g, '\n')
  return t + '\n'
}

/** Turn mammoth's HTML into text that keeps bullets, numbering and table rows (tab separated). */
export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out = []
  const own = (li) => {
    const c = li.cloneNode(true)
    c.querySelectorAll('ul, ol').forEach((n) => n.remove())
    return c.textContent.replace(/\s+/g, ' ').trim()
  }
  const list = (el, depth) => {
    let i = Number(el.getAttribute('start')) || 1
    for (const li of el.children) {
      if (li.tagName !== 'LI') continue
      out.push(`${'    '.repeat(depth)}${el.tagName === 'OL' ? `${i++}.` : '•'} ${own(li)}`)
      li.querySelectorAll(':scope > ul, :scope > ol').forEach((n) => list(n, depth + 1))
    }
    if (!depth) out.push('')
  }
  const walk = (parent) => {
    for (const el of parent.children) {
      if (el.tagName === 'UL' || el.tagName === 'OL') list(el, 0)
      else if (el.tagName === 'TABLE') {
        for (const tr of el.querySelectorAll('tr')) out.push([...tr.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim()).join('\t'))
        out.push('')
      } else if (el.children.length && !el.matches('p, h1, h2, h3, h4, h5, h6')) walk(el)
      else { const t = el.textContent.replace(/[ \t]+/g, ' ').trim(); if (t) out.push(t, '') }
    }
  }
  walk(doc.body)
  return out.join('\n')
}

export function mount(root) {
  const state = { items: [], sel: 0 }
  const opts = { spacing: 'blank', collapse: true, layout: 'plain' }
  const prog = progress('Reading documents')
  const listBox = h('div', { class: 'stack tight' })
  const view = h('div')
  const spacing = segmented([['blank', 'Blank line between paragraphs'], ['tight', 'No blank lines']], opts.spacing, (v) => { opts.spacing = v; render() }, 'Paragraph spacing')
  const layout = segmented([['plain', 'Plain text'], ['keep', 'Keep bullets and tables']], opts.layout, (v) => { opts.layout = v; render() }, 'Layout')
  const collapse = toggle('Remove extra spaces', opts.collapse, (v) => { opts.collapse = v; render() })
  const zone = dropzone({ accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document', multiple: true, label: 'Drop Word files here or click to browse', hint: '.docx files, as many as you like · or paste with Ctrl+V', onFiles })
  const options = h('section', { class: 'tw-stage', hidden: true }, h('div', { class: 'stack' }, kicker('Output', 'sliders-horizontal'),
    h('div', { class: 'row' }, field('Layout', layout), field('Paragraphs', spacing)), collapse))

  const cols = h('div', { class: ['tool-split', 'wide-right'] }, listBox, view)
  const textOf = (it) => tidy(opts.layout === 'keep' && it.html ? htmlToText(it.html) : it.raw, opts)

  async function onFiles(files) {
    const mammoth = await loadMammoth()
    prog.set(0, 'Reading documents')
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      prog.set(i / files.length, `Reading ${f.name}`)
      try {
        const buf = await f.arrayBuffer()
        const [raw, html] = await Promise.all([mammoth.extractRawText({ arrayBuffer: buf }), mammoth.convertToHtml({ arrayBuffer: buf })])
        state.items.push({ file: f, raw: raw.value, html: html.value, warnings: raw.messages.length })
      } catch (e) {
        state.items.push({ file: f, error: /zip|central directory|end of/i.test(e.message || '') ? 'This does not look like a .docx file. Old .doc files must be re-saved as .docx in Word first.' : e.message })
      }
      await yieldToMain()
    }
    prog.hide()
    state.sel = Math.max(0, state.items.length - files.length)
    render()
  }

  function render() {
    const n = state.items.length
    zone.classList.toggle('compact', n > 0)
    options.hidden = !n
    cols.style.gridTemplateColumns = n > 1 ? '' : 'minmax(0, 1fr)'
    clear(listBox)
    if (!n) { clear(view, empty('Your extracted text will appear here.', 'file-text')); return }
    const cur = state.items[state.sel] || state.items[0]
    if (n > 1) {
      listBox.append(kicker(`${n} documents`, 'files'), ...state.items.map((it, i) => {
        const text = it.error ? '' : textOf(it)
        return h('button', { type: 'button', class: 'tw-tile', 'aria-pressed': String(i === state.sel), onclick: () => { state.sel = i; render() } },
          h('b', it.file.name), h('span', it.error ? 'Could not read' : `${formatNumber(wordCount(text), 0)} words · ${formatBytes(new Blob([text]).size)}`))
      }))
    }
    if (cur.error) { clear(view, alert('error', h('strong', cur.file.name), h('div', cur.error))); return }
    const text = textOf(cur)
    const words = wordCount(text)
    const box = textarea({ readonly: true, rows: 14, value: text, 'aria-label': 'Extracted text' })
    clear(view, h('div', { class: 'tw-stage tw-result-in', style: 'position:relative' }, h('div', { class: 'stack' },
      h('div', { class: 'tw-head' }, kicker(cur.file.name, 'file-text'),
        h('div', { class: 'row' }, copyButton(() => textOf(cur), 'Copy'), downloadButton(() => new Blob([textOf(cur)], { type: 'text/plain;charset=utf-8' }), withExt(cur.file.name, 'txt'), 'Download .txt', { size: 'sm' }))),
      box,
      stats([{ label: 'Words', value: formatNumber(words, 0), accent: true }, { label: 'Characters', value: formatNumber(text.length - 1, 0) }, { label: 'Lines', value: formatNumber(text.trim().split('\n').length, 0) },
        { label: 'Source size', value: formatBytes(cur.file.size) }]),
      cur.warnings ? note(`${cur.warnings} part(s) of the document could not be converted (for example unsupported objects). The text around them is kept.`, 'triangle-alert') : null,
      state.items.filter((i) => !i.error).length > 1 ? button(`Download all ${state.items.filter((i) => !i.error).length} as .zip`, { icon: 'folder-archive', variant: 'secondary', onClick: async () => {
        const ok = state.items.filter((i) => !i.error)
        download(await zip(ok.map((it) => ({ name: withExt(it.file.name, 'txt'), data: textOf(it) }))), 'word-to-txt.zip')
        toast('ZIP ready', 'success')
      } }) : null)))
    if (!cur._shown) { cur._shown = true; celebrate(view.firstChild) }
  }

  render()
  root.append(toolRoot('word-to-txt', zone, prog.el, options, cols,
    note('Files are read in your browser and never uploaded. Works with .docx; save older .doc files as .docx in Word first.', 'shield-check')))
}
