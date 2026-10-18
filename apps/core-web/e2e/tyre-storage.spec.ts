import { test, expect } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockListResponse } from './utils/mock-factories'
import { deErrorCode } from './helpers/de-errors'
import { DE_COMMON_ACTIONS, DE_INVENTORY } from './helpers/de-inventory'
import { waitForDeNamespace } from './helpers/wait-for-i18n'

const mockTyreSet = {
  id: 'tyre-set-1',
  customerId: 'cust-1',
  vehicleId: 'veh-1',
  siteId: 'site-1',
  locationId: 'loc-1',
  locationCode: 'RACK-A',
  label: 'Winter 18"',
  season: 'WINTER',
  tyreCount: 4,
  rimType: 'ALLOY',
  brand: null,
  model: null,
  dimension: '225/45 R18',
  dotCodes: [],
  treadDepthMm: null,
  conditionNotes: null,
  status: 'IN_STORAGE',
  storedSince: '2026-01-01',
  plannedSwapOn: '2026-03-01',
  binLabel: 'R3-F2-07',
  customerName: 'Demo Kunde',
  vehiclePlate: 'W-TEST-1',
  customerPhone: '+43123456789',
  customerEmail: 'pilot@example.com',
  events: [],
}

test.describe('Reifenlager', () => {
  test('shows tyre storage list', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Reifenlager')
    await page.route(AutoCorePage.apiRouteMatcher('/api/tyre-sets'), async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([mockTyreSet])),
      })
    })
    await page.route(AutoCorePage.apiRouteMatcher('/api/tyre-sets/due-for-swap'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      })
    })

    await corePage.navigate('/workshop/tyre-storage')
    await expect(page.getByText('Winter 18"')).toBeVisible()
  })

  test('due view shows phone and email columns', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Reifenlager')
    await page.route(AutoCorePage.apiRouteMatcher('/api/tyre-sets'), async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([])),
      })
    })
    await page.route(AutoCorePage.apiRouteMatcher('/api/tyre-sets/due-for-swap'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [mockTyreSet] }),
      })
    })

    await corePage.navigate('/workshop/tyre-storage')
    await page.getByRole('button', { name: new RegExp(DE_INVENTORY.actions.dueForSwap) }).click()
    await expect(page.getByText('+43123456789')).toBeVisible()
    await expect(page.getByText('pilot@example.com')).toBeVisible()
  })

  test('check-in dialog requires location and surfaces 409', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Reifenlager')
    await page.route(AutoCorePage.apiRouteMatcher('/api/tyre-sets/tyre-set-1'), async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...mockTyreSet, status: 'RETURNED', locationId: null }),
        })
        return
      }
      await route.continue()
    })
    await page.route(
      AutoCorePage.apiRouteMatcher('/api/inventory/locations'),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            { id: 'loc-1', code: 'RACK-A', name: 'Rack A', type: 'customer_storage' },
            { id: 'loc-2', code: 'RACK-B', name: 'Rack B', type: 'customer_storage' },
          ]),
        })
      },
    )
    await page.route(
      AutoCorePage.apiRouteMatcher('/api/tyre-sets/tyre-set-1/check-in'),
      async (route) => {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Tyre set status changed concurrently. Please refresh.' }),
        })
      },
    )

    await corePage.navigate('/workshop/tyre-storage/tyre-set-1')
    await waitForDeNamespace(page, 'inventory')
    await expect(page.getByRole('heading', { name: 'Winter 18"' })).toBeVisible({
      timeout: 15_000,
    })
    await page.getByRole('button', { name: DE_INVENTORY.actions.checkIn }).click()
    await page.getByRole('combobox').click()
    await page.getByRole('option', { name: 'RACK-A' }).click()
    await page.getByRole('button', { name: DE_COMMON_ACTIONS.confirm }).click()
    await expect(page.getByText(deErrorCode('HTTP_409'))).toBeVisible()
  })
})
