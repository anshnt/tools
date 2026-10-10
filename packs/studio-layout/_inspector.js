// Design inspector (properties of the selection or the document) and the contextual control bar above the canvas.
import { h, button, alert, toast } from '../../lib/ui.js'
import { findItem, PAGE_PRESETS, matchPreset, presetSize, UNITS, toUnit, isLocked } from './_model.js'
import { FAMILIES, familyOf, WEIGHT_NAMES } from './_fonts.js'
import * as cmd from './_commands.js'
import { ibtn, sec, row, numInput, colorInput, selectInput, segButtons, dynSelect } from './_ui.js'
import { storyText } from './_model.js'

const DASHES = [['0', 'Solid'], ['1', 'Dashed'], ['2', 'Dotted']]

/** Text formatting controls (used in the control bar). */
function textBar(ctx) {
  const { ed, store } = ctx
  const st = () => ed.textState() || { ps: '', cs: '', o: {}, size: 10, font: 'inter', weight: 400, color: '#000000', lh: 1.4, tracking: 0, align: 'left' }
  const parts = []
  const reg = (c) => { parts.push(c); return c }
  const psSel = reg(dynSelect('Paragraph style', () => store.doc.styles.para.map((s) => [s.id, s.name]), () => st().ps, (v) => ed.applyText('paraStyle', v), 'ls-w-style'))
  const csSel = reg(dynSelect('Character style', () => [['', 'No character style'], ...store.doc.styles.char.map((s) => [s.id, s.name])], () => st().cs, (v) => ed.applyText('charStyle', v), 'ls-w-style'))
  const font = reg(dynSelect('Font', () => FAMILIES.map((f) => [f.id, f.name]), () => st().font, (v) => ed.applyText('prop', 'font', v), 'ls-w-font'))
  const weight = reg(dynSelect('Weight', () => familyOf(st().font).weights.map((w) => [String(w), WEIGHT_NAMES[w] || String(w)]), () => String(st().weight), (v) => ed.applyText('prop', 'weight', +v), 'ls-w-weight'))
  const size = reg(numInput('Size', () => st().size, (v) => v > 0 && ed.applyText('prop', 'size', v), { min: 1, max: 600, suffix: 'pt', dec: 1 }))
  const lh = reg(numInput('Line height', () => st().lh, (v) => v > 0 && ed.applyText('prop', 'lh', v), { min: 0.5, max: 4, step: 0.05, dec: 2, suffix: 'x' }))
  const b = ibtn('bold', 'Bold (Ctrl+B)', { onClick: () => ed.applyText('bold'), pressed: false })
  const i = ibtn('italic', 'Italic (Ctrl+I)', { onClick: () => ed.applyText('italic'), pressed: false })
  const u = ibtn('underline', 'Underline (Ctrl+U)', { onClick: () => ed.applyText('underline'), pressed: false })
  const align = segButtons([['left', 'align-left', 'Align left'], ['center', 'align-center', 'Align center'], ['right', 'align-right', 'Align right'], ['justify', 'align-justify', 'Justify']], () => st().align, (v) => ed.applyText('prop', 'align', v), 'Alignment')
  const color = reg(colorInput('Text color', () => st().color, (v) => v && ed.applyText('color', v), { none: false }))
  const clear = ibtn('eraser', 'Clear local formatting (back to the paragraph style)', { onClick: () => ed.applyText('clear') })
  const el = h('div', { class: 'ls-bar-group' }, psSel, csSel, font, weight, size, lh, h('span', { class: 'ls-sep' }), b, i, u, align, color, clear)
  el.sync = () => {
    for (const p of parts) p.sync?.()
    const s = ed.textState()
    if (s) { b.setPressed(s.b); i.setPressed(s.i); u.setPressed(s.u) }
    align.sync()
  }
  el.sync()
  return el
}

