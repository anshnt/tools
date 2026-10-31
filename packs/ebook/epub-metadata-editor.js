// EPUB metadata editor: change the title, authors, language, publisher, description, date and cover of an EPUB. The book itself is not touched.
import { h, dropzone, button, busy, alert, panel, field, input, textarea, select, downloadButton, clear, formatBytes } from '../../lib/ui.js'
import { suffixName } from '../../lib/files.js'
import { loadEpubForEdit, saveEpubEdit } from './_epubmeta.js'

const LANGS = [['en', 'English'], ['hi', 'Hindi'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['ru', 'Russian'], ['ja', 'Japanese'], ['zh', 'Chinese'], ['ko', 'Korean'], ['ar', 'Arabic'], ['nl', 'Dutch'], ['pl', 'Polish'], ['tr', 'Turkish'], ['sv', 'Swedish']]

export function mount(root) {
  const host = h('div', { class: 'stack' })
  const zone = dropzone({ accept: '.epub,.kepub,application/epub+zip', multiple: false, label: 'Drop an EPUB here or click to choose', hint: 'Only the details change. The text, pictures and layout stay exactly as they are.', onFiles: ([f]) => openFile(f) })
  root.append(h('div', { class: 'stack' }, zone, host))

  async function openFile(file) {
    clear(host)
    let st
    try { st = await loadEpubForEdit(file) } catch (e) { clear(host, alert('error', e.message)); return }
    zone.classList.add('compact')
    const f = st.fields
    const title = input({ value: f.title, 'aria-label': 'Title' })
    const authors = textarea({ value: f.authors.join('\n'), rows: 3, 'aria-label': 'Authors' })
    const langs = LANGS.some(([v]) => v === f.language.split('-')[0]) ? LANGS : [...LANGS, [f.language || 'en', f.language || 'en']]
    const lang = select(langs, LANGS.some(([v]) => v === f.language) ? f.language : (f.language.split('-')[0] || 'en'), null)
    if (f.language && ![...lang.options].some((o) => o.value === f.language) && [...lang.options].some((o) => o.value === f.language.split('-')[0])) lang.value = f.language.split('-')[0]
    const publisher = input({ value: f.publisher, 'aria-label': 'Publisher' })
    const date = input({ value: f.date, placeholder: 'YYYY or YYYY-MM-DD', 'aria-label': 'Date' })
    const desc = textarea({ value: f.description, rows: 4, 'aria-label': 'Description' })
    let newCover = null
    const preview = h('img', { alt: 'Cover', style: 'max-width:160px;max-height:240px;border-radius:8px;border:1px solid var(--border);display:none' })
    const coverNote = h('div', { class: 'small muted' })
    let url = null
    const showCover = (c) => {
      if (url) URL.revokeObjectURL(url)
      url = c ? URL.createObjectURL(new Blob([c.data], { type: c.type })) : null
      preview.src = url || ''
      preview.style.display = c ? '' : 'none'
    }
    showCover(st.cover)
    coverNote.textContent = st.cover ? 'Current cover' : 'This book has no cover yet.'
    const picker = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/gif,image/webp', hidden: true, onchange: async (e) => {
      const img = e.target.files[0]
      e.target.value = ''
      if (!img) return
      newCover = { data: new Uint8Array(await img.arrayBuffer()), type: img.type }
      showCover(newCover)
      coverNote.textContent = `New cover: ${img.name}`
    } })
    const replaceBtn = button('Replace cover', { icon: 'image-up', size: 'sm', onClick: () => picker.click() })
    const removeBtn = button('Remove cover', { icon: 'trash-2', size: 'sm', variant: 'ghost', onClick: () => { newCover = 'remove'; showCover(null); coverNote.textContent = 'The cover will be removed.' } })
    const result = h('div')
    const saveBtn = button('Save EPUB', { icon: 'save', variant: 'primary', size: 'lg' })
    saveBtn.addEventListener('click', () => busy(saveBtn, async () => {
      const fields = { title: title.value, authors: authors.value.split(/\n|;/).map((a) => a.trim()).filter(Boolean), language: lang.value, publisher: publisher.value, description: desc.value, date: date.value }
      const blob = await saveEpubEdit(st, fields, newCover)
      clear(result, alert('success', h('strong', 'Saved. '), `${formatBytes(file.size)} to ${formatBytes(blob.size)}. Only the details were changed.`),
        h('div', { class: 'row', style: 'margin-top:12px' }, downloadButton(blob, suffixName(file.name, 'edited', 'epub'), 'Download EPUB', { size: 'lg' })))
    }, { label: 'Saving', errorTo: result }))
    clear(host,
      st.encrypted ? alert('info', 'This book is copy-protected. Its details can still be changed, but the book stays protected.') : null,
      panel(h('div', { class: 'stack' },
        h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px' },
          h('div', { class: 'stack' }, field('Title', title), field('Authors', authors, 'One per line.'), field('Language', lang)),
          h('div', { class: 'stack' }, field('Publisher', publisher), field('Date', date), h('div', { class: 'stack' }, h('span', { class: 'field-label' }, 'Cover'), preview, coverNote, h('div', { class: 'row' }, replaceBtn, removeBtn), picker))),
        field('Description', desc),
        h('div', { class: 'row' }, saveBtn, h('span', { class: 'small muted' }, `Identifier: ${f.identifier || 'none'}`)))),
      result)
  }
}
