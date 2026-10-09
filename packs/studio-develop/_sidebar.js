// Left sidebar of the Develop view: presets with live previews of the current photo, undo history and file info.
import { h, icon, modal, button, toast, yieldToMain, formatBytes, download, input } from '../../lib/ui.js'
import * as store from '../../lib/store.js'
import { pickFiles } from '../../lib/files.js'
import { section, iconBtn } from './_controls.js'
import { createRenderer } from './_gl.js'
import { BUILTIN, applyLook } from './_presets.js'
import { GROUP_LABELS, LOOK_GROUPS, pick } from './_model.js'

const PREVIEW_W = 168

export function createSidebar(app, stage) {
  const ui = store.load('pdev:sidebar', {})
  const root = h('div', { class: 'pd-side' })
  const save = () => store.save('pdev:sidebar', ui)
  const sec = (key, opts) => {
    const el = section({ ...opts, key, open: ui[key] ?? opts.open })
    el.addEventListener('pd-toggle', (e) => { ui[key] = e.detail; save(); if (key === 'presets' && e.detail) schedulePreviews() })
    return el
  }

  // ---------- Presets ----------
  const search = h('input', { type: 'search', class: 'pd-search', placeholder: 'Search presets', 'aria-label': 'Search presets', oninput: () => drawPresets() })
  const list = h('div', { class: 'pd-presets' })
  const tiles = new Map() // id -> {canvas, look}
  let prevRenderer = null, prevCanvas = null, prevSrcId = null
  let prevToken = 0

  const saveBtn = button('Save current look', { icon: 'plus', size: 'sm', onClick: openSaveDialog })
  const ioBtns = h('div', { class: 'pd-row' },
    iconBtn({ icon: 'upload', tip: 'Import presets (JSON)', onClick: async () => {
      const [f] = await pickFiles({ accept: '.json,application/json' })
      if (!f) return
      try {
        const data = JSON.parse(await f.text())
        const n = await app.addPresets(Array.isArray(data?.presets) ? data.presets : [])
        toast(n ? `Imported ${n} preset${n > 1 ? 's' : ''}` : 'No new presets found in that file', n ? 'success' : 'info')
      } catch { toast('That file is not a presets export.', 'error') }
    } }),
    iconBtn({ icon: 'download', tip: 'Export my presets (JSON)', onClick: () => {
      if (!app.presets.length) return toast('Save a preset first, then you can export it.')
      download(JSON.stringify({ app: 'photo-develop', presets: app.presets }, null, 1), 'photo-develop-presets.json', 'application/json')
    } }))

  function openSaveDialog() {
    const m = app.active()
    if (!m) return toast('Open a photo first.')
    const name = input({ placeholder: 'Preset name', 'aria-label': 'Preset name', value: 'My preset' })
    const checks = LOOK_GROUPS.map((g) => {
      const cb = h('input', { type: 'checkbox', checked: true, id: `pdg-${g}` })
      return { g, cb, el: h('label', { class: 'pd-check', for: `pdg-${g}` }, cb, h('span', GROUP_LABELS[g])) }
    })
    const m2 = modal({
      title: 'Save preset', icon: 'bookmark-plus',
      body: h('div', { class: 'stack' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name'), name),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Include'), h('div', { class: 'pd-checks' }, checks.map((c) => c.el)))),
      actions: [button('Cancel', { onClick: () => m2.close() }), button('Save preset', { variant: 'primary', onClick: async () => {
        const groups = checks.filter((c) => c.cb.checked).map((c) => c.g)
        if (!groups.length) return toast('Choose at least one group to include.', 'error')
        await app.savePreset(name.value, groups)
        m2.close()
        toast('Preset saved', 'success')
      } })],
    })
    setTimeout(() => { name.focus(); name.select() }, 50)
  }

  function drawPresets() {
    const q = search.value.trim().toLowerCase()
    tiles.clear()
    const groups = new Map()
    for (const p of BUILTIN) (groups.get(p.group) || groups.set(p.group, []).get(p.group)).push({ id: p.id, name: p.name, look: p.s })
    const user = app.presets.map((p) => ({ id: p.id, name: p.name, look: p.look, user: true }))
    const out = []
    const block = (title, items) => {
      items = items.filter((p) => !q || p.name.toLowerCase().includes(q) || title.toLowerCase().includes(q))
      if (!items.length) return
      out.push(h('div', { class: 'pd-preset-group' }, h('div', { class: 'pd-sub' }, h('span', title)),
        h('div', { class: 'pd-preset-grid' }, items.map((p) => tile(p)))))
    }
    block('My presets', user)
    for (const [g, items] of groups) block(g, items)
    if (!out.length) out.push(h('div', { class: 'pd-hint' }, q ? 'No presets match.' : 'No presets yet.'))
    list.replaceChildren(...out)
    schedulePreviews()
  }
  function tile(p) {
    const cv = h('canvas', { class: 'pd-preset-cv', width: PREVIEW_W, height: Math.round(PREVIEW_W * 0.68) })
    tiles.set(p.id, { cv, look: p.look, replace: !p.user })
    const b = h('button', { type: 'button', class: 'pd-preset', 'aria-label': `Apply preset ${p.name}`, title: p.name,
      onclick: () => { if (!app.activeId) return; app.applyPreset(p.look, `Preset: ${p.name}`, app.selectedIds(), !p.user); toast(`Applied ${p.name}${app.selectedIds().length > 1 ? ` to ${app.selectedIds().length} photos` : ''}`) } },
    cv, h('span', p.name))
    if (!p.user) return b
    return h('div', { class: 'pd-preset-wrap' }, b, h('button', { type: 'button', class: 'pd-preset-del', 'aria-label': `Delete preset ${p.name}`, 'data-tip': 'Delete preset', onclick: () => app.deletePreset(p.id) }, icon('x')))
  }

  let previewTimer = 0, geomKey = ''
  function schedulePreviews() {
    clearTimeout(previewTimer)
    previewTimer = setTimeout(renderPreviews, 160)
  }
  async function renderPreviews() {
    const src = stage.source?.small
    const m = app.active()
    if (!src || !m || ui.presets === false || !root.offsetParent) return // collapsed or hidden: draw when it is shown
    const my = ++prevToken
    try {
      if (prevRenderer?.lost) { prevRenderer = null; prevSrcId = null }
      if (!prevRenderer) { prevCanvas = document.createElement('canvas'); prevRenderer = createRenderer(prevCanvas) }
      if (prevSrcId !== stage.source) { prevRenderer.setSource(src, src.width, src.height); prevSrcId = stage.source }
    } catch { return }
    const base = m.edits
    const aspect = src.width / src.height
    for (const [, t] of tiles) {
      if (my !== prevToken) return
      const w = t.cv.width, hh = Math.round(w / Math.max(0.4, Math.min(2.5, aspect * (base.crop.w / base.crop.h))))
      const [cw, ch] = [w, Math.min(t.cv.height, hh)]
      prevRenderer.render(applyLook(base, t.look, t.replace), cw, ch, { opaque: true })
      const c2 = t.cv.getContext('2d')
      c2.clearRect(0, 0, t.cv.width, t.cv.height)
      c2.drawImage(prevCanvas, 0, 0, t.cv.width, t.cv.height)
      await yieldToMain()
    }
  }

  const presetsSec = sec('presets', {
    title: 'Presets', icon: 'wand-sparkles', open: true,
    body: h('div', { class: 'pd-stack' }, search, h('div', { class: 'pd-row' }, saveBtn, ioBtns), list),
  })

  // ---------- History ----------
  const histList = h('ol', { class: 'pd-history', 'aria-label': 'Edit history' })
  function drawHistory() {
    const { items, i } = app.history()
    histList.replaceChildren(...items.map((label, idx) => h('li', null, h('button', { type: 'button', 'aria-current': idx === i ? 'step' : null, class: idx > i ? 'future' : '', onclick: () => app.jump(idx) }, label))).reverse())
  }
  const historySec = sec('history', { title: 'History', icon: 'history', open: false, body: histList })

  // ---------- Info ----------
  const infoBox = h('dl', { class: 'pd-info' })
  function drawInfo() {
    const m = app.active()
    if (!m) { infoBox.replaceChildren(); return }
    const row = (k, v) => [h('dt', k), h('dd', v)]
    infoBox.replaceChildren(...row('File', m.name), ...row('Size', `${m.w} x ${m.h} px (${((m.w * m.h) / 1e6).toFixed(1)} MP)`), ...row('Stored', formatBytes(m.size)),
      ...(m.taken ? row('Modified', new Date(m.taken).toLocaleDateString()) : []))
  }
  const infoSec = sec('info', { title: 'Info', icon: 'info', open: false, body: infoBox })

  root.append(presetsSec, historySec, infoSec)
  drawPresets(); drawHistory(); drawInfo()
  const offs = [
    app.on('history', drawHistory),
    app.on('active', () => { drawHistory(); drawInfo() }),
    app.on('presets', drawPresets),
    app.on('source', () => { prevSrcId = null; schedulePreviews() }),
    app.on('edit', (e) => {
      const m = app.active()
      if (!m || e.id !== m.id) return
      const k = JSON.stringify(pick(m.edits, ['geometry'])) // looks replace everything except the crop, so only the crop changes the previews
      if (k !== geomKey) { geomKey = k; schedulePreviews() }
    }),
  ]
  return { el: root, refresh: schedulePreviews, dispose() { offs.forEach((o) => o()); clearTimeout(previewTimer); prevToken++; prevRenderer?.dispose() } }
}
