// Diff checker: compare two texts or files by line, word or character, side by side or unified, with a copyable patch.
import { editor, samples, seg, toggle, button, aurora, h, icon, statTiles, chip, focusOnDesktop, injectStyles, copyBtn, spacer } from './_shared.js'
import { diffLineRows, sideBySide, unified, inlineDiff, makePatch } from './_diffview.js'
import { diff as loadDiff } from '../../lib/libs.js'
import { download, debounce, toast, formatNumber } from '../../lib/ui.js'

const V1 = `function total(items, taxRate) {\n  let sum = 0;\n  for (const item of items) {\n    sum += item.price * item.qty;\n  }\n  const tax = sum * taxRate;\n  return sum + tax;\n}\n\nexport { total };\n`
const V2 = `// Sum the line items, then add tax.\nfunction total(items, taxRate = 0.18) {\n  const sum = items.reduce((acc, item) => acc + item.price * item.qty, 0);\n  const tax = sum * taxRate;\n  return Math.round((sum + tax) * 100) / 100;\n}\n\nexport { total };\n`
const C1 = `server:\n  host: localhost\n  port: 8080\n  tls: false\nlogging:\n  level: info\n  file: /var/log/app.log\nfeatures:\n  - search\n  - export\n`
const C2 = `server:\n  host: 0.0.0.0\n  port: 8443\n  tls: true\nlogging:\n  level: debug\n  file: /var/log/app.log\nfeatures:\n  - search\n  - export\n  - dark-mode\n`
const P1 = `The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump!`
const P2 = `The quick brown fox leaps over the lazy dogs. Pack my box with five dozen liquor jugs! How vexingly quick daft zebras jump.`

