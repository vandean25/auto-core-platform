import { test, expect, type Page } from '@playwright/test'
import { DE_STATUS } from './helpers/de-enums'
import { DE_COMMON_ACTIONS, DE_INVENTORY } from './helpers/de-inventory'
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

    const corePage = new AutoCorePage(page, DE_INVENTORY.stockTransfers.list.newTransfer)
    await corePage.navigate('/stock-transfers')

    await expect(page.getByRole('heading', { name: DE_INVENTORY.stockTransfers.list.title, exact: true })).toBeVisible()
    await corePage.createButton.click()

    await page.getByLabel(DE_INVENTORY.stockTransfers.create.fromSite).click()
    await page.getByRole('option', { name: /Wien/ }).click()

    await page.getByLabel(DE_INVENTORY.stockTransfers.create.toSite).click()
    await page.getByRole('option', { name: /München/ }).click()

    await page.getByLabel(DE_INVENTORY.stockTransfers.create.addParts).fill('FILTER')
    await page.getByRole('button', { name: 'FILTER-01' }).click()

    await expect(page.getByLabel(DE_INVENTORY.stockTransfers.create.sourceBinOptional)).toHaveCount(0)

    await page.getByRole('button', { name: DE_INVENTORY.actions.submitRequest }).click()

    await expect(page).toHaveURL(`/stock-transfers/${TRANSFER_ID}`)
    await expect(page.getByRole('heading', { name: 'TR-2026-0042' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'TR-2026-0042' }).locator('span')).toHaveText(
      DE_STATUS.REQUESTED,
    )

    await page.getByRole('button', { name: DE_COMMON_ACTIONS.cancel, exact: true }).click()
    await page.getByLabel(DE_INVENTORY.stockTransfers.detail.cancelDialog.reasonOptional).fill('No longer needed')
    await page.getByRole('button', { name: DE_INVENTORY.actions.cancelTransfer }).click()

    await expect(page.getByRole('heading', { name: 'TR-2026-0042' }).locator('span')).toHaveText(
      DE_STATUS.CANCELLED,
    )
  })
})

const MAIN_SITE_ID = 'site-main'
const GRZ_SITE_ID = 'site-grz'
const MAIN_BIN_ID = 'bin-main-a1'
const MAIN_GRZ_TRANSFER_ID = 'transfer-main-grz-1'
const MAIN_GRZ_SITES = [
  {
    id: MAIN_SITE_ID,
    code: 'MAIN',
    name: 'Vienna Workshop',
    legalEntityId: 'entity-1',
    legalEntityName: 'Default GmbH',
  },
  {
    id: GRZ_SITE_ID,
    code: 'GRZ',
    name: 'Graz Workshop',
    legalEntityId: 'entity-1',
    legalEntityName: 'Default GmbH',
  },
]

type CreateStockTransferBody = {
  fromSiteId: string
  toSiteId: string
  lines: Array<{ catalogItemId: string; requestedQty: number; sourceLocationId?: string }>
}

/**
 * AUT-466: same-GmbH submits between MAIN and GRZ answered 500 and left the
 * list empty. The API is stubbed here, so these cases pin the request the
 * dialog sends in each direction (with and without the optional source bin)
 * and that the created transfer opens its detail page.
 */
async function routeMainGrzTransfers(
  page: Page,
  options: {
    memberSiteIds: string[]
    onCreate: (body: CreateStockTransferBody) => void
  },
) {
  const siteName = (siteId: string) =>
    MAIN_GRZ_SITES.find((site) => site.id === siteId)?.name ?? ''
  let transfer: ReturnType<typeof createMockStockTransfer> | undefined

  await page.route(AutoCorePage.apiRouteMatcher('/api/me/sites'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        MAIN_GRZ_SITES.filter((site) => options.memberSiteIds.includes(site.id)),
      ),
    })
  })

  await page.route(AutoCorePage.apiRouteMatcher('/api/sites'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MAIN_GRZ_SITES),
    })
  })

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
      body: JSON.stringify([
        { id: MAIN_BIN_ID, code: 'BIN-A1', name: 'Bin A1', type: 'bin', siteId: MAIN_SITE_ID },
      ]),
    })
  })

  await page.route(AutoCorePage.apiRouteMatcher('/api/stock-transfers'), async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(transfer ? [transfer] : []),
      })
      return
    }

    const body = JSON.parse(route.request().postData() || '{}') as CreateStockTransferBody
    options.onCreate(body)
    transfer = createMockStockTransfer({
      id: MAIN_GRZ_TRANSFER_ID,
      transferNumber: 'TR-2026-0043',
      fromSiteId: body.fromSiteId,
      fromSiteName: siteName(body.fromSiteId),
      toSiteId: body.toSiteId,
      toSiteName: siteName(body.toSiteId),
      status: 'REQUESTED',
      version: 1,
      lines: body.lines.map((line, index) => ({
        id: `line-${index + 1}`,
        catalogItemId: line.catalogItemId,
        requestedQty: `${line.requestedQty}.000`,
        approvedQty: '0.000',
        shippedQty: '0.000',
        receivedQty: '0.000',
        returnedQty: '0.000',
        sourceLocationId: line.sourceLocationId ?? null,
        destLocationId: null,
      })),
    })
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(transfer),
    })
  })

  await page.route(
    AutoCorePage.apiRouteMatcher(`/api/stock-transfers/${MAIN_GRZ_TRANSFER_ID}`),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(transfer),
      })
    },
  )
}

