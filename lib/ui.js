// UI kit shared by every tool. Build tool UIs from these helpers so all ~400 tools
// look and behave the same (light/dark, mobile, keyboard). Styles live in assets/app.css.

const SVG_NS = 'http://www.w3.org/2000/svg'
const SVG_TAGS = new Set(['svg', 'path', 'g', 'circle', 'rect', 'line', 'polyline', 'polygon', 'text', 'defs', 'clipPath', 'use', 'ellipse', 'tspan', 'marker', 'pattern', 'linearGradient', 'radialGradient', 'stop', 'mask', 'foreignObject'])
const PROP_BLOCKLIST = new Set(['list', 'form', 'type', 'for', 'role'])

/** h('div', {class: 'row', onclick}, child, 'text', [more]) -> Element. Props: class (string|array), style (string|object), dataset, on* handlers, html (innerHTML). */
export function h(tag, props, ...kids) {
  const svg = SVG_TAGS.has(tag)
  const el = svg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag)
  if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
    kids.unshift(props)
    props = {}
  }
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue
    if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v)
    else if (k === 'style') typeof v === 'string' ? el.setAttribute('style', v) : Object.assign(el.style, v)
    else if (k === 'dataset') Object.assign(el.dataset, v)
    else if (k === 'html') el.innerHTML = v
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v)
    else if (!svg && k in el && !PROP_BLOCKLIST.has(k) && !k.includes('-')) el[k] = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  append(el, kids)
  return el
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

/** button('Merge', {variant: 'primary'|'secondary'|'ghost'|'danger', icon, size: 'sm'|'lg', block, onClick, title, disabled}) */
export function button(label, opts = {}) {
  const { variant = 'secondary', icon: ic, size, block, onClick, title, disabled, type = 'button', attrs = {} } = opts
  return h('button', {
    type, class: ['btn', `btn-${variant}`, size && `btn-${size}`, block && 'btn-block', !label && 'btn-icon'],
    onclick: onClick, title: title || (!label ? opts.ariaLabel : null), 'aria-label': opts.ariaLabel || null, disabled, ...attrs,
  }, ic && icon(ic), label && h('span', label))
}

/** Runs fn while the button shows a spinner; errors become an error toast. Returns fn's result (or undefined on error). */
export async function busy(btn, fn, busyLabel) {
  if (btn.getAttribute('aria-busy') === 'true') return
  const original = [...btn.childNodes]
  btn.setAttribute('aria-busy', 'true')
  btn.disabled = true
  btn.replaceChildren(h('span', { class: 'spinner' }), h('span', busyLabel || btn.textContent || 'Working'))
  try {
    return await fn()
  } catch (err) {
    console.error(err)
    toast(errorMessage(err), 'error')
  } finally {
    btn.replaceChildren(...original)
    btn.removeAttribute('aria-busy')
    btn.disabled = false
  }
}

export const errorMessage = (err) => (err && (err.userMessage || err.message)) || String(err) || 'Something went wrong'

/** field('Quality', control, 'hint') - label wrapper. Pass {output: el} as 4th arg to show a live value next to the label. */
export function field(label, control, hint, extra = {}) {
  const formCtl = control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement
  return h(formCtl ? 'label' : 'div', { class: 'field' },
    label && h('span', { class: 'field-label' }, h('span', label), extra.output || null),
    control,
    hint && h('small', { class: 'field-hint' }, hint))
}

export const input = (props = {}) => h('input', { class: ['input', props.mono && 'mono'], type: 'text', ...omit(props, 'mono') })
export function textarea(props = {}) {
  const el = h('textarea', { class: ['textarea', props.mono && 'mono'], ...omit(props, 'mono') })
  if (props.mono) el.spellcheck = false
  return el
}

/** number(value, {min, max, step, onInput}) */
export function number(value, opts = {}) {
  return h('input', { class: 'input', type: 'number', inputmode: 'decimal', value, min: opts.min, max: opts.max, step: opts.step ?? 'any', placeholder: opts.placeholder, oninput: opts.onInput && ((e) => opts.onInput(e.target.valueAsNumber, e)) })
}

