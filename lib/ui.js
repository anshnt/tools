// UI kit shared by every tool. Build tool UIs from these helpers so all tools look and behave
// the same (light/dark, mobile, keyboard). Styles live in assets/app.css.

const SVG_NS = 'http://www.w3.org/2000/svg'
const SVG_TAGS = new Set(['svg', 'path', 'g', 'circle', 'rect', 'line', 'polyline', 'polygon', 'text', 'tspan', 'textPath', 'defs', 'clipPath', 'use', 'ellipse',
  'marker', 'pattern', 'linearGradient', 'radialGradient', 'stop', 'mask', 'foreignObject', 'image', 'symbol', 'filter', 'switch', 'desc', 'animate', 'animateTransform',
  'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix', 'feDisplacementMap', 'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR',
  'feGaussianBlur', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'feTurbulence'])
const PROP_BLOCKLIST = new Set(['list', 'form', 'type', 'for', 'role', 'min', 'max', 'step'])
const DEFERRED = new Set(['value', 'checked', 'selected', 'selectedIndex'])

// ---------- Page-scoped cleanup ----------
// Components register cleanup here; the shell runs it when the visitor leaves the tool page.
const cleanups = new Set()
/** Run fn when the current tool page is left (stop streams, revoke URLs, remove listeners). Returns an unregister function. */
export function onCleanup(fn) {
  cleanups.add(fn)
  return () => cleanups.delete(fn)
}
/** Used by the shell on every route change. */
export function runCleanups() {
  for (const fn of [...cleanups]) {
    cleanups.delete(fn)
    try { fn() } catch (e) { console.error(e) }
  }
}

/**
 * h('div', {class: 'row', onclick}, child, 'text', [more]) -> Element.
 * Props: class (string|array), style (string|object, supports --custom-props), dataset, on* handlers, html (innerHTML, trusted strings only).
 * value/checked/selected are applied after children so h('select', {value}, options) works.
 * Use svg(tag, ...) for SVG elements whose names clash with HTML (title, a, style, script).
 */
export function h(tag, props, ...kids) {
  return build(SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag), props, kids)
}
/** Always creates an SVG-namespaced element. */
export const svg = (tag, props, ...kids) => build(document.createElementNS(SVG_NS, tag), props, kids)

function build(el, props, kids) {
  if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
    kids.unshift(props)
    props = {}
  }
  const isSvg = el.namespaceURI === SVG_NS
  const later = []
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue
    if (DEFERRED.has(k) && !isSvg) { later.push([k, v]); continue }
    setProp(el, k, v, isSvg)
  }
  append(el, kids)
  for (const [k, v] of later) el[k] = v
  return el
}

function setProp(el, k, v, isSvg) {
  if (k === 'class') {
    const c = Array.isArray(v) ? v.filter(Boolean).join(' ') : v
    if (c) el.setAttribute('class', c)
  } else if (k === 'style') {
    if (typeof v === 'string') el.setAttribute('style', v)
    else for (const [p, x] of Object.entries(v)) if (x != null) p.startsWith('--') || p.includes('-') ? el.style.setProperty(p, x) : (el.style[p] = x)
  } else if (k === 'dataset') Object.assign(el.dataset, v)
  else if (k === 'html') el.innerHTML = v
  else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v)
  else if (k.startsWith('aria-')) el.setAttribute(k, String(v))
  else if (v === false) { if (!isSvg && k in el && typeof el[k] === 'boolean') el[k] = false }
  else if (!isSvg && k in el && !PROP_BLOCKLIST.has(k) && !k.includes('-')) el[k] = v
  else el.setAttribute(k, v === true ? '' : v)
}

function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false || k === true) continue
    el.append(k instanceof Node ? k : String(k))
  }
}

export const $ = (sel, root = document) => root.querySelector(sel)
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]
export const clear = (el, ...kids) => { el.replaceChildren(); append(el, kids); return el }

const pascal = (s) => s.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase())