test.describe('Stock Transfers — MAIN <-> GRZ (AUT-466)', () => {
  test('MAIN -> GRZ with the optional source bin on MAIN opens the new request', async ({
    page,
  }) => {
    const bodies: CreateStockTransferBody[] = []
    await routeMainGrzTransfers(page, {
      memberSiteIds: [MAIN_SITE_ID],
      onCreate: (body) => bodies.push(body),
    })

    const corePage = new AutoCorePage(page, DE_INVENTORY.stockTransfers.list.newTransfer)
    await corePage.navigate('/stock-transfers')
    await corePage.createButton.click()

    await page.getByLabel(DE_INVENTORY.stockTransfers.create.toSite).click()
    await page.getByRole('option', { name: /Graz Workshop \(GRZ\)/ }).click()
    await page.getByLabel(DE_INVENTORY.stockTransfers.create.fromSite).click()
    await page.getByRole('option', { name: /Vienna Workshop \(MAIN\)/ }).click()

    await page.getByLabel(DE_INVENTORY.stockTransfers.create.addParts).fill('FILTER')
    await page.getByRole('button', { name: 'FILTER-01' }).click()

    const sourceBinLabel = DE_INVENTORY.stockTransfers.create.sourceBinAria.replace(
      '{{sku}}',
      'FILTER-01',
    )
    const sourceBin = page.getByRole('combobox', { name: sourceBinLabel })
    await expect(sourceBin).toBeVisible({ timeout: 15_000 })
    await sourceBin.click()
    await page.getByRole('option', { name: /BIN-A1/ }).click()

    await page.getByRole('button', { name: DE_INVENTORY.actions.submitRequest }).click()

    await expect(page).toHaveURL(`/stock-transfers/${MAIN_GRZ_TRANSFER_ID}`)
    await expect(page.getByRole('heading', { name: 'TR-2026-0043' })).toBeVisible()
    expect(bodies).toEqual([
      {
        fromSiteId: MAIN_SITE_ID,
        toSiteId: GRZ_SITE_ID,
        lines: [
          {
            catalogItemId: CATALOG_ITEM_ID,
            requestedQty: 1,
            sourceLocationId: MAIN_BIN_ID,
          },
        ],
      },
    ])
  })

  test('GRZ -> MAIN without a source bin sends no bin and opens the new request', async ({
    page,
  }) => {
    const bodies: CreateStockTransferBody[] = []
    await routeMainGrzTransfers(page, {
      memberSiteIds: [MAIN_SITE_ID],
      onCreate: (body) => bodies.push(body),
    })

    const corePage = new AutoCorePage(page, DE_INVENTORY.stockTransfers.list.newTransfer)
    await corePage.navigate('/stock-transfers')
    await corePage.createButton.click()

    await page.getByLabel(DE_INVENTORY.stockTransfers.create.toSite).click()
    await page.getByRole('option', { name: /Vienna Workshop \(MAIN\)/ }).click()
    await page.getByLabel(DE_INVENTORY.stockTransfers.create.fromSite).click()
    await page.getByRole('option', { name: /Graz Workshop \(GRZ\)/ }).click()

    await page.getByLabel(DE_INVENTORY.stockTransfers.create.addParts).fill('FILTER')
    await page.getByRole('button', { name: 'FILTER-01' }).click()

    await expect(
      page.getByLabel(DE_INVENTORY.stockTransfers.create.sourceBinAria.replace('{{sku}}', 'FILTER-01')),
    ).toHaveCount(0)
    await page.getByRole('button', { name: DE_INVENTORY.actions.submitRequest }).click()

    await expect(page).toHaveURL(`/stock-transfers/${MAIN_GRZ_TRANSFER_ID}`)
    await expect(page.getByRole('heading', { name: 'TR-2026-0043' })).toBeVisible()
    expect(bodies).toEqual([
      {
        fromSiteId: GRZ_SITE_ID,
        toSiteId: MAIN_SITE_ID,
        lines: [{ catalogItemId: CATALOG_ITEM_ID, requestedQty: 1 }],
      },
    ])
  })
})

const BIN_DETAIL_ID = 'transfer-bins-1'
const SOURCE_BIN_UUID = '5814c62c-1111-4000-8000-000000000001'
const DEST_BIN_UUID = '5814c62c-2222-4000-8000-000000000002'
const SOURCE_BIN = { code: 'QA-BIN-MAIN-01', name: 'Main Bin' }
const DEST_BIN = { code: 'QA-BIN-GRZ-01', name: 'Graz Bin' }

/**
 * AUT-909: the detail response carries the bin codes, and `/api/inventory/locations`
 * is deliberately empty — the other site's bins are not in the caller's own list, so
 * only the server-resolved codes can keep the table free of raw UUIDs.
 */
