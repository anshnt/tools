// Shared converter shell for the data-formats tools: Text tab (paste, live result, copy, download) and Files tab (batch).
// A tool passes a config: its formats, the options panel and a convert(input, from, to, opts, ctx) function.
import { h, icon, clear, button, busy, dropzone, fileList, field, select, segmented, panel, alert, progress, copyButton, download, downloadButton, formatBytes, debounce, textarea, toast, errorMessage, yieldToMain, isAbort } from '../../lib/ui.js'
import { zip, ext as extOf, baseName, safeName, pickFiles } from '../../lib/files.js'

const MAX_BYTES = 300 * 1024 * 1024
const CSS = `
.fc-shell .fc-fmt{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
.fc-shell .fc-fmt .field{flex:1 1 170px;min-width:0}
.fc-shell .fc-fixed{display:flex;align-items:center;gap:8px;flex:1 1 auto;font-weight:600;min-height:40px}
.fc-shell .fc-fixed svg{width:18px;height:18px;color:var(--muted)}
.fc-shell textarea.fc-io{width:100%;min-height:320px;font-size:13px;line-height:1.5;white-space:pre;overflow:auto;resize:vertical}
.fc-shell .fc-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}
.fc-shell .fc-status{color:var(--muted);font-size:13px;margin:0}
.fc-shell .fc-opts{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px 18px}
.fc-shell .fc-opts .fc-group{display:flex;flex-direction:column;gap:10px;min-width:0}
.fc-shell .fc-opts h3{margin:0;font-size:13px;font-weight:650;color:var(--text-2)}
.fc-shell .fc-res{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}
.fc-shell .fc-res .nm{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.fc-shell .fc-res .sz{color:var(--muted);font-size:12.5px;white-space:nowrap}
.fc-shell .fc-priv{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:12.5px;margin:0}
.fc-shell .fc-priv svg{width:14px;height:14px}
.fc-shell .fc-empty{padding:28px 12px;text-align:center;color:var(--muted);border:1px dashed var(--border);border-radius:12px}
@media (max-width:640px){.fc-shell textarea.fc-io{min-height:220px}.fc-shell .fc-res{flex-wrap:wrap}}
@media (prefers-reduced-motion:no-preference){.fc-shell .fc-res{animation:fcIn .25s ease both}@keyframes fcIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}}
`
function injectStyle() {
  if (document.getElementById('fc-shell-style')) return
  document.head.append(h('style', { id: 'fc-shell-style' }, CSS))
}

/** A labelled group inside the options panel. */
export const optGroup = (title, ...kids) => h('div', { class: 'fc-group' }, title && h('h3', title), kids)

/**
 * cfg: { formats: [[key, label]], outFormats: [[key, label]], from, to, fixed, swappable, autoFrom, defaults,
 *   accept(fromKey) -> string, isBinary(key), sniff(text) -> key|null, detectName(name) -> key|null, sample(key) -> string,
 *   options(st, changed) -> Element|null, convert(input, from, to, opts, ctx) -> { outputs, warnings, info }, display(output, st) -> string|null,
 *   outName(inName, output, from) -> string, hint }
 */
