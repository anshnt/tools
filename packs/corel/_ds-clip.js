// Draw Studio clipboard: copy, cut and paste inside the editor and through the system clipboard.
// The browser's own copy, cut and paste events on the app root do the work (Ctrl+C, Ctrl+X and Ctrl+V keys are NOT consumed by the key table),
// so they only fire while focus is inside the app. Copy keeps deep-cloned objects inside the app (exact objects, new ids on paste) and also puts
// the selection on the system clipboard as SVG text. Paste order: (1) an image file becomes a bitmap, (2) text equal to our own last SVG is an
// internal paste, (3) SVG text is read through the sandboxed SVG reader and placed as a group, (4) other text becomes artistic text at the
// centre of the view, (5) otherwise the internal clipboard. Each paste is offset by the duplicate distance, Paste in place by nothing.
import { pageToSvg } from './_svgout.js'
import { cloneNode, collect, deleteIds, leavesOf, transformItem } from './_ds-ops.js'
import { topIds, editableIds } from './_ds-sel.js'
import { placeNodes } from './_ds-tools-draw.js'
import { LIMITS, scrubSvgText } from './_ds-doc.js'
import { TEXT_DEFAULTS, docFontKey } from './_ds-text-edit.js'
import { fromUnit } from './_ds-units.js'
import { boxUnion } from './_ds-hit.js'
import { mul, scale, translate } from './_model.js'
import { toast, errorMessage } from '../../lib/ui.js'

const TYPING = 'input, select, textarea, [contenteditable]:not([contenteditable="false"])'
const MAX_SVG = 30 * 1024 * 1024

