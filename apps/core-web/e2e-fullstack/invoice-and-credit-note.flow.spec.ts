import { test, expect } from '@playwright/test'
import { loadE2eFullstackFixture } from './fixture.ts'
import { E2E_FULLSTACK_API_PORT } from '../../core-api/test/e2e-fullstack/constants.ts'

test.describe.configure({ mode: 'serial' })

test.describe('Full-stack sales invoice and credit note flows', () => {
  let finalizedInvoiceNumber = ''

  test('flow 1: sales order → finalize invoice → PDF download', async ({ page, request }) => {
    const fixture = loadE2eFullstackFixture()
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
    const order = await orderResponse.json()
    const orderCheck = await request.get(`${apiBase}/sales-orders/${order.id}`, {
      headers: authHeaders,
    })
    expect(orderCheck.ok()).toBeTruthy()

    await page.goto('/dashboard')
    await expect(page.getByText('Current Tenant')).toBeVisible()

    const orderDetailResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/sales-orders/${order.id}`) &&
        response.request().method() === 'GET',
    )
    await page.goto(`/sales-orders/${order.id}`)
    const detailResponse = await orderDetailResponse
    expect(detailResponse.ok()).toBeTruthy()
    await expect(page.getByText('Order not found')).not.toBeVisible()
    await expect(page.getByRole('heading', { name: order.order_number })).toBeVisible()

    await page.getByRole('button', { name: 'Create Invoice' }).click()
    await page.getByRole('button', { name: 'Create Invoice' }).last().click()
    await expect(page).toHaveURL(/\/sales\/invoices\/[0-9a-f-]+\/edit/)

    await page.getByRole('button', { name: 'Finalize & Print' }).click()
    await page
      .getByRole('button', { name: 'Finalize & Print' })
      .last()
      .click()

    await expect(page).toHaveURL(/\/sales\/invoices\/[0-9a-f-]+$/)
    const invoiceHeading = page.getByRole('heading', { name: /^RE-/ })
    await expect(invoiceHeading).toBeVisible()
    finalizedInvoiceNumber = (await invoiceHeading.textContent())?.trim() ?? ''
    expect(finalizedInvoiceNumber.length).toBeGreaterThan(0)

    await page.getByRole('button', { name: 'Print' }).click()
    await expect(page.getByText('Invoice PDF downloaded successfully')).toBeVisible({
      timeout: 90_000,
    })

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
    await page.goto('/sales/invoices')
    await expect(page.getByRole('heading', { name: 'Sales Invoices' })).toBeVisible()
    expect(finalizedInvoiceNumber).toBeTruthy()
    await page.getByRole('cell', { name: finalizedInvoiceNumber }).click()
    await expect(
      page.getByRole('heading', { name: finalizedInvoiceNumber }),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Credit Note' }).click()
    await page.getByLabel('Reason').fill('E2E fullstack commercial correction')
    await page.getByRole('button', { name: 'Create Draft' }).click()

    await expect(page).toHaveURL(/\/finance\/credit-notes\/[0-9a-f-]+$/)
    await page.getByRole('button', { name: 'Finalize' }).click()
    await page.getByRole('button', { name: 'Finalize credit note' }).click()

    await expect(page.getByText('Finalized', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Print' })).toBeVisible()
  })
})
