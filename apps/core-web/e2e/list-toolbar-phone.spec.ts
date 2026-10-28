import { test, expect, type Locator, type Page } from '@playwright/test'
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
import { expectNoPageScroll } from './utils/phone-layout'

/**
 * AUT-749: on a phone the list toolbar is two tidy rows: the search on its own row with its whole hint, and the
 * secondary actions (save view, dashboard, columns) together in one row, all the same size and height.
 */
const LISTS = [
  ['Kunden', '/customers', '/api/customers', () => createMockCustomer({ id: 'c1', first_name: 'Pilot', last_name: 'Customer' })],
  ['Fahrzeuge', '/vehicles', '/api/vehicles', () => createMockVehicleListItem({ make: 'Skoda', model: 'Octavia', plate: 'SK-1' })],
  ['Werkstattaufträge', '/workshop/orders', '/api/workshop/orders', () => createMockWorkshopOrder({ id: 'w1', order_number: 'WO-2026-0001' })],
  ['Lager', '/inventory', '/api/inventory', () => createMockInventoryItem({ id: 'i1', sku: 'SKU-1', name: 'Ölfilter' })],
  ['Lieferanten', '/vendors', '/api/vendors', () => createMockVendor({ id: 'v1', name: 'Teile GmbH' })],
  ['Bestellungen', '/purchase-orders', '/api/purchase-orders', () => createMockPurchaseOrder({ id: 'p1' })],
  ['Eingangsrechnungen', '/purchase-bills', '/api/purchase-invoices', () => createMockPurchaseBill({ id: 'b1' })],
  ['Kundenaufträge', '/sales-orders', '/api/sales-orders', () => createMockSalesOrder({ id: 's1' })],
] as const

async function boxes(locator: Locator) {
  const all = await locator.all()
  return Promise.all(all.map(async (node) => (await node.boundingBox())!))
}

async function mockList(page: Page, api: string, row: unknown) {
  await page.route(AutoCorePage.apiRouteMatcher(api), (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createMockListResponse([row])) }),
  )
}

for (const width of [375, 390]) {
  test.describe(`List toolbar on a phone at ${width}px (AUT-749)`, () => {
    test.use({ viewport: { width, height: 844 } })

    for (const [name, path, api, row] of LISTS) {
      test(`${name}: search on its own row, secondary actions in one row`, async ({ page }) => {
        await mockList(page, api, row())
        await new AutoCorePage(page, '').navigate(path)
        await expect(page.locator('[data-table-row="true"]').first()).toBeVisible()

        const toolbar = page.locator('[data-testid="data-table-toolbar"]')
        const search = toolbar.getByRole('textbox').first()
        const searchBox = (await search.boundingBox())!
        expect(searchBox.width, 'search is full width').toBeGreaterThanOrEqual(width - 60)

        const actions = toolbar.locator('[data-testid="data-table-toolbar-actions"] button:visible')
        const actionBoxes = await boxes(actions)
        expect(actionBoxes.length, 'secondary actions').toBeGreaterThanOrEqual(1)
        // One row, below the search, nothing sharing the search's row.
        const tops = actionBoxes.map((box) => Math.round(box.y))
        expect(new Set(tops).size, 'all actions on one row').toBe(1)
        expect(actionBoxes[0].y, 'actions below the search').toBeGreaterThan(searchBox.y + searchBox.height - 1)
        // Icon buttons of one size (44px touch targets), inside the screen, starting at the left edge like the search.
        for (const box of actionBoxes) {
          expect(box.height, 'touch target height').toBeGreaterThanOrEqual(44)
          expect(box.width, 'touch target width').toBeGreaterThanOrEqual(44)
          expect(box.width, 'icon only, no text beside the icon').toBeLessThanOrEqual(48)
          expect(box.x + box.width, 'inside the screen').toBeLessThanOrEqual(width)
        }
        expect(new Set(actionBoxes.map((box) => Math.round(box.height))).size, 'same height').toBe(1)
        expect(new Set(actionBoxes.map((box) => Math.round(box.width))).size, 'same width').toBe(1)
        expect(Math.abs(actionBoxes[0].x - searchBox.x), 'aligned with the search').toBeLessThanOrEqual(2)
        // Every icon button keeps a name for screen readers; the columns menu also shows it as a tooltip.
        await expect(toolbar.getByRole('button', { name: 'Spalten' })).toHaveAttribute('title', /Spalten/)
        await expect(toolbar.getByRole('button', { name: 'Zum Dashboard hinzufügen' }).or(toolbar.getByRole('button', { name: 'Spalten' }))).not.toHaveCount(0)
        await expectNoPageScroll(page)
      })
    }
  })
}