/** Lucide icon by kebab name ('file-text'). Falls back to a dot when the name is unknown. */
export function icon(name, cls = '') {
  const L = window.lucide
  const node = L && (L.icons?.[pascal(name)] || L.icons?.[name])
  let el
  if (node) el = L.createElement(node)
  else {
    el = document.createElementNS(SVG_NS, 'svg')
    el.setAttribute('viewBox', '0 0 24 24')
    el.innerHTML = '<circle cx="12" cy="12" r="4" fill="currentColor"/>'
  }
  el.setAttribute('class', `icon ${cls}`.trim())
  el.setAttribute('aria-hidden', 'true')
  return el
}

/** button('Merge', {variant: 'primary'|'secondary'|'ghost'|'danger', icon, size: 'sm'|'lg', block, onClick, title, ariaLabel, disabled}) */
export function button(label, opts = {}) {
  const { variant = 'secondary', icon: ic, size, block, onClick, title, disabled, type = 'button', attrs = {} } = opts
  return h('button', {
    type, class: ['btn', `btn-${variant}`, size && `btn-${size}`, block && 'btn-block', !label && 'btn-icon'],
    onclick: onClick, title: title || (!label ? opts.ariaLabel : null), 'aria-label': opts.ariaLabel || null, disabled, ...attrs,
  }, ic && icon(ic), label && h('span', label))
}

export const isAbort = (err) => err?.code === 'ABORT' || err?.name === 'AbortError'

/**
 * Run fn while the button shows a spinner. Errors are reported (cancellations are ignored) and progress is hidden afterwards.
 * busy(btn, fn, 'Merging') or busy(btn, fn, {label: 'Merging', errorTo: resultEl, progress: prog})
 *   errorTo: element that receives a persistent alert('error') instead of a toast
 * Returns fn's result, or undefined on error.
 */
export async function busy(btn, fn, opts = {}) {
  const o = typeof opts === 'string' ? { label: opts } : opts
  if (btn.getAttribute('aria-busy') === 'true') return
  const original = [...btn.childNodes]
  btn.setAttribute('aria-busy', 'true')
  btn.replaceChildren(h('span', { class: 'spinner' }), h('span', o.label || btn.textContent || 'Working'))
  try {
    return await fn()
  } catch (err) {
    if (isAbort(err)) return
    console.error(err)
    if (o.errorTo) clear(o.errorTo, alert('error', errorMessage(err)))
    else toast(errorMessage(err), 'error')
  } finally {
    o.progress?.hide()
    btn.replaceChildren(...original)
    btn.removeAttribute('aria-busy')
  }
}

export const errorMessage = (err) => (err && (err.userMessage || err.message)) || String(err) || 'Something went wrong'

/** Give the browser a chance to paint inside long loops (works in background tabs too). */
export const yieldToMain = () => (globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise((r) => setTimeout(r, 0)))

/** field('Quality', control, 'hint') - label wrapper. Pass {output: el} as 4th arg to show a live value next to the label. */
export function field(label, control, hint, extra = {}) {
  const formCtl = control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement
  return h(formCtl ? 'label' : 'div', { class: 'field' },
    label && h('span', { class: 'field-label' }, h('span', label), extra.output || null),
    control,
    hint && h('small', { class: 'field-hint' }, hint))
}

const withBase = (base, props) => ({ ...omit(props, 'mono', 'class'), class: [base, props.mono && 'mono', ...[props.class].flat()] })
export const input = (props = {}) => h('input', { type: 'text', ...withBase('input', props) })
export function textarea(props = {}) {
  const el = h('textarea', withBase('textarea', props))
  if (props.mono) el.spellcheck = false
  return el
}

/** number(value, {min, max, step, placeholder, onInput(n)}) - onInput gets NaN while the field is empty. */
export function number(value, opts = {}) {
  return h('input', {
    class: 'input', type: 'number', inputmode: opts.min >= 0 ? 'decimal' : null, value, min: opts.min, max: opts.max, step: opts.step ?? 'any',
    placeholder: opts.placeholder, 'aria-label': opts.ariaLabel || null, oninput: opts.onInput && ((e) => opts.onInput(e.target.valueAsNumber, e)),
  })
}

