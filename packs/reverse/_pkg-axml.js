// Android binary XML (AXML) and resources.arsc reader plus an AndroidManifest summary. DOM-free so Node tests can import it.

const RES_STRING_POOL = 0x0001, RES_TABLE = 0x0002, RES_XML = 0x0003
const XML_START_NS = 0x0100, XML_END_NS = 0x0101, XML_START_EL = 0x0102, XML_END_EL = 0x0103, XML_CDATA = 0x0104, XML_RESOURCE_MAP = 0x0180
const TABLE_PACKAGE = 0x0200, TABLE_TYPE = 0x0201, TABLE_TYPE_SPEC = 0x0202
export const ANDROID_NS = 'http://schemas.android.com/apk/res/android'

const fail = (msg) => { throw Object.assign(new Error(msg), { userMessage: msg }) }

// Android framework attribute ids, used when an obfuscated manifest strips the attribute names from the string pool.
export const ANDROID_ATTRS = {
  0x01010000: 'theme', 0x01010001: 'label', 0x01010002: 'icon', 0x01010003: 'name', 0x01010006: 'permission', 0x01010007: 'readPermission',
  0x01010008: 'writePermission', 0x01010009: 'protectionLevel', 0x0101000b: 'sharedUserId', 0x0101000c: 'hasCode', 0x0101000e: 'enabled',
  0x0101000f: 'debuggable', 0x01010010: 'exported', 0x01010011: 'process', 0x01010018: 'authorities', 0x0101001b: 'grantUriPermissions',
  0x0101001c: 'priority', 0x0101001d: 'launchMode', 0x0101001e: 'screenOrientation', 0x01010024: 'value', 0x01010025: 'resource',
  0x01010026: 'mimeType', 0x01010027: 'scheme', 0x01010028: 'host', 0x01010029: 'port', 0x0101002a: 'path', 0x0101002b: 'pathPrefix',
  0x0101002c: 'pathPattern', 0x01010202: 'targetActivity', 0x0101020c: 'minSdkVersion', 0x0101021b: 'versionCode', 0x0101021c: 'versionName',
  0x01010270: 'targetSdkVersion', 0x01010271: 'maxSdkVersion', 0x01010272: 'testOnly', 0x01010280: 'allowBackup', 0x01010281: 'glEsVersion',
  0x0101028e: 'required', 0x010102b7: 'installLocation', 0x010104ea: 'extractNativeLibs', 0x010104ec: 'usesCleartextTraffic',
  0x010104ee: 'autoVerify', 0x01010527: 'networkSecurityConfig', 0x01010572: 'compileSdkVersion', 0x01010573: 'compileSdkVersionCodename',
}

/** Read a ResStringPool chunk at `o`. Handles UTF-8 and UTF-16 pools. */
export function readStringPool(b, dv, o) {
  const size = dv.getUint32(o + 4, true)
  const count = dv.getUint32(o + 8, true)
  const flags = dv.getUint32(o + 16, true)
  const stringsStart = dv.getUint32(o + 20, true)
  const utf8 = (flags & 0x100) !== 0
  const hdr = dv.getUint16(o + 2, true)
  const out = new Array(count)
  const dec = new TextDecoder('utf-8', { fatal: false })
  const end = o + size
  for (let i = 0; i < count; i++) {
    let p = o + stringsStart + dv.getUint32(o + hdr + i * 4, true)
    if (p >= end) { out[i] = ''; continue }
    if (utf8) {
      let n = b[p++]; if (n & 0x80) p++ // char length, skipped
      n = b[p++]; if (n & 0x80) n = ((n & 0x7f) << 8) | b[p++]
      out[i] = dec.decode(b.subarray(p, Math.min(p + n, end)))
    } else {
      let n = dv.getUint16(p, true); p += 2
      if (n & 0x8000) { n = ((n & 0x7fff) << 16) | dv.getUint16(p, true); p += 2 }
      let s = ''
      for (let k = 0; k < n && p + k * 2 + 1 < end; k++) s += String.fromCharCode(dv.getUint16(p + k * 2, true))
      out[i] = s
    }
  }
  return { strings: out, utf8 }
}

