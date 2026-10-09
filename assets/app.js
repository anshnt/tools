// App shell: hash router (#/, #/c/<category>, #/<tool-id>), home, category and tool pages, command palette, motion.
import { CATEGORIES, TOOLS, byId, catById, toolsIn, POPULAR, MODES, search } from './catalog.js'
import { h, icon, clear, button, toast, alert, errorMessage, debounce, copyText, runCleanups, modal, matchesAccept, fileType, formatBytes } from '../lib/ui.js'
import * as store from '../lib/store.js'
import * as ai from '../lib/ai.js'

const REPO = 'https://github.com/anshnt/tools'
const app = document.getElementById('app')
const announcer = document.getElementById('route-announcer')
const favs = new Set(store.load('favs', []))
let recent = store.load('recent', []).filter((id) => byId.get(id)?.ready)
let teardown = null
let routeToken = 0
const scrollPos = new Map()
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)')
const canHover = matchMedia('(hover: hover)').matches

const color = (t) => catById.get(t.cat)?.color
const readyFirst = (list) => [...list.filter((t) => t.ready), ...list.filter((t) => !t.ready)]
const READY = TOOLS.filter((t) => t.ready).length
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
const safe = (fn) => { try { fn?.() } catch (e) { console.error(e) } }

// ---------- Pieces ----------
function favButton(t, cls = 'fav-btn') {
  return h('button', {
    type: 'button', class: cls, 'aria-pressed': favs.has(t.id), 'aria-label': `Favorite ${t.name}`, title: 'Favorite', dataset: { fav: t.id },
    onclick: (e) => {
      e.preventDefault(); e.stopPropagation()
      favs.has(t.id) ? favs.delete(t.id) : favs.add(t.id)
      store.save('favs', [...favs])
      for (const el of document.querySelectorAll(`[data-fav="${t.id}"]`)) el.setAttribute('aria-pressed', String(favs.has(t.id)))
      toast(favs.has(t.id) ? `Added ${t.name} to favorites` : 'Removed from favorites')
    },
  }, icon('star'))
}

function modeBadge(t, withLabel = true) {
  const m = MODES[t.mode] || MODES.local
  return h('span', { class: ['badge', m.cls], title: m.title }, icon(m.icon), withLabel && m.label)
}

/** Pinterest-style card: tinted art header of varying height, title, description, badges. */
function toolCard(t, i = 0) {
  const hs = hash(t.id)
  return h('article', {
    class: ['tool-card', !t.ready && 'soon', 'reveal'],
    style: { '--c': color(t), '--i': i % 12, '--art': `${[78, 104, 132][hs % 3]}px`, '--rot': `${(hs % 40) - 20}deg`, '--bx': `${20 + (hs % 60)}%` },
  },
  h('div', { class: 'card-art', 'aria-hidden': 'true' }, h('span', { class: 'art-blob' }), h('span', { class: 'art-ring' }), h('div', { class: 'art-icon' }, icon(t.icon))),
  h('div', { class: 'card-body' },
    h('h3', h('a', { class: 'stretch', href: `#/${t.id}` }, t.name)),
    h('p', t.desc),
    (t.mode !== 'local' || !t.ready) && h('div', { class: 'card-badges' }, t.mode !== 'local' && modeBadge(t), !t.ready && h('span', { class: 'badge soon' }, icon('hammer'), 'Coming soon'))),
  favButton(t))
}

const masonry = (list) => h('div', { class: 'masonry' }, list.map(toolCard))

function section(title, ic, list, more, kicker) {
  if (!list.length) return null
  return h('section', { class: 'section' },
    h('div', { class: 'section-head' },
      h('div', kicker && h('span', { class: 'kicker' }, kicker), h('h2', ic && icon(ic), title)),
      more || null),
    masonry(list))
}

function chips(active) {
  const nav = h('nav', { class: 'chips', 'aria-label': 'Categories' },
    h('a', { class: ['chip', !active && 'active'], href: '#/', 'aria-current': !active ? 'page' : null }, icon('layout-grid'), 'All', h('span', { class: 'count' }, TOOLS.length)),
    CATEGORIES.map((c) => h('a', { class: ['chip', active === c.id && 'active'], href: `#/c/${c.id}`, style: { '--c': c.color }, 'aria-current': active === c.id ? 'page' : null },
      icon(c.icon), c.name, h('span', { class: 'count' }, toolsIn(c.id).length))))
  if (active) requestAnimationFrame(() => {
    const a = nav.querySelector('.active')
    if (a) nav.scrollLeft = a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2
  })
  return h('div', { class: 'chips-wrap' }, nav)
}

