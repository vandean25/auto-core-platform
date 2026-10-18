import { test, expect } from '@playwright/test'
import { loadE2eFullstackFixture } from './fixture.ts'
import { gotoWithReadySession } from './harness.ts'
import { DE_FULLSTACK_CUSTOMERS, DE_FULLSTACK_VEHICLE_STOCK } from './de-copy.ts'
import {
  E2E_FULLSTACK_API_PORT,
  E2E_FULLSTACK_VEHICLE_BUYER_FIRST,
  E2E_FULLSTACK_VEHICLE_PURCHASE_PRICE,
  E2E_FULLSTACK_VEHICLE_SALE_PRICE,
  E2E_FULLSTACK_VEHICLE_VIN,
} from '../../core-api/test/e2e-fullstack/constants.ts'

test.describe('Full-stack margin-scheme vehicle sale flow', () => {
  test('flow 3: purchase → stock → margin sale → invoice shows Differenzbesteuerung', async ({
    page,
    request,
  }) => {
    const fixture = loadE2eFullstackFixture()
    const apiBase = `http://127.0.0.1:${E2E_FULLSTACK_API_PORT}/api`
    const authHeaders = { Authorization: `Bearer ${fixture.authToken}` }

    await gotoWithReadySession(page, '/vehicle-stock/purchases/new')

    await page
      .getByLabel(DE_FULLSTACK_VEHICLE_STOCK.purchase.vin)
      .fill(E2E_FULLSTACK_VEHICLE_VIN)
    await page.getByLabel(DE_FULLSTACK_VEHICLE_STOCK.purchase.make).fill('Volkswagen')
    await page.getByLabel(DE_FULLSTACK_VEHICLE_STOCK.purchase.model).fill('Golf')
    await page.getByLabel(DE_FULLSTACK_VEHICLE_STOCK.purchase.year).fill('2018')
    await page
      .getByLabel(DE_FULLSTACK_VEHICLE_STOCK.purchase.purchasePrice)
      .fill(String(E2E_FULLSTACK_VEHICLE_PURCHASE_PRICE))

    await page
      .locator('select')
      .filter({
        has: page.getByRole('option', { name: DE_FULLSTACK_VEHICLE_STOCK.purchase.selectVendor }),
      })
      .selectOption(fixture.vendorId)

    await expect(page.getByText(DE_FULLSTACK_VEHICLE_STOCK.shared.saved)).toBeVisible({
      timeout: 30_000,
    })

    await page.getByRole('button', { name: DE_FULLSTACK_VEHICLE_STOCK.purchase.receive }).click()
    await expect(page.getByText(DE_FULLSTACK_VEHICLE_STOCK.purchase.receivedSuccess)).toBeVisible()

    await page.getByRole('button', { name: DE_FULLSTACK_VEHICLE_STOCK.stockDetail.sell }).click()
    await expect(page).toHaveURL(/\/vehicle-stock\/sales\/new\?vehicleId=/)
    const vehicleId = new URL(page.url()).searchParams.get('vehicleId')
    expect(vehicleId).toBeTruthy()

    const today = new Date().toISOString().slice(0, 10)

    const buyerCombobox = page
      .getByRole('combobox')
      .filter({ hasText: DE_FULLSTACK_CUSTOMERS.selectCustomer })
    await expect(buyerCombobox).toBeVisible()
    await expect(buyerCombobox).not.toContainText('search.selectPlaceholder')
    await buyerCombobox.click()
    await page
      .getByPlaceholder(DE_FULLSTACK_CUSTOMERS.searchPlaceholder)
      .fill(E2E_FULLSTACK_VEHICLE_BUYER_FIRST)
    await expect(
      page.getByRole('dialog').getByRole('option', { name: fixture.vehicleBuyerLabel }),
    ).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press('Escape')

    const saleResponse = await request.post(`${apiBase}/vehicle-sales`, {
      headers: authHeaders,
      data: {
        vehicle_id: vehicleId,
        customer_id: fixture.vehicleBuyerId,
        sale_price: E2E_FULLSTACK_VEHICLE_SALE_PRICE,
        contract_concluded_at: today,
        handed_over_at: today,
      },
    })
    expect(saleResponse.ok()).toBeTruthy()
    const sale = await saleResponse.json()

    await page.goto(`/vehicle-stock/sales/${sale.id}`)

    await expect(
      page.getByRole('button', { name: DE_FULLSTACK_VEHICLE_STOCK.sale.finalizeInvoice }),
    ).toBeEnabled()
    await page.getByRole('button', { name: DE_FULLSTACK_VEHICLE_STOCK.sale.finalizeInvoice }).click()
    await expect(page).toHaveURL(/\/sales\/invoices\/[0-9a-f-]+$/)

    await expect(page.getByText(/Differenzbesteuerung/i)).toBeVisible()
  })
})