const hex8 = (n) => '0x' + (n >>> 0).toString(16).padStart(8, '0')
const UNITS = ['px', 'dp', 'sp', 'pt', 'in', 'mm']
const RADIX = [1 / (1 << 8), 1 / (1 << 15), 1 / (1 << 23), 1 / 2 ** 31]
const complexToFloat = (c) => ((c & 0xffffff00) >> 8) * RADIX[(c >> 4) & 3]

/** Format a Res_value as text the way aapt shows it. */
export function formatValue(type, data, strings) {
  switch (type) {
    case 0x00: return data === 1 ? '@empty' : ''
    case 0x01: return data === 0 ? '@null' : '@' + hex8(data)
    case 0x02: return '?' + hex8(data)
    case 0x03: return strings[data] ?? ''
    case 0x04: { const f = new DataView(new ArrayBuffer(4)); f.setUint32(0, data); return String(+f.getFloat32(0).toPrecision(7)) }
    case 0x05: return +complexToFloat(data).toPrecision(7) + (UNITS[data & 0xf] || '')
    case 0x06: return +(complexToFloat(data) * 100).toPrecision(7) + ((data & 0xf) === 1 ? '%p' : '%')
    case 0x07: return '@' + hex8(data)
    case 0x10: return String(data | 0)
    case 0x11: return hex8(data)
    case 0x12: return data !== 0 ? 'true' : 'false'
    case 0x1c: case 0x1d: case 0x1e: case 0x1f: return '#' + (data >>> 0).toString(16).padStart(8, '0')
    default: return `(type 0x${type.toString(16)})${hex8(data)}`
  }
}

/**
 * Decode Android binary XML into a tree: {name, ns, attrs: [{name, ns, prefix, value, type, data, raw}], kids: [...]}.
 * Returns {root, namespaces, utf8, stringCount}.
 */
