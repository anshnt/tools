// One converter screen for every document route in this pack (e-mail, OpenDocument, Rich Text, spreadsheets, presentations, e-books, HWP, source code,
// MHTML, notebooks). The catalog entries pass params {from, to, def, noun, hint}; routes and their options come from _convert.js, the same code the
// File Converter hub uses.
import { h, button, busy, progress, alert, segmented, select, toggle, input, number, field, panel, stack, row, dropzone, fileList, clear, download, formatBytes, onCleanup, isAbort } from '../../lib/ui.js'
import { ext as extOf, zip as zipFiles, baseName } from '../../lib/files.js'
import { CONVERTERS } from './_convert.js'

const CSS = `
.t-cd .cd-res { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.t-cd .cd-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); flex-wrap: wrap; }
.t-cd .cd-item .meta { flex: 1; min-width: 150px; } .t-cd .cd-item .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t-cd .cd-item .sz { color: var(--muted); font-size: 12.5px; }
.t-cd .cd-item.err { border-color: color-mix(in srgb, var(--danger) 45%, var(--border)); }
.t-cd .cd-from { font: 600 11px var(--mono); color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.t-cd .cd-note { color: var(--muted); font-size: 12.5px; margin: 0; }
`
const injectCss = () => { if (!document.getElementById('t-cd-css')) document.head.append(Object.assign(document.createElement('style'), { id: 't-cd-css', textContent: CSS })) }

const routeFor = (ext, to) => CONVERTERS.find((r) => r.from.includes(ext) && r.to.includes(to))
const TYPE_LABEL = { pdf: 'PDF', html: 'HTML', txt: 'Text', docx: 'Word', odt: 'ODT', rtf: 'RTF', md: 'Markdown', eml: 'EML', epub: 'EPUB', hwpx: 'HWPX', xlsx: 'Excel', xls: 'Excel 97', ods: 'ODS', csv: 'CSV', tsv: 'TSV', json: 'JSON', pptx: 'PowerPoint', rst: 'reStructuredText', adoc: 'AsciiDoc', org: 'Org', tex: 'LaTeX', wiki: 'MediaWiki', textile: 'Textile', dbk: 'DocBook', ipynb: 'Notebook', opml: 'OPML', man: 'man page' }

