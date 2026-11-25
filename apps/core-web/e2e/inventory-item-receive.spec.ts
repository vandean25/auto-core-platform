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

test.describe('Inventory stock adjustments and Bestandsbuch (AUT-1048, mocked)', () => {
  async function setupLedgerMocks(page: Parameters<typeof test>[1] extends never ? never : import('@playwright/test').Page, opts: { canOverrideValue: boolean }) {
    const item = createMockInventoryItem({
      id: ITEM_ID,
      sku: 'FILTER-DEMO-01',
      name: 'Demo oil filter',
      quantity_available: 4,
      status: 'IN_STOCK',
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

    await page.route(AutoCorePage.apiRouteMatcher(`/api/inventory/${ITEM_ID}`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...item, cost_price: 4.5 }),
      })
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/inventory/locations'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: BIN_ID, name: 'Demo bin A1', code: 'BIN-A1', type: 'bin' }]),
      })
    })

    await page.route(AutoCorePage.apiRouteMatcher(`/api/inventory/${ITEM_ID}/adjustment-valuation`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          unitCost: '12.3456',
          valueSource: 'AVG',
          canOverrideValue: opts.canOverrideValue,
        }),
      })
    })

    const historyBody: Array<Record<string, unknown>> = [
      {
        id: 'tx-receipt',
        quantity: '4',
        type: 'PURCHASE_RECEIPT',
        reference_id: 'manual-receipt',
        cost_basis: '12.3456',
        extended_value: '49.38',
        createdAt: '2026-11-20T10:00:00.000Z',
        item: { sku: item.sku, name: item.name },
        location: { name: 'Demo bin A1' },
      },
      {
        id: 'tx-adj-1',
        quantity: '-2',
        type: 'ADJUSTMENT',
        reference_id: 'manual-adjustment',
        cost_basis: '12.3456',
        extended_value: '-24.69',
        reason: 'BREAKAGE',
        note: 'Lagerbruch',
        value_source: 'AVG',
        createdAt: '2026-11-21T10:00:00.000Z',
        item: { sku: item.sku, name: item.name },
        location: { name: 'Demo bin A1' },
      },
    ]

    await page.route(AutoCorePage.apiRouteMatcher(`/api/inventory/${ITEM_ID}/history`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(historyBody),
      })
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/inventory/transactions/tx-adj-1/reverse'), async (route) => {
      historyBody[1] = { ...historyBody[1], reversed_by_transaction_id: 'tx-rev-1' }
      const reversal = {
        id: 'tx-rev-1',
        quantity: '2',
        type: 'ADJUSTMENT',
        reference_id: 'manual-adjustment-reversal',
        cost_basis: '12.3456',
        extended_value: '24.69',
        reason: 'BREAKAGE',
        note: 'Lagerbruch',
        value_source: 'AVG',
        reversal_of_transaction_id: 'tx-adj-1',
        createdAt: '2026-11-22T10:00:00.000Z',
        item: { sku: item.sku, name: item.name },
        location: { name: 'Demo bin A1' },
      }
      historyBody.unshift(reversal)
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(reversal),
      })
    })

    return item
  }

  test('Scenario 1 & 7: adjust dialog shows auto value preview and hides override without permission', async ({ page }, testInfo) => {
    const item = await setupLedgerMocks(page, { canOverrideValue: false })
    await page.goto(`/inventory/${ITEM_ID}/ledger?sku=${encodeURIComponent(item.sku)}`)
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: DE_INVENTORY.actions.adjust }).click()
    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Demo bin A1' }).click()
    await page.getByLabel(DE_INVENTORY.dialogs.adjustStock.signedQuantity).fill('2')

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(/12,3456/)).toBeVisible()
    await expect(dialog.getByText(/24,69/)).toBeVisible()
    await expect(dialog.getByRole('checkbox', { name: DE_INVENTORY.dialogs.adjustStock.overrideToggle })).toHaveCount(0)

    await testInfo.attach('stock-adjust-dialog-no-override-de-desktop', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })

  test('Scenario 12 & Anti-criterion 6: Bestandsbuch shows Kosten, signed Wert, Grund, and Gegenbuchung at desktop and 375px', async ({ page }, testInfo) => {
    const item = await setupLedgerMocks(page, { canOverrideValue: true })
    await page.goto(`/inventory/${ITEM_ID}/ledger?sku=${encodeURIComponent(item.sku)}`)
    await page.waitForLoadState('networkidle')

    const table = page.getByTestId('inventory-ledger-table')
    await expect(table.getByRole('columnheader', { name: DE_INVENTORY.ledger.columns.cost })).toBeVisible()
    await expect(table.getByRole('columnheader', { name: DE_INVENTORY.ledger.columns.value })).toBeVisible()
    await expect(table.getByRole('columnheader', { name: DE_INVENTORY.ledger.columns.reason })).toBeVisible()
    await expect(table.getByText(/Bruch\/Beschädigung — Lagerbruch/)).toBeVisible()

    await table.getByRole('button', { name: DE_INVENTORY.ledger.reverseAction }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: DE_INVENTORY.ledger.reverseAction }).click()

    await expect(table.getByText(DE_INVENTORY.ledger.reversedBadge)).toBeVisible()
    await expect(table.getByText(DE_INVENTORY.ledger.reversalOfBadge).first()).toBeVisible()

    await testInfo.attach('bestandsbuch-valued-correction-reversal-de-desktop', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    await page.setViewportSize({ width: 375, height: 812 })
    const mobileList = page.getByTestId('inventory-ledger-mobile-list')
    await expect(mobileList).toBeVisible()
    await expect(mobileList.getByText(/Bruch\/Beschädigung — Lagerbruch/).first()).toBeVisible()

    await testInfo.attach('bestandsbuch-valued-correction-reversal-de-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })
})