function setMeta(title, desc) {
  document.title = title ? `${title} · Tools` : 'Tools · Every everyday tool, in your browser'
  document.querySelector('meta[name="description"]')?.setAttribute('content', desc || 'Free, private online tools for PDFs, images, video, data, text, calculators and more. Most run entirely in your browser.')
}

function countUp(el, to) {
  if (reduceMotion.matches) { el.textContent = to.toLocaleString(); return }
  const start = performance.now()
  const step = (now) => {
    const p = Math.min(1, (now - start) / 1100)
    el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))).toLocaleString()
    if (p < 1 && el.isConnected) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

const ROTATE = ['PDFs.', 'photos.', 'videos.', 'spreadsheets.', 'taxes.', 'resumes.', 'passwords.', 'everything.']

// ---------- Views ----------
function homeView() {
  setMeta()
  const results = h('div', { 'aria-live': 'polite' })
  const q = h('input', {
    type: 'search', placeholder: innerWidth < 520 ? `Search ${TOOLS.length} tools` : 'Try "compress pdf", "emi", "heic to jpg"...', 'aria-label': 'Search tools', autocomplete: 'off', enterkeyhint: 'search',
    oninput: debounce(() => renderResults(), 60),
    onkeydown: (e) => {
      if (e.key !== 'Enter' || !q.value.trim()) return
      const first = search(q.value)[0]
      if (first) location.hash = `#/${first.id}`
    },
  })
  const word = h('span', { class: 'rotator' }, ROTATE[0])
  let wi = 0
  const rot = setInterval(() => {
    if (!word.isConnected) return clearInterval(rot)
    if (reduceMotion.matches || document.hidden) return
    wi = (wi + 1) % ROTATE.length
    word.classList.add('out')
    setTimeout(() => { word.textContent = ROTATE[wi]; word.classList.remove('out') }, 280)
  }, 2200)

  const popular = readyFirst(POPULAR.map((id) => byId.get(id)).filter(Boolean))
  const marqueeTools = readyFirst(TOOLS).slice(0, 36)
  const marquee = (list, reverse) => h('div', { class: ['marquee', reverse && 'reverse'], 'aria-hidden': 'true' },
    h('div', { class: 'marquee-track' }, [...list, ...list].map((t) =>
      h('a', { class: 'mq-pill', href: `#/${t.id}`, tabindex: -1, style: { '--c': color(t) } }, h('span', { class: 'mq-dot' }, icon(t.icon)), t.name))))

  const counter = h('b', '0')
  countUp(counter, READY < TOOLS.length ? READY : TOOLS.length)

  const browse = h('div',
    favs.size ? section('Your favorites', 'star', [...favs].map((id) => byId.get(id)).filter(Boolean), null, 'Pinned by you') : null,
    recent.length ? section('Jump back in', 'history', recent.map((id) => byId.get(id)).filter(Boolean).slice(0, 8), null, 'Recently used') : null,
    section('Popular right now', 'flame', popular, h('a', { class: 'more-link', href: '#all', onclick: (e) => { e.preventDefault(); document.getElementById('all')?.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth' }) } }, 'Every tool', icon('arrow-down')), 'Most used'),
    h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('div', h('span', { class: 'kicker' }, `${CATEGORIES.length} categories`), h('h2', icon('blocks'), 'Find your toolbox'))),
      h('div', { class: 'bento' }, CATEGORIES.map((c, i) => {
        const list = readyFirst(toolsIn(c.id))
        return h('a', { class: ['bento-card', 'reveal', `b${i}`], href: `#/c/${c.id}`, style: { '--c': c.color, '--i': i % 8 } },
          h('div', { class: 'bento-glow', 'aria-hidden': 'true' }),
          h('div', { class: 'bento-top' }, h('div', { class: 'tile lg' }, icon(c.icon)), h('span', { class: 'bento-count' }, list.length, h('small', ' tools'))),
          h('div', { class: 'bento-text' }, h('h3', c.title), h('p', c.blurb)),
          h('ul', { class: 'bento-tools' }, list.slice(0, i === 0 ? 14 : i === 2 || i === 14 ? 8 : i === 1 || i === 15 ? 6 : 4).map((t) => h('li', t.name))),
          h('span', { class: 'bento-go', 'aria-hidden': 'true' }, icon('arrow-up-right')))
      }))),
    h('section', { class: 'section', id: 'all' },
      h('div', { class: 'section-head' }, h('div', h('span', { class: 'kicker' }, 'A to Z'), h('h2', icon('list'), 'Every tool'))),
      h('div', { class: 'directory' }, CATEGORIES.map((c) => h('details', { style: { '--c': c.color }, open: !matchMedia('(max-width: 720px)').matches },
        h('summary', h('h3', icon(c.icon), c.name, h('span', { class: 'count' }, toolsIn(c.id).length))),
        [...toolsIn(c.id)].sort((a, b) => a.name.localeCompare(b.name)).map((t) => h('a', { href: `#/${t.id}`, class: !t.ready && 'soon' }, t.name, !t.ready && h('span', { class: 'sr-only' }, ' (coming soon)'))))))))

  function renderResults() {
    const v = q.value.trim()
    browse.hidden = !!v
    if (!v) return clear(results)
    const found = search(v)
    clear(results, h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', icon('search'), `${found.length} result${found.length === 1 ? '' : 's'} for "${v}"`)),
      found.length ? masonry(found.slice(0, 60)) : h('div', { class: 'empty' }, icon('search-x'), h('div', 'No tools match. Try another word, like "convert" or "calculator".'), h('a', { class: 'link', href: requestUrl(v), target: '_blank', rel: 'noopener' }, 'Request this tool'))))
    reveal(results)
  }

  const floaters = ['file-text', 'image', 'music', 'sheet', 'qr-code', 'calculator', 'shield', 'sparkles', 'scissors', 'languages']
  const view = h('div', { class: 'home' },
    h('section', { class: 'hero' },
      h('div', { class: 'hero-bg', 'aria-hidden': 'true' }, h('i', { class: 'orb o1' }), h('i', { class: 'orb o2' }), h('i', { class: 'orb o3' }), h('i', { class: 'grid-fade' })),
      h('div', { class: 'floaters', 'aria-hidden': 'true' }, floaters.map((f, i) => h('span', { class: `floater f${i}`, style: { '--c': CATEGORIES[(i * 3) % CATEGORIES.length].color } }, icon(f)))),
      h('div', { class: 'container hero-inner' },
        h('span', { class: 'pill' }, h('span', { class: 'pulse' }),
          READY < TOOLS.length ? h('span', counter, ` tools live · ${TOOLS.length - READY} more landing soon`) : h('span', counter, ' free tools · no sign-up')),
        h('h1', h('span', { class: 'line' }, 'One tab for all your'), h('span', { class: 'line gradient-text' }, word)),
        h('p', { class: 'lede' }, 'PDFs, images, video, data, text, calculators, India forms and AI helpers. Most tools run entirely on your device, so your files never leave it.'),
        h('div', { class: 'hero-search' }, icon('search'), q, canHover && h('kbd', '/')),
        h('div', { class: 'hero-stats' },
          h('span', icon('shield-check'), 'Private by design'),
          h('span', icon('zap'), 'Instant, no uploads'),
          h('span', icon('smartphone'), 'Phone & desktop'),
          h('span', icon('moon'), 'Light & dark')),
        canHover && h('p', { class: 'drop-hint' }, icon('mouse-pointer-click'), 'Tip: drop or paste any file on this page to see what you can do with it'))),
    marquee(marqueeTools.slice(0, 18)),
    marquee(marqueeTools.slice(18, 36), true),
    h('div', { class: 'container' }, chips(null), results, browse))
  view.focusSearch = () => q.focus()
  return view
}

function categoryView(id) {
  const c = catById.get(id)
  if (!c) return notFound()
  setMeta(c.title, c.blurb)
  const list = readyFirst(toolsIn(id))
  const ready = list.filter((t) => t.ready).length
  const out = h('div', { 'aria-live': 'polite' })
  const show = (items) => { clear(out, items.length ? masonry(items) : h('div', { class: 'empty' }, icon('search-x'), h('div', 'No tools match that filter.'))); reveal(out) }
  const q = h('input', { class: 'input', type: 'search', placeholder: `Filter ${list.length} ${c.name} tools`, 'aria-label': 'Filter tools', oninput: () => show(q.value.trim() ? search(q.value, list) : list) })
  show(list)
  return h('div', { class: 'page cat-page', style: { '--c': c.color } },
    h('div', { class: 'page-hero' }, h('div', { class: 'page-hero-bg', 'aria-hidden': 'true' }),
      h('div', { class: 'container' },
        h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), icon('chevron-right'), h('span', { 'aria-current': 'page' }, c.title)),
        h('div', { class: 'page-head' },
          h('div', { class: 'tile xl' }, icon(c.icon)),
          h('div', { class: 'head-text' }, h('h1', { tabindex: -1 }, c.title), h('p', c.blurb),
            h('div', { class: 'badges' }, h('span', { class: 'badge' }, `${list.length} tools`), ready < list.length && h('span', { class: 'badge local' }, `${ready} ready`)))))),
    h('div', { class: 'container' }, chips(id), h('div', { class: 'filter-row' }, q), out))
}

