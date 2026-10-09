// Dialogs for Vector Studio: export, new document and keyboard shortcuts.
import { h, modal, button, busy, segmented, toggle, input, field, download, copyText, select, number, alert, formatBytes } from '../../lib/ui.js'
import { safeName } from '../../lib/files.js'
import { exportSvg } from './_svg.js'
import { exportPng, exportPdf } from './_io.js'
import { newDoc } from './_model.js'
import { PRESETS } from './_panels.js'

export function exportDialog(ed, baseName = 'vector-art') {
  const { ab } = ed.doc
  let fmt = 'svg', scale = 2
  const name = input({ value: safeName(baseName), 'aria-label': 'File name' })
  const transp = toggle('Transparent background', ab.transparent)
  const fmtSeg = segmented([['svg', 'SVG'], ['png', 'PNG'], ['pdf', 'PDF']], fmt, (v) => { fmt = v; info() }, 'File format')
  const scaleSeg = segmented([[1, '1x'], [2, '2x'], [3, '3x'], [4, '4x']], scale, (v) => { scale = +v; info() }, 'PNG scale')
  const scaleField = field('Scale (PNG)', scaleSeg)
  const note = h('p', { class: 'vs-hint' })
  const result = h('div')
  function info() {
    scaleField.hidden = fmt !== 'png'
    note.textContent = fmt === 'svg' ? `Clean, standalone SVG, ${ab.w} x ${ab.h} px. Opens in any browser, editor or design tool.`
      : fmt === 'png' ? `PNG at ${Math.round(ab.w * scale)} x ${Math.round(ab.h * scale)} px.`
        : `Vector PDF, one page of ${ab.w} x ${ab.h} px (${Math.round(ab.w * 0.75)} x ${Math.round(ab.h * 0.75)} pt). Text uses the standard PDF fonts closest to your choice.`
  }
  const go = button('Export', { icon: 'download', variant: 'primary' })
  const copy = button('Copy SVG code', { icon: 'copy', variant: 'secondary', onClick: () => copyText(exportSvg(ed.doc, { transparent: transp.input.checked })) })
  go.addEventListener('click', () => busy(go, async () => {
    const fn = safeName(name.value) || 'vector-art', doc = ed.doc, t = transp.input.checked
    let blob, file
    if (fmt === 'svg') { blob = new Blob([exportSvg(doc, { transparent: t })], { type: 'image/svg+xml' }); file = `${fn}.svg` }
    else if (fmt === 'png') { blob = await exportPng(doc, scale, t); file = `${fn}.png` }
    else { blob = await exportPdf(doc, t); file = `${fn}.pdf` }
    download(blob, file)
    result.replaceChildren(alert('success', h('strong', 'Exported '), `${file} (${formatBytes(blob.size)})`))
  }, { label: 'Exporting', errorTo: result }))
  info()
  modal({ title: 'Export', icon: 'download', body: h('div', { class: 'vs-dlg' }, field('File name', name), field('Format', fmtSeg), scaleField, transp, note, result), actions: [copy, go] })
}

export function newDialog(ed, onCreate) {
  let w = ed.doc.ab.w, ht = ed.doc.ab.h
  const key = () => (PRESETS.some(([, pw, ph]) => pw === w && ph === ht) ? `${w}x${ht}` : 'custom')
  const preset = select([['custom', 'Custom size'], ...PRESETS.map(([n, pw, ph]) => [`${pw}x${ph}`, n])], key(), (v) => {
    if (v !== 'custom') { [w, ht] = v.split('x').map(Number); W.value = w; H.value = ht }
  })
  const W = number(w, { min: 1, max: 20000, ariaLabel: 'Width', onInput: (v) => { if (v > 0) { w = v; preset.value = key() } } })
  const H = number(ht, { min: 1, max: 20000, ariaLabel: 'Height', onInput: (v) => { if (v > 0) { ht = v; preset.value = key() } } })
  const create = button('Create', { icon: 'file-plus', variant: 'primary', onClick: () => { m.close(); onCreate(newDoc(Math.round(w), Math.round(ht))) } })
  const m = modal({ title: 'New document', icon: 'file-plus', body: h('div', { class: 'vs-dlg' }, h('p', { class: 'vs-hint' }, 'Your current artwork stays one Undo away.'), field('Size', preset), h('div', { class: 'vs-row2' }, field('Width (px)', W), field('Height (px)', H))), actions: [create] })
}

const KEYS = [
  ['Tools', [['Selection', 'V'], ['Direct selection (edit points)', 'A'], ['Pen', 'P'], ['Pencil', 'N'], ['Rectangle', 'M'], ['Ellipse', 'L'], ['Polygon', 'G'], ['Star', 'S'], ['Line', '\\'], ['Text', 'T'], ['Eyedropper', 'I'], ['Hand (or hold Space)', 'H']]],
  ['Edit', [['Undo / Redo', 'Ctrl+Z / Ctrl+Shift+Z'], ['Copy, cut, paste', 'Ctrl+C / X / V'], ['Paste in place', 'Ctrl+Shift+V'], ['Duplicate', 'Ctrl+D'], ['Select all', 'Ctrl+A'], ['Delete', 'Delete'], ['Nudge (10 px with Shift)', 'Arrow keys'], ['Group / Ungroup', 'Ctrl+G / Ctrl+Shift+G'], ['Bring forward / back', 'Ctrl+] / Ctrl+['], ['Bring to front / back', 'Ctrl+Shift+] / ['], ['Swap fill and stroke', 'X'], ['Default colours', 'D']]],
  ['View and files', [['Zoom in / out', 'Ctrl++ / Ctrl+-'], ['Fit artboard', 'Ctrl+0'], ['Actual size', 'Ctrl+1'], ['Pan', 'Space + drag'], ['Show grid', "Ctrl+'"], ['Save project', 'Ctrl+S'], ['Export', 'Ctrl+E'], ['Open file', 'Ctrl+O']]],
  ['While drawing', [['Constrain angle or square', 'Shift'], ['Draw from centre', 'Alt'], ['Pen: close a path', 'Click the first point'], ['Pen: finish an open path', 'Enter or double-click'], ['Add or toggle a point (direct tool)', 'Double-click'], ['Copy while moving', 'Alt + drag'], ['Turn off snapping', 'Ctrl while dragging']]],
]
export function shortcutsDialog() {
  const body = h('div', { class: 'vs-keys' }, KEYS.flatMap(([t, rows]) => [h('h4', t), ...rows.flatMap(([a, k]) => [h('span', a), h('kbd', k)])]))
  modal({ title: 'Keyboard shortcuts', icon: 'keyboard', body })
}
