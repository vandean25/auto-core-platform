import { expectNoCriticalA11yViolations } from "./utils/a11y";
import { test, expect } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockListResponse, createMockWorkshopOrder } from './utils/mock-factories'
import { mockCursorList, requestedBlocks } from './utils/cursor-list-mock'
import { pageOverflow } from './utils/phone-layout'
import { DE_COMMON } from './helpers/de-common'
import { DE_WORKSHOP } from './helpers/de-workshop'
import { expectListPeekForRecord, openListPeekInFull } from './helpers/peek-list'

function workshopOrderRowLinkName(orderNo: string) {
  return DE_WORKSHOP.orders.list.rowAria.replace('{{orderNo}}', orderNo)
}

test.describe('Workshop Orders list', () => {
  test('row link keeps a 24px minimum hit area', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Order')
    const order = createMockWorkshopOrder({
      id: 'workshop-order-hit-area-1',
      order_number: 'WO-2026-0310',
    })

    await mockCursorList(page, { path: '/api/workshop/orders', rows: [order] })

    await corePage.navigate('/workshop/orders')
    await expect(corePage.dataTable).toBeVisible()

    const rowLink = page.getByRole('link', { name: workshopOrderRowLinkName('WO-2026-0310') })
    const box = await rowLink.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(24)
  })

  test('opens the workshop order peek when a row is clicked and Open in full reaches detail', async ({ page }) => {
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

    await mockCursorList(page, { path: '/api/workshop/orders', rows: [order] })

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

    const row = page.locator('[data-table-row="true"]').filter({ hasText: 'WO-2026-0221' }).first()
    await row.locator('[data-column-id="vehicle"]').click()

    await expectListPeekForRecord(page, order.id, order.order_number)
    await openListPeekInFull(page)

    await page.waitForURL(`/workshop/orders/${order.id}`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('entity-peek-sheet')).not.toBeAttached()
    await expect(page.getByRole('heading', { name: order.order_number })).toBeVisible()
    await expect(page.locator('.lg\\:col-span-1')).toHaveCSS('opacity', '1')
    await expect(page.locator('.lg\\:col-span-2')).toHaveCSS('opacity', '1')
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

    await mockCursorList(page, { path: '/api/workshop/orders', rows: [order] })

    await corePage.navigate('/workshop/orders')

    const orderLink = page.getByRole('link', { name: workshopOrderRowLinkName('WO-2026-0295') })
    await expect(orderLink).toBeVisible()
    await orderLink.focus()
    await page.keyboard.press('Enter')
    await page.waitForURL(`/workshop/orders/${order.id}`)
  })

  test('requests GET /api/me/sites exactly once on hard reload', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Order')
    let meSitesRequests = 0

    await page.route(AutoCorePage.apiRouteMatcher('/api/me/sites'), async (route) => {
      if (route.request().method() === 'GET') {
        meSitesRequests += 1
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 'e2e-site-id', code: 'W', name: 'Wien', legalEntityId: 'le-1' }]),
      })
    })
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/orders'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([])),
      })
    })

    await corePage.navigate('/workshop/orders')
    await expect(corePage.dataTable).toBeVisible()

    meSitesRequests = 0
    await page.reload()
    await expect(corePage.dataTable).toBeVisible()
    await page.waitForLoadState('networkidle')

    expect(meSitesRequests).toBe(1)
  })

  test.describe('at 375px', () => {
    test.use({ viewport: { width: 375, height: 812 } })

    // Scenario 5 (AUT-956): the default sort scrolls in blocks of 50 instead of pages; regression = page buttons or a
    // second block that never loads on a phone.
    test('infinite next block', async ({ page }) => {
      const orders = Array.from({ length: 60 }, (_, index) =>
        createMockWorkshopOrder({
          id: `workshop-order-infinite-${index}`,
          order_number: `WO-2026-${String(1000 + index)}`,
        }),
      )
      const requests = await mockCursorList(page, { path: '/api/workshop/orders', rows: orders })

      await new AutoCorePage(page, 'Order').navigate('/workshop/orders')
      await expect(page.locator('li[data-table-row="true"]').first()).toBeVisible()
      await expect(page.getByTestId('data-table-count')).toHaveText('60 Treffer')
      expect(Object.fromEntries(requests.list[0].searchParams)).toEqual({ pagination: 'cursor', limit: '50' })
      await expect(page.getByRole('combobox', { name: DE_COMMON.dataTable.rowsPerPageAria })).toHaveCount(0)

      const loadMore = page.getByRole('button', { name: DE_COMMON.dataTable.infinite.loadMore })
      await expect(loadMore).toBeVisible()
      expect((await loadMore.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
      expect(await pageOverflow(page)).toBe(0)

      await expect(async () => {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        expect(requestedBlocks(requests).has('offset:50')).toBe(true)
      }).toPass()
      await expect(page.getByText('WO-2026-1059')).toBeAttached()
    })
  })
})