function toolView(t) {
  setMeta(t.name, t.desc)
  const c = catById.get(t.cat)
  const body = h('div', { class: 'tool-body' })
  const related = readyFirst(toolsIn(t.cat).filter((x) => x.id !== t.id && x.module !== t.module)).slice(0, 8)
  const view = h('div', { class: 'page tool-page', style: { '--c': c.color } },
    h('div', { class: 'page-hero compact' }, h('div', { class: 'page-hero-bg', 'aria-hidden': 'true' }),
      h('div', { class: 'container' },
        h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), icon('chevron-right'), h('a', { href: `#/c/${c.id}` }, c.title), icon('chevron-right'), h('span', { 'aria-current': 'page' }, t.name)),
        h('div', { class: 'page-head' },
          h('div', { class: 'tile xl' }, icon(t.icon)),
          h('div', { class: 'head-text' },
            h('h1', { tabindex: -1 }, t.name), h('p', t.desc),
            h('div', { class: 'badges' }, modeBadge(t), !t.ready && h('span', { class: 'badge soon' }, icon('hammer'), 'Coming soon'),
              t.mode === 'ai' && h('button', { type: 'button', class: 'badge badge-btn', onclick: () => ai.openSettings() }, icon('key-round'), 'AI settings'))),
          h('div', { class: 'head-actions' },
            favButton(t, 'icon-btn'),
            navigator.share && button('', { icon: 'share-2', variant: 'ghost', ariaLabel: 'Share this tool', onClick: () => navigator.share({ title: `${t.name} · Tools`, text: t.desc, url: location.href }).catch(() => {}) }),
            button('', { icon: 'link', variant: 'ghost', ariaLabel: 'Copy link to this tool', onClick: () => copyText(location.href) }))))),
    h('div', { class: 'container' },
      body,
      related.length ? section(`More ${c.name} tools`, null, related, h('a', { class: 'more-link', href: `#/c/${c.id}` }, 'View all', icon('arrow-right'))) : null))

  if (!t.ready) {
    const alt = toolsIn(t.cat).filter((x) => x.ready && x.id !== t.id).slice(0, 6)
    body.append(h('div', { class: 'panel stack soon-panel' },
      alert('info', h('strong', 'This tool is being built.'), ' It will appear here soon.', alt.length ? ' Meanwhile, these work today:' : ''),
      alt.length ? masonry(alt) : null))
    return view
  }

  recent = [t.id, ...recent.filter((x) => x !== t.id)].slice(0, 12)
  store.save('recent', recent)

  const controller = new AbortController()
  body.append(h('div', { class: 'empty loading' }, h('span', { class: 'spinner' }), 'Loading tool...'))
  teardown = () => controller.abort()
  import(new URL(`../packs/${t.pack}/${t.module}.js`, import.meta.url).href)
    .then(async (mod) => {
      if (controller.signal.aborted) return
      clear(body)
      const ret = await mod.mount(body, { tool: t, params: t.params || {}, signal: controller.signal })
      if (pendingFiles && !controller.signal.aborted) giveFiles(body, pendingFiles, t)
      pendingFiles = null
      if (typeof ret === 'function') {
        if (controller.signal.aborted) safe(ret)
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
    h('div', { class: 'page-head', style: 'padding-top:48px' }, h('div', { class: 'head-text' }, h('h1', { tabindex: -1 }, 'Page not found'), h('p', 'That tool or page does not exist. Try searching instead.'))),
    button('Search tools', { icon: 'search', variant: 'primary', onClick: openPalette }))
}

// ---------- Motion ----------
let io
function reveal(root = app) {
  const els = root.querySelectorAll('.reveal:not(.in)')
  if (reduceMotion.matches || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return }
  io ??= new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) }
  }, { rootMargin: '0px 0px -4% 0px' })
  els.forEach((e) => io.observe(e))
}

