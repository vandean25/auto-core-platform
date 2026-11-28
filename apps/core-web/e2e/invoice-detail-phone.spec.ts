import { expect, test, type Locator, type Page } from '@playwright/test'
import { UI_LANGUAGE_STORAGE_KEY } from '../src/lib/i18n/constants'
import { AutoCorePage } from './pom/AutoCorePage'
import deFinance from '../../../locales/de/finance.json' with { type: 'json' }
import deSales from '../../../locales/de/sales.json' with { type: 'json' }
import enFinance from '../../../locales/en/finance.json' with { type: 'json' }
import enSales from '../../../locales/en/sales.json' with { type: 'json' }
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

async function openInvoice(page: Page, settlementExtra: { outstanding?: string } = {}) {
  await mockJson(page, `/api/sales/invoices/${INVOICE_ID}`, issuedInvoice)
  await mockJson(page, `/api/invoices/${INVOICE_ID}/settlement`, {
    invoiceId: INVOICE_ID,
    invoiceStatus: 'ISSUED',
    rksvMode: 'REQUIRED_EXTERNAL_KASSE',
    payment: null,
    ...settlementExtra,
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

// AUT-1069: after a finalized partial credit note the settlement card shows what is still collectable.
test.describe('Invoice detail settlement outstanding amount (AUT-1069)', () => {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 375, height: 812 },
  ]) {
    test(`WHEN a partial credit note leaves 100,00 outstanding on a 120,00 invoice at ${viewport.width}px THEN the card shows Offen: € 100,00 and the settle button fits`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport)
      await openInvoice(page, { outstanding: '100.00' })

      await expect(page.getByText('Offen: € 100,00')).toBeVisible()
      const record = page.getByRole('button', { name: deFinance.actions.recordSettlement })
      await expect(record).toBeVisible()
      const box = (await record.boundingBox())!
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
      if (viewport.width < 768) expect(box.height).toBeGreaterThanOrEqual(44)
      await expectNoPageScroll(page)

      await testInfo.attach(`settlement-outstanding-de-${viewport.width}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })
    })
  }

  test('WHEN a full credit note leaves nothing outstanding THEN the settle button is gone and a short label is shown', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await openInvoice(page, { outstanding: '0.00' })

    await expect(page.getByText(deFinance.settlement.nothingOutstanding)).toBeVisible()
    await expect(page.getByRole('button', { name: deFinance.actions.recordSettlement })).toHaveCount(0)
  })
})

async function expectMatchingButtonTypography(
  record: Locator,
  creditNote: Locator,
  pdf: Locator,
) {
  for (const button of [record, creditNote, pdf]) {
    await expect(button).toBeVisible()
  }
  const styles = await Promise.all(
    [record, creditNote, pdf].map((button) =>
      button.evaluate((el) => {
        const cs = getComputedStyle(el)
        return { fontSize: cs.fontSize, fontWeight: cs.fontWeight }
      }),
    ),
  )
  expect(styles[0].fontSize).toBe(styles[1].fontSize)
  expect(styles[0].fontSize).toBe(styles[2].fontSize)
  expect(styles[0].fontWeight).toBe(styles[1].fontWeight)
  expect(styles[0].fontWeight).toBe(styles[2].fontWeight)
}

test.describe('Invoice detail settlement button typography (AUT-1032)', () => {
  test('WHEN an issued invoice detail is opened at 375px in DE THEN Abrechnung erfassen uses the same font size and weight as Gutschrift and PDF herunterladen', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await openInvoice(page)

    const record = page.getByRole('button', { name: deFinance.actions.recordSettlement })
    const creditNote = page.getByRole('button', { name: deSales.invoices.detail.creditNote })
    const pdf = page.getByRole('button', { name: deSales.invoices.detail.downloadPdf })

    await expectMatchingButtonTypography(record, creditNote, pdf)
    expect((await record.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  })

  test('WHEN an issued invoice detail is opened at 390px and desktop in DE THEN the same typography alignment holds', async ({
    page,
  }) => {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(viewport)
      await openInvoice(page)

      const record = page.getByRole('button', { name: deFinance.actions.recordSettlement })
      const creditNote = page.getByRole('button', { name: deSales.invoices.detail.creditNote })
      const pdf = page.getByRole('button', { name: deSales.invoices.detail.downloadPdf })

      await expectMatchingButtonTypography(record, creditNote, pdf)
    }
  })

  test('WHEN the UI language is EN THEN the equivalent button matches its siblings and the label still fits', async ({
    page,
  }) => {
    await page.addInitScript((storageKey) => {
      window.localStorage.setItem(storageKey, 'en')
    }, UI_LANGUAGE_STORAGE_KEY)

    for (const viewport of [
      { width: 375, height: 812 },
      { width: 390, height: 844 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(viewport)
      await openInvoice(page)

      const record = page.getByRole('button', { name: enFinance.actions.recordSettlement })
      const creditNote = page.getByRole('button', { name: enSales.invoices.detail.creditNote })
      const pdf = page.getByRole('button', { name: enSales.invoices.detail.downloadPdf })

      await expectMatchingButtonTypography(record, creditNote, pdf)

      const box = (await record.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
      const fitsInsideButton = await record.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
      expect(fitsInsideButton).toBe(true)
    }
  })
})
