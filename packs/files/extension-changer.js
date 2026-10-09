// Bulk extension changer: change, add, remove or re-case extensions on many files, or fix wrong extensions by reading each
// file's real type from its first bytes. Preview first, then ZIP of renamed copies or rename in place.
import { h, alert, field, input, select, toggle } from '../../lib/ui.js'
import { splitName, renameWorkbench } from './_rename.js'
import { detectFile, extOf, extensionVerdict } from './_core.js'
import { useFx, card } from './_ui.js'

const clean = (e) => e.replace(/^[.\s]+/, '').replace(/[\\/:*?"<>|\s]+/g, '')

/** New name for one file. s: {mode: change|add|remove|case|fix, to, from, onlyMissing, caseMode}; det: detectFile() result for mode 'fix'. */
export function newExtName(name, s, det) {
  const [stem, ext] = splitName(name)
  const cur = ext.slice(1)
  const to = clean(s.to || '')
  switch (s.mode) {
    case 'change':
      if (!to) return name
      if (s.from !== 'any' && cur.toLowerCase() !== s.from) return name
      return `${stem}.${to}`
    case 'add':
      if (!to) return name
      if (s.onlyMissing && cur) return name
      return `${name}.${to}`
    case 'remove':
      return stem
    case 'case':
      return stem + (s.caseMode === 'upper' ? ext.toUpperCase() : ext.toLowerCase())
    case 'fix': {
      if (!det || det.exts.length === 0) return name
      if (extensionVerdict(det, name).ok) return name
      return `${stem}.${det.exts[0] || det.ext}`
    }
    default: return name
  }
}

export function mount(root) {
  useFx()
  const s = { mode: 'change', to: '', from: 'any', onlyMissing: true, caseMode: 'lower' }
  const rn = renameWorkbench({
    noun: 'files',
    enrichLabel: 'Checking what each file really is',
    enrich: async (it) => { if (s.mode !== 'fix' || it.meta.detDone) return; it.meta.detDone = true; try { it.meta.det = await detectFile(it.file) } catch { it.meta.det = null } },
    detail: (it) => (s.mode === 'fix' ? (it.meta.det ? `Looks like: ${it.meta.det.label}` : it.meta.detDone ? 'Type not recognised, left as is' : 'Checking...') : ''),
    compute: (items) => items.map((it) => newExtName(it.name, s, it.meta.det)),
    onItems: () => { rebuildFrom(); wrap.hidden = false },
  })
  const upd = () => { show(); rn.refresh() }

  const mode = select([
    ['change', 'Change the extension to something else'], ['add', 'Add an extension to files'], ['remove', 'Remove the extension'],
    ['case', 'Make extensions lowercase or UPPERCASE'], ['fix', 'Fix wrong extensions from the file contents'],
  ], s.mode, (v) => { s.mode = v; if (v === 'fix') rn.enrich(); upd() })
  const to = input({ placeholder: 'jpg', 'aria-label': 'New extension', mono: true, oninput: (e) => { s.to = e.target.value; upd() } })
  const from = select([['any', 'Any extension']], 'any', (v) => { s.from = v; upd() })
  const onlyMissing = toggle('Only files that have no extension yet', s.onlyMissing, (v) => { s.onlyMissing = v; upd() })
  const caseMode = select([['lower', 'lowercase  (.jpg)'], ['upper', 'UPPERCASE  (.JPG)']], s.caseMode, (v) => { s.caseMode = v; upd() })
  const quick = h('div', { class: 'fx-chips' }, ['txt', 'md', 'jpg', 'png', 'pdf', 'csv', 'html', 'json', 'mp4', 'mp3'].map((e) => h('button', { type: 'button', class: 'fx-chip accent', style: 'cursor:pointer', onclick: () => { to.value = e; s.to = e; upd() } }, '.' + e)))

  const fromField = field('Only change files that currently end in', from)
  const toField = field('New extension', to, 'With or without the dot. Case is kept as you type it.')
  const caseField = field('Make them', caseMode)
  const noteConvert = alert('info', h('strong', 'This renames, it does not convert. '), 'Renaming photo.png to photo.jpg does not turn it into a JPEG, and some apps will refuse the file. To really convert, use the image or video converters.')
  const noteFix = alert('info', h('strong', 'Reads the first bytes of every file. '), 'The tool compares each file\'s real type with its extension and only renames the ones that disagree, for example a JPEG saved as .png.')
  const onlyField = h('div', onlyMissing)

  function show() {
    toField.hidden = !(s.mode === 'change' || s.mode === 'add')
    quick.hidden = toField.hidden
    fromField.hidden = s.mode !== 'change'
    onlyField.hidden = s.mode !== 'add'
    caseField.hidden = s.mode !== 'case'
    noteConvert.hidden = !(s.mode === 'change' || s.mode === 'add')
    noteFix.hidden = s.mode !== 'fix'
  }
  function rebuildFrom() {
    const counts = new Map()
    for (const it of rn.items()) { const e = extOf(it.name); counts.set(e, (counts.get(e) || 0) + 1) }
    const opts = [['any', `Any extension (${rn.items().length})`], ...[...counts].sort((a, b) => b[1] - a[1]).map(([e, n]) => [e, e ? `.${e}  (${n})` : `No extension  (${n})`])]
    from.replaceChildren(...opts.map(([v, l]) => h('option', { value: v }, l)))
    from.value = 'any'; s.from = 'any'
  }

  const wrap = h('div', { class: 'fx-bento' }, card('What to change', 'file-pen-line', '#3e63dd', h('div', { class: 'stack tight' }, field('Action', mode), fromField, toField, quick, onlyField, caseField, noteConvert, noteFix)))
  wrap.hidden = true
  show()
  root.append(h('div', { class: 'stack fx' }, rn.source, wrap, rn.preview))
}
