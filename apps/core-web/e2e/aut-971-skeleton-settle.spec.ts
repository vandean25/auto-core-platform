import { test, expect } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockListResponse, createMockWorkshopOrder } from './utils/mock-factories'
test.describe('AUT-971 skeleton settles when data arrives', () => {
  test('AUT-971: work-order list at 375px shows rows after pager, not lasting skeleton', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const corePage = new AutoCorePage(page, 'Order')
    const order = createMockWorkshopOrder({ id: 'wo-aut-971', order_number: 'WO-971-01' })

    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/orders'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([order])),
      })
    })

    await corePage.navigate('/workshop/orders')
    await expect(page.getByText(/Seite\s+1/)).toBeVisible()
    await expect(page.locator('tbody .animate-pulse')).toHaveCount(0, { timeout: 350 })
    await expect(page.getByText('WO-971-01')).toBeVisible()
  })

  test('AUT-971: workshop planner at 375px clears skeleton when planner data arrives', async ({ page }) => {
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

    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/planner'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          timezone: 'Europe/Vienna',
          slotMinutes: 30,
          bays: [{ id: 'bay-1', name: 'Bay 1', isActive: true, sortOrder: 1 }],
          openings: [],
          holidays: [],
          bookings: [],
          employeesAway: [],
        }),
      })
    })

    await corePage.navigate('/workshop/planner')
    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 350 })
  })

  test('AUT-971: vehicles list at 375px replaces skeleton when the API responds', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const corePage = new AutoCorePage(page, 'Vehicle')

    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
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
        ),
      })
    })

    await corePage.navigate('/vehicles')
    await expect(page.locator('tbody .animate-pulse')).toHaveCount(0, { timeout: 350 })
    await expect(page.getByText('VW Golf')).toBeVisible()
  })
})
