import { test, expect, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { DE_INVENTORY } from './helpers/de-inventory'
import { createMockListResponse } from './utils/mock-factories'
import { expectNoPageScroll } from './utils/phone-layout'
import deWorkshop from '../../../locales/de/workshop.json' with { type: 'json' }

/** AUT-753: field spacing, visible labels and the add-row input fit a phone (375px). */
const PHONE = { width: 375, height: 812 }
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
const site = { id: 'site-1', code: 'WIE', name: 'Wien', legalEntityId: 'entity-1', legalEntityName: 'Demo GmbH' }

async function mockList(page: Page, path: string) {
  await page.route(AutoCorePage.apiRouteMatcher(path), (route) => route.fulfill(json(createMockListResponse([]))))
}

test.describe('Dialog fields on a phone (AUT-753)', () => {
  test.use({ viewport: PHONE })

  test('Umlagerung anfordern: site selects show a value, parts search is not tight under them', async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher('/api/me/sites'), (route) => route.fulfill(json([site])))
    await page.route(AutoCorePage.apiRouteMatcher('/api/sites'), (route) => route.fulfill(json([site])))
    await page.route(AutoCorePage.apiRouteMatcher('/api/stock-transfers'), (route) => route.fulfill(json([])))
    await page.route(AutoCorePage.apiRouteMatcher('/api/inventory/locations'), (route) => route.fulfill(json([])))
    const corePage = new AutoCorePage(page, DE_INVENTORY.stockTransfers.list.newTransfer)
    await corePage.navigate('/stock-transfers')
    await corePage.createButton.click()

    const dialog = page.getByRole('dialog')
    const create = DE_INVENTORY.stockTransfers.create
    for (const label of [create.fromSite, create.toSite]) {
      const trigger = dialog.getByLabel(label)
      await expect(trigger).toBeVisible()
      // A selected site name or the placeholder: never an empty box.
      expect((await trigger.innerText()).trim(), `${label} select text`).not.toBe('')
    }
    const toBox = (await dialog.getByLabel(create.toSite).boundingBox())!
    const searchLabel = (await dialog.getByText(create.addParts, { exact: true }).boundingBox())!
    expect(searchLabel.y - (toBox.y + toBox.height), 'space between the sites and the parts search').toBeGreaterThanOrEqual(12)
    await expectNoPageScroll(page)
  })

  test('Werkstattauftrag anlegen: odometer and fuel level have visible labels', async ({ page }) => {
    await mockList(page, '/api/workshop/orders')
    await new AutoCorePage(page, deWorkshop.orders.list.newOrder).navigate('/workshop/orders')
    await page.getByRole('button', { name: deWorkshop.orders.list.newOrder, exact: true }).click()

    const dialog = page.getByRole('dialog')
    for (const field of [deWorkshop.orderIntake.odometerPlaceholder, deWorkshop.orderIntake.fuelPlaceholder]) {
      const input = dialog.getByLabel(field, { exact: true })
      await input.fill('42')
      // The label stays visible once the placeholder is gone.
      await expect(dialog.locator('label', { hasText: field })).toBeVisible()
    }
    await expectNoPageScroll(page)
  })

  test('Eingangsrechnung neu: the add-row item input shows its whole hint', async ({ page }) => {
    await mockList(page, '/api/vendors')
    await new AutoCorePage(page, '').navigate('/purchase-bills/new')
    const input = page.getByPlaceholder('Zuerst einen Lieferanten wählen')
    await expect(input).toBeVisible()
    const box = (await input.boundingBox())!
    expect(box.width, 'item input width').toBeGreaterThanOrEqual(240)
    expect(box.height, 'item input height').toBeGreaterThanOrEqual(44)
    await expectNoPageScroll(page)
  })
})
