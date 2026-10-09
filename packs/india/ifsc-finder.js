// IFSC code finder: bank, branch, address, MICR and payment rails from https://ifsc.razorpay.com/<IFSC> (free public API, no key).
import { h, panel, stack, input, field, button, busy, alert, clear, icon, copyButton, copyText } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { BANKS } from './_ids.js'
import { useStyles, style, note, kv, link, query } from './_shared.js'

const CSS = `
.in-ifsc-head { display: grid; gap: 6px; }
.in-ifsc-head .bank { font-size: 13px; color: var(--muted); }
.in-ifsc-head .code { font-family: var(--mono); font-size: clamp(22px, 6vw, 32px); font-weight: 700; letter-spacing: .04em; color: var(--accent); overflow-wrap: anywhere; }
.in-rails { display: flex; flex-wrap: wrap; gap: 8px; }
.in-rails span { display: inline-flex; gap: 6px; align-items: center; padding: 4px 11px; border-radius: 99px; font-size: 13px; font-weight: 600; border: 1px solid var(--border); background: var(--surface-2); color: var(--muted); }
.in-rails span.on { background: var(--success-soft); color: var(--success); border-color: color-mix(in srgb, var(--success) 30%, transparent); }
.in-rails .icon { width: 14px; height: 14px; }
.in-recent { display: flex; flex-wrap: wrap; gap: 8px; }
.in-recent button { border: 1px solid var(--border); background: var(--surface-2); border-radius: 99px; padding: 5px 12px; font-family: var(--mono); font-size: 12.5px; cursor: pointer; color: var(--text-2); min-height: 32px; }
.in-recent button:hover { border-color: var(--accent); background: var(--accent-soft); }
`
const FORMAT = /^[A-Z]{4}0[A-Z0-9]{6}$/
const KEY = 'india:ifsc-recent'

export async function lookup(code, signal) {
  const res = await fetch(`https://ifsc.razorpay.com/${encodeURIComponent(code)}`, { signal })
  if (res.status === 404) throw Object.assign(new Error('No branch found for this IFSC. Check the code on your cheque book or passbook.'), { notFound: true })
  if (!res.ok) throw new Error(`The IFSC service replied with an error (${res.status}). Try again in a moment.`)
  return res.json()
}

