// UTM link builder: tag links for analytics, one or many at a time. Runs locally.
import { h, icon, button, field, input, textarea, toggle, panel, alert, clear, copyButton, copyText, download, debounce, tabs, split } from '../../lib/ui.js'
import { ensureStyle, pill, note, chipGroup, recents } from './_shared.js'
import { parseQuery, buildQuery } from './url-parser.js'
import { qrBox } from './_qrbox.js'

export const UTM_KEYS = [['source', 'utm_source'], ['medium', 'utm_medium'], ['campaign', 'utm_campaign'], ['id', 'utm_id'], ['term', 'utm_term'], ['content', 'utm_content']]

/** Lowercase, trim and turn runs of spaces into underscores (the usual analytics convention). */
export const tidyValue = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, '_')

/** Parse a link the way people type it. Returns a URL or throws a friendly Error. */
export function parseLink(raw) {
  let s = String(raw || '').trim()
  if (!s) throw Object.assign(new Error('Enter the page address you want to tag.'), { empty: true })
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s) || /^[a-z0-9.-]+:\d+(\/|$)/i.test(s)) s = 'https://' + s.replace(/^\/\//, '')
  let u
  try { u = new URL(s) } catch { throw new Error('That does not look like a valid link. Try https://example.com/landing-page') }
  if (!/^https?:$/.test(u.protocol)) throw new Error('UTM tags work on http and https links.')
  if (!u.hostname.includes('.') && u.hostname !== 'localhost') throw new Error('That address needs a domain, like example.com.')
  return u
}

