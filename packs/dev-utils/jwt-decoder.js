// JWT decoder (default) and JWT generator (params.mode = 'generate').
// Verifies HS256/384/512 with a secret and RS/PS/ES/EdDSA with a public key (PEM, certificate or JWK) using WebCrypto.
import { h, icon, textarea, input as inputEl, toggle, select, button, split, alert, clear, table, onCleanup, debounce, copyText, segmented, stats } from '../../lib/ui.js'
import { useKit, css, outBox, jsonView, eyebrow, pill, chips, hex, utf8 } from './_kit.js'

// ---------- Pure helpers (exported for tests) ----------
export const b64uEncode = (bytes) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export const b64uDecode = (str) => {
  const s = str.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}
const textOf = (b64u) => new TextDecoder().decode(b64uDecode(b64u))

/** Split and decode a token. Throws a readable error when it is not a JWT. */
export function parseJwt(token) {
  const t = token.trim().replace(/^bearer\s+/i, '').replace(/\s+/g, '')
  if (!t) throw new Error('Paste a token first.')
  const parts = t.split('.')
  if (parts.length === 5) throw new Error('This looks like an encrypted JWT (JWE) with 5 parts. Only signed tokens (3 parts) can be decoded here.')
  if (parts.length !== 3) throw new Error(`A JWT has 3 parts separated by dots, but this has ${parts.length}.`)
  if (!parts.slice(0, 2).every((p) => /^[A-Za-z0-9_-]+$/.test(p))) throw new Error('The header or payload is not valid Base64URL (only A-Z a-z 0-9 - _ are allowed).')
  let header, payload
  try { header = JSON.parse(textOf(parts[0])) } catch { throw new Error('The header is not valid JSON after Base64URL decoding.') }
  try { payload = JSON.parse(textOf(parts[1])) } catch { payload = null }
  if (payload === null) {
    let raw = ''
    try { raw = textOf(parts[1]) } catch { /* ignore */ }
    return { token: t, parts, header, payload: null, rawPayload: raw, signature: parts[2] }
  }
  return { token: t, parts, header, payload, signature: parts[2] }
}

const HASH = { 256: 'SHA-256', 384: 'SHA-384', 512: 'SHA-512' }
export const ALGS = ['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA']
const CURVE = { ES256: 'P-256', ES384: 'P-384', ES512: 'P-521' }

function algParams(alg) {
  const bits = alg.slice(2)
  if (alg.startsWith('HS')) return { import: { name: 'HMAC', hash: HASH[bits] }, sign: { name: 'HMAC' } }
  if (alg.startsWith('RS')) return { import: { name: 'RSASSA-PKCS1-v1_5', hash: HASH[bits] }, sign: { name: 'RSASSA-PKCS1-v1_5' } }
  if (alg.startsWith('PS')) return { import: { name: 'RSA-PSS', hash: HASH[bits] }, sign: { name: 'RSA-PSS', saltLength: +bits / 8 } }
  if (alg.startsWith('ES')) return { import: { name: 'ECDSA', namedCurve: CURVE[alg] }, sign: { name: 'ECDSA', hash: HASH[bits === '512' ? 512 : bits] } }
  if (alg === 'EdDSA') return { import: { name: 'Ed25519' }, sign: { name: 'Ed25519' } }
  throw new Error(`The algorithm "${alg}" is not supported here.`)
}

// --- minimal DER reader, enough to pull the public key out of a certificate or wrap a PKCS#1 key ---
function tlv(b, o) {
  const tag = b[o]
  let len = b[o + 1]
  let p = o + 2
  if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + b[p++] }
  return { tag, start: p, end: p + len, hdr: o }
}
const der = (tag, ...chunks) => {
  const body = chunks.reduce((a, c) => { const r = new Uint8Array(a.length + c.length); r.set(a); r.set(c, a.length); return r }, new Uint8Array())
  const l = body.length
  const lenBytes = l < 128 ? [l] : l < 256 ? [0x81, l] : [0x82, l >> 8, l & 255]
  return Uint8Array.from([tag, ...lenBytes, ...body])
}
function certToSpki(bytes) {
  const cert = tlv(bytes, 0)
  const tbs = tlv(bytes, cert.start)
  let o = tbs.start
  let el = tlv(bytes, o)
  if (el.tag === 0xa0) { o = el.end; el = tlv(bytes, o) } // optional version
  for (let i = 0; i < 5; i++) { o = tlv(bytes, o).end } // serial, sigAlg, issuer, validity, subject
  const spki = tlv(bytes, o)
  return bytes.slice(spki.hdr, spki.end)
}
const RSA_ALG_ID = Uint8Array.from([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00])
const pkcs1ToSpki = (pkcs1) => der(0x30, RSA_ALG_ID, der(0x03, Uint8Array.from([0]), pkcs1))

