// Regex visualizer: parses a pattern and draws it as a railroad diagram (SVG) with hover explanations, SVG/PNG export and a plain-English breakdown.
import { h, svg, icon, button, input, empty, alert, clear, download, onCleanup, debounce, copyText } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { useKit, css, chips, eyebrow, pill, hashParams } from './_kit.js'
import { parseRegex, describe, explain } from './_regex-parse.js'

const CH = 7.8 // width of one monospace character at 13px
const LINE = 17
const GAP = 14
const VGAP = 10
const R = 10
const tw = (s, k = 1) => [...s].length * CH * k

const CLS = { d: 'digit', D: 'not a digit', w: 'word character', W: 'not a word character', s: 'whitespace', S: 'not whitespace' }

export const SVG_CSS = `
.rv-line { stroke: var(--text-2); stroke-width: 1.6; fill: none; stroke-linecap: round; }
.rv-dot { fill: var(--text-2); }
.rv-t { font-family: var(--mono); font-size: 13px; fill: var(--text); }
.rv-cap { font-family: var(--font); font-size: 10.5px; fill: var(--muted); }
.rv-r { stroke-width: 1.4; transition: stroke-width .15s; }
.rv-lit .rv-r { fill: color-mix(in srgb, var(--accent) 13%, var(--surface)); stroke: color-mix(in srgb, var(--accent) 55%, var(--surface)); }
.rv-set .rv-r { fill: color-mix(in srgb, var(--success) 14%, var(--surface)); stroke: color-mix(in srgb, var(--success) 55%, var(--surface)); }
.rv-pos .rv-r { fill: color-mix(in srgb, var(--warning) 15%, var(--surface)); stroke: color-mix(in srgb, var(--warning) 55%, var(--surface)); }
.rv-ref .rv-r { fill: color-mix(in srgb, var(--accent-2) 14%, var(--surface)); stroke: color-mix(in srgb, var(--accent-2) 55%, var(--surface)); }
.rv-grp .rv-r { fill: transparent; stroke: color-mix(in srgb, var(--accent) 50%, var(--surface)); stroke-dasharray: 5 4; }
.rv-ncap .rv-r { fill: transparent; stroke: var(--border-strong); stroke-dasharray: 3 4; }
.rv-look .rv-r { fill: color-mix(in srgb, var(--accent-2) 5%, transparent); stroke: color-mix(in srgb, var(--accent-2) 60%, var(--surface)); stroke-dasharray: 5 4; }
.rv-hit { fill: transparent; stroke: none; }
.rv-n { cursor: default; outline: none; }
.rv-n:hover > .rv-r, .rv-n:focus-visible > .rv-r, .rv-n.on > .rv-r { stroke-width: 2.6; }
.rv-loop { stroke: var(--muted); }
`

function path(d, cls = 'rv-line') { return svg('path', { d, class: cls }) }

// ---------- Layout items: {w, up, down, draw(x, baselineY) -> SVG nodes} ----------
function wrapWords(s, max = 24) {
  const out = []
  let cur = ''
  for (const word of s.split(' ')) {
    if (cur && tw(cur + ' ' + word) > max * CH) { out.push(cur); cur = word } else cur = cur ? cur + ' ' + word : word
  }
  if (cur) out.push(cur)
  return out.length ? out : ['']
}

function boxItem(cls, text, caption, node, hover) {
  const lines = Array.isArray(text) ? text : [text]
  const w = Math.max(24, ...lines.map((l) => tw(l)), caption ? tw(caption, 0.82) : 0) + 22
  const capH = caption ? 13 : 0
  const H = lines.length * LINE + 12 + capH
  return {
    w, up: H / 2, down: H / 2,
    draw(x, y) {
      const top = y - H / 2
      return [svg('g', { class: ['rv-n', cls], tabindex: 0, onmouseenter: () => hover(node), onfocus: () => hover(node), onclick: () => hover(node) },
        svg('rect', { class: 'rv-r', x, y: top, width: w, height: H, rx: 8 }),
        caption ? svg('text', { class: 'rv-cap', x: x + w / 2, y: top + 11, 'text-anchor': 'middle' }, caption) : null,
        lines.map((l, i) => svg('text', { class: 'rv-t', x: x + w / 2, y: top + capH + 6 + 11 + i * LINE, 'text-anchor': 'middle' }, l)))]
    },
  }
}