function completedTransferWithBins() {
  return createMockStockTransfer({
    id: BIN_DETAIL_ID,
    transferNumber: 'TR-2026-0001',
    fromSiteId: MAIN_SITE_ID,
    fromSiteName: 'Vienna Workshop',
    toSiteId: GRZ_SITE_ID,
    toSiteName: 'Graz Workshop',
    status: 'COMPLETED',
    version: 4,
    requestedByUserId: 'e2e-test-user',
    lines: [
      {
        id: 'line-1',
        catalogItemId: CATALOG_ITEM_ID,
        requestedQty: '2.000',
        approvedQty: '2.000',
        shippedQty: '2.000',
        receivedQty: '2.000',
        returnedQty: '0.000',
        sourceLocationId: SOURCE_BIN_UUID,
        destLocationId: DEST_BIN_UUID,
        fromBinCode: SOURCE_BIN.code,
        fromBinName: SOURCE_BIN.name,
        toBinCode: DEST_BIN.code,
        toBinName: DEST_BIN.name,
      },
      {
        id: 'line-2',
        catalogItemId: 'catalog-2',
        requestedQty: '1.000',
        approvedQty: '1.000',
        shippedQty: '1.000',
        receivedQty: '1.000',
        returnedQty: '0.000',
        sourceLocationId: SOURCE_BIN_UUID,
        destLocationId: DEST_BIN_UUID,
        fromBinCode: SOURCE_BIN.code,
        fromBinName: SOURCE_BIN.name,
        toBinCode: DEST_BIN.code,
        toBinName: DEST_BIN.name,
      },
    ],
  })
}

async function routeBinDetail(page: Page) {
  await page.route(AutoCorePage.apiRouteMatcher('/api/me/sites'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MAIN_GRZ_SITES),
    })
  })

  await page.route(AutoCorePage.apiRouteMatcher('/api/inventory'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        createMockListResponse([
          createMockInventoryItem({ id: CATALOG_ITEM_ID, sku: 'FILTER-01', name: 'Oil Filter' }),
          createMockInventoryItem({ id: 'catalog-2', sku: 'BRAKE-02', name: 'Brake Pad' }),
        ]),
      ),
    })
  })

  await page.route(AutoCorePage.apiRouteMatcher('/api/inventory/locations'), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  })

  await page.route(AutoCorePage.apiRouteMatcher(`/api/stock-transfers/${BIN_DETAIL_ID}`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(completedTransferWithBins()),
    })
  })

  const corePage = new AutoCorePage(page, '')
  await corePage.navigate(`/stock-transfers/${BIN_DETAIL_ID}`)
  await expect(
    page.getByRole('heading', { name: 'TR-2026-0001', exact: false }).first(),
  ).toBeVisible()
}

test.describe('Stock Transfer detail on a phone (AUT-909)', () => {
  test.use({ viewport: { width: 390, height: 900 } })

  async function expectListModeWithoutPageScroll(page: Page) {
    await expect(page.locator('[data-table-list="true"]')).toBeVisible()
    await expect(page.getByRole('table')).toHaveCount(0)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  }

  test('positions use list mode, show bin codes and the page never scrolls sideways', async ({
    page,
  }) => {
    await routeBinDetail(page)

    await expectListModeWithoutPageScroll(page)
    await expect(page.getByText(SOURCE_BIN.code).first()).toBeVisible()
    await expect(page.getByText(DEST_BIN.code).first()).toBeVisible()
    await expect(page.locator('body')).not.toContainText(SOURCE_BIN_UUID)
    await expect(page.locator('body')).not.toContainText(DEST_BIN_UUID)

    // The narrowest phone width the layout must still fit.
    await page.setViewportSize({ width: 375, height: 812 })
    await expectListModeWithoutPageScroll(page)
  })
})

test.describe('Stock Transfer detail at desktop width (AUT-909)', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('the positions table shows every column without cutting any off', async ({ page }) => {
    await routeBinDetail(page)

    await expect(page.locator('[data-table-list="true"]')).toHaveCount(0)
    const columns = DE_INVENTORY.stockTransfers.detail.columns
    const headers = page.getByRole('columnheader')
    await expect(headers).toHaveCount(8)

    const boxes = await headers.evaluateAll((cells) =>
      cells.map((cell) => {
        const box = cell.getBoundingClientRect()
        return { text: cell.textContent ?? '', left: box.left, right: box.right }
      }),
    )
    for (const box of boxes) {
      expect(box.left, box.text).toBeGreaterThanOrEqual(0)
      expect(box.right, box.text).toBeLessThanOrEqual(1400)
    }
    const labels = boxes.map((box) => box.text)
    for (const label of Object.values(columns)) {
      expect(labels.some((text) => text.includes(label))).toBe(true)
    }

    await expect(page.locator('body')).not.toContainText(SOURCE_BIN_UUID)
    await expect(page.getByText(`${SOURCE_BIN.code} — ${SOURCE_BIN.name}`).first()).toBeVisible()
    await expect(page.getByText(`${DEST_BIN.code} — ${DEST_BIN.name}`).first()).toBeVisible()
  })
})
