// App shell: hash router (#/, #/c/<category>, #/<tool-id>), home, category and tool pages, command palette.
import { CATEGORIES, TOOLS, byId, catById, toolsIn, POPULAR, MODES, search } from './catalog.js'
import { h, icon, clear, button, toast, alert, errorMessage, debounce } from '../lib/ui.js'
import * as store from '../lib/store.js'
import * as ai from '../lib/ai.js'

const REPO = 'https://github.com/anshnt/tools'
const app = document.getElementById('app')
const favs = new Set(store.load('favs', []))
let recent = store.load('recent', [])
let teardown = null

const color = (t) => catById.get(t.cat)?.color
const readyFirst = (list) => [...list.filter((t) => t.ready), ...list.filter((t) => !t.ready)]

// ---------- Shared pieces ----------
function favButton(t, cls = 'fav-btn') {
  const b = h('button', {
    type: 'button', class: cls, 'aria-pressed': String(favs.has(t.id)), 'aria-label': `Favorite ${t.name}`, title: 'Favorite',
    onclick: (e) => {
      e.preventDefault(); e.stopPropagation()
      favs.has(t.id) ? favs.delete(t.id) : favs.add(t.id)
      store.save('favs', [...favs])
      for (const el of document.querySelectorAll(`[data-fav="${t.id}"]`)) el.setAttribute('aria-pressed', String(favs.has(t.id)))
      toast(favs.has(t.id) ? `Added ${t.name} to favorites` : `Removed from favorites`)
    },
    dataset: { fav: t.id },
  }, icon('star'))
  return b
}

function modeBadge(t, withLabel = true) {
  const m = MODES[t.mode] || MODES.local
  return h('span', { class: ['badge', m.cls], title: m.title }, icon(m.icon), withLabel && m.label)
}

function toolCard(t) {
  return h('a', { class: ['tool-card', !t.ready && 'soon'], href: `#/${t.id}`, style: { '--c': color(t) } },
    h('div', { class: 'tile' }, icon(t.icon)),
    h('div', { class: 'body' },
      h('h3', t.name, t.mode !== 'local' && modeBadge(t), !t.ready && h('span', { class: 'badge soon' }, 'Soon')),
      h('p', t.desc)),
    favButton(t))
}

const grid = (list) => h('div', { class: 'tool-grid' }, list.map(toolCard))

function section(title, ic, list, more) {
  if (!list.length) return null
  return h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', ic && icon(ic), title), more || null),
    grid(list))
}

function chips(active) {
  return h('nav', { class: 'chips', 'aria-label': 'Categories' },
    h('a', { class: ['chip', !active && 'active'], href: '#/' }, icon('layout-grid'), 'All', h('span', { class: 'count' }, TOOLS.length)),
    CATEGORIES.map((c) => h('a', { class: ['chip', active === c.id && 'active'], href: `#/c/${c.id}`, style: { '--c': c.color } },
      icon(c.icon), c.name, h('span', { class: 'count' }, toolsIn(c.id).length))))
}

function setMeta(title, desc) {
  document.title = title ? `${title} · Tools` : 'Tools · Every everyday tool, in your browser'
  document.querySelector('meta[name="description"]')?.setAttribute('content', desc || 'Free, private online tools for PDFs, images, video, data, text, calculators and more. Most run entirely in your browser.')
}