export function pemBlocks(text) {
  return [...text.matchAll(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g)].map((m) => ({ label: m[1], der: Uint8Array.from(atob(m[2].replace(/\s+/g, '')), (c) => c.charCodeAt(0)) }))
}
export const toPem = (bytes, label) => {
  let b = ''
  for (let i = 0; i < bytes.length; i += 0x8000) b += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `-----BEGIN ${label}-----\n${btoa(b).replace(/(.{64})/g, '$1\n').replace(/\n$/, '')}\n-----END ${label}-----`
}

/** Turn what the user pasted (secret, PEM public key, certificate, JWK or JWKS) into a CryptoKey for `alg`. */
export async function importVerifyKey(text, alg, { base64Secret = false, kid } = {}) {
  const subtle = crypto.subtle
  const t = text.trim()
  if (!t) throw new Error(alg.startsWith('HS') ? 'Enter the secret to verify the signature.' : 'Paste the public key (PEM, certificate or JWK) to verify the signature.')
  const p = algParams(alg)
  if (alg.startsWith('HS')) {
    let raw
    if (t.startsWith('{')) {
      try { const jwk = JSON.parse(t); if (jwk.kty === 'oct' && jwk.k) raw = b64uDecode(jwk.k) } catch { /* treat as plain text */ }
    }
    raw ||= base64Secret ? b64uDecode(t.replace(/\s+/g, '')) : utf8.encode(text)
    if (!raw.length) throw new Error('The secret is empty.')
    return subtle.importKey('raw', raw, p.import, false, ['verify'])
  }
  try {
    if (t.startsWith('{')) {
      let jwk = JSON.parse(t)
      if (Array.isArray(jwk.keys)) jwk = jwk.keys.find((k) => kid && k.kid === kid) || jwk.keys[0]
      const { d, p: _p, q, dp, dq, qi, key_ops, ext, use, alg: _a, ...pub } = jwk // public part only
      return await subtle.importKey('jwk', pub, p.import, false, ['verify'])
    }
    const blocks = pemBlocks(t)
    if (!blocks.length) throw new Error('No PEM block found.')
    const b = blocks[0]
    let spki
    if (b.label === 'PUBLIC KEY') spki = b.der
    else if (b.label === 'CERTIFICATE') spki = certToSpki(b.der)
    else if (b.label === 'RSA PUBLIC KEY') spki = pkcs1ToSpki(b.der)
    else throw new Error(`"${b.label}" is not a public key. Paste a PUBLIC KEY, CERTIFICATE or a JWK.`)
    return await subtle.importKey('spki', spki, p.import, false, ['verify'])
  } catch (e) {
    if (e.message?.startsWith('"') || e.message?.startsWith('No PEM')) throw e
    throw new Error(`Could not use that key for ${alg}: ${e.name === 'SyntaxError' ? 'the JWK is not valid JSON' : 'the key type does not match the algorithm, or the key is malformed'}.`)
  }
}

export async function verifyJwt(parsed, key, alg) {
  const p = algParams(alg)
  const data = utf8.encode(`${parsed.parts[0]}.${parsed.parts[1]}`)
  let sig
  try { sig = b64uDecode(parsed.signature) } catch { return false }
  return crypto.subtle.verify(alg.startsWith('ES') ? { name: 'ECDSA', hash: HASH[alg.slice(2)] } : p.sign, key, sig, data)
}

