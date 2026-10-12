// Draw Studio dialogs, part two: Outline pen, Trace bitmap, Options, Document properties, Guide position, the shortcuts sheet with the command
// finder, About, notes on conversions, supported formats, the import page picker and the "Open or import?" prompt. Built with modal() from lib/ui.js;
// bodies are wrapped in div.t-ds-dlg. Everything shown comes from constants or the document through textContent (never innerHTML).
import { alert, button, errorMessage, field, h, isAbort, modal, rangeField, segmented, select, toast, toggle } from '../../lib/ui.js'
import { COMMANDS, shortcutRows } from './_ds-keys.js'
import { UNITS_LIST, defaultGrid, fmt, fromUnit, toUnit } from './_ds-units.js'
import { DASH_KINDS, PEN_WIDTHS, dashFor, dashKind } from './_ds-fill.js'
import { moveGuide } from './_ds-guides.js'
import { PREF_DEFAULTS } from './_ds-prefs.js'
import { UNITS, countNodes } from './_ds-doc.js'
import { leavesOf } from './_ds-ops.js'
import { editableIds } from './_ds-sel.js'

const dlg = (title, ic, body, actions, onClose) => modal({ title, icon: ic, body: h('div', { class: 't-ds-dlg' }, body), actions, onClose })
const HEX = /^#[0-9a-f]{6}$/
const cancelBtn = (close) => button('Cancel', { variant: 'secondary', onClick: () => close() })

