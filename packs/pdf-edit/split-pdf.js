// Split PDF: by ranges, every N pages, one file per page, or by clicking where to cut. Parts are colour-coded on the grid.
import { h, icon, busy, progress, input, number, field, button, formatBytes, download } from '../../lib/ui.js'
import { parseRanges, savePdf } from '../../lib/pdf.js'
import { zip, suffixName, baseName } from '../../lib/files.js'
import { pdfWorkspace, dock, showResult, buildPages, plural, pick, css, formatRanges } from './_shared.js'
import { pageGrid } from './_pages.js'

const CSS = `
.pe-files { list-style: none; margin: 14px 0 0; padding: 0; display: grid; gap: 6px; max-height: 240px; overflow: auto; }
.pe-files li { display: flex; align-items: center; gap: 10px; padding: 5px 5px 5px 12px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); font-size: 13px; }
.pe-files .n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pe-files .s { color: var(--muted); font-variant-numeric: tabular-nums; }
.pe-parts { display: flex; flex-wrap: wrap; gap: 6px; max-height: 180px; overflow: auto; }
.pe-part { display: inline-flex; align-items: center; gap: 7px; padding: 5px 11px 5px 8px; border-radius: 99px; font-size: 12.5px; border: 1px solid color-mix(in srgb, var(--tint) 40%, var(--border)); background: color-mix(in srgb, var(--tint) 9%, var(--surface)); animation: pe-pop .3s var(--spring) both; }
.pe-part i { width: 9px; height: 9px; border-radius: 50%; background: var(--tint); }
.pe-part b { font-variant-numeric: tabular-nums; }
`
const tint = (i) => `hsl(${(i * 53 + 215) % 360} 68% 50%)`

/** Work out the parts for a mode. Each part is {pages: [1-based], label}. Throws a readable Error. */
export function planParts(mode, total, { text = '', every = 2, points = [] } = {}) {
  if (mode === 'ranges') {
    const parts = text.split(',').map((t) => t.trim()).filter(Boolean)
    if (!parts.length) return []
    return parts.map((t) => ({ pages: parseRanges(t, total), label: t.replace(/\s+/g, '') }))
  }
  if (mode === 'every') {
    const n = Math.max(1, Math.floor(every) || 1)
    const out = []
    for (let s = 1; s <= total; s += n) { const e = Math.min(total, s + n - 1); out.push({ pages: Array.from({ length: e - s + 1 }, (_, i) => s + i), label: s === e ? `${s}` : `${s}-${e}` }) }
    return out
  }
  if (mode === 'each') return Array.from({ length: total }, (_, i) => ({ pages: [i + 1], label: `${i + 1}` }))
  const cuts = [...new Set(points)].filter((p) => p >= 1 && p < total).sort((a, b) => a - b)
  const out = []
  let s = 1
  for (const c of [...cuts, total]) { out.push({ pages: Array.from({ length: c - s + 1 }, (_, i) => s + i), label: s === c ? `${s}` : `${s}-${c}` }); s = c + 1 }
  return out
}

