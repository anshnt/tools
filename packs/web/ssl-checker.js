// SSL certificate checker. Browsers cannot read the certificate a server presents, so this reads the public Certificate
// Transparency logs (CertSpotter, with crt.sh as a fallback) for the newest certificate issued for a domain.
import { h, icon, button, alert, clear, copyText, copyButton, table } from '../../lib/ui.js'
import { ensureStyle, pill, note, kvList, omnibar, request, parseDomain, recents, recentChips, skeleton, hashParam, setHashParams, fmtDate, fmtDateTime } from './_shared.js'

const DAY = 86400000

/** "C=US, O=Let's Encrypt, CN=R11" -> {C, O, CN}. */
export function parseDN(dn) {
  const out = {}
  for (const part of String(dn || '').split(/,\s*(?=[A-Za-z]+=)/)) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim() }
  return out
}
export const friendlyIssuer = (dn) => { const p = parseDN(dn); return p.O || p.CN || String(dn || 'Unknown issuer') }

/** Does a certificate name (maybe a wildcard) cover this host? */
export function nameCovers(name, host) {
  const n = name.toLowerCase().replace(/\.$/, ''), x = host.toLowerCase()
  if (n === x) return true
  if (n.startsWith('*.')) { const base = n.slice(2); return x.endsWith('.' + base) && x.slice(0, -base.length - 1).split('.').length === 1 }
  return false
}
export const coversHost = (names, host) => names.some((n) => nameCovers(n, host))

/** Newest certificate that covers the host and is valid now; else the newest valid-at-any-time one that covers it; else the newest. */
export function pickCurrent(certs, host, now = Date.now()) {
  const byNew = [...certs].sort((a, b) => b.notBefore - a.notBefore)
  const covering = byNew.filter((c) => coversHost(c.names, host))
  const pool = covering.length ? covering : byNew
  return pool.find((c) => c.notBefore <= now && c.notAfter > now && !c.revoked) || pool.find((c) => c.notBefore <= now && c.notAfter > now) || pool.find((c) => c.notBefore <= now) || pool[0] || null
}

/** Normalize CertSpotter rows. */
export function fromCertSpotter(rows) {
  return rows.map((r) => ({
    id: r.id, names: r.dns_names || [], issuer: { dn: r.issuer?.name || '', name: r.issuer?.friendly_name || friendlyIssuer(r.issuer?.name) },
    notBefore: new Date(r.not_before).getTime(), notAfter: new Date(r.not_after).getTime(), revoked: !!r.revoked, sha256: r.cert_sha256 || '', pubkey: r.pubkey_sha256 || '', source: 'certspotter',
  }))
}
/** Normalize crt.sh rows (dates are UTC without a zone). */
export function fromCrtSh(rows) {
  const utc = (s) => new Date(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z').getTime()
  const seen = new Set()
  const out = []
  for (const r of rows) {
    const key = r.serial_number + '|' + r.issuer_ca_id
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ id: r.id, names: String(r.name_value || r.common_name || '').split('\n').map((s) => s.trim()).filter(Boolean), issuer: { dn: r.issuer_name || '', name: friendlyIssuer(r.issuer_name) },
      notBefore: utc(r.not_before), notAfter: utc(r.not_after), revoked: false, sha256: '', serial: r.serial_number, source: 'crt.sh' })
  }
  return out
}

async function fetchCerts(host, signal) {
  const errors = []
  try {
    const { body } = await request(`https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(host)}&match_wildcards=true&expand=dns_names&expand=issuer`, { signal, timeout: 20000, service: 'CertSpotter', allow: [] })
    if (Array.isArray(body) && body.length) return { certs: fromCertSpotter(body), source: 'CertSpotter' }
    errors.push('CertSpotter had no records')
  } catch (e) { if (e.code === 'ABORT') throw e; errors.push(e.message) }
  try {
    const { body } = await request(`https://crt.sh/?q=${encodeURIComponent(host)}&output=json`, { signal, timeout: 28000, service: 'crt.sh' })
    if (Array.isArray(body) && body.length) return { certs: fromCrtSh(body), source: 'crt.sh' }
    errors.push('crt.sh had no records')
  } catch (e) { if (e.code === 'ABORT') throw e; errors.push(e.message) }
  const none = errors.every((e) => /no records/.test(e))
  throw Object.assign(new Error(none ? `No public certificates were found for ${host}. It may not use https, may be an internal name, or the certificate was issued very recently.` : `The certificate log services did not answer. ${errors.join(' ')}`), { none })
}

