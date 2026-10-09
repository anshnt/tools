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
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k)
  await self.clients.claim()
})()))

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || req.headers.has('range')) return
  const url = req.url
  if (url.startsWith(self.registration.scope) || FRESH.some((r) => r.test(url))) e.respondWith(networkFirst(req))
  else if (PINNED.some((r) => r.test(url))) e.respondWith(cacheFirst(req))
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
