// "What is my browser": everything your browser can tell a website, shown locally. Nothing is sent anywhere.
import { h, icon, button, input, clear, copyButton, download, debounce, toast } from '../../lib/ui.js'
import { ensureStyle, pill, note, kvList } from './_shared.js'

/** Parse a user agent string into friendly parts. Pure, testable. */
export function parseUA(ua = '') {
  const m = (re) => ua.match(re)
  let browser = 'Unknown browser', version = ''
  const rules = [
    [/EdgiOS\/([\d.]+)|EdgA\/([\d.]+)|Edg\/([\d.]+)|Edge\/([\d.]+)/, 'Microsoft Edge'],
    [/OPR\/([\d.]+)|OPiOS\/([\d.]+)|Opera\/.*Version\/([\d.]+)/, 'Opera'],
    [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
    [/Vivaldi\/([\d.]+)/, 'Vivaldi'],
    [/YaBrowser\/([\d.]+)/, 'Yandex Browser'],
    [/DuckDuckGo\/([\d.]+)/, 'DuckDuckGo'],
    [/UCBrowser\/([\d.]+)/, 'UC Browser'],
    [/FxiOS\/([\d.]+)|Firefox\/([\d.]+)/, 'Firefox'],
    [/CriOS\/([\d.]+)|Chrome\/([\d.]+)/, 'Chrome'],
    [/Version\/([\d.]+).*Safari\//, 'Safari'],
    [/MSIE ([\d.]+)|Trident\/.*rv:([\d.]+)/, 'Internet Explorer'],
  ]
  for (const [re, name] of rules) {
    const r = m(re)
    if (r) { browser = name; version = r.slice(1).find(Boolean) || ''; break }
  }
  const inApp = /\bFBAN|FBAV|Instagram|Line\/|MicroMessenger|Snapchat|TikTok|Twitter for/i.exec(ua)
  let os = 'Unknown OS', osVersion = ''
  let r
  if ((r = m(/Windows NT ([\d.]+)/))) { os = 'Windows'; osVersion = { '10.0': '10 or 11', '6.3': '8.1', '6.2': '8', '6.1': '7' }[r[1]] || r[1] }
  else if ((r = m(/iPhone OS ([\d_]+)|CPU OS ([\d_]+)/))) { os = /iPad/.test(ua) ? 'iPadOS' : 'iOS'; osVersion = (r[1] || r[2]).replace(/_/g, '.') }
  else if ((r = m(/Android ([\d.]+)/))) { os = 'Android'; osVersion = r[1] }
  else if ((r = m(/Mac OS X ([\d_.]+)/))) { os = 'macOS'; osVersion = r[1].replace(/_/g, '.') }
  else if (/CrOS/.test(ua)) os = 'ChromeOS'
  else if (/Linux|X11/.test(ua)) os = /Ubuntu/.test(ua) ? 'Linux (Ubuntu)' : 'Linux'
  if (os === 'macOS' && osVersion === '10.15.7') osVersion = '' // browsers freeze this number, the real version is hidden
  if (inApp && browser === 'Unknown browser') browser = `${/FB/.test(inApp[0]) ? 'Facebook' : inApp[0].replace(/\/$/, '')} app browser`
  const ios = /iPhone|iPad|iPod/.test(ua)
  const engine = ios ? 'WebKit' : /Firefox\//.test(ua) ? 'Gecko' : /Chrome\/|Chromium|Edg|OPR\//.test(ua) ? 'Blink' : /AppleWebKit/.test(ua) ? 'WebKit' : /Trident|MSIE/.test(ua) ? 'Trident' : 'Unknown'
  const device = /iPad|Tablet|Tab |Nexus 7|Nexus 9|SM-T|Kindle/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) ? 'Tablet' : /Mobi|iPhone|Android.*Mobile|Windows Phone/.test(ua) ? 'Phone' : /bot|crawl|spider|slurp|curl|wget/i.test(ua) ? 'Bot' : 'Desktop or laptop'
  return { browser, version, major: version.split('.')[0], os, osVersion, engine, device, inApp: inApp ? inApp[0] : '' }
}

const mq = (q) => { try { return matchMedia(q).matches } catch { return false } }
const supports = {
  'Service workers': () => 'serviceWorker' in navigator,
  'WebAssembly': () => typeof WebAssembly === 'object',
  'WebGL': () => { try { return !!document.createElement('canvas').getContext('webgl') } catch { return false } },
  'WebGL 2': () => { try { return !!document.createElement('canvas').getContext('webgl2') } catch { return false } },
  'WebGPU': () => 'gpu' in navigator,
  'WebRTC': () => 'RTCPeerConnection' in window,
  'WebSockets': () => 'WebSocket' in window,
  'Web Workers': () => 'Worker' in window,
  'Offscreen canvas': () => 'OffscreenCanvas' in window,
  'Clipboard API': () => !!navigator.clipboard,
  'Web Share': () => 'share' in navigator,
  'Notifications': () => 'Notification' in window,
  'Geolocation': () => 'geolocation' in navigator,
  'WebAuthn (passkeys)': () => 'PublicKeyCredential' in window,
  'Barcode detector': () => 'BarcodeDetector' in window,
  'File System Access': () => 'showOpenFilePicker' in window,
  'Speech recognition': () => 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window,
  'Speech synthesis': () => 'speechSynthesis' in window,
  'WebXR': () => 'xr' in navigator,
  'Web Bluetooth': () => 'bluetooth' in navigator,
  'Web USB': () => 'usb' in navigator,
  'Vibration': () => 'vibrate' in navigator,
  'Media Session': () => 'mediaSession' in navigator,
  'Picture in Picture': () => !!document.pictureInPictureEnabled,
  'IndexedDB': () => 'indexedDB' in window,
  'Intl.Segmenter': () => typeof Intl.Segmenter === 'function',
  'CSS container queries': () => { try { return CSS.supports('container-type: inline-size') } catch { return false } },
  'AV1 video': () => { try { return /probably|maybe/.test(document.createElement('video').canPlayType('video/mp4; codecs="av01.0.05M.08"')) } catch { return false } },
  'WebP images': () => { try { return document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp') } catch { return false } },
  'AVIF images': () => { try { return document.createElement('canvas').toDataURL('image/avif').startsWith('data:image/avif') } catch { return false } },
}

const CSS = `
.t-bi .sec { padding: 16px; border: 1px solid var(--border); border-radius: 20px; background: var(--surface); display: grid; gap: 10px; align-content: start; min-width: 0; }
.t-bi .sec h3 { margin: 0; font-size: 14px; letter-spacing: .01em; display: flex; align-items: center; gap: 8px; }
.t-bi .sec h3 .icon { width: 17px; height: 17px; color: var(--accent); }
.t-bi .lead { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 18px; align-items: center; padding: 22px; }
.t-bi .lead .big { font-size: clamp(24px, 4.5vw, 38px); font-weight: 700; letter-spacing: -.03em; line-height: 1.1; }
.t-bi .lead .logo { width: 64px; height: 64px; border-radius: 20px; display: grid; place-items: center; background: var(--brand); color: #fff; box-shadow: 0 12px 30px -12px var(--accent); }
.t-bi .lead .logo .icon { width: 32px; height: 32px; }
.t-bi .uastr { font-family: var(--mono); font-size: 12.5px; color: var(--text-2); overflow-wrap: anywhere; word-break: break-all; line-height: 1.55; }
.t-bi .feat { display: flex; flex-wrap: wrap; gap: 8px; }
.t-bi .masonry-g { columns: 360px; column-gap: 16px; }
.t-bi .masonry-g > * { break-inside: avoid; margin-bottom: 16px; }
.t-bi .wt-kv { border: 0; background: transparent; border-radius: 0; }
.t-bi .wt-kv-row { padding-left: 0; grid-template-columns: minmax(84px, 128px) minmax(0, 1fr) auto; }
.t-bi .lead { text-align: left; }
@media (max-width: 520px) { .t-bi .lead { grid-template-columns: 1fr; } }
`

export function mount(root, { params, signal }) {
  ensureStyle()
  if (!document.getElementById('t-bi-style')) document.head.append(h('style', { id: 't-bi-style' }, CSS))
  const hi = {} // high-entropy client hints + async facts, filled in later
  const grid = h('div', { class: 'masonry-g' })
  const heroEl = h('section', { class: 'sec lead wt-mesh' })
  let report = ''

  const nav = navigator
  const section = (title, ic, rows, extra) => h('section', { class: 'sec' }, h('h3', icon(ic), title), kvList(rows.filter(Boolean)), extra || null)
  const tick = (ok, yesText = 'Yes', noText = 'No') => (ok === null || ok === undefined ? 'Unknown' : h('span', { class: ['wt-pill', ok ? 'ok' : ''] }, icon(ok ? 'check' : 'x'), ok ? yesText : noText))

  function gather() {
    const ua = nav.userAgent
    const p = parseUA(ua)
    const uad = nav.userAgentData
    const brands = (hi.fullVersionList || uad?.brands || []).filter((b) => !/not.?a.?brand|not\)a;brand/i.test(b.brand)).map((b) => `${b.brand} ${b.version}`)
    let osName = p.os, osVer = p.osVersion
    if (hi.platform && hi.platformVersion) {
      if (hi.platform === 'Windows') { osName = 'Windows'; osVer = parseInt(hi.platformVersion, 10) >= 13 ? '11' : '10' }
      else if (hi.platform === 'macOS') { osName = 'macOS'; osVer = hi.platformVersion }
      else { osName = hi.platform; osVer = hi.platformVersion || osVer }
    }
    const tz = Intl.DateTimeFormat().resolvedOptions()
    const off = -new Date().getTimezoneOffset()
    const offStr = `UTC${off >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')}`
    const dpr = window.devicePixelRatio || 1
    const vv = window.visualViewport
    const conn = nav.connection
    const scheme = mq('(prefers-color-scheme: dark)') ? 'Dark' : mq('(prefers-color-scheme: light)') ? 'Light' : 'No preference'
    const cookiesOn = nav.cookieEnabled
    const lsOk = (() => { try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true } catch { return false } })()
    const sample = new Date(2026, 11, 31, 18, 5)
    return { ua, p, osName, osVer, brands, tz, offStr, dpr, vv, conn, scheme, cookiesOn, lsOk, sample, uad }
  }

  function render() {
    const g = gather()
    const { p, ua } = g
    const browserLine = `${p.browser}${p.version ? ' ' + p.major : ''}`
    const device = p.device
    clear(heroEl,
      h('div', { class: 'logo' }, icon(device === 'Phone' ? 'smartphone' : device === 'Tablet' ? 'tablet' : 'monitor')),
      h('div', { class: 'stack', style: 'gap:8px;min-width:0' },
        h('div', { class: 'big' }, browserLine, h('span', { class: 'muted', style: 'font-weight:500' }, ` on ${g.osName}${g.osVer ? ' ' + g.osVer : ''}`)),
        h('div', { class: 'row' }, pill(p.engine + ' engine', 'accent'), pill(device, ''), hi.brave ? pill('Brave', 'info') : null, p.inApp ? pill(`In-app browser: ${p.inApp}`, 'warn') : null, pill(nav.onLine ? 'Online' : 'Offline', nav.onLine ? 'ok' : 'bad', nav.onLine ? 'wifi' : 'wifi-off')),
        h('div', { class: 'uastr' }, ua)))
    const sections = []
    sections.push(section('Browser', 'globe', [
      ['Browser', `${p.browser} ${p.version}`.trim()],
      g.brands.length ? ['Client hints brands', g.brands.join(', '), { copyValue: g.brands.join(', ') }] : null,
      ['Engine', p.engine],
      hi.uaFullVersion ? ['Full version', hi.uaFullVersion, { mono: true }] : null,
      ['Language', nav.language || '-'],
      ['All languages', (nav.languages || []).join(', ')],
      ['User agent', h('span', { class: 'mono small' }, ua), { copyValue: ua }],
      ['Cookies enabled', tick(g.cookiesOn)],
      ['Do Not Track', nav.doNotTrack === '1' ? 'On' : nav.doNotTrack === '0' ? 'Off (asks to be tracked)' : 'Not set'],
      ['Global Privacy Control', nav.globalPrivacyControl === undefined ? 'Not supported' : nav.globalPrivacyControl ? 'On' : 'Off'],
      ['PDF viewer', nav.pdfViewerEnabled === undefined ? 'Unknown' : nav.pdfViewerEnabled ? 'Built in' : 'Not built in'],
      ['Automation (webdriver)', nav.webdriver ? 'Yes, this browser is automated' : 'No'],
    ]))
    sections.push(section('Device and system', 'cpu', [
      ['Operating system', `${g.osName} ${g.osVer}`.trim()],
      hi.architecture ? ['CPU architecture', `${hi.architecture}${hi.bitness ? ` ${hi.bitness}-bit` : ''}`] : null,
      hi.model ? ['Device model', hi.model] : null,
      ['Device type', device],
      ['Platform', hi.platform || nav.platform || '-'],
      ['CPU threads', nav.hardwareConcurrency ? String(nav.hardwareConcurrency) : 'Hidden'],
      ['Memory', nav.deviceMemory ? `${nav.deviceMemory} GB or more (rounded)` : 'Hidden or unsupported'],
      ['Touch points', String(nav.maxTouchPoints || 0)],
      ['Pointer', mq('(pointer: coarse)') ? 'Touch (coarse)' : mq('(pointer: fine)') ? 'Mouse or trackpad (fine)' : 'Unknown'],
      ['Hover', mq('(hover: hover)') ? 'Yes' : 'No'],
      hi.gpu ? ['Graphics', hi.gpu] : null,
    ]))
    const sw = screen.width, sh = screen.height
    sections.push(section('Screen and window', 'monitor', [
      ['Screen size', `${sw} x ${sh} CSS px`],
      ['Physical pixels', `${Math.round(sw * g.dpr)} x ${Math.round(sh * g.dpr)}`],
      ['Pixel ratio', `${+g.dpr.toFixed(2)}x`],
      ['Available area', `${screen.availWidth} x ${screen.availHeight}`],
      ['Viewport (this tab)', `${innerWidth} x ${innerHeight}`],
      ['Window', `${outerWidth} x ${outerHeight}`],
      g.vv ? ['Pinch zoom', `${+g.vv.scale.toFixed(2)}x`] : null,
      ['Color depth', `${screen.colorDepth}-bit`],
      ['Orientation', screen.orientation?.type?.replace('-', ' ') || (innerWidth > innerHeight ? 'landscape' : 'portrait')],
      ['Color gamut', mq('(color-gamut: rec2020)') ? 'Rec. 2020' : mq('(color-gamut: p3)') ? 'Display P3 (wide)' : 'sRGB'],
      ['HDR', mq('(dynamic-range: high)') ? 'Supported' : 'Not supported'],
    ]))
    sections.push(section('Preferences and locale', 'sliders-horizontal', [
      ['Color scheme', g.scheme],
      ['Reduced motion', mq('(prefers-reduced-motion: reduce)') ? 'On' : 'Off'],
      ['High contrast', mq('(prefers-contrast: more)') ? 'More contrast' : mq('(prefers-contrast: less)') ? 'Less contrast' : 'Default'],
      ['Forced colors', mq('(forced-colors: active)') ? 'Active' : 'Off'],
      ['Reduced transparency', mq('(prefers-reduced-transparency: reduce)') ? 'On' : 'Off'],
      ['Time zone', `${g.tz.timeZone} (${g.offStr})`],
      ['Locale', g.tz.locale],
      ['Date format', g.sample.toLocaleDateString(undefined, { dateStyle: 'medium' })],
      ['Time format', g.sample.toLocaleTimeString(undefined, { timeStyle: 'short' }) + (g.tz.hourCycle ? ` (${g.tz.hourCycle})` : '')],
      ['Number format', (1234567.89).toLocaleString()],
      ['Calendar', g.tz.calendar],
    ]))
    sections.push(section('Network and storage', 'hard-drive', [
      ['Connection', nav.onLine ? 'Online' : 'Offline'],
      g.conn ? ['Network type', g.conn.effectiveType ? g.conn.effectiveType.toUpperCase() + (g.conn.type ? ` (${g.conn.type})` : '') : '-'] : ['Network type', 'Not exposed by this browser'],
      g.conn?.downlink != null ? ['Downlink estimate', `${g.conn.downlink} Mbps`] : null,
      g.conn?.rtt != null ? ['Round trip estimate', `${g.conn.rtt} ms`] : null,
      g.conn?.saveData != null ? ['Data saver', g.conn.saveData ? 'On' : 'Off'] : null,
      ['localStorage', tick(g.lsOk, 'Works', 'Blocked')],
      ['Storage used', hi.storage ? `${fmt(hi.storage.usage)} of ${fmt(hi.storage.quota)}` : 'Checking...'],
      hi.persisted != null ? ['Persistent storage', tick(hi.persisted, 'Granted', 'Not granted')] : null,
      ['Secure context (https)', tick(window.isSecureContext)],
      ['Cross-origin isolated', tick(!!window.crossOriginIsolated)],
    ]))
    const feats = Object.entries(supports).map(([k, fn]) => { let ok = false; try { ok = !!fn() } catch { ok = false } return [k, ok] })
    const okCount = feats.filter(([, v]) => v).length
    sections.push(h('section', { class: 'sec' }, h('h3', icon('puzzle'), 'Feature support', h('span', { class: 'muted small', style: 'font-weight:400' }, `${okCount} of ${feats.length}`)),
      h('div', { class: 'feat' }, feats.map(([k, ok]) => pill(k, ok ? 'ok' : '', ok ? 'check' : 'x'))),
      hi.perms ? h('div', { class: 'small muted' }, 'Permissions: ' + hi.perms) : null))
    clear(grid, ...sections)

    // Plain-text report for support tickets
    const lines = [`Browser report (${new Date().toISOString()})`, '', `Browser: ${p.browser} ${p.version}`, `Engine: ${p.engine}`, `OS: ${g.osName} ${g.osVer}`, `Device: ${device}`, `User agent: ${ua}`,
      `Screen: ${sw}x${sh} @${+g.dpr.toFixed(2)}x, viewport ${innerWidth}x${innerHeight}`, `Language: ${nav.language}, time zone ${g.tz.timeZone} (${g.offStr})`, `Color scheme: ${g.scheme}`,
      `CPU threads: ${nav.hardwareConcurrency || 'n/a'}, memory: ${nav.deviceMemory || 'n/a'} GB`, `Online: ${nav.onLine}`, `Cookies: ${g.cookiesOn}`, `Features: ${feats.filter(([, v]) => v).map(([k]) => k).join(', ')}`,
      `Missing: ${feats.filter(([, v]) => !v).map(([k]) => k).join(', ') || 'none'}`]
    report = lines.join('\n')
  }
  const fmt = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`)

  async function enrich() {
    try {
      const hv = await navigator.userAgentData?.getHighEntropyValues?.(['platform', 'platformVersion', 'architecture', 'bitness', 'model', 'uaFullVersion', 'fullVersionList'])
      if (hv) Object.assign(hi, hv)
    } catch { /* not allowed */ }
    try { if (navigator.brave && (await navigator.brave.isBrave())) hi.brave = true } catch { /* ignore */ }
    try { hi.storage = await navigator.storage?.estimate?.(); hi.persisted = await navigator.storage?.persisted?.() } catch { /* ignore */ }
    try {
      const c = document.createElement('canvas').getContext('webgl')
      const ext = c?.getExtension('WEBGL_debug_renderer_info')
      if (ext) hi.gpu = String(c.getParameter(ext.UNMASKED_RENDERER_WEBGL)).replace(/^ANGLE \(|\)$/g, '')
    } catch { /* ignore */ }
    try {
      const names = ['geolocation', 'notifications', 'camera', 'microphone']
      const states = await Promise.all(names.map((n) => navigator.permissions.query({ name: n }).then((r) => `${n} ${r.state}`).catch(() => null)))
      hi.perms = states.filter(Boolean).join(', ')
    } catch { /* ignore */ }
    if (!signal?.aborted) render()
  }

  // Parse any user agent string
  const uaIn = input({ placeholder: 'Paste any user agent string to decode it', 'aria-label': 'User agent to decode', spellcheck: false })
  const uaOut = h('div')
  uaIn.addEventListener('input', () => {
    const v = uaIn.value.trim()
    clear(uaOut)
    if (!v) return
    const p = parseUA(v)
    uaOut.append(kvList([['Browser', `${p.browser} ${p.version}`.trim()], ['Engine', p.engine], ['Operating system', `${p.os} ${p.osVersion}`.trim()], ['Device type', p.device], p.inApp ? ['In-app browser', p.inApp] : null]))
  })

  const redo = debounce(render, 150)
  const listeners = [['resize', redo], ['online', render], ['offline', render], ['orientationchange', redo]]
  for (const [ev, fn] of listeners) window.addEventListener(ev, fn)
  const mqls = ['(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)'].map((q) => matchMedia(q))
  for (const m of mqls) m.addEventListener?.('change', render)

  const uaFocus = params.focus === 'ua'
  const decoder = h('section', { class: 'panel stack' }, h('h2', { style: 'margin:0' }, uaFocus ? 'Decode a user agent string' : 'Decode another user agent'), uaIn, uaOut,
    uaFocus ? h('div', { class: 'row' }, button('Use my own', { icon: 'user', size: 'sm', variant: 'ghost', onClick: () => { uaIn.value = navigator.userAgent; uaIn.dispatchEvent(new Event('input')) } })) : null)
  root.append(h('div', { class: 't-bi stack' },
    uaFocus ? decoder : null,
    uaFocus ? h('h2', { style: 'margin:8px 0 0' }, 'Your own browser') : null,
    heroEl,
    h('div', { class: 'row' }, copyButton(() => report, 'Copy report'), button('Download .txt', { icon: 'download', variant: 'secondary', size: 'sm', onClick: () => download(report, 'browser-report.txt', 'text/plain') }), button('Refresh', { icon: 'refresh-cw', variant: 'ghost', size: 'sm', onClick: () => { render(); enrich(); toast('Updated', 'info') } })),
    grid,
    uaFocus ? null : decoder,
    note('Everything on this page is read by your browser on your device. Nothing is uploaded. These are the same details any website you visit can see, which is useful when reporting a bug.')))
  if (uaFocus) { uaIn.value = navigator.userAgent; uaIn.dispatchEvent(new Event('input')) }
  render()
  enrich()
  return () => { for (const [ev, fn] of listeners) window.removeEventListener(ev, fn); for (const m of mqls) m.removeEventListener?.('change', render) }
}
