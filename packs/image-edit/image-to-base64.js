// Image to Base64: encode images as data URIs, raw Base64, HTML, CSS or Markdown snippets.
import {
  shell, h, icon, button, chips, section, note, hint, batchSlot, clear, toast, errorMessage, formatBytes, copyText, download, fileType, readSource,
} from './_kit.js'
import { readDataURL } from '../../lib/files.js'

const FORMATS = [['uri', 'Data URI', 'link'], ['raw', 'Base64 only', 'binary'], ['img', 'HTML <img>', 'code'], ['css', 'CSS', 'palette'], ['md', 'Markdown', 'file-text']]
const SHOW = 2400

/** Build the output text for a data URI. */
export function snippet(kind, dataUri, name = 'image') {
  const alt = name.replace(/\.[^.]+$/, '').replace(/["<>]/g, '')
  if (kind === 'raw') return dataUri.slice(dataUri.indexOf(',') + 1)
  if (kind === 'img') return `<img src="${dataUri}" alt="${alt}">`
  if (kind === 'css') return `background-image: url("${dataUri}");`
  if (kind === 'md') return `![${alt}](${dataUri})`
  return dataUri
}

export function mount(root) {
  let kind = 'uri'
  const entries = new Map() // file -> {uri, el}
  const list = h('div', { class: 'stack' })
  const fmt = chips(FORMATS, 'uri', (v) => { kind = v; for (const f of slot.files) paint(f) }, { label: 'Output' })

  async function build(file) {
    if (entries.has(file)) return entries.get(file)
    let uri = await readDataURL(file)
    const t = fileType(file)
    if (t && !uri.startsWith(`data:${t}`)) uri = uri.replace(/^data:[^;,]*/, `data:${t}`)
    const e = { uri, box: h('div', { class: 'panel ie-glass stack' }) }
    entries.set(file, e)
    return e
  }
  async function paint(file) {
    try {
      const e = await build(file)
      const text = snippet(kind, e.uri, file.name)
      const big = e.uri.length > 140_000
      const pre = h('pre', { class: 'code-out', tabindex: 0, 'aria-label': `Encoded ${file.name}` }, text.length > SHOW ? `${text.slice(0, SHOW)}\n... ${(text.length - SHOW).toLocaleString()} more characters. Use Copy to get all of it.` : text)
      const src = await readSource(file).catch(() => null)
      clear(e.box,
        h('div', { class: 'row' },
          h('img', { src: e.uri, alt: '', style: 'width:56px;height:56px;object-fit:cover;border-radius:12px;background:var(--checker)' }),
          h('div', { class: 'grow' }, h('strong', file.name), h('div', { class: 'ie-note' }, `${src ? `${src.w} x ${src.h} px · ` : ''}${formatBytes(file.size)} becomes ${formatBytes(text.length)} of text (${text.length.toLocaleString()} characters, about ${file.size ? Math.round((text.length / file.size) * 100 - 100) : 0}% bigger)`)),
          button('Copy', { icon: 'copy', variant: 'primary', size: 'sm', onClick: () => copyText(text) }),
          button('Save .txt', { icon: 'download', size: 'sm', onClick: () => download(text, `${file.name.replace(/\.[^.]+$/, '')}-${kind}.txt`, 'text/plain') })),
        big ? h('div', { class: 'alert warn' }, icon('triangle-alert'), h('div', 'This is large. Inlining big images slows pages down and cannot be cached. Shrink it first, or link to the file instead.')) : null,
        pre)
    } catch (err) { toast(errorMessage(err), 'error') }
  }
  const slot = batchSlot({ ic: 'file-code', onChange: (fs) => {
    clear(list, fs.map((f) => { const e = entries.get(f); if (e) return e.box; const placeholder = h('div', { class: 'panel ie-glass' }, h('span', { class: 'spinner' })); build(f).then((en) => { placeholder.replaceWith(en.box); paint(f) }); return placeholder }))
    for (const f of [...entries.keys()]) if (!fs.includes(f)) entries.delete(f)
    out.hidden = !fs.length
  } })
  const out = h('div', { class: 'stack', hidden: true }, section('Output format', 'braces', fmt), list, hint('Base64 makes files about a third bigger. It is best for small icons and logos under 10 KB.', 'lightbulb'))
  root.append(shell(slot.el, out))
}