/** env: {store, boxOf, assets, fonts, view, wrap, host} -> {copy(), cut(), paste(inPlace), has(), dispose()} */
export function createClipboard({ store, boxOf, assets, fonts, view, wrap, host }) {
  let held = null // {nodes, svg, n}
  let inPlaceAt = 0
  const say = (t) => store.setStatus(t)
  const hasNodes = () => store.sel.ids.some((id) => store.find(id)?.node)

  /** Remember the selection (deep copies are made at paste time). Returns the SVG text for the system clipboard, or null when nothing is selected. */
  function remember() {
    const ids = topIds(store, store.sel.ids.filter((id) => store.find(id)?.node))
    if (!ids.length) return null
    const nodes = collect(store.root, new Set(ids)).map((f) => f.node)
    const page = store.page()
    let svg = ''
    try { svg = pageToSvg({ w: page.w, h: page.h, items: leavesOf(nodes).filter((l) => l.t !== 'image') }, { unit: 'mm' }) } catch { svg = '' }
    held = { nodes, svg, n: 0 }
    return svg
  }

  // ---------- copy and cut ----------
  function onCopy(e, cut) {
    if (e.target.closest?.(TYPING) || !hasNodes()) return
    const svg = remember()
    if (svg == null) return
    e.preventDefault()
    e.clipboardData?.setData('text/plain', svg)
    if (cut) {
      const ids = topIds(store, editableIds(store))
      if (ids.length) store.tx('Cut', (r) => deleteIds(r, ids), { sel: [] }); else say('Locked objects cannot be cut. They were copied.')
    }
    say(cut ? 'Cut' : `Copied ${held.nodes.length} object${held.nodes.length === 1 ? '' : 's'}`)
  }
  const onCopyEv = (e) => onCopy(e, false)
  const onCutEv = (e) => onCopy(e, true)
  /** Menu route: the browser copy command fires the same event; when it does not (no focus rights) copy inside the app and try the clipboard API. */
  function viaCommand(cut) {
    if (!hasNodes()) { say('Select an object first.'); return }
    let fired = false
    const mark = () => { fired = true }
    wrap.addEventListener(cut ? 'cut' : 'copy', mark, { once: true, capture: true })
    host.focus({ preventScroll: true })
    let ok = false
    try { ok = document.execCommand(cut ? 'cut' : 'copy') } catch { ok = false }
    wrap.removeEventListener(cut ? 'cut' : 'copy', mark, { capture: true })
    if (fired && ok !== false) return
    const svg = remember()
    if (svg == null) return
    navigator.clipboard?.writeText?.(svg).catch(() => {})
    if (cut) { const ids = topIds(store, editableIds(store)); if (ids.length) store.tx('Cut', (r) => deleteIds(r, ids), { sel: [] }) }
    say(cut ? 'Cut' : 'Copied')
  }

  // ---------- paste ----------
  /** Deep copies with fresh ids; pictures whose data is gone and fonts the drawing lacks are dropped. */
  function fresh(nodes) {
    const fix = (n) => {
      if (n.t === 'group') { const items = n.items.map(fix).filter(Boolean); return items.length ? { ...n, items } : null }
      if (n.t === 'image') return assets.has(n.asset) ? n : null
      if (n.t === 'text' && n.font != null && !store.root.fonts[n.font]) { const { font: _f, glyphs: _g, ...rest } = n; return rest }
      return n
    }
    return nodes.map((n) => fix(n)).filter(Boolean).map((n) => cloneNode(n, store.newId))
  }
  const pageCentre = () => { const p = store.page(); return { x: p.w / 2, y: p.h / 2 } }
  const boxOfAll = (nodes) => boxUnion(nodes.map((n) => boxOf(n)))
  /** Move the nodes so their box is centred on the page (and scaled down to fit 90 percent when larger). */
  function centre(nodes, fit) {
    const b = boxOfAll(nodes)
    if (!b) return nodes
    const page = store.page(), c = pageCentre()
    const s = fit ? Math.min(1, (0.9 * page.w) / Math.max(b.w, 1e-6), (0.9 * page.h) / Math.max(b.h, 1e-6)) : 1
    const M = mul(translate(c.x, c.y), mul(scale(s), translate(-(b.x + b.w / 2), -(b.y + b.h / 2))))
    const memo = new Map()
    return nodes.map((n) => transformItem(n, M, { memo }))
  }

  function pasteInternal(inPlace) {
    if (!held) { say('There is nothing to paste yet. Copy an object first.'); return false }
    const nodes = fresh(held.nodes)
    if (!nodes.length) { say('The copied objects are no longer available.'); return false }
    const d = inPlace ? 0 : fromUnit(store.prefs.dupOffset ?? 5, 'mm') * ++held.n
    const memo = new Map()
    const moved = d ? nodes.map((n) => transformItem(n, [1, 0, 0, 1, d, d], { memo })) : nodes
    if (placeNodes(store, moved, inPlace ? 'Paste in place' : 'Paste')) say(`Pasted ${moved.length} object${moved.length === 1 ? '' : 's'}`)
    return true
  }
  async function pasteImage(file) {
    const a = await assets.addBlob(file, file.name || 'Pasted picture')
    const page = store.page()
    let w = a.w * 0.75, h = a.h * 0.75
    const k = Math.min(1, (0.9 * page.w) / w, (0.9 * page.h) / h)
    w *= k; h *= k
    const c = pageCentre()
    const node = { id: store.newId(), t: 'image', name: 'Bitmap', asset: a.id, w: a.w, h: a.h, m: [w, 0, 0, h, c.x - w / 2, c.y - h / 2], opacity: 1 }
    if (placeNodes(store, [node], 'Paste picture')) say('Pasted a picture')
  }
  async function pasteSvg(text, inPlace) {
    if (text.length > MAX_SVG) throw new Error('That SVG is too large to paste here.')
    const { svgToDoc } = await import('./_svgin.js')
    const { normalizeDoc } = await import('./_ds-open.js')
    const raw = await svgToDoc(scrubSvgText(text))
    const { doc } = await normalizeDoc(raw, { assets, title: 'Pasted', source: 'svg', name: 'Pasted SVG', freshIds: () => store.newId() })
    const strip = (n) => {
      if (n.t === 'group') return { ...n, items: n.items.map(strip) }
      if (n.t === 'text' && n.font != null && !store.root.fonts[n.font]) { const { font: _f, glyphs: _g, ...rest } = n; return rest }
      return n
    }
    const items = doc.pages[0].layers.filter((l) => !l.hidden).flatMap((l) => l.items.filter((n) => !n.hidden)).map(strip)
    if (!items.length) { say('There was nothing to paste in that SVG.'); return }
    let g = { id: store.newId(), t: 'group', name: 'Pasted SVG', items }
    if (!inPlace) g = centre([g], true)[0]
    if (placeNodes(store, [g], 'Paste SVG')) say('Pasted the SVG as a group')
  }
  function pasteText(text) {
    const d = { ...TEXT_DEFAULTS, ...store.prefs.text }
    const key = d.font && store.root.fonts[d.font] ? d.font : docFontKey(store, fonts, d.family)
    const s = view.size(), p = view.toPage(s.w / 2, s.h / 2)
    const str = text.replace(/\r/g, '').slice(0, LIMITS.str)
    const node = { id: store.newId(), t: 'text', str, family: d.family, ...(key ? { font: key } : {}), size: d.size, bold: !!d.bold, italic: !!d.italic, fill: d.fill, opacity: 1, m: [1, 0, 0, 1, p.x, p.y], lh: d.lh, align: d.align }
    fonts.needBundled([d.family])
    if (placeNodes(store, [node], 'Paste text')) say('Pasted text')
  }

  /** The shared paste route: {files, text} from the event or the clipboard API. */
  async function run({ files = [], text = '', inPlace = false }) {
    try {
      const page = store.page()
      if (!page || page.pending) { say('This page is still being read. Try again in a moment.'); return }
      const img = files.find((f) => /^image\//.test(f.type))
      if (img) return await pasteImage(img)
      const t = text.trim()
      if (held && t && t === held.svg.trim()) return pasteInternal(inPlace)
      if (/^(<\?xml|<svg[\s>])/i.test(t) || (/^<!doctype\s+svg/i.test(t))) return await pasteSvg(t, inPlace)
      if (t) return pasteText(text)
      return pasteInternal(inPlace)
    } catch (e) { toast(errorMessage(e), 'error') }
  }
  function onPaste(e) {
    if (e.target.closest?.(TYPING)) return
    const cd = e.clipboardData
    if (!cd) return
    e.preventDefault()
    let files = [...(cd.files || [])]
    if (!files.length) files = [...(cd.items || [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean)
    const inPlace = Date.now() - inPlaceAt < 900
    inPlaceAt = 0 // one Ctrl+Shift+V is one paste in place
    run({ files, text: cd.getData('text/plain') || '', inPlace })
  }
  /** Menu route: read the system clipboard (the browser may ask for permission). */
  async function paste(inPlace) {
    if (!navigator.clipboard?.read) { toast('Use Ctrl+V to paste here.'); return pasteInternal(inPlace) }
    try {
      const items = await navigator.clipboard.read()
      const files = []
      let text = ''
      for (const it of items) for (const type of it.types) {
        if (type.startsWith('image/')) files.push(new File([await it.getType(type)], 'Pasted picture', { type }))
        else if (type === 'text/plain') text = await (await it.getType(type)).text()
      }
      return await run({ files, text, inPlace })
    } catch {
      if (held) return pasteInternal(inPlace)
      toast('Use Ctrl+V to paste here. The browser did not allow reading the clipboard.')
    }
  }

  const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.code === 'KeyV') inPlaceAt = Date.now() }
  wrap.addEventListener('copy', onCopyEv)
  wrap.addEventListener('cut', onCutEv)
  wrap.addEventListener('paste', onPaste)
  wrap.addEventListener('keydown', onKey, true)
  return {
    copy: () => viaCommand(false), cut: () => viaCommand(true), paste, run,
    has: () => !!held,
    dispose() { wrap.removeEventListener('copy', onCopyEv); wrap.removeEventListener('cut', onCutEv); wrap.removeEventListener('paste', onPaste); wrap.removeEventListener('keydown', onKey, true) },
  }
}