function seqItem(items) {
  if (!items.length) return { w: 24, up: 0, down: 0, draw: (x, y) => [path(`M${x} ${y}h24`)] }
  if (items.length === 1) return items[0]
  const w = items.reduce((a, b) => a + b.w, 0) + GAP * (items.length - 1)
  return {
    w, up: Math.max(...items.map((i) => i.up)), down: Math.max(...items.map((i) => i.down)),
    draw(x, y) {
      const out = []
      let cx = x
      items.forEach((it, i) => {
        if (i) { out.push(path(`M${cx} ${y}h${GAP}`)); cx += GAP }
        out.push(...it.draw(cx, y))
        cx += it.w
      })
      return out
    },
  }
}

function altItem(branches, node, hover) {
  const inner = Math.max(...branches.map((b) => b.w))
  const w = inner + 4 * R
  const offs = [0]
  for (let i = 1; i < branches.length; i++) offs[i] = offs[i - 1] + branches[i - 1].down + VGAP + branches[i].up
  const up = branches[0].up
  const down = offs[offs.length - 1] + branches[branches.length - 1].down
  return {
    w, up, down,
    draw(x, y) {
      const out = [svg('rect', { class: 'rv-hit', x, y: y - up, width: w, height: up + down, onmouseenter: () => hover(node), onclick: () => hover(node) })]
      branches.forEach((b, i) => {
        const yi = y + offs[i]
        const bx = x + 2 * R + (inner - b.w) / 2
        if (i === 0) out.push(path(`M${x} ${y}H${bx}`), path(`M${bx + b.w} ${y}H${x + w}`))
        else {
          out.push(path(`M${x} ${y}Q${x + R} ${y} ${x + R} ${y + R}V${yi - R}Q${x + R} ${yi} ${x + 2 * R} ${yi}H${bx}`),
            path(`M${bx + b.w} ${yi}H${x + w - 2 * R}Q${x + w - R} ${yi} ${x + w - R} ${yi - R}V${y + R}Q${x + w - R} ${y} ${x + w} ${y}`))
        }
        out.push(...b.draw(bx, yi))
      })
      return out
    },
  }
}

const quantLabel = (n) => {
  const t = n.min === 0 && n.max === Infinity ? '0 or more' : n.min === 1 && n.max === Infinity ? '1 or more'
    : n.max === Infinity ? `${n.min}+ times` : n.min === n.max ? `${n.min} times` : `${n.min}-${n.max} times`
  return t + (n.lazy ? ', lazy' : '')
}

function quantItem(body, n, hover) {
  const loop = n.max > 1
  const bypass = n.min === 0
  if (!loop && !bypass) return body
  const pad = 2 * R
  const w = body.w + 2 * pad
  const topY = bypass ? body.up + 14 : body.up
  const yb = body.down + 14
  const up = topY
  const down = loop ? yb + 22 : body.down
  return {
    w, up, down,
    draw(x, y) {
      const out = [svg('rect', { class: 'rv-hit', x, y: y - up, width: w, height: up + down, onmouseenter: () => hover(n), onclick: () => hover(n) })]
      out.push(path(`M${x} ${y}H${x + pad}`), path(`M${x + pad + body.w} ${y}H${x + w}`))
      if (bypass) {
        const ty = y - topY
        out.push(path(`M${x} ${y}Q${x + R} ${y} ${x + R} ${y - R}V${ty + R}Q${x + R} ${ty} ${x + 2 * R} ${ty}H${x + w - 2 * R}Q${x + w - R} ${ty} ${x + w - R} ${ty + R}V${y - R}Q${x + w - R} ${y} ${x + w} ${y}`))
      }
      if (loop) {
        const by = y + yb
        out.push(path(`M${x + w - R} ${y}V${by - R}Q${x + w - R} ${by} ${x + w - 2 * R} ${by}H${x + 2 * R}Q${x + R} ${by} ${x + R} ${by - R}V${y}`, 'rv-line rv-loop'),
          svg('polyline', { points: `${x + w / 2 + 4},${by - 4} ${x + w / 2 - 3},${by} ${x + w / 2 + 4},${by + 4}`, class: 'rv-line rv-loop' }),
          svg('text', { class: 'rv-cap', x: x + w / 2, y: by + 15, 'text-anchor': 'middle' }, quantLabel(n)))
      }
      out.push(...body.draw(x + pad, y))
      return out
    },
  }
}

