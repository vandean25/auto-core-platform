import { test, expect, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { DE_COMMON } from './helpers/de-common'
import { createMockListResponse, createMockWorkshopOrder } from './utils/mock-factories'
import deWorkshop from '../../../locales/de/workshop.json' with { type: 'json' }

const LIST_API_DELAY_MS = 900

async function fulfillAfterDelay(page: Page, apiPath: string, body: unknown) {
  await page.route(AutoCorePage.apiRouteMatcher(apiPath), async (route) => {
    await new Promise((resolve) => setTimeout(resolve, LIST_API_DELAY_MS))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
}

test.describe('AUT-971 skeleton settles when data arrives', () => {
  test('AUT-971 scenario 1: work-order list at 375px shows rows within 350ms of pager visibility', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const corePage = new AutoCorePage(page, deWorkshop.orders.list.newOrder)
    const order = createMockWorkshopOrder({ id: 'wo-aut-971', order_number: 'WO-971-01' })

    await fulfillAfterDelay(page, '/api/workshop/orders', createMockListResponse([order]))

    await corePage.navigate('/workshop/orders', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.animate-pulse').first()).toBeVisible({ timeout: 2_000 })
    await expect(page.getByText('WO-971-01')).toBeVisible({ timeout: 2_000 })
    const pagerNext = page.getByRole('button', { name: DE_COMMON.dataTable.next, exact: true })
    await pagerNext.scrollIntoViewIfNeeded()
    await expect(pagerNext).toBeVisible()
    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 350 })
  })

  test('AUT-971 scenario 4: planner at 375px clears skeleton within 350ms of planner data', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const corePage = new AutoCorePage(page, 'Planner')

    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/settings'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          timezone: 'Europe/Vienna',
          slotMinutes: 30,
          holidayCountryIso: 'AT',
          holidaySubdivisionCode: null,
          openingHours: [],
        }),
      })
    })

    await fulfillAfterDelay(page, '/api/workshop/planner', {
      timezone: 'Europe/Vienna',
      slotMinutes: 30,
      bays: [{ id: 'bay-1', name: 'Bay 1', isActive: true, sortOrder: 1 }],
      openings: [],
      holidays: [],
      bookings: [],
      employeesAway: [],
    })

    await corePage.navigate('/workshop/planner', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.animate-pulse').first()).toBeVisible({ timeout: 2_000 })
    await expect(page.getByText('Bay 1')).toBeVisible({ timeout: 2_000 })
    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 350 })
  })

  test('AUT-971 scenario 3: vehicles at 375px replace skeleton within 350ms of the API response', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const corePage = new AutoCorePage(page, 'Vehicle')

    await fulfillAfterDelay(page, '/api/vehicles', createMockListResponse([
      {
        id: 'veh-aut-971',
        make: 'VW',
        model: 'Golf',
        year: 2020,
        vin: 'VIN971',
        plate: 'W-971',
      },
    ]))

    await corePage.navigate('/vehicles', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.animate-pulse').first()).toBeVisible({ timeout: 2_000 })
    await expect(page.getByText('VW Golf')).toBeVisible({ timeout: 2_000 })
    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 350 })
  })

  test('AUT-971 scenario 6: estimates at 375px are not skeleton after the request completes', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const corePage = new AutoCorePage(page, '')
    await fulfillAfterDelay(page, '/api/workshop/estimates', {
      data: [
        {
          version_id: 'ver-971',
          estimate_number: 'KV-2026-0971',
          version: 1,
          status: 'SENT',
          order_id: 'order-971',
          order_number: 'WO-2026-0971',
          customer_id: 'cust-1',
          customer_name: 'Pilot customer',
          vehicle_plate: 'W-971',
          sent_at: '2026-10-01T08:00:00.000Z',
          valid_until: '2026-10-15T08:00:00.000Z',
          decided_at: null,
          total_gross: '500.00',
        },
      ],
      meta: { page_size: 25, next_cursor: null },
    })
    await corePage.navigate('/workshop/estimates', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-table-row="true"]').first()).toContainText('KV-2026-0971', { timeout: 2_500 })
    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 350 })
  })
})