/** select(options, value, onChange). options: ['a','b'] | [['value','Label']] | [{value,label}] */
export function select(options, value, onChange) {
  return h('select', { class: 'select', onchange: onChange && ((e) => onChange(e.target.value, e)) },
    options.map((o) => {
      const [v, l] = Array.isArray(o) ? o : typeof o === 'object' ? [o.value, o.label] : [o, o]
      return h('option', { value: v, selected: String(v) === String(value) }, l)
    }))
}

/** rangeField('Quality', {min, max, step, value, onInput, format, hint}) -> field element; el.input is the <input type=range>. */
export function rangeField(label, opts) {
  const { min = 0, max = 100, step = 1, value = 50, onInput, format = (v) => v, hint } = opts
  const output = h('output', format(value))
  const inp = h('input', { type: 'range', min, max, step, value, oninput: (e) => { output.textContent = format(e.target.valueAsNumber); onInput?.(e.target.valueAsNumber, e) } })
  const el = field(label, inp, hint, { output })
  el.input = inp
  el.set = (v) => { inp.value = v; output.textContent = format(inp.valueAsNumber) }
  return el
}

/** toggle('Keep aspect ratio', true, (checked) => ...) -> label; el.input is the checkbox. */
export function toggle(label, checked, onChange) {
  const inp = h('input', { type: 'checkbox', role: 'switch', checked: !!checked, onchange: (e) => onChange?.(e.target.checked, e) })
  const el = h('label', { class: 'switch' }, inp, h('span', label))
  el.input = inp
  return el
}

/** segmented([['a','A'],['b','B']], 'a', onChange) -> element with .value and .set(v) */
export function segmented(options, value, onChange, ariaLabel) {
  const el = h('div', { class: 'seg', role: 'group', 'aria-label': ariaLabel || null })
  el.value = value
  const btns = options.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, o]
    const b = h('button', { type: 'button', 'aria-pressed': String(v === value), onclick: () => { el.set(v); onChange?.(v) } }, l)
    b._v = v
    return b
  })
  el.append(...btns)
  el.set = (v) => { el.value = v; for (const b of btns) b.setAttribute('aria-pressed', String(b._v === v)) }
  return el
}

export const panel = (...kids) => h('section', { class: 'panel' }, kids)
/** card('Title', ...children) - a panel with a heading; pass an element as title to add actions. */
export const card = (title, ...kids) => h('section', { class: 'panel' }, title && h('h2', title), kids)
export const row = (...kids) => h('div', { class: 'row' }, kids)
export const stack = (...kids) => h('div', { class: 'stack' }, kids)
/** split(left, right) - two columns on desktop, stacked on mobile. variant: 'wide-left' | 'wide-right' */
export const split = (left, right, variant = '') => h('div', { class: ['tool-split', variant] }, left, right)

/** alert('info'|'success'|'warn'|'error', ...children) */
export function alert(type, ...kids) {
  const ic = { info: 'info', success: 'circle-check', warn: 'triangle-alert', error: 'circle-alert' }[type] || 'info'
  return h('div', { class: ['alert', type], role: type === 'error' ? 'alert' : 'status' }, icon(ic), h('div', kids))
}

export function empty(text, ic = 'inbox') {
  return h('div', { class: 'empty' }, icon(ic), h('div', text))
}

/** stats([{label, value, hint, accent, danger}]) */
export function stats(items) {
  return h('div', { class: 'stats', 'aria-live': 'polite' }, items.map((s) => h('div', { class: ['stat', s.accent && 'accent', s.danger && 'danger'] },
    h('div', { class: 'label' }, s.label), h('div', { class: 'value' }, s.value), s.hint && h('div', { class: 'hint' }, s.hint))))
}

/** table({columns: ['A','B'] | [{label, num}], rows: [[...]], max: 1000}) - scrolls inside itself on small screens. */
export function table({ columns, rows, max = 1000 }) {
  const cols = columns.map((c) => (typeof c === 'string' ? { label: c } : c))
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', h('tr', cols.map((c) => h('th', { class: c.num && 'num', scope: 'col' }, c.label)))),
    h('tbody', rows.slice(0, max).map((r) => h('tr', r.map((v, i) => h('td', { class: cols[i]?.num && 'num' }, v instanceof Node ? v : v ?? '')))))),
  rows.length > max ? h('div', { class: 'small muted', style: 'padding:8px 12px' }, `Showing ${max} of ${rows.length} rows`) : null)
}