/** Add UTM parameters to a link. Existing non-UTM parameters and the #fragment are kept; existing utm_* values are replaced. */
export function addUtm(link, values, { tidy = true } = {}) {
  const u = link instanceof URL ? new URL(link.href) : parseLink(link)
  const params = parseQuery(u.search).filter((p) => !/^utm_/i.test(p.key))
  for (const [k, key] of UTM_KEYS) {
    const raw = values[k]
    if (raw == null || String(raw).trim() === '') continue
    params.push({ key, value: tidy ? tidyValue(raw) : String(raw).trim(), hasValue: true })
  }
  const hash = u.hash
  u.hash = ''
  u.search = ''
  const q = buildQuery(params)
  return u.href.replace(/\?$/, '').replace(/#$/, '') + (q ? '?' + q : '') + hash
}

const SOURCES = ['google', 'facebook', 'instagram', 'linkedin', 'x', 'youtube', 'newsletter', 'whatsapp', 'reddit']
const MEDIUMS = ['cpc', 'email', 'social', 'paid_social', 'organic', 'referral', 'display', 'affiliate', 'sms', 'qr']

const CSS = `
.t-utm .sticky { position: sticky; top: calc(var(--header-h) + 16px); }
.t-utm .out { padding: 14px 16px; border-radius: 16px; border: 1px solid var(--border); background: var(--surface-2); font-family: var(--mono); font-size: 13.5px; line-height: 1.65; overflow-wrap: anywhere; word-break: break-all; min-height: 84px; }
.t-utm .out .u-base { color: var(--text); } .t-utm .out .u-keep { color: var(--muted); }
.t-utm .out .u-utm { color: var(--accent); font-weight: 550; } .t-utm .out .u-hash { color: var(--accent-2); }
.t-utm .out.empty { color: var(--muted); font-family: var(--font); display: grid; place-items: center; text-align: center; }
.t-utm .req::after { content: " *"; color: var(--danger); }
@media (max-width: 900px) { .t-utm .sticky { position: static; } }
`

function colored(href) {
  const j = href.indexOf('#')
  const main = j >= 0 ? href.slice(0, j) : href
  const i = main.indexOf('?')
  const frag = []
  frag.push(h('span', { class: 'u-base' }, i >= 0 ? main.slice(0, i) : main))
  if (i >= 0) {
    main.slice(i + 1).split('&').forEach((p, n) => frag.push(h('span', { class: p.startsWith('utm_') ? 'u-utm' : 'u-keep' }, (n ? '&' : '?') + p)))
  }
  if (j >= 0) frag.push(h('span', { class: 'u-hash' }, href.slice(j)))
  return frag
}

export function mount(root) {
  ensureStyle()
  if (!document.getElementById('t-utm-style')) document.head.append(h('style', { id: 't-utm-style' }, CSS))
  const rec = recents('utm', 6)
  const v = { url: '', source: '', medium: '', campaign: '', id: '', term: '', content: '' }
  let tidy = true
  const inputs = {}
  const mk = (key, label, ph, req, hint) => {
    inputs[key] = input({ value: v[key], placeholder: ph, 'aria-label': label, spellcheck: false, autocapitalize: 'off', oninput: (e) => { v[key] = e.target.value; soon() } })
    return field(req ? h('span', { class: 'req' }, label) : label, inputs[key], hint)
  }
  const setField = (k, val) => { v[k] = val; inputs[k].value = val; update() }

  const urlIn = mk('url', 'Website URL', 'https://example.com/landing-page', true)
  const srcChips = chipGroup(SOURCES.map((s) => [s, s]), '', (x) => setField('source', x), { label: 'Common sources' })
  const medChips = chipGroup(MEDIUMS.map((s) => [s, s]), '', (x) => setField('medium', x), { label: 'Common mediums' })
  const form = h('section', { class: 'panel stack' },
    urlIn,
    h('div', { class: 'grid-2' }, mk('source', 'Source', 'newsletter, google, facebook', true, 'Where the traffic comes from.'), mk('medium', 'Medium', 'email, cpc, social', true, 'The channel type.')),
    h('details', { open: false }, h('summary', { class: 'small muted', style: 'cursor:pointer;min-height:32px;display:flex;align-items:center' }, 'Quick picks for source and medium'), h('div', { class: 'stack', style: 'margin-top:8px' }, srcChips, medChips)),
    mk('campaign', 'Campaign name', 'spring_sale_2027', true, 'Your promotion or product, e.g. spring_sale.'),
    h('div', { class: 'grid-2' }, mk('term', 'Term (optional)', 'running+shoes', false, 'Paid search keyword.'), mk('content', 'Content (optional)', 'hero_banner', false, 'Tell similar ads or links apart.')),
    mk('id', 'Campaign ID (optional)', 'abc123', false, 'Used by some analytics and ad platforms.'),
    toggle('Tidy values: lowercase, spaces become underscores', true, (c) => { tidy = c; update() }))

  const outEl = h('div', { class: 'out empty', 'aria-live': 'polite' })
  const issues = h('div', { class: 'stack', style: 'gap:8px' })
  const qr = qrBox({ title: 'QR code of this link', size: 180 })
  const recentBox = h('div', { class: 'stack', style: 'gap:8px' })
  let current = ''
  const copyBtn = copyButton(() => current, 'Copy link', { size: 'md', variant: 'primary' })
  const openBtn = button('Test link', { icon: 'external-link', onClick: () => window.open(current, '_blank', 'noopener') })
  const saveBtn = button('Save to recent', { icon: 'bookmark-plus', variant: 'ghost', size: 'sm', onClick: () => { rec.add({ ...v, tidy }); renderRecent() } })

  function renderRecent() {
    clear(recentBox)
    const list = rec.get()
    if (!list.length) return
    recentBox.append(h('div', { class: 'wt-kicker' }, 'Recent campaigns'), h('div', { class: 'wt-chips' }, list.map((r) => h('button', { type: 'button', class: 'wt-chip', title: r.url, onclick: () => {
      for (const k of Object.keys(v)) { v[k] = r[k] || ''; inputs[k].value = v[k] }
      update()
    } }, r.campaign || r.source || r.url)), button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: 'Clear recent campaigns', onClick: () => { rec.clear(); renderRecent() } })))
  }

  function update() {
    clear(issues)
    current = ''
    let u
    try { u = parseLink(v.url) } catch (e) {
      clear(outEl, e.empty ? 'Your tagged link will appear here.' : e.message)
      outEl.className = 'out empty'
      if (!e.empty) issues.append(alert('error', e.message))
      copyBtn.disabled = openBtn.disabled = saveBtn.disabled = true
      qr.set(null)
      return
    }
    const missing = [['source', 'Source'], ['medium', 'Medium'], ['campaign', 'Campaign name']].filter(([k]) => !String(v[k]).trim()).map(([, l]) => l)
    current = addUtm(u, v, { tidy })
    outEl.className = 'out'
    clear(outEl, colored(current))
    copyBtn.disabled = openBtn.disabled = saveBtn.disabled = false
    if (missing.length) issues.append(alert('warn', `Missing: ${missing.join(', ')}. Google Analytics needs source, medium and campaign to report a campaign properly.`))
    if (/utm_/i.test(u.search)) issues.append(note('This link already had UTM tags. They were replaced with the ones below.'))
    if (!tidy && [v.source, v.medium, v.campaign].some((x) => /[A-Z]/.test(x) || /\s/.test(x))) issues.append(note('Mixed case and spaces split reports: "Email" and "email" are counted as two sources. Tidy values avoids that.'))
    if (current.length > 2000) issues.append(alert('warn', 'This link is over 2,000 characters. Some browsers and platforms cut links that long.'))
    qr.set(current)
  }
  const soon = debounce(update, 80)

  // Several links
  const bulkIn = textarea({ rows: 6, mono: true, spellcheck: false, placeholder: 'https://example.com/pricing\nhttps://example.com/blog/launch\nhttps://example.com/signup', 'aria-label': 'Links to tag, one per line' })
  const bulkOut = h('div', { class: 'stack' })
  const bulkRun = () => {
    clear(bulkOut)
    const lines = bulkIn.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (!lines.length) return bulkOut.append(note('Paste one link per line. The campaign settings from the other tab are applied to each.'))
    const rows = lines.map((l) => { try { return { src: l, out: addUtm(l, v, { tidy }) } } catch (e) { return { src: l, err: e.message } } })
    const good = rows.filter((r) => r.out)
    const lbl = [v.source, v.medium, v.campaign].every((x) => String(x).trim()) ? null : alert('warn', 'Fill in source, medium and campaign on the "One link" tab first.')
    bulkOut.append(lbl, h('textarea', { class: 'textarea mono', readonly: true, rows: Math.min(10, rows.length + 1), 'aria-label': 'Tagged links', value: rows.map((r) => r.out || `# ${r.src} (${r.err})`).join('\n') }),
      h('div', { class: 'row' }, copyButton(() => good.map((r) => r.out).join('\n'), 'Copy all'),
        button('Download CSV', { icon: 'download', size: 'sm', onClick: () => download('original,tagged\n' + good.map((r) => `"${r.src.replace(/"/g, '""')}","${r.out.replace(/"/g, '""')}"`).join('\n'), 'utm-links.csv', 'text/csv') }),
        pill(`${good.length} of ${rows.length} tagged`, good.length === rows.length ? 'ok' : 'warn')))
  }
  bulkIn.addEventListener('input', debounce(bulkRun, 150))

  const result = h('div', { class: 'stack sticky' },
    h('section', { class: 'panel stack' }, h('div', { class: 'wt-kicker' }, 'Your tagged link'), outEl, issues,
      h('div', { class: 'row' }, copyBtn, openBtn, saveBtn)),
    h('section', { class: 'panel' }, qr.el), recentBox)

  const left = h('div', { class: 'stack' }, tabs([
    { id: 'one', label: 'One link', render: () => form },
    { id: 'many', label: 'Several links', render: () => h('section', { class: 'panel stack' }, h('p', { class: 'muted small', style: 'margin:0' }, 'Tag many pages with the same campaign. Fill in the campaign on the first tab, then paste your links.'), bulkIn, bulkOut) },
  ], 'one', (id) => { if (id === 'many') bulkRun() }))
  root.append(h('div', { class: 't-utm' }, split(left, result, 'wide-left')))
  renderRecent()
  update()
}