/** env: {store, app (run, fx, guideDialog...), assets} -> the dialog openers */
export function createMoreDialogs({ store, app, assets }) {
  const units = () => store.root.units
  const numIn = (aria, attrs = {}) => h('input', { type: 'number', step: 'any', class: 'input', 'aria-label': aria, ...attrs })

  // ---------- Outline pen ----------
  function openOutlinePen() {
    const leaves = leavesOf(editableIds(store).map((id) => store.find(id)?.node).filter(Boolean)).filter((l) => l.t === 'path')
    if (!leaves.length) { store.setStatus('Select a shape first. Only drawn shapes have an outline.'); return null }
    const cur = leaves.find((l) => l.stroke && l.strokeWidth > 0) || leaves[0]
    const st = { none: !(cur.stroke && cur.strokeWidth > 0), width: cur.strokeWidth > 0 ? cur.strokeWidth : 0.75, color: HEX.test(cur.stroke || '') ? cur.stroke : '#000000', cap: cur.cap || 0, join: cur.join || 0, miter: cur.miter || 4, dash: dashKind(cur.dash, cur.strokeWidth) }
    const u = units()
    const width = numIn('Outline width', { min: 0, value: String(+toUnit(st.width, u).toFixed(3)) })
    const presets = select([['', 'Preset...'], ...PEN_WIDTHS.map((w) => [String(w), w === 0.1 ? 'Hairline (0.1 pt)' : `${w} pt`])], '', (v) => { if (v) { st.width = +v; width.value = String(+toUnit(st.width, u).toFixed(3)); st.none = false; none.input.checked = false } })
    presets.setAttribute('aria-label', 'Width preset')
    width.addEventListener('input', () => { const v = fromUnit(width.valueAsNumber, u); if (v >= 0) { st.width = v; if (v > 0) { st.none = false; none.input.checked = false } } })
    const color = h('input', { type: 'color', class: 'ds-colorin', value: st.color, 'aria-label': 'Outline colour', oninput: (e) => { if (HEX.test(e.target.value)) { st.color = e.target.value; st.none = false; none.input.checked = false } } })
    const none = toggle('No outline', st.none, (c) => { st.none = c })
    const dash = select([...DASH_KINDS, ...(st.dash === 'custom' ? [['custom', 'Keep the current pattern']] : [])], st.dash, (v) => { st.dash = v })
    dash.setAttribute('aria-label', 'Line style')
    const caps = segmented([[0, 'Butt'], [1, 'Round'], [2, 'Square']], st.cap, (v) => { st.cap = +v }, 'Line ends')
    const joins = segmented([[0, 'Miter'], [1, 'Round'], [2, 'Bevel']], st.join, (v) => { st.join = +v; miter.disabled = st.join !== 0 }, 'Corners')
    const miter = numIn('Miter limit', { min: 1, max: 100, value: String(st.miter), disabled: st.join !== 0 })
    miter.addEventListener('input', () => { const v = miter.valueAsNumber; if (v >= 1 && v <= 100) st.miter = v })
    let m
    const apply = () => {
      const patch = st.none ? { stroke: null, strokeWidth: 0 } : { stroke: st.color, strokeWidth: st.width > 0 ? st.width : 0.75, cap: st.cap, join: st.join, miter: st.miter, ...(st.dash === 'custom' ? {} : { dash: dashFor(st.dash, st.width), dashOffset: 0 }) }
      m.close()
      app.fx.outline(patch, 'Outline pen')
    }
    m = dlg('Outline pen', 'pen-line', [
      h('div', { class: 'ds-form-row' }, field(`Width (${u})`, width), field('Preset', presets)),
      h('div', { class: 'ds-form-row' }, field('Colour', color), none),
      h('div', { class: 'ds-form-row' }, field('Line style', dash), field('Miter limit', miter)),
      field('Line ends', caps), field('Corners', joins),
      h('p', { class: 'small muted' }, 'Changes apply to every shape in the selection.'),
    ], [cancelBtn(() => m.close()), button('Apply', { variant: 'primary', onClick: apply })])
    return m
  }

  // ---------- Trace bitmap ----------
  async function openTrace(presetId = 'logo') {
    const node = app.fx.imageTarget()
    if (!node) { store.setStatus('Select a bitmap first.'); return null }
    const { PRESETS } = await import('./_trace.js')
    const d = assets.dims(node.asset)
    const st = { preset: PRESETS[presetId] ? presetId : 'logo' }
    const P = () => PRESETS[st.preset]
    const hint = h('p', { class: 'small muted' })
    const colors = numIn('Number of colours', { min: 2, max: 64, step: 1 })
    const detail = rangeField('Detail', { min: 1, max: 10, step: 1, value: 6 }), smooth = rangeField('Smoothing', { min: 0, max: 5, step: 1, value: 1 })
    let removeBg = true
    const bg = toggle('Remove the background colour', true, (c) => { removeBg = c })
    const preset = select(Object.entries(PRESETS).map(([k, v]) => [k, v.label]), st.preset, (v) => { st.preset = v; sync() })
    preset.setAttribute('aria-label', 'Trace preset')
    function sync() {
      const p = P()
      hint.textContent = p.hint
      colors.value = String(p.colors); colors.disabled = !!p.bw
      detail.set(p.detail); smooth.set(p.smooth)
      removeBg = p.removeBg; bg.input.checked = p.removeBg
    }
    sync()
    const result = h('div', { class: 'ds-form' })
    let ctl = null, busy = false, goBtn, closeBtn, m
    async function go() {
      if (busy) return
      busy = true; goBtn.disabled = true; result.replaceChildren(h('p', { class: 'small muted' }, 'Tracing. This can take a few seconds for large pictures.'))
      ctl = new AbortController()
      try {
        const r = await app.fx.trace({ preset: st.preset, colors: Math.max(2, Math.min(64, Math.round(colors.valueAsNumber) || P().colors)), detail: detail.input.valueAsNumber, smooth: smooth.input.valueAsNumber, removeBg, signal: ctl.signal })
        if (!r.paths) { result.replaceChildren(alert('warn', 'Nothing could be traced from this picture with these settings. Try another preset or more colours.')); return }
        m.close()
        store.setStatus(`Traced into ${r.paths} shape${r.paths === 1 ? '' : 's'} with ${r.colors} colour${r.colors === 1 ? '' : 's'}. The bitmap is still underneath.`)
        toast(`Traced into ${r.paths} shape${r.paths === 1 ? '' : 's'}. The original bitmap is kept.`, 'success')
      } catch (e) {
        if (!isAbort(e)) { console.error(e); result.replaceChildren(alert('error', errorMessage(e))) }
      } finally { busy = false; goBtn.disabled = false; ctl = null }
    }
    closeBtn = button('Cancel', { variant: 'secondary', onClick: () => { ctl?.abort(); m.close() } })
    goBtn = button('Trace', { variant: 'primary', icon: 'wand-sparkles', onClick: go })
    m = dlg('Trace bitmap', 'wand-sparkles', [
      h('p', { class: 'small muted' }, `${node.name || 'Bitmap'}: ${d ? `${d.w} x ${d.h} pixels` : ''}. The traced shapes are placed just above it as one group and the bitmap stays where it is.`),
      field('Preset', preset), hint,
      h('div', { class: 'ds-form-row' }, field('Colours', colors), bg), detail, smooth, result,
    ], [closeBtn, goBtn], () => ctl?.abort())
    return m
  }

  // ---------- Options ----------
  function openOptions() {
    const P = store.prefs, u = units()
    const mm = (key, dflt, aria, min, max) => {
      const i = numIn(aria, { min, max, step: 'any', value: String(+(P[key] ?? dflt).toFixed(3)) })
      i.addEventListener('change', () => { const v = i.valueAsNumber; if (v >= min && v <= max) app.keepPref(key, v); else i.value = String(P[key] ?? dflt) })
      return i
    }
    const grid = numIn(`Grid spacing in ${u}`, { min: 0.01, step: 'any', value: String(+toUnit(P.gridStep || defaultGrid(u), u).toFixed(3)) })
    grid.addEventListener('change', () => { const v = fromUnit(grid.valueAsNumber, u); if (v >= 1 && v <= 5000) app.keepPref('gridStep', v); else grid.value = String(+toUnit(P.gridStep || defaultGrid(u), u).toFixed(3)) })
    const wheel = select([['zoom', 'Zoom'], ['scroll', 'Scroll']], P.wheel || 'zoom', (v) => app.keepPref('wheel', v))
    wheel.setAttribute('aria-label', 'Mouse wheel')
    const stroke = toggle('Scale outlines with objects', !!P.scaleStroke, (c) => app.keepPref('scaleStroke', c))
    let m
    const reset = () => { for (const k of ['nudge', 'dupOffset', 'gridStep', 'scaleStroke', 'wheel']) app.keepPref(k, PREF_DEFAULTS[k]); m.close(); toast('Options reset') }
    m = dlg('Options', 'settings', [
      h('div', { class: 'ds-form-row' }, field('Arrow key nudge (mm)', mm('nudge', PREF_DEFAULTS.nudge, 'Nudge in millimetres', 0.01, 100), 'Shift moves 10 times as far, Ctrl a tenth.'), field('Duplicate and paste offset (mm)', mm('dupOffset', PREF_DEFAULTS.dupOffset, 'Duplicate offset in millimetres', 0, 100))),
      h('div', { class: 'ds-form-row' }, field(`Grid spacing (${u})`, grid), field('Mouse wheel', wheel, 'Ctrl and wheel always zooms. Shift and wheel scrolls sideways.')),
      stroke,
      h('p', { class: 'small muted' }, 'Rulers, guides, the grid and snapping are in the View menu. These settings are remembered on this device.'),
    ], [button('Reset to defaults', { variant: 'secondary', onClick: reset }), button('Done', { variant: 'primary', onClick: () => m.close() })])
    return m
  }

  // ---------- Document properties ----------
  function openDocProps() {
    const r = store.root
    const title = h('input', { type: 'text', class: 'input', value: r.title, maxlength: 100, 'aria-label': 'Title' })
    const unit = select(UNITS_LIST, r.units, null)
    unit.setAttribute('aria-label', 'Units')
    const objects = r.pages.reduce((s, p) => s + p.layers.reduce((a, l) => a + countNodes(l.items), 0), 0)
    let m
    const apply = () => {
      const t = title.value.trim() || 'Untitled', un = UNITS.includes(unit.value) ? unit.value : r.units
      m.close()
      store.tx('Document properties', (root) => (root.title === t && root.units === un ? root : { ...root, title: t, units: un }))
    }
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply() } })
    m = dlg('Document properties', 'sliders-horizontal', [
      field('Title', title), field('Units', unit),
      h('p', { class: 'small muted' }, `${r.pages.length} page${r.pages.length === 1 ? '' : 's'}, ${objects.toLocaleString()} object${objects === 1 ? '' : 's'}, ${Object.keys(r.fonts).length} embedded font${Object.keys(r.fonts).length === 1 ? '' : 's'}.${r.meta?.name ? ` Opened from ${r.meta.name}.` : ''}`),
    ], [cancelBtn(() => m.close()), button('Apply', { variant: 'primary', onClick: apply })])
    title.focus(); title.select()
    return m
  }

  // ---------- Move to layer ----------
  function openMoveToLayer() {
    const layers = [...(store.page()?.layers || [])].reverse()
    if (!store.sel.ids.length || !layers.length) { store.setStatus('Select an object first.'); return null }
    const sel = select(layers.map((l) => [String(l.id), l.name]), String(layers[0].id), null)
    sel.setAttribute('aria-label', 'Layer')
    let m
    m = dlg('Move to layer', 'layers', [field('Layer', sel), h('p', { class: 'small muted' }, 'The selected objects go on top of that layer.')],
      [cancelBtn(() => m.close()), button('Move', { variant: 'primary', onClick: () => { const id = +sel.value; m.close(); app.run('object.moveToLayer', { layerId: id }) } })])
    sel.focus()
    return m
  }

  // ---------- Guide position ----------
  /** Edit the guide with this id, or add a new one on `axis` ('h' or 'v'). The number is measured like the rulers: X from the left, Y up from the bottom. */
  function openGuide(id, axis) {
    const page = store.page()
    if (!page || page.pending) return null
    const g = id != null ? (page.guides || []).find((x) => x.id === id) : null
    if (id != null && !g) return null
    const ax = g ? g.axis : axis === 'v' ? 'v' : 'h'
    const u = units()
    const toUi = (pos) => (ax === 'v' ? toUnit(pos, u) : toUnit(page.h - pos, u))
    const pos = numIn(`${ax === 'v' ? 'X' : 'Y'} position in ${u}`, { step: 'any', value: String(+toUi(g ? g.pos : ax === 'v' ? page.w / 2 : page.h / 2).toFixed(3)) })
    let m
    const apply = () => {
      const v = pos.valueAsNumber
      if (!Number.isFinite(v)) return
      const p = ax === 'v' ? fromUnit(v, u) : page.h - fromUnit(v, u)
      m.close()
      if (g) store.tx('Move guide', (r) => moveGuide(r, page.id, g.id, p)); else app.fx.addGuideAt(ax, p)
    }
    pos.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply() } })
    const actions = [cancelBtn(() => m.close())]
    if (g) actions.push(button('Delete guide', { variant: 'danger', onClick: () => { m.close(); store.guideSel = g.id; app.fx.deleteSelGuide() } }))
    actions.push(button(g ? 'Apply' : 'Add guide', { variant: 'primary', onClick: apply }))
    m = dlg(g ? 'Guide position' : ax === 'v' ? 'Add vertical guide' : 'Add horizontal guide', 'ruler', [
      field(`${ax === 'v' ? 'X, from the left edge of the page' : 'Y, up from the bottom edge of the page'} (${u})`, pos),
    ], actions)
    pos.focus(); pos.select()
    return m
  }

  // ---------- keyboard shortcuts and command finder ----------
  const labelOf = (c) => (c.path ? `${c.path.join(' > ')} > ` : '') + c.label.replace(/\.\.\.$/, '')
  function openFinder() {
    const input = h('input', { type: 'search', class: 'input', placeholder: 'Type to find a command...', 'aria-label': 'Find a command', autocomplete: 'off', spellcheck: 'false' })
    const list = h('div', { class: 'ds-finder', role: 'list', 'aria-label': 'Commands' })
    let m
    const row = (c, keys) => {
      const b = h('button', { type: 'button', class: 'ds-fr', 'data-cmd': c.id, onclick: () => { m.close(); setTimeout(() => app.run(c.id), 0) } },
        h('span', { class: 'ds-fr-l' }, labelOf(c), h('small', c.menu)), h('span', { class: 'ds-fr-k' }, keys.join('  or  ')))
      if (!app.enabled(c.id)) b.classList.add('ds-fr-off')
      return b
    }
    const MORE = 80
    function draw() {
      const q = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
      let rows
      if (!q.length) {
        rows = shortcutRows().map((r) => ({ c: COMMANDS.find((c) => c.id === r.id), keys: r.keys })).filter((r) => r.c)
      } else {
        rows = COMMANDS.filter((c) => { const hay = `${labelOf(c)} ${c.menu} ${c.id} ${(c.keys || []).join(' ')} ${c.hint || ''}`.toLowerCase(); return q.every((t) => hay.includes(t)) })
          .map((c) => ({ c, keys: c.keys?.length ? c.keys : c.hint ? [c.hint] : ['No shortcut'] }))
      }
      list.replaceChildren(...rows.slice(0, MORE).map((r) => row(r.c, r.keys)), ...(rows.length > MORE ? [h('p', { class: 'small muted' }, `${rows.length - MORE} more. Type more letters to narrow the list.`)] : []), ...(rows.length ? [] : [h('p', { class: 'small muted' }, 'No command matches.')]))
    }
    input.addEventListener('input', draw)
    m = dlg('Keyboard shortcuts and command finder', 'keyboard', [
      input, list,
      h('p', { class: 'small muted' }, 'Browsers keep Ctrl+N, Ctrl+T, Ctrl+W and Ctrl+Tab for themselves, so New is Alt+N. Click a row to run that command. Every command is also in the menus.'),
      h('dl', { class: 'ds-keys ds-mouse' }, ...[
        ['Click', 'Select an object'], ['Shift+click', 'Add to or remove from the selection'], ['Ctrl+click', 'Select inside a group'], ['Alt+click', 'Select the object behind'],
        ['Click a selected object again', 'Switch between scale and rotate handles'], ['Double-click', 'Edit text, enter a group, or edit nodes'], ['Alt+drag', 'Move without snapping'],
        ['Palette: left click, right click', 'Set the fill, set the outline'], ['Wheel, Ctrl+wheel', 'Zoom at the pointer'], ['Space+drag', 'Pan the view'],
      ].flatMap(([k, v]) => [h('dt', k), h('dd', v)])),
    ], [button('Close', { variant: 'secondary', onClick: () => m.close() })])
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); list.querySelector('.ds-fr')?.focus() } else if (e.key === 'Enter') { e.preventDefault(); list.querySelector('.ds-fr')?.click() }
    })
    list.addEventListener('keydown', (e) => {
      const rows = [...list.querySelectorAll('.ds-fr')], i = rows.indexOf(document.activeElement)
      if (e.key === 'ArrowDown') { e.preventDefault(); rows[Math.min(rows.length - 1, i + 1)]?.focus() } else if (e.key === 'ArrowUp') { e.preventDefault(); if (i <= 0) input.focus(); else rows[i - 1].focus() }
    })
    draw()
    input.focus()
    return m
  }

  // ---------- information ----------
  const info = (title, ic, nodes) => { const m = dlg(title, ic, nodes, [button('Close', { variant: 'primary', onClick: () => m.close() })]); return m }
  const para = (t) => h('p', t)
  const showAbout = () => info('About Draw Studio', 'vector-square', [
    para('Draw Studio opens CDR, AI, PDF, EPS, SVG and picture files, lets you edit them, and saves CDR or any of those formats.'),
    para('Everything happens in this browser tab. Your files are read on this device and are never uploaded.'),
    h('p', { class: 'small muted' }, 'Press F1 for the keyboard shortcuts and the command finder. Help > Notes on conversions says what is approximated.'),
  ])
  const showConversions = () => info('Notes on conversions', 'info', [
    h('ul', { class: 'ds-list' },
      h('li', 'Reading: CDR 7 to X3 and the ZIP containers of X4 and newer are read from public format notes. Effects such as blends, extrusions, envelopes, lenses and shadows are not shown, and master pages are skipped.'),
      h('li', 'Writing CDR: the file is built from public format notes and has not been opened in the desktop application from here. Layers, groups, gradients and pictures are kept, some details are approximated, and the notes of each save list them. Keep a PDF or SVG copy when it matters.'),
      h('li', 'Text: PDF text keeps its exact letter shapes until you edit it. Typed text uses a similar free font unless you add a font file. Curves exports outline text, except scripts the outline fonts lack, which stay as text with a note.'),
      h('li', 'Colours are RGB. CMYK is a convenient way to type a colour, with no colour profile.'),
      h('li', 'Not supported: per-letter styling, paragraph text, bitmap and pattern fills, editing inside a clipping container in place.'))])
  const showFormats = () => info('Supported formats', 'files', [
    h('dl', { class: 'ds-keys' }, ...[
      ['Open', 'CDR (7 to X3 and ZIP-based), CDT, AI (PDF-based and older PostScript-based), PDF, EPS, PS, SVG, SVGZ, PNG, JPG, WebP, GIF, BMP, HEIC'],
      ['Save and export', 'CDR, AI, PDF, EPS, SVG, PNG, JPG'],
      ['Import', 'Any of the open formats, placed as a group on the current page'],
    ].flatMap(([k, v]) => [h('dt', k), h('dd', v)])),
  ])

  // ---------- import page picker and the open-or-import prompt ----------
  /** Ask which page of a multi-page file to import. pages: [{name, w, h}]. Resolves the index, or null for Cancel. */
  function pickPage(fileName, pages) {
    return new Promise((resolve) => {
      let done = false
      const finish = (v) => { if (done) return; done = true; resolve(v); m.close() }
      const sel = h('select', { class: 'select', 'aria-label': 'Page to import' }, pages.map((p, i) => h('option', { value: String(i) }, `${i + 1}. ${p.name || `Page ${i + 1}`}  (${fmt(p.w, units())} x ${fmt(p.h, units())} ${units()})`)))
      const m = dlg('Which page do you want?', 'files', [h('p', `${fileName} has ${pages.length} pages. One page is placed on the current page as a group.`), field('Page', sel)],
        [button('Cancel', { variant: 'secondary', onClick: () => finish(null) }), button('Import', { variant: 'primary', onClick: () => finish(+sel.value) })], () => { if (!done) { done = true; resolve(null) } })
      sel.focus()
    })
  }
  /** Files were dropped onto a drawing that has content. Resolves 'open', 'import' or null (Cancel). */
  function openOrImport(files) {
    return new Promise((resolve) => {
      let done = false
      const finish = (v) => { if (done) return; done = true; resolve(v); m.close() }
      const one = files.length === 1
      const m = dlg('Open or import into this page?', 'circle-help', [
        h('p', one ? `Do you want to open ${files[0].name} as a new drawing, or add it to this page?` : `Do you want to open these ${files.length} files as a new drawing, or add them to this page?`),
        h('ul', { class: 'ds-list' }, h('li', 'Open replaces the drawing you are working on. Unsaved changes are lost.' + (files.length > 1 ? ' The first file is opened and the others become new pages.' : '')), h('li', 'Import keeps the drawing and places each file on this page as a group.')),
      ], [button('Cancel', { variant: 'secondary', onClick: () => finish(null) }), button('Open', { variant: 'danger', onClick: () => finish('open') }), button('Import into this page', { variant: 'primary', onClick: () => finish('import') })], () => { if (!done) { done = true; resolve(null) } })
    })
  }

  return { openMoveToLayer, openOutlinePen, openTrace, openOptions, openDocProps, openGuide, openFinder, showAbout, showConversions, showFormats, pickPage, openOrImport }
}