function imageBar(ctx, id) {
  const { ed, store } = ctx
  const it = () => findItem(store.doc, id)?.item
  const fit = segButtons([['fill', 'maximize', 'Fill the frame (crop the overflow)', 'Fill'], ['fit', 'minimize', 'Fit the whole image inside the frame', 'Fit'], ['stretch', 'move-diagonal', 'Stretch to the frame', 'Stretch']], () => it()?.fit, (v) => cmd.updateItems(store, [id], { fit: v, zoom: 1, ox: 0, oy: 0 }), 'Image fit')
  const crop = ibtn('crop', 'Crop: drag the image inside its frame (double-click the frame)', { onClick: () => { ed.crop = !ed.crop; ed.emit('crop'); ed.requestRender() }, label: 'Crop', pressed: ed.crop })
  const zoom = h('input', { type: 'range', class: 'ls-zoom', min: 50, max: 400, step: 1, 'aria-label': 'Image zoom', oninput: (e) => cmd.updateItems(store, [id], { zoom: e.target.valueAsNumber / 100 }, 'zoom') })
  const el = h('div', { class: 'ls-bar-group' }, ibtn('image-plus', it()?.asset ? 'Replace image' : 'Place image', { onClick: () => ctx.pickImage(id), label: it()?.asset ? 'Replace' : 'Place image' }), fit, crop, h('label', { class: 'ls-inline' }, h('span', 'Zoom'), zoom))
  el.sync = () => { fit.sync(); crop.setPressed(ed.crop); if (document.activeElement !== zoom) zoom.value = Math.round((it()?.zoom || 1) * 100) }
  el.sync()
  return el
}

/** The bar above the canvas: shows text, image or document controls depending on the selection. */
export function contextBar(ctx) {
  const { ed } = ctx
  const el = h('div', { class: 'ls-ctxbar', role: 'toolbar', 'aria-label': 'Selection controls' })
  let sig = '', inner = null
  const hint = () => h('div', { class: 'ls-hint' }, ed.tool === 'select' ? 'Select a frame to see its controls. Double-click a text frame to type.' : { text: 'Drag on the page to draw a text frame.', image: 'Drag to draw an image frame, then choose a picture.', rect: 'Drag to draw a rectangle.', ellipse: 'Drag to draw an ellipse.', line: 'Drag to draw a line.', hand: 'Drag to pan the canvas.' }[ed.tool])
  function build() {
    const items = ed.selItems()
    const one = items.length === 1 ? items[0] : null
    if (ed.threading) inner = h('div', { class: 'ls-hint' }, 'Threading: click another text frame, or drag a new one. Esc cancels.')
    else if (one?.type === 'text' || (items.length && items.every((x) => x.type === 'text'))) inner = textBar(ctx)
    else if (one?.type === 'image') inner = imageBar(ctx, one.id)
    else inner = hint()
    el.replaceChildren(inner)
  }
  el.sync = () => {
    const items = ed.selItems()
    const s = `${ed.sel.join()}|${items.map((x) => x.type).join()}|${ed.tool}|${ed.threading || ''}|${items[0]?.asset ? 1 : 0}`
    if (s !== sig) { sig = s; build() } else inner?.sync?.()
  }
  el.sync()
  return el
}