// Cursor spotlight on cards (sets --mx/--my).
if (canHover) {
  document.addEventListener('pointermove', (e) => {
    const card = e.target.closest?.('.tool-card, .bento-card')
    if (!card) return
    const r = card.getBoundingClientRect()
    card.style.setProperty('--mx', `${e.clientX - r.left}px`)
    card.style.setProperty('--my', `${e.clientY - r.top}px`)
  }, { passive: true })
}

// Scroll progress + header state.
const progressBar = document.getElementById('scroll-progress')
const header = document.querySelector('.site-header')
const onScroll = () => {
  const max = document.documentElement.scrollHeight - innerHeight
  progressBar.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`
  header.classList.toggle('scrolled', scrollY > 8)
}
addEventListener('scroll', onScroll, { passive: true })

// ---------- Router ----------
function route(e) {
  const isRoute = !location.hash || location.hash.startsWith('#/')
  if (!isRoute && app.childElementCount) return // in-page anchors like #all, not routes
  if (e?.oldURL) scrollPos.set(new URL(e.oldURL).hash || '#/', scrollY)
  const token = ++routeToken
  const t = teardown
  teardown = null
  safe(t)
  runCleanups()
  let path
  try { path = isRoute ? decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('?')[0] : '' } catch { path = '\u0000' }
  const initial = !app.childElementCount
  const render = () => {
    if (token !== routeToken) return
    let view
    if (!path) view = homeView()
    else if (path.startsWith('c/')) view = categoryView(path.slice(2))
    else if (byId.has(path)) view = toolView(byId.get(path))
    else view = notFound()
    clear(app, view)
    app.focusSearch = view.focusSearch
    const key = location.hash || '#/'
    const restore = (!path || path.startsWith('c/')) && scrollPos.has(key)
    window.scrollTo(0, restore ? scrollPos.get(key) : 0)
    reveal()
    onScroll()
    if (!initial) {
      app.querySelector('h1')?.focus({ preventScroll: true })
      announcer.textContent = document.title
    }
  }
  if (document.startViewTransition && !reduceMotion.matches && !document.hidden && !initial) {
    const vt = document.startViewTransition(render)
    vt.updateCallbackDone.catch((err) => console.error(err))
    vt.ready.catch(() => {})
    vt.finished.catch(() => {})
  } else render()
}

// ---------- Command palette ----------
let palette
function openPalette() {
  if (palette?.open) return
  const list = h('ul', { class: 'palette-list', role: 'listbox', id: 'palette-list', 'aria-label': 'Tools' })
  let items = [], sel = 0
  const input = h('input', {
    type: 'search', placeholder: `Search ${TOOLS.length} tools...`, 'aria-label': 'Search tools', autocomplete: 'off', role: 'combobox',
    'aria-controls': 'palette-list', 'aria-expanded': 'true', 'aria-autocomplete': 'list', enterkeyhint: 'go',
    oninput: () => { sel = 0; render() },
  })
  const go = (t) => { palette.close(); if (t.run) t.run(); else location.hash = `#/${t.id}` }
  function render() {
    const v = input.value.trim()
    const acts = actions().filter((a) => !v || `${a.name} ${a.tags}`.toLowerCase().includes(v.toLowerCase()))
    items = v ? [...acts, ...search(v).slice(0, 40)] : [...acts, ...[...new Set([...recent, ...POPULAR])].map((id) => byId.get(id)).filter(Boolean).slice(0, 12)]
    clear(list, items.length ? items.map((t, i) => h('li', {
      role: 'option', id: `po-${i}`, 'aria-selected': i === sel, onclick: () => go(t), onpointermove: () => { if (sel !== i) { sel = i; mark() } },
    },
    h('div', { class: 'tile', style: { '--c': t.run ? 'var(--accent)' : color(t) } }, icon(t.icon)),
    h('div', { class: 't' }, h('b', t.name), h('span', t.desc)),
    t.run ? h('span', { class: 'cat' }, 'Action') : !t.ready ? h('span', { class: 'badge soon' }, 'Soon') : h('span', { class: 'cat' }, catById.get(t.cat)?.name)))
      : h('li', { class: 'palette-empty', role: 'presentation' }, 'No matching tools'))
    mark()
  }
  const mark = () => {
    ;[...list.children].forEach((li, i) => li.getAttribute('role') === 'option' && li.setAttribute('aria-selected', String(i === sel)))
    if (items[sel]) input.setAttribute('aria-activedescendant', `po-${sel}`)
    else input.removeAttribute('aria-activedescendant')
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); mark(); list.children[sel]?.scrollIntoView({ block: 'nearest' }) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); mark(); list.children[sel]?.scrollIntoView({ block: 'nearest' }) }
    else if (e.key === 'Enter' && items[sel]) { e.preventDefault(); go(items[sel]) }
  })
  palette = h('dialog', { class: 'palette', 'aria-label': 'Search tools', onclose: () => palette.remove() },
    h('div', { class: 'palette-input' }, icon('search'), input,
      canHover ? h('kbd', 'Esc') : button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: 'Close search', onClick: () => palette.close() })),
    list,
    canHover && h('div', { class: 'palette-foot' }, h('span', h('kbd', '↑'), ' ', h('kbd', '↓'), ' navigate'), h('span', h('kbd', 'Enter'), ' open'), h('span', h('kbd', 'Esc'), ' close')))
  palette.addEventListener('click', (e) => { if (e.target === palette) palette.close() })
  document.body.append(palette)
  render()
  palette.showModal()
  input.focus()
}