function groupItem(body, cls, caption, node, hover) {
  const padX = 12
  const padTop = caption ? 21 : 10
  const w = Math.max(body.w + 2 * padX, caption ? tw(caption, 0.82) + 18 : 0)
  const up = body.up + padTop
  const down = body.down + 10
  return {
    w, up, down,
    draw(x, y) {
      const bx = x + (w - body.w) / 2
      return [svg('g', { class: ['rv-n', cls], tabindex: 0, onmouseenter: () => hover(node), onfocus: () => hover(node), onclick: () => hover(node) },
        svg('rect', { class: 'rv-r', x, y: y - up, width: w, height: up + down, rx: 11 }),
        caption ? svg('text', { class: 'rv-cap', x: x + 9, y: y - up + 14 }, caption) : null),
      path(`M${x} ${y}H${bx}`), path(`M${bx + body.w} ${y}H${x + w}`), ...body.draw(bx, y)]
    },
  }
}

const setText = (n) => n.items.map((it) => (it.type === 'range' ? `${it.from.raw}-${it.to.raw}` : it.type === 'cls' ? CLS[it.name] : it.type === 'prop' ? `${it.negate ? 'not ' : ''}${it.name}` : it.desc && it.raw.length === 2 ? it.raw : it.value === ' ' ? 'space' : it.raw)).join(' ')

/** Pattern AST -> layout item. hover(node, textOverride) is called when a shape is hovered. */
export function buildItem(n, flags, hover) {
  const ml = flags.includes('m')
  switch (n.type) {
    case 'seq': {
      const items = []
      for (let i = 0; i < n.items.length;) {
        let j = i
        while (j < n.items.length && n.items[j].type === 'lit' && !n.items[j].desc) j++
        if (j - i > 0) {
          const run = n.items.slice(i, j)
          const text = run.map((x) => x.value).join('')
          const node = run.length === 1 ? run[0] : { type: 'text', start: run[0].start, end: run[run.length - 1].end, value: text }
          items.push(boxItem('rv-lit', wrapWords(`"${text}"`, 30), null, node, hover))
          i = j
        } else { items.push(buildItem(n.items[i], flags, hover)); i++ }
      }
      return seqItem(items)
    }
    case 'alt': return altItem(n.alts.map((a) => buildItem(a, flags, hover)), n, hover)
    case 'quant': return quantItem(buildItem(n.body, flags, hover), n, hover)
    case 'group':
      if (n.capture) return groupItem(buildItem(n.body, flags, hover), 'rv-grp', n.name ? `group ${n.index}: ${n.name}` : `group ${n.index}`, n, hover)
      return groupItem(buildItem(n.body, flags, hover), 'rv-ncap', n.add != null ? `flags +${n.add}${n.remove ? ' -' + n.remove : ''}` : null, n, hover)
    case 'look': return groupItem(buildItem(n.body, flags, hover), 'rv-look', `${n.negate ? 'not ' : ''}${n.ahead ? 'followed by' : 'preceded by'}`, n, hover)
    case 'lit': return boxItem('rv-lit', n.desc ? [n.raw] : [`"${n.value}"`], n.desc ? n.desc.replace(/^an? /, '') : null, n, hover)
    case 'any': return boxItem('rv-set', 'any character', flags.includes('s') ? null : 'except new line', n, hover)
    case 'cls': return boxItem('rv-set', CLS[n.name], null, n, hover)
    case 'prop': return boxItem('rv-set', n.name, `${n.negate ? 'not ' : ''}Unicode`, n, hover)
    case 'set': return boxItem('rv-set', wrapWords(setText(n) || '(nothing)', 22), n.negate ? 'none of' : 'any of', n, hover)
    case 'anchor': return boxItem('rv-pos', n.kind === '^' ? (ml ? 'start of line' : 'start of text') : (ml ? 'end of line' : 'end of text'), null, n, hover)
    case 'boundary': return boxItem('rv-pos', n.negate ? 'not a word boundary' : 'word boundary', null, n, hover)
    case 'backref': return boxItem('rv-ref', n.name ? `same as "${n.name}"` : `same as group ${n.index}`, 'backreference', n, hover)
    default: return seqItem([])
  }
}