// ---------- Views ----------
function homeView() {
  setMeta()
  const results = h('div')
  const readyCount = TOOLS.filter((t) => t.ready).length
  const q = h('input', {
    type: 'search', placeholder: `Search ${TOOLS.length} tools... e.g. "compress pdf", "emi", "heic"`, 'aria-label': 'Search tools', autocomplete: 'off',
    oninput: debounce(() => renderResults(), 60),
    onkeydown: (e) => { if (e.key === 'Enter') { const first = search(q.value)[0]; if (first) location.hash = `#/${first.id}` } },
  })

  const browse = h('div',
    favs.size ? section('Your favorites', 'star', [...favs].map((id) => byId.get(id)).filter(Boolean)) : null,
    recent.length ? section('Recently used', 'history', recent.map((id) => byId.get(id)).filter(Boolean).slice(0, 8)) : null,
    section('Popular tools', 'flame', POPULAR.map((id) => byId.get(id)).filter(Boolean)),
    h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', icon('blocks'), 'Browse by category')),
      h('div', { class: 'cat-grid' }, CATEGORIES.map((c) => {
        const list = readyFirst(toolsIn(c.id))
        return h('a', { class: 'cat-card', href: `#/c/${c.id}`, style: { '--c': c.color } },
          h('header', h('div', { class: 'tile', style: { '--c': c.color } }, icon(c.icon)),
            h('div', h('h3', c.title), h('p', `${list.length} tools`))),
          h('p', { class: 'small muted' }, c.blurb),
          h('ul', list.slice(0, 6).map((t) => h('li', t.name))),
          h('span', { class: 'more' }, `All ${c.name} tools`, icon('arrow-right')))
      }))),
    h('section', { class: 'section', id: 'all' },
      h('div', { class: 'section-head' }, h('h2', icon('list'), 'Every tool')),
      h('div', { class: 'directory' }, CATEGORIES.map((c) => h('section', { style: { '--c': c.color } },
        h('h3', icon(c.icon), c.name),
        [...toolsIn(c.id)].sort((a, b) => a.name.localeCompare(b.name)).map((t) => h('a', { href: `#/${t.id}`, class: !t.ready && 'soon' }, t.name)))))))

  function renderResults() {
    const v = q.value.trim()
    browse.hidden = !!v
    if (!v) return clear(results)
    const found = search(v)
    clear(results, h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', icon('search'), `${found.length} result${found.length === 1 ? '' : 's'} for "${v}"`)),
      found.length ? grid(found.slice(0, 60)) : h('div', { class: 'empty' }, icon('search-x'), h('div', 'No tools match. Try another word, like "convert" or "calculator".'))))
  }

  const view = h('div',
    h('div', { class: 'hero container' },
      h('span', { class: 'pill' }, h('b', 'New'), `${TOOLS.length} free tools · no sign-up · private by design`),
      h('h1', 'Every everyday tool, ', h('span', { class: 'gradient-text' }, 'right in your browser.')),
      h('p', { class: 'lede' }, 'PDFs, images, video, data, text, calculators, India forms and AI helpers. Most tools run entirely on your device, so your files never leave it.'),
      h('div', { class: 'hero-search' }, icon('search'), q, h('kbd', '/')),
      h('div', { class: 'hero-stats' },
        h('span', icon('shield-check'), 'Files stay on your device'),
        h('span', icon('shield-check'), 'Free, no account'),
        h('span', icon('shield-check'), 'Works on phone & desktop'),
        h('span', icon('shield-check'), `${readyCount} ready now`))),
    h('div', { class: 'container' }, chips(null), results, browse))
  view.focusSearch = () => q.focus()
  return view
}

function categoryView(id) {
  const c = catById.get(id)
  if (!c) return notFound()
  setMeta(c.title, c.blurb)
  const list = readyFirst(toolsIn(id))
  const out = h('div')
  const q = h('input', { class: 'input', type: 'search', placeholder: `Filter ${list.length} ${c.name} tools`, 'aria-label': 'Filter tools', oninput: () => clear(out, grid(search(q.value, list))) })
  clear(out, grid(list))
  return h('div', { class: 'container' },
    h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'Home'), icon('chevron-right'), h('span', c.title)),
    h('div', { class: 'page-head' },
      h('div', { class: 'tile lg', style: { '--c': c.color } }, icon(c.icon)),
      h('div', { class: 'head-text' }, h('h1', c.title), h('p', `${c.blurb} ${list.length} tools.`))),
    chips(id),
    h('div', { style: 'margin:6px 0 16px;max-width:420px' }, q),
    out)
}

function toolView(t) {
  setMeta(t.name, t.desc)
  const c = catById.get(t.cat)
  const body = h('div', { class: 'tool-body' })
  const related = readyFirst(toolsIn(t.cat).filter((x) => x.id !== t.id && x.module !== t.module)).slice(0, 8)
  const view = h('div', { class: 'container' },
    h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'Home'), icon('chevron-right'), h('a', { href: `#/c/${c.id}` }, c.title), icon('chevron-right'), h('span', t.name)),
    h('div', { class: 'page-head' },
      h('div', { class: 'tile lg', style: { '--c': c.color } }, icon(t.icon)),
      h('div', { class: 'head-text' },
        h('h1', t.name), h('p', t.desc),
        h('div', { class: 'badges' }, modeBadge(t), !t.ready && h('span', { class: 'badge soon' }, icon('hammer'), 'Coming soon'),
          t.mode === 'ai' && h('button', { type: 'button', class: 'badge', style: 'cursor:pointer', onclick: () => ai.openSettings() }, icon('key-round'), 'AI settings'))),
      h('div', { class: 'head-actions' },
        favButton(t, 'icon-btn'),
        button('', { icon: 'link', variant: 'ghost', ariaLabel: 'Copy link to this tool', onClick: () => navigator.clipboard.writeText(location.href).then(() => toast('Link copied', 'success')) }))),
    body,
    related.length ? section(`More ${c.name} tools`, null, related, h('a', { href: `#/c/${c.id}` }, 'View all', icon('arrow-right'))) : null)

  recent = [t.id, ...recent.filter((x) => x !== t.id)].slice(0, 12)
  store.save('recent', recent)

  if (!t.ready) {
    const alt = search(t.name.split(' ').slice(0, 2).join(' ')).filter((x) => x.ready && x.id !== t.id).slice(0, 6)
    body.append(h('div', { class: 'panel stack' },
      alert('info', h('strong', 'This tool is being built.'), ' It will appear here soon. Meanwhile, try one of these:'),
      alt.length ? grid(alt) : h('p', { class: 'muted' }, 'Browse the category below for similar tools.')))
    return view
  }

  const controller = new AbortController()
  body.append(h('div', { class: 'empty' }, h('span', { class: 'spinner' }), 'Loading tool...'))
  teardown = () => controller.abort()
  import(new URL(`../packs/${t.pack}/${t.module}.js`, import.meta.url).href)
    .then(async (mod) => {
      if (controller.signal.aborted) return
      clear(body)
      const ret = await mod.mount(body, { tool: t, params: t.params || {}, signal: controller.signal })
      if (typeof ret === 'function') {
        if (controller.signal.aborted) ret()
        else teardown = () => { controller.abort(); ret() }
      }
    })
    .catch((err) => {
      console.error(err)
      if (controller.signal.aborted) return
      clear(body, alert('error', h('strong', 'This tool failed to load. '), errorMessage(err), ' ',
        h('a', { class: 'link', href: `${REPO}/issues/new?title=${encodeURIComponent(`Tool broken: ${t.id}`)}`, target: '_blank', rel: 'noopener' }, 'Report it')))
    })
  return view
}

