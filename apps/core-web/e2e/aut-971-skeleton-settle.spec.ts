import { test, expect } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { DE_COMMON } from './helpers/de-common'
import { expectSkeletonDismissedBySettleDeadline, routeWithSettledAt } from './helpers/aut-971-skeleton-settle'
import { createMockListResponse, createMockWorkshopOrder } from './utils/mock-factories'
import deWorkshop from '../../../locales/de/workshop.json' with { type: 'json' }

test.describe('AUT-971 skeleton settles when data arrives', () => {
  test('AUT-971 scenario 1: work-order list at 375px dismisses skeleton within 350ms of the API response', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const corePage = new AutoCorePage(page, deWorkshop.orders.list.newOrder)
    const order = createMockWorkshopOrder({ id: 'wo-aut-971', order_number: 'WO-971-01' })
    const settledAt = await routeWithSettledAt(page, '/api/workshop/orders', createMockListResponse([order]))

    await corePage.navigate('/workshop/orders', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.animate-pulse').first()).toBeVisible({ timeout: 2_000 })
    await expectSkeletonDismissedBySettleDeadline(page, settledAt)
    await expect(page.getByText('WO-971-01')).toBeVisible({ timeout: 2_000 })
    const pagerNext = page.getByRole('button', { name: DE_COMMON.dataTable.next, exact: true })
    await pagerNext.scrollIntoViewIfNeeded()
    await expect(pagerNext).toBeVisible()
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

    const settledAt = await routeWithSettledAt(page, '/api/workshop/planner', {
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
    await expectSkeletonDismissedBySettleDeadline(page, settledAt)
    await expect(page.getByText('Bay 1')).toBeVisible({ timeout: 2_000 })
  })

  test('AUT-971 scenario 3: vehicles at 375px replace skeleton within 350ms of the API response', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const corePage = new AutoCorePage(page, 'Vehicle')

    const settledAt = await routeWithSettledAt(
      page,
      '/api/vehicles',
      createMockListResponse([
        {
          id: 'veh-aut-971',
          make: 'VW',
          model: 'Golf',
          year: 2020,
          vin: 'VIN971',
          plate: 'W-971',
        },
      ]),
    )

    await corePage.navigate('/vehicles', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.animate-pulse').first()).toBeVisible({ timeout: 2_000 })
    await expectSkeletonDismissedBySettleDeadline(page, settledAt)
    await expect(page.getByText('VW Golf')).toBeVisible({ timeout: 2_000 })
  })

  test('AUT-971 scenario 5: Pickerl due list at 375px dismisses skeleton within 350ms of the API response', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const corePage = new AutoCorePage(page, '')
    const settledAt = await routeWithSettledAt(page, '/api/vehicles/pickerl-due', {
      data: [
        {
          id: 'veh-p971',
          make: 'VW',
          model: 'Golf',
          plate: 'W-P971',
          year: 2020,
          pickerl_due: { status: 'DUE_SOON', due_month: '2026-11' },
        },
      ],
      meta: { total: 1, pageCount: 1 },
    })
    await corePage.navigate('/vehicles/pickerl-due?filter_window=30', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.animate-pulse').first()).toBeVisible({ timeout: 2_000 })
    await expectSkeletonDismissedBySettleDeadline(page, settledAt)
    await expect(page.getByText('W-P971')).toBeVisible({ timeout: 2_000 })
  })

  test('AUT-971 scenario 6: estimates at 375px clear loading within 350ms of the API response', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const corePage = new AutoCorePage(page, '')
    const settledAt = await routeWithSettledAt(
      page,
      '/api/workshop/estimates',
      {
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
      },
    )
    await corePage.navigate('/workshop/estimates', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('tbody .animate-pulse').first()).toBeVisible({ timeout: 2_000 })
    await expectSkeletonDismissedBySettleDeadline(page, settledAt, { scope: 'tbody' })
    await expect(page.locator('[data-table-row="true"]').first()).toContainText('KV-2026-0971', { timeout: 2_000 })
  })
})
