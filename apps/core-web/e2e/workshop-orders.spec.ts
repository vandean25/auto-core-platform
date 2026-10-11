import { expectNoCriticalA11yViolations } from "./utils/a11y";
import { test, expect } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockListResponse, createMockWorkshopOrder } from './utils/mock-factories'

test.describe('Workshop Orders list', () => {
  test('row link keeps a 24px minimum hit area', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Order')
    const order = createMockWorkshopOrder({
      id: 'workshop-order-hit-area-1',
      order_number: 'WO-2026-0310',
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/orders'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([order])),
      })
    })

    await corePage.navigate('/workshop/orders')
    await expect(corePage.dataTable).toBeVisible()

    const rowLink = page.getByRole('link', { name: 'Workshop order WO-2026-0310' })
    const box = await rowLink.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(24)
  })

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

    await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${order.id}`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(order),
      })
    })


    await corePage.navigate('/workshop/orders')
    await expect(corePage.dataTable).toBeVisible()
    await expectNoCriticalA11yViolations(page);
    await corePage.openRowDetails('WO-2026-0221')

    await page.waitForURL(`/workshop/orders/${order.id}`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: order.order_number })).toBeVisible()
    await expectNoCriticalA11yViolations(page);
  })

  test('opens the workshop order detail when the row link is activated with keyboard', async ({
    page,
  }) => {
    const corePage = new AutoCorePage(page, 'Order')
    const order = createMockWorkshopOrder({
      id: 'workshop-order-keyboard-1',
      order_number: 'WO-2026-0295',
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/orders'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([order])),
      })
    })

    await corePage.navigate('/workshop/orders')

    const orderLink = page.getByRole('link', { name: 'Workshop order WO-2026-0295' })
    await expect(orderLink).toBeVisible()
    await orderLink.focus()
    await page.keyboard.press('Enter')
    await page.waitForURL(`/workshop/orders/${order.id}`)
  })
})
