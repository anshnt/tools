// The formatting toolbar and the contextual strips for tables and images.
import { h } from '../../lib/ui.js'
import { schema, FONTS, FONT_SIZES } from './_schema.js'
import * as cmd from './_cmd.js'
import { canUndo, canRedo, undoCmd, redoCmd } from './_editor.js'
import { tbtn, sep, group, menuItem, palette, gridPicker, TEXT_COLORS, HIGHLIGHTS } from './_ui.js'

const M = schema.marks
const N = schema.nodes
const STYLES = [['p', 'Normal text'], ['title', 'Title'], ['subtitle', 'Subtitle'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['h4', 'Heading 4'], ['h5', 'Heading 5'], ['h6', 'Heading 6'], ['quote', 'Quote'], ['code', 'Code block']]
const fmtSize = (n) => String(Math.round(n * 2) / 2)

function select(options, onChange, label, cls = '') {
  const el = h('select', { class: ['dc-select', cls], 'aria-label': label, onchange: (e) => onChange(e.target.value) },
    options.map(([v, l]) => h('option', { value: v }, l)))
  return el
}

/** createToolbar(app) -> {tools, ctx, update(state)}. app: {run(cmd), pop, settings(), prefs, openLink(), pickImage(), imageFromUrl()} */
export function createToolbar(app) {
  const run = (c) => app.run(c)
  const mark = (type) => cmd.toggleMark(type)

  // ---------- history ----------
  const undo = tbtn('undo-2', { tip: 'Undo (Ctrl+Z)', onClick: () => run(undoCmd) })
  const redo = tbtn('redo-2', { tip: 'Redo (Ctrl+Y)', onClick: () => run(redoCmd) })

  // ---------- text ----------
  const style = select(STYLES, (v) => run(cmd.setBlockStyle(v)), 'Paragraph style', 'dc-style')
  const font = select(FONTS.map(([n]) => [n, n]), (v) => run(cmd.setMark(M.fontFamily, v === app.settings().font ? null : { family: v })), 'Font')
  const size = h('input', {
    class: 'dc-size', type: 'text', inputmode: 'decimal', list: 'dc-sizes', 'aria-label': 'Font size', title: 'Font size',
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); applySize() } },
    onchange: () => applySize(),
  })
  const sizes = h('datalist', { id: 'dc-sizes' }, FONT_SIZES.map((s) => h('option', { value: s })))
  const applySize = () => {
    const v = parseFloat(size.value)
    if (!(v >= 1 && v <= 400)) return
    run(cmd.setMark(M.fontSize, v === app.settings().fontSize ? null : { size: Math.round(v * 2) / 2 }))
  }
  const smaller = tbtn('minus', { tip: 'Smaller text (Ctrl+Shift+,)', onClick: () => run(cmd.stepFontSize(-1)) })
  const bigger = tbtn('plus', { tip: 'Bigger text (Ctrl+Shift+.)', onClick: () => run(cmd.stepFontSize(1)) })
  smaller.style.minWidth = bigger.style.minWidth = '26px'

  const bold = tbtn('bold', { tip: 'Bold (Ctrl+B)', onClick: () => run(mark(M.strong)) })
  const italic = tbtn('italic', { tip: 'Italic (Ctrl+I)', onClick: () => run(mark(M.em)) })
  const underline = tbtn('underline', { tip: 'Underline (Ctrl+U)', onClick: () => run(mark(M.underline)) })
  const strike = tbtn('strikethrough', { tip: 'Strikethrough (Ctrl+Shift+X)', onClick: () => run(mark(M.strike)) })
  const sup = tbtn('superscript', { tip: 'Superscript (Ctrl+Shift+=)', onClick: () => run(mark(M.sup)) })
  const sub = tbtn('subscript', { tip: 'Subscript (Ctrl+=)', onClick: () => run(mark(M.sub)) })
  const clear = tbtn('remove-formatting', { tip: 'Clear formatting (Ctrl+\\)', onClick: () => run(cmd.clearFormatting) })

  const colorBtn = tbtn('baseline', { tip: 'Text colour', onClick: () => openColor() })
  colorBtn.append(h('i', { class: 'bar' }))
  const hlBtn = tbtn('highlighter', { tip: 'Highlight colour', onClick: () => openHighlight() })
  hlBtn.append(h('i', { class: 'bar' }))

  function remember(c) {
    const recent = [c, ...(app.prefs.get().recent || []).filter((x) => x !== c)].slice(0, 10)
    app.prefs.update((p) => ({ ...p, recent }))
  }
  function openColor() {
    const pick = (c) => {
      app.pop.close()
      if (c) remember(c)
      run(cmd.setMark(M.color, c && c !== '#000000' ? { color: c } : null))
    }
    app.pop.open(colorBtn, palette({ title: 'Text colour', rows: TEXT_COLORS, noneLabel: 'Automatic (black)', onPick: pick, recent: app.prefs.get().recent || [] }))
  }
  function openHighlight() {
    const pick = (c) => { app.pop.close(); run(cmd.setMark(M.highlight, c ? { color: c } : null)) }
    app.pop.open(hlBtn, palette({ title: 'Highlight', colors: HIGHLIGHTS, noneLabel: 'No highlight', onPick: pick }))
  }

  // ---------- paragraph ----------
  const aligns = [['left', 'align-left', 'Align left (Ctrl+L)'], ['center', 'align-center', 'Centre (Ctrl+E)'], ['right', 'align-right', 'Align right (Ctrl+R)'], ['justify', 'align-justify', 'Justify (Ctrl+J)']]
    .map(([v, ic, tip]) => Object.assign(tbtn(ic, { tip, onClick: () => run(cmd.setBlockAttr('align', v === 'left' ? null : v)) }), { _v: v }))
  const spacingBtn = tbtn('align-vertical-justify-start', { tip: 'Line spacing', onClick: () => openSpacing() })
  function openSpacing() {
    const mk = (v, label) => h('button', { type: 'button', class: 'dc-item', onclick: () => { app.pop.close(); run(cmd.setBlockAttr('lineHeight', v)) } }, h('span', { class: 'dc-item-text' }, label))
    app.pop.open(spacingBtn, h('div', [mk(null, 'Default'), mk(1, 'Single (1.0)'), mk(1.15, '1.15'), mk(1.5, '1.5'), mk(2, 'Double (2.0)'), mk(2.5, '2.5')]))
  }
  const ul = tbtn('list', { tip: 'Bullet list (Ctrl+Shift+8)', onClick: () => run(cmd.toggleList(N.bullet_list)) })
  const ol = tbtn('list-ordered', { tip: 'Numbered list (Ctrl+Shift+7)', onClick: () => run(cmd.toggleList(N.ordered_list)) })
  const tl = tbtn('list-checks', { tip: 'Checklist (Ctrl+Shift+9)', onClick: () => run(cmd.toggleList(N.task_list)) })
  const outdent = tbtn('indent-decrease', { tip: 'Decrease indent (Ctrl+[)', onClick: () => run(cmd.changeIndent(-1)) })
  const indent = tbtn('indent-increase', { tip: 'Increase indent (Ctrl+])', onClick: () => run(cmd.changeIndent(1)) })

  // ---------- insert ----------
  const link = tbtn('link', { tip: 'Link (Ctrl+K)', onClick: () => app.openLink() })
  const imageBtn = tbtn('image', { tip: 'Insert image', onClick: () => openImageMenu() })
  function openImageMenu() {
    app.pop.open(imageBtn, h('div', { style: 'min-width:230px' },
      menuItem('upload', 'Upload from device', 'JPG, PNG, GIF, WebP, SVG. You can also paste or drop.', () => { app.pop.close(); app.pickImage() }),
      menuItem('link-2', 'From a web address', 'Stays linked, needs internet', () => { app.pop.close(); app.imageFromUrl() })))
  }
  const tableBtn = tbtn('table', { tip: 'Insert table', onClick: () => app.pop.open(tableBtn, gridPicker((r, c) => { app.pop.close(); if (!run(cmd.insertTable(r, c))) app.toast('Tables cannot be placed inside tables.', 'error') })) })
  const hr = tbtn('minus', { tip: 'Horizontal line', onClick: () => run(cmd.insertHR) })
  const pageBreak = tbtn('separator-horizontal', { tip: 'Page break (Ctrl+Enter)', onClick: () => run(cmd.insertPageBreak) })

  const tools = h('div', { class: 'dc-tools', role: 'toolbar', 'aria-label': 'Formatting' },
    group('history', undo, redo), sep(),
    group('style', style, font), group('size', smaller, size, bigger, sizes), sep(),
    group('format', bold, italic, underline, strike, sup, sub, clear), sep(),
    group('color', colorBtn, hlBtn),
    h('span', { class: 'dc-break' }),
    group('align', ...aligns, spacingBtn), sep(),
    group('list', ul, ol, tl, outdent, indent), sep(),
    group('insert', link, imageBtn, tableBtn, hr, pageBreak))

  // ---------- contextual strips ----------
  const T = cmd.tableCmd
  const tcmd = (c) => () => run(c)
  const shade = tbtn('paint-bucket', { tip: 'Cell shading', cls: 'txt', label: 'Shade', onClick: () => app.pop.open(shade, palette({
    title: 'Cell shading', colors: ['#f1f1f6', '#fff3b0', '#d4f5dd', '#d0e8ff', '#fde0e0', '#e8dcff', '#ffe5cc', '#ffffff'], noneLabel: 'No shading',
    onPick: (c) => { app.pop.close(); run(cmd.setCellBackground(c)) },
  })) })
  const tableStrip = h('div', { class: 'dc-group', style: 'display:contents', 'data-strip': 'table' },
    h('span', { class: 'dc-ctx-title' }, 'Table'),
    tbtn('between-horizontal-start', { tip: 'Insert row above', label: 'Row above', cls: 'txt', onClick: tcmd(T.addRowBefore) }),
    tbtn('between-horizontal-end', { tip: 'Insert row below', label: 'Row below', cls: 'txt', onClick: tcmd(T.addRowAfter) }),
    tbtn('between-vertical-start', { tip: 'Insert column left', label: 'Column left', cls: 'txt', onClick: tcmd(T.addColBefore) }),
    tbtn('between-vertical-end', { tip: 'Insert column right', label: 'Column right', cls: 'txt', onClick: tcmd(T.addColAfter) }),
    sep(),
    tbtn('trash-2', { tip: 'Delete row', label: 'Row', cls: 'txt', onClick: tcmd(T.deleteRow) }),
    tbtn('trash-2', { tip: 'Delete column', label: 'Column', cls: 'txt', onClick: tcmd(T.deleteCol) }),
    sep(),
    tbtn('table-cells-merge', { tip: 'Merge selected cells', label: 'Merge', cls: 'txt', onClick: tcmd(T.merge) }),
    tbtn('table-cells-split', { tip: 'Split cell', label: 'Split', cls: 'txt', onClick: tcmd(T.split) }),
    tbtn('heading', { tip: 'Toggle header row', label: 'Header row', cls: 'txt', onClick: tcmd(T.toggleHeaderRow) }),
    shade, sep(),
    tbtn('trash-2', { tip: 'Delete table', label: 'Delete table', cls: 'txt', onClick: tcmd(T.deleteTable) }))

  const width = h('input', { type: 'number', min: 24, max: 2000, 'aria-label': 'Image width in pixels', style: 'width:76px', onchange: () => {
    const sel = cmd.selectedImage(app.state())
    const w = Math.round(+width.value)
    if (!sel || !(w >= 24)) return
    const { width: ow, height: oh } = sel.node.attrs
    run(cmd.setImageAttrs({ width: w, height: ow && oh ? Math.round((w * oh) / ow) : null }))
  } })
  const alt = h('input', { type: 'text', placeholder: 'Alt text (describe the image)', 'aria-label': 'Alt text', style: 'width:min(230px,50vw)', onchange: () => run(cmd.setImageAttrs({ alt: alt.value || null })) })
  const imageStrip = h('div', { class: 'dc-group', style: 'display:contents', 'data-strip': 'image' },
    h('span', { class: 'dc-ctx-title' }, 'Image'),
    h('label', { style: 'display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text-2)' }, 'Width', width, 'px'),
    tbtn('maximize', { tip: 'Fit to page width', label: 'Fit width', cls: 'txt', onClick: () => {
      const sel = cmd.selectedImage(app.state())
      if (!sel) return
      const { width: ow, height: oh } = sel.node.attrs
      const w = Math.round(app.contentWidth())
      run(cmd.setImageAttrs({ width: w, height: ow && oh ? Math.round((w * oh) / ow) : null }))
    } }),
    alt, sep(),
    ...[['left', 'align-left'], ['center', 'align-center'], ['right', 'align-right']].map(([v, ic]) => tbtn(ic, { tip: `Place ${v}`, onClick: () => run(cmd.setBlockAttr('align', v === 'left' ? null : v)) })),
    sep(),
    tbtn('trash-2', { tip: 'Remove image', label: 'Remove', cls: 'txt', onClick: () => run((st, d) => { if (d) d(st.tr.deleteSelection().scrollIntoView()); return true }) }))

  const ctxEl = h('div', { class: 'dc-ctx', hidden: true, role: 'toolbar', 'aria-label': 'Object tools' }, tableStrip, imageStrip)

  // ---------- state sync ----------
  function update(st) {
    const s = app.settings()
    undo.disabled = !canUndo(st)
    redo.disabled = !canRedo(st)
    const bs = cmd.blockStyle(st)
    style.value = STYLES.some(([v]) => v === bs) ? bs : 'p'
    const fam = cmd.markIn(st, M.fontFamily)?.attrs.family || s.font
    if (![...font.options].some((o) => o.value === fam)) font.append(h('option', { value: fam }, fam))
    font.value = fam
    if (document.activeElement !== size) size.value = fmtSize(cmd.fontSizeAt(st, s.fontSize))
    bold.setPressed(cmd.markActive(st, M.strong))
    italic.setPressed(cmd.markActive(st, M.em))
    underline.setPressed(cmd.markActive(st, M.underline))
    strike.setPressed(cmd.markActive(st, M.strike))
    sup.setPressed(cmd.markActive(st, M.sup))
    sub.setPressed(cmd.markActive(st, M.sub))
    colorBtn.style.setProperty('--bar', cmd.markIn(st, M.color)?.attrs.color || '#1a1a1f')
    hlBtn.style.setProperty('--bar', cmd.markIn(st, M.highlight)?.attrs.color || 'transparent')
    const al = cmd.blockAttr(st, 'align') || 'left'
    for (const b of aligns) b.setPressed(b._v === al)
    ul.setPressed(cmd.listActive(st, N.bullet_list))
    ol.setPressed(cmd.listActive(st, N.ordered_list))
    tl.setPressed(cmd.listActive(st, N.task_list))
    link.setPressed(!!cmd.linkAt(st))
    const inTable = cmd.inTable(st)
    const img = cmd.selectedImage(st)
    tableStrip.hidden = !inTable || !!img
    imageStrip.hidden = !img
    ctxEl.hidden = !(inTable || img)
    if (img) {
      if (document.activeElement !== width) width.value = img.node.attrs.width || ''
      if (document.activeElement !== alt) alt.value = img.node.attrs.alt || ''
    }
  }

  return { tools, ctx: ctxEl, update, openColor, openHighlight }
}
