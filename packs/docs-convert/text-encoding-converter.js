// Text encoding converter: open text files saved in an older encoding (EUC-KR, Shift_JIS, GBK, Big5, Windows code pages, KOI8-R, UTF-16 ...) and save them
// as UTF-8. The encoding is detected, shown with a live preview, and can be changed by hand if the guess is wrong.
import { h, button, busy, alert, select, toggle, field, panel, dropzone, fileList, clear, download, formatBytes, isAbort } from '../../lib/ui.js'
import { zip as zipFiles, baseName, ext as extOf } from '../../lib/files.js'
import { detectEncoding, decodeAs, toUtf8, ENCODINGS, labelName } from './_encoding.js'
import { u8 } from './_util.js'

const CSS = `
.t-enc .enc-prev { font: 13px/1.5 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 260px; overflow: auto; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 12px; margin: 0; min-height: 80px; }
.t-enc .enc-chip { display: inline-flex; gap: 6px; align-items: center; font-size: 12.5px; padding: 3px 10px; border-radius: 99px; background: var(--surface-3); color: var(--text-2); }
.t-enc .enc-chip.good { background: color-mix(in srgb, var(--success) 18%, var(--surface)); }
.t-enc .enc-chip.warn { background: color-mix(in srgb, #e8a317 22%, var(--surface)); }
.t-enc .cd-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); flex-wrap: wrap; }
.t-enc .cd-item .meta { flex: 1; min-width: 150px; } .t-enc .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .t-enc .sz { color: var(--muted); font-size: 12.5px; }
`
const CONF = { bom: ['Byte order mark', 'good'], certain: ['Certain', 'good'], high: ['Confident', 'good'], medium: ['Likely', 'warn'], low: ['Unsure, check the preview', 'warn'] }

export function mount(root) {
  if (!document.getElementById('t-enc-css')) document.head.append(Object.assign(document.createElement('style'), { id: 't-enc-css', textContent: CSS }))
  const S = { enc: 'auto', bom: false, eol: 'keep', sel: 0 }
  const info = new Map() // file -> {bytes, det}
  const fl = fileList({ files: [], onChange: () => refresh() })
  const chips = h('div', { class: 'row', style: 'flex-wrap:wrap' })
  const preview = h('pre', { class: 'enc-prev', 'aria-label': 'Decoded preview', tabindex: 0 })
  const fileSel = h('div')
  const encSel = h('div')
  const results = h('div', { class: 'stack' })
  const bomT = toggle('Add a UTF-8 byte order mark (helps older Windows apps)', false, (v) => { S.bom = v })
  const eolSel = select([['keep', 'Keep as is'], ['lf', 'LF (Mac, Linux)'], ['crlf', 'CRLF (Windows)']], 'keep', (v) => { S.eol = v })
  const go = button('Convert to UTF-8', { icon: 'file-check', variant: 'primary', size: 'lg', disabled: true })
  const body = panel(h('div', { class: 'stack' }, fileSel, encSel, chips, h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Preview'), preview), field('Line endings', eolSel), bomT, h('div', { class: 'row' }, go)))
  body.hidden = true
  const zone = dropzone({
    accept: '.txt,.csv,.tsv,.srt,.vtt,.lrc,.log,.ini,.cfg,.md,.xml,.html,.htm,.json,.sql,.tex,.ass,.sub,.nfo,.text', multiple: true, label: 'Drop text files here or click to choose', hint: 'Subtitles, CSV, logs, lyrics and any plain text. Nothing is uploaded.',
    onFiles: async (files) => { fl.add(files); await refresh() },
  })

  async function load(f) { if (!info.has(f)) { const bytes = await u8(f); info.set(f, { bytes, det: detectEncoding(bytes) }) } return info.get(f) }
  async function refresh() {
    clear(results)
    body.hidden = !fl.files.length
    fl.el.hidden = !fl.files.length
    go.disabled = !fl.files.length
    if (!fl.files.length) return
    if (S.sel >= fl.files.length) S.sel = 0
    const f = fl.files[S.sel]
    const d = await load(f)
    clear(fileSel, fl.files.length > 1 ? field('Preview file', select(fl.files.map((x, i) => [i, x.name]), S.sel, (v) => { S.sel = +v; refresh() })) : null)
    const label = S.enc === 'auto' ? d.det.label : S.enc
    clear(encSel, field('Encoding of the original', select([['auto', `Detect automatically (${labelName(d.det.label)})`], ...ENCODINGS], S.enc, (v) => { S.enc = v; refresh() }), 'Change it if the preview shows garbled characters.'))
    const [ctext, cls] = S.enc === 'auto' ? CONF[d.det.confidence] : ['Chosen by you', 'good']
    clear(chips, h('span', { class: `enc-chip ${cls}` }, `${labelName(label)}`), h('span', { class: `enc-chip ${cls}` }, ctext), h('span', { class: 'enc-chip' }, formatBytes(f.size)), d.det.reason && S.enc === 'auto' ? h('span', { class: 'enc-chip' }, d.det.reason) : null)
    const text = decodeAs(d.bytes.subarray(0, Math.min(d.bytes.length, 40000)), label)
    preview.textContent = text.length ? text.slice(0, 3000) : '(empty file)'
    if (text.includes('�')) chips.append(h('span', { class: 'enc-chip warn' }, 'Some bytes do not fit this encoding'))
  }
  go.addEventListener('click', () => busy(go, async () => {
    const outs = []
    const list = h('ul', { class: 'stack', style: 'list-style:none;margin:0;padding:0' })
    for (const f of fl.files) {
      const d = await load(f)
      const r = toUtf8(d.bytes, { from: S.enc, bom: S.bom, eol: S.eol })
      const ext = extOf(f.name)
      const name = ext ? `${baseName(f.name)}-utf8.${ext}` : `${f.name}-utf8.txt`
      const file = new File([r.bytes], name, { type: 'text/plain;charset=utf-8' })
      outs.push(file)
      list.append(h('li', { class: 'cd-item' }, h('div', { class: 'meta' }, h('div', { class: 'name', title: name }, name), h('div', { class: 'sz' }, `${labelName(r.from)} to UTF-8, ${formatBytes(f.size)} in, ${formatBytes(file.size)} out`)), button('Download', { icon: 'download', variant: 'primary', onClick: () => download(file, name) })))
    }
    clear(results, list, outs.length > 1 ? button('Download all (ZIP)', { icon: 'archive', onClick: async () => download(await zipFiles(outs.map((o) => ({ name: o.name, data: o }))), 'utf8-files.zip') }) : null)
  }, { label: 'Converting', errorTo: results }))

  root.append(h('div', { class: 't-enc stack' }, zone, fl.el, body, results))
  fl.el.hidden = true
  void alert; void isAbort
}
