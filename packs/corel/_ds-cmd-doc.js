// Draw Studio document commands (run functions for the metadata in _ds-keys.js): pages, file (save, export, restore) and text.
// Every document change is one store.tx, so each is one undo step. The dialogs and file work live in the shell and are reached through `app`.
import { addPage, deletePage, duplicatePage, leavesOf, movePage, setPageSize, setTextProps, toCurves } from './_ds-ops.js'
import { editableIds, topIds } from './_ds-sel.js'
import { PASS } from './_ds-cmd-edit.js'
import { docFontKey } from './_ds-text-edit.js'
import { outlineNodes } from './_ds-text.js'
import { BUNDLED_FAMILIES } from './_ds-text-model.js'
import { errorMessage, toast } from '../../lib/ui.js'
import { pickFiles } from '../../lib/files.js'

const SIZES = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96, 120, 144, 200, 300]
const REMEMBER = ['family', 'size', 'bold', 'italic', 'align', 'lh']

/** env: {store, boxOf, app, fonts, renderer} -> {impl, textProps(patch), fontChosen(family), addFont(), convertToCurves()} */
export function createDocImpl({ store, app, fonts, renderer }) {
  const say = (t) => store.setStatus(t)
  const hasSel = () => store.sel.ids.length > 0
  const page = () => store.page()
  const pages = () => store.root.pages

  // ---------- pages ----------
  const waitNote = () => say('This page is still being read. Try again in a moment.')
  function pageTx(label, fn, o = {}) {
    const p = page()
    if (!p) return false
    if (p.pending) { waitNote(); return false }
    return store.tx(label, (r) => fn(r, p), o)
  }
  const insert = (before) => () => {
    const out = {}
    if (!pageTx('Insert page', (r, p) => addPage(r, store.newId, { [before ? 'beforeId' : 'afterId']: p.id, out }), { get page() { return out.id } })) say('A drawing holds at most 300 pages.')
  }
  const swap = () => pageTx('Switch orientation', (r, p) => setPageSize(r, [p.id], p.h, p.w))

  // ---------- text ----------
  function remember(patch) {
    const keep = {}
    for (const k of REMEMBER) if (k in patch) keep[k] = patch[k]
    if ('font' in patch) keep.font = patch.font || undefined
    if (Object.keys(keep).length) store.setPref('text', { ...store.prefs.text, ...keep })
  }
  /** Apply text properties to the selected text (groups included), and remember them for the next new text. */
  function textProps(patch) {
    app.commitEdits?.()
    const ids = editableIds(store)
    const leaves = leavesOf(ids.map((id) => store.find(id).node)).filter((n) => n.t === 'text')
    remember(patch)
    if (patch.family) fonts.needBundled([patch.family])
    if (!leaves.length) { store.emit('prefs', patch); return false }
    return store.tx(`Text ${Object.keys(patch).filter((k) => k !== 'font')[0] || 'style'}`, (r) => setTextProps(r, ids, patch, { widthOf: (n) => renderer.textWidth(n) }), { merge: `text-${Object.keys(patch).join(',')}` })
  }
  function fontChosen(family) {
    if (!family) return
    textProps({ family, font: docFontKey(store, fonts, family) })
  }
  const firstText = () => leavesOf(editableIds(store).map((id) => store.find(id).node)).find((n) => n.t === 'text') || { ...store.prefs.text }
  const sizeStep = (dir) => () => {
    const cur = firstText().size || 24
    const next = dir > 0 ? SIZES.find((s) => s > cur + 0.01) ?? cur + 50 : [...SIZES].reverse().find((s) => s < cur - 0.01) ?? Math.max(1, cur / 2)
    textProps({ size: next })
  }
  async function addFont() {
    app.commitEdits?.()
    const [file] = await pickFiles({ accept: '.ttf,.otf,.woff,.woff2,font/*' })
    if (!file) return
    try {
      const { key, rec } = await fonts.addFile(file)
      textProps({ family: rec.family, font: key })
      toast(`Added ${rec.family}. It is saved inside the drawing when you save as PDF, AI or SVG, and used for text outlines.`, 'success')
    } catch (e) { toast(errorMessage(e), 'error') }
  }
  /** Text becomes curves (exact outlines from an embedded font, a bundled font otherwise); shapes keep only their curve. */
  async function convertToCurves() {
    app.commitEdits?.()
    if (!hasSel()) { say('Select text or a shape first.'); return }
    const ids = topIds(store, editableIds(store))
    if (!ids.length) { say('Locked objects cannot be converted. Unlock them in the Objects docker.'); return }
    const leaves = leavesOf(ids.map((id) => store.find(id).node))
    const texts = leaves.filter((l) => l.t === 'text' && /\S/.test(l.str))
    const shapes = leaves.some((l) => l.t === 'path' && (l.shape || l.sm))
    if (!texts.length && !shapes) { say('There is nothing to convert here. Text and shapes become curves.'); return }
    let made = new Map(), kept = 0
    if (texts.length) {
      say('Converting text to curves')
      try { const r = await outlineNodes(texts, store.root.fonts); made = r.map; kept = r.kept } catch (e) { toast(errorMessage(e), 'error'); return }
    }
    if (!ids.every((id) => store.find(id)?.node)) return // the drawing changed while the fonts loaded
    const swapped = texts.filter((n) => made.has(n.id) && n.font == null && !BUNDLED_FAMILIES.includes(n.family)).length
    store.tx('Convert to curves', (r) => toCurves(r, ids, made))
    say(kept ? `${kept} text object${kept === 1 ? ' stays' : 's stay'} as text because the outline fonts lack some characters.` : swapped ? 'Converted. The font file is not in the drawing, so a similar font was used for the letter shapes.' : 'Converted to curves.')
  }

  const canText = () => { const ids = editableIds(store); return ids.length === 1 && store.find(ids[0])?.node?.t === 'text' }
  const toggle = (key) => () => textProps({ [key]: !firstText()[key] })
  const impl = {
    'file.save': { run: () => app.save(), enabled: () => app.hasDoc() },
    'file.saveAs': { run: () => app.saveAs('cdr'), enabled: () => app.hasDoc() },
    'file.export': { run: () => app.saveAs('png'), enabled: () => app.hasDoc() },
    'file.exportSel': { run: () => app.saveAs('png', { selection: true }), enabled: () => app.hasDoc() && hasSel() },
    'file.restore': { run: () => app.restore(), enabled: () => true },
    'file.exportNotes': { run: () => app.exportNotes(), enabled: () => app.hasExportNotes() },
    'page.insertAfter': { run: insert(false) },
    'page.insertBefore': { run: insert(true) },
    'page.duplicate': { run: () => { const out = {}; pageTx('Duplicate page', (r, p) => duplicatePage(r, p.id, store.newId, { out }), { get page() { return out.id } }) } },
    'page.delete': { run: () => { if (pages().length < 2) { say('A drawing needs at least one page.'); return } pageTx('Delete page', (r, p) => deletePage(r, p.id)) }, enabled: () => pages().length > 1 },
    'page.rename': { run: () => app.renamePage(store.pageIndex) },
    'page.moveLeft': { run: () => pageTx('Move page', (r, p) => movePage(r, p.id, store.pageIndex - 1)), enabled: () => store.pageIndex > 0 },
    'page.moveRight': { run: () => pageTx('Move page', (r, p) => movePage(r, p.id, store.pageIndex + 1)), enabled: () => store.pageIndex < pages().length - 1 },
    'page.setup': { run: () => app.pageSetup() },
    'page.orientation': { run: swap },
    'object.toCurves': { run: convertToCurves, enabled: hasSel },
    'text.toCurves': { run: convertToCurves, enabled: hasSel },
    'text.edit': { run: () => { const id = editableIds(store)[0]; if (!canText()) return PASS; store.emit('edittext', id); return undefined }, enabled: canText, passWhenDisabled: true },
    'text.bold': { run: toggle('bold') }, 'text.italic': { run: toggle('italic') },
    'text.alignLeft': { run: () => textProps({ align: 'left' }) }, 'text.alignCenter': { run: () => textProps({ align: 'center' }) }, 'text.alignRight': { run: () => textProps({ align: 'right' }) },
    'text.larger': { run: sizeStep(1) }, 'text.smaller': { run: sizeStep(-1) },
    'text.addFont': { run: addFont },
  }
  return { impl, textProps, fontChosen, addFont, convertToCurves }
}
