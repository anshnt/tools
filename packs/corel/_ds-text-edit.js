// Draw Studio text editing: the in-place editor and the Text tool.
// While you type, the text is drawn by the SAME SVG text element the page uses (so what you see is what the page and the export draw), and a
// transparent <textarea> laid exactly over it supplies the keyboard, the IME, the caret and the selection. Nothing touches the document until
// the session ends (blur, Esc or another tool): one store.tx per session, so typing is ONE undo step. Empty text deletes the object.
import { h } from '../../lib/ui.js'
import { mul, translate } from './_model.js'
import { DEFAULT_LH, fontStack } from './_ds-text-model.js'
import { addLayer, boxQuad, deleteIds, replaceLeaves } from './_ds-ops.js'
import { LIMITS, insertAt } from './_ds-doc.js'
import { hitByDistance, pickFromTarget } from './_ds-hit.js'
import { isLocked } from './_ds-sel.js'

export const TEXT_DEFAULTS = { family: 'Inter', size: 24, bold: false, italic: false, align: 'left', lh: 1.2, fill: '#000000' }
const NS = 'http://www.w3.org/2000/svg'

/** The key of a font embedded in the document whose family is `family` and that loaded (so new text can use it), or null. */
export function docFontKey(store, fonts, family) {
  for (const [k, rec] of Object.entries(store.root.fonts)) if (rec.data && rec.family === family && fonts.ok(k)) return k
  return null
}

