// APK inspector (params.kind = 'apk') and IPA inspector (params.kind = 'ipa').
// Everything is read locally with JSZip: Android binary XML, resources.arsc, DEX headers, signing certificates (v1 PKCS#7 and the
// v2/v3 APK Signing Block), and for iOS the Info.plist, embedded.mobileprovision, Mach-O header and code signature entitlements.
import { h, dropzone, progress, alert, clear, stats, table, tabs, button, copyButton, download, formatBytes, formatNumber, yieldToMain, onCleanup, errorMessage, card, isAbort, toast } from '../../lib/ui.js'
import { jszip } from '../../lib/libs.js'
import { decodeAxml, axmlToXml, parseArsc, makeResolver, summarizeManifest, androidVersion } from './_pkg-axml.js'
import { parseCertificate, pkcs7Certificates, readApkSigningBlock, parseDexHeader, parseMachO } from './_pkg-bin.js'
import { parsePlist, toPlain, writeXmlPlist, extractEmbeddedPlist } from './_pkg-plist.js'
import { useCss, kv, pill, pills, sectionTitle, codeBlock, fileTree, plistTree, hero, rowDownload } from './_pkg-ui.js'

const MAX_BYTES = 1.5 * 1024 ** 3
const fail = (msg) => { throw Object.assign(new Error(msg), { userMessage: msg }) }

// ---------- Pure helpers (exported for tests) ----------

/** Non-directory ZIP entries as [{path, size, compressed}] using JSZip's metadata. */
export function zipEntries(zip) {
  const out = []
  zip.forEach((path, f) => { if (!f.dir) out.push({ path, size: f._data?.uncompressedSize ?? null, compressed: f._data?.compressedSize ?? null }) })
  return out
}

const bytesRange = (u8) => async (s, e) => u8.subarray(Math.max(0, s), Math.min(u8.length, e))
export const fileRange = (blob) => async (s, e) => new Uint8Array(await blob.slice(Math.max(0, s), Math.min(blob.size, e)).arrayBuffer())

/** Pick the best launcher icon file for a resource id (highest density PNG or WebP). */
export function iconPath(arsc, id) {
  const r = arsc?.lookup(id)
  if (!r) return null
  const order = ['xxxhdpi', 'xxhdpi', 'xhdpi', 'hdpi', 'mdpi', 'default', 'ldpi']
  const files = r.values.filter((v) => v.type === 0x03 && /\.(png|webp|jpe?g)$/i.test(v.value))
  files.sort((a, b) => rank(a.config) - rank(b.config))
  return files[0]?.value || null
  function rank(c) { const i = order.findIndex((d) => c.includes(d)); return i < 0 ? 99 : i }
}

/**
 * Inspect an APK (or the base APK inside an XAPK/APKS, or an AAB) already opened with JSZip.
 * readRange(start, end) reads raw bytes of the archive file (for the APK Signing Block). Returns a plain result object.
 */
