/**
 * The minimal service worker of the PWA shell (AUT-740). It exists as an offline safety net only:
 * it caches `/offline.html` and the icons, and answers a page navigation with the offline page when the
 * network fails. Everything else (API calls, `/api/socket.io`, `/version.json`, `/assets/**`, uploads,
 * Firebase auth) is never intercepted, so the browser handles it exactly as without a service worker.
 *
 * The functions are serialized into `dist/sw.js` by `vite-plugins/emit-service-worker.ts`, so they must
 * stay self-contained: no imports, no module-level values, only what they get passed in.
 */

type ExtendableEventLike = { waitUntil(promise: Promise<unknown>): void }

type FetchEventLike = {
  request: Request
  respondWith(response: Promise<Response>): void
}

type CacheStorageLike = {
  open(name: string): Promise<{ addAll(urls: string[]): Promise<void> }>
  keys(): Promise<string[]>
  delete(name: string): Promise<boolean>
  match(url: string): Promise<Response | undefined>
}

export type ServiceWorkerScope = {
  location: { origin: string }
  URL: typeof URL
  Response: typeof Response
  fetch: typeof fetch
  caches: CacheStorageLike
  clients: { claim(): Promise<void> }
  registration: { unregister(): Promise<boolean> }
  skipWaiting(): Promise<void>
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEventLike) => void): void
  addEventListener(type: 'fetch', listener: (event: FetchEventLike) => void): void
}

export function runServiceWorker(scope: ServiceWorkerScope, version: string): void {
  const cachePrefix = 'acp-shell-'
  const cacheName = `${cachePrefix}${version}`
  const offlineUrl = '/offline.html'
  const shellUrls = [offlineUrl, '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png']

  scope.addEventListener('install', (event) => {
    event.waitUntil(
      scope.caches
        .open(cacheName)
        .then((cache) => cache.addAll(shellUrls))
        .then(() => scope.skipWaiting()),
    )
  })

  scope.addEventListener('activate', (event) => {
    event.waitUntil(
      scope.caches
        .keys()
        .then((names) =>
          Promise.all(
            names.filter((name) => name.startsWith(cachePrefix) && name !== cacheName).map((name) => scope.caches.delete(name)),
          ),
        )
        .then(() => scope.clients.claim()),
    )
  })

  scope.addEventListener('fetch', (event) => {
    const { request } = event
    if (request.mode !== 'navigate' || request.method !== 'GET') return
    const url = new scope.URL(request.url)
    // Only page navigations of this origin; the API and the Firebase auth handler are network only.
    if (url.origin !== scope.location.origin) return
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__/')) return

    // Network first. The offline page is only the answer to a network error, never to an HTTP error.
    event.respondWith(
      scope.fetch(request).catch(() => scope.caches.match(offlineUrl).then((cached) => cached ?? scope.Response.error())),
    )
  })
}

/**
 * Kill switch: a service worker that removes itself. Deploying it as `/sw.js` makes every browser that
 * still runs the real one install this one, clear the caches and unregister, with no manual step.
 */
export function runKillSwitch(scope: ServiceWorkerScope): void {
  scope.addEventListener('install', (event) => {
    event.waitUntil(scope.skipWaiting())
  })

  scope.addEventListener('activate', (event) => {
    event.waitUntil(
      scope.caches
        .keys()
        .then((names) => Promise.all(names.map((name) => scope.caches.delete(name))))
        .then(() => scope.registration.unregister()),
    )
  })
}
