// Always-on-top notepad: Document Picture-in-Picture window with autosave, or a normal in-page notepad where that is not supported.
import { h, icon, button, toast, copyText, download, debounce } from '../../lib/ui.js'
import { persisted } from '../../lib/store.js'
import { baseCss, injectCss, relTime } from './_shared.js'
import { floatShell } from './_float.js'

export const countText = (t) => ({ chars: t.length, words: (t.trim().match(/\S+/g) || []).length, lines: t ? t.split('\n').length : 0 })

const CSS = `
.t-np{display:flex;flex-direction:column;gap:10px;min-height:0;outline:none}
.t-np .np-card{display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:var(--radius-lg);border:1px solid var(--border);background:var(--surface);box-shadow:var(--shadow)}
.t-np .np-bar{display:flex;gap:4px;align-items:center;flex-wrap:wrap}
.t-np .np-bar .sp{flex:1}
.t-np textarea{width:100%;min-height:clamp(220px,46vh,460px);resize:none;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-2);color:var(--text);padding:12px 14px;font:inherit;line-height:1.55;outline:none;transition:border-color .2s,box-shadow .2s}
.t-np textarea:focus{border-color:var(--accent);box-shadow:0 0 0 4px var(--ring)}
.t-np textarea.nowrap{white-space:pre;overflow-x:auto}
.t-np textarea.mono{font-family:var(--mono);font-size:.92em}
.t-np .np-foot{display:flex;gap:6px 14px;flex-wrap:wrap;align-items:center;font-size:12.5px;color:var(--muted);font-family:var(--mono)}
.t-np .np-saved{display:inline-flex;align-items:center;gap:6px;margin-left:auto}
.t-np .np-saved .icon{width:13px;height:13px;color:var(--success)}
body.sc-pip .t-np textarea{min-height:calc(100vh - 140px)}
body.sc-pip .t-np .np-card{border:0;box-shadow:none;padding:0;background:transparent}
body.sc-pip .t-np .np-card>*{margin:0}
`

export function mount(root) {
  baseCss()
  injectCss('np', CSS)
  const data = persisted('floating-notepad', { text: '', size: 15, wrap: true, mono: false })
  const s = () => data.get()
  const ta = h('textarea', { 'aria-label': 'Notepad', placeholder: 'Jot something down. It saves automatically on this device.', spellcheck: true, value: s().text })
  const stats = h('span')
  const saved = h('span', { class: 'np-saved' })
  let savedAt = 0, timer = 0

  function style() {
    ta.style.fontSize = `${s().size}px`
    ta.classList.toggle('nowrap', !s().wrap)
    ta.classList.toggle('mono', s().mono)
    ta.wrap = s().wrap ? 'soft' : 'off'
  }
  function counts() {
    const c = countText(ta.value)
    stats.textContent = `${c.words} words · ${c.chars} chars`
  }
  function markSaved() {
    savedAt = Date.now()
    paintSaved()
  }
  function paintSaved() {
    saved.replaceChildren(icon('check'), savedAt ? `Saved ${relTime(savedAt)}` : 'Autosave is on')
  }
  const save = debounce(() => { data.update((d) => ({ ...d, text: ta.value })); markSaved() }, 350)
  ta.addEventListener('input', () => { counts(); save() })
  ta.addEventListener('blur', () => { data.update((d) => ({ ...d, text: ta.value })); markSaved() })
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey) { // a real tab stays in the notepad
      e.preventDefault()
      const { selectionStart: a, selectionEnd: b } = ta
      ta.setRangeText('\t', a, b, 'end')
      ta.dispatchEvent(new Event('input'))
    }
  })

  const setSize = (d) => { data.update((x) => ({ ...x, size: Math.min(28, Math.max(11, x.size + d)) })); style() }
  const insertAt = (text) => {
    ta.focus()
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end')
    ta.dispatchEvent(new Event('input'))
  }
  let clearArmed = 0
  const clearBtn = button('Clear', { icon: 'eraser', size: 'sm', variant: 'ghost', title: 'Clear the notepad' })
  clearBtn.addEventListener('click', () => {
    if (!ta.value) return
    if (!clearArmed) {
      clearArmed = setTimeout(() => { clearArmed = 0; clearBtn.lastChild.textContent = 'Clear' }, 3000)
      clearBtn.lastChild.textContent = 'Sure?'
      return
    }
    clearTimeout(clearArmed); clearArmed = 0; clearBtn.lastChild.textContent = 'Clear'
    ta.focus()
    ta.select()
    if (!ta.ownerDocument.execCommand('delete')) { ta.value = ''; ta.dispatchEvent(new Event('input')) } // execCommand keeps the native undo stack
    toast('Notepad cleared. Press Ctrl+Z in the box to undo.', 'info', 3500)
  })
  const optsBar = h('div', { class: 'np-bar' },
    button('', { icon: 'a-arrow-down', size: 'sm', variant: 'ghost', ariaLabel: 'Smaller text', onClick: () => setSize(-1) }),
    button('', { icon: 'a-arrow-up', size: 'sm', variant: 'ghost', ariaLabel: 'Larger text', onClick: () => setSize(1) }),
    button('', { icon: 'text-wrap', size: 'sm', variant: 'ghost', ariaLabel: 'Toggle line wrapping', title: 'Wrap lines', onClick: () => { data.update((x) => ({ ...x, wrap: !x.wrap })); style() } }),
    button('', { icon: 'type', size: 'sm', variant: 'ghost', ariaLabel: 'Toggle monospace font', title: 'Monospace', onClick: () => { data.update((x) => ({ ...x, mono: !x.mono })); style() } }),
    button('', { icon: 'calendar-clock', size: 'sm', variant: 'ghost', ariaLabel: 'Insert date and time', title: 'Insert date and time', onClick: () => insertAt(new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) + ' ') }),
    h('span', { class: 'sp' }),
    button('', { icon: 'copy', size: 'sm', variant: 'ghost', ariaLabel: 'Copy all', title: 'Copy all', onClick: () => (ta.value ? copyText(ta.value) : toast('Nothing to copy yet')) }),
    button('', { icon: 'download', size: 'sm', variant: 'ghost', ariaLabel: 'Download as text file', title: 'Download .txt', onClick: () => (ta.value ? download(ta.value, 'notes.txt', 'text/plain') : toast('Nothing to download yet')) }),
    clearBtn)
  const node = h('div', { class: 't-np', tabindex: -1 }, h('div', { class: 'np-card' }, optsBar, ta, h('div', { class: 'np-foot' }, stats, saved)))
  style(); counts(); paintSaved()
  const tick = setInterval(() => savedAt && paintSaved(), 15000)

  root.append(floatShell({ node, title: 'Notepad', width: 380, height: 420, noun: 'notepad', onFloat: () => setTimeout(() => ta.focus(), 80) }))
  return () => { clearInterval(tick); clearTimeout(clearArmed); data.update((d) => ({ ...d, text: ta.value })) }
}
