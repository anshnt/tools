// Node views: resizable images and clickable check boxes for task lists.
import { state as S } from './vendor/prosemirror.js'

const { NodeSelection } = S

const el = (tag, cls, attrs = {}) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  return e
}

/** Inline image with corner handles. Dragging a corner resizes with the aspect ratio kept. */
export class ImageView {
  constructor(node, view, getPos, ctx) {
    this.node = node
    this.view = view
    this.getPos = getPos
    this.ctx = ctx
    this.dom = el('span', 'dc-img')
    this.img = el('img')
    this.img.draggable = false
    this.dom.append(this.img)
    for (const corner of ['nw', 'ne', 'sw', 'se']) {
      const hd = el('span', `dc-handle dc-h-${corner}`, { 'data-corner': corner, 'aria-hidden': 'true' })
      hd.addEventListener('pointerdown', (e) => this.startResize(e, corner))
      this.dom.append(hd)
    }
    this.paint()
  }

  paint() {
    const { src, alt, width, height } = this.node.attrs
    if (this.img.getAttribute('src') !== src) this.img.setAttribute('src', src)
    this.img.alt = alt || ''
    if (width) { this.img.style.width = `${width}px`; this.img.style.height = height ? `${height}px` : 'auto' } else { this.img.style.width = ''; this.img.style.height = '' }
  }

  update(node) {
    if (node.type !== this.node.type) return false
    this.node = node
    this.paint()
    return true
  }

  selectNode() { this.dom.classList.add('selected') }
  deselectNode() { this.dom.classList.remove('selected') }
  stopEvent(e) { return !!e.target?.classList?.contains('dc-handle') }
  ignoreMutation() { return true }

  startResize(e, corner) {
    e.preventDefault()
    e.stopPropagation()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const zoom = this.ctx.getZoom?.() || 1
    const rect = this.img.getBoundingClientRect()
    const startW = rect.width / zoom
    const ratio = rect.height && rect.width ? rect.height / rect.width : 1
    const startX = e.clientX
    const sign = corner.endsWith('e') ? 1 : -1
    const maxW = Math.max(80, this.view.dom.clientWidth)
    let w = startW
    const move = (ev) => {
      w = Math.min(maxW, Math.max(24, startW + (sign * (ev.clientX - startX)) / zoom))
      this.img.style.width = `${w}px`
      this.img.style.height = `${w * ratio}px`
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      const pos = this.getPos()
      if (pos == null) return
      const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, width: Math.round(w), height: Math.round(w * ratio) })
      this.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)))
      this.view.focus()
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }
}

/** Task list item: a real check box in front of the content. */
export class TaskItemView {
  constructor(node, view, getPos) {
    this.node = node
    this.view = view
    this.getPos = getPos
    this.dom = el('li', 'dc-task', { 'data-task': '' })
    const label = el('label', 'dc-task-box')
    label.contentEditable = 'false'
    this.box = el('input', '', { type: 'checkbox', 'aria-label': 'Done' })
    label.append(this.box)
    this.contentDOM = el('div', 'dc-task-body')
    this.dom.append(label, this.contentDOM)
    this.box.addEventListener('change', () => {
      const pos = this.getPos()
      if (pos == null) return
      this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, checked: this.box.checked }))
    })
    this.sync()
  }

  sync() {
    const on = !!this.node.attrs.checked
    this.dom.setAttribute('data-checked', String(on))
    this.box.checked = on
  }

  update(node) {
    if (node.type !== this.node.type) return false
    this.node = node
    this.sync()
    return true
  }

  stopEvent(e) { return e.target === this.box }
  ignoreMutation(m) { return !this.contentDOM.contains(m.target) }
}
