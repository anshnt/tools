// Password-protect PDF: open password, permissions, AES-256 (or AES-128 for old viewers). Everything stays on this device.
import { h, icon, busy, progress, input, field, button, toggle, select, alert, segmented, formatBytes, copyText } from '../../lib/ui.js'
import { savePdf } from '../../lib/pdf.js'
import { pdfWorkspace, showResult, outName, css, heading } from './_shared.js'

const CSS = `
.pe-pw { position: relative; }
.pe-pw .input { padding-right: 84px; }
.pe-pw .pe-pw-btns { position: absolute; right: 4px; top: 4px; display: flex; gap: 2px; }
.pe-perms { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr)); gap: 8px; }
.pe-perm { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface); transition: border-color .2s, background .2s; }
.pe-perm:has(input:checked) { border-color: color-mix(in srgb, var(--success) 40%, var(--border)); background: color-mix(in srgb, var(--success) 6%, var(--surface)); }
.pe-perm small { display: block; color: var(--muted); font-size: 12px; }
.pe-perm > div { min-width: 0; }
`

/** 0..4 rough strength score for the meter. */
export function strength(pw) {
  let s = 0
  if (pw.length >= 8) s++
  if (pw.length >= 12) s++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++
  return Math.min(4, s)
}
export function generatePassword(len = 16) {
  const set = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?'
  const buf = new Uint32Array(len)
  crypto.getRandomValues(buf)
  return Array.from(buf, (n) => set[n % set.length]).join('')
}

const PERMS = [
  ['copying', 'Copy text and images', 'Select and copy content'],
  ['modifying', 'Edit the document', 'Change text and pages'],
  ['annotating', 'Add comments', 'Notes, highlights, stamps'],
  ['fillingForms', 'Fill in forms', 'Form fields and signing'],
  ['documentAssembly', 'Organise pages', 'Insert, rotate, delete pages'],
  ['contentAccessibility', 'Screen readers', 'Read aloud for accessibility'],
]

