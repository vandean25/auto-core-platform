import { expect, test, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { expectNoHeadingOrderViolations } from './utils/a11y'
import {
  createMockCustomerDetailResponse,
  createMockSalesOrder,
  createMockWorkshopOrder,
} from './utils/mock-factories'
import { DE_WORKSHOP } from './helpers/de-workshop'
import { DE_SALES } from './helpers/de-sales'
import { DE_CUSTOMERS } from './helpers/de-customers'
import { DE_INVENTORY } from './helpers/de-inventory'
import { DE_SETTINGS } from './helpers/de-settings'
import {
  createMockBrand,
  createMockFinanceSettings,
  createMockListResponse,
  createMockRevenueGroup,
} from './utils/mock-factories'

/**
 * AUT-472: heading levels on the detail pages. A card directly under the page h1 is an h2 (the
 * CardTitle default) and a section under another heading nests one level deeper. axe
 * `heading-order` must stay clean, so no h1 → h3 jump.
 */

type WorkshopOrderFixture = ReturnType<typeof createMockWorkshopOrder>

async function mockWorkshopOrder(page: Page, order: WorkshopOrderFixture) {
  await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${order.id}`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(order),
    })
  })

  // Estimate load fails on purpose, so the "not available" alert renders inside the estimate card.
  await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${order.id}/estimates`), async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Estimate unavailable' }),
    })
  })
}

test.describe('Heading order on detail pages', () => {
  test('sales order detail has no heading-order violations', async ({ page }) => {
    const order = {
      ...createMockSalesOrder({ id: 'so-heading-1', order_number: 'SO-2026-0901' }),
      // The detail page also reads these; the shared factory leaves them out.
      items: [],
      notes: null,
    }

    await page.route(AutoCorePage.apiRouteMatcher(`/api/sales-orders/${order.id}`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(order),
      })
    })

    await page.goto(`/sales-orders/${order.id}`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { level: 1, name: order.order_number })).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 2, name: DE_SALES.orders.detail.customer, exact: true }),
    ).toBeVisible()
    await expectNoHeadingOrderViolations(page)
  })

  test('customer detail has no heading-order violations', async ({ page }) => {
    const customerId = 'cust-heading-1'
    const detail = createMockCustomerDetailResponse({
      id: customerId,
      first_name: 'Jane',
      last_name: 'Smith',
    })

    await page.route(AutoCorePage.apiRouteMatcher(`/api/customers/${customerId}`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail),
      })
    })

    await page.goto(`/customers/${customerId}`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { level: 1, name: 'Jane Smith' })).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 2, name: DE_CUSTOMERS.detail.contactInformation, exact: true }),
    ).toBeVisible()
    // Tyre storage sits inside the Contact Information card, so it nests as h3.
    await expect(
      page.getByRole('heading', { level: 3, name: DE_INVENTORY.tyreStorage.summary.title, exact: true }),
    ).toBeVisible()
    await expectNoHeadingOrderViolations(page)
  })

  test('workshop order detail has no heading-order violations', async ({ page }) => {
    const order = createMockWorkshopOrder({ id: 'ws-heading-1', order_number: 'WO-2026-0901' })
    await mockWorkshopOrder(page, order)

    await page.goto(`/workshop/orders/${order.id}`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { level: 1, name: order.order_number })).toBeVisible()
    // Tyre storage is a top-level section under the page h1, so it is h2 on this page.
    await expect(
      page.getByRole('heading', { level: 2, name: DE_INVENTORY.tyreStorage.summary.title, exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 2, name: DE_WORKSHOP.orderHeader.orderInfo, exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 3, name: 'Kostenvoranschlag nicht verfügbar', exact: true }),
    ).toBeVisible()
    await expectNoHeadingOrderViolations(page)
  })

  test('settings finance tab has no heading-order violations', async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher('/api/finance/settings'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockFinanceSettings()),
      })
    })
    await page.route(AutoCorePage.apiRouteMatcher('/api/finance/revenue-groups'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([createMockRevenueGroup({ name: 'Parts Revenue' })]),
      })
    })

    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { level: 1, name: DE_SETTINGS.page.title })).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 2, name: DE_SETTINGS.finance.fiscal.title, exact: true }),
    ).toBeVisible()
    await expectNoHeadingOrderViolations(page)
  })

  test('settings workshop hours tab has no heading-order violations', async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher('/api/finance/settings'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockFinanceSettings()),
      })
    })
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/settings'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          timezone: 'Europe/Vienna',
          slotMinutes: 30,
          holidayCountryIso: 'AT',
          holidaySubdivisionCode: null,
          openingHours: [
            { weekday: 1, isClosed: false, openTime: '08:00', closeTime: '17:00' },
          ],
        }),
      })
    })
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/holidays'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      })
    })

    await page.goto('/settings?tab=hours')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { level: 1, name: DE_SETTINGS.page.title })).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 2, name: DE_SETTINGS.workshopHours.title, exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 3, name: DE_SETTINGS.workshopHours.weekdaysTitle, exact: true }),
    ).toBeVisible()
    await expectNoHeadingOrderViolations(page)
  })

  test('settings brands tab has no heading-order violations', async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher('/api/finance/settings'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockFinanceSettings()),
      })
    })
    await page.route(AutoCorePage.apiRouteMatcher('/api/finance/revenue-groups'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })
    await page.route(AutoCorePage.apiRouteMatcher('/api/brands'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([createMockBrand({ name: 'Stellantis' })])),
      })
    })

    await page.goto('/settings?tab=brands')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { level: 1, name: DE_SETTINGS.page.title })).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 2, name: DE_SETTINGS.brands.title, exact: true }),
    ).toBeVisible()
    await expectNoHeadingOrderViolations(page)
  })

  test('workshop order checkout has no heading-order violations', async ({ page }) => {
    const order = createMockWorkshopOrder({ id: 'ws-heading-2', order_number: 'WO-2026-0902' })
    await mockWorkshopOrder(page, order)

    await page.goto(`/workshop/orders/${order.id}`)
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: DE_WORKSHOP.checkout.primaryAction, exact: true }).click()

    // The checkout section sits under its own h2, so the draft invoice card is h3 beneath it.
    await expect(page.getByRole('heading', { level: 2, name: DE_WORKSHOP.checkout.title, exact: true })).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 3, name: DE_WORKSHOP.checkoutSummary.title, exact: true }),
    ).toBeVisible()
    await expectNoHeadingOrderViolations(page)
  })
})