let uid = 0
/** tabs([{id, label, render: () => Node}], activeId, onChange) -> element with .show(id). Panels render lazily and are kept. */
export function tabs(items, active = items[0]?.id, onChange) {
  const base = `tabs${++uid}`
  const bar = h('div', { class: 'tabs', role: 'tablist' })
  const body = h('div', { style: 'padding-top:14px' })
  const panels = new Map()
  const btns = items.map((t, i) => h('button', {
    type: 'button', role: 'tab', id: `${base}-t${i}`, 'aria-controls': `${base}-p${i}`,
    onclick: () => show(t.id),
    onkeydown: (e) => {
      const d = { ArrowRight: 1, ArrowLeft: -1, Home: -i, End: items.length - 1 - i }[e.key]
      if (d === undefined) return
      e.preventDefault()
      const j = (i + d + items.length) % items.length
      show(items[j].id)
      btns[j].focus()
    },
  }, t.label))
  bar.append(...btns)
  function show(id) {
    items.forEach((t, i) => {
      const on = t.id === id
      btns[i].setAttribute('aria-selected', String(on))
      btns[i].tabIndex = on ? 0 : -1
      if (on && !panels.has(id)) panels.set(id, h('div', { role: 'tabpanel', id: `${base}-p${i}`, 'aria-labelledby': `${base}-t${i}` }, t.render()))
    })
    for (const [pid, p] of panels) p.hidden = pid !== id
    if (!body.contains(panels.get(id))) body.append(panels.get(id))
    onChange?.(id)
  }
  const el = h('div', bar, body)
  show(active)
  el.show = show
  return el
}

/** progress(text) -> {el, set(fraction 0..1 | null for indeterminate, text), hide(), show()}. Starts hidden. */
export function progress(text = '') {
  const bar = h('i')
  const label = h('span', text)
  const pct = h('span')
  const el = h('div', { class: 'progress', role: 'progressbar', 'aria-label': text || 'Progress', 'aria-valuemin': 0, 'aria-valuemax': 100, hidden: true },
    h('div', { class: 'progress-bar' }, bar), h('div', { class: 'progress-text' }, label, pct))
  return {
    el,
    set(fraction, t) {
      el.hidden = false
      if (t != null) { label.textContent = t; el.setAttribute('aria-label', t) }
      const ind = fraction == null || !Number.isFinite(fraction)
      el.classList.toggle('indeterminate', ind)
      if (!ind) {
        const p = Math.max(0, Math.min(1, fraction)) * 100
        bar.style.width = p + '%'
        pct.textContent = Math.round(p) + '%'
        el.setAttribute('aria-valuenow', Math.round(p))
      } else {
        pct.textContent = ''
        bar.style.width = ''
        el.removeAttribute('aria-valuenow')
      }
    },
    hide() { el.hidden = true },
    show() { el.hidden = false },
  }
}

/** toast('Saved', 'info'|'success'|'error') - shows inside an open modal when there is one. */
export function toast(message, type = 'info', ms = type === 'error' ? 6000 : 3200) {
  const host = document.querySelector('dialog[open]') || document.body
  let box = [...host.children].find((c) => c.classList?.contains('toasts'))
  if (!box) box = host.appendChild(h('div', { class: 'toasts', 'aria-live': 'polite' }))
  const ic = { success: 'circle-check', error: 'circle-alert', info: 'info' }[type] || 'info'
  const t = h('div', { class: ['toast', type], role: type === 'error' ? 'alert' : 'status' }, icon(ic), h('span', message))
  box.append(t)
  setTimeout(() => t.remove(), ms)
}

