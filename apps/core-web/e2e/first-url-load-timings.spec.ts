import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { createMockListResponse } from './utils/mock-factories'
import { e2eActiveScopeContextDigest, mockScopeContextHandshake } from './utils/scope-context-handshake'

const SIMULATED_API_RTT_MS = 80

type RouteTimingResult = {
  route: string
  readyMs: number
  fcpMs: number | null
  lcpMs: number | null
  domInteractiveMs: number | null
  workshopResourcesRequests: number
  responseToPaintMs?: number
  sawPageLoaderAfterShell?: boolean
}

const SAMPLE_PURCHASE_ORDER = {
  id: 'po-1',
  vendor_id: 'vendor-1',
  vendor: {
    id: 'vendor-1',
    name: 'Nordteile',
    email: 'nord@example.test',
    account_number: 'K-88',
    createdAt: '2026-11-08T00:00:00.000Z',
    updatedAt: '2026-11-08T00:00:00.000Z',
  },
  status: 'DRAFT',
  order_number: 'PO-9',
  items: [],
  createdAt: '2026-11-08T00:00:00.000Z',
}

const SAMPLE_INVOICE = {
  id: 'inv-1',
  invoice_number: 'RE-2026-001',
  date: '2026-11-08T00:00:00.000Z',
  status: 'DRAFT',
  total_gross: 120,
  customer: {
    id: 'cust-1',
    type: 'PERSON',
    first_name: 'Max',
    last_name: 'Mustermann',
    company_name: null,
  },
}

const SAMPLE_TYRE_SET = {
  id: 'tyre-set-1',
  customerId: 'cust-1',
  vehicleId: 'veh-1',
  siteId: 'site-1',
  locationId: 'loc-1',
  locationCode: 'RACK-A',
  label: 'WR-101',
  season: 'WINTER',
  tyreCount: 4,
  rimType: 'ALLOY',
  brand: null,
  model: null,
  dimension: '225/45 R18',
  dotCodes: [],
  treadDepthMm: null,
  conditionNotes: null,
  status: 'IN_STORAGE',
  storedSince: '2026-01-01',
  plannedSwapOn: '2026-03-01',
  binLabel: 'R3-F2-07',
  customerName: 'Max Mustermann',
  vehiclePlate: 'W-12345A',
  customerPhone: '+43123456789',
  customerEmail: 'test@example.com',
  events: [],
}

async function installPerfObservers(page: Page) {
  await page.addInitScript(() => {
    const perfState = {
      fcpMs: null as number | null,
      lcpMs: null as number | null,
      sawPageLoaderAfterShell: false,
    }
    ;(window as unknown as { __aut1025Perf?: typeof perfState }).__aut1025Perf = perfState

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'first-contentful-paint') {
            perfState.fcpMs = Math.round(entry.startTime)
          }
        }
      }).observe({ type: 'paint', buffered: true })

      new PerformanceObserver((list) => {
        const entries = list.getEntries()
        const last = entries[entries.length - 1]
        if (last) {
          perfState.lcpMs = Math.round(last.startTime)
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true })
    } catch {
      // PerformanceObserver types may be unavailable in restricted contexts.
    }

    const observer = new MutationObserver(() => {
      const main = document.querySelector('#main-content')
      if (!main) return
      const text = main.textContent ?? ''
      if (text.includes('Auto Core wird geladen') || text.includes('ACP')) {
        perfState.sawPageLoaderAfterShell = true
      }
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })
  })
}

async function readPerfMetrics(page: Page) {
  return page.evaluate(() => {
    const perfState = (
      window as unknown as {
        __aut1025Perf?: { fcpMs: number | null; lcpMs: number | null; sawPageLoaderAfterShell: boolean }
      }
    ).__aut1025Perf
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    return {
      fcpMs: perfState?.fcpMs ?? null,
      lcpMs: perfState?.lcpMs ?? null,
      domInteractiveMs: nav ? Math.round(nav.domInteractive) : null,
      sawPageLoaderAfterShell: perfState?.sawPageLoaderAfterShell ?? false,
    }
  })
}

async function setupApiMocks(page: Page, purchaseOrderDelayMs = SIMULATED_API_RTT_MS) {
  let workshopResourcesRequests = 0
  let poResponseAtMs: number | null = null

  await page.route('**/api/**', async (route) => {
    const url = route.request().url()
    const path = new URL(url).pathname
    const delayMs = path === '/api/purchase-orders' ? purchaseOrderDelayMs : SIMULATED_API_RTT_MS
    await new Promise((resolve) => setTimeout(resolve, delayMs))

    if (path === '/api/workshop/resources') {
      workshopResourcesRequests += 1
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      return
    }
    if (path === '/api/me/sites' || path === '/api/saved-views') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      return
    }
    if (path === '/api/reports/workshop-kpis') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], totals: { utilisation_percent: null, productivity_percent: null, closed_orders: 0 } }),
      })
      return
    }
    if (path === '/api/vehicle-stock/reports/stock-age') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], summary: { over_90_cost_basis: '0.00' } }),
      })
      return
    }
    if (path === '/api/sales/invoices/capped-count') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 1,
          isCapped: false,
          scopeContextDigest: e2eActiveScopeContextDigest(page),
        }),
      })
      return
    }
    if (path === '/api/sales/invoices') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [SAMPLE_INVOICE],
          meta: { nextCursor: null, hasNextPage: false },
          scopeContextDigest: e2eActiveScopeContextDigest(page),
        }),
      })
      return
    }
    if (path === '/api/invoices') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([SAMPLE_INVOICE]),
      })
      return
    }
    if (path === '/api/purchase-orders') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([SAMPLE_PURCHASE_ORDER])),
      })
      poResponseAtMs = Date.now()
      return
    }
    if (path === '/api/tyre-sets/due-for-swap') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      })
      return
    }
    if (path === '/api/tyre-sets') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([SAMPLE_TYRE_SET])),
      })
      return
    }
    if (path.startsWith('/api/vehicles/pickerl-due')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([])),
      })
      return
    }
    if (path.startsWith('/api/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
      })
    }
  })

  await mockScopeContextHandshake(page)

  return {
    getWorkshopResourcesRequests: () => workshopResourcesRequests,
    getPoResponseAtMs: () => poResponseAtMs,
  }
}

