import { test, expect, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import {
  createMockCustomer,
  createMockInventoryItem,
  createMockListResponse,
  createMockPurchaseBill,
  createMockPurchaseOrder,
  createMockSalesOrder,
  createMockVehicleListItem,
  createMockVendor,
  createMockWorkshopOrder,
} from './utils/mock-factories'

/**
 * AUT-767: the search field of a list toolbar keeps the full row width after the rows have loaded, at 375 and
 * 390px, and after the window is resized (it collapsed to a sliver once results and toolbar buttons rendered).
 */
const LISTS = [
  ['Kunden', '/customers', '/api/customers', () => createMockCustomer({ id: 'c1', first_name: 'Pilot', last_name: 'Customer' })],
  ['Werkstattaufträge', '/workshop/orders', '/api/workshop/orders', () => createMockWorkshopOrder({ id: 'w1', order_number: 'WO-2026-0001' })],
  ['Fahrzeuge', '/vehicles', '/api/vehicles', () => createMockVehicleListItem({ make: 'Skoda', model: 'Octavia', plate: 'SK-1' })],
  ['Lager', '/inventory', '/api/inventory', () => createMockInventoryItem({ id: 'i1', sku: 'SKU-1', name: 'Ölfilter' })],
  ['Lieferanten', '/vendors', '/api/vendors', () => createMockVendor({ id: 'v1', name: 'Teile GmbH' })],
  ['Bestellungen', '/purchase-orders', '/api/purchase-orders', () => createMockPurchaseOrder({ id: 'p1' })],
  ['Eingangsrechnungen', '/purchase-bills', '/api/purchase-invoices', () => createMockPurchaseBill({ id: 'b1' })],
  ['Kundenaufträge', '/sales-orders', '/api/sales-orders', () => createMockSalesOrder({ id: 's1' })],
] as const

async function searchWidth(page: Page) {
  const search = page.locator('main').getByRole('textbox').first()
  await expect(search).toBeVisible()
  return (await search.boundingBox())!.width
}

test.describe('List search width on a phone (AUT-767)', () => {
  for (const [name, path, api, row] of LISTS) {
    test(`${name}: the search field is full width after load and after a resize`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.route(AutoCorePage.apiRouteMatcher(api), (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createMockListResponse([row()])) }),
      )
      await new AutoCorePage(page, '').navigate(path)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('[data-table-row="true"]').first()).toBeVisible()

      expect(await searchWidth(page), 'at 390px after load').toBeGreaterThanOrEqual(340)
      await page.setViewportSize({ width: 375, height: 812 })
      expect(await searchWidth(page), 'at 375px after a resize').toBeGreaterThanOrEqual(325)
      await page.setViewportSize({ width: 390, height: 844 })
      expect(await searchWidth(page), 'back at 390px').toBeGreaterThanOrEqual(340)
    })
  }
})