/** Full diagram SVG for a pattern. Throws a SyntaxError (with .pos) for invalid patterns. */
export function buildDiagram(pattern, flags, hover = () => {}) {
  const parsed = parseRegex(pattern, flags)
  const item = buildItem(parsed.ast, flags, hover)
  const padX = 18
  const padY = 16
  const total = item.w + 2 * (padX + 22)
  const height = item.up + item.down + 2 * padY
  const y = padY + item.up
  const x0 = padX + 22
  const root = svg('svg', { class: 'rv-svg', xmlns: 'http://www.w3.org/2000/svg', viewBox: `0 0 ${total} ${height}`, width: total, height, role: 'img', 'aria-label': 'Railroad diagram of the regular expression' },
    path(`M${padX} ${y}H${x0}`), path(`M${x0 + item.w} ${y}H${total - padX}`),
    svg('circle', { class: 'rv-dot', cx: padX, cy: y, r: 5 }), svg('circle', { class: 'rv-dot', cx: total - padX, cy: y, r: 5 }),
    ...item.draw(x0, y))
  return { svg: root, width: total, height, parsed }
}

const EXAMPLES = [
  { name: 'Email', p: String.raw`^[\w.+-]+@([\w-]+\.)+[A-Za-z]{2,}$`, f: '' },
  { name: 'Date', p: String.raw`(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])`, f: '' },
  { name: 'URL', p: String.raw`^https?:\/\/(?:www\.)?(?<host>[\w.-]+)(?::\d+)?(\/\S*)?$`, f: 'i' },
  { name: 'Lookaround', p: String.raw`\b\w+(?=\.js\b)(?<!test)`, f: '' },
  { name: 'Repeated word', p: String.raw`\b(\w+)\s+\1\b`, f: 'gi' },
]

const STYLE = `
.t-rv .rv-view { border: 1px solid var(--border); border-radius: 18px; background: var(--surface); overflow: auto; padding: 8px; max-height: 640px; background-image: radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0); background-size: 18px 18px; }
.t-rv .rv-view svg { display: block; margin: 0 auto; max-width: none; transform-origin: top left; }
.t-rv .rv-src { font-family: var(--mono); font-size: 15px; line-height: 1.6; padding: 10px 14px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--border); overflow-wrap: anywhere; }
.t-rv .rv-src mark { background: color-mix(in srgb, var(--accent) 30%, transparent); color: inherit; border-radius: 4px; box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--accent) 60%, transparent); }
.t-rv .rv-src .bad { text-decoration: underline wavy var(--danger); text-underline-offset: 4px; }
.t-rv .rv-info { min-height: 48px; display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; padding: 12px 14px; border-radius: 14px; border: 1px dashed var(--border-strong); background: var(--surface); font-size: 14px; }
.t-rv .rv-info code { font-family: var(--mono); font-size: 13px; color: var(--accent); background: var(--accent-soft); padding: 2px 8px; border-radius: 8px; overflow-wrap: anywhere; }
.t-rv .rv-legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12.5px; color: var(--muted); }
.t-rv .rv-legend i { display: inline-block; width: 12px; height: 12px; border-radius: 4px; margin-right: 6px; vertical-align: -1px; border: 1.4px solid; }
.t-rv .rv-ex { display: grid; gap: 4px; padding: 0; margin: 0; list-style: none; }
.t-rv .rv-ex li { display: grid; grid-template-columns: minmax(70px, 30%) minmax(0, 1fr); gap: 12px; padding: 7px 10px; border-radius: 10px; font-size: 13px; }
.t-rv .rv-ex li:hover { background: var(--surface-2); }
.t-rv .rv-ex code { font-family: var(--mono); font-size: 12.5px; background: var(--accent-soft); color: var(--accent); padding: 1px 7px; border-radius: 7px; overflow-wrap: anywhere; justify-self: start; }
.t-rv .rv-ex ul { grid-column: 1 / -1; margin: 2px 0 0 14px; padding-left: 12px; border-left: 2px solid var(--border); list-style: none; display: grid; gap: 4px; }
.t-rv .rv-pat { display: flex; align-items: center; gap: 8px; }
.t-rv .rv-pat .sl { font-family: var(--mono); font-size: 22px; color: var(--muted); line-height: 1; }
.t-rv .rv-pat .input { flex: 1; min-width: 0; font-size: 15px; height: 46px; }
@media (max-width: 520px) { .t-rv .rv-ex li { grid-template-columns: 1fr; gap: 2px; } }
`

