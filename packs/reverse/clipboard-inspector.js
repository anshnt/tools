// Clipboard inspector: paste (or drop, or read with the async Clipboard API) and see every format the clipboard holds,
// with a view per format, a hex dump and a report of hidden characters. Nothing leaves the device.
import { h, clear, alert, button, tabs, copyText, copyButton, download, toggle, formatBytes, formatNumber, onCleanup, icon, toast } from '../../lib/ui.js'
import { dompurify } from '../../lib/libs.js'

// ---------- Pure helpers (exported for tests) ----------

const enc = new TextEncoder()
/** UTF-8 byte length of a string. */
export const utf8Size = (s) => enc.encode(s).length

const NAMES = {
  0x00a0: ['NBSP', 'No-break space'], 0x00ad: ['SHY', 'Soft hyphen'], 0x034f: ['CGJ', 'Combining grapheme joiner'], 0x061c: ['ALM', 'Arabic letter mark'],
  0x115f: ['HCF', 'Hangul choseong filler'], 0x1160: ['HJF', 'Hangul jungseong filler'], 0x1680: ['OGSP', 'Ogham space mark'], 0x180e: ['MVS', 'Mongolian vowel separator'],
  0x2000: ['NQSP', 'En quad'], 0x2001: ['MQSP', 'Em quad'], 0x2002: ['ENSP', 'En space'], 0x2003: ['EMSP', 'Em space'], 0x2004: ['3/MSP', 'Three-per-em space'],
  0x2005: ['4/MSP', 'Four-per-em space'], 0x2006: ['6/MSP', 'Six-per-em space'], 0x2007: ['FSP', 'Figure space'], 0x2008: ['PSP', 'Punctuation space'],
  0x2009: ['THSP', 'Thin space'], 0x200a: ['HSP', 'Hair space'], 0x200b: ['ZWSP', 'Zero width space'], 0x200c: ['ZWNJ', 'Zero width non-joiner'],
  0x200d: ['ZWJ', 'Zero width joiner'], 0x200e: ['LRM', 'Left-to-right mark'], 0x200f: ['RLM', 'Right-to-left mark'], 0x2028: ['LSEP', 'Line separator'],
  0x2029: ['PSEP', 'Paragraph separator'], 0x202a: ['LRE', 'Left-to-right embedding'], 0x202b: ['RLE', 'Right-to-left embedding'], 0x202c: ['PDF', 'Pop directional formatting'],
  0x202d: ['LRO', 'Left-to-right override'], 0x202e: ['RLO', 'Right-to-left override'], 0x202f: ['NNBSP', 'Narrow no-break space'], 0x205f: ['MMSP', 'Medium mathematical space'],
  0x2060: ['WJ', 'Word joiner'], 0x2061: ['FA', 'Function application'], 0x2062: ['IT', 'Invisible times'], 0x2063: ['IS', 'Invisible separator'], 0x2064: ['IP', 'Invisible plus'],
  0x2066: ['LRI', 'Left-to-right isolate'], 0x2067: ['RLI', 'Right-to-left isolate'], 0x2068: ['FSI', 'First strong isolate'], 0x2069: ['PDI', 'Pop directional isolate'],
  0x3000: ['IDSP', 'Ideographic space'], 0x3164: ['HF', 'Hangul filler'], 0xfeff: ['BOM', 'Zero width no-break space (byte order mark)'], 0xffa0: ['HWHF', 'Halfwidth Hangul filler'],
  0xfffc: ['OBJ', 'Object replacement character'], 0xfffd: ['REPL', 'Replacement character'], 0x0085: ['NEL', 'Next line'], 0x007f: ['DEL', 'Delete'],
  0x2010: ['HYPH', 'Hyphen'], 0x2011: ['NBHY', 'Non-breaking hyphen'], 0x2212: ['MINUS', 'Minus sign'], 0x2215: ['DIVSL', 'Division slash'], 0x2044: ['FRSL', 'Fraction slash'],
  0x2024: ['ODL', 'One dot leader'], 0x01c0: ['DNTC', 'Latin letter dental click'], 0x0131: ['DLI', 'Latin small letter dotless i'],
}

