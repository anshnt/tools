// IP address lookup: your own public IP, or location and network details for any IP or domain (ipwho.is). params.focus = 'me' leads with your own IP.
import { h, icon, button, alert, clear, copyText, copyButton } from '../../lib/ui.js'
import { ensureStyle, pill, note, kvList, omnibar, request, getJSON, isIP, isIPv4, isIPv6, parseDomain, recents, recentChips, skeleton, hashParam, setHashParams } from './_shared.js'

/** Is this a private, loopback or otherwise non-public address? Returns a label or ''. */
export function reservedKind(ip) {
  if (isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'a private (local network)'
    if (a === 127) return 'a loopback'
    if (a === 169 && b === 254) return 'a link-local'
    if (a === 100 && b >= 64 && b <= 127) return 'a carrier-grade NAT (shared)'
    if (a === 0 || a >= 224) return 'a reserved'
    return ''
  }
  const x = ip.toLowerCase()
  if (x === '::1' || x === '::') return 'a loopback'
  if (/^f[cd]/.test(x)) return 'a private (unique local)'
  if (/^fe[89ab]/.test(x)) return 'a link-local'
  return ''
}

const fmtOffset = (s) => { const n = Number(s); if (!Number.isFinite(n)) return ''; const a = Math.abs(n); return `UTC${n < 0 ? '-' : '+'}${String(Math.floor(a / 3600)).padStart(2, '0')}:${String(Math.floor((a % 3600) / 60)).padStart(2, '0')}` }

const CSS = `
.t-ip .hero { display: grid; gap: 14px; padding: 24px; text-align: left; }
.t-ip .ipbig { font: 700 clamp(26px, 5.4vw, 46px)/1.1 var(--mono); letter-spacing: -.03em; overflow-wrap: anywhere; }
.t-ip .where { display: flex; align-items: center; gap: 10px; font-size: 17px; font-weight: 550; flex-wrap: wrap; }
.t-ip .flag { width: 30px; height: 22px; border-radius: 5px; object-fit: cover; box-shadow: 0 0 0 1px var(--border); }
.t-ip .map { width: 100%; height: 300px; border: 0; border-radius: 16px; background: var(--surface-2); }
.t-ip .cols { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); align-items: start; }
.t-ip .sec h3 { margin: 0 0 8px; font-size: 14px; display: flex; gap: 8px; align-items: center; } .t-ip .sec h3 .icon { width: 16px; height: 16px; color: var(--accent); }
.t-ip .sec .wt-kv { border: 0; background: transparent; } .t-ip .wt-kv-row { padding-left: 0; }
`