/** Copy text; shows a toast. Resolves true on success. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    toast('Copied to clipboard', 'success')
    return true
  } catch {
    const ta = h('textarea', { value: text, style: 'position:fixed;opacity:0' })
    document.body.append(ta)
    ta.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch { /* unsupported */ }
    ta.remove()
    toast(ok ? 'Copied to clipboard' : 'Copy failed. Select the text and copy it manually.', ok ? 'success' : 'error')
    return ok
  }
}

/** copyButton(() => text, 'Copy') */
export const copyButton = (getText, label = 'Copy', opts = {}) =>
  button(label, { icon: 'copy', variant: 'secondary', size: 'sm', ...opts, onClick: () => copyText(typeof getText === 'function' ? getText() : getText) })

/** Trigger a browser download for a Blob (or string). */
export function download(data, filename, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = h('a', { href: url, download: filename, style: 'display:none' })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** downloadButton(blob | () => blob | Promise<blob>, 'file.pdf', 'Download PDF', {size, variant}) */
export function downloadButton(getBlob, filename, label = 'Download', opts = {}) {
  const btn = button(label, { icon: 'download', variant: 'primary', ...opts })
  btn.addEventListener('click', () => busy(btn, async () => {
    const blob = typeof getBlob === 'function' ? await getBlob() : getBlob
    download(blob, typeof filename === 'function' ? filename() : filename)
  }))
  return btn
}

const EXT_MIME = {
  heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', bmp: 'image/bmp',
  tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml', ico: 'image/x-icon', mkv: 'video/x-matroska', avi: 'video/x-msvideo', mov: 'video/quicktime', mp4: 'video/mp4',
  m4v: 'video/mp4', webm: 'video/webm', '3gp': 'video/3gpp', flv: 'video/x-flv', wmv: 'video/x-ms-wmv', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
  flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/opus', wma: 'audio/x-ms-wma', amr: 'audio/amr', pdf: 'application/pdf', csv: 'text/csv', tsv: 'text/tab-separated-values',
  txt: 'text/plain', md: 'text/markdown', json: 'application/json', xml: 'application/xml', html: 'text/html', htm: 'text/html', srt: 'application/x-subrip', vtt: 'text/vtt',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', zip: 'application/zip',
}
/** MIME type of a File, falling back to its extension (Chrome/Firefox report '' for HEIC, MKV and others). */
export const fileType = (file) => (file.type || EXT_MIME[(file.name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase()] || '').toLowerCase()

export function matchesAccept(file, accept) {
  if (!accept) return true
  const name = file.name.toLowerCase()
  const type = fileType(file)
  return accept.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).some((a) =>
    a.startsWith('.') ? name.endsWith(a) : a.endsWith('/*') ? type.startsWith(a.slice(0, -1)) : type === a)
}

const ACCEPT_LABEL = { 'image/*': 'images', 'video/*': 'videos', 'audio/*': 'audio files', 'text/*': 'text files', 'application/pdf': 'PDF' }
function acceptLabel(accept) {
  const parts = [...new Set(accept.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    .map((a) => ACCEPT_LABEL[a] || (a.startsWith('.') ? a.slice(1).toUpperCase() : null)).filter(Boolean))]
  return parts.length ? parts.slice(0, 6).join(', ') + (parts.length > 6 ? ' and more' : '') : 'Supported files'
}

// One document-level paste handler shared by all dropzones; it feeds the focused, else last-used, else first visible zone.
const zones = new Set()
let lastZone = null
function routePaste(e) {
  if (e.defaultPrevented || e.target.closest?.('input, textarea, [contenteditable]:not([contenteditable="false"])')) return
  const files = [...(e.clipboardData?.files || [])]
  if (!files.length) return
  const active = [...zones].filter((z) => z._paste && z.isConnected)
  const target = active.find((z) => z.contains(document.activeElement)) || (active.includes(lastZone) ? lastZone : active[0])
  if (!target) return
  e.preventDefault()
  target._take(files)
}

/**
 * dropzone({accept: '.pdf,application/pdf', multiple, onFiles(files), label, hint, paste: true, compact, icon})
 * Click to browse, drag & drop, or paste from the clipboard. Use paste: false on tools with several dropzones
 * where only one should take pasted files. Returns the element; el.open() opens the picker.
 */
export function dropzone(opts = {}) {
  const { accept = '', multiple = false, onFiles, label, hint, paste = true, compact = false, icon: ic = 'upload' } = opts
  const fileInput = h('input', { type: 'file', accept, multiple, tabindex: -1, 'aria-hidden': 'true', onchange: (e) => { take([...e.target.files]); e.target.value = '' } })
  const canHover = matchMedia('(hover: hover)').matches
  const el = h('div', {
    class: ['dropzone', compact && 'compact'], tabindex: 0, role: 'button',
    'aria-label': label || (multiple ? 'Choose files' : 'Choose a file'),
    onclick: () => fileInput.click(),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click() } },
    onpointerenter: () => { lastZone = el },
    onfocus: () => { lastZone = el },
    ondragover: (e) => { e.preventDefault(); el.classList.add('drag') },
    ondragleave: () => el.classList.remove('drag'),
    ondrop: (e) => { e.preventDefault(); el.classList.remove('drag'); lastZone = el; take([...e.dataTransfer.files]) },
  },
  h('div', { class: 'dz-icon' }, icon(ic)),
  h('div', h('strong', label || (multiple ? (canHover ? 'Drop files here or click to browse' : 'Tap to choose files') : (canHover ? 'Drop a file here or click to browse' : 'Tap to choose a file'))),
    h('div', { class: 'dz-hint' }, hint || `${accept ? acceptLabel(accept) : 'Any file'}${paste && canHover ? ' · or paste with Ctrl+V' : ''}`)),
  fileInput)

  function take(files) {
    const ok = files.filter((f) => matchesAccept(f, accept))
    if (files.length && !ok.length) return toast(`That file type is not supported here. Use ${acceptLabel(accept)}.`, 'error')
    if (ok.length < files.length) toast(`Skipped ${files.length - ok.length} unsupported file(s)`)
    if (ok.length) onFiles?.(multiple ? ok : ok.slice(0, 1))
  }
  el._take = take
  el._paste = paste
  el._accept = accept
  zones.add(el)
  onCleanup(() => zones.delete(el))
  if (!routePaste._on) { document.addEventListener('paste', routePaste); routePaste._on = true }
  el.open = () => fileInput.click()
  return el
}