// Non-ASCII characters that look like ASCII ones (a practical subset of Unicode confusables).
const LOOKALIKE = {
  0x0430: 'a', 0x0435: 'e', 0x043e: 'o', 0x0440: 'p', 0x0441: 'c', 0x0443: 'y', 0x0445: 'x', 0x0456: 'i', 0x0458: 'j', 0x0455: 's', 0x0501: 'd', 0x04bb: 'h', 0x051b: 'q', 0x051d: 'w', 0x0475: 'v',
  0x0410: 'A', 0x0412: 'B', 0x0415: 'E', 0x041a: 'K', 0x041c: 'M', 0x041d: 'H', 0x041e: 'O', 0x0420: 'P', 0x0421: 'C', 0x0422: 'T', 0x0425: 'X', 0x0406: 'I', 0x0408: 'J', 0x0405: 'S', 0x04ae: 'Y',
  0x0391: 'A', 0x0392: 'B', 0x0395: 'E', 0x0396: 'Z', 0x0397: 'H', 0x0399: 'I', 0x039a: 'K', 0x039c: 'M', 0x039d: 'N', 0x039f: 'O', 0x03a1: 'P', 0x03a4: 'T', 0x03a5: 'Y', 0x03a7: 'X',
  0x03bf: 'o', 0x03bd: 'v', 0x03b1: 'a', 0x03b9: 'i', 0x03ba: 'k', 0x03c1: 'p', 0x03c5: 'u',
  0x0585: 'o', 0x057d: 'u', 0x0578: 'n', 0x0251: 'a', 0x0261: 'g', 0x0131: 'i', 0x01c0: 'l', 0x13a0: 'D', 0x13a1: 'R', 0x13a2: 'T', 0x13aa: 'A', 0x13b3: 'W', 0x13bb: 'H', 0x13c7: 'Q',
  0x2010: '-', 0x2011: '-', 0x2212: '-', 0x2215: '/', 0x2044: '/', 0x2024: '.', 0x0589: ':', 0x02d0: ':', 0xa789: ':', 0x01c3: '!', 0x2160: 'I', 0x216c: 'L', 0x216d: 'C', 0x216e: 'D', 0x216f: 'M', 0x2170: 'i', 0x217c: 'l',
}

export const CATEGORIES = {
  zw: 'Zero-width / invisible',
  bidi: 'Bidirectional control',
  space: 'Unusual space or line break',
  control: 'Control character',
  shy: 'Soft hyphen',
  vs: 'Variation selector',
  tag: 'Tag character (hidden ASCII)',
  pua: 'Private use',
  look: 'Looks like ASCII (homoglyph)',
  special: 'Special',
}

/** Category key for a code point, or null for ordinary characters. */
export function classifyChar(cp) {
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return null
  if (cp < 0x20 || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f && cp !== 0x85)) return 'control'
  if (cp < 0x80) return null
  if (cp === 0xad) return 'shy'
  if ((cp >= 0x200b && cp <= 0x200d) || cp === 0x2060 || cp === 0xfeff || cp === 0x180e || (cp >= 0x2061 && cp <= 0x2064) || cp === 0x034f || cp === 0x115f || cp === 0x1160 || cp === 0x3164 || cp === 0xffa0) return 'zw'
  if (cp === 0x200e || cp === 0x200f || cp === 0x061c || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) return 'bidi'
  if (cp === 0xa0 || cp === 0x85 || cp === 0x1680 || (cp >= 0x2000 && cp <= 0x200a) || cp === 0x2028 || cp === 0x2029 || cp === 0x202f || cp === 0x205f || cp === 0x3000) return 'space'
  if ((cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)) return 'vs'
  if (cp >= 0xe0000 && cp <= 0xe007f) return 'tag'
  if ((cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0xf0000) return 'pua'
  if (cp === 0xfffc || cp === 0xfffd) return 'special'
  if (LOOKALIKE[cp] || (cp >= 0xff01 && cp <= 0xff5e) || (cp >= 0x1d400 && cp <= 0x1d7ff)) return 'look'
  return null
}