/** Sign header + payload objects with an already imported CryptoKey. Returns the compact token. */
export async function signJwt(header, payload, key, alg) {
  const p = algParams(alg)
  const head = b64uEncode(utf8.encode(JSON.stringify(header)))
  const body = b64uEncode(utf8.encode(JSON.stringify(payload)))
  const signParams = alg.startsWith('ES') ? { name: 'ECDSA', hash: HASH[alg.slice(2)] } : p.sign
  const sig = new Uint8Array(await crypto.subtle.sign(signParams, key, utf8.encode(`${head}.${body}`)))
  return `${head}.${body}.${b64uEncode(sig)}`
}

export async function importSignKey(text, alg, { base64Secret = false } = {}) {
  const p = algParams(alg)
  if (alg.startsWith('HS')) {
    const t = text.trim()
    if (!t) throw new Error('Enter a secret to sign with.')
    const raw = base64Secret ? b64uDecode(t.replace(/\s+/g, '')) : utf8.encode(text)
    return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: p.import.hash }, false, ['sign'])
  }
  const b = pemBlocks(text)[0]
  if (!b || b.label !== 'PRIVATE KEY') throw new Error('Paste a private key in PKCS#8 format ("BEGIN PRIVATE KEY"), or generate a key pair.')
  try { return await crypto.subtle.importKey('pkcs8', b.der, p.import, false, ['sign']) } catch { throw new Error(`That private key does not match ${alg}.`) }
}

export async function generateKeyPair(alg) {
  const p = algParams(alg)
  const params = alg.startsWith('RS') || alg.startsWith('PS') ? { ...p.import, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) } : p.import
  const pair = await crypto.subtle.generateKey(params, true, ['sign', 'verify'])
  return {
    publicPem: toPem(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)), 'PUBLIC KEY'),
    privatePem: toPem(new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey)), 'PRIVATE KEY'),
  }
}

const UNITS = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]]
/** "in 2 hours" / "3 days ago" for a unix time in seconds. */
export function relative(sec, now = Date.now() / 1000) {
  const d = sec - now
  const a = Math.abs(d)
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  for (const [u, s] of UNITS) if (a >= s || u === 'second') return rtf.format(Math.round(d / s), u)
}

const CLAIMS = {
  iss: 'Issuer', sub: 'Subject', aud: 'Audience', exp: 'Expiration time', nbf: 'Not valid before', iat: 'Issued at', jti: 'JWT ID',
  azp: 'Authorized party', scope: 'Scopes', scp: 'Scopes', nonce: 'Nonce', auth_time: 'Authentication time', email: 'Email', email_verified: 'Email verified',
  name: 'Name', given_name: 'Given name', family_name: 'Family name', preferred_username: 'Username', roles: 'Roles', sid: 'Session ID', typ: 'Type', at_hash: 'Access token hash',
}
const TIME_CLAIMS = new Set(['exp', 'nbf', 'iat', 'auth_time'])
const fmtLocal = (sec) => new Date(sec * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'long' })

export function tokenStatus(payload, now = Date.now() / 1000) {
  if (!payload || typeof payload !== 'object') return null
  if (typeof payload.exp === 'number' && payload.exp < now) return { kind: 'bad', icon: 'clock-alert', text: `Expired ${relative(payload.exp, now)}` }
  if (typeof payload.nbf === 'number' && payload.nbf > now) return { kind: 'warn', icon: 'clock', text: `Not valid yet, starts ${relative(payload.nbf, now)}` }
  if (typeof payload.exp === 'number') return { kind: 'ok', icon: 'clock-check', text: `Expires ${relative(payload.exp, now)}`, soon: payload.exp - now < 300 }
  return { kind: 'info', icon: 'infinity', text: 'No expiry (exp) claim' }
}

const SAMPLE_HS = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
export const SAMPLE_SECRET = 'your-256-bit-secret'