function notFound() {
  setMeta('Not found')
  return h('div', { class: 'container' },
    h('div', { class: 'page-head', style: 'padding-top:40px' }, h('div', { class: 'head-text' }, h('h1', 'Page not found'), h('p', 'That tool or page does not exist. Try searching instead.'))),
    button('Search tools', { icon: 'search', variant: 'primary', onClick: openPalette }))
}

// ---------- Router ----------
function route() {
  teardown?.()
  teardown = null
  const path = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('?')[0]
  const render = () => {
    let view
    if (!path) view = homeView()
    else if (path.startsWith('c/')) view = categoryView(path.slice(2))
    else if (byId.has(path)) view = toolView(byId.get(path))
    else view = notFound()
    clear(app, view)
    app.focusSearch = view.focusSearch
    window.scrollTo(0, 0)
  }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (document.startViewTransition && !reduce && !document.hidden && app.childElementCount) {
    const vt = document.startViewTransition(render)
    for (const p of [vt.ready, vt.finished, vt.updateCallbackDone]) p?.catch(() => {})
  } else render()
}

// ---------- Command palette ----------
let palette
function openPalette() {
  if (palette?.open) return
  const list = h('ul', { class: 'palette-list', role: 'listbox' })
  let items = [], sel = 0
  const input = h('input', { type: 'search', placeholder: 'Search tools...', 'aria-label': 'Search tools', autocomplete: 'off', oninput: () => { sel = 0; render() } })
  const go = (t) => { palette.close(); location.hash = `#/${t.id}` }
  function render() {
    const v = input.value.trim()
    items = v ? search(v).slice(0, 40) : [...new Set([...recent, ...POPULAR])].map((id) => byId.get(id)).filter(Boolean).slice(0, 14)
    clear(list, items.length ? items.map((t, i) => h('li', { role: 'option', 'aria-selected': String(i === sel) },
      h('a', { href: `#/${t.id}`, onclick: (e) => { e.preventDefault(); go(t) }, onmousemove: () => { if (sel !== i) { sel = i; mark() } } },
        h('div', { class: 'tile', style: { '--c': color(t) } }, icon(t.icon)),
        h('div', { class: 't' }, h('b', t.name), h('span', t.desc)),
        !t.ready ? h('span', { class: 'badge soon' }, 'Soon') : h('span', { class: 'cat' }, catById.get(t.cat)?.name))))
      : h('li', { class: 'palette-empty' }, 'No matching tools'))
  }
  const mark = () => [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === sel)))
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); mark(); list.children[sel]?.scrollIntoView({ block: 'nearest' }) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); mark(); list.children[sel]?.scrollIntoView({ block: 'nearest' }) }
    else if (e.key === 'Enter' && items[sel]) { e.preventDefault(); go(items[sel]) }
  })
  palette = h('dialog', { class: 'palette', 'aria-label': 'Search tools', onclose: () => palette.remove() },
    h('div', { class: 'palette-input' }, icon('search'), input, h('kbd', 'Esc')),
    list,
    h('div', { class: 'palette-foot' }, h('span', h('kbd', '↑'), ' ', h('kbd', '↓'), ' to navigate'), h('span', h('kbd', 'Enter'), ' to open')))
  palette.addEventListener('click', (e) => { if (e.target === palette) palette.close() })
  document.body.append(palette)
  render()
  palette.showModal()
  input.focus()
}

// ---------- Boot ----------
function setTheme(theme) {
  document.documentElement.dataset.theme = theme
  store.save('theme', theme)
  document.getElementById('theme-toggle')?.replaceChildren(icon(theme === 'dark' ? 'sun' : 'moon'))
}

document.getElementById('search-open').addEventListener('click', openPalette)
document.getElementById('ai-open').addEventListener('click', () => ai.openSettings())
document.getElementById('theme-toggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'))
document.getElementById('theme-toggle').replaceChildren(icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon'))
for (const el of document.querySelectorAll('[data-icon]')) el.replaceChildren(icon(el.dataset.icon))
document.getElementById('footer-count').textContent = `${TOOLS.length} tools`

document.addEventListener('keydown', (e) => {
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]')
  if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
    e.preventDefault()
    if (e.key === '/' && app.focusSearch) app.focusSearch()
    else openPalette()
  }
})
window.addEventListener('hashchange', route)
route()
