// Pages (with masters), Layers and Styles panels.
import { h, button, alert, yieldToMain } from '../../lib/ui.js'
import { renderToCanvas } from './_render.js'
import { FAMILIES, familyOf, WEIGHT_NAMES } from './_fonts.js'
import * as cmd from './_commands.js'
import { ibtn, sec, row, numInput, dynSelect, segButtons } from './_ui.js'

// ---------- Pages and masters ----------
export function pagesPanel(ctx) {
  const { ed, store, scene } = ctx
  const el = h('div', { class: 'ls-panel-body' })
  const banner = h('div')
  const list = h('div', { class: 'ls-pages', role: 'list' })
  const mlist = h('div', { class: 'ls-masters' })
  const thumbs = new Map()
  let sig = '', msig = '', timer = 0, dragFrom = -1
  const doc = () => store.doc
  const curIdx = () => ed.currentIndex()

  const bar = h('div', { class: 'ls-rowbar' },
    ibtn('plus', 'Add page after this one', { onClick: () => { const id = cmd.addPage(store, curIdx()); ed.gotoPage(id) }, label: 'Add' }),
    ibtn('copy', 'Duplicate this page', { onClick: () => { const id = cmd.duplicatePage(store, curIdx()); ed.gotoPage(id) } }),
    ibtn('arrow-up', 'Move page up', { onClick: () => { const i = curIdx(); if (i > 0) cmd.movePage(store, i, i - 1) } }),
    ibtn('arrow-down', 'Move page down', { onClick: () => { const i = curIdx(); if (i < doc().pages.length - 1) cmd.movePage(store, i, i + 1) } }),
    ibtn('trash-2', 'Delete this page', { onClick: () => { if (doc().pages.length > 1) cmd.deletePage(store, curIdx()); else ctx.toast('A document needs at least one page.', 'error') } }))
  const masterSel = dynSelect('Master applied to this page', () => [['', 'None'], ...doc().masters.map((m) => [m.id, m.name])], () => doc().pages[curIdx()]?.master || '', (v) => cmd.setPageMaster(store, ed.currentPageId(), v))

  function thumbFor(p, i) {
    const d = doc()
    const w = 92, hgt = Math.round((92 * d.h) / d.w)
    const c = h('canvas', { width: w * 2, height: hgt * 2, style: { width: `${w}px`, height: `${hgt}px` }, 'aria-hidden': 'true' })
    thumbs.set(p.id, c)
    return c
  }
  function buildList() {
    const d = doc()
    thumbs.clear()
    list.replaceChildren(...d.pages.map((p, i) => {
      const m = d.masters.find((x) => x.id === p.master)
      const b = h('div', {
        class: 'ls-page', role: 'listitem', draggable: true, 'data-id': p.id,
        ondragstart: (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(i)) } catch { /* ignore */ } },
        ondragover: (e) => { if (dragFrom >= 0) { e.preventDefault(); b.classList.add('over') } },
        ondragleave: () => b.classList.remove('over'),
        ondrop: (e) => { e.preventDefault(); b.classList.remove('over'); if (dragFrom >= 0) { cmd.movePage(store, dragFrom, i); dragFrom = -1 } },
      }, h('button', { type: 'button', class: 'ls-pagebtn', 'aria-label': `Go to page ${i + 1}`, onclick: () => { if (ed.mode.kind === 'master') ed.exitMaster(); ed.select([]); ed.gotoPage(p.id) } }, thumbFor(p, i)),
      h('div', { class: 'ls-pagenum' }, h('span', String(i + 1)), m && h('span', { class: 'ls-pm', title: `Master ${m.name}` }, m.name.slice(0, 1))))
      return b
    }))
    scheduleThumbs()
  }
  function scheduleThumbs() { clearTimeout(timer); timer = setTimeout(renderThumbs, 320) }
  let busyThumbs = false
  async function renderThumbs() {
    if (busyThumbs || !el.isConnected || !el.offsetParent) return
    busyThumbs = true
    try {
      const d = doc()
      for (let i = 0; i < d.pages.length; i++) {
        const c = thumbs.get(d.pages[i].id)
        if (!c) continue
        const src = renderToCanvas(scene, d.pages[i], { scale: c.width / d.w, index: i })
        const cx = c.getContext('2d')
        cx.clearRect(0, 0, c.width, c.height)
        cx.drawImage(src, 0, 0, c.width, c.height)
        if (i % 4 === 3) await yieldToMain()
      }
    } finally { busyThumbs = false }
  }
  function buildMasters() {
    const d = doc()
    mlist.replaceChildren(...d.masters.map((m) => h('div', { class: ['ls-master', ed.mode.kind === 'master' && ed.mode.id === m.id && 'active'] },
      h('input', { class: 'input ls-name', value: m.name, 'aria-label': 'Master name', oninput: (e) => store.exec('Rename master', (dd) => { const x = dd.masters.find((y) => y.id === m.id); if (x) x.name = e.target.value }, { key: `mname:${m.id}` }) }),
      ibtn('pencil', 'Edit this master page', { pos: 'l', onClick: () => ed.editMaster(m.id) }),
      ibtn('copy', 'Duplicate master', { pos: 'l', onClick: () => cmd.duplicateMaster(store, m.id) }),
      ibtn('trash-2', 'Delete master', { pos: 'l', onClick: () => cmd.deleteMaster(store, m.id), disabled: d.masters.length < 2 }))))
  }
  function sync() {
    const d = doc()
    const inMaster = ed.mode.kind === 'master'
    const s = `${d.pages.map((p) => p.id + (p.master || '')).join()}|${d.w}x${d.h}`
    if (s !== sig) { sig = s; buildList() } else scheduleThumbs()
    const ms = `${d.masters.map((m) => m.id + m.name).join()}|${ed.mode.kind}${ed.mode.id || ''}`
    if (ms !== msig) { msig = ms; buildMasters() }
    const cur = ed.currentPageId()
    for (const node of list.children) node.classList.toggle('current', node.dataset.id === cur && !inMaster)
    masterSel.sync()
    banner.replaceChildren(inMaster ? alert('info', h('div', { class: 'ls-bannerrow' }, h('span', `Editing master ${store.doc.masters.find((m) => m.id === ed.mode.id)?.name || ''}. Use {#} in text for the page number.`), button('Done', { size: 'sm', variant: 'primary', onClick: () => ed.exitMaster() }))) : '')
    bar.classList.toggle('disabled', inMaster)
  }
  el.append(banner, sec('Pages', [bar, list, row('Master', masterSel)]), sec('Master pages', [mlist, button('New master', { size: 'sm', icon: 'plus', onClick: () => { const id = cmd.addMaster(store); ed.editMaster(id) } }),
    h('p', { class: 'ls-muted' }, 'Items on a master repeat on every page that uses it: headers, footers, page numbers. Type {#} for the page number, {total} for the page count and {title} for the document name.')]))
  sync()
  return { el, sync, scheduleThumbs }
}

