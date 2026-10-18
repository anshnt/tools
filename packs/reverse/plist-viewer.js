// Plist viewer and converter: binary (bplist00) and XML property lists, also JSON and the plist inside a .mobileprovision.
// Shows a collapsible typed tree and converts to XML plist, binary plist or JSON. Parsing and writing live in _pkg-plist.js.
import { h, dropzone, textarea, field, alert, clear, stats, button, copyButton, download, formatBytes, formatNumber, segmented, debounce, yieldToMain, progress, errorMessage, card, onCleanup } from '../../lib/ui.js'
import { baseName } from '../../lib/files.js'
import { parsePlist, parseXmlPlist, fromJSON, sniffPlist, writeXmlPlist, writeBplist, toJSONText, countNodes, extractEmbeddedPlist } from './_pkg-plist.js'
import { useCss, plistTree, codeBlock, sectionTitle } from './_pkg-ui.js'

const MAX_BYTES = 200 * 1024 * 1024
const FORMAT_LABEL = { binary: 'Binary plist', xml: 'XML plist', json: 'JSON', provision: 'Provisioning profile' }

/** Parse any supported input (bytes) into {node, format}. Exported for tests. */
export function readAny(bytes) {
  const kind = sniffPlist(bytes)
  if (kind) return { node: parsePlist(bytes), format: kind }
  // CMS-wrapped plists (.mobileprovision, .provisionprofile) have the XML inside a DER envelope
  const got = bytes[0] === 0x30 ? extractEmbeddedPlist(bytes) : null
  if (got) return { node: got.plist, format: 'provision' }
  const msg = 'This file is not a property list. Expected a binary plist (bplist00), an XML plist, JSON or a .mobileprovision.'
  throw Object.assign(new Error(msg), { userMessage: msg })
}

/** Parse pasted text (XML plist or JSON). */
export function readText(text) {
  const t = text.trim()
  if (!t) return null
  if (t[0] === '{' || t[0] === '[') {
    let v
    try { v = JSON.parse(t) } catch (e) { throw Object.assign(new Error(e.message), { userMessage: 'The JSON is not valid: ' + e.message }) }
    return { node: fromJSON(v), format: 'json' }
  }
  if (t[0] === '<') return { node: parseXmlPlist(t), format: 'xml' }
  const msg = 'Paste an XML plist (starting with <?xml or <plist) or JSON (starting with { or [).'
  throw Object.assign(new Error(msg), { userMessage: msg })
}

export function mount(root) {
  root.classList.add(useCss())
  const result = h('div', { class: 'stack' })
  const prog = progress()
  let current = null // {node, format, name, size}
  let fmt = 'xml'

  const zone = dropzone({ accept: '', label: 'Drop a .plist file here', hint: 'Binary or XML plist, JSON or .mobileprovision · converted on your device', icon: 'list-tree', onFiles: ([f]) => openFile(f) })
  const paste = textarea({ rows: 5, mono: true, spellcheck: false, placeholder: '<?xml version="1.0"?>\n<plist version="1.0"><dict>...</dict></plist>\nor JSON: {"key": "value"}' })
  const onPaste = debounce(() => {
    if (!paste.value.trim()) { if (current?.pasted) { current = null; clear(result) } return }
    try {
      const r = readText(paste.value)
      show({ ...r, name: 'pasted', size: new TextEncoder().encode(paste.value).length, pasted: true })
    } catch (e) { clear(result, alert('error', errorMessage(e))) }
  }, 350)
  paste.addEventListener('input', onPaste)

  async function openFile(file) {
    if (file.size > MAX_BYTES) { clear(result, alert('error', `This file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_BYTES)}.`)); return }
    clear(result)
    prog.set(null, `Reading ${file.name}`)
    try {
      await yieldToMain()
      const bytes = new Uint8Array(await file.arrayBuffer())
      const r = readAny(bytes)
      paste.value = ''
      show({ ...r, name: file.name, size: file.size })
    } catch (e) {
      console.error(e)
      clear(result, alert('error', errorMessage(e)))
    } finally { prog.hide() }
  }

  function exportAs(f) {
    const n = current.node
    if (f === 'xml') return new Blob([writeXmlPlist(n)], { type: 'application/xml' })
    if (f === 'binary') return new Blob([writeBplist(n)], { type: 'application/octet-stream' })
    return new Blob([toJSONText(n)], { type: 'application/json' })
  }
  const outName = (f) => {
    const b = current.name === 'pasted' ? 'converted' : baseName(current.name) || 'converted'
    return f === 'json' ? `${b}.json` : f === 'binary' ? `${b}.binary.plist` : `${b}.plist`
  }

  function show(data) {
    current = data
    const n = data.node
    const out = h('div')
    const renderOut = () => {
      if (fmt === 'binary') {
        const bin = writeBplist(n)
        clear(out, alert('info', `Binary plist ready: ${formatBytes(bin.length)}, ${formatNumber(countNodes(n))} values. Download it below.`))
        return
      }
      const text = fmt === 'xml' ? writeXmlPlist(n) : toJSONText(n)
      const cap = 400_000
      clear(out, h('div', { class: 'stack' }, codeBlock(text.length > cap ? text.slice(0, cap) + '\n... (truncated preview, the download has everything)' : text),
        fmt === 'json' ? h('div', { class: 'small muted' }, 'In JSON, data becomes Base64 text and dates become ISO 8601 strings, so converting that JSON back gives strings for those values.') : null))
    }
    const seg = segmented([['xml', 'XML plist'], ['binary', 'Binary plist'], ['json', 'JSON']], fmt, (v) => { fmt = v; renderOut(); dlBtn.querySelector('span').textContent = `Download ${v === 'xml' ? 'XML plist' : v === 'binary' ? 'binary plist' : 'JSON'}` }, 'Output format')
    const dlBtn = button(`Download ${fmt === 'xml' ? 'XML plist' : fmt === 'binary' ? 'binary plist' : 'JSON'}`, { icon: 'download', variant: 'primary', onClick: () => {
      try { download(exportAs(fmt), outName(fmt)) } catch (e) { clear(out, alert('error', errorMessage(e))) }
    } })
    const copy = copyButton(() => (fmt === 'json' ? toJSONText(n) : writeXmlPlist(n)), 'Copy text')
    renderOut()
    clear(result,
      stats([
        { label: 'Format', value: FORMAT_LABEL[data.format] || data.format, accent: true },
        { label: 'Root', value: n.t === 'dict' ? `dict, ${n.v.length} keys` : n.t === 'array' ? `array, ${n.v.length} items` : n.t },
        { label: 'Values', value: formatNumber(countNodes(n)) },
        { label: 'Size', value: formatBytes(data.size) },
      ]),
      card(sectionTitle('Tree'), plistTree(n, { open: 2 })),
      card(sectionTitle('Convert'), h('div', { class: 'stack' }, seg, h('div', { class: 'row' }, dlBtn, copy), out)))
  }

  onCleanup(() => paste.removeEventListener('input', onPaste))
  root.append(h('div', { class: 'stack' }, zone, field('Or paste XML plist or JSON', paste), prog.el, result))
}