/**
 * fileList({files, onChange(files), sortable: true}) -> {el, files, set(files), add(files), setDisabled(bool), destroy()}
 * Thumbnails, sizes, remove buttons and drag or arrow-button reordering (works on touch). Object URLs are revoked automatically.
 */
export function fileList(opts = {}) {
  const { onChange, sortable = true } = opts
  const list = h('ul', { class: 'file-list' })
  const api = { el: list, files: [...(opts.files || [])] }
  const urls = new Map()
  let disabled = false
  const revokeMissing = () => {
    for (const [f, u] of urls) if (!api.files.includes(f)) { URL.revokeObjectURL(u); urls.delete(f) }
  }
  const thumbFor = (f) => {
    const t = fileType(f)
    if (t.startsWith('image/') && !/heic|heif|tiff/.test(t)) {
      if (!urls.has(f)) urls.set(f, URL.createObjectURL(f))
      return h('img', { class: 'thumb', src: urls.get(f), alt: '', loading: 'lazy', decoding: 'async' })
    }
    const ic = t === 'application/pdf' ? 'file-text' : t.startsWith('video/') ? 'file-video' : t.startsWith('audio/') ? 'file-audio' : t.startsWith('image/') ? 'file-image' : 'file'
    return h('div', { class: 'thumb' }, icon(ic))
  }
  let dragIdx = -1
  const move = (from, to, focusAct) => {
    if (to < 0 || to >= api.files.length) return
    const [f] = api.files.splice(from, 1)
    api.files.splice(to, 0, f)
    render(focusAct && [focusAct, to])
    onChange?.(api.files)
  }
  function render(focus) {
    revokeMissing()
    const n = api.files.length
    clear(list, api.files.map((f, i) => {
      const li = h('li', {
        class: 'file-item', draggable: sortable && !disabled,
        ondragstart: () => { dragIdx = i; li.classList.add('dragging') },
        ondragend: () => li.classList.remove('dragging'),
        ondragover: (e) => { if (dragIdx > -1) { e.preventDefault(); li.classList.add('over') } },
        ondragleave: () => li.classList.remove('over'),
        ondrop: (e) => { if (dragIdx > -1) { e.preventDefault(); e.stopPropagation(); li.classList.remove('over'); move(dragIdx, i) } dragIdx = -1 },
      },
      sortable && n > 1 && h('span', { class: 'handle', 'aria-hidden': 'true' }, icon('grip-vertical')),
      thumbFor(f),
      h('div', { class: 'meta' }, h('div', { class: 'name', title: f.name }, f.name), h('div', { class: 'size' }, formatBytes(f.size))),
      sortable && n > 1 && button('', { icon: 'chevron-up', variant: 'ghost', size: 'sm', ariaLabel: `Move ${f.name} up`, disabled: disabled || i === 0, attrs: { dataset: { act: 'up', i } }, onClick: () => move(i, i - 1, 'up') }),
      sortable && n > 1 && button('', { icon: 'chevron-down', variant: 'ghost', size: 'sm', ariaLabel: `Move ${f.name} down`, disabled: disabled || i === n - 1, attrs: { dataset: { act: 'down', i } }, onClick: () => move(i, i + 1, 'down') }),
      button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: `Remove ${f.name}`, disabled, attrs: { dataset: { act: 'rm', i } }, onClick: () => { api.files.splice(i, 1); render(['rm', Math.min(i, api.files.length - 1)]); onChange?.(api.files) } }))
      return li
    }))
    if (focus) {
      const [act, idx] = focus
      const target = list.querySelector(`[data-act="${act}"][data-i="${idx}"]:not(:disabled)`) || list.querySelector('[data-act]:not(:disabled)')
      target?.focus()
    }
  }
  api.set = (files) => { api.files = [...files]; render(); onChange?.(api.files) }
  api.add = (files) => api.set([...api.files, ...files])
  api.setDisabled = (b) => { disabled = !!b; render() }
  api.destroy = () => { for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear() }
  onCleanup(api.destroy)
  render()
  return api
}

