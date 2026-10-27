import { test, expect, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { controlsShorterThan44, expectNoPageScroll, PHONE_WIDTHS } from './utils/phone-layout'

/**
 * AUT-751: the header of a list page (title, subtitle, actions) never runs past the screen and never squeezes the
 * title into a sliver: the actions wrap below the title on a phone.
 */
// List endpoints behind the pages below; everything else (auth session, shell data) is left to the app's own mocks.
const LIST_ENDPOINTS =
  /\/api\/(invoices|vehicle-stock|purchase-bills|workshop\/loaner-vehicles|stock-transfers|credit-notes|vehicles|sales-orders|purchase-orders|inventory|vendors)(\?|$)/
const ARRAY_ENDPOINTS = /\/api\/stock-transfers(\?|$)/
const EMPTY_LIST = { data: [], meta: { total: 0, page: 1, limit: 20, pageCount: 1 } }

async function mockEmptyApi(page: Page) {
  await page.route(LIST_ENDPOINTS, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const body = ARRAY_ENDPOINTS.test(route.request().url()) ? [] : EMPTY_LIST
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

const PAGES = [
  ['Rechnungen', '/sales/invoices'],
  ['Fahrzeugbestand', '/vehicle-stock'],
  ['Bestandsberichte', '/vehicle-stock/reports'],
  ['Eingangsrechnungen', '/purchase-bills'],
  ['Ersatzfahrzeuge', '/workshop/loaner-vehicles'],
  ['Umlagerungen', '/stock-transfers'],
  ['Gutschriften', '/finance/credit-notes'],
  ['Fahrzeuge', '/vehicles'],
  ['Exportbereitschaft', '/finance/accounting-export-readiness'],
  ['Verkaufsaufträge', '/sales-orders'],
  ['Bestellungen', '/purchase-orders'],
  ['Lagerartikel', '/inventory'],
  ['Lieferanten', '/vendors'],
] as const

test.describe('Page headers on a phone (AUT-751)', () => {
  for (const width of PHONE_WIDTHS) {
    for (const [name, path] of PAGES) {
      test(`${name} header fits at ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 812 })
        await mockEmptyApi(page)
        await new AutoCorePage(page, '').navigate(path)
        const title = page.getByRole('heading', { level: 1 }).first()
        await expect(title).toBeVisible()

        await expectNoPageScroll(page)

        // The title block keeps a readable width: the actions wrap below it instead of squeezing it.
        const block = (await title.locator('xpath=..').boundingBox())!
        expect(block.width, 'title block width').toBeGreaterThanOrEqual(width - 80)
        expect(await controlsShorterThan44(title.locator('xpath=../..')), 'header controls under 44px').toEqual([])
        await testInfo.attach(`${name}-${width}`, { body: await page.screenshot(), contentType: 'image/png' })
      })
    }
  }

  // QA could not tell whether the clipped create buttons worked: on a phone they are visible and open their form.
  for (const [path, label, target] of [
    ['/vehicle-stock', 'Fahrzeug', /\/vehicle-stock\/purchases\/new$/],
    ['/purchase-bills', 'Rechnung', /\/purchase-bills\/new$/],
  ] as const) {
    test(`+ ${label} on ${path} is tappable at 375px`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 })
      await mockEmptyApi(page)
      await new AutoCorePage(page, '').navigate(path)
      await new AutoCorePage(page, label).createButton.click()
      await expect(page).toHaveURL(target)
    })
  }

  for (const [name, path] of PAGES) {
    test(`${name} header stays one row on a desktop`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await mockEmptyApi(page)
      await new AutoCorePage(page, '').navigate(path)
      const title = page.getByRole('heading', { level: 1 }).first()
      await expect(title).toBeVisible()

      const titleBox = (await title.boundingBox())!
      const action = title.locator('xpath=../..').getByRole('button').or(title.locator('xpath=../..').getByRole('link')).first()
      if ((await action.count()) === 0) return
      const actionBox = (await action.boundingBox())!
      // Same row as the title, on the right.
      expect(actionBox.y).toBeLessThan(titleBox.y + titleBox.height)
      expect(actionBox.x).toBeGreaterThan(titleBox.x + titleBox.width)
    })
  }
})
