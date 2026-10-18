import { test, expect } from '@playwright/test'
import { loadE2eFullstackFixture } from './fixture.ts'
import { gotoWithReadySession } from './harness.ts'
import { DE_FULLSTACK_FINANCE, DE_FULLSTACK_SALES } from './de-copy.ts'
import { E2E_FULLSTACK_API_PORT } from '../../core-api/test/e2e-fullstack/constants.ts'

test.describe.configure({ mode: 'serial' })

test.describe('Full-stack sales invoice and credit note flows', () => {
  let finalizedInvoiceNumber = ''
  let finalizedInvoiceId = ''

  test('flow 1: sales order → finalize invoice → PDF download', async ({ page, request }) => {
    const fixture = loadE2eFullstackFixture()
    const apiBase = `http://127.0.0.1:${E2E_FULLSTACK_API_PORT}/api`
    const authHeaders = { Authorization: `Bearer ${fixture.authToken}` }
    const pdfGenerationRequests: string[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/pdf')) {
        pdfGenerationRequests.push(request.url())
      }
    })

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
    const order = await orderResponse.json()
    const orderCheck = await request.get(`${apiBase}/sales-orders/${order.id}`, {
      headers: authHeaders,
    })
    expect(orderCheck.ok()).toBeTruthy()

    await gotoWithReadySession(page, '/dashboard')

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
    finalizedInvoiceNumber = (await invoiceHeading.textContent())?.trim() ?? ''
    finalizedInvoiceId = page.url().split('/').pop() ?? ''
    expect(finalizedInvoiceNumber.length).toBeGreaterThan(0)
    expect(finalizedInvoiceId.length).toBeGreaterThan(0)
    expect(pdfGenerationRequests).toEqual([])

    const downloadPromise = page.waitForEvent('download', { timeout: 90_000 })
    await page.getByRole('button', { name: DE_FULLSTACK_SALES.downloadPdf, exact: true }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^invoice_.*\.pdf$/)
    await expect(page.getByText(DE_FULLSTACK_SALES.pdfSuccess)).toBeVisible({
      timeout: 90_000,
    })
    expect(pdfGenerationRequests).toHaveLength(1)

    const invoiceId = page.url().split('/').pop()!
    const pdfResponse = await request.get(`${apiBase}/invoices/${invoiceId}/pdf`, {
      headers: {
        ...authHeaders,
        Accept: 'application/pdf',
      },
    })
    expect(pdfResponse.ok()).toBeTruthy()
    const pdfBody = await pdfResponse.body()
    expect(pdfBody.subarray(0, 5).toString('utf8')).toBe('%PDF-')
  })

  test('flow 2: create and finalize a full credit note', async ({ page }) => {
    loadE2eFullstackFixture()
    expect(finalizedInvoiceId).toBeTruthy()
    await gotoWithReadySession(page, `/sales/invoices/${finalizedInvoiceId}`)
    await expect(
      page.getByRole('heading', { name: finalizedInvoiceNumber }),
    ).toBeVisible()

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
  })
})
