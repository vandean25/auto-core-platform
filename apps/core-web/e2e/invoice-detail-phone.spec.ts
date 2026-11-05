import { expect, test, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import deSales from '../../../locales/de/sales.json' with { type: 'json' }
import { controlsShorterThan44, expectNoPageScroll, PHONE_WIDTHS } from './utils/phone-layout'

/** AUT-777: the invoice detail header keeps the number on one line and stacks its actions on a phone. */
const INVOICE_ID = 'inv-phone-1'

const issuedInvoice = {
  id: INVOICE_ID,
  status: 'ISSUED',
  invoice_number: 'RE-2026-0008',
  date: '2026-09-21T00:00:00.000Z',
  due_date: '2026-10-05T00:00:00.000Z',
  total_net: '100.00',
  total_tax: '20.00',
  total_gross: '120.00',
  tax_mode: 'STANDARD',
  workshop_order_id: 'wo-phone-1',
  customer: {
    id: 'cust-phone-1',
    type: 'PRIVATE',
    first_name: 'Jane',
    last_name: 'Doe',
    company_name: null,
    email: 'jane@example.com',
    phone: null,
  },
  items: [],
}

async function mockJson(page: Page, path: string, body: unknown) {
  await page.route(AutoCorePage.apiRouteMatcher(path), (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
  )
}

async function openInvoice(page: Page) {
  await mockJson(page, `/api/sales/invoices/${INVOICE_ID}`, issuedInvoice)
  await mockJson(page, `/api/invoices/${INVOICE_ID}/settlement`, {
    invoiceId: INVOICE_ID,
    invoiceStatus: 'ISSUED',
    rksvMode: 'REQUIRED_EXTERNAL_KASSE',
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
  await expect(page.getByRole('heading', { level: 1, name: 'RE-2026-0008' })).toBeVisible()
}

test.describe('Invoice detail header on a phone (AUT-777)', () => {
  for (const width of PHONE_WIDTHS) {
    test(`${width}px: number on one line, actions stacked inside the screen, German breadcrumb`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 })
      await openInvoice(page)

      const title = page.getByRole('heading', { level: 1, name: 'RE-2026-0008' })
      const lineHeight = await title.evaluate((node) => parseFloat(getComputedStyle(node).lineHeight))
      expect((await title.boundingBox())!.height).toBeLessThanOrEqual(lineHeight + 1)

      const record = page.getByRole('button', { name: 'Abrechnung erfassen' })
      const pdf = page.getByRole('button', { name: 'PDF herunterladen' })
      await expect(record).toBeVisible()
      for (const button of [record, pdf]) {
        const box = (await button.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(width)
      }
      const recordBox = (await record.boundingBox())!
      const pdfBox = (await pdf.boundingBox())!
      expect(pdfBox.y).toBeGreaterThanOrEqual(recordBox.y + recordBox.height)

      await expectNoPageScroll(page)
      expect(await controlsShorterThan44(page.getByRole('main').locator('div.mb-8').first())).toEqual([])

      await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Rechnungen' })).toBeVisible()
      await expect(page).toHaveTitle('RE-2026-0008 - Rechnungen - Auto Core')
    })
  }

  test('desktop keeps title and actions on one row', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await openInvoice(page)

    const title = (await page.getByRole('heading', { level: 1, name: 'RE-2026-0008' }).boundingBox())!
    const pdf = (await page.getByRole('button', { name: 'PDF herunterladen' }).boundingBox())!
    expect(Math.abs(title.y + title.height / 2 - (pdf.y + pdf.height / 2))).toBeLessThan(60)
    expect(pdf.x).toBeGreaterThan(title.x + title.width)
  })

  // AUT-659 scenario 5: the sales order detail (PageHeader migration) keeps the phone layout.
  test('WHEN the sales order detail opens at 375px THEN there is no horizontal scroll and targets are at least 44px', async ({ page }) => {
    await mockJson(page, '/api/sales-orders/so-phone-1', {
      id: 'so-phone-1',
      order_number: 'SO-2026-0042',
      status: 'DRAFT',
      createdAt: '2026-09-21T00:00:00.000Z',
      notes: null,
      customer: { ...issuedInvoice.customer, address_street: 'Main', address_zip: '1010', address_city: 'Wien', address_country: 'AT' },
      items: [],
    })
    await page.setViewportSize({ width: 375, height: 844 })
    await page.goto('/sales-orders/so-phone-1')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('SO-2026-0042')

    for (const name of [deSales.orders.detail.backAria, deSales.orders.detail.createInvoice]) {
      const target = page.getByRole(name === deSales.orders.detail.backAria ? 'link' : 'button', { name }).first()
      const box = (await target.boundingBox())!
      expect(box.x + box.width, name).toBeLessThanOrEqual(375)
      expect(box.height, name).toBeGreaterThanOrEqual(44)
    }
    await expectNoPageScroll(page)
  })
})