const hexCp = (cp) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0')
/** Short and long name for a code point. */
export function charName(cp) {
  if (NAMES[cp]) return NAMES[cp]
  if (cp < 0x20) return [['NUL', 'SOH', 'STX', 'ETX', 'EOT', 'ENQ', 'ACK', 'BEL', 'BS', 'HT', 'LF', 'VT', 'FF', 'CR', 'SO', 'SI', 'DLE', 'DC1', 'DC2', 'DC3', 'DC4', 'NAK', 'SYN', 'ETB', 'CAN', 'EM', 'SUB', 'ESC', 'FS', 'GS', 'RS', 'US'][cp], 'C0 control character']
  if (cp >= 0x80 && cp <= 0x9f) return ['C1', 'C1 control character']
  if (cp >= 0xfe00 && cp <= 0xfe0f) return [`VS${cp - 0xfe00 + 1}`, `Variation selector ${cp - 0xfe00 + 1}`]
  if (cp >= 0xe0100 && cp <= 0xe01ef) return [`VS${cp - 0xe0100 + 17}`, `Variation selector ${cp - 0xe0100 + 17}`]
  if (cp >= 0xe0020 && cp <= 0xe007e) return [`TAG ${String.fromCharCode(cp - 0xe0000)}`, `Tag ${String.fromCharCode(cp - 0xe0000)}`]
  if (cp === 0xe0001) return ['LANG TAG', 'Language tag']
  if (cp === 0xe007f) return ['CANCEL TAG', 'Cancel tag']
  if (cp >= 0xff01 && cp <= 0xff5e) return [`FW ${String.fromCharCode(cp - 0xfee0)}`, `Fullwidth ${String.fromCharCode(cp - 0xfee0)}`]
  if (cp >= 0x1d400 && cp <= 0x1d7ff) return ['MATH', 'Mathematical alphanumeric symbol']
  if (LOOKALIKE[cp]) {
    const script = cp >= 0x0400 && cp < 0x0530 ? 'Cyrillic' : cp >= 0x0370 && cp < 0x0400 ? 'Greek' : cp >= 0x0530 && cp < 0x0590 ? 'Armenian' : cp >= 0x13a0 && cp < 0x1400 ? 'Cherokee' : cp >= 0x2160 && cp < 0x2190 ? 'Roman numeral' : 'Non-ASCII'
    return [`${script} ${String.fromCodePoint(cp)}`, `${script} letter that looks like "${LOOKALIKE[cp]}"`]
  }
  if (cp >= 0xe000 && cp <= 0xf8ff) return ['PUA', 'Private use character']
  return [hexCp(cp), 'Character']
}

/** ASCII lookalike for a homoglyph, if any. */
export function lookalike(cp) {
  if (LOOKALIKE[cp]) return LOOKALIKE[cp]
  if (cp >= 0xff01 && cp <= 0xff5e) return String.fromCharCode(cp - 0xfee0)
  return ''
}

/**
 * Find hidden and suspicious characters. Returns { found: [{cp, hex, short, name, category, label, count, positions:[{line, col, index}], ascii}],
 * total, tagText, otherNonAscii }.
 */
export function findHiddenChars(text, maxPositions = 25) {
  const byCp = new Map()
  let line = 1, col = 1, index = 0, total = 0, otherNonAscii = 0, tagText = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0)
    const cat = classifyChar(cp)
    if (cat) {
      total++
      let r = byCp.get(cp)
      if (!r) {
        const [short, name] = charName(cp)
        byCp.set(cp, (r = { cp, hex: hexCp(cp), short, name, category: cat, label: CATEGORIES[cat], count: 0, positions: [], ascii: lookalike(cp) }))
      }
      r.count++
      if (r.positions.length < maxPositions) r.positions.push({ line, col, index })
      if (cat === 'tag' && cp >= 0xe0020 && cp <= 0xe007e) tagText += String.fromCharCode(cp - 0xe0000)
    } else if (cp > 0x7f) otherNonAscii++
    if (cp === 0x0a) { line++; col = 1 } else col++
    index += ch.length
  }
  const order = Object.keys(CATEGORIES)
  const found = [...byCp.values()].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || b.count - a.count)
  return { found, total, tagText, otherNonAscii }
}

