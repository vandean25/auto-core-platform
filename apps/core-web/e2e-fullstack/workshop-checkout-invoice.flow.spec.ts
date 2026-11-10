import { test, expect } from '@playwright/test'
import { loadE2eFullstackFixture } from './fixture.ts'
import { gotoWithReadySession } from './harness.ts'
import { DE_FULLSTACK_WORKSHOP } from './de-copy.ts'
import {
  EN_CHECKOUT_SUMMARY,
  apiBase,
  authHeaders,
  createCheckoutDraftInvoice,
  createCompletedWorkshopOrder,
  issueCheckoutDraftInvoice,
  openWorkshopCheckout,
  readCheckoutSummaryAmount,
  switchToEnglishViaAccountMenu,
  EN_CHECKOUT,
} from './workshop-checkout-invoice.flow.support.ts'

test.describe.configure({ mode: 'serial' })

test.describe('Full-stack workshop checkout VAT (AUT-965)', () => {
  test('panel shows 20% USt and gross before issue (DE)', async ({ page, request }) => {
    const fixture = loadE2eFullstackFixture()
    const order = await createCompletedWorkshopOrder(request, fixture)
    await gotoWithReadySession(page, '/dashboard')
    await openWorkshopCheckout(page, order.id)

    const net = await readCheckoutSummaryAmount(
      page,
      DE_FULLSTACK_WORKSHOP.checkoutSummary.net,
    )
    const vat = await readCheckoutSummaryAmount(
      page,
      DE_FULLSTACK_WORKSHOP.checkoutSummary.vat,
    )
    const total = await readCheckoutSummaryAmount(
      page,
      DE_FULLSTACK_WORKSHOP.checkoutSummary.total,
    )

    expect(net).toMatch(/90,00/)
    expect(vat).toMatch(/18,00/)
    expect(total).toMatch(/108,00/)
  })

  test('issued invoice totals match the checkout panel (DE)', async ({ page, request }) => {
    const fixture = loadE2eFullstackFixture()
    const order = await createCompletedWorkshopOrder(request, fixture)
    await gotoWithReadySession(page, '/dashboard')
    await openWorkshopCheckout(page, order.id)

    const panelVat = await readCheckoutSummaryAmount(
      page,
      DE_FULLSTACK_WORKSHOP.checkoutSummary.vat,
    )
    const panelTotal = await readCheckoutSummaryAmount(
      page,
      DE_FULLSTACK_WORKSHOP.checkoutSummary.total,
    )

    await createCheckoutDraftInvoice(page)
    const issued = await issueCheckoutDraftInvoice(page)

    expect(Number(issued.total_tax)).toBeCloseTo(18)
    expect(Number(issued.total_gross)).toBeCloseTo(108)
    expect(panelVat).toMatch(/18,00/)
    expect(panelTotal).toMatch(/108,00/)
  })

  test('375px viewport keeps USt and Gesamt visible and correct', async ({ page, request }) => {
    const fixture = loadE2eFullstackFixture()
    await page.setViewportSize({ width: 375, height: 812 })
    const order = await createCompletedWorkshopOrder(request, fixture)
    await page.goto(`/workshop/orders/${order.id}`)
    await page
      .getByRole('button', { name: DE_FULLSTACK_WORKSHOP.checkout.primaryAction, exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: DE_FULLSTACK_WORKSHOP.checkout.title, exact: true }),
    ).toBeVisible()
    await page.locator('div.w-full.max-w-md.rounded-xl.border').scrollIntoViewIfNeeded()

    const vat = await readCheckoutSummaryAmount(
      page,
      DE_FULLSTACK_WORKSHOP.checkoutSummary.vat,
    )
    const total = await readCheckoutSummaryAmount(
      page,
      DE_FULLSTACK_WORKSHOP.checkoutSummary.total,
    )
    expect(vat).toMatch(/18,00/)
    expect(total).toMatch(/108,00/)
  })

  test('EN checkout labels show the same VAT and total amounts', async ({ page, request }) => {
    const fixture = loadE2eFullstackFixture()
    const order = await createCompletedWorkshopOrder(request, fixture)
    await gotoWithReadySession(page, '/dashboard')
    await switchToEnglishViaAccountMenu(page)
    await page.goto(`/workshop/orders/${order.id}`)
    await page
      .getByRole('button', { name: EN_CHECKOUT.primaryAction, exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: EN_CHECKOUT.title, exact: true }),
    ).toBeVisible()

    await expect(page.getByText(EN_CHECKOUT_SUMMARY.vat, { exact: true })).toBeVisible()
    const vat = await readCheckoutSummaryAmount(page, EN_CHECKOUT_SUMMARY.vat)
    const total = await readCheckoutSummaryAmount(page, EN_CHECKOUT_SUMMARY.total)
    expect(vat).toMatch(/18,00|18\.00/)
    expect(total).toMatch(/108,00|108\.00/)
  })

  test('tax-exempt draft line shows USt 0 and matching gross in checkout', async ({
    page,
    request,
  }) => {
    const fixture = loadE2eFullstackFixture()
    const order = await createCompletedWorkshopOrder(request, fixture, { unitPrice: 100 })
    const headers = authHeaders(fixture)

    const draftResponse = await request.post(`${apiBase()}/invoices/drafts`, {
      headers,
      data: { workshopOrderId: order.id },
    })
    expect(draftResponse.ok()).toBeTruthy()
    const draft = (await draftResponse.json()) as {
      id: string
      customer_id: string
      items: Array<{
        description: string
        quantity: string
        unit_price: string
        catalog_item_id: string | null
      }>
    }

    await request.patch(`${apiBase()}/sales/invoices/${draft.id}`, {
      headers,
      data: {
        customerId: draft.customer_id,
        items: draft.items.map((item) => ({
          description: item.description,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unit_price),
          taxRate: 0,
          ...(item.catalog_item_id ? { catalogItemId: item.catalog_item_id } : {}),
        })),
      },
    })

    await gotoWithReadySession(page, '/dashboard')
    await openWorkshopCheckout(page, order.id)

    const vat = await readCheckoutSummaryAmount(
      page,
      DE_FULLSTACK_WORKSHOP.checkoutSummary.vat,
    )
    const total = await readCheckoutSummaryAmount(
      page,
      DE_FULLSTACK_WORKSHOP.checkoutSummary.total,
    )
    expect(vat).toMatch(/0,00/)
    expect(total).toMatch(/100,00/)
  })

})
