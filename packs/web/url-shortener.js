// URL shortener using the free v.gd / is.gd services (same API). Keeps a history on this device and makes a QR code of the short link.
import { h, icon, button, alert, clear, copyText, copyButton, field, input, select, toast } from '../../lib/ui.js'
import { ensureStyle, pill, note, omnibar, parseWebUrl, ago, hashParam } from './_shared.js'
import { persisted } from '../../lib/store.js'
import { qrBox } from './_qrbox.js'

const PROVIDERS = [['v.gd', 'v.gd'], ['is.gd', 'is.gd']]
export const ALIAS_RE = /^[A-Za-z0-9_]{5,30}$/

/** Interpret a create.php answer. Returns {short} or throws {user: true|false, message}. Pure. */
export function readReply(text, status = 200) {
  let j = null
  try { j = JSON.parse(text) } catch { /* plain text error */ }
  if (j?.shorturl) return { short: j.shorturl }
  const code = j?.errorcode
  const msg = j?.errormessage || String(text || '').replace(/^Error,?\s*/i, '').trim()
  const nice = { 1: 'That link cannot be shortened. It may be invalid, already a short link, or blocked by the service.', 2: 'That custom name is not available. Names need 5 to 30 letters, numbers or underscores and must not be taken.', 3: 'The service is rate limiting this network. Wait a minute and try again.', 4: 'The service had a problem and could not make the link.' }[code]
  throw Object.assign(new Error(nice || (msg ? `The service said: ${msg}` : `The service answered HTTP ${status}.`)), { user: code === 1 || code === 2, code })
}

async function shorten(provider, url, alias, signal) {
  const q = `https://${provider}/create.php?format=json&url=${encodeURIComponent(url)}${alias ? `&shorturl=${encodeURIComponent(alias)}` : ''}`
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 8000)
  const onAbort = () => ctl.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  let text, status
  try {
    const res = await fetch(q, { signal: ctl.signal })
    status = res.status
    text = await res.text()
  } catch {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
    throw Object.assign(new Error(`Could not get a reply from ${provider}. The service may be down, or an ad blocker or firewall may be blocking it.`), { user: false })
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort) }
  return readReply(text, status)
}

const CSS = `
.t-short .res { display: grid; gap: 14px; padding: 22px; text-align: left; }
.t-short .link { font: 700 clamp(22px, 4.8vw, 36px)/1.15 var(--mono); letter-spacing: -.03em; overflow-wrap: anywhere; color: var(--accent); }
.t-short .orig { font-size: 13px; color: var(--muted); overflow-wrap: anywhere; display: flex; gap: 6px; align-items: baseline; }
.t-short .two { display: grid; gap: 18px; grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
.t-short .hi { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; padding: 10px 14px; border-top: 1px solid var(--border); align-items: center; }
.t-short .hi:first-child { border-top: 0; }
.t-short .hi .s { font: 600 14px var(--mono); overflow-wrap: anywhere; } .t-short .hi .l { font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; grid-column: 1; }
.t-short .hi .acts { grid-column: 2; grid-row: 1 / 3; display: flex; gap: 2px; }
.t-short .list { border: 1px solid var(--border); border-radius: 16px; overflow: hidden; background: var(--surface); }
@media (max-width: 640px) { .t-short .two { grid-template-columns: 1fr; justify-items: center; } }
`