const CSS = `
.t-ssl .lead { display: grid; gap: 14px; padding: 22px; text-align: left; }
.t-ssl .big { font: 700 clamp(22px, 4.6vw, 34px)/1.15 var(--font); letter-spacing: -.025em; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.t-ssl .big .ico { width: 46px; height: 46px; border-radius: 14px; display: grid; place-items: center; flex: none; }
.t-ssl .big .ico .icon { width: 26px; height: 26px; }
.t-ssl .ok .ico { background: var(--success-soft); color: var(--success); } .t-ssl .warn .ico { background: var(--warning-soft); color: var(--warning); } .t-ssl .bad .ico { background: var(--danger-soft); color: var(--danger); }
.t-ssl .life { height: 10px; border-radius: 999px; background: var(--surface-3); overflow: hidden; }
.t-ssl .life i { display: block; height: 100%; border-radius: inherit; background: var(--success); width: 0; transition: width 1s var(--ease); }
.t-ssl .life.warn i { background: var(--warning); } .t-ssl .life.bad i { background: var(--danger); }
.t-ssl .lifeLbl { display: flex; justify-content: space-between; font-size: 12.5px; color: var(--muted); }
.t-ssl .cols { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr)); align-items: start; }
.t-ssl .sec h3 { margin: 0 0 8px; font-size: 14px; display: flex; gap: 8px; align-items: center; } .t-ssl .sec h3 .icon { width: 16px; height: 16px; color: var(--accent); }
.t-ssl .sec .wt-kv { border: 0; background: transparent; } .t-ssl .wt-kv-row { padding-left: 0; }
.t-ssl .names { display: flex; flex-wrap: wrap; gap: 6px; max-height: 220px; overflow: auto; }
`

