// HTTP status codes: every standard code plus common nginx, Cloudflare and IIS codes, searchable, with causes, fixes and code snippets.
import { h, icon, input, button, table, empty, clear, copyText } from '../../lib/ui.js'
import { useKit, css, chips, eyebrow, pill, outBox, hashParams } from './_kit.js'
import { CODES, CLASSES, CHOOSER } from './_http-codes.js'

const COLOR = { 1: 'var(--info)', 2: 'var(--success)', 3: 'var(--accent)', 4: 'var(--warning)', 5: 'var(--danger)' }
CODES.sort((a, b) => a[0] - b[0])
const byCode = new Map(CODES.map((c) => [c[0], c]))

export const searchCodes = (q, cls = 'all') => {
  const s = q.trim().toLowerCase()
  const inClass = ([code, , kind]) => (cls === 'unofficial' ? kind !== 'std' : cls === 'all' || (kind === 'std' && String(code)[0] === cls))
  const pool = CODES.filter(inClass)
  if (!s) return pool
  const rank = ([code, name, kind, what, when, todo]) => {
    if (/^\d{1,3}$/.test(s)) return String(code).startsWith(s) ? 0 : 9
    if (/^\dxx$/.test(s)) return String(code)[0] === s[0] ? 0 : 9
    const n = name.toLowerCase()
    const base = kind === 'std' ? 0 : 0.5
    if (n === s) return base
    if (n.includes(s)) return 1 + base
    if (what.toLowerCase().includes(s)) return 2 + base
    if (`${when} ${todo} ${kind}`.toLowerCase().includes(s)) return 3 + base
    return 9
  }
  return pool.map((c) => [rank(c), c]).filter(([r]) => r < 9).sort((a, b) => a[0] - b[0] || a[1][0] - b[1][0]).map(([, c]) => c)
}

const snippet = (code, name, lang) => {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return {
    line: `HTTP/1.1 ${code} ${name}`,
    express: `res.status(${code}).json({ error: '${slug}' })`,
    flask: `return jsonify(error='${slug}'), ${code}`,
    fastapi: `raise HTTPException(status_code=${code}, detail='${slug}')`,
    php: `http_response_code(${code});`,
    spring: `return ResponseEntity.status(${code}).body(Map.of("error", "${slug}"));`,
    go: `http.Error(w, "${name}", ${code})`,
    nginx: code >= 300 && code < 400 ? `return ${code} https://example.com$request_uri;` : `return ${code};`,
    fetch: `if (res.status === ${code}) {\n  // handle ${name}\n}`,
    curl: `curl -i -o /dev/null -w "%{http_code}\\n" https://example.com`,
  }[lang]
}

const STYLE = `
.t-hs .hs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 270px), 1fr)); gap: 10px; }
.t-hs .hs-card { text-align: left; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 12px; align-items: start; padding: 12px 14px; border-radius: 16px; border: 1px solid var(--border); background: var(--surface); color: inherit; cursor: pointer; min-width: 0;
  transition: border-color .2s, transform .25s var(--spring), box-shadow .2s; animation: dv-rise .35s var(--ease) both; animation-delay: calc(var(--i, 0) * 10ms); }
.t-hs .hs-card:hover { border-color: color-mix(in srgb, var(--c) 55%, var(--border)); transform: translateY(-2px); box-shadow: var(--shadow); }
.t-hs .hs-card[aria-pressed="true"] { border-color: var(--c); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 25%, transparent); }
.t-hs .hs-card .n { grid-row: 1 / span 2; font-family: var(--mono); font-size: 25px; font-weight: 700; letter-spacing: -.03em; color: var(--c); line-height: 1.15; }
.t-hs .hs-card b { font-size: 14px; font-weight: 600; }
.t-hs .hs-card span { font-size: 12.5px; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.t-hs .hs-big { font-family: var(--mono); font-size: clamp(54px, 12vw, 92px); font-weight: 800; letter-spacing: -.05em; line-height: .95; color: var(--c); }
.t-hs .hs-dl { display: grid; gap: 14px; }
.t-hs .hs-dl h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); font-weight: 650; margin: 0 0 4px; }
.t-hs .hs-dl p { margin: 0; font-size: 15px; line-height: 1.55; }
.t-hs .hs-detail { border-left: 4px solid var(--c); }
.t-hs .hs-hd { display: flex; gap: 6px; flex-wrap: wrap; }
.t-hs .hs-hd code { font-family: var(--mono); font-size: 12px; background: var(--surface-2); border: 1px solid var(--border); padding: 2px 8px; border-radius: 8px; }
`

