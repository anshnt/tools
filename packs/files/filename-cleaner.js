// Filename cleaner: spaces, accents, odd characters, case and repeated separators, with a live preview over many files.
import { h, button, field, input, number, select, toggle, copyButton } from '../../lib/ui.js'
import { splitName, caseConvert, renameWorkbench } from './_rename.js'
import { useFx, card } from './_ui.js'

const TRANSLIT = { 'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE', 'ø': 'o', 'Ø': 'O', 'đ': 'd', 'Đ': 'D', 'ð': 'd', 'Ð': 'D', 'þ': 'th', 'Þ': 'Th', 'ł': 'l', 'Ł': 'L', 'ı': 'i', 'ŋ': 'ng', 'ħ': 'h', 'ĸ': 'k' }
const MARKS = /[̀-ͯ]/g
export const stripAccents = (s) => s.normalize('NFD').replace(MARKS, '').replace(/[ßæÆœŒøØđĐðÐþÞłŁıŋħĸ]/g, (c) => TRANSLIT[c]).normalize('NFC')

export const PRESETS = {
  web: { spaces: '-', accents: true, special: true, ascii: false, caseMode: 'lower', collapse: true, trim: true, extLower: true, max: 0, copyMarks: false },
  readable: { spaces: 'keep', accents: true, special: true, ascii: false, caseMode: 'keep', collapse: true, trim: true, extLower: false, max: 0, copyMarks: false },
  snake: { spaces: '_', accents: true, special: true, ascii: false, caseMode: 'lower', collapse: true, trim: true, extLower: true, max: 0, copyMarks: false },
  windows: { spaces: 'keep', accents: false, special: false, ascii: false, caseMode: 'keep', collapse: false, trim: true, extLower: false, max: 0, copyMarks: false },
}

/** Clean one file name according to opts (see PRESETS). Always replaces characters Windows forbids. */
export function cleanName(name, o) {
  let [stem, ext] = splitName(name)
  if (o.copyMarks) stem = stem.replace(/^Copy of\s+/i, '').replace(/\s*-\s*Copy(\s*\(\d+\))?$/i, '').replace(/\s*\(\d+\)$/, '')
  if (o.special) stem = stem.replace(/\s*&\s*/g, ' and ').replace(/@/g, ' at ')
  if (o.accents) stem = stripAccents(stem)
  if (o.ascii) stem = stem.replace(/[^\x20-\x7e]/g, '')
  stem = stem.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
  if (o.special) stem = stem.replace(/[^\p{L}\p{N}\s._-]/gu, '')
  if (o.spaces !== 'keep') stem = stem.replace(/\s+/g, o.spaces === 'none' ? '' : o.spaces)
  if (o.caseMode !== 'keep') stem = caseConvert(stem, o.caseMode)
  if (o.collapse) {
    if (o.spaces === '-' || o.spaces === '_') stem = stem.replace(/[-_]{2,}/g, o.spaces)
    stem = stem.replace(/([-_.])\1+/g, '$1').replace(/\s{2,}/g, ' ')
  }
  if (o.trim) stem = stem.replace(/^[\s_-]+|[\s._-]+$/g, '')
  if (o.max > 0 && [...stem].length > o.max) { stem = [...stem].slice(0, o.max).join(''); if (o.trim) stem = stem.replace(/[\s._-]+$/g, '') }
  if (!stem) stem = 'file'
  ext = ext.replace(/[\\/:*?"<>|\u0000-\u001f\s]/g, '')
  if (o.extLower) ext = ext.toLowerCase()
  return stem + ext
}

export function mount(root) {
  useFx()
  const s = { ...PRESETS.web }
  const rn = renameWorkbench({ noun: 'files', compute: (items) => items.map((i) => cleanName(i.name, s)) })
  const upd = () => { tryIt(); rn.refresh() }

  const c = {
    spaces: select([['keep', 'Keep spaces'], ['-', 'Dashes  (my-file.txt)'], ['_', 'Underscores  (my_file.txt)'], ['.', 'Dots  (my.file.txt)'], ['none', 'Remove spaces']], s.spaces, (v) => { s.spaces = v; upd() }),
    caseMode: select([['keep', 'Keep as is'], ['lower', 'lowercase'], ['upper', 'UPPERCASE'], ['title', 'Title Case']], s.caseMode, (v) => { s.caseMode = v; upd() }),
    accents: toggle('Remove accents (café becomes cafe)', s.accents, (v) => { s.accents = v; upd() }),
    special: toggle('Remove special characters (keeps letters, numbers, . _ -)', s.special, (v) => { s.special = v; upd() }),
    ascii: toggle('Plain ASCII only (drops non-Latin letters)', s.ascii, (v) => { s.ascii = v; upd() }),
    collapse: toggle('Collapse repeated separators (a--b becomes a-b)', s.collapse, (v) => { s.collapse = v; upd() }),
    trim: toggle('Trim separators at the start and end', s.trim, (v) => { s.trim = v; upd() }),
    extLower: toggle('Lowercase the extension (.JPG becomes .jpg)', s.extLower, (v) => { s.extLower = v; upd() }),
    copyMarks: toggle('Remove copy markers like (1), - Copy, Copy of', s.copyMarks, (v) => { s.copyMarks = v; upd() }),
    max: number(0, { min: 0, max: 200, step: 1, ariaLabel: 'Maximum name length', onInput: (n) => { s.max = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0; upd() } }),
  }
  const sync = () => {
    c.spaces.value = s.spaces; c.caseMode.value = s.caseMode; c.max.value = s.max
    for (const k of ['accents', 'special', 'ascii', 'collapse', 'trim', 'extLower', 'copyMarks']) c[k].input.checked = s[k]
    upd()
  }
  const presets = [['Web safe', 'web'], ['Tidy but readable', 'readable'], ['snake_case', 'snake'], ['Windows-safe only', 'windows']]
  const presetRow = h('div', { class: 'fx-chips' }, presets.map(([label, k]) => button(label, { size: 'sm', onClick: () => { Object.assign(s, PRESETS[k]); sync() } })))

  const demo = input({ placeholder: 'Type or paste a messy file name, e.g. Café menu (final) #2.PDF', 'aria-label': 'Try a file name', value: '', oninput: () => tryIt() })
  const demoOut = h('code', { class: 'fx-mono', style: 'font-weight:600;overflow-wrap:anywhere' })
  const tryIt = () => { demoOut.textContent = demo.value ? cleanName(demo.value, s) : '' }
  const tryBox = h('div', { class: 'stack tight' }, field('Try a name', demo), h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Result:'), demoOut, copyButton(() => demoOut.textContent, 'Copy')))

  const wrap = h('div', { class: 'stack' },
    h('div', { class: 'stack tight' }, h('div', { class: 'small muted', style: 'font-weight:600' }, 'Quick starts'), presetRow),
    h('div', { class: 'fx-bento' },
      card('Characters', 'brush', '#12a594', h('div', { class: 'stack tight' }, c.accents, c.special, c.ascii, c.copyMarks)),
      card('Spaces and case', 'case-sensitive', '#3e63dd', h('div', { class: 'stack tight' }, field('Spaces', c.spaces), field('Letter case', c.caseMode), c.extLower)),
      card('Finishing touches', 'sparkles', '#d6409f', h('div', { class: 'stack tight' }, c.collapse, c.trim, field('Maximum length (0 = no limit)', c.max, 'Counts the name, not the extension')))))
  root.append(h('div', { class: 'stack fx' }, card('Try it', 'flask-conical', '#6e56cf', tryBox), rn.source, wrap, rn.preview))
}