export function mount(root, { signal }) {
  ensureStyle()
  if (!document.getElementById('t-ssl-style')) document.head.append(h('style', { id: 't-ssl-style' }, CSS))
  const rec = recents('ssl', 8)
  const out = h('div', { class: 'stack' })
  const err = h('div')
  let chipsRecent

  function view(host, { certs, source }) {
    const now = Date.now()
    const cur = pickCurrent(certs, host, now)
    const left = Math.ceil((cur.notAfter - now) / DAY)
    const expired = cur.notAfter <= now
    const revoked = cur.revoked
    const tone = revoked || expired ? 'bad' : left <= 14 ? 'warn' : 'ok'
    const covers = coversHost(cur.names, host)
    const total = Math.max(1, (cur.notAfter - cur.notBefore) / DAY)
    const used = Math.min(100, Math.max(0, ((now - cur.notBefore) / DAY / total) * 100))
    const headline = revoked ? 'Certificate was revoked' : expired ? `Expired ${Math.abs(left)} day${Math.abs(left) === 1 ? '' : 's'} ago` : left <= 14 ? `Expires in ${left} day${left === 1 ? '' : 's'}` : `Valid for ${left} more days`
    const bar = h('i')
    requestAnimationFrame(() => (bar.style.width = `${used}%`))
    const hero = h('section', { class: ['panel', 'lead', 'wt-mesh', tone] },
      h('div', { class: 'wt-kicker' }, host),
      h('div', { class: 'big' }, h('span', { class: 'ico' }, icon(tone === 'ok' ? 'shield-check' : tone === 'warn' ? 'shield-alert' : 'shield-x')), headline),
      h('div', { class: ['life', tone === 'ok' ? '' : tone] }, bar),
      h('div', { class: 'lifeLbl' }, h('span', `Issued ${fmtDate(cur.notBefore)}`), h('span', `${Math.round(used)}% of lifetime used`), h('span', `Expires ${fmtDate(cur.notAfter)}`)),
      h('div', { class: 'wt-chips' }, pill(friendlyIssuer(cur.issuer.dn) === 'Unknown issuer' ? cur.issuer.name : cur.issuer.name, 'accent', 'building-2'), pill(`${Math.round(total)}-day certificate`), covers ? pill('Covers this name', 'ok', 'check') : pill('This name is not listed on it', 'warn', 'triangle-alert'),
        cur.names.some((n) => n.startsWith('*.')) ? pill('Wildcard', 'info') : null, left <= 30 && !expired ? pill('Renew soon', 'warn') : null))
    const issuerParts = parseDN(cur.issuer.dn)
    const details = h('section', { class: 'panel sec' }, h('h3', icon('file-badge'), 'Newest certificate'), kvList([
      ['Issued by', cur.issuer.name], ['Issuer CN', issuerParts.CN], ['Country', issuerParts.C],
      ['Valid from', fmtDateTime(cur.notBefore)], ['Valid until', fmtDateTime(cur.notAfter)], ['Days left', expired ? 'Expired' : String(left), { mono: true }],
      ['Names covered', String(cur.names.length)], ['SHA-256 fingerprint', cur.sha256 ? h('span', { class: 'mono small' }, cur.sha256.match(/.{1,2}/g).join(':').toUpperCase()) : '', { copyValue: cur.sha256 }],
      ['Serial number', cur.serial || ''], ['Revoked', revoked ? 'Yes' : 'No (as logged)'],
    ]), cur.sha256 ? h('div', { style: 'margin-top:12px' }, h('a', { class: 'btn btn-secondary btn-sm', href: `https://crt.sh/?q=${cur.sha256}`, target: '_blank', rel: 'noopener noreferrer' }, icon('external-link'), h('span', 'View in crt.sh'))) : null)
    const names = h('section', { class: 'panel sec' }, h('h3', icon('globe'), `Names on this certificate (${cur.names.length})`), h('div', { class: 'names' }, cur.names.map((n) => pill(n, nameCovers(n, host) ? 'ok' : ''))),
      cur.names.length > 1 ? h('div', { style: 'margin-top:10px' }, copyButton(() => cur.names.join('\n'), 'Copy all names')) : null)
    const hist = [...certs].sort((a, b) => b.notBefore - a.notBefore).slice(0, 30)
    const histT = table({ columns: ['Issued', 'Expires', 'Issuer', 'Names', 'Status'], rows: hist.map((c) => {
      const st = c.revoked ? pill('Revoked', 'bad') : c.notAfter <= now ? pill('Expired', '') : c.notBefore > now ? pill('Not yet valid', 'warn') : pill('Valid', 'ok')
      return [fmtDate(c.notBefore), fmtDate(c.notAfter), c.issuer.name, String(c.names.length), st]
    }) })
    const advice = []
    if (!covers) advice.push(alert('warn', `The newest certificate does not list ${host}. If you entered a subdomain, check it directly, and make sure the name is spelled the way visitors use it.`))
    if (!expired && left <= 14) advice.push(alert('warn', `This certificate expires in ${left} days. Renew it before then, or visitors will see a security warning. Automatic renewal (ACME / certbot) avoids this.`))
    clear(out, hero, ...advice, h('div', { class: 'cols' }, details, names), h('section', { class: 'stack' }, h('h2', { style: 'margin:0' }, `Recent certificates (${certs.length} found)`), histT),
      note(`Data from ${source}. This reads public Certificate Transparency logs, where every trusted certificate is recorded. It shows the newest certificate issued for the name, which is almost always the one in use, but a server could still present an older one. Your browser cannot connect to other sites to read their live certificate.`))
  }

  const omni = omnibar({ icon: 'shield-check', placeholder: 'example.com', label: 'Check certificate', buttonIcon: 'search', busyLabel: 'Reading CT logs', errorTo: err, onSubmit: async (v) => {
    clear(err)
    const host = parseDomain(v)
    clear(out, skeleton(4))
    let r
    try { r = await fetchCerts(host, signal) } catch (e) { clear(out); throw e }
    rec.add(host); chipsRecent.refresh(); setHashParams({ q: host })
    view(host, r)
  } })
  chipsRecent = recentChips(rec, (v) => { omni.set(v); omni.run() }, { label: 'Recent' })
  root.append(h('div', { class: 't-ssl stack' }, omni.el, err, chipsRecent, out))
  clear(out, h('div', { class: 'wt-empty-hero' }, icon('shield-check'), h('div', 'Enter a domain to see its certificate issuer, expiry and history.'),
    h('div', { class: 'wt-chips', style: 'justify-content:center;margin-top:14px' }, ['github.com', 'wikipedia.org', 'example.com'].map((d) => h('button', { type: 'button', class: 'wt-chip', onclick: () => { omni.set(d); omni.run() } }, d)))))
  const q = hashParam('q')
  if (q) { omni.set(q); omni.run() }
}
