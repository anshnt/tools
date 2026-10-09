// chmod calculator: permission grid <-> octal <-> symbolic (rwxr-xr-x), special bits, ready-to-run commands, symbolic changes and umask.
import { h, button, input, segmented, toggle, alert, clear, table } from '../../lib/ui.js'
import { useKit, css, eyebrow, copyRow, hashParams } from './_kit.js'

// mode bits: 0o4000 setuid, 0o2000 setgid, 0o1000 sticky, then rwx for user (0o400..), group (0o040..), other (0o004..)
const WHO = [['u', 'Owner', 6], ['g', 'Group', 3], ['o', 'Others', 0]]
const BITS = [['r', 'Read', 4], ['w', 'Write', 2], ['x', 'Execute', 1]]

export const octal = (mode) => (mode > 0o777 ? mode.toString(8).padStart(4, '0') : mode.toString(8).padStart(3, '0'))

/** rwxr-xr-x style string, with s/S/t/T for the special bits. */
export function symbolic(mode) {
  let out = ''
  for (const [, , shift] of WHO) {
    const p = (mode >> shift) & 7
    out += p & 4 ? 'r' : '-'
    out += p & 2 ? 'w' : '-'
    const x = p & 1
    const special = shift === 6 ? mode & 0o4000 : shift === 3 ? mode & 0o2000 : mode & 0o1000
    out += special ? (shift === 0 ? (x ? 't' : 'T') : x ? 's' : 'S') : x ? 'x' : '-'
  }
  return out
}

/** Parse "rwxr-xr-x", "-rwxr-xr-x" or "drwxrwxrwt" into a mode, or null. */
export function parseSymbolic(text) {
  let t = text.trim()
  if (/^[-dlcbps]/.test(t) && t.length === 10) t = t.slice(1)
  if (!/^[r-][w-][xsS-][r-][w-][xsS-][r-][w-][xtT-]$/.test(t)) return null
  let mode = 0
  ;[0, 3, 6].forEach((i, k) => {
    const shift = 6 - k * 3
    if (t[i] === 'r') mode |= 4 << shift
    if (t[i + 1] === 'w') mode |= 2 << shift
    const c = t[i + 2]
    if (c === 'x' || c === 's' || c === 't') mode |= 1 << shift
    if (c === 's' || c === 'S') mode |= shift === 6 ? 0o4000 : 0o2000
    if (c === 't' || c === 'T') mode |= 0o1000
  })
  return mode
}

export function parseOctal(text) {
  const t = text.trim().replace(/^0o/i, '')
  if (!/^[0-7]{1,4}$/.test(t)) return null
  return parseInt(t, 8)
}

/** Apply a chmod symbolic expression such as "u+x,go-w" or "a=rX" to a mode. Throws a readable Error. */
export function applySymbolic(mode, expr, { dir = false } = {}) {
  let m = mode
  for (const clause of expr.split(',').map((c) => c.trim()).filter(Boolean)) {
    const g = /^([ugoa]*)([-+=])([rwxXst]*|[ugo])$/.exec(clause)
    if (!g) throw new Error(`"${clause}" is not a valid chmod clause. Use who (u g o a), an operator (+ - =) and permissions (r w x X s t), for example u+x or go-w.`)
    const who = g[1] ? [...new Set(g[1].includes('a') ? ['u', 'g', 'o'] : [...g[1]])] : ['u', 'g', 'o']
    const op = g[2]
    let perm = 0
    let special = 0
    if (/^[ugo]$/.test(g[3])) {
      const from = WHO.find(([k]) => k === g[3])[2]
      perm = (m >> from) & 7
    } else {
      for (const ch of g[3]) {
        if (ch === 'r') perm |= 4
        else if (ch === 'w') perm |= 2
        else if (ch === 'x') perm |= 1
        else if (ch === 'X') { if (dir || m & 0o111) perm |= 1 } else if (ch === 's') { if (who.includes('u')) special |= 0o4000; if (who.includes('g')) special |= 0o2000 } else if (ch === 't') special |= 0o1000
      }
    }
    for (const w of who) {
      const shift = WHO.find(([k]) => k === w)[2]
      if (op === '+') m |= perm << shift
      else if (op === '-') m &= ~(perm << shift)
      else m = (m & ~(7 << shift)) | (perm << shift)
    }
    if (op === '+') m |= special
    else if (op === '-') m &= ~special
    else {
      if (!dir) { if (who.includes('u')) m &= ~0o4000; if (who.includes('g')) m &= ~0o2000 } // "=" resets setuid/setgid on files
      m |= special
    }
  }
  return m
}

