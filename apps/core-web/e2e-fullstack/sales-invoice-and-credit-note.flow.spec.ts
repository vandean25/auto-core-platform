import { test, expect } from '@playwright/test'
import { loadE2eFullstackFixture } from './fixture.ts'
import { gotoWithReadySession } from './harness.ts'
import {
  assertInvoicePdfViaApi,
  createAndFinalizeCreditNote,
  createSalesOrderViaApi,
  downloadFinalizedInvoicePdf,
  finalizeSalesInvoiceFromOrder,
} from './invoice-and-credit-note.flow.support.ts'

test.describe.configure({ mode: 'serial' })

test.describe('Full-stack sales invoice and credit note flows', () => {
  let finalizedInvoiceNumber = ''
  let finalizedInvoiceId = ''

  test('flow 1: sales order → finalize invoice → PDF download', async ({ page, request }) => {
    const fixture = loadE2eFullstackFixture()
    const pdfGenerationRequests: string[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/pdf')) {
        pdfGenerationRequests.push(request.url())
      }
    })

    const order = await createSalesOrderViaApi(request, fixture)
    await gotoWithReadySession(page, '/dashboard')
    const finalized = await finalizeSalesInvoiceFromOrder(page, order)
    finalizedInvoiceNumber = finalized.invoiceNumber
    finalizedInvoiceId = finalized.invoiceId
    expect(pdfGenerationRequests).toEqual([])

    await downloadFinalizedInvoicePdf(page)
    expect(pdfGenerationRequests).toHaveLength(1)
    await assertInvoicePdfViaApi(request, fixture, finalized.invoiceId)
  })

  test('flow 2: create and finalize a full credit note', async ({ page }) => {
    loadE2eFullstackFixture()
    expect(finalizedInvoiceId).toBeTruthy()
    await createAndFinalizeCreditNote(page, finalizedInvoiceId, finalizedInvoiceNumber)
  })
})
