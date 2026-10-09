// "Upload a file or paste text" input shared by the resume importer, ATS checker and other tools that need document text.
import { h, icon, dropzone, textarea, button, modal, input, field, toast, errorMessage, busy, alert, clear } from '../../lib/ui.js'
import { extractFile, ACCEPT } from './_extract.js'

/**
 * const src = textSource({ rows, placeholder, label, paste, onChange })
 * src.el, src.text (get/set), src.meta (extraction info of the last file or null), src.clear()
 */
export function textSource({ rows = 9, placeholder = 'Paste the text here...', label = 'Drop a PDF or DOCX here, or click to choose', hint = 'PDF, DOCX or TXT', paste = true, onChange, accept = ACCEPT } = {}) {
  const ta = textarea({ rows, placeholder, 'aria-label': 'Text' })
  const status = h('div', { class: 'small muted', 'aria-live': 'polite' })
  const api = { meta: null }
  const set = (text, meta) => { ta.value = text; api.meta = meta || null; onChange?.(text, api.meta) }
  async function read(file, password) {
    clear(status, h('span', { class: 'spinner', style: 'display:inline-block;vertical-align:-3px;margin-right:6px' }), `Reading ${file.name}...`)
    try {
      const r = await extractFile(file, { password })
      if (!r.text.trim()) {
        set('', r)
        clear(status, alert('warn', r.info?.scanned ? 'This PDF has no selectable text (it looks scanned). Paste the text instead, or run OCR on it first.' : 'No text found in this file.'))
        return
      }
      set(r.text, r)
      clear(status, h('span', { class: 'row small', style: 'gap:6px' }, icon('circle-check'), `Read ${file.name}${r.pages ? ` (${r.pages} page${r.pages > 1 ? 's' : ''})` : ''}. You can edit the text below.`))
    } catch (e) {
      if (e.code === 'PASSWORD') { clear(status); askPassword(file, e.message); return }
      clear(status, alert('error', errorMessage(e)))
    }
  }
  function askPassword(file, msg) {
    const pw = input({ type: 'password', placeholder: 'PDF password', autocomplete: 'off' })
    const go = button('Unlock', { variant: 'primary', icon: 'lock-open' })
    const m = modal({ title: 'Password needed', icon: 'lock', body: [h('p', msg || 'This PDF is password-protected.'), field('Password', pw)], actions: [go] })
    const submit = () => { m.close(); read(file, pw.value) }
    go.addEventListener('click', submit)
    pw.addEventListener('keydown', (e) => e.key === 'Enter' && submit())
    setTimeout(() => pw.focus(), 50)
  }
  ta.addEventListener('input', () => onChange?.(ta.value, api.meta))
  const zone = dropzone({ accept, compact: true, label, hint, paste, onFiles: ([f]) => read(f) })
  api.el = h('div', { class: 'stack tight' }, zone, status, ta)
  api.read = read
  Object.defineProperty(api, 'text', { get: () => ta.value, set: (v) => set(v, null) })
  api.set = set
  api.clear = () => { set('', null); clear(status) }
  api.textarea = ta
  return api
}