// ---------- Boot ----------
const themeMeta = document.querySelector('meta[name="theme-color"]')
function applyThemeChrome(theme) {
  themeMeta?.setAttribute('content', theme === 'dark' ? '#08080c' : '#fbfbfd')
  document.getElementById('theme-toggle')?.replaceChildren(icon(theme === 'dark' ? 'sun' : 'moon'))
}
function setTheme(theme) {
  const flip = () => { document.documentElement.dataset.theme = theme; applyThemeChrome(theme) }
  store.save('theme', theme)
  if (document.startViewTransition && !reduceMotion.matches && !document.hidden) document.startViewTransition(flip).ready.catch(() => {})
  else flip()
}

document.getElementById('search-open').addEventListener('click', openPalette)
document.getElementById('ai-open').addEventListener('click', () => ai.openSettings())
document.getElementById('theme-toggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'))
document.querySelector('.skip-link').addEventListener('click', (e) => { e.preventDefault(); app.focus() })
applyThemeChrome(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
for (const el of document.querySelectorAll('[data-icon]')) el.replaceChildren(icon(el.dataset.icon))
document.getElementById('footer-count').textContent = `${TOOLS.length} tools`

document.addEventListener('keydown', (e) => {
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]')
  if (e.key === '?' && !typing && !document.querySelector('dialog[open]')) { e.preventDefault(); showShortcuts(); return }
  if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
    e.preventDefault()
    if (e.key === '/' && app.focusSearch) app.focusSearch()
    else openPalette()
  }
})
// ---------- Smart file drop: drop or paste a file anywhere ----------
// On a tool page the file goes to that tool's dropzone; elsewhere we suggest tools for it and hand the file over.
let pendingFiles = null
const SUGGEST = {
  pdf: ['merge-pdf', 'compress-pdf', 'pdf-to-word', 'split-pdf', 'pdf-to-image', 'sign-pdf', 'rotate-pdf', 'pdf-ocr', 'pdf-to-text', 'protect-pdf', 'pdf-summary', 'pdf-qa'],
  image: ['compress-image', 'resize-image', 'image-to-kb', 'remove-background', 'image-to-pdf', 'image-converter', 'crop-image', 'image-to-text', 'exif-remover', 'passport-photo', 'image-upscaler', 'watermark-image'],
  heic: ['heic-to-jpg', 'compress-image', 'resize-image', 'image-to-pdf', 'exif-remover', 'image-to-kb'],
  video: ['compress-video', 'video-to-mp3', 'trim-video', 'video-to-gif', 'video-to-mp4', 'video-to-text', 'mute-video', 'change-video-resolution', 'subtitle-generator'],
  audio: ['audio-converter', 'trim-audio', 'compress-audio', 'speech-to-text', 'merge-audio', 'audio-volume', 'video-to-text'],
  sheet: ['csv-viewer', 'csv-to-excel', 'excel-to-csv', 'excel-to-pdf', 'chart-maker', 'csv-cleaner', 'remove-duplicate-rows', 'data-statistics', 'sql-to-csv', 'ai-spreadsheet-analysis'],
  word: ['word-to-pdf', 'word-to-txt', 'word-to-markdown', 'document-summarizer', 'document-translator', 'office-metadata-remover'],
  slides: ['powerpoint-to-pdf', 'ppt-to-images', 'office-metadata-remover'],
  json: ['json-formatter', 'json-tree-viewer', 'json-to-csv', 'json-to-excel', 'json-schema-generator'],
  text: ['word-counter', 'text-to-pdf', 'markdown-to-pdf', 'markdown-to-word', 'subtitle-to-text', 'diff-checker', 'clean-text'],
  zip: ['unzip-files', 'file-inspector'],
  any: ['file-inspector', 'file-checksum', 'file-to-base64', 'zip-files', 'hex-viewer'],
}
function fileKind(f) {
  const t = fileType(f), n = f.name.toLowerCase()
  if (t === 'application/pdf') return 'pdf'
  if (/hei[cf]/.test(t)) return 'heic'
  if (t.startsWith('image/')) return 'image'
  if (t.startsWith('video/')) return 'video'
  if (t.startsWith('audio/')) return 'audio'
  if (/\.(csv|tsv|xlsx|xls|ods)$/.test(n)) return 'sheet'
  if (/\.(docx|doc|odt|rtf)$/.test(n)) return 'word'
  if (/\.(pptx|ppt|odp)$/.test(n)) return 'slides'
  if (/\.json$/.test(n)) return 'json'
  if (/\.(txt|md|markdown|srt|vtt|log|html?|xml|ya?ml)$/.test(n) || t.startsWith('text/')) return 'text'
  if (/\.zip$/.test(n)) return 'zip'
  return 'any'
}

