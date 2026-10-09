// Domain availability checker (and WHOIS-style lookup with params.mode = 'whois') using RDAP via rdap.org.
import { h, icon, button, alert, clear, copyButton, modal, progress } from '../../lib/ui.js'
import { ensureStyle, pill, note, chipGroup, omnibar, daysBetween, fmtDate, recents, recentChips, hashParam, setHashParams, wait } from './_shared.js'
import { load, save } from '../../lib/store.js'

export const POPULAR = ['com', 'net', 'org', 'io', 'co', 'in', 'dev', 'app', 'ai', 'xyz']
export const MORE = ['info', 'me', 'tech', 'online', 'store', 'site', 'shop', 'blog', 'cloud', 'studio', 'design', 'agency', 'co.in', 'co.uk', 'us', 'ca', 'de', 'fr', 'nl', 'eu', 'biz', 'club', 'live', 'pro']

const STATUS_TEXT = {
  clienttransferprohibited: 'Transfer locked by the registrar', servertransferprohibited: 'Transfer locked by the registry', clientdeleteprohibited: 'Deletion blocked', serverdeleteprohibited: 'Deletion blocked by the registry',
  clientupdateprohibited: 'Changes locked by the registrar', serverupdateprohibited: 'Changes locked by the registry', clientrenewprohibited: 'Renewal blocked', ok: 'Active', active: 'Active', inactive: 'Inactive (no nameservers)',
  pendingdelete: 'Pending deletion - may become available soon', redemptionperiod: 'In redemption - the owner can still recover it', pendingtransfer: 'Transfer in progress', pendingcreate: 'Being created', pendingrenew: 'Renewal pending', pendingupdate: 'Update pending',
  clienthold: 'On hold by the registrar (not working)', serverhold: 'On hold by the registry (not working)', addperiod: 'Newly registered', autorenewperiod: 'Auto-renew grace period', renewperiod: 'Renewal grace period', transferperiod: 'Transfer grace period',
}
const norm = (s) => String(s).replace(/[\s_-]/g, '').toLowerCase()
export const statusText = (s) => STATUS_TEXT[norm(s)] || s

/** Pick the readable parts out of an RDAP domain object. */
export function parseRdap(j) {
  const ev = (a) => (j.events || []).find((e) => e.eventAction === a)?.eventDate || ''
  const vcardFn = (e) => { const f = (e.vcardArray?.[1] || []).find((x) => x[0] === 'fn'); return f ? f[3] : '' }
  const reg = (j.entities || []).find((e) => (e.roles || []).includes('registrar'))
  const ianaId = reg?.publicIds?.find((p) => /iana/i.test(p.type))?.identifier
  const abuse = (reg?.entities || []).find((e) => (e.roles || []).includes('abuse'))
  const abuseEmail = (abuse?.vcardArray?.[1] || []).find((x) => x[0] === 'email')?.[3] || ''
  return {
    name: (j.ldhName || '').toLowerCase(), registrar: reg ? vcardFn(reg) : '', ianaId: ianaId || '', abuseEmail,
    created: ev('registration'), expires: ev('expiration'), updated: ev('last changed'),
    status: j.status || [], nameservers: (j.nameservers || []).map((n) => (n.ldhName || '').toLowerCase()).filter(Boolean),
    dnssec: j.secureDNS ? (j.secureDNS.delegationSigned ? 'Signed' : 'Not signed') : '', handle: j.handle || '',
  }
}

/** Split typed input into a label and optional extension. "My-Brand.co.uk" -> {label:'my-brand', tld:'co.uk'}. */
export function splitInput(raw) {
  let s = String(raw || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].replace(/\.$/, '')
  if (!s) throw new Error('Type a name like mybrand, or a full domain like mybrand.com.')
  const i = s.indexOf('.')
  const label = i < 0 ? s : s.slice(0, i)
  const tld = i < 0 ? '' : s.slice(i + 1)
  if (!label || label.length > 63 || /^-|-$/.test(label) || /\s/.test(label) || /[^\p{L}\p{N}-]/u.test(label)) throw new Error('Domain names can use letters, numbers and hyphens (not at the start or end), up to 63 characters.')
  if (tld && /[^a-z0-9.\-\p{L}]/u.test(tld)) throw new Error('That extension does not look right. Try .com or .co.uk.')
  return { label, tld }
}
const ascii = (d) => { try { return new URL(`https://${d}`).hostname } catch { return d } }