export function decodeAxml(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (b.length < 8) fail('The manifest is empty or truncated.')
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const type = dv.getUint16(0, true)
  if (type !== RES_XML) {
    if (b[0] === 0x3c) fail('This manifest is plain text XML, not binary.')
    if (b[0] === 0x0a) fail('This manifest is in protobuf format (Android App Bundle), which is not decoded here.')
    fail('This is not an Android binary XML file.')
  }
  let o = dv.getUint16(2, true)
  const total = Math.min(dv.getUint32(4, true), b.length)
  let strings = [], resIds = [], utf8 = false
  const nsUri = new Map() // uri -> prefix
  const namespaces = []
  const stack = [{ name: '#doc', attrs: [], kids: [] }]
  while (o + 8 <= total) {
    const ct = dv.getUint16(o, true), hs = dv.getUint16(o + 2, true), cs = dv.getUint32(o + 4, true)
    if (cs < 8 || o + cs > total) break
    const s = (i) => (i === 0xffffffff ? null : strings[i] ?? null)
    if (ct === RES_STRING_POOL) ({ strings, utf8 } = readStringPool(b, dv, o))
    else if (ct === XML_RESOURCE_MAP) { resIds = []; for (let p = o + hs; p + 4 <= o + cs; p += 4) resIds.push(dv.getUint32(p, true)) }
    else if (ct === XML_START_NS) {
      const prefix = s(dv.getUint32(o + 16, true)), uri = s(dv.getUint32(o + 20, true))
      if (uri && !nsUri.has(uri)) { nsUri.set(uri, prefix); namespaces.push({ prefix, uri }) }
    } else if (ct === XML_START_EL) {
      const e = o + hs
      const ns = s(dv.getUint32(e, true)), name = s(dv.getUint32(e + 4, true)) || '?'
      const aStart = dv.getUint16(e + 8, true), aSize = dv.getUint16(e + 10, true) || 20, aCount = dv.getUint16(e + 12, true)
      const attrs = []
      for (let i = 0; i < aCount; i++) {
        const a = e + aStart + i * aSize
        if (a + 20 > o + cs) break
        const ans = s(dv.getUint32(a, true)), nameIdx = dv.getUint32(a + 4, true)
        const rawIdx = dv.getUint32(a + 8, true)
        const vType = b[a + 15], vData = dv.getUint32(a + 16, true)
        const resId = resIds[nameIdx]
        let aname = s(nameIdx)
        if (!aname && resId) aname = ANDROID_ATTRS[resId] || hex8(resId)
        const raw = s(rawIdx)
        attrs.push({ name: aname || '?', ns: ans, prefix: ans ? (nsUri.get(ans) ?? 'ns') : null, resId: resId || null, type: vType, data: vData, raw,
          value: vType === 0x03 ? (raw ?? s(vData) ?? '') : formatValue(vType, vData, strings) })
      }
      const el = { name, ns, attrs, kids: [] }
      stack.at(-1).kids.push(el)
      stack.push(el)
    } else if (ct === XML_END_EL) {
      if (stack.length > 1) stack.pop()
    } else if (ct === XML_CDATA) {
      const t = s(dv.getUint32(o + hs, true))
      if (t != null) stack.at(-1).kids.push(t)
    }
    o += cs
  }
  const root = stack[0].kids.find((k) => typeof k === 'object')
  if (!root) fail('The binary XML has no elements.')
  return { root, namespaces, utf8, stringCount: strings.length }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Pretty-print a decoded tree as XML text. `resolve(id)` can replace @0x7f... references with names or values. */
export function axmlToXml({ root, namespaces }, resolve) {
  const lines = ['<?xml version="1.0" encoding="utf-8"?>']
  const walk = (el, ind, first) => {
    const pad = '  '.repeat(ind)
    const attrs = []
    if (first) for (const n of namespaces) attrs.push(`xmlns${n.prefix ? ':' + n.prefix : ''}="${esc(n.uri)}"`)
    for (const a of el.attrs) {
      let v = a.value
      if (resolve && (a.type === 0x01 || a.type === 0x07) && a.data) v = resolve(a.data) ?? v
      attrs.push(`${a.prefix ? a.prefix + ':' : ''}${a.name}="${esc(v)}"`)
    }
    const open = `${pad}<${el.name}${attrs.length > 2 ? '\n' + attrs.map((x) => pad + '    ' + x).join('\n') : attrs.map((x) => ' ' + x).join('')}`
    const kids = el.kids
    if (!kids.length) { lines.push(open + '/>'); return }
    if (kids.every((k) => typeof k === 'string')) { lines.push(`${open}>${esc(kids.join(''))}</${el.name}>`); return }
    lines.push(open + '>')
    for (const k of kids) typeof k === 'string' ? (k.trim() && lines.push(pad + '  ' + esc(k.trim()))) : walk(k, ind + 1, false)
    lines.push(`${pad}</${el.name}>`)
  }
  walk(root, 0, true)
  return lines.join('\n') + '\n'
}

// ---------- resources.arsc (enough to name references and resolve simple values) ----------

/**
 * Parse resources.arsc. Returns {lookup(id) -> {name, type, values: [{config, value, type, data}]}} for the entries found.
 * Complex (bag) entries are listed with value '(style/array)'.
 */
export function parseArsc(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (b.length < 12 || dv.getUint16(0, true) !== RES_TABLE) fail('resources.arsc is not a resource table.')
  const map = new Map()
  let globalStrings = []
  let o = dv.getUint16(2, true)
  const total = Math.min(dv.getUint32(4, true), b.length)
  while (o + 8 <= total) {
    const ct = dv.getUint16(o, true), cs = dv.getUint32(o + 4, true)
    if (cs < 8 || o + cs > total) break
    if (ct === RES_STRING_POOL) globalStrings = readStringPool(b, dv, o).strings
    else if (ct === TABLE_PACKAGE) readPackage(o, cs)
    o += cs
  }
  return { lookup: (id) => map.get(id >>> 0) || null, size: map.size }

  function readPackage(po, psize) {
    const hs = dv.getUint16(po + 2, true)
    const pkgId = dv.getUint32(po + 8, true)
    let pkgName = ''
    for (let i = 0; i < 128; i++) { const c = dv.getUint16(po + 12 + i * 2, true); if (!c) break; pkgName += String.fromCharCode(c) }
    const typeStringsOff = dv.getUint32(po + 268, true), keyStringsOff = dv.getUint32(po + 276, true)
    const typeNames = typeStringsOff ? readStringPool(b, dv, po + typeStringsOff).strings : []
    const keyNames = keyStringsOff ? readStringPool(b, dv, po + keyStringsOff).strings : []
    let o = po + hs
    const end = po + psize
    while (o + 8 <= end) {
      const ct = dv.getUint16(o, true), chs = dv.getUint16(o + 2, true), cs = dv.getUint32(o + 4, true)
      if (cs < 8 || o + cs > end) break
      if (ct === TABLE_TYPE) {
        const typeId = b[o + 8]
        const flags = b[o + 9]
        const entryCount = dv.getUint32(o + 12, true)
        const entriesStart = dv.getUint32(o + 16, true)
        const cfgSize = dv.getUint32(o + 20, true)
        const config = describeConfig(b, dv, o + 20, cfgSize)
        const sparse = (flags & 1) !== 0
        const offset16 = (flags & 2) !== 0
        for (let i = 0; i < entryCount; i++) {
          let idx = i, eo
          if (sparse) {
            idx = dv.getUint16(o + chs + i * 4, true)
            eo = dv.getUint16(o + chs + i * 4 + 2, true) * 4
          } else if (offset16) {
            const v = dv.getUint16(o + chs + i * 2, true)
            if (v === 0xffff) continue
            eo = v * 4
          } else {
            eo = dv.getUint32(o + chs + i * 4, true)
            if (eo === 0xffffffff) continue
          }
          const e = o + entriesStart + eo
          if (e + 8 > o + cs) continue
          const esize = dv.getUint16(e, true), eflags = dv.getUint16(e + 2, true)
          const compact = (eflags & 0x8) !== 0
          const key = compact ? esize : dv.getUint32(e + 4, true)
          const id = ((pkgId << 24) | (typeId << 16) | idx) >>> 0
          const typeName = typeNames[typeId - 1] || `type${typeId}`
          let rec = map.get(id)
          if (!rec) { rec = { id, pkg: pkgName, type: typeName, name: keyNames[key] ?? `0x${idx.toString(16)}`, values: [] }; map.set(id, rec) }
          let vt, vd
          if (compact) { vt = eflags >> 8; vd = dv.getUint32(e + 4, true) } else if (eflags & 1) { rec.values.push({ config, value: '(style or array)', type: -1, data: 0 }); continue } else {
            const v = e + esize
            if (v + 8 > o + cs) continue
            vt = b[v + 3]; vd = dv.getUint32(v + 4, true)
          }
          rec.values.push({ config, type: vt, data: vd, value: formatValue(vt, vd, globalStrings) })
        }
      } else if (ct !== TABLE_TYPE_SPEC) { /* library, overlayable and other chunks are ignored */ }
      o += cs
    }
  }
}

// Short description of a ResTable_config ('default', 'en', 'en-rUS', 'night', 'sw600dp', 'v26', ...)
function describeConfig(b, dv, o, size) {
  if (size < 8) return 'default'
  const parts = []
  const lang = String.fromCharCode(b[o + 8], b[o + 9]).replace(/\0/g, ''), country = String.fromCharCode(b[o + 10], b[o + 11]).replace(/\0/g, '')
  if (lang && b[o + 8] < 0x80) parts.push(lang + (country ? '-r' + country : ''))
  if (size >= 16) {
    const density = dv.getUint16(o + 14, true)
    if (density) parts.push({ 120: 'ldpi', 160: 'mdpi', 213: 'tvdpi', 240: 'hdpi', 320: 'xhdpi', 480: 'xxhdpi', 640: 'xxxhdpi', 0xfffe: 'anydpi', 0xffff: 'nodpi' }[density] || density + 'dpi')
  }
  if (size >= 28) { const sdk = dv.getUint16(o + 24, true); if (sdk) parts.push('v' + sdk) }
  if (size >= 30) { const ui = b[o + 29]; if ((ui & 0x30) === 0x20) parts.push('night') }
  if (size >= 32) { const sw = dv.getUint16(o + 30, true); if (sw) parts.push(`sw${sw}dp`) }
  return parts.join('-') || 'default'
}

/** Resolve a reference to a readable string: string values become the text, others '@type/name'. */
export function makeResolver(arsc) {
  return (id) => {
    const r = arsc?.lookup(id)
    if (!r) return null
    const def = r.values.find((v) => v.config === 'default') || r.values[0]
    if (r.type === 'string' && def && def.type === 0x03) return def.value
    return `@${r.type}/${r.name}`
  }
}

// ---------- AndroidManifest summary ----------

// Permissions Android treats as "dangerous" (runtime permission prompts).
export const DANGEROUS_PERMISSIONS = new Set([
  'READ_CALENDAR', 'WRITE_CALENDAR', 'CAMERA', 'READ_CONTACTS', 'WRITE_CONTACTS', 'GET_ACCOUNTS', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION',
  'ACCESS_BACKGROUND_LOCATION', 'RECORD_AUDIO', 'READ_PHONE_STATE', 'READ_PHONE_NUMBERS', 'CALL_PHONE', 'ANSWER_PHONE_CALLS', 'READ_CALL_LOG',
  'WRITE_CALL_LOG', 'ADD_VOICEMAIL', 'USE_SIP', 'PROCESS_OUTGOING_CALLS', 'BODY_SENSORS', 'BODY_SENSORS_BACKGROUND', 'SEND_SMS', 'RECEIVE_SMS',
  'READ_SMS', 'RECEIVE_WAP_PUSH', 'RECEIVE_MMS', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'ACCESS_MEDIA_LOCATION', 'ACTIVITY_RECOGNITION',
  'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'READ_MEDIA_AUDIO', 'READ_MEDIA_VISUAL_USER_SELECTED', 'POST_NOTIFICATIONS', 'NEARBY_WIFI_DEVICES',
  'BLUETOOTH_SCAN', 'BLUETOOTH_CONNECT', 'BLUETOOTH_ADVERTISE', 'UWB_RANGING', 'ACCEPT_HANDOVER',
].map((p) => 'android.permission.' + p))
// Not runtime prompts, but worth a flag in a review.
export const SENSITIVE_PERMISSIONS = new Set([
  'SYSTEM_ALERT_WINDOW', 'REQUEST_INSTALL_PACKAGES', 'MANAGE_EXTERNAL_STORAGE', 'QUERY_ALL_PACKAGES', 'BIND_ACCESSIBILITY_SERVICE', 'BIND_DEVICE_ADMIN',
  'WRITE_SETTINGS', 'PACKAGE_USAGE_STATS', 'READ_PRIVILEGED_PHONE_STATE', 'SCHEDULE_EXACT_ALARM', 'USE_FULL_SCREEN_INTENT', 'BIND_NOTIFICATION_LISTENER_SERVICE',
].map((p) => 'android.permission.' + p))

const attr = (el, name) => el.attrs.find((a) => a.name === name && (a.ns === ANDROID_NS || a.ns == null))
const av = (el, name) => attr(el, name)?.value
const kidsNamed = (el, ...names) => el.kids.filter((k) => typeof k === 'object' && names.includes(k.name))
const boolAttr = (el, name) => { const a = attr(el, name); return a ? a.value === 'true' : null }

/** Pull the useful facts out of a decoded manifest tree. */
export function summarizeManifest(root, resolve) {
  if (root.name !== 'manifest') fail('The decoded XML is not an AndroidManifest (root is <' + root.name + '>).')
  const pkg = root.attrs.find((a) => a.name === 'package')?.value || ''
  const show = (el, name) => {
    const a = attr(el, name)
    if (!a) return null
    if ((a.type === 0x01 || a.type === 0x07) && resolve) return resolve(a.data) ?? a.value
    return a.value
  }
  const sdk = kidsNamed(root, 'uses-sdk')[0]
  const app = kidsNamed(root, 'application')[0]
  const minSdk = sdk ? +av(sdk, 'minSdkVersion') || av(sdk, 'minSdkVersion') : null
  const targetSdk = sdk ? +av(sdk, 'targetSdkVersion') || av(sdk, 'targetSdkVersion') : null
  const fullName = (n) => (!n ? '' : n.startsWith('.') ? pkg + n : n.includes('.') ? n : `${pkg}.${n}`)
  const permissions = kidsNamed(root, 'uses-permission', 'uses-permission-sdk-23', 'uses-permission-sdk-m').map((el) => {
    const name = av(el, 'name') || ''
    return { name, maxSdk: av(el, 'maxSdkVersion') || null, dangerous: DANGEROUS_PERMISSIONS.has(name), sensitive: SENSITIVE_PERMISSIONS.has(name) }
  })
  const declared = kidsNamed(root, 'permission').map((el) => ({ name: av(el, 'name') || '', protection: protectionName(attr(el, 'protectionLevel')) }))
  const features = kidsNamed(root, 'uses-feature').map((el) => ({ name: av(el, 'name') || (av(el, 'glEsVersion') ? 'OpenGL ES ' + glEs(attr(el, 'glEsVersion')) : ''), required: boolAttr(el, 'required') !== false }))
  const components = []
  const deepLinks = []
  if (app) {
    for (const el of kidsNamed(app, 'activity', 'activity-alias', 'service', 'receiver', 'provider')) {
      const filters = kidsNamed(el, 'intent-filter').map((f) => {
        const actions = kidsNamed(f, 'action').map((a) => av(a, 'name')).filter(Boolean)
        const categories = kidsNamed(f, 'category').map((a) => av(a, 'name')).filter(Boolean)
        const data = kidsNamed(f, 'data').map((d) => Object.fromEntries(['scheme', 'host', 'port', 'path', 'pathPrefix', 'pathPattern', 'pathSuffix', 'pathAdvancedPattern', 'mimeType']
          .map((k) => [k, av(d, k)]).filter(([, v]) => v != null)))
        return { actions, categories, data, autoVerify: boolAttr(f, 'autoVerify') === true }
      })
      const explicit = boolAttr(el, 'exported')
      // Before Android 12 (target 31) a component with an intent filter was exported by default.
      const exported = explicit != null ? explicit : el.name === 'provider' ? (+targetSdk || 0) < 17 : filters.length > 0
      const name = fullName(av(el, 'name') || av(el, 'targetActivity'))
      const comp = { kind: el.name, name, exported, exportedImplicit: explicit == null, permission: av(el, 'permission') || null, filters,
        authorities: el.name === 'provider' ? av(el, 'authorities') || null : null, enabled: boolAttr(el, 'enabled') !== false,
        launcher: filters.some((f) => f.actions.includes('android.intent.action.MAIN') && f.categories.includes('android.intent.category.LAUNCHER')) }
      components.push(comp)
      for (const f of filters) {
        if (!f.actions.includes('android.intent.action.VIEW')) continue
        // Scheme, host and path attributes in one filter combine with each other (any scheme x any host x any path).
        const schemes = [...new Set(f.data.map((d) => d.scheme).filter(Boolean))]
        const hosts = [...new Set(f.data.map((d) => d.host && (d.host + (d.port ? ':' + d.port : ''))).filter(Boolean))]
        const paths = [...new Set(f.data.flatMap((d) => [d.path, d.pathPrefix && d.pathPrefix + '*', d.pathPattern, d.pathSuffix && '*' + d.pathSuffix, d.pathAdvancedPattern]).filter(Boolean))]
        for (const s of schemes) for (const hst of hosts.length ? hosts : ['']) for (const p of paths.length ? paths : ['']) {
          deepLinks.push({ url: `${s}:${hst ? '//' + hst : ''}${p && !p.startsWith('/') && hst ? '/' + p : p}`, component: name, browsable: f.categories.includes('android.intent.category.BROWSABLE'), autoVerify: f.autoVerify })
        }
      }
    }
  }
  const meta = app ? kidsNamed(app, 'meta-data').map((m) => ({ name: av(m, 'name'), value: show(m, 'value') ?? show(m, 'resource') ?? '' })) : []
  return {
    package: pkg,
    versionCode: av(root, 'versionCode') ?? null,
    versionName: show(root, 'versionName') ?? null,
    compileSdk: av(root, 'compileSdkVersion') ?? root.attrs.find((a) => a.name === 'platformBuildVersionCode')?.value ?? null,
    minSdk, targetSdk, maxSdk: sdk ? av(sdk, 'maxSdkVersion') || null : null,
    installLocation: av(root, 'installLocation') || null,
    sharedUserId: av(root, 'sharedUserId') || null,
    app: app ? {
      label: show(app, 'label'), icon: show(app, 'icon'), name: av(app, 'name') ? fullName(av(app, 'name')) : null,
      debuggable: boolAttr(app, 'debuggable') === true, allowBackup: boolAttr(app, 'allowBackup'), cleartext: boolAttr(app, 'usesCleartextTraffic'),
      networkSecurityConfig: show(app, 'networkSecurityConfig'), testOnly: boolAttr(app, 'testOnly') === true, extractNativeLibs: boolAttr(app, 'extractNativeLibs'),
    } : null,
    permissions, declared, features, components, deepLinks, meta,
  }
}

function protectionName(a) {
  if (!a) return 'normal'
  if (a.type === 0x03) return a.value
  const v = a.data >>> 0
  const base = ['normal', 'dangerous', 'signature', 'signatureOrSystem'][v & 0xf] || `0x${(v & 0xf).toString(16)}`
  const flags = { 0x10: 'privileged', 0x20: 'development', 0x40: 'appop', 0x80: 'pre23', 0x100: 'installer', 0x200: 'verifier', 0x400: 'preinstalled', 0x800: 'setup' }
  return [base, ...Object.entries(flags).filter(([k]) => v & +k).map(([, n]) => n)].join('|')
}
const glEs = (a) => { const v = a.data >>> 0; return `${v >> 16}.${v & 0xffff}` }

/** Android API level -> marketing version, for display. */
export function androidVersion(api) {
  const n = +api
  const m = { 14: '4.0', 15: '4.0.3', 16: '4.1', 17: '4.2', 18: '4.3', 19: '4.4', 20: '4.4W', 21: '5.0', 22: '5.1', 23: '6.0', 24: '7.0', 25: '7.1', 26: '8.0', 27: '8.1', 28: '9', 29: '10', 30: '11', 31: '12', 32: '12L', 33: '13', 34: '14', 35: '15', 36: '16' }
  return m[n] ? `Android ${m[n]}` : ''
}
