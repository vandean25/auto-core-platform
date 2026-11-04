import { expect, test, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import deVehicles from '../../../locales/de/vehicles.json' with { type: 'json' }
import deVehicleStock from '../../../locales/de/vehicleStock.json' with { type: 'json' }
import { createMockCustomer, createMockVehicleListItem, createMockVehicleStockRow } from './utils/mock-factories'
import { controlsOutsideTheirCard, controlsShorterThan44, expectNoPageScroll, PHONE_WIDTHS } from './utils/phone-layout'

/** AUT-792: the vehicle detail header stacks on a phone, the Pickerl actions wrap inside the card and the tabs fit. */
const vehicle = {
  ...createMockVehicleListItem({
    id: 'veh-detail-phone',
    year: 2005,
    make: 'QA r8 Testmarke QA r8Z',
    model: 'Modell 0025',
    plate: 'W-792QA',
  }),
  sales_orders: [],
  workshop_orders: [],
  invoices: [],
  customer: createMockCustomer({ first_name: 'Jane', last_name: 'Smith' }),
}

async function mockJson(page: Page, path: string, body: unknown) {
  await page.route(AutoCorePage.apiRouteMatcher(path), (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function openVehicle(page: Page) {
  await mockJson(page, `/api/vehicles/${vehicle.id}`, vehicle)
  await mockJson(page, `/api/vehicles/${vehicle.id}/parties`, { data: [], suggested_bill_to: null })
  await mockJson(page, `/api/vehicles/${vehicle.id}/inspection-records`, [])
  await mockJson(page, `/api/vehicles/${vehicle.id}/pickerl-open-order`, null)
  await mockJson(page, '/api/inspection-source-connections', { data: [{ id: 'conn-1' }] })
  await page.goto(`/vehicles/${vehicle.id}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

test.describe('Vehicle detail on a phone (AUT-792)', () => {
  for (const width of PHONE_WIDTHS) {
    test(`${width}px: title in at most 2 lines, actions below and fully visible, tabs stay on screen`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await openVehicle(page)

      const title = page.getByRole('heading', { level: 1 })
      const lineHeight = await title.evaluate((node) => parseFloat(getComputedStyle(node).lineHeight))
      expect((await title.boundingBox())!.height).toBeLessThanOrEqual(lineHeight * 2 + 1)

      for (const name of [deVehicles.detail.aria.goBack, deVehicles.detail.editVehicle, deVehicles.detail.serviceOrder]) {
        const box = (await page.getByRole('button', { name }).first().boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(width)
        expect(box.height).toBeGreaterThanOrEqual(44)
        expect(box.width).toBeGreaterThanOrEqual(44)
      }
      const titleBox = (await title.boundingBox())!
      const editBox = (await page.getByRole('button', { name: deVehicles.detail.editVehicle }).boundingBox())!
      expect(editBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height)

      const tabs = page.getByRole('tablist').first()
      const tabsBox = (await tabs.boundingBox())!
      expect(tabsBox.x + tabsBox.width).toBeLessThanOrEqual(width)
      for (const tab of await tabs.getByRole('tab').all()) {
        const box = (await tab.boundingBox())!
        expect(box.x + box.width).toBeLessThanOrEqual(width)
      }

      await expectNoPageScroll(page)
    })
  }

  test('375px: the Pickerl actions wrap inside their card and are 44 px high', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 844 })
    await openVehicle(page)

    const section = page.getByText(deVehicles.pickerlSection.title).first().locator('xpath=ancestor::div[contains(@class,"border-t")][1]')
    await expect(section.getByRole('button', { name: deVehicles.pickerlSection.recordPickerl })).toBeVisible()
    await expect(section.getByRole('button', { name: deVehicles.pickerlSection.createOrder })).toBeVisible()
    expect(await controlsOutsideTheirCard(section.locator('xpath=ancestor::div[contains(@class,"rounded")][1]'))).toEqual([])
    expect(await controlsShorterThan44(section)).toEqual([])
    await expectNoPageScroll(page)
  })

  test('desktop keeps the tab list as an inline pill that starts at the content edge', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await openVehicle(page)

    const tabs = page.getByRole('tablist').first()
    const tabsBox = (await tabs.boundingBox())!
    const firstTab = (await tabs.getByRole('tab').first().boundingBox())!
    expect(firstTab.x - tabsBox.x).toBeLessThan(12)
    expect(tabsBox.width).toBeLessThan(560)
  })

  test('desktop keeps title and actions on one row', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await openVehicle(page)

    const title = (await page.getByRole('heading', { level: 1 }).boundingBox())!
    const edit = (await page.getByRole('button', { name: deVehicles.detail.editVehicle }).boundingBox())!
    expect(edit.x).toBeGreaterThan(title.x + title.width)
    expect(Math.abs(edit.y - title.y)).toBeLessThan(60)
  })

  // AUT-659 scenario 5: the vehicle stock detail (token and PageHeader migration) keeps the phone layout.
  test('WHEN the vehicle stock detail opens at 375px THEN there is no horizontal scroll and targets are at least 44px', async ({ page }) => {
    const stock = createMockVehicleStockRow({ id: 'stock-phone-1' })
    await mockJson(page, `/api/vehicle-stock/${stock.id}`, {
      ...stock,
      cost_basis: '12345.60',
      key_number: null,
      registration_certificate_no: null,
      reserved_for_customer_id: null,
      reserved_for_customer: null,
      location_id: null,
      ledger_entries: [{ id: 'l1', entry_type: 'PURCHASE', amount: '12345.60' }],
      purchases: [],
      sales: [],
      workshop_orders: [],
    })
    await page.setViewportSize({ width: 375, height: 844 })
    await page.goto(`/vehicle-stock/${stock.id}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    for (const name of [deVehicleStock.stockDetail.backAria, deVehicleStock.listing.title, deVehicleStock.stockDetail.stockPrep, deVehicleStock.stockDetail.sell]) {
      const box = (await page.getByRole('button', { name }).first().boundingBox())!
      expect(box.x + box.width, name).toBeLessThanOrEqual(375)
      expect(box.height, name).toBeGreaterThanOrEqual(44)
    }
    await expectNoPageScroll(page)
  })
})