/** Give files to the first dropzone in `root` that accepts them. Returns true if one took them. */
function giveFiles(root, files, t) {
  const zone = [...root.querySelectorAll('.dropzone')].find((z) => z._take && files.some((f) => matchesAccept(f, z._accept)))
  if (zone) { zone._take(files); return true }
  toast(t ? `Choose or drop your file in ${t.name} to start.` : 'This page does not take files.')
  return false
}

function suggestFor(files) {
  const f = files[0]
  const ids = [...new Set([...SUGGEST[fileKind(f)], ...SUGGEST.any])]
  const list = ids.map((id) => byId.get(id)).filter((t) => t?.ready).slice(0, 12)
  const label = files.length > 1 ? `${files.length} files` : f.name
  const m = modal({
    title: 'What do you want to do with it?', icon: 'wand-sparkles',
    body: [
      h('div', { class: 'drop-files' }, files.slice(0, 4).map((x) => h('span', { class: 'badge' }, icon('file'), `${x.name} · ${formatBytes(x.size)}`)), files.length > 4 && h('span', { class: 'badge' }, `+${files.length - 4} more`)),
      h('div', { class: 'suggest-grid' }, list.map((t) => h('button', {
        type: 'button', class: 'suggest', style: { '--c': color(t) },
        onclick: () => { pendingFiles = files; m.close(); location.hash = `#/${t.id}` },
      }, h('div', { class: 'tile' }, icon(t.icon)), h('div', h('b', t.name), h('span', t.desc))))),
      h('p', { class: 'small muted' }, `Your ${files.length > 1 ? 'files stay' : 'file stays'} on this device until a tool says otherwise. `, h('a', { class: 'link', href: '#/', onclick: (e) => { e.preventDefault(); m.close(); openPalette() } }, 'Search all tools')),
    ],
  })
  m.el.setAttribute('aria-label', `Tools for ${label}`)
}