/** select(options, value, onChange). options: ['a','b'] | [['value','Label']] | [{value,label}] */
export function select(options, value, onChange) {
  const el = h('select', { class: 'select', onchange: onChange && ((e) => onChange(e.target.value, e)) },
    options.map((o) => {
      const [v, l] = Array.isArray(o) ? o : typeof o === 'object' ? [o.value, o.label] : [o, o]
      return h('option', { value: v, selected: String(v) === String(value) }, l)
    }))
  return el
}

/** range({min, max, step, value, onInput, format}) -> {el, input, output}. Put el inside field(label, el) or use rangeField. */
export function rangeField(label, opts) {
  const { min = 0, max = 100, step = 1, value = 50, onInput, format = (v) => v, hint } = opts
  const output = h('output', format(value))
  const inp = h('input', { type: 'range', min, max, step, value, oninput: (e) => { output.textContent = format(e.target.valueAsNumber); onInput?.(e.target.valueAsNumber, e) } })
  const el = field(label, inp, hint, { output })
  el.input = inp
  return el
}

/** toggle('Keep aspect ratio', true, (checked) => ...) */
export function toggle(label, checked, onChange) {
  const inp = h('input', { type: 'checkbox', role: 'switch', checked, onchange: (e) => onChange?.(e.target.checked, e) })
  const el = h('label', { class: 'switch' }, inp, h('span', label))
  el.input = inp
  return el
}

/** segmented([['a','A'],['b','B']], 'a', onChange) -> element with .value */
export function segmented(options, value, onChange) {
  const el = h('div', { class: 'seg', role: 'group' })
  el.value = value
  const render = () => clear(el, options.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, o]
    return h('button', { type: 'button', 'aria-pressed': String(v === el.value), onclick: () => { el.value = v; render(); onChange?.(v) } }, l)
  }))
  el.set = (v) => { el.value = v; render() }
  render()
  return el
}

export const panel = (...kids) => h('section', { class: 'panel' }, kids)
/** card('Title', ...children) - a panel with a heading; pass an element as title to add actions. */
export const card = (title, ...kids) => h('section', { class: 'panel' }, title && h('h2', title), kids)
export const row = (...kids) => h('div', { class: 'row' }, kids)
export const stack = (...kids) => h('div', { class: 'stack' }, kids)
/** split(left, right) - two columns on desktop, stacked on mobile. */
export const split = (left, right, variant = '') => h('div', { class: ['tool-split', variant] }, left, right)

/** alert('info'|'success'|'warn'|'error', ...children) */
export function alert(type, ...kids) {
  const ic = { info: 'info', success: 'circle-check', warn: 'triangle-alert', error: 'circle-alert' }[type] || 'info'
  return h('div', { class: ['alert', type], role: type === 'error' ? 'alert' : 'status' }, icon(ic), h('div', kids))
}

export function empty(text, ic = 'inbox') {
  return h('div', { class: 'empty' }, icon(ic), h('div', text))
}

/** stats([{label, value, hint, accent}]) */
export function stats(items) {
  return h('div', { class: 'stats' }, items.map((s) => h('div', { class: ['stat', s.accent && 'accent'] },
    h('div', { class: 'label' }, s.label), h('div', { class: 'value' }, s.value), s.hint && h('div', { class: 'hint' }, s.hint))))
}

/** table({columns: ['A','B'] | [{label, num}], rows: [[...]], max: 500}) */
export function table({ columns, rows, max = 1000 }) {
  const cols = columns.map((c) => (typeof c === 'string' ? { label: c } : c))
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', h('tr', cols.map((c) => h('th', { class: c.num && 'num' }, c.label)))),
    h('tbody', rows.slice(0, max).map((r) => h('tr', r.map((v, i) => h('td', { class: cols[i]?.num && 'num' }, v instanceof Node ? v : v ?? '')))))),
  rows.length > max ? h('div', { class: 'small muted', style: 'padding:8px 12px' }, `Showing ${max} of ${rows.length} rows`) : null)
}

