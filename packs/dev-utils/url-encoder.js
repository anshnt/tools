// URL encoder / decoder: component, full URI, form (+ for spaces) and strict RFC 3986, per-line batch, URL breakdown.
import { h, icon, segmented, toggle, textarea, button, split, alert, clear, table, stats } from '../../lib/ui.js'
import { useKit, css, outBox, chips, eyebrow, pill, copyRow } from './_kit.js'

const pct = (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')

export const KINDS = {
  component: { label: 'Component', hint: 'encodeURIComponent: encodes everything except letters, digits and - _ . ! ~ * \' ( ). Use it for a single query value or path segment.', fn: (s) => encodeURIComponent(s) },
  uri: { label: 'Full URL', hint: 'encodeURI: keeps the structure of a URL (: / ? # & = @ and similar stay as they are) and only encodes spaces, non-ASCII and unsafe characters.', fn: (s) => encodeURI(s) },
  form: { label: 'Form (+)', hint: 'application/x-www-form-urlencoded: like Component, but spaces become + (what HTML forms and URLSearchParams produce).', fn: (s) => encodeURIComponent(s).replace(/%20/g, '+').replace(/[!'()~]/g, pct) },
  strict: { label: 'Strict', hint: 'RFC 3986: only letters, digits and - _ . ~ stay readable. Everything else, including ! \' ( ) *, is percent-encoded.', fn: (s) => encodeURIComponent(s).replace(/[!'()*]/g, pct) },
}

export const encodeUrl = (text, kind = 'component') => KINDS[kind].fn(text)

/** Decode %XX sequences. Invalid UTF-8 is replaced with U+FFFD and reported in `lossy`. */
export function decodeUrl(text, { plus = true } = {}) {
  const src = plus ? text.replace(/\+/g, ' ') : text
  try { return { text: decodeURIComponent(src), lossy: false } } catch { /* fall through to lenient mode */ }
  let lossy = false
  const out = src.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try { return decodeURIComponent(run) } catch {
      lossy = true
      const bytes = Uint8Array.from(run.match(/%[0-9A-Fa-f]{2}/g).map((x) => parseInt(x.slice(1), 16)))
      return new TextDecoder('utf-8').decode(bytes)
    }
  })
  return { text: out, lossy, stray: /%(?![0-9A-Fa-f]{2})/.test(out) }
}

/** Run an operation on the whole text, or on every line separately. */
export function transform(text, { action = 'encode', kind = 'component', plus = true, lines = false } = {}) {
  let lossy = false
  const one = (s) => {
    if (action === 'encode') return encodeUrl(s, kind)
    const r = decodeUrl(s, { plus })
    lossy ||= r.lossy
    return r.text
  }
  const out = lines ? text.split(/\r?\n/).map(one).join('\n') : one(text)
  return { out, lossy }
}

/** Break a URL into its parts, or null if it is not an absolute URL. */
export function parseUrl(text) {
  const s = text.trim()
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return null
  try {
    const u = new URL(s)
    const params = []
    for (const [k, v] of u.searchParams) params.push([k, v])
    return { scheme: u.protocol.replace(':', ''), user: u.username, host: u.hostname, port: u.port, path: u.pathname, query: u.search.slice(1), hash: u.hash.slice(1), params }
  } catch { return null }
}

const STYLE = `
.t-url .diff { font-family: var(--mono); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.t-url .diff mark { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); border-radius: 4px; padding: 0 2px; font-weight: 600; animation: dv-pop .4s var(--spring); }
`

export function mount(root) {
  useKit()
  css('t-url-css', STYLE)
  let action = 'encode'
  let kind = 'component'
  const input = textarea({ rows: 8, mono: true, placeholder: 'Type or paste text or a URL...', 'aria-label': 'Input', spellcheck: false })
  const out = outBox('Result', { placeholder: 'The result appears here as you type.' })
  const hint = h('p', { class: 'small muted' })
  const note = h('div', { class: 'row', style: 'min-height:26px' })
  const extra = h('div', { class: 'stack' })
  const plus = toggle('Treat + as a space when decoding', true, () => run())
  const lines = toggle('Process each line separately', false, () => run())
  const seg = segmented([['encode', 'Encode'], ['decode', 'Decode']], 'encode', (v) => { action = v; sync(); run() }, 'Direction')
  const kindChips = chips(Object.entries(KINDS).map(([k, v]) => [k, v.label]), { value: 'component', ariaLabel: 'Encoding type', onChange: (v) => { kind = v; sync(); run() } })
  const kindWrap = h('div', { class: 'stack tight' }, eyebrow('sliders-horizontal', 'Encoding type'), kindChips)
  const inEyebrow = h('span', 'Input')

  function sync() {
    kindWrap.hidden = action !== 'encode'
    plus.hidden = action !== 'decode'
    hint.textContent = action === 'encode' ? KINDS[kind].hint : 'Percent sequences like %20 and %E2%9C%93 are turned back into characters. Invalid sequences are kept readable instead of failing.'
    inEyebrow.textContent = action === 'encode' ? 'Text to encode' : 'Encoded text'
  }

  function changedView(original, encoded) {
    // Highlight characters that were changed by encoding (only shown for short, single-line input).
    const box = h('div', { class: 'diff' })
    let i = 0
    for (const m of encoded.matchAll(/(%[0-9A-F]{2})+|\+/g)) {
      if (m.index > i) box.append(encoded.slice(i, m.index))
      box.append(h('mark', m[0]))
      i = m.index + m[0].length
    }
    if (i < encoded.length) box.append(encoded.slice(i))
    return box
  }

  function run() {
    clear(note); clear(extra)
    const text = input.value
    if (!text) { out.set(''); return }
    const r = transform(text, { action, kind, plus: plus.input.checked, lines: lines.input.checked })
    out.set(r.out)
    note.append(pill('ok', action === 'encode' ? 'lock' : 'unlock', action === 'encode' ? 'Encoded' : 'Decoded'))
    if (r.lossy) note.append(pill('warn', 'triangle-alert', 'Contained invalid UTF-8'))
    const cmp = action === 'encode' ? r.out : text
    const pc = (cmp.match(/%[0-9A-Fa-f]{2}/g) || []).length
    extra.append(stats([
      { label: 'Input', value: [...text].length.toLocaleString(), hint: 'characters' },
      { label: 'Output', value: [...r.out].length.toLocaleString(), hint: 'characters', accent: true },
      { label: 'Percent codes', value: pc.toLocaleString(), hint: action === 'encode' ? 'in the result' : 'decoded' },
    ]))
    if (action === 'decode' && /%[0-9A-Fa-f]{2}/.test(r.out)) {
      extra.append(alert('info', 'The result still contains percent codes, so it may have been encoded twice. ',
        button('Decode again', { size: 'sm', icon: 'repeat', onClick: () => { input.value = out.get(); run() } })))
    }
    if (action === 'encode' && !lines.input.checked && r.out.length < 400 && /%|\+/.test(r.out)) {
      extra.append(h('div', { class: 'panel stack tight' }, eyebrow('highlighter', 'What changed'), changedView(text, r.out)))
    }
    const u = parseUrl(action === 'encode' ? text : r.out) || parseUrl(text)
    if (u && !lines.input.checked) extra.append(breakdown(u))
  }

  function breakdown(u) {
    const parts = [['Scheme', u.scheme], ['Host', u.host], u.port && ['Port', u.port], u.user && ['User', u.user], ['Path', u.path], u.query && ['Query', u.query], u.hash && ['Fragment', u.hash]].filter(Boolean)
    return h('div', { class: 'panel stack' },
      eyebrow('globe', 'URL breakdown'),
      h('div', { class: 'dv-card-grid' }, parts.map(([k, v]) => copyRow(k, v))),
      u.params.length ? table({ columns: ['Parameter', 'Decoded value'], rows: u.params.map(([k, v]) => [h('code', k), h('code', { title: /%[0-9A-Fa-f]{2}/.test(v) ? 'Still contains percent codes: maybe double-encoded' : '' }, v || '(empty)')]) }) : null)
  }

  const sample = button('Try an example', { icon: 'sparkles', size: 'sm', variant: 'ghost', onClick: () => {
    input.value = action === 'encode' ? 'https://example.com/search?q=café & tea&lang=en&redirect=/a b/c' : 'https%3A%2F%2Fexample.com%2Fsearch%3Fq%3Dcaf%C3%A9%20%26%20tea%26lang%3Den'
    run(); input.focus()
  } })
  const swap = button('Swap', { icon: 'arrow-left-right', size: 'sm', onClick: () => {
    const v = out.get()
    if (!v) return
    input.value = v
    action = action === 'encode' ? 'decode' : 'encode'
    seg.set(action); sync(); run()
  } })
  input.addEventListener('input', run)
  sync()
  root.append(h('div', { class: 'dv t-url stack' },
    h('div', { class: 'panel stack' }, h('div', { class: 'row between' }, seg, note), kindWrap, hint, h('div', { class: 'row' }, plus, lines)),
    split(
      h('div', { class: 'stack tight' }, h('div', { class: 'dv-eyebrow' }, icon('pencil-line'), inEyebrow), input,
        h('div', { class: 'row' }, sample, button('Clear', { icon: 'eraser', size: 'sm', variant: 'ghost', onClick: () => { input.value = ''; run(); input.focus() } }))),
      h('div', { class: 'stack tight' }, h('div', { class: 'row between' }, eyebrow('sparkles', 'Output'), swap), out.el)),
    extra))
  input.focus({ preventScroll: true })
}
