import { expect, test, type Page } from '@playwright/test'

// Runs on the real production build (`npm run build:pwa`, project `chromium-pwa`): the e2e bundle never registers the service worker.

async function waitForControllingWorker(page: Page) {
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/')
    return Boolean(registration?.active && navigator.serviceWorker.controller)
  })
}

test.describe('PWA shell (production build)', () => {
  test('serves the manifest, the service worker and the offline page from the root', async ({ request }) => {
    const manifest = await request.get('/manifest.webmanifest')
    expect(manifest.ok()).toBe(true)
    expect(await manifest.json()).toMatchObject({ id: '/', start_url: '/?source=pwa', scope: '/', display: 'standalone' })

    const worker = await request.get('/sw.js')
    expect(worker.ok()).toBe(true)
    expect(await worker.text()).toContain('"v1.0.0-pwa"')

    expect((await request.get('/offline.html')).ok()).toBe(true)
  })

  test('registers the worker, leaves /api and /version.json to the network and shows the offline page without a connection', async ({
    page,
    context,
  }) => {
    await page.goto('/')
    await waitForControllingWorker(page)

    const registration = await page.evaluate(async () => {
      const current = await navigator.serviceWorker.getRegistration('/')
      return { scope: current?.scope, updateViaCache: current?.updateViaCache }
    })
    expect(registration.scope).toBe(new URL('/', page.url()).href)
    expect(registration.updateViaCache).toBe('none')

    const cacheKeys = await page.evaluate(() => caches.keys())
    expect(cacheKeys).toEqual(['acp-shell-v1.0.0-pwa'])

    const fromWorker: Record<string, boolean> = {}
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname
      if (path === '/api/health' || path === '/version.json') fromWorker[path] = response.fromServiceWorker()
    })
    await page.evaluate(async () => {
      await fetch('/api/health').catch(() => undefined)
      await fetch('/version.json', { cache: 'no-store' })
    })
    await expect.poll(() => Object.keys(fromWorker).sort()).toEqual(['/api/health', '/version.json'])
    expect(fromWorker).toEqual({ '/api/health': false, '/version.json': false })

    await context.setOffline(true)
    await page.goto('/offline-check', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveTitle('Auto Core · Offline')
    await expect(page.getByRole('heading', { name: 'Keine Verbindung' })).toBeVisible()
    await context.setOffline(false)
  })
})