/** env: {store, view, renderer, host, stage, fonts, setTool(id)} -> {begin({id}|{p}), commit(), cancel(), overlay(g, helpers), active, textarea} */
export function createTextEditor({ store, view, renderer, host, stage, fonts, setTool }) {
  let sess = null

  function place() {
    const s = sess
    if (!s) return
    const { draft, t, ta } = s
    let bb
    try { bb = t.getBBox() } catch { bb = null }
    if (!bb) bb = { x: 0, y: -draft.size, width: 0, height: draft.size }
    const size = draft.size, lh = (draft.lh || DEFAULT_LH) * size
    const lines = draft.str.split('\n').length
    const W = Math.max(bb.width, size * 0.5) + size * 0.8, H = lines * lh
    const firstH = Math.max(1, bb.height - (lines - 1) * lh) // one line box of the font (ascent + descent), so the half-leading lines the caret up
    const top = bb.y - (lh - firstH) / 2
    const align = draft.align || 'left'
    const x0 = align === 'center' ? -W / 2 : align === 'right' ? -W : 0
    const st = ta.style
    st.width = `${W}px`; st.height = `${H}px`
    st.fontFamily = fontStack(draft, fonts, store.root.uid)
    st.fontSize = `${size}px`; st.fontWeight = draft.bold ? '700' : '400'; st.fontStyle = draft.italic ? 'italic' : 'normal'
    st.lineHeight = `${lh}px`; st.textAlign = align
    const v = store.view
    const M = mul(mul([v.z, 0, 0, v.z, v.x, v.y], draft.m), translate(x0, top))
    st.transform = `matrix(${M.map((n) => +n.toFixed(5)).join(',')})`
    s.box = { x: x0, y: top, w: W, h: H }
    view.requestOverlay()
  }
  const redraw = () => { if (!sess) return; renderer.fillText(sess.t, sess.draft); place() }
  const setDraft = (patch, dropGlyphs) => {
    const d = { ...sess.draft, ...patch }
    if (dropGlyphs) delete d.glyphs // the first change turns exact PDF letter positions into ordinary text (the embedded font stays the first choice)
    sess.draft = d
    redraw()
  }

  function begin(spec) {
    commit()
    let base, isNew = false
    if (spec.id != null) {
      const f = store.find(spec.id)
      if (!f?.node || f.node.t !== 'text') return false
      if (isLocked(store, spec.id)) { store.setStatus('Locked text cannot be edited. Unlock it in the Objects docker.'); return false }
      base = f.node
    } else {
      isNew = true
      const d = { ...TEXT_DEFAULTS, ...store.prefs.text }
      const key = d.font && store.root.fonts[d.font] ? d.font : docFontKey(store, fonts, d.family)
      base = { id: store.newId(), t: 'text', str: '', family: d.family, ...(key ? { font: key } : {}), size: d.size, bold: !!d.bold, italic: !!d.italic, fill: d.fill, opacity: 1, m: [1, 0, 0, 1, spec.p.x, spec.p.y], lh: d.lh, align: d.align }
    }
    setTool?.('text')
    fonts.needBundled([base.family]) // the typing view uses the same face the page and the exports draw (redraws when it arrives)
    if (!isNew) store.setSel([base.id])
    const g = document.createElementNS(NS, 'g')
    g.setAttribute('class', 'ds-draft')
    const t = renderer.textEl(base)
    g.append(t)
    renderer.world.append(g)
    const orig = isNew ? null : renderer.elOf(base.id)
    if (orig) orig.style.visibility = 'hidden'
    const ta = h('textarea', { class: 'ds-textedit', spellcheck: 'false', wrap: 'off', rows: 1, autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'Text. Press Escape when you are done.' })
    ta.value = base.str
    ta.maxLength = LIMITS.str
    stage.append(ta)
    sess = { id: base.id, isNew, base, draft: base, g, t, ta, orig, pageId: store.page().id, box: null }
    ta.addEventListener('input', () => { if (sess) setDraft({ str: ta.value.replace(/\r/g, '') }, true) })
    ta.addEventListener('blur', () => commit())
    ta.addEventListener('scroll', () => { ta.scrollLeft = 0; ta.scrollTop = 0 })
    ta.addEventListener('keydown', (e) => {
      if (!sess) return
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commit(); host.focus({ preventScroll: true }); return }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'b' || e.key === 'B' || e.key === 'i' || e.key === 'I')) {
        e.preventDefault(); e.stopPropagation()
        const k = e.key.toLowerCase() === 'b' ? 'bold' : 'italic'
        setDraft({ [k]: !sess.draft[k] }, true)
      }
    })
    place()
    ta.focus({ preventScroll: true })
    ta.setSelectionRange(ta.value.length, ta.value.length)
    store.setStatus('Typing text. Press Esc when you are done.')
    return true
  }

  /** End the session: one undo step (or none when nothing changed). Returns true when a session was open. */
  function commit() {
    const s = sess
    if (!s) return false
    sess = null
    s.ta.remove(); s.g.remove()
    if (s.orig) s.orig.style.visibility = ''
    store.setStatus('')
    const { base, draft } = s
    const blank = !/\S/.test(draft.str)
    if (s.isNew) {
      if (blank) { view.requestOverlay(); return true }
      const page = store.root.pages.find((p) => p.id === s.pageId) || store.page()
      const lid = store.activeLayerOf(page)?.id
      store.tx('Add text', (r) => {
        let root = r, id = lid
        if (id == null) { const out = {}; root = addLayer(root, page.id, store.newId, { out }); id = out.id }
        return insertAt(root, id, null, [draft])
      }, { sel: [draft.id] })
      fonts.needBundled([draft.family])
    } else if (draft !== base) {
      const cur = store.find(base.id)?.node
      if (cur) {
        if (blank) store.tx('Delete text', (r) => deleteIds(r, [base.id]), { sel: [] })
        else {
          const patch = {}
          for (const k of ['str', 'bold', 'italic']) if (draft[k] !== base[k]) patch[k] = draft[k]
          const next = { ...cur, ...patch }
          if (base.glyphs && !draft.glyphs) delete next.glyphs
          if (Object.keys(patch).length || next.glyphs !== cur.glyphs) store.tx('Edit text', (r) => replaceLeaves(r, new Map([[base.id, next]])), { sel: [base.id] })
        }
      }
    }
    view.requestOverlay()
    return true
  }
  /** Throw the session away without changing the document (a new file was opened). */
  function cancel() {
    const s = sess
    if (!s) return
    sess = null
    s.ta.remove(); s.g.remove()
    if (s.orig) s.orig.style.visibility = ''
    store.setStatus('')
    view.requestOverlay()
  }

  const offs = [store.on('fonts', redraw), store.on('view', place), store.on('page', () => commit()),
    store.on('doc', (e) => { if (e?.load) cancel() }), store.on('edittext', (id) => { begin({ id }) })]

  return {
    begin, commit, cancel,
    get active() { return !!sess },
    get textarea() { return sess?.ta || null },
    get draft() { return sess?.draft || null },
    /** A dashed frame around the text being edited (screen space overlay). */
    overlay(g, { toScreen, el }) {
      if (!sess?.box) return
      const pts = boxQuad(sess.box, sess.draft.m).map(([x, y]) => toScreen(x, y))
      g.append(el('polygon', { class: 'ds-selbox', points: pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '), fill: 'none' }))
    },
    dispose() { cancel(); offs.forEach((o) => o()) },
  }
}

/** The Text tool: a click on text edits it in place, a click anywhere else starts new text there (the baseline starts at the click). */
export function createTextTool({ store, boxOf, editor, info }) {
  let down = null
  return {
    ...info,
    deactivate() { editor.commit() },
    pointerdown(ev) { if (ev.button === 0) down = { s: ev.s, p: ev.p, target: ev.target } },
    pointermove() {},
    pointerup(ev) {
      const d = down
      down = null
      if (!d || Math.hypot(ev.s.x - d.s.x, ev.s.y - d.s.y) > 6) return
      let id = pickFromTarget(d.target, store, { deep: true })
      if (id == null) id = hitByDistance(store, boxOf, d.p, 4 / store.view.z)
      const n = id != null ? store.find(id)?.node : null
      if (n?.t === 'text') editor.begin({ id: n.id })
      else editor.begin({ p: d.p })
    },
    cancel() { down = null },
    overlay: (g, hlp) => editor.overlay(g, hlp),
  }
}
