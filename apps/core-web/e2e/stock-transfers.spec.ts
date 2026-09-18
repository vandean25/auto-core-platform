import { test, expect } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import {
  createMockInventoryItem,
  createMockListResponse,
  createMockStockTransfer,
} from './utils/mock-factories'

const FROM_SITE_ID = 'site-from'
const TO_SITE_ID = 'site-to'
const TRANSFER_ID = 'transfer-dest-only-1'
const CATALOG_ITEM_ID = 'catalog-1'

test.describe('Stock Transfers — destination-only request and cancel', () => {
  test('creates a request without source bins and cancels it', async ({ page }) => {
    let transfer = createMockStockTransfer({
      id: TRANSFER_ID,
      transferNumber: 'TR-2026-0042',
      fromSiteId: FROM_SITE_ID,
      fromSiteName: 'Wien',
      toSiteId: TO_SITE_ID,
      toSiteName: 'München',
      status: 'REQUESTED',
      version: 1,
      requestedByUserId: 'e2e-test-user',
      lines: [
        {
          id: 'line-1',
          catalogItemId: CATALOG_ITEM_ID,
          requestedQty: '2.000',
          approvedQty: '0.000',
          shippedQty: '0.000',
          receivedQty: '0.000',
          returnedQty: '0.000',
          sourceLocationId: null,
          destLocationId: null,
        },
      ],
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/me/sites'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: TO_SITE_ID,
            code: 'MUC',
            name: 'München',
            legalEntityId: 'entity-1',
            legalEntityName: 'DE GmbH',
          },
        ]),
      })
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/sites'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: FROM_SITE_ID,
            code: 'VIE',
            name: 'Wien',
            legalEntityId: 'entity-1',
            legalEntityName: 'DE GmbH',
          },
          {
            id: TO_SITE_ID,
            code: 'MUC',
            name: 'München',
            legalEntityId: 'entity-1',
            legalEntityName: 'DE GmbH',
          },
        ]),
      })
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/stock-transfers'), async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}')
        expect(body.fromSiteId).toBe(FROM_SITE_ID)
        expect(body.toSiteId).toBe(TO_SITE_ID)
        expect(body.lines[0].sourceLocationId).toBeUndefined()
        transfer = {
          ...transfer,
          ...body,
          id: TRANSFER_ID,
          transferNumber: transfer.transferNumber,
          status: 'REQUESTED',
          version: 1,
        }
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(transfer),
        })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/stock-transfers/${TRANSFER_ID}`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(transfer),
        })
      },
    )

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/stock-transfers/${TRANSFER_ID}/cancel`),
      async (route) => {
        transfer = {
          ...transfer,
          status: 'CANCELLED',
          version: 2,
          cancelReason: 'No longer needed',
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(transfer),
        })
      },
    )

    await page.route(AutoCorePage.apiRouteMatcher('/api/inventory'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createMockListResponse([
            createMockInventoryItem({
              id: CATALOG_ITEM_ID,
              sku: 'FILTER-01',
              name: 'Oil Filter',
            }),
          ]),
        ),
      })
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/inventory/locations'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })

    const corePage = new AutoCorePage(page, 'Transfer')
    await corePage.navigate('/stock-transfers')

    await expect(page.getByRole('heading', { name: 'Transfers', exact: true })).toBeVisible()
    await corePage.createButton.click()

    await page.getByLabel('From site').click()
    await page.getByRole('option', { name: /Wien/ }).click()

    await page.getByLabel('Add parts').fill('FILTER')
    await page.getByRole('button', { name: 'FILTER-01' }).click()

    await expect(page.getByLabel('Source bin (optional)')).toHaveCount(0)

    await page.getByRole('button', { name: 'Submit request' }).click()

    await expect(page).toHaveURL(`/stock-transfers/${TRANSFER_ID}`)
    await expect(page.getByRole('heading', { name: 'TR-2026-0042' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'TR-2026-0042' }).locator('span')).toHaveText(
      'Requested',
    )

    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByLabel('Reason (optional)').fill('No longer needed')
    await page.getByRole('button', { name: 'Cancel transfer' }).click()

    await expect(page.getByRole('heading', { name: 'TR-2026-0042' }).locator('span')).toHaveText(
      'Cancelled',
    )
  })
})