const STYLE = `
.t-jwt .tok { font-family: var(--mono); font-size: 13px; line-height: 1.65; overflow-wrap: anywhere; word-break: break-all; padding: 14px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--border); }
.t-jwt .tok .p0 { color: #e11d48; } .t-jwt .tok .p1 { color: #9333ea; } .t-jwt .tok .p2 { color: #0891b2; } .t-jwt .tok .dot { color: var(--muted); }
:root[data-theme="dark"] .t-jwt .tok .p0 { color: #fb7185; } :root[data-theme="dark"] .t-jwt .tok .p1 { color: #c084fc; } :root[data-theme="dark"] .t-jwt .tok .p2 { color: #22d3ee; }
.t-jwt .tok span.p { animation: dv-fade .4s both; }
.t-jwt .legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--muted); }
.t-jwt .legend i { display: inline-block; width: 9px; height: 9px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
.t-jwt .claim-time { display: grid; gap: 2px; }
.t-jwt .claim-time small { color: var(--muted); font-size: 12px; }
.t-jwt .vstate { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 14px; font-weight: 600; font-size: 14px; border: 1px solid var(--border); background: var(--surface-2); transition: background .3s, border-color .3s; }
.t-jwt .vstate .icon { width: 22px; height: 22px; }
.t-jwt .vstate.ok { color: var(--success); background: var(--success-soft); border-color: color-mix(in srgb, var(--success) 35%, transparent); animation: dv-pop .45s var(--spring); }
.t-jwt .vstate.bad { color: var(--danger); background: var(--danger-soft); border-color: color-mix(in srgb, var(--danger) 35%, transparent); }
.t-jwt .vstate.idle { color: var(--muted); font-weight: 500; }
.t-jwt .vstate small { display: block; font-weight: 400; color: var(--text-2); }
.t-jwt textarea.k { min-height: 96px; font-family: var(--mono); font-size: 12.5px; }
`

function coloredToken(token) {
  const parts = token.split('.')
  const el = h('div', { class: 'tok', 'aria-label': 'Token, coloured by part' })
  parts.forEach((p, i) => { if (i) el.append(h('span', { class: 'dot' }, '.')); el.append(h('span', { class: `p p${Math.min(i, 2)}` }, p)) })
  return el
}

const legend = () => h('div', { class: 'legend' },
  h('span', h('i', { style: 'background:#e11d48' }), 'Header'), h('span', h('i', { style: 'background:#9333ea' }), 'Payload'), h('span', h('i', { style: 'background:#0891b2' }), 'Signature'))

