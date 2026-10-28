// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { buildServiceWorkerSource } from '../../vite-plugins/emit-service-worker'
import { runKillSwitch, runServiceWorker, type ServiceWorkerScope } from './service-worker'

type Listener = (event: unknown) => void

type FakeWindow = { url: string; focus: ReturnType<typeof vi.fn>; navigate?: ReturnType<typeof vi.fn> }

function createScope(options: { cacheNames?: string[]; fetchImpl?: ServiceWorkerScope['fetch']; windows?: FakeWindow[] } = {}) {
  const listeners: Record<string, Listener> = {}
  const cacheNames = new Set(options.cacheNames ?? [])
  const added: Record<string, string[]> = {}
  const offlineResponse = new Response('offline page')
  const scope = {
    location: { origin: 'https://app.example.test' },
    URL,
    Response,
    fetch: options.fetchImpl ?? vi.fn(() => Promise.resolve(new Response('network'))),
    caches: {
      open: vi.fn(async (name: string) => {
        cacheNames.add(name)
        return { addAll: vi.fn(async (urls: string[]) => void (added[name] = urls)) }
      }),
      keys: vi.fn(async () => [...cacheNames]),
      delete: vi.fn(async (name: string) => cacheNames.delete(name)),
      match: vi.fn(async (url: string) => (url === '/offline.html' ? offlineResponse : undefined)),
    },
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => options.windows ?? []),
      openWindow: vi.fn(async () => undefined),
    },
    registration: { unregister: vi.fn(async () => true), showNotification: vi.fn(async () => undefined) },
    skipWaiting: vi.fn(async () => undefined),
    addEventListener: vi.fn((type: string, listener: Listener) => {
      listeners[type] = listener
    }),
  } as unknown as ServiceWorkerScope & { caches: { delete: ReturnType<typeof vi.fn> } }

  async function lifecycle(type: 'install' | 'activate') {
    const waits: Promise<unknown>[] = []
    listeners[type]?.({ waitUntil: (promise: Promise<unknown>) => waits.push(promise) })
    await Promise.all(waits)
  }

  function navigate(url: string, init: { mode?: string; method?: string } = {}) {
    const respondWith = vi.fn()
    listeners.fetch?.({ request: { url, mode: init.mode ?? 'navigate', method: init.method ?? 'GET' }, respondWith })
    return respondWith
  }

  async function push(payload: unknown) {
    const waits: Promise<unknown>[] = []
    const data =
      payload === undefined
        ? null
        : { json: () => {
          if (payload instanceof Error) throw payload
          return payload
        } }
    listeners.push?.({ data, waitUntil: (promise: Promise<unknown>) => waits.push(promise) })
    await Promise.all(waits)
  }

  async function click(url: unknown) {
    const waits: Promise<unknown>[] = []
    const close = vi.fn()
    listeners.notificationclick?.({
      notification: { close, data: url === undefined ? null : { url } },
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    })
    await Promise.all(waits)
    return close
  }

  return { scope, listeners, added, cacheNames, offlineResponse, lifecycle, navigate, push, click }
}

// The worker is shipped as the serialized function, so every behaviour is checked on both forms.
const variants = [
  ['source function', (scope: ServiceWorkerScope) => runServiceWorker(scope, 'v1.2.3')],
  ['emitted sw.js', (scope: ServiceWorkerScope) => new Function('self', buildServiceWorkerSource('v1.2.3', false))(scope)],
] as const

