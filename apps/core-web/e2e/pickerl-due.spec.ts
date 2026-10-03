import { test, expect } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockListResponse } from './utils/mock-factories'

test.describe('Pickerl due list and dashboard widgets', () => {
  test('list shows empty state when API returns no rows', async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles/pickerl-due'), async (route) => {
      if (route.request().url().includes('/export')) {
        return route.continue()
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([])),
      })
    })

    await page.goto('/vehicles/pickerl-due')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('No results.').first()).toBeVisible()
  })

  test('list shows mocked row and UNKNOWN badge', async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles/pickerl-due'), async (route) => {
      const url = route.request().url()
      if (url.includes('/export')) {
        return route.continue()
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createMockListResponse([
            {
              id: 'v1',
              make: 'VW',
              model: 'Golf',
              plate: 'W-MOCK-1',
              customer: { first_name: 'A', last_name: 'B', type: 'PRIVATE' },
              pickerl_due: {
                status: 'UNKNOWN',
                due_month: null,
                last_inspected_on: null,
                rule_id: 'm1-legacy-pre-2027',
                warnings: [],
              },
            },
          ], 1),
        ),
      })
    })

    await page.goto('/vehicles/pickerl-due')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('W-MOCK-1')).toBeVisible()
    await expect(page.getByText('Unknown')).toBeVisible()
  })

  test('export button downloads mocked CSV', async ({ page }) => {
    let exportRequested = false
    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles/pickerl-due'), async (route) => {
      if (route.request().url().includes('/export')) {
        exportRequested = true
        await route.fulfill({
          status: 200,
          contentType: 'text/csv',
          body: 'plate,vehicle\nW-CSV,VW Golf',
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([])),
      })
    })

    await page.goto('/vehicles/pickerl-due')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Export due CSV' }).click()
    await expect.poll(() => exportRequested).toBe(true)
  })

  test('dashboard cards show meta.total and 30-day card navigates with filter_window=30', async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles/pickerl-due'), async (route) => {
      const url = new URL(route.request().url())
      const window = url.searchParams.get('window')
      const total = window === '30' ? 4 : window === '60' ? 7 : 11
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [],
          meta: { total, page: 1, pageSize: 1, pageCount: total },
        }),
      })
    })

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('4')).toBeVisible()
    await expect(page.getByText('7')).toBeVisible()
    await expect(page.getByText('11')).toBeVisible()

    await page.getByText('Pickerl due in 30 days').click()
    await expect(page).toHaveURL(/\/vehicles\/pickerl-due\?filter_window=30/)
  })
})
