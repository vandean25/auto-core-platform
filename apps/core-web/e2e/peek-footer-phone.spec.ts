import { expect, test, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { DE_COMMON } from './helpers/de-common'
import { DE_CUSTOMERS } from './helpers/de-customers'
import {
  createMockCustomer,
  createMockListResponse,
  createMockVehicleListItem,
  createMockWorkshopOrder,
} from './utils/mock-factories'
import { controlsShorterThan44, expectNoPageScroll } from './utils/phone-layout'
import deWorkshop from '../../../locales/de/workshop.json' with { type: 'json' }

/**
 * AUT-783: the footer of the peek sheet is one row (Öffnen + ⋯) at most 80 px high on a phone, shows no destructive
 * action, and lists the registry actions except open in a bottom sheet.
 */
const customer = createMockCustomer({ id: 'cust-peek', first_name: 'Anna', last_name: 'Alpin', email: 'anna@berge.at' })
const vehicle = createMockVehicleListItem({ id: 'veh-peek', make: 'Honda', model: 'Civic', plate: 'HD-1234' })
const order = createMockWorkshopOrder({ id: 'order-peek', order_number: 'WO-2026-0783' })

async function mockJson(page: Page, path: string | RegExp, body: unknown) {
  await page.route(AutoCorePage.apiRouteMatcher(path), (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function expectOneRowFooter(page: Page) {
  const sheet = page.getByTestId('entity-peek-sheet')
  const open = sheet.getByRole('link', { name: DE_COMMON.peek.openInFull })
  await expect(open).toBeVisible()
  const footer = open.locator('xpath=..')
  const footerBox = (await footer.boundingBox())!
  expect(footerBox.height).toBeLessThanOrEqual(80)
  const openBox = (await open.boundingBox())!
  expect(openBox.height).toBeGreaterThanOrEqual(44)
  expect(footerBox.y + footerBox.height).toBeLessThanOrEqual(812)
  await expect(sheet.getByText(/^Aktionen$/)).toHaveCount(0)
  await expect(sheet.getByRole('button', { name: DE_CUSTOMERS.list.delete })).toHaveCount(0)
  await expectNoPageScroll(page)
  return { sheet, open, openBox }
}

test.describe('Peek sheet footer on a phone (AUT-783)', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('customer: Öffnen and ⋯ share one row, delete only inside the menu', async ({ page }) => {
    await mockJson(page, '/api/customers', createMockListResponse([customer]))
    await mockJson(page, `/api/customers/${customer.id}`, customer)
    await page.goto(`/customers?peek=${customer.id}`)

    const { sheet, openBox } = await expectOneRowFooter(page)
    const more = sheet.getByRole('button', { name: DE_COMMON.peek.moreActions })
    await expect(more).toBeVisible()
    const moreBox = (await more.boundingBox())!
    expect(moreBox.width).toBeGreaterThanOrEqual(44)
    expect(moreBox.height).toBeGreaterThanOrEqual(44)
    expect(Math.abs(moreBox.y - openBox.y)).toBeLessThan(2)
    expect(moreBox.x).toBeGreaterThan(openBox.x + openBox.width)
    expect(moreBox.x + moreBox.width).toBeLessThanOrEqual(375)
    await expect(sheet.getByRole('button', { name: new RegExp(`${DE_CUSTOMERS.list.actions.open}`) })).toHaveCount(0)

    await more.click()
    const menu = page.getByTestId('entity-peek-more-actions')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('button', { name: DE_CUSTOMERS.list.delete })).toBeVisible()
    expect(await controlsShorterThan44(menu)).toEqual([])
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(more).toBeFocused()
  })

  test('vehicle: only Öffnen, no ⋯', async ({ page }) => {
    await mockJson(page, '/api/vehicles', createMockListResponse([vehicle]))
    await mockJson(page, `/api/vehicles/${vehicle.id}`, {
      ...vehicle,
      sales_orders: [],
      workshop_orders: [],
      invoices: [],
      customer: null,
    })
    await page.goto(`/vehicles?peek=${vehicle.id}`)

    const { sheet } = await expectOneRowFooter(page)
    await expect(sheet.getByRole('button', { name: DE_COMMON.peek.moreActions })).toHaveCount(0)
  })

  test('work order: the menu lists the registry actions without Öffnen', async ({ page }) => {
    await mockJson(page, '/api/workshop/orders', createMockListResponse([order]))
    await mockJson(page, `/api/workshop/orders/${order.id}`, order)
    await page.goto(`/workshop/orders?peek=${order.id}`)

    const { sheet } = await expectOneRowFooter(page)
    await sheet.getByRole('button', { name: DE_COMMON.peek.moreActions }).click()
    const menu = page.getByTestId('entity-peek-more-actions')
    await expect(menu.getByRole('button', { name: deWorkshop.orders.list.actions.jobCardPdf })).toBeVisible()
    await expect(menu.getByRole('button', { name: deWorkshop.orders.list.actions.open })).toHaveCount(0)
  })
})
