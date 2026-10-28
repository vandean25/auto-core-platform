/**
 * The minimal service worker of the PWA shell (AUT-740). It is an offline safety net: it caches `/offline.html`
 * and the icons, and answers a page navigation with the offline page when the network fails. Everything else
 * (API calls, `/api/socket.io`, `/version.json`, `/assets/**`, uploads, Firebase auth) is never intercepted, so
 * the browser handles it exactly as without a service worker.
 *
 * It is also the one worker that shows web push (AUT-766, ADR-0033): a `push` event always shows a notification
 * built from the data-only FCM message, and a click focuses an open tab or opens the same-origin deep link.
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

type PushEventLike = ExtendableEventLike & { data: { json(): unknown } | null }

type WindowClientLike = { url: string; focus(): Promise<unknown>; navigate?(url: string): Promise<unknown> }

type NotificationClickEventLike = ExtendableEventLike & {
  notification: { close(): void; data?: { url?: unknown } | null }
}

export type ServiceWorkerScope = {
  location: { origin: string }
  URL: typeof URL
  Response: typeof Response
  fetch: typeof fetch
  caches: CacheStorageLike
  clients: {
    claim(): Promise<void>
    matchAll(options: { type: 'window'; includeUncontrolled: boolean }): Promise<WindowClientLike[]>
    openWindow(url: string): Promise<unknown>
  }
  registration: {
    unregister(): Promise<boolean>
    showNotification(title: string, options: Record<string, unknown>): Promise<void>
  }
  skipWaiting(): Promise<void>
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEventLike) => void): void
  addEventListener(type: 'fetch', listener: (event: FetchEventLike) => void): void
  addEventListener(type: 'push', listener: (event: PushEventLike) => void): void
  addEventListener(type: 'notificationclick', listener: (event: NotificationClickEventLike) => void): void
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
    // Files (/version.json, /assets/*, /sw.js, the manifest) are not app pages; the SPA rewrite skips them too.
    if (url.pathname.split('/').pop()?.includes('.')) return

    // Network first. The offline page is only the answer to a network error, never to an HTTP error.
    event.respondWith(
      scope.fetch(request).catch(() => scope.caches.match(offlineUrl).then((cached) => cached ?? scope.Response.error())),
    )
  })

  scope.addEventListener('push', (event) => {
    // The message is data-only: FCM delivers `{ data: { title, body, url, tag, ... } }`. A notification is always
    // shown, even for an unreadable payload, because browsers (Safari above all) revoke a push that shows nothing.
    let payload: unknown
    try {
      payload = event.data?.json()
    } catch {
      payload = null
    }
    const record = (payload && typeof payload === 'object' ? payload : {}) as { data?: Record<string, unknown> }
    const data = (record.data ?? record) as Record<string, unknown>
    const text = (value: unknown, fallback: string) => (typeof value === 'string' && value ? value : fallback)
    const url = typeof data.url === 'string' && /^\/(?!\/)/.test(data.url) ? data.url : '/'
    event.waitUntil(
      scope.registration.showNotification(text(data.title, 'Auto Core Platform'), {
        body: text(data.body, ''),
        tag: text(data.tag, 'acp'),
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: { url },
      }),
    )
  })

  scope.addEventListener('notificationclick', (event) => {
    event.notification.close()
    const stored = event.notification.data?.url
    // Same origin only: the link is a path, never an address, so a click can not leave the app.
    const target = new scope.URL(typeof stored === 'string' && /^\/(?!\/)/.test(stored) ? stored : '/', scope.location.origin).href
    event.waitUntil(
      scope.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
        const open = windows.find((client) => new scope.URL(client.url).origin === scope.location.origin)
        if (!open) return scope.clients.openWindow(target)
        return open.focus().then(() => open.navigate?.(target))
      }),
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