// ---------- Decoder ----------
function mountDecoder(root) {
  const tokenIn = textarea({ rows: 6, mono: true, spellcheck: false, placeholder: 'Paste a JWT here (eyJhbGciOi...)', 'aria-label': 'JWT' })
  const result = h('div', { class: 'stack' })
  let timer = null
  let verifyToken = 0
  onCleanup(() => clearInterval(timer))

  const run = () => {
    clearInterval(timer)
    clear(result)
    const text = tokenIn.value
    if (!text.trim()) { result.append(h('div', { class: 'empty' }, icon('key-round'), h('div', 'Paste a token to see its header, payload and expiry. Nothing leaves your browser.'))); return }
    let parsed
    try { parsed = parseJwt(text) } catch (e) { result.append(alert('error', e.message)); return }
    const { header, payload } = parsed
    const alg = String(header.alg || '')
    const statusSlot = h('div')
    const paintStatus = () => {
      const st = tokenStatus(payload)
      clear(statusSlot, st && pill(st.kind, st.icon, st.text))
    }
    paintStatus()
    if (payload && typeof payload.exp === 'number') timer = setInterval(paintStatus, 1000)

    const headBox = outBox('Header', { copy: true })
    headBox.set(JSON.stringify(header, null, 2), { quiet: true })
    const headView = jsonView(JSON.stringify(header, null, 2))
    headBox.body.replaceWith(headView)
    headBox.get = () => JSON.stringify(header, null, 2)
    const payText = payload ? JSON.stringify(payload, null, 2) : parsed.rawPayload
    const payBox = outBox('Payload', { copy: true })
    payBox.set(payText || '(unreadable)', { quiet: true })
    payBox.body.replaceWith(payload ? jsonView(payText) : h('pre', { class: 'dv-out-body' }, payText || '(unreadable)'))
    payBox.get = () => payText

    const claimRows = payload && typeof payload === 'object' && !Array.isArray(payload) ? Object.entries(payload).map(([k, v]) => {
      const meaning = CLAIMS[k] || ''
      let val
      if (TIME_CLAIMS.has(k) && typeof v === 'number') {
        val = h('div', { class: 'claim-time' }, h('span', fmtLocal(v)), h('small', `${new Date(v * 1000).toISOString()} · ${relative(v)}`))
      } else val = h('code', typeof v === 'string' ? v : JSON.stringify(v))
      return [h('code', k), meaning, val]
    }) : []

    const keyState = verifyPanel(parsed, alg)
    result.append(
      h('div', { class: 'panel stack' },
        h('div', { class: 'row between' }, h('div', { class: 'row' }, pill('info', 'shield', alg || 'no alg'), header.typ && pill('', 'tag', String(header.typ)), header.kid && pill('', 'key', `kid ${header.kid}`)), statusSlot),
        coloredToken(parsed.token), legend()),
      split(headBox.el, payBox.el),
      claimRows.length ? h('div', { class: 'panel stack' }, eyebrow('list-checks', 'Claims'), table({ columns: ['Claim', 'Meaning', 'Value'], rows: claimRows })) : null,
      keyState)
  }

  function verifyPanel(parsed, alg) {
    const isHS = alg.startsWith('HS')
    const state = h('div', { class: 'vstate idle' }, icon('shield-question'), h('div', 'Enter ' + (isHS ? 'the secret' : 'the public key') + ' to check the signature.'))
    const setState = (kind, ic, title, sub) => { state.className = `vstate ${kind}`; clear(state, icon(ic), h('div', title, sub ? h('small', sub) : null)) }
    if (!ALGS.includes(alg)) {
      const none = alg.toLowerCase() === 'none'
      return h('div', { class: 'panel stack' }, eyebrow('shield-check', 'Signature'),
        alert(none ? 'warn' : 'info', none ? 'This token uses alg "none": it is not signed at all, so anyone could have written it. Never accept such tokens on a server.' : `The algorithm "${alg || 'missing'}" cannot be verified in the browser.`))
    }
    const b64 = toggle('Secret is Base64URL encoded', false, () => check())
    const keyIn = isHS ? inputEl({ type: 'text', mono: true, placeholder: 'your-256-bit-secret', 'aria-label': 'Secret', autocomplete: 'off', spellcheck: false }) : textarea({ rows: 5, mono: true, class: 'k', spellcheck: false, placeholder: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n(or a certificate, or a JWK / JWKS)', 'aria-label': 'Public key' })
    const check = debounce(async () => {
      const id = ++verifyToken
      if (!keyIn.value.trim()) { setState('idle', 'shield-question', 'Enter ' + (isHS ? 'the secret' : 'the public key') + ' to check the signature.'); return }
      try {
        const key = await importVerifyKey(keyIn.value, alg, { base64Secret: b64.input.checked, kid: parsed.header.kid })
        const ok = await verifyJwt(parsed, key, alg)
        if (id !== verifyToken) return
        ok ? setState('ok', 'shield-check', 'Signature verified', `The token was signed with this ${isHS ? 'secret' : 'key'} and has not been changed.`)
          : setState('bad', 'shield-x', 'Invalid signature', isHS ? 'Wrong secret, or the token was modified.' : 'Wrong key, or the token was modified.')
      } catch (e) {
        if (id === verifyToken) setState('bad', 'shield-alert', 'Cannot verify', e.message)
      }
    }, 150)
    keyIn.addEventListener('input', check)
    const demo = isHS && parsed.token === SAMPLE_HS ? button('Use the sample secret', { size: 'sm', variant: 'ghost', icon: 'wand-sparkles', onClick: () => { keyIn.value = SAMPLE_SECRET; check() } }) : null
    return h('div', { class: 'panel stack' }, eyebrow('shield-check', 'Verify signature'),
      isHS ? h('p', { class: 'small muted' }, 'HMAC tokens are verified with the shared secret. The secret never leaves this page.') : h('p', { class: 'small muted' }, `${alg} tokens are verified with the issuer's public key. Paste a PEM public key, an X.509 certificate or a JWK.`),
      keyIn, h('div', { class: 'row' }, isHS ? b64 : null, demo), state)
  }

  const sample = button('Try a sample', { icon: 'sparkles', size: 'sm', variant: 'ghost', onClick: async () => {
    const now = Math.floor(Date.now() / 1000)
    const key = await importSignKey(SAMPLE_SECRET, 'HS256')
    tokenIn.value = await signJwt({ alg: 'HS256', typ: 'JWT' }, { sub: '1234567890', name: 'Asha Verma', role: 'admin', iat: now - 600, nbf: now - 600, exp: now + 3000 }, key, 'HS256')
    run()
  } })
  tokenIn.addEventListener('input', run)
  const fromUrl = new URLSearchParams(location.hash.split('?')[1] || '').get('token')
  if (fromUrl) tokenIn.value = fromUrl
  root.append(h('div', { class: 'dv t-jwt stack' },
    h('div', { class: 'stack tight' }, eyebrow('key-round', 'Encoded token'), tokenIn,
      h('div', { class: 'row' }, sample, button('Clear', { icon: 'eraser', size: 'sm', variant: 'ghost', onClick: () => { tokenIn.value = ''; run(); tokenIn.focus() } }),
        h('span', { class: 'small muted' }, 'Decoding happens in your browser; the token is never sent anywhere.'))),
    result))
  run()
  tokenIn.focus({ preventScroll: true })
}

// ---------- Generator ----------
const GEN_ALGS = ['HS256', 'HS384', 'HS512', 'RS256', 'PS256', 'ES256', 'ES384', 'EdDSA']

function mountGenerator(root) {
  let alg = 'HS256'
  let run = 0
  const now = () => Math.floor(Date.now() / 1000)
  const headerIn = textarea({ rows: 4, mono: true, spellcheck: false, value: JSON.stringify({ alg: 'HS256', typ: 'JWT' }, null, 2), 'aria-label': 'Header JSON' })
  const payloadIn = textarea({ rows: 10, mono: true, spellcheck: false, value: JSON.stringify({ sub: '1234567890', name: 'Asha Verma', admin: true, iat: now(), exp: now() + 3600 }, null, 2), 'aria-label': 'Payload JSON' })
  const secretIn = inputEl({ type: 'text', mono: true, value: 'your-256-bit-secret', 'aria-label': 'Secret', autocomplete: 'off', spellcheck: false })
  const b64 = toggle('Secret is Base64URL encoded', false, () => gen())
  const privIn = textarea({ rows: 5, mono: true, class: 'k', spellcheck: false, placeholder: '-----BEGIN PRIVATE KEY-----', 'aria-label': 'Private key (PKCS#8)' })
  const pubOut = outBox('Public key (use it to verify)', { copy: true })
  const keyHs = h('div', { class: 'stack tight' }, h('div', { class: 'row' }, h('div', { class: 'dv-grow' }, secretIn),
    button('Random', { icon: 'dices', size: 'sm', onClick: () => { secretIn.value = b64uEncode(crypto.getRandomValues(new Uint8Array(32))); b64.input.checked = true; gen() } })), b64)
  const keyAsym = h('div', { class: 'stack tight' }, privIn, h('div', { class: 'row' }, button('Generate key pair', { icon: 'key-round', size: 'sm', onClick: () => newPair() }),
    h('span', { class: 'small muted' }, 'Created in your browser, for testing only.')), pubOut.el)
  const algSel = select(GEN_ALGS.map((a) => [a, a]), alg, (v) => { alg = v; setAlg() })
  const err = h('div')
  const tokenBox = h('div')
  const tokenText = { v: '' }
  const actions = h('div', { class: 'row' })

  function setAlg() {
    try { const hd = JSON.parse(headerIn.value); hd.alg = alg; headerIn.value = JSON.stringify(hd, null, 2) } catch { headerIn.value = JSON.stringify({ alg, typ: 'JWT' }, null, 2) }
    const hs = alg.startsWith('HS')
    keyHs.hidden = !hs
    keyAsym.hidden = hs
    privIn.value = ''
    pubOut.set('')
    if (!hs) newPair()
    else gen()
  }
  async function newPair() {
    try {
      const kp = await generateKeyPair(alg)
      privIn.value = kp.privatePem
      pubOut.set(kp.publicPem)
      gen()
    } catch (e) { clear(err, alert('error', e.message)) }
  }

  const gen = debounce(async () => {
    const id = ++run
    let header, payload
    try { header = JSON.parse(headerIn.value) } catch (e) { return fail('The header is not valid JSON: ' + e.message) }
    try { payload = JSON.parse(payloadIn.value) } catch (e) { return fail('The payload is not valid JSON: ' + e.message) }
    if (typeof header !== 'object' || header === null || Array.isArray(header)) return fail('The header must be a JSON object.')
    if (header.alg !== alg) { header.alg = alg; headerIn.value = JSON.stringify(header, null, 2) }
    try {
      const key = await importSignKey(alg.startsWith('HS') ? secretIn.value : privIn.value, alg, { base64Secret: b64.input.checked })
      const token = await signJwt(header, payload, key, alg)
      if (id !== run) return
      clear(err)
      tokenText.v = token
      clear(tokenBox, h('div', { class: 'dv-hero stack dv-pop' }, h('div', { class: 'row between' }, eyebrow('badge-check', 'Signed token'), pill('ok', 'check', alg)), coloredToken(token), legend(),
        h('div', { class: 'row' }, button('Copy token', { icon: 'copy', variant: 'primary', onClick: () => copyText(token) }),
          h('a', { class: 'btn btn-secondary', href: `#/jwt-decoder?token=${encodeURIComponent(token)}` }, icon('scan-search'), h('span', 'Open in decoder')))))
    } catch (e) { fail(e.message) }
    function fail(msg) { if (id === run) { clear(err, alert('error', msg)); clear(tokenBox) } }
  }, 120)

  const upd = (fn) => () => {
    try {
      const o = JSON.parse(payloadIn.value)
      fn(o)
      payloadIn.value = JSON.stringify(o, null, 2)
    } catch { clear(err, alert('error', 'Fix the payload JSON first, then use the quick-add buttons.')); return }
    gen()
  }
  const quick = h('div', { class: 'dv-chips' }, [
    ['iat = now', (o) => { o.iat = now() }],
    ['exp +15 min', (o) => { o.exp = now() + 900 }], ['exp +1 hour', (o) => { o.exp = now() + 3600 }], ['exp +24 hours', (o) => { o.exp = now() + 86400 }], ['exp +30 days', (o) => { o.exp = now() + 2592000 }],
    ['expired', (o) => { o.exp = now() - 3600 }], ['nbf = now', (o) => { o.nbf = now() }],
    ['jti', (o) => { o.jti = crypto.randomUUID() }], ['iss', (o) => { o.iss = o.iss || 'https://auth.example.com' }], ['aud', (o) => { o.aud = o.aud || 'my-api' }],
  ].map(([l, fn]) => h('button', { type: 'button', class: 'dv-chip mono', onclick: upd(fn) }, l)))

  for (const el of [headerIn, payloadIn, secretIn, privIn]) el.addEventListener('input', gen)
  keyAsym.hidden = true
  root.append(h('div', { class: 'dv t-jwt stack' },
    h('div', { class: 'panel stack' }, eyebrow('shield', 'Algorithm'), h('div', { class: 'row' }, algSel, h('span', { class: 'small muted' }, 'HS* use a shared secret. RS, PS, ES and EdDSA sign with a private key.'))),
    split(
      h('div', { class: 'stack' }, h('div', { class: 'stack tight' }, eyebrow('braces', 'Header'), headerIn), h('div', { class: 'stack tight' }, eyebrow('braces', 'Payload'), payloadIn, quick)),
      h('div', { class: 'stack' }, h('div', { class: 'stack tight' }, eyebrow('key-round', alg.startsWith('HS') ? 'Secret' : 'Key'), keyHs, keyAsym), err, tokenBox)),
    h('p', { class: 'small muted' }, 'Tokens are signed in your browser with WebCrypto. For testing only: never paste real production secrets into any website.')))
  gen()
}

export function mount(root, { params = {} } = {}) {
  useKit()
  css('t-jwt-css', STYLE)
  return params.mode === 'generate' ? mountGenerator(root) : mountDecoder(root)
}