/** Remove invisible characters and normalize unusual spaces. Lookalike letters are kept (they may be real text). */
export function cleanText(text) {
  let out = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0)
    const cat = classifyChar(cp)
    if (cat === 'zw' || cat === 'bidi' || cat === 'tag' || cat === 'shy' || (cat === 'control')) continue
    if (cat === 'space') out += cp === 0x2028 || cp === 0x2029 || cp === 0x85 ? '\n' : ' '
    else out += ch
  }
  return out
}

/** Split text into plain runs and hidden-character markers for the reveal view. */
export function revealParts(text) {
  const parts = []
  let buf = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0)
    const cat = classifyChar(cp)
    if (cat && cat !== 'look') {
      if (buf) { parts.push(buf); buf = '' }
      parts.push({ cp, short: charName(cp)[0], category: cat })
    } else if (cat === 'look') {
      if (buf) { parts.push(buf); buf = '' }
      parts.push({ cp, short: ch, category: cat, char: ch })
    } else buf += ch
  }
  if (buf) parts.push(buf)
  return parts
}

/** Hex + ASCII dump, 16 bytes per line. */
export function hexDump(bytes, max = 4096) {
  const n = Math.min(bytes.length, max)
  const out = []
  for (let o = 0; o < n; o += 16) {
    const chunk = bytes.subarray(o, Math.min(n, o + 16))
    const hex = Array.from(chunk, (b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ')
    const asc = Array.from(chunk, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('')
    out.push(`${o.toString(16).padStart(8, '0')}  ${hex}  ${asc}`)
  }
  return out.join('\n')
}

/** Lines of a text/uri-list: { urls, comments }. */
export function parseUriList(text) {
  const urls = [], comments = []
  for (const l of text.split(/\r?\n/)) {
    const t = l.trim()
    if (!t) continue
    if (t.startsWith('#')) comments.push(t.slice(1).trim())
    else urls.push(t)
  }
  return { urls, comments }
}

const EXT = { 'text/plain': 'txt', 'text/html': 'html', 'text/rtf': 'rtf', 'application/rtf': 'rtf', 'text/uri-list': 'txt', 'text/csv': 'csv', 'application/json': 'json', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'text/xml': 'xml', 'application/xml': 'xml' }
/** File name for downloading a clipboard item. */
export function fileNameFor(type, name) {
  if (name) return name
  const e = EXT[type.toLowerCase()] || (type.startsWith('text/') ? 'txt' : 'bin')
  const slug = type === 'text/plain' ? '' : '-' + type.replace(/^web\s+/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  return `clipboard${slug}.${e}`
}

/**
 * Copy everything out of a DataTransfer synchronously (its data disappears after the event).
 * Returns { types, items: [{type, kind: 'string'|'file', text?, file?, name?}] }.
 */
export function snapshotTransfer(dt) {
  const types = [...(dt?.types || [])]
  const items = []
  for (const t of types) {
    if (t === 'Files') continue
    let text = ''
    try { text = dt.getData(t) } catch { /* unreadable */ }
    items.push({ type: t, kind: 'string', text })
  }
  const files = []
  for (const it of dt?.items || []) {
    if (it.kind !== 'file') continue
    const f = it.getAsFile()
    if (f) files.push(f)
  }
  if (!files.length) for (const f of dt?.files || []) files.push(f)
  for (const f of files) items.push({ type: f.type || 'application/octet-stream', kind: 'file', file: f, name: f.name })
  return { types, items }
}

// ---------- UI ----------

const STYLE = `
.t-clip .ci-target { min-height: 170px; border: 2px dashed var(--border-strong); border-radius: var(--radius-lg); background: var(--surface); display: grid; place-items: center; text-align: center; padding: 24px 16px; cursor: text; color: var(--muted); caret-color: transparent; outline: none; transition: border-color .2s, background .2s; overflow-wrap: anywhere; }
.t-clip .ci-target:focus-visible, .t-clip .ci-target:focus { border-color: var(--accent); background: var(--accent-soft); box-shadow: 0 0 0 4px var(--ring); }
.t-clip .ci-target.drag { border-color: var(--accent); background: var(--accent-soft); }
.t-clip .ci-target strong { display: block; color: var(--text); font-size: 17px; margin: 8px 0 4px; }
.t-clip .ci-target .icon { width: 30px; height: 30px; color: var(--accent); }
.t-clip .ci-type { font-family: var(--mono); font-size: 14px; overflow-wrap: anywhere; }
.t-clip .ci-head { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; justify-content: space-between; }
.t-clip .ci-head h3 { margin: 0; display: flex; gap: 8px; align-items: center; min-width: 0; font-size: 15px; }
.t-clip .ci-frame { width: 100%; height: 320px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); resize: vertical; display: block; }
.t-clip .ci-reveal { white-space: pre-wrap; overflow-wrap: anywhere; }
.t-clip .ci-mark { font-family: var(--mono); font-size: 11px; padding: 0 3px; margin: 0 1px; border-radius: 4px; background: var(--warning-soft); color: var(--warning); border: 1px solid currentColor; }
.t-clip .ci-mark.look { font-size: inherit; font-family: inherit; background: var(--danger-soft); color: var(--danger); }
.t-clip .ci-img { max-width: 100%; max-height: 420px; display: block; }
.t-clip .ci-sum td:first-child a { color: inherit; }
@media (prefers-reduced-motion: reduce) { .t-clip .ci-target { transition: none; } }
`
let styled = false
const injectStyle = () => { if (!styled) { styled = true; document.head.append(h('style', { 'data-tool': 'clipboard-inspector' }, STYLE)) } }

const CSP = (remote) => `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:${remote ? ' https: http:' : ''}; font-src data:">`

export function mount(root) {
  injectStyle()
  const urls = new Set()
  const revokeAll = () => { for (const u of urls) URL.revokeObjectURL(u); urls.clear() }
  onCleanup(revokeAll)
  const result = h('div', { class: 'stack' })
  const status = h('div', { class: 'sr-only', 'aria-live': 'polite', style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)' })

  const target = h('div', {
    class: 'ci-target', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'false', tabindex: 0, spellcheck: false, autocorrect: 'off',
    'aria-label': 'Paste target. Press Ctrl+V or Cmd+V here, or drop something on it.',
    onbeforeinput: (e) => e.preventDefault(),
    oninput: () => { target.replaceChildren(...hint) },
    onpaste: (e) => { e.preventDefault(); e.stopPropagation(); take(snapshotTransfer(e.clipboardData), 'paste') },
    ondragover: (e) => { e.preventDefault(); target.classList.add('drag') },
    ondragleave: () => target.classList.remove('drag'),
    ondrop: (e) => { e.preventDefault(); target.classList.remove('drag'); take(snapshotTransfer(e.dataTransfer), 'drop') },
  })
  const hint = [h('div', icon('clipboard-paste'), h('strong', 'Click here and paste'), h('span', { class: 'small' }, 'Ctrl+V (Cmd+V on Mac), long-press and Paste on a phone, or drag and drop text, links, images or files.'))]
  target.append(...hint)

  // Catch a paste anywhere on the page too, unless it goes into a form field.
  const onDocPaste = (e) => {
    if (e.defaultPrevented || !target.isConnected) return
    if (e.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return
    e.preventDefault()
    take(snapshotTransfer(e.clipboardData), 'paste')
  }
  document.addEventListener('paste', onDocPaste)
  onCleanup(() => document.removeEventListener('paste', onDocPaste))

  const readBtn = button('Read clipboard', { icon: 'clipboard', onClick: readClipboard })
  const clearBtn = button('Clear', { icon: 'eraser', variant: 'ghost', onClick: () => { revokeAll(); clear(result); target.focus() } })

  async function readClipboard() {
    const cb = navigator.clipboard
    if (!cb?.read && !cb?.readText) { clear(result, alert('info', 'This browser does not let pages read the clipboard directly. Click the box above and paste instead.')); target.focus(); return }
    try {
      let clipItems
      if (cb.read) {
        try { clipItems = await cb.read({ unsanitized: ['text/html'] }) } catch (e) { if (e.name === 'NotAllowedError' || e.name === 'SecurityError') throw e; clipItems = await cb.read() }
        const items = []
        const types = []
        for (const ci of clipItems) {
          for (const t of ci.types) {
            types.push(t)
            const blob = await ci.getType(t)
            if (t.startsWith('text/') || t.startsWith('web text/')) items.push({ type: t, kind: 'string', text: await blob.text() })
            else items.push({ type: t, kind: 'file', file: blob, name: '' })
          }
        }
        take({ types, items }, 'Clipboard API')
      } else {
        const text = await cb.readText()
        take({ types: ['text/plain'], items: [{ type: 'text/plain', kind: 'string', text }] }, 'Clipboard API (text only)')
      }
    } catch (e) {
      console.warn(e)
      clear(result, alert('info', e.name === 'NotAllowedError' || e.name === 'SecurityError'
        ? 'Clipboard access was blocked or not allowed. Click the box above and press Ctrl+V (or long-press and Paste) instead. Pasting also shows more formats than the Clipboard API.'
        : `The clipboard could not be read (${e.message}). Click the box above and paste instead.`))
      target.focus()
    }
  }

  function take(snap, source) {
    revokeAll()
    target.replaceChildren(...hint)
    if (!snap.items.length) {
      clear(result, alert('info', snap.types.length ? `The clipboard has ${snap.types.join(', ')}, but the browser did not share any data for it.` : 'The clipboard looks empty. Copy something first, then paste here.'))
      return
    }
    const totalBytes = snap.items.reduce((a, it) => a + (it.kind === 'string' ? utf8Size(it.text) : it.file.size), 0)
    status.textContent = `${snap.items.length} format${snap.items.length === 1 ? '' : 's'} found`
    const cards = snap.items.map((it, i) => itemCard(it, i, urls))
    clear(result,
      h('section', { class: 'panel stack tight ci-sum' },
        h('div', { class: 'ci-head' }, h('h2', { style: 'margin:0;font-size:17px' }, `${snap.items.length} format${snap.items.length === 1 ? '' : 's'}, ${formatBytes(totalBytes)}`), h('span', { class: 'small muted' }, `From ${source}`)),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', h('tr', h('th', { scope: 'col' }, 'Type'), h('th', { scope: 'col' }, 'Kind'), h('th', { scope: 'col', class: 'num' }, 'Size'))),
          h('tbody', snap.items.map((it, i) => h('tr',
            h('td', h('a', { href: `#ci-item-${i}`, class: 'ci-type', onclick: (e) => { e.preventDefault(); cards[i].scrollIntoView({ block: 'start' }); cards[i].focus({ preventScroll: true }) } }, it.type || '(no type)')),
            h('td', it.kind === 'string' ? 'text' : it.name ? 'file' : 'binary'),
            h('td', { class: 'num' }, formatBytes(it.kind === 'string' ? utf8Size(it.text) : it.file.size))))))),
        snap.types.includes('Files') ? h('p', { class: 'small muted' }, 'The "Files" entry is listed by the browser for clipboard files; each file appears below.') : null,
        h('p', { class: 'small muted' }, 'Text sizes are UTF-8 bytes. Browsers only share some formats with web pages (usually text, HTML, RTF, links, images and files).')),
      cards)
  }

  root.append(h('div', { class: 'stack t-clip' }, target, h('div', { class: 'row' }, readBtn, clearBtn, h('span', { class: 'small muted' }, 'Reading needs your permission. Everything stays on this device.')), status, result))
}

function itemCard(it, i, urls) {
  const isText = it.kind === 'string'
  const type = (it.type || '').toLowerCase()
  const size = isText ? utf8Size(it.text) : it.file.size
  const getBytes = async (n) => (isText ? enc.encode(it.text).subarray(0, n) : new Uint8Array(await it.file.slice(0, n).arrayBuffer()))
  const name = fileNameFor(it.type || 'application/octet-stream', it.name)
  const actions = h('div', { class: 'row' },
    isText ? copyButton(() => it.text, 'Copy') : null,
    button('Download', { icon: 'download', size: 'sm', onClick: () => download(isText ? new Blob([it.text], { type: it.type || 'text/plain' }) : it.file, name) }))

  const views = []
  let hidden = null
  if (isText) {
    hidden = findHiddenChars(it.text)
    if (type === 'text/html' || type === 'web text/html') {
      views.push({ id: 'preview', label: 'Preview', render: () => htmlPreview(it.text) })
      views.push({ id: 'source', label: 'Source', render: () => textBlock(it.text) })
    } else if (type === 'text/uri-list') {
      views.push({ id: 'links', label: 'Links', render: () => uriList(it.text) })
      views.push({ id: 'source', label: 'Source', render: () => textBlock(it.text) })
    } else {
      views.push({ id: 'text', label: type.includes('rtf') ? 'RTF source' : 'Text', render: () => textBlock(it.text) })
    }
    if (hidden.total) views.push({ id: 'reveal', label: 'Reveal hidden', render: () => revealView(it.text) })
  } else {
    if (type.startsWith('image/')) views.push({ id: 'image', label: 'Image', render: () => imageView(it.file, urls) })
    views.push({ id: 'file', label: 'Details', render: () => fileDetails(it) })
    if (type.startsWith('text/') || /json|xml/.test(type)) views.push({ id: 'text', label: 'Text', render: () => asyncText(it.file) })
  }
  views.push({ id: 'hex', label: 'Hex', render: () => hexView(getBytes, size) })

  return h('section', { class: 'panel stack tight', id: `ci-item-${i}`, tabindex: -1, 'aria-label': `Clipboard format ${it.type}` },
    h('div', { class: 'ci-head' },
      h('h3', icon(isText ? (type.includes('html') ? 'code' : 'text') : type.startsWith('image/') ? 'image' : 'file'), h('span', { class: 'ci-type' }, it.type || '(no type)'),
        h('span', { class: 'small muted', style: 'font-weight:400' }, formatBytes(size) + (isText ? `, ${formatNumber([...it.text].length)} characters` : ''))),
      actions),
    hidden ? hiddenReport(hidden, it.text) : null,
    tabs(views))
}

function textBlock(text) {
  const MAX = 200000
  const shown = text.length > MAX ? text.slice(0, MAX) : text
  return h('div', { class: 'stack tight' },
    text ? h('pre', { class: 'code-out' }, shown) : h('p', { class: 'muted small' }, 'Empty string.'),
    shown !== text ? h('p', { class: 'small muted' }, `Showing the first ${formatNumber(MAX)} of ${formatNumber(text.length)} characters. Download for all of it.`) : null)
}

function hiddenReport(r, text) {
  if (!r.total) {
    return h('p', { class: 'small muted' }, icon('circle-check'), ' No hidden or lookalike characters.', r.otherNonAscii ? ` ${formatNumber(r.otherNonAscii)} other non-ASCII character(s), such as accents or emoji.` : '')
  }
  return h('div', { class: 'stack tight' },
    alert('warn', h('strong', `${formatNumber(r.total)} hidden or suspicious character${r.total === 1 ? '' : 's'} found. `),
      r.tagText ? h('span', 'Hidden tag text spells: ', h('code', r.tagText), '. ') : null,
      'They are listed below with their code points.'),
    h('div', { class: 'table-wrap', style: 'max-height:300px' }, h('table', { class: 'table' },
      h('thead', h('tr', ['Code point', 'Name', 'Kind', 'Count', 'Where (line:column)'].map((c, i) => h('th', { scope: 'col', class: i === 3 ? 'num' : null }, c)))),
      h('tbody', r.found.map((f) => h('tr',
        h('td', h('code', f.hex)),
        h('td', f.name, f.ascii ? h('span', { class: 'muted' }, ` (looks like "${f.ascii}")`) : null),
        h('td', f.label),
        h('td', { class: 'num' }, formatNumber(f.count)),
        h('td', { class: 'small' }, f.positions.slice(0, 8).map((p) => `${p.line}:${p.col}`).join(', ') + (f.count > 8 ? ', ...' : ''))))))),
    h('div', { class: 'row' }, button('Copy without hidden characters', { icon: 'eraser', size: 'sm', onClick: () => copyText(cleanText(text)) }),
      h('span', { class: 'small muted' }, 'Removes invisible, bidi and control characters and turns odd spaces into normal ones. Lookalike letters are kept.')))
}

function revealView(text) {
  const MAX = 100000
  const parts = revealParts(text.length > MAX ? text.slice(0, MAX) : text)
  return h('pre', { class: 'code-out ci-reveal' }, parts.map((p) => typeof p === 'string' ? p
    : h('mark', { class: ['ci-mark', p.category === 'look' && 'look'], title: `${hexCp(p.cp)} ${charName(p.cp)[1]}` }, p.category === 'look' ? p.char : p.short)))
}

function htmlPreview(html) {
  const host = h('div', { class: 'stack tight' }, h('p', { class: 'small muted' }, 'Sanitizing...'))
  const remote = toggle('Load remote images', false, () => draw())
  let clean = ''
  const draw = () => {
    const frame = h('iframe', { class: 'ci-frame', sandbox: '', title: 'Sanitized HTML preview', referrerpolicy: 'no-referrer' })
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8">${CSP(remote.input.checked)}<style>:root{color-scheme:light}body{font:15px/1.5 system-ui,sans-serif;margin:12px;color:CanvasText;background:Canvas;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style></head><body>${clean}</body></html>`
    clear(host, frame, h('div', { class: 'row' }, remote, h('span', { class: 'small muted' }, 'Scripts and event handlers are removed (DOMPurify) and the preview runs in a sandbox with no network access unless you allow remote images.')))
  }
  dompurify().then((DOMPurify) => {
    clean = DOMPurify.sanitize(html, { FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select'] })
    draw()
  }).catch((e) => clear(host, alert('error', e.message)))
  return host
}

function uriList(text) {
  const { urls, comments } = parseUriList(text)
  return h('div', { class: 'stack tight' },
    comments.length ? h('p', { class: 'small muted' }, `Comments: ${comments.join(', ')}`) : null,
    urls.length ? h('ol', { class: 'stack tight', style: 'margin:0;padding-left:20px' }, urls.map((u) => {
      const safe = /^https?:\/\//i.test(u)
      return h('li', { style: 'overflow-wrap:anywhere' }, safe ? h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, u) : h('code', u))
    })) : h('p', { class: 'muted small' }, 'No links.'))
}

function imageView(file, urls) {
  const url = URL.createObjectURL(file)
  urls.add(url)
  const dims = h('span', { class: 'small muted' }, 'Loading...')
  const img = h('img', { class: 'ci-img', src: url, alt: 'Pasted image', onload: () => { dims.textContent = `${img.naturalWidth} x ${img.naturalHeight} px, ${file.type || 'unknown type'}` }, onerror: () => { dims.textContent = 'The browser cannot display this image format.' } })
  return h('div', { class: 'stack tight' }, h('div', { class: 'preview' }, img), dims)
}

function fileDetails(it) {
  const f = it.file
  const rows = [['Name', it.name || '(none, raw clipboard data)'], ['Type', f.type || 'unknown'], ['Size', `${formatBytes(f.size)} (${formatNumber(f.size)} bytes)`]]
  if (f.lastModified) rows.push(['Last modified', new Date(f.lastModified).toLocaleString()])
  return h('dl', { style: 'display:grid;grid-template-columns:minmax(0,140px) minmax(0,1fr);gap:4px 12px;margin:0' }, rows.map(([k, v]) => [h('dt', { class: 'muted small' }, k), h('dd', { style: 'margin:0;overflow-wrap:anywhere' }, v)]))
}

function asyncText(file) {
  const host = h('div', h('p', { class: 'small muted' }, 'Reading...'))
  file.slice(0, 200000).text().then((t) => clear(host, textBlock(t), file.size > 200000 ? h('p', { class: 'small muted' }, 'Showing the first 200 KB.') : null)).catch((e) => clear(host, alert('error', e.message)))
  return host
}

function hexView(getBytes, size) {
  let shown = 4096
  const pre = h('pre', { class: 'code-out' }, 'Reading...')
  const info = h('p', { class: 'small muted' })
  const more = button('Show more', { icon: 'chevrons-down', size: 'sm', onClick: () => { shown += 16384; draw() } })
  const draw = async () => {
    const n = Math.min(size, shown)
    const b = await getBytes(n)
    pre.textContent = b.length ? hexDump(b, n) : '(no bytes)'
    info.textContent = `Showing ${formatNumber(Math.min(n, b.length))} of ${formatNumber(size)} bytes.`
    more.hidden = n >= size
  }
  draw().catch((e) => { pre.textContent = ''; toast(e.message, 'error') })
  return h('div', { class: 'stack tight' }, pre, h('div', { class: 'row' }, info, more))
}
