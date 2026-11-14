import { expect, test, type Page } from '@playwright/test'
import { DE_SHELL } from './helpers/de-shell'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockListResponse } from './utils/mock-factories'
import { mockScopeContextHandshake } from './utils/scope-context-handshake'

const WO_CHUNK = /WorkshopOrderList-[\w-]+\.js$/
const VEHICLES_CHUNK = /VehicleList-[\w-]+\.js$/
const ESTIMATES_CHUNK = /WorkshopEstimateList-[\w-]+\.js$/
const PLANNER_CHUNK = /WorkshopPlannerPage-[\w-]+\.js$/

function trackChunkRequests(page: Page) {
  const counts = {
    workshopOrders: 0,
    vehicles: 0,
    workshopEstimates: 0,
    workshopPlanner: 0,
  }
  page.on('request', (req) => {
    const url = req.url()
    if (WO_CHUNK.test(url)) counts.workshopOrders += 1
    else if (VEHICLES_CHUNK.test(url)) counts.vehicles += 1
    else if (ESTIMATES_CHUNK.test(url)) counts.workshopEstimates += 1
    else if (PLANNER_CHUNK.test(url)) counts.workshopPlanner += 1
  })
  return counts
}

async function mockShellApis(page: Page) {
  await page.route(AutoCorePage.apiRouteMatcher('/api/me/sites'), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.route(AutoCorePage.apiRouteMatcher(/\/api\/vehicles\/pickerl-due/), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createMockListResponse([])),
    })
  })
  await page.route(AutoCorePage.apiRouteMatcher(/\/api\/vehicle-stock\/reports\/stock-age/), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], summary: { over_90_cost_basis: '0.00' } }),
    })
  })
  await page.route(AutoCorePage.apiRouteMatcher(/\/api\/workshop\/resources/), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.route(AutoCorePage.apiRouteMatcher(/\/api\/reports\/workshop-kpis/), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], totals: { utilisation_percent: null, productivity_percent: null, closed_orders: 0 } }),
    })
  })
}

test.describe('AUT-983: main-list route chunk prefetch', () => {
  test('Scenario 1: first click into WO list after hard reload starts GET /workshop/orders within 500 ms without waiting for chunk', async ({ page }) => {
    await mockShellApis(page)
    // The order list loads only with a validated scope context (ADR-0038, AUT-956).
    await mockScopeContextHandshake(page)
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/orders'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([])),
      })
    })

    const woChunkPrefetched = page.waitForResponse((res) => WO_CHUNK.test(res.url()) && res.status() === 200)
    await page.goto('/dashboard')
    await woChunkPrefetched

    const countsBeforeClick = trackChunkRequests(page)
    const woLink = page
      .getByRole('navigation', { name: DE_SHELL.mainNavigation })
      .getByRole('link', { name: DE_SHELL.modules.workshopOrders, exact: true })
    await woLink.scrollIntoViewIfNeeded()
    await expect(woLink).toBeVisible()

    const apiRequestPromise = page.waitForRequest((req) => req.url().includes('/api/workshop/orders'))
    await woLink.click()
    await apiRequestPromise

    await expect(page).toHaveURL(/\/workshop\/orders/)
    await expect(page.locator('#main-content')).toBeVisible()
    expect(countsBeforeClick.workshopOrders).toBe(0)
  })

  test('Scenario 2: when app is idle after login, chunks for WO list, vehicles, estimates and planner are requested once', async ({ page }) => {
    await mockShellApis(page)
    const counts = trackChunkRequests(page)

    await page.goto('/dashboard')

    await expect
      .poll(() => counts, { timeout: 5_000 })
      .toEqual({
        workshopOrders: 1,
        vehicles: 1,
        workshopEstimates: 1,
        workshopPlanner: 1,
      })
  })

  test('Scenario 3: hovering or focusing a main-list nav link before idle prefetch requests its chunk', async ({ page }) => {
    await mockShellApis(page)
    await page.addInitScript(() => {
      // Delay idle callback so hover/focus runs before idle prefetch.
      window.requestIdleCallback = ((cb: IdleRequestCallback) =>
        window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 10_000)) as typeof window.requestIdleCallback
    })
    const counts = trackChunkRequests(page)

    await page.goto('/dashboard')
    const vehiclesLink = page
      .getByRole('navigation', { name: DE_SHELL.mainNavigation })
      .getByRole('link', { name: 'Fahrzeuge', exact: true })
    await vehiclesLink.scrollIntoViewIfNeeded()
    await expect(vehiclesLink).toBeVisible()
    expect(counts.vehicles).toBe(0)

    const vehiclesChunkResponse = page.waitForResponse((res) => VEHICLES_CHUNK.test(res.url()))
    await vehiclesLink.focus()
    await vehiclesChunkResponse

    expect(counts.vehicles).toBe(1)
  })

  test('Scenario 4: unpermitted role (403) does not prefetch estimates chunk and route still shows 403', async ({ page }) => {
    await mockShellApis(page)
    await page.addInitScript(() => {
      window.localStorage.setItem('e2e-active-role', 'DEMO')
    })
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/estimates'), async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Forbidden', statusCode: 403 }),
      })
    })
    const counts = trackChunkRequests(page)

    await page.goto('/dashboard')
    await expect
      .poll(() => counts.workshopOrders, { timeout: 5_000 })
      .toBe(1)
    expect(counts.workshopEstimates).toBe(0)

    await page.goto('/workshop/estimates')
    await expect(page.getByRole('alert')).toBeVisible()
  })

  test('Scenario 5: when saveData is on, no idle prefetch happens and navigation shows immediate skeleton feedback', async ({ page }) => {
    await mockShellApis(page)
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'connection', {
        configurable: true,
        value: { saveData: true },
      })
    })

    let releaseWoChunk!: () => void
    const woChunkGate = new Promise<void>((resolve) => {
      releaseWoChunk = resolve
    })
    await page.route(WO_CHUNK, async (route) => {
      await woChunkGate
      await route.continue()
    })

    const counts = trackChunkRequests(page)
    await page.goto('/dashboard')
    await page.waitForTimeout(400)

    expect(counts).toEqual({
      workshopOrders: 0,
      vehicles: 0,
      workshopEstimates: 0,
      workshopPlanner: 0,
    })

    const woLink = page
      .getByRole('navigation', { name: DE_SHELL.mainNavigation })
      .getByRole('link', { name: DE_SHELL.modules.workshopOrders, exact: true })
    await woLink.scrollIntoViewIfNeeded()
    await woLink.click()

    await expect(page.locator('#main-content [aria-busy="true"]')).toBeVisible({ timeout: 1000 })
    await expect(page.locator('#main-content .animate-pulse').first()).toBeVisible({ timeout: 1000 })
    releaseWoChunk()
  })
})