// ---------- Layers ----------
export function layersPanel(ctx) {
  const { ed, store } = ctx
  const el = h('div', { class: 'ls-panel-body' })
  const list = h('div', { class: 'ls-layers' })
  let sig = ''
  const doc = () => store.doc
  const active = () => (ed.activeLayer && doc().layers.some((l) => l.id === ed.activeLayer) ? ed.activeLayer : doc().layers[doc().layers.length - 1].id)
  function build() {
    const d = doc()
    list.replaceChildren(...[...d.layers].reverse().map((l, k, arr) => h('div', { class: ['ls-layer', active() === l.id && 'active', !l.visible && 'is-off'], 'data-id': l.id, onclick: (e) => { if (!e.target.closest('button, input')) { ed.activeLayer = l.id; sync(true) } } },
      ibtn(l.visible ? 'eye' : 'eye-off', l.visible ? 'Hide layer' : 'Show layer', { pos: 'r', onClick: () => cmd.updateLayer(store, l.id, { visible: !l.visible }) }),
      ibtn(l.locked ? 'lock' : 'lock-open', l.locked ? 'Unlock layer' : 'Lock layer', { pos: 'r', onClick: () => cmd.updateLayer(store, l.id, { locked: !l.locked }) }),
      h('input', { class: 'input ls-name', value: l.name, 'aria-label': 'Layer name', oninput: (e) => cmd.updateLayer(store, l.id, { name: e.target.value }, 'name') }),
      ibtn('chevron-up', 'Move layer up', { pos: 'l', disabled: k === 0, onClick: () => cmd.moveLayer(store, l.id, 1) }),
      ibtn('chevron-down', 'Move layer down', { pos: 'l', disabled: k === arr.length - 1, onClick: () => cmd.moveLayer(store, l.id, -1) }),
      ibtn('trash-2', 'Delete layer (its frames move to a neighbour)', { pos: 'l', disabled: d.layers.length < 2, onClick: () => cmd.deleteLayer(store, l.id) }))))
  }
  function sync(force) {
    const d = doc()
    const s = JSON.stringify(d.layers) + active()
    if (force || s !== sig) { sig = s; const focused = document.activeElement?.closest?.('.ls-layer')?.dataset.id; if (!(document.activeElement?.classList?.contains('ls-name') && focused)) build() }
  }
  el.append(sec('Layers', [list, h('div', { class: 'ls-rowbar' }, button('Add layer', { size: 'sm', icon: 'plus', onClick: () => { const id = cmd.addLayer(store); ed.activeLayer = id } }),
    button('Move selection here', { size: 'sm', variant: 'ghost', onClick: () => { const ids = ed.unlockedIds(); if (ids.length) cmd.moveToLayer(store, ids, active()) } })),
  h('p', { class: 'ls-muted' }, 'New frames go on the highlighted layer. Layers at the top paint over the ones below. Hidden or locked layers cannot be edited on the canvas.')]))
  build()
  return { el, sync }
}