export async function inspectApk(zip, { readRange, size, name = 'app.apk', onStep } = {}) {
  const entries = zipEntries(zip)
  const paths = new Set(entries.map((e) => e.path))
  const res = { kind: 'apk', name, size, entries, notes: [], manifest: null, dex: [], libs: {}, certs: [], sigBlock: null, v1Files: [], inner: null }

  // AAB: protobuf manifest under base/manifest/
  if (paths.has('base/manifest/AndroidManifest.xml') || (paths.has('BundleConfig.pb') && !paths.has('AndroidManifest.xml'))) {
    res.kind = 'aab'
    res.notes.push('This is an Android App Bundle (.aab). Its manifest is stored as protobuf, which is not decoded here. Files, DEX headers and native libraries are still listed.')
  }
  // XAPK / APKS: a ZIP of APKs
  const innerApks = entries.filter((e) => /\.apk$/i.test(e.path))
  if (!paths.has('AndroidManifest.xml') && res.kind !== 'aab') {
    if (!innerApks.length) fail('This file has no AndroidManifest.xml, so it is not an APK. If it is an IPA, use the IPA inspector.')
    res.kind = /\.apks$/i.test(name) ? 'apks' : 'xapk'
    let xmeta = null
    if (paths.has('manifest.json')) { try { xmeta = JSON.parse(await zip.file('manifest.json').async('string')) } catch { /* optional */ } }
    const base = innerApks.find((e) => /(^|\/)base(-master)?\.apk$/i.test(e.path)) ||
      (xmeta?.package_name && innerApks.find((e) => e.path === `${xmeta.package_name}.apk`)) ||
      innerApks.find((e) => !/config\.|split_/i.test(e.path)) || [...innerApks].sort((a, b) => (b.size || 0) - (a.size || 0))[0]
    onStep?.(`Opening ${base.path}`)
    const bytes = await zip.file(base.path).async('uint8array')
    const JSZip = await jszip()
    const innerZip = await JSZip.loadAsync(bytes)
    const inner = await inspectApk(innerZip, { readRange: bytesRange(bytes), size: bytes.length, name: base.path, onStep })
    return { ...inner, kind: res.kind, name, size, outerEntries: entries, outerZip: zip, innerZip, splits: innerApks.map((e) => ({ path: e.path, size: e.size, base: e === base })), xmeta,
      notes: [`This ${res.kind.toUpperCase()} holds ${innerApks.length} APK file${innerApks.length === 1 ? '' : 's'}. Showing the base APK, ${base.path}.`, ...inner.notes] }
  }

  // Manifest and resources
  if (res.kind === 'apk') {
    onStep?.('Decoding AndroidManifest.xml')
    const mbytes = await zip.file('AndroidManifest.xml').async('uint8array')
    let arsc = null
    if (paths.has('resources.arsc')) {
      try { arsc = parseArsc(await zip.file('resources.arsc').async('uint8array')) } catch (e) { res.notes.push('resources.arsc could not be read, so @0x7f... references stay as numbers: ' + errorMessage(e)) }
    }
    try {
      const doc = decodeAxml(mbytes)
      const resolve = makeResolver(arsc)
      const summary = summarizeManifest(doc.root, resolve)
      const iconRef = doc.root.kids.find((k) => k.name === 'application')?.attrs.find((a) => a.name === 'icon' && (a.type === 1 || a.type === 7))
      res.manifest = { xml: axmlToXml(doc), xmlResolved: arsc ? axmlToXml(doc, resolve) : null, summary, utf8: doc.utf8, iconPath: iconRef ? iconPath(arsc, iconRef.data) : null }
    } catch (e) {
      if (mbytes[0] === 0x3c) {
        res.manifest = { xml: new TextDecoder().decode(mbytes), summary: null, plain: true }
        res.notes.push('The manifest is plain XML (not compiled), so it is shown as is.')
      } else res.manifest = { error: errorMessage(e) }
    }
  } else res.manifest = { error: 'Protobuf manifest (App Bundle) is not decoded.' }

  // DEX files
  const dexEntries = entries.filter((e) => /(^|\/)classes\d*\.dex$/.test(e.path)).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
  for (const e of dexEntries) {
    onStep?.(`Reading ${e.path}`)
    let header = null, error = null
    try {
      // Only the 112-byte header is needed, but JSZip inflates the whole entry. That is fine for typical DEX sizes.
      header = parseDexHeader(await zip.file(e.path).async('uint8array'))
    } catch (err) { error = errorMessage(err) }
    res.dex.push({ path: e.path, size: e.size, header, error })
    await yieldToMain()
  }

  // Native libraries by ABI
  for (const e of entries) {
    const m = e.path.match(/^(?:base\/)?lib\/([^/]+)\/(.+\.so)$/)
    if (m) (res.libs[m[1]] ||= []).push({ name: m[2], size: e.size, path: e.path })
  }

  // v1 signature files
  const certMap = new Map()
  const addCert = async (der, source) => {
    const c = await parseCertificate(der)
    if (certMap.has(c.sha256)) certMap.get(c.sha256).sources.push(source)
    else certMap.set(c.sha256, { ...c, sources: [source] })
  }
  for (const e of entries.filter((x) => /^META-INF\/[^/]+\.(RSA|DSA|EC)$/i.test(x.path))) {
    onStep?.(`Reading ${e.path}`)
    res.v1Files.push(e.path)
    try {
      const der = await zip.file(e.path).async('uint8array')
      for (const c of pkcs7Certificates(der)) await addCert(c, `v1 (${e.path})`)
    } catch (err) { res.notes.push(`${e.path} could not be parsed: ${errorMessage(err)}`) }
  }
  // v2/v3 signing block
  if (readRange && size && res.kind === 'apk') {
    onStep?.('Looking for the APK Signing Block')
    try {
      res.sigBlock = await readApkSigningBlock(readRange, size)
      for (const c of res.sigBlock?.certs || []) await addCert(c.der, `APK Signature Scheme ${c.scheme}`)
    } catch (err) { res.notes.push('The APK Signing Block could not be read: ' + errorMessage(err)) }
  }
  res.certs = [...certMap.values()]
  return res
}

const DEVICE_FAMILY = { 1: 'iPhone', 2: 'iPad', 3: 'Apple TV', 4: 'Apple Watch', 5: 'HomePod', 6: 'CarPlay', 7: 'Apple Vision' }