export function mount(root) {
  useKit()
  css('t-hs-css', STYLE)
  const q = hashParams()
  let sel = byCode.get(+q.get('code')) || byCode.get(404)
  let cls = 'all'
  let query = ''
  const search = input({ type: 'search', placeholder: 'Search by code or words: 404, redirect, rate limit, timeout...', 'aria-label': 'Search status codes', oninput: (e) => { query = e.target.value; renderGrid() }, onkeydown: (e) => { if (e.key === 'Enter') { const r = searchCodes(query, cls); if (r.length) pick(r[0]) } } })
  const classChips = chips([['all', 'All'], ['1', '1xx Info'], ['2', '2xx Success'], ['3', '3xx Redirect'], ['4', '4xx Client error'], ['5', '5xx Server error'], ['unofficial', 'Unofficial']], { value: 'all', ariaLabel: 'Class', onChange: (v) => { cls = v; renderGrid() } })
  const grid = h('div', { class: 'hs-grid' })
  const detail = h('div', { class: 'panel stack hs-detail' })
  const lang = chips([['line', 'Status line'], ['express', 'Express'], ['flask', 'Flask'], ['fastapi', 'FastAPI'], ['spring', 'Spring'], ['go', 'Go'], ['php', 'PHP'], ['nginx', 'nginx'], ['fetch', 'fetch']], { value: 'line', ariaLabel: 'Snippet', onChange: () => renderSnippet() })
  const snip = outBox('Use it', { placeholder: '' })
  const renderSnippet = () => snip.set(snippet(sel[0], sel[1], lang.value), { quiet: true })

  function pick(c, scroll) {
    sel = c
    for (const b of grid.children) b.setAttribute?.('aria-pressed', String(+b.dataset.code === c[0]))
    const [code, name, kind, what, when, todo, headers] = c
    const klass = String(code)[0]
    const std = kind === 'std'
    detail.style.setProperty('--c', COLOR[klass])
    clear(detail,
      h('div', { class: 'row between', style: 'align-items:flex-start' },
        h('div', { class: 'stack tight' }, h('div', { class: 'hs-big' }, code), h('h2', { style: 'margin:0;font-size:22px;letter-spacing:-.02em' }, name),
          h('div', { class: 'row', style: 'gap:6px' }, pill('', null, `${klass}xx ${CLASSES[klass]}`), std ? pill('ok', 'badge-check', 'Standard') : pill('warn', 'triangle-alert', `Unofficial: ${kind}`))),
        h('div', { class: 'row', style: 'gap:6px' },
          button('Copy line', { icon: 'copy', size: 'sm', onClick: () => copyText(`${code} ${name}`) }),
          std ? h('a', { class: 'btn btn-secondary btn-sm', href: `https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/${code}`, target: '_blank', rel: 'noopener' }, icon('external-link'), h('span', 'MDN')) : null)),
      h('div', { class: 'hs-dl' },
        h('div', h('h3', 'What it means'), h('p', what)),
        h('div', h('h3', 'When you see it or send it'), h('p', when)),
        h('div', h('h3', 'What to do'), h('p', todo)),
        headers ? h('div', h('h3', 'Related headers'), h('div', { class: 'hs-hd' }, headers.split(',').map((x) => h('code', x.trim())))) : null),
      h('div', { class: 'stack tight' }, eyebrow('code', 'Use it in code'), lang, snip.el))
    renderSnippet()
    if (scroll) detail.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }

  function renderGrid() {
    const list = searchCodes(query, cls)
    clear(grid, ...(list.length ? list.map((c, i) => h('button', { type: 'button', class: 'hs-card', dataset: { code: c[0] }, 'aria-pressed': String(c[0] === sel[0]), style: { '--c': COLOR[String(c[0])[0]], '--i': Math.min(i, 24) }, onclick: () => pick(c, true) },
      h('div', { class: 'n' }, c[0]), h('b', c[1]), h('span', c[3]))) : [h('div', { style: 'grid-column:1/-1' }, empty('No status code matches that. Try a number like 429 or a word like timeout.', 'search-x'))]))
  }

  root.append(h('div', { class: 'dv t-hs stack' }, detail,
    h('div', { class: 'stack tight' }, h('div', { class: 'row between' }, eyebrow('list', `All status codes (${CODES.length})`)), search, classChips), grid,
    h('div', { class: 'panel stack tight' }, eyebrow('route', 'Which status should my API return?'),
      table({ columns: ['Situation', { label: 'Use', num: true }, 'Note'], rows: CHOOSER.map(([s, c, n]) => [s, h('button', { type: 'button', class: 'dv-chip mono', style: 'min-height:28px', onclick: () => pick(byCode.get(c), true) }, c), n]) })),
    h('p', { class: 'small muted' }, 'Standard codes follow the IANA HTTP Status Code Registry and RFC 9110. Unofficial codes come from nginx, Cloudflare, IIS and other products; they are not part of the standard and are not guaranteed to mean the same thing elsewhere.')))
  renderGrid()
  pick(sel)
}
