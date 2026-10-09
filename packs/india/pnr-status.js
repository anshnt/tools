// Train PNR helper: checks the PNR format and hands you to the official status pages (no scraping, nothing is sent from this page).
import { h, card, panel, stack, input, field, alert, clear, icon, copyText, debounce } from '../../lib/ui.js'
import { checkPnr, STATUS_GUIDE } from './_trains.js'
import { useStyles, style, note, link, guide } from './_shared.js'

const SITES = [
  { name: 'Indian Railways PNR enquiry', url: 'https://www.indianrail.gov.in/enquiry/PNR/PnrEnquiry.html?locale=en', hint: 'Official page of the Railways. Type the PNR and the captcha.' },
  { name: 'NTES (National Train Enquiry System)', url: 'https://enquiry.indianrail.gov.in/mntes/', hint: 'Live running status, platform number and schedule.' },
  { name: 'IRCTC', url: 'https://www.irctc.co.in/', hint: 'Sign in, then open Booking > PNR Status.' },
]

export function mount(root) {
  useStyles()
  style('in-pnr', '.in-pnr-sites{display:grid;gap:10px}.in-pnr-site{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid var(--border);border-radius:14px;background:var(--surface);text-decoration:none;color:var(--text);transition:border-color .2s,transform .2s}.in-pnr-site:hover{border-color:var(--accent);transform:translateY(-1px)}.in-pnr-site strong{display:block;font-size:14.5px}.in-pnr-site small{color:var(--muted);font-size:12.5px}.in-pnr-site .icon{flex:none;color:var(--accent)}')
  const pnr = input({ inputmode: 'numeric', maxlength: 14, placeholder: '10-digit PNR, e.g. 4512345678', autocomplete: 'off', 'aria-label': 'PNR number', style: 'font-size:22px;letter-spacing:.08em;font-family:var(--mono);font-weight:600' })
  const status = h('div', { 'aria-live': 'polite' })
  const sites = h('div', { class: 'in-pnr-sites' })

  function render() {
    const r = checkPnr(pnr.value)
    clear(sites)
    if (r.empty) return clear(status, h('div', { class: 'small muted' }, 'The PNR is printed on your ticket and in the booking SMS or email.'))
    if (!r.ok) return clear(status, alert('info', r.message))
    clear(status, alert('success', h('strong', r.message), ' Now open one of the official pages below. The number is copied for you, so paste it in.'))
    for (const s of SITES) {
      sites.append(h('a', { class: 'in-pnr-site', href: s.url, target: '_blank', rel: 'noopener noreferrer', onclick: () => copyText(r.pnr) },
        h('div', h('strong', s.name), h('small', s.hint)), icon('external-link')))
    }
  }
  pnr.addEventListener('input', debounce(render, 30))

  root.append(stack(
    panel(h('div', { class: 'stack' }, field('PNR number', pnr), status, sites)),
    alert('info', h('strong', 'Why not show the status here? '), 'Live PNR status exists only inside the Railways\' own systems, which ask for a captcha, so a web page like this cannot fetch it. We check your number and take you to the official pages instead. Railway helpline: call 139.'),
    card('How to read your status', guide(STATUS_GUIDE)),
    note('Never share your PNR with someone who asks for it together with an OTP or a payment: it is not needed for either. Official sites: ', link('https://www.indianrail.gov.in/', 'indianrail.gov.in'), ' and ', link('https://www.irctc.co.in/', 'irctc.co.in'), '. Nothing you type here leaves your device.')))
  render()
}
