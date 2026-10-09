// DNS lookup over HTTPS (Google Public DNS and Cloudflare 1.1.1.1), with a side-by-side compare mode.
import { h, icon, button, alert, clear, copyText, segmented, table } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { ensureStyle, pill, note, chipGroup, omnibar, request, parseDomain, isIP, isIPv4, recents, recentChips, skeleton, hashParam, setHashParams } from './_shared.js'

export const TYPE_NUM = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, CAA: 257, DS: 43, DNSKEY: 48 }
const NUM_TYPE = Object.fromEntries(Object.entries(TYPE_NUM).map(([k, v]) => [v, k]))
export const COMMON = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'CAA']
const STATUS = {
  1: 'The resolver could not understand the question (FORMERR).',
  2: 'The resolver could not get an answer (SERVFAIL). This often means broken nameservers or a DNSSEC problem on that domain.',
  3: 'This name does not exist (NXDOMAIN).',
  4: 'The resolver does not support this kind of question (NOTIMP).',
  5: 'The resolver refused the question (REFUSED).',
}
const PROVIDERS = {
  google: { label: 'Google (8.8.8.8)', url: (n, t) => `https://dns.google/resolve?name=${encodeURIComponent(n)}&type=${t}`, init: {}, service: 'Google Public DNS' },
  cloudflare: { label: 'Cloudflare (1.1.1.1)', url: (n, t) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(n)}&type=${t}`, init: { headers: { accept: 'application/dns-json' } }, service: 'Cloudflare DNS' },
}

/** TXT data comes quoted and split in 255-byte chunks: "abc" "def" -> abcdef. */
export function txtData(raw) {
  const parts = [...String(raw).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(.)/g, '$1'))
  return parts.length ? parts.join('') : String(raw)
}
/** CAA arrives as `0 issue "letsencrypt.org"` (Google) or generic hex `\# 22 0005...` (Cloudflare). */
export function decodeCaa(data) {
  const g = /^\\#\s+(\d+)\s+([0-9a-f\s]+)$/i.exec(data)
  if (!g) return String(data).replace(/\s+/g, ' ').trim()
  const bytes = g[2].replace(/\s+/g, '').match(/../g).map((x) => parseInt(x, 16))
  const flags = bytes[0], tl = bytes[1]
  const tag = String.fromCharCode(...bytes.slice(2, 2 + tl))
  const val = new TextDecoder().decode(new Uint8Array(bytes.slice(2 + tl)))
  return `${flags} ${tag} "${val}"`
}
export const stripDot = (s) => String(s).replace(/\.$/, '')
export function parseSoa(data) {
  const [mname, rname, serial, refresh, retry, expire, minimum] = String(data).split(/\s+/)
  const [user, ...rest] = stripDot(rname || '').split('.')
  return { mname: stripDot(mname || ''), email: rest.length ? `${user.replace(/\\\./g, '.')}@${rest.join('.')}` : rname, serial, refresh: +refresh, retry: +retry, expire: +expire, minimum: +minimum }
}
export function fmtTtl(s) {
  s = Number(s)
  if (!Number.isFinite(s)) return '-'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)} min`
  if (s < 86400) return `${+(s / 3600).toFixed(1)} h`
  return `${+(s / 86400).toFixed(1)} days`
}
/** Name of the PTR record for an IP address. */
export function ptrName(ip) {
  if (isIPv4(ip)) return ip.split('.').reverse().join('.') + '.in-addr.arpa'
  let [head, tail = ''] = ip.toLowerCase().split('::')
  const a = head ? head.split(':') : []
  const b = tail ? tail.split(':') : []
  const full = ip.includes('::') ? [...a, ...Array(8 - a.length - b.length).fill('0'), ...b] : a
  return full.map((x) => x.padStart(4, '0')).join('').split('').reverse().join('.') + '.ip6.arpa'
}
/** Label what a TXT record is for, so a wall of strings becomes readable. */
export function classifyTxt(t) {
  if (/^v=spf1\b/i.test(t)) return ['SPF', 'ok']
  if (/^v=DMARC1\b/i.test(t)) return ['DMARC', 'ok']
  if (/^v=DKIM1\b/i.test(t)) return ['DKIM', 'ok']
  if (/^google-site-verification=/i.test(t)) return ['Google verification', 'info']
  if (/^(MS=|ms=)/.test(t)) return ['Microsoft verification', 'info']
  if (/^facebook-domain-verification=/i.test(t)) return ['Facebook verification', 'info']
  if (/^(apple-domain-verification|atlassian-domain-verification|docusign|stripe-verification|zoho-verification|adobe-idp-site-verification|have-i-been-pwned-verification)/i.test(t)) return ['Verification', 'info']
  if (/^v=BIMI1/i.test(t)) return ['BIMI', 'accent']
  if (/^v=TLSRPTv1/i.test(t)) return ['TLS-RPT', 'accent']
  if (/^v=STSv1/i.test(t)) return ['MTA-STS', 'accent']
  return null
}

/** Ask one resolver one question. Always resolves to a normalized object (a DNS error status is data, not an exception). */
export async function query(provider, name, type, signal) {
  const p = PROVIDERS[provider]
  const { body } = await request(p.url(name, type), { ...p.init, signal, timeout: 12000, service: p.service })
  const answers = (body.Answer || []).map((a) => ({ name: stripDot(a.name), type: NUM_TYPE[a.type] || String(a.type), ttl: a.TTL, data: a.data }))
  return { provider, type, status: body.Status, ad: !!body.AD, answers, authority: body.Authority || [] }
}

/** Normalized, comparable form of a record's data. */
export function normalizeData(type, data) {
  if (type === 'TXT') return txtData(data)
  if (type === 'CAA') return decodeCaa(data).toLowerCase()
  if (type === 'AAAA') return String(data).toLowerCase()
  return stripDot(String(data)).toLowerCase().replace(/\s+/g, ' ')
}

const CSS = `
.t-dns .rec { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; align-items: center; padding: 9px 4px 9px 14px; border-top: 1px solid var(--border); }
.t-dns .rec:first-of-type { border-top: 0; }
.t-dns .rec .val { min-width: 0; overflow-wrap: anywhere; font-family: var(--mono); font-size: 13px; line-height: 1.5; }
.t-dns .rec .meta { grid-column: 1; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.t-dns .rec .btn { grid-column: 2; grid-row: 1; }
.t-dns .tcard { border: 1px solid var(--border); border-radius: 18px; background: var(--surface); overflow: hidden; animation: rise .45s var(--ease) both; animation-delay: calc(var(--i, 0) * 45ms); }
.t-dns .thead { display: flex; align-items: center; gap: 10px; padding: 11px 14px; background: var(--surface-2); border-bottom: 1px solid var(--border); }
.t-dns .thead b { font-family: var(--mono); font-size: 13px; letter-spacing: .02em; }
.t-dns .thead .sp { flex: 1; }
.t-dns .none { padding: 12px 14px; color: var(--muted); font-size: 13.5px; }
.t-dns .cards { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr)); align-items: start; }
.t-dns .cmp-ok { color: var(--success); } .t-dns .cmp-diff { color: var(--warning); }
`

export function mount(root, { signal }) {
  ensureStyle()
  if (!document.getElementById('t-dns-style')) document.head.append(h('style', { id: 't-dns-style' }, CSS))
  const rec = recents('dns', 8)
  let types = load('dns:types', 'ALL')
  let resolver = load('dns:resolver', 'google')
  const out = h('div', { class: 'stack' })
  const err = h('div')
  let chipsRecent
  const omni = omnibar({ icon: 'server', placeholder: 'example.com, or an IP address for reverse lookup', label: 'Look up', buttonIcon: 'search', busyLabel: 'Asking DNS', errorTo: err, onSubmit: (v) => run(v) })
  const typeChips = chipGroup([['ALL', 'All common'], ...['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'CAA', 'SRV'].map((t) => [t, t])], types, (t) => { types = t; save('dns:types', t); rerun() }, { label: 'Record type' })
  const resSeg = segmented([['google', 'Google'], ['cloudflare', 'Cloudflare'], ['both', 'Compare both']], resolver, (r) => { resolver = r; save('dns:resolver', r); rerun() }, 'Resolver')
  let lastName = ''
  const rerun = () => { if (lastName) { omni.set(lastName); omni.run() } }

  const valueRow = (type, a) => {
    let text = a.data, meta = []
    if (type === 'TXT') {
      text = txtData(a.data)
      const c = classifyTxt(text)
      if (c) meta.push(pill(c[0], c[1]))
      if (text.length > 255) meta.push(pill(`${text.length} characters`))
    } else if (type === 'MX') {
      const [pr, host] = String(a.data).split(/\s+/)
      text = stripDot(host || a.data)
      meta.push(pill(`Priority ${pr}`, 'accent'))
      if (host === '.' || text === '') { text = '(null MX)'; meta = [pill('This domain does not accept email', 'warn')] }
    } else if (type === 'SOA') {
      const s = parseSoa(a.data)
      text = `${s.mname}\n${s.email}`
      meta.push(pill(`Serial ${s.serial}`), pill(`Refresh ${fmtTtl(s.refresh)}`), pill(`Retry ${fmtTtl(s.retry)}`), pill(`Expire ${fmtTtl(s.expire)}`), pill(`Min TTL ${fmtTtl(s.minimum)}`))
    } else if (type === 'CAA') {
      text = decodeCaa(a.data)
    } else if (type === 'SRV') {
      const [pr, wt, port, target] = String(a.data).split(/\s+/)
      text = `${stripDot(target)}:${port}`
      meta.push(pill(`Priority ${pr}`), pill(`Weight ${wt}`))
    } else if (type === 'CNAME' || type === 'NS' || type === 'PTR') text = stripDot(a.data)
    meta.push(pill(`TTL ${fmtTtl(a.ttl)}`))
    return h('div', { class: 'rec' }, h('div', { class: 'val', style: 'white-space:pre-line' }, text), button('', { icon: 'copy', variant: 'ghost', size: 'sm', ariaLabel: `Copy ${type} value`, onClick: () => copyText(type === 'SOA' ? String(a.data) : text) }), h('div', { class: 'meta' }, meta))
  }

  function typeCard(type, res, i) {
    const mine = res.answers.filter((a) => a.type === type)
    if (type === 'MX') mine.sort((x, y) => parseInt(x.data) - parseInt(y.data))
    const cname = type === 'A' || type === 'AAAA' ? res.answers.find((a) => a.type === 'CNAME') : null
    const head = h('div', { class: 'thead' }, h('b', type), pill(mine.length ? `${mine.length} record${mine.length === 1 ? '' : 's'}` : 'none', mine.length ? 'accent' : ''), h('span', { class: 'sp' }),
      res.ad ? pill('DNSSEC', 'ok', 'shield-check') : null)
    const body = mine.length ? mine.map((a) => valueRow(type, a)) : [h('div', { class: 'none' }, res.status === 3 ? 'The name does not exist.' : res.status ? 'No answer.' : `No ${type} records.`)]
    return h('section', { class: 'tcard', style: { '--i': i } }, head, cname ? h('div', { class: 'none', style: 'padding-bottom:0;font-size:12.5px' }, `Follows CNAME: ${stripDot(cname.data)}`) : null, ...body)
  }

  function summary(results, name, dmarc) {
    const get = (t) => results[t]?.answers.filter((a) => a.type === t) || []
    const pills = []
    const a = get('A'), aaaa = get('AAAA'), mx = get('MX'), txt = get('TXT').map((x) => txtData(x.data))
    if (results.A) pills.push(pill(`${a.length} IPv4`, a.length ? 'ok' : '', a.length ? 'check' : 'x'), pill(`${aaaa.length} IPv6`, aaaa.length ? 'ok' : '', aaaa.length ? 'check' : 'x'))
    if (results.MX) pills.push(pill(mx.length ? `${mx.length} mail server${mx.length === 1 ? '' : 's'}` : 'No mail servers', mx.length ? 'ok' : 'warn', mx.length ? 'mail' : 'mail-x'))
    if (results.TXT) {
      const spf = txt.some((t) => /^v=spf1/i.test(t))
      pills.push(pill(spf ? 'SPF found' : 'No SPF', spf ? 'ok' : 'warn', spf ? 'check' : 'triangle-alert'))
      if (dmarc != null) pills.push(pill(dmarc ? 'DMARC found' : 'No DMARC', dmarc ? 'ok' : 'warn', dmarc ? 'check' : 'triangle-alert'))
    }
    if (Object.values(results).some((r) => r.ad)) pills.push(pill('DNSSEC validated', 'ok', 'shield-check'))
    return pills.length ? h('div', { class: 'wt-chips' }, pills) : null
  }

  async function run(raw) {
    clear(err)
    const input = raw.trim()
    if (!input) throw new Error('Enter a domain name like example.com, or an IP address.')
    let name, qtypes
    if (isIP(input.replace(/^\[|\]$/g, ''))) { name = ptrName(input.replace(/^\[|\]$/g, '')); qtypes = ['PTR'] }
    else {
      name = /^_/.test(input) ? input.toLowerCase().replace(/\.$/, '') : parseDomain(input)
      qtypes = types === 'ALL' ? (name.startsWith('_') ? ['SRV', 'TXT'] : COMMON) : [types]
    }
    lastName = input
    setHashParams({ q: input })
    clear(out, skeleton(4))
    const providers = resolver === 'both' ? ['google', 'cloudflare'] : [resolver]
    const settled = await Promise.all(providers.map(async (p) => {
      const rs = await Promise.allSettled(qtypes.map((t) => query(p, name, t, signal)))
      return [p, rs]
    }))
    if (signal?.aborted) return
    const failedAll = settled.every(([, rs]) => rs.every((r) => r.status === 'rejected'))
    if (failedAll) { clear(out); throw settled[0][1][0].reason }
    // DMARC (extra lookup) when checking everything
    let dmarc = null
    if (types === 'ALL' && qtypes.includes('TXT') && !name.startsWith('_')) {
      try { const r = await query(providers[0], `_dmarc.${name}`, 'TXT', signal); dmarc = r.answers.some((a) => /^v=DMARC1/i.test(txtData(a.data))) } catch { dmarc = null }
    }
    rec.add(input); chipsRecent.refresh()
    const byProvider = {}
    for (const [p, rs] of settled) {
      byProvider[p] = {}
      rs.forEach((r, i) => { if (r.status === 'fulfilled') byProvider[p][qtypes[i]] = r.value })
    }
    const first = byProvider[providers[0]]
    const statuses = Object.values(first).map((r) => r.status)
    const kids = []
    const head = h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', { style: 'margin:0;overflow-wrap:anywhere' }, qtypes[0] === 'PTR' ? `Reverse lookup of ${input}` : name),
      h('div', { class: 'wt-chips' }, button('Copy as text', { icon: 'copy', variant: 'ghost', size: 'sm', onClick: () => copyText(asText(first, name)) })))
    kids.push(head)
    if (statuses.length && statuses.every((s) => s === 3)) kids.push(alert('warn', STATUS[3], ' Check the spelling, or the domain may not be registered. ', h('a', { class: 'wt-link', href: '#/domain-availability' }, 'Check availability')))
    else if (statuses.length && statuses.every((s) => s && s !== 3)) kids.push(alert('error', STATUS[statuses[0]] || `The resolver answered with status ${statuses[0]}.`))
    const sum = summary(first, name, dmarc)
    if (sum) kids.push(sum)
    if (resolver !== 'both') {
      kids.push(h('div', { class: 'cards' }, qtypes.map((t, i) => (first[t] ? typeCard(t, first[t], i) : h('section', { class: 'tcard' }, h('div', { class: 'thead' }, h('b', t)), h('div', { class: 'none' }, 'This lookup failed. Try again.'))))))
    } else kids.push(compareView(byProvider, qtypes))
    kids.push(note(`Answered by ${resolver === 'both' ? 'Google Public DNS and Cloudflare 1.1.1.1' : PROVIDERS[resolver].service} over HTTPS. Results are what public resolvers see now; your own network's DNS may be cached or filtered differently.`))
    clear(out, ...kids)
  }

  function asText(byType, name) {
    const lines = [`DNS for ${name}`]
    for (const [t, r] of Object.entries(byType)) {
      const mine = r.answers.filter((a) => a.type === t)
      if (!mine.length) continue
      lines.push('', `${t}:`)
      for (const a of mine) lines.push(`  ${t === 'TXT' ? txtData(a.data) : t === 'CAA' ? decodeCaa(a.data) : stripDot(a.data)}  (TTL ${a.ttl})`)
    }
    return lines.join('\n')
  }

  function compareView(byProvider, qtypes) {
    const rows = qtypes.map((t) => {
      const sets = ['google', 'cloudflare'].map((p) => {
        const r = byProvider[p]?.[t]
        return r ? r.answers.filter((a) => a.type === t).map((a) => ({ raw: a, norm: normalizeData(t, a.data) })) : null
      })
      const cell = (s) => (s === null ? h('span', { class: 'muted' }, 'lookup failed') : s.length ? h('div', { class: 'stack', style: 'gap:2px' }, s.map((x) => h('div', { class: 'mono small', style: 'overflow-wrap:anywhere' }, t === 'TXT' ? txtData(x.raw.data) : t === 'CAA' ? decodeCaa(x.raw.data) : t === 'MX' ? String(x.raw.data).replace(/ \.?$/, ' (null MX)').replace(/\.$/, '') : stripDot(x.raw.data)))) : h('span', { class: 'muted' }, 'none'))
      let verdict
      if (sets[0] === null || sets[1] === null) verdict = pill('Unknown', '')
      else {
        const [A, B] = sets.map((s) => s.map((x) => x.norm).sort().join('\n'))
        verdict = A === B ? pill('Same', 'ok', 'check') : pill('Different', 'warn', 'triangle-alert')
      }
      return [h('b', { class: 'mono' }, t), cell(sets[0]), cell(sets[1]), verdict]
    })
    const diff = rows.filter((r) => r[3].textContent === 'Different').length
    return h('div', { class: 'stack' },
      diff ? alert('info', `${diff} record type${diff === 1 ? ' differs' : 's differ'} between the two resolvers. That is normal right after a change (caching), or for services that return different IPs by location.`) : alert('success', 'Both resolvers agree on every record type.'),
      table({ columns: ['Type', 'Google', 'Cloudflare', 'Result'], rows }))
  }

  chipsRecent = recentChips(rec, (v) => { omni.set(v); omni.run() }, { label: 'Recent' })
  root.append(h('div', { class: 't-dns stack' },
    omni.el, err,
    h('div', { class: 'row', style: 'justify-content:space-between' }, typeChips, resSeg), chipsRecent, out))
  const q = hashParam('q')
  if (q) { omni.set(q); omni.run() } else clear(out, h('div', { class: 'wt-empty-hero' }, icon('server'), h('div', 'Type a domain to see its A, AAAA, CNAME, MX, NS, TXT, SOA and CAA records.'),
    h('div', { class: 'wt-chips', style: 'justify-content:center;margin-top:14px' }, ['example.com', 'github.com', 'gmail.com'].map((d) => h('button', { type: 'button', class: 'wt-chip', onclick: () => { omni.set(d); omni.run() } }, d)))))
}
