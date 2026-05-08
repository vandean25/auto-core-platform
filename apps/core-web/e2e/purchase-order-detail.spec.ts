import { test, expect } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import {
  createMockPurchaseOrder,
  createMockVendor,
  createMockInventoryItem,
  createMockListResponse,
} from './utils/mock-factories'

/**
 * Blueprint: Purchase Order Detail
 *
 * E2E tests for the Purchase Order detail view.
 * Ensures the page aligns with the UI/UX architecture:
 * - Proper header structure.
 * - Accurate line item mocking with quantity_available.
 * - Proper status transition modeling.
 */
test.describe('Blueprint: Purchase Order Detail', () => {
  const PO_ID = 'po-blueprint-123'
  const VENDOR_ID = 'vendor-mock-123'
  const MOCK_AVAILABLE_QUANTITY = 25

  test('Purchase Order Detail - rendering and items', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Purchase Order')

    const mockVendor = createMockVendor({ id: VENDOR_ID, name: 'Bosch Automotive' })
    const mockPO = createMockPurchaseOrder({
      id: PO_ID,
      order_number: 'PO-2026-0001',
      status: 'DRAFT',
      vendor_id: VENDOR_ID,
      vendor: mockVendor,
      items: [
        {
          id: 'item-1',
          catalog_item_id: 'cat-1',
          quantity: 10,
          quantity_received: 0,
          unit_cost: 15.0,
          catalog_item: {
            sku: 'TEST-SKU-1',
            name: 'Test Part',
          },
        },
      ],
    })

    // 1. Mock all dependencies BEFORE navigation (network isolation)

    // GET/PATCH /api/purchase-orders/:id -> main entity
    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/purchase-orders/${PO_ID}`),
      async (route) => {
        if (route.request().method() === 'PATCH') {
          const body = JSON.parse(route.request().postData() || '{}')
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ...mockPO, ...body }),
          })
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(mockPO),
          })
        }
      },
    )

    // GET /api/vendors -> secondary API for vendor resolution
    await page.route(AutoCorePage.apiRouteMatcher('/api/vendors'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([mockVendor])),
      })
    })

    // GET /api/inventory -> secondary API for item search
    await page.route(AutoCorePage.apiRouteMatcher('/api/inventory'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createMockListResponse([createMockInventoryItem({ quantity_available: MOCK_AVAILABLE_QUANTITY })]),
        ),
      })
    })

    // GET /api/vendors/:vendorId/unbilled-receipts -> required to render correctly
    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/vendors/${VENDOR_ID}/unbilled-receipts`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        })
      },
    )

    // 2. Navigate to the page
    await corePage.navigate(`/purchase-orders/${PO_ID}`)

    // 3. Detail page load: verify header renders
    await expect(page.getByRole('heading', { name: 'PO-2026-0001', exact: true })).toBeVisible()
    await expect(page.getByText('Vendor: Bosch Automotive')).toBeVisible()
    await expect(page.getByText(/DRAFT/i)).toBeVisible()

    // 4. Line items: verify the table renders the mocked items
    await expect(page.getByRole('cell', { name: 'TEST-SKU-1' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Test Part' })).toBeVisible()
  })

  test('Purchase Order Detail - status workflow: Mark as Sent', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Purchase Order')
    const mockVendor = createMockVendor({ id: VENDOR_ID, name: 'Bosch Automotive' })
    let currentPO = createMockPurchaseOrder({
      id: PO_ID,
      order_number: 'PO-2026-0001',
      status: 'DRAFT',
      vendor_id: VENDOR_ID,
      vendor: mockVendor,
      items: [],
    })

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/purchase-orders/${PO_ID}`),
      async (route) => {
        if (route.request().method() === 'PATCH') {
          const body = JSON.parse(route.request().postData() || '{}')
          currentPO = { ...currentPO, ...body }
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(currentPO),
          })
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(currentPO),
          })
        }
      },
    )
    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/purchase-orders/${PO_ID}/mark-as-sent`),
      async (route) => {
        currentPO = {
          ...currentPO,
          status: 'SENT',
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(currentPO),
        })
      },
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/vendors'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([mockVendor])),
      })
    })
    await page.route(AutoCorePage.apiRouteMatcher('/api/inventory'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([])),
      })
    })
    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/vendors/${VENDOR_ID}/unbilled-receipts`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        })
      },
    )

    await corePage.navigate(`/purchase-orders/${PO_ID}`)

    const sendButton = page.getByRole('button', { name: /Mark as Sent/i })
    await expect(sendButton).toBeVisible()
    await sendButton.click()
    await expect(page.getByText('Sent', { exact: true })).toBeVisible()
  })

  // Auto-save (Saving → Saved cycle) is not yet implemented on the PO detail page.
  // Mark as fixme until the UI implements a debounced form-level auto-save indicator.
  test.fixme('Purchase Order Detail - auto-save on field change', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Purchase Order')
    const mockVendor = createMockVendor({ id: VENDOR_ID, name: 'Bosch Automotive' })
    const mockPO = createMockPurchaseOrder({
      id: PO_ID,
      order_number: 'PO-2026-0001',
      status: 'DRAFT',
      vendor_id: VENDOR_ID,
      vendor: mockVendor,
      items: [],
    })

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/purchase-orders/${PO_ID}`),
      async (route) => {
        if (route.request().method() === 'PATCH') {
          const body = JSON.parse(route.request().postData() || '{}')
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ...mockPO, ...body }),
          })
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(mockPO),
          })
        }
      },
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/vendors'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([mockVendor])),
      })
    })
    await page.route(AutoCorePage.apiRouteMatcher('/api/inventory'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([])),
      })
    })
    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/vendors/${VENDOR_ID}/unbilled-receipts`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        })
      },
    )

    await corePage.navigate(`/purchase-orders/${PO_ID}`)

    const notesInput = page.getByLabel(/Notes/i)
    await expect(notesInput).toBeVisible()
    const autoSavePromise = corePage.waitForAutoSave('/api/purchase-orders')
    await notesInput.fill('Updated notes')
    await autoSavePromise
    await expect(notesInput).toHaveValue('Updated notes')
  })
})