export function mount(root, { params, signal }) {
  ensureStyle()
  if (!document.getElementById('t-ip-style')) document.head.append(h('style', { id: 't-ip-style' }, CSS))
  const meFocus = params.focus === 'me'
  const rec = recents('ip', 8)
  const out = h('div', { class: 'stack' })
  const err = h('div')
  const mine = h('div')
  let myIp = ''
  let chipsRecent

  async function fetchInfo(ip) {
    const d = await getJSON(`https://ipwho.is/${encodeURIComponent(ip)}`, { signal, service: 'ipwho.is', allow: [400, 429] })
    if (d.success === false) {
      if (/limit|exceed/i.test(d.message || '')) throw new Error('The free lookup service says its rate limit was reached. Wait a minute and try again.')
      throw new Error(d.message ? `The lookup service says: ${d.message}.` : 'The lookup service could not find that address.')
    }
    return d
  }

  function mapBlock(d) {
    if (d.latitude == null || d.longitude == null) return null
    const lat = +d.latitude, lon = +d.longitude
    const holder = h('div')
    const bbox = `${lon - 0.12},${lat - 0.08},${lon + 0.12},${lat + 0.08}`
    const osm = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=10/${lat}/${lon}`
    const showBtn = button('Show map here', { icon: 'map', size: 'sm', onClick: () => {
      clear(holder, h('iframe', { class: 'map', title: `Map near ${d.city || d.country}`, loading: 'lazy', referrerpolicy: 'no-referrer', src: `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat}%2C${lon}` }))
      showBtn.remove()
    } })
    return h('div', { class: 'stack', style: 'gap:10px' }, h('div', { class: 'row' }, showBtn,
      h('a', { class: 'btn btn-secondary btn-sm', href: osm, target: '_blank', rel: 'noopener noreferrer' }, icon('external-link'), h('span', 'OpenStreetMap')),
      h('a', { class: 'btn btn-secondary btn-sm', href: `https://www.google.com/maps?q=${lat},${lon}`, target: '_blank', rel: 'noopener noreferrer' }, icon('external-link'), h('span', 'Google Maps'))), holder)
  }

  function card(d, { you = false, via = '' } = {}) {
    const place = [d.city, d.region, d.country].filter(Boolean).join(', ')
    const c = d.connection || {}, tz = d.timezone || {}
    return h('div', { class: 'stack' },
      h('section', { class: 'panel hero wt-mesh' },
        h('div', { class: 'wt-kicker' }, you ? 'Your public IP address' : 'IP address'),
        h('div', { class: 'row', style: 'justify-content:space-between;align-items:center' }, h('div', { class: 'ipbig' }, d.ip), h('div', { class: 'row' }, copyButton(() => d.ip, 'Copy IP', { variant: 'primary' }))),
        h('div', { class: 'where' }, d.flag?.img ? h('img', { class: 'flag', src: d.flag.img, alt: '', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove() }) : null, place || 'Location unknown',
          d.postal ? h('span', { class: 'muted', style: 'font-weight:400' }, d.postal) : null),
        h('div', { class: 'wt-chips' }, pill(d.type || (isIPv6(d.ip) ? 'IPv6' : 'IPv4'), 'accent'), c.asn ? pill(`AS${c.asn}`) : null, c.isp || c.org ? pill(c.isp || c.org) : null, d.is_eu ? pill('European Union', 'info') : null, tz.id ? pill(tz.id) : null),
        via ? h('div', { class: 'small muted' }, via) : null),
      h('div', { class: 'cols' },
        h('section', { class: 'panel sec' }, h('h3', icon('map-pin'), 'Location'), kvList([
          ['Country', [d.country, d.country_code ? `(${d.country_code})` : ''].filter(Boolean).join(' ')], ['Region', d.region], ['City', d.city], ['Postal code', d.postal],
          ['Continent', d.continent], ['Capital', d.capital], ['Coordinates', d.latitude != null ? `${(+d.latitude).toFixed(4)}, ${(+d.longitude).toFixed(4)}` : '', { mono: true }], ['Calling code', d.calling_code ? '+' + d.calling_code : ''],
        ]), h('div', { style: 'margin-top:12px' }, mapBlock(d)), note('IP locations are estimates, usually accurate to the city and sometimes only to the internet provider\'s hub.')),
        h('div', { class: 'stack' },
          h('section', { class: 'panel sec' }, h('h3', icon('network'), 'Network'), kvList([['ISP', c.isp], ['Organization', c.org], ['ASN', c.asn ? `AS${c.asn}` : ''], ['Domain', c.domain], ['IP version', d.type]])),
          h('section', { class: 'panel sec' }, h('h3', icon('clock'), 'Time zone'), kvList([['Zone', tz.id], ['Abbreviation', tz.abbr], ['Offset', tz.offset != null ? fmtOffset(tz.offset) : ''], ['Local time there', tz.current_time ? new Date(tz.current_time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: tz.id }) : ''], ['Daylight saving', tz.is_dst == null ? '' : tz.is_dst ? 'Active' : 'Not active']])))))
  }

  async function run(raw) {
    clear(err)
    let v = raw.trim().replace(/^\[|\]$/g, '')
    if (!v) throw new Error('Enter an IP address like 8.8.8.8, or a domain like example.com.')
    let via = ''
    if (!isIP(v)) {
      const host = parseDomain(v)
      clear(out, skeleton(3))
      let ans
      for (const type of ['A', 'AAAA']) {
        const r = await getJSON(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=${type}`, { signal, service: 'Google Public DNS' })
        ans = (r.Answer || []).find((a) => a.type === (type === 'A' ? 1 : 28))
        if (ans) break
      }
      if (!ans) { clear(out); throw new Error(`${host} does not point to an IP address (no A or AAAA record found).`) }
      via = `${host} points to ${ans.data}. Showing details for that address.`
      v = ans.data
    }
    const kind = reservedKind(v)
    if (kind) { clear(out); throw new Error(`${v} is ${kind} address, so it has no public location. Look up a public IP instead.`) }
    clear(out, skeleton(3))
    const d = await fetchInfo(v)
    rec.add(raw.trim()); chipsRecent.refresh()
    setHashParams({ q: raw.trim() })
    clear(out, card(d, { via }))
  }

  const omni = omnibar({ icon: 'map-pin', placeholder: 'IP address or domain, e.g. 8.8.8.8 or example.com', label: 'Look up', buttonIcon: 'search', busyLabel: 'Looking up', errorTo: err, onSubmit: run })
  chipsRecent = recentChips(rec, (v) => { omni.set(v); omni.run() }, { label: 'Recent' })

  async function loadMine() {
    clear(mine, skeleton(3))
    try {
      const d = await fetchInfo('')
      myIp = d.ip
      clear(mine, card(d, { you: true }))
    } catch (e) {
      if (e.code === 'ABORT') return
      clear(mine, alert('error', `Could not detect your IP address. ${e.message}`, ' ', button('Try again', { size: 'sm', onClick: loadMine })))
    }
  }

  const lookupPanel = h('div', { class: 'stack' }, omni.el, err, chipsRecent, out)
  const hint = h('div', { class: 'small muted' }, 'This is the address websites see when you visit them. A VPN, proxy or your mobile carrier can make it differ from your device\'s address.')
  if (meFocus) root.append(h('div', { class: 't-ip stack' }, mine, hint, h('h2', { style: 'margin:12px 0 0' }, 'Look up another IP address or domain'), lookupPanel, note('Lookups use the free ipwho.is service and Google Public DNS (for domains). Your IP is sent to ipwho.is to look it up.')))
  else root.append(h('div', { class: 't-ip stack' }, lookupPanel, h('h2', { style: 'margin:12px 0 0' }, 'Your own address'), mine, hint, note('Lookups use the free ipwho.is service and Google Public DNS (for domains). The address you look up is sent to ipwho.is.')))
  loadMine()
  const q = hashParam('q')
  if (q) { omni.set(q); omni.run() }
}