const classText = (p, name) => {
  const can = [p & 4 && 'read', p & 2 && 'write', p & 1 && 'execute'].filter(Boolean)
  if (!can.length) return `${name} have no access`
  return `${name} can ${can.length === 1 ? can[0] : can.slice(0, -1).join(', ') + ' and ' + can[can.length - 1]}`
}

export function describe(mode, dir) {
  const parts = WHO.map(([, name, shift]) => classText((mode >> shift) & 7, name === 'Owner' ? 'the owner' : name === 'Group' ? 'the group' : 'everyone else'))
  const extra = []
  if (mode & 0o4000) extra.push(dir ? 'Setuid on a directory is ignored on most systems' : 'Setuid: the program runs with the owner’s privileges')
  if (mode & 0o2000) extra.push(dir ? 'Setgid: new files inherit the directory’s group' : 'Setgid: the program runs with the group’s privileges')
  if (mode & 0o1000) extra.push(dir ? 'Sticky bit: only a file’s owner can delete or rename it' : 'Sticky bit: rarely used on regular files')
  return { parts, extra }
}

const PRESETS = [
  [0o644, 'Regular file'], [0o755, 'Script / program'], [0o600, 'Private file'], [0o700, 'Private program'], [0o664, 'Group-writable file'], [0o775, 'Group-writable dir'],
  [0o400, 'Read-only (keys)'], [0o444, 'Read-only for all'], [0o777, 'Everything (avoid)'], [0o1777, '/tmp style'], [0o2775, 'Shared dir (setgid)'], [0o4755, 'Setuid program'],
]

const STYLE = `
.t-cm .cm-grid { display: grid; grid-template-columns: minmax(70px, auto) repeat(3, minmax(0, 1fr)); gap: 8px; align-items: stretch; }
.t-cm .cm-grid > .hd { font-size: 12px; font-weight: 650; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); padding: 4px 0; text-align: center; }
.t-cm .cm-grid > .rl { display: flex; align-items: center; font-size: 13.5px; font-weight: 600; }
.t-cm .cm-cell { position: relative; display: grid; place-items: center; min-height: 54px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; transition: background .2s, border-color .2s, transform .2s var(--spring); user-select: none; }
.t-cm .cm-cell:hover { border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); transform: translateY(-1px); }
.t-cm .cm-cell input { position: absolute; inset: 0; opacity: 0; cursor: pointer; margin: 0; }
.t-cm .cm-cell b { font-family: var(--mono); font-size: 20px; color: var(--muted); transition: color .2s, transform .3s var(--spring); }
.t-cm .cm-cell:has(input:checked) { background: var(--accent-soft); border-color: var(--accent); }
.t-cm .cm-cell:has(input:checked) b { color: var(--accent); transform: scale(1.15); }
.t-cm .cm-cell:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.t-cm .cm-cell.sp:has(input:checked) { background: var(--warning-soft); border-color: var(--warning); }
.t-cm .cm-cell.sp:has(input:checked) b { color: var(--warning); }
.t-cm .cm-cell small { position: absolute; bottom: 3px; font-size: 10px; color: var(--muted); }
.t-cm .cm-oct { font-family: var(--mono); font-size: clamp(44px, 9vw, 72px); font-weight: 700; letter-spacing: .06em; line-height: 1; background: var(--brand); -webkit-background-clip: text; background-clip: text; color: transparent; }
.t-cm .cm-sym { font-family: var(--mono); font-size: clamp(17px, 3.6vw, 24px); letter-spacing: .12em; }
.t-cm ul.cm-list { margin: 0; padding-left: 18px; display: grid; gap: 4px; font-size: 14px; }
`

