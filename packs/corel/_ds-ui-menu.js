// Draw Studio menus: an ARIA menubar (roving focus, arrows, Home and End, type-ahead, Esc) for desktop and an accordion sheet for phones.
// Every item is a command from _ds-keys.js; checked, disabled and label state is read from the command table each time a menu opens.
import { h, icon } from '../../lib/ui.js'
import { menuTree } from './_ds-keys.js'

/** createMenus({commands, root, focusBack}) -> {bar, menuButton, sheet, close, closeSheet, dispose}. focusBack() returns focus to the canvas after a menu closes. */
export function createMenus({ commands, focusBack }) {
  const tree = menuTree()
  const items = [] // every item button, for refresh()
  const refresh = () => {
    for (const { btn, id, labelEl } of items) {
      const on = commands.enabled(id)
      btn.disabled = !on
      btn.setAttribute('aria-disabled', String(!on))
      if (btn.getAttribute('role') === 'menuitemcheckbox') btn.setAttribute('aria-checked', String(commands.checked(id)))
      labelEl.textContent = commands.label(id)
    }
  }
  const mkItem = (c, close) => {
    const check = !!commands.impl[c.id]?.checked
    const labelEl = h('span', { class: 'ds-mi-l' }, c.label)
    const btn = h('button', { type: 'button', role: check ? 'menuitemcheckbox' : 'menuitem', tabindex: -1, class: 'ds-mi', 'data-cmd': c.id, onclick: () => { close(); commands.run(c.id) } },
      labelEl, c.keys?.length || c.hint ? h('span', { class: 'ds-mi-k' }, c.keys?.[0] || c.hint) : null)
    if (check) btn.setAttribute('aria-checked', 'false')
    items.push({ btn, id: c.id, labelEl })
    return btn
  }
  const fill = (el, list, close) => {
    for (const it of list) {
      if (it.sep) el.append(h('div', { class: 'ds-msep', role: 'separator' }))
      else if (it.items) el.append(h('div', { class: 'ds-mhead', role: 'presentation' }, it.label), ...it.items.map((c) => mkItem(c, close)))
      else el.append(mkItem(it, close))
    }
  }

  // ---------- desktop menubar ----------
  const bar = h('div', { class: 'ds-menubar', role: 'menubar', 'aria-label': 'Menus' })
  let openIdx = -1
  const tops = tree.map((m, i) => {
    const popup = h('div', { class: 'ds-menu', role: 'menu', 'aria-label': m.menu, hidden: true })
    fill(popup, m.items, close)
    const btn = h('button', { type: 'button', role: 'menuitem', class: 'ds-mtop', 'aria-haspopup': 'menu', 'aria-expanded': 'false', tabindex: i ? -1 : 0,
      onclick: () => (openIdx === i ? close() : open(i)),
      onpointerenter: () => { if (openIdx >= 0 && openIdx !== i) open(i, false) },
    }, m.menu)
    const wrap = h('div', { class: 'ds-topwrap' }, btn, popup)
    popup.addEventListener('keydown', (e) => onMenuKey(e, i))
    btn.addEventListener('keydown', (e) => onTopKey(e, i))
    return { btn, popup, wrap }
  })
  bar.append(...tops.map((t) => t.wrap))
  const enabledItems = (i) => [...tops[i].popup.querySelectorAll('.ds-mi:not(:disabled)')]
  function open(i, focusFirst = true) {
    close(false)
    refresh()
    openIdx = i
    const t = tops[i]
    t.popup.hidden = false
    t.btn.setAttribute('aria-expanded', 'true')
    tops.forEach((x, j) => { x.btn.tabIndex = j === i ? 0 : -1 })
    if (focusFirst) enabledItems(i)[0]?.focus()
  }
  function close(back = true) {
    if (openIdx < 0) return
    const t = tops[openIdx]
    t.popup.hidden = true
    t.btn.setAttribute('aria-expanded', 'false')
    openIdx = -1
    if (back) focusBack?.()
  }
  function onTopKey(e, i) {
    const n = tops.length
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n; e.preventDefault(); tops[j].btn.focus(); tops.forEach((x, k) => { x.btn.tabIndex = k === j ? 0 : -1 }); if (openIdx >= 0) open(j) }
    else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(i) }
    else if (e.key === 'Escape' && openIdx >= 0) { e.preventDefault(); e.stopPropagation(); close(false); tops[i].btn.focus() }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); tops[e.key === 'Home' ? 0 : n - 1].btn.focus() }
  }
  function onMenuKey(e, i) {
    const list = enabledItems(i)
    const at = list.indexOf(document.activeElement)
    const n = list.length
    const go = (j) => { e.preventDefault(); list[(j + n) % n]?.focus() }
    if (e.key === 'ArrowDown') go(at + 1)
    else if (e.key === 'ArrowUp') go(at < 0 ? n - 1 : at - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(n - 1)
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + tops.length) % tops.length; open(j) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); tops[i].btn.focus() }
    else if (e.key === 'Tab') close(false)
    else if (e.key.length === 1 && /\S/.test(e.key)) { // type-ahead by first letter
      const ch = e.key.toLowerCase()
      const order = [...list.slice(at + 1), ...list.slice(0, at + 1)]
      order.find((b) => b.textContent.trim().toLowerCase().startsWith(ch))?.focus()
    }
    e.stopPropagation() // the app's shortcut dispatcher must not see keys typed inside an open menu
  }
  const onDocDown = (e) => { if (openIdx >= 0 && !bar.contains(e.target)) close(false) }
  document.addEventListener('pointerdown', onDocDown, true)

  // ---------- phone sheet (accordion) ----------
  const sheet = h('div', { class: 'ds-msheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Menu', hidden: true })
  // while the sheet covers the app, the rest of the app is inert: Tab stays in the sheet and a screen reader does not wander behind it
  const setSheet = (open) => {
    sheet.hidden = !open
    menuButton.setAttribute('aria-expanded', String(open))
    for (const c of sheet.parentElement?.children || []) if (c !== sheet) c.toggleAttribute('inert', open)
    if (open) { refresh(); sheet.querySelector('.ds-msheet-close')?.focus({ preventScroll: true }) }
  }
  const closeSheet = () => setSheet(false)
  sheet.append(h('button', { type: 'button', class: 'ds-msheet-close', onclick: () => { closeSheet(); focusBack?.() } }, icon('x'), h('span', 'Close menu')))
  tree.forEach((m) => {
    const body = h('div', { class: 'ds-msheet-body', hidden: true })
    fill(body, m.items, () => { closeSheet(); focusBack?.() })
    const head = h('button', { type: 'button', class: 'ds-msheet-head', 'aria-expanded': 'false', onclick: () => {
      const on = body.hidden
      for (const b of sheet.querySelectorAll('.ds-msheet-body')) b.hidden = true
      for (const x of sheet.querySelectorAll('.ds-msheet-head')) x.setAttribute('aria-expanded', 'false')
      body.hidden = !on
      head.setAttribute('aria-expanded', String(on))
      if (on) refresh()
    } }, h('span', m.menu), icon('chevron-down'))
    sheet.append(head, body)
  })
  sheet.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeSheet(); menuButton.focus(); return }
    if (e.key !== 'Tab') return
    // a focus trap: Tab wraps inside the sheet (the page behind it, outside the app, is not inert)
    const list = [...sheet.querySelectorAll('button:not(:disabled)')].filter((b) => b.offsetParent !== null)
    if (!list.length) return
    const first = list[0], last = list[list.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  })
  const menuButton = h('button', { type: 'button', class: 'ds-menubtn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => setSheet(sheet.hidden) }, icon('menu'), h('span', 'Menu'))

  return { bar, menuButton, sheet, close, closeSheet, refresh, dispose() { document.removeEventListener('pointerdown', onDocDown, true) } }
}

/**
 * Context menu: a flat list of commands opened at a pointer position (right click, or a long press where the browser sends contextmenu).
 * open(clientX, clientY, ids) takes command ids and '-' for a separator. Arrow keys, Home, End, Esc and a click elsewhere work as in the menubar.
 * env: {commands, wrap (the .t-ds root, position: relative), focusBack()} -> {el, open, close, isOpen, dispose}
 */
export function createContextMenu({ commands, wrap, focusBack }) {
  const el = h('div', { class: 'ds-menu ds-ctxmenu', role: 'menu', 'aria-label': 'Context menu', hidden: true })
  wrap.append(el)
  const buttons = () => [...el.querySelectorAll('.ds-mi:not(:disabled)')]
  function close(back = true) {
    if (el.hidden) return
    el.hidden = true
    if (back) focusBack?.()
  }
  function open(x, y, ids) {
    el.replaceChildren()
    let last = null
    for (const id of ids) {
      if (id === '-') { if (last !== '-' && last !== null) { el.append(h('div', { class: 'ds-msep', role: 'separator' })); last = '-' } continue }
      const c = commands.meta.get(id)
      if (!c || !commands.has(id)) continue
      const check = !!commands.impl[id]?.checked
      const on = commands.enabled(id)
      const btn = h('button', { type: 'button', role: check ? 'menuitemcheckbox' : 'menuitem', tabindex: -1, class: 'ds-mi', 'data-cmd': id, disabled: !on, 'aria-disabled': String(!on),
        onclick: () => { close(false); focusBack?.(); commands.run(id) } }, h('span', { class: 'ds-mi-l' }, commands.label(id)), c.keys?.length || c.hint ? h('span', { class: 'ds-mi-k' }, c.keys?.[0] || c.hint) : null)
      if (check) btn.setAttribute('aria-checked', String(commands.checked(id)))
      el.append(btn)
      last = id
    }
    if (el.lastChild?.classList?.contains('ds-msep')) el.lastChild.remove()
    if (!el.childElementCount) return
    el.hidden = false
    const w = wrap.getBoundingClientRect()
    const left = Math.max(4, Math.min(x - w.left, w.width - el.offsetWidth - 4)), top = Math.max(4, Math.min(y - w.top, w.height - el.offsetHeight - 4))
    el.style.left = `${left}px`; el.style.top = `${top}px`
    buttons()[0]?.focus({ preventScroll: true })
  }
  el.addEventListener('keydown', (e) => {
    const list = buttons(), at = list.indexOf(document.activeElement), n = list.length
    const go = (j) => { e.preventDefault(); list[(j + n) % n]?.focus() }
    if (e.key === 'ArrowDown') go(at + 1)
    else if (e.key === 'ArrowUp') go(at < 0 ? n - 1 : at - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(n - 1)
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(true) }
    e.stopPropagation()
  })
  const onDown = (e) => { if (!el.hidden && !el.contains(e.target)) close(false) }
  document.addEventListener('pointerdown', onDown, true)
  return { el, open, close, isOpen: () => !el.hidden, dispose() { document.removeEventListener('pointerdown', onDown, true); el.remove() } }
}
