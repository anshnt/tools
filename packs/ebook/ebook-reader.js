// E-book reader. Opens EPUB, KEPUB, MOBI, AZW3, FB2, HTMLZ, TXTZ, PDB and comics (CBZ, CBR, CB7) on this device.
// Paginated or scrolling text, table of contents, font size, light / dark / sepia, and it remembers where you stopped.
import { h, icon, dropzone, button, busy, progress, alert, segmented, clear, errorMessage, onCleanup, toast } from '../../lib/ui.js'
import { pickFiles } from '../../lib/files.js'
import { load, save } from '../../lib/store.js'
import { bookKey } from './_book.js'
import { READ_EXTS } from './_read.js'

const ACCEPT = [...READ_EXTS, 'fb2.zip'].map((e) => `.${e}`).join(',')
const THEMES = {
  light: { bg: '#ffffff', fg: '#1b1b1f', link: '#1d5fd1', muted: '#6b6b76' },
  sepia: { bg: '#f4ecd8', fg: '#433422', link: '#8a4b12', muted: '#7a6a55' },
  dark: { bg: '#15171c', fg: '#d9d9de', link: '#8ab4ff', muted: '#8b8b96' },
}
const CSS = `
.t-reader{display:flex;flex-direction:column;height:calc(100dvh - var(--header-h, 64px) - 150px);min-height:460px;border:1px solid var(--border);border-radius:16px;overflow:hidden;background:var(--surface);position:relative}
.t-reader .rd-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px 10px;border-bottom:1px solid var(--border);background:var(--surface-2)}
.t-reader .rd-title{flex:1;min-width:120px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.t-reader .rd-title small{display:block;font-weight:400;color:var(--muted);font-size:12px;overflow:hidden;text-overflow:ellipsis}
.t-reader .rd-main{flex:1;display:flex;min-height:0;position:relative}
.t-reader .rd-toc{width:280px;max-width:80%;overflow:auto;border-right:1px solid var(--border);background:var(--surface);padding:8px}
.t-reader .rd-toc[hidden]{display:none}
.t-reader .rd-toc ol{list-style:none;margin:0;padding-left:12px}
.t-reader .rd-toc > ol{padding-left:0}
.t-reader .rd-toc button{display:block;width:100%;text-align:left;background:none;border:0;border-radius:8px;padding:7px 8px;color:var(--text);cursor:pointer;font:inherit;font-size:14px;min-height:32px}
.t-reader .rd-toc button:hover{background:var(--surface-2)}
.t-reader .rd-toc button[aria-current=true]{background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent);font-weight:600}
.t-reader .rd-view{flex:1;min-width:0;position:relative;display:flex;flex-direction:column}
.t-reader iframe{flex:1;width:100%;border:0;display:block;min-height:0}
.t-reader .rd-comic{flex:1;overflow:auto;display:flex;justify-content:center;align-items:flex-start;background:#111}
.t-reader .rd-comic.page{align-items:center}
.t-reader .rd-comic img{display:block;max-width:100%}
.t-reader .rd-comic.page img{max-height:100%;object-fit:contain}
.t-reader .rd-foot{display:flex;align-items:center;gap:10px;padding:6px 12px;border-top:1px solid var(--border);background:var(--surface-2);font-size:13px;color:var(--muted)}
.t-reader .rd-foot .bar{flex:1;height:5px;border-radius:3px;background:var(--border);overflow:hidden}
.t-reader .rd-foot .bar i{display:block;height:100%;background:var(--accent);width:0}
.t-reader .rd-empty{flex:1;display:grid;place-items:center;padding:20px;overflow:auto}
.t-reader .rd-empty > div{width:min(560px,100%);display:flex;flex-direction:column;gap:14px}
.t-reader .rd-recent{font-size:13px;color:var(--muted)}
.t-reader .rd-load{position:absolute;inset:0;display:grid;place-items:center;background:color-mix(in srgb,var(--surface) 85%,transparent);z-index:5}
.t-reader .rd-load > div{width:min(360px,80%)}
.t-reader .btn-sm.on{background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent)}
@media (max-width:700px){.t-reader .rd-toc{position:absolute;inset:0 auto 0 0;z-index:4;width:85%;box-shadow:0 0 40px rgba(0,0,0,.3)}.t-reader .hide-sm{display:none}}
`
let styled = false