/** Facts from an Info.plist (plain object). */
export function summarizeInfoPlist(p) {
  const schemes = (p.CFBundleURLTypes || []).flatMap((t) => (t.CFBundleURLSchemes || []).map((s) => ({ scheme: s, name: t.CFBundleURLName || '', role: t.CFBundleTypeRole || '' })))
  const ats = p.NSAppTransportSecurity || null
  const atsExceptions = ats?.NSExceptionDomains ? Object.entries(ats.NSExceptionDomains).map(([domain, v]) => ({ domain, insecureHttp: !!(v.NSExceptionAllowsInsecureHTTPLoads || v.NSTemporaryExceptionAllowsInsecureHTTPLoads), subdomains: !!v.NSIncludesSubdomains, minTls: v.NSExceptionMinimumTLSVersion || v.NSTemporaryExceptionMinimumTLSVersion || '' })) : []
  return {
    bundleId: p.CFBundleIdentifier || '', name: p.CFBundleDisplayName || p.CFBundleName || '', bundleName: p.CFBundleName || '',
    version: p.CFBundleShortVersionString || '', build: p.CFBundleVersion || '', minOS: p.MinimumOSVersion || p.LSMinimumSystemVersion || '',
    executable: p.CFBundleExecutable || '', platform: p.DTPlatformName || '', sdk: p.DTSDKName || '', xcode: p.DTXcode || '',
    devices: (p.UIDeviceFamily || []).map((d) => DEVICE_FAMILY[d] || String(d)),
    urlSchemes: schemes, queriedSchemes: p.LSApplicationQueriesSchemes || [],
    privacy: Object.entries(p).filter(([k]) => /UsageDescription$/.test(k)).map(([k, v]) => ({ key: k, text: String(v) })),
    ats: ats ? { arbitraryLoads: !!ats.NSAllowsArbitraryLoads, inWeb: !!ats.NSAllowsArbitraryLoadsInWebContent, media: !!ats.NSAllowsArbitraryLoadsForMedia, local: !!ats.NSAllowsLocalNetworking, exceptions: atsExceptions } : null,
    backgroundModes: p.UIBackgroundModes || [], capabilities: Array.isArray(p.UIRequiredDeviceCapabilities) ? p.UIRequiredDeviceCapabilities : Object.keys(p.UIRequiredDeviceCapabilities || {}),
    associatedDomains: [],
  }
}

/** Facts from a provisioning profile plist (plain object). */
export function summarizeProfile(p, now = new Date()) {
  const devices = p.ProvisionedDevices || []
  const ent = p.Entitlements || {}
  const type = p.ProvisionsAllDevices ? 'Enterprise (in-house)' : devices.length ? (ent['get-task-allow'] ? 'Development' : 'Ad Hoc') : 'App Store'
  const exp = p.ExpirationDate instanceof Date ? p.ExpirationDate : null
  return { name: p.Name || '', appIdName: p.AppIDName || '', team: p.TeamName || '', teamId: (p.TeamIdentifier || [])[0] || '', uuid: p.UUID || '', platform: (p.Platform || []).join(', '),
    created: p.CreationDate || null, expires: exp, expired: exp ? exp < now : false, devices: devices.length, allDevices: !!p.ProvisionsAllDevices, type, entitlements: ent,
    certCount: (p.DeveloperCertificates || []).length }
}

/** Inspect an IPA opened with JSZip. */
export async function inspectIpa(zip, { onStep } = {}) {
  const entries = zipEntries(zip)
  const appMatch = entries.map((e) => e.path.match(/^Payload\/([^/]+\.app)\/Info\.plist$/)).find(Boolean)
  if (!appMatch) {
    if (entries.some((e) => e.path === 'AndroidManifest.xml')) fail('This is an Android APK. Use the APK inspector for it.')
    fail('No Payload/<name>.app/Info.plist found, so this is not an iOS app archive (IPA).')
  }
  const appDir = `Payload/${appMatch[1]}/`
  const res = { kind: 'ipa', appDir, entries, notes: [] }
  onStep?.('Reading Info.plist')
  res.infoNode = parsePlist(await zip.file(appDir + 'Info.plist').async('uint8array'))
  res.info = toPlain(res.infoNode)
  res.summary = summarizeInfoPlist(res.info)

  const mp = zip.file(appDir + 'embedded.mobileprovision')
  if (mp) {
    onStep?.('Reading the provisioning profile')
    try {
      const got = extractEmbeddedPlist(await mp.async('uint8array'))
      if (!got) throw new Error('no plist inside')
      const plain = toPlain(got.plist)
      const certs = []
      for (const der of plain.DeveloperCertificates || []) { try { certs.push(await parseCertificate(der)) } catch { /* skip odd cert */ } }
      res.profile = { node: got.plist, xml: got.text, summary: summarizeProfile(plain), certs }
    } catch (e) { res.notes.push('embedded.mobileprovision could not be read: ' + errorMessage(e)) }
  } else res.notes.push('No embedded.mobileprovision (normal for App Store downloads and simulator builds).')

  const exeName = res.summary.executable || appMatch[1].replace(/\.app$/, '')
  const exe = zip.file(appDir + exeName)
  if (exe) {
    onStep?.(`Reading the executable ${exeName}`)
    try {
      res.macho = parseMachO(await exe.async('uint8array'))
      res.exeName = exeName
      res.exeSize = entries.find((e) => e.path === appDir + exeName)?.size
    } catch (e) { res.notes.push(`The executable ${exeName} could not be parsed: ${errorMessage(e)}`) }
  } else res.notes.push(`The executable ${exeName} named in Info.plist is not in the archive.`)

  // Embedded bundles
  const bundles = async (re, kind) => {
    const found = new Map()
    for (const e of entries) {
      const m = e.path.slice(appDir.length).match(re)
      if (e.path.startsWith(appDir) && m) {
        const key = m[1]
        const b = found.get(key) || { name: key, kind, size: 0, files: 0, bundleId: '', version: '' }
        b.size += e.size || 0
        b.files++
        found.set(key, b)
      }
    }
    for (const b of found.values()) {
      const f = zip.file(`${appDir}${kind === 'appex' ? 'PlugIns' : 'Frameworks'}/${b.name}/Info.plist`)
      if (f) { try { const p = toPlain(parsePlist(await f.async('uint8array'))); b.bundleId = String(p.CFBundleIdentifier || ''); b.version = String(p.CFBundleShortVersionString || p.CFBundleVersion || ''); b.extensionPoint = String(p.NSExtension?.NSExtensionPointIdentifier || '') } catch { /* optional */ } }
      await yieldToMain()
    }
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
  }
  res.frameworks = await bundles(/^Frameworks\/([^/]+\.(?:framework|dylib))(?:\/|$)/, 'framework')
  res.plugins = await bundles(/^PlugIns\/([^/]+\.appex)\//, 'appex')
  res.watch = entries.some((e) => e.path.startsWith(appDir + 'Watch/'))
  return res
}

// ---------- UI ----------

const fmtDate = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '')

