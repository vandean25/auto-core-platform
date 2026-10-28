import { expect, test, type Page } from '@playwright/test'

// Runs on the real production build (`npm run build:pwa`, project `chromium-pwa`): the e2e bundle never registers the service worker.

async function waitForControllingWorker(page: Page) {
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/')
    return Boolean(registration?.active && navigator.serviceWorker.controller)
  })
}

/** A navigation right after the worker took control can still fail once while it is starting; the worker answers the next one. */
async function gotoOffline(page: Page) {
  await expect(async () => {
    await page.goto('/offline-check', { waitUntil: 'domcontentloaded' })
  }).toPass({ timeout: 10_000 })
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

    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(['acp-shell-v1.0.0-pwa'])

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
    await gotoOffline(page)
    await expect(page).toHaveTitle('Auto Core · Offline')
    await expect(page.getByRole('heading', { name: 'Keine Verbindung' })).toBeVisible()
    // One language, and the logo is part of the page (AUT-785): the image needs no request, which fails offline.
    await expect(page.getByText('No connection')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Erneut versuchen', exact: true })).toBeVisible()
    await expect(page.locator('img')).toHaveJSProperty('complete', true)
    expect(await page.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
    await context.setOffline(false)
  })

  test('shows the offline page in English, and only English, when the app language is English', async ({ page, context }) => {
    await page.goto('/')
    await waitForControllingWorker(page)
    await page.evaluate(() => localStorage.setItem('acp:ui-language', 'en'))

    await context.setOffline(true)
    await gotoOffline(page)
    await expect(page.getByRole('heading', { name: 'No connection' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
    await expect(page.getByText('Keine Verbindung')).toHaveCount(0)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await context.setOffline(false)
  })
})
