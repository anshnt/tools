// QR code generator. Serves qr-generator (all types), wifi-qr, vcard-qr, upi-qr and whatsapp-link via params.type.
import { h, icon, button, field, input, textarea, select, toggle, segmented, rangeField, tabs, split, panel, alert, clear, downloadButton, download, copyText, toast, debounce, onCleanup } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { ensureStyle, pill, note, chipGroup, copyImage, slug } from './_shared.js'
import { qrMatrix, buildQr, qrPng, SHAPES, EYE_FRAMES, EYE_BALLS, contrast, logoCoverage, logoDataUrl, QR_MAX_BYTES } from './_qr.js'

// ---------- Payload builders (pure, exported for tests) ----------
const wifiEsc = (s) => String(s).replace(/([\\;,:"])/g, '\\$1')
const vEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1')
const digits = (s) => String(s || '').replace(/\D/g, '')
const pad = (n) => String(n).padStart(2, '0')
const icsDate = (v, allDay) => {
  const d = new Date(v)
  if (Number.isNaN(+d)) return ''
  const day = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  return allDay ? day : `${day}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}
const icsEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1')

export const VPA_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/

/** Each builder returns {text} | {error} | {empty: 'hint'} from the current field values. */
export const BUILDERS = {
  url(v) {
    let s = (v.url || '').trim()
    if (!s) return { empty: 'Type or paste a link to see its QR code.' }
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`
    return { text: s }
  },
  text(v) {
    return v.text ? { text: v.text } : { empty: 'Type some text to see its QR code.' }
  },
  email(v) {
    const to = (v.to || '').trim()
    if (!to) return { empty: 'Enter an email address.' }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { error: 'That email address does not look right.' }
    const q = [v.subject && `subject=${encodeURIComponent(v.subject)}`, v.body && `body=${encodeURIComponent(v.body)}`].filter(Boolean).join('&')
    return { text: `mailto:${to}${q ? `?${q}` : ''}` }
  },
  phone(v) {
    const n = (v.phone || '').replace(/[^\d+]/g, '')
    if (!n) return { empty: 'Enter a phone number.' }
    if (digits(n).length < 5) return { error: 'That phone number looks too short.' }
    return { text: `tel:${n}` }
  },
  sms(v) {
    const n = (v.phone || '').replace(/[^\d+]/g, '')
    if (!n) return { empty: 'Enter the phone number to text.' }
    return { text: `sms:${n}${v.message ? `?body=${encodeURIComponent(v.message)}` : ''}` }
  },
  wifi(v) {
    if (!v.ssid) return { empty: 'Enter your Wi-Fi network name to see the code.' }
    const sec = v.security || 'WPA'
    if (sec !== 'nopass' && !v.password) return { empty: 'Enter the Wi-Fi password, or choose "No password".' }
    return { text: `WIFI:T:${sec};S:${wifiEsc(v.ssid)};${sec !== 'nopass' ? `P:${wifiEsc(v.password)};` : ''}${v.hidden ? 'H:true;' : ''};` }
  },
  vcard(v) {
    if (!(v.first || v.last || v.org)) return { empty: 'Add a name or company to build the contact card.' }
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) return { error: 'That email address does not look right.' }
    const fn = [v.first, v.last].filter(Boolean).join(' ') || v.org
    const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${vEsc(v.last || '')};${vEsc(v.first || '')};;;`, `FN:${vEsc(fn)}`]
    if (v.org) lines.push(`ORG:${vEsc(v.org)}`)
    if (v.title) lines.push(`TITLE:${vEsc(v.title)}`)
    if (v.mobile) lines.push(`TEL;TYPE=CELL,VOICE:${v.mobile.trim()}`)
    if (v.work) lines.push(`TEL;TYPE=WORK,VOICE:${v.work.trim()}`)
    if (v.email) lines.push(`EMAIL;TYPE=INTERNET:${v.email.trim()}`)
    if (v.website) lines.push(`URL:${v.website.trim()}`)
    if (v.street || v.city || v.state || v.zip || v.country) lines.push(`ADR;TYPE=WORK:;;${vEsc(v.street || '')};${vEsc(v.city || '')};${vEsc(v.state || '')};${vEsc(v.zip || '')};${vEsc(v.country || '')}`)
    if (v.note) lines.push(`NOTE:${vEsc(v.note)}`)
    lines.push('END:VCARD')
    return { text: lines.join('\r\n') }
  },
  upi(v) {
    const pa = (v.pa || '').trim()
    if (!pa) return { empty: 'Enter the UPI ID you want to receive money on, for example name@okhdfcbank.' }
    if (!VPA_RE.test(pa)) return { error: 'That UPI ID does not look right. It should look like name@bank.' }
    let am = ''
    if (String(v.am || '').trim() !== '') {
      const n = Number(v.am)
      if (!Number.isFinite(n) || n <= 0) return { error: 'Enter an amount greater than 0, or leave it empty.' }
      if (!/^\d+(\.\d{1,2})?$/.test(String(v.am).trim())) return { error: 'The amount can have at most 2 decimal places.' }
      am = String(v.am).trim()
    }
    const q = [`pa=${pa}`, v.pn && `pn=${encodeURIComponent(v.pn.trim())}`, am && `am=${am}`, 'cu=INR', v.tn && `tn=${encodeURIComponent(v.tn.trim())}`].filter(Boolean)
    return { text: `upi://pay?${q.join('&')}` }
  },
  geo(v) {
    if (v.lat === '' || v.lat == null || v.lng === '' || v.lng == null) return { empty: 'Enter a latitude and longitude, or use your current location.' }
    const lat = Number(v.lat), lng = Number(v.lng)
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { error: 'Latitude must be between -90 and 90.' }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { error: 'Longitude must be between -180 and 180.' }
    return { text: `geo:${lat},${lng}` }
  },
  event(v) {
    if (!v.title) return { empty: 'Give the event a title.' }
    if (!v.start) return { empty: 'Pick when the event starts.' }
    const s = icsDate(v.start, v.allDay)
    let e = v.end ? icsDate(v.end, v.allDay) : ''
    if (v.end && new Date(v.end) < new Date(v.start)) return { error: 'The event ends before it starts.' }
    if (v.allDay) {
      const d = new Date(v.end || v.start)
      d.setDate(d.getDate() + 1)
      e = icsDate(d, true)
    }
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', `SUMMARY:${icsEsc(v.title)}`, v.allDay ? `DTSTART;VALUE=DATE:${s}` : `DTSTART:${s}`]
    if (e) lines.push(v.allDay ? `DTEND;VALUE=DATE:${e}` : `DTEND:${e}`)
    if (v.location) lines.push(`LOCATION:${icsEsc(v.location)}`)
    if (v.description) lines.push(`DESCRIPTION:${icsEsc(v.description)}`)
    lines.push('END:VEVENT', 'END:VCALENDAR')
    return { text: lines.join('\r\n') }
  },
  whatsapp(v) {
    const n = digits(v.phone)
    if (!n) return { empty: 'Enter a WhatsApp number with its country code, for example 919876543210.' }
    if (n.length < 8 || n.length > 15) return { error: 'Use the full number with country code (8 to 15 digits), no + or spaces needed.' }
    return { text: `https://wa.me/${n}${v.message ? `?text=${encodeURIComponent(v.message)}` : ''}` }
  },
}
export const buildPayload = (type, values) => (BUILDERS[type] || BUILDERS.text)(values)

// ---------- Form definitions ----------
const F = (id, label, o = {}) => ({ id, label, kind: 'text', ...o })
const TYPES = {
  url: { label: 'Link', icon: 'link', fields: [F('url', 'Website address', { placeholder: 'https://example.com', inputmode: 'url', type: 'url' })], example: { url: 'https://github.com/anshnt/tools' } },
  text: { label: 'Text', icon: 'text', fields: [F('text', 'Your text', { kind: 'textarea', placeholder: 'Anything you like: a note, a code, a message...' })], example: { text: 'Hello from a QR code!' } },
  email: { label: 'Email', icon: 'mail', fields: [F('to', 'Send to', { type: 'email', placeholder: 'name@example.com', inputmode: 'email' }), F('subject', 'Subject', { placeholder: 'Optional' }), F('body', 'Message', { kind: 'textarea', placeholder: 'Optional', rows: 3 })], example: { to: 'hello@example.com', subject: 'Hi there', body: 'Nice to meet you.' } },
  phone: { label: 'Phone', icon: 'phone', fields: [F('phone', 'Phone number', { type: 'tel', placeholder: '+91 98765 43210', inputmode: 'tel' })], example: { phone: '+91 98765 43210' } },
  sms: { label: 'SMS', icon: 'message-square', fields: [F('phone', 'Phone number', { type: 'tel', placeholder: '+91 98765 43210', inputmode: 'tel' }), F('message', 'Message', { kind: 'textarea', rows: 3, placeholder: 'Optional' })], example: { phone: '+91 98765 43210', message: 'Running 10 minutes late!' } },
  wifi: {
    label: 'Wi-Fi', icon: 'wifi', caption: 'Scan to join Wi-Fi',
    fields: [F('ssid', 'Network name (SSID)', { placeholder: 'My Home Wi-Fi', autocomplete: 'off' }),
      F('security', 'Security', { kind: 'select', options: [['WPA', 'WPA / WPA2 / WPA3'], ['WEP', 'WEP (old)'], ['nopass', 'No password']], default: 'WPA' }),
      F('password', 'Password', { kind: 'password', placeholder: 'Wi-Fi password', hideWhen: (v) => v.security === 'nopass' }),
      F('hidden', 'Hidden network', { kind: 'toggle' })],
    example: { ssid: 'Cafe Guest', security: 'WPA', password: 'welcome2024' },
  },
  vcard: {
    label: 'Contact', icon: 'contact', caption: 'Scan to save contact',
    fields: [F('first', 'First name', { half: true, autocomplete: 'given-name' }), F('last', 'Last name', { half: true, autocomplete: 'family-name' }),
      F('org', 'Company', { half: true }), F('title', 'Job title', { half: true }),
      F('mobile', 'Mobile', { type: 'tel', half: true, inputmode: 'tel' }), F('work', 'Work phone', { type: 'tel', half: true, inputmode: 'tel' }),
      F('email', 'Email', { type: 'email', half: true, inputmode: 'email' }), F('website', 'Website', { half: true, inputmode: 'url', placeholder: 'https://' }),
      F('street', 'Street', { group: 'more' }), F('city', 'City', { group: 'more', half: true }), F('state', 'State', { group: 'more', half: true }),
      F('zip', 'PIN / ZIP', { group: 'more', half: true }), F('country', 'Country', { group: 'more', half: true }), F('note', 'Note', { group: 'more', kind: 'textarea', rows: 2 })],
    example: { first: 'Asha', last: 'Verma', org: 'Studio Nine', title: 'Designer', mobile: '+91 98765 43210', email: 'asha@studionine.example', website: 'https://studionine.example', city: 'Pune', country: 'India' },
  },
  upi: {
    label: 'UPI', icon: 'indian-rupee', caption: 'Scan to pay',
    fields: [F('pa', 'UPI ID', { placeholder: 'name@okhdfcbank', inputmode: 'email', autocomplete: 'off' }), F('pn', 'Payee name', { placeholder: 'Shown to the payer', half: true }),
      F('am', 'Amount (INR)', { kind: 'number', placeholder: 'Leave empty to let the payer type it', half: true }), F('tn', 'Note', { placeholder: 'e.g. Invoice 1042' })],
    example: { pa: 'asha@okhdfcbank', pn: 'Asha Verma', am: '499', tn: 'Order 1042' },
  },
  geo: { label: 'Location', icon: 'map-pin', fields: [F('lat', 'Latitude', { kind: 'number', half: true, placeholder: '18.5204' }), F('lng', 'Longitude', { kind: 'number', half: true, placeholder: '73.8567' })], example: { lat: '18.5204', lng: '73.8567' }, locate: true },
  event: { label: 'Event', icon: 'calendar-plus', fields: [F('title', 'Event title', { placeholder: 'Team offsite' }), F('start', 'Starts', { type: 'datetime-local', half: true }), F('end', 'Ends', { type: 'datetime-local', half: true }), F('allDay', 'All-day event', { kind: 'toggle' }), F('location', 'Location', { placeholder: 'Optional' }), F('description', 'Description', { kind: 'textarea', rows: 2 })], example: { title: 'Launch party', start: '2027-01-15T18:00', end: '2027-01-15T21:00', location: 'Rooftop Cafe' } },
  whatsapp: { label: 'WhatsApp', icon: 'message-circle', fields: [F('phone', 'WhatsApp number with country code', { type: 'tel', inputmode: 'tel', placeholder: '91 98765 43210' }), F('message', 'Pre-filled message', { kind: 'textarea', rows: 3, placeholder: 'Optional' })], example: { phone: '91 98765 43210', message: 'Hi! I found you through your QR code.' } },
}
const MAIN_ORDER = ['url', 'text', 'email', 'phone', 'sms', 'wifi', 'vcard', 'upi', 'geo', 'event', 'whatsapp']

const PRESETS = [
  { id: 'classic', name: 'Classic', fg: '#0b0b10', fg2: null, bg: '#ffffff' },
  { id: 'indigo', name: 'Indigo', fg: '#4338ca', fg2: '#a21caf', bg: '#ffffff' },
  { id: 'sunset', name: 'Sunset', fg: '#ea580c', fg2: '#be185d', bg: '#ffffff' },
  { id: 'ocean', name: 'Ocean', fg: '#0369a1', fg2: '#4f46e5', bg: '#ffffff' },
  { id: 'forest', name: 'Forest', fg: '#15803d', fg2: '#0f766e', bg: '#ffffff' },
  { id: 'berry', name: 'Berry', fg: '#9d174d', fg2: '#6d28d9', bg: '#ffffff' },
  { id: 'paper', name: 'Paper', fg: '#1c1917', fg2: null, bg: '#fef3c7' },
  { id: 'night', name: 'Night', fg: '#e2e8f0', fg2: '#7dd3fc', bg: '#0f172a' },
]
const DEFAULT_STYLE = { fg: '#0b0b10', fg2: '#a21caf', gradient: 'none', bg: '#ffffff', transparent: false, shape: 'square', eyeFrame: 'square', eyeBall: 'square', eyeColor: '', margin: 3, ecl: 'auto', logoSize: 0.2, roundBg: false }

const CSS = `
.t-qr .qr-types { display: flex; gap: 8px; overflow-x: auto; padding: 2px 2px 8px; margin: 0 -2px; scrollbar-width: none; }
.t-qr .qr-types::-webkit-scrollbar { display: none; }
.t-qr .qr-type { flex: none; display: inline-flex; align-items: center; gap: 7px; height: 40px; padding: 0 14px; border-radius: 13px; border: 1px solid var(--border); background: var(--surface); color: var(--text-2); font-size: 14px; cursor: pointer; transition: transform .25s var(--spring), border-color .2s, background .2s, box-shadow .2s; }
.t-qr .qr-type:hover { transform: translateY(-2px); border-color: var(--border-strong); box-shadow: var(--shadow-sm); }
.t-qr .qr-type .icon { width: 16px; height: 16px; }
.t-qr .qr-type[aria-pressed="true"] { background: var(--text); color: var(--bg); border-color: var(--text); box-shadow: 0 10px 22px -12px rgba(0,0,0,.5); }
.t-qr .qr-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 12px; }
.t-qr .qr-form > .full { grid-column: 1 / -1; }
.t-qr details.more { grid-column: 1 / -1; border: 1px dashed var(--border-strong); border-radius: 14px; padding: 4px 14px; }
.t-qr details.more > summary { cursor: pointer; min-height: 40px; display: flex; align-items: center; font-size: 14px; color: var(--text-2); }
.t-qr details.more[open] > summary { margin-bottom: 10px; }
.t-qr .more-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 12px; padding-bottom: 14px; }
.t-qr .sticky { position: sticky; top: calc(var(--header-h) + 16px); }
.t-qr .stage { padding: 22px; display: grid; place-items: center; gap: 16px; --wt-c1: var(--sc1, #6366f1); --wt-c2: var(--sc2, #ec4899); }
.t-qr .paper { width: min(100%, 340px); aspect-ratio: auto; border-radius: 22px; padding: 14px; background: var(--paper, #fff); box-shadow: 0 30px 60px -30px rgba(15,15,40,.5), 0 2px 6px rgba(15,15,40,.08); transition: transform .35s var(--ease), box-shadow .35s; transform: perspective(900px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg)); will-change: transform; }
.t-qr .paper.checker { background: var(--checker); }
.t-qr .paper svg { display: block; width: 100%; height: auto; border-radius: 10px; }
.t-qr .paper.pop svg { animation: wt-pop .38s var(--spring); }
.t-qr .ghost { position: relative; width: min(100%, 340px); }
.t-qr .ghost .paper { filter: blur(2.5px) saturate(.6); opacity: .5; }
.t-qr .ghost .msg { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; padding: 26px; font-weight: 550; color: var(--text); text-wrap: balance; }
.t-qr .ghost .msg span { background: color-mix(in srgb, var(--surface) 86%, transparent); backdrop-filter: blur(10px); border: 1px solid var(--border); padding: 12px 16px; border-radius: 16px; box-shadow: var(--shadow); font-size: 14px; }
.t-qr .actions { display: flex; gap: 8px; flex-wrap: wrap; width: 100%; justify-content: center; align-items: center; }
.t-qr .meta { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
.t-qr .swatches { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.t-qr .swatch { border: 1px solid var(--border); background: var(--surface); border-radius: 14px; padding: 8px; cursor: pointer; display: grid; gap: 6px; justify-items: center; font-size: 12.5px; color: var(--text-2); transition: transform .25s var(--spring), border-color .2s; }
.t-qr .swatch:hover { transform: translateY(-2px); }
.t-qr .swatch[aria-pressed="true"] { border-color: var(--accent); box-shadow: 0 0 0 3px var(--ring); }
.t-qr .swatch i { display: block; width: 100%; height: 30px; border-radius: 9px; border: 1px solid rgba(0,0,0,.08); }
.t-qr input[type="color"] { width: 100%; height: 42px; padding: 3px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; }
.t-qr .logo-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.t-qr .logo-prev { width: 64px; height: 64px; border-radius: 16px; border: 1px dashed var(--border-strong); display: grid; place-items: center; overflow: hidden; background: var(--surface-2); color: var(--muted); }
.t-qr .logo-prev img { width: 100%; height: 100%; object-fit: contain; }
.t-qr .encoded { margin-top: 2px; }
.t-qr .encoded summary { cursor: pointer; font-size: 13px; color: var(--muted); min-height: 32px; display: flex; align-items: center; }
.t-qr .link-out { display: flex; gap: 8px; align-items: center; padding: 10px 12px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--border); width: 100%; min-width: 0; }
.t-qr .link-out code { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 13px; }
@media (max-width: 900px) { .t-qr .sticky { position: static; } }
@media (max-width: 520px) { .t-qr .qr-form, .t-qr .more-grid { grid-template-columns: minmax(0, 1fr); } .t-qr .stage { padding: 16px 12px; } }
@media (prefers-reduced-motion: reduce) { .t-qr .paper { transform: none !important; } }
`

export function mount(root, { params, signal }) {
  ensureStyle()
  if (!document.getElementById('t-qr-style')) document.head.append(h('style', { id: 't-qr-style' }, CSS))
  const fixed = params?.type && TYPES[params.type] ? params.type : null
  const stored = load('qr:type', 'url')
  let type = fixed || (TYPES[stored] && stored) || 'url'
  const vals = {}
  for (const [t, def] of Object.entries(TYPES)) vals[t] = Object.fromEntries(def.fields.map((f) => [f.id, f.default ?? (f.kind === 'toggle' ? false : '')]))
  const style = { ...DEFAULT_STYLE, ...load('qr:style', {}) }
  const state = { logo: null, caption: TYPES[type].caption || '', captionTouched: false }
  if (fixed === 'wifi' || fixed === 'upi') Object.assign(style, { shape: style.shape })
  let token = 0
  let current = null // {matrix, opts, text}

  // ----- Preview card -----
  const paper = h('div', { class: 'paper' })
  const ghost = h('div', { class: 'ghost' })
  const stage = h('div', { class: 'wt-mesh stage' }, paper, ghost)
  const meta = h('div', { class: 'meta' })
  const warn = h('div', { class: 'stack tight', style: 'width:100%' })
  const encodedBox = h('pre', { class: 'wt-code', style: 'max-height:160px' })
  const encoded = h('details', { class: 'encoded', style: 'width:100%' }, h('summary', 'What is encoded in this code'), h('div', { class: 'stack tight' }, encodedBox, button('Copy text', { icon: 'copy', size: 'sm', onClick: () => copyText(current?.text || '') })))
  const linkOut = h('div', { class: 'link-out', hidden: true }, icon('link'), h('code'), button('', { icon: 'copy', variant: 'ghost', size: 'sm', ariaLabel: 'Copy link', onClick: () => copyText(current?.text || '') }))
  const sizeSel = select([['512', '512 px'], ['1024', '1024 px'], ['2048', '2048 px'], ['4096', '4096 px']], '1024')
  sizeSel.setAttribute('aria-label', 'PNG size')
  sizeSel.style.width = 'auto'
  const filename = (ext) => `qr-${slug(current?.label || type)}.${ext}`
  const pngBtn = downloadButton(() => qrPng(current.matrix, current.opts, +sizeSel.value), () => filename('png'), 'Download PNG', { size: 'lg' })
  const svgBtn = button('SVG', { icon: 'download', onClick: () => download(buildQr(current.matrix, { ...current.opts, size: 1024 }).svg, filename('svg'), 'image/svg+xml') })
  const copyBtn = button('', { icon: 'image', ariaLabel: 'Copy image', title: 'Copy image', onClick: async () => copyImage(await qrPng(current.matrix, current.opts, 1024)) })
  const actions = h('div', { class: 'actions' }, pngBtn, svgBtn, copyBtn, sizeSel)
  const setActions = (on) => { for (const b of [pngBtn, svgBtn, copyBtn, sizeSel]) b.disabled = !on }

  // tilt on hover (desktop only)
  if (matchMedia('(hover: hover)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    stage.addEventListener('pointermove', (e) => {
      const r = stage.getBoundingClientRect()
      paper.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 9}deg`)
      paper.style.setProperty('--rx', `${-((e.clientY - r.top) / r.height - 0.5) * 9}deg`)
    })
    stage.addEventListener('pointerleave', () => { paper.style.setProperty('--ry', '0deg'); paper.style.setProperty('--rx', '0deg') })
  }

  const eclFor = () => (style.ecl === 'auto' ? (state.logo ? 'H' : type === 'url' || type === 'whatsapp' ? 'M' : 'M') : style.ecl)

  async function render() {
    const my = ++token
    const res = buildPayload(type, vals[type])
    clear(warn)
    if (!res.text) {
      current = null
      setActions(false)
      linkOut.hidden = true
      encoded.hidden = true
      clear(meta)
      try {
        const m = await qrMatrix('https://example.com/your-link', 'M')
        if (my !== token) return
        const g = buildQr(m, { size: 340, margin: 2, fg: '#8b8b9a', bg: null, shape: 'rounded', eyeFrame: 'rounded', eyeBall: 'rounded' })
        clear(ghost, h('div', { class: 'paper', html: g.svg }), h('div', { class: 'msg' }, h('span', res.error ? [icon('triangle-alert'), ' ', res.error] : res.empty)))
      } catch { clear(ghost, h('div', { class: 'msg' }, h('span', res.error || res.empty))) }
      ghost.hidden = false
      paper.hidden = true
      return
    }
    try {
      const ecl = eclFor()
      const matrix = await qrMatrix(res.text, ecl)
      if (my !== token) return
      const opts = {
        margin: style.margin, fg: style.fg, fg2: style.gradient !== 'none' ? style.fg2 : null, gradient: style.gradient, bg: style.transparent ? null : style.bg,
        shape: style.shape, eyeFrame: style.eyeFrame, eyeBall: style.eyeBall, eyeColor: style.eyeColor || null, logo: state.logo, logoSize: style.logoSize,
        caption: state.caption.trim(), roundBg: style.roundBg,
      }
      const built = buildQr(matrix, { ...opts, size: 340 })
      current = { matrix, opts, text: res.text, label: type === 'wifi' ? vals.wifi.ssid : type === 'url' ? res.text : type, ecl }
      paper.hidden = false
      ghost.hidden = true
      paper.classList.toggle('checker', style.transparent)
      paper.style.setProperty('--paper', style.transparent ? 'transparent' : style.bg)
      stage.style.setProperty('--sc1', style.gradient !== 'none' ? style.fg : '#6366f1')
      stage.style.setProperty('--sc2', style.gradient !== 'none' ? style.fg2 : '#ec4899')
      paper.innerHTML = built.svg
      paper.classList.remove('pop')
      void paper.offsetWidth
      paper.classList.add('pop')
      setActions(true)
      const bytes = new TextEncoder().encode(res.text).length
      clear(meta, pill(`${built.modules} x ${built.modules} modules`), pill(`${bytes} bytes`), pill(`Error correction ${ecl}`, 'accent'))
      encoded.hidden = false
      encodedBox.textContent = res.text
      const linky = /^(https?:\/\/|upi:|mailto:|tel:|sms:|geo:)/i.test(res.text)
      linkOut.hidden = !linky
      if (linky) linkOut.querySelector('code').textContent = res.text
      // Guidance
      const lowest = Math.min(contrast(style.fg, style.bg), style.gradient !== 'none' ? contrast(style.fg2, style.bg) : 99)
      if (!style.transparent && lowest < 3) warn.append(alert('warn', 'Low contrast between the code and its background. Phones may fail to scan it. Pick a darker code color or a lighter background.'))
      else if (!style.transparent && contrast('#000000', style.fg) > contrast('#000000', style.bg)) warn.append(alert('info', 'Light code on a dark background (inverted). Phone cameras read it, but some older scanner apps do not.'))
      if (state.logo && built.coverage > 0.1) warn.append(alert('info', `The logo hides about ${Math.round(built.coverage * 100)}% of the code. Error correction is set to H so it still scans; test it with your phone before printing.`))
      if (bytes > 600) warn.append(alert('info', 'This is a dense code. Print it large (at least 4 cm) for reliable scanning.'))
      if (type === 'url' && /^http:\/\//i.test(res.text)) warn.append(alert('info', 'This link uses http, not https. Many phones show a security warning when opening it.'))
    } catch (e) {
      if (my !== token) return
      current = null
      setActions(false)
      paper.hidden = true
      ghost.hidden = false
      clear(ghost, h('div', { class: 'msg', style: 'position:static;padding:10px' }, alert('error', e.message)))
    }
  }
  const renderSoon = debounce(render, 70)

  // ----- Content form -----
  const typeBar = h('div', { class: 'qr-types', role: 'group', 'aria-label': 'QR code type' })
  const formHost = h('div')
  function renderTypes() {
    clear(typeBar, MAIN_ORDER.map((t) => h('button', { type: 'button', class: 'qr-type', 'aria-pressed': String(t === type), onclick: () => switchType(t) }, icon(TYPES[t].icon), TYPES[t].label)))
  }
  function switchType(t) {
    type = t
    if (!fixed) save('qr:type', t)
    if (!state.captionTouched) { state.caption = TYPES[t].caption || ''; captionInput.value = state.caption }
    renderTypes()
    renderForm()
    render()
  }

  function control(f, v) {
    const set = (val) => { v[f.id] = val; renderSoon(); if (f.id === 'security') renderForm() }
    if (f.kind === 'textarea') return textarea({ rows: f.rows || 4, placeholder: f.placeholder, value: v[f.id], 'aria-label': f.label, oninput: (e) => set(e.target.value) })
    if (f.kind === 'select') return select(f.options, v[f.id], set)
    if (f.kind === 'toggle') { const t = toggle(f.label, v[f.id], (c) => set(c)); return t }
    if (f.kind === 'password') {
      const inp = input({ type: 'password', placeholder: f.placeholder, value: v[f.id], 'aria-label': f.label, autocomplete: 'off', oninput: (e) => set(e.target.value) })
      const eye = button('', { icon: 'eye', variant: 'secondary', ariaLabel: 'Show password', onClick: () => { const show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; eye.replaceChildren(icon(show ? 'eye-off' : 'eye')); eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password') } })
      return h('div', { class: 'input-group' }, inp, eye)
    }
    return input({ type: f.kind === 'number' ? 'number' : f.type || 'text', placeholder: f.placeholder, value: v[f.id], inputmode: f.inputmode || (f.kind === 'number' ? 'decimal' : null), step: f.kind === 'number' ? 'any' : null,
      'aria-label': f.label, autocomplete: f.autocomplete || null, oninput: (e) => set(e.target.value) })
  }
  function renderForm() {
    const def = TYPES[type], v = vals[type]
    const main = def.fields.filter((f) => !f.group && !(f.hideWhen && f.hideWhen(v)))
    const more = def.fields.filter((f) => f.group === 'more')
    const wrap = (f) => h('div', { class: f.half ? '' : 'full' }, f.kind === 'toggle' ? control(f, v) : field(f.label, control(f, v)))
    clear(formHost, h('div', { class: 'stack' },
      h('div', { class: 'qr-form' }, main.map(wrap), more.length ? h('details', { class: 'more' }, h('summary', 'Address and notes'), h('div', { class: 'more-grid' }, more.map((f) => h('div', { class: f.half ? '' : 'full', style: f.half ? '' : 'grid-column:1/-1' }, field(f.label, control(f, v)))))) : null),
      h('div', { class: 'row' },
        button('Fill an example', { icon: 'wand-sparkles', variant: 'ghost', size: 'sm', onClick: () => { Object.assign(v, def.example); renderForm(); render() } }),
        button('Clear', { icon: 'eraser', variant: 'ghost', size: 'sm', onClick: () => { for (const f of def.fields) v[f.id] = f.default ?? (f.kind === 'toggle' ? false : ''); renderForm(); render() } }),
        def.locate && button('Use my location', { icon: 'locate-fixed', variant: 'ghost', size: 'sm', onClick: locate })),
      type === 'wifi' && note('Your Wi-Fi details stay in this tab. The code is built on your device.'),
      type === 'upi' && note('Works with GPay, PhonePe, Paytm, BHIM and any UPI app. Leave the amount empty to let the payer type it. Always test with a small payment first.')))
  }
  function locate() {
    if (!navigator.geolocation) return toast('Your browser cannot share its location.', 'error')
    navigator.geolocation.getCurrentPosition((p) => { vals.geo.lat = p.coords.latitude.toFixed(6); vals.geo.lng = p.coords.longitude.toFixed(6); renderForm(); render() },
      () => toast('Could not get your location. Allow location access or type the coordinates.', 'error'), { timeout: 10000 })
  }

  // ----- Style tabs -----
  const upd = (patch) => { Object.assign(style, patch); save('qr:style', style); renderSoon() }
  const swatchBtns = PRESETS.map((p) => {
    const b = h('button', { type: 'button', class: 'swatch', 'aria-pressed': 'false', onclick: () => {
      upd({ fg: p.fg, fg2: p.fg2 || style.fg2, gradient: p.fg2 ? 'diagonal' : 'none', bg: p.bg, transparent: false })
      fgIn.value = p.fg; fg2In.value = p.fg2 || style.fg2; bgIn.value = p.bg; gradSeg.set(style.gradient); transToggle.input.checked = false; markPreset()
    } }, h('i', { style: { background: p.fg2 ? `linear-gradient(135deg, ${p.fg}, ${p.fg2})` : p.fg, boxShadow: `inset 0 0 0 5px ${p.bg}` } }), p.name)
    b._p = p
    return b
  })
  function markPreset() { for (const b of swatchBtns) { const p = b._p; b.setAttribute('aria-pressed', String(p.fg === style.fg && (p.fg2 ? style.gradient !== 'none' && p.fg2 === style.fg2 : style.gradient === 'none') && p.bg === style.bg && !style.transparent)) } }
  const fgIn = h('input', { type: 'color', value: style.fg, 'aria-label': 'Code color', oninput: (e) => { upd({ fg: e.target.value }); markPreset() } })
  const fg2In = h('input', { type: 'color', value: style.fg2, 'aria-label': 'Second gradient color', oninput: (e) => { upd({ fg2: e.target.value }); markPreset() } })
  const bgIn = h('input', { type: 'color', value: style.bg, 'aria-label': 'Background color', oninput: (e) => { upd({ bg: e.target.value }); markPreset() } })
  const eyeIn = h('input', { type: 'color', value: style.eyeColor || style.fg, 'aria-label': 'Corner eye color', oninput: (e) => upd({ eyeColor: e.target.value }) })
  const gradSeg = segmented([['none', 'Solid'], ['diagonal', 'Diagonal'], ['horizontal', 'Horizontal'], ['vertical', 'Vertical'], ['radial', 'Radial']], style.gradient, (g) => { upd({ gradient: g }); markPreset() }, 'Gradient direction')
  const transToggle = toggle('Transparent background', style.transparent, (c) => { upd({ transparent: c }); markPreset() })
  const eyeToggle = toggle('Custom corner eye color', !!style.eyeColor, (c) => upd({ eyeColor: c ? eyeIn.value : '' }))
  const optionChips = (list, key) => chipGroup(list, style[key], (v) => upd({ [key]: v }), { label: key })

  const logoPrev = h('div', { class: 'logo-prev' }, icon('image-plus'))
  const logoFile = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    try { state.logo = await logoDataUrl(file); clear(logoPrev, h('img', { src: state.logo, alt: 'Logo preview' })); removeLogo.hidden = false; render() } catch (err) { toast(err.message, 'error') }
  } })
  const removeLogo = button('Remove', { icon: 'trash-2', variant: 'ghost', size: 'sm', onClick: () => { state.logo = null; clear(logoPrev, icon('image-plus')); removeLogo.hidden = true; render() } })
  removeLogo.hidden = true
  const logoSizeRange = rangeField('Logo size', { min: 10, max: 30, step: 1, value: Math.round(style.logoSize * 100), format: (v) => `${v}%`, onInput: (v) => upd({ logoSize: v / 100 }), hint: 'Bigger logos hide more of the code. 15 to 22% is a safe range.' })

  const captionInput = input({ value: state.caption, placeholder: 'Optional text under the code, e.g. Scan to join', maxlength: 40, oninput: (e) => { state.caption = e.target.value; state.captionTouched = true; renderSoon() } })
  const eclSel = select([['auto', 'Automatic'], ['L', 'L - 7% (smallest code)'], ['M', 'M - 15%'], ['Q', 'Q - 25%'], ['H', 'H - 30% (most robust)']], style.ecl, (v) => upd({ ecl: v }))
  const marginRange = rangeField('Quiet zone', { min: 0, max: 8, step: 1, value: style.margin, format: (v) => `${v} modules`, onInput: (v) => upd({ margin: v }), hint: 'Empty border around the code. Keep at least 2 for reliable scanning.' })

  const styleTabs = tabs([
    { id: 'colors', label: 'Colors', render: () => h('div', { class: 'stack' },
      h('div', { class: 'swatches', role: 'group', 'aria-label': 'Color presets' }, swatchBtns),
      h('div', { class: 'grid-3' }, field('Code', fgIn), field('Second color', fg2In), field('Background', bgIn)),
      field('Gradient', gradSeg),
      h('div', { class: 'row' }, transToggle, eyeToggle, h('div', { style: 'width:120px' }, eyeIn))) },
    { id: 'shape', label: 'Shape', render: () => h('div', { class: 'stack' },
      field('Dots', optionChips(SHAPES, 'shape')),
      h('div', { class: 'grid-2' }, field('Corner eye frame', optionChips(EYE_FRAMES, 'eyeFrame')), field('Corner eye center', optionChips(EYE_BALLS, 'eyeBall'))),
      marginRange,
      toggle('Rounded background corners', style.roundBg, (c) => upd({ roundBg: c }))) },
    { id: 'logo', label: 'Logo and text', render: () => h('div', { class: 'stack' },
      h('div', { class: 'logo-row' }, logoPrev, h('div', { class: 'stack tight' }, h('div', { class: 'row' }, button('Upload logo', { icon: 'upload', onClick: () => logoFile.click() }), removeLogo), h('span', { class: 'small muted' }, 'PNG, JPG, SVG or WebP. Stays on your device.')), logoFile),
      logoSizeRange,
      field('Caption under the code', captionInput)) },
    { id: 'more', label: 'Advanced', render: () => h('div', { class: 'stack' }, field('Error correction', eclSel, 'Higher levels survive scratches and logos but make the code denser. Automatic picks M, or H when a logo is added.')) },
  ], 'colors')
  markPreset()

  // ----- Layout -----
  const header = fixed ? null : h('div', { class: 'stack tight' }, h('div', { class: 'wt-kicker' }, 'What should the code open?'), typeBar)
  const content = panel(h('div', { class: 'stack' }, header, formHost))
  const design = h('section', { class: 'panel' }, h('h2', h('span', { class: 'row', style: 'gap:8px' }, icon('palette'), 'Design')), styleTabs)
  const left = h('div', { class: 'stack' }, content, design)
  const right = h('div', { class: 'stack sticky' }, h('div', { class: 'panel flush' }, stage), h('div', { class: 'panel stack' }, meta, actions, warn, linkOut, encoded))
  root.append(h('div', { class: 't-qr' }, split(left, right, 'wide-left')))

  renderTypes()
  renderForm()
  setActions(false)
  render()
  onCleanup(() => { token++ })
  signal?.addEventListener('abort', () => { token++ })
}