// ---------- Styles ----------
const ALIGN = [['left', 'align-left', 'Left'], ['center', 'align-center', 'Center'], ['right', 'align-right', 'Right'], ['justify', 'align-justify', 'Justify']]
export function stylesPanel(ctx) {
  const { ed, store } = ctx
  const el = h('div', { class: 'ls-panel-body' })
  let kind = 'para', selId = null, sig = ''
  const doc = () => store.doc
  const list = () => doc().styles[kind]
  const cur = () => list().find((s) => s.id === selId) || list()[0]
  const upd = (patch) => cmd.updateStyle(store, kind, cur().id, patch)
  const syncers = []
  const optional = kind2 => kind2 === 'char'

  function field(k, label) {
    const opt = optional(kind)
    const get = () => cur()?.[k]
    let c
    if (k === 'name') c = h('input', { class: 'input', 'aria-label': 'Style name', oninput: (e) => upd({ name: e.target.value }) }), syncers.push(() => { if (document.activeElement !== c) c.value = get() ?? '' })
    else if (k === 'font') {
      c = h('select', { class: 'select ls-sel', 'aria-label': label, onchange: (e) => upd({ font: e.target.value || undefined }) }, opt && h('option', { value: '' }, 'Inherit'), FAMILIES.map((f) => h('option', { value: f.id }, f.name)))
      syncers.push(() => { c.value = get() ?? '' })
    } else if (k === 'weight') {
      c = h('select', { class: 'select ls-sel', 'aria-label': label, onchange: (e) => upd({ weight: e.target.value ? +e.target.value : undefined }) })
      syncers.push(() => {
        const fam = familyOf(cur()?.font || (opt ? 'inter' : 'inter'))
        const sg = fam.weights.join()
        if (c.dataset.k !== sg) { c.dataset.k = sg; c.replaceChildren(...(opt ? [h('option', { value: '' }, 'Inherit')] : []), ...fam.weights.map((w) => h('option', { value: String(w) }, WEIGHT_NAMES[w] || w))) }
        c.value = get() == null ? '' : String(get())
      })
    } else if (['italic', 'caps', 'underline'].includes(k)) {
      c = h('select', { class: 'select ls-sel', 'aria-label': label, onchange: (e) => upd({ [k]: e.target.value === '' ? undefined : e.target.value === '1' }) }, opt && h('option', { value: '' }, 'Inherit'), h('option', { value: '1' }, 'On'), h('option', { value: '0' }, 'Off'))
      syncers.push(() => { c.value = get() == null ? '' : get() ? '1' : '0' })
    } else if (k === 'color') {
      c = h('div', { class: 'ls-colorrow' })
      const inp = h('input', { type: 'color', class: 'ls-color', 'aria-label': label, oninput: (e) => upd({ color: e.target.value }) })
      c.append(inp, opt && ibtn('x', 'Inherit color', { pos: 't', onClick: () => upd({ color: undefined }) }))
      syncers.push(() => { inp.value = /^#[0-9a-f]{6}$/i.test(get() || '') ? get() : '#000000'; inp.classList.toggle('is-none', get() == null) })
    } else if (k === 'align') {
      c = segButtons(ALIGN, get, (v) => upd({ align: v }), 'Alignment')
      syncers.push(c.sync)
    } else if (k === 'list') {
      c = h('select', { class: 'select ls-sel', 'aria-label': label, onchange: (e) => upd({ list: e.target.value }) }, h('option', { value: 'none' }, 'None'), h('option', { value: 'bullet' }, 'Bullets'), h('option', { value: 'number' }, 'Numbered'))
      syncers.push(() => { c.value = get() || 'none' })
    } else {
      const n = numInput(label, get, (v) => upd({ [k]: v }), { dec: 2, step: k === 'lh' ? 0.05 : 'any' })
      n.input.placeholder = opt ? 'Inherit' : ''
      n.input.oninput = (e) => { const v = e.target.valueAsNumber; upd({ [k]: Number.isFinite(v) ? v : opt ? undefined : 0 }) }
      syncers.push(() => { if (document.activeElement !== n.input) n.input.value = get() == null ? '' : String(Math.round(get() * 100) / 100) })
      c = n.input
    }
    return row(label, c)
  }
  function build() {
    syncers.length = 0
    const d = doc()
    if (!list().some((s) => s.id === selId)) selId = list()[0]?.id
    const s = cur()
    const mode = segButtons([['para', 'pilcrow', 'Paragraph styles', 'Paragraph'], ['char', 'a-large-small', 'Character styles', 'Character']], () => kind, (v) => { kind = v; selId = null; sig = ''; sync() }, 'Style type')
    const items = h('div', { class: 'ls-stylelist' }, list().map((st) => h('div', { class: ['ls-style', st.id === s?.id && 'active'] },
      h('button', { type: 'button', class: 'ls-stylename', 'data-sid': st.id, onclick: () => { selId = st.id; sig = ''; sync() } }, st.name),
      ibtn('check', `Apply ${st.name} to the selection`, { pos: 'l', onClick: () => ed.applyText(kind === 'para' ? 'paraStyle' : 'charStyle', st.id) }))))
    const fields = kind === 'para'
      ? [['name', 'Name'], ['font', 'Font'], ['weight', 'Weight'], ['italic', 'Italic'], ['size', 'Size (pt)'], ['lh', 'Line height'], ['color', 'Color'], ['align', 'Align'], ['before', 'Space before'], ['after', 'Space after'], ['left', 'Left indent'], ['indent', 'First-line indent'], ['tracking', 'Tracking'], ['caps', 'All caps'], ['list', 'List']]
      : [['name', 'Name'], ['font', 'Font'], ['weight', 'Weight'], ['italic', 'Italic'], ['size', 'Size (pt)'], ['color', 'Color'], ['tracking', 'Tracking'], ['caps', 'All caps'], ['underline', 'Underline']]
    el.replaceChildren(
      sec('Styles', [mode, items, h('div', { class: 'ls-rowbar' },
        button('New', { size: 'sm', icon: 'plus', onClick: () => { selId = cmd.addStyle(store, kind); sig = ''; sync() } }),
        button('Duplicate', { size: 'sm', variant: 'ghost', icon: 'copy', onClick: () => { selId = cmd.addStyle(store, kind, s.id); sig = ''; sync() } }),
        button('Delete', { size: 'sm', variant: 'ghost', icon: 'trash-2', disabled: kind === 'para' && d.styles.para.length < 2, onClick: () => { cmd.deleteStyle(store, kind, s.id); selId = null; sig = ''; sync() } }))]),
      sec(s ? `Edit "${s.name}"` : 'Edit style', s ? [kind === 'char' ? h('p', { class: 'ls-muted' }, 'Only the options you set change the text. The rest comes from the paragraph.') : null, fields.map(([k, l]) => field(k, l))] : []))
    for (const f of syncers) f()
  }
  function sync() {
    const d = doc()
    const s = kind + selId + d.styles.para.map((x) => x.id).join() + '|' + d.styles.char.map((x) => x.id).join()
    if (s !== sig) { sig = s; build() } else {
      for (const f of syncers) f()
      for (const b of el.querySelectorAll('.ls-stylename')) { const st = list().find((x) => x.id === b.dataset.sid); if (st && b.textContent !== st.name) b.textContent = st.name }
    }
  }
  sync()
  return { el, sync }
}