/** Standalone SVG text with colours resolved from the current theme (for download and PNG export). */
export function exportSvg(svgEl) {
  const cs = getComputedStyle(document.documentElement)
  const resolve = (t) => t.replace(/var\(--([\w-]+)\)/g, (_, n) => cs.getPropertyValue('--' + n).trim() || '#888')
  const clone = svgEl.cloneNode(true)
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = resolve(SVG_CSS).replace(/font-family:[^;]+;/g, 'font-family: ui-monospace, Menlo, Consolas, monospace;')
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', cs.getPropertyValue('--surface').trim() || '#fff')
  clone.prepend(style, bg)
  clone.querySelectorAll('[tabindex]').forEach((e) => e.removeAttribute('tabindex'))
  return new XMLSerializer().serializeToString(clone)
}

export function mount(root) {
  useKit()
  css('t-rv-css', STYLE + SVG_CSS)
  const q = hashParams()
  const saved = load('regex-visualizer', null)
  const start = q.get('p') != null ? { p: q.get('p'), f: q.get('f') || '' } : saved?.p ? saved : EXAMPLES[1]
  const pattern = input({ mono: true, value: start.p, placeholder: 'Paste a regular expression...', 'aria-label': 'Regular expression', spellcheck: false, autocapitalize: 'off', autocomplete: 'off' })
  const flagChips = chips(['g', 'i', 'm', 's', 'u', 'y'].map((f) => [f, f]), { multi: true, value: [...start.f].filter((f) => 'gimsuy'.includes(f)), mono: true, ariaLabel: 'Flags', onChange: () => draw() })
  const status = h('div', { class: 'row', style: 'min-height:28px' })
  const src = h('div', { class: 'rv-src', 'aria-label': 'Pattern source with the hovered part highlighted' })
  const view = h('div', { class: 'rv-view', tabindex: 0, 'aria-label': 'Diagram' })
  const info = h('div', { class: 'rv-info', 'aria-live': 'polite' })
  const explWrap = h('div')
  let current = null
  let scale = 1
  const legend = h('div', { class: 'rv-legend' },
    ...[['var(--accent)', 'Text'], ['var(--success)', 'Character or set'], ['var(--warning)', 'Position'], ['var(--accent-2)', 'Backreference / lookaround']].map(([c, t]) => h('span', h('i', { style: `border-color:${c};background:color-mix(in srgb, ${c} 18%, transparent)` }), t)),
    h('span', 'Hover or tap a shape to read it.'))

  const flags = () => ['g', 'i', 'm', 's', 'u', 'y'].filter((f) => flagChips.value.has(f)).join('')

  function showSrc(a, b, bad) {
    const p = pattern.value
    clear(src)
    if (a == null) { src.append(h('span', { class: 'muted' }, '/'), p, h('span', { class: 'muted' }, '/' + flags())); return }
    src.append(h('span', { class: 'muted' }, '/'), p.slice(0, a), bad ? h('span', { class: 'bad' }, p.slice(a, b) || ' ') : h('mark', p.slice(a, b)), p.slice(b), h('span', { class: 'muted' }, '/' + flags()))
  }
  function hover(node) {
    clear(info, h('code', pattern.value.slice(node.start, node.end) || '(empty)'), h('span', node.type === 'text' ? `Matches the exact text "${node.value}"` : describe(node, flags())))
    showSrc(node.start, node.end)
    for (const g of view.querySelectorAll('.rv-n.on')) g.classList.remove('on')
  }
  const resetInfo = () => { clear(info, h('span', { class: 'muted' }, 'Hover over any part of the diagram to see what it does.')); showSrc() }

  function applyScale() {
    const el = view.querySelector('svg')
    if (!el || !current) return
    el.setAttribute('width', Math.round(current.width * scale))
    el.setAttribute('height', Math.round(current.height * scale))
  }

  function draw() {
    const p = pattern.value
    const f = flags()
    save('regex-visualizer', { p, f })
    clear(explWrap)
    if (!p) {
      current = null
      clear(view, empty('Enter a regular expression to see its diagram.', 'git-branch'))
      clear(status, pill('', 'info', 'Waiting for a pattern'))
      showSrc(); resetInfo()
      return
    }
    try {
      current = buildDiagram(p, f, hover)
    } catch (e) {
      current = null
      pattern.classList.add('invalid')
      clear(view, empty('This pattern cannot be drawn yet.', 'circle-alert'))
      clear(status, pill('bad', 'circle-alert', 'Invalid pattern'), h('span', { class: 'small', style: 'color:var(--danger)' }, e.message))
      if (e.pos != null) showSrc(e.pos, Math.min(p.length, e.pos + 1), true); else showSrc()
      clear(info, h('span', { class: 'muted' }, 'Fix the highlighted spot and the diagram will appear.'))
      return
    }
    pattern.classList.remove('invalid')
    clear(status, pill('ok', 'check', 'Valid pattern'), h('span', { class: 'small muted' }, `${current.parsed.groups} capture group${current.parsed.groups === 1 ? '' : 's'}`))
    view.replaceChildren(current.svg)
    scale = 1
    const avail = view.clientWidth - 16
    if (avail > 0 && current.width > avail && current.width < avail * 1.5) scale = avail / current.width
    applyScale()
    resetInfo()
    try {
      const rows = explain(current.parsed)
      const render = (list) => h('ul', { class: 'rv-ex' }, list.map((r) => h('li', h('code', r.src || '(empty)'), h('span', r.text), r.children?.length ? render(r.children) : null)))
      explWrap.append(render(rows))
    } catch { /* optional */ }
  }

  const redraw = debounce(draw, 120)
  pattern.addEventListener('input', redraw)
  view.addEventListener('mouseleave', resetInfo)
  const zoom = (k) => { scale = Math.min(3, Math.max(0.3, scale * k)); applyScale() }

  const pngExport = () => {
    if (!current) return
    const text = exportSvg(current.svg)
    const img = new Image()
    img.onload = () => {
      const k = 2
      const c = document.createElement('canvas')
      c.width = current.width * k; c.height = current.height * k
      const ctx = c.getContext('2d')
      ctx.scale(k, k)
      ctx.drawImage(img, 0, 0, current.width, current.height)
      c.toBlob((b) => b && download(b, 'regex-diagram.png'), 'image/png')
    }
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text)
  }

  root.append(h('div', { class: 'dv t-rv stack' },
    h('div', { class: 'panel stack' },
      eyebrow('git-branch', 'Regular expression'),
      h('div', { class: 'rv-pat' }, h('span', { class: 'sl', 'aria-hidden': 'true' }, '/'), pattern, h('span', { class: 'sl', 'aria-hidden': 'true' }, '/')),
      flagChips, status,
      h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Examples:'), h('div', { class: 'dv-chips' }, EXAMPLES.map((e) => h('button', { type: 'button', class: 'dv-chip', onclick: () => { pattern.value = e.p; flagChips.set([...e.f]); draw() } }, e.name))))),
    h('div', { class: 'panel stack' },
      h('div', { class: 'row between' }, eyebrow('network', 'Diagram'),
        h('div', { class: 'row', style: 'gap:6px' },
          button('', { icon: 'zoom-out', size: 'sm', variant: 'ghost', ariaLabel: 'Zoom out', onClick: () => zoom(1 / 1.2) }),
          button('', { icon: 'zoom-in', size: 'sm', variant: 'ghost', ariaLabel: 'Zoom in', onClick: () => zoom(1.2) }),
          button('Fit', { icon: 'scan', size: 'sm', variant: 'ghost', onClick: () => { if (current) { scale = Math.min(1.6, Math.max(0.3, (view.clientWidth - 16) / current.width)); applyScale() } } }),
          button('SVG', { icon: 'download', size: 'sm', onClick: () => current && download(exportSvg(current.svg), 'regex-diagram.svg', 'image/svg+xml') }),
          button('PNG', { icon: 'image', size: 'sm', onClick: pngExport }),
          button('', { icon: 'copy', size: 'sm', variant: 'ghost', ariaLabel: 'Copy pattern', onClick: () => pattern.value && copyText(pattern.value) }))),
      src, view, info, legend),
    h('div', { class: 'panel stack tight' }, eyebrow('text-search', 'In plain English'), explWrap),
    h('p', { class: 'small muted' }, 'The diagram follows the JavaScript regex syntax. Read it left to right: lines that skip over a shape mean "optional", lines that loop underneath mean "repeat". Everything runs in your browser.')))
  draw()
}
