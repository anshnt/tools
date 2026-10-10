// Text formatting commands. While a text box is being edited they act on the selected text (execCommand);
// otherwise they act on every selected text box or shape. They also report the current state for the toolbar.
import { fontStack, cssToHex, clamp, isTextual } from './_model.js'
import { colorOf, fontOf } from './_themes.js'

const stripRuns = (tx, key) => { for (const p of tx.paras) for (const r of p.runs) delete r[key] }

export function createFormat(app) {
  const { store } = app
  const ed = () => (app.stage.editing?.kind === 'text' ? app.stage.editing : null)
  const textTargets = () => store.selected.filter((e) => isTextual(e) && e.tx)
  const collapsed = () => { const r = ed()?.range; return !r || r.collapsed }
  const deck = () => store.deck

  function restore() {
    const e = ed()
    e.tc.focus({ preventScroll: true })
    if (e.range) { const s = getSelection(); s.removeAllRanges(); s.addRange(e.range) }
    document.execCommand('styleWithCSS', false, true)
  }
  function cmd(name, val) {
    restore()
    document.execCommand(name, false, val)
    app.stage.afterEdit()
    app.bus.emit('fmt')
  }
  /** Change a box-level property while editing: model, live DOM, and drop run-level overrides. */
  function baseEdit(prop, value) {
    const e = store.slide.elements.find((x) => x.id === ed().id)
    const tc = ed().tc
    const dom = { size: ['fontSize', 'font-size', `${value}px`], font: ['fontFamily', 'font-family', fontStack(fontOf(deck(), value))], color: ['color', 'color', colorOf(deck(), value, '#000')] }[prop]
    e.tx[prop] = value
    tc.style[dom[0]] = dom[2]
    for (const n of tc.querySelectorAll('[style]')) n.style.removeProperty(dom[1])
    app.stage.afterEdit()
    app.bus.emit('fmt')
  }
  function whole(label, fn, merge = false) {
    store.edit(label, () => { for (const e of textTargets()) fn(e.tx, e) }, 'slide', merge)
  }
  const blocks = () => {
    const e = ed(), r = e.range
    const all = [...e.tc.children].filter((n) => n.classList.contains('ss-p'))
    if (!r) return all.slice(0, 1)
    const hit = all.filter((p) => r.intersectsNode(p))
    if (hit.length) return hit
    const n = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer
    return [n.closest?.('.ss-p')].filter(Boolean)
  }

  const f = {
    toggle(key) { // 'b' | 'i' | 'u'
      if (ed()) return cmd({ b: 'bold', i: 'italic', u: 'underline' }[key])
      const targets = textTargets()
      if (!targets.length) return
      if (key === 'u') {
        const on = !targets.every((e) => e.tx.paras.every((p) => p.runs.every((r) => r.u)))
        return whole('Underline', (tx) => tx.paras.forEach((p) => p.runs.forEach((r) => { if (on) r.u = true; else delete r.u })))
      }
      const on = !targets.every((e) => e.tx[key])
      whole(key === 'b' ? 'Bold' : 'Italic', (tx) => { tx[key] = on; stripRuns(tx, key) })
    },
    setSize(n) {
      n = clamp(Math.round(n * 10) / 10, 4, 400)
      if (!Number.isFinite(n)) return
      if (ed()) {
        if (collapsed()) return baseEdit('size', n)
        restore()
        document.execCommand('fontSize', false, '7')
        for (const node of ed().tc.querySelectorAll('font[size="7"], span[style*="xxx-large"]')) {
          if (node.tagName === 'FONT') { const sp = document.createElement('span'); sp.style.fontSize = `${n}px`; sp.append(...node.childNodes); node.replaceWith(sp) } else node.style.fontSize = `${n}px`
        }
        app.stage.afterEdit(); app.bus.emit('fmt')
        return
      }
      whole('Font size', (tx) => { tx.size = n; stripRuns(tx, 's') })
    },
    stepSize(d) { const s = f.state(); f.setSize((s.size || 24) + d) },
    setFont(name) {
      if (ed()) { if (collapsed()) return baseEdit('font', name); return cmd('fontName', name) }
      whole('Font', (tx) => { tx.font = name; stripRuns(tx, 'f') })
    },
    setColor(v) { // '@token' or '#hex'
      if (ed()) { if (collapsed()) return baseEdit('color', v); return cmd('foreColor', colorOf(deck(), v, '#000000')) }
      whole('Text colour', (tx) => { tx.color = v; stripRuns(tx, 'c') })
    },
    setHighlight(v) {
      if (ed()) { if (!v) return cmd('hiliteColor', 'transparent'); return cmd('hiliteColor', colorOf(deck(), v)) }
      whole('Highlight', (tx) => tx.paras.forEach((p) => p.runs.forEach((r) => { if (v) r.hl = colorOf(deck(), v); else delete r.hl })))
    },
    align(a) {
      if (ed()) return cmd({ left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight', justify: 'justifyFull' }[a])
      whole('Align', (tx) => { tx.a = a; tx.paras.forEach((p) => delete p.a) })
    },
    bullet(kind) { // 'dot' | 'num'
      if (ed()) {
        const bl = blocks()
        const on = !bl.every((p) => p.dataset.bu === kind)
        for (const p of bl) { if (on) p.dataset.bu = kind; else { delete p.dataset.bu } }
        app.stage.afterEdit(); app.bus.emit('fmt')
        return
      }
      whole('Bullets', (tx) => { const on = !tx.paras.every((p) => p.bu === kind); tx.paras.forEach((p) => { if (on) p.bu = kind; else { delete p.bu; delete p.lv } }) })
    },
    indent(d) {
      if (ed()) {
        for (const p of blocks()) {
          if (!p.dataset.bu) { if (d > 0) p.dataset.bu = 'dot'; else continue }
          const lv = clamp((+p.dataset.lv || 0) + d, 0, 4)
          if (lv) { p.dataset.lv = lv; p.style.setProperty('--lv', lv) } else { delete p.dataset.lv; p.style.removeProperty('--lv') }
        }
        app.stage.afterEdit(); app.bus.emit('fmt')
        return
      }
      whole('Indent', (tx) => tx.paras.forEach((p) => { if (!p.bu) { if (d > 0) p.bu = 'dot'; else return } p.lv = clamp((p.lv || 0) + d, 0, 4); if (!p.lv) delete p.lv }))
    },
    /** Current formatting at the caret / selection (or of the first selected text box). */
    state() {
      const e = ed()
      if (e) {
        const r = e.range
        const n = r ? (r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer) : e.tc
        const el = e.tc.contains(n) ? n : e.tc
        const cs = getComputedStyle(el)
        const blk = el.closest?.('.ss-p')
        let b = +cs.fontWeight >= 600, i = cs.fontStyle === 'italic', u = false
        try { b = document.queryCommandState('bold'); i = document.queryCommandState('italic'); u = document.queryCommandState('underline') } catch { /* unsupported */ }
        return {
          on: true, editing: true, b, i, u, size: Math.round(parseFloat(cs.fontSize) * 10) / 10, font: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
          color: cssToHex(cs.color), align: blk?.style.textAlign || store.slide.elements.find((x) => x.id === e.id)?.tx.a || 'left', bu: blk?.dataset.bu || '',
        }
      }
      const t = textTargets()[0]
      if (!t) return { on: false }
      const tx = t.tx
      const allU = tx.paras.every((p) => p.runs.every((r) => r.u))
      return { on: true, editing: false, b: !!tx.b, i: !!tx.i, u: allU, size: tx.size, font: fontOf(deck(), tx.font), color: colorOf(deck(), tx.color), align: tx.a || 'left', bu: tx.paras.every((p) => p.bu === 'dot') ? 'dot' : tx.paras.every((p) => p.bu === 'num') ? 'num' : '' }
    },
  }
  return f
}
