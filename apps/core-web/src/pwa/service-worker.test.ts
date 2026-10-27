// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { buildServiceWorkerSource } from '../../vite-plugins/emit-service-worker'
import { runKillSwitch, runServiceWorker, type ServiceWorkerScope } from './service-worker'

type Listener = (event: unknown) => void

function createScope(options: { cacheNames?: string[]; fetchImpl?: ServiceWorkerScope['fetch'] } = {}) {
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
    clients: { claim: vi.fn(async () => undefined) },
    registration: { unregister: vi.fn(async () => true) },
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

  return { scope, listeners, added, cacheNames, offlineResponse, lifecycle, navigate }
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

    expect(Object.keys(listeners).sort()).toEqual(['activate', 'fetch', 'install'])
    expect(buildServiceWorkerSource('v1', false)).not.toMatch(/indexedDB|sync|postMessage/i)
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
