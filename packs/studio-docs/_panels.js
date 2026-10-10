// Side panels: documents list, outline, page setup, and the shortcut sheet.
import { h, icon, dropzone, formatNumber } from '../../lib/ui.js'
import { FONTS } from './_schema.js'
import { PAPERS, MARGIN_PRESETS, marginPresetName } from './_page.js'
import { TEMPLATES } from './_templates.js'
import { OPEN_ACCEPT } from './_import.js'
import { tbtn } from './_ui.js'

export function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`
  return new Date(ts).toLocaleDateString()
}

// ---------- documents ----------
/** app: {newDoc(templateId), openDoc(id), duplicateDoc(id), deleteDoc(id), openFile(file), currentId()} */
export function createDocsPanel(app) {
  let docs = []
  let q = ''
  const list = h('div', { class: 'dc-sec', style: 'gap:6px' })
  const search = h('input', { type: 'search', placeholder: 'Search documents', 'aria-label': 'Search documents', class: 'dc-find-input',
    style: 'height:32px;padding:0 10px;border:1px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);width:100%',
    oninput: (e) => { q = e.target.value.trim().toLowerCase(); paint() } })
  const drop = dropzone({ accept: OPEN_ACCEPT, compact: true, label: 'Open a file', hint: 'Word (.docx), Markdown, HTML, text', multiple: false, onFiles: ([f]) => app.openFile(f), paste: false })

  function paint() {
    const cur = app.currentId()
    const shown = docs.filter((d) => !q || `${d.title} ${d.snippet || ''}`.toLowerCase().includes(q))
    list.replaceChildren(...(shown.length ? shown.map((d) => {
      const item = h('div', { class: ['dc-doc', d.id === cur && 'current'], role: 'button', tabindex: 0, 'aria-label': `Open ${d.title}`, 'aria-current': d.id === cur ? 'true' : null,
        onclick: () => app.openDoc(d.id), onkeydown: (e) => { if (e.key === 'Enter') app.openDoc(d.id) } },
      h('b', { title: d.title }, d.title || 'Untitled document'),
      h('span', { class: 'acts' },
        tbtn('copy', { tip: 'Duplicate', cls: 'sm', onClick: (e) => { e.stopPropagation(); app.duplicateDoc(d.id) } }),
        tbtn('trash-2', { tip: 'Delete', cls: 'sm', onClick: (e) => { e.stopPropagation(); app.deleteDoc(d.id) } })),
      h('small', `${ago(d.updated)} · ${formatNumber(d.words || 0, 0)} words${d.snippet ? ` · ${d.snippet}` : ''}`))
      return item
    }) : [h('div', { class: 'dc-note' }, docs.length ? 'No documents match your search.' : 'No documents yet.')]))
  }

  const el = h('div', { class: 'dc-side-body' },
    h('div', { class: 'dc-sec' }, h('h3', 'New document'),
      h('div', { class: 'dc-tpl' }, TEMPLATES.map((t) => h('button', { type: 'button', onclick: () => app.newDoc(t.id) }, icon(t.icon), t.name)))),
    h('div', { class: 'dc-sec' }, h('h3', 'Open'), drop),
    h('div', { class: 'dc-sec' }, h('h3', 'Your documents'), search, list,
      h('p', { class: 'dc-note' }, 'Documents are saved in this browser on this device. Download a copy to keep it elsewhere.')))
  return { el, set(next) { docs = next; paint() } }
}

// ---------- outline ----------
export function createOutline(app) {
  const list = h('div', { class: 'dc-ol' })
  const el = h('div', { class: 'dc-side-body' }, h('div', { class: 'dc-sec' }, h('h3', 'Outline'), list))
  let key = ''
  return {
    el,
    /** items: [{level, text, pos}], cursor: doc position of the selection */
    set(items, cursor) {
      let cur = -1
      items.forEach((it, i) => { if (it.pos <= cursor) cur = i })
      const k = items.map((i) => `${i.level}:${i.text}:${i.pos}`).join('|') + `@${cur}`
      if (k === key) return
      key = k
      list.replaceChildren(...(items.length ? items.map((it, i) => h('button', { type: 'button', class: [`lv${it.level}`, i === cur && 'cur'], title: it.text, onclick: () => app.gotoPos(it.pos) }, it.text || 'Untitled heading'))
        : [h('div', { class: 'dc-note' }, 'Headings appear here. Choose Heading 1, 2 or 3 from the style list to build an outline you can click to jump around.')]))
    },
  }
}

// ---------- page setup ----------
export function createPagePanel(app) {
  const s0 = app.settings()
  const sel = (opts, value, onChange, label) => h('select', { 'aria-label': label, onchange: (e) => onChange(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: v === value }, l)))
  const num = (key) => h('input', { type: 'number', min: 0, max: 80, step: 0.1, 'aria-label': `${key} margin in millimetres`,
    onchange: (e) => app.setSettings({ margins: { ...app.settings().margins, [key]: Math.min(80, Math.max(0, +e.target.value || 0)) } }) })
  const fields = { top: num('top'), right: num('right'), bottom: num('bottom'), left: num('left') }

  const paper = sel(Object.entries(PAPERS).map(([k, p]) => [k, `${p.name} (${p.w} x ${p.h} mm)`]), s0.paper, (v) => app.setSettings({ paper: v }), 'Paper size')
  const orient = sel([['portrait', 'Portrait'], ['landscape', 'Landscape']], s0.orient, (v) => app.setSettings({ orient: v }), 'Orientation')
  const preset = sel([...Object.entries(MARGIN_PRESETS).map(([k, p]) => [k, p.name]), ['custom', 'Custom']], marginPresetName(s0), (v) => {
    if (v !== 'custom') { const { name, ...m } = MARGIN_PRESETS[v]; app.setSettings({ margins: m }) }
  }, 'Margins')
  const font = sel(FONTS.map(([n]) => [n, n]), s0.font, (v) => app.setSettings({ font: v }), 'Default font')
  const size = h('input', { type: 'number', min: 8, max: 24, step: 0.5, 'aria-label': 'Default font size', onchange: (e) => app.setSettings({ fontSize: Math.min(24, Math.max(8, +e.target.value || 11)) }) })
  const nums = h('input', { type: 'checkbox', onchange: (e) => app.setSettings({ pageNumbers: e.target.checked }) })
  const header = h('input', { type: 'text', maxlength: 120, placeholder: 'Shown at the top of every page', 'aria-label': 'Header text', onchange: (e) => app.setSettings({ header: e.target.value.trim() }) })
  const footer = h('input', { type: 'text', maxlength: 120, placeholder: 'Shown at the bottom of every page', 'aria-label': 'Footer text', onchange: (e) => app.setSettings({ footer: e.target.value.trim() }) })

  const fld = (label, control, wide) => h('label', { class: ['dc-fld', wide && 'wide'] }, label, control)
  const el = h('div', { class: 'dc-side-body' },
    h('div', { class: 'dc-sec' }, h('h3', 'Paper'), h('div', { class: 'dc-fields' }, fld('Size', paper, true), fld('Orientation', orient, true))),
    h('div', { class: 'dc-sec' }, h('h3', 'Margins (mm)'), h('div', { class: 'dc-fields' }, fld('Preset', preset, true), fld('Top', fields.top), fld('Bottom', fields.bottom), fld('Left', fields.left), fld('Right', fields.right))),
    h('div', { class: 'dc-sec' }, h('h3', 'Default text'), h('div', { class: 'dc-fields' }, fld('Font', font), fld('Size (pt)', size))),
    h('div', { class: 'dc-sec' }, h('h3', 'Header and footer'),
      h('label', { class: 'dc-check' }, nums, 'Page numbers'), fld('Header', header, true), fld('Footer', footer, true),
      h('p', { class: 'dc-note' }, 'These appear in printed pages, PDF and Word files. The editor shows page edges as dashed lines.')))

  return {
    el,
    sync() {
      const s = app.settings()
      paper.value = s.paper
      orient.value = s.orient
      preset.value = marginPresetName(s)
      for (const k of Object.keys(fields)) if (document.activeElement !== fields[k]) fields[k].value = Math.round(s.margins[k] * 10) / 10
      font.value = s.font
      if (document.activeElement !== size) size.value = s.fontSize
      nums.checked = !!s.pageNumbers
      if (document.activeElement !== header) header.value = s.header || ''
      if (document.activeElement !== footer) footer.value = s.footer || ''
    },
  }
}

// ---------- shortcuts ----------
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Ctrl'
export const SHORTCUTS = [
  ['Bold, italic, underline', [`${MOD}+B`, `${MOD}+I`, `${MOD}+U`]],
  ['Strikethrough', [`${MOD}+Shift+X`]],
  ['Heading 1 to 6, normal text', [`${MOD}+Alt+1..6`, `${MOD}+Alt+0`]],
  ['Bullet, numbered, check list', [`${MOD}+Shift+8`, `${MOD}+Shift+7`, `${MOD}+Shift+9`]],
  ['Align left, centre, right, justify', [`${MOD}+L`, `${MOD}+E`, `${MOD}+R`, `${MOD}+J`]],
  ['Indent more or less', [`${MOD}+]`, `${MOD}+[`]],
  ['Bigger or smaller text', [`${MOD}+Shift+.`, `${MOD}+Shift+,`]],
  ['Insert link', [`${MOD}+K`]],
  ['Page break', [`${MOD}+Enter`]],
  ['Line break', ['Shift+Enter']],
  ['Clear formatting', [`${MOD}+\\`]],
  ['Undo, redo', [`${MOD}+Z`, `${MOD}+Y`]],
  ['Find and replace', [`${MOD}+F`, `${MOD}+H`]],
  ['Save a copy (download DOCX)', [`${MOD}+S`]],
  ['Print or save as PDF', [`${MOD}+P`]],
  ['Next or previous table cell', ['Tab', 'Shift+Tab']],
  ['Zoom in, out, reset', [`${MOD}+Wheel`, `${MOD}+0`]],
  ['Markdown: heading, list, quote, check list', ['# ', '- ', '> ', '[ ] ']],
]
export function shortcutSheet() {
  return h('div', SHORTCUTS.map(([what, keys]) => h('div', { class: 'dc-help-row' }, h('span', what), h('span', keys.map((k) => h('kbd', k))))))
}