export function mount(root, { params, signal }) {
  injectCss()
  const accept = params.from.map((e) => `.${e}`).join(',')
  const S = { to: params.def || params.to[0], opts: {} }
  const fl = fileList({ files: [], onChange: () => refresh() })
  const optsHost = h('div', { class: 'stack' })
  const targetHost = h('div')
  const results = h('div', { class: 'stack' })
  const prog = progress()
  const note = h('p', { class: 'cd-note' }, params.hint || 'Runs on your device. Nothing is uploaded.')

  const zone = dropzone({
    accept, multiple: true, label: params.label || `Drop ${params.noun || 'files'} here or click to choose`, hint: params.zoneHint || `${params.from.map((e) => '.' + e).join(' ')} files. Nothing is uploaded.`,
    onFiles: (files) => { fl.add(files.filter((f) => !fl.files.some((x) => x.name === f.name && x.size === f.size))); refresh() },
  })

  function targets() {
    const exts = [...new Set(fl.files.map((f) => extOf(f.name)))]
    return params.to.filter((t) => !exts.length || exts.every((e) => routeFor(e, t)))
  }
  function renderTargets() {
    const list = targets()
    if (!list.length) { clear(targetHost, alert('error', 'These files cannot be converted to the same format together. Remove some of them.')); return }
    if (!list.includes(S.to)) S.to = list.includes(params.def) ? params.def : list[0]
    const opts = list.map((t) => [t, TYPE_LABEL[t] || t.toUpperCase()])
    clear(targetHost, field('Convert to', opts.length > 6 ? select(opts, S.to, (v) => { S.to = v; refresh(true) }) : segmented(opts, S.to, (v) => { S.to = v; refresh(true) }, 'Convert to')))
  }
  function renderOptions() {
    const exts = [...new Set(fl.files.map((f) => extOf(f.name)))]
    const defs = new Map()
    for (const e of exts.length ? exts : params.from) { const r = routeFor(e, S.to); for (const o of r?.options || []) if (!defs.has(o.key)) defs.set(o.key, o) }
    for (const o of defs.values()) if (!(o.key in S.opts)) S.opts[o.key] = o.default
    clear(optsHost)
    for (const o of defs.values()) {
      if (o.type === 'toggle') optsHost.append(toggle(o.label, S.opts[o.key], (v) => { S.opts[o.key] = v }))
      else if (o.type === 'select') optsHost.append(field(o.label, select(o.choices, S.opts[o.key], (v) => { S.opts[o.key] = /^\d+$/.test(v) ? Number(v) : v })))
      else if (o.type === 'number') optsHost.append(field(o.label, number(S.opts[o.key], { min: o.min, max: o.max, onInput: (n) => { if (!Number.isNaN(n)) S.opts[o.key] = n } })))
      else optsHost.append(field(o.label, input({ value: S.opts[o.key] ?? '', 'aria-label': o.label, oninput: (e) => { S.opts[o.key] = e.target.value } })))
    }
    optsHost.hidden = !defs.size
  }
  const baseHint = params.hint || 'Runs on your device. Nothing is uploaded.'
  const syncNote = () => {
    const pagePictures = S.to === 'pdf' && !params.from.some((e) => ['py', 'js', 'c'].includes(e)) && !params.from.includes('odp')
    note.textContent = pagePictures ? `${baseHint} PDF pages are saved as pictures with a hidden text layer for Latin, Greek, Cyrillic and Indic text, so other scripts (Korean, Chinese, Japanese) look right but cannot be selected.` : S.to === 'pdf' && params.from.includes('odp') ? `${baseHint} Slides are saved as pictures, so their text cannot be selected.` : baseHint
  }
  function refresh(keepFiles) {
    if (!keepFiles) clear(results)
    renderTargets()
    renderOptions()
    syncNote()
    go.disabled = !fl.files.length || !targets().length
    fl.el.hidden = !fl.files.length
    clear(go, h('span', fl.files.length > 1 ? `Convert ${fl.files.length} files` : 'Convert'))
  }
  fl.el.hidden = true
  const go = button('Convert', { variant: 'primary', size: 'lg', disabled: true })
  go.addEventListener('click', () => busy(go, run, { label: 'Converting', errorTo: results, progress: prog }))

  const used = new Set()
  /** Give every result its own name, so two sources called "sample" do not overwrite each other. */
  function uniq(o) {
    let name = o.name, n = 2
    while (used.has(name)) name = o.name.replace(/(\.[^.]*)?$/, (m) => ` (${n++})${m}`)
    used.add(name)
    return name === o.name ? o : new File([o], name, { type: o.type })
  }

  async function run() {
    used.clear()
    const files = [...fl.files]
    fl.setDisabled(true)
    clear(results)
    const list = h('ul', { class: 'cd-res' })
    results.append(list)
    const all = []
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        const r = routeFor(extOf(f.name), S.to)
        const item = (inner, cls) => h('li', { class: ['cd-item', cls] }, inner)
        try {
          if (!r) throw new Error(`Cannot convert .${extOf(f.name)} files to ${S.to}.`)
          prog.set(i / files.length, files.length > 1 ? `File ${i + 1} of ${files.length}: ${f.name}` : `Converting ${f.name}`)
          const outs = [].concat(await r.run(f, S.to, { ...S.opts }, { signal, onProgress: (p, t) => prog.set((i + (p || 0)) / files.length, t || f.name) }))
          for (const [k, o0] of outs.entries()) {
            const o = uniq(o0)
            all.push(o)
            list.append(item([
              h('div', { class: 'meta' }, h('div', { class: 'name', title: o.name }, o.name), h('div', { class: 'sz' }, k === 0 ? `${formatBytes(f.size)} in, ${formatBytes(o.size)} out` : `${formatBytes(o.size)}${/\.(png|jpe?g|gif)$/i.test(o.name) || k > 0 ? ' attachment' : ''}`)),
              button('Download', { icon: 'download', variant: k === 0 ? 'primary' : 'secondary', onClick: () => download(o, o.name) }),
            ]))
          }
        } catch (e) {
          if (isAbort(e)) throw e
          console.error(e)
          list.append(item(h('div', { class: 'meta' }, h('div', { class: 'name', title: f.name }, f.name), h('div', { class: 'sz', style: 'color:var(--danger)' }, e.message || 'Could not convert this file')), 'err'))
        }
      }
      if (all.length > 1) {
        results.append(button('Download all (ZIP)', { icon: 'archive', onClick: async () => download(await zipFiles(all.map((o) => ({ name: o.name, data: o }))), `${baseName(files[0].name)}-converted.zip`) }))
      }
    } finally { fl.setDisabled(false) }
  }

  root.append(h('div', { class: 't-cd stack' }, zone, fl.el, panel(h('div', { class: 'stack' }, targetHost, optsHost, h('div', { class: 'row' }, go), note, prog.el)), results))
  refresh()
  onCleanup(() => fl.destroy?.())
}
void stack; void row
