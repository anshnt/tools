// Draw Studio bars: toolbox, standard bar, property bar, page tabs and status bar. All text goes through textContent (never innerHTML).
import { h, icon } from '../../lib/ui.js'
import { describeNode } from './_ds-doc.js'
import { UNITS_LIST, fmt } from './_ds-units.js'
import { zoomPercent } from './_ds-view.js'
import { boxUnion } from './_ds-hit.js'
import { commandById } from './_ds-keys.js'

const tip = (label, keys) => (keys?.length ? `${label} (${keys[0]})` : label)

/** Icon button wired to a command: refreshes its disabled state through refresh(). */
function cmdButton(commands, id, { label, text } = {}) {
  const c = commandById(id)
  const btn = h('button', { type: 'button', class: 'ds-btn', 'aria-label': label || c.label.replace('...', ''), title: tip(label || c.label.replace('...', ''), c.keys), onclick: () => commands.run(id) },
    icon(c.icon), text ? h('span', { class: 'ds-btn-t' }, text) : null)
  btn.refresh = () => { const on = commands.enabled(id); btn.disabled = !on }
  return btn
}

export function createToolbox({ store, tools }) {
  const el = h('div', { class: 'ds-tools', role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' })
  const btns = tools.list.map((t) => {
    const b = h('button', { type: 'button', class: 'ds-tool', 'aria-label': t.label, title: `${tip(t.label, t.keys)}. ${t.tip || ''}`.trim(), 'aria-pressed': 'false', 'data-tool': t.id, onclick: () => tools.set(t.id) }, icon(t.icon))
    return b
  })
  el.append(...btns)
  const refresh = () => btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === store.tool)))
  el.addEventListener('keydown', (e) => { // arrows move between tools (roving focus)
    const i = btns.indexOf(document.activeElement)
    const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key]
    if (i < 0 || !d) return
    e.preventDefault(); e.stopPropagation()
    btns[(i + d + btns.length) % btns.length].focus()
  })
  refresh()
  return { el, refresh }
}

export function createStandardBar({ commands, store, app }) {
  const zoomBtn = h('button', { type: 'button', class: 'ds-btn ds-zoomval', 'aria-label': 'Zoom level, click to fit the page', title: 'Zoom (click to fit the page)', onclick: () => commands.run('view.zoomPage') }, '100%')
  const bs = ['file.new', 'file.open'].map((id) => cmdButton(commands, id))
  const undo = cmdButton(commands, 'edit.undo'), redo = cmdButton(commands, 'edit.redo')
  const zo = cmdButton(commands, 'view.zoomOut', { label: 'Zoom out' }), zi = cmdButton(commands, 'view.zoomIn', { label: 'Zoom in' })
  const fit = cmdButton(commands, 'view.zoomPage', { label: 'Zoom to page' })
  const fs = cmdButton(commands, 'view.fullscreen', { label: 'Full screen' })
  const sep = () => h('span', { class: 'ds-sep', role: 'separator' })
  const all = [...bs, undo, redo, zo, zi, fit, fs]
  const name = h('span', { class: 'ds-docname', title: '' }, 'Untitled')
  const el = h('div', { class: 'ds-std', role: 'toolbar', 'aria-label': 'Standard' }, ...bs, sep(), undo, redo, sep(), zo, zoomBtn, zi, fit, h('span', { class: 'ds-grow' }), name, fs)
  const refresh = () => {
    all.forEach((b) => b.refresh())
    undo.title = tip(commands.label('edit.undo'), commandById('edit.undo').keys)
    redo.title = tip(commands.label('edit.redo'), commandById('edit.redo').keys)
    zoomBtn.textContent = `${zoomPercent(store.view.z)}%`
    name.textContent = store.root.title + (store.dirty ? ' *' : '')
    name.title = store.root.meta?.name || ''
  }
  return { el, refresh }
}

/** Property bar: for now page and selection facts plus the units choice; later milestones add the editing fields (X, Y, W, H, fonts, ...). */
export function createPropBar({ store, boxOf }) {
  const text = h('span', { class: 'ds-prop-t', 'aria-live': 'polite' })
  const units = h('select', { class: 'select ds-units', 'aria-label': 'Units', onchange: (e) => { const u = e.target.value; store.tx('Change units', (r) => (r.units === u ? r : { ...r, units: u })) } },
    UNITS_LIST.map((u) => h('option', { value: u }, u)))
  const el = h('div', { class: 'ds-prop', role: 'toolbar', 'aria-label': 'Properties' }, text, h('span', { class: 'ds-grow' }), h('label', { class: 'ds-unitlbl' }, h('span', 'Units'), units))
  const refresh = () => {
    const u = store.root.units
    units.value = u
    const page = store.page()
    const nodes = store.sel.ids.map((id) => store.find(id)?.node).filter(Boolean)
    if (!nodes.length) text.textContent = page ? `Page size ${fmt(page.w, u)} x ${fmt(page.h, u)} ${u}` : ''
    else {
      const b = boxUnion(nodes.map((n) => boxOf(n)))
      text.textContent = b ? `Size ${fmt(b.w, u)} x ${fmt(b.h, u)} ${u}` : ''
    }
  }
  return { el, refresh }
}

