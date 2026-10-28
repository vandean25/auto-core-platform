import { expect, test } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockCustomer, createMockListResponse } from './utils/mock-factories'

/**
 * AUT-784: opening a peek adds exactly one history entry, so a single back (the Android back gesture) closes it and
 * returns to the list URL. Taps right after the list rendered used to leave a duplicate entry behind.
 */
const customer = createMockCustomer({ id: 'cust-back', first_name: 'Anna', last_name: 'Alpin', email: 'anna@berge.at' })

test.describe('Peek and the back gesture (AUT-784)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher('/api/customers'), (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createMockListResponse([customer])) }),
    )
    await page.route(AutoCorePage.apiRouteMatcher(`/api/customers/${customer.id}`), (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(customer) }),
    )
  })

  test('one back closes the peek on a list with a search and page param', async ({ page }) => {
    await page.goto('/customers?page=1&search=Anna')
    const row = page.getByText('Anna Alpin').first()
    await expect(row).toBeVisible()

    await row.click()
    await expect(page.getByTestId('entity-peek-sheet')).toBeVisible()
    await page.waitForTimeout(900)
    await page.goBack()

    await expect(page.getByTestId('entity-peek-sheet')).toHaveCount(0)
    await expect(page).not.toHaveURL(/[?&]peek=/)
  })

  for (const [name, viewport] of [
    ['phone', { width: 390, height: 844 }],
    ['desktop', { width: 1280, height: 800 }],
  ] as const) {
    for (const [delayName, delayMs] of [['right after the list rendered', 0], ['after the list settled', 900]] as const) {
      test(`${name}: one back closes the peek opened ${delayName}`, async ({ page }) => {
        await page.setViewportSize(viewport)
        await page.goto('/customers')
        const row = page.getByText('Anna Alpin').first()
        await expect(row).toBeVisible()
        if (delayMs) await page.waitForTimeout(delayMs)

        await row.click()
        await expect(page).toHaveURL(/[?&]peek=cust-back/)
        const sheet = page.getByTestId('entity-peek-sheet')
        await expect(sheet).toBeVisible()
        // Let the list's debounced URL sync run.
        await page.waitForTimeout(900)

        await page.goBack()

        await expect(sheet).toHaveCount(0)
        await expect(page).not.toHaveURL(/[?&]peek=/)
        await expect(page).toHaveURL(/\/customers/)
      })
    }
  }
})
