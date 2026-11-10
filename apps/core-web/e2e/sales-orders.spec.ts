import { test, expect } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockListResponse, createMockSalesOrder } from './utils/mock-factories'
import deCommon from '../../../locales/de/common.json' with { type: 'json' }
import deSales from '../../../locales/de/sales.json' with { type: 'json' }

const PHONE = { width: 375, height: 812 }

test.describe('Sales orders delete (AUT-933)', () => {
  test.use({ viewport: PHONE })

  test('delete via sheet at 375px', async ({ page }) => {
    const order = createMockSalesOrder({ id: 'so-phone-1', order_number: 'SO-2026-0901', status: 'DRAFT' })
    let deleted = false

    await page.route(AutoCorePage.apiRouteMatcher('/api/sales-orders'), async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createMockListResponse([order])),
        })
        return
      }
      await route.continue()
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/sales-orders/so-phone-1'), async (route) => {
      if (route.request().method() === 'DELETE') {
        deleted = true
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
        return
      }
      await route.continue()
    })

    await new AutoCorePage(page, deSales.orders.list.title).navigate('/sales-orders')

    const row = page.locator('[data-table-row="true"]').filter({ hasText: 'SO-2026-0901' })
    await expect(row).toBeVisible()

    const trigger = row.getByRole('button', {
      name: deCommon.dataTable.rowActions,
    })
    const box = await trigger.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)

    await trigger.click()
    await page.getByRole('menuitem', { name: deSales.shared.delete }).click()
    await page.getByRole('button', { name: deSales.shared.delete, exact: true }).click()

    await expect.poll(() => deleted).toBe(true)
  })
})
