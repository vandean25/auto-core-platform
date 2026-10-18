import { test, expect } from '@playwright/test'
import { DE_INVENTORY_TRANSACTION } from './helpers/de-enums'
import { DE_INVENTORY } from './helpers/de-inventory'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockInventoryItem, createMockListResponse } from './utils/mock-factories'

const ITEM_ID = 'catalog-demo-1'
const BIN_ID = 'bin-demo-1'

test.describe('Inventory item detail — receive flow (mocked)', () => {
  test('receive stock then shows a purchase receipt ledger row', async ({ page }) => {
    const item = createMockInventoryItem({
      id: ITEM_ID,
      sku: 'FILTER-DEMO-01',
      name: 'Demo oil filter',
      quantity_available: 0,
      status: 'OUT_OF_STOCK',
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/auth/session'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'admin-user', email: 'admin@example.invalid' },
          tenant: { id: 'tenant-demo', name: 'Demo tenant' },
          activeRole: 'ADMIN',
        }),
      })
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/inventory'), async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createMockListResponse([item])),
        })
        return
      }
      await route.continue()
    })

    await page.route(AutoCorePage.apiRouteMatcher(`/api/inventory/${ITEM_ID}`), async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...item, cost_price: 4.5 }),
        })
        return
      }
      if (route.request().method() === 'PATCH') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
        return
      }
      await route.continue()
    })

    let historyBody = [] as Array<Record<string, unknown>>

    await page.route(AutoCorePage.apiRouteMatcher(`/api/inventory/${ITEM_ID}/history`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(historyBody),
      })
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/inventory/locations'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: BIN_ID,
            name: 'Demo bin A1',
            code: 'BIN-A1',
            type: 'bin',
          },
        ]),
      })
    })

    await page.route(AutoCorePage.apiRouteMatcher(`/api/inventory/${ITEM_ID}/receive`), async (route) => {
      historyBody = [
        {
          id: 'tx-1',
          quantity: '2',
          type: 'PURCHASE_RECEIPT',
          reference_id: 'manual-receipt',
          cost_basis: '4.5',
          createdAt: new Date().toISOString(),
          item: { sku: item.sku, name: item.name },
          location: { name: 'Demo bin A1' },
        },
      ]
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto(`/inventory/${ITEM_ID}/ledger?sku=${encodeURIComponent(item.sku)}`)
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: DE_INVENTORY.actions.receive }).click()
    await page.getByRole('combobox').click()
    await page.getByRole('option', { name: 'Demo bin A1' }).click()
    await page.getByRole('spinbutton', { name: DE_INVENTORY.dialogs.receiveStock.quantity }).fill('2')
    await page.getByRole('button', { name: DE_INVENTORY.dialogs.receiveStock.submit, exact: true }).click()

    await expect(page.getByRole('cell', { name: DE_INVENTORY_TRANSACTION.PURCHASE_RECEIPT })).toBeVisible()
    await expect(page.getByRole('cell', { name: '+2' })).toBeVisible()
  })
})
