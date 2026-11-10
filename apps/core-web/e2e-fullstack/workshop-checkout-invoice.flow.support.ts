import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { E2E_FULLSTACK_API_PORT } from '../../core-api/test/e2e-fullstack/constants.ts'
import type { E2eFullstackFixture } from '../../core-api/test/e2e-fullstack/seed-fixture.ts'
import { DE_FULLSTACK_WORKSHOP } from './de-copy.ts'
import workshopEn from '../../../locales/en/workshop.json' with { type: 'json' }

type ApiAuth = { Authorization: string }

export type CompletedWorkshopOrder = {
  id: string
  order_number: string
}

export function apiBase() {
  return `http://127.0.0.1:${E2E_FULLSTACK_API_PORT}/api`
}

export function authHeaders(fixture: E2eFullstackFixture): ApiAuth {
  return { Authorization: `Bearer ${fixture.authToken}` }
}

export async function createCompletedWorkshopOrder(
  request: APIRequestContext,
  fixture: E2eFullstackFixture,
  options: { unitPrice?: number; description?: string } = {},
): Promise<CompletedWorkshopOrder> {
  const unitPrice = options.unitPrice ?? 90
  const description = options.description ?? 'Brake labor (AUT-965)'
  const headers = authHeaders(fixture)

  const vehicleResponse = await request.post(`${apiBase()}/vehicles`, {
    headers,
    data: {
      customer_id: fixture.customerId,
      make: 'Skoda',
      model: 'Octavia',
      year: 2019,
      vin: `WVWE2EFULLSTK${Date.now().toString().slice(-8)}`,
      plate: `W-965-${Date.now().toString().slice(-4)}`,
    },
  })
  expect(vehicleResponse.ok()).toBeTruthy()
  const vehicle = (await vehicleResponse.json()) as { id: string }

  const orderResponse = await request.post(`${apiBase()}/workshop/orders`, {
    headers,
    data: {
      customerId: fixture.customerId,
      vehicleId: vehicle.id,
      odometer: 120_000,
      fuelLevel: 40,
    },
  })
  expect(orderResponse.ok()).toBeTruthy()
  const order = (await orderResponse.json()) as CompletedWorkshopOrder

  const taskResponse = await request.post(`${apiBase()}/workshop/orders/${order.id}/tasks`, {
    headers,
    data: { title: 'AUT-965 billing' },
  })
  expect(taskResponse.ok()).toBeTruthy()
  const task = (await taskResponse.json()) as { id: string }

  const lineItemsResponse = await request.patch(
    `${apiBase()}/workshop/orders/${order.id}/tasks/${task.id}/line-items`,
    {
      headers,
      data: {
        expectedLineItemsVersion: 0,
        items: [
          {
            type: 'LABOR',
            itemNo: 'LAB-965',
            description,
            qty: 1,
            unitPrice,
          },
        ],
      },
    },
  )
  expect(lineItemsResponse.ok()).toBeTruthy()

  const completeTask = await request.patch(
    `${apiBase()}/workshop/orders/${order.id}/tasks/${task.id}`,
    {
      headers,
      data: { status: 'DONE' },
    },
  )
  expect(completeTask.ok()).toBeTruthy()
  expect((await completeTask.json()).status).toBe('COMPLETED')

  return order
}

export async function openWorkshopCheckout(page: Page, orderId: string) {
  await page.goto(`/workshop/orders/${orderId}`)
  await page
    .getByRole('button', { name: DE_FULLSTACK_WORKSHOP.checkout.primaryAction, exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: DE_FULLSTACK_WORKSHOP.checkout.title, exact: true }),
  ).toBeVisible()
}

export async function readCheckoutSummaryAmount(page: Page, label: string) {
  const row = page.locator('div.flex.items-center.justify-between').filter({
    has: page.getByText(label, { exact: true }),
  })
  await expect(row).toBeVisible()
  return (await row.locator('span').last().textContent())?.trim() ?? ''
}

export async function createCheckoutDraftInvoice(page: Page) {
  await page
    .getByRole('button', { name: DE_FULLSTACK_WORKSHOP.checkoutSummary.createDraft })
    .click()
  await expect(page.getByText(/Rechnungsentwurf erstellt/)).toBeVisible({
    timeout: 60_000,
  })
}

export async function issueCheckoutDraftInvoice(page: Page) {
  const issueResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/invoices/') &&
      response.url().endsWith('/issue') &&
      response.request().method() === 'PATCH',
    { timeout: 120_000 },
  )
  await page.getByRole('button', { name: DE_FULLSTACK_WORKSHOP.checkoutSummary.issue }).click()
  const response = await issueResponse
  expect(response.ok()).toBeTruthy()
  const invoice = (await response.json()) as {
    id: string
    total_net: string
    total_tax: string
    total_gross: string
  }
  await expect(page.getByText(/Rechnung ausgestellt/)).toBeVisible()
  return invoice
}

export async function switchToEnglishViaAccountMenu(page: Page) {
  const englishOption = page.getByTestId('language-option-en')
  if (!(await englishOption.isVisible())) {
    await page.getByRole('button', { name: /@/ }).first().click()
  }
  await englishOption.click()
}

export const EN_CHECKOUT_SUMMARY = workshopEn.checkoutSummary
export const EN_CHECKOUT = workshopEn.checkout
