// AcroForm filling: widgets are read with pdf.js and drawn as real inputs over the page; the values live in
// store.state.fields (so undo works) and are written back with pdf-lib when saving.
import { h, icon, yieldToMain, toast } from '../../lib/ui.js'
import { clamp, apply } from './_geom.js'

export function createForms(app) {
  const { store } = app
  const cache = new Map() // src -> Promise<widget[]>
  const live = new Set() // {el, w, pv}

  async function widgetsFor(src) {
    if (!cache.has(src)) {
      cache.set(src, (async () => {
        const page = await app.doc.page(src)
        const vp = page.getViewport({ scale: 1 })
        const anns = await page.getAnnotations({ intent: 'display' })
        const out = []
        for (const a of anns) {
          if (a.subtype !== 'Widget' || !a.fieldName || a.hidden) continue
          const [x1, y1] = apply(vp.transform, a.rect[0], a.rect[1]), [x2, y2] = apply(vp.transform, a.rect[2], a.rect[3])
          const kind = a.checkBox ? 'check' : a.radioButton ? 'radio' : a.pushButton ? 'push' : a.fieldType === 'Sig' ? 'sig' : a.fieldType === 'Ch' ? (a.combo ? 'combo' : 'list') : 'text'
          out.push({
            name: a.fieldName, kind, x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), value: a.fieldValue, buttonValue: a.buttonValue,
            options: a.options || [], multi: !!a.multiLine, maxLen: a.maxLen || 0, readOnly: !!a.readOnly, size: a.defaultAppearanceData?.fontSize || 0, align: a.textAlignment || 0, multiSelect: !!a.multiSelect,
          })
        }
        return out
      })())
    }
    return cache.get(src)
  }

  const current = (w) => {
    const f = store.state.fields
    if (w.name in f) return f[w.name]
    if (w.kind === 'check') return !!w.value && w.value !== 'Off'
    if (w.kind === 'radio') return w.value
    if (w.kind === 'list') return Array.isArray(w.value) ? w.value : w.value ? [w.value] : []
    return w.value == null ? '' : Array.isArray(w.value) ? w.value[0] ?? '' : String(w.value)
  }
  const set = (name, value) => store.commit('Fill form', (s) => { s.fields[name] = value }, { coalesce: `f:${name}`, pids: [] })

  function build(pv, w) {
    const style = { left: `${w.x}px`, top: `${w.y}px`, width: `${w.w}px`, height: `${w.h}px` }
    const fs = w.size > 0 ? w.size : clamp(w.h * 0.62, 7, 14)
    let el
    const common = { class: ['ff', `ff-${w.kind}`, w.readOnly && 'ff-ro'], style: { ...style, fontSize: `${w.multi ? (w.size || 11) : fs}px` }, 'aria-label': w.name, title: w.name, disabled: w.readOnly }
    if (w.kind === 'text') {
      el = w.multi ? h('textarea', { ...common, spellcheck: true }) : h('input', { ...common, type: 'text', maxlength: w.maxLen || null })
      el.style.textAlign = ['left', 'center', 'right'][w.align] || 'left'
      el.value = current(w)
      el.addEventListener('input', () => set(w.name, el.value))
    } else if (w.kind === 'check') {
      el = h('input', { ...common, type: 'checkbox' })
      el.checked = !!current(w)
      el.addEventListener('change', () => set(w.name, el.checked))
    } else if (w.kind === 'radio') {
      el = h('input', { ...common, type: 'radio', name: `r:${w.name}:${pv.pid}` })
      el.checked = current(w) === w.buttonValue
      el.addEventListener('change', () => { if (el.checked) set(w.name, w.buttonValue) })
    } else if (w.kind === 'combo' || w.kind === 'list') {
      el = h('select', { ...common, multiple: w.kind === 'list' && w.multiSelect, size: w.kind === 'list' ? Math.max(2, Math.min(w.options.length, Math.floor(w.h / (fs * 1.3)))) : null },
        w.kind === 'combo' && h('option', { value: '' }, ''),
        w.options.map((o) => h('option', { value: o.exportValue ?? o.displayValue }, o.displayValue ?? o.exportValue)))
      const cur = current(w)
      for (const o of el.options) o.selected = Array.isArray(cur) ? cur.includes(o.value) : o.value === cur
      el.addEventListener('change', () => set(w.name, w.kind === 'list' ? [...el.selectedOptions].map((o) => o.value) : el.value))
    } else if (w.kind === 'sig') {
      el = h('button', { ...common, type: 'button', onclick: () => app.sign?.fillField(pv, w) }, icon('signature'), h('span', 'Sign'))
      el.classList.add('ff-sig')
    } else return null
    return el
  }

  const api = {
    highlight: true,
    async mount(pv) {
      const e = store.page(pv.pid)
      for (const x of [...live]) if (x.pv === pv) live.delete(x)
      pv.html.replaceChildren()
      if (!e || e.src == null) return
      const token = pv.token
      const ws = await widgetsFor(e.src)
      if (token !== pv.token || !ws.length) return
      const frag = document.createDocumentFragment()
      for (const w of ws) {
        if (w.kind === 'push') continue
        const el = build(pv, w)
        if (!el) continue
        live.add({ el, w, pv })
        frag.append(el)
      }
      pv.html.append(frag)
    },
    /** Re-read values from the store (after undo/redo or a radio change). */
    syncAll() {
      for (const { el, w } of live) {
        if (!el.isConnected || el === document.activeElement) continue
        const v = current(w)
        if (w.kind === 'check') el.checked = !!v
        else if (w.kind === 'radio') el.checked = v === w.buttonValue
        else if (w.kind === 'text') { if (el.value !== v) el.value = v }
        else if (w.kind === 'combo' || w.kind === 'list') for (const o of el.options) o.selected = Array.isArray(v) ? v.includes(o.value) : o.value === v
      }
    },
    setHighlight(on) { api.highlight = on; app.root.dataset.ff = on ? 'on' : 'off' },
    clearAll() {
      store.commit('Clear form', (s) => { s.fields = {} }, { pids: [] })
      api.syncAll()
      for (const pv of app.viewer.views.values()) if (pv.key) app.forms.mount(pv)
    },
    /** Scan the first pages for form fields in the background, then tell the user. */
    async scan() {
      const doc = app.doc
      const names = new Set()
      const n = Math.min(doc.pdf.numPages, 300)
      for (let i = 0; i < n; i++) {
        if (app.doc !== doc) return
        try { for (const w of await widgetsFor(i)) names.add(w.name) } catch { /* skip page */ }
        if (i % 4 === 3) await yieldToMain()
      }
      doc.fieldCount = names.size
      app.panels?.docRefresh?.()
      if (names.size && app.doc === doc) toast(`This PDF has ${names.size} form field${names.size === 1 ? '' : 's'}. Click a field to fill it.`, 'info', 4000)
    },
    get count() { return app.doc?.fieldCount || 0 },
  }
  return api
}