/** Image/canvas/video preview on a checkerboard. */
export const preview = (child) => h('div', { class: 'preview' }, child)

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '-'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (Math.abs(n) >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${i ? n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0) : n} ${u[i]}`
}

export const formatNumber = (n, max = 2, locale) => Number.isFinite(n) ? n.toLocaleString(locale, { maximumFractionDigits: max }) : '-'

export function formatDuration(sec) {
  if (!Number.isFinite(sec)) return '-'
  const s = Math.round(sec)
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60
  return (hh ? `${hh}:${String(mm).padStart(2, '0')}` : `${mm}`) + `:${String(ss).padStart(2, '0')}`
}

export function debounce(fn, ms = 200) {
  let t
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) }
}

/** modal({title, body: Node | Node[], actions: [buttons], onClose, icon}) -> {el, close()} - accessible <dialog>. */
export function modal({ title, body, actions = [], onClose, icon: ic }) {
  const tid = `modal${++uid}`
  const dlg = h('dialog', { class: 'modal', 'aria-labelledby': tid, onclose: () => { dlg.remove(); onClose?.() } },
    h('div', { class: 'modal-head' }, h('h2', { id: tid }, ic && icon(ic), title), button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: 'Close', onClick: () => dlg.close() })),
    h('div', { class: 'modal-body' }, body),
    actions.length ? h('div', { class: 'modal-foot' }, actions) : null)
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close() })
  document.body.append(dlg)
  dlg.showModal()
  return { el: dlg, close: () => dlg.close() }
}

function omit(o, ...keys) {
  const r = { ...o }
  for (const k of keys) delete r[k]
  return r
}

/** Open another tool with files already loaded (they go to its dropzone after it mounts), e.g. openToolWith('vector-studio', [svgFile]). */
export function openToolWith(id, files) {
  window.dispatchEvent(new CustomEvent('tools:open-with', { detail: { id, files: [...files] } }))
}
