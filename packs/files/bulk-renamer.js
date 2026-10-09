// Bulk file renamer (also serves batch-image-renamer via params.images). Three steps - find & replace, tidy up, build the
// new name from a pattern with counters and dates - with a live preview, conflict checks, ZIP or in-place rename, and undo.
import { h, button, field, input, number, select, toggle } from '../../lib/ui.js'
import { splitName, caseConvert, CASE_OPTIONS, expandPattern, renameWorkbench } from './_rename.js'
import { readExif, naturalCompare } from './_core.js'
import { useFx, card } from './_ui.js'

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const DEFAULTS = (images) => ({
  find: '', repl: '', regex: false, matchCase: false, scope: 'name',
  caseMode: 'keep', spaces: 'keep', remove: '',
  pattern: images ? '{taken:YYYY-MM-DD}_{n}' : '{name}', start: 1, step: 1, pad: images ? 3 : 1, restart: false,
  extMode: 'keep', extCustom: '', sort: images ? 'taken' : 'added',
})

/** Pure core of the renamer: new full name for one item. ctx: {n, now, parent}. Throws on an invalid regular expression. */
export function buildName(name, s, meta, ctx) {
  let [stem, ext] = splitName(name)
  let target = s.scope === 'full' ? name : stem
  if (s.find) {
    if (s.regex) target = target.replace(new RegExp(s.find, s.matchCase ? 'g' : 'gi'), s.repl)
    else if (s.matchCase) target = target.split(s.find).join(s.repl)
    else target = target.replace(new RegExp(escapeRe(s.find), 'gi'), () => s.repl)
  }
  if (s.remove) { const set = new Set([...s.remove]); target = [...target].filter((c) => !set.has(c)).join('') }
  if (s.spaces !== 'keep') target = target.replace(/\s+/g, s.spaces === 'none' ? '' : s.spaces)
  if (s.caseMode !== 'keep') target = caseConvert(target, s.caseMode)
  if (s.scope === 'full') [stem, ext] = splitName(target)
  else stem = target
  stem = stem.replace(/^\s+|\s+$/g, '')
  let { text } = expandPattern(s.pattern || '{name}', {
    name: stem, orig: splitName(name)[0], ext: ext.replace(/^\./, ''), n: ctx.n, pad: s.pad,
    date: ctx.date, taken: meta.taken || ctx.date, parent: ctx.parent, camera: meta.camera, now: ctx.now,
  })
  if (!meta.camera && /\{camera\}/.test(s.pattern || '')) text = text.replace(/^[_\-\s]+/, '').replace(/([_-])[_-]+/g, '$1')
  const e = s.extMode === 'lower' ? ext.toLowerCase() : s.extMode === 'upper' ? ext.toUpperCase()
    : s.extMode === 'custom' ? (s.extCustom.replace(/^\.+/, '').trim() ? '.' + s.extCustom.replace(/^\.+/, '').trim() : '') : ext
  return text + e
}

const SORTS = [['added', 'As listed'], ['name', 'Name, A to Z'], ['name-desc', 'Name, Z to A'], ['mtime', 'Date modified, oldest first'], ['mtime-desc', 'Date modified, newest first'], ['size', 'Size, smallest first'], ['size-desc', 'Size, largest first']]