export function mount(root) {
  injectStyles()
  const state = { mode: 'lines', view: matchMedia('(max-width: 760px)').matches ? 'uni' : 'sbs', ws: false, case: false, all: false }
  let seq = 0, last = null
  const resultHost = h('div')
  const statHost = h('div')

  const left = editor({ title: 'Original', ic: 'file-minus', placeholder: 'Paste the original text here, or open a file...', onInput: () => { sampleRow.hidden = !!(left.value || right.value); schedule() }, onRun: () => compute(), actions: ['upload', 'paste', 'clear'] })
  const right = editor({ title: 'Changed', ic: 'file-plus', placeholder: 'Paste the changed text here, or open a file...', onInput: () => { sampleRow.hidden = !!(left.value || right.value); schedule() }, onRun: () => compute(), actions: ['upload', 'paste', 'clear'] })
  for (const e of [left, right]) e.el.style.setProperty('--df-h', 'clamp(190px, 30vh, 320px)')
  const schedule = debounce(() => compute(), 220)
  const rerun = () => compute()

  const modeSeg = seg([['lines', 'Lines'], ['words', 'Words'], ['chars', 'Characters']], 'lines', (v) => { state.mode = v; viewOpt.hidden = v !== 'lines'; rerun() }, 'Compare by')
  const viewSeg = seg([['sbs', 'Side by side'], ['uni', 'Unified']], state.view, (v) => { state.view = v; rerun() }, 'View')
  const viewOpt = h('div', { class: 'df-opt' }, h('span', { class: 'df-ol' }, 'View'), viewSeg)
  const swap = button('Swap', { icon: 'arrow-left-right', size: 'sm', title: 'Swap the two sides', ariaLabel: 'Swap the two sides', onClick: () => { const a = left.value; left.set(right.value); right.set(a); sampleRow.hidden = !!(left.value || right.value); compute() } })
  const bar = h('div', { class: ['df-bar', 'df-sticky'] },
    h('div', { class: 'df-opt' }, h('span', { class: 'df-ol' }, 'Compare'), modeSeg), viewOpt,
    toggle('Ignore whitespace', false, (v) => { state.ws = v; rerun() }), toggle('Ignore case', false, (v) => { state.case = v; rerun() }),
    toggle('Show unchanged lines', false, (v) => { state.all = v; rerun() }), spacer(), swap)
  const sampleRow = samples([
    { label: 'Code change', icon: 'file-code-2', a: V1, b: V2 }, { label: 'Config files', icon: 'file-cog', a: C1, b: C2 }, { label: 'Prose edit', icon: 'file-text', a: P1, b: P2, mode: 'words' },
  ], (smp) => {
    left.set(smp.a); right.set(smp.b); sampleRow.hidden = true
    const m = smp.mode || 'lines'
    state.mode = m; modeSeg.set(m); viewOpt.hidden = m !== 'lines'
    compute()
  })

  function frame(title, headExtra, body) {
    return h('section', { class: 'df-frame', 'aria-label': title },
      h('div', { class: 'df-head' }, h('div', { class: 'df-title' }, icon('git-compare'), h('span', title), headExtra.chip), h('div', { class: 'df-actions' }, headExtra.actions || null)), body)
  }
  async function compute() {
    const my = ++seq
    const a = left.value, b = right.value
    if (!a && !b) { last = null; resultHost.replaceChildren(); statHost.replaceChildren(); return }
    try {
      if (state.mode === 'lines') {
        const res = await diffLineRows(a, b, { ignoreWhitespace: state.ws, ignoreCase: state.case })
        if (my !== seq) return
        const st = res.stats
        last = { a, b, D: res.D }
        const nameA = left.fileName || 'original.txt', nameB = right.fileName || 'changed.txt'
        const patch = () => makePatch(res.D, a, b, nameA, nameB, { ignoreWhitespace: state.ws, ignoreCase: state.case })
        const actions = [
          copyBtn(() => patch(), 'Copy patch', { ariaLabel: 'Copy as a unified patch' }),
          button('Download', { variant: 'ghost', size: 'sm', icon: 'download', ariaLabel: 'Download the patch', onClick: () => download(patch(), 'changes.patch', 'text/x-diff') }),
        ]
        if (st.identical) {
          resultHost.replaceChildren(h('div', { class: 'df-verdict ok' }, h('div', { class: 'df-vi' }, icon('check')), h('div', h('h3', 'No differences'), h('p', `Both texts are the same${state.ws || state.case ? ' (after ignoring' + [state.ws && ' whitespace', state.case && ' case'].filter(Boolean).join(' and') + ')' : ''}. ${formatNumber(st.total, 0)} line${st.total === 1 ? '' : 's'} compared.`))))
        } else {
          const body = h('div', { class: 'df-sbs-wrap' }, (state.view === 'sbs' ? sideBySide : unified)(res, { ignoreWhitespace: state.ws, ignoreCase: state.case, expandAll: state.all }))
          const note = res.approximate ? h('div', { class: 'df-note', style: 'padding:10px 14px' }, h('div', { class: 'alert warn' }, icon('triangle-alert'), h('div', 'These texts differ too much to align exactly in the browser, so lines are compared position by position.'))) : null
          resultHost.replaceChildren(frame('Differences', { chip: chip('warn', `${formatNumber(st.added + st.removed + st.changed, 0)} changed`), actions }, h('div', null, note, body)))
        }
        statHost.replaceChildren(statTiles([
          { label: 'Added lines', value: st.added + st.changed, accent: true, hint: st.changed ? `${st.changed} modified` : '' }, { label: 'Removed lines', value: st.removed + st.changed },
          { label: 'Unchanged', value: st.same }, { label: 'Similarity', value: `${st.similarity}%` },
        ]))
      } else {
        const D = await loadDiff()
        const opts = { ignoreCase: state.case, timeout: 8000 }
        const parts = state.mode === 'words' ? (state.ws ? D.diffWords : D.diffWordsWithSpace)(a, b, opts) : D.diffChars(a, b, { ...opts, ignoreWhitespace: state.ws })
        if (my !== seq) return
        if (!parts) { resultHost.replaceChildren(h('div', { class: 'alert warn' }, icon('triangle-alert'), h('div', 'These texts are too different to compare word by word. Compare by lines instead, or use shorter texts.'))); statHost.replaceChildren(); return }
        let add = 0, rem = 0, same = 0
        for (const p of parts) { const n = state.mode === 'words' ? (p.value.match(/\S+/g) || []).length : p.value.length; if (p.added) add += n; else if (p.removed) rem += n; else same += n }
        const unit = state.mode === 'words' ? 'words' : 'characters'
        if (!add && !rem) resultHost.replaceChildren(h('div', { class: 'df-verdict ok' }, h('div', { class: 'df-vi' }, icon('check')), h('div', h('h3', 'No differences'), h('p', 'Both texts are the same.'))))
        else resultHost.replaceChildren(frame('Differences', { chip: chip('warn', `${formatNumber(add + rem, 0)} ${unit} changed`) }, inlineDiff(parts)))
        statHost.replaceChildren(statTiles([{ label: `Added ${unit}`, value: add, accent: true }, { label: `Removed ${unit}`, value: rem }, { label: 'Unchanged', value: same }, { label: 'Similarity', value: `${add + rem + same ? Math.round((same / (same + Math.max(add, rem))) * 100) : 100}%` }]))
      }
    } catch (e) {
      if (my !== seq) return
      console.error(e)
      toast(e.message || 'Could not compare these texts.', 'error')
    }
  }

  root.append(h('div', { class: 't-df' }, aurora(), bar, sampleRow, h('div', { class: 'df-grid' }, left.el, right.el), statHost, resultHost))
  focusOnDesktop(left)
}