export function mountConverter(root, { signal, cfg }) {
  injectStyle()
  const st = { mode: 'text', from: cfg.from, to: cfg.to, opts: { ...cfg.defaults } }
  const labelOf = (list, k) => list.find((x) => x[0] === k)?.[1] || k
  const el = h('div', { class: 'fc-shell stack' })
  root.append(el)

  // ---- formats row ----
  const fixedLabel = h('div', { class: 'fc-fixed' })
  const fromSel = select([...(cfg.autoFrom ? [['auto', 'Detect automatically']] : []), ...cfg.formats], st.from, (v) => { st.from = v; onFormats() })
  const toSel = select(cfg.outFormats, st.to, (v) => { st.to = v; onFormats() })
  const swapBtn = button('', { icon: 'arrow-left-right', variant: 'secondary', ariaLabel: 'Swap the two formats', onClick: () => swap() })
  function swap() {
    const f = st.from, t = st.to
    if (f === 'auto') return toast('Choose the input format first, then you can swap.')
    if (!cfg.formats.some((x) => x[0] === t) || !cfg.outFormats.some((x) => x[0] === f)) return toast(`${labelOf(cfg.outFormats, f)} cannot be the result here.`)
    st.from = t
    st.to = f
    fromSel.value = t
    toSel.value = f
    onFormats()
  }
  const fmtRow = cfg.fixed
    ? h('div', { class: 'fc-fmt' }, fixedLabel, cfg.swappable ? swapBtn : null)
    : h('div', { class: 'fc-fmt' }, field('From', fromSel), swapBtn, field('To', toSel))
  const syncFixed = () => clear(fixedLabel, h('span', labelOf(cfg.formats, st.from)), icon('arrow-right'), h('span', labelOf(cfg.outFormats, st.to)))

  // ---- options ----
  const optHost = h('div')
  const buildOptions = () => {
    const o = cfg.options?.(st, onOpt)
    clear(optHost, o ? panel(h('div', { class: 'fc-opts' }, o)) : null)
  }

  // ---- text pane ----
  let last = null // { outputs, warnings, info }
  let gen = 0
  const input = textarea({ mono: true, class: 'fc-io', placeholder: 'Paste your data here...', spellcheck: false, 'aria-label': 'Input', oninput: () => debRun() })
  const output = textarea({ mono: true, class: 'fc-io', readonly: true, placeholder: 'The converted result appears here.', 'aria-label': 'Result' })
  const status = h('p', { class: 'fc-status', 'aria-live': 'polite' })
  const msgHost = h('div', { class: 'stack' })
  const dlBtn = button('Download', { icon: 'download', variant: 'primary', size: 'sm', disabled: true, onClick: () => { if (last) saveOutput(last.outputs[0]) } })
  const copyBtn = copyButton(() => output.value, 'Copy')
  copyBtn.disabled = true
  const outName = (inName, o, from) => (cfg.outName ? cfg.outName(inName, o, from) : `${baseName(inName) || 'converted'}${o.suffix ? `-${safeName(o.suffix)}` : ''}${extOf(inName) === o.ext && !o.suffix ? '-converted' : ''}.${o.ext}`)
  const blobOf = (o) => new Blob([o.text ?? o.bytes], { type: o.mime || 'application/octet-stream' })
  const saveOutput = (o) => download(blobOf(o), outName('converted', o, st.from))
  const resolveFrom = (text) => (st.from === 'auto' ? cfg.sniff?.(text) : st.from)

  async function run() {
    const my = ++gen
    const text = input.value
    last = null
    dlBtn.disabled = true
    copyBtn.disabled = true
    clear(msgHost)
    if (!text.trim()) { output.value = ''; status.textContent = ''; return }
    const from = resolveFrom(text)
    if (!from) { output.value = ''; status.textContent = ''; clear(msgHost, alert('warn', 'Could not tell what format this is. Pick the input format above.')); return }
    if (cfg.isBinary?.(from) && !cfg.textBinary?.(from)) { output.value = ''; clear(msgHost, alert('info', `${labelOf(cfg.formats, from)} is a binary format. Add the file on the Files tab.`)); return }
    try {
      const t0 = performance.now()
      const r = await cfg.convert(text, from, st.to, st.opts, { signal })
      if (my !== gen) return
      last = r
      const o = r.outputs[0]
      output.value = cfg.display ? cfg.display(o, st, r) ?? '' : o.text ?? ''
      dlBtn.disabled = false
      copyBtn.disabled = !output.value
      const size = o.text !== undefined ? new Blob([o.text]).size : o.bytes.length
      status.textContent = `${st.from === 'auto' ? `Detected ${labelOf(cfg.formats, from)}. ` : ''}${r.info?.summary ? `${r.info.summary} · ` : ''}${formatBytes(new Blob([text]).size)} in, ${formatBytes(size)} out · ${Math.max(1, Math.round(performance.now() - t0))} ms`
      if (o.bytes && !output.value) status.textContent += ' · This is a file, not text: use Download.'
      clear(msgHost, ...(r.warnings || []).map((w) => alert('warn', w)))
    } catch (e) {
      if (my !== gen || isAbort(e)) return
      output.value = ''
      status.textContent = ''
      clear(msgHost, alert('error', errorMessage(e), e.lines ? h('ul', { style: 'margin:6px 0 0 18px;padding:0' }, e.lines.map((l) => h('li', l))) : null))
    }
  }
  const debRun = debounce(run, 250)
  const sampleBtn = button('Try a sample', { icon: 'sparkles', size: 'sm', onClick: () => { input.value = cfg.sample(st.from === 'auto' ? cfg.formats[0][0] : st.from); run() } })
  const clearBtn = button('Clear', { icon: 'eraser', size: 'sm', variant: 'ghost', onClick: () => { input.value = ''; run(); input.focus() } })
  const openBtn = button('Open a file', { icon: 'folder-open', size: 'sm', variant: 'ghost', onClick: async () => {
    const [f] = await pickFiles({ accept: cfg.accept(st.from) })
    if (!f) return
    const fmt = st.from === 'auto' ? cfg.detectName(f.name) : st.from
    if (fmt && cfg.isBinary?.(fmt) && !cfg.textBinary?.(fmt)) { setMode('files'); list.add([f]); return }
    if (f.size > 20 * 1024 * 1024) { setMode('files'); list.add([f]); toast('Big files convert faster on the Files tab.'); return }
    input.value = await f.text()
    if (st.from === 'auto' && fmt) { /* sniffing runs on the text */ }
    run()
  } })
  const textPane = h('div', { class: 'stack' },
    h('div', { class: 'tool-split' },
      h('div', field('Input', input), h('div', { class: 'fc-bar' }, sampleBtn, openBtn, clearBtn)),
      h('div', field('Result', output), h('div', { class: 'fc-bar' }, copyBtn, dlBtn))),
    status, msgHost)

  // ---- files pane ----
  const list = fileList({ sortable: false, onChange: () => { renderResults([]) } })
  const dzHost = h('div')
  const prog = progress('Converting')
  const resultsHost = h('div', { class: 'stack' })
  const goBtn = button('Convert', { icon: 'refresh-cw', variant: 'primary', onClick: () => busy(goBtn, convertAll, { label: 'Converting', progress: prog, errorTo: resultsHost }) })
  function buildDz() {
    clear(dzHost, dropzone({ accept: cfg.accept(st.from), multiple: true, onFiles: (fs) => list.add(fs), label: undefined, hint: cfg.dropHint?.(st) }))
  }
  function renderResults(items, extraWarnings = []) {
    clear(resultsHost)
    if (!items.length) return
    const ok = items.filter((x) => x.file)
    resultsHost.append(...extraWarnings.map((w) => alert('warn', w)))
    for (const it of items) {
      if (it.error) { resultsHost.append(alert('error', `${it.name}: ${it.error}`)); continue }
      resultsHost.append(h('div', { class: 'fc-res' }, icon('file-check'), h('div', { class: 'nm', title: it.file.name }, it.file.name), h('span', { class: 'sz' }, `${formatBytes(it.inSize)} to ${formatBytes(it.file.size)}`), downloadButton(it.file, it.file.name, 'Download', { size: 'sm' })))
    }
    if (ok.length > 1) resultsHost.append(h('div', { class: 'fc-bar' }, downloadButton(() => zip(ok.map((x) => ({ name: x.file.name, data: x.file }))), 'converted-files.zip', 'Download all (ZIP)', { variant: 'secondary' })))
  }
  async function convertAll() {
    const files = [...list.files]
    if (!files.length) { toast('Add at least one file first.', 'error'); return }
    list.setDisabled(true)
    const items = [], warns = [], used = new Set()
    // two inputs such as data.json and data.xml would both become data.yaml: keep the source type in the name
    const uniqueName = (name, inName) => {
      let n = name
      if (used.has(n)) n = name.replace(/(\.[^.]+)$/, `-${extOf(inName) || 'file'}$1`)
      for (let k = 2; used.has(n); k++) n = name.replace(/(\.[^.]+)$/, `-${k}$1`)
      used.add(n)
      return n
    }
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        prog.set(i / files.length, `Converting ${f.name}`)
        try {
          if (f.size > MAX_BYTES) throw new Error('This file is over 300 MB, which is too big to convert in a browser tab.')
          const bytes = new Uint8Array(await f.arrayBuffer())
          let from = st.from === 'auto' ? cfg.detectName(f.name) : st.from
          if (!from && cfg.sniffBytes) from = cfg.sniffBytes(bytes)
          if (!from) throw new Error('Could not tell what format this is. Choose the input format above.')
          const r = await cfg.convert(bytes, from, st.to, st.opts, { signal, onProgress: (p) => prog.set((i + p) / files.length, `Converting ${f.name}`) })
          for (const o of r.outputs) items.push({ name: f.name, inSize: f.size, file: new File([blobOf(o)], uniqueName(outName(f.name, o, from), f.name), { type: o.mime }) })
          for (const w of r.warnings || []) warns.push(files.length > 1 ? `${f.name}: ${w}` : w)
        } catch (e) {
          if (isAbort(e)) throw e
          items.push({ name: f.name, error: errorMessage(e) + (e.lines ? ` (${e.lines.slice(0, 3).join('; ')})` : '') })
        }
        await yieldToMain()
      }
    } finally { list.setDisabled(false) }
    renderResults(items, warns)
  }
  const filePane = h('div', { class: 'stack' }, dzHost, list.el, h('div', { class: 'fc-bar' }, goBtn), prog.el, resultsHost)

  // ---- tabs and wiring ----
  const tabs = segmented([['text', 'Paste text'], ['files', 'Files']], st.mode, (m) => setMode(m), 'Input method')
  function setMode(m) {
    st.mode = m
    tabs.set(m)
    textPane.hidden = m !== 'text'
    filePane.hidden = m !== 'files'
    if (m === 'text') run()
  }
  function onFormats() {
    if (cfg.fixed) syncFixed()
    buildOptions()
    buildDz()
    if (st.mode === 'text') run()
  }
  function onOpt() { if (st.mode === 'text') debRun() }

  el.append(...(cfg.intro ? [cfg.intro] : []), h('div', { class: 'row', style: 'justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px' }, tabs), fmtRow, optHost, textPane, filePane,
    h('p', { class: 'fc-priv' }, icon('shield-check'), cfg.hint || 'Runs in your browser. Your files and text are never uploaded.'))
  if (cfg.fixed) syncFixed()
  buildOptions()
  buildDz()
  filePane.hidden = true
  return () => { gen++ }
}