/** tabs([{id, label, render: () => Node}], activeId) */
export function tabs(items, active = items[0]?.id, onChange) {
  const bar = h('div', { class: 'tabs', role: 'tablist' })
  const body = h('div', { style: 'padding-top:14px' })
  const el = h('div', bar, body)
  const show = (id) => {
    clear(bar, items.map((t) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(t.id === id), onclick: () => show(t.id) }, t.label)))
    clear(body, items.find((t) => t.id === id)?.render())
    onChange?.(id)
  }
  show(active)
  el.show = show
  return el
}

/** progress() -> {el, set(fraction 0..1 | null for indeterminate, text), hide(), show()} */
export function progress(text = '') {
  const bar = h('i')
  const label = h('span', text)
  const pct = h('span')
  const el = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100 },
    h('div', { class: 'progress-bar' }, bar), h('div', { class: 'progress-text' }, label, pct))
  const api = {
    el,
    set(fraction, t) {
      el.hidden = false
      if (t != null) label.textContent = t
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
      }
    },
    hide() { el.hidden = true },
    show() { el.hidden = false },
  }
  return api
}

let toastBox
/** toast('Saved', 'info'|'success'|'error') */
export function toast(message, type = 'info', ms = type === 'error' ? 6000 : 3200) {
  toastBox ??= document.body.appendChild(h('div', { class: 'toasts', 'aria-live': 'polite' }))
  const ic = { success: 'circle-check', error: 'circle-alert', info: 'info' }[type] || 'info'
  const t = h('div', { class: ['toast', type] }, icon(ic), h('span', message))
  toastBox.append(t)
  setTimeout(() => t.remove(), ms)
}

/** Copy text; shows a toast. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    toast('Copied to clipboard', 'success')
    return true
  } catch {
    const ta = h('textarea', { value: text, style: 'position:fixed;opacity:0' })
    document.body.append(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    toast(ok ? 'Copied to clipboard' : 'Copy failed', ok ? 'success' : 'error')
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

/** downloadButton(blob | () => blob | Promise<blob>, 'file.pdf', 'Download PDF') */
export function downloadButton(getBlob, filename, label = 'Download', opts = {}) {
  const btn = button(label, { icon: 'download', variant: 'primary', ...opts })
  btn.addEventListener('click', () => busy(btn, async () => {
    const blob = typeof getBlob === 'function' ? await getBlob() : getBlob
    download(blob, typeof filename === 'function' ? filename() : filename)
  }))
  return btn
}

export function matchesAccept(file, accept) {
  if (!accept) return true
  const name = file.name.toLowerCase()
  const type = (file.type || '').toLowerCase()
  return accept.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).some((a) =>
    a.startsWith('.') ? name.endsWith(a) : a.endsWith('/*') ? type.startsWith(a.slice(0, -1)) : type === a)
}

/**
 * dropzone({accept: '.pdf,application/pdf', multiple, onFiles(files), label, hint, paste: true, compact})
 * Click to browse, drag & drop, or paste from clipboard. Returns the element; el.open() opens the picker.
 */
export function dropzone(opts = {}) {
  const { accept = '', multiple = false, onFiles, label, hint, paste = true, compact = false, icon: ic = 'upload' } = opts
  const fileInput = h('input', { type: 'file', accept, multiple, onchange: (e) => { take([...e.target.files]); e.target.value = '' } })
  const el = h('div', {
    class: ['dropzone', compact && 'compact'], tabindex: 0, role: 'button',
    'aria-label': label || (multiple ? 'Choose files' : 'Choose a file'),
    onclick: () => fileInput.click(),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click() } },
    ondragover: (e) => { e.preventDefault(); el.classList.add('drag') },
    ondragleave: () => el.classList.remove('drag'),
    ondrop: (e) => { e.preventDefault(); el.classList.remove('drag'); take([...e.dataTransfer.files]) },
  },
  h('div', { class: 'dz-icon' }, icon(ic)),
  h('div', h('strong', label || (multiple ? 'Drop files here or click to browse' : 'Drop a file here or click to browse')),
    h('div', { class: 'dz-hint' }, hint || (accept ? `Accepts ${accept.replace(/,/g, ', ')}` : 'Any file') + (paste ? ' · You can also paste' : ''))),
  fileInput)

  function take(files) {
    const ok = files.filter((f) => matchesAccept(f, accept))
    if (files.length && !ok.length) return toast(`Unsupported file type. Expected ${accept}`, 'error')
    if (ok.length < files.length) toast(`Skipped ${files.length - ok.length} unsupported file(s)`)
    if (ok.length) onFiles?.(multiple ? ok : ok.slice(0, 1))
  }
  if (paste) {
    const onPaste = (e) => {
      if (!el.isConnected) return document.removeEventListener('paste', onPaste)
      if (e.target.closest?.('input, textarea, [contenteditable]')) return
      const files = [...(e.clipboardData?.files || [])]
      if (files.length) { e.preventDefault(); take(files) }
    }
    document.addEventListener('paste', onPaste)
  }
  el.open = () => fileInput.click()
  return el
}