function handleFiles(files) {
  if (!files.length) return
  const body = document.querySelector('.tool-body')
  if (body) return giveFiles(body, files, byId.get(location.hash.slice(2).split('?')[0]))
  suggestFor(files)
}

const dropOverlay = h('div', { class: 'drop-overlay', 'aria-hidden': 'true', hidden: true }, h('div', { class: 'drop-card' }, icon('upload'), h('strong'), h('span')))
document.body.append(dropOverlay)
let dragDepth = 0
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files')
document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e) || document.querySelector('dialog[open]')) return
  if (++dragDepth === 1) {
    const onTool = !!document.querySelector('.tool-body')
    dropOverlay.querySelector('strong').textContent = onTool ? 'Drop to add it here' : 'Drop a file to see what you can do'
    dropOverlay.querySelector('span').textContent = onTool ? 'Anywhere on the page works' : 'PDFs, images, video, audio, spreadsheets, documents...'
    dropOverlay.hidden = false
  }
})
document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault() })
document.addEventListener('dragleave', (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; dropOverlay.hidden = true } })
document.addEventListener('drop', (e) => {
  dragDepth = 0
  dropOverlay.hidden = true
  if (!hasFiles(e) || e.defaultPrevented) return
  e.preventDefault()
  if (document.querySelector('dialog[open]')) return
  handleFiles([...e.dataTransfer.files])
})
document.addEventListener('paste', (e) => {
  if (e.defaultPrevented || e.target.closest?.('input, textarea, [contenteditable]') || document.querySelector('dialog[open]')) return
  if (document.querySelector('.tool-body')) return // tool pages: the dropzone paste router handles it
  const files = [...(e.clipboardData?.files || [])]
  if (files.length) { e.preventDefault(); suggestFor(files) }
})

