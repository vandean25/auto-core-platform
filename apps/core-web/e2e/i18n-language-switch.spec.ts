import { expect, test, type Page } from '@playwright/test'
import deCommon from '../../../locales/de/common.json' with { type: 'json' }
import enCommon from '../../../locales/en/common.json' with { type: 'json' }
import deNav from '../../../locales/de/nav.json' with { type: 'json' }
import enNav from '../../../locales/en/nav.json' with { type: 'json' }
import enWorkshop from '../../../locales/en/workshop.json' with { type: 'json' }
import { AutoCorePage } from './pom/AutoCorePage'
import { DE_SHELL } from './helpers/de-shell'
import { createMockListResponse, createMockWorkshopOrder } from './utils/mock-factories'

/**
 * AUT-718: the account menu switch changes the whole visible UI, not only the tab title. The suite
 * runs as the e2e ADMIN (auth bypass). Every assertion after a switch is made without a reload; a
 * marker on `window` proves that the page was not reloaded in between.
 */
const NO_RELOAD_MARKER = '__aut718NoReload'

async function markPage(page: Page) {
  await page.evaluate((marker) => {
    ;(window as unknown as Record<string, unknown>)[marker] = true
  }, NO_RELOAD_MARKER)
}

async function expectSamePageInstance(page: Page) {
  expect(await page.evaluate((marker) => Boolean((window as unknown as Record<string, unknown>)[marker]), NO_RELOAD_MARKER)).toBe(true)
}

async function switchLanguage(page: Page, language: 'de' | 'en') {
  await page.getByRole('button', { name: DE_SHELL.user.accountEmail }).click()
  await page.getByTestId(`language-option-${language}`).click()
  await expect(page.locator('html')).toHaveAttribute('lang', language)
  // The menu stays open while the switch runs (the choice is not a navigation), so close it again.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toBeHidden()
}

function mainNavigation(page: Page, name: string) {
  return page.getByRole('navigation', { name })
}

function breadcrumb(page: Page) {
  return page.locator('nav[aria-label="Breadcrumb"]')
}

async function mockJson(page: Page, path: string, body: unknown) {
  await page.route(AutoCorePage.apiRouteMatcher(path), (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
  )
}

const INVOICE_ID = 'inv-aut718-1'
const invoice = {
  id: INVOICE_ID,
  status: 'ISSUED',
  invoice_number: 'RE-2026-0008',
  date: '2026-09-21T00:00:00.000Z',
  due_date: '2026-10-05T00:00:00.000Z',
  total_net: '100.00',
  total_tax: '20.00',
  total_gross: '120.00',
  tax_mode: 'STANDARD',
  workshop_order_id: null,
  customer: {
    id: 'cust-aut718-1',
    type: 'PRIVATE',
    first_name: 'Jane',
    last_name: 'Doe',
    company_name: null,
    email: 'jane@example.com',
    phone: null,
  },
  items: [],
}

const workshopOrder = createMockWorkshopOrder({
  id: 'wo-aut718-1',
  order_number: 'WO-2026-0418',
})

test.describe('UI language switch (AUT-718)', () => {
  test('switches sidebar, page copy and buttons to English without a reload and survives a reload', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
    await expect(mainNavigation(page, DE_SHELL.mainNavigation)).toBeVisible()
    await expect(page.getByRole('link', { name: deNav.modules.customers, exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: deCommon.dashboard.title })).toBeVisible()
    await expect(page.getByText(deCommon.dashboard.description)).toBeVisible()
    await expect(page.getByRole('button', { name: deNav.search.openAria })).toBeVisible()

    await markPage(page)
    await switchLanguage(page, 'en')

    await expect(mainNavigation(page, enNav.aria.mainNavigation)).toBeVisible()
    await expect(page.getByRole('link', { name: enNav.modules.customers, exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: deNav.modules.customers, exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: enCommon.dashboard.title })).toBeVisible()
    await expect(page.getByText(enCommon.dashboard.description)).toBeVisible()
    await expect(page.getByRole('button', { name: enNav.search.openAria })).toBeVisible()
    await expect(page.getByRole('button', { name: deNav.search.openAria })).toHaveCount(0)
    await expectSamePageInstance(page)

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(mainNavigation(page, enNav.aria.mainNavigation)).toBeVisible()
    await expect(page.getByRole('link', { name: enNav.modules.customers, exact: true })).toBeVisible()
    await expect(page.getByText(enCommon.dashboard.description)).toBeVisible()

    await markPage(page)
    await switchLanguage(page, 'de')

    await expect(mainNavigation(page, DE_SHELL.mainNavigation)).toBeVisible()
    await expect(page.getByRole('link', { name: deNav.modules.customers, exact: true })).toBeVisible()
    await expect(page.getByText(deCommon.dashboard.description)).toBeVisible()
    await expectSamePageInstance(page)
  })

  test('switches a page whose locale bundle loads lazily, without a reload', async ({ page }) => {
    await mockJson(page, '/api/workshop/orders', createMockListResponse([workshopOrder]))
    await page.goto('/workshop/orders')
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
    await expect(page.getByRole('heading', { level: 1, name: 'Werkstattaufträge' })).toBeVisible()

    await markPage(page)
    await switchLanguage(page, 'en')

    await expect(page.getByRole('heading', { level: 1, name: enWorkshop.orders.list.title })).toBeVisible()
    await expect(page.getByRole('button', { name: deNav.search.openAria })).toHaveCount(0)
    await expectSamePageInstance(page)

    await switchLanguage(page, 'de')
    await expect(page.getByRole('heading', { level: 1, name: 'Werkstattaufträge' })).toBeVisible()
  })

  test('keeps German breadcrumbs and tab titles on detail pages after switching back', async ({ page }) => {
    await mockJson(page, `/api/sales/invoices/${INVOICE_ID}`, invoice)
    await mockJson(page, `/api/invoices/${INVOICE_ID}/settlement`, {
      invoiceId: INVOICE_ID,
      invoiceStatus: 'ISSUED',
      rksvMode: 'NONE',
      payment: null,
    })
    await mockJson(page, `/api/invoices/${INVOICE_ID}/credit-notes`, {
      originalInvoiceId: INVOICE_ID,
      coverageStatus: 'NONE',
      creditedGross: '0.00',
      remainingGross: '120.00',
      creditNotes: [],
    })
    await page.goto(`/sales/invoices/${INVOICE_ID}`)
    await expect(breadcrumb(page).getByRole('link', { name: 'Rechnungen', exact: true })).toBeVisible()
    await expect(page).toHaveTitle(`RE-2026-0008 - Rechnungen - Auto Core`)

    await switchLanguage(page, 'en')
    await expect(breadcrumb(page).getByRole('link', { name: enNav.modules.salesInvoices, exact: true })).toBeVisible()
    await expect(page).toHaveTitle(`RE-2026-0008 - ${enNav.modules.salesInvoices} - Auto Core`)

    await mockJson(page, `/api/workshop/orders/${workshopOrder.id}`, workshopOrder)
    await page.goto(`/workshop/orders/${workshopOrder.id}`)
    await expect(breadcrumb(page).getByRole('link', { name: enNav.modules.workshopOrders, exact: true })).toBeVisible()

    await switchLanguage(page, 'de')
    await expect(breadcrumb(page).getByRole('link', { name: 'Werkstattaufträge', exact: true })).toBeVisible()
    await expect(page).toHaveTitle(`WO-2026-0418 - Werkstattaufträge - Auto Core`)
  })
})