export function createPageTabs({ store, app }) {
  const strip = h('div', { class: 'ds-tabstrip', role: 'tablist', 'aria-label': 'Pages' })
  const mk = (id, ic, label, enabled) => { const b = h('button', { type: 'button', class: 'ds-btn', 'aria-label': label, title: label, onclick: () => app.run(id) }, icon(ic)); b.refresh = () => { b.disabled = !app.enabled(id) }; return b }
  const prev = mk('page.prev', 'chevron-left', 'Previous page'), next = mk('page.next', 'chevron-right', 'Next page')
  const el = h('div', { class: 'ds-pages' }, prev, strip, next)
  let key = ''
  const refresh = () => {
    const pages = store.root.pages
    const k = pages.map((p) => `${p.id}:${p.name}:${p.pending ? 1 : 0}`).join('|')
    if (k !== key) { // the page list changed: rebuild, and keep focus on the tab strip when it was there
      const had = strip.contains(document.activeElement)
      key = k
      strip.replaceChildren(...pages.map((p, i) => {
        const b = h('button', { type: 'button', role: 'tab', class: 'ds-tab', onclick: () => app.gotoPage(i) },
          p.pending ? h('span', { class: 'spinner', 'aria-hidden': 'true' }) : null, h('span', p.name))
        if (p.pending) b.title = 'Still being read'
        return b
      }))
      if (had) strip.children[store.pageIndex]?.focus()
    }
    [...strip.children].forEach((b, i) => { const on = i === store.pageIndex; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1 })
    strip.children[store.pageIndex]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    prev.refresh(); next.refresh()
  }
  strip.addEventListener('keydown', (e) => {
    const tabs = [...strip.children]
    const i = tabs.indexOf(document.activeElement)
    const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
    if (i < 0 || !d) return
    e.preventDefault(); e.stopPropagation()
    const j = Math.max(0, Math.min(tabs.length - 1, i + d))
    tabs[j].focus()
  })
  return { el, refresh }
}

export function createStatusBar({ store, view, app }) {
  const msg = h('span', { class: 'ds-st-msg', 'aria-hidden': 'true' })
  const live = h('span', { class: 'ds-sr', 'aria-live': 'polite', role: 'status' })
  const notes = h('button', { type: 'button', class: 'ds-st-notes', hidden: true, onclick: () => app.run('file.notes') })
  const pos = h('span', { class: 'ds-st-pos' })
  const zoom = h('span', { class: 'ds-st-zoom' })
  const el = h('div', { class: 'ds-status' }, msg, live, h('span', { class: 'ds-grow' }), notes, pos, zoom)
  let transient = ''
  const selText = () => {
    const ids = store.sel.ids
    if (!ids.length) return store.ctx != null ? `Inside ${store.find(store.ctx)?.node?.name || 'group'}` : 'Nothing selected'
    if (ids.length > 1) return `${ids.length} objects selected`
    const f = store.find(ids[0])
    if (!f?.node) return ''
    const crumb = store.ctx != null && store.ctx !== ids[0] ? `${store.find(store.ctx)?.node?.name || 'Group'} > ` : ''
    return `${crumb}${describeNode(f.node)} on ${f.layer.name}`
  }
  const refresh = () => {
    const t = transient || selText()
    if (msg.textContent !== t) { msg.textContent = t; live.textContent = t }
    zoom.textContent = `${zoomPercent(store.view.z)}%`
    const n = store.root.warnings.length
    notes.hidden = !n
    notes.textContent = `${n} note${n === 1 ? '' : 's'}`
  }
  const cursor = (p) => {
    const page = store.page(), u = store.root.units
    if (!page || !p) { pos.textContent = ''; return }
    pos.textContent = `X ${fmt(p.x, u)}  Y ${fmt(page.h - p.y, u)} ${u}`
  }
  /** Show a message until the next selection change (empty text clears it). */
  const say = (t) => { transient = t || ''; refresh() }
  return { el, refresh, cursor, say, clearTransient: () => say('') }
}