async function measureRoute(
  page: Page,
  testInfo: TestInfo,
  route: string,
  waitReady: (page: Page) => Promise<void>,
  options?: { purchaseOrderDelayMs?: number },
): Promise<RouteTimingResult> {
  await installPerfObservers(page)
  const tracker = await setupApiMocks(page, options?.purchaseOrderDelayMs)

  const startMs = Date.now()
  await page.goto(route)
  await waitReady(page)
  const readyMs = Date.now() - startMs
  const perf = await readPerfMetrics(page)
  const poResponseAtMs = tracker.getPoResponseAtMs()

  const entry: RouteTimingResult = {
    route,
    readyMs,
    fcpMs: perf.fcpMs,
    lcpMs: perf.lcpMs,
    domInteractiveMs: perf.domInteractiveMs,
    workshopResourcesRequests: tracker.getWorkshopResourcesRequests(),
    ...(poResponseAtMs !== null ? { responseToPaintMs: Date.now() - poResponseAtMs } : {}),
    ...(route === '/workshop/tyre-storage' ? { sawPageLoaderAfterShell: perf.sawPageLoaderAfterShell } : {}),
  }

  await testInfo.attach('aut-1025-first-url-load-timings', {
    body: JSON.stringify(entry, null, 2),
    contentType: 'application/json',
  })

  return entry
}

test.describe('AUT-1025 Scenario 1 & 4: hard URL load timings', () => {
  test('records /dashboard hard-load timings without spurious workshop/resources fetch', async ({ page }, testInfo) => {
    const dashboard = await measureRoute(page, testInfo, '/dashboard', async (p) => {
      await expect(p.locator('#main-content h1')).toBeVisible()
    })
    expect(dashboard.workshopResourcesRequests).toBe(0)
    expect(dashboard.readyMs).toBeLessThan(10_000)
  })

  test('records /sales/invoices hard-load timings without spurious workshop/resources fetch', async ({ page }, testInfo) => {
    const invoices = await measureRoute(page, testInfo, '/sales/invoices', async (p) => {
      await expect(p.getByText('RE-2026-001')).toBeVisible()
      await expect(p.getByRole('table')).not.toHaveAttribute('aria-busy', 'true')
    })
    expect(invoices.workshopResourcesRequests).toBe(0)
    expect(invoices.readyMs).toBeLessThan(10_000)
  })

  test('records /purchase-orders hard-load timings at 80 ms API RTT', async ({ page }, testInfo) => {
    const purchaseOrders = await measureRoute(page, testInfo, '/purchase-orders', async (p) => {
      await expect(p.getByRole('link', { name: 'PO-9' })).toBeVisible()
      await expect(p.getByRole('table')).not.toHaveAttribute('aria-busy', 'true')
    })
    expect(purchaseOrders.responseToPaintMs).toBeDefined()
    expect(purchaseOrders.responseToPaintMs!).toBeLessThan(1_000)
    expect(purchaseOrders.readyMs).toBeLessThan(10_000)
  })

  test('clears /purchase-orders skeleton immediately even when API exceeds 200 ms skeletonDelayMs', async ({ page }, testInfo) => {
    const purchaseOrders = await measureRoute(
      page,
      testInfo,
      '/purchase-orders',
      async (p) => {
        await expect(p.getByRole('link', { name: 'PO-9' })).toBeVisible()
        await expect(p.getByRole('table')).not.toHaveAttribute('aria-busy', 'true')
      },
      { purchaseOrderDelayMs: 250 },
    )
    expect(purchaseOrders.responseToPaintMs).toBeDefined()
    expect(purchaseOrders.responseToPaintMs!).toBeLessThan(1_000)
  })

  test('records /workshop/tyre-storage hard-load timings without PageLoader after shell', async ({ page }, testInfo) => {
    const tyreStorage = await measureRoute(page, testInfo, '/workshop/tyre-storage', async (p) => {
      await expect(p.getByText('WR-101')).toBeVisible()
      await expect(p.getByRole('table')).not.toHaveAttribute('aria-busy', 'true')
    })
    expect(tyreStorage.sawPageLoaderAfterShell).toBe(false)
    expect(tyreStorage.readyMs).toBeLessThan(10_000)
  })
})
