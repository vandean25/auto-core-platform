import { test, expect } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockListResponse } from './utils/mock-factories'

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
        body: JSON.stringify(
          createMockListResponse([
            {
              id: 'tyre-set-1',
              customerId: 'cust-1',
              vehicleId: 'veh-1',
              siteId: 'site-1',
              locationId: 'loc-1',
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
              customerName: 'Pilot Customer',
              vehiclePlate: 'W-TEST-1',
              customerPhone: '+43123456789',
              customerEmail: 'pilot@example.com',
            },
          ]),
        ),
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
})
