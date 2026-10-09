// A small "QR code of this link" box with PNG and SVG downloads. Used by utm-builder and url-shortener.
import { h, icon, button, download, clear, toast } from '../../lib/ui.js'
import { qrMatrix, buildQr, qrPng } from './_qr.js'
import { slug } from './_shared.js'

/** qrBox({title}) -> {el, set(text|null)}. Rendering is async and always shows the latest text. */
export function qrBox({ title = 'QR code', size = 200 } = {}) {
  let text = null
  let token = 0
  const stage = h('div', { class: 'wt-qrbox-stage', style: { width: `${size}px`, maxWidth: '100%', marginInline: 'auto' } })
  const pngBtn = button('PNG', { icon: 'download', size: 'sm', onClick: async () => {
    try { download(await qrPng(await qrMatrix(text, 'M'), { margin: 3 }, 1024), `qr-${slug(text)}.png`) } catch (e) { toast(e.message, 'error') }
  } })
  const svgBtn = button('SVG', { icon: 'download', size: 'sm', onClick: async () => {
    try { download(buildQr(await qrMatrix(text, 'M'), { margin: 3, size: 1024 }).svg, `qr-${slug(text)}.svg`, 'image/svg+xml') } catch (e) { toast(e.message, 'error') }
  } })
  const el = h('div', { class: 'stack', style: 'justify-items:center;text-align:center' }, h('div', { class: 'wt-kicker' }, title), stage, h('div', { class: 'row', style: 'justify-content:center' }, pngBtn, svgBtn))
  const empty = () => { clear(stage, h('div', { class: 'wt-empty-hero', style: 'padding:30px 8px' }, icon('qr-code'))); pngBtn.disabled = svgBtn.disabled = true }
  async function set(t) {
    const my = ++token
    text = t || null
    if (!text) return empty()
    try {
      const m = await qrMatrix(text, 'M')
      if (my !== token) return
      const wrap = h('div', { style: 'background:#fff;border-radius:14px;padding:6px;line-height:0;box-shadow:var(--shadow-sm)' })
      wrap.innerHTML = buildQr(m, { margin: 2, size }).svg
      const s = wrap.firstElementChild
      s.setAttribute('width', '100%'); s.removeAttribute('height'); s.style.height = 'auto'; s.style.display = 'block'
      clear(stage, wrap)
      pngBtn.disabled = svgBtn.disabled = false
    } catch (e) {
      if (my !== token) return
      clear(stage, h('div', { class: 'small muted' }, e.message))
      pngBtn.disabled = svgBtn.disabled = true
    }
  }
  empty()
  return { el, set }
}