export function mount(root, { params = {} } = {}) {
  const kind = params.kind === 'ipa' ? 'ipa' : 'apk'
  root.classList.add(useCss())
  const result = h('div', { class: 'stack' })
  const prog = progress()
  const urls = []
  const revoke = () => { while (urls.length) URL.revokeObjectURL(urls.pop()) }
  let run = 0
  // Leaving the page makes the current run stale, which stops it at its next step.
  onCleanup(() => { run++; revoke() })

  const zone = dropzone({
    accept: kind === 'apk' ? '.apk,.aab,.xapk,.apks,.apkm' : '.ipa',
    label: kind === 'apk' ? 'Drop an APK, AAB or XAPK here' : 'Drop an IPA here',
    hint: kind === 'apk' ? 'APK, AAB, XAPK or APKS · read on your device, nothing is uploaded' : 'IPA file · read on your device, nothing is uploaded',
    icon: kind === 'apk' ? 'package-search' : 'smartphone',
    onFiles: ([f]) => open(f),
  })

  async function open(file) {
    const my = ++run
    revoke()
    clear(result)
    zone.classList.add('compact')
    if (file.size > MAX_BYTES) { result.append(alert('error', `This file is ${formatBytes(file.size)}. Files over ${formatBytes(MAX_BYTES)} are too big to open in a browser tab.`)); return }
    try {
      prog.set(null, `Opening ${file.name}`)
      await yieldToMain()
      const JSZip = await jszip()
      let zip
      try { zip = await JSZip.loadAsync(file) } catch { fail(`${file.name} is not a valid ZIP archive, so it cannot be an ${kind.toUpperCase()}. It may be damaged or only partly downloaded.`) }
      if (my !== run) return
      const onStep = (t) => {
        if (my !== run) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' })
        prog.set(null, t)
      }
      const data = kind === 'apk' ? await inspectApk(zip, { readRange: fileRange(file), size: file.size, name: file.name, onStep }) : await inspectIpa(zip, { onStep })
      if (my !== run) return
      data.zip = data.innerZip || zip
      prog.set(1, 'Rendering')
      await yieldToMain()
      const view = kind === 'apk' ? await renderApk(data, file, my) : renderIpa(data, file)
      if (my !== run) return
      clear(result, view)
    } catch (e) {
      if (isAbort(e)) return
      if (!e?.userMessage) console.error(e)
      clear(result, alert('error', errorMessage(e)))
    } finally { if (my === run) prog.hide() }
  }

  const dl = (zip, path) => async () => {
    try { download(await zip.file(path).async('blob'), path.split('/').pop()) } catch (e) { toast(errorMessage(e), 'error') }
  }
  const filesTab = (zip, entries) => () => h('div', { class: 'stack' },
    h('div', { class: 'small muted' }, `${entries.length} files, ${formatBytes(entries.reduce((s, e) => s + (e.size || 0), 0))} uncompressed. Use the download buttons to save any file.`),
    fileTree(entries, { actions: (f) => rowDownload(f.name, dl(zip, f.path)), open: 1 }))
  const notesEl = (notes) => notes.map((n) => alert('info', n))

  // ----- APK -----
  async function renderApk(d, file, my) {
    const s = d.manifest?.summary
    let iconImg = null
    if (d.manifest?.iconPath && d.zip.file(d.manifest.iconPath)) {
      try {
        const blob = await d.zip.file(d.manifest.iconPath).async('blob')
        // Only a live run may create the URL: a stale one (page left or new file) would never revoke it.
        if (my === run) {
          const u = URL.createObjectURL(blob)
          urls.push(u)
          iconImg = h('img', { src: u, alt: '' })
        }
      } catch { /* no icon */ }
    }
    const dangerous = s ? s.permissions.filter((p) => p.dangerous) : []
    const exported = s ? s.components.filter((c) => c.exported) : []
    const flags = []
    if (s?.app) {
      if (s.app.debuggable) flags.push(pill('Debuggable', 'bad', 'bug'))
      if (s.app.testOnly) flags.push(pill('Test only', 'warn'))
      if (s.app.allowBackup !== false) flags.push(pill(s.app.allowBackup ? 'Backup allowed' : 'Backup allowed (default)', 'warn', 'hard-drive-download'))
      if (s.app.cleartext) flags.push(pill('Cleartext HTTP allowed', 'warn', 'lock-open'))
      if (s.app.networkSecurityConfig) flags.push(pill('Network security config', 'info', 'shield'))
    }
    if (d.sigBlock?.schemes?.length) flags.push(pill(`Signed ${['v1'].filter(() => d.v1Files.length).concat(d.sigBlock.schemes).join(' + ')}`, 'ok', 'badge-check'))
    else if (d.v1Files.length) flags.push(pill('Signed v1 only', 'warn', 'badge-check'))
    else if (d.kind === 'apk') flags.push(pill('Unsigned', 'bad', 'badge-x'))
    if (d.certs.some((c) => c.debug)) flags.push(pill('Debug certificate', 'bad', 'key-round'))

    const overview = () => h('div', { class: 'stack' },
      notesEl(d.notes),
      card(null, h('div', { class: 'stack' },
        hero({ title: s?.app?.label || s?.package || file.name, sub: s ? `${s.package}${s.versionName ? ' · v' + s.versionName : ''}${s.versionCode ? ' (' + s.versionCode + ')' : ''}` : file.name, ic: 'package', img: iconImg }),
        flags.length ? pills(flags) : null,
        s ? stats([
          { label: 'Min SDK', value: s.minSdk ?? '-', hint: androidVersion(s.minSdk) },
          { label: 'Target SDK', value: s.targetSdk ?? '-', hint: androidVersion(s.targetSdk), accent: true },
          { label: 'Permissions', value: s.permissions.length, hint: `${dangerous.length} dangerous`, danger: dangerous.length > 0 },
          { label: 'Components', value: s.components.length, hint: `${exported.length} exported` },
          { label: 'DEX files', value: d.dex.length, hint: d.dex.length ? formatNumber(d.dex.reduce((a, x) => a + (x.header?.methods || 0), 0)) + ' method refs' : '' },
          { label: 'Size', value: formatBytes(file.size), hint: `${d.entries.length} files` },
        ]) : stats([{ label: 'Size', value: formatBytes(file.size), accent: true }, { label: 'Files', value: d.entries.length }, { label: 'DEX files', value: d.dex.length }]),
        s ? kv([
          ['Package', s.package], ['Version name', s.versionName], ['Version code', s.versionCode], ['Compile SDK', s.compileSdk], ['Max SDK', s.maxSdk],
          ['Application class', s.app?.name], ['Install location', s.installLocation], ['Shared user id', s.sharedUserId],
          ['Native ABIs', Object.keys(d.libs).join(', ') || 'none'], ['String pool', d.manifest.utf8 ? 'UTF-8' : 'UTF-16'],
        ]) : null)),
      d.splits ? card('APKs in this bundle', table({ columns: ['File', { label: 'Size', num: true }, ''], rows: d.splits.map((x) => [h('code', x.path), formatBytes(x.size), x.base ? pill('base', 'ok') : '']) })) : null,
      s ? card(`Permissions (${s.permissions.length})`, s.permissions.length ? h('ul', { class: 'pkg-list' }, s.permissions.map((p) => h('li', h('div', { class: 'row', style: 'gap:8px' },
        h('code', p.name), p.dangerous ? pill('dangerous', 'bad', 'triangle-alert') : p.sensitive ? pill('sensitive', 'warn') : null, p.maxSdk ? pill(`up to API ${p.maxSdk}`) : null)))) : h('p', { class: 'muted' }, 'No permissions requested.'),
      s.declared.length ? h('div', { class: 'stack', style: 'margin-top:12px' }, h('strong', 'Declared by this app'), h('ul', { class: 'pkg-list' }, s.declared.map((p) => h('li', h('code', p.name), ' ', pill(p.protection))))) : null) : null,
      s?.features.length ? card('Features', h('ul', { class: 'pkg-list' }, s.features.map((f) => h('li', h('code', f.name), ' ', f.required ? pill('required') : pill('optional'))))) : null,
    )

    const manifestTab = () => {
      if (!d.manifest || d.manifest.error) return alert('warn', d.manifest?.error || 'No manifest.')
      const text = d.manifest.xmlResolved || d.manifest.xml
      return h('div', { class: 'stack' },
        h('div', { class: 'row' }, copyButton(() => text, 'Copy XML'), button('Download XML', { icon: 'download', size: 'sm', onClick: () => download(text, 'AndroidManifest.xml', 'application/xml') })),
        d.manifest.xmlResolved ? h('div', { class: 'small muted' }, 'Resource references are resolved through resources.arsc (strings show their default value, others show @type/name).') : null,
        codeBlock(text))
    }

    const componentsTab = () => {
      if (!s) return alert('info', 'Components are listed when the manifest can be decoded.')
      const rows = s.components.map((c) => [c.kind, h('code', { style: 'overflow-wrap:anywhere' }, c.name),
        h('div', { class: 'pkg-pills' }, c.exported ? pill(c.exportedImplicit ? 'exported (implicit)' : 'exported', c.permission ? 'info' : 'warn') : pill('private', 'ok'), c.launcher ? pill('launcher') : null, c.enabled ? null : pill('disabled')),
        c.permission || c.authorities || '',
        c.filters.length ? h('div', { class: 'small' }, c.filters.map((f) => h('div', [...f.actions, ...f.categories].map((x) => x.replace(/^android\.intent\.(action|category)\./, '')).join(', ') + (f.data.length ? ' · data' : '')))) : ''])
      return h('div', { class: 'stack' },
        table({ columns: ['Type', 'Name', 'Exported', 'Permission / authority', 'Intent filters'], rows }),
        card(`Deep links (${s.deepLinks.length})`, s.deepLinks.length ? h('ul', { class: 'pkg-list' }, s.deepLinks.map((l) => h('li', h('div', { class: 'row', style: 'gap:8px' }, h('code', l.url), l.autoVerify ? pill('App Link, verified', 'ok') : l.browsable ? pill('browsable', 'info') : null), h('div', { class: 'small muted' }, l.component))))
          : h('p', { class: 'muted' }, 'No VIEW intent filters with data, so no deep links.')),
        s.meta.length ? card('Meta-data', table({ columns: ['Name', 'Value'], rows: s.meta.map((m) => [h('code', m.name), h('code', m.value)]) })) : null)
    }

    const codeTab = () => h('div', { class: 'stack' },
      card(`DEX files (${d.dex.length})`, d.dex.length ? table({ columns: ['File', { label: 'Size', num: true }, 'Version', { label: 'Strings', num: true }, { label: 'Types', num: true }, { label: 'Methods', num: true }, { label: 'Classes', num: true }],
        rows: d.dex.map((x) => [h('code', x.path), formatBytes(x.size), x.header?.version ?? x.error, ...['strings', 'types', 'methods', 'classes'].map((k) => (x.header ? formatNumber(x.header[k]) : ''))]) })
        : h('p', { class: 'muted' }, 'No classes.dex found.'), d.dex.some((x) => x.header?.methods > 60000) ? h('p', { class: 'small muted' }, 'A DEX file holds at most 65,536 method references, which is why large apps ship several.') : null),
      card('Native libraries', Object.keys(d.libs).length ? h('div', { class: 'stack' }, Object.entries(d.libs).map(([abi, libs]) => h('div', { class: 'stack' },
        h('div', { class: 'row' }, h('strong', abi), pill(`${libs.length} ${libs.length === 1 ? 'library' : 'libraries'}`), pill(formatBytes(libs.reduce((a, l) => a + (l.size || 0), 0)))),
        h('ul', { class: 'pkg-list' }, libs.map((l) => h('li', h('div', { class: 'row', style: 'justify-content:space-between' }, h('code', l.name), h('span', { class: 'small muted' }, formatBytes(l.size)))))))))
        : h('p', { class: 'muted' }, 'No native libraries (lib/<abi>/*.so). This app is pure Java or Kotlin.')))

    const signingTab = () => h('div', { class: 'stack' },
      card('Signature schemes', pills(
        d.v1Files.length ? pill(`v1 JAR signature (${d.v1Files.map((x) => x.split('/').pop()).join(', ')})`, 'ok') : pill('No v1 signature files', ''),
        ...(d.sigBlock ? d.sigBlock.schemes.map((x) => pill(`APK Signature Scheme ${x}`, 'ok')) : [pill('No APK Signing Block (v2/v3)', d.kind === 'apk' ? 'warn' : '')]),
        ...(d.sigBlock ? d.sigBlock.blocks.filter((b) => !/^v\d/.test(b.name)).map((b) => pill(`${b.name} block`)) : [])),
      h('p', { class: 'small muted' }, 'This shows what is present and who signed it. Signatures are not verified against the APK contents.')),
      ...d.certs.map((c, i) => card(`Certificate ${i + 1}`, h('div', { class: 'stack' },
        pills(...c.sources.map((x) => pill(x, 'info')), c.debug ? pill('Android debug key', 'bad') : null, c.notAfter < new Date() ? pill('Expired', 'warn') : null, c.selfSigned ? pill('Self-signed') : null),
        kv([['Subject', c.subject], ['Issuer', c.issuer], ['Serial', c.serial], ['Valid from', c.notBefore.toISOString()], ['Valid until', c.notAfter.toISOString()],
          ['Signature', c.sigAlg], ['Public key', `${c.keyType}${c.keyBits ? ' ' + c.keyBits + ' bit' : ''}`], ['SHA-256', c.sha256], ['SHA-1', c.sha1]]),
        h('div', { class: 'row' }, copyButton(() => c.sha256.replace(/:/g, '').toLowerCase(), 'Copy SHA-256'), button('Download .cer', { icon: 'download', size: 'sm', onClick: () => download(new Blob([c.der]), `certificate-${i + 1}.cer`) }))))),
      d.certs.length ? null : alert('warn', 'No signing certificate found.'))

    return h('div', { class: 'stack' }, tabs([
      { id: 'o', label: 'Overview', render: overview },
      { id: 'm', label: 'Manifest', render: manifestTab },
      { id: 'c', label: 'Components', render: componentsTab },
      { id: 'd', label: 'Code', render: codeTab },
      { id: 's', label: 'Signing', render: signingTab },
      { id: 'f', label: 'Files', render: filesTab(d.outerZip || d.zip, d.outerEntries || d.entries) },
    ]))
  }

  // ----- IPA -----
  function renderIpa(d, file) {
    const s = d.summary
    const m = d.macho
    const main = m?.arches?.[0]
    const flags = []
    if (m) {
      const enc = m.arches.some((a) => a.encrypted)
      flags.push(enc ? pill('Encrypted (FairPlay)', 'warn', 'lock') : pill('Not encrypted', 'ok', 'lock-open'))
    }
    if (s.ats?.arbitraryLoads) flags.push(pill('ATS: arbitrary loads allowed', 'warn', 'lock-open'))
    if (d.profile) flags.push(pill(d.profile.summary.type, 'info', 'badge-check'), d.profile.summary.expired ? pill('Profile expired', 'bad') : null)
    if (d.profile?.summary.entitlements['get-task-allow']) flags.push(pill('get-task-allow (debuggable)', 'warn', 'bug'))

    const overview = () => h('div', { class: 'stack' },
      notesEl(d.notes),
      card(null, h('div', { class: 'stack' },
        hero({ title: s.name || s.bundleId || file.name, sub: `${s.bundleId}${s.version ? ' · v' + s.version : ''}${s.build ? ' (' + s.build + ')' : ''}`, ic: 'smartphone' }),
        flags.length ? pills(flags) : null,
        stats([
          { label: 'Minimum OS', value: s.minOS || '-', accent: true },
          { label: 'Devices', value: s.devices.join(', ') || '-' },
          { label: 'Frameworks', value: d.frameworks.length },
          { label: 'Extensions', value: d.plugins.length },
          { label: 'Size', value: formatBytes(file.size), hint: `${d.entries.length} files` },
        ]),
        kv([['Bundle id', s.bundleId], ['Display name', s.name], ['Version', s.version], ['Build', s.build], ['Executable', s.executable], ['Platform', s.platform], ['SDK', s.sdk], ['Xcode', s.xcode],
          ['Background modes', s.backgroundModes.join(', ')], ['Required capabilities', s.capabilities.join(', ')], ['Watch app', d.watch ? 'yes' : null]]))),
      card(`URL schemes (${s.urlSchemes.length})`, s.urlSchemes.length ? h('ul', { class: 'pkg-list' }, s.urlSchemes.map((u) => h('li', h('code', u.scheme + '://'), u.name ? h('span', { class: 'small muted' }, '  ' + u.name) : null))) : h('p', { class: 'muted' }, 'No custom URL schemes.'),
        s.queriedSchemes.length ? h('div', { class: 'stack', style: 'margin-top:12px' }, h('strong', `Queried schemes (${s.queriedSchemes.length})`), h('p', { class: 'small muted' }, 'Apps this app checks for with canOpenURL.'), pills(s.queriedSchemes.map((q) => pill(q)))) : null),
      card(`Privacy strings (${s.privacy.length})`, s.privacy.length ? table({ columns: ['Key', 'Text shown to the user'], rows: s.privacy.map((p) => [h('code', p.key.replace(/^NS|UsageDescription$/g, '')), p.text]) }) : h('p', { class: 'muted' }, 'No usage descriptions, so the app asks for no protected resources.')),
      card('App Transport Security', s.ats ? h('div', { class: 'stack' }, kv([['Arbitrary loads', s.ats.arbitraryLoads ? 'allowed' : 'blocked'], ['In web content', s.ats.inWeb ? 'allowed' : null], ['Media', s.ats.media ? 'allowed' : null], ['Local networking', s.ats.local ? 'allowed' : null]]),
        s.ats.exceptions.length ? table({ columns: ['Domain', 'Insecure HTTP', 'Subdomains', 'Min TLS'], rows: s.ats.exceptions.map((x) => [h('code', x.domain), x.insecureHttp ? 'allowed' : 'no', x.subdomains ? 'yes' : 'no', x.minTls]) }) : null)
        : h('p', { class: 'muted' }, 'No NSAppTransportSecurity key: HTTPS with modern TLS is required for all connections.')))

    const plistTab = () => {
      const xml = () => writeXmlPlist(d.infoNode)
      return h('div', { class: 'stack' }, h('div', { class: 'row' }, copyButton(xml, 'Copy as XML'), button('Download XML', { icon: 'download', size: 'sm', onClick: () => download(xml(), 'Info.plist', 'application/xml') })), plistTree(d.infoNode, { open: 1, label: 'Info.plist' }))
    }

    const profileTab = () => {
      if (!d.profile) return alert('info', 'This IPA has no embedded.mobileprovision.')
      const p = d.profile.summary
      return h('div', { class: 'stack' },
        card(null, h('div', { class: 'stack' },
          pills(pill(p.type, 'info'), p.expired ? pill('Expired', 'bad') : pill(`Valid until ${fmtDate(p.expires)}`, 'ok')),
          kv([['Name', p.name], ['App ID name', p.appIdName], ['Team', p.team], ['Team id', p.teamId], ['Platform', p.platform], ['Created', fmtDate(p.created)], ['Expires', fmtDate(p.expires)],
            ['Devices', p.allDevices ? 'all devices (enterprise)' : p.devices ? `${p.devices} provisioned devices` : 'none (App Store)'], ['UUID', p.uuid]]))),
        card('Entitlements', plistTree(d.profile.node.v.find(([k]) => k === 'Entitlements')?.[1] || { t: 'dict', v: [] }, { open: 1, label: 'Entitlements' })),
        ...d.profile.certs.map((c, i) => card(`Developer certificate ${i + 1}`, kv([['Subject', c.subject], ['Issuer', c.issuer], ['Valid until', c.notAfter.toISOString()], ['SHA-256', c.sha256]]))),
        h('div', { class: 'row' }, button('Download profile as XML', { icon: 'download', size: 'sm', onClick: () => download(d.profile.xml, 'embedded.mobileprovision.plist', 'application/xml') })))
    }

    const binaryTab = () => {
      if (!m) return alert('warn', 'The main executable could not be read.')
      return h('div', { class: 'stack' },
        card(`${d.exeName} (${formatBytes(d.exeSize)})`, h('div', { class: 'stack' },
          kv([['Type', m.fat ? `Universal (fat) binary, ${m.arches.length} architectures` : 'Thin Mach-O'], ['Architectures', m.arches.map((a) => a.cpu).join(', ')], ['File type', main.fileType],
            ['Platform', main.platform], ['Minimum OS', main.minOS], ['Built with SDK', main.sdk], ['UUID', main.uuid], ['PIE', main.pie ? 'yes' : 'no'], ['Load commands', main.ncmds]]),
          table({ columns: ['Arch', 'Bits', 'Encrypted', 'cryptid', 'Code signature'], rows: m.arches.map((a) => [a.cpu, a.bits ?? '', a.error ? a.error : a.encrypted ? 'yes' : 'no', a.cryptid ?? 'no LC_ENCRYPTION_INFO', a.codeSignature ? formatBytes(a.codeSignature.size) : 'none']) }),
          m.arches.some((a) => a.encrypted) ? h('p', { class: 'small muted' }, 'cryptid 1 means the code is FairPlay encrypted (App Store download). The code itself cannot be read until it is decrypted on a device.') : null)),
        main.entitlements ? card('Signed entitlements', h('div', { class: 'stack' }, (() => { try { return plistTree(parsePlist(new TextEncoder().encode(main.entitlements)), { open: 1, label: 'Entitlements' }) } catch { return codeBlock(main.entitlements) } })())) : null,
        card(`Linked libraries (${main.dylibs.length})`, h('ul', { class: 'pkg-list' }, main.dylibs.map((x) => h('li', h('code', x.name), x.weak ? ' ' : null, x.weak ? pill('weak') : null))),
          main.rpaths.length ? h('div', { class: 'small muted', style: 'margin-top:8px' }, 'Run paths: ', main.rpaths.join(', ')) : null))
    }

    const bundlesTab = () => {
      const rows = (list) => list.map((b) => [h('code', b.name), b.bundleId ? h('code', b.bundleId) : '', b.version, b.extensionPoint || '', formatBytes(b.size)])
      return h('div', { class: 'stack' },
        card(`Frameworks (${d.frameworks.length})`, d.frameworks.length ? table({ columns: ['Name', 'Bundle id', 'Version', '', { label: 'Size', num: true }], rows: rows(d.frameworks) }) : h('p', { class: 'muted' }, 'No embedded frameworks.')),
        card(`App extensions (${d.plugins.length})`, d.plugins.length ? table({ columns: ['Name', 'Bundle id', 'Version', 'Extension point', { label: 'Size', num: true }], rows: rows(d.plugins) }) : h('p', { class: 'muted' }, 'No app extensions (PlugIns).')))
    }

    return h('div', { class: 'stack' }, tabs([
      { id: 'o', label: 'Overview', render: overview },
      { id: 'i', label: 'Info.plist', render: plistTab },
      { id: 'p', label: 'Profile', render: profileTab },
      { id: 'b', label: 'Binary', render: binaryTab },
      { id: 'x', label: 'Bundles', render: bundlesTab },
      { id: 'f', label: 'Files', render: filesTab(d.zip, d.entries) },
    ]))
  }

  root.append(h('div', { class: 'stack' }, zone, prog.el, result))
}

