import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { DE_FULLSTACK_FINANCE, DE_FULLSTACK_SALES } from './de-copy.ts'
import { gotoWithReadySession } from './harness.ts'
import { E2E_FULLSTACK_API_PORT } from '../../core-api/test/e2e-fullstack/constants.ts'
import type { E2eFullstackFixture } from '../../core-api/test/e2e-fullstack/seed-fixture.ts'

export type SalesOrderDraft = {
  id: string
  order_number: string
}

export async function createSalesOrderViaApi(
  request: APIRequestContext,
  fixture: E2eFullstackFixture,
): Promise<SalesOrderDraft> {
  const apiBase = `http://127.0.0.1:${E2E_FULLSTACK_API_PORT}/api`
  const authHeaders = { Authorization: `Bearer ${fixture.authToken}` }

  const orderResponse = await request.post(`${apiBase}/sales-orders`, {
    headers: authHeaders,
    data: {
      customer_id: fixture.customerId,
      items: [
        {
          catalog_item_id: fixture.catalogItemId,
          description: fixture.catalogName,
          quantity: 2,
          unit_price: 12,
          tax_rate: 20,
        },
      ],
    },
  })
  expect(orderResponse.ok()).toBeTruthy()
  const order = (await orderResponse.json()) as SalesOrderDraft

  const orderCheck = await request.get(`${apiBase}/sales-orders/${order.id}`, {
    headers: authHeaders,
  })
  expect(orderCheck.ok()).toBeTruthy()
  return order
}

export async function finalizeSalesInvoiceFromOrder(
  page: Page,
  order: SalesOrderDraft,
): Promise<{ invoiceNumber: string; invoiceId: string }> {
  const orderDetailResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/sales-orders/${order.id}`) &&
      response.request().method() === 'GET',
  )
  await page.goto(`/sales-orders/${order.id}`)
  const detailResponse = await orderDetailResponse
  expect(detailResponse.ok()).toBeTruthy()
  await expect(page.getByText(DE_FULLSTACK_SALES.orderNotFound)).not.toBeVisible()
  await expect(page.getByRole('heading', { name: order.order_number })).toBeVisible()

  await page.getByRole('button', { name: DE_FULLSTACK_SALES.createInvoice }).click()
  await page.getByRole('button', { name: DE_FULLSTACK_SALES.createInvoice }).last().click()
  await expect(page).toHaveURL(/\/sales\/invoices\/[0-9a-f-]+\/edit/)

  await page.getByRole('button', { name: DE_FULLSTACK_SALES.finalize, exact: true }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: DE_FULLSTACK_SALES.finalizeDialogConfirm, exact: true })
    .click()

  await expect(page).toHaveURL(/\/sales\/invoices\/[0-9a-f-]+$/)
  const invoiceHeading = page.getByRole('heading', { name: /^RE-/ })
  await expect(invoiceHeading).toBeVisible()
  const invoiceNumber = (await invoiceHeading.textContent())?.trim() ?? ''
  const invoiceId = page.url().split('/').pop() ?? ''
  expect(invoiceNumber.length).toBeGreaterThan(0)
  expect(invoiceId.length).toBeGreaterThan(0)
  return { invoiceNumber, invoiceId }
}

export async function downloadFinalizedInvoicePdf(page: Page): Promise<void> {
  const downloadPromise = page.waitForEvent('download', { timeout: 90_000 })
  await page.getByRole('button', { name: DE_FULLSTACK_SALES.downloadPdf, exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^invoice_.*\.pdf$/)
  await expect(page.getByText(DE_FULLSTACK_SALES.pdfSuccess)).toBeVisible({
    timeout: 90_000,
  })
}

export async function assertInvoicePdfViaApi(
  request: APIRequestContext,
  fixture: E2eFullstackFixture,
  invoiceId: string,
): Promise<void> {
  const apiBase = `http://127.0.0.1:${E2E_FULLSTACK_API_PORT}/api`
  const pdfResponse = await request.get(`${apiBase}/invoices/${invoiceId}/pdf`, {
    headers: {
      Authorization: `Bearer ${fixture.authToken}`,
      Accept: 'application/pdf',
    },
  })
  expect(pdfResponse.ok()).toBeTruthy()
  const pdfBody = await pdfResponse.body()
  expect(pdfBody.subarray(0, 5).toString('utf8')).toBe('%PDF-')
}

export async function createAndFinalizeCreditNote(
  page: Page,
  invoiceId: string,
  invoiceNumber: string,
): Promise<void> {
  await gotoWithReadySession(page, `/sales/invoices/${invoiceId}`)
  await expect(page.getByRole('heading', { name: invoiceNumber })).toBeVisible()

  await page.getByRole('button', { name: DE_FULLSTACK_SALES.creditNote }).click()
  await page
    .getByPlaceholder(DE_FULLSTACK_FINANCE.creditReasonPlaceholder)
    .fill('E2E fullstack commercial correction')
  await page.getByRole('button', { name: DE_FULLSTACK_FINANCE.createDraft }).click()

  await expect(page).toHaveURL(/\/finance\/credit-notes\/[0-9a-f-]+$/)
  await page.getByRole('button', { name: DE_FULLSTACK_FINANCE.finalizeAction }).click()
  await page.getByRole('button', { name: DE_FULLSTACK_FINANCE.finalizeCredit }).click()

  await expect(page.getByText(DE_FULLSTACK_FINANCE.finalizedToast)).toBeVisible()
  await expect(page.getByRole('button', { name: DE_FULLSTACK_FINANCE.print })).toBeVisible()
}
