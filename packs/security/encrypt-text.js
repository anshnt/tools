// Encrypt / decrypt text or files with a password: AES-256-GCM, key from PBKDF2-SHA256 (600,000 rounds), random salt and IV, versioned output.
import { h, icon, field, textarea, segmented, panel, button, dropzone, alert, clear, busy, tabs, download, formatBytes } from '../../lib/ui.js'
import { useStyles, secretInput, copyBtn, meter, burst, ratingOf, sealText, openText, encryptBytes, decryptBytes, PBKDF2_ITERATIONS, downloadText } from './_shared.js'
import { charsetEntropy } from './password-strength.js'

const MAX_FILE = 256 * 1024 * 1024
const CSS = `
.sx-lock{display:grid;place-items:center;width:64px;height:64px;border-radius:20px;background:var(--accent-soft);color:var(--accent);flex:none;transition:background .4s,color .4s}
.sx-lock .icon{width:30px;height:30px}
.sx-lock.pop{animation:sx-lockpop .7s var(--spring)}
.sx-lock.done{background:var(--success-soft);color:var(--success)}
@keyframes sx-lockpop{0%{transform:scale(.6) rotate(-14deg)}55%{transform:scale(1.12) rotate(4deg)}100%{transform:none}}
.sx-enc-head{display:flex;gap:16px;align-items:center}
.sx-enc-head h3{font-size:17px}
.sx-spec{display:flex;flex-wrap:wrap;gap:6px}
.sx-spec span{font-size:11.5px;padding:3px 10px;border-radius:99px;background:var(--surface-2);border:1px solid var(--border);color:var(--text-2);font-family:var(--mono)}
.sx-pre{margin:0;padding:12px 14px;border-radius:12px;background:var(--surface-2);border:1px solid var(--border);font-family:var(--mono);font-size:12.5px;overflow:auto;white-space:pre}
`