/** Right-hand Design tab. */
export function designPanel(ctx) {
  const { ed, store } = ctx
  const el = h('div', { class: 'ls-panel-body' })
  let syncers = [], sig = ''
  const reg = (c) => { if (c.sync) syncers.push(c.sync); return c }
  const unit = () => store.doc.unit
  const get1 = (id) => () => findItem(store.doc, id)?.item
  const upd = (id, patch, key) => cmd.updateItems(store, [id], patch, key)
  const swatches = () => store.doc.swatches

  function docSection() {
    const out = []
    const D = () => store.doc
    const set = (patch) => cmd.setDocSetup(store, patch)
    const name = h('input', { class: 'input', value: D().name, 'aria-label': 'Document name', oninput: (e) => set({ name: e.target.value }) })
    syncers.push(() => { if (document.activeElement !== name) name.value = D().name })
    const presetOpts = [...PAGE_PRESETS.map((p) => [p[0], p[1]]), ['Custom', 'Custom size']]
    const preset = reg(selectInput('Page size', presetOpts, () => matchPreset(D().w, D().h), (v) => { const s = presetSize(v); if (!s) return; const land = D().w > D().h; set(land ? { w: s[1], h: s[0] } : { w: s[0], h: s[1] }) }))
    const orient = reg(segButtons([['portrait', 'rectangle-vertical', 'Portrait', 'Portrait'], ['landscape', 'rectangle-horizontal', 'Landscape', 'Landscape']], () => (D().w > D().h ? 'landscape' : 'portrait'), (v) => { if ((D().w > D().h ? 'landscape' : 'portrait') !== v) set({ w: D().h, h: D().w }) }, 'Orientation'))
    const u = reg(selectInput('Units', Object.keys(UNITS).map((k) => [k, k]), () => D().unit, (v) => set({ unit: v })))
    const N = (l, get, s, o = {}) => reg(numInput(l, get, s, { unit, min: 0, ...o }))
    out.push(sec('Document', [
      row('Name', name), row('Size', preset), row('', orient), row('Units', u),
      h('div', { class: 'ls-grid2' }, N('Width', () => D().w, (v) => v > 20 && set({ w: v }), { min: 20 }), N('Height', () => D().h, (v) => v > 20 && set({ h: v }), { min: 20 })),
      h('div', { class: 'ls-grid2' }, N('Bleed', () => D().bleed, (v) => set({ bleed: Math.max(0, v) })), h('span')),
    ]))
    const M = (k, l) => N(l, () => D().margins[k], (v) => set({ margins: { [k]: Math.max(0, v) } }))
    out.push(sec('Margins and columns', [
      h('div', { class: 'ls-grid2' }, M('t', 'Top'), M('b', 'Bottom'), M('l', 'Left'), M('r', 'Right')),
      h('div', { class: 'ls-grid2' }, reg(numInput('Columns', () => D().cols, (v) => v >= 1 && v <= 12 && set({ cols: Math.round(v) }), { min: 1, max: 12, dec: 0 })), N('Gutter', () => D().gutter, (v) => set({ gutter: Math.max(0, v) }))),
    ]))
    const tg = (label, get, s) => { const t = h('label', { class: 'ls-check' }, h('input', { type: 'checkbox', onchange: (e) => s(e.target.checked) }), h('span', label)); syncers.push(() => { t.firstChild.checked = !!get() }); t.firstChild.checked = !!get(); return t }
    out.push(sec('Grids and snapping', [
      tg('Snap to guides and frames', () => D().view.snap, (v) => set({ view: { snap: v } })),
      tg('Snap to the document grid', () => D().view.snapGrid, (v) => set({ view: { snapGrid: v } })),
      tg('Show document grid', () => D().grid.showGrid, (v) => set({ grid: { showGrid: v } })),
      reg(numInput('Grid size', () => D().grid.size, (v) => v >= 2 && set({ grid: { size: v } }), { unit, min: 2 })),
      tg('Show baseline grid', () => D().grid.showBaseline, (v) => set({ grid: { showBaseline: v } })),
      reg(numInput('Baseline spacing', () => D().grid.baseline, (v) => v >= 2 && set({ grid: { baseline: v } }), { unit, min: 2 })),
    ]))
    out.push(sec('Show', [
      tg('Margins and column guides', () => D().view.margins, (v) => set({ view: { margins: v } })),
      tg('Ruler guides', () => D().view.guides, (v) => set({ view: { guides: v } })),
      tg('Frame edges', () => D().view.frames, (v) => set({ view: { frames: v } })),
      tg('Rulers', () => D().view.rulers, (v) => set({ view: { rulers: v } })),
      tg('Bleed box', () => D().view.bleed, (v) => set({ view: { bleed: v } })),
    ], false))
    // guides of the current page
    const list = h('div', { class: 'ls-guides' })
    let last = ''
    const renderGuides = () => {
      const pg = D().pages.find((p) => p.id === ed.currentPageId())
      const s = JSON.stringify([pg?.id, pg?.guides, D().unit])
      if (s === last) return
      last = s
      list.replaceChildren(...(pg ? ['v', 'h'].flatMap((axis) => pg.guides[axis].map((pos, i) => h('div', { class: 'ls-guide' }, h('span', `${axis === 'v' ? 'Vertical' : 'Horizontal'} at ${toUnit(pos, D().unit)} ${D().unit}`), ibtn('x', 'Remove guide', { pos: 'l', onClick: () => store.exec('Remove guide', (d) => { d.pages.find((p) => p.id === pg.id)?.guides[axis].splice(i, 1) }) })))) : []))
      if (!list.childElementCount) list.append(h('div', { class: 'ls-muted' }, 'No guides on this page. Drag from a ruler to add one.'))
    }
    syncers.push(renderGuides)
    let axis = 'v', pos = 0
    const axSel = h('select', { class: 'select ls-sel', 'aria-label': 'Guide direction', onchange: (e) => { axis = e.target.value } }, h('option', { value: 'v' }, 'Vertical'), h('option', { value: 'h' }, 'Horizontal'))
    const posIn = h('input', { class: 'input ls-num', type: 'number', step: 'any', 'aria-label': 'Guide position', placeholder: 'Position', oninput: (e) => { pos = e.target.valueAsNumber } })
    out.push(sec('Ruler guides on this page', [list, h('div', { class: 'ls-row2' }, axSel, posIn, button('Add', { size: 'sm', onClick: () => { if (Number.isFinite(pos)) cmd.addGuide(store, ed.currentPageId(), axis, pos * (UNITS[D().unit].f)) } })),
      button('Clear all guides', { size: 'sm', variant: 'ghost', onClick: () => store.exec('Clear guides', (d) => { const pg = d.pages.find((p) => p.id === ed.currentPageId()); if (pg) pg.guides = { v: [], h: [] } }) })], false))
    renderGuides()
    return out
  }

  function colorRow(label, ids2, key, { none = true, sw = false } = {}) {
    return reg(colorInput(label, () => findItem(store.doc, ids2[0])?.item?.[key] ?? null, (v) => cmd.updateItems(store, ids2, { [key]: v }, key), { none, swatches: sw ? swatches().slice(0, 10) : [] }))
  }

  function itemSections(items) {
    const out = []
    const one = items.length === 1 ? items[0] : null
    const idl = items.map((x) => x.id)
    if (one) {
      const id = one.id
      const g = get1(id)
      const N = (l, k, o = {}) => reg(numInput(l, () => g()?.[k], (v) => upd(id, { [k]: v }, k), { unit, ...o }))
      const lock = isLocked(store.doc, one)
      out.push(sec('Position and size', [
        lock && alert('info', 'Locked. Unlock it in the Arrange section to edit.'),
        h('div', { class: 'ls-grid2' }, N('X', 'x'), N('Y', 'y'), N(one.type === 'line' ? 'Length' : 'Width', 'w', { min: 1 }), one.type === 'line' ? h('span') : N('Height', 'h', { min: 1 })),
        h('div', { class: 'ls-grid2' }, reg(numInput('Rotation', () => g()?.rot, (v) => upd(id, { rot: ((v + 180) % 360 + 360) % 360 - 180 }, 'rot'), { suffix: 'deg', dec: 1 })),
          reg(numInput('Opacity', () => Math.round((g()?.opacity ?? 1) * 100), (v) => upd(id, { opacity: Math.min(1, Math.max(0, v / 100)) }, 'opacity'), { min: 0, max: 100, suffix: '%', dec: 0 }))),
      ]))
    } else {
      out.push(sec(`${items.length} frames selected`, [h('div', { class: 'ls-muted' }, 'Align them, change shared colors, or press Delete to remove them.'), reg(numInput('Opacity', () => Math.round((findItem(store.doc, idl[0])?.item?.opacity ?? 1) * 100), (v) => cmd.updateItems(store, idl, { opacity: Math.min(1, Math.max(0, v / 100)) }, 'opacity'), { min: 0, max: 100, suffix: '%', dec: 0 }))]))
    }
    const t = one?.type
    // Appearance
    const app = []
    if (items.some((x) => x.type !== 'line')) app.push(row(t === 'text' || t === 'image' ? 'Background' : 'Fill', colorRow('Fill', items.filter((x) => x.type !== 'line').map((x) => x.id), 'fill', { sw: true })))
    app.push(row(t === 'line' ? 'Color' : 'Stroke', colorRow('Stroke', idl, 'stroke', { none: t !== 'line' })))
    app.push(h('div', { class: 'ls-grid2' }, reg(numInput('Stroke width', () => findItem(store.doc, idl[0])?.item?.sw, (v) => cmd.updateItems(store, idl, { sw: Math.max(0, v) }, 'sw'), { min: 0, step: 0.5, suffix: 'pt', dec: 2 })),
      items.some((x) => x.type !== 'ellipse' && x.type !== 'line') ? reg(numInput('Corners', () => findItem(store.doc, idl[0])?.item?.radius, (v) => cmd.updateItems(store, idl, (it) => (it.type === 'ellipse' || it.type === 'line' ? {} : { radius: Math.max(0, v) }), 'radius'), { min: 0, suffix: 'pt', dec: 1 })) : h('span')))
    if (items.some((x) => ['rect', 'ellipse', 'line'].includes(x.type))) app.push(row('Line style', reg(selectInput('Line style', DASHES, () => findItem(store.doc, idl[0])?.item?.dash ?? 0, (v) => cmd.updateItems(store, idl, { dash: +v })))))
    out.push(sec('Appearance', app))

    if (one?.type === 'text') out.push(textSection(one))
    if (one?.type === 'image') out.push(imageSection(one))
    out.push(arrangeSection(items))
    return out
  }

  function textSection(it) {
    const id = it.id
    const g = get1(id)
    const info = h('div', { class: 'ls-muted' })
    const warn = h('div')
    const thread = h('div', { class: 'ls-rowbar' })
    const renderStatus = () => {
      const f = g()
      if (!f) return
      const words = (storyText(store.doc.stories[f.story] || { paras: [] }).match(/\S+/g) || []).length
      info.textContent = `${words} words in this story`
      const lay = ctx.scene.layout(f, { '#': '1', total: String(store.doc.pages.length), title: store.doc.name })
      const key = `${lay.overflow}|${f.next || ''}`
      if (warn.dataset.k !== key) {
        warn.dataset.k = key
        warn.replaceChildren(lay.overflow ? alert('warn', 'Text overflows this frame. Enlarge it, thread it to another frame, or flow it into new pages.') : '')
      }
      const tk = `${f.next || ''}|${store.doc.pages.some((p) => p.items.some((x) => x.next === id)) ? 1 : 0}|${lay.overflow}`
      if (thread.dataset.k !== tk) {
        thread.dataset.k = tk
        thread.replaceChildren(
          button(f.next ? 'Next frame' : 'Thread text', { size: 'sm', icon: f.next ? 'arrow-right' : 'link', onClick: () => (f.next ? ed.select([f.next]) : ed.armThread(id)) }),
          f.next ? button('Break thread', { size: 'sm', variant: 'ghost', icon: 'unlink', onClick: () => cmd.breakThread(store, id) }) : null,
          lay.overflow ? button('Flow into new pages', { size: 'sm', variant: 'primary', icon: 'files', onClick: () => { const n = cmd.flowStory(store, id, ctx.scene); toast(n ? `Added ${n} page${n > 1 ? 's' : ''}` : 'The story already fits', 'success') } }) : null)
      }
    }
    syncers.push(renderStatus)
    renderStatus()
    return sec('Text frame', [
      button('Edit text', { size: 'sm', icon: 'type', onClick: () => ed.startTextEdit(id) }), info, warn, thread,
      h('div', { class: 'ls-grid2' }, reg(numInput('Columns', () => g()?.cols, (v) => v >= 1 && v <= 12 && upd(id, { cols: Math.round(v) }, 'cols'), { min: 1, max: 12, dec: 0 })), reg(numInput('Gutter', () => g()?.gap, (v) => upd(id, { gap: Math.max(0, v) }, 'gap'), { unit, min: 0 }))),
      h('div', { class: 'ls-grid2' }, reg(numInput('Inset', () => g()?.inset, (v) => upd(id, { inset: Math.max(0, v) }, 'inset'), { unit, min: 0 }))),
      row('Vertical align', reg(segButtons([['top', 'align-vertical-justify-start', 'Align to the top'], ['middle', 'align-vertical-justify-center', 'Center vertically'], ['bottom', 'align-vertical-justify-end', 'Align to the bottom']], () => g()?.valign || 'top', (v) => upd(id, { valign: v }), 'Vertical alignment'))),
    ])
  }

  function imageSection(it) {
    const id = it.id
    const g = get1(id)
    const info = h('div', { class: 'ls-muted' })
    const render = () => {
      const f = g()
      const a = f?.asset && store.assets.get(f.asset)
      if (!a) { info.textContent = 'No image yet. Place one, or drop a file on the frame.'; return }
      const ppi = Math.round((a.w * (f.fit === 'fit' ? Math.min(1, 1) : 1)) / ((f.w * Math.max(f.zoom || 1, 1)) / 72))
      info.textContent = `${a.name}: ${a.w} x ${a.h} px, about ${Number.isFinite(ppi) ? ppi : '-'} ppi at this size${ppi < 150 ? ' (low for print)' : ''}`
    }
    syncers.push(render)
    render()
    return sec('Image', [
      h('div', { class: 'ls-rowbar' }, button(it.asset ? 'Replace image' : 'Place image', { size: 'sm', variant: 'primary', icon: 'image-plus', onClick: () => ctx.pickImage(id) }), it.asset ? button('Remove', { size: 'sm', variant: 'ghost', icon: 'trash-2', onClick: () => upd(id, { asset: null }) }) : null),
      info,
      row('Fit', reg(segButtons([['fill', 'maximize', 'Fill the frame', 'Fill'], ['fit', 'minimize', 'Fit inside the frame', 'Fit'], ['stretch', 'move-diagonal', 'Stretch to the frame', 'Stretch']], () => g()?.fit, (v) => upd(id, { fit: v, zoom: 1, ox: 0, oy: 0 }), 'Fit'))),
      reg(numInput('Zoom', () => Math.round((g()?.zoom || 1) * 100), (v) => v >= 10 && upd(id, { zoom: v / 100 }, 'zoom'), { min: 10, max: 800, suffix: '%', dec: 0 })),
      h('div', { class: 'ls-rowbar' }, button('Reset crop', { size: 'sm', variant: 'ghost', icon: 'rotate-ccw', onClick: () => upd(id, { zoom: 1, ox: 0, oy: 0 }) }), button(ed.crop ? 'Done cropping' : 'Crop', { size: 'sm', variant: 'ghost', icon: 'crop', onClick: () => { ed.crop = !ed.crop; ed.emit('crop'); ed.requestRender(); sig = ''; panelSync() } })),
    ])
  }

  function arrangeSection(items) {
    const idl = items.map((x) => x.id)
    let to = 'selection'
    const al = (mode, ic, tip) => ibtn(ic, tip, { pos: 't', onClick: () => cmd.alignItems(store, idl, mode, items.length === 1 && to === 'selection' ? 'page' : to) })
    const toSel = h('select', { class: 'select ls-sel', 'aria-label': 'Align to', onchange: (e) => { to = e.target.value } }, h('option', { value: 'selection' }, items.length > 1 ? 'Align to selection' : 'Align to page'), h('option', { value: 'page' }, 'Align to page'), h('option', { value: 'margins' }, 'Align to margins'))
    const locked = items.every((x) => x.locked)
    return sec('Arrange', [
      toSel,
      h('div', { class: 'ls-iconrow' }, al('left', 'align-start-vertical', 'Align left'), al('hcenter', 'align-center-vertical', 'Align horizontal centers'), al('right', 'align-end-vertical', 'Align right'),
        al('top', 'align-start-horizontal', 'Align top'), al('vcenter', 'align-center-horizontal', 'Align vertical centers'), al('bottom', 'align-end-horizontal', 'Align bottom')),
      h('div', { class: 'ls-iconrow' },
        ibtn('align-horizontal-space-between', 'Distribute horizontally (equal gaps)', { pos: 't', disabled: items.length < 3, onClick: () => cmd.distributeItems(store, idl, 'h', 'spacing') }),
        ibtn('align-vertical-space-between', 'Distribute vertically (equal gaps)', { pos: 't', disabled: items.length < 3, onClick: () => cmd.distributeItems(store, idl, 'v', 'spacing') }),
        ibtn('align-horizontal-distribute-center', 'Distribute horizontal centers', { pos: 't', disabled: items.length < 3, onClick: () => cmd.distributeItems(store, idl, 'h', 'centers') }),
        ibtn('align-vertical-distribute-center', 'Distribute vertical centers', { pos: 't', disabled: items.length < 3, onClick: () => cmd.distributeItems(store, idl, 'v', 'centers') })),
      h('div', { class: 'ls-iconrow' },
        ibtn('chevrons-up', 'Bring to front (Ctrl+Shift+])', { pos: 't', onClick: () => cmd.reorder(store, idl, 'front') }), ibtn('chevron-up', 'Bring forward (Ctrl+])', { pos: 't', onClick: () => cmd.reorder(store, idl, 'forward') }),
        ibtn('chevron-down', 'Send backward (Ctrl+[)', { pos: 't', onClick: () => cmd.reorder(store, idl, 'backward') }), ibtn('chevrons-down', 'Send to back (Ctrl+Shift+[)', { pos: 't', onClick: () => cmd.reorder(store, idl, 'back') }),
        ibtn(locked ? 'lock-open' : 'lock', locked ? 'Unlock' : 'Lock position', { pos: 't', onClick: () => cmd.updateItems(store, idl, { locked: !locked }) }),
        ibtn('group', 'Group (Ctrl+G)', { pos: 't', disabled: items.length < 2, onClick: () => cmd.groupItems(store, idl) }),
        ibtn('ungroup', 'Ungroup (Ctrl+Shift+G)', { pos: 't', disabled: !items.some((x) => x.grp), onClick: () => cmd.ungroupItems(store, idl) }),
        ibtn('copy', 'Duplicate (Ctrl+D)', { pos: 't', onClick: () => ed.duplicate() }), ibtn('trash-2', 'Delete', { pos: 't', onClick: () => ed.remove() })),
      layerMove(idl),
    ], true)
  }
  function layerMove(idl) {
    const s = dynSelect('Layer', () => store.doc.layers.map((l) => [l.id, l.name]).reverse(), () => findItem(store.doc, idl[0])?.item?.layer, (v) => cmd.moveToLayer(store, idl, v))
    syncers.push(s.sync)
    return row('Layer', s)
  }

  function build() {
    syncers = []
    const items = ed.selItems()
    el.replaceChildren(...(items.length ? itemSections(items) : docSection()))
  }
  function panelSync() {
    const items = ed.selItems()
    const s = `${ed.sel.join()}|${items.map((x) => x.type + (x.next ? 'n' : '') + (x.asset ? 'a' : '') + (x.locked ? 'l' : '') + (x.grp || '')).join()}|${ed.crop}`
    if (s !== sig) { sig = s; build() } else for (const f of syncers) f()
  }
  panelSync()
  return { el, sync: panelSync, rebuild: () => { sig = ''; panelSync() } }
}