/**
 * fileList({files, onChange(files), sortable: true}) -> {el, files, set(files), add(files)}
 * Shows thumbnails, sizes, remove buttons and drag/arrow reordering (works on touch via buttons).
 */
export function fileList(opts = {}) {
  const { onChange, sortable = true } = opts
  const list = h('ul', { class: 'file-list' })
  const api = { el: list, files: [...(opts.files || [])] }
  const urls = new Map()
  const thumbFor = (f) => {
    if (f.type?.startsWith('image/')) {
      if (!urls.has(f)) urls.set(f, URL.createObjectURL(f))
      return h('img', { class: 'thumb', src: urls.get(f), alt: '' })
    }
    const ic = f.type === 'application/pdf' ? 'file-text' : f.type?.startsWith('video/') ? 'file-video' : f.type?.startsWith('audio/') ? 'file-audio' : 'file'
    return h('div', { class: 'thumb' }, icon(ic))
  }
  let dragIdx = -1
  const move = (from, to) => {
    if (to < 0 || to >= api.files.length) return
    const [f] = api.files.splice(from, 1)
    api.files.splice(to, 0, f)
    render(); onChange?.(api.files)
  }
  function render() {
    clear(list, api.files.map((f, i) => {
      const li = h('li', {
        class: 'file-item', draggable: sortable,
        ondragstart: () => { dragIdx = i; li.classList.add('dragging') },
        ondragend: () => li.classList.remove('dragging'),
        ondragover: (e) => { e.preventDefault(); li.classList.add('over') },
        ondragleave: () => li.classList.remove('over'),
        ondrop: (e) => { e.preventDefault(); li.classList.remove('over'); if (dragIdx > -1) move(dragIdx, i); dragIdx = -1 },
      },
      sortable && h('span', { class: 'handle', 'aria-hidden': 'true' }, icon('grip-vertical')),
      thumbFor(f),
      h('div', { class: 'meta' }, h('div', { class: 'name', title: f.name }, f.name), h('div', { class: 'size' }, formatBytes(f.size))),
      sortable && api.files.length > 1 && button('', { icon: 'chevron-up', variant: 'ghost', size: 'sm', ariaLabel: 'Move up', disabled: i === 0, onClick: () => move(i, i - 1) }),
      sortable && api.files.length > 1 && button('', { icon: 'chevron-down', variant: 'ghost', size: 'sm', ariaLabel: 'Move down', disabled: i === api.files.length - 1, onClick: () => move(i, i + 1) }),
      button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: `Remove ${f.name}`, onClick: () => { api.files.splice(i, 1); render(); onChange?.(api.files) } }))
      return li
    }))
  }
  api.set = (files) => { api.files = [...files]; render(); onChange?.(api.files) }
  api.add = (files) => api.set([...api.files, ...files])
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

/** modal({title, body: Node, actions: [buttons], onClose}) -> {el, close()} - accessible <dialog>. */
export function modal({ title, body, actions = [], onClose, icon: ic }) {
  const dlg = h('dialog', { class: 'modal', onclose: () => { dlg.remove(); onClose?.() } },
    h('div', { class: 'modal-head' }, h('h2', ic && icon(ic), title), button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: 'Close', onClick: () => dlg.close() })),
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