export function mount(root) {
  useKit()
  css('t-cm-css', STYLE)
  const q = hashParams()
  let mode = parseOctal(q.get('m') || '') ?? 0o644
  let isDir = false
  const checks = {}
  const gridEl = h('div', { class: 'cm-grid' }, h('span'), WHO.map(([, n]) => h('div', { class: 'hd' }, n)))
  for (const [bk, bn, bv] of BITS) {
    gridEl.append(h('div', { class: 'rl' }, bn))
    for (const [wk, wn, shift] of WHO) {
      const cb = h('input', { type: 'checkbox', 'aria-label': `${wn} ${bn.toLowerCase()}`, onchange: () => { mode = readGrid(); sync('grid') } })
      checks[`${wk}${bk}`] = { cb, mask: bv << shift }
      gridEl.append(h('label', { class: 'cm-cell' }, cb, h('b', bk), h('small', bv)))
    }
  }
  const specials = [['setuid', 0o4000, 'u+s'], ['setgid', 0o2000, 'g+s'], ['sticky', 0o1000, '+t']].map(([name, mask]) => {
    const cb = h('input', { type: 'checkbox', 'aria-label': name, onchange: () => { mode = readGrid(); sync('grid') } })
    checks[name] = { cb, mask }
    return h('label', { class: 'cm-cell sp' }, cb, h('b', name === 'setuid' ? 'SUID' : name === 'setgid' ? 'SGID' : 'Sticky'), h('small', mask.toString(8)))
  })
  function readGrid() { return Object.values(checks).reduce((m, { cb, mask }) => (cb.checked ? m | mask : m), 0) }

  const octIn = input({ mono: true, value: octal(mode), 'aria-label': 'Octal mode', maxlength: 5, spellcheck: false, inputmode: 'numeric', oninput: (e) => { const v = parseOctal(e.target.value); e.target.classList.toggle('invalid', v == null && !!e.target.value); if (v != null) { mode = v; sync('oct') } } })
  const symIn = input({ mono: true, value: symbolic(mode), 'aria-label': 'Symbolic mode', maxlength: 10, spellcheck: false, oninput: (e) => { const v = parseSymbolic(e.target.value); e.target.classList.toggle('invalid', v == null && !!e.target.value); if (v != null) { mode = v; sync('sym') } } })
  const bigOct = h('div', { class: 'cm-oct', 'aria-label': 'Octal result' })
  const bigSym = h('div', { class: 'cm-sym' })
  const typeSeg = segmented([['file', 'File'], ['dir', 'Directory']], 'file', (v) => { isDir = v === 'dir'; sync() }, 'Target type')
  const rec = toggle('Recursive (-R)', false, () => sync())
  const target = input({ mono: true, value: 'file.txt', 'aria-label': 'Path used in commands', spellcheck: false, oninput: () => sync() })
  const cmds = h('div', { class: 'stack tight' })
  const explainEl = h('div', { class: 'stack tight' })

  const cmdVals = {}
  const cmdRows = [copyRow('octal', () => cmdVals.oct), copyRow('symbolic', () => cmdVals.sym), copyRow('ls -l', () => cmdVals.ls), copyRow('find', () => cmdVals.find)]
  clear(cmds, ...cmdRows)

  // symbolic change
  const chIn = input({ mono: true, value: 'u+x,go-w', 'aria-label': 'Symbolic change', spellcheck: false, oninput: () => change() })
  const chOut = h('div', { class: 'stack tight' })
  function change() {
    clear(chOut)
    if (!chIn.value.trim()) return
    try {
      const nm = applySymbolic(mode, chIn.value, { dir: isDir })
      chOut.append(h('div', { class: 'row' }, h('span', { class: 'small muted' }, `${octal(mode)} (${symbolic(mode)})`), h('span', '→'), h('b', { style: 'font-family:var(--mono)' }, `${octal(nm)} (${symbolic(nm)})`),
        button('Use this', { size: 'sm', onClick: () => { mode = nm; sync() } })))
    } catch (e) { chOut.append(alert('warn', e.message)) }
  }

  // umask
  const umIn = input({ mono: true, value: '022', 'aria-label': 'umask', maxlength: 4, spellcheck: false, inputmode: 'numeric', oninput: () => um() })
  const umOut = h('div')
  function um() {
    const u = parseOctal(umIn.value)
    if (u == null) { clear(umOut, h('div', { class: 'small', style: 'color:var(--danger)' }, 'Enter an octal umask such as 022 or 077.')); return }
    const f = 0o666 & ~u, d = 0o777 & ~u
    clear(umOut, table({ columns: ['New', 'Default mode', 'Symbolic'], rows: [['File', octal(f), symbolic(f)], ['Directory', octal(d), symbolic(d)]] }))
  }

  function sync(from) {
    for (const { cb, mask } of Object.values(checks)) cb.checked = (mode & mask) === mask
    if (from !== 'oct') octIn.value = octal(mode)
    if (from !== 'sym') symIn.value = symbolic(mode)
    if (from !== 'oct') octIn.classList.remove('invalid')
    if (from !== 'sym') symIn.classList.remove('invalid')
    const o = octal(mode)
    bigOct.textContent = o
    const s = symbolic(mode)
    bigSym.textContent = `${isDir ? 'd' : '-'}${s}`
    const path = target.value.trim() || 'file.txt'
    const R = rec.input.checked ? '-R ' : ''
    const quoted = /^[\w./@%+=:,-]+$/.test(path) ? path : `'${path.replace(/'/g, "'\\''")}'`
    cmdVals.oct = `chmod ${R}${o} ${quoted}`
    const wh = (n) => ['r', 'w', 'x'].map((c, i) => ((n >> (2 - i)) & 1 ? c : '')).join('')
    cmdVals.sym = `chmod ${R}u=${wh((mode >> 6) & 7)}${mode & 0o4000 ? 's' : ''},g=${wh((mode >> 3) & 7)}${mode & 0o2000 ? 's' : ''},o=${wh(mode & 7)}${mode & 0o1000 ? 't' : ''} ${quoted}`
    cmdVals.ls = `${isDir ? 'd' : '-'}${s}  1 user group 4096 Jan  1 12:00 ${path}`
    cmdVals.find = `find ${isDir ? quoted : '.'} -type f -exec chmod ${o} {} +`
    cmdRows[0].set(cmdVals.oct); cmdRows[1].set(cmdVals.sym); cmdRows[2].set(cmdVals.ls); cmdRows[3].set(cmdVals.find)
    const d = describe(mode, isDir)
    clear(explainEl, h('ul', { class: 'cm-list' }, d.parts.map((t) => h('li', t)), d.extra.map((t) => h('li', { style: 'color:var(--warning)' }, t))),
      mode & 0o002 && !(mode & 0o1000) ? alert('warn', 'Everyone can write to this. That is rarely what you want outside of a sticky directory like /tmp.') : null,
      (mode & 0o111) && !isDir && (mode & 0o777) === 0o777 ? alert('warn', '777 lets any user on the machine change and run this file.') : null)
    change()
  }

  const presets = h('div', { class: 'dv-chips' }, PRESETS.map(([m, l]) => h('button', { type: 'button', class: 'dv-chip', title: symbolic(m), onclick: () => { mode = m; sync() } }, h('b', { style: 'font-family:var(--mono)' }, octal(m)), ' ', l)))

  root.append(h('div', { class: 'dv t-cm stack' },
    h('div', { class: 'tool-split' },
      h('div', { class: 'panel stack' }, h('div', { class: 'row between' }, eyebrow('shield', 'Permissions'), typeSeg), gridEl, h('div', { class: 'small muted' }, 'Special bits'), h('div', { class: 'cm-grid', style: 'grid-template-columns:repeat(3,minmax(0,1fr))' }, specials),
        h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Presets'), presets)),
      h('div', { class: 'stack' },
        h('div', { class: 'dv-hero stack tight', style: 'text-align:center' }, bigOct, bigSym, h('div', { class: 'grid-2', style: 'text-align:left;margin-top:10px' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Octal'), octIn), h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Symbolic'), symIn))),
        h('div', { class: 'panel stack tight' }, eyebrow('list-checks', 'What this allows'), explainEl),
        h('div', { class: 'panel stack tight' }, h('div', { class: 'row between' }, eyebrow('terminal', 'Commands'), rec), h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Path'), target), cmds))),
    h('div', { class: 'tool-split' },
      h('div', { class: 'panel stack tight' }, eyebrow('wand-sparkles', 'Apply a symbolic change'), h('div', { class: 'small muted' }, 'Start from the mode above and apply chmod-style changes like u+x, g-w, o=r or a+rX.'), chIn, chOut),
      h('div', { class: 'panel stack tight' }, eyebrow('eye-off', 'umask calculator'), h('div', { class: 'small muted' }, 'The umask removes bits from the default of 666 (files) or 777 (directories).'), umIn, umOut)),
    h('p', { class: 'small muted' }, 'Each digit is a sum: read 4 + write 2 + execute 1, for owner, group and others. A leading fourth digit adds setuid (4), setgid (2) and the sticky bit (1). Everything is calculated in your browser; nothing runs on your files.')))
  sync()
  um()
}