export function mount(root, { signal }) {
  useStyles('sx-encrypt', CSS)

  const spec = h('div', { class: 'sx-spec' }, ['AES-256-GCM', `PBKDF2-SHA256 x ${PBKDF2_ITERATIONS.toLocaleString()}`, 'random 128-bit salt', 'random 96-bit IV'].map((t) => h('span', t)))
  const lockIcon = (name) => h('div', { class: 'sx-lock' }, icon(name))

  /** Password fields shared by both tabs; confirm only when encrypting. */
  function passwordFields(confirmNeeded) {
    const pm = meter()
    const pw = secretInput({ placeholder: 'Password', ariaLabel: 'Password', onInput: () => update() })
    const pw2 = secretInput({ placeholder: 'Repeat the password', ariaLabel: 'Repeat the password', onInput: () => update() })
    const msg = h('div', { class: 'sx-hint', 'aria-live': 'polite' })
    const wrap2 = field('Repeat password', pw2)
    wrap2.hidden = !confirmNeeded
    function update() {
      const v = pw.input.value
      if (confirmNeeded) {
        pm.hidden = !v
        if (v) pm.set(charsetEntropy(v).bits)
      }
      msg.textContent = ''
      if (confirmNeeded && pw2.input.value && pw2.input.value !== v) msg.textContent = 'The two passwords do not match yet.'
    }
    pm.hidden = true
    const el = h('div', { class: 'stack' }, field('Password', pw, confirmNeeded ? 'There is no recovery. If you forget this password the data cannot be opened.' : null), confirmNeeded ? pm : null, wrap2, msg)
    return { el, value: () => pw.input.value, confirmOk: () => !confirmNeeded || pw2.input.value === pw.input.value, clear: () => { pw.input.value = ''; pw2.input.value = ''; update() } }
  }

  // ---------- Text ----------
  function textView() {
    let mode = 'encrypt'
    const input = textarea({ rows: 7, placeholder: 'Type the message you want to protect...', 'aria-label': 'Text', oninput: () => hint() })
    const out = textarea({ rows: 6, readonly: true, mono: true, placeholder: 'The result appears here', 'aria-label': 'Result' })
    const status = h('div')
    const hintBox = h('div')
    const pwEnc = passwordFields(true)
    const pwDec = passwordFields(false)
    const pwHost = h('div')
    const go = button('Encrypt', { icon: 'lock', variant: 'primary', size: 'lg' })
    const modeSeg = segmented([['encrypt', 'Encrypt'], ['decrypt', 'Decrypt']], mode, (v) => setMode(v), 'Direction')
    const head = h('div', { class: 'sx-enc-head' })
    const outBar = h('div', { class: 'row' }, copyBtn(() => out.value, 'Copy result'), button('Download .txt', { icon: 'download', size: 'sm', onClick: () => out.value && downloadText(out.value, mode === 'encrypt' ? 'encrypted.txt' : 'decrypted.txt') }))
    outBar.hidden = true

    function setMode(v) {
      mode = v
      modeSeg.set(v)
      go.replaceChildren(icon(v === 'encrypt' ? 'lock' : 'lock-open'), h('span', v === 'encrypt' ? 'Encrypt' : 'Decrypt'))
      input.placeholder = v === 'encrypt' ? 'Type the message you want to protect...' : 'Paste the encrypted text (it starts with v1.)'
      input.setAttribute('aria-label', v === 'encrypt' ? 'Text to encrypt' : 'Encrypted text')
      clear(pwHost, v === 'encrypt' ? pwEnc.el : pwDec.el)
      clear(status); clear(hintBox)
      out.value = ''
      outBar.hidden = true
      clear(head, lockIcon(v === 'encrypt' ? 'lock-open' : 'lock'), h('div', h('h3', v === 'encrypt' ? 'Lock a message' : 'Unlock a message'), spec))
    }
    function hint() {
      clear(hintBox)
      if (mode === 'encrypt' && /^\s*v1\.[A-Za-z0-9+/=\s]{40,}$/.test(input.value)) clear(hintBox, alert('info', 'This looks like text that is already encrypted. ', button('Switch to Decrypt', { size: 'sm', onClick: () => setMode('decrypt') })))
    }
    go.addEventListener('click', () => busy(go, async () => {
      clear(status)
      const text = input.value
      if (!text.trim()) throw new Error(mode === 'encrypt' ? 'Type or paste the text to encrypt first.' : 'Paste the encrypted text first.')
      const pw = mode === 'encrypt' ? pwEnc : pwDec
      if (!pw.value()) throw new Error('Enter a password.')
      if (!pw.confirmOk()) throw new Error('The two passwords do not match.')
      const t0 = performance.now()
      out.value = mode === 'encrypt' ? await sealText(text, pw.value()) : await openText(text, pw.value())
      outBar.hidden = false
      const lock = head.querySelector('.sx-lock')
      lock.replaceChildren(icon(mode === 'encrypt' ? 'lock' : 'lock-open'))
      lock.classList.remove('pop'); void lock.offsetWidth; lock.classList.add('pop', 'done')
      burst(lock)
      clear(status, alert('success', h('strong', mode === 'encrypt' ? 'Encrypted. ' : 'Decrypted. '), mode === 'encrypt' ? `Safe to share: only someone with the password can read it. (${Math.round(performance.now() - t0)} ms)` : 'The message was authenticated, so it has not been tampered with.'))
    }, { label: mode === 'encrypt' ? 'Encrypting' : 'Decrypting', errorTo: status }))
    setMode('encrypt')
    return h('div', { class: 'stack' },
      panel(h('div', { class: 'stack' }, modeSeg, head, input, hintBox, pwHost, h('div', { class: 'row' }, go), status)),
      panel(h('div', { class: 'stack' }, h('div', { class: 'sx-k' }, icon('file-lock'), 'Result'), out, outBar)),
      h('details', { class: 'panel' }, h('summary', { style: 'cursor:pointer;font-weight:600' }, 'How it works, and decrypting elsewhere'),
        h('div', { class: 'stack', style: 'margin-top:12px' },
          h('div', { class: 'sx-hint' }, 'The password is NFC-normalised and UTF-8 encoded, then stretched into a 256-bit key with PBKDF2-HMAC-SHA256. The text is sealed with AES-256-GCM, which also detects any change. Output is "v1." followed by Base64 of these bytes:'),
          h('pre', { class: 'sx-pre' }, 'byte 0        version (1)\nbytes 1-4     PBKDF2 iterations, big-endian (600000)\nbytes 5-20    salt (16 random bytes)\nbytes 21-32   IV / nonce (12 random bytes)\nbytes 33-...  ciphertext followed by the 16-byte GCM tag\nadditional authenticated data = bytes 0-4'),
          h('div', { class: 'sx-hint' }, 'Any AES-GCM library can open it with these parameters. Nothing is sent to a server and nothing is stored.'))))
  }

  // ---------- Files ----------
  function fileView() {
    let file = null
    const status = h('div')
    const info = h('div')
    const pwEnc = passwordFields(true)
    const pwDec = passwordFields(false)
    const pwHost = h('div')
    const go = button('Encrypt file', { icon: 'lock', variant: 'primary', size: 'lg' })
    go.disabled = true
    const isEnc = () => file && /\.enc$/i.test(file.name)
    const zone = dropzone({ multiple: false, label: 'Drop a file to encrypt or decrypt', hint: `Files ending in .enc are decrypted. Up to ${formatBytes(MAX_FILE)}.`, onFiles: ([f]) => {
      file = f
      zone.classList.add('compact')
      const dec = isEnc()
      clear(info, h('div', { class: 'sx-file' }, h('div', { class: 'ic' }, icon(dec ? 'file-lock' : 'file')), h('div', { class: 'meta' }, h('div', { class: 'name', title: f.name }, f.name), h('div', { class: 'size' }, `${formatBytes(f.size)} - will be ${dec ? 'decrypted' : 'encrypted'}`))))
      clear(pwHost, dec ? pwDec.el : pwEnc.el)
      go.replaceChildren(icon(dec ? 'lock-open' : 'lock'), h('span', dec ? 'Decrypt file' : 'Encrypt file'))
      go.disabled = false
      clear(status)
      if (f.size > MAX_FILE) clear(status, alert('warn', `That file is ${formatBytes(f.size)}. Browsers can encrypt up to about ${formatBytes(MAX_FILE)} at once; split it first.`))
    } })
    go.addEventListener('click', () => busy(go, async () => {
      clear(status)
      if (!file) throw new Error('Choose a file first.')
      if (file.size > MAX_FILE) throw new Error(`That file is too large for in-browser encryption (limit ${formatBytes(MAX_FILE)}).`)
      const dec = isEnc()
      const pw = dec ? pwDec : pwEnc
      if (!pw.value()) throw new Error('Enter a password.')
      if (!pw.confirmOk()) throw new Error('The two passwords do not match.')
      const bytes = new Uint8Array(await file.arrayBuffer())
      const out = dec ? await decryptBytes(bytes, pw.value()) : await encryptBytes(bytes, pw.value())
      const name = dec ? file.name.replace(/\.enc$/i, '') || 'decrypted-file' : `${file.name}.enc`
      const blob = new Blob([out], { type: 'application/octet-stream' })
      clear(status, alert('success', h('strong', dec ? 'Decrypted. ' : 'Encrypted. '), `${name} is ${formatBytes(blob.size)}.`), h('div', { class: 'row', style: 'margin-top:12px' }, button(`Download ${name}`, { icon: 'download', variant: 'primary', onClick: () => download(blob, name) })))
      burst(go)
    }, { label: 'Working', errorTo: status }))
    return h('div', { class: 'stack' }, panel(h('div', { class: 'stack' }, zone, info, pwHost, h('div', { class: 'row' }, go), status,
      h('div', { class: 'sx-hint' }, 'Same format as the text version. The original file name is kept in the .enc name, so decrypting gives you the file back exactly.'))))
  }

  root.append(h('div', { class: 'sx stack' }, tabs([
    { id: 'text', label: 'Text', render: textView },
    { id: 'file', label: 'File', render: fileView },
  ], 'text')))
}
