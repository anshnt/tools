// Extract links from a PDF: clickable link annotations (web, email, page jumps) plus URLs and email addresses found in the text,
// with page numbers, the link text, copy and CSV export. Shows which URLs in the text are not actually clickable.
import { h, icon, button, field, input, segmented, stats, table, empty, clear, copyButton, downloadButton, toast, progress, yieldToMain } from '../../lib/ui.js'
import { baseName } from '../../lib/files.js'
import { pdfSource, ppRoot, useStyle, destToPage, toCSV, countUp, compressRanges } from './_shared.js'

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g

/** URLs and email addresses in plain text. -> [{kind: 'url' | 'email', value}] */
export function findInText(text) {
  const out = []
  for (const m of text.matchAll(URL_RE)) {
    let v = m[0]
    while (/[.,;:!?'"\]}>]$/.test(v) || (v.endsWith(')') && !v.includes('('))) v = v.slice(0, -1)
    if (v.length > 4) out.push({ kind: 'url', value: v })
  }
  const urlSpans = [...text.matchAll(URL_RE)].map((m) => [m.index, m.index + m[0].length])
  for (const m of text.matchAll(EMAIL_RE)) {
    if (urlSpans.some(([a, b]) => m.index >= a && m.index < b)) continue // an email inside a URL is part of the URL
    out.push({ kind: 'email', value: m[0].replace(/[.,;:]+$/, '') })
  }
  return out
}

const norm = (u) => u.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '').toLowerCase()
const openable = (u) => /^(https?:|mailto:)/i.test(u) || /^www\./i.test(u)
const hrefOf = (u) => (/^www\./i.test(u) ? `https://${u}` : u)

const TYPES = {
  web: ['Web link', 'link', true],
  mail: ['Email link', 'mail', true],
  jump: ['Page jump', 'corner-down-right', true],
  other: ['Other link', 'external-link', true],
  texturl: ['URL in text', 'type', false],
  textmail: ['Email in text', 'at-sign', false],
}

export function mount(root, { signal }) {
  const body = h('div', { class: 'stack' })
  let s
  let gen = 0
  const src = pdfSource({ onLoad: (source) => { s = source; return scan(source) }, onClear: () => { s = null; gen++; clear(body) } })

  async function scan(source) {
    const my = ++gen
    const alive = () => my === gen && !source.dead && !signal.aborted
    const prog = progress()
    clear(body, h('div', { class: 'row' }, h('span', { class: 'spinner' }), h('strong', 'Reading links...')), prog.el)
    const rows = []
    for (let p = 1; p <= source.pages && alive(); p++) {
      prog.set((p - 1) / source.pages, `Page ${p} of ${source.pages}`)
      const page = await source.doc.getPage(p)
      const [annots, tc] = await Promise.all([page.getAnnotations(), page.getTextContent()])
      const items = tc.items.filter((i) => 'str' in i)
      // link annotations
      for (const a of annots) {
        if (a.subtype !== 'Link') continue
        const label = textUnder(items, a.rect)
        if (a.url || a.unsafeUrl) {
          const url = a.url || a.unsafeUrl
          const type = /^mailto:/i.test(url) ? 'mail' : /^https?:/i.test(url) ? 'web' : 'other'
          rows.push({ page: p, type, target: url.replace(/^mailto:/i, ''), href: url, text: label, clickable: true })
        } else if (a.dest || a.action === 'GoTo') {
          const idx = await destToPage(source.doc, a.dest)
          rows.push({ page: p, type: 'jump', target: idx == null ? 'Somewhere in this PDF' : `Page ${idx + 1}`, href: null, text: label, clickable: true, to: idx == null ? null : idx + 1 })
        } else if (a.action) {
          rows.push({ page: p, type: 'other', target: `${a.action}${a.filename ? `: ${a.filename}` : ''}`, href: null, text: label, clickable: true })
        }
      }
      // text
      let text = ''
      let lastY
      for (const it of items) {
        const y = it.transform?.[5]
        if (lastY !== undefined && Math.abs(y - lastY) > 2 && text && !/\s$/.test(text)) text += '\n'
        text += it.str
        if (it.hasEOL) text += '\n'
        lastY = y
      }
      for (const f of findInText(text)) rows.push({ page: p, type: f.kind === 'url' ? 'texturl' : 'textmail', target: f.value, href: f.kind === 'email' ? `mailto:${f.value}` : hrefOf(f.value), text: '', clickable: false })
      page.cleanup()
      if (p % 5 === 0) await yieldToMain()
    }
    if (!alive()) return
    // a URL typed in the text counts as clickable if an annotation points to it
    const clickableSet = new Set(rows.filter((r) => r.clickable && (r.type === 'web' || r.type === 'mail')).map((r) => norm(r.target)))
    for (const r of rows) if (!r.clickable) r.hasLink = clickableSet.has(norm(r.target))
    prog.hide()
    show(rows)
  }

  /** Text of the items whose centre falls inside the annotation rectangle. */
  function textUnder(items, rect) {
    if (!rect) return ''
    const [x1, y1, x2, y2] = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])]
    const hit = items.filter((i) => {
      if (!i.str.trim() || !i.transform) return false
      const cx = i.transform[4] + (i.width || 0) / 2, cy = i.transform[5] + (i.height || 8) / 2.5
      return cx >= x1 - 2 && cx <= x2 + 2 && cy >= y1 - 3 && cy <= y2 + 3
    })
    return hit.map((i) => i.str).join('').replace(/\s+/g, ' ').trim().slice(0, 140)
  }

  function show(rows) {
    if (!rows.length) {
      clear(body, empty('No links, URLs or email addresses found in this PDF. If it is a scan, run OCR first so the text can be read.', 'link-2-off'))
      return
    }
    const state = { type: 'all', q: '', merge: true }
    const info = h('div')
    const out = h('div', { class: 'stack' })
    const q = input({ placeholder: 'Filter links...', 'aria-label': 'Filter links', oninput: (e) => { state.q = e.target.value.toLowerCase(); render() } })

    const filtered = () => {
      let list = rows.filter((r) => {
        if (state.type === 'web') return r.type === 'web' || r.type === 'texturl'
        if (state.type === 'mail') return r.type === 'mail' || r.type === 'textmail'
        if (state.type === 'jump') return r.type === 'jump'
        if (state.type === 'dead') return !r.clickable && !r.hasLink && (r.type === 'texturl' || r.type === 'textmail')
        return true
      })
      if (state.q) list = list.filter((r) => `${r.target} ${r.text} ${TYPES[r.type][0]}`.toLowerCase().includes(state.q))
      if (!state.merge) return list.map((r) => ({ ...r, pages: [r.page], count: 1 }))
      const map = new Map()
      for (const r of list) {
        const key = `${r.type}|${norm(r.target)}`
        if (!map.has(key)) map.set(key, { ...r, pages: [], count: 0 })
        const m = map.get(key); m.pages.push(r.page); m.count++
        if (!m.text && r.text) m.text = r.text
      }
      return [...map.values()]
    }

    function render() {
      const list = filtered()
      const web = rows.filter((r) => r.type === 'web' || r.type === 'texturl')
      const mails = rows.filter((r) => r.type === 'mail' || r.type === 'textmail')
      const dead = rows.filter((r) => !r.clickable && !r.hasLink && (r.type === 'texturl' || r.type === 'textmail'))
      const uniq = (a) => new Set(a.map((r) => norm(r.target))).size
      const st = stats([
        { label: 'Web links', value: h('span', { 'data-n': uniq(web) }, '0'), accent: true, hint: `${rows.filter((r) => r.type === 'web').length} clickable` },
        { label: 'Emails', value: h('span', { 'data-n': uniq(mails) }, '0') },
        { label: 'Page jumps', value: h('span', { 'data-n': rows.filter((r) => r.type === 'jump').length }, '0') },
        { label: 'Not clickable', value: h('span', { 'data-n': new Set(dead.map((r) => norm(r.target))).size }, '0'), danger: dead.length > 0, hint: 'Typed in text, no link' },
      ])
      if (!render.done) for (const el of st.querySelectorAll('[data-n]')) countUp(el, +el.dataset.n, { ms: 500 })
      else for (const el of st.querySelectorAll('[data-n]')) el.textContent = el.dataset.n
      render.done = true
      clear(info, st)
      const tbl = table({
        columns: ['Pages', 'Type', 'Link', 'Link text'],
        max: 1500,
        rows: list.map((r) => {
          const [label, ic, clickable] = TYPES[r.type]
          const chip = h('span', { class: ['pp-chip', clickable ? 'ok' : (r.hasLink ? 'plain' : 'warn')] }, icon(ic), label)
          const target = r.href && openable(r.href)
            ? h('a', { class: 'link pp-link', href: hrefOf(r.href), target: '_blank', rel: 'noopener noreferrer', title: 'Open in a new tab' }, r.target)
            : h('span', { class: 'pp-link-plain' }, r.target)
          return [h('span', compressRanges(r.pages) + (r.count > 1 ? ` (${r.count}x)` : '')), chip, target, r.text || (r.type.startsWith('text') ? (r.hasLink ? 'Also a clickable link' : 'No link attached') : '')]
        }),
      })
      const plain = () => list.map((r) => (r.type === 'jump' ? `Page ${r.to ?? '?'}` : r.target)).join('\n')
      const csv = () => toCSV([['Page', 'Type', 'Link', 'Link text', 'Clickable'], ...list.flatMap((r) => r.pages.map((p) => [p, TYPES[r.type][0], r.target, r.text, r.clickable || r.hasLink ? 'yes' : 'no']))])
      clear(out,
        h('div', { class: 'pp-toolbar' }, h('div', { class: 'grow' }, q), copyButton(plain, `Copy ${list.length}`), downloadButton(() => new Blob([csv()], { type: 'text/csv' }), `${baseName(s.name)}-links.csv`, 'CSV', { variant: 'secondary', size: 'sm' })),
        list.length ? tbl : empty('Nothing matches this filter.', 'search-x'))
    }

    clear(body, info,
      h('div', { class: 'pp-toolbar' },
        field('Show', segmented([['all', 'All'], ['web', 'Web'], ['mail', 'Email'], ['jump', 'Page jumps'], ['dead', 'Not clickable']], 'all', (v) => { state.type = v; render() }, 'Link type')),
        field('Repeats', segmented([['merge', 'Merge duplicates'], ['all', 'Every one']], 'merge', (v) => { state.merge = v === 'merge'; render() }, 'Duplicates'))),
      out)
    render()
  }

  useStyle('pp-style-links', CSS)
  root.append(ppRoot(src.el, body))
}

const CSS = `
.pp .pp-link { display: inline-block; max-width: 420px; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; }
.pp .pp-link-plain { display: inline-block; max-width: 420px; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; }
.pp .table-wrap .pp-chip { height: 22px; }
.pp .table-wrap .pp-chip .icon { width: 13px; height: 13px; }
`