/** Build the document an iframe shows for one chapter. */
function chapterDoc({ body, theme, size, font, paged, imageUrl, nextHref, prevHref }) {
  const T = THEMES[theme]
  const fam = font === 'sans' ? "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" : "Georgia,'Iowan Old Style','Times New Roman',serif"
  const html = body.replace(/\bsrc="(images\/[^"]+)"/g, (_, p) => `src="${imageUrl(p.replace(/&amp;/g, '&'))}"`).replace(/<a\b([^>]*?)href="(https?:[^"]+)"/g, '<a$1href="$2" target="_blank" rel="noopener noreferrer"')
  const pagedCss = `
html{overflow:hidden;height:100%}
body{margin:0;height:100%;overflow:hidden}
#wrap{position:absolute;left:50%;top:var(--py);height:calc(100% - 2*var(--py));width:var(--w);margin-left:calc(var(--w) / -2);overflow:hidden}
#pg{height:100%;width:var(--w);column-width:var(--w);column-gap:var(--g);column-fill:auto;transition:transform .25s ease}
@media (prefers-reduced-motion:reduce){#pg{transition:none}}
img,svg,table,pre{break-inside:avoid}
img{max-height:calc(100vh - 2*var(--py) - 10px);object-fit:contain}`
  const scrollCss = 'body{max-width:42em;margin:0 auto;padding:24px 20px 80px}'
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root{color-scheme:${theme === 'dark' ? 'dark' : 'light'}}
html,body{background:${T.bg};color:${T.fg}}
body{font:${size}px/1.6 ${fam};-webkit-text-size-adjust:100%}
a{color:${T.link}} h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.2em 0 .5em} p{margin:0 0 .85em} img{max-width:100%;height:auto}
blockquote{margin:1em 1.5em;color:${T.muted}} pre{white-space:pre-wrap;font-size:.9em} table{border-collapse:collapse} td,th{border:1px solid ${T.muted};padding:4px 8px}
hr{border:0;border-top:1px solid ${T.muted};margin:1.5em 0} .navrow{display:flex;justify-content:space-between;gap:12px;margin-top:2.5em} .navrow a{padding:8px 14px;border:1px solid ${T.muted};border-radius:10px;text-decoration:none}
${paged ? pagedCss : scrollCss}
</style></head><body>${paged ? `<div id="wrap"><div id="pg">${html}</div></div>` : `${html}<div class="navrow"><span>${prevHref ? `<a href="${prevHref}">Previous chapter</a>` : ''}</span><span>${nextHref ? `<a href="${nextHref}">Next chapter</a>` : ''}</span></div>`}</body></html>`
}

export function mount(root, { signal }) {
  if (!styled) { document.head.append(h('style', CSS)); styled = true }
  const prefs = { size: 18, theme: 'light', mode: 'page', font: 'serif', rtl: false, fit: 'page', ...load('ebook-reader', {}) }
  const persist = () => save('ebook-reader', prefs)
  let book = null, key = '', ch = 0, frac = 0, imgUrls = new Map(), comicUrl = null, pageIdx = 0
  let frame = null, pageNo = 0, pageTotal = 1, tocOpen = false, loadId = 0

  const prog = progress('Opening')
  const loading = h('div', { class: 'rd-load', hidden: true }, h('div', prog.el))
  const titleEl = h('div', { class: 'rd-title' }, 'No book open')
  const mk = (ic, label, fn, extra = {}) => button('', { icon: ic, variant: 'ghost', size: 'sm', ariaLabel: label, title: label, onClick: fn, ...extra })
  const tocBtn = mk('list', 'Table of contents (T)', () => toggleToc())
  const openBtn = button('Open', { icon: 'folder-open', size: 'sm', onClick: async () => { const [f] = await pickFiles({ accept: ACCEPT }); if (f) open(f) } })
  const smaller = mk('a-arrow-down', 'Smaller text (-)', () => setSize(prefs.size - 1))
  const larger = mk('a-arrow-up', 'Larger text (+)', () => setSize(prefs.size + 1))
  const themeSeg = segmented([['light', 'Light'], ['sepia', 'Sepia'], ['dark', 'Dark']], prefs.theme, (v) => { prefs.theme = v; persist(); rerender() }, 'Theme')
  const modeSeg = segmented([['page', 'Pages'], ['scroll', 'Scroll']], prefs.mode, (v) => { prefs.mode = v; persist(); rerender() }, 'Reading mode')
  const fontBtn = mk('type', 'Switch serif and sans', () => { prefs.font = prefs.font === 'serif' ? 'sans' : 'serif'; persist(); rerender() })
  const rtlBtn = mk('arrow-left-right', 'Right to left (manga)', () => { prefs.rtl = !prefs.rtl; persist(); rtlBtn.classList.toggle('on', prefs.rtl) })
  const fitBtn = mk('scan', 'Fit page or fit width', () => { prefs.fit = prefs.fit === 'page' ? 'width' : 'page'; persist(); showComic() })
  const prevBtn = mk('chevron-left', 'Previous page', () => step(-1))
  const nextBtn = mk('chevron-right', 'Next page', () => step(1))
  const bar = h('div', { class: 'rd-bar' }, tocBtn, titleEl, openBtn, smaller, larger, fontBtn, rtlBtn, fitBtn, themeSeg, modeSeg, prevBtn, nextBtn)
  const toc = h('nav', { class: 'rd-toc', 'aria-label': 'Table of contents', hidden: true })
  const view = h('div', { class: 'rd-view' })
  const foot = h('div', { class: 'rd-foot' }, h('span', { class: 'pos' }, ''), h('div', { class: 'bar' }, h('i')), h('span', { class: 'pct' }, ''))
  const zone = dropzone({ accept: ACCEPT, multiple: false, label: 'Drop a book here or click to choose', hint: 'EPUB, KEPUB, MOBI, AZW3, FB2, HTMLZ, TXTZ, PDB, CBZ, CBR, CB7. The book stays on your device.', onFiles: ([f]) => open(f) })
  const empty = h('div', { class: 'rd-empty' }, h('div', zone, h('div', { class: 'rd-recent' }, 'Your reading place is saved on this device, so open the same file again later and it continues where you stopped. Copy-protected (DRM) books cannot be opened.'), h('div', { class: 'rd-err' })))
  const app = h('div', { class: 't-reader' }, bar, h('div', { class: 'rd-main' }, toc, view, loading), foot)
  root.append(app)
  rtlBtn.classList.toggle('on', prefs.rtl)

  const revokeImages = () => { for (const u of imgUrls.values()) URL.revokeObjectURL(u); imgUrls = new Map(); if (comicUrl) URL.revokeObjectURL(comicUrl); comicUrl = null }
  onCleanup(revokeImages)
  signal?.addEventListener('abort', revokeImages)

  function chrome() {
    const comic = book?.kind === 'comic'
    const has = !!book
    for (const b of [smaller, larger, fontBtn, themeSeg, modeSeg]) b.hidden = !has || comic
    fitBtn.hidden = rtlBtn.hidden = !has || !comic
    tocBtn.hidden = !has || comic
    prevBtn.hidden = nextBtn.hidden = !has
    foot.hidden = !has
    if (!has) { clear(view, empty); titleEl.replaceChildren('No book open') }
  }
  const setProgress = (label, p) => {
    foot.querySelector('.pos').textContent = label
    foot.querySelector('.bar i').style.width = `${Math.round(p * 100)}%`
    foot.querySelector('.pct').textContent = `${Math.round(p * 100)}%`
  }
  function toggleToc(force) {
    tocOpen = force ?? !tocOpen
    toc.hidden = !tocOpen
    tocBtn.classList.toggle('on', tocOpen)
  }
  function drawToc() {
    const items = book.toc.length ? book.toc : book.chapters.map((c, i) => ({ title: c.title || `Part ${i + 1}`, ch: i, children: [] }))
    const ol = (list) => h('ol', list.map((t) => h('li', h('button', { type: 'button', dataset: { ch: t.ch }, onclick: () => { goTo(t.ch, 0, t.frag); if (matchMedia('(max-width:700px)').matches) toggleToc(false) } }, t.title || 'Untitled'), t.children?.length ? ol(t.children) : null)))
    clear(toc, ol(items))
  }
  const markToc = () => { for (const b of toc.querySelectorAll('button')) b.setAttribute('aria-current', String(Number(b.dataset.ch) === ch)) }

  async function open(file) {
    const id = ++loadId
    loading.hidden = false
    prog.set(null, 'Reading the book')
    revokeImages()
    try {
      const { readBook } = await import('./_read.js')
      const b = await readBook(file, { onProgress: (p, t) => prog.set(p, t || 'Reading the book') })
      if (id !== loadId) return
      book = b
      key = bookKey(b, file.name, file.size)
      const saved = load(`ebook-pos-${key}`, null)
      ch = saved?.ch ?? 0
      frac = saved?.frac ?? 0
      pageIdx = saved?.page ?? 0
      if (book.kind === 'reflow' && ch >= book.chapters.length) ch = 0
      titleEl.replaceChildren(book.meta.title || file.name, h('small', book.meta.authors.join(', ') || file.name))
      chrome()
      if (book.kind === 'comic') { drawToc0(); showComic() } else { drawToc(); rerender(); markToc() }
      if (saved) toast('Continuing where you stopped', 'info')
    } catch (e) {
      if (id !== loadId) return
      console.error(e)
      if (!book) { chrome(); empty.querySelector('.rd-err').replaceChildren(alert('error', errorMessage(e))) } else toast(errorMessage(e), 'error')
    } finally {
      if (id === loadId) { loading.hidden = true; prog.hide() }
    }
  }
  const drawToc0 = () => clear(toc)

  // ----- text books
  const imageUrl = (name) => {
    if (!imgUrls.has(name)) {
      const im = book.images.get(name)
      imgUrls.set(name, im ? URL.createObjectURL(new Blob([im.data], { type: im.type })) : '')
    }
    return imgUrls.get(name)
  }
  function rerender() {
    if (!book) return
    if (book.kind === 'comic') { showComic(); return }
    showChapter(ch, frac)
  }
  function showChapter(i, f = 0, anchor = '') {
    ch = Math.max(0, Math.min(book.chapters.length - 1, i))
    const paged = prefs.mode === 'page'
    const doc = chapterDoc({
      body: book.chapters[ch].body, theme: prefs.theme, size: prefs.size, font: prefs.font, paged, imageUrl,
      nextHref: ch < book.chapters.length - 1 ? `chapter-${ch + 2}.xhtml` : '', prevHref: ch > 0 ? `chapter-${ch}.xhtml` : '',
    })
    frame = h('iframe', { title: 'Book text', sandbox: 'allow-same-origin', srcdoc: doc, tabindex: -1 })
    view.style.background = THEMES[prefs.theme].bg
    clear(view, frame)
    frame.addEventListener('load', () => afterLoad(f, anchor))
    markToc()
    paintBars()
  }
  function afterLoad(f, anchor) {
    const d = frame.contentDocument
    if (!d) return
    d.addEventListener('keydown', onKey)
    d.addEventListener('click', (e) => {
      const a = e.target.closest?.('a')
      if (a) {
        const href = a.getAttribute('href') || ''
        if (/^https?:/i.test(href)) return
        e.preventDefault()
        const m = href.match(/^chapter-(\d+)\.xhtml(?:#(.*))?$/)
        if (m) goTo(Number(m[1]) - 1, 0, m[2] || '')
        else if (href.startsWith('#')) d.getElementById(href.slice(1))?.scrollIntoView()
        return
      }
      if (prefs.mode === 'page') {
        const x = e.clientX / frame.clientWidth
        if (x < 0.28) step(-1)
        else if (x > 0.72) step(1)
      }
    })
    let sx = null
    d.addEventListener('pointerdown', (e) => { sx = e.clientX })
    d.addEventListener('pointerup', (e) => { if (sx != null && prefs.mode === 'page' && Math.abs(e.clientX - sx) > 60) step(e.clientX < sx ? 1 : -1); sx = null })
    if (prefs.mode === 'page') {
      layoutPages(d)
      new ResizeObserver(() => { const keep = pageNo / Math.max(1, pageTotal); layoutPages(d); goPage(Math.round(keep * pageTotal), false) }).observe(frame)
      if (anchor) { const el = d.getElementById(anchor); if (el) { const p = Math.floor((el.getBoundingClientRect().left - d.getElementById('pg').getBoundingClientRect().left) / stepPx(d)); goPage(Math.max(0, p), false); return } }
      goPage(f === 1 ? pageTotal - 1 : Math.round(f * pageTotal), false)
    } else {
      const sc = d.scrollingElement
      if (anchor) d.getElementById(anchor)?.scrollIntoView()
      else sc.scrollTop = f === 1 ? sc.scrollHeight : f * (sc.scrollHeight - sc.clientHeight)
      d.addEventListener('scroll', () => { const max = sc.scrollHeight - sc.clientHeight; frac = max > 0 ? sc.scrollTop / max : 1; paintBars(); remember() }, { passive: true })
      frac = f
      paintBars()
    }
    frame.focus()
  }
  const stepPx = (d) => d.getElementById('pg').clientWidth + gap(d)
  const gap = (d) => parseFloat(getComputedStyle(d.documentElement).getPropertyValue('--g')) || 0
  function layoutPages(d) {
    const W = frame.clientWidth
    const padX = Math.max(18, Math.min(48, W * 0.06))
    const w = Math.min(W - padX * 2, prefs.size * 38)
    d.documentElement.style.setProperty('--w', `${Math.max(120, w)}px`)
    d.documentElement.style.setProperty('--g', `${padX * 2}px`)
    d.documentElement.style.setProperty('--py', `${Math.max(14, Math.min(34, frame.clientHeight * 0.05))}px`)
    const pg = d.getElementById('pg')
    pageTotal = Math.max(1, Math.round((pg.scrollWidth + gap(d)) / (pg.clientWidth + gap(d))))
  }
  function goPage(p, animate = true) {
    const d = frame?.contentDocument
    const pg = d?.getElementById('pg')
    if (!pg) return
    pageNo = Math.max(0, Math.min(pageTotal - 1, p))
    pg.style.transition = animate ? '' : 'none'
    pg.style.transform = `translateX(${-pageNo * stepPx(d)}px)`
    frac = pageTotal > 1 ? pageNo / pageTotal : 0
    paintBars()
    remember()
  }
  function step(dir) {
    if (!book) return
    if (book.kind === 'comic') { goComic(pageIdx + (prefs.rtl ? -dir : dir)); return }
    if (prefs.mode === 'page') {
      if (dir > 0 && pageNo >= pageTotal - 1) { if (ch < book.chapters.length - 1) showChapter(ch + 1, 0) }
      else if (dir < 0 && pageNo <= 0) { if (ch > 0) showChapter(ch - 1, 1) }
      else goPage(pageNo + dir)
    } else {
      const d = frame?.contentDocument
      const sc = d?.scrollingElement
      if (!sc) return
      const atEnd = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4
      if (dir > 0 && atEnd && ch < book.chapters.length - 1) showChapter(ch + 1, 0)
      else if (dir < 0 && sc.scrollTop <= 0 && ch > 0) showChapter(ch - 1, 1)
      else sc.scrollBy({ top: dir * sc.clientHeight * 0.9, behavior: 'smooth' })
    }
  }
  function goTo(i, f = 0, anchor = '') {
    if (book.kind === 'comic') return
    if (i === ch && frame?.contentDocument && prefs.mode !== 'page' && anchor) { frame.contentDocument.getElementById(anchor)?.scrollIntoView(); return }
    showChapter(i, f, anchor)
  }
  function paintBars() {
    if (!book || book.kind === 'comic') return
    const n = book.chapters.length
    const within = prefs.mode === 'page' ? (pageNo + 1) / pageTotal : frac
    const overall = (ch + Math.min(1, within)) / n
    setProgress(`Chapter ${ch + 1} of ${n}${prefs.mode === 'page' ? ` · page ${pageNo + 1} of ${pageTotal}` : ''}`, overall)
  }
  let rememberT = 0
  function remember() {
    clearTimeout(rememberT)
    rememberT = setTimeout(() => { if (book) save(`ebook-pos-${key}`, book.kind === 'comic' ? { page: pageIdx } : { ch, frac }) }, 300)
  }
  function setSize(n) {
    prefs.size = Math.max(12, Math.min(34, n))
    persist()
    const keep = prefs.mode === 'page' ? pageNo / Math.max(1, pageTotal) : frac
    showChapter(ch, keep)
  }

  // ----- comics
  const comicBox = h('div', { class: 'rd-comic' })
  function showComic() {
    if (!book || book.kind !== 'comic') return
    comicBox.className = `rd-comic ${prefs.fit === 'page' ? 'page' : ''}`
    clear(view, comicBox)
    view.style.background = '#111'
    goComic(pageIdx)
  }
  function goComic(i) {
    pageIdx = Math.max(0, Math.min(book.pages.length - 1, i))
    const p = book.pages[pageIdx]
    if (comicUrl) URL.revokeObjectURL(comicUrl)
    comicUrl = URL.createObjectURL(new Blob([p.data], { type: p.type }))
    const img = h('img', { src: comicUrl, alt: `Page ${pageIdx + 1}`, style: prefs.fit === 'width' ? 'width:100%' : '' })
    img.addEventListener('click', (e) => { const x = e.offsetX / img.clientWidth; step(x < 0.4 ? -1 : 1) })
    comicBox.replaceChildren(img)
    comicBox.scrollTop = 0
    setProgress(`Page ${pageIdx + 1} of ${book.pages.length}`, (pageIdx + 1) / book.pages.length)
    remember()
  }

  // ----- keyboard
  function onKey(e) {
    if (!book || e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key
    if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) { e.preventDefault(); step(1) }
    else if (k === 'ArrowLeft' || k === 'PageUp' || (k === ' ' && e.shiftKey)) { e.preventDefault(); step(-1) }
    else if (k === '+' || k === '=') setSize(prefs.size + 1)
    else if (k === '-') setSize(prefs.size - 1)
    else if (k === 't' || k === 'T') toggleToc()
    else if (k === 'Home') { e.preventDefault(); book.kind === 'comic' ? goComic(0) : showChapter(0, 0) }
    else if (k === 'End') { e.preventDefault(); book.kind === 'comic' ? goComic(book.pages.length - 1) : showChapter(book.chapters.length - 1, 0) }
  }
  const docKey = (e) => { if (e.target.closest?.('input, textarea, select, [contenteditable]')) return; onKey(e) }
  document.addEventListener('keydown', docKey)
  onCleanup(() => document.removeEventListener('keydown', docKey))

  chrome()
}