export function mount(root, { signal }) {
  useStyles()
  style('in-ifsc', CSS)
  const code = input({ placeholder: 'e.g. HDFC0000001', maxlength: 11, autocomplete: 'off', spellcheck: false, 'aria-label': 'IFSC code', style: 'text-transform:uppercase;font-family:var(--mono);font-size:18px;letter-spacing:.06em' })
  const go = button('Find branch', { icon: 'search', variant: 'primary', size: 'lg' })
  const hintEl = h('div', { class: 'small muted', 'aria-live': 'polite' })
  const result = h('div', { class: 'stack' })
  const recentBox = h('div')
  let recent = load(KEY, [])

  function drawRecent() {
    clear(recentBox, recent.length ? h('div', { class: 'stack', style: 'gap:8px' }, h('div', { class: 'small muted' }, 'Recent on this device'),
      h('div', { class: 'in-recent' }, recent.map((c) => h('button', { type: 'button', onclick: () => { code.value = c; run() } }, c)), button('Clear', { variant: 'ghost', size: 'sm', onClick: () => { recent = []; save(KEY, recent); drawRecent() } }))) : null)
  }

  function validate() {
    const v = code.value.trim().toUpperCase()
    if (!v) { hintEl.textContent = ''; return null }
    if (v.length < 11) { hintEl.textContent = `${v.length} of 11 characters` + (BANKS[v.slice(0, 4)] ? ` - ${BANKS[v.slice(0, 4)]}` : ''); return null }
    if (!FORMAT.test(v)) { hintEl.textContent = 'An IFSC has 4 letters, then 0, then 6 letters or digits'; return false }
    hintEl.textContent = BANKS[v.slice(0, 4)] ? `Format looks right - ${BANKS[v.slice(0, 4)]}` : 'Format looks right'
    return true
  }

  function draw(d) {
    const rails = [['UPI', d.UPI], ['NEFT', d.NEFT], ['RTGS', d.RTGS], ['IMPS', d.IMPS]]
    const text = [`${d.BANK}`, `IFSC: ${d.IFSC}`, `Branch: ${d.BRANCH}`, `MICR: ${d.MICR || '-'}`, `Address: ${d.ADDRESS}`, `City: ${d.CITY}, ${d.DISTRICT}, ${d.STATE}`, d.CONTACT ? `Contact: ${d.CONTACT}` : null].filter(Boolean).join('\n')
    const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${d.BANK} ${d.BRANCH} ${d.CITY} ${d.STATE}`)}`
    clear(result,
      panel(h('div', { class: 'stack' },
        h('div', { class: 'in-ifsc-head' }, h('div', { class: 'bank' }, d.BANK), h('div', { class: 'code' }, d.IFSC), h('div', { style: 'font-weight:600' }, d.BRANCH)),
        h('div', { class: 'in-rails', 'aria-label': 'Payment systems' }, rails.map(([n, on]) => h('span', { class: on ? 'on' : '' }, icon(on ? 'circle-check' : 'circle-x'), `${n} ${on ? 'yes' : 'no'}`))),
        kv([
          { label: 'Bank', value: d.BANK },
          { label: 'Branch', value: d.BRANCH },
          { label: 'IFSC', value: d.IFSC },
          { label: 'MICR', value: d.MICR || 'Not available' },
          { label: 'SWIFT', value: d.SWIFT || 'Not available' },
          { label: 'Address', value: h('span', { style: 'white-space:normal' }, d.ADDRESS) },
          { label: 'City / district', value: `${d.CITY} / ${d.DISTRICT}` },
          { label: 'State', value: d.STATE },
          { label: 'Phone', value: d.CONTACT || 'Not available' },
        ]),
        h('div', { class: 'row' },
          copyButton(() => d.IFSC, 'Copy IFSC'), d.MICR ? copyButton(() => d.MICR, 'Copy MICR') : null, copyButton(() => text, 'Copy all'),
          h('a', { class: 'btn btn-secondary btn-sm', href: map, target: '_blank', rel: 'noopener noreferrer' }, icon('map-pin'), h('span', 'Open in Maps')),
          button('Copy share link', { icon: 'link', size: 'sm', onClick: () => copyText(`${location.origin}${location.pathname}#/ifsc-finder?code=${d.IFSC}`) })))))
  }

  async function run() {
    const v = code.value.trim().toUpperCase()
    code.value = v
    if (validate() !== true) return clear(result, alert('warn', 'Enter all 11 characters of the IFSC code, for example HDFC0000001.'))
    await busy(go, async () => {
      clear(result, h('div', { class: 'empty loading' }, h('span', { class: 'spinner' }), h('div', 'Looking up the branch')))
      try {
        const d = await lookup(v, signal)
        draw(d)
        recent = [v, ...recent.filter((c) => c !== v)].slice(0, 6)
        save(KEY, recent)
        drawRecent()
        history.replaceState(null, '', `#/ifsc-finder?code=${v}`)
      } catch (e) {
        if (e.name === 'AbortError') return
        clear(result, alert(e.notFound ? 'warn' : 'error', e.notFound ? e.message : (e instanceof TypeError ? 'Could not reach the IFSC service. Check your connection and try again.' : e.message)))
      }
    }, { label: 'Searching' })
  }

  code.addEventListener('input', validate)
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') run() })
  go.addEventListener('click', run)
  drawRecent()
  root.append(stack(
    panel(h('div', { class: 'stack' }, field('IFSC code', code), hintEl, h('div', { class: 'row' }, go), recentBox)),
    result,
    note('Branch data comes from the free ', link('https://ifsc.razorpay.com/', 'Razorpay IFSC API'), ', which republishes the RBI lists. Only the IFSC you type is sent. Banks merge and change codes, so confirm on your cheque book or net banking before a large transfer.')))
  const first = query().get('code')
  if (first) { code.value = first; run() }
}