export function mount(root) {
  css('pe-split', CSS)
  pdfWorkspace(root, {
    label: 'Drop a PDF to split',
    onLoad(src, ws) {
      const total = src.numPages
      const result = h('div'), prog = progress()
      let mode = total > 1 ? 'ranges' : 'each'
      const text = input({ placeholder: 'e.g. 1-3, 4-6, 7', 'aria-label': 'Page ranges, one file per comma', value: total > 3 ? `1-${Math.ceil(total / 2)}, ${Math.ceil(total / 2) + 1}-${total}` : '', oninput: () => refresh() })
      const everyN = number(2, { min: 1, max: Math.max(1, total), step: 1, ariaLabel: 'Pages per file', onInput: () => refresh() })
      const grid = pageGrid({ pdf: src.pdf, checkIcon: 'scissors', label: 'Click a page to cut after it', toolbar: false, onChange: (e) => { if (e.type === 'select') refresh() } })
      const modes = pick([
        { value: 'ranges', label: 'Ranges', hint: 'Type pages per file', icon: 'brackets' },
        { value: 'every', label: 'Every N pages', hint: 'Equal chunks', icon: 'rows-3' },
        { value: 'each', label: 'Each page', hint: 'One file per page', icon: 'files' },
        { value: 'points', label: 'Pick cuts', hint: 'Click pages below', icon: 'scissors' },
      ], mode, (v) => { mode = v; refresh() })
      const fields = { ranges: field('Pages for each file', text, 'Separate files with commas: 1-3, 4-6, 8 gives three files.'), every: field('Pages per file', everyN) }
      const partsBox = h('div', { class: 'pe-parts', 'aria-live': 'polite' })
      const errBox = h('div')
      const btn = button('Split PDF', { icon: 'scissors', variant: 'primary', onClick: () => run() })
      const bar = dock({ actions: [btn] })
      let parts = []

      function current() {
        return planParts(mode, total, { text: text.value, every: everyN.valueAsNumber, points: grid.selected().map((x) => grid.items.indexOf(x) + 1) })
      }
      function refresh() {
        for (const [k, el] of Object.entries(fields)) el.hidden = k !== mode
        grid.interactive = mode === 'points'
        grid.ul.style.cursor = mode === 'points' ? '' : 'default'
        try {
          parts = current()
          clear(errBox)
        } catch (e) { parts = []; errBox.replaceChildren(h('small', { class: 'field-hint', style: 'color:var(--danger)' }, e.message)) }
        const tintOf = new Map()
        parts.forEach((p, i) => { for (const pg of p.pages) if (!tintOf.has(pg)) tintOf.set(pg, i) })
        grid.items.forEach((it, i) => { const t = tintOf.get(i + 1); it.tint = t === undefined ? null : tint(t); it.sub = t === undefined ? '' : `P${t + 1}` })
        grid.refresh()
        partsBox.replaceChildren(...parts.slice(0, 40).map((p, i) => h('span', { class: 'pe-part', style: { '--tint': tint(i) } }, h('i'), h('b', `${i + 1}`), `p. ${p.label}`)), parts.length > 40 ? h('span', { class: 'small muted' }, `+${parts.length - 40} more`) : '')
        btn.disabled = !parts.length
        btn.querySelector('span').textContent = parts.length > 1 ? `Split into ${parts.length} files` : 'Split PDF'
        bar.text(parts.length ? h('span', 'This will create ', h('b', plural(parts.length, 'file')), '.') : mode === 'points' ? 'Click the page after which you want to cut.' : mode === 'ranges' ? 'Type the pages for each file.' : 'Nothing to split.')
      }
      const clear = (el) => el.replaceChildren()

      async function run() {
        const plan = parts
        await busy(btn, async () => {
          const doc = await src.edit()
          const files = []
          for (let i = 0; i < plan.length; i++) {
            prog.set(i / plan.length, `Creating file ${i + 1} of ${plan.length}`)
            const out = await buildPages(doc, plan[i].pages.map((p) => ({ index: p - 1 })))
            files.push({ name: suffixName(src.name, `pages-${plan[i].label.replace(/,/g, '_')}`, 'pdf'), data: await savePdf(out), pages: plan[i].pages.length })
          }
          if (files.length === 1) {
            await showResult(result, { blob: files[0].data, name: files[0].name, title: 'Split ready', lead: `Pages ${formatRanges(plan[0].pages)}.`, facts: [{ label: 'Pages', value: files[0].pages }, { label: 'File size', value: formatBytes(files[0].data.size) }], again: ws.reset })
            return
          }
          prog.set(null, 'Zipping')
          const blob = await zip(files.map((f) => ({ name: f.name, data: f.data })))
          const list = h('ul', { class: 'pe-files' }, files.map((f) => h('li', h('span', { class: 'n', title: f.name }, f.name), h('span', { class: 's' }, `${plural(f.pages, 'page')} · ${formatBytes(f.data.size)}`),
            button('', { icon: 'download', variant: 'ghost', size: 'sm', ariaLabel: `Download ${f.name}`, onClick: () => download(f.data, f.name) }))))
          await showResult(result, {
            blob, name: `${baseName(src.name)}-split.zip`, title: `${plural(files.length, 'file')} created`, lead: 'Download them all as a ZIP, or grab single files below.',
            facts: [{ label: 'Files', value: files.length }, { label: 'Pages', value: total }, { label: 'ZIP size', value: formatBytes(blob.size) }], extra: list, again: ws.reset,
          })
        }, { label: 'Splitting', errorTo: result, progress: prog })
      }

      refresh()
      return [
        h('div', { class: 'tool-split wide-right' },
          h('section', { class: 'panel stack' }, h('h2', 'How to split'), modes, ...Object.values(fields), errBox, h('div', { class: 'pe-sub-h' }, 'Result'), partsBox),
          h('div', { class: 'stack' }, grid.el)),
        prog.el, result, bar]
    },
  })
}