describe.each(variants)('service worker (%s)', (_name, start) => {
  it('caches only the offline page and the icons, under a cache named after the release', async () => {
    const { scope, added, lifecycle } = createScope()
    start(scope)

    await lifecycle('install')

    expect(added['acp-shell-v1.2.3']).toEqual([
      '/offline.html',
      '/icons/icon-192.png',
      '/icons/icon-512.png',
      '/icons/icon-maskable-512.png',
    ])
    expect(scope.skipWaiting).toHaveBeenCalled()
  })

  it('deletes the caches of older releases on activate and keeps other caches', async () => {
    const { scope, cacheNames, lifecycle } = createScope({
      cacheNames: ['acp-shell-v1.0.0', 'acp-shell-v1.2.3', 'someone-elses-cache'],
    })
    start(scope)

    await lifecycle('activate')

    expect([...cacheNames].sort()).toEqual(['acp-shell-v1.2.3', 'someone-elses-cache'])
    expect(scope.clients.claim).toHaveBeenCalled()
  })

  it('answers a page navigation from the network and falls back to the offline page only on a network error', async () => {
    const online = createScope()
    start(online.scope)
    const respondOnline = online.navigate('https://app.example.test/customers')
    expect(respondOnline).toHaveBeenCalledTimes(1)
    expect(await (await respondOnline.mock.calls[0][0]).text()).toBe('network')

    const offline = createScope({ fetchImpl: vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))) })
    start(offline.scope)
    const respondOffline = offline.navigate('https://app.example.test/customers')
    expect(await respondOffline.mock.calls[0][0]).toBe(offline.offlineResponse)
  })

  it('does not replace an HTTP error with the offline page', async () => {
    const { scope, navigate } = createScope({ fetchImpl: vi.fn(() => Promise.resolve(new Response('boom', { status: 503 }))) })
    start(scope)

    const response = await navigate('https://app.example.test/customers').mock.calls[0][0]

    expect(response.status).toBe(503)
    expect(scope.caches.match).not.toHaveBeenCalled()
  })

  it.each([
    ['an API navigation', 'https://app.example.test/api/workshop/orders/1/pdf', {}],
    ['the realtime socket', 'https://app.example.test/api/socket.io/?EIO=4&transport=polling', { mode: 'cors' }],
    ['an API call', 'https://app.example.test/api/customers', { mode: 'cors' }],
    ['version.json', 'https://app.example.test/version.json', { mode: 'cors' }],
    ['a hashed asset', 'https://app.example.test/assets/index-abc123.js', { mode: 'cors' }],
    ['the manifest', 'https://app.example.test/manifest.webmanifest', { mode: 'cors' }],
    ['a navigation to version.json', 'https://app.example.test/version.json', {}],
    ['a navigation to a hashed asset', 'https://app.example.test/assets/report-abc123.pdf', {}],
    ['a navigation to sw.js', 'https://app.example.test/sw.js', {}],
    ['a navigation to the manifest', 'https://app.example.test/manifest.webmanifest', {}],
    ['an upload', 'https://app.example.test/customers', { method: 'POST' }],
    ['a storage upload (other origin)', 'https://storage.googleapis.com/upload', { mode: 'cors', method: 'POST' }],
    ['a Google sign-in navigation (other origin)', 'https://accounts.google.com/o/oauth2/auth', {}],
    ['the Firebase auth handler', 'https://app.example.test/__/auth/handler?apiKey=x', {}],
  ])('never intercepts %s', (_label, url, init) => {
    const { scope, navigate } = createScope()
    start(scope)

    expect(navigate(url, init)).not.toHaveBeenCalled()
    expect(scope.fetch).not.toHaveBeenCalled()
  })

  it('has no part in offline drafts or uploads: no IndexedDB, no background sync, no message handling', () => {
    const { scope, listeners } = createScope()
    start(scope)

    expect(Object.keys(listeners).sort()).toEqual(['activate', 'fetch', 'install', 'notificationclick', 'push'])
    expect(buildServiceWorkerSource('v1', false)).not.toMatch(/indexedDB|sync|postMessage/i)
  })

  it('shows a notification for a data-only push, with the deep link and the collapse tag', async () => {
    const { scope, push } = createScope()
    start(scope)

    await push({ data: { title: 'Estimate approved', body: 'Order WO-1', url: '/workshop/orders/o1', tag: 'T:o1' } })

    expect(scope.registration.showNotification).toHaveBeenCalledWith('Estimate approved', {
      body: 'Order WO-1',
      tag: 'T:o1',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: '/workshop/orders/o1' },
    })
  })

  it.each([
    ['no payload', undefined],
    ['an unreadable payload', new Error('not json')],
    ['an empty payload', {}],
  ])('still shows a notification for %s, because a silent push gets the subscription revoked', async (_label, payload) => {
    const { scope, push } = createScope()
    start(scope)

    await push(payload)

    expect(scope.registration.showNotification).toHaveBeenCalledTimes(1)
    expect(scope.registration.showNotification).toHaveBeenCalledWith(
      'Auto Core Platform',
      expect.objectContaining({ data: { url: '/' } }),
    )
  })

  it.each(['https://evil.example/phish', '//evil.example/phish', 'javascript:alert(1)', 42])(
    'drops a deep link that is not a path of this origin (%s)',
    async (url) => {
      const { scope, push } = createScope()
      start(scope)

      await push({ data: { title: 'T', url } })

      expect(scope.registration.showNotification).toHaveBeenCalledWith('T', expect.objectContaining({ data: { url: '/' } }))
    },
  )

  it('focuses an open tab of the app and moves it to the deep link on click', async () => {
    const other = { url: 'https://other.example/x', focus: vi.fn(async () => undefined), navigate: vi.fn(async () => undefined) }
    const app = { url: 'https://app.example.test/customers', focus: vi.fn(async () => undefined), navigate: vi.fn(async () => undefined) }
    const { scope, click } = createScope({ windows: [other, app] })
    start(scope)

    const close = await click('/workshop/orders/o1')

    expect(close).toHaveBeenCalled()
    expect(app.focus).toHaveBeenCalled()
    expect(app.navigate).toHaveBeenCalledWith('https://app.example.test/workshop/orders/o1')
    expect(other.focus).not.toHaveBeenCalled()
    expect(scope.clients.openWindow).not.toHaveBeenCalled()
  })

  it('opens the deep link in a new window when no tab of the app is open, and never leaves the origin', async () => {
    const { scope, click } = createScope()
    start(scope)

    await click('/workshop/orders/o1')
    await click('https://evil.example/phish')

    expect(scope.clients.openWindow).toHaveBeenNthCalledWith(1, 'https://app.example.test/workshop/orders/o1')
    expect(scope.clients.openWindow).toHaveBeenNthCalledWith(2, 'https://app.example.test/')
  })
})

describe('kill switch', () => {
  const killVariants = [
    ['source function', (scope: ServiceWorkerScope) => runKillSwitch(scope)],
    ['emitted sw.js', (scope: ServiceWorkerScope) => new Function('self', buildServiceWorkerSource('v1.2.3', true))(scope)],
  ] as const

  it.each(killVariants)('unregisters itself and clears every cache (%s)', async (_name, start) => {
    const { scope, cacheNames, listeners, lifecycle } = createScope({ cacheNames: ['acp-shell-v1.2.3', 'acp-shell-old'] })
    start(scope)

    await lifecycle('install')
    expect(scope.skipWaiting).toHaveBeenCalled()
    await lifecycle('activate')

    expect([...cacheNames]).toEqual([])
    expect(scope.registration.unregister).toHaveBeenCalledTimes(1)
    expect(listeners.fetch).toBeUndefined()
  })

  it('is the file that is emitted when the kill switch is on', () => {
    expect(buildServiceWorkerSource('v9', true)).toContain('unregister')
    expect(buildServiceWorkerSource('v9', true)).not.toContain('offline.html')
    expect(buildServiceWorkerSource('v9', false)).toContain('"v9"')
  })
})