export function mount(root, { params }) {
  useFx()
  const images = !!params?.images
  const s = DEFAULTS(images)
  const c = {}
  let regexError = ''

  const needsExif = () => /\{(taken|camera)/.test(s.pattern) || s.sort === 'taken' || s.sort === 'taken-desc'
  const rn = renameWorkbench({
    noun: images ? 'photos' : 'files', accept: images ? 'image/*,.heic,.heif,.jfif,.avif' : '', thumbs: images,
    sourceHint: images ? 'Drop photos or pick a folder. Dates are read from each photo, on this device.' : 'Nothing is uploaded. Pick files or a whole folder.',
    enrichLabel: 'Reading photo dates',
    enrich: async (it) => {
      if (!needsExif() || it.meta.exifDone || !/^image\/|\.(heic|heif|jfif|avif)$/i.test(it.file.type || it.name)) return
      it.meta.exifDone = true
      const ex = await readExif(it.file)
      const d = ex?.DateTimeOriginal || ex?.CreateDate || ex?.DateTime
      if (d instanceof Date && !Number.isNaN(d.getTime())) it.meta.taken = d
      const cam = [ex?.Model || ex?.Make].filter(Boolean).join(' ').trim()
      if (cam) it.meta.camera = cam.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-')
    },
    onItems: () => { wrap.hidden = false },
    sort: (items) => {
      const by = s.sort
      const val = (i) => (by.startsWith('taken') ? (i.meta.taken?.getTime?.() ?? i.file.lastModified) : by.startsWith('mtime') ? i.file.lastModified : by.startsWith('size') ? i.file.size : 0)
      const dir = by.endsWith('-desc') ? -1 : 1
      return [...items].sort((a, b) => {
        if (by === 'added') return a.id - b.id
        if (by.startsWith('name')) return dir * naturalCompare(a.name, b.name)
        return dir * (val(a) - val(b)) || naturalCompare(a.name, b.name)
      })
    },
    compute: (items) => {
      regexError = ''
      const now = new Date()
      const counters = new Map()
      const out = []
      try { if (s.find && s.regex) new RegExp(s.find) } catch (e) { regexError = `That pattern is not a valid regular expression: ${e.message}`; showRegex(); return items.map((i) => i.name) }
      showRegex()
      items.forEach((it, i) => {
        const key = s.restart ? it.dir : ''
        const k = counters.get(key) ?? 0
        counters.set(key, k + 1)
        out.push(buildName(it.name, s, it.meta, { n: s.start + s.step * k, now, date: it.file.lastModified, parent: it.dir.split('/').pop() || rn.state.rootName }))
      })
      return out
    },
  })

  const showRegex = () => { if (c.find) { c.find.classList.toggle('invalid', !!regexError); c.regexMsg.textContent = regexError } }
  const upd = () => { syncHints(); rn.refresh() }
  const afterSort = () => { if (needsExif()) rn.enrich(); upd() }

  // ----- controls -----
  c.find = input({ placeholder: 'Text to find', 'aria-label': 'Text to find', value: s.find, oninput: (e) => { s.find = e.target.value; upd() } })
  c.repl = input({ placeholder: 'Replace with (empty removes it)', 'aria-label': 'Replace with', value: s.repl, oninput: (e) => { s.repl = e.target.value; upd() } })
  c.regexMsg = h('div', { class: 'small', style: 'color:var(--danger)', role: 'alert' })
  c.regex = toggle('Regular expression', s.regex, (v) => { s.regex = v; upd() })
  c.matchCase = toggle('Match case', s.matchCase, (v) => { s.matchCase = v; upd() })
  c.scope = select([['name', 'File name only (extension is kept)'], ['full', 'Whole name including the extension']], s.scope, (v) => { s.scope = v; upd() })
  c.caseMode = select(CASE_OPTIONS, s.caseMode, (v) => { s.caseMode = v; upd() })
  c.spaces = select([['keep', 'Keep spaces'], ['-', 'Replace with -'], ['_', 'Replace with _'], ['.', 'Replace with .'], ['none', 'Remove spaces']], s.spaces, (v) => { s.spaces = v; upd() })
  c.remove = input({ placeholder: 'For example ()[]#!', 'aria-label': 'Characters to remove', value: s.remove, oninput: (e) => { s.remove = e.target.value; upd() } })
  c.pattern = input({ mono: true, 'aria-label': 'New name pattern', value: s.pattern, spellcheck: false, autocomplete: 'off', oninput: (e) => { s.pattern = e.target.value; afterSort() } })
  c.tokenHint = h('div', { class: 'small muted' })
  c.start = number(s.start, { step: 1, min: 0, ariaLabel: 'Counter start', onInput: (n) => { s.start = Number.isFinite(n) ? Math.floor(n) : 1; upd() } })
  c.step = number(s.step, { step: 1, min: 1, ariaLabel: 'Counter step', onInput: (n) => { s.step = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1; upd() } })
  c.pad = number(s.pad, { step: 1, min: 1, max: 12, ariaLabel: 'Counter digits', onInput: (n) => { s.pad = Number.isFinite(n) ? Math.min(12, Math.max(1, Math.floor(n))) : 1; upd() } })
  c.restart = toggle('Restart numbering in each folder', s.restart, (v) => { s.restart = v; upd() })
  c.extMode = select([['keep', 'Keep the extension'], ['lower', 'Make it lowercase (.jpg)'], ['upper', 'Make it UPPERCASE (.JPG)'], ['custom', 'Change it to...']], s.extMode, (v) => { s.extMode = v; c.extCustomField.hidden = v !== 'custom'; upd() })
  c.extCustom = input({ placeholder: 'jpg', 'aria-label': 'New extension', value: s.extCustom, oninput: (e) => { s.extCustom = e.target.value; upd() } })
  c.extCustomField = field('New extension', c.extCustom)
  c.extCustomField.hidden = true
  c.sort = select(images ? [['taken', 'Date taken, oldest first'], ...SORTS] : SORTS, s.sort, (v) => { s.sort = v; afterSort() })

  const tokens = ['{name}', '{n}', '{date}', '{taken}', '{parent}', '{orig}', '{ext}', ...(images ? ['{camera}'] : [])]
  const tokenRow = h('div', { class: 'fx-chips' }, tokens.map((t) => h('button', {
    type: 'button', class: 'fx-chip accent', style: 'cursor:pointer;font-family:var(--mono)', title: TOKEN_HELP[t] || '',
    onclick: () => {
      const el = c.pattern
      const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a
      el.value = el.value.slice(0, a) + t + el.value.slice(b)
      s.pattern = el.value
      el.focus(); el.setSelectionRange(a + t.length, a + t.length)
      afterSort()
    },
  }, t)))
  function syncHints() {
    const { unknown } = expandPattern(s.pattern, { name: '', orig: '', ext: '', n: 1, pad: 1, date: new Date(), now: new Date() })
    c.tokenHint.textContent = unknown.length ? `Unknown token ${unknown.join(', ')}. Use the buttons above for valid ones.` : 'The extension is added back automatically. Add {n} to number files, {date:YYYY-MM-DD} for dates.'
    c.tokenHint.style.color = unknown.length ? 'var(--danger)' : ''
  }
  function sync() {
    c.find.value = s.find; c.repl.value = s.repl; c.regex.input.checked = s.regex; c.matchCase.input.checked = s.matchCase; c.scope.value = s.scope
    c.caseMode.value = s.caseMode; c.spaces.value = s.spaces; c.remove.value = s.remove
    c.pattern.value = s.pattern; c.start.value = s.start; c.step.value = s.step; c.pad.value = s.pad; c.restart.input.checked = s.restart
    c.extMode.value = s.extMode; c.extCustom.value = s.extCustom; c.extCustomField.hidden = s.extMode !== 'custom'; c.sort.value = s.sort
    afterSort()
  }

  const presets = images ? [
    ['Date + number', { pattern: '{taken:YYYY-MM-DD}_{n}', pad: 3, sort: 'taken' }],
    ['Date and time', { pattern: '{taken:YYYYMMDD_HHmmss}', sort: 'taken' }],
    ['Camera + date', { pattern: '{camera}_{taken:YYYY-MM-DD}_{n}', pad: 3, sort: 'taken' }],
    ['IMG sequence', { pattern: 'IMG_{n}', pad: 4, sort: 'taken' }],
    ['Keep name, add date', { pattern: '{taken:YYYY-MM-DD}_{name}', sort: 'added' }],
  ] : [
    ['Add a prefix', { pattern: 'Project_{name}' }],
    ['Add a suffix', { pattern: '{name}_final' }],
    ['Number files', { pattern: 'File_{n}', pad: 3 }],
    ['Date prefix', { pattern: '{date}_{name}' }],
    ['Lowercase with dashes', { caseMode: 'lower', spaces: '-' }],
    ['Remove brackets', { remove: '()[]{}' }],
  ]
  const presetRow = h('div', { class: 'fx-chips' }, presets.map(([label, patch]) => button(label, { size: 'sm', onClick: () => { Object.assign(s, DEFAULTS(images), patch); sync() } })),
    button('Reset', { size: 'sm', variant: 'ghost', icon: 'rotate-ccw', onClick: () => { Object.assign(s, DEFAULTS(images)); sync() } }))

  const bento = h('div', { class: 'fx-bento' },
    card('Find and replace', 'replace', '#3e63dd', h('div', { class: 'stack tight' },
      field('Find', c.find), field('Replace with', c.repl), c.regexMsg, h('div', { class: 'row' }, c.regex, c.matchCase), field('Apply to', c.scope))),
    card('Tidy up', 'sparkles', '#12a594', h('div', { class: 'stack tight' },
      field('Letter case', c.caseMode), field('Spaces', c.spaces), field('Remove these characters', c.remove))),
    card('Build the new name', 'wand-sparkles', '#d6409f', h('div', { class: 'stack tight' },
      field('Pattern', c.pattern), tokenRow, c.tokenHint,
      h('div', { class: 'grid-3' }, field('Counter starts at', c.start), field('Step', c.step), field('Digits', c.pad)),
      c.restart, field('Extension', c.extMode), c.extCustomField, field(images ? 'Order (also sets the numbering)' : 'Order for numbering', c.sort))))
  const wrap = h('div', { class: 'stack' }, h('div', { class: 'stack tight' }, h('div', { class: 'small muted', style: 'font-weight:600' }, 'Quick starts'), presetRow), bento)
  wrap.hidden = true
  syncHints()
  root.append(h('div', { class: 'stack fx' }, rn.source, wrap, rn.preview))
}

const TOKEN_HELP = {
  '{name}': 'The original name after the steps above (without extension)',
  '{n}': 'Counter. {n:4} forces 4 digits',
  '{date}': 'Date modified. {date:YYYY-MM-DD_HHmm} sets the format',
  '{taken}': 'Date the photo was taken (falls back to date modified)',
  '{parent}': 'Name of the folder the file is in',
  '{orig}': 'The original name, untouched',
  '{ext}': 'The extension without the dot',
  '{camera}': 'Camera model from the photo',
}
