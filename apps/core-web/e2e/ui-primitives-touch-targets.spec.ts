import { expect, test } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import deCustomers from '../../../locales/de/customers.json' with { type: 'json' }
import deVehicleStock from '../../../locales/de/vehicleStock.json' with { type: 'json' }
import deWorkshop from '../../../locales/de/workshop.json' with { type: 'json' }

const PHONE = { width: 375, height: 812 }
const DESKTOP = { width: 1280, height: 800 }

test.describe('UI primitives: 44px touch targets below sm (AUT-1058)', () => {
  test('default and icon Button reach 44px at 375px and keep desktop sizes at 1280px', async ({ page }, testInfo) => {
    await page.setViewportSize(PHONE)
    await new AutoCorePage(page, '').navigate('/workshop/capacity')

    const prevWeek = page.getByRole('button', { name: deWorkshop.capacity.page.previousWeek })
    const thisWeek = page.getByRole('button', { name: deWorkshop.capacity.page.thisWeek })
    await expect(prevWeek).toBeVisible()
    await expect(thisWeek).toBeVisible()

    const prevPhone = (await prevWeek.boundingBox())!
    const thisPhone = (await thisWeek.boundingBox())!
    expect(prevPhone.width, 'icon button width at 375px').toBeGreaterThanOrEqual(44)
    expect(prevPhone.height, 'icon button height at 375px').toBeGreaterThanOrEqual(44)
    expect(thisPhone.height, 'default button height at 375px').toBeGreaterThanOrEqual(44)
    await testInfo.attach('primitives-button-icon-de-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    await page.setViewportSize(DESKTOP)
    await expect(prevWeek).toBeVisible()
    const prevDesktop = (await prevWeek.boundingBox())!
    const thisDesktop = (await thisWeek.boundingBox())!
    expect(Math.round(prevDesktop.width), 'icon button width at 1280px').toBe(36)
    expect(Math.round(prevDesktop.height), 'icon button height at 1280px').toBe(36)
    expect(Math.round(thisDesktop.height), 'default button height at 1280px').toBe(36)
    await testInfo.attach('primitives-button-icon-de-1280', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })

  test('sm Button and SelectTrigger reach 44px at 375px and keep desktop sizes at 1280px', async ({ page }, testInfo) => {
    await page.route(/\/api\/vehicle-stock(\/reports.*)?(\?|$)/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [],
          meta: { total: 0, page: 1, limit: 20, pageCount: 1 },
          summary: { over_90_count: 0, bucket_counts: {} },
        }),
      }),
    )

    await page.setViewportSize(PHONE)
    await new AutoCorePage(page, '').navigate('/vehicle-stock/reports')

    const smButton = page.getByRole('button', { name: deVehicleStock.reports.filtersAll, exact: true })
    const selectTrigger = page.getByRole('combobox', { name: deVehicleStock.reports.inventoryRolePlaceholder })
    await expect(smButton).toBeVisible()
    await expect(selectTrigger).toBeVisible()

    const smPhone = (await smButton.boundingBox())!
    const selectPhone = (await selectTrigger.boundingBox())!
    expect(smPhone.height, 'sm button height at 375px').toBeGreaterThanOrEqual(44)
    expect(selectPhone.height, 'SelectTrigger height at 375px').toBeGreaterThanOrEqual(44)
    await testInfo.attach('primitives-button-sm-select-de-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    await page.setViewportSize(DESKTOP)
    await expect(smButton).toBeVisible()
    const smDesktop = (await smButton.boundingBox())!
    const selectDesktop = (await selectTrigger.boundingBox())!
    expect(Math.round(smDesktop.height), 'sm button height at 1280px').toBe(32)
    expect(Math.round(selectDesktop.height), 'SelectTrigger height at 1280px').toBe(40)
    await testInfo.attach('primitives-button-sm-select-de-1280', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })

  test('Input reaches 44px at 375px and keeps desktop height at 1280px', async ({ page }, testInfo) => {
    await page.route(/\/api\/customers(\?|$)/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], meta: { total: 0, page: 1, limit: 20, pageCount: 1 } }),
      }),
    )

    await page.setViewportSize(PHONE)
    await new AutoCorePage(page, '').navigate('/customers?action=create')

    const firstNameInput = page.getByRole('dialog').getByLabel(deCustomers.dialog.firstName)
    await expect(firstNameInput).toBeVisible()

    const inputPhone = (await firstNameInput.boundingBox())!
    expect(inputPhone.height, 'Input height at 375px').toBeGreaterThanOrEqual(44)
    await testInfo.attach('primitives-input-de-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    await page.setViewportSize(DESKTOP)
    await expect(firstNameInput).toBeVisible()
    const inputDesktop = (await firstNameInput.boundingBox())!
    expect(Math.round(inputDesktop.height), 'Input height at 1280px').toBe(36)
    await testInfo.attach('primitives-input-de-1280', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })

  test('dense opt-out keeps sm Button (32px) and SelectTrigger (40px) compact at 375px', async ({ page }, testInfo) => {
    await page.route(/\/api\/vehicle-stock(\/reports.*)?(\?|$)/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [],
          meta: { total: 0, page: 1, limit: 20, pageCount: 1 },
          summary: { over_90_count: 0, bucket_counts: {} },
        }),
      }),
    )

    await page.setViewportSize(PHONE)
    await new AutoCorePage(page, '').navigate('/vehicle-stock/reports')

    const smButton = page.getByRole('button', { name: deVehicleStock.reports.filtersAll, exact: true })
    const selectTrigger = page.getByRole('combobox', { name: deVehicleStock.reports.inventoryRolePlaceholder })
    await expect(smButton).toBeVisible()
    await expect(selectTrigger).toBeVisible()

    for (const locator of [smButton, selectTrigger]) {
      await locator.evaluate((el) => {
        el.classList.remove('max-sm:min-h-11')
        el.classList.add('max-sm:min-h-0')
      })
    }

    const smBox = (await smButton.boundingBox())!
    const selectBox = (await selectTrigger.boundingBox())!
    expect(Math.round(smBox.height), 'opted-out sm button height at 375px').toBe(32)
    expect(Math.round(selectBox.height), 'opted-out SelectTrigger height at 375px').toBe(40)
    await testInfo.attach('primitives-opt-out-dense-de-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })
})
