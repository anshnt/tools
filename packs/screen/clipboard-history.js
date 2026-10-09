// Clipboard history: remembers text and images you paste here or read from the clipboard, with search, pins and copy-again.
import { h, icon, button, busy, toast, copyText, toggle, input, segmented, clear, download, debounce } from '../../lib/ui.js'
import { persisted } from '../../lib/store.js'
import { toCanvas, loadImage, toBlob } from '../../lib/image.js'
import { baseCss, injectCss, listen, relTime, isTyping, parseColor, unsupported } from './_shared.js'

const MAX_ITEMS = 120, MAX_IMAGES = 24, MAX_TEXT = 200_000

/** What kind of thing is this text? 'url' | 'email' | 'color' | 'number' | 'code' | 'text' */
export function classify(t) {
  const s = t.trim()
  if (/^https?:\/\/[^\s]+$/i.test(s)) return 'url'
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s)) return 'email'
  if (/^(#[0-9a-f]{3,8}|(rgb|hsl|oklch)a?\([^)]*\))$/i.test(s) && parseColor(s)) return 'color'
  if (/^[-+]?[\d,]*\.?\d+(e[-+]?\d+)?$/i.test(s)) return 'number'
  if (/[{};]\s*$/m.test(s) && /\n/.test(s) || /^\s*(const|let|var|function|import|class|def|SELECT|INSERT|<\w+)/m.test(s)) return 'code'
  return 'text'
}
const KIND = { url: ['Link', 'link'], email: ['Email', 'mail'], color: ['Color', 'palette'], number: ['Number', 'hash'], code: ['Code', 'code'], text: ['Text', 'text'], image: ['Image', 'image'] }

const CSS = `
.t-ch .drop{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:16px 18px;border-radius:var(--radius-lg);border:1.5px dashed var(--border-strong);background:var(--surface-2);transition:border-color .2s,background .2s}
.t-ch .drop.over{border-color:var(--accent);background:var(--accent-soft)}
.t-ch .drop .grow{flex:1;min-width:200px}
.t-ch .drop kbd,.t-ch kbd{font:600 12px var(--mono);padding:2px 7px;border-radius:6px;border:1px solid var(--border-strong);border-bottom-width:2px;background:var(--surface)}
.t-ch .toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.t-ch .toolbar .input{flex:1;min-width:180px}
.t-ch .list{display:grid;gap:10px}
.t-ch .it{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:6px 14px;align-items:start;padding:12px 14px;border-radius:var(--radius);border:1px solid var(--border);background:var(--surface);box-shadow:var(--shadow-sm);animation:sc-fade .35s var(--ease) both;transition:border-color .2s,box-shadow .2s}
.t-ch .it:hover{border-color:var(--border-strong);box-shadow:var(--shadow)}
.t-ch .it.pinned{border-color:color-mix(in srgb,var(--accent) 45%,var(--border));background:linear-gradient(180deg,var(--accent-soft),var(--surface) 70%)}
.t-ch .kind{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;background:var(--surface-2);color:var(--muted)}
.t-ch .kind .icon{width:17px;height:17px}
.t-ch .it.pinned .kind{background:var(--accent);color:var(--accent-text)}
.t-ch .body{min-width:0}
.t-ch .txt{white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;font-size:14px;line-height:1.5;cursor:pointer}
.t-ch .txt.open{-webkit-line-clamp:unset;max-height:360px;overflow:auto;display:block}
.t-ch .txt.mono{font-family:var(--mono);font-size:12.5px}
.t-ch .meta{display:flex;gap:6px 10px;flex-wrap:wrap;align-items:center;margin-top:6px;font-size:12px;color:var(--muted)}
.t-ch .meta .tag{padding:1px 8px;border-radius:999px;background:var(--surface-2);font-weight:550}
.t-ch .acts{display:flex;gap:2px;align-items:center}
.t-ch .thumb{display:block;max-width:100%;max-height:170px;border-radius:10px;border:1px solid var(--border);background:var(--checker);cursor:zoom-in}
.t-ch .sw{display:inline-block;width:14px;height:14px;border-radius:4px;vertical-align:-2px;margin-right:6px;box-shadow:0 0 0 1px var(--border-strong)}
.t-ch mark{background:color-mix(in srgb,var(--accent) 28%,transparent);color:inherit;border-radius:3px;padding:0 1px}
.t-ch .sectionlab{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:6px 2px -2px}
@media (max-width:560px){.t-ch .it{grid-template-columns:auto minmax(0,1fr)}.t-ch .acts{grid-column:1/-1;justify-content:flex-end;flex-wrap:wrap}}
`

export function mount(root) {
  baseCss()
  injectCss('ch', CSS)
  const prefs = persisted('clipboard-history:prefs', { keep: false, auto: false, copies: true })
  const stored = persisted('clipboard-history:items', [])
  let items = prefs.get().keep ? stored.get().map((x) => ({ ...x })) : []
  let query = '', filter = 'all', uid = Date.now()
  const urls = new Map() // image id -> object URL

  // ----- model -----
  const persist = () => { if (prefs.get().keep) stored.set(items.filter((x) => x.type === 'text').map(({ id, type, text, ts, pinned }) => ({ id, type, text, ts, pinned }))) }
  function dropUrl(it) { const u = urls.get(it.id); if (u) { URL.revokeObjectURL(u); urls.delete(it.id) } }
  function trim() {
    const unpinned = items.filter((x) => !x.pinned)
    while (items.length > MAX_ITEMS && unpinned.length) { const old = unpinned.pop(); items = items.filter((x) => x !== old); dropUrl(old) }
    const imgs = items.filter((x) => x.type === 'image' && !x.pinned)
    while (imgs.length > MAX_IMAGES) { const old = imgs.pop(); items = items.filter((x) => x !== old); dropUrl(old) }
  }
  // new items go right below the pinned ones
  function insert(it) {
    const i = items.findIndex((x) => !x.pinned)
    items.splice(i < 0 ? items.length : i, 0, it)
  }
  function addText(text, source = 'paste') {
    if (!text || !text.trim()) return false
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT)
    const dupe = items.find((x) => x.type === 'text' && x.text === text)
    if (dupe) {
      dupe.ts = Date.now()
      const top = items.findIndex((x) => !x.pinned)
      const already = dupe.pinned || items.indexOf(dupe) === top
      if (!already) { items = items.filter((x) => x !== dupe); insert(dupe) }
      persist(); render()
      return !already
    }
    insert({ id: ++uid, type: 'text', text, ts: Date.now(), pinned: false, kind: classify(text), source })
    trim(); persist(); render()
    return true
  }
  async function addImage(blob, source = 'paste') {
    if (!blob || !blob.size) return false
    const it = { id: ++uid, type: 'image', blob, ts: Date.now(), pinned: false, kind: 'image', source }
    try { const img = await loadImage(blob); it.w = img.naturalWidth; it.h = img.naturalHeight } catch { toast('That image could not be read.', 'error'); return false }
    urls.set(it.id, URL.createObjectURL(blob))
    insert(it)
    trim(); render()
    return true
  }

  // ----- capture: paste, button, tab focus, copy -----
  async function takeClipboardData(dt) {
    let n = 0
    const files = [...(dt?.files || [])].filter((f) => f.type.startsWith('image/'))
    for (const f of files) if (await addImage(f)) n++
    const text = dt?.getData?.('text/plain')
    if (text && addText(text)) n++
    return n
  }
  listen(document, 'paste', async (e) => {
    const t = e.target
    if (t?.closest?.('input, textarea, [contenteditable]')) return
    e.preventDefault()
    const n = await takeClipboardData(e.clipboardData)
    toast(n ? 'Added to your clipboard history' : 'Nothing new to add (already the latest item)', n ? 'success' : 'info', 1800)
  })
  listen(document, 'copy', () => {
    if (!prefs.get().copies) return
    const sel = getSelection()?.toString()
    if (sel && !isTyping({ target: document.activeElement })) setTimeout(() => addText(sel, 'copy'), 0)
  })

  async function readNow({ quiet = false } = {}) {
    if (!navigator.clipboard?.read && !navigator.clipboard?.readText) throw new Error('Your browser cannot read the clipboard. Paste with Ctrl+V on this page instead.')
    let n = 0
    try {
      if (navigator.clipboard.read) {
        for (const item of await navigator.clipboard.read()) {
          const img = item.types.find((t) => t.startsWith('image/'))
          if (img && (await addImage(await item.getType(img), 'read'))) n++
          if (item.types.includes('text/plain') && addText(await (await item.getType('text/plain')).text(), 'read')) n++
        }
      } else if (addText(await navigator.clipboard.readText(), 'read')) n++
    } catch (e) {
      if (quiet) return 0
      throw new Error(e?.name === 'NotAllowedError' || e?.name === 'SecurityError'
        ? 'The browser did not allow reading the clipboard. Allow it in the permission prompt (or the lock icon in the address bar), or paste with Ctrl+V.'
        : `Could not read the clipboard (${e?.message || e}).`)
    }
    if (!quiet) toast(n ? `Added ${n} item${n > 1 ? 's' : ''}` : 'Nothing new on the clipboard', n ? 'success' : 'info', 1800)
    return n
  }
  const readBtn = button('Read clipboard now', { icon: 'clipboard-paste', variant: 'primary' })
  readBtn.addEventListener('click', () => busy(readBtn, () => readNow(), { label: 'Reading' }))
  let focusTimer = 0
  const onFocus = () => { if (prefs.get().auto && document.hasFocus()) { clearTimeout(focusTimer); focusTimer = setTimeout(() => readNow({ quiet: true }), 150) } }
  listen(window, 'focus', onFocus)
  listen(document, 'visibilitychange', () => { if (!document.hidden) onFocus() })

  // ----- actions -----
  async function copyItem(it) {
    if (it.type === 'text') {
      await copyText(it.text)
      return
    }
    try {
      let blob = it.blob
      if (blob.type !== 'image/png') blob = await toBlob(toCanvas(await loadImage(blob)), 'image/png')
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      toast('Image copied. Paste it anywhere.', 'success')
    } catch (e) { toast(e?.name === 'NotAllowedError' ? 'The browser blocked copying the image. Click the page and try again.' : 'Could not copy the image. Use Download instead.', 'error') }
  }
  const remove = (it) => { items = items.filter((x) => x !== it); dropUrl(it); persist(); render() }
  const pin = (it) => { it.pinned = !it.pinned; items = [...items.filter((x) => x.pinned), ...items.filter((x) => !x.pinned)]; persist(); render() }

  // ----- render -----
  const listEl = h('div', { class: 'list' })
  const countEl = h('span', { class: 'small muted' })
  function highlight(text, q) {
    if (!q) return text
    const out = [], low = text.toLowerCase(), ql = q.toLowerCase()
    let i = 0
    for (;;) {
      const j = low.indexOf(ql, i)
      if (j < 0 || out.length > 40) break
      out.push(text.slice(i, j), h('mark', text.slice(j, j + q.length)))
      i = j + q.length
    }
    out.push(text.slice(i))
    return out
  }
  const FILTERS = { all: () => true, pinned: (x) => x.pinned, text: (x) => x.type === 'text', images: (x) => x.type === 'image', links: (x) => x.kind === 'url' }
  function card(it) {
    const [label, ic] = KIND[it.kind] || KIND.text
    let bodyEl
    if (it.type === 'image') {
      bodyEl = h('img', { class: 'thumb', src: urls.get(it.id), alt: `Image from your clipboard, ${it.w} by ${it.h} pixels`, onclick: () => window.open(urls.get(it.id), '_blank', 'noopener') })
    } else {
      const clip = it.text.length > 600 || it.text.split('\n').length > 4
      bodyEl = h('div', { class: ['txt', (it.kind === 'code') && 'mono'], title: clip ? 'Click to expand' : null, onclick: (e) => { if (clip) e.currentTarget.classList.toggle('open') } },
        it.kind === 'color' ? h('span', { class: 'sw', style: { background: it.text.trim() } }) : null, highlight(it.text, query.trim()))
    }
    const meta = h('div', { class: 'meta' }, h('span', { class: 'tag' }, label), h('span', { 'data-ts': it.ts }, relTime(it.ts)),
      it.type === 'image' ? h('span', `${it.w} × ${it.h} px · ${Math.round(it.blob.size / 1024)} KB`) : h('span', `${it.text.length.toLocaleString()} chars`))
    return h('article', { class: ['it', it.pinned && 'pinned'] },
      h('div', { class: 'kind', 'aria-hidden': 'true' }, icon(it.pinned ? 'pin' : ic)),
      h('div', { class: 'body' }, bodyEl, meta),
      h('div', { class: 'acts' },
        button('', { icon: 'copy', variant: 'ghost', size: 'sm', ariaLabel: 'Copy again', title: 'Copy again', onClick: () => copyItem(it) }),
        it.kind === 'url' ? h('a', { class: 'btn btn-ghost btn-sm btn-icon', href: it.text.trim(), target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Open link', title: 'Open link' }, icon('external-link')) : null,
        it.type === 'image' ? button('', { icon: 'download', variant: 'ghost', size: 'sm', ariaLabel: 'Download image', title: 'Download', onClick: () => download(it.blob, `clipboard-${it.id}.${(it.blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`) }) : null,
        button('', { icon: it.pinned ? 'pin-off' : 'pin', variant: 'ghost', size: 'sm', ariaLabel: it.pinned ? 'Unpin' : 'Pin', title: it.pinned ? 'Unpin' : 'Pin to the top', onClick: () => pin(it) }),
        button('', { icon: 'trash-2', variant: 'ghost', size: 'sm', ariaLabel: 'Delete', title: 'Delete', onClick: () => remove(it) })))
  }
  function visible() {
    const q = query.trim().toLowerCase()
    return items.filter(FILTERS[filter]).filter((x) => !q || (x.type === 'text' && x.text.toLowerCase().includes(q)))
  }
  function render() {
    const v = visible()
    const pinnedN = items.filter((x) => x.pinned).length
    countEl.textContent = items.length ? `${v.length} of ${items.length} item${items.length > 1 ? 's' : ''}${pinnedN ? ` · ${pinnedN} pinned` : ''}` : ''
    clearBtn.disabled = !items.some((x) => !x.pinned)
    clear(listEl, v.length ? v.map(card)
      : h('div', { class: 'empty' }, icon(items.length ? 'search-x' : 'clipboard-list'),
        h('div', items.length ? 'Nothing matches your search.' : 'Nothing here yet. Press Ctrl+V on this page, or use Read clipboard now.')))
  }
  const clearBtn = button('Clear unpinned', { icon: 'trash-2', size: 'sm', variant: 'ghost', onClick: () => {
    const gone = items.filter((x) => !x.pinned)
    gone.forEach(dropUrl)
    items = items.filter((x) => x.pinned)
    persist(); render()
    toast(`Removed ${gone.length} item${gone.length === 1 ? '' : 's'}`)
  } })

  // ----- layout -----
  const drop = h('div', { class: 'drop', role: 'region', 'aria-label': 'Add to clipboard history',
    ondragover: (e) => { e.preventDefault(); drop.classList.add('over') }, ondragleave: () => drop.classList.remove('over'),
    ondrop: async (e) => { e.preventDefault(); drop.classList.remove('over'); await takeClipboardData(e.dataTransfer) } },
  h('div', { class: 'kind', style: 'width:42px;height:42px;background:var(--accent-soft);color:var(--accent);border-radius:14px;display:grid;place-items:center' }, icon('clipboard-paste')),
  h('div', { class: 'grow' }, h('strong', { style: 'display:block' }, 'Paste anywhere on this page'), h('span', { class: 'small muted' }, 'Press ', h('kbd', 'Ctrl'), ' + ', h('kbd', 'V'), ' to add text or an image. You can also drop text or images here.')),
  readBtn)
  const keepToggle = toggle('Remember text on this device', prefs.get().keep, (v) => {
    prefs.update((p) => ({ ...p, keep: v }))
    if (v) persist(); else stored.set([])
    toast(v ? 'Text items are now saved in this browser' : 'Saved history erased from this browser', 'info', 2200)
  })
  const autoToggle = toggle('Add what I copy when I come back to this tab', prefs.get().auto, (v) => { prefs.update((p) => ({ ...p, auto: v })); if (v) readNow({ quiet: true }) })
  const copyToggle = toggle('Also add text I copy from this page', prefs.get().copies, (v) => prefs.update((p) => ({ ...p, copies: v })))
  const search = input({ type: 'search', placeholder: 'Search your history', 'aria-label': 'Search clipboard history', oninput: debounce((e) => { query = e.target.value; render() }, 120) })
  const filterSeg = segmented([['all', 'All'], ['pinned', 'Pinned'], ['text', 'Text'], ['images', 'Images'], ['links', 'Links']], filter, (v) => { filter = v; render() }, 'Show')

  root.append(h('div', { class: 't-ch stack' },
    drop,
    !navigator.clipboard?.read ? unsupported('Reading the clipboard', 'The "Read clipboard now" button needs Chrome, Edge or Safari. Pasting with Ctrl+V still works everywhere.') : null,
    h('div', { class: 'toolbar' }, search, filterSeg, clearBtn),
    countEl,
    listEl,
    h('section', { class: 'panel stack' }, h('h2', 'Options'),
      keepToggle, autoToggle, copyToggle,
      h('p', { class: 'small muted' }, 'Privacy: your history lives only in this tab and is gone when you close it, unless you turn on remembering, which saves text (never images) in this browser only. Nothing is ever uploaded. Clipboards can hold passwords, so leave remembering off on shared computers.'))))
  render()
  const tick = setInterval(() => { for (const el of listEl.querySelectorAll('[data-ts]')) el.textContent = relTime(Number(el.dataset.ts)) }, 20_000)
  return () => { clearInterval(tick); clearTimeout(focusTimer); for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear() }
}