// ---------- Quick actions, shortcuts, requests ----------
function requestUrl(q = '') {
  return `${REPO}/issues/new?title=${encodeURIComponent(`Tool request: ${q}`.trim())}&body=${encodeURIComponent('What should the tool do? Example input and output help a lot.')}`
}
function showShortcuts() {
  const k = (...keys) => h('span', keys.map((x, i) => [i ? ' ' : '', h('kbd', x)]))
  modal({
    title: 'Keyboard shortcuts', icon: 'keyboard',
    body: h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('tbody',
      [[k('Ctrl', 'K'), 'Search tools and actions from anywhere'], [k('/'), 'Jump to the search box'], [k('?'), 'Show this list'], [k('Esc'), 'Close a dialog'],
        [k('↑', '↓', 'Enter'), 'Move through search results and open one']].map(([a, b]) => h('tr', h('td', a), h('td', b)))))),
  })
}
let installEvent = null
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform))
async function installApp() {
  if (installEvent) {
    installEvent.prompt()
    const { outcome } = await installEvent.userChoice.catch(() => ({}))
    if (outcome === 'accepted') { installEvent = null; installBtn.hidden = true }
    return
  }
  modal({
    title: 'Install Tools', icon: 'download',
    body: [h('p', isIOS ? 'In Safari, tap the Share button, then "Add to Home Screen".' : 'Use your browser menu and choose "Install app" or "Add to Home screen". In Chrome and Edge it is also the install icon in the address bar.'),
      h('p', { class: 'small muted' }, 'Once installed, Tools opens in its own window and the tools you have used keep working offline.')],
  })
}
function actions() {
  const dark = document.documentElement.dataset.theme === 'dark'
  const ready = TOOLS.filter((x) => x.ready)
  return [
    { id: 'act-theme', name: dark ? 'Switch to light mode' : 'Switch to dark mode', desc: 'Change the colour theme', icon: dark ? 'sun' : 'moon', tags: 'theme dark light mode', run: () => setTheme(dark ? 'light' : 'dark') },
    { id: 'act-ai', name: 'AI settings', desc: 'Add or change your Claude or Gemini API key', icon: 'sparkles', tags: 'ai key claude gemini settings', run: () => ai.openSettings() },
    !isStandalone() && { id: 'act-install', name: 'Install as an app', desc: 'Open Tools in its own window and use it offline', icon: 'download', tags: 'install pwa offline app home screen', run: installApp },
    { id: 'act-random', name: 'Surprise me', desc: 'Open a random tool', icon: 'shuffle', tags: 'random discover', run: () => { location.hash = `#/${ready[Math.floor(Math.random() * ready.length)].id}` } },
    { id: 'act-keys', name: 'Keyboard shortcuts', desc: 'All the keys that make this faster', icon: 'keyboard', tags: 'shortcuts keys help', run: showShortcuts },
    { id: 'act-request', name: 'Request a tool', desc: 'Suggest something new on GitHub', icon: 'message-square-plus', tags: 'request suggest feedback idea', run: () => window.open(requestUrl(), '_blank', 'noopener') },
  ].filter(Boolean)
}

// ---------- Installable app + offline ----------
const installBtn = document.getElementById('install-app')
installBtn?.addEventListener('click', installApp)
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; if (installBtn) installBtn.hidden = false })
addEventListener('appinstalled', () => { installEvent = null; if (installBtn) installBtn.hidden = true; toast('Installed. Tools now opens in its own window.', 'success') })
addEventListener('offline', () => toast('You are offline. On-device tools you have opened before keep working.'))
addEventListener('online', () => toast('Back online', 'success'))
if ('serviceWorker' in navigator && (location.protocol === 'https:' || new URLSearchParams(location.search).has('sw'))) {
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url).href, { scope: new URL('../', import.meta.url).href }).catch((e) => console.warn('Offline mode unavailable:', e))
}

window.addEventListener('hashchange', route)
route()
