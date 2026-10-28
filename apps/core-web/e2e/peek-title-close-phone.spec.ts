import { expect, test, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { DE_COMMON } from './helpers/de-common'
import { createMockCustomer, createMockListResponse, createMockVehicleListItem } from './utils/mock-factories'
import { expectNoPageScroll } from './utils/phone-layout'

/**
 * AUT-786: a long title in the peek sheet wraps before the close button instead of running under it.
 */
const longVehicle = createMockVehicleListItem({
  id: 'veh-long',
  make: 'Mercedes-Benz Sonderfahrzeuge und Aufbauten',
  model: 'Sprinter 519 CDI Hochdach Allrad Kastenwagen Langversion',
  plate: 'W-123456X',
})
const longCustomer = createMockCustomer({
  id: 'cust-long',
  first_name: 'Maximiliane-Theresia',
  last_name: 'Habsburg-Lothringen-Esterházy von Galántha',
  email: 'maximiliane@berge.at',
})

async function mockJson(page: Page, path: string | RegExp, body: unknown) {
  await page.route(AutoCorePage.apiRouteMatcher(path), (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function expectTitleClearOfClose(page: Page) {
  const sheet = page.getByTestId('entity-peek-sheet')
  const title = sheet.getByRole('heading').first()
  await expect(title).toBeVisible()
  const close = sheet.getByRole('button', { name: DE_COMMON.actions.close })
  const titleBox = (await title.boundingBox())!
  const closeBox = (await close.boundingBox())!
  expect(titleBox.x + titleBox.width, 'title ends before the close button').toBeLessThanOrEqual(closeBox.x)
  expect(titleBox.height, 'a long title wraps onto more lines').toBeGreaterThan(30)
  expect(closeBox.width).toBeGreaterThanOrEqual(44)
  await expectNoPageScroll(page)
}

for (const width of [375, 390]) {
  test.describe(`Peek title and close button at ${width}px (AUT-786)`, () => {
    test.use({ viewport: { width, height: 812 } })

    test('vehicle: a long title stays clear of the close button', async ({ page }) => {
      await mockJson(page, '/api/vehicles', createMockListResponse([longVehicle]))
      await mockJson(page, `/api/vehicles/${longVehicle.id}`, longVehicle)
      await page.goto(`/vehicles?peek=${longVehicle.id}`)
      await expectTitleClearOfClose(page)
    })

    test('customer: a long name stays clear of the close button', async ({ page }) => {
      await mockJson(page, '/api/customers', createMockListResponse([longCustomer]))
      await mockJson(page, `/api/customers/${longCustomer.id}`, longCustomer)
      await page.goto(`/customers?peek=${longCustomer.id}`)
      await expectTitleClearOfClose(page)
    })
  })
}