export function mount(root, { signal }) {
  ensureStyle()
  if (!document.getElementById('t-short-style')) document.head.append(h('style', { id: 't-short-style' }, CSS))
  const hist = persisted('short:history', [])
  const err = h('div'), out = h('div'), histEl = h('div')
  const alias = input({ placeholder: 'optional, e.g. my_launch', 'aria-label': 'Custom short name', spellcheck: false, autocapitalize: 'off', maxLength: 30 })
  let provider = 'v.gd'
  const provSel = select(PROVIDERS, provider, (v) => { provider = v })

  async function run(raw) {
    clear(err); clear(out)
    const u = parseWebUrl(raw)
    if (/(^|\.)(v\.gd|is\.gd|bit\.ly|tinyurl\.com|t\.co|goo\.gl)$/i.test(u.hostname)) throw new Error('That already looks like a short link. Paste the full, original address instead.')
    const a = alias.value.trim()
    if (a && !ALIAS_RE.test(a)) throw new Error('A custom name needs 5 to 30 letters, numbers or underscores (no spaces or dashes).')
    const order = [provider, ...PROVIDERS.map((p) => p[0]).filter((p) => p !== provider)]
    let lastErr, used = null, short = null
    for (const p of order) {
      try { short = (await shorten(p, u.href, a, signal)).short; used = p; break } catch (e) {
        if (e.code === 'ABORT') return
        lastErr = e
        if (e.user) throw e
      }
    }
    if (!short) throw new Error(`The free shortening services are not answering right now (${lastErr?.message || 'unknown error'}). Try again in a few minutes.`)
    hist.update((l) => [{ long: u.href, short, t: Date.now(), p: used }, ...l.filter((x) => x.short !== short)].slice(0, 20))
    show(short, u.href, used, used !== order[0])
    renderHist()
  }

  function show(short, long, used, fellBack) {
    const qr = qrBox({ title: 'Scan to open', size: 160 })
    qr.set(short)
    clear(out, h('section', { class: 'panel res wt-mesh' },
      h('div', { class: 'wt-kicker' }, 'Your short link'),
      h('div', { class: 'two' },
        h('div', { class: 'stack' }, h('div', { class: 'link' }, short),
          h('div', { class: 'orig' }, icon('corner-down-right'), h('span', long)),
          h('div', { class: 'row' }, copyButton(() => short, 'Copy link', { variant: 'primary', size: 'md' }), h('a', { class: 'btn btn-secondary btn-sm', href: short, target: '_blank', rel: 'noopener noreferrer' }, icon('external-link'), h('span', 'Open')),
            h('a', { class: 'btn btn-ghost btn-sm', href: `${short}-`, target: '_blank', rel: 'noopener noreferrer', title: 'Shows where the link goes before you visit it' }, icon('eye'), h('span', 'Preview page')))),
        qr.el),
      h('div', { class: 'wt-chips' }, pill(`via ${used}`), pill('No account', 'ok'), pill('Never expires', 'info'), fellBack ? pill('Used the backup service', 'warn') : null)))
    toast('Short link ready', 'success')
  }

  function renderHist() {
    const l = hist.get()
    clear(histEl)
    if (!l.length) return
    histEl.append(h('div', { class: 'row', style: 'justify-content:space-between;margin:6px 0 8px' }, h('h2', { style: 'margin:0;font-size:16px' }, 'Your links on this device'), button('Clear', { icon: 'trash-2', variant: 'ghost', size: 'sm', onClick: () => { hist.set([]); renderHist() } })),
      h('div', { class: 'list' }, l.map((x) => h('div', { class: 'hi' }, h('a', { class: 's wt-link', href: x.short, target: '_blank', rel: 'noopener noreferrer' }, x.short.replace(/^https:\/\//, '')), h('div', { class: 'l' }, `${x.long.length > 70 ? x.long.slice(0, 68) + '...' : x.long} - ${ago(x.t)}`),
        h('div', { class: 'acts' }, button('', { icon: 'copy', variant: 'ghost', size: 'sm', ariaLabel: `Copy ${x.short}`, onClick: () => copyText(x.short) }), button('', { icon: 'qr-code', variant: 'ghost', size: 'sm', ariaLabel: 'Show QR code', onClick: () => show(x.short, x.long, x.p || 'v.gd', false) }), button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: `Remove ${x.short} from this list`, onClick: () => { hist.update((a) => a.filter((y) => y.short !== x.short)); renderHist() } }))))),
      note('Removing a link here only clears it from this list. The short link itself keeps working.'))
  }

  const omni = omnibar({ icon: 'link-2', placeholder: 'Paste a long link, https://example.com/very/long/page?with=params', label: 'Shorten', buttonIcon: 'scissors', busyLabel: 'Shortening', errorTo: err, onSubmit: run })
  const q = hashParam('q')
  if (q) omni.set(q)
  root.append(h('div', { class: 't-short stack' }, omni.el, err,
    h('details', { class: 'panel' }, h('summary', { style: 'cursor:pointer;font-weight:600;min-height:32px;display:flex;align-items:center' }, 'Options'),
      h('div', { class: 'grid-2', style: 'margin-top:12px' }, field('Custom name (optional)', alias, 'Makes v.gd/my_launch. Letters, numbers and underscores.'), field('Service', provSel, 'If one is busy the other is tried automatically.'))),
    out, histEl,
    note('Free short links come from v.gd and is.gd. They are public and permanent, cannot be edited, and are scanned for abuse, so do not shorten private links (shared documents, password resets, anything with a token in it). Your long link is sent to the service to make the short one.')))
  renderHist()
}