export function mount(root) {
  css('pe-protect', CSS)
  pdfWorkspace(root, {
    label: 'Drop a PDF to protect',
    onLoad(src, ws) {
      const result = h('div'), prog = progress()
      const pw = input({ type: 'password', placeholder: 'Choose a password', autocomplete: 'new-password', 'aria-label': 'Open password', oninput: () => check() })
      const pw2 = input({ type: 'password', placeholder: 'Type it again', autocomplete: 'new-password', 'aria-label': 'Confirm password', oninput: () => check() })
      const owner = input({ type: 'password', placeholder: 'Optional: a different password for changing permissions', autocomplete: 'new-password', 'aria-label': 'Owner password' })
      const meter = h('i'), meterWrap = h('div', { class: 'pe-meter' }, meter)
      const msg = h('small', { class: 'field-hint', 'aria-live': 'polite' })
      const eye = button('', { icon: 'eye', variant: 'ghost', size: 'sm', ariaLabel: 'Show password', onClick: () => { const show = pw.type === 'password'; pw.type = pw2.type = show ? 'text' : 'password'; eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password') } })
      const gen = button('', { icon: 'wand-sparkles', variant: 'ghost', size: 'sm', ariaLabel: 'Generate a strong password', title: 'Generate a strong password', onClick: () => { pw.value = pw2.value = generatePassword(); pw.type = pw2.type = 'text'; check(); copyText(pw.value) } })
      const needOpen = toggle('Ask for a password to open the file', true, () => check())
      const printing = select([['highResolution', 'Allowed (high quality)'], ['lowResolution', 'Allowed (low quality)'], ['none', 'Not allowed']], 'highResolution')
      const perms = Object.fromEntries(PERMS.map(([k]) => [k, { input: h('input', { type: 'checkbox', role: 'switch', checked: true, 'aria-label': PERMS.find((x) => x[0] === k)[1] }) }]))
      const algo = segmented([['AES-256', 'AES-256 (recommended)'], ['AES-128', 'AES-128 (older viewers)']], 'AES-256', undefined, 'Encryption')
      const btn = button('Protect PDF', { icon: 'lock', variant: 'primary', size: 'lg', onClick: () => run() })

      function preset(name) {
        for (const [k] of PERMS) perms[k].input.checked = name === 'all' || (name === 'print' && k === 'contentAccessibility')
        printing.value = name === 'readonly' ? 'none' : 'highResolution'
        if (name === 'readonly') perms.contentAccessibility.input.checked = true
      }
      function check() {
        const v = pw.value
        const sc = strength(v)
        meter.style.width = `${v ? 20 + sc * 20 : 0}%`
        meter.style.background = ['var(--danger)', 'var(--danger)', 'var(--warning)', 'var(--success)', 'var(--success)'][sc]
        msg.textContent = !needOpen.input.checked ? 'No open password: anyone can read the file, but the permissions below still apply.' : !v ? '' : pw2.value && pw2.value !== v ? 'The two passwords do not match.' : sc < 2 ? 'Weak. Try 12 or more characters with a mix of letters and numbers.' : sc < 4 ? 'Decent. Longer is stronger.' : 'Strong password.'
        pw.disabled = pw2.disabled = !needOpen.input.checked
        btn.disabled = needOpen.input.checked && (!v || v !== pw2.value)
      }

      async function run() {
        const open = needOpen.input.checked ? pw.value : ''
        const restricted = !printing.value.startsWith('high') || Object.values(perms).some((t) => !t.input.checked)
        await busy(btn, async () => {
          if (!open && !restricted) throw new Error('Choose an open password, or turn off at least one permission.')
          prog.set(null, 'Encrypting')
          const doc = await src.edit()
          const permissions = { printing: printing.value === 'none' ? false : printing.value }
          for (const [k] of PERMS) permissions[k] = perms[k].input.checked
          // when permissions are restricted, a separate owner password stops the open password from lifting them
          const ownerPassword = owner.value || (restricted ? generatePassword(24) : open)
          doc.encrypt({ userPassword: open || '', ownerPassword, permissions, algorithm: algo.value })
          const blob = await savePdf(doc)
          await showResult(result, {
            blob, name: outName(src.file, 'protected'), title: 'Your PDF is protected', password: open || undefined,
            lead: open ? 'It now asks for the password before it opens. Keep the password safe: it cannot be recovered.' : 'It opens without a password, with the permissions you chose.',
            facts: [{ label: 'Encryption', value: algo.value }, { label: 'Open password', value: open ? 'Required' : 'None' }, { label: 'File size', value: formatBytes(blob.size) }],
            note: 'Permissions are enforced by well-behaved PDF viewers. Only the open password truly keeps the content private.', again: ws.reset,
          })
        }, { label: 'Encrypting', errorTo: result, progress: prog })
      }

      check()
      const left = h('section', { class: 'panel stack' }, heading('key-round', 'Password'),
        needOpen,
        field('Open password', h('div', { class: 'pe-pw' }, pw, h('div', { class: 'pe-pw-btns' }, eye, gen))),
        meterWrap, msg,
        field('Confirm password', pw2),
        field('Owner password (advanced)', owner, 'Needed to change permissions later. If you leave it empty and restrict something, a random one is set.'))
      const right = h('section', { class: 'panel stack' }, heading('shield-check', 'What people can do'),
        h('div', { class: 'row' }, button('Allow everything', { variant: 'secondary', size: 'sm', onClick: () => preset('all') }), button('Read only', { variant: 'secondary', size: 'sm', onClick: () => preset('readonly') }), button('Print only', { variant: 'secondary', size: 'sm', onClick: () => preset('print') })),
        field('Printing', printing),
        h('div', { class: 'pe-perms' }, PERMS.map(([k, t, d]) => h('label', { class: 'pe-perm' }, h('div', h('b', { style: 'font-size:13.5px' }, t), h('small', d)), h('span', { class: 'switch' }, perms[k].input)))),
        field('Encryption', algo))
      return [h('div', { class: 'tool-split' }, left, right), h('div', { class: 'row' }, btn, h('span', { class: 'small muted' }, 'Encrypted in your browser. The file and the password never leave this device.')), prog.el, result]
    },
  })
}