/** Ask RDAP. Returns {domain, state: 'taken'|'available'|'unknown', info?, raw?, reason?}. */
export async function checkDomain(domain, signal) {
  const d = ascii(domain)
  const ctl = new AbortController()
  const onAbort = () => ctl.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(d)}`, { signal: ctl.signal })
    if (res.status === 404) {
      let b = {}
      try { b = await res.json() } catch { /* ignore */ }
      if (/no rdap service/i.test(b.title || '') || /no rdap service/i.test(JSON.stringify(b).slice(0, 400))) return { domain: d, state: 'unknown', reason: `The .${d.split('.').slice(1).join('.')} registry does not offer a public RDAP lookup, so availability cannot be checked here.` }
      return { domain: d, state: 'available', raw: b }
    }
    if (res.status === 429) return { domain: d, state: 'unknown', reason: 'The lookup service asked us to slow down. Try again in a minute.', rate: true }
    if (!res.ok) return { domain: d, state: 'unknown', reason: `The lookup service answered HTTP ${res.status}.` }
    const raw = await res.json()
    return { domain: d, state: 'taken', info: parseRdap(raw), raw }
  } catch (e) {
    if (signal?.aborted || e.name === 'AbortError') throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
    return { domain: d, state: 'unknown', reason: 'Could not reach the lookup service. Check your connection (an ad blocker can block it) and try again.' }
  } finally { signal?.removeEventListener('abort', onAbort) }
}

const CSS = `
.t-da .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); }
.t-da .dc { border: 1px solid var(--border); border-radius: 18px; padding: 14px 16px; background: var(--surface); display: grid; gap: 8px; align-content: start; animation: rise .4s var(--ease) both; animation-delay: calc(var(--i, 0) * 40ms); position: relative; overflow: hidden; }
.t-da .dc::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 4px; background: var(--muted); opacity: .4; }
.t-da .dc.available::before { background: var(--success); opacity: 1; } .t-da .dc.taken::before { background: var(--danger); opacity: .85; } .t-da .dc.unknown::before { background: var(--warning); opacity: 1; }
.t-da .dc .nm { font: 600 16px/1.2 var(--mono); overflow-wrap: anywhere; letter-spacing: -.01em; }
.t-da .dc .sub { font-size: 12.5px; color: var(--muted); }
.t-da .dc.available { background: linear-gradient(180deg, var(--success-soft), var(--surface) 60%); }
.t-da .dc.loading .nm { opacity: .5; }
.t-da .raw { max-height: 360px; }
`

export function mount(root, { params, signal }) {
  ensureStyle()
  if (!document.getElementById('t-da-style')) document.head.append(h('style', { id: 't-da-style' }, CSS))
  const whois = params.mode === 'whois'
  const rec = recents(whois ? 'whois' : 'domain', 8)
  let tlds = load('domain:tlds', ['com', 'net', 'org', 'io', 'in'])
  const err = h('div'), out = h('div', { class: 'stack' })
  const prog = progress('Checking')
  let chipsRecent
  let runToken = 0

  function detail(r) {
    const i = r.info
    const days = i.expires ? daysBetween(new Date(), i.expires) : null
    const kv = (k, v) => (v ? h('div', { class: 'wt-kv-row' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), h('span')) : null)
    const body = h('div', { class: 'stack' },
      h('div', { class: 'wt-kv' }, [kv('Domain', r.domain), kv('Registrar', i.registrar), kv('Registered', i.created ? fmtDate(i.created) : ''), kv('Expires', i.expires ? `${fmtDate(i.expires)}${days != null ? ` (${days < 0 ? Math.abs(days) + ' days ago' : 'in ' + days + ' days'})` : ''}` : ''), kv('Last changed', i.updated ? fmtDate(i.updated) : ''),
        kv('DNSSEC', i.dnssec), kv('Registry ID', i.handle), kv('Registrar abuse contact', i.abuseEmail)].filter(Boolean)),
      i.status.length ? h('div', { class: 'stack', style: 'gap:6px' }, h('div', { class: 'wt-kicker' }, 'Status'), h('div', { class: 'wt-chips' }, i.status.map((s) => pill(statusText(s), /pending|redemption|hold/i.test(s) ? 'warn' : '')))) : null,
      i.nameservers.length ? h('div', { class: 'stack', style: 'gap:6px' }, h('div', { class: 'wt-kicker' }, 'Nameservers'), h('div', { class: 'wt-chips' }, i.nameservers.map((n) => pill(n)))) : null,
      h('details', {}, h('summary', { style: 'cursor:pointer;min-height:32px;display:flex;align-items:center;font-weight:600' }, 'Raw RDAP record'), h('pre', { class: 'wt-code raw', style: 'margin-top:8px' }, JSON.stringify(r.raw, null, 2))),
      note('Owner details are usually hidden (redacted) by privacy rules since 2018, so only the registrar and dates are public.'))
    return body
  }

  function card(r, i = 0) {
    const cls = ['dc', r.state]
    const status = r.state === 'available' ? pill('Likely available', 'ok', 'circle-check') : r.state === 'taken' ? pill('Registered', 'bad', 'circle-x') : pill('Unknown', 'warn', 'circle-help')
    const kids = [h('div', { class: 'row', style: 'justify-content:space-between;flex-wrap:nowrap' }, h('div', { class: 'nm' }, r.domain), status)]
    if (r.state === 'taken') {
      const inf = r.info
      const days = inf.expires ? daysBetween(new Date(), inf.expires) : null
      const pending = inf.status.some((s) => /pendingdelete|redemption/i.test(norm(s)))
      kids.push(h('div', { class: 'sub' }, inf.registrar ? `Registrar: ${inf.registrar}` : 'Registrar not listed'),
        inf.expires ? h('div', { class: 'sub' }, `Expires ${fmtDate(inf.expires)}${days != null && days >= 0 ? ` (${days} days)` : days != null ? ' (expired)' : ''}`) : null,
        pending ? pill('May be released soon', 'warn', 'hourglass') : days != null && days >= 0 && days <= 30 ? pill('Expiring soon', 'warn', 'hourglass') : null,
        button('Details', { size: 'sm', icon: 'info', variant: 'secondary', onClick: () => modal({ title: r.domain, icon: 'globe', body: detail(r) }) }))
    } else if (r.state === 'available') {
      kids.push(h('div', { class: 'sub' }, 'No registration record was found. Confirm at a registrar before you plan around it: premium and reserved names show up as available here.'),
        h('div', { class: 'row' }, copyButton(() => r.domain, 'Copy', { size: 'sm' }), h('a', { class: 'btn btn-secondary btn-sm', href: `https://lookup.icann.org/en/lookup?name=${encodeURIComponent(r.domain)}`, target: '_blank', rel: 'noopener noreferrer' }, icon('external-link'), h('span', 'Verify at ICANN'))))
    } else kids.push(h('div', { class: 'sub' }, r.reason || 'The lookup did not finish.'),
      h('a', { class: 'btn btn-secondary btn-sm', href: `https://lookup.icann.org/en/lookup?name=${encodeURIComponent(r.domain)}`, target: '_blank', rel: 'noopener noreferrer' }, icon('external-link'), h('span', 'Try ICANN lookup')))
    return h('div', { class: cls, style: { '--i': i } }, kids)
  }

  async function run(raw) {
    clear(err)
    const { label, tld } = splitInput(raw)
    let list = whois ? [tld ? `${label}.${tld}` : (() => { throw new Error('Enter a full domain, like example.com.') })()] : [...new Set([...(tld ? [tld] : []), ...tlds])].map((t) => `${label}.${t}`)
    if (!list.length) throw new Error('Pick at least one extension to check, such as .com.')
    const my = ++runToken
    list = list.slice(0, 40)
    const grid = h('div', { class: 'grid' })
    const placeholders = list.map((d) => h('div', { class: 'dc loading' }, h('div', { class: 'nm' }, d), h('div', { class: 'wt-skel', style: 'height:14px;width:70%' })))
    grid.append(...placeholders)
    const sum = h('div', { class: 'wt-chips' })
    clear(out, sum, grid)
    const results = new Array(list.length)
    let done = 0, next = 0
    prog.set(0, `Checking ${list.length} name${list.length === 1 ? '' : 's'}`)
    const worker = async () => {
      while (next < list.length && my === runToken) {
        const i = next++
        await (i ? wait(80, signal) : Promise.resolve())
        let r = await checkDomain(list[i], signal)
        if (r.rate) { await wait(2500, signal); r = await checkDomain(list[i], signal) }
        results[i] = r
        done++
        if (my !== runToken) return
        placeholders[i].replaceWith(card(r, i))
        prog.set(done / list.length, `Checked ${done} of ${list.length}`)
        const av = results.filter((x) => x?.state === 'available').length, tk = results.filter((x) => x?.state === 'taken').length, un = results.filter((x) => x?.state === 'unknown').length
        clear(sum, pill(`${av} available`, av ? 'ok' : ''), pill(`${tk} registered`, tk ? 'bad' : ''), un ? pill(`${un} unknown`, 'warn') : null)
      }
    }
    await Promise.all([worker(), worker(), worker()])
    prog.hide()
    if (my !== runToken) return
    rec.add(raw.trim()); chipsRecent.refresh(); setHashParams({ q: raw.trim() })
    if (whois && results[0]?.state === 'taken') {
      clear(out, h('section', { class: 'panel stack' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', { style: 'margin:0;overflow-wrap:anywhere' }, results[0].domain), pill('Registered', 'bad', 'circle-x')), detail(results[0])))
    } else if (whois && results[0]?.state === 'available') clear(out, alert('success', `${results[0].domain} has no registration record, so it looks available.`))
    else if (whois && results[0]) clear(out, alert('warn', results[0].reason))
  }

  const omni = omnibar({ icon: 'globe', placeholder: whois ? 'example.com' : 'mybrand or mybrand.com', label: whois ? 'Look up' : 'Check', buttonIcon: 'search', busyLabel: 'Checking', errorTo: err, onSubmit: run })
  chipsRecent = recentChips(rec, (v) => { omni.set(v); omni.run() }, { label: 'Recent' })
  const chips = chipGroup([...POPULAR, ...MORE].map((t) => [t, `.${t}`]), tlds, (v) => { tlds = v; save('domain:tlds', v) }, { multi: true, label: 'Extensions to check' })
  const more = h('details', { class: 'panel' }, h('summary', { style: 'cursor:pointer;font-weight:600;min-height:32px;display:flex;align-items:center' }, 'Choose extensions'),
    h('div', { class: 'stack', style: 'margin-top:10px' }, chips, h('div', { class: 'row' }, button('Popular only', { size: 'sm', variant: 'ghost', onClick: () => { tlds = [...POPULAR]; save('domain:tlds', tlds); chips.set(tlds) } }), button('Clear', { size: 'sm', variant: 'ghost', onClick: () => { tlds = []; save('domain:tlds', tlds); chips.set([]) } }))))
  root.append(h('div', { class: 't-da stack' }, omni.el, err, whois ? null : more, chipsRecent, prog.el, out,
    note('Uses RDAP, the public registration data protocol, through rdap.org. "Likely available" means no registration record exists. Some extensions (like .io) do not publish RDAP data, and premium or reserved names can look available yet cost more or be unavailable.')))
  clear(out, h('div', { class: 'wt-empty-hero' }, icon('globe'), h('div', whois ? 'Enter a domain to see its registrar, dates and status.' : 'Type a name to see which extensions are free.'),
    h('div', { class: 'wt-chips', style: 'justify-content:center;margin-top:14px' }, (whois ? ['example.com', 'wikipedia.org'] : ['launchpad', 'bluefern', 'example']).map((d) => h('button', { type: 'button', class: 'wt-chip', onclick: () => { omni.set(d); omni.run() } }, d)))))
  const q = hashParam('q')
  if (q) { omni.set(q); omni.run() }
}
