import { test } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockListResponse, createMockWorkshopOrder } from './utils/mock-factories'

test.describe('Workshop Orders list', () => {
  test('opens the workshop order detail when a row is clicked', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Order')
    const order = createMockWorkshopOrder({
      id: 'workshop-order-click-1',
      order_number: 'WO-2026-0221',
      vehicle: {
        id: 'vehicle-click-1',
        make: 'Toyota',
        model: 'Corolla',
        year: 2021,
        plate: 'W-221AC',
      },
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/orders'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([order])),
      })
    })

    await corePage.navigate('/workshop/orders')
    await corePage.openRowDetails('WO-2026-0221')
    await page.waitForURL(`/workshop/orders/${order.id}`)
  })
})
