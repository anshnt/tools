// Shared shell for the floating tools: puts a widget in an always-on-top Document Picture-in-Picture window, or keeps it in the page.
import { h, icon, button, busy, toast, alert } from '../../lib/ui.js'
import { baseCss, injectCss, floater, pipSupported, unsupported } from './_shared.js'

const CSS = `
.sc-fl-slot{display:flex;justify-content:center}
.sc-fl-slot>*{width:100%}
.sc-fl-float{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:16px 18px;border-radius:var(--radius-lg);border:1px dashed color-mix(in srgb,var(--accent) 45%,var(--border-strong));background:var(--accent-soft)}
.sc-fl-float .icon{width:22px;height:22px;color:var(--accent)}
.sc-fl-float .grow{flex:1;min-width:200px}
.sc-fl-pip-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
`

/**
 * floatShell({node, title, width, height, noun, onFloat, onDock}) -> element to put on the page.
 * `node` is the widget (it keeps working in both documents, so bind events on it rather than on `document`).
 * While floating, the page shows a "bring it back" strip; when the window closes the widget returns to the page.
 */
export function floatShell({ node, title, width = 340, height = 480, noun = 'widget', onFloat, onDock }) {
  baseCss()
  injectCss('float', CSS)
  const slot = h('div', { class: 'sc-fl-slot' }, node)
  const status = h('div')
  const supported = pipSupported()
  const fl = supported ? floater({
    node, title, width, height,
    onOpen: (w) => { slot.replaceChildren(); onFloat?.(w); render(); setTimeout(() => node.focus?.({ preventScroll: true }), 50) },
    onClose: () => { slot.replaceChildren(node); onDock?.(); render() },
  }) : null

  const floatBtn = button(`Float the ${noun} on top`, { icon: 'picture-in-picture-2', variant: 'primary' })
  floatBtn.addEventListener('click', () => busy(floatBtn, async () => {
    try { await fl.open() } catch (e) {
      throw new Error(e?.name === 'NotAllowedError' ? 'The browser blocked the floating window. Click the button again.' : `Could not open the floating window (${e?.message || e}).`)
    }
  }, { label: 'Opening' }))

  function render() {
    status.replaceChildren()
    if (!supported) {
      status.append(unsupported('Always-on-top windows', `Your browser cannot float this above other windows (it needs Chrome or Edge 116 or newer on a computer). The ${noun} works right here in the page. To keep it handy, snap this tab into a small window next to your work.`))
    } else if (fl.isOpen) {
      status.append(h('div', { class: 'sc-fl-float' }, icon('picture-in-picture-2'),
        h('div', { class: 'grow' }, h('strong', `The ${noun} is floating above your other windows.`), h('div', { class: 'small muted' }, 'Keep working in any app. Close the floating window or bring it back here.')),
        button('Bring it back', { icon: 'minimize-2', onClick: () => fl.close() })))
    } else {
      status.append(h('div', { class: 'sc-fl-pip-bar' }, floatBtn, h('span', { class: 'small muted' }, 'Opens a small window that stays on top of every other app until you close it.')))
    }
  }
  render()
  return h('div', { class: 'stack' }, status, slot)
}
