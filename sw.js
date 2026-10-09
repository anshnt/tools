// Service worker: makes Tools installable and keeps tools you have used working offline.
// - This site: network first (always fresh online), cached copy when offline.
// - Pinned CDN files (their URLs carry an exact version, so they never change): cache first.
// - Everything else (AI providers, online lookups, ML model hosts) is not touched.
const CACHE = 'tools-v1'
const SHELL = ['./', 'index.html', 'assets/app.css', 'assets/app.js', 'assets/catalog.js', 'assets/favicon.svg', 'manifest.webmanifest']
const PINNED = [/^https:\/\/cdn\.jsdelivr\.net\/npm\/(@[^/]+\/)?[^/@]+@\d/, /^https:\/\/cdn\.sheetjs\.com\/xlsx-\d/, /^https:\/\/fonts\.gstatic\.com\//]
const FRESH = [/^https:\/\/fonts\.googleapis\.com\//]

self.addEventListener('install', (e) => {
  self.skipWaiting()
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}))
})

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  // Only our own old versions: tools also keep downloaded ML models in caches of their own.
  for (const k of await caches.keys()) if (k.startsWith('tools-') && k !== CACHE) await caches.delete(k)
  await self.clients.claim()
})()))

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || req.headers.has('range')) return
  const url = req.url
  if (url.startsWith(self.registration.scope) || FRESH.some((r) => r.test(url))) e.respondWith(networkFirst(req))
  else if (PINNED.some((r) => r.test(url))) e.respondWith(cacheFirst(req))
})

// The first visit loads files before this worker controls the page; the page sends their URLs so they work offline too.
self.addEventListener('message', (e) => {
  if (e.data?.type !== 'cache-urls' || !Array.isArray(e.data.urls)) return
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    for (const url of new Set(e.data.urls)) {
      const own = url.startsWith(self.registration.scope)
      if (!own && !PINNED.some((r) => r.test(url)) && !FRESH.some((r) => r.test(url))) continue
      if (await cache.match(url)) continue
      try {
        const res = await fetch(url, { mode: own ? 'same-origin' : 'cors', credentials: 'omit' })
        if (cacheable(res)) await cache.put(url, res)
      } catch { /* offline or blocked: skip */ }
    }
  })())
})

const cacheable = (res) => res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')

async function networkFirst(req) {
  const cache = await caches.open(CACHE)
  try {
    const res = await fetch(req)
    if (cacheable(res)) cache.put(req, res.clone()).catch(() => {})
    return res
  } catch (err) {
    const hit = (await cache.match(req, { ignoreSearch: req.mode === 'navigate' })) || (req.mode === 'navigate' && (await cache.match('./')))
    if (hit) return hit
    throw err
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (cacheable(res)) cache.put(req, res.clone()).catch(() => {})
  return res
}
